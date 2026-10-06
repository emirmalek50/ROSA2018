import { describe, expect, it } from 'vitest';
import { FUENTES, HECHOS, HIPOTESIS, INVESTIGACION } from '../datos/muestra';
import { aBibtex, aCsv, aRis, expediente, specificAims } from './exportar';
import { fijarIdioma } from './idioma';

describe('exportar referencias', () => {
  it('BibTeX lleva DOI, pagina y la marca de retractacion', () => {
    const bib = aBibtex([FUENTES.allegri2025!, FUENTES.retractado!]);
    expect(bib).toContain('doi = {10.1101/2025.05.14.25326954}');
    expect(bib).toContain('pages = {7}');
    expect(bib).toContain('RETRACTADO');
    expect(bib.match(/^@/gm)).toHaveLength(2);
  });
  it('RIS termina cada registro con ER', () => {
    const ris = aRis([FUENTES.glp1!]);
    expect(ris).toContain('TY  - DATA');
    expect(ris.trim().endsWith('ER  -')).toBe(true);
    expect(ris).toContain('solo resumen');
  });
  it('CSV escapa comas y comillas', () => {
    const csv = aCsv([FUENTES.cummings2026!]);
    const lineas = csv.split('\n');
    expect(lineas[0]).toBe('referencia,titulo,anio,doi,pmid,nct,pagina,tipo_estudio,nivel_evidencia,texto_completo,retraccion');
    expect(lineas[1]).toContain('"Cummings et al., 2026"');
  });
});

describe('expediente', () => {
  it('es JSON valido con decisiones humanas, fuentes y aplicable a', () => {
    const j = JSON.parse(expediente(HIPOTESIS[3]!, HECHOS, 'Portadores de APOE4 con genotipo de TREM2'));
    expect(j.hipotesis.id).toBe('hip-4');
    expect(j.decisionesHumanas.some((r: { accion: string }) => r.accion === 'aceptada')).toBe(true);
    expect(j.fuentes).toHaveLength(1);
    expect(j.aplicableA).toMatch(/APOE4/);
    expect(j.hechosRelacionados.some((h: { id: string }) => h.id === 'he-5')).toBe(true);
  });
});

describe('specificAims', () => {
  it('toma hasta tres candidatas por Elo y excluye descartadas y por refinar', () => {
    const texto = specificAims(INVESTIGACION, HIPOTESIS);
    expect(texto).toContain('## Specific Aim 1');
    expect(texto).toContain('## Specific Aim 3');
    expect(texto).not.toContain('## Specific Aim 4');
    expect(texto.indexOf('NLRP3')).toBeLessThan(texto.indexOf('cociente p-tau217/Abeta42 anticipa'));
    expect(texto).not.toContain('Abeta*56');
    expect(texto).not.toContain('GLP-1 reducen');
  });
  it('sin candidatas lo dice', () => {
    expect(specificAims(INVESTIGACION, [])).toContain('Sin hipótesis candidatas');
  });
  it('exporta las etiquetas en inglés sin alterar el contenido científico ni la página', () => {
    const h = { ...HIPOTESIS[0]!, estado: 'aceptada' as const };
    const original = JSON.stringify(h);
    fijarIdioma('en');
    try {
      const texto = specificAims(INVESTIGACION, [h]);
      for (const etiqueta of ['**Disease description.**', '**Hypothesis.**', '**Rationale.**', 'Biomarker:', 'Cohort:', 'Design:', '**Sources.**', '## Pilot evaluation', 'Draft for human review']) expect(texto).toContain(etiqueta);
      expect(texto).not.toMatch(/Objetivo general|Hipótesis\.|Razonamiento|Biomarcador:|Cohorte:|Diseño:|Fuentes\.|pág\./);
      expect(texto).toContain(h.enunciado);
      for (const f of h.procedencia.fuentes) if (f.pagina !== null) expect(texto).toContain(`${f.referencia}, p. ${f.pagina}`);
      expect(aRis([FUENTES.retractado!])).toContain('RETRACTED.');
      expect(JSON.stringify(h)).toBe(original);
    } finally {
      fijarIdioma('es');
    }
    expect(specificAims(INVESTIGACION, [h])).toContain('**Hipótesis.**');
    expect(aRis([FUENTES.retractado!])).toContain('RETRACTADO.');
  });
});
