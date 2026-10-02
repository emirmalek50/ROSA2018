// "Mientras no estabas": lo que paso desde la ultima visita, con cada linea
// enlazada a su pantalla. Se ensena al entrar y se cierra con "Visto", que
// marca la visita. El mismo texto es lo que se manda por Slack o correo.

import { useState } from 'react';
import type { Digest } from '../lib/digest';
import { digestComoTexto } from '../lib/digest';
import { TIPO_EVENTO, mostrarTexto } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import { IconCheck, IconCopy } from './icons';
import { Chip, Momento } from './piezas';
import { tr, trp } from '../lib/idioma';

export function Resumen({ d, titulo, ahora, onVisto }: { d: Digest; titulo: string; ahora: number; onVisto: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const [todos, setTodos] = useState(false);
  if (!d.hayNovedades) return null;
  const ventana = d.desde !== null ? trp("desde tu última visita, hace {v}", { v: formatearDuracion(ahora - d.desde) }) : tr('los últimos siete días (todavía no habías pulsado «Visto»)');
  const visibles = todos ? d.eventos : d.eventos.slice(0, 5);
  return (
    <section className="resumen" aria-label={trp("Mientras no estabas: {titulo}", { titulo })}>
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>
            {tr("Mientras no estabas")} <span className="resumen-titulo">· {titulo}</span>
          </h3>
          <p className="meta">{trp("Lo que cambió {ventana}. «Visto» cierra la tarjeta hasta que haya algo nuevo; lo que te espera sigue en la tarjeta de cada investigación.", { ventana })}</p>
        </div>
        <div className="acciones">
          <button
            type="button"
            className="btn btn-fantasma btn-s"
            onClick={() => {
              void navigator.clipboard?.writeText(digestComoTexto(d, titulo)).then(() => setCopiado(true));
              window.setTimeout(() => setCopiado(false), 2000);
            }}
            title={tr("Copiar como texto (es lo que se manda por Slack o correo)")}
          >
            {copiado ? <IconCheck size={13} /> : <IconCopy size={13} />} {copiado ? 'Copiado' : 'Copiar'}
          </button>
          <button type="button" className="btn btn-s" onClick={onVisto}>
            {tr("Visto")}
          </button>
        </div>
      </div>
      <ul className="resumen-lineas">
        {d.lineas.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {d.eventos.length > 0 && (
        <ol className="resumen-eventos">
          {visibles.map((e) => (
            <li key={e.id}>
              <Chip tono={e.tipo === 'incidencia' ? 'mal' : e.tipo === 'permiso_pendiente' || e.tipo === 'presupuesto' || e.tipo === 'modelo_sin_respuesta' ? 'aviso' : e.tipo === 'modelo_recuperado' ? 'ok' : undefined}>{TIPO_EVENTO[e.tipo]}</Chip>
              {e.ruta ? (
                <a className="enlace" href={e.ruta}>
                  {mostrarTexto(e.texto)}
                </a>
              ) : (
                <span>{mostrarTexto(e.texto)}</span>
              )}
              <span className="meta">
                <Momento t={e.t} ahora={ahora} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {d.eventos.length > 5 && (
        <button type="button" className="enlace" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setTodos((v) => !v)}>
          {todos ? tr('Ver menos') : trp("Ver los {eventos} eventos", { eventos: d.eventos.length })}
        </button>
      )}
    </section>
  );
}
