// @vitest-environment jsdom
// Las secciones de Rosa2018 que piden datos aparte al servidor (integridad
// del registro, espejo de Convex, coste por decisión) enseñan un esqueleto
// con aria-busy y rótulo oculto mientras la promesa no resuelve, y el
// contenido real después, con el mismo número de piezas para no saltar.
// "Sin servidor" sigue saliendo como antes. Y el botón de preguntar a las
// bases vuela (data-en-vuelo y aria-busy, sin admitir un segundo clic)
// mientras el bucle de herramientas responde.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoEspejo } from '../datos/tipos';
import { fijarModo } from '../lib/modo';
import { CostesPorDecision, EspejoConvex, IntegridadRegistro, PreguntarALasBases, type CostesInvestigacion } from './Rosa2018';

const almacen = vi.hoisted(() => ({
  acciones: {} as Record<string, unknown>,
  aplicar: vi.fn(),
  cabeceras: () => ({}),
  modoActual: (() => 'servidor') as () => 'muestra' | 'servidor',
  QUIEN: 'la persona responsable',
  avisar: vi.fn(),
  conectar: vi.fn(async () => 'servidor' as const),
  useRosa: (() => ({ corridas: [] })) as () => { corridas: unknown[] },
}));
vi.mock('../datos/almacen', () => almacen);

type Integridad = { ok: boolean; filas: number; encadenadas: number; sinHash: number; rotaEn: number | null; motivo?: string };

/** Una promesa que resuelve cuando el test quiere: simula al servidor que todavía no ha respondido. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

beforeAll(() => {
  // Las secciones (piezas.tsx) animan al entrar en pantalla con IntersectionObserver, que jsdom no trae.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Las tres secciones son de detalle: en modo sencillo van plegadas y no pintan hijos.
  fijarModo('detalle');
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  almacen.acciones = {};
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  fijarModo('sencillo');
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const escribir = async (el: HTMLInputElement, valor: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
/** El texto que un lector de pantalla encontraría: todo lo que no está aria-hidden. */
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}
const espera = () => nodo.querySelector('[aria-busy="true"]');

describe('cuando el servidor está pero no contestó a tiempo', () => {
  it('la integridad dice "no pude comprobar" con el botón de volver a comprobar, que vuelve a pedirla', async () => {
    const primera = diferida<Integridad | null | 'sin_respuesta'>();
    const segunda = diferida<Integridad | null | 'sin_respuesta'>();
    const integridadRegistro = vi.fn(() => (integridadRegistro.mock.calls.length === 1 ? primera.promesa : segunda.promesa));
    almacen.acciones = { integridadRegistro };
    await render(<IntegridadRegistro />);
    await act(async () => primera.resolver('sin_respuesta'));
    expect(espera()).toBeNull();
    expect(nodo.textContent).toContain('No pude comprobar la integridad del registro: el servidor no respondió a tiempo.');
    expect(nodo.textContent).not.toContain('Sin servidor');
    await pulsar(boton('Volver a comprobar')!);
    expect(integridadRegistro).toHaveBeenCalledTimes(2);
    expect(espera()).not.toBeNull();
    await act(async () => segunda.resolver({ ok: true, filas: 3, encadenadas: 3, sinHash: 0, rotaEn: null }));
    expect(nodo.querySelector('.acciones .chip')?.textContent).toBe('Cadena intacta');
  });
  it('el coste por decisión hace lo mismo, y la silueta lleva el párrafo "Por iteración" cuando el estado tiene más de una', async () => {
    // Dos promesas: la segunda queda pendiente para comprobar que el reintento
    // vuelve a enseñar la silueta (con una sola, ya resuelta, no podría).
    const d = diferida<CostesInvestigacion | null | 'sin_respuesta'>();
    const segunda = diferida<CostesInvestigacion | null | 'sin_respuesta'>();
    const costesDe = vi.fn(() => (costesDe.mock.calls.length === 1 ? d.promesa : segunda.promesa));
    almacen.acciones = { costesDe };
    almacen.useRosa = () => ({ corridas: [{ investigacionId: 'inv-1', iteracionActual: 3 }, { investigacionId: 'inv-1', iteracionActual: 2 }, { investigacionId: 'otra', iteracionActual: 9 }] });
    try {
      await render(<CostesPorDecision investigacionId="inv-1" />);
      expect(espera()!.querySelectorAll('.esqueleto-texto').length).toBe(5);
      await act(async () => d.resolver('sin_respuesta'));
      expect(espera()).toBeNull();
      expect(nodo.textContent).toContain('No pude comprobar el coste por decisión');
      await pulsar(boton('Volver a comprobar')!);
      expect(costesDe).toHaveBeenCalledTimes(2);
      expect(espera()).not.toBeNull();
    } finally {
      almacen.useRosa = () => ({ corridas: [] });
    }
  });
  it('el espejo de Convex también', async () => {
    almacen.acciones = { estadoEspejo: vi.fn(async () => 'sin_respuesta' as const) };
    await render(<EspejoConvex ahora={0} />);
    expect(espera()).toBeNull();
    expect(nodo.textContent).toContain('No pude comprobar el espejo de Convex');
    expect(boton('Volver a comprobar')).toBeDefined();
  });
});

