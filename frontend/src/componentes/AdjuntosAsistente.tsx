// Adjuntar datos desde el chat, como el «+» de Claude.
//
// El «+» abre DOS acciones, con el verbo primero y para qué sirve debajo:
// «Subir un dataset» y «Subir resultados de un experimento». Se entienden
// sin leer, como las tres del menú de Claude. Elegir una abre el selector de
// archivos del sistema directamente: un paso, no dos. Con el archivo elegido
// aparece un chip encima del «+», con el nombre y una × para quitarlo; si
// son resultados, AHÍ se elige de qué experimento, en un desplegable, que es
// cuando ya hay contexto para esa decisión. Y ahí se guarda.
//
// Tres vueltas el 2 de octubre de 2026. La primera era el formulario entero
// en un panel (Emir: «se ve feísimo»). La segunda, una lista con una fila
// por hipótesis: nueve títulos recortados que había que leer (Emir: «ni se
// comprende a simple vista, se perdió el entendimiento rápido»). Esta
// separa las dos decisiones: QUÉ subes, en el menú, de un vistazo; A CUÁL
// experimento, en el chip, cuando toca.
//
// La carga sigue yendo por los endpoints del laboratorio: el fichero NO
// entra en el prompt.

import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';

import { acciones, useRosa } from '../datos/almacen';
import { useCerrarAlSalir } from '../lib/cierre';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { IconDocument, IconFlask, IconLayers, IconPlus, IconX } from './icons';

/** La curva de los menús de Radix y de Claude: arranca rápido y se posa
 *  despacio, sin rebote. */
const SALIDA = [0.16, 1, 0.3, 1] as const;

