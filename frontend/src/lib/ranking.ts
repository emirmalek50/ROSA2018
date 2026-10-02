// Los componentes del ranking, expuestos uno a uno y sin sumarlos (informe de
// priorización de ROSA2018: "el ranking expone sus componentes"). ROSA2018 ya
// calcula cada pieza (certeza GRADE con su techo, dirección, cohortes,
// evidencia por relación, decisión del Killer, bloqueos, Bradley-Terry,
// novedad, paso de la ruta, conflictos, pendientes de revisar, fusiones);
// aquí solo se leen del estado y se ponen en una forma que la franja del
// ranking pueda pintar. Nada de puntuaciones combinadas: GRADE manda sobre la
// certeza y el torneo sobre el orden, y las dos cosas se ven por separado.
//
// Tolerante a registros antiguos: una hipótesis sin `conclusion`, sin
// `novedad`, sin `partidos` o con `procedencia` incompleta no rompe nada; cada
// componente ausente sale como null, cero o lista vacía, y el texto lo dice.
// Lo que no se pudo evaluar se dice como "no comprobado", nunca como "no hay".
// Sin React: lo prueba vitest en ranking.test.ts.

import type { Bloqueo, CertezaEvidencia, DecisionKiller, DireccionEvidencia, EstadoRosa, Hipotesis, PasoRutaTerapeutica } from '../datos/tipos';
import { CERTEZA_EVIDENCIA, VEREDICTO } from './etiquetas';
import { bloqueosDe, cohortesDe } from './priorizacion';
import { tr, trp } from './idioma';

/** La novedad de la hipótesis resumida a un estado: si nadie la propuso antes
 *  (nueva), si alguien ya la publicó (precedente), si hay algo parecido pero
 *  no igual (parcial) o si la comprobación no se hizo o la fuente no
 *  respondió (no comprobado). "No comprobado" nunca se convierte en "nueva". */
export type EstadoNovedad = 'no_comprobado' | 'nueva' | 'precedente' | 'parcial';

/** De dónde salieron los bloqueos: de la regla espejada aquí (`bloqueosDe`);
 *  de lo que guardó el servidor, si la regla no pudo evaluar el registro; o de
 *  ningún sitio ("no comprobado"), si la regla no pudo y el servidor tampoco
 *  guardó nada. Ese último caso no es "sin bloqueos": es que no se sabe. */
export type OrigenBloqueos = 'regla' | 'servidor' | 'no_comprobado';

export interface CertezaRanking {
  nivel: CertezaEvidencia;
  etiqueta: string;
  /** El techo por regla (rosa/certeza.py): el nivel máximo con lo que hay
   *  contado. `acotada` dice que el juez había dicho más y la regla lo bajó. */
  techo: { nivel: CertezaEvidencia; etiqueta: string; acotada: boolean; motivo: string } | null;
}

export interface ComponentesRanking {
  certeza: CertezaRanking | null;
  direccion: DireccionEvidencia | null;
  /** Cohortes distintas entre las fuentes, con su etiqueta canónica (ADNI,
   *  BioFINDER) o el nombre tal como lo dio la primera fuente si no está en el
   *  catálogo. Dos artículos de la misma cohorte son una. */
  cohortesDistintas: string[];
  /** De dónde salió la cuenta: del servidor (la misma que usó el techo GRADE)
   *  o de la regla espejada aquí porque el registro no la traía. */
  cohortesOrigen: 'servidor' | 'regla';
  /** Afirmaciones sostenidas o parciales que apoyan (de origen, directas o
   *  indirectas) y no están socavadas. Misma regla que rosa/certeza.py. */
  aFavor: number;
  /** Afirmaciones sostenidas o parciales que contradicen la hipótesis. */
  enContra: number;
  /** Afirmaciones que atacan el método o la inferencia de un apoyo. */
  socavan: number;
  /** Apoyos que hoy no cuentan porque alguien los socava. */
  socavadas: number;
  killer: DecisionKiller | null;
  /** El motivo de la última decisión del Killer tal como quedó en las revisiones
   *  ("suspender: Hace falta más o mejor evidencia..."); null si no consta. */
  killerMotivo: string | null;
  /** Razones en contra que el juez enumera en la conclusión. No son afirmaciones
   *  verificadas (esas van en enContra y socavan): atacan el paso inferencial o
   *  dicen lo que falta, y por eso se cuentan aparte. */
  razonesEnContra: number;
  bloqueos: Bloqueo[];
  bloqueosOrigen: OrigenBloqueos;
  candidata: boolean;
  bt: { fuerza: number; ic95: [number, number] } | null;
  partidos: number;
  novedad: { estado: EstadoNovedad; detalle: string };
  pasoRuta: PasoRutaTerapeutica | null;
  /** La ruta terapéutica evaluada por regla (rosa/ruta.py, h.ruta): pasos
   *  cubiertos de ocho, el paso que toca y si el declarado es coherente. Null
   *  si el bucle no la calculó todavía; entonces la franja enseña el declarado. */
  ruta: { cubiertos: number; siguiente: PasoRutaTerapeutica | null; coherente: boolean } | null;
  conflictoCon: { id: string; titulo: string }[];
  pendiente: boolean;
  pendienteDetalle: string | null;
  fusion: 'absorbe' | 'fusionada' | null;
  fusionCon: { id: string; titulo: string }[];
}

