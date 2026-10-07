// La corrida vista como un laboratorio: los agentes de ROSA en pixel art,
// cada uno en su sala, caminando y hablando mientras trabajan. Se llega desde
// el escenario de la corrida en vivo ("Verlo como laboratorio") y se vuelve
// con "Volver a la corrida". Lo que enseña sale del estado real de la
// iteración (lib/labVivo.ts); cuando un agente necesita tu permiso, la cámara
// se acerca a él y puedes responder aquí mismo. Con ‹ › se repasan las
// iteraciones anteriores de la misma corrida, ya cerradas.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acciones, cabeceras } from '../datos/almacen';
import type { AlcancePermiso, Corrida, EstadoRosa, Investigacion, Iteracion } from '../datos/tipos';
import { senalDeTope } from '../lib/diferido';
import type { Evidencia } from '../lib/evidencia';
import { datosDelLaboratorio } from '../lib/labVivo';
import { tr, trp, useIdioma } from '../lib/idioma';
import { marcaDeTiempo } from '../lib/escenario';
import { formatearEntero } from '../lib/formato';
import { rutaNovedad } from '../lib/ruta';
import { IconoEsc } from './IconosEscenario';
import { ConversacionesLaboratorio } from './ConversacionesLaboratorio';
import { claveVozPlan, vozDisponible } from './labvivo/vozDisponible';
import { useConversacionesLaboratorio } from '../lib/conversacionesLaboratorio';
import { ALTO, ANCHO, montarLaboratorio, type Laboratorio } from './labvivo/motor';
import './labvivo/labvivo.css';

type Props = { estado: EstadoRosa; inv: Investigacion; corrida: Corrida; iteracion: Iteracion | null; onVolver: () => void };

/** La extracción escribe un resultado por fuente. La verificación agrupa su
 * progreso: cinco decisiones o cinco entradas, más el cierre o una pausa.
 * Los fragmentos de texto que llegan mientras piensa el modelo no disparan
 * peticiones a la cadena de evidencia. */
function progresoEvidencia(it: Iteracion | null): string {
  return JSON.stringify((it?.pistas ?? []).filter((p) => p.tipo === 'extraccion' || p.tipo === 'verificacion').map((p) => {
    const resultados = p.transcripcion.filter((e) => e.tipo === 'resultado' || e.tipo === 'error');
    if (p.tipo === 'extraccion') return [p.id, p.estado, resultados.length];
    let juzgadas = 0, deterministas = '';
    for (const e of resultados) {
      const avance = /^Juez:\s*(\d[\d.]*)\s+de\s+\d/.exec(e.texto);
      if (avance) juzgadas = Number(avance[1]!.replace(/\./g, ''));
      if (e.texto.startsWith('Deterministas:')) deterministas = e.texto;
    }
    return [p.id, p.estado, Math.floor(resultados.length / 5), Math.floor(juzgadas / 5), deterministas];
  }));
}

