"""Acceso, autoría y transporte real con proveedor simulado. Sin red ni modelos."""
import copy
import json
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa.acceso import Acceso, _huella_contrasena, huella
from rosa.correo import Correo
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app

EMAIL = 'persona@alzheimerproject.com'
OTRO = 'equipo@alzheimerproject.com'
CONFIG = {'remitente': 'rosa@alzheimerproject.com', 'clave': 'clave-de-prueba', 'url': 'http://localhost:5174'}
CLAVE = 'contraseña de prueba de ROSA2018'


@pytest.fixture
def servicio(tmp_path):
    al = Almacen(tmp_path / 'rosa.db')
    c = Correo(al)
    c.configurar(CONFIG)
    yield c, al
    c.cerrar()
    al.cerrar()


def extraer_enlace(c):
    carga = json.loads(c.db.execute("SELECT carga FROM cola WHERE tipo='acceso' ORDER BY rowid DESC LIMIT 1").fetchone()[0])
    return re.search(r'#acceso=([^\s]+)', carga['text']).group(1)


@pytest.mark.parametrize('correo', ['a@gmail.com', 'a@alzheimerproject.com.evil.com', 'a@sub.alzheimerproject.com', 'a@alzheimerproject.com\r\nBcc:b@evil.com', 'a@@alzheimerproject.com', 'a@alzheimerprоject.com'])
def test_solo_dominio_exacto(servicio, correo):
    c, _ = servicio
    a = Acceso(c)
    with pytest.raises(ValueError):
        a.solicitar(correo, 'local')
    assert not c.db.execute('SELECT 1 FROM cuentas').fetchone()
    assert not c.estado()['historial']


def test_cuenta_solo_tras_confirmar_token_unico_y_sesion_revocable(servicio):
    c, _ = servicio
    a = Acceso(c)
    a.solicitar(EMAIL.upper(), 'local')
    assert not c.db.execute('SELECT 1 FROM cuentas').fetchone()
    enlace = extraer_enlace(c)
    assert c.db.execute('SELECT hash FROM enlaces').fetchone()[0] == huella(enlace)
    token, email = a.confirmar(enlace)
    assert email == EMAIL and a.usuario(token) == EMAIL
    with pytest.raises(ValueError):
        a.confirmar(enlace)
    assert a.usuario('inventada') is None
    a.salir(token)
    assert a.usuario(token) is None


def test_caducidad_y_limite_de_solicitudes(servicio):
    c, _ = servicio
    a = Acceso(c)
    for _ in range(3):
        a.solicitar(EMAIL, 'local')
    enlace = extraer_enlace(c)
    with pytest.raises(ValueError, match='Demasiados'):
        a.solicitar(EMAIL, 'otra-ip')
    with c.db:
        c.db.execute('UPDATE enlaces SET vence=0')
    with pytest.raises(ValueError):
        a.confirmar(enlace)


@pytest.mark.parametrize('campo,valor', [('remitente', 'a@b.com\nBcc:x@y.com'), ('url', 'https://a.com/?token=secreto'), ('url', 'http://rosa.example.com'), ('url', 'javascript:alert(1)'), ('url', 'https://user:pass@a.com'), ('hora', True), ('hora', 24), ('zona', 'inventada'), ('clave', 'abc\nxyz')])
def test_configuracion_adversarial(servicio, campo, valor):
    c, _ = servicio
    antes = c.estado()
    with pytest.raises(ValueError):
        c.configurar({campo: valor})
    assert c.estado() == antes


def test_secretos_fuera_de_estado_y_config_publica(servicio):
    c, al = servicio
    assert CONFIG['clave'] not in json.dumps(c.estado())
    assert CONFIG['clave'] not in al.instantanea_json()
    ruta = al.ruta.parent / 'datos' / '_correo' / 'rosa.db.db'
    assert ruta.stat().st_mode & 0o777 == 0o600


def crear(al, email):
    inv = al.aplicar('crearInvestigacion', {'datos': {'titulo': 'Dato clínico privado', 'objetivo': 'O', 'condicionParada': '1 iteración'}}, actor=email)
    corrida = al.aplicar('iniciarCorrida', {'investigacion_id': inv}, actor=email)
    return inv, corrida


