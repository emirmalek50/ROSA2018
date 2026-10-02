// La conexión del correo real (Ajustes): el administrador guarda el proveedor
// y la clave, cualquiera con permiso manda una prueba, y abajo se lee el
// historial de envíos. Todo sale de GET /api/correo y vuelve por POST.
//
// Espera (estándar de Emir, 19 de septiembre de 2026): mientras llega la
// primera respuesta del servidor se pinta la silueta del formulario, los
// botones y el historial con aria-busy, en vez de la tarjeta a medias. La
// forma de la silueta (nueve campos por SMTP, seis por Resend, ninguno sin
// administración) se recuerda en el navegador de la última respuesta, para
// que mida lo que va a llegar; la primera vez se supone SMTP con
// administración, que es la instalación real. Los tres botones (guardar,
// prueba, desconectar) se enseñan en vuelo con `useEnVuelo`: spinner,
// aria-busy y sin admitir un segundo clic. El error de carga sigue saliendo
// como antes, en el párrafo de estado, también si el servidor no responde
// en 20 s (tope de tiempo).

import { useEffect, useState } from 'react';
import { cabeceras } from '../datos/almacen';
import { atributosEnVuelo, senalDeTope, useEnVuelo } from '../lib/diferido';
import { Cargando, Esqueleto, EsqueletoTexto } from './Esqueleto';
import { traducido, tr, trp } from '../lib/idioma';

type Configuracion = { remitente: string; url: string; hora: number; zona: string; proveedor: 'resend' | 'smtp'; smtpServidor: string; smtpPuerto: number; smtpUsuario: string };
type EstadoCorreo = Configuracion & {
  claveGuardada: boolean; configurado: boolean; administrador: boolean; error: string | null;
  historial: { id: string; tipo: string; destinatario: string; estado: string; creado: number; intentos: number; error: string | null }[];
};
const ETIQUETAS: Record<string, string> = traducido({ pendiente: 'En cola / reintentó', aceptado: 'Aceptado por el proveedor', fallido: 'No confirmado', cancelado: 'Cancelado' });

