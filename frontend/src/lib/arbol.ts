// El árbol de la investigación como grafo: el objetivo es el tronco, las
// ramas son los clusters de mecanismo (y las áreas del programa), las hojas
// son las hipótesis, y alrededor lo que las sostiene: hechos del modelo de
// mundo, fuentes, entidades canónicas, relaciones causales, rivales del
// torneo y el experimento que llegó al laboratorio. Todo sale del estado; no
// se inventa ningún enlace. Aquí va el modelo (puro y probado); el dibujo
// está en pantallas/Arbol.tsx.
//
// Profundidad hasta el dato (16 de septiembre de 2026): además de la
// literatura, el árbol enseña la cadena que baja de cada hipótesis a una
// medición propia (afirmación con dato, análisis in silico, conjunto de datos,
// resultado del laboratorio) y calcula, para cada nodo, a cuántos saltos está
// de la MEDICIÓN PROPIA más cercana y de la fuente leída más cercana. Es lo
// que colorea el modo "Color por distancia al dato" de la pantalla.

import type { Afirmacion, Corrida, Ejecucion, EstadoRosa, Hipotesis, Investigacion, Iteracion } from '../datos/tipos';
import { rutaDe } from './ruta';
import { tr, traducido, trp } from './idioma';

export type TipoNodo = 'objetivo' | 'rama' | 'area' | 'hipotesis' | 'hecho' | 'pregunta' | 'fuente' | 'entidad' | 'experimento' | 'afirmacion' | 'ejecucion' | 'dataset' | 'laboratorio';
export type TipoEnlace = 'rama' | 'cita' | 'respalda' | 'entidad' | 'causal' | 'rival' | 'experimento' | 'dato';

export interface NodoArbol {
  id: string;
  tipo: TipoNodo;
  etiqueta: string;
  sub?: string;
  /** Tamaño relativo (el Elo en las hipótesis, el número de conexiones en lo demás). */
  peso: number;
  /** Primera iteración en la que existió: para ver crecer el árbol. */
  iteracion: number;
  href?: string;
  estado?: string;
  alerta?: string;
  alias?: string[];
  /** Saltos hasta la MEDICIÓN PROPIA más cercana por enlaces de evidencia; null si no hay camino. */
  profundidadDato?: number | null;
  /** Saltos hasta la fuente leída (texto completo o fragmento) más cercana; null si no hay camino. */
  profundidadLiteratura?: number | null;
  /** Por qué este nodo cuenta como medición propia; ausente si no lo es. */
  medicion?: string;
}

export interface EnlaceArbol {
  de: string;
  a: string;
  tipo: TipoEnlace;
  etiqueta?: string;
}

export interface Grafo {
  nodos: NodoArbol[];
  enlaces: EnlaceArbol[];
  vecinos: Map<string, Set<string>>;
  porId: Map<string, NodoArbol>;
  iteracionMax: number;
  /** Distancia de cada nodo a la MEDICIÓN PROPIA más cercana (ver `distancias`). */
  profundidadDato?: Map<string, number | null>;
  /** Distancia de cada nodo a la fuente leída más cercana. */
  profundidadLiteratura?: Map<string, number | null>;
}

export const NOMBRE_TIPO: Record<TipoNodo, string> = traducido({
  objetivo: 'Objetivo',
  rama: 'Cluster de mecanismo',
  area: 'Área del programa',
  hipotesis: 'Hipótesis',
  hecho: 'Hecho del modelo de mundo',
  pregunta: 'Pregunta abierta',
  fuente: 'Fuente',
  entidad: 'Entidad canónica',
  experimento: 'Experimento en el laboratorio',
  afirmacion: 'Afirmación con dato',
  ejecucion: 'Análisis in silico',
  dataset: 'Conjunto de datos',
  laboratorio: 'Resultado del laboratorio',
});

export const NOMBRE_ENLACE: Record<TipoEnlace, string> = traducido({
  rama: 'pertenece a',
  cita: 'cita',
  respalda: 'respalda',
  entidad: 'nombra',
  causal: 'relación causal',
  rival: 'rival en el torneo',
  experimento: 'se prueba en',
  dato: 'dato',
});

const VIVA = (h: Hipotesis) => h.estado !== 'descartada';

/** Enlaces por los que corre la evidencia. Los de estructura ('rama': tronco,
 *  áreas y clusters) y los del torneo ('rival') no cuentan: si contaran, todo
 *  nodo estaría a dos saltos de cualquier medición pasando por el tronco y la
 *  distancia no diría nada. Tampoco 'entidad' ni 'causal': nombrar el mismo
 *  gen no es compartir un dato. */
export const ENLACES_EVIDENCIA: ReadonlySet<TipoEnlace> = new Set<TipoEnlace>(['dato', 'cita', 'respalda', 'experimento']);

/** Nodos de estructura: no son evidencia, así que en el modo por distancia
 *  conservan el color de su tipo y el panel no les pone distancia. */
export const ESTRUCTURA: ReadonlySet<TipoNodo> = new Set<TipoNodo>(['objetivo', 'rama', 'area']);

/** Nodos sin distancia al dato: la estructura y las entidades canónicas. Una
 *  entidad solo se une por enlaces 'entidad' y 'causal', que no llevan
 *  evidencia, así que nunca tiene camino a una medición ni a una fuente; pintarla
 *  de "sin medición propia: solo literatura" sería falso (un gen no es
 *  literatura). La pantalla usa este conjunto para el color y para la frase. */
export const SIN_DISTANCIA: ReadonlySet<TipoNodo> = new Set<TipoNodo>([...ESTRUCTURA, 'entidad']);

/** La iteración de la investigación en marcha en el instante `t` (ms): la que
 *  lo contiene (empezó antes y no había terminado) o, en un hueco entre dos
 *  (esperando la aprobación de un plan), la última que había empezado. Con
 *  varias candidatas gana la que empezó más tarde, sea cual sea el orden de la
 *  lista, para que el resultado no dependa de cómo llegó el estado. undefined
 *  si no hay iteraciones fechadas antes de `t` (registro antiguo). */
type IteracionMinima = Pick<Iteracion, 'id' | 'corridaId' | 'numero' | 'empezadaEn' | 'terminadaEn'>;

/** La iteración que contiene el instante `t`; si cae entre dos (esperando la
 * aprobación de un plan), la anterior. `undefined` si no hay ninguna antes. */
