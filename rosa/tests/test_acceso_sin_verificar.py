"""La puerta sin verificación (abierta el 15 de septiembre de 2026 mientras no
había correo) quedó cerrada el 18 al llegar el acceso con correo y contraseña.
Estas pruebas fijan que no vuelve a abrirse: no crea cuentas ni sesiones, el
servidor contesta 410 con la explicación de cómo entrar, y la única entrada es
la cuenta de ROSA_LOGIN_EMAIL con la huella de ROSA_LOGIN_PASSWORD_HASH. Del 19
de septiembre: sin credenciales válidas en .env se dice que el acceso no está
configurado (no "contraseña incorrecta") y no se gastan intentos; acertar borra
los intentos del correo; sin ROSA_ADMIN administra la cuenta configurada, no
una que confirmó un enlace antes; y `python -m rosa.acceso --huella` genera la
huella sin mostrar la contraseña. Sin red ni modelos."""
import io

import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa.acceso import (
    MENSAJE_PUERTA_CERRADA,
    MENSAJE_SIN_CONFIGURAR,
    Acceso,
    _huella_contrasena,
    _principal,
    diagnostico_credenciales,
)
from rosa.correo import Correo
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app

EMAIL = 'persona@alzheimerproject.com'
OTRO = 'equipo@alzheimerproject.com'
CLAVE = 'una contraseña de prueba con ñ'
CONFIG = {'remitente': 'rosa@alzheimerproject.com', 'clave': 'clave-de-prueba', 'url': 'http://localhost:5174'}
X_ROSA = {'X-Rosa': '1'}


@pytest.fixture
def credenciales(monkeypatch):
    """La cuenta y la huella que el servidor leería de .env, generada con la
    misma función scrypt que usa `entrar_con_contrasena` al comparar."""
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
    # Cliente remoto (10.0.0.7): la puerta cerrada y la contraseña valen igual desde cualquier equipo.
    with TestClient(app, base_url='http://localhost', client=('10.0.0.7', 12345)) as cliente:
        yield cliente, app, al
    al.cerrar()


def filas(c, tabla):
    return c.db.execute(f'SELECT COUNT(*) FROM {tabla}').fetchone()[0]


def intentos(c, correo=EMAIL):
    return c.db.execute('SELECT COUNT(*) FROM limites_acceso WHERE correo=?', (correo,)).fetchone()[0]


def entrar(cliente, correo=EMAIL, contrasena=CLAVE):
    return cliente.post('/api/acceso/entrar', json={'correo': correo, 'contrasena': contrasena}, headers=X_ROSA)


def test_el_mensaje_de_la_puerta_cerrada_dice_que_ya_no_existe_y_como_entrar():
    assert 'ya no existe' in MENSAJE_PUERTA_CERRADA
    assert 'correo' in MENSAJE_PUERTA_CERRADA and 'contraseña' in MENSAJE_PUERTA_CERRADA
    # Solo entra la cuenta que reparte quien administra: el mensaje no promete
    # entrada a cualquier cuenta del dominio ("tu correo corporativo").
    assert 'quien administra' in MENSAJE_PUERTA_CERRADA and 'tu correo corporativo' not in MENSAJE_PUERTA_CERRADA
    assert 'desactivada' in MENSAJE_PUERTA_CERRADA  # lo busca test_acceso_contrasena.py
    assert '\u2014' not in MENSAJE_PUERTA_CERRADA and '\u2014' not in MENSAJE_SIN_CONFIGURAR  # sin guiones largos


def test_la_puerta_cerrada_no_crea_cuenta_ni_sesion_haya_o_no_correo(acceso):
    a, c = acceso
    for correo in (EMAIL, EMAIL.upper(), OTRO, 'alguien@gmail.com'):
        with pytest.raises(ValueError) as ex:
            a.entrar_sin_verificar(correo, '10.0.0.7')
        assert str(ex.value) == MENSAJE_PUERTA_CERRADA
    c.configurar(CONFIG)
    with pytest.raises(ValueError, match='ya no existe'):
        a.entrar_sin_verificar(EMAIL)
    # Ni cuenta, ni sesión, ni intento consumido: la puerta cerrada no toca la base.
    assert filas(c, 'cuentas') == 0 and filas(c, 'sesiones') == 0 and filas(c, 'limites_acceso') == 0


