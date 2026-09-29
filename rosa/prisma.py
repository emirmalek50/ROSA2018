"""Exportacion del flujo de busqueda de una corrida en formato PRISMA 2020.

Lo que existe de verdad (comprobado el 14 de septiembre de 2026):
  PRISMA 2020 (Page y otros, BMJ 2021;372:n71): 27 items; los que un sistema
    automatico puede rellenar son el 6 (fuentes con fecha de la ultima
    busqueda), 7 (estrategias completas), 8 (proceso de seleccion, con las
    herramientas de automatizacion), 16a (flujo, con diagrama) y 16b (los
    excluidos y por que).
  El diagrama de flujo oficial tiene sus variables con nombre en el paquete R
    PRISMA2020 (inst/extdata/PRISMA.csv): database_results, register_results,
    duplicates, excluded_automatic, records_screened, records_excluded,
    dbr_sought_reports, dbr_notretrieved_reports, dbr_assessed, dbr_excluded,
    new_studies, new_reports, ... Es la representacion estructurada mas
    cercana a un "JSON oficial", asi que se usan esos nombres.
  PRISMA-LSR (Akl y otros, BMJ 2024): la extension para revisiones vivas,
    items L1 a L4 (calendario, cambios de metodos, cambios de resultados,
    autores por version).
  PRISMA-trAIce (Holst y otros, JMIR AI 2025): propuesta, no endosada por el
    ejecutivo PRISMA, para declarar la IA usada: nombre y version del modelo,
    prompts, umbrales de clasificacion, proporcion revisada por personas y
    acuerdo con ellas. Es lo mas cercano al "item 8b" que circula en algunos
    resumenes: PRISMA 2026 no existe como declaracion publicada y aqui no se
    inventa.

Todo sale del estado sin llamar a ningun modelo.
"""

from __future__ import annotations

import hashlib
import inspect
import json
from datetime import datetime, timezone
from typing import Any

from rosa import politicas
from rosa import version as VERSION

BASES_REGISTRO = ("ClinicalTrials.gov", "clinicaltrials", "ensayos")


def _fecha(ms: int | None) -> str:
    if not ms:
        return "sin fecha"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def flujo_prisma2020(corrida: dict[str, Any], fuentes: dict[str, dict[str, Any]], hipotesis: list[dict[str, Any]]) -> dict[str, Any]:
    """Las cajas del diagrama de flujo PRISMA 2020 con los nombres del paquete
    oficial. ROSA2018 no hace busqueda manual ni "otros metodos": esas cajas van a
    cero. El cribado lo hace un modelo, asi que `records_excluded` es tambien
    lo que excluyo una herramienta automatica (lo declara trAIce R1)."""
    b = corrida.get("busqueda", {})
    consultas = b.get("consultas", [])
    en_registros = sum(int(q.get("resultados") or 0) for q in consultas if any(r.lower() in str(q.get("base", "")).lower() for r in BASES_REGISTRO))
    en_bases = sum(int(q.get("resultados") or 0) for q in consultas) - en_registros
    traidos = int(b.get("traidos") or 0) or len(fuentes)
    excluidos = list(b.get("excluidos") or [])
    cribadas_ok = int(b.get("cribados") or 0)
    duplicados = max(0, sum(int(q.get("traidos") or 0) for q in consultas) - traidos) if any("traidos" in q for q in consultas) else 0
    leidas = [f for f in fuentes.values() if f.get("extraida")]
    con_texto = [f for f in fuentes.values() if f.get("textoCompleto")]
    retractadas = [f for f in fuentes.values() if f.get("retraccion") == "retractado"]
    usadas_ids = {fu["id"] for h in hipotesis if h.get("investigacionId") == corrida.get("investigacionId") for fu in (h.get("procedencia") or {}).get("fuentes", [])}
    usadas = [f for f in fuentes.values() if f["id"] in usadas_ids]
    no_usadas = [f for f in leidas if f["id"] not in usadas_ids]
    return {
        "previous_studies": 0,
        "previous_reports": 0,
        "database_results": en_bases,
        "register_results": en_registros,
        "website_results": 0,
        "organisation_results": 0,
        "citations_results": 0,
        "duplicates": duplicados,
        "excluded_automatic": 0,
        "excluded_other": len(retractadas),
        "records_screened": traidos,
        "records_excluded": max(0, traidos - cribadas_ok),
        "dbr_sought_reports": cribadas_ok,
        "dbr_notretrieved_reports": max(0, cribadas_ok - len(leidas)),
        "other_sought_reports": 0,
        "other_notretrieved_reports": 0,
        "dbr_assessed": len(leidas),
        "dbr_excluded": {"sin afirmaciones usadas en ninguna hipótesis": len(no_usadas)} if no_usadas else {},
        "other_assessed": 0,
        "other_excluded": {},
        "new_studies": len(usadas),
        "new_reports": len(usadas),
        "total_studies": len(usadas),
        "total_reports": len(usadas),
        "_notas": {
            "records_excluded_por_automatizacion": "El cribado por relevancia lo hace un modelo de lenguaje (ver traIce); todos los excluidos en esa caja los excluyo la herramienta automática.",
            "excluded_other": "Fuentes retractadas según Crossref, apartadas antes de leerlas.",
            "textoCompleto": len(con_texto),
            "excluidosConMotivo": len(excluidos),
        },
    }


