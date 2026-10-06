import { describe, expect, it } from 'vitest';
import casos from '../../../rosa/tests/casos_traduccion_cientifica.json';
import { EN } from '../i18n/en';
import { comprobarTraduccion } from './terminologia';

describe('traducción científica en ambos lados de la red', () => {
  it.each(casos)('$nombre', ({ original, traducido, valida }) => {
    expect(comprobarTraduccion(original, traducido) === null).toBe(valida);
  });

  it('todo el catálogo mantiene datos y vocabulario verificables por regla', () => {
    // Esto detecta cambios concretos. No certifica equivalencia semántica total.
    const malas = Object.entries(EN).filter(([k, v]) => comprobarTraduccion(k.split('\x04').at(-1)!, v));
    expect(malas).toEqual([]);
  });

  it('la revisión corrige conceptos y distingue contextos científicos', () => {
    expect(EN['Puerta de reproducción']).toBe('Reproducibility gate');
    expect(EN['LAS LECTURAS']).toBe('EXPERIMENTAL READOUTS');
    expect(EN['CÓMO QUEDA PEGADO AL ARN']).toBe('HYBRIDIZATION TO THE TARGET RNA');
    expect(EN['DÓNDE CAE EN EL ARN']).toBe('TARGET SITE ON THE RNA');
    expect(EN['Cortar la producción de']).toBe('Reduce expression of');
    expect(EN['masa_molar\x04PESO']).toBe('MOLAR MASS');
    expect(EN['proteina\x04LÁMINA']).toBe('OVERVIEW');
    expect(EN['PESO']).not.toBe('MOLAR MASS'); // El peso del ranking es otro concepto.
    expect(EN['Veredicto por lectura']).toBe('Assessment by readout');
    expect(EN['Ruta terapéutica']).toBe('Therapeutic development pathway');
    expect(EN['Tipo fuera del vocabulario cerrado (compromiso de diana, viabilidad, función o mecanismo, biomarcador, seguridad); la lista de lo que le falta al contrato lo dice.']).toContain('target engagement, viability, function');
  });
});
