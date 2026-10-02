"""Detener el chat cancela su tarea, también durante la carga o en la cola."""
import asyncio
from types import SimpleNamespace

import dspy
import httpx
import pytest
from dspy.utils.dummies import DummyLM

from rosa import asistente as AS
from rosa import asistente_operaciones as AO
from rosa import razonamiento as RZ
from rosa.asistente_conversaciones import conversacion
from rosa.tests import test_asistente_servicios as TS


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    yield from TS.entorno.__wrapped__(tmp_path, monkeypatch)


def cliente(app, sesion='sesion'):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://127.0.0.1', cookies={'rosa_sesion': sesion}, headers={'X-Rosa': '1'})


def cuerpo(seguimiento='seg-prueba-cancelar'):
    return {'pregunta': 'Consulta MAPT', 'asistente': True, 'hilo': 'h-prueba', 'seguimiento': seguimiento}


async def respuesta(*args, **kwargs):
    return {'respuesta': 'Una respuesta completa', 'consultas': [], 'herramientas': [], 'iteraciones': 1, 'limites': ''}


@pytest.mark.parametrize('etapa', ['modelo', 'cola', 'herramienta'])
@pytest.mark.parametrize('inv', ['inv-a', 'global'])
def test_detener_en_cualquier_etapa_y_volver_a_preguntar(entorno, monkeypatch, etapa, inv):
    al, app, _, _ = entorno
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
            if etapa == 'cola':
                empezo.set()
            return SimpleNamespace(cerebro=None)
        async def preguntar(*args, **kwargs):
            progreso = dspy.settings.callbacks[-1]
            progreso.on_tool_start('tool', SimpleNamespace(name='buscar'), {'consulta': 'MAPT'})
            await bloquear()
            pytest.fail('No puede continuar ni proponer acciones tras detenerla')
        monkeypatch.setattr(AO, 'modelos_del_asistente', modelos)
        monkeypatch.setattr(AS, 'preguntar', preguntar)
        if etapa == 'cola':
            app.state.semaforo_preguntas = asyncio.Semaphore(0)
        ruta = f'/api/investigaciones/{inv}/preguntar'
        async with cliente(app) as c, cliente(app, 'admin') as ajeno:
            tarea = asyncio.create_task(c.post(ruta, json=cuerpo()))
            await asyncio.wait_for(empezo.wait(), 10)
            # Ni otro autor ni otra conversación pueden detener esta tarea.
            assert (await ajeno.post(ruta + '/seg-prueba-cancelar/cancelar')).status_code == 404
            otra = 'global' if inv == 'inv-a' else 'inv-a'
            assert (await c.post(f'/api/investigaciones/{otra}/preguntar/seg-prueba-cancelar/cancelar')).status_code == 404
            assert (await c.post(ruta, json=cuerpo())).status_code == 409
            r = await c.post(ruta + '/seg-prueba-cancelar/cancelar')
            assert r.status_code == 200 and r.json()['estado'] in ('cancelando', 'cancelada')
            assert (await c.post(ruta + '/seg-prueba-cancelar/cancelar')).status_code == 200
            terminado = (await asyncio.wait_for(tarea, 2)).json()
            assert terminado['ok'] and terminado['resultado']['cancelada']
            assert terminado['resultado']['error'] is None
            if etapa != 'cola':
                assert liberada.is_set()
            guardadas = conversacion(al.estado, inv)['preguntasABases']
            assert len(guardadas) == 1 and guardadas[0]['cancelada']
            assert not guardadas[0].get('acciones')
            assert guardadas[0]['seguimiento'] == cuerpo()['seguimiento']
            p = RZ.leer(cuerpo()['seguimiento'])
            assert p['terminado'] and all(x.get('fin') for x in p['pasos'] if x['tipo'] == 'herramienta')
            # Una corrida iniciada previamente sigue existiendo.
            assert len(al.estado['corridas']) == 1
            app.state.semaforo_preguntas = asyncio.Semaphore(2)
            async def disponibles(_):
                return SimpleNamespace(cerebro=None)
            monkeypatch.setattr(AO, 'modelos_del_asistente', disponibles)
            monkeypatch.setattr(AS, 'preguntar', respuesta)
            siguiente = await c.post(ruta, json=cuerpo('seg-siguiente-pregunta'))
            assert siguiente.json()['resultado']['respuesta'] == 'Una respuesta completa'
            final = await c.post(ruta + '/seg-siguiente-pregunta/cancelar')
            assert final.json()['estado'] == 'terminada'
            assert len(conversacion(al.estado, inv)['preguntasABases']) == 2
    asyncio.run(escenario())


def test_detener_antes_de_recibir_la_pregunta_no_carga_modelos(entorno):
    al, _, c, _ = entorno
    ruta = '/api/investigaciones/global/preguntar'
    assert c.post(ruta + '/seg-antes-de-empezar/cancelar', headers={'X-Rosa': '1'}).status_code == 200
    r = c.post(ruta, headers={'X-Rosa': '1'}, json=cuerpo('seg-antes-de-empezar'))
    assert r.status_code == 200 and r.json()['resultado']['cancelada']
    assert len(conversacion(al.estado, 'global')['preguntasABases']) == 1
    assert c.post(ruta + '/invalido!/cancelar', headers={'X-Rosa': '1'}).status_code == 400
    assert c.post(ruta + '/seg-prueba-cancelar/cancelar').status_code == 403


def test_cancelacion_se_propaga_al_bucle_real_de_dspy():
    async def escenario():
        empezo, liberada = asyncio.Event(), asyncio.Event()
        async def consultar() -> str:
            """Consulta lenta de prueba."""
            empezo.set()
            try:
                await asyncio.Event().wait()
            finally:
                liberada.set()
            return 'dato'
        lm = DummyLM([{'next_thought': 'Consultar', 'next_tool_name': 'consultar', 'next_tool_args': {}}, {'respuesta': 'No debe escribirse'}])
        progreso = RZ.Progreso()
        with dspy.context(lm=lm, callbacks=[progreso]):
            tarea = asyncio.create_task(dspy.ReAct('pregunta -> respuesta', tools=[consultar]).acall(pregunta='MAPT'))
            await asyncio.wait_for(empezo.wait(), 10)
            tarea.cancel()
            with pytest.raises(asyncio.CancelledError):
                await tarea
        progreso.cerrar()
        assert liberada.is_set() and len(lm.history) == 1
        antes = progreso.pasos()
        progreso.on_module_end('tarde', SimpleNamespace(next_thought='Tardío'))
        progreso.on_tool_start('tarde', SimpleNamespace(name='otra'), {})
        assert progreso.pasos() == antes
    asyncio.run(escenario())
