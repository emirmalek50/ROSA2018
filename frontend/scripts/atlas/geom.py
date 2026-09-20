"""Ayudas geométricas para el atlas: splines, tubos y conversión a Bézier.

Todo trabaja en coordenadas del lienzo (1000 x 620). Las formas se definen
con pocos puntos de control, se muestrean densamente para operar con shapely
y al final se convierten en curvas Bézier suaves (Catmull-Rom cerrado).
"""
from __future__ import annotations
import math
from shapely.geometry import Polygon, LineString, MultiPolygon
from shapely.ops import unary_union


def _cr_point(p0, p1, p2, p3, t):
    """Punto de una spline Catmull-Rom centrípeta entre p1 y p2."""
    t2, t3 = t * t, t * t * t
    x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
    y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
    return (x, y)


def muestrear_cerrada(puntos, n_por_tramo=12):
    """Muestrea una curva cerrada suave que pasa por `puntos`."""
    m = len(puntos)
    salida = []
    for i in range(m):
        p0, p1, p2, p3 = puntos[(i - 1) % m], puntos[i], puntos[(i + 1) % m], puntos[(i + 2) % m]
        for k in range(n_por_tramo):
            salida.append(_cr_point(p0, p1, p2, p3, k / n_por_tramo))
    return salida


def muestrear_abierta(puntos, n_por_tramo=12):
    """Muestrea una curva abierta suave que pasa por `puntos` (extremos duplicados)."""
    pts = [puntos[0]] + list(puntos) + [puntos[-1]]
    salida = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n_por_tramo):
            salida.append(_cr_point(p0, p1, p2, p3, k / n_por_tramo))
    salida.append(pts[-2])
    return salida


def poligono_suave(puntos, n=12):
    """Polígono shapely a partir de puntos de control (curva cerrada suave)."""
    return Polygon(muestrear_cerrada(puntos, n)).buffer(0)


def tubo(puntos, radios, n=10):
    """Polígono con forma de tubo a lo largo de una curva abierta.

    `radios` da el grosor en cada punto de control; se interpola linealmente.
    Los extremos quedan redondeados.
    """
    centro = muestrear_abierta(puntos, n)
    total = len(centro)
    # radio por muestra: interpolación entre puntos de control
    radios_m = []
    tramos = len(puntos) - 1
    for i in range(total):
        pos = min(i / max(1, (total - 1)) * tramos, tramos - 1e-9)
        j = int(pos)
        f = pos - j
        radios_m.append(radios[j] * (1 - f) + radios[min(j + 1, len(radios) - 1)] * f)
    discos = []
    for (x, y), r in zip(centro, radios_m):
        discos.append(Polygon([(x + r * math.cos(a), y + r * math.sin(a)) for a in [k * math.pi / 12 for k in range(24)]]))
    return unary_union(discos).buffer(0.01).buffer(-0.01)


def anillo_arco(cx, cy, r_ext, r_int, a0, a1, n=40):
    """Media luna: sector entre dos radios y dos ángulos (grados)."""
    pts = []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + r_ext * math.cos(a), cy + r_ext * math.sin(a)))
    for k in range(n, -1, -1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + r_int * math.cos(a), cy + r_int * math.sin(a)))
    return Polygon(pts)


def _fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def anillo_a_bezier(coords, tension=0.28, cierre=True):
    """Convierte un anillo de vértices en un path cerrado de cúbicas suaves.

    Las asas de cada vértice apuntan según la cuerda entre sus vecinos y se
    acortan si el segmento adyacente es corto, para no crear bucles.
    """
    pts = [tuple(c) for c in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    m = len(pts)
    if m < 3:
        return ""
    def asa(i):
        p_prev, p, p_next = pts[(i - 1) % m], pts[i], pts[(i + 1) % m]
        dx, dy = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        norma = math.hypot(dx, dy) or 1.0
        ux, uy = dx / norma, dy / norma
        l_prev = math.hypot(p[0] - p_prev[0], p[1] - p_prev[1])
        l_next = math.hypot(p_next[0] - p[0], p_next[1] - p[1])
        return (ux, uy, l_prev, l_next)
    partes = [f"M{_fmt(pts[0][0])} {_fmt(pts[0][1])}"]
    for i in range(m):
        j = (i + 1) % m
        ux0, uy0, _, ln0 = asa(i)
        ux1, uy1, lp1, _ = asa(j)
        d = math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])
        k = tension * d
        c1 = (pts[i][0] + ux0 * k, pts[i][1] + uy0 * k)
        c2 = (pts[j][0] - ux1 * k, pts[j][1] - uy1 * k)
        partes.append(f"C{_fmt(c1[0])} {_fmt(c1[1])} {_fmt(c2[0])} {_fmt(c2[1])} {_fmt(pts[j][0])} {_fmt(pts[j][1])}")
    if cierre:
        partes.append("Z")
    return "".join(partes)


def linea_a_bezier(coords, tension=0.3):
    """Curva abierta suave por los puntos dados (para los vasos)."""
    pts = [tuple(c) for c in coords]
    m = len(pts)
    if m < 2:
        return ""
    def tangente(i):
        a = pts[max(0, i - 1)]
        b = pts[min(m - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1.0
        return (dx / n, dy / n)
    partes = [f"M{_fmt(pts[0][0])} {_fmt(pts[0][1])}"]
    for i in range(m - 1):
        j = i + 1
        t0, t1 = tangente(i), tangente(j)
        d = math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])
        k = tension * d
        c1 = (pts[i][0] + t0[0] * k, pts[i][1] + t0[1] * k)
        c2 = (pts[j][0] - t1[0] * k, pts[j][1] - t1[1] * k)
        partes.append(f"C{_fmt(c1[0])} {_fmt(c1[1])} {_fmt(c2[0])} {_fmt(c2[1])} {_fmt(pts[j][0])} {_fmt(pts[j][1])}")
    return "".join(partes)


def poligono_a_path(geom, tolerancia=1.6, tension=0.28, minimo_area=40.0):
    """Path SVG (una o varias subtrazas cerradas) a partir de una geometría shapely.

    Simplifica cada anillo y lo convierte en cúbicas suaves. Los trozos de
    área diminuta (restos de operaciones booleanas) se descartan.
    """
    if geom.is_empty:
        return ""
    if isinstance(geom, Polygon):
        polis = [geom]
    elif isinstance(geom, MultiPolygon):
        polis = list(geom.geoms)
    else:
        polis = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
    trozos = []
    for p in polis:
        if p.area < minimo_area:
            continue
        p = p.simplify(tolerancia, preserve_topology=True)
        trozos.append(anillo_a_bezier(list(p.exterior.coords), tension))
        for interior in p.interiors:
            trozos.append(anillo_a_bezier(list(interior.coords), tension))
    return "".join(trozos)


def redondear(geom, r=2.0):
    """Suaviza esquinas: dilata y contrae la misma cantidad."""
    return geom.buffer(r, join_style=1).buffer(-r, join_style=1)
