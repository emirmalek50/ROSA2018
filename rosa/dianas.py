"""Perfil de evidencia por diana: una fila por capa, sin puntuación combinada.

Una "diana" es el gen o la proteína que la tarjeta de una hipótesis nombra
(campo `diana` de `TarjetaHipotesis`). Antes de que el Killer o el juez la
juzguen conviene saber qué dicen las bases públicas de ella, capa por capa,
porque cada capa responde a una pregunta distinta y ninguna sustituye a otra:

- `genetica_humana`: ¿la genética humana vincula el gen con el Alzheimer?
  GWAS Catalog (asociaciones de estudios de genoma completo), ClinVar
  (variantes con significado clínico para la enfermedad) y Open Targets
  (asociación por datos genéticos y, cuando la trae, la dirección del efecto).
- `expresion_tejido`: ¿se expresa en tejido cerebral humano? Human Protein
  Atlas (HPA) por tejido y región cerebral, y GTEx (mediana de TPM en un
  tejido) cuando se dispone del identificador GENCODE con versión que GTEx
  exige.
- `expresion_celular`: ¿en qué tipos celulares? HPA de célula única (nCPM por
  tipo celular en todo el cuerpo y por núcleo único en cerebro).
- `proteina_funcion`: ¿qué hace la proteína y con quién actúa? UniProt
  (función revisada), Reactome (rutas curadas) y STRING (interactores).
- `farmacologia`: ¿hay fármacos que la tocan? ChEMBL (mecanismos de acción) y
  DGIdb (interacciones fármaco-gen).
- `literatura`: ¿cuántas publicaciones la relacionan con el Alzheimer?
  PubTator 3 (relaciones extraídas por minería de texto, contadas).

Cada capa queda en uno de tres estados, por regla y con el motivo al lado:

- `presente`: alguna base de la capa respondió y tiene registro.
- `ausente`: todas las bases consultadas de la capa respondieron y ninguna
  tiene nada. Solo entonces.
- `no_pude_comprobar`: alguna base no respondió (o dio error) y ninguna de las
  que respondieron encontró nada; o las que respondieron no traen el dato que
  decide (por ejemplo HPA sin la clave de distribución cerebral). Nunca se
  confunde con ausencia: una fuente que no responde es "no pude comprobar".

No hay puntuación combinada a propósito. Open Targets ya suma sus tipos de
dato en una cifra propia, y sumar capas heterogéneas (una p de GWAS, un nTPM,
un número de fármacos) inventaría un número sin unidad. Las cifras se enseñan
en la fila, no se promedian; la certeza sigue las reglas GRADE de
`rosa/certeza.py`.

La dirección solo existe en la capa genética y sale de Open Targets, que en
las evidencias de `eva` (ClinVar dentro de Open Targets) y de carga génica
trae `directionOnTrait` (riesgo o protección) y `directionOnTarget` (pérdida
o ganancia de función). Se traduce a un signo sobre la función de la diana:
"+" es "más función de la diana, más riesgo" (ganancia con riesgo, o pérdida
con protección); "-" es "menos función de la diana, más riesgo" (pérdida con
riesgo, o ganancia con protección). Si las evidencias discrepan o no traen las
dos direcciones, la dirección es None y el detalle dice por qué. Comprobado
en vivo el 16 de septiembre de 2026 (ABCA7: tres evidencias de ClinVar con
pérdida de función y riesgo).

`consultar` se inyecta para poder probar sin red: los tests pasan una función
asíncrona que devuelve (registro, datos) por nombre de conector, igual que
`rosa.conectores.consultar`.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Awaitable, Callable

from rosa import certeza
from rosa import conectores as CON
from rosa.estado import plantilla as P

Consultar = Callable[..., Awaitable[tuple[dict[str, Any], Any]]]

CAPAS = ("genetica_humana", "expresion_tejido", "expresion_celular", "proteina_funcion", "farmacologia", "literatura")
ESTADOS = ("presente", "ausente", "no_pude_comprobar")
ETIQUETAS_CAPA = {
    "genetica_humana": "Genética humana",
    "expresion_tejido": "Expresión en tejido",
    "expresion_celular": "Expresión por tipo celular",
    "proteina_funcion": "Proteína y función",
    "farmacologia": "Farmacología",
    "literatura": "Literatura",
}
ETIQUETAS_ESTADO = {"presente": "presente", "ausente": "ausente", "no_pude_comprobar": "no pude comprobar"}
ETIQUETAS_DIRECCION = {"+": "+ (más función de la diana, más riesgo)", "-": "- (menos función de la diana, más riesgo)", None: "sin dirección"}
# Qué pregunta responde cada capa, para quien lee la tabla por primera vez.
PREGUNTA_CAPA = {
    "genetica_humana": "¿la genética humana vincula el gen con el Alzheimer?",
    "expresion_tejido": "¿se expresa en tejido cerebral humano?",
    "expresion_celular": "¿en qué tipos celulares se expresa?",
    "proteina_funcion": "¿qué hace la proteína y con quién actúa?",
    "farmacologia": "¿hay fármacos que la tocan?",
    "literatura": "¿cuántas publicaciones la relacionan con el Alzheimer?",
}

ALZHEIMER_MONDO = "MONDO_0004975"
ALZHEIMER_EFO = "EFO_0000249"
ALZHEIMER_PUBTATOR = "@DISEASE_Alzheimer_Disease"
# Fuentes de Open Targets que pueden traer dirección del efecto (las de texto
# minado, como europepmc, nunca la traen y solo abultan la respuesta).
FUENTES_DIRECCION_OT = ["eva", "gene_burden", "ot_genetics_portal", "gwas_credible_sets", "uniprot_literature", "uniprot_variants", "orphanet", "gene2phenotype", "clingen", "genomics_england", "chembl"]
CONSULTA_OT = """
query($id: String!, $enf: [String!]!, $fuentes: [String!]) {
  target(ensemblId: $id) {
    id approvedSymbol
    associatedDiseases(Bs: $enf, page: {index: 0, size: 5}) { count rows { score disease { id name } datatypeScores { id score } } }
    evidences(efoIds: $enf, datasourceIds: $fuentes, size: 500) { count rows { datasourceId directionOnTrait directionOnTarget } }
  }
}
"""
TEJIDO_GTEX_POR_DEFECTO = "Brain_Hippocampus"

# Vocabulario de HPA (versión 24, comprobado en vivo el 16 de septiembre de 2026).
_DETECTADO = ("detected in all", "detected in many", "detected in some", "detected in single")
_NO_DETECTADO = "not detected"
_ESPECIFICIDAD_CELULAR_DETECTADA = ("cell type enriched", "group enriched", "cell type enhanced", "low cell type specificity")
_TIPOS_RELACION_PUBTATOR = {"associate": "asociación", "positive_correlate": "correlación positiva", "negative_correlate": "correlación negativa", "cause": "causa", "treat": "tratamiento", "prevent": "prevención", "inhibit": "inhibición", "stimulate": "estimulación", "interact": "interacción", "cotreat": "cotratamiento", "drug_interact": "interacción con fármaco", "compare": "comparación"}

# Vocabulario de la tarjeta (castellano e inglés) traducido a lo que HPA y
# GTEx nombran. Cada entrada: patrón sobre el texto de la tarjeta, trozos que
# deben aparecer en el nombre de un tipo celular de HPA, trozos que deben
# aparecer en una región o tejido de HPA, tejido de GTEx y si es contexto
# cerebral. La comparación es por subcadena en minúsculas, porque HPA mezcla
# nombres propios ("Microglial cells") con los de Cell Ontology ("central
# nervous system macrophage").
_PATRON_CORTEZA = r"cortez|cortex|cortical"
_CONTEXTOS: tuple[tuple[str, tuple[str, ...], tuple[str, ...], str | None, bool], ...] = (
    (r"microgl", ("microgl", "central nervous system macrophage"), (), None, True),
    (r"astrocit|astrogl|astrocyt", ("astrocyt",), (), None, True),
    (r"oligodendro", ("oligodendro",), (), None, True),
    (r"neuron|neural|sin[áa]p|synap", ("neuron", "neural"), (), None, True),
    (r"endotel|endothel|vascular|barrera hematoencef|blood.brain barrier", ("endothel",), (), None, True),
    (r"pericit|pericyt", ("pericyt",), (), None, True),
    (r"plexo coroideo|choroid", ("choroid",), ("choroid",), None, True),
    (r"hipocamp|hippocamp", (), ("hippocamp",), "Brain_Hippocampus", True),
    (_PATRON_CORTEZA, (), ("cortex", "cortical"), "Brain_Cortex", True),
    (r"am[íi]gdala|amygdala", (), ("amygdala",), "Brain_Amygdala", True),
    (r"cerebel", (), ("cerebell",), "Brain_Cerebellum", True),
    (r"hipot[áa]lamo|hypothalam", (), ("hypothalam",), "Brain_Hypothalamus", True),
    (r"(?<!hipo)t[áa]lamo|(?<!hypo)thalam", (), ("thalam",), None, True),
    (r"ganglios basales|estriado|striat|caudad|caudate|putamen|basal ganglia", (), ("basal ganglia", "striat", "caudate", "putamen"), "Brain_Caudate_basal_ganglia", True),
    (r"sustancia blanca|white matter", (), ("white matter",), None, True),
    (r"cerebr|brain|enc[ée]fal|\bsnc\b|\bcns\b|sistema nervioso|nervous system", (), ("brain",), "Brain_Cortex", True),
    (r"sangre|plasma|suero|blood|serum|leucocit|leukocyt|monocit|monocyt|linfocit|lymphocyt", ("monocyte", "t-cell", "b-cell", "nk-cell", "neutrophil", "lymphocyte", "plasmacytoid"), ("blood",), "Whole_Blood", False),
    (r"h[íi]gado|liver|hepat", ("hepatocyt", "kupffer"), ("liver",), "Liver", False),
)
_CEREBRAL_EN_TEXTO = re.compile(r"cerebr|brain|neuron|neural|sin[áa]p|synap|gl[íi]a|glial|microgl|astrocit|astrocyt|oligodendro|hipocamp|hippocamp|cortez|cortex|cortical|am[íi]gdala|amygdala|cerebel|t[áa]lamo|thalam|enc[ée]fal|sistema nervioso|nervous system", re.I)
# "Corteza" sola no es cerebro: la suprarrenal, la renal, la ovárica y la del
# hueso también se llaman así. Si el texto nombra una de estas, la entrada
# de corteza no cuenta como cerebral (las demás entradas siguen valiendo).
_CORTEZA = re.compile(_PATRON_CORTEZA, re.I)
_CORTEZA_NO_CEREBRAL = re.compile(r"suprarrenal|adrenal|renal|ov[áa]ric|ovarian|[óo]se[ao]\b|bone|hueso|t[íi]mic|thym|linf[áa]tic|lymph", re.I)
_PRECLINICAS = ("preclinico", "in_vitro")


# ---------------------------------------------------------------------------
# Utilidades sin red
# ---------------------------------------------------------------------------


def _norm(x: Any) -> str:
    return str(x or "").strip().lower()


def _texto_id(x: Any) -> str:
    """Un identificador como texto limpio. MyGene devuelve a veces listas
    (varios Ensembl para un símbolo) y los registros antiguos pueden traer
    números: se toma el primer valor no vacío y se convierte a texto. Vacío
    si no hay nada."""
    if isinstance(x, (list, tuple)):
        for v in x:
            t = _texto_id(v)
            if t:
                return t
        return ""
    if x is None or isinstance(x, bool) or isinstance(x, (dict, set)):
        return ""
    return str(x).strip()


def _dict(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _capas_de(perfil: Any) -> list[dict[str, Any]]:
    """Las capas de un perfil como lista de diccionarios; vacía si el perfil
    o sus capas no tienen forma (registro antiguo, tipo equivocado)."""
    capas = _dict(perfil).get("capas")
    if not isinstance(capas, list):
        return []
    return [c for c in capas if isinstance(c, dict)]


def _clave_ci(d: dict[str, Any], nombre: str) -> str | None:
    """La clave de `d` que coincide con `nombre` sin distinguir mayúsculas
    (HPA escribe 'brain' en minúsculas, pero no se depende de ello)."""
    objetivo = nombre.strip().lower()
    for k in d:
        if str(k).strip().lower() == objetivo:
            return k
    return None


def _num(x: Any) -> float | None:
    """HPA manda las cifras como texto ("15929.3"); GTEx como número."""
    try:
        v = float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return v if v == v else None  # NaN fuera


def _entero(x: Any) -> int:
    """Un entero de lo que venga (texto, float, None); 0 si no es una cifra."""
    v = _num(x)
    return int(v) if v is not None else 0


def _dict_num(d: Any) -> dict[str, float]:
    """Un diccionario nombre a cifra, ordenado de mayor a menor; vacío si no
    es un diccionario o no trae cifras."""
    if not isinstance(d, dict):
        return {}
    pares = [(str(k), v) for k, v in ((k, _num(v)) for k, v in d.items()) if v is not None]
    return dict(sorted(pares, key=lambda kv: -kv[1]))


def _fmt(v: float | None, dec: int = 1) -> str:
    if v is None:
        return "?"
    return f"{v:.{dec}f}".rstrip("0").rstrip(".") if dec else f"{v:.0f}"


def _lista(xs: list[str], maximo: int = 3) -> str:
    xs = [x for x in xs if x]
    if not xs:
        return ""
    corte = xs[:maximo]
    return ", ".join(corte) + (f" y {len(xs) - maximo} más" if len(xs) > maximo else "")


def _registro_fallo(nombre: str, argumentos: dict[str, Any], error: str, resumen: str) -> dict[str, Any]:
    """Un registro de consulta con `error`, para cuando ni siquiera se pudo
    llamar al conector (no registrado, excepción del propio `consultar`).
    Misma forma que `rosa.conectores.base.nueva_consulta`."""
    return {"id": P.nuevo_id("con"), "herramienta": nombre, "fuente": "", "argumentos": argumentos, "fecha": P.ahora_ms(), "n": None, "ids": [], "version": None, "invariante": None, "error": error, "ms": 0, "resumen": resumen or nombre}


async def _consulta_segura(consultar: Consultar, nombre: str, resumen: str, **argumentos: Any) -> tuple[dict[str, Any], Any]:
    """Llama al conector y nunca lanza: un fallo de la propia llamada deja un
    registro con `error` y datos None, como hace `consultar` con la fuente."""
    try:
        reg, datos = await consultar(nombre, resumen=resumen, **argumentos)
    except Exception as ex:  # noqa: BLE001
        return _registro_fallo(nombre, argumentos, f"No pude comprobar: {type(ex).__name__}: {str(ex)[:160]}", resumen), None
    if not isinstance(reg, dict):
        reg = _registro_fallo(nombre, argumentos, "No pude comprobar: el conector devolvió un registro sin forma", resumen)
        return reg, None
    return reg, datos


def _fallo(reg: dict[str, Any] | None) -> str | None:
    """El texto del error si la consulta no respondió; None si respondió."""
    if reg is None:
        return None
    err = reg.get("error")
    return str(err) if err else None


def _estado_capa(hallazgos: list[dict[str, str]]) -> tuple[str, str]:
    """La regla de la capa. Cada hallazgo es {fuente, clase, texto} con clase
    en con_datos, vacio, fallo, sin_dato_decisivo o no_consultado.

    - presente si alguna fuente respondió con datos (los fallos se dicen al lado);
    - si nada tiene datos y alguna fuente falló o no trae el dato que decide,
      no_pude_comprobar;
    - ausente solo si todas las consultadas respondieron vacías;
    - si ninguna se consultó, no_pude_comprobar con el motivo."""
    clases = [h["clase"] for h in hallazgos]
    detalle = "; ".join(h["texto"] for h in hallazgos if h.get("texto"))
    if "con_datos" in clases:
        return "presente", detalle
    if "fallo" in clases or "sin_dato_decisivo" in clases:
        return "no_pude_comprobar", detalle
    if "vacio" in clases:
        return "ausente", detalle
    return "no_pude_comprobar", detalle or "Sin fuentes consultadas"


def _hallazgo(fuente: str, clase: str, texto: str) -> dict[str, str]:
    return {"fuente": fuente, "clase": clase, "texto": texto}


def _hallazgo_fallo(fuente: str, reg: dict[str, Any]) -> dict[str, str]:
    return _hallazgo(fuente, "fallo", f"{fuente}: no pude comprobar ({(_fallo(reg) or 'sin respuesta')[:140]})")


def _capa(nombre: str, hallazgos: list[dict[str, str]], fuentes: list[str], registro: list[dict[str, Any]], direccion: str | None = None, datos: dict[str, Any] | None = None) -> dict[str, Any]:
    estado, detalle = _estado_capa(hallazgos)
    return {"capa": nombre, "estado": estado, "detalle": detalle, "direccion": direccion, "fuentes": fuentes, "registro": registro, "datos": datos or {}}


# ---------------------------------------------------------------------------
# Genética humana
# ---------------------------------------------------------------------------


def _direccion_open_targets(filas: list[dict[str, Any]], total: Any = None) -> tuple[str | None, str]:
    """El signo de la relación entre la función de la diana y el riesgo, a
    partir de las evidencias de Open Targets que traen las dos direcciones.
    (signo, motivo). Determinista: cuenta y explica, incluidas las
    evidencias que traen solo una de las dos direcciones (ABCA7 en vivo:
    3 con riesgo y pérdida de función, 9 solo con pérdida de función) y si
    la consulta leyó menos evidencias de las que Open Targets cuenta
    (`total`), porque entonces la dirección sale de una parte."""
    signos: Counter[str] = Counter()
    fuentes: Counter[str] = Counter()
    solo_rasgo: Counter[str] = Counter()
    solo_diana: Counter[str] = Counter()
    leidas = 0
    for r in filas:
        if not isinstance(r, dict):
            continue
        leidas += 1
        rasgo, diana = _norm(r.get("directionOnTrait")), _norm(r.get("directionOnTarget"))
        if rasgo in ("risk", "protect") and diana in ("lof", "gof"):
            mas_funcion_mas_riesgo = (diana == "gof") == (rasgo == "risk")
            signos["+" if mas_funcion_mas_riesgo else "-"] += 1
            fuentes[str(r.get("datasourceId") or "?")] += 1
        elif rasgo in ("risk", "protect"):
            solo_rasgo["riesgo" if rasgo == "risk" else "protección"] += 1
        elif diana in ("lof", "gof"):
            solo_diana["pérdida de función" if diana == "lof" else "ganancia de función"] += 1
    notas = [f"{n} solo con {k} sobre el rasgo, sin dirección sobre la diana" for k, n in solo_rasgo.items()]
    notas += [f"{n} solo con {k} de la diana, sin dirección sobre el rasgo" for k, n in solo_diana.items()]
    n_total = _entero(total)
    if n_total > leidas > 0:
        notas.append(f"se leyeron {leidas} de las {n_total} evidencias que Open Targets cuenta, así que la dirección sale de una parte")
    nota = ("; " + "; ".join(notas)) if notas else ""
    if not signos:
        return None, "sin dirección del efecto: ninguna evidencia trae a la vez dirección sobre el rasgo y sobre la diana" + nota
    if len(signos) == 2:
        return None, f"direcciones discrepantes: {signos['+']} evidencias '+' (más función, más riesgo) y {signos['-']} '-' (menos función, más riesgo)" + nota
    signo = next(iter(signos))
    lectura = "más función de la diana, más riesgo" if signo == "+" else "menos función de la diana, más riesgo"
    return signo, f"{signos[signo]} evidencias con dirección '{signo}' ({lectura}) de " + ", ".join(f"{f} ({n})" for f, n in fuentes.most_common(3)) + nota


def _capa_genetica(simbolo: str, reg_gwas: dict[str, Any], gwas: Any, reg_clin: dict[str, Any], clin: Any, reg_ot: dict[str, Any] | None, ot: Any, motivo_sin_ot: str = "") -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    datos: dict[str, Any] = {}
    # GWAS Catalog.
    if _fallo(reg_gwas):
        hallazgos.append(_hallazgo_fallo("GWAS Catalog", reg_gwas))
    else:
        g = gwas if isinstance(gwas, dict) else {}
        n_ad = _entero(g.get("n_alzheimer"))
        total = g.get("total_asociaciones")
        datos["gwasAlzheimer"] = n_ad
        if n_ad:
            ps = [p for p in (_num(a.get("p")) for a in g.get("alzheimer", []) if isinstance(a, dict)) if p is not None and p > 0]
            mejor = f" (mejor p {min(ps):.1e})" if ps else ""
            hallazgos.append(_hallazgo("GWAS Catalog", "con_datos", f"GWAS Catalog: {n_ad} asociaciones con Alzheimer de {total if total is not None else '?'} registradas del gen{mejor}"))
        else:
            # El conector filtra por gen y por Alzheimer en la propia consulta: el cero
            # es de todo el catálogo, no de una página (antes eran las 50 primeras).
            hallazgos.append(_hallazgo("GWAS Catalog", "vacio", f"GWAS Catalog: 0 asociaciones con Alzheimer entre {total if total is not None else 0} registradas del gen"))
    # ClinVar.
    if _fallo(reg_clin):
        hallazgos.append(_hallazgo_fallo("ClinVar", reg_clin))
    else:
        c = clin if isinstance(clin, dict) else {}
        con = _entero(c.get("con_enfermedad"))
        total_v = _entero(c.get("variantes_gen"))
        datos["clinvarAlzheimer"] = con
        texto = f"ClinVar: {con} variantes con Alzheimer de {total_v} del gen"
        hallazgos.append(_hallazgo("ClinVar", "con_datos" if con else "vacio", texto))
    # Open Targets: asociación genética y dirección.
    direccion: str | None = None
    if reg_ot is None:
        hallazgos.append(_hallazgo("Open Targets", "no_consultado", f"Open Targets: no consultado ({motivo_sin_ot or 'sin identificador Ensembl'})"))
    elif _fallo(reg_ot) or (isinstance(ot, dict) and ot.get("errors")):
        err = _fallo(reg_ot) or ("GraphQL devolvió errores: " + str(ot.get("errors"))[:120])
        hallazgos.append(_hallazgo("Open Targets", "fallo", f"Open Targets: no pude comprobar ({err[:140]})"))
    else:
        t = (ot or {}).get("target") if isinstance(ot, dict) else None
        if not t:
            hallazgos.append(_hallazgo("Open Targets", "vacio", "Open Targets: la diana no está en la plataforma"))
        else:
            filas = ((t.get("associatedDiseases") or {}).get("rows")) or []
            mejor = max((f for f in filas if isinstance(f, dict)), key=lambda f: _num(f.get("score")) or 0.0, default=None)
            tipos = {str(d.get("id")): _num(d.get("score")) for d in ((mejor or {}).get("datatypeScores") or []) if isinstance(d, dict)}
            genetica = tipos.get("genetic_association")
            global_ = _num((mejor or {}).get("score"))
            datos["openTargets"] = {"asociacion": global_, "genetica": genetica, "tipos": tipos}
            if genetica:
                hallazgos.append(_hallazgo("Open Targets", "con_datos", f"Open Targets: asociación genética {_fmt(genetica, 2)} (global {_fmt(global_, 2)})"))
            elif mejor:
                otros = _lista([f"{k} {_fmt(v, 2)}" for k, v in tipos.items() if v])
                hallazgos.append(_hallazgo("Open Targets", "vacio", f"Open Targets: sin evidencia genética; asociación global {_fmt(global_, 2)}" + (f" por {otros}" if otros else "")))
            else:
                hallazgos.append(_hallazgo("Open Targets", "vacio", "Open Targets: sin asociación registrada con Alzheimer"))
            ev = _dict(t.get("evidences"))
            evidencias = ev.get("rows") if isinstance(ev.get("rows"), list) else []
            direccion, motivo_dir = _direccion_open_targets([e for e in evidencias if isinstance(e, dict)], ev.get("count"))
            datos["direccionMotivo"] = motivo_dir
            hallazgos.append(_hallazgo("Open Targets", "con_datos" if direccion else "no_consultado", f"dirección: {motivo_dir}"))
    fuentes = ["gwas_asociaciones_gen", "clinvar_gen"] + (["opentargets_graphql"] if reg_ot is not None else [])
    registro = [r for r in (reg_gwas, reg_clin, reg_ot) if r]
    return _capa("genetica_humana", hallazgos, fuentes, registro, direccion, datos)


# ---------------------------------------------------------------------------
# Expresión: tejido y tipo celular (HPA y GTEx)
# ---------------------------------------------------------------------------


def hechos_tejido_hpa(hpa: Any) -> dict[str, Any]:
    """Lo que la ficha de HPA dice del cerebro, en claves estables.
    `cerebroDetectado` es True, False o None (HPA no lo dice o el conector no
    trajo la clave). Solo la categoría "no detectado" autoriza el False: la
    de baja especificidad regional no significa ausencia (la albúmina, que
    no es un gen cerebral, la lleva)."""
    d = hpa if isinstance(hpa, dict) else {}
    esp_tejido = _norm(d.get("RNA tissue specificity"))
    dist_tejido = _norm(d.get("RNA tissue distribution"))
    esp_cerebro = _norm(d.get("RNA brain regional specificity"))
    dist_cerebro = _norm(d.get("RNA brain regional distribution"))
    tejidos = _dict_num(d.get("RNA tissue specific nTPM"))
    regiones = _dict_num(d.get("RNA brain regional specific nTPM"))
    clave_cerebro = _clave_ci(tejidos, "brain")
    if dist_cerebro == _NO_DETECTADO or dist_tejido == _NO_DETECTADO or esp_tejido == _NO_DETECTADO:
        cerebro: bool | None = False
    elif dist_cerebro in _DETECTADO or dist_tejido == "detected in all" or clave_cerebro is not None or regiones:
        cerebro = True
    else:
        cerebro = None
    return {"tieneFicha": bool(d.get("Gene")), "cerebroDetectado": cerebro, "distribucionCerebro": dist_cerebro or None, "especificidadCerebro": esp_cerebro or None, "distribucionTejido": dist_tejido or None, "especificidadTejido": esp_tejido or None, "tejidosEnriquecidos": tejidos, "regionesEnriquecidas": regiones, "cerebroNtpm": tejidos.get(clave_cerebro) if clave_cerebro is not None else None}


def hechos_celular_hpa(hpa: Any) -> dict[str, Any]:
    """Lo que la ficha de HPA dice por tipo celular: célula única de todo el
    cuerpo (nCPM; la clave antigua nTPM se acepta) y núcleo único en cerebro.
    `detectado` es True, False o None."""
    d = hpa if isinstance(hpa, dict) else {}
    esp = _norm(d.get("RNA single cell type specificity"))
    dist = _norm(d.get("RNA single cell type distribution"))
    tipos = _dict_num(d.get("RNA single cell type specific nCPM")) or _dict_num(d.get("RNA single cell type specific nTPM"))
    esp_cer = _norm(d.get("RNA single nuclei brain specificity"))
    dist_cer = _norm(d.get("RNA single nuclei brain distribution"))
    tipos_cer = _dict_num(d.get("RNA single nuclei brain specific nCPM"))
    claves = [esp, dist, esp_cer, dist_cer]
    if tipos or tipos_cer or dist in _DETECTADO or dist_cer in _DETECTADO or esp in _ESPECIFICIDAD_CELULAR_DETECTADA or esp_cer in _ESPECIFICIDAD_CELULAR_DETECTADA:
        detectado: bool | None = True
    elif any(claves) and all(c in (_NO_DETECTADO, "") for c in claves):
        detectado = False
    else:
        detectado = None
    return {"detectado": detectado, "especificidad": esp or None, "distribucion": dist or None, "tiposCelulares": tipos, "especificidadCerebro": esp_cer or None, "distribucionCerebro": dist_cer or None, "tiposCerebro": tipos_cer, "clusterCerebro": d.get("Brain expression cluster") or None}


def _capa_tejido(reg_hpa: dict[str, Any] | None, hpa: Any, reg_gtex: dict[str, Any] | None, gtex: Any, tejido_gtex: str, motivo_sin_gtex: str, motivo_sin_hpa: str = "") -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    hechos = hechos_tejido_hpa(hpa)
    if reg_hpa is None:
        hallazgos.append(_hallazgo("HPA", "no_consultado", f"HPA: no consultado ({motivo_sin_hpa or 'sin identificador Ensembl'})"))
    elif _fallo(reg_hpa):
        hallazgos.append(_hallazgo_fallo("HPA", reg_hpa))
    elif not hechos["tieneFicha"]:
        hallazgos.append(_hallazgo("HPA", "sin_dato_decisivo", "HPA: sin ficha para ese identificador Ensembl (no dice nada de su expresión)"))
    else:
        partes = []
        if hechos["distribucionCerebro"]:
            partes.append(f"distribución en regiones cerebrales '{hechos['distribucionCerebro']}'")
        if hechos["cerebroNtpm"] is not None:
            partes.append(f"cerebro {_fmt(hechos['cerebroNtpm'])} nTPM ({hechos['especificidadTejido'] or 'tejido enriquecido'})")
        elif hechos["tejidosEnriquecidos"]:
            partes.append("enriquecido en " + _lista([f"{k} ({_fmt(v)} nTPM)" for k, v in hechos["tejidosEnriquecidos"].items()]))
        if hechos["regionesEnriquecidas"]:
            partes.append("regiones con más expresión: " + _lista([f"{k} ({_fmt(v)} nTPM)" for k, v in hechos["regionesEnriquecidas"].items()], 4))
        if hechos["cerebroDetectado"] is True:
            hallazgos.append(_hallazgo("HPA", "con_datos", "HPA: detectado en cerebro; " + "; ".join(partes)))
        elif hechos["cerebroDetectado"] is False:
            hallazgos.append(_hallazgo("HPA", "vacio", "HPA: no detectado en cerebro (" + (hechos["distribucionCerebro"] or hechos["distribucionTejido"] or hechos["especificidadTejido"] or "not detected") + ")" + ("; " + "; ".join(partes) if partes else "")))
        else:
            hallazgos.append(_hallazgo("HPA", "sin_dato_decisivo", "HPA: respondió sin el dato que decide sobre el cerebro (falta la clave 'RNA brain regional distribution' en lo que trae el conector" + (f"; {hechos['especificidadTejido']}" if hechos["especificidadTejido"] else "") + (", " + "; ".join(partes) if partes else "") + ")"))
    # GTEx: solo con el GENCODE con versión; sin él, cero filas no significa nada.
    gtex_datos: dict[str, Any] = {"tejido": tejido_gtex, "mediana": None}
    if reg_gtex is None:
        hallazgos.append(_hallazgo("GTEx", "no_consultado", f"GTEx: no consultado ({motivo_sin_gtex})"))
    elif _fallo(reg_gtex):
        hallazgos.append(_hallazgo_fallo("GTEx", reg_gtex))
    else:
        filas = [f for f in (gtex or []) if isinstance(f, dict)] if isinstance(gtex, list) else []
        if not filas:
            hallazgos.append(_hallazgo("GTEx", "sin_dato_decisivo", f"GTEx: sin filas para ese identificador en {tejido_gtex} (comprobar la versión del GENCODE)"))
        else:
            med = _num(filas[0].get("mediana"))
            unidad = filas[0].get("unidad") or "TPM"
            gtex_datos["mediana"] = med
            if med is None:
                hallazgos.append(_hallazgo("GTEx", "sin_dato_decisivo", f"GTEx: fila sin mediana en {tejido_gtex}"))
            elif med > 0:
                hallazgos.append(_hallazgo("GTEx", "con_datos", f"GTEx v10: mediana {_fmt(med, 2)} {unidad} en {tejido_gtex}"))
            else:
                hallazgos.append(_hallazgo("GTEx", "vacio", f"GTEx v10: mediana 0 {unidad} en {tejido_gtex}"))
    fuentes = (["hpa_expresion"] if reg_hpa is not None else []) + (["gtex_expresion"] if reg_gtex is not None else [])
    registro = [r for r in (reg_hpa, reg_gtex) if r]
    return _capa("expresion_tejido", hallazgos, fuentes, registro, None, {**hechos, "gtex": gtex_datos})


def _capa_celular(reg_hpa: dict[str, Any] | None, hpa: Any, motivo_sin_hpa: str = "") -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    hechos = hechos_celular_hpa(hpa)
    if reg_hpa is None:
        hallazgos.append(_hallazgo("HPA", "no_consultado", f"HPA célula única: no consultado ({motivo_sin_hpa or 'sin identificador Ensembl'})"))
    elif _fallo(reg_hpa):
        hallazgos.append(_hallazgo_fallo("HPA célula única", reg_hpa))
    elif not (isinstance(hpa, dict) and hpa.get("Gene")):
        hallazgos.append(_hallazgo("HPA", "sin_dato_decisivo", "HPA célula única: sin ficha para ese identificador Ensembl"))
    else:
        partes = []
        if hechos["tiposCelulares"]:
            partes.append("tipos celulares con más expresión: " + _lista([f"{k} ({_fmt(v)} nCPM)" for k, v in hechos["tiposCelulares"].items()], 4))
        elif hechos["especificidad"]:
            partes.append(f"especificidad '{hechos['especificidad']}'" + (" (el conector no trae los tipos: falta la clave 'RNA single cell type specific nCPM')" if hechos["especificidad"] != _NO_DETECTADO else ""))
        if hechos["tiposCerebro"]:
            partes.append("núcleo único en cerebro: " + _lista([f"{k} ({_fmt(v)} nCPM)" for k, v in hechos["tiposCerebro"].items()], 4))
        elif hechos["distribucionCerebro"]:
            partes.append(f"núcleo único en cerebro '{hechos['distribucionCerebro']}'")
        if hechos["clusterCerebro"]:
            partes.append(f"clúster cerebral: {hechos['clusterCerebro']}")
        if hechos["detectado"] is True:
            hallazgos.append(_hallazgo("HPA", "con_datos", "HPA célula única: detectado; " + "; ".join(partes)))
        elif hechos["detectado"] is False:
            hallazgos.append(_hallazgo("HPA", "vacio", "HPA célula única: no detectado en ningún tipo celular" + ("; " + "; ".join(partes) if partes else "")))
        else:
            hallazgos.append(_hallazgo("HPA", "sin_dato_decisivo", "HPA célula única: respondió sin las claves de célula única (el conector no las trae)" + ("; " + "; ".join(partes) if partes else "")))
    return _capa("expresion_celular", hallazgos, ["hpa_expresion"] if reg_hpa is not None else [], [reg_hpa] if reg_hpa else [], None, hechos)


# ---------------------------------------------------------------------------
# Proteína, farmacología, literatura
# ---------------------------------------------------------------------------


def _capa_proteina(simbolo: str, reg_uni: dict[str, Any], uni: Any, reg_re: dict[str, Any] | None, rutas: Any, reg_st: dict[str, Any], inter: Any, motivo_sin_reactome: str = "") -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    datos: dict[str, Any] = {}
    if _fallo(reg_uni):
        hallazgos.append(_hallazgo_fallo("UniProt", reg_uni))
    elif isinstance(uni, dict) and _texto_id(uni.get("accession")):
        accession = _texto_id(uni.get("accession"))
        funcion = _texto_id(uni.get("funcion"))
        datos["uniprot"] = accession
        datos["funcion"] = funcion[:500]
        hallazgos.append(_hallazgo("UniProt", "con_datos", f"UniProt: {accession} {_texto_id(uni.get('nombre'))}".strip() + (f" ({_texto_id(uni.get('longitud'))} aa)" if _texto_id(uni.get("longitud")) else "") + (f"; función: {funcion[:200]}" if funcion else "; sin texto de función")))
    else:
        hallazgos.append(_hallazgo("UniProt", "vacio", f"UniProt: sin entrada revisada (Swiss-Prot) para {simbolo}"))
    if reg_re is None:
        hallazgos.append(_hallazgo("Reactome", "no_consultado", f"Reactome: no consultado ({motivo_sin_reactome or 'sin accession UniProt'})"))
    elif _fallo(reg_re):
        hallazgos.append(_hallazgo_fallo("Reactome", reg_re))
    else:
        lista = [r for r in (rutas or []) if isinstance(r, dict)] if isinstance(rutas, list) else []
        datos["rutas"] = len(lista)
        hallazgos.append(_hallazgo("Reactome", "con_datos" if lista else "vacio", f"Reactome: {len(lista)} rutas curadas" + (" (p. ej. " + _lista([str(r.get("nombre")) for r in lista]) + ")" if lista else "")))
    if _fallo(reg_st):
        hallazgos.append(_hallazgo_fallo("STRING", reg_st))
    else:
        lista = [i for i in (inter or []) if isinstance(i, dict)] if isinstance(inter, list) else []
        datos["interactores"] = len(lista)
        if lista:
            hallazgos.append(_hallazgo("STRING", "con_datos", f"STRING: {len(lista)} interactores funcionales (" + _lista([str(i.get("interactor")) for i in lista], 4) + ")"))
        else:
            hallazgos.append(_hallazgo("STRING", "vacio", "STRING: sin interactores (el símbolo no resolvió o no tiene red)"))
    fuentes = ["uniprot_proteina"] + (["reactome_rutas"] if reg_re is not None else []) + ["string_interactores"]
    return _capa("proteina_funcion", hallazgos, fuentes, [r for r in (reg_uni, reg_re, reg_st) if r], None, datos)


def _capa_farmacologia(reg_ch: dict[str, Any] | None, chembl: Any, reg_dg: dict[str, Any], dg: Any, motivo_sin_chembl: str = "") -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    datos: dict[str, Any] = {}
    if reg_ch is None:
        hallazgos.append(_hallazgo("ChEMBL", "no_consultado", f"ChEMBL: no consultado ({motivo_sin_chembl or 'sin accession UniProt'})"))
    elif _fallo(reg_ch):
        hallazgos.append(_hallazgo_fallo("ChEMBL", reg_ch))
    else:
        c = chembl if isinstance(chembl, dict) else {}
        mecs = [m for m in (c.get("mecanismos") or []) if isinstance(m, dict)]
        fases = [f for f in (_num(m.get("fase_maxima")) for m in mecs) if f is not None]
        datos["mecanismosChembl"] = len(mecs)
        if not c.get("diana"):
            hallazgos.append(_hallazgo("ChEMBL", "vacio", "ChEMBL: sin diana registrada para esa proteína"))
        elif mecs:
            hallazgos.append(_hallazgo("ChEMBL", "con_datos", f"ChEMBL: {len(mecs)} mecanismos de acción de fármacos sobre {c.get('diana')}" + (f" (fase máxima {_fmt(max(fases), 0)})" if fases else "")))
        else:
            hallazgos.append(_hallazgo("ChEMBL", "vacio", f"ChEMBL: diana {c.get('diana')} sin mecanismos de fármacos registrados"))
    if _fallo(reg_dg):
        hallazgos.append(_hallazgo_fallo("DGIdb", reg_dg))
    else:
        d = dg if isinstance(dg, dict) else {}
        inter = [i for i in (d.get("interacciones") or []) if isinstance(i, dict)]
        total = _entero(d.get("total")) or len(inter)
        aprob = [str(i.get("farmaco")) for i in inter if i.get("aprobado")]
        datos["interaccionesDgidb"] = total
        datos["farmacosAprobados"] = aprob[:10]
        if total:
            hallazgos.append(_hallazgo("DGIdb", "con_datos", f"DGIdb: {total} interacciones fármaco-gen, {len(aprob)} con fármacos aprobados" + (" (" + _lista(aprob) + ")" if aprob else "")))
        else:
            hallazgos.append(_hallazgo("DGIdb", "vacio", "DGIdb: 0 interacciones fármaco-gen"))
    fuentes = (["chembl_diana"] if reg_ch is not None else []) + ["dgidb_gen"]
    return _capa("farmacologia", hallazgos, fuentes, [r for r in (reg_ch, reg_dg) if r], None, datos)


def _capa_literatura(simbolo: str, reg_pt: dict[str, Any], pt: Any) -> dict[str, Any]:
    hallazgos: list[dict[str, str]] = []
    datos: dict[str, Any] = {}
    if _fallo(reg_pt):
        hallazgos.append(_hallazgo_fallo("PubTator 3", reg_pt))
    else:
        d = pt if isinstance(pt, dict) else {}
        rel = [r for r in (d.get("relaciones") or []) if isinstance(r, dict)]
        total = sum(_entero(r.get("publicaciones")) for r in rel)
        datos["relaciones"] = len(rel)
        datos["publicaciones"] = total
        if rel:
            tipos = _lista([f"{_TIPOS_RELACION_PUBTATOR.get(str(r.get('tipo')), str(r.get('tipo')))} {_entero(r.get('publicaciones'))}" for r in rel], 4)
            hallazgos.append(_hallazgo("PubTator 3", "con_datos", f"PubTator 3: {len(rel)} tipos de relación entre {simbolo} y Alzheimer con {total} publicaciones de soporte ({tipos})"))
        else:
            hallazgos.append(_hallazgo("PubTator 3", "vacio", f"PubTator 3: 0 relaciones anotadas entre {simbolo} y Alzheimer (cuenta relaciones extraídas por minería de texto, no toda la literatura)"))
    return _capa("literatura", hallazgos, ["pubtator_relaciones"], [reg_pt] if reg_pt else [], None, datos)


# ---------------------------------------------------------------------------
# El perfil
# ---------------------------------------------------------------------------


def contextos_de(texto: str | None) -> list[dict[str, Any]]:
    """Las entradas del vocabulario que encajan con el texto de la tarjeta
    (célula, tejido), en el orden del vocabulario."""
    t = _norm(texto)
    if not t:
        return []
    corteza_ajena = bool(_CORTEZA_NO_CEREBRAL.search(t))
    salida = []
    for patron, celulas, regiones, gtex, cerebral in _CONTEXTOS:
        if not re.search(patron, t):
            continue
        if corteza_ajena and patron == _PATRON_CORTEZA:
            # "corteza suprarrenal": la corteza es de otro órgano.
            continue
        salida.append({"patron": patron, "celulas": celulas, "regiones": regiones, "gtex": gtex, "cerebral": cerebral})
    return salida


def tejido_gtex_de(texto: str | None) -> str:
    """El tejido de GTEx que corresponde al texto de la tarjeta; hipocampo si
    el texto no nombra ninguno reconocible."""
    for c in contextos_de(texto):
        if c["gtex"]:
            return c["gtex"]
    return TEJIDO_GTEX_POR_DEFECTO


def _texto_contexto(contexto: Any) -> str:
    """El texto con la célula y el tejido a partir de lo que llegue como
    contexto: la tarjeta, la hipótesis entera (se usa su tarjeta) o un texto
    suelto."""
    if isinstance(contexto, dict):
        tarjeta = contexto.get("tarjeta") if isinstance(contexto.get("tarjeta"), dict) else contexto
        trozos = [_texto_id(tarjeta.get(k)) for k in ("celula", "tejido", "etapa")]
    elif isinstance(contexto, (list, tuple)):
        trozos = [_texto_id(c) for c in contexto]
    else:
        trozos = [_texto_id(contexto)]
    return " ".join(t for t in trozos if t)


def _capa_no_consultada(nombre: str, motivo: str) -> dict[str, Any]:
    return {"capa": nombre, "estado": "no_pude_comprobar", "detalle": motivo, "direccion": None, "fuentes": [], "registro": [], "datos": {}}


def resumen_perfil(perfil: dict[str, Any]) -> str:
    """Una frase con el recuento por estado, capa por capa, sin sumar nada.
    Un estado que no es de los tres (registro de otra versión) cuenta como
    "no pude comprobar", que es lo único que se puede decir de él."""
    capas = _capas_de(perfil)
    diana = _texto_id(_dict(perfil).get("diana")) or "Diana"
    if not capas:
        return f"{diana}: sin capas consultadas. Sin puntuación combinada: cada capa responde a una pregunta distinta."
    por_estado: dict[str, list[str]] = {e: [] for e in ESTADOS}
    for c in capas:
        estado = c.get("estado") if c.get("estado") in ESTADOS else "no_pude_comprobar"
        por_estado[estado].append(ETIQUETAS_CAPA.get(c.get("capa"), str(c.get("capa"))).lower())
    partes = []
    if por_estado["presente"]:
        partes.append(f"{len(por_estado['presente'])} con registro ({', '.join(por_estado['presente'])})")
    if por_estado["ausente"]:
        partes.append(f"{len(por_estado['ausente'])} sin nada en las bases ({', '.join(por_estado['ausente'])})")
    if por_estado["no_pude_comprobar"]:
        partes.append(f"{len(por_estado['no_pude_comprobar'])} sin poder comprobar ({', '.join(por_estado['no_pude_comprobar'])})")
    gen = next((c for c in capas if c.get("capa") == "genetica_humana"), {})
    dir_ = gen.get("direccion")
    nota_dir = f"; dirección genética {ETIQUETAS_DIRECCION[dir_]}" if dir_ in ("+", "-") else ""
    return f"{diana}: de {len(capas)} capas, " + ", ".join(partes) + nota_dir + ". Sin puntuación combinada: cada capa responde a una pregunta distinta."


async def perfil_de_diana(simbolo: str, ids: dict[str, Any] | None, consultar: Consultar = CON.consultar, contexto: Any = None) -> dict[str, Any]:
    """El perfil de evidencia de una diana, capa por capa.

    `simbolo` es el símbolo HGNC (APOE, TREM2); `ids` lo que devolvió MyGene
    (`simbolo`, `nombre`, `ensembl`, `uniprot`, `entrez`; `gencode` con versión
    si alguien lo añadió, que es lo que GTEx exige); `contexto` es la tarjeta
    de la hipótesis o un texto con la célula o el tejido, para elegir el tejido
    de GTEx. Las consultas van en serie porque STRING no admite paralelo y las
    demás tienen límite por segundo.

    Devuelve {"diana", "identificadores", "capas": [...], "resumen",
    "registro" (todas las consultas, sin repetir la de HPA que comparten dos
    capas), "consultadoEn"}. Nunca lanza por una base caída."""
    ids = dict(ids) if isinstance(ids, dict) else {}
    simbolo = _texto_id(simbolo) or _texto_id(ids.get("simbolo"))
    # Identificadores como texto o None: MyGene a veces manda listas y los
    # registros antiguos pueden traer números; aquí se normalizan una vez.
    identificadores: dict[str, Any] = {k: (_texto_id(ids.get(k)) or None) for k in ("simbolo", "nombre", "ensembl", "uniprot", "entrez", "gencode")}
    identificadores["simbolo"] = identificadores["simbolo"] or simbolo or None
    ahora = P.ahora_ms()
    if not simbolo:
        motivo = "Sin símbolo de gen: la diana no resuelve a un gen humano, así que no hay a quién preguntar en las bases"
        perfil = {"diana": identificadores["nombre"] or "sin diana", "identificadores": identificadores, "capas": [_capa_no_consultada(c, motivo) for c in CAPAS], "registro": [], "consultadoEn": ahora, "contexto": _texto_contexto(contexto) or None}
        perfil["resumen"] = resumen_perfil(perfil)
        return perfil
    ensembl = identificadores["ensembl"]
    uniprot = identificadores["uniprot"]
    gencode = identificadores["gencode"]
    texto_ctx = _texto_contexto(contexto)
    tejido_gtex = tejido_gtex_de(texto_ctx)

    # 1. Genética humana.
    reg_gwas, gwas = await _consulta_segura(consultar, "gwas_asociaciones_gen", f"GWAS Catalog: {simbolo}", simbolo=simbolo)
    reg_clin, clin = await _consulta_segura(consultar, "clinvar_gen", f"ClinVar: {simbolo}", simbolo=simbolo)
    reg_ot: dict[str, Any] | None = None
    ot: Any = None
    if ensembl:
        variables = json.dumps({"id": ensembl, "enf": [ALZHEIMER_MONDO, ALZHEIMER_EFO], "fuentes": FUENTES_DIRECCION_OT})
        reg_ot, ot = await _consulta_segura(consultar, "opentargets_graphql", f"Open Targets: {simbolo} y Alzheimer", consulta=CONSULTA_OT, variables=variables)
    genetica = _capa_genetica(simbolo, reg_gwas, gwas, reg_clin, clin, reg_ot, ot, "sin identificador Ensembl en MyGene")

    # 2 y 3. Expresión (una sola consulta a HPA para las dos capas).
    reg_hpa: dict[str, Any] | None = None
    hpa: Any = None
    if ensembl:
        reg_hpa, hpa = await _consulta_segura(consultar, "hpa_expresion", f"HPA: {simbolo}", ensembl=ensembl)
    reg_gtex: dict[str, Any] | None = None
    gtex: Any = None
    motivo_sin_gtex = "hace falta el identificador GENCODE con versión, que MyGene no da"
    if gencode:
        reg_gtex, gtex = await _consulta_segura(consultar, "gtex_expresion", f"GTEx: {simbolo} en {tejido_gtex}", gencode=gencode, tejido=tejido_gtex)
    tejido = _capa_tejido(reg_hpa, hpa, reg_gtex, gtex, tejido_gtex, motivo_sin_gtex, "sin identificador Ensembl en MyGene")
    celular = _capa_celular(reg_hpa, hpa, "sin identificador Ensembl en MyGene")

    # 4. Proteína y función.
    reg_uni, uni = await _consulta_segura(consultar, "uniprot_proteina", f"UniProt: {simbolo}", simbolo=simbolo)
    if not uniprot and isinstance(uni, dict) and _texto_id(uni.get("accession")):
        uniprot = _texto_id(uni.get("accession"))
        identificadores["uniprot"] = uniprot
    reg_re: dict[str, Any] | None = None
    rutas: Any = None
    if uniprot:
        reg_re, rutas = await _consulta_segura(consultar, "reactome_rutas", f"Reactome: {uniprot}", uniprot=uniprot)
    reg_st, inter = await _consulta_segura(consultar, "string_interactores", f"STRING: {simbolo}", simbolo=simbolo)
    proteina = _capa_proteina(simbolo, reg_uni, uni, reg_re, rutas, reg_st, inter, "sin accession UniProt")

    # 5. Farmacología.
    reg_ch: dict[str, Any] | None = None
    chembl: Any = None
    if uniprot:
        reg_ch, chembl = await _consulta_segura(consultar, "chembl_diana", f"ChEMBL: {uniprot}", uniprot=uniprot)
    reg_dg, dg = await _consulta_segura(consultar, "dgidb_gen", f"DGIdb: {simbolo}", simbolo=simbolo)
    farmacologia = _capa_farmacologia(reg_ch, chembl, reg_dg, dg, "sin accession UniProt")

    # 6. Literatura.
    reg_pt, pt = await _consulta_segura(consultar, "pubtator_relaciones", f"PubTator: {simbolo} y Alzheimer", entidad=f"@GENE_{simbolo}", con=ALZHEIMER_PUBTATOR)
    literatura = _capa_literatura(simbolo, reg_pt, pt)

    capas = [genetica, tejido, celular, proteina, farmacologia, literatura]
    registro: list[dict[str, Any]] = []
    vistos: set[int] = set()
    for c in capas:
        for r in c["registro"]:
            if id(r) not in vistos:
                vistos.add(id(r))
                registro.append(r)
    perfil = {"diana": simbolo, "identificadores": identificadores, "capas": capas, "registro": registro, "consultadoEn": ahora, "contexto": texto_ctx or None}
    perfil["resumen"] = resumen_perfil(perfil)
    return perfil


# ---------------------------------------------------------------------------
# Texto para el Killer y el juez
# ---------------------------------------------------------------------------


def texto_perfil(perfil: dict[str, Any] | None) -> str:
    """La tabla en castellano, una fila por capa, para el Killer y el juez.
    Un perfil ausente o de un registro antiguo no rompe: dice que no se
    consultó."""
    capas = _capas_de(perfil)
    if not capas:
        return "Perfil de evidencia por diana: sin consultar (las bases no se han consultado para esta versión de la hipótesis)."
    ids = _dict(perfil.get("identificadores"))
    ident = "; ".join(f"{k} {v}" for k, v in (("Ensembl", _texto_id(ids.get("ensembl"))), ("UniProt", _texto_id(ids.get("uniprot")))) if v)
    lineas = [f"Perfil de evidencia por diana: {_texto_id(perfil.get('diana')) or 'sin diana'}" + (f" ({ident})" if ident else "") + ". Una fila por capa; sin puntuación combinada (cada capa responde a una pregunta distinta y las cifras se leen, no se suman)."]
    lineas.append("Capa | Estado | Dirección | Detalle | Conectores")
    for c in capas:
        nombre = _texto_id(c.get("capa")) or "?"
        etiqueta = ETIQUETAS_CAPA.get(nombre, nombre)
        pregunta = PREGUNTA_CAPA.get(nombre, "")
        estado = ETIQUETAS_ESTADO.get(c.get("estado"), "no pude comprobar")
        direccion = ETIQUETAS_DIRECCION.get(c.get("direccion"), "sin dirección") if nombre == "genetica_humana" else "no aplica"
        detalle = str(c.get("detalle") or "").replace("\n", " ").strip() or "sin detalle registrado"
        if len(detalle) > 420:
            detalle = detalle[:417] + "..."
        fuentes_c = c.get("fuentes") if isinstance(c.get("fuentes"), list) else []
        fuentes = ", ".join(str(f) for f in fuentes_c if f) or "ninguno"
        lineas.append(f"{etiqueta} ({pregunta}) | {estado} | {direccion} | {detalle} | {fuentes}")
    lineas.append("Leyenda: presente = la base respondió y hay registro; ausente = todas las bases de la fila respondieron y no hay nada; no pude comprobar = alguna base no respondió o no trae el dato que decide (no es ausencia). Dirección: '+' más función de la diana, más riesgo; '-' menos función, más riesgo; solo de la genética humana.")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------
# Comprobación del Killer: contexto humano
# ---------------------------------------------------------------------------


def _capa_de(perfil: dict[str, Any] | None, nombre: str) -> dict[str, Any]:
    for c in _capas_de(perfil):
        if c.get("capa") == nombre:
            return c
    return {}


def _texto_celula(h: Any) -> str:
    t = _dict(_dict(h).get("tarjeta"))
    return " ".join(_texto_id(t.get(k)) for k in ("celula", "tejido")).strip()


def mecanismo_cerebral(h: dict[str, Any]) -> tuple[bool, str]:
    """Si la hipótesis afirma un mecanismo en el cerebro: lo dice la célula o
    el tejido de la tarjeta; si la tarjeta no los trae, el mecanismo o el
    enunciado. (sí o no, de dónde salió). Una hipótesis sin forma (None,
    lista) no nombra el cerebro."""
    h = _dict(h)
    celula = _texto_celula(h)
    if celula:
        return any(c["cerebral"] for c in contextos_de(celula)), f"tarjeta: '{celula[:80]}'"
    texto = " ".join(_texto_id(h.get(k)) for k in ("mecanismo", "enunciado", "titulo"))
    corteza_ajena = bool(_CORTEZA_NO_CEREBRAL.search(texto))
    for m in _CEREBRAL_EN_TEXTO.finditer(texto):
        if corteza_ajena and _CORTEZA.fullmatch(m.group(0)):
            continue  # "corteza suprarrenal" no es cerebro
        return True, f"texto de la hipótesis: '{m.group(0)}'"
    return False, "ni la tarjeta ni el texto nombran el cerebro"


def fuentes_sostenidas(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las fuentes de las que vienen las afirmaciones sostenidas o parciales,
    emparejadas con el mismo índice que usa `rosa.certeza` (por `fuenteId` o
    por la referencia con la que empieza la cita). El índice se construye una
    vez, no una por afirmación: con miles de afirmaciones y fuentes el coste
    es lineal. Dos fuentes con el mismo id o referencia (heredadas de otra
    investigación) cuentan una vez. Si ninguna afirmación se empareja, todas
    las fuentes de la procedencia, que es lo que se tiene."""
    h = _dict(h)
    afs = [a for a in (h.get("afirmaciones") if isinstance(h.get("afirmaciones"), list) else []) if isinstance(a, dict) and a.get("veredicto") in certeza.VEREDICTOS_QUE_CUENTAN]
    fuentes = [f for f in (_dict(h.get("procedencia")).get("fuentes") if isinstance(_dict(h.get("procedencia")).get("fuentes"), list) else []) if isinstance(f, dict)]
    if not afs or not fuentes:
        return _sin_repetir(fuentes)
    try:
        indice = certeza._Indice(fuentes)
        resolver = indice.resolver
    except Exception:  # noqa: BLE001
        # Si el índice de certeza cambia de forma, se empareja una a una.
        def resolver(a: dict[str, Any]) -> list[int]:
            f = certeza.fuente_de(h, a)
            return [fuentes.index(f)] if isinstance(f, dict) and f in fuentes else []

    vistas: list[dict[str, Any]] = []
    indices: set[int] = set()
    for a in afs:
        try:
            encontrados = resolver(a)
        except Exception:  # noqa: BLE001
            encontrados = []
        for j in encontrados[:1]:  # la primera fuente que empareja, como fuente_de
            if 0 <= j < len(fuentes) and j not in indices:
                indices.add(j)
                vistas.append(fuentes[j])
    return _sin_repetir(vistas) if vistas else _sin_repetir(fuentes)


