// Raiz de ROSA2018: lee el estado del almacen y la ruta del hash, y monta la
// barra lateral, la cabecera y la pantalla que toque. La busqueda global se
// abre con Cmd+K o Ctrl+K. El titulo de la pestana lleva cuantas decisiones
// esperan, para verlo sin abrir la pestana.

import { AnimatePresence, motion } from 'motion/react';
import { Limite } from './componentes/Limite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cerrarAvisoConflicto, reintentarConexion, useAvisoConflicto, useRosa } from './datos/almacen';
import { BarraLateral } from './componentes/BarraLateral';
import { BusquedaGlobal } from './componentes/BusquedaGlobal';
import { Cabecera } from './componentes/Cabecera';
import { ToastDeshacer } from './componentes/Deshacer';
import { HiloDelProceso } from './componentes/HiloDelProceso';
import { Recorrido, recorridoVisto } from './componentes/Recorrido';
import { pagina } from './lib/movimiento';
import { loQueEspera } from './lib/digest';
import { useAhora } from './lib/useAhora';
import { useRuta } from './lib/useRuta';
import { Ajustes } from './pantallas/Ajustes';
import { Arbol } from './pantallas/Arbol';
import { Artefactos } from './pantallas/Artefactos';
import { Atlas } from './pantallas/Atlas';
import { Calidad } from './pantallas/Calidad';
import { Corrida } from './pantallas/Corrida';
import { Hipotesis } from './pantallas/Hipotesis';
import { Inicio } from './pantallas/Inicio';
import { Investigacion } from './pantallas/Investigacion';
import { ModeloDeMundo } from './pantallas/ModeloDeMundo';
import { NuevaInvestigacion } from './pantallas/NuevaInvestigacion';
import { Panorama } from './pantallas/Panorama';
import { Ranking } from './pantallas/Ranking';

const TITULO_PANTALLA = {
  corrida: 'Corrida en vivo',
  hipotesis: 'Cola de hipótesis',
  ranking: 'Ranking',
  panorama: 'Panorama',
  mundo: 'Modelo de mundo',
  arbol: 'Árbol de la investigación',
  atlas: 'Atlas de la enfermedad',
  artefactos: 'Artefactos',
  calidad: 'Calidad',
  investigacion: 'Objetivo y datos',
} as const;

export default function App() {
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
  // La transicion de pagina se dispara solo al cambiar de pantalla. Abrir un
  // detalle (una hipotesis en su cajon, un artefacto) es la misma pantalla:
  // si tambien cambiara la clave, la pagina entera se desmontaria y volveria
  // a montarse con fundido, y en tema oscuro eso se ve como un parpadeo negro
  // (mas largo cuanto mas ocupado este el navegador con el flujo de eventos).
  const clavePagina = ruta.tipo === 'investigacion' ? `${ruta.investigacionId}/${ruta.pantalla}` : ruta.tipo;
  useEffect(() => {
    setMenuAbierto(false);
    setBuscando(false);
    if (!(ruta.tipo === 'investigacion' && ruta.pantalla === 'hipotesis' && ruta.detalleId)) setCajonAbierto(false);
  }, [claveRuta, ruta]);

  useEffect(() => {
    const base = inv ? `${inv.titulo} · ROSA2018` : 'ROSA2018 · Alzheimer Project';
    document.title = esperan > 0 ? `(${esperan}) ${base}` : base;
  }, [inv, esperan]);

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

  let titulo = 'Investigaciones';
  let miga: string | null = null;
  let pantalla: JSX.Element;

  if (ruta.tipo === 'nueva') {
    titulo = 'Nueva investigación';
    pantalla = <NuevaInvestigacion estado={estado} irA={irA} />;
  } else if (ruta.tipo === 'ajustes') {
    titulo = 'Ajustes';
    pantalla = <Ajustes estado={estado} ahora={ahora} />;
  } else if (ruta.tipo === 'investigacion') {
    if (!inv) {
      titulo = 'Investigación';
      pantalla = (
        <div className="contenido">
          <div className="vacio">
            <h3>No se pudo cargar esta investigación</h3>
            <p role="status">Comprueba la conexión o vuelve a intentarlo. No se ha cambiado tu dirección de navegación.</p>
            <p>
              <a className="enlace" href="#/">
                Volver al inicio
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
          pantalla = <Hipotesis inv={inv} estado={estado} ahora={ahora} detalleId={ruta.detalleId} cajonAbierto={cajonAbierto} setCajonAbierto={setCajonAbierto} irA={irA} />;
          break;
        case 'ranking':
          pantalla = <Ranking inv={inv} estado={estado} />;
          break;
        case 'panorama':
          pantalla = <Panorama inv={inv} estado={estado} ahora={ahora} />;
          break;
        case 'mundo':
          pantalla = <ModeloDeMundo inv={inv} estado={estado} ahora={ahora} />;
          break;
        case 'arbol':
          pantalla = <Arbol key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'atlas':
          pantalla = <Atlas key={inv.id} inv={inv} estado={estado} />;
          break;
        case 'artefactos':
          pantalla = <Artefactos inv={inv} estado={estado} ahora={ahora} detalleId={ruta.detalleId} />;
          break;
        case 'calidad':
          pantalla = <Calidad inv={inv} estado={estado} ahora={ahora} />;
          break;
        case 'investigacion':
          pantalla = <Investigacion key={inv.id} inv={inv} estado={estado} ahora={ahora} irA={irA} />;
          break;
      }
    }
  } else {
    pantalla = <Inicio estado={estado} ahora={ahora} />;
  }

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
      <BarraLateral estado={estado} ruta={ruta} abierta={menuAbierto} onCerrar={() => setMenuAbierto(false)} onBuscar={() => setBuscando(true)} />
      <main className="principal">
        <Cabecera miga={miga} titulo={titulo} esperan={esperan} onMenu={() => setMenuAbierto(true)} onBuscar={() => setBuscando(true)} onAyuda={() => setRecorrido(true)} />
        {estado.conexion === 'sin_conexion' && (
          <div className="panel-sin-conexion" role="alert">
            <span>Sin conexión a internet</span>
            <button type="button" className="btn btn-s" disabled={reintentando} onClick={() => void reintentar()}>
              {reintentando ? 'Reintentando…' : 'Reintentar'}
            </button>
          </div>
        )}
        {conservando && <div className="aviso-conflicto" role="status">No se pudo actualizar esta investigación. Se conserva la última vista recibida; los datos pueden estar desactualizados.</div>}
        {inv && ruta.tipo === 'investigacion' && <HiloDelProceso estado={estado} inv={inv} pantalla={ruta.pantalla} detalleId={ruta.detalleId} />}
        {aviso && (
          <div className={`aviso-conflicto ${aviso.tono === 'info' ? 'aviso-info' : ''}`} role={aviso.tono === 'info' ? 'status' : 'alert'}>
            <span>{aviso.texto}</span>
            <button type="button" className="btn btn-s" onClick={cerrarAvisoConflicto}>
              Entendido
            </button>
          </div>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={clavePagina} className="pagina" variants={pagina} initial="oculto" animate="visible" exit="salida">
            <Limite clave={claveRuta} ambito={`la pantalla ${titulo ?? ruta.tipo}`}>{pantalla}</Limite>
          </motion.div>
        </AnimatePresence>
      </main>
      <BusquedaGlobal estado={estado} investigacionId={inv?.id ?? null} abierta={buscando} onCerrar={() => setBuscando(false)} />
      <ToastDeshacer />
      <Recorrido abierto={recorrido} onCerrar={() => setRecorrido(false)} />
    </div>
  );
}
