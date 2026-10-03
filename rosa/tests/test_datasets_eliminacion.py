"""Borrado desde el asistente: autoría, datos compartidos y fallos de disco."""
import asyncio
import copy

import pytest

from rosa import asistente as AS
from rosa import asistente_operaciones as AO
from rosa import asistente_servicios as SV
from rosa import datos as D
from rosa import datasets_eliminacion as DE
from rosa.asistente_conversaciones import conversacion
from rosa.estado.almacen import Almacen
from rosa.tests import test_asistente_servicios as TS


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    async def sin_modelo(*args, **kwargs):
        return {'ok': True}
    monkeypatch.setattr(AO, 'continuar', sin_modelo)
    monkeypatch.setattr(D, 'DIR_DATASETS', tmp_path / 'datasets')
    for al, app, c, servicio in TS.entorno.__wrapped__(tmp_path, monkeypatch):
        al.mutar(lambda e: e['corridas'][0].update(estado='detenida') or True)
        yield al, app, c, servicio


def subir(c, inv='inv-a'):
    r = c.post(f'/api/investigaciones/{inv}/datasets', headers={'X-Rosa': '1'}, files={'fichero': ('prueba.csv', b'grupo,valor\nA,1\nB,2', 'text/csv')})
    assert r.status_code == 200, r.text
    return r.json()['datasetId']


def ruta(ds, inv='inv-a'):
    return f'/api/investigaciones/{inv}/datasets/{ds}'


def preparar(al, servicio, ds, conversacion_id='global'):
    ops = []
    token = SV.CONTEXTO.set(servicio)
    try:
        tools = {t.name: t.func for t in AS.herramientas(al, conversacion_id, ops)}
        assert 'eliminar_dataset' in tools['catalogo_acciones']('servicio:eliminar_dataset') or 'dataset_id' in tools['catalogo_acciones']('servicio:eliminar_dataset')
        tools['preparar_accion']('servicio:eliminar_dataset', {'investigacion_id': 'inv-a', 'dataset_id': ds}, 'Eliminar prueba.csv de ROSA y borrar su archivo')
    finally:
        SV.CONTEXTO.reset(token)
    al.aplicar('registrarPreguntaBases', {'investigacion_id': conversacion_id, 'pregunta': {'pregunta': 'Elimina ese dataset', 'quien': 'persona@rosa.test', 'acciones': ops}})
    q = conversacion(al.estado, conversacion_id)['preguntasABases'][-1]
    return f'/api/investigaciones/{conversacion_id}/asistente/{q["id"]}/{ops[0]["id"]}'


@pytest.mark.parametrize('conv', ['inv-a', 'global'])
def test_asistente_borra_solo_al_confirmar_y_una_vez(entorno, conv):
    al, _, c, servicio = entorno
    ds = subir(c)
    archivo = D.ruta_dataset('inv-a', ds, 'prueba.csv')
    registro_id = al.estado['investigaciones'][0]['datasets'][0]['registroProgramaId']
    url = preparar(al, servicio(), ds, conv)
    assert archivo.exists() and len(al.estado['investigaciones'][0]['datasets']) == 1
    assert 'eliminacion_dataset' in servicio().catalogo()['lecturas']
    assert 'servicio:eliminar_dataset' in servicio().catalogo()['accionesConConfirmacion']
    r = c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True})
    assert r.json()['estado'] == 'ejecutada', r.text
    assert r.json()['resultado']['archivoEliminado'] is True
    assert not archivo.parent.exists() and not al.estado['investigaciones'][0]['datasets']
    assert not any(d['id'] == registro_id for d in al.estado['datasetsPrograma'])
    assert c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True}).json()['repetida']
    assert c.get(ruta(ds) + '/eliminacion').json()['eliminado']
    assert al.verificar_cadena()['ok']
    assert al._con.execute("SELECT actor FROM acciones WHERE nombre='eliminarDataset'").fetchone()[0] == 'persona@rosa.test'
    assert '_datasetsEliminados' not in al.instantanea()


def test_rechazar_y_otro_autor_no_borran(entorno):
    al, _, c, servicio = entorno
    ds = subir(c)
    url = preparar(al, servicio(), ds)
    r = asyncio.run(servicio('admin').peticion('POST', url, json={'aprobar': True}))
    assert not r['ok']
    assert c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': False}).json()['estado'] == 'cancelada'
    assert D.ruta_dataset('inv-a', ds, 'prueba.csv').exists()
    assert c.post(ruta(ds) + '/eliminar').status_code == 403
    assert c.post(ruta(ds, 'otra') + '/eliminar', headers={'X-Rosa': '1'}).status_code == 404


@pytest.mark.parametrize('tipo', ['planesAnalisis', 'reproducciones', 'analisisPedido', 'corridaActiva'])
def test_no_rompe_analisis_ni_corridas(entorno, tipo):
    al, _, c, _ = entorno
    ds = subir(c)
    def usar(e):
        if tipo == 'analisisPedido':
            e['hipotesis'].append({'id': 'h-1', 'investigacionId': 'inv-a', '_analisisPedido': {'datasetId': ds}})
        elif tipo == 'corridaActiva':
            e['corridas'][0]['estado'] = 'en_marcha'
        else:
            e[tipo].append({'id': 'uso-1', 'datasetId': ds, 'investigacionId': 'inv-a'})
    al.mutar(usar)
    antes = copy.deepcopy(al.estado)
    vista = c.get(ruta(ds) + '/eliminacion').json()
    assert not vista['puedeEliminar'] and vista['referencias'][0]['tipo'] == tipo
    assert c.post(ruta(ds) + '/eliminar', headers={'X-Rosa': '1'}).status_code == 409
    assert al.estado == antes and D.ruta_dataset('inv-a', ds, 'prueba.csv').exists()


