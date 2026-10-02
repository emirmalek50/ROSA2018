// Lo que ROSA2018 va pensando y haciendo para contestar, en una línea de
// tiempo como la de Kimi (Emir, 2 de octubre de 2026): cada vuelta del bucle
// (piensa, elige una herramienta, la usa, vuelve a pensar) es una fila, según
// ocurre, unidas por una línea punteada.
//
// De dónde sale, que es lo que hace que se pueda fiar uno de ella: el
// servidor escucha el bucle del chat con los callbacks de DSPy
// (rosa/razonamiento.py) y el navegador pide los pasos mientras dura. Nada se
// dibuja que no haya pasado.
//
// Las dos clases de fila no valen lo mismo, y se pintan distinto a propósito:
// - «Pensando» es lo que el modelo DICE que va a hacer. Es útil para seguirle
//   el hilo, pero no es un hecho comprobado.
// - La herramienta es una llamada real, con lo que se le pidió y lo que pasó.
//   Si falló se dice «no pude comprobar», nunca «sin resultados».

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { IconBulb, IconChevronDown, IconGlobe, IconLayers, IconMessage, IconSearch } from './icons';
import { Shimmer } from './Shimmer';
import type { PasoRazonamiento } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';

const ICONO: Record<NonNullable<PasoRazonamiento['familia']>, (p: { size?: number }) => JSX.Element> = {
  base: IconGlobe,
  mundo: IconLayers,
  proyecto: IconSearch,
  cuestiones: IconMessage,
  otra: IconSearch,
};

/** Lo que se le pidió a una herramienta, en una frase: el argumento que dice
 *  QUÉ se buscó. Los demás (límites, años) van al desplegar. */
function loQueBusco(args: Record<string, string> | undefined): string {
  if (!args) return '';
  const preferidos = ['consulta', 'query', 'pregunta', 'tema', 'term', 'termino', 'texto', 'gen', 'diana', 'simbolo'];
  for (const k of preferidos) if (args[k]) return args[k];
  return Object.values(args)[0] ?? '';
}

/** «el modelo de mundo» al principio de una fila se lee mal: va con mayúscula
 *  como cualquier etiqueta. Solo la primera letra, que «PubMed» se queda. */
function etiqueta(t: string): string {
  return t ? t[0]!.toLocaleUpperCase() + t.slice(1) : t;
}

/** La primera frase de un pensamiento: es lo que se lee en la fila, como el
 *  resumen de Kimi. El resto se ve al desplegar. */
function primeraFrase(t: string): string {
  const m = t.match(/^(.{20,160}?[.!?])(\s|$)/);
  return (m ? m[1]! : t.slice(0, 140)).trim();
}

