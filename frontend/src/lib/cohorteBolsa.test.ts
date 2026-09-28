// La regla de la bolsa, gemela de `_es_bolsa` en rosa/metodos.py (28 de
// septiembre de 2026): una cadena con tres o más sistemas y ninguno del
// catálogo no es una cohorte independiente. rosa/tests/test_cohorte_bolsa.py
// prueba lo mismo del lado del servidor, con estos mismos nombres reales.
import { describe, expect, it } from 'vitest';
import { cohortesDe, esBolsaDeCohortes, nombreIdentificado } from './priorizacion';

const BOLSA = 'iPS-derived neurons, CNS cell lines, mouse brain slice';

describe('una bolsa de plataformas no es una cohorte', () => {
  it('descarta las cadenas que enumeran tres sistemas sin ninguno del catálogo', () => {
    for (const n of [BOLSA, 'lanabecestat, verubecestat, atabecestat (inhibidores de BACE', 'tejido postmortem de corteza prefrontal (PFC), control y AD']) {
      expect(esBolsaDeCohortes(n), n).toBe(true);
      expect(nombreIdentificado(n), n).toBe('');
    }
  });

  it('mantiene los nombres que sí identifican, aunque lleven comas', () => {
    for (const n of ['AMARANTH, DAYBREAK-ALZ', 'modelos de ratón de tauopatía P301L y AAV-hTau-N368', 'Belder et al. (cohorte longitudinal ADAD, familias con mutación)', 'ADNI', 'cerebro humano con enfermedad de Alzheimer']) {
      expect(nombreIdentificado(n), n).toBe(n);
    }
  });

  it('el recuento de la pantalla cuenta lo mismo que el techo del servidor', () => {
    const conBolsa = { procedencia: { fuentes: [{ id: 'f0', cohorte: 'cerebro humano con enfermedad de Alzheimer' }, { id: 'f1', cohorte: BOLSA }] } };
    expect(cohortesDe(conBolsa as never)).toHaveLength(1);
    const dosDeVerdad = { procedencia: { fuentes: [{ id: 'f0', cohorte: 'ADNI' }, { id: 'f1', cohorte: 'A4' }] } };
    expect(cohortesDe(dosDeVerdad as never)).toHaveLength(2);
  });

  it('un nombre raro no revienta el recuento', () => {
    for (const raro of ['', '   ', ',,,', ' y y y ', '(((']) expect(() => nombreIdentificado(raro)).not.toThrow();
  });
});
