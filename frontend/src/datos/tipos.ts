// Tipos del dominio de ROSA2018, tal como los consume la interfaz.
//
// Son el contrato entre las pantallas y el almacen (almacen.ts). Hoy el
// almacen sirve datos de muestra y una corrida simulada; cuando entre el
// almacen real (Convex o Postgres con suscripciones, decision pendiente de
// la persona responsable y su companero) estas formas son las que tiene que devolver, y las
// pantallas no cambian.
//
// Nombres en espanol y en camelCase, como en el esquema del RAG. Los estados
// son uniones cerradas: la interfaz pinta cada uno con su texto y su color, y
// un estado nuevo tiene que anadirse aqui y en su etiqueta, no colarse como
// cadena libre.
//
// La segunda tanda de campos (presupuesto global, incidencias, plan por
// aprobar, tipo de afirmacion, cobertura, partidos, supuestos, panorama,
// autonomia, datasets, procesos, experimentos) sale de
// INVESTIGACION-INTERFACES.md: lo que hacen Claude Science, Kosmos,
// Co-Scientist, Biomni y las herramientas de literatura y ROSA2018 no tenia.

export type Id = string;

/* ---------------------------------------------------------------------
   Investigacion y corrida
   --------------------------------------------------------------------- */

export type EstadoInvestigacion = 'activa' | 'pausada' | 'cerrada';

/** El objetivo parseado, como la "research plan configuration" de
 *  Co-Scientist: alimenta los prompts de generacion, revision y debate. */
export interface ConfiguracionObjetivo {
  preferencias: string;
  atributos: string[];
  restricciones: string[];
  /** Cuánto explora ROSA2018 fuera de la pregunta en cada paso de literatura:
   *  enfocada (nada), equilibrada (un tercio de las consultas), amplia (la
   *  mitad). Ausente en investigaciones anteriores: equilibrada. */
  amplitud?: Amplitud;
}

export type Amplitud = 'enfocada' | 'equilibrada' | 'amplia';

/** Por qué modo llegó una consulta o una fuente: foco (la pregunta de la
 *  corrida y el peldaño de cada hipótesis) o amplitud (explorar alrededor). */
export type ModoBusqueda = 'foco' | 'amplitud';

export type ClasificacionDatos = 'publico' | 'interno' | 'personas';

/** Clase de evidencia del libro de procedencia (ROSA2018, etapa 1): una
 *  observacion medida, un dato derivado de otro, lo que afirma un articulo,
 *  o una prediccion de un modelo. No se suman entre si. */
export type ClaseEvidencia = 'observacion_original' | 'derivado' | 'literatura' | 'prediccion' | 'conocimiento_operativo';

/** Una columna del diccionario de datos. */
export interface ColumnaDiccionario {
  columna: string;
  descripcion: string;
  tipo: 'numerica' | 'categorica' | 'fecha' | 'texto' | 'identificador';
  unidad: string;
}

/** El libro de procedencia de un dataset: de donde salio, con que version,
 *  licencia y permisos, su hash para fijarlo, su diccionario, si se autorizo
 *  el uso con IA y si es sintetico. Sin esto un dato no entra a un analisis. */
export interface ProcedenciaDataset {
  origen: string;
  version: string;
  licencia: string;
  permisos: string;
  fechaObtencion: number | null;
  /** sha256 del fichero tal como se subio. Un hash distinto es otro dataset. */
  hash: string;
  fichero: string | null;
  filas: number;
  diccionario: ColumnaDiccionario[];
  usoIAAutorizado: 'si' | 'no' | 'desconocido';
  /** Un dato sintetico se etiqueta siempre; nunca cuenta como observacion. */
  sintetico: boolean;
  clase: ClaseEvidencia;
  /** Cohorte de origen, para detectar que dos fuentes reutilizan la misma. */
  cohorte: string;
  /** Si filas individuales pueden salir hacia un modelo de terceros (el AI
   *  Gateway). Nace en falso: el NIH (NOT-OD-25-081) y los acuerdos de A4 y
   *  del AD Knowledge Portal lo prohiben para datos controlados. Con falso,
   *  al modelo solo llegan agregados y salidas del codigo. */
  permiteLlmTerceros: boolean;
  /** Texto literal de la clausula de IA del acuerdo de uso, si la hay. */
  restriccionIA: string;
  acceso: 'abierto' | 'controlado' | 'colaboracion' | 'propio';
  /** Columnas y filas detectadas al subir, y valores centinela por columna. */
  columnas: string[];
}

/** Un conjunto de datos adjunto a la investigacion, con su contrato de
 *  datos: la comprobacion previa que evita que un p-valor guardado como 0
 *  contamine horas de corrida (fallo documentado en Kosmos). */
export interface Dataset {
  id: Id;
  nombre: string;
  descripcion: string;
  tamanoMb: number;
  columnas: number;
  columnasSinDiccionario: number;
  valoresCentinela: number;
  nombresDuplicados: number;
  clasificacion: ClasificacionDatos;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  origen: 'subida' | 'catalogo';
  /** El libro de procedencia. Los datasets del catalogo lo traen vacio hasta que se sube el fichero. */
  procedencia?: ProcedenciaDataset | null;
  /** Id del registro en `estado.datasetsPrograma` que rosa/estado/acciones.py escribe al subir el fichero (`_registrar_en_programa`); lo usa para no duplicar el registro cuando después se escribe el origen. Ausente en datasets anteriores. */
  registroProgramaId?: string | null;
}

/** Un area de investigacion propuesta por el planificador a partir de la
 *  meta amplia (plan completo ROSA2018, seccion 1). Se comparan por
 *  relevancia, valor de intervencion, incertidumbre, comprobabilidad, coste,
 *  demora y dependencia; se conservan familias de mecanismo distintas y se
 *  anotan las que quedan sin explorar. */
export interface AreaInvestigacion {
  id: Id;
  titulo: string;
  familiaMecanismo: string;
  relevancia: string;
  valorIntervencion: string;
  incertidumbre: string;
  comprobabilidad: string;
  coste: string;
  demora: string;
  dependeDe: string;
  estado: 'propuesta' | 'elegida' | 'pausada' | 'sin_explorar';
  /** Si se pauso, con que condicion se reabre. */
  condicionReapertura: string;
  /** La campana (corrida) que trabaja esta area, si se asigno. */
  corridaId?: Id | null;
  /** Cada cambio de estado o de campana, con fecha, autor y motivo. */
  historial?: { fecha: number; de: EstadoArea; a: EstadoArea; quien: string; motivo: string }[];
}

export type EstadoArea = AreaInvestigacion['estado'];

/** La pregunta concreta de una campana (corrida), con la plantilla del plan
 *  completo: en el contexto C y la etapa S, la intervencion A cambia el
 *  desenlace P en el tiempo T frente al comparador B, y el experimento
 *  distingue M1 de M2. El umbral de efecto puede quedar "sin resolver". */
export interface PreguntaCampana {
  contexto: string;
  etapa: string;
  intervencion: string;
  comparador: string;
  desenlace: string;
  ventana: string;
  unidadBiologica: string;
  mecanismos: string;
  decision: string;
  umbralEfecto: string;
  umbralResuelto: boolean;
  /** Paso de la ruta terapeutica al que sirve la campana. */
  pasoRuta: PasoRutaTerapeutica;
  propuestaPorRosa: boolean;
  aprobadaEn: number | null;
}

/** La ruta terapeutica explicita del plan completo (seccion 10). Una
 *  campana celular completada no completa la ruta. */
export type PasoRutaTerapeutica = 'mecanismo' | 'opciones_intervencion' | 'compromiso_diana' | 'efecto_funcional' | 'selectividad_toxicidad' | 'exposicion' | 'replicacion_independiente' | 'evidencia_poblacion';

/** Estado de un paso de la ruta calculado por regla (rosa/ruta.py): cubierto, parcial, vacío o no comprobable (una fuente que no respondió no es "no hay"). */
export type EstadoPasoRuta = 'cubierto' | 'parcial' | 'vacio' | 'no_comprobable';

/** De dónde sale una pieza de evidencia de un paso de la ruta (rosa/ruta.py): afirmación verificada, ejecución in silico, retorno del laboratorio, hecho del modelo de mundo o fuente. */
export type TipoEvidenciaRuta = 'afirmacion' | 'ejecucion' | 'laboratorio' | 'hecho' | 'fuente';

/** Una pieza de evidencia que sostiene un paso de la ruta (rosa/ruta.py): tipo, id del registro y texto recortado a 200 caracteres. */
export interface EvidenciaPasoRuta {
  tipo: TipoEvidenciaRuta;
  id: string;
  texto: string;
}

/** Un paso de la ruta terapéutica con su estado, su evidencia (hasta 10 piezas) y el motivo por regla (rosa/ruta.py). */
export interface PasoRutaEvaluado {
  paso: PasoRutaTerapeutica;
  estado: EstadoPasoRuta;
  evidencia: EvidenciaPasoRuta[];
  motivo: string;
}

/** La ruta terapéutica de una hipótesis calculada por regla (rosa/ruta.py evaluar_ruta): los ocho pasos en orden, el siguiente sin cubrir, cuántos están cubiertos, el paso que declara la tarjeta y si es coherente con la evidencia. */
export interface RutaTerapeuticaEvaluada {
  hipotesisId: Id | null;
  pasos: PasoRutaEvaluado[];
  /** Primer paso no cubierto; null si los ocho lo están. */
  siguiente: PasoRutaTerapeutica | null;
  cubiertos: number;
  /** tarjeta.pasoRuta (mecanismo si la tarjeta no lo trae); null sin tarjeta. Puede traer un texto fuera de la ruta si la tarjeta lo declaró mal. */
  declarado: PasoRutaTerapeutica | string | null;
  /** Falso si el paso declarado va por delante del primer paso vacío. */
  coherente: boolean;
  motivoCoherencia: string;
  porEstado: Record<EstadoPasoRuta, number>;
  /** El resumen en llano, generado por regla. */
  resumen: string;
}

/** Una celda del mapa de la ruta (rosa/ruta.py mapa_ruta): hipótesis que cubren el paso, parciales, hechos que lo tocan y certeza GRADE máxima. */
export interface CeldaMapaRuta {
  hipotesis: number;
  parciales: number;
  hechos: number;
  certezaMax: CertezaEvidencia | null;
}

/** Una fila del mapa de la ruta (rosa/ruta.py mapa_ruta): una diana o proceso canónico con sus hipótesis vivas, una celda por paso y los pasos huecos. */
export interface FilaMapaRuta {
  clave: string;
  etiqueta: string;
  hipotesis: Id[];
  pasos: Record<PasoRutaTerapeutica, CeldaMapaRuta>;
  huecos: PasoRutaTerapeutica[];
  hechos: number;
}

/** La vista de programa de la ruta terapéutica (rosa/ruta.py mapa_ruta; GET /api/investigaciones/{id}/ruta): filas por diana de más a menos pasos cubiertos y resumen en llano; fecha e iteración solo cuando se guardó en la investigación. */
export interface MapaRuta {
  investigacionId: Id;
  filas: FilaMapaRuta[];
  resumen: string;
  fecha?: number;
  iteracion?: number;
}

/** Roles del programa (plan completo, seccion 12). Se pueden combinar, pero
 *  quien escribe una conclusion no es su unico evaluador. */
export interface Responsables {
  patrocinador: string;
  liderCientifico: string;
  metodos: string;
  datos: string;
  ingenieria: string;
  laboratorio: string;
  evaluacion: string;
}

/** La mision cientifica (DiseaseMission en ROSA2018; "programme charter" en
 *  el plan completo): lo que fija el marco antes de la primera corrida. ROSA2018
 *  propone valores a partir del objetivo y una persona los aprueba. Lo que
 *  no se sabe queda "sin fijar": un recurso desconocido no se trata como
 *  disponible ni un permiso desconocido como concedido. */
export interface Mision {
  poblacion: string;
  etapa: string;
  celulaTejido: string;
  mecanismo: string;
  tipoIntervencion: string;
  capacidadesLaboratorio: string[];
  /** Presupuesto en llamadas al modelo, dolares estimados y horas de reloj. */
  presupuesto: { llamadas: number; usd: number; horas: number };
  propuestaPorRosa: boolean;
  aprobadaEn: number | null;
  aprobadaPor: string | null;
  /** Meta amplia del programa, si el objetivo escrito es la campana y no la meta. */
  metaAmplia?: string;
  /** Areas de investigacion propuestas por el planificador, con su comparacion. */
  areas?: AreaInvestigacion[];
  /** Acciones permitidas sin volver a preguntar, y las que siempre preguntan. */
  accionesPermitidas?: string[];
  responsables?: Responsables;
}

/** Puerta de reproduccion (ROSA2018, etapa 2): el modulo de analisis con
 *  datos no descubre nada hasta reproducir N analisis publicados dentro de
 *  tolerancia. Una persona puede eximirla dejando el motivo. */
export interface PuertaReproduccion {
  requeridas: number;
  superadas: number;
  estado: 'bloqueada' | 'abierta' | 'eximida';
  eximidaPor: string | null;
  motivo: string;
  fecha: number | null;
}

