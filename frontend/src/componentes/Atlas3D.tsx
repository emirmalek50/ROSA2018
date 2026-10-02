// El atlas en relieve: el HEMISFERIO del corte sagital, no el dibujo plano
// estirado hacia atrás. Comparte la cámara orbital del árbol (lib/arbol3d.ts).
// La evidencia conserva sus claves y sus conteos; el volumen es ilustrativo.
//
// Por qué cambió (Emir, 21 de septiembre de 2026: "en el 3d no sería mejor que
// la parte que no tiene diseño siga teniendo diseño? digo, los cerebros son
// 3d"): antes la silueta se extruía un grosor fijo y al girar aparecía una
// pared lisa del tamaño del cerebro, que es lo que se ve en un sello de goma y
// no en un encéfalo. Ahora el cuerpo es un mapa de alturas construido en
// lib/atlas_relieve.ts: el corte medial queda en un plano y la superficie se
// levanta hacia el lado, redondeada en el borde, estrecha en el tronco, más
// ancha en el cerebelo y plegada con surcos. La malla se pinta cuadrilátero a
// cuadrilátero con luz difusa, de lejos a cerca.
//
// Cómo se pinta:
// - Los sólidos (el cerebro y cada compartimento de fuera) se ordenan de lejos
//   a cerca por la profundidad de su centro, el algoritmo del pintor.
// - Del cerebro: si la cara del corte mira a la cámara, primero la superficie
//   (que queda detrás y solo asoma por los lados) y encima el corte con la
//   lámina anatómica, sus regiones, sus marcas y sus etiquetas; si la cámara
//   ha pasado al otro lado, primero la silueta del corte como fondo del canto
//   y encima la superficie, que entonces es lo que se ve.
// - La superficie lleva el tinte de la evidencia solo en las regiones que de
//   verdad llegan a ella (las cortezas, el cerebelo, el tronco y el bulbo).
//   Las estructuras profundas, como el tálamo o el hipocampo, no se pintan en
//   la superficie: sacarlas ahí fuera sería inventar dónde están.
// - Los compartimentos de fuera son volúmenes: la gota y el intestino se
//   extruyen con paredes sombreadas, y el ojo, que es una esfera, se pinta
//   como esfera, con la retina forrando el fondo por dentro.
//
// Cómo entra: de frente, idéntico al 2D (guiñada y cabeceo a cero, y la cámara
// a FOCAL del plano del corte, que así se proyecta a escala 1) y gira en unos
// 700 ms hasta la vista en reposo. Con movimiento reducido no hay animación.
// Cualquier gesto corta el giro. El lienzo mide lo mismo que el SVG del 2D,
// así que al cambiar de vista la maqueta no salta.
import { useEffect, useRef, useState } from 'react';
import { acotarCamara, ESCALA_MAXIMA, FOCAL, PLANO_CERCANO, proyectar, SENSIBILIDAD_GIRO, type Camara } from '../lib/arbol3d';
import { rellenoRegion, tokenAtlas } from '../lib/atlas_color';
import { BASE_EXTERIOR, CONTORNO_CEREBRO, finGuia, GLOBO_OCULAR, NOMBRE_CORTO, puntoMarca, RECORTADAS, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA } from '../lib/atlas_dibujo';
import { construirRelieve, type Poligono, type Relieve } from '../lib/atlas_relieve';
import { CEREBRO_BASE } from '../lib/cerebro_base';
import { intensidad, NO_LOCALIZADAS, type Atlas, type RegionAtlas } from '../lib/atlas';
import { useMovimientoReducido } from '../lib/movimiento';
import { tr, trp } from '../lib/idioma';

type Punto = { x: number; y: number };
type Trazo = { puntos: Punto[]; cerrado: boolean };
/** Mitad del ancho del hemisferio, en unidades del lienzo. Con el cerebro de
 *  la lámina midiendo unos 620 de largo (unos 170 mm de verdad), 232 son los
 *  65 mm que hay del plano medio a la cara lateral. */
export const PROFUNDIDAD = 232;
/** El plano del corte, centrado para que el cuerpo gire alrededor de su medio. */
export const Z_CORTE = -PROFUNDIDAD / 2;
/** Lado de la celda de la malla: menos es más fino y más caro de pintar. */
export const PASO_MALLA = 9;
/** La vista en reposo: de lado y algo desde arriba, con el volumen asomando por detrás. */
export const inicial = (): Camara => ({ guinada: 0.72, cabeceo: 0.16, distancia: 1260 });
/** El punto alrededor del que gira la vista: el centro del hemisferio. La
 *  pantalla lo mantiene clavado donde lo deja la vista frontal, así que el
 *  cerebro no se va de paseo por el lienzo al girarlo. */
export const PIVOTE = { x: 608 - VISTA.ancho / 2, y: 300 - VISTA.alto / 2, z: -PROFUNDIDAD / 2 + PROFUNDIDAD * 0.45 };
/** La vista frontal idéntica al 2D: el plano del corte queda a FOCAL de la cámara y se proyecta a escala 1. */
export const frontal = (): Camara => ({ guinada: 0, cabeceo: 0, distancia: FOCAL - Z_CORTE });
/** Cuánto dura el giro de entrada, en milisegundos. */
export const DURACION_ENTRADA = 700;
const regiones = REGIONES_DIBUJO.filter((r) => !NO_LOCALIZADAS.has(r.clave));
const FONDO = '#0b0a14';
const TEXTO = '#f4efe4';
const DISCORDIA = '#d1352b';
const SELECCION = '#2b1b10';
const BORDE = 'rgba(255, 255, 255, 0.78)';
const TINTA = CEREBRO_BASE.tinta;
/** Las regiones que llegan de verdad a la superficie del hemisferio y por eso
 *  se tiñen en ella. Las profundas (tálamo, hipocampo, amígdala, sustancia
 *  blanca, ventrículos, vasos mediales) solo se pintan en la cara del corte. */
