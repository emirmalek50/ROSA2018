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
// Lo que NO se traduce: código, identificadores (dentro de <code>, <pre>,
// .mono o [data-sin-traducir]), lo que se está escribiendo (textarea, input)
// y lo que ya está en inglés. Ante la duda no se manda: un texto en
// castellano se entiende, uno mal traducido no.

/** Marcas de castellano. Una tilde o una eñe bastan. Sin ellas, hacen falta
 *  palabras que en inglés no existen; y para no confundir el inglés, se
 *  cuentan también las que solo existen en inglés. Así «la cita no resuelve»
 *  (una sola palabra de la lista, sin tildes) se manda, y «No data available»
 *  (un «no» que es de los dos idiomas) no. */
const TILDES = /[ñáéíóúü¿¡]/i;
const PALABRAS_ES = /\b(?:de|del|la|las|los|el|que|con|para|por|una|un|sin|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna|y|es|ya|desde|hasta|tras|muy|otra|otro|esta|este|esto|ese|esa|también|porque|según|nos|le|les|ni|o)\b/gi;
const PALABRAS_EN = /\b(?:the|of|and|to|is|in|for|with|on|at|by|an|be|this|that|from|are|was|were|it|as|or|not|has|have|which|its|yes|data|page)\b/gi;

export function pareceCastellano(t: string): boolean {
  const s = t.trim();
  if (s.length < 3 || !/[a-záéíóúñ]{2}/i.test(s)) return false;
  if (TILDES.test(s)) return true;
  const es = new Set((s.match(PALABRAS_ES) ?? []).map((p) => p.toLowerCase()));
  const en = new Set((s.match(PALABRAS_EN) ?? []).map((p) => p.toLowerCase()));
  // «no» no está en la lista inglesa aunque sea inglés: es de los dos
  // idiomas, y contarlo como inglés dejaba fuera «la cita no resuelve».
  return es.size >= 2 || (es.size >= 1 && en.size === 0);
}

const NO_TOCAR = 'script, style, code, pre, kbd, samp, textarea, input, select, [contenteditable="true"], [data-sin-traducir], .mono';

export type Pedir = (textos: string[]) => Promise<Record<string, string>>;

/** El original de cada nodo que se ha traducido, para devolvérselo. */
const originales = new WeakMap<Text, string>();
const tocados = new Set<WeakRef<Text>>();
/** Lo que ya se sabe: original -> inglés. Lo que el servidor rechazó también
 *  se recuerda (con el original como valor) para no pedirlo en bucle. */
const memoria = new Map<string, string>();
const pendientes = new Set<string>();
let enVuelo = 0;
let reloj: ReturnType<typeof setTimeout> | null = null;
let raizActiva: Element | null = null;
let observador: MutationObserver | null = null;
let pedirActivo: Pedir | null = null;

const MAX_POR_PETICION = 60;
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
  if (!pareceCastellano(nucleo)) return;
  if (memoria.has(nucleo)) {
    aplicar(n);
    return;
  }
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
}

function programar(): void {
  if (reloj || !pedirActivo) return;
  reloj = setTimeout(() => {
    reloj = null;
    void enviar();
  }, ESPERA_MS);
}

async function enviar(): Promise<void> {
  const pedir = pedirActivo;
  if (!pedir || pendientes.size === 0 || enVuelo >= EN_PARALELO) return;
  const lote = [...pendientes].slice(0, MAX_POR_PETICION);
  lote.forEach((t) => pendientes.delete(t));
  enVuelo++;
  // Si queda más, la siguiente petición sale ya, sin esperar a esta.
  if (pendientes.size > 0) void enviar();
  try {
    const r = await pedir(lote);
    for (const t of lote) memoria.set(t, r[t] ?? t);
  } catch {
    // Sin servidor o sin red: se queda en castellano, que se entiende, y no
    // se vuelve a pedir en bucle.
    for (const t of lote) memoria.set(t, t);
  } finally {
    enVuelo--;
  }
  if (raizActiva && pedirActivo) recorrer(raizActiva);
  if (pendientes.size > 0) programar();
}

/** Empieza a traducir lo que hay bajo `raiz` y lo que vaya apareciendo. */
export function activar(raiz: Element, pedir: Pedir): void {
  desactivar();
  raizActiva = raiz;
  pedirActivo = pedir;
  observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === 'characterData') mirar(c.target as Text);
      else c.addedNodes.forEach((n) => recorrer(n));
    }
  });
  observador.observe(raiz, { subtree: true, childList: true, characterData: true });
  recorrer(raiz);
}

/** Deja de traducir y devuelve a cada nodo su castellano. */
export function desactivar(): void {
  observador?.disconnect();
  observador = null;
  if (reloj) clearTimeout(reloj);
  reloj = null;
  pedirActivo = null;
  raizActiva = null;
  pendientes.clear();
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
}

/** Para las pruebas: lo que hay en vuelo y vaciar la memoria. */
export function _estado(): { pendientes: number; enVuelo: number; memoria: number } {
  return { pendientes: pendientes.size, enVuelo, memoria: memoria.size };
}

export function _olvidar(): void {
  memoria.clear();
}
