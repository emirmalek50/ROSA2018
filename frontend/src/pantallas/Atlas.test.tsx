// @vitest-environment jsdom
// La pantalla del atlas montada de verdad, con un mapa REAL recortado (cuatro
// celdas de la investigación inv-mu2sz2ns-3 del 18 de septiembre de 2026, con
// sus ids y textos, sobre el estado de muestra): el color va por cohortes y el
// número por registros; las localizaciones fallidas (cerebro y corteza "sin
// región") salen de la anatomía a la bandeja; la línea honesta separa fluidos,
// tejido y sin localizar; la discordia lleva marca; los huecos van rayados de
// dos maneras (no buscado, buscado sin hallazgo); pulsar una región (con el
// ratón o con Enter) llena el panel; los filtros cambian los conteos; el
// estado vacío explica cuándo se dibuja; la leyenda está en castellano con
// tildes y trae los extremos reales; no hay porcentajes de confianza ni
// "tiempo real". Mismo patrón de montaje que Arbol.test.tsx (createRoot y
// act), con movimiento reducido para que no haya transiciones.
//
// Desde el 19 de septiembre de 2026 el atlas se construye DESPUÉS del pintado
// (lib/diferido.ts, useCalculoDiferido), no en el render: el primer render es
// la silueta (EsqueletoAtlas) y los conteos llegan un frame después. Por eso
// `montar`, `pulsar` y `tecla` esperan a ese frame antes de devolver: sin la
// espera, un test leería el mapa anterior (o la silueta) justo después de
// pulsar un chip. El bloque "la espera del atlas" prueba la silueta misma.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFINICIONES_MAPA, ETIQUETAS_MAPA } from '../componentes/MapaEnfermedad';
import { estadoDeMuestra } from '../datos/muestra';
import type { CeldaMapa, Corrida, EstadoRosa, HechoMundo, Hipotesis, Investigacion, MapaEnfermedad } from '../datos/tipos';
import { NOMBRE_CORTO, VISTA } from '../lib/atlas_dibujo';
import { rutaDe } from '../lib/ruta';
import { Atlas, EsqueletoAtlas, ROTULO_ATLAS } from './Atlas';
import { copiaTraducida } from '../lib/idioma';

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

function hecho(id: string, tema: string, enunciado: string, tipo: HechoMundo['tipo'] = 'hecho'): HechoMundo {
  return { id, investigacionId: 'inv-1', tipo, tema, enunciado, estado: tipo === 'pregunta' ? 'abierto' : 'sabido', origen: 'fuente', procedencia: [], motivoDescarte: null, actualizadoEn: FECHA, prioridad: 1, citas: [], historial: [{ fecha: FECHA, de: null, a: tipo === 'pregunta' ? 'abierto' : 'sabido', quien: 'Rosa', motivo: 'Añadido en la iteración 2' }] };
}

function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

/** Hechos reales de inv-mu2sz2ns-3 (enunciados tal cual, recortados). */
const HECHOS: HechoMundo[] = [
  hecho('he-mtvwph1c-6', 'Secuencia presintomática en Alzheimer autosómico dominante', 'En Johansson et al., GFAP fue el primero de los biomarcadores plasmáticos estudiados en aumentar durante la fase presintomática, aproximadamente 10 años antes del inicio estimado de síntomas; P-tau181 y NfL aumentaron después. [Johansson et al., 2023, resumen]'),
  hecho('he-mtvwph1d-14', 'Diseño longitudinal y plataforma analítica en Alzheimer familiar', 'Belder et al. evaluaron una cohorte longitudinal de Alzheimer autosómico dominante de 113 individuos, 73 portadores de mutación y 40 no portadores, con 270 muestras de plasma y 124 proteínas medidas mediante un panel NULISA. [Belder et al., 2026, resumen]'),
  hecho('he-mtvwph1d-18', 'Plasma en portadores de mutación', 'En portadores de mutación, GFAP plasmático mostró la mayor tasa de cambio anual de los biomarcadores del panel en la década previa al inicio estimado de síntomas.'),
  hecho('he-mtvukigd-89', 'Perfiles inflamatorios según amiloide', 'Hussain et al. describieron, al estratificar por amiloide, un perfil independiente de amiloide con 14 citocinas y NfL, y otro específico de amiloide que incluía GFAP, IL-1β e IL-18.'),
  hecho('he-mtvwph1d-8', 'Comparación entre plasma y LCR', 'La concentración plasmática de GFAP se correlacionó con la del LCR de forma moderada en la misma cohorte, y su relación con la PET de amiloide fue mayor en plasma que en LCR.'),
  hecho('he-mu2tf94k-1657', 'Rendimiento diagnóstico de p-tau217', 'El p-tau217 plasmático alcanzó una precisión del 90 por ciento frente a la PET de amiloide en una cohorte de atención primaria.'),
  hecho('he-mu5jp1af-9579', 'Efecto del tratamiento sobre biomarcadores', 'Con lecanemab, GFAP y p-tau181 plasmáticos bajaron respecto al placebo en 18 meses, mientras que NfL no cambió.'),
  hecho('he-mu3708eb-3560', 'Marcadores microgliales en LCR', 'El sTREM2 en LCR, marcador de activación microglial, sube en la fase de tau positiva y se asocia a un declive más lento.'),
  hecho('he-mu7betru-7511', 'Microglía y LCR', 'La concentración de YKL-40 en LCR aumentó con la edad y con la positividad de tau, con independencia del amiloide.'),
  hecho('he-mu35idbi-2429', 'Pregunta sobre plasma', '¿La bajada de GFAP plasmático con el tratamiento antiamiloide se sostiene tras suspenderlo?', 'pregunta'),
];

/** Cuatro celdas reales del mapa de inv-mu2sz2ns-3 (18 de septiembre de 2026), con los ids recortados a los hechos de arriba. */
function mapaReal(): MapaEnfermedad {
  return {
    ejes: { estadio: { autosomico_dominante: 6 }, region: { plasma: 8, lcr: 2, cerebro_sin_region: 2 }, tipoCelular: { microglia: 2, astrocito: 2 }, nivel: { molecular: 9, clinico: 5 } },
    celdas: [
      { estadio: null, region: 'plasma', tipoCelular: null, hechos: ['he-mtvukigd-89', 'he-mtvwph1d-8', 'he-mu2tf94k-1657', 'he-mu5jp1af-9579'], hipotesis: [], preguntas: ['he-mu35idbi-2429'], porMision: 0, certezaMax: null, certezaMotivo: 'sin hipótesis en la celda: la certeza GRADE se calcula por hipótesis', cohortes: [] },
      { estadio: 'autosomico_dominante', region: 'plasma', tipoCelular: null, hechos: ['he-mtvwph1c-6', 'he-mtvwph1d-14', 'he-mtvwph1d-18'], hipotesis: ['hip-mu2zz5y8-2440'], preguntas: [], porMision: 0, certezaMax: 'muy_baja', certezaMotivo: 'la mayor certeza GRADE entre las conclusiones de la única hipótesis de la celda', cohortes: ['ADNI (n=141)', 'DIAN-TU-001', 'cohorte sueca de ADAD'] },
      { estadio: null, region: 'lcr', tipoCelular: 'microglia', hechos: ['he-mu3708eb-3560', 'he-mu7betru-7511'], hipotesis: [], preguntas: [], porMision: 0, certezaMax: null, certezaMotivo: 'sin hipótesis en la celda: la certeza GRADE se calcula por hipótesis', cohortes: [] },
      { estadio: 'autosomico_dominante', region: 'cerebro_sin_region', tipoCelular: 'astrocito', hechos: [], hipotesis: ['hip-mu2tgh7o-1740', 'hip-mu2uajpx-4553'], preguntas: [], porMision: 0, certezaMax: 'muy_baja', certezaMotivo: 'la mayor certeza GRADE entre las conclusiones de las 2 hipótesis de la celda', cohortes: ['DIAN-TU-001 (DIAD)', 'TRAILBLAZER-ALZ'] },
    ],
    huecos: [],
    sinEjes: 3,
    hipotesisSinEjes: 0,
    heredados: 2,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen: '9 hechos y 3 hipótesis situados en 4 celdas (estadio, región y tipo celular). Regiones: sangre, plasma y suero (compartimento periférico) 8, líquido cefalorraquídeo (LCR) 2, cerebro (sin región concreta) 2. Sin situar: 3 hechos y 0 hipótesis.',
    fecha: FECHA,
    iteracion: 2,
    // copiaTraducida: en produccion estas dos llegan del servidor como JSON
    // plano. Aqui salen de las constantes de la interfaz, que son Proxies
    // de `traducido()` y no se pueden clonar; el test clona el mapa.
    etiquetas: copiaTraducida(ETIQUETAS_MAPA),
    definiciones: copiaTraducida(DEFINICIONES_MAPA),
  };
}