def test_autoria_persistida_sin_suplantacion_y_avisos_por_cuenta(servicio):
    c, al = servicio
    c.observar(al.estado, 100)
    inv, cor = crear(al, EMAIL)
    inv2, cor2 = crear(al, OTRO)
    al.mutar(lambda e: [x.update(estado='terminada') for x in e['corridas']] or True)
    c.observar(al.estado, 200)
    filas = c.estado()['historial']
    assert {x['destinatario'] for x in filas} == {EMAIL, OTRO}
    assert len(filas) == 2
    assert '_correoResponsable' not in al.instantanea_json()
    assert EMAIL not in al.instantanea_json()
    assert 'Dato clínico privado' not in ' '.join(x[0] for x in c.db.execute('SELECT carga FROM cola'))
    c.observar(al.estado, 300)
    assert len(c.estado()['historial']) == 2
    p = c.preferencias(EMAIL)
    p['correo']['activo'] = False
    p['correo']['direccion'] = 'atacante@evil.com'
    c.guardar_preferencias(EMAIL, p)
    assert c.preferencias(EMAIL)['correo']['direccion'] == EMAIL
    assert c.preferencias(OTRO)['correo']['activo']
    c.observar(al.estado, 400)
    assert next(x for x in c.estado()['historial'] if x['destinatario'] == EMAIL)['estado'] == 'cancelado'
    assert next(x for x in c.estado()['historial'] if x['destinatario'] == OTRO)['estado'] == 'pendiente'


def test_reinicio_no_reenvia_historial_y_respeta_cola(servicio):
    c, al = servicio
    crear(al, EMAIL)
    c.observar(al.estado, 100)
    assert not c.estado()['historial']
    al.mutar(lambda e: e['corridas'][0].update(estado='terminada') or True)
    c.observar(al.estado, 200)
    otro = Correo(al)
    otro.observar(al.estado, 300)
    assert len(otro.estado()['historial']) == 1
    otro.cerrar()


def test_nueva_pausa_y_hipotesis_de_otra_cuenta(servicio):
    c, al = servicio
    inv, cor = crear(al, EMAIL)
    c.observar(al.estado, 100)
    al.mutar(lambda e: e['corridas'][0].update(estado='terminada') or True)
    cor2 = al.aplicar('iniciarCorrida', {'investigacion_id': inv}, actor=OTRO)
    al.mutar(lambda e: e['hipotesis'].append({'id': 'h', 'investigacionId': inv, '_corridaOrigen': cor2}) or True)
    c.observar(al.estado, 200)
    hip = [x for x in c.estado()['historial'] if x['tipo'] == 'hipotesisNueva']
    assert [x['destinatario'] for x in hip] == [OTRO]
    for t, estado in [(300, 'pausada'), (400, 'en_marcha'), (500, 'pausada')]:
        al.mutar(lambda e: e['corridas'][1].update(estado=estado) or True)
        c.observar(al.estado, t)
    assert len([x for x in c.estado()['historial'] if x['destinatario'] == OTRO and x['tipo'] == 'corridaDetenida']) == 2


def test_diario_una_vez_y_solo_datos_propios(servicio):
    c, al = servicio
    crear(al, EMAIL)
    crear(al, OTRO)
    p = c.preferencias(EMAIL)
    p['cuando']['resumenDiario'] = True
    c.guardar_preferencias(EMAIL, p)
    antes = datetime(2026, 9, 14, 7, 59, tzinfo=ZoneInfo('America/Santo_Domingo')).timestamp()
    c.observar(al.estado, antes)
    c.observar(al.estado, antes + 120)
    c.observar(al.estado, antes + 180)
    diarios = [x for x in c.estado()['historial'] if x['tipo'] == 'resumenDiario']
    assert len(diarios) == 1 and diarios[0]['destinatario'] == EMAIL
    carga = json.loads(c.db.execute('SELECT carga FROM cola WHERE id=?', (diarios[0]['id'],)).fetchone()[0])
    assert 'Corridas iniciadas por tu cuenta: 1.' in carga['text']


