// El visor de citas: los tipos que devuelve el servidor y el reparto del texto
// de la página en trozos resaltados y sin resaltar.
//
// El backend (rosa/citas.py) dice DÓNDE está el pasaje dentro de la página,
// como pares de posiciones sobre el texto original. Aquí solo se corta el
// texto por esas posiciones, que es lo que necesita el navegador para pintar
// unos trozos dentro de una marca y el resto fuera. Se hace en un módulo
// aparte y probado porque un corte mal hecho desplazaría el resaltado, y un
// resaltado que señala la frase de al lado es peor que no resaltar nada.

import type { RecuperacionCitas } from '../datos/tipos';
import { certezaDe } from './etiquetas';
import { formatearEntero, plural } from './formato';
import { traducido, tr, trc, trp } from './idioma';

export type ClaseCita = 'pagina' | 'seccion' | 'resumen' | 'web' | 'otro';

export interface TramoCita {
  inicio: number;
  fin: number;
  texto: string;
}

/** Las dos señales deterministas, medidas con las reglas y los fragmentos de
 *  hoy. Son distintas y no hay que juntarlas: una cita puede apuntar a un sitio
 *  que no existe aunque su texto coincida con la fuente, y al revés. */
export interface ComprobacionDeHoy {
  /** La cita apunta a una posición que existe: fuente más localizador. */
  resuelve: boolean;
  /** Por qué no resuelve, con las palabras del verificador. */
  motivoResuelve: string;
  /** El pasaje citado está entero en esa posición. */
  literal: boolean;
  /** El tramo del pasaje que no aparece, si falta alguno. */
  falta: string | null;
  /** El localizador tiene un formato de los que el verificador admite. */
  localizadorAdmitido: boolean;
  /** Falso cuando el servidor no manda estas señales (versión anterior). */
  disponible?: boolean;
}

/** Lo que diría hoy el verificador entero, no solo las dos señales de la cita:
 *  comprueba además los identificadores que la afirmación nombra y las
 *  ausencias que declara. Una cita en orden no basta para desbloquear. */
export interface VeredictoDeHoy {
  veredicto: string;
  motivo: string;
  bloquea: boolean;
}

export interface AfirmacionCitada {
  id: string;
  texto: string;
  cita: string;
  veredicto: string;
  motivo?: string | null;
  tipo?: string | null;
  tema?: string | null;
  iteracion: number;
  fuenteId: string | null;
  referencia: string;
  localizador: string;
  clase: ClaseCita;
  conTexto: boolean;
  conPdf: boolean;
  hoy: ComprobacionDeHoy;
  veredictoDeHoy?: VeredictoDeHoy;
  /** El veredicto guardado bloquea y el verificador de hoy ya no. */
  bloqueoViejo: boolean;
}

export interface ResumenCitas {
  total: number;
  porVeredicto: Record<string, number>;
  porClase: Record<string, number>;
  conPagina: number;
  conPdf: number;
  /** Bloqueadas que el verificador de hoy ya no bloquea. */
  bloqueosViejos: number;
  /** Con la cita en orden: resuelve y es literal. No es lo mismo. */
  conCitaEnOrden: number;
  /** Bloqueadas cuya cita está en orden, bloqueadas o no por otra regla. */
  bloqueadasConCitaEnOrden: number;
  resuelvenHoy: number;
  literalesHoy: number;
}

export interface ListaCitas {
  corridaId: string;
  resumen: ResumenCitas;
  afirmaciones: AfirmacionCitada[];
}

export interface FichaCita {
  hoy: ComprobacionDeHoy;
  veredictoDeHoy?: VeredictoDeHoy;
  bloqueoViejo: boolean;
  afirmacion: {
    id: string;
    texto: string;
    cita: string;
    veredicto: string;
    motivo?: string | null;
    tipo?: string | null;
    tema?: string | null;
    iteracion: number;
    pasaje: string;
  };
  fuente: {
    id: string | null;
    referencia: string;
    titulo: string;
    doi?: string | null;
    pmid?: string | null;
    nct?: string | null;
    anio?: number | null;
    tipo?: string | null;
    tipoEstudio?: string | null;
    retraccion?: boolean | null;
    textoCompleto: boolean;
  };
  localizador: string;
  clase: ClaseCita;
  pagina: number | null;
  encabezado: string;
  texto: string;
  tramos: TramoCita[];
  falta: string | null;
  completo: boolean;
  conPdf: boolean;
  url: string;
  leidos: { localizador: string; clase: ClaseCita; pagina: number | null; actual: boolean }[];
}

