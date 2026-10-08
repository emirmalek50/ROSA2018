import { describe, expect, it } from 'vitest';
import { elegirOcio, levantaLaVista, llenadoDeCaja, luzPorHora, mezcla, miradaAlCruzarse, nivelDePila, parpadeo, siguienteOcio } from './vida';

describe('la luz según la hora real', () => {
  it('de día no tiñe; al atardecer sube el ámbar; de noche azul con lámparas; al amanecer vuelve', () => {
    expect(luzPorHora(12)).toEqual({ tinte: '#000000', alfa: 0, lamparas: false, tramo: 'dia' });
    expect(luzPorHora(17, 0).alfa).toBe(0);
    expect(luzPorHora(18, 0).alfa).toBeCloseTo(0.1, 1);
    expect(luzPorHora(19, 30).tinte).toBe(mezcla('#FFB27A', '#1B2A6B', 0.5));
    expect(mezcla('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(luzPorHora(18, 29).lamparas).toBe(false);
    expect(luzPorHora(18, 31).lamparas).toBe(true);
    expect(luzPorHora(19, 59).tramo).toBe('tarde');
    expect(luzPorHora(23)).toMatchObject({ tramo: 'noche', lamparas: true, alfa: 0.3 });
    expect(luzPorHora(3).tramo).toBe('noche');
    expect(luzPorHora(6, 0).alfa).toBe(0.3);
    expect(luzPorHora(7, 0)).toMatchObject({ tramo: 'amanecer', alfa: 0.15, lamparas: false });
    expect(luzPorHora(8, 0).tramo).toBe('dia');
  });
  it('no salta a en punto: entre un minuto y el siguiente la diferencia es pequeña', () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 30, 59]) {
      const a = luzPorHora(h, m), b = luzPorHora(m === 59 ? (h + 1) % 24 : h, m === 59 ? 0 : m + 1);
      expect(Math.abs(a.alfa - b.alfa)).toBeLessThan(0.02);
    }
  });
  it('aguanta horas raras', () => {
    expect(luzPorHora(-1).tramo).toBe('noche');
    expect(luzPorHora(25).tramo).toBe('noche');
    expect(luzPorHora(12, 400).tramo).toBe('dia');
  });
});

describe('el ocio de quien no trabaja', () => {
  it('quien está sentado no se gira ni se levanta a por café en el sitio; la cafetera solo si la sala tiene', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 400; i++) vistos.add(elegirOcio(() => (i * 0.37) % 1, { sentado: true, cafetera: false }).k);
    expect(vistos).toEqual(new Set(['estira', 'mira', 'rasca', 'hojea']));
    const dePie = new Set<string>();
    for (let i = 0; i < 400; i++) dePie.add(elegirOcio(() => (i * 0.37) % 1, { sentado: false, cafetera: false }).k);
    expect(dePie.has('cafetera')).toBe(false);
    expect(dePie.has('gira')).toBe(true);
    const conMaquina = elegirOcio(() => 0.1, { sentado: false, cafetera: true });
    expect(conMaquina).toEqual({ k: 'cafetera', dur: 7 });
  });
  it('la cafetera es una de cada cinco veces, no un desfile', () => {
    let idas = 0;
    for (let i = 0; i < 1000; i++) if (elegirOcio(() => ((i * 7919) % 1000) / 1000, { sentado: false, cafetera: true }).k === 'cafetera') idas++;
    expect(idas).toBeGreaterThan(150);
    expect(idas).toBeLessThan(260);
  });
  it('el siguiente movimiento llega entre 8 y 34 segundos, y más a menudo pronto que tarde', () => {
    const esperas = Array.from({ length: 1000 }, (_, i) => siguienteOcio(() => ((i * 7919) % 1000) / 1000, 100) - 100);
    expect(Math.min(...esperas)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...esperas)).toBeLessThanOrEqual(34);
    expect(esperas.filter((e) => e < 21).length).toBeGreaterThan(esperas.filter((e) => e >= 21).length);
  });
});

describe('los montones que crecen con las cifras', () => {
  it('la pila es logarítmica: 12 es un folleto, 1.761 una torre, y sin cifra nada', () => {
    expect(nivelDePila(null)).toBe(0);
    expect(nivelDePila(0)).toBe(0);
    expect(nivelDePila(12)).toBeGreaterThan(0.3);
    expect(nivelDePila(12)).toBeLessThan(0.4);
    expect(nivelDePila(1761)).toBeGreaterThan(0.95);
    expect(nivelDePila(10_000)).toBe(1);
  });
  it('las cajas se comparan entre sí y la más llena rebosa si pasa de cien', () => {
    expect(llenadoDeCaja(734, 734)).toEqual({ hojas: 9, rebosa: true });
    expect(llenadoDeCaja(22, 734).hojas).toBeLessThan(6);
    expect(llenadoDeCaja(22, 734).hojas).toBeGreaterThan(2);
    expect(llenadoDeCaja(1, 734).hojas).toBe(1);
    expect(llenadoDeCaja(0, 734)).toEqual({ hojas: 0, rebosa: false });
    expect(llenadoDeCaja(40, 40)).toEqual({ hojas: 9, rebosa: false });
    // Nunca más hojas que afirmaciones.
    expect(llenadoDeCaja(3, 3)).toEqual({ hojas: 3, rebosa: false });
  });
});

describe('se ven entre ellos', () => {
  it('al cruzarse, el quieto mira hacia el que pasa; de lejos, no', () => {
    expect(miradaAlCruzarse({ x: 130, y: 400 }, { x: 100, y: 404 })).toBe(1);
    expect(miradaAlCruzarse({ x: 70, y: 400 }, { x: 100, y: 404 })).toBe(-1);
    expect(miradaAlCruzarse({ x: 160, y: 400 }, { x: 100, y: 404 })).toBe(0);
    expect(miradaAlCruzarse({ x: 120, y: 480 }, { x: 100, y: 404 })).toBe(0);
  });
  it('quien está sentado levanta la vista si pasan por delante de su mesa, no por detrás', () => {
    expect(levantaLaVista({ x: 440, y: 50 }, { x: 480, y: 100 })).toBe(1);
    expect(levantaLaVista({ x: 440, y: 50 }, { x: 400, y: 100 })).toBe(-1);
    expect(levantaLaVista({ x: 440, y: 50 }, { x: 480, y: 40 })).toBe(0);
    expect(levantaLaVista({ x: 440, y: 50 }, { x: 600, y: 100 })).toBe(0);
  });
  it('el fluorescente casi siempre está a tope y a veces baja un instante', () => {
    let bajones = 0;
    for (let t = 0; t < 600; t += 0.016) if (parpadeo(t) < 1) bajones++;
    expect(bajones).toBeGreaterThan(20);
    expect(bajones).toBeLessThan(600 / 0.016 * 0.05);
    // Dos lámparas con semilla distinta no bajan a la vez.
    let aLaVez = 0, bajan = 0;
    for (let t = 0; t < 600; t += 0.016) { const a = parpadeo(t, 0) < 1, b = parpadeo(t, 3) < 1; if (a) bajan++; if (a && b) aLaVez++; }
    expect(aLaVez).toBeLessThan(bajan / 4);
  });
});
