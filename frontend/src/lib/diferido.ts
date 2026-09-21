// Tres utilidades para que la espera se vea (estándar de Emir, 19 de
// septiembre de 2026): un cálculo pesado que deja pintar el esqueleto antes
// de bloquear el hilo, un botón que sabe que está esperando respuesta, y una
// espera cuya respuesta no es la promesa del envío sino un cambio que llega
// después por el canal en vivo (useEsperaSenal).
//
// Cómo funciona el primero, porque no es evidente: React pinta en el
// siguiente frame después de un render. `requestAnimationFrame` corre ANTES
// de ese pintado, así que si el cálculo pesado se hiciera dentro del rAF, el
// navegador lo ejecutaría antes de enseñar el esqueleto y la persona vería la
// pantalla congelada igual que antes. Por eso se pide un frame (rAF) y, ya
// dentro, un `setTimeout(0)`: ese temporizador corre DESPUÉS del pintado. La
// secuencia queda así: render con esqueleto, pintado, cálculo, render con el
// contenido. Si el cálculo es corto (menos de 80 ms) el esqueleto vive un
// frame y el contenido lo sustituye sin parpadeo, porque el cambio es de
// silueta gris a contenido, no de contenido a nada.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Programa `fn` para después del siguiente pintado. Devuelve la función que
 *  lo cancela. Sin `requestAnimationFrame` (Node, pruebas sin DOM) encadena
 *  dos `setTimeout(0)`, que en la práctica equivalen. Se llama a rAF sin
 *  desprenderlo de `window`: desprendido lanza "Illegal invocation". */
