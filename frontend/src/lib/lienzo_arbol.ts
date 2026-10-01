// El lienzo del árbol de la investigación (17 de septiembre de 2026, "sube los
// fps del árbol"). Hasta hoy el árbol se dibujaba con unos novecientos elementos
// SVG y, aunque solo se cambiaran atributos, el navegador tenía que recalcular
// el estilo y volver a componer cada uno en cada cuadro (8 ms de los 16 que hay
// por cuadro a 60 fps). Un <canvas> 2D no guarda elementos: cada cuadro se pinta
// entero de un trazo, y pintar 350 círculos, 700 líneas y 80 textos cuesta dos o
// tres milisegundos. Es lo que hace Obsidian (con WebGL) para tener miles de
// nodos fluidos; para los cientos de ROSA2018 basta Canvas 2D y no hace falta nada
// nuevo en el proyecto.
//
// Tres piezas, todas puras salvo el trazo:
//
// 1. LA ESCENA (construirEscena). El modelo de lo que se ve: para cada nodo su
//    posición en el lienzo, su radio, su opacidad, su estilo (relleno, anillo,
//    rayas), su etiqueta partida y en qué orden se pinta; para cada enlace sus
//    dos extremos y su trazo. En la vista plana la posición viene de la física
//    de lib/arbol.ts más el desplazamiento y el zoom de la vista; en 3D, de la
//    proyección en perspectiva de lib/arbol3d.ts, con la niebla y el orden de
//    lejos a cerca. Los colores van como tokens (`var(--accent)`) para que los
//    tests los comparen sin navegador; la paleta los resuelve al pintar.
//
// 2. LA PALETA (Paleta). Lee los tokens de styles.css con getComputedStyle una
//    vez por tema (la pantalla la refresca cuando cambia data-theme o
//    prefers-color-scheme), así el canvas usa exactamente los mismos colores
//    que el resto de ROSA2018 en claro y en oscuro.
//
// 3. EL TRAZO (dibujar). Enlaces primero, nodos después en el orden de la
//    escena, cada uno con su halo (el tronco), su relleno, su anillo, sus rayas,
//    su icono y su etiqueta con el mismo halo de fondo que tenía en SVG
//    (paint-order: stroke). El puntero se resuelve con nodoBajoPuntero: el nodo
//    más cercano dentro de su radio más cuatro píxeles, mirando primero los de
//    arriba.

import type { Grafo, NodoArbol, Posicion, TipoEnlace, TipoNodo } from './arbol';
import { niebla, ordenarPorProfundidad, proyectar, type Camara, type Posicion3 } from './arbol3d';
import { traducido } from './idioma';

/** Radio base de cada tipo de nodo, en unidades del lienzo. */
export const RADIO: Record<TipoNodo, number> = { objetivo: 22, rama: 13, area: 12, hipotesis: 11, hecho: 7, pregunta: 7, fuente: 5, entidad: 6, experimento: 12, afirmacion: 6, ejecucion: 9, dataset: 8, laboratorio: 12 };

/** Radio del círculo de un nodo (sin proyectar ni ampliar): por tipo y algo más por peso. */
export const radioBase = (n: NodoArbol): number => {
  // Las hipótesis usan su peso entero (de 0,8 a 3,85: certeza, torneo y
  // candidatura, ver pesoHipotesis en arbol.ts): una de certeza alta se ve casi
  // el doble que una de muy baja. Antes el tope de 1,4 las dejaba todas iguales.
  if (n.tipo === 'hipotesis') return RADIO.hipotesis * (0.7 + Math.max(0.8, Math.min(3.85, n.peso)) * 0.32);
  return RADIO[n.tipo] * (0.8 + Math.min(1.4, n.peso) * 0.3);
};

