import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import { buscar } from './buscar';
import type { EstadoRosa, RevisionTratamiento } from '../datos/tipos';
import { rutaNovedad } from './ruta';

function conRevision(): EstadoRosa {
  const estado = estadoDeMuestra();
  const informe = {
    agente: 'Especialista en patentes', estado: 'coincidencias' as const, resumen: 'Revisión documental', fecha: 100,
    corridaId: 'cor-anterior', iteracionId: 'it-anterior', hipotesisId: estado.hipotesis[0]!.id,
    modelo: null, revisor: null, consultas: [], limitaciones: [],
    hallazgos: [{ id: 'US123456789B2', titulo: 'Claim for compound', url: 'https://patents.google.com/patent/US123456789B2/en', fuente: 'Google Patents',
      relacion: 'incierto' as const, cita: 'Literal unique claim passage', explicacion: 'Alcance sin establecer', diferencias: [], datos: {} }],
  };
  const revision: RevisionTratamiento = {
    version: 1, huella: 'firma', vigente: true, fecha: 100,
    perfil: { tipo: 'intervencion', nombre: 'Compuesto demo único', ingredientes: ['INGREDIENTE-SOLO'], sinonimos: ['CODIGO-X9'], dianas: [],
      modalidad: 'molécula', direccion: '', indicacion: '', combinacion: [], consultasPatentes: [], consultasProgramas: [] },
    patentes: informe, companias: { ...informe, agente: 'Especialista en compañías', hallazgos: [{ ...informe.hallazgos[0]!,
      id: 'NCT87654321', titulo: 'Study registration', fuente: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov/study/NCT87654321', cita: 'Different company source passage',
      datos: { patrocinador: { nombre: 'Empresa exclusiva A', clase: 'INDUSTRY' } } }] },
  };
  estado.hipotesis[0]!.revisionTratamiento = revision;
  return estado;
}

describe('buscar', () => {
  const e = estadoDeMuestra();
  it('encuentra hipotesis, hechos y fuentes sin importar acentos ni mayusculas', () => {
    const r = buscar(e, 'inv-1', 'NLRP3');
    expect(r.some((x) => x.tipo === 'hipotesis')).toBe(true);
    expect(r.some((x) => x.tipo === 'hecho')).toBe(true);
    expect(r.some((x) => x.tipo === 'fuente')).toBe(true);
    expect(buscar(e, 'inv-1', 'nlrp3').length).toBe(r.length);
  });
  it('encuentra por DOI y por NCT', () => {
    expect(buscar(e, 'inv-1', '10.1002/trc2').some((x) => x.tipo === 'fuente')).toBe(true);
    expect(buscar(e, 'inv-1', 'NCT04777396').some((x) => x.tipo === 'fuente')).toBe(true);
  });
  it('encuentra iteraciones por el titulo de una pista y artefactos por contenido', () => {
    expect(buscar(e, 'inv-1', 'ARIA en portadores').some((x) => x.tipo === 'iteracion')).toBe(true);
    expect(buscar(e, 'inv-1', 'Preguntas cerradas').some((x) => x.tipo === 'artefacto')).toBe(true);
  });
  it('menos de dos caracteres no busca y respeta el maximo', () => {
    expect(buscar(e, 'inv-1', 'a')).toEqual([]);
    expect(buscar(e, 'inv-1', 'a ', 3).length).toBeLessThanOrEqual(3);
  });
  it('no devuelve duplicados', () => {
    const r = buscar(e, 'inv-1', 'tau');
    const claves = r.map((x) => `${x.tipo}|${x.titulo}|${x.ruta}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
  it.each(['US123456789B2', 'Literal unique claim passage'])('abre el informe de patente real por %s', q => {
    const estado = conRevision();
    const h = estado.hipotesis[0]!;
    const r = buscar(estado, h.investigacionId, q).filter(x => x.tipo === 'novedad');
    expect(r).toHaveLength(1);
    expect(r[0]!.ruta).toBe(rutaNovedad(h.investigacionId, h.id, 'patentes'));
  });
  it.each(['Empresa exclusiva A', 'NCT87654321'])('abre compañías por datos originales %s', q => {
    const estado = conRevision();
    const h = estado.hipotesis[0]!;
    const r = buscar(estado, h.investigacionId, q).filter(x => x.tipo === 'novedad');
    expect(r).toHaveLength(1);
    expect(r[0]!.ruta).toBe(rutaNovedad(h.investigacionId, h.id, 'companias'));
  });
  it.each(['Compuesto demo único', 'INGREDIENTE-SOLO', 'CODIGO-X9'])('encuentra ambos informes por identidad %s', q => {
    const estado = conRevision();
    expect(buscar(estado, estado.hipotesis[0]!.investigacionId, q).filter(x => x.tipo === 'novedad')).toHaveLength(2);
  });
  it.each([false, undefined])('no publica dossiers obsoletos o sin vigencia verificable: %s', vigente => {
    const estado = conRevision();
    const h = estado.hipotesis[0]!;
    h.revisionTratamiento!.vigente = vigente;
    expect(buscar(estado, h.investigacionId, 'US123456789B2').filter(x => x.tipo === 'novedad')).toEqual([]);
  });
  it('no mezcla investigaciones ni confunde títulos iguales con la hipótesis del informe', () => {
    const estado = conRevision();
    const h = estado.hipotesis[0]!;
    expect(buscar(estado, 'otra-investigacion', 'US123456789B2')).toEqual([]);
    h.revisionTratamiento!.patentes!.hipotesisId = 'otra-hipotesis';
    expect(buscar(estado, h.investigacionId, 'US123456789B2').filter(x => x.tipo === 'novedad')).toEqual([]);
  });
});
