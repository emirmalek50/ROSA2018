"""Comienzos reales con voz de IA; nunca un resultado ni una aprobación inventados."""
import asyncio
import copy
import time

import pytest

from rosa.estado.almacen import Almacen
from rosa.laboratorio_conversaciones import (
    REGLAS, REGLAS_JUEZ, Conversaciones, clave_planificando, intenciones_de, tema_de,
)


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / 'intenciones.db')
    al.estado.update(
        investigaciones=[{'id': 'inv', 'titulo': 'Tau', 'objetivo': 'Comparar MAPT y tau en neuronas', 'mision': {}}],
        corridas=[{'id': 'c', 'investigacionId': 'inv', 'estado': 'en_marcha', 'iteracionActual': 1,
                   'presupuesto': {'limiteLlamadas': 200}, 'gasto': {'llamadas': 0}}],
        iteraciones=[{'id': 'it', 'corridaId': 'c', 'numero': 1, 'terminadaEn': None, 'planAprobado': True,
                      'presupuesto': {'limite': 100, 'usado': 0, 'reservaCierre': 12},
                      'plan': [{'id': 'paso-real', 'titulo': 'Buscar literatura', 'detalle': 'Comparar la evidencia sobre MAPT y tau',
                                'tipo': 'literatura', 'estado': 'en_curso'}],
                      'pistas': [{'id': 'pi-real', 'pasoId': 'paso-real', 'tipo': 'literatura', 'titulo': 'Buscar literatura',
                                  'estado': 'en_curso', 'transcripcion': []}]}],
    )
    yield al
    al.cerrar()


def visita(al, clave, llamar):
    s = Conversaciones(al, llamar)
    s.visitas[clave] = {'persona': time.monotonic() + 100}
    return s


def propuesta(al):
    al.estado['corridas'][0]['estado'] = 'esperando_plan'
    it = al.estado['iteraciones'][0]
    it['planAprobado'] = False
    it['plan'][0]['estado'] = 'pendiente'
    it['pistas'] = []
    return it


def test_inicio_sin_hallazgo_con_pista_y_proposito_reales(almacen):
    t = tema_de(almacen.estado, 'c', 'it')
    assert t['momento'] == 'inicio_tarea'
    assert t['participantes'] == ['Generador de consultas', 'Explorador']
    assert t['materiales'][0]['clase'] == 'tarea'
    assert t['materiales'][0]['detalle'] == 'Comparar la evidencia sobre MAPT y tau'
    assert t['materiales'][0]['pistaId'] == 'pi-real'
    assert not any(m['clase'] == 'afirmacion' for m in t['materiales'])


def test_apertura_no_se_repite_al_llegar_lineas_resultados_o_sse(almacen):
    t = intenciones_de(almacen.estado, 'c', 'it')[0]
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p['transcripcion'].extend([
        {'t': 0, 'tipo': 'accion', 'texto': 'Consultando la literatura de MAPT'},
        {'t': 10, 'tipo': 'resultado', 'texto': 'La búsqueda recuperó artículos sobre tau'},
    ])
    actualizado = intenciones_de(almacen.estado, 'c', 'it')[0]
    assert actualizado['huella'] == t['huella']
    assert actualizado['origen'] == t['origen']
    p['id'] = 'pi-segunda'
    assert intenciones_de(almacen.estado, 'c', 'it')[0]['huella'] != t['huella']


def test_miembros_paralelos_no_resucitan_al_que_termino(almacen):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p.update(tipo='hipotesis', titulo='Generar y revisar hipótesis', transcripcion=[
        {'t': 0, 'tipo': 'accion', 'texto': 'Generando por analogía', 'agente': 'analogia', 'estadoAgente': 'en_curso'},
        {'t': 1, 'tipo': 'accion', 'texto': 'Buscando una contradicción', 'agente': 'contradiccion', 'estadoAgente': 'en_curso'},
        {'t': 2, 'tipo': 'resultado', 'texto': 'Terminó analogía', 'agente': 'analogia', 'estadoAgente': 'terminado'},
    ])
    temas = intenciones_de(almacen.estado, 'c', 'it')
    assert [t['autor'] for t in temas] == ['Contradicción']
    assert temas[0]['materiales'][0]['entradaId'] == 'pi-real:1:1'
    p['transcripcion'].append({'t': 3, 'tipo': 'error', 'texto': 'Terminó contradicción', 'agente': 'contradiccion', 'estadoAgente': 'fallido'})
    assert intenciones_de(almacen.estado, 'c', 'it') == []


