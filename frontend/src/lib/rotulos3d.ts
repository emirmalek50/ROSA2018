// El reparto de los nombres alrededor del cerebro en tres dimensiones. Puro y
// probado aparte; el visor solo proyecta las anclas y pinta lo que sale.
//
// Cómo se colocan, como en una lámina anatómica: cada estructura tiene un
// ANCLA (su centro proyectado en pantalla). Las que caen a la izquierda del
// centro del lienzo se rotulan en una columna a la izquierda, y las demás en
// otra a la derecha; dentro de cada columna se ordenan por altura y se
// separan lo justo para que ningún rótulo pise a otro, empujando hacia abajo
// y, si la columna se sale por abajo, subiendo el bloque entero. Una guía une
// cada rótulo con su ancla. Así los nombres no se apilan al girar y se leen
// siempre, que era la queja del relieve.

export interface Ancla {
  clave: string;
  texto: string;
  /** El ancla en píxeles del lienzo lógico. */
  x: number;
  y: number;
  /** Prioridad para quedarse cuando no caben todos: mayor gana. */
  prioridad: number;
}

export interface Rotulo extends Ancla {
  /** Dónde va el texto. */
  rx: number;
  ry: number;
  lado: 'izquierda' | 'derecha';
}

export interface OpcionesRotulos {
  ancho: number;
  alto: number;
  /** Alto de una línea de rótulo, en píxeles. */
  paso: number;
  /** Cuántos píxeles separan la columna del borde del lienzo. */
  margen?: number;
  /** Cuántos caben por columna como mucho (los de menor prioridad se caen). */
  maximoPorColumna?: number;
}

const finito = (v: number, porDefecto = 0): number => (Number.isFinite(v) ? v : porDefecto);

/** Reparte los rótulos en dos columnas sin solapes. */
export function repartirRotulos(anclas: readonly Ancla[], op: OpcionesRotulos): Rotulo[] {
  const ancho = Math.max(1, finito(op.ancho, 1));
  const alto = Math.max(1, finito(op.alto, 1));
  const paso = Math.max(1, finito(op.paso, 14));
  const margen = Math.max(0, finito(op.margen ?? 16, 16));
  const tope = Math.max(1, Math.floor(finito(op.maximoPorColumna ?? Math.floor((alto - 2 * margen) / paso), 10)));
  const salida: Rotulo[] = [];
  for (const lado of ['izquierda', 'derecha'] as const) {
    const propias = anclas
      .filter((a) => (finito(a.x) < ancho / 2) === (lado === 'izquierda'))
      .sort((a, b) => b.prioridad - a.prioridad)
      .slice(0, tope)
      .sort((a, b) => finito(a.y) - finito(b.y));
    // Empujar hacia abajo lo que se pisa; después subir el bloque si se sale.
    const ys: number[] = [];
    for (const a of propias) {
      const deseada = Math.max(margen + paso / 2, Math.min(alto - margen - paso / 2, finito(a.y)));
      const minima = ys.length ? ys[ys.length - 1]! + paso : -Infinity;
      ys.push(Math.max(deseada, minima));
    }
    const exceso = ys.length ? ys[ys.length - 1]! - (alto - margen - paso / 2) : 0;
    if (exceso > 0) for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! - exceso;
    propias.forEach((a, i) => salida.push({ ...a, lado, rx: lado === 'izquierda' ? margen : ancho - margen, ry: ys[i]! }));
  }
  return salida;
}

/** Si dos rótulos de la misma columna se pisan (para las pruebas y para
 *  cualquier comprobación posterior). */
export function sePisan(a: Rotulo, b: Rotulo, paso: number): boolean {
  return a.lado === b.lado && Math.abs(a.ry - b.ry) < paso - 0.001;
}
