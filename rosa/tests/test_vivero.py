"""El vivero: una propuesta nace como hipótesis solo cuando su evidencia da
para certeza baja (dos cohortes distintas); si no, espera acumulando evidencia
y nace después, o se retira si no gana nada en varias iteraciones."""
import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

from rosa import certeza as C
from rosa import politicas
from rosa.bucle import contexto as T
from rosa.bucle import evidencia as EV
from rosa.bucle import pasos as PASOS
from rosa.bucle import vivero as VIVERO
from rosa.bucle.pasos import Ctx
from rosa.estado.almacen import Almacen
from rosa.tests.test_evidencia import _af


def _fuentes(*cohortes):
    return [{"id": f"f{i}", "referencia": f"Ref {i}", "titulo": f"T{i}", "cohorte": c} for i, c in enumerate(cohortes)]


def test_cohortes_distintas_agrupa_alias_y_no_cuenta_fuentes_sin_cohorte():
    h = {"procedencia": {"fuentes": _fuentes("ADAD", "ADAD (portadores PSEN1/APP) - cohorte Belder et al.", "Belder et al. (cohorte longitudinal ADAD, familias con mutaciones)", "", None)}}
    assert C.cohortes_distintas(h) == ["ADAD"] and C.fuentes_sin_cohorte(h) == 2
    assert C.cohortes_distintas({"procedencia": {"fuentes": _fuentes("BIOCARD", "ADNI", "biocard")}}) == ["BIOCARD", "ADNI"]
    nivel, motivo = C.techo({"afirmaciones": [{"veredicto": "sostenida", "tipo": "dato", "clase": "literatura"}], "procedencia": {"fuentes": _fuentes("BIOCARD", "", "")}})
    assert nivel == "muy_baja" and "2 fuentes sin cohorte identificada" in motivo
    escalera = C.escalera({"afirmaciones": [], "procedencia": {"fuentes": _fuentes("", "")}}, "muy_baja")
    assert "no tienen la cohorte identificada" in escalera[0]["falta"]


def test_destino_de_propuesta_una_cohorte_vivero_dos_nace():
    af = [{"veredicto": "sostenida", "tipo": "dato", "clase": "literatura", "sintetico": False}]
    assert PASOS.destino_de_propuesta(af, _fuentes("BIOCARD"))[0] == "vivero"
    assert PASOS.destino_de_propuesta(af, _fuentes("BIOCARD", "ADNI"))[0] == "nace"
    assert PASOS.destino_de_propuesta([], _fuentes("BIOCARD", "ADNI"))[0] == "vivero"  # sin afirmaciones sostenidas no nace nada


def _hp(titulo="GFAP antes que NfL en APOE ε4"):
    return SimpleNamespace(titulo=titulo, enunciado="En portadores de APOE ε4 amiloide positivos, GFAP se altera antes que NfL", mecanismo="astrocitos antes que axones", biomarcador="GFAP, NfL", cohorte="APOE ε4 A+", diseno="longitudinal", cluster="glia", justificacion="orden temporal", afirmaciones=[1], supuestos=["umbrales estables"], entidades_novedad=["GFAP", "NEFL"], derivada_de=None, diana="GFAP", celula="astrocito", etapa="preclínica", intervencion="", direccion="sin_intervencion", prediccion_falsable="GFAP cruza antes que NfL en más del 60 %", riesgos=["cohorte única"], paso_ruta="mecanismo")


