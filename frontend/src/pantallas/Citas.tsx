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
//
// Rehecha el 5 de octubre de 2026 sobre el diseño "Citas · v1": arriba el
// banco de pruebas (cuántas resuelven a página, las dos señales de hoy y los
// veredictos al extraerlas), la recuperación de citas, y debajo la mesa de
// lectura con la lista a la izquierda y la fuente a la derecha.
import { useEffect, useMemo, useRef, useState } from 'react';
import { acciones, type SinRespuesta } from '../datos/almacen';
import { RECUPERACION_PENDIENTE } from '../datos/acciones';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { avanceDeRecuperacion, enLlanoElVeredicto, enLlanoLaClase, enlaceAlPasaje, etiquetaLocalizador, informeDeRecuperacion, senalesDe, trozosDeTexto, type AfirmacionCitada, type CitasRecuperables, type ClaseCita, type ComprobacionDeHoy, type FichaCita, type ListaCitas, type ResumenCitas } from '../lib/citas';
import { Esqueleto } from '../componentes/Esqueleto';
import { IconoEsc, type NombreIcono } from '../componentes/IconosEscenario';
import { atributosEnVuelo, useEnVuelo } from '../lib/diferido';
import { AvisoMuestra } from '../componentes/piezas';
import { fechaCorta, formatearEntero, plural } from '../lib/formato';
import '../citas.css';
import '../citas-mesa.css';
import { tr, trp } from '../lib/idioma';

const AYUDA =
  'A la izquierda lo que dijo ROSA2018; a la derecha el trozo exacto de la fuente que lo sostiene, tal como se leyó, con el pasaje resaltado.';
const META =
  'De cada cita se comprueban dos cosas distintas, y se enseñan por separado: si APUNTA a un sitio que existe (fuente y localizador) y si su pasaje ESTÁ ahí, literal. Pueden darse las cuatro combinaciones: un texto que coincide con la fuente pero cuya cita apunta a un sitio que no existe sigue siendo un problema, y no el mismo. El veredicto que acompaña a cada afirmación es el que se tomó al extraerla; las dos señales se vuelven a medir ahora, con las reglas de hoy, y cuando no coinciden se dice.';
const EXPLICA_RECUPERAR =
  'Recuperarlas las vuelve a juzgar con el verificador de hoy, enlaza a las hipótesis las que salgan sostenidas y rehace las conclusiones que cambien. Cuesta una llamada al juez por afirmación, más una por cada conclusión rehecha, y va en segundo plano.';

type Estado = 'cargando' | 'listo' | 'sin_servidor' | 'sin_respuesta' | 'vacia';
type Tono = 'bien' | 'medio' | 'mal' | 'neutro';

/** A qué se agarra cada cita, de la que resuelve a página a la que menos. */
const CLASES: { clase: ClaseCita; etiqueta: string; icono: NombreIcono }[] = [
  { clase: 'pagina', etiqueta: 'Página del PDF', icono: 'file-text' },
  { clase: 'seccion', etiqueta: 'Sección', icono: 'list' },
  { clase: 'resumen', etiqueta: 'Resumen', icono: 'type' },
  { clase: 'web', etiqueta: 'Texto web', icono: 'globe' },
  { clase: 'otro', etiqueta: 'Otro', icono: 'circle-dot' },
];
const iconoDeClase = (clase: ClaseCita): NombreIcono => CLASES.find((c) => c.clase === clase)?.icono ?? 'circle-dot';

/** El orden de los veredictos en el banco: primero los que sostienen. */
const ORDEN_VEREDICTOS = ['sostenida', 'parcial', 'no_comprobable', 'sin_verificar', 'cita_no_resuelve', 'no_sostenida', 'sin_cita', 'ausencia_refutada'];

/** El tono del veredicto; las que el juez no llegó a ver van en gris, ni
 *  bien ni mal: todavía no se sabe. */
