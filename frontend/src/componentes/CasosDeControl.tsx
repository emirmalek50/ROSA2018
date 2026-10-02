// Los 17 casos de control del RAG anterior: la pregunta, la respuesta que se
// espera y en qué estado está cada uno.
//
// Vivían en la pantalla de Calidad, que se retiró el 2 de octubre de 2026
// porque el resto de lo que enseñaba era de solo lectura y nadie la usaba.
// Esto se queda porque es la ÚNICA forma de ver y editar los casos, y sin
// casos aprobados las métricas de acuerdo del juez no significan nada.

import { useState } from 'react';

import { acciones } from '../datos/almacen';
import type { CasoControl } from '../datos/tipos';
import { CATEGORIA_CASO, ESTADO_CASO } from '../lib/etiquetas';
import { tr } from '../lib/idioma';
import { Chip, Seccion } from './piezas';

function Caso({ c }: { c: CasoControl }) {
  const [respuesta, setRespuesta] = useState(c.respuestaEsperada);
  return (
    <article className="tarjeta caso">
      <div className="caso-cabecera">
        <Chip>{CATEGORIA_CASO[c.categoria]}</Chip>
        {c.critico && <Chip tono="aviso">{tr("Importante")}</Chip>}
        <Chip tono={c.estado === 'aprobado' ? 'ok' : c.estado === 'descartado' ? 'mal' : undefined}>{ESTADO_CASO[c.estado]}</Chip>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          {(c.origen === 'generado' ? tr("Propuesto por el RAG") : tr("Escrito a mano"))}
        </span>
      </div>
      <p className="caso-pregunta">{c.pregunta}</p>
      <div className="campo">
        <label htmlFor={`resp-${c.clave}`}>{tr("Respuesta esperada")}</label>
        <textarea
          id={`resp-${c.clave}`}
          className="caso-respuesta"
          value={respuesta}
          onChange={(e) => setRespuesta(e.target.value)}
          onBlur={() => {
            if (respuesta.trim() === '') {
              setRespuesta(c.respuestaEsperada);
              return;
            }
            acciones.editarRespuestaCaso(c.clave, respuesta);
          }}
          disabled={c.estado === 'descartado'}
        />
        <small>{tr("Se guarda al salir del campo. Vaciarla no la borra: un caso sin respuesta no tiene criterio para juzgarse.")}</small>
      </div>
      <div className="acciones">
        {c.estado !== 'aprobado' && (
          <button type="button" className="btn btn-primario btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'aprobado')}>
            {tr("Aprobar")}
          </button>
        )}
        {c.estado !== 'descartado' && (
          <button type="button" className="btn btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'descartado')}>
            {tr("Descartar")}
          </button>
        )}
        {c.estado !== 'propuesto' && (
          <button type="button" className="btn btn-fantasma btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'propuesto')}>
            {tr("Volver a por revisar")}
          </button>
        )}
      </div>
    </article>
  );
}

export function CasosDeControl({ casos }: { casos: CasoControl[] }) {
  const [filtro, setFiltro] = useState<'propuesto' | 'aprobado' | 'descartado' | 'todos'>('propuesto');
  const visibles = filtro === 'todos' ? casos : casos.filter((c) => c.estado === filtro);
  const aprobados = casos.filter((c) => c.estado === 'aprobado').length;
  return (
    <Seccion
      titulo={tr("Casos de control")}
      nota={tr("Los 17 los propuso el RAG sobre otro corpus y ninguno está aprobado. Sirven para probar el ciclo; los del dominio del Alzheimer hay que escribirlos con el compañero. El juez se calibra con los aprobados: con cero, las métricas de acuerdo no significan nada.")}
      acciones={
        <div className="segmentos" role="group" aria-label={tr("Filtro de casos")}>
          {(['propuesto', 'aprobado', 'descartado', 'todos'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
              {f === 'todos' ? tr('Todos') : ESTADO_CASO[f]}
            </button>
          ))}
        </div>
      }
    >
      <p className="meta">{aprobados} / {casos.length} {tr("aprobados por una persona")}</p>
      {visibles.length === 0 ? <p className="meta">{tr("Ningún caso en este estado.")}</p> : visibles.map((c) => <Caso key={c.clave} c={c} />)}
    </Seccion>
  );
}
