"""Vivero de ideas: las propuestas de hipótesis que todavía no tienen con qué
nacer.

Regla de Emir (15 de septiembre de 2026): una hipótesis nace cuando la
evidencia reunida ya da para certeza baja (dos cohortes distintas, o un
efecto grande documentado); antes de eso es una idea, no una hipótesis, y no
tiene sentido que el árbol se llene de hipótesis en muy baja. Las ideas que
no llegan al listón se guardan aquí (`investigacion.vivero`), con las
afirmaciones y fuentes que las motivaron, y en cada cierre de iteración la
acumulación de evidencia también las alimenta (`evidencia.acumular_vivero`).
Cuando una llega al listón, nace como hipótesis normal (revisión, novedad,
Killer, torneo) y evoluciona con las demás. Una idea que pasa varias
iteraciones sin ganar nada sale del vivero con su motivo. Las hipótesis que
escribe una persona no pasan por aquí: las decide ella.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import certeza as CERTEZA
from rosa import politicas
from rosa.estado import acciones as A
from rosa.estado import plantilla as P


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower()).strip()


def como_hipotesis(s: dict[str, Any]) -> dict[str, Any]:
    """La semilla con la forma mínima de hipótesis que entienden el techo de
    certeza y la acumulación de evidencia."""
    return {"id": s["id"], "investigacionId": s["investigacionId"], "titulo": s["titulo"], "enunciado": s["enunciado"], "afirmaciones": s["afirmaciones"], "procedencia": {"fuentes": s["fuentes"]}, "estado": "vivero", "elo": 0}


def falta_de(s: dict[str, Any]) -> str:
    pasos = CERTEZA.escalera(como_hipotesis(s), "muy_baja")
    return pasos[0]["falta"] if pasos else ""


def _campo(hp: Any, nombre: str, defecto: Any = "") -> Any:
    v = getattr(hp, nombre, None)
    return defecto if v is None else v


def nueva_semilla(investigacion_id: str, iteracion: int, ahora: int, hp: Any, afirmaciones: list[dict[str, Any]], fuentes: list[dict[str, Any]], motivo: str, corrida_id: str | None = None) -> dict[str, Any]:
    """Una propuesta del generador convertida en semilla, con todo lo que hará
    falta para nacer después sin volver a llamar al modelo."""
    s = {
        "id": P.nuevo_id("sem"),
        "investigacionId": investigacion_id,
        "titulo": str(_campo(hp, "titulo")).strip(),
        "enunciado": str(_campo(hp, "enunciado")).strip(),
        "mecanismo": str(_campo(hp, "mecanismo")).strip(),
        "comprobacion": {"biomarcador": _campo(hp, "biomarcador"), "cohorte": _campo(hp, "cohorte"), "diseno": _campo(hp, "diseno")},
        "cluster": _campo(hp, "cluster") or "Sin cluster",
        "justificacion": _campo(hp, "justificacion"),
        "supuestos": [str(x) for x in list(_campo(hp, "supuestos", []))[:8]],
        "entidadesNovedad": [str(x) for x in list(_campo(hp, "entidades_novedad", []))[:6]],
        "derivadaDe": _campo(hp, "derivada_de", None) or None,
        "tarjeta": {
            "diana": str(_campo(hp, "diana")).strip(), "celula": str(_campo(hp, "celula")).strip(), "etapa": str(_campo(hp, "etapa")).strip(), "intervencion": str(_campo(hp, "intervencion")).strip(),
            "direccion": _campo(hp, "direccion") or "sin_intervencion", "prediccionFalsable": str(_campo(hp, "prediccion_falsable")).strip(),
            "riesgos": [r.strip() for r in list(_campo(hp, "riesgos", [])) if str(r).strip()][:6], "pasoRuta": _campo(hp, "paso_ruta", "mecanismo") or "mecanismo",
        },
        "afirmaciones": list(afirmaciones),
        "fuentes": list(fuentes),
        "creadaEn": ahora,
        "actualizadaEn": ahora,
        "iteracion": iteracion,
        "corridaOrigen": corrida_id,
        "motivo": motivo,
        "falta": "",
        "historial": [f"Iteración {iteracion}: propuesta con {len(afirmaciones)} afirmaciones de {len(fuentes)} fuentes; {motivo}"],
    }
    s["falta"] = falta_de(s)
    return s


def titulos(inv: dict[str, Any]) -> set[str]:
    """Títulos del vivero y de las ideas retiradas: ninguno se vuelve a proponer igual."""
    return {_norm(s["titulo"]) for s in (inv.get("vivero") or []) + (inv.get("viveroRetiradas") or [])}


def anadir(e: dict[str, Any], investigacion_id: str, semilla: dict[str, Any], ahora: int) -> bool:
    """Reducer: mete la semilla en el vivero de la investigación (sin repetir
    título), respeta el tope retirando la más antigua sin progreso, y deja
    evento."""
    inv = next((i for i in e["investigaciones"] if i["id"] == investigacion_id), None)
    if inv is None:
        return False
    vivero = inv.setdefault("vivero", [])
    if _norm(semilla["titulo"]) in {_norm(x["titulo"]) for x in vivero}:
        return False
    vivero.append(semilla)
    intentos = 0
    while len(vivero) > politicas.MAX_VIVERO and intentos < 100:
        intentos += 1
        vieja = min(vivero, key=lambda x: x.get("actualizadaEn") or 0)
        if not retirar(e, vieja, f"el vivero está lleno ({politicas.MAX_VIVERO}) y era la idea con más tiempo sin evidencia nueva", ahora):
            break
    A.con_evento(e, investigacion_id, "vivero", f"Idea al vivero (todavía no nace como hipótesis): {semilla['titulo'][:80]}. Le falta: {semilla['falta'][:160]}", f"#/investigaciones/{investigacion_id}/hipotesis", ahora)
    return True


def retirar(e: dict[str, Any], semilla: dict[str, Any], motivo: str, ahora: int) -> bool:
    inv = next((i for i in e["investigaciones"] if i["id"] == semilla["investigacionId"]), None)
    if inv is None:
        return False
    vivero = inv.setdefault("vivero", [])
    antes = len(vivero)
    # En el sitio: quien tenga la lista en la mano (anadir, al aplicar el tope) ve el cambio.
    vivero[:] = [x for x in vivero if x["id"] != semilla["id"]]
    if len(vivero) == antes:
        return False
    # Memoria de retiradas: para no reproponer la misma idea y gastar otras seis iteraciones.
    retiradas = inv.setdefault("viveroRetiradas", [])
    retiradas.append({"id": semilla["id"], "titulo": semilla["titulo"], "enunciado": semilla.get("enunciado", "")[:400], "motivo": motivo[:200], "iteracion": semilla.get("iteracion"), "retiradaEn": ahora})
    if len(retiradas) > 40:
        del retiradas[: len(retiradas) - 40]
    A.con_evento(e, inv["id"], "vivero", f"Sale del vivero sin nacer: {semilla['titulo'][:80]}. Motivo: {motivo[:160]}", f"#/investigaciones/{inv['id']}/hipotesis", ahora)
    return True


def nacer(e: dict[str, Any], semilla: dict[str, Any], iteracion: int, ahora: int, corrida_id: str | None = None) -> dict[str, Any]:
    """Reducer: la semilla nace como hipótesis de ROSA2018 (propuesta, con revisión
    pedida para que el siguiente paso de hipótesis la revise y compruebe su
    novedad) y sale del vivero."""
    afirmaciones = list(semilla["afirmaciones"])
    derivada = semilla.get("derivadaDe") if semilla.get("derivadaDe") and any(h["id"] == semilla.get("derivadaDe") for h in e["hipotesis"]) else None
    h = P.nueva_hipotesis(
        semilla["investigacionId"], iteracion, ahora,
        titulo=semilla["titulo"], enunciado=semilla["enunciado"], mecanismo=semilla["mecanismo"],
        comprobacion=dict(semilla["comprobacion"]), cluster=semilla.get("cluster") or "Sin cluster",
        relevancia={"justificacion": semilla.get("justificacion", ""), "votoHumano": None},
        afirmaciones=afirmaciones,
        supuestos=[{"id": P.nuevo_id("sup"), "texto": s, "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": []} for s in semilla.get("supuestos", [])[:8]],
        derivadaDe=derivada,
        evidenciaEstadistica="moderada" if any(a.get("tipo") == "dato" for a in afirmaciones) else "no_aplica",
        coste={"literatura": round(len(afirmaciones) * 0.15, 2), "analisis": 0},
        tarjeta=dict(semilla.get("tarjeta") or {}),
    )
    cohortes = CERTEZA.cohortes_distintas(como_hipotesis(semilla))
    h["procedencia"] = P.procedencia_vacia(
        f"Nacida del vivero en la iteración {iteracion}: propuesta en la iteración {semilla['iteracion']} y guardada porque {semilla.get('motivo', 'no llegaba a certeza baja')}; nace con {len(afirmaciones)} afirmaciones de {len(semilla['fuentes'])} fuentes y {len(cohortes)} cohortes distintas ({', '.join(cohortes)}). Supuestos y novedad se comprueban a continuación.",
        ahora, codigo="vivero.nacer(semilla)", registro=list(semilla.get("historial", [])) + [f"iteración {iteracion}: nace del vivero -> {semilla['titulo'][:60]}"],
    )
    h["procedencia"]["fuentes"] = list(semilla["fuentes"])
    h["_entidades"] = list(semilla.get("entidadesNovedad", []))[:6]
    h["_corridaOrigen"] = corrida_id or semilla.get("corridaOrigen")
    if semilla.get("enfoque"):
        h["enfoque"] = semilla["enfoque"]  # de qué enfoque del equipo salió (rosa/metodo.py)
    h["_revisionPedida"] = True
    e["hipotesis"].append(h)
    inv = next((i for i in e["investigaciones"] if i["id"] == semilla["investigacionId"]), None)
    if inv is not None:
        vivero = inv.setdefault("vivero", [])
        vivero[:] = [x for x in vivero if x["id"] != semilla["id"]]
    A.con_evento(e, semilla["investigacionId"], "hipotesis_nueva", f"Nace del vivero con evidencia de {len(cohortes)} cohortes: {h['titulo'][:80]}", f"#/investigaciones/{semilla['investigacionId']}/hipotesis/{h['id']}", ahora)
    return h
