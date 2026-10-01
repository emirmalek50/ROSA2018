// Logica pura sobre hipotesis: orden de la cola, ranking, resumen de la
// verificacion y hallazgos visibles. Sin React: lo prueba vitest.

import type { Afirmacion, EstadoHipotesis, HallazgoRevisor, Hipotesis } from '../datos/tipos';
import { VEREDICTO } from './etiquetas';
import { tr } from './idioma';

/** Orden de la cola: primero lo que espera a una persona. */
const PRIORIDAD_COLA: Record<EstadoHipotesis, number> = {
  en_revision: 0,
  propuesta: 1,
  refinar: 2,
  aclarando: 3,
  aceptada: 4,
  descartada: 5,
};

/** La cola de revision: por estado (lo pendiente arriba) y dentro de cada
 *  estado por Elo descendente. No muta la entrada. */
export function ordenarCola(hipotesis: Hipotesis[]): Hipotesis[] {
  return [...hipotesis].sort((a, b) => {
    const p = PRIORIDAD_COLA[a.estado] - PRIORIDAD_COLA[b.estado];
    if (p !== 0) return p;
    if (b.elo !== a.elo) return b.elo - a.elo;
    return b.creadaEn - a.creadaEn;
  });
}

/** Cuantas esperan a una persona: propuestas, en revision o por refinar. */
export function pendientesDeRevision(hipotesis: Hipotesis[]): number {
  return hipotesis.filter((h) => h.estado === 'propuesta' || h.estado === 'en_revision' || h.estado === 'refinar').length;
}

/** Cuanto lleva esperando la decision mas antigua de la cola, en ms. */
export function esperaMasAntigua(hipotesis: Hipotesis[], ahora: number): number {
  const pendientes = hipotesis.filter((h) => h.estado === 'propuesta' || h.estado === 'en_revision' || h.estado === 'refinar');
  if (pendientes.length === 0) return 0;
  return ahora - Math.min(...pendientes.map((h) => h.creadaEn));
}

/** El ranking: por Elo descendente, con las descartadas al final aunque su
 *  Elo fuera alto, porque ya no compiten. */
export function ranking(hipotesis: Hipotesis[]): Hipotesis[] {
  return [...hipotesis].sort((a, b) => {
    const da = a.estado === 'descartada' ? 1 : 0;
    const db = b.estado === 'descartada' ? 1 : 0;
    if (da !== db) return da - db;
    return b.elo - a.elo;
  });
}

/** Cambio de Elo desde el primer punto del historial. 0 si no hay historial. */
export function variacionElo(h: Pick<Hipotesis, 'elo' | 'historialElo'>): number {
  const primero = h.historialElo[0];
  return primero ? h.elo - primero.elo : 0;
}

export interface ResumenVerificacion {
  total: number;
  sostenidas: number;
  bloqueantes: number;
  /** Frase para la cabecera. Resume el fallo, no el acierto. */
  frase: string;
  tono: 'ok' | 'aviso' | 'mal' | 'vacio';
}

function cuenta(afirmaciones: Afirmacion[], veredicto: Afirmacion['veredicto']): number {
  return afirmaciones.filter((a) => a.veredicto === veredicto).length;
}

/** Resumen de una linea de la verificacion, con la misma regla que el RAG:
 *  lo que se resume arriba es el fallo; si todo esta sostenido, una linea
 *  sobria; sin_verificar se dice como aviso, nunca como aprobado. */
