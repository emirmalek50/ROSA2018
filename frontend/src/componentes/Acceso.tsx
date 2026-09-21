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

type Sesion = {
  correo: string | null;
  administrador: boolean;
  correoConfigurado: boolean;
  instalacionLocal: boolean;
  avisoInstalacion?: string | null;
};
/** Lo que la interfaz sabe de la persona que ha entrado: su correo y si
 *  administra esta instalación. Lo lee la sección "Sesión" de Ajustes. */
export type SesionActual = { correo: string; administrador: boolean };
const Cuenta = createContext<SesionActual | null>(null);

export function useSesion(): SesionActual | null {
  return useContext(Cuenta);
}

const DOMINIO = 'alzheimerproject.com';

async function api(ruta: string, datos?: object) {
  const r = await fetch(`/api/acceso/${ruta}`, {
    method: datos ? 'POST' : 'GET',
    headers: cabeceras(),
    cache: 'no-store',
    ...(datos ? { body: JSON.stringify(datos) } : {}),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(typeof json.detail === 'string' ? json.detail : 'No se pudo completar el acceso');
  return json;
}

/** El bloque de sesión: el correo, si la cuenta administra la instalación y
 *  el botón de salir. Vive en la sección "Sesión" de Ajustes. Salir llama a
 *  /api/acceso/salir y recarga en la raíz, que vuelve a la puerta de acceso. */
export function CuentaActual() {
  const sesion = useSesion();
  const [error, setError] = useState('');
  if (!sesion) return null;
  return (
    <div className="cuenta-actual">
      <strong>{sesion.correo}</strong>
      <small>{sesion.administrador ? 'Cuenta administradora: puede conectar el correo de esta instalación.' : 'Cuenta del equipo, sin permisos de administración.'}</small>
      <button
        type="button"
        className="btn btn-fantasma btn-s"
        onClick={async () => {
          try {
            await api('salir', {});
            window.location.assign('/');
          } catch {
            setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');
          }
        }}
      >
        Cerrar sesión
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
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const conectado = useRef(false);
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
          await conectar(false);
          conectado.current = true;
        }
        if (vivo) setSesion(s);
      } catch {
        if (vivo) setMensaje('No se puede conectar con ROSA2018. Comprueba que el servidor está encendido y recarga esta página.');
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
    try {
      await api('entrar', { correo, contrasena });
      window.location.assign('/');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setOcupado(false);
    }
  }
  if (sesion?.correo) return <Cuenta.Provider value={{ correo: sesion.correo, administrador: Boolean(sesion.administrador) }}>{children}</Cuenta.Provider>;
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
      <section className="acceso-identidad" aria-label="Alzheimer Project">
        <div className="acceso-identidad-marca">
          <img src="/arbol-marca.png" width={56} height={56} alt="Árbol de Alzheimer Project" />
          <p>Alzheimer Project</p>
        </div>
        <h1>
          Una investigación.
          <br />
          Conocimiento que crece.
        </h1>
        <p className="acceso-descripcion">ROSA2018 lee, verifica y propone. Tu equipo decide el siguiente paso, y cada decisión queda con su procedencia.</p>
        <ArbolVivo />
      </section>

      <section className="acceso-lado" aria-label="Acceso a ROSA2018">
        <motion.div className="acceso-tarjeta" initial={entrada} animate={{ opacity: 1, y: 0 }} transition={transicion}>
          <div className="acceso-marca">
            ROSA2018
          </div>

          <motion.div key="formulario" initial={entrada} animate={{ opacity: 1, y: 0 }} transition={transicion}>
            <h2>Continúa tu investigación</h2>
            <p>Inicia sesión con tu cuenta de Alzheimer Project.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void entrar();
              }}
            >
              <label htmlFor="acceso-correo">Correo de Alzheimer Project</label>
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
                  title="Usa tu cuenta @alzheimerproject.com"
                  placeholder={`tu.nombre@${DOMINIO}`}
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                />
              </div>
              <label htmlFor="acceso-contrasena">Contraseña</label>
              <input
                id="acceso-contrasena"
                type="password"
                autoComplete="current-password"
                required
                minLength={1}
                maxLength={256}
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
              <button className="btn acceso-continuar" disabled={ocupado}>
                {ocupado ? 'Iniciando sesión…' : 'Iniciar sesión'}
                {!ocupado && <IconoFlecha />}
              </button>
            </form>
            <p className="acceso-privacidad">
              Acceso exclusivo para <span className="acceso-dominio">@{DOMINIO}</span>. Los avisos de tus corridas llegarán a esta misma cuenta.
            </p>
          </motion.div>

          <p role="status" className={`acceso-mensaje ${mensaje ? 'acceso-mensaje-error' : 'acceso-mensaje-vacio'}`}>
            {mensaje}
          </p>
          {sesion?.avisoInstalacion && (
            <p role="status" className="acceso-mensaje acceso-mensaje-aviso">
              {sesion.avisoInstalacion}
            </p>
          )}
        </motion.div>
        <p className="acceso-pie">ROSA2018 investiga; la persona decide.</p>
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
      <summary>Configurar correo de esta instalación</summary>
      <p>Disponible solo en el equipo de ROSA2018, antes de registrar la primera cuenta. Esa primera cuenta verificada administrará la conexión de correo.</p>
      <div className="acceso-opciones acceso-opciones-proveedor" role="group" aria-label="Proveedor de correo">
        <button type="button" aria-pressed={smtp} onClick={() => setProveedor('smtp')}>
          <span>Google Workspace</span>
        </button>
        <button type="button" aria-pressed={!smtp} onClick={() => setProveedor('resend')}>
          <span>Resend</span>
        </button>
      </div>
      {smtp ? (
        <p>
          Sale desde el buzón corporativo que ya existe, sin registrar nada en un tercero. Hace falta una{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            contraseña de aplicación
          </a>{' '}
          de esa cuenta de Google (requiere verificación en dos pasos), no la contraseña normal. No la pegues en el chat.
        </p>
      ) : (
        <p>
          Crea una cuenta en{' '}
          <a href="https://resend.com" target="_blank" rel="noreferrer">
            Resend
          </a>
          , verifica tu dominio y genera una clave con permiso de envío. No pegues la clave en el chat.
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
            setMensaje('Conexión guardada. Solicita tu enlace con el formulario de arriba.');
          } catch (error) {
            setMensaje(error instanceof Error ? error.message : 'No se pudo guardar');
          } finally {
            setOcupado(false);
          }
        }}
      >
        {smtp ? (
          <>
            <label htmlFor="instalacion-usuario">Cuenta de Google Workspace (usuario y remitente)</label>
            <input id="instalacion-usuario" type="email" required placeholder="tu.nombre@alzheimerproject.com" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
            <label htmlFor="instalacion-clave">Contraseña de aplicación (16 letras)</label>
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
            <label htmlFor="instalacion-remitente">Remitente verificado en Resend</label>
            <input id="instalacion-remitente" type="email" required value={remitente} onChange={(e) => setRemitente(e.target.value)} />
            <label htmlFor="instalacion-clave">Clave privada de envío</label>
            <input id="instalacion-clave" type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
          </>
        )}
        <label htmlFor="instalacion-url">Dirección web de ROSA2018</label>
        <input id="instalacion-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        <small>Localhost sirve solo en este equipo. Para acceso desde otros equipos necesitas un despliegue HTTPS.</small>
        <button className="btn" disabled={ocupado}>
          Guardar conexión
        </button>
      </form>
      <p role="status">{mensaje}</p>
    </details>
  );
}
