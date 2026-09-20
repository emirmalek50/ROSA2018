"""Mapa del estado de la enfermedad (rosa/mapa_enfermedad.py): estadio por
Braak, CDR, MMSE, Thal, CERAD y palabras; región y tipo celular por texto y
por ids UBERON y CL; prioridad tarjeta, entidades, texto, afirmaciones,
misión; el mapa con celdas, certeza máxima, huecos y lo que no se sitúa;
registros antiguos, basura, ids heredados con "-inv-", textos en inglés y
castellano con y sin tildes."""

import json
import re

import pytest

from rosa import mapa_enfermedad as M
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

INV = "inv-mapa"
T0 = 1_000_000


@pytest.fixture
def e():
    estado = P.estado_inicial()
    assert A.crear_investigacion(estado, {"titulo": "T", "objetivo": "GFAP en astrocitos", "condicionParada": "3 iteraciones"}, T0, INV) == INV
    return estado


def _inv(e):
    return next(i for i in e["investigaciones"] if i["id"] == INV)


def _hecho(e, enunciado, tipo="hecho", estado="sabido", inv=INV, id_=None, **extra):
    h = P.nuevo_hecho(inv, tipo, "tema", enunciado, estado, "fuente", [], T0)
    if id_:
        h["id"] = id_
    h.update(extra)
    e["hechos"].append(h)
    return h


def _hip(e, id_, titulo, enunciado="", inv=INV, **extra):
    h = P.nueva_hipotesis(inv, 1, T0, id=id_, titulo=titulo, enunciado=enunciado, **extra)
    e["hipotesis"].append(h)
    return h


def _ent(id_, etiqueta, onto=None, alias=None):
    return {"id": id_, "etiqueta": etiqueta, "ontologia": onto or id_.split(":")[0], "tipo": "x", "alias": alias or []}


# ---------------------------------------------------------------------------
# Estadio
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "texto, esperado, en_motivo",
    [
        ("Braak stage I-II tau in the transentorhinal region", "preclinica", "Braak I a II"),
        ("Braak III-IV neurofibrillary tangles", "prodromica_dcl", "Braak III a IV"),
        ("Estadio Braak V con astrogliosis", "demencia_leve", "Braak V"),
        ("Braak VI cases", "demencia_moderada_grave", "Braak VI"),
        ("Braak stage 3", "prodromica_dcl", "Braak 3"),
        ("Braak V/VI isocortical", "demencia_leve", "cruza fases"),
        ("CDR 0 controls", "preclinica", "CDR global 0"),
        ("Participants with CDR 0.5", "prodromica_dcl", "CDR global 0,5"),
        ("CDR global 1 at baseline", "demencia_leve", "CDR global 1"),
        ("CDR = 2", "demencia_moderada_grave", "CDR global 2"),
        ("CDR of 3", "demencia_moderada_grave", "CDR global 3"),
    ],
)
def test_braak_y_cdr_resuelven_estadio(texto, esperado, en_motivo):
    ej = M.ejes_de_texto(texto)
    assert ej["estadio"] == esperado
    assert en_motivo in ej["motivos"]["estadio"]


def test_cdr_sb_y_braak_cero_no_son_estadio():
    # CDR-SB (suma de cajas, de 0 a 18) no es la escala global: "4.5" no se lee como CDR.
    assert M.ejes_de_texto("CDR-SB 4.5 at baseline")["estadio"] is None
    assert M.ejes_de_texto("CDR sum of boxes 2")["estadio"] is None
    # Braak 0 (sin ovillos) no es un estadio de la enfermedad.
    assert M.ejes_de_texto("Braak 0 controls")["estadio"] is None
    # "Braak staging" sin número tampoco.
    assert M.ejes_de_texto("Braak staging was performed")["estadio"] is None


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("MMSE 28", "preclinica"),
        ("MMSE score of 25", "prodromica_dcl"),
        ("MMSE = 22", "demencia_leve"),
        ("MMSE 15", "demencia_moderada_grave"),
        ("MMSE 20-26", "demencia_leve"),  # punto medio 23
        ("MMSE > 26", "preclinica"),  # se lee como 27
        ("MMSE < 20", "demencia_moderada_grave"),
        ("MMSE 45", None),  # fuera de escala
        ("Thal phase 1 amyloid", "preclinica"),
        ("Thal 3", "prodromica_dcl"),
        ("Thal phase 5", "demencia_moderada_grave"),
        ("CERAD frequent neuritic plaques", "demencia_moderada_grave"),
        ("CERAD score B", "prodromica_dcl"),
        ("placas CERAD escasas", "preclinica"),
    ],
)
def test_mmse_thal_y_cerad(texto, esperado):
    assert M.ejes_de_texto(texto)["estadio"] == esperado


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Preclinical Alzheimer's disease in ADNI", "preclinica"),
        ("Fase preclínica de la enfermedad", "preclinica"),
        (M.normalizar("Fase preclínica de la enfermedad"), "preclinica"),  # sin tildes ni mayúsculas
        ("Cognitively unimpaired amyloid-positive adults", "preclinica"),
        ("Adultos cognitivamente sanos", "preclinica"),
        ("Preclinical models in mice show gliosis", None),  # investigación en animales, no la fase
        ("preclinical studies of the compound", None),
        ("Prodromal AD", "prodromica_dcl"),
        ("Deterioro cognitivo leve amiloide positivo", "prodromica_dcl"),
        ("pacientes con DCL", "prodromica_dcl"),
        ("MCI due to AD", "prodromica_dcl"),
        ("Mild AD dementia", "demencia_leve"),
        ("Demencia leve por Alzheimer", "demencia_leve"),
        ("early-stage Alzheimer's", "demencia_leve"),
        ("Moderate to severe AD", "demencia_moderada_grave"),
        ("Demencia moderada a grave", "demencia_moderada_grave"),
        ("Alzheimer avanzado", "demencia_moderada_grave"),
        ("moderate evidence of an effect", None),  # "moderate" sin demencia ni Alzheimer no es estadio
        ("ADAD carriers", "autosomico_dominante"),
        ("DIAN observational study", "autosomico_dominante"),
        ("PSEN1 E280A kindred", "autosomico_dominante"),
        ("Portadores de mutación en presenilina 2", "autosomico_dominante"),
        ("Alzheimer familiar autosómico dominante", "autosomico_dominante"),
        ("Mutaciones en APP duplicadas", "autosomico_dominante"),
        ("APP processing by BACE1 in sporadic AD", None),  # APP a secas es la proteína precursora
        ("amyloid precursor protein (APP) cleavage", None),
    ],
)
def test_palabras_en_ingles_y_castellano(texto, esperado):
    assert M.ejes_de_texto(texto)["estadio"] == esperado


