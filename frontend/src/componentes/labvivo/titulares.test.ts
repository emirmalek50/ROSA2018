import { beforeEach, describe, expect, it } from 'vitest';
import { fijarIdioma } from '../../lib/idioma';
import type { DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { titularDe } from './titulares';

const base = {
  pasos: { lista: [], aprobado: false }, fuentes: [],
  lectura: { resultados: null, sirven: null, recuperados: null, leidos: null, afirmaciones: null },
  juez: { hechas: null, total: null, sinJuez: null, veredictos: null },
} as unknown as DatosLab;
const ev = (e: Partial<EventoVisualLab>): EventoVisualLab => ({ id: 'x', sala: 'r1', agentes: [], tipo: 'fuente', texto: '', ...e });
beforeEach(() => fijarIdioma('es'));

describe('titular de cada escena: la novedad en una línea, solo con datos recibidos', () => {
  it('una fuente dice cuántos resultados sirven, o que no responde si no hay cifra', () => {
    const d = { ...base, fuentes: [{ nombre: 'PubMed', salen: 120, sirven: 30, fallo: false, consultas: 2 }, { nombre: 'Europe PMC', salen: null, sirven: null, fallo: true, consultas: 1 }] } as DatosLab;
    expect(titularDe(ev({ texto: 'PubMed\nResultados: 120' }), d)).toBe('PubMed: 30 de 120 resultados sirven');
    expect(titularDe(ev({ texto: 'Europe PMC\nAlgunas consultas no respondieron' }), d)).toBe('Europe PMC no responde');
  });

  it('un artículo, una idea y un torneo se resumen con su título real', () => {
    expect(titularDe(ev({ tipo: 'filtro', dato: { tipo: 'articulo', id: 'p', titulo: 'MAPT en cohortes', estado: 'incluido', motivo: 'm', modo: 'foco' } }), base)).toBe('✓ Sirve: MAPT en cohortes');
    expect(titularDe(ev({ tipo: 'filtro', dato: { tipo: 'articulo', id: 'p', titulo: 'Revisión', estado: 'excluido', motivo: 'm', modo: 'foco' } }), base)).toBe('✗ No sirve: Revisión');
    expect(titularDe(ev({ tipo: 'idea', dato: { tipo: 'idea', hipotesisId: 'h', titulo: 'Modular TREM2', enfoque: 'analogia' } }), base)).toBe('Idea nueva · Analogía: Modular TREM2');
    const torneo = { tipo: 'torneo' as const, hipotesisAId: 'a', hipotesisBId: 'b', tituloA: 'A real', tituloB: 'B real', porRegla: false };
    expect(titularDe(ev({ tipo: 'torneo', dato: { ...torneo, estado: 'b' } }), base)).toBe('Gana: B real');
    expect(titularDe(ev({ tipo: 'torneo', dato: { ...torneo, estado: 'comparando' } }), base)).toBe('Comparan: A real frente a B real');
  });

  it('lectura, juez y plan usan sus cifras; sin cifras cae a la primera línea del registro', () => {
    const d = { ...base, lectura: { ...base.lectura, resultados: 120, sirven: 30, afirmaciones: 41 }, juez: { hechas: 12, total: 41, sinJuez: null, veredictos: { sostenida: 8, parcial: 2, no_sostenida: 2, otras: 0 } },
      pasos: { lista: [{ id: '1', titulo: 'a' }, { id: '2', titulo: 'b' }], aprobado: true } } as unknown as DatosLab;
    expect(titularDe(ev({ tipo: 'lectura' }), d)).toBe('30 de 120 resultados sirven · 41 afirmaciones van al juez');
    expect(titularDe(ev({ id: 'verificacion:i', tipo: 'revision' }), d)).toBe('El juez lleva 12 de 41 · 8 sostenidas');
    expect(titularDe(ev({ tipo: 'plan', sala: 'plan' }), d)).toBe('Plan aprobado: 2 pasos');
    expect(titularDe(ev({ tipo: 'lectura', texto: '\nResultados de consultas: 9' }), base)).toBe('Resultados de consultas: 9');
  });

  it('en inglés traduce el marco y conserva los títulos científicos', () => {
    fijarIdioma('en');
    expect(titularDe(ev({ tipo: 'torneo', dato: { tipo: 'torneo', hipotesisAId: 'a', hipotesisBId: 'b', tituloA: 'Título A', tituloB: 'Título B', porRegla: false, estado: 'a' } }), base)).toBe('Winner: Título A');
  });
});