export interface Investigacion {
  id: Id;
  titulo: string;
  objetivo: string;
  /** Que cuenta como relevante para esta investigacion, en una frase. */
  relevancia: string;
  limites: string[];
  condicionParada: string;
  /** Que parte de la condicion mide ROSA2018 sola (iteraciones, tiempo, llamadas)
   *  y que parte queda para que la decida una persona. Espejo de rosa/parada.py. */
  condicionParadaAutomatizada?: CondicionAutomatizada;
  revisores: string[];
  estado: EstadoInvestigacion;
  creadaEn: number;
  /** Id de la investigacion de la que se bifurco, si es una rama. */
  ramaDe: Id | null;
  configuracion: ConfiguracionObjetivo;
  datasets: Dataset[];
  /** Hasta cuando vigilar la literatura tras cerrar la corrida. Null = no. */
  vigilarLiteraturaHasta: number | null;
  /** La mision estructurada. Falta en investigaciones anteriores a septiembre de 2026. */
  mision?: Mision | null;
  /** Memoria del proyecto: hechos cortos y estables fijados por personas que
   *  ROSA2018 lee en cada mision (preferencias, restricciones, decisiones). */
  memoria?: MemoriaProyecto[];
  /** Conocimiento tacito del laboratorio, con clase de evidencia propia. */
  conocimientoOperativo?: ConocimientoOperativo[];
  /** Preguntas con herramientas hechas desde la interfaz, con sus consultas. */
  preguntasABases?: PreguntaABases[];
  puertaReproduccion?: PuertaReproduccion;
  /** Vivero de ideas: propuestas de ROSA2018 que todavía no tienen evidencia para
   *  nacer como hipótesis (certeza baja por regla: dos cohortes distintas).
   *  La acumulación de evidencia las alimenta en cada cierre de iteración. */
  vivero?: Semilla[];
  /** Ideas que salieron del vivero sin nacer, con su motivo: no se reproponen. */
  viveroRetiradas?: { id: Id; titulo: string; enunciado: string; motivo: string; iteracion: number | null; retiradaEn: number }[];
  /** Mapa del estado de la enfermedad (rosa/mapa_enfermedad.py), guardado al cerrar cada iteración. Null o ausente si no se calculó. */
  mapaEnfermedad?: MapaEnfermedad | null;
  /** Vista de programa de la ruta terapéutica por diana (rosa/ruta.py mapa_ruta). Null o ausente si no se guardó. */
  mapaRuta?: MapaRuta | null;
  /** Las tres cifras de aprendizaje (rosa/cifras_aprendizaje.py): acierto prerregistrado, tiempo hasta decidir y reutilización de lo heredado. */
  cifrasAprendizaje?: CifrasAprendizaje | null;
}

/** Una lección: lo que la investigación aprendió a no repetir, generada por
 *  regla al cerrar cada iteración (rosa/lecciones.py) y leída por cada paso. */
export interface Leccion {
  id: Id;
  investigacionId: Id;
  ambito: 'plan' | 'consultas' | 'fuentes' | 'hipotesis' | 'analisis' | 'resumen';
  texto: string;
  origen: string;
  corridaId: Id | null;
  iteracion: number | null;
  creadaEn: number;
  ultimaVez: number;
  veces: number;
}

/** Una idea en el vivero: la propuesta completa, lista para nacer sin volver
 *  a llamar al modelo, más lo que le falta. */
export interface Semilla {
  id: Id;
  investigacionId: Id;
  titulo: string;
  enunciado: string;
  mecanismo: string;
  comprobacion: { biomarcador: string; cohorte: string; diseno: string };
  cluster: string;
  justificacion: string;
  supuestos: string[];
  afirmaciones: Afirmacion[];
  fuentes: Fuente[];
  creadaEn: number;
  actualizadaEn: number;
  /** Iteración en la que se propuso. */
  iteracion: number;
  /** Por qué no nació (el techo de certeza por regla). */
  motivo: string;
  /** Qué le falta para nacer, por regla. */
  falta: string;
  historial: string[];
}

export type EstadoCorrida =
  | 'en_marcha'
  | 'pausada'
  | 'pausada_por_presupuesto'
  | 'esperando_aprobacion'
  | 'esperando_plan'
  /** Un modelo del gateway (el cerebro, el juez) no responde: ROSA2018 sondea cada
   *  minuto y retoma sola. No es espera humana: su tiempo va a `pausaMs`. */
  | 'esperando_modelo'
  | 'detenida'
  | 'terminada';

/** Los roles que ocupan los modelos del gateway dentro de ROSA2018. El cerebro es
 *  GPT-6 Astra y solo Astra; el juez es Claude Opus 5 y solo Opus; Sonnet queda
 *  para el volumen (regla de Emir, TRASPASO.md 7.4). */
export type RolModelo = 'cerebro' | 'juez' | 'volumen' | 'replica';

/** Lo que espera una corrida en `esperando_modelo`: qué rol y qué modelo no
 *  responden, desde cuándo, el último y el próximo sondeo al gateway, el paso
 *  que se retomará y cuántos intentos van. */
export interface EsperaModelo {
  rol: RolModelo;
  modelo: string;
  desde: number;
  ultimoSondeo: number | null;
  proximoSondeo: number | null;
  pasoId: string | null;
  intentos: number;
}

/** Salud de un modelo por rol, escrita por el vigilante de modelos
 *  (rosa/vigilante_modelos.py) y por los sondeos del supervisor. */
export interface SaludModelo {
  modelo: string;
  estado: 'ok' | 'lento' | 'sin_respuesta';
  /** Desde cuándo está en el estado actual (null si nunca se midió). */
  desde: number | null;
  intentos: number;
  proximoIntentoEn: number | null;
  ultimaRespuestaEn: number | null;
  ultimaLatenciaMs: number | null;
  /** Veces que el modelo dejó de responder desde que arrancó el registro. */
  caidas: number;
  recuperadoEn: number | null;
}

export interface Gasto {
  /** Dólares gastados en Exa (búsqueda semántica) en esta corrida; solo si se usó. */
  exaUsd?: number;
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
  /** Segundos de reloj desde que empezo la corrida. */
  segundos: number;
  /** Articulos leidos en toda la corrida. */
  articulosLeidos: number;
  /** Dólares estimados a partir de los tokens y la tabla de precios de ROSA2018. */
  usd?: number;
  /** Dólares facturados por el AI Gateway (campo `cost` de cada llamada, sumado
   *  por el servidor). Es la cifra real; `usd` queda como estimación al lado.
   *  Ausente en corridas anteriores a que el servidor lo guardara. */
  usdReal?: number;
  /** Alguna llamada de la corrida vino sin coste del gateway y se estimó por tokens. */
  usdEsEstimado?: boolean;
}

/** Tope duro de la corrida completa, con alarmas antes del tope. Al llegar
 *  la corrida se pausa, no muere; se reanuda ampliando el tope. Una pregunta
 *  pendiente tiene prioridad sobre el tope. */
export interface PresupuestoGlobal {
  limiteLlamadas: number;
  alertas: number[];
  /** Alertas ya avisadas (fracciones), para no repetir. */
  avisadas: number[];
  /** Por qué se pausó por presupuesto (llamadas, dinero, horas), escrito por el servidor. */
  motivoPausa?: string;
}

/** Ocupacion del contexto del cerebro del bucle y compactaciones hechas. */
export interface Contexto {
  tokensUsados: number;
  tokensLimite: number;
  /** El prompt mas largo que entro en esta corrida (tokens reales de entrada). */
  tokensMaximo?: number;
  compactaciones: number;
  ultimaCompactacion: number | null;
}

export type TipoIncidencia = 'modelo_bloqueado' | 'conector_caducado' | 'fuente_sin_respuesta' | 'modelo_sin_respuesta';

/** Algo que impide seguir y necesita a una persona: un modelo que devolvio
 *  vacio con content-filter, una clave de conector caducada. Se ensena como
 *  tarjeta con alternativa; nunca muere en silencio. */
export interface Incidencia {
  id: Id;
  corridaId: Id;
  tipo: TipoIncidencia;
  titulo: string;
  detalle: string;
  recurso: string;
  alternativa: string | null;
  estado: 'pendiente' | 'resuelta';
  creadaEn: number;
  resueltaEn: number | null;
  resolucion: string | null;
}

/** Una consulta exacta a una base, para la estrategia reproducible (PRISMA). */
export interface ConsultaBusqueda {
  base: string;
  consulta: string;
  fecha: number;
  resultados: number;
  /** Ausente en consultas anteriores al 16 de septiembre de 2026: foco. */
  modo?: ModoBusqueda;
  /** Solo en amplitud: qué podría cambiar si aparece algo. */
  porque?: string;
  /** Cuántos de los traídos pasaron el cribado (el rendimiento de la consulta). */
  relevantes?: number;
  /** Solo en la novedad del campo: desde qué fecha se buscó. */
  desdeFecha?: string | null;
}

/** El flujo de la busqueda de la corrida: identificados, cribados, leidos a
 *  texto completo, usados en hipotesis. */
export interface FlujoBusqueda {
  identificados: number;
  cribados: number;
  textoCompleto: number;
  usados: number;
  consultas: ConsultaBusqueda[];
  /** Registros traidos para cribar (records_screened de PRISMA 2020). */
  traidos?: number;
  /** Excluidos en el cribado con su motivo (item 16b de PRISMA 2020). */
  excluidos?: ExcluidoCribado[];
}

export interface ExcluidoCribado {
  referencia: string;
  titulo?: string;
  doi?: string | null;
  pmid?: string | null;
  relevancia: number;
  motivo: string;
  iteracion: number;
  consulta: string;
  base?: string;
}

/** Riesgo de sesgo por instrumento validado (RoB 2, ROBINS-I V2, QUADAS-2,
 *  ROBIS, SYRCLE): el modelo responde las preguntas de senalizacion y el
 *  juicio por dominio y global lo pone la regla del instrumento. */
export interface RiesgoSesgo {
  instrumento: string;
  clave?: string;
  version?: string;
  global: 'bajo' | 'algunas_dudas' | 'alto' | 'no_aplica';
  resumen?: string;
  fecha?: number;
  modelo?: string;
  dominios: { id: string; nombre: string; juicio: 'bajo' | 'algunas_dudas' | 'alto' | 'no_aplica'; motivo?: string }[];
}

/** Lo que el laboratorio sabe y no esta en ningun articulo. */
export interface ConocimientoOperativo {
  id: Id;
  texto: string;
  tipo: 'protocolo' | 'reactivo' | 'medicion' | 'muestra' | 'otro';
  quien: string;
  fecha: number;
  clase: 'conocimiento_operativo';
}

/** Estimacion de cobertura por tema (curva de descubrimiento, como Undermind):
 *  cuantos leidos y que fraccion de lo relevante se estima encontrada. */
export interface Cobertura {
  tema: string;
  leidos: number;
  fraccion: number;
  /** Escala de la curva 1 - e^(-n/tau). */
  tau: number;
}

/** Debilidad recurrente detectada por la meta-revision de una iteracion. */
export interface Debilidad {
  id: Id;
  texto: string;
  hipotesisAfectadas: Id[];
  inyectada: boolean;
}

export interface MetaRevision {
  iteracion: number;
  fecha: number;
  debilidades: Debilidad[];
}

/** Un proceso de computo vivo (kernel, trabajo remoto). */
export interface Proceso {
  id: Id;
  nombre: string;
  host: string;
  cpu: number;
  memoriaMb: number;
  estado: 'en_marcha' | 'detenido' | 'terminado';
  empezadoEn: number;
}

export interface Direccion {
  titulo: string;
  razon: string;
  hallazgosRecientes: string[];
  queInvestigar: string[];
  ideaEjemplo: string;
  inesperada: boolean;
  hipotesisIds: Id[];
}

export interface Corrida {
  id: Id;
  investigacionId: Id;
  numero: number;
  estado: EstadoCorrida;
  empezadaEn: number;
  terminadaEn: number | null;
  iteracionActual: number;
  gasto: Gasto;
  /** Motivo por el que se detuvo o termino, si aplica. */
  motivoCierre: string | null;
  presupuesto: PresupuestoGlobal;
  contexto: Contexto;
  busqueda: FlujoBusqueda;
  coberturas: Cobertura[];
  metaRevisiones: MetaRevision[];
  procesos: Proceso[];
  /** El panorama de investigacion: direcciones principales sintetizadas. */
  panorama: Direccion[];
  /** Si el plan de cada iteracion se autoaprueba tras N segundos sin respuesta. Null = espera siempre. */
  autoAprobarPlanSegundos: number | null;
  /** Milisegundos que la corrida pasó esperando a una persona (plan sin aprobar, permiso de gasto, pausa); no cuentan frente al tope en horas. */
  esperaHumanaMs?: number;
  /** Milisegundos en que el proceso estuvo suspendido (equipo dormido) o la corrida
   *  esperó a un modelo que no respondía (`esperando_modelo`); tampoco cuentan. */
  pausaMs?: number;
  /** Qué modelo espera la corrida cuando está en `esperando_modelo`; null (o
   *  ausente en corridas anteriores) el resto del tiempo. */
  esperandoModelo?: EsperaModelo | null;
  /** Que ROSA2018 exacta corrio: commit del codigo, hash de las firmas DSPy y
   *  programas optimizados cargados. Para auditar cada hipotesis. */
  arnes?: { commit: string; firmas: string; optimizados: string };
  /** La pregunta concreta de esta campana, formulada por ROSA2018 desde la meta
   *  y aprobada con el primer plan. Falta en corridas anteriores. */
  pregunta?: PreguntaCampana | null;
  /** Parada propia de esta corrida, fijada al crearla: horas, iteraciones,
   *  llamadas o texto; se detiene con lo que llegue primero, además de la
   *  condición de parada de la investigación. Null o ausente: solo la de la
   *  investigación. */
  parada?: ParadaCorrida | null;
  /** Serie de progreso por iteración (rosa/progreso.py): certeza de cada
   *  hipótesis, peldaños subidos o bajados, hechos nuevos, fallidos y gasto. */
  progreso?: ProgresoIteracion[];
  /** La métrica única al cerrar: peldaños netos de certeza subidos por dólar. */
  metrica?: MetricaCorrida | null;
  /** Lo que heredó de la corrida anterior al empezar (traspaso ejecutable). */
  traspasoRecibido?: string;
  /** Meta-campaña al terminar: diagnóstico del cerebro y cuántos cambios del arnés propuso (rosa/bucle/corrida.py _revisar_arnes). */
  revisionArnes?: { fecha: number; diagnostico: string; propuestas: number; descartadas: number } | null;
}

export interface ParadaCorrida {
  horas: number | null;
  iteraciones: number | null;
  llamadas: number | null;
  texto: string;
  /** Parar cuando `cuantas` hipótesis lleguen a este nivel de certeza. */
  certeza?: 'baja' | 'moderada' | 'alta' | null;
  cuantas?: number | null;
  /** Parar tras N iteraciones seguidas sin subir ningún peldaño ni añadir hechos. */
  sinCambio?: number | null;
}

