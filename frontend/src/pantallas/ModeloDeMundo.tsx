// El modelo de mundo, en tres vistas (1 de octubre de 2026):
//
// - Conversar: se le pregunta en lenguaje normal, como en un chat. Responde
//   con lo que ya sabe y, si hace falta, buscando en las publicaciones; cada
//   cosa lleva detrás de dónde sale (DOI, ensayo, PMID o el hecho del modelo
//   de mundo, que se abre). Las preguntas de un mismo hilo son una
//   conversación: el servidor le pasa al modelo los turnos anteriores.
// - Los hechos: lo que sabe hoy, ordenado por tema (las entidades canónicas
//   con nombre en castellano), con la ficha de cada hecho al lado: de dónde
//   sale, qué dicen las otras fuentes y con qué se relaciona.
// - Qué cambió: los movimientos desde la última visita, la cobertura de la
//   búsqueda, las relaciones causales y la recomprobación de retractaciones.
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado (cientos de hechos: temas, fuentes con su PMID,
// movimientos) se calcula DESPUÉS de pintar la silueta (useCalculoDiferido).
// Una actualización del canal en vivo no enseña esqueleto: se conserva lo
// calculado hasta que llega lo nuevo, un fotograma después.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { acciones } from "../datos/almacen";
import {
  preguntarAlModeloDeMundo,
  type CitaComprobable,
} from "../datos/acciones";
import type {
  Corrida,
  EstadoCobertura,
  EstadoRosa,
  Fuente,
  HechoMundo,
  Investigacion,
  MovimientoHecho,
  ParteCobertura,
  PreguntaABases,
} from "../datos/tipos";
import { AvisoMuestra, Chip, Momento, Seccion } from "../componentes/piezas";
import { Cargando, Esqueleto } from "../componentes/Esqueleto";
import {
  IconAlert,
  IconAlertCircle,
  IconArrowUp,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconCircleHalf,
  IconClock,
  IconCopy,
  IconExternal,
  IconLayers,
  IconMessage,
  IconMinusCircle,
  IconPen,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconX,
} from "../componentes/icons";
import { RelacionesCausales } from "../componentes/Rosa2018";
import { COBERTURA_MINIMA, faltanParaCobertura } from "../lib/cobertura";
import {
  atributosEnVuelo,
  useCalculoDiferido,
  useEnVuelo,
} from "../lib/diferido";
import {
  CLASIFICACION_CITA,
  ESTADO_HECHO,
  TIPO_HECHO,
  nombreActor,
} from "../lib/etiquetas";
import { formatearPorcentaje } from "../lib/formato";
import { tr, trp } from "../lib/idioma";
import { Herramientas } from "../componentes/Herramienta";
import { PasosDeBusqueda, pasosDeConsultas } from "../componentes/PasosDeBusqueda";
import { Shimmer } from "../componentes/Shimmer";
import {
  ESTADO_COBERTURA,
  SIN_TEMA,
  analizarTexto,
  cuentaEstado,
  cuentaHechos,
  cuentaPasos,
  esLineaDeFuente,
  filtrarHechos,
  fuentesDeConsultas,
  hiloDe,
  inicialFuente,
  nombreEntidad,
  nombreHerramienta,
  nuevoHilo,
  ordenHechos,
  rastro,
  recortar,
  recuentoDe,
  referenciasDe,
  resumenBusqueda,
  sugerencias,
  temasDeHechos,
  unirLista,
  veredictoAtribucion,
  type Bloque,
  type Estante,
  type FiltroHechos,
  type Recuento,
  type Sugerencia,
  type Temas,
  type Trozo,
  type Veredicto,
} from "../lib/mundo";

type Vista = "conversar" | "hechos" | "cambios";
const ESTADOS: HechoMundo["estado"][] = ["sabido", "abierto", "descartado"];

/** El estado en una palabra, para chips y píldoras (ESTADO_HECHO es la frase larga de los títulos). */
function estadoCorto(e: HechoMundo["estado"]): string {
  return e === "sabido"
    ? tr("Sabido")
    : e === "abierto"
      ? tr("Abierto")
      : tr("Descartado");
}

/** Lo que la pantalla deriva del estado para una investigación. Se calcula
 *  fuera del render (useCalculoDiferido): con cientos de hechos cuesta lo
 *  bastante como para congelar la pantalla si se hiciera antes de pintar. */
type BaseMundo = {
  invId: string;
  /** Las fuentes con su PMID y DOI, por id, para que cada cita se pueda comprobar fuera de ROSA2018. */
  fuentesPorId: Map<string, Fuente>;
  propios: HechoMundo[];
  porId: Map<string, HechoMundo>;
  temas: Temas;
  dudosos: Set<string>;
  recuento: Recuento;
  sugerencias: Sugerencia[];
  /** La última corrida, de donde salen las coberturas por tema. */
  corrida: Corrida | null;
  /** Movimientos entre estados desde la última visita, del más reciente al más viejo. */
  movimientos: { h: HechoMundo; m: MovimientoHecho }[];
  /** Cuántos hechos tienen alguna cita que los contrasta. */
  contrastados: number;
  /** Cuándo cambió algo por última vez. */
  actualizado: number;
};

function derivar(estado: EstadoRosa, invId: string): BaseMundo {
  const fuentesPorId = new Map<string, Fuente>();
  for (const h of estado.hipotesis)
    if (h.investigacionId === invId)
      for (const f of h.procedencia.fuentes)
        if (!fuentesPorId.has(f.id)) fuentesPorId.set(f.id, f);
  const propios = estado.hechos.filter((h) => h.investigacionId === invId);
  const porId = new Map(propios.map((h) => [h.id, h]));
  const temas = temasDeHechos(propios);
  const corrida =
    estado.corridas
      .filter((c) => c.investigacionId === invId)
      .sort((a, b) => b.numero - a.numero)[0] ?? null;
  const desde = estado.ultimaVisita;
  const movimientos = propios
    .flatMap((h) => h.historial.map((m) => ({ h, m })))
    .filter((x) => desde === null || x.m.fecha > desde)
    .sort((a, b) => b.m.fecha - a.m.fecha);
  const contrastados = propios.filter((h) =>
    h.citas.some((c) => c.clasificacion === "contrasta"),
  ).length;
  const actualizado = propios.reduce(
    (m, h) => Math.max(m, h.actualizadoEn || 0),
    0,
  );
  return {
    invId,
    fuentesPorId,
    propios,
    porId,
    temas,
    dudosos: new Set(temas.dudosos.map((d) => d.entidad.id)),
    recuento: recuentoDe(propios),
    sugerencias: sugerencias(propios, temas),
    corrida,
    movimientos,
    contrastados,
    actualizado,
  };
}

/* ---------------------------------------------------------------------
   La barra de arriba: las tres vistas
   --------------------------------------------------------------------- */

function BarraMundo({
  vista,
  setVista,
  total,
  movimientos,
  meta,
  onNueva,
  desactivada = false,
}: {
  vista: Vista;
  setVista?: (v: Vista) => void;
  total: number | null;
  movimientos: number;
  meta: ReactNode;
  onNueva?: () => void;
  desactivada?: boolean;
}) {
  const boton = (
    v: Vista,
    icono: ReactNode,
    texto: string,
    cuenta: ReactNode = null,
  ) => (
    <button
      type="button"
      role="tab"
      aria-selected={vista === v}
      className="mundo-vista"
      disabled={desactivada}
      onClick={() => setVista?.(v)}
    >
      {icono}
      <span>{texto}</span>
      {cuenta}
    </button>
  );
  return (
    <div className="mundo-barra" aria-hidden={desactivada || undefined}>
      <h2 className="sr-only">{tr("Modelo de mundo")}</h2>
      <div className="mundo-barra-meta">{meta}</div>
      <div className="mundo-vistas" role="tablist" aria-label={tr("Vista")}>
        {boton("conversar", <IconMessage size={15} />, tr("Conversar"))}
        {boton(
          "hechos",
          <IconLayers size={15} />,
          tr("Los hechos"),
          total !== null && <span className="mundo-vista-cuenta">{total}</span>,
        )}
        {boton(
          "cambios",
          <IconClock size={15} />,
          tr("Qué cambió"),
          movimientos > 0 && (
            <span className="mundo-vista-aviso">{movimientos}</span>
          ),
        )}
      </div>
      <div className="mundo-barra-acciones">
        <button
          type="button"
          className="btn btn-s mundo-nueva"
          disabled={desactivada}
          onClick={onNueva}
        >
          <IconPen size={14} />
          {tr("Nueva conversación")}
        </button>
      </div>
    </div>
  );
}

/** La silueta mientras se calcula: la barra real con los mandos
 *  deshabilitados (chrome fijo que mide lo mismo) y, debajo, la forma de la
 *  conversación vacía: el título, el compositor y las cuatro sugerencias. */
function SiluetaMundo({ vista }: { vista: Vista }) {
  const barra = (
    <BarraMundo
      vista={vista}
      total={null}
      movimientos={0}
      meta={<Esqueleto ancho={260} alto={12} />}
      desactivada
    />
  );
  if (vista === "hechos")
    return (
      <>
        {barra}
        <div className="mundo-hechos" aria-hidden="true">
          <div className="mundo-hechos-cabecera">
            <div className="mundo-hechos-total">
              <Esqueleto ancho={150} alto={11} />
              <Esqueleto ancho={260} alto={34} radio={8} />
            </div>
            <Esqueleto ancho={320} alto={40} radio={12} />
          </div>
          <Esqueleto ancho="100%" alto={10} radio={999} />
          <div className="mundo-estantes">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="mundo-estante mundo-estante-esqueleto"
                data-esqueleto="estante"
              >
                <Esqueleto ancho="60%" alto={14} />
                <Esqueleto ancho="40%" alto={10} />
                <Esqueleto ancho="100%" alto={4} radio={999} />
              </div>
            ))}
          </div>
          <div className="mundo-hechos-cuerpo">
            <div className="mundo-lista">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="mundo-fila mundo-fila-esqueleto"
                  data-esqueleto="hecho"
                >
                  <Esqueleto ancho="92%" alto={13} />
                  <Esqueleto ancho="55%" alto={13} />
                </div>
              ))}
            </div>
            <div className="mundo-detalle">
              <Esqueleto ancho="35%" alto={20} radio={999} />
              <Esqueleto ancho="100%" alto={16} />
              <Esqueleto ancho="80%" alto={16} />
            </div>
          </div>
        </div>
      </>
    );
  return (
    <>
      {barra}
      <div className="mundo-vacio" aria-hidden="true">
        <div className="mundo-vacio-cabeza">
          <Esqueleto
            ancho={420}
            alto={30}
            radio={8}
            className="mundo-esq-centro"
          />
          <Esqueleto ancho={520} alto={14} className="mundo-esq-centro" />
          <Esqueleto ancho={380} alto={14} className="mundo-esq-centro" />
        </div>
        <div className="mundo-compositor mundo-compositor-esqueleto">
          <Esqueleto ancho="60%" alto={14} />
          <div className="mundo-compositor-pie">
            <Esqueleto ancho={34} alto={34} radio={999} />
          </div>
        </div>
        <div className="mundo-sugerencias">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="mundo-sugerencia mundo-sugerencia-esqueleto"
              data-esqueleto="sugerencia"
            >
              <Esqueleto ancho="85%" alto={13} />
              <Esqueleto ancho="40%" alto={11} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function ModeloDeMundo({
  inv,
  estado,
  ahora,
  vistaInicial = null,
}: {
  inv: Investigacion;
  estado: EstadoRosa;
  ahora: number;
  vistaInicial?: string | null;
}) {
  const { valor: base } = useCalculoDiferido(
    () => derivar(estado, inv.id),
    [
      estado.hechos,
      estado.hipotesis,
      estado.corridas,
      estado.ultimaVisita,
      inv.id,
    ],
  );
  // Esqueleto solo al abrir y al cambiar de investigación. Con una actualización
  // del canal en vivo `base` es el cálculo anterior (misma investigación) y se
  // conserva en pantalla hasta que el nuevo llega, un fotograma después.
  const esperando = base === null || base.invId !== inv.id;
  return (
    <div className="contenido contenido-ancho contenido-mundo">
      <AvisoMuestra conexion={estado.conexion} />
      <Cargando
        activo={esperando}
        rotulo={tr("el modelo de mundo")}
        esqueleto={
          <SiluetaMundo
            vista={vistaInicial === "hechos" ? "hechos" : "conversar"}
          />
        }
      >
        {base !== null && (
          <CuerpoMundo
            inv={inv}
            estado={estado}
            ahora={ahora}
            base={base}
            vistaInicial={vistaInicial}
          />
        )}
      </Cargando>
    </div>
  );
}

/* ---------------------------------------------------------------------
   El cuerpo: el estado de las tres vistas vive aquí
   --------------------------------------------------------------------- */

type ModoPregunta = "bases" | "local";
type TurnoLocal = {
  id: string;
  hilo: string;
  fecha: number;
  pregunta: string;
  resultado: { nodos: HechoMundo[]; citas: CitaComprobable[] };
};
type ErrorLocal = {
  id: string;
  hilo: string;
  fecha: number;
  pregunta: string;
  error: string;
};
type Pendiente = {
  hilo: string;
  pregunta: string;
  desde: number;
  listo: boolean;
};

const FILTRO_VACIO: FiltroHechos = {
  texto: "",
  estado: "todos",
  origen: "todos",
  tema: null,
};
const claveHilo = (invId: string) => `rosa.mundo.hilo.${invId}`;

function leerHilo(invId: string): string | null {
  try {
    const h = sessionStorage.getItem(claveHilo(invId));
    return h && /^[a-zA-Z0-9-]{1,40}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

/** Una respuesta guardada que corresponde a la pregunta en vuelo: mismo hilo,
 *  mismo texto y de después de enviarla (con margen por relojes desfasados). */
const esLaPendiente = (
  q: PreguntaABases,
  p: { hilo: string; pregunta: string; desde: number },
) =>
  hiloDe(q) === p.hilo &&
  (q.pregunta ?? "").trim() === p.pregunta &&
  q.fecha >= p.desde - 5000;

function CuerpoMundo({
  inv,
  estado,
  ahora,
  base,
  vistaInicial,
}: {
  inv: Investigacion;
  estado: EstadoRosa;
  ahora: number;
  base: BaseMundo;
  vistaInicial: string | null;
}) {
  const [vista, setVista] = useState<Vista>(
    vistaInicial === "hechos" || vistaInicial === "cambios"
      ? vistaInicial
      : "conversar",
  );
  const [filtro, setFiltro] = useState<FiltroHechos>(FILTRO_VACIO);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [hilo, setHilo] = useState<string | null>(() => leerHilo(inv.id));
  const [texto, setTexto] = useState("");
  // Sin selector: con conexión pregunta al modelo de mundo y a las
  // publicaciones; sin ella responde al momento con lo que ya sabe.
  const modo: ModoPregunta = estado.conexion === "en_linea" ? "bases" : "local";
  const [locales, setLocales] = useState<TurnoLocal[]>([]);
  const [errores, setErrores] = useState<ErrorLocal[]>([]);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [, envolver] = useEnVuelo();
  const entrada = useRef<HTMLTextAreaElement>(null);
  const guardadas = inv.preguntasABases ?? [];

  const fijarHilo = (h: string | null) => {
    setHilo(h);
    try {
      if (h) sessionStorage.setItem(claveHilo(inv.id), h);
      else sessionStorage.removeItem(claveHilo(inv.id));
    } catch {
      // Sin sessionStorage (modo privado estricto) la conversación vive solo en memoria.
    }
  };

  // La respuesta llega por el canal en vivo: cuando aparece guardada, la pregunta deja de estar en vuelo.
  useEffect(() => {
    if (pendiente && guardadas.some((q) => esLaPendiente(q, pendiente)))
      setPendiente(null);
  }, [guardadas, pendiente]);

  const enfocar = (prefijo?: string) => {
    if (prefijo !== undefined) setTexto(prefijo);
    setVista("conversar");
    requestAnimationFrame(() => {
      const t = entrada.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    });
  };

  const enviar = (bruta: string, modoEnvio: ModoPregunta = modo) => {
    const pregunta = bruta.trim();
    if (pregunta === "" || pendiente) return;
    const h = hilo ?? nuevoHilo();
    if (h !== hilo) fijarHilo(h);
    setTexto("");
    setVista("conversar");
    const fecha = Date.now();
    if (modoEnvio === "local") {
      const r = preguntarAlModeloDeMundo(
        base.propios,
        inv.id,
        pregunta,
        base.fuentesPorId,
      );
      setLocales((ls) => [
        ...ls,
        {
          id: `local-${fecha}`,
          hilo: h,
          fecha,
          pregunta,
          resultado: { nodos: r.nodos, citas: r.citas },
        },
      ]);
      return;
    }
    setPendiente({ hilo: h, pregunta, desde: fecha, listo: false });
    void envolver(async () => {
      const error = await acciones.preguntarALasBases(inv.id, pregunta, h);
      if (error) {
        setPendiente((p) => (p && p.desde === fecha ? null : p));
        setErrores((es) => [
          ...es,
          { id: `error-${fecha}`, hilo: h, fecha, pregunta, error },
        ]);
      } else {
        setPendiente((p) =>
          p && p.desde === fecha ? { ...p, listo: true } : p,
        );
      }
    })();
  };

  const abrirHecho = (id: string) => {
    setFiltro(FILTRO_VACIO);
    setSeleccion(id);
    setVista("hechos");
    window.scrollTo?.({ top: 0 });
  };

  const nueva = () => {
    fijarHilo(null);
    setTexto("");
    enfocar();
  };

  const { recuento, propios } = base;
  const meta =
    vista === "conversar" ? (
      <>
        <strong>{cuentaHechos(propios.length)}</strong>
        {ESTADOS.map((e) => (
          <span key={e}>
            <i className={`mundo-punto mundo-punto-${e}`} aria-hidden="true" />
            {cuentaEstado(e, recuento[e])}
          </span>
        ))}
      </>
    ) : (
      <>
        {base.actualizado > 0 && (
          <span>
            {tr("Actualizado")}{" "}
            <Momento t={base.actualizado} ahora={ahora} soloRelativo />
          </span>
        )}
        {base.corrida && (
          <span>{trp("corrida {n}", { n: base.corrida.numero })}</span>
        )}
      </>
    );

  return (
    <>
      <BarraMundo
        vista={vista}
        setVista={setVista}
        total={propios.length}
        movimientos={base.movimientos.length}
        meta={meta}
        onNueva={nueva}
      />
      {vista === "conversar" && (
        <Conversar
          inv={inv}
          ahora={ahora}
          base={base}
          hilo={hilo}
          guardadas={guardadas}
          locales={locales}
          errores={errores}
          pendiente={pendiente}
          texto={texto}
          setTexto={setTexto}
          modo={modo}
          entrada={entrada}
          enviar={enviar}
          reintentar={(e) => {
            setErrores((es) => es.filter((x) => x.id !== e.id));
            enviar(e.pregunta, "bases");
          }}
          abrirHecho={abrirHecho}
          enfocar={() => enfocar()}
        />
      )}
      {vista === "hechos" && (
        <LosHechos
          base={base}
          ahora={ahora}
          filtro={filtro}
          setFiltro={setFiltro}
          seleccion={seleccion}
          setSeleccion={setSeleccion}
          preguntar={(p) => enfocar(p)}
        />
      )}
      {vista === "cambios" && (
        <QueCambio
          inv={inv}
          estado={estado}
          ahora={ahora}
          base={base}
          abrirHecho={abrirHecho}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------
   Conversar
   --------------------------------------------------------------------- */

type PropsConversar = {
  inv: Investigacion;
  ahora: number;
  base: BaseMundo;
  hilo: string | null;
  guardadas: PreguntaABases[];
  locales: TurnoLocal[];
  errores: ErrorLocal[];
  pendiente: Pendiente | null;
  texto: string;
  setTexto: (t: string) => void;
  modo: ModoPregunta;
  entrada: React.RefObject<HTMLTextAreaElement>;
  enviar: (pregunta: string, modo?: ModoPregunta) => void;
  reintentar: (e: ErrorLocal) => void;
  abrirHecho: (id: string) => void;
  enfocar: () => void;
};

type Turno =
  | { tipo: "guardada"; fecha: number; q: PreguntaABases }
  | { tipo: "local"; fecha: number; t: TurnoLocal }
  | { tipo: "error"; fecha: number; e: ErrorLocal };

function Conversar(p: PropsConversar) {
  const { hilo, guardadas, locales, errores, pendiente, base, ahora } = p;
  const delHilo = hilo ? guardadas.filter((q) => q && hiloDe(q) === hilo) : [];
  const turnos: Turno[] = [
    ...delHilo.map((q) => ({ tipo: "guardada" as const, fecha: q.fecha, q })),
    ...locales
      .filter((t) => t.hilo === hilo)
      .map((t) => ({ tipo: "local" as const, fecha: t.fecha, t })),
    // Si el servidor guardó el intento fallido, se enseña el guardado y no se repite.
    ...errores
      .filter(
        (e) =>
          e.hilo === hilo &&
          !delHilo.some((q) =>
            esLaPendiente(q, {
              hilo: e.hilo,
              pregunta: e.pregunta,
              desde: e.fecha,
            }),
          ),
      )
      .map((e) => ({ tipo: "error" as const, fecha: e.fecha, e })),
  ].sort((a, b) => a.fecha - b.fecha);
  const final = useRef<HTMLDivElement>(null);
  const cuantos = turnos.length + (pendiente ? 1 : 0);
  useEffect(() => {
    if (cuantos > 0)
      final.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [cuantos]);

  if (turnos.length === 0 && !pendiente) {
    return (
      <div className="mundo-vacio">
        <div className="mundo-vacio-cabeza">
          <h3 className="mundo-vacio-titulo">
            {tr("¿Qué quieres saber de tu investigación?")}
          </h3>
          <p className="mundo-vacio-sub">
            {tr(
              "Pregunta en lenguaje normal. ROSA2018 responde con lo que ya sabe y, si hace falta, busca en las publicaciones. Siempre te dice de dónde sale cada cosa.",
            )}
          </p>
        </div>
        <Compositor {...p} grande />
        {base.sugerencias.length > 0 && (
          <div className="mundo-sugerencias">
            {base.sugerencias.map((s) => (
              <button
                key={s.pregunta}
                type="button"
                className="mundo-sugerencia"
                onClick={() => p.enviar(s.pregunta)}
              >
                <span className="mundo-sugerencia-texto">{s.pregunta}</span>
                <span className="mundo-sugerencia-nota">{s.nota}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mundo-chat">
      <ol className="mundo-turnos">
        {turnos.map((t) => (
          <li
            key={
              t.tipo === "guardada"
                ? t.q.id
                : t.tipo === "local"
                  ? t.t.id
                  : t.e.id
            }
            className="mundo-turno"
          >
            {t.tipo === "guardada" && (
              <TurnoGuardado
                q={t.q}
                ahora={ahora}
                base={base}
                abrirHecho={p.abrirHecho}
                enfocar={p.enfocar}
                reintentar={() => p.enviar(t.q.pregunta, "bases")}
                ocupado={pendiente !== null}
              />
            )}
            {t.tipo === "local" && (
              <TurnoSoloLoQueSabe
                t={t.t}
                base={base}
                abrirHecho={p.abrirHecho}
                buscarFuera={
                  p.modo === "bases"
                    ? () => p.enviar(t.t.pregunta, "bases")
                    : undefined
                }
                ocupado={pendiente !== null}
              />
            )}
            {t.tipo === "error" && (
              <>
                <BurbujaPregunta texto={t.e.pregunta} />
                <div className="mundo-respuesta">
                  <CabezaRespuesta />
                  <div className="mundo-error" role="alert">
                    <IconAlert size={15} />
                    <span>{t.e.error}</span>
                  </div>
                  <div className="mundo-respuesta-acciones">
                    <button
                      type="button"
                      className="mundo-accion"
                      disabled={pendiente !== null}
                      onClick={() => p.reintentar(t.e)}
                    >
                      <IconRefresh size={13} />
                      {tr("Volver a intentar")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </li>
        ))}
        {pendiente && (
          <li className="mundo-turno">
            <TurnoPendiente
              p={pendiente}
              base={base}
              abrirHecho={p.abrirHecho}
            />
          </li>
        )}
      </ol>
      <div ref={final} />
      <div className="mundo-chat-pie">
        <Compositor {...p} />
      </div>
    </div>
  );
}

function Compositor({
  texto,
  setTexto,
  modo,
  entrada,
  enviar,
  pendiente,
  base,
  grande = false,
}: PropsConversar & { grande?: boolean }) {
  // La caja crece con el texto hasta un tope; después aparece la barra de desplazamiento.
  useEffect(() => {
    const t = entrada.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
  }, [texto, entrada]);
  const vacio = texto.trim() === "";
  const n = base.propios.length;
  return (
    <form
      className={`mundo-compositor${grande ? " mundo-compositor-grande" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        enviar(texto);
      }}
    >
      <textarea
        ref={entrada}
        className="mundo-compositor-texto"
        rows={grande ? 2 : 1}
        value={texto}
        placeholder={
          modo === "bases"
            ? tr(
                "Pregunta lo que quieras: qué se sabe, qué falta, dónde chocan las fuentes...",
              )
            : tr("Busca entre lo que ya sabe...")
        }
        aria-label={tr("Pregunta al modelo de mundo")}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            enviar(texto);
          }
        }}
      />
      <div className="mundo-compositor-pie">
        <p className="mundo-compositor-nota">
          {modo === "bases"
            ? trp(
                "Responde con los {n} hechos del modelo de mundo y, si hace falta, con bases públicas. Lo que no encuentra, lo dice.",
                { n },
              )
            : trp(
                "Busca solo entre los {n} hechos del modelo de mundo, al instante y sin salir fuera. Esta respuesta no se guarda.",
                { n },
              )}
        </p>
        <button
          type="submit"
          className="mundo-enviar"
          disabled={vacio || pendiente !== null}
          aria-label={tr("Enviar")}
          title={tr("Enviar (Intro). Mayúsculas + Intro para una línea nueva.")}
          {...atributosEnVuelo(pendiente !== null)}
        >
          <IconArrowUp size={17} />
        </button>
      </div>
    </form>
  );
}

function BurbujaPregunta({ texto }: { texto: string }) {
  return (
    <div className="mundo-pregunta">
      <p>{texto}</p>
    </div>
  );
}

/** La marca de la app al lado de cada respuesta: quién habla, sin rótulo. */
function CabezaRespuesta({ children }: { children?: ReactNode }) {
  return (
    <div className="mundo-respuesta-cabeza">
      <img
        className="mundo-marca"
        src="/arbol-marca.png"
        alt="ROSA2018"
        width={24}
        height={24}
      />
      {children}
    </div>
  );
}

const FUENTES_VISIBLES = 3;

/** «3 búsquedas | 7 documentos | 19 s» y las pastillas de las fuentes. Abre
 *  la tabla de consultas. */
function ResumenDeBusqueda({
  q,
  abierto,
  alternar,
}: {
  q: PreguntaABases;
  abierto: boolean;
  alternar?: () => void;
}) {
  const r = resumenBusqueda(q);
  const partes = [
    trp(r.busquedas === 1 ? "{n} búsqueda" : "{n} búsquedas", {
      n: r.busquedas,
    }),
    ...(r.documentos > 0
      ? [
          trp(r.documentos === 1 ? "{n} documento" : "{n} documentos", {
            n: r.documentos,
          }),
        ]
      : []),
    ...(r.segundos !== null ? [trp("{n} s", { n: r.segundos })] : []),
  ];
  const visibles = r.fuentes.slice(0, FUENTES_VISIBLES);
  const tonos = tonosDistintos(visibles);
  const resto = r.fuentes.length - visibles.length;
  const contenido = (
    <>
      <IconSearch size={13} />
      {partes.map((t, i) => (
        <span key={i} className="mundo-busqueda-dato">
          {t}
        </span>
      ))}
      {r.fuentes.length > 0 && (
        <span
          className="mundo-fuentes"
          title={r.fuentes.join(", ")}
          aria-label={trp("Fuentes: {lista}", { lista: r.fuentes.join(", ") })}
        >
          {visibles.map((f, i) => (
            <i
              key={f}
              className={`mundo-fuente mundo-fuente-${tonos[i]}`}
              aria-hidden="true"
              style={{ zIndex: FUENTES_VISIBLES - i }}
            >
              {inicialFuente(f)}
            </i>
          ))}
          {resto > 0 && (
            <i className="mundo-fuente mundo-fuente-resto" aria-hidden="true">
              +{resto}
            </i>
          )}
        </span>
      )}
      {alternar && (
        <IconChevronDown
          size={13}
          style={{ transform: abierto ? "rotate(180deg)" : "none" }}
        />
      )}
    </>
  );
  return alternar ? (
    <button
      type="button"
      className="mundo-busqueda"
      aria-expanded={abierto}
      title={tr("Ver qué consultó")}
      onClick={alternar}
    >
      {contenido}
    </button>
  ) : (
    <span className="mundo-busqueda mundo-busqueda-fija">{contenido}</span>
  );
}

/** Un tono fijo por fuente, para que PubMed sea siempre del mismo color. */
function tonoFuente(f: string): number {
  let h = 0;
  for (const ch of f) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TONOS_FUENTE;
}

const TONOS_FUENTE = 5;

/** Los tonos de las fuentes visibles: el suyo, salvo que ya lo use otra de
 *  la misma fila, y entonces el siguiente libre (dos círculos iguales no se
 *  distinguen). */
function tonosDistintos(fuentes: string[]): number[] {
  const usados = new Set<number>();
  return fuentes.map((f) => {
    let t = tonoFuente(f);
    while (usados.has(t) && usados.size < TONOS_FUENTE)
      t = (t + 1) % TONOS_FUENTE;
    usados.add(t);
    return t;
  });
}

const ICONO_COBERTURA: Record<EstadoCobertura, ReactNode> = {
  respondido: <IconCheckCircle size={15} />,
  en_parte: <IconCircleHalf size={15} />,
  no_esta: <IconMinusCircle size={15} />,
  no_pude_comprobar: <IconAlertCircle size={15} />,
};

/** Qué partes de la pregunta quedaron respondidas y cuáles no. */
function CoberturaPregunta({ partes }: { partes: ParteCobertura[] }) {
  return (
    <section
      className="mundo-cobertura"
      aria-label={tr("Cobertura de la pregunta")}
    >
      <h4 className="mundo-cobertura-titulo">
        {tr("Cobertura de la pregunta")}
      </h4>
      <ul>
        {partes.map((p, i) => (
          <li key={i} className={`mundo-cobertura-parte mundo-cob-${p.estado}`}>
            <span className="mundo-cobertura-icono" aria-hidden="true">
              {ICONO_COBERTURA[p.estado] ?? ICONO_COBERTURA.no_esta}
            </span>
            <div>
              <p>{p.parte}</p>
              <span className="mundo-cobertura-estado">
                {tr(ESTADO_COBERTURA[p.estado] ?? ESTADO_COBERTURA.no_esta)}
                {p.nota && (
                  <span className="mundo-cobertura-nota"> · {p.nota}</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El pie: si las referencias que cita salen de lo que devolvieron las búsquedas. */
function PieAtribucion({ v }: { v: Veredicto }) {
  return (
    <div className={`mundo-atribucion mundo-atribucion-${v.tono}`}>
      {v.tono === "aviso" ? (
        <IconAlert size={13} />
      ) : (
        <IconShieldCheck size={13} />
      )}
      <span>
        {v.texto}
        {v.sinRespaldo.length > 0 && (
          <span className="mundo-atribucion-lista">
            {" "}
            {v.sinRespaldo.map((r) => (
              <code key={r} className="mundo-codigo">
                {r}
              </code>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="mundo-accion"
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1600);
        });
      }}
    >
      {copiado ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {copiado ? tr("Copiado") : tr("Copiar")}
    </button>
  );
}

type Contexto = {
  fuentes: Map<string, string>;
  porId: Map<string, HechoMundo>;
  abrirHecho: (id: string) => void;
};

function Trozos({ ts, c }: { ts: Trozo[]; c: Contexto }) {
  return (
    <>
      {ts.map((t, i) => {
        switch (t.tipo) {
          case "texto":
            return <span key={i}>{t.texto}</span>;
          case "negrita":
            return (
              <strong key={i}>
                <Trozos ts={t.trozos} c={c} />
              </strong>
            );
          case "cursiva":
            return (
              <em key={i}>
                <Trozos ts={t.trozos} c={c} />
              </em>
            );
          case "codigo":
            return (
              <code key={i} className="mundo-codigo">
                {t.texto}
              </code>
            );
          case "doi":
            return (
              <a
                key={i}
                className="mundo-ref"
                href={`https://doi.org/${t.doi}`}
                target="_blank"
                rel="noreferrer"
                title={tr(
                  "Abre el artículo por su DOI: comprobable fuera de ROSA2018.",
                )}
              >
                doi:{t.doi}
                <IconExternal size={10} />
              </a>
            );
          case "ensayo":
            return (
              <a
                key={i}
                className="mundo-ref"
                href={`https://clinicaltrials.gov/study/${t.nct}`}
                target="_blank"
                rel="noreferrer"
                title={tr("Abre el registro del ensayo en ClinicalTrials.gov.")}
              >
                {t.nct}
                <IconExternal size={10} />
              </a>
            );
          case "pmid":
            return (
              <a
                key={i}
                className="mundo-ref"
                href={`https://pubmed.ncbi.nlm.nih.gov/${t.pmid}/`}
                target="_blank"
                rel="noreferrer"
                title={tr("Abre el artículo en PubMed.")}
              >
                PMID {t.pmid}
                <IconExternal size={10} />
              </a>
            );
          case "hecho": {
            const h = c.porId.get(t.id);
            if (!h)
              return (
                <code
                  key={i}
                  className="mundo-codigo"
                  title={tr("Un hecho que ya no está en el modelo de mundo")}
                >
                  {t.id}
                </code>
              );
            return (
              <button
                key={i}
                type="button"
                className={`mundo-ref mundo-ref-hecho mundo-ref-${h.estado}`}
                title={h.enunciado}
                onClick={() => c.abrirHecho(h.id)}
              >
                <IconLayers size={11} />
                {trp("hecho {estado}", {
                  estado: estadoCorto(h.estado).toLowerCase(),
                })}
              </button>
            );
          }
          case "herramienta":
            return (
              <span key={i} className="mundo-herramienta">
                {nombreHerramienta(t.nombre, c.fuentes) ??
                  t.nombre.replace(/_/g, " ")}
              </span>
            );
        }
      })}
    </>
  );
}

function Lineas({ lineas, c }: { lineas: Trozo[][]; c: Contexto }) {
  return (
    <>
      {lineas.map((l, i) =>
        esLineaDeFuente(l) ? (
          <span key={i} className="mundo-linea-fuente">
            <Trozos ts={l} c={c} />
          </span>
        ) : (
          <span key={i} className="mundo-linea">
            <Trozos ts={l} c={c} />
          </span>
        ),
      )}
    </>
  );
}

function TextoRico({ bloques, c }: { bloques: Bloque[]; c: Contexto }) {
  return (
    <div className="mundo-texto">
      {bloques.map((b, i) => {
        if (b.tipo === "titulo")
          return (
            <h4 key={i} className="mundo-texto-titulo">
              <Trozos ts={b.trozos} c={c} />
            </h4>
          );
        if (b.tipo === "parrafo")
          return (
            <p key={i}>
              <Lineas lineas={b.lineas} c={c} />
            </p>
          );
        const Lista = b.ordenada ? "ol" : "ul";
        return (
          <Lista key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Lineas lineas={it.lineas} c={c} />
              </li>
            ))}
          </Lista>
        );
      })}
    </div>
  );
}

/** Los hechos del modelo de mundo que nombra la respuesta, para abrirlos. */
function HechosCitados({
  hechos,
  abrirHecho,
}: {
  hechos: HechoMundo[];
  abrirHecho: (id: string) => void;
}) {
  if (hechos.length === 0) return null;
  return (
    <div className="mundo-citados">
      {hechos.map((h) => (
        <div key={h.id} className={`mundo-citado mundo-citado-${h.estado}`}>
          <span className="mundo-citado-ceja">
            <IconLayers size={12} />
            {tr("Del modelo de mundo")} · {estadoCorto(h.estado)}
          </span>
          <p>{recortar(h.enunciado, 220)}</p>
          <button
            type="button"
            className="mundo-accion"
            onClick={() => abrirHecho(h.id)}
          >
            {tr("Ver el hecho")}
          </button>
        </div>
      ))}
    </div>
  );
}

function TurnoGuardado({
  q,
  ahora,
  base,
  abrirHecho,
  enfocar,
  reintentar,
  ocupado,
}: {
  q: PreguntaABases;
  ahora: number;
  base: BaseMundo;
  abrirHecho: (id: string) => void;
  enfocar: () => void;
  reintentar: () => void;
  ocupado: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const fuentes = fuentesDeConsultas(q);
  const herramientas = new Set([...(q.herramientas ?? []), ...fuentes.keys()]);
  const bloques = analizarTexto(q.respuesta ?? "", herramientas);
  const limites = analizarTexto(q.limites ?? "", herramientas);
  const refs = referenciasDe(bloques);
  const citados = refs.hechos
    .map((id) => base.porId.get(id))
    .filter((h): h is HechoMundo => !!h)
    .slice(0, 4);
  const comprobables =
    refs.dois.length + refs.ensayos.length + refs.pmids.length;
  const pasos = rastro(q);
  const cobertura = Array.isArray(q.cobertura) ? q.cobertura : [];
  const veredicto = q.error ? null : veredictoAtribucion(q);
  const c: Contexto = { fuentes, porId: base.porId, abrirHecho };
  return (
    <>
      <BurbujaPregunta texto={q.pregunta} />
      <div className="mundo-respuesta">
        <CabezaRespuesta>
          {(pasos.length > 0 || (q.consultas ?? []).length > 0) && (
            <ResumenDeBusqueda
              q={q}
              abierto={abierto}
              alternar={() => setAbierto((v) => !v)}
            />
          )}
        </CabezaRespuesta>
        {abierto && (
          <div className="mundo-rastro-detalle">
            {pasos.length > 0 && (
              <p className="mundo-rastro-frase">
                {cuentaPasos(Math.max(1, q.iteraciones || 0))} ·{" "}
                {unirLista(pasos)}
              </p>
            )}
            {(q.consultas ?? []).length > 0 ? (
              <>
                <PasosDeBusqueda pasos={pasosDeConsultas(q.consultas)} />
                <Herramientas consultas={q.consultas} ahora={ahora} />
              </>
            ) : (
              <p className="meta">
                {tr("No quedaron consultas registradas para esta respuesta.")}
              </p>
            )}
          </div>
        )}
        {q.error ? (
          <>
            <div className="mundo-error" role="alert">
              <IconAlert size={15} />
              <span>{q.error}</span>
            </div>
            <div className="mundo-respuesta-acciones">
              <button
                type="button"
                className="mundo-accion"
                disabled={ocupado}
                onClick={reintentar}
              >
                <IconRefresh size={13} />
                {tr("Volver a intentar")}
              </button>
            </div>
          </>
        ) : (
          <>
            <TextoRico bloques={bloques} c={c} />
            <HechosCitados hechos={citados} abrirHecho={abrirHecho} />
            {cobertura.length > 0 && <CoberturaPregunta partes={cobertura} />}
            {cobertura.length === 0 && limites.length > 0 && (
              <aside className="mundo-limites">
                <span className="mundo-limites-titulo">
                  <IconAlert size={13} />
                  {tr("Lo que no pudo comprobar")}
                </span>
                <TextoRico bloques={limites} c={c} />
              </aside>
            )}
            {veredicto && <PieAtribucion v={veredicto} />}
            <div className="mundo-respuesta-acciones">
              <BotonCopiar
                texto={[
                  q.respuesta,
                  q.limites
                    ? `\n${tr("Lo que no pudo comprobar")}:\n${q.limites}`
                    : "",
                ].join("")}
              />
              <button type="button" className="mundo-accion" onClick={enfocar}>
                <IconMessage size={13} />
                {tr("Seguir preguntando")}
              </button>
              {!veredicto && comprobables > 0 && (
                <span className="mundo-accion-meta">
                  {trp(
                    comprobables === 1
                      ? "{n} referencia comprobable"
                      : "{n} referencias comprobables",
                    { n: comprobables },
                  )}
                </span>
              )}
              <span className="mundo-accion-meta mundo-respuesta-cuando">
                <Momento t={q.fecha} ahora={ahora} soloRelativo />
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Lista corta de hechos, agrupados por estado, que se abren en «Los hechos». */
function HechosEncontrados({
  hechos,
  abrirHecho,
}: {
  hechos: HechoMundo[];
  abrirHecho: (id: string) => void;
}) {
  return (
    <ul className="mundo-encontrados">
      {ESTADOS.flatMap((e) =>
        hechos
          .filter((h) => h.estado === e)
          .map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => abrirHecho(h.id)}>
                <i
                  className={`mundo-punto mundo-punto-${h.estado}`}
                  aria-hidden="true"
                />
                <span className="mundo-encontrado-texto">
                  {recortar(h.enunciado, 200)}
                </span>
                <span className="mundo-encontrado-estado">
                  {estadoCorto(h.estado)}
                </span>
              </button>
            </li>
          )),
      )}
    </ul>
  );
}

function TurnoSoloLoQueSabe({
  t,
  base,
  abrirHecho,
  buscarFuera,
  ocupado,
}: {
  t: TurnoLocal;
  base: BaseMundo;
  abrirHecho: (id: string) => void;
  buscarFuera?: () => void;
  ocupado: boolean;
}) {
  const { nodos, citas } = t.resultado;
  return (
    <>
      <BurbujaPregunta texto={t.pregunta} />
      <div className="mundo-respuesta">
        <CabezaRespuesta>
          <span className="mundo-rastro mundo-rastro-fijo">
            {tr("Solo lo que ya sabe · no se guarda")}
          </span>
        </CabezaRespuesta>
        {nodos.length === 0 ? (
          <div className="mundo-texto">
            <p>
              {trp(
                "Entre los {n} hechos del modelo de mundo no hay nada sobre eso. No lo invento.",
                { n: base.propios.length },
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="mundo-texto">
              <p>
                {trp(
                  nodos.length === 1
                    ? "Esto es lo que ya sabe sobre eso, sin buscar fuera ({n} hecho):"
                    : "Esto es lo que ya sabe sobre eso, sin buscar fuera ({n} hechos):",
                  { n: nodos.length },
                )}
              </p>
            </div>
            <HechosEncontrados hechos={nodos} abrirHecho={abrirHecho} />
            {citas.length > 0 && (
              <ul
                className="mundo-citas-locales"
                aria-label={tr("Fuentes citadas")}
              >
                {citas.map((c) => (
                  <li key={c.fuenteId}>
                    <strong>{c.referencia}</strong>
                    {c.titulo && <span> {recortar(c.titulo, 110)}</span>}
                    {c.pmid && (
                      <a
                        className="mundo-ref"
                        href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PMID {c.pmid}
                        <IconExternal size={10} />
                      </a>
                    )}
                    {c.doi && (
                      <a
                        className="mundo-ref"
                        href={`https://doi.org/${c.doi}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        doi:{c.doi}
                        <IconExternal size={10} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {buscarFuera && (
          <div className="mundo-respuesta-acciones">
            <button
              type="button"
              className="mundo-accion"
              disabled={ocupado}
              onClick={buscarFuera}
            >
              <IconSearch size={13} />
              {tr("Buscar también en las publicaciones")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function TurnoPendiente({
  p,
  base,
  abrirHecho,
}: {
  p: Pendiente;
  base: BaseMundo;
  abrirHecho: (id: string) => void;
}) {
  const [, setTic] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTic((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const segundos = Math.max(0, Math.round((Date.now() - p.desde) / 1000));
  const [mientras] = useState(
    () =>
      preguntarAlModeloDeMundo(
        base.propios,
        base.invId,
        p.pregunta,
        base.fuentesPorId,
      ).nodos,
  );
  return (
    <>
      <BurbujaPregunta texto={p.pregunta} />
      <div className="mundo-respuesta" aria-live="polite">
        <CabezaRespuesta>
          <div className="mundo-pensando" role="status">
            <span className="mundo-pensando-puntos" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <Shimmer>
              {p.listo
                ? tr("Respuesta lista. Llegando...")
                : tr("Consultando el modelo de mundo y las publicaciones...")}
            </Shimmer>
            <span className="mundo-pensando-tiempo">
              {trp("{n} s", { n: segundos })}
            </span>
          </div>
        </CabezaRespuesta>
        {mientras.length > 0 && (
          <div className="mundo-mientras">
            <span className="mundo-ceja">
              {trp("Mientras tanto, lo que ya sabe · {n}", {
                n: mientras.length,
              })}
            </span>
            <HechosEncontrados hechos={mientras} abrirHecho={abrirHecho} />
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------
   Los hechos
   --------------------------------------------------------------------- */

const ESTANTES_VISIBLES = 12;
const TANDA = 30;

function BarraDeEstados({ r, alto = 8 }: { r: Recuento; alto?: number }) {
  const total = r.sabido + r.abierto + r.descartado;
  return (
    <span
      className="mundo-barra-estados"
      style={{ height: alto }}
      aria-hidden="true"
    >
      {total > 0 &&
        ESTADOS.map(
          (e) =>
            r[e] > 0 && (
              <i
                key={e}
                className={`mundo-seg-${e}`}
                style={{ width: `${(r[e] / total) * 100}%` }}
              />
            ),
        )}
    </span>
  );
}

function LosHechos({
  base,
  ahora,
  filtro,
  setFiltro,
  seleccion,
  setSeleccion,
  preguntar,
}: {
  base: BaseMundo;
  ahora: number;
  filtro: FiltroHechos;
  setFiltro: (f: FiltroHechos) => void;
  seleccion: string | null;
  setSeleccion: (id: string | null) => void;
  preguntar: (prefijo: string) => void;
}) {
  const [todosLosTemas, setTodosLosTemas] = useState(false);
  const [cuantos, setCuantos] = useState<
    Partial<Record<HechoMundo["estado"], number>>
  >({});
  const { propios, temas, recuento, porId } = base;
  const fijar = (cambio: Partial<FiltroHechos>) => {
    setFiltro({ ...filtro, ...cambio });
    setCuantos({});
  };
  const filtrados = filtrarHechos(propios, {
    ...filtro,
    dudosos: base.dudosos,
  }).sort(ordenHechos);
  const sinEstado = filtrarHechos(propios, {
    ...filtro,
    estado: "todos",
    dudosos: base.dudosos,
  });
  const sinOrigen = filtrarHechos(propios, {
    ...filtro,
    origen: "todos",
    dudosos: base.dudosos,
  });
  const recuentoFiltro = recuentoDe(sinEstado);
  const porOrigen = (o: HechoMundo["origen"]) =>
    sinOrigen.filter((h) => h.origen === o).length;
  const hayLaboratorio = propios.some((h) => h.origen === "laboratorio");
  const conFiltro =
    filtro.texto.trim() !== "" ||
    filtro.tema !== null ||
    filtro.origen !== "todos";
  const grupos = ESTADOS.filter(
    (e) => filtro.estado === "todos" || filtro.estado === e,
  );
  const inicial = grupos.length === 1 ? 12 : conFiltro ? 6 : 3;
  const visiblesPorGrupo = grupos.map((e) => {
    const lista = filtrados.filter((h) => h.estado === e);
    return { e, lista, visibles: lista.slice(0, cuantos[e] ?? inicial) };
  });
  const primero =
    visiblesPorGrupo.find((g) => g.visibles.length > 0)?.visibles[0] ?? null;
  const elegido = (seleccion ? porId.get(seleccion) : null) ?? primero;
  const cerrarFicha = () => setSeleccion(null);
  const estantes = todosLosTemas
    ? temas.estantes
    : temas.estantes.slice(0, ESTANTES_VISIBLES);
  const estanteSel: Estante | null =
    filtro.tema && filtro.tema !== SIN_TEMA
      ? (temas.estantes.find((s) => s.entidad.id === filtro.tema) ?? null)
      : null;
  const dudosos = temas.dudosos.filter((d) => d.sigla);

  return (
    <div className="mundo-hechos">
      <header className="mundo-hechos-cabecera">
        <div className="mundo-hechos-total">
          <span className="mundo-ceja">{tr("Lo que ROSA2018 sabe hoy")}</span>
          <p>
            <span className="mundo-total-n">{propios.length}</span>{" "}
            <em>
              {trp(
                temas.estantes.length === 1
                  ? "hechos, en {n} tema"
                  : "hechos, en {n} temas",
                { n: temas.estantes.length },
              )}
            </em>
          </p>
        </div>
        <label className="mundo-buscar">
          <IconSearch size={15} />
          <input
            value={filtro.texto}
            placeholder={tr("Buscar un hecho, un gen, una fuente...")}
            onChange={(e) => fijar({ texto: e.target.value })}
            aria-label={tr("Buscar")}
          />
          {filtro.texto !== "" && (
            <button
              type="button"
              aria-label={tr("Borrar la búsqueda")}
              onClick={() => fijar({ texto: "" })}
            >
              <IconX size={13} />
            </button>
          )}
        </label>
      </header>

      <div className="mundo-resumen-estados">
        <BarraDeEstados r={recuento} alto={10} />
        <div className="mundo-leyenda">
          {ESTADOS.map((e) => (
            <span key={e}>
              <i
                className={`mundo-punto mundo-punto-${e}`}
                aria-hidden="true"
              />
              {cuentaEstado(e, recuento[e])}
            </span>
          ))}
          {base.contrastados > 0 && (
            <span className="mundo-leyenda-aviso">
              <IconCircleHalf size={12} />
              {trp("{n} con citas en contra", { n: base.contrastados })}
            </span>
          )}
        </div>
      </div>

      <div className="mundo-filtros">
        <div
          className="mundo-chips-estado"
          role="group"
          aria-label={tr("Estado")}
        >
          <button
            type="button"
            aria-pressed={filtro.estado === "todos"}
            onClick={() => fijar({ estado: "todos" })}
          >
            {tr("Todos")} <span>{sinEstado.length}</span>
          </button>
          {ESTADOS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={filtro.estado === e}
              onClick={() => fijar({ estado: e })}
            >
              <i
                className={`mundo-punto mundo-punto-${e}`}
                aria-hidden="true"
              />
              {estadoCorto(e)} <span>{recuentoFiltro[e]}</span>
            </button>
          ))}
        </div>
        <div className="mundo-origenes" role="group" aria-label={tr("Origen")}>
          <button
            type="button"
            aria-pressed={filtro.origen === "todos"}
            onClick={() => fijar({ origen: "todos" })}
          >
            {tr("Cualquier origen")}
          </button>
          <button
            type="button"
            aria-pressed={filtro.origen === "fuente"}
            onClick={() => fijar({ origen: "fuente" })}
            title={tr("Lo dice la fuente citada")}
          >
            {tr("Dice la fuente")} · {porOrigen("fuente")}
          </button>
          <button
            type="button"
            aria-pressed={filtro.origen === "inferencia"}
            onClick={() => fijar({ origen: "inferencia" })}
            title={tr("Lo infiere ROSA2018; no es una cita")}
          >
            {tr("Inferencia")} · {porOrigen("inferencia")}
          </button>
          {hayLaboratorio && (
            <button
              type="button"
              aria-pressed={filtro.origen === "laboratorio"}
              onClick={() => fijar({ origen: "laboratorio" })}
            >
              {tr("Laboratorio")} · {porOrigen("laboratorio")}
            </button>
          )}
        </div>
      </div>

      {temas.estantes.length > 0 && (
        <section className="mundo-temas" aria-label={tr("Por tema")}>
          <div className="mundo-temas-cabeza">
            <h3>{tr("Por tema")}</h3>
            <span className="mundo-temas-nota">
              {tr(
                "Lo que nombran los hechos: genes, fármacos, regiones y procesos.",
              )}
            </span>
            {temas.estantes.length > ESTANTES_VISIBLES && (
              <button
                type="button"
                className="mundo-enlace"
                onClick={() => setTodosLosTemas((v) => !v)}
              >
                {todosLosTemas
                  ? tr("Ver menos")
                  : trp("Ver los {n} temas", { n: temas.estantes.length })}
              </button>
            )}
          </div>
          <div className="mundo-estantes">
            {estantes.map((s) => {
              const sel = filtro.tema === s.entidad.id;
              return (
                <button
                  key={s.entidad.id}
                  type="button"
                  className="mundo-estante"
                  aria-pressed={sel}
                  onClick={() => fijar({ tema: sel ? null : s.entidad.id })}
                  title={s.entidad.id}
                >
                  <span className="mundo-estante-cabeza">
                    <span className="mundo-estante-nombre">{s.nombre}</span>
                    <span className="mundo-estante-n">{s.total}</span>
                  </span>
                  <span className="mundo-estante-clase">
                    {s.clase}
                    {s.original && ` · ${s.original}`}
                  </span>
                  <BarraDeEstados r={s.recuento} alto={4} />
                  <span className="mundo-estante-cuentas">
                    {ESTADOS.filter((e) => s.recuento[e] > 0)
                      .map((e) => cuentaEstado(e, s.recuento[e]))
                      .join(" · ")}
                  </span>
                </button>
              );
            })}
          </div>
          {(temas.sinTema > 0 || dudosos.length > 0) && (
            <div className="mundo-temas-pie">
              {temas.sinTema > 0 && (
                <span>
                  {trp(
                    temas.sinTema === 1
                      ? "{n} hecho todavía sin tema reconocido"
                      : "{n} hechos todavía sin tema reconocido",
                    { n: temas.sinTema },
                  )}{" "}
                  ·{" "}
                  <button
                    type="button"
                    className="mundo-enlace"
                    aria-pressed={filtro.tema === SIN_TEMA}
                    onClick={() =>
                      fijar({
                        tema: filtro.tema === SIN_TEMA ? null : SIN_TEMA,
                      })
                    }
                  >
                    {filtro.tema === SIN_TEMA
                      ? tr("Ver todos")
                      : tr("Revisarlos")}
                  </button>
                </span>
              )}
              {dudosos.length > 0 && (
                <span className="mundo-dudosos">
                  {trp(
                    "No se muestran como temas {genes}: sus hechos no nombran el gen, solo una sigla que coincide ({siglas}). Puede ser una confusión del enlazado.",
                    {
                      genes:
                        dudosos
                          .slice(0, 4)
                          .map((d) => d.entidad.etiqueta)
                          .join(", ") +
                        (dudosos.length > 4
                          ? trp(" y {n} más", { n: dudosos.length - 4 })
                          : ""),
                      siglas:
                        dudosos
                          .slice(0, 4)
                          .map((d) => d.sigla)
                          .join(", ") + (dudosos.length > 4 ? "..." : ""),
                    },
                  )}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {(estanteSel || filtro.tema === SIN_TEMA) && (
        <div className="mundo-tema-sel">
          <div>
            <h3>
              {estanteSel ? estanteSel.nombre : tr("Sin tema reconocido")}
            </h3>
            <span className="mundo-tema-sel-meta">
              {estanteSel && (
                <Chip tono="borde">
                  {estanteSel.entidad.id}
                  {estanteSel.entidad.uniprot
                    ? ` · UniProt ${estanteSel.entidad.uniprot}`
                    : ""}
                </Chip>
              )}
              {cuentaHechos(filtrados.length)}
            </span>
          </div>
          <div className="mundo-tema-sel-acciones">
            {estanteSel && (
              <button
                type="button"
                className="btn btn-primario btn-s"
                onClick={() =>
                  preguntar(
                    trp("¿Qué se sabe de {tema}?", { tema: estanteSel.nombre }),
                  )
                }
              >
                <IconMessage size={14} />
                {trp("Preguntar sobre {tema}", { tema: estanteSel.nombre })}
              </button>
            )}
            <button
              type="button"
              className="btn btn-s"
              onClick={() => fijar({ tema: null })}
            >
              {tr("Quitar el tema")}
            </button>
          </div>
        </div>
      )}

      <div className="mundo-hechos-cuerpo">
        <div className="mundo-lista">
          {filtrados.length === 0 && (
            <p className="mundo-nada">
              {tr("Nada con este filtro.")}{" "}
              <button
                type="button"
                className="mundo-enlace"
                onClick={() => setFiltro(FILTRO_VACIO)}
              >
                {tr("Quitar los filtros")}
              </button>
            </p>
          )}
          {visiblesPorGrupo.map(({ e, lista, visibles }) =>
            lista.length === 0 ? null : (
              <section
                key={e}
                className="mundo-grupo"
                aria-label={ESTADO_HECHO[e]}
              >
                <h4 className="mundo-grupo-cabeza">
                  <i
                    className={`mundo-punto mundo-punto-${e}`}
                    aria-hidden="true"
                  />
                  {ESTADO_HECHO[e]}
                  <span>{lista.length}</span>
                </h4>
                <ul>
                  {visibles.map((h) => (
                    <li key={h.id}>
                      <FilaHecho
                        h={h}
                        sel={elegido?.id === h.id}
                        onClick={() => setSeleccion(h.id)}
                      />
                    </li>
                  ))}
                </ul>
                {lista.length > visibles.length && (
                  <button
                    type="button"
                    className="mundo-mas"
                    onClick={() =>
                      setCuantos({ ...cuantos, [e]: visibles.length + TANDA })
                    }
                  >
                    {lista.length - visibles.length <= TANDA
                      ? trp(
                          lista.length - visibles.length === 1
                            ? "Ver el {n} hecho {estado} restante"
                            : "Ver los {n} hechos {estado} restantes",
                          {
                            n: lista.length - visibles.length,
                            estado: ESTADO_PLURAL[e](
                              lista.length - visibles.length,
                            ),
                          },
                        )
                      : trp("Ver {m} más · quedan {n}", {
                          m: TANDA,
                          n: lista.length - visibles.length,
                        })}
                    <IconChevronDown size={12} />
                  </button>
                )}
              </section>
            ),
          )}
        </div>
        <aside className="mundo-detalle" aria-label={tr("El hecho elegido")}>
          {elegido ? (
            <DetalleHecho
              key={elegido.id}
              h={elegido}
              base={base}
              ahora={ahora}
              cerrar={cerrarFicha}
              elegirTema={(id) => fijar({ tema: id })}
              elegirHecho={setSeleccion}
              preguntar={preguntar}
            />
          ) : (
            <p className="mundo-nada">
              {tr("Elige un hecho para ver de dónde sale.")}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

const ESTADO_PLURAL: Record<HechoMundo["estado"], (n: number) => string> = {
  sabido: (n) => (n === 1 ? tr("sabido") : tr("sabidos")),
  abierto: (n) => (n === 1 ? tr("abierto") : tr("abiertos")),
  descartado: (n) => (n === 1 ? tr("descartado") : tr("descartados")),
};

function FilaHecho({
  h,
  sel,
  onClick,
}: {
  h: HechoMundo;
  sel: boolean;
  onClick: () => void;
}) {
  const ref = h.procedencia[0]?.referencia;
  const contra = h.citas.filter((c) => c.clasificacion === "contrasta").length;
  return (
    <button
      type="button"
      className={`hecho mundo-fila mundo-fila-${h.estado}`}
      aria-pressed={sel}
      onClick={onClick}
    >
      <span className="mundo-fila-texto">{h.enunciado}</span>
      <span className="mundo-fila-meta">
        {h.tipo === "pregunta" && (
          <span className="mundo-etiqueta mundo-etiqueta-pregunta">
            {tr("Pregunta abierta")}
          </span>
        )}
        {h.origen === "inferencia" && (
          <span className="mundo-etiqueta mundo-etiqueta-inferencia">
            {tr("Inferencia")}
          </span>
        )}
        {ref && <span className="mundo-etiqueta">{ref}</span>}
        {h.citas.length > 0 && (
          <span>
            {trp(h.citas.length === 1 ? "{n} cita" : "{n} citas", {
              n: h.citas.length,
            })}
          </span>
        )}
        {contra > 0 && (
          <span className="mundo-fila-contra">
            {trp("{n} en contra", { n: contra })}
          </span>
        )}
        {h.pendienteRevision && (
          <span className="mundo-etiqueta mundo-etiqueta-pendiente">
            {tr("Pendiente de revisar")}
          </span>
        )}
      </span>
      {h.estado === "descartado" && h.motivoDescarte && (
        <span className="mundo-fila-motivo">
          {recortar(h.motivoDescarte, 160)}
        </span>
      )}
    </button>
  );
}

function DetalleHecho({
  h,
  base,
  ahora,
  cerrar,
  elegirTema,
  elegirHecho,
  preguntar,
}: {
  h: HechoMundo;
  base: BaseMundo;
  ahora: number;
  cerrar: () => void;
  elegirTema: (id: string) => void;
  elegirHecho: (id: string) => void;
  preguntar: (prefijo: string) => void;
}) {
  const estantes = new Set(base.temas.estantes.map((s) => s.entidad.id));
  const n = { apoya: 0, menciona: 0, contrasta: 0 };
  for (const c of h.citas) n[c.clasificacion]++;
  const enlaces: { etiqueta: string; ids: string[]; clase: string }[] = [
    { etiqueta: tr("Sustituye a"), ids: h.sustituyeA ?? [], clase: "borde" },
    {
      etiqueta: tr("Sustituido por"),
      ids: h.sustituidoPor ? [h.sustituidoPor] : [],
      clase: "aviso",
    },
    { etiqueta: tr("Responde a"), ids: h.resuelveA ?? [], clase: "ok" },
    { etiqueta: tr("Choca con"), ids: h.contradiceA ?? [], clase: "mal" },
  ].filter((f) => f.ids.length > 0);
  // Una procedencia por fuente, con sus páginas juntas.
  const porFuente = new Map<
    string,
    { referencia: string; paginas: number[] }
  >();
  for (const p of h.procedencia) {
    const x = porFuente.get(p.fuenteId) ?? {
      referencia: p.referencia,
      paginas: [],
    };
    if (p.pagina !== null && !x.paginas.includes(p.pagina))
      x.paginas.push(p.pagina);
    porFuente.set(p.fuenteId, x);
  }
  return (
    <div className="mundo-ficha">
      <div className="mundo-ficha-chips">
        <Chip
          tono={
            h.estado === "sabido"
              ? "ok"
              : h.estado === "descartado"
                ? "neutro"
                : "aviso"
          }
        >
          {estadoCorto(h.estado)}
        </Chip>
        <Chip tono={h.tipo === "hipotesis" ? "acento" : "borde"}>
          {TIPO_HECHO[h.tipo]}
        </Chip>
        <Chip
          tono={h.origen === "fuente" ? "borde" : "aviso"}
          title={
            h.origen === "fuente"
              ? tr("Lo dice la fuente citada")
              : tr("Lo infiere ROSA2018; no es una cita")
          }
        >
          {h.origen === "fuente"
            ? tr("Dice la fuente")
            : h.origen === "laboratorio"
              ? tr("Laboratorio")
              : tr("Inferencia de ROSA2018")}
        </Chip>
        <button
          type="button"
          className="mundo-ficha-cerrar"
          aria-label={tr("Cerrar")}
          onClick={cerrar}
        >
          <IconX size={14} />
        </button>
      </div>
      <p
        className={`mundo-ficha-enunciado${h.enunciado.length > 280 ? " mundo-ficha-enunciado-largo" : ""}`}
      >
        {h.enunciado}
      </p>

      {h.pendienteRevision && (
        <div className="mundo-ficha-pendiente">
          <strong>{tr("Pendiente de revisar")}</strong>
          <span>{h.pendienteRevision.detalle}</span>
          <button
            type="button"
            className="btn btn-s"
            onClick={() =>
              acciones.atenderPendiente(
                "hecho",
                h.id,
                tr("revisado en el modelo de mundo"),
              )
            }
          >
            {tr("Ya lo revisé")}
          </button>
        </div>
      )}

      {h.estado === "descartado" && h.motivoDescarte && (
        <section className="mundo-ficha-bloque">
          <h5 className="mundo-ceja">{tr("Por qué se descartó")}</h5>
          <p className="mundo-ficha-motivo">{h.motivoDescarte}</p>
        </section>
      )}

      <section className="mundo-ficha-bloque">
        <h5 className="mundo-ceja">{tr("De dónde sale")}</h5>
        {porFuente.size === 0 ? (
          <p className="mundo-ficha-nota">
            {tr("Inferencia de ROSA2018: ninguna fuente lo dice tal cual.")}
          </p>
        ) : (
          <ul className="mundo-ficha-fuentes">
            {[...porFuente.entries()].map(([fid, x]) => {
              const f = base.fuentesPorId.get(fid);
              return (
                <li key={fid}>
                  <span className="mundo-ficha-ref">
                    {x.referencia}
                    {x.paginas.length > 0 && (
                      <span>
                        {trp(
                          x.paginas.length === 1 ? "pág. {p}" : "págs. {p}",
                          { p: x.paginas.sort((a, b) => a - b).join(", ") },
                        )}
                      </span>
                    )}
                  </span>
                  {f?.titulo && (
                    <span className="mundo-ficha-titulo">{f.titulo}</span>
                  )}
                  {(f?.pmid || f?.doi) && (
                    <span className="mundo-ficha-enlaces">
                      {f?.pmid && (
                        <a
                          className="mundo-ref"
                          href={`https://pubmed.ncbi.nlm.nih.gov/${f.pmid}/`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PubMed {f.pmid}
                          <IconExternal size={10} />
                        </a>
                      )}
                      {f?.doi && (
                        <a
                          className="mundo-ref"
                          href={`https://doi.org/${f.doi}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          doi:{f.doi}
                          <IconExternal size={10} />
                        </a>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {h.citas.length > 0 && (
        <section className="mundo-ficha-bloque">
          <h5 className="mundo-ceja">
            {tr("Lo que dicen otras fuentes")}
            <span className="mundo-ficha-cuentas">
              {n.apoya > 0 && (
                <span className="tono-ok">
                  {trp(n.apoya === 1 ? "{n} apoya" : "{n} apoyan", {
                    n: n.apoya,
                  })}
                </span>
              )}
              {n.menciona > 0 && (
                <span>
                  {trp(n.menciona === 1 ? "{n} menciona" : "{n} mencionan", {
                    n: n.menciona,
                  })}
                </span>
              )}
              {n.contrasta > 0 && (
                <span className="tono-mal">
                  {trp(n.contrasta === 1 ? "{n} contrasta" : "{n} contrastan", {
                    n: n.contrasta,
                  })}
                </span>
              )}
            </span>
          </h5>
          <ul className="mundo-ficha-citas">
            {h.citas.map((c, i) => (
              <li
                key={i}
                className={`mundo-cita mundo-cita-${c.clasificacion}`}
              >
                <span className="mundo-cita-cabeza">
                  <strong>{CLASIFICACION_CITA[c.clasificacion]}</strong>{" "}
                  {c.referencia}
                  {c.seccion && <span> · {c.seccion}</span>}
                </span>
                <q>{c.fragmento}</q>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(h.entidades ?? []).filter(Boolean).length > 0 && (
        <section className="mundo-ficha-bloque">
          <h5 className="mundo-ceja">{tr("Habla de")}</h5>
          <div className="mundo-ficha-entidades">
            {(h.entidades ?? []).filter(Boolean).map((e) =>
              estantes.has(e.id) ? (
                <button
                  key={e.id}
                  type="button"
                  className="mundo-entidad"
                  title={e.id}
                  onClick={() => elegirTema(e.id)}
                >
                  {nombreEntidad(e)}
                </button>
              ) : (
                <span
                  key={e.id}
                  className="mundo-entidad mundo-entidad-quieta"
                  title={
                    base.dudosos.has(e.id)
                      ? tr(
                          "Enlace dudoso: el hecho no nombra el gen, solo una sigla que coincide.",
                        )
                      : e.id
                  }
                >
                  {nombreEntidad(e)}
                  {base.dudosos.has(e.id) && " ?"}
                </span>
              ),
            )}
          </div>
        </section>
      )}

      {enlaces.length > 0 && (
        <section className="mundo-ficha-bloque">
          <h5 className="mundo-ceja">{tr("Relacionado")}</h5>
          <ul className="mundo-ficha-relacion">
            {enlaces.flatMap((f) =>
              f.ids.map((id) => {
                const otro = base.porId.get(id);
                return (
                  <li key={`${f.etiqueta}-${id}`}>
                    <Chip tono={f.clase as "ok" | "aviso" | "mal" | "borde"}>
                      {f.etiqueta}
                    </Chip>
                    {otro ? (
                      <button
                        type="button"
                        className="mundo-enlace"
                        onClick={() => elegirHecho(id)}
                      >
                        {recortar(otro.enunciado, 120)}
                      </button>
                    ) : (
                      <code className="mundo-codigo">{id}</code>
                    )}
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      )}

      <div className="mundo-ficha-acciones">
        <button
          type="button"
          className="btn btn-s"
          onClick={() =>
            preguntar(
              trp(
                "Sobre este hecho: «{hecho}». ¿Qué más se sabe y qué lo pondría en duda?",
                { hecho: recortar(h.enunciado, 160) },
              ),
            )
          }
        >
          <IconMessage size={14} />
          {tr("Preguntar sobre este hecho")}
        </button>
      </div>
      <p className="mundo-ficha-pie">
        <Momento t={h.actualizadoEn} ahora={ahora} />
        {h.historial.length > 1 &&
          ` · ${trp("{n} movimientos", { n: h.historial.length })}`}
        {(h.afirmacionIds?.length ?? 0) > 0 &&
          ` · ${trp(h.afirmacionIds!.length === 1 ? "{n} afirmación lo sostiene" : "{n} afirmaciones lo sostienen", { n: h.afirmacionIds!.length })}`}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Qué cambió
   --------------------------------------------------------------------- */

function QueCambio({
  inv,
  estado,
  ahora,
  base,
  abrirHecho,
}: {
  inv: Investigacion;
  estado: EstadoRosa;
  ahora: number;
  base: BaseMundo;
  abrirHecho: (id: string) => void;
}) {
  const { movimientos, corrida } = base;
  const coberturas = corrida?.coberturas ?? [];
  return (
    <div className="mundo-cambios">
      <section className="mundo-cambios-lista">
        <div className="mundo-temas-cabeza">
          <h3>{tr("Qué cambió desde tu última visita")}</h3>
          <span className="mundo-temas-nota">
            {tr(
              "Movimientos entre sabido, abierto y descartado, con quién los decidió y por qué.",
            )}
          </span>
        </div>
        {movimientos.length === 0 ? (
          <p className="mundo-nada">
            {tr("Nada se movió desde tu última visita.")}
          </p>
        ) : (
          <ul className="lista-limpia">
            {movimientos.slice(0, 80).map((x, i) => (
              <li key={`${x.h.id}-${i}`} className="movimiento">
                <div>
                  <div className="acciones" style={{ gap: 6 }}>
                    {x.m.de !== null && <Chip>{estadoCorto(x.m.de)}</Chip>}
                    <span className="meta">
                      {x.m.de !== null ? tr("a") : tr("nuevo en")}
                    </span>
                    <Chip
                      tono={
                        x.m.a === "sabido"
                          ? "ok"
                          : x.m.a === "descartado"
                            ? "mal"
                            : "acento"
                      }
                    >
                      {estadoCorto(x.m.a)}
                    </Chip>
                    <Chip tono={x.m.quien === "Rosa" ? undefined : "borde"}>
                      {nombreActor(x.m.quien)}
                    </Chip>
                  </div>
                  <button
                    type="button"
                    className="mundo-enlace mundo-movimiento-hecho"
                    onClick={() => abrirHecho(x.h.id)}
                  >
                    {x.h.enunciado}
                  </button>
                  <p className="meta">{x.m.motivo}</p>
                </div>
                <span className="meta">
                  <Momento t={x.m.fecha} ahora={ahora} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mundo-retracciones">
        <button
          type="button"
          className="btn btn-s"
          onClick={() => acciones.recomprobarRetracciones(inv.id)}
        >
          <IconRefresh size={13} />
          {tr("Recomprobar retractaciones ahora")}
        </button>
        <span className="meta">
          {tr(
            "Contra Crossref y Retraction Watch. Se hace solo cada 24 h; esto lo adelanta.",
          )}
        </span>
      </div>

      {coberturas.length > 0 && (
        <Seccion
          detalle
          titulo={tr("Cobertura de la búsqueda por tema")}
          nota={trp(
            "Cuánto de lo relevante se estima encontrado (curva de descubrimiento). Por debajo del {n} % una «ausencia refutada» se degrada a «sin verificar».",
            { n: Math.round(COBERTURA_MINIMA * 100) },
          )}
        >
          <div className="coberturas">
            {coberturas.map((c) => {
              const faltan = faltanParaCobertura(c, 0.9);
              const baja = c.fraccion < COBERTURA_MINIMA;
              return (
                <div key={c.tema} className="cobertura">
                  <div
                    className="acciones"
                    style={{ justifyContent: "space-between" }}
                  >
                    <strong style={{ fontSize: 13 }}>{c.tema}</strong>
                    <span
                      className={baja ? "tono-aviso" : "tono-ok"}
                      style={{ fontSize: 12.5 }}
                    >
                      {formatearPorcentaje(c.fraccion)}
                    </span>
                  </div>
                  <div className="presupuesto-barra">
                    <i
                      style={{
                        width: `${c.fraccion * 100}%`,
                        background: baja ? "var(--amber)" : "var(--green)",
                      }}
                    />
                  </div>
                  <span className="meta">
                    {trp("{n} leídos", { n: c.leidos })}
                    {Number.isFinite(faltan) &&
                      faltan > 0 &&
                      ` · ${trp("unos {n} más para el 90 %", { n: faltan })}`}
                  </span>
                  {baja && (
                    <button
                      type="button"
                      className="btn btn-s"
                      onClick={() =>
                        corrida &&
                        acciones.dirigirCorrida(
                          corrida.id,
                          `Extender la búsqueda del tema "${c.tema}" hasta el 90 % de cobertura (unos ${Number.isFinite(faltan) ? faltan : "muchos"} artículos más)`,
                        )
                      }
                      disabled={!corrida}
                    >
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
    </div>
  );
}
