// Barra lateral: la marca, las investigaciones, y dentro de la investigacion
// actual sus pantallas. La cola de hipotesis, los permisos e incidencias
// pendientes llevan su cuenta al lado, porque son lo que espera a una persona.

import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { traducido, tr, trp } from '../lib/idioma';
import { ESTADO_CORRIDA } from '../lib/etiquetas';
import { pendientesDeRevision } from '../lib/hipotesis';
import { rutaDe, rutaLaboratorio, type Pantalla, type Ruta } from '../lib/ruta';
import {
  IconActivity,
  IconDocument,
    IconGauge,
  IconGlobe,
  IconLayers,
  IconPlus,
  IconSearch,
  IconAyuda,
  IconSettings,
  IconTree,
  IconTrophy,
  IconUsers,
} from './icons';

/** Icono del atlas: un cerebro en corte sagital (visto de lado, partido por la
 *  mitad), con la cisura y el tronco. Sigue las convenciones de icons.tsx
 *  (trazo 1.75, currentColor, extremos redondeados); vive aquí porque es el
 *  único sitio que lo usa. */
function IconAtlas({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 4.5a4 4 0 0 0-5.5 3.7c-1 1.2-1 3.2.2 4.4-.5 1.6.3 3.3 2 3.9.6 1.6 2.4 2.3 3.9 1.5" />
      <path d="M9.6 18c1.7 1 3.9.4 4.8-1.3 1.9-.1 3.3-1.6 3.3-3.4 1.5-.9 2-2.9 1-4.4.3-1.9-1-3.6-2.9-3.9C15 3.4 13 3 11.6 4.2" />
      <path d="M11.5 4.5v13.4" />
      <path d="M10.5 18v3M13 18v3" />
    </svg>
  );
}

/** Icono de los mecanismos: dos nodos y una flecha entre ellos, con una
 *  tercera causa que entra desde arriba, que es la forma de un confusor y lo
 *  que la pantalla enseña. */
function IconMecanismo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4.5" cy="17" r="2.5" />
      <circle cx="19.5" cy="17" r="2.5" />
      <circle cx="12" cy="4.5" r="2.5" />
      <path d="M7 17h10" />
      <path d="M10.4 6.6 5.8 14.6" />
      <path d="M13.6 6.6l4.6 8" />
    </svg>
  );
}

/** Icono de las citas: una página con una línea resaltada, que es justo lo que
 *  la pantalla enseña (el pasaje marcado dentro de la página de la fuente). */
function IconCita({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M8 13h8" strokeWidth="3.4" opacity="0.45" />
      <path d="M8 17h5" />
    </svg>
  );
}

/** Icono de lo que va al laboratorio: una hélice de proteína dentro de un vial.
 *  No es un matraz (ese es el de la cola de hipótesis): aquí lo que se enseña
 *  es una estructura, no un experimento por hacer. */
function IconEstructura({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5h8" />
      <path d="M9.5 2.5v4.2L5.6 18.4A2.4 2.4 0 0 0 7.9 21.5h8.2a2.4 2.4 0 0 0 2.3-3.1L14.5 6.7V2.5" />
      <path d="M8.4 12.2c1.6 1.4 3.2 1.4 4.3.3s2.4-1.4 3.6-.3" />
      <path d="M7.2 16.4c1.9 1.6 3.8 1.6 5.2.3s2.9-1.5 4.3-.2" />
    </svg>
  );
}

const PANTALLAS: { clave: Pantalla; etiqueta: string; icono: (p: { size?: number }) => JSX.Element }[] = traducido([
  { clave: 'corrida', etiqueta: 'Corrida en vivo', icono: IconActivity },
  // El ranking es también la cola: la sección «Cola de hipótesis» se fusionó
  // aquí el 1 de octubre de 2026 porque las dos enseñaban la misma lista con
  // otro orden. El contador de lo que espera tu decisión viene con ella.
  { clave: 'ranking', etiqueta: 'Hipótesis y ranking', icono: IconTrophy },
  { clave: 'panorama', etiqueta: 'Panorama', icono: IconGlobe },
  { clave: 'mundo', etiqueta: 'Modelo de mundo', icono: IconLayers },
  { clave: 'arbol', etiqueta: 'Árbol', icono: IconTree },
  { clave: 'atlas', etiqueta: 'Atlas', icono: IconAtlas },
  { clave: 'mecanismos', etiqueta: 'Mecanismos', icono: IconMecanismo },
  { clave: 'citas', etiqueta: 'Citas', icono: IconCita },
  { clave: 'artefactos', etiqueta: 'Artefactos', icono: IconDocument },
  { clave: 'calidad', etiqueta: 'Calidad', icono: IconGauge },
  { clave: 'investigacion', etiqueta: 'Objetivo y datos', icono: IconUsers },
]);

interface Props {
  estado: EstadoRosa;
  ruta: Ruta;
  abierta: boolean;
  onCerrar: () => void;
  onBuscar: () => void;
  /** El recorrido de ROSA2018. Estaba en el «?» de la cabecera, que ahora es
   *  el selector de idioma; se mueve aquí porque es algo que se ve una vez y
   *  se busca en el menú, no en la barra de arriba. */
  onAyuda?: () => void;
}