def test_prioridad_entre_clases_y_los_demas_quedan_en_el_motivo():
    # La forma autosómica dominante define la población y gana a la fase.
    ej = M.ejes_de_texto("Presymptomatic PSEN1 carriers in DIAN")
    assert ej["estadio"] == "autosomico_dominante" and "también se nombra: preclínica" in ej["motivos"]["estadio"]
    # Palabra clínica gana a Braak aunque Braak aparezca antes en el texto.
    ej = M.ejes_de_texto("Braak V cases with mild cognitive impairment")
    assert ej["estadio"] == "prodromica_dcl" and "demencia leve" in ej["motivos"]["estadio"]
    # CDR (clínico) gana al MMSE; MMSE gana a Thal.
    assert M.ejes_de_texto("MMSE 28 and CDR 1")["estadio"] == "demencia_leve"
    assert M.ejes_de_texto("Thal 5, MMSE 28")["estadio"] == "preclinica"
    # Dentro de la misma clase, el primero que aparece.
    ej = M.ejes_de_texto("Mild-to-moderate AD dementia")
    assert ej["estadio"] == "demencia_leve" and "demencia moderada o grave" in ej["motivos"]["estadio"]
    # La lista completa, ordenada y sin repetir.
    todos = M.estadios_de_texto("Braak III-IV, CDR 0.5, MCI, MMSE 25")
    assert [x["estadio"] for x in todos] == ["prodromica_dcl"]
    assert all({"estadio", "regla", "clase", "posicion", "motivo"} <= set(x) for x in todos)


def test_el_motivo_cita_el_fragmento_original_con_sus_tildes():
    ej = M.ejes_de_texto("Pacientes en fase prodrómica con astrocitos reactivos en el hipocampo")
    assert "«prodrómica»" in ej["motivos"]["estadio"]
    assert "«hipocampo»" in ej["motivos"]["region"]["hipocampo"]
    assert "«astrocitos»" in ej["motivos"]["tipoCelular"]["astrocito"]


# ---------------------------------------------------------------------------
# Región y tipo celular
# ---------------------------------------------------------------------------


def test_cl_y_uberon_resuelven_celula_y_region():
    ents = [_ent("CL:0000127", "astrocyte"), _ent("CL:0000129", "microglial cell"), _ent("UBERON:0002421", "hippocampal formation"), _ent("UBERON:0001359", "cerebrospinal fluid"), _ent("HGNC:4235", "GFAP"), _ent("MONDO:0004975", "Alzheimer disease")]
    ej = M.ejes_de_texto("texto sin nada útil", ents)
    assert ej["tipoCelular"] == ["astrocito", "microglia"]
    assert ej["region"] == ["hipocampo", "lcr"]
    assert ej["motivos"]["tipoCelular"]["astrocito"] == "entidad CL:0000127 (astrocyte)"
    assert ej["motivos"]["region"]["hipocampo"].startswith("entidad UBERON:0002421")
    # HGNC da nivel molecular, CL nivel celular, UBERON de región nivel tisular; el LCR no es tisular.
    assert ej["nivel"] == ["molecular", "celular", "tisular"]
    assert M.ejes_de_texto("", [_ent("UBERON:0001359", "cerebrospinal fluid")])["nivel"] == []


def test_una_entidad_uberon_o_cl_fuera_de_la_tabla_se_resuelve_por_su_etiqueta_o_alias():
    ej = M.ejes_de_texto("", [_ent("UBERON:0999999", "entorhinal cortex layer II"), _ent("CL:0999999", "reactive glial cell", alias=["A1 astrocyte"]), _ent("cl:0000669", "pericyte")])
    assert ej["region"] == ["corteza_entorrinal"]
    assert ej["tipoCelular"] == ["astrocito", "pericito"]  # alias y prefijo en minúsculas
    assert "por su etiqueta" in ej["motivos"]["region"]["corteza_entorrinal"]
    # Una entidad que no se reconoce ni por id ni por etiqueta no situa nada.
    assert M.ejes_de_texto("", [_ent("UBERON:0999998", "some obscure structure")])["region"] == []


def test_entidades_malformadas_no_rompen():
    for basura in (None, "CL:0000127", 42, {}, [None, "x", 3, {"id": None}, {"id": 5}, {"etiqueta": "astrocyte"}], [{"id": "CL:0000127"}]):
        ej = M.ejes_de_texto("hipocampo", basura)
        assert ej["region"] == ["hipocampo"]
    assert M.ejes_de_texto("", [{"id": "CL:0000127"}])["tipoCelular"] == ["astrocito"]  # sin etiqueta


@pytest.mark.parametrize(
    "texto, regiones, tipos",
    [
        ("GFAP plasmática en el hipocampo", ["hipocampo", "plasma"], []),
        ("hippocampal CA1 pyramidal neurons", ["hipocampo"], ["neurona"]),
        ("Entorhinal cortex and prefrontal cortex", ["corteza_entorrinal", "corteza_prefrontal"], []),
        ("corteza temporal y cerebelo", ["corteza_temporal", "cerebelo"], []),
        ("CSF and serum NfL", ["plasma", "lcr"], []),
        ("líquido cefalorraquídeo", ["lcr"], []),
        (M.normalizar("líquido cefalorraquídeo"), ["lcr"], []),  # sin tildes
        ("Plasma membrane lipid rafts", [], []),  # la membrana plasmática no es el plasma
        ("membrana plasmática de la neurona", [], ["neurona"]),
        ("blood-brain barrier pericytes", ["vascular_bhe"], ["pericito"]),
        ("peripheral blood monocytes", ["plasma"], ["inmune_periferico"]),
        ("Oligodendrocyte precursor cells (OPCs)", [], ["opc"]),
        ("Oligodendrocytes and OPCs", [], ["oligodendrocito", "opc"]),
        ("microglía y astrocitos reactivos", [], ["astrocito", "microglia"]),
        ("microglia and astrocytes", [], ["astrocito", "microglia"]),
        ("endothelial cells of the neurovascular unit", ["vascular_bhe"], ["endotelio"]),
        ("cerebral cortex and brain", ["neocorteza"], []),  # genéricas: corteza gana a cerebro
        ("brain GFAP", ["cerebro_sin_region"], []),
        ("brain, cortex and hippocampus", ["hipocampo"], []),  # una concreta quita las genéricas
        ("plasma and brain", ["plasma", "cerebro_sin_region"], []),  # el plasma no es del sistema nervioso: la genérica queda
        ("precuneus and posterior cingulate", ["cingulo_precuneo"], []),
        ("amígdala y locus coeruleus", ["amigdala", "tronco_locus_coeruleus"], []),
        ("gut microbiota", ["intestino_microbiota"], []),
        ("retinal nerve fiber layer (RNFL)", ["retina"], []),
        ("", [], []),
    ],
)
def test_regiones_y_tipos_por_texto(texto, regiones, tipos):
    ej = M.ejes_de_texto(texto)
    assert sorted(ej["region"]) == sorted(regiones)
    assert sorted(ej["tipoCelular"]) == sorted(tipos)


