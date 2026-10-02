// El atlas de la enfermedad: los datos detrás del mapa sagital del cerebro
// (pantallas/Atlas.tsx, dibujo en lib/atlas_dibujo.ts). Toma el mapa que el
// backend (rosa/mapa_enfermedad.py) guarda en la investigación al cerrar cada
// iteración (celdas estadio x región x tipo celular con los ids de los hechos,
// hipótesis y preguntas que caen en cada una) y lo pliega POR REGIÓN: una
// entrada por cada región del backend, siempre las veinte y en el mismo orden,
// con su conteo de registros, sus cohortes distintas, sus barras por fase y
// por célula, la mayor certeza GRADE y las listas de ids para el panel.
//
// Qué cuenta como evidencia: los hechos y las hipótesis, cada uno UNA vez por
// región aunque caiga en varias celdas de esa región (un hecho sobre
// astrocitos y microglía del hipocampo está en dos celdas y es un solo hecho).
// Así el conteo por región coincide con `ejes.region` del backend, que cuenta
// registros, no celdas. Las preguntas abiertas se listan pero no cuentan
// (misma regla que el backend: no son cobertura).
//
// Dos ejes distintos en la figura (acordado con Emir el 18 de septiembre de
// 2026): el COLOR de una región es cuántas cohortes distintas nombran sus
// hipótesis (celda.cohortes, deduplicadas por región, solo de las celdas que
// aportan algún registro con los filtros puestos) y el NÚMERO es cuántos
// registros (hechos más hipótesis). Un registro no es una evidencia
// independiente: dos hechos de la misma cohorte son una sola muestra. OJO con
// el origen del dato: el backend (rosa/mapa_enfermedad.py, mapa()) llena
// celda.cohortes SOLO con las cohortes de las afirmaciones de las HIPÓTESIS de
// la celda; los hechos no aportan ninguna, digan lo que digan. Por eso toda
// región sin hipótesis sale en el extremo frío aunque sus hechos nombren ADNI
// o EMERGE: en la investigación grande la sangre tiene 106 registros y 24
// cohortes, y el hipocampo 15 hechos, ninguna hipótesis y 0 cohortes. El
// panel lo dice así ("sus hipótesis no nombran ninguna cohorte"), no afirma
// nada sobre los hechos. Si algún día el color debe reflejar la evidencia
// entera, el backend tendría que extraer cohortes también de los hechos.
//
// Localización fallida: `cerebro_sin_region` y `neocorteza` no son lugares,
// son la marca de que ROSA2018 leyó el registro y no supo situarlo (la fuente
// dice "cerebro" o "corteza" a secas). Salen de la anatomía a una bandeja
// (`noLocalizados`) y no se pintan; siguen en `regiones` (siempre las veinte)
// para que el panel pueda listarlos.
//
// Cobertura de una región sin hechos: "no buscada" si ninguna consulta hecha
// ni fuente leída de la investigación la nombra, o "buscada sin hallazgo" si
// alguna la nombra y no produjo ningún registro situado ahí. Para saber si un
// texto nombra una región se usan las MISMAS expresiones regulares que el
// backend (REGIONES_PATRONES, portadas de rosa/mapa_enfermedad.py REGIONES;
// un test las coteja con el fichero Python) sobre el texto normalizado como
// allí (`normalizar`: minúsculas y sin tildes). Los textos disponibles en el
// navegador: las consultas de búsqueda de las corridas (tema y texto), las
// fuentes de la procedencia de las hipótesis (título y fragmento), las
// excluidas en el cribado (título y referencia) y las referencias de la
// procedencia de los hechos. Las fuentes privadas de las corridas no viajan.
//
// Filtros: por fase (estadio) y por tipos de célula (unión), que recortan las
// celdas; y "hasta la iteración N" para el deslizador "Cómo creció", que
// recorta los hechos (y las preguntas) por su fecha de nacimiento con la
// numeración SEGUIDA de iteraciones de lib/arbol.ts (el backend numera por
// corrida y esta investigación puede tener trece corridas). Un hecho sin
// fecha, o cuyo id ya no está en el estado, cuenta siempre: no se inventa
// cuándo nació (la región dice cuántos son en `sinResolver`). Los máximos para
// las escalas (`maximo`, `cohortesMax`) ignoran el deslizador a propósito:
// así, al mover "hasta", las regiones se van encendiendo hacia su valor final
// en vez de reescalarse en cada paso. Lo que el backend deja sin fase o sin
// célula tiene su propia clave (SIN_FASE, SIN_CELULA) y su propio chip, para
// que las cifras de los chips sumen lo que enseña el mapa: en la investigación
// grande 188 de 209 registros situados no hablan de una célula concreta.
//
// La certeza GRADE de una región sale siempre de las hipótesis VIVAS (la de su
// ficha), no de la instantánea del backend, que solo queda de reserva cuando
// ninguna hipótesis de la celda está en el estado. Y como el mapa es una
// instantánea del cierre de la iteración, `hechosNuevos` cuenta los hechos
// vivos que el modelo de mundo ya tiene y el mapa aún no sitúa: una región
// rayada es "sin evidencia situada todavía", nunca "no hay".
//
// Discordia: una región lleva marca si alguno de sus hechos tiene
// `contradiceA` no vacío (choca con otro hecho sin sustituirlo). La dirección
// de las citas (apoya, contrasta) NO se usa: hoy todas nacen marcadas "apoya"
// por código y pintarlas sería inventar una señal.
//
// Lo que no rompe: una investigación sin mapa (null), un mapa sin celdas
// (null), una celda a la que le falta alguna lista, una clave de región que el
// backend añadió después de esta interfaz (se conserva al final, en legible,
// sin dibujo), ids que no existen en el estado (se ignoran al listar), un
// filtro con claves que no casan (todo a cero), corridas sin búsqueda,
// hipótesis sin procedencia.

import type { CeldaMapa, EstadoRosa, HechoMundo, Hipotesis, Investigacion, MapaEnfermedad } from '../datos/tipos';
import { DEFINICIONES_MAPA, ETIQUETAS_MAPA, etiquetaEje } from '../componentes/MapaEnfermedad';
import { iteracionObjEn, ordinalesDeIteraciones } from './arbol';
import { plural } from './formato';
import { tr, traducido, trc, trp } from './idioma';

/** Las claves de región del backend (rosa/mapa_enfermedad.py REGIONES), en el
 *  mismo orden. Un test las coteja con el fichero de Python: si allí cambia
 *  una, aquí falla el test en vez de desaparecer una región del dibujo. */
export const REGIONES_CLAVES: string[] = [
  'hipocampo',
  'corteza_entorrinal',
  'corteza_prefrontal',
  'corteza_temporal',
  'corteza_parietal',
  'cingulo_precuneo',
  'corteza_occipital',
  'amigdala',
  'ganglios_basales_talamo',
  'tronco_locus_coeruleus',
  'cerebelo',
  'sustancia_blanca',
  'vascular_bhe',
  'bulbo_olfatorio',
  'retina',
  'intestino_microbiota',
  'plasma',
  'lcr',
  'neocorteza',
  'cerebro_sin_region',
];

/** Las expresiones regulares con las que el backend decide si un texto nombra
 *  cada región (rosa/mapa_enfermedad.py REGIONES, tercera columna de cada
 *  tupla), copiadas TAL CUAL: un test lee el fichero Python y comprueba que
 *  coinciden carácter a carácter. Se aplican sobre el texto pasado por
 *  `normalizar` (minúsculas, sin tildes), igual que allí. */
