// El almacen de ROSA2018: un solo estado, suscripciones, y las acciones que lo
// cambian. Las pantallas leen con `useRosa()` y escriben con `acciones`.
//
// Dos modos:
// - Servidor: al arrancar, `conectar()` pide `/api/estado`. Si responde, el
//   estado viene del servidor y se mantiene al dia por Server-Sent Events
//   (`/api/eventos`), que manda el estado completo en cada cambio. Cada
//   accion se aplica al instante en local con el reducer (acciones.ts) para
//   que la interfaz responda, y se envia al servidor por POST; el servidor
//   aplica la misma regla y su estado sustituye al local en cuanto llega.
// - Muestra: si el servidor no responde, el estado nace de la muestra
//   (muestra.ts) y avanza con la simulacion (simulacion.ts). Las pantallas
//   no distinguen un modo del otro salvo por `estado.conexion`.

import { useSyncExternalStore } from 'react';
import * as A from './acciones';
import { descargar } from '../componentes/piezas';
import type { CostesInvestigacion } from '../componentes/Rosa2018';
import { estadoDeMuestra } from './muestra';
import { iniciarSimulacion } from './simulacion';
import type { AlcancePermiso, Amplitud, AnclaComentario, Avisos, CampoEnmendable, CampoLecturaEnmendable, ClaseAccion, ClasificacionDatos, ConocimientoOperativo, Dataset, EstadoArea, EstadoEspejo, EstadoRosa, Investigacion, MetodoRegistrado, NivelAutonomia, NivelPermisoConector, ParadaCorrida, PasoPlan, PoliticaEsperas, PreguntaCampana, ProcedenciaDataset, RevisionHumana, TipoArtefacto } from './tipos';
import { senalDeTope } from '../lib/diferido';
import type { FichaCita, ListaCitas } from '../lib/citas';

const CLAVE_VISITA = 'rosa-ultima-visita';
const API = '/api';

/** Token de acceso opcional (solo cuando el servidor escucha fuera de la
 *  maquina). Llega en la URL (?token=...) una vez y se guarda en el navegador. */
function tokenAcceso(): string | null {
  try {
    const enUrl = new URLSearchParams(window.location.search).get('token');
    if (enUrl) {
      localStorage.setItem('rosaToken', enUrl);
      return enUrl;
    }
    return localStorage.getItem('rosaToken');
  } catch {
    return null;
  }
}

/** Cabeceras de toda escritura: X-Rosa marca que viene de la interfaz (una
 *  pagina ajena no puede mandarla sin que el navegador la bloquee) y el token
 *  si existe. */
export function cabeceras(json = true): Record<string, string> {
  const h: Record<string, string> = { 'X-Rosa': '1' };
  if (json) h['Content-Type'] = 'application/json';
  const t = tokenAcceso();
  if (t) h['X-Rosa-Token'] = t;
  return h;
}

function conToken(url: string): string {
  const t = tokenAcceso();
  return t ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url;
}

