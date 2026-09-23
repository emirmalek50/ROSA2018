// Datos de muestra de ROSA2018. Sirven para construir y juzgar la interfaz antes
// de que exista el bucle: una investigacion sobre biomarcadores plasmaticos y
// progresion, una corrida en marcha, cinco hipotesis en la cola, un modelo
// de mundo con hechos, preguntas abiertas y descartes, artefactos con
// versiones, y los 17 casos de control del RAG (sin aprobar, como estan).
//
// Todo lo que hay aqui es ilustrativo: los fragmentos citados resumen lo que
// dicen las fuentes de GUIA-ROSA.md, pero no son citas literales de las
// paginas indicadas. La interfaz lo marca como "datos de muestra" mientras
// el almacen no este conectado a ROSA2018 de verdad.

import type {
  Artefacto,
  CasoControl,
  ClaseAccion,
  Corrida,
  CorridaGepa,
  EstadoRosa,
  Evento,
  Fuente,
  HechoMundo,
  Hipotesis,
  Incidencia,
  Investigacion,
  Iteracion,
  MetricasJuez,
  NivelAutonomia,
  PermisoConcedido,
  Procedencia,
  Recuerdo,
  SolicitudPermiso,
} from './tipos';

const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 24 * HORA;
/** Un "ahora" fijo para que la muestra sea determinista en los tests. */
export const AHORA_MUESTRA = Date.UTC(2026, 8, 10, 14, 30, 0);
const hace = (ms: number) => AHORA_MUESTRA - ms;

/* ---------------------------------------------------------------------
   Fuentes
   --------------------------------------------------------------------- */

type FuenteParcial = Omit<Fuente, 'retraccionComprobadaEn' | 'tipoEstudio' | 'nivelEvidencia' | 'textoCompleto' | 'citas'> &
  Partial<Pick<Fuente, 'retraccionComprobadaEn' | 'tipoEstudio' | 'nivelEvidencia' | 'textoCompleto' | 'citas'>>;

function fuente(f: FuenteParcial): Fuente {
  return {
    retraccionComprobadaEn: hace(3 * HORA),
    tipoEstudio: 'otro',
    nivelEvidencia: 2,
    textoCompleto: true,
    citas: null,
    ...f,
  };
}

export const FUENTES: Record<string, Fuente> = {
  allegri2025: fuente({
    id: 'f-cohorte-2025',
    referencia: 'Cohorte clínica, 2025',
    titulo: 'p-tau217 en plasma frente a PET de tau en deterioro cognitivo: cohorte de FLENI',
    tipo: 'preprint',
    doi: '10.1101/2025.05.14.25326954',
    pmid: null,
    nct: null,
    pagina: 7,
    fragmento:
      'El cociente p-tau217/Abeta42 en plasma alcanzo una precision comparable a la PET de tau para distinguir a los participantes con biologia de Alzheimer, con una anticipacion de varios anos respecto al inicio de los sintomas en el subgrupo autosomico dominante.',
    retraccion: null,
    anio: 2025,
    tipoEstudio: 'cohorte',
    nivelEvidencia: 3,
    citas: 14,
  }),
  cummings2026: fuente({
    id: 'f-cummings-2026',
    referencia: 'Cummings et al., 2026',
    titulo: 'Alzheimer disease drug development pipeline: 2026',
    tipo: 'articulo',
    doi: '10.1002/trc2.70251',
    pmid: null,
    nct: null,
    pagina: 4,
    fragmento:
      'Se identificaron 158 agentes en 192 ensayos activos: 36 fármacos en fase 3, 84 en fase 2 y 45 en fase 1. Las dianas de inflamación e inmunidad pasaron del 6 % al 20 % del pipeline, y las de tau del 6 % al 20 %; el amiloide bajo del 33 % al 20 %.',
    retraccion: null,
    anio: 2026,
    tipoEstudio: 'registro',
    nivelEvidencia: 3,
    citas: 88,
  }),
  trem2apoe: fuente({
    id: 'f-trem2-apoe',
    referencia: 'Revisión TREM2 y APOE, 2025',
    titulo: 'TREM2 R47H y APOE4 en la respuesta microglial: efectos por tipo celular',
    tipo: 'articulo',
    doi: null,
    pmid: 'PMC12524931',
    nct: null,
    pagina: 12,
    fragmento:
      'La variante R47H de TREM2 reduce la unión a ligandos lipídicos y atenua la respuesta microglial ante las placas; en portadores de APOE4 el efecto se acumula, lo que sugiere una acción sinérgica sobre la microglía asociada a enfermedad.',
    retraccion: null,
    anio: 2025,
    tipoEstudio: 'revision_narrativa',
    nivelEvidencia: 2,
    citas: 41,
  }),
  nlrp3: fuente({
    id: 'f-nlrp3',
    referencia: 'Revisión neuroinflamación, 2024',
    titulo: 'El inflamasoma NLRP3 como amplificador de la cascada amiloide-tau',
    tipo: 'articulo',
    doi: null,
    pmid: 'PMC11710122',
    nct: null,
    pagina: 5,
    fragmento:
      'La activación de NLRP3 en microglía induce la liberación de IL-1beta y la formación de motas de ASC que, al ser captadas por neuronas vecinas, promueven la agregación de tau hiperfosforilada. La inhibición de NLRP3 en modelos murinos redujo la patología de tau.',
    retraccion: null,
    anio: 2024,
    tipoEstudio: 'preclinico',
    nivelEvidencia: 1,
    citas: 203,
  }),
  fdaTest: fuente({
    id: 'f-fda-2025',
    referencia: 'FDA, 2025',
    titulo: 'Autorizacion del primer test en sangre para Alzheimer (p-tau217/Abeta42)',
    tipo: 'base_curada',
    doi: null,
    pmid: null,
    nct: null,
    pagina: null,
    fragmento:
      'En mayo de 2025 la FDA autorizo el primer test de Alzheimer en sangre, basado en el cociente p-tau217/Abeta42 en plasma, para adultos de 55 anos o mas con deterioro cognitivo.',
    retraccion: null,
    anio: 2025,
    tipoEstudio: 'registro',
    nivelEvidencia: 4,
  }),
  glp1: fuente({
    id: 'f-glp1-ensayo',
    referencia: 'ClinicalTrials.gov, evoke',
    titulo: 'Semaglutida oral en Alzheimer temprano (fase 3)',
    tipo: 'ensayo',
    doi: null,
    pmid: null,
    nct: 'NCT04777396',
    pagina: null,
    fragmento:
      'Ensayo de fase 3, aleatorizado y controlado con placebo, de semaglutida oral en participantes con Alzheimer temprano; desenlace primario CDR-SB a las 104 semanas.',
    retraccion: null,
    anio: 2026,
    tipoEstudio: 'ensayo_aleatorizado',
    nivelEvidencia: 4,
    textoCompleto: false,
  }),
  retractado: fuente({
    id: 'f-retractado',
    referencia: 'Artículo retractado, 2022',
    titulo: 'Un oligomero de Abeta*56 como causa de la pérdida de memoria',
    tipo: 'articulo',
    doi: '10.1038/nature04533',
    pmid: null,
    nct: null,
    pagina: 3,
    fragmento: 'Artículo retirado por su revista tras la investigación sobre las imágenes de sus figuras.',
    retraccion: 'retractado',
    anio: 2022,
    tipoEstudio: 'preclinico',
    nivelEvidencia: 1,
    citas: 2_300,
  }),
};

/* ---------------------------------------------------------------------
   Investigacion y corrida
   --------------------------------------------------------------------- */

export const INVESTIGACION: Investigacion = {
  id: 'inv-1',
  titulo: 'Biomarcadores plasmáticos y progresión en Alzheimer familiar y esporádico',
  objetivo:
    'Encontrar hipotesis comprobables sobre que combinaciones de biomarcadores en sangre (p-tau217, Abeta42/40, NfL, GFAP) anticipan la progresion clinica, y que mecanismos (microglia, TREM2, APOE4, NLRP3) las explican.',
  relevancia:
    'Una hipótesis es relevante si propone una asociación biomarcador-progresión o un mecanismo con una diana, y dice con que biomarcador o que cohorte se comprobaría.',
  limites: [
    'Solo literatura publicada y bases curadas: sin datos de pacientes.',
    'Ignorar artículos retractados o con expresión de preocupación (Crossref).',
    'No perseguir una hipótesis más de 3 iteraciones sin revisión humana.',
  ],
  condicionParada: 'Diez hipótesis en la cola sin revisar, o 72 horas de corrida, lo que ocurra primero.',
  revisores: ['la persona responsable', 'Compañero (médico e ingeniero)', 'el investigador clínico principal (validación final)'],
  estado: 'activa',
  creadaEn: hace(3 * DIA),
  ramaDe: null,
  configuracion: {
    preferencias: 'Hipótesis mecanísticas con un biomarcador sanguíneo medible y una cohorte longitudinal donde comprobarlas; preferir Alzheimer familiar como modelo del esporádico.',
    atributos: ['Novedad frente a Open Targets, ClinicalTrials.gov y Agora', 'Testabilidad en sangre', 'Relevancia para diagnóstico temprano en Latinoamérica'],
    restricciones: ['Solo dianas con evidencia genética humana', 'Sin datos de pacientes', 'Sin artículos retractados'],
  },
  datasets: [
    {
      id: 'ds-1',
      nombre: 'proteomica_neuronas_tau.h5ad',
      descripcion: 'Proteómica de mini-pools de 10 neuronas por caso, con estado de tau (MC1) y pseudotiempo.',
      tamanoMb: 412,
      columnas: 38,
      columnasSinDiccionario: 9,
      valoresCentinela: 2,
      nombresDuplicados: 1,
      clasificacion: 'interno',
      estado: 'pendiente',
      origen: 'subida',
    },
  ],
  vigilarLiteraturaHasta: null,
};

export const CORRIDA: Corrida = {
  id: 'cor-3',
  investigacionId: 'inv-1',
  numero: 3,
  estado: 'en_marcha',
  empezadaEn: hace(31 * HORA),
  terminadaEn: null,
  iteracionActual: 14,
  gasto: {
    tokensEntrada: 48_200_000,
    tokensSalida: 3_950_000,
    llamadas: 2_318,
    segundos: 31 * 3600,
    articulosLeidos: 412,
  },
  motivoCierre: null,
  presupuesto: { limiteLlamadas: 3_000, alertas: [0.5, 0.8], avisadas: [0.5] },
  contexto: { tokensUsados: 612_000, tokensLimite: 1_000_000, compactaciones: 4, ultimaCompactacion: hace(2 * HORA) },
  busqueda: {
    identificados: 2_140,
    cribados: 611,
    textoCompleto: 412,
    usados: 57,
    consultas: [
      { base: 'PubMed', consulta: '(p-tau217 OR "phosphorylated tau 217") AND plasma AND (progression OR conversión)', fecha: hace(30 * HORA), resultados: 412 },
      { base: 'Europe PMC', consulta: 'TREM2 R47H APOE4 microglía', fecha: hace(28 * HORA), resultados: 188 },
      { base: 'bioRxiv', consulta: 'NLRP3 tau propagation', fecha: hace(26 * HORA), resultados: 41 },
      { base: 'ClinicalTrials.gov v2', consulta: 'cond=Alzheimer&intr=anti-amyloid&outcome=ARIA', fecha: hace(20 * HORA), resultados: 63 },
      { base: 'Open Targets', consulta: 'TREM2, NLRP3, GLP1R x Alzheimer disease', fecha: hace(18 * HORA), resultados: 3 },
    ],
  },
  coberturas: [
    { tema: 'Biomarcadores', leidos: 144, fraccion: 0.93, tau: 55 },
    { tema: 'Genetica', leidos: 61, fraccion: 0.78, tau: 40 },
    { tema: 'Neuroinflamacion', leidos: 97, fraccion: 0.88, tau: 45 },
    { tema: 'Farmacos', leidos: 82, fraccion: 0.61, tau: 90 },
    { tema: 'Seguridad', leidos: 28, fraccion: 0.42, tau: 50 },
  ],
  metaRevisiones: [
    {
      iteracion: 13,
      fecha: hace(50 * MIN),
      debilidades: [
        { id: 'deb-1', texto: 'Tres de cinco hipótesis asumen que la señal plasmática refleja el cerebro sin discutir la barrera hematoencefálica ni la función renal.', hipotesisAfectadas: ['hip-1', 'hip-4'], inyectada: false },
        { id: 'deb-2', texto: 'Las hipótesis mecanísticas citan modelos murinos y saltan a humanos sin decir que cohorte lo comprobaría en personas.', hipotesisAfectadas: ['hip-2'], inyectada: false },
        { id: 'deb-3', texto: 'Ninguna hipótesis estratifica por número de alelos APOE4 (0, 1, 2), que cambia el efecto.', hipotesisAfectadas: ['hip-1', 'hip-2', 'hip-4'], inyectada: true },
      ],
    },
  ],
  procesos: [
    { id: 'proc-1', nombre: 'Kernel Python (extracción, Docling)', host: 'mac-studio-2', cpu: 41, memoriaMb: 6_200, estado: 'en_marcha', empezadoEn: hace(2 * HORA) },
    { id: 'proc-2', nombre: 'Embeddings (text-embedding-3-large)', host: 'gateway', cpu: 0, memoriaMb: 0, estado: 'en_marcha', empezadoEn: hace(31 * HORA) },
  ],
  panorama: [
    {
      titulo: 'Biomarcadores sanguineos que anticipan la progresión',
      razon: 'El cociente p-tau217/Abeta42 ya iguala a la PET; lo abierto es que combinacion anticipa mas y en que subgrupo.',
      hallazgosRecientes: ['Test en sangre autorizado por la FDA en mayo de 2025', 'Cohorte de FLENI con anticipación de varios años en autosómico dominante'],
      queInvestigar: ['Cociente frente a p-tau217 solo en portadores de PSEN1', 'Orden de GFAP y NfL en preclínico según APOE4'],
      ideaEjemplo: 'Fijar umbrales en Alzheimer familiar y trasladarlos al esporádico.',
      inesperada: false,
      hipotesisIds: ['hip-1', 'hip-4'],
    },
    {
      titulo: 'Neuroinflamación como puente entre amiloide y tau',
      razon: 'Explica por que los anti-amiloide solo ralentizan un 30 %: la cascada sigue aguas abajo.',
      hallazgosRecientes: ['Inflamación e inmunidad pasan del 6 % al 20 % del pipeline de 2026', 'Inhibidores de NLRP3 en fase 1 y 2'],
      queInvestigar: ['IL-1beta y ASC en líquido cefalorraquídeo como marcadores de la cascada', 'Combinación de anti-amiloide con inhibidor de NLRP3'],
      ideaEjemplo: 'Medir ASC en LCR en amiloide positivos con PET de tau negativa y seguir la conversión.',
      inesperada: false,
      hipotesisIds: ['hip-2'],
    },
    {
      titulo: 'Reposicionamiento metabólico (GLP-1) con biomarcadores de respuesta',
      razon: 'La semaglutida ya está en fase 3; lo nuevo sería saber que biomarcador refleja la respuesta.',
      hallazgosRecientes: ['Ensayos evoke y evoke+ con CDR-SB a 104 semanas'],
      queInvestigar: ['Análisis secundario de GFAP y NfL en los ensayos'],
      ideaEjemplo: 'Pedir a los ensayos el cambio de GFAP frente a CDR-SB estratificado por APOE4.',
      inesperada: false,
      hipotesisIds: ['hip-3'],
    },
    {
      titulo: 'Área inesperada: función renal y biomarcadores plasmáticos',
      razon: 'La función renal altera NfL y p-tau en plasma; en cohortes latinoamericanas con más diabetes e hipertensión puede sesgar los umbrales.',
      hallazgosRecientes: ['Tres artículos de 2025 ajustan por filtrado glomerular y cambian los cortes'],
      queInvestigar: ['Umbrales de p-tau217 ajustados por función renal en la cohorte de FLENI'],
      ideaEjemplo: 'Reanalizar la cohorte con creatinina como covariable.',
      inesperada: true,
      hipotesisIds: [],
    },
  ],
  autoAprobarPlanSegundos: null,
};

