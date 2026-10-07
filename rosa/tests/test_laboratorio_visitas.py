"""Las visitas atrasadas no silencian ni prolongan la conversación."""
from types import SimpleNamespace

import httpx
import pytest

from rosa import config
from rosa.estado.almacen import Almacen
from rosa.laboratorio_conversaciones import Conversaciones
from rosa.servidor import crear_app


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / "visitas.db")
    al.estado.update(
        investigaciones=[{"id": "inv", "titulo": "MAPT", "mision": {"objetivo": "Revisar literatura"}}],
        corridas=[{"id": "c", "investigacionId": "inv", "estado": "en_marcha", "iteracionActual": 1,
                   "presupuesto": {"limiteLlamadas": 100}, "gasto": {"llamadas": 0}, "_afirmaciones": []}],
        iteraciones=[{"id": "it", "corridaId": "c", "numero": 1, "terminadaEn": None, "planAprobado": True,
                      "presupuesto": {"limite": 50, "usado": 0, "reservaCierre": 10}, "plan": [], "pistas": []}],
    )
    yield al
    al.cerrar()


@pytest.fixture
def visitas(almacen, monkeypatch):
    reloj = [100.0]
    monkeypatch.setattr("rosa.laboratorio_conversaciones.time.monotonic", lambda: reloj[0])

    async def no_llamar(*args, **kwargs):
        raise AssertionError("Las pruebas de presencia no encargan conversación")

    return Conversaciones(almacen, no_llamar), reloj


def test_baja_antigua_no_retira_alta_reciente(visitas):
    s, reloj = visitas
    clave = ("c", "it", "es")
    s.tocar(clave, "persona", True, secuencia=2)
    vence = s.visitas[clave]["persona"]
    reloj[0] += 5
    respuesta = s.tocar(clave, "persona", False, secuencia=1)
    assert respuesta["estado"] == "esperando_hallazgos"
    assert s.visitas[clave]["persona"] == vence
    assert s.ultimas_visitas[clave]["persona"] == 2
    assert not s.tareas


def test_alta_antigua_y_duplicados_no_resucitan_una_baja_reciente(visitas):
    s, _ = visitas
    clave = ("c", "it", "es")
    s.tocar(clave, "persona", True, secuencia=1)
    s.tocar(clave, "persona", False, secuencia=2)
    for secuencia in (1, 2, 0):
        assert s.tocar(clave, "persona", True, secuencia=secuencia)["estado"] == "pausada"
        assert "persona" not in s.visitas[clave]
    assert s.tocar(clave, "persona", True, secuencia=3)["estado"] == "esperando_hallazgos"


def test_repetir_alta_no_renueva_lease_ni_reemplaza_la_expiracion(visitas):
    s, reloj = visitas
    clave = ("c", "it", "es")
    s.tocar(clave, "persona", True, secuencia=7)
    vence = s.visitas[clave]["persona"]
    reloj[0] = vence - 0.1
    s.tocar(clave, "persona", True, secuencia=7)
    assert s.visitas[clave]["persona"] == vence
    reloj[0] = vence + 0.1
    assert s.tocar(clave, "persona", True, secuencia=7)["estado"] == "pausada"
    assert "persona" not in s.visitas[clave]
    assert s.tocar(clave, "persona", False, secuencia=6)["estado"] == "pausada"


def test_alta_nueva_renueva_lease_y_la_baja_actual_la_retira(visitas):
    s, reloj = visitas
    clave = ("c", "it", "es")
    s.tocar(clave, "persona", True, secuencia=1)
    vence = s.visitas[clave]["persona"]
    reloj[0] += 20
    s.tocar(clave, "persona", True, secuencia=2)
    assert s.visitas[clave]["persona"] == vence + 20
    assert s.tocar(clave, "persona", False, secuencia=3)["estado"] == "pausada"
    assert not s.visitas[clave]