function tonoDe(veredicto: string): Tono {
  return veredicto === 'sin_verificar' ? 'neutro' : enLlanoElVeredicto(veredicto).tono;
}

/** Las corridas de la investigación, de la más reciente a la más antigua. */
function corridasDe(estado: EstadoRosa, inv: Investigacion) {
  return estado.corridas
    .filter((c) => c.investigacionId === inv.id)
    .slice()
    .sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));
}

/** El veredicto de una fila: un punto de color y la palabra. */
function VeredictoPunto({ veredicto }: { veredicto: string }) {
  return (
    <span className={`cit-veredicto cit-${tonoDe(veredicto)}`}>
      <i className="cit-punto" aria-hidden="true" />
      {enLlanoElVeredicto(veredicto).texto}
    </span>
  );
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
  const porQue = datos
    ? [
        datos.bloqueosViejos ? plural(datos.bloqueosViejos, tr('sigue bloqueada por reglas del verificador que ya no valen'), tr('siguen bloqueadas por reglas del verificador que ya no valen')) : '',
        datos.sinJuez ? plural(datos.sinJuez, tr('se quedó sin juez'), tr('se quedaron sin juez')) : '',
      ]
        .filter(Boolean)
        .join(tr(' y '))
    : '';
  const ofrece = !pendiente && cuenta !== 'sin_respuesta' && n > 0 && datos !== null;
  return (
    <section className="cit-recuperar" aria-label={tr("Recuperación de citas")}>
      <span className="cit-recuperar-icono" aria-hidden="true">
        <IconoEsc nombre="rotate-ccw" size={19} />
      </span>
      <div className="cit-recuperar-texto">
        {pendiente && reg ? (
          <>
            <h3>{tr("Recuperación de citas")}</h3>
            <p role="status">{avanceDeRecuperacion(reg)}</p>
            {reg.fase === 'juez' && reg.total > 0 && <progress value={reg.revisadas} max={reg.total} aria-label={tr("Afirmaciones vueltas a juzgar")} />}
          </>
        ) : cuenta === 'sin_respuesta' ? (
          <>
            <h3>{tr("Recuperación de citas")}</h3>
            <p className="cit-nota" role="status">
              {tr("No pude contar las afirmaciones por recuperar: el servidor no respondió. No quiere decir que no las haya.")}
            </p>
          </>
        ) : ofrece && datos ? (
          <>
            <h3>
              {plural(n, tr('afirmación espera volver a juzgarse'), tr('afirmaciones esperan volver a juzgarse'))} <span>{tr("en toda la investigación")}</span>
            </h3>
            <p>
              {porQue}. {tr("Es evidencia ya leída que hoy no cuenta para ninguna hipótesis.")}
              {datos.corridasVivas ? ` ${tr("Hay una corrida trabajando en esta investigación: empezará cuando pare.")}` : ''}
            </p>
          </>
        ) : (
          <h3>{tr("Recuperación de citas")}</h3>
        )}
        {terminada && reg && (
          <div className="cit-recuperar-informe">
            <p className="cit-tenue">
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
      </div>
      {ofrece && (
        <div className="cit-recuperar-accion">
          <button type="button" className="cit-boton cit-boton-acento" onClick={() => void pedir()} {...atributosEnVuelo(enVuelo)} title={tr(EXPLICA_RECUPERAR)}>
            <IconoEsc nombre="rotate-ccw" size={13} />
            {enVuelo ? tr('Pidiendo...') : trp("Recuperar las {n}", { n: formatearEntero(n) })}
          </button>
          <span>{tr("una llamada al juez por afirmación · en segundo plano")}</span>
        </div>
      )}
    </section>
  );
}

/** Una de las dos señales de hoy en el banco: cuántas la cumplen, en barra. */
function Medida({ etiqueta, n, total }: { etiqueta: string; n: number; total: number }) {
  const p = total ? Math.min(1, n / total) : 0;
  // El color dice cuánto falta: casi todas en verde, la mitad en ámbar, menos en rojo.
  const tono: Tono = p >= 0.9 ? 'bien' : p >= 0.5 ? 'medio' : 'mal';
  return (
    <div className={`cit-medida cit-${tono}`}>
      <p>
        <IconoEsc nombre={tono === 'mal' ? 'x' : 'check'} size={14} />
        {etiqueta}
      </p>
      <div className="cit-medida-fila">
        <span className="cit-pista" aria-hidden="true">
          <span style={{ width: `${p * 100}%` }} />
        </span>
        <b>{trp("{n} de {total}", { n: formatearEntero(n), total: formatearEntero(total) })}</b>
      </div>
    </div>
  );
}

/** La franja de pruebas del banco: a qué resuelven las citas, las dos señales
 *  medidas hoy y los veredictos que se tomaron al extraerlas. */
function FranjaPruebas({ resumen }: { resumen: ResumenCitas }) {
  const clases = CLASES.map((c) => ({ ...c, n: resumen.porClase?.[c.clase] ?? 0 })).filter((c) => c.n > 0);
  const veredictos = Object.entries(resumen.porVeredicto ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a, na], [b, nb]) => {
      const ia = ORDEN_VEREDICTOS.indexOf(a);
      const ib = ORDEN_VEREDICTOS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || nb - na;
    });
  const fila = ([v, n]: [string, number]) => (
    <li key={v} className={`cit-${tonoDe(v)}`}>
      <i className="cit-punto" aria-hidden="true" />
      <span>{enLlanoElVeredicto(v).texto}</span>
      <b>{formatearEntero(n)}</b>
    </li>
  );
  // Bloqueadas con la cita en orden que no son de las que ya no bloquearían:
  // las frena otra comprobación, no la cita.
  const otras = (resumen.bloqueadasConCitaEnOrden ?? 0) - (resumen.bloqueosViejos ?? 0);
  return (
    <div className="cit-franja">
      <div className="cit-franja-parte">
        <p className="cit-kicker">{tr("A qué resuelven")}</p>
        <div className="cit-barra" role="img" aria-label={clases.map((c) => `${tr(c.etiqueta)}: ${formatearEntero(c.n)}`).join(', ')}>
          {clases.map((c) => (
            <span key={c.clase} className={`cit-seg cit-clase-${c.clase}`} style={{ flexGrow: c.n }} />
          ))}
        </div>
        <ul className="cit-leyenda">
          {clases.map((c) => (
            <li key={c.clase}>
              <span>
                <i className={`cit-punto cit-clase-${c.clase}`} aria-hidden="true" />
                {tr(c.etiqueta)}
              </span>
              <b className={c.clase === 'pagina' ? 'cit-fuerte' : undefined}>{formatearEntero(c.n)}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="cit-franja-parte cit-hoy" title={tr(META)}>
        <p className="cit-kicker">{tr("Hoy, con las reglas de hoy")}</p>
        <Medida etiqueta={tr("Apunta a un sitio que existe")} n={resumen.resuelvenHoy ?? 0} total={resumen.total} />
        <Medida etiqueta={tr("El pasaje está ahí, literal")} n={resumen.literalesHoy ?? 0} total={resumen.total} />
      </div>
      <div className="cit-franja-parte cit-veredictos">
        <p className="cit-kicker">{tr("Veredicto al extraerlas")}</p>
        <div className="cit-rejilla">
          <ul>{veredictos.filter(([v]) => tonoDe(v) !== 'mal').map(fila)}</ul>
          <ul>{veredictos.filter(([v]) => tonoDe(v) === 'mal').map(fila)}</ul>
        </div>
        {otras > 0 && <p className="cit-franja-nota">{plural(otras, tr('tiene la cita en orden y sigue bloqueada por otra comprobación'), tr('tienen la cita en orden y siguen bloqueadas por otra comprobación'))}.</p>}
      </div>
    </div>
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
  const bloqueosViejos = resumen?.bloqueosViejos ?? 0;
  // Las fuentes distintas de las que salen las afirmaciones de la corrida.
  const fuentes = useMemo(() => new Set((lista?.afirmaciones ?? []).map((a) => a.fuenteId ?? a.referencia)).size, [lista]);
  const numero = corridas.find((c) => c.id === corridaId)?.numero ?? null;

  const chip = (clave: typeof filtro, etiqueta: string, n: number, title?: string) => (
    <button type="button" className="cit-chip" aria-pressed={filtro === clave} onClick={() => setFiltro(clave)} title={title}>
      {etiqueta} <span className="cit-chip-cifra">{formatearEntero(n)}</span>
    </button>
  );

  return (
    <div className="contenido contenido-ancho cit-pagina">
      <AvisoMuestra conexion={estado.conexion} />
      <section className="cit-banco" aria-label={tr("Citas")}>
        <div className="cit-banco-arriba">
          <div className="cit-etiquetas">
            <span className="cit-pill">
              <IconoEsc nombre="quote" size={13} />
              {tr("Citas comprobadas")}
            </span>
            {resumen && (
              <span className="cit-cuenta">
                {plural(fuentes, tr('fuente'), tr('fuentes'))} <span aria-hidden="true">·</span> {plural(resumen.total, tr('afirmación'), tr('afirmaciones'))}
              </span>
            )}
          </div>
          {corridas.length > 1 ? (
            <label className="cit-selector">
              <span>{tr("Corrida")}</span>
              <select value={corridaId} onChange={(e) => setCorridaId(e.target.value)} aria-label={tr("Elegir corrida")}>
                {corridas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero ?? '?'}
                  </option>
                ))}
              </select>
              <IconoEsc nombre="chevron-down" size={14} />
            </label>
          ) : (
            numero !== null && (
              <span className="cit-selector">
                <span>{tr("Corrida")}</span>
                <b>{numero}</b>
              </span>
            )
          )}
        </div>
        <div className="cit-banco-cuerpo">
          <div className="cit-titular">
            <h2>{tr("Cada afirmación, en la página donde se comprobó")}</h2>
            <p>{tr(AYUDA)}</p>
          </div>
          {resumen && resumen.total > 0 && (
            <div className="cit-cifra">
              <div className="cit-cifra-fila">
                <b>{formatearEntero(resumen.conPagina)}</b>
                <span>
                  <span className="cit-cifra-de">{trp("de {total}", { total: formatearEntero(resumen.total) })}</span>
                  <span className="cit-cifra-que">{tr("a página exacta del PDF")}</span>
                </span>
              </div>
              {resumen.conPagina < resumen.total && <p>{tr("El resto se apoya en el resumen, una sección o el texto web, y lo dice: sin número de página.")}</p>}
            </div>
          )}
        </div>
        {resumen && resumen.total > 0 ? <FranjaPruebas resumen={resumen} /> : fase === 'cargando' ? <Esqueleto ancho="100%" alto={128} radio={16} /> : null}
      </section>

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
        <div className="cit-mesa">
          <section className="cit-tarjeta cit-lista-tarjeta" aria-label={tr("Afirmaciones de la corrida")}>
            <header className="cit-lista-cab">
              <div className="cit-lista-h">
                <h3>{tr("Afirmaciones")}</h3>
                {numero !== null && <span>{trp("de la corrida {n}", { n: numero })}</span>}
              </div>
              <div className="cit-filtros" role="group" aria-label={tr("Filtrar afirmaciones")}>
                {chip('todas', tr("Todas"), resumen?.total ?? 0)}
                {chip('sostenidas', tr("Sostenidas"), sostenidas)}
                {chip('fallidas', tr("Fallidas"), fallidas)}
                {chip('pagina', tr("Con página"), resumen?.conPagina ?? 0)}
                {bloqueosViejos > 0 && chip('rancias', tr("Ya no bloquearían"), bloqueosViejos, tr("Bloqueadas con una versión anterior del verificador: hoy el verificador entero ya no las bloquearía"))}
              </div>
              {bloqueosViejos > 0 && (
                <div className="cit-recuperar-fila">
                  <span>{plural(bloqueosViejos, tr('se juzgó con reglas viejas'), tr('se juzgaron con reglas viejas'))}</span>
                  {!recuperacionPendiente && (
                    <button type="button" className="cit-enlace" onClick={() => void recuperar()} {...atributosEnVuelo(enVuelo)} title={tr("Vuelve a juzgarlas, enlaza a las hipótesis las que salgan sostenidas y rehace sus conclusiones")}>
                      {enVuelo ? tr('Pidiendo...') : trp("Recuperar las {n}", { n: formatearEntero(bloqueosViejos) })}
                      <IconoEsc nombre="chevron-right" size={13} />
                    </button>
                  )}
                </div>
              )}
            </header>
            {recuperacion && (
              <p className="cit-nota cit-recuperacion" role="status">
                {recuperacion}
              </p>
            )}
            <div className="citas-lista cit-lista">
              {fase === 'cargando' ? (
                <div className="cit-esqueleto" aria-busy="true">
                  <span className="sr-only">{tr("Cargando las citas")}</span>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="cit-fila-esqueleto">
                      <Esqueleto ancho="90%" alto={15} />
                      <Esqueleto ancho="55%" alto={12} />
                    </div>
                  ))}
                </div>
              ) : afirmaciones.length === 0 ? (
                <p className="cit-nota cit-vacio">{tr("Ninguna afirmación con ese filtro.")}</p>
              ) : (
                afirmaciones.map((a) => <FilaAfirmacion key={a.id} a={a} elegida={a.id === elegida} onElegir={() => setElegida(a.id)} />)
              )}
            </div>
            {fase === 'listo' && resumen && (
              <footer className="cit-lista-pie">
                <IconoEsc nombre="list" size={13} />
                {trp("{n} de {total}", { n: formatearEntero(afirmaciones.length), total: formatearEntero(resumen.total) })} · {tr("la lista se desplaza por dentro")}
              </footer>
            )}
          </section>

          <section className="cit-tarjeta cit-fuente" aria-label={tr("La fuente y su página")}>
            {cargandoFicha || fase === 'cargando' ? (
              <div aria-busy="true" className="cit-fuente-cargando">
                <span className="sr-only">{tr("Cargando la página de la fuente")}</span>
                <Esqueleto ancho="70%" alto={22} />
                <Esqueleto ancho="40%" alto={14} />
                <Esqueleto ancho="100%" alto={420} radio={14} />
              </div>
            ) : ficha ? (
              <Ficha ficha={ficha} corridaId={corridaId} />
            ) : (
              <p className="cit-nota">{tr("Elige una afirmación de la izquierda para ver dónde se comprobó.")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Cómo se apoya la cita, en corto: PDF si va a una página del PDF, «sin pág.»
 *  si no. La frase entera va en el title. */
function ClaseChip({ a }: { a: AfirmacionCitada }) {
  const pagina = a.clase === 'pagina';
  return (
    <span className={`cit-clase${pagina ? ' cit-clase-con-pagina' : ''}`} title={enLlanoLaClase(a.clase, a.localizador)}>
      <IconoEsc nombre={iconoDeClase(a.clase)} size={11} />
      <span aria-hidden="true">{pagina ? (a.conPdf ? 'PDF' : tr('pág.')) : tr('sin pág.')}</span>
      <span className="sr-only" data-sin-traducir>{enLlanoLaClase(a.clase, a.localizador)}</span>
    </span>
  );
}

// El localizador de una cita (`a.cita`) NO se traduce: es la referencia al
// sitio exacto del documento fuente, y tiene que coincidir con él letra por
// letra para que la cita resuelva. Traducir «Results section» cambiaría el
// localizador por uno que no existe en el PDF.
function FilaAfirmacion({ a, elegida, onElegir }: { a: AfirmacionCitada; elegida: boolean; onElegir: () => void }) {
  return (
    <button type="button" className={`citas-af cit-fila${elegida ? ' cit-elegida' : ''}`} aria-current={elegida ? 'true' : undefined} onClick={onElegir}>
      <span className="cit-fila-texto">{a.texto}</span>
      <span className="cit-fila-meta">
        <VeredictoPunto veredicto={a.veredicto} />
        <span className="cit-fila-cita" data-sin-traducir>{a.cita}</span>
        <ClaseChip a={a} />
      </span>
      {Boolean(a.bloqueoViejo) && (
        <span className="cit-rancia">
          <IconoEsc nombre="rotate-ccw" size={11} />
          {a.veredicto === 'cita_no_resuelve' && a.hoy?.resuelve ? tr("ya no bloquearía: hoy la cita resuelve") : tr("ya no bloquearía")}
        </span>
      )}
    </button>
  );
}

/** Las dos señales, cada una con su sí o su no. Nunca se funden en una: son
 *  preguntas distintas y la respuesta a una no implica la otra. */
function Senales({ hoy, clase, localizador }: { hoy: ComprobacionDeHoy; clase: FichaCita['clase']; localizador: string }) {
  if (hoy.disponible === false) return <p className="cit-tenue">{hoy.motivoResuelve}</p>;
  const senal = (ok: boolean, titulo: string, detalle: React.ReactNode) => (
    <li>
      <span className={`cit-check cit-${ok ? 'bien' : 'mal'}`} aria-hidden="true">
        <IconoEsc nombre={ok ? 'check' : 'x'} size={12} />
      </span>
      <span className="cit-senal-texto">
        <b>{titulo}</b> <span>{detalle}</span>
      </span>
    </li>
  );
  return (
    <ul className="cit-senales">
      {senal(hoy.resuelve, tr("La cita apunta a un sitio que existe."), hoy.resuelve ? <span data-sin-traducir>{enLlanoLaClase(clase, localizador)}</span> : hoy.motivoResuelve)}
      {senal(hoy.literal, tr("El pasaje está ahí, literal."), hoy.literal ? tr('Entero y en orden, tras normalizar tipografía y números de línea.') : hoy.resuelve ? tr('Falta un tramo del pasaje en la fuente.') : tr('No se pudo comprobar: la cita no resuelve.'))}
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
  const metas = [ficha.fuente.referencia, ficha.fuente.anio && !ficha.fuente.referencia.includes(String(ficha.fuente.anio)) ? String(ficha.fuente.anio) : '', ficha.fuente.doi ? `doi:${ficha.fuente.doi}` : '', ficha.fuente.tipoEstudio && ficha.fuente.tipoEstudio !== 'otro' ? ficha.fuente.tipoEstudio : ''].filter(Boolean);
  const verPagina = ficha.conPdf;
  const abrirPdf = ficha.conPdf && alPasaje;
  const verFicha = enLaFuente && enLaFuente !== alPasaje;
  const juezPendiente = ficha.veredictoDeHoy && !ficha.veredictoDeHoy.bloquea && ficha.veredictoDeHoy.veredicto === 'sin_verificar';
  return (
    <>
      <div className="cit-fuente-cab">
        <div className="cit-fuente-titulo">
          <p className="cit-kicker">{tr("La fuente")}</p>
          <h4 title={ficha.fuente.titulo || ficha.fuente.referencia}>{ficha.fuente.titulo || ficha.fuente.referencia}</h4>
          <p className="cit-fuente-meta">
            {metas.map((m, i) => (
              <span key={i}>
                {i > 0 && (
                  <span className="cit-sep" aria-hidden="true">
                    ·{' '}
                  </span>
                )}
                {m}
              </span>
            ))}
          </p>
          {ficha.fuente.retraccion && <p className="cit-retraccion">{tr("Esta fuente está retractada.")}</p>}
        </div>
        <div className="cit-loc">
          <span className={`cit-loc-chip${ficha.clase === 'pagina' ? ' cit-loc-pagina' : ''}`} title={enLlanoLaClase(ficha.clase, ficha.localizador)} data-sin-traducir>
            <IconoEsc nombre={iconoDeClase(ficha.clase)} size={13} />
            {ficha.clase === 'pagina' && ficha.conPdf && ficha.pagina !== null ? trp("pág. {pagina} del PDF", { pagina: ficha.pagina }) : etiquetaLocalizador(ficha.localizador) || tr('sin localizador')}
          </span>
          {(ficha.clase !== 'pagina' || ficha.leidos.length > 1) && (
            <span className="cit-tenue">
              {[ficha.clase !== 'pagina' ? tr('sin número de página') : '', ficha.leidos.length > 1 ? plural(ficha.leidos.length, tr('sitio leído de esta fuente'), tr('sitios leídos de esta fuente')) : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {ficha.leidos.length > 1 && (
        <div className="cit-leidos">
          <span className="cit-tenue">{tr("Se leyeron")}</span>
          <span className="cit-leidos-lista">
            {ficha.leidos.map((l) => (
              <span key={l.localizador} className={`cit-leido${l.pagina !== null ? ' cit-leido-num' : ''}${l.actual ? ' cit-actual' : ''}`} aria-current={l.actual ? 'true' : undefined} data-sin-traducir>
                {l.pagina ?? etiquetaLocalizador(l.localizador)}
              </span>
            ))}
          </span>
        </div>
      )}

      {ficha.conPdf && (
        <div className="cit-vistas" role="group" aria-label={tr("Cómo ver la página")}>
          <button type="button" className={vista === 'texto' ? 'cit-activa' : undefined} onClick={() => cambiarVista('texto')} aria-pressed={vista === 'texto'}>
            <IconoEsc nombre="type" size={13} />
            {tr("Texto leído")}
          </button>
          <button type="button" className={vista === 'pagina' ? 'cit-activa' : undefined} onClick={() => cambiarVista('pagina')} aria-pressed={vista === 'pagina'}>
            <IconoEsc nombre="image" size={13} />
            {ficha.pagina !== null ? trp("Página {pagina} del PDF", { pagina: ficha.pagina }) : tr('Página del PDF')}
          </button>
        </div>
      )}

      {vista === 'pagina' && ficha.conPdf ? (
        <div className="cit-hoja cit-hoja-pdf">
          <img
            className="cit-pagina-img"
            src={acciones.paginaDeCita(corridaId, ficha.afirmacion.id)}
            alt={ficha.completo ? trp("Página {v} del PDF con el pasaje citado marcado en naranja", { v: ficha.pagina ?? '' }) : trp("Página {v} del PDF, sin marcar: el pasaje no se encontró en ella", { v: ficha.pagina ?? '' })}
          />
        </div>
      ) : ficha.texto ? (
        <div className="cit-hoja" ref={hoja}>
          <p className="cit-hoja-cab">
            <span className="cit-hoja-encabezado">{ficha.encabezado}</span>
            <span data-sin-traducir>{etiquetaLocalizador(ficha.localizador)}</span>
          </p>
          <p className="cit-hoja-texto">
            {trozos.map((t, i) => (t.marcado ? <mark key={i}>{t.texto}</mark> : <span key={i}>{t.texto}</span>))}
          </p>
          {ficha.pagina !== null && <p className="cit-hoja-num">{ficha.pagina}</p>}
        </div>
      ) : (
        <p className="cit-nota">{tr("De esta fuente no se guardó el texto de ese localizador, así que no puedo enseñar dónde estaba el pasaje.")}</p>
      )}
      {vista === 'pagina' && ficha.conPdf && !ficha.completo && (
        <p className="cit-nota">{tr("El pasaje no está en esta página, así que no hay nada que marcar. La página se enseña igual, para poder comprobarlo.")}</p>
      )}

      <div className="cit-acciones">
        {verPagina ? (
          <button type="button" className="cit-boton cit-boton-acento cit-boton-ancho" onClick={() => cambiarVista('pagina')}>
            <IconoEsc nombre="scan-search" size={14} />
            {ficha.pagina !== null ? trp("Ver la cita marcada en la página {pagina}", { pagina: ficha.pagina }) : tr('Ver la cita marcada en la página')}
          </button>
        ) : (
          alPasaje && (
            <a className="cit-boton cit-boton-acento cit-boton-ancho" href={alPasaje} target="_blank" rel="noreferrer">
              <IconoEsc nombre="scan-search" size={14} />
              {tr("Ver la cita en la fuente")}
            </a>
          )
        )}
        {(abrirPdf || verFicha) && (
          <div className="cit-acciones-sec">
            {abrirPdf && (
              <a className="cit-boton" href={alPasaje} target="_blank" rel="noreferrer">
                <IconoEsc nombre="external-link" size={14} />
                {tr("Abrir el PDF entero")}
              </a>
            )}
            {verFicha && (
              <a className="cit-boton" href={enLaFuente} target="_blank" rel="noreferrer">
                <IconoEsc nombre="book-open" size={14} />
                {tr("Ficha del artículo")}
              </a>
            )}
          </div>
        )}
      </div>
      {ficha.conPdf ? (
        <p className="cit-tenue cit-indicacion">
          {trp("La marca la pinta ROSA2018 sobre la página: el visor de PDF del navegador solo sabe abrir por una página, no resaltar, así que abrir el PDF entero lleva a la página {v} sin marcar.", { v: ficha.pagina ?? '' })}</p>
      ) : (
        alPasaje && <p className="cit-tenue cit-indicacion">{tr("El navegador salta solo hasta el pasaje y lo resalta. Si la página ha cambiado desde que ROSA2018 la leyó, se abrirá por el principio.")}</p>
      )}

      <div className="cit-comparacion">
        <div className="cit-comp-dijo">
          <p className="cit-kicker">{tr("Lo que dijo ROSA2018")}</p>
          <p className="cit-comp-afirmacion">«{ficha.afirmacion.texto}»</p>
          <p className={`cit-pastilla cit-${tonoDe(ficha.afirmacion.veredicto)}`}>
            <span className="sr-only">{tr("Veredicto al extraerla:")} </span>
            <i className="cit-punto" aria-hidden="true" />
            {enLlanoElVeredicto(ficha.afirmacion.veredicto).texto}
          </p>
          {ficha.afirmacion.motivo && <p className="cit-comp-motivo">{ficha.afirmacion.motivo}</p>}
        </div>
        <div className="cit-comp-hoy">
          <p className="cit-kicker">{tr("Lo que se comprueba hoy")}</p>
          <Senales hoy={hoy} clase={ficha.clase} localizador={ficha.localizador} />
          {!hoy.literal && hoy.falta && (
            <p className="cit-comp-falta">
              {tr("No está en la fuente:")} <span className="citas-falta">{hoy.falta}</span>
            </p>
          )}
          {Boolean(ficha.bloqueoViejo) && (
            <p className="cit-aviso cit-aviso-ambar cit-rancio">
              {tr("Esta afirmación quedó bloqueada con una versión anterior del verificador y hoy ya no lo estaría. Con «Reverificar» se vuelve a juzgar y su veredicto se actualiza.")}
            </p>
          )}
          {!ficha.bloqueoViejo && hoy.resuelve && hoy.literal && ficha.veredictoDeHoy?.bloquea && (
            <p className="cit-aviso cit-sigue">
              {trp("La cita está en orden, pero la afirmación sigue bloqueada hoy por otra comprobación: {motivo}", { motivo: ficha.veredictoDeHoy.motivo })}
            </p>
          )}
          {juezPendiente && (
            <p className="cit-aviso cit-aviso-juez">
              <IconoEsc nombre="hourglass" size={13} />
              {tr("Pendiente del juez: sin verificar hoy, no bloquea.")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
