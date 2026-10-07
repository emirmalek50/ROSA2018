// El motor representa acontecimientos guardados. Este módulo no genera
// hipótesis, pares, resultados, participantes ni fechas para llenar una escena.
import type { ConclusionHipotesis, Decision, Ejecucion, EstadoRosa, EventoAsignacionHechoLab, EventoDecisionHipotesisLab, EventoLab, EventoRevisionRegistroLab, HechoMundo, Iteracion, ProcedenciaVeredictoLab, RevisionRegistro } from '../datos/tipos';
import type { ActividadLab, AfirmacionLab, DatosLab, SalaLab } from './labVivo';
import type { Evidencia } from './evidencia';
import { ESTADO_PASO, VEREDICTO, veredictoDe } from './etiquetas';
import { tr } from './idioma';

export interface EventoVisualLab {
  id: string;
  sala: SalaLab;
  agentes: string[];
  tipo: 'plan' | 'fuente' | 'lectura' | 'extraccion' | 'filtro' | 'evidencia' | 'idea' | 'revision' | 'torneo' | 'analisis' | 'cierre';
  dato?: EventoLab;
  texto: string;
  /** Identidad del registro, independiente de las palabras o de quién lo muestra. */
  contexto?: ContextoVisualLab;
}
export interface IdeaVisualLab { hipotesisId: string; titulo: string; enfoque: string }
export interface ContextoVisualLab {
  corridaId: string;
  iteracionId: string;
  pistaId: string | null;
  fecha: number | null;
}
export interface DecisionVisualLab extends EventoVisualLab {
  dato: EventoDecisionHipotesisLab;
  contexto: ContextoVisualLab;
  material: {
    hipotesis: { id: string; titulo: string; version: number | null } | null;
    /** Registros de esta versión y origen. No se asocian a una etapa por su texto. */
    registros: Decision[];
    conclusion: ConclusionHipotesis | null;
  };
}
export interface AsignacionVisualLab extends EventoVisualLab {
  dato: EventoAsignacionHechoLab;
  contexto: ContextoVisualLab;
  material: {
    hecho: Pick<HechoMundo, 'id' | 'enunciado' | 'estado' | 'origen' | 'afirmacionIds'> | null;
    afirmaciones: AfirmacionLab[];
    afirmacionIdsNoCargadas: string[];
  };
}
export type ResultadoEjecucionLab = Pick<Ejecucion, 'id' | 'hipotesisId' | 'planId' | 'estado' | 'inicio' | 'fin' | 'runtime' | 'resultados' | 'baseline' | 'controlNegativo' | 'repeticiones' | 'interpretacion' | 'auditoria' | 'plausibilidadVerificada'> & {
  sintetico: boolean | null;
};
export interface AnalisisVisualLab extends EventoVisualLab {
  dato: Extract<EventoLab, { tipo: 'analisis' }>;
  contexto: ContextoVisualLab;
  material: { ejecucion: ResultadoEjecucionLab | null };
}
export interface RevisionVisualLab extends EventoVisualLab {
  dato: EventoRevisionRegistroLab;
  contexto: ContextoVisualLab;
  /** Estado actual del dossier de esta iteración, separado del evento histórico. */
  material: { registroActual: RevisionRegistro | null };
}
export interface EtapasPeliculaLab {
  tribunal: DecisionVisualLab[];
  hechos: AsignacionVisualLab[];
  analisis: AnalisisVisualLab[];
  revision: RevisionVisualLab[];
  /** El dossier puede existir en un histórico sin metadatos de su coreografía. */
  registroRevisionActual?: RevisionRegistro | null;
}
export interface PeliculaLab { eventos: EventoVisualLab[]; ideas: IdeaVisualLab[]; etapas?: EtapasPeliculaLab }

