import type { EstadoRosa, Investigacion, PreguntaABases } from '../datos/tipos';

export type ReferenciaConversacion = { investigacionId: string; hilo: string };
export type PreguntaHistorial = PreguntaABases & { investigacionId: string };

/** El mismo contenedor general que crea el servidor al guardar una respuesta. */
export function asistenteGeneral(estado: Pick<EstadoRosa, 'asistenteGlobal'>): Investigacion {
  return estado.asistenteGlobal ?? {
    id: 'global', titulo: 'Asistente de ROSA', objetivo: 'Operar y consultar todo ROSA',
    relevancia: '', limites: [], condicionParada: '', revisores: [], estado: 'activa',
    creadaEn: 0, ramaDe: null,
    configuracion: { preferencias: '', atributos: [], restricciones: [], amplitud: 'equilibrada' },
    datasets: [], vigilarLiteraturaHasta: null, preguntasABases: [], memoria: [],
  };
}

/** Reúne también los hilos antiguos, sin moverlos ni cambiar su contexto. */
export function preguntasDelAsistente(estado: Pick<EstadoRosa, 'asistenteGlobal' | 'investigaciones'>): PreguntaHistorial[] {
  return [asistenteGeneral(estado), ...estado.investigaciones].flatMap(inv =>
    (inv.preguntasABases ?? [])
      .filter(q => q && !inv.hilosEliminados?.includes(q.hilo || q.id))
      .map(q => ({ ...q, investigacionId: inv.id })),
  );
}
