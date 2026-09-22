# -*- coding: utf-8 -*-
"""Vuelve a leer las mallas publicadas y las mide, pinta y compara.

    /tmp/venv3d/bin/python frontend/scripts/cerebro3d/comprobar.py \
        --datos frontend/src/datos/cerebro3d --capturas /tmp/capturas

Comprueba, malla por malla:

- que la marca, el número de vértices y el número de triángulos del fichero
  cuadran con el tamaño real del fichero y con ``indice.json``;
- que la caja envolvente que se lee del binario es la que dice el índice;
- que las normales están normalizadas;
- que las normales apuntan hacia fuera, midiendo el volumen con signo: si el
  orden de los triángulos es antihorario visto desde fuera, el volumen sale
  positivo;
- que ninguna estructura se sale de la caja de 200 unidades.

Y saca capturas desde tres ángulos para mirarlas con los ojos, que es la única
prueba que de verdad dice si un cerebro parece un cerebro.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np

MARCA = b"R2M1"


def leer_bin(ruta: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Lee un .bin de ROSA2018 y devuelve posiciones, normales e índices."""
    datos = ruta.read_bytes()
    if datos[:4] != MARCA:
        raise SystemExit(f"{ruta.name}: la marca no es R2M1")
    n_vertices, n_triangulos, banderas = struct.unpack_from("<III", datos, 4)
    if banderas != 0:
        raise SystemExit(f"{ruta.name}: banderas {banderas}, esperaba 0")
    inicio = 16
    fin_pos = inicio + n_vertices * 12
    fin_nor = fin_pos + n_vertices * 12
    fin_idx = fin_nor + n_triangulos * 12
    if len(datos) != fin_idx:
        raise SystemExit(f"{ruta.name}: mide {len(datos)} bytes, esperaba {fin_idx}")
    posiciones = np.frombuffer(datos, "<f4", n_vertices * 3, inicio).reshape(-1, 3)
    normales = np.frombuffer(datos, "<f4", n_vertices * 3, fin_pos).reshape(-1, 3)
    indices = np.frombuffer(datos, "<u4", n_triangulos * 3, fin_nor).reshape(-1, 3)
    return posiciones, normales, indices


def volumen_con_signo(posiciones: np.ndarray, indices: np.ndarray) -> float:
    a = posiciones[indices[:, 0]].astype(np.float64)
    b = posiciones[indices[:, 1]].astype(np.float64)
    c = posiciones[indices[:, 2]].astype(np.float64)
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def pintar(estructuras, capturas: Path, nombre: str, vistas) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    # matplotlib pone el eje vertical en la tercera columna; ROSA2018 lo tiene en
    # la segunda (Y arriba). Se permutan las columnas solo para pintar.
    PERMUTA = [0, 2, 1]
    figura = plt.figure(figsize=(5 * len(vistas), 5.4))
    todos = np.vstack([p[:, PERMUTA] for p, _, _ in estructuras.values()])
    centro = (todos.min(axis=0) + todos.max(axis=0)) / 2
    radio = (todos.max(axis=0) - todos.min(axis=0)).max() / 2
    for columna, (titulo, elevacion, azimut) in enumerate(vistas):
        eje = figura.add_subplot(1, len(vistas), columna + 1, projection="3d")
        # Luz de casco: viene de donde mira la cámara, un poco desplazada, para
        # que los surcos se vean en todas las vistas.
        radianes_e = np.radians(elevacion)
        radianes_a = np.radians(azimut + 25)
        luz = np.array(
            [
                np.cos(radianes_e) * np.cos(radianes_a),
                np.cos(radianes_e) * np.sin(radianes_a),
                np.sin(radianes_e) + 0.35,
            ]
        )
        luz = luz / np.linalg.norm(luz)
        for posiciones, _, indices in estructuras.values():
            triangulos = posiciones[:, PERMUTA][indices]
            normales = np.cross(
                triangulos[:, 1] - triangulos[:, 0], triangulos[:, 2] - triangulos[:, 0]
            )
            largo = np.linalg.norm(normales, axis=1)
            largo[largo == 0] = 1
            # La permutación de columnas invierte la mano del sistema, así que
            # el producto vectorial sale hacia dentro y hay que darle la vuelta.
            # Que esto haga falta confirma que los triángulos publicados están
            # en sentido antihorario visto desde fuera.
            sombra = np.clip(-(normales / largo[:, None]) @ luz, 0.10, 1.0)
            color = np.stack(
                [0.88 * sombra, 0.68 * sombra, 0.68 * sombra, np.ones(len(sombra))], 1
            )
            eje.add_collection3d(
                Poly3DCollection(triangulos, facecolors=color, linewidths=0)
            )
        eje.set_xlim(centro[0] - radio, centro[0] + radio)
        eje.set_ylim(centro[1] - radio, centro[1] + radio)
        eje.set_zlim(centro[2] - radio, centro[2] + radio)
        eje.set_box_aspect((1, 1, 1))
        eje.view_init(elev=elevacion, azim=azimut)
        eje.set_axis_off()
        eje.set_title(titulo)
    capturas.mkdir(parents=True, exist_ok=True)
    salida = capturas / f"{nombre}.png"
    figura.savefig(salida, dpi=95, facecolor="white", bbox_inches="tight")
    plt.close(figura)
    print(f"  captura {salida}")


