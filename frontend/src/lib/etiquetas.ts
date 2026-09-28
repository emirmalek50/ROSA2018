// Textos visibles de cada estado y tipo del dominio. Un solo sitio: un
// estado nuevo en tipos.ts obliga a darle etiqueta aqui (Record exhaustivo),
// y las pantallas nunca ensenan la clave interna.

import type {
  AccionEspera,
  Afirmacion,
  AlcancePermiso,
  Amplitud,
  Bloqueo,
  CambioAprendizaje,
  CategoriaCaso,
  CertezaEvidencia,
  ClaseAccion,
  ClaseEvidencia,
  ClasificacionCita,
  ClasificacionDatos,
  Corrida,
  DecisionKiller,
  DimensionesResultado,
  DireccionEvidencia,
  Ejecucion,
  EstadoCaso,
  EstadoCorrida,
  EstadoHallazgo,
  EstadoHecho,
  EstadoHipotesis,
  Hipotesis,
  EstadoInvestigacion,
  EstadoPaso,
  EstadoPista,
  AlcanceSupuesto,
  DondeSeResponde,
  EstadoSupuesto,
  EtapaDecision,
  FactorCerteza,
  InterpretacionEjecucion,
  Iteracion,
  Leccion,
  MetodoRegistrado,
  ModoBusqueda,
  NivelAprendizaje,
  NivelAutonomia,
  PasoRutaTerapeutica,
  EstadoPasoRuta,
  CapaDiana,
  EstadoCapaDiana,
  RamaNegativo,
  ProcedenciaDataset,
  Reproduccion,
  ResultadoLaboratorio,
  TipoAfirmacion,
  TipoArtefacto,
  TipoEstudio,
  TipoEvento,
  TipoFuente,
  TipoHallazgo,
  TipoHecho,
  TipoIncidencia,
  TipoPermiso,
  TipoPista,
  TipoRevisionAutomatica,
  Veredicto,
} from '../datos/tipos';

export const ESTADO_CORRIDA: Record<EstadoCorrida, string> = {
  en_marcha: 'En marcha',
  pausada: 'Pausada',
  pausada_por_presupuesto: 'Pausada: presupuesto agotado',
  esperando_aprobacion: 'Esperando tu aprobación',
  esperando_plan: 'Esperando que apruebes el plan',
  esperando_modelo: 'Esperando al modelo',
  detenida: 'Detenida',
  terminada: 'Terminada',
};

/** Verdadero mientras ROSA2018 escribe el plan: la corrida está en `esperando_plan`
 * pero todavía no hay un plan que aprobar (la iteración no existe, o la última
 * ya se aprobó o se cerró y ROSA2018 propone la siguiente). El servidor deja la
 * corrida en `esperando_plan` desde que se crea, y las llamadas al cerebro
 * para la misión, la pregunta y el plan tardan uno o dos minutos. */
export function proponiendoPlan(corrida: Pick<Corrida, 'estado'>, iteracion: Pick<Iteracion, 'planAprobado' | 'terminadaEn'> | null): boolean {
  return corrida.estado === 'esperando_plan' && (!iteracion || iteracion.planAprobado || iteracion.terminadaEn !== null);
}

/** La etiqueta del estado de una corrida tal como la ve la persona: distingue
 * "ROSA2018 está proponiendo el plan" de "Esperando que apruebes el plan". */
export function etiquetaCorrida(corrida: Pick<Corrida, 'estado'>, iteracion: Pick<Iteracion, 'planAprobado' | 'terminadaEn'> | null): string {
  return proponiendoPlan(corrida, iteracion) ? 'ROSA2018 está proponiendo el plan' : ESTADO_CORRIDA[corrida.estado];
}

export const AMPLITUD: Record<Amplitud, { etiqueta: string; nota: string; fraccion: string }> = {
  enfocada: { etiqueta: 'Enfocada', nota: 'Todas las consultas sirven a la pregunta de la corrida y al peldaño que le falta a cada hipótesis. Rápida y barata; puede perderse lo que hay al lado.', fraccion: '0 %' },
  equilibrada: { etiqueta: 'Equilibrada', nota: 'Un tercio de las consultas explora alrededor: temas adyacentes del modelo de mundo, novedad reciente del campo y búsquedas por significado con otro vocabulario. Es el valor por defecto.', fraccion: '34 %' },
  amplia: { etiqueta: 'Amplia', nota: 'La mitad de las consultas explora. Lee más artículos por iteración; útil al empezar una investigación o cuando el árbol se ha quedado en un punto fijo.', fraccion: '50 %' },
};

export const AMBITO_LECCION: Record<Leccion['ambito'], string> = {
  plan: 'Plan',
  consultas: 'Consultas',
  fuentes: 'Fuentes',
  hipotesis: 'Hipótesis',
  analisis: 'Análisis',
  resumen: 'Resumen',
};

export const MODO_BUSQUEDA: Record<ModoBusqueda, { etiqueta: string; nota: string }> = {
  foco: { etiqueta: 'Foco', nota: 'Sirve a la pregunta de la corrida o al peldaño de una hipótesis' },
  amplitud: { etiqueta: 'Amplitud', nota: 'Explora alrededor del objetivo: lo que podría cambiar una hipótesis o abrir una línea' },
};

export const ESTADO_INVESTIGACION: Record<EstadoInvestigacion, string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  cerrada: 'Cerrada',
};

export const ESTADO_PASO: Record<EstadoPaso, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  hecho: 'Hecho',
  fallido: 'Fallido',
  omitido: 'Omitido',
  sin_trabajo: 'Sin trabajo',
};

export const TIPO_PISTA: Record<TipoPista, string> = {
  literatura: 'Búsqueda de literatura',
  ensayos: 'Ensayos clínicos',
  grafo: 'Grafo de conocimiento',
  extraccion: 'Extracción de afirmaciones',
  verificacion: 'Verificación',
  novedad: 'Comprobación de novedad',
  modelo: 'Modelo de mundo',
  replicacion: 'Replicación independiente',
};

export const ESTADO_PISTA: Record<EstadoPista, string> = {
  en_curso: 'en curso',
  hecha: 'hecha',
  fallida: 'no se pudo completar',
  detenida: 'detenida por ti',
};

