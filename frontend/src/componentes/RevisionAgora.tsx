import type { ReactNode } from 'react';
import type { ConsultaAgora, GenAgora, Hipotesis, Novedad, RevisionAgora as Informe, SeccionAgora } from '../datos/tipos';
import { idiomaActual, useIdioma } from '../lib/idioma';
import { rutaDe } from '../lib/ruta';
import { Chip } from './piezas';
import './revisionAgora.css';

type HipotesisAgora = Pick<Hipotesis, 'id' | 'investigacionId' | 'version' | 'revisionAgora'>;
type Tono = 'ok' | 'aviso' | 'borde' | 'acento';
const texto = (es: string, en: string): string => idiomaActual() === 'en' ? en : es;
const SECCIONES = [
  ['gene_search', 'Búsqueda del gen', 'Gene Search'],
  ['comparison_rna', 'Comparación de ARN', 'Gene Comparison: RNA'],
  ['comparison_proteina', 'Comparación de proteína', 'Gene Comparison: protein'],
  ['nominated_targets', 'Dianas nominadas', 'Nominated Targets'],
  ['nominated_drugs', 'Fármacos nominados', 'Nominated Drugs'],
] as const;
const OTRAS_SECCIONES: Record<string, [string, string]> = {
  evidencia_ad: ['Asociación genética y evidencia en Alzheimer', 'Genetic association and Alzheimer’s evidence'],
  rna: ['Expresión diferencial de ARN', 'RNA differential expression'],
  proteina_lfq: ['Expresión proteica LFQ', 'LFQ protein expression'],
  proteina_srm: ['Expresión proteica SRM', 'SRM protein expression'],
  proteina_tmt: ['Expresión proteica TMT', 'TMT protein expression'],
  metabolomica: ['Metabolómica', 'Metabolomics'],
  neuropatologia: ['Neuropatología', 'Neuropathology'],
  puntuaciones: ['Puntuaciones de la diana', 'Target scores'],
  validacion: ['Validación experimental', 'Experimental validation'],
  farmacologia: ['Farmacología', 'Pharmacology'],
  dominios: ['Dominios biológicos', 'Biological domains'],
  expresion: ['Expresión del gen', 'Gene expression'],
  redes: ['Redes del gen', 'Gene networks'],
  recursos: ['Recursos disponibles', 'Available resources'],
};

function etiqueta(estado: string): { texto: string; tono: Tono } {
  switch (estado) {
    case 'completa': return { texto: texto('Revisión completa', 'Review complete'), tono: 'ok' };
    case 'comprobado': return { texto: texto('Consultado', 'Checked'), tono: 'ok' };
    case 'sin_datos': return { texto: texto('Sin datos en la consulta', 'No data in this query'), tono: 'borde' };
    case 'parcial': return { texto: texto('Revisión parcial', 'Partial review'), tono: 'aviso' };
    case 'no_aplica': return { texto: texto('No aplica', 'Not applicable'), tono: 'borde' };
    case 'en_curso': return { texto: texto('Revisión en curso', 'Review in progress'), tono: 'acento' };
    case 'nominada': return { texto: texto('Diana nominada', 'Nominated target'), tono: 'aviso' };
    case 'no_nominada': return { texto: texto('No nominada en la consulta', 'Not nominated in this query'), tono: 'borde' };
    default: return { texto: texto('No comprobado', 'Not checked'), tono: 'borde' };
  }
}

/** Los registros antiguos guardaban «Pendiente» dentro de no_nominada. */
export function estadoAgoraHistorico(valor?: Novedad['agora'] | null): string {
  if (!valor) return 'no_comprobado';
  const detalle = String(valor.detalle ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/^\s*no aplica\b/.test(detalle)) return 'no_aplica';
  if (/\b(no comprobado|pendiente|no pude comprobar|no se pudo comprobar|sin comprobar|no tiene api|sin api)\b/.test(detalle)) return 'no_comprobado';
  return valor.estado;
}

export function EstadoAgora({ valor }: { valor?: Novedad['agora'] | null }) {
  useIdioma();
  const e = etiqueta(estadoAgoraHistorico(valor));
  return <Chip tono={e.tono}>{e.texto}</Chip>;
}

function urlPublica(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  try { const u = new URL(valor); return u.protocol === 'https:' || u.protocol === 'http:' ? valor : null; } catch { return null; }
}