/** El estado que hace falta: solo la lista de hipótesis (para resolver
 *  títulos) y lo que la regla de bloqueos necesita. Todo opcional: un estado
 *  parcial o antiguo se completa con listas vacías. */
export type EstadoParaRanking = Partial<Pick<EstadoRosa, 'hipotesis' | 'investigaciones' | 'planesAnalisis' | 'ejecuciones' | 'artefactos' | 'corridas' | 'iteraciones'>>;

function lista<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

/** Solo las entradas que son objetos: una lista con un null o un número
 *  dentro (registro a medio escribir) no puede tumbar una regla que lee
 *  campos de cada entrada. */
function objetos<T>(x: unknown): T[] {
  return lista<T>(x).filter((y) => y !== null && typeof y === 'object');
}

/** Un valor como texto para enseñarlo: cadenas tal cual, números finitos
 *  convertidos, y nada más. Un objeto o una lista donde debía haber texto sale
 *  vacío, nunca "[object Object]". */
function texto(x: unknown): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

function clave(x: unknown): string {
  return texto(x).trim().toLowerCase();
}

/** Una copia de la hipótesis con las listas que las reglas recorren
 *  garantizadas como listas de objetos (registros antiguos o parciales). */
function segura(h: Hipotesis): Hipotesis {
  const procedencia = (h.procedencia && typeof h.procedencia === 'object' ? h.procedencia : {}) as Hipotesis['procedencia'];
  return {
    ...h,
    afirmaciones: objetos(h.afirmaciones),
    partidos: objetos(h.partidos),
    procedencia: { ...procedencia, fuentes: objetos(procedencia.fuentes) },
  };
}

/** Resuelve ids de hipótesis a su título, construyendo el índice una sola vez
 *  y solo si hace falta (la mayoría de las filas no tienen conflictos ni
 *  fusiones). Con ids repetidos en el estado gana el primero, siempre. */
function resolutorDeTitulos(estado: EstadoParaRanking): (id: string) => string {
  let indice: Map<string, string> | null = null;
  return (id) => {
    if (!indice) {
      indice = new Map();
      for (const x of objetos<Hipotesis>(estado.hipotesis)) {
        if (typeof x.id === 'string' && !indice.has(x.id)) indice.set(x.id, texto(x.titulo).trim());
      }
    }
    return indice.get(id) || id;
  };
}

/** Cuántas y cuáles afirmaciones cuentan a favor, en contra y socavando.
 *  Espejo de `_Vista` en rosa/certeza.py: solo cuentan las sostenidas o
 *  parciales (veredicto exacto, como allí) no sintéticas; una relación ausente
 *  o vacía es "de origen" (la que motivó el nacimiento) y cuenta como apoyo; un
 *  apoyo con `socavadaPor` no vacío deja de contar mientras lo esté.
 *  `socavadaPor` se acepta como lista o como una sola cadena. */
