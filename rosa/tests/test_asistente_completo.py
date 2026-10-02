"""Regresiones de acceso completo, historial y continuidad del asistente."""
import asyncio
import json
import sqlite3
from types import SimpleNamespace

import dspy
import fitz
import pytest

from rosa import asistente as AS
from rosa import asistente_operaciones as AO
from rosa import asistente_servicios as SV
from rosa.asistente_conversaciones import conversacion, recuperar_interrumpidas
from rosa.asistente_lecturas import documentos, filas_dataset, trazas_gepa, vista_compartida
from rosa.servidor import _turnos_previos
from rosa.tests import test_asistente_servicios as TS

extraer = TS.extraer


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    yield from TS.entorno.__wrapped__(tmp_path, monkeypatch)


def test_llamadas_mas_de_200_y_cursor_estable(entorno):
    al, _, _, _ = entorno
    for n in range(251):
        al.registrar_llamada('modelo', 'cerebro', 'cor-a', n, 1, 2, 3, True)
    primera = al.pagina_llamadas('cor-a', limite=100)
    al.registrar_llamada('nuevo', 'cerebro', 'cor-a', 999, 1, 2, 3, True)
    filas = primera['llamadas']
    cursor = primera['siguiente']
    while cursor is not None:
        p = al.pagina_llamadas('cor-a', desde=cursor, limite=100, hasta=primera['hasta'])
        filas += p['llamadas']
        cursor = p['siguiente']
    assert len(filas) == len({f['secuencia'] for f in filas}) == 251
    assert {f['iteracion'] for f in filas} == set(range(251))


def test_dataset_completo_filtro_y_columnas(tmp_path):
    ruta = tmp_path / 'tabla.csv'
    ruta.write_text('id,grupo,valor\n' + ''.join(f'{n},{n%2},{n*10}\n' for n in range(301)))
    p = filas_dataset(ruta, 100, 50, ['id'], {'grupo': '1'})
    assert p['totalFilas'] == 301 and p['totalFiltrado'] == 150
    assert p['filas'][0] == {'indice': 201, 'valores': {'id': '201'}}
    assert p['siguiente'] is None
    assert 'error' in filas_dataset(ruta, 0, 20, ['inexistente'], {})


def test_gepa_trazas_paginadas_y_evaluaciones(entorno):
    al, _, _, _ = entorno
    ruta = al.ruta.parent / 'datos' / '_gepa' / al.ruta.name / 'trazas.db'
    ruta.parent.mkdir(parents=True)
    with sqlite3.connect(ruta) as db:
        db.executescript('CREATE TABLE trazas(seq INTEGER PRIMARY KEY,fecha REAL,tipo TEXT,programa TEXT,corrida TEXT,json TEXT); CREATE TABLE ciclos(id TEXT,fecha REAL,json TEXT);')
        db.executemany('INSERT INTO trazas VALUES(?,?,?,?,?,?)', [(n, n, 'evaluacion', 'juez', 'cor-a', json.dumps({'detalle': f'caso {n}'})) for n in range(60)])
        db.execute('INSERT INTO ciclos VALUES(?,?,?)', ('c', 1, '{"evaluacion":{"puntuacion":0.8}}'))
    p = trazas_gepa(al, 50, 10, 'evaluacion', 'juez')
    assert p['total'] == 60 and p['siguiente'] is None
    assert p['trazas'][0]['contenido']['detalle'] == 'caso 50'
    assert p['ciclos'][0]['evaluacion']['puntuacion'] == .8
    assert trazas_gepa(al, tipo="' OR 1=1")['total'] == 0


def test_documentacion_ampliada_y_sin_rutas_libres():
    docs = documentos()
    assert 'PENDIENTE.md' in docs and len(docs) > 9
    assert '.env' not in docs and '../AGENTS.md' not in docs
    assert all(p.is_file() and not p.is_symlink() for p in docs.values())


def test_error_de_servicio_no_se_enmascara_por_camino():
    error = {'ok': False, 'error': 'No pude comprobar', 'estadoHttp': 503}
    assert extraer(SV.paginar(error, camino='resumen')) == error


def test_fuentes_ambiguas_exigen_corrida(entorno):
    al, _, _, _ = entorno
    def preparar(e):
        e['corridas'] = [{'id': 'c1', 'investigacionId': 'inv-a', 'busqueda': {'fuentes': [{'id': 'f1', 'titulo': 'uno'}]}},
                         {'id': 'c2', 'investigacionId': 'inv-a', 'busqueda': {'fuentes': [{'id': 'f1', 'titulo': 'dos'}]}}]
    al.mutar(preparar)
    tool = next(t for t in AS.herramientas(al, 'inv-a', []) if t.name == 'leer_registro')
    assert 'ambiguo' in tool.func('fuentes', 'f1')
    assert extraer(tool.func('fuentes', 'f1', corrida='c2'))['titulo'] == 'dos'


