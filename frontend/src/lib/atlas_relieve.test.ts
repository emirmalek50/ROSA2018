import { describe, expect, it } from 'vitest';
import { construirRelieve, distanciaAlBorde, ondulacion, type Poligono } from './atlas_relieve';

/** Un círculo muestreado, como los que el componente saca de los trazados. */
const circulo = (cx: number, cy: number, r: number, n = 180): Poligono =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as const);

const alturaEn = (rel: ReturnType<typeof construirRelieve>, x: number, y: number): number => {
  const i = Math.round((x - rel.x0) / rel.paso);
  const j = Math.round((y - rel.y0) / rel.paso);
  return rel.nodos[(j * (rel.cols + 1) + i) * 3 + 2] ?? 0;
};

describe('el volumen del atlas: de silueta plana a hemisferio', () => {
  it('la altura es cero en el borde y sube hasta el semiancho en el centro, de modo que la silueta girada sigue siendo la del corte', () => {
    const rel = construirRelieve({ contorno: [circulo(300, 300, 200)], paso: 10, semiancho: 150, radio: 120, surco: 0 });
    expect(alturaEn(rel, 300, 300)).toBeCloseTo(150, 0);
    // Un nodo justo por dentro del borde: casi cero, nunca negativo.
    const borde = alturaEn(rel, 300 + 195, 300);
    expect(borde).toBeGreaterThanOrEqual(0);
    expect(borde).toBeLessThan(40);
    expect(rel.alturaMaxima).toBeGreaterThan(140);
    expect(rel.alturaMaxima).toBeLessThanOrEqual(150);
  });

  it('la altura crece de forma monótona del borde hacia dentro y alcanza el máximo a la distancia del radio', () => {
    const rel = construirRelieve({ contorno: [circulo(300, 300, 200)], paso: 10, semiancho: 150, radio: 120, surco: 0 });
    let anterior = -1;
    for (let d = 0; d <= 120; d += 10) {
      const h = alturaEn(rel, 300 + 200 - d, 300);
      expect(h).toBeGreaterThanOrEqual(anterior - 1);
      anterior = h;
    }
    expect(alturaEn(rel, 300 + 200 - 130, 300)).toBeCloseTo(150, 0);
  });

  it('fuera de la silueta no hay ni altura ni celdas: la malla no se sale del corte', () => {
    const rel = construirRelieve({ contorno: [circulo(300, 300, 150)], paso: 10, semiancho: 120, surco: 0 });
    expect(alturaEn(rel, 300, 40)).toBe(0);
    for (let c = 0; c < rel.total; c++) {
      const x = rel.centros[c * 3]!;
      const y = rel.centros[c * 3 + 1]!;
      expect(Math.hypot(x - 300, y - 300)).toBeLessThan(152);
    }
    expect(rel.total).toBeGreaterThan(100);
  });

  it('las normales apuntan hacia fuera del volumen y en la cima miran de plano al eje z', () => {
    const rel = construirRelieve({ contorno: [circulo(300, 300, 200)], paso: 10, semiancho: 150, radio: 120, surco: 0 });
    for (let c = 0; c < rel.total; c++) {
      const nz = rel.normales[c * 3 + 2]!;
      expect(nz).toBeGreaterThan(0);
      expect(Math.hypot(rel.normales[c * 3]!, rel.normales[c * 3 + 1]!, nz)).toBeCloseTo(1, 5);
    }
    // En el centro, la superficie es casi plana: su normal es casi (0, 0, 1).
    const centro = [...Array(rel.total).keys()].reduce((mejor, c) => (Math.hypot(rel.centros[c * 3]! - 300, rel.centros[c * 3 + 1]! - 300) < Math.hypot(rel.centros[mejor * 3]! - 300, rel.centros[mejor * 3 + 1]! - 300) ? c : mejor), 0);
    expect(rel.normales[centro * 3 + 2]).toBeGreaterThan(0.97);
  });

  it('una zona estrecha, como el tronco, no sale tan ancha como el resto, y el paso de una a otra no es un escalón', () => {
    const contorno = [circulo(300, 300, 200)];
    const tronco: Poligono = [[300, 300], [520, 300], [520, 520], [300, 520]];
    const rel = construirRelieve({ contorno, paso: 10, semiancho: 200, radio: 90, surco: 0, zonas: [{ clave: 'tronco', poligonos: [tronco], semiancho: 40 }] });
    const enTronco = alturaEn(rel, 400, 400);
    const enCerebro = alturaEn(rel, 220, 230);
    expect(enTronco).toBeLessThan(enCerebro * 0.6);
    // Entre los dos hay una transición: ningún salto mayor que el semiancho entre nodos vecinos.
    let saltoMaximo = 0;
    for (let j = 1; j < rel.filas; j++) {
      for (let i = 1; i < rel.cols; i++) {
        const k = j * (rel.cols + 1) + i;
        if (!rel.dentro[k] || !rel.dentro[k + 1]) continue;
        saltoMaximo = Math.max(saltoMaximo, Math.abs(rel.nodos[k * 3 + 2]! - rel.nodos[(k + 1) * 3 + 2]!));
      }
    }
    expect(saltoMaximo).toBeLessThan(40);
    expect(rel.zonas).toEqual(['tronco']);
    const celdasTronco = [...Array(rel.total).keys()].filter((c) => rel.zona[c] === 0);
    expect(celdasTronco.length).toBeGreaterThan(20);
  });

  it('los surcos ondulan la superficie por dentro pero no en el borde, para que la silueta no quede dentada', () => {
    const contorno = [circulo(300, 300, 200)];
    const liso = construirRelieve({ contorno, paso: 8, semiancho: 150, radio: 120, surco: 0 });
    const surcado = construirRelieve({ contorno, paso: 8, semiancho: 150, radio: 120, surco: 12, onda: 40 });
    let diferenciaDentro = 0;
    let diferenciaBorde = 0;
    for (let k = 0; k < liso.dentro.length; k++) {
      if (!liso.dentro[k]) continue;
      const d = Math.abs(liso.nodos[k * 3 + 2]! - surcado.nodos[k * 3 + 2]!);
      const x = liso.nodos[k * 3]!;
      const y = liso.nodos[k * 3 + 1]!;
      const alBorde = 200 - Math.hypot(x - 300, y - 300);
      if (alBorde > 60) diferenciaDentro = Math.max(diferenciaDentro, d);
      if (alBorde < 10) diferenciaBorde = Math.max(diferenciaBorde, d);
    }
    expect(diferenciaDentro).toBeGreaterThan(6);
    expect(diferenciaBorde).toBeLessThan(4);
    // Y con surcos la superficie deja de ser plana: hay normales inclinadas.
    const inclinadas = [...Array(surcado.total).keys()].filter((c) => surcado.normales[c * 3 + 2]! < 0.97).length;
    expect(inclinadas).toBeGreaterThan(surcado.total * 0.2);
  });

  it('es determinista: dos construcciones iguales dan la misma malla, así que dos pintadas dan la misma imagen', () => {
    const contorno = [circulo(300, 300, 160)];
    const a = construirRelieve({ contorno, paso: 9, semiancho: 140 });
    const b = construirRelieve({ contorno, paso: 9, semiancho: 140 });
    expect(Array.from(a.nodos)).toEqual(Array.from(b.nodos));
    expect(Array.from(a.normales)).toEqual(Array.from(b.normales));
    expect(a.total).toBe(b.total);
  });

  it('asigna a cada celda su región, y las que no caen en ninguna quedan en menos uno', () => {
    const contorno = [circulo(300, 300, 200)];
    const rel = construirRelieve({ contorno, paso: 10, semiancho: 150, regiones: [{ clave: 'frontal', poligonos: [circulo(230, 300, 60)] }, { clave: 'occipital', poligonos: [circulo(380, 300, 60)] }] });
    const claveEn = (x: number, y: number): string | null => {
      let mejor = -1;
      let dist = Infinity;
      for (let c = 0; c < rel.total; c++) {
        const d = Math.hypot(rel.centros[c * 3]! - x, rel.centros[c * 3 + 1]! - y);
        if (d < dist) { dist = d; mejor = c; }
      }
      const i = rel.region[mejor]!;
      return i >= 0 ? rel.regiones[i]! : null;
    };
    expect(claveEn(230, 300)).toBe('frontal');
    expect(claveEn(380, 300)).toBe('occipital');
    expect(claveEn(300, 440)).toBeNull();
  });

  it('con una silueta vacía o disparatada devuelve una malla vacía o mínima en vez de romperse', () => {
    expect(construirRelieve({ contorno: [] }).total).toBe(0);
    // Un polígono con un valor roto no encierra casi nada: la malla sale
    // diminuta y con cifras finitas, que es lo que se le pide.
    const rota = construirRelieve({ contorno: [[[Number.NaN, 3], [4, 5], [6, 7]]] });
    expect(rota.total).toBeLessThan(10);
    expect([...rota.nodos].every((v) => Number.isFinite(v))).toBe(true);
    const rel = construirRelieve({ contorno: [circulo(300, 300, 120)], paso: Number.NaN, semiancho: Number.NaN, radio: Number.NaN });
    expect(rel.total).toBeGreaterThan(0);
    expect(Number.isFinite(rel.alturaMaxima)).toBe(true);
  });

  it('la distancia al borde crece hacia el centro y vale cero fuera', () => {
    const dentro = new Uint8Array(11 * 11);
    for (let j = 2; j <= 8; j++) for (let i = 2; i <= 8; i++) dentro[j * 11 + i] = 1;
    const d = distanciaAlBorde(dentro, 10, 10, 2);
    expect(d[0]).toBe(0);
    expect(d[5 * 11 + 5]).toBeCloseTo(8, 5);
    expect(d[2 * 11 + 2]).toBeCloseTo(2, 5);
  });

  it('la ondulación es acotada, determinista y no repite una cuadrícula: dos filas separadas no coinciden', () => {
    for (let x = 0; x < 400; x += 7) expect(Math.abs(ondulacion(x, 120, 40))).toBeLessThanOrEqual(1);
    expect(ondulacion(123, 45, 40)).toBe(ondulacion(123, 45, 40));
    const fila = (y: number) => Array.from({ length: 60 }, (_, i) => Math.sign(ondulacion(i * 7, y, 40)));
    expect(fila(100).join('')).not.toBe(fila(180).join(''));
  });
});
