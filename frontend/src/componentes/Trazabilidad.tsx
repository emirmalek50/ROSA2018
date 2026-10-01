// La cadena de evidencia de una corrida como árbol plegable: cada consulta,
// las fuentes que trajo, y las afirmaciones que salieron de cada fuente con
// su veredicto. Es lo que un revisor pide para seguir una cifra hasta su
// origen sin abrir una hipótesis. Lee GET /api/corridas/{id}/evidencia y se
// refresca cuando la corrida cambia (el estado llega por SSE; aquí solo se
// vuelve a pedir la evidencia, que pesa poco). En modo muestra no hay
// servidor y la sección no se pinta.
//
// Espera (estándar de Emir, 19 de septiembre de 2026): mientras llega la
// primera respuesta de una corrida se enseña la silueta de la sección (el
// embudo, los filtros y tres filas del árbol) con aria-busy, en vez de un
// hueco que después salta. Las peticiones siguientes de la misma corrida
// (cada vez que cambia el gasto) no vuelven al esqueleto: el contenido que
// hay sigue siendo válido y se queda hasta que llega el nuevo. Si el
// servidor falla, la sección no se pinta, como antes; si acepta la conexión
// y no responde en 20 s, dice "no pude comprobar" con un botón para volver a
// pedirla (una fuente que no responde nunca es "no hay").

import { useEffect, useMemo, useState } from 'react';
import type { Corrida, TipoAfirmacion } from '../datos/tipos';
import { esTiempoAgotado, senalDeTope } from '../lib/diferido';
import { RIESGO_SESGO, TIPO_AFIRMACION, tipoAfirmacion, TIPO_ESTUDIO, TIPO_FUENTE, VEREDICTO } from '../lib/etiquetas';
import { construirArbol, enlaceDe, iteracionesDe, type Evidencia, type FiltroVeredicto, type NodoFuente } from '../lib/evidencia';
import { formatearEntero } from '../lib/formato';
import { Cargando, Esqueleto } from './Esqueleto';
import { Chip, Seccion } from './piezas';
import { tr } from '../lib/idioma';

const FILTROS: { clave: FiltroVeredicto; etiqueta: string }[] = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'sostenidas', etiqueta: 'Sostenidas y parciales' },
  { clave: 'bloqueadas', etiqueta: 'Bloqueadas' },
  { clave: 'sin_verificar', etiqueta: 'Sin comprobar' },
];

const TITULO = 'De la consulta a la afirmación';
const NOTA = 'Cada consulta, las fuentes que trajo y las afirmaciones que salieron de cada fuente con su veredicto. Una afirmación nace sin comprobar y cambia de color cuando el juez dictamina.';

/** Cuántas consultas pinta la silueta: las que la corrida ya tiene en el
 *  estado (busqueda.consultas), al menos una y hasta doce. */
export function consultasEnSilueta(corrida: Pick<Corrida, 'busqueda'>): number {
  return Math.min(12, Math.max(1, corrida.busqueda.consultas.length));
}

/** Una fila del árbol en gris (flecha, dos líneas de texto y dos chips), con
 *  las clases reales para medir lo mismo (79 a 98 px). */
function FilaGris({ i }: { i: number }) {
  return (
    <div className="arbol-fila">
      <Esqueleto alto={12} ancho={12} />
      <div className="arbol-texto">
        <Esqueleto alto={13} ancho={i % 3 === 1 ? '48%' : '36%'} />
        <Esqueleto alto={12} ancho={i % 3 === 2 ? '58%' : '70%'} />
      </div>
      <div className="arbol-cuentas">
        <Esqueleto className="esqueleto-chip" ancho={72} />
        <Esqueleto className="esqueleto-chip" ancho={96} />
      </div>
    </div>
  );
}

/** La silueta de la sección mientras responde el servidor: cinco pasos del
 *  embudo, la fila de filtros y una consulta por cada una que la corrida ya
 *  tiene en el estado, cada una abierta con dos fuentes debajo, como el
 *  árbol real (medido: cada consulta abierta ocupa entre 150 y 560 px, unos
 *  240 de media). Las mismas clases y medidas que el contenido real. */
