// El plan de la iteracion con sus pasos marcandose, y bajo cada paso los
// marcadores de sus pistas paralelas. Pulsar una pista abre su transcripcion
// con cada consulta a una fuente expandible (parametros exactos y lo que
// devolvio). Un paso fallido lleva su motivo. Una pista en curso se puede
// detener sin parar la corrida.
//
// Si el plan no esta aprobado, se ensena el editor: reordenar, quitar,
// anadir, fijar presupuesto por paso, y "Aprobar plan" (patron de
// Biomni-AD, Devin y Magentic-UI; Claude Science espera la aprobacion desde
// la 0.1.27).

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { RESORTE, useMovimientoReducido } from '../lib/movimiento';
import type { Iteracion, PasoPlan, Pista } from '../datos/tipos';
import { ESTADO_PISTA, TIPO_PISTA, mostrarTexto } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import { IconAlert, IconCheck, IconChevronDown, IconMinus, IconSpinner, IconStop, IconTrash, IconUser } from './icons';
import { Chip, Momento } from './piezas';
import { tr } from '../lib/idioma';

function IconoPaso({ paso }: { paso: PasoPlan }) {
  if (paso.estado === 'en_curso') return <IconSpinner size={12} />;
  if (paso.estado === 'hecho') return <IconCheck size={12} />;
  if (paso.estado === 'fallido') return <IconAlert size={12} />;
  if (paso.indicacionHumana) return <IconUser size={12} />;
  if (paso.estado === 'omitido' || paso.estado === 'sin_trabajo') return <IconMinus size={12} />;
  return <span className="mono" style={{ fontSize: 10 }} />;
}

function Consulta({ c }: { c: NonNullable<Pista['transcripcion'][number]['consulta']> }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="consulta">
      <button type="button" className="consulta-cabecera" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
        <span>Consulta a {c.base}</span>
        <span style={{ transform: abierta ? 'rotate(180deg)' : 'none', display: 'inline-flex' }}>
          <IconChevronDown size={11} />
        </span>
      </button>
      {abierta && (
        <dl className="consulta-detalle">
          <dt>{tr("Parámetros")}</dt>
          <dd className="mono">{c.parametros}</dd>
          <dt>{tr("Devolvió")}</dt>
          <dd>{c.resultados}</dd>
        </dl>
      )}
    </div>
  );
}

