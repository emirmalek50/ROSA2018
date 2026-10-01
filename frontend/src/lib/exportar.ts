// Exportaciones: referencias en BibTeX, RIS y CSV; el expediente de una
// hipotesis; la pagina de Specific Aims. Todo texto plano generado aqui, sin
// dependencias, para que un test lo compruebe caracter a caracter.

import type { Fuente, Hipotesis, HechoMundo, Investigacion } from '../datos/tipos';
import { VEREDICTO } from './etiquetas';
import { tr } from './idioma';

function claveBib(f: Fuente): string {
  const autor = f.referencia.split(/[ ,]/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'fuente';
  return `${autor}${f.anio ?? ''}${f.id.slice(-4)}`;
}

function limpiar(s: string): string {
  return s.replace(/[{}]/g, '');
}

export function aBibtex(fuentes: Fuente[]): string {
  return fuentes
    .map((f) => {
      const tipo = f.tipo === 'ensayo' || f.tipo === 'base_curada' ? 'misc' : 'article';
      const campos: string[] = [`  title = {${limpiar(f.titulo)}}`, `  author = {${limpiar(f.referencia.replace(/,?\s*\d{4}$/, ''))}}`];
      if (f.anio !== null) campos.push(`  year = {${f.anio}}`);
      if (f.doi) campos.push(`  doi = {${f.doi}}`);
      if (f.pmid) campos.push(`  note = {${f.pmid}}`);
      if (f.nct) campos.push(`  howpublished = {ClinicalTrials.gov ${f.nct}}`);
      if (f.pagina !== null) campos.push(`  pages = {${f.pagina}}`);
      campos.push(`  annote = {ROSA2018: ${f.retraccion ? 'RETRACTADO. ' : ''}${f.textoCompleto ? tr('texto completo') : tr('solo resumen')}; tipo de estudio ${f.tipoEstudio}}`);
      return `@${tipo}{${claveBib(f)},\n${campos.join(',\n')}\n}`;
    })
    .join('\n\n');
}

export function aRis(fuentes: Fuente[]): string {
  return fuentes
    .map((f) => {
      const lineas = [`TY  - ${f.tipo === 'ensayo' ? 'DATA' : f.tipo === 'preprint' ? 'UNPB' : 'JOUR'}`, `TI  - ${f.titulo}`, `AU  - ${f.referencia}`];
      if (f.anio !== null) lineas.push(`PY  - ${f.anio}`);
      if (f.doi) lineas.push(`DO  - ${f.doi}`);
      if (f.pagina !== null) lineas.push(`SP  - ${f.pagina}`);
      if (f.pmid) lineas.push(`AN  - ${f.pmid}`);
      lineas.push(`N1  - ROSA2018: ${f.retraccion ? 'RETRACTADO. ' : ''}${f.textoCompleto ? tr('texto completo') : tr('solo resumen')}`);
      lineas.push('ER  - ');
      return lineas.join('\n');
    })
    .join('\n');
}

function celda(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCsv(fuentes: Fuente[]): string {
  const cabecera = ['referencia', 'titulo', 'anio', 'doi', 'pmid', 'nct', 'pagina', 'tipo_estudio', 'nivel_evidencia', 'texto_completo', 'retraccion'];
  const filas = fuentes.map((f) =>
    [f.referencia, f.titulo, f.anio, f.doi, f.pmid, f.nct, f.pagina, f.tipoEstudio, f.nivelEvidencia, f.textoCompleto ? 'si' : 'no', f.retraccion ?? ''].map(celda).join(','),
  );
  return [cabecera.join(','), ...filas].join('\n');
}

/** El expediente de una hipotesis: todo lo que hace falta para auditarla
 *  fuera de ROSA2018, con un campo "aplicable a" que fija los limites. */
export function expediente(h: Hipotesis, hechos: HechoMundo[], aplicableA: string): string {
  const relacionados = hechos.filter((x) => x.id === `he-${h.id}` || h.procedencia.fuentes.some((f) => x.procedencia.some((p) => p.fuenteId === f.id)));
  const datos = {
    hipotesis: {
      id: h.id,
      titulo: h.titulo,
      enunciado: h.enunciado,
      mecanismo: h.mecanismo,
      comprobacion: h.comprobacion,
      estado: h.estado,
      origen: h.origen,
      prerregistradaEn: new Date(h.prerregistradaEn).toISOString(),
      elo: h.elo,
      historialElo: h.historialElo,
      relevancia: h.relevancia,
      evidenciaEstadistica: h.evidenciaEstadistica,
    },
    afirmaciones: h.afirmaciones.map((a) => ({ ...a, veredictoEtiqueta: VEREDICTO[a.veredicto].etiqueta })),
    supuestos: h.supuestos,
    novedad: h.novedad,
    revisor: h.hallazgos,
    revisionesAutomaticas: h.revisionesAutomaticas,
    decisionesHumanas: h.revisiones.map((r) => ({ ...r, fecha: new Date(r.fecha).toISOString() })),
    revisionesHumanas: h.revisionesHumanas,
    partidos: h.partidos,
    replicacion: h.replicacion,
    fuentes: h.procedencia.fuentes,
    registroDeEjecucion: h.procedencia.registro,
    codigo: h.procedencia.codigo,
    entorno: h.procedencia.entorno,
    hechosRelacionados: relacionados.map((x) => ({ id: x.id, enunciado: x.enunciado, estado: x.estado })),
    coste: h.coste,
    aplicableA,
    exportadoPor: 'ROSA2018',
  };
  return JSON.stringify(datos, null, 2);
}

/** La pagina de Specific Aims del NIH, generada a partir del panorama y las
 *  hipotesis aceptadas o en revision, como hace Co-Scientist. */
export function specificAims(inv: Investigacion, hipotesis: Hipotesis[]): string {
  const candidatas = hipotesis.filter((h) => h.estado === 'aceptada' || h.estado === 'en_revision' || h.estado === 'propuesta').sort((a, b) => b.elo - a.elo).slice(0, 3);
  const aims = candidatas
    .map(
      (h, i) =>
        `## Specific Aim ${i + 1}\n\n**Objetivo general.** ${h.titulo}\n\n**Hipotesis.** ${h.enunciado}\n\n**Razonamiento.** ${h.mecanismo}\n\n**Enfoque.** Biomarcador: ${h.comprobacion.biomarcador}. Cohorte: ${h.comprobacion.cohorte}. Diseño: ${h.comprobacion.diseno}.\n\n**Fuentes.** ${h.procedencia.fuentes.map((f) => `${f.referencia}${f.pagina !== null ? `, pag. ${f.pagina}` : ''}`).join('; ') || tr('sin fuentes')}`,
    )
    .join('\n\n');
  return `# Specific Aims\n\n**Descripcion de la enfermedad.** ${inv.objetivo}\n\n**Necesidad no cubierta.** ${inv.relevancia || tr('Por definir.')}\n\n**Solucion propuesta.** ${inv.configuracion.preferencias || tr('Por definir.')}\n\n${aims || tr('_Sin hipótesis candidatas todavía._')}\n\n## Evaluacion piloto\n\nCada aim se comprobara con el biomarcador y la cohorte indicados; las hipotesis se prerregistran en ROSA2018 antes de probarse.\n\n_Generado por ROSA2018 el ${new Date().toISOString().slice(0, 10)}. Borrador para revision humana._`;
}
