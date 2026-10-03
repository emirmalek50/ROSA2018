// Lo que ROSA2018 va pensando y haciendo para contestar, como la línea de
// tiempo de Kimi (Emir, 2 de octubre de 2026, dos veces: «exactamente así»).
//
// Mirado fila a fila en las capturas de Kimi, esto es lo que hay que
// reproducir y por qué:
//
// - Un HILO: una línea vertical punteada a la izquierda une los pasos. Cada
//   paso es UNA línea: icono, etiqueta en gris claro, un separador vertical
//   fino y el detalle en gris medio (legible, no apagado).
// - La herramienta dice de DÓNDE y CUÁNTO trajo: «Fetch URLs | ●●● 6 pages».
//   Los círculos son las fuentes. Aquí: la base consultada y sus resultados,
//   que vienen del servidor (rosa/razonamiento.py, `fuente` y `n`).
// - Debajo de la herramienta, un sub-paso con un punto «•»: la línea que
//   resume lo que trajo.
// - Los pensamientos CORTOS son una fila con bombilla: «Thinking | Escalar
//   BM25». Los LARGOS son prosa normal, en el color del texto, como parte de
//   la respuesta: es el modelo hablando mientras trabaja.
// - Al acabar, todo se pliega en una línea: «Used 1 tool, Fetch multiple
//   GitHub raw URLs in one request».
//
// De dónde sale, que es lo que hace que se pueda fiar uno de ella: el
// servidor escucha el bucle del chat con los callbacks de DSPy y el navegador
// pide los pasos mientras dura. Nada se dibuja que no haya pasado. Y las dos
// clases de fila no valen lo mismo: «Pensando» es lo que el modelo DICE que
// va a hacer; la herramienta es una llamada real. Si falló se dice «no pude
// comprobar», nunca «sin resultados».

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { IconBulb, IconChevronDown, IconGlobe, IconLayers, IconMessage, IconSearch } from './icons';
import { Shimmer } from './Shimmer';
import type { PasoRazonamiento } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { inicialFuente } from '../lib/mundo';

const ICONO: Record<NonNullable<PasoRazonamiento['familia']>, (p: { size?: number }) => JSX.Element> = {
  base: IconGlobe,
  mundo: IconLayers,
  proyecto: IconSearch,
  cuestiones: IconMessage,
  otra: IconSearch,
};

/** La curva de Kimi y de Claude para lo que aparece: arranca rápido y se
 *  posa despacio. */
const SALIDA = [0.16, 1, 0.3, 1] as const;

/** Un pensamiento hasta aquí es una FILA (bombilla, una frase); más largo,
 *  es PROSA, como en Kimi, donde «El README da una buena visión. Ahora voy a
 *  leer el código...» va en párrafo y «Escalar BM25» en fila. */
const PENSAMIENTO_CORTO = 110;

/** Lo que se le pidió a una herramienta, en una frase: el argumento que dice
 *  QUÉ se buscó. Los demás (límites, años) van al desplegar. */
function loQueBusco(args: Record<string, string> | undefined): string {
  if (!args) return '';
  const preferidos = ['consulta', 'query', 'pregunta', 'tema', 'term', 'termino', 'texto', 'gen', 'diana', 'simbolo'];
  for (const k of preferidos) if (args[k]) return args[k];
  return Object.values(args)[0] ?? '';
}

function etiqueta(t: string): string {
  return t ? t[0]!.toLocaleUpperCase() + t.slice(1) : t;
}

/** La primera frase de un pensamiento, para la fila. */
function primeraFrase(t: string): string {
  const m = t.match(/^(.{20,160}?[.!?])(\s|$)/);
  return (m ? m[1]! : t.slice(0, 140)).trim();
}

/** El tono de una base, estable por nombre, para que PubMed sea siempre del
 *  mismo color. Los cinco tonos son los de `.mundo-fuente-N`. */
