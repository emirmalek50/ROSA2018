// Que el chat baje solo mientras llega la respuesta, como en cualquier chat.
//
// Lo que hace que un chat se sienta vivo o roto es esto: cuando entra texto
// nuevo por abajo, la vista tiene que seguirlo; pero si la persona ha subido
// a releer algo, NO se le puede arrancar de ahí. La regla es la de ChatGPT,
// Claude y Kimi: se sigue el fondo solo si ya estábamos pegados a él.
//
// Antes el chat solo bajaba cuando cambiaba el NÚMERO de turnos. Mientras una
// respuesta estaba en marcha entraban treinta pasos y luego la respuesta
// entera, y el número no cambiaba: medido el 3 de octubre de 2026, el chat
// se quedó a 1616 px del fondo al terminar (Emir: «los chats no bajan solos
// con los mensajes»).

import { useEffect, useLayoutEffect, useRef } from 'react';

/** A menos de esto del fondo se considera «pegado», y el chat sigue bajando.
 *  Más lejos, la persona está leyendo arriba y se la deja en paz. */
export const PEGADO_PX = 140;
/** Cuando la persona ha tomado el mando (rueda arriba, dedo, tecla), solo
 *  vuelve a estar pegada si llega de verdad al fondo: a esta distancia. Con
 *  PEGADO_PX, un toque de rueda de 100 px la volvía a dar por pegada y la
 *  siguiente fila la arrastraba abajo (revisión del 6 de octubre de 2026). */
export const VUELTA_PX = 8;

export type Lector = {
  alto: () => number;
  arriba: () => number;
  ventana: () => number;
  /** Baja hasta `top`. La ventana real decide cómo: con el muelle, o de golpe
   *  si la persona pidió menos movimiento. */
  bajar: (top: number) => void;
  /** Si hay una bajada nuestra en curso: su scroll no es de la persona. */
  ocupado?: () => boolean;
  /** Para la bajada en curso, si la hay: al desmontar el chat o al apagarlo. */
  parar?: () => void;
};

// La bajada suave. El `behavior: 'smooth'` del navegador fija el destino al
// empezar: mientras las filas de la respuesta se abren el fondo se aleja, y
// cada paso nuevo cortaba la bajada y lanzaba otra, a tirones. Esto es un
// muelle con amortiguación crítica que persigue el fondo CADA cuadro: arranca
// sin salto, frena al llegar sin pasarse y, si el fondo sigue bajando
// (porque ROSA2018 sigue escribiendo), lo sigue sin cortes (Emir, 6 de
// octubre de 2026: «que vaya bajando, no de golpe»).
/** Rigidez del muelle, en rad/s: unos 0,6 s para cualquier distancia. */
const OMEGA = 11;
/** Quieto en el fondo este tiempo sin que crezca, la bajada termina. */
export const QUIETO_S = 0.6;

let bajada: { raf: number; y: number; v: number; t: number; quieto: number } | null = null;

/** A quién avisar cuando la persona toma el mando del scroll: cada chat
 *  montado deja aquí su «ya no estoy pegada». */
const alSoltar = new Set<() => void>();

const SUBE = new Set(['ArrowUp', 'PageUp', 'Home']);
const SE_ESCRIBE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const SE_PULSA = 'button, a, input, textarea, select, summary, [role="button"], [contenteditable=""], [contenteditable="true"]';

/** Si un evento es la persona tomando el mando del scroll. Una flecha
 *  dentro del cuadro de escribir mueve el cursor, no la página; un clic en un
 *  botón es usar el botón; solo el ratón sobre la propia página (la barra de
 *  desplazamiento) o el dedo fuera de un control cuentan. */
function tomaElMando(e: Event): boolean {
  const t = e.target;
  const el = t instanceof Element ? t : null;
  if (e instanceof WheelEvent) return e.deltaY < 0;
  if (e instanceof KeyboardEvent) return SUBE.has(e.key) && !(el && el.closest(SE_ESCRIBE));
  if (e.type === 'mousedown') return !el || el === document.documentElement || el === document.body;
  if (e.type === 'touchstart') return !(el && el.closest(SE_PULSA));
  return false;
}

function soltar(e: Event) {
  if (!tomaElMando(e)) return;
  suelta();
}

/** La persona manda: se para la bajada y cada chat se da por «no pegado»
 *  hasta que ella vuelva al fondo. */
function suelta() {
  pararBajada();
  for (const f of alSoltar) f();
}

const TOMAS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

function pararBajada() {
  if (!bajada) return;
  cancelAnimationFrame(bajada.raf);
  bajada = null;
  for (const t of TOMAS) window.removeEventListener(t, soltar);
}

