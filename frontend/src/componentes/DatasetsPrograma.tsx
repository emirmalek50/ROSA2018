// El registro de datasets del programa (plan completo, etapa B;
// rosa/datasets_programa.py): cada conjunto de datos público que ROSA2018
// encontró al consultar GEO, CELLxGENE, Synapse, ArrayExpress o Expression
// Atlas, o que una persona subió, con lo que se pudo inferir por regla
// (tipo, tejido, fase, tamaño, acceso) y la explicación de cada inferencia
// plegada. Por defecto se ven los usados en esta investigación; un botón
// muestra todo el registro. Un dataset de acceso controlado se marca con la
// nota "el proyecto no lo pide": ROSA2018 trabaja solo con datos públicos.

import { useState } from 'react';
import type { AccesoDatasetPrograma, DatasetPrograma, FuenteDatasetPrograma, Id, TipoDatasetPrograma } from '../datos/tipos';
import { formatearEntero } from '../lib/formato';
import { Chip } from './piezas';
import { traducido, tr } from '../lib/idioma';

/** Etiquetas visibles, copiadas de rosa/datasets_programa.py ETIQUETA_FUENTE,
 *  ETIQUETA_TIPO y ETIQUETA_ACCESO. Las claves se comparan con el servidor y
 *  van sin tilde; el texto que se lee lleva las suyas. */
export const ETIQUETA_FUENTE: Record<FuenteDatasetPrograma, string> = traducido({
  geo: 'GEO',
  cellxgene: 'CELLxGENE',
  synapse: 'Synapse',
  arrayexpress: 'ArrayExpress',
  expression_atlas: 'Expression Atlas',
  manual: 'manual',
});

export const ETIQUETA_TIPO: Record<TipoDatasetPrograma, string> = traducido({
  bulk: 'expresión en tejido (bulk)',
  celula_unica: 'célula única',
  proteomica: 'proteómica',
  genetica: 'genética',
  imagen: 'imagen',
  otro: 'otro',
});

export const ETIQUETA_ACCESO: Record<AccesoDatasetPrograma, string> = traducido({
  abierto: 'abierto',
  registro: 'con registro',
  controlado: 'controlado (el proyecto no lo pide)',
  desconocido: 'acceso sin comprobar',
});

const DEFINICION_FUENTE: Record<FuenteDatasetPrograma, string> = traducido({
  geo: 'Gene Expression Omnibus (NCBI): repositorio público de datos de expresión génica, por número de serie GSE.',
  cellxgene: 'CELLxGENE Discover (Chan Zuckerberg Initiative): colecciones públicas de célula única.',
  synapse: 'Synapse (Sage Bionetworks): plataforma que aloja, entre otros, los datos del AD Knowledge Portal; parte es de acceso controlado.',
  arrayexpress: 'ArrayExpress (EMBL-EBI): archivo europeo de experimentos de expresión.',
  expression_atlas: 'Expression Atlas (EMBL-EBI): expresión por gen y condición, reprocesada de forma uniforme.',
  manual: 'Subido por una persona a esta instalación de ROSA2018.',
});

const TONO_ACCESO: Record<AccesoDatasetPrograma, 'ok' | 'aviso' | 'mal' | 'borde'> = {
  abierto: 'ok',
  registro: 'aviso',
  controlado: 'mal',
  desconocido: 'borde',
};

const DEFINICION_ACCESO: Record<AccesoDatasetPrograma, string> = traducido({
  abierto: 'Se descarga sin pedir permiso a nadie.',
  registro: 'Hace falta una cuenta gratuita, sin comité ni acuerdo de uso.',
  controlado: 'Exige un acuerdo de uso de datos y a menudo un comité. ROSA2018 trabaja solo con datos públicos: este conjunto se registra para que conste que existe, no se propone para análisis con datos individuales.',
  desconocido: 'La regla no encontró en la ficha ninguna palabra que dijera cómo se accede: no pude comprobar, que no es lo mismo que abierto.',
});

const texto = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');
/** Un recuento: número no negativo, o texto con solo dígitos (registro antiguo); lo demás es null, "sin comprobar". */
const numero = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) && x >= 0 ? x : null;
  if (typeof x === 'string' && /^\s*\d+\s*$/.test(x)) return Number(x);
  return null;
};
/** Clave de vocabulario tal como la compara el servidor: minúsculas y sin espacios alrededor. Un
 *  registro que diga "CONTROLADO" tiene que verse como controlado, nunca como "sin comprobar". */
