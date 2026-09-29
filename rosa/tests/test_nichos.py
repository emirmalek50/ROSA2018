"""El archivo de ideas por nichos (rosa/nichos.py): MAP-Elites en ROSA2018.

Sale de ANALISIS-MAP-ELITES-2026-09-29.md, prerregistrado antes de calcular: P =
0,729 a favor. En la investigación de APOE4 las 7 hipótesis vivas estaban en la
misma celda de la enfermedad, y "prodrómica o DCL × plasma × astrocito" tenía 7
hechos de dos cohortes y ninguna hipótesis. Los casos de abajo cubren lo que hace
que funcione y los tres riesgos que el análisis predijo: apuntar a nichos de una
sola cohorte (irían al vivero), forzar un nicho (inventar para encajar), y el que
salió al probarlo sobre la base: premiar la versión vaga de una celda llena.
"""

from __future__ import annotations

import inspect

from rosa import equipo as EQ
from rosa import nichos as NI

INV = "inv-1"


def _h(i, estado="propuesta", elo=1000):
    return {"id": f"h{i}", "investigacionId": INV, "titulo": f"Hipótesis {i}", "estado": estado, "elo": elo}


def _celda(estadio, region, celula, hipotesis=(), hechos=(), cohortes=(), por_mision=0):
    return {"estadio": estadio, "region": region, "tipoCelular": celula, "hipotesis": list(hipotesis), "hechos": list(hechos), "cohortes": list(cohortes), "porMision": por_mision}


def _e(hs, celdas, hechos=()):
    return {"hipotesis": list(hs), "investigaciones": [{"id": INV, "titulo": "T", "objetivo": "O"}], "hechos": list(hechos)}, {"fecha": 1, "celdas": list(celdas)}


def test_el_archivo_separa_ocupados_con_su_elite_de_los_nichos_listos():
    hs = [_h(1, elo=1100), _h(2, elo=1300), _h(3)]
    e, mapa = _e(hs, [
        _celda("preclinica", "plasma", "astrocito", hipotesis=["h1", "h2", "h3"]),
        _celda("prodromica_dcl", "plasma", "astrocito", hechos=["a", "b"], cohortes=["ADNI", "BIOCARD"]),
    ])
    a = NI.archivo(e, INV, mapa=mapa)
    assert [o["vivas"] for o in a["ocupados"]] == [3] and a["ocupados"][0]["elite"]["id"] == "h2"
    assert [x["clave"] for x in a["listos"]] == [("prodromica_dcl", "plasma", "astrocito")]
    assert a["saturada"] == ("preclinica", "plasma", "astrocito")


def test_un_nicho_de_una_sola_cohorte_no_esta_listo():
    """Lo que naciera ahí iría al vivero: el 74 % de las celdas vacías de la base."""
    e, mapa = _e([_h(1)], [_celda("prodromica_dcl", "plasma", "astrocito", hechos=["a", "b", "c"], cohortes=["ADNI"])])
    a = NI.archivo(e, INV, mapa=mapa)
    assert a["listos"] == [] and a["sinFruto"] == 1


def test_la_version_vaga_de_una_celda_llena_no_es_un_nicho():
    """"cualquier fase × plasma × astrocito" frente a la celda llena "preclínica ×
    plasma × astrocito": premiarla premiaría quitar la fase para ganar puntos."""
    e, mapa = _e([_h(1), _h(2), _h(3)], [
        _celda("preclinica", "plasma", "astrocito", hipotesis=["h1", "h2", "h3"]),
        _celda(None, "plasma", "astrocito", hechos=["a"] * 23, cohortes=["A", "B", "C"]),
        _celda("prodromica_dcl", "plasma", "astrocito", hechos=["a"], cohortes=["A", "B"]),
    ])
    a = NI.archivo(e, INV, mapa=mapa)
    assert [x["clave"] for x in a["listos"]] == [("prodromica_dcl", "plasma", "astrocito")]
    assert a["vagos"] == 1


def test_una_celda_con_un_solo_eje_es_demasiado_generica():
    e, mapa = _e([], [_celda(None, "plasma", None, hechos=["a"], cohortes=["A", "B"])])
    assert NI.archivo(e, INV, mapa=mapa)["listos"] == []


def test_una_descartada_no_ocupa_la_celda_pero_la_celda_no_se_ofrece_como_vacia():
    """El nicho de una descartada no se vuelve a ofrecer como si nadie lo hubiera
    intentado: ROSA2018 no repropone lo descartado."""
    e, mapa = _e([_h(1, estado="descartada")], [_celda("prodromica_dcl", "plasma", "astrocito", hipotesis=["h1"], hechos=["a"], cohortes=["A", "B"])])
    a = NI.archivo(e, INV, mapa=mapa)
    assert a["ocupados"] == [] and a["listos"] == []


