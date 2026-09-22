import { describe, expect, it } from 'vitest';
import { CABECERA, encuadre, escribirMalla, leerMalla, MallaInvalida, validarIndice } from './cerebro_malla';

/** Un tetraedro: la malla más pequeña que es un cuerpo de verdad. */
const tetraedro = () => ({
  posiciones: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
  normales: new Float32Array([0, 0, -1, 1, 0, 0, 0, 1, 0, 0.577, 0.577, 0.577]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
});

describe('el lector del modelo del cerebro', () => {
  it('lo que escribe se vuelve a leer igual: mismas posiciones, normales y triángulos', () => {
    const original = tetraedro();
    const m = leerMalla(escribirMalla(original));
    expect(m.vertices).toBe(4);
    expect(m.triangulos).toBe(4);
    expect(Array.from(m.posiciones)).toEqual(Array.from(original.posiciones));
    expect(Array.from(m.normales)).toEqual(Array.from(original.normales));
    expect(Array.from(m.indices)).toEqual(Array.from(original.indices));
  });

  it('el fichero pesa lo que dice la cuenta: cabecera, posiciones, normales e índices', () => {
    const b = escribirMalla(tetraedro());
    expect(b.byteLength).toBe(CABECERA + 4 * 24 + 4 * 12);
  });

  it('rechaza un fichero sin la marca, cortado, vacío o con un índice que apunta fuera', () => {
    expect(() => leerMalla(new ArrayBuffer(4))).toThrow(MallaInvalida);
    const ajeno = new ArrayBuffer(64);
    new DataView(ajeno).setUint32(0, 0x12345678);
    expect(() => leerMalla(ajeno)).toThrow(/marca/);
    const cortado = escribirMalla(tetraedro()).slice(0, 40);
    expect(() => leerMalla(cortado)).toThrow(/bytes/);
    const roto = tetraedro();
    roto.indices = new Uint32Array([0, 1, 99, 0, 1, 2, 0, 2, 3, 1, 2, 3]);
    expect(() => leerMalla(escribirMalla(roto))).toThrow(/no existe/);
  });

  it('el índice válido conserva las estructuras y el crédito, y descarta las entradas sin clave o sin fichero', () => {
    const i = validarIndice({
      version: 1, fuente: 'Atlas de prueba', url: 'https://ejemplo', licencia: 'CC0 1.0',
      atribucion: 'Modelo anatómico de prueba', ejes: 'x a la derecha', unidad: 'milímetros',
      estructuras: [
        { clave: 'cerebelo', nombre: 'Cerebelo', fichero: 'cerebelo.bin', vertices: 10, triangulos: 12, caja: [-1, -2, -3, 1, 2, 3] },
        { nombre: 'sin clave', fichero: 'x.bin' },
        { clave: 'sin_fichero', nombre: 'no va' },
      ],
    });
    expect(i?.estructuras.length).toBe(1);
    expect(i?.estructuras[0]?.nombre).toBe('Cerebelo');
    expect(i?.atribucion).toBe('Modelo anatómico de prueba');
    expect(i?.licencia).toBe('CC0 1.0');
  });

  it('un índice que no sirve devuelve null en vez de romper la pantalla', () => {
    expect(validarIndice(null)).toBeNull();
    expect(validarIndice({})).toBeNull();
    expect(validarIndice({ estructuras: [] })).toBeNull();
    expect(validarIndice({ estructuras: [{ nombre: 'nada' }] })).toBeNull();
    expect(validarIndice('no soy un índice')).toBeNull();
  });

  it('el encuadre da el centro y el radio de todas las cajas juntas, y algo utilizable si vienen a cero', () => {
    const { centro, radio } = encuadre([
      { clave: 'a', nombre: 'a', fichero: 'a.bin', vertices: 1, triangulos: 1, caja: [-100, -50, -20, 0, 50, 20] },
      { clave: 'b', nombre: 'b', fichero: 'b.bin', vertices: 1, triangulos: 1, caja: [0, -10, -20, 100, 10, 60] },
    ]);
    expect(centro).toEqual([0, 0, 20]);
    expect(radio).toBeCloseTo(Math.hypot(200, 100, 80) / 2, 5);
    const vacio = encuadre([{ clave: 'a', nombre: 'a', fichero: 'a.bin', vertices: 0, triangulos: 0, caja: [0, 0, 0, 0, 0, 0] }]);
    expect(vacio.radio).toBe(100);
    expect(vacio.centro).toEqual([0, 0, 0]);
  });
});
