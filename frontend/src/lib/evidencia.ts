// La cadena de trazabilidad de una corrida, tal como la sirve el servidor en
// GET /api/corridas/{id}/evidencia, y la funcion pura que la convierte en el
// arbol que pinta la pantalla: consulta -> fuentes -> afirmaciones con su
// veredicto. Sin React, para poder probarla sola.

import type { ProcedenciaVeredictoLab, TipoAfirmacion, TipoFuente, Veredicto } from '../datos/tipos';
import { VEREDICTO } from './etiquetas';

export interface ConsultaEvidencia {
  base: string;
  consulta: string;
  fecha: number;
  resultados: number;
  iteracion?: number;
  tema?: string;
  /** foco o amplitud; ausente en consultas anteriores al 16 de septiembre de 2026. */
  modo?: 'foco' | 'amplitud';
  porque?: string;
}

export interface FuenteEvidencia {
  id: string;
  referencia: string;
  titulo: string;
  /** foco o amplitud; y en amplitud, por qué se conservó. */
  modo?: 'foco' | 'amplitud';
  porque?: string;
  tipo: TipoFuente;
  doi: string | null;
  pmid: string | null;
  nct: string | null;
  anio: number | null;
  tipoEstudio: string | null;
  relevancia: number;
  retraccion: 'retractado' | 'preocupacion' | 'erratum' | null;
  retraccionDetalle: string;
  textoCompleto: boolean;
  fragmentos: number;
  extraida: boolean;
  iteracion: number;
  /** Cadenas exactas de las consultas que la trajeron (vacio en corridas antiguas). */
  consultas: string[];
  riesgoSesgo?: { instrumento: string; global: string; dominios: { id: string; nombre: string; juicio: string }[] } | null;
}

export interface AfirmacionEvidencia {
  id: string;
  texto: string;
  cita: string;
  veredicto: Veredicto;
  motivo: string;
  /** Procedencia declarada al verificar. Ausente significa desconocida. */
  procedenciaVeredicto?: ProcedenciaVeredictoLab;
  entidadDistinta: boolean;
  tipo: TipoAfirmacion;
  tema: string;
  fuenteId: string;
  localizador: string;
  iteracion: number;
}

export interface Evidencia {
  corridaId: string;
  version: number;
  consultas: ConsultaEvidencia[];
  fuentes: FuenteEvidencia[];
  afirmaciones: AfirmacionEvidencia[];
}

export interface NodoFuente {
  fuente: FuenteEvidencia;
  afirmaciones: AfirmacionEvidencia[];
  /** Otras consultas que tambien la trajeron, si hubo mas de una. */
  tambienEn: number[];
}

export interface NodoConsulta {
  /** Indice 1-based dentro de la iteracion; 0 para el grupo sin consulta. */
  numero: number;
  consulta: ConsultaEvidencia | null;
  fuentes: NodoFuente[];
}

export interface Embudo {
  consultas: number;
  identificados: number;
  fuentes: number;
  textoCompleto: number;
  afirmaciones: number;
  sostenidas: number;
  parciales: number;
  bloqueadas: number;
  sinVerificar: number;
}

export type FiltroVeredicto = 'todas' | 'bloqueadas' | 'sostenidas' | 'sin_verificar';

export function iteracionesDe(ev: Evidencia): number[] {
  const set = new Set<number>();
  for (const c of ev.consultas) if (c.iteracion) set.add(c.iteracion);
  for (const f of ev.fuentes) set.add(f.iteracion);
  for (const a of ev.afirmaciones) set.add(a.iteracion);
  return [...set].filter((n) => n > 0).sort((a, b) => a - b);
}

function pasaFiltro(a: AfirmacionEvidencia, filtro: FiltroVeredicto, tipo: TipoAfirmacion | 'todos'): boolean {
  if (tipo !== 'todos' && a.tipo !== tipo) return false;
  if (filtro === 'bloqueadas') return VEREDICTO[a.veredicto].bloquea;
  if (filtro === 'sostenidas') return a.veredicto === 'sostenida' || a.veredicto === 'parcial';
  if (filtro === 'sin_verificar') return a.veredicto === 'sin_verificar';
  return true;
}

/**
 * El arbol de una iteracion. Una fuente cuelga de la primera consulta que la
 * trajo (y anota las demas); las fuentes sin consulta registrada (ensayos,
 * corridas anteriores a esta vista) van en un grupo aparte al final. Las
 * afirmaciones cuelgan de su fuente. Con filtro, las fuentes sin ninguna
 * afirmacion que pase se quedan pero vacias, para que el embudo no mienta.
 */
export function construirArbol(ev: Evidencia, iteracion: number, filtro: FiltroVeredicto = 'todas', tipo: TipoAfirmacion | 'todos' = 'todos'): { nodos: NodoConsulta[]; embudo: Embudo } {
  const consultas = ev.consultas.filter((c) => (c.iteracion ?? 0) === iteracion);
  const fuentes = ev.fuentes.filter((f) => f.iteracion === iteracion);
  const afirmaciones = ev.afirmaciones.filter((a) => a.iteracion === iteracion);
  const porFuente = new Map<string, AfirmacionEvidencia[]>();
  for (const a of afirmaciones) {
    if (!pasaFiltro(a, filtro, tipo)) continue;
    const lista = porFuente.get(a.fuenteId) ?? [];
    lista.push(a);
    porFuente.set(a.fuenteId, lista);
  }
  const indice = new Map<string, number>();
  consultas.forEach((c, i) => indice.set(c.consulta, i + 1));

  const nodos: NodoConsulta[] = consultas.map((c, i) => ({ numero: i + 1, consulta: c, fuentes: [] }));
  const sueltas: NodoFuente[] = [];
  for (const f of fuentes) {
    const numeros = f.consultas.map((q) => indice.get(q)).filter((n): n is number => n !== undefined);
    const nodo: NodoFuente = { fuente: f, afirmaciones: porFuente.get(f.id) ?? [], tambienEn: numeros.slice(1) };
    const primero = numeros[0];
    if (primero === undefined) sueltas.push(nodo);
    else nodos[primero - 1]!.fuentes.push(nodo);
  }
  for (const n of nodos) n.fuentes.sort((a, b) => b.fuente.relevancia - a.fuente.relevancia);
  if (sueltas.length > 0) nodos.push({ numero: 0, consulta: null, fuentes: sueltas.sort((a, b) => b.fuente.relevancia - a.fuente.relevancia) });

  const embudo: Embudo = {
    consultas: consultas.length,
    identificados: consultas.reduce((s, c) => s + c.resultados, 0),
    fuentes: fuentes.length,
    textoCompleto: fuentes.filter((f) => f.textoCompleto).length,
    afirmaciones: afirmaciones.length,
    sostenidas: afirmaciones.filter((a) => a.veredicto === 'sostenida').length,
    parciales: afirmaciones.filter((a) => a.veredicto === 'parcial').length,
    bloqueadas: afirmaciones.filter((a) => VEREDICTO[a.veredicto].bloquea).length,
    sinVerificar: afirmaciones.filter((a) => a.veredicto === 'sin_verificar').length,
  };
  return { nodos, embudo };
}

/** Enlace externo a la fuente, por orden de preferencia: DOI, PMID, NCT. */
export function enlaceDe(f: FuenteEvidencia): string | null {
  if (f.doi) return `https://doi.org/${f.doi}`;
  if (f.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${f.pmid}/`;
  if (f.nct) return `https://clinicaltrials.gov/study/${f.nct}`;
  return null;
}