@pytest.mark.parametrize('correo_configurado,huella_configurada,intento', [
    (EMAIL, '', EMAIL),                                            # falta la huella
    (EMAIL, 'f' * 63, EMAIL),                                      # se perdió un carácter al pegar
    (EMAIL, 'zz' * 32, EMAIL),                                     # no es hexadecimal
    ('', _huella_contrasena(CLAVE), EMAIL),                        # falta el correo
    ('persona@gmail.com', _huella_contrasena(CLAVE), EMAIL),       # fuera del dominio: nunca coincidiría
    ('josé@alzheimerproject.com', _huella_contrasena(CLAVE), 'jose@alzheimerproject.com'),  # no ASCII
    ('persona @alzheimerproject.com', _huella_contrasena(CLAVE), EMAIL),  # con espacio
])
def test_sin_credenciales_validas_se_dice_que_no_esta_configurado_y_no_gasta_intentos(acceso, monkeypatch, correo_configurado, huella_configurada, intento):
    """Un .env roto no se disfraza de "Correo o contraseña incorrectos" (no hay
    con qué comparar), no consume intentos del tope y nunca revienta (un correo
    con tilde hacía que compare_digest lanzara TypeError). El diagnóstico dice
    qué variable falla sin imprimir su valor."""
    a, c = acceso
    monkeypatch.setattr(config, 'ROSA_LOGIN_EMAIL', correo_configurado)
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', huella_configurada)
    for _ in range(4):
        with pytest.raises(ValueError) as ex:
            a.entrar_con_contrasena(intento, CLAVE, '10.0.0.7')
        assert str(ex.value) == MENSAJE_SIN_CONFIGURAR
    assert filas(c, 'cuentas') == 0 and filas(c, 'sesiones') == 0 and filas(c, 'limites_acceso') == 0
    problema = diagnostico_credenciales()
    assert problema and ('ROSA_LOGIN_EMAIL' in problema or 'ROSA_LOGIN_PASSWORD_HASH' in problema)
    assert huella_configurada not in problema if huella_configurada else True
    assert correo_configurado not in problema if correo_configurado else True
    assert not a.es_admin(intento)  # sin credenciales ni ROSA_ADMIN ni cuentas verificadas, nadie administra


def test_el_diagnostico_y_el_comando_de_la_huella(credenciales):
    assert diagnostico_credenciales() == ''
    salida, errores = io.StringIO(), io.StringIO()
    assert _principal(['--comprobar'], salida=salida, errores=errores) == 0
    assert 'bien configurado' in salida.getvalue()
    # --huella pide la contraseña dos veces sin mostrarla y escribe la línea de .env
    # con la misma scrypt que compara el servidor; la contraseña no sale por ningún sitio.
    salida, errores = io.StringIO(), io.StringIO()
    assert _principal(['--huella'], pedir=lambda _p: CLAVE, salida=salida, errores=errores) == 0
    assert salida.getvalue().strip() == f'ROSA_LOGIN_PASSWORD_HASH={_huella_contrasena(CLAVE)}'
    assert CLAVE not in salida.getvalue() + errores.getvalue()
    respuestas = iter([CLAVE, CLAVE + 'x'])
    salida, errores = io.StringIO(), io.StringIO()
    assert _principal(['--huella'], pedir=lambda _p: next(respuestas), salida=salida, errores=errores) == 2
    assert salida.getvalue() == '' and 'no coinciden' in errores.getvalue()
    assert _principal([], salida=io.StringIO(), errores=io.StringIO()) == 2


def test_acertar_borra_los_intentos_del_correo_y_el_tope_frena_solo_fallos(acceso):
    a, c = acceso
    for _ in range(2):
        with pytest.raises(ValueError, match='Correo o contraseña incorrectos'):
            a.entrar_con_contrasena(EMAIL, 'errata', '10.0.0.7')
    assert intentos(c) == 2
    token, _ = a.entrar_con_contrasena(EMAIL, CLAVE, '10.0.0.7')
    assert a.usuario(token) == EMAIL and intentos(c) == 0
    # Otra vez tres fallos completos antes de que el tope caiga, y entonces sí, ni con la buena.
    for _ in range(3):
        with pytest.raises(ValueError, match='Correo o contraseña incorrectos'):
            a.entrar_con_contrasena(EMAIL, 'errata', '10.0.0.7')
    with pytest.raises(ValueError, match='Demasiados'):
        a.entrar_con_contrasena(EMAIL, CLAVE, '10.0.0.7')
    assert intentos(c) == 3 and filas(c, 'sesiones') == 1


