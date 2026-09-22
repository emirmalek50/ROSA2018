import { describe, expect, it } from 'vitest';
import { colocarRotulos, sePisan, type Ancla } from './rotulos3d';

const ancla = (clave: string, x: number, y: number, prioridad = 1, ancho = 90): Ancla => ({ clave, texto: clave, x, y, ancho, alto: 16, prioridad });
const OP = { ancho: 1000, alto: 620, centroX: 500, centroY: 310 };

describe('la colocación de los nombres junto a las estructuras', () => {
  it('cada rótulo queda pegado a su ancla, hacia fuera del centro del cerebro, con la guía corta', () => {
    const r = colocarRotulos([ancla('derecha', 700, 310), ancla('arriba', 500, 150), ancla('izquierda', 300, 310)], OP);
    expect(r).toHaveLength(3);
    const der = r.find((x) => x.clave === 'derecha')!;
    expect(der.cx).toBeGreaterThan(700);
    expect(Math.hypot(der.gx - der.x, der.gy - der.y)).toBeLessThan(30);
    const izq = r.find((x) => x.clave === 'izquierda')!;
    expect(izq.cx + izq.ancho).toBeLessThan(300);
    const arr = r.find((x) => x.clave === 'arriba')!;
    expect(arr.cy + arr.alto).toBeLessThan(150);
  });

  it('dos rótulos con anclas casi iguales no se pisan: el segundo se aleja por su radio', () => {
    const r = colocarRotulos([ancla('a', 700, 300, 2), ancla('b', 704, 306, 1)], OP);
    expect(r).toHaveLength(2);
    expect(sePisan(r[0]!, r[1]!)).toBe(false);
    const b = r.find((x) => x.clave === 'b')!;
    // El de menor prioridad es el que se ha alejado, pero sigue cerca.
    expect(Math.hypot(b.gx - b.x, b.gy - b.y)).toBeGreaterThan(18);
    expect(Math.hypot(b.gx - b.x, b.gy - b.y)).toBeLessThan(160);
  });

  it('con muchas anclas apiñadas ninguno se pisa, caben la mayoría rodeando el cúmulo y la de mayor prioridad siempre entra', () => {
    const anclas = Array.from({ length: 24 }, (_, i) => ancla(`r${i}`, 600 + (i % 3) * 5, 300 + Math.floor(i / 3) * 4, i));
    const r = colocarRotulos(anclas, OP);
    for (const a of r) for (const b of r) if (a !== b) expect(sePisan(a, b)).toBe(false);
    expect(r.length).toBeGreaterThanOrEqual(12);
    expect(r.some((x) => x.clave === 'r23')).toBe(true);
    // Todos siguen cerca de lo que nombran: a menos de doscientos píxeles del ancla.
    for (const x of r) expect(Math.hypot(x.gx - x.x, x.gy - x.y)).toBeLessThan(200);
  });

  it('los rótulos no se salen del lienzo aunque el ancla esté en el borde', () => {
    const r = colocarRotulos([ancla('borde', 995, 5), ancla('esquina', 3, 615)], OP);
    for (const x of r) {
      expect(x.cx).toBeGreaterThanOrEqual(0);
      expect(x.cx + x.ancho).toBeLessThanOrEqual(1000);
      expect(x.cy).toBeGreaterThanOrEqual(0);
      expect(x.cy + x.alto).toBeLessThanOrEqual(620);
    }
  });

  it('un ancla rota se descarta y el resto sigue', () => {
    const r = colocarRotulos([ancla('nan', Number.NaN, 10), ancla('bien', 700, 300)], OP);
    expect(r.map((x) => x.clave)).toEqual(['bien']);
  });
});