const CORRIDA_ANTERIOR: Corrida = {
  ...CORRIDA,
  id: 'cor-2',
  numero: 2,
  estado: 'terminada',
  empezadaEn: hace(3 * DIA),
  terminadaEn: hace(2 * DIA),
  iteracionActual: 9,
  gasto: { tokensEntrada: 21_000_000, tokensSalida: 1_600_000, llamadas: 1_040, segundos: 24 * 3600, articulosLeidos: 203 },
  motivoCierre: 'Condición de parada: diez hipótesis sin revisar.',
  presupuesto: { limiteLlamadas: 1_200, alertas: [0.5, 0.8], avisadas: [0.5, 0.8] },
  contexto: { tokensUsados: 0, tokensLimite: 1_000_000, compactaciones: 2, ultimaCompactacion: null },
  coberturas: [],
  metaRevisiones: [],
  procesos: [],
  panorama: [],
};

export const ITERACION_ACTUAL: Iteracion = {
  id: 'it-14',
  corridaId: 'cor-3',
  numero: 14,
  empezadaEn: hace(6 * MIN),
  terminadaEn: null,
  planAprobado: true,
  planPropuestoEn: hace(7 * MIN),
  presupuesto: { limite: 120, usado: 63 },
  resumen: '',
  plan: [
    { id: 'p1', titulo: 'Reordenar preguntas abiertas', detalle: '3 preguntas priorizadas: NfL y GFAP en preclínico, TREM2 agonistas, ARIA y APOE4', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'p2', titulo: 'Buscar literatura', detalle: 'PubMed, Europe PMC y bioRxiv sobre las 3 preguntas', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: 30 },
    { id: 'p3', titulo: 'Extraer afirmaciones con procedencia', detalle: '18 artículos nuevos, fragmentos por página', estado: 'en_curso', indicacionHumana: false, motivoFallo: null, presupuesto: 40 },
    { id: 'p4', titulo: 'Verificar cada afirmación', detalle: 'Juez Opus 5 tras triaje de Sonnet 5', estado: 'pendiente', indicacionHumana: false, motivoFallo: null, presupuesto: 30 },
    { id: 'p5', titulo: 'Comprobar novedad', detalle: 'Open Targets, ClinicalTrials.gov y Agora', estado: 'pendiente', indicacionHumana: false, motivoFallo: null, presupuesto: 10 },
    { id: 'p6', titulo: 'Actualizar el modelo de mundo', detalle: '', estado: 'pendiente', indicacionHumana: false, motivoFallo: null, presupuesto: 10 },
  ],
  pistas: [
    {
      id: 'pi-1',
      iteracionId: 'it-14',
      pasoId: 'p2',
      tipo: 'literatura',
      titulo: 'NfL y GFAP en Alzheimer preclínico',
      fuente: 'PubMed',
      estado: 'hecha',
      resumen: '26 resultados, 9 con texto completo en PMC',
      ms: 41_000,
      transcripcion: [
        {
          t: 0,
          tipo: 'accion',
          texto: 'esearch: (neurofilament light OR GFAP) AND preclinical Alzheimer AND plasma, 2023-2026',
          consulta: { base: 'PubMed E-utilities', parametros: 'db=pubmed&term=(neurofilament light OR GFAP) AND preclinical Alzheimer AND plasma&mindate=2023&maxdate=2026&retmax=100', resultados: '26 PMID (9 con enlace a PMC)' },
        },
        { t: 1_800, tipo: 'resultado', texto: '26 PMID; 9 con enlace a PMC' },
        {
          t: 2_100,
          tipo: 'accion',
          texto: 'Comprobando retractaciones en Crossref para 9 DOI',
          consulta: { base: 'Crossref', parametros: 'GET /works/{doi} (9 llamadas), campo updated-by', resultados: '0 retractados, 0 expresiones de preocupación' },
        },
        { t: 9_400, tipo: 'resultado', texto: 'Ninguno retractado ni con expresión de preocupación' },
        { t: 41_000, tipo: 'nota', texto: 'Texto completo descargado por Unpaywall para 7 de 9; 2 sin acceso abierto quedan en resumen' },
      ],
    },
    {
      id: 'pi-2',
      iteracionId: 'it-14',
      pasoId: 'p2',
      tipo: 'literatura',
      titulo: 'Agonistas de TREM2 en ensayo',
      fuente: 'Europe PMC',
      estado: 'hecha',
      resumen: '11 resultados, 3 preprints',
      ms: 28_000,
      transcripcion: [
        {
          t: 0,
          tipo: 'accion',
          texto: 'REST: TREM2 agonist antibody Alzheimer, incluidos preprints',
          consulta: { base: 'Europe PMC REST', parametros: 'query=TREM2 agonist antibody Alzheimer&resultType=lite&pageSize=50&src=MED,PPR', resultados: '11 resultados, 3 de ellos preprints' },
        },
        { t: 2_400, tipo: 'resultado', texto: '11 resultados; 3 preprints de bioRxiv y medRxiv' },
        { t: 28_000, tipo: 'nota', texto: 'Un preprint de 2024 tiene versión publicada en 2025: se toma la publicada' },
      ],
    },
    {
      id: 'pi-3',
      iteracionId: 'it-14',
      pasoId: 'p2',
      tipo: 'ensayos',
      titulo: 'ARIA en portadores de APOE4',
      fuente: 'ClinicalTrials.gov v2',
      estado: 'fallida',
      resumen: 'Sin respuesta en 30 s: se reintenta en la siguiente iteración',
      ms: 30_000,
      transcripcion: [
        {
          t: 0,
          tipo: 'accion',
          texto: 'GET /api/v2/studies?query.cond=Alzheimer&query.term=ARIA APOE4',
          consulta: { base: 'ClinicalTrials.gov v2', parametros: 'query.cond=Alzheimer&query.term=ARIA APOE4&pageSize=100', resultados: 'sin respuesta (tiempo límite 30 s)' },
        },
        { t: 30_000, tipo: 'error', texto: 'Tiempo límite agotado (30 s). No es "sin ensayos": la consulta no llegó.' },
      ],
    },
    {
      id: 'pi-4',
      iteracionId: 'it-14',
      pasoId: 'p3',
      tipo: 'extraccion',
      titulo: 'Extraer afirmaciones de 18 artículos',
      fuente: 'Sonnet 5',
      estado: 'en_curso',
      resumen: '11 de 18 artículos, 143 afirmaciones con cita',
      ms: 0,
      transcripcion: [
        { t: 0, tipo: 'accion', texto: 'Fragmentos por página (GROBID + Docling), sin cruzar de página' },
        { t: 12_000, tipo: 'resultado', texto: 'Artículo 1 de 18: 14 afirmaciones, 3 con cifras normalizadas' },
        { t: 96_000, tipo: 'resultado', texto: 'Artículo 11 de 18: 143 afirmaciones acumuladas' },
      ],
    },
  ],
};

