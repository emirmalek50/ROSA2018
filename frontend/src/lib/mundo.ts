// Lo que la pantalla del modelo de mundo deriva de los hechos y de las
// preguntas guardadas, sin React: los estantes por tema, las sugerencias de la
// conversación, las conversaciones agrupadas por hilo, el rastro de lo que
// hizo ROSA2018 para responder y la lectura del texto de la respuesta (un
// markdown pequeño que se pinta como elementos, nunca como HTML).
//
// Nació el 1 de octubre de 2026 con la pantalla nueva (conversar como en un
// chat y los hechos ordenados por tema).

import type { EntidadCanonica, EstadoCobertura, HechoMundo, PreguntaABases } from '../datos/tipos';
import { idiomaActual, tr, trp } from './idioma';

/* ---------------------------------------------------------------------
   Los temas: las entidades canónicas con nombre en castellano
   --------------------------------------------------------------------- */

/** El nombre con que se lee cada entidad frecuente. Las ontologías dan la
 *  etiqueta en inglés («cerebrospinal fluid»); a un médico se le habla en su
 *  idioma. Los genes conservan su símbolo, que es como se nombran. */
const NOMBRES: Record<string, { nombre: string; clase?: string }> = {
  'CHEBI:64645': { nombre: 'Amiloide β', clase: 'péptido' },
  'HGNC:6893': { nombre: 'Tau (MAPT)' },
  'MONDO:0004975': { nombre: 'Enfermedad de Alzheimer' },
  'CHEBI:229272': { nombre: 'Lecanemab', clase: 'fármaco' },
  'UBERON:0001359': { nombre: 'Líquido cefalorraquídeo', clase: 'fluido' },
  'HGNC:7739': { nombre: 'NfL (NEFL)' },
  'UBERON:0002421': { nombre: 'Hipocampo', clase: 'región cerebral' },
  'CL:0000129': { nombre: 'Microglía' },
  'UBERON:0001969': { nombre: 'Plasma', clase: 'fluido' },
  'CL:0000540': { nombre: 'Neurona' },
  'CL:0000127': { nombre: 'Astrocito' },
  'GO:0150076': { nombre: 'Respuesta neuroinflamatoria' },
  'GO:0048143': { nombre: 'Activación de astrocitos' },
  'GO:0045202': { nombre: 'Sinapsis' },
};

const CLASES: Record<string, string> = {
  gen: 'gen',
  compuesto: 'compuesto',
  enfermedad: 'enfermedad',
  tejido: 'tejido',
  celula: 'célula',
  proceso: 'proceso',
  componente: 'componente celular',
};

export function nombreEntidad(e: Pick<EntidadCanonica, 'id' | 'etiqueta'>): string {
  const n = NOMBRES[e.id]?.nombre;
  if (n) return tr(n);
  // La etiqueta de la ontología con mayúscula inicial («microglial cell» se
  // lee como nombre, no como frase cortada).
  return e.etiqueta ? e.etiqueta.charAt(0).toUpperCase() + e.etiqueta.slice(1) : e.id;
}

export function claseEntidad(e: Pick<EntidadCanonica, 'id' | 'tipo'>): string {
  return tr(NOMBRES[e.id]?.clase ?? CLASES[e.tipo] ?? e.tipo ?? '');
}

export type Recuento = { sabido: number; abierto: number; descartado: number };

export type Estante = {
  entidad: EntidadCanonica;
  nombre: string;
  clase: string;
  /** La etiqueta original de la ontología si no es la que se enseña. */
  original: string | null;
  total: number;
  recuento: Recuento;
};

export type Temas = {
  estantes: Estante[];
  /** Genes cuyo símbolo no aparece en ninguno de sus hechos: el enlazado los
   *  sacó de una sigla que coincide (ARIA, ADAS), no del gen. Se apartan de
   *  los temas y se dice por qué. */
  dudosos: { entidad: EntidadCanonica; sigla: string | null; total: number }[];
  /** Hechos sin ninguna entidad reconocida (o solo con dudosas). */
  sinTema: number;
};

const recuentoVacio = (): Recuento => ({ sabido: 0, abierto: 0, descartado: 0 });

function contarEstado(r: Recuento, h: HechoMundo) {
  if (h.estado === 'sabido' || h.estado === 'abierto' || h.estado === 'descartado') r[h.estado]++;
}

