// @vitest-environment jsdom
// La pantalla del árbol montada de verdad (16 de septiembre de 2026): el
// conmutador "Color por distancia al dato" cambia la leyenda y el relleno de
// los nodos, las entidades canónicas conservan su color (no son literatura),
// el panel de selección dice la distancia con sus tildes y nada de lo que se
// pinta lleva guiones largos. Se monta con movimiento reducido para que la
// disposición por fuerzas corra en el efecto, sin fotogramas, y el test sea
// determinista. Desde el 17 de septiembre el árbol se pinta en un canvas, así
// que lo que se comprueba es la ESCENA (lib/lienzo_arbol.ts: posiciones,
// radios, opacidades y colores como tokens) que la pantalla registra para su
// lienzo, no el DOM; jsdom no tiene contexto 2D y no se pinta nada.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Afirmacion, Ejecucion, EstadoRosa, PlanAnalisis } from '../datos/tipos';
import { DISTANCIA_MAXIMA, DISTANCIA_MINIMA, FOCAL } from '../lib/arbol3d';
import { escenaDe, huella, type NodoEscena } from '../lib/lienzo_arbol';
import { Arbol } from './Arbol';
import { fijarIdioma } from '../lib/idioma';

const traducciones = vi.hoisted(() => vi.fn(async (_textos: string[]): Promise<Record<string, string>> => ({})));
vi.mock('../datos/almacen', () => {
  const ignorar = () => undefined;
  return { acciones: new Proxy({ traducirTextos: traducciones }, { get: (obj, clave) => clave === 'traducirTextos' ? obj.traducirTextos : ignorar }) };
});
// La preferencia de movimiento se lee una sola vez por módulo en motion/react, así
// que se intercepta para poder encender la animación en un test (la fuga de fotogramas)
// y dejar el resto con movimiento reducido, determinista.
const movimiento = vi.hoisted(() => ({ reducido: true }));
vi.mock('motion/react', async (original) => ({ ...(await original<typeof import('motion/react')>()), useReducedMotion: () => movimiento.reducido }));

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom no trae contexto 2D (y lo avisa por consola): la pantalla registra la escena y no pinta.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // Movimiento reducido: la simulación se asienta en el efecto y no hay vaivén.
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  fijarIdioma('es');
  traducciones.mockReset().mockResolvedValue({});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  // La vista elegida se recuerda en el navegador: se limpia para que un test no herede la de otro.
  localStorage.removeItem('rosa-arbol-vista');
  fijarIdioma('es');
});
/** Monta el árbol y espera al fotograma en que se construye el grafo: desde el
 *  19 de septiembre de 2026 la pantalla pinta primero una silueta (esqueleto)
 *  y construye el grafo después del pintado (lib/diferido.ts), así que el
 *  lienzo llega un fotograma más tarde. Los tests con el arnés de animación no
 *  la usan: allí requestAnimationFrame está interceptado y `fotogramas` lo vacía. */