def test_no_inventa_tareas_a_partir_de_plan_pendiente(almacen):
    almacen.estado['iteraciones'][0]['pistas'] = []
    assert intenciones_de(almacen.estado, 'c', 'it') == []
    assert tema_de(almacen.estado, 'c', 'it') is None


def test_plan_propuesto_sin_registro_tiene_pasos_exactos_y_no_esta_aprobado(almacen):
    it = propuesta(almacen)
    t = tema_de(almacen.estado, 'c', 'it')
    assert t['momento'] == 'plan_propuesto'
    assert t['tipoConversacion'] == 'companeros'
    assert t['materiales'][0]['aprobado'] is False
    assert t['materiales'][0]['pasos'][0]['id'] == it['plan'][0]['id']
    assert t['materiales'][0]['pasos'][0]['detalle'] == it['plan'][0]['detalle']
    assert not any(m['clase'] == 'registro' for m in t['materiales'])
    it['plan'][0]['detalle'] = 'Otra pregunta para el plan'
    assert tema_de(almacen.estado, 'c', 'it')['huella'] != t['huella']


@pytest.mark.parametrize('idioma', ['es', 'en'])
@pytest.mark.asyncio
async def test_voz_de_intencion_generada_y_auditada_con_personalidad(almacen, idioma):
    propuesta(almacen)
    llamadas = []
    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append((reglas, copy.deepcopy(contenido)))
        if reglas == REGLAS_JUEZ:
            assert contenido['intervencion']['referencias']
            return {'admisible': True}
        assert reglas == REGLAS
        assert contenido['momento'] == 'plan_propuesto'
        assert contenido['tipoConversacion'] == 'companeros'
        assert contenido['personalidad'] and contenido['personalidadCompanero']
        assert contenido['idioma'] == ('English' if idioma == 'en' else 'español')
        return {'texto': ('Quiero comparar MAPT y tau.' if idioma == 'es' else 'I want to compare tau.') if contenido['turno'] == 1 else ('Vale.' if idioma == 'es' else 'Agreed.'),
                'referencias': [tema['materiales'][0]['id']]}
    clave = ('c', 'it', idioma)
    s = Conversaciones(almacen, llamar)
    s.tocar(clave, 'persona', True)
    await s.tareas[clave]
    turnos = s.leer(clave)
    assert len(turnos) == 9
    assert len(llamadas) == 18
    assert all(t['momento'] == 'plan_propuesto' and t['tipoConversacion'] == 'companeros' for t in turnos)
    assert almacen.estado['iteraciones'][0]['planAprobado'] is False
    assert not almacen.estado['iteraciones'][0]['pistas']
    await s.cerrar()


@pytest.mark.parametrize('cambio', ['aprueba', 'edita', 'pausa', 'termina', 'presupuesto', 'sin_visita'])
@pytest.mark.asyncio
async def test_plan_tardio_no_se_publica_fuera_de_contexto(almacen, cambio):
    propuesta(almacen)
    clave = ('c', 'it', 'es')
    llamadas = []
    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        if cambio == 'aprueba':
            almacen.estado['corridas'][0]['estado'] = 'en_marcha'
            almacen.estado['iteraciones'][0]['planAprobado'] = True
        elif cambio == 'edita':
            almacen.estado['iteraciones'][0]['plan'][0]['detalle'] = 'Otra intención real'
        elif cambio == 'pausa':
            almacen.estado['corridas'][0]['estado'] = 'pausada'
        elif cambio == 'termina':
            almacen.estado['iteraciones'][0]['terminadaEn'] = 123
        elif cambio == 'presupuesto':
            almacen.estado['iteraciones'][0]['presupuesto']['usado'] = 88
        else:
            s.visitas.clear()
        return {'texto': 'Quiero mirar MAPT.', 'referencias': [tema['materiales'][0]['id']]}
    s = visita(almacen, clave, llamar)
    t = s._temas(clave, tema_de(almacen.estado, 'c', 'it'))[0]
    await s._conversar(clave, t)
    assert len(llamadas) == 1
    assert not s.leer(clave)
    await s.cerrar()


