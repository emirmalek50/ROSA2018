// Logica pura del tablero de calidad: calibracion del revisor frente a las
// decisiones humanas, presupuesto con alarmas y proyeccion, sobreafirmacion,
// evidencia por hipotesis y "significativo pero irrelevante".

import type { Corrida, Fuente, Hipotesis, TipoEstudio } from '../datos/tipos';
import { VEREDICTO } from './etiquetas';
import { tr, trp } from './idioma';

/* ---------------------------------------------------------------------
   Calibracion revisor frente a persona
   --------------------------------------------------------------------- */

export interface Calibracion {
  /** El revisor recomendaba bloquear (hallazgos abiertos o afirmaciones bloqueantes). */
  bloquearYDescartada: number;
  bloquearYAceptada: number;
  pasarYDescartada: number;
  pasarYAceptada: number;
  acuerdo: number | null;
  desacuerdos: { id: string; titulo: string; revisor: 'bloquear' | 'pasar'; humano: 'aceptada' | 'descartada' }[];
}

/** Lo que el revisor habria recomendado para una hipotesis. */
export function recomendacionDelRevisor(h: Pick<Hipotesis, 'hallazgos' | 'afirmaciones'>): 'bloquear' | 'pasar' {
  const abiertos = h.hallazgos.some((x) => x.estado === 'abierto');
  const bloqueantes = h.afirmaciones.some((a) => VEREDICTO[a.veredicto].bloquea);
  return abiertos || bloqueantes ? 'bloquear' : 'pasar';
}

export function calibracion(hipotesis: Hipotesis[]): Calibracion {
  const c: Calibracion = { bloquearYDescartada: 0, bloquearYAceptada: 0, pasarYDescartada: 0, pasarYAceptada: 0, acuerdo: null, desacuerdos: [] };
  for (const h of hipotesis) {
    if (h.estado !== 'aceptada' && h.estado !== 'descartada') continue;
    const r = recomendacionDelRevisor(h);
    if (r === 'bloquear' && h.estado === 'descartada') c.bloquearYDescartada++;
    else if (r === 'bloquear' && h.estado === 'aceptada') {
      c.bloquearYAceptada++;
      c.desacuerdos.push({ id: h.id, titulo: h.titulo, revisor: r, humano: h.estado });
    } else if (r === 'pasar' && h.estado === 'descartada') {
      c.pasarYDescartada++;
      c.desacuerdos.push({ id: h.id, titulo: h.titulo, revisor: r, humano: h.estado });
    } else c.pasarYAceptada++;
  }
  const total = c.bloquearYDescartada + c.bloquearYAceptada + c.pasarYDescartada + c.pasarYAceptada;
  c.acuerdo = total === 0 ? null : (c.bloquearYDescartada + c.pasarYAceptada) / total;
  return c;
}

/* ---------------------------------------------------------------------
   Presupuesto global
   --------------------------------------------------------------------- */

export interface EstadoPresupuesto {
  fraccion: number;
  /** Alertas cruzadas que aun no se avisaron. */
  nuevasAlertas: number[];
  agotado: boolean;
  /** Ms estimados hasta el tope al ritmo actual; null si no se puede estimar. */
  msHastaTope: number | null;
}

export function estadoPresupuesto(c: Pick<Corrida, 'gasto' | 'presupuesto'>, ahoraMs?: number): EstadoPresupuesto {
  const usado = c.gasto.llamadas;
  const limite = c.presupuesto.limiteLlamadas;
  const fraccion = limite > 0 ? usado / limite : 0;
  const nuevasAlertas = c.presupuesto.alertas.filter((a) => fraccion >= a && !c.presupuesto.avisadas.includes(a));
  const agotado = limite > 0 && usado >= limite;
  let msHastaTope: number | null = null;
  if (!agotado && c.gasto.segundos > 0 && usado > 0) {
    const porMs = usado / (c.gasto.segundos * 1000);
    msHastaTope = (limite - usado) / porMs;
  }
  void ahoraMs;
  return { fraccion, nuevasAlertas, agotado, msHastaTope };
}

