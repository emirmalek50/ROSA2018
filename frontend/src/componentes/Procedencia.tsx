// El cajon de procedencia de una hipotesis, en seis pestanas: Mensajes,
// Codigo, Registro de ejecucion, Entorno, Revision y Fuentes. Las cinco
// primeras son las de Claude Science; Fuentes es la que ROSA2018 anade, con los
// fragmentos citados y su pagina exacta, el tipo de estudio, el nivel de
// evidencia, si se leyo el texto completo y cuando se comprobo la
// retractacion. El registro es la fuente autoritativa.

import { useEffect, useState } from 'react';
import type { Fuente, Hipotesis } from '../datos/tipos';
import { NIVEL_EVIDENCIA, TIPO_ESTUDIO, TIPO_FUENTE, RIESGO_SESGO } from '../lib/etiquetas';
import { aBibtex, aCsv, aRis } from '../lib/exportar';
import { fechaCorta, tiempoRelativo } from '../lib/formato';
import { IconExternal, IconX } from './icons';
import { Chip, descargar } from './piezas';
import { Revisor } from './Revisor';
import { traducido, tr } from '../lib/idioma';

export type PestanaProcedencia = 'mensajes' | 'codigo' | 'registro' | 'entorno' | 'revision' | 'fuentes';

const PESTANAS: { clave: PestanaProcedencia; etiqueta: string }[] = traducido([
  { clave: 'mensajes', etiqueta: 'Mensajes' },
  { clave: 'codigo', etiqueta: 'Código' },
  { clave: 'registro', etiqueta: 'Registro' },
  { clave: 'entorno', etiqueta: 'Entorno' },
  { clave: 'revision', etiqueta: 'Revisión' },
  { clave: 'fuentes', etiqueta: 'Fuentes' },
]);

const DE: Record<Hipotesis['procedencia']['mensajes'][number]['de'], string> = {
  rosa: 'ROSA2018',
  investigadora: 'Investigadora',
  revisor: 'Revisor',
};

export function Escalera({ nivel }: { nivel: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="escalera" title={NIVEL_EVIDENCIA[nivel]} aria-label={NIVEL_EVIDENCIA[nivel]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= nivel ? 'escalera-on' : ''} style={{ height: 4 + n * 2 }} />
      ))}
    </span>
  );
}

export function TarjetaFuente({ f, ahora }: { f: Fuente; ahora: number }) {
  const doi = f.doi ? `https://doi.org/${f.doi}` : null;
  const pmid = f.pmid ? (f.pmid.startsWith('PMC') ? `https://pmc.ncbi.nlm.nih.gov/articles/${f.pmid}/` : `https://pubmed.ncbi.nlm.nih.gov/${f.pmid}/`) : null;
  const nct = f.nct ? `https://clinicaltrials.gov/study/${f.nct}` : null;
  return (
    <article className={`fuente ${f.retraccion === 'retractado' ? 'fuente-retractada-borde' : ''}`}>
      <header>
        <span className="fuente-pagina">
          {f.referencia}
          {f.riesgoSesgo && f.riesgoSesgo.global !== 'no_aplica' && (
            <Chip tono={RIESGO_SESGO[f.riesgoSesgo.global]?.tono ?? 'borde'} title={`${f.riesgoSesgo.instrumento} ${f.riesgoSesgo.version ?? ''}: ${f.riesgoSesgo.dominios.map((d) => `${d.id} ${d.nombre}: ${d.juicio.replace('_', ' ')}`).join('; ')}`}>
              {f.riesgoSesgo.instrumento} {RIESGO_SESGO[f.riesgoSesgo.global]?.etiqueta ?? f.riesgoSesgo.global}
            </Chip>
          )}
          {f.pagina !== null && ` · pág. ${f.pagina}`}
          {f.retraccion !== null && (
            <>
              {' · '}
              <span className="fuente-retractada">{f.retraccion === 'retractado' ? 'Retractado' : f.retraccion === 'preocupacion' ? 'Expresión de preocupación' : 'Erratum'}</span>
            </>
          )}
        </span>
        <strong>{f.titulo}</strong>
        <span className="acciones" style={{ gap: 6 }}>
          <Chip tono="borde">{TIPO_ESTUDIO[f.tipoEstudio]}</Chip>
          <Escalera nivel={f.nivelEvidencia} />
          <Chip tono={f.textoCompleto ? undefined : 'aviso'} title={f.textoCompleto ? tr('ROSA2018 leyo el texto completo') : tr('ROSA2018 solo leyó el resumen: la verificación vale menos')}>
            {f.textoCompleto ? tr('texto completo') : tr('solo resumen')}
          </Chip>
          <span className="meta">
            {TIPO_FUENTE[f.tipo]}
            {f.anio !== null && ` · ${f.anio}`}
            {f.citas !== null && ` · ${f.citas} citas`}
          </span>
        </span>
      </header>
      <p className="fuente-fragmento texto-comentable" data-campo="fuente">
        {f.fragmento}
      </p>
      <footer>
        {doi && (
          <a className="enlace" href={doi} target="_blank" rel="noopener noreferrer">
            DOI <IconExternal />
          </a>
        )}
        {pmid && (
          <a className="enlace" href={pmid} target="_blank" rel="noopener noreferrer">
            {f.pmid} <IconExternal />
          </a>
        )}
        {nct && (
          <a className="enlace" href={nct} target="_blank" rel="noopener noreferrer">
            {f.nct} <IconExternal />
          </a>
        )}
        <span className="meta">{f.retraccionComprobadaEn !== null ? `retractación comprobada ${tiempoRelativo(f.retraccionComprobadaEn, ahora)}` : tr('retractacion sin comprobar')}</span>
      </footer>
    </article>
  );
}