export function iteracionObjEn<T extends Pick<Iteracion, 'numero' | 'empezadaEn' | 'terminadaEn'>>(iteraciones: readonly T[], t: number | null | undefined): T | undefined {
  if (typeof t !== 'number' || !Number.isFinite(t)) return undefined;
  let contiene: T | undefined;
  let previa: T | undefined;
  for (const it of iteraciones) {
    if (typeof it.empezadaEn !== 'number' || it.empezadaEn > t) continue;
    const abierta = it.terminadaEn == null || t <= it.terminadaEn;
    const mejor = abierta ? contiene : previa;
    if (!mejor || it.empezadaEn > mejor.empezadaEn || (it.empezadaEn === mejor.empezadaEn && it.numero > mejor.numero)) {
      if (abierta) contiene = it;
      else previa = it;
    }
  }
  return contiene ?? previa;
}

export function iteracionEn(iteraciones: readonly Pick<Iteracion, 'numero' | 'empezadaEn' | 'terminadaEn'>[], t: number | null | undefined): number | undefined {
  return iteracionObjEn(iteraciones, t)?.numero;
}

/** Numeración seguida de las iteraciones de una investigación (M-20 de la
 * revisión). El backend numera las iteraciones por corrida (1, 2, 3 y otra vez
 * 1 en la corrida siguiente), así que con trece corridas el deslizador "Cómo
 * creció" decía "iteración 4 de 4". Aquí cada iteración recibe un ordinal
 * acumulado: la corrida más antigua aporta sus números tal cual y cada corrida
 * siguiente empieza donde acabó la anterior (su desplazamiento es la suma de
 * los máximos previos). Con una sola corrida el ordinal coincide con el número,
 * así que los registros antiguos y los tests no cambian. */
export function ordinalesDeIteraciones(iteraciones: readonly IteracionMinima[], corridas: readonly Pick<Corrida, 'id' | 'empezadaEn'>[]): { deIteracion: Map<string, number>; deCorrida: Map<string, number>; total: number } {
  const porCorrida = new Map<string, IteracionMinima[]>();
  for (const it of iteraciones) {
    const lista = porCorrida.get(it.corridaId) ?? [];
    lista.push(it);
    porCorrida.set(it.corridaId, lista);
  }
  const inicioDe = (cid: string): number => {
    const c = corridas.find((x) => x.id === cid);
    if (c && typeof c.empezadaEn === 'number') return c.empezadaEn;
    return Math.min(...(porCorrida.get(cid) ?? []).map((i) => (typeof i.empezadaEn === 'number' ? i.empezadaEn : Number.POSITIVE_INFINITY)));
  };
  const orden = [...porCorrida.keys()].sort((a, b) => inicioDe(a) - inicioDe(b) || a.localeCompare(b));
  const deIteracion = new Map<string, number>();
  const deCorrida = new Map<string, number>();
  let desplazamiento = 0;
  for (const cid of orden) {
    deCorrida.set(cid, desplazamiento);
    const lista = porCorrida.get(cid) ?? [];
    for (const it of lista) deIteracion.set(it.id, desplazamiento + it.numero);
    desplazamiento += Math.max(0, ...lista.map((i) => i.numero));
  }
  return { deIteracion, deCorrida, total: desplazamiento };
}

const ESTADO_EJECUCION_LEGIBLE: Record<string, string> = traducido({ no_ejecutado: 'no ejecutado', en_curso: 'en curso', error_tecnico: 'error técnico', completado: 'completado', tiempo_agotado: 'tiempo agotado' });
const AUDITORIA_LEGIBLE: Record<string, string> = traducido({ valido: 'válido', no_valido: 'no válido', no_evaluable_computacionalmente: 'no evaluable' });
const VEREDICTO_LEGIBLE: Record<string, string> = traducido({ sostenida: 'sostenida', parcial: 'parcial', no_sostenida: 'no sostenida', cita_no_resuelve: 'la cita no resuelve', sin_cita: 'sin cita', ausencia_refutada: 'ausencia refutada', sin_verificar: 'sin verificar' });
const RESULTADO_LEGIBLE: Record<string, string> = { confirma: 'confirma', refuta: 'refuta', inconcluso: 'inconcluso', no_evaluable: 'no evaluable' };
const NO_SOSTENIDOS = new Set(['no_sostenida', 'cita_no_resuelve', 'sin_cita', 'ausencia_refutada']);

/** Un valor del servidor en castellano legible; uno desconocido (registro más
 *  nuevo que esta interfaz) se enseña tal cual, con espacios. */
const legible = (mapa: Record<string, string>, valor: string | null | undefined): string => (valor ? mapa[valor] ?? valor.replace(/_/g, ' ') : 'sin dato');

/** Recorta un texto a `maximo` caracteres, con puntos suspensivos. */
export function recortar(texto: string, maximo: number): string {
  const t = (texto ?? '').trim();
  return t.length > maximo ? `${t.slice(0, maximo - 3).trimEnd()}...` : t;
}

/* MEDICIÓN PROPIA: un nodo cuya cifra la produjo ROSA2018 o el laboratorio, no la
   literatura. Son tres casos, y solo tres:
   1. un nodo 'ejecucion' con estado 'completado' y auditoría 'valido' (el
      código corrió hasta el final y el Killer II dio el análisis por bueno);
   2. un nodo 'laboratorio' (el resultado del laboratorio sobre el prerregistro);
   3. un nodo 'afirmacion' con clase 'observacion_original' o 'derivado', no
      sintética y con veredicto 'sostenida' o 'parcial'.
   Una afirmación de tipo 'dato' sin clase (registros anteriores al libro de
   procedencia) se trata como literatura, que es el valor por defecto de hoy;
   un análisis en curso, con error técnico o con tiempo agotado no es una
   medición ("tiempo agotado" no es "sin efecto"). Cada función devuelve el
   motivo por el que cuenta, o null, para que el juicio se pueda explicar. */

export function medicionDeEjecucion(run: Pick<Ejecucion, 'estado' | 'auditoria'>): string | null {
  if (run.estado !== 'completado') return null;
  if (run.auditoria?.veredicto !== 'valido') return null;
  return tr('análisis in silico completado y auditado como válido');
}