export const TIPO_PERMISO: Record<TipoPermiso, string> = {
  aceptar_hipotesis: 'Aceptar una hipótesis en el modelo de mundo',
  presupuesto_grande: 'Gastar un presupuesto grande',
  fuente_externa: 'Consultar una fuente externa',
  trabajo_largo: 'Lanzar un trabajo largo',
  acceso_corpus: 'Acceder a un corpus',
};

export const ALCANCE: Record<AlcancePermiso, string> = {
  una_vez: 'Solo esta vez',
  esta_corrida: 'Durante esta corrida',
  esta_investigacion: 'En esta investigación',
  siempre: 'Siempre',
};

export const TIPO_INCIDENCIA: Record<TipoIncidencia, string> = {
  modelo_bloqueado: 'El modelo se nego a responder',
  conector_caducado: 'Un conector caduco',
  fuente_sin_respuesta: 'Una fuente no responde',
  modelo_sin_respuesta: 'Un modelo no responde; ROSA2018 reintenta sola',
};

export const CLASE_ACCION: Record<ClaseAccion, string> = {
  buscar_literatura: 'Buscar literatura y leer artículos',
  correr_analisis: 'Correr un análisis de datos',
  gastar_grande: 'Gastar más que el presupuesto de una iteración',
  escribir_modelo_mundo: 'Escribir un hecho en el modelo de mundo',
  descartar_hipotesis: 'Descartar una hipótesis',
  contactar_laboratorio: 'Proponer un experimento a un laboratorio',
};

export const NIVEL_AUTONOMIA: Record<NivelAutonomia, string> = {
  sugerir: 'Solo sugerir',
  preguntar: 'Preguntar antes',
  actuar: 'Actuar y avisar',
};

export const ACCION_ESPERA: Record<AccionEspera, string> = {
  recordar: 'Recordar por Slack o correo',
  escalar: 'Escalar a otra persona',
  detener: 'Detener la corrida con seguridad',
  continuar: 'Continuar y dejarlo registrado',
};

export const ESTADO_HIPOTESIS: Record<EstadoHipotesis, string> = {
  propuesta: 'Propuesta',
  en_revision: 'En revisión',
  aceptada: 'Aceptada',
  descartada: 'Descartada',
  refinar: 'Por refinar',
  aclarando: 'ROSA2018 la está aclarando',
};

/** Una tabla de etiquetas que responde también a una clave que no conoce:
 *  `tabla[claveRara]` devuelve el respaldo en vez de `undefined`, así un valor
 *  nuevo del servidor (un veredicto o un nivel de certeza que esta versión de
 *  la interfaz no tiene) no tumba la pantalla al leer `.bloquea` o `.tono`.
 *  Las claves conocidas, `Object.keys`, `in` y `Object.hasOwn` siguen igual;
 *  lo que viene del prototipo (constructor, toString) tampoco cambia. */
function conRespaldo<K extends string, V>(tabla: Record<K, V>, respaldo: (clave: string) => V): Record<K, V> {
  return new Proxy(tabla, {
    get(destino, propiedad, receptor) {
      if (typeof propiedad === 'string' && !Object.hasOwn(destino, propiedad) && !(propiedad in Object.prototype)) return respaldo(propiedad);
      return Reflect.get(destino, propiedad, receptor) as V;
    },
  });
}

function legible(clave: string): string {
  return String(clave).replace(/_/g, ' ').trim() || 'sin nombre';
}

export type EtiquetaVeredicto = { etiqueta: string; tono: 'ok' | 'aviso' | 'mal'; bloquea: boolean };

/** Un veredicto que esta versión no conoce se trata como bloqueante y "no
 *  comprobado": ROSA2018 no da por buena una afirmación sin saber qué dice su
 *  veredicto (regla "no pude comprobar" no es "no hay"). */
export function respaldoVeredicto(clave: string): EtiquetaVeredicto {
  return { etiqueta: `Veredicto que esta versión no conoce (${legible(clave)})`, tono: 'aviso', bloquea: true };
}

export const VEREDICTO: Record<Veredicto, EtiquetaVeredicto> = conRespaldo(
  {
    sostenida: { etiqueta: 'Sostenida', tono: 'ok', bloquea: false },
    parcial: { etiqueta: 'Parcial', tono: 'aviso', bloquea: false },
    no_sostenida: { etiqueta: 'No sostenida', tono: 'mal', bloquea: true },
    cita_no_resuelve: { etiqueta: 'Cita sin fuente', tono: 'mal', bloquea: true },
    sin_cita: { etiqueta: 'Sin ninguna cita', tono: 'mal', bloquea: true },
    ausencia_refutada: { etiqueta: 'Dice que no está, y sí está', tono: 'mal', bloquea: true },
    sin_verificar: { etiqueta: 'Sin comprobar', tono: 'aviso', bloquea: false },
  },
  respaldoVeredicto,
);

/** La entrada de VEREDICTO para cualquier valor, también uno raro (null, un
 *  número, una clave nueva): nunca lanza. */
export function veredictoDe(v: unknown): EtiquetaVeredicto {
  return typeof v === 'string' && Object.hasOwn(VEREDICTO, v) ? VEREDICTO[v as Veredicto] : respaldoVeredicto(typeof v === 'string' ? v : v === null || v === undefined ? 'sin veredicto' : String(v));
}