def test_manda_lo_que_la_mision_nombra_y_despues_las_cohortes():
    e, mapa = _e([], [
        _celda("preclinica", "plasma", "neurona", hechos=["a"], cohortes=["A", "B", "C", "D"]),
        _celda("prodromica_dcl", "lcr", "neurona", hechos=["a"], cohortes=["A", "B"], por_mision=1),
    ])
    assert NI.archivo(e, INV, mapa=mapa)["listos"][0]["clave"] == ("prodromica_dcl", "lcr", "neurona")


def test_el_reparto_deja_siempre_uno_libre_y_rota():
    listos = [{"clave": (f"e{i}", "r", "c"), "etiqueta": f"n{i}"} for i in range(5)]
    vistos = set()
    libres = set()
    for turno in range(8):
        r = NI.reparto(listos, EQ.MIEMBROS, turno)
        assert sum(1 for v in r.values() if v is None) == 1
        libres |= {m for m, v in r.items() if v is None}
        vistos |= {v["etiqueta"] for v in r.values() if v}
    assert libres == set(EQ.MIEMBROS), "cada miembro va libre alguna vez"
    assert vistos == {f"n{i}" for i in range(5)}, "todos los nichos se exploran"


def test_con_menos_nichos_que_miembros_no_se_repite_ninguno():
    r = NI.reparto([{"clave": ("e", "r", "c"), "etiqueta": "unico"}], EQ.MIEMBROS, 0)
    assert [v["etiqueta"] for v in r.values() if v] == ["unico"]
    assert NI.reparto([], EQ.MIEMBROS, 3) == {m: None for m in EQ.MIEMBROS}


def test_el_texto_del_miembro_lleva_el_nicho_sus_hechos_y_la_regla_de_no_forzar():
    e, mapa = _e([_h(1), _h(2), _h(3)], [
        _celda("preclinica", "plasma", "astrocito", hipotesis=["h1", "h2", "h3"]),
        _celda("prodromica_dcl", "plasma", "astrocito", hechos=["he1"], cohortes=["ADNI", "BIOCARD"]),
    ], hechos=[{"id": "he1", "enunciado": "El GFAP plasmático sube en DCL amiloide positivo"}])
    a = NI.archivo(e, INV, mapa=mapa)
    t = NI.texto_para_miembro(a["listos"][0], a, e)
    assert "Nicho que te toca: fase prodrómica o DCL" in t and "El GFAP plasmático sube en DCL" in t
    assert "no lo fuerces" in t and "YA hay hipótesis vivas" in t and "3 vivas" in t
    assert "Nicho: libre" in NI.texto_para_miembro(None, a, e)


def test_el_marcador_suma_en_nicho_vacio_y_resta_en_la_celda_llena():
    inv = {"id": INV, "titulo": "GFAP y NfL en portadores de APOE4", "objetivo": "GFAP antes que NfL"}
    arch = {"listos": [{"clave": ("prodromica_dcl", "plasma", "astrocito"), "etiqueta": "DCL × plasma × astrocito", "cohortes": ["A", "B"]}], "ocupados": [{"clave": ("preclinica", "plasma", "astrocito"), "vivas": 7}], "saturada": ("preclinica", "plasma", "astrocito")}
    en_nicho = {"titulo": "GFAP plasmático en DCL prodrómico", "enunciado": "En deterioro cognitivo leve el GFAP plasmático predice conversión", "etapa": "prodrómica", "celula": "astrocito"}
    en_llena = {"titulo": "GFAP plasmático preclínico", "enunciado": "En fase preclínica el GFAP plasmático sube antes", "etapa": "preclínica", "celula": "astrocito"}
    evidencia_dcl = NI.ejes_de_respaldo(["En participantes con deterioro cognitivo leve de ADNI, el GFAP plasmático de astrocitos reactivos predijo la conversión"])
    assert NI.puntos_por_nicho(NI.celdas_de_propuesta(en_nicho, inv), arch, evidencia_dcl)[0] == 2
    puntos, motivo = NI.puntos_por_nicho(NI.celdas_de_propuesta(en_llena, inv), arch)
    assert puntos == -2 and "ya hay 7 hipótesis vivas" in motivo
    assert NI.puntos_por_nicho(set(), arch) == (0, None) and NI.puntos_por_nicho({("x", "y", "z")}, None) == (0, None)


def test_sin_mapa_o_con_mapa_roto_no_hay_nichos_y_nada_se_rompe():
    e = {"hipotesis": [], "investigaciones": [{"id": INV}], "hechos": []}
    assert NI.archivo(e, "otra", mapa=None)["listos"] == []
    assert NI.archivo(e, INV, mapa={"fecha": 1, "celdas": [None, "basura", {"estadio": 3}]})["listos"] == []


