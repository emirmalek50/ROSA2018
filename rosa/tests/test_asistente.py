"""El asistente consulta todo ROSA y aplica solo operaciones humanas guardadas."""
import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from rosa import asistente as AS
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app


@pytest.fixture
def al(tmp_path):
    a = Almacen(tmp_path / 'rosa.db')
    for ident in ('inv-a', 'inv-b'):
        a.aplicar('crearInvestigacion', {'datos': {'titulo': ident, 'objetivo': 'Investigar MAPT', 'condicionParada': '2 iteraciones'}, 'id_': ident})
    yield a
    a.cerrar()


def tools(al, ops=None):
    return {t.name: t.func for t in AS.herramientas(al, 'inv-a', ops if ops is not None else [])}


def guardar(al, nombre='iniciarCorrida', args=None, quien='persona@rosa.test'):
    ops = []
    tools(al, ops)['preparar_accion'](nombre, args or {'investigacion_id': 'inv-b'}, 'Iniciar la investigación B')
    al.aplicar('registrarPreguntaBases', {'investigacion_id': 'inv-a', 'pregunta': {'pregunta': 'Corre la B', 'quien': quien, 'acciones': ops}})
    q = al.estado['investigaciones'][0]['preguntasABases'][-1]
    return {'investigacion_id': 'inv-a', 'pregunta_id': q['id'], 'operacion_id': ops[0]['id'], 'aprobar': True}


def test_busca_global_cuenta_y_pagina_sin_secretos(al):
    def poblar(e):
        e['hechos'] = [{'id': f'he-{i}', 'investigacionId': 'inv-b', 'enunciado': 'MAPT y tau', 'estado': 'sabido' if i % 2 else 'abierto', '_secreto': 'NO MOSTRAR'} for i in range(20)]
        return True
    al.mutar(poblar)
    t = tools(al)
    r = t['consultar_proyecto']('hechos', 'MAPT')
    assert '"total": 20' in r and '"siguiente": 15' in r and 'NO MOSTRAR' not in r
    assert 'he-19' in t['consultar_proyecto']('hechos', 'MAPT', '', 15)
    assert '"total": 0' in t['consultar_proyecto']('hechos', 'MAPT', 'inv-a')
    detalle = t['leer_registro']('hechos', 'he-1')
    assert 'NO MOSTRAR' not in detalle and 'MAPT' in detalle
    assert 'Tabla desconocida' in t['leer_registro']('_secretos', 'x')


def test_catalogo_sin_operaciones_internas(al):
    t = tools(al)
    listado = json.loads(t['catalogo_acciones']())['acciones']
    assert 'iniciarCorrida' in listado and 'aprobarPlan' in listado and 'pedirAnalisis' in listado
    assert not set(listado) & AS.EXCLUIDAS
    assert 'condicionParada' in t['catalogo_acciones']('crearInvestigacion')


@pytest.mark.parametrize('nombre,args', [
    ('registrarEvaluacion', {}), ('resolverAccionAsistente', {}),
    ('iniciarCorrida', {'investigacion_id': 'inv-a', 'quien': 'otra'}),
    ('iniciarCorrida', {}), ('crearInvestigacion', {'datos': {'titulo': 'X'}}),
    ('iniciarCorrida', {'investigacion_id': 'inv-a', 'ahora': 0}),
])
def test_rechaza_operaciones_invalidas(al, nombre, args):
    with pytest.raises((ValueError, TypeError)):
        tools(al)['preparar_accion'](nombre, args, 'Cambiar')
    assert not al.estado['corridas']


def test_preparar_no_ejecuta_y_confirmar_es_idempotente_y_firma_la_sesion(al):
    args = guardar(al)
    assert not al.estado['corridas']
    r = al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')
    assert r['ok'] and r['estado'] == 'ejecutada'
    assert al.estado['corridas'][0]['investigacionId'] == 'inv-b'
    assert al.estado['corridas'][0]['estado'] == 'esperando_plan'
    assert al.estado['corridas'][0]['_correoResponsable'] == 'persona@rosa.test'
    assert al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')['repetida']
    assert len(al.estado['corridas']) == 1
    assert al.verificar_cadena()['ok']


