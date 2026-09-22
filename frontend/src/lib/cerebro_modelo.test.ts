// El modelo anatómico instalado en src/datos/cerebro3d, leído tal cual está en
// disco: que el índice sea válido, que cada malla exista y cuadre con lo que
// el índice dice de ella, y que el conjunto quepa donde el visor lo espera.
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encuadre, leerMalla, validarIndice } from './cerebro_malla';

const CARPETA = resolve(dirname(fileURLToPath(import.meta.url)), '../datos/cerebro3d');
const crudo = JSON.parse(readFileSync(resolve(CARPETA, 'indice.json'), 'utf8')) as unknown;
const indice = validarIndice(crudo)!;

describe('el modelo anatómico del cerebro instalado', () => {
  it('el índice es válido, con crédito, licencia libre y ejes declarados', () => {
    expect(indice).not.toBeNull();
    expect(indice.licencia).toMatch(/CC BY 4\.0/);
    expect(indice.atribucion).toContain('BodyParts3D');
    expect(indice.atribucion).toContain('Database Center for Life Science');
    expect(indice.ejes).toMatch(/x a la derecha/);
    expect(indice.unidad).toBe('milímetros');
  });

  it('trae las regiones del atlas que la fuente permite dibujar, con sus nombres en castellano y con tildes', () => {
    const claves = new Set(indice.estructuras.map((e) => e.clave));
    for (const esperada of ['corteza_prefrontal', 'corteza_parietal', 'corteza_temporal', 'corteza_occipital', 'cingulo_precuneo', 'hipocampo', 'amigdala', 'corteza_entorrinal', 'ganglios_basales_talamo', 'sustancia_blanca', 'lcr', 'tronco_locus_coeruleus', 'cerebelo', 'vascular_bhe']) {
      expect(claves.has(esperada), esperada).toBe(true);
    }
    const nombres = indice.estructuras.map((e) => e.nombre);
    expect(nombres).toContain('Amígdala');
    expect(nombres).toContain('Ínsula');
    for (const e of indice.estructuras) expect(e.clave).toMatch(/^[a-z_]+$/);
  });

  it('cada malla existe, se lee con el formato R2M1 y cuadra con lo que el índice dice de ella', () => {
    for (const e of indice.estructuras) {
      const bytes = readFileSync(resolve(CARPETA, e.fichero));
      const m = leerMalla(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      expect(m.vertices, e.fichero).toBe(e.vertices);
      expect(m.triangulos, e.fichero).toBe(e.triangulos);
      // La caja del índice es la de los vértices de verdad.
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < m.posiciones.length; i += 3) { minX = Math.min(minX, m.posiciones[i]!); maxX = Math.max(maxX, m.posiciones[i]!); }
      expect(minX, e.fichero).toBeCloseTo(e.caja[0], 0);
      expect(maxX, e.fichero).toBeCloseTo(e.caja[3], 0);
    }
  });

  it('el conjunto está centrado y cabe en unos 200 milímetros, y pesa menos de 6 MB', () => {
    const { centro, radio } = encuadre(indice.estructuras);
    expect(Math.abs(centro[0])).toBeLessThan(15);
    expect(Math.abs(centro[1])).toBeLessThan(15);
    expect(Math.abs(centro[2])).toBeLessThan(15);
    // El radio es la media diagonal de la caja de todo el conjunto: con el
    // cerebro entero y sus arterias sale algo por encima de los 140 mm.
    expect(radio).toBeGreaterThan(60);
    expect(radio).toBeLessThan(160);
    const peso = indice.estructuras.reduce((s, e) => s + statSync(resolve(CARPETA, e.fichero)).size, 0);
    expect(peso).toBeLessThan(6 * 1024 * 1024);
  });

  it('la licencia y el formato están documentados junto a los datos', () => {
    const licencia = readFileSync(resolve(CARPETA, 'LICENCIA.md'), 'utf8');
    expect(licencia).toContain('CC BY 4.0');
    expect(licencia).toContain('bulbo olfatorio');
    const formato = readFileSync(resolve(CARPETA, 'README.md'), 'utf8');
    expect(formato).toContain('R2M1');
  });
});