const palabra = (texto: string, termino: string) => termino.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(texto);

/** ¿Algún hecho nombra el gen por su símbolo o por lo que va entre
 *  paréntesis en la etiqueta («MAPT (tau)»)? Si ninguno lo hace, el enlace es
 *  sospechoso. Solo se mira en genes: un tejido o una célula se nombran de
 *  mil maneras y no hay sigla con que confundirlos. */
function generoDudoso(e: EntidadCanonica, textos: string[]): { dudoso: boolean; sigla: string | null } {
  if (e.tipo !== 'gen') return { dudoso: false, sigla: null };
  const etiqueta = e.etiqueta ?? '';
  const simbolo = etiqueta.replace(/\s*\(.*\)\s*$/, '').trim();
  const entre = /\(([^)]+)\)/.exec(etiqueta)?.[1]?.trim() ?? '';
  const nombrado = textos.some((t) => palabra(t, simbolo) || (entre !== '' && palabra(t, entre)));
  if (nombrado) return { dudoso: false, sigla: null };
  const sigla = (e.alias ?? []).find((a) => a.length >= 2 && textos.some((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t))) ?? null;
  // Una sigla que es el símbolo sin su número (BACE por BACE1) o un nombre
  // largo con cifras (CD146 por MCAM) no se confunde con otra cosa: el enlace vale.
  if (sigla && ((sigla.length >= 3 && simbolo.toUpperCase().startsWith(sigla.toUpperCase())) || (sigla.length >= 5 && /\d/.test(sigla)))) return { dudoso: false, sigla: null };
  return { dudoso: true, sigla };
}

/** Los temas de los hechos: una entidad canónica por estante, de la más
 *  nombrada a la menos, con cuántos hechos de cada estado tiene. */
export function temasDeHechos(hechos: HechoMundo[]): Temas {
  const porId = new Map<string, { entidad: EntidadCanonica; hechos: HechoMundo[] }>();
  for (const h of hechos) {
    const vistos = new Set<string>();
    for (const e of h.entidades ?? []) {
      if (!e || typeof e.id !== 'string' || vistos.has(e.id)) continue;
      vistos.add(e.id);
      const g = porId.get(e.id) ?? { entidad: e, hechos: [] };
      g.hechos.push(h);
      porId.set(e.id, g);
    }
  }
  const estantes: Estante[] = [];
  const dudosos: Temas['dudosos'] = [];
  const idsDudosos = new Set<string>();
  for (const { entidad, hechos: hs } of porId.values()) {
    const d = generoDudoso(entidad, hs.map((h) => `${h.enunciado} ${h.motivoDescarte ?? ''}`));
    if (d.dudoso) {
      dudosos.push({ entidad, sigla: d.sigla, total: hs.length });
      idsDudosos.add(entidad.id);
      continue;
    }
    const recuento = recuentoVacio();
    for (const h of hs) contarEstado(recuento, h);
    const nombre = nombreEntidad(entidad);
    const original = entidad.etiqueta && entidad.etiqueta.toLowerCase() !== nombre.toLowerCase() ? entidad.etiqueta : null;
    estantes.push({ entidad, nombre, clase: claseEntidad(entidad), original, total: hs.length, recuento });
  }
  estantes.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  dudosos.sort((a, b) => b.total - a.total);
  const sinTema = hechos.filter((h) => !(h.entidades ?? []).some((e) => e && !idsDudosos.has(e.id))).length;
  return { estantes, dudosos, sinTema };
}

export function recuentoDe(hechos: HechoMundo[]): Recuento {
  const r = recuentoVacio();
  for (const h of hechos) contarEstado(r, h);
  return r;
}

/** «1 sabido», «3 sabidos»: los recuentos de un estado con su número. */
export function cuentaEstado(estado: keyof Recuento, n: number): string {
  const formas: Record<keyof Recuento, [string, string]> = {
    sabido: ['{n} sabido', '{n} sabidos'],
    abierto: ['{n} abierto', '{n} abiertos'],
    descartado: ['{n} descartado', '{n} descartados'],
  };
  return trp(formas[estado][n === 1 ? 0 : 1], { n });
}

export function cuentaHechos(n: number): string {
  return trp(n === 1 ? '{n} hecho' : '{n} hechos', { n });
}

/* ---------------------------------------------------------------------
   Filtrar los hechos
   --------------------------------------------------------------------- */