export function medicionDeAfirmacion(a: Pick<Afirmacion, 'tipo' | 'clase' | 'sintetico' | 'veredicto'>): string | null {
  if (a.tipo !== 'dato') return null;
  if (a.clase !== 'observacion_original' && a.clase !== 'derivado') return null;
  if (a.sintetico) return null;
  if (a.veredicto !== 'sostenida' && a.veredicto !== 'parcial') return null;
  // Frase entera con huecos con nombre: al traducir cambia el orden.
  return trp('{clase} {veredicto} por el verificador', {
    clase: a.clase === 'derivado' ? tr('dato derivado') : tr('observación original'),
    veredicto: a.veredicto === 'parcial' ? tr('sostenida en parte') : tr('sostenida'),
  });
}

/** Por qué un análisis no cuenta o hay que mirarlo con cuidado. */
function alertaEjecucion(run: Pick<Ejecucion, 'estado' | 'auditoria'>): string | undefined {
  if (run.estado === 'tiempo_agotado') return tr('tiempo agotado: no es "sin efecto"');
  if (run.estado === 'error_tecnico') return tr('error técnico: no es "sin efecto"');
  if (run.auditoria?.veredicto === 'no_valido') return tr('el auditor no lo dio por válido');
  return undefined;
}

/** Distancia en saltos de cada nodo al origen más cercano, por enlaces de
 *  evidencia y sin dirección. Es una BFS desde todos los orígenes a la vez,
 *  que da el mismo resultado que una BFS desde cada nodo hasta el origen más
 *  cercano pero recorre el grafo una sola vez. Usa todo el grafo, no solo lo
 *  visible. null = sin camino. */
export function distancias(nodos: NodoArbol[], enlaces: EnlaceArbol[], origenes: ReadonlySet<string>): Map<string, number | null> {
  const vecinos = new Map<string, Set<string>>();
  for (const e of enlaces) {
    if (!ENLACES_EVIDENCIA.has(e.tipo)) continue;
    if (!vecinos.has(e.de)) vecinos.set(e.de, new Set());
    if (!vecinos.has(e.a)) vecinos.set(e.a, new Set());
    vecinos.get(e.de)!.add(e.a);
    vecinos.get(e.a)!.add(e.de);
  }
  const d = new Map<string, number | null>(nodos.map((n) => [n.id, null]));
  const cola: string[] = [];
  for (const id of origenes) {
    if (!d.has(id)) continue;
    d.set(id, 0);
    cola.push(id);
  }
  for (let i = 0; i < cola.length; i++) {
    const id = cola[i]!;
    const k = d.get(id)!;
    for (const v of vecinos.get(id) ?? []) {
      if (d.get(v) !== null) continue;
      d.set(v, k + 1);
      cola.push(v);
    }
  }
  return d;
}

/** La distancia al dato en una frase, para el panel de selección. */
export function fraseProfundidad(n: Pick<NodoArbol, 'profundidadDato' | 'profundidadLiteratura' | 'medicion'>): string {
  const d = n.profundidadDato ?? null;
  const l = n.profundidadLiteratura ?? null;
  if (d === 0) return n.medicion ? trp('Es una medición propia: {q}.', { q: n.medicion }) : tr('Es una medición propia.');
  if (d !== null) return trp(d === 1 ? 'A {n} salto de una medición propia.' : 'A {n} saltos de una medición propia.', { n: d });
  if (l === 0) return tr('Sin medición propia detrás; es una fuente leída.');
  if (l !== null) return trp(l === 1 ? 'Sin medición propia detrás; literatura a {n} salto.' : 'Sin medición propia detrás; literatura a {n} saltos.', { n: l });
  return tr('Sin medición propia detrás ni fuente leída que la sostenga.');
}

/** Peso de una hipótesis (de él sale el tamaño de su círculo): cuanto mejor la
 *  considera ROSA2018, más grande. Manda la certeza GRADE de su conclusión (muy
 *  baja 1, baja 1,8, moderada 2,6, alta 3,4); dentro del mismo nivel, la fuerza
 *  en el torneo mueve hasta 0,3 arriba o abajo (Elo 1500 es neutro, 1800 el
 *  tope), menos que el salto entre niveles, así la certeza manda siempre; ser
 *  candidata al laboratorio suma 0,15; una descartada baja al mínimo.
 *  Petición del director del proyecto, 17 de septiembre de 2026: que en el
 *  árbol se vea a simple vista qué hipótesis van mejor. */
export const PESO_POR_CERTEZA: Record<string, number> = { muy_baja: 1, baja: 1.8, moderada: 2.6, alta: 3.4 };
export function pesoHipotesis(h: Pick<Hipotesis, 'conclusion' | 'candidata' | 'estado'>, elo: number): number {
  if (h.estado === 'descartada') return 0.8;
  const certeza = h.conclusion?.certeza;
  const base = (typeof certeza === 'string' && PESO_POR_CERTEZA[certeza]) || 1;
  const torneo = Math.max(-0.3, Math.min(0.3, ((Number.isFinite(elo) ? elo : 1500) - 1500) / 300 * 0.3));
  return Math.round((base + torneo + (h.candidata ? 0.15 : 0)) * 100) / 100;
}

