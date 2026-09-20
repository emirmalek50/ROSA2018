"""Reparación de los cuatro fallos del adversario sobre las cohortes del mapa
de la enfermedad (rosa/mapa_enfermedad.py, 19 de septiembre de 2026, segunda
pasada). Los tests del adversario (test_mapa_adversario_19sep.py) prueban que
cada fallo desapareció; estos prueban lo que el arreglo asume y lo que podría
romper:

1. `misionAprobada` solo con `aprobadaEn` (una misión propuesta por ROSA2018 y
   sin aprobar no cuenta; aprobar en t=0 sí cuenta; una misión que no es un
   diccionario no rompe).
2. La cohorte de una fuente anterior a `metodo` se lee con el catálogo la
   primera vez que un hecho la pide y se recuerda por proceso: solo las
   fuentes que alguien cita, una vez, sin mutar el estado, con la huella
   cambiando si cambia el contenido, y sin recalcular una fuente que ya trae
   `metodo` sin cohorte ("no pude comprobar").
3. Una fuente con `nct` y sin cohorte da su ensayo, como `metodos._nombre`.
4. La etiqueta de un grupo de nombres libres es estable (el menor sin
   distinguir mayúsculas), y la de un grupo del catálogo sigue siendo la
   canónica.

Sin modelos: el mapa y el catálogo son reglas puras sobre el estado."""

from __future__ import annotations

import copy
import json

import pytest

from rosa import mapa_enfermedad as M
from rosa import metodos as METODOS
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

INV = "inv-rep"
T0 = 1_000_000

CELDA_A = "Braak III-IV: astrogliosis en el hipocampo"
CLAVE_A = ("prodromica_dcl", "hipocampo", "astrocito")
CELDA_B = "Microglia activation in the hippocampus of cognitively unimpaired adults"
CLAVE_B = ("preclinica", "hipocampo", "microglia")


@pytest.fixture(autouse=True)
def _cache_limpia():
    M._vaciar_cache_catalogo()
    yield
    M._vaciar_cache_catalogo()


@pytest.fixture
def e():
    estado = P.estado_inicial()
    assert A.crear_investigacion(estado, {"titulo": "T", "objetivo": "GFAP en astrocitos", "condicionParada": "3 iteraciones"}, T0, INV) == INV
    return estado


def _inv(e):
    return next(i for i in e["investigaciones"] if i["id"] == INV)


def _hecho(e, enunciado, id_, afirmacion_ids=None, procedencia=None, **extra):
    h = P.nuevo_hecho(INV, "hecho", "tema", enunciado, "sabido", "fuente", list(procedencia or []), T0, afirmacion_ids=list(afirmacion_ids or []))
    h["id"] = id_
    h.update(extra)
    e["hechos"].append(h)
    return h


def _af(id_, cohorte, fuente_id="f-1", **extra):
    return {"id": id_, "texto": "x", "fragmento": "y", "veredicto": "sostenida", "cohorte": cohorte, "fuenteId": fuente_id, "iteracion": 1, **extra}


def _corrida(e, id_, afirmaciones=(), fuentes=()):
    c = {"id": id_, "investigacionId": INV, "numero": 1, "estado": "terminada", "_afirmaciones": list(afirmaciones), "_fuentes": {f["id"]: f for f in fuentes}}
    e["corridas"].append(c)
    return c


def _fuente_vieja(id_, texto, titulo="Plasma GFAP and amyloid positivity", **extra):
    """Una fuente de antes de que el bucle guardara `metodo`: sin la clave, sin cohorte."""
    f = {**P.nueva_fuente(id=id_, titulo=titulo), "cohorte": None, "fragmentos": [{"texto": texto, "localizador": "p1", "encabezado": ""}], **extra}
    f.pop("metodo", None)
    return f


def _proc(fid):
    return [{"fuenteId": fid, "referencia": "A", "pagina": None}]


def _celda(m, clave):
    return next(c for c in m["celdas"] if (c["estadio"], c["region"], c["tipoCelular"]) == clave)


# ---------------------------------------------------------------------------
# 1. misionAprobada
# ---------------------------------------------------------------------------