export const SIN_TEMA = 'sin-tema';

export type FiltroHechos = {
  texto: string;
  estado: HechoMundo['estado'] | 'todos';
  origen: HechoMundo['origen'] | 'todos';
  /** Un id de entidad, SIN_TEMA o null para todos. */
  tema: string | null;
  /** Los ids de las entidades dudosas, para que SIN_TEMA cuente igual que el estante. */
  dudosos?: Set<string>;
};

/** Se busca en el enunciado, en las referencias y en las entidades por
 *  identificador, etiqueta, alias y UniProt (GFAP, P14136 y HGNC:4235
 *  encuentran el mismo hecho). */
export function filtrarHechos(hechos: HechoMundo[], f: FiltroHechos): HechoMundo[] {
  const q = f.texto.trim().toLowerCase();
  return hechos.filter((h) => {
    if (f.estado !== 'todos' && h.estado !== f.estado) return false;
    if (f.origen !== 'todos' && h.origen !== f.origen) return false;
    const ents = (h.entidades ?? []).filter(Boolean);
    if (f.tema === SIN_TEMA && ents.some((e) => !f.dudosos?.has(e.id))) return false;
    if (f.tema !== null && f.tema !== SIN_TEMA && !ents.some((e) => e.id === f.tema)) return false;
    if (q === '') return true;
    return (
      h.enunciado.toLowerCase().includes(q) ||
      (h.motivoDescarte ?? '').toLowerCase().includes(q) ||
      h.procedencia.some((p) => p.referencia.toLowerCase().includes(q)) ||
      ents.some((x) => x.id.toLowerCase() === q || (x.etiqueta ?? '').toLowerCase().includes(q) || nombreEntidad(x).toLowerCase().includes(q) || (x.alias ?? []).some((a) => a.toLowerCase() === q) || (x.uniprot ?? '').toLowerCase() === q)
    );
  });
}

/** Primero lo más prioritario y, a igual prioridad, lo más reciente. */
export const ordenHechos = (a: HechoMundo, b: HechoMundo) => a.prioridad - b.prioridad || b.actualizadoEn - a.actualizadoEn;

/* ---------------------------------------------------------------------
   La conversación
   --------------------------------------------------------------------- */

export type Sugerencia = { icono: 'tema' | 'pregunta' | 'contraste' | 'descarte'; pregunta: string; nota: string };

/** Cuatro preguntas para empezar, sacadas de lo que hay: el tema con más
 *  hechos, la pregunta abierta más prioritaria, dónde se contradicen las
 *  fuentes y qué se descartó. Lo que no hay no se sugiere. */
export function sugerencias(hechos: HechoMundo[], temas: Temas): Sugerencia[] {
  const salida: Sugerencia[] = [];
  const [primero, segundo] = temas.estantes;
  if (primero) salida.push({ icono: 'tema', pregunta: trp('¿Qué se sabe de {tema}?', { tema: primero.nombre }), nota: cuentaHechos(primero.total) });
  const abierta = hechos.filter((h) => h.tipo === 'pregunta' && h.estado === 'abierto').sort(ordenHechos)[0];
  if (abierta) salida.push({ icono: 'pregunta', pregunta: recortar(abierta.enunciado, 110), nota: abierta.prioridad <= 2 ? tr('Pregunta abierta · prioridad alta') : tr('Pregunta abierta') });
  const contrastados = hechos.filter((h) => h.citas.some((c) => c.clasificacion === 'contrasta')).length;
  if (contrastados > 0) salida.push({ icono: 'contraste', pregunta: tr('¿Dónde se contradicen las fuentes?'), nota: trp(contrastados === 1 ? '{n} hecho con citas en contra' : '{n} hechos con citas en contra', { n: contrastados }) });
  const descartados = hechos.filter((h) => h.estado === 'descartado').length;
  if (descartados > 0) salida.push({ icono: 'descarte', pregunta: tr('¿Qué se descartó y por qué?'), nota: cuentaEstado('descartado', descartados) });
  if (salida.length < 4 && segundo) salida.push({ icono: 'tema', pregunta: trp('¿Qué se sabe de {tema}?', { tema: segundo.nombre }), nota: cuentaHechos(segundo.total) });
  return salida.slice(0, 4);
}

