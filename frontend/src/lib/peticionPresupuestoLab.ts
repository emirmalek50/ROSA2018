import type { Corrida, Iteracion } from '../datos/tipos';
import { tr } from './idioma';
import type { PeticionLab } from './labVivo';

/** La pausa real también necesita una respuesta, aunque no sea un permiso. */
export function peticionPorPresupuesto(corrida: Corrida, it: Iteracion | null): PeticionLab {
  return {
    id: `presupuesto:${corrida.id}:${it?.id ?? 'sin-iteracion'}:${corrida.presupuesto.limiteLlamadas}:${it?.presupuesto.limite ?? ''}`,
    clase: 'presupuesto',
    quien: 'Preguntador',
    titulo: tr('Necesito más presupuesto para seguir. ¿Lo revisamos?'),
    detalle: corrida.presupuesto.motivoPausa || tr('La corrida se pausó por presupuesto. Revisa el tope para continuar.'),
    alcances: [],
    requiereArgumentos: false,
  };
}
