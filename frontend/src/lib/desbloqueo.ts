// Qué desbloquea más: de todo lo que les falta a las hipótesis, qué conviene
// conseguir primero.
//
// Cada hipótesis lleva una ficha de supuestos (lo que tiene que ser cierto para
// que la hipótesis se sostenga), y el verificador marca cada uno como
// respaldado, plausible, sin evidencia o contradicho. Un supuesto sin
// evidencia no es un supuesto falso: es uno que nadie ha podido comprobar
// todavía, porque falta algo. Ese algo es lo que aquí se llama un
// ingrediente: un intervalo de referencia, los resultados de un ensayo, el
// tamaño de un subgrupo en ADNI.
//
// Muchos supuestos, de hipótesis distintas, esperan el mismo ingrediente. Esta
// pantalla los junta para contestar la pregunta que hace quien dirige el
// laboratorio: ¿qué pido primero?
//
// Cómo se decide el ingrediente de cada supuesto: por reglas de palabras, sin
// modelo, en orden; gana la primera que casa y se guarda la frase que la hizo
// casar, para que la pantalla enseñe el porqué. Las reglas se escribieron
// leyendo los 164 supuestos flojos de la base del 23 de septiembre de 2026 y
// se miden contra esa lectura hecha a mano (desbloqueo.casos.json, en los
// tests). Lo que ninguna regla reconoce sale como "sin clasificar", a la
// vista: no se esconde ni se reparte a ojo.
//
// Comprobar no es confirmar. Conseguir un ingrediente deja comprobar un
// supuesto, y el dato puede darle la razón o quitársela.

import type { Hipotesis, SelloSupuestos } from '../datos/tipos';

/** Por dónde se consigue un ingrediente. Es lo que decide el plazo y quién
 *  tiene que moverse, y por eso agrupa la lista. */
export type Via = 'publicado' | 'cohorte' | 'analisis' | 'investigacion';

export type IdIngrediente =
  | 'ensayos'
  | 'referencia'
  | 'medida'
  | 'cohortes'
  | 'escalas'
  | 'subcohorte'
  | 'amiloide'
  | 'seriado'
  | 'covariables'
  | 'estimable'
  | 'investigar';

export interface Ingrediente {
  id: IdIngrediente;
  nombre: string;
  /** Qué es, en una frase que se entienda sin saber estadística. */
  que: string;
  /** Dónde se consigue. Solo fuentes que existen. */
  donde: string;
  via: Via;
}

export const VIAS: { id: Via; nombre: string; como: string }[] = [
  { id: 'publicado', nombre: 'Buscar en lo publicado', como: 'artículos, suplementos y registros de ensayos' },
  { id: 'cohorte', nombre: 'Pedir datos de una cohorte', como: 'hace falta una solicitud de datos' },
  { id: 'analisis', nombre: 'Hacer el análisis', como: 'no hace falta pedir nada' },
  { id: 'investigacion', nombre: 'Investigación nueva', como: 'un estudio que todavía no existe' },
];

