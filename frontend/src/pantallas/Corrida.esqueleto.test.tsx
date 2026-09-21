// @vitest-environment jsdom
// Los esqueletos y los botones en vuelo de la pantalla de la corrida
// (estándar de Emir, 19 de septiembre de 2026): el primer render es la
// silueta del panel con aria-busy y su rótulo oculto, el contenido llega al
// frame siguiente sin dejar rastro de la silueta, un empuje del estado con la
// misma corrida no vuelve a enseñarla (y una corrida nueva sí), y los botones
// que hablan con el servidor (pausar, reanudar, detener, aprobar el plan,
// exportar PRISMA) quedan marcados y deshabilitados mientras la promesa no
// resuelve y vuelven al terminar, también cuando la acción no devuelve
// promesa, que es lo que hace hoy almacen.ts.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { iteracionActualDe } from '../datos/acciones';
import { estadoDeMuestra } from '../datos/muestra';
import type { Corrida as CorridaTipo, EstadoRosa } from '../datos/tipos';
import { Corrida } from './Corrida';

const { llamadas, vuelo } = vi.hoisted(() => {
  const llamadas: unknown[][] = [];
  let resolver: () => void = () => undefined;
  const vuelo = {
    /** Lo que devuelven las acciones: null (como hoy almacen.ts) o una promesa retenida. */
    promesa: null as Promise<void> | null,
    /** Las acciones siguientes devuelven una promesa que no resuelve hasta soltar(). */
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

/** Deja pasar el frame (rAF en jsdom corre cada 16 ms) y el temporizador que viene detrás. */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** Deja que la promesa retenida termine y que el botón se desmarque. */
async function soltarYEsperar() {
  await act(async () => {
    vuelo.soltar();
    await new Promise((r) => setTimeout(r, 0));
  });
}
function laCorrida(estado: EstadoRosa): CorridaTipo {
  const inv = estado.investigaciones[0]!;
  return estado.corridas.filter((c) => c.investigacionId === inv.id).sort((x, y) => y.numero - x.numero)[0]!;
}
function conCorrida(estado: EstadoRosa, cambios: Partial<CorridaTipo>): EstadoRosa {
  const id = laCorrida(estado).id;
  return { ...estado, corridas: estado.corridas.map((c) => (c.id === id ? { ...c, ...cambios } : c)) };
}
async function pintar(estado: EstadoRosa) {
  const inv = estado.investigaciones[0]!;
  await act(async () => root.render(<Corrida inv={inv} estado={estado} ahora={Date.now()} irA={() => undefined} />));
}
const silueta = () => nodo.querySelector('.esqueleto-pantalla');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const pulsar = (b: HTMLButtonElement) => act(async () => b.click());
const de = (nombre: string) => llamadas.filter((l) => l[0] === nombre);

describe('la silueta de la corrida', () => {
  it('el primer render es la silueta del panel con aria-busy y rótulo oculto; el contenido llega al frame siguiente y la silueta desaparece', async () => {
    await pintar(estadoDeMuestra());
    const s = silueta()!;
    expect(s).not.toBeNull();
    expect(s.classList.contains('esqueleto-pantalla-panel')).toBe(true);
    expect(s.getAttribute('aria-busy')).toBe('true');
    expect(s.getAttribute('role')).toBe('status');
    expect(s.querySelector('.sr-only')?.textContent).toBe('Cargando la corrida');
    // La cabecera de la silueta lleva el título real ("Corrida N") y la fila de estado en gris,
    // sin ningún chip real, para medir lo mismo que la cabecera que llega.
    expect(s.querySelector('.pantalla-cabecera h2')?.textContent).toMatch(/^Corrida \d+/);
    expect(s.querySelector('.pantalla-cabecera')?.getAttribute('style')).toContain('margin-top: 16px');
    expect(s.querySelector('.corrida-estado')).not.toBeNull();
    expect(s.querySelector('.corrida-estado .chip')).toBeNull();
    expect(s.querySelectorAll('.corrida-estado .esqueleto').length).toBeGreaterThan(2);
    // Las tarjetas de la silueta usan la clase real de la maqueta: no hay salto al llegar el contenido.
    expect(s.querySelectorAll('.tarjeta').length).toBeGreaterThan(0);
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(nodo.querySelector('.pantalla-cabecera h2')?.textContent).toMatch(/^Corrida \d+/);
    expect([...nodo.querySelectorAll('.sr-only')].some((x) => x.textContent === 'Cargando la corrida')).toBe(false);
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });

  it('con el estado sin cargar (conectando) se queda en la silueta aunque pase el frame', async () => {
    await pintar({ ...estadoDeMuestra(), conexion: 'conectando' });
    await esperarPintado();
    expect(silueta()).not.toBeNull();
    expect(silueta()!.querySelector('.sr-only')?.textContent).toBe('Cargando la corrida');
    expect(silueta()!.querySelector('h2')?.textContent).toMatch(/^Corrida \d+/);
    expect(nodo.querySelector('.corrida-estado .chip')).toBeNull();
  });

  it('sin corridas no hay silueta: el vacío con sus pasos sale en el primer render', async () => {
    const base = estadoDeMuestra();
    const inv = base.investigaciones[0]!;
    await pintar({ ...base, corridas: base.corridas.filter((c) => c.investigacionId !== inv.id) });
    expect(silueta()).toBeNull();
    expect(nodo.textContent).toContain('no tiene corridas');
  });

  it('un empuje del estado con la misma corrida no vuelve a la silueta; una corrida nueva la enseña un frame', async () => {
    const base = estadoDeMuestra();
    await pintar(base);
    await esperarPintado();
    expect(silueta()).toBeNull();
    // El mismo id de corrida en un objeto de estado nuevo (lo que llega por el canal en vivo).
    await pintar(structuredClone(base));
    expect(silueta()).toBeNull();
    expect(nodo.querySelector('.pantalla-cabecera h2')).not.toBeNull();
    // Una corrida nueva (número mayor) monta CorridaViva otra vez: silueta un frame y luego su cabecera.
    const c = laCorrida(base);
    await pintar({ ...base, corridas: [...base.corridas, { ...structuredClone(c), id: 'corrida-nueva', numero: c.numero + 1 }] });
    expect(silueta()).not.toBeNull();
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(nodo.querySelector('.pantalla-cabecera h2')?.textContent).toContain(`Corrida ${c.numero + 1}`);
  });
});

describe('los botones en vuelo de la corrida', () => {
  it('Pausar queda marcado y deshabilitado mientras la promesa no resuelve, comparte marca con Detener, ignora el segundo clic y vuelve al terminar', async () => {
    await pintar(conCorrida(estadoDeMuestra(), { estado: 'en_marcha' }));
    await esperarPintado();
    vuelo.retener();
    const pausar = boton('Pausar')!;
    expect(pausar).toBeDefined();
    expect(pausar.hasAttribute('data-en-vuelo')).toBe(false);
    await pulsar(pausar);
    expect(de('pausarCorrida')).toHaveLength(1);
    expect(pausar.getAttribute('data-en-vuelo')).toBe('true');
    expect(pausar.getAttribute('aria-busy')).toBe('true');
    expect(pausar.disabled).toBe(true);
    expect(boton('Detener')!.disabled).toBe(true);
    await pulsar(pausar);
    expect(de('pausarCorrida')).toHaveLength(1);
    await soltarYEsperar();
    const despues = boton('Pausar')!;
    expect(despues.hasAttribute('data-en-vuelo')).toBe(false);
    expect(despues.hasAttribute('aria-busy')).toBe(false);
    expect(despues.disabled).toBe(false);
    expect(boton('Detener')!.disabled).toBe(false);
  });

  it('adversario: una acción que no devuelve promesa (como hoy almacen.ts) no deja Reanudar atascado', async () => {
    await pintar(conCorrida(estadoDeMuestra(), { estado: 'pausada' }));
    await esperarPintado();
    const reanudar = boton('Reanudar')!;
    await pulsar(reanudar);
    expect(de('reanudarCorrida')).toHaveLength(1);
    const despues = boton('Reanudar')!;
    expect(despues.disabled).toBe(false);
    expect(despues.hasAttribute('data-en-vuelo')).toBe(false);
  });

  it('Detener pasa por el envoltorio: la confirmación manda detenerCorrida con el motivo y la vigilancia', async () => {
    await pintar(conCorrida(estadoDeMuestra(), { estado: 'en_marcha' }));
    await esperarPintado();
    await pulsar(boton('Detener')!);
    const textarea = nodo.querySelector('.confirmacion textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'hay que revisar la cola');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirmar = [...nodo.querySelectorAll('.confirmacion button')].find((b) => b.textContent?.trim() === 'Detener') as HTMLButtonElement;
    await pulsar(confirmar);
    const llamada = de('detenerCorrida')[0]!;
    expect(llamada[2]).toBe('hay que revisar la cola');
    expect(llamada[3]).toBe(30);
  });

  it('Aprobar plan pasa por el envoltorio: la tarjeta del plan lleva aria-busy mientras vuela y el segundo clic se ignora', async () => {
    const base = estadoDeMuestra();
    const c = laCorrida(base);
    const actual = iteracionActualDe(base, c)!;
    expect(actual).toBeTruthy();
    const estado: EstadoRosa = { ...conCorrida(base, { estado: 'esperando_aprobacion' }), iteraciones: base.iteraciones.map((i) => (i.id === actual.id ? { ...i, planAprobado: false, terminadaEn: null } : i)) };
    await pintar(estado);
    await esperarPintado();
    const aprobar = boton('Aprobar plan y ejecutar')!;
    expect(aprobar).toBeDefined();
    const tarjeta = aprobar.closest('.tarjeta')!;
    expect(tarjeta.hasAttribute('aria-busy')).toBe(false);
    vuelo.retener();
    await pulsar(aprobar);
    expect(de('aprobarPlan')).toEqual([['aprobarPlan', actual.id]]);
    expect(tarjeta.getAttribute('aria-busy')).toBe('true');
    await pulsar(aprobar);
    expect(de('aprobarPlan')).toHaveLength(1);
    await soltarYEsperar();
    expect(tarjeta.hasAttribute('aria-busy')).toBe(false);
  });

  it('Exportar PRISMA usa la promesa real de la acción: marcado y deshabilitado hasta que resuelve', async () => {
    await pintar(estadoDeMuestra());
    await esperarPintado();
    // La sección "Búsqueda de la corrida" es de detalle y nace plegada en modo
    // sencillo; sus acciones solo se pintan abierta.
    const plegar = [...nodo.querySelectorAll('button.seccion-plegar')].find((b) => b.textContent?.includes('Búsqueda de la corrida')) as HTMLButtonElement;
    expect(plegar).toBeDefined();
    await pulsar(plegar);
    vuelo.retener();
    const exportar = boton('Exportar PRISMA 2020')!;
    expect(exportar).toBeDefined();
    await pulsar(exportar);
    expect(de('exportarPrisma')).toHaveLength(1);
    expect(exportar.getAttribute('data-en-vuelo')).toBe('true');
    expect(exportar.disabled).toBe(true);
    await soltarYEsperar();
    const despues = boton('Exportar PRISMA 2020')!;
    expect(despues.disabled).toBe(false);
    expect(despues.hasAttribute('data-en-vuelo')).toBe(false);
  });
});