def main() -> None:
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("--datos", required=True, type=Path)
    analizador.add_argument("--capturas", type=Path)
    argumentos = analizador.parse_args()

    indice = json.loads((argumentos.datos / "indice.json").read_text(encoding="utf-8"))
    cargadas = {}
    fallos = []
    for entrada in indice["estructuras"]:
        ruta = argumentos.datos / entrada["fichero"]
        posiciones, normales, indices = leer_bin(ruta)
        cargadas[entrada["clave"]] = (posiciones, normales, indices)
        if len(posiciones) != entrada["vertices"]:
            fallos.append(f"{entrada['clave']}: vértices no cuadran")
        if len(indices) != entrada["triangulos"]:
            fallos.append(f"{entrada['clave']}: triángulos no cuadran")
        if indices.max() >= len(posiciones):
            fallos.append(f"{entrada['clave']}: hay un índice fuera de rango")
        caja = np.concatenate([posiciones.min(axis=0), posiciones.max(axis=0)])
        if not np.allclose(caja, np.array(entrada["caja"]), atol=1e-2):
            fallos.append(f"{entrada['clave']}: la caja del índice no cuadra")
        largos = np.linalg.norm(normales, axis=1)
        if not np.allclose(largos, 1.0, atol=2e-3):
            fallos.append(f"{entrada['clave']}: normales sin normalizar")
        volumen = volumen_con_signo(posiciones, indices)
        sentido = "antihorario desde fuera" if volumen > 0 else "AL REVÉS"
        print(
            f"  {entrada['clave']:26s} {len(posiciones):6d} v {len(indices):6d} t "
            f"volumen {volumen / 1000:8.1f} cm3  {sentido}"
        )
        if volumen <= 0:
            fallos.append(f"{entrada['clave']}: el volumen con signo es negativo")

    todos = np.vstack([p for p, _, _ in cargadas.values()])
    minimo, maximo = todos.min(axis=0), todos.max(axis=0)
    print(f"  caja del conjunto {minimo.round(1).tolist()} .. {maximo.round(1).tolist()}")
    print(f"  centro {((minimo + maximo) / 2).round(2).tolist()}")
    lado = (maximo - minimo).max()
    print(f"  lado mayor {lado:.1f} {indice['unidad']}")
    if lado > 200:
        fallos.append("el conjunto no cabe en 200 unidades")
    if np.abs((minimo + maximo) / 2).max() > 0.01:
        fallos.append("el conjunto no está centrado en el origen")

    if argumentos.capturas:
        vistas = [
            ("Lateral derecha", 0, 0),
            ("Frontal (visto desde delante)", 0, -90),
            ("Superior", 89, -90),
        ]
        pintar(cargadas, argumentos.capturas, "cerebro3d_conjunto", vistas)
        corteza = {
            clave: valor
            for clave, valor in cargadas.items()
            if clave.startswith("corteza_") or clave in {"cingulo_precuneo", "insula"}
        }
        pintar(corteza, argumentos.capturas, "cerebro3d_corteza", vistas)
        profundas = {
            clave: valor
            for clave, valor in cargadas.items()
            if clave
            in {
                "hipocampo",
                "amigdala",
                "corteza_entorrinal",
                "ganglios_basales_talamo",
                "lcr",
                "cuerpo_calloso",
                "tronco_locus_coeruleus",
            }
        }
        pintar(profundas, argumentos.capturas, "cerebro3d_profundas", vistas)

    if fallos:
        print("\nFALLOS:")
        for fallo in fallos:
            print(f"  - {fallo}")
        raise SystemExit(1)
    print("\nTodo cuadra.")


if __name__ == "__main__":
    main()
