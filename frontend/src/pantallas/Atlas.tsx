// El atlas de la enfermedad: dónde está la evidencia que ROSA2018 ha reunido,
// pintada sobre un corte SAGITAL del cerebro (visto de lado, partido por la
// mitad, con la frente a la izquierda). Los datos salen de lib/atlas.ts
// (construirAtlas pliega el mapa que el backend guarda al cerrar cada iteración
// por región, con filtros de fase, de tipo de célula y de iteración) y la
// geometría de lib/atlas_dibujo.ts (una figura Bézier por cada región del
// vocabulario de rosa/mapa_enfermedad.py).
//
// Cómo se lee (ajustes acordados con Emir el 18 de septiembre de 2026): cada
// región lleva DOS cifras distintas. El COLOR es cuántas cohortes distintas
// nombran sus HIPÓTESIS (el backend cuenta las cohortes de las afirmaciones de
// las hipótesis de cada celda, no de los hechos: una región con hechos y sin
// hipótesis es siempre fría, y el panel lo dice con esas palabras), en una
// rampa de violeta apagado (0 cohortes) a ámbar brillante (el máximo del
// mapa) y en escala logarítmica (24 cohortes en la sangre, 0 en el
// hipocampo); el NÚMERO junto al nombre es cuántos registros (hechos e
// hipótesis) hay situados en ella. Las regiones sin registros van rayadas de
// dos maneras: rayas tenues si nadie las buscó (ninguna consulta ni fuente
// leída de la investigación las nombra) y rayas con contorno y punto si
// alguna consulta o fuente las nombró y no produjo ningún hecho situado ahí.
// Un borde punteado rojo marca la discordia: algún hecho de la región choca
// con otro (contradiceA). Los puntos (el de "buscada" y el de discordia) van
// donde dice puntoMarca() de lib/atlas_dibujo.ts: en el centro de la región
// si la etiqueta está fuera, y junto al texto, sin pisarlo, si la etiqueta va
// escrita dentro. Las claves "cerebro sin región" y "corteza sin región" no
// son lugares sino localizaciones fallidas: salen de la anatomía a la bandeja
// "No localizados" bajo la figura, y la silueta del cerebro se dibuja como
// contorno neutro. La línea honesta bajo el mapa separa fluidos, tejido
// localizado y sin localizar. El color y el porcentaje de la rampa viajan como
// variables CSS por región (--atlas-p y --atlas-t; la fórmula vive en
// atlas.css). Nada de puntuaciones compuestas ni porcentajes de confianza:
// solo conteos.
//
// El mapa es una instantánea del cierre de la iteración, no el modelo de
// mundo en vivo: la cabecera lo dice y cuenta los hechos que esperan a la
// siguiente iteración. El resumen del panel "El mapa en cifras" se calcula de
// las celdas (lib/atlas.ts), no se imprime el que guardó el backend: al fundir
// hechos duplicados el backend reescribe las celdas sin recalcularlo y las
// cifras dejaban de cuadrar en la misma pantalla. Al pasar el ratón la región
// se ilumina y un rótulo dice su nombre completo y sus conteos; al pulsar
// queda seleccionada con contorno y el panel derecho la describe (definición
// en llano, cohortes, barras por fase y por célula, la mayor certeza GRADE,
// discordia, hipótesis, hechos y preguntas abiertas). Arriba, los filtros;
// abajo, la leyenda y el deslizador "Cómo creció", igual que en el árbol. Con
// movimiento reducido no hay transiciones. En pantallas estrechas el lienzo
// no baja de 700 px y se desplaza en horizontal (atlas.css), para que las
// etiquetas sigan siendo legibles.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CertezaEvidencia, EstadoRosa, HechoMundo, Investigacion } from '../datos/tipos';
import { AvisoMuestra, Chip, Vacio } from '../componentes/piezas';
import { construirAtlas, ETIQUETAS_MAPA, hechosDe, hipotesisDe, intensidad, NO_LOCALIZADAS, type Atlas as DatosAtlas, type RegionAtlas } from '../lib/atlas';
import { CONTORNO_CEREBRO, finGuia, NOMBRE_CORTO, puntoMarca, RECORTADAS, RECORTE_HEMISFERIO, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA, type RegionDibujo } from '../lib/atlas_dibujo';
import { recortar } from '../lib/arbol';
import { CERTEZA_EVIDENCIA } from '../lib/etiquetas';
import { plural } from '../lib/formato';
import { useMovimientoReducido } from '../lib/movimiento';
import { rutaDe } from '../lib/ruta';
import '../atlas.css';

/** Desviación del desenfoque gaussiano de cada tramo de resplandor (1 poco, 4 mucho) y del foco. */
const RESPLANDOR = [2.5, 5, 8, 12] as const;
const RESPLANDOR_FOCO = 10;
/** Cuántos hechos se listan en el panel antes de remitir al modelo de mundo. */
const HECHOS_EN_PANEL = 8;
/** Las figuras que se pintan: todas menos las dos localizaciones fallidas, que van a la bandeja. */
const DIBUJADAS: RegionDibujo[] = REGIONES_DIBUJO.filter((r) => !NO_LOCALIZADAS.has(r.clave));
/** Lo que se dice de la bandeja, palabra por palabra como se acordó. */
const TEXTO_BANDEJA = 'ROSA2018 los leyó pero no supo situarlos; releerlos con el catálogo de regiones es trabajo pendiente.';

/** Tramo de resplandor de una intensidad: 0 (sin resplandor) a 4. */
function tramo(t: number): number {
  return t <= 0 ? 0 : Math.min(RESPLANDOR.length, Math.max(1, Math.ceil(t * RESPLANDOR.length)));
}

/** Texto de conteo de una región: "8 registros de evidencia (7 hechos, 1 hipótesis)". */
function fraseConteo(r: RegionAtlas | undefined): string {
  const hechos = r?.hechos.length ?? 0;
  const hip = r?.hipotesis.length ?? 0;
  const conteo = r?.conteo ?? 0;
  return `${plural(conteo, 'registro')} de evidencia (${plural(hechos, 'hecho')}, ${plural(hip, 'hipótesis', 'hipótesis')})`;
}

