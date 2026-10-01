// @vitest-environment jsdom
// Los esqueletos y los botones en vuelo de la cola de hipótesis y de la ficha
// (estándar de Emir, 19 de septiembre de 2026): la cola pinta primero su
// silueta de lista y las filas llegan al frame siguiente; cambiar de
// investigación vuelve a la silueta (nunca se enseñan las filas de la
// anterior) y un empuje del estado con la misma investigación no; la ficha
// abre con su silueta y al volver a la cola no hay silueta porque la cola ya
// estaba calculada; y los botones que hablan con el servidor (decisiones,
// dossier, asignar a laboratorio) quedan marcados y deshabilitados mientras
// la promesa no resuelve y vuelven al terminar.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { Hipotesis } from './Hipotesis';

const { llamadas, vuelo } = vi.hoisted(() => {
  const llamadas: unknown[][] = [];
  let resolver: () => void = () => undefined;
  const vuelo = {
    promesa: null as Promise<void> | null,
    retener() {
      vuelo.promesa = new Promise<void>((r) => {
        resolver = r;
      });
    },
    soltar() {
      resolver();
      vuelo.promesa = null;
    },
  };
  return { llamadas, vuelo };
});
vi.mock('../datos/almacen', () => ({
  acciones: new Proxy(
    {},
    {
      get:
        (_t, nombre) =>
        (...args: unknown[]) => {
          llamadas.push([String(nombre), ...args]);
          return vuelo.promesa;
        },
    },
  ),
  aplicar: () => undefined,
  cabeceras: () => ({}),
  modoActual: () => 'muestra',
  QUIEN: 'la persona responsable',
  avisar: () => undefined,
  conectar: async () => 'servidor',
}));

