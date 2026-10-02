"""Paridad de servicios, permisos de sesión y operaciones de una sola ejecución."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from rosa import asistente as AS
from rosa import asistente_servicios as SV
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    from rosa import config, gateway
    def sin_modelo_real():
        raise RuntimeError('Esta prueba no llama al Gateway')
    monkeypatch.setattr(gateway, 'modelos', sin_modelo_real)
    monkeypatch.setattr(config, 'RAIZ', tmp_path)
    al = Almacen(tmp_path / 'rosa.db')
    al.aplicar('crearInvestigacion', {'datos': {'titulo': 'MAPT', 'objetivo': 'Revisar tau', 'condicionParada': '2 iteraciones'}, 'id_': 'inv-a'})
    al.aplicar('iniciarCorrida', {'investigacion_id': 'inv-a'})
    app = crear_app(al)
    usuarios = {'sesion': 'persona@rosa.test', 'admin': 'admin@rosa.test'}
    app.state.acceso = SimpleNamespace(usuario=lambda token: usuarios.get(token), es_admin=lambda email: email == 'admin@rosa.test', solicitudes=lambda: [])
    app.state.correo = SimpleNamespace(preferencias=lambda email: al.instantanea()['avisos'])
    cliente = TestClient(app, base_url='http://127.0.0.1', cookies={'rosa_sesion': 'sesion'})
    def servicio(sesion='sesion'):
        request = Request({'type': 'http', 'headers': [(b'cookie', f'rosa_sesion={sesion}'.encode())]})
        return SV.Servicios(app, request, sesion == 'admin')
    yield al, app, cliente, servicio
    al.cerrar()


def extraer(s):
    # como_dato delimita el JSON; no se asumen instrucciones en el contenido.
    inicio, fin = s.index('{'), s.rindex('}') + 1
    pagina = json.loads(s[inicio:fin])
    return json.loads(pagina['contenido'])


def guardar(al, servicio, nombre, args):
    ops = []
    token = SV.CONTEXTO.set(servicio)
    try:
        t = {t.name: t.func for t in AS.herramientas(al, 'inv-a', ops)}
        t['preparar_accion'](nombre, args, 'Cambio solicitado')
    finally:
        SV.CONTEXTO.reset(token)
    al.aplicar('registrarPreguntaBases', {'investigacion_id': 'inv-a', 'pregunta': {'pregunta': 'Haz el cambio', 'quien': 'admin@rosa.test' if servicio.administrador else 'persona@rosa.test', 'acciones': ops}})
    q = al.estado['investigaciones'][0]['preguntasABases'][-1]
    return f"/api/investigaciones/inv-a/asistente/{q['id']}/{ops[0]['id']}"


def test_catalogo_cubre_rutas_reales_y_no_crea_acceso_implicito(entorno):
    _, app, _, crear = entorno
    rutas = app.openapi()['paths']
    for ruta, _ in SV.LECTURAS.values():
        assert 'get' in rutas[ruta]
    for ruta, *_ in SV.ESCRITURAS.values():
        plantilla = '/api/acciones/{nombre}' if ruta.startswith('/api/acciones/') else ruta
        assert 'post' in rutas[plantilla]
    normal, admin = crear().catalogo(), crear('admin').catalogo()
    assert 'cuentas' not in normal['lecturas'] and 'cuentas' in admin['lecturas']
    assert 'servicio:gepa' not in normal['accionesConConfirmacion']
    assert 'servicio:gepa' in admin['accionesConConfirmacion']
    for nombre in ('estado', '/api/estado', 'eventos', 'entrar', 'configuracion', '../.env'):
        assert 'error' in crear().catalogo(nombre)


@pytest.mark.parametrize('nombre,parametros', [
    ('laboratorio', {}), ('prisma', None), ('costes', {'investigacion_id': 'inv-a'}),
    ('ruta', {'investigacion_id': 'inv-a'}), ('mapa', {'investigacion_id': 'inv-a'}),
    ('cifras', {'investigacion_id': 'inv-a'}), ('vocabularios', {}),
    ('integridad', {}), ('acuerdo', {}), ('llamadas', None), ('evidencia', None),
    ('citas', None), ('skills', {}), ('conectores', {}), ('politicas', {}), ('salud', {}),
])
def test_mismos_resultados_que_la_pantalla(entorno, nombre, parametros):
    al, _, cliente, crear = entorno
    parametros = parametros if parametros is not None else {'corrida_id': al.estado['corridas'][0]['id']}
    ruta = SV.construir_ruta(SV.LECTURAS[nombre][0], parametros)
    normal = cliente.get(ruta, params={'paginado': True} if nombre == 'llamadas' else {})
    assert normal.status_code == 200
    servicio = crear()
    asyncio.run(servicio.consultar(nombre, parametros))
    obtenido = next(iter(servicio.cache.values()))
    assert obtenido['ok']
    # Los informes con reloj se comparan por sus claves; el resto exactamente.
    if nombre in {'prisma', 'cifras', 'laboratorio'}:
        assert obtenido['datos'].keys() == normal.json().keys()
    else:
        assert obtenido['datos'] == normal.json()


def test_evidencia_privada_si_credenciales_no(entorno):
    al, _, _, crear = entorno
    cor = al.estado['corridas'][0]['id']
    def poblar(e):
        c = e['corridas'][0]
        c['_afirmaciones'] = [{'id': 'af-1', 'texto': 'Pasaje exacto de tau', 'veredicto': 'sostenida', 'localizador': {'pagina': 7}}]
        c['_credencial'] = 'NO ENVIAR ESTA CLAVE'
        return True
    al.mutar(poblar)
    assert '_afirmaciones' not in al.instantanea()['corridas'][0]
    r = asyncio.run(crear().consultar('evidencia', {'corrida_id': cor}))
    assert 'Pasaje exacto de tau' in r and 'NO ENVIAR ESTA CLAVE' not in r


def test_fallos_no_se_presentan_como_ausencia_y_sesion_se_revalida(entorno):
    _, _, _, crear = entorno
    r = extraer(asyncio.run(crear().consultar('contrato', {'hipotesis_id': 'inexistente'})))
    assert not r['ok'] and r['estadoHttp'] == 404
    r = extraer(asyncio.run(crear('caducada').consultar('salud', {})))
    assert not r['ok'] and r['estadoHttp'] == 401
    r = extraer(asyncio.run(crear().consultar('salud', {'token': 'inventado'})))
    assert not r['ok'] and 'Parámetros' in r['error']


@pytest.mark.parametrize('ident', ['../.env', '..', '.', 'x/y', 'x?token=a', 'x#fragmento', 'x%2fy', 'https://otro'])
def test_no_admite_rutas_libres(ident):
    with pytest.raises(ValueError):
        SV.construir_ruta('/api/hipotesis/{hipotesis_id}/contrato', {'hipotesis_id': ident})


def test_operacion_confirmada_una_vez_y_con_permisos_actuales(entorno):
    al, app, cliente, crear = entorno
    controles = []
    al.gepa_servicio = SimpleNamespace(control=controles.append)
    url = guardar(al, crear('admin'), 'servicio:gepa', {'accion_gepa': 'pausar'})
    assert not controles
    assert cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True}).status_code == 400
    cliente.cookies.set('rosa_sesion', 'admin')
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True, 'argumentos': {'accion_gepa': 'restablecer'}})
    assert r.status_code == 200 and r.json()['estado'] == 'ejecutada'
    assert controles == ['pausar']
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert r.json()['repetida'] and controles == ['pausar']
    url = guardar(al, crear('admin'), 'servicio:gepa', {'accion_gepa': 'reanudar'})
    app.state.acceso.es_admin = lambda _: False
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert r.json()['estado'] == 'no_aplicada' and controles == ['pausar']
    assert al.verificar_cadena()['ok']


def test_cancelacion_y_fallo_de_servicio(entorno):
    al, _, cliente, crear = entorno
    url = guardar(al, crear(), 'servicio:sellar', {'hipotesis_id': 'desconocida'})
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': False})
    assert r.json()['estado'] == 'cancelada'
    url = guardar(al, crear(), 'servicio:sellar', {'hipotesis_id': 'desconocida'})
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert r.json()['estado'] == 'no_aplicada' and not r.json()['ok']


def test_resultado_incierto_no_repite_efecto(entorno, monkeypatch):
    al, _, cliente, crear = entorno
    llamadas = []
    async def fallar(*args):
        llamadas.append(1)
        raise TimeoutError()
    monkeypatch.setattr(SV.Servicios, 'ejecutar', fallar)
    url = guardar(al, crear(), 'servicio:sellar', {'hipotesis_id': 'h'})
    r = cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert r.json()['estado'] == 'resultado_desconocido'
    assert 'No se pudo comprobar' in r.json()['resultado']['error']
    cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert llamadas == [1]


def test_paginacion_y_metodos_no_abren_archivos_arbitrarios(entorno):
    al, _, _, _ = entorno
    t = {t.name: t.func for t in SV.herramientas_locales(al)}
    assert 'Documento desconocido' in t['consultar_documentacion']('../.env')
    assert 'Skill desconocida' in t['leer_skill']('../.env')
    p = SV.paginar({'resumen': {'n': 60}, 'grande': 'z' * 25000}, camino='resumen')
    assert extraer(p) == {'n': 60}
    assert 'siguiente' in SV.paginar('z' * 25000)
    assert 'Campo desconocido' in SV.paginar({}, camino='no/existe')


@pytest.mark.parametrize('nombre_tool', ['leer_dataset', 'consultar_dataset'])
def test_dataset_sin_permiso_no_abre_fichero(entorno, monkeypatch, nombre_tool):
    from rosa import datos as D
    al, _, _, _ = entorno
    al.mutar(lambda e: e['investigaciones'][0].update(datasets=[{'id': 'ds-a', 'procedencia': {'fichero': 'datos.csv', 'permiteLlmTerceros': False}}]) or True)
    def prohibido(*args, **kwargs):
        pytest.fail('No debe leer filas sin autorización')
    monkeypatch.setattr(D, 'esquema_para_modelo', prohibido)
    tool = {t.name: t.func for t in SV.herramientas_locales(al)}[nombre_tool]
    monkeypatch.setattr(D, 'ruta_dataset', prohibido)
    salida = asyncio.run(tool('inv-a', 'ds-a'))
    assert 'no autoriza' in salida or 'sin autorización' in salida


def test_servicios_prohibidos_no_se_preparan(entorno):
    al, _, _, crear = entorno
    with pytest.raises(ValueError):
        guardar(al, crear(), 'servicio:gepa', {'accion_gepa': 'pausar'})
    with pytest.raises(ValueError):
        guardar(al, crear('admin'), 'servicio:configurar_correo', {'clave': 'no-enviar'})


def test_toda_ruta_api_tiene_clasificacion_explicita(entorno):
    _, app, _, _ = entorno
    cubiertas = {ruta for ruta, _ in SV.LECTURAS.values()} | {v[0] for v in SV.ESCRITURAS.values()}
    # Flujos de identidad y transporte no son herramientas del modelo; las
    # cargas las opera la persona desde el adjunto, sin mandar bytes al LLM.
    otras = {
        '/api/estado': 'consultar_proyecto y leer_registro',
        '/api/eventos': 'SSE de la interfaz',
        '/api/acciones/{nombre}': 'catálogo de reducers y confirmación',
        '/api/investigaciones/{investigacion_id}/preguntar': 'entrada de la conversación',
        '/api/investigaciones/{investigacion_id}/preguntar/{seguimiento}/cancelar': 'control de la respuesta por su autor',
        '/api/investigaciones/{investigacion_id}/asistente/{pregunta_id}/{operacion_id}': 'confirmación',
        '/api/preguntar/razonamiento/{seguimiento}': 'progreso del chat',
        '/api/corridas/{corrida_id}/citas/reverificar': 'acción pedirRecuperacionCitas',
        '/api/hipotesis/{hipotesis_id}/datos': 'adjunto de resultados',
        '/api/investigaciones/{investigacion_id}/datasets': 'adjunto de dataset',
        '/api/acceso/configuracion': 'formulario de instalación y credenciales',
        '/api/acceso/entrar': 'formulario de contraseña',
        '/api/acceso/registrar': 'formulario de registro y contraseña',
        '/api/acceso/entrar_sin_verificar': 'ruta retirada, responde 410',
        '/api/acceso/salir': 'cierre de sesión en la interfaz',
        '/api/traducir': 'traducción de interfaz; el asistente ya genera texto',
    }
    rutas = {r for r in app.openapi()['paths'] if r.startswith('/api/')}
    assert not rutas - cubiertas - set(otras), 'Una ruta nueva necesita acceso o una clasificación explícita'


def test_exportacion_entrega_enlace_y_se_guarda_en_el_hilo(entorno):
    from rosa.estado import plantilla as P
    al, _, _, crear = entorno
    h = P.nueva_hipotesis('inv-a', 1, 1, titulo='MAPT', enunciado='Hipótesis de prueba', mecanismo='Prueba')
    al.mutar(lambda e: e['hipotesis'].append(h) or True)
    servicio = crear()
    r = extraer(asyncio.run(servicio.consultar('exportar_rocrate', {'hipotesis_id': h['id']})))
    assert r['tipo'] == 'application/zip' and r['bytes'] > 0
    assert r['descarga'] == f"/api/hipotesis/{h['id']}/rocrate"
    assert len(servicio.descargas) == 1
    al.aplicar('registrarPreguntaBases', {'investigacion_id': 'inv-a', 'pregunta': {'pregunta': 'Dame el expediente', 'descargas': servicio.descargas}})
    assert al.instantanea()['investigaciones'][0]['preguntasABases'][-1]['descargas'] == servicio.descargas


def test_contexto_de_sesion_y_vista_llega_al_agente_sin_credenciales(entorno, monkeypatch):
    al, app, cliente, _ = entorno
    app.state.modelos = SimpleNamespace(cerebro=None)
    async def responder(*args, **kwargs):
        servicios = SV.CONTEXTO.get()
        assert servicios and not servicios.administrador
        r = await servicios.consultar('salud', {})
        assert extraer(r)['ok']
        assert servicios.vista == {'pantalla': 'modelo_de_mundo', 'seleccion': 'he-1'}
        assert 'sesion' not in json.dumps(servicios.catalogo())
        return {'respuesta': 'Soy ROSA', 'acciones': [], 'descargas': [], 'consultas': []}
    monkeypatch.setattr(AS, 'preguntar', responder)
    r = cliente.post('/api/investigaciones/inv-a/preguntar', headers={'X-Rosa': '1'}, json={'pregunta': 'Mira lo seleccionado', 'asistente': True, 'vista': {'pantalla': 'modelo_de_mundo', 'seleccion': 'he-1', 'administrador': True}})
    assert r.status_code == 200 and r.json()['ok']
    assert al.estado['investigaciones'][0]['preguntasABases'][-1]['respuesta'] == 'Soy ROSA'
    assert SV.CONTEXTO.get() is None
