// La geometría del atlas: hay una figura por cada región del vocabulario del
// backend (rosa/mapa_enfermedad.py REGIONES, leído del fichero de Python, y
// REGIONES_CLAVES de lib/atlas.ts), los trazados son SVG válido, cerrados y
// dentro del lienzo, el centro de cada región cae dentro de su figura, las
// guías no atraviesan otra estructura pequeña ni se cruzan entre sí, las
// etiquetas no se pisan (26 px en vertical o 120 px en horizontal), las
// exportaciones que usa la pantalla existen, la anatomía cumple las notas de
// los jueces (huevo de 200 px, ventrículo de 16 px, coma del hipocampo tocando
// la amígdala, cuarto ventrículo, cerebelo en su sitio, tronco que se
// estrecha), la rampa de color de atlas.css contrasta al menos 3:1 desde el
// primer registro, y todo el texto lleva tildes.
//
// Cómo se mide la geometría: los trazados (M, L, C, A, Z) se aplanan a
// polígonos (las Bézier y los arcos en 24 tramos) y se decide "dentro" con la
// regla par-impar, la misma fill-rule evenodd que usa la pantalla; los cuatro
// lóbulos se ciñen además al recorte del hemisferio, como hace el clipPath.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { intensidad, REGIONES_CLAVES } from './atlas';
import { CLAVES_REGION_DIBUJO, CONTORNO_CEREBRO, finGuia, medioTexto, NOMBRE_CORTO, puntoMarca, RECORTADAS, RECORTE_HEMISFERIO, regionDibujo, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA } from './atlas_dibujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CSS_ATLAS = readFileSync(resolve(AQUI, '../atlas.css'), 'utf8');

