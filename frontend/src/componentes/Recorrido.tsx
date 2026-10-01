// El recorrido de primera vez: cinco pasos que cuentan como funciona ROSA2018 y
// donde se decide cada cosa. Aparece solo la primera vez que se abre la
// aplicacion (queda anotado en el navegador) y se puede volver a ver desde
// el boton de ayuda de la cabecera o desde Ajustes. Se mueve con las flechas
// y se cierra con Escape.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { ETAPAS } from './HiloDelProceso';
import { useMovimientoReducido } from '../lib/movimiento';
import { traducido } from '../lib/idioma';

const CLAVE = 'rosa.recorrido.v1';

export const PASOS: { titulo: string; texto: string; pista: string; etapa: number | null }[] = traducido([
  {
    titulo: 'ROSA2018 investiga; tú decides',
    texto: 'ROSA2018 lee la literatura, extrae afirmaciones y las verifica contra el pasaje literal, actualiza un modelo de mundo con procedencia, genera hipótesis y las somete a un Killer de quince comprobaciones. Nada entra al modelo de mundo ni llega al laboratorio sin pasar por ti.',
    pista: 'El hilo de arriba muestra siempre en qué etapa está y qué te espera.',
    etapa: null,
  },
  {
    titulo: 'La corrida en vivo',
    texto: 'Cada iteración empieza con un plan que ROSA2018 propone y tú apruebas (puedes reordenar, quitar o añadir pasos). Después ves cada paso ejecutarse y, dentro, las pistas que trabajan en paralelo con cada consulta a cada base.',
    pista: 'Si algo va mal, ROSA2018 abre una incidencia o pide permiso: se resuelven ahí mismo.',
    etapa: 1,
  },
  {
    titulo: 'La cola de hipótesis y el Killer',
    texto: 'Las hipótesis llegan a la cola ordenadas por Elo. Abres una, ves su tarjeta, sus afirmaciones verificadas y lo que dijo el Killer comprobación por comprobación, y decides: aceptar, descartar o pedir que la refine. Tienes unos segundos para deshacer.',
    pista: 'Marca en cada comprobación si el juez acierta: así se calibra.',
    etapa: 4,
  },
  {
    titulo: 'Candidatas, laboratorio y prerregistro',
    texto: 'El torneo entre hipótesis y los bloqueos no compensables deciden cuales son candidatas (hasta tres por ciclo). Al asignar una a un laboratorio, el protocolo y los criterios se congelan en un prerregistro sellado por un tercero, y el dossier sale listo.',
    pista: 'Cuando vuelvan los datos, ROSA2018 los juzga contra lo prerregistrado y actualiza la certeza GRADE.',
    etapa: 5,
  },
  {
    titulo: 'Donde mirar y como moverse',
    texto: 'Calidad mide si el juez acierta y cuanto cuesta cada decisión. Ajustes tiene el dial de autonomía, las políticas y la integridad del registro. Objetivo y datos guarda la misión, los datasets con su libro de procedencia y lo que sabe el laboratorio.',
    pista: 'Cmd K (o Ctrl K) busca en toda la investigación. Este recorrido vuelve desde el botón ? de la cabecera.',
    etapa: null,
  },
]);

export function recorridoVisto(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '1';
  } catch {
    return true;
  }
}

function marcarVisto(): void {
  try {
    localStorage.setItem(CLAVE, '1');
  } catch {
    // Sin almacenamiento: se vera otra vez la proxima; no pasa nada.
  }
}

export function Recorrido({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const [paso, setPaso] = useState(0);
  const reducido = useMovimientoReducido();
  useEffect(() => {
    if (abierto) setPaso(0);
  }, [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
      if (e.key === 'ArrowRight') setPaso((p) => Math.min(PASOS.length - 1, p + 1));
      if (e.key === 'ArrowLeft') setPaso((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  const cerrar = () => {
    marcarVisto();
    onCerrar();
  };
  const p = PASOS[paso]!;
  return (
    <AnimatePresence>
      {abierto && (
        <motion.div className="recorrido-fondo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={cerrar} role="presentation">
          <motion.div className="recorrido" role="dialog" aria-modal="true" aria-labelledby="recorrido-titulo" initial={reducido ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducido ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
            <div className="recorrido-hilo" aria-hidden="true">
              {ETAPAS.map((e, i) => (
                <span key={e.clave} className={`recorrido-etapa ${p.etapa === i ? 'activa' : ''}`}>
                  {e.corto}
                </span>
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={paso} initial={reducido ? { opacity: 0 } : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reducido ? { opacity: 0 } : { opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
                <p className="meta">
                  Paso {paso + 1} de {PASOS.length}
                </p>
                <h2 id="recorrido-titulo">{p.titulo}</h2>
                <p>{p.texto}</p>
                <p className="recorrido-pista">{p.pista}</p>
              </motion.div>
            </AnimatePresence>
            <div className="recorrido-pie">
              <div className="recorrido-puntos" aria-hidden="true">
                {PASOS.map((_, i) => (
                  <button key={i} type="button" className={i === paso ? 'activo' : ''} onClick={() => setPaso(i)} aria-label={`Paso ${i + 1}`} />
                ))}
              </div>
              <div className="acciones">
                <button type="button" className="btn btn-fantasma" onClick={cerrar}>
                  {paso === PASOS.length - 1 ? 'Cerrar' : 'Saltar'}
                </button>
                {paso > 0 && (
                  <button type="button" className="btn" onClick={() => setPaso(paso - 1)}>
                    Atras
                  </button>
                )}
                {paso < PASOS.length - 1 ? (
                  <button type="button" className="btn btn-primario" onClick={() => setPaso(paso + 1)} autoFocus>
                    Siguiente
                  </button>
                ) : (
                  <button type="button" className="btn btn-primario" onClick={cerrar} autoFocus>
                    Empezar
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
