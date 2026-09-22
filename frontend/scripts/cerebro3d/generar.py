# -*- coding: utf-8 -*-
"""Genera las mallas 3D del atlas de ROSA2018 a partir de BodyParts3D.

Es un paso de taller, no de ejecución: ROSA2018 no depende de este guion ni de
sus bibliotecas. Se corre a mano cuando haya que rehacer las mallas.

Preparación (una sola vez, fuera del proyecto):

    python3.12 -m venv /tmp/venv3d
    /tmp/venv3d/bin/pip install numpy trimesh fast-simplification

Descarga del original (unos 136 MB, no se guarda en el repositorio):

    mkdir -p /tmp/bp3d && cd /tmp/bp3d
    curl -L -O https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip
    curl -L -O https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_element_parts.txt
    unzip -q isa_BP3D_4.0_obj_99.zip

Generación:

    /tmp/venv3d/bin/python frontend/scripts/cerebro3d/generar.py \
        --origen /tmp/bp3d --salida frontend/src/datos/cerebro3d

Qué hace, en orden:

1. Lee ``isa_element_parts.txt`` y traduce cada concepto anatómico a la lista de
   ficheros OBJ que lo componen.
2. Junta los OBJ de cada estructura y suelda los vértices repetidos.
3. Gira el sistema de coordenadas de BodyParts3D (x a la izquierda, y hacia
   atrás, z arriba) al de ROSA2018 (x a la derecha, y arriba, z hacia atrás).
   Es un giro puro, con determinante +1: no hay espejo, así que el cerebro no
   sale invertido y el sentido de los triángulos se conserva.
4. Recentra el conjunto entero en el origen usando el centro de la caja
   envolvente de todas las estructuras juntas. No reescala: las unidades siguen
   siendo milímetros y el cerebro entero mide menos de 200 mm en su lado mayor.
5. Simplifica cada malla hasta el número de triángulos de ``estructuras.py``.
6. Arregla el sentido de los triángulos para que las normales apunten hacia
   fuera y el orden quede antihorario visto desde fuera.
7. Escribe un ``.bin`` por estructura y un ``indice.json``.
"""

from __future__ import annotations

import argparse
import collections
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from estructuras import AUSENTES, CORTE_INFERIOR, ESTRUCTURAS  # noqa: E402

MARCA = b"R2M1"
VERSION_FORMATO = 1

FUENTE = "BodyParts3D 4.0, Database Center for Life Science (DBCLS)"
URL = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html"
LICENCIA = "CC BY 4.0"
ATRIBUCION = (
    "BodyParts3D, © The Database Center for Life Science, "
    "con licencia CC Attribution 4.0 International. "
    "Mallas simplificadas y recentradas por ROSA2018."
)
EJES = "x a la derecha, y arriba, z hacia atrás (hacia el occipucio)"
UNIDAD = "milímetros"


def huella_zip(origen: Path) -> str:
    """Huella SHA-256 del zip original, si sigue al lado de los OBJ."""
    import hashlib

    ruta = origen / "isa_BP3D_4.0_obj_99.zip"
    if not ruta.exists():
        return "sin comprobar: el zip no está en la carpeta de origen"
    resumen = hashlib.sha256()
    with ruta.open("rb") as fichero:
        for trozo in iter(lambda: fichero.read(1 << 20), b""):
            resumen.update(trozo)
    return resumen.hexdigest()


def leer_elementos(origen: Path) -> dict[str, set[str]]:
    """Devuelve, por concepto anatómico, el conjunto de ficheros OBJ."""
    mapa: dict[str, set[str]] = collections.defaultdict(set)
    ruta = origen / "isa_element_parts.txt"
    with ruta.open(encoding="utf-8") as fichero:
        next(fichero)
        for linea in fichero:
            partes = linea.rstrip("\n").split("\t")
            if len(partes) >= 3:
                mapa[partes[1]].add(partes[2])
    return mapa


