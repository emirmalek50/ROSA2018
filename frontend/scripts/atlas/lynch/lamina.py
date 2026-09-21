"""La lámina de Lynch y Jaffe como datos: lectura del SVG y transformación al lienzo.

`Brain human sagittal section.svg` (Patrick J. Lynch y C. Carl Jaffe, Yale
University School of Medicine, 2006, CC BY 2.5) es un corte sagital medial con
la frente a la izquierda: cuatro campos de color (corteza, cuerpo calloso y
tálamo, tronco) y 146 trazos de tinta parda que son formas CERRADAS rellenas
(pinceladas exportadas como polígonos, no líneas con trazo). Todos los
trazados usan solo M, C, L absolutos y z; no hay transformaciones en el
fichero. Aquí se leen, se escalan y se trasladan al lienzo lógico de 1000 por
620 del atlas (VISTA en lib/atlas_dibujo.ts) y se recorta la médula espinal
por debajo de RECORTE_Y.
"""
from __future__ import annotations

import os
import re
import sys
import xml.etree.ElementTree as ET

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))  # geom.py del generador viejo
RAIZ_FRONTEND = os.path.dirname(os.path.dirname(os.path.dirname(AQUI)))
SVG = os.path.join(RAIZ_FRONTEND, "src", "datos", "atlas", "lynch_sagital.svg")

# El encaje en el lienzo: escala y traslación. Con 2,0 el cerebro va de x 312
# a 902 y de y 30 (vértice) a unos 530 (fin del bulbo); la médula espinal se
# recorta en RECORTE_Y. A la izquierda queda sitio para la retina y la gota,
# a la derecha para el intestino.
ESCALA = 2.0
TX = 312.0
TY = 30.0
RECORTE_Y = 590.0
VISTA = (1000, 620)

CREDITO = {
    "autores": "Patrick J. Lynch y C. Carl Jaffe",
    "institucion": "Yale University School of Medicine",
    "titulo": "Brain human sagittal section",
    "anio": 2006,
    "licencia": "CC BY 2.5",
    "url": "https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg",
    "adaptacion": "escala, recorte de la médula espinal y regiones superpuestas",
}

NS = "{http://www.w3.org/2000/svg}"
_FICHA = re.compile(r"[MCLZmclz]|-?\d*\.?\d+(?:e-?\d+)?")


def _fmt(v: float) -> str:
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def transformar(x: float, y: float) -> tuple[float, float]:
    return (TX + ESCALA * x, TY + ESCALA * y)


def ordenes(d: str):
    """Lista de (orden, [números]) de un trazado con M, C, L y Z absolutos.

    Lanza si aparece una orden relativa o desconocida: la lámina no las usa,
    y si una versión nueva las trajera hay que convertirlas, no ignorarlas.
    """
    fichas = _FICHA.findall(d)
    salida = []
    orden = None
    nums: list[float] = []
    for f in fichas:
        if f in "MCLZmclz":
            if orden is not None:
                salida.append((orden, nums))
            if f in "mcl":
                raise ValueError(f"orden relativa {f!r} en la lámina; convertirla antes")
            orden = f.upper()
            nums = []
        else:
            nums.append(float(f))
    if orden is not None:
        salida.append((orden, nums))
    return salida


def transformar_d(d: str) -> str:
    """El mismo trazado con las coordenadas escaladas y trasladadas."""
    partes = []
    for orden, nums in ordenes(d):
        if orden == "Z":
            partes.append("Z")
            continue
        pares = []
        for i in range(0, len(nums), 2):
            x, y = transformar(nums[i], nums[i + 1])
            pares.append(f"{_fmt(x)} {_fmt(y)}")
        partes.append(orden + " " + " ".join(pares))
    return " ".join(partes)


def aplanar(d: str, n: int = 8) -> list[list[tuple[float, float]]]:
    """Los subtrazados de un `d` (ya transformado o no) como polígonos densos."""
    polis: list[list[tuple[float, float]]] = []
    actual: list[tuple[float, float]] = []
    pos = (0.0, 0.0)
    for orden, nums in ordenes(d):
        if orden == "Z":
            if actual:
                polis.append(actual)
            actual = []
            continue
        if orden == "M":
            if actual:
                polis.append(actual)
            actual = []
            pos = (nums[0], nums[1])
            actual.append(pos)
            for i in range(2, len(nums), 2):
                pos = (nums[i], nums[i + 1])
                actual.append(pos)
        elif orden == "L":
            for i in range(0, len(nums), 2):
                pos = (nums[i], nums[i + 1])
                actual.append(pos)
        elif orden == "C":
            for i in range(0, len(nums), 6):
                p0 = pos
                p1 = (nums[i], nums[i + 1])
                p2 = (nums[i + 2], nums[i + 3])
                p3 = (nums[i + 4], nums[i + 5])
                for k in range(1, n + 1):
                    t = k / n
                    u = 1 - t
                    actual.append((u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]))
                pos = p3
    if actual:
        polis.append(actual)
    return polis


def leer():
    """Los campos y los trazos de la lámina, ya en coordenadas del lienzo."""
    raiz = ET.parse(SVG).getroot()
    campos = []
    trazos = []
    for g in raiz.iter(NS + "g"):
        for p in g.findall(NS + "path"):
            estilo = p.get("style") or ""
            m = re.search(r"fill:(#[0-9a-fA-F]{6})", estilo)
            fill = m.group(1).lower() if m else None
            d = transformar_d(p.get("d"))
            if g.get("id") == "Color_Fields":
                campos.append({"d": d, "fill": fill})
            else:
                trazos.append({"d": d, "fill": fill})
    if len(campos) != 4 or len(trazos) != 146:
        raise SystemExit(f"la lámina cambió: {len(campos)} campos y {len(trazos)} trazos")
    tintas = {t["fill"] for t in trazos}
    if tintas != {"#532e1f"}:
        raise SystemExit(f"las tintas cambiaron: {tintas}")
    return campos, trazos


def contorno(campos, trazos):
    """La silueta exterior: unión de todos los campos y trazos, recortada en RECORTE_Y, como Bézier."""
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    from geom import anillo_a_bezier

    polis = []
    for f in campos + trazos:
        for anillo in aplanar(f["d"]):
            if len(anillo) >= 3:
                polis.append(Polygon(anillo).buffer(0))
    union = unary_union(polis).buffer(1.2, join_style=1).buffer(-1.2, join_style=1)
    union = union.intersection(box(0, 0, VISTA[0], RECORTE_Y))
    if union.geom_type == "MultiPolygon":
        union = max(union.geoms, key=lambda g: g.area)
    # Sin agujeros (las cisuras internas no son parte de la silueta) y simplificado.
    exterior = Polygon(union.exterior.coords).simplify(1.0, preserve_topology=True)
    return anillo_a_bezier(list(exterior.exterior.coords), tension=0.25), exterior
