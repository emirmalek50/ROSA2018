// @vitest-environment jsdom
// El esqueleto del ranking (estándar de Emir, 19 de septiembre de 2026): el
// primer render es la silueta de lista, las filas llegan al frame siguiente;
// cambiar de investigación vuelve a la silueta sin enseñar las filas de la
// anterior y un empuje del estado con la misma investigación no; con el
// estado sin cargar se queda en la silueta; el cálculo puro (calcularRanking)
// devuelve todo lo derivado de una vez; y con 150 hipótesis el primer render
// no espera al cálculo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { Ranking, calcularRanking } from './Ranking';

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

async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
// La vista del ranking viaja en la URL desde el 1 de octubre de 2026, así
// que el montaje la guarda y `irA` vuelve a pintar con la nueva: sin eso,
// pulsar un botón del segmentado no cambiaría nada y el test mediría otra
// cosa. Es además lo que hace la aplicación de verdad.
let invActual: Investigacion;
let estadoActual: EstadoRosa;
let vistaActual: string | null;

function pintar() {
  return act(async () => root.render(<Ranking inv={invActual} estado={estadoActual} detalleId={vistaActual} irA={(hash) => { vistaActual = hash.split('/').pop() ?? null; void pintar(); }} />));
}

const montar = (inv: Investigacion, e: EstadoRosa, vista: string | null = 'lista') => {
  invActual = inv;
  estadoActual = e;
  vistaActual = vista;
  return pintar();
};
const silueta = () => nodo.querySelector('.esqueleto-pantalla');
const filas = () => [...nodo.querySelectorAll('.ranking-fila')];
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
const pulsar = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('la silueta del ranking', () => {
  it('el primer render es la silueta de lista con aria-busy y rótulo oculto; las filas llegan al frame siguiente', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const propias = e.hipotesis.filter((h) => h.investigacionId === inv.id);
    await montar(inv, e);
    const s = silueta()!;
    expect(s).not.toBeNull();
    expect(s.classList.contains('esqueleto-pantalla-lista')).toBe(true);
    expect(s.getAttribute('aria-busy')).toBe('true');
    expect(s.querySelector('.sr-only')?.textContent).toBe('Cargando el ranking');
    expect(filas()).toHaveLength(0);
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(filas()).toHaveLength(propias.length);
    expect(nodo.querySelector('h2')?.textContent).toBe('Ranking de hipótesis');
    expect(nodo.textContent).not.toMatch(/\u2014/);
    // La vista por cluster sigue funcionando sobre el cálculo diferido.
    await pulsar(boton('Por cluster'));
    expect(nodo.querySelectorAll('.cluster').length).toBeGreaterThan(0);
    expect(filas()).toHaveLength(propias.length);
  });

  it('cambiar de investigación vuelve a la silueta sin enseñar las filas de la anterior; un empuje del estado con la misma no', async () => {
    const e = estadoDeMuestra();
    const invA = e.investigaciones[0]!;
    const invB: Investigacion = { ...structuredClone(invA), id: 'inv-2', titulo: 'Otra investigación' };
    const hipsB = e.hipotesis.filter((h) => h.investigacionId === invA.id).slice(0, 3).map((h, i) => ({ ...structuredClone(h), id: `hip-b-${i}`, investigacionId: 'inv-2' }));
    const e2: EstadoRosa = { ...e, investigaciones: [...e.investigaciones, invB], hipotesis: [...e.hipotesis, ...hipsB] };
    await montar(invA, e2);
    await esperarPintado();
    const hrefsA = filas().map((a) => a.getAttribute('href') ?? '');
    expect(hrefsA.length).toBeGreaterThan(0);
    expect(hrefsA.every((h) => h.includes(invA.id))).toBe(true);
    await montar(invA, structuredClone(e2));
    expect(silueta()).toBeNull();
    expect(filas()).toHaveLength(hrefsA.length);
    await montar(invB, e2);
    expect(silueta()).not.toBeNull();
    expect(filas()).toHaveLength(0);
    await esperarPintado();
    const hrefsB = filas().map((a) => a.getAttribute('href') ?? '');
    expect(hrefsB).toHaveLength(3);
    expect(hrefsB.every((h) => h.includes('inv-2'))).toBe(true);
  });

  it('con el estado sin cargar (conectando) se queda en la silueta aunque pase el frame', async () => {
    const e: EstadoRosa = { ...estadoDeMuestra(), conexion: 'conectando' };
    await montar(e.investigaciones[0]!, e);
    await esperarPintado();
    expect(silueta()).not.toBeNull();
    expect(filas()).toHaveLength(0);
  });

  it('adversario: con 150 hipótesis el primer render (la silueta) no espera al cálculo, y las filas llegan después', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const base = e.hipotesis.find((x) => x.investigacionId === inv.id && x.experimento)!;
    e.hipotesis = [...e.hipotesis, ...Array.from({ length: 150 }, (_, i) => ({ ...structuredClone(base), id: `hip-masiva-${i}`, elo: 1000 + i }))];
    const t0 = performance.now();
    await montar(inv, e);
    const primerRender = performance.now() - t0;
    expect(silueta()).not.toBeNull();
    expect(filas()).toHaveLength(0);
    // La silueta no carga con las 150 franjas: si tardara segundos, el esqueleto no serviría de nada.
    expect(primerRender).toBeLessThan(1500);
    await esperarPintado();
    expect(silueta()).toBeNull();
    expect(filas().length).toBeGreaterThanOrEqual(150);
  });
});

describe('calcularRanking, el cálculo puro', () => {
  it('devuelve todo lo derivado con la foto del estado: orden por Elo con las descartadas al final, candidatas y no candidatas sin solaparse, clusters que cubren todas', () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const r = calcularRanking(e, inv.id);
    expect(r.invId).toBe(inv.id);
    expect(r.estado).toBe(e);
    const propias = e.hipotesis.filter((h) => h.investigacionId === inv.id);
    expect(r.propias).toHaveLength(propias.length);
    expect(r.lista).toHaveLength(propias.length);
    const primeraDescartada = r.lista.findIndex((h) => h.estado === 'descartada');
    if (primeraDescartada !== -1) expect(r.lista.slice(primeraDescartada).every((h) => h.estado === 'descartada')).toBe(true);
    const vivas = primeraDescartada === -1 ? r.lista : r.lista.slice(0, primeraDescartada);
    for (let i = 1; i < vivas.length; i++) expect(vivas[i - 1]!.elo).toBeGreaterThanOrEqual(vivas[i]!.elo);
    expect(r.noCands.every((x) => !r.cands.some((c) => c.id === x.h.id) && x.h.estado !== 'descartada')).toBe(true);
    expect(r.noCands.every((x) => x.bloqueos.length > 0 || x.motivo !== '')).toBe(true);
    expect(r.clusters.flatMap(([, hs]) => hs)).toHaveLength(propias.length);
    expect(r.cal).toHaveProperty('acuerdo');
  });

  it('una investigación que no existe da listas vacías sin lanzar', () => {
    const r = calcularRanking(estadoDeMuestra(), 'no-existe');
    expect(r.lista).toEqual([]);
    expect(r.cands).toEqual([]);
    expect(r.noCands).toEqual([]);
    expect(r.clusters).toEqual([]);
  });
});
