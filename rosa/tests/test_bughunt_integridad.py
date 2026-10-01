"""Regresiones de la auditoría: datos, persistencia y reanudación sin modelos reales."""
import asyncio
import json
import sqlite3
import time
from types import SimpleNamespace

import pytest

from rosa import datos as D, ejecucion as X
from rosa.bucle import analisis as AN
from rosa.estado import acciones as A, plantilla as P
from rosa.estado.almacen import Almacen, ESQUEMA
from rosa.tests.test_integracion_corrida import (
    _con_experimento_asignado, _hip, _pred_conclusion, _pred_resultado, _preparar, _supervisor,
)
from rosa.vigilante_modelos import ModeloSinRespuesta


def test_efectos_opuestos_no_pueden_recibir_el_mismo_resumen():
    a = [['control', '1']] * 3 + [['tratado', '10']] * 3
    b = [['control', '10']] * 3 + [['tratado', '1']] * 3
    sa, sb = (D._resumen_tabla(['grupo', 'medida'], f) for f in (a, b))
    assert sa != sb
    assert 'grupo=control\n- medida: n=3, media=1,' in sa
    assert 'grupo=tratado\n- medida: n=3, media=10,' in sa
    assert 'no son pruebas de significación' in sa
    assert 'media(tratado) - media(control) = 9' in sa
    assert 'media(tratado) - media(control) = -9' in sb


@pytest.mark.parametrize('valor', ['inf', '-inf', '1e999'])
def test_no_finitos_se_informan_sin_romper_el_archivo(valor):
    s = D._resumen_tabla(['medida'], [['1'], ['2'], [valor]])
    assert '1 valores no finitos' in s and 'media=1.5' in s


def test_entregas_inmutables_conservan_extension_y_marca_sintetica(tmp_path, monkeypatch):
    monkeypatch.setattr(D, 'DIR_DATOS', tmp_path)
    a = D.guardar('h', 'datos_sinteticos.csv', b'original')
    b = D.guardar('h', 'datos_sinteticos.csv', b'nuevo')
    assert a != b and a.read_bytes() == b'original' and b.read_bytes() == b'nuevo'
    assert a.suffix == '.csv' and A.es_fichero_sintetico(a.name)
    assert not list(a.parent.glob('.entrega-*'))


def test_sql_rechazado_no_se_persiste_con_la_siguiente_accion(tmp_path):
    al = Almacen(tmp_path / 'rosa.db')
    try:
        al.mutar(lambda e: e.update(prueba='original'))
        al._con.execute("CREATE TRIGGER fallo BEFORE UPDATE ON estado_meta BEGIN SELECT RAISE(ABORT, 'rechazado'); END")
        with pytest.raises(sqlite3.IntegrityError):
            al.mutar(lambda e: e.update(prueba='rechazado'))
        assert al.estado['prueba'] == 'original'
        al._con.execute('DROP TRIGGER fallo')
        al.mutar(lambda e: e.update(otra='independiente'))
        assert json.loads(al._con.execute('SELECT json FROM estado').fetchone()[0])['prueba'] == 'original'
    finally:
        al.cerrar()


def test_migracion_conserva_json_y_solo_escribe_clave_modificada(tmp_path):
    ruta = tmp_path / 'vieja.db'
    con = sqlite3.connect(ruta)
    con.executescript(ESQUEMA)
    e = P.estado_inicial()
    e.update(grande='x' * 1000000, especial=[True, False, None, {'ñ': 'sí'}])
    con.execute("INSERT INTO estado VALUES ('rosa', 4, ?, 1)", (json.dumps(e),))
    con.commit(); con.close()
    al = Almacen(ruta)
    try:
        assert al.estado['especial'] == e['especial'] and al.version == 4
        # Impide que una escritura pequeña toque la fila pesada.
        al._con.execute("CREATE TRIGGER no_tocar BEFORE UPDATE ON estado_partes WHEN OLD.clave='grande' BEGIN SELECT RAISE(ABORT, 'reescritura pesada'); END")
        al.mutar(lambda e: e.update(pequena=1))
        assert json.loads(al._con.execute('SELECT json FROM estado').fetchone()[0])['grande'] == e['grande']
        al.mutar(lambda e: e.pop('especial'))
        assert 'especial' not in json.loads(al._con.execute('SELECT json FROM estado').fetchone()[0])
        # Un binario antiguo hace UPDATE y exige rowcount=1: debe abortar sin pérdida.
        con = sqlite3.connect(ruta)
        cur = con.execute("UPDATE estado SET json='{}', version=version+1 WHERE clave='rosa'")
        assert cur.rowcount == 0
        con.rollback(); con.close()
        assert al._con.execute('SELECT version FROM estado').fetchone()[0] == al.version
    finally:
        al.cerrar()
    ro = Almacen(ruta, solo_lectura=True)
    assert ro.estado['pequena'] == 1
    ro.cerrar()