function leerVisita(): number | null {
  try {
    const v = localStorage.getItem(CLAVE_VISITA);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function estadoInicial(): EstadoRosa {
  const base = estadoDeMuestra();
  const visita = leerVisita();
  return visita !== null ? { ...base, ultimaVisita: visita } : base;
}
// Solo memoria de esta pestaña: no guardar investigaciones en almacenamiento
// persistente ni recuperar una sesión sin verificarla tras recargar la página.
import.meta.hot?.data?.retirarAlmacen?.();
const vivo: { estado: EstadoRosa; oyentes: Set<() => void>; version: number } = import.meta.hot?.data?.almacenVivo ?? {
  estado: estadoInicial(), oyentes: new Set<() => void>(), version: -1,
};
const oyentes = vivo.oyentes;
let modo: 'muestra' | 'servidor' = import.meta.hot?.data?.modoRosa ?? 'muestra';
let retirado = false;

function leer(): EstadoRosa {
  return vivo.estado;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

function notificar(): void {
  for (const o of oyentes) o();
}

/** Aplica un cambio puro. Si devuelve el mismo objeto, nadie se entera. */
export function aplicar(fn: (e: EstadoRosa) => EstadoRosa): void {
  const siguiente = fn(vivo.estado);
  if (siguiente === vivo.estado) return;
  vivo.estado = siguiente;
  notificar();
}

/** El estado completo, reactivo. Las pantallas derivan de aqui con useMemo. */
export function useRosa(): EstadoRosa {
  return useSyncExternalStore(suscribir, leer, leer);
}

/** Quien firma las revisiones. Cuando haya cuentas, sale de la sesion. */
export const QUIEN = 'la persona responsable';

export function modoActual(): 'muestra' | 'servidor' {
  return modo;
}

/* ---------------------------------------------------------------------
   Conexión con el servidor
   --------------------------------------------------------------------- */

/** Version del estado del servidor que ya se pinto (llega como `id` del
 *  evento SSE y como cabecera X-Rosa-Version en /estado). Sirve para no
 *  pisar un estado nuevo con la respuesta tardia de una peticion vieja. */

function recibirRemoto(remoto: EstadoRosa, version: number | null = null): void {
  if (retirado) return;
  if (version !== null && version < vivo.version) return;
  const visita = leerVisita();
  let siguiente: EstadoRosa = { ...remoto, conexion: 'en_linea', ultimaVisita: visita ?? remoto.ultimaVisita };
  // Las decisiones diferidas (aceptar, descartar, refinar) todavía no han
  // llegado al servidor: se vuelven a aplicar sobre su estado para que un
  // empuje SSE no las deshaga en pantalla mientras el aviso de "Deshacer"
  // sigue vivo, y también mientras el POST ya salió pero el servidor no ha
  // respondido (`enVuelo`): en ese hueco el bucle sigue empujando estados sin
  // la decisión. El reducer es puro y lleva su guarda de versión e
  // idempotencia: si la hipótesis cambió, o el servidor ya trae la decisión,
  // no toca nada.
  for (const reaplicar of [...pendientes.map((p) => p.reaplicar), ...enVuelo]) {
    try {
      siguiente = reaplicar(siguiente);
    } catch {
      // Un registro remoto raro no puede tumbar la recepción del estado.
    }
  }
  vivo.estado = siguiente;
  if (version !== null) vivo.version = version;
  notificar();
}

function versionDe(texto: string | null | undefined): number | null {
  if (texto === null || texto === undefined || texto === '') return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------
   Acciones diferidas con deshacer. Una decision con peso (aceptar, descartar,
   refinar una hipotesis) se aplica al instante en pantalla y viaja al
   servidor unos segundos despues; mientras, se puede deshacer. Si el estado
   cambio entre medias (llego algo por SSE), deshacer recarga del servidor en
   vez de restaurar una copia vieja.
   --------------------------------------------------------------------- */

export interface AccionPendiente {
  id: string;
  /** Sobre qué actúa (por ejemplo "revisarHipotesis:hip-1"): dos pendientes con
   *  la misma clave son la misma decisión repetida y solo cuenta la primera. */
  clave: string;
  etiqueta: string;
  hasta: number;
  ms: number;
  /** El reducer puro de la decisión, para reaplicarla sobre cada estado que
   *  llegue del servidor mientras esté pendiente. */
  reaplicar: (e: EstadoRosa) => EstadoRosa;
  enviar: () => void;
  deshacer: () => void;
}

let pendientes: AccionPendiente[] = [];
/** Reducers de decisiones cuyo POST ya salió y todavía no tiene respuesta:
 *  se siguen reaplicando sobre cada estado que llegue hasta que el servidor
 *  conteste, así la tarjeta no parpadea a "propuesta" en ese hueco. */
let enVuelo: ((e: EstadoRosa) => EstadoRosa)[] = [];
const oyentesPendientes = new Set<() => void>();

function avisarPendientes(): void {
  for (const o of oyentesPendientes) o();
}

export function useAccionesPendientes(): AccionPendiente[] {
  return useSyncExternalStore(
    (o) => {
      oyentesPendientes.add(o);
      return () => oyentesPendientes.delete(o);
    },
    () => pendientes,
    () => pendientes,
  );
}

export const MS_DESHACER = 6000;

let descargaVigilada = false;

/** Al cerrar o abandonar la pestaña (pagehide) o al pasar a segundo plano
 *  (visibilitychange a hidden, lo que en el móvil precede a que el navegador
 *  mate la página), las decisiones pendientes salen ya, con `keepalive` para
 *  que el navegador complete el POST aunque la página desaparezca. Sin esto
 *  una decisión tomada en los últimos 6 s antes de cerrar no quedaba en
 *  ningún sitio. Se registra una sola vez. */
function vigilarDescarga(): void {
  if (descargaVigilada || typeof window === 'undefined') return;
  descargaVigilada = true;
  window.addEventListener('pagehide', vaciarPendientes);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') vaciarPendientes();
  });
}

/** Envía ahora todas las decisiones pendientes (con keepalive) y vacía la cola. */
export function vaciarPendientes(): void {
  for (const p of [...pendientes]) p.enviar();
}

/** Aplica una decisión diferida: en pantalla al instante (por el reducer puro)
 *  y al servidor cuando pase el margen de deshacer. Si el reducer no cambia
 *  nada (la decisión ya está aplicada, o la hipótesis cambió de versión), no se
 *  programa ningún envío: así un doble clic no registra la decisión dos veces.
 *  `clave` identifica sobre qué actúa: si hay otra decisión pendiente con la
 *  misma clave (aceptar y, dentro del margen, reabrir o descartar), esa sale
 *  ya al servidor y la nueva se programa encima, en ese orden; antes la nueva
 *  se tiraba en silencio y "Reabrir" no hacía nada durante 6 s. */
function programar(clave: string, etiqueta: string, reductor: (e: EstadoRosa) => EstadoRosa, enviarServidor: (keepalive: boolean) => Promise<unknown> | void, ms = MS_DESHACER): boolean {
  const antes = vivo.estado;
  const despues = reductor(antes);
  if (despues === antes) return false;
  for (const p of pendientes.filter((x) => x.clave === clave)) p.enviar();
  vivo.estado = despues;
  notificar();
  vigilarDescarga();
  const id = `pend-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  let enviada = false;
  let timer = 0;
  const quitar = () => {
    pendientes = pendientes.filter((p) => p.id !== id);
    avisarPendientes();
  };
  const mandar = (keepalive: boolean) => {
    if (enviada) return;
    enviada = true;
    window.clearTimeout(timer);
    quitar();
    // Hasta que el servidor conteste, la decisión sigue reaplicándose sobre
    // los estados que lleguen; cuando conteste, el estado del servidor manda.
    enVuelo = [...enVuelo, reductor];
    const soltar = () => {
      enVuelo = enVuelo.filter((r) => r !== reductor);
    };
    try {
      const respuesta = enviarServidor(keepalive);
      if (respuesta && typeof (respuesta as Promise<unknown>).then === 'function') void (respuesta as Promise<unknown>).then(soltar, soltar);
      else soltar();
    } catch {
      soltar();
    }
  };
  timer = window.setTimeout(() => mandar(false), ms);
  pendientes = [
    ...pendientes,
    {
      id,
      clave,
      etiqueta,
      hasta: Date.now() + ms,
      ms,
      reaplicar: reductor,
      enviar: () => mandar(true),
      deshacer: () => {
        if (enviada) return;
        enviada = true;
        window.clearTimeout(timer);
        quitar();
        if (vivo.estado === despues) {
          vivo.estado = antes;
          notificar();
        } else {
          void resincronizar();
        }
      },
    },
  ];
  avisarPendientes();
  return true;
}

/* ---------------------------------------------------------------------
   Aviso de conflicto: una accion que el servidor rechazo o un dato que
   cambio mientras se revisaba. Se muestra en la cabecera hasta que se cierra.
   --------------------------------------------------------------------- */

export interface AvisoConflicto {
  texto: string;
  en: number;
  /** 'aviso' es un conflicto o rechazo; 'info' confirma algo que paso (una rama creada). */
  tono?: 'aviso' | 'info';
}

let avisoConflicto: AvisoConflicto | null = null;
const oyentesAviso = new Set<() => void>();

function fijarAviso(texto: string, tono: 'aviso' | 'info' = 'aviso'): void {
  avisoConflicto = { texto, en: Date.now(), tono };
  for (const o of oyentesAviso) o();
}

/** Un aviso informativo para la cabecera: confirma que algo paso y donde estas. */
export function avisar(texto: string): void {
  fijarAviso(texto, 'info');
}

export function cerrarAvisoConflicto(): void {
  if (avisoConflicto === null) return;
  avisoConflicto = null;
  for (const o of oyentesAviso) o();
}

export function useAvisoConflicto(): AvisoConflicto | null {
  return useSyncExternalStore(
    (o) => {
      oyentesAviso.add(o);
      return () => oyentesAviso.delete(o);
    },
    () => avisoConflicto,
    () => avisoConflicto,
  );
}

let fuenteEventos: EventSource | null = null;
let ultimaSenal = 0;
let vigilante: number | null = null;
const alVolverAlFlujo = () => {
  if (document.visibilityState === 'visible' && modo === 'servidor' && Date.now() - ultimaSenal > 20_000) void resincronizar();
};

/** El servidor manda un latido cada 15 s. Si pasan 45 s sin nada (ni estado
 *  ni latido), el flujo esta muerto aunque el navegador no lo sepa: pasa
 *  cuando el servidor se reinicia detras del proxy de Vite. Se reabre y se
 *  vuelve a pedir el estado completo, para no quedarse con uno viejo. */
function vigilarFlujo(): void {
  if (vigilante !== null) return;
  vigilante = window.setInterval(() => {
    if (modo !== 'servidor') return;
    if (Date.now() - ultimaSenal > 45_000) {
      void resincronizar();
    }
  }, 15_000);
  document.addEventListener('visibilitychange', alVolverAlFlujo);
}

async function resincronizar(): Promise<void> {
  try {
    const r = await fetch(conToken(`${API}/estado`), { cache: 'no-store', headers: cabeceras(false) });
    if (r.ok) {
      const cuerpo = (await r.json()) as EstadoRosa;
      const version = versionDe(r.headers.get('X-Rosa-Version'));
      // Una respuesta que llega despues de que el flujo ya trajo algo mas nuevo
      // no se pinta: el flujo va en orden, la peticion suelta no.
      if (version === null || version >= vivo.version) recibirRemoto(cuerpo, version);
    }
  } catch {
    if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
  }
  abrirEventos();
}

/** Reintento explícito desde la interfaz cuando se pierde la red. Conserva la
 * vista actual hasta que el servidor conteste con un estado completo. */
export async function reintentarConexion(): Promise<boolean> {
  if (modo !== 'servidor') return false;
  try {
    const r = await fetch(conToken(`${API}/estado`), { cache: 'no-store', headers: cabeceras(false) });
    if (!r.ok) throw new Error(`Estado ${r.status}`);
    const cuerpo = (await r.json()) as EstadoRosa;
    if (!Array.isArray(cuerpo.investigaciones)) throw new Error('Respuesta sin forma de EstadoRosa');
    const version = versionDe(r.headers.get('X-Rosa-Version'));
    if (version === null || version >= vivo.version) recibirRemoto(cuerpo, version);
    ultimaSenal = Date.now();
    abrirEventos();
    return true;
  } catch {
    if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
    return false;
  }
}

/* El flujo en tiempo real solo avisa de que hay una versión nueva (25 de
   septiembre de 2026); el estado se baja aparte con GET /api/estado, que va
   comprimido: 4,3 MB en vez de los 16 MB sin comprimir que llevaba cada evento.
   Por un túnel a 1 MB por segundo, un evento de 16 MB tardaba más que los 45
   segundos del vigilante, que cerraba el flujo y abría otro que volvía a empezar:
   la primera persona que entró desde fuera se quedó cargando para siempre. Nunca
   hay dos descargas a la vez: si llega otro aviso mientras se baja una, se pide
   una sola vez más al terminar, con una pausa para no encadenarlas sin respiro
   durante una corrida, que cambia el estado cada pocos segundos. */
let descargaEnCurso = false;
let otraDescarga = false;
const PAUSA_ENTRE_DESCARGAS_MS = 2000;

function pedirEstado(): void {
  if (descargaEnCurso) {
    otraDescarga = true;
    return;
  }
  descargaEnCurso = true;
  void (async () => {
    try {
      const r = await fetch(conToken(`${API}/estado`), { cache: 'no-store', headers: cabeceras(false) });
      if (r.ok) {
        const cuerpo = (await r.json()) as EstadoRosa;
        const version = versionDe(r.headers.get('X-Rosa-Version'));
        if (version === null || version >= vivo.version) recibirRemoto(cuerpo, version);
        if (vivo.estado.conexion !== 'en_linea') aplicar((e) => ({ ...e, conexion: 'en_linea' }));
      }
    } catch {
      if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
    } finally {
      descargaEnCurso = false;
      if (otraDescarga) {
        otraDescarga = false;
        window.setTimeout(pedirEstado, PAUSA_ENTRE_DESCARGAS_MS);
      }
    }
  })();
}

function abrirEventos(): void {
  if (retirado) return;
  if (fuenteEventos) fuenteEventos.close();
  const es = new EventSource(conToken(`${API}/eventos`));
  fuenteEventos = es;
  ultimaSenal = Date.now();
  es.addEventListener('latido', () => {
    ultimaSenal = Date.now();
    if (vivo.estado.conexion !== 'en_linea') aplicar((e) => ({ ...e, conexion: 'en_linea' }));
  });
  es.addEventListener('version', (ev) => {
    ultimaSenal = Date.now();
    const m = ev as MessageEvent;
    const version = versionDe(m.lastEventId);
    // Solo se baja lo que no se tiene: la primera versión del flujo suele ser la que
    // ya trajo la carga inicial. "forzar": cambiaron los avisos de la persona.
    if (m.data === 'forzar' || version === null || version > vivo.version) pedirEstado();
  });
  // Un servidor anterior al 25 de septiembre de 2026 manda el estado dentro del evento.
  es.addEventListener('estado', (ev) => {
    ultimaSenal = Date.now();
    try {
      const m = ev as MessageEvent;
      recibirRemoto(JSON.parse(m.data) as EstadoRosa, versionDe(m.lastEventId));
    } catch {
      // Un mensaje corrupto no tumba la interfaz; el siguiente lo arregla.
    }
  });
  es.onopen = () => {
    if (vivo.estado.conexion !== 'en_linea') aplicar((e) => ({ ...e, conexion: 'en_linea' }));
  };
  es.onerror = () => {
    // EventSource reintenta solo. Mientras, se avisa.
    if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
  };
}

/** Envía una acción al servidor. El estado local ya se aplicó de forma
 *  optimista; el servidor manda el suyo por SSE en cuanto la procesa.
 *  Devuelve la promesa del envío (que nunca rechaza: los fallos se convierten
 *  en estado de conexión o en aviso) para que un botón pueda quedarse "en
 *  vuelo" hasta que el servidor responda (lib/diferido.ts, useEnVuelo). En
 *  modo muestra resuelve en el acto. */
/** Baja un fichero (el PDF de un dossier) del servidor con la sesión y lo guarda con el nombre que da
 *  el servidor (o `porDefecto`). Devuelve el motivo si no se pudo. */
async function bajarFichero(url: string, porDefecto: string): Promise<string | null> {
  if (modo !== 'servidor') return 'Descargar el documento requiere el servidor de ROSA2018.';
  try {
    const r = await fetch(url, { headers: cabeceras(false) });
    if (!r.ok) return r.status === 404 ? 'Ese documento no está en el servidor.' : `El servidor no lo entregó (${r.status}).`;
    const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? porDefecto;
    const enlace = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = enlace;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(enlace), 1000);
    return null;
  } catch {
    return 'No pude comprobar la conexión con el servidor.';
  }
}

function enviar(nombre: string, args: Record<string, unknown>): Promise<void> {
  if (modo !== 'servidor') return Promise.resolve();
  return fetch(`${API}/acciones/${nombre}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(args) })
    .then(async (r) => {
      if (r.status >= 500) {
        if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
        return;
      }
      if (!r.ok) {
        // 4xx: el servidor rechazo la accion (argumentos, permiso). No es un corte de
        // conexion: se deshace el cambio optimista volviendo a pedir el estado.
        fijarAviso(`El servidor no aceptó la acción "${nombre}" (${r.status}). Se recargó el estado del servidor; lo que veías como aplicado no lo estaba.`);
        void resincronizar();
        return;
      }
      const d = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (d && d.ok === false) {
        fijarAviso(`El servidor no aplicó la acción "${nombre}": la regla no se cumplía (otro cambio llegó antes). Se recargó el estado.`);
        void resincronizar();
      }
    })
    .catch(() => {
      if (vivo.estado.conexion !== 'sin_conexion') aplicar((e) => ({ ...e, conexion: 'sin_conexion' }));
    });
}

