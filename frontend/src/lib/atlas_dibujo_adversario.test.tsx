// @vitest-environment jsdom
// Tests adversarios del constructor "dibujo" del atlas (lib/atlas_dibujo.ts,
// pantallas/Atlas.tsx y atlas.css). Cada test codifica lo que el atlas DEBERÍA
// cumplir y falla hoy: es la prueba reproducible de cada hallazgo del informe,
// para que la fase de reparación tenga contra qué programar.
//
// Cómo se mide la geometría: los trazados SVG (M, L, C, A, Z) se aplanan a
// polígonos (las Bézier y los arcos en 24 tramos), se decide "dentro" con la
// regla par-impar (la misma fill-rule evenodd que usa la pantalla) y "quién
// recibe el puntero" siguiendo el orden de dibujo (la última figura que
// contiene el punto gana, como en el DOM). Los números se contrastaron con
// Chromium real (document.elementFromPoint sobre la pantalla pintada con el
// estado de rosa.db en solo lectura): coinciden con margen de un 5 %.
//
// Cómo se mide el color: la fórmula de atlas.css (color-mix en oklab entre
// --atlas-frio y --atlas-calido, dos colores FIJOS que no cuelgan del tema, con
// la opacidad de `fill-opacity: calc(a + b * t)`) se recalcula aquí con la
// conversión oklab del CSS Color 4, leyendo los valores tal como están
// escritos en atlas.css. El relleno se compone sobre el lienzo en sRGB, que es
// como lo hace el navegador con fill-opacity (medido en Chromium con un canvas:
// la mezcla en luz lineal salía medio punto de contraste más optimista). El
// resultado reproduce el píxel que Chromium pinta con un margen de 2 niveles.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFINICIONES_MAPA, ETIQUETAS_MAPA } from '../componentes/MapaEnfermedad';
import { estadoDeMuestra } from '../datos/muestra';
import type { CeldaMapa, EstadoRosa, HechoMundo, Investigacion, MapaEnfermedad } from '../datos/tipos';
import { Atlas } from '../pantallas/Atlas';
import { intensidad } from './atlas';
import { NOMBRE_CORTO, RECORTADAS, RECORTE_HEMISFERIO, REGIONES_DIBUJO, VISTA, type RegionDibujo } from './atlas_dibujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CSS_ATLAS = readFileSync(resolve(AQUI, '../atlas.css'), 'utf8');

// ---------------------------------------------------------------------------
// Geometría: aplanar trazados y medir
// ---------------------------------------------------------------------------

type Punto = [number, number];