function Enlace({ url, children }: { url: unknown; children: ReactNode }) {
  const u = urlPublica(url);
  return u ? <a href={u} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}

function Fecha({ valor }: { valor: unknown }) {
  const d = typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? new Date(valor)
    : typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor) ? new Date(valor) : null;
  return d && Number.isFinite(d.getTime())
    ? <time dateTime={d.toISOString()}>{d.toLocaleString(idiomaActual() === 'en' ? 'en-US' : 'es-DO')}</time>
    : <span>{texto('Fecha no disponible', 'Date unavailable')}</span>;
}

function VersionFuente({ valor }: { valor: unknown }) {
  return <span data-sin-traducir>{typeof valor === 'string' ? valor : JSON.stringify(valor)}</span>;
}

function seccionesDe(gen: GenAgora): SeccionAgora[] {
  const secciones = Array.isArray(gen.secciones) ? gen.secciones.filter(s => s && typeof s === 'object') : [];
  const salida = SECCIONES.map(([id, es, en]): SeccionAgora => secciones.find(s => s.id === id) ?? {
    id, nombre: texto(es, en), estado: 'no_comprobado', resumen: texto('Esta sección no está en la revisión guardada.', 'This section is missing from the saved review.'),
    fecha: 0, fuentes: [], consultas: [], datos: {}, limitaciones: [],
  });
  return [...salida, ...secciones.filter(s => !SECCIONES.some(([id]) => id === s.id))];
}

function estadoSeccion(s: SeccionAgora): string {
  const consultas = Array.isArray(s.consultas) ? s.consultas : [];
  // Si el resumen afirma completitud pero el registro tiene fallos, se muestran.
  if ((s.estado === 'comprobado' || s.estado === 'sin_datos') && consultas.some(c => c.error || c.completa === false)) return 'parcial';
  return s.estado;
}

function situacion(h: HipotesisAgora) {
  const revision = h.revisionAgora;
  const r = revision && revision.hipotesisId === h.id ? revision : null;
  const genes = r && Array.isArray(r.genes) ? r.genes.filter(g => g && typeof g === 'object') : [];
  const obsoleta = !!r && (r.vigente === false || r.versionHipotesis !== (h.version ?? 1));
  const secciones = genes.flatMap(seccionesDe);
  const comprobadas = secciones.filter(s => ['comprobado', 'sin_datos'].includes(estadoSeccion(s))).length;
  let estado: string = r?.estado ?? 'no_comprobado';
  if (obsoleta) estado = 'no_comprobado';
  else if (estado === 'completa' && (!genes.length || genes.some(g => g.estadoResolucion !== 'resuelto') || secciones.some(s => !['comprobado', 'sin_datos', 'no_aplica'].includes(estadoSeccion(s))))) estado = 'parcial';
  return { r, genes, obsoleta, estado, comprobadas, total: secciones.length };
}

function Cobertura({ comprobadas, total }: { comprobadas: number; total: number }) {
  return <span className="agora-cobertura">{texto(`${comprobadas} de ${total} secciones consultadas`, `${comprobadas} of ${total} sections checked`)}</span>;
}

export function ResumenAgora({ h, onAbrir }: { h: HipotesisAgora; onAbrir: () => void }) {
  useIdioma();
  const s = situacion(h), e = etiqueta(s.estado);
  return <section className="agora-resumen" aria-label={texto('Resumen de la revisión de Agora', 'Agora review summary')}>
    <div><strong>{texto('Revisión de Agora', 'Agora review')}</strong><Chip tono={e.tono}>{e.texto}</Chip></div>
    {s.obsoleta ? <p>{texto('La hipótesis cambió. El informe anterior no describe esta versión.', 'The hypothesis changed. The previous report does not describe this version.')}</p>
      : s.r ? <><p>{s.r.resumen || texto('Consulta la cobertura y los límites de cada sección.', 'Review coverage and limitations for each section.')}</p>{s.total > 0 && <Cobertura comprobadas={s.comprobadas} total={s.total} />}</>
        : <p>{texto('Todavía no consta una revisión de Agora para esta hipótesis.', 'No Agora review is recorded for this hypothesis yet.')}</p>}
    <button className="enlace" type="button" onClick={onAbrir}>{texto('Ver revisión y fuentes', 'View review and sources')}</button>
  </section>;
}

