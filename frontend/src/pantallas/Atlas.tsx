// El atlas de la enfermedad: dónde está la evidencia que ROSA2018 ha reunido,
// pintada sobre un corte SAGITAL del cerebro (visto de lado, partido por la
// mitad, con la frente a la izquierda). Los datos salen de lib/atlas.ts
// (construirAtlas pliega el mapa que el backend guarda al cerrar cada iteración
// por región, con filtros de fase, de tipo de célula y de iteración) y la
// geometría de lib/atlas_dibujo.ts (una figura Bézier por cada región del
// vocabulario de rosa/mapa_enfermedad.py).
//
// Cómo se ve (encargo de Emir del 21 de septiembre de 2026): debajo de las
// regiones va una ilustración anatómica real en colores naturales, la lámina
// de Lynch y Jaffe (lib/cerebro_base.ts, CC BY 2.5, con su crédito visible en
// el lienzo), y las regiones son capas semitransparentes encima. Cómo se lee
// (ajustes acordados con Emir el 18 de septiembre de 2026): cada región lleva
// DOS cifras distintas. El COLOR es cuántas cohortes distintas nombran sus
// HIPÓTESIS (el backend cuenta las cohortes de las afirmaciones de las
// hipótesis de cada celda, no de los hechos: una región con hechos y sin
// hipótesis es siempre tenue, y el panel lo dice con esas palabras), como un
// tinte ámbar sobre la lámina, de tenue (0 cohortes) a pleno (el máximo del
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
//
// La espera (estándar de Emir, 19 de septiembre de 2026): construirAtlas
// recorre todas las celdas del mapa y todas las consultas y fuentes de la
// investigación (la cobertura: qué regiones nombran) y con una investigación
// grande tarda lo bastante para congelar el clic en la barra lateral. Por eso
// no se calcula en el render sino después del pintado (lib/diferido.ts,
// useCalculoDiferido): el primer render de la pantalla, y el primero tras
// cambiar de investigación, pinta EsqueletoAtlas, la silueta del atlas con
// las mismas piezas y las mismas medidas que el contenido (cabecera, chips,
// lienzo con el óvalo del hemisferio, línea honesta, bandeja, leyenda, panel
// y deslizador), con aria-busy y un rótulo oculto. Al pulsar un chip o mover
// el deslizador NO vuelve la silueta: el mapa anterior se queda en pantalla
// con aria-busy en el marco hasta que llega el nuevo, un frame después, y
// solo si tardara más se atenúa (atlas.css). El estado vacío (sin mapa) es
// el mismo de siempre, pero también llega tras el pintado.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CertezaEvidencia, EstadoConexion, EstadoRosa, HechoMundo, Investigacion } from '../datos/tipos';
import { Esqueleto, EsqueletoTexto } from '../componentes/Esqueleto';
import { Atlas3D } from '../componentes/Atlas3D';
import { Cerebro3D, hayModeloCerebro } from '../componentes/Cerebro3D';
import { AvisoMuestra, Chip, Vacio } from '../componentes/piezas';
import { construirAtlas, ETIQUETAS_MAPA, hechosDe, hipotesisDe, intensidad, NO_LOCALIZADAS, type Atlas as DatosAtlas, type RegionAtlas } from '../lib/atlas';
import { BASE_EXTERIOR, CONTORNO_CEREBRO, finGuia, GLOBO_OCULAR, NOMBRE_CORTO, puntoMarca, RECORTADAS, RECORTE_HEMISFERIO, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA, type RegionDibujo } from '../lib/atlas_dibujo';
import { CEREBRO_BASE } from '../lib/cerebro_base';
import { recortar } from '../lib/arbol';
import { useCalculoDiferido } from '../lib/diferido';
import { CERTEZA_EVIDENCIA } from '../lib/etiquetas';
import { plural } from '../lib/formato';
import { useMovimientoReducido } from '../lib/movimiento';
import { rutaDe } from '../lib/ruta';
import '../atlas.css';
import { tr, trc, trp } from '../lib/idioma';

/** Desviación del desenfoque gaussiano de cada tramo de resplandor (1 poco, 4 mucho) y del foco. */
const RESPLANDOR = [2.5, 5, 8, 12] as const;
const RESPLANDOR_FOCO = 10;
/** Cuántos hechos se listan en el panel antes de remitir al modelo de mundo. */
const HECHOS_EN_PANEL = 8;
/** Las figuras que se pintan: todas menos las dos localizaciones fallidas, que van a la bandeja. */
const DIBUJADAS: RegionDibujo[] = REGIONES_DIBUJO.filter((r) => !NO_LOCALIZADAS.has(r.clave));
/** Lo que se dice de la bandeja, palabra por palabra como se acordó. */
const TEXTO_BANDEJA = tr('ROSA2018 los leyó pero no supo situarlos; releerlos con el catálogo de regiones es trabajo pendiente.');
/** Cuántas entradas tiene la leyenda real (Leyenda, abajo): la silueta pinta las mismas. */
const ENTRADAS_LEYENDA = 6;
/** El crédito de la ilustración base, tal como se ve en el lienzo y en la leyenda (src/datos/atlas/LICENCIA.md). */
export const CREDITO_LAMINA = (): string => trp('Ilustración base: {autores}, {centro}, {licencia} (adaptada: escala, recorte y regiones superpuestas)', { autores: CEREBRO_BASE.credito.autores, centro: CEREBRO_BASE.credito.institucion, licencia: CEREBRO_BASE.credito.licencia });
/** La lámina anatómica y los compartimentos exteriores en su color natural:
 *  un elemento creado UNA vez (150 trazados que no cambian) para que React no
 *  los vuelva a reconciliar en cada pasada del ratón por una región. */
