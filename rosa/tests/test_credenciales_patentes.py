"""Credenciales de patentes y rutas reales con secretos ficticios, sin red."""

import asyncio
import json
import socket
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


CLAVE = "serpapi-ficticia-NO_REPETIR-123456789"
OTRA_CLAVE = "serpapi-ficticia-OTRA-987654321"
ADMIN = "admin@example.invalid"
LECTOR = "lector@example.invalid"
CONFIGURACION = "/api/patentes/configuracion"
PRUEBA = "/api/patentes/prueba"


@pytest.fixture(autouse=True)
def aislamiento(tmp_path, monkeypatch):
    # También bloquea load_dotenv si config aún no se ha importado al ejecutar
    # únicamente este archivo. No se abre la instalación ni su configuración.
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    monkeypatch.setenv("ROSA_BD", str(tmp_path / "predeterminada.db"))
    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)
    from rosa import config

    for nombre, valor in {
        "RAIZ": tmp_path,
        "RUTA_BD": tmp_path / "predeterminada.db",
        "FRONTEND_DIST": tmp_path / "dist-inexistente",
        "DIR_PDFS": tmp_path / "pdfs",
        "CLAVE_SERPAPI": "",
        "ROSA_TOKEN": "",
        "ROSA_LOGIN_EMAIL": "",
        "ROSA_LOGIN_PASSWORD_HASH": "",
        "CONVEX_URL": "",
        "CONVEX_DEPLOY_KEY": "",
        "HOST": "127.0.0.1",
        "HOSTS_PERMITIDOS": (),
    }.items():
        monkeypatch.setattr(config, nombre, valor)

    def sin_red(*args, **kwargs):
        raise AssertionError("Estas pruebas no pueden abrir conexiones de red")

    monkeypatch.setattr(socket.socket, "connect", sin_red)
    monkeypatch.setattr(socket, "create_connection", sin_red)


@pytest.fixture
def cliente(tmp_path):
    from fastapi.testclient import TestClient

    from rosa.estado.almacen import Almacen
    from rosa.servidor import crear_app

    al = Almacen(tmp_path / "activa.db")
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(
        usuario=lambda token: {"sesion-admin": ADMIN, "sesion-lector": LECTOR}.get(token),
        es_admin=lambda correo: correo == ADMIN,
    )
    app.state.correo = SimpleNamespace(preferencias=lambda correo: al.instantanea()["avisos"])
    c = TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-admin"})
    # Sin lifespan: no se inicia el bucle de correo ni trabajos de fondo.
    try:
        yield c, al, app
    finally:
        c.close()
        al.cerrar()


def test_guardar_aplica_permisos_y_solo_expone_estado_publico(tmp_path):
    from rosa import credenciales_patentes as credenciales

    base = tmp_path / "principal.db"
    estado = credenciales.guardar({"clave": f"  {CLAVE}  "}, base)
    archivo = credenciales.ruta(base)
    assert archivo.stat().st_mode & 0o777 == 0o600
    assert archivo.parent.stat().st_mode & 0o777 == 0o700
    assert estado == {"proveedor": "serpapi", "configurada": True, "origen": "archivo"}
    assert credenciales.clave(base) == CLAVE
    assert CLAVE not in json.dumps(estado)
    assert list(archivo.parent.glob(".patentes-*")) == []
    # Una sustitución atómica mantiene permisos aunque el fichero previo no los tuviera.
    archivo.chmod(0o644)
    archivo.parent.chmod(0o755)
    credenciales.guardar({"clave": OTRA_CLAVE}, base)
    assert archivo.stat().st_mode & 0o777 == 0o600
    assert archivo.parent.stat().st_mode & 0o777 == 0o700


def test_ruta_predeterminada_y_bases_distintas_no_comparten_la_clave(tmp_path):
    from rosa import config, credenciales_patentes as credenciales

    otra = tmp_path / "otra.db"
    credenciales.guardar({"clave": CLAVE})
    credenciales.guardar({"clave": OTRA_CLAVE}, otra)
    assert credenciales.ruta() == config.RUTA_BD.parent / "datos" / "_credenciales_patentes" / "predeterminada.db.json"
    assert credenciales.clave() == CLAVE
    assert credenciales.clave(otra) == OTRA_CLAVE


def test_desconectar_suprime_fallback_del_entorno_hasta_guardar_otra_clave(tmp_path, monkeypatch):
    from rosa import config, credenciales_patentes as credenciales

    monkeypatch.setattr(config, "CLAVE_SERPAPI", OTRA_CLAVE)
    base = tmp_path / "principal.db"
    assert credenciales.estado(base)["origen"] == "entorno"
    credenciales.guardar({"clave": CLAVE}, base)
    estado = credenciales.guardar({"borrarClave": True}, base)
    assert estado == {"proveedor": "serpapi", "configurada": False, "origen": None}
    assert credenciales.clave(base) == ""
    assert CLAVE not in credenciales.ruta(base).read_text()
    assert OTRA_CLAVE not in json.dumps(estado)
    assert credenciales.estado(base) == estado
    credenciales.guardar({"clave": CLAVE}, base)
    assert credenciales.clave(base) == CLAVE


