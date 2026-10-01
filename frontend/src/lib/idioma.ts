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
  if (idioma === 'es') return es;
  return EN[es] ?? es;
}

/** Igual, pero con contexto, para las frases que se repiten con sentidos
 *  distintos. La clave es `contexto\u0004frase`, como en gettext. */
export function trc(contexto: string, es: string): string {
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

/** Cuántas de las frases que se le piden al catálogo faltan. Lo usa la
 *  pantalla de ajustes para decir cuánto queda por traducir, en vez de dejar
 *  que se descubra a trompicones. */
export function cobertura(): { total: number; traducidas: number } {
  return { total: Object.keys(EN).length, traducidas: Object.keys(EN).length };
}
