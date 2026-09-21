"""Las veinte regiones del atlas trazadas sobre la lámina de Lynch y Jaffe.

Todo en coordenadas del lienzo (1000 por 620), ya con la lámina encajada
(lamina.py: escala 2, traslación 312 y 30). Las figuras se construyen con
shapely a partir de puntos de control y de los propios campos de color de la
lámina: los lóbulos son recortes del manto cortical (el campo #f0e1df del
cerebro) por las cisuras que se ven en la lámina; el cuerpo calloso es el
campo #e0cbbd recortado a su arco; el tronco es el campo #f1eed4 (protuberancia
y bulbo) más el mesencéfalo del campo #e0cbbd; el cerebelo, su propio campo.
Las estructuras que un corte medial real no enseña enteras (hipocampo,
amígdala, corteza entorrinal, ventrículos) van como en los esquemas:
discretas, en su sitio aproximado.

Desviaciones deliberadas respecto a la anatomía de la lámina (documentadas
también en el informe de entrega):
- La "corteza temporal" es la cara medial bajo el pico del cuerpo calloso, que
  en la lámina es en realidad corteza orbitofrontal y área subcallosa; el
  temporal medial (uncus, parahipocampo) no asoma en un corte medial.
- El hipocampo, la amígdala y la corteza entorrinal van en esa zona, como
  esquema, no como estructuras vistas.
- El cíngulo no rodea el pico del calloso por debajo: la banda acaba en la
  rodilla para dejar sitio al temporal esquemático.
"""
from __future__ import annotations

import json
import math
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
from shapely.geometry import LineString, Polygon, MultiPolygon, box
from shapely.ops import unary_union

from geom import linea_a_bezier, muestrear_abierta, poligono_a_path, poligono_suave, tubo
from lamina import RECORTE_Y, aplanar, contorno, leer

SURCO = 1.5  # medio surco entre regiones vecinas: 3 px de lámina a la vista


def poli(d):
    """Polígono shapely (unión de subtrazados) de un trazado de la lámina."""
    partes = [Polygon(a).buffer(0) for a in aplanar(d) if len(a) >= 3]
    return unary_union(partes)


def elipse(cx, cy, rx, ry, giro=0.0, n=64):
    g = math.radians(giro)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        x, y = rx * math.cos(a), ry * math.sin(a)
        pts.append((cx + x * math.cos(g) - y * math.sin(g), cy + x * math.sin(g) + y * math.cos(g)))
    return Polygon(pts)


def limpiar(geom, minimo=120.0):
    """Sin astillas: descarta trozos de área pequeña que dejan las operaciones booleanas."""
    if geom.is_empty:
        return geom
    if isinstance(geom, Polygon):
        return geom if geom.area >= minimo else Polygon()
    if isinstance(geom, MultiPolygon):
        return unary_union([g for g in geom.geoms if g.area >= minimo])
    return unary_union([g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and g.area >= minimo])


def region(geom, r=SURCO, suavizado=1.2):
    """Retrocede medio surco y redondea las esquinas."""
    g = geom.buffer(-r, join_style=1)
    g = g.buffer(suavizado, join_style=1).buffer(-suavizado, join_style=1)
    return limpiar(g)


