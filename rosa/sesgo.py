"""Riesgo de sesgo por instrumento validado, dominio por dominio.

La comprobacion `sesgo_evidencia` del Killer era un juicio libre del juez.
Los estudios de 2025 y 2026 que evaluaron modelos de lenguaje haciendo esta
tarea (Nyrhi 2026 en eBioMedicine, Cochrane ESM 2025, PLoS One 2026)
encontraron acuerdo bajo cuando se les pide el juicio directo (kappa de
0,06 a 0,5) y mucho mejor cuando responden las preguntas de senalizacion y
el juicio se deriva por el algoritmo oficial (Huang 2025 en JMIR: 83 % a
nivel de pregunta). Eso es lo que hace este modulo: el modelo responde
preguntas cerradas con una cita, y el veredicto por dominio y global lo pone
una regla escrita aqui, con el instrumento que corresponde al diseno del
estudio.

Instrumentos (dominios y preguntas tomados de los documentos oficiales):
  RoB 2 (Sterne 2019, riskofbias.info) para ensayos aleatorizados.
  ROBINS-I V2 (2025, riskofbias.info), seis dominios, para observacionales.
  QUADAS-2 (Whiting 2011, Bristol) para estudios de exactitud diagnostica.
  ROBIS (Whiting 2016, Bristol) para revisiones sistematicas.
  SYRCLE (Hooijmans 2014) para estudios en animales.
Las preguntas van en ingles (el idioma de los documentos y de casi toda la
literatura) con la etiqueta del dominio en espanol para la interfaz.

Respuestas admitidas: Y (yes), PY (probably yes), PN (probably no), N (no),
NI (no information). Cada respuesta lleva la cita literal que la sostiene o
"sin informacion".
"""

from __future__ import annotations

import re
from typing import Any

RESPUESTAS = ("Y", "PY", "PN", "N", "NI")
JUICIOS = ("bajo", "algunas_dudas", "alto", "no_aplica")

# Una pregunta: id, texto, y si la respuesta "si" indica riesgo (invertida)
# o proteccion (directa).
def _p(id_: str, texto: str, riesgo_si: bool = False) -> dict[str, Any]:
    return {"id": id_, "texto": texto, "riesgoSi": riesgo_si}


