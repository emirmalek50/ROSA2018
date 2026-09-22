// @vitest-environment jsdom
// Tests adversarios del CIERRE del atlas (19 de septiembre de 2026): el dibujo
// nuevo (lib/atlas_dibujo.ts), los datos (lib/atlas.ts), la pantalla
// (pantallas/Atlas.tsx) y el CSS (atlas.css y styles.css), tomados juntos y
// contrastados con el estado real de inv-mu2sz2ns-3 leído de rosa.db en solo
// lectura y con la compilación servida en Chromium (Playwright). Cada test
// codificó lo que el atlas DEBERÍA cumplir y fallaba el 19 de septiembre: es
// la prueba reproducible de cada hallazgo del informe, y tras la reparación
// del cierre queda como guardia de que no vuelvan. Mismo patrón de montaje que
// Atlas.test.tsx.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFINICIONES_MAPA, ETIQUETAS_MAPA } from '../componentes/MapaEnfermedad';
import { estadoDeMuestra } from '../datos/muestra';
import type { CeldaMapa, Corrida, EstadoRosa, HechoMundo, Investigacion, MapaEnfermedad } from '../datos/tipos';
import { Atlas } from '../pantallas/Atlas';
import { medioTexto, NOMBRE_CORTO, puntoMarca, REGIONES_DIBUJO } from './atlas_dibujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CSS_ATLAS = readFileSync(resolve(AQUI, '../atlas.css'), 'utf8');
const CSS_ESTILOS = readFileSync(resolve(AQUI, '../styles.css'), 'utf8');

// ---------------------------------------------------------------------------
// La figura: las marcas y el foco
// ---------------------------------------------------------------------------