export function recuentoEvidencia(h: Pick<Hipotesis, 'afirmaciones'>): { aFavor: number; enContra: number; socavan: number; socavadas: number } {
  let aFavor = 0;
  let enContra = 0;
  let socavan = 0;
  let socavadas = 0;
  for (const a of objetos<Hipotesis['afirmaciones'][number]>(h.afirmaciones)) {
    if ((a.veredicto !== 'sostenida' && a.veredicto !== 'parcial') || a.sintetico) continue;
    const relacion = clave(a.relacion);
    const socavadores = a.socavadaPor;
    const socavada = Array.isArray(socavadores) ? socavadores.length > 0 : Boolean(socavadores);
    if (socavada) socavadas += 1;
    if ((relacion === '' || relacion === 'apoya' || relacion === 'apoya_indirecta') && !socavada) aFavor += 1;
    if (relacion === 'contradice') enContra += 1;
    if (relacion === 'socava') socavan += 1;
  }
  return { aFavor, enContra, socavan, socavadas };
}

/** La lista de cohortes que guardó el servidor, si la hay y es una lista de
 *  textos: primero la de la hipótesis (rosa/priorizacion.py al marcar
 *  candidatas), si no la de la conclusión (rosa/certeza.py al concluir) y,
 *  si no, la que el techo por regla contó al escribirse la conclusión
 *  (`conclusion.techo.cohortesDistintas`, que rosa/certeza.py `acotar` deja
 *  desde el 17 de septiembre de 2026 para que la conclusión recién escrita
 *  no espere al cierre de la iteración). */
function cohortesDelServidor(h: Pick<Hipotesis, 'cohortesDistintas' | 'conclusion'>): string[] | null {
  const conclusion = h.conclusion && typeof h.conclusion === 'object' ? h.conclusion : ({} as NonNullable<Hipotesis['conclusion']>);
  const techo = conclusion.techo && typeof conclusion.techo === 'object' ? (conclusion.techo as { cohortesDistintas?: unknown }) : {};
  for (const candidata of [h.cohortesDistintas, conclusion.cohortesDistintas, techo.cohortesDistintas]) {
    if (!Array.isArray(candidata)) continue;
    // Solo textos: un número o un nulo colado en la lista no es una cohorte.
    const limpias = candidata.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean);
    return [...new Set(limpias)];
  }
  return null;
}

/** Las cohortes distintas de la hipótesis: la cuenta del servidor cuando
 *  viene (es la misma que usó el techo GRADE, así el chip y el motivo del
 *  techo nunca se contradicen), y si no la regla espejada en `cohortesDe`
 *  (catálogo canónico de rosa/metodos.py) sobre las fuentes. */
export function cohortesConNombre(h: Pick<Hipotesis, 'procedencia'> & Partial<Pick<Hipotesis, 'cohortesDistintas' | 'conclusion'>>): string[] {
  return cohortesDelServidor(h) ?? cohortesPorRegla(h);
}

/** Solo la regla espejada, sobre fuentes que son objetos (un registro raro,
 *  con una fuente nula o una cohorte numérica, no puede tumbarla). */
export function cohortesPorRegla(h: Pick<Hipotesis, 'procedencia'>): string[] {
  const fuentes = objetos<Hipotesis['procedencia']['fuentes'][number]>(h.procedencia?.fuentes);
  try {
    return cohortesDe({ procedencia: { ...(h.procedencia ?? ({} as Hipotesis['procedencia'])), fuentes } });
  } catch {
    return [];
  }
}

/** El detalle de una comprobación que dice que no se hizo: "No comprobado
 *  todavía" (la plantilla), "no comprobado" o "No se pudo comprobar: ...". */
const NO_COMPROBADO = /^no\s+(se\s+pudo\s+)?comprob/i;

/** La novedad en un solo estado, leyendo la comprobación de precedente
 *  (rosa/fuentes). El estado por defecto de la plantilla parece una ausencia
 *  pero su detalle empieza por "No comprobado": ROSA2018 no afirma que algo es
 *  nuevo sin haber mirado. */