@pytest.mark.asyncio
async def test_enlace_prioritario_se_borra_despues_de_envio(servicio):
    c, _ = servicio
    c.prueba(EMAIL)
    a = Acceso(c)
    a.solicitar(EMAIL, 'local')
    enlace = extraer_enlace(c)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={'id': 'ok'}))) as cliente:
        await c.enviar_uno(cliente)
    filas = c.estado()['historial']
    assert next(x for x in filas if x['tipo'] == 'acceso')['estado'] == 'aceptado'
    assert next(x for x in filas if x['tipo'] == 'prueba')['estado'] == 'pendiente'
    assert enlace not in ' '.join(x[0] for x in c.db.execute('SELECT carga FROM cola'))
    assert a.confirmar(enlace)[1] == EMAIL


@pytest.mark.asyncio
async def test_reintenta_mismo_payload_y_clave_sin_modelos(servicio):
    c, _ = servicio
    c.prueba(EMAIL)
    llamadas = []
    def responder(request):
        llamadas.append(request)
        return httpx.Response(503) if len(llamadas) == 1 else httpx.Response(200, json={'id': 'id-proveedor'})
    ahora = time.time()
    async with httpx.AsyncClient(transport=httpx.MockTransport(responder)) as cliente:
        await c.enviar_uno(cliente, ahora)
        assert c.estado()['historial'][0]['estado'] == 'pendiente'
        await c.enviar_uno(cliente, ahora + 61)
        await c.enviar_uno(cliente, ahora + 120)
    assert len(llamadas) == 2
    assert llamadas[0].headers['idempotency-key'] == llamadas[1].headers['idempotency-key']
    assert llamadas[0].content == llamadas[1].content
    assert c.estado()['historial'][0]['estado'] == 'aceptado'


@pytest.mark.asyncio
async def test_no_reintenta_fuera_de_ventana_y_no_expone_errores(servicio):
    c, _ = servicio
    c.prueba(EMAIL)
    ahora = time.time()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(403, json={'error': CONFIG['clave']}))) as cliente:
        await c.enviar_uno(cliente, ahora)
    assert c.estado()['historial'][0]['estado'] == 'fallido'
    assert CONFIG['clave'] not in json.dumps(c.estado())
    with c.db:
        c.db.execute("UPDATE cola SET estado='pendiente',primero=?,proximo=0", (ahora - 24 * 3600,))
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: pytest.fail('No debe llamar al proveedor'))) as cliente:
        await c.enviar_uno(cliente, ahora)
    assert c.estado()['historial'][0]['estado'] == 'fallido'


@pytest.fixture
def web(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'RAIZ', tmp_path)
    monkeypatch.setattr(config, 'HOST', '127.0.0.1')
    monkeypatch.setattr(config, 'ROSA_TOKEN', '')
    # La cuenta y la huella que el servidor leería de .env, con la misma función scrypt que usa al comparar.
    monkeypatch.setattr(config, 'ROSA_LOGIN_EMAIL', EMAIL)
    monkeypatch.setattr(config, 'ROSA_LOGIN_PASSWORD_HASH', _huella_contrasena(CLAVE))
    monkeypatch.delenv('ROSA_ADMIN', raising=False)
    monkeypatch.delattr(config, 'ROSA_ADMIN', raising=False)
    async def sin_red(self):
        # Las pruebas de transporte usan MockTransport por separado.
        import asyncio
        await asyncio.Event().wait()
    monkeypatch.setattr(Correo, 'correr', sin_red)
    al = Almacen(tmp_path / 'web.db')
    app = crear_app(al)
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 12345)) as cliente:
        yield cliente, app, al
    al.cerrar()


def entrar(cliente, email, contrasena=CLAVE):
    """Entra por la única puerta interactiva: correo corporativo y contraseña."""
    return cliente.post('/api/acceso/entrar', json={'correo': email, 'contrasena': contrasena}, headers={'X-Rosa': '1'})