export function recortar(texto: string, n: number): string {
  const t = texto.trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > n * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.]+$/, '')}...`;
}

/** El hilo de una pregunta: el suyo o, si se guardó antes de que hubiera
 *  hilos, su propio id (el servidor lo entiende igual). */
export const hiloDe = (q: Pick<PreguntaABases, 'id' | 'hilo'>) => q.hilo || q.id;

export type Conversacion = { hilo: string; titulo: string; turnos: PreguntaABases[]; ultima: number };

/** Las preguntas guardadas agrupadas por conversación, de la más reciente a
 *  la más vieja; dentro de cada una, los turnos en el orden en que se hicieron. */
export function conversaciones(preguntas: PreguntaABases[]): Conversacion[] {
  const porHilo = new Map<string, PreguntaABases[]>();
  for (const q of preguntas) {
    if (!q || typeof q.id !== 'string') continue;
    const h = hiloDe(q);
    porHilo.set(h, [...(porHilo.get(h) ?? []), q]);
  }
  return [...porHilo.entries()]
    .map(([hilo, qs]) => {
      const turnos = [...qs].sort((a, b) => a.fecha - b.fecha);
      return { hilo, titulo: turnos[0]!.pregunta, turnos, ultima: turnos[turnos.length - 1]!.fecha };
    })
    .sort((a, b) => b.ultima - a.ultima);
}

/** Un id nuevo de conversación con la forma que acepta el servidor. */
export function nuevoHilo(ahora = Date.now()): string {
  return `c-${ahora.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const INTERNAS: Record<string, string> = {
  leer_modelo_de_mundo: 'leyó el modelo de mundo',
  buscar_en_proyecto: 'buscó en el proyecto',
  leer_cuestiones: 'repasó las preguntas abiertas',
};

/** El nombre legible de una herramienta, para cuando aparece en el texto. */
export function nombreHerramienta(nombre: string, fuentes: Map<string, string> = new Map()): string | null {
  if (nombre === 'leer_modelo_de_mundo') return tr('modelo de mundo');
  if (nombre === 'buscar_en_proyecto') return tr('el proyecto');
  if (nombre === 'leer_cuestiones') return tr('preguntas abiertas');
  return fuentes.get(nombre) ?? null;
}

export function fuentesDeConsultas(q: Pick<PreguntaABases, 'consultas'>): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of q.consultas ?? []) if (c && c.herramienta && c.fuente && !m.has(c.herramienta)) m.set(c.herramienta, c.fuente);
  return m;
}

/** Lo que hizo ROSA2018 para responder, en una frase: «leyó el modelo de
 *  mundo, buscó en el proyecto y 4 búsquedas en Exa». Sale de las
 *  herramientas que usó, en el orden en que las usó, y de la fuente de cada
 *  consulta registrada. */
export function rastro(q: Pick<PreguntaABases, 'herramientas' | 'consultas'>): string[] {
  const fuentes = fuentesDeConsultas(q);
  const veces = new Map<string, number>();
  for (const h of q.herramientas ?? []) if (typeof h === 'string') veces.set(h, (veces.get(h) ?? 0) + 1);
  const frases: string[] = [];
  for (const [h, n] of veces) {
    const interna = INTERNAS[h];
    if (interna) {
      frases.push(tr(interna));
      continue;
    }
    const fuente = fuentes.get(h) ?? h.replace(/_/g, ' ');
    frases.push(trp(n === 1 ? '1 búsqueda en {fuente}' : '{n} búsquedas en {fuente}', { n, fuente }));
  }
  return frases;
}

/** La cabecera de una respuesta, como en un buscador con fuentes: cuántas
 *  búsquedas hizo, cuántos documentos distintos le devolvieron, cuánto
 *  tardó y de qué fuentes, en el orden en que las usó. */
export type ResumenBusqueda = { busquedas: number; documentos: number; segundos: number | null; fuentes: string[] };

