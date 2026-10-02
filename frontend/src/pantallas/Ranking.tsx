// El ranking: hipótesis ordenadas por Elo (torneo, como Co-Scientist), con
// su historial en una gráfica pequeña, el número de partidos (un Elo con
// pocos partidos es poco fiable), sus rivales, el coste y el origen (humana o
// de ROSA2018). Vista alternativa por cluster para ver diversidad: el mejor de
// cada cluster, como hace el agente de proximidad de Co-Scientist.
//
// Desde el 1 de octubre de 2026 (Emir) la pantalla abre en el podio: solo las
// tres primeras, en pedestales, con el porqué de la que se mira
// (componentes/PodioRanking.tsx). La lista completa, con las candidatas y el
// acuerdo del revisor, y la vista por cluster siguen a un clic.
//
// Esperas visibles (estándar de Emir, 19 de septiembre de 2026): todo lo
// derivado (orden por Elo, calibración, clusters, candidatas y por qué las
// demás no lo son, con los bloqueos de cada una) se calcula después de pintar
// la silueta de la lista (EsqueletoPantalla "lista"). Con muchas hipótesis,
// ese cálculo más el render de cada fila con su franja congelaba la pantalla
// al cambiar de investigación; ahora el primer frame es la silueta y el
// trabajo va detrás.

import { useMemo, useState } from 'react';
import { Contador, ElementoAnimado, ListaAnimada } from '../componentes/Animado';
import { FranjaRanking } from '../componentes/FranjaRanking';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import { AvisoMuestra, Chip } from '../componentes/piezas';
import { Candidatas } from '../componentes/Rosa2018';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjeta, EsqueletoTarjetas } from '../componentes/Esqueleto';
import { PodioRanking, delPodio, tituloPodio } from '../componentes/PodioRanking';
import { ColaHipotesis, FormularioHipotesis } from '../componentes/ColaHipotesis';
import { calibracion } from '../lib/calidad';
import { useCalculoDiferido } from '../lib/diferido';
import { DECISION_KILLER, ESTADO_HIPOTESIS, killerPendienteDe } from '../lib/etiquetas';
import { coma, formatearPorcentaje } from '../lib/formato';
import { pendientesDeRevision, ranking, variacionElo } from '../lib/hipotesis';
import { bloqueosDe, candidatos } from '../lib/priorizacion';
import { rutaDe, vistaDeRanking, type VistaRanking } from '../lib/ruta';
import { tr, traducido, trp } from '../lib/idioma';