export const INGREDIENTES: Ingrediente[] = [
  {
    id: 'ensayos',
    nombre: 'Resultados de ensayos clínicos',
    que: 'Lo que cada ensayo publicó de cada biomarcador, tratamiento frente a placebo: valores absolutos, con su incertidumbre y por subgrupos.',
    donde: 'Artículos y suplementos de los ensayos, y los resultados estructurados de ClinicalTrials.gov, que ROSA2018 todavía no lee.',
    via: 'publicado',
  },
  {
    id: 'referencia',
    nombre: 'Intervalo de referencia',
    que: 'Los límites de lo normal para cada marcador, sacados de personas sanas y amiloide-negativas que no son las del estudio, con el mismo ensayo de laboratorio y ajustados por edad y sexo.',
    donde: 'Publicaciones de valores de referencia por plataforma; si no existen, una muestra de referencia propia.',
    via: 'publicado',
  },
  {
    id: 'medida',
    nombre: 'Fiabilidad de la medida',
    que: 'Que el marcador se mida con precisión (variación del ensayo, lotes, muestras archivadas) y de forma comparable entre visitas, laboratorios, plataformas y compartimentos.',
    donde: 'La validación analítica de cada ensayo y los estudios de armonización entre plataformas.',
    via: 'publicado',
  },
  {
    id: 'cohortes',
    nombre: 'Resultados de cohortes por subgrupo',
    que: 'Lo que las cohortes ya publicaron, desglosado por el subgrupo que pide la hipótesis (APOE ε4, amiloide positivo) y con la cifra que hace falta.',
    donde: 'Artículos de las cohortes longitudinales y su material suplementario.',
    via: 'publicado',
  },
  {
    id: 'escalas',
    nombre: 'Desenlace clínico comparable',
    que: 'Una medida clínica que valga lo mismo entre ensayos (CDR-SB frente a iADRS, duraciones distintas) y que se mueva lo bastante para ver el efecto.',
    donde: 'Estudios de equivalencia entre escalas y el protocolo de cada ensayo.',
    via: 'publicado',
  },
  {
    id: 'subcohorte',
    nombre: 'Tamaño del subgrupo en la cohorte',
    que: 'Cuántas personas cumplen a la vez todas las condiciones de la hipótesis (APOE ε4, amiloide positivo, cognición normal, plasma seriado). Sin ese número no se sabe si el estudio se puede hacer.',
    donde: 'ADNI, que es de acceso controlado y que hoy el proyecto no solicita.',
    via: 'cohorte',
  },
  {
    id: 'seriado',
    nombre: 'Muestras seriadas frecuentes',
    que: 'Varias extracciones por persona, lo bastante seguidas como para fechar cuándo cambia cada marcador.',
    donde: 'La cohorte de estudio: número, espaciado y duración de las extracciones.',
    via: 'cohorte',
  },
  {
    id: 'amiloide',
    nombre: 'Estado amiloide de cada persona',
    que: 'Si cada participante tiene amiloide cerebral, medido por PET o en líquido cefalorraquídeo, con fecha y método, y sin usar los marcadores que se estudian.',
    donde: 'La cohorte de estudio (en ADNI, PET amiloide y líquido cefalorraquídeo).',
    via: 'cohorte',
  },
  {
    id: 'covariables',
    nombre: 'Covariables para ajustar',
    que: 'Peso, función renal, volumen plasmático, edad y sexo medidos junto a cada muestra, para separar un efecto real de lo que solo lo imita.',
    donde: 'La cohorte o el ensayo, junto a cada extracción.',
    via: 'cohorte',
  },
  {
    id: 'estimable',
    nombre: 'Que el análisis se pueda estimar',
    que: 'Que el diseño permita estimar lo que se pide (una brecha entre dos fechas que no se observan exactas, un modelo con varios estados) sin supuestos que no se puedan comprobar.',
    donde: 'No hace falta pedir nada: se prueba con datos sintéticos antes de tocar los reales (el ensayo en seco de ROSA2018).',
    via: 'analisis',
  },
  {
    id: 'investigar',
    nombre: 'Biología sin medir',
    que: 'Lo que la hipótesis da por hecho y nadie ha medido todavía: qué refleja de verdad un marcador, si un fármaco llega al cerebro, si un efecto depende de la dosis.',
    donde: 'Un estudio nuevo o una revisión dirigida. No se resuelve pidiendo un conjunto de datos.',
    via: 'investigacion',
  },
];

const POR_ID = new Map(INGREDIENTES.map((i) => [i.id, i]));

export function ingrediente(id: IdIngrediente): Ingrediente {
  return POR_ID.get(id)!;
}

