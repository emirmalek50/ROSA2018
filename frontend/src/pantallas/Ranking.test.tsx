// @vitest-environment jsdom
// El ranking montado de verdad (createRoot y act, como Arbol.test.tsx): cada
// fila lleva debajo de su bloque de estado la franja de componentes del
// ranking (FranjaRanking), en la vista de lista y en la vista por cluster, y
// una fila con un registro a medias (sin conclusión, sin tarjeta, sin
// experimento) sigue pintándose.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { Ranking } from './Ranking';

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

const franjas = () => [...nodo.querySelectorAll('.ranking-fila [role="group"][aria-label="Componentes del ranking, sin sumar"]')];
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** Deja pasar el frame y el temporizador que viene detrás: desde el 19 de
 *  septiembre de 2026 la pantalla pinta primero su silueta (esqueleto) y el
 *  contenido llega tras el siguiente pintado (lib/diferido.ts). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function montar(inv: Investigacion, e: EstadoRosa) {
  await act(async () => root.render(<Ranking inv={inv} estado={e} />));
  await esperarPintado();
}

describe('la pantalla del ranking', () => {
  it('pinta la franja de componentes en cada fila, debajo del bloque de estado, en la lista y por cluster', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const propias = e.hipotesis.filter((h) => h.investigacionId === inv.id);
    await montar(inv, e);
    const filas = [...nodo.querySelectorAll('.ranking-fila')];
    expect(filas).toHaveLength(propias.length);
    expect(franjas()).toHaveLength(propias.length);
    for (const fila of filas) {
      const metas = [...fila.querySelectorAll('.hip-meta')];
      // El primer hip-meta es el bloque de siempre (estado, cluster, Killer); la franja va después.
      expect(metas.length).toBeGreaterThanOrEqual(2);
      expect(metas[0]!.getAttribute('role')).toBeNull();
      expect(metas[0]!.compareDocumentPosition(fila.querySelector('[role="group"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Cada chip de la franja lleva su definición en el title.
    const chips = [...franjas()[0]!.querySelectorAll('.chip')];
    expect(chips.length).toBeGreaterThan(3);
    expect(chips.every((c) => (c.getAttribute('title') ?? '').length > 10)).toBe(true);
    await pulsar(boton('Por cluster'));
    expect(franjas()).toHaveLength(propias.length);
  });

  it('una hipótesis con registro a medias (sin conclusión, sin tarjeta, sin experimento, sin novedad ni BT) sigue teniendo su fila y su franja', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id)!;
    h.conclusion = null;
    h.tarjeta = null;
    h.experimento = null;
    // (Una fuente nula dentro de procedencia rompe bloqueosDe en lib/priorizacion.ts,
    // que la fila ya llamaba antes de la franja; queda anotado como pendiente, no es de esta pantalla.)
    h.bloqueos = undefined;
    h.novedad = undefined as unknown as typeof h.novedad;
    h.bt = undefined;
    await montar(inv, e);
    const fila = [...nodo.querySelectorAll('.ranking-fila')].find((f) => f.getAttribute('href')?.endsWith(h.id))!;
    expect(fila).toBeDefined();
    const franja = fila.querySelector('[role="group"]')!;
    expect(franja.textContent).toContain('Sin conclusión todavía');
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });
});

describe('adversario: el ranking con registros corruptos y muchas filas', () => {
  it('tarjeta, ruta, perfil y alternativas guardados como texto no tumban la fila ni la franja', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id)!;
    h.tarjeta = 'texto' as unknown as typeof h.tarjeta;
    h.ruta = 'texto' as unknown as typeof h.ruta;
    h.perfilDiana = 'texto' as unknown as typeof h.perfilDiana;
    h.alternativas = 'texto' as unknown as typeof h.alternativas;
    h.experimento = 'texto' as unknown as typeof h.experimento;
    await montar(inv, e);
    const fila = [...nodo.querySelectorAll('.ranking-fila')].find((f) => f.getAttribute('href')?.endsWith(h.id))!;
    expect(fila).toBeDefined();
    expect(fila.querySelector('[role="group"]')).not.toBeNull();
    expect(nodo.textContent).not.toContain('function');
  });

  it('con 150 hipótesis pinta una franja por fila en un tiempo razonable', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const base = e.hipotesis.find((x) => x.investigacionId === inv.id && x.experimento)!;
    const extra = Array.from({ length: 150 }, (_, i) => ({ ...structuredClone(base), id: `hip-masiva-${i}`, elo: 1000 + i }));
    e.hipotesis = [...e.hipotesis, ...extra];
    const t0 = performance.now();
    await montar(inv, e);
    const ms = performance.now() - t0;
    expect(franjas().length).toBeGreaterThanOrEqual(150);
    // Un render de 150 filas no puede tardar más de unos segundos: si lo hace, el coste por fila (bloqueosDe reindexa planes y ejecuciones) se ha disparado.
    expect(ms).toBeLessThan(8000);
  });
});
