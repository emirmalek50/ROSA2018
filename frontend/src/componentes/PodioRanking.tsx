// El podio del ranking (Emir, 1 de octubre de 2026): las tres hipótesis con
// más Elo, en sus pedestales, y debajo el porqué de la que se mira. La lista
// completa sigue a un clic; esto contesta "¿cuáles van ganando y por qué?"
// sin leer nueve filas.
//
// Todo lo que se ve sale de componentesDe (lib/ranking.ts), la misma regla
// que la franja de la lista: aquí no se calcula nada nuevo, solo se dibuja.
// El Elo dice cómo le ha ido en los debates; cuánto fiarse lo dice la
// certeza GRADE, que va aparte y por eso sale entre lo que la frena.
//
// Movimiento: los pedestales suben en orden 3, 2, 1 (400 ms, salida suave),
// el Elo corre desde el inicial y el punto de la fuerza BT se desliza a su
// sitio. Con movimiento reducido, solo fundidos. Teclado: 1, 2 y 3 eligen
// puesto; las flechas pasan al de al lado.

import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { EstadoRosa, Hipotesis } from '../datos/tipos';
import { BLOQUEO, CERTEZA_EVIDENCIA, DECISION_KILLER, PASO_RUTA, killerPendienteDe } from '../lib/etiquetas';
import { variacionElo } from '../lib/hipotesis';
import { DUR, useMovimientoReducido } from '../lib/movimiento';
import { EXPLICACION_BLOQUEO } from '../lib/priorizacion';
import { componentesDe, type ComponentesRanking } from '../lib/ranking';
import { rutaDe } from '../lib/ruta';
import { tr, trp } from '../lib/idioma';
import { Contador } from './Animado';

const SALIDA = [0.22, 1, 0.36, 1] as const;
/** Cuántas marcas caben como mucho en cada fila de la evidencia; la cifra de
 *  al lado dice siempre el total. */
const MAX_PUNTOS = 20;
const MAX_TRAZOS = 16;
const MAX_CUADROS = 20;

type Tono = 'ok' | 'aviso' | 'mal' | 'neutro';

function de<T>(tabla: Record<string, T>, clave: unknown): T | undefined {
  return typeof clave === 'string' && Object.hasOwn(tabla, clave) ? tabla[clave] : undefined;
}

const LUGAR = (): string[] => [tr('1.º lugar'), tr('2.º lugar'), tr('3.º lugar')];
const POR_QUE = (): string[] => [tr('Por qué va en primer lugar'), tr('Por qué va en segundo lugar'), tr('Por qué va en tercer lugar')];
const TITULO = (n: number): string => (n === 1 ? tr('La que va ganando') : n === 2 ? tr('Las dos que van ganando') : tr('Las tres que van ganando'));

/** Lo que ya está calculado para cada puesto. */
type Puesto = { h: Hipotesis; c: ComponentesRanking; delta: number; eloInicial: number };

/** La escala común de la fuerza BT: los tres intervalos en la misma regla,
 *  redondeada a centenas con un margen, para que se comparen a ojo. */
function escalaBT(puestos: Puesto[]): [number, number] | null {
  const xs = puestos.flatMap((p) => (p.c.bt ? [p.c.bt.ic95[0], p.c.bt.ic95[1], p.c.bt.fuerza] : [])).filter(Number.isFinite);
  if (xs.length === 0) return null;
  const min = Math.floor((Math.min(...xs) - 100) / 100) * 100;
  const max = Math.ceil((Math.max(...xs) + 100) / 100) * 100;
  return max > min ? [min, max] : [min, min + 200];
}

function porcentaje(v: number, [a, b]: [number, number]): number {
  return Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100));
}

function Marcas({ n, max, forma }: { n: number; max: number; forma: 'punto' | 'trazo' | 'cuadro' }) {
  const visibles = Math.min(n, max);
  return (
    <span className={`podio-marcas podio-marcas-${forma}`} aria-hidden="true">
      {Array.from({ length: visibles }, (_, i) => (
        <i key={i} />
      ))}
      {n > max && <b>+</b>}
    </span>
  );
}