/** El estado de muestra con los hechos reales, tres hipótesis reales (clonadas de la muestra) y el mapa. */
function estadoConMapa(): { estado: EstadoRosa; inv: Investigacion } {
  const e = structuredClone(estadoDeMuestra());
  const inv = e.investigaciones[0]!;
  inv.mapaEnfermedad = mapaReal();
  const plantilla = e.hipotesis[0]!;
  // Con conclusión "muy baja": lib/atlas.ts toma la certeza viva de la hipótesis (no la de la celda) cuando la hipótesis está en el estado.
  const hip = (id: string, titulo: string, cluster: string): Hipotesis => ({ ...structuredClone(plantilla), id, titulo, cluster, investigacionId: inv.id, creadaEn: FECHA, iteracion: 2, conclusion: { ...(plantilla.conclusion ?? {}), certeza: 'muy_baja' } as Hipotesis['conclusion'] });
  e.hipotesis = [
    hip('hip-mu2zz5y8-2440', 'La persistencia de la reducción de P-tau181, frente a su rebote, distingue una respuesta clínicamente informativa', 'Persistencia de respuesta'),
    hip('hip-mu2tgh7o-1740', 'La activación astrocitaria medida por GFAP precede a la subida de NfL en portadores', 'Secuencia glial'),
    hip('hip-mu2uajpx-4553', 'El descenso de GFAP con antiamiloides refleja menos reactividad astrocitaria, no menos neurodegeneración', 'Secuencia glial'),
  ];
  e.hechos = HECHOS.map((h) => ({ ...h, investigacionId: inv.id }));
  return { estado: e, inv };
}

/** Una corrida más de la investigación con las consultas y exclusiones dadas (el resto, copiado de la muestra). */
function corridaCon(estado: EstadoRosa, inv: Investigacion, consultas: { consulta: string; tema?: string }[], excluidos: { titulo: string; referencia: string }[] = []): Corrida {
  const base = structuredClone(estado.corridas[0]!);
  return {
    ...base,
    id: 'cor-atlas-test',
    investigacionId: inv.id,
    busqueda: {
      ...base.busqueda,
      consultas: consultas.map((c) => ({ base: 'PubMed', consulta: c.consulta, fecha: FECHA, resultados: 12, ...(c.tema ? { tema: c.tema } : {}) })),
      excluidos: excluidos.map((x) => ({ referencia: x.referencia, titulo: x.titulo, relevancia: 0.2, motivo: 'fuera del alcance de la misión', iteracion: 1, consulta: 'x' })),
    },
  };
}

/** Deja pasar el frame y el temporizador que vienen detrás (rAF en jsdom corre cada 16 ms). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** Monta el atlas SIN esperar al pintado: lo que se ve en el primer render. */
const montarSinEsperar = async (estado: EstadoRosa, inv: Investigacion) => {
  await act(async () => root.render(<Atlas inv={inv} estado={estado} />));
};
/** Monta el atlas y espera a que el cálculo diferido lo haya pintado. La
 *  pantalla abre en relieve, que es un lienzo: para mirar el dibujo region a
 *  region estos tests piden la vista 2D, como hace quien quiere leerlo. */
