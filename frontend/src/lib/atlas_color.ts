// El color de una región del atlas, calculado en código con la MISMA fórmula
// que atlas.css: `color-mix(in oklab, var(--atlas-calido) p%, var(--atlas-frio))`
// con `fill-opacity: 0.3 + 0.6 * t` (un tinte ámbar sobre la lámina
// anatómica: tenue con pocas cohortes, pleno con muchas), y al pasar el ratón
// p + 30 % y opacidad 0,92. Hace falta porque el lienzo (canvas) de la vista
// 3D no entiende `color-mix`: si se le asigna, la ignora y se queda con el
// color anterior, y así el 3D pintaba el líquido cefalorraquídeo beige donde
// el 2D lo pinta ámbar. La conversión sRGB a oklab es la del CSS Color 4 (la
// misma que usa atlas_dibujo.test.ts para medir el tinte sobre la lámina).

export const FRIO_POR_DEFECTO = '#edc472';
export const CALIDO_POR_DEFECTO = '#f0a030';
/** Suelo de la opacidad: con menos, una región con registros y sin cohorte no se distingue de la lámina sin tintar. */
export const SUELO_OPACIDAD = 0.3;
export const TRAMO_OPACIDAD = 0.6;
/** Cuánto sube en la rampa una región al pasar el ratón o enfocarla (atlas.css: + 30 %). */
export const SUBIDA_FOCO = 0.3;
/** La opacidad al pasar el ratón (atlas.css: 0,92, para que la lámina siga viéndose debajo). */
export const OPACIDAD_FOCO = 0.92;

export type RGB = [number, number, number];

/** `#rrggbb` a canales 0..255; null si no es un hexadecimal de seis cifras. */
export function hexARgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const deSrgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const aSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const acotar = (v: number): number => Math.max(0, Math.min(1, v));

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
  return [acotar(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), acotar(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), acotar(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

/** `color-mix(in oklab, calido p, frio)`: p es la fracción (0..1) del cálido.
 *  Devuelve canales sRGB 0..255. Un hexadecimal inválido cae al color por defecto. */
export function mezclaOklab(calido: string, frio: string, p: number): RGB {
  const c = hexARgb(calido) ?? hexARgb(CALIDO_POR_DEFECTO)!;
  const f = hexARgb(frio) ?? hexARgb(FRIO_POR_DEFECTO)!;
  const q = acotar(Number.isFinite(p) ? p : 0);
  const lc = linealAOklab(c.map((v) => deSrgb(v / 255)) as RGB);
  const lf = linealAOklab(f.map((v) => deSrgb(v / 255)) as RGB);
  const mezcla: RGB = [lc[0] * q + lf[0] * (1 - q), lc[1] * q + lf[1] * (1 - q), lc[2] * q + lf[2] * (1 - q)];
  return oklabALineal(mezcla).map((v) => Math.round(aSrgb(v) * 255)) as RGB;
}

export interface Relleno {
  /** `rgb(r, g, b)` listo para fillStyle o strokeStyle. */
  color: string;
  /** La opacidad con la que se compone sobre el lienzo (fill-opacity del 2D). */
  opacidad: number;
}

/** El relleno de una región de intensidad t (0..1, la de `intensidad()` de
 *  lib/atlas.ts), como lo pinta el 2D: Atlas.tsx pasa `--atlas-p` redondeado a
 *  entero por ciento y `--atlas-t` con tres decimales, y aquí se redondea igual
 *  para que los dos lienzos den el mismo píxel. Con `foco`, la subida del
 *  ratón (+30 % en la rampa, opacidad 0,92). */
export function rellenoRegion(t: number, opciones: { frio?: string; calido?: string; foco?: boolean } = {}): Relleno {
  const tt = acotar(Number.isFinite(t) ? t : 0);
  const p = acotar(Math.round(tt * 100) / 100 + (opciones.foco ? SUBIDA_FOCO : 0));
  const [r, g, b] = mezclaOklab(opciones.calido ?? CALIDO_POR_DEFECTO, opciones.frio ?? FRIO_POR_DEFECTO, p);
  const opacidad = opciones.foco ? OPACIDAD_FOCO : SUELO_OPACIDAD + TRAMO_OPACIDAD * Number(tt.toFixed(3));
  return { color: `rgb(${r}, ${g}, ${b})`, opacidad };
}

/** Un token de la hoja de estilos (`--atlas-frio`...) tal como lo calcula el
 *  navegador, o el valor por defecto si no hay documento (tests) o está vacío. */
export function tokenAtlas(nombre: string, porDefecto: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return porDefecto;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return v || porDefecto;
  } catch {
    return porDefecto;
  }
}