/** "56 hechos", "2 hipótesis" o "56 hechos y 2 hipótesis": lo situado por fase o célula pero sin región. */
function fraseSinRegion(a: DatosAtlas): string {
  const hechos = a.sinRegionHechos > 0 ? plural(a.sinRegionHechos, 'hecho') : '';
  const hip = a.sinRegionHipotesis > 0 ? plural(a.sinRegionHipotesis, 'hipótesis', 'hipótesis') : '';
  return [hechos, hip].filter(Boolean).join(' y ') || plural(a.sinRegion, 'registro');
}

/** La línea honesta bajo el mapa, calculada del estado. */
function fraseHonesta(a: DatosAtlas): string {
  const base = `${plural(a.fluidos, 'registro')} en fluidos (sangre y LCR), ${a.tejido} en tejido localizado, ${a.sinLocalizar} sin localizar`;
  return a.enAmbos > 0 ? `${base} (${a.enAmbos} cuentan en fluidos y en tejido)` : base;
}

/** Nombre corto para la figura: el del dibujo o, para una región que el backend añadió después, su etiqueta. */
function nombreCorto(clave: string, r: RegionAtlas | undefined): string {
  return NOMBRE_CORTO[clave] ?? r?.etiqueta ?? clave;
}

/** El texto de la etiqueta en la figura: el nombre y, si hay registros, su número. */
function textoEtiqueta(clave: string, r: RegionAtlas | undefined): { nombre: string; cifra: string | null } {
  const conteo = r?.conteo ?? 0;
  return { nombre: nombreCorto(clave, r), cifra: conteo > 0 ? String(conteo) : null };
}

/** El texto que se pinta de verdad en la figura ("hipocampo · 15"): de él
 *  salen el fin de la guía y el sitio de la marca. */
function textoPintado(nombre: string, cifra: string | null): string {
  return cifra ? `${nombre} · ${cifra}` : nombre;
}

/** El nombre de una cohorte, tal como llega, y cómo enseñarlo: el backend
 *  guarda los nombres de cohorte de las afirmaciones recortados a 60
 *  caracteres, a veces a mitad de palabra («16 RCTs (meta-análisis
 *  instrumental actualizado, actualizaci»). Un nombre que llega con esa
 *  longitud se corta aquí en el último espacio y lleva puntos suspensivos;
 *  el `title` conserva lo recibido entero y dice que puede estar incompleto.
 *  Arreglarlo de raíz (no truncar al extraer) es trabajo del backend. */
const COHORTE_RECORTADA = 60;
/** Cuántas cohortes se listan en el panel antes de decir "y N más". */
const COHORTES_EN_PANEL = 8;
export function cohorteVisible(nombre: string): { texto: string; titulo: string } {
  if (nombre.length < COHORTE_RECORTADA) return { texto: nombre, titulo: nombre };
  const corte = nombre.lastIndexOf(' ');
  const cabeza = corte > COHORTE_RECORTADA / 2 ? nombre.slice(0, corte) : nombre;
  return { texto: `${cabeza.replace(/[\s,;:(]+$/, '')}…`, titulo: `${nombre} (el extractor recorta los nombres a ${COHORTE_RECORTADA} caracteres: este puede estar incompleto)` };
}

/** Las cohortes de una región en el panel: hasta ocho, cada una con el nombre recibido entero en `title`. */
function ListaCohortes({ nombres }: { nombres: string[] }) {
  return (
    <>
      {nombres.slice(0, COHORTES_EN_PANEL).map((n, i) => {
        const c = cohorteVisible(n);
        return (
          <span key={n}>
            {i > 0 ? ', ' : ''}
            <span title={c.titulo}>{c.texto}</span>
          </span>
        );
      })}
      {nombres.length > COHORTES_EN_PANEL ? ` y ${nombres.length - COHORTES_EN_PANEL} más` : ''}
    </>
  );
}

/** "1 consulta de búsqueda y 2 fuentes leídas": las partes unidas con comas y una «y» final. */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Qué dice la cobertura de un hueco, en llano, con sus cifras y concordando
 *  el verbo con cuántas menciones hay ("1 fuente leída la nombra", "3 la nombran"). */
function fraseCobertura(r: RegionAtlas, conFiltros: boolean): string {
  const filtros = conFiltros ? ' con los filtros puestos' : '';
  if (r.cobertura === 'buscada_sin_hallazgo') {
    const total = r.menciones.consultas + r.menciones.fuentes + r.preguntas.length;
    const partes = [r.menciones.consultas > 0 ? plural(r.menciones.consultas, 'consulta de búsqueda', 'consultas de búsqueda') : '', r.menciones.fuentes > 0 ? plural(r.menciones.fuentes, 'fuente leída', 'fuentes leídas') : '', r.preguntas.length > 0 ? plural(r.preguntas.length, 'pregunta abierta', 'preguntas abiertas') : ''].filter(Boolean);
    const verbo = total === 1 ? 'la nombra y no produjo ningún hecho ni hipótesis situados aquí' : 'la nombran y ninguna produjo un hecho ni una hipótesis situados aquí';
    return `Buscada sin hallazgo: ${enumerar(partes)} de esta investigación ${verbo}${filtros}.`;
  }
  return `No buscada: ninguna consulta hecha ni fuente leída de esta investigación nombra esta región${filtros}. No significa que no haya nada publicado, solo que ROSA2018 no lo ha buscado ni situado aún.`;
}

