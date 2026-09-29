// La oclusión ambiental de una malla, calculada una vez al cargarla
// (28 de septiembre de 2026).
//
// El problema: un cerebro es una superficie plegada, y lo que hace que se LEA
// como plegada es que los surcos estén oscuros. La luz del cielo no entra en
// una hendidura estrecha; en la cresta de una circunvolución entra entera. Sin
// eso, por mucha luz difusa y de borde que se le eche, la malla se ve como una
// masa lisa de plástico pintado: el relieve está en la geometría pero no en la
// imagen.
//
// Lo que se calcula aquí es un mapa de CAVIDAD por vértice, que es la
// aproximación barata y clásica de la oclusión ambiental para una superficie
// cerrada:
//
//   Para cada vértice, se mira hacia dónde caen sus vecinos respecto de su
//   propia normal. Si los vecinos quedan POR DELANTE de la normal (es decir,
//   la superficie se cierra sobre sí misma), el vértice está en el fondo de un
//   surco y recibe poca luz. Si quedan por detrás, está en una cresta y recibe
//   toda.
//
// Después se suaviza sobre el grafo de aristas varias veces. Ese suavizado es
// lo que separa esto de un simple realce de bordes: una pasada da un contorno
// duro, y cinco o seis reparten la sombra por el hueco entero, que es como se
// comporta la luz de verdad.
//
// Lo que NO es: no hay trazado de rayos ni visibilidad real, así que un
// pliegue no proyecta sombra sobre otro que esté lejos. Para una superficie
// cortical, donde casi toda la oclusión es local, la diferencia no se ve; para
// una escena con objetos separados, sí. Por eso se aplica a la malla del
// cerebro y no a los compartimentos generados por código.

/** Cuántas veces se reparte la sombra por el grafo de aristas. Con menos, el
 *  resultado parece un filtro de bordes; con muchas más, se emborrona y el
 *  relieve se pierde. Seis es donde los surcos se leen y las crestas siguen
 *  limpias. */
const PASADAS_DE_SUAVIZADO = 6;

/** Cuánto pesa el vecindario frente al valor propio en cada pasada. */
const MEZCLA = 0.72;

export interface OpcionesCavidad {
  /** Fuerza del efecto: 0 deja la malla como estaba, 1 es el máximo. */
  fuerza?: number;
  /** Suelo de luz: por muy hundido que esté un punto, no se va a negro. */
  minimo?: number;
}

/**
 * Devuelve un Float32Array con un valor de oclusión por vértice, de `minimo`
 * (fondo de surco) a 1 (expuesto del todo), listo para subirlo como atributo.
 *
 * `posiciones` y `normales` son XYZ intercalados (3 por vértice), como los que
 * ya usa el dibujo; `indices` son los triángulos.
 */
export function oclusionPorVertice(posiciones: Float32Array, normales: Float32Array, indices: Uint32Array | Uint16Array, opciones: OpcionesCavidad = {}): Float32Array {
  const fuerza = opciones.fuerza ?? 1;
  const minimo = opciones.minimo ?? 0.32;
  const n = Math.floor(posiciones.length / 3);
  const cavidad = new Float32Array(n);
  const cuenta = new Float32Array(n);
  if (n === 0 || indices.length === 0) return new Float32Array(n).fill(1);

  // Una arista aporta a sus dos extremos: cuánto se inclina el vecino hacia la
  // normal propia. Se recorre por triángulos para no construir una lista de
  // adyacencia, que con cientos de miles de vértices cuesta memoria y tiempo.
  const aportar = (a: number, b: number) => {
    const ax = posiciones[a * 3]!, ay = posiciones[a * 3 + 1]!, az = posiciones[a * 3 + 2]!;
    const bx = posiciones[b * 3]!, by = posiciones[b * 3 + 1]!, bz = posiciones[b * 3 + 2]!;
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const largo = Math.hypot(dx, dy, dz);
    if (largo < 1e-9) return;
    dx /= largo; dy /= largo; dz /= largo;
    cavidad[a]! += dx * normales[a * 3]! + dy * normales[a * 3 + 1]! + dz * normales[a * 3 + 2]!;
    cuenta[a]! += 1;
  };

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t]!, i1 = indices[t + 1]!, i2 = indices[t + 2]!;
    if (i0 >= n || i1 >= n || i2 >= n) continue;
    aportar(i0, i1); aportar(i1, i0);
    aportar(i1, i2); aportar(i2, i1);
    aportar(i2, i0); aportar(i0, i2);
  }

  // Media por vértice. Positivo = los vecinos se cierran por delante = surco.
  let bruto = new Float32Array(n);
  for (let i = 0; i < n; i++) bruto[i] = cuenta[i]! > 0 ? cavidad[i]! / cuenta[i]! : 0;

  // Repartir por el grafo de aristas: la luz que falta en un punto le falta
  // también a su alrededor inmediato.
  let destino = new Float32Array(n);
  for (let paso = 0; paso < PASADAS_DE_SUAVIZADO; paso++) {
    destino.fill(0);
    const vecinos = new Float32Array(n);
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const i0 = indices[t]!, i1 = indices[t + 1]!, i2 = indices[t + 2]!;
      if (i0 >= n || i1 >= n || i2 >= n) continue;
      destino[i0]! += bruto[i1]! + bruto[i2]!; vecinos[i0]! += 2;
      destino[i1]! += bruto[i0]! + bruto[i2]!; vecinos[i1]! += 2;
      destino[i2]! += bruto[i0]! + bruto[i1]!; vecinos[i2]! += 2;
    }
    for (let i = 0; i < n; i++) {
      const media = vecinos[i]! > 0 ? destino[i]! / vecinos[i]! : bruto[i]!;
      destino[i] = bruto[i]! * (1 - MEZCLA) + media * MEZCLA;
    }
    const intercambio = bruto; bruto = destino; destino = intercambio;
  }

  // Llevar el rango real de la malla a 0..1 por percentiles, no por mínimo y
  // máximo: un solo triángulo degenerado con un valor disparatado aplastaría
  // toda la escala y dejaría la malla plana otra vez.
  const orden = Float32Array.from(bruto).sort();
  const p = (q: number) => orden[Math.min(orden.length - 1, Math.max(0, Math.round(q * (orden.length - 1))))]!;
  const bajo = p(0.02);
  const alto = p(0.98);
  const rango = alto - bajo;

  const salida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 0 en la cresta más expuesta, 1 en el surco más hondo.
    const t = rango > 1e-9 ? Math.min(1, Math.max(0, (bruto[i]! - bajo) / rango)) : 0;
    // Curva suave: la oclusión no crece en línea recta con la profundidad.
    const suave = t * t * (3 - 2 * t);
    salida[i] = 1 - fuerza * (1 - minimo) * suave;
  }
  return salida;
}