const LAMINA = (
  <g className="atlas-silueta" aria-hidden="true">
    <g clipPath="url(#atlas-recorte-lamina)">
      {CEREBRO_BASE.campos.map((c, i) => (
        <path key={`c${i}`} d={c.d} fill={c.fill} className="atlas-lamina-campo" />
      ))}
      {CEREBRO_BASE.trazos.map((t, i) => (
        <path key={`t${i}`} d={t.d} className="atlas-lamina-tinta" />
      ))}
    </g>
    {/* El globo del ojo se rellena con el gradiente de esfera (defs de la figura); el resto, con su color plano. */}
    {Object.entries(BASE_EXTERIOR).flatMap(([clave, partes]) => partes.map((p, i) => <path key={`${clave}${i}`} d={p.d} fill={p.papel === 'globo' ? 'url(#atlas-esclera)' : p.fill} stroke={p.stroke} className={`atlas-exterior-base${p.papel ? ` atlas-exterior-${p.papel}` : ''}`} />))}
    {/* El brillo de la esfera, arriba a la izquierda. */}
    <ellipse className="atlas-exterior-brillo" cx={GLOBO_OCULAR.centro[0] - GLOBO_OCULAR.radio * 0.38} cy={GLOBO_OCULAR.centro[1] - GLOBO_OCULAR.radio * 0.4} rx={GLOBO_OCULAR.radio * 0.2} ry={GLOBO_OCULAR.radio * 0.12} />
  </g>
);
/** El rótulo oculto de la silueta, el mismo desde App.tsx y desde aquí. */
export const ROTULO_ATLAS = tr('el atlas de la enfermedad');
/** El texto FIJO de la cabecera (no depende del cálculo): el párrafo de ayuda
 *  y la primera frase del `p.meta`. Lo pintan igual la silueta (EsqueletoAtlas)
 *  y el contenido, así la cabecera mide lo mismo en el frame de la espera y en
 *  el siguiente (unas 15 líneas a 68ch: con bloques grises la silueta medía
 *  unos 200 px menos y todo lo de debajo bajaba de golpe al llegar el mapa).
 *  Compartir la cadena evita que las dos copias diverjan. */
const AYUDA_ATLAS = tr('El cerebro visto de lado y partido por la mitad (un corte sagital), con la frente a la izquierda, sobre una ilustración anatómica en colores naturales. Cada región lleva dos cifras: el color dice cuántas cohortes distintas nombran sus hipótesis (un tinte ámbar tenue, pocas o ninguna; ámbar pleno, muchas) y el número junto al nombre, cuántos registros (hechos e hipótesis) ha situado ROSA2018 en ella. A rayas, las regiones que no tienen registros: tenues si nadie las buscó, con contorno y punto si alguna consulta o fuente las nombró sin hallazgo. Un borde punteado rojo marca discordia entre hechos. Fuera del cerebro están los sitios donde también se mide la enfermedad (la sangre, la retina y el intestino) y, bajo la figura, la bandeja de lo que ROSA2018 leyó y no supo situar. Pasa el ratón por una región para ver su nombre y sus conteos; púlsala para leer qué es y qué la sostiene. Los filtros de arriba recortan por fase de la enfermedad y por tipo de célula; el deslizador de abajo enseña cómo se fue llenando el mapa iteración a iteración.');
const META_ATLAS = tr('Se recalcula al cerrar cada iteración: el mapa es una instantánea, no el modelo de mundo en vivo.');

/** Tramo de resplandor de una intensidad: 0 (sin resplandor) a 4. */
function tramo(t: number): number {
  return t <= 0 ? 0 : Math.min(RESPLANDOR.length, Math.max(1, Math.ceil(t * RESPLANDOR.length)));
}

/** Texto de conteo de una región: "8 registros de evidencia (7 hechos, 1 hipótesis)". */
function fraseConteo(r: RegionAtlas | undefined): string {
  const hechos = r?.hechos.length ?? 0;
  const hip = r?.hipotesis.length ?? 0;
  const conteo = r?.conteo ?? 0;
  return trp("{conteo} de evidencia ({hechos}, {hip})", { conteo: plural(conteo, tr("registro")), hechos: plural(hechos, tr("hecho")), hip: plural(hip, tr("hipótesis"), trc("plural", "hipótesis")) });
}

/** "56 hechos", "2 hipótesis" o "56 hechos y 2 hipótesis": lo situado por fase o célula pero sin región. */
function fraseSinRegion(a: DatosAtlas): string {
  const hechos = a.sinRegionHechos > 0 ? plural(a.sinRegionHechos, tr("hecho")) : '';
  const hip = a.sinRegionHipotesis > 0 ? plural(a.sinRegionHipotesis, tr("hipótesis"), trc("plural", "hipótesis")) : '';
  return [hechos, hip].filter(Boolean).join(' y ') || plural(a.sinRegion, tr("registro"));
}

/** La línea honesta bajo el mapa, calculada del estado. */
function fraseHonesta(a: DatosAtlas): string {
  const base = trp("{fluidos} en fluidos (sangre y LCR), {tejido} en tejido localizado, {sinLocalizar} sin localizar", { fluidos: plural(a.fluidos, tr("registro")), tejido: a.tejido, sinLocalizar: a.sinLocalizar });
  return a.enAmbos > 0 ? trp("{base} ({enAmbos} cuentan en fluidos y en tejido)", { base, enAmbos: a.enAmbos }) : base;
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
  return { texto: `${cabeza.replace(/[\s,;:(]+$/, '')}…`, titulo: trp("{nombre} (el extractor recorta los nombres a {COHORTE_RECORTADA} caracteres: este puede estar incompleto)", { nombre, COHORTE_RECORTADA }) };
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
      {nombres.length > COHORTES_EN_PANEL ? trp(" y {v} más", { v: nombres.length - COHORTES_EN_PANEL }) : ''}
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
  const filtros = conFiltros ? tr(' con los filtros puestos') : '';
  if (r.cobertura === 'buscada_sin_hallazgo') {
    const total = r.menciones.consultas + r.menciones.fuentes + r.preguntas.length;
    const partes = [r.menciones.consultas > 0 ? plural(r.menciones.consultas, tr('consulta de búsqueda'), tr('consultas de búsqueda')) : '', r.menciones.fuentes > 0 ? plural(r.menciones.fuentes, tr('fuente leída'), tr('fuentes leídas')) : '', r.preguntas.length > 0 ? plural(r.preguntas.length, tr('pregunta abierta'), tr('preguntas abiertas')) : ''].filter(Boolean);
    const verbo = total === 1 ? tr('la nombra y no produjo ningún hecho ni hipótesis situados aquí') : tr('la nombran y ninguna produjo un hecho ni una hipótesis situados aquí');
    return trp("Buscada sin hallazgo: {partes} de esta investigación {verbo}{filtros}.", { partes: enumerar(partes), verbo, filtros });
  }
  return trp("No buscada: ninguna consulta hecha ni fuente leída de esta investigación nombra esta región{filtros}. No significa que no haya nada publicado, solo que ROSA2018 no lo ha buscado ni situado aún.", { filtros });
}