export interface Trozo {
  texto: string;
  marcado: boolean;
}

/** El texto de la página partido en trozos, marcando los tramos que sostienen
 *  la afirmación. Los tramos se ordenan y se fusionan si se solapan, y los que
 *  caen fuera del texto se descartan: el resaltado nunca puede desplazar el
 *  texto ni perder un trozo por un dato raro del servidor. */
export function trozosDeTexto(texto: string, tramos: readonly TramoCita[]): Trozo[] {
  const largo = (texto ?? '').length;
  if (!largo) return [];
  const limpios = (tramos ?? [])
    .map((t) => ({ inicio: Math.max(0, Math.min(largo, Math.trunc(Number(t?.inicio)))), fin: Math.max(0, Math.min(largo, Math.trunc(Number(t?.fin)))) }))
    .filter((t) => Number.isFinite(t.inicio) && Number.isFinite(t.fin) && t.fin > t.inicio)
    .sort((a, b) => a.inicio - b.inicio);
  const fundidos: { inicio: number; fin: number }[] = [];
  for (const t of limpios) {
    const ultimo = fundidos[fundidos.length - 1];
    if (ultimo && t.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.fin);
    else fundidos.push({ ...t });
  }
  const salida: Trozo[] = [];
  let cursor = 0;
  for (const t of fundidos) {
    if (t.inicio > cursor) salida.push({ texto: texto.slice(cursor, t.inicio), marcado: false });
    salida.push({ texto: texto.slice(t.inicio, t.fin), marcado: true });
    cursor = t.fin;
  }
  if (cursor < largo) salida.push({ texto: texto.slice(cursor), marcado: false });
  return salida;
}

/** Las señales de una ficha que viene de un servidor anterior, que todavía no
 *  las manda: se dice que no se pudieron comprobar, en vez de romper la
 *  pantalla o de inventar un sí. */
export const SIN_COMPROBAR: ComprobacionDeHoy = traducido({ resuelve: false, motivoResuelve: 'Este servidor todavía no comprueba la cita al abrir la ficha.', literal: false, falta: null, localizadorAdmitido: false, disponible: false });

/** Las señales de una respuesta, con su respaldo si no vienen. */
export function senalesDe(hoy: ComprobacionDeHoy | undefined | null): ComprobacionDeHoy {
  if (!hoy || typeof hoy !== 'object') return SIN_COMPROBAR;
  return {
    resuelve: Boolean(hoy.resuelve),
    motivoResuelve: typeof hoy.motivoResuelve === 'string' ? hoy.motivoResuelve : '',
    literal: Boolean(hoy.literal),
    falta: typeof hoy.falta === 'string' ? hoy.falta : null,
    localizadorAdmitido: Boolean(hoy.localizadorAdmitido),
    disponible: hoy.disponible !== false,
  };
}

/** Cuántas palabras se usan para señalar el pasaje en la página web. Pocas
 *  no distinguen entre dos frases parecidas; demasiadas fallan en cuanto la
 *  web difiere en una coma del texto que se guardó. */
const ANCLA_MINIMA = 4;
const ANCLA_MAXIMA = 12;

/** Una palabra sirve de ancla si es solo letras, cifras o paréntesis.
 *
 *  No es por el apóstrofo: medido el 22 de septiembre de 2026 contra medRxiv,
 *  que pinta "Alzheimer’s" (U+2019) donde el pasaje guardado dice
 *  "Alzheimer's" (U+0027), el navegador SALTA igual. Su comparador normaliza
 *  esas diferencias, al revés que una comparación de cadenas a pelo. Lo que
 *  sí puede romper es un espacio de más dentro de un símbolo ("95 %" frente a
 *  "95%"), porque ahí no hay nada que normalizar. Así que se recorta por ahí,
 *  sin pretender que sea la causa de nada. */
const PALABRA_ESTABLE = /^[\p{L}\p{N}()]+$/u;

/** Escapa un trozo para un fragmento de texto: además de lo normal, la coma y
 *  el guion tienen significado propio en esa sintaxis. */