const montar = async (estado: EstadoRosa, inv: Investigacion) => {
  await montarSinEsperar(estado, inv);
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
const regiones = () => [...nodo.querySelectorAll<SVGPathElement>('[role="button"][data-clave]')];
/** Pulsa sin esperar: lo que se ve en el render inmediato. */
const pulsarSinEsperar = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
/** Pulsa y espera al pintado (un chip o un interruptor recalculan el atlas). */
const pulsar = async (el: Element) => {
  await pulsarSinEsperar(el);
  await esperarPintado();
};
const tecla = async (el: Element, key: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await esperarPintado();
};
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(texto))!;
const panel = () => nodo.querySelector('.atlas-panel')!.textContent ?? '';
const bandeja = () => nodo.querySelector('.atlas-bandeja')!;
const honesta = () => nodo.querySelector('.atlas-honesta')?.textContent ?? '';
const cabecera = () => nodo.querySelector('.pantalla-cabecera')?.textContent ?? '';
const SIN_TILDE = /\b(hipotesis|investigacion|region|regiones sin|celula|iteracion|todavia|Todavia|liquido|cefalorraquideo|microglia|amigdala|cingulo|precuneo|talamo|hematoencefalica|autosomica|sintomas|fase de la enfermedad sin|Como creció|Cómo crecio|leyo|catalogo|localizacion|numero|cuantas|cuantos|busqueda|leida|leidas)\b/;
/** El texto que un lector de pantalla encontraría: todo lo que no está aria-hidden. */
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('la pantalla del atlas', () => {
  it('pinta las dieciocho regiones localizadas como botones accesibles; el color va por cohortes, el número por registros y las vacías van rayadas', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    const todas = regiones();
    // Las dos localizaciones fallidas (cerebro y corteza "sin región") ya no están en la anatomía.
    expect(todas.length).toBe(18);
    expect(todas.map((r) => r.dataset.clave)).not.toContain('cerebro_sin_region');
    expect(todas.map((r) => r.dataset.clave)).not.toContain('neocorteza');
    for (const r of todas) {
      expect(r.getAttribute('tabindex')).toBe('0');
      expect(r.getAttribute('aria-label')).toMatch(/^.+: \d+ registros? de evidencia \(\d+ hechos?, \d+ hipótesis\); \d+ cohortes? distintas?/);
      expect(r.getAttribute('aria-pressed')).toBe('false');
    }
    // Sangre y plasma: 7 hechos y 1 hipótesis, 3 cohortes distintas (el máximo de cohortes: la más intensa).
    expect(region('plasma').getAttribute('aria-label')).toContain('sangre, plasma y suero (compartimento periférico): 8 registros de evidencia (7 hechos, 1 hipótesis); 3 cohortes distintas');
    expect(region('plasma').getAttribute('data-conteo')).toBe('8');
    expect(region('plasma').getAttribute('data-cohortes')).toBe('3');
    expect(region('plasma').getAttribute('data-intensidad')).toBe('1.00');
    expect(region('plasma').classList.contains('atlas-hueco')).toBe(false);
    expect(region('plasma').classList.contains('atlas-resplandor-4')).toBe(true);
    // El LCR tiene 2 registros pero ninguna cohorte nombrada: número 2, color en el extremo frío, y NO es un hueco.
    expect(region('lcr').getAttribute('data-conteo')).toBe('2');
    expect(region('lcr').getAttribute('data-cohortes')).toBe('0');
    expect(region('lcr').getAttribute('data-intensidad')).toBe('0.00');
    expect(region('lcr').classList.contains('atlas-hueco')).toBe(false);
    // El hipocampo no tiene nada: rayado, y nadie lo buscó.
    expect(region('hipocampo').getAttribute('data-intensidad')).toBe('0.00');
    expect(region('hipocampo').classList.contains('atlas-hueco')).toBe(true);
    expect(region('hipocampo').getAttribute('aria-label')).toContain('hueco: sin evidencia situada todavía (no buscada)');
    // La más intensa de todas es plasma, y solo ella.
    const intensidades = todas.map((r) => [r.dataset.clave, Number(r.getAttribute('data-intensidad'))] as const);
    const maxima = Math.max(...intensidades.map(([, t]) => t));
    expect(intensidades.filter(([, t]) => t === maxima).map(([c]) => c)).toEqual(['plasma']);
    // La figura: viewBox del contrato, el rótulo del grupo y las etiquetas de las dieciocho regiones, con el número junto al nombre.
    const svg = nodo.querySelector('svg.atlas-figura')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 620');
    expect(svg.getAttribute('aria-label')).toContain('2 regiones con evidencia de 18');
    const etiquetas = [...nodo.querySelectorAll('.atlas-etiqueta')].map((e) => e.textContent ?? '');
    expect(etiquetas.length).toBe(18);
    // El nombre corto lo pone el dibujo (lib/atlas_dibujo.ts); aquí solo importa que lleve el número al lado.
    expect(etiquetas).toContain(`${NOMBRE_CORTO.plasma}· 8`);
    expect(etiquetas).toContain(`${NOMBRE_CORTO.lcr}· 2`);
    expect(etiquetas).toContain(NOMBRE_CORTO.hipocampo);
    expect(etiquetas.join('\n')).not.toContain('cerebro (sin región)');
    expect(etiquetas.join('\n')).not.toContain('corteza (sin región)');
    // La silueta neutra del cerebro está debajo de las regiones, sin conteo: la lámina anatómica
    // (cuatro campos de color y 146 trazos de tinta) y los compartimentos de fuera en su color.
    expect(nodo.querySelector('.atlas-silueta')).not.toBeNull();
    expect(nodo.querySelectorAll('.atlas-silueta .atlas-lamina-campo').length).toBe(4);
    expect(nodo.querySelectorAll('.atlas-silueta .atlas-lamina-tinta').length).toBe(146);
    expect(nodo.querySelectorAll('.atlas-silueta .atlas-exterior-base').length).toBeGreaterThanOrEqual(3);
    // La lámina va ANTES que las regiones en el documento: las regiones se pintan encima.
    const orden = [...nodo.querySelectorAll('svg.atlas-figura > *')].map((el) => el.getAttribute('class') ?? el.tagName);
    expect(orden.indexOf('atlas-silueta')).toBeLessThan(orden.indexOf('atlas-regiones'));
    // Los vasos llevan además su zona de pulsación ancha.
    expect(nodo.querySelector('.atlas-vasos-area')).not.toBeNull();
  });

  it('pulsar una región llena el panel con su definición, cohortes, barras, certeza, hipótesis, hechos y enlaces', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    // Sin selección: el resumen del mapa, la línea honesta y cómo leerlo.
    expect(panel()).toContain('El mapa en cifras');
    expect(panel()).toContain('3 hechos sin situar');
    expect(panel()).toContain('2 hechos heredados');
    expect(panel()).toContain('2 registros no localizados');
    expect(panel()).toContain('Pulsa una región');
    await pulsar(region('plasma'));
    expect(region('plasma').getAttribute('aria-pressed')).toBe('true');
    expect(nodo.querySelector('.atlas-seleccion')).not.toBeNull();
    const p = panel();
    expect(p).toContain('sangre, plasma y suero (compartimento periférico)');
    expect(p).toContain('Compartimento');
    expect(p).toContain('7 hechos');
    expect(p).toContain('1 hipótesis');
    expect(p).toContain('1 pregunta abierta');
    // Las cohortes distintas (el color) con sus nombres.
    expect(p).toContain('3 cohortes distintas');
    expect(p).toContain('DIAN-TU-001');
    // La definición en llano de la región (de lib/atlas.ts) y las barras por fase.
    expect(p).toMatch(/análisis de sangre|Compartimento periférico/);
    expect(p).toContain('Por fase de la enfermedad');
    expect(p).toContain('autosómica dominante');
    expect(p).toContain('sin fase identificada');
    // La mayor certeza GRADE entre sus hipótesis.
    expect(p).toContain('muy baja');
    // La hipótesis con enlace a su ficha; los hechos con su tema y el enlace al modelo de mundo.
    const enlaceHip = nodo.querySelector(`a[href="${rutaDe(inv.id, 'hipotesis', 'hip-mu2zz5y8-2440')}"]`);
    expect(enlaceHip?.textContent).toContain('La persistencia de la reducción de P-tau181');
    expect(p).toContain('Secuencia presintomática en Alzheimer autosómico dominante');
    expect(p).toContain('Johansson et al.');
    expect(nodo.querySelector(`a[href="${rutaDe(inv.id, 'mundo')}"]`)?.textContent).toContain('modelo de mundo');
    expect(p).toContain('¿La bajada de GFAP plasmático');
    // Pulsar otra vez la misma región quita la selección.
    await pulsar(region('plasma'));
    expect(region('plasma').getAttribute('aria-pressed')).toBe('false');
    expect(panel()).toContain('El mapa en cifras');
    // El LCR: hechos y ninguna hipótesis, así que 0 cohortes; el panel dice de dónde salen las cohortes en vez de afirmar algo sobre los hechos.
    await pulsar(region('lcr'));
    expect(panel()).toContain('Sin hipótesis situadas aquí');
    expect(panel()).toContain('las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos');
    expect(panel()).toContain('extremo frío');
    expect(panel()).not.toContain('Ninguna cohorte nombrada');
    // Una región vacía se explica como hueco y dice si alguien la buscó.
    await pulsar(region('hipocampo'));
    expect(panel()).toContain('hipocampo');
    expect(panel()).toContain('Hueco: sin evidencia situada todavía');
    expect(panel()).toContain('No buscada');
    expect(panel()).toContain('recuerdos nuevos');
  });

  it('se maneja con el teclado: Enter selecciona y el foco enseña el rótulo con nombre, conteo y cohortes', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    await act(async () => {
      region('lcr').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const flotante = nodo.querySelector('.atlas-flotante')!;
    expect(flotante).not.toBeNull();
    expect(flotante.textContent).toContain(NOMBRE_CORTO.lcr);
    expect(flotante.textContent).toContain('2 hechos');
    expect(flotante.textContent).toContain('0 cohortes');
    await tecla(region('lcr'), 'Enter');
    expect(region('lcr').getAttribute('aria-pressed')).toBe('true');
    expect(panel()).toContain('líquido cefalorraquídeo (LCR)');
    // Sobre un hueco el rótulo no dice "0 · 0 hechos, 0 hipótesis · 0 cohortes": dice que es un hueco y si alguien lo buscó.
    await act(async () => {
      region('hipocampo').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const flotanteHueco = nodo.querySelector('.atlas-flotante')!.textContent ?? '';
    expect(flotanteHueco).toContain('hueco: sin evidencia situada (no buscada)');
    expect(flotanteHueco).not.toContain('0 hechos');
    expect(panel()).toContain('Por tipo de célula');
    expect(panel()).toContain('microglía');
    // Espacio sobre otra región cambia la selección; una tecla cualquiera no.
    await tecla(region('cerebelo'), 'a');
    expect(region('lcr').getAttribute('aria-pressed')).toBe('true');
    await tecla(region('cerebelo'), ' ');
    expect(region('cerebelo').getAttribute('aria-pressed')).toBe('true');
    expect(region('lcr').getAttribute('aria-pressed')).toBe('false');
  });

  it('los filtros de fase y de célula cambian los conteos de las regiones', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    // Los chips de fase con su conteo y los interruptores de célula.
    expect(boton('Todas').getAttribute('aria-pressed')).toBe('true');
    const chipADAD = boton('autosómica dominante');
    expect(chipADAD.textContent).toContain('6');
    await pulsar(chipADAD);
    expect(chipADAD.getAttribute('aria-pressed')).toBe('true');
    expect(region('plasma').getAttribute('data-conteo')).toBe('4');
    expect(region('plasma').getAttribute('aria-label')).toContain('4 registros de evidencia (3 hechos, 1 hipótesis)');
    // El LCR no tiene nada en esa fase: pasa a hueco.
    expect(region('lcr').getAttribute('data-conteo')).toBe('0');
    expect(region('lcr').classList.contains('atlas-hueco')).toBe(true);
    await pulsar(boton('Todas'));
    expect(region('plasma').getAttribute('data-conteo')).toBe('8');
    // Célula: solo microglía deja el LCR y apaga la sangre.
    const microglia = [...nodo.querySelectorAll<HTMLInputElement>('.atlas-interruptor input')].find((i) => i.parentElement?.textContent?.includes('microglía'))!;
    expect(microglia).toBeTruthy();
    await pulsar(microglia);
    expect(microglia.checked).toBe(true);
    expect(region('lcr').getAttribute('data-conteo')).toBe('2');
    expect(region('plasma').getAttribute('data-conteo')).toBe('0');
    expect(region('plasma').classList.contains('atlas-hueco')).toBe(true);
    expect(nodo.querySelector('.grafo-tiempo')?.textContent).toContain('1 región con evidencia');
  });

  it('el deslizador "Cómo creció" va como el del árbol: En vivo y Volver al presente', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    const etiqueta = nodo.querySelector('label[for="atlas-iteracion"]')!;
    expect(etiqueta.textContent).toMatch(/^Cómo creció: hasta la iteración \d+ de \d+$/);
    expect(boton('En vivo')).toBeTruthy();
    expect(boton('En vivo').getAttribute('aria-pressed')).toBe('true');
    const rango = nodo.querySelector<HTMLInputElement>('#atlas-iteracion')!;
    const maximo = estado.iteraciones.reduce((m, i) => Math.max(m, i.numero), 1);
    expect(rango.max).toBe(String(maximo));
    // El presente: el deslizador en el máximo y la etiqueta con ese número.
    expect(rango.value).toBe(String(maximo));
    expect(etiqueta.textContent).toContain(`hasta la iteración ${maximo} de ${maximo}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(rango, '1');
      rango.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await esperarPintado();
    expect(etiqueta.textContent).toContain('hasta la iteración 1 de');
    expect(boton('Volver al presente')).toBeTruthy();
    // En la iteración 1 los hechos (nacidos después) desaparecen; el máximo de color no se reescala.
    expect(region('plasma').getAttribute('data-conteo')).toBe('0');
    await pulsar(boton('Volver al presente'));
    expect(boton('En vivo')).toBeTruthy();
    expect(region('plasma').getAttribute('data-conteo')).toBe('8');
    // Arrastrar el deslizador hasta el máximo es el presente, no un filtro.
    expect(maximo).toBeGreaterThan(1);
    await act(async () => {
      setter.call(rango, String(maximo - 1));
      rango.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await esperarPintado();
    expect(boton('Volver al presente')).toBeTruthy();
    await act(async () => {
      setter.call(rango, String(maximo));
      rango.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await esperarPintado();
    expect(boton('En vivo')).toBeTruthy();
    expect(boton('En vivo').getAttribute('aria-pressed')).toBe('true');
    expect(honesta()).not.toContain('con los filtros puestos');
  });

  it('sin mapa enseña el estado vacío en llano con el enlace al árbol', async () => {
    const { estado, inv } = estadoConMapa();
    inv.mapaEnfermedad = null;
    await montar(estado, inv);
    expect(nodo.textContent).toContain('ROSA2018 dibuja el atlas al cerrar la primera iteración de esta investigación: sitúa cada hecho por región del cerebro, estadio de la enfermedad y tipo de célula.');
    expect(nodo.querySelector('svg.atlas-figura')).toBeNull();
    expect(nodo.querySelector(`a[href="${rutaDe(inv.id, 'arbol')}"]`)).not.toBeNull();
    // Un mapa sin celdas también es vacío.
    inv.mapaEnfermedad = { ...mapaReal(), celdas: [] };
    await montar(estado, inv);
    expect(nodo.textContent).toContain('ROSA2018 dibuja el atlas al cerrar la primera iteración');
  });

  it('una región que el backend añadió después del dibujo no rompe el atlas: se lista aparte y se puede seleccionar', async () => {
    const { estado, inv } = estadoConMapa();
    inv.mapaEnfermedad!.celdas.push(celda({ region: 'hipotalamo', hechos: ['he-mtvwph1d-8'] }));
    await montar(estado, inv);
    // Siguen siendo dieciocho figuras; la nueva va en una nota bajo el lienzo.
    expect(regiones().length).toBe(18);
    const nuevas = nodo.querySelector('.atlas-nuevas')!;
    expect(nuevas).not.toBeNull();
    expect(nuevas.textContent).toContain('hipotalamo');
    expect(nuevas.textContent).toContain('(1)');
    await pulsar(nuevas.querySelector('button')!);
    expect(panel()).toContain('Comparación entre plasma y LCR');
    expect(panel()).toContain('1 hecho');
  });

  it('el panel da cuenta de lo situado por fase o célula pero sin región, y sus cifras cuadran con el mapa', async () => {
    const { estado, inv } = estadoConMapa();
    // Dos celdas sin región, como las ocho del estado real del 18 de septiembre
    // (56 hechos con fase o célula pero sin región): dos hechos que no están en
    // ninguna región del dibujo.
    estado.hechos.push({ ...hecho('he-sin-1', 'Fase preclínica', 'La fase preclínica dura entre 15 y 20 años según los modelos de progresión.'), investigacionId: inv.id }, { ...hecho('he-sin-2', 'Astrocitos', 'Los astrocitos reactivos cambian su perfil de expresión con la edad.'), investigacionId: inv.id });
    inv.mapaEnfermedad!.celdas.push(celda({ estadio: 'preclinica', hechos: ['he-sin-1'] }), celda({ tipoCelular: 'astrocito', hechos: ['he-sin-2'] }));
    await montar(estado, inv);
    const p = panel();
    // En la figura solo lo localizado: las dos hipótesis de "cerebro sin región" van a la bandeja.
    expect(p).toContain('9 hechos y 1 hipótesis en la figura');
    expect(p).toContain('2 hechos con fase o tipo de célula pero sin región del cerebro');
    expect(p).toContain('no están en la figura');
    // La suma de lo que dice la pantalla (figura, sin región y bandeja) es lo que el mapa sitúa en total (hechos e hipótesis, cada uno una vez).
    const enFigura = p.match(/(\d+) hechos? y (\d+) hipótesis en la figura/)!;
    const m = p.match(/(\d+) hechos?(?: y (\d+) hipótesis)? con fase o tipo de célula pero sin región/)!;
    const sinRegion = Number(m[1]) + Number(m[2] ?? 0);
    const enBandeja = Number(bandeja().querySelector('h4 .atlas-cifra')!.textContent);
    const situados = new Set(inv.mapaEnfermedad!.celdas.flatMap((c) => [...c.hechos, ...c.hipotesis]));
    expect(Number(enFigura[1]) + Number(enFigura[2]) + sinRegion + enBandeja).toBe(situados.size);
    // La línea honesta cuenta lo mismo: 10 en fluidos, nada en tejido, 4 sin localizar (2 de la bandeja y 2 sin región).
    expect(honesta()).toContain('10 registros en fluidos (sangre y LCR), 0 en tejido localizado, 4 sin localizar');
    // El pie del deslizador dice lo mismo que la figura, no lo del resumen.
    expect(nodo.querySelector('.grafo-tiempo')?.textContent).toContain('9 hechos en la figura');
    // Con el filtro de fase preclínica solo queda el hecho sin región: la figura entera es hueco y el panel lo explica.
    await pulsar(boton('preclínica'));
    const q = panel();
    expect(q).toContain('0 regiones con evidencia de 18');
    expect(q).toContain('1 hecho con fase o tipo de célula pero sin región del cerebro');
  });

  it('si una celda apunta a hechos o hipótesis que ya no están en el estado, el panel lo dice y no promete una certeza GRADE', async () => {
    const { estado, inv } = estadoConMapa();
    // El mapa es una instantánea: después del cierre se sustituyó un hecho y se descartó una hipótesis.
    inv.mapaEnfermedad!.celdas.push(celda({ region: 'hipocampo', hechos: ['he-mtvwph1d-8', 'he-fantasma'], hipotesis: ['hip-fantasma'] }));
    await montar(estado, inv);
    await pulsar(region('hipocampo'));
    const p = panel();
    expect(p).toContain('2 hechos');
    expect(p).toContain('1 hipótesis');
    expect(p).toContain('2 de ellos ya no están en el modelo de mundo');
    expect(p).toContain('Hechos (1)');
    expect(p).not.toContain('Hipótesis (');
    expect(p).not.toContain('Sin conclusión con certeza GRADE');
    // Con un solo ausente, en singular.
    inv.mapaEnfermedad!.celdas.pop();
    inv.mapaEnfermedad!.celdas.push(celda({ region: 'amigdala', hechos: ['he-mtvwph1d-8', 'he-fantasma'] }));
    await montar(estado, { ...inv });
    await pulsar(region('amigdala'));
    expect(panel()).toContain('Uno de ellos ya no está en el modelo de mundo');
  });

  it('dice que se recalcula al cerrar cada iteración, nunca "en tiempo real", y cuántos hechos nuevos esperan a la siguiente', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    expect(cabecera()).toContain('Se recalcula al cerrar cada iteración');
    expect(cabecera()).not.toMatch(/tiempo real/i);
    expect(cabecera()).not.toContain('espera');
    expect(panel()).toMatch(/Mapa calculado al cerrar la iteración \d+ de (\d+|su corrida)\. Se recalcula al cerrar cada iteración\./);
    // Un hecho vivo de la investigación nacido una hora después del mapa y que no está en ninguna celda.
    const despues = FECHA + 3_600_000;
    estado.hechos.push({ ...hecho('he-nuevo', 'Tema nuevo', 'Un hecho leído después de calcular el mapa.'), investigacionId: inv.id, actualizadoEn: despues, historial: [{ fecha: despues, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido después' }] });
    await montar({ ...estado }, inv);
    expect(cabecera()).toContain('1 hecho nuevo espera a la siguiente iteración');
    expect(panel()).toContain('1 hecho nuevo en el modelo de mundo desde entonces, todavía sin situar');
    expect(nodo.textContent).not.toMatch(/tiempo real/i);
  });

  it('al cambiar de investigación se olvidan la selección y los filtros', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    await pulsar(boton('autosómica dominante'));
    await pulsar(region('plasma'));
    expect(region('plasma').getAttribute('aria-pressed')).toBe('true');
    expect(region('plasma').getAttribute('data-conteo')).toBe('4');
    const otra: Investigacion = { ...structuredClone(inv), id: 'inv-2', titulo: 'Otra investigación' };
    estado.investigaciones.push(otra);
    await montar(estado, otra);
    expect(boton('Todas').getAttribute('aria-pressed')).toBe('true');
    expect(region('plasma').getAttribute('aria-pressed')).toBe('false');
    expect(region('plasma').getAttribute('data-conteo')).toBe('8');
    expect(nodo.querySelector('svg.atlas-figura')?.getAttribute('aria-label')).toContain('Otra investigación');
  });

  it('la bandeja "No localizados" saca de la anatomía lo que cayó en cerebro o corteza sin región, con su cuenta y su explicación', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    const b = bandeja();
    expect(b).not.toBeNull();
    expect(b.textContent).toContain('No localizados');
    expect(b.querySelector('h4 .atlas-cifra')?.textContent).toBe('2');
    expect(b.textContent).toContain('2 registros (0 hechos, 2 hipótesis)');
    expect(b.textContent).toContain('ROSA2018 los leyó pero no supo situarlos; releerlos con el catálogo de regiones es trabajo pendiente.');
    // Las dos entradas, con su cuenta, fuera del SVG.
    const entradas = [...b.querySelectorAll<HTMLButtonElement>('button[data-clave]')];
    expect(entradas.map((e) => e.dataset.clave)).toEqual(['neocorteza', 'cerebro_sin_region']);
    expect(entradas.find((e) => e.dataset.clave === 'cerebro_sin_region')?.textContent).toContain('2');
    expect(entradas.find((e) => e.dataset.clave === 'neocorteza')?.textContent).toContain('0');
    expect(nodo.querySelector('svg [data-clave="cerebro_sin_region"]')).toBeNull();
    expect(nodo.querySelector('svg [data-clave="neocorteza"]')).toBeNull();
    // Pulsar una entrada abre el panel como "No localizado" con sus hipótesis.
    await pulsar(entradas.find((e) => e.dataset.clave === 'cerebro_sin_region')!);
    expect(entradas.find((e) => e.dataset.clave === 'cerebro_sin_region')?.getAttribute('aria-pressed')).toBe('true');
    const p = panel();
    expect(p).toContain('No localizado');
    expect(p).toContain('Localización fallida');
    expect(p).toContain('Hipótesis (2)');
    expect(p).toContain('La activación astrocitaria medida por GFAP');
    expect(p).toContain('DIAN-TU-001 (DIAD)');
    // Un registro que además está localizado en otra región se dice, y no se cuenta como sin localizar.
    inv.mapaEnfermedad!.celdas.push(celda({ region: 'cerebro_sin_region', hechos: ['he-mtvwph1d-8'] }));
    await montar(estado, { ...inv });
    expect(bandeja().querySelector('h4 .atlas-cifra')?.textContent).toBe('3');
    expect(bandeja().textContent).toContain('1 registro de estos está además en alguna región localizada');
    expect(honesta()).toContain('10 registros en fluidos (sangre y LCR), 0 en tejido localizado, 2 sin localizar');
    // Sin nada en la bandeja, lo dice.
    inv.mapaEnfermedad!.celdas = inv.mapaEnfermedad!.celdas.filter((c) => c.region !== 'cerebro_sin_region');
    await montar(estado, { ...inv });
    expect(bandeja().querySelector('h4 .atlas-cifra')?.textContent).toBe('0');
    expect(bandeja().textContent).toContain('Ningún registro cayó en «cerebro» o «corteza» sin región.');
  });

  it('la línea honesta bajo el mapa separa fluidos, tejido localizado y sin localizar, calculada del estado', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    expect(honesta()).toContain('10 registros en fluidos (sangre y LCR), 0 en tejido localizado, 2 sin localizar.');
    // Un hecho en el hipocampo que también está en la sangre, y otro solo en el hipocampo.
    estado.hechos.push({ ...hecho('he-hipo', 'Atrofia', 'La atrofia del hipocampo precede a la demencia.'), investigacionId: inv.id });
    inv.mapaEnfermedad!.celdas.push(celda({ region: 'hipocampo', hechos: ['he-mu2tf94k-1657', 'he-hipo'] }));
    await montar({ ...estado }, { ...inv });
    expect(honesta()).toContain('10 registros en fluidos (sangre y LCR), 2 en tejido localizado, 2 sin localizar (1 cuentan en fluidos y en tejido).');
    expect(panel()).toContain('10 registros en fluidos (sangre y LCR), 2 en tejido localizado, 2 sin localizar');
    // Con un filtro, lo dice.
    await pulsar(boton('autosómica dominante'));
    expect(honesta()).toContain('4 registros en fluidos (sangre y LCR), 0 en tejido localizado, 2 sin localizar (con los filtros puestos).');
  });

  it('marca la discordia con borde punteado rojo en las regiones donde un hecho choca con otro, y el panel la explica', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    expect(nodo.querySelector('.atlas-discordia')).toBeNull();
    expect(panel()).not.toContain('discordia');
    // El sTREM2 del LCR choca con el YKL-40.
    estado.hechos = estado.hechos.map((h) => (h.id === 'he-mu3708eb-3560' ? { ...h, contradiceA: ['he-mu7betru-7511'] } : h));
    await montar({ ...estado }, inv);
    expect(region('lcr').getAttribute('data-discordia')).toBe('1');
    expect(region('lcr').getAttribute('aria-label')).toContain('discordia: 1 hecho choca con otro hecho');
    expect(region('plasma').getAttribute('data-discordia')).toBe('0');
    const marcas = [...nodo.querySelectorAll<SVGPathElement>('.atlas-discordia')];
    expect(marcas.map((m) => m.dataset.region)).toEqual(['lcr']);
    expect(nodo.querySelectorAll('.atlas-discordia-punto').length).toBe(1);
    expect(panel()).toContain('1 hecho en discordia');
    await pulsar(region('lcr'));
    const p = panel();
    expect(p).toContain('Discordia:');
    expect(p).toContain('1 hecho de esta región choca con otro hecho del modelo de mundo');
    expect(p).toContain('El sTREM2 en LCR');
    expect(p).toContain('Choca con: La concentración de YKL-40');
    // La dirección de las citas no pinta nada: un hecho con cita "contrasta" pero sin contradiceA no lleva marca.
    estado.hechos = estado.hechos.map((h) => (h.id === 'he-mu3708eb-3560' ? { ...h, contradiceA: [], citas: [{ referencia: 'X, 2025', seccion: 'Results', clasificacion: 'contrasta', fragmento: '...' }] } : h));
    await montar({ ...estado }, inv);
    expect(nodo.querySelector('.atlas-discordia')).toBeNull();
    // Si el hecho con el que choca ya no está en el modelo de mundo, se dice. (La selección del LCR
    // sobrevive al nuevo montaje porque la investigación es la misma: solo se pulsa si se perdió.)
    estado.hechos = estado.hechos.map((h) => (h.id === 'he-mu3708eb-3560' ? { ...h, contradiceA: ['he-desaparecido'] } : h));
    await montar({ ...estado }, inv);
    if (region('lcr').getAttribute('aria-pressed') !== 'true') await pulsar(region('lcr'));
    expect(panel()).toContain('Choca con 1 hecho que ya no están en el modelo de mundo');
  });

  it('raya de dos maneras las regiones sin hechos: tenue si nadie las buscó, con contorno y punto si alguna consulta o fuente las nombró sin hallazgo', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    // De entrada nadie buscó el hipocampo ni la retina ni el cerebelo: rayas tenues, sin punto.
    for (const clave of ['hipocampo', 'retina', 'cerebelo', 'amigdala', 'vascular_bhe']) {
      expect(region(clave).classList.contains('atlas-hueco'), clave).toBe(true);
      expect(region(clave).classList.contains('atlas-no-buscada'), clave).toBe(true);
      expect(region(clave).getAttribute('data-cobertura'), clave).toBe('no_buscada');
    }
    expect(nodo.querySelector('.atlas-punto-buscada')).toBeNull();
    // Una consulta de búsqueda nombra el hipocampo, una fuente excluida en el cribado nombra la retina y una fuente de una hipótesis nombra el cerebelo.
    estado.corridas.push(corridaCon(estado, inv, [{ consulta: 'hippocampal atrophy AND tau PET', tema: 'Atrofia y tau' }], [{ titulo: 'Retinal nerve fiber layer thinning in preclinical disease', referencia: 'Ojo et al., 2025' }]));
    estado.hipotesis[0]!.procedencia.fuentes.push({ ...estado.hipotesis[0]!.procedencia.fuentes[0]!, id: 'f-cerebelo', titulo: 'Cerebellar volume as a reference in amyloid PET', fragmento: 'the cerebellum is used as reference region' });
    await montar({ ...estado }, inv);
    for (const clave of ['hipocampo', 'retina', 'cerebelo']) {
      expect(region(clave).classList.contains('atlas-hueco'), clave).toBe(true);
      expect(region(clave).classList.contains('atlas-buscada'), clave).toBe(true);
      expect(region(clave).getAttribute('data-cobertura'), clave).toBe('buscada_sin_hallazgo');
      expect(region(clave).getAttribute('aria-label'), clave).toContain('hueco: sin evidencia situada todavía (buscada sin hallazgo)');
    }
    expect([...nodo.querySelectorAll<SVGCircleElement>('.atlas-punto-buscada')].map((c) => c.dataset.region).sort()).toEqual(['cerebelo', 'hipocampo', 'retina']);
    // La amígdala sigue sin buscar.
    expect(region('amigdala').classList.contains('atlas-no-buscada')).toBe(true);
    // El panel dice quién la nombró.
    await pulsar(region('hipocampo'));
    expect(panel()).toContain('Hueco: sin evidencia situada todavía. Buscada sin hallazgo: 1 consulta de búsqueda de esta investigación la nombra y no produjo ningún hecho ni hipótesis situados aquí.');
    await pulsar(region('cerebelo'));
    expect(panel()).toContain('Buscada sin hallazgo: 1 fuente leída');
    await pulsar(region('amigdala'));
    expect(panel()).toContain('No buscada: ninguna consulta hecha ni fuente leída de esta investigación nombra esta región.');
    // Las regiones con registros no llevan rayas aunque las nombren consultas.
    expect(region('plasma').classList.contains('atlas-hueco')).toBe(false);
    expect(region('plasma').getAttribute('data-cobertura')).toBe('con_evidencia');
  });

  it('la leyenda trae los extremos numéricos reales de la rampa y explica el color, los dos rayados, la discordia y la bandeja, en castellano con tildes', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    const leyenda = nodo.querySelector('.atlas-leyenda')!.textContent ?? '';
    expect(leyenda).toContain('Color: cuántas cohortes distintas nombran sus hipótesis; número: cuántos registros.');
    expect(leyenda).toContain('ámbar tenue, 0 cohortes; ámbar pleno, 3 cohortes');
    // El color base es la lámina anatómica, con su crédito visible en la leyenda y en el lienzo.
    expect(leyenda).toContain('El color base es la lámina anatómica en tonos naturales; el tinte ámbar encima es la evidencia');
    expect(leyenda).toContain('Ilustración base: Patrick J. Lynch y C. Carl Jaffe, Yale University School of Medicine, CC BY 2.5 (adaptada: escala, recorte y regiones superpuestas)');
    expect(nodo.querySelector('svg.atlas-figura .atlas-credito')?.textContent).toContain('Patrick J. Lynch y C. Carl Jaffe');
    expect(leyenda).toContain('Rayas tenues: hueco no buscado.');
    expect(leyenda).toContain('Rayas con contorno y punto: buscada sin hallazgo.');
    expect(leyenda).toContain('Borde punteado rojo: discordia.');
    expect(leyenda).toContain('Las líneas ramificadas: los vasos.');
    expect(leyenda).toContain('Fuera del cerebro');
    expect(leyenda).toContain('bandeja «No localizados»');
    expect(leyenda).not.toContain('Las capas');
    // Los extremos de la barra son los de la rampa: 0 cohortes en el frío SIEMPRE y el máximo del mapa (sangre, 3) en el cálido.
    const extremos = [...nodo.querySelectorAll('.atlas-rampa-extremos > span')].map((s) => s.textContent);
    expect(extremos[0]).toBe('0');
    expect(extremos[2]).toBe('3');
    // Con la fase autosómica dominante solo queda la sangre con sus 3 cohortes: se pinta ámbar (t = 1) y la leyenda sigue diciendo 0 y 3, no 3 y 3.
    await pulsar(boton('autosómica dominante'));
    const e2 = [...nodo.querySelectorAll('.atlas-rampa-extremos > span')].map((s) => s.textContent);
    expect(e2[0]).toBe('0');
    expect(e2[2]).toBe('3');
    expect(region('plasma').getAttribute('data-intensidad')).toBe('1.00');
    expect(nodo.querySelector('.atlas-leyenda')!.textContent).toContain('ámbar tenue, 0 cohortes; ámbar pleno, 3 cohortes');
    // Sin fase identificada quedan la sangre (4 hechos sin cohorte) y el LCR: nada llega al ámbar y la leyenda lo dice en vez de escribir «ámbar brillante, 0».
    await pulsar(boton('sin fase identificada'));
    const leyendaSinFase = nodo.querySelector('.atlas-leyenda')!.textContent ?? '';
    expect(leyendaSinFase).toContain('con estos filtros ninguna región con registros tiene cohortes nombradas');
    expect(leyendaSinFase).not.toMatch(/ámbar pleno, 0\b/);
    expect([...nodo.querySelectorAll('.atlas-rampa-extremos > span')].map((s) => s.textContent)[2]).toBe('0');
    await pulsar(boton('Todas'));
    expect(nodo.querySelector('a[href="' + rutaDe(inv.id, 'arbol') + '"]')?.textContent).toContain('Abrir en el árbol');
    const todo = [nodo.textContent ?? '', ...[...nodo.querySelectorAll('[aria-label], [title]')].map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)].join('\n');
    expect(todo).not.toContain('\u2014');
    expect(todo).not.toMatch(SIN_TILDE);
  });

  it('el resumen del panel se calcula de las celdas y, si los conteos guardados por el backend ya no cuadran, lo dice en vez de imprimirlos', async () => {
    // El backend reescribe las celdas al fundir hechos duplicados sin recalcular `ejes` ni `resumen`
    // (rosa/hechos.py _remapear_investigacion): en la investigación grande el resumen guardado decía
    // 217 hechos y 107 en la sangre donde las celdas tienen 211 y 106, y la misma pantalla enseñaba
    // las dos cifras. Aquí el resumen guardado dice 9 hechos y 8 en la sangre; las celdas tienen 9
    // hechos y 8 en la sangre (cuadran), así que no hay nota.
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    expect(panel()).toContain('9 hechos y 3 hipótesis situados en 4 celdas (estadio, región y tipo celular).');
    // Los empates van por clave alfabética, como _top del backend (cerebro_sin_region antes que lcr).
    expect(panel()).toContain('Regiones: sangre, plasma y suero (compartimento periférico) 8, cerebro (sin región concreta) 2, líquido cefalorraquídeo (LCR) 2.');
    expect(panel()).not.toContain('Sin situar: 3 hechos');
    expect(nodo.querySelector('.atlas-desfase')).toBeNull();
    // Con un eje guardado desfasado (la sangre a 9 cuando las celdas suman 8) la nota aparece y dice cuál.
    const desfasado = estadoConMapa();
    desfasado.inv.mapaEnfermedad!.ejes.region.plasma = 9;
    await act(async () => root.unmount());
    root = createRoot(nodo);
    await montar(desfasado.estado, desfasado.inv);
    const nota = nodo.querySelector<HTMLElement>('.atlas-desfase');
    expect(nota?.textContent).toContain('ya no cuadran con ellas en 1 conteo');
    expect(nota?.getAttribute('title')).toBe('sangre, plasma y suero (compartimento periférico): 9 en el resumen guardado, 8 en las celdas');
    // Y el resumen impreso sigue siendo el de las celdas: 8, no 9.
    expect(panel()).toContain('periférico) 8,');
    expect(panel()).not.toContain('periférico) 9');
  });

  it('un nombre de cohorte que llega recortado a 60 caracteres se corta por palabra con puntos suspensivos y conserva el nombre entero en el title', async () => {
    // rosa/mapa_enfermedad.py guarda las cohortes con el nombre que trae la afirmación, y el
    // extractor lo recorta a 60 caracteres a mitad de palabra: en el panel real de la sangre se leía
    // «16 RCTs (meta-análisis instrumental actualizado, actualizaci».
    const largo = "Alzheimer's Disease Neuroimaging Initiative (ADNI) y Penn Al";
    expect(largo.length).toBe(60);
    const { estado, inv } = estadoConMapa();
    inv.mapaEnfermedad!.celdas[1]!.cohortes = [largo, 'DIAN-TU-001'];
    await montar(estado, inv);
    await pulsar(region('plasma'));
    const spans = [...nodo.querySelectorAll<HTMLElement>('.atlas-panel span[title]')];
    const cortado = spans.find((s) => s.textContent?.startsWith("Alzheimer's"));
    expect(cortado?.textContent).toBe("Alzheimer's Disease Neuroimaging Initiative (ADNI) y Penn…");
    expect(cortado?.getAttribute('title')).toContain(largo);
    expect(cortado?.getAttribute('title')).toContain('puede estar incompleto');
    // Un nombre corto va tal cual, con su propio nombre en el title.
    const corto = spans.find((s) => s.textContent === 'DIAN-TU-001');
    expect(corto?.getAttribute('title')).toBe('DIAN-TU-001');
    expect(panel()).toContain('2 cohortes distintas');
  });

  it('no enseña puntuaciones compuestas ni porcentajes de confianza: solo conteos', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    await pulsar(region('plasma'));
    const todo = [nodo.textContent ?? '', ...[...nodo.querySelectorAll('[aria-label], [title]')].map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)].join('\n');
    expect(todo).not.toMatch(/\d\s?%/);
    expect(todo).not.toMatch(/confianza|puntuaci[oó]n/i);
    expect(todo).not.toMatch(/tiempo real/i);
  });
});

describe('la espera del atlas', () => {
  /** Las piezas de la maqueta, en el orden en que aparecen, tanto en la silueta como en el contenido. */
  const PIEZAS = ['.pantalla-cabecera', '.atlas-controles', '.atlas-marco', '.atlas-lienzo', '.atlas-honesta', '.atlas-bandeja', '.atlas-leyenda', '.atlas-panel', '.grafo-tiempo'];
  const orden = (raiz: Element) => PIEZAS.map((s) => raiz.querySelector(s)).map((el) => (el ? [...raiz.querySelectorAll('*')].indexOf(el) : -1));

  it('el primer render es la silueta del atlas con aria-busy y el rótulo oculto, sin nada del mapa; el contenido llega tras el pintado', async () => {
    const { estado, inv } = estadoConMapa();
    estado.conexion = 'en_linea';
    await montarSinEsperar(estado, inv);
    const s = nodo.querySelector<HTMLElement>('.atlas-esqueleto')!;
    expect(s).not.toBeNull();
    // La caja de maqueta (.contenido, sin role) y, dentro, la espera (role="status", aria-busy y el rótulo).
    expect(s.classList.contains('contenido')).toBe(true);
    expect(s.classList.contains('contenido-ancho')).toBe(true);
    expect(s.hasAttribute('role')).toBe(false);
    const espera = s.querySelector<HTMLElement>('.atlas-esqueleto-espera')!;
    expect(espera).not.toBeNull();
    expect(espera.parentElement).toBe(s);
    expect(espera.classList.contains('esqueleto-pantalla')).toBe(true);
    expect(espera.classList.contains('esqueleto-pantalla-figura')).toBe(true);
    expect(espera.getAttribute('role')).toBe('status');
    expect(espera.getAttribute('aria-busy')).toBe('true');
    expect(espera.querySelector('.sr-only')?.textContent).toBe(`Cargando ${ROTULO_ATLAS}`);
    // Al lector de pantalla solo le llega el rótulo: los bloques grises y la cabecera (texto fijo, aria-hidden) están fuera del árbol accesible.
    expect(textoAccesible(nodo)).toBe(`Cargando ${ROTULO_ATLAS}`);
    expect(s.querySelector('.pantalla-cabecera')?.getAttribute('aria-hidden')).toBe('true');
    expect(s.querySelector('.pantalla-cabecera h2')?.textContent).toBe('Atlas de la enfermedad');
    expect(nodo.querySelectorAll('[aria-busy="true"]').length).toBe(1);
    expect(nodo.querySelectorAll('.sr-only').length).toBe(1);
    // La silueta: el óvalo del hemisferio y los compartimentos de fuera en el lienzo, los chips arriba,
    // el panel a la derecha, la bandeja y la leyenda abajo, el deslizador al pie. Nada del mapa real.
    expect(s.querySelector('.atlas-lienzo .atlas-esqueleto-cerebro')).not.toBeNull();
    expect(s.querySelectorAll('.atlas-lienzo .atlas-esqueleto-fuera').length).toBe(3);
    expect(s.querySelectorAll('.atlas-controles .atlas-esqueleto-chip').length).toBeGreaterThanOrEqual(5);
    expect(s.querySelector('.atlas-marco > aside.grafo-panel.atlas-panel')).not.toBeNull();
    expect(s.querySelectorAll('.atlas-leyenda li').length).toBe(6);
    expect(s.querySelectorAll('.esqueleto').length).toBeGreaterThan(20);
    expect(nodo.querySelector('svg.atlas-figura')).toBeNull();
    expect(nodo.querySelector('[role="button"]')).toBeNull();
    expect(nodo.querySelector('button')).toBeNull();
    expect(nodo.querySelector('a')).toBeNull();
    // Tras el pintado: el contenido en el sitio de la silueta, sin aria-busy en
    // ninguna parte. La pantalla abre en relieve, así que lo que llega es su
    // lienzo; el dibujo region a region está a un botón.
    await esperarPintado();
    expect(nodo.querySelector('.atlas-esqueleto')).toBeNull();
    expect(nodo.querySelector('.atlas-lienzo.atlas-3d-lienzo')).not.toBeNull();
    expect(nodo.querySelectorAll('[aria-busy]').length).toBe(0);
    expect(nodo.querySelector('.sr-only')).toBeNull();
    const plano = [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Vista 2D')!;
    expect(plano.getAttribute('aria-pressed')).toBe('false');
    await pulsar(plano);
    expect(nodo.querySelector('svg.atlas-figura')).not.toBeNull();
    expect(regiones().length).toBe(18);
  });

  it('abre en la vista de relieve, que es la que enseña el volumen, y la vista 2D sigue a un botón', async () => {
    const { estado, inv } = estadoConMapa();
    await montarSinEsperar(estado, inv);
    await esperarPintado();
    expect(boton('Vista 3D').getAttribute('aria-pressed')).toBe('true');
    expect(boton('Vista 2D').getAttribute('aria-pressed')).toBe('false');
    expect(nodo.querySelector('section.atlas-3d')).not.toBeNull();
    expect(nodo.querySelector('svg.atlas-figura')).toBeNull();
    await pulsar(boton('Vista 2D'));
    expect(nodo.querySelector('section.atlas-3d')).toBeNull();
    expect(regiones().length).toBe(18);
  });

  it('sin mapa, la silueta da paso al estado vacío, no a una pantalla en blanco', async () => {
    const { estado, inv } = estadoConMapa();
    inv.mapaEnfermedad = null;
    await montarSinEsperar(estado, inv);
    expect(nodo.querySelector('.atlas-esqueleto')).not.toBeNull();
    expect(nodo.textContent).not.toContain('ROSA2018 dibuja el atlas');
    await esperarPintado();
    expect(nodo.querySelector('.atlas-esqueleto')).toBeNull();
    expect(nodo.textContent).toContain('ROSA2018 dibuja el atlas al cerrar la primera iteración');
  });

  it('la silueta tiene las mismas piezas, en el mismo orden y con las mismas medidas fijadas en CSS que el contenido: no salta al llegar', async () => {
    const { estado, inv } = estadoConMapa();
    estado.conexion = 'en_linea';
    await montarSinEsperar(estado, inv);
    const silueta = nodo.querySelector<HTMLElement>('.atlas-esqueleto')!;
    const ordenSilueta = orden(silueta);
    expect(ordenSilueta.every((i) => i >= 0)).toBe(true);
    expect(silueta.querySelector<HTMLElement>('.pantalla-cabecera')?.style.marginTop).toBe('16px');
    expect(silueta.querySelectorAll('.atlas-marco > *').length).toBe(2);
    await esperarPintado();
    const contenido = nodo.querySelector<HTMLElement>('.contenido')!;
    expect(contenido.classList.contains('atlas-esqueleto')).toBe(false);
    expect(contenido.classList.contains('contenido-ancho')).toBe(true);
    const ordenContenido = orden(contenido);
    expect(ordenContenido.every((i) => i >= 0)).toBe(true);
    // Mismo orden relativo de las piezas (las posiciones absolutas cambian porque el SVG tiene más nodos):
    // a cada pieza, cuántas van antes que ella.
    const relativo = (o: number[]) => o.map((v) => o.filter((w) => w < v).length);
    expect(relativo(ordenSilueta)).toEqual(relativo(ordenContenido));
    expect(contenido.querySelector<HTMLElement>('.pantalla-cabecera')?.style.marginTop).toBe('16px');
    expect(contenido.querySelectorAll('.atlas-marco > *').length).toBe(2);
    expect(contenido.querySelectorAll('.atlas-leyenda > li').length).toBe(silueta.querySelectorAll('.atlas-leyenda > li').length);
    // Las medidas fijas: la caja del lienzo y los chips miden lo mismo en atlas.css (jsdom no maqueta,
    // así que se cotejan las reglas escritas, que son las que el navegador aplica).
    const css = readFileSync(join(__dirname, '..', 'atlas.css'), 'utf8');
    const regla = (selector: string) => {
      const inicio = css.indexOf(`\n${selector} {`);
      expect(inicio, selector).toBeGreaterThan(-1);
      return css.slice(inicio, css.indexOf('}', inicio));
    };
    const figura = regla('.atlas-figura');
    const siluetaFigura = regla('.atlas-esqueleto .atlas-esqueleto-figura');
    const valor = (bloque: string, propiedad: string) => bloque.match(new RegExp(`\\n\\s*${propiedad}:\\s*([^;]+);`))?.[1]?.trim();
    expect(valor(siluetaFigura, 'min-width')).toBe(valor(figura, 'min-width'));
    expect(valor(siluetaFigura, 'max-height')).toBe(valor(figura, 'max-height'));
    expect(valor(siluetaFigura, 'width')).toBe(valor(figura, 'width'));
    expect(valor(siluetaFigura, 'aspect-ratio')).toBe(`${VISTA.ancho} / ${VISTA.alto}`);
    const chip = regla('.atlas-chip');
    const siluetaChip = regla('.atlas-esqueleto .atlas-esqueleto-chip');
    expect(valor(siluetaChip, 'height')).toBe(valor(chip, 'min-height'));
    expect(valor(siluetaChip, 'border-radius')).toBe(valor(chip, 'border-radius'));
    const muestra = regla('.atlas-muestra');
    const siluetaMuestra = regla('.atlas-esqueleto .atlas-esqueleto-muestra');
    for (const p of ['width', 'height', 'margin-top', 'border-radius']) expect(valor(siluetaMuestra, p), p).toBe(valor(muestra, p));
    // El brillo se apaga con movimiento reducido: la regla vive en styles.css sobre .esqueleto (Esqueleto.test.tsx
    // la comprueba), y todos los bloques de la silueta llevan esa clase, ninguno un gris propio. Quedan fuera los
    // elementos con el prefijo que no son bloques grises: la caja de la figura, la de los chips, la espera
    // (el div con role="status") y el botón inerte de la cabecera (texto con las clases del botón).
    const NO_SON_BLOQUES = ['atlas-esqueleto-figura', 'atlas-esqueleto-chips', 'atlas-esqueleto-espera', 'atlas-esqueleto-boton'];
    const bloques = [...silueta.querySelectorAll<HTMLElement>('[class*="atlas-esqueleto-"]')].filter((el) => !NO_SON_BLOQUES.some((c) => el.classList.contains(c)));
    expect(bloques.length).toBeGreaterThan(10);
    expect(bloques.every((el) => el.classList.contains('esqueleto'))).toBe(true);
  });

  it('la cabecera de la silueta lleva el texto real (h2, párrafo y meta) y un botón que mide como el enlace: no cambia de altura al llegar el mapa', async () => {
    // La cabecera es texto FIJO que no depende del cálculo: unas 15 líneas a 68ch (el máximo de .pantalla-cabecera p
    // en styles.css). En gris medía unos 200 px menos y chips, lienzo, panel y leyenda bajaban de golpe al llegar el mapa.
    const { estado, inv } = estadoConMapa();
    estado.conexion = 'en_linea';
    await montarSinEsperar(estado, inv);
    const silueta = nodo.querySelector<HTMLElement>('.atlas-esqueleto')!;
    const textos = (raiz: Element) => ({
      h2: raiz.querySelector('.pantalla-cabecera h2')?.textContent,
      parrafos: [...raiz.querySelectorAll('.pantalla-cabecera p')].map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim()),
      boton: raiz.querySelector('.pantalla-cabecera .acciones .btn'),
    });
    const enSilueta = textos(silueta);
    // Nada gris en la cabecera: es texto, no bloques.
    expect(silueta.querySelectorAll('.pantalla-cabecera .esqueleto').length).toBe(0);
    expect(enSilueta.h2).toBe('Atlas de la enfermedad');
    expect(enSilueta.parrafos.length).toBe(2);
    expect(enSilueta.parrafos[0]!.length).toBeGreaterThan(900);
    expect(enSilueta.parrafos[0]).not.toMatch(SIN_TILDE);
    // El botón: un span inerte con las clases del botón real, no un enlace ni un botón.
    expect(enSilueta.boton?.tagName).toBe('SPAN');
    expect(enSilueta.boton?.classList.contains('btn-s')).toBe(true);
    expect(enSilueta.boton?.textContent).toBe('Abrir en el árbol');
    await esperarPintado();
    const contenido = nodo.querySelector<HTMLElement>('.contenido:not(.atlas-esqueleto)')!;
    const enContenido = textos(contenido);
    expect(enSilueta.h2).toBe(enContenido.h2);
    expect(enSilueta.parrafos[0]).toBe(enContenido.parrafos[0]);
    // El meta del contenido empieza por la frase fija; con este mapa no hay hechos nuevos y es exactamente ella.
    expect(enContenido.parrafos[1]!.startsWith(enSilueta.parrafos[1]!)).toBe(true);
    expect(enContenido.parrafos[1]).toBe(enSilueta.parrafos[1]);
    expect(enContenido.boton?.tagName).toBe('A');
    expect([...enContenido.boton!.classList].filter((c) => c.startsWith('btn'))).toEqual([...enSilueta.boton!.classList].filter((c) => c.startsWith('btn')));
    expect(enContenido.boton?.textContent?.trim()).toBe(enSilueta.boton?.textContent);
    // Y ocupan las mismas líneas a 68 caracteres: la cabecera mide lo mismo antes y después.
    const lineas = (t: { parrafos: string[] }) => t.parrafos.reduce((n, p) => n + Math.ceil(p.length / 68), 0);
    expect(lineas(enSilueta)).toBe(lineas(enContenido));
    expect(lineas(enSilueta)).toBeGreaterThan(10);
  });

  it('en modo muestra el aviso de datos de muestra está en la silueta y en el contenido, en el mismo sitio, y fuera de la región viva de la espera', async () => {
    const { estado, inv } = estadoConMapa();
    estado.conexion = 'muestra';
    await montarSinEsperar(estado, inv);
    const silueta = nodo.querySelector<HTMLElement>('.atlas-esqueleto')!;
    expect(silueta.firstElementChild?.classList.contains('aviso-muestra')).toBe(true);
    // El aviso es su propia región viva (role="status") y va FUERA de la de la espera, como hermano anterior:
    // dos role="status" seguidos, ninguno dentro del otro, y a la espera solo le pertenece su rótulo. Si estuviera
    // dentro, un lector de pantalla anunciaría el aviso como parte del "Cargando" cada vez que la silueta aparece.
    expect(nodo.querySelectorAll('[role="status"]').length).toBe(2);
    expect(nodo.querySelectorAll('[role="status"] [role="status"]').length).toBe(0);
    const espera = silueta.querySelector<HTMLElement>('[role="status"][aria-busy="true"]')!;
    expect(espera.previousElementSibling?.classList.contains('aviso-muestra')).toBe(true);
    expect(textoAccesible(espera)).toBe(`Cargando ${ROTULO_ATLAS}`);
    await esperarPintado();
    const contenido = nodo.querySelector<HTMLElement>('.contenido')!;
    // En los dos, el aviso es el primer hijo de la caja .contenido: mismo sitio.
    expect(contenido.firstElementChild?.classList.contains('aviso-muestra')).toBe(true);
    expect(contenido.firstElementChild?.nextElementSibling?.classList.contains('pantalla-cabecera')).toBe(true);
    expect(nodo.querySelectorAll('[role="status"] [role="status"]').length).toBe(0);
    // Sin `conexion`, la silueta suelta (la que pinta App) no trae el aviso.
    await act(async () => root.render(<EsqueletoAtlas />));
    expect(nodo.querySelector('.aviso-muestra')).toBeNull();
    expect(nodo.querySelector('.sr-only')?.textContent).toBe(`Cargando ${ROTULO_ATLAS}`);
  });

  it('al pulsar un chip no vuelve la silueta: el mapa anterior se queda con aria-busy en el marco y los conteos nuevos llegan tras el pintado', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    expect(nodo.querySelector('.atlas-marco')?.hasAttribute('aria-busy')).toBe(false);
    await pulsarSinEsperar(boton('autosómica dominante'));
    // Render inmediato: el chip ya está pulsado, el mapa es el de antes y el marco dice que está ocupado.
    expect(boton('autosómica dominante').getAttribute('aria-pressed')).toBe('true');
    expect(nodo.querySelector('.atlas-esqueleto')).toBeNull();
    expect(nodo.querySelector('svg.atlas-figura')).not.toBeNull();
    expect(nodo.querySelector('.atlas-marco')?.getAttribute('aria-busy')).toBe('true');
    expect(region('plasma').getAttribute('data-conteo')).toBe('8');
    await esperarPintado();
    expect(nodo.querySelector('.atlas-marco')?.hasAttribute('aria-busy')).toBe(false);
    expect(region('plasma').getAttribute('data-conteo')).toBe('4');
    // Una actualización del estado (el canal en vivo) tampoco vuelve a la silueta.
    await montarSinEsperar({ ...estado }, inv);
    expect(nodo.querySelector('.atlas-esqueleto')).toBeNull();
    expect(nodo.querySelector('.atlas-marco')?.getAttribute('aria-busy')).toBe('true');
    await esperarPintado();
    expect(nodo.querySelector('.atlas-marco')?.hasAttribute('aria-busy')).toBe(false);
    expect(region('plasma').getAttribute('data-conteo')).toBe('4');
  });

  it('al cambiar de investigación sin desmontar vuelve la silueta hasta que llega el atlas nuevo', async () => {
    const { estado, inv } = estadoConMapa();
    await montar(estado, inv);
    const otra: Investigacion = { ...structuredClone(inv), id: 'inv-2', titulo: 'Otra investigación' };
    estado.investigaciones.push(otra);
    await montarSinEsperar(estado, otra);
    expect(nodo.querySelector('.atlas-esqueleto')).not.toBeNull();
    expect(nodo.querySelector('svg.atlas-figura')).toBeNull();
    await esperarPintado();
    expect(nodo.querySelector('.atlas-esqueleto')).toBeNull();
    expect(nodo.querySelector('svg.atlas-figura')?.getAttribute('aria-label')).toContain('Otra investigación');
  });
});
