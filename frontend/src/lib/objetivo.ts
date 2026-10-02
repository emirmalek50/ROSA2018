// El objetivo de una investigacion: avisos sobre como esta escrito (las
// reglas que publica Edison para Kosmos), una propuesta de configuracion
// (preferencias, atributos, restricciones, como la "research plan
// configuration" de Co-Scientist) y tres parafrasis para ver, antes de
// gastar, que primeras tareas propondria ROSA2018 con cada redaccion.
//
// Todo es heuristico y local: cuando ROSA2018 este conectada, la propuesta la
// hara el cerebro del bucle con el mismo contrato de salida.

import type { ConfiguracionObjetivo } from '../datos/tipos';
import { tr, trp } from './idioma';

export interface AvisoObjetivo {
  tipo: 'corto' | 'varios_objetivos' | 'respuesta_obvia' | 'sin_contexto' | 'sin_comprobacion' | 'sin_parada' | 'parada_no_medible';
  texto: string;
}

const TERMINOS_DOMINIO = /biomarcador|cohorte|mecanismo|diana|gen|proteina|ensayo|progresion|plasma|liquido cefalorraquideo|lcr|pet|microglia|tau|amiloide|apoe|trem2|nfl|gfap|p-tau|hipotesis/i;
const PREGUNTA_LISTA = /^(lista|enumera|cuales son|que genes|que tejidos|dame)/i;

export function avisosDelObjetivo(objetivo: string, condicionParada: string): AvisoObjetivo[] {
  const o = objetivo.trim();
  const avisos: AvisoObjetivo[] = [];
  if (o.length < 80) avisos.push({ tipo: 'corto', texto: tr('El objetivo es muy corto. ROSA2018 va a perseguir lo primero que parezca significativo: di que enfermedad, que subgrupo y que tipo de hallazgo buscas.') });
  const oraciones = o.split(/[.;]\s+/).filter((s) => s.trim().length > 0);
  const conectores = (o.match(/\by (?:tambien|ademas)\b|\bpor otro lado\b/gi) ?? []).length;
  if (oraciones.length > 4 || conectores >= 2) avisos.push({ tipo: 'varios_objetivos', texto: tr('Parece haber más de un objetivo. Edison recomienda uno solo por corrida: con varios, la búsqueda se reparte y ninguno converge. Considera una investigación por objetivo, o una rama.') });
  if (PREGUNTA_LISTA.test(o)) avisos.push({ tipo: 'respuesta_obvia', texto: tr('Empieza como una pregunta de lista ("lista", "cuales son"). Eso lo responde una búsqueda, no una investigación de días: pide una hipótesis o un mecanismo, no un inventario.') });
  if (!TERMINOS_DOMINIO.test(o)) avisos.push({ tipo: 'sin_contexto', texto: tr('No aparece ningún término del campo (biomarcador, cohorte, mecanismo, diana, gen). Sin contexto experimental y supuestos del campo, las direcciones que salgan serán genéricas.') });
  if (!/comprob|cohorte|medir|biomarcador|ensayo|validar/i.test(o)) avisos.push({ tipo: 'sin_comprobacion', texto: tr('No dice como se comprobaría un resultado. el investigador clínico principal necesita el biomarcador o la cohorte: pidelo en el objetivo para que toda hipótesis lo traiga.') });
  if (condicionParada.trim() === '') avisos.push({ tipo: 'sin_parada', texto: tr('Sin condición de parada la corrida no sabe cuando terminar y gasta hasta el tope.') });
  else if (!paradaMedible(condicionParada)) avisos.push({ tipo: 'parada_no_medible', texto: tr('ROSA2018 solo para sola por una cifra: "N iteraciones", "N minutos", "N horas" o "N llamadas" (con número, no con letras). Lo demás lo decides tu con el botón Detener; añade una cifra si quieres que pare sin ti.') });
  return avisos;
}

/** Lo que el bucle sabe comprobar solo: iteraciones, tiempo o llamadas con
 *  un numero delante. Es la misma regla que `_condicion_de_parada` en el
 *  servidor. */
export function paradaMedible(condicionParada: string): boolean {
  return /\d+\s*(iteraci|min\b|minuto|hora|h\b|dia|día|llamadas)/i.test(condicionParada);
}

/** Una propuesta de configuracion a partir del texto. Heuristica: extrae
 *  restricciones de frases con "sin", "solo" y "no"; atributos de palabras
 *  clave; preferencias del resto. */
export function proponerConfiguracion(objetivo: string, relevancia: string, limites: string[]): ConfiguracionObjetivo {
  const o = objetivo.trim();
  const restricciones = new Set<string>();
  for (const l of limites) if (l.trim() !== '') restricciones.add(l.trim());
  for (const m of o.matchAll(/\b(?:sin|solo|unicamente|excluyendo|no)\b[^.;,]{4,80}/gi)) {
    const t = m[0].trim();
    if (t.length > 8) restricciones.add(t.charAt(0).toUpperCase() + t.slice(1));
  }
  const atributos = new Set<string>();
  if (/novedad|nuevo|nueva|inedit/i.test(o) || true) atributos.add('Novedad frente a Open Targets, ClinicalTrials.gov, Agora y la literatura');
  if (/biomarcador|plasma|sangre|lcr|liquido cefalorraquideo/i.test(o)) atributos.add('Testabilidad con un biomarcador medible');
  if (/cohorte|longitudinal|seguimiento|progresion/i.test(o)) atributos.add('Comprobable en una cohorte longitudinal');
  if (/mecanismo|via|microglia|inflam/i.test(o)) atributos.add('Mecanismo explícito con diana');
  if (/latinoamerica|dominican|argentin|fleni|antioquia|temprano|bajo coste|acceso/i.test(o)) atributos.add('Relevancia para diagnóstico temprano y accesible en Latinoamérica');
  const preferencias = [relevancia.trim(), o].filter((s) => s !== '').join(' ').slice(0, 400);
  return { preferencias, atributos: [...atributos], restricciones: [...restricciones] };
}

export interface Parafrasis {
  redaccion: string;
  primerasTareas: string[];
}

/** Tres redacciones del mismo objetivo y las primeras tareas que cada una
 *  sugiere, para ver la sensibilidad al fraseo antes de gastar. */
export function parafrasis(objetivo: string): Parafrasis[] {
  const o = objetivo.trim().replace(/\.$/, '');
  if (o === '') return [];
  return [
    {
      redaccion: trp("{o}. Prioriza mecanismos con una diana y di con que biomarcador se comprobaria cada uno.", { o }),
      primerasTareas: [tr('Buscar mecanismos y dianas en Open Targets y Agora'), tr('Leer revisiones recientes de neuroinflamación y genética'), tr('Proponer 3 hipótesis mecanísticas con biomarcador')],
    },
    {
      redaccion: trp("{o}. Prioriza asociaciones biomarcador-progresión en cohortes longitudinales, y distingue Alzheimer familiar de esporadico.", { o }),
      primerasTareas: [tr('Buscar cohortes longitudinales con biomarcadores plasmáticos seriados'), tr('Comparar familiar frente a esporádico en la literatura'), tr('Proponer 3 hipótesis de anticipación con umbrales')],
    },
    {
      redaccion: trp("{o}. Prioriza candidatos a reposicionamiento con un biomarcador de respuesta, y comprueba primero si ya están en ensayo.", { o }),
      primerasTareas: [tr('Consultar ClinicalTrials.gov por fármacos en fase 2 y 3'), tr('Buscar biomarcadores de respuesta en esos ensayos'), tr('Descartar lo que ya tiene ensayo con ese desenlace')],
    },
  ];
}