@pytest.mark.parametrize('cambio', ['pista_terminada', 'paso_terminado', 'miembro_terminado', 'otra_iteracion'])
@pytest.mark.asyncio
async def test_inicio_tardio_cancelado_si_trabajo_ya_no_es_actual(almacen, cambio):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    if cambio == 'miembro_terminado':
        p['transcripcion'] = [{'t': 0, 'tipo': 'accion', 'texto': 'Buscando analogías con tau', 'agente': 'analogia', 'estadoAgente': 'en_curso'}]
    clave = ('c', 'it', 'es')
    llamadas = []
    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        if cambio == 'pista_terminada':
            p['estado'] = 'hecha'
        elif cambio == 'paso_terminado':
            almacen.estado['iteraciones'][0]['plan'][0]['estado'] = 'hecho'
        elif cambio == 'miembro_terminado':
            p['transcripcion'].append({'t': 1, 'tipo': 'resultado', 'texto': 'Terminé analogía', 'agente': 'analogia', 'estadoAgente': 'terminado'})
        else:
            almacen.estado['corridas'][0]['iteracionActual'] = 2
        return {'texto': 'Quiero mirar MAPT.', 'referencias': [tema['materiales'][0]['id']]}
    s = visita(almacen, clave, llamar)
    t = s._temas(clave, tema_de(almacen.estado, 'c', 'it'))[0]
    await s._conversar(clave, t)
    assert len(llamadas) == 1 and not s.leer(clave)
    await s.cerrar()


def test_comienzo_prioritario_no_pierde_el_turno_por_un_resultado_anterior(almacen):
    it = almacen.estado['iteraciones'][0]
    it['pistas'].insert(0, {'id': 'pi-anterior', 'tipo': 'verificacion', 'titulo': 'Verificar', 'estado': 'hecha',
                           'transcripcion': [{'t': 20, 'tipo': 'resultado', 'texto': 'Una asociación requiere revisar la población estudiada.'}]})
    s = visita(almacen, ('c', 'it', 'es'), None)
    temas = s._temas(('c', 'it', 'es'), tema_de(almacen.estado, 'c', 'it'))
    assert temas[0]['momento'] == 'inicio_tarea'
    assert temas[0]['autor'] == 'Generador de consultas'
    assert len(temas) <= 3


def test_clave_plan_solo_llamada_real_numero_canonico_y_sin_iteracion_guardada(almacen):
    c = almacen.estado['corridas'][0]
    c.update(estado='esperando_plan', planificando=True, planificandoIteracion=2)
    clave = 'plan:c:2'
    assert clave_planificando(almacen.estado, 'c') == clave
    t = intenciones_de(almacen.estado, 'c', clave)[0]
    assert t['preparandoPlan'] and t['iteracion'] == 2 and t['momento'] == 'inicio_tarea'
    assert t['autor'] == 'Planificador'
    assert [m['clase'] for m in t['materiales']] == ['objetivo']
    assert intenciones_de(almacen.estado, 'c', 'plan:c:1') == []
    c['planificando'] = False
    assert clave_planificando(almacen.estado, 'c') is None
    c.update(planificando=True, estado='pausada')
    assert clave_planificando(almacen.estado, 'c') is None
    c.update(estado='esperando_plan', planificandoIteracion=1)
    assert clave_planificando(almacen.estado, 'c') is None


