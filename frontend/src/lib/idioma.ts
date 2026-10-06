// El idioma de la interfaz. Se recuerda en el navegador y viaja al servidor,
// porque buena parte del texto que se ve lo genera el backend.
//
// Por qué la clave de traducción es la propia frase en castellano, y no un
// identificador inventado (1 de octubre de 2026). ROSA2018 tiene unas 3.480
// cadenas visibles en el frontend y otras 3.857 que genera el backend.
// Inventar una clave para cada una («lab.criba.titulo») sería tocar siete mil
// sitios, y cada clave mal puesta es un texto que desaparece. Con la frase
// como clave:
//
//   - envolver una cadena es mecánico y no cambia lo que se lee;
//   - lo que todavía no está traducido se ve en castellano, no en blanco ni
//     con el nombre de la clave, que es el modo de fallo feo de i18n;
//   - y el castellano sigue siendo el original, que es lo que se revisa.
//
// El precio es que dos frases iguales con sentidos distintos comparten
// traducción. Pasa poco, y cuando pase se desambigua con `tc(contexto, es)`.

import { useSyncExternalStore } from 'react';

import { EN } from '../i18n/en';

export type Idioma = 'es' | 'en';

export const IDIOMAS: { clave: Idioma; nombre: string; bandera: string }[] = [
  { clave: 'es', nombre: 'Español', bandera: 'ES' },
  { clave: 'en', nombre: 'English', bandera: 'EN' },
];

const CLAVE = 'rosa.idioma';

function inicial(): Idioma {
  // `?lang=en` manda sobre lo guardado: así se puede compartir un enlace ya
  // en inglés sin tocar la preferencia de quien lo abre.
  try {
    const u = new URLSearchParams(location.search).get('lang');
    if (u === 'en' || u === 'es') return u;
    return localStorage.getItem(CLAVE) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

let idioma: Idioma = inicial();
const oyentes = new Set<() => void>();
const ausentes = new Set<string>();

function marcarElHtml(): void {
  try {
    document.documentElement.lang = idioma;
  } catch {
    // En los tests no hay documento.
  }
}
marcarElHtml();

export function fijarIdioma(i: Idioma): void {
  if (i === idioma) return;
  idioma = i;
  try {
    localStorage.setItem(CLAVE, i);
  } catch {
    // Sin almacenamiento: dura lo que la pestaña.
  }
  marcarElHtml();
  for (const o of oyentes) o();
}

/** El idioma de ahora, para código que no es un componente. */
export function idiomaActual(): Idioma {
  return idioma;
}

export function useIdioma(): Idioma {
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },
    () => idioma,
    () => idioma,
  );
}

/** Traduce una frase. La clave ES la frase en castellano.
 *
 *  Se llama `tr` y no `t`, que es lo habitual en i18n, porque en este código
 *  los nombres van en castellano y `t` ya se usaba como variable local para
 *  «tiempo» en seis ficheros. Una función de traducción que choca con una
 *  variable local es un error de compilación en el mejor caso y un texto
 *  equivocado en el peor.
 *
 *  Lo que no esté en el catálogo se devuelve tal cual, en castellano: una
 *  traducción que falta tiene que verse como texto que se entiende, no como
 *  un hueco. */
export function tr(es: string): string {
  if (!(es in EN) && /[a-záéíóúñ]{2}/i.test(es)) ausentes.add(es);
  if (idioma === 'es') return es;
  return EN[es] ?? es;
}

/** Igual, pero con contexto, para las frases que se repiten con sentidos
 *  distintos. La clave es `contexto\u0004frase`, como en gettext. */
export function trc(contexto: string, es: string): string {
  if (!(`${contexto}\u0004${es}` in EN) && !(es in EN)) ausentes.add(`${contexto}\u0004${es}`);
  if (idioma === 'es') return es;
  return EN[`${contexto}\u0004${es}`] ?? EN[es] ?? es;
}

/** Traduce rellenando huecos: `trp('Quedan {n} de {m}', {n: 3, m: 8})`.
 *
 *  Los huecos van con nombre y no por posición porque al traducir cambia el
 *  orden de la frase, y con `%s` eso se rompe en silencio. */
export function trp(es: string, valores: Record<string, string | number>): string {
  const plantilla = tr(es);
  return plantilla.replace(/\{(\w+)\}/g, (entero, clave: string) =>
    clave in valores ? String(valores[clave]) : entero,
  );
}

/** Entradas del catálogo y consultas ausentes observadas en esta sesión.
 *  No mide toda la aplicación ni la prosa dinámica que traduce el servidor. */
export function cobertura(): { total: number; traducidas: number } {
  const traducidas = Object.keys(EN).length;
  return { total: traducidas + ausentes.size, traducidas };
}