function Fila({ p, ahora, ultimo, enMarcha, orden }: { p: PasoRazonamiento; ahora: number; ultimo: boolean; enMarcha: boolean; orden: number }) {
  const reducido = useMovimientoReducido();
  const [abierta, setAbierta] = useState(false);
  const esPensar = p.tipo === 'pensar';
  const corriendo = !esPensar && (p.fin === null || p.fin === undefined) && enMarcha;
  // El último pensamiento, mientras aún no ha llegado la siguiente fila,
  // también está «en marcha»: es lo que está haciendo ahora.
  const pensandoAhora = esPensar && ultimo && enMarcha && !p.cierra;
  const Icono = esPensar ? IconBulb : ICONO[p.familia ?? 'otra'];
  const fallo = !esPensar && !!p.error;
  const ms = !esPensar && p.fin ? p.fin - p.inicio : corriendo ? ahora - p.inicio : null;
  const texto = esPensar ? p.texto ?? '' : loQueBusco(p.argumentos);
  const hayMas = esPensar ? (p.texto ?? '').length > primeraFrase(p.texto ?? '').length : Object.keys(p.argumentos ?? {}).length > 0 || !!p.resumen || fallo;

  return (
    <motion.li
      className={`razon-fila razon-${p.tipo} ${corriendo || pensandoAhora ? 'razon-viva' : ''} ${fallo ? 'razon-fallo' : ''}`.trim()}
      initial={reducido ? { opacity: 0 } : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.media, delay: enMarcha || reducido ? 0 : Math.min(orden, 10) * 0.05 }}
    >
      <span className="razon-carril" aria-hidden="true">
        <span className="razon-icono">
          <Icono size={15} />
        </span>
        {!ultimo && <i className="razon-linea" />}
      </span>
      <div className="razon-cuerpo">
        <button type="button" className="razon-cabeza" onClick={() => hayMas && setAbierta((v) => !v)} aria-expanded={hayMas ? abierta : undefined} disabled={!hayMas}>
          <span className="razon-etiqueta">
            {esPensar ? (
              pensandoAhora ? <Shimmer>{tr('Pensando')}</Shimmer> : p.cierra ? tr('Listo para responder') : tr('Pensó')
            ) : corriendo ? (
              <Shimmer>{etiqueta(p.nombre ?? p.herramienta ?? '')}</Shimmer>
            ) : (
              etiqueta(p.nombre ?? p.herramienta ?? '')
            )}
          </span>
          {texto && (
            <>
              <i className="razon-sep" aria-hidden="true" />
              <span className="razon-texto">{esPensar ? primeraFrase(texto) : texto}</span>
            </>
          )}
          {!esPensar && (
            <span className={`razon-dato ${fallo ? 'tono-aviso' : ''}`.trim()}>
              {fallo ? tr('no pude comprobar') : corriendo ? '' : tr('listo')}
              {ms !== null && ms > 0 && <span className="razon-ms"> · {formatearDuracion(ms)}</span>}
            </span>
          )}
          {hayMas && <IconChevronDown size={13} className={`razon-flecha ${abierta ? 'razon-flecha-abierta' : ''}`} />}
        </button>
        <AnimatePresence initial={false}>
          {abierta && (
            <motion.div
              className="razon-detalle"
              initial={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: DUR.rapida }}
            >
              {esPensar ? (
                <>
                  <p>{p.texto}</p>
                  <p className="meta">{tr('Es lo que el modelo dice que va a hacer, no un hecho comprobado.')}</p>
                </>
              ) : (
                <>
                  {Object.entries(p.argumentos ?? {}).map(([k, v]) => (
                    <p key={k} className="razon-arg">
                      <span>{k}</span> {v}
                    </p>
                  ))}
                  {fallo ? (
                    <p className="tono-aviso">
                      {p.error} <span className="meta">{tr('No es «sin resultados»: la consulta no llegó a mirarse.')}</span>
                    </p>
                  ) : (
                    p.resumen && <p className="meta">{p.resumen}</p>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

/** La línea de tiempo entera. `enMarcha`: la pregunta sigue en vuelo, así que
 *  el último paso late y, si aún no hay ninguno, se dice que está empezando. */
export function Razonamiento({ pasos, ahora, enMarcha = false, plegable = false }: { pasos: PasoRazonamiento[]; ahora: number; enMarcha?: boolean; plegable?: boolean }) {
  const [abierto, setAbierto] = useState(!plegable);
  const herramientas = pasos.filter((p) => p.tipo === 'herramienta');
  const fallidas = herramientas.filter((p) => p.error).length;

  if (pasos.length === 0) {
    if (!enMarcha) return null;
    return (
      <ol className="razon">
        <li className="razon-fila razon-pensar razon-viva">
          <span className="razon-carril" aria-hidden="true">
            <span className="razon-icono">
              <IconBulb size={15} />
            </span>
          </span>
          <div className="razon-cuerpo">
            <span className="razon-cabeza">
              <span className="razon-etiqueta">
                <Shimmer>{tr('Pensando')}</Shimmer>
              </span>
              <i className="razon-sep" aria-hidden="true" />
              <span className="razon-texto">{tr('leyendo la pregunta y lo que ya sabe')}</span>
            </span>
          </div>
        </li>
      </ol>
    );
  }

  // Ya contestada, plegada en una línea como el «Used 1 tool» de Kimi: se ve
  // que hubo trabajo detrás sin tapar la respuesta.
  if (plegable && !abierto) {
    return (
      <button type="button" className="razon-resumen" onClick={() => setAbierto(true)}>
        <IconBulb size={14} />
        <span>
          {herramientas.length === 1 ? tr('Usó 1 herramienta') : trp('Usó {n} herramientas', { n: herramientas.length })}
          {fallidas > 0 && <span className="tono-aviso"> · {trp('{n} sin poder comprobar', { n: fallidas })}</span>}
          {' · '}
          {tr('ver cómo lo pensó')}
        </span>
        <IconChevronDown size={13} />
      </button>
    );
  }

  return (
    <div className="razon-bloque">
      {plegable && (
        <button type="button" className="razon-resumen razon-resumen-abierto" onClick={() => setAbierto(false)}>
          <IconBulb size={14} />
          <span>{tr('Cómo lo pensó')}</span>
          <IconChevronDown size={13} className="razon-flecha-abierta" />
        </button>
      )}
      <ol className="razon" aria-live={enMarcha ? 'polite' : undefined}>
        {pasos.map((p, i) => (
          <Fila key={p.id} p={p} ahora={ahora} ultimo={i === pasos.length - 1} enMarcha={enMarcha} orden={i} />
        ))}
      </ol>
    </div>
  );
}
