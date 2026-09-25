"""Lecciones: lo que la investigación aprendió a no repetir, por regla.

Es el "do not re-mine" de rekursiv.ai aplicado a ROSA2018. Al cerrar cada
iteración se generan, sin modelo, a partir de lo que el registro ya guarda:
pasos y pistas que fallaron y por qué, consultas que devolvieron cero
resultados o cero relevantes, bases que no respondieron, hallazgos del revisor
de registro, hipótesis cerradas por el Killer con la comprobación que falló,
ideas retiradas del vivero, análisis in silico sin efecto o no evaluables,
incidencias. Cada lección tiene un ámbito (plan, consultas, fuentes,
hipótesis, análisis, resumen) y cuenta cuántas veces se repitió. Se indexan
por significado y cada paso pide las que le tocan antes de actuar: el
planificador no vuelve a programar lo que falló dos veces, el generador de
consultas no relanza la consulta vacía, el generador de hipótesis no propone
lo que el Killer cerró por misma cohorte. 16 de septiembre de 2026.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import indice_semantico
from rosa.estado import plantilla as P

AMBITOS = ("plan", "consultas", "fuentes", "hipotesis", "analisis", "resumen")
MAX_POR_INVESTIGACION = 200
CIERRES_KILLER = ("descartar_en_contexto", "suspender")


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower()).strip()


def nueva(investigacion_id: str, ambito: str, texto: str, origen: str, corrida_id: str | None, iteracion: int | None, ahora: int) -> dict[str, Any]:
    return {"id": P.nuevo_id("lec"), "investigacionId": investigacion_id, "ambito": ambito if ambito in AMBITOS else "plan", "texto": (texto or "").strip()[:400], "origen": origen[:120], "corridaId": corrida_id, "iteracion": iteracion, "creadaEn": ahora, "ultimaVez": ahora, "veces": 1}


def registrar(e: dict[str, Any], lecciones: list[dict[str, Any]]) -> int:
    """Mete las lecciones en el estado sin repetir: la misma (ámbito y texto)
    suma una vez y actualiza la fecha. Tope por investigación: se retiran las
    más antiguas vistas una sola vez. Devuelve cuántas eran nuevas."""
    todas = e.setdefault("lecciones", [])
    nuevas = 0
    for lec in lecciones:
        clave = (lec["investigacionId"], lec["ambito"], _norm(lec["texto"]))
        existente = next((x for x in todas if (x["investigacionId"], x["ambito"], _norm(x["texto"])) == clave), None)
        if existente:
            existente["veces"] = int(existente.get("veces") or 1) + 1
            existente["ultimaVez"] = lec["ultimaVez"]
            existente["iteracion"] = lec.get("iteracion")
            existente["corridaId"] = lec.get("corridaId")
        else:
            todas.append(lec)
            nuevas += 1
    for inv_id in {x["investigacionId"] for x in lecciones}:
        propias = [x for x in todas if x["investigacionId"] == inv_id]
        while len(propias) > MAX_POR_INVESTIGACION:
            vieja = min((x for x in propias if int(x.get("veces") or 1) == 1), key=lambda x: x.get("ultimaVez") or 0, default=None) or min(propias, key=lambda x: x.get("ultimaVez") or 0)
            todas.remove(vieja)
            propias.remove(vieja)
    return nuevas


def generar_al_cerrar(e: dict[str, Any], c: dict[str, Any], it: dict[str, Any], revision: dict[str, Any] | None, ahora: int) -> list[dict[str, Any]]:
    """Las lecciones de una iteración que se cierra, todas por regla."""
    inv_id = c["investigacionId"]
    desde = int(it.get("empezadaEn") or 0)
    salida: list[dict[str, Any]] = []

    def add(ambito: str, texto: str, origen: str) -> None:
        if texto.strip():
            salida.append(nueva(inv_id, ambito, texto, origen, c["id"], it.get("numero"), ahora))

    # Pasos y pistas que fallaron, con racha.
    previas = [x for x in e.get("iteraciones", []) if x.get("corridaId") == c["id"] and x.get("numero", 0) < it.get("numero", 0)]
    fallidos_previos = {p_["titulo"] for x in previas[-1:] for p_ in x.get("plan", []) if p_.get("estado") in ("fallido", "omitido")}
    for p_ in it.get("plan", []):
        if p_.get("estado") in ("fallido", "omitido"):
            racha = "; ya había fallado en la iteración anterior" if p_["titulo"] in fallidos_previos else ""
            add("plan", f"El paso «{p_['titulo'][:80]}» ({p_.get('tipo') or 'paso'}) quedó {p_['estado']}: {(p_.get('motivoFallo') or 'sin motivo registrado')[:200]}{racha}", f"paso:{p_.get('id')}")
    # Etapas que corrieron, quedaron en verde y no produjeron lo suyo: la
    # comprobación de cierre (rosa/comprobaciones.py) es lo único que lo ve. La
    # lección entra en los prompts de consultas y de hipótesis de la iteración
    # siguiente, así que el planificador aprende sin pagar ninguna llamada de más.
    for p_ in it.get("plan", []):
        comp = p_.get("comprobacion") if isinstance(p_, dict) else None
        if not isinstance(comp, dict) or comp.get("resultado") not in ("falla", "no_comprobable") or p_.get("estado") not in ("hecho", "sin_trabajo"):
            continue
        que = "tenía materia y no produjo nada" if comp["resultado"] == "falla" else "no se pudo comprobar"
        add("plan", f"La etapa de {comp.get('etapa')} del paso «{p_['titulo'][:70]}» terminó en verde pero {que}: {(comp.get('detalle') or '')[:200]}", f"etapa:{p_.get('id')}")
    for pi in it.get("pistas", []):
        if pi.get("estado") == "fallida":
            add("plan", f"La pista «{pi['titulo'][:80]}» ({pi.get('tipo')}, {pi.get('fuente')}) falló: {(pi.get('resumen') or '')[:200]}", f"pista:{pi.get('id')}")
    # Consultas vacías o sin nada relevante.
    for q in (c.get("busqueda") or {}).get("consultas", []):
        if q.get("iteracion") != it.get("numero"):
            continue
        if int(q.get("resultados") or 0) == 0:
            add("consultas", f"La consulta «{q['consulta'][:140]}» en {q['base']} devolvió 0 resultados: no repetirla igual; cambiar términos o base", "consulta")
        elif q.get("relevantes") == 0:
            add("consultas", f"La consulta «{q['consulta'][:140]}» en {q['base']} trajo {q['resultados']} resultados y ninguno relevante: afinar términos o cambiar de base", "consulta")
    # Bases que no responden.
    for base, n in (c.get("_fallosFuente") or {}).items():
        if int(n or 0) >= 3:
            add("fuentes", f"{base} no respondió {n} veces en esta corrida: registrar «no pude comprobar», nunca «no hay», y buscar alternativa", f"fuente:{base}")
    # Hallazgos del revisor de registro.
    for hz in (revision or {}).get("hallazgos", []) or []:
        add("resumen", f"El revisor de registro marcó {str(hz.get('clase', '')).replace('_', ' ')} ({hz.get('gravedad')}): {(hz.get('detalle') or '')[:220]}", f"revisor:{hz.get('id')}")
    # Hipótesis cerradas por el Killer en esta iteración, con la comprobación que falló.
    titulos = {h["id"]: h["titulo"] for h in e.get("hipotesis", [])}
    for d in e.get("decisiones", []):
        # `sinJuez`: suspensión técnica tras tres fallos del juez (S-09), no un juicio científico.
        if d.get("investigacionId") == inv_id and str(d.get("etapa", "")).startswith("killer") and d.get("decision") in CIERRES_KILLER and int(d.get("fecha") or 0) >= desde and not d.get("sinJuez"):
            fallan = [x.get("comprobacion") for x in d.get("comprobaciones", []) if x.get("resultado") == "falla"]
            add("hipotesis", f"«{titulos.get(d.get('hipotesisId'), d.get('hipotesisId'))[:80]}» cerrada por el Killer ({str(d.get('decision')).replace('_', ' ')}): fallaron {', '.join(str(x).replace('_', ' ') for x in fallan) or 'sin comprobaciones fallidas registradas'}. Haría falta: {(d.get('queHariaFalta') or 'no registrado')[:160]}", f"decision:{d.get('id')}")
    # Ideas retiradas del vivero.
    inv: dict[str, Any] = next((i for i in e.get("investigaciones", []) if i["id"] == inv_id), {})
    for s in inv.get("viveroRetiradas") or []:
        if int(s.get("retiradaEn") or 0) >= desde:
            add("hipotesis", f"La idea «{s['titulo'][:80]}» salió del vivero sin nacer: {(s.get('motivo') or '')[:160]}", f"vivero:{s.get('id')}")
    # Análisis in silico sin efecto o no evaluables.
    for run in e.get("ejecuciones", []):
        if run.get("investigacionId") != inv_id or int(run.get("inicio") or 0) < desde:
            continue
        estado_i = (run.get("interpretacion") or {}).get("estado")
        if run.get("estado") == "error" or estado_i in ("no_evaluable", "sin_efecto_detectable"):
            add("analisis", f"El análisis in silico {run.get('id')} ({run.get('tipo')}) terminó {str(estado_i or run.get('estado')).replace('_', ' ')}: {((run.get('interpretacion') or {}).get('resumen') or run.get('error') or '')[:200]}", f"ejecucion:{run.get('id')}")
    # Incidencias abiertas en esta iteración.
    for inc in e.get("incidencias", []):
        if inc.get("corridaId") == c["id"] and int(inc.get("creadaEn") or 0) >= desde:
            add("plan", f"Incidencia ({inc.get('tipo')}) con {inc.get('recurso')}: {inc.get('titulo', '')[:120]}. Alternativa: {(inc.get('alternativa') or 'ninguna')[:120]}", f"incidencia:{inc.get('id')}")
    return salida


def texto_de(lecciones: list[dict[str, Any]], maximo: int = 8) -> str:
    if not lecciones:
        return "Ninguna todavía."
    lineas = ["Lecciones de esta investigación (lo que no repetir):"]
    for lec in lecciones[:maximo]:
        veces = int(lec.get("veces") or 1)
        lineas.append(f"- [{lec['ambito']}] {lec['texto']}" + (f" (visto {veces} veces)" if veces > 1 else "") + (f" (iteración {lec['iteracion']})" if lec.get("iteracion") else ""))
    return "\n".join(lineas)


def recientes(e: dict[str, Any], investigacion_id: str, ambitos: tuple[str, ...] | None = None, maximo: int = 8) -> list[dict[str, Any]]:
    propias = [x for x in e.get("lecciones", []) if x["investigacionId"] == investigacion_id and (not ambitos or x["ambito"] in ambitos)]
    propias.sort(key=lambda x: (-(int(x.get("veces") or 1) > 1), -(x.get("ultimaVez") or 0)))
    return propias[:maximo]


async def para(almacen: Any, investigacion_id: str, ambitos: tuple[str, ...] | None, consulta: str, maximo: int = 8) -> str:
    """Las lecciones que le tocan a un paso: por parecido con lo que va a hacer
    si hay índice semántico, y siempre las repetidas más recientes."""
    e = almacen.estado
    elegidas: list[dict[str, Any]] = list(recientes(e, investigacion_id, ambitos, maximo=max(3, maximo // 2)))
    ya = {x["id"] for x in elegidas}
    if indice_semantico.disponible() and (consulta or "").strip():
        try:
            por_id = {x["id"]: x for x in e.get("lecciones", []) if x["investigacionId"] == investigacion_id and (not ambitos or x["ambito"] in ambitos)}
            hits = await indice_semantico.de_almacen(almacen).buscar(consulta[:2000], k=maximo * 2, investigacion_id=investigacion_id, tipos=("leccion",))
            for hit in hits:
                lid = str(hit["id"]).split(":", 1)[-1]
                if lid in por_id and lid not in ya:
                    elegidas.append(por_id[lid])
                    ya.add(lid)
                if len(elegidas) >= maximo:
                    break
        except Exception:  # noqa: BLE001  sin índice, las recientes bastan
            pass
    return texto_de(elegidas[:maximo], maximo)
