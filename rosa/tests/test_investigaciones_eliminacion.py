"""Borrado acotado, confirmado y resistente a respuestas o índices tardíos."""
import asyncio
import copy
import json
from types import SimpleNamespace

import numpy as np
import pytest

from rosa import asistente as AS, asistente_operaciones as AO
from rosa import investigaciones_eliminacion as IE
from rosa import indice_semantico as IS
from rosa.asistente_conversaciones import conversacion
from rosa.estado import plantilla as P
from rosa.tests import test_asistente_servicios as TS
from rosa.tests.test_asistente_cancelacion import cliente
from rosa.tests.test_conversaciones_eliminacion import mensaje, confirmar


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    yield from TS.entorno.__wrapped__(tmp_path, monkeypatch)


def detener(al):
    al.aplicar('detenerCorrida', {'corrida_id': al.estado['corridas'][0]['id'], 'motivo': 'Fin de la prueba'})


def preparar(al, desde='global'):
    ops = []
    herramientas = {t.name: t.func for t in AS.herramientas(al, desde, ops)}
    herramientas['preparar_accion']('eliminarInvestigacion', {'investigacion_id': 'inv-a'}, 'Borrar MAPT')
    q = mensaje(al, desde, 'h-borrar', 'Borra la investigación MAPT', acciones=ops)
    return f'/api/investigaciones/{desde}/asistente/{q["id"]}/{ops[0]["id"]}'


def poblado():
    e = P.estado_inicial()
    e['investigaciones'] = [{'id': 'inv-a', 'titulo': 'MAPT', 'datasets': [], 'preguntasABases': []}, {'id': 'inv-b', 'titulo': 'GFAP', 'datasets': []}]
    for inv, s in [('inv-a', 'a'), ('inv-b', 'b')]:
        e['corridas'].append({'id': f'cor-{s}', 'investigacionId': inv, 'estado': 'terminada', '_afirmaciones': [{'id': f'af-{s}', 'texto': 'Evidencia'}]})
        e['iteraciones'].append({'id': f'it-{s}', 'corridaId': f'cor-{s}'})
        e['incidencias'].append({'id': f'inc-{s}', 'corridaId': f'cor-{s}'})
        e['solicitudes'].append({'id': f'sol-{s}', 'corridaId': f'cor-{s}'})
        e['hipotesis'].append({'id': f'hip-{s}', 'investigacionId': inv})
        e['comentarios'].append({'id': f'com-{s}', 'hipotesisId': f'hip-{s}'})
        e['conjuntoDorado'].append({'id': f'oro-{s}', 'hipotesisId': f'hip-{s}'})
        for tabla in ('hechos', 'cuestiones', 'tareas', 'lecciones', 'artefactos', 'decisiones', 'planesAnalisis', 'ejecuciones', 'reproducciones', 'aprendizaje', 'permisos', 'eventos'):
            e[tabla].append({'id': f'{tabla}-{s}', 'investigacionId': inv})
    return e


def test_cascada_retiro_exclusivo_preserva_todo_lo_ajeno():
    e = poblado()
    e['permisos'].append({'id': 'permiso-global', 'investigacionId': None})
    antes = copy.deepcopy(e)
    vista = IE.prever(e, 'inv-a')
    assert vista['puedeEliminar'], vista['bloqueos']
    assert vista['registros']['iteraciones'] == 1 and vista['registros']['comentarios'] == 1
    assert e == antes  # La vista previa no modifica ni siquiera listas compartidas.
    r = IE.eliminar(e, 'inv-a', 'persona', 123)
    assert r['eliminada'] and e['investigacionesEliminadas'] == ['inv-a']
    assert e['investigaciones'] == [antes['investigaciones'][1]]
    for tabla in vista['registros']:
        assert all(x.get('investigacionId') != 'inv-a' for x in e[tabla])
        assert all(x['id'].endswith('-b') or x['id'] == 'permiso-global' for x in e[tabla])
    assert e['relaciones'] == antes['relaciones']
    assert e['metodos'] == antes['metodos']
    assert IE.eliminar(e, 'inv-a', 'persona', 124)['repetida']


