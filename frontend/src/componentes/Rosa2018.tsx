// Las piezas de la interfaz que trae el documento de concepto ROSA2018
// (septiembre de 2026): la mision estructurada, la tarjeta de la hipotesis
// con sus versiones, las decisiones del Hypothesis Killer con sus
// comprobaciones y su auditoria, los bloqueos no compensables, las
// ejecuciones in silico con plan congelado y auditoria, la puerta de
// reproduccion, el libro de procedencia de un dataset y el registro de
// aprendizaje en tres niveles. Cada pieza dice que es y por que esta, para
// que quien no vivio el documento la entienda igual.

import { useEffect, useState } from 'react';
import { acciones, useRosa } from '../datos/almacen';
import { CAMPOS_ENMENDABLES, CAMPOS_LECTURA_ENMENDABLES, NIVELES_DESENLACE, PROPOSITOS_BIOMARCADOR, SISTEMAS_EXPERIMENTALES, TIPOS_LECTURA, empeoraAlEvaluar, etiquetaContrato, hashLecturas, normalizarContrato } from '../datos/acciones';
import type { CampoLecturaEnmendable, CapaPerfilDiana, EnmiendaPrerregistro, EstadoPasoRuta, LecturaExperimento, PasoRutaEvaluado, RutaTerapeuticaEvaluada, VeredictoLectura, CambioAprendizaje, CasoDorado, Comprobacion, ConocimientoOperativo, EntidadCanonica, Corrida, Dataset, Decision, DimensionesResultado, Ejecucion, EstadoRosa, Hipotesis, Investigacion, MetodoRegistrado, PasoRutaTerapeutica, PlanAnalisis, PreguntaCampana, ProcedenciaDataset, Reproduccion, Responsables, CampoEnmendable, AreaInvestigacion, ConectorCatalogo, RevisionRegistro, ProcedenciaArtefacto, ConsultaBase, NivelPermisoConector, SkillCatalogo, EstadoEspejo } from '../datos/tipos';
import {
  ACCESO_DATASET,
  BLOQUEO,
  CLASE_EVIDENCIA,
  COMPROBACION_KILLER,
  DECISION_KILLER,
  DIMENSION_RESULTADO,
  ESTADO_APRENDIZAJE,
  ESTADO_EJECUCION,
  ESTADO_METODO,
  ESTADO_REPRODUCCION,
  ETAPA_DECISION,
  INTERPRETACION_EJECUCION,
  NIVEL_APRENDIZAJE,
  PASO_RUTA,
  RESULTADO_COMPROBACION,
  RUNTIME_EJECUCION,
  TIPO_APRENDIZAJE,
  TIPO_METODO,
  USO_IA,
  VEREDICTO_AUDITORIA, IDENTIFICACION_CAUSAL, TIPO_ARISTA, GRUPO_CONECTOR, ESTADO_CONECTOR, CLASE_HALLAZGO_REGISTRO, RELACION_TORNEO, ESTADO_PASO_RUTA, DEFINICION_PASO_RUTA, CAPA_DIANA, ORDEN_CAPAS_DIANA, ESTADO_CAPA_DIANA, DIRECCION_GENETICA, RAMA_NEGATIVO, killerPendienteDe, nombreActor } from '../lib/etiquetas';
import { EXPLICACION_BLOQUEO } from '../lib/priorizacion';
import { cambiosPorVersion, etiquetaCampo, resumenDiff } from '../lib/registro';
import { rutaDe } from '../lib/ruta';
import { Chip, Confirmar, Momento, Seccion } from './piezas';
import { Cargando, Esqueleto, EsqueletoTexto } from './Esqueleto';

/** Lo que devuelve el almacén cuando el servidor está pero no contestó a tiempo (almacen.ts, SinRespuesta). */
type SinRespuestaServidor = 'sin_respuesta';
import { atributosEnVuelo, useEnVuelo } from '../lib/diferido';
import { traducido, tr } from '../lib/idioma';
import { coma } from '../lib/formato';

/* ---------------------------------------------------------------------
   Mision
   --------------------------------------------------------------------- */

