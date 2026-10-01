// El ranking: hipótesis ordenadas por Elo (torneo, como Co-Scientist), con
// su historial en una gráfica pequeña, el número de partidos (un Elo con
// pocos partidos es poco fiable), sus rivales, el coste y el origen (humana o
// de ROSA2018). Vista alternativa por cluster para ver diversidad: el mejor de
// cada cluster, como hace el agente de proximidad de Co-Scientist.
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
import { calibracion } from '../lib/calidad';
import { useCalculoDiferido } from '../lib/diferido';
import { DECISION_KILLER, ESTADO_HIPOTESIS, killerPendienteDe } from '../lib/etiquetas';
import { coma, formatearPorcentaje } from '../lib/formato';
import { ranking, variacionElo } from '../lib/hipotesis';
import { bloqueosDe, candidatos } from '../lib/priorizacion';
import { rutaDe } from '../lib/ruta';
import { tr } from '../lib/idioma';

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
    <svg className="grafica-elo" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Elo de ${puntos[0]!.elo} a ${ultimo.elo}`}>
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
            <Chip tono="aviso" title={`No puede ser cierta a la vez que: ${h.conflictoCon!.map((id) => estado.hipotesis.find((x) => x.id === id)?.titulo ?? id).join('; ')}. ROSA2018 lo marca; decide la persona.`}>
              Se contradice con {h.conflictoCon!.length === 1 ? 'otra' : h.conflictoCon!.length}
            </Chip>
          )}
          <span>
            {h.rivales.length} {h.rivales.length === 1 ? 'rival' : 'rivales'}
          </span>
          <span>{coma((h.coste.literatura + h.coste.analisis).toFixed(1))} $ gastados</span>
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
      const motivo = b.length > 0 ? '' : pendiente ? `${pendiente}: la decisión que consta no es un juicio nuevo` : h.decisionKiller !== 'avanzar' ? (h.decisionKiller ? `El Killer decidió: ${(DECISION_KILLER[h.decisionKiller]?.etiqueta ?? String(h.decisionKiller)).toLowerCase()}` : 'El Killer todavía no la juzgó') : 'Sin bloqueos, pero otras puntúan más o repiten su cluster';
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

/** La silueta del ranking: la cabecera gris con su margen y sus cuatro
 *  líneas (la real mide 118 px), la tarjeta de candidatas, la fila del
 *  acuerdo y tantas tarjetas como hipótesis tiene la investigación, que el
 *  estado ya sabe sin calcular nada. La cabecera va en gris y no con el
 *  texto real porque App pinta la misma EsqueletoPantalla al cambiar de
 *  pantalla y las dos deben tener la misma forma (App.esqueleto.test.tsx). */
export function EsqueletoRanking({ filas }: { filas: number }) {
  return (
    <EsqueletoPantalla variante="lista" rotulo="el ranking" margenSuperior={16} lineasDescripcion={4}>
      <EsqueletoTarjeta lineas={5} alto={ALTO_CANDIDATAS} />
      <div className="acciones" style={{ marginBottom: 14, marginTop: 12 }} aria-hidden="true">
        <Esqueleto className="esqueleto-chip" ancho={230} />
        <Esqueleto alto={12} ancho="min(50%, 420px)" />
      </div>
      <EsqueletoTarjetas filas={Math.min(MAX_FILAS_SILUETA, Math.max(1, filas))} altoFila={ALTO_FILA_RANKING} />
    </EsqueletoPantalla>
  );
}

export function Ranking({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const [vista, setVista] = useState<'lista' | 'clusters'>('lista');
  const [soloMejor, setSoloMejor] = useState(false);
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
    if (r === null) return null;
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
            {hs.length} {hs.length === 1 ? 'hipótesis' : 'hipótesis'} · mejor Elo {hs[0]?.elo}
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
  if (estado.conexion === 'conectando' || r === null) return <EsqueletoRanking filas={estado.hipotesis.filter((h) => h.investigacionId === inv.id).length} />;
  const { cal, cands, noCands, estado: foto } = r;

  return (
    <div className="contenido">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{tr("Ranking de hipótesis")}</h2>
          <p>
            {tr("Puntuación Elo por torneo entre rivales, revisada en cada iteración. Elo inicial 1500; funciona como el ranking de ajedrez: mayor Elo, mejor ha salido de los debates; cuánto fiarse lo dice la certeza GRADE, que va aparte. Las descartadas van al final aunque puntuaran alto.")}
          </p>
        </div>
        <div className="acciones">
          <div className="segmentos" role="group" aria-label="Vista">
            <button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>
              Lista
            </button>
            <button type="button" aria-pressed={vista === 'clusters'} onClick={() => setVista('clusters')}>
              {tr("Por cluster")}
            </button>
          </div>
        </div>
      </div>

      <Candidatas inv={inv} estado={foto} candidatas={cands} noCandidatas={noCands} />

      <div className="acciones" style={{ marginBottom: 14 }}>
        <Chip tono={cal.acuerdo === null ? undefined : cal.acuerdo >= 0.7 ? 'ok' : 'aviso'} title={tr("Cuántas veces la recomendación del revisor coincidió con lo que decidió una persona")}>
          {tr("Acuerdo revisor y personas:")} {cal.acuerdo === null ? 'sin decisiones todavía' : formatearPorcentaje(cal.acuerdo)}
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
    </div>
  );
}
