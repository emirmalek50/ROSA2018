// Piezas pequenas compartidas por las pantallas: chips, botones, secciones,
// vacios, confirmacion en dos pasos inline (nunca window.confirm), el aviso
// de datos de muestra y el momento (hora absoluta y relativa).

import { motion, useReducedMotion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import type { EstadoConexion } from '../datos/tipos';
import { fechaCorta, tiempoRelativo } from '../lib/formato';
import { terminosEn } from '../lib/glosario';
import { primeraFrase, useModo } from '../lib/modo';
import { IconAlert } from './icons';
import { tr, trp, idiomaActual } from '../lib/idioma';
import { Desplegable } from './Desplegable';

export function Chip({ tono, children, title }: { tono?: 'ok' | 'aviso' | 'mal' | 'acento' | 'borde' | 'neutro'; children: ReactNode; title?: string }) {
  return (
    <span className={`chip${tono && tono !== 'neutro' ? ` chip-${tono}` : ''}`} title={title}>
      {children}
    </span>
  );
}

/** Hora absoluta y relativa a la vez: "10 sep, 14:30 · hace 5 min". En una
 *  corrida de dias, "hace 31 min" no basta para auditar. */
export function Momento({ t, ahora, soloRelativo = false }: { t: number; ahora: number; soloRelativo?: boolean }) {
  if (!Number.isFinite(t) || t <= 0) {
    // Un momento ausente o corrupto (null convertido, NaN) no puede tumbar la
    // pantalla entera por un toISOString que lanza.
    return <span className="momento meta">{tr("sin fecha")}</span>;
  }
  const abs = fechaCorta(t);
  const rel = tiempoRelativo(t, ahora);
  return (
    <time className="momento" dateTime={new Date(t).toISOString()} title={new Date(t).toLocaleString(idiomaActual() === 'en' ? 'en' : 'es')}>
      {soloRelativo ? rel : `${abs} · ${rel}`}
    </time>
  );
}

interface SeccionProps {
  titulo: string;
  nota?: string;
  acciones?: ReactNode;
  children: ReactNode;
  /** Ingenieria: en modo sencillo queda plegada tras una linea de resumen. */
  detalle?: boolean;
  /** Se puede plegar a mano aunque no sea de detalle. */
  plegable?: boolean;
  /** Si es plegable, si empieza abierta (por defecto si). */
  abierta?: boolean;
  /** La linea que se ve plegada (si no, la primera frase de la nota). */
  resumen?: ReactNode;
  id?: string;
}

/** Toda seccion de ROSA2018 entra suavemente cuando aparece en pantalla (una
 *  sola vez). En modo sencillo, la nota se reduce a su primera frase y el
 *  boton "?" abre la explicacion completa con las definiciones de los
 *  terminos tecnicos que nombra; las secciones de detalle quedan plegadas
 *  tras una linea de resumen. La profundidad sigue ahi, a un clic. */
export function Seccion({ titulo, nota, acciones, children, detalle = false, plegable = false, abierta, resumen, id }: SeccionProps) {
  const reducido = useReducedMotion();
  const contenidoId = useId();
  const modo = useModo();
  const sencillo = modo === 'sencillo';
  const pliegaPorModo = detalle && sencillo;
  const puedePlegar = plegable || detalle;
  const [abiertoManual, setAbiertoManual] = useState<boolean | null>(null);
  const abierto = abiertoManual ?? (pliegaPorModo ? false : (abierta ?? true));
  const [ayuda, setAyuda] = useState(false);
  const notaCorta = nota ? (sencillo ? primeraFrase(nota) : nota) : undefined;
  const terminos = nota || titulo ? terminosEn(`${titulo} ${nota ?? ''}`) : [];
  const hayAyuda = Boolean(nota && (sencillo ? notaCorta !== nota || terminos.length > 0 : terminos.length > 0));
  return (
    <motion.section id={id} className={`seccion ${!abierto ? 'seccion-plegada' : ''} ${detalle ? 'seccion-detalle' : ''}`} initial={reducido ? { opacity: 0 } : { opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-24px' }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      <div className="seccion-titulo">
        <div style={{ minWidth: 0 }}>
          <h3>
            {puedePlegar ? (
              <button type="button" className="seccion-plegar" aria-expanded={abierto} aria-controls={contenidoId} onClick={() => setAbiertoManual(!abierto)}>
                <span className="seccion-flecha" aria-hidden="true">▸</span> {titulo}
              </button>
            ) : (
              titulo
            )}
            {detalle && <span className="chip chip-borde seccion-etiqueta-detalle" title={tr("Es información de ingeniería o de auditoría: en modo Detalle se abre sola.")}>{tr("detalle")}</span>}
            {hayAyuda && (
              <button type="button" className="seccion-ayuda" aria-expanded={ayuda} aria-label={trp('Explicar {titulo}', { titulo })} title={tr("Qué es esto y qué significan sus términos")} onClick={() => setAyuda((v) => !v)}>
                ?
              </button>
            )}
          </h3>
          {abierto ? notaCorta && <p>{notaCorta}</p> : <p className="seccion-resumen">{resumen ?? notaCorta}</p>}
          {ayuda && nota && (
            <div className="ayuda-caja" role="note">
              <p>{nota}</p>
              {terminos.length > 0 && (
                <dl>
                  {terminos.map((t) => (
                    <div key={t.termino}>
                      <dt>{t.termino}</dt>
                      <dd>{t.definicion}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
        {acciones && abierto && <div className="acciones">{acciones}</div>}
      </div>
      {puedePlegar ? <Desplegable abierto={abierto} id={contenidoId} className="seccion-contenido">{children}</Desplegable> : abierto && children}
    </motion.section>
  );
}

/** Un estado vacio que explica que va a pasar aqui (y que tiene que ocurrir
 *  antes), en vez de quedarse en blanco. `pasos` son esas frases, en orden. */
export function Vacio({ titulo, children, pasos, accion }: { titulo: string; children?: ReactNode; pasos?: string[]; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <span className="vacio-icono" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21V12" />
          <path d="M12 12c-3 0-5.5-2.2-5.5-5S9 3 12 3s5.5 1.8 5.5 4-2.5 5-5.5 5Z" />
          <path d="M12 12c-1.5-1.5-4-2-6-1M12 12c1.5-1.5 4-2 6-1" />
          <path d="M8 21h8" />
        </svg>
      </span>
      <h3>{titulo}</h3>
      {children && <p>{children}</p>}
      {pasos && pasos.length > 0 && (
        <ol className="vacio-pasos">
          {pasos.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      )}
      {accion && <div className="acciones" style={{ justifyContent: 'center', marginTop: 12 }}>{accion}</div>}
    </div>
  );
}

interface ConfirmarProps {
  etiqueta: string;
  pregunta: string;
  pedirTexto?: { etiqueta: string; marcador: string };
  /** Contenido extra dentro de la confirmacion (por ejemplo un interruptor). */
  extra?: ReactNode;
  peligro?: boolean;
  primario?: boolean;
  disabled?: boolean;
  clase?: string;
  /** Icono delante de la etiqueta del boton cerrado. */
  icono?: ReactNode;
  onConfirmar: (texto: string) => void;
}

/** Boton con confirmacion inline en dos pasos. Con `pedirTexto`, ademas exige
 *  un motivo: es lo que se usa para descartar una hipotesis o detener una
 *  corrida, donde el motivo queda en el rastro. */
export function Confirmar({ etiqueta, pregunta, pedirTexto, extra, peligro, primario, disabled, clase, icono, onConfirmar }: ConfirmarProps) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  if (!abierto) {
    return (
      <button type="button" className={`btn ${peligro ? 'btn-peligro' : ''} ${primario ? 'btn-primario' : ''} ${clase ?? ''}`} disabled={disabled} onClick={() => setAbierto(true)}>
        {icono}
        {etiqueta}
      </button>
    );
  }
  const falta = pedirTexto !== undefined && texto.trim() === '';
  return (
    <div className="confirmacion" role="group" aria-label={pregunta}>
      <p>{pregunta}</p>
      {pedirTexto && (
        <div className="campo">
          <label htmlFor={`conf-${etiqueta}`}>{pedirTexto.etiqueta}</label>
          <textarea id={`conf-${etiqueta}`} value={texto} placeholder={pedirTexto.marcador} onChange={(e) => setTexto(e.target.value)} autoFocus />
        </div>
      )}
      {extra}
      <div className="acciones">
        <button
          type="button"
          className={`btn ${peligro ? 'btn-peligro' : 'btn-primario'}`}
          disabled={falta}
          onClick={() => {
            onConfirmar(texto);
            setAbierto(false);
            setTexto('');
          }}
        >
          {etiqueta}
        </button>
        <button type="button" className="btn btn-fantasma" onClick={() => setAbierto(false)}>
          {tr("Cancelar")}
        </button>
      </div>
    </div>
  );
}

export function AvisoMuestra({ conexion }: { conexion: EstadoConexion }) {
  if (conexion !== 'muestra') return null;
  return (
    <div className="aviso-muestra" role="status">
      <IconAlert size={14} />
      <span>
        {tr("Datos de muestra: ROSA2018 todavía no está conectada. La corrida que ves avanza con una simulación para poder juzgar la interfaz. Nada de lo que hagas aquí llega a un servidor.")}
      </span>
    </div>
  );
}

/** Barra de progreso fina con su fraccion y marcas opcionales. */
export function Barra({ fraccion, marcas = [], tono }: { fraccion: number; marcas?: number[]; tono?: 'ok' | 'aviso' | 'mal' }) {
  const pct = Math.max(0, Math.min(1, fraccion)) * 100;
  return (
    <div className={`presupuesto-barra ${tono ? `barra-${tono}` : ''}`} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
      {marcas.map((m) => (
        <b key={m} style={{ left: `${m * 100}%` }} />
      ))}
    </div>
  );
}

/** Descarga un texto como fichero. ROSA2018 es una app propia: las descargas
 *  funcionan; el nombre lleva la fecha para no pisar versiones. */
export function descargar(nombre: string, contenido: string, tipo = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/** Un bloque de ingenieria que no es una seccion (una rejilla de cifras, una
 *  tabla): en modo sencillo se sustituye por una linea de resumen con un
 *  boton para verlo; en modo detalle se ve entero. */
export function SoloDetalle({ resumen, children }: { resumen: ReactNode; children: ReactNode }) {
  const modo = useModo();
  const [ver, setVer] = useState(false);
  if (modo === 'detalle' || ver) return <>{children}</>;
  return (
    <p className="solo-detalle meta">
      {resumen}{' '}
      <button type="button" className="enlace" onClick={() => setVer(true)}>
        {tr("Ver detalle")}
      </button>
    </p>
  );
}
