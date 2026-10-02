// El tablero de calidad: metricas del juez, acierto por tipo de afirmacion
// (dato, literatura, interpretacion), calibracion del revisor frente a las
// decisiones humanas, agujeros de conejo (significativo pero irrelevante),
// coste por hipotesis, los casos de control (los 17 del RAG, sin aprobar) y
// las optimizaciones de GEPA con su enlace a MLflow.

import { CostesPorDecision, PanelKiller } from '../componentes/Rosa2018';
import { useState } from 'react';
import { acciones, cabeceras } from '../datos/almacen';
import type { CasoControl, EstadoRosa, Investigacion } from '../datos/tipos';
import { IconExternal } from '../componentes/icons';
import { AvisoMuestra, Chip, Confirmar, Momento, Seccion } from '../componentes/piezas';
import { agujerosDeConejo, calibracion } from '../lib/calidad';
import { acuerdoDe, acuerdoPorComprobacion } from '../lib/acuerdo';
import { CATEGORIA_CASO, COMPROBACION_KILLER, ESTADO_CASO, TIPO_AFIRMACION } from '../lib/etiquetas';
import { coma, formatearPorcentaje } from '../lib/formato';
import { rutaDe } from '../lib/ruta';
import { atributosEnVuelo } from '../lib/diferido';
import { tr, trp } from '../lib/idioma';

function Caso({ c }: { c: CasoControl }) {
  const [respuesta, setRespuesta] = useState(c.respuestaEsperada);
  return (
    <article className="tarjeta caso">
      <div className="caso-cabecera">
        <Chip>{CATEGORIA_CASO[c.categoria]}</Chip>
        {c.critico && <Chip tono="aviso">{tr("Importante")}</Chip>}
        <Chip tono={c.estado === 'aprobado' ? 'ok' : c.estado === 'descartado' ? 'mal' : undefined}>{ESTADO_CASO[c.estado]}</Chip>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          {(c.origen === 'generado' ? tr("Propuesto por el RAG") : tr("Escrito a mano"))}
        </span>
      </div>
      <p className="caso-pregunta">{c.pregunta}</p>
      <div className="campo">
        <label htmlFor={`resp-${c.clave}`}>{tr("Respuesta esperada")}</label>
        <textarea
          id={`resp-${c.clave}`}
          className="caso-respuesta"
          value={respuesta}
          onChange={(e) => setRespuesta(e.target.value)}
          onBlur={() => {
            if (respuesta.trim() === '') {
              setRespuesta(c.respuestaEsperada);
              return;
            }
            acciones.editarRespuestaCaso(c.clave, respuesta);
          }}
          disabled={c.estado === 'descartado'}
        />
        <small>{tr("Se guarda al salir del campo. Vaciarla no la borra: un caso sin respuesta no tiene criterio para juzgarse.")}</small>
      </div>
      <div className="acciones">
        {c.estado !== 'aprobado' && (
          <button type="button" className="btn btn-primario btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'aprobado')}>
            {tr("Aprobar")}
          </button>
        )}
        {c.estado !== 'descartado' && (
          <button type="button" className="btn btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'descartado')}>
            {tr("Descartar")}
          </button>
        )}
        {c.estado !== 'propuesto' && (
          <button type="button" className="btn btn-fantasma btn-s" onClick={() => acciones.cambiarEstadoCaso(c.clave, 'propuesto')}>
            {tr("Volver a por revisar")}
          </button>
        )}
      </div>
    </article>
  );
}

