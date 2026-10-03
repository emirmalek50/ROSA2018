// Lo que hizo ROSA2018, contado para quien no es cientifico. Dos piezas: el
// resumen en llano de una iteracion (que buscaba, que encontro, que propone,
// que falta, que te toca, glosario) y la viabilidad de la prueba. La hipotesis
// en llano y su conclusion viven desde el 3 de octubre de 2026 en
// FichaHipotesis.tsx, con la ficha rehecha.

import type { ResumenLlano, ViabilidadPrueba } from '../datos/tipos';
import { Chip, Momento, Seccion } from './piezas';
import { traducido, tr, trp } from '../lib/idioma';

export function ResumenEnLlano({ resumen, numero, abierta = true }: { resumen: ResumenLlano | null | undefined; numero: number; abierta?: boolean }) {
  if (resumen === undefined) return null;
  return (
    <Seccion titulo={trp("Qué encontró ROSA2018 en la iteración {numero}", { numero })} nota={tr("Contado en lenguaje corriente, con cada término técnico definido al final. El detalle con citas, veredictos y pistas está más abajo.")}>
      {resumen === null ? (
        <p className="meta">{tr("ROSA2018 no pudo escribir el resumen de esta iteración (el modelo no respondió). El resumen técnico está en las iteraciones anteriores.")}</p>
      ) : (
        <div className={`llano ${abierta ? '' : 'llano-compacto'}`}>
          {resumen.titulo && <p className="llano-pregunta">{resumen.titulo}</p>}
          {resumen.mensajesClave.length > 0 && (
            <div className="llano-bloque llano-clave">
              <h4>{tr("Mensajes clave")}</h4>
              <ul>
                {resumen.mensajesClave.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="llano-bloque">
            <h4>{tr("Qué quería averiguar ROSA2018")}</h4>
            <p>{resumen.queBuscaba}</p>
          </div>
          {resumen.queHizo && (
            <div className="llano-bloque">
              <h4>{tr("Qué hizo")}</h4>
              <p>{resumen.queHizo}</p>
            </div>
          )}
          <div className="llano-bloque">
            <h4>{tr("Qué encontró")}</h4>
            <ul>
              {resumen.queEncontro.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          {resumen.limitaciones && (
            <div className="llano-bloque">
              <h4>{tr("Hasta donde fiarse de esto")}</h4>
              <p>{resumen.limitaciones}</p>
            </div>
          )}
          {resumen.cambios.length > 0 && (
            <div className="llano-bloque">
              <h4>{tr("Qué cambió desde la iteración anterior")}</h4>
              <ul>
                {resumen.cambios.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {resumen.quePropone.length > 0 && (
            <div className="llano-bloque">
              <h4>{tr("Qué propone comprobar")}</h4>
              <ul>
                {resumen.quePropone.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="llano-bloque">
            <h4>{tr("Qué falta")}</h4>
            <p>{resumen.queFalta}</p>
          </div>
          <div className="llano-bloque llano-accion">
            <h4>{tr("Qué te toca")}</h4>
            <p>{resumen.queTeToca}</p>
          </div>
          {typeof resumen.aprendizaje === 'string' && resumen.aprendizaje.trim() && (
            <div className="llano-bloque">
              <h4>{tr("Qué aprendió ROSA2018 hasta aquí")}</h4>
              <p>{resumen.aprendizaje}</p>
            </div>
          )}
          <p className="meta">
            {resumen.alDia?.fechaBusqueda ? (
              <>
                {tr("Evidencia buscada hasta el")} <Momento t={resumen.alDia.fechaBusqueda} ahora={Date.now()} />.
              </>
            ) : (
              tr('Sin consultas nuevas en esta iteración.')
            )}{' '}
            {resumen.alDia?.fuentesSinRespuesta.length ? trp("No respondieron: {v}.", { v: resumen.alDia.fuentesSinRespuesta.join('; ') }) : ''}
          </p>
          {resumen.terminos.length > 0 && (
            <details className="llano-glosario">
              <summary>{trp("Los términos que aparecen arriba ({terminos})", { terminos: resumen.terminos.length })}</summary>
              <dl>
                {resumen.terminos.map((t) => (
                  <div key={t.termino}>
                    <dt>{t.termino}</dt>
                    <dd>{t.explicacion}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}
    </Seccion>
  );
}

const VEREDICTO_VIABILIDAD: Record<ViabilidadPrueba['estado'], { etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'borde' }> = traducido({
  viable: { etiqueta: 'Sí, con estos ensayos', tono: 'ok' },
  limitada: { etiqueta: 'Solo en parte', tono: 'aviso' },
  inviable: { etiqueta: 'No con estos ensayos', tono: 'mal' },
  no_comprobable: { etiqueta: 'No pude comprobarlo', tono: 'borde' },
  sin_ensayos_nombrados: { etiqueta: 'La prueba no nombra ensayos', tono: 'borde' },
});

/** ¿Se puede hacer la prueba con los ensayos que nombra? ROSA2018 lo lee en los
 *  criterios de elegibilidad de ClinicalTrials.gov (rosa/viabilidad.py): un ensayo
 *  que excluyó a un grupo no puede decir nada sobre ese grupo. */
export function ViabilidadDeLaPrueba({ v }: { v: ViabilidadPrueba | null | undefined }) {
  if (!v || v.estado === 'sin_ensayos_nombrados') return null;
  const veredicto = VEREDICTO_VIABILIDAD[v.estado];
  const enlace = (nct: string) => (
    <a className="enlace" href={`https://clinicaltrials.gov/study/${nct}`} target="_blank" rel="noreferrer">
      {nct}
    </a>
  );
  return (
    <div className="viabilidad">
      <h4>
        {tr("¿Se puede hacer la prueba con los datos que existen?")} <Chip tono={veredicto.tono}>{veredicto.etiqueta}</Chip>
      </h4>
      {v.explicacion && <p>{v.explicacion}</p>}
      {v.exclusiones.length > 0 && (
        <ul className="viabilidad-exclusiones">
          {v.exclusiones.map((x) => (
            <li key={`${x.nct}-${x.criterio.slice(0, 20)}`}>
              <strong>{x.titulo || x.nct}</strong> ({enlace(x.nct)}) excluyó: <q>{x.criterio}</q>
            </li>
          ))}
        </ul>
      )}
      {v.alternativa && <p className="meta">{trp("Dónde sí puede estar ese grupo: {alternativa}", { alternativa: v.alternativa })}</p>}
      {v.ensayos.length > 0 && (
        <p className="meta">
          {tr("Leído en ClinicalTrials.gov:")}{' '}
          {v.ensayos.map((x, i) => (
            <span key={x.nct}>
              {i > 0 ? ', ' : ''}
              {x.acronimo || x.nct} ({enlace(x.nct)}
              {x.participantes ? `, ${x.participantes} participantes` : ''})
            </span>
          ))}
          .
        </p>
      )}
      {v.sinRespuesta.length > 0 && <p className="meta">{trp("El registro no respondió para {v}: no se pudo consultar, y ROSA2018 lo vuelve a intentar.", { v: v.sinRespuesta.join(', ') })}</p>}
      {v.noEncontrados.length > 0 && <p className="meta">{trp("Sin ensayos de fase 2 o 3 en el registro para {v}; pueden estar registrados con otro nombre.", { v: v.noEncontrados.join(', ') })}</p>}
    </div>
  );
}
