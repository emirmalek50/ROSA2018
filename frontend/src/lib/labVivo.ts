// Proyección del estado canónico al laboratorio. Los diálogos conservan el
// texto y la procedencia del registro; el reloj visual no avanza la corrida.
import { nombreDeModelo } from '../componentes/VigilanteModelos';
import type { AlcancePermiso, ArgumentoSolicitud, Corrida, EntradaTranscripcion, EstadoRosa, EventoLab, Incidencia, Investigacion, Iteracion, PasoPlan, Pista, TipoPermiso, Veredicto } from '../datos/tipos';
import { baseDe, busquedasDe } from './escenario';
import type { Evidencia } from './evidencia';
import { etiquetaCorrida, proponiendoPlan } from './etiquetas';
import { tr, trp } from './idioma';
import { peticionPorPresupuesto } from './peticionPresupuestoLab';
import { peliculaDelLaboratorio, type PeliculaLab } from './peliculaLab';
export type { EventoVisualLab, IdeaVisualLab, PeliculaLab } from './peliculaLab';

export type SalaLab = 'plan' | 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7';
export type EstadoSala = 'listo' | 'ahora' | 'espera' | 'fallo' | 'despues' | 'no_toca';
export type EstadoPasoLab = 'hecho' | 'ahora' | 'pendiente' | 'fallo' | 'omitido';
export interface FuenteLab {
  nombre: string; salen: number | null; fallo: boolean;
  /** Relevantes y consultas de esta biblioteca. Sirven es null si el cribado se compartió. */
  sirven: number | null; consultas: number;
}
/** Una afirmación real de la iteración, tal como la guarda la cadena de evidencia. */
export interface AfirmacionLab {
  id: string; texto: string; veredicto: Veredicto; caja: 'sostenida' | 'parcial' | 'no_sostenida' | 'otras';
  motivo: string; cita: string; articulo: string; biblioteca: string | null;
}
export interface ActividadLab {
  id: string;
  agente: string;
  sala: SalaLab;
  texto: string;
  tipo: EntradaTranscripcion['tipo'] | 'estado';
  pistaId: string | null;
  /** Asociación explícita de la pista; nunca se infiere del título. */
  hipotesisId?: string | null;
  pasoId: string | null;
  fuente: string;
  titulo: string;
  enCurso: boolean;
  /** Estado explícito de esta función, independiente del estado de toda la pista. */
  estadoAgente?: EntradaTranscripcion['estadoAgente'];
  /** Tipo efectivo de la tarea que emitió la entrada, incluso en pistas compartidas. */
  tipoPista?: string;
  eventoLab?: EventoLab;
  /** Tiempo relativo a la pista, nunca a otra pista ni a toda la corrida. */
  t: number | null;
  /** Tarea atribuida que empezó y aún no tiene su «Terminó» en la pista. */
  abierta?: boolean;
  /** Hora en que se escribió la entrada (inicio de la pista más t), si se sabe. */
  desde?: number | null;
}
export interface PeticionLab {
  id: string;
  clase: 'permiso' | 'plan' | 'presupuesto' | 'incidencia';
  quien: string;
  titulo: string;
  detalle: string;
  alcances: AlcancePermiso[];
  requiereArgumentos: boolean;
  tipo?: TipoPermiso;
  argumentos?: ArgumentoSolicitud[];
  presupuesto?: { corridaId: string; limite: number; usado: number; propuesta?: number };
  /** Algo impide seguir: lo que ROSA2018 propone y si la corrida sigue con lo demás. */
  incidencia?: { tipo: Incidencia['tipo']; recurso: string; alternativa: string | null; corridaEnMarcha: boolean };
}
export interface DatosLab {
  identidad: string;
  corrida: number;
  iteracion: number | null;
  titulo: string;
  conexion: EstadoRosa['conexion'];
  estado: Corrida['estado'];
  estadoTexto: string;
  motivo: string | null;
  trabajando: boolean;
  salas: Record<SalaLab, EstadoSala>;
  foco: SalaLab;
  activos: string[];
  actividad: ActividadLab[];
  pasos: { total: number; primero: string | null; aprobado: boolean; estados: EstadoPasoLab[]; enCurso: { n: number; titulo: string } | null; lista: { id?: string; titulo: string; detalle: string; estado?: PasoPlan['estado']; tipo?: string; presupuesto?: number | null }[] };
  fuentes: FuenteLab[];
  lectura: { resultados: number | null; sirven: number | null; recuperados: number | null; leidos: number | null; afirmaciones: number | null };
  /** Progreso del último intento de verificación, sin sumar reintentos. */
  juez: { hechas: number | null; total: number | null; sinJuez: number | null; veredictos: { sostenida: number; parcial: number; no_sostenida: number; otras: number } | null };
  pide: PeticionLab | null;
  modelos: { cerebro: string | null; volumen: string | null; juez: string | null };
  /** Llamadas al modelo de la iteración frente a su tope. */
  presupuesto: { usado: number; limite: number; reserva: number | null } | null;
  /** Null mientras la cadena de evidencia no ha llegado (o en modo muestra). */
  afirmaciones: AfirmacionLab[] | null;
  /** Una iteración anterior de la corrida: se mira, no se trabaja en ella. */
  pasada: boolean;
  /** Película derivada únicamente del registro y la evidencia de esta iteración. */
  pelicula?: PeliculaLab;
}
const TERMINADO = new Set<PasoPlan['estado']>(['hecho', 'fallido', 'omitido', 'sin_trabajo']);
const SALAS: Record<string, SalaLab[]> = { literatura: ['r1'], ensayos: ['r1'], extraccion: ['r1'], verificacion: ['r2'], modelo: ['r2'], hipotesis: ['r3', 'r4'], novedad: ['r4', 'r7'], analisis: ['r5'], replicacion: ['r5'], meta: ['r6'], grafo: ['r2'] };
const AGENTE: Record<string, string> = { literatura: 'Generador de consultas', ensayos: 'Explorador', extraccion: 'Extractor de afirmaciones', verificacion: 'Juez', modelo: 'Actualizador del modelo de mundo', grafo: 'Actualizador del modelo de mundo', hipotesis: 'Contradicción', novedad: 'Juez de viabilidad', analisis: 'Programador y Reparador', replicacion: 'Programador y Reparador', meta: 'Meta-revisor' };
const ATRIBUCION: Record<string, string> = { analogia: 'Analogía', contradiccion: 'Contradicción', mecanismo_opuesto: 'Mecanismo opuesto', otra_escala: 'Otra escala', killer: 'Killer', revision_inicial: 'Revisor inicial', supuestos: 'Evaluador de supuestos', torneo_a: 'Juez del torneo', torneo_b: 'Juez del torneo B', patentes: 'Especialista en patentes', companias: 'Especialista en compañías' };
const SALA_AGENTE: Record<string, SalaLab> = { 'Puntuador preguntas': 'r1', 'Puntuador amplitud': 'r1', 'Explorador': 'r1', 'Killer': 'r4', 'Juez del torneo': 'r4', 'Juez del torneo B': 'r4', 'Revisor inicial': 'r4', 'Evaluador de supuestos': 'r4', 'Concluidor': 'r4', 'Especialista en patentes': 'r7', 'Especialista en compañías': 'r7', 'Analogía': 'r3', 'Contradicción': 'r3', 'Mecanismo opuesto': 'r3', 'Otra escala': 'r3', 'Planificador de análisis': 'r5', 'Auditor del análisis': 'r5', 'Intérprete': 'r5', 'Revisor del registro': 'r6', 'Resumidor': 'r6' };
const numero = (s: string) => Number(s.replace(/\./g, ''));
function tipoDePaso(it: Iteracion, p: PasoPlan): string {
  return p.tipo ?? it.pistas.find((x) => x.pasoId === p.id)?.tipo ?? '';
}
function tipoDePista(it: Iteracion, p: Pista): string {
  const paso = it.plan.find((x) => x.id === p.pasoId);
  // Un paso de hipótesis contiene tanto generación como verificación y modelo.
  if (p.tipo !== 'modelo') return p.tipo;
  if (p.titulo === 'Generar y revisar hipótesis') return 'hipotesis';
  if (p.titulo === 'Meta-revisión y panorama') return 'meta';
  if (p.titulo === 'Análisis in silico') return 'analisis';
  if (p.titulo === 'Actualizar hechos y preguntas' || p.titulo.startsWith('Evidencia nueva para')) return 'modelo';
  return paso ? tipoDePaso(it, paso) : p.tipo;
}
/** Solo prefijos emitidos por el backend. Mencionar un método dentro de una
 * afirmación no significa que ese método esté ejecutándose. */
