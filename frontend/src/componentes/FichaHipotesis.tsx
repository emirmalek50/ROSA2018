// Las piezas de la ficha de una hipótesis rehecha el 3 de octubre de 2026
// (Emir: "la información se ve desorganizada, que sea fácil de leer y
// cómodo"). Antes eran treinta secciones apiladas, una pared de quince chips
// grises bajo el título y el aviso importante perdido entre ellos. Ahora:
//
//   - una sola alerta con lo que impide avanzar;
//   - cuatro cifras clave (certeza, hacia dónde apunta la evidencia, el
//     Killer y el torneo), cada una con su frase;
//   - la conclusión contada para leerla de corrido: el veredicto, por qué
//     esta certeza, qué la apoya y qué la debilita, y qué la movería con la
//     escalera de niveles;
//   - una columna lateral con el estado: el siguiente paso, las
//     comprobaciones del Killer, la ruta terapéutica, con quién compite y la
//     diana.
//
// Todo lo que había sigue en la ficha, repartido en pestañas
// (pantallas/Hipotesis.tsx). Aquí solo se lee: cada número sale de
// lib/ranking.ts (componentesDe) o del registro tal cual, y con un registro
// raro (texto donde iba una lista) la pieza se calla en vez de caerse.

import type { ReactNode } from 'react';
import type { Bloqueo, CertezaEvidencia, ConclusionHipotesis, Decision, EstadoRosa, Hipotesis } from '../datos/tipos';
import { BLOQUEO, DECISION_KILLER, DIRECCION_EVIDENCIA, FACTOR_CERTEZA, PASO_RUTA, certezaDe } from '../lib/etiquetas';
import { formatearEntero } from '../lib/formato';
import { EXPLICACION_BLOQUEO } from '../lib/priorizacion';
import type { ComponentesRanking } from '../lib/ranking';
import { rutaDe } from '../lib/ruta';
import { Momento } from './piezas';
import { traducido, tr, trp } from '../lib/idioma';

export type PestanaFicha = 'resumen' | 'evidencia' | 'tarjeta' | 'comprobaciones' | 'experimento' | 'historial';

type Tono = 'ok' | 'aviso' | 'mal' | 'borde';

const NIVELES: CertezaEvidencia[] = ['muy_baja', 'baja', 'moderada', 'alta'];

const NIVEL_CORTO: Record<CertezaEvidencia, string> = traducido({
  muy_baja: 'Muy baja',
  baja: 'Baja',
  moderada: 'Moderada',
  alta: 'Alta',
});

/** La dirección en pocas palabras: la cifra ya dice "La evidencia" encima. */
const DIRECCION_CORTA: Record<string, { etiqueta: string; tono: Tono }> = traducido({
  apoya: { etiqueta: 'Apoya la hipótesis', tono: 'ok' },
  mixta: { etiqueta: 'Mixta', tono: 'aviso' },
  en_contra: { etiqueta: 'Va en contra', tono: 'mal' },
  sin_evidencia_directa: { etiqueta: 'Sin evidencia directa', tono: 'borde' },
});

/** Dónde se atiende cada bloqueo dentro de la ficha. El hallazgo del revisor
 *  de registro se atiende fuera, en el dossier o en la iteración. */
const PESTANA_DE_BLOQUEO: Record<Bloqueo, PestanaFicha> = {
  trazabilidad_insuficiente: 'evidencia',
  datos_no_autorizados: 'evidencia',
  analisis_invalido: 'evidencia',
  sin_experimento_interpretable: 'experimento',
  descartada_por_killer: 'comprobaciones',
  fuente_retractada: 'evidencia',
  revision_registro_abierta: 'experimento',
  dependencia_pendiente: 'tarjeta',
};

function lista<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x.filter((y) => y !== null && y !== undefined) as T[]) : [];
}

function textos(x: unknown): string[] {
  return lista<unknown>(x).filter((y): y is string => typeof y === 'string' && y.trim() !== '');
}

function Punto({ tono }: { tono: Tono }) {
  return <span className={`ficha-punto ficha-punto-${tono}`} aria-hidden="true" />;
}

