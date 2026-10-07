import type { Corrida, Iteracion } from '../datos/tipos';
import { formatearEntero } from './formato';
import { tr, trp } from './idioma';
import type { PeticionLab } from './labVivo';

/** Las llamadas que faltan según el servidor («Amplía el tope en al menos 5 llamadas…»,
 * «le faltan unas 26 llamadas»). Sin cifra, ninguna. */
function minimoDelMotivo(motivo: string | null | undefined): number | null {
  const m = motivo?.match(/al menos (\d+) llamadas/) ?? motivo?.match(/le faltan unas (\d+) llamadas/);
  return m ? Number(m[1]) : null;
}

/** La pausa por presupuesto la pide el planificador con la misma lupa que un gasto:
 * cuántas llamadas más permitir para que la corrida siga. */
export function peticionPorPresupuesto(corrida: Corrida, it: Iteracion | null): PeticionLab {
  const limite = corrida.presupuesto.limiteLlamadas, usado = corrida.gasto.llamadas;
  const minimo = minimoDelMotivo(corrida.presupuesto.motivoPausa);
  const agotada = usado >= limite;
  // Sin un mínimo escrito, lo que tenía la iteración o, si no, una quinta parte del tope.
  const propuesta = minimo ?? (it && it.presupuesto.limite > 0 ? it.presupuesto.limite : Math.max(1, Math.round(limite / 5)));
  const titulo = minimo !== null && it ? trp('La iteración {i} necesita al menos {n} llamadas más para seguir', { i: it.numero, n: formatearEntero(minimo) })
    : agotada ? trp('La corrida agotó sus {l} llamadas', { l: formatearEntero(limite) })
      : it ? trp('La iteración {i} se quedó sin llamadas', { i: it.numero })
        : tr('La corrida se pausó por presupuesto');
  return {
    id: `presupuesto:${corrida.id}:${it?.id ?? 'sin-iteracion'}:${limite}:${it?.presupuesto.limite ?? ''}`,
    clase: 'presupuesto',
    quien: 'Planificador',
    titulo,
    detalle: trp('La corrida lleva {g} de {l} llamadas y está en pausa. Puedes ajustar cuántas llamadas más permitir.', { g: formatearEntero(usado), l: formatearEntero(limite) }),
    alcances: [],
    requiereArgumentos: false,
    presupuesto: { corridaId: corrida.id, limite, usado, propuesta },
  };
}
