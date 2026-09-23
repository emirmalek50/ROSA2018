"""Motor causal minimo (plan completo, riesgo 1): un grafo local por hipotesis
con aristas tipadas, y una regla determinista que dice si el efecto que la
hipotesis afirma es identificable con la evidencia que tiene, esta acotado
(faltan supuestos concretos) o queda sin resolver.

Vocabulario. Un grafo causal tiene nodos (la exposicion X, el desenlace Y,
las explicaciones alternativas) y aristas dirigidas "X causa Y". Cada arista
lleva un tipo que dice de donde sale: `supuesto` (lo afirma la hipotesis o
una alternativa, sin dato que lo sostenga), `inferencia_con_evidencia` (hay
afirmaciones sostenidas que lo respaldan) o `base_curada` (relaciones de
consenso del campo, escritas a mano aqui abajo). Identificar un efecto es
poder estimarlo sin que lo confunda otra causa: las tres amenazas clasicas
son la causa inversa (Y causa X), el confusor (una causa comun de X y Y) y el
artefacto de medida. Un ensayo aleatorizado las cierra por diseno; sin el,
hacen falta temporalidad, ajuste por confusores y replicacion independiente.
"""

from __future__ import annotations

import re
from typing import Any

TIPOS_ARISTA = ("supuesto", "inferencia_con_evidencia", "base_curada")

# La flecha X -> Y de cada hipótesis sale siempre como supuesto (23 de
# septiembre de 2026). Antes pasaba a inferencia_con_evidencia si una
# afirmación sostenida contenía los primeros 12 caracteres de X y de Y: con
# nombres cortos ("GFAP", "NfL") eso es coincidir en nombres, no sostener que
# uno lleva al otro; con los nombres largos de las hipótesis reales no casaba
# nunca, y el texto decía que ninguna afirmación nombraba las dos cosas, cosa
# falsa en 16 de 21 grafos. Qué afirmaciones sostienen la relación es un
# juicio y le toca al juez; el tipo inferencia_con_evidencia queda para él.
CONTEXTO_XY = "Lo que afirma la hipótesis. Queda como supuesto: que una fuente nombre las dos cosas no basta para sostener que una lleva a la otra, y ese juicio todavía no lo hace el juez"

# Relaciones de consenso en la enfermedad de Alzheimer, en lenguaje llano y
# con el marco del que salen. Son contexto para el grafo, no verdad revelada:
# entran como aristas base_curada y se ven como tales.
BASE_CURADA: list[dict[str, str]] = [
    {"de": "APOE4", "a": "amiloide", "contexto": "Portar APOE4 adelanta y aumenta el depósito de amiloide (genética de riesgo; marco ATN de Jack 2018)"},
    {"de": "amiloide", "a": "tau", "contexto": "La patología amiloide precede y facilita la propagación de tau (cascada amiloide; marco ATN)"},
    {"de": "tau", "a": "neurodegeneracion", "contexto": "La tau patológica se asocia a la pérdida neuronal y sináptica (marco ATN, N)"},
    {"de": "neurodegeneracion", "a": "cognicion", "contexto": "La neurodegeneración precede al deterioro cognitivo medible"},
    {"de": "amiloide", "a": "GFAP", "contexto": "El GFAP en plasma sube con la carga amiloide (reactividad astrocitaria)"},
    {"de": "neurodegeneracion", "a": "NfL", "contexto": "El NfL en plasma marca daño axonal, sea cual sea la causa: no es específico de Alzheimer"},
    {"de": "tau", "a": "p-tau181", "contexto": "El p-tau181 en plasma refleja la patología tau y amiloide"},
    {"de": "edad", "a": "amiloide", "contexto": "La edad es la causa común más fuerte de casi todo lo que se mide en Alzheimer"},
    {"de": "edad", "a": "neurodegeneracion", "contexto": "La edad causa pérdida neuronal también sin Alzheimer"},
    {"de": "edad", "a": "NfL", "contexto": "El NfL sube con la edad sin enfermedad"},
    {"de": "edad", "a": "GFAP", "contexto": "El GFAP sube con la edad sin enfermedad"},
    {"de": "funcion renal", "a": "NfL", "contexto": "La función renal cambia las concentraciones plasmáticas de NfL y p-tau"},
    {"de": "funcion renal", "a": "p-tau181", "contexto": "La función renal cambia las concentraciones plasmáticas de NfL y p-tau"},
    {"de": "neuroinflamacion", "a": "GFAP", "contexto": "La activación glial sube el GFAP"},
    {"de": "amiloide", "a": "neuroinflamacion", "contexto": "El amiloide activa microglía y astrocitos"},
]