describe('IntegridadRegistro', () => {
  it('enseña el esqueleto con aria-busy mientras el servidor responde y el veredicto después, sin el texto "Comprobando"', async () => {
    const d = diferida<Integridad | null>();
    almacen.acciones = { integridadRegistro: vi.fn(() => d.promesa) };
    await render(<IntegridadRegistro />);
    const e = espera();
    expect(e).not.toBeNull();
    expect(e!.getAttribute('role')).toBe('status');
    expect(textoAccesible(e!)).toBe('Cargando la integridad del registro');
    // Un chip y una frase de dos líneas (el motivo de una cadena rota ocupa hasta tres): la silueta de la fila de acciones real.
    expect(e!.querySelector('.acciones')).not.toBeNull();
    expect(e!.querySelectorAll('.esqueleto').length).toBe(3);
    for (const bloque of e!.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
    expect(nodo.textContent).not.toContain('Comprobando');

    await act(async () => d.resolver({ ok: true, filas: 12, encadenadas: 12, sinHash: 0, rotaEn: null }));
    expect(espera()).toBeNull();
    expect(nodo.querySelector('.esqueleto')).toBeNull();
    expect(nodo.querySelector('.acciones .chip')?.textContent).toBe('Cadena intacta');
    expect(nodo.textContent).toContain('12 acciones registradas, 12 encadenadas');
  });
  it('sin servidor (null) no hay esqueleto: sale el aviso de siempre', async () => {
    almacen.acciones = { integridadRegistro: vi.fn(async () => null) };
    await render(<IntegridadRegistro />);
    expect(espera()).toBeNull();
    expect(nodo.querySelector('.esqueleto')).toBeNull();
    expect(nodo.textContent).toContain('Sin servidor no hay registro que comprobar.');
  });
  it('una cadena rota se enseña igual que antes al llegar', async () => {
    almacen.acciones = { integridadRegistro: vi.fn(async () => ({ ok: false, filas: 9, encadenadas: 4, sinHash: 0, rotaEn: 5, motivo: 'hash anterior distinto' })) };
    await render(<IntegridadRegistro />);
    expect(espera()).toBeNull();
    expect(nodo.querySelector('.acciones .chip')?.textContent).toBe('Cadena rota en la fila 5');
    expect(nodo.textContent).toContain('hash anterior distinto');
  });
});

describe('EspejoConvex', () => {
  const espejo: EstadoEspejo = { activo: true, url: 'https://rosa.convex.cloud', ultimaVersion: 7, sincronizadoEn: null, entidades: 40, pendiente: false, error: null, envios: 3, ms: 120 };
  it('esqueleto mientras consulta; el estado del espejo después', async () => {
    const d = diferida<EstadoEspejo | null>();
    almacen.acciones = { estadoEspejo: vi.fn(() => d.promesa) };
    await render(<EspejoConvex ahora={Date.now()} />);
    const e = espera();
    expect(e).not.toBeNull();
    expect(textoAccesible(e!)).toBe('Cargando el espejo de Convex');
    expect(e!.querySelectorAll('.esqueleto').length).toBe(2);
    expect(nodo.textContent).not.toContain('Consultando el servidor');

    await act(async () => d.resolver(espejo));
    expect(espera()).toBeNull();
    expect(nodo.querySelector('.acciones .chip')?.textContent).toBe('Al día');
    expect(nodo.textContent).toContain('https://rosa.convex.cloud · 40 entidades · versión 7');
  });
  it('sin servidor (null) y apagado siguen con sus avisos, sin esqueleto', async () => {
    almacen.acciones = { estadoEspejo: vi.fn(async () => null) };
    await render(<EspejoConvex ahora={Date.now()} />);
    expect(espera()).toBeNull();
    expect(nodo.textContent).toContain('Sin servidor: el espejo solo existe');
    almacen.acciones = { estadoEspejo: vi.fn(async () => ({ ...espejo, activo: false })) };
    await act(async () => root.unmount());
    root = createRoot(nodo);
    await render(<EspejoConvex ahora={Date.now()} />);
    expect(espera()).toBeNull();
    expect(nodo.textContent).toContain('Apagado: no hay clave de Convex');
  });
});

describe('CostesPorDecision', () => {
  const costes: CostesInvestigacion = {
    corridas: 2,
    llamadas: 40,
    usdModelo: 3.5,
    horasRevision: 0.5,
    tarifaHoraRevisionUsd: 60,
    usdRevision: 30,
    usdTotal: 33.5,
    hipotesis: 5,
    hipotesisConDossier: 2,
    candidatas: 1,
    decisionesHumanas: 3,
    usdPorDossier: 16.75,
    usdPorCandidata: 33.5,
    usdPorDecisionHumana: 11.17,
    segundosMediosPorDecision: 90,
    porIteracion: [{ corrida: 1, iteracion: 1, llamadas: 20, usd: 1.7 }],
    tendenciaUsdPorIteracion: null,
    nota: '',
  };
  it('cuatro tarjetas grises con la forma de las métricas mientras el servidor agrega; las cuatro reales después', async () => {
    const d = diferida<CostesInvestigacion | null>();
    almacen.acciones = { costesDe: vi.fn(() => d.promesa) };
    await render(<CostesPorDecision investigacionId="inv-1" />);
    const e = espera();
    expect(e).not.toBeNull();
    expect(textoAccesible(e!)).toBe('Cargando el coste por decisión');
    expect(e!.querySelectorAll('.metricas .gasto-item').length).toBe(4);
    // Cada tarjeta: la cifra y tres líneas de explicación (medido: 115 px, como las reales).
    for (const tarjeta of e!.querySelectorAll('.gasto-item')) expect(tarjeta.querySelectorAll('.esqueleto').length).toBe(4);
    // Sin iteraciones en el estado no hay párrafo "Por iteración" en la silueta.
    expect(e!.querySelectorAll('.esqueleto-texto').length).toBe(4);
    expect(nodo.textContent).not.toContain('Calculando');

    await act(async () => d.resolver(costes));
    expect(espera()).toBeNull();
    expect(nodo.querySelector('.esqueleto')).toBeNull();
    expect(nodo.querySelectorAll('.metricas .gasto-item').length).toBe(4);
    expect(nodo.textContent).toContain('por hipótesis con dossier (2 de 5)');
    expect(nodo.textContent).toContain('33,50 $');
  });
  it('al cambiar de investigación vuelve al esqueleto hasta que llegan los costes nuevos', async () => {
    const primera = diferida<CostesInvestigacion | null>();
    const segunda = diferida<CostesInvestigacion | null>();
    const costesDe = vi.fn((id: string) => (id === 'inv-1' ? primera.promesa : segunda.promesa));
    almacen.acciones = { costesDe };
    await render(<CostesPorDecision investigacionId="inv-1" />);
    await act(async () => primera.resolver(costes));
    expect(espera()).toBeNull();
    await render(<CostesPorDecision investigacionId="inv-2" />);
    expect(costesDe).toHaveBeenCalledTimes(2);
    expect(espera()).not.toBeNull();
    await act(async () => segunda.resolver(null));
    expect(espera()).toBeNull();
    expect(nodo.textContent).toContain('Sin servidor no hay costes que agregar.');
  });
});

describe('PreguntarALasBases', () => {
  it('el botón vuela mientras responde el bucle de herramientas, no admite un segundo clic y vuelve al terminar', async () => {
    const inv = estadoDeMuestra().investigaciones[0]!;
    const d = diferida<string | null>();
    const preguntar = vi.fn(() => d.promesa);
    almacen.acciones = { preguntarALasBases: preguntar };
    await render(<PreguntarALasBases inv={inv} ahora={Date.now()} />);
    const entrada = nodo.querySelector('input[aria-label="Pregunta a las bases"]') as HTMLInputElement;
    await escribir(entrada, 'Qué fármacos tocan TREM2');
    const btn = boton('Preguntar con herramientas')!;
    expect(btn.hasAttribute('data-en-vuelo')).toBe(false);
    await pulsar(btn);
    expect(preguntar).toHaveBeenCalledTimes(1);
    expect(preguntar).toHaveBeenCalledWith(inv.id, 'Qué fármacos tocan TREM2');
    expect(btn.getAttribute('data-en-vuelo')).toBe('true');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Consultando bases');
    await pulsar(btn);
    expect(preguntar).toHaveBeenCalledTimes(1);

    await act(async () => d.resolver(null));
    expect(btn.hasAttribute('data-en-vuelo')).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    expect(btn.textContent).toContain('Preguntar con herramientas');
    expect(entrada.value).toBe('');
  });
  it('si el servidor devuelve un error, el botón aterriza, el error se enseña y la pregunta se conserva', async () => {
    const inv = estadoDeMuestra().investigaciones[0]!;
    almacen.acciones = { preguntarALasBases: vi.fn(async () => 'No hay servidor conectado') };
    await render(<PreguntarALasBases inv={inv} ahora={Date.now()} />);
    const entrada = nodo.querySelector('input[aria-label="Pregunta a las bases"]') as HTMLInputElement;
    await escribir(entrada, 'Qué tejidos expresan TREM2');
    await pulsar(boton('Preguntar con herramientas')!);
    const btn = boton('Preguntar con herramientas')!;
    expect(btn.hasAttribute('data-en-vuelo')).toBe(false);
    expect(nodo.querySelector('.tono-mal')?.textContent).toBe('No hay servidor conectado');
    expect(entrada.value).toBe('Qué tejidos expresan TREM2');
  });
});