const claveVocabulario = <K extends string>(x: unknown, vocabulario: Record<K, string>, reserva: K): K => {
  const k = typeof x === 'string' ? x.trim().toLowerCase() : '';
  return (k in vocabulario ? k : reserva) as K;
};
export const accesoDe = (d: DatasetPrograma): AccesoDatasetPrograma => claveVocabulario(d.acceso, ETIQUETA_ACCESO, 'desconocido');

/** Un dataset se cuenta como usado en la investigación si `usadoEn` (lista
 *  o, en un registro antiguo, texto) la nombra. */
export function usadoEnInvestigacion(d: DatasetPrograma, investigacionId: Id): boolean {
  const u: unknown = d.usadoEn;
  if (Array.isArray(u)) return u.includes(investigacionId);
  return typeof u === 'string' && u === investigacionId;
}

function textoN(d: DatasetPrograma): string {
  // Un registro antiguo puede traer n como número suelto: son las muestras.
  const n: { muestras: unknown; donantes: unknown; celulas: unknown } = d.n && typeof d.n === 'object' ? d.n : { muestras: numero(d.n) !== null ? d.n : null, donantes: null, celulas: null };
  const partes: string[] = [];
  const muestras = numero(n.muestras);
  const donantes = numero(n.donantes);
  const celulas = numero(n.celulas);
  if (muestras !== null) partes.push(`${formatearEntero(muestras)} muestras`);
  if (donantes !== null) partes.push(`${formatearEntero(donantes)} donantes`);
  if (celulas !== null) partes.push(`${formatearEntero(celulas)} células`);
  return partes.length > 0 ? partes.join(' · ') : tr('sin comprobar');
}