function paraFragmento(trozo: string): string {
  return encodeURIComponent(trozo.trim()).replace(/-/g, '%2D').replace(/,/g, '%2C');
}

/** El ancla con la que se señala el pasaje: sus primeras palabras estables.
 *
 *  Se empieza por el PRINCIPIO del pasaje a propósito, para que el navegador
 *  deje al lector donde el pasaje empieza y no en mitad de él. Si la primera
 *  palabra ya no sirve, se cae al tramo estable más largo, que al menos cae
 *  dentro del pasaje. Devuelve null si no hay con qué señalar. */
export function anclaEstable(pasaje: string): string | null {
  const palabras = pasaje.split(' ').filter(Boolean);
  const desdeElPrincipio: string[] = [];
  for (const palabra of palabras) {
    if (!PALABRA_ESTABLE.test(palabra)) break;
    desdeElPrincipio.push(palabra);
    if (desdeElPrincipio.length >= ANCLA_MAXIMA) break;
  }
  if (desdeElPrincipio.length >= ANCLA_MINIMA) return desdeElPrincipio.join(' ');
  let mejor: string[] = [];
  let actual: string[] = [];
  for (const palabra of palabras) {
    if (PALABRA_ESTABLE.test(palabra)) {
      actual.push(palabra);
      if (actual.length > mejor.length) mejor = actual.slice();
    } else {
      actual = [];
    }
  }
  if (mejor.length < ANCLA_MINIMA) return null;
  return mejor.slice(0, ANCLA_MAXIMA).join(' ');
}

/** Un enlace que lleva AL TEXTO, no solo al documento.
 *
 *  - En un PDF va solo la página (`#page=N`). NO se manda `search=`: el visor
 *    de Chrome lee `nameddest`, `navpanes`, `page`, `toolbar`, `view` y
 *    `zoom`, y tira `search` sin decir nada
 *    (chrome/browser/resources/pdf/open_pdf_params_parser.ts), así que
 *    prometía una marca que no llegaba nunca. La marca de verdad la pinta
 *    ROSA2018 sobre la página, que para eso sirve ella el PDF.
 *  - En una página web se usa un FRAGMENTO DE TEXTO (`#:~:text=`), que hace
 *    que el navegador baje solo hasta el pasaje y lo resalte. Se manda UN
 *    ancla, no un rango `inicio,fin`: el rango exige que casen los DOS
 *    extremos y, si falla uno, no se resalta nada. Con un ancla sola hay una
 *    cosa que puede fallar en vez de dos. Sobre páginas de verdad los dos
 *    saltaban igual (medido en alzforum y medRxiv el 22 de septiembre de
 *    2026), así que esto es tolerancia, no un arreglo.
 *
 *  Devuelve cadena vacía si no hay a dónde llevar. El fragmento de texto no lo
 *  entienden todos los navegadores: los que no, abren la página por arriba, que
 *  es exactamente lo que hacían antes. */
export function enlaceAlPasaje(ficha: Pick<FichaCita, 'clase' | 'pagina' | 'url' | 'conPdf' | 'afirmacion' | 'fuente'>, urlPdf?: string): string {
  if (ficha.conPdf && urlPdf) {
    const pagina = typeof ficha.pagina === 'number' && ficha.pagina > 0 ? ficha.pagina : null;
    return pagina ? `${urlPdf}${urlPdf.includes('#') ? '&' : '#'}page=${pagina}` : urlPdf;
  }
  const base = ficha.url || (ficha.fuente.doi ? `https://doi.org/${ficha.fuente.doi}` : ficha.fuente.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ficha.fuente.pmid}/` : '');
  if (!base) return '';
  const pasaje = (ficha.afirmacion.pasaje || '').replace(/\s+/g, ' ').trim();
  // Se ancla siempre que haya pasaje con el que señalar algo, también cuando la
  // dirección es un doi que redirige o la página del artículo en PubMed: un
  // pasaje del resumen suele estar en esa página, así que el salto acierta a
  // menudo, y cuando no, la página se abre por arriba, que es lo que hacía
  // antes. No se pierde nada por intentarlo.
  const ancla = anclaEstable(pasaje);
  if (!ancla) return base;
  const limpia = base.split('#')[0]!;
  return `${limpia}#:~:text=${paraFragmento(ancla)}`;
}