const ENFOQUES: Record<string, string> = {
  analogia: 'Analogía', contradiccion: 'Contradicción', mecanismo_opuesto: 'Mecanismo opuesto', otra_escala: 'Otra escala',
};
const idValido = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 512 && !/[\n\r\0]/.test(x);
const textoValido = (x: unknown): x is string => typeof x === 'string';
const textos = (v: unknown, maximo: number, validar: (x: unknown) => boolean = textoValido): v is string[] => Array.isArray(v) && v.length <= maximo && v.every(validar);
const pertenece = (v: unknown, valores: string[]): boolean => typeof v === 'string' && valores.includes(v);
const ORIGENES = ['juez', 'regla', 'mixta', 'sin_verificar'];
const CAMPOS_EVENTO: Record<string, string[]> = {
  articulo: ['tipo', 'id', 'titulo', 'estado', 'motivo', 'modo'],
  idea: ['tipo', 'hipotesisId', 'titulo', 'enfoque'],
  torneo: ['tipo', 'hipotesisAId', 'hipotesisBId', 'tituloA', 'tituloB', 'estado', 'porRegla'],
  analisis: ['tipo', 'ejecucionId', 'estado', 'sintetico'],
  decision_hipotesis: ['tipo', 'hipotesisId', 'version', 'etapa', 'estado', 'decision', 'comprobaciones', 'hechoIds', 'modelo', 'origen'],
  revision_registro: ['tipo', 'iteracionId', 'etapa', 'estado', 'vuelta', 'totalHallazgos', 'hallazgos', 'comprobaciones', 'modelo', 'origen'],
  asignacion_hecho: ['tipo', 'hechoId', 'afirmacionIds', 'estado', 'enunciado'],
};
function camposExactos(v: Record<string, unknown>, campos: string[]): boolean {
  return Object.keys(v).length === campos.length && campos.every(c => Object.prototype.hasOwnProperty.call(v, c));
}
export function procedenciaVeredictoValida(v: unknown): v is ProcedenciaVeredictoLab {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return pertenece(p.origen, ORIGENES) && (p.modelo === null || (typeof p.modelo === 'string' && p.modelo.length <= 160)) && textos(p.comprobaciones, 16);
}

/** La respuesta HTTP también puede contener un histórico parcial o malformado.
 *  Un payload inválido conserva su texto, pero nunca crea una tarjeta asociada. */
export function eventoLabValido(valor: unknown): valor is EventoLab {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
  const campos = typeof v.tipo === 'string' ? CAMPOS_EVENTO[v.tipo] : undefined;
  if (!campos || !camposExactos(v, campos)) return false;
  switch (v.tipo) {
    case 'articulo': return idValido(v.id) && textoValido(v.titulo) && textoValido(v.motivo)
      && typeof v.estado === 'string' && ['incluido', 'excluido', 'no_comprobado'].includes(v.estado)
      && typeof v.modo === 'string' && ['foco', 'amplitud'].includes(v.modo);
    case 'idea': return idValido(v.hipotesisId) && textoValido(v.titulo) && idValido(v.enfoque);
    case 'torneo': return idValido(v.hipotesisAId) && idValido(v.hipotesisBId) && v.hipotesisAId !== v.hipotesisBId
      && textoValido(v.tituloA) && textoValido(v.tituloB) && typeof v.porRegla === 'boolean'
      && typeof v.estado === 'string' && ['comparando', 'a', 'b', 'tablas', 'no_comprobado'].includes(v.estado);
    case 'analisis': return idValido(v.ejecucionId) && typeof v.sintetico === 'boolean'
      && typeof v.estado === 'string' && ['programando', 'ejecutando', 'terminado', 'fallido', 'interpretando', 'auditando'].includes(v.estado);
    case 'decision_hipotesis': return idValido(v.hipotesisId) && Number.isSafeInteger(v.version) && (v.version as number) >= 1
      && pertenece(v.etapa, ['revision_inicial', 'supuestos', 'killer', 'viabilidad', 'conclusion', 'asignacion'])
      && pertenece(v.estado, ['en_curso', 'terminado', 'no_comprobado']) && textoValido(v.decision)
      && textos(v.hechoIds, 32, idValido) && procedenciaVeredictoValida(v);
    case 'revision_registro': return idValido(v.iteracionId) && Number.isSafeInteger(v.vuelta) && (v.vuelta as number) >= 0
      && Number.isSafeInteger(v.totalHallazgos) && (v.totalHallazgos as number) >= 0
      && pertenece(v.etapa, ['revision', 'reparacion', 'comprobacion_reparacion', 'resumen'])
      && pertenece(v.estado, ['en_curso', 'terminado', 'no_comprobado']) && procedenciaVeredictoValida(v)
      && Array.isArray(v.hallazgos) && v.hallazgos.length <= 24 && v.hallazgos.length <= (v.totalHallazgos as number) && v.hallazgos.every(h => h && typeof h === 'object' && !Array.isArray(h)
        && camposExactos(h, ['id', 'clase', 'gravedad', 'estado', 'origen', 'detalle'])
        && idValido(h.id) && ['clase', 'gravedad', 'estado', 'origen', 'detalle'].every(k => textoValido(h[k])));
    case 'asignacion_hecho': return idValido(v.hechoId) && textos(v.afirmacionIds, 32, idValido)
      && pertenece(v.estado, ['nuevo', 'fundido']) && textoValido(v.enunciado);
    default: return false;
  }
}

