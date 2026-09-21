// @vitest-environment jsdom
// La espera al cambiar de pantalla, vista desde la raíz (App.tsx): con una
// pantalla pesada (el árbol, el ranking, el atlas) el primer commit tras el
// cambio de ruta es su silueta (aria-busy, rótulo oculto "Cargando ...") y
// la cabecera ya dice el título nuevo; después del pintado la silueta se va
// y llega la pantalla. Con una pantalla ligera no hay silueta desde App. Al
// cambiar de investigación en una pantalla pesada vuelve la silueta. Con el
// estado en 'conectando' App no pinta la maqueta gris de Acceso encima. La
// aplicación se monta entera con React 18 (createRoot y act), como en
// App.cliente.test.tsx, y se navega cambiando el hash.
//
// Cómo se observa el primer render sin depender del reloj: jsdom implementa
// requestAnimationFrame como un intervalo compartido a 60 Hz (vivo mientras
// Motion anima la página) y act() vacía su cola con una macrotarea, así que
// un tick del intervalo puede caer dentro o fuera del act según la fase del
// bucle de eventos: mirar el DOM "justo después" de navegar unas veces ve la
// silueta y otras ya el contenido. En vez de eso, un MutationObserver anota
// lo que hay en pantalla tras CADA commit de React (cada commit es una tarea
// distinta, y el observador corre como microtarea al acabar cada una), y las
// aserciones van sobre esa secuencia: el primer commit es la silueta con el
// título nuevo en la cabecera, el último es el contenido, y nunca hay dos
// aria-busy a la vez.
//
// Además del rótulo se graba la FORMA de cada silueta (las clases de maqueta
// de su caja .contenido y las piezas que trae) y se exige una sola forma por
// navegación. Dos siluetas con el mismo rótulo pero distinta forma (la que
// App pinta en su frame y la que la pantalla pinta en el siguiente) son un
// salto de maqueta de un frame que el rótulo solo no distingue: el árbol lo
// tuvo (una EsqueletoPantalla genérica de 1120 px seguida de la silueta real
// del árbol, a anchura completa y con su cabecera de 19 líneas) y este test
// pasaba por casualidad.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { aplicar } from './datos/almacen';
import { estadoDeMuestra } from './datos/muestra';
import type { EstadoRosa, Investigacion } from './datos/tipos';
import { rutaDe } from './lib/ruta';
import { ROTULO_ATLAS } from './pantallas/Atlas';

/** Los rótulos de las siluetas que App pinta al cambiar de ruta, tal cual: el del árbol vive en Arbol.tsx
 *  (ROTULO_ARBOL, dentro de EsqueletoArbol), el del ranking en App.tsx (ROTULO_RANKING) y el del atlas es ROTULO_ATLAS. */
const ROTULO_SILUETA = { arbol: 'el árbol de la investigación', ranking: 'el ranking', atlas: ROTULO_ATLAS } as const;
const DE_APP = Object.values(ROTULO_SILUETA).map((r) => `Cargando ${r}`);