/** Lo que devuelven las lecturas aparte cuando el servidor está pero no
 *  contestó a tiempo, falló o rechazó: "no pude comprobar", que nunca es
 *  "no hay". `null` queda para el modo muestra (sin servidor). */
export type SinRespuesta = 'sin_respuesta';

/** Como `enviar`, pero devuelve si el servidor aplicó la acción (ok), la
 *  rechazó (false) o no se pudo saber (null). `keepalive` deja que el
 *  navegador complete el POST aunque la página se esté cerrando. */
async function enviarYComprobar(nombre: string, args: Record<string, unknown>, keepalive = false): Promise<boolean | null> {
  if (modo !== 'servidor') return null;
  try {
    const r = await fetch(`${API}/acciones/${nombre}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(args), ...(keepalive ? { keepalive: true } : {}) });
    if (r.status >= 500) return null;
    if (!r.ok) return false;
    const cuerpo = (await r.json()) as { ok: boolean };
    return cuerpo.ok;
  } catch {
    return null;
  }
}

/** Intenta el servidor; si no esta, arranca la muestra. Idempotente. */
export async function conectar(permitirMuestra = true): Promise<'muestra' | 'servidor'> {
  // Mientras se pide el primer estado, la conexión está "conectando": lo que
  // se pinte con el almacén en ese hueco enseña su esqueleto, no los datos de
  // muestra como si fueran reales. Solo la primera vez (versión -1): una
  // reconexión conserva el contenido y avisa con la franja.
  const primeraVez = vivo.version === -1 && vivo.estado.conexion === 'muestra';
  if (primeraVez) aplicar((e) => ({ ...e, conexion: 'conectando' }));
  try {
    const r = await fetch(conToken(`${API}/estado`), { cache: 'no-store', headers: cabeceras(false) });
    if (!r.ok) throw new Error(String(r.status));
    const remoto = (await r.json()) as EstadoRosa;
    if (!Array.isArray(remoto.investigaciones)) throw new Error('respuesta sin forma de EstadoRosa');
    modo = 'servidor';
    if (pararSimulacion) {
      pararSimulacion();
      pararSimulacion = null;
    }
    recibirRemoto(remoto, versionDe(r.headers.get('X-Rosa-Version')));
    abrirEventos();
    vigilarFlujo();
  } catch {
    // Sin servidor la conexión vuelve a "muestra": el esqueleto no se queda para siempre.
    if (vivo.estado.conexion === 'conectando') aplicar((e) => ({ ...e, conexion: 'muestra' }));
    if (!permitirMuestra) throw new Error('No se pudo cargar el estado de ROSA2018');
    modo = 'muestra';
    arrancarMuestra();
  }
  return modo;
}

/* ---------------------------------------------------------------------
   Acciones
   --------------------------------------------------------------------- */

export const acciones = {
  marcarVisita: () => {
    const ahora = Date.now();
    try {
      localStorage.setItem(CLAVE_VISITA, String(ahora));
    } catch {
      // Sin almacenamiento: la visita dura lo que la pestana.
    }
    aplicar((e) => A.marcarVisita(e, ahora));
    enviar('marcarVisita', { ahora });
  },
  pausarCorrida: (id: string) => {
    aplicar((e) => A.pausarCorrida(e, id));
    return enviar('pausarCorrida', { corrida_id: id });
  },
  reanudarCorrida: (id: string) => {
    aplicar((e) => A.reanudarCorrida(e, id));
    return enviar('reanudarCorrida', { corrida_id: id });
  },
  detenerCorrida: (id: string, motivo: string, vigilarDias: number | null) => {
    aplicar((e) => A.detenerCorrida(e, id, motivo, Date.now(), vigilarDias));
    return enviar('detenerCorrida', { corrida_id: id, motivo, vigilar_literatura_dias: vigilarDias });
  },
  /** Arranca una corrida nueva (solo con servidor: el bucle propone el plan).
   *  `parada`: horas, iteraciones, llamadas o texto que la detienen, lo que
   *  llegue primero, además de la condición de la investigación. */
  iniciarCorrida: (investigacionId: string, parada: ParadaCorrida | null = null) => {
    enviar('iniciarCorrida', parada ? { investigacion_id: investigacionId, parada } : { investigacion_id: investigacionId });
  },
  /** Cuánto explora ROSA2018 fuera de la pregunta en cada paso de literatura. */
  fijarAmplitud: (investigacionId: string, amplitud: Amplitud) => {
    aplicar((e) => A.fijarAmplitud(e, investigacionId, amplitud));
    enviar('fijarAmplitud', { investigacion_id: investigacionId, amplitud });
  },
  ampliarPresupuesto: (id: string, limite: number) => {
    aplicar((e) => A.ampliarPresupuesto(e, id, limite, Date.now()));
    enviar('ampliarPresupuesto', { corrida_id: id, nuevo_limite: limite });
  },
  dirigirCorrida: (id: string, texto: string) => {
    aplicar((e) => A.dirigirCorrida(e, id, texto));
    enviar('dirigirCorrida', { corrida_id: id, texto });
  },
  editarPlan: (iteracionId: string, plan: PasoPlan[]) => {
    aplicar((e) => A.editarPlan(e, iteracionId, plan));
    enviar('editarPlan', { iteracion_id: iteracionId, plan });
  },
  aprobarPlan: (iteracionId: string) => {
    aplicar((e) => A.aprobarPlan(e, iteracionId, Date.now()));
    return enviar('aprobarPlan', { iteracion_id: iteracionId });
  },
  editarInvestigacion: (investigacionId: string, cambios: { titulo?: string; objetivo?: string }) => {
    aplicar((e) => A.editarInvestigacion(e, investigacionId, cambios));
    enviar('editarInvestigacion', { investigacion_id: investigacionId, titulo: cambios.titulo ?? null, objetivo: cambios.objetivo ?? null });
  },
  fijarAutoaprobacionPlan: (corridaId: string, segundos: number | null) => {
    aplicar((e) => A.fijarAutoaprobacionPlan(e, corridaId, segundos));
    enviar('fijarAutoaprobacionPlan', { corrida_id: corridaId, segundos });
  },
  detenerPista: (pistaId: string, indicacion: string) => {
    aplicar((e) => A.detenerPista(e, pistaId, indicacion));
    enviar('detenerPista', { pista_id: pistaId, indicacion });
  },
  detenerProceso: (corridaId: string, procesoId: string, indicacion: string) => {
    aplicar((e) => A.detenerProceso(e, corridaId, procesoId, indicacion));
    return enviar('detenerProceso', { corrida_id: corridaId, proceso_id: procesoId, indicacion });
  },
  volverAIteracion: (iteracionId: string, que: 'plan' | 'mundo' | 'ambos') => {
    aplicar((e) => A.volverAIteracion(e, iteracionId, que, Date.now()));
    enviar('volverAIteracion', { iteracion_id: iteracionId, que });
  },
  resolverSolicitud: (id: string, decision: 'conceder' | 'denegar', alcance: AlcancePermiso | null, argumentos?: Record<string, string>) => {
    aplicar((e) => A.resolverSolicitud(e, id, decision, alcance, Date.now(), argumentos));
    return enviar('resolverSolicitud', { solicitud_id: id, decision, alcance, argumentos: argumentos ?? null });
  },
  resolverSolicitudes: (ids: string[], decision: 'conceder' | 'denegar', alcance: AlcancePermiso | null) => {
    aplicar((e) => A.resolverSolicitudes(e, ids, decision, alcance, Date.now()));
    return enviar('resolverSolicitudes', { ids, decision, alcance });
  },
  revocarPermiso: (id: string) => {
    aplicar((e) => A.revocarPermiso(e, id));
    enviar('revocarPermiso', { permiso_id: id });
  },
  resolverIncidencia: (id: string, resolucion: string) => {
    aplicar((e) => A.resolverIncidencia(e, id, resolucion, Date.now()));
    return enviar('resolverIncidencia', { incidencia_id: id, resolucion });
  },
  fijarAutonomia: (clase: ClaseAccion, nivel: NivelAutonomia) => {
    aplicar((e) => A.fijarAutonomia(e, clase, nivel));
    enviar('fijarAutonomia', { clase, nivel });
  },
  /** Decidir sobre una hipotesis. Va con la version que la persona veia y los
   *  segundos que tardo en decidir; si el servidor la rechaza (la hipotesis
   *  cambio entre medias), se resincroniza el estado y se avisa. */
  revisarHipotesis: (id: string, accion: A.AccionRevision, nota: string, aCiegas = false, revisionHumana: Omit<RevisionHumana, 'fecha' | 'quien'> | null = null, versionEsperada: number | null = null, segundosRevision: number | null = null): boolean => {
    const titulo = vivo.estado.hipotesis.find((h) => h.id === id)?.titulo ?? 'la hipótesis';
    const verbo = accion === 'aceptar' ? 'Aceptada' : accion === 'descartar' ? 'Descartada' : accion === 'refinar' ? 'Devuelta a ROSA2018 para refinar' : 'Decisión registrada';
    const ahora = Date.now();
    const corto = titulo.length > 60 ? `${titulo.slice(0, 57)}...` : titulo;
    const args = { hipotesis_id: id, accion, nota, quien: QUIEN, a_ciegas: aCiegas, revision_humana: revisionHumana, version_esperada: versionEsperada, segundos_revision: segundosRevision };
    // Si el servidor no responde (red caída, 5xx), la decisión no se pierde en
    // silencio: se avisa y se reintenta tres veces con espera creciente.
    const mandar = (keepalive: boolean, intento = 0): Promise<void> =>
      enviarYComprobar('revisarHipotesis', args, keepalive).then((ok) => {
        if (ok === false) {
          fijarAviso('La hipótesis cambió mientras la revisabas (ROSA2018 la reformuló) o la decisión ya estaba registrada. Se recargó la versión del servidor; vuelve a mirarla antes de decidir.');
          void resincronizar();
          return;
        }
        if (ok === null && modo === 'servidor') {
          if (intento < 3) {
            const espera = 5000 * (intento + 1);
            fijarAviso(`No pude registrar tu decisión sobre «${corto}»: el servidor no respondió. Se reintenta en ${espera / 1000} s.`);
            window.setTimeout(() => void mandar(false, intento + 1), espera);
          } else {
            fijarAviso(`Tu decisión sobre «${corto}» no quedó registrada: el servidor no respondió en cuatro intentos. Cuando vuelva la conexión, vuelve a decidir.`);
            void resincronizar();
          }
        }
      });
    return programar(
      `revisarHipotesis:${id}`,
      `${verbo}: ${corto}`,
      (e) => A.revisarHipotesis(e, id, accion, nota, QUIEN, ahora, aCiegas, revisionHumana, versionEsperada),
      (keepalive) => mandar(keepalive),
    );
  },
  votarRelevancia: (id: string, voto: 'alta' | 'media' | 'baja') => {
    aplicar((e) => A.votarRelevancia(e, id, voto));
    enviar('votarRelevancia', { hipotesis_id: id, voto });
  },
  solicitarRevision: (id: string) => {
    aplicar((e) => A.solicitarRevision(e, id, Date.now()));
    return enviar('solicitarRevision', { hipotesis_id: id });
  },
  /** Qué desbloquea más: pedir que se revisen otra vez las hipótesis cuyos
   *  supuestos no están al día; sin investigación, las de todo el programa. */
  reevaluarSupuestos: (investigacionId: string | null) => {
    aplicar((e) => A.reevaluarSupuestos(e, investigacionId, Date.now()));
    return enviar('reevaluarSupuestos', { investigacion_id: investigacionId });
  },
  replicarHipotesis: (id: string, total: number) => {
    aplicar((e) => A.replicarHipotesis(e, id, total, Date.now()));
    return enviar('replicarHipotesis', { hipotesis_id: id, total });
  },
  proponerHipotesis: (investigacionId: string, datos: A.DatosHipotesisHumana): string | null => {
    let id: string | null = null;
    aplicar((e) => {
      const r = A.proponerHipotesis(e, investigacionId, datos, QUIEN, Date.now());
      id = r.id;
      return r.estado;
    });
    if (id !== null) enviar('proponerHipotesis', { investigacion_id: investigacionId, datos, quien: QUIEN, id_: id });
    return id;
  },
  asignarExperimento: (id: string, laboratorio: string) => {
    aplicar((e) => A.asignarExperimento(e, id, laboratorio));
    return enviar('asignarExperimento', { hipotesis_id: id, laboratorio });
  },
  registrarDatosExperimento: (id: string, fichero: string, analisis: string, sintetico = false) => {
    aplicar((e) => A.registrarDatosExperimento(e, id, fichero, analisis, sintetico));
    // `sintetico` solo viaja cuando es sí: el servidor lo admite desde el 17 de septiembre de 2026 (misma forma que la subida de datasets).
    enviar('registrarDatosExperimento', sintetico ? { hipotesis_id: id, fichero, analisis, sintetico: 'si' } : { hipotesis_id: id, fichero, analisis });
  },
  /** Sube el fichero de datos del laboratorio. Con servidor, va por multipart
   *  y ROSA2018 lo evalúa contra el prerregistro; en modo muestra solo se registra
   *  el nombre. `sintetico` es la casilla "estos datos son sintéticos o de
   *  prueba": viaja como el campo `sintetico` ("si" o "no", igual que en la
   *  subida de datasets) y un dato sintético nunca cuenta como evidencia.
   *  Devuelve un mensaje de error o null. */
  subirDatosExperimento: async (id: string, fichero: File, analisis: string, sintetico = false): Promise<string | null> => {
    if (modo !== 'servidor') {
      aplicar((e) => A.registrarDatosExperimento(e, id, fichero.name, analisis, sintetico));
      return null;
    }
    const cuerpo = new FormData();
    cuerpo.append('fichero', fichero, fichero.name);
    cuerpo.append('analisis', analisis);
    cuerpo.append('sintetico', sintetico || A.FICHERO_SINTETICO.test(fichero.name) ? 'si' : 'no');
    let r: Response;
    try {
      r = await fetch(`${API}/hipotesis/${encodeURIComponent(id)}/datos`, { method: 'POST', headers: cabeceras(false), body: cuerpo });
    } catch {
      return 'No se pudo subir el fichero: sin conexión con el servidor.';
    }
    if (!r.ok) return `El servidor rechazó el fichero (${r.status}).`;
    if (!sintetico) return null;
    // Red de seguridad (S-18): mientras el endpoint multipart del servidor no
    // declare el campo `sintetico`, lo ignora y el fichero quedaría como dato
    // real, que sube el techo GRADE. Se relee el estado del servidor y, si la
    // bandera no quedó puesta, se manda la acción con `sintetico: "si"` sobre
    // el nombre con el que el servidor guardó el fichero. La certeza solo
    // baja: un dato declarado de prueba nunca cuenta como evidencia.
    const d = (await r.json().catch(() => null)) as { fichero?: unknown } | null;
    await resincronizar();
    const x = vivo.estado.hipotesis.find((h) => h.id === id)?.experimento;
    const nombre = (x && typeof x.ficheroDatos === 'string' && x.ficheroDatos) || (d && typeof d.fichero === 'string' && d.fichero) || fichero.name;
    if (x && x.datosSinteticos !== true) {
      aplicar((e) => A.registrarDatosExperimento(e, id, nombre, analisis, true));
      void enviarYComprobar('registrarDatosExperimento', { hipotesis_id: id, fichero: nombre, analisis, sintetico: 'si' });
    }
    return null;
  },
  anadirComentario: (hipotesisId: string, ancla: AnclaComentario, nota: string) => {
    aplicar((e) => A.anadirComentario(e, hipotesisId, ancla, nota, Date.now()));
    enviar('anadirComentario', { hipotesis_id: hipotesisId, ancla, nota });
  },
  editarComentario: (id: string, nota: string) => {
    aplicar((e) => A.editarComentario(e, id, nota));
    enviar('editarComentario', { comentario_id: id, nota });
  },
  quitarComentario: (id: string) => {
    aplicar((e) => A.quitarComentario(e, id));
    enviar('quitarComentario', { comentario_id: id });
  },
  enviarComentarios: (hipotesisId: string, mensaje: string) => {
    aplicar((e) => A.enviarComentarios(e, hipotesisId, mensaje, QUIEN, Date.now()));
    enviar('enviarComentarios', { hipotesis_id: hipotesisId, mensaje, quien: QUIEN });
  },
  inyectarDebilidad: (corridaId: string, debilidadId: string) => {
    aplicar((e) => A.inyectarDebilidad(e, corridaId, debilidadId));
    enviar('inyectarDebilidad', { corrida_id: corridaId, debilidad_id: debilidadId });
  },
  recomprobarRetracciones: (investigacionId: string) => {
    aplicar((e) => A.recomprobarRetracciones(e, investigacionId, Date.now()));
    enviar('recomprobarRetracciones', { investigacion_id: investigacionId });
  },
  crearInvestigacion: (datos: A.DatosInvestigacion): string | null => {
    let id: string | null = null;
    const conQuien = { ...datos, quien: QUIEN };
    aplicar((e) => {
      const r = A.crearInvestigacion(e, conQuien, Date.now());
      id = r.id;
      return r.estado;
    });
    if (id !== null) {
      // Con servidor, la primera corrida arranca sola: ROSA2018 propone el plan y
      // lo deja esperando aprobacion. Se encadena tras la respuesta de crear:
      // dos peticiones sueltas pueden llegar al servidor en orden cambiado.
      const invId = id;
      void enviarYComprobar('crearInvestigacion', { datos: conQuien, id_: invId }).then((ok) => {
        if (ok === false) {
          fijarAviso('El servidor no creó la investigación. Se recargó el estado.');
          void resincronizar();
          return;
        }
        enviar('iniciarCorrida', { investigacion_id: invId });
      });
    }
    return id;
  },
  bifurcarInvestigacion: (investigacionId: string, motivo: string): string | null => {
    let id: string | null = null;
    aplicar((e) => {
      const r = A.bifurcarInvestigacion(e, investigacionId, motivo, Date.now());
      id = r.id;
      return r.estado;
    });
    if (id !== null) {
      enviar('bifurcarInvestigacion', { investigacion_id: investigacionId, motivo, id_: id });
      const rama = vivo.estado.investigaciones.find((i) => i.id === id);
      avisar(`Rama creada: "${rama?.titulo ?? 'rama'}". Estás dentro de la rama; la original sigue igual y está en la barra lateral. Arranca su primera corrida cuando quieras.`);
    }
    return id;
  },
  actualizarConfiguracion: (investigacionId: string, configuracion: Investigacion['configuracion']) => {
    aplicar((e) => A.actualizarConfiguracion(e, investigacionId, configuracion));
    enviar('actualizarConfiguracion', { investigacion_id: investigacionId, configuracion });
  },
  anadirDataset: (investigacionId: string, dataset: Omit<Dataset, 'id' | 'estado'>) => {
    aplicar((e) => A.anadirDataset(e, investigacionId, dataset));
    enviar('anadirDataset', { investigacion_id: investigacionId, dataset });
  },
  decidirDataset: (investigacionId: string, datasetId: string, decision: 'aprobado' | 'rechazado') => {
    aplicar((e) => A.decidirDataset(e, investigacionId, datasetId, decision));
    enviar('decidirDataset', { investigacion_id: investigacionId, dataset_id: datasetId, decision });
  },
  aprobarDiccionario: (investigacionId: string, datasetId: string) => {
    aplicar((e) => A.aprobarDiccionario(e, investigacionId, datasetId));
    enviar('aprobarDiccionario', { investigacion_id: investigacionId, dataset_id: datasetId });
  },
  corregirDataset: (investigacionId: string, datasetId: string) => {
    aplicar((e) => A.corregirDataset(e, investigacionId, datasetId));
    enviar('corregirDataset', { investigacion_id: investigacionId, dataset_id: datasetId });
  },
  clasificarDataset: (investigacionId: string, datasetId: string, c: ClasificacionDatos) => {
    aplicar((e) => A.clasificarDataset(e, investigacionId, datasetId, c));
    enviar('clasificarDataset', { investigacion_id: investigacionId, dataset_id: datasetId, clasificacion: c });
  },
  destacarArtefacto: (id: string) => {
    aplicar((e) => A.destacarArtefacto(e, id));
    enviar('destacarArtefacto', { artefacto_id: id });
  },
  guardarArtefacto: (investigacionId: string, nombre: string, tipo: TipoArtefacto, contenido: string, resumen: string, iteracion: number): string => {
    let id = '';
    aplicar((e) => {
      const r = A.guardarArtefacto(e, investigacionId, nombre, tipo, contenido, resumen, iteracion, Date.now());
      id = r.id;
      return r.estado;
    });
    enviar('guardarArtefacto', { investigacion_id: investigacionId, nombre, tipo, contenido, resumen, iteracion, id_: id });
    return id;
  },
  cambiarEstadoCaso: (clave: string, nuevo: 'aprobado' | 'descartado' | 'propuesto') => {
    aplicar((e) => A.cambiarEstadoCaso(e, clave, nuevo));
    enviar('cambiarEstadoCaso', { clave, nuevo });
  },
  editarRespuestaCaso: (clave: string, respuesta: string) => {
    aplicar((e) => A.editarRespuestaCaso(e, clave, respuesta));
    enviar('editarRespuestaCaso', { clave, respuesta });
  },
  editarRecuerdo: (id: string, texto: string) => {
    aplicar((e) => A.editarRecuerdo(e, id, texto));
    enviar('editarRecuerdo', { id_: id, texto });
  },
  borrarRecuerdo: (id: string) => {
    aplicar((e) => A.borrarRecuerdo(e, id));
    enviar('borrarRecuerdo', { id_: id });
  },
  anadirCriterio: (texto: string) => {
    aplicar((e) => A.anadirCriterio(e, texto));
    enviar('anadirCriterio', { texto });
  },
  /** Se borra por texto, no por posicion: si la lista cambio en el servidor
   *  mientras se miraba, la posicion apuntaria a otro criterio. */
  borrarCriterio: (indice: number, texto: string) => {
    aplicar((e) => A.borrarCriterio(e, indice, texto));
    enviar('borrarCriterio', { indice, texto });
  },
  actualizarAvisos: (avisos: Avisos) => {
    aplicar((e) => A.actualizarAvisos(e, avisos));
    enviar('actualizarAvisos', { avisos });
  },
  actualizarPoliticaEsperas: (p: PoliticaEsperas) => {
    aplicar((e) => A.actualizarPoliticaEsperas(e, p));
    enviar('actualizarPoliticaEsperas', { politica: p });
  },
  borrarPlanGuardado: (id: string) => {
    aplicar((e) => A.borrarPlanGuardado(e, id));
    enviar('borrarPlanGuardado', { id_: id });
  },
  /* ---- ROSA2018 ---- */
  aprobarMision: (investigacionId: string, mision: A.DatosInvestigacion['mision']) => {
    aplicar((e) => A.aprobarMision(e, investigacionId, mision, QUIEN, Date.now()));
    enviar('aprobarMision', { investigacion_id: investigacionId, mision, quien: QUIEN });
  },
  eximirPuerta: (investigacionId: string, motivo: string) => {
    aplicar((e) => A.eximirPuerta(e, investigacionId, motivo, QUIEN, Date.now()));
    enviar('eximirPuerta', { investigacion_id: investigacionId, motivo, quien: QUIEN });
  },
  cerrarPuerta: (investigacionId: string) => {
    aplicar((e) => A.cerrarPuerta(e, investigacionId, QUIEN, Date.now()));
    enviar('cerrarPuerta', { investigacion_id: investigacionId, quien: QUIEN });
  },
  anadirReproduccion: (investigacionId: string, datasetId: string, datos: A.DatosReproduccion): string | null => {
    let id: string | null = null;
    aplicar((e) => {
      const r = A.anadirReproduccion(e, investigacionId, datasetId, datos, Date.now());
      id = r.id;
      return r.estado;
    });
    if (id !== null) enviar('anadirReproduccion', { investigacion_id: investigacionId, dataset_id: datasetId, datos });
    return id;
  },
  pedirAnalisis: (hipotesisId: string, datasetId: string, pregunta: string) => {
    aplicar((e) => A.pedirAnalisis(e, hipotesisId, datasetId, pregunta, Date.now()));
    enviar('pedirAnalisis', { hipotesis_id: hipotesisId, dataset_id: datasetId, pregunta });
  },
  promoverAprendizaje: (cambioId: string) => {
    aplicar((e) => A.promoverAprendizaje(e, cambioId, QUIEN, Date.now()));
    enviar('promoverAprendizaje', { cambio_id: cambioId, quien: QUIEN });
  },
  revertirAprendizaje: (cambioId: string, motivo: string) => {
    aplicar((e) => A.revertirAprendizaje(e, cambioId, QUIEN, motivo, Date.now()));
    enviar('revertirAprendizaje', { cambio_id: cambioId, quien: QUIEN, motivo });
  },
  /** Fusión de ramas: la ganadora hereda la evidencia de la absorbida. */
  fusionarHipotesis: (ganadoraId: string, absorbidaId: string, motivo: string) => {
    aplicar((e) => A.fusionarHipotesis(e, ganadoraId, absorbidaId, motivo, QUIEN, Date.now()));
    enviar('fusionarHipotesis', { ganadora_id: ganadoraId, absorbida_id: absorbidaId, motivo, quien: QUIEN });
  },
  rechazarFusion: (hipotesisId: string) => {
    aplicar((e) => A.rechazarFusion(e, hipotesisId, QUIEN, Date.now()));
    enviar('rechazarFusion', { hipotesis_id: hipotesisId, quien: QUIEN });
  },
  /** Cuestiones persistentes de la investigación (rosa/cuestiones.py). */
  abrirCuestion: (investigacionId: string, texto: string, queLaResolveria: string, hipotesisId: string | null = null) => {
    aplicar((e) => A.abrirCuestion(e, investigacionId, texto, queLaResolveria, QUIEN, Date.now(), hipotesisId));
    enviar('abrirCuestion', { investigacion_id: investigacionId, texto, que_la_resolveria: queLaResolveria, quien: QUIEN, hipotesis_id: hipotesisId });
  },
  resolverCuestion: (cuestionId: string, motivo: string) => {
    aplicar((e) => A.resolverCuestion(e, cuestionId, motivo, QUIEN, Date.now()));
    enviar('resolverCuestion', { cuestion_id: cuestionId, motivo, quien: QUIEN });
  },
  descartarCuestion: (cuestionId: string, motivo: string) => {
    aplicar((e) => A.descartarCuestion(e, cuestionId, motivo, QUIEN, Date.now()));
    enviar('descartarCuestion', { cuestion_id: cuestionId, motivo, quien: QUIEN });
  },
  reabrirCuestion: (cuestionId: string, motivo: string) => {
    aplicar((e) => A.reabrirCuestion(e, cuestionId, motivo, QUIEN, Date.now()));
    enviar('reabrirCuestion', { cuestion_id: cuestionId, motivo, quien: QUIEN });
  },
  /** Dar por revisado lo que la propagación de dependencias marcó como pendiente. */
  atenderPendiente: (tipo: 'hipotesis' | 'hecho' | 'plan', id: string, nota: string) => {
    aplicar((e) => A.atenderPendiente(e, tipo, id, QUIEN, nota, Date.now()));
    enviar('atenderPendiente', { tipo, id_: id, quien: QUIEN, nota });
  },
  /** Evaluar un criterio propuesto sobre el conjunto reservado. Solo con servidor: gasta llamadas al juez. */
  evaluarAprendizaje: (cambioId: string) => {
    enviar('evaluarAprendizaje', { cambio_id: cambioId });
  },
  actualizarPregunta: (corridaId: string, pregunta: Partial<PreguntaCampana>) => {
    aplicar((e) => A.actualizarPregunta(e, corridaId, pregunta, Date.now()));
    enviar('actualizarPregunta', { corrida_id: corridaId, pregunta, quien: QUIEN });
  },
  resolverHallazgoRegistro: (iteracionId: string, hallazgoId: string, estado: 'atendido' | 'descartado' | 'abierto', respuesta: string) => {
    aplicar((e) => A.resolverHallazgoRegistro(e, iteracionId, hallazgoId, estado, respuesta, QUIEN, Date.now()));
    enviar('resolverHallazgoRegistro', { iteracion_id: iteracionId, hallazgo_id: hallazgoId, estado, respuesta, quien: QUIEN });
  },
  /** Cola de triaje: aceptar o rechazar con motivo una tarea que ROSA2018 pidió abrir. */
  decidirTarea: (tareaId: string, estado: 'aceptada' | 'rechazada', motivo: string) => {
    aplicar((e) => A.decidirTarea(e, tareaId, estado, motivo, QUIEN, Date.now()));
    enviar('decidirTarea', { tarea_id: tareaId, estado, motivo, quien: QUIEN });
  },
  /** Abrir una tarea a mano. Pasa por el mismo triaje por regla que las de ROSA2018. */
  abrirTarea: (investigacionId: string, queVio: string, queHaria: string, porQue: string, herramienta: string) => {
    enviar('abrirTarea', { investigacion_id: investigacionId, que_vio: queVio, que_haria: queHaria, por_que: porQue, herramienta, quien: QUIEN });
  },
  /** Estado del espejo del estado en Convex (solo lectura). */
  estadoEspejo: async (): Promise<EstadoEspejo | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/espejo`, { cache: 'no-store', headers: cabeceras(false), ...senalDeTope() });
      return r.ok ? ((await r.json()) as EstadoEspejo) : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  fijarPermisoConector: (nombre: string, nivel: NivelPermisoConector) => {
    aplicar((e) => A.fijarPermisoConector(e, nombre, nivel, QUIEN, Date.now()));
    enviar('fijarPermisoConector', { nombre, nivel, quien: QUIEN });
  },
  anadirMemoria: (investigacionId: string, texto: string) => {
    aplicar((e) => A.anadirMemoria(e, investigacionId, texto, QUIEN, Date.now()));
    enviar('anadirMemoria', { investigacion_id: investigacionId, texto, quien: QUIEN });
  },
  quitarMemoria: (investigacionId: string, memoriaId: string) => {
    aplicar((e) => A.quitarMemoria(e, investigacionId, memoriaId));
    enviar('quitarMemoria', { investigacion_id: investigacionId, memoria_id: memoriaId });
  },
  /** Una pregunta con herramientas (conectores, busqueda en el proyecto, modelo
   *  de mundo): la corre el servidor con el cerebro y la respuesta llega al
   *  estado por SSE con sus consultas. Devuelve un error legible o null. */
  preguntarALasBases: async (investigacionId: string, pregunta: string): Promise<string | null> => {
    if (modo !== 'servidor') return 'Preguntar a las bases requiere el servidor de ROSA2018.';
    try {
      const r = await fetch(`${API}/investigaciones/${encodeURIComponent(investigacionId)}/preguntar`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ pregunta, quien: QUIEN }) });
      if (!r.ok) return `El servidor no pudo responder (${r.status}).`;
      const d = (await r.json()) as { ok: boolean; resultado?: { error?: string | null } };
      return d.ok ? null : d.resultado?.error ?? 'La pregunta falló.';
    } catch {
      return 'Sin conexión con el servidor.';
    }
  },
  cambiarEstadoArea: (investigacionId: string, areaId: string, estado: EstadoArea | null, condicionReapertura = '', corridaId: string | null | undefined = undefined, motivo = '') => {
    aplicar((e) => A.cambiarEstadoArea(e, investigacionId, areaId, estado, QUIEN, Date.now(), condicionReapertura, corridaId, motivo));
    enviar('cambiarEstadoArea', { investigacion_id: investigacionId, area_id: areaId, estado, quien: QUIEN, condicion_reapertura: condicionReapertura, corrida_id: corridaId === undefined ? null : corridaId || '', motivo });
  },
  enmendarExperimento: (hipotesisId: string, campo: CampoEnmendable, despues: string, motivo: string) => {
    aplicar((e) => A.enmendarExperimento(e, hipotesisId, campo, despues, motivo, QUIEN, Date.now()));
    enviar('enmendarExperimento', { hipotesis_id: hipotesisId, campo, despues, motivo, quien: QUIEN });
  },
  /** Enmienda un campo (confirma si, refuta si, control o unidad) de una lectura del contrato del experimento tras prerregistrar, con motivo. Misma regla que enmendarExperimento; el índice es la posición de la lectura en `experimento.lecturas` tal como está guardado. */
  enmendarLectura: (hipotesisId: string, indice: number, campo: CampoLecturaEnmendable, despues: string, motivo: string) => {
    aplicar((e) => A.enmendarLectura(e, hipotesisId, indice, campo, despues, motivo, QUIEN, Date.now()));
    enviar('enmendarLectura', { hipotesis_id: hipotesisId, indice, campo, despues, motivo, quien: QUIEN });
  },
  /** Etiqueta humana sobre una comprobacion del Killer (conjunto dorado, calibracion de jueces). */
  etiquetarComprobacion: (hipotesisId: string, comprobacion: string, veredictoHumano: 'pasa' | 'falla' | 'no_comprobable', nota = '') => {
    aplicar((e) => A.etiquetarComprobacion(e, hipotesisId, comprobacion, veredictoHumano, QUIEN, Date.now(), nota));
    enviar('etiquetarComprobacion', { hipotesis_id: hipotesisId, comprobacion, veredicto_humano: veredictoHumano, quien: QUIEN, nota });
  },
  /** Pide (o repite) el sello de tiempo de un tercero sobre el prerregistro. El servidor lo registra por SSE. */
  sellarPrerregistro: async (hipotesisId: string): Promise<boolean> => {
    if (modo !== 'servidor') return false;
    try {
      const r = await fetch(`${API}/hipotesis/${encodeURIComponent(hipotesisId)}/sellar`, { method: 'POST', headers: cabeceras() });
      if (!r.ok) return false;
      const d = (await r.json()) as { ok?: boolean };
      return Boolean(d.ok);
    } catch {
      return false;
    }
  },
  anadirConocimientoOperativo: (investigacionId: string, texto: string, tipo: ConocimientoOperativo['tipo']) => {
    aplicar((e) => A.anadirConocimientoOperativo(e, investigacionId, texto, tipo, QUIEN, Date.now()));
    enviar('anadirConocimientoOperativo', { investigacion_id: investigacionId, texto, tipo, quien: QUIEN });
  },
  quitarConocimientoOperativo: (investigacionId: string, id: string) => {
    aplicar((e) => A.quitarConocimientoOperativo(e, investigacionId, id));
    enviar('quitarConocimientoOperativo', { investigacion_id: investigacionId, id_: id });
  },
  /** Descarga el flujo PRISMA 2020 de una corrida (JSON y Markdown). */
  exportarPrisma: async (corridaId: string): Promise<boolean> => {
    if (modo !== 'servidor') return false;
    try {
      const r = await fetch(`${API}/corridas/${encodeURIComponent(corridaId)}/prisma`, { cache: 'no-store', headers: cabeceras(false) });
      if (!r.ok) return false;
      const d = (await r.json()) as { markdown: string };
      const fecha = new Date().toISOString().slice(0, 10);
      descargar(`rosa-prisma2020-${corridaId}-${fecha}.md`, d.markdown, 'text/markdown;charset=utf-8');
      descargar(`rosa-prisma2020-${corridaId}-${fecha}.json`, JSON.stringify({ ...d, markdown: undefined }, null, 1), 'application/json');
      return true;
    } catch {
      return false;
    }
  },
  /** Coste por decision de una investigacion (modelo mas revision humana). */
  costesDe: async (investigacionId: string): Promise<CostesInvestigacion | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/investigaciones/${encodeURIComponent(investigacionId)}/costes`, { cache: 'no-store', headers: cabeceras(false), ...senalDeTope() });
      return r.ok ? ((await r.json()) as CostesInvestigacion) : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  /** Las citas de una corrida: afirmaciones con su veredicto y de qué se apoyan. */
  citasDe: async (corridaId: string): Promise<ListaCitas | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/corridas/${encodeURIComponent(corridaId)}/citas`, { cache: 'no-store', headers: cabeceras(false), ...senalDeTope() });
      return r.ok ? ((await r.json()) as ListaCitas) : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  /** La ficha de una cita: la página tal como se leyó y dónde cae el pasaje. */
  citaDe: async (corridaId: string, afirmacionId: string): Promise<FichaCita | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/corridas/${encodeURIComponent(corridaId)}/citas/${encodeURIComponent(afirmacionId)}`, { cache: 'no-store', headers: cabeceras(false), ...senalDeTope() });
      return r.ok ? ((await r.json()) as FichaCita) : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  /** Vuelve a verificar las afirmaciones que hoy ya no estarían bloqueadas:
   *  deterministas y, cuando hacen falta, el juez. Gasta del presupuesto de la
   *  corrida, como cualquier verificación del bucle. */
  reverificarCitas: async (corridaId: string): Promise<{ ok: boolean; revisadas?: number; desbloqueadas?: number; recuento?: Record<string, number>; motivo?: string } | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/corridas/${encodeURIComponent(corridaId)}/citas/reverificar`, { method: 'POST', headers: cabeceras() });
      return r.ok ? await r.json() : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  /** La dirección del PDF de una cita, con el token de acceso si hace falta. */
  pdfDeCita: (corridaId: string, afirmacionId: string): string =>
    conToken(`${API}/corridas/${encodeURIComponent(corridaId)}/citas/${encodeURIComponent(afirmacionId)}/pdf`),
  /** La página del PDF ya pintada con el pasaje encima. La marca la pone
   *  ROSA2018 en el servidor porque el visor de PDF del navegador no sabe
   *  resaltar: solo entiende por qué página abrir. */
  paginaDeCita: (corridaId: string, afirmacionId: string): string =>
    conToken(`${API}/corridas/${encodeURIComponent(corridaId)}/citas/${encodeURIComponent(afirmacionId)}/pagina.png`),
  /** Integridad del registro de acciones (cadena de hashes). */
  integridadRegistro: async (): Promise<{ ok: boolean; filas: number; encadenadas: number; sinHash: number; rotaEn: number | null; motivo?: string } | null | SinRespuesta> => {
    if (modo !== 'servidor') return null;
    try {
      const r = await fetch(`${API}/registro/integridad`, { cache: 'no-store', headers: cabeceras(false), ...senalDeTope() });
      return r.ok ? ((await r.json()) as { ok: boolean; filas: number; encadenadas: number; sinHash: number; rotaEn: number | null; motivo?: string }) : 'sin_respuesta';
    } catch {
      return 'sin_respuesta';
    }
  },
  registrarProtocoloReal: (hipotesisId: string, protocoloReal: { texto: string; desviaciones: string; identidadMuestras: string }) => {
    aplicar((e) => A.registrarProtocoloReal(e, hipotesisId, protocoloReal, QUIEN, Date.now()));
    enviar('registrarProtocoloReal', { hipotesis_id: hipotesisId, protocolo_real: protocoloReal, quien: QUIEN });
  },
  actualizarMetodo: (metodoId: string, cambios: Partial<MetodoRegistrado>) => {
    aplicar((e) => A.actualizarMetodo(e, metodoId, cambios, QUIEN, Date.now()));
    enviar('actualizarMetodo', { metodo_id: metodoId, cambios, quien: QUIEN });
  },
  actualizarProcedenciaDataset: (investigacionId: string, datasetId: string, procedencia: Partial<ProcedenciaDataset>) => {
    aplicar((e) => A.actualizarProcedenciaDataset(e, investigacionId, datasetId, procedencia));
    enviar('actualizarProcedenciaDataset', { investigacion_id: investigacionId, dataset_id: datasetId, procedencia });
  },
  /** Emite la última versión del dossier como documento controlado (norma
   *  AP-DOC-002). Solo en el servidor: el código AP-HYP no se asigna nunca en el
   *  navegador, para que dos pestañas no den el mismo. Llega por SSE. */
  emitirDocumento: (hipotesisId: string, nombreCorto: string) => {
    return enviar('emitirDocumento', { hipotesis_id: hipotesisId, nombre_corto: nombreCorto, quien: QUIEN });
  },
  /** El PDF de una versión emitida del documento controlado, con la sesión
   *  de la persona: es confidencial y la ruta no se abre sin ella. Devuelve el
   *  motivo si no se pudo. */
  descargarDocumento: (hipotesisId: string, version: string, nombreFichero: string): Promise<string | null> =>
    bajarFichero(`${API}/documentos/${encodeURIComponent(hipotesisId)}/${encodeURIComponent(version)}.pdf`, nombreFichero),
  /** Una versión de un dossier en PDF con el diseño del Alzheimer Project (norma
   *  AP-DOC-002): con su código si esa versión se emitió, como borrador si no. */
  descargarDossier: (artefactoId: string, n: number): Promise<string | null> =>
    bajarFichero(`${API}/artefactos/${encodeURIComponent(artefactoId)}/v/${n}.pdf`, `Dossier_v${n}.pdf`),
  /** El dossier se arma en el servidor con todo el estado; llega como artefacto por SSE. */
  generarDossier: (hipotesisId: string) => {
    return enviar('generarDossier', { hipotesis_id: hipotesisId, quien: QUIEN });
  },
  /** Sube un dataset con su fichero. El servidor calcula el hash, perfila las
   *  columnas y lo deja pendiente hasta completar el libro de procedencia. */
  subirDataset: async (investigacionId: string, fichero: File, nombre: string, descripcion: string, sintetico: boolean): Promise<string | null> => {
    if (modo !== 'servidor') return 'Subir datasets requiere el servidor de ROSA2018.';
    const cuerpo = new FormData();
    cuerpo.append('fichero', fichero, fichero.name);
    cuerpo.append('nombre', nombre);
    cuerpo.append('descripcion', descripcion);
    cuerpo.append('sintetico', sintetico ? 'si' : 'no');
    try {
      const r = await fetch(`${API}/investigaciones/${encodeURIComponent(investigacionId)}/datasets`, { method: 'POST', headers: cabeceras(false), body: cuerpo });
      if (!r.ok) return `El servidor rechazó el fichero (${r.status}).`;
      return null;
    } catch {
      return 'No se pudo subir el fichero: sin conexión con el servidor.';
    }
  },
};

let pararSimulacion: (() => void) | null = null;

/** Arranca la corrida simulada. Idempotente. */
export function arrancarMuestra(): void {
  if (pararSimulacion !== null || modo === 'servidor') return;
  pararSimulacion = iniciarSimulacion(aplicar);
}

if (import.meta.hot?.dispose && import.meta.hot.data) {
  const datos = import.meta.hot.data;
  datos.almacenVivo = vivo;
  // Vite puede actualizar un límite React superior sin ejecutar dispose en
  // esta dependencia. La nueva instancia también retira explícitamente la vieja.
  const retirar = () => {
    datos.almacenVivo = vivo;
    datos.modoRosa = modo;
    retirado = true;
    fuenteEventos?.close();
    if (vigilante !== null) window.clearInterval(vigilante);
    document.removeEventListener('visibilitychange', alVolverAlFlujo);
    pararSimulacion?.();
  };
  datos.retirarAlmacen = retirar;
  import.meta.hot.dispose(retirar);
  if (modo === 'servidor') {
    abrirEventos();
    vigilarFlujo();
  }
}
