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
// - Las filas BAJAN: cada paso nuevo se abre hacia abajo y el hilo se
//   dibuja hasta él, y el icono del que está corriendo se mueve (el globo
//   gira, la lupa busca, la bombilla se enciende).
// - Lo que el modelo piensa NO se escribe: ROSA2018 contesta en un único
//   mensaje, sin un adelanto largo de su razonamiento (Emir, 6 de octubre de
//   2026). Mientras piensa hay una fila «Pensando» con la bombilla, y nada
//   más; cuando llega la siguiente herramienta, la fila se va.
// - Al acabar, todo se pliega en una línea: «Used 1 tool, Fetch multiple
//   GitHub raw URLs in one request».
//
// De dónde sale, que es lo que hace que se pueda fiar uno de ella: el
// servidor escucha el bucle del chat con los callbacks de DSPy y el navegador
// pide los pasos mientras dura. Nada se dibuja que no haya pasado. Y las dos
// clases de fila no valen lo mismo: «Pensando» es lo que el modelo DICE que
// va a hacer, y por eso no se enseña; la herramienta es una llamada real. Si falló se dice «no pude
// comprobar», nunca «sin resultados».

import { cloneElement, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { IconBulb, IconChevronDown } from './icons';
import { iconoDe, nombreHerramienta, tablaDe, tonoDe, type Mov } from './Progreso';
import { Shimmer } from './Shimmer';
import type { ConsultaBase, PasoRazonamiento } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { inicialFuente } from '../lib/mundo';

/** Las respuestas de antes del 2 de octubre de 2026 no guardaron el
 *  razonamiento, pero sí cada consulta a una base. Con esto se pintan con la
 *  MISMA línea de tiempo que las nuevas (solo herramientas, sin
 *  pensamientos), en vez de con otro componente de otro aspecto. */
export function pasosDeConsultas(consultas: ConsultaBase[] | undefined): PasoRazonamiento[] {
  return [...(consultas ?? [])]
    .sort((a, b) => a.fecha - b.fecha)
    .map((c): PasoRazonamiento => ({
      id: c.id,
      tipo: 'herramienta',
      herramienta: c.herramienta,
      familia: 'base',
      nombre: c.fuente || c.herramienta,
      argumentos: c.argumentos,
      inicio: c.fecha,
      fin: c.fecha + Math.max(0, c.ms || 0),
      error: c.error || null,
      resumen: c.resumen || '',
      fuente: c.fuente || '',
      n: c.n,
    }));
}

/** La curva de Kimi y de Claude para lo que aparece: arranca rápido y se
 *  posa despacio. */
const SALIDA = [0.16, 1, 0.3, 1] as const;

/** La coreografía de cada fila nueva, como en Kimi: primero el hilo baja
 *  desde la fila de arriba (`.razon-linea`, LINEA_S), y solo cuando llega
 *  aparece el icono y, detrás, su texto. La línea no salta de golpe
 *  (Emir, 6 de octubre de 2026). */
const LINEA_S = 0.3;
const TEXTO_S = 0.08;

/** Lo que tarda en entrar cada fila detrás de la anterior: lo que dura su
 *  coreografía, para que el hilo de la siguiente no salga antes de que la
 *  anterior haya terminado de llegar. */
export const GOTEO_MS = Math.round((LINEA_S + TEXTO_S + 0.1) * 1000);

/** Lo que se le pidió a una herramienta, en una frase: el argumento que dice
 *  QUÉ se buscó. Los demás (límites, años) van al desplegar. */
function loQueBusco(args: Record<string, string> | undefined): string {
  if (!args) return '';
  const preferidos = ['consulta', 'query', 'pregunta', 'tema', 'term', 'termino', 'texto', 'gen', 'diana', 'simbolo', 'identificador', 'nombre', 'ruta'];
  for (const k of preferidos) if (typeof args[k] === 'string' && args[k]) return args[k];
  // Sin nada que diga qué se buscó, la tabla del proyecto que miró (su
  // nombre en llano, de Progreso, que es quien conoce las tablas).
  if (args.tabla) return tablaDe(args.tabla)?.etiqueta ?? args.tabla;
  const primero = Object.values(args).find((v) => typeof v === 'string' && v);
  return primero ?? '';
}

function etiqueta(t: string): string {
  return t ? t[0]!.toLocaleUpperCase() + t.slice(1) : t;
}

/** La primera frase de un resumen, para el sub-paso. */
function primeraFrase(t: string): string {
  const m = t.match(/^(.{20,160}?[.!?])(\s|$)/);
  return (m ? m[1]! : t.slice(0, 140)).trim();
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

/** Dónde está cada fila entre las que YA se ven: `primera`, no hay hilo que
 *  esperar; `siguiente`, la key de la fila de debajo, si hay. El hilo sale
 *  solo cuando la de debajo existe, así no apunta a una fila que aún no ha
 *  bajado. Lo pone Razonamiento, que es quien sabe cuáles se ven. */
type Llegada = { primera?: boolean; siguiente?: string };

/** El retraso de cada parte de la fila: el icono cuando el hilo ha bajado,
 *  el texto un poco después. */
function retraso(primera: boolean | undefined, parte: 'icono' | 'texto'): number {
  const base = primera ? 0 : LINEA_S;
  return parte === 'icono' ? base : base + TEXTO_S;
}

function Carril({ Icono, mov, viva, primera, siguiente }: { Icono: (p: { size?: number }) => JSX.Element; mov: Mov; viva: boolean } & Llegada) {
  const reducido = useMovimientoReducido();
  return (
    <span className="razon-carril" aria-hidden="true">
      <motion.span
        className={`razon-icono mov-${mov} ${viva ? 'razon-icono-viva' : ''}`.trim()}
        initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reducido ? { duration: DUR.rapida } : { delay: retraso(primera, 'icono'), type: 'spring', stiffness: 520, damping: 24 }}
      >
        <Icono size={15} />
      </motion.span>
      {/* El hilo hasta la fila de debajo. Se dibuja UNA vez, cuando aparece
          la primera fila de debajo; si esa fila cambia (sale «Pensando»,
          entra una herramienta), el hilo ya está y se queda. Con una key de
          la fila de debajo se desmontaba y volvía a dibujarse en cada cambio:
          un parpadeo en cada herramienta (revisión del 6 de octubre de 2026). */}
      {siguiente && <i className="razon-linea" />}
    </span>
  );
}

/** El texto de la fila entra detrás de su icono, deslizándose desde él. */
const TEXTO = (reducido: boolean, primera: boolean | undefined) => ({
  initial: reducido ? { opacity: 0 } : { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  transition: reducido ? { duration: DUR.rapida } : { delay: retraso(primera, 'texto'), duration: DUR.media, ease: SALIDA },
});

/** Cada fila nueva se ABRE hacia abajo, como en Kimi: crece en altura desde
 *  cero mientras el hilo de la fila de arriba baja hasta ella
 *  (`.razon-linea` en mundo.css). Su icono y su texto entran después
 *  (Carril y TEXTO), así que la fila en sí no se funde. */
const ENTRADA = (reducido: boolean) => ({
  initial: reducido ? { opacity: 0 } : { height: 0, overflow: 'hidden' },
  animate: reducido ? { opacity: 1 } : { height: 'auto', transitionEnd: { overflow: 'visible' } },
  exit: reducido ? { opacity: 0 } : { opacity: 0, height: 0, overflow: 'hidden' },
  transition: { duration: LINEA_S, ease: SALIDA },
});

/** La fila mientras piensa: la bombilla encendida y «Pensando», sin el texto
 *  de lo que piensa. Es UNA fila con la misma key de principio a fin, así que
 *  entra una vez, se va cuando llega una herramienta y vuelve después. */
function FilaPensando({ cierra, primera }: { cierra: boolean } & Llegada) {
  const reducido = useMovimientoReducido();
  return (
    <motion.li className="razon-fila razon-pensar razon-viva" {...ENTRADA(reducido)}>
      <Carril Icono={IconBulb} mov="bombilla" viva primera={primera} />
      <motion.div className="razon-cuerpo" {...TEXTO(reducido, primera)}>
        <span className="razon-cabeza">
          <span className="razon-etiqueta"><Shimmer>{cierra ? tr('Preparando la respuesta') : tr('Pensando')}</Shimmer></span>
        </span>
      </motion.div>
    </motion.li>
  );
}

function Herramienta({ p, ahora, enMarcha, primera, siguiente }: { p: PasoRazonamiento; ahora: number; enMarcha: boolean } & Llegada) {
  const reducido = useMovimientoReducido();
  const [abierta, setAbierta] = useState(false);
  const corriendo = (p.fin === null || p.fin === undefined) && enMarcha;
  const fallo = !!p.error;
  const ms = p.fin ? p.fin - p.inicio : corriendo ? ahora - p.inicio : null;
  const busco = loQueBusco(p.argumentos);
  const { Icono, mov } = iconoDe(p);
  const hayMas = Object.keys(p.argumentos ?? {}).length > 0 || !!p.resumen || fallo;
  const nombre = etiqueta(nombreHerramienta(p));
  // «6 resultados» solo si la base lo dijo. Cero es un dato («0 resultados»);
  // sin dato no se inventa.
  const cuenta = typeof p.n === 'number' ? (p.n === 1 ? tr('1 resultado') : trp('{n} resultados', { n: p.n })) : null;
  const detalle = fallo ? tr('no pude comprobar') : corriendo ? busco : cuenta ?? busco;

  return (
    <motion.li className={`razon-fila razon-herramienta ${corriendo ? 'razon-viva' : ''} ${fallo ? 'razon-fallo' : ''}`.trim()} {...ENTRADA(reducido)}>
      <Carril Icono={Icono} mov={mov} viva={corriendo} primera={primera} siguiente={siguiente} />
      <motion.div className="razon-cuerpo" {...TEXTO(reducido, primera)}>
        <button type="button" className="razon-cabeza" onClick={() => hayMas && setAbierta((v) => !v)} aria-expanded={hayMas ? abierta : undefined} disabled={!hayMas}>
          <span className="razon-etiqueta">{corriendo ? <Shimmer>{nombre}</Shimmer> : nombre}</span>
          {(detalle || p.fuente) && <i className="razon-sep" aria-hidden="true" />}
          {p.fuente && <Fuente nombre={p.fuente} />}
          {/* El detalle cambia de «lo que busco» a «12 resultados» al acabar:
              se funde de uno a otro, no salta. */}
          <span className={`razon-texto ${fallo ? 'tono-aviso' : ''}`.trim()}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={detalle}
                className="razon-texto-valor"
                initial={reducido ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(2px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={reducido ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(2px)' }}
                transition={{ duration: DUR.rapida, ease: SALIDA }}
              >
                {detalle}
              </motion.span>
            </AnimatePresence>
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
      </motion.div>
    </motion.li>
  );
}

/** El sub-paso con punto de Kimi («• Audit RAG System Components...»): la
 *  línea que resume lo que trajo la herramienta. Va como fila propia, colgada
 *  del mismo hilo. */
function SubPaso({ texto, primera, siguiente }: { texto: string } & Llegada) {
  const reducido = useMovimientoReducido();
  return (
    <motion.li className="razon-fila razon-sub" {...ENTRADA(reducido)}>
      <span className="razon-carril" aria-hidden="true">
        <motion.span
          className="razon-punto"
          initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reducido ? { duration: DUR.rapida } : { delay: retraso(primera, 'icono'), type: 'spring', stiffness: 520, damping: 24 }}
        />
        {siguiente && <i className="razon-linea" />}
      </span>
      <motion.span className="razon-sub-texto" {...TEXTO(reducido, primera)}>{primeraFrase(texto)}</motion.span>
    </motion.li>
  );
}

/** La línea de tiempo entera. `enMarcha`: la pregunta sigue en vuelo, así que
 *  el paso que corre late y, mientras piensa, hay una fila «Pensando». */
export function Razonamiento({ pasos, ahora, enMarcha = false, plegable = false, recienLlegada = false }: { pasos: PasoRazonamiento[]; ahora: number; enMarcha?: boolean; plegable?: boolean; recienLlegada?: boolean }) {
  // Una respuesta que ACABA de llegar arranca con la línea abierta, que es
  // como se estaba viendo mientras trabajaba, y se pliega sola al momento.
  // Así el paso de «en marcha» a «contestada» es un pliegue, no las filas
  // esfumándose de golpe (Emir, 3 de octubre de 2026). Las viejas, al abrir
  // el chat, ya vienen plegadas.
  const [abierto, setAbierto] = useState(!plegable || recienLlegada);
  useEffect(() => {
    if (!plegable || !recienLlegada) return;
    const id = window.setTimeout(() => setAbierto(false), 1400);
    return () => window.clearTimeout(id);
  }, [plegable, recienLlegada]);
  const reducido = useMovimientoReducido();
  const herramientas = pasos.filter((p) => p.tipo === 'herramienta');
  const fallidas = herramientas.filter((p) => p.error).length;

  // Piensa ahora si aún no hay pasos o el último es pensar.
  const ultimo = pasos[pasos.length - 1];
  const pensando = enMarcha && (!ultimo || ultimo.tipo === 'pensar');

  // La línea de resumen, como el «Used 1 tool, Fetch multiple GitHub raw
  // URLs in one request» de Kimi: cuántas herramientas y la primera. Cuando
  // se puede plegar, es el botón que abre y cierra.
  const primera = herramientas[0];
  const nombrePrimera = primera ? etiqueta(nombreHerramienta(primera)) : '';
  const resumen = herramientas.length === 0
    ? tr('Respondió sin herramientas')
    : herramientas.length === 1
      ? trp('Usó 1 herramienta, {nombre}', { nombre: nombrePrimera })
      : trp('Usó {n} herramientas, la primera {nombre}', { n: herramientas.length, nombre: nombrePrimera });

  // Las filas: las herramientas, con el sub-paso de cada una que trajo
  // algo, y al final la de «Pensando» si está pensando.
  const filas: JSX.Element[] = [];
  herramientas.forEach((p) => {
    filas.push(<Herramienta key={p.id} p={p} ahora={ahora} enMarcha={enMarcha} />);
    // El sub-paso solo si dice algo que la fila no diga ya: con fuente y
    // cuenta, la fila ya lo dice («Exa | (E) 10 resultados») y repetirlo
    // debajo era ruido.
    const yaLoDiceLaFila = !!p.fuente && typeof p.n === 'number';
    if (p.resumen && !p.error && !yaLoDiceLaFila) filas.push(<SubPaso key={`${p.id}-sub`} texto={p.resumen} />);
  });
  if (pensando) filas.push(<FilaPensando key="pensando" cierra={!!ultimo?.cierra} />);

  // Las filas entran de UNA en una aunque el servidor entregue varias en el
  // mismo sondeo: si llegan tres pasos juntos, bajan uno detrás de otro y no
  // de golpe (Emir, 6 de octubre de 2026). Solo en vivo: una respuesta ya
  // contestada se ve entera, y lo que ya estaba al montar, también.
  // La que llega sola, cuando la anterior ya terminó de entrar, sale al
  // momento; solo espera la que llega pisándole los talones a otra.
  //
  // Se recuerda QUÉ filas se han enseñado (sus keys), no cuántas: con un
  // contador, una fila que el servidor quitaba (su seguimiento reiniciado,
  // «Pensando» que se va) dejaba el contador inflado y la siguiente tanda
  // entraba de golpe (revisión del 6 de octubre de 2026). `null` es «todas».
  const goteando = enMarcha && !reducido;
  const claves = filas.map((f) => String(f.key));
  const [mostradas, setMostradas] = useState<ReadonlySet<string> | null>(() => (goteando ? new Set(claves) : null));
  const ultimaEntrada = useRef(0);
  const pendientes = goteando && mostradas ? claves.filter((k) => !mostradas.has(k)) : [];
  const siguienteClave = pendientes[0];
  useEffect(() => {
    // Empezó a gotear después de montarse (la misma línea pasa de contestada
    // a en marcha): lo que ya se ve, visto está.
    if (goteando && mostradas === null) setMostradas(new Set(claves));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goteando]);
  useEffect(() => {
    if (!siguienteClave) return;
    const espera = Math.max(0, GOTEO_MS - (Date.now() - ultimaEntrada.current));
    const id = window.setTimeout(() => {
      ultimaEntrada.current = Date.now();
      setMostradas((m) => (m ? new Set([...m, siguienteClave]) : m));
    }, espera);
    return () => window.clearTimeout(id);
  }, [siguienteClave]);
  const aLaVista = goteando && mostradas ? filas.filter((f) => mostradas.has(String(f.key))) : filas;
  const visibles = aLaVista.map((fila, i, todas) =>
    cloneElement(fila, { primera: i === 0, siguiente: todas[i + 1]?.key ?? undefined }));

  if (herramientas.length === 0 && !pensando) return null;

  // Plegar y desplegar es una TRANSICIÓN, no un cambio de árbol: la lista se
  // cierra en altura mientras la línea de resumen se queda. Si fuera un `if`
  // que devuelve otro árbol, las treinta filas se esfumarían de golpe.
  return (
    <motion.div className="razon-bloque" layout={!reducido}>
      {plegable && (
        <button type="button" className={`razon-resumen ${abierto ? 'razon-resumen-abierto' : ''}`.trim()} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
          <IconBulb size={14} />
          <span>
            {abierto ? tr('Cómo lo pensó') : resumen}
            {!abierto && fallidas > 0 && <span className="tono-aviso"> · {trp('{n} sin poder comprobar', { n: fallidas })}</span>}
          </span>
          <IconChevronDown size={13} className={`razon-flecha ${abierto ? 'razon-flecha-abierta' : ''}`} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.ol
            key="lista"
            className="razon"
            aria-live={enMarcha ? 'polite' : undefined}
            initial={plegable ? (reducido ? { opacity: 0 } : { opacity: 0, height: 0 }) : false}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: DUR.media, ease: SALIDA }}
            style={{ overflow: 'hidden' }}
          >
            <AnimatePresence initial={false}>{visibles}</AnimatePresence>
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