def test_nivel_por_texto():
    assert M.ejes_de_texto("GFAP protein expression")["nivel"] == ["molecular"]
    assert M.ejes_de_texto("single-cell RNA-seq of astrocytes")["nivel"] == ["celular"]
    assert M.ejes_de_texto("atrofia hipocampal en resonancia")["nivel"] == ["tisular"]
    assert M.ejes_de_texto("pacientes con demencia y MMSE 20")["nivel"] == ["clinico"]
    assert M.ejes_de_texto("plasma GFAP in MCI patients")["nivel"] == ["molecular", "clinico"]
    assert M.ejes_de_texto("nada que ver")["nivel"] == []


def test_entradas_vacias_o_raras_en_ejes_de_texto():
    for x in ("", None, 0, 12.5, False, [], {}, ["Braak", "III"], {"a": "CDR 0.5"}):
        ej = M.ejes_de_texto(x)
        assert set(ej) == {"estadio", "estadios", "region", "tipoCelular", "nivel", "motivos"}
    assert M.ejes_de_texto(["Braak", "III"])["estadio"] == "prodromica_dcl"  # una lista se lee unida
    assert M.ejes_de_texto({"a": "CDR 0.5"})["estadio"] == "prodromica_dcl"
    # Guiones tipográficos y símbolos de comparación se leen como los ASCII.
    assert M.ejes_de_texto("Braak III\u2013IV")["estadio"] == "prodromica_dcl"  # guion corto tipográfico, como escape
    assert M.ejes_de_texto("MMSE ≥ 27")["estadio"] == "preclinica"
    # La normalización conserva la longitud: las posiciones sirven para citar el original.
    for t in ("áéíóúñÑ ß β Aβ42", "cañón ﬁ", "x"):
        assert len(M.normalizar(t)) == len(t)


def test_etiquetas_en_castellano_con_tildes():
    assert M.etiqueta("estadio", "prodromica_dcl") == "prodrómica o DCL"
    assert M.etiqueta("estadio", "autosomico_dominante") == "autosómica dominante"
    assert M.etiqueta("tipoCelular", "microglia") == "microglía"
    assert M.etiqueta("region", "lcr") == "líquido cefalorraquídeo (LCR)"
    assert M.etiqueta("region", "amigdala") == "amígdala"
    assert M.etiqueta("nivel", "clinico") == "clínico"
    assert M.etiqueta("estadio", None) == "sin situar"
    assert M.etiqueta("region", "desconocida") == "desconocida"
    # Los identificadores de los ejes no llevan tilde; las etiquetas, todas.
    for tabla in (M.ETIQUETAS_ESTADIO, M.ETIQUETAS_REGION, M.ETIQUETAS_TIPO_CELULAR, M.ETIQUETAS_NIVEL):
        for clave in tabla:
            assert clave == M.normalizar(clave).replace(" ", "_") and clave.isascii()


# ---------------------------------------------------------------------------
# Hecho, hipótesis y misión
# ---------------------------------------------------------------------------


def test_ejes_de_hecho_combina_entidades_y_texto_con_origen(e):
    h = P.nuevo_hecho(INV, "hecho", "biomarcadores", "En Braak III-IV la GFAP plasmática sube", "sabido", "fuente", [], T0)
    h["entidades"] = [_ent("CL:0000127", "astrocyte"), _ent("UBERON:0002421", "hippocampal formation")]
    ej = M.ejes_de_hecho(h, _inv(e))
    assert ej["estadio"] == "prodromica_dcl" and ej["origen"]["estadio"] == "texto"
    assert ej["region"] == ["hipocampo", "plasma"] and ej["origen"]["region"] == "entidades"  # las entidades van primero; el texto se une
    assert ej["tipoCelular"] == ["astrocito"] and ej["origen"]["tipoCelular"] == "entidades"
    assert ej["motivos"]["region"]["plasma"].startswith("texto:") and ej["motivos"]["region"]["hipocampo"].startswith("entidades:")
    assert ej["situado"] is True and ej["sinMision"] == {"estadio": "prodromica_dcl", "estadios": ["prodromica_dcl"], "region": ["hipocampo", "plasma"], "tipoCelular": ["astrocito"]}
    # El tema también cuenta como texto propio.
    h2 = P.nuevo_hecho(INV, "hecho", "cerebelo", "Nada más", "sabido", "fuente", [], T0)
    assert M.ejes_de_hecho(h2)["region"] == ["cerebelo"]


