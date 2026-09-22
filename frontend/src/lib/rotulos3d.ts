// La colocación de los nombres junto a las estructuras del cerebro en tres
// dimensiones. Puro y probado aparte; el visor solo proyecta las anclas, mide
// los textos y pinta lo que sale.
//
// Cómo se colocan: cada estructura tiene un ANCLA (su centro proyectado en
// pantalla). El rótulo se pone PEGADO a ella, desplazado un poco hacia fuera
// del centro del cerebro para no taparla, con una guía corta. Si al ponerlo
// pisa a otro ya colocado, se aleja por esa misma dirección radial paso a
// paso hasta que cabe; si no cabe en unos pocos pasos, se omite, y los de
// mayor prioridad (la estructura mirada, después las que tienen registros)
// se colocan primero para que sean ellos los que se quedan. Así los nombres
// se leen junto a lo que nombran, como en una lámina anatómica, y no en
// columnas con líneas cruzando la pantalla (Emir, 22 de septiembre de 2026:
// "las líneas con los nombres se ven horrible y ni ganas dan de leerlos").

export interface Ancla {
  clave: string;
  texto: string;
  /** El ancla en píxeles del lienzo. */
  x: number;
  y: number;
  /** Ancho y alto de la caja del texto, en píxeles (los mide el lienzo). */
  ancho: number;
  alto: number;
  /** Prioridad para quedarse cuando no caben todos: mayor gana. */
  prioridad: number;
}

export interface Rotulo extends Ancla {
  /** Esquina superior izquierda de la caja del texto. */
  cx: number;
  cy: number;
  /** El punto de la caja donde llega la guía. */
  gx: number;
  gy: number;
}

export interface OpcionesRotulos {
  ancho: number;
  alto: number;
  /** El centro del cerebro en pantalla: de él se alejan los rótulos. */
  centroX: number;
  centroY: number;
  /** A cuántos píxeles del ancla arranca el rótulo. */
  separacion?: number;
  /** Cuánto se aleja en cada intento si pisa a otro. */
  paso?: number;
  /** Cuántos intentos antes de omitirlo. */
  intentos?: number;
  /** Margen entre cajas para que no se toquen. */
  holgura?: number;
}

const finito = (v: number, porDefecto = 0): number => (Number.isFinite(v) ? v : porDefecto);

interface Caja { x: number; y: number; w: number; h: number }

const chocan = (a: Caja, b: Caja, holgura: number): boolean =>
  a.x < b.x + b.w + holgura && a.x + a.w + holgura > b.x && a.y < b.y + b.h + holgura && a.y + a.h + holgura > b.y;

/** Coloca los rótulos junto a sus anclas sin que se pisen. */
export function colocarRotulos(anclas: readonly Ancla[], op: OpcionesRotulos): Rotulo[] {
  const ancho = Math.max(1, finito(op.ancho, 1));
  const alto = Math.max(1, finito(op.alto, 1));
  const cX = finito(op.centroX, ancho / 2);
  const cY = finito(op.centroY, alto / 2);
  const separacion = Math.max(0, finito(op.separacion ?? 18, 18));
  const paso = Math.max(1, finito(op.paso ?? 10, 10));
  const intentos = Math.max(1, Math.round(finito(op.intentos ?? 14, 14)));
  const holgura = Math.max(0, finito(op.holgura ?? 4, 4));
  const puestas: Caja[] = [];
  const salida: Rotulo[] = [];
  const ordenadas = [...anclas]
    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
    .sort((a, b) => b.prioridad - a.prioridad);
  for (const a of ordenadas) {
    const w = Math.max(1, finito(a.ancho, 1));
    const h = Math.max(1, finito(a.alto, 1));
    // La dirección de huida: del centro del cerebro hacia el ancla. Si el
    // ancla está en el centro, hacia arriba.
    let dx = a.x - cX;
    let dy = a.y - cY;
    const largo = Math.hypot(dx, dy);
    if (largo < 1) { dx = 0; dy = -1; } else { dx /= largo; dy /= largo; }
    let colocado: Caja | null = null;
    let haciaDerecha = dx >= 0;
    // A cada distancia se prueba primero el radio y después un abanico de
    // ángulos a un lado y a otro: varias estructuras juntas no huyen todas
    // por la misma línea, sino que rodean el cúmulo.
    for (let k = 0; k < intentos && !colocado; k++) {
      const d = separacion + k * paso;
      for (const giro of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
        const ux = dx * Math.cos(giro) - dy * Math.sin(giro);
        const uy = dx * Math.sin(giro) + dy * Math.cos(giro);
        const gx = a.x + ux * d;
        const gy = a.y + uy * d;
        const derecha = ux >= 0;
        const caja: Caja = { x: derecha ? gx + 4 : gx - 4 - w, y: gy - h / 2, w, h };
        // Dentro del lienzo.
        caja.x = Math.max(2, Math.min(ancho - w - 2, caja.x));
        caja.y = Math.max(2, Math.min(alto - h - 2, caja.y));
        if (!puestas.some((p) => chocan(caja, p, holgura))) { colocado = caja; haciaDerecha = derecha; break; }
      }
    }
    if (!colocado) continue;
    puestas.push(colocado);
    // La guía termina en el lado de la caja que mira al ancla.
    const gx = haciaDerecha ? colocado.x - 2 : colocado.x + colocado.w + 2;
    const gy = colocado.y + colocado.h / 2;
    salida.push({ ...a, cx: colocado.x, cy: colocado.y, gx, gy });
  }
  return salida;
}

/** Si dos rótulos se pisan (para las pruebas y para cualquier comprobación posterior). */
export function sePisan(a: Rotulo, b: Rotulo, holgura = 0): boolean {
  return chocan({ x: a.cx, y: a.cy, w: a.ancho, h: a.alto }, { x: b.cx, y: b.cy, w: b.ancho, h: b.alto }, holgura);
}