/** Cuánto se ve la etiqueta de un nodo según el zoom y su importancia (el
 *  "text fade threshold" del grafo de Obsidian): el tronco siempre; ramas,
 *  hipótesis y experimentos desde un zoom normal; lo pequeño solo al acercar,
 *  o si está iluminado o seleccionado. En 3D el "zoom" de cada nodo es su
 *  escala proyectada, así que las etiquetas pequeñas solo salen en los nodos
 *  cercanos a la cámara y las de peso alto se leen desde más lejos. */
export function opacidadEtiqueta(n: NodoArbol, k: number, vivo: boolean, sel: boolean): number {
  if (sel) return 1;
  const umbral = n.tipo === 'objetivo' ? 0 : n.tipo === 'rama' || n.tipo === 'area' || n.tipo === 'hipotesis' || n.tipo === 'experimento' || n.tipo === 'laboratorio' || n.tipo === 'ejecucion' ? 0.75 : 1.5;
  const base = Math.max(0, Math.min(1, (k - umbral) / 0.35 + 1));
  return vivo ? Math.max(base, n.tipo === 'fuente' || n.tipo === 'entidad' || n.tipo === 'hecho' || n.tipo === 'pregunta' || n.tipo === 'afirmacion' || n.tipo === 'dataset' ? 0.9 : 1) : base;
}

/** Parte una etiqueta en hasta dos líneas de unos 22 caracteres. */
export function lineas(texto: string, maximo = 22): string[] {
  if (texto.length <= maximo) return [texto];
  const palabras = texto.split(' ');
  const salida: string[] = [];
  let actual = '';
  for (const p of palabras) {
    if ((actual + ' ' + p).trim().length > maximo && actual) {
      salida.push(actual);
      actual = p;
      if (salida.length === 2) break;
    } else actual = (actual + ' ' + p).trim();
  }
  if (salida.length < 2 && actual) salida.push(actual);
  if (salida.length === 2 && salida.join(' ').length < texto.length) salida[1] = `${salida[1]!.slice(0, maximo - 3)}...`;
  return salida;
}

/** Balanceo en reposo de la vista plana: un vaivén lento y distinto por nodo (solo
 *  al dibujar, no en la física) para que el árbol nunca parezca una foto. Con
 *  `reloj` nulo (movimiento reducido o vista 3D) no hay balanceo. */
export function vaiven(id: string, peso: number, reloj: number | null): { x: number; y: number } {
  if (reloj === null) return { x: 0, y: 0 };
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const fase = (h % 628) / 100;
  const amp = 1.6 + Math.min(2.5, peso) * 0.5;
  return { x: Math.sin(reloj * 0.7 + fase) * amp, y: Math.cos(reloj * 0.55 + fase * 1.3) * amp * 0.8 };
}

/** Tamaño de letra de la etiqueta de un nodo, en unidades del lienzo. */
export const tamanoEtiqueta = (n: NodoArbol): number => (n.tipo === 'objetivo' ? 13 : n.tipo === 'rama' || n.tipo === 'hipotesis' || n.tipo === 'experimento' || n.tipo === 'laboratorio' ? 10.5 : 9);

/** Cómo se rellena y se bordea un nodo. Los colores son tokens (`var(--x)`) o literales. */
export interface EstiloNodo {
  relleno: string;
  anillo: string;
  anchoAnillo: number;
  /** Patrón de rayas como en SVG ("3 2"), o nulo si el borde es continuo. */
  guion: string | null;
}

export interface Trazo {
  color: string;
  ancho: number;
  guion?: string;
}

export interface EtiquetaEscena {
  lineas: string[];
  /** Tamaño de letra ya escalado (zoom en la plana, profundidad acotada en 3D). */
  tamano: number;
  opacidad: number;
  /** Distancia del centro del nodo a la primera línea. */
  desplazamiento: number;
  /** Separación entre líneas, ya escalada. */
  interlineado: number;
  negrita: boolean;
  secundaria: boolean;
}