@pytest.mark.asyncio
async def test_planificador_sin_iteracion_cancela_y_conserva_reserva_y_presupuesto_viejo(almacen, monkeypatch):
    c = almacen.estado['corridas'][0]
    c.update(estado='esperando_plan', planificando=True, planificandoIteracion=2)
    almacen.estado['iteraciones'][0]['terminadaEn'] = 123
    monkeypatch.setattr('rosa.bucle.corrida.coste_previsto_del_cierre', lambda e, inv: 25)
    clave = ('c', 'plan:c:2', 'es')
    llamadas = []
    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append((reglas, copy.deepcopy(contenido)))
        assert tema['iteracion'] == 2
        if reglas == REGLAS_JUEZ:
            return {'admisible': True}
        return {'texto': 'Quiero enfocar lo de tau.', 'referencias': [tema['materiales'][0]['id']]}
    s = visita(almacen, clave, llamar)
    t = s._temas(clave, tema_de(almacen.estado, 'c', clave[1]))[0]
    assert s._vigente(clave)
    c['gasto']['llamadas'] = 173
    assert s._presupuesto(t, 2)
    assert not s._presupuesto(t, 3)
    c['gasto']['llamadas'] = 175
    await s._conversar(clave, t)
    assert not llamadas
    assert almacen.estado['iteraciones'][0]['presupuesto']['usado'] == 0
    c['gasto']['llamadas'] = 0
    c['planificando'] = False
    assert not s._vigente(clave)
    await s.cerrar()


def test_cadencia_estilo_y_no_instrucciones_de_frase_fija():
    assert Conversaciones.INTERVALO == 4 and Conversaciones.VIDA_VISITA == 35
    assert 'no repitas una misma frase de arranque' in REGLAS
    assert 'plan_propuesto' in REGLAS and 'inicio_tarea' in REGLAS_JUEZ


@pytest.mark.parametrize('tipo,etapa,autor', [
    ('decision_hipotesis', 'revision_inicial', 'Revisor inicial'),
    ('decision_hipotesis', 'supuestos', 'Evaluador de supuestos'),
    ('decision_hipotesis', 'killer', 'Killer'),
    ('decision_hipotesis', 'viabilidad', 'Juez de viabilidad'),
    ('decision_hipotesis', 'conclusion', 'Concluidor'),
    ('decision_hipotesis', 'asignacion', 'Asignador de evidencia'),
    ('revision_registro', 'revision', 'Revisor del registro'),
    ('revision_registro', 'reparacion', 'Rehacedor'),
    ('revision_registro', 'comprobacion_reparacion', 'Revisor de la reparación'),
    ('revision_registro', 'resumen', 'Resumidor'),
])
def test_etapa_explicita_elige_voz_de_quien_realmente_comienza(almacen, tipo, etapa, autor):
    it = almacen.estado['iteraciones'][0]
    p = it['pistas'][0]
    p['tipo'] = 'hipotesis' if tipo == 'decision_hipotesis' else 'meta'
    p['titulo'] = 'Una pista cuyo título no atribuye al autor'
    evento = {'tipo': tipo, 'etapa': etapa, 'estado': 'en_curso', 'version': 1, 'vuelta': 0,
              'hipotesisId': 'hip-real', 'iteracionId': 'it'}
    p['transcripcion'] = [{'t': 0, 'tipo': 'accion', 'texto': 'Comienza esta tarea real', 'eventoLab': evento}]
    almacen.estado['hipotesis'] = [{'id': 'hip-real', 'investigacionId': 'inv', 'titulo': 'MAPT en neuronas', 'enunciado': 'Una hipótesis propuesta', 'estado': 'propuesta', 'version': 1}]
    temas = intenciones_de(almacen.estado, 'c', 'it')
    assert len(temas) == 1 and temas[0]['autor'] == autor
    assert temas[0]['materiales'][0]['evento']['etapa'] == etapa
    if tipo == 'decision_hipotesis':
        assert temas[0]['materiales'][0]['hipotesis']['id'] == 'hip-real'
        assert temas[0]['materiales'][0]['hipotesis']['estado'] == 'propuesta'
    p['transcripcion'].append({'t': 1, 'tipo': 'resultado', 'texto': 'Esta fase terminó', 'eventoLab': {**evento, 'estado': 'terminado'}})
    assert intenciones_de(almacen.estado, 'c', 'it') == []


