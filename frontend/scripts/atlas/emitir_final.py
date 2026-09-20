"""Genera frontend/src/lib/atlas_dibujo.ts (en esta carpeta) y previa.html a partir de las formas."""
from __future__ import annotations

import json
import os
import re

from formas_final import ancla_hacia, construir, trazos_finos, vasos
from geom import anillo_a_bezier, linea_a_bezier, poligono_a_path

AQUI = os.path.dirname(os.path.abspath(__file__))

# Las veinte claves de región, en el orden de rosa/mapa_enfermedad.py REGIONES.
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

# Orden de dibujo (lo de abajo primero) y disposición de cada región:
# clave, centro (punto dentro de la figura; "ancla:x,y" lo calcula hacia ese punto),
# etiqueta, capa, exterior, guia, giro, comentario.
DISPOSICION = [
    ("neocorteza", "ancla:905,322", (905, 322), "fondo", False, True, None,
     "El manto cortical entero: capa neutra que queda tapada por la silueta; existe porque el vocabulario la tiene."),
    ("cerebro_sin_region", (789, 330), (905, 392), "fondo", False, True, None,
     "La silueta entera (hemisferio, tronco, cerebelo y bulbo): capa neutra, no se ilumina; es lo que asoma por los surcos."),
    ("corteza_prefrontal", (318, 150), (318, 150), "region", False, False, None, None),
    ("corteza_parietal", (558, 104), (558, 104), "region", False, False, None,
     "El lobulillo paracentral: entre el surco central y el marginal."),
    ("corteza_occipital", (790, 250), (905, 250), "region", False, True, None,
     "La cuña detrás del surco parieto-occipital; la etiqueta va fuera, a la derecha."),
    ("corteza_temporal", (345, 395), (345, 395), "region", False, False, None, None),
    ("cerebelo", (745, 445), (745, 445), "region", False, False, None,
     "Óvalo aplanado bajo el occipital, cara anterior apoyada en el tronco, cinco festones y cuatro cisuras."),
    ("tronco_locus_coeruleus", (604, 470), (603, 572), "region", False, False, None,
     "Mesencéfalo bajo el tálamo, protuberancia abombada entre y 420 y 500 y bulbo que se estrecha."),
    ("bulbo_olfatorio", (262, 350), (165, 412), "region", False, True, None, None),
    ("sustancia_blanca", (436, 203), (436, 207), "region", False, False, None,
     "El cuerpo calloso; la etiqueta cabe dentro del arco."),
    ("cingulo_precuneo", (560, 161), (560, 165), "region", False, False, None,
     "La banda del giro cingular más la cuña del precúneo detrás del esplenio."),
    ("ganglios_basales_talamo", (532, 296), (532, 300), "region", False, False, None,
     "El huevo del tálamo bajo el ventrículo; delante y debajo queda el hipotálamo."),
    ("lcr", (566, 226), (566, 230), "region", False, False, None,
     "Ventrículo lateral bajo el cuerpo calloso, acueducto y cuarto ventrículo entre protuberancia y cerebelo."),
    ("hipocampo", (556, 390), (505, 464), "region", False, True, None,
     "La coma: cola fina bajo la cola del tálamo, cabeza gruesa delante, tocando la amígdala."),
    ("amigdala", (428, 386), (340, 470), "region", False, True, None, None),
    ("corteza_entorrinal", (460, 425), (420, 500), "region", False, True, None,
     "Banda del borde inferior medial del temporal, bajo el hipocampo."),
    ("vascular_bhe", (634, 70), (700, 22), "vasos", False, True, None,
     "Pericallosa, callosomarginal, basilar y cerebral posterior; el centro es el extremo de la rama marginal, en el vértice."),
    ("retina", (144, 345), (112, 296), "region", True, False, None,
     "La media luna del fondo del ojo; el ojo mira a la izquierda."),
    ("plasma", (135, 494), (135, 546), "region", True, False, None, None),
    ("intestino_microbiota", (896, 500), (896, 572), "region", True, False, None, None),
]


def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def espaciar(d):
    """Reescribe un trazado 'M1 2C3 4 5 6 7 8Z' como 'M 1 2 C 3 4, 5 6, 7 8 Z' (la gramática de los tests)."""
    fichas = re.findall(r"[MLCZ]|-?\d+(?:\.\d+)?", d)
    salida = []
    i = 0
    while i < len(fichas):
        f = fichas[i]
        if f == "M" or f == "L":
            salida.append(f"{f} {fichas[i + 1]} {fichas[i + 2]}")
            i += 3
        elif f == "C":
            salida.append(f"C {fichas[i + 1]} {fichas[i + 2]}, {fichas[i + 3]} {fichas[i + 4]}, {fichas[i + 5]} {fichas[i + 6]}")
            i += 7
        elif f == "Z":
            salida.append("Z")
            i += 1
        else:
            raise ValueError(f"ficha inesperada {f} en {d[:40]}")
    return " ".join(salida)