export function BarraLateral({ estado, ruta, abierta, onCerrar, onBuscar, onAyuda }: Props) {
  const invId = ruta.tipo === 'investigacion' ? ruta.investigacionId : null;
  const pantalla = ruta.tipo === 'investigacion' ? ruta.pantalla : null;
  const actual = estado.investigaciones.find((i) => i.id === invId) ?? null;

  const cuentas = (inv: Investigacion | null): Partial<Record<Pantalla, number>> => {
    if (!inv) return {};
    const hip = estado.hipotesis.filter((h) => h.investigacionId === inv.id);
    const corridas = estado.corridas.filter((c) => c.investigacionId === inv.id).map((c) => c.id);
    const permisos = estado.solicitudes.filter((s) => corridas.includes(s.corridaId) && s.estado === 'pendiente').length;
    // Las incidencias que ROSA2018 resuelve sola (modelo sin respuesta) no piden nada a la persona: no suman.
    const incidencias = estado.incidencias.filter((i) => corridas.includes(i.corridaId) && i.estado === 'pendiente' && i.tipo !== 'modelo_sin_respuesta').length;
    const planes = estado.iteraciones.filter((i) => corridas.includes(i.corridaId) && !i.planAprobado && i.terminadaEn === null).length;
    const datos = inv.datasets.filter((d) => d.estado === 'pendiente').length;
    return { ranking: pendientesDeRevision(hip), corrida: permisos + incidencias + planes, investigacion: datos };
  };
  const n = cuentas(actual);

  return (
    <>
      {abierta && <div className="scrim" onClick={onCerrar} aria-hidden="true" />}
      <nav className={`barra ${abierta ? 'abierta' : ''}`} aria-label={tr('Navegación principal')}>
        <a className="marca" href="#/" onClick={onCerrar}>
          <img src="/arbol-marca.png" alt="" width={30} height={30} />
          <div>
            <strong>ROSA2018</strong>
            <small>Alzheimer Project</small>
          </div>
        </a>

        <button type="button" className="nav-item nav-buscar" onClick={onBuscar} disabled={actual === null} title={tr('Buscar en la investigación (Cmd+K o Ctrl+K)')}>
          <IconSearch size={14} />
          {tr('Buscar')}
          <span className="meta" style={{ marginLeft: 'auto' }}>
            Cmd K
          </span>
        </button>

        <div className="barra-seccion">
          <div className="barra-titulo">
            <span>{tr('Investigaciones')}</span>
            <a href="#/nueva" onClick={onCerrar} title={tr('Nueva investigación')}>
              <IconPlus size={13} /> {tr('Nueva')}
            </a>
          </div>
          {estado.investigaciones.map((inv) => {
            const corrida = estado.corridas.filter((c) => c.investigacionId === inv.id).sort((a, b) => b.numero - a.numero)[0];
            return (
              <a key={inv.id} className="nav-inv" href={rutaDe(inv.id, 'corrida')} aria-current={inv.id === invId ? 'true' : undefined} onClick={onCerrar}>
                <span>{inv.titulo}</span>
                <small>{corrida ? trp('Corrida {n} · {estado}', { n: corrida.numero, estado: ESTADO_CORRIDA[corrida.estado] }) : tr('Sin corridas')}</small>
              </a>
            );
          })}
        </div>

        {actual && (
          <div className="barra-seccion">
            <div className="barra-titulo">
              <span>{tr('Esta investigación')}</span>
            </div>
            {PANTALLAS.map((p) => {
              const Icono = p.icono;
              const cuenta = n[p.clave] ?? 0;
              return (
                <a key={p.clave} className="nav-item" href={rutaDe(actual.id, p.clave)} aria-current={pantalla === p.clave ? 'page' : undefined} onClick={onCerrar}>
                  <Icono size={15} />
                  {p.etiqueta}
                  {cuenta > 0 && <span className="nav-cuenta">{cuenta}</span>}
                </a>
              );
            })}
          </div>
        )}

        <div className="barra-seccion">
          <div className="barra-titulo">
            <span>{tr('De todas las investigaciones')}</span>
          </div>
          <a className="nav-item" href={rutaLaboratorio()} aria-current={ruta.tipo === 'laboratorio' ? 'page' : undefined} onClick={onCerrar}>
            <IconEstructura size={15} />
            {tr('Al laboratorio')}
          </a>
        </div>

        <div className="barra-seccion">
          {onAyuda && (
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                onCerrar();
                onAyuda();
              }}
            >
              <IconAyuda size={15} />
              {tr('Cómo funciona ROSA2018')}
            </button>
          )}
          <a className="nav-item" href="#/ajustes" aria-current={ruta.tipo === 'ajustes' ? 'page' : undefined} onClick={onCerrar}>
            <IconSettings size={15} />
            {tr('Ajustes')}
          </a>
        </div>

        <p className="barra-pie">
          {tr('ROSA2018 investiga; la persona decide.')}{' '}
          {tr('Ninguna hipótesis entra al modelo de mundo sin pasar por la cola.')}
        </p>
      </nav>
    </>
  );
}
