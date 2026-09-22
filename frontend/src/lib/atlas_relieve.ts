// El volumen del atlas: convierte la silueta plana del corte sagital en un
// HEMISFERIO, para que la vista de relieve no sea el dibujo 2D estirado hacia
// atrás como un sello de goma (Emir, 21 de septiembre de 2026: "en el 3d no
// sería mejor que la parte que no tiene diseño siga teniendo diseño? digo, los
// cerebros son 3d").
//
// Los conceptos, por su nombre:
//
// 1. MAPA DE ALTURAS (heightmap). El cuerpo se describe con una función
//    h(x, y): sobre cada punto del plano del corte, cuánto se aleja la
//    superficie exterior. El corte medial queda en z = 0 y el hemisferio crece
//    hacia z positiva (que en lib/arbol3d.ts es alejarse de la cámara). Así lo
//    que se ve de frente es exactamente el dibujo plano, y al girar aparece el
//    volumen. No es una reconstrucción: es el hemisferio derecho idealizado.
//
// 2. PERFIL DE CUARTO DE SENO. Un hemisferio cerebral es, en bruto, medio
//    elipsoide con una cara plana: la medial, por donde se toca con el otro
//    hemisferio. La altura sube desde el borde del corte hacia dentro con
//    h = A sen(u pi / 2), siendo u la distancia al borde entre el RADIO de
//    redondeo, acotada a 1. En el borde vale 0, de modo que la silueta de la
//    figura coincide con el contorno del corte desde cualquier ángulo; sube
//    con pendiente suave, sin el canto de moneda que deja un cuarto de elipse;
//    y llega al máximo con pendiente cero, sin arista en la cumbre.
//
// 3. DISTANCIA AL BORDE POR CHAMFER. La distancia de cada nodo de la rejilla
//    al exterior se calcula con dos pasadas (una hacia abajo y otra hacia
//    arriba) tomando el mínimo entre los vecinos ya resueltos más 1 en recto y
//    más raíz(2) en diagonal. Es lineal en el número de nodos y basta para un
//    redondeo; una distancia euclídea exacta costaría el cuadrado y no se
//    notaría.
//
// 4. SEMIANCHO POR ZONA. El tronco del encéfalo es estrecho (unos 20 mm de
//    ancho) y el cerebelo mucho más que él pero menos que el cerebro. Cada
//    zona trae su semiancho y el campo se suaviza con varias medias de los
//    vecinos, para que el tronco no salga como una losa ni el paso de una
//    zona a otra sea un escalón.
//
// 5. SURCOS. La superficie de un cerebro no es lisa. La altura se ondula con
//    bandas serpenteantes (una suma de senos con la fase curvada por otros
//    senos: barato, determinista y sin repetir cuadrícula), con la amplitud
//    multiplicada por el CUADRADO del perfil, de modo que junto al borde no
//    hay surcos y la silueta sigue siendo limpia. En el cerebelo las folias
//    son más finas: su zona lleva más frecuencia y menos amplitud.
//
// 6. FALDÓN DEL BORDE. Una rejilla cuadrada no termina donde termina la
//    silueta: si se descartan las celdas que asoman, el canto queda como una
//    escalera. Por eso los nodos de fuera que tocan el interior no se tiran:
//    se llevan al punto más cercano del contorno, con altura cero. La última
//    fila de cuadriláteros queda deformada pero el borde es el trazado real.
//
// 7. MALLA. La salida son cuadriláteros (una celda de la rejilla, sus cuatro
//    alturas) con su normal y su centro ya calculados, más a qué región y a
//    qué zona pertenece cada uno. La normal es la del cuadrilátero de verdad
//    (el producto vectorial de sus diagonales), que también vale para las
//    celdas deformadas del faldón. El componente solo proyecta, ordena de
//    lejos a cerca y pinta: por fotograma no se recalcula geometría.
//
// El módulo es puro: recibe polígonos ya muestreados (el componente los saca
// de los trazados con getTotalLength, que no existe fuera del navegador) y no
// toca el DOM, así que se puede probar entero.

export type Punto = readonly [number, number];
export type Poligono = readonly Punto[];

