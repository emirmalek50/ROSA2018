"""Borrado confirmado de hilos, sin perder investigaciones ni resucitar mensajes."""
import asyncio
import copy
import json
from types import SimpleNamespace

import pytest

from rosa import asistente as AS
from rosa import asistente_operaciones as AO
from rosa import asistente_servicios as SV
from rosa.asistente_conversaciones import conversacion
from rosa.estado.almacen import Almacen
from rosa.tests import test_asistente_servicios as TS
from rosa.tests.test_asistente_cancelacion import cliente


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    yield from TS.entorno.__wrapped__(tmp_path, monkeypatch)


def mensaje(al, inv, hilo=None, texto='Revisa MAPT', **extra):
    al.aplicar('registrarPreguntaBases', {'investigacion_id': inv, 'pregunta': {
        'pregunta': texto, 'respuesta': 'Respuesta guardada', 'quien': 'persona@rosa.test',
        **({'hilo': hilo} if hilo else {}), **extra,
    }})
    return conversacion(al.estado, inv)['preguntasABases'][-1]


def preparar(al, inv, destino, hilo, actual='h-peticion'):
    ops = []
    token = SV.CONTEXTO.set(SimpleNamespace(hilo=actual))
    try:
        tools = {t.name: t.func for t in AS.herramientas(al, inv, ops)}
        tools['preparar_accion']('eliminarConversacion', {'investigacion_id': destino, 'hilo': hilo}, 'Borra el chat')
    finally:
        SV.CONTEXTO.reset(token)
    q = mensaje(al, inv, actual, 'Borra esa conversación', acciones=ops)
    return f'/api/investigaciones/{inv}/asistente/{q["id"]}/{ops[0]["id"]}'


def confirmar(c, ruta, aprobar=True):
    return c.post(ruta, json={'aprobar': aprobar}, headers={'X-Rosa': '1'})


@pytest.mark.parametrize('inv', ['inv-a', 'global'])
def test_descubrir_confirmar_otro_hilo_y_conservar_investigacion(entorno, inv):
    al, _, c, _ = entorno
    mensaje(al, inv, 'h-mapt')
    mensaje(al, inv, 'h-mapt', '¿Y sus isoformas?')
    mensaje(al, inv, 'h-otro', 'Revisa GFAP')
    antes = copy.deepcopy(al.estado)
    ops = []
    tools = {t.name: t.func for t in AS.herramientas(al, inv, ops)}
    assert 'eliminarConversacion' in json.loads(tools['catalogo_acciones']())['acciones']
    ficha = AS.descripcion_accion('eliminarConversacion')
    assert set(ficha['argumentos']) == {'investigacion_id', 'hilo'}
    lista = TS.extraer(tools['listar_conversaciones'](consulta='MAPT'))
    assert lista['total'] == 1
    assert lista['conversaciones'][0]['hilo'] == 'h-mapt'
    assert lista['conversaciones'][0]['mensajes'] == 2
    ruta = preparar(al, inv, inv, 'h-mapt')
    # Preparar nunca borra por sí solo.
    assert len(conversacion(al.estado, inv)['preguntasABases']) == 4
    r = confirmar(c, ruta)
    assert r.status_code == 200, r.text
    assert r.json()['estado'] == 'ejecutada'
    assert r.json()['resultado']['mensajesEliminados'] == 2
    final = conversacion(al.estado, inv)
    assert [q['hilo'] for q in final['preguntasABases']] == ['h-otro', 'h-peticion']
    assert final['hilosEliminados'] == ['h-mapt']
    assert not final['preguntasABases'][-1]['acciones'][0].get('continuacion')
    for clave in ('corridas', 'hechos', 'hipotesis', 'datasets'):
        assert al.estado.get(clave) == antes.get(clave)
    assert confirmar(c, ruta).json()['repetida'] is True
    assert TS.extraer(tools['listar_conversaciones'](consulta='isoformas'))['total'] == 0