export function LaboratorioVivo({ estado, inv, corrida, iteracion, onVolver }: Props) {
  const marco = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const motor = useRef<Laboratorio | null>(null);
  const [escala, setEscala] = useState(1);
  const idioma = useIdioma();
  const [charlasActivas, setCharlasActivas] = useState(true);
  const [peticionVisible, setPeticionVisible] = useState(false);
  // Las iteraciones de esta corrida, en orden; null en «verNumero» es la que está en curso.
  const iteraciones = useMemo(() => estado.iteraciones.filter((it) => it.corridaId === corrida.id).sort((a, b) => a.numero - b.numero), [estado.iteraciones, corrida.id]);
  const [verNumero, setVerNumero] = useState<{ corridaId: string; numero: number } | null>(null);
  const vista = verNumero?.corridaId === corrida.id && verNumero.numero !== corrida.iteracionActual ? iteraciones.find((it) => it.numero === verNumero.numero) ?? null : null;
  const pasada = vista !== null;
  // La cadena de evidencia trae las afirmaciones con su artículo y su veredicto.
  const [evidencia, setEvidencia] = useState<{ corridaId: string; datos: Evidencia } | null>(null);
  const itEvidencia = iteracion?.corridaId === corrida.id && iteracion.numero === corrida.iteracionActual ? iteracion : null;
  const claveEvidencia = `${corrida.id}:${itEvidencia?.id ?? ''}:${Math.floor(corrida.gasto.llamadas / 20)}:${corrida.busqueda.consultas.length}:${corrida.estado}:${progresoEvidencia(itEvidencia)}`;
  const contextoEvidencia = useRef({ clave: claveEvidencia, activa: false });
  contextoEvidencia.current = { clave: claveEvidencia, activa: corrida.estado === 'en_marcha' || corrida.estado === 'esperando_plan' || corrida.estado === 'esperando_modelo' };
  const refrescarEvidencia = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (estado.conexion !== 'en_linea') return;
    let vivo = true, enCurso = false, pendiente = false, bloqueada = false, errores = 0, ultimaClave = '';
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    let abortar: AbortController | null = null;
    let limpiarTope: (() => void) | null = null;
    const corridaId = corrida.id;
    const limpiarTimer = () => { if (temporizador !== null) clearTimeout(temporizador); temporizador = null; };
    const programar = (ms: number) => {
      limpiarTimer();
      temporizador = setTimeout(() => { temporizador = null; void pedir(); }, ms);
    };
    async function pedir() {
      if (!vivo || bloqueada) return;
      if (enCurso) { pendiente = true; return; }
      limpiarTimer(); enCurso = true; pendiente = false; ultimaClave = contextoEvidencia.current.clave;
      // Cada petición tiene su propio tope; un aborto anterior no contamina el reintento.
      const peticion = new AbortController(), tope = senalDeTope().signal;
      abortar = peticion;
      const agotar = () => peticion.abort(tope?.reason);
      const retirarTope = () => tope?.removeEventListener('abort', agotar);
      limpiarTope = retirarTope;
      if (tope?.aborted) agotar();
      else tope?.addEventListener('abort', agotar, { once: true });
      try {
        const r = await fetch(`/api/corridas/${encodeURIComponent(corridaId)}/evidencia`, { cache: 'no-store', headers: cabeceras(false), signal: peticion.signal });
        if (!vivo) return;
        // Un acceso rechazado requiere recuperar la sesión, no insistir por reloj.
        if (r.status === 401 || r.status === 403) { bloqueada = true; return; }
        if (!r.ok) throw new Error('evidencia_http');
        const d = await r.json() as Evidencia;
        if (!vivo) return;
        if (!d || d.corridaId !== corridaId || !Number.isSafeInteger(d.version) || d.version < 0 || !Array.isArray(d.fuentes) || !Array.isArray(d.consultas) || !Array.isArray(d.afirmaciones)) throw new Error('evidencia_invalida');
        setEvidencia((anterior) => anterior?.corridaId === corridaId && anterior.datos.version > d.version ? anterior : { corridaId, datos: d });
        errores = 0;
      } catch {
        if (vivo) errores += 1;
      } finally {
        retirarTope();
        if (limpiarTope === retirarTope) limpiarTope = null;
        abortar = null; enCurso = false;
        if (vivo && !bloqueada) {
          if (errores) programar(Math.min(30000, 10000 * 2 ** Math.min(errores - 1, 2)));
          else if (pendiente && ultimaClave !== contextoEvidencia.current.clave) void pedir();
          else if (contextoEvidencia.current.activa) programar(10000);
        }
      }
    }
    const refrescar = () => {
      if (!vivo || bloqueada || ultimaClave === contextoEvidencia.current.clave) return;
      if (enCurso) pendiente = true;
      else if (!errores) void pedir();
    };
    refrescarEvidencia.current = refrescar;
    void pedir();
    return () => {
      vivo = false; limpiarTimer(); limpiarTope?.(); limpiarTope = null; abortar?.abort();
      if (refrescarEvidencia.current === refrescar) refrescarEvidencia.current = null;
    };
  }, [corrida.id, estado.conexion]);
  useEffect(() => { refrescarEvidencia.current?.(); }, [claveEvidencia]);
  const ev = evidencia?.corridaId === corrida.id ? evidencia.datos : null;
  const datos = useMemo(() => {
    return pasada ? datosDelLaboratorio(estado, inv, corrida, vista, { pasada: true, evidencia: ev }) : datosDelLaboratorio(estado, inv, corrida, iteracion, { evidencia: ev });
  }, [estado, inv, corrida, iteracion, vista, pasada, ev, idioma]);
  const numeros = iteraciones.map((it) => it.numero);
  const iteracionCharla = estado.iteraciones.find((it) => it.corridaId === corrida.id && it.numero === datos.iteracion);
  const conversar = charlasActivas && !peticionVisible && vozDisponible(datos) && !pasada && (datos.iteracion === corrida.iteracionActual || claveVozPlan(datos) !== null);
  const charlas = useConversacionesLaboratorio(corrida.id, claveVozPlan(datos) ?? iteracionCharla?.id ?? null, idioma, estado.conexion === 'en_linea', conversar);
  const posicion = datos.iteracion !== null ? numeros.indexOf(datos.iteracion) : -1;
  const ir = (numero: number | undefined) => { if (numero !== undefined) setVerNumero(numero === corrida.iteracionActual ? null : { corridaId: corrida.id, numero }); };
  const actuales = useRef(datos);
  actuales.current = datos;
  // El motor vive fuera de React: las respuestas le llegan por esta referencia
  // para que siempre llame a la versión actual de onVolver.
  const volver = useRef(onVolver);
  volver.current = onVolver;
  const contextoNovedad = useRef({ investigacionId: inv.id, hipotesis: estado.hipotesis });
  contextoNovedad.current = { investigacionId: inv.id, hipotesis: estado.hipotesis };

  useLayoutEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => setEscala(Math.min(1, el.clientWidth / ANCHO) || 1);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const lab = montarLaboratorio(el, actuales.current, {
      conceder: (id: string, alcance: string | null, argumentos?: Record<string, string>) => acciones.resolverSolicitudVerificada(id, 'conceder', alcance as AlcancePermiso | null, argumentos),
      denegar: (id: string) => acciones.resolverSolicitudVerificada(id, 'denegar', null),
      aprobarPlan: (iteracionId: string) => acciones.aprobarPlanVerificado(iteracionId),
      estadoPeticion: setPeticionVisible,
      ampliarPresupuesto: (id: string, limite: number) => acciones.ampliarPresupuestoVerificado(id, limite),
      resolverIncidencia: (id: string, resolucion: string) => acciones.resolverIncidenciaVerificada(id, resolucion),
      verEnLaCorrida: () => volver.current(),
      verNovedad: (agente, hipotesisId) => {
        const contexto = contextoNovedad.current;
        const id = contexto.hipotesis.some((h) => h.id === hipotesisId && h.investigacionId === contexto.investigacionId) ? hipotesisId! : null;
        window.location.hash = rutaNovedad(contexto.investigacionId, id, agente);
      },
    });
    motor.current = lab;
    return () => {
      lab.desmontar();
      motor.current = null;
    };
    // Los textos imperativos se regeneran también al cambiar de idioma.
  }, [idioma]);

  useEffect(() => {
    motor.current?.actualizar(datos);
  }, [datos]);

  useEffect(() => {
    motor.current?.conversar(charlas.turnos, conversar);
  }, [charlas.turnos, conversar, idioma]);

  const aviso = pasada
    ? tr('Estás viendo una iteración anterior: nada de lo que ves está pasando ahora.')
    : estado.conexion !== 'en_linea'
      ? estado.conexion === 'muestra' ? tr('Datos de muestra: este laboratorio no está conectado a una corrida real.') : tr('Sin conexión en vivo: se muestra el último estado recibido')
      : corrida.estado === 'detenida' || corrida.estado === 'terminada'
        ? tr('La corrida ya terminó: el laboratorio enseña cómo quedó la última iteración.')
        : !datos.trabajando
          ? datos.estadoTexto
        : null;

  return (
    <div className="contenido escenario-pagina">
      <div className="labvivo-cabecera">
        <button type="button" className="esc-boton" onClick={onVolver}>
          <IconoEsc nombre="arrow-up-left" size={14} /> {tr('Volver a la corrida')}
        </button>
        <h2>{tr('El laboratorio en vivo')}</h2>
        <p>{tr('Cada sala representa una etapa de la investigación. Pasa el ratón por un agente (o recórrelos con el tabulador y las flechas) para ver su actividad; haz clic para acercarte. Sofía y Damián abren su dossier en Novedad. La pizarra, las estanterías, las cajas del juez y la hucha también se abren con un clic.')}</p>
      </div>
      {aviso && <p className="labvivo-aviso">{aviso}</p>}
      <div className="labvivo-estado" role="status">
        <strong>{trp('Corrida {n}', { n: datos.corrida })}{datos.iteracion !== null && numeros.length <= 1 && ` · ${trp('Iteración {n}', { n: datos.iteracion })}`}</strong>
        {numeros.length > 1 && datos.iteracion !== null && <span className="labvivo-iter" role="group" aria-label={tr('Cambiar de iteración')}>
          <button type="button" aria-label={tr('Iteración anterior')} title={tr('Iteración anterior')} disabled={posicion <= 0} onClick={() => ir(numeros[posicion - 1])}>‹</button>
          <strong>{trp('Iteración {n}', { n: datos.iteracion })}</strong>
          <button type="button" aria-label={tr('Iteración siguiente')} title={tr('Iteración siguiente')} disabled={posicion < 0 || posicion >= numeros.length - 1} onClick={() => ir(numeros[posicion + 1])}>›</button>
          {pasada && <button type="button" className="vuelve" onClick={() => setVerNumero(null)}>{tr('Volver a la iteración en curso')}</button>}
        </span>}
        <span>{datos.estadoTexto}</span>
        {datos.motivo && <span>{datos.motivo}</span>}
        <span>{tr('Los personajes comentan los hallazgos de esta corrida con IA, con referencias al registro y la evidencia.')}</span>
      </div>
      <div ref={marco} className="labvivo-marco" style={{ height: ALTO * escala }}>
        <div ref={lienzo} className="labvivo" style={{ transform: `scale(${escala})` }} />
      </div>
      <ConversacionesLaboratorio estado={charlas.estado} turnos={charlas.turnos} activo={charlasActivas} onCambiar={setCharlasActivas} />
      <dl className="labvivo-cifras">
        {([
          [tr('Resultados de consultas'), datos.lectura.resultados],
          [tr('Resultados relevantes'), datos.lectura.sirven],
          [tr('Textos completos recuperados'), datos.lectura.recuperados],
          [tr('Fuentes leídas en la última extracción'), datos.lectura.leidos],
          [tr('Afirmaciones extraídas'), datos.lectura.afirmaciones],
          [tr('Última verificación'), datos.juez.hechas !== null && datos.juez.total !== null ? `${formatearEntero(datos.juez.hechas)} / ${formatearEntero(datos.juez.total)}` : null],
        ] as const).map(([nombre, valor]) => <div key={nombre}><dt>{nombre}</dt><dd>{valor === null ? tr('No registrado') : typeof valor === 'number' ? formatearEntero(valor) : valor}</dd></div>)}
      </dl>
      <details className="labvivo-registro" open>
        <summary>{tr('Registro de esta iteración')}</summary>
        <p>{tr('Cada tiempo se mide desde el inicio de su propia pista.')}</p>
        {datos.actividad.length === 0 ? <p>{tr('Sin actividad registrada en esta iteración')}</p> : <ol>
          {datos.actividad.slice(-60).reverse().map((e) => <li key={e.id} data-tipo={e.tipo}>
            <div><strong>{tr(e.agente)}</strong><span>{e.t !== null ? marcaDeTiempo(e.t) : ''} · {e.titulo}{e.fuente && ` · ${e.fuente}`}</span></div>
            <p>{e.texto}</p>
          </li>)}
        </ol>}
      </details>
    </div>
  );
}