/** Las reglas, en orden: gana la primera que casa. Se aplican al texto sin
 *  tildes (ver `plano`) y sin distinguir mayúsculas.
 *
 *  El orden es parte de la regla y cada salto tiene un porqué:
 *  - el tamaño del subgrupo va primero, porque esos supuestos nombran también
 *    el plasma seriado y el estado amiloide, que son condiciones del subgrupo;
 *  - el intervalo de referencia va antes que la fiabilidad de la medida,
 *    porque los que piden un umbral nombran la plataforma para decir con qué
 *    ensayo se calcula;
 *  - cuatro frases estadísticas que no admiten otra lectura ("precisión
 *    estadística", "artefacto de escala", "intervalo común", "al menos el
 *    80 %") van antes que los umbrales y los ensayos que nombran de paso;
 *  - lo publicado por las cohortes va antes que la medida y que el estado
 *    amiloide: "se publican métricas de calibración" pide un artículo, no
 *    calibrar un ensayo;
 *  - "refleja", "causal" e "indexa" van antes que los ensayos: "una reducción
 *    bajo tratamiento refleja una respuesta bioquímica" pregunta qué mide el
 *    marcador, no qué publicó un ensayo.
 *
 *  La lección de la primera medición (154 de 164): una palabra que el
 *  supuesto solo menciona ganaba a lo que pide. "Adicional a la del propio
 *  estado amiloide" no pide el estado amiloide, y "en ambos compartimentos"
 *  no pide armonizar nada. Por eso esas reglas exigen ahora la necesidad
 *  ("documentada", "determinarse"), no la palabra.
 *
 *  "Ensayo" en castellano es a la vez el clínico y el de laboratorio
 *  ("específico del ensayo", "ambos ensayos"), así que la regla de ensayos
 *  exige otra palabra de ensayo clínico al lado (placebo, aleatorizado, el
 *  nombre del ensayo, "los ensayos", "cada ensayo"). */