export function novedadDe(h: Pick<Hipotesis, 'novedad'>): { estado: EstadoNovedad; detalle: string } {
  const p = h.novedad?.precedente;
  if (!p || typeof p !== 'object') {
    return { estado: 'no_comprobado', detalle: tr('No se pudo comprobar la novedad: esta hipótesis no tiene la comprobación de precedente registrada.') };
  }
  const detalle = texto(p.detalle).trim();
  const estado = clave(p.estado);
  if (estado === 'no_comprobado' || NO_COMPROBADO.test(detalle)) return { estado: 'no_comprobado', detalle: detalle || tr('No se pudo comprobar la novedad.') };
  if (estado === 'sin_precedente') return { estado: 'nueva', detalle: detalle || tr('Nadie la propuso antes en la literatura buscada.') };
  if (estado === 'parcial') return { estado: 'parcial', detalle: detalle || tr('Hay trabajos parecidos, pero ninguno con esta formulación.') };
  if (estado === 'ya_publicado') return { estado: 'precedente', detalle: detalle || tr('Alguien ya la publicó.') };
  const nombre = texto(p.estado) || 'sin nombre';
  return { estado: 'no_comprobado', detalle: detalle ? trp("Estado de novedad que esta interfaz no conoce ({nombre}): {detalle}", { nombre, detalle }) : trp("Estado de novedad que esta interfaz no conoce ({nombre}).", { nombre }) };
}

function etiquetaCerteza(nivel: unknown): string {
  const k = clave(nivel);
  const tabla = CERTEZA_EVIDENCIA as Record<string, { etiqueta: string }>;
  // Object.hasOwn: "constructor" o "toString" como nivel no deben encontrar
  // nada en el prototipo.
  if (k && Object.hasOwn(tabla, k)) return tabla[k]!.etiqueta;
  return k ? `Certeza ${k.replace(/_/g, ' ')}` : tr('Certeza sin nivel');
}

function certezaDe(h: Pick<Hipotesis, 'conclusion'>): CertezaRanking | null {
  const c = h.conclusion;
  if (!c || typeof c !== 'object' || !clave(c.certeza)) return null;
  const nivel = clave(c.certeza) as CertezaEvidencia;
  const t = c.techo;
  const techo = t && typeof t === 'object' && clave(t.nivel) ? { nivel: clave(t.nivel) as CertezaEvidencia, etiqueta: etiquetaCerteza(t.nivel), acotada: Boolean(t.acotada), motivo: texto(t.motivo).trim() } : null;
  return { nivel, etiqueta: etiquetaCerteza(nivel), techo };
}

function btDe(h: Pick<Hipotesis, 'bt'>): { fuerza: number; ic95: [number, number] } | null {
  const bt = h.bt;
  if (!bt || typeof bt !== 'object' || !Number.isFinite(bt.fuerza)) return null;
  const ic = bt.ic95;
  if (!Array.isArray(ic) || ic.length !== 2 || !Number.isFinite(ic[0]) || !Number.isFinite(ic[1])) return null;
  return { fuerza: bt.fuerza, ic95: [ic[0], ic[1]] };
}

/** Lo que guardó el servidor como bloqueos, sin repetidos ni basura; origen
 *  "no comprobado" si no guardó nada (que no es lo mismo que sin bloqueos). */
function bloqueosDelServidor(h: Hipotesis): { bloqueos: Bloqueo[]; origen: OrigenBloqueos } {
  if (!Array.isArray(h.bloqueos)) return { bloqueos: [], origen: 'no_comprobado' };
  return { bloqueos: [...new Set(h.bloqueos.filter((b): b is Bloqueo => typeof b === 'string' && b.length > 0))], origen: 'servidor' };
}

/** Los bloqueos por la regla espejada (la misma que pinta la pantalla del
 *  ranking y la lista de candidatas). La regla canónica vive en el servidor
 *  (rosa/priorizacion.py): si una afirmación trae un veredicto que esta
 *  versión no conoce, la copia de aquí no puede pretender evaluarla y se usa
 *  lo que guardó el servidor, diciendo de dónde salió (la ficha y la cola, que
 *  llaman a `bloqueosDe` directamente, tratan ese veredicto como bloqueante:
 *  ninguna de las dos lecturas lo da por bueno). Si un registro raro hace
 *  fallar la regla, igual: servidor o "no comprobado". */