def test_una_mision_propuesta_por_rosa_no_esta_aprobada_y_aprobar_en_t0_si(e):
    inv = _inv(e)
    _hecho(e, CELDA_A, "he-1")
    # Sin misión.
    assert M.mapa(e, INV)["misionAprobada"] is False
    # Propuesta por ROSA2018 (lo que escribe el bucle): aprobadaEn None.
    inv["mision"] = {**P.mision_vacia(), "poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR", "propuestaPorRosa": True}
    m = M.mapa(e, INV)
    assert m["misionAprobada"] is False and "no tiene misión aprobada" in m["resumen"]
    # Los ejes y los huecos de la misión propuesta se siguen calculando (la interfaz los enseña
    # como propuesta y el bucle abre cuestiones por hueco, como hasta ahora), pero el resumen
    # los llama orientativos y no habla de "huecos de la misión" como si estuviera fijada.
    assert m["mision"]["region"] == ["hipocampo", "lcr"] and len(m["huecos"]) == 1
    assert "hay una misión propuesta y sin aprobar, y frente a ella queda 1 hueco orientativo que solo contará cuando la persona la apruebe" in m["resumen"]
    assert "Huecos de la misión" not in m["resumen"] and "combinaciones que nombra la misión" not in m["resumen"]
    assert M.resumen_de(m) == m["resumen"]
    # Con dos huecos, el plural.
    inv["mision"]["celulaTejido"] = "astrocitos y microglía en LCR"
    m2 = M.mapa(e, INV)
    assert len(m2["huecos"]) == 2 and "quedan 2 huecos orientativos que solo contarán" in m2["resumen"]
    # Una misión sin aprobar que no fija ningún eje: no hay huecos que comprobar.
    inv["mision"] = {**P.mision_vacia(), "propuestaPorRosa": True}
    m3 = M.mapa(e, INV)
    assert m3["huecos"] == [] and "no tiene misión aprobada, así que no hay huecos que comprobar" in m3["resumen"]
    inv["mision"] = {**P.mision_vacia(), "poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR", "propuestaPorRosa": True}
    # Aprobada en t=0: `is not None`, no la verdad del valor.
    inv["mision"]["aprobadaEn"] = 0
    m0 = M.mapa(e, INV)
    assert m0["misionAprobada"] is True and "Huecos de la misión sin cubrir" in m0["resumen"]
    # Una misión que no es un diccionario no rompe ni cuenta.
    inv["mision"] = "basura"
    assert M.mapa(e, INV)["misionAprobada"] is False
    inv["mision"] = None
    assert M.mapa(e, INV)["misionAprobada"] is False


def test_aprobar_el_primer_plan_aprueba_la_mision_propuesta_y_el_mapa_lo_ve(e):
    inv = _inv(e)
    inv["mision"] = {**P.mision_vacia(), "poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR", "propuestaPorRosa": True}
    _hecho(e, CELDA_A, "he-1")
    assert M.mapa(e, INV)["misionAprobada"] is False
    assert A.aprobar_mision(e, INV, {"poblacion": "adultos con DCL", "etapa": "prodrómica", "celulaTejido": "astrocitos en hipocampo y LCR"}, "persona", T0)
    assert _inv(e)["mision"]["aprobadaEn"] == T0
    m = M.mapa(e, INV)
    assert m["misionAprobada"] is True and M.resumen_de(m) == m["resumen"]
    # Un mapa guardado con la clave a False sigue diciendo que no está aprobada aunque tenga ejes.
    guardado = json.loads(json.dumps(m))
    guardado["misionAprobada"] = False
    assert "no tiene misión aprobada" in M.resumen_de(guardado)


# ---------------------------------------------------------------------------
# 2. Fuentes anteriores a `metodo`: el catálogo, una vez y solo si alguien las pide
# ---------------------------------------------------------------------------


def test_la_fuente_vieja_da_su_cohorte_por_el_fragmento_y_no_muta_el_estado(e):
    vieja = _fuente_vieja("f-vieja", "Participants were drawn from the BIOCARD study; plasma GFAP was measured by Simoa.")
    _corrida(e, "cor-1", [_af("af-1", "", "f-vieja")], [vieja])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1"], procedencia=_proc("f-vieja"))
    antes = copy.deepcopy(e)
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == ["BIOCARD"] and m["cohortesPorRegion"] == {"hipocampo": 1}
    # El estado no cambia: la fuente sigue sin `metodo` (rellenarla es cosa de quien carga el estado).
    assert e == antes and "metodo" not in vieja
    json.dumps(m, ensure_ascii=False)


