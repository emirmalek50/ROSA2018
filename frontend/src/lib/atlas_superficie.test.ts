import { describe, expect, it } from 'vitest';
import { superficieCerebral } from './atlas_superficie';

describe('Superficie ilustrativa del cerebro', () => {
  it('genera geometría finita, normales unitarias y ambos hemisferios', () => {
    const caras = superficieCerebral();
    expect(caras.length).toBeGreaterThan(1000);
    expect(caras.length).toBeLessThan(150000);
    let izquierda = false, derecha = false, tronco = false;
    for (const cara of caras) {
      expect(Math.hypot(cara.normal.x, cara.normal.y, cara.normal.z)).toBeCloseTo(1, 8);
      for (const p of cara.puntos) {
        if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error('Vértice no finito');
        izquierda ||= p.z < -150;
        derecha ||= p.z > 150;
        tronco ||= p.y > 230;
      }
    }
    expect(izquierda && derecha && tronco).toBe(true);
  });
});
