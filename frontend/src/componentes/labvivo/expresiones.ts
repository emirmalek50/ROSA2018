import type { EmocionLaboratorio, GestoLaboratorio } from '../../lib/conversacionesLaboratorio';

/** La expresión ocupa los mismos píxeles de la cara; no añade iconos ni etiquetas. */
export function pintarExpresion(ctx: CanvasRenderingContext2D, emocion: EmocionLaboratorio, piel: string) {
  if (emocion === 'neutral') return;
  const puntos = (color: string, posiciones: number[][]) => {
    ctx.fillStyle = color;
    posiciones.forEach(([x, y]) => ctx.fillRect(x!, y!, 1, 1));
  };
  const tinta = '#17131F', boca = '#B5654A';
  puntos(piel, [[4, 5], [5, 5], [6, 5], [7, 5], [5, 6], [6, 6]]);
  if (emocion === 'alegre') {
    puntos(boca, [[4, 5], [7, 5], [5, 6], [6, 6]]);
  } else if (emocion === 'frustrado') {
    puntos(tinta, [[3, 3], [4, 3], [7, 3], [8, 3]]);
    puntos(boca, [[4, 6], [5, 5], [6, 5], [7, 6]]);
  } else if (emocion === 'preocupado') {
    puntos(tinta, [[4, 3], [7, 3]]);
    puntos(boca, [[4, 6], [5, 5], [6, 5], [7, 6]]);
  } else if (emocion === 'sorprendido') {
    puntos(tinta, [[3, 3], [8, 3]]);
    puntos(boca, [[5, 5], [6, 5], [5, 6], [6, 6]]);
  } else {
    puntos(tinta, [[3, 3], [4, 3]]);
    puntos(boca, [[5, 5], [6, 5]]);
  }
}

/** Un solo gesto breve. Las coordenadas de la caminata se mantienen intactas. */
export function desplazamientoGesto(gesto: GestoLaboratorio, segundos: number, reducir: boolean): [number, number] {
  if (reducir || segundos < 0 || segundos >= 1.2) return [0, 0];
  const onda = Math.sin(segundos / 1.2 * Math.PI * 4);
  return gesto === 'asentir' ? [0, Math.round(onda * 2)] : gesto === 'negar' ? [Math.round(onda * 2), 0] : [0, 0];
}