def test_ejes_de_hipotesis_prioridad_tarjeta_entidades_texto_afirmaciones():
    h = P.nueva_hipotesis(INV, 1, T0, id="hip-p", titulo="GFAP en LCR sube en Braak V", enunciado="", mecanismo="astrogliosis", tarjeta={**P.tarjeta_vacia(), "etapa": "preclínica", "celula": "microglía"}, entidades=[_ent("UBERON:0002421", "hippocampal formation")], afirmaciones=[{"texto": "Neurons in CDR 3 patients", "cohorte": "ADNI", "veredicto": "sostenida"}])
    ej = M.ejes_de_hipotesis(h)
    # La tarjeta manda en el estadio aunque el texto diga Braak V.
    assert ej["estadio"] == "preclinica" and ej["origen"]["estadio"] == "tarjeta"
    # Las listas se unen: tarjeta (microglía), entidades (hipocampo), texto (LCR, astrocito).
    assert ej["tipoCelular"] == ["microglia", "astrocito"] and ej["origen"]["tipoCelular"] == "tarjeta"
    assert ej["region"] == ["hipocampo", "lcr"] and ej["origen"]["region"] == "entidades"
    # Las afirmaciones no añaden nada cuando el eje ya tiene valor (la neurona de la afirmación no entra).
    assert "neurona" not in ej["tipoCelular"]
    # Sin tarjeta ni texto útil, las afirmaciones rellenan lo vacío y se marcan como origen.
    h2 = P.nueva_hipotesis(INV, 1, T0, id="hip-q", titulo="Algo", enunciado="cambia", afirmaciones=[{"texto": "In MCI plasma GFAP rises", "cohorte": "BIOCARD"}])
    ej2 = M.ejes_de_hipotesis(h2)
    assert ej2["estadio"] == "prodromica_dcl" and ej2["origen"] == {"estadio": "afirmaciones", "region": "afirmaciones", "tipoCelular": None, "nivel": "afirmaciones"}
    # Una tarjeta con etapa "sin fijar" o "varias" no situa.
    h3 = P.nueva_hipotesis(INV, 1, T0, id="hip-r", titulo="Algo", tarjeta={**P.tarjeta_vacia(), "etapa": "sin fijar", "celula": "varias"})
    assert M.ejes_de_hipotesis(h3)["situado"] is False


def test_mision_rellena_huecos_solo_en_lo_ya_situado(e):
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con deterioro cognitivo leve amiloide positivos", "etapa": "preclínica y prodrómica", "celulaTejido": "astrocitos y plasma"}, "persona", T0)
    inv = _inv(e)
    mis = M.ejes_de_mision(inv)
    assert mis["estadios"] == ["preclinica", "prodromica_dcl"] and mis["estadio"] == "preclinica"
    assert mis["region"] == ["plasma"] and mis["tipoCelular"] == ["astrocito"]
    assert mis["motivos"]["estadios"]["prodromica_dcl"].startswith("misión (etapa)")
    # Un hecho que solo nombra la región recibe el tipo celular de la misión, con origen "mision".
    # El estadio no: la misión abarca dos fases y elegir una sería inventar en cuál está el dato.
    h = P.nuevo_hecho(INV, "hecho", "t", "Cambios en el hipocampo", "sabido", "fuente", [], T0)
    ej = M.ejes_de_hecho(h, inv)
    assert ej["estadio"] is None and ej["origen"]["estadio"] is None
    assert "abarca varias fases (preclínica, prodrómica o DCL)" in ej["motivos"]["estadio"]
    assert ej["tipoCelular"] == ["astrocito"] and ej["origen"]["tipoCelular"] == "mision"
    assert ej["region"] == ["hipocampo"] and ej["origen"]["region"] == "texto"
    assert ej["sinMision"] == {"estadio": None, "estadios": [], "region": ["hipocampo"], "tipoCelular": []}
    assert ej["motivos"]["tipoCelular"]["astrocito"].startswith("misión (celulaTejido)")
    # Con una sola fase en la misión, sí la completa.
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos", "etapa": "preclínica", "celulaTejido": "astrocitos y plasma"}, "persona", T0)
    ej1 = M.ejes_de_hecho(h, _inv(e))
    assert ej1["estadio"] == "preclinica" and ej1["origen"]["estadio"] == "mision" and ej1["motivos"]["estadio"].startswith("misión (etapa)")
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con deterioro cognitivo leve amiloide positivos", "etapa": "preclínica y prodrómica", "celulaTejido": "astrocitos y plasma"}, "persona", T0)
    inv = _inv(e)
    # Un hecho sin ningún eje propio no se situa: la misión no lo arrastra a su celda.
    h2 = P.nuevo_hecho(INV, "hecho", "t", "GFAP sube antes que NfL", "sabido", "fuente", [], T0)
    ej2 = M.ejes_de_hecho(h2, inv)
    assert ej2["situado"] is False and ej2["estadio"] is None and ej2["region"] == [] and ej2["tipoCelular"] == []
    # Sin investigación o sin misión, nada se rellena.
    assert M.ejes_de_hecho(h, None)["estadio"] is None
    assert M.ejes_de_hecho(h, {"id": INV, "mision": None})["estadio"] is None
    assert M.ejes_de_hecho(h, {"id": INV})["tipoCelular"] == []
    # Una misión sin estadio ni célula (solo mecanismo) tampoco.
    assert M.ejes_de_mision({"mision": {"mecanismo": "neuroinflamación"}}) ["estadios"] == []
    assert M.ejes_de_mision("basura")["estadio"] is None


def test_registros_que_no_son_diccionarios_no_rompen():
    for basura in (None, "hecho", 3, [], [1, 2]):
        ej = M.ejes_de_hecho(basura, basura)
        assert ej["situado"] is False and ej["estadio"] is None
        assert M.ejes_de_hipotesis(basura, basura)["situado"] is False
    # Campos con tipos raros: tarjeta como cadena, afirmaciones como diccionario, entidades como texto.
    h = {"titulo": "Braak III en hipocampo", "tarjeta": "preclínica", "afirmaciones": {"texto": "x"}, "entidades": "CL:0000127", "enunciado": None, "mecanismo": 5}
    ej = M.ejes_de_hipotesis(h)
    assert ej["estadio"] == "prodromica_dcl" and ej["region"] == ["hipocampo"] and ej["tipoCelular"] == []


# ---------------------------------------------------------------------------
# El mapa
# ---------------------------------------------------------------------------