export type EtiquetaCerteza = { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde'; nota: string; verbo: string };

/** Un nivel de certeza que esta versión no conoce se enseña con su clave
 *  legible y tono neutro, sin inventar nivel ni frase calibrada. */
export function respaldoCerteza(clave: string): EtiquetaCerteza {
  const k = legible(clave);
  return { etiqueta: `Certeza sin clasificar (${k})`, tono: 'borde', nota: `El servidor guardó un nivel de certeza (${k}) que esta versión de la interfaz no conoce. No se puede interpretar hasta actualizarla.`, verbo: 'no se puede decir si' };
}

/** Sin respaldo automático (a diferencia de VEREDICTO): varias pantallas
 *  comprueban `CERTEZA_EVIDENCIA[x]` para decidir si pintan o no un chip, y un
 *  nivel desconocido debe seguir siendo "nada que pintar" ahí. Quien necesite
 *  leer `.etiqueta` o `.tono` sin riesgo usa `certezaDe`. */
export const CERTEZA_EVIDENCIA: Record<CertezaEvidencia, EtiquetaCerteza> = {
  alta: { etiqueta: 'Certeza alta', tono: 'ok', nota: 'Varios estudios independientes y directos coinciden. Es muy poco probable que más investigación cambie la conclusión.', verbo: 'la evidencia indica que' },
  moderada: { etiqueta: 'Certeza moderada', tono: 'aviso', nota: 'Evidencia consistente pero de una sola cohorte, indirecta o imprecisa. Más investigación podría cambiarla.', verbo: 'probablemente' },
  baja: { etiqueta: 'Certeza baja', tono: 'aviso', nota: 'Solo indicios, inferencias o estudios con limitaciones serias. Es probable que más investigación la cambie.', verbo: 'puede que' },
  muy_baja: { etiqueta: 'Certeza muy baja', tono: 'borde', nota: 'El punto de partida de toda hipótesis nueva: solo literatura indirecta, de una cohorte, sin réplica ni datos propios. No es un fallo; es lo que hay que subir, y abajo dice cómo.', verbo: 'no está claro si' },
};

/** La entrada de CERTEZA_EVIDENCIA para cualquier valor, también uno raro: nunca lanza. */
export function certezaDe(c: unknown): EtiquetaCerteza {
  return typeof c === 'string' && Object.hasOwn(CERTEZA_EVIDENCIA, c) ? CERTEZA_EVIDENCIA[c as CertezaEvidencia] : respaldoCerteza(typeof c === 'string' ? c : c === null || c === undefined ? 'sin nivel' : String(c));
}

export const DIRECCION_EVIDENCIA: Record<DireccionEvidencia, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' }> = {
  apoya: { etiqueta: 'La evidencia apoya la hipótesis', tono: 'ok' },
  mixta: { etiqueta: 'Evidencia mixta', tono: 'aviso' },
  en_contra: { etiqueta: 'La evidencia va en contra', tono: 'mal' },
  sin_evidencia_directa: { etiqueta: 'Sin evidencia directa', tono: 'borde' },
};

export const FACTOR_CERTEZA: Record<FactorCerteza, string> = {
  riesgo_de_sesgo: 'Riesgo de sesgo en los estudios',
  inconsistencia: 'Los estudios no coinciden',
  evidencia_indirecta: 'Evidencia de otra población, medida o contexto',
  imprecision: 'Pocos participantes o pocos estudios',
  sesgo_de_publicacion: 'Posible sesgo de publicación',
  efecto_grande: 'Efecto grande y consistente',
  gradiente: 'Relación dosis o tiempo con respuesta',
  replicacion_independiente: 'Replicado en cohortes independientes',
};

export const TIPO_AFIRMACION: Record<TipoAfirmacion, { etiqueta: string; nota: string }> = {
  dato: { etiqueta: 'Dato', nota: 'Sale de un análisis de datos (una celda de código).' },
  literatura: { etiqueta: 'Literatura', nota: 'Sale de una fuente publicada.' },
  interpretacion: { etiqueta: 'Interpretación', nota: 'Es una inferencia de ROSA2018 sobre datos o literatura. Es el tipo que más falla.' },
};

/** Etiqueta de un tipo de afirmacion aunque el servidor mande uno que esta
 *  interfaz no conoce (version nueva del backend): no se rompe la pantalla. */
export function tipoAfirmacion(t: string): { etiqueta: string; nota: string } {
  return (TIPO_AFIRMACION as Record<string, { etiqueta: string; nota: string }>)[t] ?? { etiqueta: t || 'sin tipo', nota: 'Tipo de afirmación que esta versión de la interfaz no conoce.' };
}

export const TIPO_HALLAZGO: Record<TipoHallazgo, string> = {
  cita_no_sostiene: 'La cita no sostiene la afirmación',
  doi_otro_articulo: 'El DOI resuelve a otro artículo',
  valor_contradice_fuente: 'Un valor contradice la fuente',
  resultado_sin_ejecutar: 'Resultado dado por calculado sin ejecutar nada',
  paso_sin_completar: 'Paso del plan sin completar',
  conclusion_no_sigue: 'La conclusión no se sigue del método',
  entidad_distinta: 'Dato de otra entidad',
  ausencia_refutada: 'Ausencia desmentida por las fuentes',
  sobreafirmacion: 'Afirma con más seguridad de la que da la evidencia',
  metrica_inventada: 'Métrica definida por ROSA2018 sin definición clara',
};

export const ESTADO_HALLAZGO: Record<EstadoHallazgo, string> = {
  abierto: 'Abierto',
  atendido: 'Atendido',
  no_aplica: 'No aplica',
};

export const TIPO_REVISION: Record<TipoRevisionAutomatica, { etiqueta: string; nota: string }> = {
  inicial: { etiqueta: 'Inicial', nota: 'Rápida, sin herramientas: corrección, calidad, novedad y seguridad a primera vista.' },
  completa: { etiqueta: 'Completa', nota: 'Con literatura: supuestos de la idea y su respaldo.' },
  profunda: { etiqueta: 'Verificación profunda', nota: 'Descompone la hipótesis en supuestos y sub-supuestos y evalua cada uno.' },
  observacion: { etiqueta: 'Observación', nota: 'Si explica observaciones previas mejor que las explicaciones existentes.' },
  simulacion: { etiqueta: 'Simulación', nota: 'Simula el mecanismo o el experimento paso a paso para encontrar donde fallaría.' },
  torneo: { etiqueta: 'Torneo', nota: 'Qué se le criticó en los debates con sus rivales.' },
};

export const ESTADO_SUPUESTO: Record<EstadoSupuesto, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'neutro' }> = {
  respaldado: { etiqueta: 'Respaldado', tono: 'ok' },
  plausible: { etiqueta: 'Plausible', tono: 'aviso' },
  sin_evidencia: { etiqueta: 'Sin evidencia', tono: 'neutro' },
  contradicho: { etiqueta: 'Contradicho', tono: 'mal' },
  no_evaluado: { etiqueta: 'No se pudo comprobar', tono: 'aviso' },
};

/** Qué quiere decir el estado de un supuesto (regla 3). Lo que va aquí es lo
 *  que distingue un "sin evidencia" que informa de uno que no. */
export const ALCANCE_SUPUESTO: Record<AlcanceSupuesto, string> = {
  resuelto: 'Una afirmación lo decide',
  tocado_sin_respuesta: 'Las fuentes tocan el tema, pero no lo resuelven',
  no_tocado: 'Las fuentes reunidas no hablan de esto',
  no_evaluado: 'No se pudo evaluar: no quiere decir que no haya',
};