function Leyenda({ atlas, conFiltros }: { atlas: DatosAtlas; conFiltros: boolean }) {
  // Los extremos escritos son los que usa la rampa de verdad: 0 cohortes en el
  // frío SIEMPRE y el máximo del mapa en el cálido (no el mínimo presente, que
  // la rampa no mira). Con un máximo de 0 nada es ámbar y se dice.
  const extremos =
    atlas.cohortesMax > 0
      ? trp("ámbar tenue, 0 cohortes; ámbar pleno, {cohortesMax} (el máximo de este mapa, en escala logarítmica)", { cohortesMax: plural(atlas.cohortesMax, tr("cohorte")) })
      : (conFiltros ? tr("con estos filtros ninguna región con registros tiene cohortes nombradas, así que todas van en ámbar tenue y nada llega al ámbar pleno") : tr("ninguna región con registros tiene cohortes nombradas, así que todas van en ámbar tenue y nada llega al ámbar pleno"));
  return (
    <ul className="atlas-leyenda" aria-label={tr("Cómo leer el atlas")}>
      <li>
        <span className="atlas-rampa-extremos" aria-hidden="true">
          <span>0</span>
          <span className="atlas-muestra atlas-muestra-rampa" />
          <span>{atlas.cohortesMax}</span>
        </span>
        <span>
          <strong>{tr("Color: cuántas cohortes distintas nombran sus hipótesis; número: cuántos registros.")}</strong>{trp(" El color base es la lámina anatómica en tonos naturales; el tinte ámbar encima es la evidencia: cuántas cohortes distintas nombran las hipótesis situadas en la región (las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos): {extremos}. El número junto al nombre es cuántos registros (hechos e hipótesis) hay situados en ella. Dos hechos de la misma cohorte no son dos evidencias independientes. {CREDITO_LAMINA}.", { extremos, CREDITO_LAMINA: CREDITO_LAMINA() })}</span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-rayas-tenues" aria-hidden="true" />
        <span>
          <strong>{tr("Rayas tenues: hueco no buscado.")}</strong> {tr("Ninguna consulta hecha ni fuente leída de esta investigación nombra la región. Sin evidencia situada todavía; no significa que no haya nada publicado.")}
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-rayas-buscada" aria-hidden="true" />
        <span>
          <strong>{tr("Rayas con contorno y punto: buscada sin hallazgo.")}</strong> {tr("Alguna consulta de búsqueda o alguna fuente leída la nombra y no produjo ningún hecho ni hipótesis situados ahí.")}
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-discordia" aria-hidden="true" />
        <span>
          <strong>{tr("Borde punteado rojo: discordia.")}</strong> {tr("Algún hecho de la región choca con otro hecho del modelo de mundo sin sustituirlo. La dirección de las citas no se pinta: hoy todas nacen marcadas «apoya» por código.")}
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-vasos" aria-hidden="true" />
        <span>
          <strong>{tr("Las líneas ramificadas: los vasos.")}</strong> {tr("La vasculatura y la barrera hematoencefálica, pintadas como trazo sobre el cerebro porque no ocupan un sitio sino que lo recorren.")}
        </span>
      </li>
      <li>
        <span className="atlas-muestra atlas-muestra-fuera" aria-hidden="true" />
        <span>
          <strong>{tr("Fuera del cerebro: donde también se mide.")}</strong> {tr("La gota es la sangre (plasma y suero); el ojo, la retina; el tubo, el intestino y su microbiota. El LCR va dentro: los ventrículos y el canal del tronco. Lo que ROSA2018 no supo situar va en la bandeja «No localizados», no en la figura.")}
        </span>
      </li>
    </ul>
  );
}

/** La silueta del atlas: lo que se pinta mientras construirAtlas corre fuera
 *  del render. Tiene las mismas piezas que el contenido y en el mismo orden
 *  (cabecera con su botón, los chips de fase y de célula, el marco con el
 *  lienzo a la izquierda y el panel a la derecha, la línea honesta, la
 *  bandeja, la leyenda y el deslizador), con las clases de maqueta reales
 *  para medir lo mismo (las medidas fijas viven en atlas.css). App.tsx la
 *  pinta también durante el primer frame tras el clic en la barra lateral,
 *  para que la silueta no cambie entre ese frame y el primero de la pantalla.
 *
 *  Tres decisiones de forma, todas para que no salte ni suene dos veces:
 *  - La caja de maqueta es la de fuera, `.contenido.contenido-ancho`, sin
 *    role: dentro van, en este orden, el aviso de datos de muestra (si
 *    `conexion` es de muestra, igual que en el contenido) y la ESPERA, un
 *    `div` con role="status", aria-busy y el rótulo oculto "Cargando ...".
 *    Así el aviso (que es su propia región viva, role="status") no queda
 *    anidado dentro de la de la espera y un lector de pantalla no lo anuncia
 *    como parte del "Cargando"; y como la espera es un bloque sin relleno ni
 *    borde, las piezas quedan exactamente donde las pone el contenido.
 *  - La cabecera lleva el texto REAL (el h2, el párrafo de ayuda y la frase
 *    fija del meta, las constantes AYUDA_ATLAS y META_ATLAS que también pinta
 *    el contenido) porque es fijo y no depende del cálculo: en gris medía
 *    unos 200 px menos y el mapa entero bajaba al llegar. Va aria-hidden para
 *    que al lector solo le llegue el rótulo. Lo único que cambia con el
 *    cálculo (la frase de los hechos nuevos del meta) no está y, si aparece,
 *    mueve una línea, no quince.
 *  - El botón "Abrir en el árbol" es un `span` con las clases reales del
 *    botón, inerte (atlas.css lo atenúa como a un botón deshabilitado): mide
 *    igual que el enlace del contenido sin ser un enlace. */