def _hash_prompt(cls: Any) -> str:
    try:
        texto = inspect.getdoc(cls) or ""
        campos = "|".join(sorted(getattr(cls, "model_fields", {}).keys())) if hasattr(cls, "model_fields") else ""
        return hashlib.sha256((texto + campos).encode("utf-8")).hexdigest()[:12]
    except Exception:  # noqa: BLE001
        return "?"


def informe(e: dict[str, Any], corrida: dict[str, Any], llamadas: list[dict[str, Any]], ahora: int) -> dict[str, Any]:
    """Flujo, ítems rellenables, extensión viva y declaración de IA, más el
    Markdown listo para pegar en un manuscrito."""
    from rosa import acuerdo_dorado as ACU
    from rosa.modulos import firmas as F

    inv = next((i for i in e["investigaciones"] if i["id"] == corrida["investigacionId"]), {}) or {}
    fuentes = corrida.get("_fuentes", {}) or {}
    b = corrida.get("busqueda", {})
    consultas = b.get("consultas", [])
    flujo = flujo_prisma2020(corrida, fuentes, e.get("hipotesis", []))
    por_base: dict[str, dict[str, Any]] = {}
    for q in consultas:
        x = por_base.setdefault(q.get("base", "?"), {"consultas": 0, "resultados": 0, "ultima": None})
        x["consultas"] += 1
        x["resultados"] += int(q.get("resultados") or 0)
        x["ultima"] = max(x["ultima"] or 0, int(q.get("fecha") or 0)) or None
    excluidos = list(b.get("excluidos") or [])
    modelos_cribado = sorted({str(l.get("modelo")) for l in llamadas if l.get("rol") == "volumen" and l.get("modelo")})
    modelos_juez = sorted({str(l.get("modelo")) for l in llamadas if l.get("rol") == "juez" and l.get("modelo")})
    decisiones = [d for d in e.get("decisiones", []) if any(h["id"] == d.get("hipotesisId") and h.get("investigacionId") == inv.get("id") for h in e.get("hipotesis", []))]
    de_killer = [d for d in decisiones if str(d.get("etapa", "")).startswith("killer")]
    de_persona = [d for d in decisiones if d.get("etapa") == "persona"]
    acuerdo = ACU.acuerdo_dorado(e)
    arnes = corrida.get("arnes") or VERSION.arnes()
    hubo_amplitud = any(q.get("modo") == "amplitud" for q in consultas)
    items = {
        "6_fuentes_de_informacion": [{"base": base, "consultas": x["consultas"], "resultados": x["resultados"], "ultimaBusqueda": _fecha(x["ultima"])} for base, x in sorted(por_base.items())],
        "7_estrategias_de_busqueda": [{"base": q.get("base"), "consulta": q.get("consulta"), "fecha": _fecha(q.get("fecha")), "resultados": q.get("resultados"), "iteracion": q.get("iteracion"), "tema": q.get("tema"), "modo": q.get("modo") or "foco"} for q in consultas],
        "8_proceso_de_seleccion": {
            "quienCriba": "Un modelo de lenguaje (rol volumen) puntua de 0 a 10 cada título y resumen frente a las preguntas abiertas; se conserva lo que llega al umbral. Ninguna persona criba registro a registro; las personas revisan las hipótesis y sus afirmaciones después.",
            "revisoresIndependientes": 0,
            "herramientasAutomatizacion": [f"ROSA2018 {arnes.get('commit') if isinstance(arnes, dict) else ''} (cribado por relevancia con {', '.join(modelos_cribado) or 'modelo de volumen'}; umbral {politicas.RELEVANCIA_MINIMA} de 10{' en foco y ' + str(politicas.RELEVANCIA_MINIMA_AMPLITUD) + ' de 10 en las consultas de amplitud, que se puntúan con la firma PuntuarRelevanciaAmplitud' if hubo_amplitud else ''})"],
        },
        "16a_flujo": flujo,
        "16b_excluidos_con_motivo": excluidos[:300],
    }
    vigila = inv.get("vigilarLiteraturaHasta")
    lsr = {
        "esRevisionViva": bool(vigila and vigila > ahora),
        "L1_calendario": ("ROSA2018 vuelve a buscar en cada iteración de la corrida y, al cerrarla, vigila la literatura hasta " + _fecha(vigila)) if vigila else "Sin vigilancia programada: la búsqueda se repite en cada iteración mientras la corrida está viva.",
        "L2_cambios_de_metodos": [c for c in e.get("aprendizaje", []) if c.get("investigacionId") == inv.get("id") and c.get("nivel", 0) >= 2][-10:],
        "L3_cambios_de_resultados": {"iteraciones": len([it for it in e.get("iteraciones", []) if it.get("corridaId") == corrida["id"]]), "hechosNuevosUltimaIteracion": None},
        "L4_autores_por_version": {"personas": inv.get("revisores", []), "sistema": arnes},
    }
    traice = {
        "referencia": "PRISMA-trAIce (Holst y otros, JMIR AI 2025;4:e80247), propuesta no endosada por el ejecutivo PRISMA; se rellena por transparencia",
        "M2_modelos": {"cribado": modelos_cribado, "verificacion_y_killer": modelos_juez, "accesoPor": "AI Gateway de Vercel (endpoint compatible con OpenAI)", "versionDeRosa": arnes},
        "M4_entrenamiento": "Modelos comerciales; datos de entrenamiento no públicos. ROSA2018 no los ajusta; solo optimiza sus prompts con GEPA y registra cada compilación.",
        "M6_prompts": {"cribado": {"firma": "PuntuarRelevancia", "hash": _hash_prompt(F.PuntuarRelevancia)}, "cribado_amplitud": {"firma": "PuntuarRelevanciaAmplitud", "hash": _hash_prompt(getattr(F, "PuntuarRelevanciaAmplitud", None))}, "verificacion": {"firma": "JuzgarAfirmacion", "hash": _hash_prompt(getattr(F, "JuzgarAfirmacion", None))}, "killer": {"firma": "MatarHipotesis", "hash": _hash_prompt(F.MatarHipotesis)}, "nota": "El texto completo de cada firma está en rosa/módulos/firmas.py en el commit indicado; el hash identifica la versión."},
        "M7_umbrales": {"relevanciaMinima": politicas.RELEVANCIA_MINIMA, "relevanciaMinimaAmplitud": politicas.RELEVANCIA_MINIMA_AMPLITUD, "escala": "0 a 10", "nota": "Las consultas de amplitud exploran fuera de la pregunta y se puntúan con otra pregunta (qué podría cambiar); su listón es un punto más bajo"},
        "M8_revision_humana": {"decisionesDelKiller": len(de_killer), "decisionesDePersonas": len(de_persona), "proporcionRevisadaPorPersonas": round(len(de_persona) / len(de_killer), 3) if de_killer else None, "descartesAuditadosPorOtroModelo": politicas.FRACCION_DESCARTES_AUDITADOS},
        # El kappa solo se publica si hay etiquetas bastantes. Un kappa de 1,0
        # sobre dos etiquetas salía tal cual al informe y al Markdown que se
        # pega en un manuscrito, con la interpretación "casi perfecto"
        # (28 de septiembre de 2026). Eso no es acuerdo casi perfecto: no es
        # nada, y en un manuscrito es una afirmación falsa con nombre propio.
        "M9_acuerdo_con_personas": {"conjuntoDorado": acuerdo.get("casos", 0), "kappaGlobal": (acuerdo.get("global") or {}).get("kappa") if (acuerdo.get("global") or {}).get("suficiente") else None, "suficiente": bool((acuerdo.get("global") or {}).get("suficiente")), "minimoCasos": ACU.MINIMO_CASOS, "porComprobacion": {k: (v.get("kappa") if v.get("suficiente") else None) for k, v in (acuerdo.get("porComprobacion") or {}).items()}},
        "R1_flujo_distingue_ia_y_humano": "En el flujo, records_excluded son exclusiones de la herramienta automática; las personas no excluyen registros, deciden sobre hipótesis.",
    }
    md = _markdown(inv, corrida, flujo, items, lsr, traice, ahora)
    return {"prisma": "2020", "generadoEn": ahora, "corridaId": corrida["id"], "investigacionId": inv.get("id"), "flujo": flujo, "items": items, "lsr": lsr, "traIce": traice, "markdown": md}