@pytest.mark.parametrize('inv', ['inv-a', 'global'])
@pytest.mark.parametrize('con_historia', [False, True])
def test_eliminar_hilo_actual_incluso_su_primera_peticion_y_reintentar(entorno, inv, con_historia):
    al, _, c, _ = entorno
    if con_historia:
        mensaje(al, inv, 'h-actual')
    ruta = preparar(al, inv, inv, 'h-actual', actual='h-actual')
    r = confirmar(c, ruta)
    assert r.status_code == 200, r.text
    assert r.json()['resultado']['mensajesEliminados'] == 1 + int(con_historia)
    assert conversacion(al.estado, inv)['preguntasABases'] == []
    assert confirmar(c, ruta).json()['repetida'] is True
    assert '_recibosConversaciones' not in al.instantanea()
    recibo = next(iter(al.estado['_recibosConversaciones'].values()))
    assert 'Borra esa conversación' not in json.dumps(recibo)
    # Reiniciar conserva el recibo y el bloqueo del hilo.
    ruta_bd = al.ruta
    al.cerrar()
    with_ = Almacen(ruta_bd)
    try:
        assert conversacion(with_.estado, inv)['preguntasABases'] == []
        assert AS.resolver_accion(with_.estado, inv, recibo['preguntaId'], ruta.rsplit('/', 1)[1], True, 'persona@rosa.test', 0)['repetida']
        assert not with_.aplicar('registrarPreguntaBases', {'investigacion_id': inv, 'pregunta': {'hilo': 'h-actual', 'pregunta': 'Tardía', 'respuesta': 'No debe volver'}})
    finally:
        with_.cerrar()


def test_cancelar_no_borra_y_otra_persona_no_confirma_ni_usa_recibo(entorno):
    al, _, c, _ = entorno
    mensaje(al, 'inv-a', 'h-mapt')
    ruta = preparar(al, 'inv-a', 'inv-a', 'h-mapt')
    c.cookies.set('rosa_sesion', 'admin')
    assert confirmar(c, ruta).status_code == 400
    c.cookies.set('rosa_sesion', 'sesion')
    assert confirmar(c, ruta, False).json()['estado'] == 'cancelada'
    assert any(q.get('hilo') == 'h-mapt' for q in conversacion(al.estado, 'inv-a')['preguntasABases'])
    propia = preparar(al, 'inv-a', 'inv-a', 'h-mapt', actual='h-mapt')
    assert confirmar(c, propia).json()['ok']
    c.cookies.set('rosa_sesion', 'admin')
    assert confirmar(c, propia).status_code == 400


def test_historial_modificado_invalida_propuesta_sin_afectar_otros_hilos(entorno):
    al, _, c, _ = entorno
    mensaje(al, 'inv-a', 'h-mapt')
    ruta = preparar(al, 'inv-a', 'inv-a', 'h-mapt', actual='h-mapt')
    mensaje(al, 'inv-a', 'h-mapt', 'Mensaje desde otra pestaña')
    assert confirmar(c, ruta).json()['estado'] == 'no_aplicada'
    assert len(conversacion(al.estado, 'inv-a')['preguntasABases']) == 3
    ruta = preparar(al, 'inv-a', 'inv-a', 'h-mapt', actual='h-mapt')
    mensaje(al, 'inv-a', 'h-otro', 'Otro hilo no invalida la propuesta')
    assert confirmar(c, ruta).json()['estado'] == 'ejecutada'


@pytest.mark.parametrize('estado,continuacion', [('en_curso', None), ('ejecutada', 'en_curso'), ('ejecutada', 'pendiente')])
def test_no_descarta_operaciones_cuyo_resultado_se_esta_guardando(entorno, estado, continuacion):
    al, _, c, _ = entorno
    mensaje(al, 'inv-a', 'h-mapt', acciones=[{'id': 'op-ocupada', 'estado': estado, 'continuacion': continuacion}])
    ruta = preparar(al, 'inv-a', 'inv-a', 'h-mapt')
    antes = copy.deepcopy(al.estado)
    version = al.version
    r = confirmar(c, ruta)
    assert r.status_code == 400
    assert 'operación en curso' in r.json()['detail']
    # La recarga tras un rechazo puede añadir valores por defecto de migración.
    # Todos los datos existentes, incluida la operación en curso, se conservan.
    for tabla in ('investigaciones', 'corridas'):
        assert len(al.estado[tabla]) == len(antes[tabla])
        for anterior, nueva in zip(antes[tabla], al.estado[tabla]):
            assert all(nueva[k] == v for k, v in anterior.items())
    assert al.version == version


def test_una_operacion_interrumpida_no_bloquea_el_borrado_para_siempre(entorno):
    al, _, c, _ = entorno
    mensaje(al, 'inv-a', 'h-mapt', acciones=[{'id': 'op-anterior', 'estado': 'resultado_desconocido'}])
    ruta = preparar(al, 'inv-a', 'inv-a', 'h-mapt', actual='h-mapt')
    assert confirmar(c, ruta).json()['estado'] == 'ejecutada'