@pytest.mark.parametrize("contenido", ["{NO_REPETIR", "[]", "null", '{"clave": 123}', '{"desactivada": "no"}'])
def test_archivo_corrupto_no_habilita_entorno_ni_expone_contenido(tmp_path, monkeypatch, contenido):
    from rosa import config, credenciales_patentes as credenciales

    monkeypatch.setattr(config, "CLAVE_SERPAPI", OTRA_CLAVE)
    base = tmp_path / "principal.db"
    archivo = credenciales.ruta(base)
    archivo.parent.mkdir(parents=True)
    archivo.write_text(contenido)
    assert credenciales.clave(base) == ""
    estado = credenciales.estado(base)
    assert estado["configurada"] is False and estado["origen"] is None
    assert "NO_REPETIR" not in json.dumps(estado)
    assert OTRA_CLAVE not in json.dumps(estado)


@pytest.mark.parametrize("cambios", [
    None, [], "NO_REPETIR", {}, {"clave": "NO_REPETIR"}, {"clave": True},
    {"clave": "NO_REPETIR" * 40}, {"clave": "NO_REPETIR espacio interior"},
    {"clave": "NO_REPETIR\ncontrol-interior"}, {"clave": {"NO_REPETIR": 1}},
    {"url": "https://NO_REPETIR.invalid", "clave": CLAVE},
    {"borrarClave": "NO_REPETIR"}, {"borrarClave": True, "clave": CLAVE},
])
def test_entrada_invalida_no_cambia_clave_ni_la_repite_en_errores(tmp_path, cambios):
    from rosa import credenciales_patentes as credenciales

    base = tmp_path / "principal.db"
    credenciales.guardar({"clave": OTRA_CLAVE}, base)
    with pytest.raises(ValueError) as error:
        credenciales.guardar(cambios, base)
    assert "NO_REPETIR" not in str(error.value)
    assert credenciales.clave(base) == OTRA_CLAVE


def test_get_exige_sesion_y_token_y_publica_solo_estado_no_store(cliente, monkeypatch):
    from rosa import config, credenciales_patentes as credenciales

    c, al, _ = cliente
    credenciales.guardar({"clave": CLAVE}, al.ruta)
    c.cookies.clear()
    assert c.get(CONFIGURACION).status_code == 401
    c.cookies.set("rosa_sesion", "sesion-lector")
    monkeypatch.setattr(config, "ROSA_TOKEN", "token-red-ficticio")
    assert c.get(CONFIGURACION).status_code == 401
    r = c.get(CONFIGURACION, headers={"X-Rosa-Token": "token-red-ficticio"})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert r.json() == {"proveedor": "serpapi", "configurada": True, "origen": "archivo", "administrador": False}
    assert CLAVE not in r.text


@pytest.mark.parametrize("ruta", [CONFIGURACION, PRUEBA])
@pytest.mark.parametrize("sesion,cabecera,codigo", [
    (None, True, 401), ("sesion-admin", False, 403), ("sesion-lector", True, 403),
])
def test_post_exige_sesion_admin_y_cabecera_sin_efectos(cliente, monkeypatch, ruta, sesion, cabecera, codigo):
    from rosa import credenciales_patentes as credenciales
    from rosa.fuentes import google_patents

    c, al, _ = cliente
    prueba = AsyncMock()
    monkeypatch.setattr(google_patents, "probar_conexion", prueba)
    c.cookies.clear()
    if sesion:
        c.cookies.set("rosa_sesion", sesion)
    r = c.post(ruta, json={"clave": CLAVE}, headers={"X-Rosa": "1"} if cabecera else {})
    assert r.status_code == codigo
    assert CLAVE not in r.text
    assert not credenciales.ruta(al.ruta).exists()
    prueba.assert_not_called()