export interface ZonaRelieve {
  /** Nombre de la zona, para que el componente le dé su color de tejido. */
  clave: string;
  poligonos: readonly Poligono[];
  /** Mitad del ancho del hemisferio en esa zona, en unidades del lienzo. */
  semiancho: number;
  /** Amplitud de los surcos; si falta, la general. */
  surco?: number;
  /** Longitud de onda de los surcos; si falta, la general. */
  onda?: number;
}

export interface RegionRelieve {
  clave: string;
  poligonos: readonly Poligono[];
}

export interface OpcionesRelieve {
  /** La silueta: uno o varios polígonos cerrados, en el sistema del componente. */
  contorno: readonly Poligono[];
  /** Lado de la celda en unidades del lienzo. Menos es más fino y más caro. */
  paso?: number;
  /** Semiancho del hemisferio donde no manda ninguna zona. */
  semiancho?: number;
  /** A qué distancia del borde alcanza la altura su máximo. */
  radio?: number;
  zonas?: readonly ZonaRelieve[];
  regiones?: readonly RegionRelieve[];
  /** Amplitud general de los surcos. */
  surco?: number;
  /** Longitud de onda general de los surcos. */
  onda?: number;
}

export interface Relieve {
  paso: number;
  /** Nodos de la rejilla: (cols + 1) por (filas + 1). */
  cols: number;
  filas: number;
  x0: number;
  y0: number;
  /** Posición de cada nodo: x, y, z seguidos. */
  nodos: Float32Array;
  dentro: Uint8Array;
  /** Cuatro índices de nodo por celda, en el orden del cuadrilátero. */
  celdas: Int32Array;
  /** Normal unitaria de cada celda, hacia fuera del volumen. */
  normales: Float32Array;
  /** Centro de cada celda: x, y, z. */
  centros: Float32Array;
  /** Índice de la región de cada celda en `regiones`, o -1. */
  region: Int16Array;
  /** Índice de la zona de cada celda en `zonas`, o -1. */
  zona: Int16Array;
  regiones: string[];
  zonas: string[];
  /** Cuántas celdas tiene la malla. */
  total: number;
  /** La altura mayor del mapa, para encuadrar la cámara. */
  alturaMaxima: number;
}

const PASO_POR_DEFECTO = 11;
const SEMIANCHO_POR_DEFECTO = 232;
const RADIO_POR_DEFECTO = 150;
const SURCO_POR_DEFECTO = 9;
const ONDA_POR_DEFECTO = 44;
/** Cuántas medias de vecinos suavizan el semiancho entre zonas. */
const SUAVIZADOS = 4;
const RAIZ2 = Math.SQRT2;
const finito = (v: number, porDefecto = 0): number => (Number.isFinite(v) ? v : porDefecto);

/** Bandas onduladas que imitan las circunvoluciones: una suma de senos cuya
 *  fase se curva con otros senos de frecuencia baja, de modo que los surcos
 *  serpentean en vez de formar una cuadrícula. Determinista: el mismo punto da
 *  siempre el mismo valor, así que dos pintadas son idénticas. */
export function ondulacion(x: number, y: number, onda: number): number {
  const k = (2 * Math.PI) / Math.max(4, onda);
  const curva = 1.35 * Math.sin((x * 0.31 - y * 0.42) * k * 0.4) + 0.9 * Math.sin((x * 0.22 + y * 0.35) * k * 0.27 + 1.9);
  const bandas = Math.sin((x * 0.84 + y * 0.54) * k + curva);
  const finas = Math.sin((x * -0.36 + y * 0.93) * k * 1.7 + 2.2);
  return bandas * 0.76 + finas * 0.24;
}

/** Marca en `salida` los nodos de la rejilla que caen dentro de los polígonos,
 *  con la regla par e impar (la misma que evenodd en el lienzo). Va por filas:
 *  corta cada fila con todos los segmentos, ordena los cortes y rellena los
 *  tramos impares, que es mucho más barato que preguntar nodo por nodo. */