const SUPERFICIALES: ReadonlySet<string> = new Set(['corteza_prefrontal', 'corteza_parietal', 'corteza_occipital', 'corteza_temporal', 'cingulo_precuneo', 'corteza_entorrinal', 'cerebelo', 'tronco_locus_coeruleus', 'bulbo_olfatorio', 'neocorteza']);
/** El color del tejido de cada zona de la superficie, en canales 0 a 255. */
const TEJIDO: Record<string, [number, number, number]> = {
  corteza: [236, 205, 196],
  cerebelo: [238, 219, 201],
  tronco: [241, 233, 208],
};
/** Semiancho y plegado de cada zona: el tronco es estrecho y liso, el cerebelo
 *  ancho y con folias finas, el bulbo casi un cordón. */
const ZONAS: { clave: string; region: string; semiancho: number; surco: number; onda: number }[] = [
  { clave: 'tronco', region: 'tronco_locus_coeruleus', semiancho: 42, surco: 2, onda: 40 },
  { clave: 'cerebelo', region: 'cerebelo', semiancho: 168, surco: 5, onda: 21 },
  { clave: 'corteza', region: 'bulbo_olfatorio', semiancho: 16, surco: 1, onda: 40 },
];
/** La luz de la escena, en el sistema de la cámara: arriba, a la izquierda y
 *  por delante. La misma para el hemisferio y para los compartimentos. */
const LUZ = { x: -0.44, y: -0.58, z: -0.69 };
const AMBIENTE = 0.26;
/** Niveles de luz distintos que se guardan en la caché de colores. */
const NIVELES_LUZ = 48;
/** Medio grosor de cada compartimento exterior: la gota (56 de ancho) es
 *  redonda, el intestino un tubo de unos 22, y el ojo una esfera aparte. */
const GROSOR_EXTERIOR: Record<string, number> = { plasma: 26, retina: 0, intestino_microbiota: 11 };
/** El color de las paredes de cada sólido extruido según la luz (0 en sombra, 1 de cara). */
const PARED: Record<string, (luz: number) => string> = {
  plasma: (luz) => `hsl(358 62% ${Math.round(22 + 18 * luz)}%)`,
  intestino_microbiota: (luz) => `hsl(6 42% ${Math.round(40 + 24 * luz)}%)`,
};
// El hemisferio ocupa más que el tronco del árbol: impedir atravesar su volumen.
const ajustar = (c: Camara): Camara => acotarCamara({ ...c, distancia: Math.max(880, c.distancia) });
/** Salida suave (la misma curva que lib/movimiento.ts, cúbica). */
const suavizar = (k: number): number => 1 - (1 - k) ** 3;
const entre = (a: Camara, b: Camara, k: number): Camara => ({ guinada: a.guinada + (b.guinada - a.guinada) * k, cabeceo: a.cabeceo + (b.cabeceo - a.cabeceo) * k, distancia: a.distancia + (b.distancia - a.distancia) * k });
const acotar01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** El navegador muestrea cada subtrazado por separado: conserva agujeros y
 * vasos disjuntos, sin unirlos con diagonales inventadas. Solo al montar. */
function muestrear(d: string, paso = 3): Trazo[] {
  return (d.match(/[Mm][^Mm]*/g) ?? []).map((parte) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', parte);
    const longitud = path.getTotalLength();
    const n = Math.max(4, Math.ceil(longitud / paso));
    return { cerrado: /[Zz]\s*$/.test(parte), puntos: Array.from({ length: n + 1 }, (_, i) => {
      const p = path.getPointAtLength(longitud * i / n);
      return { x: p.x - VISTA.ancho / 2, y: p.y - VISTA.alto / 2 };
    }) };
  });
}

/** Los trazos muestreados como polígonos para lib/atlas_relieve.ts. */
const aPoligonos = (trazos: Trazo[]): Poligono[] => trazos.map((t) => t.puntos.map((p) => [p.x, p.y] as const));

function camino(trazos: Trazo[], z: number, camara: Camara): Path2D {
  const path = new Path2D();
  for (const trazo of trazos) {
    trazo.puntos.forEach((p, i) => {
      const q = proyectar({ ...p, z }, camara, VISTA.ancho, VISTA.alto);
      if (i === 0) path.moveTo(q.x, q.y); else path.lineTo(q.x, q.y);
    });
    if (trazo.cerrado) path.closePath();
  }
  return path;
}

/** Un punto del lienzo lógico proyectado con la cámara, a la profundidad dada. */
function punto(p: readonly [number, number], z: number, camara: Camara): Punto {
  const q = proyectar({ x: p[0] - VISTA.ancho / 2, y: p[1] - VISTA.alto / 2, z }, camara, VISTA.ancho, VISTA.alto);
  return { x: q.x, y: q.y };
}

