// @vitest-environment jsdom
// La pantalla de Ajustes montada de verdad (createRoot y act, como
// Ranking.test.tsx) dentro de la puerta de acceso, con el servidor simulado.
// El bloque de sesión (correo, si la cuenta administra la instalación y el
// botón "Cerrar sesión") vive aquí, en la sección "Sesión", y ya no en la
// barra lateral (18 de septiembre de 2026). Cerrar sesión sigue llamando a
// /api/acceso/salir y volviendo a la raíz, igual que antes del traslado.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Acceso } from '../componentes/Acceso';
import { BarraLateral } from '../componentes/BarraLateral';
import { estadoDeMuestra } from '../datos/muestra';
import { Ajustes } from './Ajustes';

const { llamadas } = vi.hoisted(() => ({ llamadas: vi.fn() }));

vi.mock('../datos/almacen', () => ({
  // Cada acción devuelve una promesa que no resuelve: los bloques que piden
  // datos al servidor (integridad, espejo) se quedan en "cargando" y no
  // estorban a la sección Sesión, que no depende de ellos.
  acciones: new Proxy({}, { get: (_, nombre) => (...args: unknown[]) => { llamadas(nombre, ...args); return new Promise(() => undefined); } }),
  aplicar: () => undefined,
  cabeceras: () => ({ 'X-Rosa': '1', 'Content-Type': 'application/json' }),
  modoActual: () => 'muestra',
  QUIEN: 'la persona responsable',
  avisar: () => undefined,
  conectar: vi.fn().mockResolvedValue('servidor'),
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
  llamadas.mockClear();
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.unstubAllGlobals();
});

const CORREO = 'emir.malek@alzheimerproject.com';

/** Un servidor de mentira: /api/acceso/estado devuelve la sesión indicada y
 *  todo lo demás responde vacío y bien. Devuelve el espía para inspeccionarlo. */
type Respuesta = { ok: boolean; json: () => Promise<unknown> };
function servidorFalso(administrador: boolean) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Respuesta>>(async (url) => {
    const u = String(url);
    if (u.endsWith('/api/acceso/estado')) return { ok: true, json: async () => ({ correo: CORREO, administrador, correoConfigurado: false, instalacionLocal: false }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function montarConSesion(administrador: boolean) {
  const fetch = servidorFalso(administrador);
  const asignar = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign: asignar, hash: '', pathname: '/', search: '' });
  await act(async () => root.render(<Acceso><Ajustes estado={estadoDeMuestra()} ahora={Date.now()} /></Acceso>));
  return { fetch, asignar };
}

const titulos = () => [...nodo.querySelectorAll('.seccion-titulo h3')].map((h) => h.textContent?.trim() ?? '');
const botonSalir = () => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cerrar sesión') ?? null;

describe('la sección Sesión de Ajustes', () => {
  it('muestra el correo, que la cuenta administra la instalación y el botón de cerrar sesión', async () => {
    await montarConSesion(true);
    expect(titulos().some((t) => t.startsWith('Sesión'))).toBe(true);
    expect(nodo.textContent).toContain(CORREO);
    expect(nodo.textContent).toContain('Cuenta administradora');
    expect(nodo.textContent).not.toContain('sin permisos de administración');
    expect(botonSalir()).not.toBeNull();
  });

  it('dice cuando la cuenta no administra la instalación', async () => {
    await montarConSesion(false);
    expect(nodo.textContent).toContain(CORREO);
    expect(nodo.textContent).toContain('sin permisos de administración');
    expect(nodo.textContent).not.toContain('Cuenta administradora');
  });

  it('va antes que el resto de secciones, para que se encuentre sin bajar', async () => {
    await montarConSesion(true);
    const t = titulos();
    const sesion = t.findIndex((x) => x.startsWith('Sesión'));
    const autonomia = t.findIndex((x) => x.startsWith('Autonomía'));
    expect(sesion).toBeGreaterThanOrEqual(0);
    expect(autonomia).toBeGreaterThan(sesion);
  });

  it('cerrar sesión llama a /api/acceso/salir por POST y vuelve a la raíz', async () => {
    const { fetch, asignar } = await montarConSesion(true);
    const boton = botonSalir();
    expect(boton).not.toBeNull();
    await act(async () => {
      boton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    const salida = fetch.mock.calls.find((c) => String(c[0]).endsWith('/api/acceso/salir'));
    expect(salida).toBeDefined();
    expect(salida![1]?.method).toBe('POST');
    expect(asignar).toHaveBeenCalledWith('/');
  });

  it('si el servidor no deja salir, avisa y no recarga', async () => {
    const fetch = servidorFalso(true);
    fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/api/acceso/estado')) return { ok: true, json: async () => ({ correo: CORREO, administrador: true, correoConfigurado: false, instalacionLocal: false }) };
      if (u.endsWith('/api/acceso/salir')) return { ok: false, json: async () => ({ detail: 'Sin conexión' }) };
      return { ok: true, json: async () => ({}) };
    });
    const asignar = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: asignar, hash: '', pathname: '/', search: '' });
    await act(async () => root.render(<Acceso><Ajustes estado={estadoDeMuestra()} ahora={Date.now()} /></Acceso>));
    await act(async () => {
      botonSalir()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(nodo.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cerrar la sesión');
    expect(asignar).not.toHaveBeenCalled();
  });

  it('sin sesión no pinta la sección ni el botón', async () => {
    servidorFalso(true);
    await act(async () => root.render(<Ajustes estado={estadoDeMuestra()} ahora={Date.now()} />));
    expect(titulos().some((t) => t.startsWith('Sesión'))).toBe(false);
    expect(botonSalir()).toBeNull();
    expect(nodo.textContent).not.toContain(CORREO);
  });
});

describe('la barra lateral tras el traslado', () => {
  it('conserva el enlace a Ajustes y la frase de pie, y ya no lleva el bloque de sesión', async () => {
    await act(async () => root.render(<BarraLateral estado={estadoDeMuestra()} ruta={{ tipo: 'ajustes' }} abierta={false} onCerrar={() => undefined} onBuscar={() => undefined} />));
    expect(nodo.textContent).toContain('Ajustes');
    expect(nodo.textContent).toContain('ROSA2018 investiga; la persona decide.');
    expect(nodo.textContent).not.toContain('Cerrar sesión');
    expect(nodo.querySelector('.cuenta-actual')).toBeNull();
    expect(nodo.querySelector('a[href="#/ajustes"]')?.getAttribute('aria-current')).toBe('page');
  });
});

describe('navegación del espacio de ajustes', () => {
  const tab = (id: string) => nodo.querySelector<HTMLButtonElement>(`#ajuste-tab-${id}`)!;
  const panel = (id: string) => nodo.querySelector<HTMLElement>(`#ajuste-panel-${id}`)!;
  const pulsar = async (el: HTMLElement) => act(async () => el.click());

  it('muestra una sola categoría y permite llegar a todas con el teclado', async () => {
    await montarConSesion(false);
    expect(panel('general').hidden).toBe(false);
    expect(nodo.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    await act(async () => tab('general').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(tab('seguridad'));
    expect(panel('general').hidden).toBe(true);
    expect(panel('seguridad').hidden).toBe(false);
    await act(async () => tab('seguridad').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(tab('general'));
    for (const id of ['autonomia', 'memoria', 'avisos', 'herramientas', 'seguridad']) {
      await pulsar(tab(id));
      expect(panel(id).hidden).toBe(false);
      expect(tab(id).getAttribute('aria-selected')).toBe('true');
      expect(nodo.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    }
  });

  it('conserva una política de espera sin guardar al cambiar de categoría', async () => {
    await montarConSesion(false);
    await pulsar(tab('autonomia'));
    const horas = nodo.querySelector<HTMLInputElement>('#pe-horas')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(horas, '72');
      horas.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pulsar(tab('general'));
    await pulsar(tab('autonomia'));
    expect(nodo.querySelector<HTMLInputElement>('#pe-horas')!.value).toBe('72');
    const guardar = [...panel('autonomia').querySelectorAll('button')].find(b => b.textContent?.trim() === 'Guardar')!;
    expect(guardar.disabled).toBe(false);
  });

  it('aplica el tema de la vista previa y conserva la elección al volver', async () => {
    await montarConSesion(false);
    const oscuro = nodo.querySelector<HTMLButtonElement>('[data-tema="oscuro"]')!;
    await pulsar(oscuro);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('rosa-tema')).toBe('oscuro');
    expect(oscuro.getAttribute('aria-pressed')).toBe('true');
    await pulsar(tab('avisos'));
    await pulsar(tab('general'));
    expect(oscuro.getAttribute('aria-pressed')).toBe('true');
    localStorage.removeItem('rosa-tema');
  });
});


it('los nuevos controles mantienen las acciones y la clase exacta de autonomía', async () => {
  await montarConSesion(false);
  await act(async () => nodo.querySelector<HTMLButtonElement>('#ajuste-tab-autonomia')!.click());
  const radio = nodo.querySelector<HTMLInputElement>('input[name="aut-buscar_literatura"]:not(:checked)')!;
  const nivel = radio.getAttribute('aria-label')!.split(': ')[1];
  await act(async () => radio.click());
  const valores: Record<string, string> = { 'Solo sugerir': 'sugerir', 'Preguntar antes': 'preguntar', 'Actuar y avisar': 'actuar' };
  expect(llamadas).toHaveBeenCalledWith('fijarAutonomia', 'buscar_literatura', valores[nivel!]);
  await act(async () => nodo.querySelector<HTMLButtonElement>('#ajuste-tab-avisos')!.click());
  const correo = [...nodo.querySelectorAll<HTMLLabelElement>('#ajuste-panel-avisos label')].find(el => el.textContent?.trim() === 'Correo')!.querySelector<HTMLInputElement>('input')!;
  const activo = !correo.checked;
  await act(async () => correo.click());
  expect(llamadas).toHaveBeenCalledWith('actualizarAvisos', expect.objectContaining({ correo: expect.objectContaining({ activo }) }));
});