function autorDe(tipo: string, e: EntradaTranscripcion, entran: [string, string][] = []): string {
  const t = e.texto;
  if (e.agente && ATRIBUCION[e.agente]) return ATRIBUCION[e.agente]!;
  if (tipo === 'hipotesis') {
    // Lo que rosa/bucle/pasos.py emite sin agente dentro de la revisión del
    // Killer (_killer, _evaluar_sesgo_fuentes, contexto_de_bases, reformular).
    if (/^(?:Revisada: |Reformulada |No se pudo reformular|Bases para |Las bases no respondieron|No se pudo comprobar la viabilidad|Índice semántico|Riesgo de sesgo de |Auditoría de la decisión|La hipótesis cambió a la versión|El Killer no respondió)/.test(t)) return 'Killer';
    if (/^[^:]{1,60}: (?:RoB 2|ROBINS-I|QUADAS-2|ROBIS|SYRCLE)\b/.test(t)) return 'Killer';
    if (/^(?:Partido |.{1,50} vs .{1,50}: (?:tablas|gana)|\d+ pares |\d+ partidos se decidieron|Sin torneo|Menos de dos hipótesis vivas)/.test(t)) return 'Juez del torneo';
    const fuera = /^Se queda fuera «.*» \(([a-z_]+),/.exec(t);
    if (fuera && ATRIBUCION[fuera[1]!]) return ATRIBUCION[fuera[1]!]!;
    if (t.startsWith('Nueva: ')) {
      const titulo = t.slice(7);
      const de = entran.find(([x]) => x.startsWith(titulo) || titulo.startsWith(x));
      if (de) return de[1];
    }
  }
  if (/^(?:Killer:|Killer sobre |Hypothesis Killer:)/.test(t)) return 'Killer';
  if (/^(?:Revisión inicial |Evaluando supuestos)/.test(t)) return 'Revisor inicial';
  if (/^(?:Torneo:|Partido:|Dos jueces)/.test(t)) return 'Juez del torneo';
  if (/^Relevancia \(amplitud\)/.test(t)) return 'Puntuador amplitud';
  if (/^(?:Cribado:|Relevancia \(foco\))/.test(t)) return 'Puntuador preguntas';
  if (/^(?:Congelando el plan de análisis|Plan congelado|Plan de reproducción)/.test(t)) return 'Planificador de análisis';
  if (/^Ejecución .*auditoría/.test(t)) return 'Auditor del análisis';
  for (const [enfoque, agente] of Object.entries(ATRIBUCION)) {
    if ((t.startsWith('Entra por el enfoque «') || t.startsWith('El miembro «')) && t.includes(`«${enfoque}»`)) return agente;
  }
  return AGENTE[tipo] ?? 'Planificador';
}
/** Los ids del backend llevan la hora de creación en base 36 (rosa/estado/plantilla.py
 * `nuevo_id`); la pista crea el suyo al empezar, que es el cero de sus `t`. */
function inicioDeId(id: string): number | null {
  const m = /^[a-z]+-([0-9a-z]{7,9})-/.exec(id);
  const ms = m ? parseInt(m[1]!, 36) : NaN;
  return ms > 1.5e12 && ms < 4e12 ? ms : null;
}
function actividadesDe(it: Iteracion | null): ActividadLab[] {
  if (!it) return [];
  const filas: ActividadLab[] = [];
  for (const p of it.pistas) {
    const tipo = tipoDePista(it, p);
    const base = { pistaId: p.id, hipotesisId: p.hipotesisId ?? null, pasoId: p.pasoId, fuente: p.fuente, titulo: p.titulo, enCurso: p.estado === 'en_curso', tipoPista: tipo };
    // El registro completo permite reproducir también lo ocurrido antes de las
    // últimas cuarenta líneas. Los IDs mantienen su índice original al crecer.
    const entradas = p.transcripcion;
    // Al conservar el histórico entero, recorrer el resto por cada entrada
    // sería cuadrático. El último cierre basta para detectar cierres posteriores.
    const ultimoCierre = new Map<string, number>();
    entradas.forEach((e, n) => { if (e.agente && e.estadoAgente !== 'en_curso') ultimoCierre.set(e.agente, n); });
    // «Nueva: título» no dice el enfoque; la nota «Entra por el enfoque» del mismo título sí.
    const entran: [string, string][] = [];
    for (const e of p.transcripcion) {
      const m = /^Entra por el enfoque «([a-z_]+)» \([^)]*\): (.+)$/.exec(e.texto);
      if (m && ATRIBUCION[m[1]!]) entran.push([m[2]!, ATRIBUCION[m[1]!]!]);
    }
    const inicio = inicioDeId(p.id);
    entradas.forEach((e, i) => {
      const agente = autorDe(tipo, e, entran);
      const n = p.transcripcion.length - entradas.length + i;
      const abierta = p.estado === 'en_curso' && !!e.agente && e.estadoAgente === 'en_curso' && (ultimoCierre.get(e.agente) ?? -1) < n;
      filas.push({ ...base, id: `${p.id}:${n}:${e.t}`, agente, sala: SALA_AGENTE[agente] ?? SALAS[tipo]?.[0] ?? 'plan', texto: e.texto, tipo: e.tipo, t: e.t, abierta, estadoAgente: e.estadoAgente,
        // El histórico textual sigue visible; solo una pista atribuida a esta
        // iteración puede crear sus tarjetas estructuradas en la película.
        eventoLab: p.iteracionId === it.id ? e.eventoLab : undefined, desde: inicio === null ? null : inicio + e.t });
    });
    // La apertura y el cierre son estados guardados, no parlamentos inventados.
    if (!entradas.length || (p.estado !== 'en_curso' && p.resumen && p.resumen !== entradas.at(-1)?.texto)) {
      const agente = AGENTE[tipo] ?? 'Planificador';
      // Las pistas antiguas sin registro conservaron el texto provisional
      // incluso después de cerrar la corrida. El título identifica la tarea
      // real; ese texto provisional no describe una actividad del agente.
      const provisional = /^empezando(?:\.{3}|…)?$/i.test(p.resumen.trim());
      const texto = provisional ? p.titulo : p.resumen || p.titulo;
      filas.push({ ...base, id: `${p.id}:estado:${p.estado}`, agente, sala: SALAS[tipo]?.[0] ?? 'plan', texto, tipo: p.estado === 'fallida' ? 'error' : 'estado', t: p.ms, abierta: false, desde: null });
    }
  }
  if (it.resumen) filas.push({ id: `${it.id}:resumen`, agente: 'Resumidor', sala: 'r6', texto: it.resumen, tipo: 'resultado', pistaId: null, pasoId: null, fuente: '', titulo: tr('Resumen de la iteración'), t: null, enCurso: false, abierta: false, estadoAgente: 'terminado', tipoPista: 'meta', desde: null });
  return filas;
}
function juezDe(it: Iteracion | null): DatosLab['juez'] {
  const pista = [...(it?.pistas ?? [])].reverse().find((p) => p.tipo === 'verificacion');
  let hechas: number | null = null, total: number | null = null, sinJuez: number | null = null;
  for (const e of pista?.transcripcion ?? []) {
    const d = /^Deterministas:\s*(\d[\d.]*)\s+resueltas sin juez.*?;\s*(\d[\d.]*)\s+van al juez/.exec(e.texto);
    if (d) { sinJuez = numero(d[1]!); total = numero(d[2]!); hechas = 0; }
    const j = /^Juez:\s*(\d[\d.]*)\s+de\s+(\d[\d.]*)/.exec(e.texto);
    if (j) { hechas = numero(j[1]!); total = numero(j[2]!); }
  }
  let veredictos: DatosLab['juez']['veredictos'] = null;
  // Un resumen parcial, fallo o interrupción nunca completa el contador.
  const r = pista?.estado === 'hecha' ? /^(\d[\d.]*)\s+afirmaciones:\s*([^;]*)/.exec(pista.resumen) : null;
  if (r) {
    const v = { sostenida: 0, parcial: 0, no_sostenida: 0, otras: 0 };
    let sum = 0;
    for (const trozo of r[2]!.split(',')) {
      const m = /^(\d[\d.]*)\s+(.+)$/.exec(trozo.trim());
      if (!m) continue;
      const n = numero(m[1]!); sum += n;
      const clase = m[2]!.trim().replace(/ /g, '_');
      if (clase === 'sostenida' || clase === 'parcial' || clase === 'no_sostenida') v[clase] += n;
      else v.otras += n;
    }
    if (sum === numero(r[1]!)) veredictos = v;
  }
  return { hechas, total, sinJuez, veredictos };
}
function lecturaDe(it: Iteracion | null, corrida: Corrida): { fuentes: FuenteLab[]; lectura: DatosLab['lectura'] } {
  const filas = busquedasDe(it, corrida.busqueda.consultas);
  const porFuente = new Map<string, FuenteLab>();
  for (const f of filas) {
    const a = porFuente.get(f.fuente) ?? { nombre: f.fuente, salen: null, fallo: false, sirven: 0, consultas: 0 };
    a.consultas += 1;
    if (f.salen !== null) a.salen = (a.salen ?? 0) + f.salen;
    // Como en el total: el cribado compartido no se reparte entre bibliotecas.
    a.sirven = a.sirven === null || f.compartida || f.sirven === null ? null : a.sirven + f.sirven;
    if (f.estado === 'fallida' && f.salen === null) a.fallo = true;
    porFuente.set(f.fuente, a);
  }
  const conocidas = (clave: 'salen' | 'sirven' | 'enteros') => {
    const unicas = clave === 'salen' ? filas : filas.filter((f) => !f.compartida);
    // El cribado compartido no se suma dos veces; no se inventa su reparto.
    return unicas.length && unicas.every((f) => f[clave] !== null) && (clave === 'salen' || !filas.some((f) => f.compartida)) ? unicas.reduce((n, f) => n + f[clave]!, 0) : null;
  };
  let leidos: number | null = null, afirmaciones: number | null = null;
  const ext = [...(it?.pistas ?? [])].reverse().find((p) => p.tipo === 'extraccion');
  for (const e of ext?.transcripcion ?? []) {
    const m = /^Fuente\s+(\d[\d.]*)\s+de\s+\d[\d.]*:.*\((\d[\d.]*)\s+acumuladas\)/.exec(e.texto);
    if (m) { leidos = numero(m[1]!); afirmaciones = numero(m[2]!); }
  }
  const cierre = ext?.estado === 'hecha' ? /^(\d[\d.]*) fuentes, (\d[\d.]*) afirmaciones con cita/.exec(ext.resumen) : null;
  if (cierre) { leidos = numero(cierre[1]!); afirmaciones = numero(cierre[2]!); }
  return { fuentes: [...porFuente.values()], lectura: { resultados: conocidas('salen'), sirven: conocidas('sirven'), recuperados: conocidas('enteros'), leidos, afirmaciones } };
}
const QUIEN_PIDE: Record<TipoPermiso, string> = { presupuesto_grande: 'Planificador', trabajo_largo: 'Planificador', fuente_externa: 'Explorador', acceso_corpus: 'Explorador', aceptar_hipotesis: 'Concluidor' };
function peticionDe(estado: EstadoRosa, corrida: Corrida, it: Iteracion | null, ultimo: string | undefined): PeticionLab | null {
  if (estado.conexion !== 'en_linea' || corrida.estado === 'detenida' || corrida.estado === 'terminada') return null;
  const s = estado.solicitudes.filter((x) => x.corridaId === corrida.id && x.estado === 'pendiente').sort((a, b) => a.creadaEn - b.creadaEn)[0];
  if (s) return { id: s.id, clase: 'permiso', quien: QUIEN_PIDE[s.tipo], titulo: s.titulo, detalle: s.detalle, alcances: s.alcances, requiereArgumentos: s.argumentos.length > 0, tipo: s.tipo, argumentos: s.argumentos, presupuesto: { corridaId: corrida.id, limite: corrida.presupuesto.limiteLlamadas, usado: corrida.gasto.llamadas } };
  if (corrida.estado === 'pausada_por_presupuesto') return peticionPorPresupuesto(corrida, it);
  // Las mismas incidencias que la corrida enseña en «Algo impide seguir»; las de modelo sin respuesta se resuelven solas.
  const inc = estado.incidencias.filter((x) => x.corridaId === corrida.id && x.estado === 'pendiente' && x.tipo !== 'modelo_sin_respuesta').sort((a, b) => a.creadaEn - b.creadaEn)[0];
  if (inc) return { id: inc.id, clase: 'incidencia', quien: ultimo ?? 'Planificador', titulo: inc.titulo, detalle: inc.detalle, alcances: [], requiereArgumentos: false, incidencia: { tipo: inc.tipo, recurso: inc.recurso, alternativa: inc.alternativa, corridaEnMarcha: corrida.estado === 'en_marcha' } };
  if (it && corrida.estado === 'esperando_plan' && !it.planAprobado && it.terminadaEn === null && it.plan.length > 0) return { id: it.id, clase: 'plan', quien: 'Planificador', titulo: '', detalle: '', alcances: [], requiereArgumentos: false };
  return null;
}
/** Las afirmaciones de una iteración en la cadena de evidencia, con su artículo
 *  y la biblioteca de la primera consulta que lo trajo. */