# Sinonimos para reconocer los nodos de la base en texto libre.
_SINONIMOS: dict[str, str] = {
    r"apoe\s*-?\s*[eε]?4|apoe4|portador": "APOE4",
    r"amiloid|abeta|aβ|a-beta|amyloid|ab42|ab40|placa": "amiloide",
    r"\bp-?tau|ptau|tau fosforil|phospho": "p-tau181",
    r"\btau\b": "tau",
    r"neurodegenera|atrofia|atrophy|perdida neuronal|neuronal loss": "neurodegeneracion",
    r"cognic|cognit|mmse|memoria|memory|demencia|dementia": "cognicion",
    r"\bgfap\b|astrocit": "GFAP",
    r"\bnfl\b|neurofilament": "NfL",
    r"\bedad\b|\bage\b|aging|envejec": "edad",
    r"renal|kidney|egfr|creatinin": "funcion renal",
    r"inflam|microglia|trem2|nlrp3|citoquin|cytokin": "neuroinflamacion",
}

_TEMPORALIDAD = re.compile(r"longitudinal|prospectiv|seguimiento|follow-?up|baseline|preced|antes de|anterior a|years? before|anos antes|trayectoria|serial|seriad", re.I)
_AJUSTE = re.compile(r"ajustad|adjusted|controlled for|controlando|covariat|multivariab|propensity|estratific|stratif", re.I)
_ALEATORIO = re.compile(r"aleatoriz|randomi[sz]|ensayo clinico|clinical trial|\bRCT\b|placebo", re.I)
_GENETICO = re.compile(r"mendelian|mendelian|genetic|genetico|variante|variant|portador|carrier|apoe|trem2|polimorfism|snp\b", re.I)
_REPLICA = re.compile(r"replic|independiente|independent|otra cohorte|another cohort|validat|external", re.I)

_CONFUSOR = re.compile(r"confus|confound|causa comun|common cause|tercera variable|third variable|\bedad\b|\bage\b|comorbilid|comorbid", re.I)
_INVERSA = re.compile(r"invers|reverse|consecuencia|consequence|al reves|epifenomen|epiphenomen", re.I)
_ARTEFACTO = re.compile(r"artefact|artifact|medida|measurement|ensayo|assay|plataforma|platform|lote|batch|preanal", re.I)
_SELECCION = re.compile(r"selecci|selection|supervivencia|survivor|colider|collider|voluntari", re.I)


# Identificador canonico de cada nodo de la base curada (ver rosa/ontologias.py).
CANONICOS: dict[str, str] = {
    "APOE4": "HGNC:613",
    "amiloide": "CHEBI:64645",
    "p-tau181": "HGNC:6893",
    "tau": "HGNC:6893",
    "neurodegeneracion": "MONDO:0005559",
    "cognicion": "GO:0050890",
    "GFAP": "HGNC:4235",
    "NfL": "HGNC:7739",
    "edad": "NCIT:C25150",
    "funcion renal": "UBERON:0002113",
    "neuroinflamacion": "GO:0150076",
}


