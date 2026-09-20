"""Cohortes de las celdas del mapa de la enfermedad y resumen coherente con las
celdas (rosa/mapa_enfermedad.py, 19 de septiembre de 2026).

Dos fallos vistos en el atlas de la interfaz el 18 y el 19 de septiembre:

1. `celda.cohortes` solo se llenaba con las cohortes de las afirmaciones de
   las HIPÓTESIS de la celda; los hechos no aportaban ninguna, así que toda
   celda sin hipótesis salía a 0 cohortes aunque tuviera decenas de hechos
   (66 de 66 en la investigación grande). Ahora cada hecho aporta las
   cohortes de sus afirmaciones enlazadas (`afirmacionIds`, buscadas en las
   claves privadas `_afirmaciones` de las corridas) y, si ninguna la trae,
   la cohorte de la fuente de su procedencia (`_fuentes`), agrupadas con el
   catálogo de rosa/metodos.py (alias, NCT, nombres libres).
2. El `resumen` se escribía con cifras que podían quedar desfasadas de sus
   propias celdas: ahora se calcula el último, de las celdas y los ejes ya
   construidos (`resumen_de`), y se puede rehacer sobre un mapa guardado
   cuyas celdas cambiaron después (fusión de hechos repetidos).

Además, `cohortesPorRegion` (clave de región a número de cohortes distintas,
deduplicadas entre las celdas de la región) para que la interfaz no lo rehaga.

Sin modelos: el mapa es una regla pura sobre el estado."""

from __future__ import annotations

import json
import re

import pytest

from rosa import mapa_enfermedad as M
from rosa import metodos as METODOS
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

INV = "inv-cohortes"
OTRA = "inv-otra"
T0 = 1_000_000

# Un texto que cae en una sola celda: prodrómica o DCL · hipocampo · astrocito.
CELDA_A = "Braak III-IV: astrogliosis en el hipocampo"
CLAVE_A = ("prodromica_dcl", "hipocampo", "astrocito")
# Otra celda de la misma región: preclínica · hipocampo · microglía.
CELDA_B = "Microglia activation in the hippocampus of cognitively unimpaired adults"
CLAVE_B = ("preclinica", "hipocampo", "microglia")
# Una celda de otra región: demencia leve · LCR · neurona.
CELDA_C = "Neuronal markers in CSF of CDR 1 patients"
CLAVE_C = ("demencia_leve", "lcr", "neurona")


@pytest.fixture
def e():
    estado = P.estado_inicial()
    assert A.crear_investigacion(estado, {"titulo": "T", "objetivo": "GFAP en astrocitos", "condicionParada": "3 iteraciones"}, T0, INV) == INV
    assert A.crear_investigacion(estado, {"titulo": "Otra", "objetivo": "O", "condicionParada": "1 iteración"}, T0, OTRA) == OTRA
    return estado


def _hecho(e, enunciado, id_, afirmacion_ids=None, procedencia=None, tipo="hecho", estado="sabido", inv=INV, **extra):
    h = P.nuevo_hecho(inv, tipo, "tema", enunciado, estado, "fuente", list(procedencia or []), T0, afirmacion_ids=list(afirmacion_ids or []))
    h["id"] = id_
    h.update(extra)
    e["hechos"].append(h)
    return h


def _hip(e, id_, titulo, inv=INV, **extra):
    h = P.nueva_hipotesis(inv, 1, T0, id=id_, titulo=titulo, **extra)
    e["hipotesis"].append(h)
    return h


def _af(id_, cohorte, fuente_id="f-1", **extra):
    return {"id": id_, "texto": "x", "fragmento": "y", "veredicto": "sostenida", "cohorte": cohorte, "fuenteId": fuente_id, "iteracion": 1, **extra}


def _fuente(id_, cohorte=None, **extra):
    return {**P.nueva_fuente(id=id_, titulo=f"Título de {id_}", cohorte=cohorte), **extra}


def _corrida(e, id_, afirmaciones=(), fuentes=(), inv=INV):
    c = {"id": id_, "investigacionId": inv, "numero": 1, "estado": "terminada", "_afirmaciones": list(afirmaciones), "_fuentes": {f["id"]: f for f in fuentes}}
    e["corridas"].append(c)
    return c


def _celda(m, clave):
    return next(c for c in m["celdas"] if (c["estadio"], c["region"], c["tipoCelular"]) == clave)


