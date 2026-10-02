// Cuánto del contexto del cerebro va ocupado, como el anillo del componente
// `context` de AI Elements de Vercel: una cifra pequeña con su anillo, y al
// pasar por encima el desglose.
//
// El dato ya existía (`corrida.contexto`, con los tokens usados, el límite y
// las veces que ROSA2018 ha tenido que resumir el historial) pero estaba como
// una cifra suelta entre otras ocho, donde no se mira.
//
// Por qué importa y no es decoración: cuando el contexto se llena, ROSA2018
// COMPACTA, es decir, resume lo que ya había para que quepa lo nuevo. Un
// resumen pierde detalle, y eso es justo lo que no se puede perder en una
// cadena de evidencia. Las compactaciones salen aquí a propósito: son la
// señal de que algo se está resumiendo.

import { useState } from 'react';
import { motion } from 'motion/react';

import type { Contexto as DatosContexto } from '../datos/tipos';
import { formatearCompacto, formatearPorcentaje } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { Momento } from './piezas';

const R = 10;
const LARGO = 2 * Math.PI * R;

/** El anillo. Se pinta con un trazo discontinuo al que se le mueve el
 *  desfase: así el arco crece sin dibujar ningún camino a mano. */
function Anillo({ fraccion }: { fraccion: number }) {
  const reducido = useMovimientoReducido();
  const f = Math.max(0, Math.min(1, fraccion));
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="ctx-anillo">
      <circle cx="12" cy="12" r={R} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.22" />
      <motion.circle
        cx="12"
        cy="12"
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={LARGO}
        initial={reducido ? false : { strokeDashoffset: LARGO }}
        animate={{ strokeDashoffset: LARGO * (1 - f) }}
        transition={{ duration: reducido ? 0 : DUR.lenta, ease: 'easeOut' }}
        style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
      />
    </svg>
  );
}

export function Contexto({ c, ahora }: { c: DatosContexto; ahora: number }) {
  const [abierto, setAbierto] = useState(false);
  const reducido = useMovimientoReducido();
  const limite = c.tokensLimite > 0 ? c.tokensLimite : 1;
  const f = c.tokensUsados / limite;
  // Lleno no es un error, pero conviene verlo venir: a partir de tres cuartos
  // la siguiente iteración larga va a compactar.
  const tono = f >= 0.9 ? 'ctx-lleno' : f >= 0.75 ? 'ctx-alto' : '';
  return (
    <span
      className={`ctx ${tono}`.trim()}
      onMouseEnter={() => setAbierto(true)}
      onMouseLeave={() => setAbierto(false)}
      onFocus={() => setAbierto(true)}
      onBlur={() => setAbierto(false)}
    >
      <button type="button" className="ctx-boton" aria-expanded={abierto} aria-label={tr('Contexto del cerebro ocupado')}>
        <span className="ctx-pct">{formatearPorcentaje(f)}</span>
        <Anillo fraccion={f} />
      </button>
      {abierto && (
        <motion.span
          className="ctx-ficha"
          role="status"
          initial={reducido ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.rapida }}
        >
          <span className="ctx-fila">
            <span>{tr('Contexto del cerebro')}</span>
            <span className="ctx-cifra">
              {formatearCompacto(c.tokensUsados)} / {formatearCompacto(c.tokensLimite)}
            </span>
          </span>
          <span className="ctx-barra" aria-hidden="true">
            <motion.i
              initial={reducido ? false : { scaleX: 0 }}
              animate={{ scaleX: Math.min(1, f) }}
              transition={{ duration: reducido ? 0 : DUR.lenta, ease: 'easeOut' }}
            />
          </span>
          {c.tokensMaximo !== undefined && c.tokensMaximo > 0 && (
            <span className="ctx-fila meta">
              <span>{tr('El prompt más largo de la corrida')}</span>
              <span className="ctx-cifra">{formatearCompacto(c.tokensMaximo)}</span>
            </span>
          )}
          <span className="ctx-nota">
            {c.compactaciones === 0
              ? tr('Todavía no ha hecho falta resumir el historial: no se ha perdido detalle.')
              : trp('Resumió el historial {n} veces para que cupiera lo nuevo. Un resumen pierde detalle.', { n: c.compactaciones })}
            {c.ultimaCompactacion !== null && (
              <>
                {' '}
                <Momento t={c.ultimaCompactacion} ahora={ahora} />
              </>
            )}
          </span>
        </motion.span>
      )}
    </span>
  );
}