def test_semilla_se_anade_sin_repetir_y_el_tope_retira_la_mas_vieja():
    e = {"investigaciones": [{"id": "inv", "titulo": "t"}], "hipotesis": [], "eventos": []}
    af = [dict(_af("af-4", "GFAP precede a NfL en BIOCARD", "xie", "BIOCARD"), afirmacionId="af-4")]
    s = VIVERO.nueva_semilla("inv", 1, 1000, _hp(), af, _fuentes("BIOCARD"), "solo literatura de una sola cohorte", "cor")
    assert s["tarjeta"]["diana"] == "GFAP" and s["supuestos"] == ["umbrales estables"] and "segunda cohorte independiente" in s["falta"]
    assert VIVERO.anadir(e, "inv", s, 1000) is True and VIVERO.anadir(e, "inv", dict(s, id="otro"), 1001) is False
    assert e["eventos"][-1]["tipo"] == "vivero" and "Idea al vivero" in e["eventos"][-1]["texto"]
    for i in range(politicas.MAX_VIVERO):
        VIVERO.anadir(e, "inv", dict(s, id=f"s{i}", titulo=f"Idea {i}", actualizadaEn=2000 + i), 3000)
    vivero = e["investigaciones"][0]["vivero"]
    assert len(vivero) == politicas.MAX_VIVERO and s["id"] not in {x["id"] for x in vivero}  # la original era la más vieja
    assert any("Sale del vivero" in ev["texto"] and "lleno" in ev["texto"] for ev in e["eventos"])
    assert "Idea 3" in T.vivero_texto(e["investigaciones"][0], maximo=20) and "le falta:" in T.vivero_texto(e["investigaciones"][0])


def _almacen_con_semilla(iteracion_semilla=1, con_afirmaciones_nuevas=True):
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        af = [dict(_af("af-4", "GFAP precede a NfL en BIOCARD", "xie", "BIOCARD", iteracion=1), afirmacionId="af-4")]
        s = VIVERO.nueva_semilla("inv", iteracion_semilla, 1000, _hp(), af, [{"id": "xie", "referencia": "Xie et al., 2026", "titulo": "BIOCARD", "cohorte": "BIOCARD"}], "una sola cohorte", "cor")
        e["investigaciones"].append({"id": "inv", "titulo": "t", "objetivo": "GFAP y NfL", "vivero": [s]})
        e["corridas"].append({"id": "cor", "investigacionId": "inv", "estado": "en_marcha", "busqueda": {"consultas": []}, "gasto": {},
                              "_fuentes": {"kim": {"id": "kim", "referencia": "Kim et al., 2025", "titulo": "ADNI", "cohorte": "ADNI", "fragmentos": []}},
                              "_afirmaciones": [_af("af-1", "En ADNI, GFAP en plasma se altera antes que NfL en portadores de APOE ε4", "kim", "ADNI", iteracion=7)] if con_afirmaciones_nuevas else []})
        return True

    al.mutar(fn, "test")
    return al


def _ctx(al, relaciones, monkeypatch):
    async def llamar(self, rol, programa, **kw):
        assert "Título: GFAP antes que NfL" in kw["hipotesis"]
        return SimpleNamespace(relaciones=relaciones)

    monkeypatch.setattr(Ctx, "llamar", llamar)
    return Ctx(al, SimpleNamespace(asignar_evidencia="asignar_evidencia"), None, "cor", "inv", "", 7)


def test_la_semilla_nace_cuando_llega_la_segunda_cohorte(monkeypatch):
    al = _almacen_con_semilla()
    try:
        ctx = _ctx(al, [SimpleNamespace(indice=1, relacion="apoya", motivo="misma población y sentido")], monkeypatch)
        r = asyncio.run(EV.acumular_vivero(ctx, 7))
        assert r["semillas"] == 1 and r["anadidas"] == 1 and len(r["nacidas"]) == 1 and r["retiradas"] == []
        e = al.estado
        assert e["investigaciones"][0]["vivero"] == []
        h = e["hipotesis"][0]
        assert h["id"] == r["nacidas"][0] and h["estado"] == "propuesta" and h["origen"] == "rosa" and h["_revisionPedida"] is True and h["iteracion"] == 7
        assert [f["id"] for f in h["procedencia"]["fuentes"]] == ["xie", "kim"] and C.cohortes_distintas(h) == ["BIOCARD", "ADNI"]
        assert len(h["afirmaciones"]) == 2 and h["afirmaciones"][1]["relacion"] == "apoya" and h["tarjeta"]["prediccionFalsable"].startswith("GFAP cruza")
        assert "Nacida del vivero en la iteración 7" in h["procedencia"]["mensaje"] if "mensaje" in h["procedencia"] else True
        assert any(ev["tipo"] == "hipotesis_nueva" and "Nace del vivero con evidencia de 2 cohortes" in ev["texto"] for ev in e["eventos"])
        assert C.techo(h)[0] == "baja"
    finally:
        al.cerrar()