const REGLAS: [IdIngrediente, RegExp][] = [
  ['subcohorte', /\b(numero|tamano) suficiente\b/i],
  ['subcohorte', /\bsuficientes? (participantes|portadores|homocigotos)\b/i],
  ['subcohorte', /\bsuficientemente grande\b/i],
  ['subcohorte', /\bhay suficientes\b/i],
  ['subcohorte', /\bexisten? (en \w+ )?una subcohorte\b/i],

  ['estimable', /\bprecision estadistica\b/i],
  ['estimable', /\bartefacto de escala\b/i],
  ['estimable', /\bintervalo comun\b/i],
  ['estimable', /\bal menos el \d+ ?%/i],

  ['referencia', /(?<!cruce del? )\bumbral(es)?\b/i],
  ['referencia', /\blimites? (superior )?de referencia\b/i],
  ['referencia', /(?<!dentro del )\bintervalo de referencia\b/i],
  ['referencia', /\breferencia (independiente|externa|separada)\b/i],
  ['referencia', /\b(muestra|poblacion) de referencia\b/i],

  ['cohortes', /\bse publican\b/i],
  ['cohortes', /\besas publicaciones\b/i],
  ['cohortes', /\bestimacion publicada\b/i],
  ['cohortes', /\bcontrastes publicados\b/i],
  ['cohortes', /\bestudios citables\b/i],
  ['cohortes', /\bpagina exacta\b/i],

  ['covariables', /\bpeso corporal\b/i],
  ['covariables', /\bvolumen plasmatico\b/i],
  ['covariables', /\bfuncion renal\b/i],
  ['covariables', /\bajuste por edad\b/i],

  ['medida', /\bplataforma de medicion\b/i],
  ['medida', /\blotes?\b/i],
  ['medida', /\barmoniz\w*/i],
  ['medida', /\bcalibra\w*/i],
  ['medida', /\bpreanalitic\w*/i],
  ['medida', /\bvariabilidad (analitica|de medicion|biologica intra\w*)/i],
  ['medida', /\bvariacion analitica\b/i],
  ['medida', /\bprecision analitica\b/i],
  ['medida', /\bcoeficiente de variacion\b/i],
  ['medida', /\bconfirmacion de cruces?\b/i],
  ['medida', /\bcruces? falsos\b/i],
  ['medida', /\bdegradacion\b/i],
  ['medida', /\bmuestras (almacenadas|archivadas)\b/i],
  ['medida', /\bintercambiables\b/i],
  ['medida', /\binterfier\w*/i],
  ['medida', /\bespecie molecular\b/i],
  ['medida', /\brango dinamico\b/i],
  ['medida', /\breproducibilidad\b/i],

  ['amiloide', /\b(positividad|estado|clasificacion) amiloide\b.{0,40}\b(documentad|determina|recuperabl)\w*/i],

  ['seriado', /\bseriad\w*/i],
  ['seriado', /\bextracciones\b/i],
  ['seriado', /\bfrecuencia (de|y duracion)\b/i],
  ['seriado', /\bcadencia\b/i],
  ['seriado', /\bintervalo entre visitas\b/i],
  ['seriado', /\bespaciado\b/i],
  ['seriado', /\bpuntos temporales\b/i],
  ['seriado', /\b(muestreo|seguimiento|mediciones) longitudinal\w*/i],

  ['escalas', /\bescalas? (distintas|comun)\b/i],
  ['escalas', /\bescala\b.{0,60}\bcomparable\b/i],
  ['escalas', /\bsensibilidad al cambio\b/i],
  ['escalas', /\bhorizontes? de seguimiento\b/i],
  ['escalas', /\bcdr-?sb\b.{0,20}(frente a|u otra)/i],

  ['investigar', /\brefleja\b/i],
  ['investigar', /\bindexa\b/i],
  ['investigar', /\bcausal\w*/i],
  ['investigar', /\baproximacion (valida|suficientemente)/i],

  ['ensayos', /\baleatorizad\w*/i],
  ['ensayos', /\bplacebo\b/i],
  ['ensayos', /\btratamiento[- ]control\b/i],
  ['ensayos', /\b(evoke|posdinemab|invoke|lecanemab|donanemab|al002)\b/i],
  ['ensayos', /\b(los|esos|estos|cada|al menos (un|una|dos|tres|nueve)) (mismos )?ensayos?\b/i],
  ['ensayos', /\ben (los )?ensayos\b/i],
  ['ensayos', /\bde los ensayos\b/i],
  ['ensayos', /\bbajo (tratamiento|intervencion)\b/i],

  ['estimable', /\bidentificabl\w*/i],
  ['estimable', /\bestimable\b/i],
  ['estimable', /\bcensura\w*/i],
  ['estimable', /\bmultiestado\b/i],
  ['estimable', /\bsupuestos distribucionales\b/i],
  ['estimable', /\bmodelo de desenlace\b/i],
  ['estimable', /\binterpolacion\b/i],
  ['estimable', /\btrapezoidal\b/i],
  ['estimable', /\b(cociente de medias|media de cocientes)\b/i],
  ['estimable', /\bdefinicion (operativa|del hito)\b/i],
  ['estimable', /\btamano muestral\b/i],
  ['estimable', /\bvarianza\b/i],
  ['estimable', /\brobusto\b/i],

  ['investigar', /\bdosis\b/i],
  ['investigar', /\balcanza el sistema nervioso\b/i],
  ['investigar', /\bmecanism\w*/i],
  ['investigar', /\baporta informacion\b/i],
  ['investigar', /\bno redundante\b/i],
  ['investigar', /\bheterogeneidad\b/i],
  ['investigar', /\bsustrato\b/i],
  ['investigar', /\bacumulativ\w*/i],
  ['investigar', /\bmonoton\w*/i],
  ['investigar', /\bnivel individual\b/i],
  ['investigar', /\borigen central\b/i],
  ['investigar', /\bse conserva\b/i],
  ['investigar', /\bse mantiene\b/i],
  ['investigar', /\b(astrocit|astroglios)\w*/i],
  ['investigar', /\brespuestas? metabolicas?\b/i],
  ['investigar', /\ben humanos\b/i],
  ['investigar', /\bexplicad[ao]s? por\b/i],
  ['investigar', /\bsin modificar\b/i],
  ['investigar', /\beslabon\b/i],
  ['investigar', /\by no solo\b/i],
];

