// Cuerpos sencillos generados por código para la escena del cerebro: el globo
// ocular, la gota de sangre y el tubo del intestino. No son anatomía medida
// (la fuente de las mallas no trae sangre ni intestino, y el ojo es de verdad
// una esfera), pero son los mismos tres compartimentos que el atlas 2D pone
// fuera del cerebro, y en la escena tienen que ser cuerpos, no pegatinas.
//
// Cada generador devuelve lo mismo que una malla leída de disco (posiciones,
// normales por vértice e índices de triángulos), así que el visor las sube a
// la tarjeta igual. Los conceptos:
//
// - ESFERA UV. Filas de paralelos y columnas de meridianos; la normal de cada
//   vértice es su dirección desde el centro, que en una esfera es exacta.
// - SÓLIDO DE REVOLUCIÓN (la gota). Un perfil plano (radio en función de la
//   altura) girado alrededor del eje vertical. La normal sale de la tangente
//   del perfil girada noventa grados, y después se lleva a cada meridiano.
// - TUBO A LO LARGO DE UNA CURVA (el intestino). En cada punto de la curva se
//   monta un marco (tangente, normal, binormal) y se pone un anillo de
//   vértices; anillos consecutivos se cosen con cuadriláteros y los extremos
//   se tapan con un abanico.
//
// Los triángulos van en sentido antihorario vistos desde fuera, como los de
// las mallas anatómicas, y el módulo es puro: sin DOM, sin WebGL.

export interface Forma {
  posiciones: Float32Array;
  normales: Float32Array;
  indices: Uint32Array;
}

export type Punto3 = readonly [number, number, number];

const finito = (v: number, porDefecto = 0): number => (Number.isFinite(v) ? v : porDefecto);

function empaquetar(pos: number[], nor: number[], ind: number[]): Forma {
  return { posiciones: Float32Array.from(pos), normales: Float32Array.from(nor), indices: Uint32Array.from(ind) };
}

/** Una esfera de radio `radio` centrada en `centro`. */
export function esfera(radio: number, centro: Punto3 = [0, 0, 0], filas = 20, columnas = 36): Forma {
  const r = Math.max(0.01, finito(radio, 1));
  const f = Math.max(3, Math.round(finito(filas, 20)));
  const c = Math.max(3, Math.round(finito(columnas, 36)));
  const pos: number[] = [];
  const nor: number[] = [];
  const ind: number[] = [];
  for (let i = 0; i <= f; i++) {
    const theta = (i / f) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j <= c; j++) {
      const phi = (j / c) * Math.PI * 2;
      const nx = st * Math.cos(phi);
      const ny = ct;
      const nz = st * Math.sin(phi);
      pos.push(finito(centro[0]) + nx * r, finito(centro[1]) + ny * r, finito(centro[2]) + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  const ancho = c + 1;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < c; j++) {
      const a = i * ancho + j;
      const b = a + ancho;
      // Dos triángulos por celda, antihorarios vistos desde fuera.
      if (i > 0) ind.push(a, a + 1, b);
      if (i < f - 1) ind.push(a + 1, b + 1, b);
    }
  }
  return empaquetar(pos, nor, ind);
}

/** El perfil de una gota: radio en función de la altura, de la base redonda
 *  (abajo) a la punta (arriba), en unidades del radio máximo. */
const PERFIL_GOTA: readonly (readonly [number, number])[] = [
  [0, -1], [0.5, -0.87], [0.8, -0.6], [0.96, -0.28], [1, 0.05], [0.95, 0.38], [0.8, 0.72], [0.6, 1.05], [0.4, 1.38], [0.22, 1.68], [0.08, 1.9], [0, 2],
];

/** Un sólido de revolución alrededor del eje vertical a partir de un perfil
 *  (radio, altura) que empieza y acaba en el eje. */
export function revolucion(perfil: readonly (readonly [number, number])[], escala: number, centro: Punto3 = [0, 0, 0], columnas = 36): Forma {
  const e = Math.max(0.01, finito(escala, 1));
  const c = Math.max(3, Math.round(finito(columnas, 36)));
  const n = perfil.length;
  if (n < 3) return empaquetar([], [], []);
  const pos: number[] = [];
  const nor: number[] = [];
  const ind: number[] = [];
  for (let i = 0; i < n; i++) {
    const [r0, y0] = perfil[i]!;
    // La tangente del perfil por diferencias centradas; la normal es la
    // tangente girada noventa grados hacia fuera.
    const [ra, ya] = perfil[Math.max(0, i - 1)]!;
    const [rb, yb] = perfil[Math.min(n - 1, i + 1)]!;
    let tr = rb - ra;
    let ty = yb - ya;
    const largo = Math.hypot(tr, ty) || 1;
    tr /= largo;
    ty /= largo;
    const nr = ty;
    const ny = -tr;
    for (let j = 0; j <= c; j++) {
      const phi = (j / c) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      pos.push(finito(centro[0]) + r0 * e * cp, finito(centro[1]) + y0 * e, finito(centro[2]) + r0 * e * sp);
      const ln = Math.hypot(nr, ny) || 1;
      nor.push((nr / ln) * cp, ny / ln, (nr / ln) * sp);
    }
  }
  const ancho = c + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < c; j++) {
      const a = i * ancho + j;
      const b = a + ancho;
      if (perfil[i]![0] > 0) ind.push(a, b, a + 1);
      if (perfil[i + 1]![0] > 0) ind.push(a + 1, b, b + 1);
    }
  }
  return empaquetar(pos, nor, ind);
}