beforeAll(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  llamadas.length = 0;
  vuelo.promesa = null;
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
async function soltarYEsperar() {
  await act(async () => {
    vuelo.soltar();
    await new Promise((r) => setTimeout(r, 0));
  });
}
function montar(e: EstadoRosa, id: string | null, inv: Investigacion = e.investigaciones[0]!) {
  return act(async () => root.render(<Hipotesis inv={inv} estado={e} ahora={Date.now()} detalleId={id} cajonAbierto={false} setCajonAbierto={() => undefined} />));
}
/** La muestra tiene una sola investigación: se fabrica una segunda con dos
 *  hipótesis pendientes propias, para probar el cambio de investigación. */
const silueta = () => nodo.querySelector('.esqueleto-pantalla');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const pulsar = (b: HTMLButtonElement) => act(async () => b.click());
const de = (nombre: string) => llamadas.filter((l) => l[0] === nombre);
function escribir(el: HTMLInputElement | HTMLTextAreaElement, texto: string) {
  return act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, texto);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('la silueta de la ficha', () => {
  it('abre con la silueta de ficha, al frame siguiente pinta la hipótesis, y otra ficha vuelve a empezar', async () => {
    const e = estadoDeMuestra();
    await montar(e, 'hip-1');
    const s = silueta()!;
    expect(s.classList.contains('esqueleto-pantalla-ficha')).toBe(true);
    expect(s.querySelector('.sr-only')?.textContent).toBe('Cargando la hipótesis');
    expect(nodo.textContent).not.toContain('Volver al ranking');
    await esperarPintado();
    expect(silueta()).toBeNull();
    // Desde el 1 de octubre de 2026 la lista vive en el ranking, así que el
    // «volver» de la ficha lleva allí y no a una cola propia.
    expect(nodo.textContent).toContain('Volver al ranking');
    expect(nodo.querySelector('h2')?.textContent).toBe(e.hipotesis.find((h) => h.id === 'hip-1')!.titulo);
    // Otra hipótesis: silueta un frame y después su título.
    await montar(e, 'hip-2');
    expect(silueta()).not.toBeNull();
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(nodo.querySelector('h2')?.textContent).toBe(e.hipotesis.find((h) => h.id === 'hip-2')!.titulo);
  });

  it('un id que no existe en esta investigación lo dice, en vez de enseñar otra cosa', async () => {
    // Antes esto caía en la cola, que ya no vive aquí. Un enlace viejo o una
    // hipótesis borrada tienen que decirse.
    await montar(estadoDeMuestra(), 'hip-que-no-existe');
    await esperarPintado();
    expect(nodo.textContent).toMatch(/no está en esta investigación/i);
    expect(nodo.querySelector('a.enlace')?.getAttribute('href')).toMatch(/\/ranking$/);
  });
});

describe('los botones en vuelo de la ficha', () => {
  it('Pedir que la refine queda marcado y deshabilitado, bloquea las demás decisiones, ignora el segundo clic y vuelve al terminar', async () => {
    await montar(estadoDeMuestra(), 'hip-1');
    await esperarPintado();
    vuelo.retener();
    const refinar = boton('Pedir que la refine')!;
    expect(refinar).toBeDefined();
    await pulsar(refinar);
    expect(de('revisarHipotesis')).toHaveLength(1);
    expect(de('revisarHipotesis')[0]![2]).toBe('refinar');
    expect(refinar.getAttribute('data-en-vuelo')).toBe('true');
    expect(refinar.getAttribute('aria-busy')).toBe('true');
    expect(refinar.disabled).toBe(true);
    expect(boton('Aceptar')!.disabled).toBe(true);
    expect(boton('Descartar')!.disabled).toBe(true);
    expect(boton('No puedo juzgar')!.disabled).toBe(true);
    await pulsar(refinar);
    expect(de('revisarHipotesis')).toHaveLength(1);
    await soltarYEsperar();
    expect(boton('Pedir que la refine')!.disabled).toBe(false);
    expect(boton('Pedir que la refine')!.hasAttribute('data-en-vuelo')).toBe(false);
    expect(boton('Aceptar')!.disabled).toBe(false);
    expect(boton('Descartar')!.disabled).toBe(false);
  });

  it('Descartar sigue mandando la decisión con su motivo por el mismo camino', async () => {
    await montar(estadoDeMuestra(), 'hip-1');
    await esperarPintado();
    await pulsar(boton('Descartar')!);
    await escribir(nodo.querySelector('.confirmacion textarea') as HTMLTextAreaElement, 'Se apoya en un artículo retractado');
    const confirmar = [...nodo.querySelectorAll('.confirmacion button')].find((b) => b.textContent?.trim() === 'Descartar') as HTMLButtonElement;
    await pulsar(confirmar);
    const llamada = de('revisarHipotesis')[0]!;
    expect(llamada[1]).toBe('hip-1');
    expect(llamada[2]).toBe('descartar');
    expect(llamada[3]).toBe('Se apoya en un artículo retractado');
  });

  it('Generar dossier usa la promesa y después espera a que el dossier llegue por el canal en vivo: un segundo clic no manda otro', async () => {
    const e: EstadoRosa = { ...estadoDeMuestra(), conexion: 'en_linea' };
    await montar(e, 'hip-1');
    await esperarPintado();
    vuelo.retener();
    const generar = boton('Generar dossier')!;
    expect(generar.disabled).toBe(false);
    await pulsar(generar);
    expect(de('generarDossier')).toEqual([['generarDossier', 'hip-1']]);
    expect(generar.getAttribute('data-en-vuelo')).toBe('true');
    expect(generar.disabled).toBe(true);
    expect(nodo.textContent).toContain('Esperando al servidor');
    await pulsar(generar);
    expect(de('generarDossier')).toHaveLength(1);
    // La promesa del POST resuelve, pero el dossier todavía no ha llegado: sigue en vuelo.
    await soltarYEsperar();
    expect(boton('Generar dossier')!.disabled).toBe(true);
    expect(boton('Generar dossier')!.getAttribute('data-en-vuelo')).toBe('true');
    // Llega el artefacto por el canal en vivo (la hipótesis apunta a él): el botón aterriza y cambia a "Regenerar".
    const e2: EstadoRosa = { ...e, hipotesis: e.hipotesis.map((h) => (h.id === 'hip-1' ? { ...h, dossierArtefactoId: 'art-dossier-nuevo' } : h)) };
    await montar(e2, 'hip-1');
    await esperarPintado();
    const regenerar = boton('Regenerar dossier')!;
    expect(regenerar).toBeDefined();
    expect(regenerar.disabled).toBe(false);
    expect(regenerar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(nodo.textContent).not.toContain('Esperando al servidor');
  });

  it('Asignar a laboratorio se marca en vuelo con el laboratorio escrito y vuelve al terminar', async () => {
    await montar(estadoDeMuestra(), 'hip-4');
    await esperarPintado();
    const entrada = nodo.querySelector('input[aria-label="Laboratorio"]') as HTMLInputElement;
    expect(entrada).not.toBeNull();
    const asignar = boton('Asignar a laboratorio')!;
    expect(asignar.disabled).toBe(true);
    await escribir(entrada, 'FLENI');
    expect(asignar.disabled).toBe(false);
    vuelo.retener();
    await pulsar(asignar);
    expect(de('asignarExperimento')).toEqual([['asignarExperimento', 'hip-4', 'FLENI']]);
    expect(asignar.getAttribute('data-en-vuelo')).toBe('true');
    expect(asignar.disabled).toBe(true);
    await soltarYEsperar();
    expect(boton('Asignar a laboratorio')!.disabled).toBe(false);
  });

  it('adversario: con acciones que no devuelven promesa (como hoy almacen.ts) Aceptar no se queda atascado', async () => {
    await montar(estadoDeMuestra(), 'hip-1');
    await esperarPintado();
    const aceptar = boton('Aceptar')!;
    expect(aceptar.disabled).toBe(false);
    await pulsar(aceptar);
    expect(de('revisarHipotesis')[0]![2]).toBe('aceptar');
    expect(boton('Aceptar')!.disabled).toBe(false);
    expect(boton('Aceptar')!.hasAttribute('data-en-vuelo')).toBe(false);
  });
});
