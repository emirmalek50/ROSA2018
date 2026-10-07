// La coreografía mueve documentos guardados; no crea decisiones ni diálogos.
import type { AfirmacionLab, DatosLab } from '../../lib/labVivo';
import type { AnalisisVisualLab, AsignacionVisualLab, DecisionVisualLab, EventoVisualLab, RevisionVisualLab } from '../../lib/peliculaLab';
import { tr } from '../../lib/idioma';
import { RESULTADO_COMPROBACION } from '../../lib/etiquetas';

export const ENTREGA_TRIBUNAL: Record<string, string> = {
  'Revisor inicial': 'Killer', Killer: 'Evaluador de supuestos',
  'Evaluador de supuestos': 'Juez de viabilidad', 'Juez de viabilidad': 'Concluidor',
  Concluidor: 'Evaluador de resultado', 'Evaluador de resultado': 'Tarjeta y Nombre corto',
  'Tarjeta y Nombre corto': 'Resumen en llano',
};

/** Un receptor lee la misma tarjeta. No se le atribuye una evaluación nueva. */
export function participantesDeEntrega(e: EventoVisualLab, datos: DatosLab): string[] {
  const nombres = [...e.agentes];
  const primero = nombres[0];
  if (e.tipo === 'plan' && nombres.includes('Planificador')) {
    nombres.unshift('Misión, Áreas y Pregunta');
    if (datos.pasos.lista.length) nombres.push('Reformulador', 'Derivador por contexto');
  }
  if (e.tipo === 'fuente' && ['Generador de consultas', 'Explorador'].includes(primero ?? '')) {
    const f = datos.fuentes.find(f => e.id === `fuente:${datos.identidad.split('/')[1]}:${f.nombre}`);
    if (f && f.salen !== null && f.salen > 0) nombres.push(primero === 'Explorador' ? 'Puntuador amplitud' : 'Puntuador preguntas');
  }
  if (e.dato?.tipo === 'articulo' && e.dato.estado === 'incluido') nombres.push('Extractor de afirmaciones');
  if (e.dato?.tipo === 'asignacion_hecho' || (e.tipo === 'evidencia' && nombres.includes('Asignador de evidencia'))
    || (e.dato?.tipo === 'decision_hipotesis' && e.dato.etapa === 'asignacion' && nombres.includes('Asignador de evidencia'))) nombres.push('Actualizador del modelo de mundo');
  if (e.tipo === 'analisis') {
    if (nombres.includes('Planificador de análisis')) nombres.push('Programador y Reparador');
    if (e.dato?.tipo === 'analisis' && e.dato.estado === 'interpretando') nombres.unshift('Programador y Reparador');
    if (e.dato?.tipo === 'analisis' && e.dato.estado === 'auditando') nombres.unshift('Intérprete');
  }
  if (e.tipo === 'revision' && primero && ENTREGA_TRIBUNAL[primero]) nombres.push(ENTREGA_TRIBUNAL[primero]!);
  if (e.dato?.tipo === 'decision_hipotesis' && e.dato.etapa === 'conclusion' && primero === 'Concluidor') {
    nombres.push('Evaluador de resultado', 'Tarjeta y Nombre corto', 'Resumen en llano');
  }
  if (e.dato?.tipo === 'revision_registro') {
    if (e.dato.etapa === 'reparacion') nombres.unshift('Revisor del registro');
    if (e.dato.etapa === 'comprobacion_reparacion') nombres.unshift('Rehacedor');
  }
  if (e.tipo === 'cierre' && nombres.includes('Resumidor')) nombres.push('Tú');
  return [...new Set(nombres)];
}

/** La ausencia de procedencia en un histórico no equivale a autoría del juez. */
export function pasaPorJuez(a: AfirmacionLab): boolean {
  return a.veredicto !== 'sin_verificar' && (a.procedenciaVeredicto?.origen === 'juez' || a.procedenciaVeredicto?.origen === 'mixta');
}

type Material = DecisionVisualLab | AsignacionVisualLab | AnalisisVisualLab | RevisionVisualLab;
export function materialDelEvento(e: EventoVisualLab, datos: DatosLab): Material | null {
  const etapas = datos.pelicula?.etapas;
  if (!etapas) return null;
  const listas: Material[] = [...etapas.tribunal, ...etapas.hechos, ...etapas.analisis, ...etapas.revision];
  return listas.find(m => m.id === e.id && `${m.contexto.corridaId}/${m.contexto.iteracionId}` === datos.identidad
    && JSON.stringify(m.dato) === JSON.stringify(e.dato)) ?? null;
}

/** Líneas literales del resultado. Las mediciones no se vuelven certezas. */
export function lineasResultado(e: AnalisisVisualLab): string[] {
  const r = e.material.ejecucion;
  if (!r) return [];
  const lineas: string[] = [];
  if (['terminado', 'interpretando', 'auditando'].includes(e.dato.estado)) {
    for (const [k, v] of Object.entries(r.resultados)) lineas.push(`${k}: ${v}`);
    for (const [k, v] of Object.entries(r.baseline)) lineas.push(`${tr('Baseline')} · ${k}: ${v}`);
    for (const [k, v] of Object.entries(r.controlNegativo)) lineas.push(`${tr('Control negativo')} · ${k}: ${v}`);
  }
  if (['interpretando', 'auditando'].includes(e.dato.estado) && r.interpretacion) lineas.push(`${tr('Interpretación')}: ${r.interpretacion.resumen}`);
  if (e.dato.estado === 'auditando' && r.auditoria) {
    lineas.push(`${tr('Auditoría')}: ${r.auditoria.motivo}`);
    for (const c of r.auditoria.comprobaciones) lineas.push(`${c.comprobacion}: ${RESULTADO_COMPROBACION[c.resultado]?.etiqueta ?? c.resultado} · ${c.detalle}`);
  }
  return lineas;
}

export interface SerieResultado { metrica: string; puntos: { semilla: number; valor: number }[] }
/** Una serie usa la misma métrica entre repeticiones; no mezcla unidades.
 *  Valores censurados, intervalos y números con unidades siguen en la tabla. */
export function seriesResultados(e: AnalisisVisualLab): SerieResultado[] {
  const r = e.material.ejecucion;
  if (!r || !['terminado', 'interpretando', 'auditando'].includes(e.dato.estado)) return [];
  const series = new Map<string, SerieResultado['puntos']>();
  for (const rep of r.repeticiones ?? []) for (const [k, v] of Object.entries(rep.resultados)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())) continue;
    const valor = Number(v);
    if (!Number.isFinite(valor) || !Number.isFinite(rep.semilla)) continue;
    const p = series.get(k) ?? []; p.push({ semilla: rep.semilla, valor }); series.set(k, p);
  }
  return [...series].filter(([, puntos]) => puntos.length >= 2).map(([metrica, puntos]) => ({ metrica, puntos }));
}
