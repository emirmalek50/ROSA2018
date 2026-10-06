// Lo que queda en castellano con la interfaz en inglés, traducido al pintarse.
//
// La interfaz va por el catálogo (lib/idioma.ts). Pero lo que escribió
// ROSA2018 (hipótesis, hechos, respuestas del chat) y la prosa que manda el
// servidor no caben en un catálogo: cambian en cada corrida. Esto mira lo que
// hay en pantalla, manda al servidor los textos que siguen en castellano y los
// sustituye por su traducción (rosa/traductor.py, con caché, así que cada
// frase se paga una sola vez). Es lo que hacen el traductor de Chrome o
// Weglot.
//
// Cómo convive con React, que es lo delicado: React es el dueño de los nodos
// de texto. Aquí solo se cambia el `nodeValue` de un nodo que ya existe, nunca
// se mete ni se quita ninguno (eso es lo que rompe React con el traductor de
// Chrome, que envuelve el texto en etiquetas). Si React vuelve a escribir el
// castellano en un nodo, el observador lo ve y lo vuelve a traducir. Y al
// volver al castellano se devuelve el original a cada nodo tocado.
//
// Además del texto se traducen cuatro atributos que se LEEN en pantalla:
// title (el globo al pasar el ratón), aria-label (lo que dice el lector de
// pantalla), placeholder y alt. Un botón cuyo globo sigue en castellano no
// está traducido, por mucho que su etiqueta lo esté.
//
// Lo que NO se traduce: código, identificadores (dentro de <code>, <pre>,
// .mono o [data-sin-traducir]), lo que se está escribiendo (textarea, input)
// y lo que ya está en inglés. Ante la duda no se manda: un texto en
// castellano se entiende, uno mal traducido no.

import { EN } from '../i18n/en';
import { comprobarTraduccion } from './terminologia';

/** Marcas de castellano. A las palabras función se les suman unos cuantos
 *  sustantivos del dominio que en inglés no existen («hora», «hipótesis»,
 *  «corrida», «cita»): sin ellos, lo corto y sin tilde que escribe ROSA2018
 *  («1 hora» en la condición de parada) no se detectaba y se quedaba en
 *  castellano (2 de octubre de 2026).
 *
 *  Marcas de castellano. Una tilde o una eñe bastan. Sin ellas, hacen falta
 *  palabras que en inglés no existen; y para no confundir el inglés, se
 *  cuentan también las que solo existen en inglés. Así «la cita no resuelve»
 *  (una sola palabra de la lista, sin tildes) se manda, y «No data available»
 *  (un «no» que es de los dos idiomas) no. */
const TILDES = /[ñáéíóúü¿¡]/i;
const PALABRAS_ES = /\b(?:de|del|la|las|los|el|que|con|para|por|una|un|sin|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna|y|es|ya|desde|hasta|tras|muy|otra|otro|esta|este|esto|ese|esa|también|porque|según|nos|le|les|ni|o|hora|horas|día|días|dia|dias|minuto|minutos|semana|semanas|mes|meses|año|años|ano|anos|vez|veces|hipótesis|hipotesis|corrida|corridas|iteración|iteraciones|hecho|hechos|fuente|fuentes|cohorte|cohortes|afirmación|afirmaciones|cita|citas|ninguno|ninguna|ninguna|nada|todo|todos|todas)\b/gi;
const PALABRAS_EN = /\b(?:the|of|and|to|is|in|for|with|on|at|by|an|be|this|that|from|are|was|were|it|as|or|not|has|have|which|its|yes|data|page)\b/gi;

export function pareceCastellano(t: string): boolean {
  const s = t.trim();
  if (s.length < 3 || !/[a-záéíóúñ]{2}/i.test(s)) return false;
  if (TILDES.test(s)) return true;
  // El «al» de «et al.» es latín de una cita en inglés, no el «al» castellano.
  // Sin quitarlo, los 169 marcadores de Citas («[Dark et al., 2024, Results
  // section]») se mandaban al modelo en cada corrida para que los devolviera
  // igual.
  const limpio = s.replace(/\bet\s+al\.?/gi, ' ');
  const es = new Set((limpio.match(PALABRAS_ES) ?? []).map((p) => p.toLowerCase()));
  const en = new Set((limpio.match(PALABRAS_EN) ?? []).map((p) => p.toLowerCase()));
  // «no» no está en la lista inglesa aunque sea inglés: es de los dos
  // idiomas, y contarlo como inglés dejaba fuera «la cita no resuelve».
  return es.size >= 2 || (es.size >= 1 && en.size === 0);
}

