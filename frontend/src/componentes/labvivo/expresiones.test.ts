import { expect, it, vi } from 'vitest';
import { desplazamientoGesto, pintarExpresion } from './expresiones';

it('asentir y negar terminan sin desplazar la posición del personaje', () => {
  expect(desplazamientoGesto('asentir', 0.15, false)).toEqual([0, 2]);
  expect(desplazamientoGesto('negar', 0.15, false)).toEqual([2, 0]);
  expect(desplazamientoGesto('asentir', 1.2, false)).toEqual([0, 0]);
  expect(desplazamientoGesto('negar', 30, false)).toEqual([0, 0]);
  expect(desplazamientoGesto('ninguno', 0.15, false)).toEqual([0, 0]);
});

it('movimiento reducido conserva la cara y evita los gestos animados', () => {
  expect(desplazamientoGesto('asentir', 0.15, true)).toEqual([0, 0]);
  expect(desplazamientoGesto('negar', 0.15, true)).toEqual([0, 0]);
  const fillRect = vi.fn();
  const ctx = { fillRect, fillStyle: '' } as unknown as CanvasRenderingContext2D;
  pintarExpresion(ctx, 'neutral', '#F6D5B5');
  expect(fillRect).not.toHaveBeenCalled();
  pintarExpresion(ctx, 'alegre', '#F6D5B5');
  expect(fillRect).toHaveBeenCalled();
  expect(fillRect.mock.calls.every(([x, y, w, h]) => x >= 3 && x <= 8 && y >= 3 && y <= 6 && w === 1 && h === 1)).toBe(true);
});