/** Copia del material público. El código, las salidas del proceso y sus errores
 * internos no pertenecen a un documento de la película. Tampoco se deduce la
 * validez del análisis del hecho de que el proceso haya acabado. */
function resultadoPublico(e: Ejecucion, sintetico: boolean): ResultadoEjecucionLab {
  return structuredClone({ id: e.id, hipotesisId: e.hipotesisId, planId: e.planId,
    estado: e.estado, inicio: e.inicio, fin: e.fin, runtime: e.runtime,
    resultados: e.resultados, baseline: e.baseline, controlNegativo: e.controlNegativo,
    repeticiones: e.repeticiones, interpretacion: e.interpretacion,
    auditoria: e.auditoria, plausibilidadVerificada: e.plausibilidadVerificada,
    sintetico });
}

/** Las relaciones dependen de IDs y de la atribución guardada. El dato de cada
 * acontecimiento sigue siendo histórico; el material es una foto pública del
 * estado recibido, no una reconstrucción de lo que se sabía entonces. */
function etapasDe(eventos: EventoVisualLab[], datos: DatosLab, it: Iteracion, estado?: EstadoRosa): EtapasPeliculaLab {
  const etapas: EtapasPeliculaLab = { tribunal: [], hechos: [], analisis: [], revision: [],
    registroRevisionActual: it.revisionRegistro ? structuredClone(it.revisionRegistro) : null };
  const invId = estado?.corridas.find(c => c.id === it.corridaId)?.investigacionId;
  const hipotesis = new Map(estado?.hipotesis.filter(h => invId && h.investigacionId === invId).map(h => [h.id, h]) ?? []);
  const hechos = new Map(estado?.hechos.filter(h => invId && h.investigacionId === invId).map(h => [h.id, h]) ?? []);
  const ejecuciones = new Map(estado?.ejecuciones?.filter(e => invId && e.investigacionId === invId
    && e.corridaId === it.corridaId && e.iteracionId === it.id).map(e => [e.id, e]) ?? []);
  const afirmaciones = new Map((datos.afirmaciones ?? []).map(a => [a.id, a]));
  const decisiones = estado?.decisiones?.filter(d => invId && d.investigacionId === invId
    && d.corridaId === it.corridaId && d.iteracionId === it.id) ?? [];
  for (const e of eventos) {
    const d = e.dato, contexto = e.contexto;
    if (!d || !contexto || contexto.corridaId !== it.corridaId || contexto.iteracionId !== it.id) continue;
    if (d.tipo === 'decision_hipotesis') {
      const h = hipotesis.get(d.hipotesisId);
      const version = h?.version === d.version ? { id: h.id, titulo: h.titulo, version: h.version } : null;
      const c = h?.conclusion;
      const conclusion = c?.corridaId === it.corridaId && c.iteracionId === it.id && c.version === d.version ? c : null;
      etapas.tribunal.push({ ...e, dato: d, contexto, material: structuredClone({ hipotesis: version,
        registros: decisiones.filter(r => r.hipotesisId === d.hipotesisId && r.version === d.version), conclusion }) });
    } else if (d.tipo === 'asignacion_hecho') {
      const h = hechos.get(d.hechoId);
      const hecho = h ? { id: h.id, enunciado: h.enunciado, estado: h.estado, origen: h.origen,
        ...(h.afirmacionIds ? { afirmacionIds: h.afirmacionIds } : {}) } : null;
      etapas.hechos.push({ ...e, dato: d, contexto, material: structuredClone({ hecho,
        afirmaciones: d.afirmacionIds.flatMap(id => afirmaciones.has(id) ? [afirmaciones.get(id)!] : []),
        afirmacionIdsNoCargadas: d.afirmacionIds.filter(id => !afirmaciones.has(id)) }) });
    } else if (d.tipo === 'analisis') {
      const ejecucion = ejecuciones.get(d.ejecucionId);
      // La marca sintética es un hecho guardado, no una deducción del runtime.
      // Un conflicto entre el registro y el evento no autoriza elegir uno.
      const consistente = ejecucion && (typeof ejecucion.sintetico !== 'boolean' || ejecucion.sintetico === d.sintetico);
      etapas.analisis.push({ ...e, dato: d, contexto, material: { ejecucion: consistente ? resultadoPublico(ejecucion, d.sintetico) : null } });
    } else if (d.tipo === 'revision_registro' && d.iteracionId === it.id) {
      etapas.revision.push({ ...e, dato: d, contexto,
        material: { registroActual: etapas.registroRevisionActual ? structuredClone(etapas.registroRevisionActual) : null } });
    }
  }
  return etapas;
}

