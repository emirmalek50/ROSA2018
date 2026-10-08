// Cada escena de la película se lee de un vistazo: una línea con la novedad
// real (qué fuente respondió, qué artículo sirve, qué idea gana) encima del
// detalle. Solo resume datos que ya trae el evento; si no hay cifra, no la pone.
import { tr, trp } from '../../lib/idioma';
import { formatearEntero as ent } from '../../lib/formato';
import type { DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';

const primeraLinea = (t: string) => t.split('\n').map(l => l.trim()).find(Boolean) ?? '';

function enfoque(k: string): string {
  const L: Record<string, string> = { analogia: tr('Analogía'), contradiccion: tr('Contradicción'), mecanismo_opuesto: tr('Mecanismo opuesto'), otra_escala: tr('Otra escala') };
  return L[k] ?? k;
}

export function titularDe(e: EventoVisualLab, d: DatosLab): string {
  const dato = e.dato;
  if (dato?.tipo === 'articulo') {
    return dato.estado === 'incluido' ? trp('✓ Sirve: {t}', { t: dato.titulo })
      : dato.estado === 'excluido' ? trp('✗ No sirve: {t}', { t: dato.titulo })
        : trp('Sin comprobar: {t}', { t: dato.titulo });
  }
  if (dato?.tipo === 'idea') return trp('Idea nueva · {e}: {t}', { e: enfoque(dato.enfoque), t: dato.titulo });
  if (dato?.tipo === 'torneo') {
    return dato.estado === 'a' ? trp('Gana: {t}', { t: dato.tituloA })
      : dato.estado === 'b' ? trp('Gana: {t}', { t: dato.tituloB })
        : dato.estado === 'tablas' ? trp('Empate: {a} y {b}', { a: dato.tituloA, b: dato.tituloB })
          : dato.estado === 'comparando' ? comparan(dato.tituloA, dato.tituloB)
            : tr('Comparación sin resultado');
  }
  if (dato?.tipo === 'analisis') {
    const estados = { programando: tr('Código en preparación'), ejecutando: tr('Ejecutando…'), terminado: tr('Ejecución terminada'), fallido: tr('La ejecución falló'), interpretando: tr('Interpretando el resultado'), auditando: tr('Revisando el análisis') };
    return `${dato.sintetico ? tr('Ensayo sintético') + ' · ' : ''}${estados[dato.estado]}`;
  }
  if (e.tipo === 'plan' && d.pasos.lista.length) {
    const n = d.pasos.lista.length;
    if (d.pasos.aprobado) return n === 1 ? tr('Plan aprobado: 1 paso') : trp('Plan aprobado: {n} pasos', { n: ent(n) });
    return n === 1 ? tr('Plan propuesto: 1 paso') : trp('Plan propuesto: {n} pasos', { n: ent(n) });
  }
  if (e.id.startsWith('fuente-documento:')) return trp('Fuente nueva: {t}', { t: primeraLinea(e.texto) });
  if (e.tipo === 'fuente') {
    const f = d.fuentes.find(f => f.nombre === primeraLinea(e.texto));
    if (f?.salen != null && f.sirven != null) return trp('{f}: {s} de {n} resultados sirven', { f: f.nombre, s: ent(f.sirven), n: ent(f.salen) });
    if (f?.salen != null) return trp('{f}: {n} resultados', { f: f.nombre, n: ent(f.salen) });
    if (f?.fallo) return trp('{f} no responde', { f: f.nombre });
  }
  if (e.tipo === 'lectura') {
    const { resultados, sirven, afirmaciones } = d.lectura, partes: string[] = [];
    if (sirven !== null && resultados !== null) partes.push(trp('{n} de {m} resultados sirven', { n: ent(sirven), m: ent(resultados) }));
    if (afirmaciones !== null) partes.push(trp('{a} afirmaciones van al juez', { a: ent(afirmaciones) }));
    if (partes.length) return partes.join(' · ');
  }
  if (e.id.startsWith('verificacion:')) {
    const { hechas, total, veredictos } = d.juez, partes: string[] = [];
    if (hechas !== null && total !== null) partes.push(hechas < total ? trp('El juez lleva {n} de {m}', { n: ent(hechas), m: ent(total) }) : trp('El juez revisó las {m}', { m: ent(total) }));
    if (veredictos) partes.push(trp('{n} sostenidas', { n: ent(veredictos.sostenida) }));
    if (partes.length) return partes.join(' · ');
  }
  if (e.id.startsWith('afirmacion:')) {
    const [texto, etiqueta] = e.texto.split('\n');
    if (texto && etiqueta) return `${etiqueta}: ${texto}`;
  }
  return primeraLinea(e.texto);
}

export const comparan = (a: string, b: string) => trp('Comparan: {a} frente a {b}', { a, b });
