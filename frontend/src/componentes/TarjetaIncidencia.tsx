// Incidencia: algo que impide seguir y necesita a una persona. Un modelo que
// devolvio vacio con content-filter, una clave de conector caducada. Claude
// Science lo resolvio en agosto de 2026 con un aviso corto y cambio de modelo
// en un clic, y con "Sign-in expired, Reconnect". Aqui es una tarjeta con la
// alternativa que ROSA2018 propone y un campo para dar otra.

import { useState } from 'react';
import type { Incidencia } from '../datos/tipos';
import { TIPO_INCIDENCIA } from '../lib/etiquetas';
import { IconAlert } from './icons';
import { Chip, Momento } from './piezas';
import { tr } from '../lib/idioma';

export function TarjetaIncidencia({ incidencia, ahora, onResolver }: { incidencia: Incidencia; ahora: number; onResolver: (resolucion: string) => void }) {
  const [otra, setOtra] = useState('');
  const resuelta = incidencia.estado === 'resuelta';
  return (
    <article className={`incidencia ${resuelta ? 'incidencia-resuelta' : ''}`}>
      <div className="permiso-cabecera">
        <IconAlert size={16} />
        <div style={{ flex: 1 }}>
          <h4>{incidencia.titulo}</h4>
          <p>{incidencia.detalle}</p>
        </div>
      </div>
      <div className="acciones">
        <span className="permiso-recurso">{incidencia.recurso}</span>
        <Chip tono="aviso">{TIPO_INCIDENCIA[incidencia.tipo]}</Chip>
        <span className="meta">
          <Momento t={incidencia.creadaEn} ahora={ahora} />
        </span>
      </div>
      {resuelta ? (
        <div className="acciones">
          <Chip tono="ok">{tr("Resuelta:")} {incidencia.resolucion}</Chip>
          {incidencia.resueltaEn !== null && (
            <span className="meta">
              <Momento t={incidencia.resueltaEn} ahora={ahora} />
            </span>
          )}
        </div>
      ) : (
        <div className="acciones" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 8 }}>
          {incidencia.alternativa && (
            <button type="button" className="btn btn-primario" style={{ alignSelf: 'flex-start' }} onClick={() => onResolver(incidencia.alternativa ?? '')}>
              {incidencia.alternativa}
            </button>
          )}
          <div className="dirigir">
            <input className="entrada" value={otra} placeholder={tr("Otra resolución (por ejemplo: saltar ese artículo y anotarlo)")} onChange={(e) => setOtra(e.target.value)} aria-label={tr("Otra resolución")} />
            <button type="button" className="btn" disabled={otra.trim() === ''} onClick={() => onResolver(otra)}>
              {tr("Aplicar")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