function Limitaciones({ valores }: { valores: unknown }) {
  const lista = Array.isArray(valores) ? valores.filter((v): v is string => typeof v === 'string' && !!v) : [];
  return lista.length ? <ul className="agora-limitaciones">{lista.map((v, i) => <li key={i}>{v}</li>)}</ul> : null;
}

function Datos({ datos }: { datos: unknown }) {
  if (!datos || typeof datos !== 'object' || !Object.keys(datos).length) return null;
  const { analisisDescriptivo, ...vista } = datos as Record<string, unknown>;
  const analisis = typeof analisisDescriptivo === 'string' ? analisisDescriptivo : '';
  return <>
    {analisis && <details className="agora-analisis"><summary>{texto('Análisis de los datos recuperados', 'Analysis of retrieved data')}</summary>
      <p className="agora-analisis-texto" data-sin-traducir>{analisis}</p>
    </details>}
    {Object.keys(vista).length > 0 && <details className="agora-datos"><summary>{texto('Datos devueltos por Agora', 'Data returned by Agora')}</summary>
      <p>{texto('Vista previa del registro. Las cifras conservan sus campos y unidades originales.', 'Record preview. Numbers retain their original fields and units.')}</p>
      <pre data-sin-traducir>{JSON.stringify(vista, null, 2)}</pre>
    </details>}
  </>;
}

function Consulta({ c }: { c: ConsultaAgora }) {
  const n = typeof c.n === 'number' && Number.isFinite(c.n) ? String(c.n) : texto('No registrado', 'Not recorded');
  return <li>
    <div><Enlace url={c.url}>{c.fuente || c.herramienta || texto('Consulta a Agora', 'Agora query')}</Enlace><Fecha valor={c.fecha} /></div>
    <p>{texto('Registros devueltos: ', 'Records returned: ')}<b data-sin-traducir>{n}</b>{typeof c.total === 'number' && Number.isFinite(c.total) && <>{texto(' · Total declarado: ', ' · Reported total: ')}<b data-sin-traducir>{String(c.total)}</b></>}</p>
    {c.error && <p className="agora-aviso">{texto('No pude comprobar: ', 'Could not verify: ')}{c.error}</p>}
    {c.completa === false && <p className="agora-aviso">{texto('Consulta incompleta: no permite afirmar ausencia.', 'Incomplete query: absence cannot be inferred.')}</p>}
    {c.resumen && <p>{c.resumen}</p>}
    {c.version && <p>{texto('Versión de la fuente: ', 'Source version: ')}<VersionFuente valor={c.version} /></p>}
    {c.parametros && Object.keys(c.parametros).length > 0 && <details><summary>{texto('Parámetros de consulta', 'Query parameters')}</summary><pre data-sin-traducir>{JSON.stringify(c.parametros, null, 2)}</pre></details>}
  </li>;
}

function Seccion({ s }: { s: SeccionAgora }) {
  const conocida = SECCIONES.find(([id]) => id === s.id), adicional = OTRAS_SECCIONES[s.id], e = etiqueta(estadoSeccion(s));
  const fuentes = Array.isArray(s.fuentes) ? s.fuentes : [], consultas = Array.isArray(s.consultas) ? s.consultas : [];
  return <article className="agora-seccion" data-estado={estadoSeccion(s)}>
    <header><h4>{conocida ? texto(conocida[1], conocida[2]) : adicional ? texto(adicional[0], adicional[1]) : s.nombre || s.id}</h4><Chip tono={e.tono}>{e.texto}</Chip></header>
    {s.resumen && <p>{s.resumen}</p>}
    <div className="agora-fecha"><Fecha valor={s.fecha} /></div>
    <Limitaciones valores={s.limitaciones} />
    {fuentes.length > 0 && <ul className="agora-fuentes">{fuentes.map((f, i) => <li key={i}><Enlace url={f.url}>{f.nombre || texto('Fuente', 'Source')}</Enlace>{f.version && <span> · <VersionFuente valor={f.version} /></span>}</li>)}</ul>}
    <Datos datos={s.datos} />
    {consultas.length > 0 && <details className="agora-consultas"><summary>{texto(`Registro de consultas (${consultas.length})`, `Query log (${consultas.length})`)}</summary><ul>{consultas.map((c, i) => <Consulta key={i} c={c} />)}</ul></details>}
  </article>;
}