function BarraBT({ c, escala, reducido, retraso }: { c: ComponentesRanking; escala: [number, number] | null; reducido: boolean; retraso: number }) {
  if (!c.bt || !escala) {
    return (
      <div className="podio-bt">
        <div className="podio-bt-cabecera">
          <span>{tr('Fuerza BT')}</span>
          <span className="podio-bt-ic">{tr('sin calcular todavía')}</span>
        </div>
      </div>
    );
  }
  const { fuerza, ic95 } = c.bt;
  const desde = porcentaje(ic95[0], escala);
  const hasta = porcentaje(ic95[1], escala);
  const punto = porcentaje(fuerza, escala);
  const titulo = trp('Fuerza de Bradley-Terry {f}, intervalo del 95 % de {a} a {b}, en una escala de {min} a {max}. Es lo que ordena a las candidatas.', { f: Math.round(fuerza), a: Math.round(ic95[0]), b: Math.round(ic95[1]), min: escala[0], max: escala[1] });
  return (
    <div className="podio-bt" title={titulo}>
      <div className="podio-bt-cabecera">
        <span>
          {tr('Fuerza BT')} <strong>{Math.round(fuerza)}</strong>
        </span>
        <span className="podio-bt-ic">{trp('{a} a {b}', { a: Math.round(ic95[0]), b: Math.round(ic95[1]) })}</span>
      </div>
      <div className="podio-bt-pista" aria-hidden="true">
        <span className="podio-bt-intervalo" style={{ left: `${desde}%`, width: `${Math.max(1, hasta - desde)}%` }} />
        <motion.span className="podio-bt-punto" initial={reducido ? false : { left: `${desde}%`, opacity: 0 }} animate={{ left: `${punto}%`, opacity: 1 }} transition={{ duration: DUR.lenta, ease: SALIDA, delay: retraso }} />
      </div>
    </div>
  );
}

function Tarjeta({ p, i, invId, escala, elegida, alElegir, reducido, retraso, refBoton }: { p: Puesto; i: number; invId: string; escala: [number, number] | null; elegida: boolean; alElegir: () => void; reducido: boolean; retraso: number; refBoton: (b: HTMLAnchorElement | null) => void }) {
  const { h, c, delta } = p;
  const cohortes = c.cohortesDistintas.length;
  return (
    // La entrada va en un envoltorio: motion escribe `transform` en línea y,
    // puesto en el botón, anularía la elevación del :hover de la hoja de estilos.
    <motion.div className="podio-tarjeta-entrada" initial={reducido ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.lenta, ease: SALIDA, delay: retraso }}>
      {/* Un ENLACE, no un botón: pulsar la tarjeta abre la hipótesis (Emir,
          2 de octubre de 2026). Elegirla, que es lo que despliega el panel
          de abajo, se hace ahora al enfocarla o al señalarla con el ratón, y
          con la fila de selectores. */}
      <a
        ref={refBoton}
        href={rutaDe(invId, 'hipotesis', h.id)}
        className="podio-tarjeta"
        aria-current={elegida ? 'true' : undefined}
        aria-label={trp('{lugar}: {titulo}. Elo {elo}. Abre la ficha.', { lugar: LUGAR()[i]!, titulo: h.titulo, elo: h.elo })}
        onFocus={alElegir}
        onMouseEnter={alElegir}
      >
        <span className="podio-tarjeta-cabecera">
          <span className="podio-lugar">
            <i aria-hidden="true" />
            {LUGAR()[i]}
          </span>
          <span className="podio-cluster" title={h.cluster}>
            {h.cluster}
          </span>
        </span>
        <span className="podio-titulo">{h.titulo}</span>
        <span className="podio-elo">
          <span className="podio-elo-cifra">
            <small>ELO</small>
            <Contador valor={h.elo} desde={p.eloInicial} className="podio-elo-valor" />
          </span>
          <span className={`podio-delta ${delta > 0 ? 'podio-delta-sube' : delta < 0 ? 'podio-delta-baja' : ''}`} title={tr('Cambio de Elo desde que entró en el torneo')}>
            {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : tr('sin cambio')}
          </span>
        </span>
        <BarraBT c={c} escala={escala} reducido={reducido} retraso={retraso + 0.15} />
        <span className="podio-evidencia">
          <span className="podio-evidencia-fila" title={tr('Afirmaciones sostenidas que la apoyan y nadie socava')}>
            <span className="podio-evidencia-cifra podio-cifra-ok">{c.aFavor}</span>
            <span className="podio-evidencia-unidad">{tr('a favor')}</span>
            <Marcas n={c.aFavor} max={MAX_PUNTOS} forma="punto" />
          </span>
          <span className="podio-evidencia-fila" title={tr('Cohortes distintas entre las fuentes: dos artículos de la misma cohorte cuentan como una')}>
            <span className="podio-evidencia-cifra">{cohortes}</span>
            <span className="podio-evidencia-unidad">{(cohortes === 1 ? tr("cohorte") : tr("cohortes"))}</span>
            <Marcas n={cohortes} max={MAX_TRAZOS} forma="trazo" />
          </span>
          <span className="podio-evidencia-fila" title={tr('Debates del torneo en los que ha participado')}>
            <span className="podio-evidencia-cifra">{c.partidos}</span>
            <span className="podio-evidencia-unidad">{(c.partidos === 1 ? tr("partido") : tr("partidos"))}</span>
            <Marcas n={c.partidos} max={MAX_CUADROS} forma="cuadro" />
          </span>
        </span>
      </a>
    </motion.div>
  );
}