/* ---------------------------------------------------------------------
   Sobreafirmacion
   --------------------------------------------------------------------- */

const VERBOS_FUERTES = /\b(demuestra|demuestran|establece|establecen|prueba que|prueban que|confirma|confirman|es la causa|es el desencadenante|siempre|nunca|inequivoc\w+|definitiv\w+|sin duda|frenaria)\b/gi;

export interface TramoFuerte {
  inicio: number;
  fin: number;
  texto: string;
}

/** Los tramos con verbos que afirman mas de lo que suele dar la evidencia. */
export function tramosFuertes(texto: string): TramoFuerte[] {
  const salida: TramoFuerte[] = [];
  for (const m of texto.matchAll(VERBOS_FUERTES)) {
    if (m.index === undefined) continue;
    salida.push({ inicio: m.index, fin: m.index + m[0].length, texto: m[0] });
  }
  return salida;
}

/* ---------------------------------------------------------------------
   Evidencia por hipotesis
   --------------------------------------------------------------------- */

const GRUPO: Record<TipoEstudio, 'sistematica' | 'ensayo' | 'observacional' | 'preclinico' | 'otro'> = {
  revision_sistematica: 'sistematica',
  ensayo_aleatorizado: 'ensayo',
  cohorte: 'observacional',
  caso_control: 'observacional',
  transversal: 'observacional',
  serie_de_casos: 'observacional',
  registro: 'otro',
  revision_narrativa: 'otro',
  preclinico: 'preclinico',
  in_vitro: 'preclinico',
  otro: 'otro',
};

/** "sostenida por 2 ensayos, 6 observacionales, 4 preclinicos". */
export function resumenEvidencia(fuentes: Fuente[]): string {
  const n = { sistematica: 0, ensayo: 0, observacional: 0, preclinico: 0, otro: 0 };
  for (const f of fuentes) n[GRUPO[f.tipoEstudio]]++;
  const piezas = [
    n.sistematica > 0 && (n.sistematica === 1 ? trp("{sistematica} revisión sistemática", { sistematica: n.sistematica }) : trp("{sistematica} revisiones sistemáticas", { sistematica: n.sistematica })),
    n.ensayo > 0 && (n.ensayo === 1 ? trp("{ensayo} ensayo aleatorizado", { ensayo: n.ensayo }) : trp("{ensayo} ensayos aleatorizados", { ensayo: n.ensayo })),
    n.observacional > 0 && (n.observacional === 1 ? trp("{observacional} observacional", { observacional: n.observacional }) : trp("{observacional} observacionales", { observacional: n.observacional })),
    n.preclinico > 0 && (n.preclinico === 1 ? trp("{preclinico} preclinico", { preclinico: n.preclinico }) : trp("{preclinico} preclinicos", { preclinico: n.preclinico })),
    n.otro > 0 && (n.otro === 1 ? trp("{otro} otra fuente", { otro: n.otro }) : trp("{otro} otras fuentes", { otro: n.otro })),
  ].filter((p): p is string => typeof p === 'string');
  if (piezas.length === 0) return tr('sin fuentes');
  return trp("sostenida por {v}", { v: piezas.join(', ') });
}

/** Hipotesis con evidencia estadistica fuerte pero relevancia baja: los
 *  "agujeros de conejo" de Kosmos. */
export function agujerosDeConejo(hipotesis: Hipotesis[]): Hipotesis[] {
  return hipotesis.filter((h) => h.evidenciaEstadistica === 'fuerte' && h.relevancia.votoHumano === 'baja');
}

/** Una hipotesis que depende de una fuente retractada o con aviso editorial. */
export function dependeDeRetractada(h: Pick<Hipotesis, 'procedencia'>): Fuente[] {
  return h.procedencia.fuentes.filter((f) => f.retraccion !== null);
}