# Como se escribe cada nodo en la interfaz. El identificador va sin tilde
# (regla del proyecto: los identificadores no llevan), y aqui esta el texto
# para leer. Antes no habia separacion y "función renal" acabo siendo un nodo
# distinto de "funcion renal" segun cuando se calculara el grafo.
ETIQUETAS: dict[str, str] = {
    "amiloide": "amiloide",
    "neurodegeneracion": "neurodegeneración",
    "cognicion": "cognición",
    "neuroinflamacion": "neuroinflamación",
    "funcion renal": "función renal",
}

# En que tramo de la enfermedad cae cada nodo. Ordena las columnas de la
# pantalla de mecanismos, y vive aqui para que la cascada se escriba una sola
# vez: la interfaz la lee del grafo, no la repite.
CAPAS: tuple[str, ...] = ("factores", "patologia", "dano", "marcadores", "desenlace")
CAPA_DE: dict[str, str] = {
    "APOE4": "factores",
    "edad": "factores",
    "funcion renal": "factores",
    "amiloide": "patologia",
    "tau": "patologia",
    "neuroinflamacion": "patologia",
    "neurodegeneracion": "dano",
    "GFAP": "marcadores",
    "p-tau181": "marcadores",
    "NfL": "marcadores",
    "cognicion": "desenlace",
}


def etiqueta_de(nodo: str) -> str:
    """Cómo se escribe un nodo de la base para leerlo."""
    return ETIQUETAS.get(nodo, nodo)


def capa_de(nodo: str) -> str:
    """En que tramo de la cascada cae. "otros" si no es de la base curada."""
    return CAPA_DE.get(nodo, "otros")


def nodos_base_en(texto: str) -> list[str]:
    t = (texto or "").lower()
    return [n for patron, n in _SINONIMOS.items() if re.search(patron, t)]


def _clasificar_alternativa(texto: str) -> str:
    if _INVERSA.search(texto):
        return "causa_inversa"
    if _CONFUSOR.search(texto):
        return "confusor"
    if _SELECCION.search(texto):
        return "seleccion"
    if _ARTEFACTO.search(texto):
        return "artefacto"
    return "otra"


