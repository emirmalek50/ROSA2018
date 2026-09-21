// @vitest-environment jsdom
// La ficha de la investigación con esqueleto (estándar de Emir, 19 de
// septiembre de 2026): al montar se ve la silueta de ficha (EsqueletoPantalla)
// con aria-busy y rótulo oculto; el contenido llega en el fotograma siguiente.
// Las cuatro tarjetas del programa salen en esqueleto mientras una corrida en
// marcha no ha cerrado ninguna iteración y no hay datos; con datos, o cuando
// ya cerró alguna, cada tarjeta enseña lo suyo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import type { CifrasAprendizaje, EstadoRosa } from '../datos/tipos';
import { Investigacion } from './Investigacion';

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
const esperasPrograma = () => nodo.querySelectorAll('.programa [role="status"][aria-busy="true"]');
const irA = () => undefined;
/** El estado de muestra con una sola corrida en marcha que aún no cerró ninguna iteración. */
function estadoAlEmpezar(): EstadoRosa {
  const e = estadoDeMuestra();
  e.corridas = [{ ...e.corridas[0]!, estado: 'en_marcha', iteracionActual: 1 }];
  return e;
}

describe('el esqueleto de la investigación', () => {
  it('pinta la silueta de ficha antes de calcular y la ficha un fotograma después', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Investigacion inv={inv} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
    const silueta = espera();
    expect(silueta).not.toBeNull();
    expect(silueta!.classList.contains('esqueleto-pantalla-ficha')).toBe(true);
    expect(silueta!.querySelector('.sr-only')?.textContent).toBe('Cargando la investigación');
    // El título real ya está en la silueta (mide lo mismo que la cabecera que llega); el resto, gris.
    expect(silueta!.querySelector('h2')?.textContent).toBe(inv.titulo);
    expect(nodo.querySelector('.quetoca')).toBeNull();
    expect(silueta!.querySelectorAll('.rejilla-2 .tarjeta').length).toBe(2);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelector('h2')?.textContent).toBe(inv.titulo);
    expect(nodo.querySelector('.quetoca')).not.toBeNull();
    expect(nodo.textContent).not.toContain('\u2014');
  });

  it('con la corrida de muestra (ya cerró iteraciones) las tarjetas del programa no esperan: cada una dice lo suyo', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<Investigacion inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
    await esperarPintado();
    expect(esperasPrograma().length).toBe(0);
    expect(nodo.querySelectorAll('.programa .esqueleto').length).toBe(0);
    expect(nodo.querySelector('.cifras-ap')?.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(nodo.querySelector('.mapa-ruta')?.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(nodo.querySelector('.mapa-enf')?.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(nodo.querySelector('.dsp')?.textContent).toContain('El registro está vacío');
  });

  it('con una corrida en marcha que aún no cerró ninguna iteración, las cuatro tarjetas salen en esqueleto con su forma', async () => {
    const e = estadoAlEmpezar();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Investigacion inv={inv} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
    await esperarPintado();
    expect(esperasPrograma().length).toBe(4);
    const rotulos = [...esperasPrograma()].map((x) => x.querySelector('.sr-only')?.textContent);
    expect(rotulos).toEqual(['Cargando las cifras de aprendizaje', 'Cargando el mapa de la ruta terapéutica', 'Cargando el mapa de la enfermedad', 'Cargando los datasets del programa']);
    // La tarjeta conserva su clase (mide lo mismo), su título visible y dice cuándo llega; los bloques grises tienen la forma del contenido.
    for (const clase of ['cifras-ap', 'mapa-ruta', 'mapa-enf', 'dsp']) {
      const tarjeta = nodo.querySelector(`.programa .${clase}`)!;
      expect(tarjeta.classList.contains('tarjeta')).toBe(true);
      expect(tarjeta.querySelector('h3')?.textContent).toBeTruthy();
      expect(tarjeta.textContent).toContain('ROSA2018 lo calcula al cerrar la iteración en curso.');
      expect(tarjeta.querySelectorAll('.esqueleto').length).toBeGreaterThan(0);
    }
    expect(nodo.querySelector('.programa .cifras-ap h3')?.textContent).toBe('Aprendizaje');
    expect(nodo.querySelector('.programa .mapa-ruta .esqueleto-filas')).not.toBeNull();
    expect(nodo.querySelector('.programa .mapa-enf .esqueleto-texto')).not.toBeNull();
    for (const bloque of nodo.querySelectorAll('.programa .esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
  });

  it('una corrida detenida o terminada en la iteración 1, o ninguna corrida, no dejan nada en espera', async () => {
    for (const corridas of [[{ ...estadoDeMuestra().corridas[0]!, estado: 'detenida' as const, iteracionActual: 1 }], [{ ...estadoDeMuestra().corridas[0]!, estado: 'terminada' as const, iteracionActual: 1 }], []]) {
      const e = estadoDeMuestra();
      e.corridas = corridas;
      await act(async () => root.render(<Investigacion inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
      await esperarPintado();
      expect(esperasPrograma().length, `corridas: ${corridas.map((c) => c.estado).join(',') || 'ninguna'}`).toBe(0);
      expect(nodo.querySelector('.cifras-ap')?.textContent).toContain('Se calcula al cerrar la primera iteración');
    }
    // Una corrida que espera a una persona antes de cerrar la primera (plan sin aprobar, pausa,
    // presupuesto) no es una carga: nadie calcula nada hasta que la persona actúe, así que las
    // tarjetas no brillan y una nota dice el motivo.
    for (const [estado, motivo] of [
      ['esperando_aprobacion', 'espera tu aprobación del plan'],
      ['pausada_por_presupuesto', 'se pausó por presupuesto'],
      ['pausada', 'está pausada'],
    ] as const) {
      const e = estadoDeMuestra();
      e.corridas = [{ ...e.corridas[1]!, estado: 'terminada', iteracionActual: 9 }, { ...e.corridas[0]!, estado, iteracionActual: 1 }];
      await act(async () => root.render(<Investigacion inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
      await esperarPintado();
      expect(esperasPrograma().length, estado).toBe(0);
      expect(nodo.querySelector('.esqueleto-nota')?.textContent).toContain('Las cuatro piezas se calculan al cerrar la primera iteración');
      expect(nodo.querySelector('.esqueleto-nota')?.textContent).toContain(motivo);
      expect(nodo.querySelector('.cifras-ap')?.textContent).toContain('Se calcula al cerrar la primera iteración');
    }
    // Y con el bucle proponiendo el plan o sondeando a un modelo caído sí hay espera de verdad.
    for (const estado of ['esperando_plan', 'esperando_modelo'] as const) {
      const e = estadoDeMuestra();
      e.corridas = [{ ...e.corridas[0]!, estado, iteracionActual: 1 }];
      await act(async () => root.render(<Investigacion inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
      await esperarPintado();
      expect(esperasPrograma().length, estado).toBe(4);
      expect(nodo.querySelector('.esqueleto-nota')).toBeNull();
    }
  });

  it('en cuanto una pieza tiene datos deja el esqueleto aunque las demás sigan esperando', async () => {
    const e = estadoAlEmpezar();
    const inv = { ...e.investigaciones[0]!, cifrasAprendizaje: { texto: 'Ninguna predicción prerregistrada todavía.' } as unknown as CifrasAprendizaje };
    e.investigaciones = [inv];
    e.datasetsPrograma = [{ id: 'dsp-1', fuente: 'geo', identificador: 'GSE1', titulo: 'Un conjunto', investigaciones: [inv.id], actualizadoEn: AHORA_MUESTRA } as unknown as NonNullable<EstadoRosa['datasetsPrograma']>[number]];
    await act(async () => root.render(<Investigacion inv={inv} estado={e} ahora={AHORA_MUESTRA} irA={irA} />));
    await esperarPintado();
    expect(esperasPrograma().length).toBe(2);
    expect(nodo.querySelector('.programa .cifras-ap')?.textContent).toContain('Ninguna predicción prerregistrada todavía.');
    expect(nodo.querySelector('.programa .cifras-ap .esqueleto')).toBeNull();
    expect(nodo.querySelector('.programa .dsp .esqueleto')).toBeNull();
    expect(nodo.querySelector('.programa .mapa-ruta .esqueleto')).not.toBeNull();
    expect(nodo.querySelector('.programa .mapa-enf .esqueleto')).not.toBeNull();
  });
});
