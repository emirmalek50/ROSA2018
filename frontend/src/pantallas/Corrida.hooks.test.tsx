// @vitest-environment jsdom
// Arrancar la primera corrida de una investigación pasaba la pantalla de
// "sin corridas" a "corrida 1" en el mismo componente, con más hooks que en
// el render anterior, y React fallaba ("Rendered more hooks than during the
// previous render"). Emir lo vio al lanzar una corrida real, 15 de septiembre
// de 2026. Este test hace esa transición sobre la misma raíz y exige que no
// se lance nada.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { ConsultaBusqueda, EstadoRosa } from '../datos/tipos';
import { Corrida } from './Corrida';

vi.mock('../datos/almacen', () => ({ acciones: new Proxy({}, { get: () => () => undefined }) }));

beforeAll(() => {
  // Lo que jsdom no trae y el navegador sí (igual que en App.cliente.test.tsx).
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

/** Deja pasar el frame y el temporizador que viene detrás: desde el 19 de
 *  septiembre de 2026 la pantalla pinta primero su silueta (esqueleto) y el
 *  contenido llega tras el siguiente pintado (lib/diferido.ts). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

describe('la pantalla de la corrida', () => {
  it('actualiza búsquedas, consumo y fase con un nuevo estado del servidor sin remontar la corrida', async () => {
    const base = estadoDeMuestra();
    const inv = { ...base.investigaciones[0]!, condicionParada: '2 iteraciones', mision: null };
    const corrida = base.corridas.find((c) => c.investigacionId === inv.id)!;
    const actual = base.iteraciones.find((i) => i.corridaId === corrida.id)!;
    const plan = [{ ...actual.plan[0]!, id: 'busqueda-real', tipo: 'literatura', estado: 'en_curso' as const, titulo: 'Buscar evidencia de tau' }];
    const q: ConsultaBusqueda = { base: 'PubMed', consulta: 'MAPT', tema: 'Patología de tau', fecha: Date.now(), resultados: 87, iteracion: 1, pistaId: 'pista-real' };
    const itActual = { ...actual, numero: 1, plan, planAprobado: true, terminadaEn: null, pistas: [{ ...actual.pistas[0]!, id: 'pista-real', pasoId: 'busqueda-real', estado: 'en_curso' as const, fuente: 'PubMed', titulo: 'Patología de tau', resumen: '87 resultados en PubMed; 30 para cribar', transcripcion: [{ t: 1000, tipo: 'resultado' as const, texto: '87 resultados en PubMed; 30 para cribar' }] }] };
    const real: EstadoRosa = { ...base, conexion: 'en_linea', investigaciones: [inv], corridas: [{ ...corrida, estado: 'en_marcha', iteracionActual: 1, empezadaEn: Date.now(), parada: null, gasto: { ...corrida.gasto, llamadas: 20, segundos: 1, usd: 6.5, usdReal: 1 }, progreso: [], busqueda: { ...corrida.busqueda, consultas: [q] } }], iteraciones: [itActual], solicitudes: [], incidencias: [] };
    const pintar = async (estado: EstadoRosa) => {
      await act(async () => root.render(<Corrida inv={inv} estado={estado} ahora={Date.now()} irA={() => undefined} />));
      await esperarPintado(100);
    };
    await pintar(real);
    const busquedas = () => nodo.querySelector('.esc-busquedas')!;
    expect(busquedas().textContent).toContain('Todas · 1');
    expect(busquedas().textContent).toContain('87');
    expect(busquedas().textContent).toContain('?');
    expect(nodo.querySelector('.esc-parada')?.textContent).toContain('0 de 2');
    const pausada: EstadoRosa = { ...real, corridas: [{ ...real.corridas[0]!, estado: 'pausada_por_presupuesto', gasto: { ...real.corridas[0]!.gasto, llamadas: 30 }, busqueda: { ...real.corridas[0]!.busqueda, consultas: [{ ...q, relevantes: 12, textoCompleto: 4 }] } }], iteraciones: [{ ...itActual, pistas: [{ ...itActual.pistas[0]!, estado: 'detenida', resumen: 'Presupuesto agotado' }] }] };
    await pintar(pausada);
    expect(busquedas().querySelectorAll('.esc-fila')).toHaveLength(1);
    expect(busquedas().textContent).toContain('12');
    expect(busquedas().textContent).not.toContain('?');
    expect(nodo.querySelector('.esc-gasto-llamadas b')?.textContent).toBe('30');
    expect(nodo.querySelector('.esc-tramo-it-cabecera')?.textContent).toContain('Pausada');
    expect(nodo.querySelectorAll('.esc-actor-activo')).toHaveLength(0);
    expect(nodo.querySelector('.esc-directo')?.textContent).toBe('en pausa');
    expect(nodo.querySelector('.presupuesto')?.textContent).not.toContain('Al ritmo actual');
    await pintar({ ...pausada, corridas: [{ ...pausada.corridas[0]!, estado: 'detenida', terminadaEn: Date.now() }] });
    expect(nodo.querySelector('.esc-tramo-it-cabecera')?.textContent).toContain('Detenida');
    expect(nodo.querySelectorAll('.esc-tramo-futuro')).toHaveLength(0);
    expect(nodo.querySelector('.presupuesto')?.textContent).not.toContain('Al ritmo actual');
  });

  it('pasa de "sin corridas" a "corrida 1" sin romper las reglas de los hooks', async () => {
    const base = estadoDeMuestra();
    const inv = base.investigaciones[0]!;
    const sinCorridas: EstadoRosa = { ...base, corridas: base.corridas.filter((c) => c.investigacionId !== inv.id) };
    const errores: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errores.push(args);
    try {
      await act(async () => root.render(<Corrida inv={inv} estado={sinCorridas} ahora={Date.now()} irA={() => undefined} />));
      expect(nodo.textContent).toContain('no tiene corridas');
      await act(async () => root.render(<Corrida inv={inv} estado={base} ahora={Date.now()} irA={() => undefined} />));
      await esperarPintado();
      expect(nodo.textContent).not.toContain('no tiene corridas');
      expect(nodo.textContent).toContain('Corrida');
      await act(async () => root.render(<Corrida inv={inv} estado={sinCorridas} ahora={Date.now()} irA={() => undefined} />));
      expect(nodo.textContent).toContain('no tiene corridas');
    } finally {
      console.error = original;
    }
    const conHooks = errores.filter((e) => JSON.stringify(e).includes('hooks'));
    expect(conHooks).toEqual([]);
  });

  it('mientras espera a una persona lo dice junto al reloj y no cuenta el tiempo de pared; con factura del gateway la enseña', async () => {
    const base = estadoDeMuestra();
    const inv = base.investigaciones[0]!;
    const corrida = base.corridas.find((c) => c.investigacionId === inv.id)!;
    const esperando = { ...base, corridas: base.corridas.map((c) => (c.id === corrida.id ? { ...c, estado: 'esperando_plan' as const, empezadaEn: Date.now() - 3_600_000, gasto: { ...c.gasto, segundos: 90, usd: 26.79, usdReal: 12.71 } } : c)) };
    await act(async () => root.render(<Corrida inv={inv} estado={esperando} ahora={Date.now()} irA={() => undefined} />));
    await esperarPintado();
    expect(nodo.textContent).toContain('en espera de una persona');
    expect(nodo.textContent).toContain('1 min 30 s de trabajo');
    expect(nodo.textContent).not.toContain('1 h de trabajo');
    expect(nodo.textContent).toContain('12,71 USD');
    expect(nodo.textContent).toMatch(/facturados? por el gateway/);
    expect(nodo.textContent).toContain('26,79 USD');
    const enMarcha = { ...esperando, corridas: esperando.corridas.map((c) => (c.id === corrida.id ? { ...c, estado: 'en_marcha' as const, esperaHumanaMs: 3_500_000, gasto: { ...c.gasto, usdReal: undefined } } : c)) };
    await act(async () => root.render(<Corrida inv={inv} estado={enMarcha} ahora={Date.now()} irA={() => undefined} />));
    expect(nodo.textContent).not.toContain('en espera de una persona');
    // 1 h de pared menos 3500 s de espera: unos 100 s de trabajo, no una hora.
    expect(nodo.textContent).toMatch(/1 min 4\d s de trabajo/);
    expect(nodo.textContent).toContain('estimados por tokens');
  });
});
