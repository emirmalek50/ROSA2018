"""Borrado del estado activo de una investigación, con alcance comprobable.

No borra archivos ni la auditoría. Las referencias científicas de otras
investigaciones se comprueban antes de retirar ningún registro.
"""
from __future__ import annotations

import copy
from typing import Any

from rosa.asistente_conversaciones import operaciones

REFERENCIAS = {
    'investigacionId': 'investigaciones', 'corridaId': 'corridas',
    'iteracionId': 'iteraciones', 'hipotesisId': 'hipotesis',
    'planId': 'planesAnalisis', 'ejecucionId': 'ejecuciones',
    'reproduccionId': 'reproducciones', 'artefactoId': 'artefactos', 'hechoId': 'hechos',
}
ESTADOS_ACTIVOS = {'en_marcha', 'esperando_plan', 'esperando_aprobacion', 'esperando_modelo'}


def ids_registros(e: dict) -> set[str]:
    """IDs de registros completos, nunca de referencias como origen={id, tipo}."""
    filas = [x for lista in e.values() if isinstance(lista, list) for x in lista if isinstance(x, dict)]
    for c in e.get('corridas', []):
        for lista in (c.get('_fuentes', []), c.get('_afirmaciones', []), (c.get('busqueda') or {}).get('fuentes', [])):
            filas.extend(x for x in lista if isinstance(x, dict))
    for inv in e.get('investigaciones', []):
        filas.extend(inv.get('datasets', []))
        filas.extend((inv.get('mision') or {}).get('areas', []))
    return {x['id'] for x in filas if isinstance(x.get('id'), str)}


def referencias_a(valor: Any, ids: set[str]) -> set[str]:
    if isinstance(valor, str):
        return {valor} & ids | ({valor.split(':', 1)[1]} & ids if ':' in valor and not any(c.isspace() for c in valor) else set())
    if isinstance(valor, list):
        return set().union(*(referencias_a(v, ids) for v in valor))
    if isinstance(valor, dict):
        # Los chats y la auditoría narrativa no son dependencias científicas.
        return set().union(*(referencias_a(v, ids) for k, v in valor.items() if k != 'preguntasABases'))
    return set()


def planificar(e: dict, investigacion_id: str) -> tuple[dict, dict[str, list[dict]], list[dict]]:
    inv = next((i for i in e.get('investigaciones', []) if i['id'] == investigacion_id), None)
    if inv is None:
        raise ValueError('No se encontró esa investigación. El asistente global no es una investigación.')
    retirados: dict[str, list[dict]] = {'investigaciones': [inv]}
    ids: dict[str, set[str]] = {'investigaciones': {investigacion_id}}
    # Cierre de pertenencia: una iteración pertenece a su corrida y un comentario
    # a su hipótesis. Nunca arrastra registros que declaren otra investigación.
    cambio = True
    while cambio:
        cambio = False
        for tabla, lista in e.items():
            if tabla.startswith('_') or tabla == 'investigaciones' or not isinstance(lista, list):
                continue
            for x in lista:
                if not isinstance(x, dict) or not isinstance(x.get('id'), str) or x['id'] in ids.get(tabla, set()):
                    continue
                propietario = x.get('investigacionId')
                pertenece = propietario == investigacion_id if propietario else any(
                    isinstance(x.get(campo), str) and x[campo] in ids.get(destino, set()) for campo, destino in REFERENCIAS.items())
                if pertenece:
                    retirados.setdefault(tabla, []).append(x)
                    ids.setdefault(tabla, set()).add(x['id'])
                    cambio = True
    datasets = copy.deepcopy(e.get('datasetsPrograma', []))
    conservados = [i for i in e['investigaciones'] if i['id'] != investigacion_id]
    afectados = {d.get('registroProgramaId') for d in inv.get('datasets', [])}
    for d in datasets:
        if investigacion_id not in d.get('usadoEn', []) and d['id'] not in afectados:
            continue
        afectados.add(d['id'])
        d['usadoEn'] = [i for i in d.get('usadoEn', []) if i != investigacion_id]
        d['usadoEn'] = sorted(set(d['usadoEn']) | {i['id'] for i in conservados for ds in i.get('datasets', []) if ds.get('registroProgramaId') == d['id']})
    datasets = [d for d in datasets if d['id'] not in afectados or d.get('fuente') != 'manual' or d.get('usadoEn')]
    return inv, retirados, datasets