function tonoDe(fuente: string): number {
  let h = 0;
  for (const c of fuente) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

/** Los círculos solapados de Kimi: aquí, la base consultada. Una sola, pero
 *  con el mismo lenguaje que las pastillas de fuentes del chat. */
function Fuente({ nombre }: { nombre: string }) {
  return (
    <span className="razon-fuentes" aria-label={nombre} title={nombre}>
      <i className={`mundo-fuente mundo-fuente-${tonoDe(nombre)}`}>{inicialFuente(nombre)}</i>
    </span>
  );
}

function Carril({ Icono, ultimo, viva }: { Icono: (p: { size?: number }) => JSX.Element; ultimo: boolean; viva: boolean }) {
  return (
    <span className="razon-carril" aria-hidden="true">
      <span className={`razon-icono ${viva ? 'razon-icono-viva' : ''}`.trim()}>
        <Icono size={15} />
      </span>
      {!ultimo && <i className="razon-linea" />}
    </span>
  );
}

const ENTRADA = (reducido: boolean) => ({
  initial: reducido ? { opacity: 0 } : { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.media, ease: SALIDA },
});

/** Un pensamiento largo: prosa, como en Kimi. Lleva su carril para que el
 *  hilo no se corte, pero sin bombilla ni etiqueta. */
function Prosa({ p, ultimo }: { p: PasoRazonamiento; ultimo: boolean }) {
  const reducido = useMovimientoReducido();
  return (
    <motion.li className="razon-fila razon-prosa" {...ENTRADA(reducido)}>
      <span className="razon-carril" aria-hidden="true">
        <span className="razon-punto-prosa" />
        {!ultimo && <i className="razon-linea" />}
      </span>
      <p className="razon-prosa-texto">{p.texto}</p>
    </motion.li>
  );
}

function Pensamiento({ p, ultimo, enMarcha }: { p: PasoRazonamiento; ultimo: boolean; enMarcha: boolean }) {
  const reducido = useMovimientoReducido();
  const [abierta, setAbierta] = useState(false);
  const texto = p.texto ?? '';
  const ahora = ultimo && enMarcha && !p.cierra;
  const frase = primeraFrase(texto);
  const hayMas = texto.length > frase.length;
  return (
    <motion.li className={`razon-fila razon-pensar ${ahora ? 'razon-viva' : ''}`.trim()} {...ENTRADA(reducido)}>
      <Carril Icono={IconBulb} ultimo={ultimo} viva={ahora} />
      <div className="razon-cuerpo">
        <button type="button" className="razon-cabeza" onClick={() => hayMas && setAbierta((v) => !v)} aria-expanded={hayMas ? abierta : undefined} disabled={!hayMas}>
          <span className="razon-etiqueta">{ahora ? <Shimmer>{tr('Pensando')}</Shimmer> : p.cierra ? tr('Listo para responder') : tr('Pensando')}</span>
          {frase && (
            <>
              <i className="razon-sep" aria-hidden="true" />
              <span className="razon-texto">{frase}</span>
            </>
          )}
          {hayMas && <IconChevronDown size={13} className={`razon-flecha ${abierta ? 'razon-flecha-abierta' : ''}`} />}
        </button>
        <AnimatePresence initial={false}>
          {abierta && (
            <motion.div className="razon-detalle" initial={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: DUR.rapida }}>
              <p>{texto}</p>
              <p className="meta">{tr('Es lo que el modelo dice que va a hacer, no un hecho comprobado.')}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

function Herramienta({ p, ahora, ultimo, enMarcha }: { p: PasoRazonamiento; ahora: number; ultimo: boolean; enMarcha: boolean }) {
  const reducido = useMovimientoReducido();
  const [abierta, setAbierta] = useState(false);
  const corriendo = (p.fin === null || p.fin === undefined) && enMarcha;
  const fallo = !!p.error;
  const ms = p.fin ? p.fin - p.inicio : corriendo ? ahora - p.inicio : null;
  const busco = loQueBusco(p.argumentos);
  const Icono = ICONO[p.familia ?? 'otra'];
  const hayMas = Object.keys(p.argumentos ?? {}).length > 0 || !!p.resumen || fallo;
  const nombre = etiqueta(p.nombre ?? p.herramienta ?? '');
  // «6 resultados» solo si la base lo dijo. Cero es un dato («0 resultados»);
  // sin dato no se inventa.
  const cuenta = typeof p.n === 'number' ? (p.n === 1 ? tr('1 resultado') : trp('{n} resultados', { n: p.n })) : null;

  return (
    <motion.li className={`razon-fila razon-herramienta ${corriendo ? 'razon-viva' : ''} ${fallo ? 'razon-fallo' : ''}`.trim()} {...ENTRADA(reducido)}>
      <Carril Icono={Icono} ultimo={ultimo && !p.resumen} viva={corriendo} />
      <div className="razon-cuerpo">
        <button type="button" className="razon-cabeza" onClick={() => hayMas && setAbierta((v) => !v)} aria-expanded={hayMas ? abierta : undefined} disabled={!hayMas}>
          <span className="razon-etiqueta">{corriendo ? <Shimmer>{nombre}</Shimmer> : nombre}</span>
          <i className="razon-sep" aria-hidden="true" />
          {p.fuente && <Fuente nombre={p.fuente} />}
          <span className={`razon-texto ${fallo ? 'tono-aviso' : ''}`.trim()}>
            {fallo ? tr('no pude comprobar') : corriendo ? busco : cuenta ?? busco}
          </span>
          {ms !== null && ms > 1500 && !corriendo && <span className="razon-ms">{formatearDuracion(ms)}</span>}
          {hayMas && <IconChevronDown size={13} className={`razon-flecha ${abierta ? 'razon-flecha-abierta' : ''}`} />}
        </button>
        <AnimatePresence initial={false}>
          {abierta && (
            <motion.div className="razon-detalle" initial={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: DUR.rapida }}>
              {Object.entries(p.argumentos ?? {}).map(([k, v]) => (
                <p key={k} className="razon-arg"><span>{k}</span> {v}</p>
              ))}
              {fallo && (
                <p className="tono-aviso">{p.error} <span className="meta">{tr('No es «sin resultados»: la consulta no llegó a mirarse.')}</span></p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

/** El sub-paso con punto de Kimi («• Audit RAG System Components...»): la
 *  línea que resume lo que trajo la herramienta. Va como fila propia, colgada
 *  del mismo hilo. */
function SubPaso({ texto, ultimo }: { texto: string; ultimo: boolean }) {
  const reducido = useMovimientoReducido();
  return (
    <motion.li className="razon-fila razon-sub" {...ENTRADA(reducido)}>
      <span className="razon-carril" aria-hidden="true">
        <span className="razon-punto" />
        {!ultimo && <i className="razon-linea" />}
      </span>
      <span className="razon-sub-texto">{primeraFrase(texto)}</span>
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
          <Carril Icono={IconBulb} ultimo viva />
          <div className="razon-cuerpo">
            <span className="razon-cabeza">
              <span className="razon-etiqueta"><Shimmer>{tr('Pensando')}</Shimmer></span>
              <i className="razon-sep" aria-hidden="true" />
              <span className="razon-texto">{tr('leyendo la pregunta y lo que ya sabe')}</span>
            </span>
          </div>
        </li>
      </ol>
    );
  }

  // Plegada, como el «Used 1 tool, Fetch multiple GitHub raw URLs in one
  // request» de Kimi: cuántas herramientas y la primera, en una línea.
  if (plegable && !abierto) {
    const primera = herramientas[0];
    const nombrePrimera = primera ? etiqueta(primera.nombre ?? primera.herramienta ?? '') : '';
    return (
      <button type="button" className="razon-resumen" onClick={() => setAbierto(true)}>
        <IconBulb size={14} />
        <span>
          {herramientas.length === 0
            ? tr('Respondió sin herramientas')
            : herramientas.length === 1
              ? trp('Usó 1 herramienta, {nombre}', { nombre: nombrePrimera })
              : trp('Usó {n} herramientas, la primera {nombre}', { n: herramientas.length, nombre: nombrePrimera })}
          {fallidas > 0 && <span className="tono-aviso"> · {trp('{n} sin poder comprobar', { n: fallidas })}</span>}
        </span>
        <IconChevronDown size={13} />
      </button>
    );
  }

  // Las filas, con el sub-paso de cada herramienta que trajo algo, y los
  // pensamientos largos como prosa.
  const filas: JSX.Element[] = [];
  pasos.forEach((p, i) => {
    const ultimoPaso = i === pasos.length - 1;
    if (p.tipo === 'pensar') {
      const largo = (p.texto ?? '').length > PENSAMIENTO_CORTO && !(ultimoPaso && enMarcha && !p.cierra);
      filas.push(largo ? <Prosa key={p.id} p={p} ultimo={ultimoPaso} /> : <Pensamiento key={p.id} p={p} ultimo={ultimoPaso} enMarcha={enMarcha} />);
      return;
    }
    filas.push(<Herramienta key={p.id} p={p} ahora={ahora} ultimo={ultimoPaso} enMarcha={enMarcha} />);
    if (p.resumen && !p.error) filas.push(<SubPaso key={`${p.id}-sub`} texto={p.resumen} ultimo={ultimoPaso} />);
  });

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
        {filas}
      </ol>
    </div>
  );
}
