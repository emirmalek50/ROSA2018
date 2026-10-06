"""El enlace consulta -> fuente -> afirmacion que ensena el arbol de
trazabilidad, sin llamar a ningun modelo ni fuente externa."""

import tempfile
from pathlib import Path

from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado.almacen import Almacen


def _ctx():
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteración"}, "id_": "inv"})
    cid = al.aplicar("iniciarCorrida", {"investigacion_id": "inv"})
    return al, Ctx(al, None, None, cid, "inv", "", 1)


def test_registrar_fuente_anota_las_consultas_y_no_duplica():
    al, ctx = _ctx()
    datos = {"referencia": "A et al., 2025", "titulo": "A", "doi": "10.1/a", "pmid": "1", "anio": 2025, "tipos": ["Journal Article"], "resumen": "x"}
    f1 = PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "resumen", "texto": "x" * 100, "encabezado": "A"}], 8, None, "limpio", 1, "q1")
    f2 = PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "pág. 3", "texto": "y" * 100, "encabezado": "A"}], 6, None, "limpio", 1, "q2")
    assert f1 == f2
    f = ctx.fuentes()[f1]
    assert f["consultas"] == ["q1", "q2"]
    assert [fr["localizador"] for fr in f["fragmentos"]] == ["resumen", "pág. 3"]
    assert f["relevancia"] == 8 and f["textoCompleto"] is True
    ev = al.evidencia_de(ctx.corrida_id)
    assert ev["fuentes"][0]["consultas"] == ["q1", "q2"] and ev["fuentes"][0]["fragmentos"] == 2
    assert "_clave" not in ev["fuentes"][0]


def test_la_evidencia_no_viaja_en_la_instantanea():
    al, ctx = _ctx()
    PASOS._registrar_fuente(ctx, {"referencia": "B, 2024", "titulo": "B", "tipos": [], "resumen": ""}, "articulo", [], 5, "retractado", "Retraction", 1, "q")
    c = al.instantanea()["corridas"][0]
    assert "_fuentes" not in c
    assert al.evidencia_de(ctx.corrida_id)["fuentes"][0]["retraccion"] == "retractado"
    assert al.evidencia_de("no-existe") is None


def test_condicion_de_parada_entiende_tiempo_iteraciones_y_llamadas():
    from rosa.bucle.corrida import _condicion_de_parada as f

    c = {"empezadaEn": 0, "gasto": {"llamadas": 50}}
    assert f("2 iteraciones o cuando cambie", 1, c, ahora=10_000) is None
    assert f("2 iteraciones", 2, c, ahora=10_000).startswith("Se alcanzaron las 2 iteraciones")
    assert f("5 minutos, luego finalizara la investigación", 1, c, ahora=4 * 60_000) is None
    assert f("5 minutos, luego finalizara la investigación", 1, c, ahora=5 * 60_000 + 1).startswith("Se cumplió el tiempo")
    assert f("2 horas", 1, c, ahora=7_199_000) is None and f("2 h", 1, c, ahora=7_200_000)
    assert f("1,5 horas", 1, c, ahora=5_400_000)
    assert f("100 llamadas", 1, c, ahora=1) is None and f("50 llamadas", 1, c, ahora=1)
    assert f("cuando el modelo de mundo deje de cambiar", 9, c, ahora=10**12) is None


def test_frase_plantilla_calibrada():
    from rosa.bucle.corrida import frase_plantilla as f

    assert f("apoya", "moderada", "GFAP sube antes que NfL") == "La evidencia reunida probablemente sostiene que GFAP sube antes que NfL."
    assert f("apoya", "muy_baja", "X pasa").startswith("La evidencia es muy incierta sobre si")
    assert f("en_contra", "alta", "X pasa.") == "La evidencia reunida contradice que X pasa."
    assert f("sin_evidencia_directa", "baja", "X pasa").endswith("Esto no significa que no exista.")
    assert "contradictoria" in f("mixta", "baja", "X pasa")