def cargar(
    origen: Path,
    mapa: dict[str, set[str]],
    conceptos: list[str],
    procedencia: dict[str, list[str]] | None = None,
) -> trimesh.Trimesh:
    """Junta en una sola malla todos los OBJ de los conceptos indicados."""
    carpeta = origen / "isa_BP3D_4.0_obj_99"
    piezas = []
    vistos: set[str] = set()
    for concepto in conceptos:
        elementos = mapa.get(concepto)
        if not elementos:
            raise SystemExit(f"BodyParts3D no tiene el concepto «{concepto}»")
        for elemento in sorted(elementos):
            if elemento in vistos:
                continue
            vistos.add(elemento)
            if procedencia is not None:
                procedencia.setdefault(concepto, []).append(elemento)
            piezas.append(trimesh.load(carpeta / f"{elemento}.obj", process=False))
    malla = trimesh.util.concatenate(piezas)
    malla.merge_vertices()
    return malla


# Giro de BodyParts3D a ROSA2018. Columnas: a dónde va cada eje de origen.
#   x de BodyParts3D apunta a la izquierda del cuerpo -> -X (derecha)
#   y de BodyParts3D apunta hacia atrás               ->  Z (hacia atrás)
#   z de BodyParts3D apunta hacia arriba              ->  Y (arriba)
GIRO = np.array(
    [
        [-1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 1.0, 0.0],
    ]
)


def girar(vertices: np.ndarray) -> np.ndarray:
    return vertices @ GIRO.T


def recortar_por_debajo(malla: trimesh.Trimesh, altura: float) -> trimesh.Trimesh:
    """Quita los triángulos que caen por debajo de ``altura`` en el eje Y.

    Corta por triángulos enteros, sin cortar aristas ni tapar el agujero: la
    malla recortada queda abierta por abajo. Para los tubos de las arterias eso
    no se nota y evita meter más dependencias en el taller.
    """
    vertices = np.asarray(malla.vertices)
    centros = vertices[malla.faces][:, :, 1].mean(axis=1)
    recortada = malla.copy()
    recortada.update_faces(centros >= altura)
    recortada.remove_unreferenced_vertices()
    return recortada


def simplificar(malla: trimesh.Trimesh, objetivo: int) -> trimesh.Trimesh:
    if len(malla.faces) <= objetivo:
        return malla
    import fast_simplification

    vertices, caras = fast_simplification.simplify(
        np.asarray(malla.vertices, dtype=np.float32),
        np.asarray(malla.faces, dtype=np.uint32),
        target_count=objetivo,
    )
    return trimesh.Trimesh(vertices=vertices, faces=caras, process=False)


def escribir_bin(ruta: Path, malla: trimesh.Trimesh) -> None:
    posiciones = np.asarray(malla.vertices, dtype="<f4")
    normales = np.asarray(malla.vertex_normals, dtype=np.float64).copy()
    normales[~np.isfinite(normales)] = 0.0
    largo = np.linalg.norm(normales, axis=1)
    # Un vértice suelto o de un triángulo degenerado se queda sin normal. En vez
    # de publicar un vector nulo, que rompería la iluminación del visor, se le
    # pone la dirección que va del centro de la malla al propio vértice.
    huerfanas = largo < 1e-9
    if huerfanas.any():
        centro = posiciones.astype(np.float64).mean(axis=0)
        repuesto = posiciones[huerfanas].astype(np.float64) - centro
        norma = np.linalg.norm(repuesto, axis=1)
        repuesto[norma < 1e-9] = np.array([0.0, 1.0, 0.0])
        norma[norma < 1e-9] = 1.0
        normales[huerfanas] = repuesto / norma[:, None]
        largo = np.linalg.norm(normales, axis=1)
    normales = (normales / largo[:, None]).astype("<f4")
    indices = np.asarray(malla.faces, dtype="<u4")
    with ruta.open("wb") as fichero:
        fichero.write(MARCA)
        fichero.write(struct.pack("<III", len(posiciones), len(indices), 0))
        fichero.write(posiciones.tobytes())
        fichero.write(normales.tobytes())
        fichero.write(indices.tobytes())


