/** Lo que NO puede traducirse, y por qué la prueba vive aparte.
 *
 *  El codemod que envolvió la interfaz en `tr()` recorrió 2.590 sitios. La
 *  mayoría son frases de pantalla; unas pocas no lo eran: identificadores de
 *  nodo del grafo causal («B:funcion renal»), alias con los que se reconoce
 *  una cohorte en el texto de un artículo («Mount Sinai Brain Bank»),
 *  consultas de API y nombres de modelo.
 *
 *  Envolverlas no rompe nada mientras el catálogo no las tenga: `tr()` sin
 *  entrada devuelve la misma cadena. Rompe el día que alguien «termina» la
 *  traducción. Y el fallo no saldría en el resto de la suite, porque corre en
 *  castellano, donde `tr()` es la identidad. De ahí esta prueba: comprueba
 *  en INGLÉS que lo que sirve para comparar sigue comparando. */
import { afterEach, describe, expect, it } from 'vitest';

import { QUIEN } from '../datos/almacen';
import { canonizarCohorte } from './priorizacion';
import { fijarIdioma, tr } from './idioma';

afterEach(() => {
  fijarIdioma('es');
  try {
    localStorage.removeItem('rosa.idioma');
  } catch {
    // Sin almacenamiento no hay nada que limpiar.
  }
});

describe('en inglés, lo que sirve para comparar sigue comparando', () => {
  it('las cohortes se siguen reconociendo por su nombre en la literatura', () => {
    // Los alias son texto que aparece en los artículos, no etiquetas: si se
    // tradujeran, ROSA2018 dejaría de ver que dos fuentes hablan de la misma
    // cohorte, y eso cambia si un efecto está replicado o no.
    const casos: [string, string][] = [
      ['Mount Sinai Brain Bank', 'cohorte:msbb'],
      ['Religious Orders Study', 'cohorte:rosmap'],
      ['Australian Imaging, Biomarkers and Lifestyle', 'cohorte:aibl'],
      ['Mayo Clinic Study of Aging', 'cohorte:mcsa'],
    ];
    for (const i of ['es', 'en'] as const) {
      fijarIdioma(i);
      for (const [texto, id] of casos) {
        expect(canonizarCohorte(texto)?.id, `${texto} en ${i}`).toBe(id);
      }
    }
  });

  it('los nombres propios de cohortes y ensayos no se traducen', () => {
    fijarIdioma('en');
    for (const n of ['ADNI', 'ROSMAP', 'TRAILBLAZER-ALZ', 'Rotterdam Study', 'Knight ADRC', 'Three-City']) {
      expect(tr(n), `${n} es un nombre propio`).toBe(n);
    }
  });

  it('lo que se GUARDA no depende del idioma de la pantalla', () => {
    // QUIEN viaja al servidor como firmante de cada revisión y queda en el
    // registro de auditoría. Si cambiara con el idioma, la misma persona
    // firmaría de dos maneras y el registro no se podría agrupar por quién.
    fijarIdioma('en');
    expect(QUIEN).toBe('la persona responsable');
    fijarIdioma('es');
    expect(QUIEN).toBe('la persona responsable');
  });

  it('los colores y los trazados SVG no pasan por el catálogo', () => {
    // Un color traducido deja de ser un color y el trazado deja de dibujar.
    fijarIdioma('en');
    for (const n of ['rgba(244, 239, 228, 0.72)', 'M-4.5 0.5 l3 3 l6 -7', 'rgb(176, 152, 146)']) {
      expect(tr(n)).toBe(n);
    }
  });

  it('los identificadores del grafo y las consultas de API no se traducen', () => {
    fijarIdioma('en');
    for (const n of [
      'B:funcion renal',
      'db=pubmed&term=GFAP AND neurofilament AND APOE4 AND plasma AND longitudinal&retmax=100',
      'anthropic/claude-opus-5 (juez)',
      'GET /api/v2/studies?query.cond=Alzheimer&query.term=ARIA APOE4',
      'target(GFAP, NEFL) associatedDiseases(EFO_0000249)',
    ]) {
      expect(tr(n), `${n.slice(0, 40)} no es texto de pantalla`).toBe(n);
    }
  });
});
