// La puerta de ROSA2018. A la izquierda, el árbol vivo cuenta qué hace ROSA2018
// mientras se ilumina etapa a etapa; a la derecha, una tarjeta tranquila con
// dos campos: correo corporativo y contraseña. La lógica (estado de sesión,
// entrada, salida y configuración de la instalación) es la de Codex; aquí se
// rehízo la presentación (14 de septiembre de 2026, a petición de Emir: "está
// súper feo y genérico").

import { motion } from 'motion/react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cabeceras, conectar } from '../datos/almacen';
import { useMovimientoReducido } from '../lib/movimiento';
import { ArbolVivo } from './ArbolVivo';
import { EsqueletoAplicacion } from './Esqueleto';
import './acceso.css';
import { tr } from '../lib/idioma';

type Sesion = {
  correo: string | null;
  administrador: boolean;
  correoConfigurado: boolean;
  instalacionLocal: boolean;
  avisoInstalacion?: string | null;
  /** Cuántas cuentas del equipo esperan aprobación (solo para la administradora). */
  solicitudesPendientes?: number;
};

/** Una cuenta del equipo tal como la ve la administradora. */
type CuentaEquipo = { correo: string; estado: 'pendiente' | 'activa' | 'rechazada'; creada: number; aprobadaPor: string | null; aprobadaEn: number | null };
/** Lo que la interfaz sabe de la persona que ha entrado: su correo y si
 *  administra esta instalación. Lo lee la sección "Sesión" de Ajustes. */
export type SesionActual = { correo: string; administrador: boolean; solicitudesPendientes: number };
const Cuenta = createContext<SesionActual | null>(null);

export function useSesion(): SesionActual | null {
  return useContext(Cuenta);
}

const DOMINIO = 'alzheimerproject.com';

/** Cuánto se espera a ROSA2018 antes de decir que no respondió. Sin tope, un
 *  enlace que no llega al servidor dejaba el botón en "Enviando…" para siempre
 *  (25 de septiembre de 2026, el primer registro por el túnel de VS Code). */
export const ESPERA_ACCESO_MS = 20000;

async function api(ruta: string, datos?: object) {
  const control = new AbortController();
  const reloj = window.setTimeout(() => control.abort(), ESPERA_ACCESO_MS);
  let r: Response;
  try {
    r = await fetch(`/api/acceso/${ruta}`, {
      method: datos ? 'POST' : 'GET',
      headers: cabeceras(),
      cache: 'no-store',
      signal: control.signal,
      ...(datos ? { body: JSON.stringify(datos) } : {}),
    });
  } catch {
    throw new Error(
      control.signal.aborted
        ? `ROSA2018 no respondió en ${ESPERA_ACCESO_MS / 1000} segundos. Recarga la página y vuelve a intentarlo; si sigue igual, puede que tu red bloquee este enlace.`
        : tr('No se pudo conectar con ROSA2018. Comprueba que el enlace es el correcto y que el equipo que lo comparte está encendido.'),
    );
  } finally {
    window.clearTimeout(reloj);
  }
  let json;
  try {
    json = await r.json();
  } catch {
    // Una página que no es de ROSA2018: el aviso de seguridad del túnel, un error
    // del proxy o un enlace caducado. No se enseña el error técnico del navegador.
    throw new Error(tr('El enlace no devolvió una respuesta de ROSA2018. Recarga la página; si ves un aviso de seguridad del túnel, acéptalo y vuelve a intentarlo.'));
  }
  if (!r.ok) throw new Error(typeof json.detail === 'string' ? json.detail : tr('No se pudo completar el acceso'));
  return json;
}

/** El bloque de sesión: el correo, si la cuenta administra la instalación y
 *  el botón de salir. Vive en la sección "Sesión" de Ajustes. Salir llama a
 *  /api/acceso/salir y recarga en la raíz, que vuelve a la puerta de acceso. */
/** Las cuentas del equipo que piden acceso, con los botones de aprobar y rechazar.
 *  Solo lo ve la cuenta administradora. Aprobar sin preguntar a la persona
 *  deja entrar a quien haya escrito su correo antes que ella. */
