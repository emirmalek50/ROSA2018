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

import { useRef, useState } from 'react';
import { acciones } from '../datos/almacen';
import type { EstadoRosa, Hipotesis as Hip, Investigacion, Supuesto } from '../datos/tipos';
import { BandejaComentarios, NuevoComentario, useSeleccionComentable } from '../componentes/Comentarios';
import { Procedencia, type PestanaProcedencia } from '../componentes/Procedencia';
import { Revisor } from '../componentes/Revisor';
import { Verificacion } from '../componentes/Verificacion';
import { ViabilidadDeLaPrueba } from '../componentes/EnLlano';
import { AlertaFicha, CifrasClave, ConclusionLegible, EnPocasPalabras, RielDeEstado, puestoPorElo, recuentoKiller, type PestanaFicha } from '../componentes/FichaHipotesis';
import { Chip, Confirmar, Momento, Seccion, Vacio, descargar } from '../componentes/piezas';
import { EsqueletoPantalla } from '../componentes/Esqueleto';
import { Bloqueos, ConsultasABases, ContextoDeBases, ContratoDelExperimento, DecisionesKiller, Dimensiones, EjecucionesInSilico, FusionYConflictos, GrafoCausalDeHipotesis, PerfilDeLaDiana, ProtocoloYEnmiendas, TarjetaDeHipotesis } from '../componentes/Rosa2018';
import { FranjaRanking } from '../componentes/FranjaRanking';
import { Alternativas } from '../componentes/Alternativas';
import { dependeDeRetractada, resumenEvidencia, tramosFuertes } from '../lib/calidad';
import { ACCION_REVISION_HIPOTESIS, ALCANCE_SUPUESTO, DONDE_SE_RESPONDE, ESTADO_HIPOTESIS, ESTADO_SUPUESTO, EVIDENCIA_ESTADISTICA, RELEVANCIA, TIPO_REVISION, RESULTADO_LABORATORIO, killerPendienteDe } from '../lib/etiquetas';
import { expediente } from '../lib/exportar';
import { TONO_ESTADO, hallazgosVigentes, motivoNoAceptable } from '../lib/hipotesis';
import { bloqueosDe } from '../lib/priorizacion';
import { componentesDe } from '../lib/ranking';
import { rutaDe } from '../lib/ruta';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo, useEsperaSenal } from '../lib/diferido';
import { ESPERA_DOSSIER_MS, huellaDossier } from './Artefactos';
import { tr, trp } from '../lib/idioma';



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
      <mark key={i} className="fuerte" title={tr("Afirma con más seguridad de la que suele dar la evidencia. Considera un verbo más prudente.")}>
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


/** Lo que el estado de un supuesto no dice solo (regla 3, 23 de septiembre de
 *  2026): si alguien miró donde estaría la respuesta, dónde se respondería, y
 *  el límite de un resultado nulo. Un "sin evidencia" que no toca el tema no
 *  informa de nada; uno que lo toca y no lo resuelve, sí. Los evaluados antes
 *  de la regla 3 no traen nada de esto y no se les inventa. */
