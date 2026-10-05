// Raíz de ROSA2018: lee el estado del almacén y la ruta del hash, y monta la
// barra lateral, la cabecera y la pantalla que toque. La búsqueda global se
// abre con Cmd+K o Ctrl+K. El título de la pestaña lleva cuántas decisiones
// esperan, para verlo sin abrir la pestaña.
//
// La espera al cambiar de pantalla (estándar de Emir, 19 de septiembre de
// 2026): el clic en la barra lateral tiene que responder al instante con la
// silueta de la pantalla nueva, nunca con una congelación. Algunas pantallas
// cuestan de pintar por primera vez (el Árbol construye su grafo en el
// render; el Ranking y el Atlas hacen su cálculo pesado fuera del render pero
// aun así montan mucho). Para ellas, el primer render tras cambiar de ruta (o
// de investigación en la misma pantalla) pinta un esqueleto con la silueta de
// esa pantalla y nada de la pantalla misma (ni sus hooks ni sus useMemo);
// después del pintado llega la pantalla real. Lo resuelve
// useCalculoDiferido (lib/diferido.ts) con la clave de la página como
// dependencia: el esqueleto vive un frame y el contenido lo sustituye sin
// parpadeo, porque el cambio es de silueta gris a contenido. Las pantallas
// ligeras no pasan por aquí: se pintan directas, sin un frame gris.
//
// Regla para elegir la silueta: EXACTAMENTE la misma que la pantalla pinta
// por dentro en su primer render, componente incluido, para que entre el
// frame de App y el primero de la pantalla no cambie nada en la maqueta (ni
// la anchura del contenido, ni la altura de la cabecera, ni la figura). Por
// eso el Árbol usa EsqueletoArbol (exportado por Arbol.tsx: la cabecera real
// con los mandos en gris, el marco del grafo y la barra de iteraciones), el
// Atlas usa EsqueletoAtlas (Atlas.tsx) y el Ranking la EsqueletoPantalla de
// lista con el rótulo "el ranking", que es la que Ranking.tsx devuelve
// mientras calcula. Una silueta genérica con el mismo rótulo pero otra forma
// (lo que el árbol tuvo un día) es un salto de maqueta de un frame, y
// App.esqueleto.test.tsx lo vigila grabando la FORMA de la silueta tras cada
// commit, no solo su rótulo. Modelo de mundo tiene su propia silueta
// (SiluetaMundo, dentro de ModeloDeMundo.tsx) y su primer render ya es
// barato: una silueta distinta desde aquí sería un salto de maqueta de un
// frame, así que no se envuelve y el test comprueba que esa ruta enseña una
// sola espera, la suya.
//
// Mientras el estado todavía no ha llegado (estado.conexion === 'conectando')
// App NO pinta ningún esqueleto propio: la carga inicial la cubre Acceso
// (componentes/Acceso.tsx pinta EsqueletoAplicacion, la maqueta entera en
// gris, y no monta App hasta que conectar() ha resuelto y el estado ya es
// 'en_linea'), y si el estado volviera a 'conectando' con App montada, cada
// pantalla pinta su propia silueta (Inicio, Corrida, Hipótesis, Ranking). Un
// esqueleto más aquí pondría dos "Cargando" anidados y dos aria-busy.
// App.esqueleto.test.tsx comprueba que con 'conectando' la maqueta (barra y
// cabecera) se queda y no hay ninguna encima.

import { AnimatePresence, motion } from 'motion/react';
import { Limite } from './componentes/Limite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { acciones, cerrarAvisoConflicto, reintentarConexion, useAvisoConflicto, useRosa } from './datos/almacen';
import type { EstadoConexion } from './datos/tipos';
import { BarraLateral } from './componentes/BarraLateral';
import { BusquedaGlobal } from './componentes/BusquedaGlobal';
import { Cabecera } from './componentes/Cabecera';
import { ToastDeshacer } from './componentes/Deshacer';

