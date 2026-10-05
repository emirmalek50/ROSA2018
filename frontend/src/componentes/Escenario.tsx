// El escenario de la corrida en vivo (diseño "Corrida en vivo · v1", 5 de
// octubre de 2026). Es lo que la gente mira mientras ROSA2018 trabaja, así que
// contesta de un vistazo, y con números grandes, lo que antes había que
// deducir de ocho notas grises: cuánto lleva trabajando y desde cuándo, qué
// paso del plan está haciendo, cuánto le falta y a qué ritmo, el latido de la
// pista que trabaja y qué modelo está en escena.
//
// Todo sale del registro (lib/escenario.ts). Con la corrida en pausa la
// tarjeta no finge actividad: el paso en grande es donde se quedó, el latido
// dice "en pausa" y la nota ámbar explica por qué está quieta.

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Corrida, EstadoRosa, Iteracion, RolModelo } from '../datos/tipos';
import { Cifra, SUAVE_IOS, VIVO_IOS, pulsoDe, queHaceAhora } from './ActividadEnVivo';
import { IconoEsc, type NombreIcono } from './IconosEscenario';
import { nombreDeModelo, NOMBRE_ROL } from './VigilanteModelos';
import { avanceDe, elencoDe, fechaLarga, haceCuanto, latidoDe, pasoFoco, pistaFoco, relojDe } from '../lib/escenario';
import { formatearDuracion, formatearEntero } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { proponiendoPlan } from '../lib/etiquetas';
import { useMovimientoReducido } from '../lib/movimiento';

/** El nombre de cada tipo de paso, como lo lee una persona. */
export function nombreDeTipo(tipo: string | undefined): string {
  switch (tipo) {
    case 'literatura':
      return tr('Literatura');
    case 'extraccion':
      return tr('Extracción');
    case 'verificacion':
      return tr('Verificación');
    case 'modelo':
      return tr('Modelo');
    case 'grafo':
      return tr('Grafo');
    case 'hipotesis':
      return tr('Hipótesis');
    case 'novedad':
      return tr('Novedad');
    case 'ensayos':
      return tr('Ensayos');
    case 'analisis':
      return tr('Análisis');
    case 'replicacion':
      return tr('Replicación');
    case 'meta':
      return tr('Meta');
    default:
      return tr('Paso');
  }
}

const ICONO_ROL: Record<RolModelo, NombreIcono> = { juez: 'scale', cerebro: 'brain', volumen: 'layers', replica: 'copy' };

/** Segmentos de la barra de avance del paso en foco. */
const SEGMENTOS = 48;

interface Props {
  corrida: Corrida;
  iteracion: Iteracion | null;
  estado: Pick<EstadoRosa, 'saludModelos'>;
  segundos: number;
  ahora: number;
  /** La etiqueta canónica del estado (`etiquetaCorrida`). */
  etiqueta: string;
  topes?: { horas: number | null; iteraciones: number | null };
  /** Por qué el reloj está parado, o null si corre. */
  relojParado: string | null;
  /** Cuántas cosas esperan a una persona (permisos, incidencias). */
  reclaman: number;
  acciones?: ReactNode;
}

