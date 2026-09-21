"""Genera src/lib/cerebro_base.ts, src/lib/atlas_dibujo.ts y una previa HTML.

Uso, desde frontend/:
    uv run --no-project --with shapely python scripts/atlas/lynch/generar.py [previa.html]

Lee la lámina (lamina.py), traza las regiones (regiones.py) y escribe los dos
ficheros TypeScript en su sitio, con el contrato que espera la pantalla. La
previa, si se pide, pinta la lámina con las regiones en colores planos
semitransparentes, sus centros, etiquetas y guías, sobre una rejilla, para
revisarla con Playwright antes de dar por buena la geometría.
"""
from __future__ import annotations

import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.dirname(AQUI))
from shapely.geometry import Point

from geom import linea_a_bezier, poligono_a_path
from lamina import CREDITO, ESCALA, RECORTE_Y, TX, TY, VISTA, leer
from regiones import OJO_CENTRO, OJO_RADIO, construir, exteriores, ojo

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(AQUI)))
SALIDA_BASE = os.path.join(RAIZ, "src", "lib", "cerebro_base.ts")
SALIDA_DIBUJO = os.path.join(RAIZ, "src", "lib", "atlas_dibujo.ts")

CLAVES = [
    "hipocampo", "corteza_entorrinal", "corteza_prefrontal", "corteza_temporal", "corteza_parietal",
    "cingulo_precuneo", "corteza_occipital", "amigdala", "ganglios_basales_talamo", "tronco_locus_coeruleus",
    "cerebelo", "sustancia_blanca", "vascular_bhe", "bulbo_olfatorio", "retina", "intestino_microbiota",
    "plasma", "lcr", "neocorteza", "cerebro_sin_region",
]

NOMBRE_CORTO = {
    "hipocampo": "hipocampo",
    "corteza_entorrinal": "corteza entorrinal",
    "corteza_prefrontal": "corteza frontal",
    "corteza_temporal": "corteza temporal",
    "corteza_parietal": "corteza parietal",
    "cingulo_precuneo": "cíngulo y precúneo",
    "corteza_occipital": "corteza occipital",
    "amigdala": "amígdala",
    "ganglios_basales_talamo": "ganglios basales y tálamo",
    "tronco_locus_coeruleus": "tronco y locus coeruleus",
    "cerebelo": "cerebelo",
    "sustancia_blanca": "sustancia blanca",
    "vascular_bhe": "vasos y barrera hematoencefálica",
    "bulbo_olfatorio": "bulbo olfatorio",
    "retina": "retina",
    "intestino_microbiota": "intestino y microbiota",
    "plasma": "sangre y plasma",
    "lcr": "LCR",
    "neocorteza": "corteza (sin región)",
    "cerebro_sin_region": "cerebro (sin región)",
}