/** Cómo se dice en llano de qué se apoya una cita. La primera es la única que
 *  resuelve a página exacta; las demás se nombran sin disimular. */
/** Traduce la etiqueta de presentación, conservando número y nombre exacto
 *  de sección. El localizador que resuelve la cita nunca se modifica. */
export function etiquetaLocalizador(localizador: string): string {
  const pagina = localizador.match(/^pág\. (\d+(?:[–-]\d+)?)$/);
  if (pagina) return trp('pág. {pagina}', { pagina: pagina[1]! });
  const parte = localizador.match(/^texto web, parte (\d+)$/);
  if (parte) return trp('texto web, parte {parte}', { parte: parte[1]! });
  const seccion = localizador.match(/^sección (.+)$/);
  if (seccion) return trp('sección {nombre}', { nombre: seccion[1]! });
  return localizador === 'resumen' ? trc('cita', 'resumen') : localizador;
}

export function enLlanoLaClase(clase: ClaseCita, localizador: string): string {
  const etiqueta = etiquetaLocalizador(localizador);
  switch (clase) {
    case 'pagina':
      return etiqueta;
    case 'seccion':
      return trp("{localizador}, sin número de página", { localizador: etiqueta });
    case 'resumen':
      return tr('resumen, sin número de página');
    case 'web':
      return trp("{localizador}, sin número de página", { localizador: etiqueta });
    default:
      return etiqueta || tr('sin localizador');
  }
}

/** El veredicto en llano y su color, los mismos nombres que usa el verificador. */
export function enLlanoElVeredicto(veredicto: string): { texto: string; tono: 'bien' | 'mal' | 'medio' } {
  switch (veredicto) {
    case 'sostenida':
      return { texto: tr('sostenida'), tono: 'bien' };
    case 'parcial':
      return { texto: tr('parcial'), tono: 'medio' };
    case 'no_sostenida':
      return { texto: tr('no sostenida'), tono: 'mal' };
    case 'cita_no_resuelve':
      return { texto: tr('la cita no resuelve'), tono: 'mal' };
    case 'sin_cita':
      return { texto: tr('sin cita'), tono: 'mal' };
    case 'ausencia_refutada':
      return { texto: tr('ausencia refutada'), tono: 'mal' };
    case 'no_comprobable':
      return { texto: tr('no comprobable'), tono: 'medio' };
    // Las que el juez no llegó a dictaminar: salía tal cual, «sin_verificar».
    case 'sin_verificar':
      return { texto: tr('sin verificar'), tono: 'medio' };
    default:
      return { texto: veredicto || tr('sin veredicto'), tono: 'medio' };
  }
}

/** Lo que hay por recuperar en una investigación (GET
 *  /api/investigaciones/{id}/citas/recuperables, rosa/recuperacion_citas.py). */
export interface CitasRecuperables {
  investigacionId: string;
  /** Bloqueadas por una regla que hoy ya no las bloquearía. */
  bloqueosViejos: number;
  /** Se quedaron sin juez (el juez no dictaminó). */
  sinJuez: number;
  /** Recuperadas que aún no se ofrecieron a las hipótesis. */
  porEnlazar: number;
  /** Corridas trabajando ahora: no se cuentan ni se tocan. */
  corridasVivas: number;
  porCorrida: { corridaId: string; numero: number | null; estado: string; viva: boolean; bloqueosViejos: number | null; sinJuez: number | null; porEnlazar: number | null }[];
}