export function construirArbol(estado: EstadoRosa, inv: Investigacion): Grafo {
  const nodos: NodoArbol[] = [];
  const enlaces: EnlaceArbol[] = [];
  const vistos = new Set<string>();
  const enlacesVistos = new Set<string>();
  const porId = new Map<string, NodoArbol>();
  const anadir = (n: NodoArbol) => {
    if (vistos.has(n.id)) return;
    vistos.add(n.id);
    porId.set(n.id, n);
    nodos.push(n);
  };
  const enlazar = (de: string, a: string, tipo: TipoEnlace, etiqueta?: string) => {
    if (de === a || !vistos.has(de) || !vistos.has(a)) return;
    const clave = [de, a, tipo].join('|');
    const inversa = [a, de, tipo].join('|');
    if (enlacesVistos.has(clave) || (tipo === 'rival' && enlacesVistos.has(inversa))) return;
    enlacesVistos.add(clave);
    enlaces.push({ de, a, tipo, etiqueta });
  };

  // Un registro antiguo puede no traer alguna de estas listas: se tratan como
  // vacías, nunca rompen (regla del traspaso: la clave ausente vale lo de hoy).
  const hip = (estado.hipotesis ?? []).filter((h) => h.investigacionId === inv.id);
  const hechos = (estado.hechos ?? []).filter((h) => h.investigacionId === inv.id);
  const corridasInv = new Set((estado.corridas ?? []).filter((c) => c.investigacionId === inv.id).map((c) => c.id));
  const iteracionesInv = (estado.iteraciones ?? []).filter((i) => corridasInv.has(i.corridaId));
  const corridasDeInv = (estado.corridas ?? []).filter((c) => c.investigacionId === inv.id);
  // Numeración seguida de las iteraciones (ver ordinalesDeIteraciones): todo lo
  // que abajo se fecha en una iteración usa el ordinal, nunca el número por corrida.
  const ordinales = ordinalesDeIteraciones(iteracionesInv, corridasDeInv);
  const ordinalEn = (t: number | null | undefined): number | undefined => {
    const it = iteracionObjEn(iteracionesInv, t);
    return it ? ordinales.deIteracion.get(it.id) : undefined;
  };
  // La hipótesis guarda su iteración por corrida; la corrida en la que nació
  // (por fecha) da el desplazamiento. Si no cae en ninguna, la iteración que
  // contenía ese instante; y sin fechas, el número tal cual.
  const ordinalHip = (h: Hipotesis): number => {
    const t = typeof h.creadaEn === 'number' ? h.creadaEn : undefined;
    const corrida = t == null ? undefined : corridasDeInv.find((c) => typeof c.empezadaEn === 'number' && c.empezadaEn <= t && (c.terminadaEn == null || t <= c.terminadaEn));
    const desplazamiento = corrida ? ordinales.deCorrida.get(corrida.id) : undefined;
    if (desplazamiento != null) return desplazamiento + h.iteracion;
    return ordinalEn(t) ?? h.iteracion;
  };
  const ordinalHipDe = new Map(hip.map((h) => [h.id, ordinalHip(h)] as const));
  const ordinalDe = (h: Hipotesis): number => ordinalHipDe.get(h.id) ?? h.iteracion;
  const desplazamientoDe = (h: Hipotesis): number => ordinalDe(h) - h.iteracion;
  const iteracionMax = Math.max(1, ordinales.total, ...hip.map((h) => h.iteracion), ...ordinalHipDe.values());

  anadir({ id: 'objetivo', tipo: 'objetivo', etiqueta: inv.titulo, sub: inv.objetivo, peso: 4, iteracion: 0, href: rutaDe(inv.id, 'investigacion') });
  for (const a of inv.mision?.areas ?? []) {
    anadir({ id: `area-${a.id}`, tipo: 'area', etiqueta: a.titulo, sub: a.familiaMecanismo, peso: 2, iteracion: 0, estado: a.estado, href: rutaDe(inv.id, 'investigacion') });
    enlazar('objetivo', `area-${a.id}`, 'rama');
  }
  // Una rama solo cuando agrupa dos o más hipótesis: un cluster con una sola
  // hipótesis no aporta nada como nodo y llenaba el árbol de círculos con
  // texto pegado. Esas hipótesis cuelgan directamente del tronco.
  const clusters = [...new Set(hip.map((h) => h.cluster || 'Sin cluster'))];
  const conRama = new Set<string>();
  for (const c of clusters) {
    const n = hip.filter((h) => (h.cluster || 'Sin cluster') === c);
    if (n.length < 2) continue;
    conRama.add(c);
    anadir({ id: `rama-${c}`, tipo: 'rama', etiqueta: c, sub: `${n.length} hipótesis`, peso: 2 + Math.min(3, n.length) * 0.4, iteracion: Math.min(...n.map((h) => ordinalDe(h))), href: rutaDe(inv.id, 'ranking') });
    enlazar('objetivo', `rama-${c}`, 'rama');
    // Un área cuyo título o familia coincide con el cluster lo adopta.
    const area = (inv.mision?.areas ?? []).find((a) => a.titulo.toLowerCase() === c.toLowerCase() || a.familiaMecanismo.toLowerCase() === c.toLowerCase());
    if (area) enlazar(`area-${area.id}`, `rama-${c}`, 'rama');
  }
  for (const h of hip) {
    const bloqueos = h.bloqueos ?? [];
    const alerta = h.estado === 'descartada' ? 'descartada' : h.decisionKiller === 'descartar_en_contexto' ? 'el Killer propone descartar' : bloqueos.length ? `${bloqueos.length} ${bloqueos.length === 1 ? 'bloqueo' : 'bloqueos'}` : undefined;
    // Sin Elo (registro anterior al torneo) vale el de salida, 1500: un peso NaN
    // dejaría el círculo sin radio y la disposición por fuerzas sin posición.
    const elo = typeof h.elo === 'number' && Number.isFinite(h.elo) ? h.elo : 1500;
    anadir({ id: h.id, tipo: 'hipotesis', etiqueta: h.titulo ?? h.id, sub: `${h.cluster || 'Sin cluster'} · Elo ${elo}${h.candidata ? ' · candidata' : ''}`, peso: pesoHipotesis(h, elo), iteracion: ordinalDe(h), href: rutaDe(inv.id, 'hipotesis', h.id), estado: h.estado, alerta });
    enlazar(conRama.has(h.cluster || 'Sin cluster') ? `rama-${h.cluster || 'Sin cluster'}` : 'objetivo', h.id, 'rama');
    if (h.experimento && h.experimento.estado !== 'propuesto') {
      anadir({ id: `ex-${h.id}`, tipo: 'experimento', etiqueta: h.experimento.laboratorio ? `Experimento en ${h.experimento.laboratorio}` : 'Experimento', sub: h.experimento.estado.replace('_', ' ') + (h.experimento.prerregistradoEn ? ' · prerregistrado' : ''), peso: 2, iteracion: ordinalDe(h), href: rutaDe(inv.id, 'hipotesis', h.id), estado: h.experimento.estado });
      enlazar(h.id, `ex-${h.id}`, 'experimento');
    }
  }
  // Entidades canónicas: un nodo por identificador, con sus alias.
  const entidad = (x: { id: string; etiqueta: string; ontologia: string; tipo: string; alias: string[] }, iteracion: number) => {
    const id = `ent-${x.id}`;
    if (!vistos.has(id)) anadir({ id, tipo: 'entidad', etiqueta: x.etiqueta, sub: `${x.ontologia} ${x.id} · ${x.tipo}`, peso: 1, iteracion, alias: [x.id, ...(x.alias ?? [])] });
    else {
      const n = porId.get(id)!;
      n.iteracion = Math.min(n.iteracion, iteracion);
    }
    return id;
  };
  for (const h of hip) for (const x of h.entidades ?? []) enlazar(h.id, entidad(x, ordinalDe(h)), 'entidad');
  // Hechos y preguntas del modelo de mundo, unidos a las hipótesis que comparten fuente o entidad.
  const fuentesDe = new Map(hip.map((h) => [h.id, new Set((h.procedencia?.fuentes ?? []).map((f) => f.id))]));
  for (const he of hechos) {
    const tipo: TipoNodo = he.tipo === 'pregunta' || he.estado === 'abierto' ? 'pregunta' : 'hecho';
    const relacionadas = hip.filter((h) => he.id === `he-${h.id}` || (he.procedencia ?? []).some((p) => fuentesDe.get(h.id)?.has(p.fuenteId)));
    const nacido = he as { historial?: { fecha?: number }[]; actualizadoEn?: number };
    const iteracion = ordinalEn(nacido.historial?.[0]?.fecha ?? nacido.actualizadoEn) ?? (relacionadas.length ? Math.min(...relacionadas.map((h) => ordinalDe(h))) : iteracionMax);
    anadir({ id: `he-${he.id}`, tipo, etiqueta: he.enunciado.length > 90 ? `${he.enunciado.slice(0, 87)}...` : he.enunciado, sub: `${he.tema} · ${he.estado}`, peso: 1 + Math.min(2, relacionadas.length * 0.3), iteracion, href: rutaDe(inv.id, 'mundo'), estado: he.estado });
    for (const h of relacionadas) enlazar(`he-${he.id}`, h.id, 'respalda');
    for (const x of he.entidades ?? []) enlazar(`he-${he.id}`, entidad(x, iteracion), 'entidad');
  }
  // Fuentes: un nodo por artículo, citado por las hipótesis (y respaldando hechos).
  // Una fuente está leída si se leyó el texto completo o hay un fragmento: es
  // el origen de la profundidad de literatura.
  const fuentesLeidas = new Set<string>();
  for (const h of hip) {
    for (const f of h.procedencia?.fuentes ?? []) {
      const id = `fu-${f.id}`;
      if (!vistos.has(id)) anadir({ id, tipo: 'fuente', etiqueta: f.referencia, sub: f.titulo, peso: 1, iteracion: ordinalDe(h), alerta: f.retraccion ? `marca editorial: ${f.retraccion}` : undefined, estado: f.retraccion ?? undefined });
      if (f.textoCompleto || (f.fragmento ?? '').trim()) fuentesLeidas.add(id);
      enlazar(h.id, id, 'cita');
    }
  }
  for (const he of hechos) for (const p of he.procedencia ?? []) if (vistos.has(`fu-${p.fuenteId}`)) enlazar(`fu-${p.fuenteId}`, `he-${he.id}`, 'respalda');
  // Relaciones causales de cada hipótesis, entre entidades canónicas.
  for (const h of hip) {
    const g = h.grafoCausal;
    if (!g) continue;
    const canon = new Map(g.nodos.map((n) => [n.id, (n as { idCanonico?: string }).idCanonico]));
    for (const a of g.aristas) {
      const de = canon.get(a.de);
      const hasta = canon.get(a.a);
      if (de && hasta && vistos.has(`ent-${de}`) && vistos.has(`ent-${hasta}`)) enlazar(`ent-${de}`, `ent-${hasta}`, 'causal', a.tipo.replace(/_/g, ' '));
    }
  }
  // Rivales del torneo.
  for (const h of hip) for (const p of h.partidos ?? []) if (vistos.has(p.rivalId)) enlazar(h.id, p.rivalId, 'rival', p.resultado);
  // Profundidad hasta el dato: lo que baja de cada hipótesis hacia una medición
  // propia. Afirmaciones de tipo 'dato' (compartidas entre hipótesis por su
  // afirmacionId), análisis in silico, el conjunto de datos de su plan y el
  // resultado del laboratorio. Ningún enlace se inventa: cada uno sale de un
  // campo del estado. Los registros antiguos sin `ejecuciones` ni
  // `planesAnalisis` se tratan como vacíos.
  // Índices por id para que el coste sea lineal en hipótesis, ejecuciones y
  // planes (un bucle de ejecuciones dentro del de hipótesis era cuadrático).
  const ejecuciones = estado.ejecuciones ?? [];
  const planes = new Map((estado.planesAnalisis ?? []).map((p) => [p.id, p]));
  const datasets = new Map((inv.datasets ?? []).map((d) => [d.id, d]));
  const ejecucionPorId = new Map<string, Ejecucion>();
  const ejecucionesDe = new Map<string, Ejecucion[]>();
  for (const run of ejecuciones) {
    if (ejecucionPorId.has(run.id)) continue; // repetida en el estado: la primera manda
    ejecucionPorId.set(run.id, run);
    if (run.hipotesisId) (ejecucionesDe.get(run.hipotesisId) ?? ejecucionesDe.set(run.hipotesisId, []).get(run.hipotesisId)!).push(run);
  }
  // Las ejecuciones de una hipótesis: las que la nombran más las que ella lista, sin repetir.
  const ejecucionesDeHipotesis = (h: Hipotesis): Ejecucion[] => {
    const salida: Ejecucion[] = [];
    const vistas = new Set<string>();
    for (const run of [...(ejecucionesDe.get(h.id) ?? []), ...(h.ejecuciones ?? []).map((id) => ejecucionPorId.get(id))]) {
      if (!run || vistas.has(run.id)) continue;
      vistas.add(run.id);
      salida.push(run);
    }
    return salida;
  };
  // El nodo de una ejecución lleva su id, salvo que ese id ya sea de otro nodo
  // (una hipótesis con el mismo identificador): entonces va con prefijo, para
  // no pisar la hipótesis ni unir dos hipótesis con una arista 'dato' inventada.
  const nodoDeEjecucion = new Map<string, string>();
  const idNodoEjecucion = (run: Ejecucion): string => {
    let id = nodoDeEjecucion.get(run.id);
    if (!id) {
      id = vistos.has(run.id) && porId.get(run.id)!.tipo !== 'ejecucion' ? `ej-${run.id}` : run.id;
      nodoDeEjecucion.set(run.id, id);
    }
    return id;
  };
  // Cuándo corrió un análisis, para el deslizador de iteraciones: la iteración
  // en marcha en su instante de inicio, nunca antes de que naciera la hipótesis;
  // sin iteraciones fechadas (registro antiguo), la de la hipótesis.
  const iteracionDeEjecucion = (h: Hipotesis, run: Ejecucion | undefined): number => Math.max(ordinalDe(h), (run ? ordinalEn(run.inicio) : undefined) ?? ordinalDe(h));
  const idAfirmacion = (h: Hipotesis, a: Afirmacion, i: number) => `af-${a.afirmacionId || `${h.id}-${i}`}`;
  for (const h of hip) {
    (h.afirmaciones ?? []).forEach((a, i) => {
      if (a.tipo !== 'dato') return;
      const id = idAfirmacion(h, a, i);
      // Una afirmación derivada de un análisis no trae iteración propia: es la del análisis.
      const iteracion = a.iteracion != null ? desplazamientoDe(h) + a.iteracion : (a.trayectoria?.id ? iteracionDeEjecucion(h, ejecucionPorId.get(a.trayectoria.id)) : ordinalDe(h));
      if (!vistos.has(id)) {
        const medicion = medicionDeAfirmacion(a) ?? undefined;
        const alerta = a.sintetico ? 'dato sintético: no cuenta como observación' : NO_SOSTENIDOS.has(a.veredicto) ? 'el verificador no la sostiene' : undefined;
        anadir({ id, tipo: 'afirmacion', etiqueta: recortar(a.texto, 60), sub: `${medicion ? 'medición propia' : 'dato'} · ${legible(VEREDICTO_LEGIBLE, a.veredicto)}`, peso: medicion ? 1.4 : 1, iteracion, href: rutaDe(inv.id, 'hipotesis', h.id), estado: a.veredicto, alerta, medicion });
      } else {
        const n = porId.get(id)!;
        n.iteracion = Math.min(n.iteracion, iteracion);
      }
      enlazar(h.id, id, 'dato');
    });
    for (const run of ejecucionesDeHipotesis(h)) {
      const id = idNodoEjecucion(run);
      const iteracion = iteracionDeEjecucion(h, run);
      if (!vistos.has(id)) {
        const medicion = medicionDeEjecucion(run) ?? undefined;
        const auditoria = run.auditoria ? `auditoría: ${legible(AUDITORIA_LEGIBLE, run.auditoria.veredicto)}` : 'sin auditar';
        anadir({ id, tipo: 'ejecucion', etiqueta: 'Análisis in silico', sub: `${legible(ESTADO_EJECUCION_LEGIBLE, run.estado)} · ${auditoria}`, peso: medicion ? 1.8 : 1.4, iteracion, href: rutaDe(inv.id, 'hipotesis', h.id), estado: run.estado, alerta: alertaEjecucion(run), medicion });
      } else {
        const n = porId.get(id)!;
        n.iteracion = Math.min(n.iteracion, iteracion);
      }
      enlazar(h.id, id, 'dato');
      // El conjunto de datos del plan. Sin plan ('sin-plan') o sin conjunto no hay nodo: no se inventa.
      const plan = planes.get(run.planId);
      if (!plan?.datasetId) continue;
      const idDs = `ds-${plan.datasetId}`;
      if (!vistos.has(idDs)) {
        const ds = datasets.get(plan.datasetId);
        anadir({ id: idDs, tipo: 'dataset', etiqueta: ds?.nombre ?? plan.datasetId, sub: ds ? recortar(ds.descripcion, 60) : `identificador ${plan.datasetId}`, peso: 1.2, iteracion, href: rutaDe(inv.id, 'investigacion'), estado: ds?.estado });
      } else {
        const n = porId.get(idDs)!;
        n.iteracion = Math.min(n.iteracion, iteracion);
      }
      enlazar(id, idDs, 'dato');
    }
    if (h.experimento?.resultado) {
      const id = `lab-${h.id}`;
      const r = h.experimento.resultado;
      // El resultado llega fechado: aparece en la iteración en que llegó, como los análisis.
      const iteracion = Math.max(ordinalDe(h), ordinalEn(r.fecha) ?? ordinalDe(h));
      anadir({ id, tipo: 'laboratorio', etiqueta: 'Resultado del laboratorio', sub: `${legible(RESULTADO_LEGIBLE, r.veredicto)}${h.experimento.laboratorio ? ` · ${h.experimento.laboratorio}` : ''}`, peso: 2, iteracion, href: rutaDe(inv.id, 'hipotesis', h.id), estado: r.veredicto, medicion: 'resultado del laboratorio sobre el prerregistro' });
      enlazar(vistos.has(`ex-${h.id}`) ? `ex-${h.id}` : h.id, id, 'dato');
    }
  }
  // La afirmación con dato apunta a la ejecución que produjo su cifra (solo si
  // esa ejecución está dibujada: una trayectoria desconocida no crea nada).
  for (const h of hip) {
    (h.afirmaciones ?? []).forEach((a, i) => {
      if (a.tipo !== 'dato' || !a.trayectoria?.id) return;
      const nodoRun = nodoDeEjecucion.get(a.trayectoria.id);
      if (nodoRun) enlazar(idAfirmacion(h, a, i), nodoRun, 'dato');
    });
  }
  // Peso por conexiones para lo que no es hipótesis.
  const grado = new Map<string, number>();
  for (const e of enlaces) {
    grado.set(e.de, (grado.get(e.de) ?? 0) + 1);
    grado.set(e.a, (grado.get(e.a) ?? 0) + 1);
  }
  for (const n of nodos) if (n.tipo === 'entidad' || n.tipo === 'fuente') n.peso = 1 + Math.min(2.5, (grado.get(n.id) ?? 0) * 0.25);
  const vecinos = new Map<string, Set<string>>();
  for (const e of enlaces) {
    if (!vecinos.has(e.de)) vecinos.set(e.de, new Set());
    if (!vecinos.has(e.a)) vecinos.set(e.a, new Set());
    vecinos.get(e.de)!.add(e.a);
    vecinos.get(e.a)!.add(e.de);
  }
  // Profundidades: saltos por enlaces de evidencia hasta la MEDICIÓN PROPIA
  // más cercana y hasta la fuente leída más cercana, sobre todo el grafo.
  const profundidadDato = distancias(nodos, enlaces, new Set(nodos.filter((n) => n.medicion).map((n) => n.id)));
  const profundidadLiteratura = distancias(nodos, enlaces, fuentesLeidas);
  for (const n of nodos) {
    n.profundidadDato = profundidadDato.get(n.id) ?? null;
    n.profundidadLiteratura = profundidadLiteratura.get(n.id) ?? null;
  }
  return { nodos, enlaces, vecinos, porId, iteracionMax, profundidadDato, profundidadLiteratura };
}