function GraficaElo({ puntos }: { puntos: Hipotesis['historialElo'] }) {
  if (puntos.length < 2) return <svg className="grafica-elo" aria-hidden="true" />;
  const W = 120;
  const H = 34;
  const xs = puntos.map((p) => p.iteracion);
  const ys = puntos.map((p) => p.elo);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys) - 10;
  const maxY = Math.max(...ys) + 10;
  const x = (v: number) => (maxX === minX ? W / 2 : ((v - minX) / (maxX - minX)) * (W - 6) + 3);
  const y = (v: number) => H - 3 - ((v - minY) / (maxY - minY)) * (H - 6);
  const d = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.iteracion).toFixed(1)},${y(p.elo).toFixed(1)}`).join(' ');
  const ultimo = puntos[puntos.length - 1]!;
  return (
    <svg className="grafica-elo" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={trp("Elo de {elo} a {elo2}", { elo: puntos[0]!.elo, elo2: ultimo.elo })}>
      <path d={d} />
      <circle cx={x(ultimo.iteracion)} cy={y(ultimo.elo)} r="2.2" />
    </svg>
  );
}

function Fila({ h, i, invId, estado }: { h: Hipotesis; i: number; invId: string; estado: EstadoRosa }) {
  const d = variacionElo(h);
  return (
    <a className={`ranking-fila ${h.candidata ? 'ranking-candidata' : ''}`} href={rutaDe(invId, 'hipotesis', h.id)}>
      <span className="ranking-pos">{i + 1}</span>
      <div>
        <h3>{h.titulo}</h3>
        <div className="hip-meta">
          {/* El estado solo cuando no es "propuesta": salía idéntico en las
              seis filas (Emir, 28 de septiembre de 2026). */}
          {h.estado !== 'propuesta' && <Chip>{ESTADO_HIPOTESIS[h.estado]}</Chip>}
          {h.origen === 'humana' && <Chip tono="acento">Humana</Chip>}
          <Chip tono="borde">{h.cluster}</Chip>
          {killerPendienteDe(h) && (
            <Chip tono="aviso" title={tr("La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas.")}>
              {killerPendienteDe(h)}
            </Chip>
          )}
          {(h.conflictoCon?.length ?? 0) > 0 && (
            <Chip tono="aviso" title={trp("No puede ser cierta a la vez que: {v}. ROSA2018 lo marca; decide la persona.", { v: h.conflictoCon!.map((id) => estado.hipotesis.find((x) => x.id === id)?.titulo ?? id).join('; ') })}>{trp("Se contradice con {v}", { v: h.conflictoCon!.length === 1 ? 'otra' : h.conflictoCon!.length })}
            </Chip>
          )}
          <span>
            {(h.rivales.length === 1 ? trp("{rivales} rival", { rivales: h.rivales.length }) : trp("{rivales} rivales", { rivales: h.rivales.length }))}
          </span>
          <span>{trp("{v} $ gastados", { v: coma((h.coste.literatura + h.coste.analisis).toFixed(1)) })}</span>
        </div>
        {/* La franja explica por qué cada hipótesis está en ese puesto, así
            que se queda. Pero en modo compacto: en la tabla salían quince
            chips por fila, en cuatro colores y tres líneas de alto, y la
            mitad eran iguales en todas ("0 en contra", "0 socavan", "sin
            bloqueos", "novedad sin comprobar"). Compacta deja lo que ordena y
            lo que cambia entre filas; lo demás está en la ficha, a un clic. */}
        <FranjaRanking estado={estado} h={h} compacto />
      </div>
      <GraficaElo puntos={h.historialElo} />
      <div className="hip-elo">
        <strong>
          <Contador valor={h.elo} />
        </strong>
        <span className={d > 0 ? 'subida' : d < 0 ? 'bajada' : 'meta'}>{d > 0 ? `+${d}` : d}</span>
        {h.bt && (
          <span className="meta" title={tr("Fuerza de Bradley-Terry sobre los partidos, con intervalo del 95 % por bootstrap. Es lo que ordena a las candidatas.")}>
            BT {h.bt.fuerza} ({h.bt.ic95[0]} a {h.bt.ic95[1]})
          </span>
        )}
      </div>
    </a>
  );
}

/** Lo que el ranking deriva del estado, calculado de una vez. Guarda con qué
 *  investigación y con qué estado se calculó: las filas se pintan con esa
 *  misma foto del estado (no con la que llegue un frame después), para que lo
 *  que se ve sea coherente entre sí. */
export type RankingCalculado = {
  invId: string;
  estado: EstadoRosa;
  propias: Hipotesis[];
  lista: Hipotesis[];
  cal: ReturnType<typeof calibracion>;
  clusters: [string, Hipotesis[]][];
  cands: Hipotesis[];
  noCands: Parameters<typeof Candidatas>[0]['noCandidatas'];
};

/** El cálculo del ranking, puro: se llama fuera del render, después de que
 *  la silueta se haya pintado. `bloqueosDe` reindexa planes y ejecuciones
 *  por hipótesis; con muchas filas es lo que más cuesta. */
export function calcularRanking(estado: EstadoRosa, invId: string): RankingCalculado {
  const propias = estado.hipotesis.filter((h) => h.investigacionId === invId);
  const lista = ranking(propias);
  const cal = calibracion(propias);
  const m = new Map<string, Hipotesis[]>();
  for (const h of lista) m.set(h.cluster, [...(m.get(h.cluster) ?? []), h]);
  const clusters = [...m.entries()].sort((a, b) => (b[1][0]?.elo ?? 0) - (a[1][0]?.elo ?? 0));
  const cands = candidatos(estado, invId);
  const noCands = propias
    .filter((h) => h.estado !== 'descartada' && !cands.some((c) => c.id === h.id))
    .map((h) => {
      const b = bloqueosDe(estado, h);
      const pendiente = killerPendienteDe(h);
      const motivo = b.length > 0 ? '' : pendiente ? trp("{pendiente}: la decisión que consta no es un juicio nuevo", { pendiente }) : h.decisionKiller !== 'avanzar' ? (h.decisionKiller ? trp("El Killer decidió: {v}", { v: (DECISION_KILLER[h.decisionKiller]?.etiqueta ?? String(h.decisionKiller)).toLowerCase() }) : tr('El Killer todavía no la juzgó')) : tr('Sin bloqueos, pero otras puntúan más o repiten su cluster');
      return { h, bloqueos: b, motivo };
    });
  return { invId, estado, propias, lista, cal, clusters, cands, noCands };
}

/** Medido en Chromium a 1440 px (19 de septiembre de 2026): cada fila del
 *  ranking mide entre 154 y 201 px (173 de media); antes de la cola van la
 *  tarjeta de candidatas (149 a 181 px) y la fila del acuerdo (22 px). */
const ALTO_FILA_RANKING = 168;
const ALTO_CANDIDATAS = 150;
const MAX_FILAS_SILUETA = 40;
/** El panel del porqué bajo el podio, medido a 1440 px con cuatro frenos. */
const ALTO_DETALLE_PODIO = 280;

/** La silueta de la lista: la cabecera gris con su margen y sus cuatro
 *  líneas (la real mide 118 px), la tarjeta de candidatas, la fila del
 *  acuerdo y tantas tarjetas como hipótesis tiene la investigación, que el
 *  estado ya sabe sin calcular nada. */
export function EsqueletoRanking({ filas }: { filas: number }) {
  return (
    <EsqueletoPantalla variante="lista" clase="contenido-ranking" rotulo={tr("el ranking")} margenSuperior={16} lineasDescripcion={4}>
      <EsqueletoTarjeta lineas={5} alto={ALTO_CANDIDATAS} />
      <div className="acciones" style={{ marginBottom: 14, marginTop: 12 }} aria-hidden="true">
        <Esqueleto className="esqueleto-chip" ancho={230} />
        <Esqueleto alto={12} ancho={tr("min(50%, 420px)")} />
      </div>
      <EsqueletoTarjetas filas={Math.min(MAX_FILAS_SILUETA, Math.max(1, filas))} altoFila={ALTO_FILA_RANKING} />
    </EsqueletoPantalla>
  );
}

/** La silueta del podio, que es lo que se abre: la cabecera gris con su
 *  margen y dos líneas, tantas columnas como puestos va a haber (las que no
 *  están descartadas, hasta tres; el estado lo sabe sin calcular nada), cada
 *  una con su tarjeta y su pedestal a la altura real, y el panel del porqué.
 *  La cabecera va en gris y no con el texto real porque App pinta la misma
 *  EsqueletoPantalla al cambiar de pantalla y las dos deben tener la misma
 *  forma (App.esqueleto.test.tsx). */
export function EsqueletoPodio({ puestos }: { puestos: number }) {
  const n = Math.max(1, Math.min(3, puestos));
  return (
    <EsqueletoPantalla variante="lista" clase="contenido-ranking" rotulo={tr("el ranking")} margenSuperior={16} lineasDescripcion={2}>
      <div className="podio" aria-hidden="true">
        <div className="podio-escenario esqueleto-podio">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className={`podio-columna podio-puesto-${i + 1}`}>
              <EsqueletoTarjeta lineas={4} className="esqueleto-podio-tarjeta" />
              <div className="podio-pedestal esqueleto-podio-pedestal" />
            </div>
          ))}
        </div>
        <EsqueletoTarjeta lineas={4} alto={ALTO_DETALLE_PODIO} />
      </div>
    </EsqueletoPantalla>
  );
}

/** Las dos vistas que vienen de la antigua cola tienen cabecera propia: en
 *  «Laboratorio» el titulo no puede decir «Ranking de hipotesis», porque lo
 *  que se esta mirando es otra cosa. Las tres del ranking siguen con la suya.
 *  `undefined` quiere decir «usa la del ranking». */
const CABECERA: Partial<Record<VistaRanking, { titulo: string; nota: string }>> = traducido({
  pendientes: {
    titulo: 'Lo que espera tu decisión',
    nota: 'Lo que ROSA2018 propone y espera tu lectura, ordenado por Elo. Nada entra al modelo de mundo sin pasar por aquí.',
  },
  laboratorio: {
    titulo: 'Laboratorio',
    nota: 'El tramo final: hipótesis con experimento asignado (prerregistrado y sellado), en curso o con datos recibidos, y las candidatas que esperan un laboratorio. Cuando vuelven los datos, ROSA2018 los juzga contra el prerregistro.',
  },
});

/** Las cinco vistas. Lo usan las dos ramas de la pantalla (la del ranking y
 *  la de la cola), asi que vive aparte para no escribirlo dos veces. */
function Segmentado({ vista, setVista, esperan }: { vista: VistaRanking; setVista: (v: VistaRanking) => void; esperan: number }) {
  return (
    <div className="segmentos" role="group" aria-label={tr("Vista")}>
      <button type="button" aria-pressed={vista === 'podio'} onClick={() => setVista('podio')}>
        {tr("Podio")}
      </button>
      <button type="button" aria-pressed={vista === 'pendientes'} onClick={() => setVista('pendientes')} title={tr("Las que esperan tu decisión: aceptar, descartar o pedir que las refine")}>
        {tr("Pendientes")}
        {esperan > 0 && <span className="nav-cuenta">{esperan}</span>}
      </button>
      <button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>
        {tr("Lista completa")}
      </button>
      <button type="button" aria-pressed={vista === 'clusters'} onClick={() => setVista('clusters')}>
        {tr("Por cluster")}
      </button>
      <button type="button" aria-pressed={vista === 'laboratorio'} onClick={() => setVista('laboratorio')} title={tr("Hipótesis con experimento asignado, en curso o con datos, y candidatas que esperan laboratorio")}>
        {tr("Laboratorio")}
      </button>
    </div>
  );
}

export function Ranking({ inv, estado, detalleId, irA }: { inv: Investigacion; estado: EstadoRosa; detalleId: string | null; irA: (hash: string) => void }) {
  // La vista viene de la URL y no de un useState: así el aviso de pendientes,
  // el hilo del proceso y el «volver» de una ficha pueden llevar a una vista
  // concreta, y el botón atrás del navegador hace lo que se espera.
  const vista = vistaDeRanking(detalleId);
  const setVista = (v: VistaRanking) => irA(rutaDe(inv.id, 'ranking', v));
  const [soloMejor, setSoloMejor] = useState(false);
  const [proponiendo, setProponiendo] = useState(false);
  const esperanTuDecision = pendientesDeRevision(estado.hipotesis.filter((h) => h.investigacionId === inv.id));
  // Calculado tras el pintado. Si la investigación ya no es la misma, lo que
  // hay es de otra y se vuelve a la silueta; si solo cambió el estado (un
  // empuje del canal en vivo), se sigue enseñando el ranking anterior hasta
  // que llega el nuevo, sin parpadeo.
  const { valor } = useCalculoDiferido(() => calcularRanking(estado, inv.id), [estado, inv.id]);
  const r = valor !== null && valor.invId === inv.id ? valor : null;
  // Las filas se memorizan sobre el cálculo: en el frame en que el estado ya
  // cambió pero el cálculo nuevo aún no llegó, React recibe el mismo árbol y
  // no vuelve a pintar cada fila con su franja.
  const filas = useMemo(() => {
    if (r === null || vista === 'podio') return null;
    const { lista, clusters, estado: foto } = r;
    if (vista === 'lista') {
      return (
        // `ranking-lista` y no `cola`: eran la misma clase, y por eso las dos
        // pantallas se veían casi idénticas pese a contestar preguntas
        // distintas (Emir, 28 de septiembre de 2026). La cola es "qué leo
        // ahora"; el ranking es "cómo se comparan", y va como clasificación.
        <ListaAnimada className="ranking-lista" como="div">
          {lista.map((h, i) => (
            <ElementoAnimado key={h.id}>
              <Fila h={h} i={i} invId={r.invId} estado={foto} />
            </ElementoAnimado>
          ))}
        </ListaAnimada>
      );
    }
    return clusters.map(([nombre, hs]) => (
      <div key={nombre} className="cluster">
        <div className="acciones" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>{nombre}</h3>
          <span className="meta">
            {hs.length} {hs.length === 1 ? tr('hipótesis') : tr('hipótesis')} · mejor Elo {hs[0]?.elo}
          </span>
        </div>
        <div className="cola">
          {(soloMejor ? hs.slice(0, 1) : hs).map((h) => (
            <Fila key={h.id} h={h} i={lista.indexOf(h)} invId={r.invId} estado={foto} />
          ))}
        </div>
      </div>
    ));
  }, [r, vista, soloMejor]);

  // El estado global todavía no ha llegado, o el ranking de esta
  // investigación aún no está calculado: la silueta de la lista, nunca una
  // página vacía ni una congelación.
  // Las dos vistas que vienen de la antigua cola NO esperan al ranking: no
  // necesitan el Elo, ni los clusters, ni las candidatas, ni la calibración.
  // Si esperaran, abrir «Pendientes» costaría dos cálculos diferidos
  // encadenados para enseñar una lista que ya sabe pintarse sola.
  if (vista === 'pendientes' || vista === 'laboratorio') {
    return (
      <div className="contenido contenido-ranking">
        <AvisoMuestra conexion={estado.conexion} />
        <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
          <div>
            <h2>{CABECERA[vista]!.titulo}</h2>
            <p>{CABECERA[vista]!.nota}</p>
          </div>
          <div className="acciones">
            <Segmentado vista={vista} setVista={setVista} esperan={esperanTuDecision} />
            <button type="button" className="btn btn-primario" onClick={() => setProponiendo((v) => !v)}>
              {tr("Proponer hipótesis")}
            </button>
          </div>
        </div>
        {proponiendo && <FormularioHipotesis inv={inv} onCerrar={() => setProponiendo(false)} irA={irA} />}
        <ColaHipotesis inv={inv} estado={estado} vista={vista} />
      </div>
    );
  }

  // El estado global todavía no ha llegado, o el ranking de esta
  // investigación aún no está calculado: la silueta, nunca una página vacía
  // ni una congelación.
  if (estado.conexion === 'conectando' || r === null) {
    const propias = estado.hipotesis.filter((h) => h.investigacionId === inv.id);
    return vista === 'podio' ? <EsqueletoPodio puestos={delPodio(propias).length} /> : <EsqueletoRanking filas={propias.length} />;
  }
  const { cal, cands, noCands, estado: foto } = r;
  const enPodio = vista === 'podio' ? delPodio(r.lista).length : 0;
  const enJuego = r.lista.filter((h) => h.estado !== 'descartada').length;
  const verLista = () => setVista('lista');

  return (
    <div className="contenido contenido-ranking">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <span className="ranking-antetitulo">{enJuego === 1 ? tr('Torneo Elo · 1 hipótesis en juego') : trp('Torneo Elo · {n} hipótesis en juego', { n: enJuego })}</span>
          <h2>{CABECERA[vista]?.titulo ?? (vista === 'podio' && enPodio > 0 ? tituloPodio(enPodio) : tr("Ranking de hipótesis"))}</h2>
          {CABECERA[vista] ? (
            <p>{CABECERA[vista]!.nota}</p>
          ) : vista === 'podio' ? (
            <p>{tr("Mayor Elo, mejor les ha ido en los debates contra sus rivales. Cuánto fiarse lo dice la certeza GRADE, que va aparte. Toca una para ver por qué está ahí.")}</p>
          ) : (
            <p>
              {tr("Puntuación Elo por torneo entre rivales, revisada en cada iteración. Elo inicial 1500; funciona como el ranking de ajedrez: mayor Elo, mejor ha salido de los debates; cuánto fiarse lo dice la certeza GRADE, que va aparte. Las descartadas van al final aunque puntuaran alto.")}
            </p>
          )}
        </div>
        <div className="acciones">
          <Segmentado vista={vista} setVista={setVista} esperan={esperanTuDecision} />
          <button type="button" className="btn btn-primario" onClick={() => setProponiendo((v) => !v)}>
            {tr("Proponer hipótesis")}
          </button>
        </div>
      </div>

      {proponiendo && <FormularioHipotesis inv={inv} onCerrar={() => setProponiendo(false)} irA={irA} />}

      {/* El aviso va sobre el podio: la cola dejó de ser una sección propia y
          sin esto no habría nada que recordara que algo espera tu decisión. */}
      {vista === 'podio' && esperanTuDecision > 0 && (
        <button type="button" className="tarjeta aviso-pendientes" onClick={() => setVista('pendientes')}>
          <span>
            <strong>{esperanTuDecision}</strong>{(esperanTuDecision === 1 ? tr(" hipótesis espera tu decisión") : tr(" hipótesis esperan tu decisión"))}
          </span>
          <span className="enlace">{tr("Verlas")}</span>
        </button>
      )}

      {/* Pendientes y Laboratorio ya salieron arriba, por el camino que no
          espera al cálculo del ranking. */}
      {vista === 'podio' ? (
        <PodioRanking key={r.invId} lista={r.lista} estado={foto} invId={r.invId} alVerLista={verLista} />
      ) : (
        <>
          <Candidatas inv={inv} estado={foto} candidatas={cands} noCandidatas={noCands} />

          <div className="acciones" style={{ marginBottom: 14 }}>
            <Chip tono={cal.acuerdo === null ? undefined : cal.acuerdo >= 0.7 ? 'ok' : 'aviso'} title={tr("Cuántas veces la recomendación del revisor coincidió con lo que decidió una persona")}>
              {trp("Acuerdo revisor y personas: {v}", { v: cal.acuerdo === null ? tr('sin decisiones todavía') : formatearPorcentaje(cal.acuerdo) })}
            </Chip>
            <span className="meta">{tr("Las decisiones humanas de aceptar y descartar son la señal que calibra al juez del torneo.")}</span>
          </div>

          {vista === 'lista' ? (
            filas
          ) : (
            <div className="seccion">
              <label className="interruptor">
                <input type="checkbox" checked={soloMejor} onChange={(e) => setSoloMejor(e.target.checked)} />
                {tr("Mostrar solo la mejor de cada cluster (para ver la diversidad, no la repetición)")}
              </label>
              {filas}
            </div>
          )}
        </>
      )}
    </div>
  );
}