beforeAll(() => {
  // Lo que jsdom no trae y el navegador sí.
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
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let raiz: HTMLDivElement;
beforeEach(() => {
  // Sin el recorrido de primera vez, que taparía la pantalla.
  localStorage.setItem('rosa.recorrido.v1', '1');
  window.location.hash = '';
  raiz = document.createElement('div');
  document.body.append(raiz);
  root = createRoot(raiz);
});
afterEach(async () => {
  await act(async () => root.unmount());
  raiz.remove();
  window.location.hash = '';
});

/** Deja el estado en el almacén, como si hubiera llegado del servidor. */
async function conEstado(e: EstadoRosa) {
  await act(async () => aplicar(() => e));
}
/** Monta App ya en esa ruta (como al recargar la pestaña en ella). */
async function montarEn(hash: string) {
  window.location.hash = hash;
  await act(async () => root.render(<App />));
}
/** Cambia de ruta como lo hace un clic en la barra lateral (un enlace al hash). */
async function navegar(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
/** Deja pasar los frames y temporizadores encadenados. Cada etapa diferida
 *  (la de App y después la de la pantalla) se programa al vaciar la anterior,
 *  y act() solo vacía lo que se programó dentro de su ventana: por eso se
 *  abren varias ventanas cortas en vez de una larga. */
async function esperarPintado(veces = 4, ms = 40) {
  for (let i = 0; i < veces; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}
/** El título que pinta la cabecera (el h1). */
const titulo = () => raiz.querySelector('.cabecera h1')?.textContent ?? '';

type Grabacion = {
  /** Lo visto tras cada commit, sin repetir el mismo estado seguido: "silueta: <rótulo> | <título>" o "sin silueta". */
  estados: string[];
  /** La forma de la silueta visible tras cada commit, sin repetir la misma seguida. Una sola forma por navegación es "sin salto". */
  formas: string[];
  /** Cuántos aria-busy hubo a la vez, como máximo. */
  maxOcupados: number;
  /** Piezas de la silueta del atlas que se vieron en algún commit. */
  marcas: Set<string>;
  parar: () => void;
};
/** Las piezas que distinguen una silueta de otra: las del árbol (grafo-*), las del atlas (atlas-*) y las de la EsqueletoPantalla genérica (esqueleto-*). */
const PIEZAS_FORMA = ['.pantalla-cabecera h2', '.grafo-marco', '.grafo-panel', '.grafo-tiempo', '.atlas-controles', '.atlas-marco', '.esqueleto-figura', '.esqueleto-leyenda', '.esqueleto-filas'];
/** La forma de una silueta: las clases de maqueta de su caja .contenido (la propia, si es una EsqueletoPantalla; la de
 *  dentro, si es un Cargando con silueta propia como el árbol; la de fuera, si la espera va dentro de .contenido como en
 *  el atlas) y las piezas que trae. Dos siluetas con la misma forma miden lo mismo. */
function forma(s: Element): string {
  const contenido = s.closest('.contenido') ?? s.querySelector('.contenido');
  const clases = contenido ? [...contenido.classList].filter((c) => c === 'contenido' || c === 'contenido-ancho').sort().join(' ') : 'sin .contenido';
  return `${clases} | ${PIEZAS_FORMA.filter((sel) => s.querySelector(sel)).join(' ')}`;
}
/** Anota lo que se ve tras cada commit de React. Solo mira los cambios de
 *  hijos y de las clases y aria-busy (los estilos que anima Motion no cuentan).
 *  Una silueta es cualquier contenedor con aria-busy y su rótulo oculto: la
 *  EsqueletoPantalla de App o de la pantalla, o el `Cargando` con silueta
 *  propia del modelo de mundo (.esqueleto-espera). */
function grabar(): Grabacion {
  const g: Grabacion = { estados: [], formas: [], maxOcupados: 0, marcas: new Set(), parar: () => {} };
  const anotar = () => {
    const s = raiz.querySelector('[role="status"][aria-busy="true"]');
    const estado = s ? `silueta: ${s.querySelector('.sr-only')?.textContent ?? ''} | ${titulo()}` : 'sin silueta';
    if (g.estados[g.estados.length - 1] !== estado) g.estados.push(estado);
    if (s) {
      const f = forma(s);
      if (g.formas[g.formas.length - 1] !== f) g.formas.push(f);
    }
    g.maxOcupados = Math.max(g.maxOcupados, raiz.querySelectorAll('[aria-busy="true"]').length);
    if (s?.closest('.atlas-esqueleto')) g.marcas.add('atlas');
    if (s?.querySelector('.atlas-esqueleto-cerebro')) g.marcas.add('óvalo');
    if (s?.querySelector('.atlas-panel')) g.marcas.add('panel');
    if ((s?.querySelectorAll('.atlas-esqueleto-chip').length ?? 0) > 3) g.marcas.add('chips');
  };
  const observador = new MutationObserver(anotar);
  observador.observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-busy'] });
  g.parar = () => observador.disconnect();
  return g;
}
const silueta = (rotulo: string, tituloCabecera: string) => `silueta: Cargando ${rotulo} | ${tituloCabecera}`;

function estadoConDosInvestigaciones(): { estado: EstadoRosa; inv: Investigacion; otra: Investigacion } {
  const estado = estadoDeMuestra();
  const inv = estado.investigaciones[0]!;
  const otra: Investigacion = { ...structuredClone(inv), id: 'inv-esqueleto-2', titulo: 'Otra investigación de prueba' };
  estado.investigaciones.push(otra);
  return { estado, inv, otra };
}

describe('la espera al cambiar de pantalla desde App', () => {
  it('con el estado en "conectando" App no pinta la maqueta gris de Acceso encima: la barra y la cabecera se quedan', async () => {
    // La carga inicial la cubre Acceso (EsqueletoAplicacion, "Cargando ROSA2018") antes de montar App;
    // si App volviera a pintarla habría dos "Cargando" anidados y dos aria-busy.
    const e = estadoDeMuestra();
    e.conexion = 'conectando';
    await conEstado(e);
    const g = grabar();
    await montarEn('#/');
    await esperarPintado();
    g.parar();
    expect(raiz.querySelector('.esqueleto-app')).toBeNull();
    expect(g.estados.some((x) => x.includes('Cargando ROSA2018'))).toBe(false);
    expect(raiz.textContent).not.toContain('Cargando ROSA2018');
    expect(raiz.querySelector('.barra')).not.toBeNull();
    expect(raiz.querySelector('.cabecera')).not.toBeNull();
    expect(titulo()).toBe('Investigaciones');
  });

  it('al cambiar al árbol el primer commit es su silueta con aria-busy y la cabecera ya responde; el árbol llega tras el pintado', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    expect(titulo()).toBe('Objetivo y datos');
    const g = grabar();
    await navegar(rutaDe(inv.id, 'arbol'));
    await esperarPintado();
    g.parar();
    // Primer commit tras el clic: la silueta del árbol y el título nuevo, nada del árbol. Último: el árbol.
    expect(g.estados[0]).toBe(silueta(ROTULO_SILUETA.arbol, 'Árbol de la investigación'));
    expect(g.estados).toEqual([g.estados[0], 'sin silueta']);
    expect(g.maxOcupados).toBe(1);
    // Una sola FORMA entre el clic y el árbol: la de App es EsqueletoArbol, la misma que el árbol pinta por dentro
    // (anchura completa, la cabecera real, el marco del grafo y la barra de iteraciones), no una figura genérica.
    expect(g.formas, 'dos siluetas distintas entre el clic y el árbol: salto de maqueta de un frame').toEqual([g.formas[0]]);
    expect(g.formas[0]).toContain('contenido-ancho');
    expect(g.formas[0]).toContain('.grafo-marco');
    expect(g.formas[0]).toContain('.grafo-tiempo');
    expect(g.formas[0]).toContain('.pantalla-cabecera h2');
    expect(g.formas[0]).not.toContain('.esqueleto-figura');
    expect([...raiz.querySelectorAll('.pagina h2')].map((h) => h.textContent)).toContain('Árbol de la investigación');
    expect(raiz.querySelector('.esqueleto-pantalla')).toBeNull();
    expect(raiz.querySelectorAll('[aria-busy="true"]').length).toBe(0);
  });

  it('al cambiar al atlas el primer commit es la silueta del atlas (la misma que la pantalla pinta por dentro): una sola espera, nunca dos', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    const g = grabar();
    await navegar(rutaDe(inv.id, 'atlas'));
    await esperarPintado();
    g.parar();
    // La silueta de App y la propia de Atlas son la misma (mismo rótulo, misma forma): un solo estado, sin salto.
    expect(g.estados[0]).toBe(silueta(ROTULO_ATLAS, 'Atlas de la enfermedad'));
    expect(g.estados).toEqual([g.estados[0], 'sin silueta']);
    expect(g.maxOcupados).toBe(1);
    expect(g.formas).toHaveLength(1);
    expect(g.formas[0]).toContain('contenido-ancho');
    expect(g.formas[0]).toContain('.atlas-marco');
    expect(g.formas[0]).toContain('.pantalla-cabecera h2');
    // El óvalo del hemisferio, los chips y el panel de la derecha estaban en la silueta.
    expect([...g.marcas].sort()).toEqual(['atlas', 'chips', 'panel', 'óvalo'].sort());
    // La muestra no trae mapa: el estado vacío del atlas, en su sitio, sin aria-busy.
    expect(raiz.querySelector('svg.atlas-figura') ?? raiz.querySelector('.vacio')).not.toBeNull();
    expect(raiz.querySelectorAll('[aria-busy="true"]').length).toBe(0);
  });

  it('al abrir ROSA2018 directamente en el ranking (recarga) el primer commit es la silueta de la lista y luego las filas', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    const g = grabar();
    await montarEn(rutaDe(inv.id, 'ranking'));
    await esperarPintado();
    g.parar();
    expect(g.estados[0]).toBe(silueta(ROTULO_SILUETA.ranking, 'Ranking'));
    expect(g.estados[g.estados.length - 1]).toBe('sin silueta');
    // La silueta de App y la propia de Ranking son la misma EsqueletoPantalla: un solo estado, una sola forma y nunca dos aria-busy.
    expect(g.estados.length).toBe(2);
    expect(g.maxOcupados).toBe(1);
    expect(g.formas).toHaveLength(1);
    expect(g.formas[0]).toContain('.esqueleto-filas');
    expect(raiz.querySelector('.esqueleto-pantalla')).toBeNull();
    expect(raiz.querySelectorAll('.ranking-fila').length).toBeGreaterThan(0);
  });

  it('una pantalla ligera no pasa por una silueta de App: se pinta directa', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'arbol'));
    await esperarPintado();
    const g = grabar();
    await navegar(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    g.parar();
    // Ningún commit enseñó una silueta de App; la pantalla y su hilo del proceso están.
    expect(g.estados.filter((x) => DE_APP.some((r) => x.includes(r)))).toEqual([]);
    expect(titulo()).toBe('Objetivo y datos');
    expect(raiz.querySelector('.hilo')).not.toBeNull();
    // Y las rutas que no son de una investigación tampoco: ninguna silueta en ningún commit.
    const g2 = grabar();
    await navegar('#/ajustes');
    await esperarPintado(8);
    g2.parar();
    expect(g2.estados.filter((x) => x.startsWith('silueta'))).toEqual([]);
    expect(titulo()).toBe('Ajustes');
    // La página saliente ya terminó su fundido (popLayout, 120 ms): queda una y es la de Ajustes.
    expect(raiz.querySelectorAll('.pagina').length).toBe(1);
    expect(raiz.querySelector('.pagina h2')?.textContent).toBe('Ajustes');
  });

  it('el modelo de mundo enseña una sola espera, la suya: App no le pone otra silueta encima', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    const g = grabar();
    await navegar(rutaDe(inv.id, 'mundo'));
    await esperarPintado();
    g.parar();
    expect(g.estados[0]).toBe(silueta('el modelo de mundo', 'Modelo de mundo'));
    expect(g.estados).toEqual([g.estados[0], 'sin silueta']);
    expect(g.maxOcupados).toBe(1);
    expect(g.formas).toHaveLength(1);
    expect(raiz.querySelectorAll('[aria-busy="true"]').length).toBe(0);
    expect(raiz.querySelectorAll('.hecho').length).toBeGreaterThan(0);
  });

  it('al cambiar de investigación en el atlas vuelve la silueta, y en el ranking la de la lista', async () => {
    const { estado, inv, otra } = estadoConDosInvestigaciones();
    await conEstado(estado);
    await montarEn(rutaDe(inv.id, 'atlas'));
    await esperarPintado();
    expect(raiz.querySelector('.esqueleto-pantalla')).toBeNull();
    const g = grabar();
    await navegar(rutaDe(otra.id, 'atlas'));
    await esperarPintado();
    g.parar();
    expect(g.estados[0]).toBe(silueta(ROTULO_ATLAS, 'Atlas de la enfermedad'));
    expect(g.estados[g.estados.length - 1]).toBe('sin silueta');
    expect(g.maxOcupados).toBe(1);
    expect(g.formas).toHaveLength(1);
    expect(raiz.querySelector('.cabecera')?.textContent).toContain('Otra investigación de prueba');
    // Lo mismo en el ranking.
    await navegar(rutaDe(inv.id, 'ranking'));
    await esperarPintado();
    expect(raiz.querySelector('.esqueleto-pantalla')).toBeNull();
    const g2 = grabar();
    await navegar(rutaDe(otra.id, 'ranking'));
    await esperarPintado();
    g2.parar();
    expect(g2.estados[0]).toBe(silueta(ROTULO_SILUETA.ranking, 'Ranking'));
    expect(g2.estados[g2.estados.length - 1]).toBe('sin silueta');
    expect(g2.formas).toHaveLength(1);
    expect(raiz.querySelector('.esqueleto-pantalla')).toBeNull();
  });

  it('abrir un detalle dentro de la misma pantalla pesada no cambia de página ni vuelve a la silueta', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'ranking'));
    await esperarPintado();
    expect(raiz.querySelectorAll('.ranking-fila').length).toBeGreaterThan(0);
    const g = grabar();
    await navegar(rutaDe(inv.id, 'ranking', 'detalle-que-no-existe'));
    await esperarPintado();
    g.parar();
    expect(g.estados.filter((x) => x.startsWith('silueta'))).toEqual([]);
    expect(g.maxOcupados).toBe(0);
    expect(raiz.querySelectorAll('.pagina').length).toBe(1);
    expect(raiz.querySelectorAll('.ranking-fila').length).toBeGreaterThan(0);
  });
});
