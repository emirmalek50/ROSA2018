import { afterEach, describe, expect, it } from 'vitest';

import { fijarIdioma } from './idioma';
import {
  coma,
  formatearCompacto,
  formatearDuracion,
  formatearEntero,
  formatearPorcentaje,
  plural,
  tiempoRelativo,
} from './formato';

describe('formatearDuracion', () => {
  it('usa decimales solo por debajo de 10 s', () => {
    expect(formatearDuracion(800)).toBe('0,8 s');
    expect(formatearDuracion(4_260)).toBe('4,3 s');
    expect(formatearDuracion(41_000)).toBe('41 s');
  });
  it('sube a minutos, horas y dias', () => {
    expect(formatearDuracion(64_000)).toBe('1 min 4 s');
    expect(formatearDuracion(120_000)).toBe('2 min');
    expect(formatearDuracion(31 * 3_600_000)).toBe('31 h');
    expect(formatearDuracion(31 * 3_600_000 + 600_000)).toBe('31 h 10 min');
    expect(formatearDuracion(72 * 3_600_000)).toBe('3 d');
  });
  it('devuelve vacio para cero, negativos y NaN', () => {
    expect(formatearDuracion(0)).toBe('');
    expect(formatearDuracion(-5)).toBe('');
    expect(formatearDuracion(Number.NaN)).toBe('');
  });
});

describe('tiempoRelativo', () => {
  const ahora = 1_000_000_000;
  it('redondea a la unidad legible', () => {
    expect(tiempoRelativo(ahora - 10_000, ahora)).toBe('hace un momento');
    expect(tiempoRelativo(ahora - 6 * 60_000, ahora)).toBe('hace 6 min');
    expect(tiempoRelativo(ahora - 2 * 3_600_000, ahora)).toBe('hace 2 h');
    expect(tiempoRelativo(ahora - 3 * 86_400_000, ahora)).toBe('hace 3 d');
  });
  it('distingue el futuro, salvo el desfase del reloj de pantalla', () => {
    expect(tiempoRelativo(ahora + 5 * 60_000, ahora)).toBe('en 5 min');
    expect(tiempoRelativo(ahora + 10_000, ahora)).toBe('hace un momento');
  });
});

describe('numeros', () => {
  it('pone puntos de miles', () => {
    expect(formatearEntero(48_200_000)).toBe('48.200.000');
    expect(formatearEntero(999)).toBe('999');
    expect(formatearEntero(-1_234)).toBe('-1.234');
  });
  it('compacta con coma decimal', () => {
    expect(formatearCompacto(48_200_000)).toBe('48,2 M');
    expect(formatearCompacto(3_950_000)).toBe('4 M');
    expect(formatearCompacto(12_318)).toBe('12,3 k');
    expect(formatearCompacto(2_318)).toBe('2.318');
    expect(formatearCompacto(412)).toBe('412');
  });
  it('formatea porcentajes', () => {
    expect(formatearPorcentaje(0.891)).toBe('89 %');
    expect(formatearPorcentaje(0.891, 1)).toBe('89,1 %');
    expect(formatearPorcentaje(1)).toBe('100 %');
  });
  it('pluraliza', () => {
    expect(plural(1, 'hipotesis', 'hipotesis')).toBe('1 hipotesis');
    expect(plural(3, 'afirmacion', 'afirmaciones')).toBe('3 afirmaciones');
    expect(plural(2, 'articulo')).toBe('2 articulos');
  });
});

describe('el separador de números sigue al idioma', () => {
  afterEach(() => {
    fijarIdioma('es');
    try {
      localStorage.removeItem('rosa.idioma');
    } catch {
      // Sin almacenamiento no hay nada que limpiar.
    }
  });

  it('en castellano, miles con punto y decimales con coma', () => {
    fijarIdioma('es');
    expect(formatearEntero(1171)).toBe('1.171');
    expect(formatearEntero(48987)).toBe('48.987');
    expect(coma('0.8')).toBe('0,8');
    expect(formatearPorcentaje(0.185, 1)).toBe('18,5 %');
  });

  it('en inglés, al revés: miles con coma y decimales con punto', () => {
    // No es cosmética. «1.171» leído en inglés es poco más de uno, no mil
    // ciento setenta y uno: el número diría algo distinto de lo que es.
    fijarIdioma('en');
    expect(formatearEntero(1171)).toBe('1,171');
    expect(formatearEntero(48987)).toBe('48,987');
    expect(coma('0.8')).toBe('0.8');
    expect(formatearPorcentaje(0.185, 1)).toBe('18.5 %');
  });

  it('los números por debajo de mil se ven igual en los dos idiomas', () => {
    for (const i of ['es', 'en'] as const) {
      fijarIdioma(i);
      expect(formatearEntero(999)).toBe('999');
      expect(formatearEntero(0)).toBe('0');
      expect(formatearEntero(-42)).toBe('-42');
    }
  });

  it('la duración también cambia de separador decimal', () => {
    fijarIdioma('es');
    expect(formatearDuracion(800)).toBe('0,8 s');
    fijarIdioma('en');
    expect(formatearDuracion(800)).toBe('0.8 s');
  });
});

describe('el tiempo relativo en inglés', () => {
  it('invierte el orden: «hace 15 d» no es «ago 15 d»', () => {
    // Se componía como prefijo + cifra, y en inglés el orden es al revés.
    // Por eso TODAS las tarjetas de la interfaz decían «hace 15 d» con la
    // interfaz en inglés (2 de octubre de 2026).
    fijarIdioma('en');
    const ahora = 1_700_000_000_000;
    expect(tiempoRelativo(ahora - 15 * 86_400_000, ahora)).toBe('15 d ago');
    expect(tiempoRelativo(ahora - 3 * 3_600_000, ahora)).toBe('3 h ago');
    expect(tiempoRelativo(ahora - 20 * 60_000, ahora)).toBe('20 min ago');
    expect(tiempoRelativo(ahora + 20 * 60_000, ahora)).toBe('in 20 min');
    fijarIdioma('es');
    expect(tiempoRelativo(ahora - 15 * 86_400_000, ahora)).toBe('hace 15 d');
    expect(tiempoRelativo(ahora + 20 * 60_000, ahora)).toBe('en 20 min');
  });
});
