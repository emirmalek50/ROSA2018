"""Conversaciones del proyecto, también antes de crear una investigación."""
from __future__ import annotations
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
