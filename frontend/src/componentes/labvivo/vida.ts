// Lo que hace que el laboratorio se sienta un lugar y no un dibujo: la luz
// que cambia con la hora de verdad, lo que hace un personaje cuando no tiene
// trabajo, y los montones que crecen con las cifras del registro. Son las
// reglas puras; el motor (motor.ts) las dibuja. Regla de la casa: nada de
// esto puede parecer información que no exista. La luz es la hora del Mac,
// los montones son los recuentos guardados, y el ocio solo le toca a quien
// el servidor no tiene como activo (Emir, 8 de octubre de 2026: «como una
// oficina/laboratorio real»).

/** La luz del laboratorio según la hora real: de día no se tiñe; al
 *  atardecer entra ámbar; de noche azul y se encienden las lámparas; al
 *  amanecer vuelve. Continuo en minutos para que no salte a en punto. */
export interface Luz { tinte: string; alfa: number; lamparas: boolean; tramo: 'dia' | 'tarde' | 'noche' | 'amanecer' }
export function luzPorHora(hora: number, minuto = 0): Luz {
  const h = ((hora % 24) + 24) % 24 + Math.min(59, Math.max(0, minuto)) / 60;
  if (h >= 8 && h < 17) return { tinte: '#000000', alfa: 0, lamparas: false, tramo: 'dia' };
  if (h >= 17 && h < 19) {
    // 17:00 a 19:00: el ámbar sube de 0 a 0,2; las lámparas se encienden a las 18:30.
    const t = (h - 17) / 2;
    return { tinte: AMBAR, alfa: Math.round(t * 0.2 * 100) / 100, lamparas: h >= 18.5, tramo: 'tarde' };
  }
  if (h >= 19 && h < 20) {
    // 19:00 a 20:00: del ámbar al azul de la noche, sin corte.
    const t = h - 19;
    return { tinte: mezcla(AMBAR, AZUL, t), alfa: Math.round((0.2 + 0.1 * t) * 100) / 100, lamparas: true, tramo: 'tarde' };
  }
  if (h >= 20 || h < 6) return { tinte: AZUL, alfa: 0.3, lamparas: true, tramo: 'noche' };
  // 6:00 a 8:00: del azul de la noche a nada.
  const t = (h - 6) / 2;
  return { tinte: AZUL, alfa: Math.round((1 - t) * 0.3 * 100) / 100, lamparas: h < 7, tramo: 'amanecer' };
}
const AMBAR = '#FFB27A', AZUL = '#1B2A6B';
/** Un color entre dos, en hexadecimal, a `t` de 0 a 1. */
export function mezcla(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * k).toString(16).padStart(2, '0')).join('');
}

/** Lo que hace un personaje sin trabajo cuando le toca moverse. `estira`,
 *  `mira` y `cafe` ya existían; `rasca` (la cabeza), `gira` (la silla) y
 *  `hojea` (un papel) son gestos en el sitio; `cafetera` es ir a la máquina
 *  de la sala y volver, y solo si la sala tiene. Quien está sentado no se
 *  gira ni se levanta a por café en el sitio. */
export type Ocio = 'estira' | 'mira' | 'cafe' | 'rasca' | 'gira' | 'hojea' | 'cafetera';
export interface Gesto { k: Ocio; dur: number }
const DURACION: Record<Ocio, number> = { estira: 1.6, mira: 2.4, cafe: 4, rasca: 1.4, gira: 1.8, hojea: 2.6, cafetera: 7 };
export function elegirOcio(azar: () => number, o: { sentado: boolean; cafetera: boolean }): Gesto {
  const sentado: Ocio[] = ['estira', 'mira', 'rasca', 'hojea'];
  const dePie: Ocio[] = ['estira', 'mira', 'cafe', 'rasca', 'gira', 'hojea'];
  const base = o.sentado ? sentado : dePie;
  // La cafetera, pocas veces: una de cada cinco, para que no sea un desfile.
  const k = o.cafetera && azar() < 0.2 ? 'cafetera' : base[Math.floor(azar() * base.length)]!;
  return { k, dur: DURACION[k] };
}

/** Cuándo vuelve a moverse quien no trabaja: entre 8 y 34 segundos, sin
 *  ritmo de metrónomo (el azar no es uniforme: tira hacia los valores
 *  cortos, como en una oficina, donde la gente se mueve a ratos). */
export function siguienteOcio(azar: () => number, ahora: number): number {
  const u = azar();
  return ahora + 8 + 26 * u * u;
}

/** La altura de un montón según su cifra, de 0 a 1 y logarítmica: 12
 *  artículos son un folleto, 1.761 una torre, y 10.000 no es mucho más que
 *  2.000 (el tope). Sin cifra, nada. */
export function nivelDePila(n: number | null | undefined, tope = 2000): number {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, Math.log1p(n) / Math.log1p(tope));
}

/** Cuántas hojas se ven en una caja del juez (de `huecos` posibles) y si
 *  rebosa. Nunca más hojas que afirmaciones (tres son tres); por encima, las
 *  cajas se comparan entre sí: la más llena llega arriba y las demás a
 *  proporción logarítmica, para que 734 frente a 22 se vea como lo que es.
 *  Rebosa la que está arriba cuando pasa de cien. */
export function llenadoDeCaja(n: number, mayor: number, huecos = 9): { hojas: number; rebosa: boolean } {
  if (n <= 0 || mayor <= 0) return { hojas: 0, rebosa: false };
  const relativo = Math.max(1, Math.round((Math.log1p(n) / Math.log1p(mayor)) * huecos));
  return { hojas: Math.min(huecos, n, relativo), rebosa: n === mayor && n > 100 };
}

/** Si dos personajes se cruzan: `a` se mueve y pasa a menos de 44 px en
 *  horizontal y 30 en vertical de `b`, que está quieto. Devuelve hacia dónde
 *  tiene que mirar `b` (1 derecha, -1 izquierda) o 0 si no se cruzan. */
export function miradaAlCruzarse(a: { x: number; y: number }, b: { x: number; y: number }): -1 | 0 | 1 {
  const dx = a.x - b.x, dy = a.y - b.y;
  if (Math.abs(dx) > 44 || Math.abs(dy) > 30 || dx === 0) return 0;
  return dx > 0 ? 1 : -1;
}

/** Si alguien sentado levanta la vista: quien pasa va por delante de su
 *  mesa (más abajo en pantalla, a menos de 80 px) y cerca en horizontal. */
export function levantaLaVista(sentado: { x: number; y: number }, pasa: { x: number; y: number }): -1 | 0 | 1 {
  const dx = pasa.x - sentado.x, dy = pasa.y - sentado.y;
  if (dy < 20 || dy > 80 || Math.abs(dx) > 70 || dx === 0) return 0;
  return dx > 0 ? 1 : -1;
}

/** El parpadeo de un fluorescente: casi siempre 1; de vez en cuando un
 *  bajón breve. Determinista en el tiempo para que dos lámparas no
 *  parpadeen a la vez. */
export function parpadeo(t: number, semilla = 0): number {
  const s = Math.sin((t + semilla) * 13.7) + Math.sin((t + semilla) * 7.3);
  return s > 1.75 ? 0.55 : 1;
}
