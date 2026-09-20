"""Adversario del constructor "mapa" (rosa/mapa_enfermedad.py, 19 de septiembre
de 2026): cohortes de los hechos en las celdas, `cohortesPorRegion`,
`misionAprobada` y `resumen_de`.

Dos clases de test, separadas por sección:

1. "Fallos": demuestran un fallo reproducible del cambio; fallan contra el
   código actual y deben pasar cuando se arregle lo que dice su docstring.
   Cada uno lleva la gravedad del informe y dónde tocar.
2. "Guardas": lo que comprobé que se sostiene (mutación del estado, forma
   real de las copias de afirmaciones de las hipótesis, invariantes por
   región) y que conviene que siga sosteniéndose.

Sin modelos: el mapa y el catálogo de cohortes son reglas puras sobre el
estado. Nada aquí lee rosa.db; las cifras de la base real están en el informe.
"""

from __future__ import annotations

import copy
import json

from rosa import mapa_enfermedad as M
from rosa import metodos as METODOS
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

INV = "inv-adv"
T0 = 1_000_000

# Una sola celda: prodrómica o DCL · hipocampo · astrocito.
CELDA_A = "Braak III-IV: astrogliosis en el hipocampo"
CLAVE_A = ("prodromica_dcl", "hipocampo", "astrocito")
# Otra celda de la misma región: preclínica · hipocampo · microglía.
CELDA_B = "Microglia activation in the hippocampus of cognitively unimpaired adults"
CLAVE_B = ("preclinica", "hipocampo", "microglia")


def _estado():
    e = P.estado_inicial()
    assert A.crear_investigacion(e, {"titulo": "T", "objetivo": "GFAP en astrocitos", "condicionParada": "3 iteraciones"}, T0, INV) == INV
    return e


def _inv(e):
    return next(i for i in e["investigaciones"] if i["id"] == INV)


def _hecho(e, enunciado, id_, afirmacion_ids=None, procedencia=None, **extra):
    h = P.nuevo_hecho(INV, "hecho", "tema", enunciado, "sabido", "fuente", list(procedencia or []), T0, afirmacion_ids=list(afirmacion_ids or []))
    h["id"] = id_
    h.update(extra)
    e["hechos"].append(h)
    return h


def _af(id_, cohorte, fuente_id="f-1"):
    return {"id": id_, "texto": "x", "fragmento": "y", "veredicto": "sostenida", "cohorte": cohorte, "fuenteId": fuente_id, "iteracion": 1}


def _corrida(e, id_, afirmaciones=(), fuentes=()):
    c = {"id": id_, "investigacionId": INV, "numero": 1, "estado": "terminada", "_afirmaciones": list(afirmaciones), "_fuentes": {f["id"]: f for f in fuentes}}
    e["corridas"].append(c)
    return c


def _celda(m, clave):
    return next(c for c in m["celdas"] if (c["estadio"], c["region"], c["tipoCelular"]) == clave)


# ---------------------------------------------------------------------------
# Fallos
# ---------------------------------------------------------------------------


def test_fallo_media_una_mision_propuesta_por_rosa_y_sin_aprobar_no_es_una_mision_aprobada():
    """Gravedad media. El bucle (rosa/bucle/corrida.py, "ROSA2018 propone la
    misión") guarda la propuesta en `inv["mision"]` con `propuestaPorRosa: True`
    y `aprobadaEn: None` hasta que la persona aprueba el primer plan
    (rosa/estado/acciones.py, "Misión aprobada junto con el primer plan"). El
    campo nuevo `misionAprobada` se calcula con `bool(inv["mision"])`, así que
    dice True para una misión que nadie aprobó, y el resumen habla de huecos de
    "la misión" como si la persona la hubiera fijado. En la base real,
    inv-mtvw87yz-1 está exactamente así (misión propuesta, `aprobadaEn` nulo)
    y su mapa sale con `misionAprobada: True`. Arreglo en `mapa()`: aprobada
    solo si `mision.get("aprobadaEn") is not None` (los tests existentes
    montan la misión con `A.aprobar_mision`, que lo escribe)."""
    e = _estado()
    inv = _inv(e)
    # Lo que escribe el bucle al proponer: la plantilla vacía con los campos y la marca de propuesta.
    inv["mision"] = {**P.mision_vacia(), "poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR", "propuestaPorRosa": True}
    assert inv["mision"]["aprobadaEn"] is None
    _hecho(e, CELDA_A, "he-1")
    m = M.mapa(e, INV)
    assert m["misionAprobada"] is False
    assert "no tiene misión aprobada" in m["resumen"]
    assert "Huecos de la misión" not in m["resumen"] and "combinaciones que nombra la misión" not in m["resumen"]
    # La persona aprueba (con el primer plan o desde Objetivo y datos): ahora sí.
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR"}, "persona", T0)
    m2 = M.mapa(e, INV)
    assert m2["misionAprobada"] is True and "Huecos de la misión sin cubrir: 1" in m2["resumen"]