async function montar(elemento: JSX.Element) {
  await act(async () => root.render(elemento));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

function ejecucionValida(id: string, hipotesisId: string, planId: string): Ejecucion {
  return { id, investigacionId: 'inv-1', hipotesisId, planId, tipo: 'hipotesis', codigo: '', entorno: { python: '3.12', paquetes: [] }, semilla: 1, hashDatos: '', hashPlan: '', inicio: 1, fin: 2, estado: 'completado', runtime: 'docker', red: 'deshabilitada', codigoSalida: 0, duracionS: 1, salida: '', error: '', resultados: {}, baseline: {}, controlNegativo: {}, repeticiones: [], interpretacion: null, plausibilidadVerificada: true, auditoria: { veredicto: 'valido', comprobaciones: [], motivo: '', quien: 'Killer II', fecha: 2 } };
}

function planDe(id: string, hipotesisId: string, datasetId: string): PlanAnalisis {
  return { id, investigacionId: 'inv-1', hipotesisId, datasetId, tipo: 'confirmatorio', pregunta: '', variables: [], poblacion: '', preprocesado: [], prueba: '', hipotesisNula: '', hipotesisAlternativa: '', alpha: 0.05, direccionEsperada: '', tamanoEfectoMinimo: '', baseline: '', controlNegativo: '', correccionMultiplicidad: '', umbralEfecto: '', criterioNoEvaluable: '', semilla: 1, hashDatos: '', hashPlan: '', congeladoEn: 1, autor: 'rosa', reproduccionId: null };
}

/** Estado de muestra más un análisis válido y su observación sobre hip-1. */
function estadoConDato(): EstadoRosa {
  const e = structuredClone(estadoDeMuestra());
  const inv = e.investigaciones[0]!;
  const h = e.hipotesis.find((x) => x.id === 'hip-1')!;
  e.ejecuciones = [ejecucionValida('run-1', h.id, 'plan-1')];
  e.planesAnalisis = [planDe('plan-1', h.id, inv.datasets[0]!.id)];
  const obs: Afirmacion = { texto: 'La correlación entre GFAP y NfL fue de 0,41 (n = 212).', cita: '[Análisis in silico run-1]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'dato', clase: 'observacion_original', trayectoria: { id: 'run-1', celda: 0 }, afirmacionId: 'obs-1' };
  h.afirmaciones = [...h.afirmaciones, obs];
  // La muestra no trae entidades canónicas: se pone una en hip-3 para comprobar su color.
  e.hipotesis.find((x) => x.id === 'hip-3')!.entidades = [{ id: 'HGNC:4235', etiqueta: 'GFAP', ontologia: 'HGNC', tipo: 'gen', alias: ['GFAP'] }];
  return e;
}

const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

it('las etiquetas del canvas siguen el idioma y conservan el estado original', async () => {
  const e = structuredClone(estadoDeMuestra());
  const h = e.hipotesis[0]!;
  h.titulo = 'Autofagia regula tau en neuronas';
  const original = JSON.stringify(e);
  traducciones.mockImplementation(async textos => Object.fromEntries(textos.filter(t => t === h.titulo).map(t => [t, 'Autophagy regulates tau in neurons'])));
  fijarIdioma('en');
  await montar(<Arbol inv={e.investigaciones[0]!} estado={e} />);
  const etiqueta = () => escenaDe(nodo.querySelector('canvas')!)!.nodos.find(n => n.id === h.id)!.etiqueta.lineas.join(' ');
  expect(etiqueta()).toBe('Autophagy regulates tau in neurons');
  await act(async () => fijarIdioma('es'));
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  expect(etiqueta()).toBe(h.titulo);
  expect(JSON.stringify(e)).toBe(original);
});

it('una traducción tardía no vuelve a poner inglés después de seleccionar español', async () => {
  const e = structuredClone(estadoDeMuestra());
  e.hipotesis[0]!.titulo = 'El ensayo de MAPT queda pendiente';
  let responder!: (r: Record<string, string>) => void;
  traducciones.mockImplementation(() => new Promise(resolve => { responder = resolve; }));
  fijarIdioma('en');
  await montar(<Arbol inv={e.investigaciones[0]!} estado={e} />);
  await act(async () => fijarIdioma('es'));
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  await act(async () => responder({ 'El ensayo de MAPT queda pendiente': 'The MAPT assay remains pending' }));
  expect(escenaDe(nodo.querySelector('canvas')!)!.nodos.find(n => n.id === e.hipotesis[0]!.id)!.etiqueta.lineas.join(' ')).toBe(e.hipotesis[0]!.titulo);
});

describe('la pantalla del árbol', () => {
  const lienzo = () => nodo.querySelector('canvas.grafo') as HTMLCanvasElement;
  const escena = () => escenaDe(lienzo())!;
  const nodoEsc = (id: string): NodoEscena => {
    const n = escena().nodos.find((x) => x.id === id);
    if (!n) throw new Error(`no hay nodo ${id} en la escena`);
    return n;
  };
  const cuantos = () => escena().nodos.length;
  const atenuados = () => escena().nodos.filter((n) => !n.vivo).length;
  /** El botón de la lista accesible de un nodo: pulsarlo equivale a pulsar el nodo. */
  const botonNodo = (id: string) => nodo.querySelector(`ul[role="list"] button[data-id="${id}"]`)!;
  const finitos = () => escena().nodos.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.r) && n.opacidad >= 0 && n.opacidad <= 1);

  it('cambia de color por tipo a color por distancia al dato, con la leyenda y el panel en castellano', async () => {
    const e = estadoConDato();
    const inv = e.investigaciones[0]!;
    await montar(<Arbol inv={inv} estado={e} />);
    // Por defecto, por tipo y mecanismo: el relleno de hip-1 es el de su familia y el anillo, la distancia al dato.
    expect(boton('Por tipo y mecanismo').getAttribute('aria-pressed')).toBe('true');
    expect(nodoEsc('hip-1').estilo.relleno).toMatch(/var\(--grafo-cluster-\d\)/);
    expect(nodo.textContent).toContain('El color de dentro: qué es cada nodo');
    expect(nodo.textContent).toContain('Hipótesis: cada una lleva el color de su familia de mecanismo.');
    expect(nodo.textContent).toContain('Anillo verde: a un paso de una medición propia de ROSA2018');
    // Desplegar todo: aparecen el análisis in silico y la entidad canónica.
    await pulsar(boton('Desplegar todo'));
    expect(nodoEsc('run-1').estilo.relleno).toBe('var(--grafo-ejecucion)');
    const entidad = escena().nodos.find((n) => n.id.startsWith('ent-'))!;
    expect(entidad.estilo.relleno).toBe('var(--blue)');
    // Por distancia al dato: hip-1 a un salto (intenso), la ejecución en el escalón 0.
    await pulsar(boton('Por distancia al dato'));
    expect(boton('Por distancia al dato').getAttribute('aria-pressed')).toBe('true');
    expect(nodoEsc('run-1').estilo.relleno).toBe('var(--grafo-dato-0)');
    expect(nodoEsc('hip-1').estilo.relleno).toBe('var(--grafo-dato-1)');
    // La entidad canónica conserva su color: es un nombre, no evidencia.
    expect(escena().nodos.find((n) => n.id.startsWith('ent-'))!.estilo.relleno).toBe('var(--blue)');
    expect(nodo.textContent).toContain('El color de dentro: a qué distancia está del dato');
    expect(nodo.textContent).toContain('La medición misma (0 saltos)');
    // Pulsar hip-1 (por la lista accesible) lo selecciona y el panel dice su distancia con tildes.
    await pulsar(botonNodo('hip-1'));
    expect(nodoEsc('hip-1').sel).toBe(true);
    const panel = nodo.querySelector('.grafo-panel')!.textContent ?? '';
    expect(panel).toContain('Hipótesis');
    expect(panel).toContain('A 1 salto de una medición propia.');
    expect(panel).toContain('Aparece desde la iteración');
    // Nada lleva guiones largos ni palabras sin tilde.
    expect(nodo.textContent).not.toContain('\u2014');
    expect(nodo.textContent).not.toMatch(/\b(hipotesis|investigacion|medicion|analisis|arbol|iteracion)\b/);
  });

  /** Cambia el valor de un control de React desde fuera: hay que pasar por el setter
   *  nativo y disparar el evento, porque React escucha 'input' y compara con su valor guardado. */
  const escribir = async (el: HTMLInputElement, valor: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(el, valor);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('pasa a la vista 3D y vuelve a la plana conservando colores, anillos, búsqueda, deslizador y plegado', async () => {
    const e = estadoConDato();
    const inv = e.investigaciones[0]!;
    await montar(<Arbol inv={inv} estado={e} />);
    // Por defecto, la vista plana: no se le cambia el árbol a quien ya lo conoce.
    expect(boton('Vista plana').getAttribute('aria-pressed')).toBe('true');
    expect(boton('Vista 3D').getAttribute('aria-pressed')).toBe('false');
    expect(escena().modo).toBe('plana');
    expect(lienzo().getAttribute('data-vista')).toBe('plana');
    await pulsar(boton('Vista 3D'));
    expect(boton('Vista 3D').getAttribute('aria-pressed')).toBe('true');
    expect(boton('Vista plana').getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('rosa-arbol-vista')).toBe('3d');
    expect(escena().modo).toBe('3d');
    expect(lienzo().getAttribute('aria-label')).toContain('en tres dimensiones');
    // El tronco se proyecta en el centro del lienzo; todo nodo tiene posición y radio finitos y una niebla entre 0 y 1.
    expect(nodoEsc('objetivo')).toMatchObject({ x: 450, y: 280 });
    expect(cuantos()).toBeGreaterThan(3);
    expect(finitos()).toBe(true);
    for (const n of escena().nodos) expect(n.r, n.id).toBeGreaterThan(0);
    // Relleno por familia y anillo de evidencia, idénticos a la vista plana.
    expect(nodoEsc('hip-1').estilo.relleno).toMatch(/var\(--grafo-cluster-\d\)/);
    expect(nodoEsc('hip-1').estilo.anillo).toMatch(/var\(--grafo-(dato|lit)-\d\)|var\(--text-3\)/);
    expect(nodoEsc('objetivo').estilo.relleno).toBe('var(--accent)');
    // Desplegar todo en 3D: aparecen el análisis, la observación, la entidad y la
    // descartada (que sigue a rayas), con sus colores.
    await pulsar(boton('Desplegar todo'));
    expect(nodoEsc('hip-5').estilo.guion).toBe('3 2');
    expect(nodoEsc('run-1')).toBeTruthy();
    expect(nodoEsc('af-obs-1')).toBeTruthy();
    expect(escena().nodos.find((n) => n.id.startsWith('ent-'))!.estilo.relleno).toBe('var(--blue)');
    const conTodo = cuantos();
    // La lista accesible tiene un botón por nodo visible.
    expect(nodo.querySelectorAll('ul[role="list"] button').length).toBe(conTodo);
    // El modo por distancia también funciona en 3D.
    await pulsar(boton('Por distancia al dato'));
    expect(nodoEsc('run-1').estilo.relleno).toBe('var(--grafo-dato-0)');
    expect(nodoEsc('hip-1').estilo.relleno).toBe('var(--grafo-dato-1)');
    await pulsar(boton('Por tipo y mecanismo'));
    // La búsqueda ilumina en 3D: lo que no nombra GFAP queda atenuado, lo que sí, no.
    const buscador = nodo.querySelector('input[aria-label="Buscar en el árbol"]') as HTMLInputElement;
    await escribir(buscador, 'GFAP');
    expect(atenuados()).toBeGreaterThan(0);
    expect(atenuados()).toBeLessThan(cuantos());
    expect(escena().nodos.find((n) => n.id.startsWith('ent-'))!.vivo).toBe(true);
    await escribir(buscador, '');
    expect(atenuados()).toBe(0);
    // Pulsar un nodo en 3D lo selecciona (el panel dice qué es) y despliega o pliega sus vecinos.
    await pulsar(botonNodo('hip-1'));
    expect(nodo.querySelector('.grafo-panel')!.textContent).toContain('Hipótesis');
    expect(nodo.querySelector('.grafo-panel')!.textContent).toContain('A 1 salto de una medición propia.');
    // El deslizador de iteraciones filtra también en 3D.
    const deslizador = nodo.querySelector('#grafo-iteracion') as HTMLInputElement;
    await escribir(deslizador, '1');
    expect(nodo.textContent).toContain('hasta la iteración 1');
    expect(cuantos()).toBeLessThan(conTodo);
    await pulsar(boton('Volver al presente'));
    // Plegar todo en 3D vuelve a lo inicial y a la cámara de salida.
    await pulsar(boton('Plegar todo'));
    expect(cuantos()).toBeLessThan(conTodo);
    expect(nodo.querySelector('.grafo-panel')!.textContent).toContain('Leyenda');
    expect(nodoEsc('objetivo')).toMatchObject({ x: 450, y: 280 });
    // Cambiar de investigación con la vista 3D abierta: el grafo se reconstruye entero sin romper.
    const e2 = structuredClone(e);
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2', titulo: 'Otra investigación distinta' };
    e2.investigaciones = [inv2];
    for (const h of e2.hipotesis) h.investigacionId = 'inv-2';
    for (const h of e2.hechos) h.investigacionId = 'inv-2';
    for (const c of e2.corridas) c.investigacionId = 'inv-2';
    for (const r of e2.ejecuciones ?? []) r.investigacionId = 'inv-2';
    await montar(<Arbol inv={inv2} estado={e2} />);
    expect(lienzo().getAttribute('aria-label')).toContain('Otra investigación distinta');
    expect(cuantos()).toBeGreaterThan(3);
    expect(finitos()).toBe(true);
    // Vuelta a la vista plana: todo sigue.
    await pulsar(boton('Vista plana'));
    expect(boton('Vista plana').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('rosa-arbol-vista')).toBe('plana');
    expect(escena().modo).toBe('plana');
    expect(nodoEsc('hip-1').estilo.relleno).toMatch(/var\(--grafo-cluster-\d\)/);
    expect(nodoEsc('objetivo')).toMatchObject({ x: 450, y: 280, opacidad: 1 });
    // Ayuda y leyenda en castellano, sin guiones largos ni palabras sin tilde.
    expect(nodo.textContent).toContain('Con «Vista 3D» el mismo árbol se despliega en tres dimensiones');
    expect(nodo.textContent).not.toContain('\u2014');
    expect(nodo.textContent).not.toMatch(/\b(hipotesis|investigacion|medicion|analisis|arbol|iteracion|camara|giralo)\b/);
  });

  it('recuerda la vista 3D elegida al volver a abrir el árbol', async () => {
    localStorage.setItem('rosa-arbol-vista', '3d');
    const e = estadoConDato();
    await montar(<Arbol inv={e.investigaciones[0]!} estado={e} />);
    expect(boton('Vista 3D').getAttribute('aria-pressed')).toBe('true');
    expect(escena().modo).toBe('3d');
    expect(cuantos()).toBeGreaterThan(3);
  });

  /** Radio del tronco: RADIO.objetivo (22) por el factor de peso (0,8 + 1,2 · 0,3) por FOCAL / distancia. */
  const radioTronco = (distancia: number) => 22 * (0.8 + Math.min(1.4, 4) * 0.3) * Math.min(4, FOCAL / distancia);
  const rTronco = () => nodoEsc('objetivo').r;
  /** La huella de un cuadro: orden, posición, radio y opacidad de cada nodo. */
  const transformes = () => huella(escena());
  const dentroDelMarco = () => {
    for (const n of escena().nodos) if (!(n.x >= 0 && n.x <= 900 && n.y >= 0 && n.y <= 560)) return `${n.id}: fuera (${n.x}, ${n.y})`;
    return 'todos dentro';
  };
  /** Un evento de puntero sobre el lienzo: con un canvas sin tamaño (jsdom) las coordenadas del evento son las lógicas. */
  const puntero = async (el: Element, tipo: string, x: number, y: number) => act(async () => el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y })));
  /** El puntero sale del lienzo: React deriva onPointerLeave del pointerout nativo con relatedTarget fuera. */
  const salirDelLienzo = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
  const rueda = async (el: Element, deltaY: number, veces = 1) => {
    for (let i = 0; i < veces; i++) await act(async () => el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })));
  };

  it('la rueda y el arrastre no sacan la cámara de sus límites, el arrastre es incremental, el ratón ilumina y pulsa por cercanía, y el almacenamiento roto no tumba la vista', async () => {
    // Modo privado o cuota llena: localStorage lanza. La vista arranca plana y aun así se puede pasar a 3D.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('almacenamiento no disponible'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('almacenamiento no disponible'); });
    const e = estadoConDato();
    try {
      await montar(<Arbol inv={e.investigaciones[0]!} estado={e} />);
      expect(boton('Vista plana').getAttribute('aria-pressed')).toBe('true');
      await pulsar(boton('Vista 3D'));
      expect(boton('Vista 3D').getAttribute('aria-pressed')).toBe('true');
      expect(escena().modo).toBe('3d');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
    const svg = lienzo();
    // Cámara de salida encuadrada: nunca más cerca que la distancia inicial, y todo dentro del lienzo.
    expect(rTronco()).toBeLessThanOrEqual(radioTronco(1000) + 1e-6);
    expect(dentroDelMarco()).toBe('todos dentro');
    // Desplegar todo: el árbol crece y la cámara se aleja sola hasta abarcarlo entero.
    const antesDesplegar = rTronco();
    await pulsar(boton('Desplegar todo'));
    expect(rTronco()).toBeLessThanOrEqual(antesDesplegar); // con las hipótesis grandes, el encuadre inicial ya puede abarcar todo
    expect(dentroDelMarco()).toBe('todos dentro');
    const conTodo = cuantos();
    // Sesenta pasos de rueda hacia dentro: la distancia se para en la mínima. La rueda
    // manda sobre el encuadre y ningún nodo sale de la escena aunque quede detrás de la cámara.
    await rueda(svg, -100, 60);
    expect(rTronco()).toBeCloseTo(radioTronco(DISTANCIA_MINIMA), 3);
    expect(cuantos()).toBe(conTodo);
    // Cien hacia fuera: en la máxima. Ningún nodo pierde su posición finita.
    await rueda(svg, 100, 100);
    expect(rTronco()).toBeCloseTo(radioTronco(DISTANCIA_MAXIMA), 3);
    expect(cuantos()).toBe(conTodo);
    expect(finitos()).toBe(true);
    await rueda(svg, -100, 20);
    // Arrastrar el fondo en horizontal gira el árbol: los nodos cambian de sitio, el tronco no.
    // El fondo es un punto sin nodo: la esquina del lienzo.
    const antesGiro = transformes();
    await puntero(svg, 'pointerdown', 2, 2);
    await puntero(svg, 'pointermove', 252, 2);
    expect(transformes()).not.toBe(antesGiro);
    expect(nodoEsc('objetivo')).toMatchObject({ x: 450, y: 280 });
    // Arrastrar 3000 píxeles hacia abajo pide un cabeceo de unos 24 radianes: se acota a 80 grados.
    await puntero(svg, 'pointermove', 252, 3002);
    const enElTope = transformes();
    await puntero(svg, 'pointermove', 252, 6002);
    expect(transformes()).toBe(enElTope); // más allá del tope, nada cambia
    // Diez píxeles de vuelta: la cámara responde en seguida, sin desandar los 3000 de exceso.
    await puntero(svg, 'pointermove', 252, 5992);
    expect(transformes()).not.toBe(enElTope);
    await puntero(svg, 'pointerup', 252, 5992);
    expect(finitos()).toBe(true);
    // El ratón sobre un nodo lo ilumina (por cercanía) y atenúa a los que no son sus vecinos; al salir del lienzo, nada queda atenuado.
    const hip = nodoEsc('hip-1');
    await puntero(svg, 'pointermove', hip.x + 1, hip.y - 1);
    expect(nodoEsc('hip-1').hover).toBe(true);
    expect(atenuados()).toBeGreaterThan(0);
    await salirDelLienzo(svg);
    expect(nodoEsc('hip-1').hover).toBe(false);
    expect(atenuados()).toBe(0);
    // Un nodo en 3D no se arrastra: agarrarlo y mover no gira la cámara, y soltar tras moverse no es un clic.
    const antes = transformes();
    const seleccionAntes = nodoEsc('hip-1').sel;
    await puntero(svg, 'pointerdown', hip.x, hip.y);
    await puntero(svg, 'pointermove', hip.x + 300, hip.y);
    expect(transformes()).toBe(antes);
    await puntero(svg, 'pointerup', hip.x + 300, hip.y);
    expect(nodoEsc('hip-1').sel).toBe(seleccionAntes);
    // Pulsar (bajar y soltar sin mover) sobre el nodo lo selecciona; el panel lo dice.
    const h = nodoEsc('hip-1');
    await puntero(svg, 'pointerdown', h.x, h.y);
    await puntero(svg, 'pointerup', h.x, h.y);
    expect(nodoEsc('hip-1').sel).toBe(true);
    expect(nodo.querySelector('.grafo-panel')!.textContent).toContain('Hipótesis');
    // Y lo mismo desde el teclado, por la lista accesible.
    await pulsar(botonNodo('objetivo'));
    expect(nodoEsc('objetivo').sel).toBe(true);
    expect(botonNodo('objetivo').getAttribute('aria-pressed')).toBe('true');
  });

  it('la rueda funciona aunque el árbol naciera vacío, y un árbol vacío con la vista 3D guardada explica qué pasará', async () => {
    localStorage.setItem('rosa-arbol-vista', '3d');
    const e = estadoConDato();
    const inv = e.investigaciones[0]!;
    const vacio: EstadoRosa = { ...e, hipotesis: [], hechos: [] };
    await act(async () => root.render(<Arbol inv={inv} estado={vacio} />));
    expect(nodo.querySelector('canvas.grafo')).toBeNull();
    expect(nodo.textContent).toContain('El árbol todavía no tiene ramas');
    // Llegan las hipótesis por SSE: aparece el lienzo y la rueda tiene que estar enganchada.
    await montar(<Arbol inv={inv} estado={e} />);
    const svg = lienzo();
    const antes = rTronco();
    await rueda(svg, -100, 1);
    expect(rTronco()).toBeCloseTo(antes * 1.12, 3); // un paso de rueda acerca la cámara un 12 %
  });

  /** Arnés con animación encendida: los fotogramas van a una cola manual para
   *  contarlos y vaciarlos a voluntad. Devuelve `fotogramas(n, ms)` y la cola. */
  const conAnimacion = async (cuerpo: (fotogramas: (n: number, ms?: number) => Promise<void>, pendientes: Map<number, FrameRequestCallback>) => Promise<void>) => {
    movimiento.reducido = false;
    const pendientes = new Map<number, FrameRequestCallback>();
    let siguiente = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pendientes.set(++siguiente, cb);
      return siguiente;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendientes.delete(id);
    });
    const base = performance.now();
    let reloj = 0;
    const fotogramas = async (n: number, ms = 16) => {
      for (let i = 0; i < n; i++) {
        reloj += ms;
        const t = base + reloj;
        const lote = [...pendientes.entries()];
        pendientes.clear();
        await act(async () => {
          for (const [, cb] of lote) cb(t);
        });
      }
    };
    try {
      await cuerpo(fotogramas, pendientes);
    } finally {
      movimiento.reducido = true;
      vi.unstubAllGlobals();
    }
  };

  it('la rueda fija la distancia: ni la simulación al asentarse, ni el giro automático, ni un estado nuevo la devuelven; solo Plegar todo', async () => {
    await conAnimacion(async (fotogramas) => {
      localStorage.setItem('rosa-arbol-vista', '3d');
      const e = estadoConDato();
      await act(async () => root.render(<Arbol inv={e.investigaciones[0]!} estado={e} />));
      await fotogramas(60, 10);
      const svg = lienzo();
      // La persona acerca la cámara con la rueda: cinco pasos.
      await rueda(svg, -100, 5);
      await fotogramas(2, 10);
      const elegida = rTronco();
      expect(elegida).toBeGreaterThan(radioTronco(1000));
      // Desplegar todo: nacen nodos, la simulación se asienta durante 200 cuadros... y la distancia no se mueve.
      await pulsar(boton('Desplegar todo'));
      for (let i = 0; i < 4; i++) {
        await fotogramas(50, 10);
        expect(rTronco()).toBeCloseTo(elegida, 6);
      }
      // Pasan los 3 s y el árbol gira solo: la guiñada cambia, la distancia no.
      await fotogramas(120, 10);
      const girando = transformes();
      await fotogramas(5, 10);
      expect(transformes()).not.toBe(girando);
      expect(rTronco()).toBeCloseTo(elegida, 6);
      // Llega un estado nuevo por SSE (mismo árbol, otro objeto): tampoco.
      await act(async () => root.render(<Arbol inv={e.investigaciones[0]!} estado={structuredClone(e)} />));
      await fotogramas(30, 10);
      expect(rTronco()).toBeCloseTo(elegida, 6);
      // Plegar todo devuelve la cámara de salida y el encuadre vuelve a mandar.
      await pulsar(boton('Plegar todo'));
      await fotogramas(200, 10);
      expect(rTronco()).toBeLessThanOrEqual(radioTronco(1000) + 1e-6);
      expect(dentroDelMarco()).toBe('todos dentro');
    });
  }, 30000);

  it('en 3D el árbol gira solo tras unos segundos sin tocarlo, se para con el ratón encima, la huella es estable entre cuadros y al desmontar no queda ningún fotograma pendiente', async () => {
    await conAnimacion(async (fotogramas, pendientes) => {
      localStorage.setItem('rosa-arbol-vista', '3d');
      const e = estadoConDato();
      await act(async () => root.render(<Arbol inv={e.investigaciones[0]!} estado={e} />));
      expect(pendientes.size).toBe(1); // el fotograma tras el que se construye el grafo (lib/diferido.ts); el bucle se engancha al montar el árbol
      // La simulación se enfría en unos 140 fotogramas y el encuadre encaja detrás; a los 3 s empieza el giro.
      await fotogramas(200, 10);
      expect(pendientes.size).toBe(1); // un solo bucle: física, encuadre, giro y pintado
      expect(dentroDelMarco()).toBe('todos dentro');
      const quieto = transformes();
      await fotogramas(3, 10);
      // Antes de los 3 s, con la cámara quieta y la simulación enfriada, dos cuadros
      // seguidos dan el mismo orden de ids, la misma posición, radio y opacidad por nodo.
      expect(transformes()).toBe(quieto);
      await fotogramas(160, 10); // pasa de los 3 s (contados desde el montaje, con reloj real de por medio)
      const girando = transformes();
      await fotogramas(5, 10);
      expect(transformes()).not.toBe(girando);
      expect(nodoEsc('objetivo')).toMatchObject({ x: 450, y: 280 });
      // Con el ratón sobre un nodo, el giro se para; al salir del lienzo, sigue.
      const svg = lienzo();
      const hip = nodoEsc('hip-1');
      await puntero(svg, 'pointermove', hip.x, hip.y);
      expect(nodoEsc('hip-1').hover).toBe(true);
      const parado = transformes();
      await fotogramas(5, 10);
      expect(transformes()).toBe(parado);
      await salirDelLienzo(svg);
      await fotogramas(5, 10);
      expect(transformes()).not.toBe(parado);
      // El nodo bajo el ratón desaparece (Plegar todo lo quita): el giro no puede quedarse pausado.
      await pulsar(boton('Desplegar todo'));
      await fotogramas(200, 10); // la simulación se asienta con lo nuevo y el encuadre la sigue cuadro a cuadro
      expect(rTronco()).toBeLessThan(radioTronco(1000)); // la cámara se alejó sola para abarcar el árbol desplegado
      expect(dentroDelMarco()).toBe('todos dentro');
      const run = nodoEsc('run-1');
      await puntero(svg, 'pointermove', run.x, run.y);
      expect(nodoEsc('run-1').hover).toBe(true);
      const conRaton = transformes();
      await fotogramas(5, 10);
      expect(transformes()).toBe(conRaton);
      await pulsar(boton('Plegar todo'));
      expect(escena().nodos.find((n) => n.id === 'run-1')).toBeUndefined();
      await fotogramas(200, 10); // cámara de salida y simulación asentada de nuevo
      const trasPlegar = transformes();
      await fotogramas(5, 10);
      expect(transformes()).not.toBe(trasPlegar);
      expect(atenuados()).toBe(0);
      // Al volver a la vista plana, el mismo bucle sigue solo (vaivén): un fotograma pendiente.
      await pulsar(boton('Vista plana'));
      await fotogramas(250, 10);
      expect(pendientes.size).toBe(1);
      expect(escena().modo).toBe('plana');
      // Y de vuelta a 3D: sigue siendo uno.
      await pulsar(boton('Vista 3D'));
      await fotogramas(250, 10);
      expect(pendientes.size).toBe(1);
      // Al desmontar no queda nada en la cola, ni nada que se vuelva a encolar.
      await act(async () => root.unmount());
      await fotogramas(3, 10);
      expect(pendientes.size).toBe(0);
      root = createRoot(nodo); // para que el afterEach desmonte algo
    });
  }, 30000);

  it('con una investigación vacía explica qué pasará, con tildes', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const vacio: EstadoRosa = { ...e, hipotesis: [], hechos: [] };
    await act(async () => root.render(<Arbol inv={inv} estado={vacio} />));
    expect(nodo.textContent).toContain('ya está.');
    expect(nodo.textContent).toContain('aparecerán');
    expect(nodo.textContent).toContain('Aquí se ve toda la investigación conectada: qué sostiene a qué');
  });
});
