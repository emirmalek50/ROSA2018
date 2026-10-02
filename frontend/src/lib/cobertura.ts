// Cobertura de la busqueda y su efecto sobre los veredictos. Sigue la idea
// de Undermind: la tasa de descubrimiento de articulos relevantes decae como
// una exponencial, f(n) = 1 - e^(-n/tau), y se puede decir con honestidad
// "hemos encontrado un 93 % de lo relevante". La consecuencia que importa
// para ROSA2018 es que una "ausencia refutada" solo vale si la busqueda del tema
// converge: si no, se degrada a "sin verificar" con la cobertura al lado.

import type { Cobertura, Veredicto } from '../datos/tipos';
import { trp } from './idioma';

/** Fraccion estimada de lo relevante encontrada tras leer n con escala tau. */
export function fraccionCubierta(leidos: number, tau: number): number {
  if (tau <= 0 || leidos <= 0) return 0;
  return 1 - Math.exp(-leidos / tau);
}

/** Cuantos mas habria que leer para pasar de la cobertura actual a `objetivo`. */
export function faltanParaCobertura(c: Cobertura, objetivo: number): number {
  if (objetivo <= c.fraccion) return 0;
  if (objetivo >= 1) return Number.POSITIVE_INFINITY;
  const nObjetivo = -c.tau * Math.log(1 - objetivo);
  return Math.max(0, Math.ceil(nObjetivo - c.leidos));
}

/** Umbral por debajo del cual una ausencia no se puede refutar ni afirmar. */
export const COBERTURA_MINIMA = 0.8;

/** El veredicto que se ensena, dada la cobertura del tema. Solo toca la
 *  ausencia refutada: los demas no dependen de cuanto se leyo. */
export function veredictoConCobertura(veredicto: Veredicto, cobertura: Cobertura | null): { veredicto: Veredicto; nota: string | null } {
  if (veredicto !== 'ausencia_refutada' || cobertura === null) return { veredicto, nota: null };
  if (cobertura.fraccion >= COBERTURA_MINIMA) return { veredicto, nota: null };
  const pct = Math.round(cobertura.fraccion * 100);
  return {
    veredicto: 'sin_verificar',
    nota: trp("La búsqueda del tema \"{tema}\" no ha convergido (cobertura estimada {pct} %): no se puede afirmar que esté ni que no esté.", { tema: cobertura.tema, pct }),
  };
}

/** Puntos de la curva para pintarla: (n, f(n)) hasta un poco mas alla de lo leido. */
export function curvaDescubrimiento(c: Cobertura, puntos = 24): { n: number; f: number }[] {
  const maxN = Math.max(c.leidos * 1.6, c.tau * 3);
  const salida: { n: number; f: number }[] = [];
  for (let i = 0; i <= puntos; i++) {
    const n = (maxN * i) / puntos;
    salida.push({ n, f: fraccionCubierta(n, c.tau) });
  }
  return salida;
}