export function AdjuntosAsistente({ investigacionId, alSubir, disabled = false }: {
  investigacionId: string; alSubir: (texto: string) => void; disabled?: boolean;
}) {
  const e = useRosa();
  const reducido = useMovimientoReducido();
  const [abierto, setAbierto] = useState(false);
  const [investigacionElegida, setInvestigacionElegida] = useState('');
  const investigacionDestino = investigacionId === 'global' ? investigacionElegida : investigacionId;
  const investigaciones = e.investigaciones ?? [];
  const investigacion = investigaciones.find(i => i.id === investigacionDestino);
  const [accion, setAccion] = useState<'dataset' | 'experimento'>('dataset');
  const [destino, setDestino] = useState('dataset');
  const [fichero, setFichero] = useState<File | null>(null);
  const [sintetico, setSintetico] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const boton = useRef<HTMLButtonElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const hipotesis = e.hipotesis.filter(h => h.investigacionId === investigacionDestino && h.experimento);

  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };
  const caja = useCerrarAlSalir(abierto, cerrar);

  const elegir = (que: 'dataset' | 'experimento') => {
    setAccion(que);
    // Para resultados, el experimento se concreta en el chip; de entrada, el
    // primero que haya, para que guardar funcione aunque no se toque.
    setDestino(que === 'dataset' ? 'dataset' : (hipotesis[0]?.id ?? ''));
    setAviso('');
    setAbierto(false);
    // Un paso: elegir la acción abre el selector del sistema.
    entrada.current?.click();
  };

  const quitar = () => {
    setFichero(null);
    setSintetico(false);
    setAviso('');
    if (entrada.current) entrada.current.value = '';
  };

  const subir = async () => {
    if (!fichero || ocupado) return;
    if (!investigacion || (destino !== 'dataset' && !hipotesis.some(h => h.id === destino))) {
      setAviso(tr('Elige una investigación y un destino disponibles.'));
      return;
    }
    setOcupado(true);
    setAviso('');
    try {
      const error = destino === 'dataset'
        ? await acciones.subirDataset(investigacionDestino, fichero, fichero.name, '', sintetico)
        : await acciones.subirDatosExperimento(destino, fichero, '', sintetico);
      if (error) { setAviso(error); return; }
      setConfirmacion(tr('Archivo guardado en ROSA.'));
      window.setTimeout(() => setConfirmacion(''), 4000);
      alSubir(destino === 'dataset'
        ? `Acabo de subir el dataset «${fichero.name}» a la investigación «${investigacion.titulo}» (${investigacionDestino}). Revisa su ficha y dime qué falta para poder analizarlo.`
        : `Acabo de subir «${fichero.name}» como resultados del experimento ${destino}, investigación ${investigacionDestino}. Revisa su estado y los siguientes pasos.`);
      quitar();
    } catch {
      setAviso(tr('No se pudo subir el archivo. Comprueba la conexión.'));
    } finally {
      setOcupado(false);
    }
  };

  const entradaPanel = reducido ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 };
  const salidaPanel = reducido ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 4 };
  const transicion = reducido ? { duration: DUR.rapida } : { duration: DUR.media, ease: SALIDA };

  return (
    <div className="mundo-adjuntos" ref={caja}>
      {/* El input de fichero nativo no se puede estilar: va oculto y lo abre
          elegir una fila del menú. */}
      <input
        ref={entrada}
        type="file"
        className="adjuntos-entrada"
        disabled={disabled || ocupado}
        onChange={ev => { setFichero(ev.target.files?.[0] ?? null); setAviso(''); }}
      />

      <button
        ref={boton}
        type="button"
        className="mundo-adjuntar"
        disabled={disabled || ocupado}
        aria-expanded={abierto}
        aria-haspopup="menu"
        aria-label={tr('Adjuntar datos')}
        title={tr('Adjuntar datos')}
        onClick={() => setAbierto(!abierto)}
      >
        <IconPlus size={18} />
      </button>

      <AnimatePresence>
        {abierto && (
          <motion.div
            key="menu"
            className="adjuntos-menu"
            role="menu"
            aria-label={tr('Adjuntar datos')}
            initial={entradaPanel}
            animate={reducido ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={salidaPanel}
            transition={transicion}
            style={{ transformOrigin: 'bottom left' }}
          >
            {!investigacion ? (
              investigaciones.length === 0 ? (
                <a className="adjuntos-fila" role="menuitem" href="#/nueva">
                  <IconPlus size={16} />
                  <span className="adjuntos-fila-texto">
                    <span>{tr('Crear investigación')}</span>
                    <small>{tr('Hace falta una para guardar datos')}</small>
                  </span>
                </a>
              ) : (
                <>
                  <p className="adjuntos-menu-titulo">{tr('¿A qué investigación?')}</p>
                  {investigaciones.map(i => (
                    <button key={i.id} type="button" className="adjuntos-fila" role="menuitem" onClick={() => { setInvestigacionElegida(i.id); setDestino('dataset'); }}>
                      <IconLayers size={16} />
                      <span className="adjuntos-fila-texto"><span>{i.titulo}</span></span>
                    </button>
                  ))}
                </>
              )
            ) : (
              <>
                <button type="button" className="adjuntos-fila" role="menuitem" onClick={() => elegir('dataset')}>
                  <IconLayers size={16} />
                  <span className="adjuntos-fila-texto">
                    <span>{tr('Subir un dataset')}</span>
                    <small>{tr('Datos para analizar; pasan por aprobación')}</small>
                  </span>
                </button>
                {hipotesis.length > 0 && (
                  <button type="button" className="adjuntos-fila" role="menuitem" onClick={() => elegir('experimento')}>
                    <IconFlask size={16} />
                    <span className="adjuntos-fila-texto">
                      <span>{tr('Subir resultados de un experimento')}</span>
                      <small>{tr('Se contrastan con lo prerregistrado')}</small>
                    </span>
                  </button>
                )}
                {investigacionId === 'global' && (
                  <button type="button" className="adjuntos-fila adjuntos-fila-volver" role="menuitem" onClick={() => setInvestigacionElegida('')}>
                    <span className="adjuntos-fila-texto"><small>{trp('Investigación: {t}. Cambiar', { t: investigacion.titulo })}</small></span>
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* El archivo elegido: un chip, como el adjunto de Claude. Ahí se guarda. */}
      <AnimatePresence>
        {fichero && (
          <motion.div
            key="chip"
            className="adjuntos-chip"
            initial={entradaPanel}
            animate={reducido ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={salidaPanel}
            transition={transicion}
            style={{ transformOrigin: 'bottom left' }}
          >
            <div className="adjuntos-chip-cabeza">
              <IconDocument size={16} />
              <span className="adjuntos-chip-texto">
                <span className="adjuntos-chip-nombre">{fichero.name}</span>
                <small>{accion === 'dataset' ? tr('Dataset') : tr('Resultados de un experimento')}{investigacionId === 'global' && investigacion ? ` · ${investigacion.titulo}` : ''}</small>
              </span>
              <button type="button" className="adjuntos-chip-quitar" aria-label={tr('Quitar el archivo')} disabled={ocupado} onClick={quitar}>
                <IconX size={14} />
              </button>
            </div>
            {accion === 'experimento' && hipotesis.length > 0 && (
              <label className="adjuntos-chip-campo">
                <span>{tr('De qué experimento')}</span>
                <select value={destino} disabled={ocupado} onChange={ev => setDestino(ev.target.value)}>
                  {hipotesis.map(h => <option key={h.id} value={h.id}>{h.titulo}</option>)}
                </select>
              </label>
            )}
            <div className="adjuntos-chip-pie">
              <label className="adjuntos-casilla">
                <input type="checkbox" checked={sintetico} disabled={ocupado} onChange={ev => setSintetico(ev.target.checked)} />
                <span>{tr('Datos sintéticos de prueba')}</span>
              </label>
              <button type="button" className="btn btn-primario btn-s" data-accion="guardar" disabled={ocupado || disabled} onClick={() => void subir()}>
                {ocupado ? tr('Guardando…') : tr('Guardar en ROSA')}
              </button>
            </div>
            {aviso && <p className="adjuntos-aviso" role="status">{aviso}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmacion && (
          <motion.p
            key="ok"
            className="adjuntos-confirmacion"
            role="status"
            initial={reducido ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.rapida }}
          >
            {confirmacion}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
