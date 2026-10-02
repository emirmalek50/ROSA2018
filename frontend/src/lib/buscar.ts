// Busqueda global (Cmd+K): hipotesis, hechos, fuentes, artefactos,
// iteraciones y eventos de una investigacion, por texto. Sin indice: para el
// tamano de una investigacion, recorrer las listas es instantaneo.

import type { EstadoRosa } from '../datos/tipos';
import { rutaDe } from './ruta';
import { trp } from './idioma';

export interface Resultado {
  tipo: 'hipotesis' | 'hecho' | 'fuente' | 'artefacto' | 'iteracion' | 'evento';
  titulo: string;
  detalle: string;
  ruta: string;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function buscar(estado: EstadoRosa, investigacionId: string, consulta: string, maximo = 20): Resultado[] {
  const q = normalizar(consulta.trim());
  if (q.length < 2) return [];
  const casa = (...campos: (string | null | undefined)[]) => campos.some((c) => c && normalizar(c).includes(q));
  const salida: Resultado[] = [];

  for (const h of estado.hipotesis) {
    if (h.investigacionId !== investigacionId) continue;
    if (casa(h.titulo, h.enunciado, h.mecanismo, h.cluster)) salida.push({ tipo: 'hipotesis', titulo: h.titulo, detalle: `Elo ${h.elo}`, ruta: rutaDe(investigacionId, 'hipotesis', h.id) });
    for (const f of h.procedencia.fuentes) {
      if (casa(f.referencia, f.titulo, f.doi, f.pmid, f.nct)) salida.push({ tipo: 'fuente', titulo: f.referencia, detalle: f.titulo, ruta: rutaDe(investigacionId, 'hipotesis', h.id) });
    }
  }
  for (const he of estado.hechos) {
    if (he.investigacionId === investigacionId && casa(he.enunciado, he.tema, he.motivoDescarte)) salida.push({ tipo: 'hecho', titulo: he.enunciado, detalle: he.tema, ruta: rutaDe(investigacionId, 'mundo') });
  }
  for (const a of estado.artefactos) {
    if (a.investigacionId === investigacionId && casa(a.nombre, ...a.versiones.map((v) => v.contenido))) salida.push({ tipo: 'artefacto', titulo: a.nombre, detalle: a.versiones[a.versiones.length - 1]?.resumen ?? '', ruta: rutaDe(investigacionId, 'artefactos', a.id) });
  }
  const corridas = estado.corridas.filter((c) => c.investigacionId === investigacionId).map((c) => c.id);
  for (const it of estado.iteraciones) {
    if (corridas.includes(it.corridaId) && casa(it.resumen, ...it.plan.map((p) => p.titulo + ' ' + p.detalle), ...it.pistas.map((p) => p.titulo))) {
      salida.push({ tipo: 'iteracion', titulo: trp("Iteración {numero}", { numero: it.numero }), detalle: it.resumen || 'en curso', ruta: rutaDe(investigacionId, 'corrida') });
    }
  }
  for (const e of estado.eventos) {
    if (e.investigacionId === investigacionId && casa(e.texto)) salida.push({ tipo: 'evento', titulo: e.texto, detalle: '', ruta: e.ruta ?? rutaDe(investigacionId, 'corrida') });
  }
  // Sin duplicados por ruta y titulo.
  const vistos = new Set<string>();
  return salida.filter((r) => {
    const k = `${r.tipo}|${r.titulo}|${r.ruta}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).slice(0, maximo);
}