export function resumenBusqueda(q: Pick<PreguntaABases, 'herramientas' | 'consultas' | 'duracionMs'>): ResumenBusqueda {
  const consultas = (q.consultas ?? []).filter((c) => c && typeof c === 'object');
  const usadas = (q.herramientas ?? []).filter((h): h is string => typeof h === 'string');
  const mapa = fuentesDeConsultas(q);
  const fuentes: string[] = [];
  const anadir = (f: string | null | undefined) => {
    if (f && !fuentes.includes(f)) fuentes.push(f);
  };
  for (const h of usadas) anadir(nombreHerramienta(h, mapa) ?? h.replace(/_/g, ' '));
  for (const c of consultas) anadir(c.fuente || null);
  const ids = new Set<string>();
  for (const c of consultas) if (!c.error) for (const id of c.ids ?? []) ids.add(`${c.herramienta}:${id}`);
  const ms = typeof q.duracionMs === 'number' && q.duracionMs > 0 ? q.duracionMs : null;
  return { busquedas: Math.max(usadas.length, consultas.length), documentos: ids.size, segundos: ms === null ? null : Math.max(1, Math.round(ms / 1000)), fuentes };
}

/** La inicial de una fuente para su pastilla: «Europe PMC» da «E», «el
 *  proyecto» da «P». */
export function inicialFuente(fuente: string): string {
  const palabras = fuente.split(/[\s_-]+/).filter((p) => p && !/^(el|la|los|las|the|de|of)$/i.test(p));
  return (palabras[0] ?? fuente).charAt(0).toUpperCase() || '?';
}

export const ESTADO_COBERTURA: Record<EstadoCobertura, string> = {
  respondido: 'Respondido con lo consultado',
  en_parte: 'En parte',
  no_esta: 'No está en lo consultado',
  no_pude_comprobar: 'No pude comprobar',
};

/** El pie de la respuesta: si cada referencia que cita sale de lo que
 *  devolvieron las búsquedas de esta pregunta. Una respuesta que no
 *  encuentra nada y no cita está bien; una que afirma sin citar, no tanto. */
export type Veredicto = { tono: 'bien' | 'aviso' | 'neutro'; texto: string; sinRespaldo: string[] };

export function veredictoAtribucion(q: Pick<PreguntaABases, 'atribucion' | 'cobertura'>): Veredicto | null {
  const a = q.atribucion;
  if (!a || !Array.isArray(a.citadas)) return null;
  const citadas = a.citadas.length;
  const sin = (a.sinRespaldo ?? []).filter((r) => typeof r === 'string');
  if (citadas === 0) {
    const cob = q.cobertura ?? [];
    const afirma = cob.some((p) => p.estado === 'respondido' || p.estado === 'en_parte');
    if (cob.length > 0 && !afirma) return { tono: 'bien', texto: tr('La respuesta se abstiene y no cita: correcto, nada que atribuir.'), sinRespaldo: [] };
    if (afirma) return { tono: 'aviso', texto: tr('Responde sin citar ninguna referencia comprobable: tómalo como orientación, no como dato.'), sinRespaldo: [] };
    return { tono: 'neutro', texto: tr('No cita referencias comprobables.'), sinRespaldo: [] };
  }
  if (sin.length === 0)
    return { tono: 'bien', texto: citadas === 1 ? tr('La referencia que cita sale de lo que devolvieron las búsquedas.') : trp('Las {n} referencias que cita salen de lo que devolvieron las búsquedas.', { n: citadas }), sinRespaldo: [] };
  if (citadas === 1) return { tono: 'aviso', texto: tr('La referencia que cita no sale de ninguna búsqueda de esta pregunta: compruébala antes de usarla.'), sinRespaldo: sin };
  return { tono: 'aviso', texto: trp(sin.length === 1 ? '{m} de {n} referencias no sale de ninguna búsqueda de esta pregunta: compruébala antes de usarla.' : '{m} de {n} referencias no salen de ninguna búsqueda de esta pregunta: compruébalas antes de usarlas.', { m: sin.length, n: citadas }), sinRespaldo: sin };
}

export function unirLista(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  const y = idiomaActual() === 'en' ? ' and ' : ' y ';
  return `${partes.slice(0, -1).join(', ')}${y}${partes[partes.length - 1]}`;
}

export function cuentaPasos(n: number): string {
  return trp(n === 1 ? '{n} paso' : '{n} pasos', { n });
}

/* ---------------------------------------------------------------------
   El texto de la respuesta
   --------------------------------------------------------------------- */

/** Un trozo de una línea. Lo que se reconoce como identificador va aparte
 *  para pintarlo como enlace comprobable: un DOI, un ensayo, un PMID o un
 *  hecho del modelo de mundo. */
