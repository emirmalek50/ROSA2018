import { describe, expect, it, vi } from 'vitest';
import { traducirDocumentoExterno, traducirTextosExternos } from './traduccionExterna';

describe('traducción fuera del DOM', () => {
  it('traduce química revisada sin red y conserva secuencias y códigos literales', async () => {
    const pedir = vi.fn(async () => ({}));
    const texto = "fosforotioato en todos los enlaces\n  CTCTCCCACTCCCACTTCTT\nSMILES: COC1=CC=C2C(=O)C(CC3CCN(CC3)CC4CC4)CC2=C1";
    expect(await traducirDocumentoExterno(texto, pedir)).toBe("phosphorothioate at every linkage\n  CTCTCCCACTCCCACTTCTT\nSMILES: COC1=CC=C2C(=O)C(CC3CCN(CC3)CC4CC4)CC2=C1");
    expect(pedir).not.toHaveBeenCalled();
  });

  it('conserva la sangría y los saltos del protocolo y rechaza cambios de unidades', async () => {
    const fuente = '  Medir GFAP a las 6 h con 10 mg/kg.\r\n\r\n    Medir NEFL después.';
    const pedir = vi.fn(async () => ({
      'Medir GFAP a las 6 h con 10 mg/kg.': 'Measure GFAP at 6 h with 10 mg/kg.',
      'Medir NEFL después.': 'Measure NEFL afterward.',
    }));
    expect(await traducirDocumentoExterno(fuente, pedir)).toBe('  Measure GFAP at 6 h with 10 mg/kg.\r\n\r\n    Measure NEFL afterward.');
    const peligrosa = 'Exposición a 7 mg/kg en MAPT.';
    expect(await traducirDocumentoExterno(peligrosa, async () => ({ [peligrosa]: 'Exposure to 7 mg in MAPT.' }))).toBeNull();
  });

  it('no permite una exportación parcial ni memoriza un fallo', async () => {
    const original = 'Controlar el lote de prueba alfa.';
    expect(await traducirDocumentoExterno(original, async () => ({}))).toBeNull();
    expect(await traducirDocumentoExterno(original, async () => ({ [original]: 'Check test batch alpha.' }))).toBe('Check test batch alpha.');
  });

  it('no considera una frase española sin cambios como traducción y admite miles en inglés', async () => {
    const espanol = 'El ensayo necesita controles válidos.';
    expect(await traducirDocumentoExterno(espanol, async () => ({ [espanol]: espanol }))).toBeNull();
    const ingles = 'SCREENING: 669,547 human transcripts';
    expect(await traducirDocumentoExterno(ingles, async () => ({ [ingles]: ingles }))).toBe(ingles);
  });

  it('una secuencia alterada no entra en la memoria ni se puede copiar', async () => {
    const original = 'Oligonucleótido de prueba: CTCTCCCACTCCCACTTCTT';
    expect(await traducirDocumentoExterno(original, async () => ({ [original]: 'Test oligonucleotide: CTCTCCCACTCCCACTTCTA' }))).toBeNull();
    const correcta = 'Test oligonucleotide: CTCTCCCACTCCCACTTCTT';
    expect(await traducirDocumentoExterno(original, async () => ({ [original]: correcta }))).toBe(correcta);
  });

  it('respeta los límites de cada lote y no acepta textos no solicitados', async () => {
    const textos = Array.from({ length: 130 }, (_, i) => `Texto pendiente ${i}: ${'contenido '.repeat(10)}`);
    const pedir = vi.fn(async (lote: string[]) => ({ ...Object.fromEntries(lote.map(t => [t, t.replace('Texto pendiente', 'Pending text').replaceAll('contenido', 'content')])), ajena: 'otra frase' }));
    const resultado = await traducirTextosExternos(textos, pedir);
    expect(Object.keys(resultado)).toHaveLength(130);
    expect(resultado.ajena).toBeUndefined();
    for (const [lote] of pedir.mock.calls) {
      expect(lote.length).toBeLessThanOrEqual(60);
      expect(lote.join('').length).toBeLessThanOrEqual(4500);
    }
  });
});
