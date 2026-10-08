import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cabeceras } from '../datos/almacen';
import { idiomaActual, useIdioma } from '../lib/idioma';
import { Chip, Seccion } from './piezas';

type Estado = { proveedor: 'serpapi'; configurada: boolean; origen: 'archivo' | 'entorno' | null; administrador: boolean };
type Prueba = { ok: boolean; detalle: string; consulta?: { consulta?: string; fecha?: string } };
type Operacion = 'cargar' | 'guardar' | 'borrar' | 'probar';
const texto = (es: string, en: string) => idiomaActual() === 'en' ? en : es;
const CONFIGURACION = '/api/patentes/configuracion';
const LIMITE_MS = 35_000;

function configuracion(valor: unknown): Estado | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  if (v.proveedor !== 'serpapi' || typeof v.configurada !== 'boolean' || typeof v.administrador !== 'boolean'
    || ![null, 'archivo', 'entorno'].includes(v.origen as string | null)) return null;
  // Solo se conserva el estado público del contrato, nunca una clave devuelta.
  return { proveedor: 'serpapi', configurada: v.configurada, origen: v.origen as Estado['origen'], administrador: v.administrador };
}

function resultadoPrueba(valor: unknown): Prueba | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  if (typeof v.ok !== 'boolean' || typeof v.detalle !== 'string') return null;
  const origen = v.consulta && typeof v.consulta === 'object' ? v.consulta as Record<string, unknown> : null;
  // Del registro de procedencia solo salen la consulta y su fecha públicas.
  const consulta = origen ? {
    ...(typeof origen.consulta === 'string' ? { consulta: origen.consulta } : {}),
    ...(typeof origen.fecha === 'string' ? { fecha: origen.fecha } : {}),
  } : typeof v.consulta === 'string' ? { consulta: v.consulta } : undefined;
  return { ok: v.ok, detalle: v.detalle, ...(consulta ? { consulta } : {}) };
}