def grafo_local(h: dict[str, Any], alternativas: list[str], independencia_pasa: bool | None, ahora: int) -> dict[str, Any]:
    """El grafo local de una hipótesis y su identificación. Determinista: con
    los mismos textos sale lo mismo, y se puede leer por que."""
    t = h.get("tarjeta") or {}
    comp = h.get("comprobacion") or {}
    x = (t.get("intervencion") or t.get("diana") or "").strip()
    y = (comp.get("biomarcador") or h.get("biomarcador") or "").strip()
    if not y and t.get("prediccionFalsable"):
        y = t["prediccionFalsable"].strip()[:60]
    afs = [a for a in h.get("afirmaciones", []) if a.get("veredicto") in ("sostenida", "parcial")]
    textos = " ".join(a.get("texto", "") + " " + (a.get("fragmento") or "") for a in afs)
    enunciado = (h.get("enunciado") or "") + " " + (h.get("titulo") or "")
    nodos: list[dict[str, str]] = []
    aristas: list[dict[str, str]] = []
    if x:
        nodos.append({"id": "X", "etiqueta": x, "rol": "exposicion"})
    if y:
        nodos.append({"id": "Y", "etiqueta": y, "rol": "desenlace"})
    if x and y:
        aristas.append({"de": "X", "a": "Y", "tipo": "supuesto", "contexto": CONTEXTO_XY})
    # Alternativas del Killer como nodos tipados.
    clases: dict[str, list[str]] = {}
    for i, alt in enumerate(alternativas[:4]):
        clase = _clasificar_alternativa(alt)
        nid = f"A{i + 1}"
        nodos.append({"id": nid, "etiqueta": alt.strip()[:160], "rol": f"alternativa_{clase}"})
        clases.setdefault(clase, []).append(alt.strip()[:120])
        if clase == "causa_inversa" and x and y:
            aristas.append({"de": "Y", "a": "X", "tipo": "supuesto", "contexto": "Causa inversa planteada por el Killer"})
        elif clase in ("confusor", "seleccion"):
            for destino in ("X", "Y"):
                if any(n["id"] == destino for n in nodos):
                    aristas.append({"de": nid, "a": destino, "tipo": "supuesto", "contexto": "Causa común planteada por el Killer" if clase == "confusor" else "Sesgo de selección planteado por el Killer"})
        elif clase == "artefacto" and y:
            aristas.append({"de": nid, "a": "Y", "tipo": "supuesto", "contexto": "Artefacto de medida planteado por el Killer"})
    # Base curada: las relaciones de consenso que tocan X o Y, y las causas comunes conocidas.
    by = set(nodos_base_en(y))
    bx = set(nodos_base_en(x)) or (set(nodos_base_en(enunciado)) - by)
    # Descendientes de X en la base: un mediador (amiloide entre APOE4 y GFAP) no es causa comun.
    descendientes: set[str] = set()
    frontera = set(bx)
    while frontera:
        n_ = frontera.pop()
        for r_ in BASE_CURADA:
            if r_["de"] == n_ and r_["a"] not in descendientes:
                descendientes.add(r_["a"])
                frontera.add(r_["a"])
    causas_comunes: list[str] = []
    for r in BASE_CURADA:
        if r["de"] in bx | by or r["a"] in bx | by:
            for n in (r["de"], r["a"]):
                if not any(z["id"] == f"B:{n}" for z in nodos):
                    nodos.append({"id": f"B:{n}", "etiqueta": etiqueta_de(n), "rol": "base", "capa": capa_de(n)})
            aristas.append({"de": f"B:{r['de']}", "a": f"B:{r['a']}", "tipo": "base_curada", "contexto": r["contexto"]})
    for n in {r["de"] for r in BASE_CURADA}:
        hijos = {r["a"] for r in BASE_CURADA if r["de"] == n}
        if bx & hijos and by & hijos and n not in bx | by | descendientes:
            causas_comunes.append(n)
    # Identificacion por regla.
    cumplidos: list[str] = []
    faltantes: list[str] = []
    if not x or not y:
        identificacion = "sin_resolver"
        faltantes.append("La tarjeta no fija " + ("la exposición o intervención" if not x else "el desenlace o biomarcador") + ": sin X y Y no hay efecto que identificar")
    elif _ALEATORIO.search(textos) and t.get("direccion") not in (None, "", "sin_intervencion"):
        identificacion = "identificable"
        cumplidos.append("Hay evidencia de intervención aleatorizada: confusores y causa inversa quedan controlados por diseño")
    else:
        # Temporalidad (contra la causa inversa).
        if _TEMPORALIDAD.search(textos):
            cumplidos.append("Temporalidad: hay evidencia longitudinal o de precedencia de X sobre Y")
        elif _GENETICO.search(x) or ((bx | set(nodos_base_en(enunciado))) & {"APOE4"}):
            cumplidos.append("La exposición es genética: Y no puede causar X (la causa inversa queda excluida)")
        else:
            faltantes.append("Temporalidad: ninguna afirmación sostenida muestra que X se midió antes que Y" + (" (el Killer planteó causa inversa)" if "causa_inversa" in clases else ""))
        # Confusores (los del Killer y las causas comunes de la base).
        nombrados = clases.get("confusor", []) + [f"causa común conocida: {c}" for c in causas_comunes]
        if _AJUSTE.search(textos):
            cumplidos.append("Ajuste por confusores: la evidencia declara ajuste o estratificación por covariables" + (f"; confusores planteados: {'; '.join(nombrados)[:200]}" if nombrados else ""))
        else:
            faltantes.append("Ajuste por confusores: la evidencia no declara ajuste por " + ("; ".join(nombrados)[:200] if nombrados else "posibles causas comunes"))
        # Artefacto y seleccion (replicacion independiente).
        if independencia_pasa or _REPLICA.search(textos):
            cumplidos.append("Replicación independiente: el efecto se vio en más de una cohorte o plataforma")
        else:
            faltantes.append("Replicación independiente: sin cohorte independiente no se separa el efecto de un artefacto de medida o de selección" + (f" ({'; '.join(clases.get('artefacto', []) + clases.get('seleccion', []))[:160]})" if clases.get("artefacto") or clases.get("seleccion") else ""))
        identificacion = "identificable" if not faltantes else ("acotado" if cumplidos else "sin_resolver")
    resumen = {
        "identificable": "El efecto que afirma la hipótesis se puede estimar con la evidencia que tiene, bajo los supuestos listados.",
        "acotado": f"El efecto está acotado: {len(cumplidos)} de {len(cumplidos) + len(faltantes)} supuestos cumplidos; {'falta' if len(faltantes) == 1 else 'faltan'} {len(faltantes)}. Lo que falta es lo que un experimento o un dataset tendría que aportar.",
        "sin_resolver": "No se puede decir nada del efecto causal con lo que hay: faltan los nodos o todos los supuestos.",
    }[identificacion]
    for n in nodos:
        canon = CANONICOS.get(n["etiqueta"])
        if canon is None:
            from rosa import ontologias as ONTO

            ents = ONTO.anotar_curadas(n["etiqueta"])
            canon = ents[0]["id"] if ents else None
        if canon:
            n["idCanonico"] = canon
    return {"nodos": nodos, "aristas": aristas, "identificacion": identificacion, "supuestosCumplidos": cumplidos, "supuestosFaltantes": faltantes, "resumen": resumen, "calculadoEn": ahora}