INSTRUMENTOS: dict[str, dict[str, Any]] = {
    "rob2": {
        "nombre": "RoB 2",
        "version": "22 de agosto de 2019",
        "fuente": "https://www.riskofbias.info/welcome/rob-2-0-tool",
        "aplica_a": ("ensayo_aleatorizado",),
        "dominios": [
            {"id": "D1", "nombre": "Proceso de aleatorización", "preguntas": [_p("1.1", "Was the allocation sequence random?"), _p("1.2", "Was the allocation sequence concealed until participants were enrolled and assigned to interventions?"), _p("1.3", "Did baseline differences between intervention groups suggest a problem with the randomization process?", True)]},
            {"id": "D2", "nombre": "Desviaciones de la intervención prevista", "preguntas": [_p("2.1", "Were participants aware of their assigned intervention during the trial?", True), _p("2.2", "Were carers and people delivering the interventions aware of participants' assigned intervention during the trial?", True), _p("2.3", "Were there deviations from the intended intervention that arose because of the trial context?", True), _p("2.4", "Were these deviations likely to have affected the outcome?", True), _p("2.6", "Was an appropriate analysis used to estimate the effect of assignment to intervention?")]},
            {"id": "D3", "nombre": "Datos de desenlace faltantes", "preguntas": [_p("3.1", "Were data for this outcome available for all, or nearly all, participants randomized?"), _p("3.2", "Is there evidence that the result was not biased by missing outcome data?"), _p("3.3", "Could missingness in the outcome depend on its true value?", True)]},
            {"id": "D4", "nombre": "Medición del desenlace", "preguntas": [_p("4.1", "Was the method of measuring the outcome inappropriate?", True), _p("4.2", "Could measurement or ascertainment of the outcome have differed between intervention groups?", True), _p("4.3", "Were outcome assessors aware of the intervention received by study participants?", True), _p("4.4", "Could assessment of the outcome have been influenced by knowledge of intervention received?", True)]},
            {"id": "D5", "nombre": "Selección del resultado comunicado", "preguntas": [_p("5.1", "Were the data that produced this result analysed in accordance with a pre-specified analysis plan that was finalized before unblinded outcome data were available for analysis?"), _p("5.2", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain?", True), _p("5.3", "Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?", True)]},
        ],
    },
    "robins_i": {
        "nombre": "ROBINS-I V2",
        "version": "noviembre de 2025",
        "fuente": "https://www.riskofbias.info/welcome/robins-i-v2",
        "aplica_a": ("cohorte", "caso_control", "transversal", "serie_de_casos"),
        "dominios": [
            {"id": "D1", "nombre": "Confusion", "preguntas": [_p("1.1", "Is there potential for confounding of the effect of the exposure or intervention in this study?", True), _p("1.2", "Did the authors use an appropriate analysis method that controlled for all the important confounding domains?"), _p("1.3", "Were confounding domains that were controlled for measured validly and reliably by the variables available in this study?")]},
            {"id": "D2", "nombre": "Selección de participantes", "preguntas": [_p("2.1", "Was selection of participants into the study (or into the analysis) based on participant characteristics observed after the start of exposure?", True), _p("2.2", "Do start of follow-up and start of exposure coincide for most participants?"), _p("2.3", "Were adjustment techniques used that are likely to correct for the presence of selection biases?")]},
            {"id": "D3", "nombre": "Clasificación de la exposición", "preguntas": [_p("3.1", "Were exposure or intervention groups clearly defined?"), _p("3.2", "Was the information used to define exposure groups recorded at the start of the exposure?"), _p("3.3", "Could classification of exposure status have been affected by knowledge of the outcome or risk of the outcome?", True)]},
            {"id": "D4", "nombre": "Datos faltantes", "preguntas": [_p("4.1", "Were outcome data available for all, or nearly all, participants?"), _p("4.2", "Were participants excluded due to missing data on exposure status or confounders?", True), _p("4.3", "Was the proportion of participants and reasons for missing data similar across exposure groups?")]},
            {"id": "D5", "nombre": "Medición del desenlace", "preguntas": [_p("5.1", "Could the outcome measure have been influenced by knowledge of the exposure received?", True), _p("5.2", "Were outcome assessors aware of the exposure received by study participants?", True), _p("5.3", "Were the methods of outcome assessment comparable across exposure groups?")]},
            {"id": "D6", "nombre": "Selección del resultado comunicado", "preguntas": [_p("6.1", "Is the reported effect estimate likely to be selected, on the basis of the results, from multiple outcome measurements within the outcome domain?", True), _p("6.2", "Is the reported effect estimate likely to be selected, on the basis of the results, from multiple analyses of the exposure-outcome relationship?", True), _p("6.3", "Is the reported effect estimate likely to be selected, on the basis of the results, from different subgroups?", True)]},
        ],
    },
    "quadas2": {
        "nombre": "QUADAS-2",
        "version": "2011",
        "fuente": "https://www.bristol.ac.uk/media-library/sites/quadas/migrated/documents/quadas2.pdf",
        "aplica_a": ("diagnostico",),
        "dominios": [
            {"id": "D1", "nombre": "Selección de pacientes", "preguntas": [_p("1.1", "Was a consecutive or random sample of patients enrolled?"), _p("1.2", "Was a case-control design avoided?"), _p("1.3", "Did the study avoid inappropriate exclusions?")]},
            {"id": "D2", "nombre": "Prueba índice", "preguntas": [_p("2.1", "Were the index test results interpreted without knowledge of the results of the reference standard?"), _p("2.2", "If a threshold was used, was it pre-specified?")]},
            {"id": "D3", "nombre": "Estándar de referencia", "preguntas": [_p("3.1", "Is the reference standard likely to correctly classify the target condition?"), _p("3.2", "Were the reference standard results interpreted without knowledge of the results of the index test?")]},
            {"id": "D4", "nombre": "Flujo y tiempos", "preguntas": [_p("4.1", "Was there an appropriate interval between index test and reference standard?"), _p("4.2", "Did all patients receive a reference standard?"), _p("4.3", "Did patients receive the same reference standard?"), _p("4.4", "Were all patients included in the analysis?")]},
        ],
    },
    "robis": {
        "nombre": "ROBIS",
        "version": "1.2",
        "fuente": "https://www.bristol.ac.uk/media-library/sites/social-community-medicine/robis/ROBIS%201.2%20Clean.pdf",
        "aplica_a": ("revision_sistematica",),
        "dominios": [
            {"id": "D1", "nombre": "Criterios de elegibilidad", "preguntas": [_p("1.1", "Did the review adhere to pre-defined objectives and eligibility criteria?"), _p("1.2", "Were the eligibility criteria appropriate for the review question?"), _p("1.3", "Were eligibility criteria unambiguous?"), _p("1.4", "Were all restrictions in eligibility criteria based on study characteristics appropriate?"), _p("1.5", "Were any restrictions in eligibility criteria based on sources of information appropriate?")]},
            {"id": "D2", "nombre": "Identificación y selección de estudios", "preguntas": [_p("2.1", "Did the search include an appropriate range of databases/electronic sources for published and unpublished reports?"), _p("2.2", "Were methods additional to database searching used to identify relevant reports?"), _p("2.3", "Were the terms and structure of the search strategy likely to retrieve as many eligible studies as possible?"), _p("2.4", "Were restrictions based on date, publication format, or language appropriate?"), _p("2.5", "Were efforts made to minimise error in selection of studies?")]},
            {"id": "D3", "nombre": "Recogida de datos y valoración", "preguntas": [_p("3.1", "Were efforts made to minimise error in data collection?"), _p("3.2", "Were sufficient study characteristics available for both review authors and readers to be able to interpret the results?"), _p("3.3", "Were all relevant study results collected for use in the synthesis?"), _p("3.4", "Was risk of bias (or methodological quality) formally assessed using appropriate criteria?"), _p("3.5", "Were efforts made to minimise error in risk of bias assessment?")]},
            {"id": "D4", "nombre": "Síntesis y hallazgos", "preguntas": [_p("4.1", "Did the synthesis include all studies that it should?"), _p("4.2", "Were all pre-defined analyses reported or departures explained?"), _p("4.3", "Was the synthesis appropriate given the nature and similarity in the research questions, study designs and outcomes across included studies?"), _p("4.4", "Was between-study variation (heterogeneity) minimal or addressed in the synthesis?"), _p("4.5", "Were the findings robust, e.g. as demonstrated through funnel plot or sensitivity analyses?"), _p("4.6", "Were biases in primary studies minimal or addressed in the synthesis?")]},
        ],
    },
    "syrcle": {
        "nombre": "SYRCLE RoB",
        "version": "2014",
        "fuente": "https://doi.org/10.1186/1471-2288-14-43",
        "aplica_a": ("preclinico",),
        "dominios": [
            {"id": "D1", "nombre": "Generación de la secuencia", "preguntas": [_p("1", "Was the allocation sequence adequately generated and applied?")]},
            {"id": "D2", "nombre": "Caracteristicas basales", "preguntas": [_p("2", "Were the groups similar at baseline or were they adjusted for confounders in the analysis?")]},
            {"id": "D3", "nombre": "Ocultación de la asignación", "preguntas": [_p("3", "Was the allocation adequately concealed?")]},
            {"id": "D4", "nombre": "Alojamiento aleatorio", "preguntas": [_p("4", "Were the animals randomly housed during the experiment?")]},
            {"id": "D5", "nombre": "Cegamiento de cuidadores e investigadores", "preguntas": [_p("5", "Were the caregivers and/or investigators blinded from knowledge which intervention each animal received during the experiment?")]},
            {"id": "D6", "nombre": "Evaluación aleatoria del desenlace", "preguntas": [_p("6", "Were animals selected at random for outcome assessment?")]},
            {"id": "D7", "nombre": "Cegamiento del evaluador", "preguntas": [_p("7", "Was the outcome assessor blinded?")]},
            {"id": "D8", "nombre": "Datos incompletos", "preguntas": [_p("8", "Were incomplete outcome data adequately addressed?")]},
            {"id": "D9", "nombre": "Comunicación selectiva", "preguntas": [_p("9", "Are reports of the study free of selective outcome reporting?")]},
            {"id": "D10", "nombre": "Otras fuentes de sesgo", "preguntas": [_p("10", "Was the study apparently free of other problems that could result in high risk of bias?")]},
        ],
    },
}

_DIAGNOSTICO = re.compile(r"\b(sensitivit|specificit|AUC|ROC|diagnostic accuracy|area under the curve|positive predictive|negative predictive|cut-?off|cutpoint)\b", re.I)


def instrumento_para(tipo_estudio: str | None, texto: str = "") -> str | None:
    """El instrumento que corresponde al diseño. Un estudio de exactitud
    diagnóstica se reconoce por su vocabulario (sensibilidad, AUC) sea el
    diseño que sea. Revisiones narrativas y "otro" no tienen instrumento."""
    if texto and _DIAGNOSTICO.search(texto) and tipo_estudio not in ("revision_sistematica", "preclinico", "in_vitro"):
        return "quadas2"
    for clave, ins in INSTRUMENTOS.items():
        if tipo_estudio in ins["aplica_a"]:
            return clave
    return None


def preguntas_de(clave: str) -> list[dict[str, str]]:
    """Lista plana de preguntas para el prompt: [{id, dominio, texto}]."""
    ins = INSTRUMENTOS[clave]
    return [{"id": p["id"], "dominio": d["id"], "texto": p["texto"]} for d in ins["dominios"] for p in d["preguntas"]]


def texto_preguntas(clave: str) -> str:
    ins = INSTRUMENTOS[clave]
    lineas = [f"Instrumento: {ins['nombre']} ({ins['version']}). Responde cada pregunta con Y, PY, PN, N o NI y la cita literal del texto que lo sostiene."]
    for d in ins["dominios"]:
        lineas.append(f"Dominio {d['id']} ({d['nombre']}):")
        lineas += [f"  {p['id']}. {p['texto']}" for p in d["preguntas"]]
    return "\n".join(lineas)


def _normalizar(respuesta: str) -> str:
    r = (respuesta or "").strip().upper().replace(".", "")
    alias = {"YES": "Y", "SI": "Y", "PROBABLY YES": "PY", "PROBABLEMENTE SI": "PY", "NO": "N", "PROBABLY NO": "PN", "PROBABLEMENTE NO": "PN", "NO INFORMATION": "NI", "SIN INFORMACIÓN": "NI", "NA": "NI", "N/A": "NI"}
    r = alias.get(r, r)
    return r if r in RESPUESTAS else "NI"


def juzgar_dominio(dominio: dict[str, Any], respuestas: dict[str, str]) -> tuple[str, str]:
    """Regla comun a los instrumentos (una version explicita y conservadora
    de los algoritmos oficiales): cada pregunta cuenta como "protege" cuando
    su respuesta va en el sentido de bajo riesgo, "expone" cuando va en el de
    alto riesgo, y "sin informacion" si NI. Bajo: todas protegen. Alto: alguna
    expone con seguridad (Y/N seco) o mas de la mitad exponen. Algunas dudas:
    lo demas (incluye lo que no se sabe).

    El codigo dice ahora lo mismo que esta linea. Hasta el 28 de septiembre de
    2026 el umbral era `exponen >= 1.5` con las seguras sumando 1,5, asi que
    DOS respuestas "probablemente" tambien lo alcanzaban y salia "alto"."""
    protegen = exponen = sin_info = seguros = 0
    detalle = []
    for p in dominio["preguntas"]:
        r = _normalizar(respuestas.get(p["id"], "NI"))
        if r == "NI":
            sin_info += 1
            continue
        si = r in ("Y", "PY")
        expone = si if p["riesgoSi"] else not si
        seguro = r in ("Y", "N")
        if expone:
            exponen += 1
            detalle.append(f"{p['id']}={r}{' (seguro)' if seguro else ''}")
            if seguro:
                seguros += 1
        else:
            protegen += 1
    total = len(dominio["preguntas"])
    if exponen == 0 and sin_info == 0:
        return "bajo", "todas las preguntas del dominio van en el sentido de bajo riesgo"
    # "Alto" si alguna respuesta SEGURA va en el sentido del riesgo, o si más
    # de la mitad exponen. Antes el umbral era `exponen >= 1.5` con las
    # seguras sumando 1,5 cada una, así que DOS respuestas "probablemente"
    # también llegaban a 1,5 y salía "alto" (28 de septiembre de 2026). Con
    # dos de cinco y ninguna segura, RoB 2 da "algunas dudas", y ROSA2018
    # escribía "riesgo global alto" atribuyéndoselo a un instrumento con
    # nombre. Cascada: peso GRADE 0,5 y `sesgo_evidencia: falla`, que suspende.
    if seguros >= 1 or exponen > total / 2:
        return "alto", "respuestas en el sentido del riesgo: " + ", ".join(detalle)
    return "algunas_dudas", ("respuestas en el sentido del riesgo: " + ", ".join(detalle) + "; " if detalle else "") + (f"{sin_info} preguntas sin información en el texto" if sin_info else "")


def juicio_global(juicios: list[str]) -> str:
    """Regla de RoB 2 (Tabla 3): bajo si todos bajos; alto si alguno alto o si
    hay dudas en varios dominios (aquí, tres o más); algunas dudas en lo demás.
    Trabaja solo con los juicios; `juicio_global_por_dominios` es la que usa
    `evaluar`, porque distingue una duda con respuestas de una duda por falta
    de texto (M-01)."""
    reales = [j for j in juicios if j != "no_aplica"]
    if not reales:
        return "no_aplica"
    if all(j == "bajo" for j in reales):
        return "bajo"
    if any(j == "alto" for j in reales) or sum(1 for j in reales if j == "algunas_dudas") >= 3:
        return "alto"
    return "algunas_dudas"


def dominio_solo_sin_informacion(dominio: dict[str, Any]) -> bool:
    """Un dominio "algunas dudas" cuyo único motivo es que las preguntas no
    tienen respuesta en el texto (ninguna respuesta en el sentido del riesgo).
    Es "sin información", no una duda sobre el estudio."""
    if not isinstance(dominio, dict) or str(dominio.get("juicio") or "").strip().lower() != "algunas_dudas":
        return False
    motivo = str(dominio.get("motivo") or "").lower().replace("ó", "o")
    return "sin informacion" in motivo and "sentido del riesgo" not in motivo


def juicio_global_por_dominios(dominios: list[dict[str, Any]]) -> str:
    """El juicio global leyendo los dominios, no solo sus etiquetas (M-01, 17 de
    septiembre de 2026). Igual que `juicio_global` salvo en una cosa: la
    escalada "tres dominios con dudas suben a alto" solo cuenta las dudas con
    alguna respuesta en el sentido del riesgo; un dominio sin información en
    el texto sigue siendo "algunas dudas" por sí mismo pero no suma para
    escalar. Antes, un juez que no encontraba nada en el texto (todo NI)
    dejaba la fuente en "alto" y el Killer suspendía por sesgo."""
    reales = [d for d in dominios if isinstance(d, dict) and str(d.get("juicio") or "") not in ("", "no_aplica")]
    if not reales:
        return "no_aplica"
    juicios = [str(d.get("juicio")) for d in reales]
    if all(j == "bajo" for j in juicios):
        return "bajo"
    dudas_con_respuestas = sum(1 for d in reales if str(d.get("juicio")) == "algunas_dudas" and not dominio_solo_sin_informacion(d))
    if "alto" in juicios or dudas_con_respuestas >= 3:
        return "alto"
    return "algunas_dudas"


def juicio_util(riesgo: Any) -> tuple[str | None, str]:
    """(juicio que cuenta, motivo) releyendo una evaluación guardada por
    dominios. Es la regla única para el peso GRADE (rosa/certeza.py
    `juicio_sesgo_util` delega aquí) y para la comprobación del Killer
    (`comprobacion_sesgo`):

    - un dominio cuyo motivo es solo "preguntas sin información" no cuenta;
    - si algún dominio informado es "alto", el juicio es "alto";
    - si no, si alguno informado es "algunas dudas", es "algunas dudas" (sin
      escalar a alto por acumulación);
    - si todo lo informado es "bajo" y hay dominios sin información, queda
      sin evaluar (None): ni se penaliza ni se afirma bajo;
    - sin dominios (registro compacto o antiguo), vale el `global` guardado.
    Solo puede rebajar la penalización, nunca subirla."""
    r = riesgo if isinstance(riesgo, dict) else {}
    global_ = str(r.get("global") or "").strip().lower() or None
    dominios = [d for d in (r.get("dominios") if isinstance(r.get("dominios"), (list, tuple)) else []) if isinstance(d, dict) and str(d.get("juicio") or "").strip()]
    conocidos = ("alto", "algunas_dudas", "bajo")
    if not dominios:
        return (global_ if global_ in conocidos else None), (f"juicio global {global_}" if global_ in conocidos else "riesgo de sesgo sin evaluar")
    informados: list[str] = []
    sin_info = 0
    for d in dominios:
        j = str(d.get("juicio") or "").strip().lower()
        if j == "no_aplica":
            continue
        if dominio_solo_sin_informacion(d):
            sin_info += 1
            continue
        informados.append(j)
    if "alto" in informados:
        return "alto", "algún dominio con riesgo alto por respuestas en el sentido del riesgo"
    if "algunas_dudas" in informados:
        return "algunas_dudas", f"algunas dudas en {informados.count('algunas_dudas')} dominios informados" + (f"; {sin_info} dominios sin información no cuentan" if sin_info else "")
    if sin_info:
        return None, f"{sin_info} dominios sin información en el texto y ninguno con riesgo: sin evaluar, no se penaliza"
    return ("bajo" if informados else None), ("todos los dominios informados con riesgo bajo" if informados else "sin dominios informados")


def evaluar(clave: str, respuestas: list[dict[str, str]], modelo: str, ahora: int) -> dict[str, Any]:
    """Del listado de respuestas del modelo ({id, respuesta, cita}) al veredicto
    estructurado que se guarda en la fuente."""
    ins = INSTRUMENTOS[clave]
    por_id = {str(r.get("id", "")).strip(): r for r in respuestas}
    dominios = []
    for d in ins["dominios"]:
        resp = {p["id"]: _normalizar(por_id.get(p["id"], {}).get("respuesta", "NI")) for p in d["preguntas"]}
        juicio, motivo = juzgar_dominio(d, resp)
        dominios.append({
            "id": d["id"],
            "nombre": d["nombre"],
            "juicio": juicio,
            "motivo": motivo,
            "respuestas": [{"id": p["id"], "pregunta": p["texto"], "respuesta": resp[p["id"]], "cita": str(por_id.get(p["id"], {}).get("cita", "") or "")[:300]} for p in d["preguntas"]],
        })
    glob = juicio_global_por_dominios(dominios)
    return {"instrumento": ins["nombre"], "clave": clave, "version": ins["version"], "fuenteInstrumento": ins["fuente"], "modelo": modelo, "fecha": ahora, "dominios": dominios, "global": glob, "resumen": f"{ins['nombre']}: riesgo global {glob.replace('_', ' ')}; " + ", ".join(f"{d['id']} {d['juicio'].replace('_', ' ')}" for d in dominios)}


def comprobacion_sesgo(fuentes: list[dict[str, Any]]) -> dict[str, str]:
    """La comprobacion `sesgo_evidencia` del Killer, por regla, a partir de
    las evaluaciones guardadas en las fuentes primarias de la hipotesis.
    Falla si TODA la evidencia primaria evaluada tiene riesgo alto; pasa si
    alguna fuente primaria tiene riesgo bajo o algunas dudas; no comprobable
    si no hay ninguna evaluada."""
    evaluadas = [f for f in fuentes if isinstance(f, dict) and isinstance(f.get("riesgoSesgo"), dict) and f["riesgoSesgo"].get("global") not in (None, "no_aplica")]
    if not evaluadas:
        return {"comprobacion": "sesgo_evidencia", "resultado": "no_comprobable", "detalle": "Ninguna fuente primaria tiene todavía riesgo de sesgo evaluado por instrumento (RoB 2, ROBINS-I, QUADAS-2, ROBIS, SYRCLE)."}
    # M-01: se relee cada evaluación por dominios con `juicio_util`, la misma regla
    # que el peso GRADE. Una fuente cuyo "alto" viene solo de dominios sin
    # información en el texto no es una fuente sesgada: es una fuente sin evaluar.
    util: dict[str, str | None] = {str(f.get("id")): juicio_util(f["riesgoSesgo"])[0] for f in evaluadas}
    informadas = [f for f in evaluadas if util[str(f.get("id"))] is not None]
    sin_info = len(evaluadas) - len(informadas)
    if not informadas:
        return {"comprobacion": "sesgo_evidencia", "resultado": "no_comprobable", "detalle": f"{len(evaluadas)} fuentes primarias evaluadas por instrumento, pero el texto no daba información para juzgar el sesgo en ninguna: sin evaluar, no cuenta como riesgo alto."}
    cuenta = {"bajo": 0, "algunas_dudas": 0, "alto": 0}
    for f in informadas:
        j = util[str(f.get("id"))] or ""
        cuenta[j] = cuenta.get(j, 0) + 1
    resumen = ", ".join(f"{v} con riesgo {k.replace('_', ' ')}" for k, v in cuenta.items() if v)
    if sin_info:
        resumen += f"; {sin_info} sin información suficiente en el texto, que no cuentan"
    detalle_fuentes = "; ".join(f"{f.get('referencia', f.get('id'))}: {f['riesgoSesgo'].get('instrumento', 'instrumento')} {str(util[str(f.get('id'))] or 'sin información').replace('_', ' ')}" for f in evaluadas[:6])
    if cuenta["alto"] == len(informadas):
        return {"comprobacion": "sesgo_evidencia", "resultado": "falla", "detalle": f"Toda la evidencia primaria evaluada con información ({len(informadas)} fuentes) tiene riesgo de sesgo alto por instrumento: {detalle_fuentes}"}
    return {"comprobacion": "sesgo_evidencia", "resultado": "pasa", "detalle": f"{len(evaluadas)} fuentes primarias evaluadas por instrumento ({resumen}): {detalle_fuentes}"}


def texto_para_grade(fuentes: list[dict[str, Any]]) -> str:
    """Una línea para el juez de la conclusión GRADE: cuantas fuentes con cada
    riesgo, para que el factor 'riesgo de sesgo' salga del instrumento."""
    evaluadas = [f for f in fuentes if isinstance(f.get("riesgoSesgo"), dict) and f["riesgoSesgo"].get("global") not in (None, "no_aplica")]
    if not evaluadas:
        return "Riesgo de sesgo por instrumento: sin evaluar todavía."
    cuenta: dict[str, int] = {}
    for f in evaluadas:
        cuenta[f["riesgoSesgo"]["global"]] = cuenta.get(f["riesgoSesgo"]["global"], 0) + 1
    return "Riesgo de sesgo por instrumento (RoB 2 / ROBINS-I / QUADAS-2 / ROBIS / SYRCLE, veredicto por regla desde las preguntas de senalizacion): " + ", ".join(f"{v} fuentes {k.replace('_', ' ')}" for k, v in cuenta.items()) + "."
