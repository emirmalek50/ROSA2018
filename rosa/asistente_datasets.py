"""Índice local de filas: una lectura secuencial por versión del archivo."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import sqlite3
import tempfile
import threading
from pathlib import Path
from contextlib import closing
from typing import Any

import ijson

_CANDADOS = [threading.Lock() for _ in range(32)]


def _valor(primero, eventos, conservar=True):
    constructor = ijson.ObjectBuilder() if conservar else None
    evento, valor = primero
    profundidad = 0
    while True:
        if constructor is not None:
            constructor.event(evento, valor)
        if evento in ('start_map', 'start_array'):
            profundidad += 1
        elif evento in ('end_map', 'end_array'):
            profundidad -= 1
        if profundidad == 0:
            return constructor.value if constructor is not None else None
        evento, valor = next(eventos)


def _filas_json(primero, eventos, camino):
    evento, _ = primero
    if not camino:
        if evento != 'start_array':
            raise ValueError('El campo elegido debe ser una lista de filas JSON')
        for inicio in eventos:
            if inicio[0] == 'end_array':
                return
            valor = _valor(inicio, eventos)
            yield valor if isinstance(valor, dict) else {'valor': valor}
        raise ValueError('Lista JSON incompleta')
    encontrada = False
    if evento == 'start_map':
        for tipo, clave in eventos:
            if tipo == 'end_map':
                break
            if tipo != 'map_key':
                raise ValueError('Objeto JSON inválido')
            inicio = next(eventos)
            if clave == camino[0]:
                encontrada = True
                yield from _filas_json(inicio, eventos, camino[1:])
            else:
                _valor(inicio, eventos, conservar=False)
    elif evento == 'start_array':
        for n, inicio in enumerate(eventos):
            if inicio[0] == 'end_array':
                break
            if str(n) == camino[0]:
                encontrada = True
                yield from _filas_json(inicio, eventos, camino[1:])
            else:
                _valor(inicio, eventos, conservar=False)
    if not encontrada:
        raise ValueError('No se encontró la lista JSON indicada por campo')


def _leer_filas(ruta: Path, campo: str, codificacion: str):
    if ruta.suffix.lower() == '.json':
        with ruta.open('rb') as f:
            # Tolera la marca UTF-8 de los archivos exportados por hojas de cálculo.
            if f.read(3) != b'\xef\xbb\xbf':
                f.seek(0)
            eventos = iter(ijson.basic_parse(f, use_float=True))
            yield from _filas_json(next(eventos), eventos, campo.split('/') if campo else [])
            if next(eventos, None) is not None:
                raise ValueError('Contenido después del documento JSON')
        return
    with ruta.open(encoding=codificacion, newline='') as f:
        muestra = f.read(10000)
        f.seek(0)
        try:
            dialecto = csv.Sniffer().sniff(muestra, delimiters=',;\t|')
        except csv.Error:
            dialecto = csv.excel_tab if ruta.suffix.lower() == '.tsv' else csv.excel
        csv.field_size_limit(max(csv.field_size_limit(), ruta.stat().st_size))
        yield from csv.DictReader(f, dialect=dialecto)


def _firma(ruta: Path) -> str:
    stat = ruta.stat()
    return f'{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'


def _crear_indice(ruta: Path, destino: Path, campo: str, firma: str, codificacion='utf-8-sig') -> None:
    fd, temporal = tempfile.mkstemp(dir=destino.parent, suffix='.db')
    os.close(fd)
    try:
        with closing(sqlite3.connect(temporal)) as db, db:
            db.executescript('CREATE TABLE meta(json TEXT); CREATE TABLE filas(n INTEGER PRIMARY KEY, json TEXT); CREATE TABLE celdas(n INTEGER, clave TEXT, valor TEXT);')
            columnas: dict[str, None] = {}
            total = 0
            for total, fila in enumerate(_leer_filas(ruta, campo, codificacion), start=1):
                if None in fila:
                    raise ValueError('Hay filas con más celdas que la cabecera')
                columnas.update(dict.fromkeys(fila))
                db.execute('INSERT INTO filas VALUES(?,?)', (total - 1, json.dumps(fila, ensure_ascii=False)))
                db.executemany('INSERT INTO celdas VALUES(?,?,?)', ((total - 1, k, str(v)) for k, v in fila.items()))
            if total == 0 and ruta.suffix.lower() != '.json':
                with ruta.open(encoding=codificacion, newline='') as f:
                    muestra = f.read(10000)
                    f.seek(0)
                    try:
                        dialecto = csv.Sniffer().sniff(muestra, delimiters=',;\t|')
                    except csv.Error:
                        dialecto = csv.excel_tab if ruta.suffix.lower() == '.tsv' else csv.excel
                    columnas.update(dict.fromkeys(csv.DictReader(f, dialect=dialecto).fieldnames or []))
            db.execute('CREATE INDEX buscar_celdas ON celdas(clave,valor,n)')
            db.execute('INSERT INTO meta VALUES(?)', (json.dumps({'firma': firma, 'columnas': list(columnas), 'total': total}),))
        if _firma(ruta) != firma:
            raise ValueError('El archivo cambió durante la lectura; vuelve a consultar')
        os.replace(temporal, destino)
    except (ijson.JSONError, StopIteration, csv.Error) as ex:
        raise ValueError('No pude leer la tabla: formato incompleto o inválido') from ex
    finally:
        Path(temporal).unlink(missing_ok=True)


def consultar_filas(ruta: Path, desde: int, limite: int, columnas: list[str], filtros: dict[str, str], campo: str = '') -> dict[str, Any]:
    from rosa import config
    carpeta = config.RAIZ / 'datos' / '_asistente_indices'
    carpeta.mkdir(parents=True, exist_ok=True, mode=0o700)
    clave = hashlib.sha256(json.dumps([str(ruta.resolve()), campo]).encode()).hexdigest()
    destino = carpeta / (clave + '.db')
    firma = _firma(ruta)
    with _CANDADOS[int(clave[:4], 16) % len(_CANDADOS)]:
        vigente = False
        if destino.is_file():
            try:
                with closing(sqlite3.connect(destino.as_uri() + '?mode=ro', uri=True)) as db:
                    vigente = json.loads(db.execute('SELECT json FROM meta').fetchone()[0])['firma'] == firma
            except (sqlite3.Error, ValueError, TypeError, KeyError):
                vigente = False
        if not vigente:
            try:
                _crear_indice(ruta, destino, campo, firma)
            except UnicodeDecodeError:
                _crear_indice(ruta, destino, campo, firma, 'latin-1')
        with closing(sqlite3.connect(destino.as_uri() + '?mode=ro', uri=True)) as db:
            meta = json.loads(db.execute('SELECT json FROM meta').fetchone()[0])
            if (set(columnas) | set(filtros)) - set(meta['columnas']):
                return {'ok': False, 'error': 'Columnas desconocidas', 'columnas': meta['columnas']}
            # Los filtros y nombres de columna son datos SQL, nunca identificadores.
            partes, args = [], []
            for k, v in filtros.items():
                if v == '':
                    partes.append('(n NOT IN (SELECT n FROM celdas WHERE clave=?) OR n IN (SELECT n FROM celdas WHERE clave=? AND valor=?))')
                    args.extend([k, k, v])
                else:
                    partes.append('n IN (SELECT n FROM celdas WHERE clave=? AND valor=?)')
                    args.extend([k, v])
            where = ' WHERE ' + ' AND '.join(partes) if partes else ''
            total = db.execute('SELECT count(*) FROM filas' + where, args).fetchone()[0] if filtros else meta['total']
            desde, limite = max(0, desde), max(1, min(200, limite))
            registros = db.execute('SELECT n,json FROM filas' + where + ' ORDER BY n LIMIT ? OFFSET ?', [*args, limite, desde]).fetchall()
    filas = []
    for n, texto in registros:
        fila = json.loads(texto)
        filas.append({'indice': n, 'valores': {k: fila.get(k) for k in columnas or meta['columnas']}})
    return {'totalFilas': meta['total'], 'totalFiltrado': total, 'columnas': meta['columnas'], 'desde': desde,
            'siguiente': desde + len(filas) if desde + len(filas) < total else None, 'filas': filas}
