/** El catálogo entero, revisado por regla.
 *
 *  Buena parte de las traducciones las escribió un modelo (Opus 5, por el AI
 *  Gateway, con las reglas del proyecto en el prompt). Un modelo acierta casi
 *  siempre y falla en silencio, así que lo que se puede comprobar por regla
 *  se comprueba aquí, sobre las entradas de verdad y no sobre una muestra.
 *
 *  Lo que NO comprueba, y hay que hacer a mano: si la traducción dice lo
 *  mismo. Eso es revisión humana, y en las frases de GRADE y de los
 *  veredictos del verificador una traducción mala no es una errata, es un
 *  error científico. */
import { describe, expect, it } from 'vitest';

import { EN } from './en';

const entradas = Object.entries(EN);

describe('el catálogo en inglés', () => {
  it('no está vacío ni tiene entradas vacías', () => {
    expect(entradas.length).toBeGreaterThan(1000);
    const vacias = entradas.filter(([, v]) => !v.trim());
    expect(vacias, 'una entrada vacía borra el texto de la pantalla').toEqual([]);
  });

  it('no lleva guiones largos: es una regla del proyecto', () => {
    const con = entradas.filter(([, v]) => v.includes('—')).map(([k]) => k);
    expect(con.slice(0, 5)).toEqual([]);
  });

  it('los huecos con nombre son los mismos en los dos idiomas', () => {
    // Un hueco que desaparece se lleva el dato: «Quedan 3 de 8» pasaría a
    // «Remaining». Uno que se inventa sale literal en pantalla.
    const huecos = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const malas = entradas.filter(([k, v]) => huecos(k).join(',') !== huecos(v).join(','));
    expect(malas.slice(0, 5).map(([k, v]) => `${k} -> ${v}`)).toEqual([]);
  });

  it('«no pude comprobar» no se convierte en «no hay»', () => {
    // La regla del proyecto: una fuente que no responde es «no pude
    // comprobar», nunca «no hay». Son dos estados distintos y la interfaz
    // los separa a propósito; una traducción que los junte la rompe.
    const malas = entradas
      .filter(([k]) => /no (?:pude|se pudo|pudo) comprobar/i.test(k))
      .filter(([, v]) => !/could not (?:be )?(?:check|verif)/i.test(v) && !/unable to (?:check|verif)/i.test(v))
      .map(([k, v]) => `${k.slice(0, 50)} -> ${v.slice(0, 50)}`);
    expect(malas).toEqual([]);
  });

  it('la traducción no afirma más que el original', () => {
    // ROSA2018 no demuestra: sostiene o no sostiene. Pero la regla es
    // comparativa, no absoluta: la definición BEST de biomarcador
    // diagnóstico dice «detecta o CONFIRMA la presencia de la enfermedad»,
    // y traducirla por «confirms» es fiel. Lo que no vale es que el inglés
    // afirme algo que el castellano no afirma.
    const afirmaEN = /\b(?:proven|proves|confirmed|confirms|demonstrates|demonstrated|establishes)\b/i;
    const afirmaES = /\b(?:demostrad|demuestra|confirmad|confirma|establece|prueba que)/i;
    const malas = entradas
      .filter(([k, v]) => afirmaEN.test(v) && !afirmaES.test(k))
      .map(([k, v]) => `${k.slice(0, 40)} -> ${v.slice(0, 60)}`);
    expect(malas.slice(0, 5)).toEqual([]);
  });

  it('no mete porcentajes de confianza que el original no tiene', () => {
    const malas = entradas
      .filter(([k, v]) => /\d+\s?%/.test(v) && !/\d+\s?%/.test(k))
      .map(([k, v]) => `${k.slice(0, 40)} -> ${v.slice(0, 60)}`);
    expect(malas.slice(0, 5)).toEqual([]);
  });

  it('conserva los símbolos de gen y de biomarcador', () => {
    // GFAP traducido deja de nombrar la proteína. Se comprueban los que
    // aparecen en la interfaz.
    const simbolos = ['GFAP', 'NfL', 'NEFL', 'TREM2', 'APOE', 'p-tau217', 'p-tau181', 'MAPT', 'PSEN2', 'NLRP3'];
    const malas: string[] = [];
    for (const [k, v] of entradas) {
      for (const s of simbolos) {
        if (k.includes(s) && !v.includes(s)) malas.push(`${s}: ${k.slice(0, 44)} -> ${v.slice(0, 44)}`);
      }
    }
    expect(malas.slice(0, 5)).toEqual([]);
  });

  it('un término del proyecto se traduce siempre igual', () => {
    // «sostenida» es un veredicto del verificador, no un adjetivo cualquiera:
    // si en una pantalla sale «supported» y en otra «upheld», el lector en
    // inglés cree que son dos estados. Pasó: el catálogo escrito a mano decía
    // «Not supported» en un sitio y «not upheld» en otro.
    const TERMINOS: { es: RegExp; debe: RegExp; nombre: string }[] = [
      // «unsupported» cuenta: es «no sostenida» en una sola palabra.
      { es: /\bsostenid[ao]s?\b/i, debe: /support/i, nombre: 'sostenida -> supported' },
      { es: /\bcerteza\b/i, debe: /\bcertainty\b/i, nombre: 'certeza -> certainty (GRADE)' },
      { es: /\brefuta\b/i, debe: /\brefute/i, nombre: 'refuta -> refutes' },
      { es: /\bdiana\b/i, debe: /\btarget\b/i, nombre: 'diana -> target' },
      { es: /\bcribad?o?\b/i, debe: /\bscreen/i, nombre: 'cribado -> screening' },
      // «hueco» tiene dos sentidos: el hueco de ADN del gapmer, que es «gap»,
      // y un hueco del gráfico, que es «empty». Por eso la regla solo mira
      // las frases que hablan del oligo; para el resto decide el contexto,
      // que es justo para lo que está `trc`.
      { es: /\bhuec[oa]\b(?=.*(?:oligo|gapmer|ASO|RNasa|ARN|ADN))|(?:oligo|gapmer|ASO|RNasa).*\bhuec[oa]\b/i, debe: /\bgap\b/i, nombre: 'hueco del gapmer -> gap' },
    ];
    const malas: string[] = [];
    for (const t of TERMINOS) {
      for (const [k, v] of entradas) {
        // Sin los huecos: en «{sostenidas} de {total}» la palabra es el
        // NOMBRE del hueco, que no se traduce, no texto.
        const sinHuecos = k.replace(/\{\w+\}/g, ' ');
        if (t.es.test(sinHuecos) && !t.debe.test(v)) malas.push(`${t.nombre}: ${k.slice(0, 44)} -> ${v.slice(0, 44)}`);
      }
    }
    expect(malas.slice(0, 6)).toEqual([]);
  });

  it('el inglés es de Estados Unidos, que es a quien va dirigido', () => {
    // Mezclar variantes se nota y queda descuidado. Los nombres propios se
    // quedan como se llaman: el «Sydney Memory and Ageing Study» lleva
    // Ageing porque así se llama el estudio, no porque se nos pasara.
    const NOMBRES = /Ageing Study|Medical Research Council|Neuroimaging Initiative/;
    const BRITANICO = /\b(?:randomis\w*|analys(?:ed|ing|e|es)|behaviou\w*|programme|colour\w*|grey|ageing|catalogue|licence|defence|centre|fibre|litre|metre|labelled|modelling|haemo\w*|oedema|organis(?:ed|ing|ation)|recognis\w*|normalis\w*|prioritis\w*|summaris\w*|standardis\w*|localis\w*)\b/i;
    const malas = entradas
      .filter(([, v]) => BRITANICO.test(v) && !NOMBRES.test(v))
      .map(([k, v]) => `${k.slice(0, 36)} -> ${(v.match(BRITANICO) ?? [''])[0]}`);
    expect(malas.slice(0, 6)).toEqual([]);
  });

  it('ninguna traducción se quedó en castellano por descuido', () => {
    // Señal barata: la ñ y los signos de apertura no existen en inglés. Una
    // tilde sí puede aparecer (en un nombre propio), así que no se mira.
    const malas = entradas
      .filter(([k, v]) => /[ñ¿¡]/.test(v) && v === k)
      .map(([k]) => k.slice(0, 60));
    expect(malas.slice(0, 5)).toEqual([]);
  });
});
