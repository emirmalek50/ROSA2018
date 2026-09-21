// @vitest-environment jsdom
// El arranque del árbol con esqueleto (estándar de Emir, 19 de septiembre de
// 2026): al montar se ve la silueta (cabecera real, marco con óvalo central,
// círculos unidos por líneas y panel derecho) con aria-busy y rótulo oculto;
// el lienzo llega en el fotograma siguiente, cuando el grafo está construido.
// Un estado nuevo por el canal en vivo no vuelve a enseñar la silueta, un
// árbol vacío no espera nada, y cambiar de investigación sí la enseña.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa } from '../datos/tipos';
import { Arbol, EsqueletoArbol } from './Arbol';

vi.mock('../datos/almacen', async (original) => ({ ...(await original<typeof import('../datos/almacen')>()), acciones: new Proxy({}, { get: () => () => undefined }) }));
// Movimiento reducido: la disposición se asienta en el efecto, sin bucle de fotogramas.
vi.mock('motion/react', async (original) => ({ ...(await original<typeof import('motion/react')>()), useReducedMotion: () => true }));

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
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
  localStorage.removeItem('rosa-arbol-vista');
});
/** Deja pasar el fotograma y el temporizador tras los que se construye el grafo. */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const espera = () => nodo.querySelector('[role="status"][aria-busy="true"]');
const rotulo = () => nodo.querySelector('[role="status"] .sr-only')?.textContent;

describe('el esqueleto del árbol', () => {
  it('pinta la silueta antes de construir el grafo y el lienzo un fotograma después, sin salto de cabecera', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Arbol inv={inv} estado={e} />));
    // La espera: aria-busy, rótulo para el lector de pantalla, nada de lienzo.
    expect(espera()).not.toBeNull();
    expect(rotulo()).toBe('Cargando el árbol de la investigación');
    expect(nodo.querySelector('canvas.grafo')).toBeNull();
    // La silueta tiene la forma del árbol: el marco real, un óvalo central, círculos, líneas y el panel derecho.
    expect(nodo.querySelector('.grafo-marco')).not.toBeNull();
    expect(nodo.querySelector('.grafo[data-esqueleto="arbol"]')).not.toBeNull();
    expect(nodo.querySelector('[data-esqueleto="tronco"] .esqueleto')).not.toBeNull();
    expect(nodo.querySelectorAll('[data-esqueleto="nodo"]').length).toBeGreaterThanOrEqual(10);
    expect(nodo.querySelectorAll('.grafo[data-esqueleto="arbol"] svg line').length).toBeGreaterThanOrEqual(10);
    expect(nodo.querySelector('.grafo-panel')).not.toBeNull();
    expect(nodo.querySelector('.grafo-tiempo')).not.toBeNull();
    // Los mandos de la cabecera son los reales, deshabilitados: miden lo mismo que con el árbol.
    const mandos = nodo.querySelector('.pantalla-cabecera .acciones')!;
    expect(mandos.getAttribute('aria-hidden')).toBe('true');
    expect(mandos.querySelectorAll('button, input').length).toBe(7);
    expect([...mandos.querySelectorAll('button, input')].every((m) => (m as HTMLButtonElement).disabled)).toBe(true);
    // La cabecera es la real (mismo texto, misma altura) y los bloques grises son decorativos.
    expect(nodo.querySelector('h2')?.textContent).toBe('Árbol de la investigación');
    const ayudaSilueta = nodo.querySelector('.pantalla-cabecera p')?.textContent;
    expect(ayudaSilueta).toContain('El objetivo es el tronco');
    for (const bloque of nodo.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
    expect(nodo.textContent).not.toContain('\u2014');
    // Un fotograma después: el lienzo, la misma ayuda, y ningún esqueleto.
    await esperarPintado();
    expect(nodo.querySelector('canvas.grafo')).not.toBeNull();
    expect(espera()).toBeNull();
    expect(nodo.querySelectorAll('.esqueleto').length).toBe(0);
    expect(nodo.querySelector('.pantalla-cabecera p')?.textContent).toBe(ayudaSilueta);
    expect(nodo.querySelector('.grafo-panel')?.textContent).toContain('Leyenda');
  });

  it('EsqueletoArbol, la silueta que App pinta al cambiar de pantalla, es la misma que pinta el árbol por dentro', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<EsqueletoArbol conexion={e.conexion} />));
    const deApp = nodo.innerHTML;
    expect(espera()).not.toBeNull();
    expect(rotulo()).toBe('Cargando el árbol de la investigación');
    await act(async () => root.render(<Arbol inv={e.investigaciones[0]!} estado={e} />));
    expect(nodo.innerHTML).toBe(deApp);
  });

  it('un estado nuevo por el canal en vivo no vuelve a enseñar la silueta: se conserva el árbol', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Arbol inv={inv} estado={e} />));
    await esperarPintado();
    const e2 = structuredClone(e);
    await act(async () => root.render(<Arbol inv={e2.investigaciones[0]!} estado={e2} />));
    expect(espera()).toBeNull();
    expect(nodo.querySelector('canvas.grafo')).not.toBeNull();
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelector('canvas.grafo')).not.toBeNull();
  });

  it('un árbol vacío no espera: explica qué pasará en el acto, sin esqueleto', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const vacio: EstadoRosa = { ...e, hipotesis: [], hechos: [] };
    await act(async () => root.render(<Arbol inv={inv} estado={vacio} />));
    expect(espera()).toBeNull();
    expect(nodo.querySelectorAll('.esqueleto').length).toBe(0);
    expect(nodo.textContent).toContain('El árbol todavía no tiene ramas');
  });

  it('al cambiar de investigación vuelve la silueta y después llega el árbol nuevo', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<Arbol inv={e.investigaciones[0]!} estado={e} />));
    await esperarPintado();
    const e2 = structuredClone(e);
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2', titulo: 'Otra investigación distinta' };
    e2.investigaciones = [inv2];
    for (const h of e2.hipotesis) h.investigacionId = 'inv-2';
    for (const h of e2.hechos) h.investigacionId = 'inv-2';
    for (const c of e2.corridas) c.investigacionId = 'inv-2';
    await act(async () => root.render(<Arbol inv={inv2} estado={e2} />));
    expect(espera()).not.toBeNull();
    expect(nodo.querySelector('canvas.grafo')).toBeNull();
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelector('canvas.grafo')?.getAttribute('aria-label')).toContain('Otra investigación distinta');
  });
});