function Fila({ d, investigacionId }: { d: DatasetPrograma; investigacionId: Id }) {
  const fuente = claveVocabulario<FuenteDatasetPrograma>(d.fuente, ETIQUETA_FUENTE, 'manual');
  const tipo = claveVocabulario<TipoDatasetPrograma>(d.tipo, ETIQUETA_TIPO, 'otro');
  const acceso = accesoDe(d);
  const registro = Array.isArray(d.registro) ? d.registro.filter((r): r is string => typeof r === 'string' && r.trim() !== '') : typeof d.registro === 'string' && d.registro ? [d.registro] : [];
  const compartidas = Array.isArray(d.muestrasCompartidasCon) ? d.muestrasCompartidasCon.filter((x): x is string => typeof x === 'string' && x !== '') : typeof d.muestrasCompartidasCon === 'string' && d.muestrasCompartidasCon ? [d.muestrasCompartidasCon] : [];
  const usado = usadoEnInvestigacion(d, investigacionId);
  const usadoEn = Array.isArray(d.usadoEn) ? d.usadoEn.length : typeof d.usadoEn === 'string' && d.usadoEn ? 1 : 0;
  const accession = texto(d.accession) || 'sin accession';
  // Solo un enlace http(s) real se pinta como enlace; lo demás (número, javascript:) no.
  const url = typeof d.url === 'string' && /^https?:\/\//i.test(d.url.trim()) ? d.url.trim() : '';
  const tejido = [texto(d.tejido), texto(d.region)].filter(Boolean).join(' · ') || tr('sin comprobar');
  const estadio = texto(d.estadio) || tr('sin comprobar');
  const titulo = texto(d.titulo) || tr('sin título');
  return (
    <li className={`dsp-fila ${acceso === 'controlado' ? 'dsp-controlado' : ''} ${usado ? 'dsp-usado' : ''}`}>
      <div className="dsp-cabecera">
        <Chip tono="borde" title={DEFINICION_FUENTE[fuente]}>{ETIQUETA_FUENTE[fuente]}</Chip>
        {url ? (
          <a className="enlace mono dsp-accession" href={url} target="_blank" rel="noreferrer noopener">
            {accession}
          </a>
        ) : (
          <span className="mono dsp-accession">{accession}</span>
        )}
        <Chip tono={TONO_ACCESO[acceso]} title={DEFINICION_ACCESO[acceso]}>{ETIQUETA_ACCESO[acceso]}</Chip>
        {usado && <Chip tono="acento" title={tr("Alguna corrida de esta investigación lo consultó o lo analizó.")}>{tr("usado aquí")}</Chip>}
        {!usado && usadoEn > 0 && <Chip title={tr("Lo usó otra investigación de este programa.")}>usado en {usadoEn} {usadoEn === 1 ? tr('investigación') : 'investigaciones'}</Chip>}
      </div>
      <p className="dsp-titulo">{titulo}</p>
      <dl className="dsp-datos">
        <div>
          <dt title={tr("Qué clase de dato es: expresión de genes en tejido entero (bulk), célula a célula (célula única), proteínas, variantes genéticas o imagen.")}>Tipo</dt>
          <dd>{ETIQUETA_TIPO[tipo]}</dd>
        </div>
        <div>
          <dt>Tejido</dt>
          <dd>{tejido}</dd>
        </div>
        <div>
          <dt title={tr("Fase de la enfermedad de los donantes o participantes, si la ficha la dice.")}>Fase</dt>
          <dd>{estadio}</dd>
        </div>
        <div>
          <dt title={tr("Tamaño: muestras (ficheros o tejidos medidos), donantes (personas distintas) y células, según lo que la ficha declare.")}>n</dt>
          <dd>{textoN(d)}</dd>
        </div>
        {texto(d.organismo) && (
          <div>
            <dt>Organismo</dt>
            <dd>{texto(d.organismo)}</dd>
          </div>
        )}
        {texto(d.plataforma) && (
          <div>
            <dt>Plataforma</dt>
            <dd>{texto(d.plataforma)}</dd>
          </div>
        )}
      </dl>
      {acceso === 'controlado' && (
        <p className="meta dsp-nota">
          {tr("Acceso controlado: el proyecto no lo pide. ROSA2018 trabaja solo con datos públicos; este conjunto queda registrado para que conste, no se propone para análisis con datos individuales.")}
        </p>
      )}
      {compartidas.length > 0 && (
        <p className="meta dsp-nota" title={tr("Dos series que comparten muestras no son dos evidencias independientes.")}>
          Comparte muestras con {compartidas.join(', ')}{tr(": no cuentan como dos evidencias.")}
        </p>
      )}
      {registro.length > 0 && (
        <details className="dsp-registro">
          <summary>{tr("Cómo se dedujo cada dato (")}{registro.length})</summary>
          <ul className="lista-limpia">
            {registro.map((r, i) => (
              <li key={i} className="meta">
                {r}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** La lista del registro. `datasets` es estado.datasetsPrograma (puede faltar
 *  en un estado antiguo); por defecto se filtra por la investigación. */
export function DatasetsPrograma({ datasets, investigacionId }: { datasets: DatasetPrograma[] | null | undefined; investigacionId: Id }) {
  const [verTodos, setVerTodos] = useState(false);
  const todos = (Array.isArray(datasets) ? datasets : []).filter((d): d is DatasetPrograma => Boolean(d) && typeof d === 'object');
  const propios = todos.filter((d) => usadoEnInvestigacion(d, investigacionId));
  const visibles = (verTodos ? todos : propios).slice().sort((a, b) => (numero(b.actualizadoEn) ?? 0) - (numero(a.actualizadoEn) ?? 0));
  const controlados = visibles.filter((d) => accesoDe(d) === 'controlado').length;
  return (
    <article className="tarjeta dsp" aria-label={tr("Datasets del programa")}>
      <div className="dsp-encabezado">
        <div>
          <h3>{tr("Datasets del programa")}</h3>
          <p className="meta">
            {tr("Cada conjunto de datos público que ROSA2018 encontró al buscar datos (GEO, CELLxGENE, Synapse, ArrayExpress, Expression Atlas) o que una persona subió, con lo que se dedujo por regla de su ficha. Lo que no se pudo deducir dice \"sin comprobar\", nunca se inventa.")}
          </p>
        </div>
        {todos.length > propios.length && (
          <button type="button" className="btn btn-s" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? `Solo los de esta investigación (${propios.length})` : `Ver todo el registro (${todos.length})`}
          </button>
        )}
      </div>
      {todos.length === 0 ? (
        <p className="meta">{tr("El registro está vacío: se llena cuando ROSA2018 consulta bases de datos al buscar datos para una hipótesis o cuando alguien sube un fichero.")}</p>
      ) : visibles.length === 0 ? (
        <p className="meta">{tr("Ninguna corrida de esta investigación ha usado todavía un dataset del registro. El botón de arriba muestra los")} {todos.length} del programa.</p>
      ) : (
        <>
          <p className="meta dsp-resumen">
            {visibles.length} {visibles.length === 1 ? 'dataset' : 'datasets'}
            {verTodos ? tr(' en todo el programa') : tr(' usados en esta investigación')}
            {controlados > 0 ? `; ${controlados} de acceso controlado (el proyecto no lo pide)` : ''}.
          </p>
          <ul className="lista-limpia dsp-lista">
            {visibles.slice(0, 60).map((d, i) => (
              <Fila key={`${texto(d.id) || `${texto(d.fuente)}-${texto(d.accession)}`}-${i}`} d={d} investigacionId={investigacionId} />
            ))}
          </ul>
          {visibles.length > 60 && <p className="meta">{tr("Se muestran 60 de")} {visibles.length}.</p>}
        </>
      )}
    </article>
  );
}
