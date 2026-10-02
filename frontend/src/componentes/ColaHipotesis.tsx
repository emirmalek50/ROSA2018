// La cola de hipótesis: las filas y el formulario de proponer una. Vivía
// dentro de pantallas/Hipotesis.tsx, que era a la vez la lista y la ficha;
// la lista se mudó al Ranking (1 de octubre de 2026, Emir) porque las dos
// pantallas enseñaban lo mismo con otro orden, y en Hipotesis.tsx se quedó
// solo la ficha.
//
// Qué enseña cada vista:
// - "pendientes": primero lo que espera TU decisión, y debajo, en su propio
//   grupo, lo que ROSA2018 está aclarando tras un "no puedo juzgar". Son dos
//   esperas distintas y antes se mezclaban en una sola lista; ver
//   `esperaTuDecision` en lib/hipotesis.ts.
// - "laboratorio": el tramo final, lo asignado, en curso o con datos, más las
//   candidatas que esperan laboratorio.
// La lista de TODAS no está aquí: es la "Lista completa" del ranking, que ya
// las enseña ordenadas por Elo con las descartadas al final.
//
// El reloj (`useAhora`) se pide aquí dentro y no en la pantalla: "esperando
// 3 h 21 min" cambia cada segundo, y si el reloj viviera en el Ranking haría
// repintar el podio y las franjas enteras con él.

import { useState } from 'react';
import type { TargetAndTransition } from 'motion/react';

import { Contador, ElementoAnimado, ListaAnimada } from './Animado';
import { Chip, Momento, Seccion, Vacio } from './piezas';
import { EsqueletoTarjetas } from './Esqueleto';
import { acciones } from '../datos/almacen';
import type { EstadoRosa, Hipotesis as Hip, Investigacion } from '../datos/tipos';
import { dependeDeRetractada } from '../lib/calidad';
import { useCalculoDiferido } from '../lib/diferido';
import { DECISION_KILLER, ESTADO_HIPOTESIS, certezaDe, killerPendienteDe } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import {
  TONO_ESTADO,
  enAclaracion,
  esperaTuDecision,
  hallazgosVigentes,
  ordenarCola,
  resumirVerificacion,
  variacionElo,
} from '../lib/hipotesis';
import { tr, traducido, trp } from '../lib/idioma';
import { salidaPorDecision } from '../lib/movimiento';
import { bloqueosDe } from '../lib/priorizacion';
import { rutaDe } from '../lib/ruta';
import { useAhora } from '../lib/useAhora';

export type VistaCola = 'pendientes' | 'laboratorio';

/** Una hipótesis está en el tramo del laboratorio si tiene experimento ya
 *  asignado (no solo propuesto) o si es candidata esperando uno. */
export function enLaboratorio(h: Hip): boolean {
  return Boolean(h.experimento && (h.experimento.estado !== 'propuesto' || h.candidata));
}

/** Cuántas filas va a tener la vista, sin ordenar nada: para que la silueta
 *  pinte las mismas y el contenido no salte al llegar. */
export function filasDeLaCola(estado: EstadoRosa, invId: string, vista: VistaCola): number {
  const suyas = estado.hipotesis.filter((h) => h.investigacionId === invId);
  if (vista === 'laboratorio') return suyas.filter(enLaboratorio).length;
  return suyas.filter((h) => esperaTuDecision(h) || enAclaracion(h)).length;
}