export function resumirVerificacion(afirmaciones: Afirmacion[]): ResumenVerificacion {
  const total = afirmaciones.length;
  if (total === 0) return { total: 0, sostenidas: 0, bloqueantes: 0, frase: tr('Sin afirmaciones que verificar'), tono: 'vacio' };
  const sostenidas = cuenta(afirmaciones, 'sostenida');
  const bloqueantes = afirmaciones.filter((a) => VEREDICTO[a.veredicto].bloquea).length;
  const otraEntidad = afirmaciones.filter((a) => a.entidadDistinta).length;
  const noSostenidas = cuenta(afirmaciones, 'no_sostenida') - otraEntidad;
  const piezas = [
    cuenta(afirmaciones, 'sin_cita') > 0 && `${cuenta(afirmaciones, 'sin_cita')} sin cita`,
    cuenta(afirmaciones, 'ausencia_refutada') > 0 && `${cuenta(afirmaciones, 'ausencia_refutada')} ausencia desmentida`,
    cuenta(afirmaciones, 'cita_no_resuelve') > 0 && `${cuenta(afirmaciones, 'cita_no_resuelve')} cita sin fuente`,
    otraEntidad > 0 && `${otraEntidad} dato de otra entidad`,
    noSostenidas > 0 && `${noSostenidas} no sostenida`,
    cuenta(afirmaciones, 'parcial') > 0 && `${cuenta(afirmaciones, 'parcial')} parcial`,
    cuenta(afirmaciones, 'sin_verificar') > 0 && `${cuenta(afirmaciones, 'sin_verificar')} sin comprobar`,
  ].filter((p): p is string => typeof p === 'string');
  if (piezas.length === 0) {
    return { total, sostenidas, bloqueantes, frase: `${sostenidas} de ${total} afirmaciones respaldadas por su fuente`, tono: 'ok' };
  }
  return {
    total,
    sostenidas,
    bloqueantes,
    frase: piezas.join(' · '),
    tono: bloqueantes > 0 ? 'mal' : 'aviso',
  };
}

/** Fidelidad = sostenidas / juzgadas por el juez. null si no se juzgo nada. */
export function fidelidad(afirmaciones: Afirmacion[]): number | null {
  const juzgadas = afirmaciones.filter((a) => a.veredicto === 'sostenida' || a.veredicto === 'parcial' || a.veredicto === 'no_sostenida');
  if (juzgadas.length === 0) return null;
  return cuenta(juzgadas, 'sostenida') / juzgadas.length;
}

/** Cuantos hallazgos se ven antes de "mostrar todo". */
export const HALLAZGOS_VISIBLES = 3;

/** Los hallazgos que se pintan: los abiertos primero; tres, o todos. */
export function hallazgosVisibles(hallazgos: HallazgoRevisor[], mostrarTodo: boolean): { visibles: HallazgoRevisor[]; ocultos: number } {
  const orden: Record<HallazgoRevisor['estado'], number> = { abierto: 0, atendido: 1, no_aplica: 2 };
  const ordenados = [...hallazgos].sort((a, b) => orden[a.estado] - orden[b.estado]);
  if (mostrarTodo || ordenados.length <= HALLAZGOS_VISIBLES) return { visibles: ordenados, ocultos: 0 };
  return { visibles: ordenados.slice(0, HALLAZGOS_VISIBLES), ocultos: ordenados.length - HALLAZGOS_VISIBLES };
}

/** Una hipotesis se puede aceptar solo si nada bloquea y no hay hallazgos
 *  abiertos del revisor. Devuelve el motivo si no se puede. */
export function motivoNoAceptable(h: Pick<Hipotesis, 'afirmaciones' | 'hallazgos' | 'comprobacion'>): string | null {
  const bloqueantes = h.afirmaciones.filter((a) => VEREDICTO[a.veredicto].bloquea).length;
  if (bloqueantes > 0) return `${bloqueantes} ${bloqueantes === 1 ? tr('afirmación bloquea') : tr('afirmaciones bloquean')} la aceptación: hay que corregirlas o quitarlas`;
  const abiertos = h.hallazgos.filter((x) => x.estado === 'abierto').length;
  if (abiertos > 0) return `${abiertos} ${abiertos === 1 ? tr('hallazgo del revisor sigue abierto') : tr('hallazgos del revisor siguen abiertos')}`;
  if (h.comprobacion.biomarcador.trim() === '' && h.comprobacion.cohorte.trim() === '') {
    return tr('La hipótesis no dice con que biomarcador ni con que cohorte se comprobaría');
  }
  return null;
}