@pytest.mark.parametrize('referencia', ['rama', 'afirmacion', 'origen', 'hipotesis', 'plan'])
def test_no_rompe_la_evidencia_de_otra_investigacion(referencia):
    e = poblado()
    if referencia == 'rama':
        e['investigaciones'][1]['ramaDe'] = 'inv-a'
    elif referencia == 'afirmacion':
        e['hechos'][1]['afirmacionIds'] = ['af-a']
    elif referencia == 'origen':
        e['cuestiones'][1]['origen'] = {'id': 'hip-a', 'tipo': 'killer'}
    elif referencia == 'hipotesis':
        e['hechos'][1]['procedencia'] = [{'hipotesisId': 'hip-a'}]
    else:
        e['planesAnalisis'][1]['planPadre'] = 'planesAnalisis-a'
    antes = copy.deepcopy(e)
    assert not IE.prever(e, 'inv-a')['puedeEliminar']
    with pytest.raises(ValueError, match='dependencia'):
        IE.eliminar(e, 'inv-a', 'persona', 1)
    assert e == antes


def test_fuente_copiada_y_datasets_compartidos_se_conservan():
    e = poblado()
    e['corridas'][1]['_afirmaciones'].append(copy.deepcopy(e['corridas'][0]['_afirmaciones'][0]))
    e['hechos'][1]['afirmacionIds'] = ['af-a']
    e['datasetsPrograma'] = [
        {'id': 'ds-compartido', 'fuente': 'manual', 'usadoEn': ['inv-a', 'inv-b'], 'fichero': 'conservar.csv'},
        {'id': 'ds-ajeno', 'fuente': 'manual', 'usadoEn': []},
        {'id': 'ds-propio', 'fuente': 'manual', 'usadoEn': ['inv-a']},
        {'id': 'geo', 'fuente': 'geo', 'usadoEn': ['inv-a']},
    ]
    IE.eliminar(e, 'inv-a', 'persona', 1)
    assert e['datasetsPrograma'] == [
        {'id': 'ds-compartido', 'fuente': 'manual', 'usadoEn': ['inv-b'], 'fichero': 'conservar.csv'},
        {'id': 'ds-ajeno', 'fuente': 'manual', 'usadoEn': []},
        {'id': 'geo', 'fuente': 'geo', 'usadoEn': []},
    ]
    assert e['hechos'][0]['afirmacionIds'] == ['af-a']


@pytest.mark.parametrize('desde', ['inv-a', 'global'])
def test_catalogo_confirmacion_autoria_reintento_y_conversacion_actual(entorno, desde):
    al, _, c, _ = entorno
    detener(al)
    herramientas = {t.name: t.func for t in AS.herramientas(al, desde, [])}
    assert 'eliminarInvestigacion' in json.loads(herramientas['catalogo_acciones']())['acciones']
    assert TS.extraer(herramientas['prever_eliminacion_investigacion']('inv-a'))['puedeEliminar']
    ruta = preparar(al, desde)
    assert len(al.estado['investigaciones']) == 1
    c.cookies.set('rosa_sesion', 'admin')
    assert confirmar(c, ruta).status_code == 400
    c.cookies.set('rosa_sesion', 'sesion')
    r = confirmar(c, ruta)
    assert r.status_code == 200, r.text
    assert r.json()['estado'] == 'ejecutada'
    assert al.estado['investigaciones'] == [] and al.estado['corridas'] == []
    assert confirmar(c, ruta).json()['repetida']
    assert not al.aplicar('registrarPreguntaBases', {'investigacion_id': 'inv-a', 'pregunta': {'pregunta': 'Respuesta tardía'}})
    if desde == 'global':
        op = conversacion(al.estado, 'global')['preguntasABases'][-1]['acciones'][0]
        assert not op.get('continuacion')


def test_cancelar_y_cambio_de_alcance_no_borran(entorno):
    al, _, c, _ = entorno
    detener(al)
    assert confirmar(c, preparar(al), False).json()['estado'] == 'cancelada'
    ruta = preparar(al)
    mensaje(al, 'inv-a', 'h-nuevo', 'Esto se añadió después de la vista previa')
    assert confirmar(c, ruta).json()['estado'] == 'no_aplicada'
    assert len(al.estado['investigaciones']) == 1


def test_vista_previa_comprueba_dependencias_privadas_sin_exponer_su_texto(entorno):
    al, _, _, _ = entorno
    detener(al)
    def poblar(e):
        e['corridas'][0]['_afirmaciones'] = [{'id': 'af-privada', 'texto': 'CONTENIDO PRIVADO'}]
        e['hechos'].append({'id': 'hecho-compartido', 'investigacionId': 'inv-otra', 'afirmacionIds': ['af-privada']})
    al.mutar(poblar)
    herramientas = {t.name: t.func for t in AS.herramientas(al, 'global', [])}
    vista = herramientas['prever_eliminacion_investigacion']('inv-a')
    assert not TS.extraer(vista)['puedeEliminar']
    assert 'af-privada' in vista and 'CONTENIDO PRIVADO' not in vista
    with pytest.raises(ValueError, match='dependencia'):
        preparar(al)