def test_solo_se_leen_las_fuentes_que_alguien_cita_y_solo_una_vez_por_proceso(e, monkeypatch):
    citada = _fuente_vieja("f-citada", "Data from the BIOCARD study.")
    no_citada = _fuente_vieja("f-no-citada", "Data from the ADNI study.")
    con_metodo_sin_cohorte = {**_fuente_vieja("f-metodo", "Data from the DIAN study."), "metodo": {"cohorte": None, "plataforma": None, "muestra": None, "origen": None}}
    _corrida(e, "cor-1", [], [citada, no_citada, con_metodo_sin_cohorte])
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-citada"))
    _hecho(e, CELDA_B, "he-2", procedencia=_proc("f-metodo"))
    llamadas = []
    original = METODOS.metodo_de_fuente

    def contar(f, afs=None):
        llamadas.append(f.get("id"))
        return original(f, afs)

    monkeypatch.setattr(METODOS, "metodo_de_fuente", contar)
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == ["BIOCARD"]
    # La fuente con `metodo` y sin cohorte ya pasó por la regla en el bucle: no se recalcula y es "no pude comprobar".
    assert _celda(m, CLAVE_B)["cohortes"] == []
    # Solo la citada sin `metodo`, y una sola vez.
    assert llamadas == ["f-citada"]
    # El segundo mapa, en el mismo proceso, no vuelve a leer nada.
    assert M.mapa(e, INV) == m and llamadas == ["f-citada"]
    # Ni el mapa de otro estado con la misma fuente (mismo id y mismo contenido).
    e2 = copy.deepcopy(e)
    assert M.mapa(e2, INV) == m and llamadas == ["f-citada"]


def test_si_cambia_el_contenido_de_la_fuente_se_vuelve_a_leer(e, monkeypatch):
    vieja = _fuente_vieja("f-vieja", "Sin cohorte reconocible en este texto.")
    _corrida(e, "cor-1", [], [vieja])
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-vieja"))
    llamadas = []
    original = METODOS.metodo_de_fuente
    monkeypatch.setattr(METODOS, "metodo_de_fuente", lambda f, afs=None: (llamadas.append(f.get("id")), original(f, afs))[1])
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == [] and llamadas == ["f-vieja"]
    # Un resultado vacío también se recuerda: no se relee en cada mapa.
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == [] and llamadas == ["f-vieja"]
    # El bucle lee otro fragmento de la misma fuente: la huella cambia y se relee.
    vieja["fragmentos"].append({"texto": "Participants came from the BIOCARD cohort.", "localizador": "p2", "encabezado": ""})
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == ["BIOCARD"] and llamadas == ["f-vieja", "f-vieja"]


def test_las_afirmaciones_de_la_fuente_entran_en_la_lectura_como_en_el_bucle(e):
    # El bucle llama a metodo_de_fuente(fuente, afirmaciones): el texto de las afirmaciones cuenta.
    vieja = _fuente_vieja("f-vieja", "Nothing here.", titulo="A study")
    _corrida(e, "cor-1", [_af("af-1", "", "f-vieja", texto="Participants were BIOCARD volunteers.")], [vieja])
    # El hecho no enlaza la afirmación (registro antiguo): llega a la fuente por la procedencia.
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-vieja"), afirmacionIds=None)
    assert _celda(M.mapa(e, INV), CLAVE_A)["cohortes"] == ["BIOCARD"]


def test_el_orden_por_fuente_es_el_de_metodos_nombre_campo_metodo_nct_y_despues_el_catalogo(e):
    fuentes = [
        {**_fuente_vieja("f-campo", "Data from the ADNI study."), "cohorte": "Mi cohorte libre"},  # el campo manda, aunque sea libre
        {**_fuente_vieja("f-metodo", "Data from the ADNI study."), "metodo": {"cohorte": {"id": "cohorte:dian", "etiqueta": "DIAN"}}},  # el método
        {**_fuente_vieja("f-nct", "Data from the ADNI study."), "nct": "NCT04437511"},  # el NCT
        _fuente_vieja("f-texto", "Data from the ADNI study."),  # el catálogo sobre el texto
    ]
    _corrida(e, "cor-1", [], fuentes)
    for i, fid in enumerate(("f-campo", "f-metodo", "f-nct", "f-texto")):
        _hecho(e, CELDA_A, f"he-{i}", procedencia=_proc(fid))
    c = _celda(M.mapa(e, INV), CLAVE_A)
    assert c["cohortes"] == ["ADNI", "DIAN", "Mi cohorte libre", "TRAILBLAZER-ALZ 2"]
    # El techo GRADE (`metodos._nombre`) lee el campo y el nct, pero no `metodo.cohorte` ni el
    # texto: para él f-metodo y f-texto son "sin cohorte". El mapa lee además el método que el
    # bucle guardó y, en las fuentes antiguas, el catálogo; es la misma regla, aplicada a lo que
    # el bucle habría guardado.
    assert METODOS.cohortes_distintas(fuentes) == ["Mi cohorte libre", "TRAILBLAZER-ALZ 2"]
    assert METODOS.fuentes_sin_cohorte(fuentes) == 2


