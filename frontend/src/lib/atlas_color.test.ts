import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIDO_POR_DEFECTO, FRIO_POR_DEFECTO, hexARgb, mezclaOklab, OPACIDAD_FOCO, rellenoRegion, SUELO_OPACIDAD, tokenAtlas, TRAMO_OPACIDAD } from './atlas_color';

const CSS_ATLAS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../atlas.css'), 'utf8');

describe('el color de una región del atlas, la misma fórmula que atlas.css', () => {
  it('en los extremos devuelve exactamente el frío y el cálido de la hoja de estilos', () => {
    expect(mezclaOklab(CALIDO_POR_DEFECTO, FRIO_POR_DEFECTO, 0)).toEqual(hexARgb(FRIO_POR_DEFECTO));
    expect(mezclaOklab(CALIDO_POR_DEFECTO, FRIO_POR_DEFECTO, 1)).toEqual(hexARgb(CALIDO_POR_DEFECTO));
    expect(rellenoRegion(0).color).toBe('rgb(237, 196, 114)');
    expect(rellenoRegion(1).color).toBe('rgb(240, 160, 48)');
  });

  it('los valores por defecto son los de atlas.css tal como están escritos: los dos extremos, el suelo y el tramo de la opacidad y la opacidad del foco', () => {
    const token = (nombre: string) => CSS_ATLAS.match(new RegExp(`${nombre}:\\s*([^;]+);`))?.[1]?.trim();
    expect(token('--atlas-frio')).toBe(FRIO_POR_DEFECTO);
    expect(token('--atlas-calido')).toBe(CALIDO_POR_DEFECTO);
    const opacidad = CSS_ATLAS.match(/fill-opacity:\s*calc\(([\d.]+) \+ ([\d.]+) \* var\(--atlas-t, 0\)\)/);
    expect(Number(opacidad?.[1])).toBe(SUELO_OPACIDAD);
    expect(Number(opacidad?.[2])).toBe(TRAMO_OPACIDAD);
    // La regla del foco (hover, .atlas-foco, focus-visible) fija la opacidad que usa el 3D.
    const foco = CSS_ATLAS.match(/\.atlas-region:hover,\s*\.atlas-region\.atlas-foco,\s*\.atlas-region:focus-visible\s*\{[^}]*fill-opacity:\s*([\d.]+)/);
    expect(Number(foco?.[1])).toBe(OPACIDAD_FOCO);
  });

  it('la mezcla en oklab no es la mezcla lineal de canales (por eso el 3D, que caía a una mezcla lineal, salía de otro color que el 2D)', () => {
    // Con dos violetas muy distintos la diferencia es grande; con los dos ámbares de hoy es pequeña
    // pero existe. Se mide con dos colores lejanos para que el test siga diciendo lo que dice.
    const [r, g, b] = mezclaOklab('#f9b654', '#826cc2', 0.5);
    const lineal = [(249 + 130) / 2, (182 + 108) / 2, (84 + 194) / 2];
    const desvio = Math.abs(r - lineal[0]!) + Math.abs(g - lineal[1]!) + Math.abs(b - lineal[2]!);
    expect(desvio).toBeGreaterThan(3);
  });

  it('la rampa es monótona: más intensidad, más saturado (menos azul, no más verde) y la opacidad sube del suelo 0,3 al 0,9', () => {
    let anterior = rellenoRegion(0);
    for (let i = 1; i <= 10; i++) {
      const actual = rellenoRegion(i / 10);
      const [, g1, b1] = actual.color.match(/\d+/g)!.map(Number) as [number, number, number];
      const [, g0, b0] = anterior.color.match(/\d+/g)!.map(Number) as [number, number, number];
      expect(g1).toBeLessThanOrEqual(g0);
      expect(b1).toBeLessThanOrEqual(b0);
      expect(actual.opacidad).toBeGreaterThan(anterior.opacidad);
      anterior = actual;
    }
    expect(rellenoRegion(0).opacidad).toBe(SUELO_OPACIDAD);
    expect(rellenoRegion(1).opacidad).toBeCloseTo(SUELO_OPACIDAD + TRAMO_OPACIDAD, 6);
  });

  it('redondea como Atlas.tsx (p a entero por ciento, t a tres decimales) para dar el mismo píxel que el 2D', () => {
    expect(rellenoRegion(0.4249).color).toBe(rellenoRegion(0.42).color);
    expect(rellenoRegion(0.4251).color).toBe(rellenoRegion(0.43).color);
  });

  it('con foco sube un 30 % en la rampa, sin pasar del cálido, y la opacidad es la del foco (0,92)', () => {
    expect(rellenoRegion(0.2, { foco: true }).color).toBe(rellenoRegion(0.5).color);
    expect(rellenoRegion(0.9, { foco: true }).color).toBe(rellenoRegion(1).color);
    expect(rellenoRegion(0.2, { foco: true }).opacidad).toBe(OPACIDAD_FOCO);
  });

  it('un token inválido, un NaN o un valor fuera de 0..1 no rompen: caen a los valores por defecto y se acotan', () => {
    expect(rellenoRegion(Number.NaN).color).toBe(rellenoRegion(0).color);
    expect(rellenoRegion(7).color).toBe(rellenoRegion(1).color);
    expect(rellenoRegion(-3).color).toBe(rellenoRegion(0).color);
    expect(mezclaOklab('rgba(1,2,3,0.5)', 'no es un color', 1)).toEqual(hexARgb(CALIDO_POR_DEFECTO));
    expect(hexARgb('#abc')).toBeNull();
  });

  it('tokenAtlas devuelve el valor por defecto cuando el documento no lo define', () => {
    expect(tokenAtlas('--atlas-no-existe', '#123456')).toBe('#123456');
  });
});
