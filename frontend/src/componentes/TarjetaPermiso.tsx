// Tarjeta de permiso, como en Claude Science: aparece en la corrida cada vez
// que ROSA2018 necesita un acceso nuevo, con el nombre exacto de lo que pide y
// los alcances elegibles. Anade lo que Claude Science no tiene: los
// argumentos de la accion editables antes de permitir (como Agent Inbox), la
// seleccion para aprobar varias de una vez, y la edad de la solicitud con
// aviso cuando supera la politica de esperas.

import { useState } from 'react';
import { motion } from 'motion/react';
import type { SolicitudPermiso } from '../datos/tipos';
import { ALCANCE, TIPO_PERMISO } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import { IconLock } from './icons';
import { Chip, Momento } from './piezas';
import { tr } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';

interface Props {
  solicitud: SolicitudPermiso;
  ahora: number;
  /** Horas de la politica de esperas: por encima se avisa. */
  horasEspera: number;
  seleccionada?: boolean;
  onSeleccionar?: (v: boolean) => void;
  onResolver: (decision: 'conceder' | 'denegar', alcance: SolicitudPermiso['alcances'][number] | null, argumentos: Record<string, string>) => void;
}

export function TarjetaPermiso({ solicitud, ahora, horasEspera, seleccionada, onSeleccionar, onResolver }: Props) {
  const resuelta = solicitud.estado !== 'pendiente';
  const reducido = useMovimientoReducido();
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(solicitud.argumentos.map((a) => [a.nombre, a.valor])));
  const esperaMs = ahora - solicitud.creadaEn;
  const tarde = !resuelta && esperaMs > horasEspera * 3_600_000;
  return (
    <article className={`permiso permiso-${solicitud.estado} ${resuelta ? 'permiso-resuelto' : ''} ${tarde ? 'permiso-tarde' : ''}`} aria-live="polite">
      <div className="permiso-cabecera">
        {!resuelta && onSeleccionar && (
          <input type="checkbox" className="permiso-check" checked={seleccionada ?? false} onChange={(e) => onSeleccionar(e.target.checked)} aria-label={tr("Seleccionar para aprobar en lote")} />
        )}
        <IconLock size={16} />
        <div style={{ flex: 1 }}>
          <h4>{solicitud.titulo}</h4>
          <p>{solicitud.detalle}</p>
        </div>
      </div>
      <div className="acciones">
        <span className="permiso-recurso">{solicitud.recurso}</span>
        <Chip>{TIPO_PERMISO[solicitud.tipo]}</Chip>
        <span className="meta">
          Pedido <Momento t={solicitud.creadaEn} ahora={ahora} />
        </span>
        {!resuelta && esperaMs > 60_000 && (
          <Chip tono={tarde ? 'mal' : undefined} title={tarde ? `Supera las ${horasEspera} h de la política de esperas` : undefined}>
            esperando {formatearDuracion(esperaMs)}
          </Chip>
        )}
      </div>
      {solicitud.argumentos.length > 0 && (
        <dl className="permiso-argumentos">
          {solicitud.argumentos.map((a) => (
            <div key={a.nombre}>
              <dt>{a.nombre}</dt>
              <dd>
                {!resuelta && a.editable ? (
                  <input className="entrada entrada-s" value={valores[a.nombre] ?? a.valor} onChange={(e) => setValores({ ...valores, [a.nombre]: e.target.value })} aria-label={a.nombre} />
                ) : (
                  <span className="mono">{a.valor}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {resuelta ? (
        // La resolucion entra animada: lo que cambia es el estado de algo que
        // tocaba el mundo real, y conviene que se vea que cambio.
        <motion.div
          className="acciones"
          initial={reducido ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.media }}
        >
          <Chip tono={solicitud.estado === 'concedida' ? 'ok' : 'mal'}>
            {solicitud.estado === 'concedida' ? `Concedido: ${solicitud.alcanceConcedido ? ALCANCE[solicitud.alcanceConcedido] : ''}` : 'Denegado'}
          </Chip>
          {solicitud.resueltaEn !== null && (
            <span className="meta">
              <Momento t={solicitud.resueltaEn} ahora={ahora} />
            </span>
          )}
        </motion.div>
      ) : (
        <div className="permiso-alcances">
          <span className="meta">Permitir:</span>
          {solicitud.alcances.map((a) => (
            <button key={a} type="button" className="btn btn-s" onClick={() => onResolver('conceder', a, valores)}>
              {ALCANCE[a]}
            </button>
          ))}
          <button type="button" className="btn btn-s btn-peligro" onClick={() => onResolver('denegar', null, valores)}>
            Denegar
          </button>
        </div>
      )}
    </article>
  );
}
