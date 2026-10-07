// El motor representa acontecimientos guardados. Este módulo no genera
// hipótesis, pares, resultados, participantes ni fechas para llenar una escena.
import type { EventoLab, Iteracion } from '../datos/tipos';
import type { ActividadLab, DatosLab, SalaLab } from './labVivo';
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
}
export interface IdeaVisualLab { hipotesisId: string; titulo: string; enfoque: string }
export interface PeliculaLab { eventos: EventoVisualLab[]; ideas: IdeaVisualLab[] }

const ENFOQUES: Record<string, string> = {
  analogia: 'Analogía', contradiccion: 'Contradicción', mecanismo_opuesto: 'Mecanismo opuesto', otra_escala: 'Otra escala',
};
const idValido = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const textoValido = (x: unknown): x is string => typeof x === 'string';

/** La respuesta HTTP también puede contener un histórico parcial o malformado.
 *  Un payload inválido conserva su texto, pero nunca crea una tarjeta asociada. */
export function eventoLabValido(valor: unknown): valor is EventoLab {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
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
    default: return false;
  }
}

function registrado(a: ActividadLab): EventoVisualLab {
  const dato = eventoLabValido(a.eventoLab) ? a.eventoLab : undefined;
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
  return { id: `registro:${a.id}`, sala, agentes, tipo, dato, texto: a.texto };
}

export function peliculaDelLaboratorio(datos: DatosLab, it: Iteracion | null, evidencia: Evidencia | null = null): PeliculaLab {
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
    const e = registrado(a);
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
  return { eventos, ideas: [...ideas.values()] };
}