/** Incorpora novedades sin volver a desplegar los nodos que la persona plegó. */
export function incorporarNovedades(g: Grafo, anteriores: Set<string>, visibles: Set<string>): Set<string> {
  const siguiente = new Set([...visibles].filter((id) => g.porId.has(id)));
  for (const n of g.nodos) {
    if (anteriores.has(n.id)) continue;
    siguiente.add(n.id);
    // Muestra el contexto inmediato para que la novedad no aparezca aislada.
    for (const vecino of g.vecinos.get(n.id) ?? []) siguiente.add(vecino);
  }
  return siguiente;
}

/** Al abrir: tronco, ramas, hipótesis vivas y experimentos. */
export function visiblesIniciales(g: Grafo, hip: Hipotesis[]): Set<string> {
  const v = new Set<string>();
  for (const n of g.nodos) {
    if (n.tipo === 'objetivo' || n.tipo === 'rama' || n.tipo === 'area' || n.tipo === 'experimento') v.add(n.id);
    if (n.tipo === 'hipotesis' && hip.some((h) => h.id === n.id && VIVA(h))) v.add(n.id);
  }
  return v;
}

/** Despliega los vecinos de un nodo (o los pliega si ya estaban todos). */
export function alternar(g: Grafo, visibles: Set<string>, id: string): Set<string> {
  const vecinos = [...(g.vecinos.get(id) ?? [])];
  const nuevo = new Set(visibles);
  const ocultos = vecinos.filter((v) => !nuevo.has(v));
  if (ocultos.length > 0) for (const v of ocultos) nuevo.add(v);
  else {
    // Plegar: quitar los vecinos que solo se sostienen por este nodo.
    for (const v of vecinos) {
      const n = g.porId.get(v);
      if (!n || n.tipo === 'objetivo' || n.tipo === 'rama' || n.tipo === 'area' || n.tipo === 'hipotesis') continue;
      const otros = [...(g.vecinos.get(v) ?? [])].filter((o) => o !== id && nuevo.has(o));
      if (otros.length === 0) nuevo.delete(v);
    }
  }
  return nuevo;
}