def test_historial_completo_supera_tres_turnos():
    inv = {'preguntasABases': [{'id': str(n), 'fecha': n, 'hilo': 'h', 'pregunta': 'P' * 700 + f'pregunta-{n}', 'respuesta': 'R' * 1500 + f'final-{n}'} for n in range(6)]}
    contexto = _turnos_previos(inv, 'h')
    assert all(f'final-{n}' in contexto and f'pregunta-{n}' in contexto for n in range(6))
    assert _turnos_previos(inv, 'otro') == ''


def test_global_pregunta_larga_sin_cuota_de_40(entorno, monkeypatch):
    al, app, cliente, _ = entorno
    al.mutar(lambda e: e.update(investigaciones=[], corridas=[]))
    app.state.modelos = SimpleNamespace(cerebro=None)
    vistas = []
    async def responder(*args, **kwargs):
        vistas.append(args[3])
        return {'respuesta': 'ROSA responde', 'acciones': [], 'consultas': []}
    monkeypatch.setattr(AS, 'preguntar', responder)
    pregunta = 'x' * 5000 + ' condición final'
    for _ in range(42):
        r = cliente.post('/api/investigaciones/global/preguntar', headers={'X-Rosa': '1'}, json={'pregunta': pregunta, 'hilo': 'h', 'asistente': True})
        assert r.status_code == 200 and r.json()['ok']
    assert vistas == [pregunta] * 42
    assert al.estado['investigaciones'] == []
    assert len(al.instantanea()['asistenteGlobal']['preguntasABases']) == 42
    assert al.estado['asistenteGlobal']['preguntasABases'][-1]['pregunta'] == pregunta


def test_pdf_pagina_exacta_y_figura(entorno, monkeypatch):
    _, _, _, crear = entorno
    sv = crear()
    pdf = fitz.open()
    for texto in ['primera', 'segunda']:
        page = pdf.new_page()
        page.insert_text((50, 50), texto)
    blob = pdf.tobytes()
    async def consultar(nombre, parametros, *args):
        ruta = SV.construir_ruta(SV.LECTURAS[nombre][0], parametros)
        sv.archivos[ruta] = blob
        return ''
    monkeypatch.setattr(sv, 'consultar', consultar)
    class Vision:
        async def acall(self, **kw):
            assert isinstance(kw['imagen'], dspy.Image)
            assert 'png;base64' in kw['imagen'].url
            return SimpleNamespace(lectura='Segunda página visible')
    monkeypatch.setattr(dspy, 'Predict', lambda firma: Vision())
    args = {'corrida_id': 'c', 'afirmacion_id': 'a'}
    datos = extraer(asyncio.run(sv.leer_documento('pdf_cita', args, 2, pregunta_figura='Describe')))
    assert datos['pagina'] == 2 and datos['paginas'] == 2
    assert 'segunda' in datos['texto'] and 'primera' not in datos['texto']
    assert datos['interpretacionVisual'] == 'Segunda página visible'
    assert extraer(asyncio.run(sv.leer_documento('pdf_cita', args, 3)))['ok'] is False


def preparar_continuacion(al):
    def preparar(e):
        inv = conversacion(e, 'global', crear=True)
        inv['preguntasABases'] = [{'id': 'q', 'pregunta': 'Haz el cambio y explica', 'quien': 'persona@rosa.test', 'hilo': 'h', 'respuesta': 'Propuesta', 'acciones': [{'id': 'op', 'nombre': 'servicio:gepa', 'argumentos': {'accion_gepa': 'pausar'}, 'estado': 'ejecutada', 'resumen': 'Pausar GEPA', 'resultado': {'ok': True}}]}]
    al.mutar(preparar)


def test_continuacion_una_vez_y_no_repite_operacion(entorno, monkeypatch):
    al, app, _, crear = entorno
    preparar_continuacion(al)
    app.state.modelos = SimpleNamespace(cerebro=None)
    llamadas = []
    async def responder(*args, **kwargs):
        llamadas.append(args[3])
        return {'respuesta': 'Ahora GEPA está pausado', 'consultas': []}
    monkeypatch.setattr(AS, 'preguntar', responder)
    async def correr():
        return await asyncio.gather(*(AO.continuar(app, al, crear(), ('global', 'q', 'op'), 'persona@rosa.test') for _ in range(2)))
    asyncio.run(correr())
    assert len(llamadas) == 1
    inv = al.instantanea()['asistenteGlobal']
    assert len(inv['preguntasABases']) == 2
    assert inv['preguntasABases'][0]['acciones'][0]['continuacion'] == 'lista'
    assert inv['preguntasABases'][1]['hilo'] == 'h'
    with pytest.raises(ValueError):
        asyncio.run(AO.continuar(app, al, crear(), ('global', 'q', 'op'), 'otra@rosa.test'))


