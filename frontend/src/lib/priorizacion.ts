// Priorización con bloqueos no compensables y diversidad (ROSA2018, etapa
// 8). Misma regla que `rosa/priorizacion.py`: una hipótesis con un bloqueo
// no es candidata al laboratorio aunque gane todos los debates; entre las
// que no tienen bloqueos y el Killer dejó avanzar, se eligen hasta N por
// Elo sin repetir cluster mientras haya otros. Sin React: lo prueba vitest.
//
// Aquí vive también el recuento de cohortes distintas, portado del catálogo
// canónico de rosa/metodos.py (alias, registros NCT y regla de tokens), para
// que la franja del ranking y la ficha cuenten lo mismo que el techo GRADE
// del servidor cuando el servidor no manda la cuenta (registros antiguos).

import type { Bloqueo, EstadoRosa, Hipotesis } from '../datos/tipos';
import { veredictoDe } from './etiquetas';
import { traducido } from './idioma';

export const MAX_CANDIDATOS = 3;

export const ETIQUETA_BLOQUEO: Record<Bloqueo, string> = traducido({
  trazabilidad_insuficiente: 'Trazabilidad insuficiente',
  datos_no_autorizados: 'Datos no autorizados',
  analisis_invalido: 'Análisis inválido según el auditor',
  sin_experimento_interpretable: 'Sin experimento interpretable',
  descartada_por_killer: 'Descartada en este contexto',
  fuente_retractada: 'Depende de una fuente retractada',
  revision_registro_abierta: 'Hallazgo grave del revisor sin atender',
  dependencia_pendiente: 'Depende de algo que cambió y no se revisó',
});

export const EXPLICACION_BLOQUEO: Record<Bloqueo, string> = traducido({
  trazabilidad_insuficiente: 'No hay afirmaciones sostenidas por su fuente, o alguna afirmación está bloqueada (cita que no resuelve, dato de otra entidad, ausencia desmentida, o un veredicto que esta versión de la interfaz no conoce y por tanto no puede dar por bueno).',
  datos_no_autorizados: 'Algún análisis usó un dataset sin contrato aprobado o sin autorización de uso con IA.',
  analisis_invalido: 'El auditor independiente (Killer II) dio por no válido el último análisis con datos.',
  sin_experimento_interpretable: 'El experimento no dice qué resultado la confirmaría y cuál la refutaría.',
  descartada_por_killer: 'El Killer o una persona la descartó en este contexto.',
  fuente_retractada: 'Una de sus fuentes está retractada.',
  revision_registro_abierta: 'El revisor de registro encontró algo grave (un identificador que no está en el registro, una ejecución afirmada y no completada, un recuento que no cuadra) en el dossier o en la última iteración cerrada, y nadie lo atendió todavía.',
  dependencia_pendiente: 'Algo de lo que depende cambió (una fuente se retractó, un hecho del modelo de mundo fue sustituido o contradicho) y ROSA2018 todavía no volvió a concluirla ni una persona la revisó.',
});

type Estado = Pick<EstadoRosa, 'investigaciones' | 'planesAnalisis' | 'ejecuciones' | 'hipotesis'> & Partial<Pick<EstadoRosa, 'artefactos' | 'corridas' | 'iteraciones'>>;

export function bloqueosDe(estado: Estado, h: Hipotesis): Bloqueo[] {
  const b: Bloqueo[] = [];
  const sostenidas = h.afirmaciones.filter((a) => a.veredicto === 'sostenida' || a.veredicto === 'parcial');
  // Un veredicto que esta versión no conoce bloquea (veredictoDe lo trata como
  // "no comprobado"): nunca se da por buena una afirmación sin saber qué dice.
  if (sostenidas.length === 0 || h.afirmaciones.some((a) => veredictoDe(a.veredicto).bloquea)) b.push('trazabilidad_insuficiente');
  const inv = estado.investigaciones.find((i) => i.id === h.investigacionId);
  const datasets = new Map((inv?.datasets ?? []).map((d) => [d.id, d]));
  const planes = new Map((estado.planesAnalisis ?? []).map((p) => [p.id, p]));
  const ejecuciones = (estado.ejecuciones ?? []).filter((x) => x.hipotesisId === h.id);
  for (const x of ejecuciones) {
    const plan = planes.get(x.planId);
    const ds = plan ? datasets.get(plan.datasetId) : undefined;
    if (!ds || ds.estado !== 'aprobado' || ds.procedencia?.usoIAAutorizado !== 'si') {
      b.push('datos_no_autorizados');
      break;
    }
  }
  const auditadas = ejecuciones.filter((x) => x.auditoria);
  const ultima = auditadas[auditadas.length - 1];
  if (ultima && ultima.auditoria?.veredicto === 'no_valido') b.push('analisis_invalido');
  const x = h.experimento;
  // Interpretable: criterios separados, o un prerregistro congelado con el esquema anterior.
  const criterios = !!x && (x.confirma ?? '').trim() !== '' && (x.refuta ?? '').trim() !== '';
  const prerregistradoAntiguo = !!x && !!x.prerregistradoEn && (x.ensayo ?? '').trim() !== '';
  if (!x || (!criterios && !prerregistradoAntiguo)) b.push('sin_experimento_interpretable');
  if (h.estado === 'descartada' || h.decisionKiller === 'descartar_en_contexto') b.push('descartada_por_killer');
  if (h.procedencia.fuentes.some((f) => f.retraccion === 'retractado')) b.push('fuente_retractada');
  if (revisionRegistroAbierta(estado, h)) b.push('revision_registro_abierta');
  // Propagación de dependencias: misma regla que rosa/priorizacion.py.
  if (h.pendienteRevision) b.push('dependencia_pendiente');
  return b;
}

/** Puerta de publicación: un hallazgo grave y abierto del revisor de registro,
 *  en el dossier de la hipótesis o en la última iteración cerrada de su
 *  investigación, retiene la candidatura. Misma regla que rosa/priorizacion.py.
 *
 *  'rebatido' cuenta igual que 'abierto': la rebatida la escribe quien escribió el
 *  texto, y eso no es una absolución. Solo cierran un hallazgo el revisor
 *  ('atendido', porque comprobó el arreglo) o una persona ('descartado'). */