/** Un mapa de etiquetas que se traduce AL LEERLO.
 *
 *  Por qué un Proxy y no envolver a quien lo usa (1 de octubre de 2026).
 *  `src/lib/etiquetas.ts` son 83 mapas de consulta (`ESTADO_CORRIDA[x]`,
 *  `TIPO_PISTA[y]`...) con 314 cadenas visibles, y los leen las pantallas
 *  desde cientos de sitios. Envolver cada lectura sería tocar todos esos
 *  sitios y olvidarse de alguno; traducir al definir el mapa tampoco vale,
 *  porque el módulo se evalúa una vez al arrancar y el idioma se cambia
 *  después.
 *
 *  Con el Proxy, el mapa se define en castellano (que sigue siendo el
 *  original y la clave del catálogo) y devuelve la traducción en el momento
 *  de leerlo, que es cuando se pinta. Vale para valores de texto y para los
 *  mapas cuyo valor es un objeto con textos dentro, que los hay.
 *
 *  Lo que NO hace, a propósito: no toca las claves ni los valores que no son
 *  texto. Un identificador traducido sería un fallo, no una traducción. */
export function traducido<T extends object>(mapa: T): T {
  return envolver(mapa);
}

/** Copia profunda, plana y con el texto ya traducido. `traducido()` devuelve
 *  un Proxy, que es barato pero NO se puede clonar: `structuredClone` de un
 *  Proxy lanza DataCloneError. Esto devuelve objetos y arrays normales, asi
 *  que se clona y se manda por postMessage sin problema. Cuesta recorrer la
 *  estructura entera, de modo que es para lo que se construye una vez (el
 *  estado de muestra), no para un mapa de consulta. */
export function copiaTraducida<T>(v: T): T {
  if (typeof v === 'string') return (idioma === 'es' ? v : tr(v)) as unknown as T;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => copiaTraducida(x)) as unknown as T;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === 'string' && CAMPOS_DE_DATOS.has(k) ? x : copiaTraducida(x);
  return out as T;
}

/** Solo se envuelven objetos planos y arrays. Una RegExp, una Date, un Map o
 *  un elemento de React metidos en un Proxy dejan de funcionar: sus metodos
 *  leen ranuras internas que el Proxy no tiene, y `patron.test(x)` lanza en
 *  vez de comparar. El glosario guarda una RegExp en cada entrada, asi que
 *  esto no es hipotetico. */
function sePuedeEnvolver(v: unknown): v is object {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Los campos que son DATOS aunque lleven texto: identificadores, enlaces del
 *  grafo, alias con los que se reconoce algo en la literatura, rutas. El
 *  Proxy no los traduce NUNCA, esté o no la cadena en el catálogo.
 *
 *  Antes dependía de que la cadena no estuviera en el catálogo, y eso es
 *  casualidad: con cuatro mil entradas, un id acaba coincidiendo con algo.
 *  Pasó el 2 de octubre de 2026: «B:funcion renal», el id de un nodo del
 *  grafo causal, entró al catálogo y en inglés se leía «B:renal function»,
 *  así que los enlaces del grafo dejaban de encontrar su nodo. */
export const CAMPOS_DE_DATOS: ReadonlySet<string> = new Set([
  'id', 'clave', 'key', 'de', 'a', 'origen', 'destino', 'ref', 'slug', 'ruta', 'path', 'href',
  'alias', 'sinonimos', 'patron', 'patrones', 'regex', 'excepto', 'noTras', 'nct',
  'terminos', 'palabras', 'codigo', 'consulta', 'query', 'endpoint', 'host', 'tipo', 'estado',
  'investigacionId', 'hipotesisId', 'corridaId', 'fuenteId', 'valor', 'modelo', 'base',
  // Las cifras ya formateadas no se traducen: el separador lo pone `coma()`.
  'fraccion',
  // Atribución de tareas del laboratorio: las funciones conservan su identidad.
  'agente', 'estadoAgente',
]);

function envolver<T extends object>(o: T): T {
  const cache = new Map<string, unknown>();
  let paraIdioma: Idioma = idioma;
  return new Proxy(o, {
    get(objetivo, clave, receptor) {
      const v = Reflect.get(objetivo, clave, receptor);
      if (typeof clave === 'symbol') return v;
      if (idioma === 'es') return v;
      if (paraIdioma !== idioma) {
        cache.clear();
        paraIdioma = idioma;
      }
      if (typeof v === 'string') return CAMPOS_DE_DATOS.has(clave) ? v : tr(v);
      if (!sePuedeEnvolver(v)) return v;
      const k = clave;
      if (!cache.has(k)) cache.set(k, envolver(v));
      return cache.get(k);
    },
  });
}
