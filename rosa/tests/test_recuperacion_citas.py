"""La recuperación de citas de punta a punta (28 de septiembre de 2026): una
afirmación bloqueada por una regla que ya no vale vuelve a juzgarse, se enlaza
a la hipótesis que sostiene y la conclusión de esa hipótesis se rehace.

La pasada anterior se quedaba en el veredicto: la afirmación quedaba sostenida
en su corrida sin llegar a ninguna hipótesis, así que ninguna certeza se movía.
Aquí se exige el camino entero con el almacén y el supervisor de verdad; solo
las llamadas a los modelos son simuladas.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from rosa import config
from rosa import indice_semantico
from rosa import recuperacion_citas as RC
from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado.almacen import Almacen
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.modulos.contador import PresupuestoAgotado
from rosa.tests.test_integracion_corrida import _pred_conclusion
from rosa.vigilante_modelos import ModeloSinRespuesta

TEXTO_WEB = "En el ensayo, GFAP en plasma sube antes que NfL en portadores de APOE4 con amiloide positivo, y la diferencia se mantuvo a los dos años."


def _afirmacion(id_: str, veredicto: str = "cita_no_resuelve", pasaje: str = "GFAP en plasma sube antes que NfL en portadores de APOE4", iteracion: int = 1) -> dict:
    return {
        "id": id_,
        "texto": "GFAP en plasma sube antes que NfL en portadores de APOE4 con amiloide positivo.",
        "cita": "[Kim et al., 2025, texto web, parte 1]",
        "fragmento": pasaje,
        "veredicto": veredicto,
        "motivo": "La cita no apunta a ninguna fuente ni localizador conocidos (verificador anterior).",
        "fuenteId": "f-kim",
        "localizador": "texto web, parte 1",
        "iteracion": iteracion,
        "tipo": "dato",
        "cohorte": "BioFINDER-2",
    }


def _preparar(n_recuperables: int = 1):
    """Una investigación con una corrida TERMINADA cuyas afirmaciones se
    bloquearon con el verificador anterior, y una hipótesis viva sin conclusión."""
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        inv_id = A.crear_investigacion(e, {"titulo": "GFAP y NfL", "objetivo": "Orden de alteración de GFAP y NfL en la fase preclínica", "condicionParada": "3 iteraciones"}, 1000)
        c = P.nueva_corrida(inv_id, 1, 1000)
        c["estado"] = "terminada"
        c["_fuentes"] = {
            "f-kim": {
                "id": "f-kim", "referencia": "Kim et al., 2025", "titulo": "GFAP antes que NfL", "tipo": "articulo", "doi": "10.1/kim", "cohorte": "BioFINDER-2",
                "fragmentos": [{"localizador": "resumen", "texto": "Un resumen."}, {"localizador": "texto web, parte 1", "texto": TEXTO_WEB}],
            }
        }
        c["_afirmaciones"] = [_afirmacion(f"af-{i}") for i in range(n_recuperables)] + [
            _afirmacion("af-inventada", veredicto="no_sostenida", pasaje="la mortalidad bajó un noventa por ciento"),
        ]
        e["corridas"].append(c)
        it = P.nueva_iteracion(c["id"], 1, 1000, [])
        e["iteraciones"].append(it)
        h = P.nueva_hipotesis(inv_id, 1, 1000, titulo="GFAP sube antes que NfL en APOE4", enunciado="En portadores de APOE4 con amiloide positivo, GFAP en plasma se altera antes que NfL",
                              mecanismo="La activación astrocitaria precede al daño axonal", comprobacion={"biomarcador": "GFAP y NfL", "cohorte": "BioFINDER", "diseno": "cohorte"}, afirmaciones=[])
        e["hipotesis"].append(h)
        e["_ids"] = {"inv": inv_id, "cor": c["id"], "hip": h["id"]}
        return True

    al.mutar(fn, "preparar")
    ids = al.estado.pop("_ids")
    return al, ids


def _juez(veredicto: str = "sostenida"):
    return SimpleNamespace(veredicto=SimpleNamespace(veredicto=veredicto, motivo=f"El juez: {veredicto}.", entidad_distinta=False))


def _asignar(kw):
    return SimpleNamespace(relaciones=[SimpleNamespace(indice=1, relacion="apoya", motivo="Misma población y mismo sentido.", socava_a=None)])


class Modelos:
    """La `Ctx.llamar` simulada: responde por programa y cuenta las llamadas."""

    def __init__(self, juez=None):
        self.vistas: list[str] = []
        self.juez = juez or (lambda n: _juez())

    async def __call__(self, ctx, rol, programa, **kw):
        self.vistas.append(programa)
        if programa == "juzgar":
            return self.juez(self.vistas.count("juzgar"))
        if programa == "asignar_evidencia":
            return _asignar(kw)
        if programa == "concluir":
            return _pred_conclusion()
        raise RuntimeError(f"programa sin respuesta en la simulación: {programa}")


def _supervisor(al, monkeypatch, modelos: Modelos):
    async def llamar(self, rol, programa, rollout_id=None, **kw):
        return await modelos(self, rol, programa, **kw)

    monkeypatch.setattr(Ctx, "llamar", llamar)
    monkeypatch.setattr(indice_semantico, "disponible", lambda: False)  # candidatas por términos, sin red
    programas = SimpleNamespace(juzgar="juzgar", asignar_evidencia="asignar_evidencia", concluir="concluir")
    lms = SimpleNamespace(cerebro=SimpleNamespace(model="sim-cerebro"), juez=SimpleNamespace(model="sim-juez"), volumen=SimpleNamespace(model="sim-volumen"))
    return CO.Supervisor(al, programas, lms)


def _inv(al, ids):
    return next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])


def _cor(al, ids, corrida_id=None):
    return next(c for c in al.estado["corridas"] if c["id"] == (corrida_id or ids["cor"]))


def _hip(al, ids):
    return next(h for h in al.estado["hipotesis"] if h["id"] == ids["hip"])


def test_de_punta_a_punta_la_afirmacion_llega_a_la_hipotesis_y_su_conclusion_se_rehace(monkeypatch):
    al, ids = _preparar()
    modelos = Modelos()
    sup = _supervisor(al, monkeypatch, modelos)
    assert RC.recuperables(al.estado, ids["inv"])["bloqueosViejos"] == 1
    assert al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]}, actor="emir@alzheimerproject.com") is True
    assert sup._hay_recuperacion_de_citas()
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "terminada"

    af = next(a for a in _cor(al, ids)["_afirmaciones"] if a["id"] == "af-0")
    assert af["veredicto"] == "sostenida" and af["veredictoAnterior"] == "cita_no_resuelve"
    assert af["recuperadaEn"] and af["recuperadaEnlazadaEn"]
    # La que sigue caída por otra razón (el pasaje no está en la fuente) ni se toca.
    otra = next(a for a in _cor(al, ids)["_afirmaciones"] if a["id"] == "af-inventada")
    assert otra["veredicto"] == "no_sostenida" and "recuperadaEn" not in otra

    h = _hip(al, ids)
    enlazadas = [a for a in h["afirmaciones"] if a.get("relacion") == "apoya"]
    assert len(enlazadas) == 1 and "GFAP" in enlazadas[0]["texto"]
    assert any(r.startswith("Recuperación de citas del") for r in h["procedencia"]["registro"])
    assert h["procedencia"]["fuentes"] and h["procedencia"]["fuentes"][0]["id"] == "f-kim"
    # La conclusión se rehízo con el juez: ahora existe y cuenta la afirmación nueva.
    assert isinstance(h.get("conclusion"), dict) and h["conclusion"]["base"]["sostenidas"] == 1

    reg = _inv(al, ids)["recuperacionCitas"]
    assert reg["estado"] == "terminada" and reg["quien"] == "emir@alzheimerproject.com"
    assert reg["revisadas"] == 1 and reg["desbloqueadas"] == 1 and reg["recuento"] == {"sostenida": 1}
    assert reg["enlazadas"] == 1 and reg["hipotesisConEvidencia"] == [ids["hip"]]
    assert [x["hipotesisId"] for x in reg["reconcluidas"]] == [ids["hip"]] and reg["reconcluidas"][0]["antes"] is None
    assert modelos.vistas.count("juzgar") == 1 and modelos.vistas.count("concluir") == 1
    assert any(ev["texto"].startswith("Recuperación de citas: 1 afirmaciones vueltas a juzgar") for ev in al.estado["eventos"])
    # Ya no queda nada que recuperar, y el supervisor no la vuelve a lanzar.
    assert RC.recuperables(al.estado, ids["inv"])["bloqueosViejos"] == 0
    assert not sup._hay_recuperacion_de_citas()
    al.cerrar()


def test_no_empieza_con_una_corrida_trabajando_y_sigue_cuando_para(monkeypatch):
    al, ids = _preparar()
    modelos = Modelos()
    sup = _supervisor(al, monkeypatch, modelos)

    def otra_viva(e):
        c = P.nueva_corrida(ids["inv"], 2, 2000)
        c["estado"] = "en_marcha"
        e["corridas"].append(c)
        e["_viva"] = c["id"]
        return True

    al.mutar(otra_viva, "otra")
    viva_id = al.estado.pop("_viva")
    al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]})
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "en_espera"
    assert modelos.vistas == [] and _inv(al, ids)["recuperacionCitas"]["estado"] == "en_espera"
    al.mutar(lambda e: _cor(al, ids, viva_id).__setitem__("estado", "detenida") or True, "para")
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "terminada"
    assert modelos.vistas.count("juzgar") == 1
    al.cerrar()


def test_si_se_corta_a_mitad_se_retoma_sin_volver_a_pagar_lo_juzgado(monkeypatch):
    al, ids = _preparar(n_recuperables=3)
    monkeypatch.setattr(RC, "TANDA", 1)

    def juez_que_cae(n):
        if n == 2:
            raise ModeloSinRespuesta("juez", "sim-juez", 4, 0)
        return _juez()

    modelos = Modelos(juez=juez_que_cae)
    sup = _supervisor(al, monkeypatch, modelos)
    al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]})
    with pytest.raises(ModeloSinRespuesta):
        asyncio.run(RC.recuperar(sup, ids["inv"]))
    reg = _inv(al, ids)["recuperacionCitas"]
    assert reg["estado"] == "en_curso" and reg["revisadas"] == 1  # la primera tanda quedó guardada
    # Otro proceso (tras un reinicio) retoma: solo juzga las dos que faltaban.
    al.cerrar()
    al2 = Almacen(al.ruta)
    modelos2 = Modelos()
    sup2 = _supervisor(al2, monkeypatch, modelos2)
    assert asyncio.run(RC.recuperar(sup2, ids["inv"])) == "terminada"
    assert modelos2.vistas.count("juzgar") == 2
    reg = _inv(al2, ids)["recuperacionCitas"]
    assert reg["revisadas"] == 3 and reg["desbloqueadas"] == 3
    al2.cerrar()


def test_el_tope_agotado_de_una_corrida_se_dice_y_no_tumba_la_pasada(monkeypatch):
    al, ids = _preparar()

    def juez_sin_tope(n):
        raise PresupuestoAgotado("tope de la corrida")

    modelos = Modelos(juez=juez_sin_tope)
    sup = _supervisor(al, monkeypatch, modelos)
    al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]})
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "terminada"
    reg = _inv(al, ids)["recuperacionCitas"]
    assert any("se agotó su tope" in n and "Se puede ampliar el tope" in n for n in reg["notas"])
    assert reg["revisadas"] == 0 and reg["enlazadas"] == 0
    al.cerrar()


def test_una_afirmacion_que_el_juez_no_sostiene_no_se_enlaza(monkeypatch):
    al, ids = _preparar()
    modelos = Modelos(juez=lambda n: _juez("no_sostenida"))
    sup = _supervisor(al, monkeypatch, modelos)
    al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]})
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "terminada"
    af = next(a for a in _cor(al, ids)["_afirmaciones"] if a["id"] == "af-0")
    assert af["veredicto"] == "no_sostenida" and "recuperadaEn" not in af
    assert _hip(al, ids)["afirmaciones"] == [] and modelos.vistas.count("concluir") == 0
    # El caso que colgaba la primera versión: la comprobación sin modelo no puede
    # reproducir un "no sostenida" del juez y la volvía a elegir sin fin. Una sola
    # llamada, y después no cuenta como bloqueo viejo.
    assert modelos.vistas.count("juzgar") == 1
    assert RC.recuperables(al.estado, ids["inv"])["bloqueosViejos"] == 0
    # Pedirla otra vez tampoco la vuelve a mandar al juez.
    al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]})
    assert asyncio.run(RC.recuperar(sup, ids["inv"])) == "terminada"
    assert modelos.vistas.count("juzgar") == 1
    al.cerrar()


def test_un_no_sostenida_del_juez_no_es_un_bloqueo_viejo_y_uno_por_identificador_si():
    from rosa import citas as CI

    hoy_no_bloquea = {"veredicto": "sin_verificar", "motivo": "Pendiente del juez.", "bloquea": False}
    assert CI.es_bloqueo_viejo({"veredicto": "no_sostenida", "motivo": "El juez: no dice eso."}, hoy_no_bloquea) is False
    assert CI.es_bloqueo_viejo({"veredicto": "no_sostenida", "motivo": "Identificadores que no aparecen en el fragmento citado: NCT01234567."}, hoy_no_bloquea) is True
    assert CI.es_bloqueo_viejo({"veredicto": "cita_no_resuelve", "motivo": "..."}, hoy_no_bloquea) is True
    assert CI.es_bloqueo_viejo({"veredicto": "cita_no_resuelve", "motivo": "..."}, {"bloquea": True}) is False
    assert CI.es_bloqueo_viejo({"veredicto": "sostenida"}, hoy_no_bloquea) is False


def test_la_peticion_no_se_duplica_y_guarda_la_anterior():
    al, ids = _preparar()
    assert al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]}) is True
    assert al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"]}) is False  # ya hay una pedida
    al.mutar(lambda e: _inv(al, ids)["recuperacionCitas"].__setitem__("estado", "terminada") or True, "fin")
    assert al.aplicar("pedirRecuperacionCitas", {"investigacion_id": ids["inv"], "corrida_id": ids["cor"]}) is True
    inv = _inv(al, ids)
    assert inv["recuperacionCitas"]["corridaId"] == ids["cor"] and inv["recuperacionesAnteriores"][0]["estado"] == "terminada"
    # Una corrida de otra investigación no vale.
    assert al.aplicar("pedirRecuperacionCitas", {"investigacion_id": "inv-ajena", "corrida_id": ids["cor"]}) is False
    al.cerrar()


def test_el_trabajo_fuera_de_iteracion_se_carga_al_tope_de_la_corrida(monkeypatch):
    vistos: list = []
    monkeypatch.setattr(PASOS, "presupuesto_ok", lambda almacen, corrida_id, iteracion: vistos.append(iteracion) or False)
    al, ids = _preparar()
    for sin_tope, esperado in ((True, None), (False, 7)):
        lms = SimpleNamespace(cerebro=SimpleNamespace(model="c"), juez=SimpleNamespace(model="j"), volumen=SimpleNamespace(model="v"))
        ctx = Ctx(al, SimpleNamespace(), lms, ids["cor"], ids["inv"], "", 7, sin_tope_de_iteracion=sin_tope)
        with pytest.raises(PresupuestoAgotado):
            asyncio.run(ctx.llamar("juez", object()))
        assert vistos[-1] == esperado
    al.cerrar()


def test_el_boton_de_una_corrida_pide_la_recuperacion_y_el_contador_la_ve(monkeypatch):
    from fastapi.testclient import TestClient

    from rosa.servidor import crear_app

    al, ids = _preparar()
    raiz = Path(tempfile.mkdtemp())
    monkeypatch.setattr(config, "RAIZ", raiz)
    dist = raiz / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>rosa</html>")
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: "test@alzheimerproject.com" if token == "sesion-test" else None)
    c = TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-test"})
    r = c.get(f"/api/investigaciones/{ids['inv']}/citas/recuperables")
    assert r.status_code == 200 and r.json()["bloqueosViejos"] == 1 and r.json()["porCorrida"][0]["bloqueosViejos"] == 1
    assert c.get("/api/investigaciones/no-existe/citas/recuperables").status_code == 404
    r = c.post(f"/api/corridas/{ids['cor']}/citas/reverificar", headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["pedida"] is True
    reg = _inv(al, ids)["recuperacionCitas"]
    assert reg["estado"] == "pedida" and reg["corridaId"] == ids["cor"] and reg["quien"] == "test@alzheimerproject.com"
    # Pedirla otra vez mientras está pendiente no abre otra.
    assert c.post(f"/api/corridas/{ids['cor']}/citas/reverificar", headers={"X-Rosa": "1"}).json()["ok"] is False
    al.cerrar()
