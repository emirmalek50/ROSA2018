"""El registro de las cuentas del equipo (25 de septiembre de 2026, a petición de
Emir): cualquier correo @alzheimerproject.com se registra con su contraseña y queda
pendiente hasta que la cuenta administradora lo aprueba.

Lo que se intenta romper: entrar sin aprobación, registrarse con otro dominio,
pisar la solicitud de otra persona, que una cuenta del equipo apruebe a otras, que
el estado de una cuenta se filtre a quien no sabe su contraseña, y que el registro
sirva para probar correos en bucle. La entrada sin verificar se cerró el 18 de
septiembre precisamente porque dejaba entrar con el correo de otra persona."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa import acceso as ACC
from rosa.acceso import Acceso
from rosa.correo import Correo
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app

ADMIN = "admin@alzheimerproject.com"
CLAVE_ADMIN = "clave de la administradora"
MEDICA = "medica@alzheimerproject.com"
CLAVE = "una clave larga de la médica"
SAL = b"rosa-acceso-contrasena-v1"
X = {"X-Rosa": "1"}


def _huella_admin() -> str:
    return hashlib.scrypt(CLAVE_ADMIN.encode(), salt=SAL, n=2**14, r=8, p=1, dklen=32).hex()


def _sin_admin_fijado(monkeypatch):
    """El .env real puede fijar ROSA_ADMIN: aquí administra la cuenta del test."""
    monkeypatch.setattr(config, "ROSA_ADMIN", "", raising=False)
    monkeypatch.delenv("ROSA_ADMIN", raising=False)


@pytest.fixture
def acceso(tmp_path, monkeypatch):
    _sin_admin_fijado(monkeypatch)
    monkeypatch.setattr(config, "ROSA_LOGIN_EMAIL", ADMIN)
    monkeypatch.setattr(config, "ROSA_LOGIN_PASSWORD_HASH", _huella_admin())
    almacen = Almacen(tmp_path / "rosa.db")
    correo = Correo(almacen)
    yield Acceso(correo)
    correo.cerrar()
    almacen.cerrar()


# -- La clase ---------------------------------------------------------------------


def test_una_cuenta_registrada_no_entra_hasta_que_la_aprueban(acceso):
    assert acceso.registrar(MEDICA, CLAVE, "10.0.0.1") == "pendiente"
    with pytest.raises(ValueError, match="pendiente de aprobación"):
        acceso.entrar_con_contrasena(MEDICA, CLAVE, "10.0.0.1")
    acceso.decidir_cuenta(MEDICA, "activa", ADMIN)
    token, correo = acceso.entrar_con_contrasena(MEDICA.upper(), CLAVE, "10.0.0.1")
    assert correo == MEDICA and acceso.usuario(token) == MEDICA


def test_solo_el_dominio_del_proyecto(acceso):
    for fuera in ("medica@gmail.com", "medica@alzheimerproject.com.evil.com", "medica@sub.alzheimerproject.com", "sin-arroba"):
        with pytest.raises(ValueError):
            acceso.registrar(fuera, CLAVE)


def test_la_contrasena_del_equipo_tiene_un_minimo(acceso):
    with pytest.raises(ValueError, match="al menos 10"):
        acceso.registrar(MEDICA, "corta")


def test_no_se_puede_pisar_una_solicitud_pendiente_con_otra_contrasena(acceso):
    """Si se pudiera, el último en llegar decidiría la contraseña de una cuenta que
    otra persona pidió, y la administradora aprobaría al impostor."""
    acceso.registrar(MEDICA, CLAVE, "10.0.0.1")
    with pytest.raises(ValueError, match="solicitud pendiente"):
        acceso.registrar(MEDICA, "la clave del impostor", "10.0.0.2")
    acceso.decidir_cuenta(MEDICA, "activa", ADMIN)
    with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
        acceso.entrar_con_contrasena(MEDICA, "la clave del impostor")
    assert acceso.entrar_con_contrasena(MEDICA, CLAVE)[1] == MEDICA


def test_la_cuenta_administradora_no_se_registra_desde_la_pantalla(acceso):
    with pytest.raises(ValueError, match="ya existe"):
        acceso.registrar(ADMIN, "otra clave cualquiera larga")
    # Y sigue entrando con la huella de .env, como siempre.
    assert acceso.entrar_con_contrasena(ADMIN, CLAVE_ADMIN)[1] == ADMIN


def test_una_cuenta_del_equipo_aprobada_no_administra(acceso):
    acceso.registrar(MEDICA, CLAVE)
    acceso.decidir_cuenta(MEDICA, "activa", ADMIN)
    assert acceso.es_admin(ADMIN) is True
    assert acceso.es_admin(MEDICA) is False


def test_el_estado_solo_se_revela_a_quien_acierta_la_contrasena(acceso):
    """A quien no sabe la contraseña, una cuenta pendiente se ve igual que un correo
    sin cuenta: si no, la pantalla serviría para averiguar quién pidió acceso."""
    acceso.registrar(MEDICA, CLAVE)
    with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
        acceso.entrar_con_contrasena(MEDICA, "no es su clave")
    with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
        acceso.entrar_con_contrasena("nadie@alzheimerproject.com", "no es su clave")


def test_rechazar_una_cuenta_activa_la_saca_y_cierra_sus_sesiones(acceso):
    acceso.registrar(MEDICA, CLAVE)
    acceso.decidir_cuenta(MEDICA, "activa", ADMIN)
    token, _ = acceso.entrar_con_contrasena(MEDICA, CLAVE)
    acceso.decidir_cuenta(MEDICA, "rechazada", ADMIN)
    assert acceso.usuario(token) is None, "la sesión abierta se cierra al rechazar"
    with pytest.raises(ValueError, match="rechazada"):
        acceso.entrar_con_contrasena(MEDICA, CLAVE)
    with pytest.raises(ValueError, match="rechazada"):
        acceso.registrar(MEDICA, "vuelvo a pedirla con otra clave")


def test_el_registro_no_sirve_para_probar_correos_en_bucle(acceso):
    """El mismo tope que al entrar: 3 intentos por correo en 15 minutos. Los que
    cuentan son los que fallan; registrarse bien pone el recuento a cero."""
    acceso.registrar(MEDICA, CLAVE, "10.0.0.9")
    for i in range(3):
        with pytest.raises(ValueError, match="solicitud pendiente"):
            acceso.registrar(MEDICA, CLAVE + str(i), "10.0.0.9")
    with pytest.raises(ValueError, match="Demasiados intentos"):
        acceso.registrar(MEDICA, CLAVE, "10.0.0.9")


def test_registrarse_bien_no_gasta_intentos_de_entrada(acceso):
    """Quien se registra, lo aprueban y se equivoca una vez al teclear, entra al
    segundo intento."""
    acceso.registrar(MEDICA, CLAVE, "10.0.0.3")
    acceso.decidir_cuenta(MEDICA, "activa", ADMIN)
    with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
        acceso.entrar_con_contrasena(MEDICA, "me equivoqué al teclear", "10.0.0.3")
    assert acceso.entrar_con_contrasena(MEDICA, CLAVE, "10.0.0.3")[1] == MEDICA


def test_la_huella_del_equipo_lleva_sal_propia(acceso):
    """Dos personas con la misma contraseña no tienen la misma huella."""
    a, b = ACC.huella_equipo(CLAVE), ACC.huella_equipo(CLAVE)
    assert a != b and a.startswith("scrypt$") and ACC._coincide_equipo(CLAVE, a) and not ACC._coincide_equipo("otra", a)
    assert ACC._coincide_equipo(CLAVE, "basura") is False


def test_la_lista_de_solicitudes_nunca_lleva_la_huella(acceso):
    acceso.registrar(MEDICA, CLAVE)
    filas = acceso.solicitudes()
    assert filas and filas[0]["correo"] == MEDICA and filas[0]["estado"] == "pendiente"
    assert "contrasena" not in filas[0] and "scrypt" not in str(filas)


# -- El servidor ------------------------------------------------------------------


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    _sin_admin_fijado(monkeypatch)
    monkeypatch.setattr(config, "RAIZ", tmp_path)
    monkeypatch.setattr(config, "ROSA_LOGIN_EMAIL", ADMIN)
    monkeypatch.setattr(config, "ROSA_LOGIN_PASSWORD_HASH", _huella_admin())
    monkeypatch.setattr(config, "ROSA_TOKEN", "")

    async def sin_red(self):
        import asyncio

        await asyncio.Event().wait()

    monkeypatch.setattr(Correo, "correr", sin_red)
    almacen = Almacen(tmp_path / "web.db")
    with TestClient(crear_app(almacen), base_url="http://localhost") as c:
        yield c


def test_de_punta_a_punta_registro_aprobacion_y_entrada(cliente):
    r = cliente.post("/api/acceso/registrar", json={"correo": MEDICA, "contrasena": CLAVE}, headers=X)
    assert r.status_code == 200 and r.json()["estado"] == "pendiente"
    # Pendiente: no entra, y lo dice.
    r = cliente.post("/api/acceso/entrar", json={"correo": MEDICA, "contrasena": CLAVE}, headers=X)
    assert r.status_code == 401 and "pendiente" in r.json()["detail"]
    # La administradora entra, ve la solicitud y la aprueba.
    assert cliente.post("/api/acceso/entrar", json={"correo": ADMIN, "contrasena": CLAVE_ADMIN}, headers=X).status_code == 200
    estado = cliente.get("/api/acceso/estado").json()
    assert estado["administrador"] is True and estado["solicitudesPendientes"] == 1
    cuentas = cliente.get("/api/acceso/solicitudes", headers=X).json()["cuentas"]
    assert [c["correo"] for c in cuentas] == [MEDICA]
    r = cliente.post("/api/acceso/decidir", json={"correo": MEDICA, "estado": "activa"}, headers=X)
    assert r.status_code == 200 and r.json()["cuentas"][0]["aprobadaPor"] == ADMIN
    cliente.post("/api/acceso/salir", json={}, headers=X)
    # Ahora la médica entra.
    assert cliente.post("/api/acceso/entrar", json={"correo": MEDICA, "contrasena": CLAVE}, headers=X).status_code == 200
    assert cliente.get("/api/acceso/estado").json()["correo"] == MEDICA


def test_una_cuenta_del_equipo_no_puede_ver_ni_aprobar_solicitudes(cliente):
    cliente.post("/api/acceso/registrar", json={"correo": MEDICA, "contrasena": CLAVE}, headers=X)
    cliente.post("/api/acceso/registrar", json={"correo": "otra@alzheimerproject.com", "contrasena": CLAVE}, headers=X)
    cliente.post("/api/acceso/entrar", json={"correo": ADMIN, "contrasena": CLAVE_ADMIN}, headers=X)
    cliente.post("/api/acceso/decidir", json={"correo": MEDICA, "estado": "activa"}, headers=X)
    cliente.post("/api/acceso/salir", json={}, headers=X)
    cliente.post("/api/acceso/entrar", json={"correo": MEDICA, "contrasena": CLAVE}, headers=X)
    assert cliente.get("/api/acceso/solicitudes", headers=X).status_code == 403
    assert cliente.post("/api/acceso/decidir", json={"correo": "otra@alzheimerproject.com", "estado": "activa"}, headers=X).status_code == 403
    assert cliente.get("/api/acceso/estado").json()["solicitudesPendientes"] == 0, "a quien no administra no se le dice cuántas hay"


def test_sin_sesion_no_se_ven_las_solicitudes(cliente):
    assert cliente.get("/api/acceso/solicitudes", headers=X).status_code == 401
    assert cliente.post("/api/acceso/decidir", json={"correo": MEDICA, "estado": "activa"}, headers=X).status_code == 401


def test_el_registro_rechaza_otro_dominio_por_el_servidor(cliente):
    r = cliente.post("/api/acceso/registrar", json={"correo": "medica@gmail.com", "contrasena": CLAVE}, headers=X)
    assert r.status_code == 400 and "alzheimerproject.com" in r.json()["detail"]
