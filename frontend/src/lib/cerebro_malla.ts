// El lector del modelo del cerebro en tres dimensiones. Módulo puro: recibe
// bytes y devuelve geometría, sin tocar el DOM ni WebGL, para poder probarlo.
//
// El modelo son varias MALLAS DE SUPERFICIE, una por estructura anatómica (los
// lóbulos, el hipocampo, el tálamo, el tronco, el cerebelo...), todas en el
// mismo sistema de coordenadas. Cada malla es una lista de VÉRTICES (puntos en
// el espacio), una NORMAL por vértice (hacia dónde mira la superficie en ese
// punto, que es lo que decide cómo le da la luz) y una lista de TRIÁNGULOS
// (tres índices de vértice cada uno). Es el formato que entiende la tarjeta
// gráfica sin traducción.
//
// El fichero binario, en little endian, que es como lo lee cualquier máquina
// donde corre un navegador:
//   4 bytes  la marca ASCII R2M1
//   uint32   número de vértices
//   uint32   número de triángulos
//   uint32   banderas, reservado
//   float32  posiciones, tres por vértice
//   float32  normales, tres por vértice
//   uint32   índices, tres por triángulo
//
// Se eligió un binario y no un JSON porque una malla de veinte mil triángulos
// en texto pesa varias veces más y el navegador tendría que convertir número a
// número; así los bytes pasan tal cual a la tarjeta.

export interface Malla {
  posiciones: Float32Array;
  normales: Float32Array;
  indices: Uint32Array;
  vertices: number;
  triangulos: number;
}

export interface EstructuraCerebro {
  /** La clave de la región del atlas, para casarla con la evidencia. */
  clave: string;
  nombre: string;
  fichero: string;
  vertices: number;
  triangulos: number;
  /** minX, minY, minZ, maxX, maxY, maxZ. */
  caja: [number, number, number, number, number, number];
}

export interface IndiceCerebro {
  version: number;
  fuente: string;
  url: string;
  licencia: string;
  atribucion: string;
  ejes: string;
  unidad: string;
  estructuras: EstructuraCerebro[];
}

export const MARCA = 'R2M1';
/** Tamaño de la cabecera en bytes: la marca y tres enteros. */
export const CABECERA = 16;

export class MallaInvalida extends Error {}

const texto = (v: DataView, desde: number, largo: number): string => {
  let s = '';
  for (let i = 0; i < largo; i++) s += String.fromCharCode(v.getUint8(desde + i));
  return s;
};

/** Lee una malla del formato R2M1. Lanza MallaInvalida si los bytes no cuadran,
 *  para que la pantalla pueda decirlo en vez de pintar basura. */
export function leerMalla(buffer: ArrayBuffer): Malla {
  if (buffer.byteLength < CABECERA) throw new MallaInvalida('El fichero de la malla está cortado: no llega ni a la cabecera.');
  const v = new DataView(buffer);
  if (texto(v, 0, 4) !== MARCA) throw new MallaInvalida('El fichero no lleva la marca R2M1: no es una malla de ROSA2018.');
  const vertices = v.getUint32(4, true);
  const triangulos = v.getUint32(8, true);
  if (!vertices || !triangulos) throw new MallaInvalida('La malla viene sin vértices o sin triángulos.');
  const bytes = CABECERA + vertices * 12 * 2 + triangulos * 12;
  if (buffer.byteLength < bytes) throw new MallaInvalida(`La malla dice tener ${vertices} vértices y ${triangulos} triángulos, que son ${bytes} bytes, pero el fichero trae ${buffer.byteLength}.`);
  const posiciones = new Float32Array(buffer.slice(CABECERA, CABECERA + vertices * 12));
  const normales = new Float32Array(buffer.slice(CABECERA + vertices * 12, CABECERA + vertices * 24));
  const indices = new Uint32Array(buffer.slice(CABECERA + vertices * 24, CABECERA + vertices * 24 + triangulos * 12));
  for (let i = 0; i < indices.length; i++) {
    if (indices[i]! >= vertices) throw new MallaInvalida('La malla apunta a un vértice que no existe.');
  }
  return { posiciones, normales, indices, vertices, triangulos };
}