def main() -> None:
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("--origen", required=True, type=Path)
    analizador.add_argument("--salida", required=True, type=Path)
    argumentos = analizador.parse_args()

    origen: Path = argumentos.origen
    salida: Path = argumentos.salida
    salida.mkdir(parents=True, exist_ok=True)

    mapa = leer_elementos(origen)
    sha256_zip = huella_zip(origen)

    # Primera pasada: cargar y girar, para poder recentrar el conjunto entero
    # con un solo origen compartido.
    crudas = []
    procedencias: dict[str, dict[str, list[str]]] = {}
    for clave, nombre, conceptos, objetivo, nota in ESTRUCTURAS:
        procedencia: dict[str, list[str]] = {}
        malla = cargar(origen, mapa, conceptos, procedencia)
        procedencias[clave] = procedencia
        malla.vertices = girar(np.asarray(malla.vertices))
        crudas.append((clave, nombre, malla, objetivo, nota))
        print(f"  cargada {clave}: {len(malla.faces)} triángulos")

    # Recortes: algunas mallas de la fuente se salen del encéfalo (las arterias
    # vertebrales bajan por el cuello). Se cortan por el suelo de la estructura
    # de referencia para que la caja envolvente sea la del cerebro.
    suelos = {
        clave: float(np.asarray(malla.vertices)[:, 1].min())
        for clave, _, malla, _, _ in crudas
    }
    for indice_estructura, (clave, nombre, malla, objetivo, nota) in enumerate(crudas):
        referencia = CORTE_INFERIOR.get(clave)
        if referencia is None:
            continue
        altura = suelos[referencia]
        cortada = recortar_por_debajo(malla, altura)
        print(f"  recortada {clave} por debajo de y={altura:.1f}: "
              f"{len(malla.faces)} -> {len(cortada.faces)} triángulos")
        crudas[indice_estructura] = (clave, nombre, cortada, objetivo, nota)

    todos = np.vstack([m.vertices for _, _, m, _, _ in crudas])
    centro = (todos.min(axis=0) + todos.max(axis=0)) / 2.0
    lado = (todos.max(axis=0) - todos.min(axis=0)).max()
    print(f"  centro {centro.round(2).tolist()}  lado mayor {lado:.1f} mm")
    if lado > 200:
        raise SystemExit("el cerebro no cabe en 200 unidades, habría que reescalar")

    estructuras = []
    for clave, nombre, malla, objetivo, nota in crudas:
        malla.vertices = np.asarray(malla.vertices) - centro
        malla = simplificar(malla, objetivo)
        malla.merge_vertices()
        malla.update_faces(malla.nondegenerate_faces())
        malla.remove_unreferenced_vertices()
        trimesh.repair.fix_normals(malla)
        ruta = salida / f"{clave}.bin"
        escribir_bin(ruta, malla)
        caja = np.vstack([malla.vertices.min(axis=0), malla.vertices.max(axis=0)])
        estructuras.append(
            {
                "clave": clave,
                "nombre": nombre,
                "fichero": f"{clave}.bin",
                "vertices": int(len(malla.vertices)),
                "triangulos": int(len(malla.faces)),
                "caja": [round(float(v), 3) for v in caja.flatten()],
                "nota": nota,
            }
        )
        print(
            f"  escrita {clave}: {len(malla.vertices)} vértices, "
            f"{len(malla.faces)} triángulos, {ruta.stat().st_size / 1024:.0f} kB"
        )

    indice = {
        "version": VERSION_FORMATO,
        "fuente": FUENTE,
        "url": URL,
        "licencia": LICENCIA,
        "atribucion": ATRIBUCION,
        "ejes": EJES,
        "unidad": UNIDAD,
        "hemisferios": "los dos",
        "ausentes": AUSENTES,
        "estructuras": estructuras,
    }
    (salida / "indice.json").write_text(
        json.dumps(indice, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (salida / "procedencia.json").write_text(
        json.dumps(
            {
                "fuente": FUENTE,
                "url": URL,
                "zip": "isa_BP3D_4.0_obj_99.zip",
                "sha256_zip": sha256_zip,
                "explicacion": (
                    "Por cada estructura publicada, los conceptos anatómicos de "
                    "BodyParts3D que la componen y los ficheros OBJ de cada uno."
                ),
                "estructuras": procedencias,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    peso = sum((salida / e["fichero"]).stat().st_size for e in estructuras)
    print(f"  total {peso / 1024 / 1024:.2f} MB en {len(estructuras)} mallas")


if __name__ == "__main__":
    main()
