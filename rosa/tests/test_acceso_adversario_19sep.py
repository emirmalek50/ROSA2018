"""Adversario del bloque de acceso del 19 de septiembre de 2026 (correo y
contraseña; puerta sin verificar cerrada con 410; intentos fallidos que cuentan
para el tope).

Un test guarda el arreglo del constructor (pasa hoy); los demás demuestran
defectos que siguen abiertos y FALLAN hoy a propósito, para que la fase de
reparación los deje en verde:

- D1: sin ROSA_ADMIN administra "la primera cuenta verificada", que puede ser
  una confirmada por enlace antes del 18 de septiembre; esa cuenta ya no puede
  entrar (solo entra ROSA_LOGIN_EMAIL) y la que sí entra no administra. Nadie
  que pueda entrar administra.
- D2: con ROSA_LOGIN_EMAIL o ROSA_LOGIN_PASSWORD_HASH mal puestos (huella de 63
  caracteres, no hexadecimal, correo vacío o fuera del dominio) cada intento
  contesta "Correo o contraseña incorrectos" y consume intentos del tope, sin
  ninguna señal de que el servidor no tiene credenciales válidas. Con un correo
  no ASCII en .env la comparación revienta con TypeError y el servidor da 500.
- D4: el acierto también gasta intentos: dos erratas y dos entradas en 15
  minutos bloquean a la persona legítima con "Demasiados intentos".

Sin red ni modelos.
"""
import pytest
from fastapi.testclient import TestClient

from rosa import acceso as modulo_acceso
from rosa import config
from rosa.acceso import Acceso, _huella_contrasena
from rosa.correo import Correo
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app

EMAIL = 'persona@alzheimerproject.com'
COLEGA = 'colega@alzheimerproject.com'
CLAVE = 'contraseña del adversario con ñ'
X_ROSA = {'X-Rosa': '1'}


@pytest.fixture
def credenciales(monkeypatch):
    """Cuenta y huella como las leería el servidor de .env, con la misma scrypt.
    ROSA_ADMIN se quita del entorno porque load_dotenv() carga el .env real."""
    monkeypatch.setattr(config, 'ROSA_LOGIN_EMAIL', EMAIL)
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', _huella_contrasena(CLAVE))
    monkeypatch.delenv('ROSA_ADMIN', raising=False)
    monkeypatch.delattr(config, 'ROSA_ADMIN', raising=False)


@pytest.fixture
def acceso(tmp_path, credenciales):
    al = Almacen(tmp_path / 'rosa.db')
    c = Correo(al)
    yield Acceso(c), c
    c.cerrar()
    al.cerrar()


@pytest.fixture
def web(tmp_path, monkeypatch, credenciales):
    monkeypatch.setattr(config, 'RAIZ', tmp_path)
    monkeypatch.setattr(config, 'HOST', '127.0.0.1')
    monkeypatch.setattr(config, 'ROSA_TOKEN', '')

    async def sin_red(self):
        import asyncio
        await asyncio.Event().wait()

    monkeypatch.setattr(Correo, 'correr', sin_red)
    al = Almacen(tmp_path / 'web.db')
    app = crear_app(al)
    with TestClient(app, base_url='http://localhost', client=('10.0.0.7', 12345)) as cliente:
        yield cliente, app
    al.cerrar()


def intentos(a, correo=EMAIL):
    return a.db.execute('SELECT COUNT(*) FROM limites_acceso WHERE correo=?', (correo,)).fetchone()[0]


def entrar(cliente, correo=EMAIL, contrasena=CLAVE):
    return cliente.post('/api/acceso/entrar', json={'correo': correo, 'contrasena': contrasena}, headers=X_ROSA)


# ---------------------------------------------------------------------------
# Guardián del arreglo del constructor (pasa hoy)
# ---------------------------------------------------------------------------

def test_el_intento_queda_registrado_aunque_la_comparacion_reviente(acceso, monkeypatch):
    """La propiedad que arregló el constructor: el intento se confirma en su
    propia transacción antes de comparar. Si la comparación explota por lo que
    sea (aquí un error inesperado en scrypt), el intento ya está contado y no
    hay rollback que lo borre."""
    a, _ = acceso

    def revienta(_contrasena):
        raise RuntimeError('scrypt caído')

    monkeypatch.setattr(modulo_acceso, '_huella_contrasena', revienta)
    with pytest.raises(RuntimeError):
        a.entrar_con_contrasena(EMAIL, CLAVE, '10.0.0.7')
    assert intentos(a) == 1
    assert a.db.execute('SELECT COUNT(*) FROM sesiones').fetchone()[0] == 0