def _estado_poblado(e):
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en plasma y LCR"}, "persona", T0)
    A.crear_investigacion(e, {"titulo": "Otra", "objetivo": "O", "condicionParada": "1 iteración"}, T0, "inv-otra")
    _hecho(e, "En MCI la GFAP plasmática sube en astrocitos reactivos", id_="he-1")
    _hecho(e, "Braak III-IV: astrogliosis en el hipocampo", id_="he-2")
    _hecho(e, "GFAP sube antes que NfL", id_="he-3")  # sin ejes
    _hecho(e, "Microglia activation in CSF of CDR 1 patients", id_="he-4-inv-origen-" + INV)  # heredado
    _hecho(e, "Cambios en el cerebelo", id_="he-5", estado="descartado")  # descartado: fuera
    _hecho(e, "¿Y los astrocitos en LCR en DCL?", tipo="pregunta", estado="abierto", id_="he-6")  # pregunta: se ve, no cubre
    _hecho(e, "Braak VI en la amígdala", id_="he-7", inv="inv-otra")  # otra investigación: fuera
    _hip(e, "hip-1", "GFAP sube antes que NfL en amiloide positivos", tarjeta={**P.tarjeta_vacia(), "celula": "astrocitos", "etapa": "DCL"}, conclusion={"certeza": "baja"})
    _hip(e, "hip-2", "Plasma GFAP tracks astrocyte reactivity in MCI", conclusion={"certeza": "moderada"}, afirmaciones=[{"texto": "x", "cohorte": "ADNI"}, {"texto": "y", "cohorte": "BIOCARD"}, {"texto": "z", "cohorte": ""}])
    _hip(e, "hip-3", "Nada que situar", enunciado="algo cambia")  # sin ejes
    _hip(e, "hip-4", "Microglía en LCR en DCL", estado="descartada")  # fuera
    _hip(e, "hip-5", "Astrocitos en plasma en DCL", fusionadaEn="hip-2")  # fusionada: fuera
    _hip(e, "hip-6", "Pericitos en la barrera hematoencefálica en Braak V", conclusion={"certeza": "inventada"})  # certeza inválida: None
    return M.mapa(e, INV)


def test_mapa_completo(e):
    m = _estado_poblado(e)
    assert set(m) == {"ejes", "celdas", "cohortesPorRegion", "huecos", "sinEjes", "hipotesisSinEjes", "heredados", "mision", "misionAprobada", "resumen"}
    # Ejes: cuentan hechos e hipótesis situados (no la pregunta, no lo descartado, no la otra investigación).
    assert m["ejes"]["estadio"] == {"prodromica_dcl": 4, "demencia_leve": 2}
    assert m["ejes"]["tipoCelular"]["astrocito"] == 4 and m["ejes"]["tipoCelular"]["microglia"] == 1 and m["ejes"]["tipoCelular"]["pericito"] == 1
    assert m["ejes"]["region"]["plasma"] == 3 and m["ejes"]["region"]["hipocampo"] == 1 and m["ejes"]["region"]["lcr"] == 2
    assert "molecular" in m["ejes"]["nivel"] and "clinico" in m["ejes"]["nivel"]
    # Celdas: la más poblada primero; la certeza máxima es la mayor GRADE de sus hipótesis, sin sumar nada.
    por_clave = {(c["estadio"], c["region"], c["tipoCelular"]): c for c in m["celdas"]}
    c = por_clave[("prodromica_dcl", "plasma", "astrocito")]
    assert c["hechos"] == ["he-1"] and set(c["hipotesis"]) == {"hip-1", "hip-2"} and c["certezaMax"] == "moderada"
    assert c["cohortes"] == ["ADNI", "BIOCARD"] and "mayor certeza GRADE" in c["certezaMotivo"]
    assert m["celdas"][0] is c
    # hip-1: estadio y célula de la tarjeta, región de la misión (plasma y LCR): dos celdas.
    assert "hip-1" in por_clave[("prodromica_dcl", "lcr", "astrocito")]["hipotesis"]
    assert por_clave[("prodromica_dcl", "lcr", "astrocito")]["porMision"] >= 1
    # El hecho heredado (id con -inv-) cuenta como los demás.
    c4 = por_clave[("demencia_leve", "lcr", "microglia")]
    assert c4["hechos"] == ["he-4-inv-origen-" + INV] and c4["certezaMax"] is None and "sin hipótesis" in c4["certezaMotivo"]
    assert m["heredados"] == 1
    # La pregunta se ve en su celda pero no cuenta como cobertura.
    c6 = next(c for c in m["celdas"] if "he-6" in c["preguntas"])
    assert c6["estadio"] == "prodromica_dcl" and c6["region"] == "lcr" and c6["tipoCelular"] == "astrocito" and c6["hechos"] == []
    assert c6["hipotesis"] == ["hip-1"]  # la celda la comparte hip-1, que llega a LCR por la misión
    # Certeza inválida cuenta como sin conclusión.
    c_per = next(c for c in m["celdas"] if "hip-6" in c["hipotesis"])
    assert c_per["certezaMax"] is None and "ninguna hipótesis" in c_per["certezaMotivo"]
    # Lo que no se pudo situar.
    assert m["sinEjes"] == 1 and m["hipotesisSinEjes"] == 1
    # Nada de otra investigación, descartado ni fusionado.
    todos_ids = {x for c in m["celdas"] for x in c["hechos"] + c["hipotesis"] + c["preguntas"]}
    assert not todos_ids & {"he-5", "he-7", "hip-4", "hip-5"}
    # Resumen en castellano con los números.
    assert m["resumen"].startswith("3 hechos y 3 hipótesis situados en")
    assert "Sin situar: 1 hecho y 1 hipótesis" in m["resumen"] and "1 de los hechos situados es heredado" in m["resumen"]
    # Todo serializable (viaja al navegador).
    json.dumps(m, ensure_ascii=False)


def test_huecos_solo_se_cubren_por_contenido_propio_no_por_la_mision(e):
    m = _estado_poblado(e)
    # La misión nombra DCL x {plasma, LCR} x {astrocito}. Plasma lo cubre he-1 por su texto;
    # LCR + astrocito lo nombran la pregunta he-6 (no cuenta) y hip-1 (LCR le viene de la misión): es un hueco.
    assert [(h["estadio"], h["region"], h["tipoCelular"]) for h in m["huecos"]] == [("prodromica_dcl", "lcr", "astrocito")]
    hueco = m["huecos"][0]
    assert "ningún hecho ni hipótesis lo sitúa por su propio contenido" in hueco["motivo"] and hueco["heredanDeMision"] == 1
    assert "Huecos de la misión sin cubrir: 1" in m["resumen"]
    # Un hecho que lo nombre por sí mismo lo cierra.
    _hecho(e, "Astrocitos en LCR de pacientes con DCL", id_="he-8")
    m2 = M.mapa(e, INV)
    assert m2["huecos"] == [] and "Todas las combinaciones que nombra la misión" in m2["resumen"]