type Razon = { titulo: string; detalle: string; tono: Tono; ayuda?: string };

/** Lo que la sostiene: la evidencia, su variedad y cómo le ha ido en el torneo. */
function sostiene(p: Puesto): Razon[] {
  const { h, c } = p;
  const cohortes = c.cohortesDistintas.length;
  const evidencia: Razon = {
    titulo: trp('{a} afirmaciones a favor, {b} en contra', { a: c.aFavor, b: c.enContra }),
    detalle: c.enContra === 0 && c.socavan === 0 ? tr('Ninguna evidencia la contradice directamente') : c.socavan > 0 ? trp('{n} atacan el método de algún apoyo', { n: c.socavan }) : tr('Hay evidencia en contra: léela antes de decidir'),
    tono: c.enContra === 0 && c.socavan === 0 ? 'ok' : 'aviso',
  };
  const variedad: Razon = {
    titulo: cohortes === 1 ? tr('1 cohorte') : trp('{n} cohortes distintas', { n: cohortes }),
    detalle: cohortes >= 2 ? tr('La evidencia no sale de una sola cohorte') : cohortes === 1 ? tr('Toda la evidencia sale de la misma cohorte') : tr('Ninguna cohorte identificada todavía'),
    tono: cohortes >= 2 ? 'ok' : 'neutro',
    ayuda: c.cohortesDistintas.join(', ') || undefined,
  };
  const rivales = h.rivales.length;
  const torneo: Razon = {
    titulo: trp('{p} partidos contra {r} rivales', { p: c.partidos, r: rivales }),
    detalle: p.delta === 0 ? trp('Sigue en el Elo inicial de {e}', { e: p.eloInicial }) : trp('{d} de Elo desde el {e} inicial', { d: p.delta > 0 ? `+${p.delta}` : String(p.delta), e: p.eloInicial }),
    tono: p.delta > 0 ? 'ok' : 'neutro',
  };
  return [evidencia, variedad, torneo];
}

const DETALLE_KILLER = (): Record<string, string> => ({
  reformular: tr('ROSA2018 escribe una versión nueva y la vuelve a juzgar'),
  suspender: tr('No pasa al laboratorio hasta que se resuelva'),
  descartar_en_contexto: tr('La evidencia no la sostiene en este contexto'),
});

