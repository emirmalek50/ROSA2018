// @vitest-environment jsdom
// Adversario de la espera al cambiar de pantalla (App.tsx, SILUETA_AL_CAMBIAR
// y usePrimerFrame) y de la silueta del atlas (pantallas/Atlas.tsx,
// EsqueletoAtlas), 19 de septiembre de 2026.
//
// App.esqueleto.test.tsx graba, tras cada commit de React, el RÓTULO de la
// silueta y el título de la cabecera, y borra los estados repetidos seguidos.
// Eso no distingue dos siluetas distintas con el mismo rótulo: la que App
// pinta en el primer frame y la que la pantalla pinta por dentro en el
// siguiente. La regla que App.tsx se da a sí misma (comentario de cabecera)
// es que sean la misma silueta, "para que entre el frame de App y el primero
// de la pantalla no cambie nada en la maqueta". Aquí se graba la FORMA de la
// silueta (las clases del contenedor y las piezas que trae) y se exige una
// sola forma entre el clic y el contenido.
//
// jsdom no maqueta, así que el salto de altura entre una silueta y su
// contenido se estima con lo que sí se puede leer: cuántas líneas grises
// pone la silueta en la cabecera y cuántas líneas ocupa el párrafo real a la
// anchura máxima que le da styles.css (.pantalla-cabecera p, max-width 68ch).
//
// Los dos últimos tests son guardias de lo que el constructor dice que
// funciona (investigación sin corridas con mapa; el deslizador y los chips
// conservan su estado cuando llega un estado nuevo a mitad del recálculo).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { DEFINICIONES_MAPA, ETIQUETAS_MAPA } from './componentes/MapaEnfermedad';
import { aplicar } from './datos/almacen';
import { estadoDeMuestra } from './datos/muestra';
import type { CeldaMapa, EstadoRosa, Investigacion, MapaEnfermedad } from './datos/tipos';
import { rutaDe } from './lib/ruta';
import { Atlas } from './pantallas/Atlas';

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
  window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let raiz: HTMLDivElement;