def test_sin_rosa_admin_administra_la_cuenta_configurada_no_quien_confirmo_un_enlace_antes(acceso):
    """Instalación anterior al 18 de septiembre: una colega confirmó un enlace
    (verificada más antigua) y otra entró por la puerta antigua (verificada
    NULL). Ninguna puede entrar ya; administra la cuenta configurada. Solo si
    tampoco hay credenciales válidas manda la primera confirmada por enlace."""
    a, c = acceso
    with a.db:
        a.db.execute('INSERT INTO cuentas(correo, creada, verificada) VALUES (?, 100, 200)', (OTRO,))
        a.db.execute('INSERT INTO cuentas(correo, creada) VALUES (?, 1)', ('antigua@alzheimerproject.com',))
    assert a.es_admin(EMAIL) and a.es_admin(EMAIL.upper()) and not a.es_admin(OTRO) and not a.es_admin('antigua@alzheimerproject.com')
    a.entrar_con_contrasena(EMAIL, CLAVE, '10.0.0.7')
    assert a.es_admin(EMAIL) and not a.es_admin(OTRO)
    # Sin credenciales válidas (nadie entra) el respaldo es la primera confirmada por enlace.
    config.ROSA_LOGIN_PASSWORD_HASH = 'f' * 63
    assert a.es_admin(OTRO) and not a.es_admin(EMAIL) and not a.es_admin('antigua@alzheimerproject.com')


def test_web_la_puerta_contesta_410_sin_sesion_y_solo_entra_la_contrasena(web, monkeypatch):
    cliente, app, al = web
    assert cliente.get('/api/estado').status_code == 401
    # Sin sesión: 410 con la explicación, no un 401 que pida iniciar sesión sin decir cómo.
    r = cliente.post('/api/acceso/entrar_sin_verificar', json={'correo': EMAIL}, headers=X_ROSA)
    assert r.status_code == 410 and r.json()['detail'] == MENSAJE_PUERTA_CERRADA
    assert 'set-cookie' not in r.headers
    # Sin la cabecera X-Rosa (una web ajena) tampoco pasa: 403 como toda escritura.
    assert cliente.post('/api/acceso/entrar_sin_verificar', json={'correo': EMAIL}).status_code == 403
    assert cliente.get('/api/estado').status_code == 401
    # Contraseña errónea, otra cuenta del dominio y cuerpo incompleto: fuera, sin cookie.
    r = entrar(cliente, EMAIL, CLAVE + 'x')
    assert r.status_code == 401 and r.json()['detail'] == 'Correo o contraseña incorrectos' and 'set-cookie' not in r.headers
    assert entrar(cliente, OTRO).status_code == 401
    assert cliente.post('/api/acceso/entrar', json={'correo': EMAIL}, headers=X_ROSA).status_code == 400
    assert cliente.get('/api/estado').status_code == 401
    # La contraseña correcta entra desde cualquier equipo con una sesión normal.
    r = entrar(cliente, EMAIL.upper())
    assert r.status_code == 200 and r.json()['correo'] == EMAIL and 'HttpOnly' in r.headers['set-cookie']
    assert cliente.get('/api/estado').status_code == 200
    estado = cliente.get('/api/acceso/estado').json()
    # Sin ROSA_ADMIN administra la cuenta configurada (la única que entra); con ROSA_ADMIN
    # apuntando a otra, esta deja de administrar aunque sea la primera y la única.
    assert estado['correo'] == EMAIL and estado['administrador'] and estado['accesoConfigurado']
    monkeypatch.setenv('ROSA_ADMIN', OTRO)
    assert not cliente.get('/api/acceso/estado').json()['administrador']
    assert cliente.post('/api/correo/configuracion', json=CONFIG, headers=X_ROSA).status_code == 403
    monkeypatch.setenv('ROSA_ADMIN', EMAIL.upper())
    assert cliente.get('/api/acceso/estado').json()['administrador']
    assert cliente.post('/api/correo/configuracion', json=CONFIG, headers=X_ROSA).status_code == 200
    # Con el correo ya configurado la puerta sigue cerrada, con sesión y sin ella.
    assert cliente.post('/api/acceso/entrar_sin_verificar', json={'correo': OTRO}, headers=X_ROSA).status_code == 410
    assert cliente.post('/api/acceso/salir', json={}, headers=X_ROSA).status_code == 200
    assert cliente.post('/api/acceso/entrar_sin_verificar', json={'correo': OTRO}, headers=X_ROSA).status_code == 410
    assert cliente.get('/api/estado').status_code == 401


