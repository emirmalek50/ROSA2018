// El árbol de la investigación: el grafo de lib/arbol.ts dibujado en SVG con
// una disposición por fuerzas propia. Se explora: al abrir se ven el tronco,
// las ramas, las hipótesis vivas y los experimentos; pulsar un nodo
// despliega lo que lo sostiene (hechos, fuentes, entidades, rivales) y lo
// selecciona; pulsar dos veces abre su ficha. La búsqueda ilumina todo lo
// que toca una palabra o un identificador (GFAP, HGNC:4235). El deslizador
// de iteraciones enseña cómo creció el árbol. Se mueve con la rueda y
// arrastrando el fondo. Por defecto (petición de Emir, 16 de septiembre de 2026)
// el relleno dice qué es cada nodo (las hipótesis y su rama, el color de su
// familia de mecanismo; el resto, el de su tipo) y el anillo cuánto lo sostiene
// (verde a un paso de una medición propia, ámbar solo literatura, gris nada;
// lib/arbol.ts calcula las distancias). El conmutador "Por distancia al dato"
// pasa esa distancia al relleno con una escala secuencial.
//
// Vista 3D (petición de Emir, 16 de septiembre de 2026): el mismo árbol, con la
// misma información (colores, anillos, alertas, rayas, leyenda, búsqueda,
// desplegar al pulsar, ficha con doble clic), pero dispuesto en tres ejes y
// mirado por una CÁMARA ORBITAL que gira alrededor del tronco. La geometría
// vive en lib/arbol3d.ts: una disposición por fuerzas con coordenada z, una
// PROYECCIÓN EN PERSPECTIVA (cámara estenopeica: cada punto se divide por su
// distancia a la cámara, así lo lejano sale pequeño) y tres números de cámara,
// la GUIÑADA (giro alrededor del eje vertical: arrastrar el fondo en
// horizontal), el CABECEO (inclinación arriba y abajo: arrastrar en vertical,
// acotado a más o menos 80 grados) y la DISTANCIA (la rueda). Aquí solo se
// dibuja lo proyectado: el radio de cada círculo se multiplica por la escala,
// la opacidad baja con la profundidad (niebla) y los nodos se pintan de lejos a
// cerca para que los cercanos tapen a los lejanos. Cuando nadie toca el árbol
// durante unos segundos gira solo, despacio, salvo con movimiento reducido. En
// 3D no se arrastran nodos (el fondo gira el árbol) ni hay vaivén (el giro ya
// le da vida). La elección de vista se recuerda en el navegador; por defecto
// sigue la vista plana, para no cambiarle el árbol a quien ya lo conoce.
//
// Cómo se pinta (17 de septiembre de 2026, "sube los fps del árbol"): el árbol
// se dibuja en un <canvas> 2D, no en SVG. Con SVG cada cuadro obligaba al
// navegador a recalcular el estilo y recomponer unos novecientos elementos (8 de
// los 16 ms que hay por cuadro) aunque solo cambiaran atributos; un canvas se
// pinta entero de un trazo en dos o tres milisegundos. React monta el lienzo,
// una lista oculta con un botón por nodo (teclado y lectores de pantalla) y el
// panel; UN SOLO bucle de requestAnimationFrame hace la física, el encuadre, el
// giro automático y el vaivén, construye la ESCENA (lib/lienzo_arbol.ts: el
// modelo de lo que se ve) y la pinta solo si algo cambió. Las posiciones, la
// cámara, la vista y el nodo bajo el ratón viven en refs (fuentes de verdad
// mutables), no en estado de React: cambiarlos no vuelve a renderizar nada. Los
// colores son los tokens de styles.css leídos con getComputedStyle (Paleta) y
// se releen al cambiar el tema. El ratón se resuelve por distancia al nodo más
// cercano (nodoBajoPuntero). Con movimiento reducido no hay bucle: cada cambio
// fuerza un render de React, cuyo efecto pinta el lienzo una vez.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { AvisoMuestra, Chip, Vacio } from '../componentes/piezas';
import { Cargando, Esqueleto, EsqueletoTexto } from '../componentes/Esqueleto';
import { alternar, buscar, construirArbol, fraseProfundidad, incorporarNovedades, NOMBRE_ENLACE, NOMBRE_TIPO, paso, posicionInicial, SIN_DISTANCIA, visiblesIniciales, type Grafo, type NodoArbol, type Posicion, type TipoEnlace, type TipoNodo } from '../lib/arbol';
import { acotarCamara, camaraInicial, distanciaEncuadre, ESPERA_GIRO_MS, paso3d, posicionInicial3d, SENSIBILIDAD_GIRO, VELOCIDAD_GIRO, type Camara, type Posicion3 } from '../lib/arbol3d';
import { ajusteLienzo, construirEscena, dibujar, nodoBajoPuntero, Paleta, registrarEscena, RESPALDOS_PALETA, type Escena, type EstiloNodo, type Trazo } from '../lib/lienzo_arbol';
import { useCalculoDiferido } from '../lib/diferido';
import { useMovimientoReducido } from '../lib/movimiento';
const COLOR: Record<TipoNodo, string> = {
  objetivo: 'var(--accent)',
  rama: 'var(--accent-soft-2)',
  area: 'var(--accent-soft-2)',
  hipotesis: '#7c3aed',
  hecho: 'var(--green)',
  pregunta: 'var(--amber)',
  fuente: 'var(--text-3)',
  entidad: 'var(--blue)',
  experimento: '#0f766e',
  afirmacion: 'var(--grafo-afirmacion)',
  ejecucion: 'var(--grafo-ejecucion)',
  dataset: 'var(--grafo-dataset)',
  laboratorio: 'var(--grafo-laboratorio)',
};
const TRAZO: Record<TipoEnlace, Trazo> = {
  rama: { color: 'var(--border-strong)', ancho: 1.6 },
  cita: { color: 'var(--text-3)', ancho: 0.8 },
  respalda: { color: 'var(--green)', ancho: 1 },
  entidad: { color: 'var(--blue)', ancho: 0.8, guion: '2 3' },
  causal: { color: '#ea580c', ancho: 1.4 },
  rival: { color: 'var(--red)', ancho: 1, guion: '4 4' },
  experimento: { color: '#0f766e', ancho: 1.8 },
  dato: { color: 'var(--grafo-dato-1)', ancho: 1.3 },
};

type ModoColor = 'tipo' | 'dato';
type Vista = 'plana' | '3d';
/** Clave del navegador donde se recuerda la vista elegida (sin tilde: es un identificador). */
const CLAVE_VISTA = 'rosa-arbol-vista';
function leerVista(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === '3d' ? '3d' : 'plana';
  } catch {
    return 'plana';
  }
}
function guardarVista(v: Vista): void {
  try {
    localStorage.setItem(CLAVE_VISTA, v);
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): la elección dura lo que la pestaña.
  }
}
/** Qué es cada tipo de nodo, dicho en llano para la leyenda (petición de Emir, 16 de
 *  septiembre de 2026: la leyenda tiene que explicar los colores como se explican en
 *  una conversación, no listar nombres y recuentos). */