def test_clientes_antiguos_funcionan_pero_no_pisan_una_secuencia_negociada(visitas):
    s, _ = visitas
    clave = ("c", "it", "es")
    assert s.tocar(clave, "persona", True)["estado"] == "esperando_hallazgos"
    assert s.tocar(clave, "persona", False)["estado"] == "pausada"
    s.tocar(clave, "persona", True, secuencia=0)
    assert s.tocar(clave, "persona", False)["estado"] == "esperando_hallazgos"
    assert "persona" in s.visitas[clave]


def test_secuencia_se_aisla_por_cliente_idioma_e_iteracion(visitas):
    s, _ = visitas
    es, en, otra = ("c", "it", "es"), ("c", "it", "en"), ("c", "otra", "es")
    s.tocar(es, "persona", True, secuencia=5)
    s.tocar(es, "compañera", True, secuencia=1)
    s.tocar(en, "persona", True, secuencia=1)
    s.tocar(otra, "persona", False, secuencia=9)
    s.tocar(es, "compañera", False, secuencia=2)
    assert set(s.visitas[es]) == {"persona"}
    assert set(s.visitas[en]) == {"persona"}
    assert s.ultimas_visitas[es]["persona"] == 5
    assert s.ultimas_visitas[en]["persona"] == 1
    assert s.ultimas_visitas[otra]["persona"] == 9


def test_visita_atrasada_no_dispara_ronda_nueva_si_aparece_material(visitas, monkeypatch):
    s, _ = visitas
    clave = ("c", "it", "es")
    s.tocar(clave, "persona", True, secuencia=4)
    monkeypatch.setattr("rosa.laboratorio_conversaciones.tema_de", lambda *args: {"corridaId": "c", "iteracionId": "it"})
    monkeypatch.setattr(s, "_presupuesto", lambda *args: True)

    def no_generar(*args):
        raise AssertionError("Una visita vieja no inicia una ronda nueva")

    monkeypatch.setattr(s, "_temas", no_generar)
    assert s.tocar(clave, "persona", True, secuencia=3)["estado"] == "esperando_hallazgos"
    assert not s.tareas


@pytest.mark.asyncio
async def test_endpoint_ordena_visitas_y_valida_secuencia_sin_modelos(almacen, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "RAIZ", tmp_path)
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path / "sin-dist")
    monkeypatch.setattr(config, "ROSA_TOKEN", "")
    app = crear_app(almacen)
    app.state.acceso = SimpleNamespace(usuario=lambda token: "persona@rosa.test" if token == "sesion" else None)
    cuerpo = {"iteracionId": "it", "idioma": "es", "cliente": "cliente-123", "activo": True}
    url = "/api/corridas/c/laboratorio/conversaciones"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8765") as c:
        assert (await c.post(url, json={**cuerpo, "secuencia": 2})).status_code == 401
        c.cookies.set("rosa_sesion", "sesion")
        assert (await c.post(url, json={**cuerpo, "secuencia": 2})).status_code == 403
        c.headers["X-Rosa"] = "1"
        assert (await c.post(url, json={**cuerpo, "secuencia": 2})).json()["estado"] == "esperando_hallazgos"
        assert (await c.post(url, json={**cuerpo, "activo": False, "secuencia": 1})).json()["estado"] == "esperando_hallazgos"
        for invalida in (None, True, False, -1, 1.5, "3", [], {}, 9_007_199_254_740_992):
            r = await c.post(url, json={**cuerpo, "secuencia": invalida})
            assert r.status_code == 400, invalida
        assert (await c.post(url, json={**cuerpo, "activo": False, "secuencia": 3})).json()["estado"] == "pausada"
        # La compatibilidad antigua pertenece a otro cliente, no deshace el orden del nuevo.
        assert (await c.post(url, json={**cuerpo, "cliente": "cliente-antiguo"})).json()["estado"] == "esperando_hallazgos"
        assert (await c.post(url, json={**cuerpo, "cliente": "cliente-antiguo", "activo": False})).json()["estado"] == "pausada"
        assert not app.state.conversaciones_lab.tareas
    await app.state.conversaciones_lab.cerrar()