def test_fallo_media_una_fuente_antigua_sin_metodo_da_la_cohorte_que_el_catalogo_lee_en_su_fragmento():
    """Gravedad media. 295 de las 440 fuentes de la base real son de antes de
    que el bucle guardara `metodo` en cada fuente, y 266 no traen `cohorte`.
    El índice solo mira `cohorte` y `metodo.cohorte`, así que la misma
    publicación aporta cohorte a su celda si se extrajo después de que
    existiera `metodo` y ninguna si se extrajo antes, aunque el catálogo
    (`metodos.metodo_de_fuente`) la identifique en su título o su fragmento.
    Medido sobre la copia de solo lectura: con `metodo_de_fuente` sobre las
    fuentes sin cohorte, las celdas sin hipótesis a 0 bajan de 10 a 2 en
    inv-mtwz8pbn-1, de 9 a 5 en inv-mtvw87yz-1 y de 4 a 2 en inv-mu1fyy6i-1;
    el constructor las dio por "no pude comprobar". Título y `nct` solos no
    rellenan ninguna (129 ms); lo que identifica es el fragmento (9,7 s en
    total), así que el arreglo va una sola vez (rellenar `metodo` en las
    fuentes antiguas al cargar el estado, como hace rosa/hechos.py `migrar`,
    o una caché por id de fuente), no en cada `mapa()`."""
    e = _estado()
    vieja = {**P.nueva_fuente(id="f-vieja", titulo="Plasma GFAP and amyloid positivity"), "cohorte": None, "fragmentos": [{"texto": "Participants were drawn from the BIOCARD study; plasma GFAP was measured by Simoa."}]}
    vieja.pop("metodo", None)
    nueva = {**copy.deepcopy(vieja), "id": "f-nueva"}
    nueva["metodo"] = METODOS.metodo_de_fuente(nueva)
    assert nueva["metodo"]["cohorte"]["etiqueta"] == "BIOCARD" and nueva["metodo"]["origen"] == "fragmento"
    _corrida(e, "cor-1", [_af("af-1", "", "f-vieja"), _af("af-2", "", "f-nueva")], [vieja, nueva])
    _hecho(e, CELDA_A, "he-vieja", afirmacion_ids=["af-1"], procedencia=[{"fuenteId": "f-vieja", "referencia": "A", "pagina": None}])
    _hecho(e, CELDA_B, "he-nueva", afirmacion_ids=["af-2"], procedencia=[{"fuenteId": "f-nueva", "referencia": "A", "pagina": None}])
    m = M.mapa(e, INV)
    # La misma publicación, el mismo fragmento: la celda de la fuente nueva la identifica.
    assert _celda(m, CLAVE_B)["cohortes"] == ["BIOCARD"]
    # ... y la de la fuente antigua tiene que identificarla igual.
    assert _celda(m, CLAVE_A)["cohortes"] == ["BIOCARD"]
    assert m["cohortesPorRegion"] == {"hipocampo": 1}


def test_fallo_baja_una_fuente_con_nct_y_sin_cohorte_da_su_ensayo_como_en_el_techo_grade():
    """Gravedad baja. `metodos._nombre` (la regla del techo GRADE y del
    ranking, que el módulo dice seguir) toma el `nct` de una fuente cuando no
    trae `cohorte`; el índice del mapa lo ignora. 35 fuentes de la base real
    tienen `nct` y ninguna cohorte en el índice (hoy ningún hecho vivo cuelga
    de ellas, por eso es baja). Arreglo: en `_indice_cohortes`, tras
    `metodo.cohorte`, `_nombres_cohorte(f.get("nct"))`."""
    e = _estado()
    fuente = {**P.nueva_fuente(id="f-nct", titulo="Donanemab in early symptomatic Alzheimer disease"), "cohorte": None, "nct": "NCT04437511"}
    fuente.pop("metodo", None)
    assert METODOS.cohortes_distintas([fuente]) == ["TRAILBLAZER-ALZ 2"]
    _corrida(e, "cor-1", [], [fuente])
    _hecho(e, CELDA_A, "he-1", procedencia=[{"fuenteId": "f-nct", "referencia": "A", "pagina": None}])
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == ["TRAILBLAZER-ALZ 2"]