def generar(depurar=False):
    formas, crudas = construir(depurar=depurar)
    # Tolerancia de simplificación por figura: las pequeñas y las que llevan cisuras o festones piden más fidelidad.
    finas = {"cerebelo", "hipocampo", "amigdala", "lcr", "bulbo_olfatorio", "corteza_entorrinal", "retina", "plasma", "intestino_microbiota", "sustancia_blanca"}
    paths = {k: espaciar(poligono_a_path(g, tolerancia=0.45 if k in finas else 0.9)) for k, g in formas.items()}
    paths["vascular_bhe"] = " ".join(espaciar(linea_a_bezier(v)) for v in vasos().values())
    regiones = []
    for clave, centro, etiqueta, capa, exterior, guia, giro, nota in DISPOSICION:
        if isinstance(centro, str):
            x, y = (float(v) for v in centro.split(":")[1].split(","))
            centro = ancla_hacia(formas[clave], (x, y))
        regiones.append({"clave": clave, "d": paths[clave], "centro": list(centro), "etiqueta": list(etiqueta), "capa": capa, "exterior": exterior, "guia": guia, "giro": giro, "nota": nota})
    assert sorted(r["clave"] for r in regiones) == sorted(CLAVES), "faltan o sobran claves"
    for r in regiones:
        assert r["d"], f"trazado vacío: {r['clave']}"
    contorno = paths["cerebro_sin_region"]  # la misma cadena: el contorno ES la silueta
    tf = trazos_finos()
    trazos = [espaciar(anillo_a_bezier(c)) for c in tf["cerrados"]] + [espaciar(linea_a_bezier(a)) for a in tf["abiertos"]]
    return regiones, contorno, trazos


CABECERA = '''// La geometría del atlas de la enfermedad: un corte SAGITAL MEDIAL del cerebro
// (visto de lado, partido por la mitad, con la frente a la izquierda y la nuca
// a la derecha), más los compartimentos que no son una región anatómica pero sí
// un lugar donde se mide la enfermedad: la sangre (una gota), el intestino y la
// retina. Hay UNA figura por cada clave del vocabulario de
// rosa/mapa_enfermedad.py (REGIONES), en el mismo orden que allí; el test lo
// comprueba contra el fichero Python y contra REGIONES_CLAVES de lib/atlas.ts.
//
// Cómo está construido. Es la ilustración ganadora del concurso de dibujos del
// 18 de septiembre de 2026 con las correcciones de los jueces (anatomista y
// director de arte). Cada estructura es un polígono cerrado de curvas Bézier
// cúbicas generado con shapely a partir de puntos de control (el script vive en
// el cuaderno de trabajo, `atlas_final/formas_final.py`): el hemisferio con sus
// lóbulos, el cuerpo calloso (sustancia blanca) como arco, el ventrículo
// lateral como banda de 16 px bajo el arco con el acueducto y el cuarto
// ventrículo, el huevo del tálamo de 200 px, la banda del cíngulo con la cuña
// del precúneo detrás del esplenio, el hipocampo como una coma que baja de la
// cola del tálamo hasta la amígdala, la corteza entorrinal como banda bajo el
// hipocampo, el tronco con la protuberancia abombada y el bulbo que se
// estrecha, y el cerebelo como óvalo aplanado bajo el occipital con cinco
// festones y cuatro cisuras. Las regiones vecinas quedan separadas por un surco
// de 3 px por el que se ve el fondo; los surcos que parten un manto (central,
// marginal y parieto-occipital) son cortes de 3 px. Los vasos (pericallosa,
// callosomarginal, basilar y cerebral posterior) van como trazo encima de todo.
//
// Las capas 'fondo' (el manto cortical entero, "corteza sin región", y la
// silueta entera, "cerebro sin región") existen porque el vocabulario las
// tiene, pero están pensadas para NO iluminarse: son la silueta neutra sobre
// la que asientan las demás; un hueco se lee frío, nunca cálido. Van las dos
// primeras, el manto debajo de la silueta: así lo único que asoma por los
// surcos de 3 px es la silueta, y la zona de pulsación de los vasos, que corre
// por los surcos, no le roba superficie visible a una capa que apenas la tiene.
//
// Coordenadas en un lienzo lógico de 1000 por 620 (VISTA); la pantalla lo
// escala con el viewBox. Las etiquetas se colocaron a mano: dentro de la
// propia figura cuando cabe (lóbulos, cíngulo, tálamo, cuerpo calloso,
// ventrículo, cerebelo) y fuera del cerebro con una guía (`guia`) desde
// `centro` para las estructuras pequeñas; ninguna guía cruza el frontal en
// abanico ni atraviesa otra estructura pequeña. El test mide todo esto.
'''

