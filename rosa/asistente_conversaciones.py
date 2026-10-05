"""Conversaciones del proyecto, también antes de crear una investigación."""
from __future__ import annotations
import re
from typing import Any

GLOBAL = 'global'


def global_vacia() -> dict[str, Any]:
    return {'id': GLOBAL, 'titulo': 'Asistente de ROSA', 'objetivo': 'Operar y consultar todo ROSA',
            'relevancia': '', 'limites': [], 'condicionParada': '', 'revisores': [], 'estado': 'activa',
            'creadaEn': 0, 'ramaDe': None, 'configuracion': {'preferencias': '', 'atributos': [], 'restricciones': [], 'amplitud': 'equilibrada'},
            'datasets': [], 'vigilarLiteraturaHasta': None, 'memoria': [], 'preguntasABases': []}


def conversacion(e: dict, ident: str, crear: bool = False) -> dict | None:
    if ident == GLOBAL:
        if crear:
            return e.setdefault('asistenteGlobal', global_vacia())
        return e.get('asistenteGlobal') or global_vacia()
    return next((i for i in e.get('investigaciones', []) if i['id'] == ident), None)


def hilo_de(q: dict) -> str:
    return q.get('hilo') or q.get('id', '')


def hilo_eliminado(inv: dict, hilo: str) -> bool:
    return bool(hilo) and hilo in inv.get('hilosEliminados', [])


def eliminar(e: dict, investigacion_id: str, hilo: str, quien: str) -> dict:
    """Quita un hilo del historial activo; conserva la investigación y su auditoría."""
    if not quien or not isinstance(hilo, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,40}', hilo):
        raise ValueError('Falta la conversación o la persona que pide eliminarla')
    inv = conversacion(e, investigacion_id)
    if inv is None:
        raise ValueError('Investigación desconocida')
    mensajes = [q for q in inv.get('preguntasABases', []) if hilo_de(q) == hilo]
    if not mensajes and not hilo_eliminado(inv, hilo):
        raise ValueError('No se encontró esa conversación; consulta listar_conversaciones')
    for q in mensajes:
        for op in q.get('acciones', []):
            if op.get('estado') == 'en_curso' or op.get('continuacion') in {'pendiente', 'en_curso'}:
                raise ValueError('La conversación tiene una operación en curso; espera a que termine antes de eliminarla')
    inv['preguntasABases'] = [q for q in inv.get('preguntasABases', []) if hilo_de(q) != hilo]
    # Solo IDs, sin conservar los mensajes. Impide que una respuesta tardía
    # o una pestaña antigua vuelvan a crear el hilo después de eliminarlo.
    if not hilo_eliminado(inv, hilo):
        inv.setdefault('hilosEliminados', []).append(hilo)
    return {'eliminada': True, 'investigacionId': investigacion_id, 'hilo': hilo,
            'mensajesEliminados': len(mensajes)}


def operaciones(e: dict):
    for inv in [*e.get('investigaciones', []), e.get('asistenteGlobal') or {}]:
        for q in inv.get('preguntasABases', []):
            for op in q.get('acciones', []):
                yield inv, q, op


def recuperar_interrumpidas(e: dict) -> bool:
    cambio = False
    for _, _, op in operaciones(e):
        if op.get('estado') == 'en_curso':
            op.update(estado='resultado_desconocido', resultado={'error': 'El servidor se reinició antes de registrar el resultado. Se comprobará sin repetir el efecto.'})
            cambio = True
        if op.get('continuacion') == 'en_curso':
            op['continuacion'] = 'pendiente'
            cambio = True
    return cambio