export const REGIONES_PATRONES: Record<string, string> = {
  hipocampo: String.raw`hipocamp\w*|hippocamp\w*|\bca[1-4]\b(?!\s*\+)|dentate gyrus|giro dentado|subicul\w*`,
  corteza_entorrinal: String.raw`entorrinal|entorhinal|transentorhinal|transentorrinal|perirhinal|perirrinal`,
  corteza_prefrontal: String.raw`prefrontal|frontal cortex|corteza frontal|frontal lobe|lobulo frontal|\bdlpfc\b|\bpfc\b|brodmann area 9|\bba9\b`,
  corteza_temporal: String.raw`temporal (?:cortex|lobe|gyrus|pole|neocortex)|corteza temporal|lobulo temporal|giro temporal|\bmtg\b|\bitg\b|\bmtl\b|middle temporal|inferior temporal|superior temporal|fusiform|parahippocamp\w*|parahipocamp\w*`,
  corteza_parietal: String.raw`parietal|angular gyrus|giro angular|supramarginal`,
  cingulo_precuneo: String.raw`cingul\w*|precune\w*|retrosplenial|\bpcc\b`,
  corteza_occipital: String.raw`occipital|visual cortex|corteza visual`,
  amigdala: String.raw`amigdal\w*|amygdal\w*`,
  ganglios_basales_talamo: String.raw`striat\w*|estriad\w*|caudate|caudado|putamen|accumbens|basal ganglia|ganglios basales|(?<!hypo)thalam\w*|(?<!hipo)talam\w*|nucleus basalis|meynert|basal forebrain|prosencefalo basal`,
  tronco_locus_coeruleus: String.raw`locus c(?:o)?eruleus|brainstem|brain stem|tronco (?:del )?encef\w*|raphe|\brafe\b|substantia nigra|sustancia negra|medulla oblongata|bulbo raquideo`,
  cerebelo: String.raw`cerebel\w*|cerebell\w*`,
  sustancia_blanca: String.raw`white matter|sustancia blanca|materia blanca|\bwmh\b|hiperintensidad\w*|hyperintensit\w*|corpus callosum|cuerpo calloso`,
  vascular_bhe: String.raw`blood[- ]brain barrier|barrera hematoencef\w*|\bbbb\b|\bbhe\b|cerebrovascular|vascular cerebral|neurovascular|capillar\w*|capilar\w*|microvasc\w*|arteriol\w*|perivascular|\bcaa\b|angiopat\w*|angiopath\w*|blood vessels?|vasos sanguineos`,
  bulbo_olfatorio: String.raw`olfact\w*|olfat\w*`,
  retina: String.raw`\bretina\b|\bretinal\b|\bretinas\b|retinian\w*|\brnfl\b|optical coherence tomography|tomografia de coherencia optica`,
  intestino_microbiota: String.raw`\bgut\b|intestin\w*|microbio(?:ta|me|mas?)\b`,
  plasma: String.raw`(?<!membrana )(?<!membrane )\bplasma\b(?! membrane)|(?<!membrana )plasmatic\w*|\bsangre\b|\bblood\b(?![- ](?:brain|flow|pressure|vessels?|supply|oxygen))|\bserum\b|\bsuero\b|\bserico\w*|\bserica\w*|peripheral blood|\bpbmc\b|leucocit\w*|leukocyt\w*|(?<!vasos )(?<!flujo )(?<!presion )sanguine\w*`,
  lcr: String.raw`\blcr\b|\bcsf\b|cefalorraquide\w*|cerebrospinal|\bliquor\b|lumbar puncture|puncion lumbar`,
  neocorteza: String.raw`neocort\w*|cerebral cortex|corteza cerebral|\bcortical\b|\bcortex\b|\bcorteza\b|isocort\w*|gr[ae]y matter|sustancia gris|materia gris`,
  cerebro_sin_region: String.raw`\bbrain\b|\bcerebro\b|\bcerebral\b|encefal\w*|whole[- ]brain|intracranial|intracerebral`,
};

/** Las dos claves que no son un lugar sino una localización fallida: la fuente
 *  dice "cerebro" o "corteza" a secas y ROSA2018 no supo situar el registro.
 *  Van a la bandeja "No localizados", fuera de la anatomía; releerlos con el
 *  catálogo de regiones es trabajo pendiente del backend. */
export const NO_LOCALIZADAS: ReadonlySet<string> = new Set(['cerebro_sin_region', 'neocorteza']);

/** Los compartimentos de fluidos: la sangre (plasma y suero) y el LCR. Son
 *  donde se mide, no dónde ocurre; la línea honesta bajo el mapa los separa
 *  del tejido localizado. */
export const FLUIDOS: ReadonlySet<string> = new Set(['plasma', 'lcr']);

/** Las genéricas ceden ante cualquier región concreta del sistema nervioso
 *  (rosa/mapa_enfermedad.py _REGIONES_GENERICAS y _COMPARTIMENTOS_PERIFERICOS). */
const REGIONES_GENERICAS: readonly string[] = ['neocorteza', 'cerebro_sin_region'];
const COMPARTIMENTOS_PERIFERICOS: ReadonlySet<string> = new Set(['plasma', 'lcr', 'intestino_microbiota', 'retina']);

/** Las fases de la enfermedad (rosa/mapa_enfermedad.py ESTADIOS), en su orden clínico. */
export const ESTADIOS_CLAVES: string[] = ['preclinica', 'prodromica_dcl', 'demencia_leve', 'demencia_moderada_grave', 'autosomico_dominante'];

/** Los tipos de célula (rosa/mapa_enfermedad.py TIPOS_CELULARES), en el mismo orden. */
export const CELULAS_CLAVES: string[] = ['astrocito', 'microglia', 'neurona', 'oligodendrocito', 'opc', 'endotelio', 'pericito', 'inmune_periferico'];

/** Clave con la que el atlas agrupa lo que tiene región o célula pero ninguna
 *  fase identificada. Aparece como último chip de estadio ("sin fase
 *  identificada") y como clave en `porEstadio`, para que las cifras de los
 *  chips sumen lo mismo que el mapa. Como filtro (`estadio: SIN_FASE`) deja
 *  solo las celdas sin fase. */
export const SIN_FASE = '';
const ETIQUETA_SIN_FASE = 'sin fase identificada';

/** Lo mismo para el tipo de célula: la clave de los registros que el backend
 *  situó sin célula (en la investigación grande son 188 de 209, casi todo lo
 *  que hay: la mayoría de la evidencia no habla de una célula concreta). Es
 *  el último interruptor de célula ("sin tipo celular") y una clave más en
 *  `porCelula`; como filtro (`celulas: [SIN_CELULA]`) deja solo esas celdas.
 *  Sin esta clave, marcar todos los interruptores escondería el 87 % de la
 *  evidencia. Vale '' como SIN_FASE, igual que en la tabla del mapa
 *  (MapaEnfermedad.tsx), y por eso el filtro de células no descarta la
 *  cadena vacía. */
export const SIN_CELULA = '';
const ETIQUETA_SIN_CELULA = 'sin tipo celular';
/** Lo que se dice de una región que el backend añadió después de esta interfaz. */
const DEFINICION_REGION_NUEVA = 'Región nueva del backend, sin definición en llano todavía.';

/** Orden de los niveles GRADE, de menor a mayor (rosa/certeza.py NIVELES). */
const ORDEN_CERTEZA = ['muy_baja', 'baja', 'moderada', 'alta'];

/** Qué es cada región, dicho en llano para quien la ve por primera vez. El
 *  backend hoy solo trae definiciones de estadio y de nivel; si algún día trae
 *  las de región (mapaEnfermedad.definiciones.region), mandan sobre estas. */