import { HiloDelProceso } from './componentes/HiloDelProceso';
import { Recorrido, recorridoVisto } from './componentes/Recorrido';
import { useCalculoDiferido } from './lib/diferido';
import { pagina } from './lib/movimiento';
import { loQueEspera } from './lib/digest';
import type { Pantalla } from './lib/ruta';
import { rutaLaboratorio } from './lib/ruta';
import { useAhora } from './lib/useAhora';
import { useRuta } from './lib/useRuta';
import { Ajustes } from './pantallas/Ajustes';
import { Arbol, EsqueletoArbol } from './pantallas/Arbol';
import { Artefactos } from './pantallas/Artefactos';
import { Atlas, EsqueletoAtlas } from './pantallas/Atlas';
import { Citas } from './pantallas/Citas';
import { Laboratorio } from './pantallas/Laboratorio';
import { Mecanismos } from './pantallas/Mecanismos';
import { Corrida } from './pantallas/Corrida';
import { Hipotesis } from './pantallas/Hipotesis';
import { Inicio } from './pantallas/Inicio';
import { Investigacion } from './pantallas/Investigacion';
import { ModeloDeMundo } from './pantallas/ModeloDeMundo';
import { NuevaInvestigacion } from './pantallas/NuevaInvestigacion';
import { Panorama } from './pantallas/Panorama';
import { Ranking } from './pantallas/Ranking';
import { tr, traducido, trp, useIdioma } from './lib/idioma';
import { activar as activarTraductor, desactivar as desactivarTraductor, traducirSuelto } from './lib/traductorDom';

const TITULO_PANTALLA = traducido({
  corrida: 'Corrida en vivo',
  // La ruta `hipotesis` ya solo pinta la ficha de una: la lista se fusionó
  // con el ranking el 1 de octubre de 2026.
  hipotesis: 'Hipótesis',
  ranking: 'Hipótesis y ranking',
  panorama: 'Panorama',
  mundo: 'Modelo de mundo',
  arbol: 'Árbol de la investigación',
  atlas: 'Atlas de la enfermedad',
  mecanismos: 'Mecanismos',
  citas: 'Citas',
  artefactos: 'Artefactos',
  investigacion: 'Objetivo y datos',
} as const);

/** El rótulo oculto ("Cargando el ranking") de la silueta del ranking, el
 *  mismo que Ranking.tsx pone por dentro mientras calcula. Los del árbol y
 *  del atlas viajan dentro de sus componentes (EsqueletoArbol y
 *  EsqueletoAtlas traen el suyo). App.esqueleto.test.tsx los coteja tal cual
 *  (no se exporta: un módulo de componente con más exportaciones pierde el
 *  refresco en caliente de Vite). */

/** Las pantallas que cuestan de pintar y la silueta que se enseña durante el
 *  primer frame tras el clic. Ver la regla de arriba: el MISMO componente que
 *  la pantalla pinta por dentro, para no saltar. */
const SILUETA_AL_CAMBIAR: Partial<Record<Pantalla, (conexion: EstadoConexion) => JSX.Element>> = {
  arbol: (conexion) => <EsqueletoArbol conexion={conexion} />,
  // El ranking NO está aquí desde el 1 de octubre de 2026: tiene cinco
  // vistas (podio, pendientes, lista completa, clusters y laboratorio) y
  // cada una pinta una silueta distinta. Desde fuera no se sabe cuál toca,
  // y poner la de la lista hacía que al abrir el podio parpadearan dos
  // formas seguidas. La pinta Ranking, que sí sabe en qué vista está.
  atlas: (conexion) => <EsqueletoAtlas conexion={conexion} />,
};

/** Verdadero en el primer render después de que cambie `clave` (también en
 *  el primero de todos), falso después del pintado. Con `null` no hay nada
 *  que esperar y siempre es falso: así las pantallas ligeras no pasan por un
 *  frame gris. Es useCalculoDiferido sin cálculo: lo que se difiere es montar
 *  la pantalla. */