export function afirmacionesDeEvidencia(ev: Evidencia, numero: number): AfirmacionLab[] {
  const fuentes = new Map(ev.fuentes.map((f) => [f.id, f]));
  const bases = new Map(ev.consultas.map((c) => [c.consulta, c.base]));
  return ev.afirmaciones.filter((a) => a.iteracion === numero).map((a) => {
    const f = fuentes.get(a.fuenteId), base = f?.consultas.map((q) => bases.get(q)).find((b) => b !== undefined);
    const caja = a.veredicto === 'sostenida' || a.veredicto === 'parcial' || a.veredicto === 'no_sostenida' ? a.veredicto : 'otras';
    return { id: a.id, texto: a.texto, veredicto: a.veredicto, caja, motivo: a.motivo, cita: a.cita, articulo: f?.titulo || f?.referencia || a.cita, biblioteca: base ? baseDe(base).nombre : null };
  });
}
export function datosDelLaboratorio(estado: EstadoRosa, inv: Investigacion, corrida: Corrida, recibida: Iteracion | null, opciones: { pasada?: boolean; evidencia?: Evidencia | null } = {}): DatosLab {
  // Un cambio de corrida puede llegar antes que sus iteraciones. Nunca mezclar.
  const pasada = !!opciones.pasada && recibida?.corridaId === corrida.id && recibida.numero !== corrida.iteracionActual;
  const it = recibida?.corridaId === corrida.id && (pasada || recibida.numero === corrida.iteracionActual) ? recibida : null;
  const plan = it?.plan ?? [];
  const actividad = actividadesDe(it);
  const proponiendo = proponiendoPlan(corrida, it);
  const trabajando = !pasada && estado.conexion === 'en_linea' && (proponiendo || (corrida.estado === 'en_marcha' && it?.terminadaEn === null && it.planAprobado));
  const pide = pasada ? null : peticionDe(estado, corrida, it, actividad.at(-1)?.agente);
  // Una incidencia no para la corrida: el resto del trabajo sigue a la vista detrás del letrero.
  const bloquea = !!pide && pide.clase !== 'incidencia';
  const salas: DatosLab['salas'] = { plan: it?.planAprobado ? 'listo' : 'despues', r1: 'no_toca', r2: 'no_toca', r3: 'no_toca', r4: 'no_toca', r5: 'no_toca', r6: 'despues', r7: 'no_toca' };
  const enCurso = plan.find((p) => p.estado === 'en_curso');
  const siguiente = enCurso ?? plan.find((p) => p.estado === 'pendiente');
  let foco: SalaLab = it?.planAprobado ? (SALAS[it && siguiente ? tipoDePaso(it, siguiente) : '']?.[0] ?? 'r6') : 'plan';
  for (const s of Object.keys(salas) as SalaLab[]) {
    const pasos = plan.filter((p) => it && SALAS[tipoDePaso(it, p)]?.includes(s));
    if (pasos.length) salas[s] = pasos.every((p) => TERMINADO.has(p.estado)) ? (pasos.some((p) => p.estado === 'fallido') ? 'fallo' : pasos.some((p) => p.estado === 'hecho') ? 'listo' : 'no_toca') : 'despues';
  }
  // El checkpoint de especialistas también puede ocurrir fuera de un paso de
  // novedad. Un paso antiguo cerrado, sin sus registros, no prueba su revisión.
  const pistasNovedad = new Set(actividad.filter((a) => a.sala === 'r7').map((a) => a.pistaId));
  const propias = it?.pistas.filter((p) => pistasNovedad.has(p.id)) ?? [];
  if (propias.length && propias.every((p) => p.estado !== 'en_curso')) {
    salas.r7 = propias.some((p) => p.estado === 'fallida') ? 'fallo' : propias.some((p) => p.estado === 'hecha') ? 'listo' : 'espera';
  } else if (!propias.length && (salas.r7 === 'listo' || salas.r7 === 'fallo')) salas.r7 = 'no_toca';
  const activos: string[] = [];
  if (!pasada && it?.terminadaEn === null) {
    const pistasVivas = it.pistas.filter((p) => p.estado === 'en_curso' && (!p.pasoId || !TERMINADO.has(plan.find((x) => x.id === p.pasoId)?.estado ?? 'pendiente')));
    for (const p of pistasVivas) {
      const ultima = [...actividad].reverse().find((e) => e.pistaId === p.id);
      if (!ultima) continue;
      foco = ultima.sala;
      const atribuidas = new Map<string, EntradaTranscripcion>();
      p.transcripcion.forEach((e) => { if (e.agente && ATRIBUCION[e.agente]) atribuidas.set(e.agente, e); });
      const miembros = [...atribuidas.values()].filter((e) => e.estadoAgente === 'en_curso');
      if (miembros.length) {
        miembros.forEach((e) => { const a = autorDe('hipotesis', e); salas[SALA_AGENTE[a]!] = trabajando ? 'ahora' : 'espera'; if (trabajando) activos.push(a); });
      } else {
        salas[foco] = trabajando ? 'ahora' : 'espera';
        // Una tarea atribuida que acaba de terminar no deja a nadie trabajando;
        // lo que su autor escribe después (Revisada, Reformulada) sí es trabajo.
        const cruda = p.transcripcion.at(-1);
        const recienTerminada = !!cruda?.agente && !!ATRIBUCION[cruda.agente] && cruda.estadoAgente !== 'en_curso';
        if (trabajando && !recienTerminada && !ultima.texto.startsWith('El miembro «')) activos.push(ultima.agente);
      }
    }
    if (!pistasVivas.length && siguiente && it.planAprobado) {
      salas[foco] = trabajando && enCurso ? 'ahora' : 'espera';
      if (trabajando && enCurso) activos.push(AGENTE[tipoDePaso(it, enCurso)] ?? 'Planificador');
    }
  }
  if (!pasada && (proponiendo || pide?.clase === 'plan')) {
    foco = 'plan'; salas.plan = trabajando ? 'ahora' : 'espera';
    if (trabajando) activos.push('Planificador');
  }
  if (it?.resumen || it?.revisionRegistro) salas.r6 = 'listo';
  if (bloquea) { activos.length = 0; salas[foco] = 'espera'; }
  const cerrada = pasada || corrida.estado === 'terminada' || corrida.estado === 'detenida';
  if (cerrada) {
    for (const s of Object.keys(salas) as SalaLab[]) if (salas[s] === 'despues') salas[s] = s === 'r6' ? 'no_toca' : 'espera';
  }
  const salud = estado.saludModelos ?? {};
  const modelo = (rol: 'cerebro' | 'volumen' | 'juez') => salud[rol]?.modelo ? nombreDeModelo(salud[rol]!.modelo) : null;
  const evidencia = estado.conexion !== 'muestra' && opciones.evidencia?.corridaId === corrida.id ? opciones.evidencia : null;
  const datos: DatosLab = {
    identidad: `${corrida.id}/${it?.id ?? 'sin-iteracion'}`, corrida: corrida.numero, iteracion: it?.numero ?? null, titulo: inv.titulo,
    conexion: estado.conexion, estado: corrida.estado, estadoTexto: pasada && it ? trp('Iteración {n} ya cerrada', { n: it.numero }) : etiquetaCorrida(corrida, it), motivo: pasada ? null : cerrada ? corrida.motivoCierre : corrida.estado === 'pausada_por_presupuesto' ? corrida.presupuesto.motivoPausa ?? null : corrida.estado === 'pausada' ? corrida.motivoPausaPropia ?? null : null,
    trabajando: trabajando && !bloquea, salas, foco, activos: [...new Set(activos)], actividad,
    pasos: { total: plan.length, primero: plan[0]?.titulo ?? null, aprobado: !!it?.planAprobado, estados: plan.map((p) => p.estado === 'fallido' ? 'fallo' : p.estado === 'omitido' || p.estado === 'sin_trabajo' ? 'omitido' : p.estado === 'hecho' ? 'hecho' : trabajando && p.estado === 'en_curso' ? 'ahora' : 'pendiente'), enCurso: trabajando && enCurso ? { n: plan.indexOf(enCurso) + 1, titulo: enCurso.titulo } : null, lista: plan.map((p) => ({ id: p.id, titulo: p.titulo, detalle: p.detalle, estado: p.estado, tipo: p.tipo, presupuesto: p.presupuesto })) },
    ...lecturaDe(it, corrida), juez: juezDe(it), pide, modelos: { cerebro: modelo('cerebro'), volumen: modelo('volumen'), juez: modelo('juez') },
    presupuesto: it && it.presupuesto.limite > 0 ? { usado: it.presupuesto.usado, limite: it.presupuesto.limite, reserva: it.presupuesto.reservaCierre ?? null } : null,
    afirmaciones: evidencia && it ? afirmacionesDeEvidencia(evidencia, it.numero) : null, pasada,
  };
  datos.pelicula = peliculaDelLaboratorio(datos, it, evidencia);
  return datos;
}
