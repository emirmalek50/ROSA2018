import type { DatosLab } from '../../lib/labVivo';
import { eventoLabValido, type EventoVisualLab } from '../../lib/peliculaLab';

export const MAX_ESCENAS_APERTURA = 8;
const SALAS = new Set(['plan', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
const TIPOS = new Set(['plan', 'fuente', 'lectura', 'extraccion', 'filtro', 'evidencia', 'idea', 'revision', 'torneo', 'analisis', 'cierre']);
const texto = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const cifra = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
function valido(v: unknown): v is EventoVisualLab {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Partial<EventoVisualLab>;
  return texto(e.id) && texto(e.texto) && SALAS.has(e.sala ?? '') && TIPOS.has(e.tipo ?? '')
    && Array.isArray(e.agentes) && e.agentes.length > 0 && e.agentes.every(texto)
    && (e.dato === undefined || eventoLabValido(e.dato))
    && !(e.dato?.tipo === 'torneo' && e.dato.porRegla);
}
/** Mismas entidades que la cola: devolver una versión anterior sería rechazado
 *  o reviviría una fase ya sustituida. Un par conserva sus entradas independientes. */
function entidad(e: EventoVisualLab): string {
  const d = e.dato;
  if (d?.tipo === 'idea') return `idea:${d.hipotesisId}`;
  if (d?.tipo === 'articulo') return `articulo:${d.id}:${d.modo}`;
  if (d?.tipo === 'analisis') return `analisis:${d.ejecucionId}`;
  if (d?.tipo === 'torneo') return `entrada:${e.id}`;
  if (/^(?:plan|fuente|fuente-documento|lectura|afirmacion|verificacion):/.test(e.id)) return `entidad:${e.id}`;
  return JSON.stringify(['contexto', e.sala, e.tipo, [...e.agentes].sort()]);
}
function calidad(e: EventoVisualLab): number {
  if (/^(?:lectura|verificacion):/.test(e.id)) return 5;
  if (e.dato) return 4;
  if (/^(?:Fuente\s+\d.*\sde\s\d|Juez:\s*\d|\d+ fuentes, \d+ afirmaciones)/.test(e.texto)) return 3;
  if (/^(?:Comprobaciones deterministas|Índice semántico|Deterministas:|Leyendo el modelo de mundo|Preparando la llamada|programas\.)/.test(e.texto)) return 0;
  return 2;
}

/** Al abrir, enseña una muestra acotada de resultados reales y el trabajo actual.
 *  No sintetiza eventos, modifica sus actores ni reproduce todo el histórico. */
export function escenasDeApertura(datos: DatosLab): EventoVisualLab[] {
  if (!datos || typeof datos !== 'object' || datos.estado !== 'en_marcha' || datos.conexion !== 'en_linea' || datos.trabajando !== true || datos.pasada
    || !Number.isInteger(datos.iteracion) || (datos.iteracion ?? 0) < 1 || !texto(datos.identidad)
    || !Array.isArray(datos.pelicula?.eventos)) return [];
  const identidad = datos.identidad.split('/');
  if (identidad.length !== 2 || !identidad.every(texto)) return [];
  const iteracionId = identidad[1]!;
  const porId = new Map<string, { e: EventoVisualLab; indice: number }>();
  datos.pelicula.eventos.forEach((e, indice) => {
    if (!valido(e)) return;
    const local = /^(?:plan|fuente|fuente-documento|lectura|afirmacion|verificacion):([^:]+):?/.exec(e.id);
    if (local && local[1] !== iteracionId) return;
    porId.set(e.id, { e, indice });
  });
  const versiones = [...porId.values()].sort((a, b) => a.indice - b.indice);
  const ultimas = new Map<string, typeof versiones[number]>();
  versiones.forEach(v => ultimas.set(entidad(v.e), v));
  const vigentes = [...ultimas.values()].sort((a, b) => a.indice - b.indice);
  const analisis = [...vigentes].reverse().find(v => v.e.dato?.tipo === 'analisis');
  const candidatas = vigentes.filter(v => v.e.dato?.tipo !== 'analisis' || v === analisis);
  const escenas: EventoVisualLab[] = [], ids = new Set<string>();
  const agregar = (e: EventoVisualLab | undefined) => {
    if (!e || ids.has(e.id) || escenas.length >= MAX_ESCENAS_APERTURA) return;
    ids.add(e.id); escenas.push(e);
  };
  const ultima = (cumple: (e: EventoVisualLab) => boolean) => [...candidatas].reverse().find(v => cumple(v.e))?.e;
  // Un progreso agregado tiene más valor que la última nota de implementación.
  // Solo seleccionamos versiones vigentes para respetar la guardia de la cola.
  const activos = new Set(Array.isArray(datos.activos) ? datos.activos.filter(texto) : []);
  const trabajo = candidatas.filter(v => v.e.agentes.some(a => activos.has(a)));
  const porSala = new Map<string, typeof versiones[number]>();
  trabajo.forEach(v => {
    const anterior = porSala.get(v.e.sala);
    if (!anterior || calidad(v.e) > calidad(anterior.e) || (calidad(v.e) === calidad(anterior.e) && v.indice > anterior.indice)) porSala.set(v.e.sala, v);
  });
  [...porSala.values()].sort((a, b) => b.indice - a.indice).forEach(v => agregar(v.e));
  if (Array.isArray(datos.pasos?.lista) && datos.pasos.lista.some(p => p && texto(p.titulo))) agregar(ultima(e => e.tipo === 'plan' && e.id === `plan:${iteracionId}`));
  const fuentes = Array.isArray(datos.fuentes) ? datos.fuentes : [];
  agregar(ultima(e => e.tipo === 'fuente' && fuentes.some(f => f && e.id === `fuente:${iteracionId}:${f.nombre}` && (cifra(f.salen) || cifra(f.sirven)))));
  agregar(ultima(e => e.dato?.tipo === 'articulo'));
  if (datos.lectura && Object.values(datos.lectura).some(cifra)) agregar(ultima(e => e.tipo === 'lectura' && e.id === `lectura:${iteracionId}`));
  if (datos.juez && (cifra(datos.juez.hechas) || cifra(datos.juez.sinJuez) || datos.juez.veredictos)) agregar(ultima(e => e.id === `verificacion:${iteracionId}`));
  // El tablón ya conserva todas las tarjetas. La apertura solo clava la última
  // idea y enseña una escena reciente de cada sala restante, sin centenares de pasos.
  for (const sala of ['r3', 'r4', 'r5', 'r6', 'r7']) agregar(ultima(e => e.sala === sala && calidad(e) > 0));
  return escenas;
}