function bajarSuave() {
  const el = document.scrollingElement;
  if (!el) return;
  if (bajada) {
    bajada.quieto = 0;
    return;
  }
  for (const t of TOMAS) window.addEventListener(t, soltar, { passive: true });
  bajada = { raf: 0, y: el.scrollTop, v: 0, t: performance.now(), quieto: 0 };
  const paso = (ahora: number) => {
    const b = bajada;
    if (!b) return;
    const dt = Math.min(0.032, Math.max(0.001, (ahora - b.t) / 1000));
    b.t = ahora;
    // Si otro movió el scroll, manda él. Hacia arriba (la barra arrastrada)
    // es la persona: además de parar, deja de estar pegada. Hacia abajo (un
    // salto a un ancla, la página que se recoloca) solo se para: si quedó
    // cerca del fondo, la siguiente fila la vuelve a seguir.
    if (el.scrollTop < b.y - 3) return suelta();
    if (el.scrollTop > b.y + 3) return pararBajada();
    const fondo = Math.max(0, el.scrollHeight - window.innerHeight);
    const d = fondo - b.y;
    if (Math.abs(d) < 0.5 && Math.abs(b.v) < 8) {
      b.y = fondo;
      b.v = 0;
      b.quieto += dt;
    } else {
      b.quieto = 0;
      b.v += (OMEGA * OMEGA * d - 2 * OMEGA * b.v) * dt;
      b.y = Math.min(fondo, b.y + b.v * dt);
    }
    window.scrollTo(0, b.y);
    if (b.quieto > QUIETO_S) pararBajada();
    else b.raf = requestAnimationFrame(paso);
  };
  bajada.raf = requestAnimationFrame(paso);
}

function sinMovimiento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const ventana: Lector = {
  alto: () => document.scrollingElement?.scrollHeight ?? 0,
  arriba: () => document.scrollingElement?.scrollTop ?? 0,
  ventana: () => window.innerHeight,
  bajar: (top) => {
    if (!sinMovimiento() && typeof requestAnimationFrame === 'function') bajarSuave();
    else {
      pararBajada();
      window.scrollTo({ top });
    }
  },
  ocupado: () => bajada !== null,
  parar: pararBajada,
};

export function distanciaAlFondo(l: Lector = ventana): number {
  return Math.max(0, l.alto() - l.arriba() - l.ventana());
}

/** Sigue el fondo de la página mientras `contenido` cambie o la página
 *  crezca, si estábamos pegados a él. `forzar` cambia cuando la persona manda
 *  un mensaje: ahí se baja siempre, esté donde esté, porque es ella quien
 *  acaba de hablar; y también en suave, recorriendo el chat hasta su mensaje
 *  en vez de aparecer allí de golpe. */
export function useSeguirFondo(contenido: unknown, forzar: unknown, activo = true, l: Lector = ventana): void {
  // Si estábamos pegados ANTES de que el DOM creciera: se mide en el
  // layout effect, que corre antes de pintar, con el alto nuevo ya en el DOM
  // pero el scroll aún en su sitio.
  const pegadoAntes = useRef(true);
  // La persona tomó el mando (rueda arriba, dedo, tecla, barra): hasta que
  // vuelva al fondo de verdad no se la da por pegada aunque esté cerca.
  const suelto = useRef(false);
  const ultimoForzar = useRef(forzar);
  useLayoutEffect(() => {
    if (!activo) return;
    const forzado = ultimoForzar.current !== forzar;
    ultimoForzar.current = forzar;
    if (forzado || pegadoAntes.current) {
      pegadoAntes.current = true;
      suelto.current = false;
      l.bajar(l.alto());
    }
  }, [contenido, forzar, activo, l]);
  // Lo que crece SIN que cambie `contenido`: las filas que se abren en
  // altura, las que gotean una a una, la respuesta que se despliega. Y la
  // escucha de «la persona tomó el mando». Al desmontar o apagar, la bajada
  // en curso se para: si no, seguía bajando la pantalla a la que se cambió
  // (revisión del 6 de octubre de 2026).
  useEffect(() => {
    if (!activo) return;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (pegadoAntes.current) l.bajar(l.alto());
    }) : null;
    ro?.observe(document.body);
    const soltada = () => {
      pegadoAntes.current = false;
      suelto.current = true;
    };
    alSoltar.add(soltada);
    return () => {
      ro?.disconnect();
      alSoltar.delete(soltada);
      l.parar?.();
    };
  }, [activo, l]);
  // Y se recuerda, en cada scroll de la persona, si sigue pegada o se ha ido.
  // Los scrolls de nuestra propia bajada no cuentan: mientras el muelle
  // corre, `ocupado()` lo dice.
  useEffect(() => {
    if (!activo) return;
    const mirar = () => {
      if (l.ocupado?.()) return;
      const d = distanciaAlFondo(l);
      if (suelto.current) {
        if (d >= VUELTA_PX) return;
        suelto.current = false;
      }
      pegadoAntes.current = d < PEGADO_PX;
    };
    window.addEventListener('scroll', mirar, { passive: true });
    return () => window.removeEventListener('scroll', mirar);
  }, [activo, l]);
}