/** El texto sin tildes, con la misma longitud que el original en forma NFC:
 *  cada carácter se cambia por su letra base y nada más, así una posición en
 *  el texto plano es la misma posición en el original y la pantalla puede
 *  subrayar la frase exacta que hizo casar la regla. */
export function plano(texto: string): string {
  let salida = '';
  for (const c of texto.normalize('NFC')) {
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    salida += base.length === c.length ? base : c;
  }
  return salida;
}

export interface Clasificacion {
  ingrediente: IdIngrediente | null;
  /** La frase del supuesto, tal cual, que hizo casar la regla. */
  motivo: string | null;
  /** Dónde empieza esa frase en el texto en forma NFC. Se guarda la posición
   *  y no se vuelve a buscar la frase: la misma palabra puede salir antes en
   *  un sitio que la regla descartó ("cruce del umbral" y luego "umbral"). */
  posicion: number | null;
}

export function clasificar(texto: string): Clasificacion {
  const original = (texto ?? '').normalize('NFC');
  const llano = plano(original);
  for (const [id, regla] of REGLAS) {
    const m = regla.exec(llano);
    if (m) return { ingrediente: id, motivo: original.slice(m.index, m.index + m[0].length), posicion: m.index };
  }
  return { ingrediente: null, motivo: null, posicion: null };
}

export interface SupuestoFlojo {
  id: string;
  hipotesisId: string;
  texto: string;
  estado: 'sin_evidencia' | 'contradicho';
  ingrediente: IdIngrediente | null;
  motivo: string | null;
  posicion: number | null;
}

type Nodo = { id?: string; texto?: string; estado?: string; hijos?: Nodo[] };

/** Los supuestos sin evidencia o contradichos de la ficha, recorriendo el
 *  árbol entero. La misma poda que `supuestosDeLaFicha` en mecanismos.ts: un
 *  árbol roto o con un ciclo no cuelga la pantalla. */
export function supuestosFlojos(h: Hipotesis): SupuestoFlojo[] {
  const salida: SupuestoFlojo[] = [];
  const andar = (lista: Nodo[] | undefined, profundidad: number) => {
    if (!Array.isArray(lista) || profundidad > 12) return;
    for (const s of lista) {
      if (!s || typeof s !== 'object') continue;
      if ((s.estado === 'sin_evidencia' || s.estado === 'contradicho') && typeof s.texto === 'string') {
        const c = clasificar(s.texto);
        salida.push({ id: s.id ?? `${h.id}-${salida.length}`, hipotesisId: h.id, texto: s.texto.normalize('NFC'), estado: s.estado, ...c });
      }
      andar(s.hijos, profundidad + 1);
    }
  };
  andar((h as { supuestos?: Nodo[] }).supuestos, 0);
  return salida;
}

/** Viva es la que sigue en juego: ni descartada ni fundida en otra. */
export function esViva(h: Hipotesis): boolean {
  return h.estado !== 'descartada' && !h.fusionadaEn;
}

/** La regla de evaluación de supuestos vigente, la misma cifra que
 *  REGLA_SUPUESTOS en rosa/vigencia.py: 1 hasta el arranque del 18 de
 *  septiembre de 2026 a las 05:48 (el evaluador veía el principio de las
 *  afirmaciones de la corrida, no la evidencia propia de la hipótesis, y leía
 *  la ausencia como negación); 2 hasta el 23 de septiembre; 3 desde entonces
 *  (cada supuesto dice si las fuentes tocaron el tema, dónde se respondería y
 *  el límite de un nulo, y un nulo sin potencia ya no contradice). */