function registrado(a: ActividadLab, it: Iteracion): EventoVisualLab {
  const recibido = eventoLabValido(a.eventoLab) ? a.eventoLab : undefined;
  const ajeno = recibido?.tipo === 'revision_registro' && recibido.iteracionId !== it.id
    || recibido?.tipo === 'decision_hipotesis' && !!a.hipotesisId && a.hipotesisId !== recibido.hipotesisId;
  const dato = ajeno ? undefined : recibido;
  let sala = a.sala, agentes = [a.agente];
  let tipo: EventoVisualLab['tipo'];
  if (dato?.tipo === 'articulo') {
    sala = 'r1'; tipo = 'filtro'; agentes = [dato.modo === 'amplitud' ? 'Puntuador amplitud' : 'Puntuador preguntas'];
  } else if (dato?.tipo === 'idea') {
    sala = 'r3'; tipo = 'idea'; agentes = ENFOQUES[dato.enfoque] ? [ENFOQUES[dato.enfoque]!] : [];
  } else if (dato?.tipo === 'torneo') {
    sala = 'r4'; tipo = 'torneo'; agentes = dato.porRegla ? [] : ['Juez del torneo', 'Juez del torneo B'];
  } else if (dato?.tipo === 'analisis') {
    sala = 'r5'; tipo = 'analisis'; agentes = [dato.estado === 'auditando' ? 'Auditor del análisis' : dato.estado === 'interpretando' ? 'Intérprete' : 'Programador y Reparador'];
  } else if (dato?.tipo === 'decision_hipotesis') {
    const autor = { revision_inicial: 'Revisor inicial', supuestos: 'Evaluador de supuestos', killer: 'Killer', viabilidad: 'Juez de viabilidad', conclusion: 'Concluidor', asignacion: 'Asignador de evidencia' }[dato.etapa];
    sala = dato.etapa === 'asignacion' ? 'r2' : 'r4'; tipo = 'revision'; agentes = dato.origen === 'regla' ? [] : [autor];
  } else if (dato?.tipo === 'asignacion_hecho') {
    sala = 'r2'; tipo = 'evidencia'; agentes = ['Asignador de evidencia', 'Actualizador del modelo de mundo'];
  } else if (dato?.tipo === 'revision_registro') {
    const autores = { revision: 'Revisor del registro', reparacion: 'Rehacedor', comprobacion_reparacion: 'Revisor de la reparación', resumen: 'Resumidor' };
    sala = 'r6'; tipo = 'cierre'; agentes = dato.origen === 'regla' ? [] : [autores[dato.etapa]];
  } else if (a.agente === 'Puntuador preguntas' || a.agente === 'Puntuador amplitud') tipo = 'filtro';
  else if (a.tipoPista === 'extraccion' || a.agente === 'Extractor de afirmaciones') tipo = 'extraccion';
  else if (a.agente === 'Juez del torneo' || a.agente === 'Juez del torneo B') tipo = 'torneo';
  else if (a.sala === 'r5') tipo = 'analisis';
  else if (a.sala === 'r6') tipo = 'cierre';
  else if (a.sala === 'r3') tipo = 'idea';
  else if (a.sala === 'r4' || a.sala === 'r7' || a.tipoPista === 'verificacion') tipo = 'revision';
  else if (a.sala === 'r2') tipo = 'evidencia';
  else if (a.sala === 'plan') tipo = 'plan';
  else tipo = 'fuente';
  // Una corrección de esta entrada sustituye la versión pendiente en la cola.
  // Cambiar el ID por el contenido haría representar ambas versiones.
  return { id: `registro:${a.id}`, sala, agentes, tipo, dato: dato ? structuredClone(dato) : undefined, texto: a.texto,
    contexto: { corridaId: it.corridaId, iteracionId: it.id, pistaId: a.pistaId, fecha: a.desde ?? null } };
}