export function ConfiguracionPatentes({ servidor = true }: { servidor?: boolean }) {
  useIdioma();
  const id = useId();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [clave, setClave] = useState('');
  const [trabajo, setTrabajo] = useState<Operacion | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const actual = useRef<AbortController | null>(null);

  const ejecutar = useCallback(async (operacion: Operacion, cuerpo?: { clave: string } | { borrarClave: true }) => {
    if (actual.current) return;
    const control = new AbortController();
    actual.current = control;
    setTrabajo(operacion); setMensaje('');
    if (operacion !== 'cargar') setPrueba(null);
    const temporizador = setTimeout(() => control.abort(), LIMITE_MS);
    try {
      const r = await fetch(operacion === 'probar' ? '/api/patentes/prueba' : CONFIGURACION, {
        method: operacion === 'cargar' ? 'GET' : 'POST', headers: cabeceras(), credentials: 'same-origin', cache: 'no-store',
        signal: control.signal, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
      if (actual.current !== control) return;
      if (!r.ok) {
        // Un error del proveedor podría repetir credenciales. No se muestra su cuerpo.
        if (r.status === 401 || r.status === 403) {
          setEstado(previo => previo ? { ...previo, administrador: false } : null);
          setClave('');
          throw new Error('permiso');
        }
        throw new Error('http');
      }
      const datos: unknown = await r.json();
      if (actual.current !== control) return;
      if (operacion === 'probar') {
        const resultado = resultadoPrueba(datos);
        if (!resultado) throw new Error('formato');
        setPrueba(resultado);
      } else {
        const siguiente = configuracion(datos);
        if (!siguiente) throw new Error('formato');
        setEstado(siguiente);
        if (operacion === 'guardar') setMensaje(texto('Configuración guardada. El acceso todavía no está comprobado.', 'Configuration saved. Access has not been checked yet.'));
        if (operacion === 'borrar') setMensaje(siguiente.configurada
          ? texto('La clave del archivo se eliminó; sigue activa la configuración del servidor.', 'The saved key was removed; server configuration remains active.')
          : texto('SerpApi desconectado. Las búsquedas de patentes quedan sin comprobar.', 'SerpApi disconnected. Patent searches remain unchecked.'));
      }
    } catch (error) {
      if (actual.current !== control) return;
      const permiso = error instanceof Error && error.message === 'permiso';
      setMensaje(control.signal.aborted
        ? texto('No pude comprobar el resultado en 35 segundos. Vuelve a consultar el estado antes de repetir la operación.', 'The result could not be checked within 35 seconds. Refresh the status before repeating the operation.')
        : permiso ? texto('La sesión no permite esta operación. Comprueba tu acceso de administración.', 'This session does not permit this operation. Check your administrator access.')
          : texto('No pude comprobar la respuesta del servidor. No se confirma el guardado ni el acceso a patentes.', 'The server response could not be checked. Saving and patent access are not confirmed.'));
    } finally {
      clearTimeout(temporizador);
      if (actual.current === control) { actual.current = null; setTrabajo(null); }
    }
  }, []);

  useEffect(() => {
    if (servidor) void ejecutar('cargar');
    else { setClave(''); setEstado(null); setTrabajo(null); setPrueba(null); }
    return () => {
      const control = actual.current;
      actual.current = null;
      control?.abort();
    };
  }, [servidor, ejecutar]);

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (!estado?.administrador || !clave.trim() || actual.current) return;
    const secreta = clave.trim();
    setClave('');
    void ejecutar('guardar', { clave: secreta });
  };
  const ocupado = trabajo !== null;

  return <Seccion titulo={texto('Google Patents mediante SerpApi', 'Google Patents through SerpApi')}>
    <div className="tarjeta seccion" aria-busy={ocupado || undefined}>
      <p>{texto('SerpApi es el intermediario que ROSA utiliza para consultar Google Patents. Requiere una clave de tu cuenta de SerpApi.', 'SerpApi is the intermediary ROSA uses to query Google Patents. It requires a key from your SerpApi account.')}</p>
      <p><a className="enlace" href="https://serpapi.com/google-patents-api" target="_blank" rel="noopener noreferrer">{texto('Documentación de Google Patents API de SerpApi', 'SerpApi Google Patents API documentation')}</a></p>
      {!servidor ? <p role="status">{texto('Esta configuración requiere conexión con el servidor de ROSA.', 'This configuration requires a connection to the ROSA server.')}</p>
        : <>
          <div className="acciones">
            <Chip tono={prueba?.ok ? 'ok' : 'borde'}>{prueba?.ok ? texto('Acceso comprobado en esta sesión', 'Access checked in this session')
              : estado?.configurada ? texto('Clave configurada; acceso no comprobado', 'Key configured; access not checked')
                : trabajo === 'cargar' ? texto('Consultando configuración…', 'Loading configuration…') : texto('No comprobado', 'Not checked')}</Chip>
            <button className="btn btn-s" type="button" disabled={ocupado} onClick={() => { setPrueba(null); void ejecutar('cargar'); }}>{texto('Actualizar estado', 'Refresh status')}</button>
          </div>
          {estado && <>
            {!estado.configurada && <p>{texto('Falta la clave de SerpApi. La revisión de Google Patents queda como «No comprobado»; no significa que no haya patentes.', 'The SerpApi key is missing. Google Patents review remains “Not checked”; this does not mean there are no patents.')}</p>}
            {estado.configurada && <p className="meta">{estado.origen === 'archivo' ? texto('Origen: archivo protegido del servidor.', 'Source: protected server file.') : estado.origen === 'entorno' ? texto('Origen: configuración del servidor.', 'Source: server configuration.') : texto('Origen de la clave no registrado.', 'Key source not recorded.')}</p>}
            <p className="meta">{texto('Una clave guardada no equivale a acceso verificado. La prueba realiza una consulta real y puede consumir cuota o generar cargos según tu cuenta de SerpApi.', 'A saved key does not mean access is verified. Testing sends one real query and may consume quota or incur charges according to your SerpApi account.')}</p>
            {estado.administrador ? <>
              <form onSubmit={guardar}>
                <div className="campo">
                  <label htmlFor={`${id}-clave`}>{texto('Clave API de SerpApi', 'SerpApi API key')}</label>
                  <input id={`${id}-clave`} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={clave} onChange={e => setClave(e.target.value)} disabled={ocupado} />
                  <small>{texto('Se guarda en el servidor. El formulario se vacía al enviarla.', 'Stored on the server. The form clears when the key is submitted.')}</small>
                </div>
                <div className="acciones">
                  <button className="btn btn-primario btn-s" type="submit" disabled={ocupado || !clave.trim()} aria-busy={trabajo === 'guardar' || undefined}>{trabajo === 'guardar' ? texto('Guardando…', 'Saving…') : texto('Guardar clave', 'Save key')}</button>
                  <button className="btn btn-s" type="button" disabled={ocupado || !estado.configurada} aria-busy={trabajo === 'probar' || undefined} onClick={() => { if (estado.administrador) void ejecutar('probar'); }}>{trabajo === 'probar' ? texto('Comprobando acceso…', 'Checking access…') : texto('Probar acceso', 'Test access')}</button>
                  <button className="btn btn-s" type="button" disabled={ocupado || !estado.configurada} aria-busy={trabajo === 'borrar' || undefined} onClick={() => { if (estado.administrador) { setClave(''); void ejecutar('borrar', { borrarClave: true }); } }}>{trabajo === 'borrar' ? texto('Desconectando…', 'Disconnecting…') : texto('Desconectar', 'Disconnect')}</button>
                </div>
              </form>
            </> : <p>{texto('Solo una persona administradora puede guardar la clave, probar el acceso o desconectar SerpApi.', 'Only an administrator can save the key, test access or disconnect SerpApi.')}</p>}
          </>}
          {mensaje && <p role="status">{mensaje}</p>}
          {prueba && <div role="status">
            <p><strong>{prueba.ok ? texto('Google Patents respondió a la consulta de prueba.', 'Google Patents responded to the test query.') : texto('Acceso no comprobado.', 'Access not verified.')}</strong>{!prueba.ok && <> {idiomaActual() === 'es' ? prueba.detalle : 'Google Patents access could not be verified. Check the saved key and your SerpApi account, then try again.'}</>}</p>
            {prueba.consulta?.consulta && <p className="meta">{texto('Consulta de prueba: ', 'Test query: ')}<span data-sin-traducir>{prueba.consulta.consulta}</span></p>}
            {prueba.consulta?.fecha && <p className="meta">{texto('Fecha de la consulta: ', 'Query date: ')}<time dateTime={prueba.consulta.fecha} data-sin-traducir>{prueba.consulta.fecha}</time></p>}
          </div>}
        </>}
    </div>
  </Seccion>;
}
