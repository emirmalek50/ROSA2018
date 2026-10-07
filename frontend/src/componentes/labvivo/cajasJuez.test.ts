import { beforeEach, expect, it, vi } from 'vitest';
import { fijarIdioma } from '../../lib/idioma';
import { dibujarCajasJuez, resumenCajasJuez } from './cajasJuez';

beforeEach(() => fijarIdioma('es'));
function lienzo() {
  const rectangulos: { color: string; x: number; y: number }[] = [];
  const g = { fillStyle: '', drawImage: vi.fn(), fillRect(x: number, y: number) { rectangulos.push({ color: this.fillStyle, x, y }); } };
  const fondo = { complete: true, naturalWidth: 2130, naturalHeight: 2626 } as HTMLImageElement;
  return { g: g as unknown as CanvasRenderingContext2D, rectangulos, fondo };
}

it('una cadena solo rechazada deja la caja verde vacía y dibuja las hojas en la roja', () => {
  const { g, rectangulos, fondo } = lienzo();
  dibujarCajasJuez(g, fondo, { sostenida: 0, parcial: 0, no_sostenida: 3, otras: 0 });
  const hojas = rectangulos.filter(r => r.color === '#F4F1EA');
  expect(hojas).toHaveLength(3); expect(hojas.every(r => r.x === 328)).toBe(true);
  expect(g.drawImage).toHaveBeenCalledTimes(3); // Tapa también las hojas verdes del fondo.
});

it('sin recuentos no pinta una pila de ejemplo; los ceros también permanecen vacíos', () => {
  for (const v of [null, { sostenida: 0, parcial: 0, no_sostenida: 0, otras: 0 }]) {
    const { g, rectangulos, fondo } = lienzo(); dibujarCajasJuez(g, fondo, v);
    expect(rectangulos.some(r => r.color === '#F4F1EA')).toBe(false);
    expect(g.drawImage).toHaveBeenCalledTimes(3);
  }
});

it('el titular incluye los cuatro recuentos guardados en ambos idiomas', () => {
  const v = { sostenida: 89, parcial: 2, no_sostenida: 4, otras: 12 };
  expect(resumenCajasJuez(v)).toBe('Sostenida: 89 · Parcial: 2 · No sostenida: 4 · Otros veredictos: 12');
  fijarIdioma('en');
  expect(resumenCajasJuez(v)).toBe('Supported: 89 · Partial: 2 · Not supported: 4 · Other verdicts: 12');
  expect(resumenCajasJuez(null)).toBeNull();
});