/** `select` NO está en la lista: el texto de un `<option>` se lee en pantalla
 *  como cualquier otro, y lo que se compara con el servidor es su `value`, que
 *  no se toca. `textarea` e `input` sí: ahí lo que hay es lo que escribió la
 *  persona, y traducírselo sería cambiarle lo que va a guardar. */
const NO_TOCAR = 'script, style, code, pre, kbd, samp, textarea, input, [contenteditable="true"], [data-sin-traducir], .mono';

/** Atributos que se leen en pantalla. El resto (value, id, href...) no. */
const ATRIBUTOS = ['title', 'aria-label', 'placeholder', 'alt'] as const;
const CON_ATRIBUTO = '[title],[aria-label],[placeholder],[alt]';

export type Pedir = (textos: string[]) => Promise<Record<string, string>>;

/** El original de cada nodo que se ha traducido, para devolvérselo. */
const originales = new WeakMap<Text, string>();
const tocados = new Set<WeakRef<Text>>();
/** Lo mismo para los atributos: por elemento, el valor de antes de cada uno. */
const originalesAtr = new WeakMap<Element, Map<string, string>>();
const tocadosAtr = new Set<WeakRef<Element>>();
/** Traducciones conseguidas: original -> inglés. Los fallos se llevan aparte
 *  para poder reintentarlos sin convertirlos en traducciones permanentes. */
const memoria = new Map<string, string>();
const pendientes = new Set<string>();
// Un repintado mientras otra petición termina no debe volver a encolar lo
// que todavía está viajando. Antes llegaban varias copias de la misma frase.
const enCurso = new Set<string>();
const fallidos = new Map<string, { intentos: number; despues: number }>();
const REINTENTOS_MS = [1500, 5000, 15000];
/** Textos que se leen pero no están en el árbol: el título de la pestaña. */
const sueltos: { texto: string; cuando: (en: string) => void }[] = [];
let enVuelo = 0;
let reloj: ReturnType<typeof setTimeout> | null = null;
let siguienteEnvio = 0;
let raizActiva: Element | null = null;
let observador: MutationObserver | null = null;
let visibilidad: IntersectionObserver | null = null;
let observados = new WeakSet<Element>();
let visibles = new WeakSet<Element>();
let pedirActivo: Pedir | null = null;
let generacion = 0;

const MAX_POR_PETICION = 60;
// Un lote cabe en una llamada del servidor. Sesenta párrafos podían causar
// veinte llamadas consecutivas antes de devolver la primera traducción.
const MAX_CARACTERES_POR_LOTE = 4500;
const ESPERA_MS = 160;
/** Peticiones a la vez. El servidor admite tres llamadas al modelo en
 *  paralelo; con una sola, Citas (250 frases nuevas) tardaba unos tres minutos
 *  la primera vez que se veía en inglés. */
const EN_PARALELO = 3;

/** El texto de un nodo, separado de sus espacios de borde, que se conservan. */
function partir(v: string): { antes: string; nucleo: string; despues: string } {
  const m = v.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return { antes: m[1]!, nucleo: m[2]!, despues: m[3]! };
}

function sePuede(n: Text): boolean {
  const p = n.parentElement;
  return !!p && !p.closest(NO_TOCAR);
}

/** El modelo trabaja primero en lo que se está leyendo, también dentro de
 *  paneles con scroll. El catálogo y la caché sí se aplican a todo el árbol. */
function enPantalla(el: Element): boolean {
  if (!visibilidad) return true;
  // Las opciones de un selector nativo no tienen caja visible mientras está
  // cerrado. Se preparan todas al aparecer el selector que las contiene.
  const objetivo = el.closest('option, optgroup')?.closest('select') ?? el;
  if (!observados.has(objetivo)) {
    observados.add(objetivo);
    visibilidad.observe(objetivo);
  }
  return visibles.has(objetivo);
}

function aplicar(n: Text): void {
  const actual = n.nodeValue ?? '';
  const { antes, nucleo, despues } = partir(actual);
  const en = memoria.get(nucleo);
  if (en === undefined || en === nucleo) return;
  originales.set(n, actual);
  tocados.add(new WeakRef(n));
  n.nodeValue = antes + en + despues;
}