export function FormularioMision({ inv, compacto = false, corridas = [] }: { inv: Investigacion; compacto?: boolean; corridas?: Corrida[] }) {
  const m = inv.mision;
  const [editando, setEditando] = useState(m === null || m === undefined);
  const [d, setD] = useState(() => ({
    poblacion: m?.poblacion ?? '',
    etapa: m?.etapa ?? '',
    celulaTejido: m?.celulaTejido ?? '',
    mecanismo: m?.mecanismo ?? '',
    tipoIntervencion: m?.tipoIntervencion ?? '',
    capacidades: (m?.capacidadesLaboratorio ?? []).join('\n'),
    llamadas: String(m?.presupuesto.llamadas ?? 1500),
    usd: String(m?.presupuesto.usd ?? 60),
    horas: String(m?.presupuesto.horas ?? 72),
  }));
  const [resp, setResp] = useState<Responsables>(() => ({ patrocinador: '', liderCientifico: '', metodos: '', datos: '', ingenieria: '', laboratorio: '', evaluacion: '', ...(m?.responsables ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  // Si ROSA2018 propone o cambia la mision mientras no se esta editando, el
  // formulario se rehidrata: lo que se ve es lo que hay, no lo del primer render.
  const firmaMision = JSON.stringify(m ?? null);
  useEffect(() => {
    if (editando) return;
    setD({
      poblacion: m?.poblacion ?? '',
      etapa: m?.etapa ?? '',
      celulaTejido: m?.celulaTejido ?? '',
      mecanismo: m?.mecanismo ?? '',
      tipoIntervencion: m?.tipoIntervencion ?? '',
      capacidades: (m?.capacidadesLaboratorio ?? []).join('\n'),
      llamadas: String(m?.presupuesto.llamadas ?? 1500),
      usd: String(m?.presupuesto.usd ?? 60),
      horas: String(m?.presupuesto.horas ?? 72),
    });
    setResp({ patrocinador: '', liderCientifico: '', metodos: '', datos: '', ingenieria: '', laboratorio: '', evaluacion: '', ...(m?.responsables ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaMision, inv.id]);
  const ROLES: { k: keyof Responsables; label: string; nota: string }[] = [
    { k: 'patrocinador', label: 'Patrocinador', nota: tr('Fija prioridades y autoriza recursos') },
    { k: 'liderCientifico', label: tr('Líder científico'), nota: tr('Aprueba criterios científicos e interpretaciones mayores') },
    { k: 'metodos', label: tr('Métodos'), nota: tr('Válida los métodos causales y estadísticos') },
    { k: 'datos', label: 'Datos', nota: tr('Bioinformatica y libro de procedencia') },
    { k: 'ingenieria', label: tr('Ingeniería'), nota: tr('Ejecución e integridad de los registros') },
    { k: 'laboratorio', label: 'Laboratorio', nota: tr('Protocolos físicos y calidad') },
    { k: 'evaluacion', label: tr('Evaluación'), nota: tr('Conjuntos reservados y comparaciones; no es quien escribe la conclusión') },
  ];
  const campo = (k: keyof typeof d, label: string, marcador: string, filas = 1) => (
    <div className="campo" key={k}>
      <label htmlFor={`mis-${k}`}>{label}</label>
      {filas > 1 ? <textarea id={`mis-${k}`} rows={filas} value={d[k]} placeholder={marcador} onChange={(e) => setD({ ...d, [k]: e.target.value })} /> : <input id={`mis-${k}`} value={d[k]} placeholder={marcador} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
    </div>
  );
  const guardar = () => {
    const llamadas = Number(d.llamadas);
    const usd = Number(d.usd);
    const horas = Number(d.horas);
    if (![llamadas, usd, horas].every((n) => Number.isFinite(n) && n > 0)) {
      setError(tr('El presupuesto (llamadas, USD y horas) tiene que ser un número mayor que cero.'));
      return;
    }
    setError(null);
    acciones.aprobarMision(inv.id, {
      poblacion: d.poblacion,
      etapa: d.etapa,
      celulaTejido: d.celulaTejido,
      mecanismo: d.mecanismo,
      tipoIntervencion: d.tipoIntervencion,
      capacidadesLaboratorio: d.capacidades.split('\n').map((c) => c.trim()).filter(Boolean),
      presupuesto: { llamadas, usd, horas },
      responsables: resp,
    });
    setEditando(false);
  };
  if (!m && !editando) return null;
  if (!editando && m) {
    return (
      <div className="tarjeta seccion mision">
        <div className="acciones" style={{ justifyContent: 'space-between' }}>
          <div className="acciones">
            {m.aprobadaEn ? (
              <Chip tono="ok" title={`Aprobada por ${m.aprobadaPor ?? tr('una persona')}`}>
                Aprobada <Momento t={m.aprobadaEn} ahora={Date.now()} soloRelativo />
              </Chip>
            ) : (
              <Chip tono="aviso">{tr("Propuesta por ROSA2018: falta tu aprobación")}</Chip>
            )}
            {m.propuestaPorRosa && <Chip tono="borde">{tr("Valores propuestos por ROSA2018")}</Chip>}
          </div>
          <div className="acciones">
            {!m.aprobadaEn && (
              <button type="button" className="btn btn-primario btn-s" onClick={() => acciones.aprobarMision(inv.id, {})}>
                Aprobar tal cual
              </button>
            )}
            <button type="button" className="btn btn-s" onClick={() => setEditando(true)}>
              {m.aprobadaEn ? 'Editar' : tr('Corregir y aprobar')}
            </button>
          </div>
        </div>
        <dl className={`comprobacion ${compacto ? 'mision-compacta' : ''}`}>
          <dt>{tr("Población")}</dt>
          <dd>{m.poblacion || tr('sin fijar')}</dd>
          <dt>Etapa</dt>
          <dd>{m.etapa || tr('sin fijar')}</dd>
          <dt>{tr("Célula o tejido")}</dt>
          <dd>{m.celulaTejido || tr('sin fijar')}</dd>
          <dt>Mecanismo</dt>
          <dd>{m.mecanismo || tr('sin fijar')}</dd>
          <dt>{tr("Tipo de intervención")}</dt>
          <dd>{m.tipoIntervencion || tr('sin fijar')}</dd>
          <dt>{tr("Capacidades del laboratorio")}</dt>
          <dd>{m.capacidadesLaboratorio.length ? m.capacidadesLaboratorio.join('; ') : tr('sin declarar')}</dd>
          <dt>Presupuesto</dt>
          <dd>
            {m.presupuesto.llamadas} llamadas · {m.presupuesto.usd.toFixed(0)} USD estimados · {m.presupuesto.horas} h
          </dd>
          <dt>Responsables</dt>
          <dd>
            {m.responsables && Object.values(m.responsables).some((v) => v) ? (
              ROLES.filter((r) => m.responsables?.[r.k]).map((r) => `${r.label}: ${m.responsables?.[r.k]}`).join(' · ')
            ) : (
              <span className="tono-aviso">{tr("sin asignar: quien escribe una conclusión no puede ser su único evaluador")}</span>
            )}
          </dd>
        </dl>
        {(m.areas?.length ?? 0) > 0 && !compacto && (
          <details className="versiones" open>
            <summary>{tr("Áreas de investigación que ROSA2018 comparo (")}{m.areas!.length}{tr("); empieza por las elegidas")}</summary>
            <p className="meta">{tr("Se comparan por relevancia para la meta, valor de intervención, incertidumbre, comprobabilidad, coste, demora y dependencia, conservando familias de mecanismo distintas. La disponibilidad de datos no sustituye a la relevancia. Un mecanismo desconocido sigue siendo una explicación permitida.")}</p>
            {/* Siete columnas de prosa no caben en el ancho del contenido: el
                navegador partía las palabras ("Famil / ia"). El contenedor se
                desplaza y la tabla se queda entera (28 de septiembre de 2026). */}
            <div className="tabla-desliza">
            <table className="tabla tabla-ancha">
              <thead>
                <tr>
                  <th>{tr("Área")}</th>
                  <th>Familia</th>
                  <th>Relevancia</th>
                  <th>Comprobabilidad</th>
                  <th>{tr("Coste y demora")}</th>
                  <th>Estado</th>
                  <th>Gobierno</th>
                </tr>
              </thead>
              <tbody>
                {m.areas!.map((a) => (
                  <FilaArea key={a.id} inv={inv} a={a} corridas={corridas} />
                ))}
              </tbody>
            </table>
            </div>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="tarjeta seccion mision">
      <p className="meta">{tr("La misión fija el marco antes de la primera corrida: a quien aplica, en que etapa, en que célula o tejido, que mecanismo, que tipo de resultado se busca y que puede hacer el laboratorio. Lo que se deje en blanco queda \"sin fijar\" y ROSA2018 no lo inventa.")}</p>
      <div className="rejilla-2">
        {campo('poblacion', tr('Población'), tr('Adultos con deterioro cognitivo leve, amiloide positivos'))}
        {campo('etapa', tr('Etapa de la enfermedad'), 'Prodromica')}
        {campo('celulaTejido', 'Célula o tejido', tr('Astrocitos; plasma'))}
        {campo('mecanismo', 'Mecanismo', tr('Reactividad astrocitaria'))}
        {campo('tipoIntervencion', tr('Tipo de intervención o resultado'), tr('Biomarcador de progresión'))}
        {campo('capacidades', tr('Capacidades del laboratorio (una por línea)'), tr('Inmunoensayo Simoa en plasma\nPET de amiloide'), 3)}
      </div>
      <div className="rejilla-3">
        {campo('llamadas', tr('Presupuesto en llamadas al modelo'), '1500')}
        {campo('usd', tr('Presupuesto en dólares (estimado por tokens)'), '60')}
        {campo('horas', tr('Presupuesto en horas de reloj'), '72')}
      </div>
      <p className="campo-etiqueta">{tr("Responsables (se pueden combinar, pero quien escribe una conclusión no es su único evaluador)")}</p>
      <div className="rejilla-3">
        {ROLES.map((r) => (
          <div className="campo" key={r.k}>
            <label htmlFor={`resp-${r.k}`} title={r.nota}>
              {r.label}
            </label>
            <input id={`resp-${r.k}`} value={resp[r.k]} placeholder={r.nota} onChange={(e) => setResp({ ...resp, [r.k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="acciones">
        {error && <p className="tono-mal" role="alert" style={{ fontSize: 13 }}>{error}</p>}
        <button type="button" className="btn btn-primario" onClick={guardar}>
          {tr("Aprobar la misión")}
        </button>
        {m && (
          <button type="button" className="btn btn-fantasma" onClick={() => setEditando(false)}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Tarjeta, versiones, bloqueos
   --------------------------------------------------------------------- */

export function TarjetaDeHipotesis({ h }: { h: Hipotesis }) {
  const t = h.tarjeta;
  return (
    <Seccion titulo={tr("Tarjeta de la hipótesis")} nota={tr("El contrato mínimo para que el Killer la juzgue y un laboratorio la ejecute: diana, célula, etapa, intervención, la predicción que la refutaría y sus riesgos. Sin predicción falsable no avanza.")}>
      {t === null || t === undefined ? (
        <>
          <p className="meta">{t === null ? tr('ROSA2018 no pudo rellenar la tarjeta.') : tr('ROSA2018 todavía no rellena la tarjeta de esta hipótesis.')}</p>
          {h.ruta && typeof h.ruta === 'object' && (
            <div>
              <p className="campo-etiqueta">{tr("Ruta terapéutica")}</p>
              <RutaTerapeutica paso={rutaValida(h.ruta.declarado) ?? 'mecanismo'} ruta={h.ruta} />
            </div>
          )}
        </>
      ) : (
        <dl className="comprobacion tarjeta-hip">
          <dt>{tr("Diana o proceso")}</dt>
          <dd>
            {t.diana || tr('sin especificar')} <Entidades entidades={h.entidades} />
          </dd>
          <dt>{tr("Célula o tejido")}</dt>
          <dd>{t.celula || tr('sin especificar')}</dd>
          <dt>Etapa</dt>
          <dd>{t.etapa || tr('sin especificar')}</dd>
          <dt>{tr("Intervención")}</dt>
          <dd>
            {t.intervencion || 'ninguna'} <Chip tono="borde">{t.direccion.replace('_', ' ')}</Chip>
          </dd>
          <dt>{tr("Predicción falsable")}</dt>
          <dd className={t.prediccionFalsable ? '' : 'tono-mal'}>{t.prediccionFalsable || tr('NINGUNA: así no es evaluable')}</dd>
          <dt>Riesgos</dt>
          <dd>{t.riesgos.length ? <ul className="lista-limpia">{t.riesgos.map((r, i) => <li key={i}>{r}</li>)}</ul> : tr('ninguno declarado')}</dd>
          <dt>{tr("Ruta terapéutica")}</dt>
          <dd>
            <RutaTerapeutica paso={t.pasoRuta ?? 'mecanismo'} ruta={h.ruta} />
          </dd>
        </dl>
      )}
      {(h.versiones?.length ?? 0) > 0 && (
        <details className="versiones">
          <summary>
            {tr("Versión")} {h.version ?? 1} · {h.versiones!.length} {h.versiones!.length === 1 ? tr('versión anterior') : tr('versiones anteriores')} {tr("(reformular no sobrescribe)")}
          </summary>
          <ul className="lista-limpia">
            {cambiosPorVersion(h.versiones!, h).map(({ version: v, deN, aN, cambios }) => (
              <li key={v.n ?? deN}>
                <div>
                  <strong style={{ fontSize: 13 }}>
                    v{deN} · {nombreActor(v.quien)} · <Momento t={v.fecha ?? 0} ahora={Date.now()} />
                    {v.certeza ? ` · certeza ${v.certeza.replace('_', ' ')}` : ''}
                    {typeof v.nFuentes === 'number' ? ` · ${v.nFuentes} fuentes` : ''}
                  </strong>
                  <p style={{ fontSize: 13 }}>{v.titulo}</p>
                  <p className="meta">{v.enunciado}</p>
                  <p className="meta">{tr("Por qué cambió:")} {v.motivo}</p>
                  <p className="meta">
                    {tr("De la v")}{deN} a la v{aN}: {resumenDiff(cambios)}
                  </p>
                  {cambios.length > 0 && (
                    <ul className="version-cambios">
                      {cambios.map((c) => (
                        <li key={c.campo}>
                          <strong>{etiquetaCampo(c.campo)}</strong>: <s>{c.antes || tr('vacío')}</s> → {c.despues || tr('vacío')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Seccion>
  );
}

/** El paso si es uno de los ocho de la ruta; null si la tarjeta declaró otra cosa. */
function rutaValida(p: unknown): PasoRutaTerapeutica | null {
  return typeof p === 'string' && Object.hasOwn(PASO_RUTA, p) ? (p as PasoRutaTerapeutica) : null;
}

/** El estado de un paso tal como lo calculó la regla, o null si el registro
 *  no lo trae o trae algo que esta versión no conoce. */
function estadoDePaso(ruta: RutaTerapeuticaEvaluada | null | undefined, p: PasoRutaTerapeutica): PasoRutaEvaluado | null {
  const lista = Array.isArray(ruta?.pasos) ? ruta!.pasos : [];
  const x = lista.find((y) => y && typeof y === 'object' && y.paso === p);
  return x ?? null;
}

const COLOR_ESTADO_PASO: Record<EstadoPasoRuta, string> = { cubierto: 'var(--green)', parcial: 'var(--amber)', vacio: 'var(--red)', no_comprobable: 'var(--text-3)' };

/** La ruta terapéutica del plan completo, con el paso actual marcado. Una
 *  campaña celular completada no completa la ruta. Con `ruta` (lo que calcula
 *  rosa/ruta.py por regla), cada paso lleva delante el símbolo de su estado
 *  (cubierto, parcial, vacío, no comprobable) con el motivo al pasar el
 *  ratón, el resumen en llano va encima de la lista y, si el paso que declara
 *  la tarjeta va por delante de la evidencia, se avisa. Los estados se pintan
 *  con estilo en línea a propósito: no se crean clases CSS nuevas. */
export function RutaTerapeutica({ paso, ruta = null }: { paso: PasoRutaTerapeutica; ruta?: RutaTerapeuticaEvaluada | null }) {
  const pasos = (Object.keys(PASO_RUTA) as PasoRutaTerapeutica[]).sort((a, b) => PASO_RUTA[a].orden - PASO_RUTA[b].orden);
  const actual = rutaValida(paso) ?? 'mecanismo';
  const evaluada = ruta && typeof ruta === 'object' && Array.isArray(ruta.pasos) ? ruta : null;
  return (
    <div>
      {evaluada && typeof evaluada.resumen === 'string' && evaluada.resumen !== '' && (
        <p className="meta" style={{ marginBottom: 4 }} data-ruta-resumen>
          {evaluada.resumen}
        </p>
      )}
      {evaluada && evaluada.coherente === false && (
        <div className="acciones" style={{ marginBottom: 4 }}>
          <Chip tono="aviso" title={tr("La tarjeta declara un paso que va por delante del primer paso vacío: la evidencia reunida no llega hasta ahí. Conviene bajar el paso declarado o traer evidencia para el paso que falta.")}>
            {tr("Paso declarado por delante de la evidencia")}
          </Chip>
          <span className="meta">{typeof evaluada.motivoCoherencia === 'string' ? evaluada.motivoCoherencia : ''}</span>
        </div>
      )}
      <ol className="ruta-terapeutica" aria-label={tr("Ruta terapéutica")}>
        {pasos.map((p) => {
          const ev = evaluada ? estadoDePaso(evaluada, p) : null;
          const estado = ev && typeof ev.estado === 'string' && Object.hasOwn(ESTADO_PASO_RUTA, ev.estado) ? ESTADO_PASO_RUTA[ev.estado] : null;
          const definicion = `${PASO_RUTA[p].etiqueta}: ${DEFINICION_PASO_RUTA[p]}.`;
          const titulo = evaluada
            ? estado
              ? `${definicion} Estado: ${estado.etiqueta}. ${typeof ev?.motivo === 'string' && ev.motivo ? ev.motivo : estado.definicion}`
              : `${definicion} Estado: no pude comprobar (el registro no trae este paso).`
            : definicion;
          const estiloEstado = estado ? { borderColor: COLOR_ESTADO_PASO[ev!.estado], boxShadow: `inset 3px 0 0 ${COLOR_ESTADO_PASO[ev!.estado]}` } : undefined;
          return (
            <li key={p} className={p === actual ? 'actual' : PASO_RUTA[p].orden < PASO_RUTA[actual].orden ? 'previo' : ''} title={titulo} style={estiloEstado} data-estado={evaluada ? (estado ? ev!.estado : 'no_comprobable') : undefined}>
              {evaluada && (
                <span aria-hidden="true" style={{ color: estado ? COLOR_ESTADO_PASO[ev!.estado] : 'var(--text-3)', marginRight: 3 }}>
                  {estado ? estado.simbolo : '?'}
                </span>
              )}
              {PASO_RUTA[p].etiqueta}
              {evaluada && <span className="sr-only"> ({estado ? estado.etiqueta: 'no comprobable'})</span>}
            </li>
          );
        })}
      </ol>
      {evaluada && (
        <p className="meta" style={{ marginTop: 4 }}>
          {(Object.keys(ESTADO_PASO_RUTA) as EstadoPasoRuta[]).map((k, i) => (
            <span key={k} title={ESTADO_PASO_RUTA[k].definicion}>
              {i > 0 ? ' · ' : ''}
              <span aria-hidden="true" style={{ color: COLOR_ESTADO_PASO[k] }}>{ESTADO_PASO_RUTA[k].simbolo}</span> {ESTADO_PASO_RUTA[k].etiqueta}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Las dimensiones de un resultado de laboratorio que coexisten. */
export function Dimensiones({ d }: { d: DimensionesResultado | undefined }) {
  if (!d) return null;
  const activas = (Object.keys(DIMENSION_RESULTADO) as (keyof typeof DIMENSION_RESULTADO)[]).filter((k) => d[k]);
  return (
    <div className="acciones" style={{ gap: 4 }}>
      <span className="meta">Dimensiones:</span>
      {activas.length === 0 ? <span className="meta">ninguna marcada</span> : activas.map((k) => <Chip key={k} tono={k === 'efectoPredicho' ? 'ok' : k === 'falloTecnico' || k === 'toxicidad' ? 'mal' : 'aviso'}>{DIMENSION_RESULTADO[k]}</Chip>)}
      {d.nota && <span className="meta">{d.nota}</span>}
    </div>
  );
}

/** La pregunta concreta de la campana, con la plantilla del plan completo. */
export function PreguntaDeCampana({ corrida }: { corrida: Corrida }) {
  const q = corrida.pregunta;
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState<PreguntaCampana>(() => q ?? { contexto: '', etapa: '', intervencion: '', comparador: '', desenlace: '', ventana: '', unidadBiologica: '', mecanismos: '', decision: '', umbralEfecto: '', umbralResuelto: false, pasoRuta: 'mecanismo', propuestaPorRosa: false, aprobadaEn: null });
  // Cuando ROSA2018 formula o reformula la pregunta y nadie la esta corrigiendo,
  // el formulario toma la version nueva.
  const firmaPregunta = JSON.stringify(q ?? null);
  useEffect(() => {
    if (!editando && q) setF(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaPregunta, corrida.id]);
  if (q === undefined || q === null) return null;
  const campo = (k: keyof PreguntaCampana, label: string) => (
    <div className="campo" key={k}>
      <label htmlFor={`pq-${k}`}>{label}</label>
      <input id={`pq-${k}`} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  return (
    <Seccion
      detalle titulo={tr("Pregunta de esta campaña")}
      nota={tr("ROSA2018 la fórmula desde la meta y el área elegida con una plantilla fija: contexto, etapa, intervención, comparador, desenlace, ventana, unidad biológica independiente, mecanismos que distingue, decisión que se toma con la respuesta y umbral de efecto. Un umbral sin base queda 'sin resolver'. Se aprueba con el primer plan.")}
      acciones={
        <div className="acciones">
          {q.aprobadaEn ? <Chip tono="ok">Aprobada</Chip> : <Chip tono="aviso">{tr("Propuesta por ROSA2018")}</Chip>}
          {!q.umbralResuelto && <Chip tono="aviso" title={tr("No hay un valor defendible del efecto mínimo que importaría")}>{tr("Umbral sin resolver")}</Chip>}
          <button type="button" className="btn btn-s" onClick={() => setEditando((v) => !v)}>
            {editando ? 'Cancelar' : 'Corregir'}
          </button>
        </div>
      }
    >
      {!editando ? (
        <div className="seccion">
          {(q as PreguntaCampana & { enunciado?: string }).enunciado && <p className="llano-pregunta">{(q as PreguntaCampana & { enunciado?: string }).enunciado}</p>}
          <dl className="comprobacion">
            <dt>Contexto (C)</dt>
            <dd>{q.contexto || tr('sin fijar')}</dd>
            <dt>Etapa (S)</dt>
            <dd>{q.etapa || tr('sin fijar')}</dd>
            <dt>{tr("Intervención (A)")}</dt>
            <dd>{q.intervencion || tr('sin fijar')}</dd>
            <dt>Comparador (B)</dt>
            <dd>{q.comparador || tr('sin fijar')}</dd>
            <dt>Desenlace (P)</dt>
            <dd>{q.desenlace || tr('sin fijar')}</dd>
            <dt>Ventana (T)</dt>
            <dd>{q.ventana || tr('sin fijar')}</dd>
            <dt>{tr("Unidad biológica")}</dt>
            <dd>{q.unidadBiologica || tr('sin fijar')}</dd>
            <dt>{tr("Mecanismos que distingue")}</dt>
            <dd>{q.mecanismos || tr('sin fijar')}</dd>
            <dt>{tr("Decisión que se toma")}</dt>
            <dd>{q.decision || tr('sin fijar')}</dd>
            <dt>{tr("Umbral de efecto")}</dt>
            <dd className={q.umbralResuelto ? '' : 'tono-aviso'}>{q.umbralEfecto || 'sin resolver'}</dd>
          </dl>
          <RutaTerapeutica paso={q.pasoRuta} />
        </div>
      ) : (
        <div className="seccion">
          <div className="rejilla-2">
            {campo('contexto', tr('Contexto (C)'))}
            {campo('etapa', tr('Etapa (S)'))}
            {campo('intervencion', 'Intervención (A)')}
            {campo('comparador', tr('Comparador (B)'))}
            {campo('desenlace', tr('Desenlace (P), con medida y unidad'))}
            {campo('ventana', tr('Ventana de tiempo (T)'))}
            {campo('unidadBiologica', tr('Unidad biológica independiente'))}
            {campo('mecanismos', tr('Mecanismos que distingue (M1 frente a M2)'))}
            {campo('decision', tr('Decisión que se toma con la respuesta'))}
            {campo('umbralEfecto', tr('Umbral de efecto (o "sin resolver")'))}
          </div>
          <div className="campo">
            <label htmlFor="pq-ruta">{tr("Paso de la ruta terapéutica")}</label>
            <select id="pq-ruta" value={f.pasoRuta} onChange={(e) => setF({ ...f, pasoRuta: e.target.value as PasoRutaTerapeutica })}>
              {(Object.keys(PASO_RUTA) as PasoRutaTerapeutica[]).map((p) => (
                <option key={p} value={p}>
                  {PASO_RUTA[p].etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="acciones">
            <button
              type="button"
              className="btn btn-primario btn-s"
              onClick={() => {
                acciones.actualizarPregunta(corrida.id, f);
                setEditando(false);
              }}
            >
              {tr("Guardar y aprobar")}
            </button>
          </div>
        </div>
      )}
    </Seccion>
  );
}

/** El registro de metodos, predictores, recursos y ensayos (plan completo, seccion 5). */
export function RegistroMetodos({ metodos, ahora }: { metodos: MetodoRegistrado[] | undefined; ahora: number }) {
  const lista = metodos ?? [];
  return (
    <Seccion detalle titulo={tr("Registro de métodos y ensayos")} nota={tr("Cada método dice qué puede evaluar, dónde aplica, qué necesita, cómo se validó y en qué estado está. La popularidad no lo hace apto; la validación sí. La puerta de reproducción marca los métodos de análisis como probados en contexto. Un predictor no confirma sus propios datos de entrenamiento.")}>
      {lista.length === 0 ? (
        <p className="meta">{tr("Sin servidor no hay registro que leer.")}</p>
      ) : (
        <ul className="lista-limpia metodos">
          {lista.map((m) => (
            <FilaMetodo key={m.id} m={m} ahora={ahora} />
          ))}
        </ul>
      )}
    </Seccion>
  );
}

function FilaMetodo({ m, ahora }: { m: MetodoRegistrado; ahora: number }) {
  const e = ESTADO_METODO[m.estado];
  return (
    <li>
      <div style={{ flex: 1 }}>
        <div className="acciones" style={{ gap: 6 }}>
          <strong style={{ fontSize: 13.5 }}>{m.nombre}</strong>
          <Chip tono="borde">{TIPO_METODO[m.tipo]}</Chip>
          <Chip tono={e.tono}>{e.etiqueta}</Chip>
          <span className="meta">
            <Momento t={m.actualizadoEn} ahora={ahora} />
          </span>
        </div>
        <p className="meta" style={{ marginTop: 4 }}>
          Evalua: {m.evalua}. {m.contextos.length ? `Contextos: ${m.contextos.join('; ')}. ` : ''}
          {m.exclusiones.length ? `Excluye: ${m.exclusiones.join('; ')}. ` : ''}
          {tr("Validación:")} {m.validacion || tr('sin declarar')}. {m.fallosConocidos ? `Fallos conocidos: ${m.fallosConocidos}. ` : ''}
          {m.probadoEn.length ? `Probado en: ${m.probadoEn.join('; ')}. ` : ''}
          {m.version ? `Versión: ${m.version}. ` : ''}
          {m.responsable ? `Responsable: ${m.responsable}.` : ''}
        </p>
      </div>
      <select className="entrada entrada-s" style={{ width: 'auto' }} value={m.estado} onChange={(ev) => acciones.actualizarMetodo(m.id, { estado: ev.target.value as MetodoRegistrado['estado'] })} aria-label={`Estado de ${m.nombre}`}>
        {(Object.keys(ESTADO_METODO) as MetodoRegistrado['estado'][]).map((s) => (
          <option key={s} value={s}>
            {ESTADO_METODO[s].etiqueta}
          </option>
        ))}
      </select>
    </li>
  );
}

export function Bloqueos({ bloqueos, candidata }: { bloqueos: Hipotesis['bloqueos']; candidata: boolean | undefined }) {
  const b = bloqueos ?? [];
  if (b.length === 0) {
    return candidata ? <Chip tono="ok" title={tr("Sin bloqueos, el Killer la dejó avanzar y está entre las mejores con diversidad de cluster")}>{tr("Candidata al laboratorio")}</Chip> : <Chip tono="borde" title={tr("Sin bloqueos no compensables")}>{tr("Sin bloqueos")}</Chip>;
  }
  return (
    <span className="acciones" style={{ gap: 4 }}>
      {b.map((x) => (
        <Chip key={x} tono="mal" title={EXPLICACION_BLOQUEO[x]}>
          {BLOQUEO[x]}
        </Chip>
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------------
   Grafo de evidencia: fusión de ramas, conflictos y pendientes de revisar
   --------------------------------------------------------------------- */

const CAUSA_PENDIENTE: Record<NonNullable<Hipotesis['pendienteRevision']>['causa'], string> = traducido({
  fuente_retractada: 'una de sus fuentes se retractó',
  hecho_sustituido: 'un hecho del que depende fue sustituido por otro más reciente',
  hecho_contradicho: 'un hecho del que depende fue contradicho',
  hipotesis_reformulada: 'la hipótesis de la que deriva se reformuló',
  fuente_corregida: 'una de sus fuentes recibió una corrección editorial',
});

export function FusionYConflictos({ h, estado }: { h: Hipotesis; estado: EstadoRosa }) {
  const titulo = (id: string) => estado.hipotesis.find((x) => x.id === id)?.titulo ?? id;
  const fp = h.fusionPropuesta;
  const conflictos = h.conflictoCon ?? [];
  const pendiente = h.pendienteRevision;
  if (!fp && conflictos.length === 0 && !pendiente && !h.fusionadaEn && (h.absorbe?.length ?? 0) === 0) return null;
  return (
    <div className="fusion-conflictos">
      {fp && (
        <div className="aviso-conflicto aviso-info">
          <span>
            <strong>{tr("ROSA2018 propone fusionar esta hipótesis")}</strong> en «{titulo(fp.con)}» ({RELACION_TORNEO[fp.relacion]}). {fp.motivo} {tr("Si aceptas, la otra hereda las afirmaciones y fuentes de esta y esta queda cerrada como fusionada, no como refutada.")}
          </span>
          <span className="acciones">
            <Confirmar etiqueta="Fusionar" pregunta={`«${titulo(fp.con)}» hereda la evidencia de esta hipótesis y esta se cierra como fusionada.`} onConfirmar={() => acciones.fusionarHipotesis(fp.con, h.id, fp.motivo)} />
            <button type="button" className="btn btn-s" onClick={() => acciones.rechazarFusion(h.id)}>
              {tr("No fusionar")}
            </button>
          </span>
        </div>
      )}
      {h.fusionadaEn && <p className="meta">{tr("Fusionada en «")}{titulo(h.fusionadaEn)}{tr("»: su evidencia vive allí. No fue refutada.")}</p>}
      {(h.absorbe?.length ?? 0) > 0 && <p className="meta">{tr("Absorbió por fusión:")} {h.absorbe!.map(titulo).join('; ')}.</p>}
      {conflictos.length > 0 && (
        <p className="meta">
          <Chip tono="aviso" title={tr("Marco de argumentación (Dung): dos hipótesis que se atacan no pueden ser ciertas a la vez. ROSA2018 lo marca; no descarta ninguna.")}>
            Se contradice con {conflictos.length === 1 ? tr('otra candidata') : `${conflictos.length} candidatas`}
          </Chip>{' '}
          {conflictos.map(titulo).join('; ')}{tr(". Si las dos van al laboratorio, una sobra o hay que diseñar el experimento que las separe.")}
        </p>
      )}
      {pendiente && (
        <p className="meta">
          <Chip tono="aviso" title={EXPLICACION_BLOQUEO.dependencia_pendiente}>{tr("Pendiente de revisar")}</Chip> {CAUSA_PENDIENTE[pendiente.causa]}: {pendiente.detalle} (desde el <Momento t={pendiente.desde} ahora={Date.now()} />{tr("). ROSA2018 la volverá a concluir al cerrar la iteración; si ya la revisaste tú, márcalo.")}{' '}
          <button type="button" className="btn btn-s" onClick={() => acciones.atenderPendiente('hipotesis', h.id, tr('revisada por una persona'))}>
            {tr("Ya la revisé")}
          </button>
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Decisiones del Killer
   --------------------------------------------------------------------- */

function ListaComprobaciones({ comprobaciones, etiquetas, onEtiquetar }: { comprobaciones: Comprobacion[]; etiquetas?: Record<string, CasoDorado>; onEtiquetar?: (comprobacion: string, veredicto: 'pasa' | 'falla' | 'no_comprobable') => void }) {
  if (comprobaciones.length === 0) return null;
  const orden = { falla: 0, no_comprobable: 1, pasa: 2, no_aplica: 3 };
  const ordenadas = [...comprobaciones].sort((a, b) => orden[a.resultado] - orden[b.resultado]);
  return (
    <ul className="comprobaciones">
      {ordenadas.map((c, i) => {
        const r = RESULTADO_COMPROBACION[c.resultado];
        const mia = etiquetas?.[c.comprobacion];
        return (
          <li key={i}>
            <Chip tono={r.tono}>{r.etiqueta}</Chip>
            <span>
              <strong>{COMPROBACION_KILLER[c.comprobacion] ?? c.comprobacion}.</strong> {c.detalle}
              {onEtiquetar && c.resultado !== 'no_aplica' && (
                <span className="acciones" style={{ display: 'inline-flex', marginLeft: 8, gap: 4 }} title={tr("Tu veredicto sobre esta comprobación entra al conjunto dorado con el que se mide si el juez acierta (kappa por comprobación)")}>
                  {(['pasa', 'falla', 'no_comprobable'] as const).map((v) => (
                    <button key={v} type="button" className={`btn btn-s ${mia?.veredictoHumano === v ? 'btn-primario' : 'btn-fantasma'}`} onClick={() => onEtiquetar(c.comprobacion, v)} aria-label={`Marcar ${c.comprobacion} como ${v}`}>
                      {mia?.veredictoHumano === v ? 'Tu: ' : ''}
                      {v === 'no_comprobable' ? 'no comprobable' : v}
                    </button>
                  ))}
                  {mia && mia.veredictoHumano !== c.resultado && <Chip tono="aviso">desacuerdo</Chip>}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DecisionesKiller({ h, decisiones, ahora, conjuntoDorado = [] }: { h: Hipotesis; decisiones: Decision[]; ahora: number; conjuntoDorado?: CasoDorado[] }) {
  const propias = decisiones.filter((d) => d.hipotesisId === h.id).sort((a, b) => b.fecha - a.fecha);
  const ultima = propias.find((d) => d.etapa === 'killer_1');
  const etiquetas: Record<string, CasoDorado> = {};
  for (const c of conjuntoDorado) if (c.hipotesisId === h.id && c.version === (h.version ?? 1)) etiquetas[c.comprobacion] = c;
  return (
    <Seccion titulo={tr("Hypothesis Killer y registro de decisiones")} nota={tr("El Killer (Opus 5, otra familia que el generador) pasa una lista fija de comprobaciones; la decisión no la escribe el modelo: ROSA2018 la deriva por regla. Descartar solo si falla la evidencia; reformular si falla algo arreglable; suspender si algo crítico no se pudo comprobar. Una muestra de los descartes la audita otro modelo defendiendo la hipótesis.")}>
      {h.decisionKiller && DECISION_KILLER[h.decisionKiller] && (
        <div className="acciones" style={{ marginBottom: 8 }}>
          <Chip tono={DECISION_KILLER[h.decisionKiller].tono}>{DECISION_KILLER[h.decisionKiller].etiqueta}</Chip>
          {killerPendienteDe(h) && (
            <Chip tono="aviso" title={tr("La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas.")}>
              {killerPendienteDe(h)}
            </Chip>
          )}
          {/* El motivo real de la última decisión (por ejemplo "suspender: riesgo de sesgo: las tres afirmaciones proceden de una única fuente") y no la nota genérica: con "no evaluable" fijo, una comprobación que había fallado se leía como "no es un fallo de la hipótesis". */}
          <span className="meta">{[...(h.revisiones ?? [])].reverse().find((r) => r.accion === 'killer')?.nota || DECISION_KILLER[h.decisionKiller].nota}</span>
        </div>
      )}
      {!h.decisionKiller && <p className="meta">{tr("El Killer todavía no juzgó esta versión. Pasa por él en el paso de hipótesis de la siguiente iteración, o al pedir una revisión.")}</p>}
      {ultima && <ListaComprobaciones comprobaciones={ultima.comprobaciones} etiquetas={etiquetas} onEtiquetar={(c, v) => acciones.etiquetarComprobacion(h.id, c, v)} />}
      {ultima && <p className="meta">{tr("Marca en cada comprobación tu veredicto (pasa, falla o no comprobable): es el conjunto dorado con el que ROSA2018 mide si el juez acierta, comprobación por comprobación, y detecta si cambia cuando cambia el modelo.")}</p>}
      {ultima?.queHariaFalta && <p className="meta">{tr("Qué haría falta para evaluarla:")} {ultima.queHariaFalta}</p>}
      {propias.length > 0 && (
        <details className="versiones">
          <summary>{tr("Historial de decisiones (")}{propias.length})</summary>
          <table className="tabla">
            <thead>
              <tr>
                <th>{tr("Cuándo")}</th>
                <th>Etapa</th>
                <th>{tr("Versión")}</th>
                <th>{tr("Decisión")}</th>
                <th>{tr("Quién")}</th>
                <th>Motivo</th>
                <th>{tr("Auditoría")}</th>
              </tr>
            </thead>
            <tbody>
              {propias.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Momento t={d.fecha} ahora={ahora} />
                  </td>
                  <td>{ETAPA_DECISION[d.etapa]}</td>
                  <td className="num">v{d.version}</td>
                  <td>{d.decision in DECISION_KILLER ? <Chip tono={DECISION_KILLER[d.decision as keyof typeof DECISION_KILLER].tono}>{DECISION_KILLER[d.decision as keyof typeof DECISION_KILLER].etiqueta}</Chip> : <Chip>{d.decision.replace(/_/g, ' ')}</Chip>}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {nombreActor(d.quien)}
                  </td>
                  <td className="meta">{d.motivo}</td>
                  <td>{d.auditoria ? <Chip tono={d.auditoria.acuerdo ? 'ok' : 'mal'} title={d.auditoria.motivo}>{d.auditoria.acuerdo ? tr('De acuerdo') : tr('En desacuerdo')}</Chip> : <span className="meta">sin auditar</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Seccion>
  );
}

/* ---------------------------------------------------------------------
   Analisis in silico
   --------------------------------------------------------------------- */

function Cifras({ titulo, cifras }: { titulo: string; cifras: Record<string, string> }) {
  const entradas = Object.entries(cifras);
  if (entradas.length === 0) return null;
  return (
    <div className="experimento-bloque">
      <h4>{titulo}</h4>
      <ul className="cifras">
        {entradas.map(([k, v]) => (
          <li key={k}>
            <strong>{k}:</strong> {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EjecucionesInSilico({ h, estado, ahora }: { h: Hipotesis; estado: EstadoRosa; ahora: number }) {
  const runs = (estado.ejecuciones ?? []).filter((x) => x.hipotesisId === h.id).sort((a, b) => b.inicio - a.inicio);
  const planes = new Map((estado.planesAnalisis ?? []).map((p) => [p.id, p]));
  const inv = estado.investigaciones.find((i) => i.id === h.investigacionId);
  const datasets = (inv?.datasets ?? []).filter((d) => d.estado === 'aprobado' && d.procedencia?.hash);
  const [dsElegido, setDs] = useState(datasets[0]?.id ?? '');
  // Si el dataset elegido ya no esta (o al montar no habia ninguno), se usa el primero.
  const ds = datasets.some((x) => x.id === dsElegido) ? dsElegido : datasets[0]?.id ?? '';
  const [pregunta, setPregunta] = useState('');
  const puerta = inv?.puertaReproduccion;
  const puertaOk = puerta ? puerta.estado === 'abierta' || puerta.estado === 'eximida' : false;
  return (
    <Seccion detalle titulo="Análisis in silico" nota={tr("ROSA2018 congela un plan de análisis (sin ver las filas), escribe el código, lo ejecuta en un sandbox sin red con los datos en solo lectura, interpreta las cifras contra el umbral del plan y un auditor independiente (Killer II) dice si el análisis vale. Solo un análisis válido entra como evidencia.")}>
      {runs.length === 0 && <p className="meta">{tr("Sin análisis con datos todavía.")}</p>}
      {h.evidenciaSecuencial && (
        <div className="acciones">
          <Chip tono={h.evidenciaSecuencial.rechazaNula ? 'ok' : 'borde'} title={tr("Producto de los e-valores (kappa p^(kappa-1)) de los análisis válidos. Controla el error de tipo I aunque se sigan añadiendo pruebas (Popper, 2025).")}>
            Evidencia acumulada e = {h.evidenciaSecuencial.eAcumulado} sobre {h.evidenciaSecuencial.pruebas.length} {h.evidenciaSecuencial.pruebas.length === 1 ? 'prueba' : 'pruebas'}
          </Chip>
          <span className="meta">{h.evidenciaSecuencial.rechazaNula ? `Alcanza 1/alfa = ${Math.round(1 / h.evidenciaSecuencial.alfa)}: rechaza la hipotesis nula al ${Math.round(h.evidenciaSecuencial.alfa * 100)} %.` : `No alcanza 1/alfa = ${Math.round(1 / h.evidenciaSecuencial.alfa)}: la evidencia acumulada aún no rechaza la nula.`}</span>
        </div>
      )}
      {runs.map((run) => (
        <FichaEjecucion key={run.id} run={run} plan={planes.get(run.planId)} ahora={ahora} />
      ))}
      {datasets.length === 0 ? (
        <p className="meta">{tr("Para pedir un análisis hace falta un dataset aprobado con fichero y libro de procedencia (Objetivo y datos).")}</p>
      ) : (
        <div className="seccion">
          {!puertaOk && <p className="tono-aviso" style={{ fontSize: 13 }}>{tr("La puerta de reproducción está bloqueada (")}{puerta?.superadas ?? 0} de {puerta?.requeridas ?? 3}{tr("): el análisis quedará en \"no ejecutado\" hasta reproducir los análisis publicados o eximir la puerta con motivo.")}</p>}
          <div className="rejilla-2">
            <div className="campo">
              <label htmlFor="an-ds">Dataset</label>
              <select id="an-ds" value={ds} onChange={(e) => setDs(e.target.value)}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                    {d.procedencia?.sintetico ? tr(' (sintético)') : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="an-preg">{tr("Qué quieres que pruebe (vacío: la predicción falsable)")}</label>
              <input id="an-preg" className="entrada" value={pregunta} placeholder={tr("Diferencia de GFAP entre portadores y no portadores")} onChange={(e) => setPregunta(e.target.value)} />
            </div>
          </div>
          <div className="acciones">
            <button type="button" className="btn" disabled={ds === ''} onClick={() => acciones.pedirAnalisis(h.id, ds, pregunta)}>
              Pedir analisis in silico
            </button>
            <span className="meta">{tr("Cuenta como evaluación costosa (máximo")} {Number(estado.politicas?.maxEvaluacionesCostosas ?? 5)} por corrida).</span>
          </div>
        </div>
      )}
    </Seccion>
  );
}

export function FichaEjecucion({ run, plan, ahora }: { run: Ejecucion; plan: PlanAnalisis | undefined; ahora: number }) {
  const e = ESTADO_EJECUCION[run.estado];
  return (
    <div className={`tarjeta seccion ejecucion ejecucion-${run.estado}`}>
      <div className="acciones">
        <Chip tono={e.tono}>{e.etiqueta}</Chip>
        {run.interpretacion && <Chip tono={INTERPRETACION_EJECUCION[run.interpretacion.estado].tono}>{INTERPRETACION_EJECUCION[run.interpretacion.estado].etiqueta}</Chip>}
        {run.auditoria && (
          <Chip tono={VEREDICTO_AUDITORIA[run.auditoria.veredicto].tono} title={run.auditoria.motivo}>
            Auditor: {VEREDICTO_AUDITORIA[run.auditoria.veredicto].etiqueta}
          </Chip>
        )}
        {run.ensayoSeco && run.ensayoSeco.estado !== 'no_hecho' && (
          <Chip tono={run.ensayoSeco.estado === 'completado' ? 'ok' : 'aviso'} title={`El código se corrió antes sobre ${run.ensayoSeco.filas} filas sintéticas con la forma del dataset (${run.ensayoSeco.intentos} intento${run.ensayoSeco.intentos === 1 ? '' : 's'}). ${run.ensayoSeco.error || tr('Sus cifras no cuentan: solo dice si el codigo corre sobre esa forma.')}`}>
            {tr("Ensayo en seco:")} {run.ensayoSeco.estado === 'completado' ? 'corre' : run.ensayoSeco.estado.replace('_', ' ')}
          </Chip>
        )}
        <span className="meta">
          <Momento t={run.inicio} ahora={ahora} /> · {RUNTIME_EJECUCION[run.runtime]} · semilla {run.semilla} · datos {run.hashDatos.slice(0, 12) || tr('sin hash')}
          {run.duracionS !== null ? ` · ${run.duracionS} s` : ''}
        </span>
      </div>
      {run.error && (run.estado === 'no_ejecutado' || run.estado === 'error_tecnico' || run.estado === 'tiempo_agotado') && <p className="tono-mal" style={{ fontSize: 13 }}>{run.error.split('\n').slice(-3).join(' ')}</p>}
      {plan && (
        <details className="versiones">
          <summary>Plan congelado {plan.hashPlan} ({plan.tipo}) el {new Date(plan.congeladoEn).toLocaleString('es')}</summary>
          <dl className="comprobacion">
            <dt>Pregunta</dt>
            <dd>{plan.pregunta}</dd>
            <dt>Variables</dt>
            <dd>{plan.variables.join('; ')}</dd>
            <dt>{tr("Población")}</dt>
            <dd>{plan.poblacion}</dd>
            <dt>Prueba</dt>
            <dd>{plan.prueba}</dd>
            <dt>H0 / H1</dt>
            <dd>
              {plan.hipotesisNula} / {plan.hipotesisAlternativa} (alfa {plan.alpha})
            </dd>
            <dt>{tr("Efecto mínimo y umbral")}</dt>
            <dd>
              {plan.tamanoEfectoMinimo}. Cuenta como efecto si: {plan.umbralEfecto}
            </dd>
            {(plan.siConfirma || plan.siRefuta || plan.siNoEvaluable) && (
              <>
                <dt>{tr("Qué hará ROSA2018 según salga")}</dt>
                <dd>
                  {plan.siConfirma && <>Si confirma: {plan.siConfirma}. </>}
                  {plan.siRefuta && <>Si refuta: {plan.siRefuta}. </>}
                  {plan.siNoEvaluable && <>{tr("Si no es evaluable:")} {plan.siNoEvaluable}.</>}
                </dd>
              </>
            )}
            {plan.planPadre && (
              <>
                <dt>{tr("Viene del plan")}</dt>
                <dd>
                  {plan.planPadre}. {plan.cambioRespectoAlPadre}
                </dd>
              </>
            )}
            {plan.selloExterno && (
              <>
                <dt>{tr("Sello externo del plan")}</dt>
                <dd>{plan.selloExterno.ok ? `Sellado (RFC 3161) el ${plan.selloExterno.primeraHora ?? ''}` : `Sin sello externo${plan.selloExterno.error ? `: ${plan.selloExterno.error}` : ''}`}</dd>
              </>
            )}
            <dt>Baseline</dt>
            <dd>{plan.baseline}</dd>
            <dt>Control negativo</dt>
            <dd>{plan.controlNegativo}</dd>
            <dt>Multiplicidad</dt>
            <dd>{plan.correccionMultiplicidad}</dd>
            <dt>{tr("No evaluable si")}</dt>
            <dd>{plan.criterioNoEvaluable}</dd>
          </dl>
        </details>
      )}
      {run.interpretacion && <p style={{ fontSize: 13.5 }}>{run.interpretacion.resumen}</p>}
      {(run.skills?.length || run.entorno?.imagen) && (
        <p className="meta">
          {run.entorno?.imagen ? `Entorno ${run.entorno.imagen}` : ''}
          {run.skills?.length ? `${run.entorno?.imagen ? '; ' : ''}skills: ${run.skills.join(', ')}` : ''}
          {run.entorno?.paquetes?.length ? `; ${run.entorno.paquetes.slice(0, 6).map((p) => `${p.nombre} ${p.version}`).join(', ')}` : ''}
        </p>
      )}
      {run.repeticiones && run.repeticiones.length > 0 && (
        <p className="meta">
          {tr("Repeticiones con otras semillas:")} {run.repeticiones.map((r) => `semilla ${r.semilla}: ${Object.entries(r.resultados).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ') || tr('sin cifras')}`).join(' | ')}
        </p>
      )}
      <div className="conclusion-columnas">
        <Cifras titulo="Resultados" cifras={run.resultados} />
        <Cifras titulo="Baseline" cifras={run.baseline} />
        <Cifras titulo={tr("Control negativo (etiquetas barajadas)")} cifras={run.controlNegativo} />
      </div>
      {run.auditoria && (
        <div className="experimento-bloque">
          <h4>{tr("Auditoría independiente (Killer II)")}</h4>
          <p className="meta">{run.auditoria.motivo}</p>
          <ListaComprobaciones comprobaciones={run.auditoria.comprobaciones} />
        </div>
      )}
      {run.codigo && (
        <details className="versiones">
          <summary>{tr("Código ejecutado")}</summary>
          <pre className="registro">{run.codigo}</pre>
        </details>
      )}
      {run.salida && (
        <details className="versiones">
          <summary>{tr("Salida del sandbox")}</summary>
          <pre className="registro">{run.salida}</pre>
        </details>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Puerta de reproduccion y reproducciones
   --------------------------------------------------------------------- */

/** Tres analisis publicos y reproducibles del Alzheimer, del mas barato al
 *  mas caro, con la cifra publicada y una tolerancia razonable. Salen de la
 *  investigacion del 11 de septiembre de 2026 (INVESTIGACION-ROSA2018.md). */
export const REPRODUCCIONES_SUGERIDAS: { referencia: string; doi: string; descripcion: string; cifraPublicada: string; valorPublicado: number; tolerancia: number; dataset: string }[] = traducido([
  { referencia: 'Blalock et al., 2004 (PNAS)', doi: '10.1073/pnas.0308512100', descripcion: 'GEO GSE1297, hipocampo, 31 arrays: correlación de la expresión de cada gen con MMSE; recall del conjunto MSigDB BLALOCK_ALZHEIMERS_DISEASE_INCIPIENT_UP al mismo umbral', cifraPublicada: 'recall del conjunto UP (fracción recuperada)', valorPublicado: 1.0, tolerancia: 0.4, dataset: 'GSE1297' },
  { referencia: 'Marcus et al., 2007 (OASIS-1)', doi: '10.1162/jocn.2007.19.9.1498', descripcion: 'OASIS-1, 416 sujetos: diferencia de volumen cerebral normalizado (nWBV) entre CDR 0 y CDR 0,5 o mayor; misma dirección y p < 0,01', cifraPublicada: 'p-valor de la diferencia de nWBV por CDR (menor que 0,01)', valorPublicado: 0.005, tolerancia: 1.0, dataset: 'OASIS-1' },
  { referencia: 'Gabitto et al., 2024 (SEA-AD, Nat Neurosci)', doi: '10.1038/s41593-024-01774-5', descripcion: 'SEA-AD MTG, proporciones por donante con anotaciones de los autores: número de supertipos con cambio credible frente al CPS (scCODA, probabilidad de inclusión > 0,8)', cifraPublicada: 'supertipos con cambio credible (36 de 139)', valorPublicado: 36, tolerancia: 0.2, dataset: 'SEA-AD' },
]);

export function PuertaYReproducciones({ inv, estado, ahora }: { inv: Investigacion; estado: EstadoRosa; ahora: number }) {
  const puerta = inv.puertaReproduccion ?? { requeridas: 3, superadas: 0, estado: 'bloqueada' as const, eximidaPor: null, motivo: '', fecha: null };
  const reps = (estado.reproducciones ?? []).filter((r) => r.investigacionId === inv.id);
  const datasets = inv.datasets.filter((d) => d.procedencia?.hash);
  const [dsElegido, setDs] = useState(datasets[0]?.id ?? '');
  const ds = datasets.some((x) => x.id === dsElegido) ? dsElegido : datasets[0]?.id ?? '';
  const [d, setD] = useState({ referencia: '', doi: '', descripcion: '', cifraPublicada: '', valorPublicado: '', tolerancia: '0.1' });
  const [error, setError] = useState<string | null>(null);
  // El formulario solo se ensena si hace falta (puerta bloqueada) o si se pide.
  const [formulario, setFormulario] = useState(puerta.estado === 'bloqueada');
  const tono = puerta.estado === 'abierta' ? 'ok' : puerta.estado === 'eximida' ? 'aviso' : 'mal';
  return (
    <Seccion
      id="puerta"
      plegable
      abierta={puerta.estado !== 'abierta'}
      resumen={<span>{puerta.estado === 'abierta' ? `Abierta: ${puerta.superadas} de ${puerta.requeridas} análisis publicados reproducidos. ROSA2018 ya puede descubrir con datos.` : puerta.estado === 'eximida' ? `Eximida por ${puerta.eximidaPor}: ${puerta.motivo}` : `Bloqueada: ${puerta.superadas} de ${puerta.requeridas} reproducidos. Hasta abrirla, ningún análisis con datos cuenta como descubrimiento.`}</span>}
      titulo="Puerta de reproducción"
      nota={tr("Antes de descubrir nada con datos, ROSA2018 tiene que reproducir análisis ya publicados dentro de una tolerancia fijada de antemano. Si no lo consigue, un resultado nuevo no se distingue de un error del pipeline. Una persona puede eximirla dejando el motivo; queda como cambio de política.")}
      acciones={
        puerta.estado === 'eximida' ? (
          <button type="button" className="btn btn-s" onClick={() => acciones.cerrarPuerta(inv.id)}>
            Volver a exigirla
          </button>
        ) : (
          <Confirmar etiqueta={tr("Eximir la puerta")} pregunta={tr("Es una excepción de política (nivel 3). Queda en el registro de aprendizaje con tu nombre y el motivo.")} pedirTexto={{ etiqueta: 'Motivo', marcador: tr('Demostración con datos sintéticos; no se afirma nada científico') }} onConfirmar={(m) => acciones.eximirPuerta(inv.id, m)} />
        )
      }
    >
      <div className="acciones">
        <Chip tono={tono}>
          {puerta.estado === 'abierta' ? 'Abierta' : puerta.estado === 'eximida' ? `Eximida por ${puerta.eximidaPor}` : 'Bloqueada'} · {puerta.superadas} de {puerta.requeridas} reproducidas
        </Chip>
        {puerta.estado === 'eximida' && <span className="meta">Motivo: {puerta.motivo}</span>}
      </div>
      {reps.length > 0 && (
        <table className="tabla">
          <thead>
            <tr>
              <th>Referencia</th>
              <th>{tr("Qué se reproduce")}</th>
              <th className="num">Publicado</th>
              <th className="num">Obtenido</th>
              <th className="num">Tolerancia</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <FilaReproduccion key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      )}
      {datasets.length === 0 ? (
        <p className="meta">{tr("Sube primero el dataset publico del análisis que quieres reproducir (por ejemplo GSE1297, OASIS-1 o SEA-AD).")}</p>
      ) : !formulario ? (
        <div className="acciones">
          <button type="button" className="btn btn-s" onClick={() => setFormulario(true)}>
            {tr("Registrar otro analisis publicado para reproducir")}
          </button>
        </div>
      ) : (
        <div className="seccion">
          <div className="acciones" style={{ justifyContent: 'space-between' }}>
            <p className="campo-etiqueta">{tr("Registrar un análisis publicado para reproducir")}</p>
            <button type="button" className="btn btn-fantasma btn-s" onClick={() => setFormulario(false)}>
              Ocultar
            </button>
          </div>
          <div className="acciones">
            {REPRODUCCIONES_SUGERIDAS.map((s) => (
              <button key={s.doi} type="button" className="btn btn-s" title={s.descripcion} onClick={() => setD({ referencia: s.referencia, doi: s.doi, descripcion: s.descripcion, cifraPublicada: s.cifraPublicada, valorPublicado: String(s.valorPublicado), tolerancia: String(s.tolerancia) })}>
                {s.dataset}: {s.referencia}
              </button>
            ))}
          </div>
          <div className="rejilla-2">
            <div className="campo">
              <label htmlFor="rep-ds">Dataset</label>
              <select id="rep-ds" value={ds} onChange={(e) => setDs(e.target.value)}>
                {datasets.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="rep-ref">Referencia</label>
              <input id="rep-ref" value={d.referencia} onChange={(e) => setD({ ...d, referencia: e.target.value })} placeholder={tr("Blalock et al., 2004")} />
            </div>
          </div>
          <div className="campo">
            <label htmlFor="rep-desc">{tr("Qué se reproduce exactamente")}</label>
            <textarea id="rep-desc" rows={2} value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} />
          </div>
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor="rep-cifra">Cifra publicada (nombre)</label>
              <input id="rep-cifra" value={d.cifraPublicada} onChange={(e) => setD({ ...d, cifraPublicada: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rep-valor">Valor publicado</label>
              <input id="rep-valor" value={d.valorPublicado} onChange={(e) => setD({ ...d, valorPublicado: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rep-tol">Tolerancia relativa (0,1 = 10 %)</label>
              <input id="rep-tol" value={d.tolerancia} onChange={(e) => setD({ ...d, tolerancia: e.target.value })} />
            </div>
          </div>
          <div className="acciones">
            <button
              type="button"
              className="btn btn-primario btn-s"
              disabled={ds === ''}
              onClick={() => {
                const id = acciones.anadirReproduccion(inv.id, ds, { referencia: d.referencia, doi: d.doi, descripcion: d.descripcion, cifraPublicada: d.cifraPublicada, valorPublicado: Number(d.valorPublicado.replace(',', '.')), tolerancia: Number(d.tolerancia.replace(',', '.')) });
                setError(id ? null : tr('Faltan la referencia, la descripción, un valor numérico o una tolerancia entre 0 y 1.'));
                if (id) setD({ referencia: '', doi: '', descripcion: '', cifraPublicada: '', valorPublicado: '', tolerancia: '0.1' });
              }}
            >
              {tr("Registrar y reproducir")}
            </button>
            {error && <span className="tono-mal">{error}</span>}
          </div>
        </div>
      )}
      <p className="meta">{tr("Último cambio de la puerta:")} {puerta.fecha ? <Momento t={puerta.fecha} ahora={ahora} /> : 'nunca'}.</p>
    </Seccion>
  );
}

function FilaReproduccion({ r }: { r: Reproduccion }) {
  const e = ESTADO_REPRODUCCION[r.estado];
  return (
    <tr>
      <td>
        {r.referencia}
        {r.doi && (
          <>
            {' '}
            <a className="enlace" href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer">
              doi
            </a>
          </>
        )}
      </td>
      <td className="meta">{r.descripcion}</td>
      <td className="num">{r.valorPublicado}</td>
      <td className="num">{r.valorObtenido ?? ''}</td>
      <td className="num">{Math.round(r.tolerancia * 100)} %</td>
      <td>
        <Chip tono={e.tono}>{e.etiqueta}</Chip>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------------
   Libro de procedencia de un dataset
   --------------------------------------------------------------------- */

export function LibroDeProcedencia({ inv, d }: { inv: Investigacion; d: Dataset }) {
  const p = d.procedencia;
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState(() => ({ origen: p?.origen ?? '', version: p?.version ?? '', licencia: p?.licencia ?? '', permisos: p?.permisos ?? '', cohorte: p?.cohorte ?? '', restriccionIA: p?.restriccionIA ?? '', acceso: p?.acceso ?? 'propio', usoIAAutorizado: p?.usoIAAutorizado ?? 'desconocido', sintetico: p?.sintetico ?? false, permiteLlmTerceros: p?.permiteLlmTerceros ?? false, clase: p?.clase ?? 'observacion_original', diccionario: (p?.diccionario ?? []).map((c) => ({ ...c })) }));
  if (!p) return <p className="meta">{tr("Sin fichero: los datasets del catálogo no tienen libro de procedencia hasta que se sube el fichero.")}</p>;
  if (!editando) {
    return (
      <div className="procedencia-ds">
        <div className="acciones">
          <Chip tono={USO_IA[p.usoIAAutorizado].tono}>{USO_IA[p.usoIAAutorizado].etiqueta}</Chip>
          <Chip tono={p.permiteLlmTerceros ? 'aviso' : 'ok'} title={tr("Si las filas individuales pueden salir hacia el AI Gateway. Con datos controlados está prohibido (NIH NOT-OD-25-081).")}>
            {p.permiteLlmTerceros ? tr('Filas pueden ir al modelo') : tr('Al modelo solo agregados')}
          </Chip>
          {p.sintetico && <Chip tono="aviso">{tr("Sintético: no cuenta como evidencia")}</Chip>}
          <Chip tono="borde">{CLASE_EVIDENCIA[p.clase].etiqueta}</Chip>
          <Chip tono="borde">{ACCESO_DATASET[p.acceso]}</Chip>
          <button type="button" className="btn btn-s" style={{ marginLeft: 'auto' }} onClick={() => setEditando(true)}>
            {tr("Completar el libro de procedencia")}
          </button>
        </div>
        <dl className="comprobacion">
          <dt>Origen</dt>
          <dd>{p.origen || <span className="tono-mal">sin declarar</span>}</dd>
          <dt>{tr("Versión")}</dt>
          <dd>{p.version || tr('sin declarar')}</dd>
          <dt>Licencia</dt>
          <dd>{p.licencia || <span className="tono-mal">sin declarar</span>}</dd>
          <dt>Permisos</dt>
          <dd>{p.permisos || tr('sin declarar')}</dd>
          <dt>Cohorte</dt>
          <dd>{p.cohorte || tr('sin declarar')}</dd>
          <dt>Fichero</dt>
          <dd className="mono" style={{ fontSize: 12 }}>
            {p.fichero} · {p.filas} filas · sha256 {p.hash.slice(0, 16)}
          </dd>
          {p.restriccionIA && (
            <>
              <dt>{tr("Cláusula de IA del acuerdo")}</dt>
              <dd className="meta">{p.restriccionIA}</dd>
            </>
          )}
        </dl>
        {p.diccionario.length > 0 && (
          <details className="versiones">
            <summary>{tr("Diccionario de columnas (")}{p.diccionario.length}; {p.diccionario.filter((c) => c.descripcion.trim() === '').length} sin descripcion)</summary>
            <table className="tabla">
              <tbody>
                {p.diccionario.map((c) => (
                  <tr key={c.columna}>
                    <td className="mono">{c.columna}</td>
                    <td>{c.tipo}</td>
                    <td>{c.unidad}</td>
                    <td className={c.descripcion ? 'meta' : 'tono-mal'}>{c.descripcion || tr('sin descripcion')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    );
  }
  const campo = (k: 'origen' | 'version' | 'licencia' | 'permisos' | 'cohorte' | 'restriccionIA', label: string, marcador: string) => (
    <div className="campo" key={k}>
      <label htmlFor={`pd-${k}`}>{label}</label>
      <input id={`pd-${k}`} value={f[k]} placeholder={marcador} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  return (
    <div className="procedencia-ds seccion">
      <p className="meta">{tr("Sin origen, licencia y uso con IA autorizado el contrato no se puede aprobar. El hash y las filas los fija el servidor y no se editan.")}</p>
      <div className="rejilla-2">
        {campo('origen', tr('Origen (portal, laboratorio, publicación)'), tr('GEO GSE1297'))}
        {campo('version', tr('Versión del dataset'), tr('v1, 2004'))}
        {campo('licencia', tr('Licencia o condiciones de uso'), tr('CC-BY 4.0; Allen Terms of Use'))}
        {campo('permisos', tr('Permisos y acuerdo de uso (id, fecha)'), tr('DUC Synapse v8.2, aprobado 2026-09-01'))}
        {campo('cohorte', tr('Cohorte de origen'), 'ADNI')}
        {campo('restriccionIA', tr('Cláusula de IA del acuerdo (literal)'), tr('Use of AI tools must be described in your IDU'))}
      </div>
      <div className="rejilla-3">
        <div className="campo">
          <label htmlFor="pd-acceso">Acceso</label>
          <select id="pd-acceso" value={f.acceso} onChange={(e) => setF({ ...f, acceso: e.target.value as ProcedenciaDataset['acceso'] })}>
            {(Object.keys(ACCESO_DATASET) as ProcedenciaDataset['acceso'][]).map((a) => (
              <option key={a} value={a}>
                {ACCESO_DATASET[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pd-ia">{tr("Uso con IA autorizado")}</label>
          <select id="pd-ia" value={f.usoIAAutorizado} onChange={(e) => setF({ ...f, usoIAAutorizado: e.target.value as ProcedenciaDataset['usoIAAutorizado'] })}>
            <option value="si">{tr("Si, el acuerdo lo permite")}</option>
            <option value="no">{tr("No")}</option>
            <option value="desconocido">{tr("Sin confirmar")}</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pd-clase">{tr("Clase de evidencia")}</label>
          <select id="pd-clase" value={f.clase} onChange={(e) => setF({ ...f, clase: e.target.value as ProcedenciaDataset['clase'] })}>
            {(Object.keys(CLASE_EVIDENCIA) as ProcedenciaDataset['clase'][]).map((c) => (
              <option key={c} value={c}>
                {CLASE_EVIDENCIA[c].etiqueta}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="interruptor">
        <input type="checkbox" checked={f.sintetico} onChange={(e) => setF({ ...f, sintetico: e.target.checked, clase: e.target.checked ? 'prediccion' : f.clase })} />
        {tr("Es sintético (no cuenta como evidencia; se etiqueta siempre)")}
      </label>
      <label className="interruptor">
        <input type="checkbox" checked={f.permiteLlmTerceros} onChange={(e) => setF({ ...f, permiteLlmTerceros: e.target.checked })} />
        {tr("Las filas individuales pueden enviarse a un modelo de terceros (solo datos abiertos o sintéticos; con datos controlados está prohibido)")}
      </label>
      {f.diccionario.length > 0 && (
        <div>
          <p className="campo-etiqueta">{tr("Diccionario: describe cada columna")}</p>
          <table className="tabla">
            <tbody>
              {f.diccionario.map((c, i) => (
                <tr key={c.columna}>
                  <td className="mono">{c.columna}</td>
                  <td>
                    <select className="entrada entrada-s" value={c.tipo} onChange={(e) => setF({ ...f, diccionario: f.diccionario.map((x, j) => (j === i ? { ...x, tipo: e.target.value as typeof x.tipo } : x)) })} aria-label={`Tipo de ${c.columna}`}>
                      {(['numerica', 'categorica', 'fecha', 'texto', 'identificador'] as const).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="entrada entrada-s" value={c.unidad} placeholder="unidad" onChange={(e) => setF({ ...f, diccionario: f.diccionario.map((x, j) => (j === i ? { ...x, unidad: e.target.value } : x)) })} aria-label={`Unidad de ${c.columna}`} />
                  </td>
                  <td>
                    <input className="entrada entrada-s" value={c.descripcion} placeholder={tr("que mide")} onChange={(e) => setF({ ...f, diccionario: f.diccionario.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)) })} aria-label={`Descripción de ${c.columna}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="acciones">
        <button
          type="button"
          className="btn btn-primario btn-s"
          onClick={() => {
            acciones.actualizarProcedenciaDataset(inv.id, d.id, f);
            setEditando(false);
          }}
        >
          {tr("Guardar el libro de procedencia")}
        </button>
        <button type="button" className="btn btn-fantasma btn-s" onClick={() => setEditando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function SubirDataset({ inv }: { inv: Investigacion }) {
  const [fichero, setFichero] = useState<File | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [sintetico, setSintetico] = useState(false);
  // En vuelo mientras el servidor perfila el fichero: el botón lo enseña y no admite un segundo clic.
  const [subiendo, envolverSubida] = useEnVuelo();
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <div className="acciones">
        <button type="button" className="btn" onClick={() => setAbierto(true)}>
          {tr("Subir un dataset")}
        </button>
        <span className="meta">{tr("CSV, TSV o JSON, hasta 200 MB. Ninguna fila pasa por un modelo al subir.")}</span>
      </div>
    );
  }
  return (
    <div className="tarjeta seccion">
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <p className="campo-etiqueta">{tr("Subir un dataset con fichero")}</p>
        <button type="button" className="btn btn-fantasma btn-s" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
      <p className="meta">{tr("CSV, TSV o JSON (lista de objetos), hasta 200 MB. El servidor calcula el hash, cuenta filas y columnas, detecta valores centinela y prepara el diccionario para que lo completes. Ninguna fila pasa por un modelo al subir.")}</p>
      <div className="rejilla-2">
        <div className="campo">
          <label htmlFor="ds-fich">Fichero</label>
          <input id="ds-fich" type="file" accept=".csv,.tsv,.txt,.json" onChange={(e) => setFichero(e.target.files?.[0] ?? null)} />
        </div>
        <div className="campo">
          <label htmlFor="ds-nom">Nombre</label>
          <input id="ds-nom" value={nombre} placeholder={tr("GSE1297 hipocampo")} onChange={(e) => setNombre(e.target.value)} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="ds-desc">{tr("Descripción")}</label>
        <input id="ds-desc" value={descripcion} placeholder={tr("Expresión por gen y sujeto, con MMSE y NFT")} onChange={(e) => setDescripcion(e.target.value)} />
      </div>
      <label className="interruptor">
        <input type="checkbox" checked={sintetico} onChange={(e) => setSintetico(e.target.checked)} />
        {tr("Es sintético (para probar el pipeline; nunca cuenta como evidencia)")}
      </label>
      <div className="acciones">
        <button
          type="button"
          className="btn btn-primario"
          disabled={!fichero || subiendo}
          {...atributosEnVuelo(subiendo)}
          onClick={envolverSubida(async () => {
            if (!fichero) return;
            const err = await acciones.subirDataset(inv.id, fichero, nombre || fichero.name, descripcion, sintetico);
            setError(err);
            if (!err) {
              setFichero(null);
              setNombre('');
              setDescripcion('');
            }
          })}
        >
          {subiendo ? 'Subiendo...' : tr('Subir y perfilar')}
        </button>
        {error && <span className="tono-mal">{error}</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Registro de aprendizaje
   --------------------------------------------------------------------- */

export function RegistroAprendizaje({ estado, ahora }: { estado: EstadoRosa; ahora: number }) {
  const cambios = [...(estado.aprendizaje ?? [])].sort((a, b) => b.fecha - a.fecha);
  const [nivel, setNivel] = useState<1 | 2 | 3>(2);
  const visibles = cambios.filter((c) => c.nivel === nivel);
  return (
    <Seccion detalle titulo={tr("Registro de aprendizaje")} nota={tr("Todo lo que ROSA2018 cambia al aprender, en tres niveles. El nivel 1 es automático; el nivel 2 lo propone ROSA2018 y lo promueve una persona tras evaluarlo sobre el conjunto reservado; el nivel 3 solo lo cambia una persona.")}>
      <div className="segmentos" role="group" aria-label="Nivel">
        {([1, 2, 3] as const).map((n) => (
          <button key={n} type="button" aria-pressed={nivel === n} onClick={() => setNivel(n)} title={NIVEL_APRENDIZAJE[n].nota}>
            {NIVEL_APRENDIZAJE[n].etiqueta} ({cambios.filter((c) => c.nivel === n).length})
          </button>
        ))}
      </div>
      <p className="meta">{NIVEL_APRENDIZAJE[nivel].nota}</p>
      {visibles.length === 0 ? (
        <p className="meta">{tr("Nada registrado en este nivel.")}</p>
      ) : (
        <ul className="lista-limpia aprendizaje">
          {visibles.slice(0, 40).map((c) => (
            <FilaAprendizaje key={c.id} c={c} ahora={ahora} />
          ))}
        </ul>
      )}
    </Seccion>
  );
}

function FilaAprendizaje({ c, ahora }: { c: CambioAprendizaje; ahora: number }) {
  const e = ESTADO_APRENDIZAJE[c.estado];
  const ev = c.evaluacion;
  return (
    <li>
      <div style={{ flex: 1 }}>
        <div className="acciones" style={{ gap: 6 }}>
          <Chip tono={e.tono}>{e.etiqueta}</Chip>
          <Chip tono="borde">{TIPO_APRENDIZAJE[c.tipo]}</Chip>
          {c.origen.startsWith('arnes:') && (
            <Chip tono="acento" title={tr("Lo propuso la meta-campaña al terminar una corrida, leyendo cómo rindió. Un criterio se evalúa solo contra las decisiones humanas y se revierte si empeora; una política la decides tú.")}>
              {tr("Meta-campaña")}
            </Chip>
          )}
          <span className="meta">
            {nombreActor(c.quien)} · <Momento t={c.fecha} ahora={ahora} />
            {c.resueltoPor && c.resueltoPor !== c.quien ? ` · resuelto por ${c.resueltoPor}` : ''}
          </span>
        </div>
        <p style={{ fontSize: 13.5, marginTop: 4 }}>{c.descripcion}</p>
        {c.nota && <p className="meta">{c.nota}</p>}
        {ev && (
          <p className="meta">
            {ev.casos > 0 ? `Evaluado sobre ${ev.casos} casos (${ev.conjunto}): acuerdo con las personas ${ev.antes ?? '?'} antes, ${ev.despues ?? '?'} después. ` : ''}
            {ev.nota}
          </p>
        )}
      </div>
      {c.nivel === 2 && (c.estado === 'propuesto' || c.estado === 'evaluado') && (
        <div className="acciones">
          {c.tipo === 'criterio' && (
            <button type="button" className="btn btn-s" onClick={() => acciones.evaluarAprendizaje(c.id)} title={tr("Corre el Killer con y sin este criterio sobre las hipótesis que ya decidió una persona y mide el acuerdo. Gasta llamadas al juez.")}>
              Evaluar
            </button>
          )}
          <button
            type="button"
            className="btn btn-primario btn-s"
            disabled={empeoraAlEvaluar(c)}
            title={empeoraAlEvaluar(c) ? tr('No se puede promover: la evaluación dice que empeora el acuerdo con las decisiones humanas. Solo se promueve lo que iguala o mejora.') : tr('Aplicar el cambio a ROSA2018.')}
            onClick={() => acciones.promoverAprendizaje(c.id)}
          >
            Promover
          </button>
          <Confirmar etiqueta="Revertir" pregunta={tr("El cambio no se aplica y queda registrado como revertido.")} pedirTexto={{ etiqueta: 'Motivo', marcador: tr('Empeora el acuerdo con las decisiones humanas') }} onConfirmar={(m) => acciones.revertirAprendizaje(c.id, m)} />
        </div>
      )}
      {c.nivel === 2 && c.estado === 'promovido' && <Confirmar etiqueta="Revertir" pregunta={tr("Se quita el criterio y queda registrado.")} pedirTexto={{ etiqueta: 'Motivo', marcador: tr('Sesga al Killer contra hipotesis de una cohorte') }} onConfirmar={(m) => acciones.revertirAprendizaje(c.id, m)} />}
    </li>
  );
}

export function Politicas({ politicas }: { politicas: EstadoRosa['politicas'] }) {
  const filas: { clave: string; etiqueta: string; nota: string }[] = [
    { clave: 'maxHipotesisVivas', etiqueta: tr('Hipótesis vivas por misión'), nota: tr('Al llegar, ROSA2018 deja de generar hasta que se decidan algunas.') },
    { clave: 'maxEvaluacionesCostosas', etiqueta: tr('Evaluaciones costosas (análisis con datos) por corrida'), nota: tr('Cada una gasta código, sandbox y auditoría.') },
    { clave: 'maxCandidatos', etiqueta: tr('Candidatas al laboratorio por ciclo'), nota: tr('Entre cero y esto. Cero es un resultado válido.') },
    { clave: 'maxReformulaciones', etiqueta: tr('Reformulaciones por hipótesis'), nota: tr('Después, se descarta en este contexto.') },
    { clave: 'reproduccionesRequeridas', etiqueta: tr('Análisis publicados a reproducir antes de descubrir'), nota: tr('La puerta de reproducción.') },
    { clave: 'fraccionDescartesAuditados', etiqueta: tr('Fracción de descartes del Killer auditados'), nota: tr('Con otro método y otra familia de modelo.') },
    { clave: 'segundosMaxEjecucion', etiqueta: tr('Segundos máximos por ejecución en el sandbox'), nota: tr('Pasado el tiempo es un error técnico, no un resultado nulo.') },
    { clave: 'memoriaMaxEjecucionMb', etiqueta: tr('Memoria máxima del sandbox (MB)'), nota: '' },
    { clave: 'presupuestoUsd', etiqueta: tr('Presupuesto por defecto de una misión (USD estimados)'), nota: tr('Se fija por misión al aprobarla.') },
    { clave: 'presupuestoHoras', etiqueta: tr('Presupuesto por defecto de una misión (horas)'), nota: '' },
    { clave: 'relevanciaMinima', etiqueta: tr('Relevancia mínima para cribar un artículo (0 a 10)'), nota: tr('Por debajo, el artículo se descarta en el cribado y queda en el flujo PRISMA como excluido.') },
    { clave: 'maxClausulasAnd', etiqueta: tr('Cláusulas AND por consulta de literatura'), nota: tr('Con más, las consultas de foco traían dos a siete resultados y ninguno relevante; la precisión se gana con sinónimos dentro de cada cláusula.') },
    { clave: 'maxForzadosPorNombre', etiqueta: tr('Artículos que pasan al modelo sin reranker por nombrar el objetivo'), nota: tr('Tope por consulta de la red de seguridad por nombre exacto (fármaco, ensayo o cohorte del objetivo).') },
    { clave: 'maxConsultasPorNombreSinRelevantes', etiqueta: tr('Consultas por nombre seguidas sin ningún relevante'), nota: tr('Al llegar, la red por nombre deja de insistir en esa investigación y queda dicho.') },
    { clave: 'diasVigenciaComprobacionRetraccion', etiqueta: tr('Días de vigencia de una comprobación de retractación'), nota: tr('Una comprobación de Crossref más vieja, o que no llegó, se repite: "no pude comprobar" no es una comprobación.') },
    { clave: 'maxFragmentosPorFuente', etiqueta: tr('Fragmentos que se leen de cada fuente'), nota: tr('Los que más prometen (resultados y cifras primero), no los primeros.') },
    { clave: 'maxPartesPorFragmento', etiqueta: tr('Partes en que se lee un fragmento largo'), nota: tr('Cada parte es una llamada al extractor: con seis fragmentos por fuente, hasta dieciocho llamadas.') },
    { clave: 'maxCaracteresPorLlamadaExtractor', etiqueta: tr('Caracteres por llamada al extractor'), nota: tr('Un fragmento más largo se lee en partes en vez de cortarse a secas.') },
    { clave: 'maxHipotesisEnContexto', etiqueta: tr('Hipótesis que entran al prompt del Killer'), nota: tr('Política de contexto: las vivas por Elo, más las últimas descartadas.') },
    { clave: 'eloK', etiqueta: tr('Factor K del Elo'), nota: tr('Cuánto mueve un partido el Elo.') },
    { clave: 'maxPartidosConJuezPorIteracion', etiqueta: tr('Partidos del torneo con juez por iteración'), nota: tr('Cada uno son dos llamadas al juez (A contra B y B contra A). Los que decide la regla de solidez no cuentan: no gastan ninguna llamada. Los pares que no caben se juegan en las iteraciones siguientes.') },
  ];
  return (
    <Seccion detalle titulo={tr("Políticas")} nota={tr("Los límites del sistema viven en el código del servidor (rosa/políticas.py), no en este estado: ningún agente puede editarlos y cada cambio es un commit que queda en la versión de ROSA2018 de cada corrida. Aquí solo se leen.")}>
      {!politicas ? (
        <p className="meta">{tr("Sin servidor no hay políticas que leer.")}</p>
      ) : (
        <table className="tabla">
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave}>
                <td>{f.etiqueta}</td>
                <td className="num">{typeof politicas[f.clave] === 'number' || typeof politicas[f.clave] === 'string' ? String(politicas[f.clave]) : ''}</td>
                <td className="meta">{f.nota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}

/** Las candidatas al laboratorio y por que las demas no lo son. */
export function Candidatas({ inv, estado, candidatas, noCandidatas }: { inv: Investigacion; estado: EstadoRosa; candidatas: Hipotesis[]; noCandidatas: { h: Hipotesis; bloqueos: NonNullable<Hipotesis['bloqueos']>; motivo: string }[] }) {
  return (
    <Seccion titulo={tr("Candidatas al laboratorio")} nota={`Hasta ${estado.politicas?.maxCandidatos ?? 3} por ciclo, elegidas entre las que el Killer dejó avanzar y no tienen bloqueos no compensables, por Elo y sin repetir cluster mientras haya otros. Cero candidatas es un resultado legítimo: significa abstenerse.`}>
      {candidatas.length === 0 ? <p className="meta">{tr("Hoy ninguna hipótesis cumple: ROSA2018 se abstiene de proponer nada al laboratorio.")}</p> : (
        <ol className="lista-limpia">
          {candidatas.map((h) => (
            <li key={h.id}>
              <a className="enlace" href={rutaDe(inv.id, 'hipotesis', h.id)}>
                {h.titulo}
              </a>
              <span className="meta" title={h.bt ? tr('Elo del torneo y fuerza de Bradley-Terry (lo que ordena a las candidatas)') : undefined}>
                {h.cluster} · Elo {h.elo}
                {h.bt ? ` · BT ${h.bt.fuerza}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      {noCandidatas.length > 0 && (
        <details className="versiones">
          <summary>{tr("Por qué las demás no son candidatas (")}{noCandidatas.length})</summary>
          <ul className="lista-limpia">
            {noCandidatas.map(({ h, bloqueos, motivo }) => (
              <li key={h.id}>
                <div>
                  <a className="enlace" href={rutaDe(inv.id, 'hipotesis', h.id)}>
                    {h.titulo}
                  </a>
                  <div className="acciones" style={{ gap: 4, marginTop: 4 }}>
                    {bloqueos.map((b) => (
                      <Chip key={b} tono="mal" title={EXPLICACION_BLOQUEO[b]}>
                        {BLOQUEO[b]}
                      </Chip>
                    ))}
                    {motivo && <span className="meta">{motivo}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Protocolo real, desviaciones, identidad de muestras y enmiendas fechadas
// ---------------------------------------------------------------------------

const ETIQUETA_CAMPO: Record<CampoEnmendable, string> = traducido({
  protocolo: 'Protocolo',
  ensayo: 'Ensayo',
  controles: 'Controles',
  tamanoMuestral: 'Tamaño muestral',
  confirma: 'Criterio de confirmación',
  refuta: 'Criterio de refutación',
  analisisPedido: 'Análisis pedido',
});

/** Los cuatro campos de una lectura del contrato que se pueden enmendar
 *  después de prerregistrar (rosa/experimento.py; reducer enmendarLectura). */
const ETIQUETA_CAMPO_LECTURA: Record<CampoLecturaEnmendable, string> = traducido({
  queConfirma: 'Confirma si',
  queRefuta: 'Refuta si',
  control: 'Control',
  unidad: 'Unidad',
});

/** Una entrada de una tabla de etiquetas por su clave propia, o undefined:
 *  un valor raro como "constructor" no saca una función del prototipo. */
function de<T>(tabla: Record<string, T>, clave: unknown): T | undefined {
  return typeof clave === 'string' && Object.hasOwn(tabla, clave) ? tabla[clave] : undefined;
}

/** Cómo se describe una enmienda en la lista: el campo de texto que cambió o,
 *  si fue una lectura del contrato, la lectura y su campo. Acepta las dos
 *  formas en que se guarda una enmienda de lectura: la del reducer de la
 *  interfaz (`lectura: {indice, nombre, campo}`) y la del servidor
 *  (rosa/estado/acciones.py enmendar_lectura: `lectura` es el nombre y
 *  `campo` vale "lecturas[i].campo"). Un campo que esta versión no conoce se
 *  enseña tal cual, sin guiones bajos. */
function describirEnmienda(en: EnmiendaPrerregistro): string {
  const etiquetaLectura = (campo: unknown) => (de(ETIQUETA_CAMPO_LECTURA, campo) ?? String(campo ?? '').replace(/_/g, ' ')).toLowerCase();
  const nombreDe = (nombre: unknown, indice: unknown) => (typeof nombre === 'string' && nombre.trim() !== '' ? `«${nombre}»` : `${typeof indice === 'number' && Number.isInteger(indice) ? indice + 1 : 1}`);
  const l = en.lectura as unknown;
  if (l && typeof l === 'object') {
    const o = l as { indice?: unknown; nombre?: unknown; campo?: unknown };
    return `lectura ${nombreDe(o.nombre, o.indice)}, ${etiquetaLectura(o.campo)}`;
  }
  const m = /^lecturas\[(\d+)\]\.(\w+)$/.exec(typeof en.campo === 'string' ? en.campo : '');
  if (m) return `lectura ${nombreDe(l, Number(m[1]))}, ${etiquetaLectura(m[2])}`;
  if (typeof l === 'string' && l.trim() !== '') return `lectura «${l}», ${etiquetaLectura(en.campo)}`;
  return (de(ETIQUETA_CAMPO, en.campo) ?? String(en.campo ?? 'campo').replace(/_/g, ' ')).toLowerCase();
}

/** Lo que se planeo frente a lo que se hizo. El prerregistro queda congelado;
 *  cambiarlo despues es una enmienda con fecha, autor y motivo, y lo que el
 *  laboratorio ejecuto de verdad se registra aparte con sus desviaciones y la
 *  identidad de las muestras. El juez lee las tres cosas al evaluar los datos. */
export function ProtocoloYEnmiendas({ h, ahora }: { h: Hipotesis; ahora: number }) {
  const x = h.experimento;
  const [texto, setTexto] = useState(x?.protocoloReal?.texto ?? '');
  const [desviaciones, setDesviaciones] = useState(x?.protocoloReal?.desviaciones ?? '');
  const [muestras, setMuestras] = useState(x?.protocoloReal?.identidadMuestras ?? '');
  const [campo, setCampo] = useState<CampoEnmendable>('confirma');
  const [despues, setDespues] = useState('');
  const [motivo, setMotivo] = useState('');
  if (!x || x.estado === 'propuesto') return null;
  const puedeEnmendar = Boolean(x.prerregistradoEn) && !x.resultado;
  return (
    <div className="seccion">
      <h4>{tr("Protocolo real y enmiendas")}</h4>
      {(x.enmiendas ?? []).length > 0 && (
        <ul className="lista-plana">
          {(x.enmiendas ?? []).map((en, i) => (
            <li key={i}>
              <strong>Enmienda {i + 1}</strong> <Momento t={en.fecha} ahora={ahora} /> por {nombreActor(en.quien)}, {describirEnmienda(en)}: <span className="meta">"{String(en.antes ?? '').slice(0, 160) || tr('vacío')}"</span> pasa a "{String(en.despues ?? '').slice(0, 160)}". Motivo: {en.motivo}
            </li>
          ))}
        </ul>
      )}
      {puedeEnmendar ? (
        <div className="campo-fila">
          <select className="entrada" value={campo} onChange={(e) => setCampo(e.target.value as CampoEnmendable)} aria-label={tr("Campo a enmendar")}>
            {CAMPOS_ENMENDABLES.map((c) => (
              <option key={c} value={c}>
                {ETIQUETA_CAMPO[c]}
              </option>
            ))}
          </select>
          <input className="entrada" value={despues} placeholder={`Texto nuevo (ahora: ${(x[campo] ?? '').slice(0, 60) || 'vacio'})`} onChange={(e) => setDespues(e.target.value)} aria-label={tr("Texto nuevo")} />
          <input className="entrada" value={motivo} placeholder={tr("Motivo de la enmienda")} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" />
          <button
            type="button"
            className="btn"
            disabled={despues.trim() === '' || motivo.trim() === ''}
            onClick={() => {
              acciones.enmendarExperimento(h.id, campo, despues, motivo);
              setDespues('');
              setMotivo('');
            }}
          >
            Registrar enmienda fechada
          </button>
        </div>
      ) : (
        <p className="meta">{x.resultado ? tr('Con datos ya evaluados el prerregistro no se enmienda: los criterios ya se aplicaron.') : tr('Las enmiendas se registran después de congelar el prerregistro.')}</p>
      )}
      {x.protocoloReal && (
        <p className="meta">
          Protocolo real registrado <Momento t={x.protocoloReal.registradoEn} ahora={ahora} /> por {x.protocoloReal.quien}. Desviaciones: {x.protocoloReal.desviaciones || tr('ninguna declarada')}. Muestras: {x.protocoloReal.identidadMuestras || tr('no declaradas')}.
        </p>
      )}
      <div className="campo">
        <label htmlFor={`pr-texto-${h.id}`}>Protocolo realmente ejecutado</label>
        <textarea id={`pr-texto-${h.id}`} className="entrada" rows={3} value={texto} placeholder={tr("Lo que el laboratorio hizo, paso a paso, aunque coincida con lo planeado")} onChange={(e) => setTexto(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor={`pr-desv-${h.id}`}>{tr("Desviaciones respecto al prerregistro")}</label>
        <input id={`pr-desv-${h.id}`} className="entrada" value={desviaciones} placeholder={tr("Ninguna, o que cambio y por que (n menor, otro reactivo, otro tiempo)")} onChange={(e) => setDesviaciones(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor={`pr-mu-${h.id}`}>{tr("Identidad de las muestras")}</label>
        <input id={`pr-mu-${h.id}`} className="entrada" value={muestras} placeholder={tr("Lote, línea celular, cohorte y fechas de recogida")} onChange={(e) => setMuestras(e.target.value)} />
      </div>
      <div className="acciones">
        <button type="button" className="btn" disabled={texto.trim() === ''} onClick={() => acciones.registrarProtocoloReal(h.id, { texto, desviaciones, identidadMuestras: muestras })}>
          {x.protocoloReal ? tr('Actualizar protocolo real') : tr('Registrar protocolo real')}
        </button>
        {x.resultado && <span className="meta">{tr("Si lo registras ahora, ROSA2018 vuelve a evaluar los datos con esta información.")}</span>}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Gobierno de las areas y jerarquia programa / areas / campanas / preguntas
// ---------------------------------------------------------------------------

function FilaArea({ inv, a, corridas }: { inv: Investigacion; a: AreaInvestigacion; corridas: Corrida[] }) {
  const [condicion, setCondicion] = useState(a.condicionReapertura ?? '');
  const campana = corridas.find((c) => c.id === a.corridaId);
  return (
    <tr>
      <td>
        <strong style={{ fontSize: 13 }}>{a.titulo}</strong>
        <p className="meta">{a.valorIntervencion}</p>
        {a.estado === 'pausada' && a.condicionReapertura && <p className="meta">{tr("Se reabre si:")} {a.condicionReapertura}</p>}
        {(a.historial?.length ?? 0) > 0 && (
          <details className="versiones">
            <summary>Historial ({a.historial!.length})</summary>
            <ul className="lista-plana">
              {a.historial!.map((hi, i) => (
                <li key={i} className="meta">
                  {new Date(hi.fecha).toLocaleDateString('es')} {nombreActor(hi.quien)}: {hi.de === hi.a ? hi.motivo : `${hi.de.replace('_', ' ')} a ${hi.a.replace('_', ' ')}${hi.motivo ? ` (${hi.motivo})` : ''}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td>{a.familiaMecanismo}</td>
      <td className="meta">{a.relevancia}</td>
      <td className="meta">{a.comprobabilidad}</td>
      <td className="meta">
        {a.coste}; {a.demora}
        {a.dependeDe ? `; depende de ${a.dependeDe}` : ''}
      </td>
      <td>
        <Chip tono={a.estado === 'elegida' ? 'ok' : a.estado === 'sin_explorar' ? 'aviso' : 'borde'}>{a.estado.replace('_', ' ')}</Chip>
        {campana && <p className="meta">{tr("Campaña")} {campana.numero}</p>}
      </td>
      <td>
        <div className="acciones" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          {a.estado !== 'elegida' && (
            <button type="button" className="btn btn-pequeno" onClick={() => acciones.cambiarEstadoArea(inv.id, a.id, 'elegida', '', undefined, a.estado === 'pausada' ? 'reabierta' : 'elegida')}>
              {a.estado === 'pausada' ? 'Reabrir' : 'Elegir'}
            </button>
          )}
          {a.estado !== 'pausada' && (
            <>
              <input className="entrada" value={condicion} placeholder={tr("Condición para reabrirla")} onChange={(e) => setCondicion(e.target.value)} aria-label={`Condición de reapertura de ${a.titulo}`} />
              <button type="button" className="btn btn-pequeno" disabled={condicion.trim() === ''} onClick={() => acciones.cambiarEstadoArea(inv.id, a.id, 'pausada', condicion)}>
                {tr("Pausar con condición")}
              </button>
            </>
          )}
          {a.estado !== 'sin_explorar' && (
            <button type="button" className="btn btn-pequeno" onClick={() => acciones.cambiarEstadoArea(inv.id, a.id, 'sin_explorar', '', undefined, tr('se deja sin explorar'))}>
              {tr("Dejar sin explorar")}
            </button>
          )}
          {corridas.length > 0 && (
            <select className="entrada" value={a.corridaId ?? ''} onChange={(e) => acciones.cambiarEstadoArea(inv.id, a.id, null, '', e.target.value)} aria-label={`Campaña de ${a.titulo}`}>
              <option value="">{tr("Sin campaña")}</option>
              {corridas.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr("Campaña")} {c.numero} ({c.estado.replace('_', ' ')})
                </option>
              ))}
            </select>
          )}
        </div>
      </td>
    </tr>
  );
}

/** El programa en cuatro niveles (plan completo, etapas A a D): la meta amplia,
 *  las areas que se compararon y su estado, las campanas (corridas) que
 *  trabajan cada area, y la pregunta concreta de cada campana. Lo que no tiene
 *  campana o pregunta se ve como hueco, no se rellena. */
export function Jerarquia({ inv, corridas }: { inv: Investigacion; corridas: Corrida[] }) {
  const m = inv.mision;
  if (!m) return null;
  const areas = m.areas ?? [];
  const sinArea = corridas.filter((c) => !areas.some((a) => a.corridaId === c.id));
  const pregunta = (c: Corrida) => {
    const q = c.pregunta;
    if (!q) return <span className="meta">{tr("sin pregunta de campaña todavía")}</span>;
    return (
      <span>
        {q.intervencion || tr('la intervención')} frente a {q.comparador || tr('el comparador')} sobre {q.desenlace || tr('el desenlace')} en {q.contexto || tr('el contexto')}
        {q.umbralResuelto ? '' : tr(' (umbral de efecto sin resolver)')}
      </span>
    );
  };
  return (
    <Seccion detalle titulo={tr("Programa, áreas, campañas y preguntas")} nota={tr("La jerarquía del plan completo: una meta amplia se reparte en áreas comparables; cada área se trabaja en campañas (corridas) con una pregunta concreta y comprobable. Aquí se ve qué área tiene campaña, cuál está pausada y con qué condición, y qué campaña todavía no tiene pregunta.")}>
      <ul className="arbol">
        <li>
          <strong>Programa:</strong> {m.metaAmplia || inv.objetivo}
          <ul>
            {areas.length === 0 && <li className="meta">{tr("Sin áreas comparadas todavía.")}</li>}
            {areas.map((a) => {
              const cs = corridas.filter((c) => c.id === a.corridaId);
              return (
                <li key={a.id}>
                  <Chip tono={a.estado === 'elegida' ? 'ok' : a.estado === 'pausada' ? 'aviso' : 'borde'}>{a.estado.replace('_', ' ')}</Chip> <strong>{a.titulo}</strong>
                  {a.estado === 'pausada' && a.condicionReapertura ? <span className="meta"> {tr("(se reabre si:")} {a.condicionReapertura})</span> : null}
                  <ul>
                    {cs.length === 0 && <li className="meta">{a.estado === 'elegida' ? tr('Elegida sin campaña asignada.') : tr('Sin campaña.')}</li>}
                    {cs.map((c) => (
                      <li key={c.id}>
                        <a className="enlace" href={rutaDe(inv.id, 'corrida', c.id)}>
                          {tr("Campaña")} {c.numero}
                        </a>{' '}
                        <span className="meta">({c.estado.replace('_', ' ')})</span>
                        <ul>
                          <li>{pregunta(c)}</li>
                        </ul>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {sinArea.length > 0 && (
              <li>
                <span className="meta">{tr("Campañas sin área asignada:")}</span>
                <ul>
                  {sinArea.map((c) => (
                    <li key={c.id}>
                      <a className="enlace" href={rutaDe(inv.id, 'corrida', c.id)}>
                        {tr("Campaña")} {c.numero}
                      </a>{' '}
                      <span className="meta">({c.estado.replace('_', ' ')})</span>
                      <ul>
                        <li>{pregunta(c)}</li>
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </li>
      </ul>
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Motor causal minimo: grafo local e identificacion
// ---------------------------------------------------------------------------

export function GrafoCausalDeHipotesis({ h }: { h: Hipotesis }) {
  const g = h.grafoCausal;
  if (!g) return null;
  const etiqueta = (id: string) => g.nodos.find((n) => n.id === id)?.etiqueta ?? id;
  const tono = g.identificacion === 'identificable' ? 'ok' : g.identificacion === 'acotado' ? 'aviso' : 'mal';
  return (
    <Seccion detalle titulo={tr("Supuestos causales (comprobador heurístico)")} nota={tr("No es un motor causal: no hay modelo estructural, ni criterio de puerta trasera, ni descubrimiento de estructura desde datos (la literatura de 2026 dice que eso no está listo para biología). Es un comprobador por regla de los supuestos que separan asociación de causa: la exposición X, el desenlace Y, las alternativas que planteo el Killer y quince relaciones de consenso del Alzheimer escritas a mano. Un ensayo aleatorizado cierra la identificación; sin el, hacen falta temporalidad, ajuste por confusores y replicación independiente. Lo que falta es lo que un experimento tendría que aportar, y el Killer lo recibe como una comprobación más.")}>
      <div className="acciones">
        <Chip tono={tono}>{IDENTIFICACION_CAUSAL[g.identificacion] ?? g.identificacion}</Chip>
        <span className="meta">{g.resumen}</span>
      </div>
      {g.supuestosFaltantes.length > 0 && (
        <ul className="lista-limpia">
          {g.supuestosFaltantes.map((s, i) => (
            <li key={i} className="tono-aviso">
              Falta: {s}
            </li>
          ))}
        </ul>
      )}
      {g.supuestosCumplidos.length > 0 && (
        <ul className="lista-limpia">
          {g.supuestosCumplidos.map((s, i) => (
            <li key={i} className="meta">
              Cumplido: {s}
            </li>
          ))}
        </ul>
      )}
      <details className="versiones">
        <summary>
          {g.nodos.length} nodos y {g.aristas.length} aristas tipadas
        </summary>
        <ul className="lista-plana">
          {g.aristas.map((a, i) => (
            <li key={i}>
              <strong style={{ fontSize: 13 }}>{etiqueta(a.de)}</strong> causa <strong style={{ fontSize: 13 }}>{etiqueta(a.a)}</strong> <Chip tono={a.tipo === 'inferencia_con_evidencia' ? 'ok' : 'borde'}>{TIPO_ARISTA[a.tipo] ?? a.tipo}</Chip>
              <p className="meta">{a.contexto}</p>
            </li>
          ))}
        </ul>
      </details>
    </Seccion>
  );
}

/** Las aristas tipadas del modelo de mundo de una investigacion: la base
 *  curada y lo que cada hipotesis juzgada afirma, con su tipo. */
export function RelacionesCausales({ estado, inv }: { estado: EstadoRosa; inv: Investigacion }) {
  const rels = (estado.relaciones ?? []).filter((r) => r.investigacionId === null || r.investigacionId === inv.id);
  if (rels.length === 0) return null;
  const propias = rels.filter((r) => r.hipotesisId);
  const base = rels.filter((r) => !r.hipotesisId);
  return (
    <Seccion detalle titulo={tr("Relaciones causales tipadas")} nota={tr("Cada arista dice de dónde sale. Las de las hipótesis entran cuando el Killer las juzga, como supuesto o como inferencia con evidencia, y se actualizan con cada versión. La base curada es consenso del campo escrito a mano en el código (rosa/causal.py): se puede discutir y cambiar ahí.")}>
      {propias.length === 0 ? <p className="meta">{tr("Ninguna hipótesis juzgada todavía: solo la base curada.")}</p> : null}
      <ul className="lista-plana">
        {propias.map((r) => (
          <li key={r.id}>
            <strong style={{ fontSize: 13 }}>{r.de}</strong> causa <strong style={{ fontSize: 13 }}>{r.a}</strong> <Chip tono={r.tipo === 'inferencia_con_evidencia' ? 'ok' : 'borde'}>{TIPO_ARISTA[r.tipo] ?? r.tipo}</Chip>{' '}
            {r.hipotesisId && (
              <a className="enlace" href={rutaDe(inv.id, 'hipotesis', r.hipotesisId)}>
                abrir hipotesis
              </a>
            )}
            <p className="meta">{r.contexto}</p>
          </li>
        ))}
      </ul>
      <details className="versiones">
        <summary>Base curada ({base.length} relaciones de consenso)</summary>
        <ul className="lista-plana">
          {base.map((r) => (
            <li key={r.id} className="meta">
              {r.de} causa {r.a}: {r.contexto}
            </li>
          ))}
        </ul>
      </details>
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Panel del Killer: fallos plantados y tasa de deteccion
// ---------------------------------------------------------------------------

const ETIQUETA_FALLO: Record<string, string> = traducido({
  original: 'Original (acuerdo con la decisión real)',
  cifra_alterada: 'Cifra alterada',
  prediccion_vaga: 'Predicción no falsable',
  causal_sin_temporalidad: 'Causalidad sin temporalidad',
  misma_cohorte: 'Misma cohorte (debe avanzar con aviso)',
  supuesto_contradicho: 'Supuesto contradicho',
  gris_parcial: 'Gris: pasaje parcial (no debe descartar)',
});

export function PanelKiller({ estado }: { estado: EstadoRosa }) {
  const evs = [...(estado.evaluaciones ?? [])].filter((e) => e.tipo === 'panel_killer').sort((a, b) => b.fecha - a.fecha);
  return (
    <Seccion detalle titulo={tr("Panel del Killer")} nota={tr("Hipótesis reales con un fallo plantado a propósito (cifra alterada, predicción vaga, causalidad sin temporalidad, misma cohorte, supuesto contradicho) y un conjunto gris que no debe descartarse. Mide qué fracción detecta el Killer, si lo detecta la comprobación correcta, cuánto se abstiene y cuánto mata de más. Se repite con cada versión del prompt o del modelo: si baja, se sabe antes de que llegue a una hipótesis real.")}>
      {evs.length === 0 ? (
        <p className="meta">{tr("Sin paneles todavía. Se corre desde el servidor con el comando del README (cuesta llamadas al juez).")}</p>
      ) : (
        evs.slice(0, 3).map((ev) => (
          <div key={ev.id} className="tarjeta">
            <div className="acciones">
              <Chip tono={ev.resumen.tasaDeteccion !== null && ev.resumen.tasaDeteccion >= 0.8 ? 'ok' : 'aviso'}>{tr("Detección")} {ev.resumen.tasaDeteccion === null ? 'n/a' : `${Math.round(ev.resumen.tasaDeteccion * 100)} %`}</Chip>
              <Chip tono="borde">Juez detecta {ev.resumen.tasaJuezDetecta === null ? 'n/a' : `${Math.round(ev.resumen.tasaJuezDetecta * 100)} %`}</Chip>
              <Chip tono="borde">{tr("Abstención")} {Math.round(ev.resumen.abstencion * 100)} %</Chip>
              <Chip tono={ev.resumen.sobreMatanzaGris !== null && ev.resumen.sobreMatanzaGris > 0 ? 'mal' : 'ok'}>{tr("Mata de más en gris")} {ev.resumen.sobreMatanzaGris === null ? 'n/a' : `${Math.round(ev.resumen.sobreMatanzaGris * 100)} %`}</Chip>
              <span className="meta">
                {ev.resumen.casos} casos sobre {ev.resumen.hipotesis} hipótesis, juez {ev.resumen.juez}, {ev.resumen.usd} USD, {new Date(ev.fecha).toLocaleString('es')}
              </span>
            </div>
            {ev.resumen.acuerdo?.decision && (
              <p className="meta" title={tr("Kappa de Cohen: acuerdo entre la decisión esperada y la que salió, corregido por el que se daría por azar. Landis y Koch: 0,41 a 0,60 moderado, 0,61 a 0,80 sustancial, más de 0,80 casi perfecto.")}>
                {tr("Acuerdo por decisión: kappa")} {ev.resumen.acuerdo.decision.kappa ?? 'n/a'} ({ev.resumen.acuerdo.decision.interpretacion}, n = {ev.resumen.acuerdo.decision.n})
                {Object.entries(ev.resumen.acuerdo.porComprobacion).map(([c, a]) => ` · ${COMPROBACION_KILLER[c] ?? c}: ${a.kappa ?? 'n/a'}`).join('')}
              </p>
            )}
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fallo plantado</th>
                  <th>Casos</th>
                  <th>Detectados</th>
                  <th>{tr("Lo vio el juez")}</th>
                  <th>Suspendidas</th>
                  <th>Descartadas</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ev.porFallo).map(([f, r]) => (
                  <tr key={f}>
                    <td title={ev.fallos[f]}>{ETIQUETA_FALLO[f] ?? f}</td>
                    <td>{r.casos}</td>
                    <td>{f === 'original' ? `${r.acuerdoConReal ?? 0} de acuerdo con la real` : `${r.detectados ?? 0}`}</td>
                    <td>{f === 'original' ? '' : (r.juezFalla ?? 0)}</td>
                    <td>{r.suspendidas ?? 0}</td>
                    <td>{r.descartadas ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Conectores: catalogo y registro de consultas
// ---------------------------------------------------------------------------

/** El catalogo de conectores tal como esta en el codigo (rosa/conectores/):
 *  que base, que aporta, limite, licencia, si necesita clave y si esta
 *  disponible. Lo que no esta disponible se lista con su motivo, para que se
 *  vea que existe en Claude Science y por que ROSA2018 no lo usa. */
export function Conectores({ conectores }: { conectores: ConectorCatalogo[] | undefined }) {
  const lista = conectores ?? [];
  const grupos = Array.from(new Set(lista.map((c) => c.grupo)));
  const disponibles = lista.filter((c) => c.estado === 'disponible').length;
  return (
    <Seccion detalle titulo={tr("Conectores a bases públicas")} nota={`Cada conector envuelve una API pública con su límite de peticiones y su licencia. Cada llamada deja un registro de consulta (herramienta, argumentos, fecha, resultados, identificadores, invariante comprobada) en la hipótesis que la pidió. ${disponibles} de ${lista.length} disponibles; el resto se lista con el motivo. Una fuente que no responde es "no pude comprobar", nunca "no hay".`}>
      {lista.length === 0 ? (
        <p className="meta">{tr("El catálogo llega del servidor al arrancar.")}</p>
      ) : (
        grupos.map((g) => (
          <details key={g} className="versiones" open={g === 'alzheimer' || g === 'directorio'}>
            <summary>
              {GRUPO_CONECTOR[g] ?? g} ({lista.filter((c) => c.grupo === g).length})
            </summary>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fuente</th>
                  <th>{tr("Qué aporta")}</th>
                  <th>{tr("Límite y licencia")}</th>
                  <th>Estado</th>
                  <th>Usos</th>
                </tr>
              </thead>
              <tbody>
                {lista
                  .filter((c) => c.grupo === g)
                  .map((c) => (
                    <tr key={c.nombre}>
                      <td>
                        <strong style={{ fontSize: 13 }}>{c.fuente}</strong>
                        <p className="meta">
                          {c.descripcion}{' '}
                          <a className="enlace" href={c.urlDoc} target="_blank" rel="noopener noreferrer">
                            doc
                          </a>
                        </p>
                      </td>
                      <td className="meta">{c.aporta}</td>
                      <td className="meta">
                        {c.limite}
                        {c.licencia ? `. ${c.licencia}` : ''}
                        {c.clave !== 'no' ? `. Clave: ${c.clave}` : ''}
                      </td>
                      <td>
                        <Chip tono={ESTADO_CONECTOR[c.estado]?.tono ?? 'neutro'}>{ESTADO_CONECTOR[c.estado]?.etiqueta ?? c.estado}</Chip>
                        {c.motivo && <p className="meta">{c.motivo}</p>}
                      </td>
                      <td className="meta">
                        {c.usos}
                        {c.errores ? ` (${c.errores} sin respuesta)` : ''}
                        {c.estado === 'disponible' && (
                          <select className="entrada" value={c.permiso ?? 'permitir'} onChange={(e) => acciones.fijarPermisoConector(c.nombre, e.target.value as NivelPermisoConector)} aria-label={`Permiso de ${c.fuente}`} title={tr("Permitir: el bucle y las personas lo usan. Solo persona: solo cuando alguien pregunta desde aquí. Bloquear: nadie.")}>
                            <option value="permitir">Permitir</option>
                            <option value="solo_persona">{tr("Solo si pregunta una persona")}</option>
                            <option value="bloquear">Bloquear</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        ))
      )}
    </Seccion>
  );
}

/** Las consultas a bases que esta hipotesis provoco, con lo que Claude
 *  Science exige registrar: herramienta, argumentos, fecha, numero de
 *  resultados, identificadores retenidos e invariante comprobada. */
export function TablaConsultas({ consultas, ahora }: { consultas: ConsultaBase[]; ahora: number }) {
  const cs = [...consultas].sort((a, b) => b.fecha - a.fecha);
  return (
    <table className="tabla">
      <thead>
        <tr>
          <th>Base</th>
          <th>Argumentos</th>
          <th>Resultados</th>
          <th>Invariante</th>
          <th>{tr("Cuándo")}</th>
        </tr>
      </thead>
      <tbody>
        {cs.slice(0, 40).map((c) => (
          <tr key={c.id}>
            <td>
              <strong style={{ fontSize: 13 }}>{c.fuente || c.herramienta}</strong>
              <p className="meta">{c.herramienta}</p>
            </td>
            <td className="meta">
              {Object.entries(c.argumentos)
                .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
                .join(', ')}
            </td>
            <td className="meta">
              {c.error ? <span className="tono-aviso">{c.error}</span> : `${c.n ?? '?'} resultados${c.ids.length ? `; ids: ${c.ids.slice(0, 4).join(', ')}${c.ids.length > 4 ? '...' : ''}` : ''}${c.version ? `; version ${c.version}` : ''}`}
            </td>
            <td>{c.invariante ? <Chip tono={c.invariante.ok ? 'ok' : 'aviso'}>{c.invariante.detalle.slice(0, 80)}</Chip> : <span className="meta">sin invariante</span>}</td>
            <td className="meta">
              <Momento t={c.fecha} ahora={ahora} /> ({c.ms} ms)
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Las consultas a bases que esta hipotesis provoco. */
export function ConsultasABases({ h, ahora }: { h: Hipotesis; ahora: number }) {
  const cs = h.consultas ?? [];
  if (cs.length === 0) return null;
  const fallidas = cs.filter((c) => c.error).length;
  return (
    <Seccion detalle titulo={tr("Consultas a bases")} nota={tr("Cada fila es una llamada a una base pública hecha para esta hipótesis. La invariante es una comprobación independiente de que la respuesta es la que se esperaba (un símbolo resuelve a un único gen, el accession coincide). Sin respuesta significa que no se pudo comprobar, no que no exista.")}>
      <p className="meta">
        {cs.length} {cs.length === 1 ? 'consulta' : 'consultas'}
        {fallidas ? `, ${fallidas} sin respuesta` : ''}
      </p>
      <TablaConsultas consultas={cs} ahora={ahora} />
    </Seccion>
  );
}

/** Memoria del proyecto: hechos cortos que ROSA2018 lee en cada mision. Los
 *  escribe y borra una persona. */
export function MemoriaDelProyecto({ inv }: { inv: Investigacion }) {
  const [texto, setTexto] = useState('');
  const memoria = inv.memoria ?? [];
  return (
    <Seccion titulo={tr("Memoria del proyecto")} nota={tr("Hechos cortos y estables que ROSA2018 lee en cada misión, plan y revisión: una preferencia ('solo datos públicos'), una restricción ('no proponer ensayos con fármacos retirados'), una decisión confirmada. No es para resultados ni para copiar literatura: para eso están los hechos y los artefactos.")}>
      {memoria.length === 0 ? <p className="meta">{tr("Sin memoria todavía.")}</p> : null}
      <ul className="lista-plana">
        {memoria.map((m) => (
          <li key={m.id} className="acciones">
            <span style={{ fontSize: 13 }}>{m.texto}</span>
            <span className="meta">
              {nombreActor(m.quien)}, {new Date(m.fecha).toLocaleDateString('es')}
            </span>
            <button type="button" className="btn btn-pequeno" onClick={() => acciones.quitarMemoria(inv.id, m.id)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="dirigir">
        <input className="entrada" value={texto} maxLength={400} placeholder={tr("Un hecho estable que ROSA2018 deba recordar")} onChange={(e) => setTexto(e.target.value)} aria-label={tr("Nuevo hecho de memoria")} />
        <button
          type="button"
          className="btn"
          disabled={texto.trim() === ''}
          onClick={() => {
            acciones.anadirMemoria(inv.id, texto);
            setTexto('');
          }}
        >
          Recordar
        </button>
      </div>
    </Seccion>
  );
}

/** Preguntar a las bases con herramientas: ROSA2018 elige que conectores llamar,
 *  responde en llano y deja cada consulta registrada. */
export function PreguntarALasBases({ inv, ahora }: { inv: Investigacion; ahora: number }) {
  const [pregunta, setPregunta] = useState('');
  // En vuelo mientras el bucle de herramientas responde (puede tardar): el botón lo enseña y no admite un segundo clic.
  const [enviando, envolverPregunta] = useEnVuelo();
  const [error, setError] = useState<string | null>(null);
  const preguntas = [...(inv.preguntasABases ?? [])].sort((a, b) => b.fecha - a.fecha);
  return (
    <Seccion titulo={tr("Preguntar a las bases")} nota={tr("ROSA2018 responde consultando las bases públicas del catálogo, el propio proyecto y el modelo de mundo, con un bucle acotado de herramientas (elige una, lee el resultado, repite hasta seis veces). Cada dato lleva detrás la herramienta y el identificador; lo que ninguna base devolvió no se afirma. Cuesta llamadas al cerebro.")}>
      <div className="dirigir">
        <input className="entrada" value={pregunta} placeholder={tr("Qué fármacos aprobados tocan TREM2 y en que tejidos se expresa")} onChange={(e) => setPregunta(e.target.value)} aria-label={tr("Pregunta a las bases")} />
        <button
          type="button"
          className="btn btn-primario"
          disabled={pregunta.trim() === '' || enviando}
          {...atributosEnVuelo(enviando)}
          onClick={envolverPregunta(async () => {
            setError(null);
            const err = await acciones.preguntarALasBases(inv.id, pregunta);
            setError(err);
            if (!err) setPregunta('');
          })}
        >
          {enviando ? tr('Consultando bases...') : tr('Preguntar con herramientas')}
        </button>
        {error && <span className="tono-mal">{error}</span>}
      </div>
      {preguntas.slice(0, 5).map((q) => (
        <div key={q.id} className="tarjeta" style={{ marginTop: 8 }}>
          <p>
            <strong style={{ fontSize: 13 }}>{q.pregunta}</strong>{' '}
            <span className="meta">
              {nombreActor(q.quien)}, <Momento t={q.fecha} ahora={ahora} />, {q.iteraciones} {q.iteraciones === 1 ? 'paso' : 'pasos'}, {q.herramientas.length} {q.herramientas.length === 1 ? 'herramienta' : 'herramientas'}
            </span>
          </p>
          {q.error ? <p className="tono-mal">{q.error}</p> : <p style={{ whiteSpace: 'pre-wrap' }}>{q.respuesta}</p>}
          {q.limites && <p className="meta">{tr("Límites:")} {q.limites}</p>}
          {q.consultas.length > 0 && (
            <details className="versiones">
              <summary>{q.consultas.length} consultas registradas</summary>
              <TablaConsultas consultas={q.consultas} ahora={ahora} />
            </details>
          )}
        </div>
      ))}
    </Seccion>
  );
}

/** El contexto de la diana desde las bases, debajo de la tarjeta. */
export function ContextoDeBases({ h }: { h: Hipotesis }) {
  const c = h.contextoBases;
  if (!c) return null;
  const ids = c.identificadores ?? {};
  return (
    <div className="tarjeta" style={{ marginTop: 8 }}>
      <div className="acciones">
        <strong style={{ fontSize: 13 }}>{tr("La diana en las bases")}</strong>
        {ids.ensembl ? (
          <>
            <Chip tono="ok">{ids.simbolo ?? c.diana}</Chip>
            <span className="meta">
              Ensembl {ids.ensembl}
              {ids.uniprot ? ` · UniProt ${ids.uniprot}` : tr(' · sin entrada UniProt revisada')}
              {ids.entrez ? ` · Entrez ${ids.entrez}` : ''}
            </span>
          </>
        ) : (
          <Chip tono="aviso">"{c.diana}{tr("\" no resuelve a un gen humano en MyGene")}</Chip>
        )}
      </div>
      {c.funcion && <p className="meta">{tr("Función (UniProt):")} {c.funcion}</p>}
      {c.expresionCerebro && <p className="meta">{tr("Expresión (Human Protein Atlas):")} {c.expresionCerebro}</p>}
      {c.interactores.length > 0 && <p className="meta">Interactores (STRING): {c.interactores.map((i) => `${i.simbolo} (${i.puntuacion})`).join(', ')}</p>}
      {c.rutas.length > 0 && <p className="meta">Rutas (Reactome): {c.rutas.map((r) => r.nombre).join('; ')}</p>}
    </div>
  );
}


/** Perfil de la diana capa por capa (rosa/dianas.py perfil_de_diana): seis
 *  preguntas, una por capa, cada una con su estado (presente, ausente o no
 *  pude comprobar), el detalle en castellano y, solo en la genética, la
 *  dirección del efecto. Sin puntuación combinada a propósito: cada capa
 *  responde a una cosa distinta y sumarlas escondería cuál falta. Un registro
 *  antiguo sin perfil no pinta nada; una capa que no venga en el registro se
 *  dice como "no pude comprobar", nunca como ausente. */
export function PerfilDeLaDiana({ h }: { h: Hipotesis }) {
  const perfil = h.perfilDiana;
  if (!perfil || typeof perfil !== 'object') return null;
  const ids = perfil.identificadores && typeof perfil.identificadores === 'object' ? perfil.identificadores : { simbolo: null, nombre: null, ensembl: null, uniprot: null, entrez: null, gencode: null };
  const capas: CapaPerfilDiana[] = Array.isArray(perfil.capas) ? perfil.capas.filter((c): c is CapaPerfilDiana => Boolean(c) && typeof c === 'object') : [];
  const simbolo = (typeof ids.simbolo === 'string' && ids.simbolo) || (typeof perfil.diana === 'string' && perfil.diana) || tr('la diana');
  return (
    <div className="tarjeta" style={{ marginTop: 8 }}>
      <div className="acciones">
        <strong style={{ fontSize: 13 }}>{tr("Perfil de la diana")}</strong>
        <Chip tono="borde">{simbolo}</Chip>
        {typeof ids.nombre === 'string' && ids.nombre && <span className="meta">{ids.nombre}</span>}
        {typeof perfil.contexto === 'string' && perfil.contexto && <span className="meta" title={tr("La célula o el tejido de la tarjeta con que se eligió el tejido de GTEx (expresión por tejido).")}>Contexto: {perfil.contexto}</span>}
        {typeof perfil.version === 'number' && <span className="meta">{tr("Consultado para la versión")} {perfil.version}</span>}
        {typeof perfil.consultadoEn === 'number' && (
          <span className="meta">
            <Momento t={perfil.consultadoEn} ahora={Date.now()} />
          </span>
        )}
      </div>
      {typeof perfil.resumen === 'string' && perfil.resumen && <p style={{ fontSize: 13 }}>{perfil.resumen}</p>}
      <p className="meta">
        {tr("Seis preguntas sobre la diana (el gen o la proteína a la que apunta la hipótesis), una por capa y sin sumar. Presente: alguna base trae registro. Ausente: las bases respondieron y no tienen nada. No pude comprobar: la base no respondió o no trae el dato, que no es lo mismo que ausente.")}
      </p>
      <table className="tabla">
        <thead>
          <tr>
            <th>Capa</th>
            <th>Estado</th>
            <th>{tr("Qué dicen las bases")}</th>
          </tr>
        </thead>
        <tbody>
          {ORDEN_CAPAS_DIANA.map((k) => {
            const c = capas.find((x) => x.capa === k) ?? null;
            const estado = c && typeof c.estado === 'string' && Object.hasOwn(ESTADO_CAPA_DIANA, c.estado) ? ESTADO_CAPA_DIANA[c.estado] : ESTADO_CAPA_DIANA.no_pude_comprobar;
            const detalle = c ? (typeof c.detalle === 'string' && c.detalle ? c.detalle : tr('Sin detalle en el registro.')) : tr('El registro no trae esta capa: no se consultó o es de una versión anterior del perfil.');
            const fuentes = c && Array.isArray(c.fuentes) ? c.fuentes.filter((f): f is string => typeof f === 'string' && f !== '') : [];
            const direccion = k === 'genetica_humana' && c ? (c.direccion === '+' || c.direccion === '-' ? DIRECCION_GENETICA[c.direccion] : null) : null;
            return (
              <tr key={k}>
                <td>
                  <strong style={{ fontSize: 13 }}>{CAPA_DIANA[k].etiqueta}</strong>
                  <div className="meta">{CAPA_DIANA[k].pregunta}</div>
                </td>
                <td>
                  <Chip tono={estado.tono} title={estado.definicion}>
                    {estado.etiqueta}
                  </Chip>
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>{detalle}</div>
                  {k === 'genetica_humana' && c && (
                    <div className="meta" title={tr("Convención de Open Targets: '+' quiere decir que más función de la diana se asocia a más riesgo; '-', que menos función se asocia a más riesgo. Sin dirección: las bases no la traen para este gen.")}>
                      {tr("Dirección del efecto:")} {direccion ?? tr('sin dirección en las bases')}
                    </div>
                  )}
                  {fuentes.length > 0 && <div className="meta">Bases: {fuentes.join(', ')}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TONO_VEREDICTO: Record<string, 'ok' | 'mal' | 'aviso' | 'borde'> = { confirma: 'ok', refuta: 'mal', inconcluso: 'aviso', no_evaluable: 'borde' };
const ETIQUETA_VEREDICTO: Record<string, string> = { confirma: 'confirma', refuta: 'refuta', inconcluso: 'inconcluso', no_evaluable: 'no evaluable' };

function textoO(x: unknown, vacio: string): string {
  return typeof x === 'string' && x.trim() !== '' ? x : vacio;
}

/** El contrato del experimento (rosa/experimento.py): las lecturas, cada una
 *  con lo que la confirmaría y lo que la refutaría fijado de antemano, su
 *  control y su unidad; el sistema experimental con qué prueba y qué no
 *  representa; el propósito del biomarcador según BEST; el nivel del
 *  desenlace y el puente al beneficio; y lo que le falta al contrato por
 *  regla. Con resultado, el veredicto por lectura y la lectura del negativo.
 *  Un registro antiguo (solo ensayo, confirma y refuta) se enseña como una
 *  sola lectura derivada, dicha como tal. Las etiquetas salen del vocabulario
 *  de acciones.ts, nunca la clave con guiones bajos. */
/** El hash de las lecturas congelado al prerregistrar. El servidor y el
 *  reducer recalculan `experimento.hashLecturas` en cada enmienda (pasa a ser
 *  el vigente) y la primera enmienda guarda en `hashAntes` el que había: ese
 *  es el congelado. Sin enmiendas, el congelado es el propio `hashLecturas`.
 *  Null si el experimento no se prerregistró con hash. */
export function hashCongelado(x: Partial<Pick<NonNullable<Hipotesis['experimento']>, 'hashLecturas' | 'enmiendas'>>): string | null {
  const primera = Array.isArray(x.enmiendas) ? x.enmiendas.find((en) => en && typeof en === 'object' && typeof en.hashAntes === 'string' && en.hashAntes !== '') : undefined;
  if (primera && typeof primera.hashAntes === 'string') return primera.hashAntes;
  return typeof x.hashLecturas === 'string' && x.hashLecturas !== '' ? x.hashLecturas : null;
}

/** El hash vigente de las lecturas: el que guardó el servidor tras la última
 *  enmienda o, si no lo guardó, el recalculado aquí sobre las lecturas actuales. */
export function hashVigente(x: Partial<Pick<NonNullable<Hipotesis['experimento']>, 'hashLecturas' | 'enmiendas' | 'lecturas' | 'confirma' | 'refuta' | 'ensayo'>>): string {
  const ultima = Array.isArray(x.enmiendas) ? [...x.enmiendas].reverse().find((en) => en && typeof en === 'object' && typeof en.hashDespues === 'string' && en.hashDespues !== '') : undefined;
  if (ultima && typeof ultima.hashDespues === 'string') return ultima.hashDespues;
  try {
    return hashLecturas(x);
  } catch {
    return typeof x.hashLecturas === 'string' ? x.hashLecturas : '';
  }
}

export function ContratoDelExperimento({ h }: { h: Hipotesis }) {
  const x = h.experimento;
  const [enmendando, setEnmendando] = useState<number | null>(null);
  const [campo, setCampo] = useState<CampoLecturaEnmendable>('queConfirma');
  const [despues, setDespues] = useState('');
  const [motivo, setMotivo] = useState('');
  useEffect(() => {
    // Al pasar a otra hipótesis se cierra el formulario y se vacía lo escrito: lo tecleado para una no puede acabar registrado en la otra.
    setEnmendando(null);
    setDespues('');
    setMotivo('');
    setCampo('queConfirma');
  }, [h.id]);
  if (!x || typeof x !== 'object') return null;
  const contrato = normalizarContrato(x);
  // Cada fila lleva el índice de `experimento.lecturas` tal como está guardado,
  // que es el que entienden el reducer y el servidor (enmendar_lectura). Una
  // entrada nula o sin nombre ni criterios no se pinta, pero sigue ocupando su
  // posición: si se numerara por la tabla, la enmienda iría a otra lectura.
  const crudas: unknown[] = Array.isArray(x.lecturas) ? x.lecturas : [];
  const declaradas = crudas
    .map((l, indice) => ({ indice, lectura: normalizarContrato({ lecturas: [l] }).lecturas[0] ?? null }))
    .filter((f): f is { indice: number; lectura: LecturaExperimento } => f.lectura !== null);
  const derivadas = declaradas.length === 0 && contrato.lecturas.length > 0;
  // Las derivadas de los criterios antiguos no existen en `experimento.lecturas`: índice -1, sin enmienda desde aquí.
  const filas: { indice: number; lectura: LecturaExperimento }[] = derivadas ? contrato.lecturas.map((lectura) => ({ indice: -1, lectura })) : declaradas;
  const lecturas = filas.map((f) => f.lectura);
  const sistema = contrato.sistema;
  const sistemaInfo = sistema && Object.hasOwn(SISTEMAS_EXPERIMENTALES, sistema.tipo) ? SISTEMAS_EXPERIMENTALES[sistema.tipo] : null;
  const proposito = contrato.propositoBiomarcador;
  const nivel = contrato.nivelDesenlace;
  const problemas = Array.isArray(x.problemasContrato) ? x.problemasContrato.filter((p): p is string => typeof p === 'string' && p !== '') : [];
  const puedeEnmendar = Boolean(x.prerregistradoEn) && !x.resultado && declaradas.length > 0;
  const r = x.resultado && typeof x.resultado === 'object' ? x.resultado : null;
  const veredictos: VeredictoLectura[] = r && Array.isArray(r.veredictosPorLectura) ? r.veredictosPorLectura.filter((v): v is VeredictoLectura => Boolean(v) && typeof v === 'object') : [];
  const negativo = r && r.lecturaDelNegativo && typeof r.lecturaDelNegativo === 'object' ? r.lecturaDelNegativo : null;
  const negativoDestacado = Boolean(negativo && (r?.veredicto === 'refuta' || r?.veredicto === 'inconcluso'));
  const rama = negativo && typeof negativo.rama === 'string' && Object.hasOwn(RAMA_NEGATIVO, negativo.rama) ? RAMA_NEGATIVO[negativo.rama] : null;
  const lecturaEnEdicion = enmendando !== null ? declaradas.find((f) => f.indice === enmendando)?.lectura ?? null : null;
  const enviarEnmienda = () => {
    if (enmendando === null) return;
    acciones.enmendarLectura(h.id, enmendando, campo, despues, motivo);
    setDespues('');
    setMotivo('');
    setCampo('queConfirma');
    setEnmendando(null);
  };
  return (
    <div className="seccion" data-contrato-experimento>
      <h4>{tr("Contrato del experimento")}</h4>
      <p className="meta">
        {tr("Qué se mide (cada medida es una \"lectura\"), con lo que la confirmaría y lo que la refutaría escrito antes de tener datos, en qué sistema se hace y para qué sirve el biomarcador. Separar la lectura de compromiso de diana (que la intervención llegó a la diana) de la de efecto es lo que permite leer un resultado negativo: sin esa separación no se sabe si falló la hipótesis o el ensayo.")}
      </p>
      {lecturas.length === 0 ? (
        <p className="meta">{tr("Sin lecturas declaradas: el experimento no dice qué medirá ni con qué criterios. Así no es interpretable.")}</p>
      ) : (
        <>
          {derivadas && <p className="meta">{tr("Este experimento no declara lecturas separadas; los criterios antiguos (ensayo, confirma, refuta y controles) cuentan como una sola lectura de tipo biomarcador. Con una sola lectura un negativo no se puede leer.")}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Lectura</th>
                  <th>Tipo</th>
                  <th>Confirma si</th>
                  <th>Refuta si</th>
                  <th>Control</th>
                  <th>Unidad</th>
                  {puedeEnmendar && <th>Enmienda</th>}
                </tr>
              </thead>
              <tbody>
                {filas.map(({ indice, lectura: l }, i) => {
                  const enVocabulario = typeof l.tipo === 'string' && Object.hasOwn(TIPOS_LECTURA, l.tipo);
                  return (
                    <tr key={i}>
                      <td>
                        <strong style={{ fontSize: 13 }}>{textoO(l.nombre, `lectura ${i + 1}`)}</strong>
                      </td>
                      <td>
                        <Chip tono={enVocabulario ? 'borde' : 'aviso'} title={enVocabulario ? TIPOS_LECTURA[l.tipo].definicion: tr('Tipo fuera del vocabulario cerrado (compromiso de diana, viabilidad, función o mecanismo, biomarcador, seguridad); la lista de lo que le falta al contrato lo dice.')}>
                          {etiquetaContrato(TIPOS_LECTURA, l.tipo) || 'sin tipo'}
                        </Chip>
                      </td>
                      <td className={l.queConfirma ? '' : 'tono-mal'}>{textoO(l.queConfirma, tr('sin criterio'))}</td>
                      <td className={l.queRefuta ? '' : 'tono-mal'}>{textoO(l.queRefuta, tr('sin criterio'))}</td>
                      <td className={l.control ? '' : 'meta'}>{textoO(l.control, tr('sin control declarado'))}</td>
                      <td className={l.unidad ? '' : 'meta'}>{textoO(l.unidad, tr('sin unidad'))}</td>
                      {puedeEnmendar && (
                        <td>
                          <button type="button" className="btn btn-s" aria-pressed={enmendando === indice} onClick={() => setEnmendando(enmendando === indice ? null : indice)}>
                            {enmendando === indice ? 'Cancelar' : 'Enmendar'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {puedeEnmendar && lecturaEnEdicion && enmendando !== null && (
        <div className="campo-fila" data-enmienda-lectura>
          <span className="meta">{tr("Enmienda fechada de la lectura «")}{textoO(lecturaEnEdicion.nombre, `lectura ${declaradas.findIndex((f) => f.indice === enmendando) + 1}`)}{tr("» (queda registrada con autor, fecha y motivo; el hash congelado del prerregistro deja de coincidir y eso delata el cambio):")}</span>
          <select className="entrada" value={campo} onChange={(e) => setCampo(e.target.value as CampoLecturaEnmendable)} aria-label={tr("Campo de la lectura a enmendar")}>
            {CAMPOS_LECTURA_ENMENDABLES.map((c) => (
              <option key={c} value={c}>
                {ETIQUETA_CAMPO_LECTURA[c]}
              </option>
            ))}
          </select>
          <input className="entrada" value={despues} placeholder={`Texto nuevo (ahora: ${String(lecturaEnEdicion[campo] ?? '').slice(0, 60) || tr('vacío')})`} onChange={(e) => setDespues(e.target.value)} aria-label={tr("Texto nuevo de la lectura")} />
          <input className="entrada" value={motivo} placeholder={tr("Motivo de la enmienda")} onChange={(e) => setMotivo(e.target.value)} aria-label={tr("Motivo de la enmienda de la lectura")} />
          <button type="button" className="btn" disabled={despues.trim() === '' || motivo.trim() === ''} onClick={enviarEnmienda}>
            {tr("Registrar enmienda de la lectura")}
          </button>
        </div>
      )}
      {Boolean(x.prerregistradoEn) && !x.resultado && derivadas && <p className="meta">{tr("La lectura derivada de los criterios antiguos se enmienda desde los campos de texto (criterio de confirmación, de refutación, controles), no desde aquí.")}</p>}
      <div className="conclusion-columnas">
        <div className="experimento-bloque">
          <h4>Sistema experimental</h4>
          {sistema ? (
            <>
              <div className="acciones">
                <Chip tono="borde" title={sistemaInfo ? sistemaInfo.definicion: tr('Tipo de sistema fuera del vocabulario cerrado.')}>
                  {etiquetaContrato(SISTEMAS_EXPERIMENTALES, sistema.tipo) || 'sin tipo'}
                </Chip>
                {sistemaInfo && <span className="meta">{sistemaInfo.definicion}</span>}
              </div>
              <p style={{ fontSize: 13 }}>
                <strong>{tr("Qué prueba:")}</strong> {textoO(sistema.quePrueba, 'no declarado')}
              </p>
              <p style={{ fontSize: 13 }}>
                <strong>{tr("Qué no representa:")}</strong> {sistema.queNoRepresenta ? sistema.queNoRepresenta : <span className="meta">no declarado{sistemaInfo ? `; límite general de este sistema: ${sistemaInfo.queNoRepresenta}` : ''}</span>}
              </p>
            </>
          ) : (
            <p className="meta">{tr("No declarado: el experimento no dice en qué sistema se hace (observacional en humanos, datos públicos, células de donante, iPSC, organoide, cocultivo, animal o in silico), así que tampoco dice qué no representa.")}</p>
          )}
        </div>
        <div className="experimento-bloque">
          <h4 title={tr("BEST (Biomarkers, EndpointS and other Tools) es la clasificación de la FDA y el NIH de para qué sirve un biomarcador: riesgo, diagnóstico, monitorización, pronóstico, predicción de respuesta, farmacodinámico o seguridad.")}>{tr("Propósito del biomarcador (BEST)")}</h4>
          {proposito ? (
            <div className="acciones">
              <Chip tono="borde" title={PROPOSITOS_BIOMARCADOR[proposito].definicion}>
                {PROPOSITOS_BIOMARCADOR[proposito].etiqueta}
              </Chip>
              <span className="meta">{PROPOSITOS_BIOMARCADOR[proposito].definicion}</span>
            </div>
          ) : (
            <p className="meta">{tr("No declarado. BEST es la clasificación de la FDA y el NIH de para qué sirve un biomarcador (riesgo, diagnóstico, monitorización, pronóstico, predicción de respuesta, farmacodinámico, seguridad); sin ella no se sabe qué decisión informaría la medida.")}</p>
          )}
          <h4 style={{ marginTop: 8 }} title={tr("A qué nivel se lee el desenlace: molecular, celular, fisiológico o de imagen, funcional o clínico. Cuanto más abajo, más lejos del beneficio para una persona.")}>{tr("Nivel del desenlace")}</h4>
          {nivel ? (
            <div className="acciones">
              <Chip tono="borde" title={NIVELES_DESENLACE[nivel].definicion}>
                {NIVELES_DESENLACE[nivel].etiqueta}
              </Chip>
              <span className="meta">{NIVELES_DESENLACE[nivel].definicion}</span>
            </div>
          ) : (
            <p className="meta">{tr("No declarado. El nivel dice a qué distancia del beneficio para una persona está lo que se mide: molecular, celular, fisiológico o de imagen, funcional o clínico.")}</p>
          )}
          <h4 style={{ marginTop: 8 }} title={tr("Qué relación tiene el desenlace medido con el beneficio para una persona: por qué cambiar esta medida importaría a alguien.")}>{tr("Puente al beneficio")}</h4>
          <p style={{ fontSize: 13 }}>{contrato.puenteAlBeneficio ? contrato.puenteAlBeneficio : <span className="meta">{tr("No declarado: el resultado, por sí solo, no habla de beneficio para una persona.")}</span>}</p>
        </div>
      </div>
      {hashCongelado(x) && (
        <p className="meta" title={tr("SHA-256 de las lecturas en orden canónico, congelado al prerregistrar (es el que lleva el artefacto del prerregistro y el sello externo). Cada enmienda recalcula el hash vigente y guarda el anterior y el nuevo; si el vigente ya no coincide con el congelado, el contrato cambió después de congelarse.")}>
          {tr("Hash de las lecturas congelado al prerregistrar:")} <span className="mono">{hashCongelado(x)!.slice(0, 16)}…</span>
          {hashVigente(x) !== hashCongelado(x) && (
            <>
              {' '}
              <span className="tono-aviso">{tr("Las lecturas se enmendaron después: hash actual")} <span className="mono">{hashVigente(x).slice(0, 16)}…</span></span>
            </>
          )}
        </p>
      )}
      {problemas.length > 0 && (
        <div>
          <p className="campo-etiqueta">{tr("Lo que le falta al contrato (por regla)")}</p>
          <ul className="supuestos">
            {problemas.map((p, i) => (
              <li key={i} className="supuesto supuesto-aviso">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r && (veredictos.length > 0 || negativo) && (
        <div className="experimento-bloque">
          <h4>{tr("Veredicto por lectura")}</h4>
          <p className="meta">{tr("Cada lectura del contrato contrastada por regla con la cifra que la nombra en el resultado. \"No evaluable\" quiere decir que ninguna cifra la nombró: no pude comprobar, no que fallara.")}</p>
          {veredictos.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Lectura</th>
                    <th>Tipo</th>
                    <th>Veredicto</th>
                    <th>Motivo</th>
                    <th>Cifras</th>
                  </tr>
                </thead>
                <tbody>
                  {veredictos.map((v, i) => {
                    const clave = typeof v.veredicto === 'string' ? v.veredicto : '';
                    const cifras = Array.isArray(v.cifras) ? v.cifras.filter((c): c is string => typeof c === 'string') : [];
                    return (
                      <tr key={i}>
                        <td>
                          <strong style={{ fontSize: 13 }}>{textoO(v.lectura, `lectura ${i + 1}`)}</strong>
                        </td>
                        <td>
                          <Chip tono="borde" title={typeof v.tipo === 'string' && Object.hasOwn(TIPOS_LECTURA, v.tipo) ? TIPOS_LECTURA[v.tipo].definicion : undefined}>
                            {etiquetaContrato(TIPOS_LECTURA, v.tipo) || 'sin tipo'}
                          </Chip>
                        </td>
                        <td>
                          <Chip tono={de(TONO_VEREDICTO, clave) ?? 'borde'}>{de(ETIQUETA_VEREDICTO, clave) ?? (clave.replace(/_/g, ' ') || 'sin veredicto')}</Chip>
                        </td>
                        <td className="meta">{textoO(v.motivo, '')}</td>
                        <td className="meta">{cifras.length > 0 ? cifras.join('; ') : tr('ninguna cifra la nombra')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {negativo && (
            <div className={negativoDestacado ? tr('experimento-bloque criterio-mal') : 'experimento-bloque'} data-lectura-negativo={negativoDestacado ? 'destacada' : 'discreta'}>
              <div className="acciones">
                <strong style={{ fontSize: 13 }}>{tr("Qué dice el negativo")}</strong>
                {rama && (
                  <Chip tono={negativo.rama === 'diana_no_comprometida' ? 'aviso' : negativo.rama === 'diana_comprometida_sin_efecto' ? 'mal' : 'borde'} title={rama.definicion}>
                    {rama.etiqueta}
                  </Chip>
                )}
              </div>
              <p style={{ fontSize: 13 }}>{textoO(negativo.explicacion, tr('Sin explicación en el registro.'))}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Revisor de registro y procedencia de artefactos
// ---------------------------------------------------------------------------

/** Los hallazgos del revisor de registro como tarjetas, igual que Claude
 *  Science los ensena bajo el mensaje revisado. */
export function RevisionDeRegistro({ r, compacto = false, iteracionId }: { r: RevisionRegistro | null | undefined; compacto?: boolean; iteracionId?: string }) {
  if (!r) return null;
  if (r.hallazgos.length === 0) {
    return (
      <div className="acciones">
        <Chip tono="ok">{tr("Revisor de registro: sin discrepancias")}</Chip>
        {!compacto && <span className="meta">{r.resumen}</span>}
      </div>
    );
  }
  return (
    <div className="revision-registro">
      <div className="acciones">
        <Chip tono={r.hallazgos.some((h) => h.gravedad === 'alta') ? 'mal' : 'aviso'}>
          {tr("Revisor de registro:")} {r.hallazgos.length} {r.hallazgos.length === 1 ? 'hallazgo' : 'hallazgos'}
        </Chip>
        <span className="meta">
          {r.porRegla} por regla{r.juez ? `, ${r.hallazgos.length - r.porRegla} del juez` : tr(', sin juez')}
        </span>
      </div>
      {r.vueltas && r.vueltas.length > 0 && (
        <div className="vueltas-reparacion">
          <p className="meta">
            {tr("El revisor devolvió el trabajo a ROSA2018 y ella rehizo el resumen. Un hallazgo rebatido no queda cerrado: sigue reteniendo la publicación hasta que tú lo descartes.")}
          </p>
          <ul className="lista-plana">
            {r.vueltas.map((v) => (
              <li key={v.vuelta} className="meta">
                <Chip tono={v.estado === 'hecha' ? 'ok' : v.estado === 'rechazada' ? 'mal' : 'aviso'}>
                  {v.estado === 'hecha' ? `Vuelta ${v.vuelta}` : v.estado === 'rechazada' ? `Vuelta ${v.vuelta} rechazada` : v.estado === 'sin_comprobar' ? `Vuelta ${v.vuelta} sin comprobar` : `Vuelta ${v.vuelta} no hecha`}
                </Chip>{' '}
                {v.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="lista-plana">
        {r.hallazgos.slice(0, compacto ? 3 : 20).map((h, i) => (
          <li key={h.id ?? i} className={`tarjeta hallazgo-registro gravedad-${h.gravedad}`}>
            <strong style={{ fontSize: 13 }}>{CLASE_HALLAZGO_REGISTRO[h.clase] ?? h.clase}</strong> <Chip tono={h.gravedad === 'alta' ? 'mal' : h.gravedad === 'media' ? 'aviso' : 'borde'}>{h.gravedad}</Chip> <span className="meta">({h.origen})</span>
            {h.estado && h.estado !== 'abierto' && (
              <Chip tono={h.estado === 'atendido' ? 'ok' : h.estado === 'rebatido' ? 'aviso' : 'borde'}>
                {h.estado === 'atendido' ? 'Atendido' : h.estado === 'rebatido' ? tr('ROSA2018 lo rebate') : 'Descartado'}
                {h.resueltoPor ? ` por ${h.resueltoPor}` : ''}
              </Chip>
            )}
            {h.arregloFalso && <Chip tono="mal">{tr("Se dijo arreglado y el texto no cambió")}</Chip>}
            {h.comprobacion === 'no_comprobada' && <Chip tono="aviso">{tr("No pude comprobar el arreglo")}</Chip>}
            {h.nacidoEnVuelta && <Chip tono="borde">{tr("Lo trajo el arreglo")}</Chip>}
            <p className="meta">{h.detalle}</p>
            {h.respuesta && (
              <p className="meta">
                {h.estado === 'rebatido' ? tr('ROSA2018 lo rebate: ') : 'Respuesta: '}
                {h.respuesta}
              </p>
            )}
            {iteracionId && h.id && ((h.estado ?? 'abierto') === 'abierto' || h.estado === 'rebatido') && !compacto && (
              <div className="acciones">
                <Confirmar etiqueta="Atendido" pregunta={tr("¿Qué se hizo con este hallazgo?")} pedirTexto={{ etiqueta: 'Respuesta', marcador: tr('Se corrigió el resumen; la cifra venía de la pista 3') }} onConfirmar={(t) => acciones.resolverHallazgoRegistro(iteracionId, h.id!, 'atendido', t)} />
                <Confirmar etiqueta="Descartar" pregunta={tr("¿Por qué no aplica este hallazgo?")} pedirTexto={{ etiqueta: 'Motivo', marcador: tr('El revisor confundió hipótesis en cola con hipótesis nuevas') }} onConfirmar={(t) => acciones.resolverHallazgoRegistro(iteracionId, h.id!, 'descartado', t)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Las cinco pestanas de procedencia de una version de artefacto. */
export function ProcedenciaDeArtefacto({ p }: { p: ProcedenciaArtefacto | undefined }) {
  const [pestana, setPestana] = useState<'mensajes' | 'codigo' | 'registroEjecucion' | 'entorno' | 'revision'>('mensajes');
  if (!p) return <p className="meta">{tr("Esta versión no tiene procedencia registrada (anterior al 11 de septiembre de 2026).")}</p>;
  const etiquetas: Record<string, string> = { mensajes: 'Mensajes', codigo: 'Código', registroEjecucion: tr('Registro de ejecución'), entorno: 'Entorno', revision: tr('Revisión') };
  const vacio = (k: keyof ProcedenciaArtefacto) => p[k] === null || p[k] === undefined || (Array.isArray(p[k]) && (p[k] as unknown[]).length === 0);
  return (
    <div className="procedencia-artefacto">
      <div className="pestanas">
        {(Object.keys(etiquetas) as (keyof ProcedenciaArtefacto)[]).map((k) => (
          <button key={k} type="button" className={`pestana ${pestana === k ? 'activa' : ''}`} onClick={() => setPestana(k)} disabled={vacio(k)} title={vacio(k) ? tr('No aplica a esta versión') : ''}>
            {etiquetas[k]}
          </button>
        ))}
      </div>
      {pestana === 'revision' ? (
        <RevisionDeRegistro r={p.revision} />
      ) : pestana === 'codigo' ? (
        <pre className="contenido-artefacto">{p.codigo ?? ''}</pre>
      ) : (
        <pre className="contenido-artefacto">{JSON.stringify(p[pestana], null, 1)}</pre>
      )}
      <p className="meta">{tr("El registro de ejecución manda sobre el código: si discrepan, lo que corrió es lo que vale.")}</p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Skills de ROSA2018
// ---------------------------------------------------------------------------

/** Las skills: instrucciones de metodo que el planificador de analisis, el
 *  escritor de codigo y el proponente de areas cargan cuando la tarea las
 *  pide (por palabras de activacion). Mismo formato que las Agent Skills de
 *  Anthropic; viven en rosa/skills/<nombre>/SKILL.md y se editan ahi. */
export function Skills({ skills }: { skills: SkillCatalogo[] | undefined }) {
  const lista = skills ?? [];
  return (
    <Seccion detalle titulo={tr("Skills de método")} nota={tr("Un fichero de instrucciones por método (como correr una reproducción de GEO, como calcular un tamaño muestral, como hacer control de calidad de célula única). ROSA2018 carga las que casan con el plan y las pasa al modelo junto con los módulos que el sandbox puede importar. Se añaden o cambian editando rosa/skills/; el catálogo se lee al arrancar.")}>
      {lista.length === 0 ? (
        <p className="meta">{tr("El catálogo de skills llega del servidor al arrancar.")}</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Skill</th>
              <th>{tr("Qué hace")}</th>
              <th>Se activa con</th>
              <th>{tr("Entorno y módulos")}</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.nombre}>
                <td>
                  <strong style={{ fontSize: 13 }}>{s.nombre}</strong>
                  <p className="meta">
                    {s.ruta}/SKILL.md, {s.lineas} líneas
                  </p>
                </td>
                <td className="meta">{s.descripcion}</td>
                <td className="meta">{s.activaSi.join(', ')}</td>
                <td className="meta">
                  <Chip tono={s.entorno === 'celula_unica' ? 'aviso' : 'borde'}>{s.entorno === 'celula_unica' ? tr('célula única') : 'tabular'}</Chip>
                  {s.paquetes.length > 0 && <p className="meta">Paquetes: {s.paquetes.join(', ')}</p>}
                  {s.scripts.length > 0 && <p className="meta">{tr("Módulos:")} {s.scripts.join(', ')}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Esqueletos de las secciones que piden datos aparte al servidor (estándar de
// Emir, 19 de septiembre de 2026): mientras llega la respuesta se pinta la
// silueta del contenido con sus mismas clases y medidas, para que al llegar no
// salte nada; el contenedor lleva aria-busy y un rótulo oculto para lectores de
// pantalla. Los errores y el "sin servidor" siguen saliendo como antes.
// ---------------------------------------------------------------------------

/** La silueta de un veredicto en una fila de acciones (un chip y una frase de
 *  `lineas` líneas): lo que pintan IntegridadRegistro y EspejoConvex cuando
 *  responden. Medido: el espejo ocupa una línea (22 px); la integridad, con
 *  el motivo de una cadena rota, hasta tres (65 px). */
function EsqueletoVeredicto({ rotulo, lineas = 1 }: { rotulo: string; lineas?: number }) {
  return (
    <Cargando
      activo
      rotulo={rotulo}
      esqueleto={
        <div className="acciones">
          <Esqueleto className="esqueleto-chip" ancho={128} />
          {lineas <= 1 ? (
            <Esqueleto alto={12} ancho={tr("min(100%, 420px)")} />
          ) : (
            <div style={{ flex: tr('1 1 260px'), minWidth: 0 }}>
              <EsqueletoTexto lineas={lineas} />
            </div>
          )}
        </div>
      }
    >
      {null}
    </Cargando>
  );
}

/** Lo que una sección responde cuando el servidor está pero no contestó a
 *  tiempo (o falló): "no pude comprobar", nunca "no hay", con el botón de
 *  volver a intentarlo. */
function SinRespuesta({ que, onReintentar }: { que: string; onReintentar: () => void }) {
  return (
    <div className="acciones">
      <span className="meta">{tr("No pude comprobar")} {que}{tr(": el servidor no respondió a tiempo.")}</span>
      <button type="button" className="btn btn-s" onClick={onReintentar}>
        Volver a comprobar
      </button>
    </div>
  );
}

/** Cuántas líneas ocupa el párrafo "Por iteración" del coste por decisión:
 *  unos 16 caracteres por iteración sobre unos 150 por línea (13 px a 1064
 *  px de ancho), tope de cuatro. */
function lineasPorIteracion(iteraciones: number): number {
  if (iteraciones <= 1) return 0;
  return Math.min(4, Math.max(1, Math.ceil((40 + iteraciones * 16) / 150)));
}

/** La silueta de las cuatro cifras del coste por decisión (rejilla .metricas
 *  con .gasto-item): la cifra grande y tres líneas de explicación, como las
 *  reales (medido: 115 px cada una), y debajo el párrafo "Por iteración"
 *  cuando la investigación tiene más de una. */
function EsqueletoCostes({ iteraciones }: { iteraciones: number }) {
  const lineas = lineasPorIteracion(iteraciones);
  return (
    <Cargando
      activo
      rotulo={tr("el coste por decisión")}
      esqueleto={
        <div>
          <div className="metricas">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="gasto-item">
                <Esqueleto alto={22} ancho={i === 0 ? '52%' : '44%'} />
                <EsqueletoTexto lineas={3} />
              </div>
            ))}
          </div>
          {lineas > 0 && (
            <div style={{ marginTop: 8 }}>
              <EsqueletoTexto lineas={lineas} />
            </div>
          )}
        </div>
      }
    >
      {null}
    </Cargando>
  );
}

// ---------------------------------------------------------------------------
// Espejo del estado en Convex
// ---------------------------------------------------------------------------

export function EspejoConvex({ ahora }: { ahora: number }) {
  const [esp, setEsp] = useState<EstadoEspejo | null | SinRespuestaServidor | undefined>(undefined);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      const e = await acciones.estadoEspejo();
      if (vivo) setEsp(e);
    };
    void cargar();
    const t = setInterval(cargar, 15000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [intento]);
  return (
    <Seccion detalle titulo={tr("Espejo del estado en Convex")} nota={tr("Una copia en la nube de cada entidad pública del estado (hipótesis, hechos, iteraciones, artefactos, decisiones), actualizada pocos segundos después de cada cambio. SQLite en el servidor de ROSA2018 sigue siendo la fuente de verdad y el único que escribe; el espejo sirve para leer desde cualquier sitio y para que varias personas vean lo mismo. La clave vive solo en el .env del servidor.")}>
      {esp === undefined ? (
        <EsqueletoVeredicto rotulo={tr("el espejo de Convex")} />
      ) : esp === 'sin_respuesta' ? (
        <SinRespuesta
          que={tr("el espejo de Convex")}
          onReintentar={() => {
            setEsp(undefined);
            setIntento((i) => i + 1);
          }}
        />
      ) : esp === null ? (
        <p className="meta">{tr("Sin servidor: el espejo solo existe con el servidor de ROSA2018 encendido.")}</p>
      ) : !esp.activo ? (
        <p className="meta">{tr("Apagado: no hay clave de Convex en el .env del servidor.")}</p>
      ) : (
        <div className="acciones">
          <Chip tono={esp.error ? 'mal' : esp.pendiente ? 'aviso' : 'ok'}>{esp.error ? tr('Con error') : esp.pendiente ? 'Sincronizando' : tr('Al día')}</Chip>
          <span className="meta">
            {esp.url} · {esp.entidades} entidades · versión {esp.ultimaVersion ?? '?'}
            {esp.sincronizadoEn ? (
              <>
                {' '}
                · <Momento t={esp.sincronizadoEn} ahora={ahora} />
              </>
            ) : null}{' '}
            · {esp.envios} {tr("envios · ultimo en")} {esp.ms} ms
          </span>
          {esp.error && <p className="tono-mal">{esp.error}</p>}
        </div>
      )}
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Integridad del registro: la cadena de hashes de las acciones

export function IntegridadRegistro() {
  const [estado, setEstado] = useState<{ ok: boolean; filas: number; encadenadas: number; sinHash: number; rotaEn: number | null; motivo?: string } | null | SinRespuestaServidor | 'cargando'>('cargando');
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    void acciones.integridadRegistro().then((r) => {
      if (vivo) setEstado(r);
    });
    return () => {
      vivo = false;
    };
  }, [intento]);
  return (
    <Seccion detalle titulo={tr("Integridad del registro")} nota={tr("Cada acción que cambia el estado queda en un registro solo de añadir, y cada fila lleva el hash de la anterior (una cadena). Si alguien borra o altera una fila, la cadena se rompe desde ahí y aquí se ve. Es la parte de ALCOA+ (atribuible, contemporáneo, original, perdurable) que se puede dar sin firma electrónica; la firma por persona queda para un destino regulado.")}>
      {estado === 'cargando' ? (
        <EsqueletoVeredicto rotulo={tr("la integridad del registro")} lineas={2} />
      ) : estado === 'sin_respuesta' ? (
        <SinRespuesta que={tr("la integridad del registro")} onReintentar={() => setIntento((i) => i + 1)} />
      ) : estado === null ? (
        <p className="meta">{tr("Sin servidor no hay registro que comprobar.")}</p>
      ) : (
        <div className="acciones">
          <Chip tono={estado.ok ? 'ok' : 'mal'}>{estado.ok ? tr('Cadena intacta') : `Cadena rota en la fila ${estado.rotaEn}`}</Chip>
          <span className="meta">
            {estado.filas} acciones registradas, {estado.encadenadas} encadenadas{estado.sinHash > 0 ? `, ${estado.sinHash} anteriores al encadenado (sin hash)` : ''}
            {estado.motivo ? `. ${estado.motivo}` : ''}
          </span>
        </div>
      )}
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Conocimiento operativo del laboratorio (clase de evidencia propia)

const TIPO_OPERATIVO: Record<ConocimientoOperativo['tipo'], string> = traducido({ protocolo: 'Protocolo', reactivo: 'Reactivo o lote', medicion: 'Medición o artefacto', muestra: 'Muestras', otro: 'Otro' });

export function ConocimientoOperativoDelLaboratorio({ inv }: { inv: Investigacion }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<ConocimientoOperativo['tipo']>('protocolo');
  const lista = inv.conocimientoOperativo ?? [];
  return (
    <Seccion titulo={tr("Conocimiento operativo del laboratorio")} nota={tr("Lo que el laboratorio sabe y nunca se publica: qué protocolo no es fiable, qué lote de anticuerpo da fondo, qué medición tiene un artefacto conocido. Entra como evidencia de clase 'conocimiento operativo', con su estatus: ROSA2018 lo lee al proponer experimentos y lo cita en el dossier, pero no lo mezcla con la literatura ni lo cuenta como observación.")}>
      {lista.length === 0 && <p className="meta">{tr("Nada registrado todavía.")}</p>}
      <ul className="lista-plana">
        {lista.map((x) => (
          <li key={x.id}>
            <Chip tono="borde">{TIPO_OPERATIVO[x.tipo]}</Chip> {x.texto} <span className="meta">({x.quien}, {new Date(x.fecha).toLocaleDateString('es')})</span>{' '}
            <button type="button" className="btn btn-fantasma btn-s" onClick={() => acciones.quitarConocimientoOperativo(inv.id, x.id)} aria-label="Quitar">
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="dirigir">
        <select className="entrada entrada-s" style={{ width: 'auto' }} value={tipo} onChange={(e) => setTipo(e.target.value as ConocimientoOperativo['tipo'])} aria-label={tr("Tipo de conocimiento operativo")}>
          {(Object.keys(TIPO_OPERATIVO) as ConocimientoOperativo['tipo'][]).map((t) => (
            <option key={t} value={t}>
              {TIPO_OPERATIVO[t]}
            </option>
          ))}
        </select>
        <input className="entrada" value={texto} placeholder={tr("El lote 2024-B del anticuerpo anti-GFAP da fondo alto en plasma")} onChange={(e) => setTexto(e.target.value)} aria-label="Conocimiento operativo" />
        <button type="button" className="btn" disabled={texto.trim().length < 8} onClick={() => { acciones.anadirConocimientoOperativo(inv.id, texto.trim(), tipo); setTexto(''); }}>
          Registrar
        </button>
      </div>
    </Seccion>
  );
}


// ---------------------------------------------------------------------------
// Nivel de autonomia declarado (escala de Beal y Rogers 2020)

export function NivelDeAutonomia({ politicas }: { politicas: EstadoRosa['politicas'] }) {
  const niveles = (politicas?.nivelesAutonomia as { nivel: number; nombre: string; definicion: string }[] | undefined) ?? [];
  const declarado = typeof politicas?.nivelAutonomiaDeclarado === 'number' ? politicas.nivelAutonomiaDeclarado : 2;
  return (
    <Seccion detalle titulo={tr("Nivel de autonomía declarado")} nota={tr("Con la escala que usa el resto del sector (Beal y Rogers 2020; la revisión de laboratorios autónomos de 2025 dice que la mayoría está en el nivel 3 y ninguno en producción pasa del 4). ROSA2018 opera en el nivel 2 y lo declara en cada dossier: propone hipótesis, planes y protocolos y corre análisis in silico; toda decisión que toca el mundo real la toma una persona. El dial de autonomía de arriba no sube este nivel: ajusta cuánto pregunta dentro de él.")}>
      {niveles.length === 0 ? (
        <p className="meta">{tr("Sin servidor no hay políticas que leer.")}</p>
      ) : (
        <table className="tabla">
          <tbody>
            {niveles.map((n) => (
              <tr key={n.nivel} style={n.nivel === declarado ? { fontWeight: 600 } : undefined}>
                <td className="num">{n.nivel}</td>
                <td>
                  {n.nombre} {n.nivel === declarado && <Chip tono="acento">ROSA2018</Chip>}
                </td>
                <td className="meta">{n.definicion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Entidades canonicas

export function Entidades({ entidades, maximo = 8 }: { entidades: EntidadCanonica[] | undefined; maximo?: number }) {
  if (!entidades || entidades.length === 0) return null;
  return (
    <span className="acciones" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {entidades.slice(0, maximo).map((x) => (
        <Chip key={x.id} tono="borde" title={`${x.ontologia} ${x.id}${x.alias.length ? ` · alias: ${x.alias.slice(0, 6).join(', ')}` : ''}${x.uniprot ? ` · UniProt ${x.uniprot}` : ''}`}>
          {x.etiqueta} <span className="meta">{x.id}</span>
        </Chip>
      ))}
    </span>
  );
}


// ---------------------------------------------------------------------------
// Coste por decision, no por llamada

export interface CostesInvestigacion {
  corridas: number;
  llamadas: number;
  usdModelo: number;
  usdExa?: number;
  horasRevision: number;
  tarifaHoraRevisionUsd: number;
  usdRevision: number;
  usdTotal: number;
  hipotesis: number;
  hipotesisConDossier: number;
  candidatas: number;
  decisionesHumanas: number;
  usdPorDossier: number | null;
  usdPorCandidata: number | null;
  usdPorDecisionHumana: number | null;
  segundosMediosPorDecision: number | null;
  porIteracion: { corrida: number; iteracion: number; llamadas: number; usd: number }[];
  tendenciaUsdPorIteracion: number | null;
  nota: string;
}

/** Suma de lo facturado por el AI Gateway en las corridas de la investigación
 *  (`gasto.usdReal`, escrito por el servidor por llamada), con cuántas corridas
 *  lo traen. Null si ninguna lo trae: entonces solo hay estimación por tokens. */
export function facturadoPorGateway(corridas: Pick<Corrida, 'investigacionId' | 'gasto'>[], investigacionId: string): { usd: number; conFactura: number; total: number; estimado: number; mixto: boolean } | null {
  const propias = (Array.isArray(corridas) ? corridas : []).filter((c) => c && c.investigacionId === investigacionId);
  const conFactura = propias.filter((c) => c.gasto && typeof c.gasto.usdReal === 'number' && Number.isFinite(c.gasto.usdReal));
  if (conFactura.length === 0) return null;
  const usd = conFactura.reduce((acc, c) => acc + (c.gasto.usdReal as number), 0);
  const estimado = propias.reduce((acc, c) => acc + (typeof c.gasto?.usd === 'number' && Number.isFinite(c.gasto.usd) ? c.gasto.usd : 0), 0);
  return { usd, conFactura: conFactura.length, total: propias.length, estimado, mixto: conFactura.some((c) => c.gasto.usdEsEstimado === true) };
}

export function CostesPorDecision({ investigacionId }: { investigacionId: string }) {
  const [c, setC] = useState<CostesInvestigacion | null | SinRespuestaServidor | 'cargando'>('cargando');
  const [intento, setIntento] = useState(0);
  const estado = useRosa();
  const factura = facturadoPorGateway(estado.corridas, investigacionId);
  // Cuántas iteraciones tiene la investigación lo sabe el estado: decide si
  // la silueta lleva el párrafo "Por iteración".
  const iteraciones = estado.corridas.filter((x) => x.investigacionId === investigacionId).reduce((suma, x) => suma + Math.max(0, x.iteracionActual), 0);
  useEffect(() => {
    let vivo = true;
    setC('cargando');
    void acciones.costesDe(investigacionId).then((r) => {
      if (vivo) setC(r);
    });
    return () => {
      vivo = false;
    };
  }, [investigacionId, intento]);
  const usd = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${coma(v.toFixed(2))} $`);
  return (
    <Seccion detalle titulo={tr("Coste por decisión")} nota={tr("Lo que decide presupuestos no es el coste de una llamada sino cuánto cuesta una hipótesis que llega al dossier, una candidata al laboratorio o una decisión que tomó una persona. El tiempo de revisión humana entra en el coste a la tarifa declarada en políticas: sin eso la comparación con investigar sin ROSA2018 no es honesta. Las cifras de modelo son estimaciones por tokens; lo facturado por el gateway, cuando el servidor lo guardó, va al lado.")}>
      {factura && (
        <p className="meta" title={`Suma de gasto.usdReal de las corridas de esta investigación (${factura.conFactura} de ${factura.total} corridas traen la factura del gateway).${factura.mixto ? tr(' En alguna corrida una llamada llegó sin coste del gateway y se estimó por tokens.') : ''}`}>
          {tr("Facturado por el gateway:")} <strong>{usd(factura.usd)}</strong> en {factura.conFactura} de {factura.total} {tr("corridas · estimado por tokens en esas mismas corridas:")} {usd(factura.estimado)}.
        </p>
      )}
      {c === 'cargando' ? (
        <EsqueletoCostes iteraciones={iteraciones} />
      ) : c === 'sin_respuesta' ? (
        <SinRespuesta que={tr("el coste por decisión")} onReintentar={() => setIntento((i) => i + 1)} />
      ) : c === null ? (
        <p className="meta">{tr("Sin servidor no hay costes que agregar.")}</p>
      ) : (
        <>
          <div className="metricas">
            <div className="gasto-item">
              <strong>{usd(c.usdTotal)}</strong>
              <span>total (estimado): {usd(c.usdModelo)} {tr("de modelo por tokens")}{(c.usdExa ?? 0) > 0 ? ` + ${usd(c.usdExa ?? 0)} en Exa` : ''} + {coma(c.horasRevision.toFixed(2))} {tr("h de revisión a")} {c.tarifaHoraRevisionUsd} $/h</span>
            </div>
            <div className="gasto-item">
              <strong>{usd(c.usdPorDossier)}</strong>
              <span>{tr("por hipótesis con dossier (")}{c.hipotesisConDossier} de {c.hipotesis})</span>
            </div>
            <div className="gasto-item">
              <strong>{usd(c.usdPorCandidata)}</strong>
              <span>{tr("por candidata al laboratorio (")}{c.candidatas})</span>
            </div>
            <div className="gasto-item">
              <strong>{usd(c.usdPorDecisionHumana)}</strong>
              <span>{tr("por decisión humana (")}{c.decisionesHumanas}; {c.segundosMediosPorDecision === null ? tr('sin tiempos') : `${Math.round(c.segundosMediosPorDecision)} s de media`})</span>
            </div>
          </div>
          {c.porIteracion.length > 0 && (
            <p className="meta">
              {tr("Por iteración (estimado por tokens):")} {c.porIteracion.map((x) => `c${x.corrida} it${x.iteracion} ${x.usd.toFixed(2)} $`).join(' · ')}
              {c.tendenciaUsdPorIteracion !== null && ` · tendencia ${c.tendenciaUsdPorIteracion >= 0 ? '+' : ''}${c.tendenciaUsdPorIteracion.toFixed(2)} $ por iteración entre las primeras y las últimas`}
            </p>
          )}
        </>
      )}
    </Seccion>
  );
}
