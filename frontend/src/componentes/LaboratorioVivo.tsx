// La corrida vista como un laboratorio: los agentes de ROSA en pixel art,
// cada uno en su sala, caminando y hablando mientras trabajan. Se llega desde
// el escenario de la corrida en vivo ("Verlo como laboratorio") y se vuelve
// con "Volver a la corrida". Lo que enseña sale del estado real de la
// iteración (lib/labVivo.ts); cuando un agente necesita tu permiso, la cámara
// se acerca a él y puedes responder aquí mismo.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acciones } from '../datos/almacen';
import type { AlcancePermiso, Corrida, EstadoRosa, Investigacion, Iteracion } from '../datos/tipos';
import { datosDelLaboratorio } from '../lib/labVivo';
import { tr, trp, useIdioma } from '../lib/idioma';
import { marcaDeTiempo } from '../lib/escenario';
import { formatearEntero } from '../lib/formato';
import { IconoEsc } from './IconosEscenario';
import { ALTO, ANCHO, montarLaboratorio, type Laboratorio } from './labvivo/motor';
import './labvivo/labvivo.css';

type Props = { estado: EstadoRosa; inv: Investigacion; corrida: Corrida; iteracion: Iteracion | null; onVolver: () => void };

export function LaboratorioVivo({ estado, inv, corrida, iteracion, onVolver }: Props) {
  const marco = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const motor = useRef<Laboratorio | null>(null);
  const [escala, setEscala] = useState(1);
  const idioma = useIdioma();
  const datos = useMemo(() => datosDelLaboratorio(estado, inv, corrida, iteracion), [estado, inv, corrida, iteracion, idioma]);
  const actuales = useRef(datos);
  actuales.current = datos;
  // El motor vive fuera de React: las respuestas le llegan por esta referencia
  // para que siempre llame a la versión actual de onVolver.
  const volver = useRef(onVolver);
  volver.current = onVolver;

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
      conceder: (id: string, alcance: string | null) => acciones.resolverSolicitudVerificada(id, 'conceder', alcance as AlcancePermiso | null),
      denegar: (id: string) => acciones.resolverSolicitudVerificada(id, 'denegar', null),
      aprobarPlan: (iteracionId: string) => acciones.aprobarPlanVerificado(iteracionId),
      verEnLaCorrida: () => volver.current(),
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

  const aviso =
    estado.conexion !== 'en_linea'
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
        <p>{tr('Cada sala representa una etapa de la investigación. Pasa el ratón por un agente para ver su actividad; haz clic para acercarte.')}</p>
      </div>
      {aviso && <p className="labvivo-aviso">{aviso}</p>}
      <div className="labvivo-estado" role="status">
        <strong>{trp('Corrida {n}', { n: datos.corrida })}{datos.iteracion !== null && ` · ${trp('Iteración {n}', { n: datos.iteracion })}`}</strong>
        <span>{datos.estadoTexto}</span>
        {datos.motivo && <span>{datos.motivo}</span>}
        <span>{tr('Los personajes representan funciones de ROSA; sus mensajes proceden del registro de la corrida.')}</span>
      </div>
      <div ref={marco} className="labvivo-marco" style={{ height: ALTO * escala }}>
        <div ref={lienzo} className="labvivo" style={{ transform: `scale(${escala})` }} />
      </div>
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
