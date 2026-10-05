import { expect, it } from 'vitest';
import { eliminarInvestigacion } from './acciones';
import { estadoDeMuestra } from './muestra';
import type { EstadoRosa } from './tipos';

function poblado(): EstadoRosa {
  const base = estadoDeMuestra();
  return { ...base, investigaciones: [{ ...base.investigaciones[0]!, id: 'inv-a', datasets: [], preguntasABases: [] }, { ...base.investigaciones[0]!, id: 'inv-b', datasets: [], preguntasABases: [] }],
    corridas: [{ id: 'cor-a', investigacionId: 'inv-a', estado: 'terminada' }, { id: 'cor-b', investigacionId: 'inv-b', estado: 'terminada' }],
    hipotesis: [{ id: 'hip-a', investigacionId: 'inv-a' }, { id: 'hip-b', investigacionId: 'inv-b' }],
    hechos: [{ id: 'hecho-a', investigacionId: 'inv-a' }, { id: 'hecho-b', investigacionId: 'inv-b' }],
    iteraciones: [{ id: 'it-a', corridaId: 'cor-a' }, { id: 'it-b', corridaId: 'cor-b' }],
    comentarios: [{ id: 'com-a', hipotesisId: 'hip-a' }], solicitudes: [], incidencias: [], permisos: [], cuestiones: [],
    artefactos: [], eventos: [], decisiones: [], planesAnalisis: [], ejecuciones: [], reproducciones: [], aprendizaje: [],
    tareas: [], lecciones: [], conjuntoDorado: [], relaciones: [], memoria: [], datasetsPrograma: [],
  } as unknown as EstadoRosa;
}

it('retira la investigación completa, conserva la otra y no muta el original', () => {
  const e = poblado();
  const antes = structuredClone(e);
  const r = eliminarInvestigacion(e, 'inv-a', 'persona');
  expect(r.investigaciones.map(i => i.id)).toEqual(['inv-b']);
  expect(r.corridas.map(i => i.id)).toEqual(['cor-b']);
  expect(r.iteraciones.map(i => i.id)).toEqual(['it-b']);
  expect(r.hipotesis.map(i => i.id)).toEqual(['hip-b']);
  expect(r.hechos.map(i => i.id)).toEqual(['hecho-b']);
  expect(r.comentarios).toEqual([]);
  expect(r.investigacionesEliminadas).toEqual(['inv-a']);
  expect(e).toEqual(antes);
  expect(eliminarInvestigacion(r, 'inv-a', 'persona')).toBe(r);
  expect(eliminarInvestigacion(e, 'global', 'persona')).toBe(e);
});

it.each(['rama', 'hecho', 'corrida', 'autor'])('rechaza el borrado inseguro por %s', caso => {
  const e = poblado();
  if (caso === 'rama') e.investigaciones[1]!.ramaDe = 'inv-a';
  if (caso === 'hecho') e.hechos[1]!.contradiceA = ['hecho-a'];
  if (caso === 'corrida') e.corridas[0]!.estado = 'en_marcha';
  expect(eliminarInvestigacion(e, 'inv-a', caso === 'autor' ? '' : 'persona')).toBe(e);
});