export const DEFINICIONES_REGION: Record<string, string> = traducido({
  hipocampo: 'Estructura del lóbulo temporal medial, esencial para formar recuerdos nuevos. Es de las primeras regiones que se atrofian en el Alzheimer.',
  corteza_entorrinal: 'Puerta de entrada de la información hacia el hipocampo. Es donde empiezan los ovillos de tau (estadios I y II de Braak), antes de cualquier síntoma.',
  corteza_prefrontal: 'Parte delantera del cerebro: planificar, decidir y controlar la conducta. Se afecta más tarde que las regiones de la memoria.',
  corteza_temporal: 'Lóbulo lateral que procesa el lenguaje, el oído y el reconocimiento de caras y objetos. La corteza temporal media es de las primeras zonas neocorticales donde llega la tau.',
  corteza_parietal: 'Región superior y posterior que integra el espacio y la atención. Su atrofia es más marcada en las formas de inicio temprano.',
  cingulo_precuneo: 'Cara interna de los hemisferios, parte de la red por defecto. El precúneo y el cíngulo posterior están entre los primeros sitios donde se deposita amiloide y donde baja el metabolismo en el PET.',
  corteza_occipital: 'Parte posterior del cerebro, donde se procesa la visión. Suele conservarse hasta fases avanzadas, salvo en la variante visual (atrofia cortical posterior).',
  amigdala: 'Núcleo del lóbulo temporal medial que procesa el miedo y la emoción. Se afecta pronto y se relaciona con los síntomas de conducta.',
  ganglios_basales_talamo: 'Núcleos profundos que regulan el movimiento, la motivación y el paso de la información sensorial (tálamo). Incluye el núcleo basal de Meynert, de donde sale la acetilcolina de la corteza que se pierde en el Alzheimer.',
  tronco_locus_coeruleus: 'La parte más baja del encéfalo, que conecta con la médula. El locus coeruleus, fuente de noradrenalina, es donde se ha descrito tau anómala más temprano.',
  cerebelo: 'Parte posterior e inferior que coordina el movimiento y el equilibrio. Se afecta poco en el Alzheimer, por eso sirve de región de referencia en el PET.',
  sustancia_blanca: 'Los cables del cerebro: los axones recubiertos de mielina que conectan unas regiones con otras. Sus lesiones (hiperintensidades en la resonancia) señalan daño vascular y pérdida de mielina.',
  vascular_bhe: 'Los vasos que riegan el cerebro y la barrera hematoencefálica que filtra lo que pasa de la sangre al tejido. Cuando falla, deja pasar proteínas y células, y acompaña a la angiopatía amiloide.',
  bulbo_olfatorio: 'Primera estación del olfato. La pérdida de olfato es un síntoma temprano y allí la tau aparece pronto.',
  retina: 'Tejido nervioso del ojo, prolongación directa del cerebro. Se explora con tomografía de coherencia óptica (OCT) como ventana no invasiva.',
  intestino_microbiota: 'El intestino y las bacterias que lo habitan. Se estudia su comunicación con el cerebro (eje intestino-cerebro) y su papel en la inflamación.',
  plasma: 'Compartimento periférico: lo que se mide en un análisis de sangre. Biomarcadores como p-tau217, GFAP o NfL llegan aquí desde el cerebro. No es una región anatómica; en la figura va fuera del cerebro.',
  lcr: 'Líquido que baña el cerebro y la médula; se obtiene por punción lumbar. Refleja de forma directa la bioquímica del cerebro (amiloide beta 42, tau total, p-tau181).',
  neocorteza: 'La capa externa del cerebro en general, cuando la fuente no dice qué región concreta. No es un lugar: es una localización fallida, y por eso va en la bandeja de no localizados.',
  cerebro_sin_region: 'El cerebro en su conjunto, o sin región concreta en la fuente (una imagen global, un tejido sin especificar). No es un lugar: es una localización fallida, y por eso va en la bandeja de no localizados.',
});

/** Qué es cada tipo de célula, en llano. Mismo criterio que las regiones. */
export const DEFINICIONES_CELULA: Record<string, string> = traducido({
  astrocito: 'Célula de sostén con forma de estrella: alimenta a las neuronas, regula el medio y forma parte de la barrera hematoencefálica. Cuando se activa libera GFAP.',
  microglia: 'La célula inmune propia del cerebro: limpia restos y placas y, activada de forma crónica, mantiene la inflamación.',
  neurona: 'La célula que transmite señales eléctricas. La pérdida de neuronas y de sus sinapsis es lo que produce los síntomas.',
  oligodendrocito: 'Célula que fabrica la mielina que aísla los axones.',
  opc: 'Célula precursora que puede convertirse en oligodendrocito y reparar la mielina.',
  endotelio: 'Capa de células que recubre el interior de los vasos y forma la barrera hematoencefálica.',
  pericito: 'Célula que envuelve los capilares: regula el flujo y la permeabilidad de la barrera. Su pérdida la debilita.',
  inmune_periferico: 'Células inmunes de la sangre (linfocitos, monocitos, macrófagos) que pueden entrar al cerebro o influir desde fuera.',
});

/** Qué se sabe de una región sin registros: si alguien la buscó o no. */
export type CoberturaRegion = 'con_evidencia' | 'buscada_sin_hallazgo' | 'no_buscada';

/** Cuántas consultas de búsqueda y cuántas fuentes leídas de la investigación nombran una región. */
export interface MencionesRegion {
  consultas: number;
  fuentes: number;
}

/** Una región del atlas: lo que el dibujo pinta y el panel describe. */
export interface RegionAtlas {
  clave: string;
  etiqueta: string;
  definicion: string;
  /** Hechos más hipótesis situados en la región, cada uno una vez; tras los filtros. Es el NÚMERO de la figura. */
  conteo: number;
  hechos: string[];
  hipotesis: string[];
  /** Preguntas abiertas situadas aquí; no cuentan en `conteo`. */
  preguntas: string[];
  /** Las cohortes distintas que sostienen la región (celda.cohortes de las
   *  celdas que aportan algún registro con los filtros puestos, sin repetir).
   *  Su número es el COLOR de la figura. */
  cohortes: string[];
  /** La mayor certeza GRADE entre las hipótesis VIVAS de la región (la de su
   *  ficha), o null si ninguna concluyó. La instantánea del backend
   *  (celda.certezaMax) solo se usa de reserva cuando ninguna hipótesis de la
   *  celda está ya en el estado. */
  certezaMax: string | null;
  /** Registros por fase (clave de estadio; SIN_FASE para los que no la tienen).
   *  Cada registro tiene una sola fase, así que las barras suman `conteo`. */
  porEstadio: Record<string, number>;
  /** Registros por tipo de célula (SIN_CELULA para los que no tienen ninguna).
   *  Un registro puede hablar de varias células (astrocitos y pericitos), así
   *  que estas barras se solapan: su suma puede pasar de `conteo`. */
  porCelula: Record<string, number>;
  /** Ids de hechos e hipótesis de la región que ya no están en el estado:
   *  cuentan en `conteo` (para cuadrar con ejes.region del backend) pero el
   *  panel no puede listarlos; con esto puede decir "y N que ya no están en
   *  el modelo de mundo". */
  sinResolver: number;
  /** Hechos de la región (tras los filtros) que chocan con otro hecho
   *  (`contradiceA` no vacío): la marca de discordia de la figura. */
  discordia: string[];
  /** Cuántas consultas y fuentes de la investigación nombran la región (sin filtros). */
  menciones: MencionesRegion;
  /** Con registros; o sin ellos, buscada (alguna consulta, fuente o pregunta
   *  abierta la nombra) o no buscada. */
  cobertura: CoberturaRegion;
}

export interface FiltrosAtlas {
  /** Una fase (clave de estadio), SIN_FASE para "sin fase identificada", o null para todas. */
  estadio: string | null;
  /** Tipos de célula a mostrar (unión), SIN_CELULA incluida; vacío es todos. */
  celulas: string[];
  /** Ordinal seguido de iteración hasta el que se cuenta; null (o el máximo) es el presente. */
  hasta: number | null;
}

/** La bandeja "No localizados": lo que cayó en cerebro_sin_region o neocorteza. */
export interface NoLocalizados {
  /** Hechos más hipótesis, cada uno una vez aunque esté en las dos claves; tras los filtros. */
  conteo: number;
  hechos: number;
  hipotesis: number;
  /** De `conteo`, cuántos están además en alguna región localizada (la sangre, por ejemplo). */
  tambienSituados: number;
}