export interface ProgresoIteracion {
  iteracion: number;
  fecha: number;
  certezas: { hipotesisId: Id; certeza: CertezaEvidencia; direccion: DireccionEvidencia | null; peldano: number; techo: CertezaEvidencia | null }[];
  peldanosTotales: number;
  peldanosSubidos: number;
  peldanosBajados: number;
  hipotesisVivas: number;
  hechosNuevos: number;
  hipotesisNuevas: number;
  fallidos: { pasos: number; pistas: number; killer: number; afirmacionesBloqueadas: number };
  usdAcumulado: number;
  llamadasAcumuladas: number;
  arnes: string | null;
}

export interface MetricaCorrida {
  iteraciones: number;
  peldanosSubidos: number;
  peldanosBajados: number;
  peldanosNetos: number;
  usd: number;
  peldanosPorDolar: number | null;
  hipotesisEnBajaOMas: number;
  hechosNuevos: number;
  hipotesisNuevas: number;
  fallidos: { pasos: number; pistas: number; killer: number; afirmacionesBloqueadas: number };
  banco: { objetivo: string; puntuacion: number | null; criterios: Record<string, number | null> } | null;
}

export type EstadoPaso = 'pendiente' | 'en_curso' | 'hecho' | 'fallido' | 'omitido';

/** Un paso del plan de la iteracion. Se marca segun avanza. Un paso
 *  fallido lleva su motivo, como la lista de control de Biomni. */
export interface PasoPlan {
  id: Id;
  titulo: string;
  detalle: string;
  estado: EstadoPaso;
  /** Lo escribio la investigadora al dirigir la corrida o editar el plan. */
  indicacionHumana: boolean;
  motivoFallo: string | null;
  /** Presupuesto de llamadas para este paso, si se fijo. */
  presupuesto: number | null;
  /** Que decision cambiaria segun el resultado de este paso. Si la siguiente
   *  accion es la misma salga lo que salga, el paso vale poco (plan completo, seccion 6). */
  valorDecision?: string;
  /** Predicción escrita antes de buscar y qué se concluye si no aparece (pasos de literatura y ensayos). */
  espera?: string;
  siNoAparece?: string;
}

export type TipoPista = 'literatura' | 'ensayos' | 'grafo' | 'extraccion' | 'verificacion' | 'novedad' | 'modelo' | 'replicacion';
export type EstadoPista = 'en_curso' | 'hecha' | 'fallida' | 'detenida';

/** Una consulta a una fuente, con sus parametros exactos y lo que devolvio,
 *  como los pasos de conector expandibles de Claude Science. */
export interface DetalleConsulta {
  base: string;
  parametros: string;
  resultados: string;
}

export interface EntradaTranscripcion {
  /** Momento relativo al inicio de la pista, en ms. */
  t: number;
  tipo: 'accion' | 'resultado' | 'nota' | 'error';
  texto: string;
  consulta?: DetalleConsulta;
}

export interface Pista {
  id: Id;
  iteracionId: Id;
  /** Paso del plan al que sirve. Null en pistas antiguas sin esa marca. */
  pasoId: Id | null;
  tipo: TipoPista;
  titulo: string;
  fuente: string;
  estado: EstadoPista;
  resumen: string;
  ms: number;
  transcripcion: EntradaTranscripcion[];
}

export interface Iteracion {
  id: Id;
  corridaId: Id;
  numero: number;
  empezadaEn: number;
  terminadaEn: number | null;
  plan: PasoPlan[];
  /** El plan se aprueba antes de ejecutarse. */
  planAprobado: boolean;
  planPropuestoEn: number;
  pistas: Pista[];
  /** Presupuesto de la iteración en llamadas al modelo, y lo usado.
   *  `reservaCierre` es la parte del límite apartada para el cierre (resumen,
   *  evidencia, conclusiones, revisor; S-14); falta en iteraciones anteriores. */
  presupuesto: { limite: number; usado: number; reservaCierre?: number };
  /** Resumen de una linea al cerrar. */
  resumen: string;
  /** El mismo cierre contado para quien no es cientifico. Lo escribe ROSA2018 al
   *  cerrar; falta en iteraciones abiertas o si el modelo no respondio. */
  resumenLlano?: ResumenLlano | null;
  /** El revisor de registro al cerrar la iteracion. */
  revisionRegistro?: RevisionRegistro | null;
}

/** Un termino tecnico con su explicacion en una frase. */
export interface TerminoLlano {
  termino: string;
  explicacion: string;
}

/** Lo que hizo ROSA2018 en una iteracion, con la estructura de un resumen en
 *  lenguaje llano de Cochrane: pregunta, mensajes clave, que buscaba, que
 *  hizo, que encontro, limitaciones, que cambio, que propone, que falta, que
 *  toca, y hasta cuando esta al dia. */
export interface ResumenLlano {
  titulo: string;
  mensajesClave: string[];
  queBuscaba: string;
  queHizo: string;
  queEncontro: string[];
  limitaciones: string;
  cambios: string[];
  quePropone: string[];
  queFalta: string;
  queTeToca: string;
  alDia: { fechaBusqueda: number | null; fuentesSinRespuesta: string[] };
  terminos: TerminoLlano[];
  /** Texto en llano de las tres cifras de aprendizaje de la iteración (rosa/cifras_aprendizaje.py texto_cifras), que el cierre pega en `resumenLlano.aprendizaje`; ausente en iteraciones anteriores a septiembre de 2026. */
  aprendizaje?: string;
}

/* ---------------------------------------------------------------------
   Permisos y autonomia
   --------------------------------------------------------------------- */

export type TipoPermiso =
  | 'aceptar_hipotesis'
  | 'presupuesto_grande'
  | 'fuente_externa'
  | 'trabajo_largo'
  | 'acceso_corpus';

export type AlcancePermiso = 'una_vez' | 'esta_corrida' | 'esta_investigacion' | 'siempre';

export type EstadoSolicitud = 'pendiente' | 'concedida' | 'denegada';

/** Un argumento editable de la accion propuesta (por ejemplo cuantas
 *  llamadas), para poder ajustarlo antes de permitir. */
export interface ArgumentoSolicitud {
  nombre: string;
  valor: string;
  editable: boolean;
}

export interface SolicitudPermiso {
  id: Id;
  corridaId: Id;
  tipo: TipoPermiso;
  titulo: string;
  detalle: string;
  /** Lo que pide, con nombre exacto ("api.clinicaltrials.gov"). */
  recurso: string;
  alcances: AlcancePermiso[];
  estado: EstadoSolicitud;
  alcanceConcedido: AlcancePermiso | null;
  creadaEn: number;
  resueltaEn: number | null;
  /** Hipotesis afectada, cuando el permiso es aceptarla. */
  hipotesisId: Id | null;
  argumentos: ArgumentoSolicitud[];
}

export interface PermisoConcedido {
  id: Id;
  tipo: TipoPermiso;
  recurso: string;
  alcance: AlcancePermiso;
  concedidoEn: number;
  investigacionId: Id | null;
}

/** Clases de accion del dial de autonomia. */
export type ClaseAccion =
  | 'buscar_literatura'
  | 'correr_analisis'
  | 'gastar_grande'
  | 'escribir_modelo_mundo'
  | 'descartar_hipotesis'
  | 'contactar_laboratorio';

export type NivelAutonomia = 'sugerir' | 'preguntar' | 'actuar';

/* ---------------------------------------------------------------------
   Hipotesis, verificacion y procedencia
   --------------------------------------------------------------------- */

export type EstadoHipotesis = 'propuesta' | 'en_revision' | 'aceptada' | 'descartada' | 'refinar' | 'aclarando';

/** Veredictos del verificador. Mismos que en el RAG (TRASPASO 4.1). */
export type Veredicto =
  | 'sostenida'
  | 'parcial'
  | 'no_sostenida'
  | 'cita_no_resuelve'
  | 'sin_cita'
  | 'ausencia_refutada'
  | 'sin_verificar';

/** De donde sale la afirmacion. Kosmos midio 85 % de acierto en datos,
 *  82 % en literatura y 58 % en interpretaciones: no se tratan igual. */
export type TipoAfirmacion = 'dato' | 'literatura' | 'interpretacion';

export interface Afirmacion {
  texto: string;
  cita: string;
  veredicto: Veredicto;
  motivo: string;
  /** Dato real pero de otra entidad (otro farmaco, cohorte, estudio). */
  entidadDistinta: boolean;
  tipo: TipoAfirmacion;
  /** Trayectoria y celda de codigo que produjeron la cifra, si es un dato. */
  trayectoria: { id: string; celda: number } | null;
  /** El pasaje literal de la fuente en que se apoya, tal como lo copio el
   *  extractor. Es lo que se ensena al lado de la cita para que la persona
   *  compruebe sin abrir el PDF. */
  fragmento?: string;
  /** Clase de evidencia del libro de procedencia. Literatura por defecto. */
  clase?: ClaseEvidencia;
  /** Si el dato viene de un fichero sintetico. Nunca cuenta como observacion. */
  sintetico?: boolean;
  /** Cohorte o estudio del que salen los datos, tal como lo dice la fuente. */
  cohorte?: string;
  /** El fragmento contenía texto que parece una instrucción para el modelo.
   *  No se bloquea (los clasificadores fallan en texto técnico): se enseña. */
  sospechosoInyeccion?: boolean;
  /** La afirmación sale de la introducción, los antecedentes o la discusión
   *  del artículo (o sus equivalentes en castellano): es lo que los autores
   *  cuentan de otros, no lo que midieron. Pesa menos como evidencia. */
  deFondo?: boolean;
  /** Id de la afirmacion en el almacen compartido de la corrida: una
   *  observacion no pertenece a una hipotesis, se enlaza a todas las
   *  compatibles (plan completo, seccion 8). */
  afirmacionId?: string;
  /** Cómo se relaciona con la hipótesis cuando llegó después de nacer esta
   *  (acumulación de evidencia al cerrar cada iteración). Ausente en las que
   *  la motivaron al nacer. */
  relacion?: 'apoya' | 'apoya_indirecta' | 'contradice' | 'socava';
  /** Si socava: el afirmacionId del apoyo cuyo método o inferencia ataca. */
  socavaA?: string | null;
  /** Afirmaciones que socavan a esta; el techo GRADE no la cuenta mientras las tenga. */
  socavadaPor?: string[];
  /** Iteración en la que se le añadió, si llegó después. */
  iteracion?: number;
  /** Por qué el modelo la relacionó así (población, marcador, sentido). */
  motivoRelacion?: string;
  /** Nivel de medicion (plan completo, seccion 3): una conclusion de la
   *  discusion no se convierte en un resultado medido. */
  nivelMedicion?: 'medida' | 'resultado_analisis' | 'interpretacion_autor' | 'interpretacion_rosa';
  /** Campos del registro de evidencia cuando la afirmacion es un dato: n
   *  independiente, comparador, efecto con unidades e incertidumbre. Lo
   *  que la fuente no dice queda vacio y se lista en `sinResolver`. */
  n?: string;
  comparador?: string;
  efecto?: string;
  unidades?: string;
  incertidumbre?: string;
  sinResolver?: string[];
}

/** Un metodo, predictor, recurso de datos o ensayo registrado (MethodVersion
 *  en el plan completo, seccion 5): que puede evaluar, donde aplica, que
 *  necesita, como se valido y en que estado esta. La popularidad no lo
 *  hace apto; la validacion si. */
export interface MetodoRegistrado {
  id: Id;
  nombre: string;
  tipo: 'analisis' | 'predictor' | 'recurso_datos' | 'ensayo_laboratorio' | 'busqueda' | 'revision';
  evalua: string;
  contextos: string[];
  exclusiones: string[];
  entradas: string;
  salidas: string;
  validacion: string;
  fallosConocidos: string;
  version: string;
  dependeDe: string[];
  coste: string;
  responsable: string;
  estado: 'propuesto' | 'implementado' | 'probado_en_contexto' | 'restringido' | 'retirado';
  /** Contextos donde se probo (por ejemplo, reproducciones superadas). */
  probadoEn: string[];
  actualizadoEn: number;
}

export type TipoFuente = 'articulo' | 'preprint' | 'ensayo' | 'grafo' | 'base_curada';

export type TipoEstudio =
  | 'revision_sistematica'
  | 'ensayo_aleatorizado'
  | 'cohorte'
  | 'caso_control'
  | 'transversal'
  | 'serie_de_casos'
  | 'preclinico'
  | 'in_vitro'
  | 'revision_narrativa'
  | 'registro'
  | 'otro';

export type MarcaEditorial = 'retractado' | 'preocupacion' | 'erratum' | null;

export interface Fuente {
  /** Por qué modo de búsqueda llegó: foco o amplitud. Ausente en fuentes anteriores: foco. */
  modo?: ModoBusqueda;
  id: Id;
  /** Referencia corta: "Cohorte clinica, 2023". */
  referencia: string;
  titulo: string;
  /** Apellidos de los autores y primera afiliacion, para detectar dos
   *  articulos de la misma cohorte aunque no la nombren. */
  autores?: string[];
  centro?: string | null;
  tipo: TipoFuente;
  doi: string | null;
  pmid: string | null;
  nct: string | null;
  /** Pagina del visor de PDF. La cita resuelve a esta pagina exacta. */
  pagina: number | null;
  fragmento: string;
  retraccion: MarcaEditorial;
  /** Cuando se comprobo por ultima vez contra Crossref y Retraction Watch. */
  retraccionComprobadaEn: number | null;
  anio: number | null;
  tipoEstudio: TipoEstudio;
  /** Riesgo de sesgo por instrumento, cuando el Killer lo evaluo. */
  riesgoSesgo?: RiesgoSesgo | null;
  /** Nivel potencial de evidencia, 1 (mas bajo) a 5 (mas alto). No es calidad real. */
  nivelEvidencia: 1 | 2 | 3 | 4 | 5;
  /** Se leyo el texto completo o solo el resumen. */
  textoCompleto: boolean;
  citas: number | null;
  /** Cohorte o estudio del que salen los datos (ADNI, BioFINDER, un NCT).
   *  Dos fuentes con la misma cohorte no son dos evidencias independientes. */
  cohorte?: string | null;
}

