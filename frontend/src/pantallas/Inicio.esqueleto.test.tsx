// @vitest-environment jsdom
// El esqueleto del inicio (estándar de Emir, 19 de septiembre de 2026): con
// el estado sin cargar se pinta la silueta de tarjetas con aria-busy y su
// rótulo oculto; con el estado cargado las tarjetas salen en el mismo
// render, sin diferir (aquí no hay cálculo pesado ni cambio de investigación,
// y la pantalla también se renderiza en estático); y sin investigaciones sale
// el vacío, no una silueta.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa } from '../datos/tipos';
import { Inicio } from './Inicio';

vi.mock('../datos/almacen', () => ({ acciones: new Proxy({}, { get: () => () => undefined }), aplicar: () => undefined, cabeceras: () => ({}), modoActual: () => 'muestra', QUIEN: 'la persona responsable', avisar: () => undefined, conectar: async () => 'servidor' }));

beforeAll(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
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
});

const montar = (e: EstadoRosa) => act(async () => root.render(<Inicio estado={e} ahora={Date.now()} />));
const silueta = () => nodo.querySelector('.esqueleto-pantalla');

describe('el esqueleto del inicio', () => {
  it('con el estado sin cargar (conectando) pinta la silueta de tarjetas con aria-busy y rótulo oculto, y ninguna tarjeta real', async () => {
    await montar({ ...estadoDeMuestra(), conexion: 'conectando' });
    const s = silueta()!;
    expect(s).not.toBeNull();
    expect(s.classList.contains('esqueleto-pantalla-panel')).toBe(true);
    expect(s.getAttribute('aria-busy')).toBe('true');
    expect(s.getAttribute('role')).toBe('status');
    expect(s.querySelector('.sr-only')?.textContent).toBe('Cargando las investigaciones');
    expect(s.querySelectorAll('.inicio-rejilla .tarjeta').length).toBe(Math.max(3, estadoDeMuestra().investigaciones.length));
    expect(nodo.querySelector('.inicio-tarjeta')).toBeNull();
    // La cabecera real (título y descripción) ya está en la silueta: mide lo mismo que la que llega.
    expect(s.querySelector('h2')?.textContent).toBe('Investigaciones');
    expect(nodo.querySelector('a.btn')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(silueta()).not.toBeNull();
  });

  it('con el estado cargado las tarjetas salen en el mismo render, sin silueta ni aria-busy', async () => {
    const e = estadoDeMuestra();
    await montar(e);
    expect(silueta()).toBeNull();
    expect(nodo.querySelectorAll('.inicio-tarjeta')).toHaveLength(e.investigaciones.length);
    expect(nodo.querySelector('h2')?.textContent).toBe('Investigaciones');
    expect(nodo.querySelector('[aria-busy="true"]')).toBeNull();
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });

  it('en estático (renderToStaticMarkup, sin efectos) también salen las tarjetas: el inicio no depende de un frame posterior', () => {
    const e = estadoDeMuestra();
    const html = renderToStaticMarkup(<Inicio estado={e} ahora={Date.now()} />);
    expect(html).toContain('inicio-tarjeta');
    expect(html).not.toContain('esqueleto-pantalla');
    const sinCargar = renderToStaticMarkup(<Inicio estado={{ ...e, conexion: 'conectando' }} ahora={Date.now()} />);
    expect(sinCargar).toContain('esqueleto-pantalla');
    expect(sinCargar).not.toContain('inicio-tarjeta');
  });

  it('sin investigaciones y con el estado cargado sale el vacío con sus pasos, no una silueta', async () => {
    const e: EstadoRosa = { ...estadoDeMuestra(), conexion: 'en_linea', investigaciones: [] };
    await montar(e);
    expect(silueta()).toBeNull();
    expect(nodo.textContent).toContain('Todavía no hay investigaciones');
  });
});