export function revisionRegistroAbierta(estado: Estado, h: Hipotesis): boolean {
  const graveAbierto = (hallazgos: { estado?: string; gravedad?: string }[] | undefined | null) =>
    (hallazgos ?? []).some((x) => (x.estado === 'abierto' || x.estado === 'rebatido') && x.gravedad === 'alta');
  if (h.dossierArtefactoId) {
    const art = (estado.artefactos ?? []).find((a) => a.id === h.dossierArtefactoId);
    const revision = art?.versiones[art.versiones.length - 1]?.procedencia?.revision;
    if (art && graveAbierto(revision?.hallazgos)) return true;
  }
  const corridas = new Set((estado.corridas ?? []).filter((c) => c.investigacionId === h.investigacionId).map((c) => c.id));
  const cerradas = (estado.iteraciones ?? []).filter((it) => corridas.has(it.corridaId) && it.terminadaEn !== null);
  if (cerradas.length === 0) return false;
  const ultima = cerradas.reduce((m, it) => ((it.terminadaEn ?? 0) > (m.terminadaEn ?? 0) ? it : m));
  return graveAbierto(ultima.revisionRegistro?.hallazgos as { estado?: string; gravedad?: string }[] | undefined);
}

/** Las que hoy irían al laboratorio, en orden: sin bloqueos, con el Killer
 *  en "avanzar", por Elo, sin repetir cluster mientras haya otros. */
export function candidatos(estado: Estado, investigacionId: string, maximo = MAX_CANDIDATOS): Hipotesis[] {
  const vivas = estado.hipotesis
    .filter((h) => h.investigacionId === investigacionId && h.estado !== 'descartada' && h.decisionKiller === 'avanzar' && bloqueosDe(estado, h).length === 0)
    .sort((a, b) => (b.bt?.fuerza ?? b.elo) - (a.bt?.fuerza ?? a.elo) || a.creadaEn - b.creadaEn);
  const elegidas: Hipotesis[] = [];
  const clusters = new Set<string>();
  const pendientes = [...vivas];
  while (pendientes.length > 0 && elegidas.length < maximo) {
    const idx = pendientes.findIndex((h) => !clusters.has(h.cluster.toLowerCase()));
    const siguiente = pendientes.splice(idx === -1 ? 0 : idx, 1)[0]!;
    elegidas.push(siguiente);
    clusters.add(siguiente.cluster.toLowerCase());
  }
  return elegidas;
}

/* ---------------------------------------------------------------------
   Cohortes distintas: espejo de rosa/metodos.py (catálogo canónico).

   Conceptos por su nombre: una "cohorte" es el grupo de personas o muestras
   del que salen los datos de una fuente (ADNI, BioFINDER, A4...). Dos
   artículos de la misma cohorte son una sola evidencia, no dos; por eso GRADE
   pide cohortes distintas para subir de certeza. El catálogo resuelve alias
   y nombres largos a una etiqueta canónica ("Alzheimer's Disease Neuroimaging
   Initiative" y "ADNI-3" son ADNI); un registro NCT de ClinicalTrials.gov es
   su propio grupo salvo que sea el ensayo de una cohorte conocida; y dos
   nombres que no están en el catálogo se unen si comparten una palabra que no
   sea genérica ("cohorte", "study", "Alzheimer"...). La regla la fija el
   servidor: esta copia solo se usa cuando el registro no trae la cuenta.
   --------------------------------------------------------------------- */

interface AliasSpec {
  a: string;
  excepto?: string;
  noTras?: string[];
  salvoSi?: string;
}

interface EntradaCohorte {
  id: string;
  etiqueta: string;
  alias: (string | AliasSpec)[];
  nct?: string[];
  /** false: la etiqueta a solas no se busca como texto (A4, Framingham...). */
  busca?: boolean;
}

/** Copia de `_COHORTES_DEF` en rosa/metodos.py (17 de septiembre de 2026, con
 *  los ensayos de fase 2 y 3 que entraron ese día por M-03). Si allí entra una
 *  cohorte nueva, hay que copiarla aquí; el test priorizacion.cohortes.test.ts
 *  compara las dos reglas sobre el estado real y avisa si se desincronizan. */
