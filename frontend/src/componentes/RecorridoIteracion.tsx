// El recorrido de la iteración (diseño "Corrida en vivo · v1", 5 de octubre de
// 2026): los pasos del plan aprobado en un riel, cada uno con el ícono de su
// tipo, lo hecho en verde, el paso en foco encendido y lo que falta apagado.
// Debajo de cada paso, lo que dio (búsquedas, afirmaciones, juzgadas). Pulsar
// un paso abre sus pistas; el plan completo, con su edición, sigue a un clic.

import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { Iteracion, PasoPlan, Pista } from '../datos/tipos';
import { IconoEsc, iconoDePaso } from './IconosEscenario';
import { nombreDeTipo } from './Escenario';
import { avanceDe, pasoFoco, resultadoDePaso } from '../lib/escenario';
import { formatearDuracion } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { useMovimientoReducido } from '../lib/movimiento';

const PALABRAS = ['', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce'];

/** "Siete pasos aprobados": el número en letra hasta doce. */
function cuantos(n: number): string {
  const p = PALABRAS[n];
  return p ? tr(p) : String(n);
}

type Fase = 'hecho' | 'fallido' | 'foco' | 'futuro';

function faseDe(p: PasoPlan, foco: PasoPlan | null): Fase {
  if (p.estado === 'fallido') return 'fallido';
  if (p.estado === 'hecho' || p.estado === 'sin_trabajo' || p.estado === 'omitido') return 'hecho';
  if (foco && p.id === foco.id) return 'foco';
  return 'futuro';
}

interface Props {
  iteracion: Iteracion;
  trabajando: boolean;
  onDetenerPista?: (pistaId: string) => void;
  /** El plan completo (PlanEnVivo), que se abre desde el pie. */
  planCompleto?: ReactNode;
}

export function RecorridoIteracion({ iteracion, trabajando, onDetenerPista, planCompleto }: Props) {
  const reducido = useMovimientoReducido();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verPlan, setVerPlan] = useState(false);
  const plan = iteracion.plan;
  const foco = pasoFoco(iteracion);
  const iFoco = foco && foco.estado !== 'hecho' ? plan.indexOf(foco) : plan.length;
  const avance = foco ? avanceDe(iteracion, foco) : null;
  const fases = plan.map((p) => faseDe(p, foco));
  const n = (f: Fase) => fases.filter((x) => x === f).length;
  const ids = new Set(plan.map((p) => p.id));
  const fuera = iteracion.pistas.filter((p) => !p.pasoId || !ids.has(p.pasoId));
  const tramo = (j: number) => (j + 1 <= iFoco ? 'esc-tramo-hecho' : j === iFoco ? 'esc-tramo-foco' : '');
  const pasoAbierto = plan.find((p) => p.id === abierto) ?? null;
  const pistasAbiertas = abierto === 'fuera' ? fuera : pasoAbierto ? iteracion.pistas.filter((p) => p.pasoId === pasoAbierto.id) : [];

  return (
    <section className="esc-tarjeta esc-recorrido" aria-label={tr('Recorrido de la iteración')}>
      <header className="esc-tarjeta-cabecera">
        <div>
          <h3>{trp('El recorrido de la iteración {n}', { n: iteracion.numero })}</h3>
          <p>{plan.length === 1 ? tr('Un paso aprobado con el plan. Púlsalo para ver sus pistas.') : trp('{n} pasos aprobados con el plan. Pulsa uno para ver sus pistas.', { n: cuantos(plan.length) })}</p>
        </div>
        <ul className="esc-leyenda">
          <li>
            <i className="esc-punto-hecho" />
            {n('hecho') === 1 ? tr('1 hecho') : trp('{n} hechos', { n: n('hecho') })}
          </li>
          {n('fallido') > 0 && (
            <li>
              <i className="esc-punto-fallido" />
              {n('fallido') === 1 ? tr('1 fallido') : trp('{n} fallidos', { n: n('fallido') })}
            </li>
          )}
          {n('foco') > 0 && (
            <li>
              <i className="esc-punto-foco" />
              {foco?.estado === 'en_curso' && trabajando ? tr('1 en curso') : tr('1 donde se quedó')}
            </li>
          )}
          <li>
            <i className="esc-punto-futuro" />
            {trp('{n} por delante', { n: n('futuro') })}
          </li>
        </ul>
      </header>

      <ol className="esc-riel" style={{ gridTemplateColumns: `repeat(${plan.length}, minmax(120px, 1fr))` }}>
        {plan.map((p, i) => {
          const fase = fases[i]!;
          return (
            <li key={p.id} className={`esc-etapa esc-etapa-${fase} ${abierto === p.id ? 'esc-etapa-abierta' : ''}`}>
              <button type="button" className="esc-etapa-boton" aria-expanded={abierto === p.id} onClick={() => setAbierto((x) => (x === p.id ? null : p.id))}>
                <span className="esc-nodo-fila">
                  <i className={`esc-tramo ${i === 0 ? 'esc-tramo-nada' : tramo(i - 1)}`} aria-hidden="true" />
                  <span className="esc-nodo">
                    {fase === 'foco' && <span className={`esc-nodo-aro ${trabajando ? 'esc-nodo-aro-vivo' : ''}`} aria-hidden="true" />}
                    <IconoEsc nombre={iconoDePaso(p.tipo)} size={fase === 'foco' ? 22 : 18} />
                    {fase === 'hecho' && (
                      <span className="esc-insignia" aria-hidden="true">
                        <IconoEsc nombre="check" size={10} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <i className={`esc-tramo ${i === plan.length - 1 ? 'esc-tramo-nada' : tramo(i)}`} aria-hidden="true" />
                </span>
                <span className="esc-etapa-texto">
                  <span className="esc-etapa-num">
                    {String(i + 1).padStart(2, '0')} · {nombreDeTipo(p.tipo)}
                  </span>
                  <span className="esc-etapa-titulo">{p.titulo}</span>
                  <span className="esc-etapa-resultado">{resultadoDePaso(iteracion, p, foco, avance)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <AnimatePresence initial={false}>
        {(pasoAbierto || abierto === 'fuera') && (
          <motion.div
            key={abierto}
            className="esc-pistas"
            initial={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reducido ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="esc-pistas-dentro">
              {pasoAbierto ? (
                <>
                  <p className="esc-pistas-titulo">{pasoAbierto.titulo}</p>
                  {pasoAbierto.detalle && <p className="esc-pistas-detalle">{pasoAbierto.detalle}</p>}
                  {pasoAbierto.indicacionHumana && <p className="esc-pistas-detalle">{tr('Este paso lo pidió una persona al dirigir la corrida.')}</p>}
                </>
              ) : (
                <p className="esc-pistas-titulo">{tr('Pistas fuera del plan')}</p>
              )}
              {pistasAbiertas.length === 0 ? (
                <p className="esc-pistas-detalle">{pasoAbierto?.estado === 'pendiente' ? tr('Todavía no ha lanzado pistas: el paso está por delante.') : tr('Sin pistas registradas.')}</p>
              ) : (
                <ul>
                  {pistasAbiertas.map((x) => (
                    <FilaPista key={x.id} pista={x} onDetener={onDetenerPista} />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="esc-recorrido-pie">
        {fuera.length > 0 && (
          <button type="button" className="esc-chip" aria-expanded={abierto === 'fuera'} onClick={() => setAbierto((x) => (x === 'fuera' ? null : 'fuera'))}>
            {fuera.length === 1 ? tr('1 pista fuera del plan') : trp('{n} pistas fuera del plan', { n: fuera.length })}
          </button>
        )}
        {planCompleto && (
          <button type="button" className="esc-enlace" aria-expanded={verPlan} onClick={() => setVerPlan((v) => !v)}>
            {verPlan ? tr('Ocultar el plan completo') : tr('Ver el plan completo')}
            <IconoEsc nombre={verPlan ? 'chevron-down' : 'chevron-right'} size={14} />
          </button>
        )}
      </div>
      {verPlan && planCompleto && <div className="esc-plan-completo">{planCompleto}</div>}
    </section>
  );
}

const ESTADO_PISTA: Record<Pista['estado'], string> = { en_curso: 'en curso', hecha: 'hecha', fallida: 'fallida', detenida: 'detenida' };

function FilaPista({ pista, onDetener }: { pista: Pista; onDetener?: (id: string) => void }) {
  return (
    <li className={`esc-pista esc-pista-${pista.estado}`}>
      <i aria-hidden="true" />
      <div>
        <p>
          <strong>{pista.titulo}</strong>
        </p>
        <p className="esc-pista-meta">
          {pista.fuente}
          {pista.ms > 0 && ` · ${formatearDuracion(pista.ms)}`} · {tr(ESTADO_PISTA[pista.estado])}
        </p>
        {pista.resumen && <p className="esc-pista-resumen">{pista.resumen}</p>}
      </div>
      {pista.estado === 'en_curso' && onDetener && (
        <button type="button" className="esc-boton esc-boton-s" onClick={() => onDetener(pista.id)}>
          {tr('Detener pista')}
        </button>
      )}
    </li>
  );
}