/** Una gota de radio máximo `radio` con la base en el centro dado. */
export function gota(radio: number, centro: Punto3 = [0, 0, 0]): Forma {
  return revolucion(PERFIL_GOTA, radio, centro);
}

/** Un tubo de radio `radio` que sigue la curva dada, con los extremos tapados. */
export function tubo(curva: readonly Punto3[], radio: number, lados = 16): Forma {
  const r = Math.max(0.01, finito(radio, 1));
  const l = Math.max(3, Math.round(finito(lados, 16)));
  const n = curva.length;
  if (n < 2) return empaquetar([], [], []);
  const pos: number[] = [];
  const nor: number[] = [];
  const ind: number[] = [];
  const normalizar = (v: [number, number, number]): [number, number, number] => {
    const k = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / k, v[1] / k, v[2] / k];
  };
  const cruz = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  // El marco se arrastra a lo largo de la curva (transporte paralelo): el
  // vector normal de cada anillo parte del anterior, así no gira de golpe.
  let normalPrevia: [number, number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const p = curva[i]!;
    const a = curva[Math.max(0, i - 1)]!;
    const b = curva[Math.min(n - 1, i + 1)]!;
    const t = normalizar([finito(b[0]) - finito(a[0]), finito(b[1]) - finito(a[1]), finito(b[2]) - finito(a[2])]);
    let nrm: [number, number, number];
    if (normalPrevia) {
      // Se quita a la normal previa su componente sobre la tangente nueva.
      const d = normalPrevia[0] * t[0] + normalPrevia[1] * t[1] + normalPrevia[2] * t[2];
      nrm = normalizar([normalPrevia[0] - t[0] * d, normalPrevia[1] - t[1] * d, normalPrevia[2] - t[2] * d]);
    } else {
      const arriba: [number, number, number] = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      nrm = normalizar(cruz(cruz(t, arriba), t));
    }
    normalPrevia = nrm;
    const bin = normalizar(cruz(t, nrm));
    for (let j = 0; j <= l; j++) {
      const phi = (j / l) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const nx = nrm[0] * cp + bin[0] * sp;
      const ny = nrm[1] * cp + bin[1] * sp;
      const nz = nrm[2] * cp + bin[2] * sp;
      pos.push(finito(p[0]) + nx * r, finito(p[1]) + ny * r, finito(p[2]) + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  const ancho = l + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < l; j++) {
      const a = i * ancho + j;
      const b = a + ancho;
      ind.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // Las tapas: un vértice central por extremo con la normal a lo largo de la curva.
  for (const extremo of [0, n - 1]) {
    const p = curva[extremo]!;
    const vecino = curva[extremo === 0 ? 1 : n - 2]!;
    const hacia = normalizar([finito(p[0]) - finito(vecino[0]), finito(p[1]) - finito(vecino[1]), finito(p[2]) - finito(vecino[2])]);
    const centro = pos.length / 3;
    pos.push(finito(p[0]), finito(p[1]), finito(p[2]));
    nor.push(hacia[0], hacia[1], hacia[2]);
    const base = extremo * ancho;
    for (let j = 0; j < l; j++) {
      if (extremo === 0) ind.push(centro, base + j + 1, base + j);
      else ind.push(centro, base + j, base + j + 1);
    }
  }
  return empaquetar(pos, nor, ind);
}

/** Varias formas en una sola malla (los dos ojos, por ejemplo). */
export function unir(formas: readonly Forma[]): Forma {
  const pos: number[] = [];
  const nor: number[] = [];
  const ind: number[] = [];
  for (const f of formas) {
    const desplazamiento = pos.length / 3;
    pos.push(...f.posiciones);
    nor.push(...f.normales);
    for (const i of f.indices) ind.push(i + desplazamiento);
  }
  return empaquetar(pos, nor, ind);
}

/** La caja envolvente de una forma: minX, minY, minZ, maxX, maxY, maxZ. */
export function cajaDe(f: Forma): [number, number, number, number, number, number] {
  const caja: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < f.posiciones.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = f.posiciones[i + k]!;
      if (v < caja[k]!) caja[k] = v;
      if (v > caja[k + 3]!) caja[k + 3] = v;
    }
  }
  return Number.isFinite(caja[0]) ? caja : [0, 0, 0, 0, 0, 0];
}

/** El volumen con signo de una malla cerrada: positivo si los triángulos van
 *  antihorarios vistos desde fuera. Sirve para comprobar la orientación. */
export function volumenConSigno(f: Forma): number {
  let v = 0;
  const p = f.posiciones;
  for (let i = 0; i < f.indices.length; i += 3) {
    const a = f.indices[i]! * 3;
    const b = f.indices[i + 1]! * 3;
    const c = f.indices[i + 2]! * 3;
    v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  return v;
}