def _cifras(resumen):
    """(hechos, hipótesis, celdas) que dice la primera frase del resumen."""
    mr = re.match(r"(\d+) hechos? y (\d+) hipótesis situados en (\d+) celdas?", resumen)
    assert mr, resumen
    return tuple(int(x) for x in mr.groups())


# ---------------------------------------------------------------------------
# Fallo 1: los hechos aportan cohortes a su celda
# ---------------------------------------------------------------------------


def test_una_celda_sin_hipotesis_suma_las_cohortes_de_las_afirmaciones_de_sus_hechos(e):
    _corrida(e, "cor-1", [_af("af-1", "ADNI"), _af("af-2", "BIOCARD", "f-2")], [_fuente("f-1"), _fuente("f-2")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"], procedencia=[{"fuenteId": "f-1", "referencia": "A", "pagina": None}])
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-2"], procedencia=[{"fuenteId": "f-2", "referencia": "B", "pagina": None}])
    m = M.mapa(e, INV)
    c = _celda(m, CLAVE_A)
    assert c["hipotesis"] == [] and c["hechos"] == ["he-1", "he-2"]
    # Antes del 19 de septiembre esta celda salía a 0 cohortes.
    assert c["cohortes"] == ["ADNI", "BIOCARD"]
    assert c["certezaMax"] is None and "sin hipótesis" in c["certezaMotivo"]
    assert m["cohortesPorRegion"] == {"hipocampo": 2}
    # Todo serializable (viaja al navegador) y determinista.
    json.dumps(m, ensure_ascii=False)
    assert M.mapa(e, INV) == m


def test_los_alias_del_catalogo_se_deduplican_en_una_etiqueta_canonica(e):
    afs = [_af("af-1", "ADNI-3"), _af("af-2", "Alzheimer's Disease Neuroimaging Initiative"), _af("af-3", "adni"), _af("af-4", "NCT02008357")]
    _corrida(e, "cor-1", afs, [_fuente("f-1")])
    for i, aid in enumerate(("af-1", "af-2", "af-3", "af-4")):
        _hecho(e, CELDA_A, f"he-{i}", afirmacion_ids=[aid])
    c = _celda(M.mapa(e, INV), CLAVE_A)
    # Tres grafías de ADNI son una; el registro NCT02008357 es el ensayo A4.
    assert c["cohortes"] == ["A4", "ADNI"]


def test_dos_nombres_libres_que_son_la_misma_cohorte_cuentan_una_vez(e):
    # Ninguno está en el catálogo; comparten la palabra "ADAD" fuera de las genéricas
    # ("cohorte", "longitudinal", "study"): misma regla que el techo GRADE.
    _corrida(e, "cor-1", [_af("af-1", "Cohorte sueca de ADAD"), _af("af-2", "ADAD longitudinal cohort study"), _af("af-3", "Mi cohorte rara de Bogotá")], [_fuente("f-1")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"])
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-2"])
    _hecho(e, CELDA_A, "he-3", afirmacion_ids=["af-3"])
    c = _celda(M.mapa(e, INV), CLAVE_A)
    # La etiqueta de un grupo de nombres libres es el menor sin distinguir mayúsculas,
    # no el primero que llegó (19 de septiembre de 2026, adversario): así la misma
    # cohorte lleva el mismo nombre en todas las celdas.
    assert c["cohortes"] == ["ADAD longitudinal cohort study", "Mi cohorte rara de Bogotá"]
    assert M.mapa(e, INV)["cohortesPorRegion"] == {"hipocampo": 2}


def test_sin_cohorte_en_las_afirmaciones_vale_la_cohorte_de_la_fuente_de_la_procedencia(e):
    afs = [_af("af-sin", None, "f-1"), _af("af-vacia", "   ", "f-1"), _af("af-con", "ADNI", "f-3")]
    fuentes = [_fuente("f-1", "BioFINDER-2"), _fuente("f-2", "Knight ADRC"), _fuente("f-3", "BIOCARD"), _fuente("f-4", None, metodo={"cohorte": {"id": "cohorte:dian", "etiqueta": "DIAN", "tipo": "cohorte"}})]
    _corrida(e, "cor-1", afs, fuentes)
    # Afirmaciones sin cohorte: manda la fuente (BioFINDER-2 resuelve a BioFINDER).
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-sin", "af-vacia"], procedencia=[{"fuenteId": "f-1", "referencia": "A", "pagina": None}])
    # Sin afirmaciones enlazadas (registro antiguo, `afirmacionIds: null`): la fuente.
    _hecho(e, CELDA_A, "he-2", procedencia=[{"fuenteId": "f-2", "referencia": "B", "pagina": 3}], afirmacionIds=None)
    # Con cohorte en la afirmación, la fuente NO se suma: BIOCARD no aparece.
    _hecho(e, CELDA_A, "he-3", afirmacion_ids=["af-con"], procedencia=[{"fuenteId": "f-3", "referencia": "C", "pagina": None}])
    # Fuente sin `cohorte` pero con el método canónico: vale la del método.
    _hecho(e, CELDA_A, "he-4", procedencia=[{"fuenteId": "f-4", "referencia": "D", "pagina": None}])
    c = _celda(M.mapa(e, INV), CLAVE_A)
    assert c["cohortes"] == ["ADNI", "BioFINDER", "DIAN", "Knight ADRC"]


def test_un_hecho_sin_cohorte_identificada_no_aporta_ninguna(e):
    # Ni afirmaciones con cohorte ni fuente con cohorte: "no pude comprobar", nunca "sin cohorte".
    _corrida(e, "cor-1", [_af("af-1", None)], [_fuente("f-1")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"], procedencia=[{"fuenteId": "f-1", "referencia": "A", "pagina": None}])
    # Un id de afirmación y de fuente que no existen en ninguna corrida.
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-fantasma"], procedencia=[{"fuenteId": "f-fantasma", "referencia": "B", "pagina": None}])
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == [] and m["cohortesPorRegion"] == {"hipocampo": 0}


def test_las_afirmaciones_se_buscan_en_todas_las_corridas_tambien_para_un_hecho_heredado(e):
    # La afirmación vive en una corrida de OTRA investigación (hecho heredado, id con "-inv-").
    _corrida(e, "cor-otra", [_af("af-h", "A4")], [_fuente("f-1")], inv=OTRA)
    # Y otra en una segunda corrida de la misma investigación.
    _corrida(e, "cor-1", [], [])
    _corrida(e, "cor-2", [_af("af-2", "DIAN", "f-9")], [_fuente("f-9")])
    _hecho(e, CELDA_A, "he-h-inv-origen-" + OTRA, afirmacion_ids=["af-h"])
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-2"])
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == ["A4", "DIAN"] and m["heredados"] == 1


def test_una_pregunta_abierta_y_un_hecho_descartado_no_aportan_cohortes(e):
    _corrida(e, "cor-1", [_af("af-p", "ADNI"), _af("af-d", "BIOCARD"), _af("af-s", "DIAN")], [_fuente("f-1")])
    _hecho(e, "¿" + CELDA_A + "?", "he-p", afirmacion_ids=["af-p"], tipo="pregunta", estado="abierto")
    _hecho(e, CELDA_A, "he-d", afirmacion_ids=["af-d"], estado="descartado")
    _hecho(e, CELDA_A, "he-s", afirmacion_ids=["af-s"], sustituidoPor="he-otro")
    m = M.mapa(e, INV)
    c = _celda(m, CLAVE_A)
    assert c["preguntas"] == ["he-p"] and c["hechos"] == [] and c["cohortes"] == []
    assert m["cohortesPorRegion"] == {"hipocampo": 0}
    # Un hecho vivo sin cohorte en la misma celda no hereda la de la pregunta ni la del descartado.
    _hecho(e, CELDA_A, "he-vivo")
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == []


def test_las_hipotesis_siguen_aportando_y_se_funden_con_las_de_los_hechos(e):
    _corrida(e, "cor-1", [_af("af-1", "ADNI"), _af("af-2", None)], [_fuente("f-1"), _fuente("f-7", "Knight ADRC")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"])
    # (a) La regla de siempre: el campo cohorte de la copia de afirmaciones de la hipótesis.
    _hip(e, "hip-a", CELDA_A, afirmaciones=[{"texto": "x", "cohorte": "ADNI-GO"}, {"texto": "y", "cohorte": "BIOCARD"}, {"texto": "z", "cohorte": ""}], conclusion={"certeza": "baja"})
    # (b) Sin cohorte en las afirmaciones: la lista canónica del ranking.
    _hip(e, "hip-b", CELDA_A, afirmaciones=[{"texto": "x", "cohorte": None}], cohortesDistintas=["API Colombia"])
    # (c) Sin ninguna de las dos: las fuentes de la procedencia, por su campo o por su id en las corridas.
    _hip(e, "hip-c", CELDA_A, afirmaciones=[], cohortesDistintas=[], procedencia={"fuentes": [{"id": "f-5", "cohorte": "DIAN"}, {"id": "f-7"}], "mensajes": []})
    # (d) Una afirmación de la hipótesis sin cohorte pero con el id de la afirmación de la corrida.
    _hip(e, "hip-d", CELDA_A, afirmaciones=[{"texto": "x", "id": "af-1"}])
    m = M.mapa(e, INV)
    c = _celda(m, CLAVE_A)
    assert set(c["hipotesis"]) == {"hip-a", "hip-b", "hip-c", "hip-d"} and c["hechos"] == ["he-1"]
    # ADNI (hecho) y ADNI-GO (hipótesis) son una; el resto se suma.
    assert c["cohortes"] == ["ADNI", "API Colombia", "BIOCARD", "DIAN", "Knight ADRC"]
    assert c["certezaMax"] == "baja"
    assert m["cohortesPorRegion"] == {"hipocampo": 5}


# ---------------------------------------------------------------------------
# cohortesPorRegion
# ---------------------------------------------------------------------------


def test_cohortes_por_region_deduplica_entre_celdas_y_solo_lleva_regiones_con_clave(e):
    afs = [_af("af-1", "ADNI"), _af("af-2", "ADNI-3"), _af("af-3", "Cohorte sueca de ADAD"), _af("af-4", "ADAD longitudinal cohort study"), _af("af-5", "BIOCARD")]
    _corrida(e, "cor-1", afs, [_fuente("f-1")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1", "af-3"])  # hipocampo, celda A
    _hecho(e, CELDA_B, "he-2", afirmacion_ids=["af-2", "af-4"])  # hipocampo, celda B
    _hecho(e, CELDA_C, "he-3", afirmacion_ids=["af-5"])  # LCR
    # Un hecho con estadio pero sin región: su celda tiene región None y no entra en la cuenta por región.
    _hecho(e, "Pacientes con DCL amiloide positivo", "he-4", afirmacion_ids=["af-5"])
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == ["ADNI", "Cohorte sueca de ADAD"]
    assert _celda(m, CLAVE_B)["cohortes"] == ["ADAD longitudinal cohort study", "ADNI"]
    # Entre las dos celdas del hipocampo: ADNI y ADNI-3 son una; los dos nombres libres de ADAD son uno.
    # Se agrupan los NOMBRES, no las etiquetas ya agrupadas: por eso los libres cuentan una vez.
    assert m["cohortesPorRegion"] == {"hipocampo": 2, "lcr": 1}
    assert all(isinstance(k, str) and isinstance(v, int) for k, v in m["cohortesPorRegion"].items())
    assert None not in m["cohortesPorRegion"] and "None" not in m["cohortesPorRegion"]
    # Coincide con lo que la interfaz calcularía de las celdas de la región.
    assert m["cohortesPorRegion"]["lcr"] == len({co for c in m["celdas"] if c["region"] == "lcr" for co in c["cohortes"]})
    # Sin investigación ni celdas, el campo existe y está vacío.
    assert M.mapa(e, "inv-no")["cohortesPorRegion"] == {} and M.mapa(e, None)["cohortesPorRegion"] == {}


# ---------------------------------------------------------------------------
# Fallo 2: el resumen sale de las celdas
# ---------------------------------------------------------------------------


def _poblar(e):
    _corrida(e, "cor-1", [_af("af-1", "ADNI"), _af("af-2", "BIOCARD")], [_fuente("f-1")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"])
    _hecho(e, CELDA_A, "he-2", afirmacion_ids=["af-2"])
    _hecho(e, CELDA_B, "he-3")
    _hecho(e, CELDA_C + " and hippocampal astrocytes", "he-4")  # cae en dos celdas: cuenta un hecho
    _hecho(e, "GFAP sube antes que NfL", "he-5")  # sin ejes
    _hip(e, "hip-1", CELDA_A, conclusion={"certeza": "baja"})
    _hip(e, "hip-2", CELDA_C)
    return M.mapa(e, INV)


def test_el_resumen_cuenta_lo_mismo_que_sus_propias_celdas(e):
    m = _poblar(e)
    hechos, hips, celdas = _cifras(m["resumen"])
    assert hechos == len({x for c in m["celdas"] for x in c["hechos"]}) == 4
    assert hips == len({x for c in m["celdas"] for x in c["hipotesis"]}) == 2
    assert celdas == len(m["celdas"])
    assert "Sin situar: 1 hecho y 0 hipótesis" in m["resumen"]
    # Los ejes que cita el resumen son los del mapa.
    assert f"Regiones: {M._top(m['ejes']['region'], 'region')}" in m["resumen"]
    # Rehacerlo da el mismo texto: el resumen es una función de las celdas y los ejes.
    assert M.resumen_de(m) == m["resumen"]
    assert m["misionAprobada"] is False and "no tiene misión aprobada" in m["resumen"]


def test_resumen_de_sigue_a_las_celdas_cuando_una_fusion_remapea_los_ids(e):
    m = _poblar(e)
    guardado = json.loads(json.dumps(m))
    # Lo que hace rosa/hechos.py al fundir hechos repetidos: he-2 pasa a ser he-1
    # en todas las celdas, sin tocar el resumen guardado (el fallo del 19 de septiembre:
    # "217 hechos" en el texto con 211 en las celdas).
    for c in guardado["celdas"]:
        c["hechos"] = list(dict.fromkeys("he-1" if x == "he-2" else x for x in c["hechos"]))
    assert _cifras(guardado["resumen"])[0] == 4  # el texto viejo sigue diciendo 4
    nuevo = M.resumen_de(guardado)
    assert _cifras(nuevo) == (3, 2, len(guardado["celdas"]))
    assert nuevo != guardado["resumen"]
    # El resto del texto no cambia: mismos ejes, mismo "sin situar", misma misión.
    assert nuevo.split(". ", 1)[1] == guardado["resumen"].split(". ", 1)[1]


def test_resumen_de_lee_un_mapa_guardado_por_una_version_anterior_y_basura():
    # Sin `misionAprobada` ni `cohortesPorRegion`, con números como texto y huecos incompletos.
    viejo = {"celdas": [{"estadio": "prodromica_dcl", "region": "plasma", "tipoCelular": None, "hechos": ["a", "b"], "hipotesis": ["h"]}, "basura", {"hechos": "x"}], "ejes": {"region": {"plasma": "2", "lcr": None}, "nivel": "x"}, "huecos": [{"estadio": "preclinica"}, "basura"], "sinEjes": "2", "hipotesisSinEjes": None, "heredados": True, "mision": {"estadios": ["preclinica"], "region": [], "tipoCelular": "x"}}
    t = M.resumen_de(viejo)
    assert t.startswith("2 hechos y 1 hipótesis situados en 2 celdas")
    assert "Regiones: sangre, plasma y suero (compartimento periférico) 2." in t
    assert "Sin situar: 2 hechos y 0 hipótesis" in t and "heredado" not in t  # True no es un número
    # Sin la clave, una misión con ejes se toma por aprobada y sus huecos se cuentan.
    assert "Huecos de la misión sin cubrir: 1 (preclínica)" in t
    # Con la clave a False, manda la clave.
    assert "no tiene misión aprobada" in M.resumen_de({**viejo, "misionAprobada": False})
    # Aprobada pero sin ejes: lo dice.
    assert "no fija estadio, región ni tipo celular" in M.resumen_de({**viejo, "misionAprobada": True, "mision": {}})
    # Lo que no es un mapa.
    for basura in (None, "x", 3, [], {}, {"celdas": None}):
        assert "Todavía no hay hechos ni hipótesis" in M.resumen_de(basura)
    assert "\u2014" not in t


def test_el_mapa_con_mision_dice_si_esta_aprobada_y_sus_huecos_salen_de_las_celdas(e):
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR"}, "persona", T0)
    m = _poblar(e)
    assert m["misionAprobada"] is True
    assert [(h["estadio"], h["region"], h["tipoCelular"]) for h in m["huecos"]] == [("prodromica_dcl", "lcr", "astrocito")]
    assert "Huecos de la misión sin cubrir: 1" in m["resumen"] and M.resumen_de(m) == m["resumen"]


# ---------------------------------------------------------------------------
# Lo que no rompe
# ---------------------------------------------------------------------------


def test_corridas_afirmaciones_y_fuentes_raras_no_rompen_y_los_nodos_y_listas_cuentan(e):
    afs = [None, 3, "x", {"id": None, "cohorte": "ADNI"}, {"cohorte": "ADNI"}, {"id": "af-nodo", "cohorte": {"id": "cohorte:adni", "etiqueta": "ADNI"}}, {"id": "af-id", "cohorte": {"id": "cohorte:dian"}}, {"id": "af-lista", "cohorte": ["BIOCARD", "A4", 5]}, {"id": "af-num", "cohorte": 5}, {"id": "af-bool", "cohorte": True}, {"id": "af-bytes", "cohorte": b"Knight ADRC"}, {"id": "af-dup", "cohorte": "BioFINDER"}]
    e["corridas"].extend([None, "x", 3, {"id": "cor-sin"}, {"id": "cor-none", "_afirmaciones": None, "_fuentes": None}, {"id": "cor-texto", "_afirmaciones": "x", "_fuentes": "y"}, {"id": "cor-dict", "_afirmaciones": {"id": "af-d", "cohorte": "ADNI"}, "_fuentes": {"f-lista": None, "f-ok": {"cohorte": "API Colombia"}}}])
    _corrida(e, "cor-1", afs, [])
    # Una segunda corrida con el mismo id de afirmación: gana la primera.
    _corrida(e, "cor-2", [{"id": "af-dup", "cohorte": "ADNI"}], [])
    # `_fuentes` como lista en vez de diccionario, y una fuente con `metodo` que no es diccionario.
    e["corridas"].append({"id": "cor-lista", "_fuentes": [{"id": "f-l", "cohorte": "DIAN"}, "basura", {"id": "f-m", "cohorte": None, "metodo": "x"}]})
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-nodo", "af-id", "af-lista", "af-num", "af-bool", "af-bytes", "af-dup", None, 3, "af-no"])
    _hecho(e, CELDA_A, "he-2", afirmacionIds="x", procedencia="basura")
    _hecho(e, CELDA_A, "he-3", afirmacionIds=[3, None], procedencia=[None, "x", {"fuenteId": None}, {"fuenteId": "f-l"}, {"id": "f-ok"}, {"fuenteId": "f-m"}])
    _hecho(e, CELDA_A, "he-4", afirmacionIds=None, procedencia={"fuentes": [{"fuenteId": "f-ok"}]})
    m = M.mapa(e, INV)
    c = _celda(m, CLAVE_A)
    assert c["hechos"] == ["he-1", "he-2", "he-3", "he-4"]
    # af-nodo (ADNI por su etiqueta), af-id (DIAN por su identificador), af-lista (BIOCARD y A4),
    # af-bytes (Knight ADRC), af-dup (BioFINDER, la primera corrida); he-3 trae DIAN y API Colombia
    # por sus fuentes; he-4 API Colombia por una procedencia con forma de diccionario.
    assert c["cohortes"] == ["A4", "ADNI", "API Colombia", "BIOCARD", "BioFINDER", "DIAN", "Knight ADRC"]
    json.dumps(m, ensure_ascii=False)


def test_si_el_catalogo_falla_la_celda_se_deduplica_por_el_nombre(e, monkeypatch):
    _corrida(e, "cor-1", [_af("af-1", "ADNI"), _af("af-2", "adni"), _af("af-3", "ADNI-3")], [_fuente("f-1")])
    for i, aid in enumerate(("af-1", "af-2", "af-3")):
        _hecho(e, CELDA_A, f"he-{i}", afirmacion_ids=[aid])

    def rompe(*_a, **_k):
        raise RuntimeError("catálogo roto a propósito")

    monkeypatch.setattr(METODOS, "agrupar_cohortes", rompe)
    m = M.mapa(e, INV)
    # Sin catálogo no se sabe que ADNI-3 es ADNI, pero "ADNI" y "adni" siguen siendo uno y el mapa se construye.
    assert _celda(m, CLAVE_A)["cohortes"] == ["ADNI", "ADNI-3"] and m["cohortesPorRegion"] == {"hipocampo": 2}


def test_nombres_de_cohorte_y_union_sin_distinguir_mayusculas():
    assert M._nombres_cohorte("  ADNI   3 ") == ["ADNI 3"]
    assert M._nombres_cohorte({"id": "cohorte:adni", "etiqueta": "ADNI"}) == ["ADNI"]
    assert M._nombres_cohorte({"id": "cohorte:adni"}) == ["cohorte:adni"]
    assert M._nombres_cohorte({"nombre": "X", "texto": "Y"}) == ["X"]
    assert M._nombres_cohorte(["A", "a", {"etiqueta": "B"}, None, 3, ["C"]]) == ["A", "B", "C"]
    for nada in (None, 0, 1.5, True, False, {}, [], "", "   ", {"etiqueta": None}, object()):
        assert M._nombres_cohorte(nada) == []
    destino = ["ADNI"]
    M._unir_nombres(destino, ["adni", "BIOCARD", "biocard", "ADNI"])
    assert destino == ["ADNI", "BIOCARD"]
    assert M._cohortes_distintas([]) == [] and M._cohortes_distintas(["", "  ", None, 3]) == []  # type: ignore[list-item]
    assert M._cohortes_distintas(["biocard", "ADNI-GO", "Alzheimer's Disease Neuroimaging Initiative"]) == ["ADNI", "BIOCARD"]


# ---------------------------------------------------------------------------
# El texto para el prompt y la pantalla
# ---------------------------------------------------------------------------


def test_texto_mapa_ensena_las_cohortes_de_las_celdas_sin_hipotesis_y_la_cuenta_por_region(e):
    m = _poblar(e)
    t = M.texto_mapa(e, INV, precalculado=m)
    assert "las cohortes de una celda son las que nombran las afirmaciones de sus hechos e hipótesis" in t
    linea_a = next(l for l in t.splitlines() if l.startswith("- prodrómica o DCL · hipocampo · astrocito:"))
    assert "cohortes: ADNI, BIOCARD" in linea_a
    assert "Cohortes distintas por región (una cohorte nombrada por varios registros cuenta una vez): hipocampo 2." in t
    # La línea por región no es una viñeta: no altera la cuenta de celdas y huecos.
    assert t.count("\n- ") == len(m["celdas"]) + len(m["huecos"])
    # Un mapa guardado sin la clave, o con basura en ella, no la escribe.
    t2 = M.texto_mapa({}, INV, precalculado={**m, "cohortesPorRegion": None})
    assert "Cohortes distintas por región" not in t2
    t3 = M.texto_mapa({}, INV, precalculado={**m, "cohortesPorRegion": {"hipocampo": "x", "lcr": 0, 5: -1}})
    assert "Cohortes distintas por región" not in t3
    # Sin guiones largos ni palabras sin tilde en lo nuevo.
    for texto in (t, m["resumen"]):
        assert "\u2014" not in texto
        for mal in ("region", "hipotesis", "segun", "mision", "todavia"):
            assert not re.search(rf"\b{mal}\b", texto.lower()), mal


def test_el_coste_del_indice_de_cohortes_no_crece_con_las_corridas_de_otras_investigaciones(e):
    # Muchas corridas ajenas con muchas afirmaciones: el índice se construye una vez por mapa
    # y el catálogo se consulta una vez por nombre distinto de cada celda.
    for k in range(20):
        _corrida(e, f"cor-ajena-{k}", [_af(f"af-{k}-{i}", f"Cohorte {i % 7}") for i in range(200)], [], inv=OTRA)
    _corrida(e, "cor-1", [_af(f"af-{i}", ["ADNI", "BIOCARD", "DIAN"][i % 3]) for i in range(60)], [_fuente("f-1")])
    for i in range(60):
        _hecho(e, CELDA_A if i % 2 else CELDA_B, f"he-{i}", afirmacion_ids=[f"af-{i}"])
    llamadas = []
    original = METODOS.agrupar_cohortes

    def contar(fuentes):
        llamadas.append(len(fuentes))
        return original(fuentes)

    import pytest as _pytest

    mp = _pytest.MonkeyPatch()
    mp.setattr(METODOS, "agrupar_cohortes", contar)
    try:
        m = M.mapa(e, INV)
    finally:
        mp.undo()
    assert _celda(m, CLAVE_A)["cohortes"] == ["ADNI", "BIOCARD", "DIAN"] and m["cohortesPorRegion"] == {"hipocampo": 3}
    # Dos celdas más una región: tres agrupaciones, cada una con tres nombres distintos, no sesenta.
    assert llamadas == [3, 3, 3]