const CATALOGO_COHORTES: EntradaCohorte[] = traducido([
  { id: 'cohorte:adni', etiqueta: 'ADNI', alias: ["Alzheimer's Disease Neuroimaging Initiative", 'ADNI-1', 'ADNI-2', 'ADNI-3', 'ADNI-GO', 'ADNI-DOD'] },
  { id: 'cohorte:j_adni', etiqueta: 'J-ADNI', alias: ['Japanese ADNI', "Japanese Alzheimer's Disease Neuroimaging Initiative"] },
  { id: 'cohorte:biofinder', etiqueta: 'BioFINDER', alias: ['Swedish BioFINDER', 'BioFINDER-1', 'BioFINDER-2', 'Biomarkers For Identifying Neurodegenerative Disorders Early and Reliably'] },
  { id: 'cohorte:a4', etiqueta: 'A4', alias: [{ a: 'A4', excepto: '\\s+(?:paper|sheet|size|format)', noTras: ['Table', 'Tab.', 'Fig.', 'Figure', 'Appendix', 'Section', 'eTable', 'eFigure', 'Panel'] }, "Anti-Amyloid Treatment in Asymptomatic Alzheimer's", 'A4 Study'], nct: ["NCT02008357"], busca: false },
  { id: 'cohorte:ahead', etiqueta: 'AHEAD 3-45', alias: ['AHEAD Study', 'AHEAD 3-45 Study'], nct: ["NCT04468659"] },
  { id: 'cohorte:aibl', etiqueta: 'AIBL', alias: ['Australian Imaging, Biomarkers and Lifestyle', 'Australian Imaging, Biomarker and Lifestyle'] },
  { id: 'cohorte:rosmap', etiqueta: 'ROSMAP', alias: ['ROS/MAP', 'ROS-MAP', 'Religious Orders Study', 'Rush Memory and Aging Project', { a: 'Memory and Aging Project', excepto: '(?:\\s*\\(MAP\\))?\\s+(?:at|of)\\s+(?:the\\s+)?(?:Knight|Washington|WashU)' }] },
  { id: 'cohorte:msbb', etiqueta: 'MSBB', alias: ['Mount Sinai Brain Bank'] },
  { id: 'cohorte:mcsa', etiqueta: 'MCSA', alias: ['Mayo Clinic Study of Aging'] },
  { id: 'cohorte:nacc', etiqueta: 'NACC', alias: ["National Alzheimer's Coordinating Center", 'NACC UDS', 'Uniform Data Set'] },
  { id: 'cohorte:uk_biobank', etiqueta: 'UK Biobank', alias: ['UKB', 'United Kingdom Biobank'] },
  { id: 'cohorte:sea_ad', etiqueta: 'SEA-AD', alias: ["Seattle Alzheimer's Disease Brain Cell Atlas"] },
  { id: 'cohorte:wrap', etiqueta: 'WRAP', alias: ["Wisconsin Registry for Alzheimer's Prevention"] },
  { id: 'cohorte:wisconsin_adrc', etiqueta: 'Wisconsin ADRC', alias: ["Wisconsin Alzheimer's Disease Research Center"] },
  { id: 'cohorte:dian', etiqueta: 'DIAN', alias: ['Dominantly Inherited Alzheimer Network', 'DIAN-OBS', 'DIAN-TU', 'DIAN Observational Study', 'DIAN Trials Unit'], nct: ["NCT01760005"] },
  { id: 'cohorte:knight_adrc', etiqueta: 'Knight ADRC', alias: ["Knight Alzheimer's Disease Research Center", 'Washington University ADRC', 'WashU ADRC', 'Charles F. and Joanne Knight', 'Washington University Memory and Aging Project', 'Knight ADRC Memory and Aging Project'] },
  { id: 'cohorte:biocard', etiqueta: 'BIOCARD', alias: ['Biomarkers for Older Controls at Risk for Dementia'] },
  { id: 'cohorte:alfa', etiqueta: 'ALFA', alias: ['ALFA+', 'ALzheimer and FAmilies', 'ALFA study', 'ALFA cohort'] },
  { id: 'cohorte:adc_amsterdam', etiqueta: 'Amsterdam Dementia Cohort', alias: ['Amsterdam ADC', 'ADC Amsterdam'] },
  { id: 'cohorte:h70', etiqueta: 'Gothenburg H70', alias: ['H70', 'Gothenburg H70 Birth Cohort', 'H70 Birth Cohort Studies', 'Gothenburg birth cohort'] },
  { id: 'cohorte:triad', etiqueta: 'TRIAD', alias: ['Translational Biomarkers in Aging and Dementia', 'McGill TRIAD'] },
  { id: 'cohorte:framingham', etiqueta: 'Framingham', alias: [{ a: 'Framingham', excepto: '\\s+(?:risk|stroke|cardiovascular|general|coronary|score|10-year)|,\\s*(?:MA|Massachusetts)(?![A-Za-z])' }, 'Framingham Heart Study', 'FHS', 'Framingham Offspring'], busca: false },
  { id: 'cohorte:rotterdam', etiqueta: 'Rotterdam Study', alias: ['Rotterdam Scan Study', 'Rotterdam Elderly Study', 'Estudio de Rotterdam', 'Estudio Rotterdam', 'ERGO'] },
  { id: 'cohorte:prevent_ad', etiqueta: 'PREVENT-AD', alias: ["Pre-symptomatic Evaluation of Experimental or Novel Treatments for Alzheimer's Disease"] },
  { id: 'cohorte:prevent_dementia', etiqueta: 'PREVENT Dementia', alias: ['PREVENT dementia', 'PREVENT Dementia programme', 'PREVENT Dementia study'] },
  { id: 'cohorte:habs', etiqueta: 'HABS', alias: [{ a: 'HABS', excepto: '[-‐–\\s]?HD(?![A-Za-z])' }, 'Harvard Aging Brain Study'], busca: false },
  { id: 'cohorte:habs_hd', etiqueta: 'HABS-HD', alias: ['Health and Aging Brain Study', 'Health & Aging Brain Study', 'Health and Aging Brain Study-Health Disparities'] },
  { id: 'cohorte:oasis', etiqueta: 'OASIS', alias: ['Open Access Series of Imaging Studies', 'OASIS-3', 'OASIS-4'] },
  { id: 'cohorte:epad', etiqueta: 'EPAD', alias: ["European Prevention of Alzheimer's Dementia", 'EPAD LCS'], nct: ["NCT02804789"] },
  // La sigla va con \u0041 (la "A") para que la pasada de tildes no la lea como "más".
  { id: 'cohorte:sydney_mas', etiqueta: 'Sydney M\u0041S', alias: ['Sydney Memory and Ageing Study', 'Sydney Memory', 'Memory and Ageing Study'] },
  { id: 'cohorte:three_city', etiqueta: 'Three-City', alias: ['Three City Study', '3C Study', '3-City', 'Trois Cités', 'Etude des Trois Cités'] },
  { id: 'cohorte:whitehall', etiqueta: 'Whitehall II', alias: ['Whitehall', 'Whitehall 2', 'Whitehall-II'] },
  { id: 'cohorte:amp_ad', etiqueta: 'AMP-AD', alias: ["Accelerating Medicines Partnership-Alzheimer's Disease", 'AMP-AD Knowledge Portal'] },
  { id: 'cohorte:api_colombia', etiqueta: 'API Colombia', alias: ["Alzheimer's Prevention Initiative", 'API ADAD', 'PSEN1 E280A', 'E280A', 'Colombian kindred', 'Paisa kindred', 'Antioquia kindred'], nct: ["NCT01998841"] },
  { id: 'cohorte:finger', etiqueta: 'FINGER', alias: [{ a: 'FINGER', excepto: '[-‐–\\s]?(?:prick|tapping|print|tip)' }, 'Finnish Geriatric Intervention Study to Prevent Cognitive Impairment and Disability', 'FINGER trial'], nct: ["NCT01041989"], busca: false },
  { id: 'cohorte:trailblazer_alz', etiqueta: 'TRAILBLAZER-ALZ', alias: ['TRAILBLAZER-ALZ 1', 'TRAILBLAZER-ALZ1'], nct: ["NCT03367403"] },
  { id: 'cohorte:trailblazer_alz2', etiqueta: 'TRAILBLAZER-ALZ 2', alias: ['TRAILBLAZER-ALZ2', 'TRAILBLAZER-ALZ-2'], nct: ["NCT04437511"] },
  { id: 'cohorte:trailblazer_alz3', etiqueta: 'TRAILBLAZER-ALZ 3', alias: ['TRAILBLAZER-ALZ3', 'TRAILBLAZER-ALZ-3'], nct: ["NCT05026866"] },
  { id: 'cohorte:clarity_ad', etiqueta: 'CLARITY AD', alias: ['Clarity AD', 'CLARITY-AD'], nct: ["NCT03887455"] },
  { id: 'cohorte:study_201', etiqueta: 'Study 201', alias: ['Study 201 core', 'BAN2401-G000-201', 'lecanemab Study 201'], nct: ["NCT01767311"] },
  { id: 'cohorte:emerge', etiqueta: 'EMERGE', alias: ['EMERGE trial'], nct: ["NCT02484547"] },
  { id: 'cohorte:engage', etiqueta: 'ENGAGE', alias: ['ENGAGE trial'], nct: ["NCT02477800"] },
  { id: 'cohorte:graduate_1', etiqueta: 'GRADUATE I', alias: ['GRADUATE 1', 'GRADUATE-I'], nct: ["NCT03444870"] },
  { id: 'cohorte:graduate_2', etiqueta: 'GRADUATE II', alias: ['GRADUATE 2', 'GRADUATE-II'], nct: ["NCT03443973"] },
  { id: 'cohorte:invoke_2', etiqueta: 'INVOKE-2', alias: ['INVOKE2'], nct: ["NCT04592874"] },
  { id: 'cohorte:insight46', etiqueta: 'Insight 46', alias: ['Insight46', 'MRC National Survey of Health and Development', 'NSHD', '1946 British birth cohort'] },
  { id: 'cohorte:emif_ad', etiqueta: 'EMIF-AD', alias: ["European Medical Information Framework for Alzheimer's Disease", 'EMIF-AD MBD'] },
  { id: 'cohorte:blsa', etiqueta: 'BLSA', alias: ['Baltimore Longitudinal Study of Aging'] },
  { id: 'cohorte:aric', etiqueta: 'ARIC', alias: ['Atherosclerosis Risk in Communities', 'ARIC-NCS'] },
  { id: 'cohorte:lothian', etiqueta: 'Lothian Birth Cohort', alias: ['LBC1936', 'LBC 1936', 'LBC1921'] },
  { id: 'cohorte:memento', etiqueta: 'MEMENTO', alias: ['MEMENTO cohort'] },
  { id: 'cohorte:snac_k', etiqueta: 'SNAC-K', alias: ['Swedish National study on Aging and Care in Kungsholmen', 'Kungsholmen Project'] },
  { id: 'cohorte:paquid', etiqueta: 'PAQUID', alias: [] },
  { id: 'cohorte:vantaa', etiqueta: 'Vantaa 85+', alias: ['Vantaa 85'] },
  { id: 'cohorte:betula', etiqueta: 'Betula', alias: ['Betula study', 'Betula project', 'Betula cohort'], busca: false },
  { id: 'cohorte:abc_ds', etiqueta: 'ABC-DS', alias: ['Alzheimer Biomarker Consortium-Down Syndrome', "Alzheimer's Biomarkers Consortium-Down Syndrome"] },
  { id: 'cohorte:cable', etiqueta: 'CABLE', alias: ["Chinese Alzheimer's Biomarker and LifestylE"] },
]);