export interface NodoEscena {
  id: string;
  tipo: TipoNodo;
  x: number;
  y: number;
  r: number;
  /** Escala con la que se dibujan icono y halo: el zoom en la plana, la proyección en 3D. */
  escala: number;
  /** Opacidad del nodo entero (niebla en 3D; 1 en la plana). Cero si queda detrás de la cámara. */
  opacidad: number;
  visible: boolean;
  estilo: EstiloNodo;
  /** false si está atenuado (búsqueda o ratón sobre otro nodo). */
  vivo: boolean;
  sel: boolean;
  hover: boolean;
  etiqueta: EtiquetaEscena;
}

export interface EnlaceEscena {
  clave: string;
  de: string;
  a: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  ancho: number;
  guion: string | null;
  opacidad: number;
}

export interface Escena {
  modo: 'plana' | '3d';
  ancho: number;
  alto: number;
  /** En orden de pintado: lo último queda encima. */
  nodos: NodoEscena[];
  enlaces: EnlaceEscena[];
}

export interface EntradaEscena {
  modo: 'plana' | '3d';
  grafo: Grafo;
  /** Identificadores visibles, en el orden en que se pintan en la vista plana. */
  ids: Iterable<string>;
  pos2: Map<string, Posicion>;
  pos3: Map<string, Posicion3>;
  camara: Camara;
  vista: { x: number; y: number; k: number };
  /** Segundos para el vaivén de la plana, o nulo si no hay balanceo. */
  reloj: number | null;
  ancho: number;
  alto: number;
  estiloDe: (n: NodoArbol) => EstiloNodo;
  trazoDe: (tipo: TipoEnlace) => Trazo;
  /** El nodo bajo el ratón (ya filtrado a los visibles) y los iluminados por la búsqueda. */
  foco: string | null;
  iluminados: ReadonlySet<string>;
  seleccion: string | null;
}

/** Opacidad de lo atenuado (la de .grafo-atenuado en styles.css). */
export const OPACIDAD_ATENUADO = 0.18;
/** Margen del acierto del puntero alrededor del círculo, en unidades del lienzo. */
export const MARGEN_PUNTERO = 4;