export const REGLA_SUPUESTOS = 3;

/** Qué le faltaba a cada regla anterior, en una frase para la pantalla. La
 *  regla que falte aquí cae en la frase genérica: nunca se nombra una fecha
 *  que no le corresponde. */
export const LO_QUE_FALTABA: Record<number, string> = {
  1: 'antes del 18 de septiembre, cuando el evaluador no miraba la evidencia propia de la hipótesis sino el principio de las afirmaciones de la corrida',
  2: 'antes del 23 de septiembre, cuando «sin evidencia» no decía si las fuentes habían tocado el tema, ni qué límite ponía un resultado nulo',
};

export type MotivoVigencia = 'sin_sello' | 'regla' | 'fallidos' | 'evidencia';

export interface Vigencia {
  /** Si el estado de los supuestos es el que saldría hoy. */
  alDia: boolean;
  motivo: MotivoVigencia | null;
  /** Afirmaciones llegadas después de evaluarlos. */
  nuevas: number;
  evaluadosEn: number | null;
  /** Reevaluación pedida y todavía no hecha. */
  pedidaEn: number | null;
  /** Por qué no se pudo hacer la última pedida (la corrida sin presupuesto). */
  noAtendida: string | null;
  /** Con qué regla se evaluaron; null si no consta. */
  regla: number | null;
}

function tieneSupuestos(h: Hipotesis): boolean {
  const lista = (h as { supuestos?: unknown }).supuestos;
  return Array.isArray(lista) && lista.some((s) => s && typeof s === 'object');
}

function nAfirmaciones(h: Hipotesis): number {
  const a = (h as { afirmaciones?: unknown }).afirmaciones;
  return Array.isArray(a) ? a.length : 0;
}

/** Si el estado de los supuestos de la hipótesis sigue siendo el que saldría
 *  hoy. Es `vigencia` de rosa/vigencia.py, uno a uno: sin sello, evaluados con
 *  una regla anterior, con supuestos que el modelo no pudo evaluar, o con
 *  afirmaciones llegadas después, no están al día. Sin supuestos, sí: no hay
 *  nada que reevaluar. */
export function vigencia(h: Hipotesis): Vigencia {
  const bruto = (h as { supuestosEvaluados?: unknown }).supuestosEvaluados;
  const s = bruto && typeof bruto === 'object' ? (bruto as Partial<SelloSupuestos>) : null;
  const extra = {
    evaluadosEn: typeof s?.en === 'number' ? s.en : null,
    pedidaEn: typeof s?.pedidaEn === 'number' && s.pedidaEn > 0 ? s.pedidaEn : null,
    noAtendida: typeof s?.noAtendida === 'string' && s.noAtendida ? s.noAtendida : null,
    regla: typeof s?.regla === 'number' && Number.isInteger(s.regla) ? s.regla : null,
  };
  if (!tieneSupuestos(h)) return { alDia: true, motivo: null, nuevas: 0, ...extra };
  if (!s || typeof s.en !== 'number') return { alDia: false, motivo: 'sin_sello', nuevas: 0, ...extra };
  if (typeof s.regla !== 'number' || !Number.isInteger(s.regla) || s.regla < REGLA_SUPUESTOS) return { alDia: false, motivo: 'regla', nuevas: 0, ...extra };
  if (typeof s.fallidos === 'number' && s.fallidos > 0) return { alDia: false, motivo: 'fallidos', nuevas: 0, ...extra };
  const nuevas = typeof s.afirmaciones === 'number' ? Math.max(0, nAfirmaciones(h) - s.afirmaciones) : 0;
  if (nuevas > 0) return { alDia: false, motivo: 'evidencia', nuevas, ...extra };
  return { alDia: true, motivo: null, nuevas: 0, ...extra };
}