CUERPO = '''
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
}

/** Las veinte claves de región, copiadas en el mismo orden de rosa/mapa_enfermedad.py REGIONES. */
export const CLAVES_REGION_DIBUJO: readonly string[] = [
__CLAVES__
];

/** Nombre corto para la figura (la etiqueta larga del backend va en el panel). */
export const NOMBRE_CORTO: Record<string, string> = {
__NOMBRES__
};

/** El trazado del contorno exterior del cerebro (trazo fino claro encima de las regiones). */
export const CONTORNO_CEREBRO = '__CONTORNO__';
/** El recorte de los lóbulos: la misma silueta (los lóbulos ya llegan justos al contorno; el clipPath solo evita que asome nada por fuera). */
export const RECORTE_HEMISFERIO = CONTORNO_CEREBRO;

// ---------------------------------------------------------------------------
// Las figuras, en orden de dibujo (lo de abajo primero)
// ---------------------------------------------------------------------------

export const REGIONES_DIBUJO: RegionDibujo[] = [
__REGIONES__
];

/** Claves que la pantalla ciñe al hemisferio con el clipPath (los cuatro lóbulos). */
export const RECORTADAS: ReadonlySet<string> = new Set(['corteza_prefrontal', 'corteza_parietal', 'corteza_occipital', 'corteza_temporal']);

/** Trazos decorativos finos: el ojo (globo y cristalino) con su nervio óptico
 *  hacia el cerebro, y el brillo de la gota. Los surcos y las cisuras del
 *  cerebelo no están aquí: son huecos de 3 px entre las propias figuras. */
export const TRAZOS_FINOS: { d: string; recortado?: boolean }[] = [
__TRAZOS__
];

/** La figura de una clave, o undefined si el vocabulario trae una que no está dibujada. */
export function regionDibujo(clave: string): RegionDibujo | undefined {
  return REGIONES_DIBUJO.find((r) => r.clave === clave);
}

/** Dónde acaba la guía de una etiqueta: en el borde del texto más cercano al
 *  centro de la región, no encima de las letras. La anchura del texto se
 *  estima por su longitud (13 px de cuerpo: unos 6,8 px por letra). */
export function finGuia(r: RegionDibujo): [number, number] {
  const [cx, cy] = r.centro;
  const [x, y] = r.etiqueta;
  const medio = (NOMBRE_CORTO[r.clave] ?? r.clave).length * 3.4 + 4;
  if (Math.abs(y - cy) < 12) return [x + (cx < x ? -medio : medio), y - 4];
  return [x, y > cy ? y - 13 : y + 4];
}
'''


def emitir_ts(regiones, contorno, trazos):
    claves = "\n".join(f"  '{c}'," for c in CLAVES)
    nombres = "\n".join(f"  {c}: '{NOMBRE_CORTO[c]}'," for c in CLAVES)
    filas = []
    for r in regiones:
        if r["nota"]:
            filas.append(f"  // {r['nota']}")
        campos = [f"clave: '{r['clave']}'", f"d: '{r['d']}'", f"centro: [{fmt(r['centro'][0])}, {fmt(r['centro'][1])}]", f"etiqueta: [{fmt(r['etiqueta'][0])}, {fmt(r['etiqueta'][1])}]"]
        if r["exterior"]:
            campos.append("exterior: true")
        if r["capa"] != "region":
            campos.append(f"capa: '{r['capa']}'")
        if r["guia"]:
            campos.append("guia: true")
        if r["giro"] is not None:
            campos.append(f"giro: {r['giro']}")
        filas.append("  {\n" + "".join(f"    {c},\n" for c in campos) + "  },")
    trazos_ts = "\n".join(f"  {{ d: '{t}' }}," for t in trazos)
    cuerpo = CUERPO.replace("__CLAVES__", claves).replace("__NOMBRES__", nombres).replace("__CONTORNO__", contorno).replace("__REGIONES__", "\n".join(filas)).replace("__TRAZOS__", trazos_ts)
    with open(os.path.join(AQUI, "atlas_dibujo.ts"), "w", encoding="utf-8") as f:
        f.write(CABECERA + cuerpo)


def emitir_html(regiones, contorno, trazos):
    reales = json.load(open(os.path.join(AQUI, "conteos_reales.json"), encoding="utf-8"))
    datos = {
        "regiones": [{k: v for k, v in r.items() if k != "nota"} for r in regiones],
        "contorno": contorno,
        "trazos": trazos,
        "recortadas": ["corteza_prefrontal", "corteza_parietal", "corteza_occipital", "corteza_temporal"],
        "nombreCorto": NOMBRE_CORTO,
        "etiquetasLargas": reales["etiquetas"],
        "conteos": reales["region"],
        "titulo": reales.get("titulo") or "",
    }
    plantilla = open(os.path.join(AQUI, "previa_final.html"), encoding="utf-8").read()
    html = plantilla.replace("__DATOS__", json.dumps(datos, ensure_ascii=False))
    with open(os.path.join(AQUI, "previa.html"), "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    import sys
    regiones, contorno, trazos = generar(depurar="--depurar" in sys.argv)
    emitir_ts(regiones, contorno, trazos)
    emitir_html(regiones, contorno, trazos)
    print("regiones:", len(regiones), "| tamaño ts:", os.path.getsize(os.path.join(AQUI, "atlas_dibujo.ts")))