def test_web_tres_contrasenas_erroneas_bloquean_el_cuarto_intento_aunque_sea_la_buena(web):
    """Los intentos fallidos cuentan para el tope (3 por correo en 15 minutos):
    antes se registraban en la misma transacción que lanzaba el error y el
    rollback los borraba, así que se podían probar contraseñas sin límite."""
    cliente, app, al = web
    for _ in range(3):
        r = entrar(cliente, EMAIL, 'no es')
        assert r.status_code == 401 and r.json()['detail'] == 'Correo o contraseña incorrectos'
    r = entrar(cliente)
    assert r.status_code == 401 and 'Demasiados intentos' in r.json()['detail'] and 'set-cookie' not in r.headers
    assert cliente.get('/api/estado').status_code == 401
    # El tope es por correo: otra cuenta no queda bloqueada por los intentos contra esta.
    assert entrar(cliente, OTRO).json()['detail'] == 'Correo o contraseña incorrectos'


def test_web_dos_erratas_entrar_salir_y_volver_a_entrar_no_bloquea(web):
    """Cambiar de equipo en menos de 15 minutos tras dos erratas: el acierto
    borra los intentos, así que la segunda entrada correcta pasa."""
    cliente, app, al = web
    for _ in range(2):
        assert entrar(cliente, EMAIL, 'errata').status_code == 401
    assert entrar(cliente).status_code == 200
    assert cliente.post('/api/acceso/salir', json={}, headers=X_ROSA).status_code == 200
    for _ in range(2):
        assert entrar(cliente, EMAIL, 'errata').status_code == 401
    assert entrar(cliente).status_code == 200 and cliente.get('/api/estado').status_code == 200


def test_web_sin_credenciales_validas_la_pantalla_lo_dice_y_entrar_no_gasta_intentos(web, monkeypatch):
    cliente, app, al = web
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', 'f' * 63)
    estado = cliente.get('/api/acceso/estado').json()
    assert not estado['accesoConfigurado'] and estado['avisoInstalacion'] == MENSAJE_SIN_CONFIGURAR
    # La ruta pública no dice qué variable falla (eso sale por el arranque), solo que no está configurado.
    assert 'ROSA_LOGIN' not in cliente.get('/api/acceso/estado').text
    for _ in range(5):
        r = entrar(cliente)
        assert r.status_code == 401 and r.json()['detail'] == MENSAJE_SIN_CONFIGURAR and 'set-cookie' not in r.headers
    # Corregido .env (aquí, sin reiniciar): entra a la primera, porque no se gastó ningún intento.
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', _huella_contrasena(CLAVE))
    assert cliente.get('/api/acceso/estado').json()['accesoConfigurado']
    assert entrar(cliente).status_code == 200 and cliente.get('/api/estado').status_code == 200


def test_web_las_rutas_del_enlace_ya_no_existen(web):
    """Detrás de sesión permitían a una sesión heredada confirmarse un enlace;
    sin sesión, 401 como toda la API; con sesión no hay ruta: 404, o 405 cuando
    la interfaz compilada está montada en la raíz y responde solo a GET."""
    cliente, app, al = web
    for ruta, cuerpo in (('solicitar', {'correo': EMAIL}), ('confirmar', {'enlace': 'x' * 40})):
        assert cliente.post(f'/api/acceso/{ruta}', json=cuerpo, headers=X_ROSA).status_code == 401
    assert entrar(cliente).status_code == 200
    for ruta, cuerpo in (('solicitar', {'correo': EMAIL}), ('confirmar', {'enlace': 'x' * 40})):
        assert cliente.post(f'/api/acceso/{ruta}', json=cuerpo, headers=X_ROSA).status_code in (404, 405)
    # Ningún enlace quedó creado (conexión aparte: la del servidor vive en su hilo).
    import sqlite3
    with sqlite3.connect(f"file:{al.ruta.parent / 'datos' / '_correo' / (al.ruta.name + '.db')}?mode=ro", uri=True) as db:
        assert db.execute('SELECT COUNT(*) FROM enlaces').fetchone()[0] == 0