def relaciones_iniciales() -> list[dict[str, Any]]:
    """Las aristas tipadas del modelo de mundo con las que arranca ROSA2018: la
    base curada, marcada como tal."""
    return [{"id": f"rel-base-{i}", "investigacionId": None, "de": r["de"], "a": r["a"], "tipo": "base_curada", "contexto": r["contexto"], "hipotesisId": None, "actualizadoEn": 0} for i, r in enumerate(BASE_CURADA)]


def signo_de(h: dict[str, Any]) -> str | None:
    """El sentido del efecto X -> Y que afirma la hipótesis: '+' si dice que X
    aumenta Y, '-' si dice que lo disminuye, None si no se puede decir. Sale de
    la tarjeta (dirección de la intervención) y, si no la hay, de las palabras del
    enunciado (regla de rosa/killer.py). Con el signo, dos hipótesis con la misma
    arista y sentidos opuestos se reconocen como incompatibles (rosa/argumentacion.py)."""
    from rosa import argumentacion as ARG

    return ARG.signo_de_hipotesis(h)


def registrar_relacion(e: dict[str, Any], h: dict[str, Any], grafo: dict[str, Any], ahora: int) -> None:
    """La arista X -> Y de la hipotesis entra al modelo de mundo con su tipo
    (supuesto o inferencia con evidencia), una por hipotesis, actualizable."""
    xy = next((a for a in grafo.get("aristas", []) if a["de"] == "X" and a["a"] == "Y"), None)
    ex = next((n["etiqueta"] for n in grafo.get("nodos", []) if n["id"] == "X"), "")
    ey = next((n["etiqueta"] for n in grafo.get("nodos", []) if n["id"] == "Y"), "")
    if not xy or not ex or not ey:
        return
    rels = e.setdefault("relaciones", [])
    existente = next((r for r in rels if r.get("hipotesisId") == h["id"]), None)
    nueva = {"id": existente["id"] if existente else f"rel-{h['id']}", "investigacionId": h["investigacionId"], "de": ex, "a": ey, "tipo": xy["tipo"], "contexto": f"Hipótesis '{h.get('titulo', '')[:80]}' (v{h.get('version', 1)}): {grafo.get('identificacion')}", "hipotesisId": h["id"], "actualizadoEn": ahora, "signo": signo_de(h)}
    if existente:
        existente.update(nueva)
    else:
        rels.append(nueva)
