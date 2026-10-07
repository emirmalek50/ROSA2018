// Dos revisiones independientes del tratamiento concreto. La ausencia se limita
// a las fuentes consultadas; la cita conserva las palabras originales de la fuente.
import type { InformeTratamiento, RevisionTratamiento as Revision } from '../datos/tipos';
import { tr, trp, useIdioma } from '../lib/idioma';
import { Chip, Seccion } from './piezas';

function enlaceComprobable(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function FechaRevision({ fecha }: { fecha?: number }) {
  const idioma = useIdioma();
  if (!fecha || !Number.isFinite(fecha)) return <span>{tr('Fecha no disponible')}</span>;
  const d = new Date(fecha);
  if (!Number.isFinite(d.getTime())) return <span>{tr('Fecha no disponible')}</span>;
  return <time dateTime={d.toISOString()}>{d.toLocaleString(idioma === 'en' ? 'en-US' : 'es-DO', { dateStyle: 'medium', timeStyle: 'short' })}</time>;
}

function DatosDelRegistro({ datos }: { datos: Record<string, unknown> }) {
  const texto = (x: unknown): string => typeof x === 'string' || typeof x === 'number' ? String(x) : '';
  const nombres = (x: unknown): string => Array.isArray(x) ? x.map(v => typeof v === 'object' && v ? texto((v as Record<string, unknown>).nombre) : texto(v)).filter(Boolean).join(', ') : '';
  const sponsor = datos.patrocinador && typeof datos.patrocinador === 'object' ? datos.patrocinador as Record<string, unknown> : {};
  const patente = datos.patente && typeof datos.patente === 'object' && !Array.isArray(datos.patente) ? datos.patente as Record<string, unknown> : datos;
  const campos: [string, string][] = [
    [tr('Registro del ensayo'), texto(datos.nct)],
    [tr('Patrocinador'), texto(sponsor.nombre)],
    [tr('Colaboradores'), nombres(datos.colaboradores)],
    [tr('Fase registrada'), nombres(datos.fases)],
    [tr('Estado registrado'), texto(datos.estado)],
    [tr('Motivo de parada declarado'), texto(datos.whyStopped)],
    [tr('Resultados publicados en el registro'), typeof datos.hasResults === 'boolean' ? tr(datos.hasResults ? 'Sí' : 'No') : ''],
    [tr('Número de patente'), texto(patente.patent_number)],
    [tr('Fecha de caducidad declarada'), texto(patente.expiration_date)],
    [tr('Fecha de presentación declarada'), texto(patente.patent_submission_date)],
    [tr('Solicitud regulatoria'), texto(datos.application_full_name)],
  ];
  if (datos.fechas && typeof datos.fechas === 'object') {
    const f = datos.fechas as Record<string, unknown>;
    const fechas: [string, string][] = [
      ['inicio', tr('Inicio registrado')],
      ['finalizacionPrimaria', tr('Finalización primaria registrada')],
      ['finalizacion', tr('Finalización registrada')],
      ['ultimaActualizacion', tr('Actualización del registro')],
      ['estadoVerificado', tr('Última verificación del estado')],
      ['primeraPublicacion', tr('Primera publicación en el registro')],
      ['resultadosPrimeraPublicacion', tr('Primera publicación de resultados')],
    ];
    for (const [clave, titulo] of fechas) {
      const valor = f[clave];
      campos.push([titulo, typeof valor === 'object' && valor ? texto((valor as Record<string, unknown>).fecha) : texto(valor)]);
    }
  }
  const visibles = campos.filter(([, valor]) => valor);
  return visibles.length ? <dl>{visibles.map(([nombre, valor]) => <div key={nombre} style={{ marginTop: 8 }}><dt className="meta">{nombre}</dt><dd data-sin-traducir style={{ margin: 0 }}>{valor}</dd></div>)}</dl> : null;
}

export type AgenteTratamiento = 'patentes' | 'companias';

export function etiquetaEstado(informe?: InformeTratamiento): string {
  switch (informe?.estado) {
    case 'coincidencias': return tr('Coincidencias que revisar');
    case 'sin_coincidencias_en_fuentes_consultadas': return tr('Sin coincidencias en las fuentes consultadas');
    case 'no_aplica': return tr('No aplica a esta propuesta');
    default: return tr('No comprobado');
  }
}

function etiquetaRelacion(relacion: string): string {
  switch (relacion) {
    case 'mismo_tratamiento': return tr('Mismo tratamiento');
    case 'componente_de_combinacion': return tr('Componente de la combinación');
    case 'misma_diana': return tr('Misma diana, tratamiento distinto');
    case 'mismo_mecanismo': return tr('Mismo mecanismo');
    case 'relacionado': return tr('Relacionado');
    default: return tr('Equivalencia sin resolver');
  }
}

function Informe({ nombre, informe }: { nombre: string; informe?: InformeTratamiento }) {
  const consultas = informe?.consultas ?? [];
  const incompletas = consultas.filter(c => !c.completa || c.error);
  return <section className="ficha-bloque revision-informe" aria-label={nombre}>
    <div className="acciones" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <h3 className="ficha-h">{nombre}</h3>
      <Chip tono={informe?.estado === 'coincidencias' || incompletas.length ? 'aviso' : 'borde'}>{etiquetaEstado(informe)}</Chip>
    </div>
    <p className="revision-dictamen">{informe?.resumen || tr('Este agente todavía no ha completado la revisión de este tratamiento.')}</p>
    {informe && <>
      <p className="meta">{tr('Revisión registrada el')} <FechaRevision fecha={informe.fecha} /></p>
      <p className="meta">{trp('Consultas registradas: {n}; incompletas o sin respuesta: {m}.', { n: consultas.length, m: incompletas.length })}</p>
      {informe.modelo && <p className="meta">{tr('Modelo del especialista')}: <span data-sin-traducir>{informe.modelo}</span>{informe.revisor && <> · {tr('Revisión independiente')}: <span data-sin-traducir>{informe.revisor}</span></>}</p>}
      {(informe.hallazgos ?? []).map(h => {
        const url = enlaceComprobable(h.url);
        return <article className="revision-hallazgo" key={h.id} style={{ marginTop: 20 }}>
          <div className="acciones" style={{ alignItems: 'baseline', gap: 10 }}>
            <h4 data-sin-traducir style={{ margin: 0 }}>{url ? <a className="enlace" href={url} target="_blank" rel="noopener noreferrer">{h.titulo}</a> : h.titulo}</h4>
            <Chip tono={h.relacion === 'mismo_tratamiento' ? 'aviso' : 'borde'}>{etiquetaRelacion(h.relacion)}</Chip>
          </div>
          <p className="meta"><span data-sin-traducir>{h.fuente}</span>{!url && <> · {tr('Enlace de la fuente no disponible')}</>}</p>
          {h.cita && <div className="verif-fragmento"><p className="campo-etiqueta">{tr('Pasaje original de la fuente')}</p><blockquote data-sin-traducir>{h.cita}</blockquote></div>}
          <p>{h.explicacion}</p>
          <DatosDelRegistro datos={h.datos ?? {}} />
          {(h.diferencias ?? []).length > 0 && <><strong>{tr('Diferencias con la propuesta de ROSA')}</strong><ul>{h.diferencias.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
        </article>;
      })}
      {consultas.length > 0 && <details style={{ marginTop: 16 }}>
        <summary>{tr('Fuentes y cobertura de la búsqueda')}</summary>
        <div style={{ overflowX: 'auto' }}><table className="tabla">
          <thead><tr><th>{tr('Fuente y consulta')}</th><th>{tr('Registros recuperados')}</th><th>{tr('Cobertura')}</th></tr></thead>
          <tbody>{consultas.map((c, i) => {
            const url = enlaceComprobable(c.url);
            return <tr key={i}>
              <td><strong data-sin-traducir>{url ? <a className="enlace" href={url} target="_blank" rel="noopener noreferrer">{c.fuente}</a> : c.fuente}</strong><p data-sin-traducir>{c.consulta}</p></td>
              <td>{trp('{n} de {total}', { n: c.recuperados, total: c.total ?? tr('total desconocido') })}<p className="meta">{trp('Páginas consultadas: {n}', { n: c.paginas })}</p></td>
              <td>{c.error ? <span className="tono-aviso">{tr('La fuente no respondió')}: {c.error}</span> : c.completa ? tr('Consulta completada') : tr('Consulta parcial')}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </details>}
      {(informe.limitaciones ?? []).length > 0 && <div className="revision-limites" style={{ marginTop: 16 }}><strong>{tr('Límites de esta revisión')}</strong><ul>{informe.limitaciones.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
    </>}
  </section>;
}

export function RevisionTratamiento({ revision, agente, dossier = false }: { revision?: Revision | null; agente?: AgenteTratamiento; dossier?: boolean }) {
  useIdioma();
  const aviso = <p role="status">{tr('El tratamiento cambió. La revisión anterior no se aplica a esta versión; los especialistas tienen una revisión pendiente.')}</p>;
  if (revision?.vigente === false) return dossier ? <div className="revision-pendiente">{aviso}</div> : <Seccion titulo={tr('Patentes y programas de compañías')}>{aviso}</Seccion>;
  const contenido = <>
    {revision?.perfil && <div className="ficha-bloque revision-perfil">
      <h3 className="revision-perfil-titulo">{tr('Perfil del tratamiento comparado')}</h3>
      <h3 className="ficha-h">{revision.perfil.nombre ? <span data-sin-traducir>{revision.perfil.nombre}</span> : tr('Tratamiento pendiente de identificar')}</h3>
      <p className="meta">{tr('Tipo de propuesta')}: {tr(revision.perfil.tipo === 'intervencion' ? 'Intervención terapéutica' : revision.perfil.tipo === 'observacional' ? 'Estudio observacional' : 'Tratamiento sin concretar')}</p>
      <p className="meta">{[revision.perfil.modalidad, revision.perfil.indicacion].filter(Boolean).join(' · ')}</p>
      {revision.perfil.direccion && <p>{tr('Dirección de la intervención')}: {revision.perfil.direccion}</p>}
      {(revision.perfil.ingredientes ?? []).length > 0 && <p>{tr('Ingredientes identificados')}: <span data-sin-traducir>{revision.perfil.ingredientes.join(', ')}</span></p>}
      {(revision.perfil.sinonimos ?? []).length > 0 && <p>{tr('Alias documentados')}: <span data-sin-traducir>{revision.perfil.sinonimos.join(', ')}</span></p>}
      {(revision.perfil.dianas ?? []).length > 0 && <p>{tr('Dianas identificadas')}: <span data-sin-traducir>{revision.perfil.dianas.join(', ')}</span></p>}
      {(revision.perfil.combinacion ?? []).length > 0 && <p>{tr('Combinación propuesta')}: <span data-sin-traducir>{revision.perfil.combinacion.join(', ')}</span></p>}
      {revision.perfil.via && <p>{tr('Vía propuesta')}: {revision.perfil.via}</p>}
      {revision.perfil.dosis && <p>{tr('Dosis propuesta')}: <span data-sin-traducir>{revision.perfil.dosis}</span></p>}
      {revision.perfil.formulacion && <p>{tr('Formulación propuesta')}: {revision.perfil.formulacion}</p>}
      {revision.perfil.secuencia && <p style={{ overflowWrap: 'anywhere' }}>{tr('Secuencia propuesta')}: <span data-sin-traducir>{revision.perfil.secuencia}</span></p>}
      {(revision.perfil.consultasPatentes ?? []).length > 0 && <p>{tr('Consultas previstas de patentes')}: <span data-sin-traducir>{revision.perfil.consultasPatentes.join('; ')}</span></p>}
      {(revision.perfil.consultasProgramas ?? []).length > 0 && <p>{tr('Nombres previstos para buscar programas')}: <span data-sin-traducir>{revision.perfil.consultasProgramas.join('; ')}</span></p>}
    </div>}
    {(!agente || agente === 'patentes') && <Informe nombre={tr('Especialista en patentes')} informe={revision?.patentes} />}
    {(!agente || agente === 'companias') && <Informe nombre={tr('Especialista en compañías')} informe={revision?.companias} />}
    <p className="meta revision-alcance">{tr('Una búsqueda pública no garantiza que no exista una patente ni un programa confidencial. La cobertura y los documentos consultados delimitan el resultado; la revisión de patentes no es un dictamen de libertad de operación.')}</p>
  </>;
  return dossier ? <div className="revision-dossier">{contenido}</div> : <Seccion titulo={tr('Patentes y desarrollo empresarial del tratamiento')} nota={tr('Dos especialistas comparan el tratamiento concreto con documentos de patentes y programas de compañías. Compartir una diana no significa estar probando el mismo tratamiento.')}>{contenido}</Seccion>;
}