def test_web_de_punta_a_punta_sin_proveedor_real(web, monkeypatch):
    cliente, app, al = web
    assert cliente.get('/api/estado').status_code == 401
    assert cliente.get('/api/correo').status_code == 401
    # El enlace por correo ya no es una vía de entrada desde la web (18 de septiembre de 2026)
    # y el servidor retiró sus rutas el 19: sin sesión 401 como toda la API, con sesión no hay
    # ruta (404, o 405 si la interfaz compilada montada en la raíz contesta al POST).
    # La puerta es /api/acceso/entrar; la clase Acceso conserva solicitar y confirmar.
    assert cliente.post('/api/acceso/solicitar', json={'correo': EMAIL}, headers={'X-Rosa': '1'}).status_code == 401
    assert cliente.post('/api/acceso/confirmar', json={'enlace': 'x' * 40}, headers={'X-Rosa': '1'}).status_code == 401
    assert cliente.post('/api/acceso/entrar', json={'correo': EMAIL, 'contrasena': CLAVE}).status_code == 403  # sin X-Rosa
    assert cliente.get('/api/acceso/estado').json()['instalacionLocal']
    r = cliente.post('/api/acceso/configuracion', json=CONFIG, headers={'X-Rosa': '1'})
    assert r.status_code == 200
    r = entrar(cliente, EMAIL, 'otra contraseña')
    assert r.status_code == 401 and r.json()['detail'] == 'Correo o contraseña incorrectos' and 'set-cookie' not in r.headers
    assert cliente.get('/api/estado').status_code == 401
    r = entrar(cliente, EMAIL)
    assert r.status_code == 200 and r.json()['correo'] == EMAIL
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=strict' in r.headers['set-cookie']
    assert cliente.get('/api/estado').status_code == 200
    assert cliente.post('/api/acceso/solicitar', json={'correo': EMAIL}, headers={'X-Rosa': '1'}).status_code in (404, 405)
    assert cliente.post('/api/acceso/confirmar', json={'enlace': 'x' * 40}, headers={'X-Rosa': '1'}).status_code in (404, 405)
    assert not cliente.get('/api/acceso/estado').json()['instalacionLocal']
    assert cliente.get('/api/acceso/estado').json()['accesoConfigurado']
    assert cliente.post('/api/acceso/configuracion', json=CONFIG, headers={'X-Rosa': '1'}).status_code == 403
    r = cliente.post('/api/acciones/crearInvestigacion', json={'datos': {'titulo': 'T', 'objetivo': 'O', 'condicionParada': '1 iteración', '_correoResponsable': OTRO}}, headers={'X-Rosa': '1'})
    assert r.status_code == 200
    assert al.estado['investigaciones'][0]['_correoResponsable'] == EMAIL
    assert cliente.post('/api/correo/prueba', json={}, headers={'X-Rosa': '1'}).status_code == 200
    # Sin ROSA_ADMIN administra la única cuenta verificada, la configurada; con ROSA_ADMIN
    # apuntando a otra deja de administrar aunque sea la primera.
    assert cliente.get('/api/acceso/estado').json()['administrador']
    assert cliente.post('/api/correo/configuracion', json=CONFIG, headers={'X-Rosa': '1'}).status_code == 200
    monkeypatch.setenv('ROSA_ADMIN', OTRO)
    assert not cliente.get('/api/acceso/estado').json()['administrador']
    assert cliente.post('/api/correo/configuracion', json=CONFIG, headers={'X-Rosa': '1'}).status_code == 403
    assert all(x['destinatario'] == EMAIL for x in cliente.get('/api/correo').json()['historial'])
    assert cliente.post('/api/acceso/salir', json={}, headers={'X-Rosa': '1'}).status_code == 200
    assert cliente.get('/api/estado').status_code == 401
    # Otra cuenta del dominio no entra con la misma contraseña: solo la configurada.
    assert entrar(cliente, OTRO).status_code == 401
    assert cliente.get('/api/estado').status_code == 401


def test_instalacion_no_acepta_proxy_ni_origen_ajeno(web):
    cliente, _, _ = web
    for cabecera in ({'X-Forwarded-For': '8.8.8.8'}, {'Origin': 'https://evil.example'}):
        r = cliente.post('/api/acceso/configuracion', json=CONFIG, headers={'X-Rosa': '1', **cabecera})
        assert r.status_code == 403
