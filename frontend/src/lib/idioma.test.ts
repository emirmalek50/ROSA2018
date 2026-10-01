/** El idioma de la interfaz.
 *
 * Lo que defienden estas pruebas es sobre todo el modo de fallo: una frase
 * sin traducir tiene que verse EN CASTELLANO y entenderse, nunca en blanco ni
 * con el nombre de una clave. Es la razón de que la clave sea la propia frase
 * en castellano y no un identificador inventado. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { negacionesDe } from '../datos/acciones';
import { AMPLITUD } from './etiquetas';
import { fijarIdioma, idiomaActual, tr, trc, trp } from './idioma';

// `fijarIdioma` escribe en localStorage, y el modulo lo lee al importarse.
// Si una prueba deja «en» puesto, el siguiente fichero de pruebas arranca en
// ingles y falla por un motivo que no tiene nada que ver con el. Pasó. De ahi
// el afterEach: el idioma se devuelve a castellano siempre, no solo antes.
afterEach(() => {
  fijarIdioma('es');
  try {
    localStorage.removeItem('rosa.idioma');
  } catch {
    // Sin almacenamiento no hay nada que limpiar.
  }
});

describe('el idioma de la interfaz', () => {
  beforeEach(() => fijarIdioma('es'));

  it('en castellano devuelve la frase tal cual, sin pasar por el catálogo', () => {
    expect(tr('Al laboratorio')).toBe('Al laboratorio');
    expect(tr('Una frase que no está en ningún catálogo')).toBe('Una frase que no está en ningún catálogo');
  });

  it('en inglés traduce lo que hay en el catálogo', () => {
    fijarIdioma('en');
    expect(tr('Al laboratorio')).toBe('To the lab');
    expect(tr('Ajustes')).toBe('Settings');
  });

  it('lo que NO está traducido se ve en castellano, no en blanco', () => {
    // Es el modo de fallo que hay que evitar: una pantalla con huecos o con
    // claves a la vista es peor que una pantalla en dos idiomas.
    fijarIdioma('en');
    const sinTraducir = 'Esta frase no está en el catálogo todavía';
    expect(tr(sinTraducir)).toBe(sinTraducir);
    expect(tr(sinTraducir)).not.toBe('');
    expect(tr(sinTraducir)).not.toContain('undefined');
  });

  it('«no pude comprobar» y «no hay» siguen siendo dos cosas distintas', () => {
    // Es una regla del proyecto, y una traducción que las junte la rompe.
    fijarIdioma('en');
    expect(tr('No pude comprobar')).toBe('Could not check');
    expect(tr('No pude comprobar')).not.toMatch(/none|no .*found/i);
  });

  it('los huecos van con nombre, porque al traducir cambia el orden', () => {
    fijarIdioma('es');
    expect(trp('Quedan {n} de {m}', { n: 3, m: 8 })).toBe('Quedan 3 de 8');
    // Un hueco que no se rellena se queda a la vista en vez de desaparecer.
    expect(trp('Quedan {n} de {m}', { n: 3 })).toBe('Quedan 3 de {m}');
  });

  it('el contexto desambigua las frases que se repiten con sentidos distintos', () => {
    fijarIdioma('en');
    // Sin entrada con contexto, cae a la entrada sin contexto, y si tampoco
    // la hay, al castellano.
    expect(trc('menu', 'Ajustes')).toBe('Settings');
    expect(trc('loquesea', 'Frase inexistente')).toBe('Frase inexistente');
  });

  it('se recuerda el idioma y se puede leer fuera de un componente', () => {
    fijarIdioma('en');
    expect(idiomaActual()).toBe('en');
    fijarIdioma('es');
    expect(idiomaActual()).toBe('es');
  });
});

describe('los mapas de etiquetas traducidos al leerlos', () => {
  beforeEach(() => fijarIdioma('es'));

  it('traduce el valor plano y también el anidado {etiqueta, nota}', () => {
    fijarIdioma('en');
    expect(AMPLITUD.equilibrada.etiqueta).toBe('Balanced');
    expect(AMPLITUD.equilibrada.nota).toContain('A third of the queries');
    // Lo que no es texto se queda igual: un porcentaje no se traduce.
    expect(AMPLITUD.equilibrada.fraccion).toBe('34 %');
  });

  it('en castellano devuelve el objeto original, sin copiarlo', () => {
    expect(AMPLITUD.enfocada.etiqueta).toBe('Enfocada');
  });

  it('también traduce al recorrer el mapa, no solo al leer una clave', () => {
    // Es como lo consumen los desplegables: Object.entries, no mapa.clave.
    fijarIdioma('en');
    const etiquetas = Object.values(AMPLITUD).map((v) => v.etiqueta);
    expect(etiquetas).toContain('Balanced');
    expect(etiquetas).not.toContain('Equilibrada');
    const porClave = Object.entries(AMPLITUD).map(([k, v]) => `${k}:${v.etiqueta}`);
    expect(porClave).toContain('amplia:Broad');
  });

  it('al cambiar de idioma no devuelve lo cacheado del idioma anterior', () => {
    fijarIdioma('en');
    expect(AMPLITUD.amplia.etiqueta).toBe('Broad');
    fijarIdioma('es');
    expect(AMPLITUD.amplia.etiqueta).toBe('Amplia');
    fijarIdioma('en');
    expect(AMPLITUD.amplia.etiqueta).toBe('Broad');
  });
});

describe('lo que NO se traduce porque no es texto', () => {
  // En `etiquetas.ts` y `acciones.ts` conviven con el texto visible unas
  // listas de palabras que sirven para COMPARAR texto: palabras vacías,
  // negaciones, verbos causales, números escritos. Si alguien «termina» la
  // traducción metiéndolas en el catálogo, la comparación deja de encontrar
  // las palabras y la detección de duplicados y de negaciones falla en
  // silencio, que es el peor modo de fallo. Esta prueba lo impide.
  const NO_SON_TEXTO = [
    'nunca jamás tampoco ninguna ningún ninguno never neither nor none without',
    'mediate mediates depend depends upstream downstream',
    'NFD',
    'NFKD',
  ];

  it('las listas de palabras para comparar texto no están en el catálogo', () => {
    fijarIdioma('en');
    for (const lista of NO_SON_TEXTO) {
      expect(tr(lista), `«${lista.slice(0, 40)}» no se traduce: es dato, no texto`).toBe(lista);
    }
  });

  it('la negación se sigue detectando en inglés, que es para lo que están', () => {
    fijarIdioma('en');
    expect([...negacionesDe('esto nunca pasa')]).toContain('nunca');
    expect([...negacionesDe('this never happens')]).toContain('never');
  });
});