/** Nodos cuya etiqueta, subtítulo, alias o identificador contienen el texto. */
export function buscar(g: Grafo, texto: string): Set<string> {
  const q = texto.trim().toLowerCase();
  const r = new Set<string>();
  if (q.length < 2) return r;
  for (const n of g.nodos) {
    if (n.etiqueta.toLowerCase().includes(q) || (n.sub ?? '').toLowerCase().includes(q) || (n.alias ?? []).some((a) => a.toLowerCase() === q || a.toLowerCase().includes(q))) r.add(n.id);
  }
  return r;
}

/* ---------------------------------------------------------------------
   Disposición por fuerzas: repulsión entre todos, resorte por enlace, el
   tronco fijo en el centro y una gravedad suave. Determinista con la misma
   semilla; se para sola al enfriarse.
   --------------------------------------------------------------------- */

export interface Posicion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fijo?: boolean;
}

// Longitudes de reposo de los enlaces. Más largas que el ancho de una
// etiqueta media (unas 120 unidades) para que dos nodos unidos no se monten.
const LARGO: Record<TipoEnlace, number> = { rama: 230, cita: 110, respalda: 140, entidad: 130, causal: 170, rival: 240, experimento: 150, dato: 120 };

/** Anchura aproximada de la etiqueta de un nodo (en unidades del lienzo), para
 *  que las fuerzas dejen sitio al texto y no solo al círculo. */
