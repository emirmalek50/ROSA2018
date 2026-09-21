// La cola de revisión de hipótesis y el detalle de una. Aceptar, descartar,
// refinar, "no puedo juzgar", con la procedencia en un cajón lateral; los
// hallazgos del revisor como tarjetas; comentarios anclados; la revisión
// escrita de la persona que entra al torneo; la relevancia votada aparte de
// la significancia; los supuestos; los tipos de revisión; los partidos del
// torneo; replicar; el experimento propuesto; y la hipótesis humana.
// Regla: una hipótesis no entra al modelo de mundo como aceptada sin pasar
// por aquí, y no se puede aceptar con afirmaciones bloqueantes o hallazgos
// abiertos (motivoNoAceptable).
//
// Esperas visibles (estándar de Emir, 19 de septiembre de 2026): la cola se
// ordena y se pinta después de un frame de silueta (EsqueletoPantalla
// "lista"), la ficha abre con un frame de silueta "ficha", y cada botón que
// habla con el servidor lleva su marca de vuelo (useEnVuelo).

import { useEffect, useRef, useState } from 'react';
import { Contador, ElementoAnimado, ListaAnimada } from '../componentes/Animado';
import type { TargetAndTransition } from 'motion/react';
import { salidaPorDecision } from '../lib/movimiento';
import { acciones } from '../datos/almacen';
import type { EstadoRosa, Hipotesis as Hip, Investigacion, Supuesto } from '../datos/tipos';
import { BandejaComentarios, NuevoComentario, useSeleccionComentable } from '../componentes/Comentarios';
import { Procedencia, type PestanaProcedencia } from '../componentes/Procedencia';
import { Revisor } from '../componentes/Revisor';
import { Verificacion } from '../componentes/Verificacion';
import { ConclusionDeRosa, HipotesisEnLlano } from '../componentes/EnLlano';
import { AvisoMuestra, Chip, Confirmar, Momento, Seccion, Vacio, descargar } from '../componentes/piezas';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjetas } from '../componentes/Esqueleto';
import { Bloqueos, ConsultasABases, ContextoDeBases, ContratoDelExperimento, DecisionesKiller, Dimensiones, EjecucionesInSilico, FusionYConflictos, GrafoCausalDeHipotesis, PerfilDeLaDiana, ProtocoloYEnmiendas, TarjetaDeHipotesis } from '../componentes/Rosa2018';
import { FranjaRanking } from '../componentes/FranjaRanking';
import { Alternativas } from '../componentes/Alternativas';
import { dependeDeRetractada, resumenEvidencia, tramosFuertes } from '../lib/calidad';
import { ESTADO_HIPOTESIS, ESTADO_SUPUESTO, TIPO_REVISION, DECISION_KILLER, RESULTADO_LABORATORIO, certezaDe, killerPendienteDe } from '../lib/etiquetas';
import { expediente } from '../lib/exportar';
import { formatearDuracion } from '../lib/formato';
import { motivoNoAceptable, ordenarCola, resumirVerificacion, variacionElo } from '../lib/hipotesis';
import { bloqueosDe } from '../lib/priorizacion';
import { rutaDe } from '../lib/ruta';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo, useEsperaSenal } from '../lib/diferido';
import { ESPERA_DOSSIER_MS, huellaDossier } from './Artefactos';

const TONO_ESTADO: Record<Hip['estado'], 'ok' | 'aviso' | 'mal' | 'acento' | undefined> = {
  propuesta: 'acento',
  en_revision: 'aviso',
  aceptada: 'ok',
  descartada: 'mal',
  refinar: 'aviso',
  aclarando: 'aviso',
};

/** Los hallazgos del revisor tal como cuentan hoy. El Killer abre un hallazgo
 *  "El Killer propone descartarla en este contexto" al proponer el descarte; si
 *  una pasada posterior (con evidencia nueva) dijo avanzar o suspender, ese
 *  hallazgo ya no describe la decisión vigente y se enseña como atendido, con
 *  la nota de por qué, en vez de seguir bloqueando la aceptación y contando
 *  como "hallazgo abierto". Misma lectura que hace el servidor al restaurar el
 *  estado tras un avanzar (rosa/bucle/pasos.py): solo con "avanzar" o
 *  "suspender" posteriores. Sin decisión (la versión nueva aún no pasó por el
 *  Killer) o con "reformular", el servidor no lo atiende y aquí tampoco: un
 *  descarte propuesto no se retira por ausencia de juicio. Nada se borra: el
 *  hallazgo sigue en el registro con su razonamiento. */
export function hallazgosVigentes(h: Pick<Hip, 'hallazgos' | 'decisionKiller' | 'version'>): Hip['hallazgos'] {
  const hallazgos = Array.isArray(h.hallazgos) ? h.hallazgos : [];
  if (h.decisionKiller !== 'avanzar' && h.decisionKiller !== 'suspender') return hallazgos;
  return hallazgos.map((x) =>
    x && x.estado === 'abierto' && /^El Killer propone descartarla/i.test(String(x.resumen ?? ''))
      ? { ...x, estado: 'atendido' as const, respuestaDeRosa: x.respuestaDeRosa || `Retirado: la decisión más reciente del Killer sobre la versión ${h.version ?? 1} ya no es descartar${h.decisionKiller ? ` (${(DECISION_KILLER[h.decisionKiller]?.etiqueta ?? String(h.decisionKiller)).toLowerCase()})` : ''}.` }
      : x,
  );
}

/** Texto con los tramos que afirman de más subrayados en ámbar. */
function TextoConFuertes({ texto, campo, como = 'p' }: { texto: string; campo: 'enunciado' | 'mecanismo'; como?: 'p' | 'h2' }) {
  const Etiqueta = como;
  const tramos = tramosFuertes(texto);
  if (tramos.length === 0)
    return (
      <Etiqueta className="texto-comentable" data-campo={campo}>
        {texto}
      </Etiqueta>
    );
  const partes: React.ReactNode[] = [];
  let pos = 0;
  tramos.forEach((t, i) => {
    partes.push(texto.slice(pos, t.inicio));
    partes.push(
      <mark key={i} className="fuerte" title="Afirma con más seguridad de la que suele dar la evidencia. Considera un verbo más prudente.">
        {texto.slice(t.inicio, t.fin)}
      </mark>,
    );
    pos = t.fin;
  });
  partes.push(texto.slice(pos));
  return (
    <Etiqueta className="texto-comentable" data-campo={campo}>
      {partes}
    </Etiqueta>
  );
}