export interface MensajeProcedencia {
  id: Id;
  de: 'rosa' | 'investigadora' | 'revisor';
  texto: string;
  creadoEn: number;
}

export interface Paquete {
  nombre: string;
  version: string;
}

export interface Procedencia {
  mensajes: MensajeProcedencia[];
  codigo: string;
  registro: string[];
  entorno: { lenguaje: string; version: string; paquetes: Paquete[]; modelos: Paquete[] };
  fuentes: Fuente[];
}

export type TipoHallazgo =
  | 'cita_no_sostiene'
  | 'doi_otro_articulo'
  | 'valor_contradice_fuente'
  | 'resultado_sin_ejecutar'
  | 'paso_sin_completar'
  | 'conclusion_no_sigue'
  | 'entidad_distinta'
  | 'ausencia_refutada'
  | 'sobreafirmacion'
  | 'metrica_inventada';

export type EstadoHallazgo = 'abierto' | 'atendido' | 'no_aplica';

export interface HallazgoRevisor {
  id: Id;
  tipo: TipoHallazgo;
  resumen: string;
  razonamiento: string;
  estado: EstadoHallazgo;
  respuestaDeRosa: string | null;
}

/** Los tipos de revision del agente, separados, como en Co-Scientist. */
export type TipoRevisionAutomatica = 'inicial' | 'completa' | 'profunda' | 'observacion' | 'simulacion' | 'torneo';

export interface RevisionAutomatica {
  tipo: TipoRevisionAutomatica;
  estado: 'pendiente' | 'hecha' | 'rehecha';
  resumen: string;
  fecha: number | null;
}

export type EstadoSupuesto = 'respaldado' | 'plausible' | 'sin_evidencia' | 'contradicho';

/** Un supuesto de la hipotesis, descompuesto e independiente de las citas
 *  (la "verificacion profunda" de Co-Scientist). */
export interface Supuesto {
  id: Id;
  texto: string;
  estado: EstadoSupuesto;
  evidencia: string;
  hijos: Supuesto[];
}

export interface AnclaComentario {
  cita: string;
  campo: 'enunciado' | 'mecanismo' | 'afirmacion' | 'comprobacion' | 'fuente';
}

export interface Comentario {
  id: Id;
  hipotesisId: Id;
  ancla: AnclaComentario;
  nota: string;
  estado: 'pendiente' | 'enviado';
  creadoEn: number;
}

export interface Revision {
  fecha: number;
  quien: string;
  accion: 'propuesta' | 'aceptada' | 'descartada' | 'refinar' | 'reabierta' | 'comentada' | 'no_puedo_juzgar' | 'aclarada' | 'replicada' | 'reformulada' | 'suspendida' | 'killer';
  nota: string;
  /** La decision se tomo sin ver las citas ni el codigo. */
  aCiegas: boolean;
}

/** Revision escrita por una persona, estructurada como la del agente, para
 *  que entre al siguiente debate del torneo. */
export interface RevisionHumana {
  fecha: number;
  quien: string;
  supuestosCuestionados: string;
  literaturaQueFalta: string;
  problemaExperimental: string;
}

export interface Novedad {
  openTargets: { estado: 'sin_evidencia' | 'evidencia_previa' | 'no_comprobado'; detalle: string };
  ensayos: { estado: 'sin_ensayo' | 'ensayo_existente' | 'no_comprobado'; detalle: string; nct: string | null };
  /** Conectores: si la genetica humana ya vincula el gen (GWAS Catalog, ClinVar),
   *  si ya hay farmacos contra la diana (ChEMBL, DGIdb) y si hay datos publicos
   *  para comprobarla (GEO, CELLxGENE). */
  genetica?: { estado: 'no_comprobado' | 'vinculo_conocido' | 'sin_vinculo'; detalle: string };
  farmacos?: { estado: 'no_comprobado' | 'farmacos_existentes' | 'sin_farmacos'; detalle: string };
  datosPublicos?: { estado: 'no_comprobado' | 'hay_datos' | 'sin_datos'; detalle: string; series: { accession: string; titulo: string; n?: number | string | null; plataforma?: string | null }[] };
  /** Exa: patentes y proyectos financiados anteriores a la hipótesis. Una idea ya
   *  protegida o ya financiada no es nueva aunque no esté publicada. */
  patentes?: { estado: 'no_comprobado' | 'patente_relacionada' | 'parcial' | 'sin_patente'; detalle: string; url: string | null };
  financiacion?: { estado: 'no_comprobado' | 'proyecto_financiado' | 'parcial' | 'sin_proyecto'; detalle: string; url: string | null };
  agora: { estado: 'no_nominada' | 'nominada'; detalle: string };
  /** Si alguien ya lo propuso en la literatura (comprobacion tipo Owl). */
  precedente: { estado: 'sin_precedente' | 'parcial' | 'ya_publicado' | 'no_comprobado'; detalle: string };
}

export interface PuntoElo {
  iteracion: number;
  elo: number;
}

/** Un partido del torneo: contra quien, quien gano y por que. */
export interface Partido {
  iteracion: number;
  rivalId: Id;
  resultado: 'gano' | 'perdio' | 'tablas';
  resumenDebate: string;
  ejeDecisivo: 'correccion' | 'utilidad' | 'especificidad' | 'novedad' | 'deseabilidad';
  /** Qué son una respecto a la otra según el juez (fusión de ramas). */
  relacion?: 'distintas' | 'equivalentes' | 'a_subsume_b' | 'b_subsume_a' | 'incompatibles';
}

export interface Replicacion {
  total: number;
  hechas: number;
  sostienen: number;
  contradicen: number;
  estado: 'en_curso' | 'terminada';
  empezadaEn: number;
}

export interface Experimento {
  protocolo: string;
  ensayo: string;
  costeEstimado: string;
  /** Controles positivo y negativo, tamano muestral con su supuesto, y lo
   *  que se veria bajo la explicacion alternativa (Platt). */
  controles?: string;
  tamanoMuestral?: string;
  alternativa?: string;
  laboratorio: string | null;
  estado: 'propuesto' | 'asignado' | 'en_curso' | 'datos_recibidos';
  ficheroDatos: string | null;
  analisisPedido: string;
  /** Criterios fijados de antemano: que resultado la confirmaria y cual la refutaria. */
  confirma?: string;
  refuta?: string;
  /** Al asignarlo a un laboratorio se congela un prerregistro (hipotesis,
   *  protocolo, criterios) como artefacto inmutable. */
  prerregistradoEn?: number | null;
  prerregistroArtefactoId?: string | null;
  /** La version de la hipotesis que se prerregistro: es la que el resultado prueba. */
  versionPrerregistrada?: number;
  /** Que decision cambia segun salga el experimento (valor de decision). */
  decisionQueCambia?: string;
  /** El veredicto del juez sobre los datos del laboratorio contra el prerregistro. */
  resultado?: ResultadoExperimento | null;
  /** Lo que el laboratorio hizo de verdad, separado de lo planeado: protocolo
   *  ejecutado, desviaciones e identidad de las muestras (lote, linea, cohorte). */
  protocoloReal?: ProtocoloReal | null;
  /** Cambios fechados del prerregistro despues de congelarlo: que campo, texto
   *  anterior y nuevo, quien y por que. */
  enmiendas?: EnmiendaPrerregistro[];
  /** Sello de tiempo de un tercero (RFC 3161) sobre el texto del prerregistro:
   *  hash, autoridades que lo firmaron y la hora que firmaron. Se verifica sin ROSA2018. */
  selloExterno?: SelloExterno | null;
  /** Contrato del experimento (rosa/experimento.py): las medidas separadas, cada
   *  una con su criterio de confirmación y de refutación, su control y su unidad.
   *  Un registro antiguo no lo trae; normalizar_contrato deriva una lectura del
   *  par confirma/refuta. */
  lecturas?: LecturaExperimento[];
  /** En qué sistema se hace (iPSC, organoide, animal...), qué prueba y qué no representa. */
  sistema?: SistemaExperimental | null;
  /** Para qué sirve el biomarcador según BEST (FDA-NIH): riesgo, diagnóstico, monitorización, pronóstico... */
  propositoBiomarcador?: PropositoBiomarcador | null;
  /** A qué nivel se lee el desenlace: molecular, celular, fisiológico o de imagen, funcional o clínico. */
  nivelDesenlace?: NivelDesenlace | null;
  /** Qué relación tiene el desenlace medido con el beneficio para una persona; vacío si no se declaró. */
  puenteAlBeneficio?: string;
  /** Lo que le falta al contrato, en castellano, por regla (rosa/experimento.py validar_contrato). */
  problemasContrato?: string[];
  /** SHA-256 de las lecturas en orden canónico (rosa/experimento.py hash_lecturas).
   *  Se congela al prerregistrar y el servidor lo recalcula en cada enmienda;
   *  el congelado de verdad es `enmiendas[0].hashAntes` cuando hay enmiendas,
   *  y este mismo valor cuando no las hay (misma regla en los dos lados). */
  hashLecturas?: string;
  /** La persona declaró que el fichero de datos del laboratorio es sintético o
   *  de prueba. Sus afirmaciones nunca cuentan como observación ni suben el
   *  techo GRADE; el servidor lo fuerza también si el nombre del fichero dice "sintético". */
  datosSinteticos?: boolean;
}

export interface CondicionAutomatizada {
  iteraciones: number | null;
  tiempo: string | null;
  llamadas: number | null;
  resto: string;
  automatizada: boolean;
}

export interface SelloRfc3161 {
  tsa: string;
  url: string;
  ca?: string | null;
  ok: boolean;
  genTime?: string;
  serial?: string;
  politica?: string;
  tsrBase64?: string;
  error?: string;
  ms?: number;
}

export interface SelloExterno {
  algoritmo: 'sha256';
  hash: string;
  pedidoEn: number;
  ok: boolean;
  testigos: string[];
  primeraHora: string | null;
  error: string | null;
  sellos: SelloRfc3161[];
}

/** Un caso del conjunto dorado: lo que dijo el juez sobre una comprobacion y
 *  lo que dice una persona cualificada. De aqui sale el kappa por comprobacion. */
export interface CasoDorado {
  id: Id;
  hipotesisId: Id;
  version: number;
  decisionId: Id | null;
  comprobacion: string;
  veredictoJuez: 'pasa' | 'falla' | 'no_comprobable' | 'no_aplica';
  detalleJuez: string;
  veredictoHumano: 'pasa' | 'falla' | 'no_comprobable';
  nota: string;
  quien: string;
  fecha: number;
  modeloJuez: string;
}

export interface Acuerdo {
  n: number;
  bruto: number | null;
  kappa: number | null;
  ac1: number | null;
  ic95: [number, number] | null;
  interpretacion: string;
  suficiente?: boolean;
}

export interface ProtocoloReal {
  texto: string;
  desviaciones: string;
  identidadMuestras: string;
  registradoEn: number;
  quien: string;
}

export type CampoEnmendable = 'protocolo' | 'ensayo' | 'controles' | 'tamanoMuestral' | 'confirma' | 'refuta' | 'analisisPedido';

/** Campos de una lectura del contrato que se pueden enmendar después de prerregistrar (rosa/experimento.py; reducer enmendarLectura). */
export type CampoLecturaEnmendable = 'queConfirma' | 'queRefuta' | 'control' | 'unidad';

export interface EnmiendaPrerregistro {
  fecha: number;
  quien: string;
  /** El campo de texto enmendado, o, en la enmienda de una lectura del contrato,
   *  "lecturas[i].campo" (misma forma en rosa/estado/acciones.py enmendar_lectura
   *  y en el reducer enmendarLectura de acciones.ts). */
  campo: CampoEnmendable | `lecturas[${number}].${CampoLecturaEnmendable}` | string;
  antes: string;
  despues: string;
  motivo: string;
  /** Solo en la enmienda de una lectura del contrato: el nombre de la lectura
   *  (forma del servidor y del reducer actual). Registros anteriores de la
   *  interfaz guardaban un objeto {indice, nombre, campo}; se sigue leyendo. */
  lectura?: string | { indice: number; nombre: string; campo: CampoLecturaEnmendable } | null;
  /** Huella SHA-256 de las lecturas antes y después de la enmienda (los dos
   *  reducers, misma regla). `hashAntes` de la primera enmienda es el hash
   *  congelado al prerregistrar; `experimento.hashLecturas` pasa a ser el
   *  vigente. Si difieren, el contrato cambió después de congelarse. */
  hashAntes?: string;
  hashDespues?: string;
}

/** Los seis resultados que puede devolver el laboratorio (ROSA2018, etapa
 *  9). Cada uno dispara un aprendizaje distinto: apoyo y negativo actualizan
 *  la creencia; inconcluso pide potencia; fallo tecnico no toca la
 *  hipotesis; toxicidad cierra la via; correccion de contexto crea una
 *  hipotesis derivada con el contexto corregido. */
export type ResultadoLaboratorio = 'apoyo_reproducido' | 'negativo_interpretable' | 'inconcluso' | 'fallo_tecnico' | 'toxicidad_inviabilidad' | 'correccion_contexto';

export interface ResultadoExperimento {
  veredicto: 'confirma' | 'refuta' | 'inconcluso' | 'no_evaluable';
  resultado: string;
  motivo: string;
  limitaciones: string;
  cifras: { nombre: string; valor: string }[];
  exploratorio: string;
  fecha: number;
  fichero: string | null;
  /** La clase principal del resultado en la taxonomia de retorno (decide la
   *  accion de aprendizaje), y que hizo ROSA2018 con el. */
  clasificacion?: ResultadoLaboratorio;
  accionTomada?: string;
  /** Las dimensiones del resultado, que pueden coexistir (plan completo,
   *  seccion 4): un fallo tecnico parcial con un efecto inesperado en otra
   *  medida es las dos cosas, no una. */
  dimensiones?: DimensionesResultado;
  /** Si fue una correccion de contexto: la hipotesis derivada que se creo. */
  hipotesisDerivadaId?: Id | null;
  /** Que version de la hipotesis probo de verdad este resultado, y si es
   *  compatible con la version actual. Un resultado tardio actualiza la
   *  version que probo. */
  versionProbada?: number;
  compatibleConActual?: boolean;
  /** Un veredicto por lectura del contrato, por regla sobre las cifras nombradas (rosa/experimento.py veredicto_por_lecturas). Vacío si el resultado no trae cifras con nombre. */
  veredictosPorLectura?: VeredictoLectura[];
  /** Qué dice un negativo cuando hay lecturas separadas: si la diana se tocó y no pasó nada, o si no se tocó (rosa/experimento.py lectura_del_negativo). */
  lecturaDelNegativo?: LecturaDelNegativo | null;
}

