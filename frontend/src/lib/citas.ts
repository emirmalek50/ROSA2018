// El visor de citas: los tipos que devuelve el servidor y el reparto del texto
// de la página en trozos resaltados y sin resaltar.
//
// El backend (rosa/citas.py) dice DÓNDE está el pasaje dentro de la página,
// como pares de posiciones sobre el texto original. Aquí solo se corta el
// texto por esas posiciones, que es lo que necesita el navegador para pintar
// unos trozos dentro de una marca y el resto fuera. Se hace en un módulo
// aparte y probado porque un corte mal hecho desplazaría el resaltado, y un
// resaltado que señala la frase de al lado es peor que no resaltar nada.

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
  /** El veredicto guardado bloquea, pero hoy la cita resuelve y es literal. */
  bloqueoViejo: boolean;
}

export interface ResumenCitas {
  total: number;
  porVeredicto: Record<string, number>;
  porClase: Record<string, number>;
  conPagina: number;
  conPdf: number;
  bloqueosViejos: number;
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
export const SIN_COMPROBAR: ComprobacionDeHoy = { resuelve: false, motivoResuelve: 'Este servidor todavía no comprueba la cita al abrir la ficha.', literal: false, falta: null, localizadorAdmitido: false, disponible: false };

/** Las señales de una respuesta, con su respaldo si no vienen. */
export function senalesDe(hoy: ComprobacionDeHoy | undefined | null): ComprobacionDeHoy {
  if (!hoy || typeof hoy !== 'object') return SIN_COMPROBAR;
  return {
    resuelve: Boolean(hoy.resuelve),
    motivoResuelve: typeof hoy.motivoResuelve === 'string' ? hoy.motivoResuelve : '',
    literal: Boolean(hoy.literal),
    falta: typeof hoy.falta === 'string' ? hoy.falta : null,
    localizadorAdmitido: Boolean(hoy.localizadorAdmitido),
    disponible: true,
  };
}

/** Cuántas palabras de cada extremo del pasaje se usan para señalarlo en la
 *  página web. Pocas no distinguen entre dos frases parecidas; demasiadas
 *  fallan en cuanto la web difiere en una coma del texto que se guardó. */
const PALABRAS_DE_ANCLA = 6;

/** Escapa un trozo para un fragmento de texto: además de lo normal, la coma y
 *  el guion tienen significado propio en esa sintaxis. */
function paraFragmento(trozo: string): string {
  return encodeURIComponent(trozo.trim()).replace(/-/g, '%2D').replace(/,/g, '%2C');
}

/** Un enlace que lleva AL TEXTO, no solo al documento.
 *
 *  - En un PDF, la página va en el ancla (`#page=N`): es la convención que
 *    entienden los visores de PDF de los navegadores desde hace años.
 *  - En una página web, se usa un FRAGMENTO DE TEXTO (`#:~:text=`), que hace
 *    que el navegador baje solo hasta el pasaje y lo resalte. Con pasajes
 *    largos se dan los dos extremos separados por coma, que es como se
 *    señala un rango; con uno corto, el pasaje entero.
 *
 *  Devuelve cadena vacía si no hay a dónde llevar. El fragmento de texto no lo
 *  entienden todos los navegadores: los que no, abren la página por arriba, que
 *  es exactamente lo que hacían antes. */
export function enlaceAlPasaje(ficha: Pick<FichaCita, 'clase' | 'pagina' | 'url' | 'conPdf' | 'afirmacion' | 'fuente'>, urlPdf?: string): string {
  if (ficha.conPdf && urlPdf) {
    const pagina = typeof ficha.pagina === 'number' && ficha.pagina > 0 ? ficha.pagina : null;
    return pagina ? `${urlPdf}${urlPdf.includes('#') ? '' : '#'}page=${pagina}` : urlPdf;
  }
  const base = ficha.url || (ficha.fuente.doi ? `https://doi.org/${ficha.fuente.doi}` : ficha.fuente.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ficha.fuente.pmid}/` : '');
  if (!base) return '';
  const pasaje = (ficha.afirmacion.pasaje || '').replace(/\s+/g, ' ').trim();
  // Solo se ancla cuando la fuente trae su propia dirección (la que se leyó) y
  // el pasaje da para señalar algo. Muchas de esas direcciones son un doi.org,
  // que redirige: el ancla sobrevive al salto en los navegadores que la
  // entienden, y donde no, la página se abre por arriba, que es lo que hacía
  // antes. Lo que nunca se hace es anclar a una dirección que ROSA2018 no leyó.
  const palabras = pasaje.split(' ').filter(Boolean);
  if (!ficha.url || palabras.length < 3) return base;
  const limpia = base.split('#')[0]!;
  if (palabras.length <= PALABRAS_DE_ANCLA * 2) return `${limpia}#:~:text=${paraFragmento(palabras.join(' '))}`;
  const inicio = palabras.slice(0, PALABRAS_DE_ANCLA).join(' ');
  const fin = palabras.slice(-PALABRAS_DE_ANCLA).join(' ');
  return `${limpia}#:~:text=${paraFragmento(inicio)},${paraFragmento(fin)}`;
}

/** Cómo se dice en llano de qué se apoya una cita. La primera es la única que
 *  resuelve a página exacta; las demás se nombran sin disimular. */
export function enLlanoLaClase(clase: ClaseCita, localizador: string): string {
  switch (clase) {
    case 'pagina':
      return localizador;
    case 'seccion':
      return `${localizador}, sin número de página`;
    case 'resumen':
      return 'resumen, sin número de página';
    case 'web':
      return `${localizador}, sin número de página`;
    default:
      return localizador || 'sin localizador';
  }
}

/** El veredicto en llano y su color, los mismos nombres que usa el verificador. */
export function enLlanoElVeredicto(veredicto: string): { texto: string; tono: 'bien' | 'mal' | 'medio' } {
  switch (veredicto) {
    case 'sostenida':
      return { texto: 'sostenida', tono: 'bien' };
    case 'parcial':
      return { texto: 'parcial', tono: 'medio' };
    case 'no_sostenida':
      return { texto: 'no sostenida', tono: 'mal' };
    case 'cita_no_resuelve':
      return { texto: 'la cita no resuelve', tono: 'mal' };
    case 'sin_cita':
      return { texto: 'sin cita', tono: 'mal' };
    case 'ausencia_refutada':
      return { texto: 'ausencia refutada', tono: 'mal' };
    case 'no_comprobable':
      return { texto: 'no comprobable', tono: 'medio' };
    default:
      return { texto: veredicto || 'sin veredicto', tono: 'medio' };
  }
}