/** Mira un nodo: si ya se sabe su traducción la pone; si no, la pide. */
function mirar(n: Text): void {
  if (!sePuede(n)) return;
  const v = n.nodeValue ?? '';
  // Lo que ya pusimos nosotros no se vuelve a mirar.
  const orig = originales.get(n);
  if (orig !== undefined && memoria.get(partir(orig).nucleo) === partir(v).nucleo) return;
  const { nucleo } = partir(v);
  // Las etiquetas del backend también usan el catálogo, sin esperar una
  // llamada al modelo. Esto alcanza incluso «MOTIVOS» o «cuerpo calloso»,
  // que no tienen ninguna de las marcas del detector de castellano.
  const local = EN[nucleo];
  if (local !== undefined) memoria.set(nucleo, local);
  if (memoria.has(nucleo)) {
    aplicar(n);
    return;
  }
  if (!pareceCastellano(nucleo) || enCurso.has(nucleo) || agotado(nucleo) || !enPantalla(n.parentElement!)) return;
  pendientes.add(nucleo);
  programar();
}

function aplicarAtr(el: Element, atr: string): void {
  const actual = el.getAttribute(atr);
  if (actual === null) return;
  const { antes, nucleo, despues } = partir(actual);
  const en = memoria.get(nucleo);
  if (en === undefined || en === nucleo) return;
  let previos = originalesAtr.get(el);
  if (!previos) { previos = new Map(); originalesAtr.set(el, previos); }
  previos.set(atr, actual);
  tocadosAtr.add(new WeakRef(el));
  el.setAttribute(atr, antes + en + despues);
}

function mirarAtr(el: Element, atr: string): void {
  if (el.closest('[data-sin-traducir]')) return;
  const v = el.getAttribute(atr);
  if (v === null) return;
  // Lo que ya pusimos nosotros no se vuelve a mirar.
  const orig = originalesAtr.get(el)?.get(atr);
  if (orig !== undefined && memoria.get(partir(orig).nucleo) === partir(v).nucleo) return;
  const { nucleo } = partir(v);
  const local = EN[nucleo];
  if (local !== undefined) memoria.set(nucleo, local);
  if (memoria.has(nucleo)) {
    aplicarAtr(el, atr);
    return;
  }
  if (!pareceCastellano(nucleo) || enCurso.has(nucleo) || agotado(nucleo) || !enPantalla(el)) return;
  pendientes.add(nucleo);
  programar();
}

function recorrer(raiz: Node): void {
  if (raiz.nodeType === Node.TEXT_NODE) {
    mirar(raiz as Text);
    return;
  }
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) mirar(n as Text);
  if (raiz.nodeType !== Node.ELEMENT_NODE) return;
  const el = raiz as Element;
  for (const a of ATRIBUTOS) if (el.hasAttribute(a)) mirarAtr(el, a);
  for (const hijo of el.querySelectorAll(CON_ATRIBUTO)) {
    for (const a of ATRIBUTOS) if (hijo.hasAttribute(a)) mirarAtr(hijo, a);
  }
}

function agotado(t: string): boolean {
  return (fallidos.get(t)?.intentos ?? 0) > REINTENTOS_MS.length;
}

function programar(): void {
  if (!pedirActivo) return;
  const ahora = Date.now();
  const proxima = Math.min(...[...pendientes].map((t) => fallidos.get(t)?.despues ?? ahora));
  if (!Number.isFinite(proxima)) return;
  const cuando = Math.max(ahora + ESPERA_MS, proxima);
  if (reloj && siguienteEnvio <= cuando) return;
  if (reloj) clearTimeout(reloj);
  siguienteEnvio = cuando;
  reloj = setTimeout(() => {
    reloj = null;
    void enviar();
  }, cuando - ahora);
}

async function enviar(): Promise<void> {
  const pedir = pedirActivo;
  if (!pedir || pendientes.size === 0 || enVuelo >= EN_PARALELO) return;
  const lote: string[] = [];
  let caracteres = 0;
  for (const t of pendientes) {
    if ((fallidos.get(t)?.despues ?? 0) > Date.now()) continue;
    if (lote.length && (lote.length >= MAX_POR_PETICION || caracteres + t.length > MAX_CARACTERES_POR_LOTE)) break;
    lote.push(t);
    caracteres += t.length;
  }
  if (!lote.length) { programar(); return; }
  lote.forEach((t) => pendientes.delete(t));
  lote.forEach((t) => enCurso.add(t));
  const turno = generacion;
  enVuelo++;
  // Si queda más, la siguiente petición sale ya, sin esperar a esta.
  if (pendientes.size > 0) void enviar();
  let r: Record<string, string> = {};
  try {
    r = await pedir(lote);
  } catch {
    // Un fallo de red no es una traducción. Se conserva el texto original
    // y se reintenta con espera, sin guardar el fallo para toda la sesión.
  } finally {
    enVuelo--;
    lote.forEach((t) => enCurso.delete(t));
  }
  for (const t of lote) {
    if (typeof r[t] === 'string' && comprobarTraduccion(t, r[t]!) === null) {
      memoria.set(t, r[t]!);
      fallidos.delete(t);
    } else if (turno === generacion && pedirActivo) {
      const intentos = (fallidos.get(t)?.intentos ?? 0) + 1;
      const espera = REINTENTOS_MS[intentos - 1];
      fallidos.set(t, { intentos, despues: Date.now() + (espera ?? 0) });
      if (espera !== undefined) pendientes.add(t);
    }
  }
  for (let i = sueltos.length - 1; i >= 0; i--) {
    const s = sueltos[i]!;
    const en = memoria.get(s.texto);
    if (en === undefined) continue;
    sueltos.splice(i, 1);
    if (en !== s.texto) s.cuando(en);
  }
  if (raizActiva && pedirActivo) recorrer(raizActiva);
  if (pendientes.size > 0) programar();
}