function FilaCola({ h, ahora, href, horasEspera, estado }: { h: Hip; ahora: number; href: string; horasEspera: number; estado: EstadoRosa }) {
  const r = resumirVerificacion(h.afirmaciones);
  const bloqueos = bloqueosDe(estado, h);
  const abiertos = hallazgosVigentes(h).filter((x) => x.estado === 'abierto').length;
  const juicioPendiente = killerPendienteDe(h);
  const d = variacionElo(h);
  const pendiente = h.estado === 'propuesta' || h.estado === 'en_revision' || h.estado === 'refinar';
  const espera = ahora - h.creadaEn;
  const tarde = pendiente && espera > horasEspera * 3_600_000;
  const retractadas = dependeDeRetractada(h);
  return (
    <a className={`tarjeta tarjeta-interactiva hip-fila ${tarde ? 'hip-tarde' : ''}`} href={href}>
      <div>
        <h3>{h.titulo}</h3>
        <div className="hip-meta">
          <Chip tono={TONO_ESTADO[h.estado]}>{ESTADO_HIPOTESIS[h.estado]}</Chip>
          {h.origen === 'humana' && <Chip tono="acento">Humana</Chip>}
          <span className={`tono-${r.tono === 'vacio' ? 'aviso' : r.tono}`}>{r.frase}</span>
          {h.conclusion && (
            <Chip tono={certezaDe(h.conclusion.certeza).tono} title={h.conclusion.escalera?.[0] ? `Para subir a ${certezaDe(h.conclusion.escalera[0].a).etiqueta.toLowerCase()}: ${h.conclusion.escalera[0].falta}` : certezaDe(h.conclusion.certeza).nota}>
              {certezaDe(h.conclusion.certeza).etiqueta}
            </Chip>
          )}
          {h.decisionKiller && DECISION_KILLER[h.decisionKiller] && (
            <Chip tono={DECISION_KILLER[h.decisionKiller].tono} title={DECISION_KILLER[h.decisionKiller].nota}>
              Killer: {DECISION_KILLER[h.decisionKiller].etiqueta}
            </Chip>
          )}
          {juicioPendiente && (
            <Chip tono="aviso" title="La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas.">
              {juicioPendiente}
            </Chip>
          )}
          {(h.version ?? 1) > 1 && <Chip tono="borde">v{h.version}</Chip>}
          {h.candidata && bloqueos.length === 0 && <Chip tono="ok">Candidata</Chip>}
          {bloqueos.length > 0 && <span className="tono-mal">{bloqueos.length} {bloqueos.length === 1 ? 'bloqueo' : 'bloqueos'}</span>}
          {abiertos > 0 && <span className="tono-mal">{abiertos} {abiertos === 1 ? 'hallazgo abierto' : 'hallazgos abiertos'}</span>}
          {retractadas.length > 0 && <span className="tono-mal">depende de una fuente retractada</span>}
          <span>Iteración {h.iteracion}</span>
          {pendiente && (
            <span className={tarde ? 'tono-mal' : ''} title={tarde ? `Supera las ${horasEspera} h de la política de esperas` : ''}>
              esperando {formatearDuracion(espera)}
            </span>
          )}
          <Momento t={h.creadaEn} ahora={ahora} />
        </div>
      </div>
      <div className="hip-elo">
        <strong>
          <Contador valor={h.elo} />
        </strong>
        <span className={d > 0 ? 'subida' : d < 0 ? 'bajada' : 'meta'}>{d > 0 ? `+${d}` : d}</span>
        <span className="meta">{h.partidos.length} {h.partidos.length === 1 ? 'partido' : 'partidos'}</span>
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

function ArbolSupuestos({ supuestos, nivel = 0 }: { supuestos: Supuesto[]; nivel?: number }) {
  return (
    <ul className="supuestos" style={{ paddingLeft: nivel * 18 }}>
      {supuestos.map((s) => {
        const e = ESTADO_SUPUESTO[s.estado];
        return (
          <li key={s.id} className={`supuesto supuesto-${e.tono}`}>
            <div className="acciones" style={{ gap: 8 }}>
              <Chip tono={e.tono === 'neutro' ? 'borde' : e.tono}>{e.etiqueta}</Chip>
              <span style={{ fontSize: 13.5 }}>{s.texto}</span>
            </div>
            {s.evidencia !== '' && <p className="meta">{s.evidencia}</p>}
            {s.hijos.length > 0 && <ArbolSupuestos supuestos={s.hijos} nivel={nivel + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

function FormularioHipotesis({ inv, onCerrar, irA }: { inv: Investigacion; onCerrar: () => void; irA: (hash: string) => void }) {
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
          setError('Faltan el título, el enunciado, o el biomarcador o la cohorte con que se comprobaría. Sin comprobación no entra al torneo.');
          return;
        }
        irA(rutaDe(inv.id, 'hipotesis', id));
      }}
    >
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Proponer una hipótesis</h3>
        <p className="meta">Entra al torneo con el mismo Elo inicial que las de ROSA2018, marcada como tuya. En Co-Scientist la conjetura del experto acabó superando a las generadas.</p>
      </div>
      {campo('titulo', 'Título', 1, 'La función renal sesga los umbrales de p-tau217 en cohortes latinoamericanas')}
      {campo('enunciado', 'Enunciado', 3)}
      {campo('mecanismo', 'Mecanismo propuesto', 2)}
      <div className="rejilla-3">
        {campo('biomarcador', 'Biomarcador', 1)}
        {campo('cohorte', 'Cohorte', 1)}
        {campo('diseno', 'Diseño', 1)}
      </div>
      {campo('cluster', 'Cluster (tema)', 1, 'Biomarcadores sanguíneos')}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>
          {error}
        </p>
      )}
      <div className="acciones">
        <button type="submit" className="btn btn-primario">
          Meter al torneo
        </button>
        <button type="button" className="btn btn-fantasma" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Detalle({ h, estado, ahora, onAbrirProcedencia }: { h: Hip; estado: EstadoRosa; ahora: number; onAbrirProcedencia: (pestana: PestanaProcedencia, celda?: number) => void }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancla, limpiarAncla] = useSeleccionComentable(contenedor);
  const [nota, setNota] = useState('');
  const [aCiegas, setACiegas] = useState(false);
  const [revisionAbierta, setRevisionAbierta] = useState(false);
  const [rev, setRev] = useState({ supuestosCuestionados: '', literaturaQueFalta: '', problemaExperimental: '' });
  const [lab, setLab] = useState('');
  const [ficheroDatos, setFicheroDatos] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState('');
  const [datosSinteticos, setDatosSinteticos] = useState(false);
  const [aplicableA, setAplicableA] = useState('');
  const pendientes = estado.comentarios.filter((c) => c.hipotesisId === h.id && c.estado === 'pendiente');
  const vigentes = hallazgosVigentes(h);
  const motivo = motivoNoAceptable({ ...h, hallazgos: vigentes });
  const juicioPendiente = killerPendienteDe(h);
  const rivales = h.rivales.map((id) => estado.hipotesis.find((x) => x.id === id)).filter((x): x is Hip => x !== undefined);
  const cerrada = h.estado === 'aceptada' || h.estado === 'descartada';
  const aclarando = h.estado === 'aclarando';
  const corrida = estado.corridas.filter((c) => c.investigacionId === h.investigacionId).sort((a, b) => b.numero - a.numero)[0];
  const cobertura = corrida?.coberturas.find((c) => c.tema.toLowerCase() === h.cluster.toLowerCase() || h.cluster.toLowerCase().includes(c.tema.toLowerCase())) ?? null;
  const retractadas = dependeDeRetractada(h);
  const revisionHumana = revisionAbierta && (rev.supuestosCuestionados || rev.literaturaQueFalta || rev.problemaExperimental) ? rev : null;
  const abiertoEn = useRef(Date.now());
  const segundosRevision = () => Math.round((Date.now() - abiertoEn.current) / 1000);
  // Botones que hablan con el servidor, cada grupo con su marca de vuelo:
  // mientras dura la petición el botón se atenúa con su spinner y no admite
  // un segundo clic. Las decisiones (aceptar, refinar, descartar, no puedo
  // juzgar, reabrir) comparten marca porque son excluyentes entre sí. Hoy
  // revisarHipotesis aplica la decisión en local y la manda tras el margen
  // de deshacer (almacen.ts, programar), así que su marca dura un instante;
  // el resto de acciones aún no devuelven su promesa (enviar() es fuego y
  // olvido) y en cuanto la devuelvan el botón esperará al servidor.
  const [decisionEnVuelo, envolverDecision] = useEnVuelo();
  const [revisionEnVuelo, envolverRevision] = useEnVuelo();
  const [replicaEnVuelo, envolverReplica] = useEnVuelo();
  const [selloEnVuelo, envolverSello] = useEnVuelo();
  const [laboratorioEnVuelo, envolverLaboratorio] = useEnVuelo();
  const [dossierEnVuelo, envolverDossier] = useEnVuelo();
  // El dossier no llega en la respuesta del POST sino como artefacto por el
  // canal en vivo: además de la promesa (el viaje al servidor), el botón
  // espera a que cambie la huella del dossier de esta hipótesis (Artefactos.tsx,
  // huellaDossier) o a que pase un minuto. Así un segundo clic mientras el
  // servidor lo arma no genera un segundo dossier.
  const esperaDossier = useEsperaSenal(huellaDossier(h, estado.artefactos), ESPERA_DOSSIER_MS);
  const dossierOcupado = dossierEnVuelo || esperaDossier.esperando;
  const pedirDossier = envolverDossier(() => {
    esperaDossier.pedir();
    return acciones.generarDossier(h.id);
  });
  const decidir = envolverDecision((accion: 'aceptar' | 'refinar' | 'no_puedo_juzgar' | 'reabrir' | 'descartar', n: string) => {
    // Se devuelve lo que devuelva la acción: si algún día es una promesa, el
    // botón queda en vuelo hasta que resuelva.
    const resultado = acciones.revisarHipotesis(h.id, accion, n, aCiegas, revisionHumana, h.version ?? 1, segundosRevision());
    setNota('');
    if (accion !== 'descartar') setRev({ supuestosCuestionados: '', literaturaQueFalta: '', problemaExperimental: '' });
    return resultado;
  });

  return (
    <div className="detalle-hip" ref={contenedor}>
      <div>
        <div className="acciones" style={{ marginBottom: 8 }}>
          <Chip tono={TONO_ESTADO[h.estado]}>{ESTADO_HIPOTESIS[h.estado]}</Chip>
          {h.origen === 'humana' && <Chip tono="acento">Propuesta por una persona</Chip>}
          {h.derivadaDe && (
            <a className="chip chip-borde" href={rutaDe(h.investigacionId, 'hipotesis', h.derivadaDe)}>
              Derivada de otra hipótesis
            </a>
          )}
          <span className="meta">Elo {h.elo} · {h.partidos.length} {h.partidos.length === 1 ? 'partido' : 'partidos'}</span>
          <span className="meta">Iteración {h.iteracion}</span>
          <span className="meta">Versión {h.version ?? 1}</span>
          {h.decisionKiller && DECISION_KILLER[h.decisionKiller] && (
            <Chip tono={DECISION_KILLER[h.decisionKiller].tono} title={DECISION_KILLER[h.decisionKiller].nota}>
              Killer: {DECISION_KILLER[h.decisionKiller].etiqueta}
            </Chip>
          )}
          {juicioPendiente && (
            <Chip tono="aviso" title="La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas con «Pedir revisión».">
              {juicioPendiente}
            </Chip>
          )}
          <Bloqueos bloqueos={bloqueosDe(estado, h)} candidata={h.candidata} />
          <span className="meta">
            Prerregistrada <Momento t={h.prerregistradaEn} ahora={ahora} />
          </span>
          <button type="button" className="enlace" style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => onAbrirProcedencia('fuentes')}>
            Ver procedencia
          </button>
        </div>
        <TextoConFuertes texto={h.titulo} campo="enunciado" como="h2" />
        <FranjaRanking estado={estado} h={h} explicar />
      </div>

      {retractadas.length > 0 && (
        <div className="aviso-retractada" role="alert">
          Depende de {retractadas.length === 1 ? 'una fuente retractada' : `${retractadas.length} fuentes retractadas`}: {retractadas.map((f) => f.referencia).join(', ')}. No vale como evidencia y la hipótesis baja en el ranking.
        </div>
      )}

      <div className="acciones">
        <span className="meta">
          Última revisión automática: {h.ultimaRevisionAutomatica ? <Momento t={h.ultimaRevisionAutomatica} ahora={ahora} /> : 'nunca'}. El silencio del revisor no es aprobación.
        </span>
        <button type="button" className="btn btn-s" disabled={revisionEnVuelo} {...atributosEnVuelo(revisionEnVuelo)} onClick={envolverRevision(() => acciones.solicitarRevision(h.id))}>
          Solicitar revisión ahora
        </button>
        <label className="interruptor" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={aCiegas} onChange={(e) => setACiegas(e.target.checked)} />
          Revisar a ciegas (ocultar citas y código hasta decidir)
        </label>
      </div>

      <p className="meta">Selecciona un tramo del texto para comentarlo. Los comentarios se agrupan y salen juntos a ROSA2018. Los verbos en ámbar afirman más de lo que la evidencia suele dar.</p>

      {ancla && (
        <NuevoComentario
          ancla={ancla}
          onGuardar={(n) => {
            acciones.anadirComentario(h.id, ancla, n);
            limpiarAncla();
            window.getSelection()?.removeAllRanges();
          }}
          onCancelar={limpiarAncla}
        />
      )}

      <HipotesisEnLlano texto={h.enLlano} />

      <ConclusionDeRosa conclusion={h.conclusion} ahora={ahora} />

      <TarjetaDeHipotesis h={h} />
        <ContextoDeBases h={h} />
        <PerfilDeLaDiana h={h} />
        <GrafoCausalDeHipotesis h={h} />
        <ConsultasABases h={h} ahora={ahora} />

      <FusionYConflictos h={h} estado={estado} />
      <DecisionesKiller h={h} decisiones={estado.decisiones ?? []} ahora={ahora} conjuntoDorado={estado.conjuntoDorado ?? []} />

      <Seccion titulo="Enunciado">
        <TextoConFuertes texto={h.enunciado} campo="enunciado" />
      </Seccion>

      <Seccion titulo="Mecanismo propuesto">
        <TextoConFuertes texto={h.mecanismo} campo="mecanismo" />
      </Seccion>

      <Seccion titulo="Explicaciones alternativas" nota="Lo que también explicaría lo observado sin que la hipótesis sea cierta (causa inversa, un confusor, cómo se eligió la muestra, un artefacto de la medida), y qué observación separaría cada alternativa de la hipótesis. ROSA2018 las escribe al cerrar cada iteración; una alternativa sin forma de distinguirla no sirve para diseñar un experimento.">
        <Alternativas h={h} />
      </Seccion>

      <Seccion titulo="Cómo se comprobaría" nota="Siempre con biomarcador, cohorte y diseño: es lo que el investigador clínico principal necesita para juzgarla.">
        <dl className="comprobacion texto-comentable" data-campo="comprobacion">
          <dt>Biomarcador</dt>
          <dd>{h.comprobacion.biomarcador}</dd>
          <dt>Cohorte</dt>
          <dd>{h.comprobacion.cohorte}</dd>
          <dt>Diseño</dt>
          <dd>{h.comprobacion.diseno}</dd>
        </dl>
      </Seccion>

      <Seccion titulo="Relevancia frente a significancia" nota="Kosmos confunde lo estadísticamente significativo con lo científicamente valioso. Aquí son dos escalas: ROSA2018 justifica la relevancia para el objetivo y tú la votas.">
        <div className="rejilla-2">
          <div className="tarjeta">
            <p className="campo-etiqueta">Evidencia estadística</p>
            <Chip tono={h.evidenciaEstadistica === 'fuerte' ? 'ok' : h.evidenciaEstadistica === 'debil' ? 'mal' : h.evidenciaEstadistica === 'moderada' ? 'aviso' : 'borde'}>
              {h.evidenciaEstadistica === 'no_aplica' ? 'No aplica' : h.evidenciaEstadistica.charAt(0).toUpperCase() + h.evidenciaEstadistica.slice(1)}
            </Chip>
            <p className="meta" style={{ marginTop: 6 }}>
              {resumenEvidencia(h.procedencia.fuentes)}
            </p>
          </div>
          <div className="tarjeta">
            <p className="campo-etiqueta">Relevancia para el objetivo</p>
            <p style={{ fontSize: 13, margin: '6px 0' }}>{h.relevancia.justificacion}</p>
            <div className="segmentos" role="group" aria-label="Tu voto de relevancia">
              {(['alta', 'media', 'baja'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={h.relevancia.votoHumano === v} onClick={() => acciones.votarRelevancia(h.id, v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {h.evidenciaEstadistica === 'fuerte' && h.relevancia.votoHumano === 'baja' && <p className="tono-aviso" style={{ fontSize: 12.5, marginTop: 6 }}>Significativa pero irrelevante: un agujero de conejo. Cuenta en Calidad.</p>}
          </div>
        </div>
      </Seccion>

      <Seccion detalle titulo="Novedad" nota="Consultas baratas antes de gastar una corrida: Open Targets, ClinicalTrials.gov, Agora, la genética humana (GWAS Catalog, ClinVar), los fármacos contra la diana (ChEMBL, DGIdb), los datos públicos para comprobarla (GEO, CELLxGENE) y si alguien ya lo propuso en la literatura. Con Exa, además, patentes y proyectos financiados anteriores a la hipótesis: una idea ya protegida o ya financiada no es nueva aunque no esté publicada.">
        <div className="novedad novedad-4">
          <div className="novedad-item">
            <strong>Open Targets</strong>
            <Chip tono={sinComprobar(h.novedad.openTargets) ? 'borde' : h.novedad.openTargets.estado === 'sin_evidencia' ? 'ok' : 'aviso'}>{sinComprobar(h.novedad.openTargets) ? 'No comprobado' : h.novedad.openTargets.estado === 'sin_evidencia' ? 'Sin evidencia previa' : 'Evidencia previa'}</Chip>
            <p>{h.novedad.openTargets.detalle}</p>
          </div>
          <div className="novedad-item">
            <strong>ClinicalTrials.gov</strong>
            <Chip tono={sinComprobar(h.novedad.ensayos) ? 'borde' : h.novedad.ensayos.estado === 'sin_ensayo' ? 'ok' : 'aviso'}>{sinComprobar(h.novedad.ensayos) ? 'No comprobado' : h.novedad.ensayos.estado === 'sin_ensayo' ? 'Sin ensayo' : 'Ya hay ensayo'}</Chip>
            <p>
              {h.novedad.ensayos.detalle}
              {h.novedad.ensayos.nct && (
                <>
                  {' '}
                  <a className="enlace" href={`https://clinicaltrials.gov/study/${h.novedad.ensayos.nct}`} target="_blank" rel="noopener noreferrer">
                    {h.novedad.ensayos.nct}
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="novedad-item">
            <strong>Agora</strong>
            <Chip tono={h.novedad.agora.estado === 'no_nominada' ? 'ok' : 'aviso'}>{h.novedad.agora.estado === 'no_nominada' ? 'No nominada' : 'Diana nominada'}</Chip>
            <p>{h.novedad.agora.detalle}</p>
          </div>
          {h.novedad.genetica && (
            <div className="novedad-item">
              <strong>Genética humana (GWAS Catalog, ClinVar)</strong>
              <Chip tono={h.novedad.genetica.estado === 'sin_vinculo' ? 'ok' : h.novedad.genetica.estado === 'vinculo_conocido' ? 'aviso' : 'borde'}>{h.novedad.genetica.estado === 'sin_vinculo' ? 'Sin vínculo genético' : h.novedad.genetica.estado === 'vinculo_conocido' ? 'Vínculo conocido' : 'No comprobado'}</Chip>
              <p>{h.novedad.genetica.detalle}</p>
            </div>
          )}
          {h.novedad.farmacos && (
            <div className="novedad-item">
              <strong>Fármacos (ChEMBL, DGIdb)</strong>
              <Chip tono={h.novedad.farmacos.estado === 'farmacos_existentes' ? 'aviso' : h.novedad.farmacos.estado === 'sin_farmacos' ? 'ok' : 'borde'}>{h.novedad.farmacos.estado === 'farmacos_existentes' ? 'Diana abordable' : h.novedad.farmacos.estado === 'sin_farmacos' ? 'Sin fármacos' : 'No comprobado'}</Chip>
              <p>{h.novedad.farmacos.detalle}</p>
            </div>
          )}
          {h.novedad.datosPublicos && (
            <div className="novedad-item">
              <strong>Datos públicos (GEO, CELLxGENE)</strong>
              <Chip tono={h.novedad.datosPublicos.estado === 'hay_datos' ? 'ok' : h.novedad.datosPublicos.estado === 'sin_datos' ? 'aviso' : 'borde'}>{h.novedad.datosPublicos.estado === 'hay_datos' ? 'Hay datos' : h.novedad.datosPublicos.estado === 'sin_datos' ? 'Sin datos públicos' : 'No comprobado'}</Chip>
              <p>{h.novedad.datosPublicos.detalle}</p>
              {h.novedad.datosPublicos.series.length > 0 && (
                <ul className="lista-limpia">
                  {h.novedad.datosPublicos.series.map((s) => (
                    <li key={s.accession} className="meta">
                      <a className="enlace" href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.accession}`} target="_blank" rel="noopener noreferrer">
                        {s.accession}
                      </a>{' '}
                      {s.titulo} {s.n ? `(${s.n} muestras${s.plataforma ? `, ${s.plataforma}` : ''})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {h.novedad.patentes && (
            <div className="novedad-item">
              <strong>Patentes (vía Exa)</strong>
              <Chip tono={h.novedad.patentes.estado === 'sin_patente' ? 'ok' : h.novedad.patentes.estado === 'parcial' ? 'aviso' : h.novedad.patentes.estado === 'patente_relacionada' ? 'mal' : 'borde'}>
                {h.novedad.patentes.estado === 'sin_patente' ? 'Sin patente cercana' : h.novedad.patentes.estado === 'parcial' ? 'Relación parcial' : h.novedad.patentes.estado === 'patente_relacionada' ? 'Ya patentado o muy cercano' : 'No comprobado'}
              </Chip>
              <p>
                {h.novedad.patentes.detalle}
                {h.novedad.patentes.url && (
                  <>
                    {' '}
                    <a className="enlace" href={h.novedad.patentes.url} target="_blank" rel="noopener noreferrer">
                      ver
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
          {h.novedad.financiacion && (
            <div className="novedad-item">
              <strong>Proyectos financiados (vía Exa)</strong>
              <Chip tono={h.novedad.financiacion.estado === 'sin_proyecto' ? 'ok' : h.novedad.financiacion.estado === 'parcial' ? 'aviso' : h.novedad.financiacion.estado === 'proyecto_financiado' ? 'mal' : 'borde'}>
                {h.novedad.financiacion.estado === 'sin_proyecto' ? 'Sin proyecto cercano' : h.novedad.financiacion.estado === 'parcial' ? 'Relación parcial' : h.novedad.financiacion.estado === 'proyecto_financiado' ? 'Ya financiado' : 'No comprobado'}
              </Chip>
              <p>
                {h.novedad.financiacion.detalle}
                {h.novedad.financiacion.url && (
                  <>
                    {' '}
                    <a className="enlace" href={h.novedad.financiacion.url} target="_blank" rel="noopener noreferrer">
                      ver
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
          <div className="novedad-item">
            <strong>Precedente en la literatura</strong>
            <Chip tono={sinComprobar(h.novedad.precedente) ? 'borde' : h.novedad.precedente.estado === 'sin_precedente' ? 'ok' : h.novedad.precedente.estado === 'parcial' ? 'aviso' : 'mal'}>
              {sinComprobar(h.novedad.precedente) ? 'No comprobado' : h.novedad.precedente.estado === 'sin_precedente' ? 'Sin precedente' : h.novedad.precedente.estado === 'parcial' ? 'Precedente parcial' : 'Ya publicado'}
            </Chip>
            <p>{h.novedad.precedente.detalle}</p>
          </div>
        </div>
      </Seccion>

      {h.vigilancia && (
        <Seccion
          detalle
          titulo="Vigilancia de literatura"
          nota="Una búsqueda semántica al día (Exa) de lo publicado sobre esta hipótesis desde la última comprobación. Sin modelos: solo publicaciones con su enlace y el pasaje que más se parece al enunciado. Decidir si una novedad cambia algo te toca a ti."
          resumen={`${h.vigilancia.nuevas.length} novedad${h.vigilancia.nuevas.length === 1 ? '' : 'es'} en ${h.vigilancia.comprobaciones} comprobación${h.vigilancia.comprobaciones === 1 ? '' : 'es'}`}
        >
          <p className="meta">
            {h.vigilancia.ultimaComprobacion ? (
              <>
                Última comprobación <Momento t={h.vigilancia.ultimaComprobacion} ahora={ahora} />
              </>
            ) : (
              'Todavía sin comprobar'
            )}
            {' · '}
            {h.vigilancia.comprobaciones} comprobación{h.vigilancia.comprobaciones === 1 ? '' : 'es'} · {h.vigilancia.costeUsd.toFixed(3)} USD
          </p>
          {h.vigilancia.ultimoError && <p className="tono-aviso">{h.vigilancia.ultimoError}</p>}
          {h.vigilancia.nuevas.length === 0 ? (
            <p className="meta">Nada nuevo desde la creación de la hipótesis.</p>
          ) : (
            <ul className="lista-limpia">
              {h.vigilancia.nuevas.map((n) => (
                <li key={n.url ?? n.titulo} style={{ marginBottom: 10 }}>
                  <div>
                    {n.url ? (
                      <a className="enlace" href={n.url} target="_blank" rel="noopener noreferrer">
                        {n.titulo}
                      </a>
                    ) : (
                      <strong>{n.titulo}</strong>
                    )}{' '}
                    {n.preprint && <Chip tono="aviso">preprint</Chip>}
                  </div>
                  <p className="meta" style={{ margin: '2px 0' }}>
                    {n.referencia}
                    {n.fecha ? ` · ${n.fecha}` : ''}
                    {n.doi ? ` · ${n.doi}` : ''}
                    {n.similitud !== null ? ` · afinidad ${n.similitud.toFixed(2)}` : ''}
                    {n.terminos && n.terminos.length > 0 ? ` · nombra ${n.terminos.join(', ')}` : ''}
                  </p>
                  {n.pasaje && <p style={{ margin: 0, fontSize: 13 }}>{n.pasaje}</p>}
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      <Seccion titulo="Verificación" nota="Cada afirmación contrastada con su fuente, con su tipo (dato, literatura, interpretación). Lo bloqueante impide aceptar.">
        <Verificacion afirmaciones={h.afirmaciones} cobertura={cobertura} ocultarCitas={aCiegas} onVerTrayectoria={(_, celda) => onAbrirProcedencia('codigo', celda)} />
      </Seccion>

      <EjecucionesInSilico h={h} estado={estado} ahora={ahora} />

      {h.supuestos.length > 0 && (
        <Seccion detalle titulo="Supuestos" nota="La hipótesis descompuesta en lo que da por cierto, independiente de las citas (la verificación profunda de Co-Scientist).">
          <ArbolSupuestos supuestos={h.supuestos} />
        </Seccion>
      )}

      <Seccion detalle titulo="Revisiones del agente" nota="Seis tipos de revisión, separados, para saber qué se hizo y qué falta.">
        <ul className="revisiones-auto">
          {h.revisionesAutomaticas.map((r) => (
            <li key={r.tipo} className={`revision-auto revision-${r.estado}`}>
              <div className="acciones" style={{ gap: 8 }}>
                <Chip tono={r.estado === 'pendiente' ? 'borde' : r.estado === 'rehecha' ? 'acento' : 'ok'}>{r.estado === 'pendiente' ? 'Pendiente' : r.estado === 'rehecha' ? 'Rehecha' : 'Hecha'}</Chip>
                <strong style={{ fontSize: 13 }} title={TIPO_REVISION[r.tipo].nota}>
                  {TIPO_REVISION[r.tipo].etiqueta}
                </strong>
                {r.fecha !== null && (
                  <span className="meta">
                    <Momento t={r.fecha} ahora={ahora} />
                  </span>
                )}
              </div>
              <p className="meta">{r.resumen || TIPO_REVISION[r.tipo].nota}</p>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion detalle titulo="Revisor" nota="ROSA2018 atiende cada hallazgo en su siguiente mensaje: corrige o explica por qué no aplica. Un descarte que el Killer propuso y después retiró se enseña como atendido.">
        <Revisor hallazgos={vigentes} />
      </Seccion>

      {h.partidos.length > 0 && (
        <Seccion detalle titulo="Partidos del torneo" nota="Contra quién, quién ganó y por qué. Un Elo con pocos partidos dice poco.">
          <table className="tabla">
            <thead>
              <tr>
                <th>Iteración</th>
                <th>Rival</th>
                <th>Resultado</th>
                <th>Eje decisivo</th>
                <th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {h.partidos.map((p, i) => {
                const rival = estado.hipotesis.find((x) => x.id === p.rivalId);
                return (
                  <tr key={i}>
                    <td className="num">{p.iteracion}</td>
                    <td>{rival ? <a className="enlace" href={rutaDe(h.investigacionId, 'hipotesis', rival.id)}>{rival.titulo.length > 50 ? `${rival.titulo.slice(0, 47)}...` : rival.titulo}</a> : p.rivalId}</td>
                    <td>
                      <Chip tono={p.resultado === 'gano' ? 'ok' : p.resultado === 'tablas' ? 'borde' : 'mal'}>{p.resultado === 'gano' ? 'Ganó' : p.resultado === 'tablas' ? 'Tablas' : 'Perdió'}</Chip>
                    </td>
                    <td>{p.ejeDecisivo}</td>
                    <td className="meta">{p.resumenDebate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Seccion>
      )}

      <Seccion
        detalle titulo="Replicación independiente"
        nota="Kosmos confirmó sus hallazgos clave con cinco trayectorias independientes. Gasta presupuesto de la iteración."
        acciones={
          <button type="button" className="btn btn-s" disabled={replicaEnVuelo || h.replicacion?.estado === 'en_curso' || !corrida || corrida.estado !== 'en_marcha'} {...atributosEnVuelo(replicaEnVuelo)} onClick={envolverReplica(() => acciones.replicarHipotesis(h.id, 5))}>
            Replicar x5
          </button>
        }
      >
        {h.replicacion ? (
          <div className="acciones">
            <Chip tono={h.replicacion.estado === 'en_curso' ? 'acento' : h.replicacion.contradicen === 0 ? 'ok' : 'aviso'}>
              {h.replicacion.hechas} de {h.replicacion.total} trayectorias · {h.replicacion.sostienen} sostienen · {h.replicacion.contradicen} contradicen
            </Chip>
            <span className="meta">
              Lanzada <Momento t={h.replicacion.empezadaEn} ahora={ahora} />
            </span>
          </div>
        ) : (
          <p className="meta">Sin replicar todavía.</p>
        )}
      </Seccion>

      {rivales.length > 0 && (
        <Seccion detalle titulo="Rivales" nota="Hipótesis que compiten por la misma pregunta.">
          <div className="rivales">
            {rivales.map((r) => (
              <a key={r.id} className="chip chip-borde" href={rutaDe(h.investigacionId, 'hipotesis', r.id)} title={r.titulo}>
                {r.titulo.length > 60 ? `${r.titulo.slice(0, 57)}...` : r.titulo} · {r.elo}
              </a>
            ))}
          </div>
        </Seccion>
      )}

      {h.experimento && (
        <Seccion titulo="Experimento propuesto" nota="El traspaso al laboratorio: protocolo, ensayo y criterios de éxito y refutación fijados de antemano. Al asignarlo a un laboratorio queda prerregistrado: la hipótesis y el protocolo se congelan con fecha en un artefacto, antes de que exista ningún dato. Los datos vuelven para que ROSA2018 actualice su conclusión.">
          <div className="tarjeta seccion">
            <div className="experimento-bloque">
              <h4>Protocolo</h4>
              <ol className="protocolo">
                {h.experimento.protocolo
                  .split('\n')
                  .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
                  .filter((l) => l !== '')
                  .map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
              </ol>
            </div>
            <div className="experimento-bloque">
              <h4>Ensayo</h4>
              <p>{h.experimento.ensayo}</p>
            </div>
            {(h.experimento.confirma || h.experimento.refuta) && (
              <div className="conclusion-columnas">
                <div className="experimento-bloque criterio-ok">
                  <h4>La confirmaría</h4>
                  <p>{h.experimento.confirma}</p>
                </div>
                <div className="experimento-bloque criterio-mal">
                  <h4>La refutaría</h4>
                  <p>{h.experimento.refuta}</p>
                </div>
              </div>
            )}
            <ContratoDelExperimento h={h} />
            {(h.experimento.controles || h.experimento.tamanoMuestral || h.experimento.alternativa) && (
              <div className="conclusion-columnas">
                {h.experimento.controles && (
                  <div className="experimento-bloque">
                    <h4>Controles</h4>
                    <p>{h.experimento.controles}</p>
                  </div>
                )}
                {h.experimento.tamanoMuestral && (
                  <div className="experimento-bloque">
                    <h4>Tamaño muestral</h4>
                    <p>{h.experimento.tamanoMuestral}</p>
                  </div>
                )}
                {h.experimento.alternativa && (
                  <div className="experimento-bloque">
                    <h4>Explicación alternativa y cómo se distingue</h4>
                    <p>{h.experimento.alternativa}</p>
                  </div>
                )}
              </div>
            )}
            {h.experimento.decisionQueCambia && (
              <div className="experimento-bloque">
                <h4>Qué decisión cambia con el resultado</h4>
                <p>{h.experimento.decisionQueCambia}</p>
              </div>
            )}
            <div className="experimento-bloque">
              <h4>Coste estimado</h4>
              <p>{h.experimento.costeEstimado}</p>
            </div>
            {h.experimento.analisisPedido && h.experimento.estado === 'propuesto' && (
              <div className="experimento-bloque">
                <h4>Con datos ya existentes</h4>
                <p>{h.experimento.analisisPedido}</p>
              </div>
            )}
            {h.experimento.resultado && (
              <div className={`experimento-bloque resultado resultado-${h.experimento.resultado.veredicto}`}>
                <h4>Resultado contra el prerregistro</h4>
                <div className="acciones">
                  <Chip tono={h.experimento.resultado.veredicto === 'confirma' ? 'ok' : h.experimento.resultado.veredicto === 'refuta' ? 'mal' : 'aviso'}>
                    {h.experimento.resultado.veredicto === 'confirma' ? 'Confirma la hipótesis' : h.experimento.resultado.veredicto === 'refuta' ? 'Refuta la hipótesis' : h.experimento.resultado.veredicto === 'inconcluso' ? 'Inconcluso' : 'No evaluable con estos datos'}
                  </Chip>
                  {h.experimento.resultado.clasificacion && (
                    <Chip tono={RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].tono} title={RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].nota}>
                      {RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].etiqueta}
                    </Chip>
                  )}
                  {h.experimento.resultado.versionProbada !== undefined && h.experimento.resultado.compatibleConActual === false && <Chip tono="aviso" title="El resultado probó una versión anterior de la hipótesis">Probó la v{h.experimento.resultado.versionProbada}</Chip>}
                  <span className="meta">
                    {h.experimento.resultado.fichero} · <Momento t={h.experimento.resultado.fecha} ahora={ahora} />
                  </span>
                </div>
                <Dimensiones d={h.experimento.resultado.dimensiones} />
                <p>{h.experimento.resultado.resultado}</p>
                {h.experimento.resultado.accionTomada && <p className="meta">Qué hizo ROSA2018: {h.experimento.resultado.accionTomada}</p>}
                {h.experimento.resultado.hipotesisDerivadaId && (
                  <p className="meta">
                    Hipótesis derivada:{' '}
                    <a className="enlace" href={rutaDe(h.investigacionId, 'hipotesis', h.experimento.resultado.hipotesisDerivadaId)}>
                      abrir
                    </a>
                  </p>
                )}
                <p className="meta">{h.experimento.resultado.motivo}</p>
                {h.experimento.resultado.cifras.length > 0 && (
                  <ul className="cifras">
                    {h.experimento.resultado.cifras.map((c, i) => (
                      <li key={i}>
                        <strong>{c.nombre}:</strong> {c.valor}
                      </li>
                    ))}
                  </ul>
                )}
                {h.experimento.resultado.limitaciones && <p className="meta">Limitaciones: {h.experimento.resultado.limitaciones}</p>}
                {h.experimento.resultado.exploratorio && <p className="meta">Exploratorio, fuera del prerregistro: {h.experimento.resultado.exploratorio}</p>}
              </div>
            )}
            <div className="acciones">
              <Chip tono={h.experimento.estado === 'datos_recibidos' ? 'ok' : h.experimento.estado === 'propuesto' ? 'borde' : 'aviso'}>
                {h.experimento.estado === 'propuesto' ? 'Propuesto' : h.experimento.estado === 'asignado' ? `Asignado a ${h.experimento.laboratorio}` : h.experimento.estado === 'en_curso' ? 'En curso' : `Datos recibidos: ${h.experimento.ficheroDatos}`}
              </Chip>
              {h.experimento.prerregistradoEn && h.experimento.prerregistroArtefactoId && (
                <a className="chip chip-ok" href={rutaDe(h.investigacionId, 'artefactos', h.experimento.prerregistroArtefactoId)} title="Hipótesis, protocolo y criterios congelados antes de los datos">
                  Prerregistrado <Momento t={h.experimento.prerregistradoEn} ahora={ahora} />
                </a>
              )}
              {h.experimento.prerregistradoEn && h.experimento.selloExterno?.ok && (
                <Chip tono="ok" title={`sha256 ${h.experimento.selloExterno.hash}. Hora firmada por ${h.experimento.selloExterno.testigos.join(' y ')}: ${h.experimento.selloExterno.primeraHora}. Se verifica sin ROSA2018 con openssl ts -verify sobre el token guardado.`}>
                  Sellado por {h.experimento.selloExterno.testigos.join(' y ')} ({h.experimento.selloExterno.primeraHora?.slice(0, 16).replace('T', ' ')} UTC)
                </Chip>
              )}
              {h.experimento.prerregistradoEn && !h.experimento.selloExterno?.ok && (
                <button type="button" className="btn btn-s" title={h.experimento.selloExterno?.error ? `Último intento: ${h.experimento.selloExterno.error}` : 'Pide a dos autoridades de sellado de tiempo (RFC 3161) que firmen la hora del prerregistro: un tercero atestigua que se congeló antes de los datos'} disabled={selloEnVuelo} {...atributosEnVuelo(selloEnVuelo)} onClick={envolverSello(() => acciones.sellarPrerregistro(h.id))}>
                  {h.experimento.selloExterno ? 'Reintentar el sello externo' : 'Sellar con un tercero'}
                </button>
              )}
            </div>
            {h.experimento.estado === 'propuesto' && (
              <div className="dirigir">
                <input className="entrada" value={lab} placeholder="Laboratorio (por ejemplo FLENI, Buenos Aires)" onChange={(e) => setLab(e.target.value)} aria-label="Laboratorio" />
                <button type="button" className="btn" disabled={lab.trim() === '' || laboratorioEnVuelo} {...atributosEnVuelo(laboratorioEnVuelo)} onClick={envolverLaboratorio(() => acciones.asignarExperimento(h.id, lab))}>
                  Asignar a laboratorio
                </button>
              </div>
            )}
            {(h.experimento.estado === 'asignado' || h.experimento.estado === 'datos_recibidos') && (
              <div className="seccion">
                <p className="meta">
                  Cuando lleguen los datos del laboratorio, súbelos aquí (CSV, TSV, JSON, texto o PDF, hasta 50 MB). ROSA2018 los resume sin ningún modelo, el juez los compara con los criterios congelados en el prerregistro y la conclusión se rehace con esa evidencia.
                </p>
                {h.experimento.datosSinteticos && h.experimento.ficheroDatos && (
                  <Chip tono="aviso" title="La persona declaró al subirlos que son datos sintéticos o de prueba (o el nombre del fichero lo dice). Sirven para probar la pantalla y el flujo; nunca cuentan como observación ni suben el techo GRADE, y no entran al modelo de mundo.">
                    Datos sintéticos o de prueba: no cuentan como evidencia
                  </Chip>
                )}
                <div className="campo">
                  <label htmlFor="exp-fichero">Fichero de datos</label>
                  <input id="exp-fichero" type="file" accept=".csv,.tsv,.txt,.json,.pdf,.md" onChange={(e) => setFicheroDatos(e.target.files?.[0] ?? null)} />
                </div>
                <div className="campo">
                  <label htmlFor="exp-analisis">Qué análisis quieres (además de los criterios prerregistrados)</label>
                  <input id="exp-analisis" className="entrada" value={analisis} placeholder="Tiempo hasta la primera alteración, por grupo genético" onChange={(e) => setAnalisis(e.target.value)} />
                </div>
                <label className="interruptor" title="Márcala si el fichero es inventado, simulado o de prueba. ROSA2018 lo etiqueta como sintético: se evalúa contra el prerregistro para probar el flujo, pero nunca cuenta como observación real, no sube el techo GRADE ni entra al modelo de mundo. Si el nombre del fichero dice «sintético», se marca solo.">
                  <input type="checkbox" checked={datosSinteticos} onChange={(e) => setDatosSinteticos(e.target.checked)} />
                  Estos datos son sintéticos o de prueba (nunca cuentan como evidencia)
                </label>
                <div className="acciones">
                  <button
                    type="button"
                    className="btn btn-primario"
                    disabled={ficheroDatos === null || subiendo}
                    {...atributosEnVuelo(subiendo)}
                    onClick={async () => {
                      if (!ficheroDatos) return;
                      setSubiendo(true);
                      const error = await acciones.subirDatosExperimento(h.id, ficheroDatos, analisis, datosSinteticos);
                      setSubiendo(false);
                      setErrorSubida(error);
                      if (!error) {
                        setFicheroDatos(null);
                        setDatosSinteticos(false);
                      }
                    }}
                  >
                    {subiendo ? 'Subiendo...' : 'Subir datos y evaluar contra el prerregistro'}
                  </button>
                  {errorSubida && <span className="tono-mal">{errorSubida}</span>}
                  {h.experimento.estado === 'datos_recibidos' && !h.experimento.resultado && <span className="meta">Datos recibidos; ROSA2018 los está evaluando.</span>}
                </div>
              </div>
            )}
            <ProtocoloYEnmiendas h={h} ahora={ahora} />
          </div>
        </Seccion>
      )}

      <Seccion detalle titulo="Historial">
        <ul className="lista-limpia">
          {h.revisiones.map((r, i) => (
            <li key={i}>
              <span>
                <strong style={{ fontWeight: 550 }}>{r.quien}</strong> · {r.accion.replace(/_/g, ' ')}
                {r.aCiegas && <Chip tono="borde">a ciegas</Chip>}
                {r.nota !== '' && <span className="meta"> · {r.nota}</span>}
              </span>
              <span className="meta">
                <Momento t={r.fecha} ahora={ahora} />
              </span>
            </li>
          ))}
        </ul>
        {h.revisionesHumanas.length > 0 && (
          <div className="seccion">
            <p className="campo-etiqueta">Revisiones escritas por personas (entran al siguiente debate del torneo)</p>
            {h.revisionesHumanas.map((r, i) => (
              <div key={i} className="mensaje mensaje-investigadora">
                <header>
                  <span>{r.quien}</span>
                  <span>
                    <Momento t={r.fecha} ahora={ahora} />
                  </span>
                </header>
                {r.supuestosCuestionados && <p>Supuestos cuestionados: {r.supuestosCuestionados}</p>}
                {r.literaturaQueFalta && <p>Literatura que falta: {r.literaturaQueFalta}</p>}
                {r.problemaExperimental && <p>Problema experimental: {r.problemaExperimental}</p>}
              </div>
            ))}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Decisión" nota={cerrada ? 'Esta hipótesis ya se decidió. Se puede reabrir.' : aclarando ? 'ROSA2018 está aclarando lo que marcaste. Volverá a la cola.' : motivo ?? 'Nada impide aceptarla. Tu lectura decide.'}>
        <div className="campo">
          <label htmlFor="nota-decision">Nota para ROSA2018 y para el historial</label>
          <textarea id="nota-decision" value={nota} rows={2} onChange={(e) => setNota(e.target.value)} placeholder="Comprobable en FLENI; pedir al investigador clínico principal si la cohorte tiene genotipo de TREM2" />
        </div>
        <button type="button" className="enlace" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setRevisionAbierta((v) => !v)}>
          {revisionAbierta ? 'Ocultar la revisión estructurada' : 'Escribir una revisión estructurada (entra al torneo como revisión, no solo como veredicto)'}
        </button>
        {revisionAbierta && (
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor="rev-sup">Supuestos que cuestionas</label>
              <textarea id="rev-sup" rows={3} value={rev.supuestosCuestionados} onChange={(e) => setRev({ ...rev, supuestosCuestionados: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rev-lit">Literatura que falta</label>
              <textarea id="rev-lit" rows={3} value={rev.literaturaQueFalta} onChange={(e) => setRev({ ...rev, literaturaQueFalta: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rev-exp">Problema experimental</label>
              <textarea id="rev-exp" rows={3} value={rev.problemaExperimental} onChange={(e) => setRev({ ...rev, problemaExperimental: e.target.value })} />
            </div>
          </div>
        )}
        <div className="acciones">
          {!cerrada && !aclarando && (
            <>
              <button type="button" className="btn btn-primario" disabled={motivo !== null || decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} title={motivo ?? 'Aceptar y pasarla al modelo de mundo como hipótesis a perseguir'} onClick={() => decidir('aceptar', nota)}>
                Aceptar
              </button>
              <button type="button" className="btn" disabled={decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} onClick={() => decidir('refinar', nota)}>
                Pedir que la refine
              </button>
              <Confirmar
                etiqueta="No puedo juzgar"
                disabled={decisionEnVuelo}
                pregunta="Di qué te impide juzgarla (ambigua, falta contexto, no reproducible). ROSA2018 la aclara y vuelve a la cola marcada como aclarada."
                pedirTexto={{ etiqueta: 'Qué falta', marcador: 'No queda claro si habla de PSEN1 o de todo el Alzheimer familiar' }}
                onConfirmar={(m) => decidir('no_puedo_juzgar', m)}
              />
              <Confirmar
                etiqueta="Descartar"
                peligro
                disabled={decisionEnVuelo}
                pregunta="El motivo queda en el modelo de mundo para que ROSA2018 no vuelva a proponer lo mismo."
                pedirTexto={{ etiqueta: 'Motivo', marcador: 'Se apoya en un artículo retractado' }}
                onConfirmar={(m) => decidir('descartar', m)}
              />
            </>
          )}
          {cerrada && (
            <button type="button" className="btn" disabled={decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} onClick={() => decidir('reabrir', nota)}>
              Reabrir
            </button>
          )}
        </div>
      </Seccion>

      <Seccion
        titulo="Dossier para el laboratorio"
        nota="El expediente con el que la hipótesis sale al laboratorio, en siete partes: si va o no y por qué (bloqueos), la hipótesis completa con su versión, la evidencia con procedencia, los análisis con datos, las decisiones, el protocolo prerregistrado y qué se aprende con cada resultado. Se arma sin ningún modelo, con lo que hay en el estado."
        acciones={
          <button type="button" className="btn btn-s" disabled={estado.conexion === 'muestra' || dossierOcupado} {...atributosEnVuelo(dossierOcupado)} onClick={() => void pedirDossier()}>
            {h.dossierArtefactoId ? 'Regenerar dossier' : 'Generar dossier'}
          </button>
        }
      >
        {esperaDossier.esperando && <p className="meta">Esperando al servidor: el dossier aparecerá en Artefactos y aquí saldrá su enlace.</p>}
        {esperaDossier.agotada && (
          <p className="meta tono-aviso" role="status">
            Sin respuesta del servidor en un minuto. Si el dossier no aparece en Artefactos, vuelve a pedirlo.
          </p>
        )}
        {h.dossierArtefactoId ? (
          <p className="meta">
            Último dossier:{' '}
            <a className="enlace" href={rutaDe(h.investigacionId, 'artefactos', h.dossierArtefactoId)}>
              abrir en Artefactos
            </a>
            . Cada generación es una versión nueva; las anteriores se conservan.
          </p>
        ) : (
          <p className="meta">Sin dossier todavía.</p>
        )}
      </Seccion>

      <Seccion detalle titulo="Exportar expediente" nota="Todo lo que hace falta para auditar la hipótesis fuera de ROSA2018: versiones, decisiones con fecha, trazas, cuadernos, fuentes.">
        <div className="dirigir">
          <input className="entrada" value={aplicableA} placeholder="Aplicable a (cohorte, modelo, condición): por ejemplo portadores de APOE4 con genotipo de TREM2" onChange={(e) => setAplicableA(e.target.value)} aria-label="Aplicable a" />
          <a className="btn" href={`/api/hipotesis/${encodeURIComponent(h.id)}/rocrate`} download={`rosa-${h.id}.crate.zip`} title="RO-Crate 1.2 (perfil Process Run Crate) con procedencia W3C PROV: la hipótesis, el dossier, las decisiones, las fuentes con su riesgo de sesgo, el código y resultado de cada análisis, el prerregistro y sus sellos RFC 3161. Se verifica con herramientas de terceros, sin ROSA2018.">
            Exportar RO-Crate (PROV)
          </a>
          <button type="button" className="btn" onClick={() => descargar(`${h.id}-expediente.json`, expediente(h, estado.hechos, aplicableA.trim() || 'sin limite declarado'), 'application/json')}>
            Descargar expediente
          </button>
        </div>
      </Seccion>

      <BandejaComentarios pendientes={pendientes} onQuitar={(id) => acciones.quitarComentario(id)} onEditar={(id, n) => acciones.editarComentario(id, n)} onEnviar={(m) => acciones.enviarComentarios(h.id, m)} />
    </div>
  );
}

/** Una comprobación de novedad que todavía no se hizo: el estado por defecto de la
 *  plantilla parece una ausencia ('sin evidencia', 'sin ensayo', 'sin precedente') pero su
 *  detalle dice que no se comprobó. ROSA2018 no afirma ausencia sin haber mirado. */
function sinComprobar(x: { estado: string; detalle: string }): boolean {
  return x.estado === 'no_comprobado' || x.detalle.startsWith('No comprobado');
}

/** Los textos de la cabecera de la cola por filtro, compartidos por la
 *  pantalla y su silueta para que midan lo mismo. */
const CABECERA_COLA = {
  cola: {
    titulo: 'Cola de hipótesis',
    descripcion: 'Lo que ROSA2018 propone y espera tu lectura. Arriba lo pendiente, ordenado por Elo. Nada entra al modelo de mundo sin pasar por aquí.',
  },
  laboratorio: {
    titulo: 'Laboratorio',
    descripcion: 'El tramo final: hipótesis con experimento asignado (prerregistrado y sellado), en curso o con datos recibidos, y las candidatas que esperan un laboratorio. Cuando vuelven los datos, ROSA2018 los juzga contra el prerregistro.',
  },
};
/** Medido en Chromium a 1440 px: cada fila de la cola mide 84 px (título de
 *  una línea) o 109 (de dos). */
const ALTO_FILA_COLA = 96;
const MAX_FILAS_SILUETA = 40;

/** La silueta de la cola: la cabecera con su texto real (la real mide 75 px
 *  con su margen de 16), los segmentos y el botón en gris y tantas tarjetas
 *  como hipótesis va a enseñar el filtro, que el estado ya sabe sin ordenar. */
export function EsqueletoCola({ filtro, filas }: { filtro: 'pendientes' | 'todas' | 'laboratorio'; filas: number }) {
  const cabecera = filtro === 'laboratorio' ? CABECERA_COLA.laboratorio : CABECERA_COLA.cola;
  return (
    <EsqueletoPantalla
      variante="lista"
      rotulo="la cola de hipótesis"
      margenSuperior={16}
      cabecera={cabecera}
      acciones={
        <div className="acciones esqueleto-acciones" aria-hidden="true">
          <Esqueleto className="esqueleto-segmentos" ancho={236} />
          <Esqueleto className="esqueleto-boton" ancho={150} />
        </div>
      }
    >
      <EsqueletoTarjetas filas={Math.min(MAX_FILAS_SILUETA, Math.max(1, filas))} altoFila={ALTO_FILA_COLA} />
    </EsqueletoPantalla>
  );
}

export function Hipotesis({
  inv,
  estado,
  ahora,
  detalleId,
  cajonAbierto,
  setCajonAbierto,
  irA,
}: {
  inv: Investigacion;
  estado: EstadoRosa;
  ahora: number;
  detalleId: string | null;
  cajonAbierto: boolean;
  setCajonAbierto: (v: boolean) => void;
  irA: (hash: string) => void;
}) {
  // La cola, calculada después de pintar la silueta. Ordenar y pintar cada
  // fila con sus chips (bloqueos, verificación, hallazgos, Killer) congelaba
  // la pantalla un instante al cambiar de investigación; ahora el primer
  // frame es la silueta y el trabajo va detrás. Se guarda con qué
  // investigación y con qué estado se calculó: si la investigación ya no es
  // esa, lo que hay es de otra y se vuelve a la silueta; si solo cambió el
  // estado (un empuje del canal en vivo), se sigue enseñando la cola
  // anterior hasta que llega la nueva, sin parpadeo.
  const { valor: colaCalculada } = useCalculoDiferido(() => ({ invId: inv.id, estado, propias: ordenarCola(estado.hipotesis.filter((h) => h.investigacionId === inv.id)) }), [estado, inv.id]);
  const cola = colaCalculada !== null && colaCalculada.invId === inv.id ? colaCalculada : null;
  const propias = cola?.propias ?? [];
  // "laboratorio" en el sitio del id es la vista del tramo final (la etapa
  // Laboratorio del hilo): lo asignado, en curso o con datos, y las candidatas
  // con experimento propuesto que esperan un laboratorio.
  const vistaLab = detalleId === 'laboratorio';
  const [filtro, setFiltro] = useState<'pendientes' | 'todas' | 'laboratorio'>(vistaLab ? 'laboratorio' : 'pendientes');
  useEffect(() => {
    if (vistaLab) setFiltro('laboratorio');
    else if (detalleId === null) setFiltro((f) => (f === 'laboratorio' ? 'pendientes' : f));
  }, [vistaLab, detalleId]);
  const [proponiendo, setProponiendo] = useState(false);
  const [pestana, setPestana] = useState<PestanaProcedencia>('fuentes');
  const [celda, setCelda] = useState<number | null>(null);
  const seleccionada = vistaLab ? null : estado.hipotesis.find((h) => h.id === detalleId && h.investigacionId === inv.id) ?? null;
  // La ficha también abre con un frame de silueta: pinta decenas de secciones
  // y abrirla congelaba la cola un instante. Se guarda qué hipótesis se
  // preparó para no enseñar la silueta al volver a la cola.
  const { valor: ficha } = useCalculoDiferido(() => ({ id: seleccionada?.id ?? null }), [seleccionada?.id ?? null]);
  const fichaLista = seleccionada !== null && ficha !== null && ficha.id === seleccionada.id;
  const enLaboratorio = (h: Hip) => Boolean(h.experimento && (h.experimento.estado !== 'propuesto' || h.candidata));
  const pendiente = (h: Hip) => h.estado === 'propuesta' || h.estado === 'en_revision' || h.estado === 'refinar' || h.estado === 'aclarando';
  const pasaFiltro = (h: Hip) => (filtro === 'todas' ? true : filtro === 'laboratorio' ? enLaboratorio(h) : pendiente(h));
  const visibles = propias.filter(pasaFiltro);
  // Cuántas filas va a tener la cola, sin ordenar nada: para que la silueta
  // pinte las mismas y el contenido no salte al llegar.
  const filasPrevistas = () => estado.hipotesis.filter((h) => h.investigacionId === inv.id && pasaFiltro(h)).length;

  // El estado global todavía no ha llegado: la silueta de lo que se va a
  // abrir, nunca una página vacía.
  if (estado.conexion === 'conectando') return seleccionada ? <EsqueletoPantalla variante="ficha" rotulo="la hipótesis" /> : <EsqueletoCola filtro={filtro} filas={filasPrevistas()} />;

  if (seleccionada) {
    if (!fichaLista) return <EsqueletoPantalla variante="ficha" rotulo="la hipótesis" />;
    return (
      <>
        <div className="contenido">
          <p style={{ marginBottom: 14 }}>
            <a className="enlace" href={rutaDe(inv.id, 'hipotesis')}>
              Volver a la cola
            </a>
          </p>
          <Detalle
            key={seleccionada.id}
            h={seleccionada}
            estado={estado}
            ahora={ahora}
            onAbrirProcedencia={(p, c) => {
              setPestana(p);
              setCelda(c ?? null);
              setCajonAbierto(true);
            }}
          />
        </div>
        {cajonAbierto && <Procedencia hipotesis={seleccionada} ahora={ahora} onCerrar={() => setCajonAbierto(false)} pestanaInicial={pestana} celdaDestacada={celda} />}
      </>
    );
  }

  if (cola === null) return <EsqueletoCola filtro={filtro} filas={filasPrevistas()} />;
  const cabecera = filtro === 'laboratorio' ? CABECERA_COLA.laboratorio : CABECERA_COLA.cola;

  return (
    <div className="contenido">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{cabecera.titulo}</h2>
          <p>{cabecera.descripcion}</p>
        </div>
        <div className="acciones">
          <div className="segmentos" role="group" aria-label="Filtro">
            <button type="button" aria-pressed={filtro === 'pendientes'} onClick={() => setFiltro('pendientes')}>
              Pendientes
            </button>
            <button type="button" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
              Todas
            </button>
            <button type="button" aria-pressed={filtro === 'laboratorio'} onClick={() => setFiltro('laboratorio')} title="Hipótesis con experimento asignado, en curso o con datos, y candidatas que esperan laboratorio">
              Laboratorio
            </button>
          </div>
          <button type="button" className="btn btn-primario" onClick={() => setProponiendo((v) => !v)}>
            Proponer hipótesis
          </button>
        </div>
      </div>
      {proponiendo && <FormularioHipotesis inv={inv} onCerrar={() => setProponiendo(false)} irA={irA} />}
      {visibles.length === 0 ? (
        filtro === 'laboratorio' ? (
          <Vacio titulo="Nada en el laboratorio todavía" pasos={['El Killer deja avanzar una hipótesis y el torneo la coloca entre las candidatas (etapa Candidatas del hilo, en Ranking).', 'ROSA2018 le propone un experimento: protocolo, ensayo, controles y criterios de éxito y refutación.', 'Tú lo asignas a un laboratorio desde la ficha: el prerregistro se congela y se sella con un tercero.', 'El laboratorio devuelve los datos y ROSA2018 los juzga contra lo prerregistrado.']}>
            Aquí aparecerán las hipótesis que lleguen a ese tramo.
          </Vacio>
        ) : (
        <Vacio titulo={filtro === 'pendientes' && propias.length > 0 ? 'Nada pendiente' : 'Todavía no hay hipótesis'} pasos={propias.length === 0 ? ['ROSA2018 busca literatura y verifica afirmaciones (etapas 2 y 3 del hilo).', 'Lo sostenido entra al modelo de mundo.', 'Con eso, ROSA2018 genera hipótesis y el Killer las juzga; las que quedan aparecen aquí, ordenadas por Elo.', 'Tú decides sobre cada una: aceptar, descartar o pedir que la refine.'] : undefined}>
          {propias.length > 0 ? 'ROSA2018 no tiene hipótesis esperando tu revisión en esta investigación. Con "Todas" ves las ya decididas.' : 'También puedes proponer una tú con el botón de arriba: pasa por el mismo Killer.'}
        </Vacio>
        )
      ) : (
        <ListaAnimada className="cola" como="div">
          {visibles.map((h) => (
            <ElementoAnimado key={h.id} salida={salidaDe(estado.hipotesis.find((x) => x.id === h.id) ?? h)}>
              <FilaCola h={h} ahora={ahora} href={rutaDe(inv.id, 'hipotesis', h.id)} horasEspera={estado.politicaEsperas.horas} estado={cola.estado} />
            </ElementoAnimado>
          ))}
        </ListaAnimada>
      )}
      {(inv.vivero?.length ?? 0) > 0 && (
        <Seccion
          detalle
          titulo={`Vivero de ideas (${inv.vivero!.length})`}
          nota="Propuestas de ROSA2018 que todavía no nacen como hipótesis: su evidencia viene de una sola cohorte y no da para certeza baja. En cada cierre de iteración ROSA2018 les suma lo que lee; cuando llegan a dos cohortes distintas, nacen y entran en la cola. Si pasan seis iteraciones sin ganar nada, salen con su motivo."
        >
          <div className="cola">
            {inv.vivero!.map((s) => (
              <div key={s.id} className="tarjeta hip-fila">
                <div>
                  <h3>{s.titulo}</h3>
                  <p className="meta">{s.enunciado}</p>
                  <div className="hip-meta">
                    <Chip tono="borde">Idea desde la iteración {s.iteracion}</Chip>
                    <Chip tono="borde">{s.afirmaciones.length} {s.afirmaciones.length === 1 ? 'afirmación' : 'afirmaciones'}</Chip>
                    <Chip tono="borde">{s.fuentes.length} {s.fuentes.length === 1 ? 'fuente' : 'fuentes'}</Chip>
                    <span className="meta">Actualizada <Momento t={s.actualizadaEn} ahora={ahora} /></span>
                  </div>
                  <p className="meta"><strong>Le falta para nacer:</strong> {s.falta}</p>
                </div>
              </div>
            ))}
          </div>
        </Seccion>
      )}
    </div>
  );
}
