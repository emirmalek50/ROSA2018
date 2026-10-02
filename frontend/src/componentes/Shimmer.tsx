// Texto con un brillo que lo recorre mientras ROSA2018 piensa. La idea es del
// componente `shimmer` de AI Elements de Vercel; aquel lo hace con clases de
// Tailwind y aquí va con el CSS de ROSA2018.
//
// Cómo funciona, que no es obvio: el texto se pinta transparente
// (`color: transparent`) y lo que se ve es un degradado recortado a la forma
// de las letras (`background-clip: text`). Mover la posición del fondo da la
// sensación de que la luz pasa por encima. Es una sola propiedad animada y la
// hace el compositor, así que no cuesta nada aunque esté todo el rato.
//
// Con movimiento reducido no se anima: se queda el texto normal, legible. Un
// brillo que no para es justo lo que molesta a quien pidió que no se mueva.

import { motion } from 'motion/react';

import { useMovimientoReducido } from '../lib/movimiento';

export function Shimmer({ children, duracion = 2.2, className = '' }: { children: string; duracion?: number; className?: string }) {
  const reducido = useMovimientoReducido();
  if (reducido) return <span className={`brillo-quieto ${className}`.trim()}>{children}</span>;
  return (
    <motion.span
      className={`brillo ${className}`.trim()}
      // El ancho del brillo va con el largo del texto: en una frase corta un
      // brillo fijo la tapa entera y no se lee.
      style={{ ['--brillo-ancho' as string]: `${Math.max(40, children.length * 2)}px` }}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{ repeat: Infinity, duration: duracion, ease: 'linear' }}
    >
      {children}
    </motion.span>
  );
}