# Orden de dibujo (lo de abajo primero): clave, centro, etiqueta, capa, exterior, guía, marca, comentario.
# Un centro "hacia:x,y" es el punto de la figura más cercano a ese punto (para figuras irregulares).
DISPOSICION = [
    ("neocorteza", (845, 300), (940, 400), "fondo", False, True, None,
     "El manto cortical entero (el campo de corteza de la lámina, retraído 1,5 px): capa neutra que no se ilumina; existe porque el vocabulario la tiene."),
    ("cerebro_sin_region", (880, 250), (940, 300), "fondo", False, True, None,
     "La silueta entera de la lámina más el bulbo olfatorio: capa neutra, no se ilumina."),
    ("corteza_prefrontal", (400, 150), (400, 150), "region", False, False, "arriba",
     "El lóbulo frontal medial por delante del surco central (que en la lámina llega arriba hacia x 612), sin la banda del cíngulo."),
    ("corteza_parietal", (700, 75), (700, 75), "region", False, False, "arriba",
     "El lobulillo paracentral y el precúneo: del surco central a la cisura parieto-occipital, por encima del cíngulo."),
    ("corteza_occipital", (850, 230), (940, 228), "region", False, True, None,
     "La cuña y el giro lingual: detrás de la cisura parieto-occipital, hasta el polo y la escotadura del tentorio."),
    ("corteza_temporal", (462, 298), (462, 298), "region", False, False, (550, 290),
     "La cara medial bajo el pico del calloso (en la lámina es orbitofrontal y área subcallosa: el temporal medial no asoma en un corte medial). Esquema."),
    ("cerebelo", (770, 425), (770, 425), "region", False, False, "arriba",
     "Todo el cerebelo con sus láminas: el campo de corteza pequeño de la lámina."),
    ("tronco_locus_coeruleus", (636, 470), (520, 540), "region", False, True, None,
     "Mesencéfalo (del campo del calloso y tálamo), protuberancia y bulbo (el campo #f1eed4) hasta el corte de la médula."),
    ("bulbo_olfatorio", (371, 313), (230, 380), "region", False, True, None,
     "Bastoncillo bajo la cara orbitaria del frontal; forma parte de la silueta."),
    ("sustancia_blanca", (615, 168), (615, 168), "region", False, False, "izquierda",
     "El arco del cuerpo calloso: el campo #e0cbbd de la lámina recortado a su arco interior."),
    ("cingulo_precuneo", (600, 127), (600, 127), "region", False, False, (714, 164),
     "El giro del cíngulo, la banda de 36 px que sigue el arco del calloso por fuera, más el istmo y la cuña anterior del precúneo detrás del esplenio."),
    ("ganglios_basales_talamo", (646, 258), (646, 258), "region", False, False, "abajo",
     "El tálamo: el óvalo del campo #e0cbbd bajo el fórnix, con la adherencia intertalámica en el centro."),
    ("lcr", (687, 398), (760, 500), "region", False, True, None,
     "Los ventrículos como trazos finos: el lateral bajo el calloso, el tercero bajo el fórnix, el acueducto y el cuarto ventrículo entre la protuberancia y el cerebelo (de él sale la guía)."),
    ("hipocampo", (543, 309), (550, 462), "region", False, True, None,
     "La coma, como en los esquemas: la cola bajo el pico del calloso, la cabeza hacia delante, en la zona temporal esquemática."),
    ("amigdala", (455, 321), (330, 420), "region", False, True, None,
     "La almendra delante de la cabeza del hipocampo."),
    ("corteza_entorrinal", (475, 339), (400, 480), "region", False, True, None,
     "Banda del borde inferior de la zona temporal, bajo el hipocampo."),
    ("vascular_bhe", (646, 44), (700, 15), "vasos", False, True, None,
     "Pericallosa, callosomarginal, cerebral posterior y basilar; el centro es el extremo de la callosomarginal en el lobulillo paracentral."),
    ("retina", (142, 345), (112, 290), "region", True, True, None,
     "La capa que forra el fondo del globo ocular: una media luna pegada a la pared posterior interna, dentro de la esfera; el ojo mira a la izquierda."),
    ("plasma", (135, 494), (135, 546), "region", True, False, None, "La gota de sangre."),
    ("intestino_microbiota", (914, 522), (914, 594), "region", True, False, None, "El intestino esquemático."),
]


def _fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def recortar_y(d: str, y_max: float) -> str:
    """Ninguna coordenada y (ni las asas de las Bézier) por debajo de y_max: la
    silueta se recorta en RECORTE_Y y las asas de la conversión a Bézier
    sobresalían unos píxeles por las esquinas del corte."""
    from lamina import ordenes, _fmt
    partes = []
    for orden, nums in ordenes(d):
        if orden == "Z":
            partes.append("Z")
            continue
        pares = [f"{_fmt(nums[i])} {_fmt(min(nums[i + 1], y_max))}" for i in range(0, len(nums), 2)]
        partes.append(orden + " " + " ".join(pares))
    return " ".join(partes)


def espaciar(d: str) -> str:
    """Órdenes y números separados por un espacio (la gramática de los tests y de la pantalla)."""
    import re
    return re.sub(r"\s+", " ", re.sub(r"([MCLZ])", r" \1 ", d)).strip()


def centro_en(geom, punto):
    """El propio punto si cae en la figura; si no, el punto interior más cercano (2 px hacia dentro)."""
    p = Point(punto)
    if geom.contains(p):
        return punto
    interior = geom.buffer(-2.5)
    if interior.is_empty:
        interior = geom
    borde = interior.boundary
    q = borde.interpolate(borde.project(p))
    return (round(q.x, 1), round(q.y, 1))


