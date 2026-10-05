import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import type { ReactNode } from 'react';
import { SUAVE, useMovimientoReducido } from '../lib/movimiento';

interface ContenidoProps {
  children: ReactNode;
  id?: string;
  className?: string;
}

function Contenido({ children, id, className }: ContenidoProps) {
  const presente = useIsPresent();
  return (
    <motion.div
      id={id}
      className={`desplegable ${className ?? ''}`.trim()}
      aria-hidden={presente ? undefined : true}
      {...(!presente ? { inert: '' } : {})}
      initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
      animate={{ height: 'auto', opacity: 1, overflow: 'hidden', transitionEnd: { overflow: 'visible' } }}
      exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
      transition={SUAVE}
    >
      {children}
    </motion.div>
  );
}

/** Solo se monta el contenido abierto. Durante el cierre queda inerte;
 *  al terminar se desmonta, como antes de añadir la transición. */
export function Desplegable({ abierto, children, ...props }: ContenidoProps & { abierto: boolean }) {
  const reducido = useMovimientoReducido();
  if (reducido) return abierto ? <div {...props} className={`desplegable ${props.className ?? ''}`.trim()}>{children}</div> : null;
  return (
    <AnimatePresence initial={false}>
      {abierto && <Contenido {...props}>{children}</Contenido>}
    </AnimatePresence>
  );
}
