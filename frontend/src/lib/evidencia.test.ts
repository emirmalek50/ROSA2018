import { describe, expect, it } from 'vitest';
import { construirArbol, enlaceDe, iteracionesDe, type Evidencia } from './evidencia';

const ev: Evidencia = {
  corridaId: 'c',
  version: 1,
  consultas: [
    { base: 'PubMed', consulta: 'q1', fecha: 1, resultados: 12, iteracion: 1 },
    { base: 'Europe PMC', consulta: 'q2', fecha: 2, resultados: 120, iteracion: 1 },
    { base: 'PubMed', consulta: 'q3', fecha: 3, resultados: 5, iteracion: 2 },
  ],
  fuentes: [
    { id: 'f1', referencia: 'A, 2025', titulo: 'A', tipo: 'articulo', doi: '10.1/a', pmid: null, nct: null, anio: 2025, tipoEstudio: 'cohorte', relevancia: 8, retraccion: null, retraccionDetalle: '', textoCompleto: true, fragmentos: 5, extraida: true, iteracion: 1, consultas: ['q1', 'q2'] },
    { id: 'f2', referencia: 'B, 2024', titulo: 'B', tipo: 'articulo', doi: null, pmid: '123', nct: null, anio: 2024, tipoEstudio: 'otro', relevancia: 6, retraccion: 'retractado', retraccionDetalle: 'Retraction', textoCompleto: false, fragmentos: 1, extraida: false, iteracion: 1, consultas: ['q2'] },
    { id: 'f3', referencia: 'NCT1', titulo: 'Ensayo', tipo: 'ensayo', doi: null, pmid: null, nct: 'NCT00000001', anio: null, tipoEstudio: 'registro', relevancia: 6, retraccion: null, retraccionDetalle: '', textoCompleto: false, fragmentos: 1, extraida: true, iteracion: 1, consultas: [] },
    { id: 'f4', referencia: 'C, 2026', titulo: 'C', tipo: 'preprint', doi: null, pmid: null, nct: null, anio: 2026, tipoEstudio: 'otro', relevancia: 5, retraccion: null, retraccionDetalle: '', textoCompleto: false, fragmentos: 1, extraida: true, iteracion: 2, consultas: ['q3'] },
  ],
  afirmaciones: [
    { id: 'a1', texto: 'x', cita: '[A, 2025, pág. 3]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'dato', tema: 't', fuenteId: 'f1', localizador: 'pág. 3', iteracion: 1 },
    { id: 'a2', texto: 'y', cita: '[A, 2025, pág. 4]', veredicto: 'no_sostenida', motivo: 'otra entidad', entidadDistinta: true, tipo: 'literatura', tema: 't', fuenteId: 'f1', localizador: 'pág. 4', iteracion: 1 },
    { id: 'a3', texto: 'z', cita: '[NCT1, resumen]', veredicto: 'sin_verificar', motivo: '', entidadDistinta: false, tipo: 'literatura', tema: 't', fuenteId: 'f3', localizador: 'resumen', iteracion: 1 },
    { id: 'a4', texto: 'w', cita: '[C, 2026, resumen]', veredicto: 'parcial', motivo: '', entidadDistinta: false, tipo: 'interpretacion', tema: 't', fuenteId: 'f4', localizador: 'resumen', iteracion: 2 },
  ],
};

describe('construirArbol', () => {
  it('cuelga cada fuente de la primera consulta que la trajo y anota las demas', () => {
    const { nodos } = construirArbol(ev, 1);
    expect(nodos.map((n) => n.numero)).toEqual([1, 2, 0]);
    expect(nodos[0]!.fuentes.map((f) => f.fuente.id)).toEqual(['f1']);
    expect(nodos[0]!.fuentes[0]!.tambienEn).toEqual([2]);
    expect(nodos[1]!.fuentes.map((f) => f.fuente.id)).toEqual(['f2']);
    expect(nodos[2]!.consulta).toBeNull();
    expect(nodos[2]!.fuentes.map((f) => f.fuente.id)).toEqual(['f3']);
  });

  it('separa las iteraciones y calcula el embudo de cada una', () => {
    const uno = construirArbol(ev, 1).embudo;
    expect(uno).toEqual({ consultas: 2, identificados: 132, fuentes: 3, textoCompleto: 1, afirmaciones: 3, sostenidas: 1, parciales: 0, bloqueadas: 1, sinVerificar: 1 });
    const dos = construirArbol(ev, 2);
    expect(dos.embudo.consultas).toBe(1);
    expect(dos.nodos[0]!.fuentes[0]!.afirmaciones.map((a) => a.id)).toEqual(['a4']);
    expect(iteracionesDe(ev)).toEqual([1, 2]);
  });

  it('el filtro quita afirmaciones pero deja las fuentes y no toca el embudo', () => {
    const { nodos, embudo } = construirArbol(ev, 1, 'bloqueadas');
    expect(nodos[0]!.fuentes[0]!.afirmaciones.map((a) => a.id)).toEqual(['a2']);
    expect(nodos[2]!.fuentes[0]!.afirmaciones).toEqual([]);
    expect(embudo.afirmaciones).toBe(3);
    expect(construirArbol(ev, 1, 'todas', 'dato').nodos[0]!.fuentes[0]!.afirmaciones.map((a) => a.id)).toEqual(['a1']);
  });

  it('enlaza por DOI, luego PMID, luego NCT', () => {
    expect(enlaceDe(ev.fuentes[0]!)).toBe('https://doi.org/10.1/a');
    expect(enlaceDe(ev.fuentes[1]!)).toBe('https://pubmed.ncbi.nlm.nih.gov/123/');
    expect(enlaceDe(ev.fuentes[2]!)).toBe('https://clinicaltrials.gov/study/NCT00000001');
    expect(enlaceDe({ ...ev.fuentes[2]!, nct: null })).toBeNull();
  });
});

it('un total desconocido no se convierte en cero ni en la suma de otras consultas', () => {
  const parcial: Evidencia = { ...ev, consultas: [...ev.consultas, { base: 'Embase', consulta: 'APOE', resultados: null, recuperados: 3, estado: 'parcial', fecha: 1, iteracion: 1 }] };
  expect(construirArbol(parcial, 1).embudo.identificados).toBeNull();
  expect(construirArbol(parcial, 2).embudo.identificados).toBe(5);
});
