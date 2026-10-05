import type { EstadoRosa } from './tipos';

type Registro = Record<string, unknown>;
const objeto = (x: unknown): x is Registro => typeof x === 'object' && x !== null && !Array.isArray(x);
const filas = (x: unknown): Registro[] => Array.isArray(x) ? x.filter(objeto) : [];
const texto = (x: unknown): string => typeof x === 'string' ? x : '';
const referencias: Record<string, string> = { investigacionId: 'investigaciones', corridaId: 'corridas', iteracionId: 'iteraciones', hipotesisId: 'hipotesis', planId: 'planesAnalisis', ejecucionId: 'ejecuciones', reproduccionId: 'reproducciones', artefactoId: 'artefactos', hechoId: 'hechos' };

function idsRegistros(e: Registro): Set<string> {
  const registros = Object.values(e).flatMap(filas);
  for (const c of filas(e.corridas)) registros.push(...filas(c._fuentes), ...filas(c._afirmaciones), ...filas(objeto(c.busqueda) ? c.busqueda.fuentes : []));
  for (const i of filas(e.investigaciones)) registros.push(...filas(i.datasets), ...filas(objeto(i.mision) ? i.mision.areas : []));
  return new Set(registros.map(r => texto(r.id)).filter(Boolean));
}
function depende(x: unknown, ids: Set<string>): boolean {
  if (typeof x === 'string') return ids.has(x) || (x.includes(':') && !/\s/.test(x) && ids.has(x.slice(x.indexOf(':') + 1)));
  if (Array.isArray(x)) return x.some(v => depende(v, ids));
  return objeto(x) && Object.entries(x).some(([k, v]) => k !== 'preguntasABases' && depende(v, ids));
}

/** Espejo puro de investigaciones_eliminacion.py. El servidor confirma el
 *  borrado y comprueba además sus tareas reales antes de aplicar el cambio. */
export function eliminarInvestigacion(estado: EstadoRosa, investigacionId: string, quien: string): EstadoRosa {
  const inv = estado.investigaciones.find(i => i.id === investigacionId);
  if (!quien || !inv || estado.investigacionesEliminadas?.includes(investigacionId)) return estado;
  const e = estado as unknown as Registro;
  const retirados: Record<string, Registro[]> = { investigaciones: [inv as unknown as Registro] };
  const ids: Record<string, Set<string>> = { investigaciones: new Set([investigacionId]) };
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const [tabla, lista] of Object.entries(e)) {
      if (tabla.startsWith('_') || tabla === 'investigaciones') continue;
      for (const x of filas(lista)) {
        if (!texto(x.id) || ids[tabla]?.has(texto(x.id))) continue;
        const pertenece = x.investigacionId ? x.investigacionId === investigacionId : Object.entries(referencias).some(([campo, destino]) => ids[destino]?.has(texto(x[campo])));
        if (!pertenece) continue;
        (retirados[tabla] ??= []).push(x);
        (ids[tabla] ??= new Set()).add(texto(x.id));
        cambio = true;
      }
    }
  }
  if (retirados.corridas?.some(c => ['en_marcha', 'esperando_plan', 'esperando_aprobacion', 'esperando_modelo'].includes(texto(c.estado)))) return estado;
  if (['ejecuciones', 'reproducciones'].some(t => retirados[t]?.some(x => x.estado === 'en_curso'))) return estado;
  if (['pedida', 'en_curso', 'en_espera'].includes(inv.recuperacionCitas?.estado ?? '')) return estado;
  if (retirados.hipotesis?.some(h => h._analisisPedido)) return estado;
  const eliminados = idsRegistros(retirados);
  for (const i of [...estado.investigaciones, ...(estado.asistenteGlobal ? [estado.asistenteGlobal] : [])]) {
    for (const q of i.preguntasABases ?? []) for (const op of q.acciones ?? []) {
      if ((op.estado === 'en_curso' || ['pendiente', 'en_curso'].includes(op.continuacion ?? '')) && (i.id === investigacionId || depende(op.argumentos, eliminados))) return estado;
    }
  }
  const conservadas = estado.investigaciones.filter(i => i.id !== investigacionId);
  const afectados = new Set(inv.datasets.map(d => d.registroProgramaId));
  const datasets = (estado.datasetsPrograma ?? []).map(d => {
    if (!d.usadoEn.includes(investigacionId) && !afectados.has(d.id)) return d;
    afectados.add(d.id);
    return { ...d, usadoEn: [...new Set([...d.usadoEn.filter(id => id !== investigacionId), ...conservadas.filter(i => i.datasets.some(ds => ds.registroProgramaId === d.id)).map(i => i.id)])].sort() };
  }).filter(d => !afectados.has(d.id) || d.fuente !== 'manual' || d.usadoEn.length);
  const siguiente: Registro = { ...e, datasetsPrograma: datasets };
  for (const [tabla, registros] of Object.entries(retirados)) {
    const borrar = new Set(registros.map(r => r.id));
    siguiente[tabla] = (e[tabla] as unknown[]).filter(r => !objeto(r) || !borrar.has(r.id));
  }
  const supervivientes = Object.fromEntries(Object.entries(siguiente).filter(([k]) => !k.startsWith('_') && !['asistenteGlobal', 'investigacionesEliminadas'].includes(k)));
  const conservados = idsRegistros(supervivientes);
  const perdidos = new Set([...eliminados].filter(id => !conservados.has(id)));
  if (Object.values(supervivientes).some(v => depende(v, perdidos))) return estado;
  siguiente.investigacionesEliminadas = [...(estado.investigacionesEliminadas ?? []), investigacionId];
  return siguiente as unknown as EstadoRosa;
}
