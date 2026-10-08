"""Los accesos institucionales no entran al estado ni al contexto del asistente."""
import json
from unittest.mock import Mock

import pytest

from rosa import credenciales_academicas as C
from rosa.tests.test_credenciales_patentes import aislamiento, cliente as _cliente

cliente = _cliente

RUTA = "/api/academicas/configuracion"
CLAVE = "credencial-ficticia-academica"


@pytest.fixture(autouse=True)
def entorno_limpio(monkeypatch):
    for _, *variables in C.CAMPOS.values():
        for nombre in variables:
            monkeypatch.delenv(nombre, raising=False)


def test_persistencia_privada_actualizacion_parcial_y_estado_sin_secreto(tmp_path):
    base = tmp_path / "prueba.db"
    C.guardar({"valores": {"elsevier_api_key": CLAVE}}, base)
    C.guardar({"valores": {"wos_api_key": "segunda-ficticia"}}, base)
    assert C.leer(base)["elsevier_api_key"] == CLAVE
    assert C.leer(base)["wos_api_key"] == "segunda-ficticia"
    assert C.ruta(base).stat().st_mode & 0o777 == 0o600
    assert C.ruta(base).parent.stat().st_mode & 0o777 == 0o700
    assert CLAVE not in json.dumps(C.estado(base))
    assert all(not p["accesoVerificado"] for p in C.estado(base)["proveedores"])
    assert C.leer(tmp_path / "otra.db")["elsevier_api_key"] == ""


def test_desconectar_no_reactiva_clave_del_entorno(tmp_path, monkeypatch):
    monkeypatch.setenv("ELSEVIER_API_KEY", CLAVE)
    assert C.leer()["elsevier_api_key"] == CLAVE
    C.guardar({"eliminar": ["elsevier_api_key"]})
    assert C.leer()["elsevier_api_key"] == ""
    assert CLAVE not in C.ruta().read_text()


@pytest.mark.parametrize("contenido", ["NO_ECO", "[]", '{"desconocido":"NO_ECO"}', '{"elsevier_api_key":123}'])
def test_archivo_corrupto_no_habilita_entorno(contenido, monkeypatch):
    monkeypatch.setenv("ELSEVIER_API_KEY", CLAVE)
    f = C.ruta()
    f.parent.mkdir(parents=True)
    f.write_text(contenido)
    assert not any(C.leer().values())
    assert C.estado()["error"] and CLAVE not in json.dumps(C.estado())


@pytest.mark.parametrize("cambios", [
    {}, [], {"clave": CLAVE}, {"valores": []}, {"eliminar": "elsevier_api_key"},
    {"valores": {"elsevier_api_key": True}}, {"valores": {"desconocido": CLAVE}},
    {"valores": {"elsevier_api_key": "NO_ECO\ncontrol"}},
    {"valores": {"cinahl_db": "database:otra"}},
    {"valores": {"elsevier_api_key": CLAVE}, "eliminar": ["elsevier_api_key"]},
])
def test_entrada_invalida_no_modifica_credencial(cambios):
    C.guardar({"valores": {"elsevier_api_key": CLAVE}})
    with pytest.raises(ValueError) as error:
        C.guardar(cambios)
    assert "NO_ECO" not in str(error.value) and CLAVE not in str(error.value)
    assert C.leer()["elsevier_api_key"] == CLAVE


def test_rutas_reales_guardan_solo_en_archivo_privado(cliente):
    c, al, _ = cliente
    antes, version = al.instantanea_json(), al.version
    r = c.post(RUTA, json={"valores": {"elsevier_api_key": CLAVE}}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["administrador"] is True
    assert CLAVE not in r.text and r.headers["cache-control"] == "no-store"
    assert C.leer(al.ruta)["elsevier_api_key"] == CLAVE
    assert al.instantanea_json() == antes and al.version == version
    assert CLAVE not in c.get("/api/estado").text
    assert c.get(RUTA).headers["cache-control"] == "no-store"


def test_auth_csrf_y_lector_no_pueden_cambiar_accesos(cliente, monkeypatch):
    c, _, _ = cliente
    guardar = Mock(side_effect=AssertionError("No debía guardar"))
    monkeypatch.setattr(C, "guardar", guardar)
    assert c.post(RUTA, json={"valores": {"elsevier_api_key": CLAVE}}).status_code == 403
    c.cookies.set("rosa_sesion", "sesion-lector")
    assert c.get(RUTA).json()["administrador"] is False
    assert c.post(RUTA, json={"valores": {"elsevier_api_key": CLAVE}}, headers={"X-Rosa": "1"}).status_code == 403
    c.cookies.clear()
    assert c.get(RUTA).status_code == 401
    guardar.assert_not_called()


def test_error_de_disco_nunca_devuelve_la_credencial(cliente, monkeypatch):
    c, _, _ = cliente
    monkeypatch.setattr(C, "guardar", Mock(side_effect=OSError(CLAVE)))
    r = c.post(RUTA, json={"valores": {"elsevier_api_key": CLAVE}}, headers={"X-Rosa": "1"})
    assert r.status_code == 503 and CLAVE not in r.text