@pytest.mark.parametrize('nuevo_contrato', [False, True])
def test_respuesta_del_juez_no_marca_otra_entrega_como_evaluada(tmp_path, monkeypatch, nuevo_contrato):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    def responder(kw):
        if nuevo_contrato:
            al.mutar(lambda e: _hip(al, ids)['experimento'].update(confirma='criterio modificado'))
        else:
            nuevo = D.guardar(ids['hip'], 'nuevo.csv', b'grupo,valor\na,1\nb,2\n')
            al.mutar(lambda e: A.registrar_datos_experimento(e, ids['hip'], nuevo.name, 'nuevo'))
        return _pred_resultado('refuta', 'negativo_interpretable', [('medida', '+2 %')])
    sup, ctx, llamadas = _supervisor(al, ids, {'evaluar_resultado': responder, 'concluir': _pred_conclusion()}, monkeypatch)
    try:
        asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
        assert not _hip(al, ids).get('_resultadoEvaluado')
        assert not _hip(al, ids)['experimento'].get('resultado')
        assert [p for p, _ in llamadas.vistas] == ['evaluar_resultado']
    finally:
        al.cerrar()


@pytest.mark.parametrize('cifras', [{}, {'p_principal': 'nan'}, {'p_principal': '2'}])
def test_estabilidad_no_aprueba_medidas_ausentes_o_invalidas(cifras):
    res = X.Resultado('completado', 'docker', resultados={'p_principal': '0.01'})
    rep = [{'estado': 'completado', 'resultados': cifras}]
    assert X.estabilidad_entre_semillas({'alpha': .05}, res, rep)['resultado'] == 'no_comprobable'


def test_estabilidad_compara_la_misma_medida():
    res = X.Resultado('completado', 'docker', resultados={'p_principal': '.01', 'p_otro': '.8'})
    rep = [{'estado': 'completado', 'resultados': {'p_principal': '.8', 'p_otro': '.01'}}]
    assert X.estabilidad_entre_semillas({'alpha': .05}, res, rep)['resultado'] == 'falla'


def test_resultados_por_gen_acotados_y_principal_al_final_conservado():
    salida = '\n'.join(f'RESULTADO p_gen_{i}=.1' for i in range(10000)) + '\nRESULTADO valor_reproducido=42'
    r, _, _, _ = X._parsear(salida)
    assert len(r) <= X.MAX_CIFRAS + 1
    assert r['valor_reproducido'] == '42' and int(r['_omitidas']) > 9900


def test_paquetes_corresponden_al_entorno(monkeypatch):
    monkeypatch.setattr(X, 'versiones_imagen', lambda runtime, entorno: [{'nombre': 'imagen', 'version': X.IMAGENES[entorno][0]}])
    assert X._paquetes('docker', 'celula_unica')[0]['version'] == X.IMAGENES['celula_unica'][0]