/** Por qué no está al día, en una frase. */
export function vigenciaEnLlano(v: Vigencia): string {
  switch (v.motivo) {
    case 'regla':
      return `Sus supuestos se evaluaron ${v.regla !== null && LO_QUE_FALTABA[v.regla] ? LO_QUE_FALTABA[v.regla] : 'con una regla anterior a la de hoy'}.`;
    case 'evidencia':
      return `Le ${v.nuevas === 1 ? 'llegó 1 afirmación' : `llegaron ${v.nuevas} afirmaciones`} después de evaluar sus supuestos.`;
    case 'fallidos':
      return 'El modelo no pudo evaluar alguno de sus supuestos: eso es "no pude comprobar", no "no hay".';
    case 'sin_sello':
      return 'No consta cuándo se evaluaron sus supuestos.';
    default:
      return 'Sus supuestos están al día.';
  }
}

export interface FilaHipotesis {
  hipotesis: Hipotesis;
  /** Sin evidencia: lo que falta comprobar. */
  pendientes: SupuestoFlojo[];
  /** Contradichos: ya hay evidencia en contra y ningún ingrediente los arregla. */
  contradichos: SupuestoFlojo[];
  /** Los ingredientes que piden sus pendientes. */
  necesita: IdIngrediente[];
  /** Si el estado de sus supuestos es el que saldría hoy. */
  vigencia: Vigencia;
}

export interface FilaIngrediente {
  ingrediente: Ingrediente;
  /** Supuestos pendientes que dejaría comprobar. */
  supuestos: number;
  /** Hipótesis con al menos un supuesto pendiente que lo pide. */
  hipotesis: string[];
}

export interface Tablero {
  filas: FilaHipotesis[];
  /** De más a menos hipótesis tocadas; a igualdad, más supuestos. */
  ingredientes: FilaIngrediente[];
  pendientes: number;
  contradichos: number;
  sinClasificar: SupuestoFlojo[];
  /** Las filas con supuestos flojos que no están al día. */
  porReevaluar: FilaHipotesis[];
  /** Supuestos flojos (pendientes y contradichos) de esas filas. */
  flojosPorReevaluar: number;
}

export function tablero(hipotesis: Hipotesis[]): Tablero {
  const filas: FilaHipotesis[] = hipotesis.filter(esViva).map((h) => {
    const flojos = supuestosFlojos(h);
    const pendientes = flojos.filter((s) => s.estado === 'sin_evidencia');
    const necesita = INGREDIENTES.map((i) => i.id).filter((id) => pendientes.some((s) => s.ingrediente === id));
    return { hipotesis: h, pendientes, contradichos: flojos.filter((s) => s.estado === 'contradicho'), necesita, vigencia: vigencia(h) };
  });
  const porReevaluar = filas.filter((f) => !f.vigencia.alDia && f.pendientes.length + f.contradichos.length > 0);
  const ingredientes = INGREDIENTES.map((i) => ({
    ingrediente: i,
    supuestos: filas.reduce((n, f) => n + f.pendientes.filter((s) => s.ingrediente === i.id).length, 0),
    hipotesis: filas.filter((f) => f.necesita.includes(i.id)).map((f) => f.hipotesis.id),
  }))
    .filter((f) => f.supuestos > 0)
    .sort((a, b) => b.hipotesis.length - a.hipotesis.length || b.supuestos - a.supuestos);
  return {
    filas,
    ingredientes,
    pendientes: filas.reduce((n, f) => n + f.pendientes.length, 0),
    contradichos: filas.reduce((n, f) => n + f.contradichos.length, 0),
    sinClasificar: filas.flatMap((f) => f.pendientes.filter((s) => s.ingrediente === null)),
    porReevaluar,
    flojosPorReevaluar: porReevaluar.reduce((n, f) => n + f.pendientes.length + f.contradichos.length, 0),
  };
}

