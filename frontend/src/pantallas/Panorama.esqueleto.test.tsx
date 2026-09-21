// @vitest-environment jsdom
// El panorama con esqueleto (estándar de Emir, 19 de septiembre de 2026):
// al montar se ve la silueta de panel (EsqueletoPantalla) con aria-busy y
// rótulo oculto; el contenido llega en el fotograma siguiente. El botón de
// exportar Specific Aims va en vuelo mientras arma el fichero y un segundo
// clic no duplica ni el artefacto ni la descarga.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import { Panorama } from './Panorama';

const llamadas = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: new Proxy(
    {},
    {
      get: (_objetivo, nombre: string) => {
        if (!llamadas.has(nombre)) llamadas.set(nombre, vi.fn(() => 'art-x'));
        return llamadas.get(nombre);
      },
    },
  ),
}));

let clicEnlace: ReturnType<typeof vi.spyOn>;
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
  // jsdom no tiene URL.createObjectURL ni navega: la descarga se comprueba por el clic en el enlace.
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:rosa';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  llamadas.clear();
  clicEnlace = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  clicEnlace.mockRestore();
});
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const espera = () => nodo.querySelector('[role="status"][aria-busy="true"]');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('el esqueleto del panorama', () => {
  it('pinta la silueta de panel antes de calcular y el panorama un fotograma después', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Panorama inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    const silueta = espera();
    expect(silueta).not.toBeNull();
    expect(silueta!.classList.contains('esqueleto-pantalla-panel')).toBe(true);
    expect(silueta!.querySelector('.sr-only')?.textContent).toBe('Cargando el panorama de la investigación');
    // La cabecera real (título y descripción) ya está en la silueta, con su margen; las direcciones, en gris.
    expect(silueta!.querySelector('h2')?.textContent).toBe('Panorama de la investigación');
    expect(silueta!.querySelector('.pantalla-cabecera')?.getAttribute('style')).toContain('margin-top: 16px');
    expect(nodo.querySelector('.direccion')).toBeNull();
    const direcciones = e.corridas.filter((c) => c.investigacionId === inv.id).sort((a, b) => b.numero - a.numero)[0]!.panorama.length;
    expect(silueta!.querySelectorAll('.seccion .tarjeta').length).toBe(Math.min(8, direcciones));
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelector('h2')?.textContent).toBe('Panorama de la investigación');
    expect(nodo.textContent).toContain('por qué y qué investigar');
    expect(nodo.textContent).toContain('primero al investigador clínico principal');
    expect(nodo.textContent).not.toContain('\u2014');
  });

  it('un estado nuevo por el canal en vivo no vuelve a enseñar la silueta; otra investigación sí', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<Panorama inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    const e2 = structuredClone(e);
    await act(async () => root.render(<Panorama inv={e2.investigaciones[0]!} estado={e2} ahora={AHORA_MUESTRA} />));
    expect(espera()).toBeNull();
    expect(nodo.querySelector('h2')?.textContent).toBe('Panorama de la investigación');
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2' };
    await act(async () => root.render(<Panorama inv={inv2} estado={e2} ahora={AHORA_MUESTRA} />));
    expect(espera()).not.toBeNull();
    await esperarPintado();
    expect(espera()).toBeNull();
    // Sin hipótesis en la nueva investigación no hay nada que exportar.
    expect(boton('Exportar como Specific Aims').disabled).toBe(true);
  });

  it('exportar Specific Aims va en vuelo mientras arma el fichero y un segundo clic no duplica nada', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Panorama inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    const exportar = boton('Exportar como Specific Aims');
    expect(exportar.disabled).toBe(false);
    expect(exportar.hasAttribute('data-en-vuelo')).toBe(false);
    await pulsar(exportar);
    // En vuelo: el atributo que el CSS convierte en spinner, y aria-busy para el lector.
    expect(exportar.getAttribute('data-en-vuelo')).toBe('true');
    expect(exportar.getAttribute('aria-busy')).toBe('true');
    await pulsar(exportar); // repetido mientras vuela: se ignora
    await esperarPintado();
    expect(exportar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(exportar.hasAttribute('aria-busy')).toBe(false);
    expect(llamadas.get('guardarArtefacto')).toHaveBeenCalledTimes(1);
    expect(llamadas.get('guardarArtefacto')).toHaveBeenCalledWith(inv.id, 'specific-aims.md', 'specific_aims', expect.stringContaining('Specific Aims'), 'Generado desde el panorama', expect.any(Number));
    expect(clicEnlace).toHaveBeenCalledTimes(1);
  });
});