def test_mapa_sin_mision_sin_hechos_y_con_estado_antiguo(e):
    m = M.mapa(e, INV)
    assert m["celdas"] == [] and m["huecos"] == [] and m["sinEjes"] == 0 and m["ejes"] == {"estadio": {}, "region": {}, "tipoCelular": {}, "nivel": {}}
    assert "Todavía no hay hechos ni hipótesis" in m["resumen"] and "no tiene misión aprobada" in m["resumen"]
    # Con misión pero sin estadio ni célula: no hay huecos que comprobar.
    assert A.aprobar_mision(e, INV, {"mecanismo": "neuroinflamación", "poblacion": "sin fijar", "etapa": "varias"}, "persona", T0)
    assert "no fija estadio, región ni tipo celular" in M.mapa(e, INV)["resumen"]
    # Un estado anterior sin claves, con basura en las listas, o vacío.
    viejo = {"investigaciones": [{"id": INV}], "hechos": [None, "x", {"id": "he-z", "investigacionId": INV, "enunciado": "Braak III en hipocampo"}], "hipotesis": [3, {"id": "hip-z", "investigacionId": INV, "titulo": "Astrocitos en plasma en MCI"}]}
    m = M.mapa(viejo, INV)
    assert len(m["celdas"]) == 2 and m["sinEjes"] == 0
    assert M.mapa({}, INV)["celdas"] == [] and M.mapa(None, INV)["resumen"] and M.mapa({"hechos": "x"}, INV)["celdas"] == []
    # Una investigación que no existe.
    assert M.mapa(e, "inv-no")["celdas"] == []


def test_texto_mapa_para_prompt_y_pantalla(e):
    m = _estado_poblado(e)
    t = M.texto_mapa(e, INV)
    assert t.startswith("Mapa del estado de la enfermedad (")
    assert "estadio, la fase clínica del Alzheimer" in t  # define el término la primera vez
    assert m["resumen"] in t
    assert f"Celdas ({len(m['celdas'])} de {len(m['celdas'])}" in t
    assert "- prodrómica o DCL · sangre, plasma y suero (compartimento periférico) · astrocito: 1 hecho, 2 hipótesis (certeza máxima moderada; cohortes: ADNI, BIOCARD" in t
    assert "1 pregunta abierta" in t
    assert "Huecos (combinaciones que la misión nombra" in t and "- prodrómica o DCL · líquido cefalorraquídeo (LCR) · astrocito (1 registro lo hereda solo de la misión)." in t
    assert "Sin situar (ni estadio, ni región, ni tipo celular en su propio contenido): 1 hecho y 1 hipótesis." in t
    # `maximo` acota las celdas; un máximo ilegible no rompe.
    t2 = M.texto_mapa(e, INV, maximo=1)
    assert f"Celdas (1 de {len(m['celdas'])}" in t2 and t2.count("\n- ") == 1 + len(m["huecos"])
    assert M.texto_mapa(e, INV, maximo="x").count("\n- ") == len(m["celdas"]) + len(m["huecos"])
    assert M.texto_mapa(e, INV, maximo=0).count("\n- ") == 1 + len(m["huecos"])
    # Con el mapa precalculado no se recorre el estado otra vez; algo que no es un mapa se ignora.
    assert M.texto_mapa({}, INV, precalculado=m) == t and M.texto_mapa(e, INV, precalculado="x") == t
    # Sin nada: también en castellano.
    t3 = M.texto_mapa(P.estado_inicial(), "inv-nada")
    assert "Todavía no hay hechos ni hipótesis" in t3 and "Celdas" not in t3
    # Sin guiones largos ni palabras sin tilde en el texto generado.
    for texto in (t, t2, t3):
        assert "\u2014" not in texto  # guion largo
        for mal in ("hipotesis", "prodromica", "clinico", "mision", "region", "cefalorraquideo", "microglia", "todavia", "ningun", "maxima", "liquido"):
            assert not re.search(rf"\b{mal}\b", texto.lower()), mal


def test_ids_repetidos_investigacion_vacia_y_copias_de_la_mision(e):
    # Sin investigación (None o vacía) no hay mapa: no se juntan los hechos que no tienen investigacionId.
    e["hechos"].append({"id": "he-huerfano", "enunciado": "Braak III en hipocampo"})
    for inv_id in (None, "", 0):
        m = M.mapa(e, inv_id)
        assert m["celdas"] == [] and "Sin investigación" in m["resumen"]
    # Dos registros con el mismo id (estado corrupto) cuentan una vez, el primero.
    _hecho(e, "Braak III en hipocampo", id_="he-dup")
    _hecho(e, "CDR 3 en cerebelo", id_="he-dup")
    _hip(e, "hip-dup", "Astrocitos en plasma en MCI")
    _hip(e, "hip-dup", "Microglía en LCR en MCI")
    m = M.mapa(e, INV)
    assert [c["hechos"] for c in m["celdas"] if c["hechos"]] == [["he-dup"]] and m["ejes"]["region"] == {"hipocampo": 1, "plasma": 1}
    assert sum(len(c["hipotesis"]) for c in m["celdas"]) == 1
    # Los ejes de la misión salen de una caché por sus tres textos, pero cada llamada recibe su copia.
    assert A.aprobar_mision(e, INV, {"etapa": "preclínica", "celulaTejido": "microglía"}, "persona", T0)
    a = M.ejes_de_mision(_inv(e))
    a["region"].append("basura")
    a["motivos"]["tipoCelular"]["x"] = "y"
    b = M.ejes_de_mision(_inv(e))
    assert b["region"] == [] and "x" not in b["motivos"]["tipoCelular"] and b["tipoCelular"] == ["microglia"]


def test_determinismo_y_hipotesis_con_varias_regiones(e):
    _estado_poblado(e)
    a, b = M.mapa(e, INV), M.mapa(e, INV)
    assert a == b
    # Un registro con muchas regiones y tipos se reparte en celdas, con tope.
    h = P.nuevo_hecho(INV, "hecho", "t", "Braak V: hipocampo, corteza entorrinal, corteza temporal, cerebelo, amígdala y estriado; astrocitos, microglía, neuronas, oligodendrocitos, pericitos y endotelio", "sabido", "fuente", [], T0)
    ej = M.ejes_de_hecho(h)
    assert len(ej["region"]) == 6 and len(ej["tipoCelular"]) == 6
    assert len(M._celdas_de(ej)) == M._MAX_CELDAS_POR_REGISTRO