def test_api_directa_exige_sesion_y_csrf_y_el_historial_no_resucita(entorno):
    al, _, c, _ = entorno
    mensaje(al, 'global', 'h-mapt')
    args = {'investigacion_id': 'global', 'hilo': 'h-mapt', 'quien': 'inventado'}
    assert c.post('/api/acciones/eliminarConversacion', json=args).status_code == 403
    r = c.post('/api/acciones/eliminarConversacion', json=args, headers={'X-Rosa': '1'})
    assert r.status_code == 200 and r.json()['resultado']['eliminada']
    assert not al.aplicar('registrarPreguntaBases', {'investigacion_id': 'global', 'pregunta': {'hilo': 'h-mapt', 'pregunta': 'Tardía'}})
    assert conversacion(al.estado, 'global')['preguntasABases'] == []
    c.cookies.clear()
    assert c.post('/api/acciones/eliminarConversacion', json=args, headers={'X-Rosa': '1'}).status_code == 401


def test_hilos_anteriores_sin_id_y_destino_de_otra_investigacion(entorno):
    al, _, c, _ = entorno
    q = mensaje(al, 'inv-a')
    mensaje(al, 'global', q['id'], 'Mismo identificador en otro ámbito')
    ruta = preparar(al, 'global', 'inv-a', q['id'])
    assert confirmar(c, ruta).json()['ok']
    assert conversacion(al.estado, 'inv-a')['preguntasABases'] == []
    assert len(conversacion(al.estado, 'global')['preguntasABases']) == 2


def test_descubrimiento_global_identifica_actual_y_no_inventa_destinos(entorno):
    al, _, _, _ = entorno
    mensaje(al, 'inv-a', 'h-investigacion')
    mensaje(al, 'global', 'h-global')
    token = SV.CONTEXTO.set(SimpleNamespace(hilo='h-nuevo'))
    try:
        herramientas = {t.name: t.func for t in AS.herramientas(al, 'global', [])}
        lista = TS.extraer(herramientas['listar_conversaciones']('todas'))
        assert lista['hiloActual'] == 'h-nuevo' and lista['investigacionActual'] == 'global'
        assert lista['total'] == 2
        for inv, hilo in [('no-existe', 'h-global'), ('inv-a', 'h-nuevo'), ('global', 'inventado')]:
            with pytest.raises(ValueError):
                herramientas['preparar_accion']('eliminarConversacion', {'investigacion_id': inv, 'hilo': hilo}, 'Borrar')
    finally:
        SV.CONTEXTO.reset(token)


@pytest.mark.parametrize('inv', ['inv-a', 'global'])
@pytest.mark.parametrize('etapa', ['modelo', 'herramienta'])
def test_borrado_detiene_respuestas_en_vuelo_y_rechaza_resucitar_hilo(entorno, monkeypatch, inv, etapa):
    al, app, _, _ = entorno
    mensaje(al, inv, 'h-lento')
    ruta = preparar(al, inv, inv, 'h-lento')

    async def escenario():
        empezo, liberada = asyncio.Event(), asyncio.Event()
        async def bloquear():
            empezo.set()
            try:
                await asyncio.Event().wait()
            finally:
                liberada.set()
        async def modelos(_):
            if etapa == 'modelo':
                await bloquear()
            return SimpleNamespace(cerebro=None)
        async def preguntar(*args, **kwargs):
            await bloquear()
            pytest.fail('El hilo eliminado no puede continuar respondiendo')
        monkeypatch.setattr(AO, 'modelos_del_asistente', modelos)
        monkeypatch.setattr(AS, 'preguntar', preguntar)
        async with cliente(app) as c:
            cuerpo = {'pregunta': 'Revisa MAPT', 'asistente': True, 'hilo': 'h-lento', 'seguimiento': 'seg-borrado'}
            pendiente = asyncio.create_task(c.post(f'/api/investigaciones/{inv}/preguntar', json=cuerpo))
            await asyncio.wait_for(empezo.wait(), 5)
            r = await c.post(ruta, json={'aprobar': True})
            assert r.status_code == 200, r.text
            assert r.json()['estado'] == 'ejecutada'
            tarde = (await asyncio.wait_for(pendiente, 2)).json()
            assert tarde['resultado'] == {'conversacionEliminada': True, 'cancelada': True}
            assert liberada.is_set()
            assert not any(q.get('hilo') == 'h-lento' for q in conversacion(al.estado, inv)['preguntasABases'])
            cuerpo['seguimiento'] = 'seg-desde-pestana-vieja'
            assert (await c.post(f'/api/investigaciones/{inv}/preguntar', json=cuerpo)).status_code == 409
    asyncio.run(escenario())