/** Palabras que no distinguen una cohorte (rosa/metodos.py _GENERICOS_COHORTE). */
const GENERICOS_COHORTE = new Set(['cohorte', 'cohort', 'study', 'estudio', 'longitudinal', 'portadores', 'familias', 'alzheimer', 'disease', 'enfermedad', 'mutaciones', 'carriers', 'participantes', 'pacientes', 'et', 'al', 'the', 'of', 'de', 'del', 'la', 'los', 'las', 'con', 'and', 'familial', 'autosomal', 'dominant', 'autosómico', 'dominante', 'ensayo', 'ensayos', 'trial', 'trials']);

/** Las genéricas más las que tampoco distinguen un nombre libre de uno del
 *  catálogo (rosa/metodos.py _GENERICOS_MIXTA). */
const GENERICOS_MIXTA = new Set([
  ...GENERICOS_COHORTE,
  ...['memory', 'aging', 'ageing', 'brain', 'center', 'centre', 'centers', 'research', 'project', 'initiative', 'registry', 'network', 'consortium', 'biobank', 'university', 'birth', 'adad', 'fad', 'eoad', 'load', 'sporadic', 'trial', 'trials', 'ensayo', 'prevention', 'prevención', 'prevencion', 'prevent', 'data', 'datos', 'dementia', 'demencia', 'bank', 'banco', 'kindred', 'unit', 'programme', 'program', 'neuroimaging', 'imaging', 'health', 'european', 'national', 'biomarker', 'biomarkers', 'treatment', 'treatments', 'observational', 'older', 'controls', 'risk', 'cognitive', 'impairment', 'clinical', 'series', 'studies', 'open', 'access', 'for', 'with', 'des', 'etude', 'translational', 'families', 'family', 'japanese', 'chinese', 'swedish', 'australian', 'finnish', 'british', 'knowledge', 'portal', 'medical', 'information', 'framework', 'evaluation', 'experimental', 'novel', 'intervention', 'disability', 'geriatric', 'survey', 'development', 'syndrome', 'lifestyle', 'care', 'elderly', 'offspring', 'heart', 'scan', 'atlas', 'cell', 'mayo', 'clinic'],
]);

const NCT = /\bNCT\d{8}\b/i;
const NEGACION = /non[-\u2010\u2013\s]?$/i;
const ANTES = 24;
const GUIONES = '[-\u2010\u2013\\s]?';
const VOCALES: [string, string][] = [['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u']];

function escaparRegex(s: string): string {
  // Como re.escape de Python: la comilla simple y el espacio quedan tal cual.
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/-/g, '\\-');
}

/** Espejo de `_regex_alias`: un alias como patrón laxo (sin distinguir
 *  mayúsculas, que aquí el texto ya es un nombre). */
function regexAlias(alias: string, excepto: string | undefined): string {
  const raiz = alias.endsWith('*');
  const cuerpoAlias = raiz ? alias.slice(0, -1) : alias;
  const partes: string[] = [];
  for (const token of cuerpoAlias.split(/\s+/).filter(Boolean)) {
    let t = escaparRegex(token);
    t = t.replace(/'s/g, "(?:['\u2019]?s)?");
    t = t.replace(/\\-/g, GUIONES);
    t = t.replace(/,/g, ',?');
    t = t.replace(/ag(?:e)?ing/gi, 'age?ing');
    for (const [con, sin] of VOCALES) t = t.split(con).join(`[${sin}${con}]`);
    partes.push(t);
  }
  const cuerpo = partes.join('\\s+');
  const ultimo = cuerpoAlias.charAt(cuerpoAlias.length - 1);
  const fin = raiz ? '' : /[0-9]/.test(ultimo) ? '(?![A-Za-z0-9])' : '(?![A-Za-z])';
  const exc = excepto ? `(?!${excepto})` : '';
  return `(?<![A-Za-z0-9])${cuerpo}${exc}${fin}`;
}