/** Las claves de REGIONES en rosa/mapa_enfermedad.py, en su orden. */
function clavesDelBackend(): string[] {
  const fuente = readFileSync(resolve(AQUI, '../../../rosa/mapa_enfermedad.py'), 'utf8');
  const inicio = fuente.indexOf('REGIONES: tuple');
  const fin = fuente.indexOf('_REGIONES_GENERICAS', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  const bloque = fuente.slice(inicio, fin);
  return [...bloque.matchAll(/^\s*\("([a-z_]+)", "/gm)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// Trazados: gramática, aplanado y "dentro"
// ---------------------------------------------------------------------------

type Punto = [number, number];

/** Cuántos números toma cada orden (M y L pueden repetir parejas; C tríos de parejas; A grupos de siete). */
const ARIDAD: Record<string, number> = { M: 2, L: 2, C: 6, A: 7, Z: 0 };

/** Recorre un trazado comprobando la gramática y devolviendo, por orden, sus
 *  grupos de números; lanza si hay una orden desconocida, un número fuera de
 *  sitio o un grupo incompleto ("M 1 2 3 Z" no es válido). */
function ordenes(d: string): { orden: string; numeros: number[] }[] {
  const fichas = d.replace(/,/g, ' ').trim().split(/\s+/);
  const salida: { orden: string; numeros: number[] }[] = [];
  let orden = '';
  let actual: number[] = [];
  const cerrar = () => {
    if (orden === '') return;
    const n = ARIDAD[orden]!;
    if (n === 0 ? actual.length !== 0 : actual.length === 0 || actual.length % n !== 0) throw new Error(`grupo incompleto tras ${orden} en: ${d.slice(0, 60)}`);
    salida.push({ orden, numeros: actual });
    actual = [];
  };
  for (const f of fichas) {
    if (/^[MLCAZ]$/.test(f)) {
      cerrar();
      orden = f;
    } else if (/^-?\d+(?:\.\d+)?$/.test(f)) {
      if (orden === '' || orden === 'Z') throw new Error(`número fuera de sitio (${f}) en: ${d.slice(0, 60)}`);
      actual.push(Number(f));
    } else {
      throw new Error(`ficha desconocida (${f}) en: ${d.slice(0, 60)}`);
    }
  }
  cerrar();
  if (salida[0]?.orden !== 'M') throw new Error(`el trazado no empieza por M: ${d.slice(0, 60)}`);
  return salida;
}

function bezier(p0: Punto, p1: Punto, p2: Punto, p3: Punto, n = 24): Punto[] {
  const salida: Punto[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    salida.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return salida;
}

/** Arco SVG circular (rx = ry, sin giro), según el apéndice de conversión de la especificación. */
function arco(p0: Punto, radio: number, grande: number, sentido: number, p1: Punto, n = 24): Punto[] {
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  let r = radio;
  const lambda = (dx * dx + dy * dy) / (r * r);
  if (lambda > 1) r *= Math.sqrt(lambda);
  const signo = grande === sentido ? -1 : 1;
  const raiz = Math.sqrt(Math.max(0, (r * r - dx * dx - dy * dy) / (dx * dx + dy * dy)));
  const cx = signo * raiz * dy + (p0[0] + p1[0]) / 2;
  const cy = signo * raiz * -dx + (p0[1] + p1[1]) / 2;
  const angulo = (ux: number, uy: number, vx: number, vy: number) => {
    let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const inicio = angulo(1, 0, (p0[0] - cx) / r, (p0[1] - cy) / r);
  let barrido = angulo((p0[0] - cx) / r, (p0[1] - cy) / r, (p1[0] - cx) / r, (p1[1] - cy) / r);
  if (!sentido && barrido > 0) barrido -= 2 * Math.PI;
  if (sentido && barrido < 0) barrido += 2 * Math.PI;
  const salida: Punto[] = [];
  for (let i = 1; i <= n; i++) {
    const a = inicio + (barrido * i) / n;
    salida.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return salida;
}

/** Los subtrazados de un `d` como polígonos (o polilíneas, si no cierran), si cada uno cierra con Z, y todas sus coordenadas. */
function aplanar(d: string): { poligonos: Punto[][]; cerrados: boolean[]; coordenadas: Punto[] } {
  const poligonos: Punto[][] = [];
  const cerrados: boolean[] = [];
  const coordenadas: Punto[] = [];
  let actual: Punto[] = [];
  let pos: Punto = [0, 0];
  const abrir = () => {
    if (actual.length) {
      poligonos.push(actual);
      cerrados.push(false);
    }
    actual = [];
  };
  for (const { orden, numeros } of ordenes(d)) {
    if (orden === 'Z') {
      if (actual.length) {
        poligonos.push(actual);
        cerrados.push(true);
      }
      actual = [];
      continue;
    }
    for (let i = 0; i < numeros.length; i += ARIDAD[orden]!) {
      if (orden === 'M' || orden === 'L') {
        if (orden === 'M') abrir();
        pos = [numeros[i]!, numeros[i + 1]!];
        actual.push(pos);
        coordenadas.push(pos);
      } else if (orden === 'C') {
        const c1: Punto = [numeros[i]!, numeros[i + 1]!];
        const c2: Punto = [numeros[i + 2]!, numeros[i + 3]!];
        const fin: Punto = [numeros[i + 4]!, numeros[i + 5]!];
        actual.push(...bezier(pos, c1, c2, fin));
        coordenadas.push(c1, c2, fin);
        pos = fin;
      } else {
        // A rx ry giro grande sentido x y: los radios y las banderas no son coordenadas.
        const fin: Punto = [numeros[i + 5]!, numeros[i + 6]!];
        expect(numeros[i], `radio del arco en ${d.slice(0, 60)}`).toBeGreaterThan(0);
        expect(numeros[i]).toBe(numeros[i + 1]);
        actual.push(...arco(pos, numeros[i]!, numeros[i + 3]!, numeros[i + 4]!, fin));
        coordenadas.push(fin);
        pos = fin;
      }
    }
  }
  abrir();
  return { poligonos, cerrados, coordenadas };
}

function dentroPoligono(p: Punto, poligono: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]!;
    const [xj, yj] = poligono[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Regla par-impar sobre todos los subtrazados: la fill-rule evenodd de la pantalla. */
function dentroFigura(p: Punto, figura: Punto[][]): boolean {
  let n = 0;
  for (const poligono of figura) if (dentroPoligono(p, poligono)) n++;
  return n % 2 === 1;
}

function distanciaSegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distanciaPolilineas(p: Punto, polilineas: Punto[][]): number {
  let minima = Infinity;
  for (const linea of polilineas) for (let i = 1; i < linea.length; i++) minima = Math.min(minima, distanciaSegmento(p, linea[i - 1]!, linea[i]!));
  return minima;
}

/** Distancia mínima entre los bordes de dos figuras (muestreando sus vértices aplanados). */
function distanciaFiguras(a: Punto[][], b: Punto[][]): number {
  let minima = Infinity;
  for (const poligono of a) for (const p of poligono) minima = Math.min(minima, distanciaPolilineas(p, b.map((q) => [...q, q[0]!])));
  return minima;
}

const RECORTE = aplanar(RECORTE_HEMISFERIO).poligonos;
const FIGURAS = new Map(REGIONES_DIBUJO.map((r) => [r.clave, aplanar(r.d).poligonos] as const));

/** Si el punto cae en la figura de esa clave, con el recorte del hemisferio para los lóbulos. */
function enRegion(clave: string, p: Punto): boolean {
  if (!dentroFigura(p, FIGURAS.get(clave)!)) return false;
  return RECORTADAS.has(clave) ? dentroFigura(p, RECORTE) : true;
}

/** Qué región se ve en un punto: la última dibujada que lo contiene (los vasos son trazo, no cuentan). */
function visibleEn(p: Punto): string | null {
  for (let i = REGIONES_DIBUJO.length - 1; i >= 0; i--) {
    const r = REGIONES_DIBUJO[i]!;
    if (r.capa === 'vasos') continue;
    if (enRegion(r.clave, p)) return r.clave;
  }
  return null;
}

/** Caja de una figura: [x0, y0, x1, y1] sobre sus vértices aplanados. */
function cajaFigura(clave: string): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poligono of FIGURAS.get(clave)!) {
    for (const [x, y] of poligono) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

/** Tramos verticales de una figura en la abscisa x: pares [y0, y1] donde (x, y) está dentro, muestreando cada unidad. */
function tramosVerticales(clave: string, x: number, desde = 0, hasta: number = VISTA.alto): [number, number][] {
  const tramos: [number, number][] = [];
  let inicio: number | null = null;
  for (let y = desde; y <= hasta; y++) {
    const dentro = enRegion(clave, [x, y]);
    if (dentro && inicio === null) inicio = y;
    if (!dentro && inicio !== null) {
      tramos.push([inicio, y - 1]);
      inicio = null;
    }
  }
  if (inicio !== null) tramos.push([inicio, hasta]);
  return tramos;
}

/** Anchura de una figura a la altura y: distancia entre su primer y último punto dentro, muestreando cada unidad. */
function anchuraEn(clave: string, y: number): number {
  let primero: number | null = null;
  let ultimo: number | null = null;
  for (let x = 0; x <= VISTA.ancho; x++) {
    if (!enRegion(clave, [x, y])) continue;
    if (primero === null) primero = x;
    ultimo = x;
  }
  return primero === null || ultimo === null ? 0 : ultimo - primero;
}

/** Caja aproximada de una etiqueta (13 px de cuerpo, unos 6,8 px por letra),
 *  centrada en su punto de anclaje; una etiqueta girada casi en vertical
 *  ocupa su anchura a lo largo de y, a ambos lados del anclaje. */
function cajaEtiqueta(clave: string, etiqueta: [number, number], giro: number | undefined) {
  const ancho = (NOMBRE_CORTO[clave] ?? clave).length * 6.8;
  const alto = 14;
  const [x, y] = etiqueta;
  const vertical = giro !== undefined && Math.abs(Math.abs(giro) - 90) < 20;
  if (vertical) return { x0: x - alto / 2, x1: x + alto / 2, y0: y - ancho / 2, y1: y + ancho / 2 };
  return { x0: x - ancho / 2, x1: x + ancho / 2, y0: y - alto + 3, y1: y + 3 };
}

/** Estructuras pequeñas: una guía de etiqueta no debe atravesarlas (las capas
 *  de fondo, los lóbulos, el tronco y el cerebelo no cuentan: una guía que
 *  sale de una estructura enterrada en el temporal tiene que cruzarlo). */
const PEQUENAS = new Set(['hipocampo', 'corteza_entorrinal', 'amigdala', 'cingulo_precuneo', 'ganglios_basales_talamo', 'lcr', 'sustancia_blanca', 'bulbo_olfatorio', 'retina', 'plasma', 'intestino_microbiota']);

/** Regiones cuya etiqueta va escrita SOBRE su propia figura (sin guía). */
const ETIQUETA_DENTRO = ['corteza_prefrontal', 'corteza_parietal', 'corteza_temporal', 'cerebelo', 'sustancia_blanca', 'cingulo_precuneo', 'ganglios_basales_talamo', 'lcr'];

// ---------------------------------------------------------------------------
// Color: la rampa de atlas.css recalculada en oklab (la conversión del CSS Color 4)
// ---------------------------------------------------------------------------

type RGB = [number, number, number];
const hexARgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const aLineal = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lineal = (hex: string): RGB => [aLineal(hexARgb(hex)[0]), aLineal(hexARgb(hex)[1]), aLineal(hexARgb(hex)[2])];
function linealAOklab([r, g, b]: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabALineal([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const acotar = (v: number) => Math.max(0, Math.min(1, v));
  return [acotar(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), acotar(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), acotar(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
const mezclar = (a: RGB, p: number, b: RGB): RGB => [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)];
const luminancia = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contraste = (a: RGB, b: RGB): number => (Math.max(luminancia(a), luminancia(b)) + 0.05) / (Math.min(luminancia(a), luminancia(b)) + 0.05);

/** Un token de :root en atlas.css tal como está escrito (su valor crudo). */
function tokenAtlas(nombre: string): string {
  const m = CSS_ATLAS.match(new RegExp(`${nombre}:\\s*([^;]+);`));
  if (!m) throw new Error(`no encuentro ${nombre} en atlas.css`);
  return m[1]!.trim();
}

/** De luz lineal a sRGB (codificación gamma) y vuelta, por canal en 0..1. */
const aSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const deSrgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** El contraste con el lienzo de una región de intensidad t, con la fórmula de
 *  atlas.css, tal como lo compone el navegador: el color-mix va en oklab, pero
 *  la fill-opacity se compone sobre el lienzo en sRGB, NO en luz lineal
 *  (medido en Chromium con un canvas por el constructor de ajustes: a t = 0
 *  con el suelo 0,7 la mezcla lineal daba 3,12:1 y el píxel real 2,53:1). La
 *  luminancia para el contraste sí se calcula en lineal, como manda WCAG. */
function contrasteRampa(t: number): number {
  const frio = linealAOklab(lineal(tokenAtlas('--atlas-frio')));
  const calido = linealAOklab(lineal(tokenAtlas('--atlas-calido')));
  const fondo = lineal(tokenAtlas('--atlas-lienzo'));
  const opacidad = CSS_ATLAS.match(/fill-opacity:\s*calc\(([\d.]+) \+ ([\d.]+) \* var\(--atlas-t, 0\)\)/);
  if (!opacidad) throw new Error('la fórmula de la opacidad en atlas.css cambió: actualizar este test');
  // Atlas.tsx pasa --atlas-p como Math.round(t * 100) % y --atlas-t con tres decimales.
  const p = Math.round(t * 100) / 100;
  const fill = oklabALineal(mezclar(calido, p, frio));
  const op = Number(opacidad[1]) + Number(opacidad[2]) * Number(t.toFixed(3));
  const fillS = fill.map(aSrgb) as RGB;
  const fondoS = fondo.map(aSrgb) as RGB;
  const efectivo = mezclar(fillS, op, fondoS).map(deSrgb) as RGB;
  return contraste(efectivo, fondo);
}

// ---------------------------------------------------------------------------

describe('la geometría del atlas', () => {
  it('tiene exactamente una figura por región del backend, en el mismo orden que el vocabulario', () => {
    const backend = clavesDelBackend();
    expect(backend.length).toBe(20);
    expect([...CLAVES_REGION_DIBUJO]).toEqual(backend);
    expect(REGIONES_CLAVES).toEqual(backend);
    const dibujadas = REGIONES_DIBUJO.map((r) => r.clave);
    expect([...dibujadas].sort()).toEqual([...backend].sort());
    expect(new Set(dibujadas).size).toBe(dibujadas.length);
    for (const clave of backend) expect(regionDibujo(clave)?.clave).toBe(clave);
    expect(regionDibujo('pancreas')).toBeUndefined();
  });

  it('cada trazado es SVG válido, cerrado (salvo los vasos, que son trazo) y con todas sus coordenadas dentro del lienzo', () => {
    expect(VISTA).toEqual({ ancho: 1000, alto: 620 });
    // La gramática rechaza lo que una expresión regular laxa aceptaría.
    expect(() => ordenes('M 1 2 3 Z')).toThrow();
    expect(() => ordenes('M 1 2 A 5 5 0 0 1 Z')).toThrow();
    expect(() => ordenes('L 1 2')).toThrow();
    expect(() => ordenes('M 1 2 Q 3 4 5 6')).toThrow();
    for (const r of REGIONES_DIBUJO) {
      const { poligonos, cerrados, coordenadas } = aplanar(r.d);
      expect(poligonos.length, r.clave).toBeGreaterThan(0);
      expect(coordenadas.length, r.clave).toBeGreaterThan(2);
      if (r.capa === 'vasos') {
        for (const c of cerrados) expect(c, 'los vasos son polilíneas abiertas').toBe(false);
      } else {
        for (const c of cerrados) expect(c, `${r.clave}: un subtrazado no cierra con Z`).toBe(true);
        for (const poligono of poligonos) expect(poligono.length, `${r.clave}: subtrazado degenerado`).toBeGreaterThan(8);
      }
      // Nada se sale del lienzo: ni siquiera los puntos de control de las curvas.
      for (const [x, y] of coordenadas) {
        expect(x, `${r.clave} x`).toBeGreaterThanOrEqual(0);
        expect(x, `${r.clave} x`).toBeLessThanOrEqual(VISTA.ancho);
        expect(y, `${r.clave} y`).toBeGreaterThanOrEqual(0);
        expect(y, `${r.clave} y`).toBeLessThanOrEqual(VISTA.alto);
      }
      for (const [x, y] of [r.centro, r.etiqueta]) {
        expect(x, r.clave).toBeGreaterThan(0);
        expect(x, r.clave).toBeLessThan(VISTA.ancho);
        expect(y, r.clave).toBeGreaterThan(0);
        expect(y, r.clave).toBeLessThan(VISTA.alto);
      }
      if (r.capa !== undefined) expect(['fondo', 'region', 'vasos']).toContain(r.capa);
    }
    const contorno = aplanar(CONTORNO_CEREBRO);
    expect(contorno.poligonos.length).toBe(1);
    expect(contorno.cerrados).toEqual([true]);
    expect(aplanar(RECORTE_HEMISFERIO).poligonos.length).toBe(1);
    for (const t of TRAZOS_FINOS) expect(() => ordenes(t.d)).not.toThrow();
  });

  it('conserva las exportaciones que usa la pantalla, con su semántica', () => {
    // El recorte de los lóbulos es la silueta: los cuatro lóbulos caben enteros dentro.
    expect([...RECORTADAS].sort()).toEqual(['corteza_occipital', 'corteza_parietal', 'corteza_prefrontal', 'corteza_temporal']);
    for (const clave of RECORTADAS) {
      expect(CLAVES_REGION_DIBUJO).toContain(clave);
      // Dentro del recorte, o a menos de 2,5 px de su borde (las dos curvas se convirtieron a Bézier por separado; el clipPath se come ese resto).
      for (const poligono of FIGURAS.get(clave)!) for (const p of poligono) expect(dentroFigura(p, RECORTE) || distanciaPolilineas(p, RECORTE.map((q) => [...q, q[0]!])) <= 2.5, `${clave} asoma fuera del recorte en ${p.map(Math.round).join(', ')}`).toBe(true);
    }
    // El contorno es la silueta completa: contiene el cerebelo, el tronco y todos los lóbulos.
    const contorno = aplanar(CONTORNO_CEREBRO).poligonos;
    for (const clave of ['cerebelo', 'tronco_locus_coeruleus', 'corteza_prefrontal', 'corteza_occipital', 'hipocampo', 'bulbo_olfatorio']) {
      expect(dentroFigura(regionDibujo(clave)!.centro, contorno), `${clave} fuera del contorno`).toBe(true);
    }
    // Trazos finos: el ojo (globo y cristalino) con su nervio y el brillo de la gota; ninguno recortado.
    expect(TRAZOS_FINOS.length).toBeGreaterThanOrEqual(4);
    for (const t of TRAZOS_FINOS) {
      expect(typeof t.d).toBe('string');
      if (t.recortado !== undefined) expect(typeof t.recortado).toBe('boolean');
    }
    expect(typeof finGuia).toBe('function');
    expect(typeof regionDibujo).toBe('function');
    for (const clave of CLAVES_REGION_DIBUJO) expect(NOMBRE_CORTO[clave], clave).toBeTruthy();
    // finGuia acaba en el borde del texto más cercano al centro, nunca encima de las letras.
    const arriba = finGuia({ clave: 'hipocampo', d: '', centro: [500, 400], etiqueta: [500, 470] });
    expect(arriba).toEqual([500, 457]);
    const lado = finGuia({ clave: 'retina', d: '', centro: [700, 300], etiqueta: [900, 302] });
    expect(lado[0]).toBeLessThan(900);
    expect(lado[1]).toBe(298);
  });

  it('los compartimentos que no son región anatómica van fuera del cerebro, los vasos como trazo y las genéricas como capas de fondo', () => {
    expect(regionDibujo('plasma')?.exterior).toBe(true);
    expect(regionDibujo('intestino_microbiota')?.exterior).toBe(true);
    expect(regionDibujo('retina')?.exterior).toBe(true);
    expect(regionDibujo('lcr')?.exterior).toBeFalsy();
    expect(regionDibujo('vascular_bhe')?.capa).toBe('vasos');
    // Las dos genéricas existen (el vocabulario las exige) como silueta neutra, sin iluminarse.
    for (const clave of ['cerebro_sin_region', 'neocorteza']) {
      const r = regionDibujo(clave)!;
      expect(r.capa, clave).toBe('fondo');
      expect(r.exterior, clave).toBeFalsy();
    }
    // Las capas de fondo van las primeras, el manto debajo de la silueta: todo lo demás se dibuja encima.
    expect(REGIONES_DIBUJO[0]!.clave).toBe('neocorteza');
    expect(REGIONES_DIBUJO[1]!.clave).toBe('cerebro_sin_region');
    for (const r of REGIONES_DIBUJO.slice(2)) expect(r.capa, r.clave).not.toBe('fondo');
    // La silueta es el propio contorno; el manto cortical cabe en ella.
    expect(regionDibujo('cerebro_sin_region')!.d).toBe(CONTORNO_CEREBRO);
    const silueta = FIGURAS.get('cerebro_sin_region')!;
    for (const poligono of FIGURAS.get('neocorteza')!) for (const p of poligono) expect(dentroFigura(p, silueta), `el manto asoma en ${p.map(Math.round).join(', ')}`).toBe(true);
    // El ojo a la izquierda, la gota abajo a la izquierda y el intestino abajo a la derecha, sin tocar el cerebro.
    expect(regionDibujo('retina')!.centro[0]).toBeLessThan(200);
    expect(regionDibujo('plasma')!.centro[1]).toBeGreaterThan(420);
    expect(regionDibujo('intestino_microbiota')!.centro[0]).toBeGreaterThan(820);
    for (const clave of ['plasma', 'intestino_microbiota', 'retina']) {
      for (const poligono of FIGURAS.get(clave)!) for (const p of poligono) expect(dentroFigura(p, silueta), `${clave} toca el cerebro en ${p.map(Math.round).join(', ')}`).toBe(false);
    }
  });

  it('el centro de cada región cae dentro de su propia figura: de ahí sale la guía de la etiqueta', () => {
    const fuera: string[] = [];
    for (const r of REGIONES_DIBUJO) {
      const dentro = r.capa === 'vasos' ? distanciaPolilineas(r.centro, FIGURAS.get(r.clave)!) <= 1.5 : enRegion(r.clave, r.centro);
      if (!dentro) fuera.push(`${r.clave} (${r.centro.join(', ')}) cae en ${visibleEn(r.centro) ?? 'el vacío'}`);
    }
    expect(fuera).toEqual([]);
    // Y en las regiones que no son de fondo, el centro además se VE: ninguna otra figura lo tapa.
    for (const r of REGIONES_DIBUJO) {
      if (r.capa === 'fondo' || r.capa === 'vasos') continue;
      expect(visibleEn(r.centro), `${r.clave}: el centro lo tapa ${visibleEn(r.centro)}`).toBe(r.clave);
    }
  });

  it('las etiquetas escritas sobre su figura caen dentro de ella; las demás llevan guía y van fuera de todas las figuras', () => {
    for (const clave of ETIQUETA_DENTRO) {
      const r = regionDibujo(clave)!;
      expect(r.guia, `${clave} no necesita guía`).toBeFalsy();
      const c = cajaEtiqueta(clave, r.etiqueta, r.giro);
      const centroCaja: Punto = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];
      expect(visibleEn(r.etiqueta), `${clave}: la etiqueta ${r.etiqueta.join(', ')} cae en ${visibleEn(r.etiqueta) ?? 'el vacío'}`).toBe(clave);
      expect(visibleEn(centroCaja), `${clave}: el centro de la caja de la etiqueta cae en ${visibleEn(centroCaja) ?? 'el vacío'}`).toBe(clave);
    }
    for (const r of REGIONES_DIBUJO) {
      if (ETIQUETA_DENTRO.includes(r.clave)) continue;
      const donde = visibleEn(r.etiqueta);
      if (r.guia) {
        // Con guía, el texto va en el vacío (fuera del cerebro y de los compartimentos), no sobre otra región.
        expect(donde, `${r.clave}: la etiqueta con guía cae sobre ${donde}`).toBeNull();
        expect(distanciaFiguras([[r.etiqueta]], FIGURAS.get(r.clave)!), `${r.clave}: la etiqueta con guía está pegada a su figura`).toBeGreaterThan(10);
      } else {
        // Sin guía y fuera de su figura, solo cabe estar pegada debajo (tronco, gota, intestino) o encima (retina): en el vacío y a menos de 60 px.
        expect(donde, `${r.clave}: etiqueta sin guía sobre ${donde}`).toBeNull();
        expect(distanciaFiguras([[r.etiqueta]], FIGURAS.get(r.clave)!), `${r.clave}: etiqueta sin guía lejos de su figura`).toBeLessThan(60);
      }
    }
  });

  it('la marca de cada región (el punto de «buscada sin hallazgo» o el de discordia) se ve sobre su propia figura y no pisa su etiqueta, con y sin número', () => {
    // La pantalla pinta los dos puntos donde dice puntoMarca() con el texto que se escribe de verdad
    // (el nombre corto y, si hay registros, «· N»). Con la etiqueta fuera de la figura la marca es el
    // centro; con la etiqueta dentro va encima, debajo o al lado del texto (`marca`), y tiene que
    // seguir cayendo en su figura (visible, no tapada por otra) y fuera de la caja de su etiqueta.
    const RADIO = 4;
    for (const cifra of ['', ' · 99', ' · 106']) {
      for (const r of REGIONES_DIBUJO) {
        if (r.capa === 'fondo') continue;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${cifra}`;
        const m = puntoMarca(r, texto);
        if (r.capa === 'vasos') expect(distanciaPolilineas(m, FIGURAS.get(r.clave)!), `${r.clave}: la marca no está sobre el trazo`).toBeLessThanOrEqual(1.5);
        else expect(visibleEn(m), `${r.clave}${cifra}: la marca (${m.join(', ')}) cae en ${visibleEn(m) ?? 'el vacío'}`).toBe(r.clave);
        const medio = medioTexto(texto);
        const [x, y] = r.etiqueta;
        const pisa = m[0] + RADIO > x - medio && m[0] - RADIO < x + medio && m[1] + RADIO > y - 13 && m[1] - RADIO < y + 4;
        expect(pisa, `${r.clave}${cifra}: la marca (${m.join(', ')}) pisa la etiqueta «${texto}» en (${x}, ${y})`).toBe(false);
      }
    }
    // Las regiones con etiqueta interior declaran dónde va la marca; las demás no lo necesitan.
    for (const clave of ETIQUETA_DENTRO) expect(regionDibujo(clave)!.marca, `${clave} no declara marca`).toBeDefined();
    for (const r of REGIONES_DIBUJO) if (r.guia) expect(r.marca, `${r.clave} lleva guía y no necesita marca`).toBeUndefined();
  });

  it('ninguna guía atraviesa otra estructura pequeña, ni cruza a otra guía, ni cruza el frontal en abanico', () => {
    const guias = REGIONES_DIBUJO.filter((r) => r.guia).map((r) => ({ clave: r.clave, a: r.centro as Punto, b: finGuia(r) }));
    expect(guias.length).toBeGreaterThan(0);
    const cruces: string[] = [];
    const porElFrontal: string[] = [];
    for (const g of guias) {
      const cruzadas = new Set<string>();
      let frontal = false;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const quien = visibleEn([g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t]);
        if (quien && quien !== g.clave && PEQUENAS.has(quien)) cruzadas.add(quien);
        if (quien === 'corteza_prefrontal') frontal = true;
      }
      if (cruzadas.size) cruces.push(`la guía de ${g.clave} cruza ${[...cruzadas].join(' y ')}`);
      if (frontal) porElFrontal.push(g.clave);
    }
    expect(cruces).toEqual([]);
    // Las etiquetas de la sustancia blanca, el LCR y el tálamo van dentro de su figura: ninguna guía atraviesa ya el frontal.
    expect(porElFrontal).toEqual([]);
    // Dos guías que se cruzan confunden qué línea va a qué etiqueta.
    const seCruzan = (p: Punto, p2: Punto, q: Punto, q2: Punto): boolean => {
      const orient = (a: Punto, b: Punto, c: Punto) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      return orient(p, p2, q) * orient(p, p2, q2) < 0 && orient(q, q2, p) * orient(q, q2, p2) < 0;
    };
    for (let i = 0; i < guias.length; i++) for (let j = i + 1; j < guias.length; j++) expect(seCruzan(guias[i]!.a, guias[i]!.b, guias[j]!.a, guias[j]!.b), `las guías de ${guias[i]!.clave} y ${guias[j]!.clave} se cruzan`).toBe(false);
    // Ninguna guía pasa por encima del texto de otra etiqueta.
    for (const g of guias) {
      for (const r of REGIONES_DIBUJO) {
        if (r.clave === g.clave) continue;
        const c = cajaEtiqueta(r.clave, r.etiqueta, r.giro);
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const x = g.a[0] + (g.b[0] - g.a[0]) * t;
          const y = g.a[1] + (g.b[1] - g.a[1]) * t;
          expect(x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1, `la guía de ${g.clave} pasa sobre la etiqueta de ${r.clave}`).toBe(false);
        }
      }
    }
  });

  it('ninguna etiqueta pisa a otra: al menos 26 px en vertical o 120 px en horizontal entre anclajes, y las cajas no se solapan', () => {
    const cajas = REGIONES_DIBUJO.map((r) => ({ clave: r.clave, etiqueta: r.etiqueta, ...cajaEtiqueta(r.clave, r.etiqueta, r.giro) }));
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        const a = cajas[i]!;
        const b = cajas[j]!;
        const dx = Math.abs(a.etiqueta[0] - b.etiqueta[0]);
        const dy = Math.abs(a.etiqueta[1] - b.etiqueta[1]);
        expect(dy >= 26 || dx >= 120, `${a.clave} y ${b.clave} están a ${dx} px en horizontal y ${dy} px en vertical`).toBe(true);
        const solapan = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(solapan, `${a.clave} pisa a ${b.clave}`).toBe(false);
      }
    }
  });

  it('la anatomía sigue las notas de los jueces: huevo de 200 px, ventrículo de 16 px, coma del hipocampo, cuarto ventrículo, cerebelo y tronco', () => {
    // Tálamo y ganglios: un huevo de unos 200 px de ancho con el centro retrasado hacia x 530.
    const [tx0, ty0, tx1, ty1] = cajaFigura('ganglios_basales_talamo');
    expect(tx1 - tx0).toBeGreaterThanOrEqual(185);
    expect(tx1 - tx0).toBeLessThanOrEqual(215);
    expect((tx0 + tx1) / 2).toBeGreaterThan(515);
    expect((tx0 + tx1) / 2).toBeLessThan(545);
    expect((ty0 + ty1) / 2).toBeGreaterThan(270);
    expect((ty0 + ty1) / 2).toBeLessThan(315);
    // Delante del huevo (bajo la rodilla del cuerpo calloso) y debajo queda el hipotálamo: silueta neutra, ninguna región.
    expect(visibleEn([405, 300])).toBe('cerebro_sin_region');
    expect(visibleEn([470, 345])).toBe('cerebro_sin_region');
    // El ventrículo lateral es una banda de unos 16 px bajo el cuerpo calloso.
    for (const x of [480, 530, 580]) {
      const tramos = tramosVerticales('lcr', x, 150, 300);
      expect(tramos.length, `LCR en x = ${x}`).toBe(1);
      const grosor = tramos[0]![1] - tramos[0]![0] + 1;
      expect(grosor, `grosor del ventrículo en x = ${x}`).toBeGreaterThanOrEqual(13);
      expect(grosor, `grosor del ventrículo en x = ${x}`).toBeLessThanOrEqual(19);
      // Justo encima va el cuerpo calloso; debajo, el huevo (que es un óvalo: hacia los extremos se separa unos píxeles).
      expect(visibleEn([x, tramos[0]![0] - 6])).toBe('sustancia_blanca');
      expect(visibleEn([x, tramos[0]![1] + 12])).toBe('ganglios_basales_talamo');
    }
    // El cuarto ventrículo: LCR entre la protuberancia y el cerebelo, y el acueducto que baja hasta él.
    expect(visibleEn([658, 448])).toBe('lcr');
    expect(visibleEn([651, 400])).toBe('lcr');
    expect(visibleEn([640, 448])).toBe('tronco_locus_coeruleus');
    expect(visibleEn([690, 448])).toBe('cerebelo');
    // El hipocampo es una coma de unos 22 px que nace bajo la cola del tálamo (x 600) y toca la amígdala en x 450.
    const [hx0, , hx1] = cajaFigura('hipocampo');
    expect(hx0).toBeLessThan(455);
    expect(hx1).toBeGreaterThan(590);
    const cabeza = tramosVerticales('hipocampo', 470, 360, 440);
    expect(cabeza.length).toBe(1);
    expect(cabeza[0]![1] - cabeza[0]![0] + 1).toBeGreaterThanOrEqual(17);
    expect(cabeza[0]![1] - cabeza[0]![0] + 1).toBeLessThanOrEqual(24);
    expect(distanciaFiguras(FIGURAS.get('hipocampo')!, FIGURAS.get('amigdala')!)).toBeLessThan(6);
    // La corteza entorrinal es una banda bajo el hipocampo, en el borde inferior del temporal.
    const [ex0, ey0, ex1, ey1] = cajaFigura('corteza_entorrinal');
    const entorrinal = tramosVerticales('corteza_entorrinal', 470, 360, 460);
    expect(entorrinal.length).toBe(1);
    expect(entorrinal[0]![0]).toBeGreaterThan(cabeza[0]![1]);
    expect(ex1 - ex0).toBeGreaterThan(ey1 - ey0);
    expect(visibleEn([(ex0 + ex1) / 2, ey1 + 6])).toBeNull();
    // El cerebelo: centro en torno a (735, 442), techo aplanado bajo el occipital.
    const [cx0, cy0, cx1, cy1] = cajaFigura('cerebelo');
    expect((cx0 + cx1) / 2).toBeGreaterThan(715);
    expect((cx0 + cx1) / 2).toBeLessThan(755);
    expect((cy0 + cy1) / 2).toBeGreaterThan(425);
    expect((cy0 + cy1) / 2).toBeLessThan(460);
    // El tronco: unos 80 px arriba (medido por debajo de la cola del hipocampo, que le muerde el frente) y unos 45 px al final del bulbo.
    expect(anchuraEn('tronco_locus_coeruleus', 405)).toBeGreaterThanOrEqual(70);
    expect(anchuraEn('tronco_locus_coeruleus', 405)).toBeLessThanOrEqual(95);
    expect(anchuraEn('tronco_locus_coeruleus', 542)).toBeGreaterThanOrEqual(36);
    expect(anchuraEn('tronco_locus_coeruleus', 542)).toBeLessThanOrEqual(55);
    // Los vasos: cuatro polilíneas (pericallosa, callosomarginal, basilar y cerebral posterior), sin el lazo frontal ni la V parietal.
    const vasos = FIGURAS.get('vascular_bhe')!;
    expect(vasos.length).toBe(4);
    for (const linea of vasos) for (const [x] of linea) expect(x, 'un vaso llega al frontal').toBeGreaterThan(310);
    // La basilar corre por delante de la protuberancia: en y = 460 pasa a menos de 8 px del borde anterior del tronco.
    const borde = tramosVerticales('tronco_locus_coeruleus', 556, 400, 560);
    expect(borde.length).toBeGreaterThan(0);
    let basilar = Infinity;
    for (const linea of vasos) for (const p of linea) if (Math.abs(p[1] - 460) < 3) basilar = Math.min(basilar, Math.abs(p[0] - 552));
    expect(basilar).toBeLessThan(8);
  });

  it('todo el texto visible lleva tildes y no hay guiones largos', () => {
    for (const clave of CLAVES_REGION_DIBUJO) expect(NOMBRE_CORTO[clave], clave).toBeTruthy();
    const textos = Object.values(NOMBRE_CORTO).join('\n');
    expect(textos).not.toContain('\u2014');
    expect(textos).not.toMatch(/\b(region|amigdala|cingulo|precuneo|talamo|ventriculos|hematoencefalica)\b/);
    expect(NOMBRE_CORTO.amigdala).toBe('amígdala');
    expect(NOMBRE_CORTO.neocorteza).toBe('corteza (sin región)');
    const fuente = readFileSync(resolve(AQUI, 'atlas_dibujo.ts'), 'utf8');
    expect(fuente).not.toContain('\u2014');
    // Los comentarios del fichero también van acentuados.
    expect(fuente).not.toMatch(/\/\/[^\n]*\b(hipotesis|region|talamo|cingulo|precuneo|ventriculo|hipotalamo|cerebelo entero|anatomia)\b/);
  });
});

describe('la rampa de color de atlas.css', () => {
  it('sus dos extremos y el lienzo están fijados con un color propio, no colgados de los tokens del tema', () => {
    // El lienzo es siempre oscuro; si la rampa siguiera a --grafo-cluster-0 y
    // --amber, en tema claro (colores para leer sobre blanco) saldría más
    // apagada que en tema oscuro sobre el mismo fondo negro.
    for (const nombre of ['--atlas-frio', '--atlas-calido', '--atlas-lienzo']) {
      const valor = tokenAtlas(nombre);
      expect(valor, nombre).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('una región con un solo registro de 107 ya contrasta al menos 3:1 con el lienzo (WCAG 1.4.11), y la rampa crece con la evidencia', () => {
    const maximo = 107; // los registros en sangre de la investigación grande del 18 de septiembre de 2026
    expect(contrasteRampa(intensidad(1, maximo))).toBeGreaterThanOrEqual(3);
    expect(contrasteRampa(intensidad(2, maximo))).toBeGreaterThanOrEqual(3);
    let anterior = 0;
    for (const conteo of [1, 2, 3, 6, 15, 40, 107]) {
      const c = contrasteRampa(intensidad(conteo, maximo));
      expect(c, `${conteo} de ${maximo}`).toBeGreaterThan(anterior);
      anterior = c;
    }
    expect(anterior).toBeGreaterThan(10);
  });

  it('la zona de pulsación de los vasos no pasa de 7 unidades y el foco de teclado tiene al menos 2,5 de trazo', () => {
    const ancho = Number(CSS_ATLAS.match(/\.atlas-vasos-area\s*\{[^}]*stroke-width:\s*([\d.]+)/)?.[1]);
    expect(ancho).toBeGreaterThan(3);
    expect(ancho).toBeLessThanOrEqual(7);
    // La regla PROPIA del foco (precedida por el cierre de otra regla o por un comentario), no la combinada con :hover, cuyo selector va tras una coma.
    const foco = Number(CSS_ATLAS.match(/(?:\}|\*\/)\s*\.atlas-region:focus-visible\s*\{[^}]*stroke-width:\s*([\d.]+)/)?.[1]);
    expect(foco).toBeGreaterThanOrEqual(2.5);
    // Un hueco enfocado conserva el resplandor: no hay `filter: none` en su regla de foco.
    const reglaHueco = CSS_ATLAS.match(/\.atlas-region\.atlas-hueco:hover,[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(reglaHueco).not.toContain('filter: none');
  });
});