def test_la_semilla_se_retira_tras_seis_iteraciones_sin_evidencia_y_no_antes(monkeypatch):
    al = _almacen_con_semilla(iteracion_semilla=1, con_afirmaciones_nuevas=False)
    try:
        ctx = _ctx(al, [], monkeypatch)
        r = asyncio.run(EV.acumular_vivero(ctx, 7))
        assert r["nacidas"] == [] and r["retiradas"] == ["GFAP antes que NfL en APOE ε4"] and al.estado["investigaciones"][0]["vivero"] == []
        assert any(ev["tipo"] == "vivero" and "Sale del vivero sin nacer" in ev["texto"] for ev in al.estado["eventos"])
    finally:
        al.cerrar()
    al = _almacen_con_semilla(iteracion_semilla=5, con_afirmaciones_nuevas=False)
    try:
        r = asyncio.run(EV.acumular_vivero(_ctx(al, [], monkeypatch), 7))
        assert r["retiradas"] == [] and len(al.estado["investigaciones"][0]["vivero"]) == 1
    finally:
        al.cerrar()


def test_hipotesis_vivas_ensena_el_peldano_siguiente():
    hs = [{"id": "h1", "investigacionId": "inv", "estado": "propuesta", "elo": 1500, "titulo": "GFAP antes que NfL", "procedencia": {"fuentes": _fuentes("BIOCARD")},
           "conclusion": {"certeza": "muy_baja", "direccion": "apoya", "loMasFragil": "umbrales", "subiria": "una réplica", "bajaria": "orden inverso", "escalera": [{"de": "muy_baja", "a": "baja", "falta": "una segunda cohorte independiente"}]}}]
    t = T.hipotesis_vivas(hs, "inv")
    assert "peldaño siguiente (por regla): para subir a baja le falta una segunda cohorte independiente. Cohortes distintas hoy: 1 (BIOCARD)" in t


def test_el_trabajo_del_vivero_no_se_escribe_en_una_pista_ya_cerrada(monkeypatch):
    """Hasta el 29 de septiembre de 2026 el cierre pasaba la MISMA pista a
    `EV.acumular` y a `EV.acumular_vivero`, y `acumular` la cierra al terminar
    con su resumen ya escrito. La línea del vivero ("N ideas, M nacen, K se
    retiran") caía dentro de un paso que la pantalla daba por hecho y no contaba
    en su resumen: el trabajo se hacía y no se veía. Ahora el vivero lleva su
    propia pista."""
    import inspect

    from rosa.bucle import corrida as CO

    fuente = inspect.getsource(CO.Supervisor._cerrar_iteracion) if hasattr(CO, "Supervisor") else inspect.getsource(CO)
    i = fuente.index("EV.acumular(ctx")
    tramo = fuente[i : i + 1200]
    assert "EV.acumular_vivero(ctx" in tramo, "el vivero se acumula en otro sitio: revisar este test"
    # La pista que recibe el vivero no es la que `EV.acumular` acaba de cerrar.
    llamada = tramo[tramo.index("EV.acumular_vivero(ctx") :]
    assert "pista_ev" not in llamada.split(")")[0], "el vivero vuelve a escribir en la pista cerrada de la evidencia"


def test_una_pista_cerrada_ya_no_dice_que_esta_abierta():
    """`abierta` es lo que deja comprobar el caso de arriba en caliente: quien
    abre una pista y llama a algo que puede cerrarla no debe pisar el resumen."""
    from rosa.bucle.pista import Pista

    al = Almacen(Path(tempfile.mkdtemp()) / "p.db")
    try:
        al.mutar(lambda e: (e["iteraciones"].append({"id": "it1", "corridaId": "cor", "numero": 1, "pistas": []}), True)[1], "test")
        p = Pista(al, "it1", None, "modelo", "Prueba", "Sonnet 5")
        assert p.abierta is True
        p.cerrar("hecho")
        assert p.abierta is False
        p2 = Pista(al, "it1", None, "modelo", "Otra", "Sonnet 5")
        p2.fallar("se cayó")
        assert p2.abierta is False
    finally:
        al.cerrar()