export interface DimensionesResultado {
  falloTecnico: boolean;
  inconcluso: boolean;
  efectoPequenoInterpretable: boolean;
  efectoPredicho: boolean;
  efectoInesperado: boolean;
  toxicidad: boolean;
  nota: string;
}

/** El contrato minimo de una hipotesis (Hypothesis Card, ROSA2018 etapa 3):
 *  lo que hace falta para que el Killer la pueda juzgar y el laboratorio la
 *  pueda ejecutar. Sin prediccion falsable no hay tarjeta. */
export interface TarjetaHipotesis {
  /** Diana molecular o proceso biologico. */
  diana: string;
  celula: string;
  etapa: string;
  intervencion: string;
  direccion: 'aumenta' | 'disminuye' | 'modula' | 'sin_intervencion';
  prediccionFalsable: string;
  riesgos: string[];
  /** En que paso de la ruta terapeutica esta esta hipotesis. */
  pasoRuta?: PasoRutaTerapeutica;
}

/** Una version anterior de la hipotesis. Reformular no sobrescribe: crea
 *  una version nueva y guarda la anterior aqui con el motivo del cambio. */
export interface VersionHipotesis {
  n: number;
  fecha: number;
  quien: string;
  motivo: string;
  titulo: string;
  enunciado: string;
  mecanismo: string;
  comprobacion: { biomarcador: string; cohorte: string; diseno: string };
  tarjeta: TarjetaHipotesis | null;
  /** Qué cambió respecto a la versión siguiente, campo a campo (rosa/registro.py). */
  cambios?: { campo: string; antes: string; despues: string }[];
  /** Instantánea del estado de la evidencia cuando se cerró esta versión. */
  certeza?: string | null;
  direccion?: string | null;
  nAfirmaciones?: number;
  nFuentes?: number;
  decisionKiller?: DecisionKiller | null;
  elo?: number;
}

/** Decisiones que toma el Hypothesis Killer (ROSA2018, etapa 4). El
 *  generador no esta entre quienes deciden: nunca aprueba lo suyo. */
export type DecisionKiller = 'avanzar' | 'reformular' | 'suspender' | 'descartar_en_contexto';

/** Una comprobacion de la lista del Killer o del auditor, con su resultado. */
export interface Comprobacion {
  comprobacion: string;
  resultado: 'pasa' | 'falla' | 'no_aplica' | 'no_comprobable';
  detalle: string;
}

export type EtapaDecision = 'killer_1' | 'killer_2' | 'priorizacion' | 'persona' | 'retorno';

export type TipoDecision = DecisionKiller | 'valido' | 'no_valido' | 'no_evaluable_computacionalmente' | 'candidata' | 'bloqueada' | 'aceptada' | 'descartada' | 'reabierta' | 'refinar';

/** DecisionRecord: cada decision sobre una hipotesis, con quien la tomo
 *  (modelo o persona), la version juzgada, las comprobaciones y, si fue un
 *  descarte auditado, lo que dijo el auditor de otra familia. */
export interface Decision {
  id: Id;
  investigacionId: Id;
  hipotesisId: Id;
  version: number;
  etapa: EtapaDecision;
  decision: TipoDecision;
  motivo: string;
  comprobaciones: Comprobacion[];
  /** Que haria falta para poder evaluarla, si se suspendio. */
  queHariaFalta: string;
  quien: string;
  fecha: number;
  auditoria: { quien: string; acuerdo: boolean; motivo: string; fecha: number } | null;
  /** Segundos entre abrir la ficha y decidir, si la decision fue de una persona: la carga de revision. */
  segundosRevision?: number;
  /** Cuanto contexto habia al decidir (para vigilar si la calidad cae al crecer el modelo de mundo). */
  contexto?: { hechos: number; hipotesisVivas: number };
}

/** Bloqueos no compensables de la priorizacion (ROSA2018, etapa 8): uno
 *  solo basta para sacar la hipotesis de los candidatos, puntue lo que
 *  puntue en lo demas. */
export type Bloqueo = 'trazabilidad_insuficiente' | 'datos_no_autorizados' | 'analisis_invalido' | 'sin_experimento_interpretable' | 'descartada_por_killer' | 'fuente_retractada' | 'revision_registro_abierta' | 'dependencia_pendiente';

/** Propagación de dependencias (rosa/dependencias.py): algo de lo que esta pieza
 *  depende cambió y nadie la volvió a revisar. Se levanta al atenderla. */
export interface PendienteRevision {
  causa: 'fuente_retractada' | 'hecho_sustituido' | 'hecho_contradicho' | 'hipotesis_reformulada' | 'fuente_corregida';
  detalle: string;
  origenId: string;
  desde: number;
}

/** Una publicación que apareció después de la última comprobación de vigilancia. */
export interface NovedadVigilada {
  titulo: string;
  referencia: string;
  url: string | null;
  doi: string | null;
  fecha: string | null;
  preprint: boolean;
  pasaje: string;
  similitud: number | null;
  /** Términos clave de la hipótesis que nombra (por eso entró como novedad). */
  terminos?: string[];
}

/** Vigilancia de literatura por hipótesis (Exa, una búsqueda al día). */
export interface Vigilancia {
  ultimaComprobacion: number | null;
  comprobaciones: number;
  costeUsd: number;
  nuevas: NovedadVigilada[];
  ultimoError?: string | null;
}

export interface Hipotesis {
  /** Qué se publicó sobre esta hipótesis desde la última comprobación (solo con Exa). */
  vigilancia?: Vigilancia;
  id: Id;
  investigacionId: Id;
  titulo: string;
  enunciado: string;
  mecanismo: string;
  /** Que biomarcador o que cohorte permitiria comprobarla. Siempre va. */
  comprobacion: { biomarcador: string; cohorte: string; diseno: string };
  estado: EstadoHipotesis;
  elo: number;
  historialElo: PuntoElo[];
  rivales: Id[];
  novedad: Novedad;
  afirmaciones: Afirmacion[];
  procedencia: Procedencia;
  hallazgos: HallazgoRevisor[];
  revisiones: Revision[];
  creadaEn: number;
  iteracion: number;
  origen: 'rosa' | 'humana';
  derivadaDe: Id | null;
  cluster: string;
  /** Identificadores canonicos de lo que nombra la hipotesis (diana, celula, tejido, proceso). */
  entidades?: EntidadCanonica[];
  evidenciaEstadistica: 'fuerte' | 'moderada' | 'debil' | 'no_aplica';
  /** Por que importa para el objetivo, en dos lineas, escrito por ROSA2018. */
  relevancia: { justificacion: string; votoHumano: 'alta' | 'media' | 'baja' | null };
  partidos: Partido[];
  revisionesAutomaticas: RevisionAutomatica[];
  supuestos: Supuesto[];
  revisionesHumanas: RevisionHumana[];
  replicacion: Replicacion | null;
  ultimaRevisionAutomatica: number | null;
  coste: { literatura: number; analisis: number };
  experimento: Experimento | null;
  /** Fecha de la version inmutable (prerregistro) del enunciado. */
  prerregistradaEn: number;
  /** La hipotesis en tres o cuatro frases para quien no es cientifico. */
  enLlano?: string | null;
  /** La conclusion provisional de ROSA2018 con la evidencia reunida. Se rehace
   *  al cerrar cada iteracion. No dice si es cierta: dice cuanto la apoya lo
   *  que hay. */
  conclusion?: ConclusionHipotesis | null;
  /** El contrato minimo (Hypothesis Card). Null si ROSA2018 no pudo rellenarlo. */
  tarjeta?: TarjetaHipotesis | null;
  /** Version actual (1 al nacer) y las anteriores. */
  version?: number;
  versiones?: VersionHipotesis[];
  /** La ultima decision del Killer sobre esta version. */
  decisionKiller?: DecisionKiller | null;
  /** El Killer tiene una revisión pendiente porque el modelo no respondió (o
   *  su respuesta no se pudo leer): la decisión que se ve es la anterior, no un
   *  juicio nuevo. La escribe el servidor (rosa/bucle/pasos.py); puede traer
   *  el número de intentos y el motivo técnico. */
  killerPendiente?: boolean | { intentos?: number; motivo?: string } | null;
  /** Cohortes distintas entre las fuentes, contadas por el servidor con el
   *  catálogo canónico (rosa/metodos.py) al marcar candidatas y al concluir.
   *  La interfaz la lee tal cual; solo recalcula si falta (registro antiguo). */
  cohortesDistintas?: string[];
  /** Los bloqueos no compensables que hoy la sacan de los candidatos. */
  bloqueos?: Bloqueo[];
  /** Si la priorizacion la marco candidata al laboratorio en este ciclo. */
  candidata?: boolean;
  /** Artefacto con el dossier para el laboratorio, si se genero. */
  dossierArtefactoId?: Id | null;
  /** Ids de las ejecuciones in silico sobre esta hipotesis. */
  ejecuciones?: Id[];
  /** Registro de consultas a bases publicas: herramienta, argumentos, fecha,
   *  numero de resultados, identificadores retenidos e invariante comprobada. */
  consultas?: ConsultaBase[];
  /** El contexto de la diana desde las bases (MyGene, UniProt, HPA, STRING, Reactome). */
  contextoBases?: ContextoBases | null;
  /** Grafo causal local con aristas tipadas y la identificacion por regla
   *  (identificable, acotado, sin resolver) con los supuestos que faltan. */
  grafoCausal?: GrafoCausal | null;
  /** Fuerza de Bradley-Terry en escala Elo con intervalo del 95 % por bootstrap
   *  de los partidos. Es lo que ordena a las candidatas; el Elo es la vista. */
  bt?: { fuerza: number; ic95: [number, number]; partidos: number };
  /** Grafo de evidencia (rosa/argumentacion.py): con quién no puede ser cierta a la
   *  vez, declarado por el juez o deducido por signo opuesto en la misma arista causal. */
  ataca?: { hipotesisId: Id; motivo: 'contradiccion_declarada' | 'mismo_mecanismo_direccion_opuesta'; detalle: string }[];
  /** Candidatas con las que está en conflicto (se marca, no se descarta). */
  conflictoCon?: Id[];
  enExtensionFundamentada?: boolean;
  /** Fusión de ramas por torneo: con quién es redundante, qué absorbió, en quién se fusionó. */
  redundanteCon?: Id[];
  absorbe?: Id[];
  fusionadaEn?: Id | null;
  fusionPropuesta?: { con: Id; relacion: 'equivalentes' | 'a_subsume_b' | 'b_subsume_a'; motivo: string; propuestaEn: number } | null;
  pendienteRevision?: PendienteRevision | null;
  /** Evidencia acumulada de los analisis validos con e-valores (producto de
   *  kappa p^(kappa-1)); rechaza la nula al nivel alfa si llega a 1/alfa. */
  evidenciaSecuencial?: { eAcumulado: number; pruebas: { ejecucionId: Id; p: number; e: number }[]; alfa: number; kappa: number; rechazaNula: boolean } | null;
  /** Ruta terapéutica calculada por regla (rosa/ruta.py): estado de cada paso con su evidencia y motivo; null si no se calculó todavía. */
  ruta?: RutaTerapeuticaEvaluada | null;
  /** Perfil de evidencia de la diana en seis capas desde las bases públicas (rosa/dianas.py perfil_de_diana), con la versión de la hipótesis para la que se consultó. */
  perfilDiana?: PerfilDiana | null;
  /** Explicaciones alternativas a la hipótesis con su clase y qué observación las separaría (las escribe el cierre de iteración; lista vacía en registros antiguos). */
  alternativas?: Alternativa[];
}

/* ---------------------------------------------------------------------
   Analisis in silico: plan congelado, ejecucion, auditoria, reproduccion
   --------------------------------------------------------------------- */

/** AnalysisPlan: lo que se va a calcular, congelado antes de ver ningun
 *  resultado. Cambiarlo despues es otro plan. */
export interface PlanAnalisis {
  id: Id;
  investigacionId: Id;
  hipotesisId: Id | null;
  /** Entorno del sandbox que el plan declara: tabular o celula unica. */
  entorno?: 'tabular' | 'celula_unica';
  datasetId: Id;
  tipo: 'confirmatorio' | 'exploratorio' | 'reproduccion';
  pregunta: string;
  /** Dependiente, independientes, confusores y constantes, nombradas como en el diccionario. */
  variables: string[];
  poblacion: string;
  preprocesado: string[];
  prueba: string;
  hipotesisNula: string;
  hipotesisAlternativa: string;
  alpha: number;
  direccionEsperada: string;
  tamanoEfectoMinimo: string;
  /** Con que comparar: la baseline simple obligatoria (clase mayoritaria, regresion sin la variable, permutacion con reajuste). */
  baseline: string;
  /** El control negativo: la misma prueba con etiquetas barajadas debe dar nada. */
  controlNegativo: string;
  correccionMultiplicidad: string;
  umbralEfecto: string;
  criterioNoEvaluable: string;
  /** Intención completa: qué hará ROSA2018 según salga, y de qué plan viene (réplica o variante). */
  siConfirma?: string;
  siRefuta?: string;
  siNoEvaluable?: string;
  planPadre?: Id | null;
  cambioRespectoAlPadre?: string;
  /** Sello RFC 3161 del hash del plan congelado, si alguna autoridad respondió. */
  selloExterno?: { hash: string | null; ok: boolean | null; primeraHora?: string | null; error?: string | null } | null;
  semilla: number;
  hashDatos: string;
  /** sha256 del plan canonico: cambiarlo despues es otro plan. */
  hashPlan: string;
  congeladoEn: number;
  autor: string;
  /** Si es una reproduccion de un analisis publicado, su id. */
  reproduccionId: Id | null;
  pendienteRevision?: PendienteRevision | null;
}