interface PatronCohorte {
  laxo: RegExp;
  noTras: RegExp | null;
  salvoSi: RegExp | null;
}

interface CompiladaCohorte {
  entrada: EntradaCohorte;
  orden: number;
  patrones: PatronCohorte[];
  nombres: string[];
}

function compilarSeguro(fuente: string): RegExp | null {
  try {
    return new RegExp(fuente, 'gi');
  } catch {
    return null;
  }
}

function compilarCatalogo(): CompiladaCohorte[] {
  return CATALOGO_COHORTES.map((entrada, orden) => {
    const patrones: PatronCohorte[] = [];
    const nombres = [entrada.etiqueta];
    const anadir = (alias: string, spec: Partial<AliasSpec>) => {
      const laxo = compilarSeguro(regexAlias(alias, spec.excepto));
      if (!laxo) return;
      const noTras = spec.noTras && spec.noTras.length > 0 ? new RegExp(`(?:${spec.noTras.map((p) => escaparRegex(p)).join('|')})\\s*$`, 'i') : null;
      const salvoSi = spec.salvoSi ? compilarSeguro(spec.salvoSi) : null;
      patrones.push({ laxo, noTras, salvoSi });
    };
    if (entrada.busca !== false) anadir(entrada.etiqueta, {});
    for (const a of entrada.alias) {
      const spec: AliasSpec = typeof a === 'string' ? { a } : a;
      anadir(spec.a, spec);
      const nombre = spec.a.replace(/\*$/, '');
      if (nombre !== entrada.etiqueta && !nombres.includes(nombre)) nombres.push(nombre);
    }
    return { entrada, orden, patrones, nombres };
  });
}

const COMPILADAS = compilarCatalogo();
const POR_ID = new Map(COMPILADAS.map((c) => [c.entrada.id, c]));
const NCT_CONOCIDOS = new Map<string, CompiladaCohorte>();
for (const c of COMPILADAS) for (const n of c.entrada.nct ?? []) NCT_CONOCIDOS.set(n.toUpperCase(), c);

function claveExacta(texto: string): string {
  let t = (texto || '').toLowerCase().replace(/\u2010/g, '-').replace(/\u2013/g, '-').replace(/['\u2019]/g, '');
  t = t.replace(/\s+/g, ' ');
  // strip(" .,;:()[]") de Python: quita esos caracteres por los dos extremos.
  t = t.replace(/^[ .,;:()[\]]+/, '').replace(/[ .,;:()[\]]+$/, '');
  return t;
}

const EXACTAS = new Map<string, CompiladaCohorte>();
for (const c of COMPILADAS) for (const n of c.nombres) if (!EXACTAS.has(claveExacta(n))) EXACTAS.set(claveExacta(n), c);

/** Espejo de `_tokens_cohorte`: las palabras que distinguen un nombre libre,
 *  sin genéricas ni paréntesis. Un número corto que sigue a una palabra se le
 *  pega ("TRAILBLAZER-ALZ 2" y "TRAILBLAZER-ALZ2" dan las dos "trailblazer-alz2"),
 *  así dos ensayos que solo difieren en el sufijo no comparten token. */
function tokensCohorte(nombre: string): Set<string> {
  let limpio = (nombre || '').replace(/\(.*?\)/g, ' ').toLowerCase();
  limpio = limpio.replace(/([a-záéíóúñ][a-záéíóúñ0-9-]*[a-záéíóúñ])[\s-]+(\d{1,2})(?![a-záéíóúñ0-9])/g, (todo, palabra: string, numero: string) => (GENERICOS_COHORTE.has(palabra) || GENERICOS_MIXTA.has(palabra) ? todo : palabra + numero));
  const salida = new Set<string>();
  for (const m of limpio.matchAll(/[a-záéíóúñ0-9][a-záéíóúñ0-9-]{2,}/g)) if (!GENERICOS_COHORTE.has(m[0])) salida.add(m[0]);
  return salida;
}

function resta(a: Set<string>, ...quitar: Set<string>[]): Set<string> {
  const s = new Set<string>();
  for (const x of a) if (!quitar.some((q) => q.has(x))) s.add(x);
  return s;
}

/** Tokens que aparecen en más de una entrada del catálogo ("wisconsin" en
 *  WRAP y en el Wisconsin ADRC): no distinguen. */
function tokensRepetidos(): Set<string> {
  const visto = new Map<string, string>();
  const repetidos = new Set<string>();
  for (const c of COMPILADAS) {
    for (const n of c.nombres) {
      for (const t of resta(tokensCohorte(n), GENERICOS_MIXTA)) {
        const dueno = visto.get(t);
        if (dueno === undefined) visto.set(t, c.entrada.id);
        else if (dueno !== c.entrada.id) repetidos.add(t);
      }
    }
  }
  return repetidos;
}

const REPETIDOS = tokensRepetidos();
const TOKENS_ENTRADA = new Map<string, Set<string>[]>(COMPILADAS.map((c) => [c.entrada.id, c.nombres.map((n) => resta(tokensCohorte(n), GENERICOS_MIXTA, REPETIDOS)).filter((s) => s.size > 0)]));

interface Canonica {
  id: string;
  etiqueta: string;
}

function deNct(nct: string): Canonica {
  const n = nct.toUpperCase();
  const conocida = NCT_CONOCIDOS.get(n);
  return conocida ? { id: conocida.entrada.id, etiqueta: conocida.entrada.etiqueta } : { id: `ensayo:${n}`, etiqueta: n };
}

/** Espejo de `_tramos` en modo laxo: la primera entrada del catálogo que el
 *  nombre contiene, resolviendo solapes a favor del tramo más largo que
 *  empieza antes, con la negación "non-" y los precedentes prohibidos. */
function primeraEnTexto(t: string): CompiladaCohorte | null {
  const hallazgos: { ini: number; fin: number; orden: number; c: CompiladaCohorte }[] = [];
  for (const c of COMPILADAS) {
    for (const p of c.patrones) {
      if (p.salvoSi) {
        p.salvoSi.lastIndex = 0;
        if (p.salvoSi.test(t)) continue;
      }
      p.laxo.lastIndex = 0;
      for (const m of t.matchAll(p.laxo)) {
        const ini = m.index ?? 0;
        const fin = ini + m[0].length;
        if (fin <= ini) continue;
        const antes = t.slice(Math.max(0, ini - ANTES), ini);
        if (NEGACION.test(antes) || (p.noTras && p.noTras.test(antes))) continue;
        hallazgos.push({ ini, fin, orden: c.orden, c });
      }
    }
  }
  hallazgos.sort((a, b) => a.ini - b.ini || b.fin - b.ini - (a.fin - a.ini) || a.orden - b.orden);
  const ocupados: [number, number][] = [];
  for (const h of hallazgos) {
    if (ocupados.some(([i, f]) => h.ini < f && h.fin > i)) continue;
    return h.c;
  }
  return null;
}

/** Espejo de `canonizar_cohorte`: un nombre de cohorte a su nodo canónico, o
 *  null si no resuelve. Un NCT manda; luego el identificador, el nombre exacto
 *  o un alias, y por último el catálogo dentro del texto. */
export function canonizarCohorte(texto: string): Canonica | null {
  const t = (texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = NCT.exec(t);
  if (m) return deNct(m[0]);
  const nodo = POR_ID.get(t);
  if (nodo) return { id: nodo.entrada.id, etiqueta: nodo.entrada.etiqueta };
  const exacta = EXACTAS.get(claveExacta(t));
  if (exacta) return { id: exacta.entrada.id, etiqueta: exacta.entrada.etiqueta };
  const dentro = primeraEnTexto(t);
  return dentro ? { id: dentro.entrada.id, etiqueta: dentro.entrada.etiqueta } : null;
}

/** Espejo de `_parte_del_nombre`: un nombre libre contiene entero, palabra a
 *  palabra y sin genéricos, uno de los nombres de la entrada. */
function parteDelNombre(libre: string, id: string): boolean {
  const toks = resta(tokensCohorte(libre), GENERICOS_MIXTA);
  if (toks.size === 0) return false;
  for (const nombreTokens of TOKENS_ENTRADA.get(id) ?? []) {
    let dentro = true;
    for (const t of nombreTokens) if (!toks.has(t)) dentro = false;
    if (dentro) return true;
  }
  return false;
}

/** El campo `cohorte` (o `nct`) de una fuente como texto (espejo de `_nombre`
 *  y `_nombre_de`): cadena tal cual, nodo por su etiqueta o identificador,
 *  lista por sus elementos; cualquier otra cosa es "" (sin cohorte). */
function nombreDe(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (Array.isArray(valor)) return valor.map(nombreDe).filter(Boolean).join(' ').trim();
  if (valor && typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    return nombreDe(o.etiqueta || o.id || o.nombre || o.texto);
  }
  return '';
}

function nombreDeFuente(f: unknown): string {
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const o = f as Record<string, unknown>;
    if ('cohorte' in o || 'nct' in o) return nombreDe(o.cohorte) || nombreDe(o.nct);
    if (o.etiqueta && typeof o.id === 'string' && o.id.includes(':')) return nombreDe(o);
    return '';
  }
  return nombreDe(f);
}

/** Las fuentes de una hipótesis (o una lista suelta) como objetos, sin
 *  repetir id: la primera gana. Espejo de `_fuentes_de`. */
function fuentesDe(x: unknown): Record<string, unknown>[] {
  let crudas: unknown[] = [];
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as { procedencia?: unknown; fuentes?: unknown };
    const p = o.procedencia;
    const lista = p && typeof p === 'object' && !Array.isArray(p) ? (p as { fuentes?: unknown }).fuentes : o.fuentes;
    crudas = Array.isArray(lista) ? lista : lista && typeof lista === 'object' ? [lista] : [];
  } else if (Array.isArray(x)) {
    crudas = x;
  }
  const vistos = new Set<string>();
  const salida: Record<string, unknown>[] = [];
  for (const f of crudas) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    const id = (f as { id?: unknown }).id;
    if (id !== null && id !== undefined) {
      if (vistos.has(String(id))) continue;
      vistos.add(String(id));
    }
    salida.push(f as Record<string, unknown>);
  }
  return salida;
}

