// Citas: cada afirmación junto a la página donde ROSA2018 la comprobó.
//
// Por qué existe esta pantalla. La regla del proyecto es que una cita resuelve
// a la página exacta y que un desfase de una página es un fallo grave. El
// verificador ya lo comprueba (rosa/verificador.py) y hasta ahora eso solo se
// veía como un veredicto en un registro. Aquí se enseña: a la izquierda las
// afirmaciones con su veredicto, a la derecha la página tal como se leyó, con
// el pasaje resaltado, y debajo la comparación entre lo que dijo ROSA2018 y lo
// que el verificador encontró. Cuando el pasaje no está entero, se dice qué
// tramo falta: eso es lo que convierte un veredicto en algo que se puede
// discutir.
//
// De la investigación del 22 de septiembre: de diez herramientas de literatura
// revisadas (Elicit, Consensus, Scite, Undermind y demás), ninguna resuelve la
// cita a la página del PDF; las mejores llegan al fragmento suelto. Esta
// pantalla es el hueco que ROSA2018 cubre.
//
// Lo que no se disimula: la mayoría de las fuentes no tienen PDF en acceso
// abierto, así que muchas citas se apoyan en el resumen, en una sección del
// XML o en el texto de la web. Esas fichas lo dicen con esas palabras ("sin
// número de página") en lugar de inventar una página. El contador de la
// cabecera enseña cuántas de las afirmaciones resuelven de verdad a página.
//
// El texto de la página no se vuelve a sacar del PDF: es el mismo que leyó el
// verificador, guardado al leerlo, así que lo que se ve es lo que se juzgó.
import { useEffect, useMemo, useRef, useState } from 'react';
import { acciones, type SinRespuesta } from '../datos/almacen';
import { RECUPERACION_PENDIENTE } from '../datos/acciones';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { avanceDeRecuperacion, enLlanoElVeredicto, enLlanoLaClase, enlaceAlPasaje, informeDeRecuperacion, senalesDe, trozosDeTexto, type AfirmacionCitada, type CitasRecuperables, type ComprobacionDeHoy, type FichaCita, type ListaCitas } from '../lib/citas';
import { Esqueleto } from '../componentes/Esqueleto';
import { atributosEnVuelo, useEnVuelo } from '../lib/diferido';
import { AvisoMuestra } from '../componentes/piezas';
import { fechaCorta, formatearEntero, plural } from '../lib/formato';
import '../citas.css';
import { tr, trp } from '../lib/idioma';

const AYUDA =
  tr('Cada afirmación que ROSA2018 ha extraído, junto al trozo exacto de la fuente que la sostiene. A la izquierda la afirmación; a la derecha la página tal como ROSA2018 la leyó, con el pasaje resaltado.');
const META =
  tr('De cada cita se comprueban dos cosas distintas, y se enseñan por separado: si APUNTA a un sitio que existe (fuente y localizador) y si su pasaje ESTÁ ahí, literal. Pueden darse las cuatro combinaciones: un texto que coincide con la fuente pero cuya cita apunta a un sitio que no existe sigue siendo un problema, y no el mismo. El veredicto que acompaña a cada afirmación es el que se tomó al extraerla; las dos señales se vuelven a medir ahora, con las reglas de hoy, y cuando no coinciden se dice.');

type Estado = 'cargando' | 'listo' | 'sin_servidor' | 'sin_respuesta' | 'vacia';

/** Las corridas de la investigación, de la más reciente a la más antigua. */
function corridasDe(estado: EstadoRosa, inv: Investigacion) {
  return estado.corridas
    .filter((c) => c.investigacionId === inv.id)
    .slice()
    .sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));
}

function Veredicto({ veredicto }: { veredicto: string }) {
  const { texto, tono } = enLlanoElVeredicto(veredicto);
  return <span className={`citas-veredicto citas-${tono}`}>{texto}</span>;
}

/** La recuperación de las afirmaciones bloqueadas por reglas que ya no valen,
 *  para toda la investigación (rosa/recuperacion_citas.py): cuántas hay, el
 *  botón que la pide, el avance mientras el supervisor la hace en segundo
 *  plano, y el informe de lo que cambió. El número sale del servidor sin
 *  modelo; si no responde, se dice que no se pudo contar, no que no haya. */
