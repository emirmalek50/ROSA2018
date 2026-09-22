import { describe, expect, it } from 'vitest';
import { distanciaParaEncuadrar, identidad, multiplicar, normal3, orbita, perspectiva, transformar } from './matriz4';

describe('las matrices de la cámara del cerebro', () => {
  it('la identidad no mueve un punto y multiplicar por ella no cambia nada', () => {
    const i = identidad();
    const p = transformar(i, [3, -4, 5]);
    expect([p.x, p.y, p.z]).toEqual([3, -4, 5]);
    const m = orbita(0.3, 0.2, 500);
    // Con decimales de precisión simple el producto arrastra unidades en el
    // último dígito: se compara con tolerancia, no con igualdad exacta.
    Array.from(multiplicar(m, i)).forEach((v, k) => expect(v).toBeCloseTo(m[k]!, 4));
    Array.from(multiplicar(i, m)).forEach((v, k) => expect(v).toBeCloseTo(m[k]!, 4));
  });

  it('la cámara en órbita deja el centro delante, a la distancia pedida, mire donde mire', () => {
    for (const [g, c] of [[0, 0], [0.7, 0.3], [-2.1, -0.8], [3.14, 0.9]]) {
      const v = orbita(g!, c!, 640, [10, -20, 30]);
      const centro = transformar(v, [10, -20, 30]);
      expect(centro.x).toBeCloseTo(0, 4);
      expect(centro.y).toBeCloseTo(0, 4);
      // En el sistema de la cámara, lo que se mira queda en la z negativa.
      expect(centro.z).toBeCloseTo(-640, 3);
    }
  });

  it('girar la guiñada mueve el objeto de lado y girar el cabeceo lo mueve arriba y abajo', () => {
    const derecha = transformar(orbita(0.5, 0, 800), [100, 0, 0]);
    const frente = transformar(orbita(0, 0, 800), [100, 0, 0]);
    expect(derecha.x).not.toBeCloseTo(frente.x, 1);
    expect(frente.y).toBeCloseTo(0, 5);
    const arriba = transformar(orbita(0, 0.5, 800), [0, 100, 0]);
    expect(arriba.y).toBeLessThan(100);
    expect(arriba.z).not.toBeCloseTo(-800, 1);
  });

  it('la perspectiva encoge lo lejano y deja lo cercano dentro del cubo de dibujo', () => {
    const p = perspectiva(Math.PI / 4, 16 / 9, 1, 4000);
    const cerca = transformar(p, [50, 0, -400]);
    const lejos = transformar(p, [50, 0, -1600]);
    expect(Math.abs(cerca.x)).toBeGreaterThan(Math.abs(lejos.x));
    expect(cerca.z).toBeGreaterThanOrEqual(-1);
    expect(cerca.z).toBeLessThanOrEqual(1);
    expect(lejos.z).toBeGreaterThan(cerca.z);
  });

  it('la matriz de normales es la inversa traspuesta: con un escalado desigual la normal sigue siendo perpendicular', () => {
    const escala = identidad();
    escala[0] = 4; escala[5] = 1; escala[10] = 1;
    const n = normal3(escala);
    // Una superficie inclinada 45 grados: la tangente (1, 1, 0) y su normal (1, -1, 0).
    const tangente = [4 * 1, 1 * 1, 0];
    const normal = [n[0]! * 1 + n[3]! * -1, n[1]! * 1 + n[4]! * -1, n[2]! * 1 + n[5]! * -1];
    const producto = tangente[0]! * normal[0]! + tangente[1]! * normal[1]! + tangente[2]! * normal[2]!;
    expect(producto).toBeCloseTo(0, 5);
  });

  it('con una rotación pura la matriz de normales es la propia rotación', () => {
    const v = orbita(0.9, -0.4, 700);
    const n = normal3(v);
    expect(n[0]).toBeCloseTo(v[0]!, 5);
    expect(n[4]).toBeCloseTo(v[5]!, 5);
    expect(n[8]).toBeCloseTo(v[10]!, 5);
  });

  it('la distancia de encuadre mete la esfera entera en el lienzo, también en uno estrecho', () => {
    const fov = Math.PI / 4;
    for (const aspecto of [16 / 9, 1, 0.5]) {
      const d = distanciaParaEncuadrar(120, fov, aspecto, 0.08);
      const vp = multiplicar(perspectiva(fov, aspecto, 1, 5000), orbita(0, 0, d));
      for (const p of [[120, 0, 0], [-120, 0, 0], [0, 120, 0], [0, -120, 0], [0, 0, 120], [0, 0, -120]] as const) {
        const q = transformar(vp, p);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('con números rotos devuelve matrices utilizables en vez de NaN', () => {
    const v = orbita(Number.NaN, Number.NaN, Number.NaN);
    expect(Array.from(v).every((x) => Number.isFinite(x))).toBe(true);
    const p = perspectiva(Number.NaN, 0, -5, -10);
    expect(Array.from(p).every((x) => Number.isFinite(x))).toBe(true);
    expect(Number.isFinite(distanciaParaEncuadrar(Number.NaN, Number.NaN, Number.NaN))).toBe(true);
    const q = transformar(identidad(), [Number.NaN, 2, 3]);
    expect(q.x).toBe(0);
  });
});