function FilaCola({ h, ahora, href, horasEspera, estado }: { h: Hip; ahora: number; href: string; horasEspera: number; estado: EstadoRosa }) {
  const r = resumirVerificacion(h.afirmaciones);
  const bloqueos = bloqueosDe(estado, h);
  const abiertos = hallazgosVigentes(h).filter((x) => x.estado === 'abierto').length;
  const juicioPendiente = killerPendienteDe(h);
  const d = variacionElo(h);
  const pendiente = esperaTuDecision(h);
  const espera = ahora - h.creadaEn;
  const tarde = pendiente && espera > horasEspera * 3_600_000;
  const retractadas = dependeDeRetractada(h);
  return (
    <a className={`tarjeta tarjeta-interactiva hip-fila ${tarde ? 'hip-tarde' : ''}`} href={href}>
      <div>
        <h3>{h.titulo}</h3>
        <div className="hip-meta">
          {/* El estado solo cuando no es el de la cola: en "Pendientes" las
              seis filas ponían "Propuesta", y un dato que se repite en todas
              no ayuda a elegir ninguna (Emir, 28 de septiembre de 2026). */}
          {h.estado !== 'propuesta' && <Chip tono={TONO_ESTADO[h.estado]}>{ESTADO_HIPOTESIS[h.estado]}</Chip>}
          {h.origen === 'humana' && <Chip tono="acento">Humana</Chip>}
          <span className={`tono-${r.tono === 'vacio' ? 'aviso' : r.tono}`}>{r.frase}</span>
          {h.conclusion && (
            <Chip tono={certezaDe(h.conclusion.certeza).tono} title={h.conclusion.escalera?.[0] ? trp("Para subir a {v}: {falta}", { v: certezaDe(h.conclusion.escalera[0].a).etiqueta.toLowerCase(), falta: h.conclusion.escalera[0].falta }) : certezaDe(h.conclusion.certeza).nota}>
              {certezaDe(h.conclusion.certeza).etiqueta}
            </Chip>
          )}
          {h.decisionKiller && DECISION_KILLER[h.decisionKiller] && (
            <Chip tono={DECISION_KILLER[h.decisionKiller].tono} title={DECISION_KILLER[h.decisionKiller].nota}>{trp("Killer: {etiqueta}", { etiqueta: DECISION_KILLER[h.decisionKiller].etiqueta })}
            </Chip>
          )}
          {juicioPendiente && (
            <Chip tono="aviso" title={tr("La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas.")}>
              {juicioPendiente}
            </Chip>
          )}
          {(h.version ?? 1) > 1 && <Chip tono="borde">v{h.version}</Chip>}
          {h.candidata && bloqueos.length === 0 && <Chip tono="ok">Candidata</Chip>}
          {bloqueos.length > 0 && <span className="tono-mal">{(bloqueos.length === 1 ? trp("{bloqueos} bloqueo", { bloqueos: bloqueos.length }) : trp("{bloqueos} bloqueos", { bloqueos: bloqueos.length }))}</span>}
          {abiertos > 0 && <span className="tono-mal">{(abiertos === 1 ? trp("{abiertos} hallazgo abierto", { abiertos }) : trp("{abiertos} hallazgos abiertos", { abiertos }))}</span>}
          {retractadas.length > 0 && <span className="tono-mal">{tr("depende de una fuente retractada")}</span>}
          <span>{trp("Iteración {iteracion}", { iteracion: h.iteracion })}</span>
          {pendiente ? (
            <span className={tarde ? 'tono-mal' : ''} title={trp("Creada el {v}{v2}", { v: new Date(h.creadaEn).toLocaleString('es-ES'), v2: tarde ? trp("; supera las {horasEspera} h de la política de esperas", { horasEspera }) : '' })}>{trp("esperando {espera}", { espera: formatearDuracion(espera) })}
            </span>
          ) : (
            // Con "esperando 3 h 21 min" delante, la fecha absoluta repetía lo
            // mismo y empujaba la línea a partirse en dos.
            <Momento t={h.creadaEn} ahora={ahora} />
          )}
        </div>
      </div>
      <div className="hip-elo">
        <strong>
          <Contador valor={h.elo} />
        </strong>
        <span className={d > 0 ? 'subida' : d < 0 ? 'bajada' : 'meta'}>{d > 0 ? `+${d}` : d}</span>
        <span className="meta">{(h.partidos.length === 1 ? trp("{partidos} partido", { partidos: h.partidos.length }) : trp("{partidos} partidos", { partidos: h.partidos.length }))}</span>
      </div>
    </a>
  );
}

function salidaDe(h: Hip): TargetAndTransition {
  if (h.estado === 'aceptada') return salidaPorDecision.aprobar;
  if (h.estado === 'descartada') return salidaPorDecision.descartar;
  if (h.estado === 'refinar' || h.estado === 'aclarando') return salidaPorDecision.refinar;
  return salidaPorDecision.neutra;
}

/** El formulario de proponer una hipótesis. Lo abre el botón del Ranking, que
 *  es quien tiene la cabecera; aquí vive el formulario en sí. */