function EsqueletoTrazabilidad({ consultas }: { consultas: number }) {
  return (
    <Cargando
      activo
      rotulo="la cadena de evidencia"
      esqueleto={
        <div aria-hidden="true" style={{ pointerEvents: 'none' }}>
          <div className="embudo embudo-compacto">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="embudo-paso">
                <Esqueleto alto={22} ancho={i === 4 ? 96 : 48} />
                <Esqueleto alto={12} ancho={i === 2 || i === 4 ? '85%' : '55%'} />
              </div>
            ))}
          </div>
          <div className="filtros-arbol">
            {[72, 150, 88, 104].map((ancho, i) => (
              <Esqueleto key={i} className="esqueleto-chip" ancho={ancho} />
            ))}
            <Esqueleto alto={28} ancho={120} radio={6} />
          </div>
          <ul className="arbol">
            {Array.from({ length: consultas }, (_, i) => (
              <li key={i} className="arbol-nodo">
                <FilaGris i={i} />
                <ul className="arbol-hijos">
                  {[0, 1].map((j) => (
                    <li key={j} className="arbol-nodo">
                      <FilaGris i={i + j + 1} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      }
    >
      {null}
    </Cargando>
  );
}

/** Las pestañas de iteración en gris para la cabecera de la sección, cuando
 *  la corrida ya va por más de una (la real pone una por iteración con
 *  evidencia; el estado sabe la iteración actual). */
function PestanasGrises({ iteraciones }: { iteraciones: number }) {
  return (
    <div className="pestanas pestanas-s" aria-hidden="true">
      {Array.from({ length: Math.min(8, iteraciones) }, (_, i) => (
        <Esqueleto key={i} alto={38} ancho={85} />
      ))}
    </div>
  );
}

export function Trazabilidad({ corrida, activa }: { corrida: Corrida; activa: boolean }) {
  // La evidencia va etiquetada con la corrida que la pidió: al cambiar de
  // corrida, la de la anterior no se enseña mientras llega la nueva.
  const [evidencia, setEvidencia] = useState<{ corridaId: string; datos: Evidencia } | null>(null);
  // La corrida cuya primera petición ya respondió (bien o mal). Mientras no
  // sea la actual, se enseña el esqueleto.
  const [respondida, setRespondida] = useState<string | null>(null);
  // La corrida cuya petición venció el tope de tiempo sin respuesta: se
  // enseña "no pude comprobar" con el botón de volver a pedir.
  const [sinRespuesta, setSinRespuesta] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [iteracion, setIteracion] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroVeredicto>('todas');
  const [tipo, setTipo] = useState<TipoAfirmacion | 'todos'>('todos');
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  // Se vuelve a pedir cuando cambia el gasto (cada llamada al modelo lo mueve)
  // o el número de consultas: es la señal barata de que hay evidencia nueva.
  const clave = `${corrida.id}:${corrida.gasto.llamadas}:${corrida.busqueda.consultas.length}:${corrida.estado}`;
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    const corridaId = corrida.id;
    setSinRespuesta(null);
    // Al volver a pedir (o al cambiar de corrida) la respuesta anterior deja de
    // valer: sin esto, tras "Volver a pedir" la sección se quedaba vacía hasta
    // que el servidor contestaba, en vez de enseñar la silueta.
    setRespondida(null);
    fetch(`/api/corridas/${encodeURIComponent(corridaId)}/evidencia`, { cache: 'no-store', ...senalDeTope() })
      .then((r) => (r.ok ? (r.json() as Promise<Evidencia>) : null))
      .then((d) => {
        if (vivo && d) setEvidencia({ corridaId, datos: d });
      })
      .catch((error: unknown) => {
        // Sin servidor no hay evidencia que enseñar y la sección queda vacía;
        // si el tope de tiempo venció, se dice.
        if (vivo && esTiempoAgotado(error)) setSinRespuesta(corridaId);
      })
      .finally(() => {
        if (vivo) setRespondida(corridaId);
      });
    return () => {
      vivo = false;
    };
  }, [clave, activa, corrida.id, intento]);

  const datos = evidencia !== null && evidencia.corridaId === corrida.id ? evidencia.datos : null;
  const iteraciones = useMemo(() => (datos ? iteracionesDe(datos) : []), [datos]);
  const actual = iteracion ?? iteraciones[iteraciones.length - 1] ?? null;
  const arbol = useMemo(() => (datos && actual !== null ? construirArbol(datos, actual, filtro, tipo) : null), [datos, actual, filtro, tipo]);

  if (!activa) return null;
  if (datos === null && respondida !== corrida.id) {
    return (
      <Seccion detalle titulo={TITULO} nota={NOTA} acciones={corrida.iteracionActual > 1 ? <PestanasGrises iteraciones={corrida.iteracionActual} /> : undefined}>
        <EsqueletoTrazabilidad consultas={consultasEnSilueta(corrida)} />
      </Seccion>
    );
  }
  if (datos === null && sinRespuesta === corrida.id) {
    return (
      <Seccion detalle titulo={TITULO} nota={NOTA}>
        <div className="acciones">
          <span className="meta">{tr("No pude comprobar la cadena de evidencia: el servidor no respondió a tiempo.")}</span>
          <button type="button" className="btn btn-s" onClick={() => setIntento((i) => i + 1)}>
            Volver a pedir
          </button>
        </div>
      </Seccion>
    );
  }
  if (datos === null || arbol === null || actual === null) return null;

  const alternar = (id: string) => {
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const e = arbol.embudo;

  return (
    <Seccion
      detalle titulo={TITULO}
      nota={NOTA}
      acciones={
        iteraciones.length > 1 ? (
          <div className="pestanas pestanas-s" role="tablist">
            {iteraciones.map((n) => (
              <button key={n} type="button" role="tab" aria-selected={n === actual} className={n === actual ? 'activa' : ''} onClick={() => setIteracion(n)}>
                {tr("Iteración")} {n}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="embudo embudo-compacto">
        <div className="embudo-paso">
          <strong>{formatearEntero(e.consultas)}</strong>
          <span>consultas</span>
        </div>
        <div className="embudo-paso">
          <strong>{formatearEntero(e.identificados)}</strong>
          <span>identificados</span>
        </div>
        <div className="embudo-paso">
          <strong>{formatearEntero(e.fuentes)}</strong>
          <span>fuentes leídas · {e.textoCompleto} a texto completo</span>
        </div>
        <div className="embudo-paso">
          <strong>{formatearEntero(e.afirmaciones)}</strong>
          <span>afirmaciones</span>
        </div>
        <div className="embudo-paso">
          <strong>
            <span className="tono-ok">{e.sostenidas}</span> · <span className="tono-aviso">{e.parciales + e.sinVerificar}</span> · <span className="tono-mal">{e.bloqueadas}</span>
          </strong>
          <span>{tr("sostenidas · parciales o sin comprobar · bloqueadas")}</span>
        </div>
      </div>

      <div className="filtros-arbol">
        <div className="pestanas pestanas-s" role="tablist" aria-label={tr("Filtrar por veredicto")}>
          {FILTROS.map((f) => (
            <button key={f.clave} type="button" role="tab" aria-selected={filtro === f.clave} className={filtro === f.clave ? 'activa' : ''} onClick={() => setFiltro(f.clave)}>
              {f.etiqueta}
            </button>
          ))}
        </div>
        <label className="campo-inline">
          Tipo
          <select value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoAfirmacion | 'todos')}>
            <option value="todos">Todos</option>
            {(Object.keys(TIPO_AFIRMACION) as TipoAfirmacion[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_AFIRMACION[t].etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      {arbol.nodos.length === 0 && <p className="meta">{tr("Esta iteración todavía no tiene consultas ni fuentes.")}</p>}

      <ul className="arbol" role="tree">
        {arbol.nodos.map((n) => {
          const idNodo = `c-${actual}-${n.numero}`;
          const abierta = !abiertas.has(idNodo);
          const nAf = n.fuentes.reduce((s, f) => s + f.afirmaciones.length, 0);
          return (
            <li key={idNodo} className="arbol-nodo" role="treeitem" aria-expanded={abierta}>
              <button type="button" className="arbol-fila" onClick={() => alternar(idNodo)}>
                <span className="arbol-flecha" aria-hidden="true">
                  {abierta ? '▾' : '▸'}
                </span>
                <span className="arbol-icono" aria-hidden="true">
                  ⌕
                </span>
                <span className="arbol-texto">
                  {n.consulta ? (
                    <>
                      <strong>Consulta {n.numero}</strong> <span className="meta">{n.consulta.base}</span>
                      {n.consulta.tema && <span className="arbol-detalle">{n.consulta.tema}</span>}
                    </>
                  ) : (
                    <>
                      <strong>Otras fuentes</strong>
                      <span className="arbol-detalle">{tr("Ensayos registrados y fuentes sin consulta anotada")}</span>
                    </>
                  )}
                </span>
                <span className="arbol-cuentas">
                  {n.consulta && <span className="meta">{formatearEntero(n.consulta.resultados)} resultados</span>}
                  <Chip tono="borde">{n.fuentes.length} fuentes</Chip>
                  <Chip tono="borde">{nAf} afirmaciones</Chip>
                </span>
              </button>
              {abierta && n.consulta && <code className="arbol-consulta">{n.consulta.consulta}</code>}
              {abierta && (
                <ul className="arbol-hijos" role="group">
                  {n.fuentes.length === 0 && <li className="meta arbol-vacio">{tr("Ninguna fuente pasó el cribado de relevancia.")}</li>}
                  {n.fuentes.map((f) => (
                    <Fuente key={f.fuente.id} nodo={f} abierta={abiertas.has(`f-${f.fuente.id}`)} onAlternar={() => alternar(`f-${f.fuente.id}`)} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Seccion>
  );
}

function Fuente({ nodo, abierta, onAlternar }: { nodo: NodoFuente; abierta: boolean; onAlternar: () => void }) {
  const f = nodo.fuente;
  const enlace = enlaceDe(f);
  const bloqueadas = nodo.afirmaciones.filter((a) => VEREDICTO[a.veredicto].bloquea).length;
  return (
    <li className="arbol-nodo" role="treeitem" aria-expanded={abierta}>
      <button type="button" className="arbol-fila" onClick={onAlternar}>
        <span className="arbol-flecha" aria-hidden="true">
          {abierta ? '▾' : '▸'}
        </span>
        <span className="arbol-icono" aria-hidden="true">
          ▤
        </span>
        <span className="arbol-texto">
          <strong>{f.referencia}</strong> <span className="meta">{TIPO_FUENTE[f.tipo]}{f.tipoEstudio && f.tipoEstudio in TIPO_ESTUDIO ? ` · ${TIPO_ESTUDIO[f.tipoEstudio as keyof typeof TIPO_ESTUDIO]}` : ''}</span>
          <span className="arbol-detalle">{f.titulo}</span>
        </span>
        <span className="arbol-cuentas">
          {f.riesgoSesgo && f.riesgoSesgo.global !== 'no_aplica' && (
            <Chip tono={RIESGO_SESGO[f.riesgoSesgo.global]?.tono ?? 'borde'} title={`${f.riesgoSesgo.instrumento}: ${f.riesgoSesgo.dominios.map((d) => `${d.id} ${d.nombre}: ${d.juicio.replace('_', ' ')}`).join('; ')}. Veredicto por regla desde las preguntas de señalización.`}>
              {f.riesgoSesgo.instrumento} {RIESGO_SESGO[f.riesgoSesgo.global]?.etiqueta ?? f.riesgoSesgo.global}
            </Chip>
          )}
          {f.retraccion === 'retractado' && <Chip tono="mal">Retractado</Chip>}
          {f.retraccion === 'preocupacion' && <Chip tono="aviso">{tr("Expresión de preocupación")}</Chip>}
          {f.retraccion === 'erratum' && <Chip tono="aviso">Erratum</Chip>}
          <Chip tono="borde" title={tr("Puntuación de relevancia del cribado, 0 a 10")}>
            relevancia {f.relevancia}
          </Chip>
          <Chip tono={f.textoCompleto ? 'acento' : 'borde'}>{f.textoCompleto ? `texto completo · ${f.fragmentos} fragmentos` : 'solo resumen'}</Chip>
          <Chip tono={bloqueadas > 0 ? 'mal' : 'borde'}>
            {nodo.afirmaciones.length} afirmaciones{bloqueadas > 0 ? ` · ${bloqueadas} bloqueadas` : ''}
          </Chip>
        </span>
      </button>
      {abierta && (
        <div className="arbol-hijos">
          <div className="arbol-meta meta">
            {enlace && (
              <a className="enlace" href={enlace} target="_blank" rel="noreferrer">
                {f.doi ? `DOI ${f.doi}` : f.pmid ? `PMID ${f.pmid}` : f.nct}
              </a>
            )}
            {f.anio && <span>{f.anio}</span>}
            {f.modo === 'amplitud' && <Chip tono="acento" title={f.porque ? `Llegó por búsqueda en amplitud. Se conservó porque podría cambiar: ${f.porque}` : 'Llegó por búsqueda en amplitud'}>Amplitud</Chip>}
            {nodo.tambienEn.length > 0 && <span>{tr("También la trajo la consulta")} {nodo.tambienEn.join(', ')}</span>}
            {f.retraccionDetalle && <span>Crossref: {f.retraccionDetalle}</span>}
            {!f.extraida && <span>{tr("Todavía sin extraer")}</span>}
          </div>
          <ul className="arbol-afirmaciones" role="group">
            {nodo.afirmaciones.length === 0 && <li className="meta arbol-vacio">{tr("Sin afirmaciones que pasen el filtro.")}</li>}
            {nodo.afirmaciones.map((a) => {
              const v = VEREDICTO[a.veredicto];
              return (
                <li key={a.id} className={`arbol-afirmacion tono-borde-${v.tono}`}>
                  <span className="arbol-icono" aria-hidden="true">
                    {v.tono === 'ok' ? '✓' : v.tono === 'mal' ? '✗' : '⚠'}
                  </span>
                  <div className="arbol-texto">
                    <span>{a.texto}</span>
                    <span className="arbol-detalle">
                      <Chip tono={v.tono}>{v.etiqueta}</Chip> <Chip tono="borde">{tipoAfirmacion(a.tipo).etiqueta}</Chip> <span className="meta">{a.cita}</span>
                      {a.entidadDistinta && <Chip tono="mal">otra entidad</Chip>}
                    </span>
                    {a.motivo && a.veredicto !== 'sostenida' && <span className="arbol-motivo meta">{a.motivo}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}
