import { describe, expect, it } from 'vitest';
import { CORRILLOS_A_LA_VEZ, DURACION_CORRILLO, seQuedaEnSuMesa, siguienteRelevo } from './despues';

describe('después del trabajo', () => {
  it('el Juez, el Killer y tú no os levantáis; los demás sí', () => {
    expect(seQuedaEnSuMesa('Juez')).toBe(true);
    expect(seQuedaEnSuMesa('Killer')).toBe(true);
    expect(seQuedaEnSuMesa('Tú')).toBe(true);
    expect(seQuedaEnSuMesa('Juez del torneo')).toBe(false);
    expect(seQuedaEnSuMesa('Explorador')).toBe(false);
  });

  it('hay charlas a la vez, pero pocas, y duran un rato de verdad', () => {
    // Con una sola no se nota; con diez no parece que nadie trabaje ahí. Y una
    // charla de tres segundos es un roce, no un corrillo.
    expect(CORRILLOS_A_LA_VEZ).toBeGreaterThan(1);
    expect(CORRILLOS_A_LA_VEZ).toBeLessThan(7);
    expect(DURACION_CORRILLO).toBeGreaterThan(8);
  });

  it('los relevos van rápido mientras faltan corrillos y se espacian después', () => {
    const faltan = Array.from({ length: 200 }, (_, i) => siguienteRelevo(() => (i % 100) / 100, 0, true));
    const llenos = Array.from({ length: 200 }, (_, i) => siguienteRelevo(() => (i % 100) / 100, 0, false));
    expect(Math.min(...faltan)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...faltan)).toBeLessThanOrEqual(7);
    expect(Math.min(...llenos)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...llenos)).toBeLessThanOrEqual(26);
    // Y cuenta desde ahora, no desde cero.
    expect(siguienteRelevo(() => 0, 100, false)).toBe(112);
  });
});
