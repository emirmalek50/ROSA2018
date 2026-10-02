"""Lecturas completas y paginadas del asistente, sin rutas elegidas por el modelo."""
from __future__ import annotations

import csv
import io
import json
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parent.parent


def documentos() -> dict[str, Path]:
    """Solo documentación versionada del proyecto; ni datos ni enlaces simbólicos."""
    r = subprocess.run(['git', 'ls-files', '-z', '--', '*.md'], cwd=RAIZ, capture_output=True, check=True)
    salida = {}
    for nombre in r.stdout.decode().split('\0'):
        p = RAIZ / nombre
        if not nombre or nombre.startswith(('datos/', 'pdfs/', 'node_modules/', 'frontend/node_modules/', '.')):
            continue
        if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(RAIZ):
            salida[nombre] = p
    return salida


def filas_dataset(ruta: Path, desde: int, limite: int, columnas: list[str], filtros: dict[str, str], campo: str = '') -> dict:
    """Página de filas seleccionadas; el llamador ya comprobó procedencia."""
    if ruta.suffix.lower() not in {'.csv', '.tsv', '.json', '.txt'}:
        return {'ok': False, 'error': 'Este archivo no es una tabla CSV, TSV o JSON ni texto legible'}
    desde, limite = max(0, desde), max(1, min(200, limite))
    try:
        raw = ruta.read_text(encoding='utf-8-sig')
    except UnicodeDecodeError:
        raw = ruta.read_text(encoding='latin-1')
    csv.field_size_limit(max(csv.field_size_limit(), len(raw)))
    if ruta.suffix.lower() == '.json':
        datos = json.loads(raw)
        for clave in campo.split('/') if campo else []:
            datos = datos[int(clave)] if isinstance(datos, list) else datos[clave]
        if not isinstance(datos, list):
            return {'error': 'Selecciona una lista de filas mediante campo', 'campos': list(datos) if isinstance(datos, dict) else []}
        filas = [f if isinstance(f, dict) else {'valor': f} for f in datos]
        cabecera = sorted({k for f in filas for k in f})
    else:
        try:
            dialecto = csv.Sniffer().sniff(raw[:10000], delimiters=',;\t|')
        except csv.Error:
            if ruta.suffix.lower() == '.txt':
                return {'texto': raw}
            dialecto = csv.excel_tab if ruta.suffix.lower() == '.tsv' else csv.excel
        lector = csv.DictReader(io.StringIO(raw), dialect=dialecto)
        cabecera = list(lector.fieldnames or [])
        filas = list(lector)
    desconocidas = (set(columnas) | set(filtros)) - set(cabecera)
    if desconocidas:
        return {'error': 'Columnas desconocidas', 'columnas': cabecera}
    seleccion = [(n, f) for n, f in enumerate(filas) if all(str(f.get(k, '')) == v for k, v in filtros.items())]
    return {'totalFilas': len(filas), 'totalFiltrado': len(seleccion), 'columnas': cabecera, 'desde': desde,
            'siguiente': desde + limite if desde + limite < len(seleccion) else None,
            'filas': [{'indice': n, 'valores': {k: f.get(k) for k in columnas or cabecera}} for n, f in seleccion[desde:desde + limite]]}


def trazas_gepa(almacen: Any, desde: int = 0, limite: int = 25, tipo: str = '', programa: str = '', corrida: str = '') -> dict:
    ruta = almacen.ruta.parent / 'datos' / '_gepa' / almacen.ruta.name / 'trazas.db'
    if not ruta.is_file():
        return {'ok': False, 'error': 'No hay archivo de trazas GEPA disponible en esta instalación'}
    filtros, args = [], []
    for clave, valor in (('tipo', tipo), ('programa', programa), ('corrida', corrida)):
        if valor:
            filtros.append(clave + '=?')
            args.append(valor)
    where = ' WHERE ' + ' AND '.join(filtros) if filtros else ''
    from rosa.gepa_continuo import sanear
    with sqlite3.connect(ruta.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('BEGIN')
        total = db.execute('SELECT count(*) FROM trazas' + where, args).fetchone()[0]
        filas = db.execute('SELECT seq,fecha,tipo,programa,corrida,json FROM trazas' + where + ' ORDER BY seq LIMIT ? OFFSET ?', [*args, max(1, min(100, limite)), max(0, desde)]).fetchall()
        ciclos = [json.loads(r[0]) for r in db.execute('SELECT json FROM ciclos ORDER BY fecha DESC')]
    return {'total': total, 'desde': desde, 'siguiente': desde + len(filas) if desde + len(filas) < total else None,
            'trazas': [dict(zip(('secuencia', 'fecha', 'tipo', 'programa', 'corrida'), f[:5]), contenido=sanear(json.loads(f[5]))) for f in filas], 'ciclos': sanear(ciclos)}


def vista_compartida(estado: dict, investigacion: str, vista: str, filtros: dict) -> dict:
    """Ejecuta las mismas funciones TypeScript que utilizan las pantallas."""
    bundle = RAIZ / 'frontend/dist/servicios-vistas.cjs'
    if not bundle.is_file():
        return {'ok': False, 'error': 'Falta compilar las vistas compartidas del frontend'}
    try:
        r = subprocess.run(['node', str(bundle)], input=json.dumps({'estado': estado, 'investigacion': investigacion, 'vista': vista, 'filtros': filtros}), text=True, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return {'ok': False, 'error': 'No pude ejecutar el cálculo compartido de la vista'}
    if r.returncode:
        return {'ok': False, 'error': 'No se pudo calcular la vista compartida'}
    return json.loads(r.stdout)