async function pedir(ruta = '', cuerpo?: object) {
  const r = await fetch(`/api/correo${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: cabeceras(), cache: 'no-store', ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}), ...senalDeTope() });
  const datos = await r.json();
  if (!r.ok) throw new Error(typeof datos.detail === 'string' ? datos.detail : tr('No se pudo conectar el correo'));
  return datos;
}

/** La forma que tendrá la tarjeta cuando responda el servidor: el formulario
 *  de administración por SMTP (nueve campos), por Resend (seis) o ninguno
 *  (quien no es administración solo ve los botones y el historial). */
export type FormaCorreo = 'smtp' | 'resend' | 'sin_admin';
const CLAVE_FORMA = 'rosa.correo.silueta.v1';

/** La forma recordada de la última respuesta; SMTP con administración si no
 *  hay nada guardado (la instalación real de ROSA2018). */
export function leerFormaCorreo(): FormaCorreo {
  try {
    const v = localStorage.getItem(CLAVE_FORMA);
    return v === 'resend' || v === 'sin_admin' ? v : 'smtp';
  } catch {
    return 'smtp';
  }
}
function guardarFormaCorreo(datos: Pick<EstadoCorreo, 'administrador' | 'proveedor'>) {
  try {
    localStorage.setItem(CLAVE_FORMA, datos.administrador ? (datos.proveedor === 'resend' ? 'resend' : 'smtp') : 'sin_admin');
  } catch {
    // Sin almacenamiento: la próxima vez se supone SMTP.
  }
}

/** Anchos de los rótulos de los nueve campos por SMTP (proveedor, servidor,
 *  puerto, usuario, remitente, clave, dirección web con su nota, hora, zona)
 *  y de los seis por Resend. */
const CAMPOS_SMTP = [24, 30, 52, 44, 56, 38, 60, 40, 22];
const CAMPOS_RESEND = [24, 56, 34, 60, 40, 22];

/** La silueta de la tarjeta mientras responde el servidor: los campos del
 *  formulario según la forma recordada (rótulo y entrada de 36 px, como
 *  .campo; el de la dirección web con su nota), el botón de guardar, la fila
 *  de botones, los dos párrafos, el título del historial y tres envíos. */
function EsqueletoCorreo({ forma }: { forma: FormaCorreo }) {
  const campos = forma === 'smtp' ? CAMPOS_SMTP : forma === 'resend' ? CAMPOS_RESEND : [];
  const indiceUrl = forma === 'smtp' ? 6 : 3;
  return (
    <Cargando
      activo
      rotulo={tr("la configuración del correo")}
      esqueleto={
        <div aria-hidden="true">
          {campos.map((ancho, i) => (
            <div key={i} className="campo">
              <Esqueleto alto={13} ancho={`${ancho}%`} />
              <Esqueleto alto={36} radio={6} />
              {i === indiceUrl && <Esqueleto alto={11} ancho="62%" />}
            </div>
          ))}
          {forma !== 'sin_admin' && <Esqueleto alto={34} ancho={150} radio={6} />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <Esqueleto alto={34} ancho={190} radio={6} />
            {forma !== 'sin_admin' && <Esqueleto alto={34} ancho={150} radio={6} />}
          </div>
          <EsqueletoTexto lineas={2} />
          <EsqueletoTexto lineas={2} />
          <Esqueleto alto={15} ancho={128} />
          <EsqueletoTexto lineas={1} ultimaCorta={false} />
          <EsqueletoTexto lineas={3} ultimaCorta={false} />
        </div>
      }
    >
      {null}
    </Cargando>
  );
}

export function Correo({ servidor }: { servidor: boolean }) {
  const [estado, setEstado] = useState<EstadoCorreo | null>(null);
  const [form, setForm] = useState<Configuracion | null>(null);
  const [clave, setClave] = useState('');
  const [mensaje, setMensaje] = useState('');
  // Un vuelo por botón, para que el spinner salga en el que se pulsó; mientras
  // cualquiera vuela, los tres y el formulario quedan bloqueados.
  const [guardando, envolverGuardar] = useEnVuelo();
  const [probando, envolverPrueba] = useEnVuelo();
  const [desconectando, envolverDesconectar] = useEnVuelo();
  const ocupado = guardando || probando || desconectando;
  useEffect(() => {
    if (!servidor) return;
    let vivo = true;
    const cargar = async () => {
      try {
        const datos: EstadoCorreo = await pedir();
        if (vivo) {
          guardarFormaCorreo(datos);
          setEstado(datos);
          setForm((anterior) => anterior ?? { remitente: datos.remitente, url: datos.url, hora: datos.hora, zona: datos.zona, proveedor: datos.proveedor ?? 'resend', smtpServidor: datos.smtpServidor ?? 'smtp.gmail.com', smtpPuerto: datos.smtpPuerto ?? 587, smtpUsuario: datos.smtpUsuario ?? '' });
        }
      } catch { if (vivo) setMensaje(tr('No se pudo cargar el servicio de correo. Comprueba que el backend está actualizado.')); }
    };
    void cargar();
    const intervalo = window.setInterval(() => void cargar(), 5000);
    return () => { vivo = false; window.clearInterval(intervalo); };
  }, [servidor]);
  async function ejecutar(ruta: string, datos: object, texto: string) {
    setMensaje('');
    try {
      await pedir(ruta, datos);
      setClave('');
      setEstado(await pedir());
      setMensaje(texto);
    } catch (e) { setMensaje(e instanceof Error ? e.message : tr('No se pudo completar la operación')); }
  }
  const guardar = envolverGuardar(() => (form ? ejecutar('/configuracion', { ...form, clave }, tr('Configuración guardada. Puedes enviar una prueba.')) : undefined));
  const probar = envolverPrueba(() => ejecutar('/prueba', {}, tr('Prueba en cola. El historial mostrará si el proveedor la acepta.')));
  const desconectar = envolverDesconectar(() => ejecutar('/configuracion', { borrarClave: true }, tr('Conexión eliminada y correos pendientes cancelados.')));
  if (!servidor) return <p>{tr("El correo real solo está disponible con el servidor conectado, no en el modo de muestra.")}</p>;
  return <div className="tarjeta seccion">
    <h3>{tr("Envío real por correo")}</h3>
    <p>{tr("Los avisos llegan a la cuenta que inició la corrida. El administrador conecta el correo una vez; la clave queda en el servidor, no en Convex. Dos opciones: la cuenta de Google Workspace del equipo por SMTP (con una contraseña de aplicación) o Resend (con dominio verificado).")}</p>
    <p><a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">{tr("Contraseña de aplicación de Google")}</a> · <a href="https://resend.com/domains" target="_blank" rel="noreferrer">{tr("Verificar dominio en Resend")}</a> · <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">{tr("Clave de Resend")}</a></p>
    {form && estado ? <>
      {estado.administrador && <form onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
        <fieldset disabled={ocupado} style={{ border: 0, padding: 0 }}>
          <div className="campo"><label htmlFor="correo-proveedor">{tr("Proveedor")}</label><select id="correo-proveedor" value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value as 'resend' | 'smtp' })}><option value="smtp">{tr("Google Workspace u otro servidor SMTP")}</option><option value="resend">Resend</option></select></div>
          {form.proveedor === 'smtp' && <>
            <div className="campo"><label htmlFor="correo-smtp-servidor">{tr("Servidor SMTP")}</label><input id="correo-smtp-servidor" required value={form.smtpServidor} onChange={(e) => setForm({ ...form, smtpServidor: e.target.value })} /></div>
            <div className="campo"><label htmlFor="correo-smtp-puerto">{tr("Puerto (587 con STARTTLS, 465 con TLS)")}</label><input id="correo-smtp-puerto" type="number" min={1} max={65535} required value={form.smtpPuerto} onChange={(e) => setForm({ ...form, smtpPuerto: Number(e.target.value) })} /></div>
            <div className="campo"><label htmlFor="correo-smtp-usuario">{tr("Usuario (la cuenta que envía)")}</label><input id="correo-smtp-usuario" type="email" required value={form.smtpUsuario} onChange={(e) => setForm({ ...form, smtpUsuario: e.target.value })} /></div>
          </>}
          <div className="campo"><label htmlFor="correo-remitente">{(form.proveedor === 'smtp' ? tr("Correo remitente (la misma cuenta o un alias suyo)") : tr("Correo remitente (dominio verificado en Resend)"))}</label><input id="correo-remitente" type="email" required value={form.remitente} onChange={(e) => setForm({ ...form, remitente: e.target.value })} placeholder="rosa@tu-dominio.com" /></div>
          <div className="campo"><label htmlFor="correo-clave">{(form.proveedor === 'smtp' ? trp("Contraseña de aplicación {v}", { v: estado.claveGuardada ? tr("(guardada; deja vacío para conservarla)") : "" }) : trp("Clave de Resend {v}", { v: estado.claveGuardada ? tr("(guardada; deja vacío para conservarla)") : "" }))}</label><input id="correo-clave" type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} /></div>
          <div className="campo"><label htmlFor="correo-url">{tr("Dirección web para abrir ROSA2018 desde el correo")}</label><input id="correo-url" type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /><small>{tr("Localhost solo funciona en el equipo que ejecuta ROSA2018. No incluyas tokens de acceso en esta URL.")}</small></div>
          <div className="campo"><label htmlFor="correo-hora">{tr("Hora del resumen diario (0 a 23)")}</label><input id="correo-hora" type="number" min={0} max={23} required value={form.hora} onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })} /></div>
          <div className="campo"><label htmlFor="correo-zona">{tr("Zona horaria")}</label><input id="correo-zona" required value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} /></div>
          <button className="btn" type="submit" {...atributosEnVuelo(guardando)}>{tr("Guardar conexión")}</button>
        </fieldset>
      </form>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button className="btn" type="button" disabled={ocupado || !estado.configurado} {...atributosEnVuelo(probando)} onClick={() => void probar()}>{tr("Enviar correo de prueba")}</button>
        {estado.administrador && <button className="btn btn-fantasma" type="button" disabled={ocupado || !estado.claveGuardada} {...atributosEnVuelo(desconectando)} onClick={() => void desconectar()}>{tr("Desconectar correo")}</button>}
      </div>
      <p>{tr("La prueba envía un correo aunque los avisos automáticos estén apagados. No consume tokens; el proveedor de correo puede cobrar por los envíos. ROSA2018 debe permanecer encendida.")}</p>
      <p>{tr("Solo se envían contadores y un enlace, sin títulos, documentos ni datos clínicos. Los avisos empiezan con las novedades, sin reenviar todo el historial.")}</p>
      <h4>{tr("Últimos envíos")}</h4>
      <p>{tr("Aceptado por el proveedor no confirma llegada al buzón. Consulta entregas o rebotes en el panel del proveedor o en el buzón remitente.")}</p>
      {estado.historial.length === 0 ? <p>{tr("Todavía no hay envíos.")}</p> : <ul>{estado.historial.map((x) => <li key={x.id}>
        {new Date(x.creado * 1000).toLocaleString()} · {x.destinatario} · {ETIQUETAS[x.estado] ?? x.estado} · {x.intentos} {tr("intento(s)")}{x.error && <p>{x.error}</p>}
      </li>)}</ul>}
      {estado.error && <p role="alert">{estado.error}</p>}
    </> : mensaje === '' ? <EsqueletoCorreo forma={leerFormaCorreo()} /> : null}
    <p role="status">{mensaje}</p>
  </div>;
}