export interface Atlas {
  /** Una por clave de REGIONES_CLAVES, en ese orden; después, las que el backend haya añadido. */
  regiones: RegionAtlas[];
  /** El mayor conteo de registros por región con los filtros de fase y célula, sin el de iteración (ver cabecera). */
  maximo: number;
  /** El mayor número de cohortes distintas entre las regiones localizadas con
   *  registros (sin el filtro de iteración): el extremo cálido de la rampa. */
  cohortesMax: number;
  /** El menor número de cohortes distintas entre las regiones localizadas con
   *  registros (sin el filtro de iteración). 0 si alguna región con registros
   *  no tiene ninguna cohorte nombrada. Solo informativo: la rampa NO lo usa
   *  (su extremo frío es siempre 0 cohortes, ver `intensidad`), así que la
   *  leyenda no lo escribe como extremo. */
  cohortesMin: number;
  /** Las fases presentes en el mapa, en orden clínico, con SIN_FASE al final si hay registros sin fase. */
  estadios: { clave: string; etiqueta: string; conteo: number }[];
  /** Los tipos de célula presentes, con SIN_CELULA al final si hay registros sin célula. */
  celulas: { clave: string; etiqueta: string; conteo: number }[];
  /** Los huecos que nombra la misión y nadie cubre, ya en llano. */
  huecos: string[];
  /** Hechos que no se pudieron situar en ningún eje. */
  sinEjes: number;
  /** Hipótesis que no se pudieron situar en ningún eje. */
  hipotesisSinEjes: number;
  /** Registros situados por fase o célula pero sin región (celdas con región
   *  nula), cada uno una vez; tras los filtros. En el estado real ninguno de
   *  ellos está además en una región (el backend no reparte un registro entre
   *  una celda con región y otra sin ella). */
  sinRegion: number;
  /** De `sinRegion`, cuántos son hechos. */
  sinRegionHechos: number;
  /** De `sinRegion`, cuántos son hipótesis. */
  sinRegionHipotesis: number;
  /** La bandeja fuera de la anatomía. */
  noLocalizados: NoLocalizados;
  /** La línea honesta bajo el mapa, tras los filtros: registros en fluidos
   *  (sangre y LCR), en tejido localizado (las demás regiones), en ambos, y
   *  sin localizar (bandeja más celdas sin región, descontando los que sí
   *  están en algún fluido o tejido). */
  fluidos: number;
  tejido: number;
  enAmbos: number;
  sinLocalizar: number;
  /** Hechos distintos con `contradiceA` en las regiones localizadas de la figura. */
  discordantes: number;
  /** Hechos heredados de otra investigación que sí se situaron. */
  heredados: number;
  /** El resumen del mapa CALCULADO de sus celdas con los filtros puestos, en
   *  el formato del backend (rosa/mapa_enfermedad.py _resumen): hechos e
   *  hipótesis únicos, celdas, y las cuatro fases, regiones y células con más
   *  registros. Se calcula aquí y no se imprime el guardado porque al fundir
   *  hechos duplicados (rosa/hechos.py _remapear_investigacion) el backend
   *  reescribe los ids de las celdas sin recalcular `ejes` ni `resumen`: en la
   *  investigación grande el guardado decía 217 hechos y 107 en la sangre
   *  donde las celdas tienen 211 y 106, y la misma pantalla enseñaba las dos
   *  cifras. Lo que el navegador no puede calcular (niveles, misión) no va. */
  resumen: string;
  /** El resumen que guardó el backend al calcular el mapa, tal cual; solo de consulta. */
  resumenGuardado: string;
  /** Los conteos de `mapa.ejes` (guardados por el backend) que ya no cuadran
   *  con las celdas del mismo mapa, en legible: "sangre, plasma y suero
   *  (compartimento periférico): 107 en el resumen guardado, 106 en las
   *  celdas". Vacío si cuadran. Sin filtros: compara el mapa entero. */
  ejesDesfasados: string[];
  /** El número de iteración que anotó el backend al calcular el mapa. OJO: va
   *  POR CORRIDA (vuelve a 1 en cada corrida), no es comparable con
   *  `iteracionMax`; para "calculado al cerrar la iteración N de M" úsese
   *  `iteracionOrdinal`. */
  iteracion: number | null;
  /** La iteración en la que se calculó el mapa, en la numeración SEGUIDA del
   *  deslizador (la de `iteracionMax`), deducida de `fecha`. null si el mapa
   *  no trae fecha o ninguna iteración de la investigación la contiene. */
  iteracionOrdinal: number | null;
  /** Cuándo se calculó el mapa (ms), si el backend lo anotó. */
  fecha: number | null;
  /** Hechos vivos de esta investigación (no descartados, no sustituidos, no
   *  preguntas) nacidos después de `fecha` y que no están en ninguna celda: el
   *  modelo de mundo ya los tiene y el mapa aún no los sitúa; ROSA2018 lo hará
   *  al cerrar la iteración. Por eso una región rayada es "sin evidencia
   *  SITUADA todavía", no "sin evidencia". 0 si el mapa no trae fecha. */
  hechosNuevos: number;
  /** Última iteración, en numeración seguida: el tope del deslizador. */
  iteracionMax: number;
  definiciones: Record<string, Record<string, string>>;
}

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v !== '') : []);
/** Como `lista`, pero conserva la cadena vacía: es SIN_CELULA en el filtro de células. */
const listaConVacio = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const texto = (x: unknown): string => (typeof x === 'string' ? x : '');
const cuentaDe = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
const claveDe = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
/** Un mapa clave a texto: solo un objeto llano con valores de texto. */
const textosDe = (x: unknown): Record<string, string> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === 'string' && v !== '') salida[k] = v;
  return salida;
};
const mayorCerteza = (a: string | null, b: string | null): string | null => {
  const ia = a === null ? -1 : ORDEN_CERTEZA.indexOf(a);
  const ib = b === null ? -1 : ORDEN_CERTEZA.indexOf(b);
  return ib > ia ? b : a;
};
/** La certeza que trae una celda: solo si es un nivel GRADE conocido. */
const certezaDeCelda = (c: CeldaMapa): string | null => (typeof c.certezaMax === 'string' && ORDEN_CERTEZA.includes(c.certezaMax) ? c.certezaMax : null);
/** La certeza viva de una hipótesis, si tiene conclusión con un nivel conocido. */
const certezaDeHipotesis = (h: Hipotesis | undefined): string | null => {
  const c = h?.conclusion?.certeza;
  return typeof c === 'string' && ORDEN_CERTEZA.includes(c) ? c : null;
};

// ---------------------------------------------------------------------------
// Nombrar una región en un texto: el mismo criterio que el backend
// ---------------------------------------------------------------------------

/** Un carácter en minúscula y sin marca diacrítica, siempre de longitud 1
 *  (rosa/mapa_enfermedad.py _caracter_normalizado). Los guiones tipográficos
 *  pasan a "-"; "mayor o igual" y "menor o igual" se conservan. */
function caracterNormalizado(c: string): string {
  if (c === '\u2013' || c === '\u2014' || c === '\u2212') return '-';
  if (c === '\u2265' || c === '\u2264') return c;
  for (const ch of c.normalize('NFKD')) if (!/\p{Mn}/u.test(ch)) return ch;
  return ' ';
}

/** Minúsculas y sin tildes, carácter a carácter, como `normalizar` del backend:
 *  la cadena normalizada tiene la misma longitud que la original. */
export function normalizar(texto: unknown): string {
  let salida = '';
  for (const c of String(texto ?? '').toLowerCase()) salida += caracterNormalizado(c);
  return salida;
}