def ts_cadena(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def escribir_base(campos, trazos, d_contorno_lamina):
    lineas = [
        "// La lámina anatómica del atlas como datos: «Brain human sagittal section»",
        "// (Patrick J. Lynch y C. Carl Jaffe, Yale University School of Medicine, 2006,",
        "// CC BY 2.5, https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg),",
        "// un corte sagital medial con la frente a la izquierda. Cuatro campos de color",
        "// (dos de corteza, el cuerpo calloso con el tálamo, el tronco) y 146 trazos de",
        "// tinta parda que son formas cerradas RELLENAS (pinceladas exportadas como",
        "// polígonos): se pintan con fill, no con stroke. Las coordenadas ya están",
        "// transformadas al lienzo lógico de 1000 por 620 del atlas (VISTA en",
        f"// lib/atlas_dibujo.ts): escala {ESCALA:g}, traslación ({TX:g}, {TY:g}); la médula espinal",
        f"// se recorta por debajo de y = {RECORTE_Y:g} (recorteY). El original y su licencia",
        "// están en src/datos/atlas/. Fichero GENERADO por scripts/atlas/lynch/generar.py:",
        "// no editar a mano.",
        "",
        "export interface CampoLamina {",
        "  /** Trazado SVG cerrado (M, C, L, Z absolutos). */",
        "  d: string;",
        "  /** Color de relleno de la lámina. */",
        "  fill: string;",
        "}",
        "",
        "export const CEREBRO_BASE = {",
        "  credito: {",
    ]
    for k, v in CREDITO.items():
        lineas.append(f"    {k}: {ts_cadena(str(v)) if not isinstance(v, int) else v},")
    lineas += [
        "  },",
        "  /** El viewBox del SVG original, antes de la transformación. */",
        "  viewBox: '0 0 295.248 326.109',",
        f"  encaje: {{ escala: {ESCALA:g}, tx: {TX:g}, ty: {TY:g}, recorteY: {RECORTE_Y:g} }},",
        "  /** El color de la tinta de los trazos. */",
        "  tinta: '#532e1f',",
        "  /** Los cuatro campos de color, en el orden de la lámina (lo de abajo primero). */",
        "  campos: [",
    ]
    for c in campos:
        lineas.append(f"    {{ d: {ts_cadena(c['d'])}, fill: '{c['fill']}' }},")
    lineas += ["  ] as CampoLamina[],", "  /** Los trazos de tinta, formas cerradas que se rellenan con `tinta`. */", "  trazos: ["]
    for t in trazos:
        lineas.append(f"    {{ d: {ts_cadena(t['d'])} }},")
    lineas += [
        "  ] as { d: string }[],",
        "  /** La silueta exterior de la lámina (corteza, cerebelo y tronco, recortada en recorteY), cerrada. */",
        f"  contorno: {ts_cadena(d_contorno_lamina)},",
        "};",
        "",
    ]
    with open(SALIDA_BASE, "w") as f:
        f.write("\n".join(lineas))


def escribir_dibujo(regiones, d_contorno, trazos_finos, bases_ojo):
    cab = '''// La geometría del atlas de la enfermedad: un corte SAGITAL MEDIAL del cerebro
// (visto de lado, partido por la mitad, con la frente a la izquierda y la nuca
// a la derecha), más los compartimentos que no son una región anatómica pero sí
// un lugar donde se mide la enfermedad: la sangre (una gota), el intestino y la
// retina. Hay UNA figura por cada clave del vocabulario de
// rosa/mapa_enfermedad.py (REGIONES), en el mismo orden que allí; el test lo
// comprueba contra el fichero Python y contra REGIONES_CLAVES de lib/atlas.ts.
//
// Cómo está construido (21 de septiembre de 2026). Debajo de las regiones se
// pinta una ilustración anatómica real en colores naturales: la lámina de
// Patrick J. Lynch y C. Carl Jaffe (Yale, 2006, CC BY 2.5), que vive como
// datos en lib/cerebro_base.ts ya encajada en este lienzo. Las regiones son
// capas encima, trazadas SOBRE esa anatomía con shapely a partir de los
// propios campos de color de la lámina y de puntos de control (el generador es
// scripts/atlas/lynch/generar.py; este fichero es su salida): los cuatro
// lóbulos son recortes del manto cortical por el surco central, la cisura
// parieto-occipital y la banda del cíngulo; el cuerpo calloso es el campo del
// calloso recortado a su arco interior; el tálamo, el óvalo bajo el fórnix; el
// tronco, la protuberancia y el bulbo de la lámina más el mesencéfalo; el
// cerebelo, su propio campo con las láminas. Lo que un corte medial real no
// enseña entero (hipocampo, amígdala, corteza entorrinal, ventrículos) va como
// en los esquemas: discreto, en su sitio aproximado, y el comentario de cada
// figura lo dice. Entre regiones vecinas queda un surco de 3 px por el que se
// ve la lámina. Los vasos (pericallosa, callosomarginal, cerebral posterior y
// basilar) van como trazo encima de todo.
//
// Las capas 'fondo' (el manto cortical entero, "corteza sin región", y la
// silueta entera, "cerebro sin región") existen porque el vocabulario las
// tiene, pero están pensadas para NO iluminarse: la pantalla no las pinta
// (van a la bandeja de no localizados) y la silueta neutra es la propia
// lámina.
//
// Coordenadas en un lienzo lógico de 1000 por 620 (VISTA); la pantalla lo
// escala con el viewBox. Las etiquetas se colocaron a mano: dentro de la
// propia figura cuando cabe (lóbulos frontal y parietal, temporal, cíngulo,
// tálamo, cuerpo calloso, cerebelo) y fuera del cerebro con una guía (`guia`)
// desde `centro` para las estructuras pequeñas; ninguna guía atraviesa otra
// estructura pequeña. Las marcas (el punto de «buscada sin hallazgo» y el de
// discordia) van en `centro` cuando la etiqueta está fuera de la figura y,
// cuando está escrita dentro, junto al texto sin pisarlo (`marca`, resuelto
// por puntoMarca). El test mide todo esto.

import { CEREBRO_BASE } from './cerebro_base';

export const VISTA = { ancho: 1000, alto: 620 } as const;

export interface RegionDibujo {
  /** Clave del vocabulario (rosa/mapa_enfermedad.py REGIONES). */
  clave: string;
  /** El trazado SVG de la figura (atributo d). Puede tener varios subtrazados. */
  d: string;
  /** Un punto dentro de la figura: de aquí sale la guía de la etiqueta. */
  centro: [number, number];
  /** Dónde va el texto de la etiqueta (línea base, centrado). */
  etiqueta: [number, number];
  /** Fuera del cerebro (sangre, intestino, retina). */
  exterior?: boolean;
  /** Capa de dibujo: 'fondo' (silueta neutra), 'region' (lóbulos, núcleos, compartimentos) o 'vasos' (trazo, no relleno). */
  capa?: 'fondo' | 'region' | 'vasos';
  /** Dibujar una línea fina desde `centro` hasta la etiqueta (la etiqueta está fuera de la figura). */
  guia?: boolean;
  /** Giro del texto en grados (para leer a lo largo de una región estrecha). Ninguna etiqueta lo usa hoy. */
  giro?: number;
  /** Dónde va la marca de la región (el punto de «buscada sin hallazgo» o el
   *  de discordia) cuando la etiqueta va escrita DENTRO de la figura: encima o
   *  debajo del texto, a su izquierda o a su derecha en la misma fila, o un
   *  punto fijo [x, y] del lienzo (la corteza temporal: la etiqueta ocupa la
   *  anchura de la figura y el punto va a su derecha, bajo el pico del
   *  calloso). Sin él, la marca va en `centro`: la etiqueta está fuera de la
   *  figura y no la tapa. Ver puntoMarca(); el test comprueba que la marca
   *  cae dentro de su figura y fuera de la caja de toda etiqueta. */
  marca?: 'arriba' | 'abajo' | 'izquierda' | 'derecha' | [number, number];
}

/** Las veinte claves de región, copiadas en el mismo orden de rosa/mapa_enfermedad.py REGIONES. */
export const CLAVES_REGION_DIBUJO: readonly string[] = [
'''
    for c in CLAVES:
        cab += f"  '{c}',\n"
    cab += "];\n\n/** Nombre corto para la figura (la etiqueta larga del backend va en el panel). */\nexport const NOMBRE_CORTO: Record<string, string> = {\n"
    for c in CLAVES:
        cab += f"  {c}: {ts_cadena(NOMBRE_CORTO[c])},\n"
    cab += "};\n\n"
    cab += "/** La silueta exterior del cerebro (la lámina más el bulbo olfatorio), cerrada: contorno fino encima de las regiones y recorte de los lóbulos. */\n"
    cab += f"export const CONTORNO_CEREBRO = {ts_cadena(d_contorno)};\n"
    cab += "/** El recorte de los lóbulos: la misma silueta (los lóbulos ya nacen dentro; el clipPath solo evita que asome nada por fuera). */\n"
    cab += "export const RECORTE_HEMISFERIO = CONTORNO_CEREBRO;\n"
    cab += "/** La silueta de la lámina sola (sin el bulbo): lo que pinta cerebro_base. */\n"
    cab += "export const CONTORNO_LAMINA = CEREBRO_BASE.contorno;\n\n"
    cab += "// ---------------------------------------------------------------------------\n// Las figuras, en orden de dibujo (lo de abajo primero)\n// ---------------------------------------------------------------------------\n\n"
    cab += "export const REGIONES_DIBUJO: RegionDibujo[] = [\n"
    for r in regiones:
        if r["comentario"]:
            cab += f"  // {r['comentario']}\n"
        cab += "  {\n"
        cab += f"    clave: '{r['clave']}',\n"
        cab += f"    d: {ts_cadena(r['d'])},\n"
        cab += f"    centro: [{_fmt(r['centro'][0])}, {_fmt(r['centro'][1])}],\n"
        cab += f"    etiqueta: [{_fmt(r['etiqueta'][0])}, {_fmt(r['etiqueta'][1])}],\n"
        if r["exterior"]:
            cab += "    exterior: true,\n"
        if r["capa"] != "region":
            cab += f"    capa: '{r['capa']}',\n"
        if r["guia"]:
            cab += "    guia: true,\n"
        m = r["marca"]
        if isinstance(m, str):
            cab += f"    marca: '{m}',\n"
        elif m is not None:
            cab += f"    marca: [{_fmt(m[0])}, {_fmt(m[1])}],\n"
        cab += "  },\n"
    cab += "];\n\n"
    cab += "/** Claves que la pantalla ciñe al hemisferio con el clipPath (los cuatro lóbulos). */\n"
    cab += "export const RECORTADAS: ReadonlySet<string> = new Set(['corteza_prefrontal', 'corteza_parietal', 'corteza_occipital', 'corteza_temporal']);\n\n"
    cab += "/** Trazos decorativos finos: hoy solo el brillo de la gota. El ojo va entero\n *  en BASE_EXTERIOR (globo, córnea, iris, cristalino y nervio) y los surcos y\n *  las cisuras son la tinta de la propia lámina (lib/cerebro_base.ts). */\n"
    cab += "export const TRAZOS_FINOS: { d: string; recortado?: boolean }[] = [\n"
    for t in trazos_finos:
        cab += f"  {{ d: {ts_cadena(t)} }},\n"
    cab += "];\n\n"
    cab += "/** El globo ocular: centro y radio en el lienzo. La pantalla lo sombrea como\n *  una esfera (gradiente radial con la luz arriba a la izquierda y un brillo)\n *  y el 3D lo pinta como esfera, no como disco extruido. */\n"
    cab += f"export const GLOBO_OCULAR = {{ centro: [{_fmt(OJO_CENTRO[0])}, {_fmt(OJO_CENTRO[1])}] as [number, number], radio: {_fmt(OJO_RADIO)} }};\n\n"
    cab += "export interface BaseExterior {\n"
    cab += "  /** Trazado SVG cerrado. */\n  d: string;\n  /** Color natural de relleno. */\n  fill: string;\n  stroke?: string;\n"
    cab += "  /** Qué pieza es, para las que la pantalla trata aparte: el globo del ojo (sombreado como esfera) y su nervio óptico. */\n  papel?: 'globo' | 'nervio' | 'cornea' | 'iris' | 'pupila' | 'cristalino';\n}\n\n"
    cab += "/** Los compartimentos exteriores pintados en su color natural debajo de la\n *  capa de evidencia: el ojo entero (nervio, globo, córnea, iris, pupila y\n *  cristalino, en ese orden de pintado), la gota roja y el intestino rosado.\n *  Las claves son las de la región que va encima. */\n"
    cab += "export const BASE_EXTERIOR: Record<string, BaseExterior[]> = {\n  retina: [\n"
    for b in bases_ojo:
        stroke = f", stroke: '{b['stroke']}'" if b.get("stroke") else ""
        cab += f"    {{ d: {ts_cadena(b['d'])}, fill: '{b['fill']}'{stroke}, papel: '{b['papel']}' }},\n"
    cab += "  ],\n"
    cab += "  plasma: [{ d: REGIONES_DIBUJO.find((r) => r.clave === 'plasma')!.d, fill: '#b3282d', stroke: '#6f1418' }],\n"
    cab += "  intestino_microbiota: [{ d: REGIONES_DIBUJO.find((r) => r.clave === 'intestino_microbiota')!.d, fill: '#e2a39c', stroke: '#8a4a45' }],\n};\n\n"
    cab += '''
/** La figura de una clave, o undefined si el vocabulario trae una que no está dibujada. */
export function regionDibujo(clave: string): RegionDibujo | undefined {
  return REGIONES_DIBUJO.find((r) => r.clave === clave);
}

/** La mitad de la anchura de un texto de etiqueta más un margen: 13 px de
 *  cuerpo son unos 6,8 px por letra. Es la estimación con la que se colocan
 *  las guías y las marcas (y con la que los tests miden las cajas). */
export function medioTexto(texto: string): number {
  return texto.length * 3.4 + 4;
}

/** Dónde acaba la guía de una etiqueta: en el borde del texto más cercano al
 *  centro de la región, no encima de las letras. `texto` es lo que se pinta de
 *  verdad (el nombre más el número, si lo hay); sin él, el nombre corto. */
export function finGuia(r: RegionDibujo, texto: string = NOMBRE_CORTO[r.clave] ?? r.clave): [number, number] {
  const [cx, cy] = r.centro;
  const [x, y] = r.etiqueta;
  const medio = medioTexto(texto);
  if (Math.abs(y - cy) < 12) return [x + (cx < x ? -medio : medio), y - 4];
  return [x, y > cy ? y - 13 : y + 4];
}

/** Dónde va la marca de una región (el punto de «buscada sin hallazgo» o el
 *  punto de discordia): en `centro` cuando la etiqueta va fuera de la figura
 *  (con guía o pegada por fuera), y junto a la etiqueta, sin pisar las letras,
 *  cuando va escrita dentro (`marca`): centrada 20 px por encima de la línea
 *  base o 12 por debajo, o en la misma fila a 8 px del borde del texto que se
 *  pinta de verdad (`texto`: nombre más número). Un punto fijo manda tal cual. */
export function puntoMarca(r: RegionDibujo, texto: string = NOMBRE_CORTO[r.clave] ?? r.clave): [number, number] {
  const m = r.marca;
  if (!m) return r.centro;
  if (typeof m !== 'string') return m;
  const [x, y] = r.etiqueta;
  if (m === 'arriba') return [x, y - 20];
  if (m === 'abajo') return [x, y + 12];
  const medio = medioTexto(texto);
  return [m === 'izquierda' ? x - medio - 8 : x + medio + 8, y - 5];
}
'''
    with open(SALIDA_DIBUJO, "w") as f:
        f.write(cab)


def previa(campos, trazos, regiones, d_contorno, salida):
    colores = ["#4c9", "#c94", "#49c", "#c49", "#9c4", "#94c", "#cc4", "#4cc", "#c44", "#44c", "#4c4", "#c84", "#48c", "#8c4", "#c48", "#84c", "#888", "#f44", "#4f4", "#44f"]
    p = [f'<svg viewBox="0 0 {VISTA[0]} {VISTA[1]}" width="{VISTA[0]*2}" height="{VISTA[1]*2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0b0a14"/>']
    p.append(f'<clipPath id="r"><rect width="{VISTA[0]}" height="{RECORTE_Y}"/></clipPath><g clip-path="url(#r)">')
    for c in campos:
        p.append(f'<path d="{c["d"]}" fill="{c["fill"]}"/>')
    for t in trazos:
        p.append(f'<path d="{t["d"]}" fill="#532e1f"/>')
    p.append("</g>")
    p.append(f'<path d="{d_contorno}" fill="none" stroke="#0f0" stroke-width="0.8"/>')
    for i, r in enumerate(regiones):
        if r["capa"] == "fondo":
            continue
        col = colores[i % len(colores)]
        if r["capa"] == "vasos":
            p.append(f'<path d="{r["d"]}" fill="none" stroke="#e33" stroke-width="2.5"/>')
        else:
            p.append(f'<path d="{r["d"]}" fill="{col}" fill-opacity="0.45" stroke="{col}" stroke-width="0.8" fill-rule="evenodd"/>')
        cx, cy = r["centro"]
        ex, ey = r["etiqueta"]
        p.append(f'<circle cx="{cx}" cy="{cy}" r="2.5" fill="#fff"/>')
        if r["guia"]:
            p.append(f'<line x1="{cx}" y1="{cy}" x2="{ex}" y2="{ey}" stroke="#fff" stroke-width="0.6"/>')
        p.append(f'<text x="{ex}" y="{ey}" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">{NOMBRE_CORTO[r["clave"]]}</text>')
    for x in range(0, VISTA[0] + 1, 100):
        p.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{VISTA[1]}" stroke="#4af" stroke-width="0.4" opacity="0.5"/><text x="{x+2}" y="10" font-size="9" fill="#4af">{x}</text>')
    for y in range(0, VISTA[1] + 1, 100):
        p.append(f'<line x1="0" y1="{y}" x2="{VISTA[0]}" y2="{y}" stroke="#4af" stroke-width="0.4" opacity="0.5"/><text x="2" y="{y-2}" font-size="9" fill="#4af">{y}</text>')
    p.append("</svg>")
    with open(salida, "w") as f:
        f.write("<!doctype html><meta charset='utf-8'><body style='margin:0;background:#222'>" + "".join(p))


def main():
    campos, trazos = leer()
    figuras, vasos, d_contorno, silueta = construir()
    ext, trazos_finos = exteriores()
    retina_geom, bases_ojo = ojo()
    figuras["retina"] = retina_geom
    bases_ojo = [{**b, "d": espaciar(poligono_a_path(b["geom"], tolerancia=0.5, tension=0.26, minimo_area=5))} for b in bases_ojo]
    regiones = []
    for clave, centro, etiqueta, capa, exterior, guia, marca, comentario in DISPOSICION:
        if clave == "cerebro_sin_region":
            d = recortar_y(espaciar(d_contorno), RECORTE_Y)
            geom = silueta
        elif clave == "vascular_bhe":
            d = " ".join(espaciar(linea_a_bezier(v)) for v in vasos)
            geom = None
        elif clave in ext:
            d = ext[clave]
            geom = None
        else:
            geom = figuras[clave]
            d = espaciar(poligono_a_path(geom, tolerancia=0.9, tension=0.26, minimo_area=20))
            if not d:
                raise SystemExit(f"{clave}: figura vacía")
        c = centro_en(geom, centro) if geom is not None else centro
        if geom is not None and c != centro:
            print(f"aviso: el centro de {clave} {centro} no cae en su figura; usado {c}")
        regiones.append({"clave": clave, "d": d, "centro": c, "etiqueta": etiqueta, "capa": capa, "exterior": exterior, "guia": guia, "marca": marca, "comentario": comentario})
    faltan = set(CLAVES) - {r["clave"] for r in regiones}
    if faltan:
        raise SystemExit(f"faltan regiones: {faltan}")
    from lamina import contorno as contorno_lamina
    d_lamina, _ = contorno_lamina(campos, trazos)
    escribir_base(campos, trazos, recortar_y(espaciar(d_lamina), RECORTE_Y))
    escribir_dibujo(regiones, recortar_y(espaciar(d_contorno), RECORTE_Y), trazos_finos, bases_ojo)
    print("escritos", SALIDA_BASE, "y", SALIDA_DIBUJO)
    if len(sys.argv) > 1:
        previa(campos, trazos, regiones, d_contorno, sys.argv[1])
        print("previa", sys.argv[1])


if __name__ == "__main__":
    main()
