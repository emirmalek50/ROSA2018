// @vitest-environment jsdom
// El modelo de mundo con esqueleto (estándar de Emir, 19 de septiembre de
// 2026): al montar se ve la silueta (cabecera real con los filtros en gris y
// las tres columnas con tarjetas) con aria-busy y rótulo oculto; los hechos
// llegan en el fotograma siguiente. Un estado nuevo por el canal en vivo no
// vuelve a enseñar la silueta; cambiar de investigación sí.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import { ModeloDeMundo } from './ModeloDeMundo';

vi.mock('../datos/almacen', async (original) => ({ ...(await original<typeof import('../datos/almacen')>()), acciones: new Proxy({}, { get: () => () => undefined }) }));

beforeAll(() => {
  // Las secciones entran con `whileInView` (motion): jsdom no trae IntersectionObserver ni ResizeObserver.
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
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const espera = () => nodo.querySelector('[role="status"][aria-busy="true"]');
const rotulo = () => nodo.querySelector('[role="status"] .sr-only')?.textContent;
const hechos = () => nodo.querySelectorAll('.hecho').length;

describe('el esqueleto del modelo de mundo', () => {
  it('pinta la silueta de las tres columnas antes de calcular y los hechos un fotograma después', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    expect(espera()).not.toBeNull();
    expect(rotulo()).toBe('Cargando el modelo de mundo');
    expect(hechos()).toBe(0);
    // La cabecera y sus mandos son los reales, deshabilitados (miden lo mismo); las columnas, en gris con la forma de lo que llega.
    expect(nodo.querySelector('h2')?.textContent).toBe('Modelo de mundo');
    const filtros = nodo.querySelector('.filtros')!;
    expect(filtros.getAttribute('aria-hidden')).toBe('true');
    expect([...filtros.querySelectorAll('button, input, select')].every((m) => (m as HTMLButtonElement).disabled)).toBe(true);
    expect(filtros.querySelectorAll('button, input, select').length).toBe(4);
    expect(nodo.querySelectorAll('[data-esqueleto="seccion"]').length).toBe(3);
    expect(nodo.querySelectorAll('.mundo-columna').length).toBe(3);
    expect(nodo.querySelectorAll('.mundo-tarjetas .esqueleto-tarjeta').length).toBe(12);
    for (const bloque of nodo.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
    // Ningún "Cargando" visible: el rótulo va solo al lector de pantalla.
    expect(nodo.querySelector('.sr-only')?.textContent).toContain('Cargando');
    expect(nodo.textContent?.replace(nodo.querySelector('.sr-only')?.textContent ?? '', '')).not.toContain('Cargando');
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelectorAll('.esqueleto').length).toBe(0);
    expect(hechos()).toBeGreaterThan(0);
    expect(nodo.querySelector('select[aria-label="Tema"]')).not.toBeNull();
    expect(nodo.querySelectorAll('.mundo-columna').length).toBe(3);
    // Los textos nuevos llevan sus tildes y no hay guiones largos.
    expect(nodo.textContent).toContain('Qué cambió');
    expect(nodo.textContent).not.toContain('\u2014');
  });

  it('un estado nuevo por el canal en vivo conserva los hechos sin esqueleto, y la búsqueda sigue viva', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    const antes = hechos();
    const e2 = structuredClone(e);
    await act(async () => root.render(<ModeloDeMundo inv={e2.investigaciones[0]!} estado={e2} ahora={AHORA_MUESTRA} />));
    expect(espera()).toBeNull();
    expect(hechos()).toBe(antes);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(hechos()).toBe(antes);
    // Buscar filtra sin pasar por el esqueleto.
    const entrada = nodo.querySelector<HTMLInputElement>('input[aria-label="Buscar"]')!;
    const fijar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      fijar.call(entrada, 'zzzz-no-existe');
      entrada.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(espera()).toBeNull();
    expect(hechos()).toBe(0);
    expect(nodo.textContent).toContain('con este filtro');
  });

  it('al cambiar de investigación vuelve la silueta y después llegan los hechos de la nueva', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<ModeloDeMundo inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    const e2 = structuredClone(e);
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2', titulo: 'Otra investigación' };
    e2.investigaciones = [inv2];
    // Solo dos hechos pasan a la nueva investigación.
    for (const h of e2.hechos.slice(0, 2)) h.investigacionId = 'inv-2';
    await act(async () => root.render(<ModeloDeMundo inv={inv2} estado={e2} ahora={AHORA_MUESTRA} />));
    expect(espera()).not.toBeNull();
    expect(hechos()).toBe(0);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(hechos()).toBe(2);
  });
});
