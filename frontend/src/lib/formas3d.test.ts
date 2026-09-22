import { describe, expect, it } from 'vitest';
import { cajaDe, esfera, gota, revolucion, tubo, volumenConSigno } from './formas3d';

const normalesUnitarias = (n: Float32Array) => {
  for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)).toBeCloseTo(1, 4);
};
const indicesEnRango = (f: { indices: Uint32Array; posiciones: Float32Array }) => {
  const nv = f.posiciones.length / 3;
  for (const i of f.indices) expect(i).toBeLessThan(nv);
  expect(f.indices.length % 3).toBe(0);
};

describe('los cuerpos generados para la escena del cerebro', () => {
  it('la esfera tiene el radio pedido, el centro pedido y el volumen de una esfera con los triángulos hacia fuera', () => {
    const e = esfera(12, [10, -20, 30], 24, 48);
    indicesEnRango(e);
    normalesUnitarias(e.normales);
    expect(cajaDe(e).map((v) => Math.round(v))).toEqual([-2, -32, 18, 22, -8, 42]);
    const v = volumenConSigno(e);
    expect(v).toBeGreaterThan(0);
    // Una esfera de caras planas pesa algo menos que la redonda: menos de un 2 %.
    expect(Math.abs(v - (4 / 3) * Math.PI * 12 ** 3) / ((4 / 3) * Math.PI * 12 ** 3)).toBeLessThan(0.02);
  });

  it('la gota es más alta que ancha, acaba en punta arriba y es un cuerpo cerrado orientado hacia fuera', () => {
    const g = gota(14, [0, 0, 0]);
    indicesEnRango(g);
    normalesUnitarias(g.normales);
    const c = cajaDe(g);
    expect(c[3] - c[0]).toBeCloseTo(28, 0);
    expect(c[4] - c[1]).toBeCloseTo(42, 0);
    // La punta: en la altura máxima el radio es cero.
    let radioArriba = 0;
    for (let i = 0; i < g.posiciones.length; i += 3) if (g.posiciones[i + 1]! > c[4] - 0.01) radioArriba = Math.max(radioArriba, Math.hypot(g.posiciones[i]!, g.posiciones[i + 2]!));
    expect(radioArriba).toBeLessThan(0.01);
    expect(volumenConSigno(g)).toBeGreaterThan(0);
  });

  it('el tubo sigue la curva, tiene el grosor pedido y queda cerrado por los extremos', () => {
    const curva: [number, number, number][] = [];
    // Una S suave: el radio de curvatura queda por encima del grosor del tubo,
    // que si no se pisaría a sí mismo en las vueltas.
    for (let i = 0; i <= 30; i++) curva.push([i * 3, Math.sin(i / 12) * 20, 0]);
    const t = tubo(curva, 5, 16);
    indicesEnRango(t);
    normalesUnitarias(t.normales);
    const c = cajaDe(t);
    // El primer anillo es perpendicular a la curva, que arranca inclinada, así
    // que no llega a x = -5 exacto; el grosor en z, donde la curva es plana, sí.
    expect(c[0]).toBeLessThan(0);
    expect(c[3]).toBeGreaterThan(90);
    expect(c[5] - c[2]).toBeCloseTo(10, 0);
    // Cerrado: el volumen es el de un cilindro de esa longitud, más o menos.
    const largo = curva.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - curva[i - 1]![0], p[1] - curva[i - 1]![1]) : 0), 0);
    expect(volumenConSigno(t)).toBeGreaterThan(0);
    expect(Math.abs(volumenConSigno(t) - Math.PI * 25 * largo) / (Math.PI * 25 * largo)).toBeLessThan(0.06);
  });

  it('con entradas rotas devuelve formas vacías o utilizables, nunca NaN', () => {
    expect(tubo([[0, 0, 0]], 3).indices.length).toBe(0);
    expect(revolucion([[0, 0], [1, 1]], 1).indices.length).toBe(0);
    const e = esfera(Number.NaN, [Number.NaN, 0, 0]);
    expect(Array.from(e.posiciones).every((v) => Number.isFinite(v))).toBe(true);
    expect(cajaDe({ posiciones: new Float32Array(0), normales: new Float32Array(0), indices: new Uint32Array(0) })).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
