import { expect, it } from 'vitest';
import { asistenteGeneral, preguntasDelAsistente } from './conversacionesAsistente';
import type { PreguntaABases } from '../datos/tipos';

const pregunta = (id: string, hilo?: string): PreguntaABases => ({
  id, hilo, pregunta: 'Revisa MAPT', respuesta: 'Respuesta guardada', fecha: 1,
  limites: '', herramientas: [], consultas: [], iteraciones: 1, quien: 'persona', error: null,
});

it('reúne conversaciones generales, antiguas y sin hilo sin modificar sus registros', () => {
  const base = asistenteGeneral({});
  const estado = {
    asistenteGlobal: { ...base, preguntasABases: [pregunta('general', 'h-comun')] },
    investigaciones: [
      { ...base, id: 'inv-a', preguntasABases: [pregunta('antigua', 'h-comun')] },
      { ...base, id: 'inv-b', preguntasABases: [pregunta('sin-hilo')] },
    ],
  };
  const antes = JSON.stringify(estado);
  expect(preguntasDelAsistente(estado).map(q => [q.investigacionId, q.id, q.hilo])).toEqual([
    ['global', 'general', 'h-comun'], ['inv-a', 'antigua', 'h-comun'], ['inv-b', 'sin-hilo', undefined],
  ]);
  expect(JSON.stringify(estado)).toBe(antes);
});

it('excluye los hilos eliminados sin ocultar los demás del mismo contenedor', () => {
  const base = asistenteGeneral({});
  const estado = { investigaciones: [
    { ...base, id: 'inv-a', hilosEliminados: ['h-borrado', 'antigua'], preguntasABases: [pregunta('uno', 'h-borrado'), pregunta('antigua'), pregunta('vigente', 'h-vigente')] },
  ] };
  expect(preguntasDelAsistente(estado).map(q => q.id)).toEqual(['vigente']);
});

it('puede abrir el asistente general antes de crear una investigación', () => {
  const estado = { investigaciones: [] };
  expect(asistenteGeneral({}).id).toBe('global');
  expect(preguntasDelAsistente(estado)).toEqual([]);
});
