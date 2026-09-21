// Esqueletos de carga de ROSA2018 (estándar de Emir, 19 de septiembre de 2026).
//
// Toda espera visible se enseña con bloques grises que tienen la silueta del
// contenido que va a llegar (filas, tarjetas, gráfico, panel), con un brillo
// suave que se apaga si la persona tiene reducido el movimiento. Nunca una
// pantalla vacía ni un salto de maqueta al llegar el contenido: por eso los
// esqueletos reutilizan las clases reales de la maqueta (`contenido`,
// `pantalla-cabecera`, `tarjeta`, `barra`, `nav-inv`) y miden lo mismo que lo
// que sustituyen. Medido en Chromium a 1440 px (19 de septiembre de 2026): la
// cabecera real mide 28 px de título más 4 px y 21,7 px por línea de
// descripción (55 con una línea, 75 con dos, 97 con tres, 118 con cuatro), y
// lleva 16 px de margen superior en las pantallas que van debajo del aviso
// de muestra; por eso la silueta recibe esas medidas (`lineasDescripcion`,
// `margenSuperior`) o, mejor, el texto real de la cabecera (`cabecera`), que
// mide exactamente lo mismo porque usa las mismas clases.
//
// Accesibilidad: cada bloque gris lleva `aria-hidden` (no dice nada por sí
// solo); el contenedor de la espera lleva `aria-busy="true"` y un rótulo
// visualmente oculto ("Cargando <rótulo>") que sí leen los lectores de
// pantalla. El texto "Cargando" nunca es el único indicador.
//
// Piezas (de menor a mayor):
//   Esqueleto          un bloque gris con brillo.
//   EsqueletoTexto     líneas de párrafo.
//   EsqueletoChips     una fila de chips.
//   EsqueletoFilas     una tabla o lista (filas por columnas).
//   EsqueletoTarjetas  una lista de tarjetas (la cola, el ranking).
//   EsqueletoTarjeta   una tarjeta con título opcional y líneas.
//   EsqueletoPantalla  la silueta completa de una pantalla, ya con aria-busy.
//   EsqueletoAplicacion la maqueta entera (barra lateral, cabecera, contenido),
//                      para la carga inicial antes de tener el estado.
//   Cargando           el interruptor: si `activo`, pinta el esqueleto; si no,
//                      los hijos.
//
// Los estilos viven en styles.css con el prefijo `esqueleto-` y los tokens
// `--esqueleto-base` y `--esqueleto-brillo` (tema claro y oscuro).

import { cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react';

type PropsEsqueleto = {
  /** Ancho CSS (número en píxeles o cadena con unidad). Por defecto, 100%. */
  ancho?: string | number;
  /** Alto CSS (número en píxeles o cadena con unidad). Por defecto, 14px. */
  alto?: string | number;
  /** Radio de las esquinas en píxeles. Por defecto, el radio pequeño del tema. */
  radio?: number;
  className?: string;
  /** Los bloques son decorativos: por defecto quedan fuera del árbol accesible. */
  'aria-hidden'?: boolean;
};

/** Un bloque gris con brillo suave. Es la unidad de todos los esqueletos. */
export function Esqueleto({ ancho, alto, radio, className, 'aria-hidden': oculto = true }: PropsEsqueleto): JSX.Element {
  const estilo: CSSProperties = {};
  if (ancho !== undefined) estilo.width = ancho;
  if (alto !== undefined) estilo.height = alto;
  if (radio !== undefined) estilo.borderRadius = radio;
  return <span className={`esqueleto ${className ?? ''}`.trim()} style={estilo} aria-hidden={oculto ? true : undefined} />;
}

/** Líneas de párrafo. La última sale más corta, como un párrafo real. */
export function EsqueletoTexto({ lineas = 3, ultimaCorta = true }: { lineas?: number; ultimaCorta?: boolean }): JSX.Element {
  const total = Math.max(1, Math.floor(lineas));
  return (
    <div className="esqueleto-texto" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <Esqueleto key={i} className={`esqueleto-linea ${ultimaCorta && i === total - 1 ? 'esqueleto-linea-corta' : ''}`.trim()} />
      ))}
    </div>
  );
}

/** Una fila de chips (estado, cluster, certeza), con la altura de un chip
 *  real (22 px) y anchos que alternan para que parezcan etiquetas. */
