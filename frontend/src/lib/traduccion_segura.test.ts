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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { QUIEN } from '../datos/almacen';
import { canonizarCohorte } from './priorizacion';
import { copiaTraducida, fijarIdioma, tr, traducido } from './idioma';

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

  it('un id no se traduce aunque su texto SÍ esté en el catálogo', () => {
    // La barrera no puede depender de la casualidad de que el id no coincida
    // con ninguna entrada: «Al laboratorio» está en el catálogo a propósito,
    // y aun así, puesto en el campo `id`, se queda como está.
    const m = traducido({ id: 'Al laboratorio', de: 'Al laboratorio', etiqueta: 'Al laboratorio' });
    fijarIdioma('en');
    expect(m.etiqueta).toBe('To the lab');
    expect(m.id).toBe('Al laboratorio');
    expect(m.de).toBe('Al laboratorio');
    // Y la copia plana, que es la que usa el estado de muestra, igual.
    const c = copiaTraducida({ id: 'Al laboratorio', etiqueta: 'Al laboratorio' });
    expect(c.id).toBe('Al laboratorio');
    expect(c.etiqueta).toBe('To the lab');
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

describe('en todo el código, nada que sea dato pasa por tr()', () => {
  // La prueba de arriba mira unos pocos valores. Esta recorre TODO el código:
  // el 2 de octubre de 2026 se encontró que un pase del codemod había vuelto a
  // envolver colores rgba, clases CSS, trazados SVG e identificadores de
  // modelo que antes se habían sacado, y llegó a un commit sin que nada lo
  // dijera, porque mientras no estén en el catálogo tr() devuelve lo mismo.
  function ficheros(d: string): string[] {
    const out: string[] = [];
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) {
        if (f !== 'i18n') out.push(...ficheros(p));
      } else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
  }
  const NO_ES_TEXTO: [RegExp, string][] = [
    [/^(?:rgba?|hsla?)\(/i, 'un color'],
    [/^#[0-9a-f]{3,8}$/i, 'un color'],
    [/var\(--/, 'una variable CSS'],
    [/^[Mm][\s-]?-?[\d.]+[\s,]/, 'un trazado SVG'],
    [/^(?:anthropic|openai|google|meta|mistral|xai)\//, 'un identificador de modelo'],
    [/^(?:CC[ -]|MIT|Apache|GPL|BSD|ODbL)\b/, 'una licencia'],
    [/^[a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)*$/, 'una lista de clases CSS'],
  ];

  it('ningún tr() lleva un color, una clase, un trazado, un modelo ni una licencia', () => {
    const malos: string[] = [];
    for (const f of ficheros(join(__dirname, '..'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\btrc?p?\(\s*(?:[^,()'"]+,\s*)?(['"])((?:\\.|(?!\1).)*)\1/g)) {
        const t = m[2]!;
        for (const [r, que] of NO_ES_TEXTO) {
          // La de clases solo cuenta si alguna ficha lleva guion: «sin datos»
          // también es minúscula y es texto.
          if (que === 'una lista de clases CSS' && !t.split(/\s+/).some((x) => x.includes('-'))) continue;
          if (r.test(t)) malos.push(`${f.split('/src/')[1]}: ${t.slice(0, 50)} (${que})`);
        }
      }
    }
    expect(malos).toEqual([]);
  });
});

describe('lo que escriben los reductores no depende del idioma', () => {
  it('datos/acciones.ts no traduce nada: lo que escribe se guarda', () => {
    // Está duplicado uno a uno con rosa/estado/acciones.py, que escribe en
    // castellano. Si este escribiera en el idioma de la pantalla, el mismo
    // gesto guardaría cosas distintas según quién lo hiciera. El 2 de octubre
    // de 2026 un codemod le había metido 85 llamadas a tr()/trp(), 9 de ellas
    // ya en main. Lo que se guarda se traduce al ENSEÑARLO.
    // Sin los comentarios, que pueden nombrar estas funciones para explicar
    // por qué no se usan.
    const src = readFileSync(join(__dirname, '..', 'datos', 'acciones.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src.match(/\btr[cp]?\(/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/\bcoma\(/);
  });
});