export interface GrupoCohorte {
  /** Ids de las fuentes del grupo. */
  ids: string[];
  /** Identificador canónico ("cohorte:adni", "ensayo:NCT...") o null si es un nombre libre. */
  id: string | null;
  /** La etiqueta canónica, o el primer nombre tal como lo dio la fuente. */
  etiqueta: string;
  nombres: string[];
}

/** Espejo de `_agrupar_nombres`: union-find sobre los nombres distintos.
 *  1) los que resuelven al catálogo se unen por identificador; 2) un nombre
 *  libre se une al primer grupo del catálogo cuyo nombre contiene palabra a
 *  palabra, y solo a uno; 3) los libres entre sí por tokens. Nunca se funden
 *  dos cohortes distintas del catálogo. */
function agruparNombres(items: [string, string][]): GrupoCohorte[] {
  const nombres: string[] = [];
  const indice = new Map<string, number>();
  for (const [, nombre] of items) {
    if (!indice.has(nombre)) {
      indice.set(nombre, nombres.length);
      nombres.push(nombre);
    }
  }
  const canon = nombres.map((n) => canonizarCohorte(n));
  const padre = nombres.map((_, i) => i);
  const canonDeRaiz = new Map<number, string>();
  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]!]!;
      i = padre[i]!;
    }
    return i;
  };
  const unir = (i: number, j: number) => {
    const ri = raiz(i);
    const rj = raiz(j);
    if (ri === rj) return;
    const ci = canonDeRaiz.get(ri);
    const cj = canonDeRaiz.get(rj);
    if (ci && cj && ci !== cj) return;
    const nueva = Math.min(ri, rj);
    const vieja = Math.max(ri, rj);
    padre[vieja] = nueva;
    if (ci || cj) canonDeRaiz.set(nueva, (ci || cj)!);
    canonDeRaiz.delete(vieja);
  };
  const primeroPorId = new Map<string, number>();
  canon.forEach((c, i) => {
    if (!c) return;
    if (!primeroPorId.has(c.id)) primeroPorId.set(c.id, i);
    const j = primeroPorId.get(c.id)!;
    canonDeRaiz.set(raiz(i), c.id);
    if (j !== i) unir(j, i);
  });
  const libres = canon.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  for (const i of libres) {
    for (const [idC, j] of primeroPorId) {
      if (POR_ID.has(idC) && parteDelNombre(nombres[i]!, idC)) {
        unir(j, i);
        break;
      }
    }
  }
  // 2b. Alias aprendido dentro del registro: "X (NCT01234567)" enseña que X es
  // ese ensayo, así que otro registro que solo dice "X" se une al grupo del
  // NCT aunque el ensayo no esté en el catálogo, si todos los tokens del
  // nombre libre están en el texto que acompaña al NCT (dirección conservadora).
  const ensayosPorTexto: [number, Set<string>][] = [];
  canon.forEach((c, j) => {
    if (c && c.id.startsWith('ensayo:')) ensayosPorTexto.push([j, resta(tokensCohorte(nombres[j]!.replace(NCT, ' ')), GENERICOS_MIXTA)]);
  });
  for (const i of libres) {
    if (raiz(i) !== i && canonDeRaiz.get(raiz(i))) continue;
    const toksI = resta(tokensCohorte(nombres[i]!), GENERICOS_MIXTA);
    if (toksI.size === 0) continue;
    for (const [j, toksJ] of ensayosPorTexto) {
      let dentro = toksJ.size > 0;
      for (const t of toksI) if (!toksJ.has(t)) dentro = false;
      if (dentro) {
        unir(j, i);
        break;
      }
    }
  }
  const tokens = new Map<number, Set<string>>(libres.map((i) => [i, tokensCohorte(nombres[i]!).size > 0 ? tokensCohorte(nombres[i]!) : new Set([nombres[i]!.toLowerCase()])]));
  for (let a = 0; a < libres.length; a += 1) {
    const i = libres[a]!;
    for (const j of libres.slice(a + 1)) {
      if (raiz(i) === raiz(j)) continue;
      if (nombres[i]!.toLowerCase() === nombres[j]!.toLowerCase()) {
        unir(i, j);
        continue;
      }
      const ti = tokens.get(i)!;
      const tj = tokens.get(j)!;
      let comparten = false;
      for (const t of ti) if (tj.has(t)) comparten = true;
      if (comparten) unir(i, j);
    }
  }
  const etiquetaDeId = new Map<string, string>();
  for (const c of canon) if (c) etiquetaDeId.set(c.id, c.etiqueta);
  const grupos = new Map<number, GrupoCohorte>();
  const orden: number[] = [];
  for (const [idF, nombre] of items) {
    const r = raiz(indice.get(nombre)!);
    let g = grupos.get(r);
    if (!g) {
      const idC = canonDeRaiz.get(r) ?? null;
      g = { ids: [], id: idC, etiqueta: (idC && etiquetaDeId.get(idC)) || nombre, nombres: [] };
      grupos.set(r, g);
      orden.push(r);
    }
    if (!g.ids.includes(idF)) g.ids.push(idF);
    if (!g.nombres.includes(nombre)) g.nombres.push(nombre);
  }
  return orden.map((r) => grupos.get(r)!);
}