/** Escribe una malla en el formato R2M1. Se usa en las pruebas y sirve de
 *  documentación viva del formato para el guion que genera los ficheros. */
export function escribirMalla(m: { posiciones: Float32Array; normales: Float32Array; indices: Uint32Array }): ArrayBuffer {
  const vertices = m.posiciones.length / 3;
  const triangulos = m.indices.length / 3;
  const buffer = new ArrayBuffer(CABECERA + vertices * 24 + triangulos * 12);
  const v = new DataView(buffer);
  for (let i = 0; i < 4; i++) v.setUint8(i, MARCA.charCodeAt(i));
  v.setUint32(4, vertices, true);
  v.setUint32(8, triangulos, true);
  v.setUint32(12, 0, true);
  new Float32Array(buffer, CABECERA, vertices * 3).set(m.posiciones);
  new Float32Array(buffer, CABECERA + vertices * 12, vertices * 3).set(m.normales);
  new Uint32Array(buffer, CABECERA + vertices * 24, triangulos * 3).set(m.indices);
  return buffer;
}

const cadena = (o: Record<string, unknown>, clave: string): string => (typeof o[clave] === 'string' ? (o[clave] as string) : '');

/** Comprueba el índice que acompaña a las mallas. Devuelve null si no sirve,
 *  para que la pantalla enseñe su respaldo en lugar de romperse. */
export function validarIndice(dato: unknown): IndiceCerebro | null {
  if (!dato || typeof dato !== 'object') return null;
  const o = dato as Record<string, unknown>;
  const lista = Array.isArray(o.estructuras) ? o.estructuras : null;
  if (!lista) return null;
  const estructuras: EstructuraCerebro[] = [];
  for (const cruda of lista) {
    if (!cruda || typeof cruda !== 'object') continue;
    const e = cruda as Record<string, unknown>;
    const clave = cadena(e, 'clave');
    const fichero = cadena(e, 'fichero');
    if (!clave || !fichero) continue;
    const caja = Array.isArray(e.caja) && e.caja.length === 6 && e.caja.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (e.caja as [number, number, number, number, number, number]) : [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
    estructuras.push({
      clave,
      nombre: cadena(e, 'nombre') || clave,
      fichero,
      vertices: typeof e.vertices === 'number' ? e.vertices : 0,
      triangulos: typeof e.triangulos === 'number' ? e.triangulos : 0,
      caja,
    });
  }
  if (!estructuras.length) return null;
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    fuente: cadena(o, 'fuente'),
    url: cadena(o, 'url'),
    licencia: cadena(o, 'licencia'),
    atribucion: cadena(o, 'atribucion'),
    ejes: cadena(o, 'ejes'),
    unidad: cadena(o, 'unidad'),
    estructuras,
  };
}

/** El centro y el radio de todo el modelo, para encuadrar la cámara. Si las
 *  cajas vienen a cero, devuelve un radio de cien, que es un cerebro en
 *  milímetros: así la vista sigue siendo utilizable. */
export function encuadre(estructuras: readonly EstructuraCerebro[]): { centro: [number, number, number]; radio: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const e of estructuras) {
    const [a, b, c, d, f, g] = e.caja;
    if (a === 0 && b === 0 && c === 0 && d === 0 && f === 0 && g === 0) continue;
    minX = Math.min(minX, a); minY = Math.min(minY, b); minZ = Math.min(minZ, c);
    maxX = Math.max(maxX, d); maxY = Math.max(maxY, f); maxZ = Math.max(maxZ, g);
  }
  if (!Number.isFinite(minX) || maxX < minX) return { centro: [0, 0, 0], radio: 100 };
  const centro: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radio = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { centro, radio };
}
