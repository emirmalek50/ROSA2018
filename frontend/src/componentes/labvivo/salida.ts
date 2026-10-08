/** La hora de salir.
 *
 *  Cuando una corrida termina, el laboratorio no se congela: se vacía. La
 *  gente va saliendo de una en una por la puerta de su sala, y la sala que se
 *  queda sin nadie apaga la luz. Aquí están las reglas (quién se queda, en qué
 *  orden sale cada cual y cuándo), sin tocar el lienzo ni el reloj, que es lo
 *  que permite probarlas.
 *
 *  Dos decisiones que conviene no perder:
 *
 *  - La cuenta empieza cuando abres el laboratorio, no cuando terminó la
 *    corrida. Es ambiente, no un registro de hechos: si contara desde el final
 *    de verdad, quien entra una hora después se encontraría las salas ya
 *    vacías y no vería nada. Nada de esto afirma nada sobre el mundo.
 *  - No se van todos. Recepción entera se queda, porque son los que hablan
 *    contigo y tú estás ahí; y arriba quedan dos acabando. Una oficina vacía
 *    deprime más que una congelada; una oficina casi vacía, con dos lámparas
 *    encendidas y los tablones llenos de lo que se hizo, no.
 */

/** Recepción no cierra: el Asistente del chat, el Preguntador y el Traductor
 *  siguen ahí mientras tú estés mirando. */
export const SALA_QUE_NO_CIERRA = 'rec';

/** Los que se quedan hasta tarde: el Juez rematando y el Killer releyendo lo
 *  que descartó. Su sala no se apaga, se queda con la lámpara de su mesa. */
export const SE_QUEDAN: readonly string[] = ['Juez', 'Killer'];

/** El laboratorio se vacía por el orden en que cada sala hizo su parte: los
 *  que planificaron y buscaron primero, los que cerraron al final. */
export const ORDEN_SALIDA: readonly string[] = ['plan', 'r1', 'bib', 'r2', 'r3', 'r4', 'r5', 'r7', 'r6'];

export interface Persona { nombre: string; sala: string }
export interface Salida { nombre: string; t: number }

/** Quién no se va a su casa. */
export function seQueda(p: Persona): boolean {
  return p.sala === SALA_QUE_NO_CIERRA || SE_QUEDAN.includes(p.nombre) || p.nombre === 'Tú';
}

/** A qué segundo sale cada cual, contando desde que empieza el vaciado. Los de
 *  una misma sala salen seguidos, y entre sala y sala hay una pausa más larga:
 *  así cada cuarto se vacía como un grupo y su luz se apaga de golpe, en vez de
 *  irse goteando gente suelta por todas partes. */
export function planDeSalida(gente: readonly Persona[], o: { primera?: number; dentro?: number; entre?: number } = {}): Salida[] {
  const primera = o.primera ?? 5, dentro = o.dentro ?? 1.8, entre = o.entre ?? 3.5;
  const salidas: Salida[] = [];
  let t = primera;
  for (const sala of ORDEN_SALIDA) {
    const suyos = gente.filter((p) => p.sala === sala && !seQueda(p));
    if (!suyos.length) continue;
    for (const p of suyos) { salidas.push({ nombre: p.nombre, t }); t += dentro; }
    t += entre;
  }
  return salidas;
}

/** Una sala se queda a oscuras cuando ya no hay nadie dentro. Una sala sin
 *  gente asignada (no las hay hoy, pero podría haberlas) no se apaga sola. */
export function salaAOscuras(sala: string, gente: readonly { sala: string; fuera: boolean }[]): boolean {
  const dentro = gente.filter((p) => p.sala === sala);
  return dentro.length > 0 && dentro.every((p) => p.fuera);
}

/** Quién queda trabajando en una sala que ya se vació de los demás: es quien
 *  lleva la lámpara encendida. Null si la sala sigue llena o está a oscuras. */
export function elQueSeQuedo(sala: string, gente: readonly { nombre: string; sala: string; fuera: boolean }[]): string | null {
  const dentro = gente.filter((p) => p.sala === sala);
  const quedan = dentro.filter((p) => !p.fuera);
  return dentro.length > quedan.length && quedan.length === 1 ? quedan[0]!.nombre : null;
}