# ---------------------------------------------------------------------------
# Adversariales: lo que el docstring promete y el código no cumplía
# ---------------------------------------------------------------------------


def test_ids_con_guion_bajo_como_los_devuelve_ols4():
    # OLS4 devuelve short_form "UBERON_0002421" cuando falta obo_id; es la misma entidad.
    ej = M.ejes_de_texto("", [{"id": "UBERON_0002421", "etiqueta": "hippocampal formation"}, {"id": "cl_0000127", "etiqueta": "astrocyte"}, {"id": "HGNC_4235"}])
    assert ej["region"] == ["hipocampo"] and ej["tipoCelular"] == ["astrocito"]
    assert ej["nivel"] == ["molecular", "celular", "tisular"]
    assert ej["motivos"]["region"]["hipocampo"] == "entidad UBERON_0002421 (hippocampal formation)"  # el motivo cita el id tal cual vino
    # Un id que no es de ontología no rompe ni se cuela.
    assert M.ejes_de_texto("", [{"id": "uberon"}, {"id": ":"}, {"id": "UBERON:"}])["region"] == []


@pytest.mark.parametrize(
    "texto, esperado, en_motivo",
    [
        ("CDR 0,5 (coma decimal)", "prodromica_dcl", "CDR global 0,5"),
        ("CDR > 0", "prodromica_dcl", "leído de «> 0»"),
        ("CDR < 1", "prodromica_dcl", "leído de «< 1»"),
        ("CDR >= 1", "demencia_leve", "CDR global 1"),
        ("CDR ≥ 1", "demencia_leve", "CDR global 1"),
        ("CDR ≤ 0.5", "prodromica_dcl", "CDR global 0,5"),
        ("CDR > 3", "demencia_moderada_grave", "CDR global 3"),  # no hay categoría por encima
        ("CDR < 0", "preclinica", "CDR global 0"),
    ],
)
def test_cdr_con_coma_decimal_y_operadores(texto, esperado, en_motivo):
    ej = M.ejes_de_texto(texto)
    assert ej["estadio"] == esperado and en_motivo in ej["motivos"]["estadio"]


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("MMSE 24/30", "prodromica_dcl"),  # 24 sobre el máximo, no el punto medio 27
        ("MMSE 24 de 30", "prodromica_dcl"),
        ("MMSE 22 out of 30", "demencia_leve"),
        ("MMSE 26-30", "preclinica"),  # esto sí es un intervalo: punto medio 28
        ("MMSE ≥ 26", "prodromica_dcl"),  # el límite incluido: 26, no 27
        ("MMSE >= 26", "prodromica_dcl"),
        ("MMSE > 26", "preclinica"),
        ("MMSE ≤ 19", "demencia_moderada_grave"),
        ("MMSE > 30", None),  # fuera de escala
        ("Braak > III", "prodromica_dcl"),  # al menos IV
        ("Braak ≥ III", "prodromica_dcl"),
        ("Braak > IV", "demencia_leve"),
        ("Thal ≥ 3", "prodromica_dcl"),
    ],
)
def test_mmse_sobre_el_maximo_y_simbolos_de_comparacion(texto, esperado):
    assert M.ejes_de_texto(texto)["estadio"] == esperado


def test_braak_con_operador_deja_el_motivo_explicado_y_sin_operador_cita_el_numero_tal_cual():
    assert "Braak IV (leído de «> III»)" in M.ejes_de_texto("Braak > III")["motivos"]["estadio"]
    assert "Braak 3" in M.ejes_de_texto("Braak stage 3")["motivos"]["estadio"]


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("The project is at an advanced stage of development", None),  # sin enfermedad en la frase
        ("patients at an advanced stage of Alzheimer's disease", "demencia_moderada_grave"),
        ("El ensayo está en estadio avanzado de reclutamiento", None),
        ("pacientes en estadio avanzado de la enfermedad", "demencia_moderada_grave"),
        ("severe adverse events", None),
        ("FAD-dependent oxidase activity of flavin adenine dinucleotide", None),  # el cofactor, no el Alzheimer familiar
        ("FAD mutation carriers in the DIAN cohort", "autosomico_dominante"),
        ("the preclinical phase of Alzheimer's disease", "preclinica"),
        ("preclinical phase of drug development", None),
        ("preclinical and clinical studies of the compound", None),
        ("CERAD word list recall was moderate in the MCI group", "prodromica_dcl"),  # DCL por MCI, no por CERAD
        ("CERAD word list recall was moderate", None),  # la batería no es la escala de placas
        ("CERAD neuritic plaque score moderate", "prodromica_dcl"),
        ("APOE4 carriers show increased APP processing", None),  # portadores de APOE, esporádico
        ("APP mutation carriers", "autosomico_dominante"),
    ],
)
def test_contexto_de_frase_en_las_palabras(texto, esperado):
    assert M.ejes_de_texto(texto)["estadio"] == esperado


def test_estadios_es_la_lista_completa_y_cubre_varias_fases_de_la_mision(e):
    ej = M.ejes_de_texto("Presymptomatic PSEN1 carriers with Braak I-II")
    assert ej["estadio"] == "autosomico_dominante" and ej["estadios"] == ["autosomico_dominante", "preclinica"]
    # La misión nombra la forma autosómica dominante y la fase preclínica en astrocitos: un
    # hecho sobre portadores presintomáticos de PSEN1 cubre las dos combinaciones.
    assert A.aprobar_mision(e, INV, {"poblacion": "portadores presintomáticos de PSEN1", "etapa": "preclínica", "celulaTejido": "astrocitos"}, "persona", T0)
    assert M.ejes_de_mision(_inv(e))["estadios"] == ["preclinica", "autosomico_dominante"]
    _hecho(e, "Presymptomatic PSEN1 carriers show astrocyte reactivity", id_="he-adad")
    m = M.mapa(e, INV)
    assert m["huecos"] == [] and "Todas las combinaciones" in m["resumen"]
    # Un hecho que solo nombra la fase preclínica deja la forma autosómica dominante como hueco.
    e["hechos"].clear()
    _hecho(e, "Cognitively unimpaired adults with astrocyte reactivity", id_="he-pre")
    m = M.mapa(e, INV)
    assert [(h["estadio"], h["tipoCelular"]) for h in m["huecos"]] == [("autosomico_dominante", "astrocito")]
    # Un sinMision antiguo sin la lista se lee por su estadio único.
    assert M._cubre({"estadio": "preclinica", "region": [], "tipoCelular": []}, ("preclinica", None, None)) is True
    assert M._cubre({"estadio": "preclinica", "region": [], "tipoCelular": []}, ("autosomico_dominante", None, None)) is False


