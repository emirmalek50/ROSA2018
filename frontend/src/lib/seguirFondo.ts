// Que el chat baje solo mientras llega la respuesta, como en cualquier chat.
//
// Lo que hace que un chat se sienta vivo o roto es esto: cuando entra texto
// nuevo por abajo, la vista tiene que seguirlo; pero si la persona ha subido
// a releer algo, NO se le puede arrancar de ahí. La regla es la de ChatGPT,
// Claude y Kimi: se sigue el fondo solo si ya estábamos pegados a él.
//
// Antes el chat solo bajaba cuando cambiaba el NÚMERO de turnos. Mientras una
// respuesta estaba en marcha entraban treinta pasos y luego la respuesta
// entera, y el número no cambiaba: medido el 3 de octubre de 2026, el chat
// se quedó a 1616 px del fondo al terminar (Emir: «los chats no bajan solos
// con los mensajes»).

import { useEffect, useLayoutEffect, useRef } from 'react';

/** A menos de esto del fondo se considera «pegado», y el chat sigue bajando.
 *  Más lejos, la persona está leyendo arriba y se la deja en paz. */
export const PEGADO_PX = 140;

type Lector = { alto: () => number; arriba: () => number; ventana: () => number; bajar: (top: number, suave: boolean) => void };

const ventana: Lector = {
  alto: () => document.scrollingElement?.scrollHeight ?? 0,
  arriba: () => document.scrollingElement?.scrollTop ?? 0,
  ventana: () => window.innerHeight,
  bajar: (top, suave) => window.scrollTo({ top, behavior: suave ? 'smooth' : 'auto' }),
};

export function distanciaAlFondo(l: Lector = ventana): number {
  return Math.max(0, l.alto() - l.arriba() - l.ventana());
}

/** Sigue el fondo de la página mientras `contenido` cambie, si estábamos
 *  pegados a él. `forzar` cambia cuando la persona manda un mensaje: ahí se
 *  baja siempre, esté donde esté, porque es ella quien acaba de hablar. */
export function useSeguirFondo(contenido: unknown, forzar: unknown, activo = true, l: Lector = ventana): void {
  // Si estábamos pegados ANTES de que el DOM creciera: se mide en el
  // layout effect, que corre antes de pintar, con el alto nuevo ya en el DOM
  // pero el scroll aún en su sitio.
  const pegadoAntes = useRef(true);
  const ultimoForzar = useRef(forzar);
  // Mientras bajamos NOSOTROS con scroll suave, la distancia al fondo es
  // grande a mitad de camino y el listener creería que la persona subió. Se
  // ignora el scroll durante ese tramo.
  const bajandoHasta = useRef(0);
  useLayoutEffect(() => {
    if (!activo) return;
    const forzado = ultimoForzar.current !== forzar;
    ultimoForzar.current = forzar;
    if (forzado || pegadoAntes.current) {
      bajandoHasta.current = Date.now() + 600;
      pegadoAntes.current = true;
      l.bajar(l.alto(), !forzado);
    }
  }, [contenido, forzar, activo, l]);
  // Y se recuerda, en cada scroll de la persona, si sigue pegada o se ha ido.
  useEffect(() => {
    if (!activo) return;
    const mirar = () => {
      if (Date.now() < bajandoHasta.current) return;
      pegadoAntes.current = distanciaAlFondo(l) < PEGADO_PX;
    };
    window.addEventListener('scroll', mirar, { passive: true });
    return () => window.removeEventListener('scroll', mirar);
  }, [activo, l]);
}