/** El modelo de lo que se ve: puro, determinista y barato (unos cientos de nodos). */
export function construirEscena(e: EntradaEscena): Escena {
  const { grafo, ancho, alto } = e;
  const vecinosFoco = e.foco ? grafo.vecinos.get(e.foco) ?? null : null;
  const atenuar = e.iluminados.size > 0 || e.foco !== null;
  const destacado = (id: string) => (e.iluminados.size > 0 ? e.iluminados.has(id) : e.foco === null || e.foco === id || (vecinosFoco?.has(id) ?? false));
  const nodos: NodoEscena[] = [];
  const porId = new Map<string, NodoEscena>();
  const etiquetaDe = (n: NodoArbol, escalaTexto: number, opacidad: number, desplazamiento: number): EtiquetaEscena => ({
    lineas: lineas(n.etiqueta),
    tamano: tamanoEtiqueta(n) * escalaTexto,
    opacidad,
    desplazamiento,
    interlineado: 12 * escalaTexto,
    negrita: n.tipo === 'hipotesis' || n.tipo === 'objetivo',
    secundaria: n.tipo === 'fuente' || n.tipo === 'entidad',
  });
  if (e.modo === '3d') {
    const ids = [...e.ids].filter((id) => e.pos3.has(id) && grafo.porId.has(id));
    for (const id of ordenarPorProfundidad(ids, e.pos3, e.camara)) {
      const n = grafo.porId.get(id)!;
      const pr = proyectar(e.pos3.get(id)!, e.camara, ancho, alto);
      const r = radioBase(n) * pr.escala;
      const vivo = destacado(id);
      const sel = e.seleccion === id;
      const hover = e.foco === id;
      // La escala proyectada hace de zoom para la etiqueta; su tamaño encoge o crece
      // con la profundidad, acotado para que siga leyéndose.
      const opEt = pr.visible ? opacidadEtiqueta(n, pr.escala, vivo && atenuar, sel || hover) : 0;
      const nodo: NodoEscena = { id, tipo: n.tipo, x: pr.x, y: pr.y, r, escala: pr.escala, opacidad: pr.visible ? niebla(pr.profundidad, e.camara) : 0, visible: pr.visible, estilo: e.estiloDe(n), vivo, sel, hover, etiqueta: etiquetaDe(n, Math.max(0.6, Math.min(1.25, pr.escala)), opEt, r + 11) };
      nodos.push(nodo);
      porId.set(id, nodo);
    }
  } else {
    const k = e.vista.k;
    for (const id of e.ids) {
      const n = grafo.porId.get(id);
      const p = e.pos2.get(id);
      if (!n || !p) continue;
      const v = vaiven(id, n.peso, e.reloj);
      const vivo = destacado(id);
      const sel = e.seleccion === id;
      const hover = e.foco === id;
      const r = radioBase(n) * k;
      const nodo: NodoEscena = { id, tipo: n.tipo, x: ancho / 2 + e.vista.x + (p.x + v.x) * k, y: alto / 2 + e.vista.y + (p.y + v.y) * k, r, escala: k, opacidad: 1, visible: true, estilo: e.estiloDe(n), vivo, sel, hover, etiqueta: etiquetaDe(n, k, opacidadEtiqueta(n, k, vivo && atenuar, sel || hover), r + 11 * k) };
      nodos.push(nodo);
      porId.set(id, nodo);
    }
  }
  const enlaces: EnlaceEscena[] = [];
  for (const en of grafo.enlaces) {
    const a = porId.get(en.de);
    const b = porId.get(en.a);
    if (!a || !b) continue;
    const t = e.trazoDe(en.tipo);
    const vivo = !atenuar || (destacado(en.de) && destacado(en.a));
    const base = vivo ? 0.75 : 0.12;
    // En 3D la niebla del enlace es la del extremo más lejano y el grosor sigue a la
    // escala media; un extremo detrás de la cámara lo deja invisible.
    const opacidad = e.modo === '3d' ? (a.visible && b.visible ? base * Math.min(a.opacidad, b.opacidad) : 0) : base;
    const ancho = e.modo === '3d' ? Math.max(0.4, t.ancho * ((a.escala + b.escala) / 2)) : t.ancho * e.vista.k;
    enlaces.push({ clave: `${en.de}|${en.a}|${en.tipo}`, de: en.de, a: en.a, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: t.color, ancho, guion: t.guion ?? null, opacidad });
  }
  return { modo: e.modo, ancho, alto, nodos, enlaces };
}

/** La huella de un cuadro: orden de los nodos con posición, radio y opacidad.
 *  Dos cuadros con la cámara quieta y la simulación asentada tienen la misma. */
export function huella(escena: Escena): string {
  return escena.nodos.map((n) => `${n.id}=${n.x.toFixed(3)},${n.y.toFixed(3)}|${n.r.toFixed(3)}|${n.opacidad.toFixed(3)}`).join(';');
}

/** El nodo bajo el puntero: el más cercano cuyo círculo (más un margen) contiene
 *  el punto, mirando primero los que se pintan encima. Nulo si no hay ninguno. */
export function nodoBajoPuntero(escena: Escena, x: number, y: number): string | null {
  let mejor: string | null = null;
  let mejorDistancia = Infinity;
  for (let i = escena.nodos.length - 1; i >= 0; i--) {
    const n = escena.nodos[i]!;
    if (!n.visible || n.opacidad <= 0) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= n.r + MARGEN_PUNTERO && d < mejorDistancia) {
      mejor = n.id;
      mejorDistancia = d;
    }
  }
  return mejor;
}

/** Resuelve `var(--token)` a un color leyendo los tokens de la raíz una sola vez
 *  (caché) hasta que `refrescar` la vacíe al cambiar el tema. Un valor que no es
 *  un token se devuelve tal cual; un token que no existe, con su respaldo. */