export function Transcripcion({ pista, ahora, onDetener }: { pista: Pista; ahora: number; onDetener?: (indicacion: string) => void }) {
  const [indicacion, setIndicacion] = useState('');
  return (
    <div>
      <p className="meta" style={{ marginBottom: 6 }}>
        {TIPO_PISTA[pista.tipo]} · {pista.fuente} · {ESTADO_PISTA[pista.estado]}
        {pista.ms > 0 && ` · ${formatearDuracion(pista.ms)}`}
      </p>
      {pista.transcripcion.length === 0 ? (
        <p className="meta">{tr("Todavía sin actividad registrada.")}</p>
      ) : (
        <ol className="transcripcion" aria-label={`Transcripción de ${pista.titulo}`}>
          <AnimatePresence initial={false}>
            {pista.transcripcion.map((e, i) => (
              <motion.li key={`${e.t}-${i}`} className={`t-${e.tipo}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
                <time>{formatearDuracion(e.t) || '0 s'}</time>
                <div>
                  <span>{mostrarTexto(e.texto)}</span>
                  {e.consulta && <Consulta c={e.consulta} />}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {pista.estado === 'en_curso' && onDetener && (
        <div className="dirigir" style={{ marginTop: 8 }}>
          <input className="entrada entrada-s" value={indicacion} placeholder={tr("Indicación para ROSA2018 al detenerla (opcional)")} onChange={(e) => setIndicacion(e.target.value)} aria-label={tr("Indicación al detener la pista")} />
          <button type="button" className="btn btn-s btn-peligro" onClick={() => onDetener(indicacion)}>
            <IconStop size={11} /> {tr("Detener esta pista")}
          </button>
        </div>
      )}
      <span className="sr-only">{ahora}</span>
    </div>
  );
}

export function MarcadorPista({ pista, abierta, onClick }: { pista: Pista; abierta: boolean; onClick: () => void }) {
  const reducido = useMovimientoReducido();
  return (
    <motion.button type="button" className={`pista pista-${pista.estado}`} aria-expanded={abierta} onClick={onClick} title={`${TIPO_PISTA[pista.tipo]} · ${pista.fuente}`} layout={!reducido} initial={reducido ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={RESORTE}>
      <i aria-hidden="true" />
      <span>{pista.titulo}</span>
      <span className="meta">{pista.estado === 'en_curso' ? 'trabajando' : pista.resumen}</span>
      {pista.estado === 'en_curso' && !reducido && <motion.b className="pista-actividad" aria-hidden="true" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />}
    </motion.button>
  );
}

interface Props {
  iteracion: Iteracion;
  ahora: number;
  onDetenerPista?: (pistaId: string, indicacion: string) => void;
  onEditarPlan?: (plan: PasoPlan[]) => void;
  onAprobarPlan?: () => void;
}

export function PlanEnVivo({ iteracion, ahora, onDetenerPista, onEditarPlan, onAprobarPlan }: Props) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nuevoPaso, setNuevoPaso] = useState('');
  const pistaAbierta = iteracion.pistas.find((p) => p.id === abierta) ?? null;
  const editable = !iteracion.planAprobado && onEditarPlan !== undefined;

  const mover = (i: number, d: -1 | 1) => {
    const plan = [...iteracion.plan];
    const j = i + d;
    if (j < 0 || j >= plan.length) return;
    [plan[i], plan[j]] = [plan[j]!, plan[i]!];
    onEditarPlan?.(plan);
  };

  if (editable) {
    return (
      <div className="plan-editor">
        <div className="acciones" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong style={{ fontSize: 13 }}>{tr("Plan propuesto para la iteración")} {iteracion.numero}</strong>
            <p className="meta">
              Propuesto <Momento t={iteracion.planPropuestoEn} ahora={ahora} />{tr(". ROSA2018 no ejecuta nada hasta que lo apruebes. Reordena, quita o añade pasos y fija el presupuesto de cada uno.")}
            </p>
          </div>
          <button type="button" className="btn btn-primario" onClick={onAprobarPlan}>
            {tr("Aprobar plan y ejecutar")}
          </button>
        </div>
        <ol className="plan plan-edicion">
          {iteracion.plan.map((paso, i) => (
            <li key={paso.id} className="paso paso-pendiente">
              <span className="paso-icono mono" aria-hidden="true" style={{ fontSize: 10 }}>
                {i + 1}
              </span>
              <div className="paso-cuerpo">
                <div className="paso-fila-edicion">
                  <input
                    className="entrada entrada-s"
                    key={`t-${paso.id}-${paso.titulo}`}
                    defaultValue={paso.titulo}
                    onBlur={(e) => {
                      const t = e.target.value.trim();
                      if (t && t !== paso.titulo) onEditarPlan?.(iteracion.plan.map((p) => (p.id === paso.id ? { ...p, titulo: t } : p)));
                    }}
                    aria-label={`Título del paso ${i + 1}`}
                  />
                  <input
                    className="entrada entrada-s"
                    type="number"
                    min={0}
                    key={`p-${paso.id}-${paso.presupuesto ?? ''}`}
                    defaultValue={paso.presupuesto ?? ''}
                    placeholder="llamadas"
                    style={{ maxWidth: 110 }}
                    onBlur={(e) => {
                      const nuevo = e.target.value === '' ? null : Number(e.target.value);
                      if (nuevo !== null && !(Number.isFinite(nuevo) && nuevo >= 0)) return;
                      if (nuevo !== (paso.presupuesto ?? null)) onEditarPlan?.(iteracion.plan.map((p) => (p.id === paso.id ? { ...p, presupuesto: nuevo } : p)));
                    }}
                    aria-label={`Presupuesto del paso ${i + 1}`}
                  />
                  <button type="button" className="btn btn-fantasma btn-icono btn-s" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                    <IconChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button type="button" className="btn btn-fantasma btn-icono btn-s" aria-label="Bajar" disabled={i === iteracion.plan.length - 1} onClick={() => mover(i, 1)}>
                    <IconChevronDown size={12} />
                  </button>
                  <button type="button" className="btn btn-fantasma btn-icono btn-s" aria-label={tr("Quitar paso")} disabled={iteracion.plan.length === 1} onClick={() => onEditarPlan?.(iteracion.plan.filter((p) => p.id !== paso.id))}>
                    <IconTrash size={12} />
                  </button>
                </div>
                {paso.detalle !== '' && <p className="paso-detalle">{paso.detalle}</p>}
                {paso.valorDecision ? <p className="paso-detalle paso-valor" title={tr("Qué decisión cambia según el resultado de este paso (valor de decisión)")}>Decide: {paso.valorDecision}</p> : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="dirigir">
          <input className="entrada entrada-s" value={nuevoPaso} placeholder={tr("Añadir un paso")} onChange={(e) => setNuevoPaso(e.target.value)} aria-label={tr("Paso nuevo")} />
          <button
            type="button"
            className="btn btn-s"
            disabled={nuevoPaso.trim() === ''}
            onClick={() => {
              onEditarPlan?.([...iteracion.plan, { id: `paso-h-${Date.now()}`, titulo: nuevoPaso.trim(), detalle: '', estado: 'pendiente', indicacionHumana: true, motivoFallo: null, presupuesto: null }]);
              setNuevoPaso('');
            }}
          >
            {tr("Añadir")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <ol className="plan" aria-label={`Plan de la iteración ${iteracion.numero}`}>
      {iteracion.plan.map((paso) => {
        const pistas = iteracion.pistas.filter((p) => p.pasoId === paso.id);
        return (
          <motion.li key={paso.id} className={`paso paso-${paso.estado} ${paso.indicacionHumana ? 'paso-humano' : ''}`} layout transition={RESORTE} initial={false} animate={paso.estado === 'en_curso' ? { backgroundColor: 'var(--accent-soft)' } : { backgroundColor: 'rgba(0,0,0,0)' }}>
            <span className="paso-icono" aria-hidden="true">
              <IconoPaso paso={paso} />
            </span>
            <div className="paso-cuerpo">
              <div className="paso-titulo">
                <span className={paso.estado === 'en_curso' ? 'shimmer-text' : ''}>{paso.titulo}</span>
                {paso.indicacionHumana && <Chip tono="acento">{tr("Indicación tuya")}</Chip>}
                {paso.estado === 'fallido' && <Chip tono="mal">Fallido</Chip>}
                {paso.estado === 'sin_trabajo' && <Chip tono="borde">{tr("Sin trabajo")}</Chip>}
                {paso.comprobacion && paso.comprobacion.resultado !== 'pasa' && (
                  <Chip tono={paso.comprobacion.resultado === 'falla' ? 'mal' : 'aviso'}>
                    {paso.comprobacion.resultado === 'falla' ? tr('La etapa no produjo nada') : paso.comprobacion.resultado === 'no_comprobable' ? 'No se pudo comprobar' : tr('Sin materia')}
                  </Chip>
                )}
                {paso.presupuesto !== null && <span className="meta">hasta {paso.presupuesto} llamadas</span>}
              </div>
              {paso.detalle !== '' && <p className="paso-detalle">{paso.detalle}</p>}
              {paso.motivoFallo && <p className="paso-fallo">{paso.motivoFallo}</p>}
              {paso.comprobacion && paso.comprobacion.resultado !== 'pasa' && <p className="paso-fallo">{paso.comprobacion.detalle}</p>}
              {paso.comprobacion?.aviso && <p className="meta">{paso.comprobacion.aviso}</p>}
              {pistas.length > 0 && (
                <div className="pistas">
                  {pistas.map((p) => (
                    <MarcadorPista key={p.id} pista={p} abierta={abierta === p.id} onClick={() => setAbierta(abierta === p.id ? null : p.id)} />
                  ))}
                </div>
              )}
              {pistaAbierta !== null && pistaAbierta.pasoId === paso.id && (
                <Transcripcion pista={pistaAbierta} ahora={ahora} onDetener={onDetenerPista ? (ind) => onDetenerPista(pistaAbierta.id, ind) : undefined} />
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