function marcarDentro(poligonos: readonly Poligono[], x0: number, y0: number, paso: number, cols: number, filas: number, salida: Int16Array | Uint8Array, valor: number): void {
  for (let j = 0; j <= filas; j++) {
    const y = y0 + j * paso;
    const cruces: number[] = [];
    for (const poly of poligonos) {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        const ay = finito(a[1]);
        const by = finito(b[1]);
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          cruces.push(finito(a[0]) + ((y - ay) / (by - ay)) * (finito(b[0]) - finito(a[0])));
        }
      }
    }
    if (cruces.length < 2) continue;
    cruces.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cruces.length; k += 2) {
      const desde = Math.max(0, Math.ceil((cruces[k]! - x0) / paso));
      const hasta = Math.min(cols, Math.floor((cruces[k + 1]! - x0) / paso));
      for (let i = desde; i <= hasta; i++) salida[j * (cols + 1) + i] = valor;
    }
  }
}

/** Distancia de cada nodo interior al exterior más cercano, en unidades del
 *  lienzo (transformada de distancia por chamfer, dos pasadas). */
export function distanciaAlBorde(dentro: Uint8Array, cols: number, filas: number, paso: number): Float32Array {
  const ancho = cols + 1;
  const d = new Float32Array(ancho * (filas + 1));
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = dentro[i] ? INF : 0;
  const mirar = (actual: number, i: number, j: number, coste: number): number => {
    if (i < 0 || j < 0 || i > cols || j > filas) return Math.min(actual, coste);
    return Math.min(actual, d[j * ancho + i]! + coste);
  };
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * ancho + i;
      if (!dentro[k]) continue;
      let v = d[k]!;
      v = mirar(v, i - 1, j, 1);
      v = mirar(v, i, j - 1, 1);
      v = mirar(v, i - 1, j - 1, RAIZ2);
      v = mirar(v, i + 1, j - 1, RAIZ2);
      d[k] = v;
    }
  }
  for (let j = filas; j >= 0; j--) {
    for (let i = cols; i >= 0; i--) {
      const k = j * ancho + i;
      if (!dentro[k]) continue;
      let v = d[k]!;
      v = mirar(v, i + 1, j, 1);
      v = mirar(v, i, j + 1, 1);
      v = mirar(v, i + 1, j + 1, RAIZ2);
      v = mirar(v, i - 1, j + 1, RAIZ2);
      d[k] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i]!, 1e6) * paso;
  return d;
}

/** El punto del contorno más cercano a uno dado, recorriendo sus segmentos.
 *  Con él, los nodos que asoman de la rejilla se apoyan en el trazado real. */
export function alContorno(poligonos: readonly Poligono[], x: number, y: number): Punto {
  let mejorX = x;
  let mejorY = y;
  let mejor = Infinity;
  for (const poly of poligonos) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      const ax = finito(a[0]);
      const ay = finito(a[1]);
      const dx = finito(b[0]) - ax;
      const dy = finito(b[1]) - ay;
      const largo = dx * dx + dy * dy;
      const t = largo > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / largo)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < mejor) { mejor = d; mejorX = px; mejorY = py; }
    }
  }
  return [mejorX, mejorY];
}

/** Varias medias de los vecinos interiores: quita los escalones entre zonas. */
function suavizar(campo: Float32Array, dentro: Uint8Array, cols: number, filas: number, veces: number): Float32Array {
  const ancho = cols + 1;
  let actual = campo;
  for (let paso = 0; paso < veces; paso++) {
    const siguiente = new Float32Array(actual.length);
    for (let j = 0; j <= filas; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * ancho + i;
        if (!dentro[k]) { siguiente[k] = actual[k]!; continue; }
        let suma = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii > cols || jj > filas) continue;
            const kk = jj * ancho + ii;
            if (!dentro[kk]) continue;
            suma += actual[kk]!;
            n++;
          }
        }
        siguiente[k] = n ? suma / n : actual[k]!;
      }
    }
    actual = siguiente;
  }
  return actual;
}

