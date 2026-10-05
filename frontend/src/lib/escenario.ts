// Lo que enseña la corrida en vivo (diseño "Corrida en vivo · v1", 5 de
// octubre de 2026), sacado del registro y no escrito a mano: el paso en foco,
// cuánto lleva de su trabajo, a qué ritmo, el latido de su pista, quién está
// en escena, el recorrido de la iteración, lo que van encontrando las
// búsquedas y la corrida en el tiempo. Funciones puras: la pantalla solo
// pinta lo que sale de aquí.

import type { Corrida, EstadoRosa, Iteracion, PasoPlan, Pista, RolModelo } from '../datos/tipos';
import { formatearDuracion, formatearEntero } from './formato';
import { tr, trp } from './idioma';

/** El paso que la pantalla pone en grande: el que está en curso; si no hay
 *  ninguno (la corrida está en pausa), el primero que falta, que es donde se
 *  quedó; con todo hecho, el último. */
export function pasoFoco(it: Iteracion | null): PasoPlan | null {
  if (!it || it.plan.length === 0) return null;
  return it.plan.find((p) => p.estado === 'en_curso') ?? it.plan.find((p) => p.estado === 'pendiente') ?? it.plan[it.plan.length - 1]!;
}

/** La pista que trabaja (o trabajó) en un paso: la viva; si no, la detenida o
 *  la fallida, que es donde se cortó; si no, la última con transcripción. */
export function pistaFoco(it: Iteracion | null, paso: PasoPlan | null): Pista | null {
  if (!it || !paso) return null;
  const del = it.pistas.filter((p) => p.pasoId === paso.id);
  if (del.length === 0) return null;
  return del.find((p) => p.estado === 'en_curso') ?? [...del].reverse().find((p) => p.estado === 'detenida' || p.estado === 'fallida') ?? [...del].reverse().find((p) => p.transcripcion.length > 0) ?? del[del.length - 1]!;
}

const PROGRESO = /(\d[\d.]*)\s+de\s+(\d[\d.]*)/;
const numero = (s: string) => Number(s.replace(/\./g, ''));

/** Qué se cuenta en el contador grande según el tipo de pista. */
function unidadDe(tipo: string | undefined): string {
  if (tipo === 'verificacion') return tr('afirmaciones juzgadas');
  if (tipo === 'extraccion') return tr('fuentes leídas');
  return tr('pasos de la pista');
}

export interface Avance {
  hechos: number;
  total: number;
  unidad: string;
  /** Si lo que se cuenta son afirmaciones que pasan por el juez. */
  juzgadas: boolean;
  /** "10 cada 18 s": el último salto del contador y lo que tardó. */
  ritmo: string | null;
  /** "faltan 33, alrededor de 1 min", con el ritmo medio de la pista. */
  faltan: string | null;
  /** "6 min 55 s en este paso". */
  enPaso: string | null;
}

/** Cuánto lleva el paso en foco. Sale de la transcripción de su pista ("Juez:
 *  210 de 243", "Fuente 13 de 14"); sin transcripción que cuente, de las
 *  pistas del paso terminadas frente a las lanzadas. */
