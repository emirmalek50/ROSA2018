"""Retirada de datasets con comprobación de usos y limpieza recuperable.

Primero se registra la retirada en SQLite; después se borra su carpeta privada.
Si falla el disco o se reinicia ROSA entre ambos pasos, la misma operación puede
completar la limpieza sin volver a retirar registros ni borrar otros datasets.
El historial y la auditoría se conservan.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from rosa import datos as D
from rosa.estado import plantilla as P


def _carpeta(investigacion_id: str, dataset_id: str) -> Path:
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', x) for x in (investigacion_id, dataset_id)):
        raise HTTPException(400, 'Identificador de dataset o investigación inválido')
    raiz = D.DIR_DATASETS
    carpeta = raiz / investigacion_id / dataset_id
    if any(p.is_symlink() for p in (raiz, carpeta.parent, carpeta)) or not carpeta.resolve().is_relative_to(raiz.resolve()):
        raise HTTPException(409, 'La carpeta del dataset no es una ubicación segura para borrar')
    return carpeta


def _consultar(e: dict, investigacion_id: str, dataset_id: str) -> dict:
    inv = next((i for i in e['investigaciones'] if i['id'] == investigacion_id), None)
    if inv is None:
        raise HTTPException(404, 'Investigación desconocida')
    carpeta = _carpeta(investigacion_id, dataset_id)
    ds = next((d for d in inv.get('datasets', []) if d['id'] == dataset_id), None)
    retirada = e.get('_datasetsEliminados', {}).get(f'{investigacion_id}/{dataset_id}')
    if ds is None and retirada is None:
        raise HTTPException(404, 'Dataset desconocido en esta investigación')
    usos: list[dict[str, Any]] = []
    if ds is not None:
        for tabla in ('planesAnalisis', 'reproducciones'):
            usos.extend({'tipo': tabla, 'id': x['id']} for x in e.get(tabla, [])
                        if x.get('datasetId') == dataset_id and x.get('investigacionId', investigacion_id) == investigacion_id)
        usos.extend({'tipo': 'analisisPedido', 'id': h['id']} for h in e.get('hipotesis', [])
                    if h.get('investigacionId') == investigacion_id and (h.get('_analisisPedido') or {}).get('datasetId') == dataset_id)
        # El bucle puede tener ya una copia del dataset antes de guardar su plan.
        usos.extend({'tipo': 'corridaActiva', 'id': c['id']} for c in e.get('corridas', [])
                    if c.get('investigacionId') == investigacion_id and c.get('estado') in {'en_marcha', 'esperando_plan', 'esperando_aprobacion', 'esperando_modelo'})
    archivo_eliminado = ds is None and not carpeta.exists()
    nota = 'Se eliminarán el dataset y su carpeta. Se conserva el historial de auditoría.'
    if ds is None:
        nota = 'El dataset y su archivo ya están eliminados.' if archivo_eliminado else 'El dataset está retirado, pero falta borrar su carpeta. Repite la operación para completar la limpieza.'
    elif usos:
        nota = 'Los análisis registrados conservan sus datos. Detén la corrida si sigue usando esta investigación.'
    return {'investigacionId': investigacion_id, 'datasetId': dataset_id, 'nombre': (ds or retirada)['nombre'],
            'eliminado': ds is None, 'archivoEliminado': archivo_eliminado,
            'puedeEliminar': not usos, 'referencias': usos, 'nota': nota}


def consultar(almacen: Any, investigacion_id: str, dataset_id: str) -> dict:
    # Incluye las solicitudes de análisis privadas; la instantánea pública las oculta.
    with almacen._lock:
        return _consultar(almacen.estado, investigacion_id, dataset_id)


def _retirar_registro(e: dict, inv: dict, ds: dict) -> None:
    registro_id = ds.get('registroProgramaId')
    for r in list(e.get('datasetsPrograma', [])):
        if r.get('id') != registro_id or r.get('fuente') != 'manual':
            continue
        otros = [(i['id'], d) for i in e['investigaciones'] for d in i.get('datasets', []) if d.get('registroProgramaId') == registro_id]
        usados = set(r.get('usadoEn') or [])
        if not any(i == inv['id'] for i, _ in otros):
            usados.discard(inv['id'])
        usados.update(i for i, _ in otros)
        if not usados and not otros:
            e['datasetsPrograma'].remove(r)
        else:
            r['usadoEn'] = sorted(usados)
            r['fichero'] = (otros[0][1].get('procedencia') or {}).get('fichero') if otros else None
            r.setdefault('registro', []).append(f"Retirado el dataset {ds['id']} de {inv['id']}; se conservan los demás usos.")


def eliminar(almacen: Any, investigacion_id: str, dataset_id: str, quien: str) -> dict:
    clave = f'{investigacion_id}/{dataset_id}'
    args = {'investigacion_id': investigacion_id, 'dataset_id': dataset_id}
    # Serializa también los reintentos para no competir sobre la carpeta.
    with almacen._lock:
        vista = _consultar(almacen.estado, investigacion_id, dataset_id)
        if not vista['puedeEliminar']:
            raise HTTPException(409, {'mensaje': 'El dataset tiene usos que deben conservarse; no se borró nada.', 'referencias': vista['referencias']})
        carpeta = _carpeta(investigacion_id, dataset_id)
        if not vista['eliminado']:
            def retirar(e):
                from rosa.estado.acciones import recalcular_bloqueos
                inv = next(i for i in e['investigaciones'] if i['id'] == investigacion_id)
                ds = next(d for d in inv['datasets'] if d['id'] == dataset_id)
                inv['datasets'].remove(ds)
                _retirar_registro(e, inv, ds)
                e.setdefault('_datasetsEliminados', {})[clave] = {'nombre': ds['nombre'], 'eliminadoEn': P.ahora_ms(), 'archivoEliminado': False}
                for h in e.get('hipotesis', []):
                    if h['investigacionId'] == investigacion_id:
                        recalcular_bloqueos(e, h)
                return {'datasetId': dataset_id, 'nombre': ds['nombre'], 'eliminado': True}
            almacen.mutar(retirar, nombre='eliminarDataset', args=args, actor=quien)
        try:
            if carpeta.exists():
                shutil.rmtree(carpeta)
        except OSError as ex:
            raise HTTPException(503, 'El dataset se retiró de ROSA, pero no se pudo borrar su carpeta. Consulta su estado y vuelve a pedir la eliminación para completar la limpieza.') from ex
        if not almacen.estado['_datasetsEliminados'][clave]['archivoEliminado']:
            def completar(e):
                e['_datasetsEliminados'][clave]['archivoEliminado'] = True
                return {'datasetId': dataset_id, 'archivoEliminado': True}
            almacen.mutar(completar, nombre='eliminarArchivoDataset', args=args, actor=quien)
        return {'ok': True, **_consultar(almacen.estado, investigacion_id, dataset_id)}