export function Procedencia({
  hipotesis,
  ahora,
  onCerrar,
  pestanaInicial = 'fuentes',
  celdaDestacada = null,
}: {
  hipotesis: Hipotesis;
  ahora: number;
  onCerrar: () => void;
  pestanaInicial?: PestanaProcedencia;
  celdaDestacada?: number | null;
}) {
  const [pestana, setPestana] = useState<PestanaProcedencia>(pestanaInicial);
  useEffect(() => setPestana(pestanaInicial), [pestanaInicial, hipotesis.id]);
  const p = hipotesis.procedencia;
  const abiertos = hipotesis.hallazgos.filter((h) => h.estado === 'abierto').length;
  const fecha = new Date(ahora).toISOString().slice(0, 10);
  return (
    <aside className="cajon" aria-label="Procedencia">
      <div className="cajon-cabecera">
        <h3>Procedencia · {hipotesis.titulo}</h3>
        <button type="button" className="btn btn-fantasma btn-icono" aria-label={tr("Cerrar procedencia")} onClick={onCerrar}>
          <IconX size={14} />
        </button>
      </div>
      <div className="pestanas" role="tablist" style={{ padding: tr('0 20px') }}>
        {PESTANAS.map((t) => (
          <button key={t.clave} role="tab" type="button" aria-selected={pestana === t.clave} onClick={() => setPestana(t.clave)}>
            {t.etiqueta}
            {t.clave === 'revision' && abiertos > 0 && <span className="nav-cuenta">{abiertos}</span>}
            {t.clave === 'fuentes' && <span className="nav-cuenta">{p.fuentes.length}</span>}
          </button>
        ))}
      </div>
      <div className="cajon-cuerpo">
        {pestana === 'mensajes' && (
          <div className="mensajes">
            {p.mensajes.map((m) => (
              <div key={m.id} className={`mensaje mensaje-${m.de}`}>
                <header>
                  <span>{DE[m.de]}</span>
                  <span title={new Date(m.creadoEn).toLocaleString('es')}>{fechaCorta(m.creadoEn)}</span>
                </header>
                {m.texto}
              </div>
            ))}
          </div>
        )}
        {pestana === 'codigo' &&
          (p.codigo.trim() === '' ? (
            <p className="meta">{tr("Esta hipótesis no ejecutó código propio.")}</p>
          ) : (
            <>
              <p className="meta">
                {tr("Script reproducible del paso que la genero. Si discrepa del registro, manda el registro.")}
                {celdaDestacada !== null && ` Celda ${celdaDestacada} destacada.`}
              </p>
              <pre className={`codigo ${celdaDestacada !== null ? 'codigo-destacado' : ''}`}>
                <code>{p.codigo}</code>
              </pre>
              <button type="button" className="btn btn-s" onClick={() => descargar(`${hipotesis.id}-codigo.py`, p.codigo, 'text/x-python')}>
                Descargar como script
              </button>
            </>
          ))}
        {pestana === 'registro' && (
          <>
            <p className="meta">{tr("Cada comando que corrió, en orden. Es la fuente autoritativa.")}</p>
            <pre className="registro">{p.registro.join('\n')}</pre>
          </>
        )}
        {pestana === 'entorno' && (
          <>
            <p>
              {p.entorno.lenguaje} {p.entorno.version}
            </p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Paquete</th>
                  <th>{tr("Versión")}</th>
                </tr>
              </thead>
              <tbody>
                {p.entorno.paquetes.map((q) => (
                  <tr key={q.nombre}>
                    <td className="mono">{q.nombre}</td>
                    <td className="mono">{q.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>{tr("Vía")}</th>
                </tr>
              </thead>
              <tbody>
                {p.entorno.modelos.map((q) => (
                  <tr key={q.nombre}>
                    <td className="mono">{q.nombre}</td>
                    <td className="mono">{q.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {pestana === 'revision' && <Revisor hallazgos={hipotesis.hallazgos} />}
        {pestana === 'fuentes' &&
          (p.fuentes.length === 0 ? (
            <p className="meta">{tr("Sin fuentes citadas.")}</p>
          ) : (
            <>
              <div className="acciones">
                <Chip>{p.fuentes.length === 1 ? tr('1 fuente') : `${p.fuentes.length} fuentes`}</Chip>
                <span className="meta">{tr("La página es la del visor de PDF, no la impresa al pie.")}</span>
              </div>
              <div className="acciones">
                <span className="meta">Exportar:</span>
                <button type="button" className="btn btn-s" onClick={() => descargar(`rosa-fuentes-${fecha}.bib`, aBibtex(p.fuentes))}>
                  BibTeX
                </button>
                <button type="button" className="btn btn-s" onClick={() => descargar(`rosa-fuentes-${fecha}.ris`, aRis(p.fuentes))}>
                  RIS
                </button>
                <button type="button" className="btn btn-s" onClick={() => descargar(`rosa-fuentes-${fecha}.csv`, aCsv(p.fuentes), 'text/csv;charset=utf-8')}>
                  CSV
                </button>
              </div>
              {p.fuentes.map((f) => (
                <TarjetaFuente key={f.id} f={f} ahora={ahora} />
              ))}
            </>
          ))}
      </div>
    </aside>
  );
}
