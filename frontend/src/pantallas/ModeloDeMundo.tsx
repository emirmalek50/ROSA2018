// El explorador del modelo de mundo: qué se sabe (con procedencia hasta la
// página y las citas que apoyan, mencionan o contrastan cada hecho), qué está
// abierto y qué se descartó (con su motivo). Con la cobertura de la búsqueda
// por tema, la vista "qué cambió", preguntar al modelo de mundo (responde
// solo con lo que hay dentro) y recomprobar retractaciones.
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado (cientos de hechos: mapas por id, temas, fuentes con su
// PMID, movimientos) se calcula DESPUÉS de pintar la silueta de la pantalla
// (lib/diferido.ts, useCalculoDiferido). Así, al abrirla o al cambiar de
// investigación se ve un esqueleto con la forma de la cabecera y de las tres
// columnas, no una pantalla congelada o vacía. Una actualización del canal en
// vivo no enseña esqueleto: se conserva lo calculado hasta que llega lo nuevo,
// un fotograma después.

import { useState } from 'react';
import { acciones } from '../datos/almacen';
import { preguntarAlModeloDeMundo, type CitaComprobable } from '../datos/acciones';
import type { Corrida, EstadoRosa, Fuente, HechoMundo, Investigacion, MovimientoHecho } from '../datos/tipos';
import { AvisoMuestra, Chip, Momento, Seccion } from '../componentes/piezas';
import { Cargando, Esqueleto, EsqueletoTarjeta } from '../componentes/Esqueleto';
import { IconChevronDown } from '../componentes/icons';
import { Entidades, PreguntarALasBases, RelacionesCausales } from '../componentes/Rosa2018';
import { ElementoAnimado, ListaAnimada } from '../componentes/Animado';
import { COBERTURA_MINIMA, faltanParaCobertura } from '../lib/cobertura';
import { useCalculoDiferido } from '../lib/diferido';
import { CLASIFICACION_CITA, ESTADO_HECHO, TIPO_HECHO, nombreActor } from '../lib/etiquetas';
import { formatearPorcentaje } from '../lib/formato';
import { tr } from '../lib/idioma';

function CitasDelHecho({ h }: { h: HechoMundo }) {
  const [abierto, setAbierto] = useState(false);
  if (h.citas.length === 0) return null;
  const n = { apoya: 0, menciona: 0, contrasta: 0 };
  for (const c of h.citas) n[c.clasificacion]++;
  return (
    <div>
      <button type="button" className="citas-badge" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} title={tr("Otras fuentes sobre este hecho: apoyan, mencionan, contrastan")}>
        <span className="tono-ok">{n.apoya} apoyan</span>
        <span className="meta">{n.menciona} mencionan</span>
        <span className={n.contrasta > 0 ? 'tono-mal' : 'meta'}>{n.contrasta} contrastan</span>
        <IconChevronDown size={11} style={{ transform: abierto ? 'rotate(180deg)' : 'none' }} />
      </button>
      {abierto && (
        <ul className="mundo-citas-lista">
          {h.citas.map((c, i) => (
            <li key={i} className={`cita-${c.clasificacion}`}>
              <div className="acciones" style={{ gap: 6 }}>
                <Chip tono={c.clasificacion === 'apoya' ? 'ok' : c.clasificacion === 'contrasta' ? 'mal' : undefined}>{CLASIFICACION_CITA[c.clasificacion]}</Chip>
                <strong style={{ fontSize: 12.5 }}>{c.referencia}</strong>
                <span className="meta">{c.seccion}</span>
              </div>
              <p style={{ fontSize: 13, marginTop: 4 }}>{c.fragmento}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaHecho({ h, ahora, fuentes, porId }: { h: HechoMundo; ahora: number; fuentes?: Map<string, Fuente>; porId?: Map<string, HechoMundo> }) {
  return (
    <div className="hecho">
      <div className="hecho-cabecera">
        <Chip tono={h.tipo === 'hipotesis' ? 'acento' : undefined}>{TIPO_HECHO[h.tipo]}</Chip>
        {h.tema !== TIPO_HECHO[h.tipo] && <Chip tono="borde">{h.tema}</Chip>}
        <Chip tono={h.origen === 'fuente' ? undefined : 'aviso'} title={h.origen === 'fuente' ? tr('Lo dice la fuente citada') : tr('Lo infiere ROSA2018; no es una cita')}>
          {h.origen === 'fuente' ? tr('Dice la fuente') : tr('Inferencia de ROSA2018')}
        </Chip>
      </div>
      <p>{h.enunciado}</p>
      <Entidades entidades={h.entidades} maximo={6} />
      {h.procedencia.length > 0 && (
        <div className="hecho-procedencia">
          {h.procedencia.map((p, i) => {
            const f = fuentes?.get(p.fuenteId);
            const texto = `[${p.referencia}${p.pagina !== null ? `, pág. ${p.pagina}` : ''}]`;
            const href = f?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${f.pmid}/` : f?.doi ? `https://doi.org/${f.doi}` : null;
            return href ? (
              <a key={i} className="enlace" href={href} target="_blank" rel="noreferrer" title={`${f?.titulo ?? ''}${f?.pmid ? ` · PMID ${f.pmid}` : ''}${f?.doi ? ` · doi:${f.doi}` : ''}. Se abre en PubMed o en el DOI: comprobable fuera de ROSA2018.`}>
                <code>{texto}</code>
              </a>
            ) : (
              <code key={i} title={tr("Fuente sin identificador registrado")}>
                {texto}
              </code>
            );
          })}
        </div>
      )}
      <CitasDelHecho h={h} />
      {h.motivoDescarte && <p className="hecho-motivo">{h.motivoDescarte}</p>}
      <EnlacesDelHecho h={h} porId={porId} />
      {h.pendienteRevision && (
        <p className="hecho-pendiente">
          <Chip tono="aviso" title={tr("Algo de lo que este hecho depende cambió (una fuente se retractó, otro hecho lo sustituyó o lo contradijo). ROSA2018 lo marca; una persona lo revisa.")}>
            {tr("Pendiente de revisar")}
          </Chip>{' '}
          {h.pendienteRevision.detalle}{' '}
          <button type="button" className="btn btn-s" onClick={() => acciones.atenderPendiente('hecho', h.id, tr('revisado en el modelo de mundo'))}>
            {tr("Ya lo revisé")}
          </button>
        </p>
      )}
      <span className="meta">
        <Momento t={h.actualizadoEn} ahora={ahora} />
        {h.historial.length > 1 && ` · ${h.historial.length} movimientos`}
        {(h.afirmacionIds?.length ?? 0) > 0 && ` · ${h.afirmacionIds!.length} ${h.afirmacionIds!.length === 1 ? tr('afirmación lo sostiene') : tr('afirmaciones lo sostienen')}`}
      </span>
    </div>
  );
}

/** Cuántos hechos se pintan de una columna antes de pedir más (28 de
 *  septiembre de 2026). Esta investigación tiene 424 hechos y se pintaban
 *  todos: la página medía unos 71.000 píxeles de alto, que nadie recorre, y
 *  el navegador montaba 424 tarjetas con sus citas y su procedencia para
 *  enseñar las diez primeras. */
const HECHOS_POR_TANDA = 15;

/** Una columna del modelo de mundo con su tanda: las primeras y un botón que
 *  trae las siguientes. El recuento del encabezado sigue siendo el total, que
 *  es el dato que importa. */
function ColumnaDeHechos({ col, lista, conFiltro, ahora, fuentes, porId }: { col: HechoMundo['estado']; lista: HechoMundo[]; conFiltro: boolean; ahora: number; fuentes: Map<string, Fuente>; porId: Map<string, HechoMundo> }) {
  const [cuantos, setCuantos] = useState(HECHOS_POR_TANDA);
  // Al cambiar el filtro se vuelve a la primera tanda: si no, un filtro que
  // deja tres resultados seguiría diciendo "ver los otros 200".
  const visibles = lista.slice(0, cuantos);
  const faltan = lista.length - visibles.length;
  return (
    <section className="mundo-columna" aria-label={ESTADO_HECHO[col]}>
      <h3>
        {ESTADO_HECHO[col]} <span className="nav-cuenta">{lista.length}</span>
      </h3>
      {lista.length === 0 ? (
        <p className="meta">{tr("Nada aquí")}{conFiltro ? tr(' con este filtro') : ''}.</p>
      ) : (
        <>
          <ListaAnimada className="mundo-tarjetas" como="ul">
            {visibles.map((h) => (
              <ElementoAnimado key={h.id} como="li">
                <TarjetaHecho h={h} ahora={ahora} fuentes={fuentes} porId={porId} />
              </ElementoAnimado>
            ))}
          </ListaAnimada>
          {faltan > 0 && (
            <button type="button" className="btn btn-s mundo-mas" onClick={() => setCuantos((n) => n + HECHOS_POR_TANDA * 2)}>
              Ver {faltan <= HECHOS_POR_TANDA * 2 ? `los otros ${faltan}` : `${HECHOS_POR_TANDA * 2} más`} de {lista.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Los enlaces del grafo entre hechos: a quién sustituye, quién lo sustituyó, qué
 *  preguntas respondió y con qué choca. Un hecho sustituido no se borra: queda aquí. */
function EnlacesDelHecho({ h, porId }: { h: HechoMundo; porId?: Map<string, HechoMundo> }) {
  const nombre = (id: string) => porId?.get(id)?.enunciado.slice(0, 90) ?? id;
  type Fila = { etiqueta: string; ids: string[]; tono: 'ok' | 'mal' | 'aviso' | 'borde' };
  const todas: Fila[] = [
    { etiqueta: tr('Sustituye a'), ids: h.sustituyeA ?? [], tono: 'borde' },
    { etiqueta: tr('Sustituido por'), ids: h.sustituidoPor ? [h.sustituidoPor] : [], tono: 'aviso' },
    { etiqueta: tr('Responde a'), ids: h.resuelveA ?? [], tono: 'ok' },
    { etiqueta: tr('Choca con'), ids: h.contradiceA ?? [], tono: 'mal' },
  ];
  const filas = todas.filter((f) => f.ids.length > 0);
  if (filas.length === 0) return null;
  return (
    <ul className="hecho-enlaces">
      {filas.map((f) => (
        <li key={f.etiqueta}>
          <Chip tono={f.tono}>{f.etiqueta}</Chip> {f.ids.map(nombre).join('; ')}
        </li>
      ))}
    </ul>
  );
}

const TITULO = 'Modelo de mundo';
const DESCRIPCION = 'La memoria estructurada de la investigación. Cada hecho lleva su procedencia hasta la página y las fuentes que lo apoyan o contradicen; cada descarte, su motivo.';
const COLUMNAS: HechoMundo['estado'][] = ['sabido', 'abierto', 'descartado'];

/** Lo que la pantalla deriva del estado para una investigación. Se calcula
 *  fuera del render (useCalculoDiferido): con cientos de hechos cuesta lo
 *  bastante como para congelar la pantalla si se hiciera antes de pintar. */
type BaseMundo = {
  invId: string;
  /** Las fuentes con su PMID y DOI, por id, para que cada cita se pueda comprobar fuera de ROSA2018. */
  fuentesPorId: Map<string, Fuente>;
  /** Los hechos de esta investigación. */
  propios: HechoMundo[];
  porId: Map<string, HechoMundo>;
  temas: string[];
  /** La última corrida, de donde salen las coberturas por tema. */
  corrida: Corrida | null;
  /** Movimientos entre estados desde la última visita, del más reciente al más viejo. */
  movimientos: { h: HechoMundo; m: MovimientoHecho }[];
  /** Cuántos hechos tienen alguna cita que los contrasta. */
  contrastados: number;
};

function derivar(estado: EstadoRosa, invId: string): BaseMundo {
  const fuentesPorId = new Map<string, Fuente>();
  for (const h of estado.hipotesis) if (h.investigacionId === invId) for (const f of h.procedencia.fuentes) if (!fuentesPorId.has(f.id)) fuentesPorId.set(f.id, f);
  const propios = estado.hechos.filter((h) => h.investigacionId === invId);
  const porId = new Map(propios.map((h) => [h.id, h]));
  const temas = [...new Set(propios.map((h) => h.tema))].sort();
  const corrida = estado.corridas.filter((c) => c.investigacionId === invId).sort((a, b) => b.numero - a.numero)[0] ?? null;
  const desde = estado.ultimaVisita;
  const movimientos = propios
    .flatMap((h) => h.historial.map((m) => ({ h, m })))
    .filter((x) => desde === null || x.m.fecha > desde)
    .sort((a, b) => b.m.fecha - a.m.fecha);
  const contrastados = propios.filter((h) => h.citas.some((c) => c.clasificacion === 'contrasta')).length;
  return { invId, fuentesPorId, propios, porId, temas, corrida, movimientos, contrastados };
}

/** La silueta de la pantalla mientras se calcula. La cabecera y la fila de
 *  acciones son las reales con los mandos deshabilitados (son chrome fijo, no
 *  contenido que llega, y así miden exactamente lo mismo y nada salta al
 *  llegar los hechos); debajo, tres secciones plegadas y las tres columnas con
 *  tarjetas en gris, con las clases de la maqueta. */
function SiluetaMundo() {
  return (
    <>
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{TITULO}</h2>
          <p>{tr(DESCRIPCION)}</p>
        </div>
        <div className="filtros" aria-hidden="true">
          <div className="segmentos" role="group" aria-label="Vista">
            <button type="button" aria-pressed disabled>
              Estado
            </button>
            <button type="button" disabled>
              {tr("Qué cambió")}
            </button>
          </div>
          <input className="entrada" placeholder={tr("Buscar en el modelo de mundo")} aria-label="Buscar" disabled readOnly />
          <select className="entrada" aria-label="Tema" style={{ width: 'auto' }} disabled>
            <option>{tr("Todos los temas")}</option>
          </select>
        </div>
      </div>
      <div className="acciones" style={{ marginBottom: 16 }} aria-hidden="true">
        <button type="button" className="btn btn-s" disabled>
          Recomprobar retractaciones ahora
        </button>
        <span className="meta">{tr("Contra Crossref y Retraction Watch. Se hace solo cada 24 h; esto lo adelanta.")}</span>
      </div>
      {['relaciones', 'bases', 'preguntar'].map((s) => (
        <div key={s} className="tarjeta esqueleto-tarjeta" data-esqueleto="seccion" aria-hidden="true">
          <Esqueleto className="esqueleto-titulo" />
        </div>
      ))}
      <div className="mundo-columnas" style={{ marginTop: 28 }} aria-hidden="true">
        {COLUMNAS.map((col) => (
          <section key={col} className="mundo-columna">
            <Esqueleto ancho={110} alto={16} />
            <div className="mundo-tarjetas">
              <EsqueletoTarjeta lineas={3} />
              <EsqueletoTarjeta lineas={2} />
              <EsqueletoTarjeta lineas={3} />
              <EsqueletoTarjeta lineas={2} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function ModeloDeMundo({ inv, estado, ahora }: { inv: Investigacion; estado: EstadoRosa; ahora: number }) {
  const { valor: base } = useCalculoDiferido(() => derivar(estado, inv.id), [estado.hechos, estado.hipotesis, estado.corridas, estado.ultimaVisita, inv.id]);
  // Esqueleto solo al abrir y al cambiar de investigación. Con una actualización
  // del canal en vivo `base` es el cálculo anterior (misma investigación) y se
  // conserva en pantalla hasta que el nuevo llega, un fotograma después.
  const esperando = base === null || base.invId !== inv.id;
  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={estado.conexion} />
      <Cargando activo={esperando} rotulo={tr("el modelo de mundo")} esqueleto={<SiluetaMundo />}>
        {base !== null && <CuerpoMundo inv={inv} estado={estado} ahora={ahora} base={base} />}
      </Cargando>
    </div>
  );
}

/** El contenido de la pantalla una vez calculada la base. Sus filtros y su
 *  pregunta viven aquí: se desmonta al cambiar de investigación, así que
 *  empiezan limpios en cada una. */
function CuerpoMundo({ inv, estado, ahora, base }: { inv: Investigacion; estado: EstadoRosa; ahora: number; base: BaseMundo }) {
  const [busqueda, setBusqueda] = useState('');
  const [tema, setTema] = useState<string>('todos');
  const [vista, setVista] = useState<'columnas' | 'cambios'>('columnas');
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState<{ respuesta: string; nodos: HechoMundo[]; citas: CitaComprobable[] } | null>(null);
  const { fuentesPorId, propios, porId, temas, corrida, movimientos, contrastados } = base;
  const q = busqueda.trim().toLowerCase();
  // Se busca también por identificador canónico y por alias (GFAP, P14136, HGNC:4235
  // encuentran el mismo hecho): el modelo de mundo como grafo consultable.
  const filtrados = propios.filter((h) => (tema === 'todos' || h.tema === tema) && (q === '' || h.enunciado.toLowerCase().includes(q) || h.procedencia.some((p) => p.referencia.toLowerCase().includes(q)) || (h.entidades ?? []).some((x) => x.id.toLowerCase() === q || x.etiqueta.toLowerCase().includes(q) || x.alias.some((a) => a.toLowerCase() === q) || (x.uniprot ?? '').toLowerCase() === q)));
  const orden = (a: HechoMundo, b: HechoMundo) => a.prioridad - b.prioridad || b.actualizadoEn - a.actualizadoEn;
  const coberturas = corrida?.coberturas ?? [];

  return (
    <>
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{TITULO}</h2>
          <p>{tr(DESCRIPCION)}</p>
        </div>
        <div className="filtros">
          <div className="segmentos" role="group" aria-label="Vista">
            <button type="button" aria-pressed={vista === 'columnas'} onClick={() => setVista('columnas')}>
              Estado
            </button>
            <button type="button" aria-pressed={vista === 'cambios'} onClick={() => setVista('cambios')}>
              {tr("Qué cambió")} {movimientos.length > 0 && <span className="nav-cuenta">{movimientos.length}</span>}
            </button>
          </div>
          <input className="entrada" value={busqueda} placeholder={tr("Buscar en el modelo de mundo")} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar" />
          <select className="entrada" value={tema} onChange={(e) => setTema(e.target.value)} aria-label="Tema" style={{ width: 'auto' }}>
            <option value="todos">{tr("Todos los temas")}</option>
            {temas.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="acciones" style={{ marginBottom: 16 }}>
        {contrastados > 0 && (
          <Chip tono="aviso">
            {contrastados} {contrastados === 1 ? tr('hecho con citas que lo contrastan') : tr('hechos con citas que los contrastan')}
          </Chip>
        )}
        <button type="button" className="btn btn-s" onClick={() => acciones.recomprobarRetracciones(inv.id)}>
          Recomprobar retractaciones ahora
        </button>
        <span className="meta">{tr("Contra Crossref y Retraction Watch. Se hace solo cada 24 h; esto lo adelanta.")}</span>
      </div>

      {coberturas.length > 0 && (
        <Seccion detalle titulo={tr("Cobertura de la búsqueda por tema")} nota={`Cuánto de lo relevante se estima encontrado (curva de descubrimiento). Por debajo del ${Math.round(COBERTURA_MINIMA * 100)} % una "ausencia refutada" se degrada a "sin verificar".`}>
          <div className="coberturas">
            {coberturas.map((c) => {
              const faltan = faltanParaCobertura(c, 0.9);
              const baja = c.fraccion < COBERTURA_MINIMA;
              return (
                <div key={c.tema} className="cobertura">
                  <div className="acciones" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>{c.tema}</strong>
                    <span className={baja ? 'tono-aviso' : 'tono-ok'} style={{ fontSize: 12.5 }}>
                      {formatearPorcentaje(c.fraccion)}
                    </span>
                  </div>
                  <div className="presupuesto-barra">
                    <i style={{ width: `${c.fraccion * 100}%`, background: baja ? 'var(--amber)' : 'var(--green)' }} />
                  </div>
                  <span className="meta">
                    {c.leidos} leídos
                    {Number.isFinite(faltan) && faltan > 0 && ` · unos ${faltan} más para el 90 %`}
                  </span>
                  {baja && (
                    <button type="button" className="btn btn-s" onClick={() => corrida && acciones.dirigirCorrida(corrida.id, `Extender la búsqueda del tema "${c.tema}" hasta el 90 % de cobertura (unos ${Number.isFinite(faltan) ? faltan : 'muchos'} artículos más)`)} disabled={!corrida}>
                      {tr("Extender búsqueda")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Seccion>
      )}

      <RelacionesCausales estado={estado} inv={inv} />

      <PreguntarALasBases inv={inv} ahora={ahora} />

      <Seccion titulo={tr("Preguntar al modelo de mundo")} nota={tr("Responde solo con lo que hay dentro, citando los nodos. Si no hay nada, lo dice y no lo inventa.")}>
        <div className="dirigir">
          <input
            className="entrada"
            value={pregunta}
            placeholder={tr("Qué se sabe del cociente p-tau217/Abeta42")}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setRespuesta(preguntarAlModeloDeMundo(estado.hechos, inv.id, pregunta, fuentesPorId));
            }}
            aria-label={tr("Pregunta al modelo de mundo")}
          />
          <button type="button" className="btn" disabled={pregunta.trim() === ''} onClick={() => setRespuesta(preguntarAlModeloDeMundo(estado.hechos, inv.id, pregunta, fuentesPorId))}>
            Preguntar
          </button>
        </div>
        {respuesta && (
          <div className="mensaje" style={{ whiteSpace: 'pre-wrap' }}>
            <header>
              <span>{tr("Modelo de mundo")}</span>
              <span>{respuesta.nodos.length} {respuesta.nodos.length === 1 ? 'nodo' : 'nodos'}</span>
            </header>
            {respuesta.respuesta}
            {respuesta.citas.length > 0 && (
              <ul className="citas-comprobables" aria-label={tr("Fuentes citadas")}>
                {respuesta.citas.map((c) => (
                  <li key={c.fuenteId}>
                    <strong>{c.referencia}</strong>
                    {c.titulo && <span className="meta"> {c.titulo.length > 110 ? `${c.titulo.slice(0, 108)}...` : c.titulo}</span>}{' '}
                    {c.pmid && (
                      <a className="enlace" href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`} target="_blank" rel="noreferrer">
                        PubMed {c.pmid}
                      </a>
                    )}{' '}
                    {c.doi && (
                      <a className="enlace" href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer">
                        doi:{c.doi}
                      </a>
                    )}
                    {!c.pmid && !c.doi && <span className="meta">{tr("sin identificador registrado")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Seccion>

      {vista === 'cambios' ? (
        <Seccion titulo={tr("Qué cambió desde tu última visita")} nota={tr("Movimientos entre sabido, abierto y descartado, con quién los decidió y por qué.")}>
          {movimientos.length === 0 ? (
            <p className="meta">{tr("Nada se movió desde tu última visita.")}</p>
          ) : (
            <ul className="lista-limpia">
              {movimientos.map((x, i) => (
                <li key={`${x.h.id}-${i}`} className="movimiento">
                  <div>
                    <div className="acciones" style={{ gap: 6 }}>
                      {x.m.de !== null && <Chip>{ESTADO_HECHO[x.m.de]}</Chip>}
                      <span className="meta">{x.m.de !== null ? 'a' : tr('nuevo en')}</span>
                      <Chip tono={x.m.a === 'sabido' ? 'ok' : x.m.a === 'descartado' ? 'mal' : 'acento'}>{ESTADO_HECHO[x.m.a]}</Chip>
                      <Chip tono={x.m.quien === 'Rosa' ? undefined : 'borde'}>{nombreActor(x.m.quien)}</Chip>
                    </div>
                    <p style={{ fontSize: 13.5, marginTop: 4 }}>{x.h.enunciado}</p>
                    <p className="meta">{x.m.motivo}</p>
                  </div>
                  <span className="meta">
                    <Momento t={x.m.fecha} ahora={ahora} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      ) : (
        <div className="mundo-columnas" style={{ marginTop: 28 }}>
          {COLUMNAS.map((col) => (
            <ColumnaDeHechos
              key={col}
              col={col}
              lista={filtrados.filter((h) => h.estado === col).sort(orden)}
              conFiltro={q !== '' || tema !== 'todos'}
              ahora={ahora}
              fuentes={fuentesPorId}
              porId={porId}
            />
          ))}
        </div>
      )}
    </>
  );
}