/** El puesto por Elo entre las vivas de la investigación (las descartadas no
 *  compiten). Null si está descartada. */
export function puestoPorElo(estado: Pick<EstadoRosa, 'hipotesis'>, h: Hipotesis): { puesto: number; de: number } | null {
  if (h.estado === 'descartada') return null;
  const vivas = estado.hipotesis.filter((x) => x.investigacionId === h.investigacionId && x.estado !== 'descartada');
  return { puesto: 1 + vivas.filter((x) => x.id !== h.id && x.elo > h.elo).length, de: vivas.length };
}

/** La última pasada del Killer sobre esta hipótesis, contada por resultado. */
export function recuentoKiller(h: Hipotesis, decisiones: Decision[] | undefined): { pasa: number; noComprobable: number; falla: number; total: number } | null {
  const propias = lista<Decision>(decisiones).filter((d) => d.hipotesisId === h.id && d.etapa === 'killer_1');
  const ultima = propias.sort((a, b) => b.fecha - a.fecha)[0];
  if (!ultima) return null;
  const cs = lista<{ resultado?: unknown }>(ultima.comprobaciones);
  const pasa = cs.filter((c) => c.resultado === 'pasa').length;
  const noComprobable = cs.filter((c) => c.resultado === 'no_comprobable').length;
  const falla = cs.filter((c) => c.resultado === 'falla').length;
  return { pasa, noComprobable, falla, total: pasa + noComprobable + falla };
}

/* ---------------------------------------------------------------------
   La alerta única
   --------------------------------------------------------------------- */

/** Lo que impide avanzar, en un solo sitio. El primero de los bloqueos manda
 *  el título; el resto se nombra debajo para que ninguno quede escondido. */
