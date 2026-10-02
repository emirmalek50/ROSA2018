"""Lecturas completas y paginadas del asistente, sin rutas elegidas por el modelo."""
from __future__ import annotations

import csv
import json
import sqlite3
import subprocess
from pathlib import Path
from contextlib import closing
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
    from rosa.asistente_datasets import consultar_filas
    if ruta.suffix.lower() == '.txt':
        with ruta.open(encoding='utf-8-sig', errors='replace') as f:
            muestra = f.read(10000)
        try:
            csv.Sniffer().sniff(muestra, delimiters=',;\t|')
        except csv.Error:
            return {'texto': ruta.read_text(encoding='utf-8-sig', errors='replace')}
    return consultar_filas(ruta, desde, limite, columnas, filtros, campo)


def trazas_gepa(almacen: Any, desde: int = 0, limite: int = 25, tipo: str = '', programa: str = '', corrida: str = '', desde_ciclos: int = 0, limite_ciclos: int = 10, hasta: int | None = None, hasta_ciclos: int | None = None) -> dict:
    ruta = almacen.ruta.parent / 'datos' / '_gepa' / almacen.ruta.name / 'trazas.db'
    if not ruta.is_file():
        return {'ok': False, 'error': 'No hay archivo de trazas GEPA disponible en esta instalación'}
    desde, limite = max(0, desde), max(1, min(100, limite))
    desde_ciclos, limite_ciclos = max(0, desde_ciclos), max(1, min(50, limite_ciclos))
    filtros: list[str] = []
    args: list[Any] = []
    for clave, valor in (('tipo', tipo), ('programa', programa), ('corrida', corrida)):
        if valor:
            filtros.append(clave + '=?')
            args.append(valor)
    filtros.append('seq <= ?')
    where = ' WHERE ' + ' AND '.join(filtros)
    from rosa.gepa_continuo import sanear
    with closing(sqlite3.connect(ruta.as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        if hasta is None:
            hasta = db.execute('SELECT COALESCE(MAX(seq),0) FROM trazas').fetchone()[0]
        if hasta_ciclos is None:
            hasta_ciclos = db.execute('SELECT COALESCE(MAX(rowid),0) FROM ciclos').fetchone()[0]
        args.append(hasta)
        total_ciclos = db.execute('SELECT count(*) FROM ciclos WHERE rowid<=?', (hasta_ciclos,)).fetchone()[0]
        total = db.execute('SELECT count(*) FROM trazas' + where, args).fetchone()[0]
        filas = db.execute('SELECT seq,fecha,tipo,programa,corrida,json FROM trazas' + where + ' ORDER BY seq LIMIT ? OFFSET ?', [*args, max(1, min(100, limite)), max(0, desde)]).fetchall()
        ciclos = [json.loads(r[0]) for r in db.execute('SELECT json FROM ciclos WHERE rowid<=? ORDER BY rowid DESC LIMIT ? OFFSET ?', (hasta_ciclos, limite_ciclos, desde_ciclos))]
    return {'total': total, 'desde': desde, 'hasta': hasta, 'hastaCiclos': hasta_ciclos,
            'totalCiclos': total_ciclos, 'desdeCiclos': desde_ciclos,
            'siguienteCiclos': desde_ciclos + len(ciclos) if desde_ciclos + len(ciclos) < total_ciclos else None, 'siguiente': desde + len(filas) if desde + len(filas) < total else None,
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
