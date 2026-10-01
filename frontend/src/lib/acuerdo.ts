// Acuerdo entre dos evaluadores (kappa de Cohen sin ponderar). Espejo de
// rosa/acuerdo.py para pintar el conjunto dorado sin pedirlo al servidor.

import type { CasoDorado } from '../datos/tipos';
import { tr } from './idioma';

export function kappaCohen(a: string[], b: string[]): number | null {
  const n = a.length;
  if (n === 0 || b.length !== n) return null;
  const cats = [...new Set([...a, ...b])];
  if (cats.length <= 1) return null;
  let po = 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) po++;
    fa.set(a[i]!, (fa.get(a[i]!) ?? 0) + 1);
    fb.set(b[i]!, (fb.get(b[i]!) ?? 0) + 1);
  }
  po /= n;
  let pe = 0;
  for (const c of cats) pe += ((fa.get(c) ?? 0) * (fb.get(c) ?? 0)) / (n * n);
  if (pe >= 1) return null;
  return Math.round(((po - pe) / (1 - pe)) * 10000) / 10000;
}

export function interpretarKappa(k: number | null): string {
  if (k === null) return tr('sin datos');
  if (k < 0) return tr('peor que el azar');
  if (k >= 0.81) return tr('casi perfecto');
  if (k >= 0.61) return 'sustancial';
  if (k >= 0.41) return 'moderado';
  if (k >= 0.21) return 'regular';
  return 'leve';
}

export interface AcuerdoDorado {
  n: number;
  bruto: number | null;
  kappa: number | null;
  interpretacion: string;
}

export function acuerdoDe(casos: CasoDorado[]): AcuerdoDorado {
  const a = casos.map((c) => c.veredictoJuez);
  const b = casos.map((c) => c.veredictoHumano);
  const k = kappaCohen(a, b);
  return { n: casos.length, bruto: casos.length ? Math.round((casos.filter((c) => c.veredictoJuez === c.veredictoHumano).length / casos.length) * 1000) / 1000 : null, kappa: k, interpretacion: interpretarKappa(k) };
}

export function acuerdoPorComprobacion(casos: CasoDorado[]): Record<string, AcuerdoDorado> {
  const salida: Record<string, AcuerdoDorado> = {};
  for (const c of new Set(casos.map((x) => x.comprobacion))) salida[c] = acuerdoDe(casos.filter((x) => x.comprobacion === c));
  return salida;
}
