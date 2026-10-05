import { expect, it } from 'vitest';
import { eliminarConversacion } from './acciones';
import { estadoDeMuestra } from './muestra';
import type { AccionAsistente, PreguntaABases } from './tipos';

const pregunta = (id: string, hilo?: string): PreguntaABases => ({ id, hilo, pregunta: 'MAPT', respuesta: 'Respuesta', fecha: 1, quien: 'persona', limites: '', herramientas: [], consultas: [], iteraciones: 0, error: null });

it.each(['global', 'investigacion'])('borra solo el hilo elegido en %s y conserva el estado científico', ambito => {
  const e = estadoDeMuestra();
  const inv = { ...e.investigaciones[0]!, preguntasABases: [pregunta('pb-1', 'h-mapt'), pregunta('pb-2', 'h-mapt'), pregunta('pb-3')] };
  if (ambito === 'global') e.asistenteGlobal = { ...inv, id: 'global' };
  else e.investigaciones[0] = inv;
  const id = ambito === 'global' ? 'global' : inv.id;
  const n = eliminarConversacion(e, id, 'h-mapt', 'persona');
  const actualizado = ambito === 'global' ? n.asistenteGlobal! : n.investigaciones[0]!;
  expect(actualizado.preguntasABases?.map(q => q.id)).toEqual(['pb-3']);
  expect(actualizado.hilosEliminados).toEqual(['h-mapt']);
  expect(n.corridas).toBe(e.corridas);
  expect(n.hipotesis).toBe(e.hipotesis);
  expect(actualizado.datasets).toBe(inv.datasets);
  expect(inv.preguntasABases).toHaveLength(3);
  expect(eliminarConversacion(n, id, 'h-mapt', 'persona')).toBe(n);
  const legado = eliminarConversacion(n, id, 'pb-3', 'persona');
  expect((ambito === 'global' ? legado.asistenteGlobal! : legado.investigaciones[0]!).preguntasABases).toEqual([]);
});

it.each(['en_curso', 'continuando', 'pendiente_continuacion'])('conserva las operaciones %s al intentar borrar', caso => {
  const e = estadoDeMuestra();
  const inv = e.investigaciones[0]!;
  const q = pregunta('pb-1', 'h-mapt');
  q.acciones = [{ id: 'op-1', nombre: 'crearInvestigacion', argumentos: {}, resumen: 'Crear', estado: caso === 'en_curso' ? 'en_curso' : 'ejecutada', ...(caso === 'continuando' ? { continuacion: 'en_curso' } : caso === 'pendiente_continuacion' ? { continuacion: 'pendiente' } : {}) } as AccionAsistente];
  inv.preguntasABases = [q];
  expect(eliminarConversacion(e, inv.id, 'h-mapt', 'persona')).toBe(e);
});
