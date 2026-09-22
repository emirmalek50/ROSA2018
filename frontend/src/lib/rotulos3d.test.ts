import { describe, expect, it } from 'vitest';
import { repartirRotulos, sePisan, type Ancla } from './rotulos3d';

const ancla = (clave: string, x: number, y: number, prioridad = 1): Ancla => ({ clave, texto: clave, x, y, prioridad });

describe('el reparto de los nombres alrededor del cerebro', () => {
  it('manda a la izquierda lo que cae a la izquierda del centro, y a la derecha lo demás', () => {
    const r = repartirRotulos([ancla('a', 100, 200), ancla('b', 900, 300)], { ancho: 1000, alto: 600, paso: 14 });
    expect(r.find((x) => x.clave === 'a')?.lado).toBe('izquierda');
    expect(r.find((x) => x.clave === 'b')?.lado).toBe('derecha');
    expect(r.find((x) => x.clave === 'a')?.rx).toBe(16);
    expect(r.find((x) => x.clave === 'b')?.rx).toBe(984);
  });

  it('ningún rótulo pisa a otro de su columna aunque todas las anclas estén a la misma altura', () => {
    const anclas = Array.from({ length: 9 }, (_, i) => ancla(`r${i}`, 200, 300));
    const r = repartirRotulos(anclas, { ancho: 1000, alto: 600, paso: 15 });
    expect(r).toHaveLength(9);
    for (const a of r) for (const b of r) if (a !== b) expect(sePisan(a, b, 15)).toBe(false);
    // Y el bloque queda centrado alrededor de la altura común, no colgando por abajo.
    const ys = r.map((x) => x.ry);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(16 + 7.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(600 - 16 - 7.5);
  });

  it('conserva el orden vertical de las anclas dentro de la columna', () => {
    const r = repartirRotulos([ancla('abajo', 100, 500), ancla('arriba', 100, 100), ancla('medio', 100, 300)], { ancho: 1000, alto: 600, paso: 14 });
    const orden = r.sort((a, b) => a.ry - b.ry).map((x) => x.clave);
    expect(orden).toEqual(['arriba', 'medio', 'abajo']);
  });

  it('si no caben todos en una columna, se quedan los de mayor prioridad', () => {
    const anclas = Array.from({ length: 30 }, (_, i) => ancla(`r${i}`, 100, 10 * i, i));
    const r = repartirRotulos(anclas, { ancho: 1000, alto: 200, paso: 14, margen: 10 });
    expect(r.length).toBeLessThan(30);
    expect(r.every((x) => x.prioridad >= 30 - r.length)).toBe(true);
  });

  it('con anclas fuera del lienzo o rotas los rótulos siguen dentro del lienzo', () => {
    const r = repartirRotulos([ancla('lejos', 100, -500), ancla('nan', Number.NaN, Number.NaN), ancla('fondo', 900, 5000)], { ancho: 1000, alto: 600, paso: 14 });
    for (const x of r) {
      expect(x.ry).toBeGreaterThanOrEqual(0);
      expect(x.ry).toBeLessThanOrEqual(600);
      expect(Number.isFinite(x.rx)).toBe(true);
    }
  });
});