export function CuentasDelEquipo() {
  const sesion = useSesion();
  const [cuentas, setCuentas] = useState<CuentaEquipo[] | null>(null);
  const [error, setError] = useState('');
  const [ocupada, setOcupada] = useState<string | null>(null);
  useEffect(() => {
    if (!sesion?.administrador) return;
    let vivo = true;
    api('solicitudes')
      .then((r: { cuentas: CuentaEquipo[] }) => vivo && setCuentas(r.cuentas))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : tr('No se pudieron leer las cuentas')));
    return () => {
      vivo = false;
    };
  }, [sesion?.administrador]);
  if (!sesion?.administrador) return null;
  async function decidir(correo: string, estado: 'activa' | 'rechazada') {
    setOcupada(correo);
    setError('');
    try {
      const r: { cuentas: CuentaEquipo[] } = await api('decidir', { correo, estado });
      setCuentas(r.cuentas);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('No se pudo guardar'));
    } finally {
      setOcupada(null);
    }
  }
  const pendientes = (cuentas ?? []).filter((c) => c.estado === 'pendiente');
  const resto = (cuentas ?? []).filter((c) => c.estado !== 'pendiente');
  return (
    <div className="cuentas-equipo">
      <h4>{tr("Cuentas del equipo")}</h4>
      <p className="meta">{tr("Cualquier persona con correo @")}{DOMINIO} {tr("puede pedir cuenta desde la pantalla de acceso. Aprueba solo si sabes que esa persona la pidió: si no, entraría quien haya escrito su correo.")}</p>
      {cuentas === null && !error && <p className="meta">Cargando…</p>}
      {cuentas !== null && pendientes.length === 0 && <p className="meta">Ninguna solicitud pendiente.</p>}
      {pendientes.length > 0 && (
        <ul className="cuentas-lista">
          {pendientes.map((c) => (
            <li key={c.correo}>
              <span>
                <strong>{c.correo}</strong> <small>pidió acceso el {new Date(c.creada).toLocaleString('es-DO')}</small>
              </span>
              <span className="acciones">
                <button type="button" className="btn btn-s" disabled={ocupada === c.correo} onClick={() => void decidir(c.correo, 'activa')}>
                  Aprobar
                </button>
                <button type="button" className="btn btn-fantasma btn-s" disabled={ocupada === c.correo} onClick={() => void decidir(c.correo, 'rechazada')}>
                  Rechazar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {resto.length > 0 && (
        <details>
          <summary>{resto.length} {resto.length === 1 ? tr('cuenta decidida') : tr('cuentas decididas')}</summary>
          <ul className="cuentas-lista">
            {resto.map((c) => (
              <li key={c.correo}>
                <span>
                  <strong>{c.correo}</strong> <small>{c.estado === 'activa' ? tr('con acceso') : 'rechazada'}{c.aprobadaPor ? ` por ${c.aprobadaPor}` : ''}</small>
                </span>
                {c.estado === 'activa' && (
                  <button type="button" className="btn btn-fantasma btn-s" disabled={ocupada === c.correo} onClick={() => void decidir(c.correo, 'rechazada')}>
                    Quitar acceso
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function CuentaActual() {
  const sesion = useSesion();
  const [error, setError] = useState('');
  if (!sesion) return null;
  return (
    <div className="cuenta-actual">
      <strong>{sesion.correo}</strong>
      <small>{sesion.administrador ? tr('Cuenta administradora: puede conectar el correo de esta instalación.') : tr('Cuenta del equipo, sin permisos de administración.')}</small>
      <button
        type="button"
        className="btn btn-fantasma btn-s"
        onClick={async () => {
          try {
            await api('salir', {});
            window.location.assign('/');
          } catch {
            setError(tr('No se pudo cerrar la sesión. Inténtalo de nuevo.'));
          }
        }}
      >
        {tr("Cerrar sesión")}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/* Iconos pequeños, en línea, para no depender de la hoja de iconos general. */
function IconoSobre() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

function IconoFlecha() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Acceso({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [modo, setModo] = useState<'entrar' | 'registrar'>('entrar');
  const [aviso, setAviso] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const conectado = useRef(false);
  // La carga inicial en curso: la comprobación de sesión se repite cada 30
  // segundos, y por un enlace lento la carga puede tardar más; sin esto se
  // lanzaban dos descargas del estado a la vez.
  const conectando = useRef<Promise<unknown> | null>(null);
  const reducido = useMovimientoReducido();
  useEffect(() => {
    // Los enlaces antiguos dejan de ser una vía de acceso y no quedan en URL.
    if (window.location.hash.startsWith('#acceso=')) window.history.replaceState(null, '', window.location.pathname);
    let vivo = true;
    const cargar = async () => {
      try {
        const s: Sesion = await api('estado');
        if (!vivo) return;
        if (conectado.current && !s.correo) {
          window.location.assign('/');
          return;
        }
        if (s.correo && !conectado.current) {
          if (!conectando.current) {
            conectando.current = conectar(false).finally(() => {
              conectando.current = null;
            });
          }
          await conectando.current;
          conectado.current = true;
        }
        if (vivo) setSesion(s);
      } catch {
        if (vivo) setMensaje(tr('No se puede conectar con ROSA2018. Comprueba que el servidor está encendido y recarga esta página.'));
      }
    };
    void cargar();
    const intervalo = window.setInterval(() => void cargar(), 30000);
    return () => {
      vivo = false;
      window.clearInterval(intervalo);
    };
  }, []);

  async function entrar() {
    setOcupado(true);
    setMensaje('');
    setAviso('');
    try {
      await api('entrar', { correo, contrasena });
      window.location.assign('/');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : tr('No se pudo iniciar sesión'));
    } finally {
      setOcupado(false);
    }
  }

  async function registrar() {
    setMensaje('');
    setAviso('');
    if (contrasena !== repetida) {
      setMensaje(tr('Las dos contraseñas no coinciden.'));
      return;
    }
    setOcupado(true);
    try {
      const r: { mensaje: string } = await api('registrar', { correo, contrasena });
      setAviso(r.mensaje);
      setModo('entrar');
      setContrasena('');
      setRepetida('');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : tr('No se pudo enviar la solicitud'));
    } finally {
      setOcupado(false);
    }
  }
  const registrando = modo === 'registrar';
  if (sesion?.correo) return <Cuenta.Provider value={{ correo: sesion.correo, administrador: Boolean(sesion.administrador), solicitudesPendientes: sesion.solicitudesPendientes ?? 0 }}>{children}</Cuenta.Provider>;
  // Una sesión todavía desconocida no equivale a haber cerrado sesión.
  // No montar el formulario ni datos privados mientras se valida el acceso.
  if (!sesion) {
    if (mensaje) {
      return (
        <main className="contenido">
          <p role="status">{mensaje}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Reintentar</button>
        </main>
      );
    }
    // Mientras llega el estado se pinta la maqueta entera en gris (barra
    // lateral, cabecera y contenido), no una página vacía con un texto. El
    // rótulo "Cargando ROSA2018" sigue ahí, oculto, para los lectores de pantalla.
    return <EsqueletoAplicacion rotulo="ROSA2018" />;
  }

  const transicion = {
    duration: reducido ? 0.12 : 0.26,
    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  };
  const entrada = reducido ? { opacity: 0 } : { opacity: 0, y: 10 };

  return (
    <main className="acceso">
      <section className="acceso-identidad" aria-label={tr("Alzheimer Project")}>
        <div className="acceso-identidad-marca">
          <img src="/arbol-marca.png" width={56} height={56} alt={tr("Árbol de Alzheimer Project")} />
          <p>Alzheimer Project</p>
        </div>
        <h1>
          {tr("Una investigación.")}
          <br />
          {tr("Conocimiento que crece.")}
        </h1>
        <p className="acceso-descripcion">{tr("ROSA2018 lee, verifica y propone. Tu equipo decide el siguiente paso, y cada decisión queda con su procedencia.")}</p>
        <ArbolVivo />
      </section>

      <section className="acceso-lado" aria-label={tr("Acceso a ROSA2018")}>
        <motion.div className="acceso-tarjeta" initial={entrada} animate={{ opacity: 1, y: 0 }} transition={transicion}>
          <div className="acceso-marca">
            ROSA2018
          </div>

          <motion.div key="formulario" initial={entrada} animate={{ opacity: 1, y: 0 }} transition={transicion}>
            <h2>{registrando ? tr('Pide tu cuenta') : tr('Continúa tu investigación')}</h2>
            <p>{registrando ? tr('Con tu correo de Alzheimer Project. Quien administra ROSA2018 la aprobará.') : tr('Inicia sesión con tu cuenta de Alzheimer Project.')}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void (registrando ? registrar() : entrar());
              }}
            >
              <label htmlFor="acceso-correo">{tr("Correo de Alzheimer Project")}</label>
              <div className={`acceso-campo ${correo && !correo.toLowerCase().endsWith(`@${DOMINIO}`) ? 'acceso-campo-fuera' : ''}`}>
                <span className="acceso-campo-icono" aria-hidden="true">
                  <IconoSobre />
                </span>
                <input
                  id="acceso-correo"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={200}
                  pattern="[^@\s]+@[aA][lL][zZ][hH][eE][iI][mM][eE][rR][pP][rR][oO][jJ][eE][cC][tT]\.[cC][oO][mM]"
                  title={tr("Usa tu cuenta @alzheimerproject.com")}
                  placeholder={`tu.nombre@${DOMINIO}`}
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                />
              </div>
              <label htmlFor="acceso-contrasena">{registrando ? tr('Elige una contraseña (al menos 10 caracteres)') : tr('Contraseña')}</label>
              <input
                id="acceso-contrasena"
                type="password"
                autoComplete={registrando ? 'new-password' : 'current-password'}
                required
                minLength={registrando ? 10 : 1}
                maxLength={256}
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
              {registrando && (
                <>
                  <label htmlFor="acceso-repetida">{tr("Repítela")}</label>
                  <input id="acceso-repetida" type="password" autoComplete="new-password" required minLength={10} maxLength={256} value={repetida} onChange={(e) => setRepetida(e.target.value)} />
                </>
              )}
              <button className="btn acceso-continuar" disabled={ocupado}>
                {ocupado ? (registrando ? 'Enviando…' : tr('Iniciando sesión…')) : registrando ? tr('Pedir cuenta') : tr('Iniciar sesión')}
                {!ocupado && <IconoFlecha />}
              </button>
            </form>
            <button
              type="button"
              className="acceso-cambiar-modo"
              onClick={() => {
                setModo(registrando ? 'entrar' : 'registrar');
                setMensaje('');
                setAviso('');
              }}
            >
              {registrando ? tr('Ya tengo cuenta: iniciar sesión') : tr('¿No tienes cuenta? Pídela con tu correo del proyecto')}
            </button>
            <p className="acceso-privacidad">
              Acceso exclusivo para <span className="acceso-dominio">@{DOMINIO}</span>{tr(". Los avisos de tus corridas llegarán a esta misma cuenta.")}
            </p>
          </motion.div>

          <p role="status" className={`acceso-mensaje ${mensaje ? 'acceso-mensaje-error' : 'acceso-mensaje-vacio'}`}>
            {mensaje}
          </p>
          {aviso && (
            <p role="status" className="acceso-mensaje acceso-mensaje-aviso">
              {aviso}
            </p>
          )}
          {sesion?.avisoInstalacion && (
            <p role="status" className="acceso-mensaje acceso-mensaje-aviso">
              {sesion.avisoInstalacion}
            </p>
          )}
        </motion.div>
        <p className="acceso-pie">{tr("ROSA2018 investiga; la persona decide.")}</p>
      </section>
    </main>
  );
}

export function Instalacion({ onGuardar }: { onGuardar: () => Promise<void> }) {
  const [proveedor, setProveedor] = useState<'smtp' | 'resend'>('smtp');
  const [remitente, setRemitente] = useState('');
  const [clave, setClave] = useState('');
  const [servidor, setServidor] = useState('smtp.gmail.com');
  const [puerto, setPuerto] = useState('587');
  const [usuario, setUsuario] = useState('');
  const [url, setUrl] = useState(window.location.origin);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const smtp = proveedor === 'smtp';
  return (
    <details className="acceso-instalacion" open>
      <summary>{tr("Configurar correo de esta instalación")}</summary>
      <p>{tr("Disponible solo en el equipo de ROSA2018, antes de registrar la primera cuenta. Esa primera cuenta verificada administrará la conexión de correo.")}</p>
      <div className="acceso-opciones acceso-opciones-proveedor" role="group" aria-label={tr("Proveedor de correo")}>
        <button type="button" aria-pressed={smtp} onClick={() => setProveedor('smtp')}>
          <span>Google Workspace</span>
        </button>
        <button type="button" aria-pressed={!smtp} onClick={() => setProveedor('resend')}>
          <span>Resend</span>
        </button>
      </div>
      {smtp ? (
        <p>
          {tr("Sale desde el buzón corporativo que ya existe, sin registrar nada en un tercero. Hace falta una")}{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            {tr("contraseña de aplicación")}
          </a>{' '}
          {tr("de esa cuenta de Google (requiere verificación en dos pasos), no la contraseña normal. No la pegues en el chat.")}
        </p>
      ) : (
        <p>
          {tr("Crea una cuenta en")}{' '}
          <a href="https://resend.com" target="_blank" rel="noreferrer">
            Resend
          </a>
          {tr(", verifica tu dominio y genera una clave con permiso de envío. No pegues la clave en el chat.")}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setOcupado(true);
          setMensaje('');
          try {
            const datos = smtp
              ? { proveedor, remitente: remitente || usuario, clave, url, smtpServidor: servidor, smtpPuerto: Number(puerto), smtpUsuario: usuario }
              : { proveedor, remitente, clave, url };
            await api('configuracion', datos);
            setClave('');
            await onGuardar();
            setMensaje(tr('Conexión guardada. Solicita tu enlace con el formulario de arriba.'));
          } catch (error) {
            setMensaje(error instanceof Error ? error.message : tr('No se pudo guardar'));
          } finally {
            setOcupado(false);
          }
        }}
      >
        {smtp ? (
          <>
            <label htmlFor="instalacion-usuario">{tr("Cuenta de Google Workspace (usuario y remitente)")}</label>
            <input id="instalacion-usuario" type="email" required placeholder="tu.nombre@alzheimerproject.com" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
            <label htmlFor="instalacion-clave">{tr("Contraseña de aplicación (16 letras)")}</label>
            <input id="instalacion-clave" type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value.replace(/\s+/g, ''))} />
            <div className="acceso-instalacion-fila">
              <div>
                <label htmlFor="instalacion-servidor">Servidor SMTP</label>
                <input id="instalacion-servidor" required value={servidor} onChange={(e) => setServidor(e.target.value)} />
              </div>
              <div>
                <label htmlFor="instalacion-puerto">Puerto</label>
                <input id="instalacion-puerto" type="number" min={1} max={65535} required value={puerto} onChange={(e) => setPuerto(e.target.value)} />
              </div>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="instalacion-remitente">{tr("Remitente verificado en Resend")}</label>
            <input id="instalacion-remitente" type="email" required value={remitente} onChange={(e) => setRemitente(e.target.value)} />
            <label htmlFor="instalacion-clave">{tr("Clave privada de envío")}</label>
            <input id="instalacion-clave" type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
          </>
        )}
        <label htmlFor="instalacion-url">{tr("Dirección web de ROSA2018")}</label>
        <input id="instalacion-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        <small>{tr("Localhost sirve solo en este equipo. Para acceso desde otros equipos necesitas un despliegue HTTPS.")}</small>
        <button className="btn" disabled={ocupado}>
          {tr("Guardar conexión")}
        </button>
      </form>
      <p role="status">{mensaje}</p>
    </details>
  );
}