function usePrimerFrame(clave: string | null): boolean {
  const { calculando } = useCalculoDiferido(() => clave, [clave]);
  return clave !== null && calculando;
}

export default function App() {

  // En inglés, lo que no está en el catálogo (lo que escribió ROSA2018, la
  // prosa del servidor) se traduce al pintarse (lib/traductorDom.ts). Al
  // volver al castellano cada nodo recupera su original.
  const idiomaApp = useIdioma();
  useEffect(() => {
    const raiz = document.getElementById('root');
    if (idiomaApp === 'en' && raiz) activarTraductor(raiz, acciones.traducirTextos);
    else desactivarTraductor();
    return () => desactivarTraductor();
  }, [idiomaApp]);
  const remoto = useRosa();
  const aviso = useAvisoConflicto();
  const [ruta] = useRuta();
  const ultimaVista = useRef<{ id: string; estado: typeof remoto } | null>(null);
  const idActual = ruta.tipo === 'investigacion' ? ruta.investigacionId : null;
  const faltaActual = idActual !== null && !remoto.investigaciones.some(i => i.id === idActual);
  const conservando = faltaActual && ultimaVista.current?.id === idActual;
  const estado = conservando ? ultimaVista.current!.estado : remoto;
  useEffect(() => {
    if (idActual && !faltaActual) ultimaVista.current = { id: idActual, estado: remoto };
    else if (!idActual || ultimaVista.current?.id !== idActual) ultimaVista.current = null;
  }, [idActual, faltaActual, remoto]);
  const ahora = useAhora();
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Solo la primera página salta su fundido de entrada: la app abre quieta.
  const primeraPagina = useRef(true);
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [recorrido, setRecorrido] = useState(() => !recorridoVisto());
  const [reintentando, setReintentando] = useState(false);

  const irA = (hash: string) => {
    window.location.hash = hash;
  };

  const inv = useMemo(() => (ruta.tipo === 'investigacion' ? estado.investigaciones.find((i) => i.id === ruta.investigacionId) ?? null : null), [ruta, estado.investigaciones]);
  const esperan = inv ? loQueEspera(estado, inv.id, ahora).total : 0;

  const claveRuta = ruta.tipo === 'investigacion' ? `${ruta.investigacionId}/${ruta.pantalla}/${ruta.detalleId ?? ''}` : ruta.tipo;
  // La transición de página se dispara solo al cambiar de pantalla. Abrir un
  // detalle (una hipótesis en su cajón, un artefacto) es la misma pantalla:
  // si también cambiara la clave, la página entera se desmontaría y volvería
  // a montarse con fundido, y en tema oscuro eso se ve como un parpadeo negro
  // (más largo cuanto más ocupado esté el navegador con el flujo de eventos).
  const clavePagina = ruta.tipo === 'investigacion' ? `${ruta.investigacionId}/${ruta.pantalla}` : ruta.tipo;
  // La silueta de la pantalla pesada que toca, si la hay, y si estamos en su
  // primer frame (la clave de la página cambia al cambiar de pantalla y al
  // cambiar de investigación; abrir un detalle no la cambia y no pasa por aquí).
  const silueta = ruta.tipo === 'investigacion' && inv ? SILUETA_AL_CAMBIAR[ruta.pantalla] ?? null : null;
  const primerFrame = usePrimerFrame(silueta ? clavePagina : null);
  useEffect(() => {
    setMenuAbierto(false);
    setBuscando(false);
    if (!(ruta.tipo === 'investigacion' && ruta.pantalla === 'hipotesis' && ruta.detalleId)) setCajonAbierto(false);
  }, [claveRuta, ruta]);

  // El título de la pestaña está fuera de `#root`, así que el traductor de
  // pantalla no llega: se pide aparte y se recuerda por título.
  const [titulosEn, setTitulosEn] = useState<Record<string, string>>({});
  useEffect(() => {
    const propio = inv?.titulo;
    const enIngles = propio && idiomaApp === 'en' ? titulosEn[propio] : undefined;
    const base = propio ? `${enIngles ?? propio} · ROSA2018` : tr('ROSA2018 · Alzheimer Project');
    document.title = esperan > 0 ? `(${esperan}) ${base}` : base;
    if (propio && idiomaApp === 'en' && enIngles === undefined) {
      traducirSuelto(propio, (en) => setTitulosEn((previos) => ({ ...previos, [propio]: en })));
    }
  }, [inv, esperan, idiomaApp, titulosEn]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBuscando((v) => !v);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  let titulo = tr('Investigaciones');
  let miga: string | null = null;
  let pantalla: JSX.Element;

  if (ruta.tipo === 'nueva') {
    titulo = tr('Nueva investigación');
    pantalla = <NuevaInvestigacion estado={estado} irA={irA} />;
  } else if (ruta.tipo === 'asistente') {
    titulo = tr('Asistente de ROSA');
    pantalla = <ModeloDeMundo estado={estado} ahora={ahora} inv={estado.asistenteGlobal ?? {
      id: 'global', titulo, objetivo: 'Operar y consultar todo ROSA', relevancia: '', limites: [],
      condicionParada: '', revisores: [], estado: 'activa', creadaEn: 0, ramaDe: null,
      configuracion: { preferencias: '', atributos: [], restricciones: [], amplitud: 'equilibrada' },
      datasets: [], vigilarLiteraturaHasta: null, preguntasABases: [], memoria: [],
    }} />;
  } else if (ruta.tipo === 'ajustes') {
    titulo = tr('Ajustes');
    pantalla = <Ajustes estado={estado} ahora={ahora} />;
  } else if (ruta.tipo === 'laboratorio') {
    // Global a propósito: reúne lo que ROSA2018 ha verificado en TODAS sus
    // investigaciones, no lo de una.
    titulo = tr('Al laboratorio');
    pantalla = <Laboratorio dianaId={ruta.dianaId} panel={ruta.panel} alAbrirDiana={(u, panel) => irA(rutaLaboratorio(u, panel ?? null))} />;
  } else if (ruta.tipo === 'investigacion') {
    if (!inv) {
      titulo = tr('Investigación');
      pantalla = (
        <div className="contenido">
          <div className="vacio">
            <h3>{tr("No se pudo cargar esta investigación")}</h3>
            <p role="status">{tr("Comprueba la conexión o vuelve a intentarlo. No se ha cambiado tu dirección de navegación.")}</p>
            <p>
              <a className="enlace" href="#/">
                {tr("Volver al inicio")}
              </a>
            </p>
          </div>
        </div>
      );
    } else {
      miga = inv.titulo;
      titulo = TITULO_PANTALLA[ruta.pantalla];
      switch (ruta.pantalla) {
        case 'corrida':
          pantalla = <Corrida key={inv.id} inv={inv} estado={estado} ahora={ahora} irA={irA} />;
          break;
        case 'hipotesis':
          pantalla = <Hipotesis inv={inv} estado={estado} ahora={ahora} detalleId={ruta.detalleId} cajonAbierto={cajonAbierto} setCajonAbierto={setCajonAbierto} />;
          break;
        case 'ranking':
          pantalla = <Ranking inv={inv} estado={estado} detalleId={ruta.detalleId} irA={irA} />;
          break;
        case 'panorama':
          pantalla = <Panorama inv={inv} estado={estado} ahora={ahora} />;
          break;
        case 'mundo':
          pantalla = <ModeloDeMundo inv={inv} estado={estado} ahora={ahora} vistaInicial={ruta.detalleId} />;
          break;
        case 'arbol':
          pantalla = <Arbol key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'atlas':
          pantalla = <Atlas key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'mecanismos':
          pantalla = <Mecanismos key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'citas':
          pantalla = <Citas key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'artefactos':
          pantalla = <Artefactos inv={inv} estado={estado} ahora={ahora} detalleId={ruta.detalleId} />;
          break;
        case 'investigacion':
          pantalla = <Investigacion key={inv.id} inv={inv} estado={estado} ahora={ahora} irA={irA} />;
          break;
      }
    }
  } else {
    pantalla = <Inicio estado={estado} ahora={ahora} />;
  }

  // El primer frame de una pantalla pesada: su silueta en lugar de ella. La
  // silueta va dentro del mismo Limite y la misma página animada que la
  // pantalla, así que el contenido la sustituye en su sitio, sin volver a
  // fundir la página.
  const cuerpo = silueta && primerFrame ? silueta(estado.conexion) : pantalla;

  const conCajon = cajonAbierto && ruta.tipo === 'investigacion' && ruta.pantalla === 'hipotesis' && ruta.detalleId !== null;

  const reintentar = async () => {
    setReintentando(true);
    try {
      await reintentarConexion();
    } finally {
      setReintentando(false);
    }
  };

  return (
    <div className={`app ${conCajon ? 'con-cajon' : ''}`}>
      <BarraLateral estado={estado} ruta={ruta} abierta={menuAbierto} onCerrar={() => setMenuAbierto(false)} onBuscar={() => setBuscando(true)} onAyuda={() => setRecorrido(true)} />
      <main className="principal">
        <Cabecera miga={miga} titulo={titulo} onMenu={() => setMenuAbierto(true)} />
        {estado.conexion === 'sin_conexion' && (
          <div className="panel-sin-conexion" role="alert">
            <span>{tr("Sin conexión a internet")}</span>
            <button type="button" className="btn btn-s" disabled={reintentando} onClick={() => void reintentar()}>
              {reintentando ? 'Reintentando…' : 'Reintentar'}
            </button>
          </div>
        )}
        {conservando && <div className="aviso-conflicto" role="status">{tr("No se pudo actualizar esta investigación. Se conserva la última vista recibida; los datos pueden estar desactualizados.")}</div>}
        {inv && ruta.tipo === 'investigacion' && <HiloDelProceso estado={estado} inv={inv} pantalla={ruta.pantalla} detalleId={ruta.detalleId} />}
        {aviso && (
          <div className={`aviso-conflicto ${aviso.tono === 'info' ? 'aviso-info' : ''}`} role={aviso.tono === 'info' ? 'status' : 'alert'}>
            <span>{aviso.texto}</span>
            <button type="button" className="btn btn-s" onClick={cerrarAvisoConflicto}>
              {tr("Entendido")}
            </button>
          </div>
        )}
        {/* OJO con `initial={false}` aquí: en AnimatePresence se hereda hacia
            abajo y hace que TODO motion.* del árbol salte su entrada al
            montarse. Estuvo así y ninguna fila de la línea de tiempo del chat,
            ningún menú ni ningún turno animaba al aparecer; se veía todo de
            golpe (Emir, 3 de octubre de 2026: «las cosas aparecen de
            repente»). Lo que se quería era que la PRIMERA página no hiciera
            fundido al cargar: eso va en el initial del motion.div de la
            página, que solo afecta a la página. */}
        <AnimatePresence mode="popLayout">
          <motion.div key={clavePagina} className="pagina" variants={pagina} initial={primeraPagina.current ? false : 'oculto'} animate="visible" exit="salida" onAnimationComplete={() => { primeraPagina.current = false; }}>
            <Limite clave={claveRuta} ambito={trp('la pantalla {pantalla}', { pantalla: titulo ?? ruta.tipo })}>{cuerpo}</Limite>
          </motion.div>
        </AnimatePresence>
      </main>
      <BusquedaGlobal estado={estado} investigacionId={inv?.id ?? null} abierta={buscando} onCerrar={() => setBuscando(false)} />
      <ToastDeshacer />
      <Recorrido abierto={recorrido} onCerrar={() => setRecorrido(false)} />
    </div>
  );
}