export function RecuperacionDeCitas({ inv }: { inv: Investigacion }) {
  const reg = inv.recuperacionCitas ?? null;
  const pendiente = reg !== null && RECUPERACION_PENDIENTE.has(reg.estado);
  const [cuenta, setCuenta] = useState<CitasRecuperables | null | SinRespuesta>(null);
  const [enVuelo, envolver] = useEnVuelo();
  // Se vuelve a contar al cambiar de investigación y cada vez que una recuperación termina.
  const clave = `${inv.id}|${reg?.estado ?? ''}|${reg?.terminadaEn ?? ''}`;
  useEffect(() => {
    let vivo = true;
    void acciones.citasRecuperables(inv.id).then((r) => {
      if (vivo) setCuenta(r);
    });
    return () => {
      vivo = false;
    };
  }, [clave, inv.id]);
  const datos = cuenta && cuenta !== 'sin_respuesta' ? cuenta : null;
  const n = datos ? datos.bloqueosViejos + datos.sinJuez : 0;
  const terminada = reg !== null && (reg.estado === 'terminada' || reg.estado === 'fallida');
  if (!pendiente && !terminada && !n && cuenta !== 'sin_respuesta') return null;
  const pedir = envolver(async () => {
    await acciones.pedirRecuperacionCitas(inv.id, null);
  });
  return (
    <section className="citas-recuperar-panel" aria-label={tr("Recuperación de citas")}>
      <h3>{tr("Recuperación de citas")}</h3>
      {pendiente && reg ? (
        <>
          <p role="status">{avanceDeRecuperacion(reg)}</p>
          {reg.fase === 'juez' && reg.total > 0 && <progress value={reg.revisadas} max={reg.total} aria-label={tr("Afirmaciones vueltas a juzgar")} />}
        </>
      ) : cuenta === 'sin_respuesta' ? (
        <p className="nota" role="status">
          {tr("No pude contar las afirmaciones por recuperar: el servidor no respondió. No quiere decir que no las haya.")}
        </p>
      ) : n > 0 && datos ? (
        <>
          <p>
            {(datos.corridasVivas ? trp("{bloqueosViejos} por reglas del verificador que ya no valen{v}. Es evidencia ya leída que hoy no cuenta para ninguna hipótesis. Recuperarlas las vuelve a juzgar con el verificador de hoy, enlaza a las hipótesis las que salgan sostenidas y rehace las conclusiones que cambien. Cuesta una llamada al juez por afirmación, más una por cada conclusión rehecha, y va en segundo plano. Hay una corrida trabajando en esta investigación: empezará cuando pare.", { bloqueosViejos: plural(datos.bloqueosViejos, tr('afirmación de esta investigación sigue bloqueada'), tr('afirmaciones de esta investigación siguen bloqueadas')), v: datos.sinJuez ? `, y ${plural(datos.sinJuez, tr('se quedó sin juez'), tr('se quedaron sin juez'))}` : '' }) : trp("{bloqueosViejos} por reglas del verificador que ya no valen{v}. Es evidencia ya leída que hoy no cuenta para ninguna hipótesis. Recuperarlas las vuelve a juzgar con el verificador de hoy, enlaza a las hipótesis las que salgan sostenidas y rehace las conclusiones que cambien. Cuesta una llamada al juez por afirmación, más una por cada conclusión rehecha, y va en segundo plano.", { bloqueosViejos: plural(datos.bloqueosViejos, tr('afirmación de esta investigación sigue bloqueada'), tr('afirmaciones de esta investigación siguen bloqueadas')), v: datos.sinJuez ? `, y ${plural(datos.sinJuez, tr('se quedó sin juez'), tr('se quedaron sin juez'))}` : '' }))}
          </p>
          <button type="button" className="btn btn-s btn-primario" onClick={() => void pedir()} {...atributosEnVuelo(enVuelo)}>
            {enVuelo ? 'Pidiendo...' : trp("Recuperar las {n}", { n: formatearEntero(n) })}
          </button>
        </>
      ) : null}
      {terminada && reg && (
        <div className="citas-recuperar-informe">
          <p className="meta">
            {(reg.corridaId ? trp("Última recuperación, pedida el {pedidaEn} por {quien} (una sola corrida):", { pedidaEn: fechaCorta(reg.pedidaEn), quien: reg.quien }) : trp("Última recuperación, pedida el {pedidaEn} por {quien}:", { pedidaEn: fechaCorta(reg.pedidaEn), quien: reg.quien }))}</p>
          {reg.estado === 'fallida' ? (
            <p>{avanceDeRecuperacion(reg)}</p>
          ) : (
            <ul>
              {informeDeRecuperacion(reg).map((linea, i) => (
                <li key={i}>{linea}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function Citas({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const corridas = useMemo(() => corridasDe(estado, inv), [estado.corridas, inv.id]);
  const [corridaId, setCorridaId] = useState<string>(() => corridas[0]?.id ?? '');
  const [lista, setLista] = useState<ListaCitas | null>(null);
  const [fase, setFase] = useState<Estado>('cargando');
  const [filtro, setFiltro] = useState<'todas' | 'sostenidas' | 'fallidas' | 'pagina' | 'rancias'>('todas');
  const [elegida, setElegida] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaCita | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [enVuelo, envolver] = useEnVuelo();
  const [recuperacion, setRecuperacion] = useState<string | null>(null);

  // La corrida elegida sigue siendo válida al cambiar de investigación.
  useEffect(() => {
    if (!corridas.some((c) => c.id === corridaId)) setCorridaId(corridas[0]?.id ?? '');
  }, [corridas, corridaId]);

  useEffect(() => {
    let vivo = true;
    if (!corridaId) {
      setFase('vacia');
      setLista(null);
      return;
    }
    setFase('cargando');
    setElegida(null);
    setFicha(null);
    void acciones.citasDe(corridaId).then((r) => {
      if (!vivo) return;
      if (r === null) {
        setFase('sin_servidor');
      } else if (r === 'sin_respuesta') {
        setFase('sin_respuesta');
      } else {
        setLista(r);
        setFase(r.afirmaciones.length ? 'listo' : 'vacia');
        setElegida(r.afirmaciones[0]?.id ?? null);
      }
    });
    return () => {
      vivo = false;
    };
    // `terminadaEn`: al terminar una recuperación los veredictos cambiaron y la lista se vuelve a pedir.
  }, [corridaId, inv.recuperacionCitas?.terminadaEn]);

  useEffect(() => {
    let vivo = true;
    if (!corridaId || !elegida) {
      setFicha(null);
      return;
    }
    setCargandoFicha(true);
    void acciones.citaDe(corridaId, elegida).then((r) => {
      if (!vivo) return;
      setCargandoFicha(false);
      setFicha(r && r !== 'sin_respuesta' ? r : null);
    });
    return () => {
      vivo = false;
    };
  }, [corridaId, elegida]);

  // Recuperar las de esta corrida: la misma recuperación completa que la de toda la
  // investigación (juez, enlazar a las hipótesis y rehacer conclusiones), en segundo
  // plano. Antes esperaba aquí la pasada entera del juez y se quedaba en el veredicto.
  const recuperacionPendiente = Boolean(inv.recuperacionCitas && RECUPERACION_PENDIENTE.has(inv.recuperacionCitas.estado));
  const recuperar = envolver(async () => {
    setRecuperacion(null);
    await acciones.pedirRecuperacionCitas(inv.id, corridaId);
    setRecuperacion(tr('Pedida: se hace en segundo plano. El avance se ve arriba, en «Recuperación de citas», y la lista se recarga sola al terminar.'));
  });

  const afirmaciones = useMemo(() => {
    const todas = lista?.afirmaciones ?? [];
    if (filtro === 'sostenidas') return todas.filter((a) => a.veredicto === 'sostenida');
    if (filtro === 'fallidas') return todas.filter((a) => a.veredicto !== 'sostenida' && a.veredicto !== 'parcial');
    if (filtro === 'pagina') return todas.filter((a) => a.clase === 'pagina');
    if (filtro === 'rancias') return todas.filter((a) => Boolean(a.bloqueoViejo));
    return todas;
  }, [lista, filtro]);

  useEffect(() => {
    if (afirmaciones.length && !afirmaciones.some((a) => a.id === elegida)) setElegida(afirmaciones[0]!.id);
  }, [afirmaciones, elegida]);

  const resumen = lista?.resumen;
  const sostenidas = resumen?.porVeredicto?.sostenida ?? 0;
  const fallidas = Object.entries(resumen?.porVeredicto ?? {})
    .filter(([v]) => v !== 'sostenida' && v !== 'parcial')
    .reduce((s, [, n]) => s + n, 0);

  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{tr("Citas")}</h2>
          <p>{tr(AYUDA)}</p>
          <p className="meta">
            {tr(META)}
            {resumen ? trp(" En esta corrida, {conPagina} a página exacta de {total}.", { conPagina: plural(resumen.conPagina, tr('afirmación resuelve'), tr('afirmaciones resuelven')), total: resumen.total }) : ''}
            {resumen && (resumen.bloqueosViejos ?? 0) > 0
              ? (resumen.bloqueosViejos === 1 ? trp(" {bloqueosViejos} con una versión anterior del verificador y hoy el verificador ya no la bloquearía.", { bloqueosViejos: plural(resumen.bloqueosViejos, tr('afirmación quedó bloqueada'), tr('afirmaciones quedaron bloqueadas')) }) : trp(" {bloqueosViejos} con una versión anterior del verificador y hoy el verificador ya no las bloquearía.", { bloqueosViejos: plural(resumen.bloqueosViejos, tr('afirmación quedó bloqueada'), tr('afirmaciones quedaron bloqueadas')) })) +
                ((resumen.bloqueadasConCitaEnOrden ?? 0) > resumen.bloqueosViejos
                  ? trp(" Otras {v} tienen la cita en orden pero siguen bloqueadas por otra comprobación.", { v: (resumen.bloqueadasConCitaEnOrden ?? 0) - resumen.bloqueosViejos })
                  : '')
              : ''}
          </p>
        </div>
        {corridas.length > 1 && (
          <div className="acciones">
            <label className="citas-selector">
              {tr("Corrida")}{' '}
              <select value={corridaId} onChange={(e) => setCorridaId(e.target.value)} aria-label={tr("Elegir corrida")}>
                {corridas.map((c) => (
                  <option key={c.id} value={c.id}>{trp("Corrida {numero}", { numero: c.numero })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <RecuperacionDeCitas inv={inv} />

      {fase === 'sin_servidor' && (
        <p className="nota" role="status">
          {tr("Las citas se leen del servidor de ROSA2018 y ahora mismo estás viendo los datos de muestra.")}
        </p>
      )}
      {fase === 'sin_respuesta' && (
        <p className="nota" role="status">
          {tr("No pude comprobar las citas: el servidor no respondió. No quiere decir que no las haya.")}
        </p>
      )}
      {fase === 'vacia' && (
        <p className="nota" role="status">
          {tr("Esta corrida todavía no tiene afirmaciones extraídas con su cita.")}
        </p>
      )}

      {(fase === 'listo' || fase === 'cargando') && (
        <div className="citas-cuerpo">
          <section className="citas-col" aria-label={tr("Afirmaciones de la corrida")}>
            <header>
              <h3>{tr("Afirmaciones")}</h3>
              <div className="citas-filtros" role="group" aria-label={tr("Filtrar afirmaciones")}>
                <button type="button" className="atlas-chip" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
                  {tr("Todas")} <span className="atlas-cifra">{resumen?.total ?? 0}</span>
                </button>
                <button type="button" className="atlas-chip" aria-pressed={filtro === 'sostenidas'} onClick={() => setFiltro('sostenidas')}>
                  {tr("Sostenidas")} <span className="atlas-cifra">{sostenidas}</span>
                </button>
                <button type="button" className="atlas-chip" aria-pressed={filtro === 'fallidas'} onClick={() => setFiltro('fallidas')}>
                  {tr("Fallidas")} <span className="atlas-cifra">{fallidas}</span>
                </button>
                <button type="button" className="atlas-chip" aria-pressed={filtro === 'pagina'} onClick={() => setFiltro('pagina')}>
                  {tr("Con página")} <span className="atlas-cifra">{resumen?.conPagina ?? 0}</span>
                </button>
                {(resumen?.bloqueosViejos ?? 0) > 0 && !recuperacionPendiente && (
                  <button type="button" className="btn btn-s btn-primario citas-recuperar" onClick={() => void recuperar()} {...atributosEnVuelo(enVuelo)} title={tr("Vuelve a juzgarlas, enlaza a las hipótesis las que salgan sostenidas y rehace sus conclusiones")}>
                    {enVuelo ? 'Pidiendo...' : trp("Recuperar las {v} de esta corrida", { v: resumen?.bloqueosViejos ?? 0 })}
                  </button>
                )}
                {(resumen?.bloqueosViejos ?? 0) > 0 && (
                  <button type="button" className="atlas-chip" aria-pressed={filtro === 'rancias'} onClick={() => setFiltro('rancias')} title={tr("Bloqueadas con una versión anterior del verificador: hoy el verificador entero ya no las bloquearía")}>
                    {tr("Ya no bloquearían")} <span className="atlas-cifra">{resumen?.bloqueosViejos ?? 0}</span>
                  </button>
                )}
              </div>
            </header>
            {recuperacion && (
              <p className="nota citas-recuperacion" role="status">
                {recuperacion}
              </p>
            )}
            <div className="citas-lista">
              {fase === 'cargando' ? (
                <div className="citas-esqueleto" aria-busy="true">
                  <span className="sr-only">{tr("Cargando las citas")}</span>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="citas-fila">
                      <Esqueleto ancho="90%" alto={15} />
                      <Esqueleto ancho="55%" alto={12} />
                    </div>
                  ))}
                </div>
              ) : afirmaciones.length === 0 ? (
                <p className="meta citas-fila">{tr("Ninguna afirmación con ese filtro.")}</p>
              ) : (
                afirmaciones.map((a) => <FilaAfirmacion key={a.id} a={a} elegida={a.id === elegida} onElegir={() => setElegida(a.id)} />)
              )}
            </div>
          </section>

          <section className="citas-col" aria-label={tr("La fuente y su página")}>
            <header>
              <h3>{tr("Fuente")}</h3>
              {ficha && ficha.leidos.length > 1 && (
                <div className="citas-leidos">
                  <span className="meta">{tr("Se leyeron")}</span>
                  {ficha.leidos.map((l) => (
                    <span key={l.localizador} className={`citas-leido${l.actual ? ' actual' : ''}`}>
                      {l.pagina ?? l.localizador}
                    </span>
                  ))}
                </div>
              )}
            </header>
            <div className="citas-doc">
              {cargandoFicha || fase === 'cargando' ? (
                <div aria-busy="true">
                  <span className="sr-only">{tr("Cargando la página de la fuente")}</span>
                  <Esqueleto ancho="70%" alto={18} />
                  <div style={{ height: 10 }} />
                  <Esqueleto ancho="100%" alto={360} radio={8} />
                </div>
              ) : ficha ? (
                <Ficha ficha={ficha} corridaId={corridaId} />
              ) : (
                <p className="meta">{tr("Elige una afirmación de la izquierda para ver dónde se comprobó.")}</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// El localizador de una cita (`a.cita`) NO se traduce: es la referencia al
// sitio exacto del documento fuente, y tiene que coincidir con él letra por
// letra para que la cita resuelva. Traducir «Results section» cambiaría el
// localizador por uno que no existe en el PDF.
function FilaAfirmacion({ a, elegida, onElegir }: { a: AfirmacionCitada; elegida: boolean; onElegir: () => void }) {
  return (
    <button type="button" className={`citas-fila citas-af${elegida ? ' elegida' : ''}`} aria-current={elegida ? 'true' : undefined} onClick={onElegir}>
      <p>{a.texto}</p>
      <div className="citas-meta">
        <Veredicto veredicto={a.veredicto} />
        <span className="citas-cita" data-sin-traducir>{a.cita}</span>
        <span className="meta">{enLlanoLaClase(a.clase, a.localizador)}</span>
        {Boolean(a.bloqueoViejo) && <span className="citas-marca-rancio">{tr("ya no bloquearía")}</span>}
      </div>
    </button>
  );
}

/** Las dos señales, cada una con su sí o su no. Nunca se funden en una: son
 *  preguntas distintas y la respuesta a una no implica la otra. */
function Senales({ hoy, clase, localizador }: { hoy: ComprobacionDeHoy; clase: FichaCita['clase']; localizador: string }) {
  if (hoy.disponible === false) return <p className="meta">{hoy.motivoResuelve}</p>;
  return (
    <ul className="citas-senales">
      <li>
        <span className={hoy.resuelve ? 'citas-si' : 'citas-no'} aria-hidden="true">
          {hoy.resuelve ? '✓' : '✗'}
        </span>
        <span>
          <b>{tr("La cita apunta a un sitio que existe.")}</b>{' '}
          {hoy.resuelve ? enLlanoLaClase(clase, localizador) : hoy.motivoResuelve}
        </span>
      </li>
      <li>
        <span className={hoy.literal ? 'citas-si' : 'citas-no'} aria-hidden="true">
          {hoy.literal ? '✓' : '✗'}
        </span>
        <span>
          <b>{tr("El pasaje está ahí, literal.")}</b>{' '}
          {hoy.literal ? tr('Entero y en orden, tras normalizar tipografía y números de línea.') : hoy.resuelve ? tr('Falta un tramo del pasaje en la fuente.') : tr('No se pudo comprobar: la cita no resuelve.')}
        </span>
      </li>
    </ul>
  );
}

function Ficha({ ficha, corridaId }: { ficha: FichaCita; corridaId: string }) {
  const trozos = useMemo(() => trozosDeTexto(ficha.texto, ficha.tramos), [ficha.texto, ficha.tramos]);
  // Con PDF se puede enseñar la página de verdad, con el pasaje pintado
  // encima. Se empieza por el texto, que ya está cargado, y la imagen se pide
  // solo si se pulsa: son 300 KB por página.
  const [vista, cambiarVista] = useState<'texto' | 'pagina'>('texto');
  useEffect(() => cambiarVista('texto'), [ficha.afirmacion.id]);
  // Un servidor anterior no manda las señales: se dice, no se finge.
  const hoy = senalesDe(ficha.hoy);
  const hoja = useRef<HTMLDivElement>(null);
  // Un resaltado que hay que ir a buscar por la página no sirve de nada: la
  // hoja se coloca sola en el primer tramo, sin mover el resto de la pantalla.
  useEffect(() => {
    const caja = hoja.current;
    const marca = caja?.querySelector('mark');
    if (!marca || !caja) return;
    // Por rectángulos, no por offsetTop: el padre de posicionamiento de la
    // marca no tiene por qué ser la hoja, y entonces el salto caería mal.
    const dentro = marca.getBoundingClientRect().top - caja.getBoundingClientRect().top;
    caja.scrollTop = Math.max(0, caja.scrollTop + dentro - 90);
  }, [ficha.afirmacion.id, trozos]);
  // El enlace lleva AL PASAJE, no solo al documento: el PDF se abre en su
  // página y la web salta al texto y lo resalta sola (Emir, 22 de septiembre
  // de 2026: "que cuando le des a ver cita te lleve literalmente al texto").
  const alPasaje = enlaceAlPasaje(ficha, ficha.conPdf ? acciones.pdfDeCita(corridaId, ficha.afirmacion.id) : undefined);
  const enLaFuente = ficha.fuente.doi ? `https://doi.org/${ficha.fuente.doi}` : ficha.fuente.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ficha.fuente.pmid}/` : '';
  return (
    <>
      <div className="citas-doc-cab">
        <div>
          <h4>{ficha.fuente.titulo || ficha.fuente.referencia}</h4>
          <p className="meta">
            {[ficha.fuente.referencia, ficha.fuente.anio && !ficha.fuente.referencia.includes(String(ficha.fuente.anio)) ? String(ficha.fuente.anio) : '', ficha.fuente.doi ? `doi:${ficha.fuente.doi}` : '', ficha.fuente.tipoEstudio && ficha.fuente.tipoEstudio !== 'otro' ? ficha.fuente.tipoEstudio : ''].filter(Boolean).join(' · ')}
          </p>
          {ficha.fuente.retraccion && <p className="citas-retraccion">{tr("Esta fuente está retractada.")}</p>}
        </div>
        <p className="meta citas-loc">{enLlanoLaClase(ficha.clase, ficha.localizador)}</p>
      </div>

      {ficha.conPdf && (
        <div className="citas-vistas" role="group" aria-label={tr("Cómo ver la página")}>
          <button type="button" className={vista === 'texto' ? 'activo' : ''} onClick={() => cambiarVista('texto')} aria-pressed={vista === 'texto'}>
            {tr("Texto leído")}
          </button>
          <button type="button" className={vista === 'pagina' ? 'activo' : ''} onClick={() => cambiarVista('pagina')} aria-pressed={vista === 'pagina'}>
            {ficha.pagina !== null ? trp("Página {pagina} del PDF", { pagina: ficha.pagina }) : tr('Página del PDF')}
          </button>
        </div>
      )}

      {vista === 'pagina' && ficha.conPdf ? (
        <div className="citas-hoja citas-hoja-pdf">
          <img
            className="citas-pagina"
            src={acciones.paginaDeCita(corridaId, ficha.afirmacion.id)}
            alt={ficha.completo ? trp("Página {v} del PDF con el pasaje citado marcado en naranja", { v: ficha.pagina ?? '' }) : trp("Página {v} del PDF, sin marcar: el pasaje no se encontró en ella", { v: ficha.pagina ?? '' })}
          />
        </div>
      ) : ficha.texto ? (
        <div className="citas-hoja" ref={hoja}>
          {ficha.encabezado && <p className="citas-encabezado">{ficha.encabezado}</p>}
          <p className="citas-texto">
            {trozos.map((t, i) => (t.marcado ? <mark key={i}>{t.texto}</mark> : <span key={i}>{t.texto}</span>))}
          </p>
          {ficha.pagina !== null && <p className="citas-numpag">{ficha.pagina}</p>}
        </div>
      ) : (
        <p className="nota">{tr("De esta fuente no se guardó el texto de ese localizador, así que no puedo enseñar dónde estaba el pasaje.")}</p>
      )}
      {vista === 'pagina' && ficha.conPdf && !ficha.completo && (
        <p className="nota">{tr("El pasaje no está en esta página, así que no hay nada que marcar. La página se enseña igual, para poder comprobarlo.")}</p>
      )}

      <div className="citas-barra">
        {ficha.conPdf ? (
          <button type="button" className="btn btn-s btn-primario" onClick={() => cambiarVista('pagina')}>
            {ficha.pagina !== null ? trp("Ver la cita marcada en la página {pagina}", { pagina: ficha.pagina }) : tr('Ver la cita marcada en la página')}
          </button>
        ) : (
          alPasaje && (
            <a className="btn btn-s btn-primario" href={alPasaje} target="_blank" rel="noreferrer">
              {tr("Ver la cita en la fuente")}
            </a>
          )
        )}
        {ficha.conPdf && alPasaje && (
          <a className="btn btn-s" href={alPasaje} target="_blank" rel="noreferrer">
            {tr("Abrir el PDF entero")}
          </a>
        )}
        {enLaFuente && enLaFuente !== alPasaje && (
          <a className="btn btn-s" href={enLaFuente} target="_blank" rel="noreferrer">
            {tr("Ficha del artículo")}
          </a>
        )}
      </div>
      {ficha.conPdf ? (
        <p className="meta citas-pista-enlace">
          {trp("La marca la pinta ROSA2018 sobre la página: el visor de PDF del navegador solo sabe abrir por una página, no resaltar, así que abrir el PDF entero lleva a la página {v} sin marcar.", { v: ficha.pagina ?? '' })}</p>
      ) : (
        alPasaje && (
          <p className="meta citas-pista-enlace">{tr("El navegador salta solo hasta el pasaje y lo resalta. Si la página ha cambiado desde que ROSA2018 la leyó, se abrirá por el principio.")}</p>
        )
      )}

      <div className="citas-comparacion">
        <div>
          <p className="citas-t">{tr("Lo que dijo ROSA2018")}</p>
          <p>{ficha.afirmacion.texto}</p>
          <p className="meta">{tr("Veredicto al extraerla:")} <Veredicto veredicto={ficha.afirmacion.veredicto} /></p>
          {ficha.afirmacion.motivo && <p className="meta">{ficha.afirmacion.motivo}</p>}
        </div>
        <div>
          <p className="citas-t">{tr("Lo que se comprueba hoy")}</p>
          <Senales hoy={hoy} clase={ficha.clase} localizador={ficha.localizador} />
          {!hoy.literal && hoy.falta && (
            <p>
              {tr("No está en la fuente:")} <span className="citas-falta">{hoy.falta}</span>
            </p>
          )}
          {Boolean(ficha.bloqueoViejo) && (
            <p className="citas-rancio">
              {tr("Esta afirmación quedó bloqueada con una versión anterior del verificador y hoy ya no lo estaría. Con «Reverificar» se vuelve a juzgar y su veredicto se actualiza.")}
            </p>
          )}
          {!ficha.bloqueoViejo && hoy.resuelve && hoy.literal && ficha.veredictoDeHoy?.bloquea && (
            <p className="citas-sigue">
              {trp("La cita está en orden, pero la afirmación sigue bloqueada hoy por otra comprobación: {motivo}", { motivo: ficha.veredictoDeHoy.motivo })}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