const DETALLE_BLOQUEO = (): Record<string, string> => ({
  revision_registro_abierta: tr('Necesita tu decisión'),
  dependencia_pendiente: tr('Hay que volver a revisarla'),
  fuente_retractada: tr('Una de sus fuentes ya no vale'),
});

/** Lo que aún la frena, de lo más grave a lo menos: los bloqueos, el Killer,
 *  los conflictos con otras hipótesis y la certeza GRADE si es baja. */
function frena(p: Puesto): Razon[] {
  const { h, c } = p;
  const xs: Razon[] = [];
  const pendiente = killerPendienteDe(h);
  if (pendiente) xs.push({ titulo: tr('Killer: pendiente de juicio'), detalle: tr('El modelo no respondió; se repite la revisión'), tono: 'aviso', ayuda: pendiente });
  else if (c.killer && c.killer !== 'avanzar') {
    const k = de(DECISION_KILLER as Record<string, { etiqueta: string; tono: string; nota: string }>, c.killer);
    xs.push({ titulo: trp('Killer: {d}', { d: (k?.etiqueta ?? c.killer).toLowerCase() }), detalle: de(DETALLE_KILLER(), c.killer) ?? tr('Decisión del revisor crítico'), tono: c.killer === 'descartar_en_contexto' ? 'mal' : 'aviso', ayuda: c.killerMotivo ?? k?.nota });
  }
  if (c.bloqueosOrigen === 'no_comprobado') xs.push({ titulo: tr('Bloqueos sin comprobar'), detalle: tr('No comprobado no es lo mismo que sin bloqueos'), tono: 'aviso' });
  for (const b of c.bloqueos) {
    xs.push({ titulo: de(BLOQUEO as Record<string, string>, b) ?? b, detalle: de(DETALLE_BLOQUEO(), b) ?? tr('La saca de las candidatas al laboratorio'), tono: 'mal', ayuda: de(EXPLICACION_BLOQUEO as Record<string, string>, b) });
  }
  if (c.conflictoCon.length > 0) {
    xs.push({
      titulo: c.conflictoCon.length === 1 ? tr('Se contradice con otra hipótesis') : trp('Se contradice con otras {n} hipótesis', { n: c.conflictoCon.length }),
      detalle: c.conflictoCon.length === 1 ? trp('Choca con «{t}»', { t: c.conflictoCon[0]!.titulo }) : tr('Revisa con cuáles antes de decidir'),
      tono: 'mal',
      ayuda: c.conflictoCon.map((x) => x.titulo).join('; '),
    });
  }
  if (!c.certeza) xs.push({ titulo: tr('Sin certeza GRADE todavía'), detalle: tr('ROSA2018 la escribe al cerrar cada iteración'), tono: 'neutro' });
  else if (c.certeza.nivel === 'muy_baja' || c.certeza.nivel === 'baja') {
    const e = de(CERTEZA_EVIDENCIA as Record<string, { etiqueta: string; nota: string }>, c.certeza.nivel);
    xs.push({ titulo: e?.etiqueta ?? c.certeza.etiqueta, detalle: tr('Va aparte del Elo: gana debates, pero falta solidez'), tono: 'aviso', ayuda: e?.nota });
  }
  return xs;
}

