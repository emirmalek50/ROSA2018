// La franja "Modelos" de la corrida: la salud de cada modelo del gateway por
// rol (cerebro, juez, volumen y, si lo hay, réplica), tal como la escribe el
// vigilante de modelos (rosa/vigilante_modelos.py) y los sondeos del
// supervisor. Un punto por rol (verde responde, ámbar tarda, rojo sin
// respuesta) con la frase en llano al lado; las incidencias
// `modelo_sin_respuesta`, que ROSA2018 abre y resuelve sola, se listan aquí
// como "resolviéndose solo" y no en "Algo impide seguir"; y cuando la corrida
// está en `esperando_modelo`, el aviso con el botón "Reintentar ahora".
//
// Regla de Emir (TRASPASO.md 7.4, 18 de septiembre de 2026): el cerebro es
// GPT-6 Astra y solo Astra; el juez es Claude Opus 5 y solo Opus. Cuando no
// responden, ROSA2018 espera y reintenta con el mismo modelo. Por eso esta
// franja nunca ofrece cambiar de modelo: enseña qué pasa y cuándo reintenta.
//
// Todo tolera un registro anterior al vigilante: `saludModelos` ausente o
// vacío, `esperandoModelo` ausente, un rol o un modelo que esta versión no
// conozca (se enseñan tal cual).

import type { EsperaModelo, EstadoCorrida, Incidencia, RolModelo, SaludModelo } from '../datos/tipos';
import { formatearDuracion } from '../lib/formato';
import { IconPlay } from './icons';
import { traducido, tr, trp } from '../lib/idioma';

/** Nombres legibles de los modelos del gateway; los demás se enseñan tal cual. */
export const NOMBRES_MODELOS: Readonly<Record<string, string>> = traducido({
  'openai/gpt-6-astra': 'GPT-6 Astra',
  'anthropic/claude-opus-5': 'Claude Opus 5',
  'anthropic/claude-sonnet-5': 'Claude Sonnet 5',
});

/** Orden fijo de los roles en la franja; los que el servidor añada y esta
 *  versión no conozca van detrás, con su clave. */
export const ORDEN_ROLES: readonly RolModelo[] = ['cerebro', 'juez', 'volumen', 'replica'];

export const NOMBRE_ROL: Readonly<Record<RolModelo, string>> = traducido({ cerebro: 'cerebro', juez: 'juez', volumen: 'volumen', replica: 'réplica' });

/** Intentos seguidos con el mismo modelo antes de que la corrida pase a
 *  `esperando_modelo` (MAX_INTENTOS en rosa/vigilante_modelos.py). */
export const MAX_INTENTOS = 4;

export type TonoSalud = 'ok' | 'aviso' | 'mal';

/** Qué significa cada color, para el title del punto y para la leyenda. */
export const SIGNIFICADO_ESTADO: Readonly<Record<SaludModelo['estado'], { etiqueta: string; tono: TonoSalud; explicacion: string }>> = traducido({
  ok: { etiqueta: 'responde', tono: 'ok', explicacion: 'Verde: la última llamada a este modelo terminó bien. Entre paréntesis, cuánto tardó en responder.' },
  lento: { etiqueta: 'tarda en responder', tono: 'aviso', explicacion: 'Ámbar: un intento no respondió a tiempo. ROSA2018 espera unos segundos y reintenta con el mismo modelo; no lo cambia por otro.' },
  sin_respuesta: { etiqueta: 'sin respuesta', tono: 'mal', explicacion: 'Rojo: varios intentos seguidos sin respuesta. ROSA2018 sondea el gateway cada minuto y retoma sola cuando el modelo vuelve; nunca cambia de modelo (el cerebro es GPT-6 Astra y el juez Claude Opus 5, por regla).' },
});