def construir():
    campos, trazos = leer()
    d_contorno, silueta_lamina = contorno(campos, trazos)
    por_color = {}
    for c in campos:
        por_color.setdefault(c["fill"], []).append(poli(c["d"]))
    # Campos: dos de corteza (#f0e1df: cerebro y cerebelo), calloso y tálamo (#e0cbbd), tronco (#f1eed4).
    cortezas = sorted(por_color["#f0e1df"], key=lambda g: g.area, reverse=True)
    manto_bruto = cortezas[0]
    cerebelo_campo = cortezas[1]
    beige = unary_union(por_color["#e0cbbd"])
    amarillo = unary_union(por_color["#f1eed4"])
    tinta = unary_union([poli(t["d"]) for t in trazos])
    lienzo = box(0, 0, 1000, RECORTE_Y)
    manto = manto_bruto.difference(beige).difference(amarillo).intersection(lienzo)

    # ------------------------------------------------------------ el cíngulo
    # La banda del giro cingular: entre el surco calloso (borde del campo
    # #e0cbbd) y el surco del cíngulo, unos 36 px por fuera del arco del
    # calloso, desde la rodilla hasta el esplenio y el istmo detrás de él.
    calloso_bruto = beige.intersection(Polygon([(440, 120), (780, 120), (790, 290), (700, 292), (660, 280), (580, 292), (520, 300), (440, 300)]))
    # El arco del calloso (sin el tálamo ni el mesencéfalo que también son beige): lo de dentro del arco
    # interior se quita con un polígono trazado a mano sobre la lámina.
    interior_arco = poligono_suave([(527, 232), (533, 212), (552, 198), (585, 189), (620, 186), (660, 190), (700, 205), (728, 226), (738, 250), (724, 268), (700, 278), (650, 292), (600, 290), (560, 280), (532, 262)], 10)
    calloso = limpiar(calloso_bruto.difference(interior_arco))
    banda = calloso.buffer(36, join_style=1).difference(calloso.buffer(SURCO * 2, join_style=1))
    # Sin la parte de debajo del pico ni por delante del temporal: la banda acaba en la rodilla.
    banda = banda.intersection(Polygon([(400, 90), (800, 90), (800, 262), (760, 300), (700, 300), (600, 262), (455, 262), (405, 262)]))
    # Más el istmo y la cuña anterior del precúneo detrás del esplenio.
    istmo = poligono_suave([(742, 200), (770, 208), (792, 232), (800, 262), (790, 292), (768, 302), (748, 290), (752, 262), (748, 236)], 8)
    cingulo = manto.intersection(unary_union([banda, istmo]))

    # ------------------------------------------------------------ los lóbulos
    # Cisuras de la lámina, como se ven en ella: central (paracentral) arriba
    # hacia x 612, parieto-occipital desde el istmo hacia arriba y atrás.
    surco_central = [(614, 20), (610, 70), (604, 110), (596, 150)]
    parieto_occipital = [(768, 300), (772, 262), (790, 230), (818, 205), (846, 186), (872, 160), (900, 130)]
    delante = Polygon([(0, 0)] + surco_central + [(596, 262), (455, 262), (405, 262), (380, 300), (250, 400), (0, 400)])
    detras = Polygon([(1000, 0), (1000, 620), (700, 620), (740, 320)] + parieto_occipital).buffer(0)
    medio = Polygon(surco_central + [(596, 262), (760, 262), (760, 300)] + parieto_occipital + [(900, 0)]).buffer(0)
    temporal_zona = poligono_suave([(388, 282), (455, 262), (520, 268), (562, 272), (578, 292), (580, 320), (560, 352), (520, 352), (470, 352), (420, 344), (392, 320)], 8)
    lobulos_libres = manto.difference(cingulo.buffer(SURCO * 2)).difference(temporal_zona.buffer(SURCO * 2))
    prefrontal = lobulos_libres.intersection(delante)
    parietal = lobulos_libres.intersection(medio)
    occipital = lobulos_libres.intersection(detras)
    temporal = manto.intersection(temporal_zona)

    # -------------------------------------------------- tálamo, tronco, cerebelo
    talamo = elipse(646, 254, 74, 31, -4).intersection(beige).intersection(interior_arco)
    mesencefalo = beige.intersection(Polygon([(560, 268), (600, 258), (700, 262), (720, 300), (712, 340), (712, 600), (560, 600)])).difference(talamo.buffer(SURCO * 2))
    tronco = unary_union([amarillo, mesencefalo]).intersection(lienzo)
    cerebelo = cerebelo_campo

    # ------------------------------------------------------------ el LCR
    # Ventrículo lateral: la hendidura entre el calloso y el fórnix; tercer
    # ventrículo bajo el fórnix y por delante del tálamo; acueducto hasta el
    # cuarto ventrículo, la cuña entre la protuberancia y el cerebelo.
    lateral = tubo([(540, 214), (575, 200), (620, 194), (665, 200), (703, 214), (724, 236)], [3.5, 4, 4, 4, 3.5, 3], 18)
    tercero = tubo([(576, 248), (571, 272), (580, 288), (605, 291), (640, 293), (660, 294)], [2.5, 2.5, 2.5, 2.5, 2.5, 2.5], 18)
    acueducto = tubo([(660, 294), (668, 320), (676, 350)], [2.5, 2.5, 3], 18)
    cuarto = poligono_suave([(676, 352), (690, 358), (700, 380), (700, 410), (694, 435), (684, 430), (678, 400), (674, 372)], 8)
    lcr = unary_union([lateral, tercero, acueducto, cuarto]).buffer(0.8, join_style=1).buffer(-0.8, join_style=1)

    # ---------------------------------------- hipocampo, amígdala, entorrinal
    hipocampo = tubo([(548, 300), (531, 311), (509, 319), (487, 323)], [5, 7.5, 9, 9.5], 14).buffer(0.8, join_style=1).buffer(-0.8, join_style=1)
    amigdala = elipse(455, 321, 12, 9, 12)
    entorrinal = tubo([(442, 335), (475, 337.5), (508, 337.5), (532, 334)], [4, 4.5, 4.5, 4], 14).buffer(0.8, join_style=1).buffer(-0.8, join_style=1)

    # ------------------------------------------------------------ el bulbo
    # Pegado a la cara orbitaria del frontal: el eje va 3 px por debajo del borde
    # inferior de la lámina en cada x, y el tubo (radio 5,5) se solapa 2 px con ella
    # para que la silueta sea una sola pieza.
    def borde_inferior(x):
        corte = silueta_lamina.intersection(LineString([(x, 250), (x, 420)]))
        return max(c[1] for c in corte.coords) if not corte.is_empty and hasattr(corte, "coords") else max(c[1] for g in corte.geoms for c in g.coords)
    bulbo = tubo([(x, borde_inferior(x) + 2.5) for x in (350, 364, 378, 392)], [2.8, 3.2, 3.2, 2.8], 10)

    # ------------------------------------------------------------ los vasos
    vasos = [
        # pericallosa: bajo el pico, alrededor de la rodilla y sobre el calloso hasta el esplenio
        [(548, 286), (502, 270), (470, 246), (462, 212), (476, 180), (514, 160), (570, 150), (630, 148), (690, 158), (733, 180), (754, 214), (756, 250), (748, 272)],
        # callosomarginal: nace en la rodilla y corre por el surco del cíngulo hasta el lobulillo paracentral
        [(462, 214), (450, 176), (466, 142), (510, 118), (570, 106), (626, 100), (642, 72), (646, 44)],
        # cerebral posterior: rodea el esplenio y sigue la calcarina
        [(730, 306), (756, 292), (792, 270), (830, 272), (868, 288), (898, 282)],
        # basilar: por la cara anterior de la protuberancia
        [(610, 304), (592, 320), (581, 346), (577, 380), (583, 412), (600, 434)],
    ]

    figuras = {
        "neocorteza": manto.buffer(-1.5, join_style=1),
        "corteza_prefrontal": region(prefrontal),
        "corteza_parietal": region(parietal),
        "corteza_occipital": region(occipital),
        "corteza_temporal": region(temporal),
        "cerebelo": region(cerebelo, 1.0),
        "tronco_locus_coeruleus": region(tronco, 1.0),
        "bulbo_olfatorio": bulbo,
        "sustancia_blanca": region(calloso, 1.0),
        "cingulo_precuneo": region(cingulo),
        "ganglios_basales_talamo": region(talamo, 1.0),
        "lcr": lcr,
        "hipocampo": hipocampo,
        "amigdala": amigdala,
        "corteza_entorrinal": entorrinal,
    }
    # La silueta: la lámina más el bulbo olfatorio, que cuelga bajo el frontal.
    silueta = unary_union([silueta_lamina, bulbo.buffer(1.5)])
    if silueta.geom_type == "MultiPolygon":
        raise SystemExit("el bulbo olfatorio no toca la lámina: la silueta se parte")
    from geom import anillo_a_bezier
    silueta = Polygon(silueta.exterior.coords).simplify(1.0, preserve_topology=True)
    d_contorno = anillo_a_bezier(list(silueta.exterior.coords), tension=0.25)
    return figuras, vasos, d_contorno, silueta