export class Paleta {
  private cache = new Map<string, string>();
  constructor(private raiz: Element | null, private respaldos: Record<string, string> = {}) {}
  refrescar(): void {
    this.cache.clear();
  }
  color(valor: string): string {
    const m = /^var\((--[\w-]+)\)$/.exec(valor.trim());
    if (!m) return valor;
    const token = m[1]!;
    const guardado = this.cache.get(token);
    if (guardado !== undefined) return guardado;
    let leido = '';
    if (this.raiz && typeof getComputedStyle === 'function') leido = getComputedStyle(this.raiz).getPropertyValue(token).trim();
    const color = leido || this.respaldos[token] || '#888888';
    this.cache.set(token, color);
    return color;
  }
}

/** Colores de respaldo para cuando el token no se puede leer (tests sin navegador). */
export const RESPALDOS_PALETA: Record<string, string> = traducido({ '--text': '#1c1917', '--text-2': '#78716c', '--text-3': '#a5a19c', '--bg': '#faf9f7', '--surface': '#ffffff', '--accent': '#5b2aa8', '--border-strong': 'rgba(0, 0, 0, 0.14)' });

const guionA = (g: string | null): number[] => (g ? g.split(/\s+/).map(Number).filter((v) => Number.isFinite(v)) : []);

/** Trazos de los iconos (los mismos que tenía el SVG), en unidades del nodo. */
const ICONO_EXPERIMENTO = 'M-4 -5 h8 v3 l3 6 a2 2 0 0 1 -2 3 h-10 a2 2 0 0 1 -2 -3 l3 -6 z';
const ICONO_LABORATORIO = 'M-4.5 0.5 l3 3 l6 -7';

/** Lo que el trazo necesita del navegador además del contexto 2D. */
export interface OpcionesTrazo {
  paleta: Paleta;
  /** Familia tipográfica ya resuelta (la de --font-sans). */
  fuente: string;
  /** Escala del lienzo lógico (900 por 560) al canvas en píxeles reales, y su desplazamiento. */
  escala: number;
  dx: number;
  dy: number;
  /** Píxeles reales del canvas, para limpiarlo entero. */
  anchoPx: number;
  altoPx: number;
}

/** Pinta la escena entera en un cuadro. El contexto se tipa a lo mínimo que se
 *  usa para poder pasarle un falso en los tests. */
export type Contexto2D = Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'arc' | 'setLineDash' | 'save' | 'restore' | 'translate' | 'scale' | 'fillText' | 'strokeText'> & {
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  stroke(path?: Path2D): void;
};

