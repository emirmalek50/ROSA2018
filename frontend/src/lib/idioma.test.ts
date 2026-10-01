/** El idioma de la interfaz.
 *
 * Lo que defienden estas pruebas es sobre todo el modo de fallo: una frase
 * sin traducir tiene que verse EN CASTELLANO y entenderse, nunca en blanco ni
 * con el nombre de una clave. Es la razón de que la clave sea la propia frase
 * en castellano y no un identificador inventado. */
import { beforeEach, describe, expect, it } from 'vitest';

import { fijarIdioma, idiomaActual, tr, trc, trp } from './idioma';

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