/** Dónde estaría la respuesta a un supuesto. */
export const DONDE_SE_RESPONDE: Record<DondeSeResponde, string> = {
  literatura: 'en la literatura',
  catalogo_de_cohorte: 'en el catálogo de una cohorte',
  registro_de_ensayos: 'en un registro de ensayos',
  analisis_de_datos: 'analizando datos que ya existen',
  experimento_nuevo: 'con un experimento que nadie ha hecho',
};

export const TIPO_FUENTE: Record<TipoFuente, string> = {
  articulo: 'Artículo',
  preprint: 'Preprint',
  ensayo: 'Ensayo clínico',
  grafo: 'Grafo de conocimiento',
  base_curada: 'Base curada',
};

export const TIPO_ESTUDIO: Record<TipoEstudio, string> = {
  revision_sistematica: 'Revisión sistemática o metaanálisis',
  ensayo_aleatorizado: 'Ensayo aleatorizado',
  cohorte: 'Cohorte',
  caso_control: 'Casos y controles',
  transversal: 'Transversal',
  serie_de_casos: 'Serie de casos',
  preclinico: 'Preclínico (animal)',
  in_vitro: 'In vitro',
  revision_narrativa: 'Revisión narrativa',
  registro: 'Registro o informe institucional',
  otro: 'Otro',
};

export const NIVEL_EVIDENCIA: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Nivel 1: preclínico o in vitro',
  2: 'Nivel 2: opinión, revisión narrativa o serie de casos',
  3: 'Nivel 3: observacional (cohorte, casos y controles)',
  4: 'Nivel 4: ensayo aleatorizado o registro regulatorio',
  5: 'Nivel 5: revisión sistemática o metaanálisis',
};

export const CLASIFICACION_CITA: Record<ClasificacionCita, string> = {
  apoya: 'Apoya',
  menciona: 'Menciona',
  contrasta: 'Contrasta',
};

export const ESTADO_HECHO: Record<EstadoHecho, string> = {
  sabido: 'Lo que se sabe',
  abierto: 'Lo que está abierto',
  descartado: 'Lo que se descarto',
};

export const TIPO_HECHO: Record<TipoHecho, string> = {
  hecho: 'Hecho',
  hipotesis: 'Hipótesis',
  pregunta: 'Pregunta',
};

export const TIPO_ARTEFACTO: Record<TipoArtefacto, string> = {
  informe: 'Informe',
  tabla: 'Tabla',
  modelo_mundo: 'Modelo de mundo',
  figura: 'Figura',
  cuaderno: 'Cuaderno',
  specific_aims: 'Specific Aims (NIH)',
  dossier: 'Dossier para el laboratorio',
  prerregistro: 'Prerregistro',
};

/* ---------------------------------------------------------------------
   ROSA2018: Killer, decisiones, bloqueos, analisis, retorno, aprendizaje
   --------------------------------------------------------------------- */

/** Qué son dos hipótesis una respecto a la otra según el juez del torneo (fusión de ramas). */
export const RELACION_TORNEO: Record<'distintas' | 'equivalentes' | 'a_subsume_b' | 'b_subsume_a' | 'incompatibles', string> = {
  distintas: 'distintas',
  equivalentes: 'equivalentes: dicen lo mismo con otras palabras',
  a_subsume_b: 'una es un caso particular de la otra',
  b_subsume_a: 'una es un caso particular de la otra',
  incompatibles: 'incompatibles: no pueden ser ciertas a la vez',
};

export const DECISION_KILLER: Record<DecisionKiller, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde'; nota: string }> = {
  avanzar: { etiqueta: 'Avanza', tono: 'ok', nota: 'Pasa las comprobaciones críticas y tiene predicción falsable. Puede ser candidata al laboratorio.' },
  reformular: { etiqueta: 'Reformular', tono: 'aviso', nota: 'Falla algo arreglable (causalidad, falsabilidad, factibilidad o redundancia). ROSA2018 escribe una versión nueva y la vuelve a juzgar.' },
  suspender: { etiqueta: 'Suspendida', tono: 'borde', nota: 'Hace falta más o mejor evidencia antes de seguir: o falló una comprobación que suspende (riesgo de sesgo serio en toda la evidencia, sin fuente primaria, la diana no resuelve en las bases) o una comprobación crítica no se pudo hacer porque una fuente no respondió o falta el dato. El motivo exacto está en el registro de decisiones del Killer.' },
  descartar_en_contexto: { etiqueta: 'Descartar en este contexto', tono: 'mal', nota: 'La evidencia no la sostiene: citas que no resuelven, afirmaciones no sostenidas o un supuesto invalidante.' },
};

/** Texto de "pendiente de juicio" cuando la última pasada del Killer no fue un
 *  juicio sino una avería técnica (el modelo no respondió, la respuesta no se
 *  pudo leer). Señales, en este orden: la clave pública `killerPendiente` que
 *  escribe el servidor, o la nota de la última revisión del Killer diciendo que
 *  el juez no respondió mientras la decisión vigente sea "suspender". Null si
 *  la decisión que se ve es un juicio de verdad. Una avería no es un juicio
 *  científico: "no pude comprobar" nunca se enseña como "suspendida por la evidencia". */
export function killerPendienteDe(h: Pick<Hipotesis, 'decisionKiller'> & { killerPendiente?: unknown; revisiones?: unknown; procedencia?: unknown }): string | null {
  const marca = (h as { killerPendiente?: unknown }).killerPendiente;
  if (marca === true || (marca && typeof marca === 'object')) {
    const detalle = marca && typeof marca === 'object' ? String((marca as { motivo?: unknown }).motivo ?? '').trim() : '';
    return detalle ? `Pendiente de juicio: ${detalle}` : 'Pendiente de juicio: el modelo no respondió';
  }
  const revisiones = Array.isArray(h.revisiones) ? (h.revisiones as { accion?: unknown; nota?: unknown; fecha?: unknown }[]) : [];
  const ultima = [...revisiones].reverse().find((r) => r && typeof r === 'object' && r.accion === 'killer');
  // Fase de reintentos de S-09 (rosa/bucle/pasos.py _registrar_juez_sin_respuesta):
  // el servidor no registra decisión, conserva la anterior y deja un mensaje del
  // revisor "El juez del Killer no respondió (motivo técnico, intento N de M)".
  // Si ese mensaje es posterior a la última revisión del Killer, la decisión
  // que se ve (o la ausencia de decisión) no es un juicio nuevo.
  const procedencia = h.procedencia && typeof h.procedencia === 'object' ? (h.procedencia as { mensajes?: unknown }) : null;
  const mensajes = procedencia && Array.isArray(procedencia.mensajes) ? (procedencia.mensajes as { de?: unknown; texto?: unknown; creadoEn?: unknown }[]) : [];
  const aviso = [...mensajes].reverse().find((m) => m && typeof m === 'object' && m.de === 'revisor' && typeof m.texto === 'string' && /juez del Killer no respondi/i.test(m.texto));
  if (aviso && typeof aviso.creadoEn === 'number') {
    const fechaUltima = ultima && typeof ultima.fecha === 'number' ? ultima.fecha : Number.NEGATIVE_INFINITY;
    if (aviso.creadoEn > fechaUltima) return 'Pendiente de juicio: el modelo no respondió';
  }
  if (h.decisionKiller !== 'suspender') return null;
  const nota = ultima && typeof ultima.nota === 'string' ? ultima.nota : '';
  return /juez no respondi|modelo no respondi|no se puede dar por revisada/i.test(nota) ? 'Pendiente de juicio: el modelo no respondió' : null;
}