function Ruta({ c }: { c: ComponentesRanking }) {
  const declarado = c.pasoRuta ? de(PASO_RUTA as Record<string, { etiqueta: string; orden: number }>, c.pasoRuta) : undefined;
  const cubiertos = c.ruta?.cubiertos ?? null;
  const siguiente = c.ruta?.siguiente ? de(PASO_RUTA as Record<string, { etiqueta: string; orden: number }>, c.ruta.siguiente) : undefined;
  return (
    <div className="podio-ruta">
      <h4>{tr('Ruta hacia el laboratorio')}</h4>
      {cubiertos === null ? (
        <p className="podio-ruta-nota">{declarado ? trp('Sin evaluar por regla; declarada en el paso {n}, {e}', { n: declarado.orden, e: declarado.etiqueta.toLowerCase() }) : tr('Todavía sin evaluar')}</p>
      ) : (
        <>
          <div className="podio-ruta-cifra">
            <strong>{cubiertos}</strong>
            <span>{tr('de 8 pasos')}</span>
          </div>
          <div className="podio-ruta-pasos" role="img" aria-label={trp('{n} de 8 pasos cubiertos', { n: cubiertos })}>
            {Array.from({ length: 8 }, (_, k) => (
              <i key={k} className={k < cubiertos ? 'podio-paso-hecho' : undefined} />
            ))}
          </div>
          <p className="podio-ruta-nota">{c.ruta?.siguiente ? trp('Siguiente paso: {e}', { e: (siguiente?.etiqueta ?? c.ruta.siguiente).toLowerCase() }) : tr('Ruta completa')}</p>
        </>
      )}
    </div>
  );
}