const REGIONES_RE: [string, RegExp][] = Object.entries(REGIONES_PATRONES).map(([clave, patron]) => [clave, new RegExp(patron)]);

/** Las genéricas ceden: "cerebro" y "corteza" a secas se quitan si hay una
 *  región concreta del sistema nervioso, y "cerebro" a secas se quita también
 *  si al menos hay "corteza" (rosa/mapa_enfermedad.py _quitar_genericas). */
function quitarGenericas(regiones: string[]): string[] {
  const concretas = regiones.filter((r) => !REGIONES_GENERICAS.includes(r) && !COMPARTIMENTOS_PERIFERICOS.has(r));
  if (concretas.length > 0) return regiones.filter((r) => !REGIONES_GENERICAS.includes(r));
  if (regiones.includes('neocorteza')) return regiones.filter((r) => r !== 'cerebro_sin_region');
  return regiones;
}

/** Las claves de región que nombra un texto, con las expresiones regulares y
 *  la normalización del backend, en el orden de REGIONES_CLAVES. Vacío si el
 *  texto no nombra ninguna o no es texto. */
export function regionesEnTexto(texto: unknown): string[] {
  const t = normalizar(texto);
  if (t.trim() === '') return [];
  return quitarGenericas(REGIONES_RE.filter(([, re]) => re.test(t)).map(([clave]) => clave));
}

/** Cuántas consultas y cuántas fuentes de la investigación nombran cada
 *  región. Las consultas: las de `busqueda.consultas` de sus corridas (tema y
 *  texto). Las fuentes, cada una una vez aunque la citen varias hipótesis y
 *  hechos: las de la procedencia de las hipótesis (título y fragmento), las
 *  excluidas en el cribado (título y referencia) y las referencias de la
 *  procedencia de los hechos. */