beforeEach(() => {
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

async function conEstado(e: EstadoRosa) {
  await act(async () => aplicar(() => e));
}
async function montarEn(hash: string) {
  window.location.hash = hash;
  await act(async () => root.render(<App />));
}
async function navegar(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
/** Deja pasar los frames y temporizadores encadenados (varias ventanas cortas de act, como en App.esqueleto.test.tsx). */
async function esperarPintado(veces = 4, ms = 40) {
  for (let i = 0; i < veces; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}

/** La FORMA de una silueta: las clases de maqueta de su `.contenido` y las
 *  piezas que trae. Dos siluetas con la misma forma miden lo mismo; dos con
 *  forma distinta son un salto de maqueta entre un frame y el siguiente. */
function forma(s: Element): string {
  // La caja .contenido puede ser la propia silueta (EsqueletoPantalla), estar dentro (un Cargando con silueta propia,
  // como el árbol) o FUERA: el atlas pone la espera dentro de .contenido, detrás del aviso de datos de muestra, para
  // que las dos regiones vivas (el aviso y la espera) no queden anidadas. closest() incluye al propio elemento.
  const contenido = s.closest('.contenido') ?? s.querySelector('.contenido');
  const clases = contenido ? [...contenido.classList].filter((c) => c === 'contenido' || c === 'contenido-ancho' || c.startsWith('esqueleto-pantalla')).sort().join(' ') : 'sin .contenido';
  const piezas = ['.grafo-marco', '.grafo-panel', '.grafo-tiempo', '.esqueleto-figura', '.esqueleto-leyenda', '.pantalla-cabecera h2', '.atlas-marco'].filter((sel) => s.querySelector(sel)).join(' ');
  return `${clases} | ${piezas}`;
}

type Grabacion = { formas: string[]; parar: () => void };
/** Anota, tras cada commit, la forma de la silueta visible (si la hay), sin repetir la misma seguida. */
function grabarFormas(): Grabacion {
  const g: Grabacion = { formas: [], parar: () => {} };
  const anotar = () => {
    const s = raiz.querySelector('[role="status"][aria-busy="true"]');
    if (!s) return;
    const f = forma(s);
    if (g.formas[g.formas.length - 1] !== f) g.formas.push(f);
  };
  const observador = new MutationObserver(anotar);
  observador.observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-busy'] });
  g.parar = () => observador.disconnect();
  return g;
}

/** Una celda del mapa con lo que falte relleno. */
function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

/** Un mapa mínimo pero real en su forma: dos regiones, una fase, con hechos de la investigación. */
function mapaMinimo(idsHechos: string[]): MapaEnfermedad {
  return {
    ejes: { estadio: { autosomico_dominante: 2 }, region: { plasma: 2, lcr: 2 }, tipoCelular: {}, nivel: {} },
    celdas: [celda({ region: 'plasma', hechos: idsHechos.slice(0, 2), cohortes: ['ADNI'] }), celda({ estadio: 'autosomico_dominante', region: 'lcr', hechos: idsHechos.slice(2, 4) })],
    huecos: [],
    sinEjes: 0,
    hipotesisSinEjes: 0,
    heredados: 0,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen: '',
    fecha: Date.UTC(2026, 8, 12, 10, 0, 0),
    iteracion: 1,
    etiquetas: ETIQUETAS_MAPA,
    definiciones: DEFINICIONES_MAPA,
  };
}

/** El estado de muestra con un mapa en la primera investigación. */
function estadoConMapa(): { estado: EstadoRosa; inv: Investigacion } {
  const estado = estadoDeMuestra();
  const inv = estado.investigaciones[0]!;
  const ids = estado.hechos.filter((h) => h.investigacionId === inv.id).map((h) => h.id);
  inv.mapaEnfermedad = mapaMinimo(ids);
  return { estado, inv };
}

const montarAtlas = async (estado: EstadoRosa, inv: Investigacion) => {
  await act(async () => root.render(<Atlas inv={inv} estado={estado} />));
};

describe('adversario: la silueta de App tiene que ser la misma que la de la pantalla', () => {
  it('al cambiar al árbol solo hay UNA forma de silueta entre el clic y el árbol (la que el árbol pinta por dentro: contenido-ancho, cabecera real, grafo-marco)', async () => {
    // App.tsx pinta para el árbol la EsqueletoPantalla genérica "figura" (.contenido de 1120 px, cabecera de
    // bloques grises, .esqueleto-figura de 16/9 con tres chips), pero Arbol.tsx exporta EsqueletoArbol,
    // su propia silueta (.contenido.contenido-ancho, la cabecera REAL con su párrafo de 1227 caracteres y sus
    // mandos, .grafo-marco con el panel, .grafo-tiempo), que es la que pinta en su primer render. Entre el
    // frame de App y el primero del árbol cambia la anchura, la altura de la cabecera (una línea gris frente
    // a unas 19 líneas de texto) y la figura entera. El test del constructor no lo ve porque los dos rótulos
    // son "el árbol de la investigación" y solo compara rótulos.
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await conEstado(e);
    await montarEn(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    const g = grabarFormas();
    await navegar(rutaDe(inv.id, 'arbol'));
    await esperarPintado();
    g.parar();
    expect(g.formas.length).toBeGreaterThan(0);
    // El contenido final del árbol es .contenido.contenido-ancho con .grafo-marco: la silueta de App debe medir eso.
    const contenidoArbol = raiz.querySelector('.pagina .contenido')!;
    expect(contenidoArbol.classList.contains('contenido-ancho')).toBe(true);
    expect(contenidoArbol.querySelector('.grafo-marco')).not.toBeNull();
    // Una sola forma en toda la espera: la de App y la propia del árbol son la misma.
    // (Se compara con la última, que es la del propio árbol: así el fallo enseña las dos formas.)
    expect(g.formas, 'dos siluetas distintas entre el clic y el árbol: salto de maqueta de un frame').toEqual([g.formas[g.formas.length - 1]]);
    expect(g.formas[0], 'la primera silueta (la de App) no tiene la anchura del árbol').toContain('contenido-ancho');
    expect(g.formas[0], 'la primera silueta (la de App) no trae el marco del grafo').toContain('.grafo-marco');
  });

  it('control: al cambiar al atlas solo hay una forma de silueta (App y Atlas pintan el mismo EsqueletoAtlas)', async () => {
    const { estado, inv } = estadoConMapa();
    await conEstado(estado);
    await montarEn(rutaDe(inv.id, 'investigacion'));
    await esperarPintado();
    const g = grabarFormas();
    await navegar(rutaDe(inv.id, 'atlas'));
    await esperarPintado();
    g.parar();
    expect(g.formas).toHaveLength(1);
    expect(g.formas[0]).toContain('contenido-ancho');
    expect(g.formas[0]).toContain('.atlas-marco');
    expect(raiz.querySelector('.atlas-marco .atlas-lienzo')).not.toBeNull();
  });
});

describe('adversario: la silueta del atlas no debe saltar al llegar el contenido', () => {
  it('la cabecera de la silueta del atlas mide lo que la real: o lleva el texto fijo (h2 y párrafo) o tantas líneas grises como líneas ocupa el párrafo a 68ch', async () => {
    // La cabecera real del atlas es texto FIJO (no depende del cálculo): un h2, un párrafo de unos 1000
    // caracteres que a la anchura máxima de .pantalla-cabecera p (68ch) ocupa unas 15 líneas de 21,7 px
    // (14 px por 1,55), y un p.meta. La silueta le pone un bloque de h2, seis líneas y una más: unos 200 px
    // menos. Cuando llega el contenido, los chips, el mapa, el panel y la leyenda bajan esos 200 px de golpe.
    // SiluetaArbol (Arbol.tsx) resuelve lo mismo pintando la cabecera real con los mandos en gris.
    const { estado, inv } = estadoConMapa();
    estado.conexion = 'en_linea';
    await montarAtlas(estado, inv);
    const silueta = raiz.querySelector('.atlas-esqueleto')!;
    expect(silueta).not.toBeNull();
    const cabeceraSilueta = silueta.querySelector('.pantalla-cabecera')!;
    const textoFijo = (cabeceraSilueta.textContent ?? '').includes('Atlas de la enfermedad');
    const lineasSilueta = cabeceraSilueta.querySelectorAll('.esqueleto-linea, .esqueleto-p').length;
    await esperarPintado(2, 60);
    const real = raiz.querySelector('.contenido:not(.atlas-esqueleto) .pantalla-cabecera')!;
    expect(real).not.toBeNull();
    const parrafos = [...real.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim());
    // Líneas que ocupa cada párrafo a 68 caracteres por línea (el máximo que le deja el CSS), sumadas.
    const lineasReales = parrafos.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / 68)), 0);
    expect(lineasReales).toBeGreaterThan(10);
    if (!textoFijo) {
      expect(lineasSilueta, `la silueta pone ${lineasSilueta} líneas grises en la cabecera y el contenido real ocupa unas ${lineasReales} líneas de texto: unos ${(lineasReales - lineasSilueta) * 22} px de salto al llegar el mapa`).toBeGreaterThanOrEqual(lineasReales - 3);
    }
  });
});

describe('guardias: lo que el constructor dice que funciona', () => {
  it('una investigación con mapa pero sin corridas ni iteraciones no se queda en la silueta: llega el atlas con el deslizador en 1 de 1', async () => {
    const estado = estadoDeMuestra();
    const plantilla = estado.investigaciones[0]!;
    const sola: Investigacion = { ...structuredClone(plantilla), id: 'inv-sin-corridas', titulo: 'Sin corridas' };
    sola.mapaEnfermedad = mapaMinimo([]);
    estado.investigaciones.push(sola);
    await montarAtlas(estado, sola);
    expect(raiz.querySelector('.atlas-esqueleto')).not.toBeNull();
    await esperarPintado(2, 60);
    expect(raiz.querySelector('.atlas-esqueleto')).toBeNull();
    expect(raiz.querySelectorAll('[aria-busy="true"]').length).toBe(0);
    expect(raiz.querySelector('.atlas-marco .atlas-lienzo')).not.toBeNull();
    const rango = raiz.querySelector<HTMLInputElement>('#atlas-iteracion')!;
    expect(rango.max).toBe('1');
    expect(rango.value).toBe('1');
    expect(raiz.querySelector('.grafo-tiempo')?.textContent).toContain('hasta la iteración 1 de 1');
  });

  it('un estado nuevo a mitad del recálculo no borra el deslizador ni el chip pulsado, ni vuelve a la silueta', async () => {
    const { estado, inv } = estadoConMapa();
    await montarAtlas(estado, inv);
    await esperarPintado(2, 60);
    const rango = raiz.querySelector<HTMLInputElement>('#atlas-iteracion')!;
    expect(Number(rango.max)).toBeGreaterThan(1);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(rango, '1');
      rango.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Mientras se recalcula, el deslizador ya marca 1 (no vuelve al máximo) y el marco dice que está ocupado.
    expect(raiz.querySelector<HTMLInputElement>('#atlas-iteracion')!.value).toBe('1');
    expect(raiz.querySelector('.atlas-marco')?.getAttribute('aria-busy')).toBe('true');
    await esperarPintado(2, 60);
    expect(raiz.querySelector('.atlas-marco')?.hasAttribute('aria-busy')).toBe(false);
    const chip = [...raiz.querySelectorAll('button.atlas-chip')].find((b) => b.textContent?.includes('autosómica dominante'))!;
    expect(chip).toBeTruthy();
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Llega un estado nuevo (el canal en vivo) antes de que termine el recálculo del chip.
    await montarAtlas({ ...estado }, inv);
    expect(raiz.querySelector('.atlas-esqueleto')).toBeNull();
    expect(raiz.querySelector('.atlas-marco .atlas-lienzo')).not.toBeNull();
    expect(raiz.querySelector<HTMLInputElement>('#atlas-iteracion')!.value).toBe('1');
    expect([...raiz.querySelectorAll('button.atlas-chip')].find((b) => b.textContent?.includes('autosómica dominante'))?.getAttribute('aria-pressed')).toBe('true');
    await esperarPintado(2, 60);
    expect(raiz.querySelector('.atlas-marco')?.hasAttribute('aria-busy')).toBe(false);
    expect(raiz.querySelector<HTMLInputElement>('#atlas-iteracion')!.value).toBe('1');
    expect([...raiz.querySelectorAll('button.atlas-chip')].find((b) => b.textContent?.includes('autosómica dominante'))?.getAttribute('aria-pressed')).toBe('true');
    expect(raiz.querySelector('.grafo-tiempo')?.textContent).toContain('hasta la iteración 1 de');
    expect(raiz.querySelector('.atlas-honesta')?.textContent).toContain('con los filtros puestos');
  });
});
