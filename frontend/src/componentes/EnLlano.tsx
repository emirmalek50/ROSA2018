// Lo que hizo ROSA2018, contado para quien no es cientifico. Dos piezas: el
// resumen en llano de una iteracion (que buscaba, que encontro, que propone,
// que falta, que te toca, glosario) y la hipotesis en tres frases. Van
// antes del detalle tecnico, no despues: es lo primero que se lee.

import type { ConclusionHipotesis, ResumenLlano, ViabilidadPrueba } from '../datos/tipos';
import { CERTEZA_EVIDENCIA, DIRECCION_EVIDENCIA, FACTOR_CERTEZA } from '../lib/etiquetas';
import { Chip } from './piezas';
import { Momento, Seccion } from './piezas';
import { traducido, tr } from '../lib/idioma';

export function ResumenEnLlano({ resumen, numero, abierta = true }: { resumen: ResumenLlano | null | undefined; numero: number; abierta?: boolean }) {
  if (resumen === undefined) return null;
  return (
    <Seccion titulo={`Qué encontró ROSA2018 en la iteración ${numero}`} nota={tr("Contado en lenguaje corriente, con cada término técnico definido al final. El detalle con citas, veredictos y pistas está más abajo.")}>
      {resumen === null ? (
        <p className="meta">{tr("ROSA2018 no pudo escribir el resumen de esta iteración (el modelo no respondió). El resumen técnico está en las iteraciones anteriores.")}</p>
      ) : (
        <div className={`llano ${abierta ? '' : 'llano-compacto'}`}>
          {resumen.titulo && <p className="llano-pregunta">{resumen.titulo}</p>}
          {resumen.mensajesClave.length > 0 && (
            <div className="llano-bloque llano-clave">
              <h4>Mensajes clave</h4>
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
            {resumen.alDia?.fuentesSinRespuesta.length ? `No respondieron: ${resumen.alDia.fuentesSinRespuesta.join('; ')}.` : ''}
          </p>
          {resumen.terminos.length > 0 && (
            <details className="llano-glosario">
              <summary>{tr("Los términos que aparecen arriba (")}{resumen.terminos.length})</summary>
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
      {v.alternativa && <p className="meta">{tr("Dónde sí puede estar ese grupo:")} {v.alternativa}</p>}
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
      {v.sinRespuesta.length > 0 && <p className="meta">{tr("El registro no respondió para")} {v.sinRespuesta.join(', ')}{tr(": no se pudo consultar, y ROSA2018 lo vuelve a intentar.")}</p>}
      {v.noEncontrados.length > 0 && <p className="meta">{tr("Sin ensayos de fase 2 o 3 en el registro para")} {v.noEncontrados.join(', ')}{tr("; pueden estar registrados con otro nombre.")}</p>}
    </div>
  );
}

export function HipotesisEnLlano({ texto }: { texto: string | null | undefined }) {
  if (texto === undefined) return null;
  return (
    <div className="llano llano-hipotesis">
      <h4>{tr("En pocas palabras")}</h4>
      {texto === null ? <p className="meta">{tr("ROSA2018 todavía no escribió el resumen de esta hipótesis.")}</p> : <p>{texto}</p>}
    </div>
  );
}


/** La conclusion provisional de ROSA2018: cuanto apoya la evidencia reunida a la
 *  hipotesis, que la apoya, que la debilita, de que depende y que la
 *  cambiaria. Distinta de la prueba, que es un experimento. */
export function ConclusionDeRosa({ conclusion, ahora }: { conclusion: ConclusionHipotesis | null | undefined; ahora: number }) {
  if (conclusion === undefined) return null;
  if (conclusion === null) {
    return (
      <Seccion titulo={tr("Conclusión de ROSA2018")}>
        <p className="meta">{tr("ROSA2018 todavía no escribió su conclusión sobre esta hipótesis. La escribe al crearla y la rehace al cerrar cada iteración con la evidencia que le haya llegado desde entonces.")}</p>
      </Seccion>
    );
  }
  const g = CERTEZA_EVIDENCIA[conclusion.certeza];
  const d = DIRECCION_EVIDENCIA[conclusion.direccion];
  const b = conclusion.base;
  return (
    <Seccion
      titulo={tr("Conclusión de ROSA2018")}
      nota={tr("Dos cosas distintas, como en GRADE: cuanto se puede fiar uno de la evidencia reunida (certeza) y hacia donde apunta (dirección). Ninguna dice si la hipótesis es cierta: eso lo decide un experimento. Se rehace al cerrar cada iteración: lo que ROSA2018 lee después de nacer la hipótesis se le suma (a favor, indirecto o en contra) y la certeza se recalcula.")}
      acciones={
        <span className="meta">
          {tr("Iteración")} {conclusion.iteracion} · <Momento t={conclusion.fecha} ahora={ahora} />
        </span>
      }
    >
      <div className="llano conclusion">
        <div className="conclusion-grado">
          <Chip tono={g.tono} title={g.nota}>
            {g.etiqueta}
          </Chip>
          <Chip tono={d.tono}>{d.etiqueta}</Chip>
          <span className="meta">
            Se apoya en {b.sostenidas} de {b.afirmaciones} {tr("afirmaciones sostenidas, de")} {b.fuentes} {b.fuentes === 1 ? 'fuente' : 'fuentes'}
            {b.interpretaciones > 0 ? `; ${b.interpretaciones} ${b.interpretaciones === 1 ? tr('es interpretación') : tr('son interpretaciones')}, no datos` : ''}.
          </span>
        </div>
        <p className="meta">{g.nota}</p>
        {conclusion.techo && (
          <p className="meta">
            {tr("Nivel máximo con lo que hay, por regla:")} <strong>{CERTEZA_EVIDENCIA[conclusion.techo.nivel].etiqueta.replace('Certeza ', '')}</strong>, porque {conclusion.techo.motivo}.
            {conclusion.techo.acotada && ` El juez había dicho «${CERTEZA_EVIDENCIA[conclusion.techo.certezaDelJuez].etiqueta.toLowerCase()}»; la regla lo acotó.`}
          </p>
        )}
        {conclusion.escalera && conclusion.escalera.length > 0 && (
          <div className="conclusion-escalera">
            <h4>{tr("Para subir")}</h4>
            <ol>
              {conclusion.escalera.map((p) => (
                <li key={p.a}>
                  <strong>A {CERTEZA_EVIDENCIA[p.a].etiqueta.replace('Certeza ', 'certeza ')}:</strong> {p.falta}.
                </li>
              ))}
            </ol>
            {conclusion.subiria && <p className="meta">{tr("Lo que el juez pide en concreto:")} {conclusion.subiria}</p>}
          </div>
        )}
        <p className="conclusion-enunciado">{conclusion.enunciado}</p>
        {conclusion.cambio && (
          <p className="meta">
            {tr("Cambio respecto a la iteración")} {conclusion.cambio.de.iteracion ?? '?'}: antes {conclusion.cambio.de.certeza ? CERTEZA_EVIDENCIA[conclusion.cambio.de.certeza].etiqueta.toLowerCase() : tr('sin certeza')} y {conclusion.cambio.de.direccion ? DIRECCION_EVIDENCIA[conclusion.cambio.de.direccion].etiqueta.toLowerCase() : tr('sin dirección')}. {conclusion.cambio.motivo}
          </p>
        )}
        <p className="conclusion-texto">{conclusion.conclusion}</p>
        {conclusion.factores.length > 0 && (
          <div className="llano-bloque">
            <h4>{tr("Por qué esta certeza")}</h4>
            <ul className="factores">
              {conclusion.factores.map((f, i) => (
                <li key={i}>
                  <Chip tono={f.efecto === 'baja' ? 'mal' : f.efecto === 'sube' ? 'ok' : 'borde'}>{f.efecto === 'baja' ? 'Baja' : f.efecto === 'sube' ? 'Sube' : 'Neutro'}</Chip> <strong>{FACTOR_CERTEZA[f.factor]}.</strong> {f.explicacion}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="conclusion-columnas">
          <div className="llano-bloque">
            <h4>A favor</h4>
            {conclusion.aFavor.length === 0 ? <p className="meta">{tr("Nada directo.")}</p> : <ul>{conclusion.aFavor.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </div>
          <div className="llano-bloque">
            <h4>{tr("En contra o que la debilita")}</h4>
            {conclusion.enContra.length === 0 ? <p className="meta">{tr("Nada encontrado, lo cual no es lo mismo que nada que encontrar.")}</p> : <ul>{conclusion.enContra.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </div>
        </div>
        <div className="llano-bloque">
          <h4>{tr("De que depende más")}</h4>
          <p>{conclusion.loMasFragil}</p>
        </div>
        <div className="conclusion-columnas">
          <div className="llano-bloque llano-accion">
            <h4>{tr("Subiría la certeza si")}</h4>
            <p>{conclusion.subiria}</p>
          </div>
          <div className="llano-bloque llano-accion">
            <h4>{tr("Bajaría si")}</h4>
            <p>{conclusion.bajaria}</p>
          </div>
        </div>
        {conclusion.noComprobado.length > 0 && (
          <div className="llano-bloque">
            <h4>{tr("Qué no pudimos comprobar")}</h4>
            <ul>
              {conclusion.noComprobado.map((t, i) => (
                <li key={i} className="meta">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
        {conclusion.fechaBusqueda && (
          <p className="meta">
            {tr("Evidencia buscada hasta el")} <Momento t={conclusion.fechaBusqueda} ahora={ahora} />.
          </p>
        )}
      </div>
    </Seccion>
  );
}