export const ETAPA_DECISION: Record<EtapaDecision, string> = {
  killer_1: 'Hypothesis Killer',
  killer_2: 'Auditor del análisis',
  priorizacion: 'Priorización',
  persona: 'Persona',
  retorno: 'Retorno del laboratorio',
};

export const COMPROBACION_KILLER: Record<string, string> = {
  citas_reales: 'Las citas resuelven a una fuente real',
  fidelidad_evidencia: 'La fuente dice lo que la afirmación dice',
  supuestos: 'Ningún supuesto necesario está contradicho',
  independencia_cohortes: 'Replicación en cohortes distintas',
  direccion_evidencia: 'La evidencia va en la dirección del enunciado',
  identificadores_resuelven: 'La diana resuelve a identificadores estables (Ensembl, UniProt)',
  unidades: 'Las cifras comparadas están en la misma unidad',
  fuente_primaria: 'Hay fuentes con datos propios, no solo citas',
  direccion_causal: 'La dirección causal tiene temporalidad y alternativa',
  falsabilidad: 'Hay una observación medible que la refutaría',
  novedad: 'Novedad comprobada con búsqueda',
  factibilidad: 'Existe cohorte, ensayo o técnica para comprobarla',
  redundancia: 'No repite lo ya sabido ni otra hipótesis viva',
  sesgo_evidencia: 'La evidencia no tiene un riesgo de sesgo serio',
  semilla: 'El código fija la semilla',
  fuga_de_datos: 'Sin fuga entre entrenamiento y prueba',
  coincide_con_plan: 'El código hace lo que dice el plan',
  baseline_y_control: 'Hay baseline y control negativo',
  tamano_muestral: 'El n por grupo basta',
  multiplicidad: 'La multiplicidad se corrigió',
  relevancia_prueba: 'La prueba responde a la pregunta',
  confusores: 'Los confusores tratados son razonables',
  interpretacion_no_sobrepasa: 'La interpretación no sobrepasa las cifras',
  contexto_humano: 'La diana se expresa en el tejido o la célula humana que la hipótesis nombra',
  unidades_y_escala: 'Unidades y escala plausibles',
};

export const RESULTADO_COMPROBACION: Record<'pasa' | 'falla' | 'no_aplica' | 'no_comprobable', { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' }> = {
  pasa: { etiqueta: 'Pasa', tono: 'ok' },
  falla: { etiqueta: 'Falla', tono: 'mal' },
  no_aplica: { etiqueta: 'No aplica', tono: 'borde' },
  no_comprobable: { etiqueta: 'No se pudo comprobar', tono: 'aviso' },
};

export const BLOQUEO: Record<Bloqueo, string> = {
  trazabilidad_insuficiente: 'Trazabilidad insuficiente',
  datos_no_autorizados: 'Datos no autorizados',
  analisis_invalido: 'Análisis inválido',
  sin_experimento_interpretable: 'Sin experimento interpretable',
  descartada_por_killer: 'Descartada en este contexto',
  fuente_retractada: 'Fuente retractada',
  revision_registro_abierta: 'Hallazgo grave del revisor sin atender',
  dependencia_pendiente: 'Depende de algo que cambió y no se revisó',
};

export const CLASE_EVIDENCIA: Record<ClaseEvidencia, { etiqueta: string; nota: string }> = {
  observacion_original: { etiqueta: 'Observación', nota: 'Medida directa: un dato de laboratorio o de un dataset con procedencia.' },
  derivado: { etiqueta: 'Derivado', nota: 'Calculado a partir de otros datos por código auditado.' },
  literatura: { etiqueta: 'Literatura', nota: 'Lo que afirma una fuente publicada.' },
  prediccion: { etiqueta: 'Predicción', nota: 'Salida de un modelo o dato sintético. Nunca cuenta como observación.' },
  conocimiento_operativo: { etiqueta: 'Conocimiento operativo', nota: 'Lo que el laboratorio sabe y no está publicado (protocolos, lotes, artefactos). No se mezcla con la literatura ni cuenta como observación.' },
};

export const ESTADO_EJECUCION: Record<Ejecucion['estado'], { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' | 'acento' }> = {
  no_ejecutado: { etiqueta: 'No ejecutado', tono: 'borde' },
  en_curso: { etiqueta: 'En curso', tono: 'acento' },
  error_tecnico: { etiqueta: 'Error técnico', tono: 'mal' },
  tiempo_agotado: { etiqueta: 'Tiempo agotado (error técnico)', tono: 'mal' },
  completado: { etiqueta: 'Ejecutado', tono: 'ok' },
};

export const INTERPRETACION_EJECUCION: Record<InterpretacionEjecucion, { etiqueta: string; tono: 'ok' | 'aviso' | 'borde' }> = {
  efecto_detectado: { etiqueta: 'Efecto detectado', tono: 'ok' },
  sin_efecto_detectable: { etiqueta: 'Sin efecto detectable', tono: 'aviso' },
  no_evaluable: { etiqueta: 'No evaluable con estos datos', tono: 'borde' },
};

export const VEREDICTO_AUDITORIA: Record<'valido' | 'no_valido' | 'no_evaluable_computacionalmente', { etiqueta: string; tono: 'ok' | 'mal' | 'borde' }> = {
  valido: { etiqueta: 'Análisis válido', tono: 'ok' },
  no_valido: { etiqueta: 'Análisis no válido', tono: 'mal' },
  no_evaluable_computacionalmente: { etiqueta: 'No evaluable computacionalmente', tono: 'borde' },
};