function Detalle({ p, i, invId, total, alElegir, alVerLista }: { p: Puesto; i: number; invId: string; total: number; alElegir: (i: number) => void; alVerLista: () => void }) {
  const razonesA = sostiene(p);
  const razonesB = frena(p);
  const hallazgo = p.c.bloqueos.includes('revision_registro_abierta');
  return (
    <section className="podio-detalle" aria-live="polite" aria-label={POR_QUE()[i]}>
      <div className="podio-detalle-cabecera">
        <h3>
          <span className="podio-detalle-lugar">{POR_QUE()[i]}</span>
          <span className="podio-detalle-titulo">{p.h.titulo}</span>
        </h3>
        <div className="podio-selector" role="group" aria-label={tr('Elegir puesto')}>
          <button type="button" aria-label={tr('Puesto anterior')} disabled={i === 0} onClick={() => alElegir(i - 1)}>
            ‹
          </button>
          {Array.from({ length: total }, (_, k) => (
            <button key={k} type="button" aria-pressed={k === i} className={`podio-selector-${k + 1}`} onClick={() => alElegir(k)}>
              {k + 1}
            </button>
          ))}
          <button type="button" aria-label={tr('Puesto siguiente')} disabled={i === total - 1} onClick={() => alElegir(i + 1)}>
            ›
          </button>
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={p.h.id} className="podio-detalle-cuerpo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.rapida }}>
          <div className="podio-razones">
            <h4 className="podio-razones-ok">{tr('Lo que la sostiene')}</h4>
            <ul>
              {razonesA.map((r) => (
                <li key={r.titulo} className={`podio-razon podio-razon-${r.tono}`} title={r.ayuda}>
                  <strong>{r.titulo}</strong>
                  <span>{r.detalle}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="podio-razones">
            <h4 className="podio-razones-aviso">{tr('Lo que aún la frena')}</h4>
            <ul>
              {razonesB.length === 0 ? (
                <li className="podio-razon podio-razon-ok">
                  <strong>{tr('Nada la frena ahora mismo')}</strong>
                  <span>{tr('Sin bloqueos, sin conflictos y con el Killer a favor')}</span>
                </li>
              ) : (
                razonesB.map((r) => (
                  <li key={r.titulo} className={`podio-razon podio-razon-${r.tono}`} title={r.ayuda}>
                    <strong>{r.titulo}</strong>
                    <span>{r.detalle}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="podio-lateral">
            <Ruta c={p.c} />
            <div className="podio-acciones">
              <a className="btn btn-primario" href={rutaDe(invId, 'hipotesis', p.h.id)}>
                {(hallazgo ? tr("Atender el hallazgo ") : tr("Abrir la ficha "))}<span aria-hidden="true">→</span>
              </a>
              <button type="button" className="btn" onClick={alVerLista}>
                {tr('Verla en la lista completa')}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/** Las hipótesis que suben al podio: las tres primeras del ranking que no
 *  están descartadas (el ranking ya las pone al final). */
export function delPodio(lista: Hipotesis[]): Hipotesis[] {
  return lista.filter((h) => h.estado !== 'descartada').slice(0, 3);
}

export function PodioRanking({ lista, estado, invId, alVerLista }: { lista: Hipotesis[]; estado: EstadoRosa; invId: string; alVerLista: () => void }) {
  const reducido = useMovimientoReducido();
  const puestos = useMemo<Puesto[]>(
    () =>
      delPodio(lista).map((h) => {
        const eloInicial = h.historialElo[0]?.elo ?? h.elo;
        return { h, c: componentesDe(estado, h), delta: variacionElo(h), eloInicial };
      }),
    [lista, estado],
  );
  const escala = useMemo(() => escalaBT(puestos), [puestos]);
  const [elegidaId, setElegidaId] = useState<string | null>(null);
  const botones = useRef<(HTMLAnchorElement | null)[]>([]);
  const vivas = lista.filter((h) => h.estado !== 'descartada').length;
  const descartadas = lista.length - vivas;
  const restantes = vivas - puestos.length;

  if (puestos.length === 0) {
    return (
      <div className="podio-vacio">
        <p>{tr('Todavía no hay hipótesis en el torneo: el podio se llena cuando ROSA2018 haga los primeros debates.')}</p>
      </div>
    );
  }

  // Si la elegida se cae del podio (un empuje del estado), se vuelve al primero.
  const elegida = Math.max(0, puestos.findIndex((p) => p.h.id === elegidaId));
  const elegir = (k: number, enfocar = false) => {
    const j = Math.max(0, Math.min(puestos.length - 1, k));
    setElegidaId(puestos[j]!.h.id);
    if (enfocar) botones.current[j]?.focus();
  };
  const teclas = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const objetivo = e.target as HTMLElement;
    if (objetivo.closest(tr('input, textarea, select, [contenteditable="true"]'))) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const k = Number(e.key) - 1;
      if (k < puestos.length) {
        e.preventDefault();
        elegir(k, true);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      elegir(elegida + (e.key === 'ArrowRight' ? 1 : -1), true);
    }
  };
  // Orden de entrada: el tercero, el segundo y el primero, como en una entrega de medallas.
  const retraso = (i: number) => (reducido ? 0 : [0.24, 0.12, 0][i] ?? 0);

  return (
    <div className="podio" onKeyDown={teclas}>
      <div className="podio-escenario" role="group" aria-label={TITULO(puestos.length)}>
        {puestos.map((p, i) => (
          <div key={p.h.id} className={`podio-columna podio-puesto-${i + 1} ${i === elegida ? 'podio-elegida' : ''}`.trim()}>
            <Tarjeta p={p} i={i} invId={invId} escala={escala} elegida={i === elegida} alElegir={() => elegir(i)} reducido={reducido} retraso={retraso(i) + 0.1} refBoton={(b) => (botones.current[i] = b)} />
            <motion.div
              className="podio-pedestal"
              aria-hidden="true"
              onClick={() => elegir(i)}
              initial={reducido ? { opacity: 0 } : { scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: DUR.lenta, ease: SALIDA, delay: retraso(i) }}
            >
              <span>{i + 1}</span>
            </motion.div>
          </div>
        ))}
      </div>
      <Detalle p={puestos[elegida]!} i={elegida} invId={invId} total={puestos.length} alElegir={(k) => elegir(k)} alVerLista={alVerLista} />
      <div className="podio-pie">
        <span>
          {restantes > 0 ? (restantes === 1 ? tr('Otra hipótesis sigue en el torneo') : trp('Otras {n} hipótesis siguen en el torneo', { n: restantes })) : tr('No hay más hipótesis en el torneo')}
          {descartadas > 0 && ` · ${descartadas === 1 ? tr('1 descartada') : trp('{n} descartadas', { n: descartadas })}`}
        </span>
        <button type="button" className="podio-enlace" onClick={alVerLista}>
          {tr('Ver lista completa')} <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

export { TITULO as tituloPodio };