# ---------------------------------------------------------------------------
# D1: sin ROSA_ADMIN, nadie que pueda entrar administra (FALLA HOY)
# ---------------------------------------------------------------------------

def test_sin_rosa_admin_administra_quien_puede_entrar_no_una_cuenta_de_enlace_anterior(acceso):
    """Instalación que existía antes del 18 de septiembre: una colega confirmó
    un enlace (verificada más antigua) y ahora solo entra ROSA_LOGIN_EMAIL. La
    regla "primera verificada" hace administradora a la colega, que ya no tiene
    forma de entrar, y la cuenta que sí entra recibe 403 en correo, GEPA y
    políticas. Sin ROSA_ADMIN, debe administrar la cuenta configurada (la única
    que puede entrar)."""
    a, _ = acceso
    with a.db:
        a.db.execute('INSERT INTO cuentas(correo, creada, verificada) VALUES (?, 100, 200)', (COLEGA,))
    token, _ = a.entrar_con_contrasena(EMAIL, CLAVE, '10.0.0.7')
    assert a.usuario(token) == EMAIL
    assert a.es_admin(EMAIL), 'la única cuenta que puede entrar no administra'
    assert not a.es_admin(COLEGA), 'administra una cuenta que ya no puede entrar'


# ---------------------------------------------------------------------------
# D2 y D7: credenciales mal configuradas sin señal (FALLA HOY)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('correo_configurado,huella_configurada', [
    (EMAIL, 'f' * 63),                      # se perdió un carácter al pegar la huella
    (EMAIL, 'zz' * 32),                     # no es hexadecimal
    ('', _huella_contrasena(CLAVE)),        # falta ROSA_LOGIN_EMAIL
    ('persona@gmail.com', _huella_contrasena(CLAVE)),   # fuera del dominio: nunca podrá coincidir
    ('josé@alzheimerproject.com', _huella_contrasena(CLAVE)),  # no ASCII: compare_digest lanza TypeError
])
def test_credenciales_mal_configuradas_no_se_disfrazan_de_contrasena_erronea(web, monkeypatch, correo_configurado, huella_configurada):
    """Con un .env roto, quien opera ROSA2018 ve "Correo o contraseña
    incorrectos" (falso: no hay credencial con la que comparar) y a la tercera
    "Demasiados intentos"; ni el arranque ni /api/acceso/estado avisan. Y con
    un correo no ASCII el servidor contesta 500. La respuesta debe decir que el
    acceso con contraseña no está configurado (no revela cuentas) y nunca 500."""
    cliente, _ = web
    monkeypatch.setattr(config, 'ROSA_LOGIN_EMAIL', correo_configurado)
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', huella_configurada)
    r = entrar(cliente, 'jose@alzheimerproject.com' if 'josé' in correo_configurado else EMAIL)
    assert r.status_code != 500, r.text
    assert 'set-cookie' not in r.headers
    detalle = r.json()['detail']
    assert detalle != 'Correo o contraseña incorrectos', detalle
    assert 'configur' in detalle.lower(), detalle


# ---------------------------------------------------------------------------
# D4: acertar gasta intentos y bloquea a la persona legítima (FALLA HOY)
# ---------------------------------------------------------------------------

def test_acertar_no_gasta_los_intentos_y_no_bloquea_a_quien_ya_entro(web):
    """Dos erratas, entra, cierra sesión para cambiar de equipo y vuelve a
    entrar en menos de 15 minutos: hoy recibe "Demasiados intentos" con la
    contraseña buena. El tope debe frenar fallos, no aciertos: al acertar se
    borran los intentos del correo (o no se cuenta el acierto)."""
    cliente, _ = web
    for _ in range(2):
        assert entrar(cliente, contrasena='errata').status_code == 401
    assert entrar(cliente).status_code == 200
    assert cliente.post('/api/acceso/salir', json={}, headers=X_ROSA).status_code == 200
    r = entrar(cliente)
    assert r.status_code == 200, r.json()
    assert cliente.get('/api/estado').status_code == 200
