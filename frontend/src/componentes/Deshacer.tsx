// Las decisiones con peso (aceptar, descartar, refinar una hipotesis) se
// aplican al instante en pantalla pero viajan al servidor unos segundos
// después: mientras, este aviso con su barra de tiempo permite deshacer. El
// gesto enseña que la decisión cuenta y que hay un margen para el error. Si
// llega un estado del servidor entre medias, el almacén reaplica la decisión
// pendiente sobre él, así la tarjeta no retrocede mientras este aviso vive.

import { AnimatePresence, motion } from 'motion/react';
import { useAccionesPendientes, type AccionPendiente } from '../datos/almacen';
import { useAhora } from '../lib/useAhora';
import { useMovimientoReducido } from '../lib/movimiento';
import { tr } from '../lib/idioma';

function Aviso({ a, ahora }: { a: AccionPendiente; ahora: number }) {
  const restante = Math.max(0, a.hasta - ahora);
  const fraccion = restante / a.ms;
  const reducido = useMovimientoReducido();
  return (
    <motion.div className="deshacer" role="status" layout initial={reducido ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reducido ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
      <div className="deshacer-texto">
        <strong>{a.etiqueta}</strong>
        <span className="meta">Se envía en {Math.ceil(restante / 1000)} s</span>
      </div>
      <div className="acciones">
        <button type="button" className="btn btn-s" onClick={a.deshacer}>
          Deshacer
        </button>
        <button type="button" className="btn btn-s btn-fantasma" onClick={a.enviar} title={tr("No esperar: enviar ahora")}>
          Ahora
        </button>
      </div>
      <i className="deshacer-barra" style={{ transform: `scaleX(${fraccion})` }} aria-hidden="true" />
    </motion.div>
  );
}

export function ToastDeshacer() {
  const pendientes = useAccionesPendientes();
  const ahora = useAhora(250);
  return (
    <div className="deshacer-pila" aria-live="polite">
      <AnimatePresence>
        {pendientes.map((a) => (
          <Aviso key={a.id} a={a} ahora={ahora} />
        ))}
      </AnimatePresence>
    </div>
  );
}