function fichas(d: string): (string | number)[] {
  return (d.replace(/,/g, ' ').match(/[MLCAZ]|-?\d+(?:\.\d+)?/g) ?? []).map((t) => (/^[MLCAZ]$/.test(t) ? t : Number(t)));
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

/** Los subtrazados de un `d` como polígonos (o polilíneas, si no cierran). */
function poligonos(d: string): Punto[][] {
  const f = fichas(d);
  const salida: Punto[][] = [];
  let actual: Punto[] = [];
  let pos: Punto = [0, 0];
  let orden = '';
  const num = (i: number): number => {
    const v = f[i];
    if (typeof v !== 'number') throw new Error(`número esperado en la posición ${i} de: ${d}`);
    return v;
  };
  let i = 0;
  while (i < f.length) {
    const t = f[i];
    if (typeof t === 'string') {
      orden = t;
      i++;
      if (orden === 'Z') {
        if (actual.length) salida.push(actual);
        actual = [];
      }
      continue;
    }
    if (orden === 'M') {
      if (actual.length) salida.push(actual);
      actual = [];
      pos = [num(i), num(i + 1)];
      actual.push(pos);
      i += 2;
      orden = 'L';
    } else if (orden === 'L') {
      pos = [num(i), num(i + 1)];
      actual.push(pos);
      i += 2;
    } else if (orden === 'C') {
      const fin: Punto = [num(i + 4), num(i + 5)];
      actual.push(...bezier(pos, [num(i), num(i + 1)], [num(i + 2), num(i + 3)], fin));
      pos = fin;
      i += 6;
    } else if (orden === 'A') {
      const fin: Punto = [num(i + 5), num(i + 6)];
      actual.push(...arco(pos, num(i), num(i + 3), num(i + 4), fin));
      pos = fin;
      i += 7;
    } else {
      throw new Error(`orden SVG no contemplada: ${orden}`);
    }
  }
  if (actual.length) salida.push(actual);
  return salida;
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

/** Regla par-impar sobre todos los subtrazados: es la fill-rule evenodd de la pantalla. */
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

const RECORTE = poligonos(RECORTE_HEMISFERIO);
const FIGURAS = new Map(REGIONES_DIBUJO.map((r) => [r.clave, poligonos(r.d)] as const));

/** Si el punto cae en la figura de esa clave, con el recorte del hemisferio para los lóbulos. */
function enRegion(clave: string, p: Punto): boolean {
  if (!dentroFigura(p, FIGURAS.get(clave)!)) return false;
  return RECORTADAS.has(clave) ? dentroFigura(p, RECORTE) : true;
}

/** Qué región recibe el puntero en un punto: la última dibujada que lo contiene (los vasos son trazo, no cuentan). */
function visibleEn(p: Punto): string | null {
  for (let i = REGIONES_DIBUJO.length - 1; i >= 0; i--) {
    const r = REGIONES_DIBUJO[i]!;
    if (r.capa === 'vasos') continue;
    if (enRegion(r.clave, p)) return r.clave;
  }
  return null;
}

/** Copia de finGuia() de pantallas/Atlas.tsx (no está exportada): dónde acaba la guía de una etiqueta. */
function finGuia(r: RegionDibujo): Punto {
  const [cx, cy] = r.centro;
  const [x, y] = r.etiqueta;
  const medio = (NOMBRE_CORTO[r.clave] ?? r.clave).length * 3.4 + 4;
  if (Math.abs(y - cy) < 12) return [x + (cx < x ? -medio : medio), y - 4];
  return [x, y > cy ? y - 13 : y + 4];
}

// ---------------------------------------------------------------------------
// Color: la rampa de atlas.css recalculada en oklab
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const hexARgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const aLineal = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const rgbALineal = (rgb: RGB): RGB => [aLineal(rgb[0]), aLineal(rgb[1]), aLineal(rgb[2])];

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

/** color-mix(in oklab, A p, B): interpolación lineal de las coordenadas oklab. */
const mezclar = (a: RGB, p: number, b: RGB): RGB => [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)];
const luminancia = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contraste = (a: RGB, b: RGB): number => (Math.max(luminancia(a), luminancia(b)) + 0.05) / (Math.min(luminancia(a), luminancia(b)) + 0.05);

/** Un token de :root en atlas.css tal como está escrito. Los tres de la rampa
 *  (lienzo, frío y cálido) tienen que ser un hexadecimal FIJO: si alguno
 *  volviera a colgar de un token del tema (var(--amber) o color-mix con él),
 *  este test lo dice en vez de calcular con un color que no es el pintado. */
function tokenAtlas(nombre: string): string {
  const m = CSS_ATLAS.match(new RegExp(`${nombre}:\\s*([^;]+);`));
  if (!m) throw new Error(`no encuentro ${nombre} en atlas.css`);
  return m[1]!.trim();
}

/** La fórmula de la rampa tal como está escrita en atlas.css; si cambia, el test lo dice. */
function formulaRampa() {
  const lienzo = tokenAtlas('--atlas-lienzo');
  const frio = tokenAtlas('--atlas-frio');
  const calido = tokenAtlas('--atlas-calido');
  for (const [nombre, valor] of [['--atlas-lienzo', lienzo], ['--atlas-frio', frio], ['--atlas-calido', calido]] as const) {
    if (!/^#[0-9a-fA-F]{6}$/.test(valor)) throw new Error(`${nombre} en atlas.css ya no es un hexadecimal fijo (${valor}): la rampa volvería a depender del tema; actualizar el CSS o formulaRampa() en este test`);
  }
  const opacidad = CSS_ATLAS.match(/fill-opacity:\s*calc\(([\d.]+) \+ ([\d.]+) \* var\(--atlas-t, 0\)\)/);
  if (!opacidad) throw new Error('la fórmula de la opacidad en atlas.css cambió: actualizar formulaRampa() en este test');
  return { lienzo, frio, calido, opacidad0: Number(opacidad[1]), opacidad1: Number(opacidad[2]) };
}

/** El color efectivo de una región de intensidad t sobre el lienzo (el píxel
 *  que pinta el navegador: relleno en oklab, opacidad compuesta en sRGB) y su
 *  contraste con el lienzo. El tema no cambia nada: la rampa está fijada. */
function relleno(t: number): { rgb: RGB; contraste: number } {
  const f = formulaRampa();
  const frio = linealAOklab(rgbALineal(hexARgb(f.frio)));
  const calido = linealAOklab(rgbALineal(hexARgb(f.calido)));
  // Atlas.tsx pasa --atlas-p como Math.round(t * 100) % y --atlas-t con tres decimales.
  const p = Math.round(t * 100) / 100;
  const aSrgb = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const fill = oklabALineal(mezclar(calido, p, frio)).map(aSrgb) as RGB;
  const opacidad = f.opacidad0 + f.opacidad1 * Number(t.toFixed(3));
  const fondo = hexARgb(f.lienzo);
  const rgb = [0, 1, 2].map((i) => Math.round(fill[i]! * opacidad + fondo[i]! * (1 - opacidad))) as RGB;
  return { rgb, contraste: contraste(rgbALineal(rgb), rgbALineal(fondo)) };
}

// ---------------------------------------------------------------------------
// Los tests de geometría y color
// ---------------------------------------------------------------------------

describe('la geometría del atlas (adversario)', () => {
  it('el centro de cada región cae dentro de su propia figura: de ahí sale la guía de la etiqueta', () => {
    // Contrato de RegionDibujo.centro: "Un punto dentro de la figura: de aquí sale la guía de la etiqueta".
    // Hoy fallan tres: cerebro_sin_region (200, 84) está 11 unidades por encima del borde del cerebro,
    // así que la guía de «cerebro (sin región)» nace en el vacío; cingulo_precuneo (452, 158) queda
    // 2 unidades por encima de la medialuna, y con él la etiqueta, que se lee sobre la sustancia blanca;
    // retina (70, 300) cae en la concavidad de la medialuna del ojo, no en la retina.
    const fuera: string[] = [];
    for (const r of REGIONES_DIBUJO) {
      const figura = FIGURAS.get(r.clave)!;
      const dentro = r.capa === 'vasos' ? distanciaPolilineas(r.centro, figura) <= 1.5 : enRegion(r.clave, r.centro);
      if (!dentro) fuera.push(`${r.clave} (${r.centro.join(', ')}) cae en ${visibleEn(r.centro) ?? 'el vacío'}`);
    }
    expect(fuera).toEqual([]);
  });

  it('la zona de pulsación ancha e invisible de los vasos no tapa más del 10 % de la superficie visible de ninguna región', () => {
    // atlas.css pinta sobre TODO el cerebro un segundo trazado de los vasos, transparente, de 16
    // unidades de ancho (.atlas-vasos-area), para que un trazo de 3 sea fácil de acertar. Medido en
    // Chromium con elementFromPoint: roba el 37 % de la superficie visible del lóbulo parietal, el 20 %
    // del frontal, el 17 % del cíngulo, el 14 % del tronco y el 13 % de la sustancia blanca. Al pasar
    // el ratón por ahí la región no se ilumina ni enseña su conteo: sale «vasos y barrera
    // hematoencefálica». Aquí se cuenta lo mismo con los polígonos: los puntos de cada región a menos
    // de medio ancho del vaso pero fuera de su trazo visible (1,5 unidades).
    const ancho = Number(CSS_ATLAS.match(/\.atlas-vasos-area\s*\{[^}]*stroke-width:\s*([\d.]+)/)?.[1]);
    expect(ancho, 'stroke-width de .atlas-vasos-area en atlas.css').toBeGreaterThan(0);
    const vasos = FIGURAS.get('vascular_bhe')!;
    const visible = new Map<string, number>();
    const robado = new Map<string, number>();
    for (let x = 2; x < VISTA.ancho; x += 4) {
      for (let y = 2; y < VISTA.alto; y += 4) {
        const p: Punto = [x, y];
        const quien = visibleEn(p);
        if (!quien) continue;
        visible.set(quien, (visible.get(quien) ?? 0) + 1);
        const d = distanciaPolilineas(p, vasos);
        if (d <= ancho / 2 && d > 1.5) robado.set(quien, (robado.get(quien) ?? 0) + 1);
      }
    }
    const excesos = [...visible.entries()]
      .map(([clave, n]) => ({ clave, pct: Math.round((100 * (robado.get(clave) ?? 0)) / n) }))
      .filter((r) => r.pct > 10)
      .sort((a, b) => b.pct - a.pct)
      .map((r) => `${r.clave}: ${r.pct} %`);
    expect(excesos).toEqual([]);
  });

  it('ninguna guía de etiqueta atraviesa otra estructura pequeña: la línea señalaría la región equivocada', () => {
    // La guía de «hipocampo» sale de (455, 353) hacia (340, 457) y cruza la elipse de la corteza
    // entorrinal en x = 424, y = 381: quien sigue la línea desde la etiqueta llega primero a la
    // entorrinal, que además tiene su propia guía hacia abajo. Las capas grandes (anillos, lóbulos,
    // sustancia blanca, tronco, cerebelo) no cuentan: una guía siempre tiene que cruzarlas.
    const pequenas = new Set(['hipocampo', 'corteza_entorrinal', 'amigdala', 'cingulo_precuneo', 'ganglios_basales_talamo', 'lcr', 'bulbo_olfatorio', 'retina', 'plasma', 'intestino_microbiota']);
    const cruces: string[] = [];
    for (const r of REGIONES_DIBUJO) {
      if (!r.guia) continue;
      const fin = finGuia(r);
      const cruzadas = new Set<string>();
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const quien = visibleEn([r.centro[0] + (fin[0] - r.centro[0]) * t, r.centro[1] + (fin[1] - r.centro[1]) * t]);
        if (quien && quien !== r.clave && pequenas.has(quien)) cruzadas.add(quien);
      }
      if (cruzadas.size) cruces.push(`la guía de ${r.clave} cruza ${[...cruzadas].join(' y ')}`);
    }
    expect(cruces).toEqual([]);
  });
});

describe('la rampa de color del atlas (adversario)', () => {
  // El máximo real de cohortes distintas en una región localizada de la
  // investigación grande del 18 de septiembre de 2026: 24 en la sangre.
  const MAXIMO_COHORTES = 24;

  it('la fórmula recalculada reproduce el píxel que Chromium pinta (control del método)', () => {
    // Medido en Chromium (playwright, chromium_headless_shell) con atlas.css tal cual, componiendo el
    // relleno calculado con su fill-opacity sobre el lienzo en un canvas: t = 0 (una región con
    // registros y ninguna cohorte nombrada, como el hipocampo real) da fill oklab(0.589806 0.0522909
    // -0.118285) con opacidad 0,8 y píxel rgb(106, 88, 159); 1 cohorte de 24 (t = 0,215), opacidad
    // 0,843 y rgb(131, 108, 153); 2 de 24 (t = 0,341), rgb(146, 120, 148); el máximo, rgb(249, 182, 84).
    // Si este test falla, la fórmula del test ya no es la de atlas.css y los dos siguientes no valen.
    const casos: [number, RGB][] = [
      [0, [106, 88, 159]],
      [intensidad(1, MAXIMO_COHORTES), [131, 108, 153]],
      [intensidad(2, MAXIMO_COHORTES), [146, 120, 148]],
      [1, [249, 182, 84]],
    ];
    expect(intensidad(1, MAXIMO_COHORTES)).toBeCloseTo(0.215, 2);
    for (const [t, esperado] of casos) {
      const { rgb } = relleno(t);
      for (let i = 0; i < 3; i++) expect(Math.abs(rgb[i]! - esperado[i]!), `t = ${t.toFixed(3)}: rgb(${rgb.join(', ')}) frente a Chromium rgb(${esperado.join(', ')})`).toBeLessThanOrEqual(2);
    }
  });

  it('una región con registros y pocas o ninguna cohorte contrasta al menos 3:1 con el lienzo (WCAG 1.4.11, objetos gráficos)', () => {
    // Con el color por cohortes, t = 0 con registros es el caso MÁS frecuente (en la investigación
    // grande el hipocampo tiene 15 registros y 0 cohortes; la entorrinal, el cíngulo y la amígdala,
    // igual). Con el suelo de opacidad anterior (0,55) ese violeta contrastaba 2,5:1 con el píxel
    // real; con 0,7 y mezcla en sRGB, 2,53:1. La leyenda promete "pocas o ninguna", no "nada".
    const fallos: string[] = [];
    for (const [nombre, t] of [['0 cohortes', 0], ['1 de 24', intensidad(1, MAXIMO_COHORTES)], ['2 de 24', intensidad(2, MAXIMO_COHORTES)]] as const) {
      const { rgb, contraste: c } = relleno(t);
      if (c < 3) fallos.push(`${nombre}: rgb(${rgb.join(', ')}) contrasta ${c.toFixed(2)}:1`);
    }
    expect(fallos).toEqual([]);
    // Y la rampa crece con las cohortes hasta pasar de 10:1 en el máximo.
    let anterior = 0;
    for (const n of [0, 1, 2, 4, 8, 16, 24]) {
      const c = relleno(intensidad(n, MAXIMO_COHORTES)).contraste;
      expect(c, `${n} de ${MAXIMO_COHORTES}`).toBeGreaterThan(anterior);
      anterior = c;
    }
    expect(anterior).toBeGreaterThan(10);
  });

  it('el lienzo es siempre oscuro, así que la rampa está fijada y no cuelga de los tokens del tema', () => {
    // atlas.css fija el lienzo (#0b0a14); si la rampa colgara de --amber y --grafo-cluster-0, que en el
    // tema claro valen #d97706 y #7c3aed (pensados para leer sobre blanco) y en el oscuro #f59e0b y
    // #a78bfa, la misma región con la misma evidencia se vería más apagada en tema claro sobre el mismo
    // fondo negro (para 6 registros de 107 el contraste bajaba de 3,9:1 a 2,8:1). formulaRampa() ya
    // exige hexadecimales fijos; aquí se comprueba además que ninguna regla de la rampa (relleno y trazo
    // de las regiones) toque un token del tema.
    const reglas = [...CSS_ATLAS.matchAll(/\.atlas-region[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      expect(r).not.toMatch(/var\(--(?:amber|grafo-cluster-\d|accent|text|border)/);
    }
    // Y los tres tokens no llevan var() ni color-mix.
    for (const nombre of ['--atlas-lienzo', '--atlas-frio', '--atlas-calido']) expect(tokenAtlas(nombre)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// La pantalla montada: lo que el panel calla o dice mal
// ---------------------------------------------------------------------------

vi.mock('motion/react', async (original) => ({ ...(await original<typeof import('motion/react')>()), useReducedMotion: () => true }));

beforeAll(() => {
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

const FECHA = Date.UTC(2026, 8, 12, 10, 0, 0);

function hecho(id: string, enunciado: string): HechoMundo {
  return { id, investigacionId: 'inv-1', tipo: 'hecho', tema: 'Tema de prueba', enunciado, estado: 'sabido', origen: 'fuente', procedencia: [], motivoDescarte: null, actualizadoEn: FECHA, prioridad: 1, citas: [], historial: [{ fecha: FECHA, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido en la iteración 2' }] };
}

function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

/** El estado de muestra con tres hechos propios y un mapa con las celdas dadas. */
function estadoConCeldas(celdas: CeldaMapa[], resumen: string): { estado: EstadoRosa; inv: Investigacion } {
  const estado = structuredClone(estadoDeMuestra());
  const inv = estado.investigaciones[0]!;
  const mapa: MapaEnfermedad = {
    ejes: { estadio: {}, region: {}, tipoCelular: {}, nivel: {} },
    celdas,
    huecos: [],
    sinEjes: 0,
    hipotesisSinEjes: 0,
    heredados: 0,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen,
    fecha: FECHA,
    iteracion: 2,
    etiquetas: ETIQUETAS_MAPA,
    definiciones: DEFINICIONES_MAPA,
  };
  inv.mapaEnfermedad = mapa;
  estado.hechos = [hecho('he-a', 'GFAP plasmático sube antes que NfL en portadores.'), hecho('he-b', 'p-tau217 plasmático distingue amiloide positivo en atención primaria.'), hecho('he-c', 'En fase preclínica la tau se acumula sin síntomas.')].map((h) => ({ ...h, investigacionId: inv.id }));
  return { estado, inv };
}

/** Deja pasar el frame y el temporizador que vienen detrás: desde el 19 de
 *  septiembre de 2026 el atlas se construye DESPUÉS del pintado
 *  (lib/diferido.ts, useCalculoDiferido) y el primer render es su silueta
 *  (EsqueletoAtlas), así que montar y pulsar un filtro esperan a ese frame. */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const montar = async (estado: EstadoRosa, inv: Investigacion) => {
  await act(async () => root.render(<Atlas inv={inv} estado={estado} />));
  await esperarPintado();
};
const region = (clave: string) => nodo.querySelector<SVGPathElement>(`[role="button"][data-clave="${clave}"]`)!;
const pulsar = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await esperarPintado();
};
const panel = () => nodo.querySelector('.atlas-panel')!.textContent ?? '';

describe('la pantalla del atlas (adversario)', () => {
  it('el panel dice cuántos registros están situados por fase o célula pero sin región: hoy los omite y contradice al resumen', async () => {
    // En el estado real (inv-mu2sz2ns-3, 18 de septiembre de 2026) el resumen del backend dice
    // «217 hechos y 9 hipótesis situados» y, dos líneas más abajo, el panel dice «161 hechos y 9
    // hipótesis situados»: los 56 que faltan están en celdas con fase o célula pero sin región.
    // lib/atlas.ts los cuenta en `sinRegion`; la pantalla no lo lee. Aquí, a escala: 2 hechos con
    // región y 1 sin ella.
    const { estado, inv } = estadoConCeldas(
      [celda({ region: 'plasma', hechos: ['he-a', 'he-b'] }), celda({ estadio: 'preclinica', region: null, hechos: ['he-c'] })],
      '3 hechos y 0 hipótesis situados en 2 celdas (estadio, región y tipo celular).',
    );
    await montar(estado, inv);
    const texto = panel();
    // El resumen del backend sigue diciendo 3.
    expect(texto).toContain('3 hechos y 0 hipótesis situados');
    // Y la propia pantalla tiene que dar cuenta del que no está en la figura.
    expect(texto).toMatch(/\b1 hecho\b[^.]*\bsin región\b/);
  });

  it('el pie concuerda en número: «1 región con evidencia», no «1 regiones con evidencia»', async () => {
    // Atlas.tsx escribe `${conEvidencia} regiones con evidencia` a mano en el pie del deslizador; el
    // panel usa plural() y lo dice bien. El test del constructor fija incluso el literal incorrecto.
    const { estado, inv } = estadoConCeldas([celda({ region: 'plasma', hechos: ['he-a', 'he-b'] })], '2 hechos situados.');
    await montar(estado, inv);
    const pie = nodo.querySelector('.grafo-tiempo')?.textContent ?? '';
    expect(pie).toMatch(/\b1 región con evidencia\b/);
    expect(pie).not.toMatch(/\b1 regiones\b/);
  });

  it('si la celda apunta a hechos o hipótesis que ya no están en el estado, el panel lo dice en vez de prometer una lista que no llega', async () => {
    // El mapa es una instantánea al cerrar la iteración; los hechos se sustituyen y se descartan
    // después. lib/atlas.ts deja `sinResolver` en cada región para que el panel diga «y N que ya no
    // están en el modelo de mundo». Hoy las cifras dicen «2 hechos» y «1 hipótesis», la lista trae un
    // hecho y ninguna hipótesis, y nadie explica la diferencia.
    const { estado, inv } = estadoConCeldas([celda({ region: 'hipocampo', hechos: ['he-a', 'he-fantasma'], hipotesis: ['hip-fantasma'] })], '2 hechos y 1 hipótesis situados.');
    await montar(estado, inv);
    await pulsar(region('hipocampo'));
    const texto = panel();
    expect(texto).toContain('2 hechos');
    expect(texto).toContain('1 hipótesis');
    const hechosListados = [...nodo.querySelectorAll('.atlas-panel h4')].find((h) => h.textContent?.startsWith('Hechos'))?.nextElementSibling?.querySelectorAll('li').length ?? 0;
    expect(hechosListados).toBe(1);
    expect(texto).toMatch(/ya no est[aá]/);
  });
});