def test_fallo_baja_la_misma_cohorte_libre_lleva_la_misma_etiqueta_en_todas_las_celdas():
    """Gravedad baja. Dos nombres libres que son la misma cohorte se agrupan,
    pero la etiqueta del grupo es "el primer nombre" en orden de llegada a la
    celda: la celda A la llama "Cohorte sueca de ADAD" y la celda B "ADAD
    longitudinal cohort study". En el atlas la misma cohorte aparece con dos
    nombres en celdas vecinas y la unión de etiquetas de la interfaz la cuenta
    dos veces (por eso el constructor tuvo que añadir `cohortesPorRegion`).
    Arreglo en `_cohortes_distintas`: agrupar con `metodos.agrupar_cohortes`
    y etiquetar cada grupo libre con un nombre estable (el menor en
    minúsculas de sus `nombres`), no con el primero que llegó."""
    e = _estado()
    _corrida(e, "cor-1", [_af("af-1", "Cohorte sueca de ADAD"), _af("af-2", "ADAD longitudinal cohort study")], [P.nueva_fuente(id="f-1", titulo="t")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1", "af-2"])
    _hecho(e, CELDA_B, "he-2", afirmacion_ids=["af-2", "af-1"])
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == _celda(m, CLAVE_B)["cohortes"]
    assert len({x for c in m["celdas"] for x in c["cohortes"]}) == m["cohortesPorRegion"]["hipocampo"] == 1


def test_fallo_baja_un_nombre_generico_no_es_una_cohorte_identificada():
    """Gravedad baja. "multiple population-based cohorts" (3 afirmaciones y 1
    fuente de la base real; en inv-gfap hace que preclínica · plasma ·
    astrocito diga 5 cohortes con 4 identificadas) y "múltiples ensayos de
    terapias dirigidas al amiloide" no nombran ninguna cohorte: son el
    extractor diciendo "varias". El módulo promete que un hecho sin cohorte
    identificada no aporta ninguna, y aquí aporta una con ese nombre. El
    arreglo va en rosa/metodos.py (`_tokens_cohorte` y las genéricas:
    "multiple", "múltiples", "varios", "several", "cohorts", "population-based"),
    para que el techo GRADE y el mapa sigan con la misma regla."""
    e = _estado()
    _corrida(e, "cor-1", [_af("af-1", "multiple population-based cohorts"), _af("af-2", "múltiples ensayos de terapias dirigidas al amiloide"), _af("af-3", "BIOCARD")], [P.nueva_fuente(id="f-1", titulo="t")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"])
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-2"])
    _hecho(e, CELDA_A, "he-3", afirmacion_ids=["af-3"])
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == ["BIOCARD"]


# ---------------------------------------------------------------------------
# Guardas: lo que se sostiene y debe seguir sosteniéndose
# ---------------------------------------------------------------------------


def test_guarda_el_mapa_no_muta_el_estado_ni_comparte_listas_con_el_indice():
    e = _estado()
    _corrida(e, "cor-1", [_af("af-1", "ADNI"), _af("af-2", ["BIOCARD", "A4"])], [{**P.nueva_fuente(id="f-1", titulo="t"), "cohorte": "DIAN"}])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1", "af-2"])
    _hecho(e, CELDA_B, "he-2", procedencia=[{"fuenteId": "f-1", "referencia": "A", "pagina": None}])
    antes = copy.deepcopy(e)
    m = M.mapa(e, INV)
    assert e == antes
    # Mutar lo devuelto no toca el estado ni el siguiente mapa.
    _celda(m, CLAVE_A)["cohortes"].append("basura")
    m["cohortesPorRegion"]["hipocampo"] = 99
    assert e == antes and M.mapa(e, INV) != m and _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == ["A4", "ADNI", "BIOCARD"]


def test_guarda_las_copias_reales_de_afirmaciones_de_una_hipotesis_llevan_afirmacion_id_y_cohorte_vacia():
    # En la base real las copias son {"afirmacionId", "cohorte": ""} (nunca "id"): con la cohorte
    # vacía, la hipótesis la toma de la afirmación de la corrida por `afirmacionId`.
    e = _estado()
    _corrida(e, "cor-1", [_af("af-1", "ADNI")], [P.nueva_fuente(id="f-1", titulo="t")])
    h = P.nueva_hipotesis(INV, 1, T0, id="hip-1", titulo=CELDA_A, afirmaciones=[{"afirmacionId": "af-1", "cohorte": ""}], cohortesDistintas=[])
    e["hipotesis"].append(h)
    m = M.mapa(e, INV)
    c = _celda(m, CLAVE_A)
    assert c["hipotesis"] == ["hip-1"] and c["cohortes"] == ["ADNI"] and m["cohortesPorRegion"] == {"hipocampo": 1}
    json.dumps(m, ensure_ascii=False)


def test_guarda_cohortes_por_region_queda_entre_el_maximo_de_una_celda_y_la_union_de_etiquetas():
    e = _estado()
    afs = [_af("af-1", "ADNI"), _af("af-2", "ADNI-3"), _af("af-3", "BIOCARD"), _af("af-4", "NCT04437511"), _af("af-5", "TRAILBLAZER-ALZ 2 (NCT04437511)")]
    _corrida(e, "cor-1", afs, [P.nueva_fuente(id="f-1", titulo="t")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1", "af-3"])
    _hecho(e, CELDA_B, "he-2", afirmacion_ids=["af-2", "af-4", "af-5"])
    m = M.mapa(e, INV)
    por_region = m["cohortesPorRegion"]
    assert set(por_region) == {"hipocampo"}
    celdas = [c for c in m["celdas"] if c["region"] == "hipocampo"]
    maximo = max(len(c["cohortes"]) for c in celdas)
    union = {x.casefold() for c in celdas for x in c["cohortes"]}
    assert maximo <= por_region["hipocampo"] <= len(union)
    assert por_region["hipocampo"] == 3  # ADNI, BIOCARD y TRAILBLAZER-ALZ 2 (las dos grafías del NCT son una)