export type Trozo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrita'; trozos: Trozo[] }
  | { tipo: 'cursiva'; trozos: Trozo[] }
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'doi'; doi: string }
  | { tipo: 'ensayo'; nct: string }
  | { tipo: 'pmid'; pmid: string }
  | { tipo: 'hecho'; id: string }
  | { tipo: 'herramienta'; nombre: string };

export type Bloque =
  | { tipo: 'titulo'; nivel: number; trozos: Trozo[] }
  | { tipo: 'parrafo'; lineas: Trozo[][] }
  | { tipo: 'lista'; ordenada: boolean; items: { lineas: Trozo[][] }[] };

const RE_DOI = /^10\.\d{4,9}\/[^\s`"'<>]+$/;
const RE_NCT = /^NCT\d{8}$/;
const RE_HECHO = /^he-[a-z0-9]+-\d+$/;
const RE_TOOL = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function sinPuntoFinal(s: string): [string, string] {
  const m = /[.,;:)\]]+$/.exec(s);
  return m ? [s.slice(0, m.index), m[0]] : [s, ''];
}

function clasificarCodigo(texto: string, herramientas: Set<string>): Trozo {
  const t = texto.trim();
  if (RE_DOI.test(t)) return { tipo: 'doi', doi: sinPuntoFinal(t)[0] };
  if (RE_NCT.test(t)) return { tipo: 'ensayo', nct: t };
  if (RE_HECHO.test(t)) return { tipo: 'hecho', id: t };
  if (/^\d{6,9}$/.test(t)) return { tipo: 'codigo', texto: t };
  if (herramientas.has(t) || (RE_TOOL.test(t) && t in INTERNAS)) return { tipo: 'herramienta', nombre: t };
  return { tipo: 'codigo', texto: t };
}

/** Lo que queda fuera de negritas y código: se buscan DOIs, ensayos, PMIDs y
 *  hechos sueltos en el texto. */
function identificadores(texto: string): Trozo[] {
  const salida: Trozo[] = [];
  const re = /(10\.\d{4,9}\/[^\s`"'<>]+)|\b(NCT\d{8})\b|\bPMID:?\s?(\d{6,9})\b|\b(he-[a-z0-9]+-\d+)\b/g;
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > ultimo) salida.push({ tipo: 'texto', texto: texto.slice(ultimo, i) });
    let fin = i + m[0].length;
    if (m[1]) {
      const [doi, cola] = sinPuntoFinal(m[1]);
      salida.push({ tipo: 'doi', doi });
      fin -= cola.length;
    } else if (m[2]) salida.push({ tipo: 'ensayo', nct: m[2] });
    else if (m[3]) salida.push({ tipo: 'pmid', pmid: m[3] });
    else if (m[4]) salida.push({ tipo: 'hecho', id: m[4] });
    ultimo = fin;
  }
  if (ultimo < texto.length) salida.push({ tipo: 'texto', texto: texto.slice(ultimo) });
  return salida;
}

/** Una línea en trozos: **negrita**, *cursiva*, `código` y los
 *  identificadores. Lo que no casa se queda como texto tal cual: un asterisco
 *  suelto no se come la frase. */