const DEFINICION_TIPO: Record<TipoNodo, string> = {
  objetivo: 'Objetivo (el tronco): la pregunta de la investigación. Es estructura, no evidencia.',
  rama: 'Rama: una familia de mecanismo; agrupa las hipótesis que hablan del mismo mecanismo biológico.',
  area: 'Área del programa: una línea de trabajo que agrupa investigaciones. Estructura, no evidencia.',
  hipotesis: 'Hipótesis: cada una lleva el color de su familia de mecanismo. Si dos hojas comparten color, comparten mecanismo. El tamaño dice cuánto vale: crece con la certeza GRADE de su conclusión y, dentro del mismo nivel, con su fuerza en el torneo; las candidatas al laboratorio son algo mayores.',
  hecho: 'Hecho: algo que el modelo de mundo ya da por sostenido.',
  pregunta: 'Pregunta abierta: algo que ROSA2018 todavía no ha podido resolver.',
  fuente: 'Fuente: un artículo o una base de datos que ROSA2018 leyó.',
  entidad: 'Entidad: un gen, una proteína o un tipo de célula con su nombre canónico.',
  experimento: 'Experimento propuesto para el laboratorio.',
  afirmacion: 'Afirmación con dato: una frase de un artículo con su cifra, verificada por el juez.',
  ejecucion: 'Análisis in silico: un análisis que ROSA2018 corrió sobre datos públicos y pasó la auditoría.',
  dataset: 'Conjunto de datos público usado en un análisis.',
  laboratorio: 'Resultado del laboratorio: lo que devolvió el experimento.',
};
/** Paleta por familia de mecanismo (el cluster de cada hipótesis): en el modo por
 *  tipo, las hipótesis y su rama comparten el color de su familia, así el árbol
 *  enseña de un vistazo qué mecanismos compiten. Diez tonos distinguibles en tema
 *  claro y oscuro (tokens en styles.css); con más de diez familias se repiten. */
const PALETA_CLUSTER = ['var(--grafo-cluster-0)', 'var(--grafo-cluster-1)', 'var(--grafo-cluster-2)', 'var(--grafo-cluster-3)', 'var(--grafo-cluster-4)', 'var(--grafo-cluster-5)', 'var(--grafo-cluster-6)', 'var(--grafo-cluster-7)', 'var(--grafo-cluster-8)', 'var(--grafo-cluster-9)'];
/** Escala secuencial por distancia al dato: un solo tono, más intenso cuanto
 *  más cerca de la medición (0 = la medición misma) y más claro a cada salto.
 *  Los tokens viven en styles.css con pasos propios para el tema oscuro. */
const ESCALA_DATO = ['var(--grafo-dato-0)', 'var(--grafo-dato-1)', 'var(--grafo-dato-2)', 'var(--grafo-dato-3)'];
const NOMBRE_ESCALA = ['La medición misma (0 saltos)', 'A 1 salto de una medición', 'A 2 saltos', 'A 3 saltos o más'];
/** Segunda escala, en ámbar, para lo que no tiene medición propia pero sí literatura
 *  leída detrás (una fuente con su texto, no solo citada): más intenso cuanto más cerca
 *  de la fuente. Sin ella, una investigación solo de literatura salía toda gris. */
const ESCALA_LIT = ['var(--grafo-lit-1)', 'var(--grafo-lit-2)', 'var(--grafo-lit-3)'];
const NOMBRE_ESCALA_LIT = ['Solo literatura, a 1 salto de una fuente leída', 'Solo literatura, a 2 saltos', 'Solo literatura, a 3 saltos o más'];
const COLOR_SIN_DATO = 'var(--grafo-dato-nulo)';
/** Escalón de la escala para un nodo: 0 a 3, o 'nulo' si no hay camino al dato. */
function escalonDato(n: NodoArbol): number | 'nulo' {
  const d = n.profundidadDato ?? null;
  return d === null ? 'nulo' : Math.min(d, ESCALA_DATO.length - 1);
}
/** Escalón de la escala de literatura: 0 a 2 (1, 2, 3 o más saltos hasta una fuente leída), o 'nulo'. */
function escalonLiteratura(n: NodoArbol): number | 'nulo' {
  const d = n.profundidadLiteratura ?? null;
  return d === null ? 'nulo' : Math.min(Math.max(d, 1), ESCALA_LIT.length) - 1;
}
/** Clave de leyenda del nodo en el modo por distancia: 'd0'..'d3', 'l0'..'l2' o 'nulo'. */
function claveDistancia(n: NodoArbol): string {
  const d = escalonDato(n);
  if (d !== 'nulo') return `d${d}`;
  const l = escalonLiteratura(n);
  return l === 'nulo' ? 'nulo' : `l${l}`;
}
function colorPorDato(n: NodoArbol): string {
  if (SIN_DISTANCIA.has(n.tipo)) return COLOR[n.tipo];
  const d = escalonDato(n);
  if (d !== 'nulo') return ESCALA_DATO[d]!;
  const l = escalonLiteratura(n);
  return l === 'nulo' ? COLOR_SIN_DATO : ESCALA_LIT[l]!;
}

/** Un motor de disposición: cómo nace un nodo y cómo avanza un paso de la física.
 *  Hay dos, el plano (lib/arbol.ts) y el de tres ejes (lib/arbol3d.ts). */
interface Motor<P extends { fijo?: boolean }> {
  inicial: (g: Grafo, posiciones: Map<string, P>, id: string, semilla: number) => P;
  paso: (g: Grafo, visibles: Set<string>, posiciones: Map<string, P>, alfa: number) => void;
}
const MOTOR_PLANO: Motor<Posicion> = { inicial: posicionInicial, paso };
const MOTOR_3D: Motor<Posicion3> = { inicial: posicionInicial3d, paso: paso3d };

/** Pone al día las posiciones de un motor con lo visible: los nodos nuevos nacen
 *  junto a un vecino colocado, los que se van se olvidan. Devuelve si hubo cambio
 *  (o es la primera vez). Sin animación (`quieto`) asienta el árbol aquí mismo con
 *  240 pasos; con animación deja la energía (`alfa`) alta para que el bucle la gaste.
 *  El estado de ROSA2018 cambia cada pocos segundos por SSE y reconstruye el grafo: si
 *  el conjunto de nodos no cambió (misma firma), no se vuelve a agitar el árbol. */
function sincronizar<P extends { fijo?: boolean }>(motor: Motor<P>, grafo: Grafo, visibles: Set<string>, posiciones: Map<string, P>, firma: { current: string }, alfa: { current: number }, semilla: { current: number }, quieto: boolean): boolean {
  let cambio = false;
  for (const id of visibles) {
    if (!posiciones.has(id)) {
      posiciones.set(id, motor.inicial(grafo, posiciones, id, semilla.current++));
      cambio = true;
    }
  }
  for (const id of [...posiciones.keys()]) {
    if (!visibles.has(id)) {
      posiciones.delete(id);
      cambio = true;
    }
  }
  const nueva = [...visibles].sort().join('|');
  const primera = firma.current === '';
  firma.current = nueva;
  if (!cambio && !primera) return false;
  if (quieto) for (let i = 0; i < 240; i++) motor.paso(grafo, visibles, posiciones, Math.max(0.05, 1 - i / 240));
  else alfa.current = primera ? 1 : 0.6;
  return true;
}

/** Lo que el bucle necesita saber del último render de React para construir la escena. */
interface Contexto {
  grafo: Grafo;
  enTiempo: Set<string>;
  vista3d: boolean;
  reducido: boolean;
  iluminados: Set<string>;
  seleccion: string | null;
  estiloDe: (n: NodoArbol) => EstiloNodo;
}

const ANCHO = 900;
const ALTO = 560;

/** La ayuda de la cabecera. Es una constante para que la silueta y la pantalla
 *  real la pinten idéntica y la cabecera no cambie de alto al llegar el árbol. */
const AYUDA = 'El objetivo es el tronco; las ramas, los clusters con varias hipótesis; las hojas, las hipótesis; alrededor, lo que las sostiene. Pasa el ratón por un nodo para ver sus conexiones; pulsa para desplegar lo que toca; dos veces para abrir su ficha; arrastra un nodo para moverlo (los demás lo siguen). Las etiquetas pequeñas aparecen al acercar con la rueda. Escribe una palabra o un identificador (GFAP, HGNC:4235) para iluminar todo lo que lo nombra. Por defecto el relleno de cada nodo dice qué es (las hipótesis, el color de su familia de mecanismo) y el anillo cuánto lo sostiene: verde si está a un paso de una medición propia de ROSA2018 (un análisis in silico validado, un resultado del laboratorio o una observación original), ámbar si solo hay literatura leída detrás, gris punteado si nada todavía. Con «Por distancia al dato» esa distancia pasa al relleno con una escala secuencial. Con «Vista 3D» el mismo árbol se despliega en tres dimensiones: arrastra el fondo para girarlo (en horizontal gira, en vertical se inclina), usa la rueda para acercar la cámara, y los nodos lejanos se ven más pequeños y tenues; si nadie lo toca durante unos segundos, gira solo. En 3D los nodos no se arrastran: el fondo gira el árbol.';