/** Grupos de fuentes que son la misma cohorte (espejo de `agrupar_cohortes`).
 *  Las fuentes sin cohorte no entran en ningún grupo: no se puede afirmar que
 *  sean independientes ni que no lo sean. */
export function agruparCohortes(fuentes: unknown): GrupoCohorte[] {
  const fs = fuentesDe(fuentes);
  const items: [string, string][] = [];
  fs.forEach((f, i) => {
    const nombre = nombreDeFuente(f);
    if (nombre) items.push([String(f.id ?? `fuente-${i + 1}`), nombre]);
  });
  return agruparNombres(items);
}

/* ---- Qué fuentes aportan cohorte (espejo de rosa/certeza.py _Vista) ----
   Una fuente cuenta si tiene al menos un apoyo emparejado que no esté
   socavado, no sea sintético y no sea una frase de la introducción o los
   antecedentes ("de fondo": resume estudios ajenos, no un resultado de esa
   cohorte), o si no tiene ninguna afirmación emparejable (no se puede afirmar
   que no apoye). Una fuente cuyas afirmaciones son todas en contra, socavan,
   están socavadas, no están sostenidas o son de fondo no aporta cohorte. Así
   la franja del ranking cuenta lo mismo que el techo GRADE. */

const VEREDICTOS_QUE_CUENTAN = new Set(['sostenida', 'parcial']);
const RELACIONES_APOYO = new Set(['', 'apoya', 'apoya_indirecta']);
const CLASES_DIRECTAS = new Set(['observacion_original', 'derivado']);
// Copia exacta de NOMBRE_SINTETICO en rosa/certeza.py.
const NOMBRE_SINTETICO = /sint[eé]tic|synthetic|(?<![a-z0-9])(?:dummy|fake|mock)(?![a-z0-9])|(?<![a-z0-9])(?:datos?|data)[_\- ]?(?:de[_\- ]?)?prueba(?![a-z0-9])|(?<![a-z0-9])de[_\- ]prueba(?![a-z0-9])|^\s*prueba(?:[_\- ]?\d+)?\.[a-z0-9]+\s*$/i;
const SECCION_FONDO = /secci[oó]n\s+(?:Introduction|Background|Introducci[oó]n|Antecedentes)\b/i;
const DELIMITADORES_CITA = ',;:] .';

type Registro = Record<string, unknown>;