function bloqueosSeguros(estado: EstadoParaRanking, h: Hipotesis): { bloqueos: Bloqueo[]; origen: OrigenBloqueos } {
  if (objetos<{ veredicto?: unknown }>(h.afirmaciones).some((a) => typeof a.veredicto !== 'string' || !Object.hasOwn(VEREDICTO, a.veredicto))) return bloqueosDelServidor(h);
  try {
    const base = {
      investigaciones: objetos(estado.investigaciones),
      hipotesis: objetos(estado.hipotesis),
      planesAnalisis: objetos(estado.planesAnalisis),
      ejecuciones: objetos(estado.ejecuciones),
      artefactos: objetos(estado.artefactos),
      corridas: objetos(estado.corridas),
      iteraciones: objetos(estado.iteraciones),
    } as Parameters<typeof bloqueosDe>[0];
    return { bloqueos: bloqueosDe(base, h), origen: 'regla' };
  } catch {
    return bloqueosDelServidor(h);
  }
}

/** Cada componente del ranking leído del estado, sin sumar ni ponderar.
 *  Nunca lanza: una hipótesis de datos antiguos o incompleta sale con sus
 *  huecos como null, cero o lista vacía. */
export function componentesDe(estado: EstadoParaRanking, hipotesis: Hipotesis): ComponentesRanking {
  const est: EstadoParaRanking = estado && typeof estado === 'object' ? estado : {};
  const h = segura(hipotesis && typeof hipotesis === 'object' ? hipotesis : ({} as Hipotesis));
  const evidencia = recuentoEvidencia(h);
  const { bloqueos, origen } = bloqueosSeguros(est, h);
  const titulo = resolutorDeTitulos(est);
  const idsAjenos = (xs: unknown): string[] => [...new Set(lista<unknown>(xs).filter((id): id is string => typeof id === 'string' && id !== '' && id !== h.id))];
  const conflictoCon = idsAjenos(h.conflictoCon).map((id) => ({ id, titulo: titulo(id) }));
  const absorbe = idsAjenos(h.absorbe);
  const fusionadaEn = typeof h.fusionadaEn === 'string' && h.fusionadaEn !== '' && h.fusionadaEn !== h.id ? h.fusionadaEn : null;
  const fusion: ComponentesRanking['fusion'] = fusionadaEn ? 'fusionada' : absorbe.length > 0 ? 'absorbe' : null;
  const fusionCon = (fusionadaEn ? [fusionadaEn] : absorbe).map((id) => ({ id, titulo: titulo(id) }));
  // Pendiente es verdadero cuando el registro lo dice, con la misma prueba que
  // la regla de bloqueos (rosa/priorizacion.py: `if h.get("pendienteRevision")`),
  // para que el chip y el bloqueo dependencia_pendiente nunca se contradigan.
  const pendiente = h.pendienteRevision;
  const direccion = clave(h.conclusion?.direccion);
  const killer = clave(h.decisionKiller);
  const revisionesKiller = lista<{ accion?: unknown; nota?: unknown }>(h.revisiones).filter((r) => r && (r as { accion?: unknown }).accion === 'killer');
  const ultimaKiller = revisionesKiller[revisionesKiller.length - 1];
  const killerMotivo = ultimaKiller ? texto((ultimaKiller as { nota?: unknown }).nota).trim() || null : null;
  const razonesEnContra = lista(h.conclusion?.enContra).filter((x) => typeof x === 'string' && x.trim()).length;
  const pasoRuta = clave(h.tarjeta?.pasoRuta);
  const r = h.ruta;
  const ruta = r && typeof r === 'object' && Number.isFinite(Number(r.cubiertos)) ? { cubiertos: Math.max(0, Math.min(8, Math.round(Number(r.cubiertos)))), siguiente: typeof r.siguiente === 'string' && r.siguiente.trim() ? (r.siguiente as PasoRutaTerapeutica) : null, coherente: r.coherente !== false } : null;
  return {
    certeza: certezaDe(h),
    direccion: direccion ? (direccion as DireccionEvidencia) : null,
    cohortesDistintas: cohortesConNombre(h),
    cohortesOrigen: cohortesDelServidor(h) ? 'servidor' : 'regla',
    aFavor: evidencia.aFavor,
    enContra: evidencia.enContra,
    socavan: evidencia.socavan,
    socavadas: evidencia.socavadas,
    killer: killer ? (killer as DecisionKiller) : null,
    killerMotivo,
    razonesEnContra,
    bloqueos,
    bloqueosOrigen: origen,
    candidata: Boolean(h.candidata),
    bt: btDe(h),
    partidos: h.partidos.length,
    novedad: novedadDe(h),
    pasoRuta: pasoRuta ? (pasoRuta as PasoRutaTerapeutica) : null,
    ruta,
    conflictoCon,
    pendiente: Boolean(pendiente),
    pendienteDetalle: pendiente && typeof pendiente === 'object' ? texto(pendiente.detalle).trim() || null : null,
    fusion,
    fusionCon,
  };
}