export function analizarLinea(linea: string, herramientas: Set<string> = new Set(), profundidad = 0): Trozo[] {
  const salida: Trozo[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|(?<![\p{L}\p{N}*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu;
  let ultimo = 0;
  for (const m of linea.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > ultimo) salida.push(...identificadores(linea.slice(ultimo, i)));
    if (m[1] !== undefined) salida.push(profundidad > 1 ? { tipo: 'texto', texto: m[1] } : { tipo: 'negrita', trozos: analizarLinea(m[1], herramientas, profundidad + 1) });
    else if (m[2] !== undefined) salida.push(clasificarCodigo(m[2], herramientas));
    else if (m[3] !== undefined) salida.push(profundidad > 1 ? { tipo: 'texto', texto: m[3] } : { tipo: 'cursiva', trozos: analizarLinea(m[3], herramientas, profundidad + 1) });
    ultimo = i + m[0].length;
  }
  if (ultimo < linea.length) salida.push(...identificadores(linea.slice(ultimo)));
  return salida;
}

/** El texto en bloques: títulos (#), listas (-, *, 1.) con sus líneas de
 *  continuación y párrafos separados por una línea en blanco. */
export function analizarTexto(texto: string, herramientas: Set<string> = new Set()): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: Trozo[][] | null = null;
  let lista: Extract<Bloque, { tipo: 'lista' }> | null = null;
  const cerrar = () => {
    if (parrafo) bloques.push({ tipo: 'parrafo', lineas: parrafo });
    if (lista) bloques.push(lista);
    parrafo = null;
    lista = null;
  };
  for (const cruda of (texto ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const linea = cruda.replace(/\s+$/, '');
    if (linea.trim() === '') {
      // Una línea en blanco dentro de una lista no la corta si sigue otra viñeta o una continuación sangrada.
      if (parrafo) cerrar();
      continue;
    }
    const titulo = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(linea);
    if (titulo) {
      cerrar();
      bloques.push({ tipo: 'titulo', nivel: titulo[1]!.length, trozos: analizarLinea(titulo[2]!.replace(/\s*#+$/, ''), herramientas) });
      continue;
    }
    const vineta = /^\s{0,3}([-*•]|\d{1,2}[.)])\s+(.*)$/.exec(linea);
    if (vineta) {
      const ordenada = /\d/.test(vineta[1]!);
      if (parrafo) cerrar();
      const actual = lista as Extract<Bloque, { tipo: 'lista' }> | null;
      if (!actual || actual.ordenada !== ordenada) {
        cerrar();
        lista = { tipo: 'lista', ordenada, items: [] };
      }
      lista!.items.push({ lineas: [analizarLinea(vineta[2]!, herramientas)] });
      continue;
    }
    const actual = lista as Extract<Bloque, { tipo: 'lista' }> | null;
    if (actual && /^\s+/.test(linea) && actual.items.length > 0) {
      actual.items[actual.items.length - 1]!.lineas.push(analizarLinea(linea.trim(), herramientas));
      continue;
    }
    if (lista) cerrar();
    parrafo = parrafo ?? [];
    parrafo.push(analizarLinea(linea.trim(), herramientas));
  }
  cerrar();
  return bloques;
}

/** Las referencias que nombra la respuesta, sin repetir y en orden de
 *  aparición: para el recuento de fuentes y para los hechos que se pueden
 *  abrir. */
export function referenciasDe(bloques: Bloque[]): { dois: string[]; ensayos: string[]; pmids: string[]; hechos: string[] } {
  const r = { dois: new Set<string>(), ensayos: new Set<string>(), pmids: new Set<string>(), hechos: new Set<string>() };
  const ver = (ts: Trozo[]) => {
    for (const t of ts) {
      if (t.tipo === 'doi') r.dois.add(t.doi);
      else if (t.tipo === 'ensayo') r.ensayos.add(t.nct);
      else if (t.tipo === 'pmid') r.pmids.add(t.pmid);
      else if (t.tipo === 'hecho') r.hechos.add(t.id);
      else if (t.tipo === 'negrita' || t.tipo === 'cursiva') ver(t.trozos);
    }
  };
  for (const b of bloques) {
    if (b.tipo === 'titulo') ver(b.trozos);
    else if (b.tipo === 'parrafo') b.lineas.forEach(ver);
    else b.items.forEach((i) => i.lineas.forEach(ver));
  }
  return { dois: [...r.dois], ensayos: [...r.ensayos], pmids: [...r.pmids], hechos: [...r.hechos] };
}

/** El texto plano de una línea en trozos (para copiar y para los tests). */
export function textoPlano(ts: Trozo[]): string {
  return ts
    .map((t) => {
      switch (t.tipo) {
        case 'texto':
        case 'codigo':
          return t.texto;
        case 'negrita':
        case 'cursiva':
          return textoPlano(t.trozos);
        case 'doi':
          return t.doi;
        case 'ensayo':
          return t.nct;
        case 'pmid':
          return `PMID ${t.pmid}`;
        case 'hecho':
          return t.id;
        case 'herramienta':
          return t.nombre;
      }
    })
    .join('');
}

/** ¿La línea es la de «Fuente: ...» que va debajo de cada punto? Se pinta
 *  más pequeña, como pie del punto. */
export function esLineaDeFuente(ts: Trozo[]): boolean {
  const primero = ts.find((t) => !(t.tipo === 'texto' && t.texto.trim() === ''));
  return !!primero && primero.tipo === 'negrita' && /^\s*(fuentes?|source)s?\s*:?\s*$/i.test(textoPlano(primero.trozos));
}