export type EstadoEjecucion = 'no_ejecutado' | 'en_curso' | 'error_tecnico' | 'completado' | 'tiempo_agotado';

/** Que dice el resultado, separado de si el codigo corrio. */
export type InterpretacionEjecucion = 'efecto_detectado' | 'sin_efecto_detectable' | 'no_evaluable';

/** RunRecord: una ejecucion en el sandbox, con todo lo necesario para
 *  repetirla: codigo, entorno, semilla, hash de los datos, salidas y estado
 *  real. "No ejecutado", "error tecnico" y "sin efecto" son estados
 *  distintos y no se confunden. */
export interface Ejecucion {
  id: Id;
  investigacionId: Id;
  hipotesisId: Id | null;
  planId: Id;
  tipo: 'hipotesis' | 'reproduccion';
  codigo: string;
  entorno: { python: string; paquetes: Paquete[]; imagen?: string };
  /** Skills de metodo que se cargaron al escribir el codigo. */
  skills?: string[];
  semilla: number;
  hashDatos: string;
  hashPlan: string;
  inicio: number;
  fin: number | null;
  estado: EstadoEjecucion;
  /** Donde corrio: contenedor Docker, micro-VM de Apple container, o el
   *  aislamiento blando local (solo permitido con datos sinteticos). */
  runtime: 'docker' | 'container' | 'local_sintetico' | 'ninguno';
  red: 'deshabilitada';
  codigoSalida: number | null;
  duracionS: number | null;
  salida: string;
  error: string;
  /** Las cifras que el codigo imprimio como RESULTADO nombre=valor. */
  resultados: Record<string, string>;
  baseline: Record<string, string>;
  controlNegativo: Record<string, string>;
  /** Corridas repetidas con otras semillas, si el plan tiene aleatoriedad. */
  repeticiones: { semilla: number; resultados: Record<string, string> }[];
  /** Ensayo en seco: el codigo corrido antes sobre una tabla sintetica con la
   *  forma del dataset. Sus cifras no cuentan; solo dice si el codigo corre. */
  ensayoSeco?: { estado: 'no_hecho' | 'completado' | 'error_tecnico' | 'no_ejecutado' | 'tiempo_agotado'; intentos: number; error: string; filas: number };
  interpretacion: { estado: InterpretacionEjecucion; resumen: string } | null;
  /** La llena el auditor: si el numero es plausible (unidades, escala, n). */
  plausibilidadVerificada: boolean | null;
  /** Killer II: el auditor independiente del analisis. */
  auditoria: { veredicto: 'valido' | 'no_valido' | 'no_evaluable_computacionalmente'; comprobaciones: Comprobacion[]; motivo: string; quien: string; fecha: number } | null;
}

/** Un analisis publicado que hay que reproducir para abrir la puerta. */
export interface Reproduccion {
  id: Id;
  investigacionId: Id;
  datasetId: Id;
  referencia: string;
  doi: string;
  descripcion: string;
  cifraPublicada: string;
  valorPublicado: number;
  /** Tolerancia relativa (0,1 = 10 %), fijada antes de ejecutar. */
  tolerancia: number;
  planId: Id | null;
  ejecucionId: Id | null;
  valorObtenido: number | null;
  estado: 'pendiente' | 'en_curso' | 'superada' | 'fallida' | 'error_tecnico';
  creadaEn: number;
}

/* ---------------------------------------------------------------------
   Aprendizaje (LearningChange)
   --------------------------------------------------------------------- */

export type NivelAprendizaje = 1 | 2 | 3;

/** Un cambio que ROSA2018 aprende, con su nivel: 1 cambia lo que cree de una
 *  hipotesis (automatico, registrado); 2 cambia como razona (un criterio, un
 *  programa optimizado) y solo se promueve tras compararlo sobre un conjunto
 *  reservado, por una persona; 3 cambia una politica y solo lo hace una
 *  persona en el codigo. */
export interface CambioAprendizaje {
  id: Id;
  investigacionId: Id | null;
  nivel: NivelAprendizaje;
  tipo: 'creencia' | 'criterio' | 'programa' | 'politica' | 'modelo_de_mundo' | 'hipotesis_derivada';
  descripcion: string;
  /** De donde salio: id de resultado, debilidad, corrida GEPA o decision. */
  origen: string;
  estado: 'aplicado' | 'propuesto' | 'evaluado' | 'promovido' | 'revertido';
  evaluacion: { conjunto: string; casos: number; antes: number | null; despues: number | null; nota: string } | null;
  /** Motivo y riesgo que dio la meta-campaña (origen 'arnes:<corrida>'), aparte de la descripción que se evalúa. */
  nota?: string;
  quien: string;
  fecha: number;
  resueltoEn: number | null;
  resueltoPor: string | null;
}

/** Certeza de la evidencia, escala GRADE. */
export type CertezaEvidencia = 'alta' | 'moderada' | 'baja' | 'muy_baja';
/** Hacia donde apunta la evidencia reunida, independiente de la certeza. */
export type DireccionEvidencia = 'apoya' | 'mixta' | 'en_contra' | 'sin_evidencia_directa';

export type FactorCerteza = 'riesgo_de_sesgo' | 'inconsistencia' | 'evidencia_indirecta' | 'imprecision' | 'sesgo_de_publicacion' | 'efecto_grande' | 'gradiente' | 'replicacion_independiente';

export interface ConclusionHipotesis {
  certeza: CertezaEvidencia;
  /** Techo por regla (rosa/certeza.py): el nivel máximo con lo que hay contado
   * (cohortes distintas, evidencia directa no sintética). Si `acotada`, el juez
   * había dicho más y la regla lo bajó. Ausente en conclusiones anteriores. */
  techo?: { nivel: CertezaEvidencia; motivo: string; acotada: boolean; certezaDelJuez: CertezaEvidencia } | null;
  /** Qué le falta para cada nivel por encima del actual, por regla. */
  escalera?: { de: CertezaEvidencia; a: CertezaEvidencia; falta: string }[];
  /** Las cohortes distintas que la regla del techo contó (rosa/certeza.py, con
   *  el catálogo de rosa/metodos.py) al escribir esta conclusión. */
  cohortesDistintas?: string[];
  direccion: DireccionEvidencia;
  conclusion: string;
  /** Por que este grado: los factores GRADE que lo bajaron o subieron. */
  factores: { factor: FactorCerteza; efecto: 'baja' | 'sube' | 'neutro'; explicacion: string }[];
  /** La base contada de forma determinista, no estimada por el modelo. */
  base: { afirmaciones: number; sostenidas: number; fuentes: number; datos: number; interpretaciones: number };
  /** La frase calibrada de (direccion, certeza), generada por regla, no por el modelo. */
  enunciado: string;
  aFavor: string[];
  enContra: string[];
  loMasFragil: string;
  subiria: string;
  bajaria: string;
  /** Fuentes que no respondieron al comprobar la novedad: "no pude comprobar", no "no hay". */
  noComprobado: string[];
  /** Si la certeza o la direccion cambiaron respecto a la conclusion anterior. */
  cambio: { de: { certeza: CertezaEvidencia | null; direccion: DireccionEvidencia | null; iteracion: number | null }; motivo: string } | null;
  /** Cuándo (ms desde 1970) la certeza se recalculó por regla, sin juez
   *  (rosa/certeza.py reacotar_conclusion, al cerrar o al priorizar). Ausente
   *  si nunca pasó; `cambio` dice de dónde venía y por qué. */
  recalculadaEn?: number | null;
  fechaBusqueda: number | null;
  fecha: number;
  iteracion: number;
}

/* ---------------------------------------------------------------------
   Modelo de mundo
   --------------------------------------------------------------------- */

export type EstadoHecho = 'sabido' | 'abierto' | 'descartado';
export type TipoHecho = 'hecho' | 'hipotesis' | 'pregunta';

export interface ProcedenciaHecho {
  fuenteId: Id;
  referencia: string;
  pagina: number | null;
}

export type ClasificacionCita = 'apoya' | 'menciona' | 'contrasta';

/** Una cita de otra fuente sobre este hecho, con su clasificacion y la
 *  seccion del articulo donde aparece (patron de Scite). */
export interface CitaSobreHecho {
  referencia: string;
  seccion: string;
  clasificacion: ClasificacionCita;
  fragmento: string;
}

export interface MovimientoHecho {
  fecha: number;
  de: EstadoHecho | null;
  a: EstadoHecho;
  quien: string;
  motivo: string;
}

/** Una entidad enlazada a su identificador canonico (HGNC, MONDO, CL,
 *  UBERON, GO, ChEBI). Los sinonimos son alias del mismo nodo. */
export interface EntidadCanonica {
  id: string;
  etiqueta: string;
  ontologia: string;
  tipo: string;
  alias: string[];
  uniprot?: string | null;
  ensembl?: string | null;
  entrez?: string | null;
  iri?: string | null;
}

export interface HechoMundo {
  id: Id;
  investigacionId: Id;
  tipo: TipoHecho;
  tema: string;
  enunciado: string;
  /** Identificadores canonicos de lo que nombra el hecho. */
  entidades?: EntidadCanonica[];
  estado: EstadoHecho;
  /** Lo que dice la fuente, separado de lo que infiere ROSA2018; 'laboratorio' si
   *  viene de un resultado de laboratorio evaluado contra el prerregistro. */
  origen: 'fuente' | 'inferencia' | 'laboratorio';
  procedencia: ProcedenciaHecho[];
  motivoDescarte: string | null;
  actualizadoEn: number;
  prioridad: number;
  citas: CitaSobreHecho[];
  historial: MovimientoHecho[];
  /** Grafo de evidencia: las afirmaciones (con fragmento y cita) que lo sostienen. */
  afirmacionIds?: string[];
  /** Hechos que este deja obsoletos, y quién lo dejó obsoleto a él. */
  sustituyeA?: Id[];
  sustituidoPor?: Id | null;
  /** Cuestiones que este hecho responde y hechos con los que choca sin sustituirlos. */
  resuelveA?: Id[];
  contradiceA?: Id[];
  /** Cuándo se cerró (sustituido o respondido); actualizadoEn no se toca. */
  cerradoEn?: number | null;
  pendienteRevision?: PendienteRevision | null;
}

/** Una cuestión abierta de la investigación (lo que rekursiv.ai llama Issue):
 *  de dónde salió, qué la resolvería y a qué hipótesis y hechos toca. Vive en
 *  estado.cuestiones y la mantiene rosa/cuestiones.py. */
export interface Cuestion {
  id: Id;
  investigacionId: Id;
  texto: string;
  estado: 'abierta' | 'resuelta' | 'descartada';
  origen: { tipo: 'pregunta_modelo' | 'killer' | 'revisor' | 'paso_fallido' | 'persona' | 'analisis' | 'laboratorio' | 'escalera'; id: string | null };
  queLaResolveria: string;
  hipotesisIds: Id[];
  hechoIds: Id[];
  prioridad: number;
  creadaEn: number;
  actualizadaEn: number;
  resueltaEn: number | null;
  resolucion: { por: string; motivo: string } | null;
  veces: number;
  historial: { fecha: number; de: string | null; a: string; quien: string; motivo: string }[];
}

/* ---------------------------------------------------------------------
   Artefactos
   --------------------------------------------------------------------- */

export type TipoArtefacto = 'informe' | 'tabla' | 'modelo_mundo' | 'figura' | 'cuaderno' | 'specific_aims' | 'dossier' | 'prerregistro';

export interface VersionArtefacto {
  n: number;
  creadaEn: number;
  resumen: string;
  contenido: string;
  iteracion: number;
  /** Las cinco pestanas de procedencia (como en Claude Science): de donde
   *  salio, el codigo, lo que corrio, el entorno y la revision. */
  procedencia?: ProcedenciaArtefacto;
}

export interface ProcedenciaArtefacto {
  mensajes: Record<string, unknown> | null;
  codigo: string | null;
  registroEjecucion: { id: string; estado: string; auditoria: string | null; resultados: Record<string, string> | null }[] | null;
  entorno: Record<string, unknown> | null;
  revision: RevisionRegistro | null;
}

/** El revisor de registro: hallazgos de seis clases al comparar lo que ROSA2018
 *  dijo con lo que el registro prueba. */
export type ClaseHallazgoRegistro = 'calculo_no_ejecutado' | 'contradiccion_con_registro' | 'cita_sin_soporte' | 'identificador_no_coincide' | 'paso_incompleto' | 'conclusion_no_sigue';

export interface HallazgoRegistro {
  id?: string;
  clase: ClaseHallazgoRegistro;
  gravedad: 'alta' | 'media' | 'baja';
  detalle: string;
  origen: 'regla' | 'juez';
  estado?: 'abierto' | 'atendido' | 'descartado';
  respuesta?: string;
  resueltoPor?: string;
  resueltoEn?: number;
}

export interface RevisionRegistro {
  hallazgos: HallazgoRegistro[];
  porRegla: number;
  juez: string | null;
  resumen: string;
  fecha?: number;
  estado?: 'limpia' | 'con_hallazgos';
}

export interface Artefacto {
  id: Id;
  investigacionId: Id;
  nombre: string;
  tipo: TipoArtefacto;
  versiones: VersionArtefacto[];
  destacado: boolean;
}

/* ---------------------------------------------------------------------
   Calidad
   --------------------------------------------------------------------- */

export type CategoriaCaso = 'single_hop' | 'multi_hop' | 'tabla' | 'abstencion' | 'entidad';
export type EstadoCaso = 'propuesto' | 'aprobado' | 'descartado';

export interface CasoControl {
  clave: string;
  categoria: CategoriaCaso;
  pregunta: string;
  respuestaEsperada: string;
  estado: EstadoCaso;
  critico: boolean;
  origen: 'generado' | 'humano';
}