def test_la_hipotesis_que_nace_guarda_su_nicho():
    inv = {"id": INV, "titulo": "T", "objetivo": "O"}
    arch = {"listos": [{"clave": ("prodromica_dcl", "plasma", "astrocito")}]}
    hp = {"titulo": "GFAP en DCL", "enunciado": "GFAP plasmático en deterioro cognitivo leve", "etapa": "prodrómica", "celula": "astrocito"}
    evidencia = NI.ejes_de_respaldo(["En deterioro cognitivo leve el GFAP plasmático de astrocitos sube"])
    n = NI.nicho_de_hipotesis(hp, inv, arch, evidencia)
    assert n["enNichoListo"] is True and any("prodrómica" in c for c in n["celdas"])
    # Sin la evidencia, la medida del efecto tampoco lo cuenta.
    assert NI.nicho_de_hipotesis(hp, inv, arch)["enNichoListo"] is False


def test_el_equipo_recibe_su_nicho_y_la_firma_tiene_la_regla():
    from rosa.bucle import pasos as PASOS
    from rosa.modulos import firmas as F

    assert "nicho" in F.GenerarHipotesis.model_fields
    assert "no lo fuerces" in (F.GenerarHipotesis.model_fields["nicho"].json_schema_extra or {}).get("desc", "") or "no lo fuerces" in str(F.GenerarHipotesis.model_fields["nicho"])
    fuente = inspect.getsource(PASOS._equipo_de_hipotesis)
    assert "nicho=texto_nicho[enfoque]" in fuente and "nichos=archivo_nichos" in fuente
    nace = inspect.getsource(PASOS.paso_hipotesis)
    assert 'h["nicho"] = NI.nicho_de_hipotesis' in nace and 'semilla["nicho"] = NI.nicho_de_hipotesis' in nace


def test_los_nichos_nunca_tumban_al_equipo(monkeypatch):
    """Si el mapa falla o choca con una escritura, el equipo trabaja sin nichos."""
    import asyncio
    from types import SimpleNamespace

    from rosa.bucle import pasos as PASOS

    monkeypatch.setattr(NI, "archivo", lambda *a, **k: 1 / 0)
    ctx = SimpleNamespace(e={}, investigacion_id=INV, corrida=lambda: {})
    assert asyncio.run(PASOS._archivo_de_nichos(ctx, {"id": INV})) == {"ocupados": [], "listos": [], "saturada": None, "sinFruto": 0}
    sin_corrida = SimpleNamespace(e={}, investigacion_id=INV)
    assert asyncio.run(PASOS._archivo_de_nichos(sin_corrida, {"id": INV}))["listos"] == []



def test_nombrar_la_fase_sin_evidencia_de_esa_fase_no_da_puntos():
    """El intento de trampa que Huang y otros (arXiv 2609.28614) predicen para un
    generador que ve en el tablón por qué lo puntúan: escribir "deterioro
    cognitivo leve" en la propuesta para caer en el nicho vacío, citando
    afirmaciones que no dicen nada de esa fase. No da puntos."""
    inv = {"id": INV, "titulo": "GFAP y NfL en portadores de APOE4", "objetivo": "GFAP antes que NfL"}
    arch = {"listos": [{"clave": ("prodromica_dcl", "plasma", "astrocito"), "etiqueta": "DCL × plasma × astrocito", "cohortes": ["A", "B"]}], "ocupados": [], "saturada": None}
    propuesta = {"titulo": "GFAP plasmático en DCL", "enunciado": "En deterioro cognitivo leve el GFAP plasmático de astrocitos predice conversión", "etapa": "prodrómica", "celula": "astrocito"}
    celdas = NI.celdas_de_propuesta(propuesta, inv)
    assert ("prodromica_dcl", "plasma", "astrocito") in celdas  # por sus palabras, cae en el nicho
    sin_fase = NI.ejes_de_respaldo(["El GFAP plasmático de los astrocitos sube con la edad", "El GFAP en plasma se asocia al amiloide"])
    assert NI.puntos_por_nicho(celdas, arch, sin_fase) == (0, None)
    assert NI.puntos_por_nicho(celdas, arch, None) == (0, None)


def test_el_marcador_del_equipo_mira_las_afirmaciones_citadas():
    """Integración: `equipo.puntuar` pasa el texto de lo que la propuesta cita."""
    fuente = inspect.getsource(EQ.puntuar)
    assert "NI.ejes_de_respaldo(" in fuente and "for a in respaldo" in fuente