def test_fase_analisis_actual_no_revive_programacion_ni_interpretacion_acabada(almacen):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p['tipo'] = 'analisis'
    def entrada(estado):
        return {'t': 0, 'tipo': 'accion', 'texto': 'La ejecución real cambia de fase',
                'eventoLab': {'tipo': 'analisis', 'ejecucionId': 'ej-real', 'estado': estado, 'sintetico': True}}
    p['transcripcion'] = [entrada('programando'), entrada('ejecutando'), entrada('interpretando')]
    temas = intenciones_de(almacen.estado, 'c', 'it')
    assert len(temas) == 1 and temas[0]['autor'] == 'Intérprete'
    assert temas[0]['materiales'][0]['evento']['sintetico'] is True
    p['transcripcion'].append(entrada('auditando'))
    temas = intenciones_de(almacen.estado, 'c', 'it')
    assert len(temas) == 1 and temas[0]['autor'] == 'Auditor del análisis'
    p['transcripcion'].append(entrada('terminado'))
    assert intenciones_de(almacen.estado, 'c', 'it') == []


@pytest.mark.asyncio
async def test_primera_llamada_planificador_cuenta_solo_corrida_y_numero_nuevo(almacen, monkeypatch):
    import dspy
    from litellm import ModelResponse
    from rosa import gateway
    from rosa.modulos.contador import contexto_actual

    c = almacen.estado['corridas'][0]
    c.update(estado='esperando_plan', planificando=True, planificandoIteracion=2,
             contexto={'tokensUsados': 0, 'tokensLimite': 400000})
    c['gasto'].update(tokensEntrada=0, tokensSalida=0, usd=0.0, usdReal=0.0)
    anterior = almacen.estado['iteraciones'][0]
    anterior['terminadaEn'] = 123
    anterior['presupuesto']['usado'] = 20
    lm = dspy.LM('openai/prueba', cache=False)
    async def responder(**kwargs):
        assert contexto_actual.get().iteracion == 2
        return ModelResponse(model='openai/prueba', choices=[{'index': 0, 'message': {'role': 'assistant', 'content': '{"texto":"Quiero enfocar lo de tau.","referencias":["objetivo:c"]}'}, 'finish_reason': 'stop'}], usage={'prompt_tokens': 100, 'completion_tokens': 20, 'cost': 0.01})
    monkeypatch.setattr(lm, 'aforward', responder)
    monkeypatch.setattr(gateway, 'lm', lambda *a, **kw: lm)
    s = Conversaciones(almacen)
    tema = tema_de(almacen.estado, 'c', 'plan:c:2')
    result = await s._llamar(gateway.CEREBRO, REGLAS, {'momento': 'inicio_tarea'}, tema)
    assert result['referencias'] == ['objetivo:c']
    assert c['gasto']['llamadas'] == 1 and c['gasto']['tokensEntrada'] == 100
    assert anterior['presupuesto']['usado'] == 20
    assert contexto_actual.get() is None
    await s.cerrar()