function cuenta(rec: Record<string, number>, clave: string): number {
  const n = Number(rec?.[clave] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Lo que el juez dijo en una recuperación, en una frase. Las que siguen
 *  bloqueadas por otra regla (la cita no resuelve, sin cita, ausencia
 *  refutada) se cuentan aparte de las que el juez no sostuvo. */
export function recuentoDeRecuperacion(reg: Pick<RecuperacionCitas, 'recuento'>): string {
  const rec = reg.recuento ?? {};
  const siguen = cuenta(rec, 'cita_no_resuelve') + cuenta(rec, 'sin_cita') + cuenta(rec, 'ausencia_refutada');
  const partes = [
    `${formatearEntero(cuenta(rec, 'sostenida'))} sostenidas`,
    `${formatearEntero(cuenta(rec, 'parcial'))} parciales`,
    trp("{v} no sostenidas", { v: formatearEntero(cuenta(rec, 'no_sostenida')) }),
  ];
  if (siguen) partes.push(trp("{siguen} siguen bloqueadas por otra regla", { siguen: formatearEntero(siguen) }));
  if (cuenta(rec, 'sin_verificar')) partes.push(trp("{v} sin juez", { v: formatearEntero(cuenta(rec, 'sin_verificar')) }));
  return partes.join(', ');
}

/** Una línea de avance de la recuperación mientras está pendiente. */
export function avanceDeRecuperacion(reg: RecuperacionCitas): string {
  switch (reg.estado) {
    case 'pedida':
      return tr('Pedida. Empieza en unos segundos y va en segundo plano: puedes seguir usando ROSA2018.');
    case 'en_espera':
      return reg.motivo || tr('Esperando a que pare la corrida que está trabajando en esta investigación.');
    case 'en_curso':
      if (reg.fase === 'enlazar') return trp("Enlazando a las hipótesis lo que salió sostenido: {enlazadas} a {hipotesisConEvidencia} por ahora.", { enlazadas: plural(reg.enlazadas, tr('afirmación'), tr("afirmaciones")), hipotesisConEvidencia: plural(reg.hipotesisConEvidencia.length, tr("hipótesis"), trc("plural", "hipótesis")) });
      if (reg.fase === 'conclusiones') return trp("Rehaciendo las conclusiones de {hipotesisConEvidencia} que ganaron evidencia: {reconcluidas} hechas.", { hipotesisConEvidencia: plural(reg.hipotesisConEvidencia.length, tr("hipótesis"), trc("plural", "hipótesis")), reconcluidas: formatearEntero(reg.reconcluidas.length) });
      return trp("Volviendo a juzgar con el verificador de hoy: {revisadas} de {total} ({reg}). {llamadas} a modelos hasta ahora.", { revisadas: formatearEntero(reg.revisadas), total: formatearEntero(reg.total), reg: recuentoDeRecuperacion(reg), llamadas: plural(reg.llamadas, tr("llamada"), tr("llamadas")) });
    case 'fallida':
      return trp("No terminó: {v}. Lo ya juzgado se conserva; se puede pedir otra vez y sigue donde quedó.", { v: reg.motivo || tr('motivo desconocido') });
    default:
      return '';
  }
}

/** El informe de una recuperación terminada, frase a frase. */
export function informeDeRecuperacion(reg: RecuperacionCitas): string[] {
  const lineas = [`${plural(reg.revisadas, tr('afirmación vuelta a juzgar'), tr('afirmaciones vueltas a juzgar'))}: ${recuentoDeRecuperacion(reg)}.`];
  lineas.push(`${plural(reg.enlazadas, tr('afirmación enlazada'), tr('afirmaciones enlazadas'))} a ${plural(reg.hipotesisConEvidencia.length, tr("hipótesis"), trc("plural", "hipótesis"))}.`);
  if (reg.nacidas.length) lineas.push(trp("{nacidas} como hipótesis al llegar a certeza baja.", { nacidas: plural(reg.nacidas.length, tr('idea del vivero nació'), tr('ideas del vivero nacieron')) }));
  const cambios = reg.reconcluidas.filter((x) => x.antes !== x.despues);
  lineas.push(`${plural(reg.reconcluidas.length, tr('conclusión rehecha'), tr('conclusiones rehechas'))}${cambios.length ? trp(", {cambios} de certeza:", { cambios: plural(cambios.length, tr('cambió'), tr("cambiaron")) }) : tr(', ninguna cambió de certeza.')}`);
  for (const x of cambios) {
    const antes = x.antes ? certezaDe(x.antes).etiqueta.toLowerCase() : tr('sin conclusión');
    const despues = x.despues ? certezaDe(x.despues).etiqueta.toLowerCase() : tr('sin conclusión');
    lineas.push(trp("«{titulo}»: de {antes} a {despues}.", { titulo: x.titulo, antes, despues }));
  }
  for (const n of reg.notas) lineas.push(n);
  lineas.push(trp("Costó {llamadas} a modelos.", { llamadas: plural(reg.llamadas, tr("llamada"), tr("llamadas")) }));
  return lineas;
}