export function AlertaFicha({ h, bloqueos, retractadas, onIr }: { h: Hipotesis; bloqueos: Bloqueo[]; retractadas: string[]; onIr: (p: PestanaFicha) => void }) {
  if (bloqueos.length === 0 && retractadas.length === 0) return null;
  const primero = bloqueos[0] ?? 'fuente_retractada';
  const resto = bloqueos.slice(1).map((b) => BLOQUEO[b] ?? b);
  const detalle =
    primero === 'fuente_retractada' && retractadas.length > 0
      ? trp("Depende de {v}: {v2}. No vale como evidencia y la hipótesis baja en el ranking.", { v: retractadas.length === 1 ? tr('una fuente retractada') : trp('{n} fuentes retractadas', { n: retractadas.length }), v2: retractadas.join(', ') })
      : EXPLICACION_BLOQUEO[primero];
  const fuera = primero === 'revision_registro_abierta';
  return (
    <div className="ficha-alerta" role="alert">
      <svg className="ficha-alerta-icono" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01" />
      </svg>
      <div className="ficha-alerta-texto">
        <strong>{BLOQUEO[primero] ?? primero}</strong>
        <p>{detalle}</p>
        {resto.length > 0 && <p className="ficha-alerta-resto">{trp("Además: {v}.", { v: resto.join('; ') })}</p>}
      </div>
      {fuera ? (
        <a className="ficha-boton ficha-boton-claro" href={h.dossierArtefactoId ? rutaDe(h.investigacionId, 'artefactos', h.dossierArtefactoId) : rutaDe(h.investigacionId, 'corrida')}>
          {tr("Atender el hallazgo")}
        </a>
      ) : (
        <button type="button" className="ficha-boton ficha-boton-claro" onClick={() => onIr(PESTANA_DE_BLOQUEO[primero] ?? 'evidencia')}>
          {tr("Ver dónde está")}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Las cuatro cifras
   --------------------------------------------------------------------- */

function Cifra({ clave, valor, sub, children, title }: { clave: string; valor: ReactNode; sub?: ReactNode; children?: ReactNode; title?: string }) {
  return (
    <div className="ficha-cifra" title={title}>
      <span className="ficha-cifra-clave">{clave}</span>
      <span className="ficha-cifra-valor">{valor}</span>
      {children}
      {sub && <span className="ficha-cifra-sub">{sub}</span>}
    </div>
  );
}

/** Los cuatro segmentos de la certeza, llenos hasta el nivel actual. */
export function MedidorCerteza({ nivel }: { nivel: CertezaEvidencia | null }) {
  const i = nivel ? NIVELES.indexOf(nivel) : -1;
  return (
    <span className={`ficha-medidor ${nivel === 'alta' ? 'ficha-medidor-alta' : ''}`} aria-hidden="true">
      {NIVELES.map((n, k) => (
        <span key={n} className={k <= i ? 'lleno' : ''} />
      ))}
    </span>
  );
}

export function CifrasClave({ h, c, killer, juicioPendiente }: { h: Hipotesis; c: ComponentesRanking; killer: ReturnType<typeof recuentoKiller>; juicioPendiente: string | null }) {
  const nivel = c.certeza?.nivel ?? null;
  const conocido = nivel !== null && NIVELES.includes(nivel);
  const direccion = c.direccion ? DIRECCION_CORTA[c.direccion] : null;
  const decision = c.killer && Object.hasOwn(DECISION_KILLER, c.killer) ? DECISION_KILLER[c.killer] : null;
  // Suspendida no es neutra: espera algo. Se pinta en ámbar como en el diseño.
  const tonoKiller: Tono = c.killer === 'suspender' ? 'aviso' : (decision?.tono ?? 'borde');
  return (
    <div className="ficha-cifras" role="group" aria-label={tr("Cifras clave")}>
      <Cifra clave={tr("Certeza")} valor={conocido ? NIVEL_CORTO[nivel!] : nivel ? certezaDe(nivel).etiqueta : tr("Sin conclusión")} sub={conocido ? tr("de 4 niveles") : tr("ROSA2018 la escribe al cerrar la iteración")} title={nivel ? certezaDe(nivel).nota : undefined}>
        {conocido && <MedidorCerteza nivel={nivel} />}
      </Cifra>
      <Cifra
        clave={tr("La evidencia")}
        valor={
          <>
            <Punto tono={direccion?.tono ?? 'borde'} />
            {direccion?.etiqueta ?? tr("Sin dirección todavía")}
          </>
        }
        sub={trp("{a} a favor · {b} en contra", { a: formatearEntero(c.aFavor), b: formatearEntero(c.enContra) })}
      />
      <Cifra
        clave={tr("Hypothesis Killer")}
        valor={
          <>
            <Punto tono={tonoKiller} />
            {decision?.etiqueta ?? tr("Sin juzgar")}
          </>
        }
        sub={juicioPendiente ?? (killer ? trp("{p} pasan · {n} sin comprobar{f}", { p: killer.pasa, n: killer.noComprobable, f: killer.falla > 0 ? trp(" · {f} fallan", { f: killer.falla }) : '' }) : tr("Todavía sin comprobaciones"))}
        title={decision?.nota}
      />
      <Cifra clave={tr("Torneo")} valor={trp("Elo {elo}", { elo: formatearEntero(h.elo) })} sub={[c.partidos === 1 ? tr('1 partido') : trp('{n} partidos', { n: formatearEntero(c.partidos) }), c.bt ? trp('BT {bt}', { bt: formatearEntero(c.bt.fuerza) }) : null, c.partidos < 3 ? tr('pocos para fiarse') : null].filter(Boolean).join(' · ')} />
    </div>
  );
}

/* ---------------------------------------------------------------------
   Resumen: en pocas palabras y la conclusión
   --------------------------------------------------------------------- */

export function EnPocasPalabras({ texto }: { texto: string | null | undefined }) {
  if (texto === undefined) return null;
  const parrafos = typeof texto === 'string' ? texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  return (
    <section className="ficha-bloque ficha-llano">
      <h3 className="ficha-ceja">{tr("En pocas palabras")}</h3>
      {parrafos.length === 0 ? (
        <p className="meta">{tr("ROSA2018 todavía no escribió el resumen de esta hipótesis.")}</p>
      ) : (
        parrafos.map((p, i) => (
          <p key={i} className={i === 0 ? 'ficha-llano-entrada' : 'ficha-llano-resto'}>
            {p}
          </p>
        ))
      )}
    </section>
  );
}

function Encabezado({ titulo, sub, acciones }: { titulo: string; sub?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="ficha-encabezado">
      <div>
        <h3 className="ficha-h">{titulo}</h3>
        {sub && <p className="ficha-sub">{sub}</p>}
      </div>
      {acciones}
    </div>
  );
}

/** La base de la conclusión en una frase, con la misma redacción que tenía
 *  la sección vieja: cuántas afirmaciones sostenidas y cuántas son
 *  interpretación y no datos. */
function baseDe(b: ConclusionHipotesis['base']): string {
  const v = b.interpretaciones > 0 ? (b.interpretaciones === 1 ? trp("; {interpretaciones} es interpretación, no datos", { interpretaciones: b.interpretaciones }) : trp("; {interpretaciones} son interpretaciones, no datos", { interpretaciones: b.interpretaciones })) : '';
  return b.fuentes === 1
    ? trp("Se apoya en {sostenidas} de {afirmaciones} afirmaciones sostenidas, de {fuentes} fuente{v}.", { sostenidas: b.sostenidas, afirmaciones: b.afirmaciones, fuentes: b.fuentes, v })
    : trp("Se apoya en {sostenidas} de {afirmaciones} afirmaciones sostenidas, de {fuentes} fuentes{v}.", { sostenidas: b.sostenidas, afirmaciones: b.afirmaciones, fuentes: b.fuentes, v });
}

/** La conclusión provisional contada para leerla de arriba abajo. Es lo
 *  mismo que la sección "Conclusión de ROSA2018" de antes, con el orden de
 *  una lectura: qué concluye, por qué, qué la apoya y qué la movería. */
export function ConclusionLegible({ h, ahora, nAfirmaciones, onIr }: { h: Hipotesis; ahora: number; nAfirmaciones: number; onIr: (p: PestanaFicha) => void }) {
  const k = h.conclusion;
  if (k === undefined) return null;
  if (k === null || typeof k !== 'object') {
    return (
      <section className="ficha-bloque">
        <Encabezado titulo={tr("Lo que concluye ROSA2018")} />
        <p className="meta">{tr("ROSA2018 todavía no escribió su conclusión sobre esta hipótesis. La escribe al crearla y la rehace al cerrar cada iteración con la evidencia que le haya llegado desde entonces.")}</p>
      </section>
    );
  }
  const nivel = NIVELES.includes(k.certeza) ? k.certeza : null;
  const aFavor = textos(k.aFavor);
  const enContra = textos(k.enContra);
  const factores = lista<{ factor?: unknown; efecto?: unknown; explicacion?: unknown }>(k.factores);
  const escalera = lista<{ a?: unknown; falta?: unknown }>(k.escalera);
  const noComprobado = textos(k.noComprobado);
  const b = k.base && typeof k.base === 'object' ? k.base : null;
  const techo = k.techo && typeof k.techo === 'object' && NIVELES.includes(k.techo.nivel) ? k.techo : null;
  const cambio = k.cambio && typeof k.cambio === 'object' && k.cambio.de ? k.cambio : null;
  const iNivel = nivel ? NIVELES.indexOf(nivel) : -1;
  return (
    <>
      <section className="ficha-bloque">
        <Encabezado
          titulo={tr("Lo que concluye ROSA2018")}
          sub={
            <>
              {tr("Dos cosas distintas, como en GRADE: cuánto se puede fiar uno de la evidencia (certeza) y hacia dónde apunta (dirección). Ninguna dice si la hipótesis es cierta: eso lo decide un experimento.")}{' '}
              {trp("Iteración {iteracion} · ", { iteracion: k.iteracion })}
              <Momento t={k.fecha} ahora={ahora} />
            </>
          }
        />
        <div className="ficha-veredicto">
          {typeof k.enunciado === 'string' && k.enunciado && <p className="ficha-veredicto-frase">{k.enunciado}</p>}
          {typeof k.conclusion === 'string' && k.conclusion && <p>{k.conclusion}</p>}
          {cambio && (
            <p className="meta">
              {trp("Cambio respecto a la iteración {v}: antes {v2} y {v3}. {motivo}", { v: cambio.de.iteracion ?? '?', v2: cambio.de.certeza ? certezaDe(cambio.de.certeza).etiqueta.toLowerCase() : tr('sin certeza'), v3: cambio.de.direccion && Object.hasOwn(DIRECCION_EVIDENCIA, cambio.de.direccion) ? DIRECCION_EVIDENCIA[cambio.de.direccion].etiqueta.toLowerCase() : tr('sin dirección'), motivo: typeof cambio.motivo === 'string' ? cambio.motivo : '' })}
            </p>
          )}
          {techo && (
            <p className="meta">
              {trp("Nivel máximo con lo que hay, por regla: {nivel}, porque {motivo}.", { nivel: NIVEL_CORTO[techo.nivel].toLowerCase(), motivo: techo.motivo })}
              {techo.acotada && NIVELES.includes(techo.certezaDelJuez) && trp(" El juez había dicho «{v}»; la regla lo acotó.", { v: certezaDe(techo.certezaDelJuez).etiqueta.toLowerCase() })}
            </p>
          )}
        </div>
        {factores.length > 0 && (
          <div>
            <h4 className="ficha-mini">{tr("Por qué esta certeza")}</h4>
            <ul className="ficha-factores">
              {factores.map((f, i) => {
                const efecto = f.efecto === 'baja' || f.efecto === 'sube' ? f.efecto : 'neutro';
                const nombre = typeof f.factor === 'string' ? (Object.hasOwn(FACTOR_CERTEZA, f.factor) ? FACTOR_CERTEZA[f.factor as keyof typeof FACTOR_CERTEZA] : f.factor.replace(/_/g, ' ')) : '';
                return (
                  <li key={i}>
                    <span className={`ficha-efecto ficha-efecto-${efecto}`}>{efecto === 'baja' ? tr('Resta') : efecto === 'sube' ? tr('Suma') : tr('Neutro')}</span>
                    <div>
                      <strong>{nombre}</strong>
                      {typeof f.explicacion === 'string' && <p>{f.explicacion}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="ficha-bloque">
        <Encabezado
          titulo={tr("Qué la apoya y qué la debilita")}
          sub={b ? baseDe(b) : undefined}
        />
        <div className="ficha-dos">
          <div>
            <h4 className="ficha-columna-titulo">
              <Punto tono="ok" /> {tr("A favor")} <span className="ficha-cuenta">{aFavor.length}</span>
            </h4>
            {aFavor.length === 0 ? (
              <p className="meta">{tr("Nada directo.")}</p>
            ) : (
              <ul className="ficha-lista">
                {aFavor.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="ficha-columna-titulo">
              <Punto tono="mal" /> {tr("En contra o la debilita")} <span className="ficha-cuenta">{enContra.length}</span>
            </h4>
            {enContra.length === 0 ? (
              <p className="meta">{tr("Nada encontrado, lo cual no es lo mismo que nada que encontrar.")}</p>
            ) : (
              <ul className="ficha-lista">
                {enContra.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {nAfirmaciones > 0 && (
          <button type="button" className="enlace ficha-ver-mas" onClick={() => onIr('evidencia')}>
            {trp("Ver las {n} afirmaciones con sus citas →", { n: nAfirmaciones })}
          </button>
        )}
      </section>

      <section className="ficha-bloque">
        <Encabezado titulo={tr("Qué la movería")} sub={typeof k.loMasFragil === 'string' && k.loMasFragil ? trp("De lo que más depende: {v}", { v: k.loMasFragil }) : undefined} />
        <div className="ficha-dos">
          <div className="ficha-caja">
            <h4 className="ficha-columna-titulo ficha-sube">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
              {tr("Subiría la certeza si")}
            </h4>
            <p>{typeof k.subiria === 'string' && k.subiria ? k.subiria : tr('Sin indicar.')}</p>
          </div>
          <div className="ficha-caja">
            <h4 className="ficha-columna-titulo ficha-baja">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 8v9H8" />
              </svg>
              {tr("Bajaría si")}
            </h4>
            <p>{typeof k.bajaria === 'string' && k.bajaria ? k.bajaria : tr('Sin indicar.')}</p>
          </div>
        </div>
        {nivel && (
          <div>
            <h4 className="ficha-mini">{tr("Para subir de nivel")}</h4>
            <ol className="ficha-escalera">
              {NIVELES.map((n, i) => {
                const paso = escalera.find((p) => p.a === n);
                const falta = typeof paso?.falta === 'string' ? paso.falta : null;
                const estado = i < iNivel ? 'pasado' : i === iNivel ? 'ahora' : i === iNivel + 1 ? 'siguiente' : 'lejos';
                return (
                  <li key={n} className={`ficha-escalon ficha-escalon-${estado}`}>
                    <span className="ficha-escalon-punto" aria-hidden="true" />
                    <div>
                      <strong>{NIVEL_CORTO[n]}</strong>
                      {estado === 'ahora' && <span className="ficha-etiqueta ficha-etiqueta-ahora">{tr("Ahora")}</span>}
                      {estado === 'siguiente' && <span className="ficha-etiqueta">{tr("Siguiente")}</span>}
                      <p>{estado === 'ahora' ? certezaDe(n).nota : estado === 'pasado' ? tr('Superado.') : falta ? `${falta}.` : tr('ROSA2018 no dejó escrito qué le falta para este nivel.')}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {noComprobado.length > 0 && (
          <div>
            <h4 className="ficha-mini">{tr("Qué no pudimos comprobar")}</h4>
            <ul className="ficha-lista ficha-lista-tenue">
              {noComprobado.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        {typeof k.fechaBusqueda === 'number' && k.fechaBusqueda > 0 && (
          <p className="ficha-pie">
            {tr("Evidencia buscada hasta el")} <Momento t={k.fechaBusqueda} ahora={ahora} />
          </p>
        )}
      </section>
    </>
  );
}

/* ---------------------------------------------------------------------
   La columna lateral
   --------------------------------------------------------------------- */

const COLOR_PASO: Record<string, string> = { cubierto: 'ok', parcial: 'aviso', vacio: 'vacio', no_comprobable: 'vacio' };

export function RielDeEstado({
  h,
  estado,
  c,
  killer,
  siguiente,
  onIr,
}: {
  h: Hipotesis;
  estado: EstadoRosa;
  c: ComponentesRanking;
  killer: ReturnType<typeof recuentoKiller>;
  siguiente: ReactNode;
  onIr: (p: PestanaFicha) => void;
}) {
  const ruta = h.ruta && typeof h.ruta === 'object' && Array.isArray(h.ruta.pasos) ? h.ruta : null;
  const pasos = (Object.keys(PASO_RUTA) as (keyof typeof PASO_RUTA)[]).sort((a, b) => PASO_RUTA[a].orden - PASO_RUTA[b].orden);
  const estadoPaso = (p: string) => lista<{ paso?: unknown; estado?: unknown }>(ruta?.pasos).find((x) => x.paso === p)?.estado;
  const siguientePaso = ruta && typeof ruta.siguiente === 'string' && Object.hasOwn(PASO_RUTA, ruta.siguiente) ? PASO_RUTA[ruta.siguiente as keyof typeof PASO_RUTA].etiqueta : null;
  const conflicto = new Set(c.conflictoCon.map((x) => x.id));
  const rivales = [...new Set([...c.conflictoCon.map((x) => x.id), ...lista<string>(h.rivales)])]
    .map((id) => estado.hipotesis.find((x) => x.id === id))
    .filter((x): x is Hipotesis => x !== undefined)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 2);
  const t = h.tarjeta && typeof h.tarjeta === 'object' ? h.tarjeta : null;
  const perfil = h.perfilDiana && typeof h.perfilDiana === 'object' ? h.perfilDiana : null;
  const capas = lista<{ estado?: unknown }>(perfil?.capas);
  const conRegistro = capas.filter((x) => x.estado === 'presente').length;
  const diana = (t && typeof t.diana === 'string' && t.diana) || (perfil && typeof perfil.diana === 'string' && perfil.diana) || null;
  return (
    <aside className="ficha-riel" aria-label={tr("Estado de la hipótesis")}>
      <div className="ficha-tarjeta">{siguiente}</div>

      <div className="ficha-riel-bloque">
        <h4 className="ficha-ceja ficha-ceja-tenue">{tr("Comprobaciones del Killer")}</h4>
        {killer && killer.total > 0 ? (
          <>
            <div className="ficha-barra" aria-hidden="true">
              <span className="ok" style={{ flexGrow: killer.pasa }} />
              <span className="aviso" style={{ flexGrow: killer.noComprobable }} />
              <span className="mal" style={{ flexGrow: killer.falla }} />
            </div>
            <ul className="ficha-leyenda">
              <li>
                <Punto tono="ok" /> {tr("Pasan")} <strong>{killer.pasa}</strong>
              </li>
              <li>
                <Punto tono="aviso" /> {tr("No se pudieron comprobar")} <strong>{killer.noComprobable}</strong>
              </li>
              <li>
                <Punto tono="mal" /> {tr("Fallan")} <strong>{killer.falla}</strong>
              </li>
            </ul>
          </>
        ) : (
          <p className="meta">{tr("El Killer todavía no juzgó esta versión.")}</p>
        )}
        <button type="button" className="enlace ficha-ver-mas" onClick={() => onIr('comprobaciones')}>
          {tr("Ver cada comprobación →")}
        </button>
      </div>

      {ruta && (
        <div className="ficha-riel-bloque">
          <h4 className="ficha-ceja ficha-ceja-tenue">{tr("Ruta terapéutica")}</h4>
          <p className="ficha-grande">
            <strong>{c.ruta?.cubiertos ?? 0}</strong> {tr("de 8 pasos cubiertos")}
          </p>
          <div className="ficha-segmentos" aria-hidden="true">
            {pasos.map((p) => {
              const e = estadoPaso(p);
              return <span key={p} className={typeof e === 'string' ? (COLOR_PASO[e] ?? 'vacio') : 'vacio'} title={PASO_RUTA[p].etiqueta} />;
            })}
          </div>
          <p className="meta">{siguientePaso ? trp("Siguiente: {paso}", { paso: siguientePaso.toLowerCase() }) : tr("Todos los pasos cubiertos.")}</p>
        </div>
      )}

      {rivales.length > 0 && (
        <div className="ficha-riel-bloque">
          <h4 className="ficha-ceja ficha-ceja-tenue">{tr("Compite con")}</h4>
          {rivales.map((r) => {
            const p = puestoPorElo(estado, r);
            return (
              <a key={r.id} className="ficha-rival" href={rutaDe(h.investigacionId, 'hipotesis', r.id)}>
                {p && <span className="ficha-rival-puesto">{trp("{n}.º", { n: p.puesto })}</span>}
                <span className="ficha-rival-texto">
                  <strong>{r.titulo}</strong>
                  <span className="meta">{trp("Elo {elo}", { elo: formatearEntero(r.elo) })}</span>
                  {conflicto.has(r.id) && <span className="ficha-rival-choque">{tr("Se contradicen: hay que diseñar qué las separa")}</span>}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {diana && (
        <div className="ficha-riel-bloque">
          <h4 className="ficha-ceja ficha-ceja-tenue">{tr("Diana")}</h4>
          <p className="ficha-diana">{diana}</p>
          {t && (t.celula || t.etapa) && <p className="meta">{[t.celula, t.etapa].filter((x) => typeof x === 'string' && x).join(' · ')}</p>}
          {capas.length > 0 && <p className="meta">{trp("{n} de {total} capas con registro en las bases", { n: conRegistro, total: capas.length })}</p>}
          <button type="button" className="enlace ficha-ver-mas" onClick={() => onIr('tarjeta')}>
            {tr("Ver la tarjeta →")}
          </button>
        </div>
      )}

      <button type="button" className="enlace ficha-exportar" onClick={() => onIr('historial')}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
        </svg>
        {tr("Exportar el expediente")}
      </button>
    </aside>
  );
}
