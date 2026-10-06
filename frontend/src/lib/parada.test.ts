import { describe, expect, it } from 'vitest';
import { borradorDe, normalizarParada, partesAutomatizadas, resumenParada, textoAutomatizacion } from './parada';

describe('partesAutomatizadas', () => {
  it('separa lo medible de lo que decide una persona', () => {
    const p = partesAutomatizadas('3 iteraciones o cuando el modelo de mundo deje de cambiar');
    expect(p.iteraciones).toBe(3);
    expect(p.automatizada).toBe(true);
    expect(p.resto).toBe('cuando el modelo de mundo deje de cambiar');
    expect(textoAutomatizacion(p)).toContain('3 iteraciones');
    expect(textoAutomatizacion(p)).toContain('lo decides tú');
  });
  it('sin cifra no automatiza nada y lo dice', () => {
    const p = partesAutomatizadas('cuando el modelo de mundo deje de cambiar');
    expect(p.automatizada).toBe(false);
    expect(textoAutomatizacion(p)).toContain('no puede medir');
  });
  it('tiempo y llamadas', () => {
    const p = partesAutomatizadas('48 horas o 400 llamadas');
    expect(p.tiempo).toBe('48 h');
    expect(p.llamadas).toBe(400);
    expect(p.resto).toBe('');
  });
});

describe('parada propia de la corrida', () => {
  const vacio = { horas: '', iteraciones: '', llamadas: '', texto: '', certeza: '' as const, cuantas: '', sinCambio: '' };
  it('convierte minutos, horas y días sin redondear los minutos a centésimas de hora', () => {
    expect(normalizarParada({ ...vacio, horas: '1', unidadTiempo: 'minutos' })?.horas).toBe(1 / 60);
    expect(normalizarParada({ ...vacio, horas: '10', unidadTiempo: 'minutos' })?.horas).toBe(10 / 60);
    expect(normalizarParada({ ...vacio, horas: '1,5', unidadTiempo: 'horas' })?.horas).toBe(1.5);
    expect(normalizarParada({ ...vacio, horas: '2', unidadTiempo: 'dias' })?.horas).toBe(48);
    expect(normalizarParada({ ...vacio, unidadTiempo: 'dias' })).toBeNull();
    expect(resumenParada({ horas: 48, iteraciones: null, llamadas: null, texto: '' })).toBe('2 días');
  });
  it('normaliza el formulario: números acotados, texto recortado, null si no hay nada', () => {
    expect(normalizarParada({ ...vacio, texto: '  ' })).toBeNull();
    expect(normalizarParada({ ...vacio, horas: '2,5', iteraciones: '6.9', llamadas: '3', texto: ' hasta que cambie ' })).toEqual({ horas: 2.5, iteraciones: 6, llamadas: 10, texto: 'hasta que cambie', certeza: null, cuantas: null, sinCambio: null });
    expect(normalizarParada({ ...vacio, horas: '-1', iteraciones: 'abc' })).toBeNull();
    expect(normalizarParada({ ...vacio, horas: '9999' })?.horas).toBe(336);
  });
  it('acepta la parada por certeza (con cuántas) y por iteraciones sin avance', () => {
    expect(normalizarParada({ ...vacio, certeza: 'baja' })).toEqual({ horas: null, iteraciones: null, llamadas: null, texto: '', certeza: 'baja', cuantas: 1, sinCambio: null });
    expect(normalizarParada({ ...vacio, certeza: 'moderada', cuantas: '2', sinCambio: '3' })).toMatchObject({ certeza: 'moderada', cuantas: 2, sinCambio: 3 });
    // cuantas sin certeza no vale nada; una certeza fuera de la lista se ignora.
    expect(normalizarParada({ ...vacio, cuantas: '3' })).toBeNull();
    expect(normalizarParada({ ...vacio, certeza: 'muy_baja' as unknown as 'baja' })).toBeNull();
  });
  it('resume en una frase, lo que llegue primero', () => {
    expect(resumenParada(null)).toBe('');
    expect(resumenParada({ horas: 2, iteraciones: null, llamadas: null, texto: '' })).toBe('2 horas');
    expect(resumenParada({ horas: 0.5, iteraciones: 6, llamadas: null, texto: '' })).toBe('30 minutos o 6 iteraciones, lo que llegue primero');
    expect(resumenParada({ horas: 1, iteraciones: 3, llamadas: 500, texto: 'sin cambios' })).toBe('1 hora, 3 iteraciones, 500 llamadas al modelo o «sin cambios», lo que llegue primero');
    expect(resumenParada({ horas: null, iteraciones: null, llamadas: null, texto: '', certeza: 'baja', cuantas: 1, sinCambio: 3 })).toBe('una hipótesis en certeza baja o 3 iteraciones sin avance, lo que llegue primero');
    expect(resumenParada({ horas: null, iteraciones: null, llamadas: null, texto: '', certeza: 'moderada', cuantas: 2, sinCambio: null })).toBe('2 hipótesis en certeza moderada');
  });
  it('vuelve al borrador para reutilizar la parada de la corrida anterior', () => {
    expect(borradorDe({ horas: 2, iteraciones: null, llamadas: 300, texto: 'x', certeza: 'baja', cuantas: 2, sinCambio: null })).toEqual({ horas: '2', iteraciones: '', llamadas: '300', texto: 'x', certeza: 'baja', cuantas: '2', sinCambio: '' });
    expect(borradorDe(null)).toEqual(vacio);
  });
});


it('lee la parada en español e inglés con unidades completas y rechaza cifras engañosas', () => {
  for (const texto of ['3 iterations or 72 hours', '3 iteraciones o 72 horas']) {
    expect(partesAutomatizadas(texto)).toMatchObject({ iteraciones: 3, tiempo: '72 h', resto: '', automatizada: true });
  }
  expect(partesAutomatizadas('1 call').llamadas).toBe(1);
  expect(partesAutomatizadas('1 llamada').llamadas).toBe(1);
  expect(partesAutomatizadas('1.5 hours').tiempo).toBe('1.5 h');
  expect(partesAutomatizadas('2 days').tiempo).toBe('2 d');
  for (const texto of ['-3 iterations', '3.5 iterations', '1,5 calls', '-2 hours', '3 iterationsXYZ', '3 llamadasExtra', '2 hoursExtra']) {
    expect(partesAutomatizadas(texto).automatizada, texto).toBe(false);
  }
});