def test_motivos_sin_prefijo_duplicado_y_la_entidad_gana_al_texto():
    ej = M.ejes_de_hecho({"tema": "t", "enunciado": "astrocitos en el hipocampo"})
    assert ej["motivos"]["region"]["hipocampo"] == "texto: «hipocampo»"
    assert ej["motivos"]["tipoCelular"]["astrocito"] == "texto: «astrocitos»"
    h = {"titulo": "x", "tarjeta": {"celula": "astrocitos", "etapa": "DCL"}}
    ej = M.ejes_de_hipotesis(h)
    assert ej["motivos"]["tipoCelular"]["astrocito"] == "tarjeta: «astrocitos»"
    assert ej["motivos"]["estadio"].startswith("tarjeta: palabra de fase prodrómica")
    # Entidad y texto para la misma región: el identificador es el motivo más preciso.
    ej = M.ejes_de_texto("hipocampo", [_ent("UBERON:0002421", "hippocampal formation")])
    assert ej["motivos"]["region"]["hipocampo"] == "entidad UBERON:0002421 (hippocampal formation)"


def test_texto_mapa_lee_un_mapa_guardado_por_una_version_anterior():
    viejo = {"celdas": [{"estadio": "prodromica_dcl", "region": "plasma", "tipoCelular": None, "hechos": ["a"], "hipotesis": []}, "basura", {"hechos": "x", "certezaMax": "inventada", "porMision": "3", "cohortes": None}], "resumen": "r", "huecos": [{"estadio": "preclinica"}], "sinEjes": "2", "hipotesisSinEjes": None}
    t = M.texto_mapa({}, "inv", precalculado=viejo)
    assert "- prodrómica o DCL · sangre, plasma y suero (compartimento periférico) · sin situar: 1 hecho, 0 hipótesis (sin conclusión GRADE todavía)." in t
    assert "- sin situar · sin situar · sin situar: 0 hechos, 0 hipótesis (sin conclusión GRADE todavía; 3 situados en algún eje solo por la misión)." in t  # certeza inválida no rompe; porMision como texto se lee como número
    assert "Huecos" in t and "- preclínica." in t
    assert "Sin situar (ni estadio, ni región, ni tipo celular en su propio contenido): 2 hechos y 0 hipótesis." in t
    assert "Sin resumen guardado" in M.texto_mapa({}, "inv", precalculado={"celdas": []})


def test_certeza_motivo_concuerda_y_la_busqueda_por_id_no_es_cuadratica(e):
    _hip(e, "hip-a", "Astrocitos en plasma en MCI", conclusion={"certeza": "baja"})
    m = M.mapa(e, INV)
    assert m["celdas"][0]["certezaMotivo"] == "la mayor certeza GRADE entre las conclusiones de la única hipótesis de la celda"
    _hip(e, "hip-b", "Astrocitos en plasma en MCI también")
    _hip(e, "hip-c", "Astrocitos en plasma en MCI otra vez", conclusion={"certeza": "moderada"})
    m = M.mapa(e, INV)
    assert m["celdas"][0]["certezaMax"] == "moderada"
    assert m["celdas"][0]["certezaMotivo"] == "la mayor certeza GRADE entre las conclusiones de las 3 hipótesis de la celda; 1 sin conclusión todavía"


def test_preguntas_no_cuentan_en_el_eje_nivel_y_hechos_sustituidos_quedan_fuera(e):
    _hecho(e, "¿GFAP proteína en astrocitos del hipocampo en MCI?", tipo="pregunta", estado="abierto", id_="he-preg")
    m = M.mapa(e, INV)
    assert m["ejes"]["nivel"] == {} and m["ejes"]["estadio"] == {} and len(m["celdas"]) == 1 and m["celdas"][0]["preguntas"] == ["he-preg"]
    # Un hecho sustituido (sustituidoPor) que un estado antiguo conserva como "sabido" no cuenta dos veces.
    _hecho(e, "GFAP en astrocitos del hipocampo en MCI", id_="v1", sustituidoPor="v2")
    _hecho(e, "GFAP en astrocitos del hipocampo en MCI y DCL", id_="v2", sustituyeA=["v1"])
    m = M.mapa(e, INV)
    assert [c["hechos"] for c in m["celdas"] if c["hechos"]] == [["v2"]]
    # Un hecho sin situar sí cuenta en el nivel (es molecular aunque no diga región).
    _hecho(e, "GFAP protein rises before NfL", id_="he-mol")
    m = M.mapa(e, INV)
    assert m["ejes"]["nivel"]["molecular"] == 2 and m["sinEjes"] == 1
    assert m["resumen"].startswith("1 hecho y 0 hipótesis situados en 1 celda")


def test_resumen_cuando_nada_se_situa(e):
    _hecho(e, "GFAP protein rises before NfL", id_="he-1")
    _hip(e, "hip-1", "Algo", enunciado="cambia")
    m = M.mapa(e, INV)
    assert m["celdas"] == [] and m["resumen"].startswith("Ningún registro se pudo situar en el mapa de la enfermedad: 1 hecho y 1 hipótesis sin estadio")
    assert "Niveles: molecular 1" in m["resumen"]


def test_normalizar_conserva_los_simbolos_de_comparacion_y_la_longitud():
    for t in ("MMSE ≥ 26", "CDR ≤ 0,5", "Braak III\u2013IV", "a\u2014b", "áé"):  # guion corto y guion largo como escapes
        assert len(M.normalizar(t)) == len(t)
    assert M.normalizar("MMSE ≥ 26") == "mmse ≥ 26" and M.normalizar("III\u2013IV") == "iii-iv" and M.normalizar("a\u2014b") == "a-b"


def test_mapa_no_muta_el_estado_ni_los_registros(e):
    import copy

    _estado_poblado(e)
    antes = copy.deepcopy(e)
    M.mapa(e, INV)
    M.texto_mapa(e, INV)
    assert e == antes
