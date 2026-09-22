// Las matrices de la cámara para el cerebro en tres dimensiones. Módulo puro,
// sin dependencias y probado aparte: el visor (componentes/Cerebro3D.tsx) solo
// las usa. WebGL espera las matrices POR COLUMNAS, es decir, los cuatro
// primeros números son la primera columna, no la primera fila; aquí se guardan
// así para poder pasarlas tal cual.
//
// Los conceptos por su nombre:
//
// - MATRIZ DE VISTA (orbita). Coloca la cámara. Se describe con los mismos
//   tres números que la vista 3D del árbol (lib/arbol3d.ts): GUIÑADA, el giro
//   alrededor del eje vertical; CABECEO, la inclinación arriba y abajo; y
//   DISTANCIA al centro. La cámara mira siempre al centro del objeto, así que
//   girar es mover la cámara por una esfera, no mover el cerebro.
// - MATRIZ DE PROYECCIÓN (perspectiva). Convierte lo que ve la cámara en el
//   cubo que dibuja la tarjeta gráfica. El ángulo de visión (fov) decide
//   cuánta perspectiva hay: pocos grados aplanan, muchos exageran.
// - MATRIZ DE NORMALES (normal3). Las normales de la superficie no se
//   transforman como los puntos: si la matriz tiene escalados distintos por
//   eje, hay que usar la inversa traspuesta de su parte 3x3, o la luz se
//   pega a la geometría equivocada.

export type Matriz4 = Float32Array;
export type Matriz3 = Float32Array;

const finito = (v: number, porDefecto = 0): number => (Number.isFinite(v) ? v : porDefecto);

export function identidad(): Matriz4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

/** El producto a por b, en el orden de las matrices por columnas: aplica antes b y después a. */
export function multiplicar(a: Matriz4, b: Matriz4): Matriz4 {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let f = 0; f < 4; f++) {
      let suma = 0;
      for (let k = 0; k < 4; k++) suma += (a[k * 4 + f] ?? 0) * (b[c * 4 + k] ?? 0);
      m[c * 4 + f] = suma;
    }
  }
  return m;
}

/** Perspectiva de una cámara con ángulo de visión vertical en radianes. */
export function perspectiva(fov: number, aspecto: number, cerca: number, lejos: number): Matriz4 {
  const f = 1 / Math.tan(Math.max(0.02, finito(fov, 0.9)) / 2);
  const a = Math.max(0.01, finito(aspecto, 1));
  const n = Math.max(0.01, finito(cerca, 1));
  const l = Math.max(n + 0.01, finito(lejos, 1000));
  const m = new Float32Array(16);
  m[0] = f / a;
  m[5] = f;
  m[10] = (l + n) / (n - l);
  m[11] = -1;
  m[14] = (2 * l * n) / (n - l);
  return m;
}

/** La vista de una cámara que orbita alrededor de `centro` mirándolo siempre:
 *  primero se lleva el centro al origen, después se deshacen la guiñada y el
 *  cabeceo, y al final se aparta la cámara por el eje z. */
export function orbita(guinada: number, cabeceo: number, distancia: number, centro: readonly [number, number, number] = [0, 0, 0]): Matriz4 {
  const g = finito(guinada);
  const c = finito(cabeceo);
  const d = Math.max(0.1, finito(distancia, 1));
  const cg = Math.cos(g), sg = Math.sin(g);
  const cc = Math.cos(c), sc = Math.sin(c);
  // Filas de la rotación: la traspuesta de girar el objeto, que es girar la cámara.
  const r = [
    [cg, 0, -sg],
    [sg * sc, cc, cg * sc],
    [sg * cc, -sc, cg * cc],
  ];
  const t = [finito(centro[0]), finito(centro[1]), finito(centro[2])];
  const m = new Float32Array(16);
  for (let f = 0; f < 3; f++) {
    for (let col = 0; col < 3; col++) m[col * 4 + f] = r[f]![col]!;
    m[12 + f] = -(r[f]![0]! * t[0]! + r[f]![1]! * t[1]! + r[f]![2]! * t[2]!);
  }
  m[14] = (m[14] ?? 0) - d;
  m[15] = 1;
  return m;
}

/** La parte 3x3 de una matriz, invertida y traspuesta, para las normales. Si
 *  la matriz no se puede invertir devuelve su 3x3 tal cual, que con rotaciones
 *  y traslaciones es exactamente lo mismo. */
export function normal3(m: Matriz4): Matriz3 {
  const a = m[0] ?? 1, b = m[1] ?? 0, c = m[2] ?? 0;
  const d = m[4] ?? 0, e = m[5] ?? 1, f = m[6] ?? 0;
  const g = m[8] ?? 0, h = m[9] ?? 0, i = m[10] ?? 1;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const salida = new Float32Array(9);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    salida.set([a, b, c, d, e, f, g, h, i]);
    return salida;
  }
  // La inversa traspuesta: la matriz de cofactores dividida por el determinante.
  salida[0] = (e * i - f * h) / det;
  salida[1] = (f * g - d * i) / det;
  salida[2] = (d * h - e * g) / det;
  salida[3] = (c * h - b * i) / det;
  salida[4] = (a * i - c * g) / det;
  salida[5] = (b * g - a * h) / det;
  salida[6] = (b * f - c * e) / det;
  salida[7] = (c * d - a * f) / det;
  salida[8] = (a * e - b * d) / det;
  return salida;
}

/** Un punto pasado por la matriz, con la división de perspectiva ya hecha.
 *  Devuelve las tres coordenadas del cubo de dibujo y su profundidad w. */
export function transformar(m: Matriz4, p: readonly [number, number, number]): { x: number; y: number; z: number; w: number } {
  const x = finito(p[0]), y = finito(p[1]), z = finito(p[2]);
  const cx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const cy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  const cz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 1);
  const k = Math.abs(w) < 1e-9 ? 1 : w;
  return { x: cx / k, y: cy / k, z: cz / k, w };
}

/** La distancia de cámara con la que una esfera de radio `radio` cabe entera
 *  en el lienzo, con un margen en tanto por uno (0,1 deja un diez por ciento). */
export function distanciaParaEncuadrar(radio: number, fov: number, aspecto: number, margen = 0.1): number {
  const r = Math.max(0.01, finito(radio, 1));
  const f = Math.max(0.02, finito(fov, 0.9));
  const a = Math.max(0.01, finito(aspecto, 1));
  // En vertical manda el ángulo tal cual; en horizontal, el ángulo que resulta del formato del lienzo.
  const fovH = 2 * Math.atan(Math.tan(f / 2) * a);
  const necesaria = Math.max(r / Math.sin(f / 2), r / Math.sin(fovH / 2));
  return necesaria * (1 + Math.max(0, finito(margen)));
}