export const RUNTIME_EJECUCION: Record<Ejecucion['runtime'], string> = {
  docker: 'Contenedor Docker sin red',
  container: 'Micro-VM de Apple container sin red',
  local_sintetico: 'Aislamiento blando local (solo datos sintéticos)',
  ninguno: 'Sin runtime de aislamiento',
};

export const ESTADO_REPRODUCCION: Record<Reproduccion['estado'], { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' | 'acento' }> = {
  pendiente: { etiqueta: 'Pendiente', tono: 'borde' },
  en_curso: { etiqueta: 'En curso', tono: 'acento' },
  superada: { etiqueta: 'Reproducida dentro de tolerancia', tono: 'ok' },
  fallida: { etiqueta: 'Fuera de tolerancia', tono: 'mal' },
  error_tecnico: { etiqueta: 'Error técnico (no cuenta como fallo científico)', tono: 'aviso' },
};

export const RESULTADO_LABORATORIO: Record<ResultadoLaboratorio, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde'; nota: string }> = {
  apoyo_reproducido: { etiqueta: 'Apoyo reproducido', tono: 'ok', nota: 'Efecto en la dirección predicha, controles válidos, criterio cumplido.' },
  negativo_interpretable: { etiqueta: 'Negativo interpretable', tono: 'mal', nota: 'Controles válidos y potencia suficiente: el resultado va en contra.' },
  inconcluso: { etiqueta: 'Inconcluso', tono: 'aviso', nota: 'Controles válidos pero potencia insuficiente o intervalo que cruza el efecto mínimo.' },
  fallo_tecnico: { etiqueta: 'Fallo técnico', tono: 'borde', nota: 'El ensayo no se ejecutó como se prerregistro o un control fallo. No toca la hipótesis.' },
  toxicidad_inviabilidad: { etiqueta: 'Toxicidad o inviabilidad', tono: 'mal', nota: 'El modelo no toleró la intervención o no hubo exposición en el tejido.' },
  correccion_contexto: { etiqueta: 'Corrección de contexto', tono: 'aviso', nota: 'El efecto existe pero en otra variable, tejido, etapa o población: nace una hipótesis derivada.' },
};

export const NIVEL_APRENDIZAJE: Record<NivelAprendizaje, { etiqueta: string; nota: string }> = {
  1: { etiqueta: 'Nivel 1: creencias', nota: 'Qué cree ROSA2018 de cada hipótesis. Automático y registrado; reversible reabriendo la hipótesis.' },
  2: { etiqueta: 'Nivel 2: como razona', nota: 'Criterios de revisión y programas optimizados. ROSA2018 propone, se evalua sobre el conjunto reservado y una persona promueve o revierte.' },
  3: { etiqueta: 'Nivel 3: políticas', nota: 'Los límites del sistema. Solo los cambia una persona, en el código o eximiendo una puerta con motivo.' },
};

export const ESTADO_APRENDIZAJE: Record<CambioAprendizaje['estado'], { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' | 'acento' }> = {
  aplicado: { etiqueta: 'Aplicado', tono: 'ok' },
  propuesto: { etiqueta: 'Propuesto', tono: 'acento' },
  evaluado: { etiqueta: 'Evaluado', tono: 'aviso' },
  promovido: { etiqueta: 'Promovido', tono: 'ok' },
  revertido: { etiqueta: 'Revertido', tono: 'mal' },
};

export const TIPO_APRENDIZAJE: Record<CambioAprendizaje['tipo'], string> = {
  creencia: 'Creencia sobre una hipótesis',
  criterio: 'Criterio de revisión',
  programa: 'Programa optimizado (GEPA)',
  politica: 'Política',
  modelo_de_mundo: 'Modelo de mundo',
  hipotesis_derivada: 'Hipótesis derivada',
};

export const ACCESO_DATASET: Record<ProcedenciaDataset['acceso'], string> = {
  abierto: 'Abierto',
  controlado: 'Controlado (acuerdo de uso)',
  colaboracion: 'Por colaboración',
  propio: 'Propio del laboratorio',
};

export const USO_IA: Record<ProcedenciaDataset['usoIAAutorizado'], { etiqueta: string; tono: 'ok' | 'mal' | 'aviso' }> = {
  si: { etiqueta: 'Uso con IA autorizado', tono: 'ok' },
  no: { etiqueta: 'Uso con IA no autorizado', tono: 'mal' },
  desconocido: { etiqueta: 'Uso con IA sin confirmar', tono: 'aviso' },
};

export const CATEGORIA_CASO: Record<CategoriaCaso, string> = {
  single_hop: 'Un dato',
  multi_hop: 'Varios documentos',
  tabla: 'Tabla',
  abstencion: 'Debe abstenerse',
  entidad: 'Trampa de entidad',
};

export const ESTADO_CASO: Record<EstadoCaso, string> = {
  propuesto: 'Por revisar',
  aprobado: 'Aprobado',
  descartado: 'Descartado',
};

export const CLASIFICACION_DATOS: Record<ClasificacionDatos, string> = {
  publico: 'Público',
  interno: 'Interno',
  personas: 'Datos de personas',
};

export const TIPO_EVENTO: Record<TipoEvento, string> = {
  iteracion_terminada: 'Iteración',
  hipotesis_nueva: 'Hipótesis nueva',
  hipotesis_decidida: 'Decisión',
  ranking_cambio: 'Ranking',
  permiso_pendiente: 'Permiso',
  permiso_resuelto: 'Permiso',
  incidencia: 'Incidencia',
  presupuesto: 'Presupuesto',
  corrida_estado: 'Corrida',
  vigilancia: 'Vigilancia de literatura',
  vivero: 'Vivero de ideas',
  revision_registro: 'Revisor de registro',
  hecho_nuevo: 'Modelo de mundo',
  retraccion: 'Retractación',
  literatura_nueva: 'Literatura nueva',
  revision_automatica: 'Revisor',
  killer: 'Hypothesis Killer',
  analisis: 'Análisis con datos',
  aprendizaje: 'Aprendizaje',
  mision: 'Misión',
  dependencias: 'Recálculo por cambio de fuente',
  modelo_sin_respuesta: 'Modelo sin respuesta',
  modelo_recuperado: 'Modelo recuperado',
  etapa_incumplida: 'Una etapa no produjo lo suyo',
};