describe('las marcas de la figura (adversario del cierre)', () => {
  it('el punto de «buscada sin hallazgo» (y el de discordia) no cae bajo ninguna etiqueta: en el centro si la etiqueta va fuera, junto al texto si va escrita dentro', () => {
    // Antes de la reparación, Atlas.tsx pintaba los dos puntos en `centro` y el grupo de etiquetas
    // iba ENCIMA: en las regiones cuya etiqueta está dentro de la figura, `etiqueta` era `centro` (o
    // cuatro unidades más abajo), así que el punto quedaba bajo las letras. En el estado real de
    // inv-mu2sz2ns-3 hay ocho huecos buscados y tres tienen etiqueta interior: se veía
    // «corteza,parietal» y «corteza¸frontal» (el punto asomaba entre las palabras como una coma) y
    // en «cerebelo» desaparecía bajo la «e» y la «b»; la leyenda prometía «rayas con contorno y
    // punto» sin punto que ver. Ahora la pantalla pinta los puntos donde dice puntoMarca() con el
    // texto que se pinta de verdad (nombre más número), y aquí se exige que esa marca, con radio 4,
    // quede fuera de la caja de TODAS las etiquetas, con y sin número al lado. Caja con la misma
    // estimación que finGuia() y medioTexto(): 13 px de cuerpo, unos 6,8 px por letra, línea base
    // en `etiqueta[1]`.
    const RADIO = 4;
    const tapados: string[] = [];
    for (const cifra of [null, '99']) {
      const textoDe = (clave: string): string => (cifra ? `${NOMBRE_CORTO[clave] ?? clave} · ${cifra}` : NOMBRE_CORTO[clave] ?? clave);
      const cajas = REGIONES_DIBUJO.map((r) => {
        const texto = textoDe(r.clave);
        const medio = medioTexto(texto);
        return { texto, x0: r.etiqueta[0] - medio, x1: r.etiqueta[0] + medio, y0: r.etiqueta[1] - 13, y1: r.etiqueta[1] + 4 };
      });
      for (const r of REGIONES_DIBUJO) {
        const [mx, my] = puntoMarca(r, textoDe(r.clave));
        for (const c of cajas) {
          if (mx + RADIO > c.x0 && mx - RADIO < c.x1 && my + RADIO > c.y0 && my - RADIO < c.y1) tapados.push(`${r.clave}${cifra ? ' con número' : ''}: marca en (${mx}, ${my}) bajo «${c.texto}»`);
        }
      }
    }
    expect(tapados).toEqual([]);
    // Y las regiones con etiqueta interior no dejan la marca en el centro (que es donde está el texto).
    for (const r of REGIONES_DIBUJO) {
      if (r.guia || r.exterior || r.capa === 'vasos' || r.clave === 'tronco_locus_coeruleus') continue;
      expect(puntoMarca(r), `${r.clave}: la marca sigue en el centro, bajo la etiqueta`).not.toEqual(r.centro);
    }
  });

  it('el foco de teclado sobre una región no dibuja el rectángulo de contorno del navegador sobre su caja envolvente', () => {
    // styles.css tiene una regla global `:focus-visible { outline: 2px solid var(--accent) }` y
    // main.tsx importa styles.css DESPUÉS de App (y por tanto después de atlas.css), así que en el
    // CSS compilado esa regla iba detrás de `.atlas-region { outline: none }`, con la misma
    // especificidad, y ganaba. Medido en Chromium sobre la compilación servida, con Tab hasta la
    // corteza parietal: outline-style solid, 2 px, rgb(183, 156, 242). En un <path> el contorno se
    // pinta sobre la CAJA envolvente, no sobre la forma: al tabular por el frontal aparecía un
    // rectángulo violeta de 288 por 294 unidades que cruzaba la sustancia blanca, el tálamo y el
    // cíngulo, y el foco pensado (trazo de 2,5 y resplandor) quedaba debajo. atlas.css tiene que
    // anular el contorno con más especificidad que la regla global: una regla con `:focus-visible`
    // y una clase del atlas en el selector que ponga `outline: none` (o 0).
    expect(CSS_ESTILOS).toMatch(/(^|\n):focus-visible\s*\{[^}]*outline:\s*\d/);
    const reglas = [...CSS_ATLAS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), cuerpo: m[2]! }));
    const anula = reglas.filter((r) => r.selector.includes(':focus-visible') && /\.atlas-[\w-]+/.test(r.selector) && /outline:\s*(none|0)\b/.test(r.cuerpo));
    expect(anula.map((r) => r.selector)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La pantalla montada: cifras que se contradicen y textos que no dicen la verdad
// ---------------------------------------------------------------------------

vi.mock('motion/react', async (original) => ({ ...(await original<typeof import('motion/react')>()), useReducedMotion: () => true }));

beforeAll(() => {
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

const FECHA = Date.UTC(2026, 8, 12, 10, 0, 0);

function hecho(id: string, enunciado: string): HechoMundo {
  return { id, investigacionId: 'inv-1', tipo: 'hecho', tema: 'Tema de prueba', enunciado, estado: 'sabido', origen: 'fuente', procedencia: [], motivoDescarte: null, actualizadoEn: FECHA, prioridad: 1, citas: [], historial: [{ fecha: FECHA, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido en la iteración 2' }] };
}

function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

/** El estado de muestra con tres hechos propios y un mapa con las celdas, el resumen y los ejes dados. */
function estadoConCeldas(celdas: CeldaMapa[], resumen: string, region: Record<string, number> = {}): { estado: EstadoRosa; inv: Investigacion } {
  const estado = structuredClone(estadoDeMuestra());
  const inv = estado.investigaciones[0]!;
  const mapa: MapaEnfermedad = {
    ejes: { estadio: {}, region, tipoCelular: {}, nivel: {} },
    celdas,
    huecos: [],
    sinEjes: 0,
    hipotesisSinEjes: 0,
    heredados: 0,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen,
    fecha: FECHA,
    iteracion: 2,
    etiquetas: ETIQUETAS_MAPA,
    definiciones: DEFINICIONES_MAPA,
  };
  inv.mapaEnfermedad = mapa;
  estado.hechos = [
    hecho('he-a', 'Mundada et al. estudiaron participantes de ADNI con deterioro cognitivo y PET de amiloide y tau: la atrofia del hipocampo siguió a la tau.'),
    hecho('he-b', 'En ENGAGE y EMERGE, Belder et al. describen una reducción amiloide de 54 a 62 Centiloides con cambio volumétrico del hipocampo.'),
    hecho('he-c', 'p-tau217 plasmático distingue amiloide positivo en atención primaria.'),
  ].map((h) => ({ ...h, investigacionId: inv.id }));
  // Sin corridas de la investigación: ninguna consulta ni fuente nombra región alguna.
  estado.corridas = estado.corridas.filter((c) => c.investigacionId !== inv.id);
  estado.hipotesis = estado.hipotesis.filter((h) => h.investigacionId !== inv.id);
  return { estado, inv };
}

/** Una corrida de la investigación con las fuentes excluidas dadas (el resto, copiado de la muestra). */
function corridaConExcluidos(inv: Investigacion, excluidos: { titulo: string; referencia: string }[]): Corrida {
  const base = structuredClone(estadoDeMuestra().corridas[0]!);
  return {
    ...base,
    id: 'cor-atlas-cierre',
    investigacionId: inv.id,
    busqueda: {
      ...base.busqueda,
      consultas: [],
      excluidos: excluidos.map((x) => ({ referencia: x.referencia, titulo: x.titulo, relevancia: 0.2, motivo: 'fuera del alcance de la misión', iteracion: 1, consulta: 'x' })),
    },
  };
}

/** Deja pasar el frame y el temporizador que vienen detrás: desde el 19 de
 *  septiembre de 2026 el atlas se construye DESPUÉS del pintado
 *  (lib/diferido.ts, useCalculoDiferido) y el primer render es su silueta
 *  (EsqueletoAtlas), así que montar y pulsar un filtro esperan a ese frame. */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** La pantalla abre en relieve, que es un lienzo: para examinar el dibujo
 *  region a region estos tests piden la vista 2D, como hace quien va a leerlo. */
const montar = async (estado: EstadoRosa, inv: Investigacion) => {
  await act(async () => root.render(<Atlas inv={inv} estado={estado} />));
  await esperarPintado();
  const plano = [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Vista 2D');
  if (plano && plano.getAttribute('aria-pressed') === 'false') {
    await act(async () => {
      plano.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await esperarPintado();
  }
};
const region = (clave: string) => nodo.querySelector<SVGPathElement>(`[role="button"][data-clave="${clave}"]`)!;
const pulsar = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await esperarPintado();
};
const panel = () => nodo.querySelector('.atlas-panel')!.textContent ?? '';
const leyenda = () => nodo.querySelector('.atlas-leyenda')!.textContent ?? '';

describe('la pantalla del atlas (adversario del cierre)', () => {
  it('el panel no imprime un resumen del backend cuyas cifras contradicen a la figura y a los chips', async () => {
    // En el estado real de inv-mu2sz2ns-3 (rosa.db, 19 de septiembre de 2026) el panel «El mapa en
    // cifras» abre con el `resumen` del backend tal cual: «217 hechos y 9 hipótesis situados en 66
    // celdas... Estadios: autosómica dominante 47... Regiones: sangre, plasma y suero 107, LCR 53».
    // Las celdas de ese mismo mapa tienen 211 hechos, 42 en autosómica dominante, 106 en la sangre
    // y 52 en el LCR, que es lo que pintan la figura («sangre y plasma · 106», «LCR · 52»), el chip
    // «autosómica dominante 42» y la línea «145 hechos y 8 hipótesis en la figura». Causa: al fundir
    // hechos duplicados, rosa/hechos.py (_remapear_investigacion) reescribe los ids de las celdas
    // pero no recalcula `ejes` ni `resumen`, y la pantalla los imprime sin cotejarlos. La misma
    // pantalla dice 107 y 106 para la sangre. Aquí, a escala: dos hechos en la sangre y un resumen
    // que dice tres.
    const { estado, inv } = estadoConCeldas([celda({ region: 'plasma', hechos: ['he-a', 'he-b'] })], '3 hechos y 0 hipótesis situados en 1 celda (estadio, región y tipo celular). Regiones: sangre, plasma y suero (compartimento periférico) 3.', { plasma: 3 });
    await montar(estado, inv);
    const texto = panel();
    // Lo que calcula la propia pantalla está bien...
    expect(texto).toMatch(/\b2 hechos\b/);
    expect(region('plasma').getAttribute('data-conteo')).toBe('2');
    // ...y no puede convivir en el mismo panel con la cifra desfasada del backend.
    expect(texto).not.toMatch(/3 hechos y 0 hipótesis situados/);
    expect(texto).not.toMatch(/periférico\) 3\b/);
  });

  it('una región con hechos y sin hipótesis no dice «ninguna cohorte nombrada en sus registros»: las cohortes salen solo de las hipótesis', async () => {
    // rosa/mapa_enfermedad.py llena `celda.cohortes` únicamente con las cohortes de las afirmaciones
    // de las HIPÓTESIS de la celda; los hechos no aportan ninguna, digan lo que digan. En el estado
    // real, las 66 celdas sin hipótesis tienen 0 cohortes, y el hipocampo (15 hechos de 11 fuentes
    // distintas; «Mundada et al. estudiaron participantes de ADNI...», «En ENGAGE y EMERGE, Belder et
    // al...») sale en el extremo frío con el panel diciendo «Ninguna cohorte nombrada en sus
    // registros». Es falso: sus registros nombran ADNI, ENGAGE y EMERGE; lo que no hay son hipótesis.
    // El texto tiene que decir de dónde salen las cohortes (de las hipótesis) en vez de afirmar
    // algo sobre los registros que nadie comprobó.
    const { estado, inv } = estadoConCeldas([celda({ region: 'hipocampo', hechos: ['he-a', 'he-b'] })], '2 hechos situados.');
    await montar(estado, inv);
    await pulsar(region('hipocampo'));
    const texto = panel();
    expect(texto).not.toMatch(/Ninguna cohorte nombrada en sus registros/);
    const frase = texto.match(/[^.]*cohorte[^.]*\./)?.[0] ?? '';
    expect(frase).toMatch(/hipótesis/);
  });

  it('los extremos de la leyenda son los de la rampa (0 cohortes en el frío, el máximo en el cálido), no el mínimo y el máximo presentes', async () => {
    // La rampa (lib/atlas.ts intensidad) pinta 0 cohortes en violeta y `cohortesMax` en ámbar, sin
    // mirar el mínimo. La leyenda escribía «violeta apagado, {cohortesMin}; ámbar brillante, (hoy «ámbar tenue» y «ámbar pleno»)
    // {cohortesMax}». Si la única región con registros tiene 3 cohortes se pinta ámbar (t = 1) y la
    // leyenda dice «violeta apagado, 3; ámbar brillante, 3». Y con el filtro «preclínica» del
    // estado real (todas las regiones con registros tienen 0 cohortes) la leyenda dice «ámbar
    // brillante, 0» cuando nada es ámbar. Atlas.test.tsx fija incluso el «3/3».
    const tres = estadoConCeldas([celda({ region: 'plasma', hechos: ['he-a', 'he-b'], cohortes: ['ADNI', 'BioFINDER', 'A4'] })], '2 hechos situados.');
    await montar(tres.estado, tres.inv);
    expect(region('plasma').getAttribute('data-intensidad')).toBe('1.00');
    expect(leyenda()).not.toMatch(/ámbar tenue, 3\b/);
    await act(async () => root.unmount());
    root = createRoot(nodo);
    const cero = estadoConCeldas([celda({ region: 'plasma', hechos: ['he-a', 'he-b'] })], '2 hechos situados.');
    await montar(cero.estado, cero.inv);
    expect(region('plasma').getAttribute('data-intensidad')).toBe('0.00');
    expect(leyenda()).not.toMatch(/ámbar pleno, 0\b/);
  });

  it('con una sola fuente el panel del hueco concuerda en número: «1 fuente leída... la nombra», no «la nombran»', async () => {
    // En el estado real, la corteza parietal: «Buscada sin hallazgo: 1 fuente leída de esta
    // investigación la nombran y ninguna produjo...». fraseCobertura() de Atlas.tsx une las partes
    // con coma y cierra siempre con «la nombran».
    const { estado, inv } = estadoConCeldas([celda({ region: 'plasma', hechos: ['he-c'] })], '1 hecho situado.');
    estado.corridas.push(corridaConExcluidos(inv, [{ titulo: 'Parietal cortex atrophy in early-onset Alzheimer disease', referencia: 'Prueba 2024' }]));
    await montar(estado, inv);
    expect(region('corteza_parietal').getAttribute('data-cobertura')).toBe('buscada_sin_hallazgo');
    await pulsar(region('corteza_parietal'));
    const texto = panel();
    expect(texto).toMatch(/1 fuente leída/);
    expect(texto).not.toMatch(/1 fuente leída de esta investigación la nombran/);
    expect(texto).toMatch(/1 fuente leída de esta investigación la nombra\b/);
  });
});