# El ojo, delante del frontal, mirando a la izquierda (lejos del cerebro): un
# globo esférico con la córnea y el iris en el lado izquierdo, el cristalino
# insinuado detrás, el nervio óptico saliendo por detrás hacia el polo frontal,
# y la retina como la capa que forra el fondo del globo: una media luna pegada
# a la pared posterior interna, dentro de la esfera.
OJO_CENTRO = (112.0, 345.0)
OJO_RADIO = 36.0


def ojo():
    """La media luna de la retina (geometría shapely) y las bases del ojo en color natural."""
    cx, cy = OJO_CENTRO
    fondo = elipse(cx, cy, OJO_RADIO - 3, OJO_RADIO - 3).difference(elipse(cx, cy, OJO_RADIO - 9.5, OJO_RADIO - 9.5))
    # Solo el fondo: el sector posterior de 62 grados a cada lado del eje.
    a = math.radians(62)
    sector = Polygon([(cx, cy), (cx + 100 * math.cos(-a), cy + 100 * math.sin(-a)), (cx + 100, cy - 10), (cx + 100, cy + 10), (cx + 100 * math.cos(a), cy + 100 * math.sin(a))])
    retina = fondo.intersection(sector).buffer(1.2, join_style=1).buffer(-1.2, join_style=1)
    bases = [
        # El nervio óptico: un tubo desde la pared posterior hacia el polo frontal (la lámina empieza en x 312).
        {"papel": "nervio", "geom": tubo([(cx + OJO_RADIO - 2, cy + 3), (200, 337), (258, 318), (306, 296)], [4.5, 4, 3.5, 3.5], 60).buffer(1.5, join_style=1).buffer(-1.5, join_style=1), "fill": "#e8dccd", "stroke": "#8a6a5a"},
        # El globo (la esclera): la pantalla lo sombrea como esfera.
        {"papel": "globo", "geom": elipse(cx, cy, OJO_RADIO, OJO_RADIO), "fill": "#f4efe6", "stroke": "#8a6a5a"},
        # La córnea, que sobresale por delante; el iris visto de canto; la pupila; el cristalino.
        {"papel": "cornea", "geom": elipse(cx - OJO_RADIO + 4, cy, 9, 18), "fill": "#dbe6ee", "stroke": "#8a9aa8"},
        {"papel": "iris", "geom": elipse(cx - OJO_RADIO + 7, cy, 4.5, 13), "fill": "#5c6f8a"},
        {"papel": "pupila", "geom": elipse(cx - OJO_RADIO + 6.5, cy, 2, 6), "fill": "#1d1a1f"},
        {"papel": "cristalino", "geom": elipse(cx - OJO_RADIO + 16, cy, 5, 10.5), "fill": "#f9f5e5", "stroke": "#b9a98e"},
    ]
    return retina, bases


def desplazar_d(d: str, dx: float, dy: float) -> str:
    """Un trazado con todas sus coordenadas trasladadas."""
    from lamina import ordenes, _fmt
    partes = []
    for orden, nums in ordenes(d):
        if orden == "Z":
            partes.append("Z")
            continue
        pares = [f"{_fmt(nums[i] + dx)} {_fmt(nums[i + 1] + dy)}" for i in range(0, len(nums), 2)]
        partes.append(orden + " " + " ".join(pares))
    return " ".join(partes)


def exteriores():
    with open(os.path.join(AQUI, "exteriores.json")) as f:
        datos = json.load(f)
    ext = dict(datos["exteriores"])
    # El intestino baja y se aleja del cerebelo (la lámina llega a x 836 en la base del cerebelo).
    ext["intestino_microbiota"] = desplazar_d(ext["intestino_microbiota"], 18, 22)
    # La retina ya no es la media luna suelta del dibujo viejo: la traza ojo(). El único trazo fino que queda es el brillo de la gota.
    del ext["retina"]
    return ext, datos["trazos_finos"][-1:]
