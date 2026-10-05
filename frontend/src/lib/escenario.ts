// Lo que enseña la corrida en vivo (diseño "Corrida en vivo · v1", 5 de
// octubre de 2026), sacado del registro y no escrito a mano: el paso en foco,
// cuánto lleva de su trabajo, a qué ritmo, el latido de su pista, quién está
// en escena, el recorrido de la iteración, lo que van encontrando las
// búsquedas y la corrida en el tiempo. Funciones puras: la pantalla solo
// pinta lo que sale de aquí.

import type { ConsultaBusqueda, Corrida, EstadoRosa, Investigacion, Iteracion, PasoPlan, Pista, RolModelo } from '../datos/tipos';
import { formatearDuracion, formatearEntero } from './formato';
import { tr, trp } from './idioma';
import { partesAutomatizadas } from './parada';

/** El paso que la pantalla pone en grande: el que está en curso; si no hay
 *  ninguno (la corrida está en pausa), el primero que falta, que es donde se
 *  quedó; con todo hecho, el último. */
export function pasoFoco(it: Iteracion | null): PasoPlan | null {
  if (!it || it.plan.length === 0) return null;
  const pistaViva = it.pistas.find((p) => p.estado === 'en_curso' && p.pasoId);
  return it.plan.find((p) => p.estado === 'en_curso') ?? it.plan.find((p) => p.id === pistaViva?.pasoId) ?? it.plan.find((p) => p.estado === 'pendiente') ?? it.plan[it.plan.length - 1]!;
}

/** La pista viva más reciente, o el último intento registrado. Un fallo
 * antiguo no desplaza una pista posterior que sí terminó. */
export function pistaFoco(it: Iteracion | null, paso: PasoPlan | null): Pista | null {
  if (!it || !paso) return null;
  const del = it.pistas.filter((p) => p.pasoId === paso.id);
  if (del.length === 0) return null;
  return [...del].reverse().find((p) => p.estado === 'en_curso') ?? del[del.length - 1]!;
}

// Solo los contadores de trabajo emitidos por pasos.py. El cribado también
// dice "13 de 30", pero no son 13 pasos ejecutados ni afirmaciones juzgadas.
const PROGRESO = /^(?:Juez:\s*|Fuente\s+)(\d[\d.]*)\s+de\s+(\d[\d.]*)/;
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
export function avanceDe(it: Iteracion | null, paso: PasoPlan | null, trabajando = true): Avance | null {
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
    const viva = trabajando && pista?.estado === 'en_curso';
    const ritmo = viva && pen && salto > 0 && ult.t > pen.t ? trp('{n} cada {t}', { n: formatearEntero(salto), t: formatearDuracion(ult.t - pen.t) }) : null;
    const pri = delMismo[0]!;
    const porUnidad = ult.n > pri.n && ult.t > pri.t ? (ult.t - pri.t) / (ult.n - pri.n) : null;
    const quedan = ult.de - ult.n;
    const faltan = quedan > 0
      ? viva && porUnidad !== null
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
  return fuente.replace(/\(.*?\)/g, '').split('+').some((parte) => {
    const corto = parte.trim().toLowerCase();
    return corto.length > 2 && nombre.toLowerCase().includes(corto);
  });
}

/** El trabajo registrado en las pistas, sin confundir la salud global con
 * actividad en esta corrida. Las fuentes conservan los modelos históricos. */