def test_no_prepara_corridas_activas_ni_el_asistente_global(entorno):
    al, _, c, _ = entorno
    with pytest.raises(ValueError, match='Detén'):
        preparar(al)
    for ident in ('global', 'inexistente'):
        with pytest.raises(ValueError, match='No se encontró'):
            IE.eliminar(al.estado, ident, 'persona', 1)
    assert c.post('/api/acciones/eliminarInvestigacion', json={'investigacion_id': 'inv-a'}).status_code == 403


def test_corrida_detenida_aun_terminando_no_se_borra(entorno):
    al, app, c, _ = entorno
    detener(al)
    ruta = preparar(al)
    app.state.supervisor = SimpleNamespace(tareas={al.estado['corridas'][0]['id']: SimpleNamespace(done=lambda: False)})
    assert confirmar(c, ruta).status_code == 409
    assert al.estado['investigaciones']
    app.state.supervisor.tareas.clear()
    assert confirmar(c, ruta).json()['estado'] == 'ejecutada'


def test_borrar_cancela_la_respuesta_en_vuelo(entorno, monkeypatch):
    al, app, _, _ = entorno
    detener(al)
    ruta = preparar(al)
    async def escenario():
        empezo = asyncio.Event()
        async def modelos(_):
            return SimpleNamespace(cerebro=None)
        async def responder(*args, **kwargs):
            empezo.set()
            await asyncio.Event().wait()
        monkeypatch.setattr(AO, 'modelos_del_asistente', modelos)
        monkeypatch.setattr(AS, 'preguntar', responder)
        async with cliente(app) as c:
            tarea = asyncio.create_task(c.post('/api/investigaciones/inv-a/preguntar', json={'pregunta': 'Consulta MAPT', 'asistente': True, 'hilo': 'h-lento', 'seguimiento': 'seg-investigacion'}))
            await asyncio.wait_for(empezo.wait(), 5)
            assert (await c.post(ruta, json={'aprobar': True})).json()['estado'] == 'ejecutada'
            r = await asyncio.wait_for(tarea, 2)
            assert r.json()['resultado'] == {'investigacionEliminada': True, 'cancelada': True}
            assert not al.estado['investigaciones']
    asyncio.run(escenario())


def test_indice_no_devuelve_una_investigacion_borrada_ni_oculta_las_demas(tmp_path):
    al = SimpleNamespace(ruta=tmp_path/'indice.db', estado={})
    indice = IS.de_almacen(al)
    try:
        for ident in ('inv-a', 'inv-b'):
            indice.db.execute('INSERT INTO vectores VALUES (?,?,?,?,?,?,?,?,?)', (ident, 'hecho', ident, 'hash', 'MAPT', np.array([1., 0.], dtype=np.float32).tobytes(), 2, IS.MODELO, 1))
        indice.db.commit()
        assert indice.parecidos([1., 0.], k=1)[0]['investigacionId'] == 'inv-a'
        al.estado['investigacionesEliminadas'] = ['inv-a']
        assert indice.parecidos([1., 0.], k=1)[0]['investigacionId'] == 'inv-b'
        assert indice.parecidos([1., 0.], investigacion_id='inv-a') == []
    finally:
        indice.cerrar()
        IS._INDICES.pop(str(al.ruta.resolve()), None)


def test_indexacion_tardia_no_reintroduce_la_investigacion(tmp_path, monkeypatch):
    indice = IS.Indice(tmp_path / 'indice.db')
    eliminadas = set()
    indice.investigaciones_eliminadas = lambda: eliminadas
    monkeypatch.setattr(IS, 'disponible', lambda: True)
    async def incrustar(textos):
        eliminadas.add('inv-a')  # Se borra mientras el Gateway calcula los vectores.
        return [[1., 0.] for _ in textos], 2
    monkeypatch.setattr(IS, 'incrustar', incrustar)
    try:
        n = asyncio.run(indice.indexar([{'id': i, 'investigacionId': i, 'tipo': 'hecho', 'texto': 'MAPT'} for i in ('inv-a', 'inv-b')]))
        assert n == 1
        assert [r['investigacionId'] for r in indice.parecidos([1., 0.])] == ['inv-b']
        assert indice.db.execute('SELECT COUNT(*) FROM vectores').fetchone()[0] == 1
    finally:
        indice.cerrar()