/** Dónde van los nodos de la silueta (en tanto por ciento del lienzo) y su
 *  diámetro en píxeles: el tronco en el centro, cinco ramas alrededor y hojas
 *  más pequeñas hacia fuera. `de` es el nodo al que se une con una línea. */
const SILUETA_NODOS: { x: number; y: number; d: number; de?: number }[] = [
  { x: 50, y: 50, d: 0 }, // el tronco: el óvalo se pinta aparte
  { x: 30, y: 30, d: 28, de: 0 },
  { x: 70, y: 28, d: 28, de: 0 },
  { x: 24, y: 70, d: 26, de: 0 },
  { x: 74, y: 72, d: 26, de: 0 },
  { x: 50, y: 20, d: 24, de: 0 },
  { x: 16, y: 44, d: 18, de: 1 },
  { x: 36, y: 14, d: 16, de: 1 },
  { x: 62, y: 10, d: 16, de: 5 },
  { x: 86, y: 40, d: 18, de: 2 },
  { x: 88, y: 60, d: 16, de: 4 },
  { x: 80, y: 88, d: 18, de: 4 },
  { x: 58, y: 86, d: 16, de: 4 },
  { x: 32, y: 88, d: 18, de: 3 },
  { x: 12, y: 78, d: 16, de: 3 },
  { x: 40, y: 62, d: 16, de: 0 },
];

/** La silueta de la pantalla del árbol mientras se construye el grafo
 *  (estándar de Emir, 19 de septiembre de 2026): la cabecera real (texto
 *  fijo) con los mandos en gris; el marco con un óvalo central, unos círculos
 *  unidos por líneas y el panel derecho; y la barra de iteraciones. Reutiliza
 *  `grafo-marco`, `grafo`, `grafo-panel` y `grafo-tiempo` para medir
 *  exactamente lo que medirá el árbol, así no salta al llegar. */
function SiluetaArbol({ conexion }: { conexion: EstadoRosa['conexion'] }) {
  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>Árbol de la investigación</h2>
          <p>{AYUDA}</p>
        </div>
        {/* Los mandos reales, deshabilitados: son chrome fijo, no contenido que llega, y así la cabecera mide exactamente lo mismo que con el árbol. */}
        <div className="acciones" aria-hidden="true">
          <div className="segmentos" role="group" aria-label="Vista del árbol">
            <button type="button" aria-pressed disabled>
              Vista plana
            </button>
            <button type="button" disabled>
              Vista 3D
            </button>
          </div>
          <div className="segmentos" role="group" aria-label="Color de los nodos">
            <button type="button" aria-pressed disabled>
              Por tipo y mecanismo
            </button>
            <button type="button" disabled>
              Por distancia al dato
            </button>
          </div>
          <input className="entrada entrada-s" style={{ width: 220 }} placeholder="Buscar en el árbol" aria-label="Buscar en el árbol" disabled readOnly />
          <button type="button" className="btn btn-s" disabled>
            Plegar todo
          </button>
          <button type="button" className="btn btn-s" disabled>
            Desplegar todo
          </button>
        </div>
      </div>
      <div className="grafo-marco" aria-hidden="true">
        {/* La figura va en línea dentro de un div, como el <canvas> real: así deja bajo ella el mismo hueco de la línea base (6 px) y el marco mide igual. */}
        <div>
          <div className="grafo" data-esqueleto="arbol" style={{ display: 'inline-block', verticalAlign: 'baseline', position: 'relative', overflow: 'hidden', cursor: 'progress' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {SILUETA_NODOS.map((n, i) =>
              n.de === undefined ? null : <line key={i} x1={SILUETA_NODOS[n.de]!.x} y1={SILUETA_NODOS[n.de]!.y} x2={n.x} y2={n.y} stroke="var(--esqueleto-base)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />,
            )}
          </svg>
          <span data-esqueleto="tronco" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Esqueleto ancho={76} alto={54} radio={38} />
          </span>
          {SILUETA_NODOS.slice(1).map((n, i) => (
            <span key={i} data-esqueleto="nodo" style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%, -50%)' }}>
              <Esqueleto ancho={n.d} alto={n.d} radio={n.d / 2} />
            </span>
          ))}
          </div>
        </div>
        <aside className="grafo-panel">
          <Esqueleto ancho={72} alto={22} radio={11} />
          <Esqueleto ancho="72%" alto={18} />
          <EsqueletoTexto lineas={3} />
          <Esqueleto ancho={140} alto={12} />
          <EsqueletoTexto lineas={6} />
        </aside>
      </div>
      <div className="grafo-tiempo" aria-hidden="true">
        <Esqueleto ancho={72} alto={28} />
        <Esqueleto ancho={260} alto={13} />
        <Esqueleto ancho="30%" alto={6} radio={3} />
        <Esqueleto ancho={120} alto={12} />
      </div>
    </div>
  );
}

const ROTULO_ARBOL = 'el árbol de la investigación';

/** La silueta del árbol con su aria-busy y su rótulo oculto, lista para que
 *  App la pinte en el primer frame tras el clic (App.tsx, SILUETA_AL_CAMBIAR):
 *  es la misma que el propio árbol pinta mientras construye el grafo, así entre
 *  el frame de App y el primero de la pantalla no cambia nada en la maqueta.
 *  Se exporta solo el componente (no el rótulo) para que Arbol.tsx conserve el
 *  refresco en caliente de Vite. */
export function EsqueletoArbol({ conexion }: { conexion: EstadoRosa['conexion'] }) {
  return (
    <Cargando activo rotulo={ROTULO_ARBOL} esqueleto={<SiluetaArbol conexion={conexion} />}>
      {null}
    </Cargando>
  );
}

/** La pantalla del árbol. Construir el grafo (lib/arbol.ts, construirArbol) y
 *  asentar la disposición inicial (240 pasos de fuerzas sin animación)
 *  congelaban la pantalla al abrirla: ahora el grafo se construye DESPUÉS de
 *  pintar la silueta (lib/diferido.ts, useCalculoDiferido) y el árbol se monta
 *  con él ya hecho. Cada estado nuevo por SSE rehace el grafo un fotograma
 *  después, sin esqueleto: se conserva el anterior mientras tanto. Un árbol
 *  vacío no tiene nada que calcular y explica qué pasará sin esperar. */