@pytest.mark.asyncio
async def test_endpoint_clave_plan_preserva_autenticacion_csrf_y_bandera(almacen, monkeypatch, tmp_path):
    from types import SimpleNamespace
    import httpx
    from rosa import config
    from rosa.servidor import crear_app

    monkeypatch.setattr(config, 'RAIZ', tmp_path)
    monkeypatch.setattr(config, 'FRONTEND_DIST', tmp_path / 'sin-dist')
    monkeypatch.setattr(config, 'ROSA_TOKEN', '')
    c = almacen.estado['corridas'][0]
    c.update(estado='esperando_plan', planificando=True, planificandoIteracion=2)
    app = crear_app(almacen)
    app.state.acceso = SimpleNamespace(usuario=lambda token: 'persona@rosa.test' if token == 'sesion' else None)
    cuerpo = {'iteracionId': 'plan:c:2', 'idioma': 'es', 'cliente': 'cliente-123', 'activo': False}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as cliente:
        assert (await cliente.post('/api/corridas/c/laboratorio/conversaciones', json=cuerpo)).status_code == 401
        cliente.cookies.set('rosa_sesion', 'sesion')
        assert (await cliente.post('/api/corridas/c/laboratorio/conversaciones', json=cuerpo)).status_code == 403
        cliente.headers['X-Rosa'] = '1'
        assert (await cliente.post('/api/corridas/c/laboratorio/conversaciones', json=cuerpo)).status_code == 200
        for iid in ('plan:otra:2', 'plan:c:1', 'plan:c:3', 'plan:c:2:extra'):
            assert (await cliente.post('/api/corridas/c/laboratorio/conversaciones', json={**cuerpo, 'iteracionId': iid})).status_code == 404
        c['planificando'] = False
        assert (await cliente.post('/api/corridas/c/laboratorio/conversaciones', json=cuerpo)).status_code == 404
    await app.state.conversaciones_lab.cerrar()


@pytest.mark.parametrize('por_regla', [False, True])
def test_torneo_solo_da_voz_de_trabajo_a_los_jueces_si_hay_comparacion_real(almacen, por_regla):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p.update(tipo='hipotesis', titulo='Generar y revisar hipótesis')
    evento = {'tipo': 'torneo', 'hipotesisAId': 'hip-a', 'hipotesisBId': 'hip-b', 'tituloA': 'MAPT', 'tituloB': 'tau', 'estado': 'comparando', 'porRegla': por_regla}
    p['transcripcion'] = [{'t': 0, 'tipo': 'accion', 'texto': 'Comparar propuestas', 'eventoLab': evento}]
    temas = intenciones_de(almacen.estado, 'c', 'it')
    if por_regla:
        assert temas == []
    else:
        assert len(temas) == 1
        assert temas[0]['participantes'] == ['Juez del torneo', 'Juez del torneo B']
        assert temas[0]['materiales'][0]['evento']['hipotesisAId'] == 'hip-a'
        assert temas[0]['materiales'][0]['entradaId'] == 'pi-real:0:0'
    p['transcripcion'].append({'t': 1, 'tipo': 'resultado', 'texto': 'Se registró el resultado del partido', 'eventoLab': {**evento, 'estado': 'tablas'}})
    assert intenciones_de(almacen.estado, 'c', 'it') == []


@pytest.mark.parametrize('tipo,etapa', [('decision_hipotesis', 'killer'), ('revision_registro', 'revision')])
def test_una_regla_no_se_atribuye_como_trabajo_a_un_juez_de_ia(almacen, tipo, etapa):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p['transcripcion'] = [{'t': 0, 'tipo': 'accion', 'texto': 'Una regla comprueba el estado',
                           'eventoLab': {'tipo': tipo, 'etapa': etapa, 'estado': 'en_curso', 'hipotesisId': 'hip-real', 'iteracionId': 'it', 'origen': 'regla'}}]
    assert intenciones_de(almacen.estado, 'c', 'it') == []


def test_el_inicio_no_usa_una_pista_ni_una_revision_de_otra_iteracion(almacen):
    p = almacen.estado['iteraciones'][0]['pistas'][0]
    p['iteracionId'] = 'it-anterior'
    assert intenciones_de(almacen.estado, 'c', 'it') == []
    p['iteracionId'] = 'it'
    p['transcripcion'] = [{'t': 0, 'tipo': 'accion', 'texto': 'Revisión de otra iteración',
                          'eventoLab': {'tipo': 'revision_registro', 'etapa': 'revision', 'estado': 'en_curso', 'iteracionId': 'it-anterior', 'origen': 'juez'}}]
    assert intenciones_de(almacen.estado, 'c', 'it') == []
