// @vitest-environment jsdom
// La cola de hipótesis, ya fuera de su pantalla y dentro del ranking
// (1 de octubre de 2026). Lo que defienden estas pruebas:
//
// - La espera visible sigue siendo la de siempre (estándar de Emir, 19 de
//   septiembre de 2026): primero las tarjetas en gris, las filas al frame
//   siguiente, y al cambiar de investigación nunca se ven las filas de la
//   anterior.
// - Y lo nuevo: que «pendiente» quiera decir lo mismo en los tres sitios
//   donde se cuenta. Antes no: el contador del menú decía 5 y la lista
//   enseñaba 6, porque una contaba `aclarando` y la otra no.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ColaHipotesis } from './ColaHipotesis';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import { pendientesDeRevision } from '../lib/hipotesis';

let nodo: HTMLDivElement;
let root: Root;

beforeAll(() => {
  window.matchMedia = window.matchMedia || (((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia);
  // `Seccion` se revela al entrar en pantalla; jsdom no trae el observador.
  // Este dice que todo esta a la vista, que es lo que interesa medir aqui.
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
});

beforeEach(() => {
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});

afterEach(() => {
  act(() => root.unmount());
  nodo.remove();
});

function montar(e: EstadoRosa, vista: 'pendientes' | 'laboratorio' = 'pendientes', inv: Investigacion = e.investigaciones[0]!) {
  return act(async () => root.render(<ColaHipotesis inv={inv} estado={e} vista={vista} />));
}

/** El frame que separa la silueta del contenido (useCalculoDiferido). */
function esperarPintado() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

const filas = () => [...nodo.querySelectorAll('a.hip-fila')] as HTMLAnchorElement[];
const silueta = () => nodo.querySelector('.esqueleto-tarjetas');

function conOtraInvestigacion(): { e: EstadoRosa; invA: Investigacion; invB: Investigacion } {
  const e = estadoDeMuestra();
  const invA = e.investigaciones[0]!;
  const invB: Investigacion = { ...structuredClone(invA), id: 'inv-2', titulo: 'Otra investigación' };
  const propias = e.hipotesis.filter((h) => h.investigacionId === invA.id && (h.estado === 'propuesta' || h.estado === 'en_revision'));
  const hipsB = propias.map((h, i) => ({ ...structuredClone(h), id: `hip-b-${i}`, investigacionId: 'inv-2' }));
  return { e: { ...e, investigaciones: [...e.investigaciones, invB], hipotesis: [...e.hipotesis, ...hipsB] }, invA, invB };
}

describe('la espera visible de la cola', () => {
  it('el primer render son tarjetas en gris; las filas llegan al frame siguiente', async () => {
    await montar(estadoDeMuestra());
    expect(silueta(), 'la silueta de tarjetas').not.toBeNull();
    expect(filas()).toHaveLength(0);
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(filas().length).toBeGreaterThan(0);
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });

  it('cambiar de investigación vuelve a la silueta y nunca enseña las filas de la anterior', async () => {
    const { e, invA, invB } = conOtraInvestigacion();
    await montar(e, 'pendientes', invA);
    await esperarPintado();
    const hrefsA = filas().map((a) => a.getAttribute('href') ?? '');
    expect(hrefsA.length).toBeGreaterThan(0);
    expect(hrefsA.every((h) => h.includes(invA.id))).toBe(true);
    // El mismo contenido en un objeto de estado nuevo: la cola sigue, sin silueta.
    await montar(structuredClone(e), 'pendientes', invA);
    expect(silueta()).toBeNull();
    expect(filas()).toHaveLength(hrefsA.length);
    // Otra investigación: silueta un frame y después solo sus filas.
    await montar(e, 'pendientes', invB);
    expect(silueta()).not.toBeNull();
    expect(filas()).toHaveLength(0);
    await esperarPintado();
    const hrefsB = filas().map((a) => a.getAttribute('href') ?? '');
    expect(hrefsB.length).toBeGreaterThan(0);
    expect(hrefsB.every((h) => h.includes('inv-2'))).toBe(true);
    expect(hrefsB.some((h) => h.includes(invA.id))).toBe(false);
  });

  it('cada fila lleva a la ficha de su hipótesis, que no se movió de ruta', async () => {
    await montar(estadoDeMuestra());
    await esperarPintado();
    for (const a of filas()) {
      expect(a.getAttribute('href')).toMatch(/^#\/investigaciones\/[^/]+\/hipotesis\/[^/]+$/);
    }
  });
});

describe('«pendiente» quiere decir lo mismo en todas partes', () => {
  /** El estado de muestra con una hipótesis puesta en `aclarando`. */
  function conUnaAclarando(): { e: EstadoRosa; inv: Investigacion } {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const i = e.hipotesis.findIndex((h) => h.investigacionId === inv.id && h.estado === 'propuesta');
    expect(i, 'la muestra tiene alguna propuesta').toBeGreaterThanOrEqual(0);
    const hipotesis = e.hipotesis.map((h, k): Hipotesis => (k === i ? { ...h, estado: 'aclarando' } : h));
    return { e: { ...e, hipotesis }, inv };
  }

  it('las que ROSA2018 está aclarando no cuentan como pendientes, y se ven aparte', async () => {
    // Es el fallo que había: el filtro de la cola contaba `aclarando` y el
    // contador del menú no, así que el número del menú y el de filas no
    // coincidían. `aclarando` es lo que pasa al pulsar «no puedo juzgar»:
    // espera a ROSA2018, no a ti.
    const { e, inv } = conUnaAclarando();
    const suyas = e.hipotesis.filter((h) => h.investigacionId === inv.id);
    const cuenta = pendientesDeRevision(suyas);

    await montar(e, 'pendientes', inv);
    await esperarPintado();

    const seccion = [...nodo.querySelectorAll('section, .seccion')].find((s) => /est[áa] aclarando/i.test(s.textContent ?? ''));
    expect(seccion, 'el grupo de las que está aclarando').toBeTruthy();
    const enAclaracion = [...seccion!.querySelectorAll('a.hip-fila')];
    expect(enAclaracion).toHaveLength(1);

    // El primer grupo (las que te esperan) tiene exactamente las que cuenta
    // el menú: ni una más.
    expect(filas().length - enAclaracion.length).toBe(cuenta);
  });

  it('la que se está aclarando no desaparece: se ve, solo que en su grupo', async () => {
    // Lo contrario del fallo anterior sería esconderla. Sigue en pantalla.
    const { e, inv } = conUnaAclarando();
    await montar(e, 'pendientes', inv);
    await esperarPintado();
    const aclarando = e.hipotesis.find((h) => h.estado === 'aclarando' && h.investigacionId === inv.id)!;
    expect(filas().some((a) => (a.getAttribute('href') ?? '').endsWith(aclarando.id))).toBe(true);
  });
});

describe('lo que la fila dice de cada hipótesis', () => {
  it('una suspensión técnica se enseña como pendiente de juicio, no como una decisión', async () => {
    // "El juez no respondió" no es un veredicto: la decisión que se ve es la
    // anterior. Si la fila lo callara, parecería que el Killer ya juzgó.
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id && x.estado === 'propuesta')!;
    h.decisionKiller = 'suspender';
    h.killerPendiente = { intentos: 2, motivo: 'la respuesta no se pudo leer' };
    await montar(e, 'pendientes', inv);
    await esperarPintado();
    const fila = filas().find((f) => f.textContent?.includes(h.titulo))!;
    expect(fila, 'la fila de esa hipótesis').toBeTruthy();
    expect(fila.textContent).toContain('Pendiente de juicio: la respuesta no se pudo leer');
  });

  it('un hallazgo que el Killer ya retiró no se cuenta como abierto', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id && x.estado === 'propuesta' && x.hallazgos.every((y) => y.estado !== 'abierto'))!;
    h.hallazgos = [{ id: 'x1', tipo: 'conclusion_no_sigue', resumen: 'El Killer propone descartarla en este contexto', estado: 'abierto', detalle: '', respuestaDeRosa: '' } as unknown as (typeof h.hallazgos)[number]];
    h.decisionKiller = 'avanzar';
    await montar(e, 'pendientes', inv);
    await esperarPintado();
    const fila = filas().find((f) => f.textContent?.includes(h.titulo))!;
    expect(fila.textContent).not.toContain('hallazgo abierto');
  });
});

describe('la vista del laboratorio', () => {
  it('solo enseña lo que está en ese tramo', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await montar(e, 'laboratorio', inv);
    await esperarPintado();
    const enLab = e.hipotesis.filter((h) => h.investigacionId === inv.id && h.experimento && (h.experimento.estado !== 'propuesto' || h.candidata));
    if (enLab.length === 0) {
      expect(nodo.textContent).toMatch(/Nada en el laboratorio/i);
      return;
    }
    expect(filas()).toHaveLength(enLab.length);
  });

  it('sin nada en el tramo lo dice y explica cómo se llega, en vez de quedarse en blanco', async () => {
    const e = estadoDeMuestra();
    const inv: Investigacion = { ...structuredClone(e.investigaciones[0]!), id: 'inv-vacia' };
    await montar({ ...e, investigaciones: [...e.investigaciones, inv], hipotesis: [] }, 'laboratorio', inv);
    await esperarPintado();
    expect(nodo.textContent).toMatch(/Nada en el laboratorio/i);
    expect(nodo.querySelectorAll('li').length).toBeGreaterThan(0);
  });
});