export function FormularioHipotesis({ inv, onCerrar, irA }: { inv: Investigacion; onCerrar: () => void; irA: (hash: string) => void }) {
  const [d, setD] = useState({ titulo: '', enunciado: '', mecanismo: '', biomarcador: '', cohorte: '', diseno: '', cluster: '' });
  const [error, setError] = useState<string | null>(null);
  const campo = (k: keyof typeof d, label: string, filas = 1, marcador = '') => (
    <div className="campo" key={k}>
      <label htmlFor={`hh-${k}`}>{label}</label>
      {filas > 1 ? <textarea id={`hh-${k}`} value={d[k]} rows={filas} placeholder={marcador} onChange={(e) => setD({ ...d, [k]: e.target.value })} /> : <input id={`hh-${k}`} value={d[k]} placeholder={marcador} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
    </div>
  );
  return (
    <form
      className="tarjeta seccion"
      onSubmit={(e) => {
        e.preventDefault();
        const id = acciones.proponerHipotesis(inv.id, d);
        if (id === null) {
          setError(tr('Faltan el título, el enunciado, o el biomarcador o la cohorte con que se comprobaría. Sin comprobación no entra al torneo.'));
          return;
        }
        irA(rutaDe(inv.id, 'hipotesis', id));
      }}
    >
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>{tr("Proponer una hipótesis")}</h3>
        <p className="meta">{tr("Entra al torneo con el mismo Elo inicial que las de ROSA2018, marcada como tuya. En Co-Scientist la conjetura del experto acabó superando a las generadas.")}</p>
      </div>
      {campo('titulo', tr('Título'), 1, tr('La función renal sesga los umbrales de p-tau217 en cohortes latinoamericanas'))}
      {campo('enunciado', 'Enunciado', 3)}
      {campo('mecanismo', tr('Mecanismo propuesto'), 2)}
      <div className="rejilla-3">
        {campo('biomarcador', 'Biomarcador', 1)}
        {campo('cohorte', 'Cohorte', 1)}
        {campo('diseno', tr('Diseño'), 1)}
      </div>
      {campo('cluster', tr('Cluster (tema)'), 1, tr('Biomarcadores sanguíneos'))}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>
          {error}
        </p>
      )}
      <div className="acciones">
        <button type="submit" className="btn btn-primario">
          {tr("Meter al torneo")}
        </button>
        <button type="button" className="btn btn-fantasma" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Medido en Chromium a 1440 px: cada fila de la cola mide 84 px (título de
 *  una línea) o 109 (de dos). */
export const ALTO_FILA_COLA = 96;
const MAX_FILAS_SILUETA = 40;

const VACIO = traducido({
  laboratorio: {
    titulo: 'Nada en el laboratorio todavía',
    nota: 'Aquí aparecerán las hipótesis que lleguen a ese tramo.',
    pasos: [
      'El Killer deja avanzar una hipótesis y el torneo la coloca entre las candidatas.',
      'ROSA2018 le propone un experimento: protocolo, ensayo, controles y criterios de éxito y refutación.',
      'Tú lo asignas a un laboratorio desde la ficha: el prerregistro se congela y se sella con un tercero.',
      'El laboratorio devuelve los datos y ROSA2018 los juzga contra lo prerregistrado.',
    ],
  },
  nadaPendiente: {
    titulo: 'Nada pendiente',
    nota: 'ROSA2018 no tiene hipótesis esperando tu revisión en esta investigación. En "Lista completa" están todas, con las ya decididas.',
  },
  sinHipotesis: {
    titulo: 'Todavía no hay hipótesis',
    nota: 'También puedes proponer una tú con el botón de arriba: pasa por el mismo Killer.',
    pasos: [
      'ROSA2018 busca literatura y verifica afirmaciones (etapas 2 y 3 del hilo).',
      'Lo sostenido entra al modelo de mundo.',
      'Con eso, ROSA2018 genera hipótesis y el Killer las juzga; las que quedan aparecen aquí, ordenadas por Elo.',
      'Tú decides sobre cada una: aceptar, descartar o pedir que la refine.',
    ],
  },
});

function Grupo({ filas, inv, estado, foto, ahora }: { filas: Hip[]; inv: Investigacion; estado: EstadoRosa; foto: EstadoRosa; ahora: number }) {
  return (
    <ListaAnimada className="cola" como="div">
      {filas.map((h) => (
        <ElementoAnimado key={h.id} salida={salidaDe(estado.hipotesis.find((x) => x.id === h.id) ?? h)}>
          <FilaCola h={h} ahora={ahora} href={rutaDe(inv.id, 'hipotesis', h.id)} horasEspera={estado.politicaEsperas.horas} estado={foto} />
        </ElementoAnimado>
      ))}
    </ListaAnimada>
  );
}

export function ColaHipotesis({ inv, estado, vista }: { inv: Investigacion; estado: EstadoRosa; vista: VistaCola }) {
  const ahora = useAhora();
  // Ordenar y pintar cada fila con sus chips congelaba la pantalla un
  // instante al cambiar de investigación; el primer frame es la silueta y el
  // trabajo va detrás. Se guarda con qué investigación se calculó: si ya no
  // es esa, lo que hay es de otra y se vuelve a la silueta.
  const { valor: calculada } = useCalculoDiferido(
    () => ({ invId: inv.id, estado, propias: ordenarCola(estado.hipotesis.filter((h) => h.investigacionId === inv.id)) }),
    [inv.id, estado],
  );
  const cola = calculada !== null && calculada.invId === inv.id ? calculada : null;
  if (cola === null) {
    return <EsqueletoTarjetas filas={Math.min(MAX_FILAS_SILUETA, Math.max(1, filasDeLaCola(estado, inv.id, vista)))} altoFila={ALTO_FILA_COLA} />;
  }
  const propias = cola.propias;

  if (vista === 'laboratorio') {
    const enLab = propias.filter(enLaboratorio);
    if (enLab.length === 0) {
      return (
        <Vacio titulo={VACIO.laboratorio.titulo} pasos={VACIO.laboratorio.pasos}>
          {VACIO.laboratorio.nota}
        </Vacio>
      );
    }
    return <Grupo filas={enLab} inv={inv} estado={estado} foto={cola.estado} ahora={ahora} />;
  }

  const tuyas = propias.filter(esperaTuDecision);
  const aclarando = propias.filter(enAclaracion);
  if (tuyas.length === 0 && aclarando.length === 0) {
    // Dos vacíos distintos: «nada pendiente» (ya decidiste todo) no es lo
    // mismo que «todavía no hay hipótesis» (ROSA2018 no ha generado ninguna),
    // y el segundo lleva los pasos de cómo nacen.
    return propias.length > 0 ? (
      <Vacio titulo={VACIO.nadaPendiente.titulo}>{VACIO.nadaPendiente.nota}</Vacio>
    ) : (
      <Vacio titulo={VACIO.sinHipotesis.titulo} pasos={VACIO.sinHipotesis.pasos}>
        {VACIO.sinHipotesis.nota}
      </Vacio>
    );
  }
  return (
    <>
      {tuyas.length > 0 && <Grupo filas={tuyas} inv={inv} estado={estado} foto={cola.estado} ahora={ahora} />}
      {aclarando.length > 0 && (
        <Seccion
          titulo={`${tr('ROSA2018 las está aclarando')} (${aclarando.length})`}
          nota={tr('Las que devolviste con "no puedo juzgar". Esperan a ROSA2018, no a ti: cuando las aclare vuelven arriba. Por eso no cuentan en el número de pendientes.')}
        >
          <Grupo filas={aclarando} inv={inv} estado={estado} foto={cola.estado} ahora={ahora} />
        </Seccion>
      )}
      {(inv.vivero?.length ?? 0) > 0 && (
        <Seccion
          detalle
          titulo={trp("Vivero de ideas ({length})", { length: inv.vivero!.length })}
          nota={tr("Propuestas de ROSA2018 que todavía no nacen como hipótesis: su evidencia viene de una sola cohorte y no da para certeza baja. En cada cierre de iteración ROSA2018 les suma lo que lee; cuando llegan a dos cohortes distintas, nacen y entran en la cola. Si pasan seis iteraciones sin ganar nada, salen con su motivo.")}
        >
          <div className="cola">
            {inv.vivero!.map((s) => (
              <div key={s.id} className="tarjeta hip-fila">
                <div>
                  <h3>{s.titulo}</h3>
                  <p className="meta">{s.enunciado}</p>
                  <div className="hip-meta">
                    <Chip tono="borde">{trp("Idea desde la iteración {iteracion}", { iteracion: s.iteracion })}</Chip>
                    <Chip tono="borde">{(s.afirmaciones.length === 1 ? trp("{afirmaciones} afirmación", { afirmaciones: s.afirmaciones.length }) : trp("{afirmaciones} afirmaciones", { afirmaciones: s.afirmaciones.length }))}</Chip>
                    <Chip tono="borde">{(s.fuentes.length === 1 ? trp("{fuentes} fuente", { fuentes: s.fuentes.length }) : trp("{fuentes} fuentes", { fuentes: s.fuentes.length }))}</Chip>
                    <span className="meta">Actualizada <Momento t={s.actualizadaEn} ahora={ahora} /></span>
                  </div>
                  <p className="meta"><strong>{tr("Le falta para nacer:")}</strong> {s.falta}</p>
                </div>
              </div>
            ))}
          </div>
        </Seccion>
      )}
    </>
  );
}