function mencionesPorRegion(estado: EstadoRosa, inv: Investigacion): Map<string, MencionesRegion> {
  const salida = new Map<string, MencionesRegion>();
  const sumar = (eje: keyof MencionesRegion, t: string): void => {
    for (const clave of regionesEnTexto(t)) {
      const m = salida.get(clave) ?? { consultas: 0, fuentes: 0 };
      m[eje] += 1;
      salida.set(clave, m);
    }
  };
  const fuentesVistas = new Set<string>();
  const fuente = (clave: string, t: string): void => {
    const k = clave.trim();
    if (k === '' || fuentesVistas.has(k)) return;
    fuentesVistas.add(k);
    sumar('fuentes', t);
  };
  for (const c of estado.corridas ?? []) {
    if (!c || c.investigacionId !== inv.id) continue;
    const consultas = Array.isArray(c.busqueda?.consultas) ? c.busqueda.consultas : [];
    for (const q of consultas) {
      if (!q || typeof q !== 'object') continue;
      const tema = texto((q as { tema?: unknown }).tema);
      sumar('consultas', `${tema} ${texto(q.consulta)}`);
    }
    const excluidos = Array.isArray(c.busqueda?.excluidos) ? c.busqueda.excluidos : [];
    for (const x of excluidos) {
      if (!x || typeof x !== 'object') continue;
      fuente(texto(x.doi) || texto(x.pmid) || `${texto(x.referencia)}|${texto(x.titulo)}`, `${texto(x.titulo)} ${texto(x.referencia)}`);
    }
  }
  for (const h of estado.hipotesis ?? []) {
    if (!h || h.investigacionId !== inv.id) continue;
    const fuentes = Array.isArray(h.procedencia?.fuentes) ? h.procedencia.fuentes : [];
    for (const f of fuentes) {
      if (!f || typeof f !== 'object') continue;
      fuente(texto(f.id) || texto(f.doi) || `${texto(f.referencia)}|${texto(f.titulo)}`, `${texto(f.titulo)} ${texto(f.fragmento)}`);
    }
  }
  for (const h of estado.hechos ?? []) {
    if (!h || h.investigacionId !== inv.id) continue;
    for (const p of Array.isArray(h.procedencia) ? h.procedencia : []) {
      if (!p || typeof p !== 'object') continue;
      fuente(texto(p.fuenteId) || `ref|${texto(p.referencia)}`, texto(p.referencia));
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Construcción del atlas
// ---------------------------------------------------------------------------

/** Cuándo nació un hecho: la fecha más antigua de su historial (el primer
 *  movimiento es el alta) o, sin historial, su última actualización. undefined
 *  si no hay ninguna fecha válida. */
function nacimientoHecho(h: HechoMundo): number | undefined {
  let minimo: number | undefined;
  for (const m of h.historial ?? []) {
    const f = m?.fecha;
    if (typeof f === 'number' && Number.isFinite(f) && (minimo === undefined || f < minimo)) minimo = f;
  }
  if (minimo !== undefined) return minimo;
  return typeof h.actualizadoEn === 'number' && Number.isFinite(h.actualizadoEn) ? h.actualizadoEn : undefined;
}

/** Acumulador por región: ids únicos, por fase y por célula, cohortes y certeza. */
interface Cuenta {
  hechos: Set<string>;
  hipotesis: Set<string>;
  preguntas: Set<string>;
  cohortes: Set<string>;
  porEstadio: Map<string, Set<string>>;
  porCelula: Map<string, Set<string>>;
  certeza: string | null;
  /** Hechos e hipótesis sin el filtro de iteración: para `maximo`. */
  todos: Set<string>;
  /** Cohortes sin el filtro de iteración: para `cohortesMax` y `cohortesMin`. */
  cohortesTodas: Set<string>;
}
const cuentaVacia = (): Cuenta => ({ hechos: new Set(), hipotesis: new Set(), preguntas: new Set(), cohortes: new Set(), porEstadio: new Map(), porCelula: new Map(), certeza: null, todos: new Set(), cohortesTodas: new Set() });
const sumarA = (mapa: Map<string, Set<string>>, clave: string, id: string): void => {
  const s = mapa.get(clave) ?? new Set<string>();
  s.add(id);
  mapa.set(clave, s);
};
/** "Sin fase" y "sin célula" van siempre al final, detrás de las claves del backend en su orden. */
const esSin = (k: string): boolean => k === SIN_FASE || k === SIN_CELULA;
const ordenarClaves = (claves: Iterable<string>, orden: string[]): string[] =>
  [...claves].sort((a, b) => {
    if (esSin(a) && !esSin(b)) return 1;
    if (esSin(b) && !esSin(a)) return -1;
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
const tamanos = (mapa: Map<string, Set<string>>, orden: string[]): Record<string, number> => {
  const salida: Record<string, number> = {};
  for (const k of ordenarClaves(mapa.keys(), orden)) salida[k] = mapa.get(k)!.size;
  return salida;
};
const union = (conjuntos: Iterable<Set<string>>): Set<string> => {
  const s = new Set<string>();
  for (const c of conjuntos) for (const id of c) s.add(id);
  return s;
};

/** Construye el atlas de una investigación. null si no tiene mapa o el mapa no
 *  tiene celdas: la pantalla enseña entonces el estado vacío en llano. */
export function construirAtlas(estado: EstadoRosa, inv: Investigacion, filtros: Partial<FiltrosAtlas> = {}): Atlas | null {
  const mapa: MapaEnfermedad | null | undefined = inv.mapaEnfermedad;
  if (!mapa || typeof mapa !== 'object') return null;
  const celdas = (Array.isArray(mapa.celdas) ? mapa.celdas : []).filter((c): c is CeldaMapa => Boolean(c) && typeof c === 'object');
  if (celdas.length === 0) return null;

  // Numeración seguida de las iteraciones (lib/arbol.ts): el backend numera por
  // corrida, así que la fecha de cada hecho se traduce a su ordinal acumulado.
  const corridasInv = (estado.corridas ?? []).filter((c) => c.investigacionId === inv.id);
  const idsCorridas = new Set(corridasInv.map((c) => c.id));
  const iteracionesInv = (estado.iteraciones ?? []).filter((i) => idsCorridas.has(i.corridaId));
  const ordinales = ordinalesDeIteraciones(iteracionesInv, corridasInv);
  const ordinalEn = (t: number | undefined): number | undefined => {
    const it = iteracionObjEn(iteracionesInv, t);
    return it ? ordinales.deIteracion.get(it.id) : undefined;
  };
  const hechosPorId = new Map<string, HechoMundo>();
  for (const h of estado.hechos ?? []) if (h && typeof h.id === 'string') hechosPorId.set(h.id, h);
  const hipPorId = new Map<string, Hipotesis>();
  for (const h of estado.hipotesis ?? []) if (h && typeof h.id === 'string') hipPorId.set(h.id, h);
  const hipInv = (estado.hipotesis ?? []).filter((h) => h.investigacionId === inv.id);
  // La hipótesis guarda su iteración por corrida; la corrida en la que nació
  // (por fecha) da el desplazamiento. Misma regla que el árbol (ordinalHip).
  const ordinalHip = (h: Hipotesis): number | undefined => {
    const t = typeof h.creadaEn === 'number' && Number.isFinite(h.creadaEn) ? h.creadaEn : undefined;
    const corrida = t === undefined ? undefined : corridasInv.find((c) => typeof c.empezadaEn === 'number' && c.empezadaEn <= t && (c.terminadaEn == null || t <= c.terminadaEn));
    const desplazamiento = corrida ? ordinales.deCorrida.get(corrida.id) : undefined;
    const propia = typeof h.iteracion === 'number' && Number.isFinite(h.iteracion) && h.iteracion > 0 ? h.iteracion : undefined;
    if (desplazamiento !== undefined && propia !== undefined) return desplazamiento + propia;
    return ordinalEn(t) ?? propia;
  };
  const ordinalesHip = hipInv.map(ordinalHip).filter((o): o is number => o !== undefined);
  const iteracionMax = Math.max(1, ordinales.total, ...hipInv.map((h) => (typeof h.iteracion === 'number' && Number.isFinite(h.iteracion) ? h.iteracion : 0)), ...ordinalesHip);
  const hasta = typeof filtros.hasta === 'number' && Number.isFinite(filtros.hasta) && filtros.hasta < iteracionMax ? Math.max(0, Math.floor(filtros.hasta)) : null;
  // Un hecho o hipótesis sin fecha, o que ya no está en el estado, cuenta siempre.
  const pasaHecho = (id: string): boolean => {
    if (hasta === null) return true;
    const h = hechosPorId.get(id);
    const o = h ? ordinalEn(nacimientoHecho(h)) : undefined;
    return o === undefined || o <= hasta;
  };
  const pasaHipotesis = (id: string): boolean => {
    if (hasta === null) return true;
    const h = hipPorId.get(id);
    const o = h ? ordinalHip(h) : undefined;
    return o === undefined || o <= hasta;
  };

  const estadioFiltro = typeof filtros.estadio === 'string' ? filtros.estadio : null;
  // SIN_CELULA es '' y tiene que poder pedirse: por eso no se usa `lista`.
  const celulasFiltro = new Set(listaConVacio(filtros.celulas));
  const pasaCelda = (c: CeldaMapa): boolean => {
    const estadio = claveDe(c.estadio) ?? SIN_FASE;
    if (estadioFiltro !== null && estadio !== estadioFiltro) return false;
    const celula = claveDe(c.tipoCelular) ?? SIN_CELULA;
    if (celulasFiltro.size > 0 && !celulasFiltro.has(celula)) return false;
    return true;
  };

  const porRegion = new Map<string, Cuenta>();
  for (const r of REGIONES_CLAVES) porRegion.set(r, cuentaVacia());
  // Lo situado por fase o célula pero sin región: celdas con región nula.
  const sinRegionHechosIds = new Set<string>();
  const sinRegionHipotesisIds = new Set<string>();
  // Cifras de los chips: por fase y por célula sobre todo el mapa (también las
  // celdas sin región), con el filtro de iteración pero sin los demás, para que
  // cada chip diga cuánto hay de lo suyo y no cambie al pulsar otro.
  const globalEstadio = new Map<string, Set<string>>();
  const globalCelula = new Map<string, Set<string>>();
  const estadiosPresentes = new Set<string>();
  const celulasPresentes = new Set<string>();
  // Todo id que el mapa sitúa en alguna celda (con o sin región), para saber
  // qué hechos vivos del estado NO están en el mapa.
  const enElMapa = new Set<string>();
  // Los tres ejes del mapa entero, SIN ningún filtro y con ids únicos por
  // clave: para cotejar los `ejes` que guardó el backend con sus celdas.
  const todoEstadio = new Map<string, Set<string>>();
  const todoRegion = new Map<string, Set<string>>();
  const todoCelula = new Map<string, Set<string>>();
  // El resumen calculado (con todos los filtros, celdas con y sin región):
  // hechos e hipótesis únicos, celdas con algo dentro y los ejes con ids únicos.
  const resumenHechos = new Set<string>();
  const resumenHipotesis = new Set<string>();
  const resumenEstadio = new Map<string, Set<string>>();
  const resumenRegion = new Map<string, Set<string>>();
  const resumenCelula = new Map<string, Set<string>>();
  let celdasConAlgo = 0;

  for (const c of celdas) {
    const estadio = claveDe(c.estadio) ?? SIN_FASE;
    const celula = claveDe(c.tipoCelular) ?? SIN_CELULA;
    const region = claveDe(c.region);
    estadiosPresentes.add(estadio);
    celulasPresentes.add(celula);
    for (const id of [...lista(c.hechos), ...lista(c.hipotesis), ...lista(c.preguntas)]) enElMapa.add(id);
    for (const id of [...lista(c.hechos), ...lista(c.hipotesis)]) {
      if (estadio !== SIN_FASE) sumarA(todoEstadio, estadio, id);
      if (region !== null) sumarA(todoRegion, region, id);
      if (celula !== SIN_CELULA) sumarA(todoCelula, celula, id);
    }
    const hechos = lista(c.hechos).filter(pasaHecho);
    const hipotesis = lista(c.hipotesis).filter(pasaHipotesis);
    const registros = [...hechos, ...hipotesis];
    for (const id of registros) {
      sumarA(globalEstadio, estadio, id);
      sumarA(globalCelula, celula, id);
    }
    if (!pasaCelda(c)) continue;
    for (const id of hechos) resumenHechos.add(id);
    for (const id of hipotesis) resumenHipotesis.add(id);
    if (registros.length > 0 || lista(c.preguntas).some(pasaHecho)) celdasConAlgo++;
    for (const id of registros) {
      if (estadio !== SIN_FASE) sumarA(resumenEstadio, estadio, id);
      if (region !== null) sumarA(resumenRegion, region, id);
      if (celula !== SIN_CELULA) sumarA(resumenCelula, celula, id);
    }
    if (region === null) {
      for (const id of hechos) sinRegionHechosIds.add(id);
      for (const id of hipotesis) sinRegionHipotesisIds.add(id);
      continue;
    }
    let cuenta = porRegion.get(region);
    if (!cuenta) {
      // Una región que el backend añadió después de esta interfaz: se conserva
      // al final, con su clave en legible, en vez de perder sus registros.
      cuenta = cuentaVacia();
      porRegion.set(region, cuenta);
    }
    for (const id of hechos) cuenta.hechos.add(id);
    for (const id of hipotesis) cuenta.hipotesis.add(id);
    // Las preguntas son hechos con tipo 'pregunta': el deslizador las recorta
    // por su fecha de nacimiento igual que a los demás hechos.
    for (const id of lista(c.preguntas).filter(pasaHecho)) cuenta.preguntas.add(id);
    const todosDeCelda = [...lista(c.hechos), ...lista(c.hipotesis)];
    for (const id of todosDeCelda) cuenta.todos.add(id);
    for (const id of registros) {
      sumarA(cuenta.porEstadio, estadio, id);
      sumarA(cuenta.porCelula, celula, id);
    }
    // Las cohortes van con la celda, no con cada registro: una celda las
    // aporta solo si aporta algún registro (una celda vacía no sostiene nada, y
    // viajando en el tiempo una celda cuyos registros aún no existían tampoco).
    const cohortesCelda = lista(c.cohortes);
    if (registros.length > 0) for (const co of cohortesCelda) cuenta.cohortes.add(co);
    if (todosDeCelda.length > 0) for (const co of cohortesCelda) cuenta.cohortesTodas.add(co);
    // La certeza: SIEMPRE la viva de las hipótesis (la que enseña su ficha),
    // tanto en el presente como viajando en el tiempo, para que el atlas no
    // contradiga a la ficha si una hipótesis subió de certeza después de que el
    // backend guardara el mapa, y para que volver al presente nunca la baje.
    // Viajando, solo las hipótesis que ya existían. La instantánea del backend
    // (celda.certezaMax) queda de reserva únicamente cuando ninguna hipótesis
    // de la celda está en el estado: ahí no hay ficha con la que contrastar.
    const vivas = lista(c.hipotesis).filter((id) => hipPorId.has(id));
    if (vivas.length === 0) cuenta.certeza = mayorCerteza(cuenta.certeza, certezaDeCelda(c));
    else for (const id of hipotesis) cuenta.certeza = mayorCerteza(cuenta.certeza, certezaDeHipotesis(hipPorId.get(id)));
  }

  const propias = mapa.definiciones && typeof mapa.definiciones === 'object' ? (mapa.definiciones as Record<string, unknown>) : {};
  const definiciones: Record<string, Record<string, string>> = {
    estadio: { ...DEFINICIONES_MAPA.estadio, ...textosDe(propias.estadio) },
    region: { ...DEFINICIONES_REGION, ...textosDe(propias.region) },
    tipoCelular: { ...DEFINICIONES_CELULA, ...textosDe(propias.tipoCelular) },
    nivel: { ...DEFINICIONES_MAPA.nivel, ...textosDe(propias.nivel) },
  };
  // La etiqueta de una clave: la del mapa, la de reserva o, si nadie la conoce
  // (una clave que el backend añadió después de esta interfaz), la clave en
  // legible: guiones bajos a espacios, como hace legible() en el árbol. Nunca
  // 'medula_espinal' en un panel para una médica.
  const etiqueta = (eje: 'estadio' | 'region' | 'tipoCelular', clave: string): string => {
    if (eje === 'estadio' && clave === SIN_FASE) return ETIQUETA_SIN_FASE;
    if (eje === 'tipoCelular' && clave === SIN_CELULA) return ETIQUETA_SIN_CELULA;
    const e = etiquetaEje(mapa, eje, clave);
    return e === clave ? clave.replace(/_/g, ' ') : e;
  };

  const menciones = mencionesPorRegion(estado, inv);
  const tieneContradiccion = (id: string): boolean => {
    const h = hechosPorId.get(id);
    return Boolean(h) && Array.isArray(h!.contradiceA) && h!.contradiceA.some((x) => typeof x === 'string' && x !== '');
  };

  const regiones: RegionAtlas[] = [...porRegion.entries()]
    .map(([clave, c]) => {
      const conteo = c.hechos.size + c.hipotesis.size;
      const m = menciones.get(clave) ?? { consultas: 0, fuentes: 0 };
      const cobertura: CoberturaRegion = conteo > 0 ? 'con_evidencia' : m.consultas + m.fuentes + c.preguntas.size > 0 ? 'buscada_sin_hallazgo' : 'no_buscada';
      return {
        clave,
        etiqueta: etiqueta('region', clave),
        definicion: definiciones.region![clave] ?? DEFINICION_REGION_NUEVA,
        conteo,
        hechos: [...c.hechos],
        hipotesis: [...c.hipotesis],
        preguntas: [...c.preguntas],
        cohortes: [...c.cohortes].sort((a, b) => a.localeCompare(b)),
        certezaMax: c.certeza,
        porEstadio: tamanos(c.porEstadio, ESTADIOS_CLAVES),
        porCelula: tamanos(c.porCelula, CELULAS_CLAVES),
        sinResolver: [...c.hechos].filter((id) => !hechosPorId.has(id)).length + [...c.hipotesis].filter((id) => !hipPorId.has(id)).length,
        discordia: [...c.hechos].filter(tieneContradiccion),
        menciones: { consultas: m.consultas, fuentes: m.fuentes },
        cobertura,
      };
    })
    .sort((a, b) => {
      const ia = REGIONES_CLAVES.indexOf(a.clave);
      const ib = REGIONES_CLAVES.indexOf(b.clave);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return b.conteo - a.conteo || a.clave.localeCompare(b.clave);
    });
  const maximo = Math.max(0, ...[...porRegion.values()].map((c) => c.todos.size));
  // La escala de color: cohortes distintas de las regiones LOCALIZADAS con
  // registros (la bandeja no se pinta), sin el deslizador.
  const localizadasConRegistros = [...porRegion.entries()].filter(([clave, c]) => !NO_LOCALIZADAS.has(clave) && c.todos.size > 0).map(([, c]) => c.cohortesTodas.size);
  const cohortesMax = localizadasConRegistros.length > 0 ? Math.max(...localizadasConRegistros) : 0;
  const cohortesMin = localizadasConRegistros.length > 0 ? Math.min(...localizadasConRegistros) : 0;

  const sinRegionHechos = sinRegionHechosIds.size;
  const sinRegionHipotesis = [...sinRegionHipotesisIds].filter((id) => !sinRegionHechosIds.has(id)).length;

  // La bandeja y la línea honesta.
  const idsDe = (c: Cuenta): Set<string> => union([c.hechos, c.hipotesis]);
  const bandejaHechos = union([...porRegion.entries()].filter(([k]) => NO_LOCALIZADAS.has(k)).map(([, c]) => c.hechos));
  const bandejaHipotesis = union([...porRegion.entries()].filter(([k]) => NO_LOCALIZADAS.has(k)).map(([, c]) => c.hipotesis));
  const bandejaIds = union([bandejaHechos, bandejaHipotesis]);
  const fluidosIds = union([...porRegion.entries()].filter(([k]) => FLUIDOS.has(k)).map(([, c]) => idsDe(c)));
  const tejidoIds = union([...porRegion.entries()].filter(([k]) => !FLUIDOS.has(k) && !NO_LOCALIZADAS.has(k)).map(([, c]) => idsDe(c)));
  const localizadosIds = union([fluidosIds, tejidoIds]);
  const enAmbos = [...fluidosIds].filter((id) => tejidoIds.has(id)).length;
  const sinLocalizar = [...union([bandejaIds, sinRegionHechosIds, sinRegionHipotesisIds])].filter((id) => !localizadosIds.has(id)).length;
  const noLocalizados: NoLocalizados = {
    conteo: bandejaIds.size,
    hechos: bandejaHechos.size,
    hipotesis: [...bandejaHipotesis].filter((id) => !bandejaHechos.has(id)).length,
    tambienSituados: [...bandejaIds].filter((id) => localizadosIds.has(id)).length,
  };
  const discordantes = union([...porRegion.entries()].filter(([k]) => !NO_LOCALIZADAS.has(k)).map(([, c]) => new Set([...c.hechos].filter(tieneContradiccion)))).size;

  const estadios = ordenarClaves(estadiosPresentes, ESTADIOS_CLAVES).map((clave) => ({ clave, etiqueta: etiqueta('estadio', clave), conteo: globalEstadio.get(clave)?.size ?? 0 }));
  const celulas = ordenarClaves(celulasPresentes, CELULAS_CLAVES).map((clave) => ({ clave, etiqueta: etiqueta('tipoCelular', clave), conteo: globalCelula.get(clave)?.size ?? 0 }));

  // El resumen, calculado de las celdas con el formato del backend (_resumen y
  // _top de rosa/mapa_enfermedad.py: las cuatro claves con más registros de
  // cada eje, a igual conteo por clave).
  const cuatroMayores = (mapaEje: Map<string, Set<string>>, eje: 'estadio' | 'region' | 'tipoCelular'): string =>
    [...mapaEje.entries()]
      .map(([k, ids]) => [k, ids.size] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([k, n]) => `${etiqueta(eje, k)} ${n}`)
      .join(', ');
  let resumen: string;
  if (resumenHechos.size === 0 && resumenHipotesis.size === 0) {
    resumen = tr('Ningún hecho ni hipótesis situados con estos filtros.');
  } else {
    resumen = trp('{hechos} y {hipotesis} situados en {celdas} (estadio, región y tipo celular).', {
      hechos: plural(resumenHechos.size, tr('hecho')),
      hipotesis: plural(resumenHipotesis.size, tr('hipótesis'), trc('plural', 'hipótesis')),
      celdas: plural(celdasConAlgo, tr('celda')),
    });
    for (const [nombre, mapaEje, eje] of [[tr('Estadios'), resumenEstadio, 'estadio'], [tr('Regiones'), resumenRegion, 'region'], [tr('Tipos celulares'), resumenCelula, 'tipoCelular']] as const) {
      const lista4 = cuatroMayores(mapaEje, eje);
      if (lista4) resumen += ` ${nombre}: ${lista4}.`;
    }
  }
  // Los ejes guardados frente a las celdas: si el backend fundió hechos
  // después de calcular el mapa, sus conteos ya no cuadran y aquí se dice cuáles.
  const ejesGuardados = mapa.ejes && typeof mapa.ejes === 'object' && !Array.isArray(mapa.ejes) ? (mapa.ejes as Record<string, unknown>) : {};
  const ejesDesfasados: string[] = [];
  for (const [eje, calculado, orden] of [['estadio', todoEstadio, ESTADIOS_CLAVES], ['region', todoRegion, REGIONES_CLAVES], ['tipoCelular', todoCelula, CELULAS_CLAVES]] as const) {
    const guardado = ejesGuardados[eje];
    if (!guardado || typeof guardado !== 'object' || Array.isArray(guardado)) continue;
    const conteosGuardados = guardado as Record<string, unknown>;
    // Un eje guardado sin ninguna clave no dice nada (un mapa de prueba o de
    // una versión vieja): no se coteja, en vez de dar todo por desfasado.
    if (Object.keys(conteosGuardados).length === 0) continue;
    for (const k of ordenarClaves(new Set([...Object.keys(conteosGuardados), ...calculado.keys()]), orden)) {
      const g = cuentaDe(conteosGuardados[k]);
      const c = calculado.get(k)?.size ?? 0;
      if (g !== c) ejesDesfasados.push(trp("{eje}: {g} en el resumen guardado, {c} en las celdas", { eje: etiqueta(eje, k), g, c }));
    }
  }

  const huecos = (Array.isArray(mapa.huecos) ? mapa.huecos : [])
    .filter((h): h is NonNullable<typeof h> => Boolean(h) && typeof h === 'object')
    .map((h) => {
      const motivo = texto(h.motivo);
      if (motivo) return motivo;
      const partes = [claveDe(h.estadio) && etiqueta('estadio', h.estadio!), claveDe(h.region) && etiqueta('region', h.region!), claveDe(h.tipoCelular) && etiqueta('tipoCelular', h.tipoCelular!)].filter((p): p is string => typeof p === 'string' && p !== '');
      return trp('{ejes}: la misión lo nombra y ningún hecho ni hipótesis lo cubre por su propio contenido.', { ejes: partes.join(' · ') || tr('Sin ejes') });
    });

  const fecha = typeof mapa.fecha === 'number' && Number.isFinite(mapa.fecha) ? mapa.fecha : null;
  // Hechos vivos de la investigación que nacieron después del mapa y no están
  // en él: el mapa es una instantánea, no el modelo de mundo en vivo. Sin
  // fecha no se puede saber cuáles son posteriores: 0, no una cifra inventada.
  let hechosNuevos = 0;
  if (fecha !== null) {
    for (const h of estado.hechos ?? []) {
      if (!h || h.investigacionId !== inv.id || h.tipo === 'pregunta' || h.estado === 'descartado' || h.sustituidoPor) continue;
      if (typeof h.id !== 'string' || enElMapa.has(h.id)) continue;
      const nacio = nacimientoHecho(h);
      if (nacio !== undefined && nacio > fecha) hechosNuevos++;
    }
  }

  return {
    regiones,
    maximo,
    cohortesMax,
    cohortesMin,
    estadios,
    celulas,
    huecos,
    sinEjes: cuentaDe(mapa.sinEjes),
    hipotesisSinEjes: cuentaDe(mapa.hipotesisSinEjes),
    sinRegion: sinRegionHechos + sinRegionHipotesis,
    sinRegionHechos,
    sinRegionHipotesis,
    noLocalizados,
    fluidos: fluidosIds.size,
    tejido: tejidoIds.size,
    enAmbos,
    sinLocalizar,
    discordantes,
    heredados: cuentaDe(mapa.heredados),
    resumen,
    resumenGuardado: texto(mapa.resumen),
    ejesDesfasados,
    iteracion: cuentaDe(mapa.iteracion) > 0 ? cuentaDe(mapa.iteracion) : null,
    iteracionOrdinal: ordinalEn(fecha ?? undefined) ?? null,
    fecha,
    hechosNuevos,
    iteracionMax,
    definiciones,
  };
}

/** Intensidad de color de una región, de 0 a 1, en escala logarítmica. Se
 *  aplica al número de cohortes distintas frente al máximo presente: las
 *  cohortes se reparten muy desigual (24 en la sangre, 4 en los vasos, 0 en
 *  el hipocampo) y en escala lineal casi todo el cerebro saldría apagado. 0
 *  sin cohortes (el extremo frío es SIEMPRE 0, no el mínimo presente), 1 en
 *  el máximo, y crece con el conteo. Sirve igual para cualquier conteo frente
 *  a su máximo. */
export function intensidad(conteo: number, maximo: number): number {
  if (!(conteo > 0) || !(maximo > 0)) return 0;
  if (conteo >= maximo) return 1;
  return Math.log1p(conteo) / Math.log1p(maximo);
}

/** Los hechos del estado con esos ids, en el orden dado y sin repetir; los ids que no existen se saltan. */
export function hechosDe(estado: EstadoRosa, ids: readonly string[]): HechoMundo[] {
  const porId = new Map<string, HechoMundo>();
  for (const h of estado.hechos ?? []) if (h && typeof h.id === 'string') porId.set(h.id, h);
  return resolver(porId, ids);
}

/** Las hipótesis del estado con esos ids, en el orden dado y sin repetir; los ids que no existen se saltan. */
export function hipotesisDe(estado: EstadoRosa, ids: readonly string[]): Hipotesis[] {
  const porId = new Map<string, Hipotesis>();
  for (const h of estado.hipotesis ?? []) if (h && typeof h.id === 'string') porId.set(h.id, h);
  return resolver(porId, ids);
}

function resolver<T>(porId: Map<string, T>, ids: readonly string[]): T[] {
  const vistos = new Set<string>();
  const salida: T[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || vistos.has(id)) continue;
    vistos.add(id);
    const x = porId.get(id);
    if (x !== undefined) salida.push(x);
  }
  return salida;
}

/** Las etiquetas de reserva del mapa, reexportadas para quien dibuje sin un mapa a mano. */
export { ETIQUETAS_MAPA };