def test_si_el_catalogo_falla_al_leer_una_fuente_vieja_la_celda_queda_sin_cohorte_y_el_mapa_sigue(e, monkeypatch):
    _corrida(e, "cor-1", [], [_fuente_vieja("f-vieja", "BIOCARD")])
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-vieja"))

    def rompe(*_a, **_k):
        raise RuntimeError("catálogo roto a propósito")

    monkeypatch.setattr(METODOS, "metodo_de_fuente", rompe)
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == [] and m["cohortesPorRegion"] == {"hipocampo": 0}


def test_el_indice_se_lee_como_un_diccionario_y_acepta_basura():
    e = P.estado_inicial()
    e["corridas"].append({"id": "c", "_afirmaciones": [{"id": "af-1", "fuenteId": "f-1", "cohorte": "ADNI"}, {"id": "af-2", "fuenteId": None}], "_fuentes": {"f-1": {"id": "f-1", "cohorte": "ADNI"}, "f-vieja": {"id": "f-vieja", "titulo": "The BIOCARD study"}, "f-none": None, "f-metodo-raro": {"id": "f-metodo-raro", "metodo": "x"}}})
    por_af, por_fu = M._indice_cohortes(e)
    assert por_af == {"af-1": ["ADNI"]}
    assert "f-1" in por_fu and por_fu["f-1"] == ["ADNI"] and por_fu.get("f-1") == ["ADNI"]
    assert len(por_fu) == 3 and por_fu.pendientes() == 2  # f-vieja y f-metodo-raro esperan a que alguien las pida
    assert "f-vieja" in por_fu and por_fu["f-vieja"] == ["BIOCARD"] and por_fu.pendientes() == 1
    assert "f-none" not in por_fu and "f-metodo-raro" not in por_fu and por_fu.get("f-metodo-raro") is None
    for basura in (None, "", 3, [], {}):
        assert basura not in por_fu and por_fu.get(basura) is None
    with pytest.raises(KeyError):
        por_fu["f-none"]
    # Lo devuelto es una copia: mutarlo no toca el índice.
    por_fu["f-1"].append("basura")
    assert por_fu["f-1"] == ["ADNI"]
    # `_cohortes_de_fuentes` vale con el índice y con un diccionario plano; con basura, nada.
    assert M._cohortes_de_fuentes(["f-1", "f-vieja", None, 3, "f-no"], por_fu) == ["ADNI", "BIOCARD"]
    assert M._cohortes_de_fuentes(["f-1"], {"f-1": ["DIAN", 3, None]}) == ["DIAN"]
    assert M._cohortes_de_fuentes(["f-1"], None) == [] and M._cohortes_de_fuentes(["f-1"], "x") == []


def test_la_cache_del_catalogo_esta_acotada_y_la_huella_distingue_el_contenido():
    assert M._huella_fuente("f", {"titulo": "T", "fragmento": "abc", "fragmentos": [{"texto": "xy"}, "basura"], "nct": None, "cohorte": None}, [{"id": "a"}, "basura"]) == ("f", "T", 3, (2, 0), "", "", ("a", ""))
    assert M._huella_fuente("f", {}, []) != M._huella_fuente("g", {}, [])
    M._vaciar_cache_catalogo()
    viejo_max = M._CACHE_CATALOGO_MAX
    try:
        M._CACHE_CATALOGO_MAX = 2
        for i in range(5):
            M._cohorte_por_catalogo(f"f-{i}", {"id": f"f-{i}", "titulo": "The BIOCARD study"}, [])
        assert len(M._CACHE_CATALOGO) <= 2
    finally:
        M._CACHE_CATALOGO_MAX = viejo_max
    # Un resultado cacheado se devuelve como copia.
    r1 = M._cohorte_por_catalogo("f-x", {"id": "f-x", "titulo": "The BIOCARD study"}, [])
    r1.append("basura")
    assert M._cohorte_por_catalogo("f-x", {"id": "f-x", "titulo": "The BIOCARD study"}, []) == ["BIOCARD"]


# ---------------------------------------------------------------------------
# 3. NCT
# ---------------------------------------------------------------------------