function sinPuntoFinal(s: string): string {
  return s.trim().replace(/[.\s]+$/, '');
}

function minusculaInicial(s: string): string {
  const t = s.trim();
  // La puntuación de apertura ("¿", "¡", comillas, paréntesis) se salta: la
  // inicial que baja es la de la primera palabra.
  const apertura = /^[¿¡"'«(\[\s]*/.exec(t)?.[0] ?? '';
  const resto = t.slice(apertura.length);
  // Una sigla al principio (GFAP, PET, ADNI) se respeta; una palabra normal baja.
  if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9-]/.test(resto)) return t;
  return apertura + resto.charAt(0).toLowerCase() + resto.slice(1);
}

/** El texto del juez o de la regla encajado en una frase: sin el punto final
 *  (o los puntos suspensivos) que traía, con inicial en minúscula, y cerrado
 *  con punto salvo que ya termine en interrogación o exclamación. */
function encajada(s: string): string {
  const t = minusculaInicial(sinPuntoFinal(s));
  return /[?!]$/.test(t) ? t : `${t}.`;
}

/** Qué movería a esta hipótesis, en llano, a partir de lo que la conclusión
 *  ya dice por regla (el primer peldaño de la escalera) y por el juez (qué la
 *  subiría y qué la bajaría). Sin conclusión, lo dice: hasta que ROSA2018 cierre
 *  una iteración, el puesto lo fija solo el torneo. */
export function queCambiariaElOrden(h: Pick<Hipotesis, 'conclusion'>): string {
  const c = h.conclusion;
  if (!c || typeof c !== 'object' || !clave(c.certeza)) {
    return tr('ROSA2018 todavía no ha escrito una conclusión sobre esta hipótesis: hasta que cierre una iteración, su puesto lo fija solo el torneo (los partidos que gana y pierde contra sus rivales), no la evidencia reunida.');
  }
  const partes: string[] = [];
  const peldano = objetos<{ de?: string; a?: string; falta?: string }>(c.escalera)[0];
  const falta = texto(peldano?.falta).trim();
  if (peldano && falta) {
    // Un peldaño sin "de" (registro a medias) parte de la certeza actual.
    const de = etiquetaCerteza(clave(peldano.de) ? peldano.de : c.certeza).toLowerCase();
    const a = clave(peldano.a) ? etiquetaCerteza(peldano.a).toLowerCase() : tr('el siguiente nivel');
    partes.push(trp("Para pasar de {de} a {a} le falta: {falta}", { de, a, falta: encajada(falta) }));
  } else if (clave(c.certeza) === 'alta') {
    partes.push(tr('Está en certeza alta, el nivel más alto de GRADE: no hay peldaño por encima.'));
  } else {
    partes.push(trp("Está en {v} y esta conclusión no trae la escalera por regla (es anterior a que ROSA2018 la calculara): se rehará al cerrar la próxima iteración.", { v: etiquetaCerteza(c.certeza).toLowerCase() }));
  }
  const subiria = texto(c.subiria).trim();
  const bajaria = texto(c.bajaria).trim();
  if (subiria) partes.push(trp("Lo que la subiría, según el juez: {subiria}", { subiria: encajada(subiria) }));
  if (bajaria) partes.push(trp("Lo que la bajaría: {bajaria}", { bajaria: encajada(bajaria) }));
  return partes.join(' ');
}