def test_otra_persona_no_confirma_y_no_puede_suplantar_quien(al):
    args = guardar(al)
    with pytest.raises(ValueError, match='Solo quien'):
        al.aplicar('resolverAccionAsistente', {**args, 'quien': 'persona@rosa.test'}, actor='otra@rosa.test')
    assert not al.estado['corridas']


def test_cancelar_no_ejecuta_ni_reabre(al):
    args = guardar(al)
    assert al.aplicar('resolverAccionAsistente', {**args, 'aprobar': False}, actor='persona@rosa.test')['estado'] == 'cancelada'
    assert not al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')['ok']
    assert not al.estado['corridas']


def test_estado_cambiado_no_arranca_otra_corrida(al):
    args = guardar(al)
    al.aplicar('iniciarCorrida', {'investigacion_id': 'inv-b'})
    r = al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')
    assert not r['ok'] and r['estado'] == 'no_aplicada'
    assert len(al.estado['corridas']) == 1


def test_accion_fallida_no_deja_mutacion_parcial(al, monkeypatch):
    from rosa.estado.almacen import ACCIONES
    def fallar(e, investigacion_id):
        e['hechos'].append({'id': 'inventado'})
        return False
    monkeypatch.setitem(ACCIONES, 'iniciarCorrida', (fallar, False))
    args = guardar(al)
    al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')
    assert not al.estado['hechos']


def test_operacion_persiste_tras_reabrir(al):
    args = guardar(al)
    ruta = al.ruta
    al.cerrar()
    otro = Almacen(ruta)
    try:
        assert otro.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')['ok']
    finally:
        otro.cerrar()


def test_endpoint_conserva_auth_y_no_acepta_argumentos_alterados(al, monkeypatch):
    from rosa import gateway
    def sin_modelo_real():
        raise RuntimeError('Esta prueba no llama al Gateway')
    monkeypatch.setattr(gateway, 'modelos', sin_modelo_real)
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: 'persona@rosa.test' if token == 'sesion' else None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: al.instantanea()['avisos'])
    c = TestClient(app, base_url='http://127.0.0.1:8765', cookies={'rosa_sesion': 'sesion'})
    args = guardar(al)
    url = f"/api/investigaciones/inv-a/asistente/{args['pregunta_id']}/{args['operacion_id']}"
    assert c.post(url, json={'aprobar': True}).status_code == 403
    assert c.post('/api/acciones/resolverAccionAsistente', headers={'X-Rosa': '1'}, json=args).status_code == 403
    assert c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': 'sí'}).status_code == 400
    r = c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True, 'argumentos': {'investigacion_id': 'inv-a'}})
    assert r.status_code == 200 and r.json()['ok']
    assert al.estado['corridas'][0]['investigacionId'] == 'inv-b'


def test_identidad_herramientas_y_operaciones_del_modelo_se_guardan(al, monkeypatch):
    from rosa import herramientas as H
    vistos = {}
    class Agente:
        def __init__(self, firma, tools, max_iters):
            vistos['firma'] = firma.__doc__
            vistos['tools'] = {t.name: t for t in tools}
        async def acall(self, **kw):
            vistos['tools']['preparar_accion'].func('iniciarCorrida', {'investigacion_id': 'inv-b'}, 'Iniciar B')
            return SimpleNamespace(respuesta='Soy ROSA. Preparé el inicio de B.', limites='', cobertura='', trajectory={})
    monkeypatch.setattr(AS.dspy, 'ReAct', Agente)
    monkeypatch.setattr(H, 'herramientas', lambda *a, **k: [])
    r = asyncio.run(AS.preguntar(None, {}, 'inv-a', 'Corre B', '', almacen=al))
    assert 'Eres ROSA' in vistos['firma'] and 'no ChatGPT' in vistos['firma']
    assert {'consultar_proyecto', 'leer_registro', 'catalogo_acciones', 'preparar_accion'} <= set(vistos['tools'])
    assert r['acciones'][0]['estado'] == 'pendiente' and not al.estado['corridas']