def test_una_fuente_con_nct_sin_cohorte_y_con_metodo_sin_cohorte_da_su_ensayo(e):
    # Aunque traiga `metodo` (sin cohorte), el `nct` cuenta, como en metodos._nombre.
    fuente = {**P.nueva_fuente(id="f-nct", titulo="Un ensayo"), "cohorte": None, "nct": "NCT99999999", "metodo": {"cohorte": None}}
    _corrida(e, "cor-1", [], [fuente])
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-nct"))
    c = _celda(M.mapa(e, INV), CLAVE_A)
    # Un NCT que no está en el catálogo es su propio ensayo, con el registro como etiqueta.
    assert c["cohortes"] == ["NCT99999999"]
    assert METODOS.cohortes_distintas([fuente]) == ["NCT99999999"]


# ---------------------------------------------------------------------------
# 4. Etiqueta estable
# ---------------------------------------------------------------------------


def test_la_etiqueta_de_un_grupo_libre_no_depende_del_orden_y_la_del_catalogo_es_la_canonica():
    a = M._cohortes_distintas(["Cohorte sueca de ADAD", "ADAD longitudinal cohort study", "adni-3", "Alzheimer's Disease Neuroimaging Initiative"])
    b = M._cohortes_distintas(["Alzheimer's Disease Neuroimaging Initiative", "ADAD longitudinal cohort study", "Cohorte sueca de ADAD", "adni-3"])
    assert a == b == ["ADAD longitudinal cohort study", "ADNI"]
    # Un nombre libre que contiene el de una cohorte del catálogo se une a ella y lleva la etiqueta canónica.
    assert M._cohortes_distintas(["Rotterdam", "Rotterdam Study participants"]) == ["Rotterdam Study"]
    # Con un NCT del catálogo, la etiqueta del ensayo; con uno desconocido, el registro.
    assert M._cohortes_distintas(["Ensayo X (NCT04437511)", "NCT04437511"]) == ["TRAILBLAZER-ALZ 2"]
    assert M._cohortes_distintas(["Mi ensayo (NCT99999999)", "nct99999999"]) == ["NCT99999999"]
    # Dos grafías del mismo nombre: se queda la menor, no la primera que llegó (determinista).
    assert M._cohortes_distintas(["cohorte X rara", "Cohorte x rara"]) == M._cohortes_distintas(["Cohorte x rara", "cohorte X rara"]) == ["Cohorte x rara"]
    assert M._etiqueta_de_grupo({"id": None, "etiqueta": "Zeta", "nombres": ["Zeta", "  alfa  "]}) == "alfa"
    assert M._etiqueta_de_grupo({"id": "cohorte:adni", "etiqueta": "ADNI", "nombres": ["adni-3"]}) == "ADNI"
    assert M._etiqueta_de_grupo({"id": None, "etiqueta": "Solo", "nombres": []}) == "Solo"
    assert M._etiqueta_de_grupo("basura") == "" and M._etiqueta_de_grupo({"id": "x", "etiqueta": None, "nombres": [3, "b"]}) == "b"


def test_la_misma_cohorte_libre_lleva_el_mismo_nombre_en_celdas_vecinas_y_la_interfaz_no_la_cuenta_dos_veces(e):
    _corrida(e, "cor-1", [_af("af-1", "Cohorte sueca de ADAD"), _af("af-2", "ADAD longitudinal cohort study"), _af("af-3", "BIOCARD")], [P.nueva_fuente(id="f-1", titulo="t")])
    _hecho(e, CELDA_A, "he-1", afirmacion_ids=["af-1", "af-2"])
    _hecho(e, CELDA_B, "he-2", afirmacion_ids=["af-2", "af-1", "af-3"])
    m = M.mapa(e, INV)
    assert _celda(m, CLAVE_A)["cohortes"] == ["ADAD longitudinal cohort study"]
    assert _celda(m, CLAVE_B)["cohortes"] == ["ADAD longitudinal cohort study", "BIOCARD"]
    assert len({x for c in m["celdas"] for x in c["cohortes"]}) == m["cohortesPorRegion"]["hipocampo"] == 2


def test_texto_mapa_dice_de_donde_salen_las_cohortes_de_una_fuente(e):
    _corrida(e, "cor-1", [], [_fuente_vieja("f-vieja", "The BIOCARD study.")])
    _hecho(e, CELDA_A, "he-1", procedencia=_proc("f-vieja"))
    t = M.texto_mapa(e, INV)
    assert "su campo cohorte, su método canónico, su registro NCT o lo que el catálogo lee en su título y su texto" in t
    assert "cohortes: BIOCARD" in t and "\u2014" not in t