const ITERACION_ANTERIOR: Iteracion = {
  id: 'it-13',
  corridaId: 'cor-3',
  numero: 13,
  empezadaEn: hace(52 * MIN),
  terminadaEn: hace(7 * MIN),
  planAprobado: true,
  planPropuestoEn: hace(53 * MIN),
  presupuesto: { limite: 120, usado: 118 },
  resumen: '4 búsquedas, 22 artículos, 201 afirmaciones (183 sostenidas), 1 hipótesis nueva, 2 hechos añadidos',
  plan: [
    { id: 'a1', titulo: 'Reordenar preguntas abiertas', detalle: '', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'a2', titulo: 'Buscar literatura', detalle: '4 búsquedas', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'a3', titulo: 'Extraer afirmaciones con procedencia', detalle: '22 artículos', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'a4', titulo: 'Verificar cada afirmación', detalle: '183 de 201 sostenidas', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'a5', titulo: 'Comprobar novedad', detalle: '1 hipótesis nueva, 1 ya en ensayo', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
    { id: 'a6', titulo: 'Consultar NIAGADS para GWAS de TREM2', detalle: '', estado: 'fallido', indicacionHumana: false, motivoFallo: 'La API de NIAGADS no está entre las fuentes concedidas; se pidió permiso y la iteración siguio sin ella.', presupuesto: null },
    { id: 'a7', titulo: 'Actualizar el modelo de mundo', detalle: '2 hechos, 1 pregunta cerrada', estado: 'hecho', indicacionHumana: false, motivoFallo: null, presupuesto: null },
  ],
  pistas: [],
};

/* ---------------------------------------------------------------------
   Permisos e incidencias
   --------------------------------------------------------------------- */

export const SOLICITUDES: SolicitudPermiso[] = [
  {
    id: 'sol-1',
    corridaId: 'cor-3',
    tipo: 'presupuesto_grande',
    titulo: 'Gastar un presupuesto grande en una hipótesis',
    detalle:
      'ROSA2018 quiere dedicar 400 llamadas al modelo (unas 3 iteraciones) a perseguir la hipótesis "NLRP3 como puente entre amiloide y propagación de tau". Supera el límite de 120 por iteración.',
    recurso: '400 llamadas al modelo para hip-2',
    alcances: ['una_vez', 'esta_corrida'],
    estado: 'pendiente',
    alcanceConcedido: null,
    creadaEn: hace(9 * HORA),
    resueltaEn: null,
    hipotesisId: 'hip-2',
    argumentos: [
      { nombre: 'Llamadas', valor: '400', editable: true },
      { nombre: 'Hipotesis', valor: 'hip-2 (NLRP3)', editable: false },
      { nombre: 'Iteraciones estimadas', valor: '3', editable: false },
    ],
  },
  {
    id: 'sol-2',
    corridaId: 'cor-3',
    tipo: 'fuente_externa',
    titulo: 'Consultar una fuente externa nueva',
    detalle: 'ROSA2018 quiere consultar la API REST de NIAGADS GenomicsDB para estadísticas GWAS de TREM2 y APOE. No está entre las fuentes concedidas.',
    recurso: 'api.niagads.org',
    alcances: ['una_vez', 'esta_corrida', 'esta_investigacion', 'siempre'],
    estado: 'pendiente',
    alcanceConcedido: null,
    creadaEn: hace(90_000),
    resueltaEn: null,
    hipotesisId: null,
    argumentos: [
      { nombre: 'Host', valor: 'api.niagads.org', editable: false },
      { nombre: 'Consulta', valor: 'GWAS summary statistics: TREM2, APOE', editable: true },
      { nombre: 'Peticiones estimadas', valor: '12', editable: true },
    ],
  },
  {
    id: 'sol-3',
    corridaId: 'cor-3',
    tipo: 'fuente_externa',
    titulo: 'Consultar una fuente externa nueva',
    detalle: 'ROSA2018 quiere descargar estadísticas GWAS del GWAS Catalog (NHGRI-EBI) para 15 publicaciones de Alzheimer.',
    recurso: 'www.ebi.ac.uk/gwas',
    alcances: ['una_vez', 'esta_corrida', 'esta_investigacion', 'siempre'],
    estado: 'pendiente',
    alcanceConcedido: null,
    creadaEn: hace(40 * MIN),
    resueltaEn: null,
    hipotesisId: null,
    argumentos: [
      { nombre: 'Host', valor: 'www.ebi.ac.uk/gwas', editable: false },
      { nombre: 'Publicaciones', valor: '15', editable: true },
    ],
  },
];

export const INCIDENCIAS: Incidencia[] = [
  {
    id: 'inc-1',
    corridaId: 'cor-3',
    tipo: 'modelo_bloqueado',
    titulo: 'El extractor devolvió vacío por filtro de contenido',
    detalle:
      'En la pista "Extraer afirmaciones de 18 articulos", el articulo 7 (cineticas de agregacion del beta amiloide) devolvio una respuesta vacia con finish_reason content-filter. La pista sigue con los otros 17; ese articulo queda sin extraer hasta que se decida.',
    recurso: 'anthropic/claude-sonnet-5 (extractor)',
    alternativa: 'Reintentar ese articulo con openai/gpt-6-astra',
    estado: 'pendiente',
    creadaEn: hace(3 * MIN),
    resueltaEn: null,
    resolucion: null,
  },
  {
    id: 'inc-2',
    corridaId: 'cor-3',
    tipo: 'conector_caducado',
    titulo: 'La clave de Semantic Scholar caduco',
    detalle: 'Las llamadas al grafo académico de Semantic Scholar devuelven 401 desde hace 2 horas. ROSA2018 sigue con PubMed, Europe PMC y OpenAlex, pero sin el grafo de citas.',
    recurso: 'api.semanticscholar.org',
    alternativa: 'Reconectar con una clave nueva (gratuita, se pide en su web)',
    estado: 'pendiente',
    creadaEn: hace(2 * HORA),
    resueltaEn: null,
    resolucion: null,
  },
];

export const PERMISOS: PermisoConcedido[] = [
  { id: 'per-1', tipo: 'fuente_externa', recurso: 'eutils.ncbi.nlm.nih.gov (PubMed y PMC)', alcance: 'siempre', concedidoEn: hace(3 * DIA), investigacionId: null },
  { id: 'per-2', tipo: 'fuente_externa', recurso: 'www.ebi.ac.uk/europepmc', alcance: 'siempre', concedidoEn: hace(3 * DIA), investigacionId: null },
  { id: 'per-3', tipo: 'fuente_externa', recurso: 'api.biorxiv.org', alcance: 'esta_investigacion', concedidoEn: hace(3 * DIA), investigacionId: 'inv-1' },
  { id: 'per-4', tipo: 'fuente_externa', recurso: 'api.clinicaltrials.gov (v2)', alcance: 'siempre', concedidoEn: hace(2 * DIA), investigacionId: null },
  { id: 'per-5', tipo: 'fuente_externa', recurso: 'api.platform.opentargets.org (GraphQL)', alcance: 'esta_investigacion', concedidoEn: hace(2 * DIA), investigacionId: 'inv-1' },
  { id: 'per-6', tipo: 'acceso_corpus', recurso: 'Corpus indexado de la investigación (lectura)', alcance: 'esta_investigacion', concedidoEn: hace(3 * DIA), investigacionId: 'inv-1' },
  { id: 'per-7', tipo: 'trabajo_largo', recurso: 'Corridas de hasta 72 horas', alcance: 'esta_investigacion', concedidoEn: hace(3 * DIA), investigacionId: 'inv-1' },
];

export const AUTONOMIA: Record<ClaseAccion, NivelAutonomia> = {
  buscar_literatura: 'actuar',
  correr_analisis: 'preguntar',
  gastar_grande: 'actuar',
  escribir_modelo_mundo: 'preguntar',
  descartar_hipotesis: 'sugerir',
  contactar_laboratorio: 'sugerir',
};

/* ---------------------------------------------------------------------
   Hipotesis
   --------------------------------------------------------------------- */

function procedencia(fuentes: Fuente[], codigo: string, registro: string[], mensajes: Procedencia['mensajes']): Procedencia {
  return {
    mensajes,
    codigo,
    registro,
    entorno: {
      lenguaje: 'Python',
      version: '3.12.14',
      paquetes: [
        { nombre: 'dspy', version: '3.3.1' },
        { nombre: 'mlflow', version: '3.16.0' },
        { nombre: 'httpx', version: '0.28.1' },
        { nombre: 'pydantic', version: '2.11.4' },
      ],
      modelos: [
        { nombre: 'openai/gpt-6-astra (cerebro)', version: 'gateway' },
        { nombre: 'anthropic/claude-opus-5 (juez)', version: 'gateway' },
        { nombre: 'anthropic/claude-sonnet-5 (extractor)', version: 'gateway' },
      ],
    },
    fuentes,
  };
}

type CamposNuevos =
  | 'origen'
  | 'derivadaDe'
  | 'cluster'
  | 'evidenciaEstadistica'
  | 'relevancia'
  | 'partidos'
  | 'revisionesAutomaticas'
  | 'supuestos'
  | 'revisionesHumanas'
  | 'replicacion'
  | 'ultimaRevisionAutomatica'
  | 'coste'
  | 'experimento'
  | 'prerregistradaEn';

export type HipotesisParcial = Omit<Hipotesis, CamposNuevos> & Partial<Pick<Hipotesis, CamposNuevos>>;

/** Rellena con valores por defecto los campos que la primera version de la
 *  muestra no tenia, para que cada hipotesis solo declare lo que la distingue. */
export function completarHipotesis(h: HipotesisParcial): Hipotesis {
  return {
    origen: 'rosa',
    derivadaDe: null,
    cluster: 'Biomarcadores',
    evidenciaEstadistica: 'no_aplica',
    relevancia: { justificacion: 'Sin justificación de relevancia todavía.', votoHumano: null },
    partidos: [],
    revisionesAutomaticas: [
      { tipo: 'inicial', estado: 'hecha', resumen: 'Sin fallos evidentes; novedad plausible.', fecha: h.creadaEn },
      { tipo: 'completa', estado: 'hecha', resumen: 'Revisada con literatura.', fecha: h.creadaEn + 5 * MIN },
      { tipo: 'profunda', estado: 'pendiente', resumen: '', fecha: null },
      { tipo: 'observacion', estado: 'pendiente', resumen: '', fecha: null },
      { tipo: 'simulacion', estado: 'pendiente', resumen: '', fecha: null },
      { tipo: 'torneo', estado: 'hecha', resumen: 'Participo en el torneo de la iteración 13.', fecha: hace(50 * MIN) },
    ],
    supuestos: [],
    revisionesHumanas: [],
    replicacion: null,
    ultimaRevisionAutomatica: hace(50 * MIN),
    coste: { literatura: 2.4, analisis: 0 },
    experimento: null,
    prerregistradaEn: h.creadaEn,
    ...h,
  };
}

const HIPOTESIS_BASE: HipotesisParcial[] = [
  {
    id: 'hip-1',
    investigacionId: 'inv-1',
    titulo: 'El cociente p-tau217/Abeta42 anticipa la progresion en Alzheimer autosomico dominante mas que p-tau217 solo',
    enunciado:
      'En portadores de mutaciones en PSEN1, el cociente p-tau217/Abeta42 en plasma se altera antes que p-tau217 aislado y predice el paso a deterioro cognitivo leve con mayor anticipacion. Si es asi, las cohortes de Alzheimer familiar permitirian fijar umbrales que despues se trasladen al esporadico.',
    mecanismo:
      'La caída de Abeta42 en plasma refleja el depósito amiloide temprano, y p-tau217 sube en respuesta a ese depósito; el cociente combina las dos señales y corrige la variabilidad individual de la producción de Abeta.',
    comprobacion: {
      biomarcador: 'p-tau217/Abeta42 en plasma, seriado, frente a p-tau217 solo',
      cohorte: 'Portadores de PSEN1 E280A (Antioquia) y cohorte de Alzheimer familiar de FLENI',
      diseno: 'Cohorte longitudinal con conversión a MCI como desenlace; comparar el área bajo la curva de ambos marcadores a 3 y 5 años',
    },
    estado: 'propuesta',
    elo: 1_642,
    historialElo: [
      { iteracion: 6, elo: 1_500 },
      { iteracion: 8, elo: 1_548 },
      { iteracion: 10, elo: 1_590 },
      { iteracion: 12, elo: 1_625 },
      { iteracion: 13, elo: 1_642 },
    ],
    rivales: ['hip-2', 'hip-4'],
    novedad: {
      openTargets: { estado: 'evidencia_previa', detalle: 'MAPT y APP con asociación fuerte a Alzheimer; el cociente como predictor no es una asociación gen-enfermedad, así que no descarta la hipótesis' },
      ensayos: { estado: 'sin_ensayo', detalle: 'Ningún ensayo registrado usa el cociente como criterio de progresión en familiar', nct: null },
      agora: { estado: 'no_nominada', detalle: 'No aplica: no es una diana' },
      precedente: { estado: 'parcial', detalle: 'Dos artículos de 2025 comparan el cociente con p-tau217 solo en esporádico; ninguno en autosómico dominante con conversión a MCI como desenlace.' },
    },
    afirmaciones: [
      { texto: 'El cociente p-tau217/Abeta42 en plasma tiene precision comparable a la PET de tau.', cita: '[Cohorte clínica, 2025, pág. 7]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'El primer test de Alzheimer en sangre autorizado por la FDA se basa en ese cociente.', cita: '[FDA, 2025]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'En el subgrupo autosómico dominante la señal anticipa varios años el inicio de los síntomas.', cita: '[Cohorte clínica, 2025, pág. 7]', veredicto: 'parcial', motivo: 'La fuente dice "varios años" sin cifra; la hipótesis no debe fijar un número.', entidadDistinta: false, tipo: 'interpretacion', trayectoria: null },
    ],
    procedencia: procedencia(
      [FUENTES.allegri2025!, FUENTES.fdaTest!],
      `import dspy\n\nclass GenerarHipotesis(dspy.Signature):\n    """Propone una hipotesis comprobable a partir de hechos con procedencia."""\n    hechos: list[str] = dspy.InputField()\n    pregunta_abierta: str = dspy.InputField()\n    hipotesis: str = dspy.OutputField()\n    comprobacion: str = dspy.OutputField(desc="biomarcador, cohorte y diseno")\n\ngenerar = dspy.ChainOfThought(GenerarHipotesis)\nsalida = generar(hechos=hechos_iteracion_13, pregunta_abierta=preguntas[0])`,
      [
        '13:02:11 generar(hechos=42, pregunta="p-tau217 en familiar") -> 1 hipotesis, 1.412 tokens',
        '13:02:19 extraer_afirmaciones(hipotesis) -> 3 afirmaciones con cita',
        '13:02:20 verificar deterministas: 3 citas resuelven, 0 identificadores ausentes',
        '13:02:31 juez(opus-5) -> sostenida, sostenida, parcial',
        '13:02:32 novedad: open_targets=evidencia_previa ensayos=sin_ensayo agora=no_aplica precedente=parcial',
        '13:02:32 cola_revision.anadir(hip-1, estado=propuesta)',
      ],
      [
        { id: 'm1', de: 'rosa', texto: 'Propongo esta hipótesis a partir de la pregunta abierta "p-tau217 en Alzheimer familiar". Dos afirmaciones sostenidas y una parcial: la anticipación no tiene cifra en la fuente.', creadoEn: hace(58 * MIN) },
        { id: 'm2', de: 'revisor', texto: 'Sin hallazgos que bloqueen. La afirmación parcial está marcada.', creadoEn: hace(57 * MIN) },
      ],
    ),
    hallazgos: [],
    revisiones: [{ fecha: hace(58 * MIN), quien: 'Rosa', accion: 'propuesta', nota: 'Iteración 13', aCiegas: false }],
    creadaEn: hace(58 * MIN),
    iteracion: 13,
    cluster: 'Biomarcadores sanguineos',
    evidenciaEstadistica: 'moderada',
    relevancia: { justificacion: 'Responde al objetivo directo: que combinación anticipa más. Comprobable en la cohorte de FLENI, que es la que válida el investigador clínico principal.', votoHumano: null },
    partidos: [
      { iteracion: 8, rivalId: 'hip-2', resultado: 'perdio', resumenDebate: 'NLRP3 explica un hecho abierto (por que los anti-amiloide solo ralentizan); el cociente es una mejora incremental de un test ya autorizado.', ejeDecisivo: 'novedad' },
      { iteracion: 10, rivalId: 'hip-4', resultado: 'gano', resumenDebate: 'Ambas comprobables en FLENI; el cociente tiene más evidencia previa y un desenlace clínico más claro (conversión a MCI).', ejeDecisivo: 'correccion' },
      { iteracion: 12, rivalId: 'hip-3', resultado: 'gano', resumenDebate: 'La hipótesis de GLP-1 ya está en ensayo; el cociente en autosómico dominante no.', ejeDecisivo: 'novedad' },
      { iteracion: 13, rivalId: 'hip-2', resultado: 'perdio', resumenDebate: 'Las dos afirmaciones no sostenidas de NLRP3 pesaron, pero su utilidad terapéutica superó a la utilidad diagnóstica del cociente.', ejeDecisivo: 'utilidad' },
    ],
    supuestos: [
      {
        id: 's1',
        texto: 'Abeta42 en plasma baja cuando empieza el depósito amiloide cerebral.',
        estado: 'respaldado',
        evidencia: 'Cociente Abeta42/40 en plasma correlaciona con PET de amiloide en varias cohortes.',
        hijos: [{ id: 's1a', texto: 'La producción periférica de Abeta no enmascara la señal cerebral.', estado: 'plausible', evidencia: 'Se corrige con el cociente, pero la función renal y hepática lo alteran.', hijos: [] }],
      },
      { id: 's2', texto: 'p-tau217 sube en respuesta al depósito amiloide, antes de los síntomas.', estado: 'respaldado', evidencia: 'Anticipación de años en cohortes autosómicas dominantes.', hijos: [] },
      { id: 's3', texto: 'Lo que vale en PSEN1 vale en el esporádico.', estado: 'sin_evidencia', evidencia: 'Es la premisa del Alzheimer familiar como modelo; la edad y las comorbilidades difieren.', hijos: [] },
      { id: 's3b', texto: 'Existe un intervalo de referencia de p-tau217 en plasma para la plataforma de FLENI, definido en personas amiloide-negativas.', estado: 'sin_evidencia', evidencia: 'Ninguna afirmación sostenida da ese intervalo para esa plataforma.', hijos: [] },
      { id: 's3c', texto: 'El cociente se mide igual en todas las visitas: mismos lotes o lotes armonizables.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's3d', texto: 'La cohorte de FLENI tiene un número suficiente de portadores con plasma seriado y seguimiento a cinco años.', estado: 'sin_evidencia', evidencia: 'Ninguna afirmación da el tamaño de ese subgrupo.', hijos: [] },
    ],
    grafoCausal: {
      nodos: [
      { id: 'X', etiqueta: 'Cociente p-tau217/Abeta42 en plasma, medido en serie', rol: 'exposicion' },
      { id: 'Y', etiqueta: 'Paso a deterioro cognitivo leve a 3 y 5 años', rol: 'desenlace' },
      { id: 'A1', etiqueta: 'La función renal y hepática cambian las concentraciones plasmáticas y mueven el cociente sin que cambie el cerebro', rol: 'alternativa_confusor' },
      { id: 'A2', etiqueta: 'Deriva analítica entre lotes y plataformas de inmunoensayo a lo largo del seguimiento', rol: 'alternativa_artefacto' },
      { id: 'B:APOE4', etiqueta: 'APOE4', rol: 'base', capa: 'factores' },
      { id: 'B:edad', etiqueta: 'edad', rol: 'base', capa: 'factores' },
      { id: 'B:funcion renal', etiqueta: 'función renal', rol: 'base', capa: 'factores' },
      { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
      { id: 'B:tau', etiqueta: 'tau', rol: 'base', capa: 'patologia' },
      { id: 'B:neuroinflamacion', etiqueta: 'neuroinflamación', rol: 'base', capa: 'patologia' },
      { id: 'B:neurodegeneracion', etiqueta: 'neurodegeneración', rol: 'base', capa: 'dano' },
      { id: 'B:GFAP', etiqueta: 'GFAP', rol: 'base', capa: 'marcadores' },
      { id: 'B:p-tau181', etiqueta: 'p-tau181', rol: 'base', capa: 'marcadores' },
      { id: 'B:NfL', etiqueta: 'NfL', rol: 'base', capa: 'marcadores' },
      { id: 'B:cognicion', etiqueta: 'cognición', rol: 'base', capa: 'desenlace' },
      ],
      aristas: [
      { de: 'X', a: 'Y', tipo: 'supuesto', contexto: 'Lo que afirma la hipótesis. Queda como supuesto: que una fuente nombre las dos cosas no basta para sostener que una lleva a la otra, y ese juicio todavía no lo hace el juez' },
      { de: 'A1', a: 'X', tipo: 'supuesto', contexto: 'Causa común planteada por el Killer' },
      { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: 'Causa común planteada por el Killer' },
      { de: 'A2', a: 'Y', tipo: 'supuesto', contexto: 'Artefacto de medida planteado por el Killer' },
      { de: 'B:APOE4', a: 'B:amiloide', tipo: 'base_curada', contexto: 'Portar APOE4 adelanta y aumenta el depósito de amiloide (marco ATN)' },
      { de: 'B:amiloide', a: 'B:tau', tipo: 'base_curada', contexto: 'La patología amiloide precede y facilita la propagación de tau' },
      { de: 'B:tau', a: 'B:neurodegeneracion', tipo: 'base_curada', contexto: 'La tau patológica se asocia a la pérdida neuronal' },
      { de: 'B:neurodegeneracion', a: 'B:cognicion', tipo: 'base_curada', contexto: 'La neurodegeneración precede al deterioro cognitivo medible' },
      { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP en plasma sube con la carga amiloide' },
      { de: 'B:neurodegeneracion', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL marca daño axonal, sea cual sea la causa' },
      { de: 'B:tau', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'El p-tau181 en plasma refleja la patología tau y amiloide' },
      { de: 'B:edad', a: 'B:amiloide', tipo: 'base_curada', contexto: 'La edad es la causa común más fuerte de casi todo lo que se mide' },
      { de: 'B:edad', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL sube con la edad sin enfermedad' },
      { de: 'B:edad', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP sube con la edad sin enfermedad' },
      { de: 'B:funcion renal', a: 'B:NfL', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:funcion renal', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:neuroinflamacion', a: 'B:GFAP', tipo: 'base_curada', contexto: 'La activación glial sube el GFAP' },
      { de: 'B:amiloide', a: 'B:neuroinflamacion', tipo: 'base_curada', contexto: 'El amiloide activa microglía y astrocitos' },
      ],
      identificacion: 'acotado',
      supuestosCumplidos: ['Temporalidad: hay evidencia longitudinal o de precedencia de X sobre Y'],
      supuestosFaltantes: ['Ajuste por confusores: la evidencia no declara ajuste por función renal ni hepática', 'Replicación independiente: sin cohorte independiente no se separa el efecto de un artefacto de medida'],
      resumen: 'El efecto está acotado: 1 de 3 supuestos cumplidos; faltan 2. Lo que falta es lo que un experimento o un dataset tendría que aportar.',
      calculadoEn: 1_758_540_000_000,
    },
    coste: { literatura: 3.1, analisis: 0 },
  },
  {
    id: 'hip-2',
    investigacionId: 'inv-1',
    titulo: 'NLRP3 es el puente entre el depósito amiloide y la propagación de tau, y su inhibición frenaría la progresión aunque el amiloide siga',
    enunciado:
      'La activación del inflamasoma NLRP3 en microglía, inducida por Abeta, libera motas de ASC que las neuronas captan y que siembran la agregación de tau. Inhibir NLRP3 rompería la cascada aguas abajo del amiloide, lo que explicaría por que los anti-amiloide solo ralentizan un 30 %.',
    mecanismo:
      'Abeta activa NLRP3; NLRP3 produce IL-1beta y motas de ASC; las motas se unen a Abeta y a tau y actuan como semilla; la tau agregada activa más NLRP3. Un circuito que se retroalimenta.',
    comprobacion: {
      biomarcador: 'IL-1beta y ASC en líquido cefalorraquídeo junto a p-tau217 y NfL; GFAP como control de astroglía',
      cohorte: 'Cohorte longitudinal con PET de amiloide positiva y PET de tau negativa al inicio (ADNI, A4)',
      diseno: 'Asociar los niveles basales de IL-1beta y ASC con la conversión a PET de tau positiva a 2 años; en preclínico, inhibidor de NLRP3 en modelo con placas y tau',
    },
    estado: 'en_revision',
    elo: 1_701,
    historialElo: [
      { iteracion: 4, elo: 1_500 },
      { iteracion: 7, elo: 1_580 },
      { iteracion: 9, elo: 1_610 },
      { iteracion: 11, elo: 1_690 },
      { iteracion: 13, elo: 1_701 },
    ],
    rivales: ['hip-1', 'hip-3'],
    novedad: {
      openTargets: { estado: 'evidencia_previa', detalle: 'NLRP3 tiene asociación con Alzheimer por literatura y modelos animales (puntuación 0,41)' },
      ensayos: { estado: 'ensayo_existente', detalle: 'Hay inhibidores de NLRP3 en fase 1 y 2 para Alzheimer y Parkinson', nct: 'NCT05658575' },
      agora: { estado: 'nominada', detalle: 'NLRP3 nominada por dos equipos de AMP-AD como diana de neuroinflamación' },
      precedente: { estado: 'ya_publicado', detalle: 'La cascada Abeta, NLRP3, ASC, tau está descrita desde 2019; lo que no consta es la predicción de que la inhibición frene la progresión clínica con amiloide persistente.' },
    },
    afirmaciones: [
      { texto: 'La activación de NLRP3 en microglía libera motas de ASC que promueven la agregación de tau.', cita: '[Revisión neuroinflamación, 2024, pág. 5]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'La inhibición de NLRP3 redujo la patología de tau en modelos murinos.', cita: '[Revisión neuroinflamación, 2024, pág. 5]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'Los anti-amiloide ralentizan la progresión alrededor de un 30 %.', cita: '[Cummings et al., 2026, pág. 4]', veredicto: 'no_sostenida', motivo: 'La página 4 trae el reparto del pipeline; la cifra del 30 % está en otra parte de la revisión. La cita no resuelve al dato.', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'El lecanemab redujo el declive un 27 % en fase 3.', cita: '[Cummings et al., 2026, pág. 4]', veredicto: 'no_sostenida', motivo: 'La cifra del 27 % es del ensayo Clarity AD, no de la revisión del pipeline; además la página citada no la contiene.', entidadDistinta: true, tipo: 'literatura', trayectoria: null },
      { texto: 'La correlación entre ASC en LCR y p-tau217 en la cohorte piloto fue de 0,62.', cita: '[Trayectoria r7, celda 14]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'dato', trayectoria: { id: 'r7', celda: 14 } },
    ],
    procedencia: procedencia(
      [FUENTES.nlrp3!, FUENTES.cummings2026!],
      `class VerificarAfirmacion(dspy.Signature):\n    afirmacion: str = dspy.InputField()\n    fragmento: str = dspy.InputField()\n    encabezado: str = dspy.InputField()\n    veredicto: Literal["sostenida", "parcial", "no_sostenida"] = dspy.OutputField()\n    motivo: str = dspy.OutputField()\n    entidad_distinta: bool = dspy.OutputField()\n\njuez = dspy.Predict(VerificarAfirmacion)\nwith dspy.context(lm=opus5):\n    dictamenes = [juez(**a) for a in afirmaciones_con_fragmento]\n\n# celda 14 (trayectoria r7): correlacion ASC vs p-tau217 en la cohorte piloto\nimport numpy as np\nr = np.corrcoef(piloto["asc_lcr"], piloto["ptau217"])[0, 1]  # 0.62`,
      [
        '11:48:02 generar(hechos=39, pregunta="por que los anti-amiloide solo ralentizan") -> 1 hipotesis',
        '11:48:10 extraer_afirmaciones -> 5 afirmaciones con cita (1 dato de trayectoria r7)',
        '11:48:11 verificar deterministas: 5 citas resuelven a fragmento o celda',
        '11:48:24 juez(opus-5) -> sostenida, sostenida, no_sostenida, no_sostenida(entidad_distinta), sostenida',
        '11:48:25 novedad: open_targets=evidencia_previa(0.41) ensayos=NCT05658575 agora=nominada precedente=ya_publicado',
        '11:48:25 revisor: 2 hallazgos abiertos',
        '11:48:26 cola_revision.anadir(hip-2, estado=en_revision)',
      ],
      [
        { id: 'm3', de: 'rosa', texto: 'La hipótesis explica un hecho que el modelo de mundo tiene como abierto: por que los anti-amiloide no detienen la progresión. Dos afirmaciones no se sostienen y las voy a corregir.', creadoEn: hace(2 * HORA) },
        { id: 'm4', de: 'revisor', texto: 'Dos hallazgos: una cita que no resuelve al dato del 30 %, y una cifra del lecanemab atribuida a la revisión del pipeline cuando es de Clarity AD.', creadoEn: hace(2 * HORA) },
        { id: 'm5', de: 'rosa', texto: 'Atendido el segundo: la afirmación del 27 % se reatribuye al ensayo Clarity AD o se quita. El primero sigue abierto hasta localizar la página exacta del 30 %.', creadoEn: hace(1.5 * HORA) },
      ],
    ),
    hallazgos: [
      {
        id: 'h-1',
        tipo: 'cita_no_sostiene',
        resumen: 'La cita del 30 % apunta a la página 4 y esa página trae el reparto del pipeline, no la cifra',
        razonamiento:
          'La afirmación "los anti-amiloide ralentizan la progresión alrededor de un 30 %" lleva la cita [Cummings et al., 2026, pág. 4]. El fragmento recuperado de la página 4 habla de 158 agentes en 192 ensayos y del reparto por diana. No contiene "30 %" ni un equivalente. La cifra puede estar en la sección de discusión de la misma revisión, pero la cita tiene que resolver a la página exacta del dato.',
        estado: 'abierto',
        respuestaDeRosa: null,
      },
      {
        id: 'h-2',
        tipo: 'entidad_distinta',
        resumen: 'El 27 % del lecanemab es de Clarity AD, no de la revisión del pipeline',
        razonamiento:
          'La afirmación atribuye la reducción del 27 % del declive a Cummings et al., 2026. Ese número es el resultado primario del ensayo de fase 3 Clarity AD (van Dyck et al., 2023). La revisión del pipeline puede citarlo, pero la afirmación presenta el dato como propio de la revisión. Es un dato real de otra entidad.',
        estado: 'atendido',
        respuestaDeRosa: 'Corregido: la afirmación se reatribuye a Clarity AD con su cita, o se elimina si no se recupera el fragmento del ensayo.',
      },
      {
        id: 'h-3',
        tipo: 'sobreafirmacion',
        resumen: 'Que NLRP3 este aguas abajo del amiloide no implica que inhibirlo frene la progresión en humanos',
        razonamiento:
          'La evidencia citada es de modelos murinos. El salto de "reduce la patología de tau en ratones" a "frenaría la progresión aunque el amiloide siga" en personas necesita la comprobación propuesta; como hipótesis es legítima, pero el enunciado la afirma con más seguridad de la que la evidencia da.',
        estado: 'abierto',
        respuestaDeRosa: null,
      },
      {
        id: 'h-4',
        tipo: 'paso_sin_completar',
        resumen: 'El paso "comprobar novedad contra Agora" se dio por hecho antes de recibir la respuesta',
        razonamiento:
          'En el registro, la consulta a Agora se lanzó a las 11:48:25 y la marca de "novedad comprobada" se escribió en el mismo segundo. La respuesta de Agora llegó después. El resultado final coincide, pero el orden de las marcas no.',
        estado: 'no_aplica',
        respuestaDeRosa: 'La respuesta de Agora estaba en cache de la iteración 9 (misma consulta); el registro lo indica en la línea siguiente. No hay paso sin completar.',
      },
    ],
    revisiones: [
      { fecha: hace(2 * HORA), quien: 'Rosa', accion: 'propuesta', nota: 'Iteración 11', aCiegas: false },
      { fecha: hace(1.5 * HORA), quien: 'Rosa', accion: 'comentada', nota: 'Atendido el hallazgo de entidad distinta', aCiegas: false },
    ],
    creadaEn: hace(2 * HORA),
    iteracion: 11,
    cluster: 'Neuroinflamacion',
    evidenciaEstadistica: 'fuerte',
    relevancia: { justificacion: 'Explica el hecho abierto más importante del objetivo (por que los anti-amiloide no detienen la progresión) y propone una diana ya "drogable". El riesgo es que sea significativa pero no nueva.', votoHumano: null },
    partidos: [
      { iteracion: 8, rivalId: 'hip-1', resultado: 'gano', resumenDebate: 'NLRP3 explica un hecho abierto; el cociente es una mejora incremental.', ejeDecisivo: 'novedad' },
      { iteracion: 11, rivalId: 'hip-3', resultado: 'gano', resumenDebate: 'GLP-1 ya está en fase 3 y su mecanismo microglial no tiene cita; NLRP3 tiene mecanismo detallado.', ejeDecisivo: 'especificidad' },
      { iteracion: 13, rivalId: 'hip-1', resultado: 'gano', resumenDebate: 'Pesaron las dos afirmaciones no sostenidas, pero la utilidad terapéutica superó a la diagnóstica.', ejeDecisivo: 'utilidad' },
    ],
    revisionesAutomaticas: [
      { tipo: 'inicial', estado: 'hecha', resumen: 'Plausible y testable; novedad dudosa (cascada ya descrita).', fecha: hace(2 * HORA) },
      { tipo: 'completa', estado: 'hecha', resumen: 'Dos afirmaciones no sostenidas contra la literatura.', fecha: hace(2 * HORA) },
      { tipo: 'profunda', estado: 'hecha', resumen: 'Cuatro supuestos: dos respaldados, uno plausible, uno sin evidencia en humanos.', fecha: hace(1.8 * HORA) },
      { tipo: 'observacion', estado: 'hecha', resumen: 'Explica la observación de que la tau sigue propagandose tras retirar amiloide (pieza que faltaba); no explica los casos de tau sin amiloide (neutral).', fecha: hace(1.7 * HORA) },
      { tipo: 'simulacion', estado: 'pendiente', resumen: '', fecha: null },
      { tipo: 'torneo', estado: 'rehecha', resumen: 'Tres partidos ganados; se le criticó la sobreafirmación en dos debates.', fecha: hace(50 * MIN) },
    ],
    supuestos: [
      { id: 's4', texto: 'Abeta activa NLRP3 en microglía.', estado: 'respaldado', evidencia: 'Modelos murinos y microglía humana in vitro.', hijos: [] },
      {
        id: 's5',
        texto: 'Las motas de ASC siembran la agregación de tau en neuronas.',
        estado: 'respaldado',
        evidencia: 'Modelos murinos (2019, 2024).',
        hijos: [{ id: 's5a', texto: 'Ocurre a las concentraciones de ASC del cerebro humano.', estado: 'plausible', evidencia: 'No medido en humanos.', hijos: [] }],
      },
      { id: 's6', texto: 'Inhibir NLRP3 en personas frena la progresión con amiloide persistente.', estado: 'sin_evidencia', evidencia: 'Es la predicción de la hipótesis; los ensayos de fase 1 y 2 no miden progresión.', hijos: [] },
      { id: 's6b', texto: 'Los ensayos de inhibidores de NLRP3 publican biomarcadores plasmáticos frente a placebo.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's6c', texto: 'El GFAP en plasma refleja la activación glial que dispara NLRP3.', estado: 'sin_evidencia', evidencia: 'Ninguna afirmación liga GFAP a NLRP3.', hijos: [] },
      { id: 's7', texto: 'La tau puede propagarse sin amiloide.', estado: 'contradicho', evidencia: 'La hipótesis lo niega implícitamente, pero las tauopatías primarias muestran propagación sin placas.', hijos: [] },
    ],
    grafoCausal: {
      nodos: [
      { id: 'X', etiqueta: 'Inhibición del inflamasoma NLRP3 en microglía', rol: 'exposicion' },
      { id: 'Y', etiqueta: 'Propagación de tau medida por tau-PET a 18 meses', rol: 'desenlace' },
      { id: 'A1', etiqueta: 'La carga amiloide de partida explica a la vez la activación glial y la propagación de tau', rol: 'alternativa_confusor' },
      { id: 'A2', etiqueta: 'La propagación de tau podría ser la que activa la microglía, y no al revés', rol: 'alternativa_causa_inversa' },
      { id: 'A3', etiqueta: 'Solo entran al ensayo los que toleran el inhibidor, que no son los típicos', rol: 'alternativa_seleccion' },
      { id: 'B:APOE4', etiqueta: 'APOE4', rol: 'base', capa: 'factores' },
      { id: 'B:edad', etiqueta: 'edad', rol: 'base', capa: 'factores' },
      { id: 'B:funcion renal', etiqueta: 'función renal', rol: 'base', capa: 'factores' },
      { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
      { id: 'B:tau', etiqueta: 'tau', rol: 'base', capa: 'patologia' },
      { id: 'B:neuroinflamacion', etiqueta: 'neuroinflamación', rol: 'base', capa: 'patologia' },
      { id: 'B:neurodegeneracion', etiqueta: 'neurodegeneración', rol: 'base', capa: 'dano' },
      { id: 'B:GFAP', etiqueta: 'GFAP', rol: 'base', capa: 'marcadores' },
      { id: 'B:p-tau181', etiqueta: 'p-tau181', rol: 'base', capa: 'marcadores' },
      { id: 'B:NfL', etiqueta: 'NfL', rol: 'base', capa: 'marcadores' },
      { id: 'B:cognicion', etiqueta: 'cognición', rol: 'base', capa: 'desenlace' },
      ],
      aristas: [
      { de: 'X', a: 'Y', tipo: 'supuesto', contexto: 'Lo que afirma la hipótesis. Queda como supuesto: que una fuente nombre las dos cosas no basta para sostener que una lleva a la otra, y ese juicio todavía no lo hace el juez' },
      { de: 'A1', a: 'X', tipo: 'supuesto', contexto: 'Causa común planteada por el Killer' },
      { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: 'Causa común planteada por el Killer' },
      { de: 'A2', a: 'X', tipo: 'supuesto', contexto: 'Causa inversa planteada por el Killer' },
      { de: 'A3', a: 'Y', tipo: 'supuesto', contexto: 'Sesgo de selección planteado por el Killer' },
      { de: 'B:APOE4', a: 'B:amiloide', tipo: 'base_curada', contexto: 'Portar APOE4 adelanta y aumenta el depósito de amiloide (marco ATN)' },
      { de: 'B:amiloide', a: 'B:tau', tipo: 'base_curada', contexto: 'La patología amiloide precede y facilita la propagación de tau' },
      { de: 'B:tau', a: 'B:neurodegeneracion', tipo: 'base_curada', contexto: 'La tau patológica se asocia a la pérdida neuronal' },
      { de: 'B:neurodegeneracion', a: 'B:cognicion', tipo: 'base_curada', contexto: 'La neurodegeneración precede al deterioro cognitivo medible' },
      { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP en plasma sube con la carga amiloide' },
      { de: 'B:neurodegeneracion', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL marca daño axonal, sea cual sea la causa' },
      { de: 'B:tau', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'El p-tau181 en plasma refleja la patología tau y amiloide' },
      { de: 'B:edad', a: 'B:amiloide', tipo: 'base_curada', contexto: 'La edad es la causa común más fuerte de casi todo lo que se mide' },
      { de: 'B:edad', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL sube con la edad sin enfermedad' },
      { de: 'B:edad', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP sube con la edad sin enfermedad' },
      { de: 'B:funcion renal', a: 'B:NfL', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:funcion renal', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:neuroinflamacion', a: 'B:GFAP', tipo: 'base_curada', contexto: 'La activación glial sube el GFAP' },
      { de: 'B:amiloide', a: 'B:neuroinflamacion', tipo: 'base_curada', contexto: 'El amiloide activa microglía y astrocitos' },
      ],
      identificacion: 'acotado',
      supuestosCumplidos: ['Temporalidad: hay evidencia longitudinal o de precedencia de X sobre Y', 'Ajuste por confusores: la evidencia declara ajuste o estratificación por covariables; confusores planteados: carga amiloide de partida'],
      supuestosFaltantes: ['Replicación independiente: sin cohorte independiente no se separa el efecto de un artefacto de medida o de selección'],
      resumen: 'El efecto está acotado: 2 de 3 supuestos cumplidos; falta 1. Lo que falta es lo que un experimento o un dataset tendría que aportar.',
      calculadoEn: 1_758_540_000_000,
    },
    coste: { literatura: 5.8, analisis: 8.4 },
    ultimaRevisionAutomatica: hace(50 * MIN),
  },
  {
    id: 'hip-3',
    supuestos: [
      { id: 's8', texto: 'Los resultados de evoke y evoke+ incluyen GFAP y NfL en plasma con su incertidumbre.', estado: 'sin_evidencia', evidencia: 'Ninguna afirmación sostenida los recoge.', hijos: [] },
      { id: 's9', texto: 'Los cambios de peso corporal inducidos por el fármaco no alteran por sí solos los biomarcadores plasmáticos.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's10', texto: 'Existe un intervalo de referencia de GFAP en plasma específico de la plataforma de los ensayos.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's11', texto: 'El efecto sobre la microglía es causal y no una consecuencia de la pérdida de peso.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
    ],
    investigacionId: 'inv-1',
    titulo: 'Los agonistas de GLP-1 reducen la progresión por una vía microglial independiente del amiloide',
    enunciado:
      'La semaglutida y otros agonistas de GLP-1 reducirian la progresión clínica en Alzheimer temprano a través de la modulación de la microglía y de la insulina cerebral, sin cambiar la carga amiloide medible por PET.',
    mecanismo: 'Receptores de GLP-1 en microglía; su activación reduce la producción de citocinas proinflamatorias y mejora la señalización de insulina en hipocampo.',
    comprobacion: {
      biomarcador: 'GFAP y NfL en plasma como marcadores de respuesta; PET de amiloide como control negativo',
      cohorte: 'Participantes de los ensayos evoke y evoke+ (semaglutida oral, fase 3)',
      diseno: 'Análisis secundario: cambio en GFAP y NfL frente a CDR-SB a 104 semanas, estratificado por APOE4',
    },
    estado: 'refinar',
    elo: 1_488,
    historialElo: [
      { iteracion: 5, elo: 1_500 },
      { iteracion: 8, elo: 1_530 },
      { iteracion: 10, elo: 1_495 },
      { iteracion: 13, elo: 1_488 },
    ],
    rivales: ['hip-2'],
    novedad: {
      openTargets: { estado: 'evidencia_previa', detalle: 'GLP1R con asociación débil a Alzheimer por reposicionamiento' },
      ensayos: { estado: 'ensayo_existente', detalle: 'Semaglutida oral en fase 3 (evoke, evoke+)', nct: 'NCT04777396' },
      agora: { estado: 'no_nominada', detalle: 'GLP1R no aparece entre las dianas nominadas' },
      precedente: { estado: 'ya_publicado', detalle: 'La vía microglial de GLP-1 esta propuesta en revisiones de 2023 y 2024.' },
    },
    afirmaciones: [
      { texto: 'Hay un ensayo de fase 3 de semaglutida oral en Alzheimer temprano con CDR-SB como desenlace primario.', cita: '[ClinicalTrials.gov, evoke]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'Los agonistas de GLP-1 modulan la microglía en modelos animales.', cita: '', veredicto: 'sin_cita', motivo: 'Afirmación sin cita propia tras la última cita del tramo.', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
    ],
    procedencia: procedencia(
      [FUENTES.glp1!],
      '# Comprobacion de novedad contra ClinicalTrials.gov v2\nr = httpx.get("https://clinicaltrials.gov/api/v2/studies", params={"query.cond": "Alzheimer", "query.intr": "semaglutide"})\nestudios = r.json()["studies"]',
      [
        '09:14:40 generar -> 1 hipotesis (reposicionamiento GLP-1)',
        '09:14:47 extraer_afirmaciones -> 2 afirmaciones; 1 sin cita',
        '09:14:47 verificar deterministas: sin_cita en afirmacion 2',
        '09:14:55 juez(opus-5) -> sostenida (1 de 1 juzgada)',
        '09:14:56 novedad: ensayos=NCT04777396 (fase 3 existente) precedente=ya_publicado',
        '09:14:56 cola_revision.anadir(hip-3, estado=propuesta)',
        '10:31:02 revisión humana (Compañero): refinar. "El ensayo ya existe; lo nuevo sería el análisis secundario con GFAP y NfL. Reformular como pregunta sobre biomarcadores de respuesta."',
      ],
      [
        { id: 'm6', de: 'rosa', texto: 'Hipótesis de reposicionamiento. La novedad es dudosa: la semaglutida ya está en fase 3.', creadoEn: hace(5 * HORA) },
        { id: 'm7', de: 'investigadora', texto: 'El ensayo ya existe; lo nuevo sería el análisis secundario con GFAP y NfL. Reformular como pregunta sobre biomarcadores de respuesta.', creadoEn: hace(4 * HORA) },
      ],
    ),
    hallazgos: [
      {
        id: 'h-5',
        tipo: 'cita_no_sostiene',
        resumen: 'La afirmación sobre microglía no lleva cita',
        razonamiento: 'La segunda afirmacion queda tras la ultima cita del tramo sin cita propia. El verificador la marca sin_cita y bloquea la publicacion hasta que se cite o se quite.',
        estado: 'abierto',
        respuestaDeRosa: null,
      },
    ],
    revisiones: [
      { fecha: hace(5 * HORA), quien: 'Rosa', accion: 'propuesta', nota: 'Iteración 8', aCiegas: false },
      { fecha: hace(4 * HORA), quien: 'Compañero', accion: 'refinar', nota: 'Reformular como pregunta sobre biomarcadores de respuesta', aCiegas: false },
    ],
    creadaEn: hace(5 * HORA),
    iteracion: 8,
    cluster: 'Reposicionamiento metabólico',
    evidenciaEstadistica: 'debil',
    relevancia: { justificacion: 'Relevancia media: el fármaco ya se prueba; lo que aportaría al objetivo es el biomarcador de respuesta, no el mecanismo.', votoHumano: 'media' },
    partidos: [
      { iteracion: 11, rivalId: 'hip-2', resultado: 'perdio', resumenDebate: 'Su mecanismo microglial no tiene cita; NLRP3 tiene mecanismo detallado.', ejeDecisivo: 'especificidad' },
      { iteracion: 12, rivalId: 'hip-1', resultado: 'perdio', resumenDebate: 'Ya está en ensayo; el cociente en autosómico dominante no.', ejeDecisivo: 'novedad' },
    ],
    revisionesHumanas: [
      { fecha: hace(4 * HORA), quien: 'Compañero', supuestosCuestionados: 'Que el efecto sea independiente del amiloide: los ensayos no miden PET de amiloide como desenlace.', literaturaQueFalta: 'Los resultados de evoke y evoke+ cuando se publiquen; los análisis de GFAP en ensayos de GLP-1 en diabetes.', problemaExperimental: 'Un análisis secundario de un ensayo ajeno no es una comprobación que ROSA2018 pueda lanzar; hay que reformular como pregunta.' },
    ],
    grafoCausal: {
      nodos: [
      { id: 'X', etiqueta: 'Dosis de APOE e4, asignada por genotipo', rol: 'exposicion' },
      { id: 'Y', etiqueta: 'Trayectoria de GFAP y NfL en plasma a 24 meses', rol: 'desenlace' },
      { id: 'A1', etiqueta: 'La edad acelera por si sola el aumento de NfL y el sexo femenino el de GFAP', rol: 'alternativa_confusor' },
      { id: 'B:APOE4', etiqueta: 'APOE4', rol: 'base', capa: 'factores' },
      { id: 'B:edad', etiqueta: 'edad', rol: 'base', capa: 'factores' },
      { id: 'B:funcion renal', etiqueta: 'función renal', rol: 'base', capa: 'factores' },
      { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
      { id: 'B:tau', etiqueta: 'tau', rol: 'base', capa: 'patologia' },
      { id: 'B:neuroinflamacion', etiqueta: 'neuroinflamación', rol: 'base', capa: 'patologia' },
      { id: 'B:neurodegeneracion', etiqueta: 'neurodegeneración', rol: 'base', capa: 'dano' },
      { id: 'B:GFAP', etiqueta: 'GFAP', rol: 'base', capa: 'marcadores' },
      { id: 'B:p-tau181', etiqueta: 'p-tau181', rol: 'base', capa: 'marcadores' },
      { id: 'B:NfL', etiqueta: 'NfL', rol: 'base', capa: 'marcadores' },
      { id: 'B:cognicion', etiqueta: 'cognición', rol: 'base', capa: 'desenlace' },
      ],
      aristas: [
      { de: 'X', a: 'Y', tipo: 'supuesto', contexto: 'Lo que afirma la hipótesis. Queda como supuesto: que una fuente nombre las dos cosas no basta para sostener que una lleva a la otra, y ese juicio todavía no lo hace el juez' },
      { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: 'Causa común planteada por el Killer' },
      { de: 'B:APOE4', a: 'B:amiloide', tipo: 'base_curada', contexto: 'Portar APOE4 adelanta y aumenta el depósito de amiloide (marco ATN)' },
      { de: 'B:amiloide', a: 'B:tau', tipo: 'base_curada', contexto: 'La patología amiloide precede y facilita la propagación de tau' },
      { de: 'B:tau', a: 'B:neurodegeneracion', tipo: 'base_curada', contexto: 'La tau patológica se asocia a la pérdida neuronal' },
      { de: 'B:neurodegeneracion', a: 'B:cognicion', tipo: 'base_curada', contexto: 'La neurodegeneración precede al deterioro cognitivo medible' },
      { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP en plasma sube con la carga amiloide' },
      { de: 'B:neurodegeneracion', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL marca daño axonal, sea cual sea la causa' },
      { de: 'B:tau', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'El p-tau181 en plasma refleja la patología tau y amiloide' },
      { de: 'B:edad', a: 'B:amiloide', tipo: 'base_curada', contexto: 'La edad es la causa común más fuerte de casi todo lo que se mide' },
      { de: 'B:edad', a: 'B:NfL', tipo: 'base_curada', contexto: 'El NfL sube con la edad sin enfermedad' },
      { de: 'B:edad', a: 'B:GFAP', tipo: 'base_curada', contexto: 'El GFAP sube con la edad sin enfermedad' },
      { de: 'B:funcion renal', a: 'B:NfL', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:funcion renal', a: 'B:p-tau181', tipo: 'base_curada', contexto: 'La función renal cambia las concentraciones plasmáticas de NfL y p-tau' },
      { de: 'B:neuroinflamacion', a: 'B:GFAP', tipo: 'base_curada', contexto: 'La activación glial sube el GFAP' },
      { de: 'B:amiloide', a: 'B:neuroinflamacion', tipo: 'base_curada', contexto: 'El amiloide activa microglía y astrocitos' },
      ],
      identificacion: 'identificable',
      supuestosCumplidos: ['La exposición es genética: Y no puede causar X (la causa inversa queda excluida)', 'Ajuste por confusores: la evidencia declara ajuste o estratificación por edad y sexo', 'Replicación independiente: el efecto se vio en más de una cohorte o plataforma'],
      supuestosFaltantes: [],
      resumen: 'El efecto que afirma la hipótesis se puede estimar con la evidencia que tiene, bajo los supuestos listados.',
      calculadoEn: 1_758_540_000_000,
    },
    coste: { literatura: 1.9, analisis: 0 },
  },
  {
    id: 'hip-4',
    supuestos: [
      { id: 's12', texto: 'Hay suficientes portadores de TREM2 R47H y de APOE4 a la vez para estimar la interacción.', estado: 'sin_evidencia', evidencia: 'Ninguna afirmación da el tamaño de ese subgrupo.', hijos: [] },
      { id: 's13', texto: 'La cohorte tiene extracciones seriadas lo bastante seguidas para fechar cuándo cambia cada marcador.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's14', texto: 'La brecha temporal entre GFAP y NfL es identificable aunque no se observen los cruces exactos.', estado: 'sin_evidencia', evidencia: 'Ninguna.', hijos: [] },
      { id: 's15', texto: 'El GFAP en plasma es específico de la microglía asociada a enfermedad.', estado: 'contradicho', evidencia: 'El GFAP es una proteína de los astrocitos: sube también sin cambio microglial.', hijos: [] },
    ],
    investigacionId: 'inv-1',
    titulo: 'TREM2 R47H y APOE4 actuan en sinergia sobre la microglía asociada a enfermedad, y GFAP en plasma lo refleja antes que NfL',
    enunciado:
      'En portadores de APOE4 con la variante R47H de TREM2, la respuesta microglial atenuada se traduce en una subida temprana de GFAP en plasma (reacción astroglial compensatoria) antes de que NfL indique daño axonal. GFAP sería el primer biomarcador sanguíneo alterado en este subgrupo.',
    mecanismo: 'R47H reduce la unión de TREM2 a lípidos; APOE4 es ligando de TREM2 y además altera el metabolismo lipídico microglial; la microglía responde menos a las placas y la astroglía compensa.',
    comprobacion: {
      biomarcador: 'GFAP y NfL en plasma, seriados, junto a p-tau217',
      cohorte: 'Portadores de APOE4 genotipados para TREM2 R47H en ADNI y en la cohorte de FLENI',
      diseno: 'Comparar el momento de la primera alteración de GFAP y de NfL entre R47H y no portadores, ajustado por edad y amiloide',
    },
    estado: 'aceptada',
    elo: 1_575,
    historialElo: [
      { iteracion: 3, elo: 1_500 },
      { iteracion: 6, elo: 1_555 },
      { iteracion: 9, elo: 1_575 },
    ],
    rivales: ['hip-1'],
    novedad: {
      openTargets: { estado: 'evidencia_previa', detalle: 'TREM2 y APOE con asociación genética fuerte; la sinergia y el orden GFAP antes que NfL no constan como asociación' },
      ensayos: { estado: 'sin_ensayo', detalle: 'Ningún ensayo estratifica por TREM2 R47H y APOE4 con GFAP como desenlace', nct: null },
      agora: { estado: 'nominada', detalle: 'TREM2 nominada por tres equipos de AMP-AD' },
      precedente: { estado: 'sin_precedente', detalle: 'Ningún artículo propone el orden GFAP antes que NfL en este subgrupo genético.' },
    },
    afirmaciones: [
      { texto: 'La variante R47H de TREM2 atenua la respuesta microglial ante las placas.', cita: '[Revisión TREM2 y APOE, 2025, pág. 12]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'En portadores de APOE4 el efecto se acumula, lo que sugiere sinergia.', cita: '[Revisión TREM2 y APOE, 2025, pág. 12]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
      { texto: 'GFAP en plasma refleja la reacción astroglial.', cita: '[Revisión TREM2 y APOE, 2025, pág. 12]', veredicto: 'parcial', motivo: 'La fuente menciona GFAP como marcador astroglial en una frase; no lo estudia en este subgrupo.', entidadDistinta: false, tipo: 'interpretacion', trayectoria: null },
    ],
    procedencia: procedencia(
      [FUENTES.trem2apoe!],
      'salida = generar(hechos=hechos_iteracion_3, pregunta_abierta="orden de alteracion de GFAP y NfL en portadores de APOE4")',
      [
        'dia 1 16:20:05 generar -> 1 hipotesis',
        'dia 1 16:20:14 extraer_afirmaciones -> 3 afirmaciones',
        'dia 1 16:20:26 juez(opus-5) -> sostenida, sostenida, parcial',
        'dia 1 16:20:27 novedad: sin_ensayo, agora=nominada(TREM2), precedente=sin_precedente',
        'día 2 09:05:41 revisión humana (la persona responsable): aceptada. "Comprobable en FLENI. Pedir a el investigador clínico principal si la cohorte tiene genotipo de TREM2."',
        'dia 2 09:05:41 modelo_mundo.anadir(hipotesis aceptada, estado=abierto)',
      ],
      [
        { id: 'm8', de: 'rosa', texto: 'Hipótesis mecanística con un orden temporal comprobable en sangre. Tres afirmaciones, una parcial.', creadoEn: hace(2 * DIA) },
        { id: 'm9', de: 'investigadora', texto: 'Comprobable en FLENI. Pedir a el investigador clínico principal si la cohorte tiene genotipo de TREM2.', creadoEn: hace(1.5 * DIA) },
      ],
    ),
    hallazgos: [],
    revisiones: [
      { fecha: hace(2 * DIA), quien: 'Rosa', accion: 'propuesta', nota: 'Iteración 3', aCiegas: false },
      { fecha: hace(1.5 * DIA), quien: 'la persona responsable', accion: 'aceptada', nota: 'Comprobable en FLENI. Pedir a el investigador clínico principal si la cohorte tiene genotipo de TREM2.', aCiegas: false },
    ],
    creadaEn: hace(2 * DIA),
    iteracion: 3,
    cluster: 'Genética y microglía',
    evidenciaEstadistica: 'moderada',
    relevancia: { justificacion: 'Propone un orden temporal de biomarcadores en un subgrupo genético definido: es exactamente el tipo de hipótesis que el objetivo pide y FLENI puede comprobar.', votoHumano: 'alta' },
    partidos: [
      { iteracion: 6, rivalId: 'hip-1', resultado: 'gano', resumenDebate: 'Sin precedente publicado frente a una mejora incremental.', ejeDecisivo: 'novedad' },
      { iteracion: 10, rivalId: 'hip-1', resultado: 'perdio', resumenDebate: 'El cociente tiene más evidencia previa y un desenlace clínico más claro.', ejeDecisivo: 'correccion' },
    ],
    replicacion: { total: 5, hechas: 5, sostienen: 5, contradicen: 0, estado: 'terminada', empezadaEn: hace(1.6 * DIA) },
    experimento: {
      protocolo: 'Genotipar TREM2 R47H en los portadores de APOE4 de la cohorte de FLENI con muestras seriadas de plasma; medir GFAP y NfL (Simoa) en cada punto.',
      ensayo: 'Tiempo hasta la primera alteración de GFAP frente a NfL, por grupo genético',
      costeEstimado: 'Unas 180 muestras; genotipado más dos inmunoensayos por muestra',
      laboratorio: null,
      estado: 'propuesto',
      ficheroDatos: null,
      analisisPedido: '',
    },
    coste: { literatura: 4.2, analisis: 11.3 },
  },
  {
    id: 'hip-5',
    investigacionId: 'inv-1',
    titulo: 'Un oligomero específico de Abeta (Abeta*56) es el desencadenante de la pérdida de memoria',
    enunciado: 'Un oligomero de 56 kDa sería la especie tóxica que inicia la pérdida de memoria, y su medición en plasma anticiparía el deterioro.',
    mecanismo: 'Toxicidad sináptica directa del oligomero.',
    comprobacion: { biomarcador: 'Abeta*56 en plasma', cohorte: 'Cualquiera con seguimiento cognitivo', diseno: 'Asociación con conversión a MCI' },
    estado: 'descartada',
    elo: 1_320,
    historialElo: [
      { iteracion: 2, elo: 1_500 },
      { iteracion: 4, elo: 1_410 },
      { iteracion: 5, elo: 1_320 },
    ],
    rivales: [],
    novedad: {
      openTargets: { estado: 'evidencia_previa', detalle: 'APP con asociación fuerte' },
      ensayos: { estado: 'sin_ensayo', detalle: '', nct: null },
      agora: { estado: 'no_nominada', detalle: '' },
      precedente: { estado: 'ya_publicado', detalle: 'Publicado en 2006 y retractado en 2024.' },
    },
    afirmaciones: [
      { texto: 'Abeta*56 se correlaciona con la pérdida de memoria en ratones.', cita: '[Artículo retractado, 2022, pág. 3]', veredicto: 'cita_no_resuelve', motivo: 'La fuente está retractada según Crossref y se excluyo del corpus. No vale como evidencia.', entidadDistinta: false, tipo: 'literatura', trayectoria: null },
    ],
    procedencia: procedencia(
      [FUENTES.retractado!],
      '',
      [
        'dia 1 10:11:03 generar -> 1 hipotesis',
        'dia 1 10:11:09 retracciones.comprobar(10.1038/nature04533) -> retractado (Crossref updated-by)',
        'dia 1 10:11:09 fuente excluida del corpus; afirmacion -> cita_no_resuelve',
        'dia 1 10:11:10 cola_revision.anadir(hip-5, estado=propuesta) con bloqueo',
        'día 1 12:40:00 revisión humana (Compañero): descartada. "Se apoya en un artículo retractado."',
      ],
      [
        { id: 'm10', de: 'rosa', texto: 'La única fuente que sostiene esta hipótesis está retractada. La propongo solo para que quede constancia de por que no se persigue.', creadoEn: hace(2.5 * DIA) },
        { id: 'm11', de: 'investigadora', texto: 'Se apoya en un artículo retractado. Descartar y anotar en el modelo de mundo.', creadoEn: hace(2.4 * DIA) },
      ],
    ),
    hallazgos: [],
    revisiones: [
      { fecha: hace(2.5 * DIA), quien: 'Rosa', accion: 'propuesta', nota: 'Iteración 2', aCiegas: false },
      { fecha: hace(2.4 * DIA), quien: 'Compañero', accion: 'descartada', nota: 'Se apoya en un artículo retractado.', aCiegas: false },
    ],
    creadaEn: hace(2.5 * DIA),
    iteracion: 2,
    cluster: 'Amiloide',
    evidenciaEstadistica: 'no_aplica',
    relevancia: { justificacion: 'Relevante en apariencia; sin evidencia válida.', votoHumano: 'baja' },
    coste: { literatura: 0.6, analisis: 0 },
  },
];

/** El sello de vigencia de los supuestos (rosa/vigencia.py) en la muestra: dos
 *  al día, una evaluada con la regla anterior al 18 de septiembre y otra con una
 *  afirmación llegada después, para que "Qué desbloquea más" enseñe los dos
 *  casos sin servidor. */
function conSello(h: Hipotesis): Hipotesis {
  if (!h.supuestos.length) return h;
  const base = { en: h.creadaEn + 20 * MIN, regla: 2, afirmaciones: h.afirmaciones.length, fallidos: 0, pedidaEn: null, noAtendida: null, reconstruido: false };
  if (h.id === 'hip-2') return { ...h, supuestosEvaluados: { ...base, regla: 1, reconstruido: true } };
  if (h.id === 'hip-4') return { ...h, supuestosEvaluados: { ...base, afirmaciones: Math.max(0, h.afirmaciones.length - 1) } };
  return { ...h, supuestosEvaluados: base };
}

export const HIPOTESIS: Hipotesis[] = HIPOTESIS_BASE.map(completarHipotesis).map(conSello);

/* ---------------------------------------------------------------------
   Modelo de mundo
   --------------------------------------------------------------------- */

type HechoParcial = Omit<HechoMundo, 'citas' | 'historial'> & Partial<Pick<HechoMundo, 'citas' | 'historial'>>;

function hecho(h: HechoParcial): HechoMundo {
  return {
    citas: [],
    historial: [{ fecha: h.actualizadoEn, de: null, a: h.estado, quien: 'Rosa', motivo: 'Añadido por el bucle' }],
    ...h,
  };
}

export const HECHOS: HechoMundo[] = [
  hecho({
    id: 'he-1', investigacionId: 'inv-1', tipo: 'hecho', tema: 'Biomarcadores', estado: 'sabido', origen: 'fuente',
    enunciado: 'El cociente p-tau217/Abeta42 en plasma tiene una precision comparable a la PET y al liquido cefalorraquideo para detectar biologia de Alzheimer.',
    procedencia: [{ fuenteId: 'f-cohorte-2025', referencia: 'Cohorte clínica, 2025', pagina: 7 }, { fuenteId: 'f-fda-2025', referencia: 'FDA, 2025', pagina: null }],
    motivoDescarte: null, actualizadoEn: hace(2 * DIA), prioridad: 1,
    citas: [
      { referencia: 'Consenso de biomarcadores, 2026', seccion: 'Resultados', clasificacion: 'apoya', fragmento: 'El cociente p-tau217/Abeta42 alcanzo un AUC de 0,95 frente a PET de amiloide en tres cohortes.' },
      { referencia: 'Cohorte multiétnica, 2025', seccion: 'Discusion', clasificacion: 'contrasta', fragmento: 'En participantes con filtrado glomerular reducido la precisión del cociente cayo a 0,84; los umbrales no se trasladan sin ajustar por función renal.' },
      { referencia: 'Revisión de p-tau, 2025', seccion: 'Introduccion', clasificacion: 'menciona', fragmento: 'Varios grupos han propuesto el cociente como alternativa a la PET.' },
    ],
  }),
  hecho({
    id: 'he-2', investigacionId: 'inv-1', tipo: 'hecho', tema: 'Farmacos', estado: 'sabido', origen: 'fuente',
    enunciado: 'El pipeline de 2026 tiene 158 agentes en 192 ensayos; inflamación e inmunidad y tau suben al 20 % cada una, el amiloide baja al 20 %.',
    procedencia: [{ fuenteId: 'f-cummings-2026', referencia: 'Cummings et al., 2026', pagina: 4 }],
    motivoDescarte: null, actualizadoEn: hace(2 * DIA), prioridad: 2,
    citas: [{ referencia: 'Alzheimer Association, 2026', seccion: 'Noticias', clasificacion: 'apoya', fragmento: 'El pipeline crece y se diversifica hacia inflamación y tau.' }],
  }),
  hecho({
    id: 'he-3', investigacionId: 'inv-1', tipo: 'hecho', tema: 'Genetica', estado: 'sabido', origen: 'fuente',
    enunciado: 'TREM2 R47H atenua la respuesta microglial y su efecto se acumula con APOE4.',
    procedencia: [{ fuenteId: 'f-trem2-apoe', referencia: 'Revisión TREM2 y APOE, 2025', pagina: 12 }],
    motivoDescarte: null, actualizadoEn: hace(2 * DIA), prioridad: 3,
    citas: [
      { referencia: 'Single-cell de microglía, 2025', seccion: 'Resultados', clasificacion: 'apoya', fragmento: 'Los portadores de R47H y APOE4 muestran menos microglía asociada a enfermedad.' },
      { referencia: 'Cohorte islandesa, 2024', seccion: 'Resultados', clasificacion: 'apoya', fragmento: 'Riesgo combinado superior al aditivo.' },
    ],
  }),
  hecho({
    id: 'he-4', investigacionId: 'inv-1', tipo: 'hecho', tema: 'Neuroinflamacion', estado: 'sabido', origen: 'fuente',
    enunciado: 'NLRP3 activado en microglía libera motas de ASC que siembran la agregación de tau; su inhibición redujo la patología de tau en ratones.',
    procedencia: [{ fuenteId: 'f-nlrp3', referencia: 'Revisión neuroinflamación, 2024', pagina: 5 }],
    motivoDescarte: null, actualizadoEn: hace(1 * DIA), prioridad: 4,
    citas: [
      { referencia: 'Modelo Tau22, 2019', seccion: 'Resultados', clasificacion: 'apoya', fragmento: 'La deficiencia de NLRP3 redujo la hiperfosforilación de tau.' },
      { referencia: 'Cohorte de LCR, 2025', seccion: 'Discusion', clasificacion: 'contrasta', fragmento: 'IL-1beta en LCR no se asocio con p-tau en personas; el circuito puede no trasladarse.' },
    ],
  }),
  hecho({
    id: 'he-5', investigacionId: 'inv-1', tipo: 'hipotesis', tema: 'Genetica', estado: 'abierto', origen: 'inferencia',
    enunciado: 'Hipótesis aceptada para perseguir: TREM2 R47H y APOE4 en sinergia, con GFAP alterado antes que NfL.',
    procedencia: [{ fuenteId: 'f-trem2-apoe', referencia: 'Revisión TREM2 y APOE, 2025', pagina: 12 }],
    motivoDescarte: null, actualizadoEn: hace(1.5 * DIA), prioridad: 1,
    historial: [
      { fecha: hace(2 * DIA), de: null, a: 'abierto', quien: 'Rosa', motivo: 'Propuesta en la iteración 3' },
      { fecha: hace(1.5 * DIA), de: 'abierto', a: 'abierto', quien: 'la persona responsable', motivo: 'Aceptada: comprobable en FLENI' },
    ],
  }),
  hecho({
    id: 'he-6', investigacionId: 'inv-1', tipo: 'pregunta', tema: 'Biomarcadores', estado: 'abierto', origen: 'inferencia',
    enunciado: 'Qué orden siguen NfL y GFAP en la fase preclínica, y si depende de APOE4.',
    procedencia: [], motivoDescarte: null, actualizadoEn: hace(6 * MIN), prioridad: 1,
  }),
  hecho({
    id: 'he-7', investigacionId: 'inv-1', tipo: 'pregunta', tema: 'Farmacos', estado: 'abierto', origen: 'inferencia',
    enunciado: 'Qué agonistas de TREM2 están en ensayo y con que biomarcador de respuesta.',
    procedencia: [], motivoDescarte: null, actualizadoEn: hace(6 * MIN), prioridad: 2,
  }),
  hecho({
    id: 'he-8', investigacionId: 'inv-1', tipo: 'pregunta', tema: 'Seguridad', estado: 'abierto', origen: 'inferencia',
    enunciado: 'Cómo varía la frecuencia de ARIA con anti-amiloide según el número de alelos APOE4.',
    procedencia: [], motivoDescarte: null, actualizadoEn: hace(6 * MIN), prioridad: 3,
  }),
  hecho({
    id: 'he-9', investigacionId: 'inv-1', tipo: 'pregunta', tema: 'Farmacos', estado: 'descartado', origen: 'inferencia',
    enunciado: 'Si el cociente p-tau217/Abeta42 sirve como criterio de inclusion en ensayos de fase 3.',
    procedencia: [], motivoDescarte: 'Cerrada en la iteración 13: ya se usa como criterio de inclusión en al menos dos ensayos registrados. No es una pregunta abierta.',
    actualizadoEn: hace(50 * MIN), prioridad: 9,
    historial: [
      { fecha: hace(2 * DIA), de: null, a: 'abierto', quien: 'Rosa', motivo: 'Pregunta abierta desde la iteración 4' },
      { fecha: hace(50 * MIN), de: 'abierto', a: 'descartado', quien: 'Rosa', motivo: 'Ya se usa como criterio de inclusión en dos ensayos' },
    ],
  }),
  hecho({
    id: 'he-10', investigacionId: 'inv-1', tipo: 'hipotesis', tema: 'Amiloide', estado: 'descartado', origen: 'inferencia',
    enunciado: 'Abeta*56 como desencadenante de la pérdida de memoria.',
    procedencia: [{ fuenteId: 'f-retractado', referencia: 'Artículo retractado, 2022', pagina: 3 }],
    motivoDescarte: 'La única fuente está retractada según Crossref. Descartada por el compañero el día 1.',
    actualizadoEn: hace(2.4 * DIA), prioridad: 9,
    historial: [
      { fecha: hace(2.5 * DIA), de: null, a: 'abierto', quien: 'Rosa', motivo: 'Propuesta en la iteración 2' },
      { fecha: hace(2.4 * DIA), de: 'abierto', a: 'descartado', quien: 'Compañero', motivo: 'Se apoya en un artículo retractado' },
    ],
  }),
];

/* ---------------------------------------------------------------------
   Artefactos
   --------------------------------------------------------------------- */

export const ARTEFACTOS: Artefacto[] = [
  {
    id: 'art-1', investigacionId: 'inv-1', nombre: 'informe-iteracion.md', tipo: 'informe', destacado: true,
    versiones: [
      {
        n: 1, creadaEn: hace(3 * HORA), iteracion: 11, resumen: 'Primer informe con dos hipótesis',
        contenido: '# Informe de la corrida 3\n\n## Hipotesis en la cola\n\n1. NLRP3 como puente entre amiloide y tau (Elo 1690)\n2. Semaglutida y microglia (Elo 1495)\n\n## Preguntas abiertas\n\n- Orden de NfL y GFAP en preclinico\n- Agonistas de TREM2 en ensayo\n\n## Hechos anadidos\n\n- NLRP3 activado libera motas de ASC [Revision neuroinflamacion, 2024, pag. 5]',
      },
      {
        n: 2, creadaEn: hace(55 * MIN), iteracion: 13, resumen: 'Añade la hipótesis del cociente y cierra una pregunta',
        contenido: '# Informe de la corrida 3\n\n## Hipotesis en la cola\n\n1. NLRP3 como puente entre amiloide y tau (Elo 1701)\n2. p-tau217/Abeta42 anticipa la progresion en familiar (Elo 1642)\n3. Semaglutida y microglia (Elo 1488, refinar)\n\n## Preguntas abiertas\n\n- Orden de NfL y GFAP en preclinico\n- Agonistas de TREM2 en ensayo\n- ARIA segun alelos APOE4\n\n## Preguntas cerradas\n\n- El cociente como criterio de inclusion: ya se usa en dos ensayos\n\n## Hechos anadidos\n\n- NLRP3 activado libera motas de ASC [Revision neuroinflamacion, 2024, pag. 5]\n- El cociente p-tau217/Abeta42 iguala a la PET de tau [Cohorte clinica, 2025, pag. 7]',
      },
    ],
  },
  {
    id: 'art-2', investigacionId: 'inv-1', nombre: 'tabla-hipotesis.csv', tipo: 'tabla', destacado: false,
    versiones: [
      { n: 1, creadaEn: hace(55 * MIN), iteracion: 13, resumen: 'Ranking con Elo y estado', contenido: 'id,titulo,elo,estado\nhip-2,NLRP3 puente amiloide-tau,1701,en_revision\nhip-1,p-tau217/Abeta42 en familiar,1642,propuesta\nhip-4,TREM2 R47H y APOE4 con GFAP,1575,aceptada\nhip-3,GLP-1 y microglia,1488,refinar\nhip-5,Abeta*56,1320,descartada' },
    ],
  },
  {
    id: 'art-3', investigacionId: 'inv-1', nombre: 'modelo-de-mundo.json', tipo: 'modelo_mundo', destacado: false,
    versiones: [
      { n: 1, creadaEn: hace(1 * DIA), iteracion: 9, resumen: '6 hechos, 2 preguntas', contenido: '{\n  "hechos": 6,\n  "preguntas_abiertas": 2,\n  "descartados": 1\n}' },
      { n: 2, creadaEn: hace(55 * MIN), iteracion: 13, resumen: '8 hechos, 3 preguntas, 2 descartados', contenido: '{\n  "hechos": 8,\n  "preguntas_abiertas": 3,\n  "descartados": 2\n}' },
    ],
  },
];

/* ---------------------------------------------------------------------
   Calidad
   --------------------------------------------------------------------- */

export const CASOS: CasoControl[] = [
  { clave: 'entidad-001', categoria: 'entidad', critico: true, estado: 'propuesto', origen: 'generado', pregunta: 'Las guías NICE contienen recomendaciones complejas con criterios de inclusión y exclusión, y esta síntesis sustituye o no a sus algoritmos completos?', respuestaEsperada: 'Debe decir que no encuentra informacion sobre guias NICE en tus documentos, sin atribuirle lo que dicen de guias AHA/ASA.' },
  { clave: 'abstencion-002', categoria: 'abstencion', critico: true, estado: 'propuesto', origen: 'generado', pregunta: 'Se incluye sutezolid dentro de algún régimen para tuberculosis multirresistente y se detalla su dosis?', respuestaEsperada: 'Debe decir que sutezolid no aparece en los documentos.' },
  { clave: 'abstencion-001', categoria: 'abstencion', critico: true, estado: 'propuesto', origen: 'generado', pregunta: 'Se describe el neurofilamento de cadena ligera como biomarcador pronóstico tras accidente cerebrovascular?', respuestaEsperada: 'Debe decir que NfL no aparece en el documento de accidente cerebrovascular.' },
  { clave: 'multi_hop-003', categoria: 'multi_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Según estos resumenes, como se diferencia la confirmación diagnóstica por función pulmonar entre EPOC y asma?', respuestaEsperada: 'Espirometria post-broncodilatador con FEV1/FVC < 0,70 en EPOC; reversibilidad en asma.' },
  { clave: 'multi_hop-002', categoria: 'multi_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'En un adulto con diabetes tipo 2 e hipertensión, que dos mensajes clínicos coinciden entre los documentos?', respuestaEsperada: 'Control de la presión arterial y cambios de estilo de vida, con cita a ambos documentos.' },
  { clave: 'multi_hop-001', categoria: 'multi_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué medida preventiva comparten ambos textos y como difiere su formulación?', respuestaEsperada: 'La vacunación; un documento la fórmula como recomendación y el otro como indicación estacional.' },
  { clave: 'tabla-003', categoria: 'tabla', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Cual es el año de compilación de esta revisión sobre resistencia a los antimicrobianos?', respuestaEsperada: '2024, con cita a la página del encabezado.' },
  { clave: 'tabla-002', categoria: 'tabla', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué año aparece junto a CDC en el encabezado de esta revisión sobre accidente cerebrovascular?', respuestaEsperada: '2023.' },
  { clave: 'tabla-001', categoria: 'tabla', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Cual es el año de compilación de esta monografía sobre hipertensión arterial en adultos?', respuestaEsperada: '2024.' },
  { clave: 'single_hop-008', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué fuentes resume la monografía clínica extensa sobre EPOC?', respuestaEsperada: 'GOLD 2024 y la ficha de la OMS.' },
  { clave: 'single_hop-007', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'En que base documental se apoya esta síntesis educativa sobre diabetes mellitus tipo 2?', respuestaEsperada: 'ADA Standards of Care 2024 y la ficha de la OMS.' },
  { clave: 'single_hop-006', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué referencias institucionales se citan como base de esta monografía clínica extensa sobre asma?', respuestaEsperada: 'GINA 2024 y la ficha de la OMS.' },
  { clave: 'single_hop-005', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'En que fuentes institucionales se basa esta monografía clínica extensa sobre influenza?', respuestaEsperada: 'OMS y CDC, con sus años.' },
  { clave: 'single_hop-004', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué años tienen las WHO Consolidated Guidelines TB y la ficha OMS citadas como base documental?', respuestaEsperada: '2022 y 2023.' },
  { clave: 'single_hop-003', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Qué fuentes y que período del plan de acción mundial actualizado se indican como base documental?', respuestaEsperada: 'OMS, plan de acción 2023-2030.' },
  { clave: 'single_hop-002', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'Que anos de AHA/ASA se citan como base documental para el ictus isquemico y la hemorragia?', respuestaEsperada: '2019 y 2022.' },
  { clave: 'single_hop-001', categoria: 'single_hop', critico: false, estado: 'propuesto', origen: 'generado', pregunta: 'De que años son la directriz farmacológica de la OMS y la ficha de hipertensión usadas como base?', respuestaEsperada: '2021 y 2023.' },
];

export const METRICAS: MetricasJuez[] = [
  { fecha: hace(2 * DIA), juez: 'anthropic/claude-opus-5', casos: 17, acuerdoConHumanos: 0, sostenidas: 0.89, cobertura: 0.81, ausenciasRefutadas: 2, entidadDistinta: 1, sinVerificar: 0.04, aciertoPorTipo: { dato: null, literatura: null, interpretacion: null } },
  { fecha: hace(1 * DIA), juez: 'anthropic/claude-opus-5', casos: 17, acuerdoConHumanos: 0, sostenidas: 0.91, cobertura: 0.84, ausenciasRefutadas: 1, entidadDistinta: 1, sinVerificar: 0.03, aciertoPorTipo: { dato: 0.86, literatura: 0.83, interpretacion: 0.6 } },
  { fecha: hace(1 * DIA), juez: 'openai/gpt-6-astra (comparado)', casos: 17, acuerdoConHumanos: 0, sostenidas: 0.9, cobertura: 0.84, ausenciasRefutadas: 1, entidadDistinta: 2, sinVerificar: 0.07, aciertoPorTipo: { dato: 0.85, literatura: 0.8, interpretacion: 0.55 } },
];

export const GEPA: CorridaGepa[] = [
  { id: 'gepa-1', fecha: hace(2 * DIA), programa: 'ExtractorDeAfirmaciones', presupuesto: 'light', metricaInicial: 0.71, metricaFinal: 0.83, candidatos: 14, enlaceMlflow: 'http://localhost:5000/#/experiments/1', estado: 'terminada' },
  { id: 'gepa-2', fecha: hace(20 * HORA), programa: 'GeneradorDeHipotesis', presupuesto: 'medium', metricaInicial: 0.58, metricaFinal: 0.66, candidatos: 31, enlaceMlflow: 'http://localhost:5000/#/experiments/2', estado: 'terminada' },
  { id: 'gepa-3', fecha: hace(40 * MIN), programa: 'ExtractorDeAfirmaciones', presupuesto: 'medium', metricaInicial: 0.83, metricaFinal: 0.83, candidatos: 6, enlaceMlflow: 'http://localhost:5000/#/experiments/3', estado: 'en_marcha' },
];

export const MEMORIA: Recuerdo[] = [
  { id: 'rec-1', texto: 'la persona responsable prefiere que las hipótesis lleven siempre el biomarcador y la cohorte con los que se comprobarian.', creadoEn: hace(3 * DIA) },
  { id: 'rec-2', texto: 'Las revisiones las hace el compañero por la mañana; los avisos van a Slack, no al correo.', creadoEn: hace(2 * DIA) },
  { id: 'rec-3', texto: 'el investigador clínico principal lee las hipótesis en términos de biomarcadores y cohortes longitudinales.', creadoEn: hace(2 * DIA) },
];

export const CRITERIOS: string[] = [
  'Una hipótesis sin biomarcador o cohorte de comprobación no se acepta.',
  'Toda cifra de eficacia debe llevar el nombre del ensayo del que sale.',
  'Estratificar siempre por número de alelos APOE4 (0, 1, 2).',
];

/** Eventos de las ultimas horas, para el resumen "mientras no estabas". */
export const EVENTOS: Evento[] = [
  { id: 'ev-1', investigacionId: 'inv-1', t: hace(14 * HORA), tipo: 'iteracion_terminada', texto: 'Iteración 10 terminada: 3 búsquedas, 19 artículos, 1 hecho nuevo', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-2', investigacionId: 'inv-1', t: hace(9 * HORA), tipo: 'permiso_pendiente', texto: 'ROSA2018 pide gastar 400 llamadas en la hipótesis de NLRP3', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-3', investigacionId: 'inv-1', t: hace(8 * HORA), tipo: 'iteracion_terminada', texto: 'Iteración 11 terminada: 1 hipótesis nueva (NLRP3), 2 hallazgos abiertos del revisor', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-4', investigacionId: 'inv-1', t: hace(2 * HORA), tipo: 'hipotesis_nueva', texto: 'Hipótesis nueva en la cola: NLRP3 como puente entre amiloide y tau', ruta: '#/investigaciones/inv-1/hipotesis/hip-2' },
  { id: 'ev-5', investigacionId: 'inv-1', t: hace(2 * HORA), tipo: 'incidencia', texto: 'La clave de Semantic Scholar caduco; ROSA2018 sigue sin el grafo de citas', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-6', investigacionId: 'inv-1', t: hace(1.5 * HORA), tipo: 'presupuesto', texto: 'La corrida paso del 50 % del presupuesto global (1.500 de 3.000 llamadas)', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-7', investigacionId: 'inv-1', t: hace(58 * MIN), tipo: 'hipotesis_nueva', texto: 'Hipotesis nueva en la cola: el cociente p-tau217/Abeta42 en autosomico dominante', ruta: '#/investigaciones/inv-1/hipotesis/hip-1' },
  { id: 'ev-8', investigacionId: 'inv-1', t: hace(50 * MIN), tipo: 'ranking_cambio', texto: 'NLRP3 subió al primer puesto del ranking (Elo 1701) tras ganar a la hipótesis del cociente', ruta: '#/investigaciones/inv-1/ranking' },
  { id: 'ev-9', investigacionId: 'inv-1', t: hace(50 * MIN), tipo: 'hecho_nuevo', texto: 'Pregunta cerrada en el modelo de mundo: el cociente ya se usa como criterio de inclusión', ruta: '#/investigaciones/inv-1/mundo' },
  { id: 'ev-10', investigacionId: 'inv-1', t: hace(7 * MIN), tipo: 'iteracion_terminada', texto: 'Iteración 13 terminada: 201 afirmaciones (183 sostenidas), 1 hipótesis nueva, 2 hechos', ruta: '#/investigaciones/inv-1/corrida' },
  { id: 'ev-11', investigacionId: 'inv-1', t: hace(3 * MIN), tipo: 'incidencia', texto: 'El extractor devolvió vacío por filtro de contenido en un artículo', ruta: '#/investigaciones/inv-1/corrida' },
];

export function estadoDeMuestra(): EstadoRosa {
  return {
    conexion: 'muestra',
    investigaciones: [INVESTIGACION],
    corridas: [CORRIDA, CORRIDA_ANTERIOR],
    iteraciones: [ITERACION_ANTERIOR, ITERACION_ACTUAL],
    solicitudes: SOLICITUDES,
    incidencias: INCIDENCIAS,
    permisos: PERMISOS,
    autonomia: AUTONOMIA,
    hipotesis: HIPOTESIS,
    comentarios: [],
    hechos: HECHOS,
    datasetsPrograma: [],
    artefactos: ARTEFACTOS,
    casos: CASOS,
    metricas: METRICAS,
    gepa: GEPA,
    memoria: MEMORIA,
    planesGuardados: [
      { id: 'plan-1', nombre: 'Validación de diana en single-cell', pasos: ['Descargar el conjunto de GEO', 'Control de calidad y normalización', 'Expresión por tipo celular', 'Comparar con Agora'], vecesUsado: 3, exitos: 2 },
      { id: 'plan-2', nombre: 'Comprobación de novedad estándar', pasos: ['Open Targets', 'ClinicalTrials.gov v2', 'Agora', 'Precedente en literatura'], vecesUsado: 11, exitos: 11 },
    ],
    criteriosRevision: CRITERIOS,
    avisos: {
      correo: { activo: false, direccion: '' },
      slack: { activo: true, canal: '#rosa-hallazgos' },
      cuando: { hipotesisNueva: true, permisoPendiente: true, corridaDetenida: true, resumenDiario: true },
    },
    politicaEsperas: { horas: 24, accion: 'recordar', escalarA: 'Compañero' },
    eventos: EVENTOS,
    ultimaVisita: hace(10 * HORA),
  };
}