def test_ruta_guarda_y_desconecta_sin_meter_secretos_en_estado(cliente, monkeypatch):
    from rosa import config, credenciales_patentes as credenciales

    c, al, _ = cliente
    monkeypatch.setattr(config, "CLAVE_SERPAPI", OTRA_CLAVE)
    antes = al.instantanea_json()
    version = al.version
    r = c.post(CONFIGURACION, json={"clave": CLAVE}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["administrador"] is True
    assert r.headers["cache-control"] == "no-store"
    assert CLAVE not in r.text
    assert credenciales.clave(al.ruta) == CLAVE
    assert al.instantanea_json() == antes and al.version == version
    estado = c.get("/api/estado")
    assert estado.status_code == 200 and CLAVE not in estado.text
    r = c.post(CONFIGURACION, json={"borrarClave": True}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["configurada"] is False
    assert r.json()["origen"] is None and r.headers["cache-control"] == "no-store"
    assert credenciales.clave(al.ruta) == ""
    assert al.instantanea_json() == antes and al.version == version


def test_ruta_rechaza_clave_invalida_sin_eco(cliente):
    c, _, _ = cliente
    r = c.post(CONFIGURACION, json={"clave": "NO_REPETIR\nclave-invalida"}, headers={"X-Rosa": "1"})
    assert r.status_code == 400
    assert "NO_REPETIR" not in r.text
    assert r.headers["cache-control"] == "no-store"


def test_error_de_disco_no_repite_datos_privados(cliente, monkeypatch):
    from rosa import credenciales_patentes as credenciales

    c, _, _ = cliente

    def fallar(*args, **kwargs):
        raise OSError(f"No se puede escribir /privado/{CLAVE}")

    monkeypatch.setattr(credenciales, "guardar", fallar)
    r = c.post(CONFIGURACION, json={"clave": CLAVE}, headers={"X-Rosa": "1"})
    assert r.status_code == 503 and CLAVE not in r.text and "/privado" not in r.text


def test_prueba_usa_credencial_de_la_base_activa_y_devuelve_procedencia(cliente, monkeypatch):
    from rosa import credenciales_patentes as credenciales
    from rosa.fuentes import google_patents

    c, al, _ = cliente
    credenciales.guardar({"clave": OTRA_CLAVE})
    credenciales.guardar({"clave": CLAVE}, al.ruta)
    procedencia = {"consulta": "Alzheimer", "fecha": "2026-10-08T12:00:00+00:00"}
    prueba = AsyncMock(return_value={"ok": True, "detalle": "Consulta de prueba comprobada.", "consulta": procedencia})
    monkeypatch.setattr(google_patents, "probar_conexion", prueba)
    r = c.post(PRUEBA, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"] is True
    prueba.assert_awaited_once_with(credencial=CLAVE)
    assert r.json()["consulta"] == procedencia
    assert r.headers["cache-control"] == "no-store"
    assert CLAVE not in r.text and OTRA_CLAVE not in r.text


def test_sin_clave_no_llama_api_ni_afirma_ausencia_de_patentes(cliente, monkeypatch):
    from rosa.fuentes import google_patents

    c, _, _ = cliente
    prueba = AsyncMock()
    monkeypatch.setattr(google_patents, "probar_conexion", prueba)
    r = c.post(PRUEBA, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"] is False
    assert "Falta" in r.json()["detalle"]
    assert "sin patentes" not in r.text.lower()
    assert r.headers["cache-control"] == "no-store"
    prueba.assert_not_called()


def test_timeout_no_filtra_clave_ni_confirma_acceso(cliente, monkeypatch):
    from rosa import credenciales_patentes as credenciales
    from rosa.fuentes import google_patents

    c, al, _ = cliente
    credenciales.guardar({"clave": CLAVE}, al.ruta)
    prueba = AsyncMock(side_effect=TimeoutError(f"https://proveedor.invalid/?api_key={CLAVE}"))
    monkeypatch.setattr(google_patents, "probar_conexion", prueba)
    r = c.post(PRUEBA, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"] is False
    assert "no pude comprobar" in r.json()["detalle"]
    assert CLAVE not in r.text and "api_key" not in r.text
    assert r.headers["cache-control"] == "no-store"


def test_prueba_tiene_limite_y_cancela_una_consulta_bloqueada(cliente, monkeypatch):
    from rosa import credenciales_patentes as credenciales, servidor
    from rosa.fuentes import google_patents

    c, al, _ = cliente
    credenciales.guardar({"clave": CLAVE}, al.ruta)
    cancelada = []
    limites = []
    esperar_real = asyncio.wait_for

    async def bloqueada(*, credencial):
        assert credencial == CLAVE
        try:
            await asyncio.Event().wait()
        finally:
            cancelada.append(True)

    async def esperar_breve(consulta, timeout):
        limites.append(timeout)
        return await esperar_real(consulta, timeout=0.001)

    monkeypatch.setattr(google_patents, "probar_conexion", bloqueada)
    monkeypatch.setattr(servidor, "asyncio", SimpleNamespace(wait_for=esperar_breve))
    r = c.post(PRUEBA, headers={"X-Rosa": "1"})
    assert limites == [32] and cancelada == [True]
    assert r.status_code == 200 and r.json()["ok"] is False
    assert "no pude comprobar" in r.json()["detalle"]


def test_asistente_solo_puede_leer_estado_sin_credenciales(cliente):
    from rosa import credenciales_patentes as credenciales
    from rosa.asistente_servicios import Servicios

    _, al, app = cliente
    credenciales.guardar({"clave": CLAVE}, al.ruta)
    request = SimpleNamespace(headers={"cookie": "rosa_sesion=sesion-lector"})
    servicio = Servicios(app, request, administrador=False)
    catalogo = servicio.catalogo()
    assert "estado_google_patents" in catalogo["lecturas"]
    assert not any("patente" in nombre for nombre in catalogo["accionesConConfirmacion"])
    salida = asyncio.run(servicio.consultar("estado_google_patents", {}))
    assert "configurada" in salida and "serpapi" in salida
    assert CLAVE not in salida