export function avanceDe(it: Iteracion | null, paso: PasoPlan | null): Avance | null {
  if (!it || !paso) return null;
  const pista = pistaFoco(it, paso);
  const enPaso = pista && pista.ms > 0 ? trp('{t} en este paso', { t: formatearDuracion(pista.ms) }) : null;
  const marcas = (pista?.transcripcion ?? [])
    .filter((e) => e.tipo === 'resultado')
    .map((e) => ({ t: e.t, m: PROGRESO.exec(e.texto) }))
    .filter((x): x is { t: number; m: RegExpExecArray } => x.m !== null)
    .map((x) => ({ t: x.t, n: numero(x.m[1]!), de: numero(x.m[2]!) }))
    .filter((x) => x.de > 0 && x.n <= x.de);
  if (marcas.length > 0) {
    const ult = marcas[marcas.length - 1]!;
    const delMismo = marcas.filter((x) => x.de === ult.de);
    const pen = delMismo.length > 1 ? delMismo[delMismo.length - 2]! : null;
    const salto = pen ? ult.n - pen.n : 0;
    const ritmo = pen && salto > 0 && ult.t > pen.t ? trp('{n} cada {t}', { n: formatearEntero(salto), t: formatearDuracion(ult.t - pen.t) }) : null;
    const pri = delMismo[0]!;
    const porUnidad = ult.n > pri.n && ult.t > pri.t ? (ult.t - pri.t) / (ult.n - pri.n) : null;
    const quedan = ult.de - ult.n;
    const faltan = quedan > 0
      ? porUnidad !== null
        ? trp('faltan {n}, alrededor de {t}', { n: formatearEntero(quedan), t: alrededor(quedan * porUnidad) })
        : trp('faltan {n}', { n: formatearEntero(quedan) })
      : null;
    return { hechos: ult.n, total: ult.de, unidad: unidadDe(pista?.tipo ?? paso.tipo), juzgadas: (pista?.tipo ?? paso.tipo) === 'verificacion', ritmo, faltan, enPaso };
  }
  const del = it.pistas.filter((p) => p.pasoId === paso.id);
  if (del.length === 0) return null;
  const hechas = del.filter((p) => p.estado === 'hecha').length;
  return { hechos: hechas, total: del.length, unidad: tr('pistas terminadas'), juzgadas: false, ritmo: null, faltan: del.length > hechas ? trp('faltan {n}', { n: del.length - hechas }) : null, enPaso };
}

/** Una duración redondeada para una estimación: "1 min", "12 min", "2 h". */
function alrededor(ms: number): string {
  if (ms < 60_000) return tr('menos de 1 min');
  if (ms < 3_600_000) return trp('{n} min', { n: Math.round(ms / 60_000) });
  return formatearDuracion(Math.round(ms / 600_000) * 600_000);
}

