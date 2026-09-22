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
}

export interface ResumenCitas {
  total: number;
  porVeredicto: Record<string, number>;
  porClase: Record<string, number>;
  conPagina: number;
  conPdf: number;
}

export interface ListaCitas {
  corridaId: string;
  resumen: ResumenCitas;
  afirmaciones: AfirmacionCitada[];
}

export interface FichaCita {
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