function norm(t: unknown): string {
  return String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function claveDe(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}

function objetosDe(x: unknown): Registro[] {
  return Array.isArray(x) ? x.filter((y): y is Registro => Boolean(y) && typeof y === 'object' && !Array.isArray(y)) : [];
}

/** Espejo de `es_sintetica`: bandera `sintetico`, o un dato directo cuyo
 *  fichero o cita delatan que es de prueba aunque la bandera falte. */
function esSintetica(a: Registro): boolean {
  if (a.sintetico) return true;
  if (a.tipo !== 'dato' || !CLASES_DIRECTAS.has(claveDe(a.clase))) return false;
  const tray = a.trayectoria;
  const fichero = tray && typeof tray === 'object' ? String((tray as Registro).id ?? '') : String(tray ?? '');
  const cita = String(a.cita ?? '');
  return NOMBRE_SINTETICO.test(fichero) || (cita.trimStart().startsWith('[Datos') && NOMBRE_SINTETICO.test(cita));
}

/** Espejo de `de_fondo`: `deFondo` explícito manda; si falta, la cita dice la sección. */
function deFondo(a: Registro): boolean {
  if (typeof a.deFondo === 'boolean') return a.deFondo;
  return SECCION_FONDO.test(String(a.cita ?? ''));
}

function socavada(a: Registro): boolean {
  const v = a.socavadaPor;
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

/** Espejo de `_cortes`: longitudes de prefijo de una cita que pueden ser una
 *  referencia entera, de la más larga a la más corta. */
function cortes(cuerpo: string): number[] {
  const c = new Set<number>();
  for (let k = 1; k < cuerpo.length; k += 1) if (DELIMITADORES_CITA.includes(cuerpo[k]!)) c.add(k);
  c.add(cuerpo.length);
  return [...c].sort((x, y) => y - x);
}

/** Espejo de `_Indice.resolver`: con qué fuentes empareja una afirmación, por
 *  `fuenteId` o porque su cita empieza por la referencia de la fuente (gana la
 *  referencia más larga que encaje). */
function emparejar(fuentes: Registro[], a: Registro): number[] {
  const porId = new Map<string, number[]>();
  const porRef = new Map<string, number[]>();
  fuentes.forEach((f, j) => {
    const fid = f.id;
    if (fid !== null && fid !== undefined && fid !== '' && (typeof fid === 'string' || typeof fid === 'number')) porId.set(String(fid), [...(porId.get(String(fid)) ?? []), j]);
    const ref = norm(f.referencia).replace(/\.+$/, '');
    if (ref) porRef.set(ref, [...(porRef.get(ref) ?? []), j]);
  });
  const fid = a.fuenteId;
  if (fid !== null && fid !== undefined && fid !== '' && porId.has(String(fid))) return porId.get(String(fid))!;
  const cita = norm(a.cita);
  if (!cita || porRef.size === 0) return [];
  const cuerpos = cita.startsWith('[') ? [cita.slice(1), cita] : [cita];
  for (const cuerpo of cuerpos) {
    for (const k of cortes(cuerpo)) {
      const encontrados = porRef.get(cuerpo.slice(0, k));
      if (encontrados) return encontrados;
    }
  }
  return [];
}

/** Espejo de `_Vista.fuentes_que_cuentan`. Sin afirmaciones, todas cuentan. */
export function fuentesQueCuentan(h: unknown): Registro[] {
  const hh = h && typeof h === 'object' && !Array.isArray(h) ? (h as Registro) : {};
  const procedencia = hh.procedencia && typeof hh.procedencia === 'object' ? (hh.procedencia as Registro) : {};
  const fuentes = objetosDe(procedencia.fuentes);
  const afs = objetosDe(hh.afirmaciones);
  if (afs.length === 0) return fuentes;
  const conAfirmacion = new Set<number>();
  const conApoyo = new Set<number>();
  for (const a of afs) {
    const encontrados = emparejar(fuentes, a);
    const real = VEREDICTOS_QUE_CUENTAN.has(claveDe(a.veredicto)) && !esSintetica(a);
    const apoyo = real && RELACIONES_APOYO.has(claveDe(a.relacion)) && !socavada(a) && !deFondo(a);
    for (const j of encontrados) {
      conAfirmacion.add(j);
      if (apoyo) conApoyo.add(j);
    }
  }
  return fuentes.filter((_, j) => !conAfirmacion.has(j) || conApoyo.has(j));
}

/** Cohortes distintas entre las fuentes que aportan apoyo, una etiqueta por
 *  grupo: la canónica si el nombre está en el catálogo, o el primer nombre tal
 *  como lo dio la fuente. Misma salida que `rosa/priorizacion.py cohortes_de`
 *  (que delega en rosa/certeza.py cohortes_distintas). Dos artículos de la
 *  misma cohorte son una sola evidencia, no dos. Acepta una hipótesis (con
 *  afirmaciones, que deciden qué fuentes cuentan), un objeto con `fuentes` o
 *  una lista suelta de fuentes (entonces cuentan todas). */
/** Mínimo de sistemas enumerados en una cadena para que deje de ser el nombre
 *  de una cohorte y pase a ser una bolsa (rosa/metodos.py `_es_bolsa`, 28 de
 *  septiembre de 2026). Dos no bastan: "control y AD" describe una cohorte con
 *  dos brazos. Tres sí: "iPS-derived neurons, CNS cell lines, mouse brain
 *  slice" son tres plataformas en un campo, y contarla como cohorte
 *  independiente subió a «baja» la certeza de la hipótesis de SULF2. */
const TROZOS_QUE_HACEN_BOLSA = 3;
const SEPARADOR_DE_LISTA = /\s*(?:,|;|\/|\||\by\b|\band\b)\s*/i;

/** Si la cadena enumera tres o más sistemas y ninguno resuelve al catálogo.
 *  Un trozo del catálogo salva la cadena entera ("AMARANTH, DAYBREAK-ALZ").
 *  Los paréntesis se quitan antes: son aclaraciones, no listas. */
export function esBolsaDeCohortes(nombre: string): boolean {
  const trozos = nombre.replace(/\([^)]*\)?/g, ' ').split(SEPARADOR_DE_LISTA).map((t) => t.trim()).filter(Boolean);
  if (trozos.length < TROZOS_QUE_HACEN_BOLSA) return false;
  return !trozos.some((t) => canonizarCohorte(t));
}

/** El nombre si identifica una cohorte, o '' si no (rosa/metodos.py
 *  `_nombre_identificado`). Lo que devuelve '' no cuenta como cohorte
 *  independiente, igual que una fuente sin cohorte. */
export function nombreIdentificado(nombre: string): string {
  const t = (nombre ?? '').trim();
  if (!t || canonizarCohorte(t)) return t;
  return esBolsaDeCohortes(t) ? '' : t;
}

export function cohortesDe(h: Pick<Hipotesis, 'procedencia'> | { fuentes?: unknown } | unknown[]): string[] {
  if (h && typeof h === 'object' && !Array.isArray(h) && 'procedencia' in h) {
    // Como en certeza.py: solo fuentes con la cohorte como texto, renumeradas
    // (dos entradas con el mismo id son dos fuentes que cuentan). Lo que esta
    // copia NO hace (17 de septiembre de 2026, S-06): fundir dos entradas del
    // mismo artículo (mismo DOI, PMID, NCT o título con ids distintos) en una
    // sola cohorte. Esa fusión vive solo en el servidor (rosa/certeza.py
    // `claves_de_fuente`) y llega a la pantalla en `cohortesDistintas`, que
    // `ranking.ts` lee antes que esta regla; aquí un registro sin esa lista
    // puede enseñar una cohorte más que el techo si el mismo artículo entró
    // dos veces con nombres distintos.
    const fuentes = fuentesQueCuentan(h)
      .map((f) => (typeof f.cohorte === 'string' ? { ...f, cohorte: nombreIdentificado(f.cohorte) } : f))
      .filter((f) => typeof f.cohorte === 'string' && f.cohorte.trim() !== '')
      .map((f, i) => ({ ...f, id: `c${i}` }));
    return agruparCohortes(fuentes).map((g) => g.etiqueta);
  }
  return agruparCohortes(h).map((g) => g.etiqueta);
}