export function EsqueletoAtlas({ conexion, rotulo = tr(ROTULO_ATLAS) }: { conexion?: EstadoConexion; rotulo?: string } = {}): JSX.Element {
  return (
    <div className="contenido contenido-ancho atlas-esqueleto">
      {conexion !== undefined && <AvisoMuestra conexion={conexion} />}
      <div className="esqueleto-pantalla esqueleto-pantalla-figura atlas-esqueleto-espera" role="status" aria-busy="true">
        <span className="sr-only">{trp("Cargando {rotulo}", { rotulo })}</span>
        <div className="pantalla-cabecera" style={{ marginTop: 16 }} aria-hidden="true">
          <div>
            <h2>{tr("Atlas de la enfermedad")}</h2>
            <p>{tr(AYUDA_ATLAS)}</p>
            <p className="meta">{tr(META_ATLAS)}</p>
          </div>
          <div className="acciones">
            <span className="btn btn-s atlas-esqueleto-boton">{tr("Abrir en el árbol")}</span>
          </div>
        </div>
        <div className="atlas-controles" aria-hidden="true">
          <div className="atlas-grupo">
            <Esqueleto className="atlas-esqueleto-rotulo" />
            <Esqueleto className="atlas-esqueleto-chip" ancho={64} />
            <Esqueleto className="atlas-esqueleto-chip" ancho={152} />
            <Esqueleto className="atlas-esqueleto-chip" ancho={112} />
            <Esqueleto className="atlas-esqueleto-chip" ancho={132} />
          </div>
          <div className="atlas-grupo">
            <Esqueleto className="atlas-esqueleto-rotulo" />
            <Esqueleto className="atlas-esqueleto-chip" ancho={104} />
            <Esqueleto className="atlas-esqueleto-chip" ancho={96} />
          </div>
        </div>
        <div className="atlas-marco" aria-hidden="true">
          <div>
            <div className="atlas-lienzo">
              <div className="atlas-esqueleto-figura">
                <Esqueleto className="atlas-esqueleto-cerebro" />
                <Esqueleto className="atlas-esqueleto-fuera atlas-esqueleto-retina" />
                <Esqueleto className="atlas-esqueleto-fuera atlas-esqueleto-sangre" />
                <Esqueleto className="atlas-esqueleto-fuera atlas-esqueleto-intestino" />
              </div>
            </div>
            <p className="atlas-honesta">
              <Esqueleto className="atlas-esqueleto-linea" />
            </p>
            <section className="atlas-bandeja">
              <Esqueleto className="atlas-esqueleto-h4" />
              <EsqueletoTexto lineas={2} />
              <div className="atlas-esqueleto-chips">
                <Esqueleto className="atlas-esqueleto-chip" ancho={168} />
                <Esqueleto className="atlas-esqueleto-chip" ancho={152} />
              </div>
            </section>
            <ul className="atlas-leyenda">
              {Array.from({ length: ENTRADAS_LEYENDA }, (_, i) => (
                <li key={i}>
                  <Esqueleto className="atlas-esqueleto-muestra" />
                  <EsqueletoTexto lineas={3} />
                </li>
              ))}
            </ul>
          </div>
          <aside className="grafo-panel atlas-panel">
            <Esqueleto className="atlas-esqueleto-h3" />
            <EsqueletoTexto lineas={4} />
            <EsqueletoTexto lineas={6} />
            <Esqueleto className="atlas-esqueleto-h4" />
            <EsqueletoTexto lineas={3} />
          </aside>
        </div>
        <div className="grafo-tiempo" aria-hidden="true">
          <Esqueleto className="esqueleto-boton" />
          <Esqueleto className="atlas-esqueleto-etiqueta" />
          <Esqueleto className="atlas-esqueleto-rango" />
          <Esqueleto className="atlas-esqueleto-etiqueta" ancho={200} />
        </div>
      </div>
    </div>
  );
}

/** Lo que se calcula fuera del render: la base (solo con el filtro de tiempo,
 *  para los chips y el máximo de iteraciones) y el atlas con todos los
 *  filtros (lo que se pinta). `invId` dice de qué investigación es, para
 *  volver a la silueta si la pantalla cambia de investigación sin desmontarse. */
type DatosCalculados = { invId: string; base: DatosAtlas | null; atlas: DatosAtlas | null };