def test_dos_subidas_comparten_registro_pero_no_archivo(entorno):
    al, _, c, _ = entorno
    ds1, ds2 = subir(c), subir(c)
    assert len(al.estado['datasetsPrograma']) == 1
    assert c.post(ruta(ds1) + '/eliminar', headers={'X-Rosa': '1'}).status_code == 200
    assert D.ruta_dataset('inv-a', ds2, 'prueba.csv').exists()
    assert al.estado['datasetsPrograma'][0]['usadoEn'] == ['inv-a']
    assert c.post(ruta(ds2) + '/eliminar', headers={'X-Rosa': '1'}).status_code == 200
    assert not al.estado['datasetsPrograma']


def test_registro_compartido_con_otra_investigacion_se_conserva(entorno):
    al, _, c, _ = entorno
    al.aplicar('crearInvestigacion', {'datos': {'titulo': 'Otra', 'objetivo': 'Revisar datos', 'condicionParada': 'Un análisis'}, 'id_': 'inv-b'})
    ds1, ds2 = subir(c), subir(c, 'inv-b')
    assert len(al.estado['datasetsPrograma']) == 1
    assert c.post(ruta(ds1) + '/eliminar', headers={'X-Rosa': '1'}).status_code == 200
    assert al.estado['datasetsPrograma'][0]['usadoEn'] == ['inv-b']
    assert D.ruta_dataset('inv-b', ds2, 'prueba.csv').exists()


def test_revalida_analisis_creado_despues_de_la_propuesta(entorno):
    al, _, c, servicio = entorno
    ds = subir(c)
    url = preparar(al, servicio(), ds)
    al.mutar(lambda e: e['planesAnalisis'].append({'id': 'plan-nuevo', 'datasetId': ds, 'investigacionId': 'inv-a'}))
    r = c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True}).json()
    assert r['estado'] == 'no_aplicada'
    assert D.ruta_dataset('inv-a', ds, 'prueba.csv').exists()


def test_sin_archivo_y_repeticion_son_idempotentes(entorno):
    al, _, c, _ = entorno
    ds = subir(c)
    D.ruta_dataset('inv-a', ds, 'prueba.csv').unlink()
    assert c.post(ruta(ds) + '/eliminar', headers={'X-Rosa': '1'}).json()['archivoEliminado']
    version = al.version
    assert c.post(ruta(ds) + '/eliminar', headers={'X-Rosa': '1'}).json()['archivoEliminado']
    assert al.version == version


def test_fallo_sqlite_no_borra_archivo(entorno, monkeypatch):
    al, _, _, _ = entorno
    ds = al.aplicar('anadirDataset', {'investigacion_id': 'inv-a', 'dataset': {'nombre': 'prueba.csv'}})
    archivo = D.guardar_dataset('inv-a', ds, 'prueba.csv', b'dato')
    def fallar(*args, **kwargs):
        raise RuntimeError('Fallo de persistencia simulado')
    monkeypatch.setattr(al, '_guardar', fallar)
    with pytest.raises(RuntimeError):
        DE.eliminar(al, 'inv-a', ds, 'persona')
    assert archivo.exists() and al.estado['investigaciones'][0]['datasets'][0]['id'] == ds


def test_fallo_de_disco_se_comprueba_y_reintenta_tras_reabrir(entorno, monkeypatch):
    al, _, c, servicio = entorno
    ds = subir(c)
    url = preparar(al, servicio(), ds)
    borrar = DE.shutil.rmtree
    def fallar(*args, **kwargs):
        raise OSError('Fallo de disco simulado')
    monkeypatch.setattr(DE.shutil, 'rmtree', fallar)
    r = c.post(url, headers={'X-Rosa': '1'}, json={'aprobar': True}).json()
    assert r['estado'] == 'resultado_desconocido'
    vista = c.get(ruta(ds) + '/eliminacion').json()
    assert vista['eliminado'] and not vista['archivoEliminado']
    r = c.post(url, headers={'X-Rosa': '1'}, json={'modo': 'comprobar'}).json()
    assert r['resultado']['estadoActualCoincide'] is False
    monkeypatch.setattr(DE.shutil, 'rmtree', borrar)
    al.cerrar()
    reabierto = Almacen(al.ruta)
    try:
        assert DE.eliminar(reabierto, 'inv-a', ds, 'persona')['archivoEliminado']
        assert reabierto.verificar_cadena()['ok']
    finally:
        reabierto.cerrar()


@pytest.mark.parametrize('nivel', ['dataset', 'investigacion'])
def test_enlaces_no_borran_otras_carpetas(entorno, tmp_path, nivel):
    al, _, c, _ = entorno
    ds = al.aplicar('anadirDataset', {'investigacion_id': 'inv-a', 'dataset': {'nombre': 'prueba.csv'}})
    fuera = tmp_path / 'otra-carpeta'
    fuera.mkdir()
    (fuera / 'conservar').write_text('no borrar')
    enlace = D.DIR_DATASETS / 'inv-a'
    if nivel == 'dataset':
        enlace = enlace / ds
    enlace.parent.mkdir(parents=True, exist_ok=True)
    enlace.symlink_to(fuera, target_is_directory=True)
    assert c.post(ruta(ds) + '/eliminar', headers={'X-Rosa': '1'}).status_code == 409
    assert (fuera / 'conservar').read_text() == 'no borrar'
    assert al.estado['investigaciones'][0]['datasets']