/** "6:55" o "1:02:10": el momento de una entrada desde que empezó su pista. */
export function marcaDeTiempo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** El reloj grande: "2:31:08". */
export function relojDe(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Las últimas entradas de la pista en foco, de la más nueva a la más vieja. */
export function latidoDe(pista: Pista | null, cuantas = 8): { marca: string; texto: string }[] {
  if (!pista) return [];
  return pista.transcripcion.slice(-cuantas).reverse().map((e) => ({ marca: marcaDeTiempo(e.t), texto: e.texto }));
}

/** Cuánto hace que empezó la corrida, en la unidad que se lee mejor. */
export function haceCuanto(desde: number, ahora: number): { cifra: string; unidad: string } {
  const ms = Math.max(0, ahora - desde);
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return { cifra: String(d), unidad: d === 1 ? tr('día') : tr('días') };
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return { cifra: String(h), unidad: 'h' };
  return { cifra: String(Math.max(1, Math.floor(ms / 60_000))), unidad: 'min' };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "el 22 de septiembre". */
export function fechaLarga(ms: number): string {
  const d = new Date(ms);
  return trp('el {dia} de {mes}', { dia: d.getDate(), mes: tr(MESES[d.getMonth()]!) });
}

export interface Actor {
  rol: RolModelo;
  nombre: string;
  activo: boolean;
  nota: string;
}

const ORDEN_ROLES: RolModelo[] = ['juez', 'cerebro', 'volumen', 'replica'];

/** El nombre corto con el que una pista nombra a su modelo: "Opus 5 (juez)"
 *  es Claude Opus 5; "GPT-6 Astra" es GPT-6 Astra. */
function nombraA(fuente: string, nombre: string): boolean {
  const corto = fuente.replace(/\(.*?\)/g, '').trim().toLowerCase();
  return corto.length > 2 && nombre.toLowerCase().includes(corto);
}

/** Quién está en escena: los modelos de la corrida, el de la pista en foco
 *  primero y encendido, y de cada uno lo último que hizo en la iteración. */
export function elencoDe(estado: Pick<EstadoRosa, 'saludModelos'>, it: Iteracion | null, foco: Pista | null, trabajando: boolean, nombreDe: (modelo: string) => string): Actor[] {
  const salud = estado.saludModelos ?? {};
  const actores = ORDEN_ROLES.filter((r) => salud[r]?.modelo).map((rol) => {
    const nombre = nombreDe(salud[rol]!.modelo);
    const activo = foco !== null && nombraA(foco.fuente, nombre);
    const suyas = (it?.pistas ?? []).filter((p) => nombraA(p.fuente, nombre) && p.resumen);
    const ultima = suyas[suyas.length - 1];
    const nota = activo
      ? trabajando ? (rol === 'juez' ? tr('juzgando ahora') : tr('trabajando ahora')) : tr('aquí se quedó')
      : rol === 'cerebro' && it?.planAprobado
        ? tr('escribió el plan de esta iteración')
        : ultima ? ultima.resumen : tr('sin trabajo en esta iteración');
    return { rol, nombre, activo, nota };
  });
  return actores.sort((a, b) => Number(b.activo) - Number(a.activo));
}

const RESULTADOS = /(\d[\d.]*)\s+resultados?,\s*(\d[\d.]*)\s+relevantes?,\s*(\d[\d.]*)\s+con texto completo/;

/** Lo que dice el recorrido debajo de cada paso. */
export function resultadoDePaso(it: Iteracion, paso: PasoPlan, foco: PasoPlan | null, avance: Avance | null): string {
  if (paso.estado === 'fallido') return paso.motivoFallo || tr('falló');
  if (paso.estado === 'omitido') return tr('omitido');
  if (paso.estado === 'sin_trabajo') return tr('sin trabajo');
  const pistas = it.pistas.filter((p) => p.pasoId === paso.id);
  if (foco && paso.id === foco.id && paso.estado !== 'hecho') {
    if (avance?.juzgadas) return trp('{a} de {b} juzgadas', { a: formatearEntero(avance.hechos), b: formatearEntero(avance.total) });
    if (avance) return trp('{a} de {b}', { a: formatearEntero(avance.hechos), b: formatearEntero(avance.total) });
    return paso.estado === 'en_curso' ? tr('en curso') : tr('aquí se quedó');
  }
  if (paso.estado === 'pendiente') return paso.presupuesto ? trp('{n} llamadas previstas', { n: formatearEntero(paso.presupuesto) }) : tr('por delante');
  const busquedas = pistas.filter((p) => RESULTADOS.test(p.resumen)).length;
  if (busquedas > 0) return busquedas === 1 ? tr('1 búsqueda') : trp('{n} búsquedas', { n: busquedas });
  const conResumen = pistas.filter((p) => p.resumen);
  if (conResumen.length === 1) return conResumen[0]!.resumen;
  if (pistas.length > 1) return trp('{n} pistas', { n: pistas.length });
  return paso.estado === 'en_curso' ? tr('en curso') : tr('hecho');
}

export interface Busqueda {
  id: string;
  titulo: string;
  base: 'exa' | 'gris' | 'pubmed' | 'epmc' | 'otra';
  fuente: string;
  salen: number;
  sirven: number;
  enteros: number;
}

/** De qué base viene una búsqueda, por su fuente. */
export function baseDe(fuente: string): { base: Busqueda['base']; nombre: string } {
  const f = fuente.toLowerCase();
  if (f.includes('literatura gris')) return { base: 'gris', nombre: tr('Exa · literatura gris') };
  if (f.startsWith('exa')) return { base: 'exa', nombre: 'Exa' };
  if (f.includes('pubmed')) return { base: 'pubmed', nombre: 'PubMed' };
  if (f.includes('europe pmc')) return { base: 'epmc', nombre: 'Europe PMC' };
  return { base: 'otra', nombre: fuente.replace(/\s*\(.*\)$/, '') };
}

/** Cada búsqueda de la iteración con lo que devolvió, de la que más sirvió a
 *  la que menos. */
export function busquedasDe(it: Iteracion | null): Busqueda[] {
  if (!it) return [];
  const filas: Busqueda[] = [];
  for (const p of it.pistas) {
    const m = RESULTADOS.exec(p.resumen);
    if (!m) continue;
    const { base, nombre } = baseDe(p.fuente);
    filas.push({ id: p.id, titulo: p.titulo.replace(/^Amplitud:\s*/, ''), base, fuente: nombre, salen: numero(m[1]!), sirven: numero(m[2]!), enteros: numero(m[3]!) });
  }
  return filas.sort((a, b) => b.sirven - a.sirven || b.enteros - a.enteros);
}

export interface TramoIteracion {
  numero: number;
  llamadas: number;
  hechos: number | null;
  usd: number | null;
  abierta: boolean;
}

/** La corrida en el tiempo: cada iteración con sus llamadas, sus hechos
 *  nuevos (de la serie de progreso, que se escribe al cerrarla) y su coste
 *  (la diferencia del acumulado; la abierta se lleva lo que falta hasta el
 *  total de la corrida). */
export function tramosDe(iteraciones: Iteracion[], c: Pick<Corrida, 'progreso'>, usdTotal: number | null): TramoIteracion[] {
  const prog = [...(c.progreso ?? [])].sort((a, b) => a.iteracion - b.iteracion);
  const its = [...iteraciones].sort((a, b) => a.numero - b.numero);
  return its.map((it) => {
    const i = prog.findIndex((p) => p.iteracion === it.numero);
    const p = i >= 0 ? prog[i]! : null;
    const previo = i > 0 ? prog[i - 1]!.usdAcumulado : 0;
    const ultimo = prog.length > 0 ? prog[prog.length - 1]!.usdAcumulado : 0;
    const usd = p ? p.usdAcumulado - previo : it.terminadaEn === null && usdTotal !== null && usdTotal >= ultimo ? usdTotal - ultimo : null;
    return { numero: it.numero, llamadas: it.presupuesto.usado, hechos: p ? p.hechosNuevos : null, usd, abierta: it.terminadaEn === null };
  });
}

export interface Limite {
  nombre: string;
  valor: string;
  fraccion: number;
  aviso: boolean;
}

/** Las condiciones que paran la corrida sola, con cuánto se ha andado de
 *  cada una. */
export function limitesDe(c: Pick<Corrida, 'parada' | 'presupuesto' | 'gasto'>, segundos: number, iteracionActual: number): Limite[] {
  const fuera: Limite[] = [];
  const horas = c.parada?.horas ?? null;
  if (horas) {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    fuera.push({ nombre: tr('Tiempo'), valor: trp('{t} de {h} h', { t: h > 0 ? `${h} h ${m}` : `${m} min`, h: horas }), fraccion: segundos / (horas * 3600), aviso: false });
  }
  const iters = c.parada?.iteraciones ?? null;
  if (iters) fuera.push({ nombre: tr('Iteraciones'), valor: trp('{a} de {b}', { a: iteracionActual, b: iters }), fraccion: iteracionActual / iters, aviso: false });
  const tope = c.presupuesto.limiteLlamadas;
  if (tope > 0) fuera.push({ nombre: tr('Tope de llamadas'), valor: trp('{a} de {b}', { a: formatearEntero(c.gasto.llamadas), b: formatearEntero(tope) }), fraccion: c.gasto.llamadas / tope, aviso: true });
  return fuera.map((l) => ({ ...l, fraccion: Math.max(0, Math.min(1, Number.isFinite(l.fraccion) ? l.fraccion : 0)) }));
}

/** El tema de la búsqueda que más sirvió, para la primera sugerencia de
 *  "Dirigir la corrida" ("Profundiza en TDP-43"). */
export function temaParaProfundizar(c: Pick<Corrida, 'busqueda'>, iteracion: number | null): string | null {
  type ConTema = { tema?: string; iteracion?: number; relevantes?: number | null; modo?: string };
  const cs = c.busqueda.consultas as unknown as ConTema[];
  const de = cs.filter((x) => x.tema && (iteracion === null || x.iteracion === undefined || x.iteracion === iteracion));
  const porRelevancia = (a: ConTema, b: ConTema) => (b.relevantes ?? 0) - (a.relevantes ?? 0);
  // Las de amplitud nombran un tema corto ("Copatología TDP-43 y esclerosis
  // hipocampal"); las de foco, una pregunta entera que no cabe en un botón.
  const mejor = [...de.filter((x) => x.modo === 'amplitud')].sort(porRelevancia)[0] ?? [...de].sort(porRelevancia)[0];
  if (!mejor?.tema || (mejor.relevantes ?? 0) === 0) return null;
  const t = mejor.tema.trim();
  const tema = /^\p{Lu}\p{Ll}/u.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t;
  return tema.length > 60 ? null : tema;
}