export function Atlas3D({ atlas, seleccion, seleccionar }: { atlas: Atlas; seleccion: string | null; seleccionar: (clave: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducido = useMovimientoReducido();
  const reducidoRef = useRef(reducido);
  reducidoRef.current = reducido;
  const camara = useRef(inicial());
  const datos = useRef({ atlas, seleccion, seleccionar });
  datos.current = { atlas, seleccion, seleccionar };
  const redibujar = useRef(() => {});
  const detener = useRef(() => {});
  const detectar = useRef<(x: number, y: number) => string | null>(() => null);
  const arrastre = useRef<{ id: number; x: number; y: number; movido: boolean } | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const focoRef = useRef<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const lienzo = canvas.current;
    if (!lienzo) return;
    let ctx: CanvasRenderingContext2D | null;
    try { ctx = lienzo.getContext('2d'); } catch { ctx = null; }
    if (!ctx || typeof SVGPathElement === 'undefined' || !SVGPathElement.prototype.getTotalLength) {
      setFallo(true);
      return;
    }
    const contexto = ctx;
    const contorno = muestrear(CONTORNO_CEREBRO);
    const formas = regiones.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    const finos = TRAZOS_FINOS.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    // La lámina: los campos (con su color) y la tinta, muestreados una vez; la médula se recorta con la propia silueta.
    const campos = CEREBRO_BASE.campos.map((c) => ({ fill: c.fill, trazos: muestrear(c.d, 4) }));
    const tinta = CEREBRO_BASE.trazos.map((t) => muestrear(t.d, 4));
    // El volumen del hemisferio: mapa de alturas sobre el plano del corte.
    const superficiales = formas.filter((r) => SUPERFICIALES.has(r.clave) && !r.exterior);
    const relieve: Relieve = construirRelieve({
      contorno: aPoligonos(contorno),
      paso: PASO_MALLA,
      semiancho: PROFUNDIDAD,
      radio: 150,
      surco: 9,
      onda: 44,
      zonas: ZONAS.map((z) => ({ clave: z.clave, semiancho: z.semiancho, surco: z.surco, onda: z.onda, poligonos: aPoligonos(formas.find((f) => f.clave === z.region)?.trazos ?? []) })),
      regiones: superficiales.map((r) => ({ clave: r.clave, poligonos: aPoligonos(r.trazos) })),
    });
    const nNodos = relieve.nodos.length / 3;
    const px = new Float32Array(nNodos);
    const py = new Float32Array(nNodos);
    const visibleNodo = new Uint8Array(nNodos);
    // La clase de cada celda (su región y su zona) decide su color: son pocas,
    // así que el color se calcula una vez por clase y se guarda por nivel de luz.
    const nZonas = relieve.zonas.length + 1;
    const nClases = (relieve.regiones.length + 1) * nZonas;
    const claseDeCelda = new Int16Array(relieve.total);
    for (let c = 0; c < relieve.total; c++) claseDeCelda[c] = (relieve.region[c]! + 1) * nZonas + (relieve.zona[c]! + 1);
    const baseClase = new Float64Array(nClases * 3);
    const cacheColor: (string | undefined)[] = new Array(nClases * NIVELES_LUZ);
    const orden: number[] = new Array(relieve.total);
    const profundidadCelda = new Float32Array(relieve.total);
    const luzCelda = new Uint8Array(relieve.total);
    const hitX = new Float32Array(relieve.total);
    const hitY = new Float32Array(relieve.total);
    const finosConSolido: { trazos: Trazo[]; recortado?: boolean; solido: string }[] = [];
    const frio = tokenAtlas('--atlas-frio', '');
    const calido = tokenAtlas('--atlas-calido', '');
    // Los sólidos: el cerebro y cada compartimento exterior (su primera base es el contorno que se extruye).
    const solidos = [
      { clave: 'cerebro', contorno, grosor: 0, centro: [600, 300] as const, bases: [] as { fill: string; stroke?: string; papel?: string; trazos: Trazo[] }[] },
      ...Object.entries(BASE_EXTERIOR).map(([clave, partes]) => ({ clave, contorno: muestrear((partes.find((b) => b.papel === 'globo') ?? partes[0]!).d), grosor: GROSOR_EXTERIOR[clave] ?? 12, centro: (clave === 'retina' ? GLOBO_OCULAR.centro : REGIONES_DIBUJO.find((r) => r.clave === clave)?.centro ?? [500, 310]) as readonly [number, number], bases: partes.map((b) => ({ fill: b.fill, stroke: b.stroke, papel: b.papel, trazos: muestrear(b.d) })) })),
    ];
    // A qué sólido pertenece cada trazo fino (el cristalino y el nervio del ojo, el brillo de la gota): el que contiene su primer punto de frente.
    for (const f of finos) {
      const p = f.trazos[0]?.puntos[0];
      let solido = 'cerebro';
      if (p) {
        for (const s of solidos) {
          if (s.clave === 'cerebro') continue;
          const path = new Path2D();
          s.contorno.forEach((tr) => tr.puntos.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y))));
          path.closePath();
          contexto.save(); contexto.resetTransform();
          const dentro = contexto.isPointInPath(path, p.x, p.y, 'evenodd');
          contexto.restore();
          if (dentro) { solido = s.clave; break; }
        }
      }
      finosConSolido.push({ ...f, solido });
    }
    const tile = document.createElement('canvas');
    tile.width = tile.height = 8;
    const tc = tile.getContext('2d')!;
    tc.strokeStyle = 'rgba(83, 46, 31, 0.45)';
    tc.lineWidth = 1.2;
    tc.moveTo(0, 8); tc.lineTo(8, 0); tc.stroke();
    const rayas = contexto.createPattern(tile, 'repeat');
    let frame = 0;
    let animacion = 0;
    let escala = 1;
    let ox = 0;
    let oy = 0;
    let desvioX = 0;
    let desvioY = 0;
    let selloAtlas: Atlas | null = null;
    let sello = '';
    let nVisibles = 0;
    let zonas: { clave: string; path: Path2D; clip: Path2D | null; vasos: boolean }[] = [];
    /** El color de cada clase de celda: el tejido de su zona con el tinte de su
     *  región encima. Se rehace cuando cambian los datos, el foco o la selección. */
    const prepararColores = () => {
      // El atlas se rehace entero cuando cambian los datos o los filtros, así
      // que basta comparar su identidad con la de la última pintada.
      const clave = `${datos.current.seleccion ?? ''}|${focoRef.current ?? ''}`;
      if (clave === sello && datos.current.atlas === selloAtlas) return;
      sello = clave;
      selloAtlas = datos.current.atlas;
      cacheColor.fill(undefined);
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      for (let ri = -1; ri < relieve.regiones.length; ri++) {
        const clave = ri >= 0 ? relieve.regiones[ri]! : '';
        const dato = clave ? porClave.get(clave) : undefined;
        const conFoco = clave !== '' && (clave === focoRef.current || clave === datos.current.seleccion);
        const t = intensidad(dato?.cohortes.length ?? 0, datos.current.atlas.cohortesMax);
        const relleno = dato?.conteo ? rellenoRegion(t, { frio, calido, foco: conFoco }) : null;
        const tinte = relleno ? (relleno.color.match(/\d+/g) ?? []).map(Number) : null;
        for (let zi = -1; zi < relieve.zonas.length; zi++) {
          const zona = zi >= 0 ? relieve.zonas[zi]! : 'corteza';
          const base = TEJIDO[zona] ?? TEJIDO.corteza!;
          let r = base[0];
          let g = base[1];
          let b = base[2];
          if (tinte && tinte.length === 3) {
            // El tinte sobre el tejido, algo más suave que en el corte: aquí es
            // superficie, no mapa, y la luz tiene que seguir leyéndose.
            const op = acotar01(relleno!.opacidad * 0.86);
            r = r * (1 - op) + tinte[0]! * op;
            g = g * (1 - op) + tinte[1]! * op;
            b = b * (1 - op) + tinte[2]! * op;
          }
          if (dato?.discordia.length) { r = r * 0.76 + 209 * 0.24; g = g * 0.76 + 53 * 0.24; b = b * 0.76 + 43 * 0.24; }
          const i = ((ri + 1) * nZonas + (zi + 1)) * 3;
          baseClase[i] = r; baseClase[i + 1] = g; baseClase[i + 2] = b;
        }
      }
    };
    const colorDe = (clase: number, nivel: number): string => {
      const k = clase * NIVELES_LUZ + nivel;
      const guardado = cacheColor[k];
      if (guardado) return guardado;
      const f = AMBIENTE + (1 - AMBIENTE) * (nivel / (NIVELES_LUZ - 1));
      const i = clase * 3;
      const color = `rgb(${Math.round(baseClase[i]! * f)}, ${Math.round(baseClase[i + 1]! * f)}, ${Math.round(baseClase[i + 2]! * f)})`;
      cacheColor[k] = color;
      return color;
    };
    /** La superficie del hemisferio: proyecta los nodos, descarta las celdas que
     *  dan la espalda a la cámara y pinta el resto de lejos a cerca. */
    const pintarSuperficie = (c: Camara) => {
      if (!relieve.total) return;
      prepararColores();
      const cg = Math.cos(c.guinada), sg = Math.sin(c.guinada), cc = Math.cos(c.cabeceo), sc = Math.sin(c.cabeceo);
      const cx = VISTA.ancho / 2, cy = VISTA.alto / 2;
      for (let k = 0; k < nNodos; k++) {
        if (!relieve.dentro[k]) { visibleNodo[k] = 0; continue; }
        const x = relieve.nodos[k * 3]!, y = relieve.nodos[k * 3 + 1]!, z = Z_CORTE + relieve.nodos[k * 3 + 2]!;
        const x1 = x * cg + z * sg;
        const z1 = -x * sg + z * cg;
        const profundidad = y * sc + z1 * cc + c.distancia;
        if (!(profundidad > PLANO_CERCANO)) { visibleNodo[k] = 0; continue; }
        const e = Math.min(ESCALA_MAXIMA, FOCAL / profundidad);
        px[k] = cx + x1 * e;
        py[k] = cy + (y * cc - z1 * sc) * e;
        visibleNodo[k] = 1;
      }
      nVisibles = 0;
      for (let cel = 0; cel < relieve.total; cel++) {
        const a = relieve.celdas[cel * 4]!, b = relieve.celdas[cel * 4 + 1]!, d = relieve.celdas[cel * 4 + 2]!, e = relieve.celdas[cel * 4 + 3]!;
        if (!visibleNodo[a] || !visibleNodo[b] || !visibleNodo[d] || !visibleNodo[e]) continue;
        // La normal rotada: si mira hacia donde mira la cámara, la celda está de espaldas.
        const nx = relieve.normales[cel * 3]!, ny = relieve.normales[cel * 3 + 1]!, nz = relieve.normales[cel * 3 + 2]!;
        const nx1 = nx * cg + nz * sg;
        const nz1 = -nx * sg + nz * cg;
        const rny = ny * cc - nz1 * sc;
        const rnz = ny * sc + nz1 * cc;
        // Un margen al descartar: las celdas del canto quedan casi de perfil y,
        // con el corte justo delante, descartarlas abría una franja negra
        // entre el dibujo y el cuerpo.
        if (rnz >= 0.12) continue;
        const cz = Z_CORTE + relieve.centros[cel * 3 + 2]!;
        const cxm = relieve.centros[cel * 3]!, cym = relieve.centros[cel * 3 + 1]!;
        profundidadCelda[cel] = cym * sc + (-cxm * sg + cz * cg) * cc + c.distancia;
        // Luz envolvente (media difusa, "wrap"): la cara que se aparta de la luz
        // no cae a negro, como pasa en el tejido de verdad, que reparte la luz
        // por dentro. Sin esto el hemisferio se veía de piedra gris.
        const difusa = acotar01(0.5 + 0.5 * (nx1 * LUZ.x + rny * LUZ.y + rnz * LUZ.z));
        // Luz de borde: donde la superficie se va de canto, la cara que mira a
        // la cámara recibe poca difusa y salía gris apagada; encenderla es lo
        // que hace que el tejido parezca húmedo y no piedra.
        const borde = (1 + rnz) ** 2.4;
        const lam = acotar01(difusa * 0.82 + borde * 0.34);
        luzCelda[cel] = Math.min(NIVELES_LUZ - 1, Math.round(lam * (NIVELES_LUZ - 1)));
        hitX[cel] = (px[a]! + px[b]! + px[d]! + px[e]!) / 4;
        hitY[cel] = (py[a]! + py[b]! + py[d]! + py[e]!) / 4;
        orden[nVisibles++] = cel;
      }
      const lista = orden.slice(0, nVisibles).sort((p, q) => profundidadCelda[q]! - profundidadCelda[p]!);
      contexto.lineJoin = 'round';
      contexto.lineWidth = 0.7;
      for (const cel of lista) {
        const a = relieve.celdas[cel * 4]!, b = relieve.celdas[cel * 4 + 1]!, d = relieve.celdas[cel * 4 + 2]!, e = relieve.celdas[cel * 4 + 3]!;
        const color = colorDe(claseDeCelda[cel]!, luzCelda[cel]!);
        contexto.beginPath();
        contexto.moveTo(px[a]!, py[a]!);
        contexto.lineTo(px[b]!, py[b]!);
        contexto.lineTo(px[d]!, py[d]!);
        contexto.lineTo(px[e]!, py[e]!);
        contexto.closePath();
        contexto.fillStyle = color;
        contexto.fill();
        // El mismo color en el borde: sin esto el fondo se cuela entre celdas.
        contexto.strokeStyle = color;
        contexto.stroke();
      }
      // Reordenar deja la lista mezclada: el hit test usa su propia copia.
      for (let i = 0; i < nVisibles; i++) orden[i] = lista[i]!;
    };
    const pintar = () => {
      frame = 0;
      const rect = lienzo.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      contexto.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Se limpia el lienzo entero (en píxeles del dispositivo, no en el alto fraccionario de la caja):
      // si no, la última fila, cubierta a medias, se mezclaba con la del fotograma anterior y dos
      // pintadas de la misma cámara no daban la misma imagen.
      contexto.clearRect(0, 0, w / dpr + 1, h / dpr + 1);
      contexto.fillStyle = FONDO; contexto.fillRect(0, 0, w / dpr + 1, h / dpr + 1);
      escala = Math.min(rect.width / VISTA.ancho, rect.height / VISTA.alto);
      ox = (rect.width - VISTA.ancho * escala) / 2;
      oy = (rect.height - VISTA.alto * escala) / 2;
      contexto.translate(ox, oy); contexto.scale(escala, escala);
      const c = camara.current;
      // El giro se hace alrededor del origen del lienzo, no del cerebro: sin
      // compensarlo, el hemisferio se iba hacia un lado al girar y se salía.
      const anclaAhora = proyectar(PIVOTE, c, VISTA.ancho, VISTA.alto);
      const anclaFrontal = proyectar(PIVOTE, frontal(), VISTA.ancho, VISTA.alto);
      desvioX = anclaFrontal.x - anclaAhora.x;
      desvioY = anclaFrontal.y - anclaAhora.y;
      contexto.translate(desvioX, desvioY);
      // La cara del corte mira a la cámara mientras el coseno de los dos giros sea positivo.
      const corteVisible = Math.cos(c.guinada) * Math.cos(c.cabeceo) >= 0;
      const z = Z_CORTE;
      /** La z de la cara delantera de cada compartimento exterior (el cerebro va en `z`). */
      const zDe = new Map<string, number>();
      const zRegion = (r: { clave: string; exterior?: boolean }) => (r.exterior ? zDe.get(r.clave) ?? z : z);
      /** Paredes de un sólido extruido: un cuadrilátero por segmento del contorno, de lejos a cerca, sombreado por la profundidad. */
      const pintarParedes = (trazos: Trazo[], grosor: number, color: (luz: number) => string) => {
        const paredes = trazos.flatMap((t) => t.puntos.slice(1).map((b, i) => {
          const a = t.puntos[i]!;
          const pts = [{ ...a, z: -grosor }, { ...b, z: -grosor }, { ...b, z: grosor }, { ...a, z: grosor }].map((p) => proyectar(p, c, VISTA.ancho, VISTA.alto));
          return { pts, profundidad: pts.reduce((s, p) => s + p.profundidad, 0) / 4 };
        })).sort((a, b) => b.profundidad - a.profundidad);
        for (const { pts, profundidad } of paredes) {
          contexto.beginPath();
          pts.forEach((p, i) => i ? contexto.lineTo(p.x, p.y) : contexto.moveTo(p.x, p.y));
          contexto.closePath();
          contexto.fillStyle = color(acotar01(0.5 + (c.distancia - profundidad) / 480));
          contexto.fill();
        }
      };
      // Los sólidos de lejos a cerca (por la profundidad de su centro).
      const ordenSolidos = solidos.map((s) => ({ s, profundidad: proyectar({ x: s.centro[0] - VISTA.ancho / 2, y: s.centro[1] - VISTA.alto / 2, z: 0 }, c, VISTA.ancho, VISTA.alto).profundidad })).sort((a, b) => b.profundidad - a.profundidad);
      let silueta = new Path2D();
      for (const { s } of ordenSolidos) {
        if (s.clave === 'cerebro') {
          silueta = camino(s.contorno, z, c);
          if (corteVisible) {
            // La superficie queda detrás: solo asoma por los lados del corte.
            pintarSuperficie(c);
            contexto.fillStyle = CEREBRO_BASE.campos[0]!.fill; contexto.fill(silueta, 'evenodd');
            contexto.save();
            contexto.clip(silueta, 'evenodd');
            for (const campo of campos) { contexto.fillStyle = campo.fill; contexto.fill(camino(campo.trazos, z, c), 'evenodd'); }
            contexto.fillStyle = TINTA;
            for (const t of tinta) contexto.fill(camino(t, z, c), 'evenodd');
            contexto.restore();
          } else {
            // Se ve el hemisferio desde fuera: el corte solo hace de fondo del
            // canto, donde la malla no llega por quedarse sin celda entera.
            contexto.fillStyle = 'rgb(176, 152, 146)'; contexto.fill(silueta, 'evenodd');
            pintarSuperficie(c);
          }
        } else if (s.clave === 'retina') {
          // El globo ocular como esfera, en el plano medio: el nervio detrás, la esfera sombreada, y dentro el corte.
          zDe.set(s.clave, 0);
          const q = proyectar({ x: GLOBO_OCULAR.centro[0] - VISTA.ancho / 2, y: GLOBO_OCULAR.centro[1] - VISTA.alto / 2, z: 0 }, c, VISTA.ancho, VISTA.alto);
          const R = GLOBO_OCULAR.radio * q.escala;
          for (const b of s.bases) if (b.papel === 'nervio') {
            const path = camino(b.trazos, 0, c);
            contexto.fillStyle = b.fill; contexto.fill(path, 'evenodd');
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
          const esfera = new Path2D();
          esfera.arc(q.x, q.y, R, 0, Math.PI * 2);
          const luz = contexto.createRadialGradient(q.x - 0.36 * R, q.y - 0.34 * R, R * 0.05, q.x - 0.1 * R, q.y - 0.08 * R, R * 1.15);
          luz.addColorStop(0, '#fbf8f2'); luz.addColorStop(0.62, '#efe7dc'); luz.addColorStop(1, '#a8978a');
          contexto.fillStyle = luz; contexto.fill(esfera);
          contexto.save();
          contexto.clip(esfera);
          for (const b of s.bases) if (b.papel !== 'nervio' && b.papel !== 'globo') {
            const path = camino(b.trazos, 0, c);
            contexto.fillStyle = b.fill; contexto.globalAlpha = b.papel === 'cornea' ? 0.75 : 1; contexto.fill(path, 'evenodd'); contexto.globalAlpha = 1;
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
          contexto.restore();
          // La córnea sobresale de la esfera: se repinta sin recorte, translúcida.
          for (const b of s.bases) if (b.papel === 'cornea') { contexto.fillStyle = b.fill; contexto.globalAlpha = 0.55; contexto.fill(camino(b.trazos, 0, c), 'evenodd'); contexto.globalAlpha = 1; }
          contexto.strokeStyle = '#8a6a5a'; contexto.lineWidth = 1; contexto.stroke(esfera);
          // El brillo, arriba a la izquierda.
          contexto.beginPath(); contexto.ellipse(q.x - 0.38 * R, q.y - 0.4 * R, 0.2 * R, 0.12 * R, 0, 0, Math.PI * 2);
          contexto.fillStyle = 'rgba(255, 255, 255, 0.6)'; contexto.fill();
        } else {
          const zc = (Math.cos(c.guinada) * Math.cos(c.cabeceo) >= 0 ? -1 : 1) * s.grosor;
          if (s.grosor > 0) pintarParedes(s.contorno, s.grosor, PARED[s.clave] ?? PARED.plasma!);
          zDe.set(s.clave, zc);
          for (const b of s.bases) {
            const path = camino(b.trazos, zc, c);
            contexto.fillStyle = b.fill; contexto.fill(path, 'evenodd');
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
        }
        const zFinos = s.clave === 'cerebro' ? z : zDe.get(s.clave) ?? 0;
        contexto.strokeStyle = 'rgba(238, 233, 255, 0.4)'; contexto.lineWidth = 0.9;
        for (const f of finosConSolido) if (f.solido === s.clave) contexto.stroke(camino(f.trazos, zFinos, c));
      }
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      zonas = [];
      for (const r of formas) {
        // Las regiones del corte solo se dibujan si el corte se ve; si la cámara
        // pasó al otro lado, la evidencia va en el tinte de la propia superficie.
        if (!r.exterior && !corteVisible) continue;
        const dato = porClave.get(r.clave);
        const t = intensidad(dato?.cohortes.length ?? 0, datos.current.atlas.cohortesMax);
        const path = camino(r.trazos, zRegion(r), c);
        const clip = RECORTADAS.has(r.clave) ? silueta : null;
        const vasos = r.capa === 'vasos';
        const conFoco = r.clave === focoRef.current;
        const relleno = rellenoRegion(t, { frio, calido, foco: conFoco });
        contexto.save();
        if (clip) contexto.clip(clip, 'evenodd');
        if (vasos) {
          contexto.lineWidth = conFoco ? 4 : 3;
          contexto.lineCap = 'round';
          if (dato?.conteo) {
            contexto.strokeStyle = relleno.color; contexto.globalAlpha = conFoco ? 1 : 0.75 + 0.25 * t;
          } else {
            contexto.strokeStyle = `rgba(83, 46, 31, ${dato?.cobertura === 'buscada_sin_hallazgo' ? 0.7 : 0.45})`;
            contexto.setLineDash(dato?.cobertura === 'buscada_sin_hallazgo' ? [6, 3] : [4, 4]);
          }
          contexto.stroke(path);
          contexto.setLineDash([]);
          contexto.globalAlpha = 1;
        } else if (dato?.conteo) {
          contexto.fillStyle = relleno.color; contexto.globalAlpha = relleno.opacidad;
          contexto.fill(path, 'evenodd');
          contexto.globalAlpha = 1;
          contexto.strokeStyle = conFoco ? TEXTO : BORDE; contexto.lineWidth = conFoco ? 1.4 : 0.9;
          contexto.stroke(path);
        } else {
          // Hueco: rayas en la tinta de la lámina, tenues si nadie lo buscó y marcadas con contorno si se buscó sin hallazgo.
          const buscada = dato?.cobertura === 'buscada_sin_hallazgo';
          if (rayas) { contexto.fillStyle = rayas; contexto.globalAlpha = buscada || conFoco ? 0.85 : 0.5; contexto.fill(path, 'evenodd'); contexto.globalAlpha = 1; }
          contexto.strokeStyle = buscada ? 'rgba(83, 46, 31, 0.72)' : 'rgba(83, 46, 31, 0.16)'; contexto.lineWidth = buscada ? 1.1 : 0.8;
          if (conFoco) { contexto.strokeStyle = TEXTO; contexto.lineWidth = 1.4; }
          contexto.stroke(path);
        }
        if (dato?.discordia.length) {
          contexto.strokeStyle = DISCORDIA; contexto.lineWidth = vasos ? 4.5 : 1.8; contexto.setLineDash([3, 3]); contexto.stroke(path); contexto.setLineDash([]);
        }
        if (r.clave === datos.current.seleccion) {
          contexto.strokeStyle = BORDE; contexto.lineWidth = vasos ? 7 : 4.5; contexto.stroke(path);
          contexto.strokeStyle = SELECCION; contexto.lineWidth = vasos ? 5 : 2.2; contexto.stroke(path);
        }
        contexto.restore();
        zonas.push({ clave: r.clave, path, clip, vasos });
      }
      // Las marcas: el punto de «buscada sin hallazgo» y el de discordia, donde dice puntoMarca() con el texto que se pinta.
      for (const r of formas) {
        if (!r.exterior && !corteVisible) continue;
        const dato = porClave.get(r.clave);
        if (!dato) continue;
        const buscada = dato.conteo === 0 && dato.cobertura === 'buscada_sin_hallazgo';
        const discordia = dato.discordia.length > 0;
        if (!buscada && !discordia) continue;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${dato.conteo ? ` · ${dato.conteo}` : ''}`;
        const p = punto(puntoMarca(r, texto), zRegion(r), c);
        contexto.beginPath(); contexto.arc(p.x, p.y, (discordia ? 4 : 3.2) / escala, 0, Math.PI * 2);
        contexto.fillStyle = discordia ? DISCORDIA : TINTA; contexto.fill();
        contexto.strokeStyle = '#ffffff'; contexto.lineWidth = 1 / escala; contexto.stroke();
      }
      // Una etiqueta enfocada evita tapar las estructuras pequeñas al girar.
      const clave = focoRef.current ?? datos.current.seleccion;
      const forma = formas.find((r) => r.clave === clave);
      if (forma) {
        const p = punto(forma.centro, zRegion(forma), c);
        contexto.beginPath(); contexto.arc(p.x, p.y, 5 / escala, 0, Math.PI * 2);
        contexto.fillStyle = '#fff1b8'; contexto.fill();
      }
      // Los nombres, con sus guías. Al girar, la perspectiva comprime el corte
      // y las etiquetas se montan unas sobre otras: se ordenan por interés (la
      // que se está mirando, y después las que tienen registros) y se descarta
      // la que chocaría con otra ya escrita. Si la cámara pasó al otro lado
      // solo se nombra lo que de verdad se ve: la superficie y lo de fuera.
      contexto.font = `${12 / escala}px sans-serif`;
      contexto.textAlign = 'center'; contexto.textBaseline = 'middle';
      const altoEtiqueta = 15 / escala;
      const puestas: { x: number; y: number; w: number; h: number }[] = [];
      const candidatas = formas
        .filter((r) => r.clave === clave || corteVisible || r.exterior || SUPERFICIALES.has(r.clave))
        .map((r) => ({ r, conteo: porClave.get(r.clave)?.conteo ?? 0 }))
        .sort((a, b) => (a.r.clave === clave ? -1 : b.r.clave === clave ? 1 : b.conteo - a.conteo));
      for (const { r, conteo } of candidatas) {
        if (rect.width < 760 && r.clave !== clave) continue;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${conteo ? ` · ${conteo}` : ''}`;
        const zr = zRegion(r);
        const p = punto([r.etiqueta[0], r.etiqueta[1] - 4], zr, c);
        const caja = { x: p.x, y: p.y, w: contexto.measureText(texto).width + 10 / escala, h: altoEtiqueta };
        if (r.clave !== clave && puestas.some((q) => Math.abs(q.x - caja.x) < (q.w + caja.w) / 2 && Math.abs(q.y - caja.y) < (q.h + caja.h) / 2)) continue;
        puestas.push(caja);
        if (r.guia) {
          const a = punto(r.centro, zr, c);
          const b = punto(finGuia(r, texto), zr, c);
          contexto.beginPath(); contexto.moveTo(a.x, a.y); contexto.lineTo(b.x, b.y);
          contexto.strokeStyle = 'rgba(238, 233, 255, 0.34)'; contexto.lineWidth = 0.8; contexto.stroke();
        }
        contexto.strokeStyle = FONDO; contexto.lineWidth = 3 / escala;
        contexto.strokeText(texto, p.x, p.y); contexto.fillStyle = conteo ? TEXTO : 'rgba(244, 239, 228, 0.78)'; contexto.fillText(texto, p.x, p.y);
      }
    };
    const pedir = () => { if (!frame) frame = requestAnimationFrame(pintar); };
    redibujar.current = pedir;
    // La entrada: de frente, como el 2D, y un giro suave hasta el reposo; nada con movimiento reducido.
    detener.current = () => { if (animacion) { cancelAnimationFrame(animacion); animacion = 0; } };
    if (!reducidoRef.current) {
      camara.current = frontal();
      let t0 = 0;
      const paso = (ahora: number) => {
        if (!t0) t0 = ahora;
        const k = Math.min(1, (ahora - t0) / DURACION_ENTRADA);
        camara.current = entre(frontal(), inicial(), suavizar(k));
        pintar();
        animacion = k < 1 ? requestAnimationFrame(paso) : 0;
      };
      animacion = requestAnimationFrame(paso);
    }
    detectar.current = (x, y) => {
      const pxl = (x - ox) / escala - desvioX, pyl = (y - oy) / escala - desvioY;
      contexto.save(); contexto.resetTransform();
      const zona = [...zonas].reverse().find((r) => {
        if (r.clip && !contexto.isPointInPath(r.clip, pxl, pyl, 'evenodd')) return false;
        contexto.lineWidth = 10;
        return r.vasos ? contexto.isPointInStroke(r.path, pxl, pyl) : contexto.isPointInPath(r.path, pxl, pyl, 'evenodd');
      });
      contexto.restore();
      if (zona) return zona.clave;
      // Sobre la superficie del hemisferio: la celda pintada cuyo centro queda
      // más cerca, dentro de su propio tamaño en pantalla.
      const tope = PASO_MALLA * Math.min(ESCALA_MAXIMA, FOCAL / Math.max(1, camara.current.distancia)) * 1.1;
      let mejor = -1;
      let dist = tope * tope;
      for (let i = 0; i < nVisibles; i++) {
        const cel = orden[i]!;
        const dx = hitX[cel]! - pxl, dy = hitY[cel]! - pyl;
        const d2 = dx * dx + dy * dy;
        if (d2 < dist) { dist = d2; mejor = cel; }
      }
      if (mejor < 0) return null;
      const ri = relieve.region[mejor]!;
      return ri >= 0 ? relieve.regiones[ri]! : null;
    };
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      detener.current();
      camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015) });
      pedir();
    };
    lienzo.addEventListener('wheel', rueda, { passive: false });
    const observador = new ResizeObserver(pedir);
    observador.observe(lienzo); pedir();
    return () => {
      cancelAnimationFrame(frame); detener.current(); observador.disconnect(); lienzo.removeEventListener('wheel', rueda);
      redibujar.current = () => {}; detener.current = () => {}; detectar.current = () => null;
    };
  }, []);

  useEffect(() => { redibujar.current(); }, [atlas, seleccion]);
  const cambiarFoco = (clave: string | null) => {
    if (focoRef.current !== clave) { focoRef.current = clave; setFoco(clave); redibujar.current(); }
  };
  const zoom = (factor: number) => {
    detener.current();
    camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * factor }); redibujar.current();
  };
  const restablecer = () => { detener.current(); camara.current = inicial(); redibujar.current(); };
  const apuntada: RegionAtlas | undefined = atlas.regiones.find((r) => r.clave === (foco ?? seleccion));
  return (
    <section className="atlas-3d" aria-label={tr("Atlas en tres dimensiones")}>
      <div className="atlas-lienzo atlas-3d-lienzo">
        <div className="atlas-3d-herramientas">
          <button type="button" className="btn btn-s" onClick={restablecer}>{tr("Restablecer vista")}</button>
          <button type="button" className="btn btn-s" aria-label={tr("Acercar atlas")} onClick={() => zoom(0.85)}>+</button>
          <button type="button" className="btn btn-s" aria-label={tr("Alejar atlas")} onClick={() => zoom(1.18)}>−</button>
          <label>{tr("Región")} <select aria-label={tr("Seleccionar región del atlas 3D")} value={seleccion ?? ''} onChange={(e) => { if (e.target.value) seleccionar(e.target.value); }}>
            <option value="">{tr("Explorar regiones")}</option>
            {atlas.regiones.filter((r) => regiones.some((g) => g.clave === r.clave)).map((r) => <option key={r.clave} value={r.clave}>{r.etiqueta} · {r.conteo}</option>)}
          </select></label>
        </div>
        {fallo ? <p role="status" className="atlas-3d-sin-lienzo">{tr("Este navegador no permite dibujar el relieve. Puedes consultar toda la evidencia en «Vista 2D».")}</p> : <canvas
          ref={canvas} className="atlas-3d-canvas" tabIndex={0} role="img"
          aria-label={tr("Relieve del atlas sobre la lámina anatómica: flechas para girar, + y - para acercar o alejar, Inicio para restablecer. Usa el selector Región para consultar evidencia con el teclado.")}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) return;
            e.preventDefault();
            detener.current();
            const c = camara.current;
            if (e.key === 'Home') camara.current = inicial();
            else if (e.key === '+' || e.key === '=') zoom(0.85);
            else if (e.key === '-') zoom(1.18);
            else camara.current = acotarCamara({ ...c, guinada: c.guinada + (e.key === 'ArrowLeft' ? -0.12 : e.key === 'ArrowRight' ? 0.12 : 0), cabeceo: c.cabeceo + (e.key === 'ArrowUp' ? -0.12 : e.key === 'ArrowDown' ? 0.12 : 0) });
            redibujar.current();
          }}
          onPointerDown={(e) => { if (e.button !== 0 || arrastre.current) return; detener.current(); arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY, movido: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (a && a.id === e.pointerId) {
              const dx = e.clientX - a.x, dy = e.clientY - a.y;
              if (!a.movido && Math.hypot(dx, dy) < 4) return;
              a.movido = true; a.x = e.clientX; a.y = e.clientY;
              camara.current = acotarCamara({ ...camara.current, guinada: camara.current.guinada + dx * SENSIBILIDAD_GIRO, cabeceo: camara.current.cabeceo - dy * SENSIBILIDAD_GIRO });
              cambiarFoco(null); redibujar.current();
            } else if (!a) {
              const rect = e.currentTarget.getBoundingClientRect();
              cambiarFoco(detectar.current(e.clientX - rect.left, e.clientY - rect.top));
            }
          }}
          onPointerUp={(e) => {
            const a = arrastre.current;
            if (!a || a.id !== e.pointerId) return;
            if (!a.movido) { const rect = e.currentTarget.getBoundingClientRect(); const clave = detectar.current(e.clientX - rect.left, e.clientY - rect.top); if (clave) datos.current.seleccionar(clave); }
            arrastre.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => { arrastre.current = null; cambiarFoco(null); }}
          onLostPointerCapture={() => { arrastre.current = null; }}
          onPointerLeave={() => cambiarFoco(null)}
        />}
      </div>
      <p className="meta">{tr("El hemisferio del corte sagital en relieve, con el volumen y los pliegues idealizados: el mapa anatómico es el del corte, no la superficie. Arrastra para girar, usa la rueda para acercar y pulsa una región para leer su evidencia.")}</p>
      <p className="atlas-3d-lectura" aria-live="polite">{apuntada ? (apuntada.discordia.length ? trp("{etiqueta}: {conteo} registros · {cohortes} cohortes nombradas por sus hipótesis · Discordia entre hechos{v}", { etiqueta: apuntada.etiqueta, conteo: apuntada.conteo, cohortes: apuntada.cohortes.length, v: !apuntada.conteo ? apuntada.cobertura === 'buscada_sin_hallazgo' ? tr(' · Buscada sin hallazgo') : tr(' · No buscada') : '' }) : trp("{etiqueta}: {conteo} registros · {cohortes} cohortes nombradas por sus hipótesis{v}", { etiqueta: apuntada.etiqueta, conteo: apuntada.conteo, cohortes: apuntada.cohortes.length, v: !apuntada.conteo ? apuntada.cobertura === 'buscada_sin_hallazgo' ? tr(' · Buscada sin hallazgo') : tr(' · No buscada') : '' })) : tr('Selecciona una región para ver sus cifras y abrir su ficha.')}</p>
    </section>
  );
}
