// Los hallazgos del revisor como tarjetas bajo la hipotesis, con su estado.
// Mas de tres ensenan los tres primeros y "mostrar todo"; al pulsar uno se ve
// el razonamiento completo y, si ROSA2018 ya lo atendio, su respuesta.

import { useState } from 'react';
import type { HallazgoRevisor } from '../datos/tipos';
import { ESTADO_HALLAZGO, TIPO_HALLAZGO } from '../lib/etiquetas';
import { hallazgosVisibles } from '../lib/hipotesis';
import { IconChevronDown } from './icons';
import { Chip } from './piezas';
import { tr } from '../lib/idioma';

function TarjetaHallazgo({ h }: { h: HallazgoRevisor }) {
  const [abierto, setAbierto] = useState(h.estado === 'abierto');
  const tono = h.estado === 'abierto' ? 'mal' : h.estado === 'atendido' ? 'ok' : undefined;
  return (
    <li className={`hallazgo hallazgo-${h.estado}`}>
      <button type="button" className="hallazgo-cabecera" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <strong>{h.resumen}</strong>
        <Chip tono={tono}>{ESTADO_HALLAZGO[h.estado]}</Chip>
        <span style={{ transform: abierto ? 'rotate(180deg)' : 'none', display: 'inline-flex', color: 'var(--text-2)' }}>
          <IconChevronDown size={12} />
        </span>
      </button>
      <span className="hallazgo-tipo">{TIPO_HALLAZGO[h.tipo]}</span>
      {abierto && (
        <>
          <p className="hallazgo-razon">{h.razonamiento}</p>
          {h.respuestaDeRosa !== null && (
            <div className="hallazgo-respuesta">
              <span>ROSA2018</span>
              <p>{h.respuestaDeRosa}</p>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function Revisor({ hallazgos }: { hallazgos: HallazgoRevisor[] }) {
  const [todo, setTodo] = useState(false);
  if (hallazgos.length === 0) return <p className="meta">{tr("El revisor no encontró nada que objetar. Eso no sustituye a tu lectura.")}</p>;
  const { visibles, ocultos } = hallazgosVisibles(hallazgos, todo);
  return (
    <div className="hallazgos">
      <ul className="hallazgos">
        {visibles.map((h) => (
          <TarjetaHallazgo key={h.id} h={h} />
        ))}
      </ul>
      {ocultos > 0 && (
        <button type="button" className="enlace" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setTodo(true)}>
          {tr("Mostrar todo (")}{ocultos} mas)
        </button>
      )}
    </div>
  );
}