@pytest.mark.parametrize('interrumpir', ['interpretar', 'auditar', 'reparar'])
@pytest.mark.parametrize('omitir_medida', [False, True])
def test_reanuda_sin_repetir_sandbox_y_no_bloquea_event_loop(tmp_path, monkeypatch, interrumpir, omitir_medida):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    ctx.programas = SimpleNamespace(codigo='codigo', interpretar='interpretar', auditar_analisis='auditar', reparar='reparar')
    llamadas = []
    fallo = [True]
    async def llamar(rol, programa, **kw):
        llamadas.append(programa)
        if programa == interrumpir and fallo[0]:
            fallo[0] = False
            raise ModeloSinRespuesta('juez', 'simulado', 1, 0)
        if programa == 'codigo':
            return SimpleNamespace(codigo='import random\nrandom.seed(12345)\n')
        if programa == 'reparar':
            return SimpleNamespace(codigo_corregido='import random\nrandom.seed(12345)\n')
        if programa == 'interpretar':
            return SimpleNamespace(interpretacion=SimpleNamespace(estado='sin_efecto_detectable', resumen='Sin efecto', cifras_clave=[]))
        return SimpleNamespace(auditoria=SimpleNamespace(comprobaciones=[], veredicto='valido', motivo='ok', plausibilidad_verificada=True))
    ctx.llamar = llamar
    ruta = tmp_path / 'datos.csv'; ruta.write_text('x\n1\n')
    plan = P.nuevo_plan_analisis(ids['inv'], ids['hip'], 'ds', 1, semilla=12345, hashDatos=X.hash_fichero(ruta))
    ds = {'nombre': 'datos', 'procedencia': {'sintetico': True}}
    ejecuciones = []
    paquetes = [{'nombre': 'imagen', 'version': 'imagen-exacta'}, {'nombre': 'python', 'version': '3.12'}]
    def runtime(sintetico):
        time.sleep(.05)
        return 'docker', ''
    def ejecutar(*args):
        ejecuciones.append(args[4])
        if interrumpir == 'reparar' and len(ejecuciones) == 1:
            return X.Resultado('error_tecnico', 'docker', error='fallo de prueba')
        cifras = {} if omitir_medida and args[4].endswith('-s2') else {'p_valor': '.8'}
        return X.Resultado('completado', 'docker', resultados=cifras, baseline={'p_valor': '.8'}, control={'p_valor': '.8'}, paquetes=paquetes)
    monkeypatch.setattr(X, 'runtime_disponible', runtime)
    monkeypatch.setattr(X, 'ejecutar', ejecutar)
    pista = SimpleNamespace(accion=lambda *a: None, error=lambda *a: None, resultado=lambda *a: None)
    async def probar():
        tarea = asyncio.create_task(AN._correr_plan(ctx, plan, ds, ruta, '', ids['hip'], 'hipotesis', pista))
        await asyncio.sleep(.01)
        assert not tarea.done()
        with pytest.raises(ModeloSinRespuesta):
            await tarea
        assert len(ejecuciones) == (1 if interrumpir == 'reparar' else 3)
        # Reabrir demuestra que el checkpoint está en disco, no solo en RAM.
        ruta_bd = al.ruta
        al.cerrar()
        ctx.almacen = Almacen(ruta_bd)
        resultado = await AN._correr_plan(ctx, plan, ds, ruta, '', ids['hip'], 'hipotesis', pista)
        assert resultado['entorno']['paquetes'] == paquetes
        if omitir_medida:
            assert resultado['auditoria']['veredicto'] == 'no_evaluable_computacionalmente'
        assert resultado['estado'] == 'completado' and len(ejecuciones) == (4 if interrumpir == 'reparar' else 3)
        assert llamadas.count('codigo') == 1
        if interrumpir == 'auditar':
            assert llamadas.count('interpretar') == 1
        assert ctx.almacen.estado['ejecuciones'][0]['entorno']['paquetes'] == paquetes
    try:
        asyncio.run(probar())
    finally:
        ctx.almacen.cerrar()
        al.cerrar()


def test_fallo_al_iniciar_transaccion_restaura_memoria(tmp_path):
    al = Almacen(tmp_path / 'ocupada.db')
    al.mutar(lambda e: e.update(prueba='original'))
    otro = sqlite3.connect(al.ruta)
    try:
        otro.execute('BEGIN IMMEDIATE')
        al._con.execute('PRAGMA busy_timeout=1')
        with pytest.raises(sqlite3.OperationalError):
            al.mutar(lambda e: e.update(prueba='rechazado'))
        assert al.estado['prueba'] == 'original'
    finally:
        otro.rollback(); otro.close(); al.cerrar()


def test_plan_pendiente_no_se_replanifica_ni_cobra_otro_cupo(tmp_path, monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, {}, monkeypatch)
    ruta = tmp_path / 'datos.csv'; ruta.write_text('x\n1\n')
    ds = {'id': 'ds', 'nombre': 'datos', 'estado': 'aprobado', 'procedencia': {'usoIAAutorizado': 'si', 'hash': 'x'}}
    plan = P.nuevo_plan_analisis(ids['inv'], ids['hip'], 'ds', 1)
    def preparar(e):
        e['planesAnalisis'].append(plan)
        _hip(al, ids)['_planAnalisisPendiente'] = plan['id']
        ctx.inv()['puertaReproduccion'] = {'estado': 'abierta'}
        ctx.corrida()['_evaluacionesCostosas'] = AN.politicas.MAX_EVALUACIONES_COSTOSAS
    al.mutar(preparar)
    monkeypatch.setattr(AN, '_dataset_de', lambda *a: (ds, ruta))
    monkeypatch.setattr(D, 'esquema_para_modelo', lambda *a: 'esquema')
    async def correr(*args):
        assert args[1]['id'] == plan['id']
        return {'id': 'run', 'estado': 'no_ejecutado'}
    monkeypatch.setattr(AN, '_correr_plan', correr)
    pista = SimpleNamespace(accion=lambda *a: None, error=lambda *a: None, resultado=lambda *a: None)
    try:
        asyncio.run(AN.analizar_hipotesis(ctx, _hip(al, ids), 'ds', 'pregunta', pista))
        assert len(al.estado['planesAnalisis']) == 1 and not llamadas.vistas
        assert ctx.corrida()['_evaluacionesCostosas'] == AN.politicas.MAX_EVALUACIONES_COSTOSAS
        assert not _hip(al, ids).get('_planAnalisisPendiente')
    finally:
        al.cerrar()


def test_estratos_unitarios_no_revelan_medidas_individuales():
    resumen = D._resumen_grupos(['grupo', 'medida'], [['control', '123.45'], ['tratado', '987.65']])
    assert '123.45' not in resumen and '987.65' not in resumen
    assert 'no se envían estadísticas' in resumen