export function Arbol({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const vacio = useMemo(() => !estado.hipotesis.some((h) => h.investigacionId === inv.id) && !estado.hechos.some((h) => h.investigacionId === inv.id), [estado.hipotesis, estado.hechos, inv.id]);
  const { valor } = useCalculoDiferido(() => ({ invId: inv.id, grafo: construirArbol(estado, inv) }), [estado, inv]);
  // Un árbol vacío solo tiene el tronco: se construye aquí mismo, sin esperar.
  const grafoTrivial = useMemo(() => (vacio ? construirArbol(estado, inv) : null), [vacio, estado, inv]);
  const listo = valor !== null && valor.invId === inv.id;
  const grafo = listo ? valor.grafo : grafoTrivial;
  return (
    <Cargando activo={grafo === null} rotulo={ROTULO_ARBOL} esqueleto={<SiluetaArbol conexion={estado.conexion} />}>
      {grafo !== null && <ArbolMontado inv={inv} estado={estado} grafo={grafo} />}
    </Cargando>
  );
}

/** El árbol con el grafo ya construido: el lienzo, el bucle de animación, el
 *  panel y los mandos. Recibe el grafo hecho para no construirlo en el render. */
function ArbolMontado({ inv, estado, grafo }: { inv: Investigacion; estado: EstadoRosa; grafo: Grafo }) {
  const hip = useMemo(() => estado.hipotesis.filter((h) => h.investigacionId === inv.id), [estado.hipotesis, inv.id]);
  // Sin hipótesis ni hechos no hay árbol que dibujar (se enseña qué pasará). Se
  // calcula aquí, antes de los efectos, porque el de la rueda tiene que volver a
  // engancharse cuando el SVG aparece por primera vez.
  const vacio = hip.length === 0 && estado.hechos.filter((h) => h.investigacionId === inv.id).length === 0;
  const [visibles, setVisibles] = useState<Set<string>>(() => visiblesIniciales(grafo, hip));
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [hasta, setHasta] = useState<number>(grafo.iteracionMax);
  const anterior = useRef({ ids: new Set(grafo.nodos.map((n) => n.id)), iteracionMax: grafo.iteracionMax });
  // Fuentes de verdad mutables que leen React y el bucle: posiciones de cada
  // motor, energía de la simulación, la vista plana (desplazamiento y zoom), la
  // cámara 3D y el reloj del vaivén. Cambiarlas no hace render por sí solo: con
  // animación las pinta el bucle en el siguiente cuadro; sin ella, `repintar`.
  const pos2 = useRef(new Map<string, Posicion>());
  const pos3 = useRef(new Map<string, Posicion3>());
  const alfa2 = useRef(1);
  const alfa3 = useRef(1);
  const firma2 = useRef('');
  const firma3 = useRef('');
  const semilla = useRef(1);
  const vistaRef = useRef({ x: 0, y: 0, k: 1 });
  const camaraRef = useRef<Camara>(camaraInicial());
  const relojRef = useRef(0);
  const [, setTick] = useState(0);
  const repintar = () => setTick((t) => t + 1);
  // Encuadre automático de la cámara 3D: la distancia se ajusta sola para que
  // todo lo visible quepa en el lienzo, pero SOLO si nadie ha tocado la cámara
  // (regla de Emir, 17 de septiembre de 2026: "el zoom se devuelve rápido"). La
  // rueda o el arrastre encienden `camaraTocada` y el encuadre queda apagado
  // para este árbol hasta "Plegar todo" o cambiar de investigación. Mientras no
  // esté tocada, encuadra al abrir la vista, al desplegar y mientras la
  // simulación se asienta; el giro automático nunca cambia la distancia.
  const camaraTocada = useRef(false);
  const encuadrar = useRef(true);
  // Hay algo nuevo que pintar (física, cámara, vista, ratón): el bucle solo
  // pinta cuando está encendido, así un árbol quieto no gasta nada.
  const sucio = useRef(true);
  /** La última escena pintada: el bucle la construye, el puntero la consulta. */
  const escenaRef = useRef<Escena | null>(null);
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  /** El contexto 2D del lienzo, pedido una sola vez por montaje (null donde no hay canvas, como jsdom). */
  const ctx2dRef = useRef<{ lienzo: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } | null>(null);
  const contexto2d = (lienzo: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    if (ctx2dRef.current?.lienzo === lienzo) return ctx2dRef.current.ctx;
    let ctx2d: CanvasRenderingContext2D | null = null;
    try {
      ctx2d = typeof lienzo.getContext === 'function' ? lienzo.getContext('2d') ?? null : null;
    } catch {
      ctx2d = null;
    }
    ctx2dRef.current = { lienzo, ctx: ctx2d };
    return ctx2d;
  };
  const paleta = useRef(new Paleta(typeof document === 'undefined' ? null : document.documentElement, RESPALDOS_PALETA));
  const fuente = useRef('system-ui, sans-serif');
  /** Escala y desplazamiento del lienzo lógico (900 por 560) dentro del canvas real. */
  const ajuste = useRef({ escala: 1, dx: 0, dy: 0, anchoPx: 0, altoPx: 0 });
  const ctx = useRef<Contexto | null>(null);
  /** El nodo bajo el ratón, en un ref: cambiarlo no vuelve a renderizar nada. */
  const hoverRef = useRef<string | null>(null);
  /** Pulsación empezada sobre un nodo (para que soltar sin mover sea un clic). */
  const pulsacion = useRef<{ id: string; x0: number; y0: number; movido: boolean } | null>(null);
  const [modoColor, setModoColor] = useState<ModoColor>('tipo'); // Por defecto: relleno por tipo y familia de mecanismo, anillo por distancia al dato (petición de Emir, 16 de septiembre de 2026)
  const [tipoVista, setTipoVista] = useState<Vista>(leerVista);
  const vista3d = tipoVista === '3d';
  /** Último instante en que alguien tocó el árbol en 3D: el giro automático espera unos segundos desde entonces. */
  const ultimoToque = useRef(0);
  const cambiarVista = (v: Vista) => {
    setTipoVista(v);
    guardarVista(v);
    ultimoToque.current = performance.now();
    // Al abrir la vista 3D se encuadra, salvo que la cámara ya esté tocada.
    encuadrar.current = !camaraTocada.current;
    sucio.current = true;
  };
  const arrastre = useRef<{ x: number; y: number; vx: number; vy: number; ux?: number; uy?: number } | null>(null);
  const arrastreNodo = useRef<{ id: string; x0: number; y0: number; movido: boolean } | null>(null);
  // Último punto del puntero mientras se gira la cámara. El giro es incremental
  // (cada movimiento suma su diferencia a la cámara actual) y no absoluto desde
  // el punto de agarre: así, al topar con el cabeceo máximo, la cámara responde
  // en cuanto el puntero vuelve, sin tener que desandar el exceso.
  const arrastreCamara = useRef<{ x: number; y: number } | null>(null);
  const reducido = useMovimientoReducido();
  const ancho = ANCHO;
  const alto = ALTO;
  // Coordenadas del lienzo lógico (0..900, 0..560) a partir de un evento del
  // puntero, deshaciendo la escala y el centrado del canvas. Con un canvas sin
  // tamaño (tests) la escala es 1 y las coordenadas del evento son las lógicas.
  const puntoLogico = (clientX: number, clientY: number) => {
    const lienzo = lienzoRef.current;
    const a = ajuste.current;
    if (!lienzo) return { x: 0, y: 0 };
    const caja = lienzo.getBoundingClientRect();
    const dpr = a.anchoPx > 0 && caja.width > 0 ? a.anchoPx / caja.width : 1;
    return { x: ((clientX - caja.left) * dpr - a.dx) / a.escala, y: ((clientY - caja.top) * dpr - a.dy) / a.escala };
  };
  /** Lo mismo pero centrado en el tronco (la vista plana mide desde el centro). */
  const enLienzo = (clientX: number, clientY: number) => {
    const p = puntoLogico(clientX, clientY);
    return { x: p.x - ancho / 2, y: p.y - alto / 2 };
  };

  // Sigue las novedades del servidor, sin restablecer la exploración de la persona.
  useEffect(() => {
    const previo = anterior.current;
    setVisibles((v) => incorporarNovedades(grafo, previo.ids, v));
    setHasta((h) => h >= previo.iteracionMax ? grafo.iteracionMax : h);
    anterior.current = { ids: new Set(grafo.nodos.map((n) => n.id)), iteracionMax: grafo.iteracionMax };
  }, [grafo]);

  const iluminados = useMemo(() => buscar(grafo, texto), [grafo, texto]);
  const enTiempo = useMemo(() => new Set([...visibles].filter((id) => (grafo.porId.get(id)?.iteracion ?? 0) <= hasta)), [visibles, hasta, grafo]);
  // El nodo bajo el ratón solo cuenta mientras se dibuja: si desaparece (Plegar
  // todo, el deslizador de iteraciones) el giro automático no puede quedarse
  // pausado ni el árbol atenuado.
  const focoActual = () => (hoverRef.current !== null && enTiempoRef.current.has(hoverRef.current) ? hoverRef.current : null);
  const enTiempoRef = useRef(enTiempo);
  enTiempoRef.current = enTiempo;
  const puntosVisibles = () => [...enTiempoRef.current].map((id) => pos3.current.get(id)).filter((p): p is Posicion3 => Boolean(p));
  // Otra investigación: cámara y vista de salida, y el encuadre vuelve a mandar.
  useEffect(() => {
    camaraTocada.current = false;
    encuadrar.current = true;
    camaraRef.current = camaraInicial();
    vistaRef.current = { x: 0, y: 0, k: 1 };
  }, [inv.id]);
  // Cambios estructurales (lo visible, la vista, el grafo): se colocan los nodos
  // nuevos y se olvidan los que se van; sin animación se asienta aquí mismo y, si
  // toca, se encuadra de una vez. Siempre se vuelve a renderizar para montar lo nuevo.
  useEffect(() => {
    if (vista3d) sincronizar(MOTOR_3D, grafo, enTiempo, pos3.current, firma3, alfa3, semilla, reducido);
    else sincronizar(MOTOR_PLANO, grafo, enTiempo, pos2.current, firma2, alfa2, semilla, reducido);
    encuadrar.current = !camaraTocada.current;
    sucio.current = true;
    if (reducido && vista3d && encuadrar.current) {
      const c = camaraRef.current;
      const distancia = distanciaEncuadre(puntosVisibles(), c, ancho, alto);
      if (distancia !== c.distancia) camaraRef.current = acotarCamara({ ...c, distancia });
    }
    repintar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grafo, enTiempo, vista3d, reducido]);
  /** Vuelve a dar energía a la simulación plana (al arrastrar un nodo o el fondo). */
  const reavivar = (energia = 0.4) => {
    if (reducido) repintar();
    else alfa2.current = Math.max(alfa2.current, energia);
  };
  /** Construye la escena con lo que hay en los refs y la pinta en el canvas. */
  const pintar = () => {
    const c = ctx.current;
    const lienzo = lienzoRef.current;
    if (!c || !lienzo) return;
    const escena = construirEscena({
      modo: c.vista3d ? '3d' : 'plana',
      grafo: c.grafo,
      ids: c.enTiempo,
      pos2: pos2.current,
      pos3: pos3.current,
      camara: camaraRef.current,
      vista: vistaRef.current,
      reloj: c.reducido || c.vista3d ? null : relojRef.current,
      ancho,
      alto,
      estiloDe: c.estiloDe,
      trazoDe: (t) => TRAZO[t],
      foco: focoActual(),
      iluminados: c.iluminados,
      seleccion: c.seleccion,
    });
    escenaRef.current = escena;
    registrarEscena(lienzo, escena);
    sucio.current = false;
    // Sin contexto 2D (jsdom en los tests) la escena queda registrada y no se pinta.
    const ctx2d = contexto2d(lienzo);
    if (!ctx2d) return;
    const a = ajuste.current;
    dibujar(ctx2d, escena, { paleta: paleta.current, fuente: fuente.current, escala: a.escala, dx: a.dx, dy: a.dy, anchoPx: lienzo.width, altoPx: lienzo.height });
  };
  // Tamaño real del canvas: sigue al de su caja (y a la densidad de píxeles) y
  // encaja el lienzo lógico centrado y sin deformar, como hacía el viewBox del SVG.
  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return;
    const medir = () => {
      const caja = lienzo.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const anchoPx = Math.round(caja.width * dpr);
      const altoPx = Math.round(caja.height * dpr);
      if (anchoPx > 0 && altoPx > 0 && (lienzo.width !== anchoPx || lienzo.height !== altoPx)) {
        lienzo.width = anchoPx;
        lienzo.height = altoPx;
      }
      ajuste.current = { ...ajusteLienzo(ancho, alto, anchoPx, altoPx), anchoPx, altoPx };
      sucio.current = true;
      pintar();
    };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(lienzo);
    return () => observador.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacio]);
  // Los colores son los tokens de styles.css: se releen al cambiar el tema (data-theme
  // en la raíz o la preferencia del sistema) y la fuente, una vez.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const raiz = document.documentElement;
    const leerFuente = () => {
      const f = typeof getComputedStyle === 'function' ? getComputedStyle(raiz).getPropertyValue('--font-sans').trim() : '';
      fuente.current = f || 'system-ui, sans-serif';
    };
    leerFuente();
    const refrescar = () => {
      paleta.current.refrescar();
      leerFuente();
      sucio.current = true;
      pintar();
    };
    const observador = typeof MutationObserver === 'function' ? new MutationObserver(refrescar) : null;
    observador?.observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const medio = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    medio?.addEventListener?.('change', refrescar);
    return () => {
      observador?.disconnect();
      medio?.removeEventListener?.('change', refrescar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacio]);
  // Tras cada render de React (cambió lo visible, la selección, la búsqueda, el
  // color o la vista) se vuelve a pintar una vez; con animación el bucle también lo haría.
  useEffect(() => {
    sucio.current = true;
    pintar();
  });
  // EL BUCLE: un solo requestAnimationFrame para la física, el encuadre, el giro
  // automático, el vaivén y el pintado. Con movimiento reducido no hay bucle.
  useEffect(() => {
    if (reducido || vacio) return;
    let id = 0;
    let previo = performance.now();
    ultimoToque.current = previo;
    const cuadro = (t: number) => {
      const dt = Math.min(0.1, Math.max(0, (t - previo) / 1000));
      previo = t;
      const c = ctx.current;
      if (c) {
        if (c.vista3d) {
          if (alfa3.current > 0.03) {
            for (let k = 0; k < 2; k++) paso3d(c.grafo, c.enTiempo, pos3.current, alfa3.current);
            alfa3.current = Math.max(0.02, alfa3.current * 0.975);
            sucio.current = true;
          }
          if (encuadrar.current) {
            const cam = camaraRef.current;
            const objetivo = distanciaEncuadre(puntosVisibles(), cam, ancho, alto);
            const delta = objetivo - cam.distancia;
            if (Math.abs(delta) < 0.5) {
              // Encajado: se fija el valor exacto y, si la simulación ya se asentó, se deja de ajustar.
              if (alfa3.current <= 0.03) encuadrar.current = false;
              if (delta !== 0) {
                camaraRef.current = acotarCamara({ ...cam, distancia: objetivo });
                sucio.current = true;
              }
            } else {
              camaraRef.current = acotarCamara({ ...cam, distancia: cam.distancia + delta * 0.15 });
              sucio.current = true;
            }
          }
          // Giro automático: cuando nadie toca el árbol durante ESPERA_GIRO_MS (ni
          // arrastra, ni tiene el ratón sobre un nodo) la guiñada avanza despacio. Solo la guiñada.
          if (t - ultimoToque.current > ESPERA_GIRO_MS && !focoActual() && !arrastreCamara.current) {
            const cam = camaraRef.current;
            camaraRef.current = acotarCamara({ ...cam, guinada: cam.guinada + VELOCIDAD_GIRO * dt });
            sucio.current = true;
          }
        } else {
          if (alfa2.current > 0.03) {
            // La física plana (lib/arbol.ts, repulsión y separación de etiquetas en
            // O(n²)) puede pasar de 15 ms por paso con cientos de nodos; si un paso
            // se come el presupuesto del cuadro, se da uno solo (el árbol se asienta
            // más despacio, pero no a tirones).
            const t0 = performance.now();
            paso(c.grafo, c.enTiempo, pos2.current, alfa2.current);
            if (performance.now() - t0 < 5) paso(c.grafo, c.enTiempo, pos2.current, alfa2.current);
            alfa2.current = Math.max(0.02, alfa2.current * 0.975);
            sucio.current = true;
          }
          // El vaivén en reposo mueve el árbol cada cuadro.
          relojRef.current = t / 1000;
          sucio.current = true;
        }
        if (sucio.current) pintar();
      }
      id = requestAnimationFrame(cuadro);
    };
    id = requestAnimationFrame(cuadro);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista3d, reducido, vacio]);
  const nodoSel = seleccion ? grafo.porId.get(seleccion) ?? null : null;
  // Familias de mecanismo: orden estable por primera aparición entre las hipótesis visibles.
  const clusterDe = useMemo(() => new Map(estado.hipotesis.filter((x) => x.investigacionId === inv.id).map((x) => [x.id, x.cluster || 'Sin cluster'])), [estado.hipotesis, inv.id]);
  const familias = useMemo(() => {
    const vistas: string[] = [];
    for (const x of estado.hipotesis) if (x.investigacionId === inv.id && x.estado !== 'descartada' && !vistas.includes(x.cluster || 'Sin cluster')) vistas.push(x.cluster || 'Sin cluster');
    for (const x of estado.hipotesis) if (x.investigacionId === inv.id && !vistas.includes(x.cluster || 'Sin cluster')) vistas.push(x.cluster || 'Sin cluster');
    return vistas;
  }, [estado.hipotesis, inv.id]);
  const colorFamilia = (nombre: string) => PALETA_CLUSTER[Math.max(0, familias.indexOf(nombre)) % PALETA_CLUSTER.length]!;
  const colorPorTipo = (n: NodoArbol) => {
    if (n.tipo === 'hipotesis') return colorFamilia(clusterDe.get(n.id) ?? 'Sin cluster');
    if (n.tipo === 'rama') return colorFamilia(n.id.slice('rama-'.length));
    return COLOR[n.tipo];
  };
  const colorDe = (n: NodoArbol) => (modoColor === 'dato' ? colorPorDato(n) : colorPorTipo(n));
  // Anillo de evidencia en el modo por tipo: el borde lleva la distancia al dato
  // (verde medición propia, ámbar literatura leída, gris nada), así el relleno dice
  // qué es el nodo y el anillo cuánto lo sostiene.
  const anilloDe = (n: NodoArbol): string | null => (modoColor === 'tipo' && !SIN_DISTANCIA.has(n.tipo) && !n.alerta ? colorPorDato(n) : null);
  // Sin camino al dato: relleno gris y borde punteado (solo en el modo por distancia).
  // Punteado solo para lo que no tiene ni medición ni literatura leída detrás.
  const sinDato = (n: NodoArbol) => modoColor === 'dato' && !SIN_DISTANCIA.has(n.tipo) && claveDistancia(n) === 'nulo';
  // Resaltar solo al pasar el ratón (como Obsidian): el nodo y sus vecinos vivos, el
  // resto atenuado. La selección (el último nodo abierto) conserva su anillo y su
  // panel, pero no atenúa a los demás: sin ratón encima se ve el árbol entero
  // (petición de Emir, 16 de septiembre de 2026). Lo calcula la escena
  // (lib/lienzo_arbol.ts) a partir del nodo bajo el ratón y de la búsqueda.
  /** Relleno, anillo y rayas de un nodo: lo que la escena necesita de los modos de color. */
  const estiloDe = (n: NodoArbol): EstiloNodo => ({
    relleno: colorDe(n),
    anillo: n.alerta ? 'var(--red)' : anilloDe(n) ?? (sinDato(n) ? 'var(--text-3)' : n.tipo === 'rama' || n.tipo === 'area' ? 'var(--accent)' : 'var(--surface)'),
    anchoAnillo: n.alerta ? 2 : anilloDe(n) ? 3 : 1.5,
    guion: n.estado === 'descartada' ? '3 2' : sinDato(n) || (anilloDe(n) && claveDistancia(n) === 'nulo') ? '2 2' : null,
  });
  ctx.current = { grafo, enTiempo, vista3d, reducido, iluminados, seleccion, estiloDe };

  // La rueda va con un oyente nativo no pasivo: React registra onWheel como
  // pasivo y preventDefault no haría nada (la página haría scroll). En la vista
  // plana acerca alrededor del cursor; en 3D cambia la distancia de la cámara.
  useEffect(() => {
    const svg = lienzoRef.current;
    if (!svg) return;
    const alRueda = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      if (vista3d) {
        ultimoToque.current = performance.now();
        camaraTocada.current = true;
        encuadrar.current = false;
        const c = camaraRef.current;
        camaraRef.current = acotarCamara({ ...c, distancia: c.distancia / factor });
        sucio.current = true;
        if (reducido) repintar();
        return;
      }
      const p = enLienzo(e.clientX, e.clientY);
      const v = vistaRef.current;
      const k = Math.max(0.25, Math.min(4, v.k * factor));
      // Zoom alrededor del cursor: el punto bajo el ratón no se mueve.
      vistaRef.current = { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
      sucio.current = true;
      if (reducido) repintar();
    };
    svg.addEventListener('wheel', alRueda, { passive: false });
    return () => svg.removeEventListener('wheel', alRueda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista3d, vacio, reducido]);
  /** El nodo bajo el puntero según la última escena pintada. */
  const nodoEn = (e: React.PointerEvent | React.MouseEvent): NodoArbol | null => {
    const escena = escenaRef.current;
    if (!escena) return null;
    const p = puntoLogico(e.clientX, e.clientY);
    const id = nodoBajoPuntero(escena, p.x, p.y);
    return id ? grafo.porId.get(id) ?? null : null;
  };
  const ponerHover = (id: string | null) => {
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    sucio.current = true;
    if (reducido) repintar();
    else pintar();
  };
  const empezarArrastre = (e: React.PointerEvent) => {
    const nodo = nodoEn(e);
    if (vista3d) {
      ultimoToque.current = performance.now();
      // En 3D los nodos no se arrastran: soltar sin mover es pulsar; el fondo gira la cámara.
      if (nodo) {
        pulsacion.current = { id: nodo.id, x0: e.clientX, y0: e.clientY, movido: false };
        return;
      }
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      arrastreCamara.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (nodo) {
      const p = pos2.current.get(nodo.id);
      if (p) {
        arrastreNodo.current = { id: nodo.id, x0: e.clientX, y0: e.clientY, movido: false };
        p.fijo = true;
      }
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    arrastre.current = { x: e.clientX, y: e.clientY, vx: vistaRef.current.x, vy: vistaRef.current.y };
  };
  const mover = (e: React.PointerEvent) => {
    if (pulsacion.current) {
      if (Math.hypot(e.clientX - pulsacion.current.x0, e.clientY - pulsacion.current.y0) > 4) pulsacion.current.movido = true;
      return;
    }
    if (arrastreCamara.current) {
      // Girar la cámara: el movimiento horizontal es guiñada y el vertical, cabeceo.
      // Los signos hacen que el frente del árbol siga al puntero. El giro es
      // incremental (cada movimiento suma su diferencia a la cámara actual), así al
      // topar con el cabeceo máximo la cámara responde en cuanto el puntero vuelve.
      const a = arrastreCamara.current;
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      a.x = e.clientX;
      a.y = e.clientY;
      ultimoToque.current = performance.now();
      camaraTocada.current = true;
      encuadrar.current = false;
      const c = camaraRef.current;
      camaraRef.current = acotarCamara({ ...c, guinada: c.guinada - dx * SENSIBILIDAD_GIRO, cabeceo: c.cabeceo + dy * SENSIBILIDAD_GIRO });
      sucio.current = true;
      if (reducido) repintar();
      return;
    }
    if (arrastreNodo.current) {
      const a = arrastreNodo.current;
      const p = pos2.current.get(a.id);
      if (!p) return;
      if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 4) a.movido = true;
      const l = enLienzo(e.clientX, e.clientY);
      // Del lienzo a las coordenadas del grafo (deshaciendo la vista).
      const v = vistaRef.current;
      p.x = (l.x - v.x) / v.k;
      p.y = (l.y - v.y) / v.k;
      p.vx = 0;
      p.vy = 0;
      sucio.current = true;
      reavivar(0.35); // los vecinos siguen al que se arrastra
      return;
    }
    if (arrastre.current) {
      const a = arrastre.current;
      // Al agarrar el árbol, las esferas no van pegadas al fondo: reciben un
      // impulso contrario, se columpian y vuelven a su sitio tiradas por los
      // enlaces (el tronco está fijo). Es la sacudida de un árbol de verdad.
      const dx = e.clientX - (a.ux ?? a.x);
      const dy = e.clientY - (a.uy ?? a.y);
      a.ux = e.clientX;
      a.uy = e.clientY;
      if (!reducido) {
        for (const p of pos2.current.values()) {
          if (p.fijo) continue;
          p.vx -= (dx * 0.12) / vistaRef.current.k;
          p.vy -= (dy * 0.12) / vistaRef.current.k;
        }
        reavivar(0.25);
      }
      vistaRef.current = { ...vistaRef.current, x: a.vx + (e.clientX - a.x), y: a.vy + (e.clientY - a.y) };
      sucio.current = true;
      if (reducido) repintar();
      return;
    }
    // Sin arrastre: el ratón ilumina el nodo que tiene debajo y sus vecinos.
    ponerHover(nodoEn(e)?.id ?? null);
  };
  const soltar = (e: React.PointerEvent) => {
    if (arrastreCamara.current) {
      arrastreCamara.current = null;
      ultimoToque.current = performance.now();
    }
    if (pulsacion.current) {
      const p = pulsacion.current;
      pulsacion.current = null;
      if (!p.movido && e.type === 'pointerup') {
        const n = grafo.porId.get(p.id);
        if (n) pulsar(n, 1);
      }
    }
    if (arrastreNodo.current) {
      const a = arrastreNodo.current;
      const p = pos2.current.get(a.id);
      if (p && a.id !== 'objetivo') p.fijo = false;
      arrastreNodo.current = null;
      // Un arrastre no es un clic: si se movió, no se despliega ni se selecciona.
      if (a.movido) reavivar(0.3);
      else if (e.type === 'pointerup') {
        const n = grafo.porId.get(a.id);
        if (n) pulsar(n, 1);
      }
    }
    arrastre.current = null;
  };
  const salir = () => {
    ponerHover(null);
  };
  const dobleClic = (e: React.MouseEvent) => {
    const n = nodoEn(e);
    if (n?.href) window.location.hash = n.href;
  };
  const pulsar = (n: NodoArbol, detalle: number) => {
    if (detalle > 1) return; // la segunda pulsación de un doble clic no vuelve a plegar
    ultimoToque.current = performance.now();
    setSeleccion(n.id);
    setVisibles((v) => alternar(grafo, v, n.id));
  };

  if (vacio) {
    return (
      <div className="contenido">
        <AvisoMuestra conexion={estado.conexion} />
        <Vacio titulo="El árbol todavía no tiene ramas" pasos={['El tronco es el objetivo; ya está.', 'Cuando ROSA2018 busque literatura y verifique afirmaciones, aparecerán los hechos y las fuentes.', 'Cada hipótesis será una hoja en la rama de su cluster de mecanismo, unida a lo que la sostiene.', 'El experimento que llegue al laboratorio será el fruto.']}>
          Aquí se ve toda la investigación conectada: qué sostiene a qué, qué comparte una entidad con qué, y qué rivaliza con qué.
        </Vacio>
      </div>
    );
  }

  const colocado = (id: string) => (vista3d ? pos3.current.has(id) : pos2.current.has(id));
  const enlacesVisibles = grafo.enlaces.filter((e) => enTiempo.has(e.de) && enTiempo.has(e.a) && colocado(e.de) && colocado(e.a));
  const nodosVisibles = [...enTiempo].map((id) => grafo.porId.get(id)).filter((n): n is NodoArbol => Boolean(n) && colocado(n!.id));
  // La leyenda explica solo los tipos de nodo que existen en este árbol (visibles o plegados).
  const tiposPresentes = new Set(grafo.nodos.map((n) => n.tipo));

  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>Árbol de la investigación</h2>
          <p>{AYUDA}</p>
        </div>
        <div className="acciones">
          <div className="segmentos" role="group" aria-label="Vista del árbol">
            <button type="button" aria-pressed={!vista3d} onClick={() => cambiarVista('plana')} title="El árbol en el plano: arrastra el fondo para desplazarlo y los nodos para moverlos">
              Vista plana
            </button>
            <button type="button" aria-pressed={vista3d} onClick={() => cambiarVista('3d')} title="El árbol en tres dimensiones: arrastra el fondo para girarlo, rueda para acercar; lo lejano se ve pequeño y tenue">
              Vista 3D
            </button>
          </div>
          <div className="segmentos" role="group" aria-label="Color de los nodos">
            <button type="button" aria-pressed={modoColor === 'tipo'} onClick={() => setModoColor('tipo')} title="Relleno por tipo de nodo y por familia de mecanismo en las hipótesis; anillo por distancia al dato">
              Por tipo y mecanismo
            </button>
            <button type="button" aria-pressed={modoColor === 'dato'} onClick={() => setModoColor('dato')} title="Cuanto más intenso, más cerca de una medición propia de ROSA2018; ámbar, solo literatura leída; gris punteado, nada">
              Por distancia al dato
            </button>
          </div>
          <input className="entrada entrada-s" style={{ width: 220 }} value={texto} placeholder="Buscar en el árbol" onChange={(e) => setTexto(e.target.value)} aria-label="Buscar en el árbol" />
          <button type="button" className="btn btn-s" onClick={() => { setVisibles(visiblesIniciales(grafo, hip)); setSeleccion(null); vistaRef.current = { x: 0, y: 0, k: 1 }; camaraRef.current = camaraInicial(); camaraTocada.current = false; encuadrar.current = true; sucio.current = true; repintar(); }}>
            Plegar todo
          </button>
          <button type="button" className="btn btn-s" onClick={() => { setVisibles(new Set(grafo.nodos.map((n) => n.id))); }} title="Despliega hasta las fuentes: puede ser mucho">
            Desplegar todo
          </button>
        </div>
      </div>

      <div className="grafo-marco">
        <div>
          <canvas ref={lienzoRef} className="grafo" data-vista={vista3d ? '3d' : 'plana'} role="img" aria-label={`Árbol de ${inv.titulo}${vista3d ? ' en tres dimensiones' : ''}: ${nodosVisibles.length} nodos y ${enlacesVisibles.length} enlaces visibles`} onPointerDown={empezarArrastre} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} onPointerLeave={salir} onDoubleClick={dobleClic} />
          {/* La misma información para el teclado y los lectores de pantalla: un botón por
              nodo visible. Llevan las clases grafo-nodo y grafo-<tipo> que tenían las esferas
              del SVG: son los nodos en el árbol de accesibilidad y así los localizan los tests. */}
          <ul className="sr-only" role="list" aria-label="Nodos del árbol">
            {nodosVisibles.map((n) => (
              <li key={n.id}>
                <button type="button" className={`grafo-nodo grafo-${n.tipo}`} data-id={n.id} aria-pressed={seleccion === n.id} onClick={() => pulsar(n, 1)} onDoubleClick={() => { if (n.href) window.location.hash = n.href; }} onFocus={() => ponerHover(n.id)} onBlur={() => ponerHover(null)}>
                  {NOMBRE_TIPO[n.tipo]}: {n.etiqueta}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <aside className="grafo-panel">
          {nodoSel ? (
            <>
              <Chip tono="acento">{NOMBRE_TIPO[nodoSel.tipo]}</Chip>
              <h3>{nodoSel.etiqueta}</h3>
              {nodoSel.sub && <p className="meta">{nodoSel.sub}</p>}
              {nodoSel.alerta && <p className="tono-mal" style={{ fontSize: 13 }}>{nodoSel.alerta}</p>}
              {nodoSel.alias && nodoSel.alias.length > 1 && <p className="meta">Alias: {nodoSel.alias.slice(0, 8).join(', ')}</p>}
              <p className="meta">Aparece desde la iteración {nodoSel.iteracion || 1} de {grafo.iteracionMax} (contando seguidas todas las corridas).</p>
              {!SIN_DISTANCIA.has(nodoSel.tipo) && <p className="meta">{fraseProfundidad(nodoSel)}</p>}
              <h4>Conectado con</h4>
              <ul className="grafo-vecinos">
                {grafo.enlaces
                  .filter((e) => e.de === nodoSel.id || e.a === nodoSel.id)
                  .slice(0, 40)
                  .map((e) => {
                    const otro = grafo.porId.get(e.de === nodoSel.id ? e.a : e.de);
                    if (!otro) return null;
                    return (
                      <li key={`${e.de}|${e.a}|${e.tipo}`}>
                        <button type="button" className="enlace" onClick={() => { setSeleccion(otro.id); setVisibles((v) => new Set([...v, otro.id])); }}>
                          <span className="grafo-punto" style={{ background: colorDe(otro) }} aria-hidden="true" /> {otro.etiqueta.length > 60 ? `${otro.etiqueta.slice(0, 58)}...` : otro.etiqueta}
                        </button>
                        <span className="meta"> · {NOMBRE_ENLACE[e.tipo]}{e.etiqueta ? ` (${e.etiqueta})` : ''}</span>
                      </li>
                    );
                  })}
              </ul>
              {nodoSel.href && (
                <a className="btn btn-s" href={nodoSel.href}>
                  Abrir
                </a>
              )}
            </>
          ) : (
            <>
              <h3>Leyenda</h3>
              <p className="meta">Cada nodo tiene dos colores con dos mensajes: el de dentro dice qué es; el borde dice cuánta evidencia lo sostiene.</p>
              {modoColor === 'dato' ? (
                <>
                  <h4 className="grafo-leyenda-titulo">El color de dentro: a qué distancia está del dato</h4>
                  <p className="meta">En este modo el relleno cuenta los saltos que separan cada nodo de una medición propia de ROSA2018. Medición propia es un análisis in silico que pasó la auditoría, un resultado del laboratorio o una observación original sostenida.</p>
                  <ul className="grafo-leyenda">
                    {ESCALA_DATO.map((c, i) => (
                      <li key={`d${i}`}>
                        <span className="grafo-punto" style={{ background: c }} aria-hidden="true" /> {NOMBRE_ESCALA[i]}{i === 0 ? ': verde azulado intenso. Cuanto más claro, más lejos del dato.' : '.'}
                      </li>
                    ))}
                    {ESCALA_LIT.map((c, i) => (
                      <li key={`l${i}`}>
                        <span className="grafo-punto" style={{ background: c }} aria-hidden="true" /> {NOMBRE_ESCALA_LIT[i]}{i === 0 ? ': ámbar. ROSA2018 lo sostiene con artículos, nunca lo ha medido; cuanto más intenso, más cerca de una fuente leída.' : '.'}
                      </li>
                    ))}
                    <li>
                      <span className="grafo-punto grafo-punto-nulo" aria-hidden="true" /> Sin medición propia ni literatura leída: gris punteado. Nada lo sostiene todavía.
                    </li>
                  </ul>
                  <p className="meta">El tronco, las áreas, las ramas y las entidades conservan su color: son estructura o nombres, no evidencia. Borde rojo: hay una alerta. Punteada: descartada o sin medición propia.</p>
                </>
              ) : (
                <>
                  <h4 className="grafo-leyenda-titulo">El color de dentro: qué es cada nodo</h4>
                  <ul className="grafo-leyenda">
                    <li>
                      <span className="grafo-punto" style={{ background: `conic-gradient(${PALETA_CLUSTER.slice(0, 6).join(', ')})` }} aria-hidden="true" /> {DEFINICION_TIPO.hipotesis} La rama que las agrupa lleva el mismo color.
                      {familias.length > 0 && (
                        <ul className="grafo-leyenda grafo-leyenda-sub">
                          {familias.map((f) => (
                            <li key={f}>
                              <span className="grafo-punto" style={{ background: colorFamilia(f) }} aria-hidden="true" /> {f}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                    {(Object.keys(NOMBRE_TIPO) as TipoNodo[]).filter((t) => t !== 'hipotesis' && t !== 'rama' && tiposPresentes.has(t)).map((t) => (
                      <li key={t}>
                        <span className="grafo-punto" style={{ background: COLOR[t] }} aria-hidden="true" /> {DEFINICION_TIPO[t]}
                      </li>
                    ))}
                  </ul>
                  <h4 className="grafo-leyenda-titulo">El borde: cuánta evidencia lo sostiene</h4>
                  <ul className="grafo-leyenda">
                    <li><span className="grafo-punto grafo-anillo" style={{ borderColor: 'var(--grafo-dato-1)' }} aria-hidden="true" /> Anillo verde: a un paso de una medición propia de ROSA2018 (un análisis in silico que pasó la auditoría, un resultado del laboratorio o una observación original). Es lo más sólido.</li>
                    <li><span className="grafo-punto grafo-anillo" style={{ borderColor: 'var(--grafo-lit-1)' }} aria-hidden="true" /> Anillo ámbar: solo literatura leída detrás. ROSA2018 lo sostiene con artículos, pero nunca lo ha medido ella.</li>
                    <li><span className="grafo-punto grafo-anillo grafo-anillo-nulo" aria-hidden="true" /> Anillo gris punteado: nada lo sostiene todavía.</li>
                    <li><span className="grafo-punto grafo-anillo" style={{ borderColor: 'var(--red)' }} aria-hidden="true" /> Anillo rojo: hay una alerta (una contradicción, un bloqueo o una marca editorial). Manda sobre los demás.</li>
                    <li><span className="grafo-punto grafo-anillo grafo-anillo-rayas" aria-hidden="true" /> A rayas: hipótesis descartada.</li>
                  </ul>
                  <p className="meta">En resumen: dentro, qué es y a qué mecanismo pertenece; el borde, si ROSA2018 lo midió (verde), solo lo leyó (ámbar) o aún no tiene nada (gris).</p>
                </>
              )}
              <h4 className="grafo-leyenda-titulo">Las líneas: cómo se conectan</h4>
              <ul className="grafo-leyenda">
                {(Object.keys(NOMBRE_ENLACE) as TipoEnlace[]).map((t) => (
                  <li key={t}>
                    <span className="grafo-linea" style={{ borderColor: TRAZO[t].color, borderStyle: TRAZO[t].guion ? 'dashed' : 'solid' }} aria-hidden="true" /> {NOMBRE_ENLACE[t]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <div className="grafo-tiempo">
        <button type="button" className="btn btn-s" aria-pressed={hasta === grafo.iteracionMax} onClick={() => setHasta(grafo.iteracionMax)}>
          {hasta === grafo.iteracionMax ? 'En vivo' : 'Volver al presente'}
        </button>
        <label htmlFor="grafo-iteracion">
          Cómo creció: hasta la iteración <strong>{hasta}</strong> de {grafo.iteracionMax}
        </label>
        <input id="grafo-iteracion" type="range" min={1} max={Math.max(1, grafo.iteracionMax)} value={Math.min(hasta, Math.max(1, grafo.iteracionMax))} onChange={(e) => setHasta(Number(e.target.value))} />
        <span className="meta">
          {nodosVisibles.length} nodos · {enlacesVisibles.length} enlaces
        </span>
      </div>
    </div>
  );
}