def _sin_repetir(fuentes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Las fuentes sin repetir la misma identidad: mismo id, o misma
    referencia normalizada si no hay id (una hipótesis heredada con sufijo
    '-inv-' puede traer la misma fuente dos veces)."""
    salida: list[dict[str, Any]] = []
    vistas: set[Any] = set()
    for f in fuentes:
        fid = f.get("id")
        clave: Any = ("id", str(fid)) if fid not in (None, "") else (("ref", _norm(f.get("referencia")).rstrip(".")) if _norm(f.get("referencia")) else ("obj", id(f)))
        if clave in vistas:
            continue
        vistas.add(clave)
        salida.append(f)
    return salida


def solo_preclinica(h: dict[str, Any]) -> tuple[bool, int]:
    """Si toda la evidencia sostenida es preclínica (modelos animales) o in
    vitro (cultivos), y cuántas fuentes son. Sin fuentes: False."""
    fuentes = fuentes_sostenidas(h)
    if not fuentes:
        return False, 0
    return all(_norm(f.get("tipoEstudio")) in _PRECLINICAS for f in fuentes), len(fuentes)


def _coincidencias(nombres: dict[str, float], trozos: tuple[str, ...]) -> list[tuple[str, float]]:
    return [(k, v) for k, v in nombres.items() if any(t in k.lower() for t in trozos)]


def comprobacion_contexto_humano(h: dict[str, Any], perfil: dict[str, Any] | None) -> dict[str, str]:
    """La comprobación `contexto_humano` del Killer, con la misma forma que
    `rosa.killer.comprobaciones_deterministas`: {comprobacion, resultado,
    detalle}.

    - pasa: la diana es un gen humano y HPA o GTEx la expresan en la célula o
      el tejido que la tarjeta nombra (tipo celular en la nCPM de HPA, región
      cerebral en la nTPM regional o distribución en todas las regiones, o
      mediana de GTEx mayor que 0 en el tejido correspondiente).
    - falla: HPA dice que no se detecta en cerebro y la hipótesis afirma un
      mecanismo cerebral.
    - no_comprobable: todo lo demás, con el motivo: la diana no resuelve, la
      tarjeta no nombra célula, HPA no respondió o no trae el dato, o toda la
      evidencia sostenida es preclínica o in vitro ("no comprobado en
      humanos")."""
    nombre = "contexto_humano"
    h = _dict(h)
    tarjeta = _dict(h.get("tarjeta"))
    diana = _texto_id(tarjeta.get("diana"))
    if not _capas_de(perfil):
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": "Sin perfil de diana: las bases no se han consultado para esta versión de la hipótesis"}
    ids = _dict(perfil.get("identificadores"))
    simbolo = _texto_id(ids.get("simbolo")) or _texto_id(perfil.get("diana")) or diana or "la diana"
    if not _texto_id(ids.get("ensembl")):
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"'{diana or simbolo}' no resuelve a un gen humano (sin identificador Ensembl): no se puede comprobar su expresión en tejido humano"}
    # Frescura: un perfil de otra diana o de otra versión de la hipótesis no
    # sirve para juzgar esta. La diana se compara por Ensembl con lo que la
    # hipótesis ya resolvió (contextoBases), no por el texto de la tarjeta,
    # que puede nombrar un proceso ("amiloide beta") y no el símbolo (APP).
    ensembl_h = _texto_id(_dict(_dict(h.get("contextoBases")).get("identificadores")).get("ensembl"))
    if ensembl_h and ensembl_h.lower() != _texto_id(ids.get("ensembl")).lower():
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"El perfil de diana es de otro gen (Ensembl {_texto_id(ids.get('ensembl'))}) y la hipótesis resolvió su diana a {ensembl_h}: hay que volver a consultar las bases para esta diana"}
    version_p, version_h = perfil.get("version"), h.get("version")
    if version_p is not None and version_h is not None and str(version_p) != str(version_h):
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"El perfil de diana es de la versión {version_p} de la hipótesis y esta es la {version_h}: hay que volver a consultar las bases"}
    tejido = _capa_de(perfil, "expresion_tejido")
    celular = _capa_de(perfil, "expresion_celular")
    dt = _dict(tejido.get("datos"))
    dc = _dict(celular.get("datos"))
    celula = _texto_celula(h)
    contextos = contextos_de(celula)
    cerebral, origen_cerebral = mecanismo_cerebral(h)
    preclinica, n_precl = solo_preclinica(h)
    nota_precl = f" La evidencia sostenida de la hipótesis ({n_precl} fuentes) es preclínica o in vitro: el contexto humano lo da la base de expresión, no la literatura." if preclinica else ""

    # 1. Pasa: la base humana expresa la diana donde la tarjeta dice.
    tipos_todos = {**_dict_num(dc.get("tiposCelulares")), **_dict_num(dc.get("tiposCerebro"))}
    regiones = _dict_num(dt.get("regionesEnriquecidas"))
    tejidos = _dict_num(dt.get("tejidosEnriquecidos"))
    gtex = dt.get("gtex") if isinstance(dt.get("gtex"), dict) else {}
    pruebas: list[str] = []
    for c in contextos:
        if c["celulas"]:
            for k, v in _coincidencias(tipos_todos, c["celulas"]):
                pruebas.append(f"HPA célula única: {k} ({_fmt(v)} nCPM)")
        if c["regiones"]:
            for k, v in _coincidencias(regiones, c["regiones"]):
                pruebas.append(f"HPA región cerebral: {k} ({_fmt(v)} nTPM)")
            for k, v in _coincidencias(tejidos, c["regiones"]):
                pruebas.append(f"HPA tejido: {k} ({_fmt(v)} nTPM)")
            if c["cerebral"] and _norm(dt.get("distribucionCerebro")) == "detected in all":
                pruebas.append("HPA: detectado en todas las regiones cerebrales")
        if c["cerebral"] and c["celulas"] and _norm(dc.get("distribucionCerebro")) == "detected in all":
            pruebas.append("HPA núcleo único: detectado en todos los tipos celulares del cerebro")
        med = _num(gtex.get("mediana"))
        if c["gtex"] and gtex.get("tejido") == c["gtex"] and med is not None and med > 0:
            pruebas.append(f"GTEx: mediana {_fmt(med, 2)} TPM en {c['gtex']}")
    if pruebas:
        unicas = list(dict.fromkeys(pruebas))
        return {"comprobacion": nombre, "resultado": "pasa", "detalle": f"{simbolo} se expresa en humanos donde la tarjeta lo sitúa ('{celula[:60]}'): " + "; ".join(unicas[:4]) + "." + nota_precl}

    # 2. Falla: HPA dice que no está en el cerebro y la hipótesis pone ahí el mecanismo.
    if dt.get("cerebroDetectado") is False and cerebral:
        return {"comprobacion": nombre, "resultado": "falla", "detalle": f"HPA no detecta {simbolo} en cerebro humano (distribución '{dt.get('distribucionCerebro') or dt.get('distribucionTejido') or 'not detected'}') y la hipótesis afirma un mecanismo cerebral ({origen_cerebral}); hay que cambiar la diana, el tejido o explicar cómo llega"}

    # 3. No comprobable, con el motivo más concreto.
    if preclinica:
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"No comprobado en humanos: las {n_precl} fuentes sostenidas son preclínicas o in vitro y las bases de expresión no confirman {simbolo} en '{celula[:60] or 'la célula de la tarjeta'}'" + (f" ({tejido.get('detalle', '')[:160]})" if tejido.get("estado") == "no_pude_comprobar" else "")}
    if not celula:
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"La tarjeta no nombra célula ni tejido: no hay contexto humano que comprobar para {simbolo}" + (f"; HPA: {'detectado' if dt.get('cerebroDetectado') else 'sin dato'} en cerebro" if dt else "")}
    if tejido.get("estado") == "no_pude_comprobar" and celular.get("estado") == "no_pude_comprobar":
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"Las bases de expresión no respondieron o no traen el dato para {simbolo}: {str(tejido.get('detalle') or '')[:200]}"}
    if not contextos:
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"No sé traducir '{celula[:60]}' a un tipo celular o región de HPA ni a un tejido de GTEx; hay que nombrarla con un término reconocible (microglía, astrocitos, neuronas, hipocampo, corteza...)"}
    enriquecidos = _lista(list(tipos_todos)[:4]) or _lista(list(tejidos)[:3])
    if dt.get("cerebroDetectado") is False:
        return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"HPA no detecta {simbolo} en cerebro, pero la tarjeta sitúa el mecanismo fuera del cerebro ('{celula[:60]}') y las bases no cubren ese tejido" + (f"; HPA enriquece en {enriquecidos}" if enriquecidos else "")}
    return {"comprobacion": nombre, "resultado": "no_comprobable", "detalle": f"HPA {'detecta' if dt.get('cerebroDetectado') else 'no dice si detecta'} {simbolo} en cerebro pero no confirma la célula o región de la tarjeta ('{celula[:60]}'); HPA solo lista los tipos enriquecidos" + (f" ({enriquecidos})" if enriquecidos else "") + ", así que no se afirma ausencia" + ("; GTEx no consultado (falta el GENCODE con versión)" if gtex.get("mediana") is None else "")}
