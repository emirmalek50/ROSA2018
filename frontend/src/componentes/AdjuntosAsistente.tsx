// Adjuntar datos desde el chat: un menú anclado al «+» del compositor.
//
// Se rehízo el 2 de octubre de 2026 (Emir: «está desorganizado y se ve
// feísimo, hazle un rework como si fuera de Claude»). Lo que cambia respecto
// al <fieldset> suelto de antes: el panel va anclado y acotado, los campos
// llevan su rótulo encima y ocupan todo el ancho, el aviso legal va al pie
// en letra pequeña, y las acciones a la derecha, la principal la última. Y
// se puede cerrar: con la ×, con Escape y pulsando fuera.
//
// La carga sigue yendo por los endpoints del laboratorio: el fichero NO
// entra en el prompt.

import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';

import { acciones, useRosa } from '../datos/almacen';
import { useCerrarAlSalir } from '../lib/cierre';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { IconPlus, IconUpload, IconX } from './icons';

/** La curva de los menús de Radix y de Claude: arranca rápido y se posa
 *  despacio, sin rebote. La misma que usa el podio. */
const SALIDA = [0.16, 1, 0.3, 1] as const;

export function AdjuntosAsistente({ investigacionId, alSubir, disabled = false }: {
  investigacionId: string; alSubir: (texto: string) => void; disabled?: boolean;
}) {
  const e = useRosa();
  const [abierto, setAbierto] = useState(false);
  const [investigacionElegida, setInvestigacionElegida] = useState('');
  const investigacionDestino = investigacionId === 'global' ? investigacionElegida : investigacionId;
  const investigaciones = e.investigaciones ?? [];
  const investigacion = investigaciones.find(i => i.id === investigacionDestino);
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
    if (ocupado) return;
    setAbierto(false);
    boton.current?.focus();
  };
  const caja = useCerrarAlSalir(abierto, cerrar);
  const reducido = useMovimientoReducido();

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
      setFichero(null);
      setAbierto(false);
      boton.current?.focus();
    } catch {
      setAviso(tr('No se pudo subir el archivo. Comprueba la conexión.'));
    } finally {
      setOcupado(false);
    }
  };

  const faltaInvestigacion = investigacionId === 'global' && investigaciones.length === 0;

  return (
    <div className="mundo-adjuntos" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="mundo-adjuntar"
        disabled={disabled || ocupado}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        aria-label={tr('Adjuntar datos')}
        title={tr('Adjuntar datos')}
        onClick={() => setAbierto(!abierto)}
      >
        <IconPlus size={18} />
      </button>

      <AnimatePresence>
        {abierto && (
          <motion.div
            key="panel"
            className="adjuntos-panel"
            role="dialog"
            aria-label={tr('Guardar archivo en ROSA')}
            // Crece desde el «+», que es su ancla (origen abajo a la izquierda):
            // escala y un empujón hacia arriba, como los menús de Claude. La
            // salida es más corta que la entrada, que es lo que se espera de
            // algo que se cierra.
            initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            animate={reducido ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 4 }}
            transition={reducido ? { duration: DUR.rapida } : { duration: DUR.media, ease: SALIDA }}
            style={{ transformOrigin: 'bottom left' }}
          >
          <header className="adjuntos-cabecera">
            <h3>{tr('Guardar archivo en ROSA')}</h3>
            <button type="button" className="adjuntos-cerrar" aria-label={tr('Cerrar')} onClick={cerrar}>
              <IconX size={15} />
            </button>
          </header>

          <div className="adjuntos-cuerpo">
            {investigacionId === 'global' && (
              <label className="adjuntos-campo">
                <span>{tr('Investigación destinataria')}</span>
                <select
                  value={investigacionElegida}
                  disabled={ocupado}
                  onChange={ev => { setInvestigacionElegida(ev.target.value); setDestino('dataset'); setAviso(''); }}
                >
                  <option value="">{tr('Elige una investigación')}</option>
                  {investigaciones.map(i => <option key={i.id} value={i.id}>{i.titulo}</option>)}
                </select>
              </label>
            )}

            {faltaInvestigacion ? (
              <p className="adjuntos-vacio">
                {tr('Crea una investigación para guardar estos datos.')} <a href="#/nueva">{tr('Crear investigación')}</a>
              </p>
            ) : (
              <>
                <label className="adjuntos-campo">
                  <span>{tr('Destino')}</span>
                  <select value={destino} disabled={ocupado} onChange={ev => setDestino(ev.target.value)}>
                    <option value="dataset">{tr('Dataset de esta investigación')}</option>
                    {hipotesis.map(h => (
                      <option key={h.id} value={h.id}>{trp('Resultados experimentales: {t}', { t: h.titulo })}</option>
                    ))}
                  </select>
                </label>

                <div className="adjuntos-campo">
                  <span>{tr('Archivo')}</span>
                  {/* El <input type="file"> nativo no se puede estilar: va
                      oculto y lo abre el botón, que sí. */}
                  <input
                    ref={entrada}
                    type="file"
                    className="adjuntos-entrada"
                    disabled={ocupado}
                    onChange={ev => { setFichero(ev.target.files?.[0] ?? null); setAviso(''); }}
                  />
                  <div className="adjuntos-fichero">
                    <button type="button" className="btn btn-s" disabled={ocupado} onClick={() => entrada.current?.click()}>
                      <IconUpload size={15} />{fichero ? tr('Cambiar') : tr('Elegir archivo')}
                    </button>
                    <span className={fichero ? 'adjuntos-nombre' : 'adjuntos-nombre adjuntos-nombre-vacio'}>
                      {fichero ? fichero.name : tr('Ninguno elegido')}
                    </span>
                  </div>
                </div>

                <label className="adjuntos-casilla">
                  <input type="checkbox" checked={sintetico} disabled={ocupado} onChange={ev => setSintetico(ev.target.checked)} />
                  <span>{tr('Son datos sintéticos de prueba')}</span>
                </label>
              </>
            )}

            {aviso && <p className="adjuntos-aviso" role="status">{aviso}</p>}
          </div>

          <footer className="adjuntos-pie">
            <p>{tr('Los datasets conservan su libro de procedencia y requieren aprobación antes de analizarlos. Los resultados experimentales se contrastan con el prerregistro.')}</p>
            <div className="adjuntos-acciones">
              <button type="button" className="btn btn-s" disabled={ocupado} onClick={cerrar}>{tr('Cancelar')}</button>
              <button
                type="button"
                className="btn btn-primario btn-s"
                data-accion="guardar"
                disabled={!fichero || !investigacion || ocupado || disabled}
                onClick={() => void subir()}
              >
                {ocupado ? tr('Guardando…') : tr('Guardar archivo')}
              </button>
            </div>
          </footer>
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