def _markdown(inv: dict[str, Any], corrida: dict[str, Any], flujo: dict[str, Any], items: dict[str, Any], lsr: dict[str, Any], traice: dict[str, Any], ahora: int) -> str:
    L = [f"# Flujo de búsqueda PRISMA 2020: {inv.get('titulo', '')}", "", f"Corrida {corrida['id']}, generado el {_fecha(ahora)} por ROSA2018 desde su registro (sin ningún modelo). PRISMA 2020 (Page y otros, BMJ 2021); revisiones vivas según PRISMA-LSR (BMJ 2024); declaración de IA según la propuesta PRISMA-trAIce (JMIR AI 2025).", ""]
    L += ["## Ítem 6. Fuentes de información y fecha de la última búsqueda", ""]
    L += [f"- {x['base']}: {x['consultas']} consultas, {x['resultados']} registros, última búsqueda {x['ultimaBusqueda']}" for x in items["6_fuentes_de_informacion"]] or ["- Sin consultas registradas"]
    L += ["", "## Ítem 7. Estrategias de búsqueda completas", ""]
    L += [f"- [{q['fecha']}] {q['base']}: `{q['consulta']}` ({q['resultados']} resultados; iteración {q['iteracion']}, tema: {q['tema']})" for q in items["7_estrategias_de_busqueda"]] or ["- Ninguna"]
    L += ["", "## Ítem 8. Proceso de selección", "", items["8_proceso_de_seleccion"]["quienCriba"], "", "Herramientas de automatización: " + "; ".join(items["8_proceso_de_seleccion"]["herramientasAutomatizacion"])]
    L += ["", "## Ítem 16a. Flujo (variables del diagrama PRISMA 2020)", "", "| Caja | n |", "|---|---|"]
    for k in ("database_results", "register_results", "duplicates", "excluded_other", "records_screened", "records_excluded", "dbr_sought_reports", "dbr_notretrieved_reports", "dbr_assessed", "new_studies"):
        L.append(f"| {k} | {flujo[k]} |")
    if flujo["dbr_excluded"]:
        L += [f"| dbr_excluded: {k} | {v} |" for k, v in flujo["dbr_excluded"].items()]
    L += ["", flujo["_notas"]["records_excluded_por_automatizacion"]]
    L += ["", f"## Ítem 16b. Excluidos en el cribado con motivo ({len(items['16b_excluidos_con_motivo'])})", ""]
    L += [f"- {x.get('referencia', '?')} (relevancia {x.get('relevancia', '?')}/10): {x.get('motivo', '')}" for x in items["16b_excluidos_con_motivo"][:120]] or ["- Ninguno registrado"]
    L += ["", "## Revisión viva (PRISMA-LSR)", "", f"- L1: {lsr['L1_calendario']}", f"- L3: {lsr['L3_cambios_de_resultados']['iteraciones']} iteraciones en esta corrida", f"- L4: personas {', '.join(lsr['L4_autores_por_version']['personas']) or 'sin declarar'}; sistema {json.dumps(lsr['L4_autores_por_version']['sistema'], ensure_ascii=False)}"]
    L += ["", "## Declaración de la IA usada (PRISMA-trAIce)", "", f"- Modelos de cribado: {', '.join(traice['M2_modelos']['cribado']) or 'sin llamadas registradas'}; verificación y Killer: {', '.join(traice['M2_modelos']['verificacion_y_killer']) or 'sin llamadas registradas'}; acceso por {traice['M2_modelos']['accesoPor']}", f"- Prompts: {json.dumps(traice['M6_prompts'], ensure_ascii=False)}", f"- Umbral de inclusión automática: relevancia >= {traice['M7_umbrales']['relevanciaMinima']} de 10", f"- Revisión humana: {traice['M8_revision_humana']['decisionesDePersonas']} decisiones de personas sobre {traice['M8_revision_humana']['decisionesDelKiller']} del Killer; {int(traice['M8_revision_humana']['descartesAuditadosPorOtroModelo'] * 100)} % de los descartes auditados por otro modelo", f"- Acuerdo con personas: " + (f"kappa global {traice['M9_acuerdo_con_personas']['kappaGlobal']} sobre {traice['M9_acuerdo_con_personas']['conjuntoDorado']} etiquetas del conjunto dorado" if traice['M9_acuerdo_con_personas']['suficiente'] else f"sin etiquetas suficientes para dar un kappa ({traice['M9_acuerdo_con_personas']['conjuntoDorado']} de {traice['M9_acuerdo_con_personas']['minimoCasos']} mínimas en el conjunto dorado)"), f"- {traice['R1_flujo_distingue_ia_y_humano']}"]
    return "\n".join(L)