function Gen({ gen }: { gen: GenAgora }) {
  const resolucion = gen.estadoResolucion === 'ambiguo' ? texto('La identidad del gen es ambigua.', 'Gene identity is ambiguous.')
    : gen.estadoResolucion === 'no_encontrado' ? texto('No se encontró el gen con el identificador consultado.', 'The gene was not found with the queried identifier.')
      : gen.estadoResolucion !== 'resuelto' ? texto('No pude comprobar la identidad del gen.', 'Gene identity could not be checked.') : null;
  return <section className="agora-gen" aria-label={gen.simbolo || gen.consultado}>
    <header><h3><Enlace url={gen.url}>{gen.simbolo || gen.consultado || texto('Gen sin identificar', 'Unidentified gene')}</Enlace></h3>{gen.ensembl && <code>{gen.ensembl}</code>}</header>
    <p className="meta">{texto('Identificador consultado: ', 'Queried identifier: ')}<span data-sin-traducir>{gen.consultado}</span></p>
    {resolucion && <p className="agora-aviso">{resolucion}</p>}
    <Datos datos={gen.datos} />
    <div className="agora-secciones">{seccionesDe(gen).map((s, i) => <Seccion s={s} key={`${s.id}-${i}`} />)}</div>
  </section>;
}

function Cuerpo({ r, genes }: { r: Informe; genes: GenAgora[] }) {
  return <>
    {r.resumen && <p>{r.resumen}</p>}
    <Limitaciones valores={r.limitaciones} />
    {genes.map((g, i) => <Gen gen={g} key={`${g.ensembl || g.consultado}-${i}`} />)}
    {!genes.length && <p>{texto('Esta revisión no contiene genes resueltos. Consulta su alcance y sus limitaciones.', 'This review contains no resolved genes. Check its scope and limitations.')}</p>}
  </>;
}

export function RevisionAgora({ h }: { h: HipotesisAgora }) {
  useIdioma();
  const s = situacion(h), e = etiqueta(s.estado);
  return <section className="revision-agora" aria-label={texto('Revisión científica de Agora', 'Agora scientific review')}>
    <header className="agora-cabecera"><div><p className="agora-ceja">AD Knowledge Portal</p><h2>{texto('Revisión de Agora', 'Agora review')}</h2></div><Chip tono={e.tono}>{e.texto}</Chip></header>
    <p className="agora-nota">{texto('Expresión de ARN y proteína, nominaciones y datos del gen. Una nominación no demuestra eficacia; un fallo de consulta no demuestra ausencia.', 'RNA and protein expression, nominations and gene data. Nomination does not establish efficacy; a failed query does not establish absence.')}</p>
    {!s.r ? <p role="status">{texto('Todavía no consta una revisión de Agora para esta hipótesis.', 'No Agora review is recorded for this hypothesis yet.')}</p> : <>
      <div className="agora-procedencia"><span>{texto(`Hipótesis v${s.r.versionHipotesis}`, `Hypothesis v${s.r.versionHipotesis}`)}</span><Fecha valor={s.r.fecha} />{s.r.corridaId && <span>{texto('Corrida: ', 'Run: ')}{s.r.corridaId}</span>}{s.r.iteracionId && <span>{texto('Iteración: ', 'Iteration: ')}{s.r.iteracionId}</span>}</div>
      {s.obsoleta ? <><p className="agora-aviso" role="status">{texto('La hipótesis cambió. Hace falta revisar esta versión; el informe anterior se conserva como histórico.', 'The hypothesis changed. This version needs review; the previous report is retained as history.')}</p><details className="agora-historico"><summary>{texto('Consultar el informe anterior', 'View the previous report')}</summary><Cuerpo r={s.r} genes={s.genes} /></details></>
        : <>{s.total > 0 && <Cobertura comprobadas={s.comprobadas} total={s.total} />}<Cuerpo r={s.r} genes={s.genes} /></>}
      {s.r.artefactoId && <a className="btn btn-s agora-artefacto" href={rutaDe(h.investigacionId, 'artefactos', s.r.artefactoId)}>{texto('Ver informe de Agora', 'View Agora report')}</a>}
    </>}
  </section>;
}
