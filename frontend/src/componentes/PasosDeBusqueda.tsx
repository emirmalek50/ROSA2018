// Lo que ROSA2018 fue haciendo para contestar, paso a paso y en orden. La idea
// es del componente `chain-of-thought` de AI Elements de Vercel: una columna
// de pasos unidos por una línea, cada uno con su estado y lo que encontró.
//
// Dónde se aparta, y es lo que hace que valga la pena: aquel enseña el
// razonamiento que el modelo DICE que hizo. Este enseña lo que ROSA2018 HIZO
// de verdad, porque cada paso es una consulta registrada con su base, su
// resultado y su tiempo. Un paso no se puede inventar: o hay registro o no
// sale.
//
// La regla de siempre manda en el estado de cada paso: una base que no
// respondió es «no pude comprobar», no «sin resultados». Aquí se ve además en
// el color del punto, para poder recorrer la columna sin leer.

import { AnimatePresence, motion } from 'motion/react';

import { Shimmer } from './Shimmer';
import type { ConsultaBase } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { estadoDe, type EstadoLlamada } from './Herramienta';

export interface Paso {
  id: string;
  /** La base o la herramienta: lo que se consultó. */
  titulo: string;
  /** Qué salió de ahí, en una frase. */
  nota?: string;
  estado: EstadoLlamada | 'en_marcha';
  ms?: number;
  /** Lo que devolvió, como etiquetas: ids, nombres, lo que sea. */
  hallazgos?: string[];
}

/** Los pasos de una respuesta ya dada, uno por consulta registrada. */
export function pasosDeConsultas(consultas: ConsultaBase[]): Paso[] {
  return [...(consultas ?? [])]
    .sort((a, b) => a.fecha - b.fecha)
    .map((c): Paso => {
      const e = estadoDe(c);
      // La columna es el resumen y las tarjetas de abajo el detalle. Si aquí
      // se repiten los ids, se lee dos veces lo mismo y ninguna de las dos
      // vistas aporta. Aquí solo: qué se consultó, cómo fue y cuánto tardó.
      const nota =
        e === 'sin_respuesta'
          ? c.error || tr('No respondió.')
          : c.n !== null && c.n !== undefined && c.n > 0
            ? (c.n === 1 ? tr('1 resultado') : trp('{n} resultados', { n: c.n }))
            : undefined;
      return { id: c.id, titulo: c.fuente || c.herramienta, nota, estado: e, ms: c.ms };
    });
}

const PUNTO: Record<Paso['estado'], string> = {
  bien: 'rastro-bien',
  vacia: 'rastro-vacia',
  sin_respuesta: 'rastro-sin-respuesta',
  en_marcha: 'rastro-en-marcha',
};

function UnPaso({ p, ultimo, orden }: { p: Paso; ultimo: boolean; orden: number }) {
  const reducido = useMovimientoReducido();
  return (
    <motion.li
      className={`rastro-paso ${PUNTO[p.estado]}`}
      initial={reducido ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      // Uno tras otro: se lee como la secuencia que fue, no como una lista.
      transition={{ duration: DUR.media, delay: reducido ? 0 : Math.min(orden, 8) * 0.07 }}
    >
      <span className="rastro-carril" aria-hidden="true">
        <i className="rastro-punto" />
        {!ultimo && <i className="rastro-linea" />}
      </span>
      <span className="rastro-cuerpo">
        <span className="rastro-titulo">
          {p.estado === 'en_marcha' ? <Shimmer>{p.titulo}</Shimmer> : p.titulo}
          {p.ms !== undefined && p.ms > 0 && <span className="meta rastro-tiempo">{formatearDuracion(p.ms)}</span>}
        </span>
        {p.estado === 'sin_respuesta' && (
          <span className="rastro-nota tono-aviso">
            {p.nota || tr('No respondió.')} <span className="meta">{tr('No es «sin resultados».')}</span>
          </span>
        )}
        {p.estado !== 'sin_respuesta' && p.nota && <span className="rastro-nota meta">{p.nota}</span>}
        {p.hallazgos && p.hallazgos.length > 0 && (
          <span className="rastro-hallazgos">
            {p.hallazgos.map((h) => (
              <span className="rastro-hallazgo" key={h} title={h}>
                {h.length > 28 ? `${h.slice(0, 26)}…` : h}
              </span>
            ))}
          </span>
        )}
      </span>
    </motion.li>
  );
}

export function PasosDeBusqueda({ pasos, titulo }: { pasos: Paso[]; titulo?: string }) {
  if (pasos.length === 0) return null;
  const enMarcha = pasos.some((p) => p.estado === 'en_marcha');
  return (
    <div className="rastro-pasos">
      <p className="mundo-ceja rastro-ceja">
        {titulo ?? (enMarcha ? tr('Lo que está haciendo') : trp('Lo que hizo · {n} pasos', { n: pasos.length }))}
      </p>
      <ol className="rastro-lista">
        <AnimatePresence initial={false}>
          {pasos.map((p, i) => (
            <UnPaso key={p.id} p={p} ultimo={i === pasos.length - 1} orden={i} />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