def test_recuperar_interrupcion_y_comprobar_sin_repetir(entorno):
    al, _, _, crear = entorno
    preparar_continuacion(al)
    def interrumpir(e):
        op = e['asistenteGlobal']['preguntasABases'][0]['acciones'][0]
        op.update(estado='en_curso', continuacion='en_curso')
        e['gepaAutomatico'] = {'estado': 'pausado'}
        return recuperar_interrumpidas(e)
    assert al.mutar(interrumpir)
    r = asyncio.run(AO.comprobar(al, crear(), ('global', 'q', 'op'), 'persona@rosa.test'))
    assert r['estado'] == 'resultado_desconocido'
    assert r['resultado']['estadoActualCoincide'] is True
    op = al.estado['asistenteGlobal']['preguntasABases'][0]['acciones'][0]
    assert op['continuacion'] == 'pendiente' and op['comprobadaEn'] > 0


def test_vistas_ejecutan_calculo_compartido(entorno):
    from rosa.asistente_lecturas import RAIZ
    if not (RAIZ / 'frontend/dist/servicios-vistas.cjs').is_file():
        pytest.skip('Integración con Node: requiere npm run build:vistas en frontend')
    al, _, _, _ = entorno
    for vista in ['atlas', 'mecanismos']:
        r = vista_compartida(al.instantanea(), 'inv-a', vista, {})
        assert r['ok'] and 'compartid' in r['fuente']
    assert vista_compartida(al.instantanea(), 'desconocida', 'atlas', {})['ok'] is False


@pytest.mark.asyncio
async def test_confirmacion_http_continua_automaticamente(entorno, monkeypatch):
    import httpx
    al, app, _, crear = entorno
    app.state.modelos = SimpleNamespace(cerebro=None)
    terminado = asyncio.Event()
    async def responder(*args, **kwargs):
        assert 'No repitas la operación' in args[3]
        terminado.set()
        return {'respuesta': 'Guardé la memoria solicitada.', 'consultas': []}
    monkeypatch.setattr(AS, 'preguntar', responder)
    url = TS.guardar(al, crear(), 'anadirMemoria', {'investigacion_id': 'inv-a', 'texto': 'Preferencia de prueba'})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1', cookies={'rosa_sesion': 'sesion'}) as cliente:
        r = await cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
        assert r.status_code == 200 and r.json()['estado'] == 'ejecutada'
        await asyncio.wait_for(terminado.wait(), 5)
        for _ in range(100):
            inv = al.instantanea()['investigaciones'][0]
            if len(inv['preguntasABases']) == 2:
                break
            await asyncio.sleep(.01)
        assert len(inv['preguntasABases']) == 2
        assert len(inv['memoria']) == 1
        repetida = await cliente.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
        assert repetida.json()['repetida']
        assert len(al.instantanea()['investigaciones'][0]['memoria']) == 1


def test_continuacion_fallida_se_reintenta_sin_efecto(entorno, monkeypatch):
    al, app, _, crear = entorno
    preparar_continuacion(al)
    app.state.modelos = SimpleNamespace(cerebro=None)
    async def fallo(*args, **kwargs):
        raise RuntimeError('Modelo indisponible')
    monkeypatch.setattr(AS, 'preguntar', fallo)
    ids = ('global', 'q', 'op')
    assert not asyncio.run(AO.continuar(app, al, crear(), ids, 'persona@rosa.test'))['ok']
    assert al.estado['asistenteGlobal']['preguntasABases'][0]['acciones'][0]['estado'] == 'ejecutada'
    async def funciona(*args, **kwargs):
        return {'respuesta': 'Ahora sí puedo explicar el resultado', 'consultas': []}
    monkeypatch.setattr(AS, 'preguntar', funciona)
    assert asyncio.run(AO.continuar(app, al, crear(), ids, 'persona@rosa.test'))['ok']
    assert len(al.estado['asistenteGlobal']['preguntasABases']) == 2


def test_global_crea_investigacion_sin_objeto_ficticio(entorno):
    al, _, _, _ = entorno
    al.mutar(lambda e: e.update(investigaciones=[], corridas=[]))
    ops = []
    preparar = next(t for t in AS.herramientas(al, 'global', ops) if t.name == 'preparar_accion')
    preparar.func('crearInvestigacion', {'datos': {'titulo': 'MAPT', 'objetivo': 'Revisar tau', 'condicionParada': '2 iteraciones'}}, 'Crear investigación')
    al.aplicar('registrarPreguntaBases', {'investigacion_id': 'global', 'pregunta': {'pregunta': 'Crea la investigación', 'quien': 'persona', 'acciones': ops}})
    q = al.estado['asistenteGlobal']['preguntasABases'][0]
    resultado = al.aplicar('resolverAccionAsistente', {'investigacion_id': 'global', 'pregunta_id': q['id'], 'operacion_id': ops[0]['id'], 'aprobar': True, 'quien': 'persona'})
    assert resultado['ok']
    assert len(al.estado['investigaciones']) == 1 and al.estado['investigaciones'][0]['id'] != 'global'


def test_vista_sin_compilar_informa_limite(monkeypatch, tmp_path):
    from rosa import asistente_lecturas as L
    monkeypatch.setattr(L, 'RAIZ', tmp_path)
    r = L.vista_compartida({}, 'inv-a', 'atlas', {})
    assert r['ok'] is False and 'compilar' in r['error']