function Leyenda({ atlas, conFiltros }: { atlas: DatosAtlas; conFiltros: boolean }) {
  // Los extremos escritos son los que usa la rampa de verdad: 0 cohortes en el
  // frío SIEMPRE y el máximo del mapa en el cálido (no el mínimo presente, que
  // la rampa no mira). Con un máximo de 0 nada es ámbar y se dice.
  const extremos =
    atlas.cohortesMax > 0
      ? `violeta apagado, 0 cohortes; ámbar brillante, ${plural(atlas.cohortesMax, 'cohorte')} (el máximo de este mapa, en escala logarítmica)`
      : `${conFiltros ? 'con estos filtros ' : ''}ninguna región con registros tiene cohortes nombradas, así que todas van en violeta apagado y nada llega al ámbar`;
  return (
    <ul className="atlas-leyenda" aria-label="Cómo leer el atlas">
      <li>
        <span className="atlas-rampa-extremos" aria-hidden="true">
          <span>0</span>
          <span className="atlas-muestra atlas-muestra-rampa" />
          <span>{atlas.cohortesMax}</span>
        </span>
        <span>
          <strong>Color: cuántas cohortes distintas nombran sus hipótesis; número: cuántos registros.</strong> El color de una región es cuántas cohortes distintas nombran las hipótesis situadas en ella (las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos): {extremos}. El número junto al nombre es cuántos registros (hechos e hipótesis) hay situados en ella. Dos hechos de la misma cohorte no son dos evidencias independientes.
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-rayas-tenues" aria-hidden="true" />
        <span>
          <strong>Rayas tenues: hueco no buscado.</strong> Ninguna consulta hecha ni fuente leída de esta investigación nombra la región. Sin evidencia situada todavía; no significa que no haya nada publicado.
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-rayas-buscada" aria-hidden="true" />
        <span>
          <strong>Rayas con contorno y punto: buscada sin hallazgo.</strong> Alguna consulta de búsqueda o alguna fuente leída la nombra y no produjo ningún hecho ni hipótesis situados ahí.
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-discordia" aria-hidden="true" />
        <span>
          <strong>Borde punteado rojo: discordia.</strong> Algún hecho de la región choca con otro hecho del modelo de mundo sin sustituirlo. La dirección de las citas no se pinta: hoy todas nacen marcadas «apoya» por código.
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-vasos" aria-hidden="true" />
        <span>
          <strong>Las líneas ramificadas: los vasos.</strong> La vasculatura y la barrera hematoencefálica, pintadas como trazo sobre el cerebro porque no ocupan un sitio sino que lo recorren.
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-fuera" aria-hidden="true" />
        <span>
          <strong>Fuera del cerebro: donde también se mide.</strong> La gota es la sangre (plasma y suero); el ojo, la retina; el tubo, el intestino y su microbiota. El LCR va dentro: los ventrículos y el canal del tronco. Lo que ROSA2018 no supo situar va en la bandeja «No localizados», no en la figura.
        </span>
      </li>
    </ul>
  );
}