def test_crea_y_arranca_en_una_operacion_con_plan_pendiente(al):
    args = guardar(al, 'crearInvestigacionEIniciar', {'datos': {'titulo': 'MAPT', 'objetivo': 'Revisar MAPT', 'condicionParada': '2 iteraciones'}})
    r = al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')
    assert r['ok'] and r['resultado']['estado'] == 'esperando_plan'
    assert al.estado['corridas'][0]['investigacionId'] == r['resultado']['investigacionId']
    assert al.estado['corridas'][0]['_correoResponsable'] == 'persona@rosa.test'


def test_pregunta_api_usa_rosa_y_guarda_operaciones_con_autoria(al, monkeypatch):
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: 'persona@rosa.test' if token == 'sesion' else None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: al.instantanea()['avisos'])
    app.state.modelos = SimpleNamespace(cerebro=None)
    contextos = []
    async def responder(lm, estado, investigacion_id, pregunta, contexto, *, almacen):
        contextos.append(contexto)
        ops = []
        tools(almacen, ops)['preparar_accion']('iniciarCorrida', {'investigacion_id': 'inv-b'}, 'Iniciar GFAP')
        return {'respuesta': 'Soy ROSA. Preparé el inicio.', 'limites': '', 'acciones': ops, 'consultas': [], 'herramientas': ['preparar_accion'], 'iteraciones': 1}
    monkeypatch.setattr(AS, 'preguntar', responder)
    c = TestClient(app, base_url='http://127.0.0.1:8765', cookies={'rosa_sesion': 'sesion'})
    url = '/api/investigaciones/inv-a/preguntar'
    r = c.post(url, headers={'X-Rosa': '1'}, json={'pregunta': 'Corre GFAP', 'asistente': True, 'hilo': 'hilo-1', 'quien': 'suplantada'})
    assert r.json()['ok']
    q = al.estado['investigaciones'][0]['preguntasABases'][-1]
    assert q['quien'] == 'persona@rosa.test' and q['acciones'][0]['estado'] == 'pendiente'
    c.post(f"/api/investigaciones/inv-a/asistente/{q['id']}/{q['acciones'][0]['id']}", headers={'X-Rosa': '1'}, json={'aprobar': True})
    c.post(url, headers={'X-Rosa': '1'}, json={'pregunta': '¿Ya empezó?', 'asistente': True, 'hilo': 'hilo-1'})
    assert 'ejecutada' in contextos[-1] and al.estado['corridas'][0]['id'] in contextos[-1]


def test_no_aprueba_un_plan_distinto_del_que_vio_la_persona(al):
    def poblar(e):
        e['iteraciones'] = [{'id': 'it-1', 'corridaId': 'cor-1', 'numero': 1, 'planAprobado': False, 'plan': [{'titulo': 'Revisar GFAP'}]}]
        return True
    al.mutar(poblar)
    args = guardar(al, 'aprobarPlan', {'iteracion_id': 'it-1'})
    al.mutar(lambda e: e['iteraciones'][0].update(plan=[{'titulo': 'Otro experimento'}]) or True)
    r = al.aplicar('resolverAccionAsistente', args, actor='persona@rosa.test')
    assert not r['ok'] and not al.estado['iteraciones'][0]['planAprobado']


def test_arbol_cuenta_el_grafo_no_la_tabla_relaciones_y_respeta_el_alcance(al):
    from rosa import grafo as G
    from rosa.tests.test_grafo import _estado
    e, inv = _estado()
    e['investigaciones'] = [inv, {'id': 'otra', 'titulo': 'Otra', 'objetivo': 'Otro objetivo'}]
    e['relaciones'] = [{'id': str(i)} for i in range(46)]
    al.mutar(lambda destino: destino.update(e) or True)
    tool = {t.name: t.func for t in AS.herramientas(al, inv['id'], [])}['consultar_arbol']
    salida = tool()
    g = G.construir(al.instantanea(), inv)
    assert f'"nodosTotales": {len(g["nodos"])}' in salida
    assert f'"enlacesTotales": {len(g["enlaces"])}' in salida
    assert '"nodosTotales": 46' not in salida
    assert '"nodosTotales": 1' in tool('otra')
    assert 'Investigación desconocida' in tool('inexistente')
    assert 'Tipo de nodo desconocido' in tool(tipo='inventado')
    assert '"tipoFiltro": "hipotesis"' in tool(tipo='hipotesis')
    assert '"nodos": []' in tool(desde=10000)
    assert 'no es el estado actual del navegador' in salida