export function Calidad({ inv, estado, ahora }: { inv: Investigacion; estado: EstadoRosa; ahora: number }) {
  // Qué control de GEPA espera respuesta del servidor: ese botón se enseña en
  // vuelo (spinner y aria-busy) y los tres quedan bloqueados hasta que responda.
  const [accionGepa, setAccionGepa] = useState<'pausar' | 'reanudar' | 'restablecer' | null>(null);
  const controlandoGepa = accionGepa !== null;
  const [avisoGepa, setAvisoGepa] = useState('');
  async function controlarGepa(accion: 'pausar' | 'reanudar' | 'restablecer') {
    setAccionGepa(accion);
    try {
      const r = await fetch(`/api/gepa/${accion}`, { method: 'POST', headers: cabeceras() });
      if (!r.ok) throw new Error(r.status === 403 ? tr('Solo administración puede cambiar la optimización global.') : tr('No se pudo confirmar el cambio.'));
      setAvisoGepa(tr('Cambio confirmado. Las corridas actuales conservan sus versiones.'));
    } catch (error) {
      setAvisoGepa(error instanceof Error ? error.message : tr('No se pudo confirmar el cambio.'));
    } finally {
      setAccionGepa(null);
    }
  }
  const [filtro, setFiltro] = useState<CasoControl['estado'] | 'todos'>('propuesto');
  const casos = estado.casos.filter((c) => filtro === 'todos' || c.estado === filtro);
  const aprobados = estado.casos.filter((c) => c.estado === 'aprobado').length;
  const ultima = [...estado.metricas].sort((a, b) => b.fecha - a.fecha)[0];
  const propias = estado.hipotesis.filter((h) => h.investigacionId === inv.id);
  const cal = calibracion(propias);
  const conejos = agujerosDeConejo(propias);
  const tiposCuenta = { dato: 0, literatura: 0, interpretacion: 0 };
  for (const h of propias) for (const a of h.afirmaciones) tiposCuenta[a.tipo]++;
  const costeTotal = propias.reduce((n, h) => n + h.coste.literatura + h.coste.analisis, 0);

  return (
    <div className="contenido">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{tr("Calidad")}</h2>
          <p>
            {trp("El juez se calibra con casos aprobados por personas antes de fijarlo. Hoy hay {aprobados} de {casos} aprobados: con cero, las métricas de acuerdo no significan nada.", { aprobados, casos: estado.casos.length })}
          </p>
        </div>
      </div>

      <Seccion detalle titulo={tr("Métricas del juez")} nota={ultima ? trp("Última medición con {juez}", { juez: ultima.juez }) : tr('Sin mediciones')} acciones={ultima ? <Momento t={ultima.fecha} ahora={ahora} /> : undefined}>
        {ultima && (
          <div className="metricas">
            <div className="gasto-item">
              <strong>{ultima.acuerdoConHumanos === null || ultima.acuerdoConHumanos === undefined ? tr('Sin etiquetas') : `kappa ${ultima.acuerdoConHumanos}`}</strong>
              <span>{tr("acuerdo juez-humano (conjunto dorado)")}</span>
            </div>
            <div className="gasto-item">
              <strong>{formatearPorcentaje(ultima.sostenidas)}</strong>
              <span>{tr("afirmaciones sostenidas")}</span>
            </div>
            <div className="gasto-item">
              <strong>{formatearPorcentaje(ultima.cobertura)}</strong>
              <span>{tr("cobertura de los puntos")}</span>
            </div>
            <div className="gasto-item">
              <strong>{ultima.ausenciasRefutadas}</strong>
              <span>{tr("ausencias refutadas")}</span>
            </div>
            <div className="gasto-item">
              <strong>{ultima.entidadDistinta}</strong>
              <span>{tr("datos de otra entidad")}</span>
            </div>
            <div className="gasto-item">
              <strong>{formatearPorcentaje(ultima.sinVerificar)}</strong>
              <span>{tr("\"sin verificar\" cuando no sabe")}</span>
            </div>
          </div>
        )}
      </Seccion>

      <Seccion titulo={tr("Conjunto dorado: acuerdo juez-humano por comprobación")} nota={tr("Cada etiqueta que una persona pone sobre una comprobación del Killer (en la ficha de la hipótesis) entra aquí. Kappa de Cohen corrige el acuerdo por el azar; se mide por comprobación, no en promedio, porque el juez puede acertar en citas y fallar en sesgo. Hacen falta al menos 100 casos por comprobación (200 si el fallo es raro) para que la cifra sea estable; hasta entonces es orientativa.")}>
        {(() => {
          const casos = estado.conjuntoDorado ?? [];
          if (casos.length === 0) return <p className="meta">{tr("Sin etiquetas todavía. Abre una hipótesis juzgada por el Killer y marca en cada comprobación tu veredicto.")}</p>;
          const global = acuerdoDe(casos);
          const porComp = acuerdoPorComprobacion(casos);
          return (
            <>
              <div className="acciones" style={{ marginBottom: 8 }}>
                <Chip tono={global.kappa !== null && global.kappa >= 0.61 ? 'ok' : 'aviso'}>{trp("Global: kappa {v} ({interpretacion})", { v: global.kappa ?? 'n/a', interpretacion: global.interpretacion })}</Chip>
                <span className="meta">{trp("{n} etiquetas; acuerdo bruto {v}", { n: global.n, v: global.bruto === null ? 'n/a' : formatearPorcentaje(global.bruto) })}</span>
              </div>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>{tr("Comprobación")}</th>
                    <th>{tr("Etiquetas")}</th>
                    <th>{tr("Acuerdo bruto")}</th>
                    <th>{tr("Kappa")}</th>
                    <th>{tr("Lectura")}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(porComp).map(([c, a]) => (
                    <tr key={c}>
                      <td>{COMPROBACION_KILLER[c] ?? c}</td>
                      <td className="num">{a.n}</td>
                      <td className="num">{a.bruto === null ? 'n/a' : formatearPorcentaje(a.bruto)}</td>
                      <td className="num">{a.kappa ?? 'n/a'}</td>
                      <td className="meta">{a.n < 5 ? tr('muy pocos casos') : a.interpretacion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          );
        })()}
      </Seccion>

      <Seccion detalle titulo={tr("Acierto por tipo de afirmación")} nota={tr("Kosmos midió 85 % en datos, 82 % en literatura y 58 % en interpretaciones. ROSA2018 lo mide igual, con las afirmaciones verificadas por personas, y enseña la fiabilidad de cada tipo.")}>
        <div className="rejilla-3">
          {(['dato', 'literatura', 'interpretacion'] as const).map((t) => {
            const v = ultima?.aciertoPorTipo[t] ?? null;
            return (
              <div key={t} className="tarjeta">
                <div className="acciones" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{TIPO_AFIRMACION[t].etiqueta}</strong>
                  <Chip tono={v === null ? 'borde' : v >= 0.8 ? 'ok' : v >= 0.65 ? 'aviso' : 'mal'}>{v === null ? tr('sin medir') : formatearPorcentaje(v)}</Chip>
                </div>
                <p className="meta" style={{ marginTop: 6 }}>
                  {trp("{nota} {v} en esta investigación.", { nota: TIPO_AFIRMACION[t].nota, v: tiposCuenta[t] })}</p>
                {v !== null && (
                  <div className="presupuesto-barra" style={{ marginTop: 8 }}>
                    <i style={{ width: `${v * 100}%`, background: v >= 0.8 ? 'var(--green)' : v >= 0.65 ? 'var(--amber)' : 'var(--red)' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Seccion>

      <PanelKiller estado={estado} />

      <CostesPorDecision investigacionId={inv.id} />

      {(() => {
        const casos = (estado.conjuntoDorado ?? []).map((c) => ({ c, d: (estado.decisiones ?? []).find((d) => d.id === c.decisionId) })).filter((x) => x.d?.contexto);
        if (casos.length < 5) return null;
        const tramos: [string, (n: number) => boolean][] = [
          [tr('menos de 50 hechos'), (n) => n < 50],
          [tr('50 a 200 hechos'), (n) => n >= 50 && n < 200],
          [tr('200 o más hechos'), (n) => n >= 200],
        ];
        return (
          <Seccion detalle titulo={tr("Acuerdo juez-humano según el tamaño del modelo de mundo")} nota={tr("Los modelos rinden peor cuando crece la entrada y aparecen distractores (context rot). Cada decisión del Killer guarda cuantos hechos había en el modelo de mundo al juzgar; si el acuerdo con las personas cae en los tramos grandes, la política de contexto tiene que recortar antes de que duela.")}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>{tr("Modelo de mundo al decidir")}</th>
                  <th>{tr("Etiquetas")}</th>
                  <th>{tr("Acuerdo bruto")}</th>
                  <th>{tr("Kappa")}</th>
                </tr>
              </thead>
              <tbody>
                {tramos.map(([nombre, pertenece]) => {
                  const sub = casos.filter((x) => pertenece(x.d!.contexto!.hechos)).map((x) => x.c);
                  const a = acuerdoDe(sub);
                  return (
                    <tr key={nombre}>
                      <td>{nombre}</td>
                      <td className="num">{a.n}</td>
                      <td className="num">{a.bruto === null ? 'n/a' : formatearPorcentaje(a.bruto)}</td>
                      <td className="num">{a.kappa ?? 'n/a'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Seccion>
        );
      })()}

      {(() => {
        const propias = (estado.decisiones ?? []).filter((d) => d.etapa === 'persona' && typeof d.segundosRevision === 'number' && estado.hipotesis.some((h) => h.id === d.hipotesisId && h.investigacionId === inv.id));
        const media = propias.length ? propias.reduce((a, d) => a + (d.segundosRevision ?? 0), 0) / propias.length : null;
        return (
          <Seccion titulo={tr("Carga de revisión")} nota={tr("Segundos entre abrir la ficha de una hipótesis y decidir sobre ella. Es la cifra con la que se compara ROSA2018 contra investigar sin ella: si revisar cuesta más que hacerlo a mano, pierde.")}>
            <p className="meta">
              {media === null ? tr('Sin decisiones humanas con tiempo medido todavía.') : (propias.length === 1 ? trp("{propias} decision medidas; media {media} s por decisión ({v} min).", { propias: propias.length, media: Math.round(media), v: (media / 60).toFixed(1) }) : trp("{propias} decisiones medidas; media {media} s por decisión ({v} min).", { propias: propias.length, media: Math.round(media), v: (media / 60).toFixed(1) }))}
            </p>
          </Seccion>
        );
      })()}

      <Seccion detalle titulo={tr("Calibración del revisor frente a las personas")} nota={tr("Qué recomendaba el revisor (bloquear o pasar) frente a lo que decidió una persona. Los desacuerdos son el conjunto de entrenamiento de GEPA para el juez.")}>
        <div className="rejilla-2">
          <table className="tabla matriz">
            <thead>
              <tr>
                <th></th>
                <th>{tr("Persona descartó")}</th>
                <th>{tr("Persona aceptó")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{tr("Revisor: bloquear")}</th>
                <td className="num tono-ok">{cal.bloquearYDescartada}</td>
                <td className="num tono-mal">{cal.bloquearYAceptada}</td>
              </tr>
              <tr>
                <th>{tr("Revisor: pasar")}</th>
                <td className="num tono-mal">{cal.pasarYDescartada}</td>
                <td className="num tono-ok">{cal.pasarYAceptada}</td>
              </tr>
            </tbody>
          </table>
          <div className="tarjeta">
            <p className="campo-etiqueta">{tr("Acuerdo")}</p>
            <p style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{cal.acuerdo === null ? tr('Sin decisiones') : formatearPorcentaje(cal.acuerdo)}</p>
            {cal.desacuerdos.length > 0 ? (
              <ul className="lista-limpia" style={{ marginTop: 8 }}>
                {cal.desacuerdos.map((d) => (
                  <li key={d.id}>
                    <a className="enlace" href={rutaDe(inv.id, 'hipotesis', d.id)}>
                      {d.titulo.length > 60 ? `${d.titulo.slice(0, 57)}...` : d.titulo}
                    </a>
                    <span className="meta">{trp("revisor {revisor}, persona {humano}", { revisor: d.revisor, humano: d.humano })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta" style={{ marginTop: 6 }}>
                {tr("Sin desacuerdos registrados.")}
              </p>
            )}
          </div>
        </div>
      </Seccion>

      <Seccion detalle titulo={tr("Agujeros de conejo y coste")} nota={tr("Hipótesis con evidencia estadística fuerte que una persona votó poco relevantes: lo que Kosmos reconoce como su fallo. Y cuánto costó cada una.")}>
        <div className="rejilla-2">
          <div className="tarjeta">
            <p className="campo-etiqueta">{tr("Significativas pero irrelevantes")}</p>
            <p style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{conejos.length}</p>
            {conejos.map((h) => (
              <a key={h.id} className="enlace" href={rutaDe(inv.id, 'hipotesis', h.id)} style={{ display: 'block', fontSize: 13 }}>
                {h.titulo}
              </a>
            ))}
          </div>
          <div className="tarjeta">
            <p className="campo-etiqueta">{tr("Coste por hipótesis")}</p>
            <p style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{trp("{v} $ en total", { v: coma(costeTotal.toFixed(1)) })}</p>
            <table className="tabla" style={{ marginTop: 6 }}>
              <tbody>
                {[...propias]
                  .sort((a, b) => b.coste.literatura + b.coste.analisis - (a.coste.literatura + a.coste.analisis))
                  .map((h) => (
                    <tr key={h.id}>
                      <td>
                        <a className="enlace" href={rutaDe(inv.id, 'hipotesis', h.id)}>
                          {h.titulo.length > 50 ? `${h.titulo.slice(0, 47)}...` : h.titulo}
                        </a>
                      </td>
                      <td className="num">{coma((h.coste.literatura + h.coste.analisis).toFixed(1))} $</td>
                      <td className="num meta">{trp("Elo {elo}", { elo: h.elo })}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </Seccion>

      <Seccion
        detalle titulo={tr("Casos de control")}
        nota={tr("Los 17 los propuso el RAG sobre otro corpus y ninguno está aprobado. Sirven para probar el ciclo; los del dominio del Alzheimer hay que escribirlos con el compañero.")}
        acciones={
          <div className="segmentos" role="group" aria-label={tr("Filtro de casos")}>
            {(['propuesto', 'aprobado', 'descartado', 'todos'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                {f === 'todos' ? 'Todos' : ESTADO_CASO[f]}
              </button>
            ))}
          </div>
        }
      >
        {casos.length === 0 ? <p className="meta">{tr("Ningún caso en este estado.")}</p> : casos.map((c) => <Caso key={c.clave} c={c} />)}
      </Seccion>

      <Seccion detalle titulo={tr("Optimizaciones con GEPA")} nota={tr("Captura continua y optimización automática por ciclos. Los candidatos se examinan con casos que GEPA no vio; solo los que mejoran sin regresiones se activan para nuevas corridas. Son métricas de un evaluador automático, no validación científica.")}>
        <p role="status">{estado.gepaAutomatico?.nota ?? tr('El servicio automático aún no ha informado de su estado en este servidor.')}</p>
        {estado.conexion === 'muestra' ? (
          <p className="meta">{tr("Con datos de muestra no hay servicio que controlar.")}</p>
        ) : (
        <div className="acciones">
          <button type="button" className="btn" disabled={controlandoGepa} {...atributosEnVuelo(accionGepa === 'pausar')} onClick={() => void controlarGepa('pausar')}>{tr("Pausar promociones")}</button>
          <button type="button" className="btn" disabled={controlandoGepa} {...atributosEnVuelo(accionGepa === 'reanudar')} onClick={() => void controlarGepa('reanudar')}>{tr("Reanudar")}</button>
          <Confirmar etiqueta={tr("Volver a programas base")} pregunta={tr("Se pausará GEPA y las nuevas corridas usarán los programas base. No cambia las corridas existentes ni borra las versiones guardadas. ¿Continuar?")} disabled={controlandoGepa} onConfirmar={() => void controlarGepa('restablecer')} />
        </div>
        )}
        {avisoGepa && <p role="status">{avisoGepa}</p>}
        {estado.gepaAutomatico && <p className="meta">{trp("{v} · Errores de registro: {erroresRegistro}. Programas con evaluación automática: {v2}.{v3} Solo administración puede pausar, reanudar o volver a base; una promoción queda también en el registro de aprendizaje (Ajustes) y se revierte desde allí.", { v: Object.entries(estado.gepaAutomatico.trazas).map(([tipo, n]) => `${tipo}: ${n}`).join(' · '), erroresRegistro: estado.gepaAutomatico.erroresRegistro, v2: estado.gepaAutomatico.programas.join(', '), v3: typeof estado.gepaAutomatico.gastoUsd === 'number' ? trp(" Gasto acumulado de la optimización: {v} $.", { v: coma(estado.gepaAutomatico.gastoUsd.toFixed(2)) }) : '' })}</p>}
        <table className="tabla">
          <thead>
            <tr>
              <th>{tr("Fecha")}</th>
              <th>{tr("Programa")}</th>
              <th>{tr("Presupuesto")}</th>
              <th className="num">{tr("Métrica inicial")}</th>
              <th className="num">{tr("Métrica final")}</th>
              <th className="num">{tr("Candidatos")}</th>
              <th className="num">{tr("Gasto")}</th>
              <th>{tr("Estado")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...estado.gepa]
              .sort((a, b) => b.fecha - a.fecha)
              .map((g) => (
                <tr key={g.id}>
                  <td>
                    <Momento t={g.fecha} ahora={ahora} />
                  </td>
                  <td className="mono">{g.programa}</td>
                  <td>{g.presupuesto}</td>
                  <td className="num">{g.estado === 'terminada' ? formatearPorcentaje(g.metricaInicial) : 'Pendiente'}</td>
                  <td className={`num ${g.metricaFinal > g.metricaInicial ? 'subida' : ''}`}>{g.estado === 'terminada' ? formatearPorcentaje(g.metricaFinal) : 'Pendiente'}</td>
                  <td className="num">{g.candidatos}</td>
                  <td className="num">{g.gasto ? `${coma(g.gasto.usd.toFixed(2))} $ · ${g.gasto.llamadas} llamadas` : tr('sin dato')}</td>
                  <td>{g.estado === 'en_marcha' ? <Chip tono="acento">{tr("En marcha")}</Chip> : g.estado === 'terminada' ? <Chip tono={g.promovido ? 'ok' : 'borde'}>{(g.promovido ? tr("Activado para nuevas corridas") : tr("Terminada"))}</Chip> : <Chip tono="mal">{tr("Fallida")}</Chip>}<p className="meta">{g.nota}</p></td>
                  <td>
                    {g.enlaceMlflow && <a className="enlace" href={g.enlaceMlflow} target="_blank" rel="noopener noreferrer">
                      MLflow <IconExternal />
                    </a>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="meta">{tr("Se comprueba si hay datos cada 10 minutos, con al menos seis horas entre ciclos y nunca mientras una corrida está en marcha. Los casos se separan por investigación; el examen final (al menos 8 casos, dos lecturas del juez por caso) exige mejora media de 0,05 sin ningún caso claramente peor. Se conserva cada versión anterior. El Killer y el juez no se autoentrenan con sus propios veredictos. Los prompts y las respuestas se guardan con redacción de secretos en el registro privado, no en esta pantalla. Pausar impide nuevas promociones; una petición al Gateway ya enviada puede terminar.")}</p>
      </Seccion>
    </div>
  );
}