export function elencoDe(estado: Pick<EstadoRosa, 'saludModelos'>, it: Iteracion | null, foco: Pista | null, trabajando: boolean, nombreDe: (modelo: string) => string): Actor[] {
  const salud = estado.saludModelos ?? {};
  const actores = ORDEN_ROLES.filter((r) => salud[r]?.modelo).map((rol) => {
    const configurado = nombreDe(salud[rol]!.modelo);
    const patron = { juez: /opus|juez/i, cerebro: /astra/i, volumen: /sonnet/i, replica: /réplica|replica/i }[rol];
    const registrado = [...(it?.pistas ?? [])].reverse().flatMap((p) => p.fuente.replace(/\(.*?\)/g, '').split('+').map((f) => f.trim())).find((f) => patron.test(f));
    const nombre = registrado && !nombraA(registrado, configurado) ? registrado : configurado;
    const activo = !!(trabajando && it?.terminadaEn === null && (it.pistas.some((p) => p.estado === 'en_curso' && nombraA(p.fuente, nombre)) || (foco?.estado === 'en_curso' && nombraA(foco.fuente, nombre))));
    const suyas = (it?.pistas ?? []).filter((p) => nombraA(p.fuente, nombre) && p.resumen);
    const ultima = suyas[suyas.length - 1];
    const nota = activo
      ? tr('etapa en curso')
      : ultima ? ultima.resumen : tr('sin trabajo registrado en esta iteración');
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
  const busquedas = pistas.filter((p) => (p.tipo === 'literatura' && p.transcripcion.some((e) => e.texto.startsWith('Consulta: '))) || RESULTADOS.test(p.resumen)).length;
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
  salen: number | null;
  sirven: number | null;
  enteros: number | null;
  estado: Pista['estado'] | 'registrada';
  compartida: boolean;
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
export function consultasDe(it: Iteracion | null, consultas: ConsultaBusqueda[]): ConsultaBusqueda[] {
  if (!it) return [];
  // Los registros antiguos sin número se asignan por la ventana de fechas,
  // nunca a todas las iteraciones de la corrida.
  return consultas.filter((q) => q.iteracion !== undefined ? q.iteracion === it.numero : q.fecha >= it.empezadaEn && (it.terminadaEn === null || q.fecha <= it.terminadaEn));
}

export function busquedasDe(it: Iteracion | null, consultas: ConsultaBusqueda[] = []): Busqueda[] {
  if (!it) return [];
  const filas: Busqueda[] = [];
  const vinculadas = new Set<string>();
  const deLaIteracion = consultasDe(it, consultas);
  for (const [i, q] of deLaIteracion.entries()) {
    const candidatas = it.pistas.filter((p) => p.fuente === q.base && (q.relajadaDe || !vinculadas.has(p.id)));
    const p = q.pistaId
      ? it.pistas.find((p) => p.id === q.pistaId)
      : candidatas.find((p) => p.transcripcion.some((e) => e.texto === `Consulta: ${q.relajadaDe ?? q.consulta}`))
        ?? candidatas.find((p) => q.tema && p.titulo.replace(/^Amplitud:\s*/, '') === q.tema.slice(0, 80));
    if (p) vinculadas.add(p.id);
    const m = p ? RESULTADOS.exec(p.resumen) : null;
    const { base, nombre } = baseDe(q.base);
    const sinTraidos = p?.estado === 'hecha' && /resultados, ninguno traído/.test(p.resumen);
    filas.push({ id: `${it.id}-consulta-${i}`, titulo: q.tema || q.consulta, base, fuente: nombre,
      salen: q.resultados, sirven: q.relevantes ?? (m ? numero(m[2]!) : sinTraidos ? 0 : null),
      enteros: q.textoCompleto ?? (m ? numero(m[3]!) : sinTraidos ? 0 : null),
      estado: p?.estado ?? 'registrada', compartida: !!q.relajadaDe || deLaIteracion.some((otra) => otra.relajadaDe === q.consulta) });
  }
  for (const p of it.pistas) {
    if (vinculadas.has(p.id)) continue;
    const m = RESULTADOS.exec(p.resumen);
    // Conserva el histórico anterior al registro de consultas y los fallos
    // de conexión, que no llegan a crear un registro con resultados.
    const consulta = p.tipo === 'literatura' && p.transcripcion.some((e) => e.texto.startsWith('Consulta: '));
    if (!m && !consulta) continue;
    const { base, nombre } = baseDe(p.fuente);
    filas.push({ id: p.id, titulo: p.titulo.replace(/^Amplitud:\s*/, ''), base, fuente: nombre, salen: m ? numero(m[1]!) : null, sirven: m ? numero(m[2]!) : null, enteros: m ? numero(m[3]!) : null, estado: p.estado, compartida: false });
  }
  return filas.sort((a, b) => (b.sirven ?? -1) - (a.sirven ?? -1) || (b.enteros ?? -1) - (a.enteros ?? -1));
}

export interface TramoIteracion {
  numero: number;
  llamadas: number;
  hechos: number | null;
  usd: number | null;
  abierta: boolean;
  estado: Corrida['estado'] | 'cerrada';
}

/** La corrida en el tiempo: cada iteración con sus llamadas, sus hechos
 *  nuevos (de la serie de progreso, que se escribe al cerrarla) y su coste
 *  (la diferencia del acumulado; la abierta se lleva lo que falta hasta el
 *  total de la corrida). */
export function tramosDe(iteraciones: Iteracion[], c: Pick<Corrida, 'progreso' | 'gasto' | 'estado'>): TramoIteracion[] {
  const prog = [...(c.progreso ?? [])].sort((a, b) => a.iteracion - b.iteracion);
  const its = [...iteraciones].sort((a, b) => a.numero - b.numero);
  return its.map((it) => {
    const i = prog.findIndex((p) => p.iteracion === it.numero);
    const p = i >= 0 ? prog[i]! : null;
    const previo = prog.find((p) => p.iteracion === it.numero - 1);
    const completa = it.numero === 1 || previo !== undefined;
    const ultima = it.numero === its[its.length - 1]?.numero;
    // Las instantáneas guardan USD ESTIMADOS, no la factura del gateway.
    // Mezclar ambas bases producía costes negativos o borraba la abierta.
    const acumulado = p?.usdAcumulado ?? (ultima ? c.gasto.usd : undefined);
    const usd = completa && acumulado !== undefined && acumulado >= (previo?.usdAcumulado ?? 0) ? acumulado - (previo?.usdAcumulado ?? 0) : null;
    const llamadas = completa ? (p?.llamadasAcumuladas ?? (ultima ? c.gasto.llamadas : undefined)) : undefined;
    return { numero: it.numero, llamadas: llamadas !== undefined ? Math.max(0, llamadas - (previo?.llamadasAcumuladas ?? 0)) : it.presupuesto.usado, hechos: p ? p.hechosNuevos : null, usd, abierta: it.terminadaEn === null, estado: it.terminadaEn === null ? c.estado : 'cerrada' };
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
export function topesDe(c: Pick<Corrida, 'parada'>, inv?: Pick<Investigacion, 'condicionParada' | 'mision'>): { horas: number | null; iteraciones: number | null; llamadas: number | null } {
  const general = partesAutomatizadas(inv?.condicionParada ?? '');
  const texto = partesAutomatizadas(c.parada?.texto ?? '');
  const horasDe = (t: string | null): number | null => {
    if (!t) return null;
    const [n, u] = t.split(' ');
    return Number(n!.replace(',', '.')) * (u === 'min' ? 1 / 60 : u === 'd' ? 24 : 1);
  };
  const menor = (...ns: (number | null | undefined)[]) => {
    const positivos = ns.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    return positivos.length > 0 ? Math.min(...positivos) : null;
  };
  // Misma precedencia por eje que _condicion_de_parada del supervisor.
  return {
    horas: menor(c.parada?.horas ?? horasDe(general.tiempo), horasDe(texto.tiempo), inv?.mision?.presupuesto.horas),
    iteraciones: menor(c.parada?.iteraciones ?? general.iteraciones, texto.iteraciones),
    llamadas: menor(c.parada?.llamadas ?? general.llamadas, texto.llamadas),
  };
}

export function limitesDe(c: Pick<Corrida, 'parada' | 'presupuesto' | 'gasto' | 'progreso'>, segundos: number, iteracionesCerradas: number, inv?: Pick<Investigacion, 'condicionParada' | 'mision'>): Limite[] {
  const fuera: Limite[] = [];
  const topes = topesDe(c, inv);
  const horas = topes.horas;
  if (horas) {
    fuera.push({ nombre: tr('Tiempo'), valor: trp('{t} de {limite}', { t: formatearDuracion(segundos * 1000) || '0 s', limite: formatearDuracion(horas * 3_600_000) }), fraccion: segundos / (horas * 3600), aviso: false });
  }
  const iters = topes.iteraciones;
  if (iters) fuera.push({ nombre: tr('Iteraciones cerradas'), valor: trp('{a} de {b}', { a: iteracionesCerradas, b: iters }), fraccion: iteracionesCerradas / iters, aviso: false });
  if (topes.llamadas) fuera.push({ nombre: tr('Llamadas para terminar'), valor: trp('{a} de {b}', { a: formatearEntero(c.gasto.llamadas), b: formatearEntero(topes.llamadas) }), fraccion: c.gasto.llamadas / topes.llamadas, aviso: false });
  const usd = inv?.mision?.presupuesto.usd;
  if (usd && c.gasto.usd !== undefined) fuera.push({ nombre: tr('Presupuesto de la misión'), valor: trp('{a} de {b} USD estimados', { a: c.gasto.usd.toFixed(2), b: usd }), fraccion: c.gasto.usd / usd, aviso: false });
  const serie = c.progreso ?? [];
  if (c.parada?.certeza) {
    const niveles = ['muy_baja', 'baja', 'moderada', 'alta'];
    const n = (serie[serie.length - 1]?.certezas ?? []).filter((x) => x.peldano >= niveles.indexOf(c.parada!.certeza!)).length;
    const objetivo = c.parada.cuantas ?? 1;
    fuera.push({ nombre: trp('Hipótesis en certeza {nivel} o superior', { nivel: tr(c.parada.certeza) }), valor: trp('{a} de {b}', { a: n, b: objetivo }), fraccion: n / objetivo, aviso: false });
  }
  if (c.parada?.sinCambio) {
    let n = 0;
    for (const p of [...serie].reverse()) {
      if (p.peldanosSubidos > 0 || p.hechosNuevos > 0) break;
      n++;
    }
    fuera.push({ nombre: tr('Iteraciones sin avance'), valor: trp('{a} de {b}', { a: n, b: c.parada.sinCambio }), fraccion: n / c.parada.sinCambio, aviso: false });
  }
  const tope = c.presupuesto.limiteLlamadas;
  if (tope > 0) fuera.push({ nombre: tr('Tope de llamadas'), valor: trp('{a} de {b}', { a: formatearEntero(c.gasto.llamadas), b: formatearEntero(tope) }), fraccion: c.gasto.llamadas / tope, aviso: true });
  return fuera.map((l) => ({ ...l, fraccion: Math.max(0, Math.min(1, Number.isFinite(l.fraccion) ? l.fraccion : 0)) }));
}

/** El tema de la búsqueda que más sirvió, para la primera sugerencia de
 *  "Dirigir la corrida" ("Profundiza en TDP-43"). */
export function temaParaProfundizar(c: Pick<Corrida, 'busqueda'>, iteracion: number | null): string | null {
  const cs = c.busqueda.consultas;
  const de = cs.filter((x) => x.tema && (iteracion === null || x.iteracion === undefined || x.iteracion === iteracion));
  const porRelevancia = (a: ConsultaBusqueda, b: ConsultaBusqueda) => (b.relevantes ?? 0) - (a.relevantes ?? 0);
  // Las de amplitud nombran un tema corto ("Copatología TDP-43 y esclerosis
  // hipocampal"); las de foco, una pregunta entera que no cabe en un botón.
  const mejor = [...de.filter((x) => x.modo === 'amplitud')].sort(porRelevancia)[0] ?? [...de].sort(porRelevancia)[0];
  if (!mejor?.tema || (mejor.relevantes ?? 0) === 0) return null;
  const t = mejor.tema.trim();
  const tema = /^\p{Lu}\p{Ll}/u.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t;
  return tema.length > 60 ? null : tema;
}
