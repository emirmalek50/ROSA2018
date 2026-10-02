"""Continuidad y comprobación de operaciones sin repetir efectos externos."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from rosa.asistente_conversaciones import conversacion
from rosa.estado import plantilla as P


def localizar(e: dict, inv_id: str, pregunta_id: str, op_id: str, quien: str) -> tuple[dict, dict]:
    inv = conversacion(e, inv_id) or {}
    q = next((q for q in inv.get('preguntasABases', []) if q['id'] == pregunta_id), None)
    if not q or q.get('quien') != quien:
        raise ValueError('Solo quien pidió la operación puede continuar o comprobarla')
    op = next((o for o in q.get('acciones', []) if o['id'] == op_id), None)
    if not op:
        raise ValueError('Operación desconocida')
    return q, op


async def continuar(app: Any, almacen: Any, servicios: Any, ids: tuple[str, str, str], quien: str) -> dict:
    """Reclama una continuación, razona y guarda respuesta y finalización juntas."""
    from rosa import asistente as AS
    from rosa import asistente_servicios as SV
    from rosa.estado.acciones import registrar_pregunta_bases
    from rosa.servidor import _turnos_previos

    def reclamar(e):
        q, op = localizar(e, *ids, quien)
        if op['estado'] != 'ejecutada' or op.get('continuacion') in {'en_curso', 'lista'}:
            return None
        op['continuacion'] = 'en_curso'
        op.pop('errorContinuacion', None)
        return {'pregunta': q['pregunta'], 'hilo': q.get('hilo') or q['id'], 'resultado': op.get('resultado'), 'resumen': op['resumen']}
    datos = await asyncio.to_thread(almacen.mutar, reclamar, nombre='continuarAsistente', actor=quien)
    if datos is None:
        return {'ok': True, 'repetida': True}
    try:
        modelos = getattr(app.state, 'modelos', None)
        if modelos is None:
            raise ValueError('El modelo del asistente todavía no está disponible')
        servicios.hilo = datos['hilo']
        contexto = _turnos_previos(conversacion(almacen.instantanea(), ids[0]) or {}, datos['hilo'])
        pregunta = ('Continúa la petición original después de la operación confirmada. Comprueba su resultado y atiende lo pendiente. '
                    'No repitas la operación ni trates la confirmación como autorización de otras acciones. '
                    + json.dumps(datos, ensure_ascii=False))
        async with app.state.semaforo_preguntas:
            token = SV.CONTEXTO.set(servicios)
            try:
                r = await asyncio.wait_for(AS.preguntar(modelos.cerebro, almacen.estado, ids[0], pregunta, contexto, almacen=almacen), 600)
            finally:
                SV.CONTEXTO.reset(token)
        r.update(pregunta='Continuación: ' + datos['resumen'], quien=quien, hilo=datos['hilo'], error=None)
        def guardar(e):
            _, op = localizar(e, *ids, quien)
            registrar_pregunta_bases(e, ids[0], r, P.ahora_ms())
            op['continuacion'] = 'lista'
            return {'ok': True}
        return await asyncio.to_thread(almacen.mutar, guardar, nombre='respuestaContinuacionAsistente', actor=quien)
    except Exception:  # noqa: BLE001
        def fallar(e):
            _, op = localizar(e, *ids, quien)
            op.update(continuacion='error', errorContinuacion='No se pudo continuar. Puedes reintentar la conversación sin repetir el cambio.')
            return {'ok': False, 'error': op['errorContinuacion']}
        return await asyncio.to_thread(almacen.mutar, fallar, nombre='errorContinuacionAsistente', actor=quien)


async def comprobar(almacen: Any, servicios: Any, ids: tuple[str, str, str], quien: str) -> dict:
    """Consulta el estado actual. Una coincidencia no prueba quién causó el efecto."""
    _, op = localizar(almacen.instantanea(), *ids, quien)
    if op['estado'] != 'resultado_desconocido':
        return {'ok': False, 'error': 'La operación no tiene un resultado pendiente de comprobación'}
    nombre, args = op['nombre'], op['argumentos']
    coincide = None
    evidencia: Any = None
    if nombre == 'servicio:gepa':
        evidencia = almacen.instantanea().get('gepaAutomatico')
        if isinstance(evidencia, dict) and args.get('accion_gepa') in {'pausar', 'reanudar'}:
            esperado = args['accion_gepa'] == 'pausar'
            if evidencia.get('estado'):
                coincide = (evidencia['estado'] == 'pausado') == esperado
    elif nombre == 'servicio:sellar':
        h: dict[str, Any] = next((h for h in almacen.instantanea().get('hipotesis', []) if h['id'] == args.get('hipotesis_id')), {})
        evidencia = (h.get('experimento') or {}).get('selloExterno')
        if evidencia:
            coincide = evidencia.get('ok') is True
    elif nombre in {'servicio:configurar_correo', 'servicio:decidir_cuenta', 'servicio:probar_correo'}:
        ruta = '/api/acceso/solicitudes' if nombre == 'servicio:decidir_cuenta' else '/api/correo'
        evidencia = await servicios.peticion('GET', ruta)
    elif nombre == 'servicio:reanclar':
        evidencia = await servicios.peticion('GET', '/api/registro/integridad')
    else:
        evidencia = {'aviso': 'No existe un comprobante inequívoco para esta operación'}
    resultado = {'estadoActualCoincide': coincide, 'evidencia': evidencia,
                 'aviso': 'Se consultó el estado actual sin repetir la operación. Esto no prueba que la petición interrumpida causara el efecto; no se marca como ejecutada.'}
    def guardar(e):
        _, actual = localizar(e, *ids, quien)
        actual.update(comprobadaEn=P.ahora_ms(), comprobacion=resultado)
        return {'ok': True, 'estado': actual['estado'], 'resultado': resultado}
    return await asyncio.to_thread(almacen.mutar, guardar, nombre='comprobarOperacionAsistente', actor=quien)
