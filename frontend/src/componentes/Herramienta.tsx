// Cada llamada a una base pública como una tarjeta dentro del hilo, en vez de
// una fila de tabla. La idea viene del componente `tool` de AI Elements de
// Vercel; la implementación es de ROSA2018, con su CSS y sus piezas, porque
// aquel se apoya en Tailwind y en ocho primitivas de shadcn que este frontend
// no usa (2 de octubre de 2026, decisión de Emir).
//
// Lo que enseña y por qué, que es donde se aparta del original: ROSA2018
// registra de cada consulta más cosas que un «tool call» cualquiera, y son
// justo las que permiten comprobarla desde fuera. El invariante (la
// comprobación que Claude Science exige de toda recuperación material), la
// versión de la base, los ids que devolvió y cuánto tardó.
//
// La regla que manda aquí: un error o un tiempo agotado se dicen como «no
// pude comprobar», NUNCA como «sin resultados». Son estados distintos y
// confundirlos es el fallo más caro de toda la interfaz: hace creer que se
// miró y no había, cuando en realidad no se llegó a mirar.

import { useState } from 'react';

import { Chip, Momento } from './piezas';
import type { ConsultaBase } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { tr, traducido, trp } from '../lib/idioma';

/** En qué acabó la llamada. `sin_respuesta` no es `vacia`: la primera es que
 *  no se pudo mirar, la segunda es que se miró y no había. */
export type EstadoLlamada = 'bien' | 'vacia' | 'sin_respuesta';

const ESTADO = traducido({
  bien: { etiqueta: 'respondió', tono: 'ok' as const, nota: 'La base respondió y devolvió resultados.' },
  vacia: {
    etiqueta: 'sin resultados',
    tono: 'borde' as const,
    nota: 'La base respondió y no tiene nada para esta consulta. Esto sí es una ausencia.',
  },
  sin_respuesta: {
    etiqueta: 'no pude comprobar',
    tono: 'aviso' as const,
    nota: 'La base no respondió o falló la consulta. No quiere decir que no haya: quiere decir que no se pudo mirar.',
  },
});

export function estadoDe(c: Pick<ConsultaBase, 'error' | 'n' | 'ids'>): EstadoLlamada {
  if (c.error) return 'sin_respuesta';
  // `n` nulo es «la base no dijo cuántos», no «cero». Con ids devueltos, hubo
  // resultados aunque no venga el conteo.
  if (c.n === null || c.n === undefined) return c.ids.length > 0 ? 'bien' : 'sin_respuesta';
  return c.n > 0 ? 'bien' : 'vacia';
}

function Argumentos({ args }: { args: Record<string, string> }) {
  const pares = Object.entries(args ?? {});
  if (pares.length === 0) return <p className="meta">{tr('Sin argumentos registrados.')}</p>;
  return (
    <dl className="llamada-args">
      {pares.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Una llamada. Cerrada enseña con qué base, cómo acabó y cuánto tardó;
 *  abierta, los argumentos exactos, lo que devolvió y el invariante. */
export function Herramienta({ c, ahora, abiertaDeInicio = false }: { c: ConsultaBase; ahora: number; abiertaDeInicio?: boolean }) {
  const [abierta, setAbierta] = useState(abiertaDeInicio);
  const e = estadoDe(c);
  const est = ESTADO[e];
  return (
    <div className={`llamada llamada-${e}`}>
      <button type="button" className="llamada-cabeza" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
        <span className="llamada-nombre">
          <strong>{c.fuente || c.herramienta}</strong>
          {c.fuente && c.herramienta && c.fuente !== c.herramienta && <span className="meta llamada-fn">{c.herramienta}</span>}
        </span>
        <Chip tono={est.tono} title={est.nota}>
          {est.etiqueta}
        </Chip>
        <span className="meta llamada-tiempo">{c.ms > 0 ? formatearDuracion(c.ms) : ''}</span>
      </button>

      {abierta && (
        <div className="llamada-cuerpo">
          <section className="llamada-bloque">
            <h4>{tr('Lo que se le pidió')}</h4>
            <Argumentos args={c.argumentos} />
          </section>

          <section className="llamada-bloque">
            <h4>{tr('Lo que devolvió')}</h4>
            {e === 'sin_respuesta' ? (
              <p className="tono-aviso">
                {c.error || tr('La base no respondió.')}{' '}
                <span className="meta">{tr('No es «sin resultados»: la consulta no llegó a mirarse.')}</span>
              </p>
            ) : (
              <>
                <p>
                  {c.n === 1 ? tr('1 resultado') : trp('{n} resultados', { n: c.n ?? 0 })}
                  {c.version && <span className="meta"> · {trp('versión {v}', { v: c.version })}</span>}
                </p>
                {c.ids.length > 0 && (
                  <p className="meta llamada-ids">
                    {c.ids.slice(0, 8).join(', ')}
                    {c.ids.length > 8 && ` ${trp('y {n} más', { n: c.ids.length - 8 })}`}
                  </p>
                )}
                {c.resumen && <p className="meta">{c.resumen}</p>}
              </>
            )}
          </section>

          <section className="llamada-bloque">
            <h4>{tr('Invariante')}</h4>
            {c.invariante ? (
              <p className={c.invariante.ok ? '' : 'tono-aviso'}>
                <Chip tono={c.invariante.ok ? 'ok' : 'aviso'}>{(c.invariante.ok ? tr("se cumple") : tr("no se cumple"))}</Chip>{' '}
                {c.invariante.detalle}
              </p>
            ) : (
              <p className="meta">
                {tr('Sin invariante registrado.')}{' '}
                {tr('Es la comprobación de que lo que volvió es lo que se pidió; sin ella la consulta no se puede dar por buena desde fuera.')}
              </p>
            )}
          </section>

          <p className="meta llamada-pie">
            <Momento t={c.fecha} ahora={ahora} />
          </p>
        </div>
      )}
    </div>
  );
}

/** Todas las llamadas de una respuesta, con un recuento honesto arriba: las
 *  que no respondieron van aparte y NO se suman a «sin resultados». */
export function Herramientas({ consultas, ahora }: { consultas: ConsultaBase[]; ahora: number }) {
  const cs = [...(consultas ?? [])].sort((a, b) => a.fecha - b.fecha);
  if (cs.length === 0) return null;
  const sinRespuesta = cs.filter((c) => estadoDe(c) === 'sin_respuesta').length;
  const conCero = cs.filter((c) => estadoDe(c) === 'vacia').length;
  return (
    <div className="llamadas">
      <p className="meta llamadas-cuenta">
        {cs.length === 1 ? tr('1 consulta') : trp('{n} consultas', { n: cs.length })}
        {conCero > 0 && ` · ${trp('{n} sin resultados', { n: conCero })}`}
        {sinRespuesta > 0 && (
          <>
            {' · '}
            <span className="tono-aviso">{trp('{n} no pude comprobar', { n: sinRespuesta })}</span>
          </>
        )}
      </p>
      {cs.map((c) => (
        <Herramienta key={c.id} c={c} ahora={ahora} abiertaDeInicio={cs.length === 1} />
      ))}
    </div>
  );
}