export function anchoEtiqueta(n: NodoArbol): number {
  const chars = Math.min(n.etiqueta.length, 30);
  const tam = n.tipo === 'objetivo' ? 7 : n.tipo === 'rama' || n.tipo === 'hipotesis' || n.tipo === 'experimento' || n.tipo === 'laboratorio' ? 5.8 : 5;
  return chars * tam;
}

export function posicionInicial(g: Grafo, posiciones: Map<string, Posicion>, id: string, semilla: number): Posicion {
  // Nace junto a un vecino ya colocado (el árbol crece desde la rama), o en un anillo.
  const n = g.porId.get(id);
  if (n?.tipo === 'objetivo') return { x: 0, y: 0, vx: 0, vy: 0, fijo: true };
  const vecinos = [...(g.vecinos.get(id) ?? [])];
  const colocado = vecinos.find((v) => v !== 'objetivo' && posiciones.has(v));
  const vecino = colocado ? posiciones.get(colocado) : undefined;
  const ang = ((semilla * 137.508) % 360) * (Math.PI / 180);
  if (vecino) return { x: vecino.x + Math.cos(ang) * 28, y: vecino.y + Math.sin(ang) * 28, vx: 0, vy: 0 };
  // Cuelga del tronco (o no tiene vecino colocado): nace en un anillo, en el
  // ángulo dorado, para que las hojas no se apilen en el centro.
  if (vecinos.includes('objetivo')) {
    const r = n?.tipo === 'rama' || n?.tipo === 'area' ? 150 : 200;
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r, vx: 0, vy: 0 };
  }
  const r = n?.tipo === 'rama' || n?.tipo === 'area' ? 140 : 260;
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r, vx: 0, vy: 0 };
}

const VELOCIDAD_BASE = 2;
const VELOCIDAD_POR_ALFA = 28;