/** Traduce un texto que se lee pero no está en el árbol: el título de la
 *  pestaña del navegador vive en `document.title`, fuera de `#root`, y el
 *  observador no llega. Llama a `cuando` solo si consigue traducirlo; si no,
 *  se queda el castellano, que se entiende. */
export function traducirSuelto(texto: string, cuando: (en: string) => void): void {
  const t = texto.trim();
  if (!pedirActivo) return;
  if (EN[t] !== undefined) memoria.set(t, EN[t]!);
  const ya = memoria.get(t);
  if (ya !== undefined) {
    if (ya !== t) cuando(ya);
    return;
  }
  if (!pareceCastellano(t) || agotado(t)) return;
  if (sueltos.some((s) => s.texto === t)) return;
  sueltos.push({ texto: t, cuando });
  if (!enCurso.has(t)) pendientes.add(t);
  programar();
}

/** Empieza a traducir lo que hay bajo `raiz` y lo que vaya apareciendo. */
export function activar(raiz: Element, pedir: Pedir): void {
  desactivar();
  fallidos.clear();
  raizActiva = raiz;
  pedirActivo = pedir;
  if (typeof IntersectionObserver !== 'undefined') {
    visibilidad = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) {
          visibles.add(entrada.target);
          recorrer(entrada.target);
        } else visibles.delete(entrada.target);
      }
    }, { rootMargin: '240px' });
  }
  observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === 'characterData') mirar(c.target as Text);
      else if (c.type === 'attributes') {
        const a = c.attributeName as (typeof ATRIBUTOS)[number] | null;
        if (a && (ATRIBUTOS as readonly string[]).includes(a)) mirarAtr(c.target as Element, a);
      } else c.addedNodes.forEach((n) => recorrer(n));
    }
  });
  observador.observe(raiz, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: [...ATRIBUTOS],
  });
  recorrer(raiz);
}

/** Deja de traducir y devuelve a cada nodo su castellano. */
export function desactivar(): void {
  generacion++;
  observador?.disconnect();
  observador = null;
  visibilidad?.disconnect();
  visibilidad = null;
  observados = new WeakSet();
  visibles = new WeakSet();
  if (reloj) clearTimeout(reloj);
  reloj = null;
  pedirActivo = null;
  raizActiva = null;
  pendientes.clear();
  sueltos.length = 0;
  for (const ref of tocados) {
    const n = ref.deref();
    const orig = n ? originales.get(n) : undefined;
    if (n && orig !== undefined) {
      // Solo si sigue teniendo NUESTRA traducción: si React ya escribió otra
      // cosa en el nodo, lo de React manda y no se pisa con un original viejo.
      const { antes, nucleo, despues } = partir(orig);
      if (n.nodeValue === antes + (memoria.get(nucleo) ?? nucleo) + despues) n.nodeValue = orig;
      originales.delete(n);
    }
  }
  tocados.clear();
  for (const ref of tocadosAtr) {
    const el = ref.deref();
    const previos = el ? originalesAtr.get(el) : undefined;
    if (!el || !previos) continue;
    for (const [atr, orig] of previos) {
      // Igual que con el texto: solo si sigue estando NUESTRA traducción.
      const { antes, nucleo, despues } = partir(orig);
      if (el.getAttribute(atr) === antes + (memoria.get(nucleo) ?? nucleo) + despues) el.setAttribute(atr, orig);
    }
    originalesAtr.delete(el);
  }
  tocadosAtr.clear();
}

/** Para las pruebas: lo que hay en vuelo y vaciar la memoria. */
export function _estado(): { pendientes: number; enVuelo: number; memoria: number } {
  return { pendientes: pendientes.size, enVuelo, memoria: memoria.size };
}

export function _olvidar(): void {
  memoria.clear();
}