function num(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/** Nombre legible de un modelo. Quita el prefijo "openai/" que LiteLLM
 *  antepone al id del gateway ("openai/anthropic/claude-opus-5"); un id que no
 *  está en la tabla se enseña tal cual; sin id, "el modelo". */
export function nombreDeModelo(modelo: unknown): string {
  const id = typeof modelo === 'string' ? modelo.trim() : '';
  if (!id) return tr('el modelo');
  const limpio = id.startsWith('openai/') && id.split('/').length >= 3 ? id.slice('openai/'.length) : id;
  return NOMBRES_MODELOS[limpio] ?? NOMBRES_MODELOS[id] ?? id;
}

export function nombreDeRol(rol: string): string {
  return (NOMBRE_ROL as Record<string, string>)[rol] ?? rol;
}

/** "HH:MM" en hora local; "?" sin marca válida. */
export function horaCorta(ms: unknown): string {
  if (!num(ms)) return '?';
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function esSalud(x: unknown): x is SaludModelo {
  return typeof x === 'object' && x !== null && typeof (x as SaludModelo).estado === 'string';
}

function significado(estado: string): { etiqueta: string; tono: TonoSalud; explicacion: string } {
  // Un estado que el servidor añada y esta versión no conozca se trata como
  // aviso: "no pude comprobar" nunca es "todo bien".
  return SIGNIFICADO_ESTADO[estado as SaludModelo['estado']] ?? { etiqueta: estado.replace(/_/g, ' '), tono: 'aviso', explicacion: trp("Estado \"{estado}\" que esta versión de la interfaz no conoce.", { estado }) };
}

/** "reintento 3 de 4 en 45 s", "4 intentos sin respuesta · próximo sondeo en
 *  50 s". A partir de MAX_INTENTOS la cifra es la real, no el tope: en
 *  esperando_modelo el supervisor suma un intento por sondeo (tras media hora
 *  van 34) y el aviso de debajo dice los mismos. */
export function textoReintento(intentos: unknown, proximo: unknown, ahora: number): string {
  const n = typeof intentos === 'number' && Number.isFinite(intentos) ? Math.max(0, Math.floor(intentos)) : 0;
  const en = num(proximo) ? (proximo - ahora > 1000 ? ` en ${formatearDuracion(proximo - ahora)}` : ' ahora') : '';
  if (n >= MAX_INTENTOS) return trp("{n} intentos sin respuesta · próximo sondeo{en}", { n, en });
  // "reintento" es sustantivo ("reintento 2 de 4"), no el pretérito "reintentó": el acentuador lo excluye a mano.
  return trp("reintento {v} de {MAX_INTENTOS}{en}", { v: Math.min(n + 1, MAX_INTENTOS), MAX_INTENTOS, en });
}

/** La frase en llano de un rol: "GPT-6 Astra (cerebro): responde, última
 *  respuesta hace 40 s (6 s)"; "Claude Opus 5 (juez): sin respuesta desde las
 *  12:34 · reintento 3 de 4 en 45 s". */
export function textoSalud(rol: string, s: SaludModelo, ahora: number): string {
  const quien = `${nombreDeModelo(s.modelo)} (${nombreDeRol(rol)})`;
  if (s.estado === 'ok') {
    let hace = '';
    if (num(s.ultimaRespuestaEn)) {
      const dif = ahora - s.ultimaRespuestaEn;
      hace = dif < 1000 ? tr(', última respuesta hace un momento') : trp(", última respuesta hace {dif}", { dif: formatearDuracion(dif) });
    }
    const latencia = num(s.ultimaLatenciaMs) ? ` (${formatearDuracion(s.ultimaLatenciaMs)})` : '';
    return `${quien}: responde${hace}${latencia}`;
  }
  const desde = num(s.desde) ? trp(" desde las {desde}", { desde: horaCorta(s.desde) }) : '';
  return `${quien}: ${significado(s.estado).etiqueta}${desde} · ${textoReintento(s.intentos, s.proximoIntentoEn, ahora)}`;
}

/** Las filas de la franja en su orden: primero los roles conocidos, después
 *  los que el servidor añada. Solo los que tienen registro. */
export function filasDeSalud(salud: unknown): { rol: string; s: SaludModelo }[] {
  if (typeof salud !== 'object' || salud === null) return [];
  const tabla = salud as Record<string, unknown>;
  const conocidos = ORDEN_ROLES.filter((r) => esSalud(tabla[r])).map((r) => ({ rol: r as string, s: tabla[r] as SaludModelo }));
  const otros = Object.keys(tabla)
    .filter((r) => !(ORDEN_ROLES as readonly string[]).includes(r) && esSalud(tabla[r]))
    .sort()
    .map((r) => ({ rol: r, s: tabla[r] as SaludModelo }));
  return [...conocidos, ...otros];
}

export interface PropsVigilante {
  /** `estado.saludModelos`: falta en registros anteriores (vale `{}`). */
  salud: unknown;
  /** Incidencias de la corrida; aquí solo se pintan las `modelo_sin_respuesta` pendientes. */
  incidencias?: Incidencia[];
  estadoCorrida: EstadoCorrida;
  /** `corrida.esperandoModelo`; falta en corridas anteriores. */
  espera?: EsperaModelo | null;
  ahora: number;
  /** El "Reintentar ahora": `acciones.reanudarCorrida(corrida.id)`. */
  onReintentar?: () => void;
  /** Solo se pinta si hay algo que contar: un modelo que no responde o tarda,
   *  la espera de `esperando_modelo` o una incidencia automática. Con todos
   *  respondiendo no ocupa sitio (la corrida en vivo, 5 de octubre de 2026). */
  soloSiAlgoFalla?: boolean;
}

/** El resumen de la cabecera: separa los que no responden (rojo) de los que
 *  solo tardan (ámbar, y los estados que esta versión no conoce). Un modelo
 *  lento no se resume como caído: la fila de al lado diría lo contrario. */
export function resumenDeSalud(filas: { rol: string; s: SaludModelo }[]): string {
  if (filas.length === 0) return tr('todavía sin medir');
  const sinRespuesta = filas.filter((f) => f.s.estado === 'sin_respuesta').length;
  const lentos = filas.length - sinRespuesta - filas.filter((f) => f.s.estado === 'ok').length;
  const cuenta = (n: number, uno: string, varios: string) => (n === 1 ? `uno ${uno}` : `${n} ${varios}`);
  if (sinRespuesta === 0 && lentos === 0) return tr('todos responden');
  if (sinRespuesta === 0) return cuenta(lentos, tr('tarda en responder'), tr('tardan en responder'));
  const caidos = cuenta(sinRespuesta, tr('no responde'), tr('no responden'));
  if (lentos === 0) return `${caidos}; ROSA2018 reintenta sola`;
  return trp("{caidos} y {lentos}; ROSA2018 reintenta sola", { caidos, lentos: cuenta(lentos, 'tarda', 'tardan') });
}

/** La franja "Modelos". `saludModelos` es la salud de los modelos ahora, común
 *  a todas las corridas: solo se pinta bajo una corrida viva (en una cerrada
 *  hace días diría que "el juez no responde" como si fuera de esa corrida).
 *  Con la corrida viva y sin llamadas dice "Sin llamadas todavía". En una
 *  corrida cerrada solo se enseña lo que sí es suyo: una incidencia
 *  `modelo_sin_respuesta` que quedó pendiente al cerrar, si la hay. */
export function VigilanteModelos({ salud, incidencias = [], estadoCorrida, espera = null, ahora, onReintentar, soloSiAlgoFalla = false }: PropsVigilante) {
  const viva = estadoCorrida !== 'detenida' && estadoCorrida !== 'terminada';
  const filas = viva ? filasDeSalud(salud) : [];
  const automaticas = incidencias.filter((i) => i.tipo === 'modelo_sin_respuesta' && i.estado === 'pendiente').sort((a, b) => b.creadaEn - a.creadaEn);
  const esperando = estadoCorrida === 'esperando_modelo';
  if (!viva && automaticas.length === 0) return null;
  if (soloSiAlgoFalla && !esperando && automaticas.length === 0 && filas.every(({ s }) => significado(s.estado).tono === 'ok')) return null;
  return (
    <section className={`vigilante${esperando ? ' vigilante-esperando' : ''}`} aria-label={tr("Modelos")}>
      <div className="vigilante-cabecera">
        <h3>{tr("Modelos")}</h3>
        <span className="meta" title={tr("Los modelos de lenguaje del AI Gateway que ROSA2018 usa, por rol: el cerebro planifica y razona (GPT-6 Astra), el juez verifica (Claude Opus 5), el volumen lee y extrae en masa (Claude Sonnet 5). Cuando uno no responde, ROSA2018 reintenta con el mismo; no lo cambia por otro.")}>
          {viva ? resumenDeSalud(filas) : tr('la corrida está cerrada; la salud de los modelos se enseña en la corrida viva')}
        </span>
      </div>
      {!viva ? null : filas.length === 0 ? (
        <p className="meta vigilante-vacio">{tr("Sin llamadas todavía")}</p>
      ) : (
        <ul className="vigilante-lista">
          {filas.map(({ rol, s }) => {
            const sig = significado(s.estado);
            return (
              <li key={rol} className={`vigilante-fila vigilante-fila-${sig.tono}`}>
                <i className={`vigilante-punto vigilante-punto-${sig.tono}`} role="img" aria-label={`${nombreDeRol(rol)}: ${sig.etiqueta}`} title={sig.explicacion} />
                <span>{textoSalud(rol, s, ahora)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {esperando && <AvisoEsperandoModelo espera={espera} ahora={ahora} onReintentar={onReintentar} />}
      {automaticas.length > 0 && (
        <ul className="vigilante-incidencias" aria-label={tr("Incidencias que ROSA2018 resuelve sola")}>
          {automaticas.map((i) => (
            <li key={i.id} title={i.detalle}>
              <span className="chip chip-aviso">{(viva ? tr("resolviéndose solo") : tr("quedó abierta al cerrar la corrida"))}</span>
              <span>
                {i.titulo}
                {num(i.creadaEn) && ahora - i.creadaEn >= 1000 ? trp(" · desde hace {v}", { v: formatearDuracion(ahora - i.creadaEn) }) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** El aviso de `esperando_modelo`: qué modelo espera, cuándo comprobó por
 *  última vez y el botón para no esperar al próximo sondeo. */
export function AvisoEsperandoModelo({ espera, ahora, onReintentar }: { espera: EsperaModelo | null | undefined; ahora: number; onReintentar?: () => void }) {
  const nombre = nombreDeModelo(espera?.modelo);
  const ultima = num(espera?.ultimoSondeo) ? trp("última comprobación {ultimoSondeo}", { ultimoSondeo: horaCorta(espera?.ultimoSondeo) }) : num(espera?.proximoSondeo) ? trp("primera comprobación a las {proximoSondeo}", { proximoSondeo: horaCorta(espera?.proximoSondeo) }) : tr('todavía sin comprobación registrada');
  const detalles: string[] = [];
  if (num(espera?.desde)) detalles.push(trp("sin respuesta desde las {desde} ({v})", { desde: horaCorta(espera?.desde), v: formatearDuracion(Math.max(1000, ahora - (espera?.desde ?? ahora))) || tr('un momento') }));
  if (typeof espera?.intentos === 'number' && espera.intentos > 0) detalles.push((espera.intentos === 1 ? trp("{intentos} intento con {nombre}", { intentos: espera.intentos, nombre }) : trp("{intentos} intentos con {nombre}", { intentos: espera.intentos, nombre })));
  detalles.push(tr('el reloj de trabajo no corre mientras espera'));
  return (
    <div className="vigilante-aviso" role="status">
      <div className="vigilante-aviso-texto">
        <p>
          {trp("ROSA2018 espera a que {nombre} vuelva a responder. Sondea cada minuto y retomará sola; {ultima}.", { nombre, ultima })}</p>
        <p className="meta">{detalles.join(' · ')}.</p>
      </div>
      <button type="button" className="btn btn-primario btn-s" onClick={onReintentar} title={trp("Vuelve a intentarlo con {nombre} ahora mismo, sin esperar al próximo sondeo. No cambia de modelo.", { nombre })}>
        <IconPlay size={13} /> {tr("Reintentar ahora")}
      </button>
    </div>
  );
}