def prever(e: dict, investigacion_id: str) -> dict:
    inv, retirados, datasets = planificar(e, investigacion_id)
    bloqueos = []
    for c in retirados.get('corridas', []):
        if c.get('estado') in ESTADOS_ACTIVOS:
            bloqueos.append({'tipo': 'corrida_activa', 'id': c['id'], 'mensaje': 'Detén la corrida y espera a que termine su trabajo antes de borrar.'})
    for tabla in ('ejecuciones', 'reproducciones'):
        for x in retirados.get(tabla, []):
            if x.get('estado') == 'en_curso':
                bloqueos.append({'tipo': 'trabajo_activo', 'id': x['id'], 'mensaje': 'Hay un análisis en curso.'})
    if (inv.get('recuperacionCitas') or {}).get('estado') in {'pedida', 'en_curso', 'en_espera'}:
        bloqueos.append({'tipo': 'recuperacion_citas', 'id': inv['id'], 'mensaje': 'Espera a que termine la recuperación de citas.'})
    eliminados = ids_registros(retirados)
    for contenedor, q, op in operaciones(e):
        if op.get('estado') == 'en_curso' or op.get('continuacion') in {'pendiente', 'en_curso'}:
            if contenedor.get('id') == investigacion_id or referencias_a(op.get('argumentos', {}), eliminados):
                bloqueos.append({'tipo': 'operacion_activa', 'id': op['id'], 'mensaje': 'Espera a que termine la operación del asistente.'})
    for h in retirados.get('hipotesis', []):
        if h.get('_analisisPedido'):
            bloqueos.append({'tipo': 'analisis_pedido', 'id': h['id'], 'mensaje': 'Hay un análisis solicitado que todavía no ha terminado.'})
    supervivientes = {}
    for tabla, valor in e.items():
        if tabla.startswith('_') or tabla in {'asistenteGlobal', 'investigacionesEliminadas'}:
            continue
        borrados = {x['id'] for x in retirados.get(tabla, [])}
        supervivientes[tabla] = [x for x in valor if not isinstance(x, dict) or x.get('id') not in borrados] if isinstance(valor, list) else valor
    supervivientes['datasetsPrograma'] = datasets
    # Una fuente copiada íntegramente a otra corrida sigue disponible allí.
    perdidos = eliminados - ids_registros(supervivientes)
    for tabla, valor in supervivientes.items():
        for x in valor if isinstance(valor, list) else [valor]:
            refs = referencias_a(x, perdidos)
            if refs:
                bloqueos.append({'tipo': 'dependencia_compartida', 'coleccion': tabla,
                                 'id': x.get('id') if isinstance(x, dict) else None, 'referencias': sorted(refs),
                                 'mensaje': 'Otro registro conserva una dependencia de esta investigación; no se borrará junto con ella.'})
    return {'investigacionId': inv['id'], 'titulo': inv['titulo'],
            'registros': {k: len(v) for k, v in retirados.items()},
            'conversaciones': len({q.get('hilo') or q['id'] for q in inv.get('preguntasABases', [])}),
            'mensajes': len(inv.get('preguntasABases', [])), 'datasets': len(inv.get('datasets', [])),
            'puedeEliminar': not bloqueos, 'bloqueos': bloqueos,
            'seConserva': 'Los archivos, las copias de seguridad, la auditoría y los datos de otras investigaciones.'}


def eliminar(e: dict, investigacion_id: str, quien: str, ahora: int) -> dict:
    if not quien:
        raise ValueError('Falta la persona que pide eliminar la investigación')
    if investigacion_id in e.get('investigacionesEliminadas', []):
        return {'eliminada': True, 'investigacionId': investigacion_id, 'repetida': True}
    vista = prever(e, investigacion_id)
    if not vista['puedeEliminar']:
        raise ValueError(vista['bloqueos'][0]['mensaje'])
    _, retirados, datasets = planificar(e, investigacion_id)
    for tabla, registros in retirados.items():
        ids = {r['id'] for r in registros}
        e[tabla] = [r for r in e[tabla] if not isinstance(r, dict) or r.get('id') not in ids]
    e['datasetsPrograma'] = datasets
    e.setdefault('investigacionesEliminadas', []).append(investigacion_id)
    return {'eliminada': True, 'investigacionId': investigacion_id, 'titulo': vista['titulo'],
            'registrosEliminados': vista['registros'], 'eliminadaEn': ahora, 'quien': quien,
            'seConserva': vista['seConserva']}
