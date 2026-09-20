"""Anatomía del corte sagital medial del atlas de ROSA2018, con las notas de los jueces.

La frente mira a la izquierda. Cada función devuelve geometrías shapely en
coordenadas del lienzo de 1000 x 620.

Método. Primero se construyen las piezas "crudas", que comparten frontera con
sus vecinas (cada estructura se recorta de la siguiente); al final cada pieza
retrocede 1,5 px, así entre dos regiones vecinas queda siempre un surco de 3 px
por el que se ve la capa de fondo. Los surcos que parten un mismo manto (el
central, el marginal y el parieto-occipital) se cortan DESPUÉS del retroceso
con un tubo de 3 px que empieza fuera del contorno: así no queda el bulbo
oscuro que dejaba el retroceso en la esquina aguda de la coronilla.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import nearest_points, unary_union
from shapely.affinity import rotate

from geom import muestrear_abierta, muestrear_cerrada, poligono_suave, redondear, tubo, anillo_arco

SURCO = 1.5  # medio surco: cada región retrocede esto y el hueco total es de 3 px


# ---------------------------------------------------------------------------
# Ayudas
# ---------------------------------------------------------------------------

def elipse(cx, cy, rx, ry, giro=0.0, n=64):
    pts = [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]
    return rotate(Polygon(pts), giro, origin=(cx, cy))


def caja(x0, y0, x1, y1):
    return Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def partes(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if hasattr(geom, "geoms") else [geom]


def sin_astillas(geom, minimo=160.0):
    """Quita los trozos diminutos que dejan las operaciones booleanas."""
    polis = [p for p in partes(geom) if isinstance(p, Polygon) and p.area >= minimo]
    return unary_union(polis) if polis else Polygon()


def region(g, r=SURCO, suavizado=1.5):
    """Pieza final: retrocede medio surco y suaviza esquinas."""
    return sin_astillas(redondear(g.buffer(-r), suavizado))


def cisura(puntos, radios):
    """Surco ciego que muere afinándose: un tubo de radio decreciente.

    Se muestrea muy denso (unas 60 muestras por tramo) porque `tubo` une discos
    por muestra: con radios de menos de 2 px, muestras a más de 1 px de
    distancia dejan discos sueltos y la cisura sale como un collar de perlas.
    """
    return tubo(puntos, radios, n=60)


def x_en(linea, y):
    """Abscisa de una polilínea (de arriba abajo) a la altura y, por interpolación."""
    for (x0, y0), (x1, y1) in zip(linea, linea[1:]):
        if min(y0, y1) <= y <= max(y0, y1) and y1 != y0:
            return x0 + (x1 - x0) * (y - y0) / (y1 - y0)
    return linea[0][0] if y < linea[0][1] else linea[-1][0]


def ancla_hacia(geom, punto, dentro=2.5):
    """Punto de la figura más cercano a `punto`, metido `dentro` px hacia su interior."""
    p = Point(punto)
    q = nearest_points(geom, p)[0]
    c = geom.representative_point()
    dx, dy = c.x - q.x, c.y - q.y
    n = math.hypot(dx, dy) or 1.0
    return (round(q.x + dx / n * dentro, 1), round(q.y + dy / n * dentro, 1))


# ---------------------------------------------------------------------------
# Puntos de control compartidos entre estructuras y vasos
# ---------------------------------------------------------------------------

# Eje del cuerpo calloso (rostro delante-abajo, rodilla, cuerpo, esplenio detrás) y su radio.
CC_PTS = [(366, 322), (349, 288), (352, 250), (378, 222), (430, 203), (500, 195),
          (570, 200), (630, 218), (667, 250), (676, 290), (668, 318)]
CC_RADIOS = [8, 17, 16, 15, 15, 15, 15, 15, 18, 21, 17]
EJE_CC = LineString(muestrear_abierta(CC_PTS, 10))
RADIO_CC = 15
BANDA_ANCHO = 44  # grosor del giro cingular por fuera del cuerpo calloso
VENTRICULO = 19  # anchura de la banda del ventrículo lateral (16 visibles más el surco)

# Surcos que separan lóbulos, de arriba (fuera del contorno) hacia abajo (dentro del cíngulo).
SURCO_CENTRAL = [(478, 14), (486, 90), (498, 140), (510, 200)]
SURCO_MARGINAL = [(642, 14), (631, 90), (617, 140), (605, 200)]
SURCO_PARIETOOCCIPITAL = [(742, 40), (718, 120), (703, 180), (694, 240), (688, 305)]

# Contorno del hemisferio: bóveda, polo occipital, borde tentorial hasta el tronco,
# cara posterior del temporal, cara inferior del temporal, polo temporal y cara orbitaria.
CEREBRO_PTS = [
    (212, 250), (222, 195), (258, 135), (318, 90), (395, 64), (480, 55),
    (565, 58), (645, 74), (715, 108), (768, 160), (800, 232), (798, 300),
    (786, 340), (758, 360), (718, 372), (680, 378), (650, 377), (600, 366), (572, 360),
    (568, 392), (560, 424), (505, 437), (430, 437), (360, 429), (306, 411),
    (279, 388), (290, 360), (305, 348), (262, 350), (228, 348),
    (214, 330), (207, 292),
]

# Tronco: techo bajo el tálamo (lo recorta el huevo), cara posterior recta (suelo del cuarto
# ventrículo), bulbo que se estrecha y cara anterior con la protuberancia abombada entre y 420 y 500.
TRONCO_PTS = [
    (560, 330), (605, 326), (648, 330),
    (650, 372), (651, 410), (652, 440), (650, 472), (644, 500), (632, 526), (623, 548),
    (583, 550),
    (574, 528), (560, 504), (552, 480), (552, 456), (556, 432), (562, 406), (564, 380), (558, 352),
]

# Cerebelo: la superficie superior la aplana el borde tentorial del occipital; la cara anterior
# se apoya en el tronco; los festones van en el borde posteroinferior.
CEREBELO_CENTRO = (735, 440)
CEREBELO_PTS = [
    (640, 380), (696, 366), (748, 364), (792, 370),
    (810, 396), (818, 428), (814, 462), (800, 490), (772, 507), (735, 513), (700, 507), (674, 493),
    (656, 474), (642, 446), (642, 412),
]


def cerebelo_festoneado(n_festones=5, amplitud=6.5, a0=-8.0, a1=128.0):
    """El óvalo del cerebelo con festones en el arco posteroinferior (ángulos en grados, y hacia abajo)."""
    cx, cy = CEREBELO_CENTRO
    puntos = []
    for x, y in muestrear_cerrada(CEREBELO_PTS, 14):
        ang = math.degrees(math.atan2(y - cy, x - cx))
        if a0 <= ang <= a1:
            fase = (ang - a0) / (a1 - a0) * n_festones * math.pi
            bulto = amplitud * abs(math.sin(fase))
            r = math.hypot(x - cx, y - cy)
            x, y = cx + (x - cx) * (r + bulto) / r, cy + (y - cy) * (r + bulto) / r
        puntos.append((x, y))
    return Polygon(puntos).buffer(0)


def cisuras_cerebelo(n_festones=5, a0=-8.0, a1=128.0, largo=52):
    """Cuatro cisuras que nacen en las escotaduras entre festones y mueren afinándose hacia el centro."""
    cx, cy = CEREBELO_CENTRO
    salida = []
    for k in range(1, n_festones):
        ang = math.radians(a0 + (a1 - a0) * k / n_festones)
        ux, uy = math.cos(ang), math.sin(ang)
        # el borde en esa dirección, medido sobre el óvalo base
        rayo = LineString([(cx, cy), (cx + 200 * ux, cy + 200 * uy)])
        corte = rayo.intersection(poligono_suave(CEREBELO_PTS, 14).exterior)
        if corte.is_empty:
            continue
        p = partes(corte)[0] if hasattr(corte, "geoms") else corte
        pts = [(p.x + 6 * ux, p.y + 6 * uy), (p.x - largo * 0.5 * ux, p.y - largo * 0.5 * uy), (p.x - largo * ux, p.y - largo * uy)]
        salida.append(cisura(pts, [1.9, 1.2, 0.35]))
    return salida


def construir(depurar=False):
    F = {}  # piezas finales por clave
    R = {}  # piezas crudas y auxiliares (para anclas y vasos)

    cerebro = poligono_suave(CEREBRO_PTS)
    tronco_poly = poligono_suave(TRONCO_PTS)
    cerebelo_poly = cerebelo_festoneado()
    bulbo = tubo([(229, 351), (262, 350), (300, 348), (322, 345)], [7, 5, 4, 3.5])

    silueta = redondear(unary_union([cerebro, tronco_poly, cerebelo_poly, bulbo]), 4)
    silueta = Polygon(silueta.exterior)
    F["cerebro_sin_region"] = silueta
    R["silueta"] = silueta

    # ---- Cuerpo calloso, ventrículo lateral, acueducto y cuarto ventrículo ----
    cc = tubo(CC_PTS, CC_RADIOS)
    bajo_arco = Polygon(list(EJE_CC.coords) + [(662, 368), (600, 368), (500, 368), (420, 362), (376, 346)]).buffer(0)
    ventriculo = bajo_arco.intersection(cc.buffer(VENTRICULO)).difference(cc)
    ventriculo = ventriculo.difference(caja(320, 302, 402, 400))  # el asta frontal termina en la rodilla
    acueducto = tubo([(653, 344), (650, 372), (651, 400), (653, 428)], [3.5, 3.5, 3.5, 3.5])
    cuarto = poligono_suave([(649, 422), (662, 433), (672, 448), (662, 463), (649, 474)])
    lcr = unary_union([ventriculo, acueducto, cuarto]).buffer(0)
    R["cuarto"] = cuarto

    # ---- Tálamo y ganglios: huevo de 200 px bajo el ventrículo, con el hipotálamo delante y debajo ----
    # El casquete superior, más ancho y plano, sube hasta el ventrículo (el tálamo es su suelo) y este lo recorta;
    # el fondo redondo del huevo se queda en y 346, dejando el hipotálamo debajo.
    huevo = redondear(unary_union([elipse(532, 290, 100, 56, giro=-4), elipse(532, 262, 94, 40, giro=-4)]), 6)
    huevo = huevo.difference(ventriculo).difference(cc)

    # ---- Tronco ----
    tronco = tronco_poly.difference(huevo).difference(lcr).difference(cc)

    # ---- Temporal y estructuras mediales ----
    recorte_temporal = Polygon([(316, 344), (380, 350), (540, 352), (582, 346), (597, 362), (598, 372), (562, 450), (270, 450), (268, 380), (283, 366)])
    temporal_bloque = cerebro.intersection(recorte_temporal).difference(huevo).difference(tronco_poly).difference(cc).difference(lcr)
    # La coma del hipocampo: cola fina bajo la cola del tálamo, cabeza gruesa delante, tocando la amígdala.
    hipocampo = tubo([(594, 360), (584, 375), (560, 389), (524, 399), (486, 401), (456, 395)], [5, 8, 11, 11, 11, 10])
    hipocampo = hipocampo.intersection(unary_union([cerebro, tronco_poly])).difference(huevo).difference(lcr).difference(cc)
    amigdala = elipse(430, 386, 17, 12, giro=-16).difference(hipocampo)
    entorrinal = temporal_bloque.intersection(Polygon([(418, 396), (516, 394), (520, 442), (414, 446)]))
    entorrinal = entorrinal.difference(hipocampo).difference(amigdala)
    temporal = temporal_bloque.difference(hipocampo).difference(amigdala).difference(entorrinal)
    tronco = tronco.difference(hipocampo)

    # ---- El manto cortical: lo que queda del hemisferio ----
    manto_entero = cerebro.difference(cc).difference(bajo_arco).difference(tronco_poly).difference(bulbo)
    corteza = manto_entero.difference(temporal_bloque).difference(hipocampo).difference(amigdala)

    # Cíngulo: banda alrededor del cuerpo calloso, recortada bajo el rostro (área subcallosa).
    banda = EJE_CC.buffer(RADIO_CC + BANDA_ANCHO, cap_style=1).difference(cc).difference(bajo_arco)
    banda = banda.difference(caja(280, 338, 430, 420)).intersection(corteza)
    lobulos_crudos = corteza.difference(banda)

    # Clasificación de una pieza por su punto representativo respecto de los tres surcos.
    def lobulo_de(g):
        c = g.representative_point()
        if c.y < 330 and c.x > x_en(SURCO_PARIETOOCCIPITAL, c.y):
            return "occipital"
        if c.y < 300 and c.x > x_en(SURCO_MARGINAL, c.y):
            return "precuneo"
        if c.y < 230 and c.x > x_en(SURCO_CENTRAL, c.y):
            return "parietal"
        return "frontal"

    # El precúneo se une al cíngulo en crudo (comparten frontera): la cuña detrás del esplenio.
    cortes_finos = unary_union([LineString(l).buffer(0.02) for l in (SURCO_CENTRAL, SURCO_MARGINAL, SURCO_PARIETOOCCIPITAL)])
    precuneo_crudo = unary_union([g for g in partes(lobulos_crudos.difference(cortes_finos)) if lobulo_de(g) == "precuneo"])
    cingulo = unary_union([banda, precuneo_crudo]).buffer(0)

    # Los lóbulos: retroceso primero, surcos de 3 px después (empiezan fuera del contorno).
    manto = region(lobulos_crudos.difference(precuneo_crudo))
    surcos = unary_union([LineString(l).buffer(SURCO) for l in (SURCO_CENTRAL, SURCO_MARGINAL, SURCO_PARIETOOCCIPITAL)])
    piezas = {"frontal": [], "parietal": [], "occipital": [], "precuneo": []}
    for g in partes(manto.difference(surcos)):
        if g.area < 30:
            continue
        piezas[lobulo_de(g)].append(g)
    if depurar:
        for nombre, lista in piezas.items():
            print(f"  {nombre}: {len(lista)} pieza(s), áreas {[round(g.area) for g in lista]}")

    # ---- Cerebelo crudo: lo recortan el tentorio (occipital), el tronco y el cuarto ventrículo ----
    cerebelo = cerebelo_poly.difference(cerebro).difference(tronco_poly).difference(cuarto)

    # ---- Piezas finales ----
    F["neocorteza"] = region(manto_entero)
    F["corteza_prefrontal"] = sin_astillas(unary_union(piezas["frontal"]))
    F["corteza_parietal"] = sin_astillas(unary_union(piezas["parietal"]))
    F["corteza_occipital"] = sin_astillas(unary_union(piezas["occipital"]))
    # La cola del hipocampo parte el rincón posterosuperior del temporal: ese trozo suelto (la "astilla") se descarta.
    F["corteza_temporal"] = sin_astillas(region(temporal), 1000)
    F["cingulo_precuneo"] = region(cingulo)
    F["sustancia_blanca"] = region(cc)
    F["ganglios_basales_talamo"] = region(huevo)
    F["lcr"] = region(lcr, suavizado=1.0)
    F["hipocampo"] = region(hipocampo, suavizado=1.0)
    F["amigdala"] = region(amigdala, suavizado=1.0)
    F["corteza_entorrinal"] = region(entorrinal, suavizado=1.0)
    F["bulbo_olfatorio"] = region(bulbo, r=0.9, suavizado=0.8)
    F["tronco_locus_coeruleus"] = region(tronco)
    cerebelo_final = region(cerebelo)
    F["cerebelo"] = sin_astillas(cerebelo_final.difference(unary_union(cisuras_cerebelo())))

    # ---- Compartimentos fuera del cerebro ----
    F["retina"] = anillo_arco(112, 345, 36, 27, -112, 112)
    F["plasma"] = poligono_suave([(135, 442), (147, 468), (163, 494), (152, 522), (118, 522), (107, 494), (123, 468)])
    F["intestino_microbiota"] = tubo([(848, 458), (880, 452), (918, 456), (940, 474), (926, 494), (895, 498), (864, 500),
                                      (846, 518), (860, 540), (892, 546), (924, 542), (948, 530)], [10] * 12)

    if depurar:
        for clave, g in F.items():
            n = len(partes(g))
            aviso = "" if n == 1 else f"  <-- {n} trozos: {[round(p.area) for p in partes(g)]}"
            print(f"  {clave:26s} área {g.area:8.0f}{aviso}")
    return F, R


def vasos():
    """Los cuatro vasos del corte medial, como polilíneas abiertas.

    Pericallosa (la cerebral anterior sube delante de la rodilla y sigue el surco
    calloso, entre el cuerpo calloso y el cíngulo), callosomarginal (por el surco
    del cíngulo y un tramo por la rama marginal), basilar (por la cara anterior de
    la protuberancia) y cerebral posterior (rodea el esplenio y sigue la calcarina
    hasta el polo occipital). Las dos primeras corren dentro del surco de 3 px, un
    punto hacia el lado de la región más ancha, para que la zona de pulsación no
    le robe superficie al cuerpo calloso ni al cíngulo.
    """
    def desplazada(dist, x0, x1):
        a = EJE_CC.offset_curve(dist)
        b = EJE_CC.offset_curve(-dist)
        curva = a if a.centroid.y < b.centroid.y else b
        pts = [tuple(c) for c in curva.coords]
        pts = [p for p in pts if x0 <= p[0] <= x1]
        return pts[::3] if len(pts) > 6 else pts

    # La pericallosa sigue el borde REAL del cuerpo calloso (su radio varía de 8 a 21 px), en mitad del surco calloso.
    cc = tubo(CC_PTS, CC_RADIOS)
    borde = [tuple(c) for c in cc.buffer(SURCO).exterior.coords]
    arriba = [p for p in borde if 340 <= p[0] <= 690 and p[1] < 300 - (p[0] - 340) * 0.0]
    # nos quedamos con el arco superior: puntos por encima del eje del cuerpo calloso
    arriba = [p for p in borde if 342 <= p[0] <= 688 and EJE_CC.distance(Point(p)) < 40 and p[1] < EJE_CC.interpolate(EJE_CC.project(Point(p))).y]
    arriba.sort(key=lambda p: EJE_CC.project(Point(p)))
    pericallosa = [(418, 348), (390, 345), (364, 337)] + arriba[::4]
    # La callosomarginal corre por el surco del cíngulo y sube por el propio surco marginal hasta el vértice.
    callosomarginal = desplazada(RADIO_CC + BANDA_ANCHO + SURCO + 1.0, 322, 604) + [(617, 140), (631, 90), (634, 70)]
    basilar = [(586, 540), (576, 520), (562, 498), (554, 476), (555, 452), (561, 428), (569, 404), (574, 382)]
    cerebral_posterior = [(574, 382), (602, 376), (632, 370), (660, 364), (686, 352), (700, 332), (710, 310), (728, 300), (760, 296), (800, 292)]
    return {"pericallosa": pericallosa, "callosomarginal": callosomarginal, "basilar": basilar, "cerebral_posterior": cerebral_posterior}


def trazos_finos():
    """Trazos decorativos: el ojo (globo, cristalino y nervio óptico) y el brillo de la gota."""
    globo = [(112 + 36 * math.cos(2 * math.pi * k / 24), 345 + 36 * math.sin(2 * math.pi * k / 24)) for k in range(24)]
    cristalino = [(83 + 6 * math.cos(2 * math.pi * k / 16), 345 + 11 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    nervio = [(148, 350), (176, 356), (206, 362)]
    brillo = [(124, 476), (122, 490), (126, 505)]
    return {"cerrados": [globo, cristalino], "abiertos": [nervio, brillo]}


if __name__ == "__main__":
    construir(depurar=True)