export const PASO_RUTA: Record<PasoRutaTerapeutica, { etiqueta: string; orden: number }> = {
  mecanismo: { etiqueta: 'Mecanismo', orden: 1 },
  opciones_intervencion: { etiqueta: 'Opciones de intervención', orden: 2 },
  compromiso_diana: { etiqueta: 'Compromiso de diana', orden: 3 },
  efecto_funcional: { etiqueta: 'Efecto funcional', orden: 4 },
  selectividad_toxicidad: { etiqueta: 'Selectividad y toxicidad', orden: 5 },
  exposicion: { etiqueta: 'Entrega y exposición', orden: 6 },
  replicacion_independiente: { etiqueta: 'Replicación independiente', orden: 7 },
  evidencia_poblacion: { etiqueta: 'Evidencia en la población', orden: 8 },
};

export const ESTADO_METODO: Record<MetodoRegistrado['estado'], { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' | 'acento' }> = {
  propuesto: { etiqueta: 'Propuesto', tono: 'borde' },
  implementado: { etiqueta: 'Implementado, sin probar en contexto', tono: 'aviso' },
  probado_en_contexto: { etiqueta: 'Probado en contexto', tono: 'ok' },
  restringido: { etiqueta: 'Restringido', tono: 'mal' },
  retirado: { etiqueta: 'Retirado', tono: 'mal' },
};

export const TIPO_METODO: Record<MetodoRegistrado['tipo'], string> = {
  analisis: 'Método de análisis',
  predictor: 'Predictor',
  recurso_datos: 'Recurso de datos',
  ensayo_laboratorio: 'Ensayo de laboratorio',
  busqueda: 'Búsqueda y recuperación',
  revision: 'Revisión y verificación',
};

export const NIVEL_MEDICION: Record<NonNullable<Afirmacion['nivelMedicion']>, string> = {
  medida: 'Medida directa',
  resultado_analisis: 'Resultado de un análisis',
  interpretacion_autor: 'Interpretación de los autores',
  interpretacion_rosa: 'Interpretación de ROSA2018',
};

export const DIMENSION_RESULTADO: Record<keyof Omit<DimensionesResultado, 'nota'>, string> = {
  falloTecnico: 'Fallo técnico',
  inconcluso: 'Inconcluso',
  efectoPequenoInterpretable: 'Efecto pequeño interpretable',
  efectoPredicho: 'Efecto predicho',
  efectoInesperado: 'Efecto inesperado',
  toxicidad: 'Toxicidad',
};

export const IDENTIFICACION_CAUSAL: Record<string, string> = {
  identificable: 'Identificable',
  acotado: 'Acotado: faltan supuestos',
  sin_resolver: 'Sin resolver',
};

export const TIPO_ARISTA: Record<string, string> = {
  supuesto: 'supuesto',
  inferencia_con_evidencia: 'inferencia con evidencia',
  base_curada: 'base curada',
};

export const GRUPO_CONECTOR: Record<string, string> = {
  genomas: 'Genomas',
  genes_ontologias: 'Genes y ontologías',
  variantes: 'Variantes',
  genetica_humana: 'Genética humana',
  genomica_clinica: 'Genómica clínica',
  expresion: 'Expresión',
  regulacion: 'Regulación',
  proteinas: 'Anotación de proteínas',
  estructuras: 'Estructuras e interacciones',
  rna: 'RNA',
  omicas: 'Archivos ómicos',
  cancer: 'Modelos de cáncer',
  quimica: 'Química',
  regulatorio: 'Regulación de fármacos',
  farmacos: 'Fármacos y dianas',
  enriquecimiento: 'Enriquecimiento de conjuntos de genes',
  literatura: 'Literatura',
  recursos: 'Recursos de investigación',
  directorio: 'Conectores del directorio',
  socios: 'Socios y plataformas',
  alzheimer: 'Específicos del Alzheimer',
  otros: 'Otros',
};

export const ESTADO_CONECTOR: Record<string, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'neutro' }> = {
  disponible: { etiqueta: 'Disponible', tono: 'ok' },
  requiere_cuenta: { etiqueta: 'Requiere cuenta', tono: 'aviso' },
  sin_api: { etiqueta: 'Sin API', tono: 'neutro' },
  licencia: { etiqueta: 'Licencia', tono: 'mal' },
  fichero_local: { etiqueta: 'Fichero local', tono: 'neutro' },
};

export const CLASE_HALLAZGO_REGISTRO: Record<string, string> = {
  calculo_no_ejecutado: 'Cálculo que no se ejecutó',
  contradiccion_con_registro: 'Contradice el registro',
  cita_sin_soporte: 'Cita sin soporte',
  identificador_no_coincide: 'Identificador que no coincide',
  paso_incompleto: 'Paso del plan incompleto',
  conclusion_no_sigue: 'La conclusión no se sigue del método',
  cifra_fuera_de_contexto: 'Cifra dicha de otra cosa',
  cuenta_que_no_cuadra: 'Una cuenta que no sale',
  etapa_incumplida: 'Una etapa que no produjo lo suyo',
};

/** Juicios de riesgo de sesgo por instrumento (RoB 2 y familia). */
export const RIESGO_SESGO: Record<string, { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' }> = {
  bajo: { etiqueta: 'riesgo bajo', tono: 'ok' },
  algunas_dudas: { etiqueta: 'algunas dudas', tono: 'aviso' },
  alto: { etiqueta: 'riesgo alto', tono: 'mal' },
  no_aplica: { etiqueta: 'no aplica', tono: 'borde' },
};

/** Estado de cada paso de la ruta terapéutica calculado por regla
 *  (rosa/ruta.py ETIQUETAS_ESTADO). "No comprobable" es una fuente que no
 *  respondió o un dato que no llegó: no es "vacío". El símbolo va delante de
 *  la etiqueta del paso porque no se crean clases CSS nuevas para pintarlo. */