export function EsqueletoChips({ cuantos = 3, anchos }: { cuantos?: number; anchos?: number[] }): JSX.Element {
  const total = Math.max(1, Math.floor(cuantos));
  const base = anchos ?? [88, 64, 104, 72, 96];
  return (
    <div className="esqueleto-chips" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <Esqueleto key={i} className="esqueleto-chip" ancho={base[i % base.length]} />
      ))}
    </div>
  );
}

/** Una tabla o lista: `filas` filas con `columnas` celdas cada una, con la
 *  altura de una fila de `.tabla` para que el cambio no salte. */
export function EsqueletoFilas({ filas = 5, columnas = 3 }: { filas?: number; columnas?: number }): JSX.Element {
  const nFilas = Math.max(1, Math.floor(filas));
  const nColumnas = Math.max(1, Math.floor(columnas));
  return (
    <div className="esqueleto-filas" aria-hidden="true">
      {Array.from({ length: nFilas }, (_, f) => (
        <div key={f} className="esqueleto-fila" style={{ gridTemplateColumns: `repeat(${nColumnas}, minmax(0, 1fr))` }}>
          {Array.from({ length: nColumnas }, (_, c) => (
            <Esqueleto key={c} className="esqueleto-celda" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Una lista de tarjetas apiladas con 10 px entre ellas (la clase real
 *  `.cola`): la forma del ranking y de la cola de hipótesis. Cada tarjeta
 *  trae un título, una o dos líneas y una fila de chips, y `altoFila` fija
 *  su alto mínimo para medir lo que la fila real (medido: 154 a 201 px en
 *  el ranking, 84 o 109 en la cola). Las filas conservan la clase
 *  `esqueleto-fila` para que la forma de la silueta sea la misma que la de
 *  la tabla a ojos de quien la coteja (App.esqueleto.test.tsx). */
export function EsqueletoTarjetas({ filas = 5, altoFila, className }: { filas?: number; altoFila?: number; className?: string }): JSX.Element {
  const total = Math.max(1, Math.floor(filas));
  const estilo = altoFila !== undefined ? { minHeight: altoFila } : undefined;
  return (
    <div className={`esqueleto-filas esqueleto-tarjetas ${className ?? ''}`.trim()} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="esqueleto-fila esqueleto-fila-tarjeta" style={estilo}>
          <Esqueleto className={`esqueleto-titulo ${i % 3 === 1 ? 'esqueleto-titulo-largo' : ''}`.trim()} />
          <EsqueletoTexto lineas={i % 2 === 0 ? 2 : 1} />
          <EsqueletoChips cuantos={3 + (i % 2)} />
        </div>
      ))}
    </div>
  );
}

/** Una tarjeta de la maqueta (clase real `tarjeta`) con título opcional y
 *  líneas de texto. `alto` fija el alto mínimo para medir lo que la tarjeta
 *  real cuando se sabe (una tarjeta del inicio, un artefacto). */
export function EsqueletoTarjeta({ conTitulo = true, lineas = 3, alto, className }: { conTitulo?: boolean; lineas?: number; alto?: number; className?: string }): JSX.Element {
  return (
    <div className={`tarjeta esqueleto-tarjeta ${className ?? ''}`.trim()} aria-hidden="true" style={alto !== undefined ? { minHeight: alto } : undefined}>
      {conTitulo && <Esqueleto className="esqueleto-titulo" />}
      <EsqueletoTexto lineas={lineas} />
    </div>
  );
}

export type VariantePantalla = 'lista' | 'ficha' | 'figura' | 'panel';
export type FormaLista = 'tabla' | 'tarjetas';

/** El texto real de la cabecera. Con él la silueta mide exactamente lo que
 *  la pantalla, porque son las mismas clases con el mismo texto. La
 *  descripción puede ser un nodo (por ejemplo la fila de chips de la corrida). */
export type CabeceraSilueta = { titulo: ReactNode; descripcion?: ReactNode };

type PropsCabecera = {
  cabecera?: CabeceraSilueta;
  lineasDescripcion?: number;
  margenSuperior?: number;
  acciones?: ReactNode;
};

/** La cabecera de pantalla (título, descripción y botones) con las clases
 *  reales `pantalla-cabecera` y `acciones`. Con `cabecera` pinta el texto
 *  real; sin él, un título gris y `lineasDescripcion` líneas grises de 21,7
 *  px (lo que ocupa una línea de la descripción real). `acciones` sustituye
 *  a los dos botones grises de la derecha (null para no poner nada). */
function SiluetaCabecera({ cabecera, lineasDescripcion = 2, margenSuperior, acciones }: PropsCabecera) {
  const estilo = margenSuperior !== undefined ? { marginTop: margenSuperior } : undefined;
  const lineas = Math.max(0, Math.floor(lineasDescripcion));
  const descripcionGris =
    lineas > 0 ? (
      <div className="esqueleto-descripcion" aria-hidden="true">
        {Array.from({ length: lineas }, (_, i) => (
          <Esqueleto key={i} className={`esqueleto-p ${lineas > 1 && i === lineas - 1 ? 'esqueleto-p-corta' : ''}`.trim()} />
        ))}
      </div>
    ) : null;
  return (
    <div className="pantalla-cabecera esqueleto-cabecera" style={estilo}>
      {cabecera ? (
        <div>
          <h2>{cabecera.titulo}</h2>
          {cabecera.descripcion === undefined ? descripcionGris : typeof cabecera.descripcion === 'string' ? <p>{cabecera.descripcion}</p> : cabecera.descripcion}
        </div>
      ) : (
        <div className="esqueleto-cabecera-textos">
          <Esqueleto className="esqueleto-h2" />
          {descripcionGris}
        </div>
      )}
      {acciones === undefined ? (
        <div className="acciones esqueleto-acciones">
          <Esqueleto className="esqueleto-boton" />
          <Esqueleto className="esqueleto-boton" />
        </div>
      ) : (
        acciones
      )}
    </div>
  );
}

type PropsCuerpo = { variante: VariantePantalla; filas?: number; forma?: FormaLista; altoFila?: number; children?: ReactNode };

/** El cuerpo de una pantalla según su forma, o el cuerpo propio que traiga
 *  la pantalla (`children`). Sin rótulo ni aria-busy: eso lo pone quien la
 *  envuelve (EsqueletoPantalla o EsqueletoAplicacion), para que nunca haya
 *  dos rótulos "Cargando" anidados. */
function SiluetaPantalla({ variante, filas = 8, forma = 'tabla', altoFila, children, ...cabecera }: PropsCuerpo & PropsCabecera) {
  return (
    <>
      <SiluetaCabecera {...cabecera} />
      {children !== undefined ? (
        children
      ) : (
        <>
          {variante === 'lista' &&
            (forma === 'tarjetas' ? (
              <EsqueletoTarjetas filas={filas} altoFila={altoFila} />
            ) : (
              <div className="tarjeta esqueleto-tarjeta-filas" aria-hidden="true">
                <EsqueletoFilas filas={filas} columnas={4} />
              </div>
            ))}
          {variante === 'ficha' && (
            <>
              <EsqueletoTarjeta lineas={6} />
              <div className="esqueleto-datos">
                <EsqueletoFilas filas={5} columnas={2} />
              </div>
            </>
          )}
          {variante === 'figura' && (
            <>
              <Esqueleto className="esqueleto-figura" />
              <div className="esqueleto-leyenda" aria-hidden="true">
                <Esqueleto className="esqueleto-chip" />
                <Esqueleto className="esqueleto-chip" />
                <Esqueleto className="esqueleto-chip" />
              </div>
            </>
          )}
          {variante === 'panel' && (
            <>
              <EsqueletoTarjeta lineas={5} />
              <div className="rejilla-2 esqueleto-rejilla">
                <EsqueletoTarjeta lineas={3} />
                <EsqueletoTarjeta lineas={3} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

type PropsPantalla = PropsCuerpo &
  PropsCabecera & {
    /** Lo que se está cargando, en llano y con artículo: "el ranking", "la corrida". */
    rotulo?: string;
  };

/** La silueta completa de una pantalla dentro de `.contenido`, con
 *  `aria-busy` y el rótulo oculto "Cargando <rótulo>". Sustituye a la
 *  pantalla real mientras llega o se calcula lo que enseña. Cada pantalla
 *  le pasa lo que sabe sin calcular nada: el texto de su cabecera, cuántas
 *  filas va a pintar (`filas`, que el estado ya sabe) y de qué forma
 *  (`forma` tarjetas para el ranking y la cola, tabla para lo demás), o un
 *  cuerpo propio (`children`). */
export function EsqueletoPantalla({ variante, rotulo = 'la pantalla', ...resto }: PropsPantalla): JSX.Element {
  return (
    <div className={`contenido esqueleto-pantalla esqueleto-pantalla-${variante}`} role="status" aria-busy="true">
      <span className="sr-only">Cargando {rotulo}</span>
      <SiluetaPantalla variante={variante} {...resto} />
    </div>
  );
}

/** La maqueta entera en gris: barra lateral con el logotipo, la caja de
 *  búsqueda y cuatro investigaciones; cabecera; y un contenido con cabecera y
 *  tres tarjetas. Es lo que se ve mientras llega el estado por primera vez
 *  (Acceso.tsx), en lugar de una página vacía. Reutiliza `app`, `barra`,
 *  `marca`, `nav-inv`, `principal`, `cabecera` y `contenido` para que al
 *  llegar la interfaz real cada cosa aparezca donde ya estaba su silueta. */
export function EsqueletoAplicacion({ rotulo = 'ROSA2018' }: { rotulo?: string } = {}): JSX.Element {
  return (
    <div className="app esqueleto-app" role="status" aria-busy="true">
      <span className="sr-only">Cargando {rotulo}</span>
      <div className="barra esqueleto-barra" aria-hidden="true">
        <div className="marca">
          <img src="/arbol-marca.png" alt="" width={30} height={30} />
          <div>
            <strong>ROSA2018</strong>
            <small>Alzheimer Project</small>
          </div>
        </div>
        <Esqueleto className="esqueleto-buscar" />
        <div className="barra-seccion">
          <div className="barra-titulo">
            <Esqueleto className="esqueleto-rotulo" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="nav-inv esqueleto-nav">
              <Esqueleto className="esqueleto-nav-titulo" />
              <Esqueleto className="esqueleto-nav-meta" />
            </div>
          ))}
        </div>
        <div className="barra-pie esqueleto-pie">
          <Esqueleto className="esqueleto-linea" />
          <Esqueleto className="esqueleto-linea esqueleto-linea-corta" />
        </div>
      </div>
      <div className="principal">
        <div className="cabecera esqueleto-cabecera-app" aria-hidden="true">
          <Esqueleto className="esqueleto-icono btn-menu" />
          <Esqueleto className="esqueleto-titulo-cabecera" />
          <div className="cabecera-derecha">
            <Esqueleto className="esqueleto-icono" />
            <Esqueleto className="esqueleto-segmentos" />
            <Esqueleto className="esqueleto-icono" />
          </div>
        </div>
        <div className="pagina">
          <div className="contenido esqueleto-pantalla esqueleto-pantalla-panel" aria-hidden="true">
            <SiluetaPantalla variante="panel" />
          </div>
        </div>
      </div>
    </div>
  );
}

type PropsCargando = {
  /** Si es verdadero se pinta el esqueleto; si no, los hijos. */
  activo: boolean;
  /** Lo que se está cargando, en llano y con artículo: "el ranking", "las llamadas". */
  rotulo: string;
  /** La silueta que sustituye a los hijos mientras dura la espera. */
  esqueleto: JSX.Element;
  children: ReactNode;
};

/** El interruptor entre espera y contenido. Si el esqueleto que recibe ya es
 *  una EsqueletoPantalla (que trae su propio aria-busy y rótulo), no la
 *  envuelve otra vez: le pasa el rótulo y la devuelve tal cual. */
export function Cargando({ activo, rotulo, esqueleto, children }: PropsCargando): JSX.Element {
  if (!activo) return <>{children}</>;
  if (isValidElement<PropsPantalla>(esqueleto) && esqueleto.type === EsqueletoPantalla) {
    return cloneElement(esqueleto, { rotulo: esqueleto.props.rotulo ?? rotulo });
  }
  return (
    <div className="esqueleto-espera" role="status" aria-busy="true">
      <span className="sr-only">Cargando {rotulo}</span>
      {esqueleto}
    </div>
  );
}
