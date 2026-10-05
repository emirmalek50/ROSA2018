// Piezas de la corrida en vivo (28 de septiembre de 2026): los resortes, el
// pulso, la frase de qué hace ROSA2018 y la cifra que rueda. La tarjeta que
// las pintaba la sustituyó el escenario (Escenario.tsx, 5 de octubre de 2026).
//
// Lo que faltaba: la pantalla se llama "Corrida en vivo" y en ningún sitio
// decía qué estaba haciendo ROSA2018 en ese momento. Había que deducirlo
// bajando hasta el plan y buscando el paso con el icono girando.
//
// Aquí se contesta de un vistazo, en este orden: si está viva, qué hace
// AHORA, por dónde va la iteración, sus cuatro constantes vitales, y qué
// necesita de ti si necesita algo. Todo lo demás de la pantalla es consulta
// y se queda debajo.
//
// Patrón de las Live Activities de iOS: un estado por tarjeta, una sola cosa
// importante, y el movimiento solo donde de verdad está pasando algo.

import { useEffect, useRef, useState } from 'react';
import type { Corrida, Iteracion } from '../datos/tipos';
import { useMovimientoReducido } from '../lib/movimiento';
import { coma, formatearEntero } from '../lib/formato';
import { tr, trp } from '../lib/idioma';

// Los resortes de SwiftUI, convertidos a los parámetros de `motion` con las
// fórmulas de Apple (stiffness = (2pi/duración)^2 * masa; damping =
// 4pi(1-rebote)/duración * masa). Se dan por física y no por duración porque
// solo la forma física hereda la velocidad al interrumpirse, como hace
// SwiftUI al redirigir una animación a mitad de camino.
/** `.smooth` de SwiftUI (duración 0,5, rebote 0): aterriza sin rebotar. */
export const SUAVE_IOS = { type: 'spring', stiffness: 157.9, damping: 25.13, mass: 1 } as const;
/** `.snappy` (duración 0,5, rebote 0,15): vivo sin que se note el rebote. */
export const VIVO_IOS = { type: 'spring', stiffness: 157.9, damping: 21.36, mass: 1 } as const;
/** El de los dígitos de los widgets de Apple: `spring(duration: 0.2)`. */
export const CIFRA_IOS = { type: 'spring', stiffness: 987, damping: 62.83, mass: 1 } as const;

type Pulso = 'marcha' | 'espera' | 'quieto';

/** En qué pulso está la corrida: trabajando, esperando a alguien, o parada.
 *  Decide el color del halo, si el punto late y el verbo de la cabecera. */
export function pulsoDe(estado: Corrida['estado']): Pulso {
  if (estado === 'en_marcha') return 'marcha';
  if (estado === 'detenida' || estado === 'terminada') return 'quieto';
  return 'espera';
}

/** Qué está haciendo ROSA2018 ahora mismo, en una frase. Sale del plan, no de
 *  un texto guardado: el paso en curso y, si lo hay, la pista que trabaja.
 *  Cuando no hay paso en curso lo dice el estado de la corrida. */
export function queHaceAhora(corrida: Corrida, iteracion: Iteracion | null): { titulo: string; detalle: string } {
  const enCurso = iteracion?.plan.find((p) => p.estado === 'en_curso') ?? null;
  if (corrida.estado === 'esperando_plan' || (iteracion && !iteracion.planAprobado && !iteracion.terminadaEn)) {
    return iteracion && !iteracion.planAprobado && iteracion.plan.length > 0
      ? { titulo: tr('El plan espera tu aprobación'), detalle: trp("{plan} pasos propuestos para la iteración {numero}.", { plan: iteracion.plan.length, numero: iteracion.numero }) }
      : { titulo: tr('Escribiendo el plan de la iteración'), detalle: tr('Dos o tres llamadas al cerebro; suele tardar uno o dos minutos.') };
  }
  if (corrida.estado === 'esperando_aprobacion') return { titulo: tr('ROSA2018 necesita tu permiso'), detalle: tr('Nada de lo pedido ocurre hasta que respondas.') };
  if (corrida.estado === 'pausada_por_presupuesto') return { titulo: tr('Corrida pausada por presupuesto'), detalle: corrida.presupuesto.motivoPausa || tr('Amplía el tope para que siga.') };
  if (corrida.estado === 'esperando_modelo') return { titulo: tr('Esperando a que el modelo vuelva'), detalle: tr('ROSA2018 reintenta sola con el mismo modelo; el reloj no corre.') };
  if (corrida.estado === 'pausada') return { titulo: tr('En pausa'), detalle: corrida.motivoPausaPropia || tr('Reanuda cuando quieras; el reloj no corre.') };
  if (corrida.estado === 'detenida') return { titulo: tr('Corrida detenida'), detalle: corrida.motivoCierre || tr('No se reanuda: para seguir hay que arrancar una nueva.') };
  if (corrida.estado === 'terminada') return { titulo: tr('Corrida terminada'), detalle: corrida.motivoCierre || tr('Se cumplió su condición de parada.') };
  if (enCurso) {
    const vivas = (iteracion?.pistas ?? []).filter((p) => p.pasoId === enCurso.id && p.estado === 'en_curso');
    const detalle = vivas.length === 0
      ? enCurso.detalle || tr('En marcha.')
      : vivas.length === 1
        ? `${vivas[0]!.titulo}`
        : (vivas.length > 2 ? trp("{vivas} pistas a la vez: {v}…", { vivas: vivas.length, v: vivas.slice(0, 2).map((p) => p.titulo).join('; ') }) : trp("{vivas} pistas a la vez: {v}", { vivas: vivas.length, v: vivas.slice(0, 2).map((p) => p.titulo).join('; ') }));
    return { titulo: enCurso.titulo, detalle };
  }
  if (iteracion && !iteracion.terminadaEn) return { titulo: tr('Entre pasos'), detalle: tr('Guardando lo del paso anterior y preparando el siguiente.') };
  return { titulo: tr('En marcha'), detalle: tr('Cerrando la iteración.') };
}

/** Una cifra que rueda hasta su valor y no baila: los dígitos van en cifra
 *  tabular, así el ancho no cambia mientras corre. */
export function Cifra({ valor, decimales = 0, sufijo }: { valor: number; decimales?: number; sufijo?: string }) {
  const reducido = useMovimientoReducido();
  const [mostrado, setMostrado] = useState(valor);
  const desde = useRef(valor);
  useEffect(() => {
    if (reducido || !Number.isFinite(valor)) {
      setMostrado(Number.isFinite(valor) ? valor : 0);
      desde.current = valor;
      return;
    }
    const inicio = desde.current;
    const salto = Math.abs(valor - inicio);
    if (salto === 0) return;
    // Corto: lo justo para que el ojo vea la dirección del cambio.
    const ms = Math.min(700, 220 + salto * 0.6);
    const t0 = performance.now();
    let id = 0;
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic, la salida de iOS
      setMostrado(inicio + (valor - inicio) * e);
      if (p < 1) id = requestAnimationFrame(paso);
      else desde.current = valor;
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [valor, reducido]);
  const texto = decimales > 0 ? coma(mostrado.toFixed(decimales)) : formatearEntero(Math.round(mostrado));
  return (
    <>
      {texto}
      {sufijo ? <small>{sufijo}</small> : null}
    </>
  );
}