export interface MetricasJuez {
  fecha: number;
  juez: string;
  casos: number;
  /** Kappa juez-humano del conjunto dorado; null mientras no haya etiquetas. */
  acuerdoConHumanos: number | null;
  sostenidas: number;
  cobertura: number;
  ausenciasRefutadas: number;
  entidadDistinta: number;
  /** Cuantas veces dijo "sin verificar" cuando no sabia. Se mide aparte. */
  sinVerificar: number;
  /** Acierto por tipo de afirmacion, verificado por humanos. */
  aciertoPorTipo: Record<TipoAfirmacion, number | null>;
}

export interface CorridaGepa {
  nota?: string;
  promovido?: boolean;
  version?: string;
  particiones?: number[];
  /** Ciclo del servicio automático (rosa/gepa_continuo.py), no del script manual. */
  automatico?: boolean;
  /** Rol del modelo con el que corrió el programa y se examinó (cerebro, volumen). */
  rol?: string;
  /** Versión anterior a la promovida ('base' si ninguna), para revertir. */
  anterior?: string;
  /** Gasto del ciclo: llamadas, tokens y dólares (antes no se contabilizaba). */
  gasto?: { llamadas: number; tokensEntrada: number; tokensSalida: number; usd: number };
  /** Puntuaciones pareadas del examen final (dos lecturas por caso, promediadas). */
  examen?: { antes: number[]; despues: number[] };
  id: Id;
  fecha: number;
  programa: string;
  presupuesto: 'light' | 'medium' | 'heavy';
  metricaInicial: number;
  metricaFinal: number;
  candidatos: number;
  enlaceMlflow: string;
  estado: 'en_marcha' | 'terminada' | 'fallida';
}

/* ---------------------------------------------------------------------
   Ajustes
   --------------------------------------------------------------------- */

export interface Recuerdo {
  id: Id;
  texto: string;
  creadoEn: number;
}

export interface Avisos {
  correo: { activo: boolean; direccion: string };
  slack: { activo: boolean; canal: string };
  cuando: { hipotesisNueva: boolean; permisoPendiente: boolean; corridaDetenida: boolean; resumenDiario: boolean };
}

export type AccionEspera = 'recordar' | 'escalar' | 'detener' | 'continuar';

/** Que pasa con una decision que nadie toma: recordar, escalar a alguien,
 *  detener con seguridad o continuar registrando. Nunca lo decide la
 *  interfaz por accidente. */
export interface PoliticaEsperas {
  horas: number;
  accion: AccionEspera;
  escalarA: string;
}

export interface PlanGuardado {
  id: Id;
  nombre: string;
  pasos: string[];
  vecesUsado: number;
  exitos: number;
}

export type EstadoConexion = 'conectando' | 'en_linea' | 'sin_conexion' | 'muestra';

/* ---------------------------------------------------------------------
   Eventos (para el resumen "mientras no estabas")
   --------------------------------------------------------------------- */

export type TipoEvento =
  | 'iteracion_terminada'
  | 'hipotesis_nueva'
  | 'hipotesis_decidida'
  | 'ranking_cambio'
  | 'permiso_pendiente'
  | 'permiso_resuelto'
  | 'incidencia'
  | 'presupuesto'
  | 'corrida_estado'
  | 'hecho_nuevo'
  | 'retraccion'
  | 'literatura_nueva'
  | 'revision_automatica'
  | 'killer'
  | 'analisis'
  | 'aprendizaje'
  | 'mision'
  | 'vigilancia'
  | 'vivero'
  | 'revision_registro'
  | 'dependencias'
  | 'modelo_sin_respuesta'
  | 'modelo_recuperado';

export interface Evento {
  id: Id;
  investigacionId: Id;
  t: number;
  tipo: TipoEvento;
  texto: string;
  /** Hash de la ruta a la que lleva. */
  ruta: string | null;
}

/* ---------------------------------------------------------------------
   Estado completo
   --------------------------------------------------------------------- */

export interface EstadoRosa {
  conexion: EstadoConexion;
  investigaciones: Investigacion[];
  corridas: Corrida[];
  iteraciones: Iteracion[];
  solicitudes: SolicitudPermiso[];
  incidencias: Incidencia[];
  permisos: PermisoConcedido[];
  autonomia: Record<ClaseAccion, NivelAutonomia>;
  hipotesis: Hipotesis[];
  comentarios: Comentario[];
  hechos: HechoMundo[];
  cuestiones?: Cuestion[];
  /** Lecciones por regla de cada investigación: lo que ROSA2018 aprendió a no repetir. */
  lecciones?: Leccion[];
  /** Aristas tipadas del modelo de mundo: base curada del campo y la
   *  relacion X causa Y de cada hipotesis juzgada, con su tipo. */
  relaciones?: RelacionCausal[];
  /** Paneles de evaluacion del sistema con fallos plantados (panel del Killer). */
  evaluaciones?: RegistroEvaluacion[];
  /** Etiquetas humanas sobre comprobaciones del Killer (calibracion de los jueces). */
  conjuntoDorado?: CasoDorado[];
  /** El catalogo de conectores a bases publicas, tal como esta en el codigo. */
  conectores?: ConectorCatalogo[];
  /** Permiso por conector: permitir, solo cuando pregunta una persona, o bloquear. */
  permisosConectores?: Record<string, NivelPermisoConector>;
  /** Las skills de metodo de ROSA2018 (ficheros SKILL.md en rosa/skills/). */
  skills?: SkillCatalogo[];
  artefactos: Artefacto[];
  casos: CasoControl[];
  metricas: MetricasJuez[];
  gepa: CorridaGepa[];
  gepaAutomatico?: { estado: string; nota: string; trazas: Record<string, number>; erroresRegistro: number; actualizadoEn: number; programas: string[]; gastoUsd?: number };
  memoria: Recuerdo[];
  planesGuardados: PlanGuardado[];
  criteriosRevision: string[];
  avisos: Avisos;
  politicaEsperas: PoliticaEsperas;
  eventos: Evento[];
  /** Ultima vez que la persona abrio ROSA2018 (para "mientras no estabas"). */
  ultimaVisita: number | null;
  /** Registros de ROSA2018: decisiones, planes de analisis, ejecuciones,
   *  reproducciones y aprendizaje. Faltan en estados anteriores; el almacen
   *  los crea vacios. */
  decisiones?: Decision[];
  planesAnalisis?: PlanAnalisis[];
  ejecuciones?: Ejecucion[];
  reproducciones?: Reproduccion[];
  aprendizaje?: CambioAprendizaje[];
  /** El registro de metodos y ensayos (plan completo, seccion 5). */
  metodos?: MetodoRegistrado[];
  /** Las politicas tal como estan en el codigo del servidor (solo lectura). */
  politicas?: Record<string, number | string | Record<string, number> | { nivel: number; nombre: string; definicion: string }[]>;
  /** Registro de datasets del programa (rosa/datasets_programa.py): cada conjunto
   *  público que ROSA2018 vio en GEO, CELLxGENE, Synapse, ArrayExpress, Expression
   *  Atlas o que subió una persona. Falta en estados anteriores: lista vacía. */
  datasetsPrograma?: DatasetPrograma[];
  /** Salud de los modelos del gateway por rol (cerebro, juez, volumen y, si lo
   *  hay, réplica). Falta en estados anteriores: vale `{}`. */
  saludModelos?: Partial<Record<RolModelo, SaludModelo>>;
}

/** Motor causal minimo. Una arista "de causa a" lleva el tipo que dice de
 *  donde sale: supuesto (lo afirma alguien, sin dato), inferencia con
 *  evidencia (afirmaciones sostenidas lo respaldan) o base curada (consenso
 *  del campo, escrito a mano en el codigo). */
export type TipoArista = 'supuesto' | 'inferencia_con_evidencia' | 'base_curada';

export interface GrafoCausal {
  /** `capa` es el tramo de la enfermedad en el que cae un nodo de la base
   *  curada (rosa/causal.py, CAPA_DE): ordena las columnas de la pantalla de
   *  mecanismos. Opcional porque los grafos calculados antes del 22 de
   *  septiembre de 2026 no la traen. */
  nodos: { id: string; etiqueta: string; rol: string; idCanonico?: string; capa?: string }[];
  aristas: { de: string; a: string; tipo: TipoArista; contexto: string }[];
  identificacion: 'identificable' | 'acotado' | 'sin_resolver';
  supuestosCumplidos: string[];
  supuestosFaltantes: string[];
  resumen: string;
  calculadoEn: number;
}

export interface RelacionCausal {
  id: string;
  investigacionId: Id | null;
  de: string;
  a: string;
  tipo: TipoArista;
  contexto: string;
  hipotesisId: Id | null;
  actualizadoEn: number;
  /** '+' si X aumenta Y, '-' si lo disminuye, null si la hipótesis no lo dice. */
  signo?: '+' | '-' | null;
}

/** Un panel de evaluacion: hipotesis reales con un fallo plantado (cifra
 *  alterada, prediccion vaga, causalidad sin temporalidad, misma cohorte,
 *  supuesto contradicho) y un conjunto gris. Se mide si el Killer lo detecta,
 *  si lo detecta la comprobacion correcta, cuanto se abstiene y cuanto mata
 *  de mas. Se repite con cada version del prompt o del modelo. */
export interface RegistroEvaluacion {
  id: string;
  tipo: 'panel_killer';
  fecha: number;
  quien: string;
  resumen: { casos: number; hipotesis: number; tasaDeteccion: number | null; tasaJuezDetecta: number | null; abstencion: number; sobreMatanzaGris: number | null; usd: number; segundos: number; juez: string; acuerdo?: { decision: Acuerdo | null; porComprobacion: Record<string, Acuerdo> } };
  porFallo: Record<string, { casos: number; detectados?: number; decisionEsperada?: number; comprobacionFalla?: number; juezFalla?: number; suspendidas?: number; descartadas?: number; errores?: number; acuerdoConReal?: number }>;
  fallos: Record<string, string>;
  casos: { hipotesisId: string; titulo: string; fallo: string; plantado?: string; decisionReal?: string | null; detectado?: boolean | null; juezFalla?: boolean | null; decision: string; comprobacionesFallidas: string[]; juezFallidas: string[]; usd: number }[];
}

/** Una consulta a una base publica a traves de un conector (lo que Claude
 *  Science exige registrar de cada recuperacion material). */
export interface ConsultaBase {
  id: string;
  herramienta: string;
  fuente: string;
  argumentos: Record<string, string>;
  fecha: number;
  n: number | null;
  ids: string[];
  version: string | null;
  invariante: { ok: boolean; detalle: string } | null;
  error: string | null;
  ms: number;
  resumen: string;
}

export interface ContextoBases {
  diana: string;
  /** `gencode` es el identificador GENCODE con versión que exige GTEx (lo escribe contexto_de_bases en rosa/bucle/pasos.py); ausente en registros anteriores. */
  identificadores: { simbolo?: string | null; nombre?: string | null; ensembl?: string | null; uniprot?: string | null; entrez?: string | null; gencode?: string | null };
  funcion: string;
  expresionCerebro: string;
  interactores: { simbolo: string; puntuacion: number }[];
  rutas: { id: string; nombre: string }[];
  version: number;
  consultadoEn: number;
}

export type EstadoConector = 'disponible' | 'requiere_cuenta' | 'sin_api' | 'licencia' | 'fichero_local';

export interface ConectorCatalogo {
  nombre: string;
  fuente: string;
  grupo: string;
  descripcion: string;
  aporta: string;
  argumentos: string[];
  licencia: string;
  limite: string;
  urlDoc: string;
  clave: string;
  estado: EstadoConector;
  motivo: string;
  permiso?: NivelPermisoConector;
  usos: number;
  errores: number;
  ultimoUso: number | null;
}

export type NivelPermisoConector = 'permitir' | 'solo_persona' | 'bloquear';

export interface MemoriaProyecto {
  id: string;
  texto: string;
  quien: string;
  fecha: number;
}

export interface PreguntaABases {
  id: string;
  fecha: number;
  pregunta: string;
  respuesta: string;
  limites: string;
  herramientas: string[];
  consultas: ConsultaBase[];
  iteraciones: number;
  quien: string;
  error: string | null;
}

export interface SkillCatalogo {
  nombre: string;
  descripcion: string;
  activaSi: string[];
  paquetes: string[];
  entorno: string;
  scripts: string[];
  ruta: string;
  lineas: number;
}

/** El espejo del estado en Convex: SQLite sigue siendo la fuente de verdad;
 *  Convex recibe cada entidad publica para leerla desde cualquier sitio. */
export interface EstadoEspejo {
  activo: boolean;
  url: string | null;
  ultimaVersion: number | null;
  sincronizadoEn: number | null;
  entidades: number;
  pendiente: boolean;
  error: string | null;
  envios: number;
  ms: number;
}

/* ---------------------------------------------------------------------
   ROSA2018, 16 de septiembre de 2026: mapa de la enfermedad, datasets del
   programa, perfil de diana, contrato del experimento, cifras de
   aprendizaje y explicaciones alternativas. Las claves van en camelCase y
   sin tilde porque se comparan con el servidor; los textos visibles llegan
   ya escritos por regla en castellano.
   --------------------------------------------------------------------- */

/** Fase del Alzheimer en que se sitúa un dato (rosa/mapa_enfermedad.py): preclínica, prodrómica o deterioro cognitivo leve, demencia leve, demencia moderada o grave, o forma autosómica dominante. */
export type EstadioEnfermedad = 'preclinica' | 'prodromica_dcl' | 'demencia_leve' | 'demencia_moderada_grave' | 'autosomico_dominante';

/** Nivel biológico al que habla un dato (rosa/mapa_enfermedad.py): molecular, celular, tisular o clínico. */
export type NivelBiologico = 'molecular' | 'celular' | 'tisular' | 'clinico';

/** Los cuatro ejes por los que el mapa clasifica la evidencia (rosa/mapa_enfermedad.py). */
export type EjeMapa = 'estadio' | 'region' | 'tipoCelular' | 'nivel';