export function Escenario({ corrida, iteracion, estado, segundos, ahora, etiqueta, topes, relojParado, reclaman, acciones }: Props) {
  const reducido = useMovimientoReducido();
  const pulso = pulsoDe(corrida.estado);
  const trabajando = corrida.estado === 'en_marcha';
  const conPlan = iteracion !== null && iteracion.planAprobado && iteracion.plan.length > 0 && !proponiendoPlan(corrida, iteracion);
  const paso = conPlan ? pasoFoco(iteracion) : null;
  const pista = paso ? pistaFoco(iteracion, paso) : null;
  const avance = paso ? avanceDe(iteracion, paso, trabajando) : null;
  const que = queHaceAhora(corrida, iteracion);
  const enCurso = trabajando && iteracion?.terminadaEn === null && (paso?.estado === 'en_curso' || pista?.estado === 'en_curso');
  const pistaViva = !!(enCurso && pista?.estado === 'en_curso');
  const titulo = paso ? paso.titulo : que.titulo;
  const detalle = paso ? paso.detalle || que.detalle : que.detalle;
  const indice = paso && iteracion ? iteracion.plan.indexOf(paso) : -1;
  const latido = latidoDe(pista, 8);
  const elenco = elencoDe(estado, iteracion, pista, trabajando, nombreDeModelo);
  const empezo = haceCuanto(corrida.empezadaEn, ahora);
  const horas = topes?.horas ?? corrida.parada?.horas ?? null;
  const maxIteraciones = topes?.iteraciones ?? corrida.parada?.iteraciones ?? null;
  const numeroIteracion = Math.max(iteracion?.numero ?? 0, corrida.iteracionActual);
  const ceja = enCurso || !conPlan ? tr('Ahora mismo') : pulso === 'quieto' ? tr('Dónde terminó') : tr('Dónde se quedó');

  return (
    <motion.section
      className={`esc esc-${pulso}`}
      aria-label={tr('Qué está haciendo ROSA2018 ahora')}
      initial={reducido ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reducido ? { duration: 0.2 } : SUAVE_IOS}
    >
      <div className="esc-cabecera">
        <div className="esc-identidad">
          <span className="esc-estado">
            <span className="esc-halo" aria-hidden="true">
              <i />
            </span>
            {etiqueta}
          </span>
          <div className="pantalla-cabecera esc-nombre">
            <h2>{trp('Corrida {n}', { n: corrida.numero })}</h2>
          </div>
          <span className="esc-sep" aria-hidden="true">·</span>
          <span className="esc-iteracion">
            {maxIteraciones ? trp('Iteración {a} de {b}', { a: numeroIteracion, b: maxIteraciones }) : trp('Iteración {n}', { n: numeroIteracion })}
          </span>
        </div>
        <div className="esc-derecha">
          <div className="esc-tiempo">
            <div className="esc-stat" title={tr('Tiempo de trabajo: el reloj de pared menos lo que la corrida pasó esperando a una persona y menos las pausas del proceso.')}>
              <span className="esc-stat-etiqueta">
                <IconoEsc nombre="timer" size={13} />
                {tr('Tiempo de trabajo')}
              </span>
              <span className="esc-stat-cifra" aria-hidden="true">
                {relojDe(segundos)}
              </span>
              <span className="sr-only">{trp('{t} de trabajo', { t: formatearDuracion(segundos * 1000) || '0 s' })}</span>
              <span className="esc-stat-pie">
                {relojParado ? trp('{relojParado}: el reloj no corre', { relojParado }) : horas ? trp('de {t} antes de parar sola', { t: formatearDuracion(horas * 3_600_000) }) : tr('sin tope de tiempo')}
              </span>
            </div>
            <i className="esc-tiempo-sep" aria-hidden="true" />
            <div className="esc-stat">
              <span className="esc-stat-etiqueta">
                <IconoEsc nombre="calendar" size={13} />
                {tr('Empezó hace')}
              </span>
              <span className="esc-stat-cifra">
                {empezo.cifra}
                <small>{empezo.unidad}</small>
              </span>
              <span className="esc-stat-pie">{fechaLarga(corrida.empezadaEn)}</span>
            </div>
          </div>
          {acciones && <div className="esc-acciones">{acciones}</div>}
        </div>
      </div>

      <div className="esc-ahora">
        <div className="esc-foco">
          <div className="esc-ceja">
            <span className="esc-ceja-fuerte">{ceja}</span>
            {paso && iteracion && (
              <span>
                {trp('Paso {a} de {b}', { a: indice + 1, b: iteracion.plan.length })} · {nombreDeTipo(paso.tipo)}
              </span>
            )}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h3
              key={titulo}
              className="esc-titular"
              initial={reducido ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducido ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={reducido ? { duration: 0.15 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {titulo}
            </motion.h3>
          </AnimatePresence>
          {detalle && <p className="esc-descripcion">{detalle}</p>}
          {conPlan && !trabajando && (
            <p className={`esc-pausa esc-pausa-${pulso}`}>
              <IconoEsc nombre={pulso === 'quieto' ? 'square' : 'pause'} size={14} />
              <span>
                <strong>{que.titulo}.</strong> {que.detalle}
              </span>
            </p>
          )}
          {avance && avance.total > 0 && <Contador hechos={avance.hechos} total={avance.total} unidad={avance.unidad} vivo={enCurso} ritmo={avance.ritmo} faltan={avance.faltan} enPaso={avance.enPaso} />}
        </div>
        {latido.length > 0 && (
          <aside className="esc-latido" aria-label={tr('Latido de la pista')}>
            <header>
              <IconoEsc nombre="radio" size={14} />
              <strong>{tr('Latido de la pista')}</strong>
              <span className={`esc-directo ${pistaViva ? '' : 'esc-directo-quieto'}`}>
                <i aria-hidden="true" />
                {pistaViva ? tr('en directo') : pulso === 'quieto' || pista?.estado === 'hecha' || pista?.estado === 'fallida' ? tr('registro') : tr('en pausa')}
              </span>
            </header>
            <ol aria-live={pistaViva ? 'polite' : undefined}>
              <AnimatePresence initial={false}>
                {latido.map((l) => (
                  <motion.li
                    key={`${l.marca}-${l.texto}`}
                    layout={!reducido}
                    initial={reducido ? false : { y: -10, scale: 0.98 }}
                    animate={{ y: 0, scale: 1 }}
                    transition={VIVO_IOS}
                  >
                    <time>{l.marca}</time>
                    <i aria-hidden="true" />
                    <span>{l.texto}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          </aside>
        )}
      </div>

      {elenco.length > 0 && (
        <div className="esc-elenco">
          <span className="esc-elenco-rotulo">{tr('En escena')}</span>
          <ul>
            {elenco.map((a) => (
              <li key={a.rol} className={`esc-actor ${a.activo ? 'esc-actor-activo' : ''}`}>
                <span className="esc-avatar" aria-hidden="true">
                  <IconoEsc nombre={ICONO_ROL[a.rol]} size={14} />
                </span>
                <span className="esc-actor-texto">
                  <span>
                    <b>{a.nombre}</b> <em>{NOMBRE_ROL[a.rol]}</em>
                  </span>
                  <small title={a.nota}>{a.nota}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reclaman > 0 && (
        <motion.div className="esc-reclamo" initial={reducido ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={VIVO_IOS}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.8v3.6M8 10.8v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>
            <strong>{reclaman === 1 ? tr('Una cosa espera tu respuesta') : trp('{reclaman} cosas esperan tu respuesta', { reclaman })}</strong>
            {tr('. Hasta que decidas, ROSA2018 no sigue por ahí.')}
          </span>
        </motion.div>
      )}
    </motion.section>
  );
}

/** El contador grande del paso en foco, su barra y su ritmo. */
function Contador({ hechos, total, unidad, vivo, ritmo, faltan, enPaso }: { hechos: number; total: number; unidad: string; vivo: boolean; ritmo: string | null; faltan: string | null; enPaso: string | null }) {
  const llenos = Math.round(Math.max(0, Math.min(1, hechos / total)) * SEGMENTOS);
  return (
    <div className="esc-contador">
      <div className="esc-cifras">
        <span className="esc-cifra-grande">
          <Cifra valor={hechos} />
        </span>
        <span className="esc-cifra-lado">
          <span className="esc-cifra-de">{trp('de {total}', { total: formatearEntero(total) })}</span>
          <span className="esc-unidad">{unidad}</span>
        </span>
      </div>
      <div className={`esc-barra ${vivo ? 'esc-barra-viva' : ''}`} role="img" aria-label={trp('{a} de {b} {unidad}', { a: formatearEntero(hechos), b: formatearEntero(total), unidad })}>
        {Array.from({ length: SEGMENTOS }, (_, i) => (
          <i key={i} className={i < llenos ? (i >= llenos - 3 ? 'esc-seg-punta' : 'esc-seg-hecho') : i === llenos ? 'esc-seg-ahora' : undefined} />
        ))}
      </div>
      {(ritmo || faltan || enPaso) && (
        <ul className="esc-ritmo">
          {ritmo && (
            <li>
              <IconoEsc nombre="gauge" size={14} />
              {ritmo}
            </li>
          )}
          {faltan && (
            <li>
              <IconoEsc nombre="hourglass" size={14} />
              {faltan}
            </li>
          )}
          {enPaso && (
            <li>
              <IconoEsc nombre="timer" size={14} />
              {enPaso}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