export function dibujar(ctx: Contexto2D, escena: Escena, o: OpcionesTrazo): void {
  const color = (v: string) => o.paleta.color(v);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, o.anchoPx, o.altoPx);
  ctx.setTransform(o.escala, 0, 0, o.escala, o.dx, o.dy);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  // Enlaces.
  for (const en of escena.enlaces) {
    if (en.opacidad <= 0) continue;
    ctx.globalAlpha = en.opacidad;
    ctx.strokeStyle = color(en.color);
    ctx.lineWidth = en.ancho;
    ctx.setLineDash(guionA(en.guion));
    ctx.beginPath();
    ctx.moveTo(en.x1, en.y1);
    ctx.lineTo(en.x2, en.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const textoPrincipal = color('var(--text)');
  const textoSecundario = color('var(--text-2)');
  const fondoTexto = color('var(--bg)');
  const acento = color('var(--accent)');
  const iconoExperimento = typeof Path2D === 'function' ? new Path2D(ICONO_EXPERIMENTO) : null;
  const iconoLaboratorio = typeof Path2D === 'function' ? new Path2D(ICONO_LABORATORIO) : null;
  // Nodos, de lejos a cerca.
  for (const n of escena.nodos) {
    if (!n.visible || n.opacidad <= 0) continue;
    const alfa = n.opacidad * (n.vivo ? 1 : OPACIDAD_ATENUADO);
    ctx.globalAlpha = alfa;
    if (n.tipo === 'objetivo') {
      // El halo del tronco.
      ctx.globalAlpha = alfa * 0.25;
      ctx.strokeStyle = acento;
      ctx.lineWidth = 6 * n.escala;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 6 * n.escala, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alfa;
    }
    // El círculo: con el ratón encima crece un 18 % y el borde se ensancha (como .grafo-hover);
    // seleccionado, el borde es del color del texto (como .grafo-seleccionado).
    const r = n.hover ? n.r * 1.18 : n.r;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color(n.estilo.relleno);
    ctx.fill();
    ctx.strokeStyle = n.sel ? textoPrincipal : color(n.estilo.anillo);
    ctx.lineWidth = n.sel ? 2.5 : n.hover ? 3 : n.estilo.anchoAnillo;
    ctx.setLineDash(guionA(n.estilo.guion));
    ctx.stroke();
    ctx.setLineDash([]);
    // Icono (experimento, laboratorio), en blanco como en el SVG.
    const icono = n.tipo === 'experimento' ? iconoExperimento : n.tipo === 'laboratorio' ? iconoLaboratorio : null;
    if (icono) {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(n.escala * (n.tipo === 'experimento' ? 0.9 : 1), n.escala * (n.tipo === 'experimento' ? 0.9 : 1));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = n.tipo === 'experimento' ? 1.2 : 1.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(icono);
      ctx.restore();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    }
    // La etiqueta, con el halo de fondo (paint-order: stroke) para que se lea sobre los enlaces.
    const et = n.etiqueta;
    if (et.opacidad > 0.02 && et.tamano > 0) {
      ctx.globalAlpha = alfa * et.opacidad;
      ctx.font = `${et.negrita ? 600 : 500} ${et.tamano}px ${o.fuente}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = fondoTexto;
      ctx.lineWidth = 3 * (et.tamano / tamanoBase(n.tipo));
      ctx.fillStyle = et.secundaria ? textoSecundario : textoPrincipal;
      for (let i = 0; i < et.lineas.length; i++) {
        const y = n.y + et.desplazamiento + i * et.interlineado;
        ctx.strokeText(et.lineas[i]!, n.x, y);
        ctx.fillText(et.lineas[i]!, n.x, y);
      }
      ctx.lineJoin = 'miter';
    }
  }
  ctx.globalAlpha = 1;
}

const tamanoBase = (tipo: TipoNodo): number => (tipo === 'objetivo' ? 13 : tipo === 'rama' || tipo === 'hipotesis' || tipo === 'experimento' || tipo === 'laboratorio' ? 10.5 : 9);

/** Escala y desplazamiento para encajar el lienzo lógico (ancho por alto) en un
 *  canvas de anchoPx por altoPx píxeles centrado y sin deformar (como el
 *  preserveAspectRatio "meet" del SVG). Con un canvas sin tamaño (tests), 1 y 0. */
export function ajusteLienzo(ancho: number, alto: number, anchoPx: number, altoPx: number): { escala: number; dx: number; dy: number } {
  if (!(anchoPx > 0) || !(altoPx > 0)) return { escala: 1, dx: 0, dy: 0 };
  const escala = Math.min(anchoPx / ancho, altoPx / alto);
  return { escala, dx: (anchoPx - ancho * escala) / 2, dy: (altoPx - alto * escala) / 2 };
}

/** La última escena pintada en cada lienzo, para que los tests lean el modelo en
 *  vez del DOM (un canvas no tiene nada que leer). */
const escenas = new WeakMap<Element, Escena>();
export function registrarEscena(lienzo: Element, escena: Escena): void {
  escenas.set(lienzo, escena);
}
export function escenaDe(lienzo: Element | null): Escena | null {
  return lienzo ? escenas.get(lienzo) ?? null : null;
}