export function paso(g: Grafo, visibles: Set<string>, posiciones: Map<string, Posicion>, alfa: number): void {
  const ids = [...visibles].filter((id) => posiciones.has(id));
  // Repulsión.
  for (let i = 0; i < ids.length; i++) {
    const a = posiciones.get(ids[i]!)!;
    const pa = g.porId.get(ids[i]!)?.peso ?? 1;
    for (let j = i + 1; j < ids.length; j++) {
      const b = posiciones.get(ids[j]!)!;
      const pb = g.porId.get(ids[j]!)?.peso ?? 1;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        d2 = 1;
      }
      // La repulsión se satura por debajo de 12 unidades: dos nodos que caen
      // casi encima no salen disparados (con muchos nodos, un solo par así
      // bastaba para que todo el árbol temblara).
      // Entre dos nodos con etiqueta (hipótesis, ramas, hechos) la repulsión es
      // mayor: son los que tienen texto que leer.
      const na0 = g.porId.get(ids[i]!);
      const nb0 = g.porId.get(ids[j]!);
      const conTexto = na0 && nb0 && na0.tipo !== 'fuente' && nb0.tipo !== 'fuente' && na0.tipo !== 'entidad' && nb0.tipo !== 'entidad' ? 1.8 : 1;
      const f = (3400 * conTexto * (pa + pb) * 0.5 * alfa) / Math.max(d2, 144);
      const d = Math.sqrt(d2);
      let fx = (dx / d) * f;
      let fy = (dy / d) * f;
      // Colisión de etiquetas: si las cajas de texto (bajo cada círculo) se
      // solapan, se empujan aparte, más en horizontal que en vertical.
      const na = g.porId.get(ids[i]!);
      const nb = g.porId.get(ids[j]!);
      if (na && nb && na.tipo !== 'fuente' && nb.tipo !== 'fuente') {
        const sx = (anchoEtiqueta(na) + anchoEtiqueta(nb)) / 2 + 8;
        const sy = 30;
        const ox = sx - Math.abs(dx);
        const oy = sy - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          // El empuje por solape de etiquetas se acota: un solape de 150
          // unidades no puede convertirse en un salto de 50 por paso.
          const k = 0.35 * alfa;
          fx += Math.sign(dx || 1) * Math.min(ox, 24) * k;
          fy += Math.sign(dy || 1) * Math.min(oy, 24) * k * 0.6;
        }
      }
      if (!a.fijo) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.fijo) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }
  }
  // Resortes.
  for (const e of g.enlaces) {
    if (!visibles.has(e.de) || !visibles.has(e.a)) continue;
    const a = posiciones.get(e.de);
    const b = posiciones.get(e.a);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const f = ((d - LARGO[e.tipo]) / d) * 0.06 * alfa;
    if (!a.fijo) {
      a.vx += dx * f;
      a.vy += dy * f;
    }
    if (!b.fijo) {
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
  }
  // Separación de etiquetas por posición (restricción, no fuerza): si dos
  // cajas de texto se solapan, ambos nodos se desplazan una fracción del
  // solape por el eje donde el solape es menor. Actúa aunque la energía sea
  // casi cero, así que las etiquetas acaban legibles también en reposo, y al
  // ser un desplazamiento acotado no puede disparar el árbol.
  separarEtiquetas(g, ids, posiciones, alfa);
  // Gravedad y movimiento.
  for (const id of ids) {
    const p = posiciones.get(id)!;
    if (p.fijo) continue;
    p.vx -= p.x * 0.004 * alfa;
    p.vy -= p.y * 0.004 * alfa;
    p.vx *= 0.82;
    p.vy *= 0.82;
    // Tope de velocidad proporcional a la energía: al arrastrar (alfa 0,35)
    // nadie se mueve más de unas 12 unidades por paso; al asentarse, menos.
    const tope = VELOCIDAD_BASE + VELOCIDAD_POR_ALFA * alfa;
    const v = Math.hypot(p.vx, p.vy);
    if (v > tope) {
      p.vx *= tope / v;
      p.vy *= tope / v;
    }
    p.x += p.vx;
    p.y += p.vy;
  }
}

/** Caja de la etiqueta de un nodo en unidades del lienzo: centrada en x, del
 *  borde superior del círculo al final de la segunda línea de texto. */
export function cajaEtiqueta(n: NodoArbol, p: { x: number; y: number }): { x0: number; x1: number; y0: number; y1: number } {
  // Margen generoso: la etiqueta real puede ser algo más ancha que la
  // estimación y dos textos a un píxel de distancia siguen leyéndose mal.
  const w = Math.min(anchoEtiqueta(n), 180) + 26;
  return { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 18, y1: p.y + 42 };
}

const FRACCION_SEPARACION = 0.3;

function separarEtiquetas(g: Grafo, ids: string[], posiciones: Map<string, Posicion>, alfa: number): void {
  // Con el árbol caliente se separa deprisa; casi en reposo, despacio, para
  // que un árbol denso sin sitio para todas las etiquetas no tiemble.
  const fraccion = FRACCION_SEPARACION * Math.min(1, Math.max(0.25, alfa / 0.12));
  const conTexto = ids.filter((id) => g.porId.get(id)?.tipo !== 'fuente');
  for (let i = 0; i < conTexto.length; i++) {
    const na = g.porId.get(conTexto[i]!)!;
    const a = posiciones.get(conTexto[i]!)!;
    for (let j = i + 1; j < conTexto.length; j++) {
      const nb = g.porId.get(conTexto[j]!)!;
      const b = posiciones.get(conTexto[j]!)!;
      const ca = cajaEtiqueta(na, a);
      const cb = cajaEtiqueta(nb, b);
      const ox = Math.min(ca.x1, cb.x1) - Math.max(ca.x0, cb.x0);
      const oy = Math.min(ca.y1, cb.y1) - Math.max(ca.y0, cb.y0);
      if (ox <= 0 || oy <= 0) continue;
      const libres = (a.fijo ? 0 : 1) + (b.fijo ? 0 : 1);
      if (libres === 0) continue;
      // Por el eje de menor solape; en horizontal las etiquetas son anchas,
      // así que ante la duda se separan en vertical.
      const horizontal = ox < oy * 0.6;
      const paso = (horizontal ? ox : oy) * fraccion;
      const dir = horizontal ? Math.sign(a.x - b.x || 1) : Math.sign(a.y - b.y || 1);
      const cada = paso / libres;
      if (!a.fijo) {
        if (horizontal) a.x += dir * cada;
        else a.y += dir * cada;
      }
      if (!b.fijo) {
        if (horizontal) b.x -= dir * cada;
        else b.y -= dir * cada;
      }
    }
  }
}