function despuesDelPintado(fn: () => void): () => void {
  let cuadro: number | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const segundoPaso = () => {
    cuadro = null;
    temporizador = setTimeout(() => {
      temporizador = null;
      fn();
    }, 0);
  };
  if (typeof requestAnimationFrame === 'function') cuadro = requestAnimationFrame(segundoPaso);
  else temporizador = setTimeout(segundoPaso, 0);
  return () => {
    if (cuadro !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(cuadro);
    if (temporizador !== null) clearTimeout(temporizador);
    cuadro = null;
    temporizador = null;
  };
}

type Resultado<T> = { valor: T | null; calculando: boolean };

/** Ejecuta `calcular` fuera del render, después de que el esqueleto se haya
 *  pintado. En el primer render devuelve `calculando: true` y `valor: null`;
 *  cuando cambian las `deps` vuelve a `calculando: true` en ese mismo render
 *  (sin un frame intermedio con el indicador apagado) y conserva el `valor`
 *  anterior hasta que llega el nuevo, para que quien lo use pueda elegir:
 *  esqueleto siempre que `calculando` (cambio de investigación, cálculo
 *  largo) o solo cuando `valor === null` (primera carga, sin parpadeo en las
 *  actualizaciones pequeñas que llegan por el canal en vivo).
 *
 *  Si `calcular` lanza, el error se relanza en el render para que lo recoja
 *  el límite de errores (`Limite`) en vez de perderse como excepción de un
 *  temporizador. */
export function useCalculoDiferido<T>(calcular: () => T, deps: unknown[]): Resultado<T> {
  // Un objeto nuevo cada vez que cambian las deps: es la "versión" del cálculo.
  // Comparar la versión guardada con la actual dice si lo que hay es viejo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const version = useMemo<object>(() => ({}), deps);
  const [estado, setEstado] = useState<{ valor: T | null; version: object | null; error: unknown }>({ valor: null, version: null, error: null });
  const calcularRef = useRef(calcular);
  calcularRef.current = calcular;

  useEffect(() => {
    let vivo = true;
    const cancelar = despuesDelPintado(() => {
      if (!vivo) return;
      try {
        const valor = calcularRef.current();
        if (vivo) setEstado({ valor, version, error: null });
      } catch (error) {
        if (vivo) setEstado((actual) => ({ ...actual, version, error: error ?? new Error('El cálculo falló sin detalle') }));
      }
    });
    return () => {
      vivo = false;
      cancelar();
    };
  }, [version]);

  if (estado.error !== null && estado.version === version) throw estado.error;
  return { valor: estado.valor, calculando: estado.version !== version };
}

type Envolver = <A extends unknown[]>(fn: (...a: A) => Promise<unknown> | unknown) => (...a: A) => Promise<void>;

/** Para botones que esperan respuesta del servidor. Devuelve si hay algo en
 *  vuelo y una función que envuelve la acción: marca "en vuelo" hasta que la
 *  promesa termina (bien o mal) y, mientras tanto, ignora los clics repetidos
 *  para no duplicar el envío. Un rechazo se propaga a quien llama después de
 *  apagar la marca. Con `atributosEnVuelo` el botón gana `data-en-vuelo` y
 *  `aria-busy`, y el CSS (`.btn[data-en-vuelo='true']`) lo atenúa con un
 *  spinner mínimo a la izquierda. */
export function useEnVuelo(): [enVuelo: boolean, envolver: Envolver] {
  const [enVuelo, setEnVuelo] = useState(false);
  const ocupado = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const envolver = useCallback<Envolver>(
    (fn) =>
      async (...a) => {
        if (ocupado.current) return;
        ocupado.current = true;
        setEnVuelo(true);
        try {
          await fn(...a);
        } finally {
          ocupado.current = false;
          if (montado.current) setEnVuelo(false);
        }
      },
    [],
  );
  return [enVuelo, envolver];
}

/** Los atributos que marcan un botón en vuelo, para extenderlos en el JSX:
 *  `<button className="btn" {...atributosEnVuelo(enVuelo)}>`. Vacío cuando no
 *  hay nada en vuelo, para no dejar rastro en el DOM. */
export function atributosEnVuelo(enVuelo: boolean): { 'data-en-vuelo'?: 'true'; 'aria-busy'?: true } {
  return enVuelo ? { 'data-en-vuelo': 'true', 'aria-busy': true } : {};
}

type EsperaSenal = {
  /** Verdadero desde `pedir()` hasta que la señal cambia o vence el plazo. */
  esperando: boolean;
  /** Verdadero si la última espera venció sin que la señal cambiara; se apaga con la siguiente `pedir()`. */
  agotada: boolean;
  /** Empieza a esperar tomando como referencia la señal actual, o la que se
   *  pase (cuando la señal del render todavía no es la de lo que se pide). */
  pedir: (senalInicial?: string) => void;
};

/** Para acciones cuya respuesta real no es la promesa del POST sino algo que
 *  llega después por el canal en vivo: el dossier aparece como artefacto, la
 *  corrida cambia de estado. `senal` es la huella de ese cambio (por ejemplo
 *  "id del artefacto|número de versiones"); `pedir()` marca la espera con la
 *  huella de ese momento y la marca se apaga en cuanto la huella es otra, o
 *  cuando pasan `ms` sin cambio (entonces `agotada` queda encendida para que
 *  el botón lo diga). Se combina con useEnVuelo: la promesa cubre el viaje al
 *  servidor y la señal cubre lo que el servidor tarda en producir. */
export function useEsperaSenal(senal: string, ms: number): EsperaSenal {
  const [pedido, setPedido] = useState<{ senal: string; en: number } | null>(null);
  const [agotada, setAgotada] = useState(false);
  const senalActual = useRef(senal);
  senalActual.current = senal;
  useEffect(() => {
    if (pedido === null) return;
    if (senal !== pedido.senal) {
      setPedido(null);
      setAgotada(false);
      return;
    }
    const restante = Math.max(0, pedido.en + ms - Date.now());
    const temporizador = setTimeout(() => {
      setPedido(null);
      setAgotada(true);
    }, restante);
    return () => clearTimeout(temporizador);
  }, [pedido, senal, ms]);
  const pedir = useCallback((senalInicial?: string) => {
    setAgotada(false);
    setPedido({ senal: senalInicial ?? senalActual.current, en: Date.now() });
  }, []);
  return { esperando: pedido !== null, agotada, pedir };
}

/** Tope de tiempo para una petición aparte (espejo, costes, integridad,
 *  evidencia, búsqueda, correo): `fetch(url, { ...senalDeTope() })`. Si el
 *  servidor acepta la conexión y no responde nunca, la petición se aborta y
 *  la sección pasa a "no pude comprobar" en vez de quedarse en esqueleto.
 *  Sin `AbortSignal.timeout` (navegadores viejos, jsdom) no se pone tope y
 *  todo sigue como antes. */
export const MS_TOPE_PETICION = 20000;
export function senalDeTope(ms = MS_TOPE_PETICION): { signal?: AbortSignal } {
  const AS = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal;
  return AS && typeof AS.timeout === 'function' ? { signal: AS.timeout(ms) } : {};
}

/** Verdadero si el error viene del tope de tiempo (fetch abortado por
 *  `AbortSignal.timeout`): entonces el mensaje es "no respondió a tiempo",
 *  no "falló". */
export function esTiempoAgotado(error: unknown): boolean {
  const nombre = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return nombre === 'TimeoutError' || nombre === 'AbortError';
}