/** Construye la malla del hemisferio a partir de la silueta del corte. */
export function construirRelieve(op: OpcionesRelieve): Relieve {
  const paso = Math.max(3, finito(op.paso ?? PASO_POR_DEFECTO, PASO_POR_DEFECTO));
  const semianchoBase = Math.max(0, finito(op.semiancho ?? SEMIANCHO_POR_DEFECTO, SEMIANCHO_POR_DEFECTO));
  const radio = Math.max(paso, finito(op.radio ?? RADIO_POR_DEFECTO, RADIO_POR_DEFECTO));
  const surcoBase = Math.max(0, finito(op.surco ?? SURCO_POR_DEFECTO, SURCO_POR_DEFECTO));
  const ondaBase = Math.max(4, finito(op.onda ?? ONDA_POR_DEFECTO, ONDA_POR_DEFECTO));
  const zonas = op.zonas ?? [];
  const regiones = op.regiones ?? [];
  // El encuadre de la rejilla, con un nodo de margen para que el chamfer tenga exterior por los cuatro lados.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of op.contorno) {
    for (const p of poly) {
      const x = finito(p[0]);
      const y = finito(p[1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return { paso, cols: 0, filas: 0, x0: 0, y0: 0, nodos: new Float32Array(0), dentro: new Uint8Array(0), celdas: new Int32Array(0), normales: new Float32Array(0), centros: new Float32Array(0), region: new Int16Array(0), zona: new Int16Array(0), regiones: regiones.map((r) => r.clave), zonas: zonas.map((z) => z.clave), total: 0, alturaMaxima: 0 };
  }
  const x0 = minX - paso;
  const y0 = minY - paso;
  const cols = Math.ceil((maxX + paso - x0) / paso);
  const filas = Math.ceil((maxY + paso - y0) / paso);
  const ancho = cols + 1;
  const nNodos = ancho * (filas + 1);
  const dentro = new Uint8Array(nNodos);
  marcarDentro(op.contorno, x0, y0, paso, cols, filas, dentro, 1);
  const distancia = distanciaAlBorde(dentro, cols, filas, paso);
  // El faldón: los nodos de fuera con algún vecino dentro se llevan al
  // contorno, para que el canto siga el trazado y no la cuadrícula.
  const apoyo = new Float32Array(nNodos * 2);
  const enBorde = new Uint8Array(nNodos);
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * ancho + i;
      if (dentro[k]) continue;
      let toca = false;
      for (let dj = -1; dj <= 1 && !toca; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii > cols || jj > filas) continue;
          if (dentro[jj * ancho + ii]) { toca = true; break; }
        }
      }
      if (!toca) continue;
      const [ax, ay] = alContorno(op.contorno, x0 + i * paso, y0 + j * paso);
      apoyo[k * 2] = ax;
      apoyo[k * 2 + 1] = ay;
      enBorde[k] = 1;
    }
  }
  // Semiancho, amplitud y longitud de onda por nodo: la zona que lo contiene manda, y después se suavizan.
  const zonaDeNodo = new Int16Array(nNodos).fill(-1);
  zonas.forEach((z, i) => marcarDentro(z.poligonos, x0, y0, paso, cols, filas, zonaDeNodo, i));
  const semiancho = new Float32Array(nNodos);
  const amplitud = new Float32Array(nNodos);
  const onda = new Float32Array(nNodos);
  for (let k = 0; k < nNodos; k++) {
    const z = zonaDeNodo[k]!;
    const zona = z >= 0 ? zonas[z] : undefined;
    semiancho[k] = Math.max(0, finito(zona?.semiancho ?? semianchoBase, semianchoBase));
    amplitud[k] = Math.max(0, finito(zona?.surco ?? surcoBase, surcoBase));
    onda[k] = Math.max(4, finito(zona?.onda ?? ondaBase, ondaBase));
  }
  const semianchoSuave = suavizar(semiancho, dentro, cols, filas, SUAVIZADOS);
  const amplitudSuave = suavizar(amplitud, dentro, cols, filas, SUAVIZADOS);
  const ondaSuave = suavizar(onda, dentro, cols, filas, SUAVIZADOS);
  // La altura de cada nodo: el perfil del borde hacia dentro, más los surcos, que se apagan en el borde.
  const nodos = new Float32Array(nNodos * 3);
  let alturaMaxima = 0;
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * ancho + i;
      const x = x0 + i * paso;
      const y = y0 + j * paso;
      nodos[k * 3] = enBorde[k] ? apoyo[k * 2]! : x;
      nodos[k * 3 + 1] = enBorde[k] ? apoyo[k * 2 + 1]! : y;
      if (!dentro[k]) { nodos[k * 3 + 2] = 0; continue; }
      const u = Math.min(1, distancia[k]! / radio);
      const perfil = Math.sin((u * Math.PI) / 2);
      const z = semianchoSuave[k]! * perfil + ondulacion(x, y, ondaSuave[k]!) * amplitudSuave[k]! * perfil * perfil;
      const altura = Math.max(0, z);
      nodos[k * 3 + 2] = altura;
      if (altura > alturaMaxima) alturaMaxima = altura;
    }
  }
  // Las celdas con sus cuatro nodos dentro: las del borde se descartan y el
  // hueco lo tapa la propia silueta del corte, que se pinta debajo.
  const celdas: number[] = [];
  const centros: number[] = [];
  const normales: number[] = [];
  const regionCelda: number[] = [];
  const zonaCelda: number[] = [];
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * ancho + i;
      const b = a + 1;
      const c = a + ancho + 1;
      const d = a + ancho;
      const vale = (k: number) => dentro[k] || enBorde[k];
      if (!vale(a) || !vale(b) || !vale(c) || !vale(d)) continue;
      if (!dentro[a] && !dentro[b] && !dentro[c] && !dentro[d]) continue;
      celdas.push(a, b, c, d);
      centros.push(
        (nodos[a * 3]! + nodos[b * 3]! + nodos[c * 3]! + nodos[d * 3]!) / 4,
        (nodos[a * 3 + 1]! + nodos[b * 3 + 1]! + nodos[c * 3 + 1]! + nodos[d * 3 + 1]!) / 4,
        (nodos[a * 3 + 2]! + nodos[b * 3 + 2]! + nodos[c * 3 + 2]! + nodos[d * 3 + 2]!) / 4,
      );
      // Normal del cuadrilátero: el producto vectorial de sus diagonales, con
      // el signo puesto hacia fuera del volumen (z positiva).
      const ux = nodos[c * 3]! - nodos[a * 3]!;
      const uy = nodos[c * 3 + 1]! - nodos[a * 3 + 1]!;
      const uz = nodos[c * 3 + 2]! - nodos[a * 3 + 2]!;
      const vx = nodos[d * 3]! - nodos[b * 3]!;
      const vy = nodos[d * 3 + 1]! - nodos[b * 3 + 1]!;
      const vz = nodos[d * 3 + 2]! - nodos[b * 3 + 2]!;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const largo = Math.hypot(nx, ny, nz) || 1;
      normales.push(nx / largo, ny / largo, nz / largo);
      zonaCelda.push(dentro[a] ? zonaDeNodo[a]! : dentro[b] ? zonaDeNodo[b]! : dentro[c] ? zonaDeNodo[c]! : zonaDeNodo[d]!);
      regionCelda.push(-1);
    }
  }
  const nCeldas = celdas.length / 4;
  // A qué región pertenece cada celda: se marca en una rejilla desplazada
  // media celda, que es donde están los centros.
  if (nCeldas && regiones.length) {
    const marcas = new Int16Array(ancho * (filas + 1)).fill(-1);
    regiones.forEach((r, i) => marcarDentro(r.poligonos, x0 + paso / 2, y0 + paso / 2, paso, cols, filas, marcas, i));
    let n = 0;
    for (let j = 0; j < filas; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * ancho + i;
        const b = a + 1;
        const c = a + ancho + 1;
        const d = a + ancho;
        const vale = (k: number) => dentro[k] || enBorde[k];
        if (!vale(a) || !vale(b) || !vale(c) || !vale(d)) continue;
        if (!dentro[a] && !dentro[b] && !dentro[c] && !dentro[d]) continue;
        regionCelda[n] = marcas[a]!;
        n++;
      }
    }
  }
  return {
    paso, cols, filas, x0, y0, nodos, dentro,
    celdas: Int32Array.from(celdas),
    normales: Float32Array.from(normales),
    centros: Float32Array.from(centros),
    region: Int16Array.from(regionCelda),
    zona: Int16Array.from(zonaCelda),
    regiones: regiones.map((r) => r.clave),
    zonas: zonas.map((z) => z.clave),
    total: nCeldas,
    alturaMaxima,
  };
}