export const ESTADO_PASO_RUTA: Record<EstadoPasoRuta, { etiqueta: string; simbolo: string; tono: 'ok' | 'aviso' | 'mal' | 'borde'; definicion: string }> = {
  cubierto: { etiqueta: 'cubierto', simbolo: '●', tono: 'ok', definicion: 'Hay evidencia sostenida que cubre este paso (afirmaciones verificadas, un análisis válido, un retorno del laboratorio o un hecho del modelo de mundo).' },
  parcial: { etiqueta: 'parcial', simbolo: '◐', tono: 'aviso', definicion: 'Hay algo que toca el paso, pero no basta: una sola cohorte, una afirmación sin verificar, un dato sin la unidad o el n que la regla pide.' },
  vacio: { etiqueta: 'vacío', simbolo: '○', tono: 'mal', definicion: 'Nada de lo reunido toca este paso. Es un hueco, no una refutación.' },
  no_comprobable: { etiqueta: 'no comprobable', simbolo: '?', tono: 'borde', definicion: 'No se pudo comprobar: una fuente no respondió o el registro no trae el dato. No es lo mismo que vacío.' },
};

/** Una frase por paso de la ruta, para quien la lee por primera vez (rosa/ruta.py DEFINICIONES_PASO). */
export const DEFINICION_PASO_RUTA: Record<PasoRutaTerapeutica, string> = {
  mecanismo: 'qué proceso biológico explica el efecto y con qué evidencia',
  opciones_intervencion: 'con qué se podría actuar sobre la diana (fármaco, anticuerpo, modulación) y en qué dirección',
  compromiso_diana: 'que la intervención o la medida llega a la diana y la cambia de forma medible',
  efecto_funcional: 'que cambiar la diana cambia algo que importa: cognición, síntomas, función celular',
  selectividad_toxicidad: 'que el efecto es sobre la diana y no sobre otras, y qué daño produce',
  exposicion: 'que el fármaco o el marcador llega a donde tiene que llegar (sangre, LCR, cerebro), con qué dosis y cuánto tiempo',
  replicacion_independiente: 'que el efecto se ha visto en al menos dos cohortes distintas (grupos de personas estudiados por separado)',
  evidencia_poblacion: 'que hay estudios primarios en personas (cohortes, casos y controles, transversales o ensayos) con al menos 50 participantes',
};

/** Las seis capas del perfil de una diana, con la pregunta que responde cada
 *  una (rosa/dianas.py ETIQUETAS_CAPA y PREGUNTA_CAPA). El orden es el de la
 *  tabla. */
export const CAPA_DIANA: Record<CapaDiana, { etiqueta: string; pregunta: string }> = {
  genetica_humana: { etiqueta: 'Genética humana', pregunta: '¿la genética humana vincula el gen con el Alzheimer?' },
  expresion_tejido: { etiqueta: 'Expresión en tejido', pregunta: '¿se expresa en tejido cerebral humano?' },
  expresion_celular: { etiqueta: 'Expresión por tipo celular', pregunta: '¿en qué tipos celulares se expresa?' },
  proteina_funcion: { etiqueta: 'Proteína y función', pregunta: '¿qué hace la proteína y con quién actúa?' },
  farmacologia: { etiqueta: 'Farmacología', pregunta: '¿hay fármacos que la tocan?' },
  literatura: { etiqueta: 'Literatura', pregunta: '¿cuántas publicaciones la relacionan con el Alzheimer?' },
};
export const ORDEN_CAPAS_DIANA: CapaDiana[] = ['genetica_humana', 'expresion_tejido', 'expresion_celular', 'proteina_funcion', 'farmacologia', 'literatura'];

/** Estado de una capa del perfil (rosa/dianas.py ESTADOS): una base que no
 *  respondió es "no pude comprobar", nunca "ausente". */
export const ESTADO_CAPA_DIANA: Record<EstadoCapaDiana, { etiqueta: string; tono: 'ok' | 'aviso' | 'borde'; definicion: string }> = {
  presente: { etiqueta: 'presente', tono: 'ok', definicion: 'Alguna base consultada trae registro para esta capa.' },
  ausente: { etiqueta: 'ausente', tono: 'borde', definicion: 'Las bases respondieron y no tienen nada para esta capa.' },
  no_pude_comprobar: { etiqueta: 'no pude comprobar', tono: 'aviso', definicion: 'La base no respondió, no trae el dato o la diana no resolvió: no se sabe, que no es lo mismo que ausente.' },
};

/** Lectura de la dirección del efecto genético (rosa/dianas.py ETIQUETAS_DIRECCION). */
export const DIRECCION_GENETICA: Record<'+' | '-', string> = {
  '+': '+ (más función de la diana, más riesgo)',
  '-': '- (menos función de la diana, más riesgo)',
};

/** Las ramas de un negativo cuando el contrato separa la lectura de compromiso
 *  de diana de la de efecto (rosa/experimento.py lectura_del_negativo). */
export const RAMA_NEGATIVO: Record<RamaNegativo, { etiqueta: string; definicion: string }> = {
  diana_comprometida_sin_efecto: { etiqueta: 'La diana se tocó y el efecto no apareció', definicion: 'El negativo cuestiona el mecanismo: la intervención llegó a la diana y aun así no pasó lo que la hipótesis predice.' },
  diana_no_comprometida: { etiqueta: 'La diana no se tocó', definicion: 'El negativo cuestiona el ensayo, no la hipótesis: la intervención no llegó a la diana, así que el efecto no podía aparecer.' },
  sin_lecturas_separadas: { etiqueta: 'Sin lecturas separadas', definicion: 'El contrato no separó compromiso de diana y efecto, así que no se puede saber cuál de las dos ramas explica el negativo.' },
};

/** El nombre visible de quien firma una acción. En el estado el autor de la IA
 *  se guarda como 'Rosa' (identificador de datos, con cientos de registros);
 *  en pantalla el producto se llama ROSA2018 (petición de Emir, 18 de septiembre
 *  de 2026). Las personas y los modelos se muestran tal cual. */
export function nombreActor(quien: unknown): string {
  const q = typeof quien === 'string' ? quien.trim() : '';
  return q === 'Rosa' ? 'ROSA2018' : q;
}

/** El texto visible de un evento, hito o pista tal como lo guardó el estado.
 *  Los registros antiguos dicen "Rosa propone..." o "Rosa" como autora; en
 *  pantalla el producto se llama ROSA2018, así que la palabra Rosa (entera, con
 *  mayúscula) se sustituye solo al mostrar. El dato guardado no se toca. */
export function mostrarTexto(texto: unknown): string {
  const t = typeof texto === 'string' ? texto : '';
  return t.replace(/(?<![\wáéíóúñÁÉÍÓÚÑ])Rosa(?![\wáéíóúñÁÉÍÓÚÑ])/g, 'ROSA2018');
}
