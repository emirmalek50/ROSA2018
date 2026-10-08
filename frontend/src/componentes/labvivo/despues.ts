/** Después del trabajo.
 *
 *  Cuando una corrida termina, el laboratorio no se congela ni se vacía:
 *  cambia de ritmo. Nadie se va a su casa. La gente se levanta de su mesa, se
 *  junta de dos en dos con alguien de su propia sala, se queda un rato de
 *  charla y vuelve; al poco sale otra pareja en otro cuarto. Las salas siguen
 *  llenas y encendidas, y el Juez y el Killer siguen acabando en su sitio con
 *  la lámpara puesta.
 *
 *  Tres decisiones que conviene no perder:
 *
 *  - Las parejas las coloca la misma pieza que ya usan las charlas de la
 *    corrida (`empezarEscena`), que las separa a la distancia de sus rótulos y
 *    las devuelve a su mesa. El primer intento puso corrillos en sitios fijos
 *    y caían encima de la gente que ya estaba de pie ahí: en las salas sin
 *    mesas, el sitio de cada cual YA está en el pasillo.
 *  - Lo que importa no es el rato de transición, es cómo queda el sitio
 *    después. Por eso el relevo no para nunca. Un cambio que ocurre una vez y
 *    acaba en un cuadro fijo es un cuadro fijo (el 8 de octubre de 2026 esto
 *    vaciaba las salas, y vacío estaba peor que quieto).
 *  - No gasta llamadas al modelo: es movimiento, no conversación. Sin corrida
 *    no hay presupuesto ni nada de lo que hablar, y así tampoco hay manera de
 *    que alguien suelte algo que parezca un hallazgo. Es ambiente: no afirma
 *    nada sobre lo que pasó.
 */

/** Los que no se levantan: siguen acabando en su mesa, con su lámpara. «Tú» no
 *  se mueve nunca, que es tu sitio. */
export const SIGUEN_TRABAJANDO: readonly string[] = ['Juez', 'Killer'];

/** Cuántas parejas de charla a la vez. Con cuatro, el sitio se nota vivo en
 *  varias salas sin que parezca que nadie trabaja ahí. */
export const CORRILLOS_A_LA_VEZ = 4;

/** Cuánto dura un corrillo antes de que cada cual vuelva a su mesa. */
export const DURACION_CORRILLO = 16;

export function seQuedaEnSuMesa(nombre: string): boolean {
  return nombre === 'Tú' || SIGUEN_TRABAJANDO.includes(nombre);
}

/** Cuándo toca el siguiente relevo. Mientras faltan corrillos va rápido, para
 *  que el sitio se anime pronto; cuando ya están todos se espacia, porque un
 *  baile continuo cansa y deja de parecer una oficina. */
export function siguienteRelevo(azar: () => number, ahora: number, faltan: boolean): number {
  const [min, max] = faltan ? [3, 7] : [12, 26];
  return ahora + min + azar() * (max - min);
}