export function Atlas({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  // El atlas abre en relieve (Emir, 21 de septiembre de 2026: "quiero que
  // pongas el 3d como default siempre"). La vista 2D sigue a un botón y es la
  // que se imprime, la que leen los lectores de pantalla region a region y la
  // que queda si el navegador no sabe dibujar el lienzo.
  const [vista3d, setVista3d] = useState(true);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [estadio, setEstadio] = useState<string | null>(null);
  const [celulas, setCelulas] = useState<string[]>([]);
  // El deslizador "Cómo creció": null es el presente ("En vivo"). Antes
  // guardaba el número de la última iteración, que se conocía en el primer
  // render porque el atlas se construía en él; ahora se construye después del
  // pintado y el presente tiene que poder decirse sin conocer ese número.
  const [hasta, setHasta] = useState<number | null>(null);
  const reducido = useMovimientoReducido();
  // La base se guarda por referencia: pulsar un chip de fase o de célula solo
  // construye el atlas filtrado, no los dos (misma economía que tenían los
  // useMemo, ahora fuera del render).
  const memoBase = useRef<{ estado: EstadoRosa; inv: Investigacion; hasta: number | null; base: DatosAtlas | null } | null>(null);
  const { valor: datos, calculando } = useCalculoDiferido<DatosCalculados>(() => {
    const m = memoBase.current;
    const base = m && m.estado === estado && m.inv === inv && m.hasta === hasta ? m.base : construirAtlas(estado, inv, { hasta });
    memoBase.current = { estado, inv, hasta, base };
    // Sin base (mapa ausente o sin celdas) tampoco hay atlas: construirAtlas devolvería null igual.
    const atlas = base === null ? null : construirAtlas(estado, inv, { estadio, celulas, hasta });
    return { invId: inv.id, base, atlas };
  }, [estado, inv, estadio, celulas, hasta]);
  // Silueta solo al abrir y al cambiar de investigación. Con un filtro nuevo o
  // un empuje del canal en vivo `datos` es el cálculo anterior de la misma
  // investigación y se conserva en pantalla hasta que llega el nuevo.
  const vigente = datos !== null && datos.invId === inv.id ? datos : null;
  const atlas: DatosAtlas | null = vigente?.atlas ?? null;
  const base: DatosAtlas | null = vigente?.base ?? null;
  const porClave = useMemo(() => new Map((atlas?.regiones ?? []).map((r) => [r.clave, r] as const)), [atlas]);
  // El máximo de iteraciones lo calcula construirAtlas ANTES de aplicar el
  // filtro de tiempo, así que la base lo trae entero aunque el deslizador esté atrás.
  const iteracionMax = Math.max(1, base?.iteracionMax ?? 1);
  const hastaVisible = hasta !== null && hasta < iteracionMax ? hasta : iteracionMax;
  const enVivo = hastaVisible >= iteracionMax;
  // Otra investigación: se olvidan la selección y los filtros, el deslizador vuelve al presente.
  useEffect(() => {
    setSeleccion(null);
    setFoco(null);
    setEstadio(null);
    setCelulas((c) => (c.length === 0 ? c : []));
    setHasta(null);
  }, [inv.id]);

  if (vigente === null) return <EsqueletoAtlas conexion={estado.conexion} />;

  if (!atlas || !base) {
    return (
      <div className="contenido">
        <AvisoMuestra conexion={estado.conexion} />
        <Vacio titulo={tr("El atlas todavía no tiene evidencia situada")} accion={<a className="btn btn-s" href={rutaDe(inv.id, 'arbol')}>{tr("Abrir en el árbol")}</a>}>
          {tr("ROSA2018 dibuja el atlas al cerrar la primera iteración de esta investigación: sitúa cada hecho por región del cerebro, estadio de la enfermedad y tipo de célula.")}
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
  const conFiltros = estadio !== null || celulas.length > 0 || !enVivo;
  const sel = seleccion ? porClave.get(seleccion) ?? null : null;
  const selDibujo = seleccion ? DIBUJADAS.find((r) => r.clave === seleccion) ?? null : null;
  const focoDibujo = foco ? DIBUJADAS.find((r) => r.clave === foco) ?? null : null;
  const focoDatos = foco ? porClave.get(foco) : undefined;
  // Regiones que el backend añadió después de este dibujo: se listan, no se pierden.
  const dibujadas = new Set(DIBUJADAS.map((r) => r.clave));
  const sinDibujo = enFigura.filter((r) => !dibujadas.has(r.clave));
  const bandeja = atlas.regiones.filter((r) => NO_LOCALIZADAS.has(r.clave));
  const etiquetaEstadio = (clave: string) => base.estadios.find((e) => e.clave === clave)?.etiqueta ?? ETIQUETAS_MAPA.estadio[clave] ?? (clave === '' ? tr('sin fase identificada') : clave);
  const etiquetaCelula = (clave: string) => base.celulas.find((c) => c.clave === clave)?.etiqueta ?? ETIQUETAS_MAPA.tipoCelular[clave] ?? clave;
  const seleccionar = (clave: string) => setSeleccion((s) => (s === clave ? null : clave));
  const alTeclado = (e: React.KeyboardEvent, clave: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      seleccionar(clave);
    }
  };
  const alternarCelula = (clave: string) => setCelulas((c) => (c.includes(clave) ? c.filter((x) => x !== clave) : [...c, clave]));
  // El deslizador en su máximo es el presente: se guarda como null para que
  // una iteración nueva no lo deje atrás y para no recalcular nada al soltarlo ahí.
  const moverHasta = (valor: number) => setHasta(valor >= iteracionMax ? null : valor);
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
        ? (focoDatos?.cobertura === 'buscada_sin_hallazgo' ? tr("hueco: sin evidencia situada (buscada sin hallazgo)") : tr("hueco: sin evidencia situada (no buscada)"))
        : `${focoDatos?.conteo ?? 0} · ${plural(focoDatos?.hechos.length ?? 0, tr("hecho"))}, ${plural(focoDatos?.hipotesis.length ?? 0, tr("hipótesis"), trc("plural", "hipótesis"))} · ${plural(focoDatos?.cohortes.length ?? 0, tr("cohorte"))}`;
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
          <h2>{tr("Atlas de la enfermedad")}</h2>
          <p>{tr(AYUDA_ATLAS)}</p>
          <p className="meta">
            {tr(META_ATLAS)}
            {atlas.hechosNuevos > 0 ? trp(" {hechosNuevos} a la siguiente iteración para situarse.", { hechosNuevos: plural(atlas.hechosNuevos, tr('hecho nuevo espera'), tr('hechos nuevos esperan')) }) : ''}
          </p>
        </div>
        <div className="acciones">
          <a className="btn btn-s" href={rutaDe(inv.id, 'arbol')}>
            {tr("Abrir en el árbol")}
          </a>
        </div>
      </div>

      <div className="atlas-controles">
        <div className="atlas-grupo" role="group" aria-label={tr("Vista del atlas")}>
          <button type="button" className="atlas-chip" aria-pressed={!vista3d} onClick={() => setVista3d(false)}>{tr("Vista 2D")}</button>
          <button type="button" className="atlas-chip" aria-pressed={vista3d} onClick={() => setVista3d(true)}>{tr("Vista 3D")}</button>
        </div>
        <div className="atlas-grupo" role="group" aria-label={tr("Fase de la enfermedad")}>
          <span className="atlas-grupo-titulo">{tr("Fase")}</span>
          <button type="button" className="atlas-chip" aria-pressed={estadio === null} onClick={() => setEstadio(null)} title={tr("Toda la evidencia, en cualquier fase de la enfermedad")}>
            {tr("Todas")}
          </button>
          {base.estadios.map((e) => (
            <button key={e.clave || 'sin'} type="button" className="atlas-chip" aria-pressed={estadio === e.clave} onClick={() => setEstadio((actual) => (actual === e.clave ? null : e.clave))} title={base.definiciones.estadio?.[e.clave] ?? (e.clave === '' ? tr('Registros con región o célula pero sin fase identificada por su contenido ni por la misión.') : undefined)}>
              {e.etiqueta} <span className="atlas-cifra">{e.conteo}</span>
            </button>
          ))}
        </div>
        <div className="atlas-grupo" role="group" aria-label={tr("Tipo de célula")}>
          <span className="atlas-grupo-titulo">{tr("Célula")}</span>
          {base.celulas.length === 0 ? (
            <span className="meta">{tr("sin tipo celular situado todavía")}</span>
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

      {/* Mientras llega el atlas con filtros nuevos el marco lleva aria-busy y se queda el anterior (atlas.css lo atenúa solo si tarda). */}
      <div className="atlas-marco" aria-busy={calculando ? true : undefined}>
        <div>
          {vista3d ? (hayModeloCerebro()
            ? <Cerebro3D key={inv.id} atlas={atlas} seleccion={seleccion} seleccionar={seleccionar} />
            : <Atlas3D key={inv.id} atlas={atlas} seleccion={seleccion} seleccionar={seleccionar} />) : <div className={`atlas-lienzo${reducido ? ' atlas-sin-movimiento' : ''}`}>
            <svg className="atlas-figura" viewBox={`0 0 ${VISTA.ancho} ${VISTA.alto}`} role="group" aria-label={trp("Atlas de {titulo}: corte sagital del cerebro con {conEvidencia} con evidencia de {DIBUJADAS}", { titulo: inv.titulo, conEvidencia: plural(conEvidencia, tr('región'), tr("regiones")), DIBUJADAS: DIBUJADAS.length })}>
              <defs>
                <clipPath id="atlas-recorte">
                  <path d={RECORTE_HEMISFERIO} />
                </clipPath>
                <clipPath id="atlas-recorte-lamina">
                  <rect width={VISTA.ancho} height={CEREBRO_BASE.encaje.recorteY} />
                </clipPath>
                {/* La esclera como esfera: luz arriba a la izquierda, sombra hacia el borde. */}
                <radialGradient id="atlas-esclera" cx="0.36" cy="0.34" r="0.72">
                  <stop offset="0" stopColor="#fbf8f2" />
                  <stop offset="0.62" stopColor="#efe7dc" />
                  <stop offset="1" stopColor="#b8a897" />
                </radialGradient>
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
              {/* La lámina anatómica en colores naturales y los compartimentos de fuera en el suyo: la silueta neutra, sin conteo. */}
              {LAMINA}
              <g className="atlas-regiones">
                {DIBUJADAS.map((r) => {
                  const datosRegion = porClave.get(r.clave);
                  const conteo = datosRegion?.conteo ?? 0;
                  const cohortes = datosRegion?.cohortes.length ?? 0;
                  const t = intensidad(cohortes, atlas.cohortesMax);
                  const nivel = tramo(t);
                  const capa = r.capa ?? 'region';
                  const cobertura = datosRegion?.cobertura ?? 'no_buscada';
                  const buscada = cobertura === 'buscada_sin_hallazgo';
                  const discordia = datosRegion?.discordia.length ?? 0;
                  const clases = ['atlas-region', `atlas-capa-${capa}`, conteo === 0 ? `atlas-hueco ${buscada ? 'atlas-buscada' : 'atlas-no-buscada'}` : nivel > 0 ? `atlas-resplandor-${nivel}` : '', seleccion === r.clave ? 'atlas-seleccionada' : '', foco === r.clave ? 'atlas-foco' : '', discordia > 0 ? 'atlas-con-discordia' : ''].filter(Boolean).join(' ');
                  const nombre = datosRegion?.etiqueta ?? ETIQUETAS_MAPA.region[r.clave] ?? nombreCorto(r.clave, datosRegion);
                  const hueco = conteo === 0 ? (buscada ? tr("; hueco: sin evidencia situada todavía (buscada sin hallazgo)") : tr("; hueco: sin evidencia situada todavía (no buscada)")) : '';
                  const choque = discordia > 0 ? trp("; discordia: {discordia} con otro hecho", { discordia: plural(discordia, tr('hecho choca'), tr('hechos chocan')) }) : '';
                  const etiquetaAccesible = `${nombre}: ${fraseConteo(datosRegion)}; ${plural(cohortes, tr('cohorte distinta'), tr('cohortes distintas'))}${hueco}${choque}`;
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
                  const datosRegion = porClave.get(r.clave);
                  if (!datosRegion) return null;
                  const buscada = datosRegion.conteo === 0 && datosRegion.cobertura === 'buscada_sin_hallazgo';
                  const discordia = datosRegion.discordia.length > 0;
                  if (!buscada && !discordia) return null;
                  const { nombre, cifra } = textoEtiqueta(r.clave, datosRegion);
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
              {selDibujo && <path d={selDibujo.d} className={`atlas-seleccion-halo atlas-capa-${selDibujo.capa ?? 'region'}`} clipPath={RECORTADAS.has(selDibujo.clave) ? 'url(#atlas-recorte)' : undefined} fillRule="evenodd" aria-hidden="true" />}
              {selDibujo && <path d={selDibujo.d} className={`atlas-seleccion atlas-capa-${selDibujo.capa ?? 'region'}`} clipPath={RECORTADAS.has(selDibujo.clave) ? 'url(#atlas-recorte)' : undefined} fillRule="evenodd" aria-hidden="true" />}
              <g className="atlas-etiquetas" aria-hidden="true">
                {DIBUJADAS.map((r) => {
                  const datosRegion = porClave.get(r.clave);
                  const conteo = datosRegion?.conteo ?? 0;
                  const { nombre, cifra } = textoEtiqueta(r.clave, datosRegion);
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
              <text className="atlas-credito" x={10} y={VISTA.alto - 7} aria-hidden="true">
                {CREDITO_LAMINA()}
              </text>
            </svg>
          </div>}
          <p className="atlas-honesta">
            <strong>{fraseHonesta(atlas)}</strong>
            {(conFiltros ? tr(" (con los filtros puestos).") : tr("."))}
          </p>
          <section className="atlas-bandeja" aria-label={tr("No localizados")}>
            <h4>
              {tr("No localizados")} <span className="atlas-cifra">{atlas.noLocalizados.conteo}</span>
            </h4>
            <p className="meta">
              {atlas.noLocalizados.conteo > 0 ? trp("{conteo} ({hechos}, {hipotesis}) cuya fuente dice «cerebro» o «corteza» sin más. ", { conteo: plural(atlas.noLocalizados.conteo, tr("registro")), hechos: plural(atlas.noLocalizados.hechos, tr("hecho")), hipotesis: plural(atlas.noLocalizados.hipotesis, tr("hipótesis"), trc("plural", "hipótesis")) }) : tr('Ningún registro cayó en «cerebro» o «corteza» sin región. ')}
              {tr(TEXTO_BANDEJA)}
              {atlas.noLocalizados.tambienSituados > 0 ? trp(" {tambienSituados} además en alguna región localizada (la sangre, por ejemplo) y cuentan allí.", { tambienSituados: plural(atlas.noLocalizados.tambienSituados, tr('registro de estos está'), tr('registros de estos están')) }) : ''}
            </p>
            <ul>
              {bandeja.map((r) => (
                <li key={r.clave}>
                  <button type="button" className="atlas-bandeja-item" data-clave={r.clave} aria-pressed={seleccion === r.clave} aria-label={trp("{etiqueta}: {r}; no localizado", { etiqueta: r.etiqueta, r: fraseConteo(r) })} onClick={() => seleccionar(r.clave)} title={r.definicion}>
                    {r.etiqueta} <span className="atlas-cifra">{r.conteo}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {sinDibujo.length > 0 && (
            <p className="meta atlas-nuevas">
              {tr("Regiones nuevas del servidor que este dibujo aún no tiene:")}{' '}
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
              <Chip tono={selNoLocalizada ? 'aviso' : 'acento'}>{selNoLocalizada ? tr('No localizado') : selDibujo?.exterior ? 'Compartimento' : selDibujo?.capa === 'fondo' ? 'Capa' : tr('Región')}</Chip>
              <h3>{sel.etiqueta}</h3>
              {sel.definicion && <p className="meta">{sel.definicion}</p>}
              {selNoLocalizada && <p className="atlas-hueco-aviso">{trp("Localización fallida, no un lugar: {TEXTO_BANDEJA} Estos registros no se pintan en la figura.", { TEXTO_BANDEJA: tr(TEXTO_BANDEJA) })}</p>}
              {sel.conteo === 0 ? (
                <p className="atlas-hueco-aviso">{trp("Hueco: sin evidencia situada todavía. {sel}", { sel: fraseCobertura(sel, conFiltros) })}</p>
              ) : (
                <div className="atlas-cifras">
                  <span>{plural(sel.hechos.length, tr("hecho"))}</span>
                  <span>{plural(sel.hipotesis.length, tr("hipótesis"), trc("plural", "hipótesis"))}</span>
                  {sel.preguntas.length > 0 && <span>{plural(sel.preguntas.length, tr('pregunta abierta'), tr('preguntas abiertas'))}</span>}
                </div>
              )}
              {sel.sinResolver > 0 && (
                <p className="meta">
                  {/* El mapa es una instantánea del cierre de la iteración; después los hechos se sustituyen o se descartan. Las cifras los cuentan (cuadran con el backend), las listas no pueden traerlos. */}
                  {trp("{v} en el modelo de mundo (sustituidos o descartados después de calcular el mapa): cuentan en las cifras y no aparecen en las listas de abajo.", { v: sel.sinResolver === 1 ? tr('Uno de ellos ya no está') : trp("{sinResolver} de ellos ya no están", { sinResolver: sel.sinResolver }) })}
                </p>
              )}
              {sel.conteo > 0 && !selNoLocalizada && (
                <p className="meta">
                  {/* Las cohortes salen SOLO de las afirmaciones de las hipótesis (rosa/mapa_enfermedad.py): un hecho que nombra ADNI no cuenta. Se dice tal cual, sin afirmar nada sobre los hechos. */}
                  {sel.cohortes.length > 0 ? (
                    <>
                      <strong>{plural(sel.cohortes.length, tr('cohorte distinta'), tr('cohortes distintas'))}</strong> {tr("nombran sus hipótesis (su color):")} <ListaCohortes nombres={sel.cohortes} />.
                    </>
                  ) : sel.hipotesis.length > 0 ? (
                    <>
                      <strong>{tr("Sus hipótesis no nombran ninguna cohorte")}</strong>{trp(" (las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos): el color queda en el extremo frío aunque tenga {conteo}.", { conteo: plural(sel.conteo, tr("registro")) })}</>
                  ) : (
                    <>
                      <strong>{tr("Sin hipótesis situadas aquí")}</strong>{trp(", y las cohortes se cuentan de las afirmaciones de las hipótesis, no de los hechos: el color queda en el extremo frío aunque alguno de sus {hechos} nombre una cohorte.", { hechos: plural(sel.hechos.length, tr("hecho")) })}</>
                  )}
                </p>
              )}
              {sel.conteo > 0 && selNoLocalizada && sel.cohortes.length > 0 && (
                <p className="meta">
                  {tr("Cohortes que nombran sus hipótesis:")} <ListaCohortes nombres={sel.cohortes} />.
                </p>
              )}
              {sel.discordia.length > 0 && (
                <div className="atlas-discordia-aviso">
                  <strong>{tr("Discordia:")}</strong> {plural(sel.discordia.length, tr('hecho de esta región choca'), tr('hechos de esta región chocan'))} {tr("con otro hecho del modelo de mundo sin sustituirlo. La dirección de las citas no se usa para esta marca.")}
                  {discordiaSel.length > 0 && (
                    <ul>
                      {discordiaSel.map((h) => {
                        const contra = hechosDe(estado, h.contradiceA ?? []);
                        return (
                          <li key={h.id}>
                            {recortar(h.enunciado, 120)}
                            {contra.length > 0 ? trp(" Choca con: {v}", { v: contra.map((c) => recortar(c.enunciado, 90)).join(' | ') }) : trp(" Choca con {length} que ya no están en el modelo de mundo.", { length: plural((h.contradiceA ?? []).length, tr("hecho")) })}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              {certezaSel ? (
                <p className="meta">
                  {tr("Mayor certeza GRADE entre sus hipótesis:")} <Chip tono={certezaSel.tono}>{certezaSel.etiqueta.replace('Certeza ', '')}</Chip>
                </p>
              ) : hipotesisSel.length > 0 ? (
                <p className="meta">{tr("Sin conclusión con certeza GRADE todavía.")}</p>
              ) : null}
              {Object.values(sel.porEstadio).some((v) => v > 0) && (
                <>
                  <h4>{tr("Por fase de la enfermedad")}</h4>
                  <ul className="atlas-barras">{barras(sel.porEstadio, etiquetaEstadio)}</ul>
                </>
              )}
              {Object.values(sel.porCelula).some((v) => v > 0) && (
                <>
                  <h4>{tr("Por tipo de célula")}</h4>
                  <ul className="atlas-barras">{barras(sel.porCelula, etiquetaCelula)}</ul>
                </>
              )}
              {hipotesisSel.length > 0 && (
                <>
                  <h4>{trp("Hipótesis ({hipotesisSel})", { hipotesisSel: hipotesisSel.length })}</h4>
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
                  <h4>{trp("Hechos ({hechosSel})", { hechosSel: hechosSel.length })}</h4>
                  <ul className="atlas-lista">
                    {hechosSel.slice(0, HECHOS_EN_PANEL).map((h) => (
                      <li key={h.id}>
                        {recortar(h.enunciado, 150)}
                        <span className="meta">{h.tema}</span>
                      </li>
                    ))}
                  </ul>
                  <a className="btn btn-s" href={rutaDe(inv.id, 'mundo')}>
                    {hechosSel.length > HECHOS_EN_PANEL ? trp("Ver los {hechosSel} en el modelo de mundo", { hechosSel: hechosSel.length }) : tr('Ver en el modelo de mundo')}
                  </a>
                </>
              )}
              {preguntasSel.length > 0 && (
                <>
                  <h4>{trp("Preguntas abiertas ({preguntasSel})", { preguntasSel: preguntasSel.length })}</h4>
                  <ul className="atlas-lista">
                    {preguntasSel.map((p) => (
                      <li key={p.id}>{recortar(p.enunciado, 120)}</li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className="btn btn-s" onClick={() => setSeleccion(null)}>
                {tr("Quitar la selección")}
              </button>
            </>
          ) : (
            <>
              <h3>{tr("El mapa en cifras")}</h3>
              {atlas.resumen && <p className="meta">{atlas.resumen}</p>}
              {atlas.ejesDesfasados.length > 0 && (
                <p className="meta atlas-desfase" title={atlas.ejesDesfasados.join('; ')}>
                  {trp("Estas cifras se calculan de las celdas del mapa. Los conteos que el backend guardó al calcularlo ya no cuadran con ellas en {ejesDesfasados} (fundió hechos duplicados después de situarlos), así que no se enseñan.", { ejesDesfasados: plural(atlas.ejesDesfasados.length, tr("conteo")) })}
                </p>
              )}
              <ul className="atlas-lista">
                <li>
                  <strong>{plural(conEvidencia, tr('región'), tr("regiones"))}</strong>{(conFiltros ? trp(" con evidencia de {DIBUJADAS}; {hechosSituados} y {hipotesisSituadas} en la figura con los filtros puestos.", { DIBUJADAS: DIBUJADAS.length, hechosSituados: plural(hechosSituados, tr("hecho")), hipotesisSituadas: plural(hipotesisSituadas, tr("hipótesis"), trc("plural", "hipótesis")) }) : trp(" con evidencia de {DIBUJADAS}; {hechosSituados} y {hipotesisSituadas} en la figura.", { DIBUJADAS: DIBUJADAS.length, hechosSituados: plural(hechosSituados, tr("hecho")), hipotesisSituadas: plural(hipotesisSituadas, tr("hipótesis"), trc("plural", "hipótesis")) }))}</li>
                <li>{fraseHonesta(atlas)}.</li>
                {atlas.noLocalizados.conteo > 0 && (
                  <li>
                    <strong>{plural(atlas.noLocalizados.conteo, tr('registro no localizado'), tr('registros no localizados'))}</strong> {tr("(«cerebro» o «corteza» sin región): en la bandeja bajo la figura, no en la anatomía.")}
                  </li>
                )}
                {atlas.sinRegion > 0 && (
                  <li>
                    {/* El backend sitúa por tres ejes; lo que tiene fase o célula pero no región cuenta en su resumen y no cabe en un dibujo por regiones. Sin esta línea el panel se contradice a sí mismo (217 arriba, 170 en la figura). */}
                    <strong>{trp("{atlas} con fase o tipo de célula pero sin región del cerebro", { atlas: fraseSinRegion(atlas) })}</strong>{tr(": cuentan en el resumen de arriba y no están en la figura.")}
                  </li>
                )}
                {atlas.discordantes > 0 && (
                  <li>
                    <strong>{plural(atlas.discordantes, tr('hecho en discordia'), tr('hechos en discordia'))}</strong> {tr("en la figura (chocan con otro hecho): las regiones con borde punteado rojo.")}
                  </li>
                )}
                {atlas.sinEjes > 0 && (
                  <li>
                    <strong>{trp("{sinEjes} sin situar", { sinEjes: plural(atlas.sinEjes, tr("hecho")) })}</strong>{tr(": su texto no nombra región, fase ni tipo de célula. Cuentan en el modelo de mundo, no aquí.")}
                  </li>
                )}
                {atlas.hipotesisSinEjes > 0 && <li>{trp("{hipotesisSinEjes} sin situar.", { hipotesisSinEjes: plural(atlas.hipotesisSinEjes, tr("hipótesis"), trc("plural", "hipótesis")) })}</li>}
                {atlas.heredados > 0 && <li>{trp("{heredados} de otra investigación, ya situados.", { heredados: plural(atlas.heredados, tr('hecho heredado'), tr('hechos heredados')) })}</li>}
                {atlas.iteracionOrdinal !== null ? (
                  <li className="meta">{trp("Mapa calculado al cerrar la iteración {iteracionOrdinal} de {iteracionMax}. Se recalcula al cerrar cada iteración.", { iteracionOrdinal: atlas.iteracionOrdinal, iteracionMax })}</li>
                ) : atlas.iteracion !== null ? (
                  <li className="meta">{trp("Mapa calculado al cerrar la iteración {iteracion} de su corrida. Se recalcula al cerrar cada iteración.", { iteracion: atlas.iteracion })}</li>
                ) : (
                  <li className="meta">{tr("Se recalcula al cerrar cada iteración.")}</li>
                )}
                {atlas.hechosNuevos > 0 && <li className="meta">{trp("{hechosNuevos} en el modelo de mundo desde entonces, todavía sin situar: ROSA2018 los sitúa al cerrar la iteración.", { hechosNuevos: plural(atlas.hechosNuevos, tr('hecho nuevo'), tr('hechos nuevos')) })}</li>}
              </ul>
              {atlas.huecos.length > 0 && (
                <>
                  <h4>{tr("Huecos que la misión nombra")}</h4>
                  <ul className="atlas-lista">
                    {atlas.huecos.slice(0, 6).map((h, i) => (
                      <li key={i} className="meta">
                        {h}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4>{tr("Cómo leerlo")}</h4>
              <ul className="atlas-lista">
                <li>{tr("Pulsa una región para ver sus cohortes, sus hechos, sus hipótesis y sus preguntas abiertas.")}</li>
                <li>{tr("Color: cuántas cohortes distintas nombran sus hipótesis; número: cuántos registros. A rayas tenues, hueco no buscado; con contorno y punto, buscado sin hallazgo.")}</li>
                <li>{tr("Los lóbulos van por fuera; dentro, la sustancia blanca y, encima, los núcleos profundos, los ventrículos y el hipocampo. Lo no localizado va en la bandeja de abajo.")}</li>
              </ul>
            </>
          )}
        </aside>
      </div>

      <div className="grafo-tiempo">
        <button type="button" className="btn btn-s" aria-pressed={enVivo} onClick={() => setHasta(null)}>
          {(enVivo ? tr("En vivo") : tr("Volver al presente"))}
        </button>
        <label htmlFor="atlas-iteracion">
          {tr("Cómo creció: hasta la iteración")} <strong>{hastaVisible}</strong>{trp(" de {iteracionMax}", { iteracionMax })}
        </label>
        <input id="atlas-iteracion" type="range" min={1} max={iteracionMax} value={hastaVisible} onChange={(e) => moverHasta(Number(e.target.value))} />
        {/* El espacio separa "de 14" de "1 región" para el lector de pantalla y el portapapeles; en el flex no se pinta. */}{' '}
        <span className="meta">
          {trp("{conEvidencia} con evidencia · {hechosSituados} en la figura", { conEvidencia: plural(conEvidencia, tr('región'), tr("regiones")), hechosSituados: plural(hechosSituados, tr("hecho")) })}</span>
      </div>
    </div>
  );
}