export function peliculaDelLaboratorio(datos: DatosLab, it: Iteracion | null, evidencia: Evidencia | null = null, estado?: EstadoRosa): PeliculaLab {
  const eventos: EventoVisualLab[] = [], ideas = new Map<string, IdeaVisualLab>(), vistos = new Set<string>();
  if (!it || datos.identidad !== `${it.corridaId}/${it.id}` || datos.iteracion !== it.numero || datos.conexion === 'muestra') return { eventos, ideas: [] };
  const agregar = (e: EventoVisualLab): boolean => {
    if (vistos.has(e.id)) return false;
    vistos.add(e.id); eventos.push(e); return true;
  };
  if (datos.pasos.lista.length) agregar({
    id: `plan:${it.id}`, sala: 'plan', agentes: ['Planificador'], tipo: 'plan',
    texto: [datos.pasos.aprobado ? tr('Plan aprobado. Empezamos') : tr('Plan'), ...datos.pasos.lista.map(p => [
      p.titulo, p.detalle, p.estado ? ESTADO_PASO[p.estado] : null,
    ].filter(Boolean).join(': '))].join('\n'),
  });
  for (const f of datos.fuentes) {
    if (f.salen === null && f.sirven === null && !f.fallo) continue;
    const autor = [...datos.actividad].reverse().find(a => a.fuente === f.nombre && (a.agente === 'Explorador' || a.agente === 'Generador de consultas'))?.agente;
    agregar({ id: `fuente:${it.id}:${f.nombre}`, sala: 'r1', agentes: [autor ?? 'Generador de consultas'], tipo: 'fuente',
      texto: [f.nombre, f.salen === null ? null : `${tr('Resultados')}: ${f.salen}`,
        f.sirven === null ? null : `${tr('Relevantes')}: ${f.sirven}`,
        f.fallo ? tr('Algunas consultas no respondieron') : null].filter(x => x !== null).join('\n') });
  }
  const { resultados, sirven, recuperados, leidos: leidas, afirmaciones: extraidas } = datos.lectura;
  if ([resultados, sirven, recuperados, leidas, extraidas].some(n => n !== null)) agregar({
    id: `lectura:${it.id}`, sala: 'r1', agentes: leidas !== null || extraidas !== null ? ['Extractor de afirmaciones'] : [], tipo: 'lectura',
    texto: [resultados === null ? null : `${tr('Resultados de consultas')}: ${resultados}`,
      sirven === null ? null : `${tr('Resultados relevantes')}: ${sirven}`,
      recuperados === null ? null : `${tr('Texto completo')}: ${recuperados}`,
      leidas === null ? null : `${tr('Fuentes leídas en la última extracción')}: ${leidas}`,
      extraidas === null ? null : `${tr('Afirmaciones extraídas')}: ${extraidas}`].filter(x => x !== null).join('\n'),
  });
  // Conserva todo el registro, incluidos intentos fallidos y tareas que ya terminaron.
  // La cola decide si representa la foto inicial o solo acontecimientos nuevos.
  for (const a of datos.actividad) {
    const e = registrado(a, it);
    if (!agregar(e)) continue;
    if (e.dato?.tipo === 'idea') ideas.set(e.dato.hipotesisId, { hipotesisId: e.dato.hipotesisId, titulo: e.dato.titulo, enfoque: e.dato.enfoque });
  }
  const ev = evidencia?.corridaId === it.corridaId ? evidencia : null;
  if (ev) for (const f of ev.fuentes) {
    if (f.iteracion !== it.numero || !idValido(f.id)) continue;
    agregar({ id: `fuente-documento:${it.id}:${f.id}`, sala: 'r1', agentes: [], tipo: 'fuente',
      texto: [f.titulo, f.referencia].filter(Boolean).join('\n') });
  }
  if (ev) for (const a of ev.afirmaciones) {
    if (a.iteracion !== it.numero || !idValido(a.id)) continue;
    agregar({ id: `afirmacion:${it.id}:${a.id}`, sala: 'r2',
      // La cadena no atribuye cada veredicto al juez o a una regla. Sus actores
      // vienen de las actividades explícitas, no de adivinar quién lo emitió.
      agentes: [], tipo: 'evidencia', texto: [a.texto, veredictoDe(a.veredicto).etiqueta, a.motivo, a.cita].filter(Boolean).join('\n') });
  }
  if (datos.juez.hechas !== null || datos.juez.sinJuez !== null || datos.juez.veredictos !== null) agregar({
    id: `verificacion:${it.id}`, sala: 'r2', agentes: datos.activos.includes('Juez') ? ['Juez'] : [], tipo: 'revision',
    texto: [...(datos.juez.hechas !== null ? [`${tr('Juez')}: ${datos.juez.hechas}${datos.juez.total === null ? '' : ` / ${datos.juez.total}`}`] : []),
      ...(datos.juez.sinJuez !== null ? [`${tr('Sin juez')}: ${datos.juez.sinJuez}`] : []),
      ...(datos.juez.veredictos ? [
        `${VEREDICTO.sostenida.etiqueta}: ${datos.juez.veredictos.sostenida}`,
        `${VEREDICTO.parcial.etiqueta}: ${datos.juez.veredictos.parcial}`,
        `${VEREDICTO.no_sostenida.etiqueta}: ${datos.juez.veredictos.no_sostenida}`,
        `${tr('Otros veredictos')}: ${datos.juez.veredictos.otras}`,
      ] : [])].join('\n'),
  });
  return { eventos, ideas: [...ideas.values()], etapas: etapasDe(eventos, datos, it, estado) };
}