function AlcanceDelSupuesto({ s }: { s: Supuesto }) {
  if (!s.alcance) return null;
  // Resuelto se ve ya en el estado; solo se añade la cota si la hay.
  const alcance = s.alcance === 'resuelto' ? null : ALCANCE_SUPUESTO[s.alcance];
  const donde = s.alcance !== 'resuelto' && s.dondeSeResponde ? DONDE_SE_RESPONDE[s.dondeSeResponde] : null;
  if (!alcance && !s.cota) return null;
  return (
    <p className={`meta supuesto-alcance supuesto-alcance-${s.alcance}`}>
      {alcance}
      {donde && <>{trp(" · se respondería {donde}", { donde })}</>}
      {s.cota && <>{(alcance ? trp(" · Límite: {cota}", { cota: s.cota }) : trp("Límite: {cota}", { cota: s.cota }))}</>}
    </p>
  );
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
            <AlcanceDelSupuesto s={s} />
            {s.hijos.length > 0 && <ArbolSupuestos supuestos={s.hijos} nivel={nivel + 1} />}
          </li>
        );
      })}
    </ul>
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

  // La ficha rehecha (3 de octubre de 2026): cabecera con una sola alerta,
  // cuatro cifras clave y seis pestañas. Las pestañas inactivas siguen
  // montadas y solo se esconden: lo que escribes en una (el laboratorio, el
  // análisis pedido) no se pierde al cambiar de pestaña, y la selección para
  // comentar funciona en todas.
  const [pestanaFicha, setPestanaFicha] = useState<PestanaFicha>('resumen');
  const barraPestanas = useRef<HTMLDivElement>(null);
  const bloqueos = bloqueosDe(estado, h);
  const comp = componentesDe(estado, h);
  const killer = recuentoKiller(h, estado.decisiones);
  const puesto = puestoPorElo(estado, h);
  const nAfirmaciones = Array.isArray(h.afirmaciones) ? h.afirmaciones.length : 0;
  const nRevisiones = Array.isArray(h.revisiones) ? h.revisiones.length : 0;
  const pestanas: { id: PestanaFicha; etiqueta: string; n?: number }[] = [
    { id: 'resumen', etiqueta: tr('Resumen') },
    { id: 'evidencia', etiqueta: tr('Evidencia'), n: nAfirmaciones },
    { id: 'tarjeta', etiqueta: tr('Tarjeta') },
    { id: 'comprobaciones', etiqueta: tr('Comprobaciones'), n: killer?.total ?? 0 },
    { id: 'experimento', etiqueta: tr('Experimento') },
    { id: 'historial', etiqueta: tr('Historial'), n: nRevisiones },
  ];
  const ir = (p: PestanaFicha) => {
    setPestanaFicha(p);
    barraPestanas.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const irADecision = () => document.getElementById('decision-hip')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const panel = (id: PestanaFicha) => ({ role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `pestana-${id}`, hidden: pestanaFicha !== id, className: `ficha-panel ficha-panel-${id}` });
  const siguiente = (
    <>
      <h4 className="ficha-ceja">{tr("Siguiente paso")}</h4>
      <p className="ficha-siguiente-texto">{cerrada ? tr('Esta hipótesis ya se decidió. Se puede reabrir.') : aclarando ? tr('ROSA2018 está aclarando lo que marcaste. Volverá a la cola.') : (motivo ?? (bloqueos.length > 0 ? tr('Puedes aceptarla, pero mira antes el aviso de arriba: mientras siga, no puede salir al laboratorio.') : tr('Nada impide aceptarla. Tu lectura decide.')))}</p>
      <button type="button" className="ficha-boton ficha-boton-primario" onClick={irADecision}>
        {tr("Ir a la decisión")}
      </button>
      <button type="button" className="ficha-boton" disabled={revisionEnVuelo} {...atributosEnVuelo(revisionEnVuelo)} onClick={envolverRevision(() => acciones.solicitarRevision(h.id))}>
        {tr("Solicitar revisión ahora")}
      </button>
      <p className="meta">
        {tr("Última revisión automática:")} {h.ultimaRevisionAutomatica ? <Momento t={h.ultimaRevisionAutomatica} ahora={ahora} /> : tr('nunca')}{tr(". El silencio del revisor no es aprobación.")}
      </p>
    </>
  );

  return (
    <div className="detalle-hip ficha-cuerpo" ref={contenedor}>
      <header className="ficha-cabecera">
        <div className="ficha-meta">
          {puesto && <span className="ficha-pildora ficha-pildora-puesto">{trp("{n}.º por Elo de {de}", { n: puesto.puesto, de: puesto.de })}</span>}
          <Chip tono={TONO_ESTADO[h.estado]}>{ESTADO_HIPOTESIS[h.estado]}</Chip>
          {h.origen === 'humana' && <Chip tono="acento">{tr("Propuesta por una persona")}</Chip>}
          {h.derivadaDe && (
            <a className="chip chip-borde" href={rutaDe(h.investigacionId, 'hipotesis', h.derivadaDe)}>
              {tr("Derivada de otra hipótesis")}
            </a>
          )}
          {bloqueos.length === 0 && <Bloqueos bloqueos={[]} candidata={h.candidata} />}
          <span className="meta">
            {trp("Versión {v} · Iteración {iteracion}", { v: h.version ?? 1, iteracion: h.iteracion })} · {tr("Prerregistrada")} <Momento t={h.prerregistradaEn} ahora={ahora} />
          </span>
          {juicioPendiente && (
            <Chip tono="aviso" title={tr("La última pasada del Killer no fue un juicio: el modelo no respondió o su respuesta no se pudo leer. La decisión que se ve es la anterior; ROSA2018 repite la revisión en el siguiente paso o cuando la pidas con «Pedir revisión».")}>
              {juicioPendiente}
            </Chip>
          )}
          <button type="button" className="enlace ficha-procedencia" onClick={() => onAbrirProcedencia('fuentes')}>
            {tr("Ver procedencia")}
          </button>
        </div>
        <TextoConFuertes texto={h.titulo} campo="enunciado" como="h2" />
        <AlertaFicha h={h} bloqueos={bloqueos} retractadas={retractadas.map((f) => f.referencia)} onIr={ir} />
      </header>

      <CifrasClave h={h} c={comp} killer={killer} juicioPendiente={juicioPendiente} />

      <div className="ficha-pestanas" ref={barraPestanas}>
        <div className="ficha-pestanas-lista" role="tablist" aria-label={tr("Partes de la ficha")}>
          {pestanas.map((p) => (
            <button key={p.id} type="button" role="tab" id={`pestana-${p.id}`} aria-controls={`panel-${p.id}`} aria-selected={pestanaFicha === p.id} tabIndex={pestanaFicha === p.id ? 0 : -1} onClick={() => setPestanaFicha(p.id)}>
              {p.etiqueta}
              {p.n ? <span className="ficha-pestana-n">{p.n}</span> : null}
            </button>
          ))}
        </div>
        <label className="interruptor ficha-ciegas" title={tr("Oculta las citas y el código hasta que decidas, para que no te arrastren.")}>
          <input type="checkbox" checked={aCiegas} onChange={(e) => setACiegas(e.target.checked)} />
          {tr("Revisar a ciegas")}
        </label>
      </div>

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

      <div {...panel('resumen')}>
        <div className="ficha-lectura">
          <EnPocasPalabras texto={h.enLlano} />
          <ViabilidadDeLaPrueba v={h.viabilidad} />
          <ConclusionLegible h={h} ahora={ahora} nAfirmaciones={nAfirmaciones} onIr={ir} />
          <section className="ficha-bloque">
            <h3 className="ficha-h">{tr("Cómo se ordena en el ranking")}</h3>
            <p className="ficha-sub">{tr("Cada componente por separado, sin sumarlos en una nota: el orden lo decide la regla, no una media.")}</p>
            <FranjaRanking estado={estado} h={h} explicar />
          </section>
        </div>
        <RielDeEstado h={h} estado={estado} c={comp} killer={killer} siguiente={siguiente} onIr={ir} />
      </div>

      <div {...panel('evidencia')}>
          <Seccion titulo={tr("Verificación")} nota={tr("Cada afirmación contrastada con su fuente, con su tipo (dato, literatura, interpretación). Lo bloqueante impide aceptar.")}>
            <Verificacion afirmaciones={h.afirmaciones} cobertura={cobertura} ocultarCitas={aCiegas} onVerTrayectoria={(_, celda) => onAbrirProcedencia('codigo', celda)} />
          </Seccion>
          <Seccion titulo={tr("Relevancia frente a significancia")} nota={tr("Kosmos confunde lo estadísticamente significativo con lo científicamente valioso. Aquí son dos escalas: ROSA2018 justifica la relevancia para el objetivo y tú la votas.")}>
            <div className="rejilla-2">
              <div className="tarjeta">
                <p className="campo-etiqueta">{tr("Evidencia estadística")}</p>
                <Chip tono={h.evidenciaEstadistica === 'fuerte' ? 'ok' : h.evidenciaEstadistica === 'debil' ? 'mal' : h.evidenciaEstadistica === 'moderada' ? 'aviso' : 'borde'}>
                  {EVIDENCIA_ESTADISTICA[h.evidenciaEstadistica]}
                </Chip>
                <p className="meta" style={{ marginTop: 6 }}>
                  {resumenEvidencia(h.procedencia.fuentes)}
                </p>
              </div>
              <div className="tarjeta">
                <p className="campo-etiqueta">{tr("Relevancia para el objetivo")}</p>
                <p style={{ fontSize: 13, margin: tr('6px 0') }}>{h.relevancia.justificacion}</p>
                <div className="segmentos" role="group" aria-label={tr("Tu voto de relevancia")}>
                  {(['alta', 'media', 'baja'] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={h.relevancia.votoHumano === v} onClick={() => acciones.votarRelevancia(h.id, v)}>
                      {RELEVANCIA[v]}
                    </button>
                  ))}
                </div>
                {h.evidenciaEstadistica === 'fuerte' && h.relevancia.votoHumano === 'baja' && <p className="tono-aviso" style={{ fontSize: 12.5, marginTop: 6 }}>{tr("Significativa pero irrelevante: un agujero de conejo. Cuenta en Calidad.")}</p>}
              </div>
            </div>
          </Seccion>
          <Seccion detalle titulo={tr("Novedad")} nota={tr("Consultas baratas antes de gastar una corrida: Open Targets, ClinicalTrials.gov, Agora, la genética humana (GWAS Catalog, ClinVar), los fármacos contra la diana (ChEMBL, DGIdb), los datos públicos para comprobarla (GEO, CELLxGENE) y si alguien ya lo propuso en la literatura. Con Exa, además, patentes y proyectos financiados anteriores a la hipótesis: una idea ya protegida o ya financiada no es nueva aunque no esté publicada.")}>
            <div className="novedad novedad-4">
              <div className="novedad-item">
                <strong>Open Targets</strong>
                <Chip tono={sinComprobar(h.novedad.openTargets) ? 'borde' : h.novedad.openTargets.estado === 'sin_evidencia' ? 'ok' : 'aviso'}>{sinComprobar(h.novedad.openTargets) ? 'No comprobado' : h.novedad.openTargets.estado === 'sin_evidencia' ? tr('Sin evidencia previa') : tr('Evidencia previa')}</Chip>
                <p>{h.novedad.openTargets.detalle}</p>
              </div>
              <div className="novedad-item">
                <strong>ClinicalTrials.gov</strong>
                <Chip tono={sinComprobar(h.novedad.ensayos) ? 'borde' : h.novedad.ensayos.estado === 'sin_ensayo' ? 'ok' : 'aviso'}>{sinComprobar(h.novedad.ensayos) ? 'No comprobado' : h.novedad.ensayos.estado === 'sin_ensayo' ? tr('Sin ensayo') : tr('Ya hay ensayo')}</Chip>
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
                <Chip tono={h.novedad.agora.estado === 'no_nominada' ? 'ok' : 'aviso'}>{(h.novedad.agora.estado === 'no_nominada' ? tr("No nominada") : tr("Diana nominada"))}</Chip>
                <p>{h.novedad.agora.detalle}</p>
              </div>
              {h.novedad.genetica && (
                <div className="novedad-item">
                  <strong>{tr("Genética humana (GWAS Catalog, ClinVar)")}</strong>
                  <Chip tono={h.novedad.genetica.estado === 'sin_vinculo' ? 'ok' : h.novedad.genetica.estado === 'vinculo_conocido' ? 'aviso' : 'borde'}>{h.novedad.genetica.estado === 'sin_vinculo' ? tr('Sin vínculo genético') : h.novedad.genetica.estado === 'vinculo_conocido' ? tr('Vínculo conocido') : 'No comprobado'}</Chip>
                  <p>{h.novedad.genetica.detalle}</p>
                </div>
              )}
              {h.novedad.farmacos && (
                <div className="novedad-item">
                  <strong>{tr("Fármacos (ChEMBL, DGIdb)")}</strong>
                  <Chip tono={h.novedad.farmacos.estado === 'farmacos_existentes' ? 'aviso' : h.novedad.farmacos.estado === 'sin_farmacos' ? 'ok' : 'borde'}>{h.novedad.farmacos.estado === 'farmacos_existentes' ? tr('Diana abordable') : h.novedad.farmacos.estado === 'sin_farmacos' ? tr('Sin fármacos') : 'No comprobado'}</Chip>
                  <p>{h.novedad.farmacos.detalle}</p>
                </div>
              )}
              {h.novedad.datosPublicos && (
                <div className="novedad-item">
                  <strong>{tr("Datos públicos (GEO, CELLxGENE)")}</strong>
                  <Chip tono={h.novedad.datosPublicos.estado === 'hay_datos' ? 'ok' : h.novedad.datosPublicos.estado === 'sin_datos' ? 'aviso' : 'borde'}>{h.novedad.datosPublicos.estado === 'hay_datos' ? tr('Hay datos') : h.novedad.datosPublicos.estado === 'sin_datos' ? tr('Sin datos públicos') : 'No comprobado'}</Chip>
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
                  <strong>{tr("Patentes (vía Exa)")}</strong>
                  <Chip tono={h.novedad.patentes.estado === 'sin_patente' ? 'ok' : h.novedad.patentes.estado === 'parcial' ? 'aviso' : h.novedad.patentes.estado === 'patente_relacionada' ? 'mal' : 'borde'}>
                    {h.novedad.patentes.estado === 'sin_patente' ? tr('Sin patente cercana') : h.novedad.patentes.estado === 'parcial' ? tr('Relación parcial') : h.novedad.patentes.estado === 'patente_relacionada' ? tr('Ya patentado o muy cercano') : 'No comprobado'}
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
                  <strong>{tr("Proyectos financiados (vía Exa)")}</strong>
                  <Chip tono={h.novedad.financiacion.estado === 'sin_proyecto' ? 'ok' : h.novedad.financiacion.estado === 'parcial' ? 'aviso' : h.novedad.financiacion.estado === 'proyecto_financiado' ? 'mal' : 'borde'}>
                    {h.novedad.financiacion.estado === 'sin_proyecto' ? tr('Sin proyecto cercano') : h.novedad.financiacion.estado === 'parcial' ? tr('Relación parcial') : h.novedad.financiacion.estado === 'proyecto_financiado' ? tr('Ya financiado') : 'No comprobado'}
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
                <strong>{tr("Precedente en la literatura")}</strong>
                <Chip tono={sinComprobar(h.novedad.precedente) ? 'borde' : h.novedad.precedente.estado === 'sin_precedente' ? 'ok' : h.novedad.precedente.estado === 'parcial' ? 'aviso' : 'mal'}>
                  {sinComprobar(h.novedad.precedente) ? 'No comprobado' : h.novedad.precedente.estado === 'sin_precedente' ? tr('Sin precedente') : h.novedad.precedente.estado === 'parcial' ? tr('Precedente parcial') : tr('Ya publicado')}
                </Chip>
                <p>{h.novedad.precedente.detalle}</p>
              </div>
            </div>
          </Seccion>
          {h.vigilancia && (
            <Seccion
              detalle
              titulo={tr("Vigilancia de literatura")}
              nota={tr("Una búsqueda semántica al día (Exa) de lo publicado sobre esta hipótesis desde la última comprobación. Sin modelos: solo publicaciones con su enlace y el pasaje que más se parece al enunciado. Decidir si una novedad cambia algo te toca a ti.")}
              resumen={(h.vigilancia.nuevas.length === 1 ? trp("{nuevas} novedad en {comprobaciones} comprobación{v}", { nuevas: h.vigilancia.nuevas.length, comprobaciones: h.vigilancia.comprobaciones, v: h.vigilancia.comprobaciones === 1 ? "" : tr("es") }) : trp("{nuevas} novedades en {comprobaciones} comprobación{v}", { nuevas: h.vigilancia.nuevas.length, comprobaciones: h.vigilancia.comprobaciones, v: h.vigilancia.comprobaciones === 1 ? "" : tr("es") }))}
            >
              <p className="meta">
                {h.vigilancia.ultimaComprobacion ? (
                  <>
                    {tr("Última comprobación")} <Momento t={h.vigilancia.ultimaComprobacion} ahora={ahora} />
                  </>
                ) : (
                  tr('Todavía sin comprobar')
                )}
                {' · '}
                {h.vigilancia.comprobaciones} {tr("comprobación")}{h.vigilancia.comprobaciones === 1 ? '' : 'es'} · {h.vigilancia.costeUsd.toFixed(3)} USD
              </p>
              {h.vigilancia.ultimoError && <p className="tono-aviso">{h.vigilancia.ultimoError}</p>}
              {h.vigilancia.nuevas.length === 0 ? (
                <p className="meta">{tr("Nada nuevo desde la creación de la hipótesis.")}</p>
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
                        {n.preprint && <Chip tono="aviso">{tr("preprint")}</Chip>}
                      </div>
                      <p className="meta" style={{ margin: tr('2px 0') }}>
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
          <EjecucionesInSilico h={h} estado={estado} ahora={ahora} />
          <Seccion
            detalle titulo={tr("Replicación independiente")}
            nota={tr("Kosmos confirmó sus hallazgos clave con cinco trayectorias independientes. Gasta presupuesto de la iteración.")}
            acciones={
              <button type="button" className="btn btn-s" disabled={replicaEnVuelo || h.replicacion?.estado === 'en_curso' || !corrida || corrida.estado !== 'en_marcha'} {...atributosEnVuelo(replicaEnVuelo)} onClick={envolverReplica(() => acciones.replicarHipotesis(h.id, 5))}>
                {tr("Replicar x5")}
              </button>
            }
          >
            {h.replicacion ? (
              <div className="acciones">
                <Chip tono={h.replicacion.estado === 'en_curso' ? 'acento' : h.replicacion.contradicen === 0 ? 'ok' : 'aviso'}>
                  {trp("{hechas} de {total} trayectorias · {sostienen} sostienen · {contradicen} contradicen", { hechas: h.replicacion.hechas, total: h.replicacion.total, sostienen: h.replicacion.sostienen, contradicen: h.replicacion.contradicen })}</Chip>
                <span className="meta">
                  {tr("Lanzada")} <Momento t={h.replicacion.empezadaEn} ahora={ahora} />
                </span>
              </div>
            ) : (
              <p className="meta">{tr("Sin replicar todavía.")}</p>
            )}
          </Seccion>
      </div>

      <div {...panel('tarjeta')}>
        <p className="meta">{tr("Selecciona un tramo del texto para comentarlo. Los comentarios se agrupan y salen juntos a ROSA2018. Los verbos en ámbar afirman más de lo que la evidencia suele dar.")}</p>
          <Seccion titulo={tr("Enunciado")}>
            <TextoConFuertes texto={h.enunciado} campo="enunciado" />
          </Seccion>

          <Seccion titulo={tr("Mecanismo propuesto")}>
            <TextoConFuertes texto={h.mecanismo} campo="mecanismo" />
          </Seccion>

          <Seccion titulo={tr("Explicaciones alternativas")} nota={tr("Lo que también explicaría lo observado sin que la hipótesis sea cierta (causa inversa, un confusor, cómo se eligió la muestra, un artefacto de la medida), y qué observación separaría cada alternativa de la hipótesis. ROSA2018 las escribe al cerrar cada iteración; una alternativa sin forma de distinguirla no sirve para diseñar un experimento.")}>
            <Alternativas h={h} />
          </Seccion>

          <Seccion titulo={tr("Cómo se comprobaría")} nota={tr("Siempre con biomarcador, cohorte y diseño: es lo que el investigador clínico principal necesita para juzgarla.")}>
            <dl className="comprobacion texto-comentable" data-campo="comprobacion">
              <dt>{tr("Biomarcador")}</dt>
              <dd>{h.comprobacion.biomarcador}</dd>
              <dt>{tr("Cohorte")}</dt>
              <dd>{h.comprobacion.cohorte}</dd>
              <dt>{tr("Diseño")}</dt>
              <dd>{h.comprobacion.diseno}</dd>
            </dl>
          </Seccion>
          <TarjetaDeHipotesis h={h} />
            <ContextoDeBases h={h} />
            <PerfilDeLaDiana h={h} />
            <GrafoCausalDeHipotesis h={h} />
            <ConsultasABases h={h} ahora={ahora} />
          <FusionYConflictos h={h} estado={estado} />
          {rivales.length > 0 && (
            <Seccion detalle titulo={tr("Rivales")} nota={tr("Hipótesis que compiten por la misma pregunta.")}>
              <div className="rivales">
                {rivales.map((r) => (
                  <a key={r.id} className="chip chip-borde" href={rutaDe(h.investigacionId, 'hipotesis', r.id)} title={r.titulo}>
                    {r.titulo.length > 60 ? `${r.titulo.slice(0, 57)}...` : r.titulo} · {r.elo}
                  </a>
                ))}
              </div>
            </Seccion>
          )}
      </div>

      <div {...panel('comprobaciones')}>
          <DecisionesKiller h={h} decisiones={estado.decisiones ?? []} ahora={ahora} conjuntoDorado={estado.conjuntoDorado ?? []} />
          <Seccion detalle titulo={tr("Revisor")} nota={tr("ROSA2018 atiende cada hallazgo en su siguiente mensaje: corrige o explica por qué no aplica. Un descarte que el Killer propuso y después retiró se enseña como atendido.")}>
            <Revisor hallazgos={vigentes} />
          </Seccion>
          {h.supuestos.length > 0 && (
            <Seccion detalle titulo={tr("Supuestos")} nota={tr("La hipótesis descompuesta en lo que da por cierto, independiente de las citas (la verificación profunda de Co-Scientist).")}>
              <ArbolSupuestos supuestos={h.supuestos} />
            </Seccion>
          )}
          <Seccion detalle titulo={tr("Revisiones del agente")} nota={tr("Seis tipos de revisión, separados, para saber qué se hizo y qué falta.")}>
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
          {h.partidos.length > 0 && (
            <Seccion detalle titulo={tr("Partidos del torneo")} nota={tr("Contra quién, quién ganó y por qué. Un Elo con pocos partidos dice poco.")}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>{tr("Iteración")}</th>
                    <th>{tr("Rival")}</th>
                    <th>{tr("Resultado")}</th>
                    <th>{tr("Eje decisivo")}</th>
                    <th>{tr("Por qué")}</th>
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
                          <Chip tono={p.resultado === 'gano' ? 'ok' : p.resultado === 'tablas' ? 'borde' : 'mal'}>{p.resultado === 'gano' ? tr('Ganó') : p.resultado === 'tablas' ? 'Tablas' : tr('Perdió')}</Chip>
                        </td>
                        <td>
                          {p.ejeDecisivo === 'solidez' ? 'Solidez' : p.ejeDecisivo}
                          {p.porRegla && <span className="meta"> {tr("· por regla, sin juez")}</span>}
                        </td>
                        <td className="meta">{p.resumenDebate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Seccion>
          )}
      </div>

      <div {...panel('experimento')}>
        {!h.experimento && <p className="meta">{tr("ROSA2018 todavía no propuso un experimento para esta hipótesis.")}</p>}
          {h.experimento && (
            <Seccion titulo={tr("Experimento propuesto")} nota={tr("El traspaso al laboratorio: protocolo, ensayo y criterios de éxito y refutación fijados de antemano. Al asignarlo a un laboratorio queda prerregistrado: la hipótesis y el protocolo se congelan con fecha en un artefacto, antes de que exista ningún dato. Los datos vuelven para que ROSA2018 actualice su conclusión.")}>
              <div className="tarjeta seccion">
                <div className="experimento-bloque">
                  <h4>{tr("Protocolo")}</h4>
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
                  <h4>{tr("Ensayo")}</h4>
                  <p>{h.experimento.ensayo}</p>
                </div>
                {(h.experimento.confirma || h.experimento.refuta) && (
                  <div className="conclusion-columnas">
                    <div className="experimento-bloque criterio-ok">
                      <h4>{tr("La confirmaría")}</h4>
                      <p>{h.experimento.confirma}</p>
                    </div>
                    <div className="experimento-bloque criterio-mal">
                      <h4>{tr("La refutaría")}</h4>
                      <p>{h.experimento.refuta}</p>
                    </div>
                  </div>
                )}
                <ContratoDelExperimento h={h} />
                {(h.experimento.controles || h.experimento.tamanoMuestral || h.experimento.alternativa) && (
                  <div className="conclusion-columnas">
                    {h.experimento.controles && (
                      <div className="experimento-bloque">
                        <h4>{tr("Controles")}</h4>
                        <p>{h.experimento.controles}</p>
                      </div>
                    )}
                    {h.experimento.tamanoMuestral && (
                      <div className="experimento-bloque">
                        <h4>{tr("Tamaño muestral")}</h4>
                        <p>{h.experimento.tamanoMuestral}</p>
                      </div>
                    )}
                    {h.experimento.alternativa && (
                      <div className="experimento-bloque">
                        <h4>{tr("Explicación alternativa y cómo se distingue")}</h4>
                        <p>{h.experimento.alternativa}</p>
                      </div>
                    )}
                  </div>
                )}
                {h.experimento.decisionQueCambia && (
                  <div className="experimento-bloque">
                    <h4>{tr("Qué decisión cambia con el resultado")}</h4>
                    <p>{h.experimento.decisionQueCambia}</p>
                  </div>
                )}
                <div className="experimento-bloque">
                  <h4>{tr("Coste estimado")}</h4>
                  <p>{h.experimento.costeEstimado}</p>
                </div>
                {h.experimento.analisisPedido && h.experimento.estado === 'propuesto' && (
                  <div className="experimento-bloque">
                    <h4>{tr("Con datos ya existentes")}</h4>
                    <p>{h.experimento.analisisPedido}</p>
                  </div>
                )}
                {h.experimento.resultado && (
                  <div className={`experimento-bloque resultado resultado-${h.experimento.resultado.veredicto}`}>
                    <h4>{tr("Resultado contra el prerregistro")}</h4>
                    <div className="acciones">
                      <Chip tono={h.experimento.resultado.veredicto === 'confirma' ? 'ok' : h.experimento.resultado.veredicto === 'refuta' ? 'mal' : 'aviso'}>
                        {h.experimento.resultado.veredicto === 'confirma' ? tr('Confirma la hipótesis') : h.experimento.resultado.veredicto === 'refuta' ? tr('Refuta la hipótesis') : h.experimento.resultado.veredicto === 'inconcluso' ? 'Inconcluso' : tr('No evaluable con estos datos')}
                      </Chip>
                      {h.experimento.resultado.clasificacion && (
                        <Chip tono={RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].tono} title={RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].nota}>
                          {RESULTADO_LABORATORIO[h.experimento.resultado.clasificacion].etiqueta}
                        </Chip>
                      )}
                      {h.experimento.resultado.versionProbada !== undefined && h.experimento.resultado.compatibleConActual === false && <Chip tono="aviso" title={tr("El resultado probó una versión anterior de la hipótesis")}>{trp("Probó la v{versionProbada}", { versionProbada: h.experimento.resultado.versionProbada })}</Chip>}
                      <span className="meta">
                        {h.experimento.resultado.fichero} · <Momento t={h.experimento.resultado.fecha} ahora={ahora} />
                      </span>
                    </div>
                    <Dimensiones d={h.experimento.resultado.dimensiones} />
                    <p>{h.experimento.resultado.resultado}</p>
                    {h.experimento.resultado.accionTomada && <p className="meta">{trp("Qué hizo ROSA2018: {accionTomada}", { accionTomada: h.experimento.resultado.accionTomada })}</p>}
                    {h.experimento.resultado.hipotesisDerivadaId && (
                      <p className="meta">
                        {tr("Hipótesis derivada:")}{' '}
                        <a className="enlace" href={rutaDe(h.investigacionId, 'hipotesis', h.experimento.resultado.hipotesisDerivadaId)}>
                          {tr("abrir")}
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
                    {h.experimento.resultado.limitaciones && <p className="meta">{trp("Limitaciones: {limitaciones}", { limitaciones: h.experimento.resultado.limitaciones })}</p>}
                    {h.experimento.resultado.exploratorio && <p className="meta">{trp("Exploratorio, fuera del prerregistro: {exploratorio}", { exploratorio: h.experimento.resultado.exploratorio })}</p>}
                  </div>
                )}
                <div className="acciones">
                  <Chip tono={h.experimento.estado === 'datos_recibidos' ? 'ok' : h.experimento.estado === 'propuesto' ? 'borde' : 'aviso'}>
                    {h.experimento.estado === 'propuesto' ? tr('Propuesto') : h.experimento.estado === 'asignado' ? trp('Asignado a {laboratorio}', { laboratorio: h.experimento.laboratorio ?? '' }) : h.experimento.estado === 'en_curso' ? tr('En curso') : trp('Datos recibidos: {fichero}', { fichero: h.experimento.ficheroDatos ?? '' })}
                  </Chip>
                  {h.experimento.prerregistradoEn && h.experimento.prerregistroArtefactoId && (
                    <a className="chip chip-ok" href={rutaDe(h.investigacionId, 'artefactos', h.experimento.prerregistroArtefactoId)} title={tr("Hipótesis, protocolo y criterios congelados antes de los datos")}>
                      {tr("Prerregistrado")} <Momento t={h.experimento.prerregistradoEn} ahora={ahora} />
                    </a>
                  )}
                  {h.experimento.prerregistradoEn && h.experimento.selloExterno?.ok && (
                    <Chip tono="ok" title={trp('sha256 {hash}. Hora firmada por {testigos}: {hora}. Se verifica sin ROSA2018 con openssl ts -verify sobre el token guardado.', { hash: h.experimento.selloExterno.hash, testigos: h.experimento.selloExterno.testigos.join(tr(' y ')), hora: h.experimento.selloExterno.primeraHora ?? '' })}>
                      {tr("Sellado por")} {h.experimento.selloExterno.testigos.join(tr(' y '))} ({h.experimento.selloExterno.primeraHora?.slice(0, 16).replace('T', ' ')} {tr("UTC)")}
                    </Chip>
                  )}
                  {h.experimento.prerregistradoEn && !h.experimento.selloExterno?.ok && (
                    <button type="button" className="btn btn-s" title={h.experimento.selloExterno?.error ? trp("Último intento: {error}", { error: h.experimento.selloExterno.error }) : tr('Pide a dos autoridades de sellado de tiempo (RFC 3161) que firmen la hora del prerregistro: un tercero atestigua que se congeló antes de los datos')} disabled={selloEnVuelo} {...atributosEnVuelo(selloEnVuelo)} onClick={envolverSello(() => acciones.sellarPrerregistro(h.id))}>
                      {(h.experimento.selloExterno ? tr("Reintentar el sello externo") : tr("Sellar con un tercero"))}
                    </button>
                  )}
                </div>
                {h.experimento.estado === 'propuesto' && (
                  <div className="dirigir">
                    <input className="entrada" value={lab} placeholder={tr("Laboratorio (por ejemplo FLENI, Buenos Aires)")} onChange={(e) => setLab(e.target.value)} aria-label={tr("Laboratorio")} />
                    <button type="button" className="btn" disabled={lab.trim() === '' || laboratorioEnVuelo} {...atributosEnVuelo(laboratorioEnVuelo)} onClick={envolverLaboratorio(() => acciones.asignarExperimento(h.id, lab))}>
                      {tr("Asignar a laboratorio")}
                    </button>
                  </div>
                )}
                {(h.experimento.estado === 'asignado' || h.experimento.estado === 'datos_recibidos') && (
                  <div className="seccion">
                    <p className="meta">
                      {tr("Cuando lleguen los datos del laboratorio, súbelos aquí (CSV, TSV, JSON, texto o PDF, hasta 50 MB). ROSA2018 los resume sin ningún modelo, el juez los compara con los criterios congelados en el prerregistro y la conclusión se rehace con esa evidencia.")}
                    </p>
                    {h.experimento.datosSinteticos && h.experimento.ficheroDatos && (
                      <Chip tono="aviso" title={tr("La persona declaró al subirlos que son datos sintéticos o de prueba (o el nombre del fichero lo dice). Sirven para probar la pantalla y el flujo; nunca cuentan como observación ni suben el techo GRADE, y no entran al modelo de mundo.")}>
                        {tr("Datos sintéticos o de prueba: no cuentan como evidencia")}
                      </Chip>
                    )}
                    <div className="campo">
                      <label htmlFor="exp-fichero">{tr("Fichero de datos")}</label>
                      <input id="exp-fichero" type="file" accept=".csv,.tsv,.txt,.json,.pdf,.md" onChange={(e) => setFicheroDatos(e.target.files?.[0] ?? null)} />
                    </div>
                    <div className="campo">
                      <label htmlFor="exp-analisis">{tr("Qué análisis quieres (además de los criterios prerregistrados)")}</label>
                      <input id="exp-analisis" className="entrada" value={analisis} placeholder={tr("Tiempo hasta la primera alteración, por grupo genético")} onChange={(e) => setAnalisis(e.target.value)} />
                    </div>
                    <label className="interruptor" title={tr("Márcala si el fichero es inventado, simulado o de prueba. ROSA2018 lo etiqueta como sintético: se evalúa contra el prerregistro para probar el flujo, pero nunca cuenta como observación real, no sube el techo GRADE ni entra al modelo de mundo. Si el nombre del fichero dice «sintético», se marca solo.")}>
                      <input type="checkbox" checked={datosSinteticos} onChange={(e) => setDatosSinteticos(e.target.checked)} />
                      {tr("Estos datos son sintéticos o de prueba (nunca cuentan como evidencia)")}
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
                        {(subiendo ? tr("Subiendo...") : tr("Subir datos y evaluar contra el prerregistro"))}
                      </button>
                      {errorSubida && <span className="tono-mal">{errorSubida}</span>}
                      {h.experimento.estado === 'datos_recibidos' && !h.experimento.resultado && <span className="meta">{tr("Datos recibidos; ROSA2018 los está evaluando.")}</span>}
                    </div>
                  </div>
                )}
                <ProtocoloYEnmiendas h={h} ahora={ahora} />
              </div>
            </Seccion>
          )}
          <Seccion
            titulo={tr("Dossier para el laboratorio")}
            nota={tr("El expediente con el que la hipótesis sale al laboratorio, en siete partes: si va o no y por qué (bloqueos), la hipótesis completa con su versión, la evidencia con procedencia, los análisis con datos, las decisiones, el protocolo prerregistrado y qué se aprende con cada resultado. Se arma sin ningún modelo, con lo que hay en el estado.")}
            acciones={
              <button type="button" className="btn btn-s" disabled={estado.conexion === 'muestra' || dossierOcupado} {...atributosEnVuelo(dossierOcupado)} onClick={() => void pedirDossier()}>
                {(h.dossierArtefactoId ? tr("Regenerar dossier") : tr("Generar dossier"))}
              </button>
            }
          >
            {esperaDossier.esperando && <p className="meta">{tr("Esperando al servidor: el dossier aparecerá en Artefactos y aquí saldrá su enlace.")}</p>}
            {esperaDossier.agotada && (
              <p className="meta tono-aviso" role="status">
                {tr("Sin respuesta del servidor en un minuto. Si el dossier no aparece en Artefactos, vuelve a pedirlo.")}
              </p>
            )}
            {h.dossierArtefactoId ? (
              <p className="meta">
                {tr("Último dossier:")}{' '}
                <a className="enlace" href={rutaDe(h.investigacionId, 'artefactos', h.dossierArtefactoId)}>
                  {tr("abrir en Artefactos")}
                </a>
                {tr(". Cada generación es una versión nueva; las anteriores se conservan.")}
              </p>
            ) : (
              <p className="meta">{tr("Sin dossier todavía.")}</p>
            )}
          </Seccion>
      </div>

      <div {...panel('historial')}>
          <Seccion titulo={tr("Historial")}>
            <ul className="lista-limpia">
              {h.revisiones.map((r, i) => (
                <li key={i}>
                  <span>
                    <strong style={{ fontWeight: 550 }}>{r.quien}</strong> · {ACCION_REVISION_HIPOTESIS[r.accion]}
                    {r.aCiegas && <Chip tono="borde">{tr("a ciegas")}</Chip>}
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
                <p className="campo-etiqueta">{tr("Revisiones escritas por personas (entran al siguiente debate del torneo)")}</p>
                {h.revisionesHumanas.map((r, i) => (
                  <div key={i} className="mensaje mensaje-investigadora">
                    <header>
                      <span>{r.quien}</span>
                      <span>
                        <Momento t={r.fecha} ahora={ahora} />
                      </span>
                    </header>
                    {r.supuestosCuestionados && <p>{trp("Supuestos cuestionados: {supuestosCuestionados}", { supuestosCuestionados: r.supuestosCuestionados })}</p>}
                    {r.literaturaQueFalta && <p>{trp("Literatura que falta: {literaturaQueFalta}", { literaturaQueFalta: r.literaturaQueFalta })}</p>}
                    {r.problemaExperimental && <p>{trp("Problema experimental: {problemaExperimental}", { problemaExperimental: r.problemaExperimental })}</p>}
                  </div>
                ))}
              </div>
            )}
          </Seccion>
          <Seccion titulo={tr("Exportar expediente")} nota={tr("Todo lo que hace falta para auditar la hipótesis fuera de ROSA2018: versiones, decisiones con fecha, trazas, cuadernos, fuentes.")}>
            <div className="dirigir">
              <input className="entrada" value={aplicableA} placeholder={tr("Aplicable a (cohorte, modelo, condición): por ejemplo portadores de APOE4 con genotipo de TREM2")} onChange={(e) => setAplicableA(e.target.value)} aria-label={tr("Aplicable a")} />
              <a className="btn" href={`/api/hipotesis/${encodeURIComponent(h.id)}/rocrate`} download={`rosa-${h.id}.crate.zip`} title={tr("RO-Crate 1.2 (perfil Process Run Crate) con procedencia W3C PROV: la hipótesis, el dossier, las decisiones, las fuentes con su riesgo de sesgo, el código y resultado de cada análisis, el prerregistro y sus sellos RFC 3161. Se verifica con herramientas de terceros, sin ROSA2018.")}>
                {tr("Exportar RO-Crate (PROV)")}
              </a>
              <button type="button" className="btn" onClick={() => descargar(`${h.id}-expediente.json`, expediente(h, estado.hechos, aplicableA.trim() || tr('sin limite declarado')), 'application/json')}>
                {tr("Descargar expediente")}
              </button>
            </div>
          </Seccion>
      </div>

      <Seccion id="decision-hip" titulo={tr("Decisión")} nota={cerrada ? tr('Esta hipótesis ya se decidió. Se puede reabrir.') : aclarando ? tr('ROSA2018 está aclarando lo que marcaste. Volverá a la cola.') : motivo ?? tr('Nada impide aceptarla. Tu lectura decide.')}>
        <div className="campo">
          <label htmlFor="nota-decision">{tr("Nota para ROSA2018 y para el historial")}</label>
          <textarea id="nota-decision" value={nota} rows={2} onChange={(e) => setNota(e.target.value)} placeholder={tr("Comprobable en FLENI; pedir al investigador clínico principal si la cohorte tiene genotipo de TREM2")} />
        </div>
        <button type="button" className="enlace" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setRevisionAbierta((v) => !v)}>
          {(revisionAbierta ? tr("Ocultar la revisión estructurada") : tr("Escribir una revisión estructurada (entra al torneo como revisión, no solo como veredicto)"))}
        </button>
        {revisionAbierta && (
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor="rev-sup">{tr("Supuestos que cuestionas")}</label>
              <textarea id="rev-sup" rows={3} value={rev.supuestosCuestionados} onChange={(e) => setRev({ ...rev, supuestosCuestionados: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rev-lit">{tr("Literatura que falta")}</label>
              <textarea id="rev-lit" rows={3} value={rev.literaturaQueFalta} onChange={(e) => setRev({ ...rev, literaturaQueFalta: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rev-exp">{tr("Problema experimental")}</label>
              <textarea id="rev-exp" rows={3} value={rev.problemaExperimental} onChange={(e) => setRev({ ...rev, problemaExperimental: e.target.value })} />
            </div>
          </div>
        )}
        <div className="acciones">
          {!cerrada && !aclarando && (
            <>
              <button type="button" className="btn btn-primario" disabled={motivo !== null || decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} title={motivo ?? tr('Aceptar y pasarla al modelo de mundo como hipótesis a perseguir')} onClick={() => decidir('aceptar', nota)}>
                {tr("Aceptar")}
              </button>
              <button type="button" className="btn" disabled={decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} onClick={() => decidir('refinar', nota)}>
                {tr("Pedir que la refine")}
              </button>
              <Confirmar
                etiqueta={tr("No puedo juzgar")}
                disabled={decisionEnVuelo}
                pregunta={tr("Di qué te impide juzgarla (ambigua, falta contexto, no reproducible). ROSA2018 la aclara y vuelve a la cola marcada como aclarada.")}
                pedirTexto={{ etiqueta: tr('Qué falta'), marcador: tr('No queda claro si habla de PSEN1 o de todo el Alzheimer familiar') }}
                onConfirmar={(m) => decidir('no_puedo_juzgar', m)}
              />
              <Confirmar
                etiqueta={tr("Descartar")}
                peligro
                disabled={decisionEnVuelo}
                pregunta={tr("El motivo queda en el modelo de mundo para que ROSA2018 no vuelva a proponer lo mismo.")}
                pedirTexto={{ etiqueta: 'Motivo', marcador: tr('Se apoya en un artículo retractado') }}
                onConfirmar={(m) => decidir('descartar', m)}
              />
            </>
          )}
          {cerrada && (
            <button type="button" className="btn" disabled={decisionEnVuelo} {...atributosEnVuelo(decisionEnVuelo)} onClick={() => decidir('reabrir', nota)}>
              {tr("Reabrir")}
            </button>
          )}
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


export function Hipotesis({
  inv,
  estado,
  ahora,
  detalleId,
  cajonAbierto,
  setCajonAbierto,
}: {
  inv: Investigacion;
  estado: EstadoRosa;
  ahora: number;
  detalleId: string | null;
  cajonAbierto: boolean;
  setCajonAbierto: (v: boolean) => void;
}) {
  // Solo la ficha. La lista se mudó al Ranking el 1 de octubre de 2026
  // (componentes/ColaHipotesis.tsx): las dos pantallas enseñaban lo mismo con
  // otro orden. La ruta de la ficha no cambió, y por eso los treinta enlaces
  // que llegan aquí desde el árbol, el atlas, la búsqueda, calidad,
  // mecanismos y los eventos del inicio siguen valiendo sin tocar ninguno.
  const [pestana, setPestana] = useState<PestanaProcedencia>('fuentes');
  const [celda, setCelda] = useState<number | null>(null);
  const seleccionada = estado.hipotesis.find((h) => h.id === detalleId && h.investigacionId === inv.id) ?? null;
  // La ficha abre con un frame de silueta: pinta decenas de secciones y
  // hacerlo de golpe congelaba la pantalla un instante.
  const { valor: ficha } = useCalculoDiferido(() => ({ id: seleccionada?.id ?? null }), [seleccionada?.id ?? null]);
  const fichaLista = seleccionada !== null && ficha !== null && ficha.id === seleccionada.id;

  if (estado.conexion === 'conectando') return <EsqueletoPantalla variante="ficha" rotulo={tr("la hipótesis")} />;

  // Antes esto caía en la cola, que ya no vive aquí. Un id que no existe en
  // esta investigación (un enlace viejo, una hipótesis borrada) se dice, no
  // se disimula enseñando otra cosa.
  if (seleccionada === null) {
    return (
      <div className="contenido">
        <Vacio titulo={tr("Esa hipótesis no está en esta investigación")}>
          {tr("Puede que el enlace sea de otra investigación o que la hipótesis ya no exista.")}{' '}
          <a className="enlace" href={rutaDe(inv.id, 'ranking')}>
            {tr("Ver el ranking de hipótesis")}
          </a>
        </Vacio>
      </div>
    );
  }

  if (!fichaLista) return <EsqueletoPantalla variante="ficha" rotulo={tr("la hipótesis")} />;
  return (
    <>
      <div className="contenido ficha-hip">
        <p className="ficha-volver">
          <a className="enlace" href={rutaDe(inv.id, 'ranking', 'pendientes')}>
            {tr("Volver al ranking")}
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