export function Atlas({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [estadio, setEstadio] = useState<string | null>(null);
  const [celulas, setCelulas] = useState<string[]>([]);
  const reducido = useMovimientoReducido();
  // Sin filtros: dice si hay atlas, cuántas iteraciones hay y sirve de base al deslizador.
  const completo = useMemo(() => construirAtlas(estado, inv), [estado, inv]);
  const iteracionMax = Math.max(1, completo?.iteracionMax ?? 1);
  const [hasta, setHasta] = useState<number>(iteracionMax);
  // Si llega una iteración nueva y el deslizador estaba en el presente, sigue en el presente.
  const anteriorMax = useRef(iteracionMax);
  useEffect(() => {
    const previo = anteriorMax.current;
    setHasta((h) => (h >= previo ? iteracionMax : Math.min(h, iteracionMax)));
    anteriorMax.current = iteracionMax;
  }, [iteracionMax]);
  const hastaFiltro = hasta >= iteracionMax ? null : hasta;
  // Con el tiempo pero sin fase ni célula: da los conteos de los chips y los interruptores.
  const base = useMemo(() => construirAtlas(estado, inv, { hasta: hastaFiltro }), [estado, inv, hastaFiltro]);
  // Con todos los filtros: lo que se pinta.
  const atlas: DatosAtlas | null = useMemo(() => construirAtlas(estado, inv, { estadio, celulas, hasta: hastaFiltro }), [estado, inv, estadio, celulas, hastaFiltro]);
  const porClave = useMemo(() => new Map((atlas?.regiones ?? []).map((r) => [r.clave, r] as const)), [atlas]);
  // Otra investigación: se olvida la selección y los filtros.
  useEffect(() => {
    setSeleccion(null);
    setFoco(null);
    setEstadio(null);
    setCelulas([]);
  }, [inv.id]);

  if (!completo || !atlas || !base) {
    return (
      <div className="contenido">
        <AvisoMuestra conexion={estado.conexion} />
        <Vacio titulo="El atlas todavía no tiene evidencia situada" accion={<a className="btn btn-s" href={rutaDe(inv.id, 'arbol')}>Abrir en el árbol</a>}>
          ROSA2018 dibuja el atlas al cerrar la primera iteración de esta investigación: sitúa cada hecho por región del cerebro, estadio de la enfermedad y tipo de célula.
        </Vacio>
      </div>
    );
  }

  // Lo que está EN LA FIGURA: las regiones localizadas (las de la bandeja no
  // se pintan). Lo situado solo por fase o por célula (atlas.sinRegion) y lo
  // no localizado (atlas.noLocalizados) se dicen aparte.
  const enFigura = atlas.regiones.filter((r) => !NO_LOCALIZADAS.has(r.clave));
  const conEvidencia = enFigura.filter((r) => r.conteo > 0).length;
  const hechosSituados = new Set(enFigura.flatMap((r) => r.hechos)).size;
  const hipotesisSituadas = new Set(enFigura.flatMap((r) => r.hipotesis)).size;
  const conFiltros = estadio !== null || celulas.length > 0 || hastaFiltro !== null;
  const sel = seleccion ? porClave.get(seleccion) ?? null : null;
  const selDibujo = seleccion ? DIBUJADAS.find((r) => r.clave === seleccion) ?? null : null;
  const focoDibujo = foco ? DIBUJADAS.find((r) => r.clave === foco) ?? null : null;
  const focoDatos = foco ? porClave.get(foco) : undefined;
  // Regiones que el backend añadió después de este dibujo: se listan, no se pierden.
  const dibujadas = new Set(DIBUJADAS.map((r) => r.clave));
  const sinDibujo = enFigura.filter((r) => !dibujadas.has(r.clave));
  const bandeja = atlas.regiones.filter((r) => NO_LOCALIZADAS.has(r.clave));
  const etiquetaEstadio = (clave: string) => base.estadios.find((e) => e.clave === clave)?.etiqueta ?? ETIQUETAS_MAPA.estadio[clave] ?? (clave === '' ? 'sin fase identificada' : clave);
  const etiquetaCelula = (clave: string) => base.celulas.find((c) => c.clave === clave)?.etiqueta ?? ETIQUETAS_MAPA.tipoCelular[clave] ?? clave;
  const seleccionar = (clave: string) => setSeleccion((s) => (s === clave ? null : clave));
  const alTeclado = (e: React.KeyboardEvent, clave: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      seleccionar(clave);
    }
  };
  const alternarCelula = (clave: string) => setCelulas((c) => (c.includes(clave) ? c.filter((x) => x !== clave) : [...c, clave]));
  const certezaSel = sel?.certezaMax && Object.hasOwn(CERTEZA_EVIDENCIA, sel.certezaMax) ? CERTEZA_EVIDENCIA[sel.certezaMax as CertezaEvidencia] : null;
  const hechosSel = sel ? hechosDe(estado, sel.hechos) : [];
  const hipotesisSel = sel ? hipotesisDe(estado, sel.hipotesis) : [];
  const preguntasSel = sel ? hechosDe(estado, sel.preguntas) : [];
  const discordiaSel: HechoMundo[] = sel ? hechosDe(estado, sel.discordia) : [];
  const selNoLocalizada = sel ? NO_LOCALIZADAS.has(sel.clave) : false;
  const barras = (valores: Record<string, number>, etiquetaDe: (k: string) => string) => {
    const entradas = Object.entries(valores).filter(([, v]) => v > 0);
    const maximo = Math.max(1, ...entradas.map(([, v]) => v));
    return entradas.map(([k, v]) => (
      <li key={k || 'sin'}>
        <span title={etiquetaDe(k)}>{etiquetaDe(k)}</span>
        <span className="atlas-barra" aria-hidden="true">
          <span style={{ width: `${Math.round((v / maximo) * 100)}%` }} />
        </span>
        <span className="atlas-cifra">{v}</span>
      </li>
    ));
  };
  // El rótulo flotante: junto a la etiqueta de la región, sin salirse del
  // lienzo. Dos líneas: el nombre completo que manda el backend ("líquido
  // cefalorraquídeo (LCR)", no el corto de la figura) y los conteos.
  const flotante = (() => {
    if (!focoDibujo) return null;
    const nombre = focoDatos?.etiqueta ?? ETIQUETAS_MAPA.region[focoDibujo.clave] ?? nombreCorto(focoDibujo.clave, focoDatos);
    // Un hueco no dice "0 · 0 hechos, 0 hipótesis · 0 cohortes": dice que es un hueco y si alguien lo buscó.
    const cifra =
      (focoDatos?.conteo ?? 0) === 0
        ? `hueco: sin evidencia situada (${focoDatos?.cobertura === 'buscada_sin_hallazgo' ? 'buscada sin hallazgo' : 'no buscada'})`
        : `${focoDatos?.conteo ?? 0} · ${plural(focoDatos?.hechos.length ?? 0, 'hecho')}, ${plural(focoDatos?.hipotesis.length ?? 0, 'hipótesis', 'hipótesis')} · ${plural(focoDatos?.cohortes.length ?? 0, 'cohorte')}`;
    const ancho = Math.max(nombre.length, cifra.length) * 6.6 + 20;
    const alto = 40;
    const x = Math.min(VISTA.ancho - ancho / 2 - 6, Math.max(ancho / 2 + 6, focoDibujo.etiqueta[0]));
    const arriba = focoDibujo.etiqueta[1] > alto + 20;
    const y = arriba ? focoDibujo.etiqueta[1] - alto - 14 : focoDibujo.etiqueta[1] + 14;
    return (
      <g className="atlas-flotante" aria-hidden="true">
        <rect x={x - ancho / 2} y={y} width={ancho} height={alto} rx={6} />
        <text x={x} y={y + 16} textAnchor="middle">
          {nombre}
        </text>
        <text x={x} y={y + 32} textAnchor="middle" className="atlas-flotante-cifra">
          {cifra}
        </text>
      </g>
    );
  })();

  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>Atlas de la enfermedad</h2>
          <p>
            El cerebro visto de lado y partido por la mitad (un corte sagital), con la frente a la izquierda. Cada región lleva dos cifras: el color dice cuántas cohortes distintas nombran sus hipótesis (violeta apagado, pocas o ninguna; ámbar brillante, muchas) y el número junto al nombre, cuántos registros (hechos e hipótesis) ha situado ROSA2018 en ella. A rayas, las regiones que no tienen registros: tenues si nadie las buscó, con contorno y punto si alguna consulta o fuente las nombró sin hallazgo. Un borde punteado rojo marca discordia entre hechos. Fuera del cerebro están los sitios donde también se mide la enfermedad (la sangre, la retina y el intestino) y, bajo la figura, la bandeja de lo que ROSA2018 leyó y no supo situar. Pasa el ratón por una región para ver su nombre y sus conteos; púlsala para leer qué es y qué la sostiene. Los filtros de arriba recortan por fase de la enfermedad y por tipo de célula; el deslizador de abajo enseña cómo se fue llenando el mapa iteración a iteración.
          </p>
          <p className="meta">
            Se recalcula al cerrar cada iteración: el mapa es una instantánea, no el modelo de mundo en vivo.
            {atlas.hechosNuevos > 0 ? ` ${plural(atlas.hechosNuevos, 'hecho nuevo espera', 'hechos nuevos esperan')} a la siguiente iteración para situarse.` : ''}
          </p>
        </div>
        <div className="acciones">
          <a className="btn btn-s" href={rutaDe(inv.id, 'arbol')}>
            Abrir en el árbol
          </a>
        </div>
      </div>

      <div className="atlas-controles">
        <div className="atlas-grupo" role="group" aria-label="Fase de la enfermedad">
          <span className="atlas-grupo-titulo">Fase</span>
          <button type="button" className="atlas-chip" aria-pressed={estadio === null} onClick={() => setEstadio(null)} title="Toda la evidencia, en cualquier fase de la enfermedad">
            Todas
          </button>
          {base.estadios.map((e) => (
            <button key={e.clave || 'sin'} type="button" className="atlas-chip" aria-pressed={estadio === e.clave} onClick={() => setEstadio((actual) => (actual === e.clave ? null : e.clave))} title={base.definiciones.estadio?.[e.clave] ?? (e.clave === '' ? 'Registros con región o célula pero sin fase identificada por su contenido ni por la misión.' : undefined)}>
              {e.etiqueta} <span className="atlas-cifra">{e.conteo}</span>
            </button>
          ))}
        </div>
        <div className="atlas-grupo" role="group" aria-label="Tipo de célula">
          <span className="atlas-grupo-titulo">Célula</span>
          {base.celulas.length === 0 ? (
            <span className="meta">sin tipo celular situado todavía</span>
          ) : (
            base.celulas.map((c) => (
              <label key={c.clave} className="interruptor atlas-interruptor" title={base.definiciones.tipoCelular?.[c.clave]}>
                <input type="checkbox" checked={celulas.includes(c.clave)} onChange={() => alternarCelula(c.clave)} />
                {c.etiqueta} <span className="atlas-cifra">{c.conteo}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="atlas-marco">
        <div>
          <div className={`atlas-lienzo${reducido ? ' atlas-sin-movimiento' : ''}`}>
            <svg className="atlas-figura" viewBox={`0 0 ${VISTA.ancho} ${VISTA.alto}`} role="group" aria-label={`Atlas de ${inv.titulo}: corte sagital del cerebro con ${plural(conEvidencia, 'región', 'regiones')} con evidencia de ${DIBUJADAS.length}`}>
              <defs>
                <clipPath id="atlas-recorte">
                  <path d={RECORTE_HEMISFERIO} />
                </clipPath>
                <pattern id="atlas-rayas" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="var(--atlas-rayas)" strokeWidth="1.2" />
                </pattern>
                <pattern id="atlas-rayas-buscada" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="7" stroke="var(--atlas-rayas-buscada)" strokeWidth="1.4" />
                </pattern>
                {RESPLANDOR.map((desvio, i) => (
                  <filter key={i} id={`atlas-resplandor-${i + 1}`} x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation={desvio} result="borroso" />
                    <feMerge>
                      <feMergeNode in="borroso" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                ))}
                <filter id="atlas-resplandor-foco" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation={RESPLANDOR_FOCO} result="borroso" />
                  <feMerge>
                    <feMergeNode in="borroso" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect className="atlas-fondo" width={VISTA.ancho} height={VISTA.alto} />
              {/* La silueta del cerebro: contorno neutro, sin conteo. Las localizaciones fallidas ya no se pintan como anillos. */}
              <path d={CONTORNO_CEREBRO} className="atlas-silueta" aria-hidden="true" />
              <g className="atlas-regiones">
                {DIBUJADAS.map((r) => {
                  const datos = porClave.get(r.clave);
                  const conteo = datos?.conteo ?? 0;
                  const cohortes = datos?.cohortes.length ?? 0;
                  const t = intensidad(cohortes, atlas.cohortesMax);
                  const nivel = tramo(t);
                  const capa = r.capa ?? 'region';
                  const cobertura = datos?.cobertura ?? 'no_buscada';
                  const buscada = cobertura === 'buscada_sin_hallazgo';
                  const discordia = datos?.discordia.length ?? 0;
                  const clases = ['atlas-region', `atlas-capa-${capa}`, conteo === 0 ? `atlas-hueco ${buscada ? 'atlas-buscada' : 'atlas-no-buscada'}` : nivel > 0 ? `atlas-resplandor-${nivel}` : '', seleccion === r.clave ? 'atlas-seleccionada' : '', foco === r.clave ? 'atlas-foco' : '', discordia > 0 ? 'atlas-con-discordia' : ''].filter(Boolean).join(' ');
                  const nombre = datos?.etiqueta ?? ETIQUETAS_MAPA.region[r.clave] ?? nombreCorto(r.clave, datos);
                  const hueco = conteo === 0 ? `; hueco: sin evidencia situada todavía (${buscada ? 'buscada sin hallazgo' : 'no buscada'})` : '';
                  const choque = discordia > 0 ? `; discordia: ${plural(discordia, 'hecho choca', 'hechos chocan')} con otro hecho` : '';
                  const etiquetaAccesible = `${nombre}: ${fraseConteo(datos)}; ${plural(cohortes, 'cohorte distinta', 'cohortes distintas')}${hueco}${choque}`;
                  const oyentes = {
                    onClick: () => seleccionar(r.clave),
                    onPointerEnter: () => setFoco(r.clave),
                    onPointerLeave: () => setFoco((f) => (f === r.clave ? null : f)),
                  };
                  return (
                    <g key={r.clave}>
                      <path
                        d={r.d}
                        className={clases}
                        role="button"
                        tabIndex={0}
                        aria-label={etiquetaAccesible}
                        aria-pressed={seleccion === r.clave}
                        data-clave={r.clave}
                        data-conteo={conteo}
                        data-cohortes={cohortes}
                        data-cobertura={cobertura}
                        data-discordia={discordia}
                        data-intensidad={t.toFixed(2)}
                        style={{ ['--atlas-p' as string]: `${Math.round(t * 100)}%`, ['--atlas-t' as string]: t.toFixed(3) }}
                        clipPath={RECORTADAS.has(r.clave) ? 'url(#atlas-recorte)' : undefined}
                        fillRule="evenodd"
                        onKeyDown={(e) => alTeclado(e, r.clave)}
                        onFocus={() => setFoco(r.clave)}
                        onBlur={() => setFoco((f) => (f === r.clave ? null : f))}
                        {...oyentes}
                      />
                      {capa === 'vasos' && <path d={r.d} className="atlas-vasos-area" aria-hidden="true" {...oyentes} />}
                    </g>
                  );
                })}
              </g>
              <path d={CONTORNO_CEREBRO} className="atlas-contorno" />
              <g className="atlas-trazos" aria-hidden="true">
                {TRAZOS_FINOS.map((t, i) => (
                  <path key={i} d={t.d} className="atlas-trazo" clipPath={t.recortado ? 'url(#atlas-recorte)' : undefined} />
                ))}
              </g>
              {/* Las marcas: el punto de "buscada sin hallazgo" y el borde punteado rojo de la discordia (con su punto), encima de todo.
                  El punto va donde dice puntoMarca(): en el centro si la etiqueta está fuera de la figura y junto al texto que se
                  pinta de verdad si va escrita dentro, para que las letras no lo tapen. */}
              <g className="atlas-marcas" aria-hidden="true">
                {DIBUJADAS.map((r) => {
                  const datos = porClave.get(r.clave);
                  if (!datos) return null;
                  const buscada = datos.conteo === 0 && datos.cobertura === 'buscada_sin_hallazgo';
                  const discordia = datos.discordia.length > 0;
                  if (!buscada && !discordia) return null;
                  const { nombre, cifra } = textoEtiqueta(r.clave, datos);
                  const [mx, my] = puntoMarca(r, textoPintado(nombre, cifra));
                  return (
                    <g key={r.clave}>
                      {buscada && <circle className="atlas-punto-buscada" data-region={r.clave} cx={mx} cy={my} r={3.2} />}
                      {discordia && <path d={r.d} className={`atlas-discordia atlas-capa-${r.capa ?? 'region'}`} data-region={r.clave} clipPath={RECORTADAS.has(r.clave) ? 'url(#atlas-recorte)' : undefined} fillRule="evenodd" />}
                      {discordia && <circle className="atlas-discordia-punto" data-region={r.clave} cx={mx} cy={my} r={4} />}
                    </g>
                  );
                })}
              </g>
              {selDibujo && <path d={selDibujo.d} className={`atlas-seleccion atlas-capa-${selDibujo.capa ?? 'region'}`} clipPath={RECORTADAS.has(selDibujo.clave) ? 'url(#atlas-recorte)' : undefined} fillRule="evenodd" aria-hidden="true" />}
              <g className="atlas-etiquetas" aria-hidden="true">
                {DIBUJADAS.map((r) => {
                  const datos = porClave.get(r.clave);
                  const conteo = datos?.conteo ?? 0;
                  const { nombre, cifra } = textoEtiqueta(r.clave, datos);
                  const [x, y] = r.etiqueta;
                  const fin = r.guia ? finGuia(r, textoPintado(nombre, cifra)) : null;
                  return (
                    <g key={r.clave}>
                      {fin && <line className="atlas-guia" x1={r.centro[0]} y1={r.centro[1]} x2={fin[0]} y2={fin[1]} />}
                      <text className={`atlas-etiqueta${conteo === 0 ? ' atlas-etiqueta-hueco' : ''}`} x={x} y={y} textAnchor="middle" transform={r.giro ? `rotate(${r.giro} ${x} ${y})` : undefined}>
                        {nombre}
                        {cifra && (
                          <tspan className="atlas-etiqueta-cifra" dx={5}>
                            · {cifra}
                          </tspan>
                        )}
                      </text>
                    </g>
                  );
                })}
              </g>
              {flotante}
            </svg>
          </div>
          <p className="atlas-honesta">
            <strong>{fraseHonesta(atlas)}</strong>
            {conFiltros ? ' (con los filtros puestos).' : '.'}
          </p>
          <section className="atlas-bandeja" aria-label="No localizados">
            <h4>
              No localizados <span className="atlas-cifra">{atlas.noLocalizados.conteo}</span>
            </h4>
            <p className="meta">
              {atlas.noLocalizados.conteo > 0 ? `${plural(atlas.noLocalizados.conteo, 'registro')} (${plural(atlas.noLocalizados.hechos, 'hecho')}, ${plural(atlas.noLocalizados.hipotesis, 'hipótesis', 'hipótesis')}) cuya fuente dice «cerebro» o «corteza» sin más. ` : 'Ningún registro cayó en «cerebro» o «corteza» sin región. '}
              {TEXTO_BANDEJA}
              {atlas.noLocalizados.tambienSituados > 0 ? ` ${plural(atlas.noLocalizados.tambienSituados, 'registro de estos está', 'registros de estos están')} además en alguna región localizada (la sangre, por ejemplo) y cuentan allí.` : ''}
            </p>
            <ul>
              {bandeja.map((r) => (
                <li key={r.clave}>
                  <button type="button" className="atlas-bandeja-item" data-clave={r.clave} aria-pressed={seleccion === r.clave} aria-label={`${r.etiqueta}: ${fraseConteo(r)}; no localizado`} onClick={() => seleccionar(r.clave)} title={r.definicion}>
                    {r.etiqueta} <span className="atlas-cifra">{r.conteo}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {sinDibujo.length > 0 && (
            <p className="meta atlas-nuevas">
              Regiones nuevas del servidor que este dibujo aún no tiene:{' '}
              {sinDibujo.map((r, i) => (
                <span key={r.clave}>
                  {i > 0 ? ', ' : ''}
                  <button type="button" className="enlace" onClick={() => seleccionar(r.clave)}>
                    {r.etiqueta}
                  </button>{' '}
                  ({r.conteo})
                </span>
              ))}
              .
            </p>
          )}
          <Leyenda atlas={atlas} conFiltros={conFiltros} />
        </div>

        <aside className="grafo-panel atlas-panel">
          {sel ? (
            <>
              <Chip tono={selNoLocalizada ? 'aviso' : 'acento'}>{selNoLocalizada ? 'No localizado' : selDibujo?.exterior ? 'Compartimento' : selDibujo?.capa === 'fondo' ? 'Capa' : 'Región'}</Chip>
              <h3>{sel.etiqueta}</h3>
              {sel.definicion && <p className="meta">{sel.definicion}</p>}
              {selNoLocalizada && <p className="atlas-hueco-aviso">Localización fallida, no un lugar: {TEXTO_BANDEJA} Estos registros no se pintan en la figura.</p>}
              {sel.conteo === 0 ? (
                <p className="atlas-hueco-aviso">Hueco: sin evidencia situada todavía. {fraseCobertura(sel, conFiltros)}</p>
              ) : (
                <div className="atlas-cifras">
                  <span>{plural(sel.hechos.length, 'hecho')}</span>
                  <span>{plural(sel.hipotesis.length, 'hipótesis', 'hipótesis')}</span>
                  {sel.preguntas.length > 0 && <span>{plural(sel.preguntas.length, 'pregunta abierta', 'preguntas abiertas')}</span>}
                </div>
              )}
              {sel.sinResolver > 0 && (
                <p className="meta">
                  {/* El mapa es una instantánea del cierre de la iteración; después los hechos se sustituyen o se descartan. Las cifras los cuentan (cuadran con el backend), las listas no pueden traerlos. */}
                  {sel.sinResolver === 1 ? 'Uno de ellos ya no está' : `${sel.sinResolver} de ellos ya no están`} en el modelo de mundo (sustituidos o descartados después de calcular el mapa): cuentan en las cifras y no aparecen en las listas de abajo.
                </p>
              )}
              {sel.conteo > 0 && !selNoLocalizada && (
                <p className="meta">
                  {/* Las cohortes salen SOLO de las afirmaciones de las hipótesis (rosa/mapa_enfermedad.py): un hecho que nombra ADNI no cuenta. Se dice tal cual, sin afirmar nada sobre los hechos. */}
                  {sel.cohortes.length > 0 ? (
                    <>
                      <strong>{plural(sel.cohortes.length, 'cohorte distinta', 'cohortes distintas')}</strong> nombran sus hipótesis (su color): <ListaCohortes nombres={sel.cohortes} />.
                    </>
                  ) : sel.hipotesis.length > 0 ? (
                    <>
                      <strong>Sus hipótesis no nombran ninguna cohorte</strong> (las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos): el color queda en el extremo frío aunque tenga {plural(sel.conteo, 'registro')}.
                    </>
                  ) : (
                    <>
                      <strong>Sin hipótesis situadas aquí</strong>, y las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos: el color queda en el extremo frío aunque alguno de sus {plural(sel.hechos.length, 'hecho')} nombre una cohorte.
                    </>
                  )}
                </p>
              )}
              {sel.conteo > 0 && selNoLocalizada && sel.cohortes.length > 0 && (
                <p className="meta">
                  Cohortes que nombran sus hipótesis: <ListaCohortes nombres={sel.cohortes} />.
                </p>
              )}
              {sel.discordia.length > 0 && (
                <div className="atlas-discordia-aviso">
                  <strong>Discordia:</strong> {plural(sel.discordia.length, 'hecho de esta región choca', 'hechos de esta región chocan')} con otro hecho del modelo de mundo sin sustituirlo. La dirección de las citas no se usa para esta marca.
                  {discordiaSel.length > 0 && (
                    <ul>
                      {discordiaSel.map((h) => {
                        const contra = hechosDe(estado, h.contradiceA ?? []);
                        return (
                          <li key={h.id}>
                            {recortar(h.enunciado, 120)}
                            {contra.length > 0 ? ` Choca con: ${contra.map((c) => recortar(c.enunciado, 90)).join(' | ')}` : ` Choca con ${plural((h.contradiceA ?? []).length, 'hecho')} que ya no están en el modelo de mundo.`}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              {certezaSel ? (
                <p className="meta">
                  Mayor certeza GRADE entre sus hipótesis: <Chip tono={certezaSel.tono}>{certezaSel.etiqueta.replace('Certeza ', '')}</Chip>
                </p>
              ) : hipotesisSel.length > 0 ? (
                <p className="meta">Sin conclusión con certeza GRADE todavía.</p>
              ) : null}
              {Object.values(sel.porEstadio).some((v) => v > 0) && (
                <>
                  <h4>Por fase de la enfermedad</h4>
                  <ul className="atlas-barras">{barras(sel.porEstadio, etiquetaEstadio)}</ul>
                </>
              )}
              {Object.values(sel.porCelula).some((v) => v > 0) && (
                <>
                  <h4>Por tipo de célula</h4>
                  <ul className="atlas-barras">{barras(sel.porCelula, etiquetaCelula)}</ul>
                </>
              )}
              {hipotesisSel.length > 0 && (
                <>
                  <h4>Hipótesis ({hipotesisSel.length})</h4>
                  <ul className="atlas-lista">
                    {hipotesisSel.map((h) => (
                      <li key={h.id}>
                        <a className="enlace" href={rutaDe(inv.id, 'hipotesis', h.id)}>
                          {h.titulo}
                        </a>
                        <span className="meta">{[h.cluster, h.estado === 'descartada' ? 'descartada' : ''].filter(Boolean).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {hechosSel.length > 0 && (
                <>
                  <h4>Hechos ({hechosSel.length})</h4>
                  <ul className="atlas-lista">
                    {hechosSel.slice(0, HECHOS_EN_PANEL).map((h) => (
                      <li key={h.id}>
                        {recortar(h.enunciado, 150)}
                        <span className="meta">{h.tema}</span>
                      </li>
                    ))}
                  </ul>
                  <a className="btn btn-s" href={rutaDe(inv.id, 'mundo')}>
                    {hechosSel.length > HECHOS_EN_PANEL ? `Ver los ${hechosSel.length} en el modelo de mundo` : 'Ver en el modelo de mundo'}
                  </a>
                </>
              )}
              {preguntasSel.length > 0 && (
                <>
                  <h4>Preguntas abiertas ({preguntasSel.length})</h4>
                  <ul className="atlas-lista">
                    {preguntasSel.map((p) => (
                      <li key={p.id}>{recortar(p.enunciado, 120)}</li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className="btn btn-s" onClick={() => setSeleccion(null)}>
                Quitar la selección
              </button>
            </>
          ) : (
            <>
              <h3>El mapa en cifras</h3>
              {atlas.resumen && <p className="meta">{atlas.resumen}</p>}
              {atlas.ejesDesfasados.length > 0 && (
                <p className="meta atlas-desfase" title={atlas.ejesDesfasados.join('; ')}>
                  Estas cifras se calculan de las celdas del mapa. Los conteos que el backend guardó al calcularlo ya no cuadran con ellas en {plural(atlas.ejesDesfasados.length, 'conteo')} (fundió hechos duplicados después de situarlos), así que no se enseñan.
                </p>
              )}
              <ul className="atlas-lista">
                <li>
                  <strong>{plural(conEvidencia, 'región', 'regiones')}</strong> con evidencia de {DIBUJADAS.length}; {plural(hechosSituados, 'hecho')} y {plural(hipotesisSituadas, 'hipótesis', 'hipótesis')} en la figura{conFiltros ? ' con los filtros puestos' : ''}.
                </li>
                <li>{fraseHonesta(atlas)}.</li>
                {atlas.noLocalizados.conteo > 0 && (
                  <li>
                    <strong>{plural(atlas.noLocalizados.conteo, 'registro no localizado', 'registros no localizados')}</strong> («cerebro» o «corteza» sin región): en la bandeja bajo la figura, no en la anatomía.
                  </li>
                )}
                {atlas.sinRegion > 0 && (
                  <li>
                    {/* El backend sitúa por tres ejes; lo que tiene fase o célula pero no región cuenta en su resumen y no cabe en un dibujo por regiones. Sin esta línea el panel se contradice a sí mismo (217 arriba, 170 en la figura). */}
                    <strong>{fraseSinRegion(atlas)} con fase o tipo de célula pero sin región del cerebro</strong>: cuentan en el resumen de arriba y no están en la figura.
                  </li>
                )}
                {atlas.discordantes > 0 && (
                  <li>
                    <strong>{plural(atlas.discordantes, 'hecho en discordia', 'hechos en discordia')}</strong> en la figura (chocan con otro hecho): las regiones con borde punteado rojo.
                  </li>
                )}
                {atlas.sinEjes > 0 && (
                  <li>
                    <strong>{plural(atlas.sinEjes, 'hecho')} sin situar</strong>: su texto no nombra región, fase ni tipo de célula. Cuentan en el modelo de mundo, no aquí.
                  </li>
                )}
                {atlas.hipotesisSinEjes > 0 && <li>{plural(atlas.hipotesisSinEjes, 'hipótesis', 'hipótesis')} sin situar.</li>}
                {atlas.heredados > 0 && <li>{plural(atlas.heredados, 'hecho heredado', 'hechos heredados')} de otra investigación, ya situados.</li>}
                {atlas.iteracionOrdinal !== null ? (
                  <li className="meta">Mapa calculado al cerrar la iteración {atlas.iteracionOrdinal} de {iteracionMax}. Se recalcula al cerrar cada iteración.</li>
                ) : atlas.iteracion !== null ? (
                  <li className="meta">Mapa calculado al cerrar la iteración {atlas.iteracion} de su corrida. Se recalcula al cerrar cada iteración.</li>
                ) : (
                  <li className="meta">Se recalcula al cerrar cada iteración.</li>
                )}
                {atlas.hechosNuevos > 0 && <li className="meta">{plural(atlas.hechosNuevos, 'hecho nuevo', 'hechos nuevos')} en el modelo de mundo desde entonces, todavía sin situar: ROSA2018 los sitúa al cerrar la iteración.</li>}
              </ul>
              {atlas.huecos.length > 0 && (
                <>
                  <h4>Huecos que la misión nombra</h4>
                  <ul className="atlas-lista">
                    {atlas.huecos.slice(0, 6).map((h, i) => (
                      <li key={i} className="meta">
                        {h}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Cómo leerlo</h4>
              <ul className="atlas-lista">
                <li>Pulsa una región para ver sus cohortes, sus hechos, sus hipótesis y sus preguntas abiertas.</li>
                <li>Color: cuántas cohortes distintas nombran sus hipótesis; número: cuántos registros. A rayas tenues, hueco no buscado; con contorno y punto, buscado sin hallazgo.</li>
                <li>Los lóbulos van por fuera; dentro, la sustancia blanca y, encima, los núcleos profundos, los ventrículos y el hipocampo. Lo no localizado va en la bandeja de abajo.</li>
              </ul>
            </>
          )}
        </aside>
      </div>

      <div className="grafo-tiempo">
        <button type="button" className="btn btn-s" aria-pressed={hasta >= iteracionMax} onClick={() => setHasta(iteracionMax)}>
          {hasta >= iteracionMax ? 'En vivo' : 'Volver al presente'}
        </button>
        <label htmlFor="atlas-iteracion">
          Cómo creció: hasta la iteración <strong>{Math.min(hasta, iteracionMax)}</strong> de {iteracionMax}
        </label>
        <input id="atlas-iteracion" type="range" min={1} max={iteracionMax} value={Math.min(hasta, iteracionMax)} onChange={(e) => setHasta(Number(e.target.value))} />
        {/* El espacio separa "de 14" de "1 región" para el lector de pantalla y el portapapeles; en el flex no se pinta. */}{' '}
        <span className="meta">
          {plural(conEvidencia, 'región', 'regiones')} con evidencia · {plural(hechosSituados, 'hecho')} en la figura
        </span>
      </div>
    </div>
  );
}
