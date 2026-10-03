// Cerrar un menú flotante: con Escape, pulsando fuera, y devolviendo el foco
// a quien lo abrió.
//
// Sin esto, un panel abierto se queda abierto: el de «Adjuntar datos» tapaba
// el chat y no había forma de quitarlo (Emir, 2 de octubre de 2026). Es lo
// que espera cualquiera de un menú, y hacerlo a mano en cada sitio se olvida.

import { useEffect, useRef } from 'react';

/** Devuelve la referencia que hay que poner en el contenedor del menú (el
 *  botón y el panel dentro del mismo elemento). Mientras `abierto`, una
 *  pulsación fuera de ese contenedor o la tecla Escape llaman a `cerrar`. */
export function useCerrarAlSalir<T extends HTMLElement = HTMLDivElement>(abierto: boolean, cerrar: () => void) {
  const caja = useRef<T>(null);
  const ultimo = useRef(cerrar);
  ultimo.current = cerrar;
  useEffect(() => {
    if (!abierto) return;
    // En captura: así se cierra aunque lo de debajo pare la propagación.
    const fuera = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) ultimo.current();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      ultimo.current();
    };
    document.addEventListener('pointerdown', fuera, true);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('pointerdown', fuera, true);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);
  return caja;
}