/** Una celda del mapa de la enfermedad (rosa/mapa_enfermedad.py mapa): estadio, región y tipo celular (null = sin situar en ese eje) con los hechos, hipótesis y preguntas que caen en ella y la mayor certeza GRADE entre sus hipótesis. */
export interface CeldaMapa {
  estadio: EstadioEnfermedad | null;
  /** Clave de región (hipocampo, corteza_entorrinal, plasma...); la etiqueta visible está en MapaEnfermedad.etiquetas.region. */
  region: string | null;
  /** Clave de tipo celular (astrocito, microglia, neurona...); etiqueta en MapaEnfermedad.etiquetas.tipoCelular. */
  tipoCelular: string | null;
  hechos: Id[];
  hipotesis: Id[];
  /** Preguntas abiertas del modelo de mundo situadas aquí; no cuentan como cobertura. */
  preguntas: Id[];
  certezaMax: CertezaEvidencia | null;
  certezaMotivo: string;
  cohortes: string[];
  /** Cuántos registros se situaron aquí solo por heredar los ejes de la misión. */
  porMision: number;
}

/** Un hueco del mapa (rosa/mapa_enfermedad.py): una combinación que la misión nombra y que ningún hecho ni hipótesis cubre por su propio contenido. */
export interface HuecoMapa {
  estadio: EstadioEnfermedad | null;
  region: string | null;
  tipoCelular: string | null;
  motivo: string;
  heredanDeMision: number;
}

/** Los ejes que fija la misión de la investigación (rosa/mapa_enfermedad.py ejes_de_mision), con el motivo por valor. */
export interface EjesMision {
  estadio: EstadioEnfermedad | null;
  /** Todas las fases que nombra la misión; `estadio` es la primera. */
  estadios: EstadioEnfermedad[];
  region: string[];
  tipoCelular: string[];
  motivos: { estadio: string | null; estadios: Record<string, string>; region: Record<string, string>; tipoCelular: Record<string, string> };
}

/** El mapa del estado de la enfermedad (rosa/mapa_enfermedad.py mapa; GET /api/investigaciones/{id}/mapa): recuento por eje, celdas, huecos que nombra la misión y resumen en llano. Fecha, iteración, etiquetas y definiciones se añaden al guardarlo en la investigación. */
export interface MapaEnfermedad {
  ejes: Record<EjeMapa, Record<string, number>>;
  celdas: CeldaMapa[];
  huecos: HuecoMapa[];
  /** Hechos que no se pudieron situar en ningún eje. */
  sinEjes: number;
  hipotesisSinEjes: number;
  /** Hechos heredados de otra investigación que sí se situaron. */
  heredados: number;
  mision: EjesMision;
  resumen: string;
  fecha?: number;
  iteracion?: number;
  /** Etiqueta visible (con tilde) de cada valor de cada eje. */
  etiquetas?: Record<EjeMapa, Record<string, string>>;
  /** Definición en una frase de cada estadio y de cada nivel, para quien los ve por primera vez. */
  definiciones?: { estadio: Record<string, string>; nivel: Record<string, string> };
}

/** De dónde salió un dataset del programa (rosa/datasets_programa.py). */
export type FuenteDatasetPrograma = 'geo' | 'cellxgene' | 'synapse' | 'arrayexpress' | 'expression_atlas' | 'manual';

/** Qué clase de dato es (rosa/datasets_programa.py): expresión en tejido (bulk), célula única, proteómica, genética, imagen u otro. */
export type TipoDatasetPrograma = 'bulk' | 'celula_unica' | 'proteomica' | 'genetica' | 'imagen' | 'otro';

/** Acceso al dataset (rosa/datasets_programa.py): abierto, con registro gratuito, controlado (el proyecto no lo pide) o sin comprobar. */
export type AccesoDatasetPrograma = 'abierto' | 'registro' | 'controlado' | 'desconocido';

/** Un dataset del registro del programa (rosa/datasets_programa.py nuevo_registro): identidad, ejes inferidos por regla con su motivo en `registro`, acceso y en qué investigaciones se usó. Lo que no se pudo inferir queda vacío, nunca inventado. */
export interface DatasetPrograma {
  id: Id;
  fuente: FuenteDatasetPrograma;
  accession: string;
  titulo: string;
  organismo: string;
  tejido: string;
  region: string;
  estadio: string;
  tipo: TipoDatasetPrograma;
  n: { muestras: number | null; donantes: number | null; celulas: number | null };
  plataforma: string;
  procesado: string;
  acceso: AccesoDatasetPrograma;
  licencia: string;
  url: string;
  fichero: string | null;
  /** Otros accessions con los que comparte muestras (dos series no son dos evidencias). */
  muestrasCompartidasCon: string[];
  usadoEn: Id[];
  registradoEn: number;
  actualizadoEn: number;
  /** Explicación por regla de cada campo inferido y de cada cambio. */
  registro: string[];
}

/** Las seis capas del perfil de una diana (rosa/dianas.py): genética humana, expresión en tejido, expresión celular, proteína y función, farmacología y literatura. */
export type CapaDiana = 'genetica_humana' | 'expresion_tejido' | 'expresion_celular' | 'proteina_funcion' | 'farmacologia' | 'literatura';

/** Estado de una capa del perfil (rosa/dianas.py): presente, ausente o no pude comprobar (una base que no respondió no es ausencia). */
export type EstadoCapaDiana = 'presente' | 'ausente' | 'no_pude_comprobar';

/** Una capa del perfil de diana (rosa/dianas.py): estado, detalle en castellano, dirección del efecto genético ('+' más función más riesgo, '-' menos función más riesgo; solo en genética humana), bases consultadas, sus registros de consulta y los datos crudos. */
export interface CapaPerfilDiana {
  capa: CapaDiana;
  estado: EstadoCapaDiana;
  detalle: string;
  direccion: '+' | '-' | null;
  fuentes: string[];
  registro: ConsultaBase[];
  datos: Record<string, unknown>;
}

/** El perfil de evidencia de una diana (rosa/dianas.py perfil_de_diana): símbolo, identificadores, seis capas, resumen en llano y todas las consultas; `version` es la versión de la hipótesis para la que se consultó. */
export interface PerfilDiana {
  diana: string;
  identificadores: { simbolo: string | null; nombre: string | null; ensembl: string | null; uniprot: string | null; entrez: string | null; gencode: string | null };
  capas: CapaPerfilDiana[];
  resumen: string;
  registro: ConsultaBase[];
  consultadoEn: number;
  /** La célula o el tejido de la tarjeta con que se eligió el tejido de GTEx. */
  contexto: string | null;
  version?: number;
}

/** Qué clase de cosa mide una lectura del experimento (rosa/experimento.py): compromiso de diana (la intervención llegó a la diana), viabilidad, función o mecanismo, biomarcador o seguridad. */
export type TipoLectura = 'compromiso_diana' | 'viabilidad' | 'funcion_mecanismo' | 'biomarcador' | 'seguridad';

/** Una medida del experimento con su criterio de confirmación y de refutación, su control y su unidad (rosa/experimento.py). Separar la lectura de compromiso de diana de la de efecto es lo que permite leer un negativo. */
export interface LecturaExperimento {
  nombre: string;
  /** Clave del vocabulario; un registro a medias puede traer otro texto y problemasContrato lo dice. */
  tipo: TipoLectura;
  queConfirma: string;
  queRefuta: string;
  control: string;
  unidad: string;
}

/** Sistema experimental (rosa/experimento.py): observacional en humanos, datos públicos ya existentes, células humanas de donante, iPSC, organoide, cocultivo, animal o in silico. */
export type TipoSistema = 'observacional_humano' | 'datos_publicos_existentes' | 'celulas_humanas_donante' | 'ipsc' | 'organoide' | 'cocultivo' | 'animal' | 'in_silico';

/** En qué sistema se hace el experimento, qué prueba y qué no representa (rosa/experimento.py). */
export interface SistemaExperimental {
  tipo: TipoSistema;
  quePrueba: string;
  queNoRepresenta: string;
}

/** Propósito de un biomarcador según BEST (FDA-NIH, 2016; rosa/experimento.py): susceptibilidad o riesgo, diagnóstico, monitorización, pronóstico, predicción de respuesta, farmacodinámico o de respuesta, seguridad. */
export type PropositoBiomarcador = 'susceptibilidad_riesgo' | 'diagnostico' | 'monitorizacion' | 'pronostico' | 'prediccion_respuesta' | 'farmacodinamico_respuesta' | 'seguridad';

/** Nivel al que se lee el desenlace (rosa/experimento.py); cuanto más abajo, más lejos del beneficio para una persona. */
export type NivelDesenlace = 'molecular' | 'celular' | 'fisiologico_imagen' | 'funcional_clinico';

/** El veredicto por regla de una lectura del contrato (rosa/experimento.py veredicto_por_lecturas): confirma, refuta, inconcluso o no evaluable (sin cifra que la nombre: no pude comprobar). */
export interface VeredictoLectura {
  lectura: string;
  tipo: TipoLectura;
  veredicto: ResultadoExperimento['veredicto'];
  motivo: string;
  /** Las cifras del resultado que se usaron, como "nombre = valor". */
  cifras: string[];
}

/** Las ramas de un negativo (rosa/experimento.py lectura_del_negativo): la diana se tocó y el efecto no apareció (cuestiona el mecanismo), la diana no se tocó (cuestiona el ensayo), o no había lecturas separadas para distinguirlo. */
export type RamaNegativo = 'diana_comprometida_sin_efecto' | 'diana_no_comprometida' | 'sin_lecturas_separadas';

/** Qué dice un negativo (rosa/experimento.py lectura_del_negativo); rama null si no es un negativo o no se pudo comprobar la rama. */
export interface LecturaDelNegativo {
  rama: RamaNegativo | null;
  explicacion: string;
}

/** Cómo se clasificó una predicción prerregistrada (rosa/cifras_aprendizaje.py): acierto, fallo, sin dirección declarada o no evaluable. */
export type ClaseAcierto = 'acierto' | 'fallo' | 'sin_direccion' | 'no_evaluable';

/** Recuento de aciertos prerregistrados (rosa/cifras_aprendizaje.py): `tasa` es null cuando no hay casos con dirección (decir "todavía no se puede medir", nunca "0 %"). */
export interface AgregadoAcierto {
  casos: number;
  conDireccion: number;
  aciertos: number;
  tasa: number | null;
  sinDireccion: number;
  noEvaluables: number;
}

/** Una predicción prerregistrada con su resultado (rosa/cifras_aprendizaje.py): de un plan de análisis congelado o de un experimento de laboratorio, con el nivel GRADE de la hipótesis y el motivo de la clase. */
export interface CasoPrerregistrado {
  fuente: 'analisis' | 'laboratorio';
  hipotesisId: Id | null;
  planId: Id | null;
  ejecucionId: Id | null;
  hashPlan: string | null;
  direccionEsperada: string;
  resultado: string | null;
  nivel: CertezaEvidencia | null;
  prerregistradoEn: number | null;
  resultadoEn: number | null;
  clase: ClaseAcierto;
  motivo: string;
}

/** Cifra 1, acierto prerregistrado (rosa/cifras_aprendizaje.py acierto_prerregistrado): el agregado total, por fuente y por nivel GRADE, lo excluido y el detalle caso a caso. */
export interface AciertoPrerregistrado extends AgregadoAcierto {
  porFuente: { analisis: AgregadoAcierto; laboratorio: AgregadoAcierto };
  porNivel: Partial<Record<CertezaEvidencia, { casos: number; aciertos: number }>>;
  excluidos: { planesSinCongelar: number; planesSinEjecucionValida: number; planesReproduccion: number; laboratorioSinPrerregistro: number };
  detalle: CasoPrerregistrado[];
  regla: string;
}

/** Cifra 2, tiempo hasta cada decisión (rosa/cifras_aprendizaje.py tiempo_hasta_decision): horas desde que nace la hipótesis hasta su primera decisión de cada etapa, mediana y p90. */
export interface TiempoHastaDecision {
  casos: number;
  hipotesis: number;
  medianaHoras: number | null;
  p90Horas: number | null;
  porEtapa: Record<string, { casos: number; medianaHoras: number | null }>;
  abiertasSinDecision: number;
  abiertasSinDecisionHoras: number | null;
  sinFechaCreacion: number;
  decisionesSinFecha: number;
  fechasInvertidas: number;
  detalle: { hipotesisId: Id | null; etapa: string; horas: number; creadaEn: number; decididaEn: number }[];
  regla: string;
}

/** Cifra 3, reutilización de lo heredado (rosa/cifras_aprendizaje.py reutilizacion_heredada): cuántos hechos copiados de otra investigación usó alguna hipótesis de esta. */
export interface ReutilizacionHeredada {
  hechosHeredados: number;
  usados: number;
  tasa: number | null;
  hipotesisConHerencia: number;
  hipotesisVivas: number;
  detalle: { hechoId: Id | null; estado: string | null; tema: string | null; usadoPor: Id[]; motivo: string }[];
  regla: string;
}

/** Las tres cifras de aprendizaje de una investigación con su texto en llano y el glosario (rosa/cifras_aprendizaje.py resumen_cifras; GET /api/investigaciones/{id}/cifras). */
export interface CifrasAprendizaje {
  investigacionId: Id;
  fecha: number;
  acierto: AciertoPrerregistrado;
  tiempo: TiempoHastaDecision;
  reutilizacion: ReutilizacionHeredada;
  /** Término a definición, para explicar prerregistro, acierto, mediana, p90 y hecho heredado la primera vez. */
  glosario: Record<string, string>;
  texto: string;
  iteracion?: number;
}

/** Clase de una explicación alternativa (rosa/causal.py y el cierre de iteración): causa inversa, confusor, selección, artefacto u otra. */
export type ClaseAlternativa = 'causa_inversa' | 'confusor' | 'seleccion' | 'artefacto' | 'otra';

/** Una explicación rival de lo observado que no exige que la hipótesis sea cierta, con qué observación la separaría (misma forma que en componentes/Alternativas.tsx). */
export interface Alternativa {
  texto: string;
  clase: ClaseAlternativa;
  queLaDistinguiria: string;
  /** Iteración en la que ROSA2018 la escribió, si se sabe. */
  iteracion?: number | null;
}