export interface Paso {
  ingrediente: IdIngrediente;
  /** Supuestos pendientes que se vuelven comprobables con este paso. */
  supuestos: number;
  /** Los comprobables acumulados hasta este paso, incluido. */
  acumulados: number;
  /** Hipótesis que en este paso quedan con todo lo pendiente comprobable. */
  libres: string[];
  /** Todas las que llevan todo comprobable hasta este paso, incluido. */
  libresAcumuladas: string[];
}

/** El orden en que conviene pedir, de uno en uno. En cada paso gana el
 *  ingrediente que deja más hipótesis con todo lo pendiente comprobable; a
 *  igualdad, el que más acerca a las que todavía pueden quedar así (cada una
 *  suma uno partido por lo que le falta, de modo que la que solo espera ese
 *  ingrediente cuenta entero y la que espera tres cuenta un tercio); y a
 *  igualdad de eso, el que más supuestos abre. Es un orden voraz: no promete
 *  el óptimo, promete que cada paso es el mejor dado lo que ya se tiene.
 *
 *  Sin el segundo criterio, con datos pequeños, el plan elegía por número de
 *  supuestos y tardaba seis pasos en liberar la única hipótesis liberable,
 *  porque ningún paso suelto la liberaba y los tres que le hacían falta
 *  abrían pocos supuestos cada uno.
 *
 *  La biología sin medir no entra: no se consigue pidiendo nada, y ponerla en
 *  el plan haría creer que un estudio nuevo es un trámite. Por eso una
 *  hipótesis que la necesita nunca queda libre en el plan, y la pantalla lo
 *  dice. Un supuesto sin clasificar tampoco la deja libre: no se sabe qué
 *  pide. */
export function plan(t: Tablero): Paso[] {
  const candidatos = t.ingredientes.filter((f) => f.ingrediente.via !== 'investigacion').map((f) => f.ingrediente.id);
  const pedible = new Set(candidatos);
  // Las que pueden quedar libres pidiendo: todo lo pendiente clasificado y pedible.
  const liberables = t.filas.filter((f) => f.pendientes.length > 0 && f.pendientes.every((s) => s.ingrediente !== null && pedible.has(s.ingrediente)));
  const tengo = new Set<IdIngrediente>();
  const libres = new Set<string>();
  const pasos: Paso[] = [];
  let acumulados = 0;
  while (true) {
    let mejor: { id: IdIngrediente; libres: string[]; progreso: number; supuestos: number } | null = null;
    for (const id of candidatos) {
      if (tengo.has(id)) continue;
      let progreso = 0;
      const nuevas: string[] = [];
      for (const f of liberables) {
        if (libres.has(f.hipotesis.id)) continue;
        const faltan = f.necesita.filter((n) => !tengo.has(n));
        if (!faltan.includes(id)) continue;
        progreso += 1 / faltan.length;
        if (faltan.length === 1) nuevas.push(f.hipotesis.id);
      }
      const supuestos = t.filas.reduce((n, f) => n + f.pendientes.filter((s) => s.ingrediente === id).length, 0);
      const gana =
        !mejor ||
        nuevas.length > mejor.libres.length ||
        (nuevas.length === mejor.libres.length && (progreso > mejor.progreso + 1e-9 || (Math.abs(progreso - mejor.progreso) <= 1e-9 && supuestos > mejor.supuestos)));
      if (gana) mejor = { id, libres: nuevas, progreso, supuestos };
    }
    if (!mejor || mejor.supuestos === 0) break;
    tengo.add(mejor.id);
    for (const id of mejor.libres) libres.add(id);
    acumulados += mejor.supuestos;
    pasos.push({ ingrediente: mejor.id, supuestos: mejor.supuestos, acumulados, libres: mejor.libres, libresAcumuladas: [...libres] });
  }
  return pasos;
}
