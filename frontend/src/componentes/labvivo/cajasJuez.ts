// Las pilas acompañan los recuentos guardados; no suman las escenas animadas.
import type { DatosLab } from '../../lib/labVivo';
import { tr } from '../../lib/idioma';
import { formatearEntero } from '../../lib/formato';

type Recuentos = DatosLab['juez']['veredictos'];
const CAJAS = [
  { clave: 'sostenida', x: 96, borde: '#34D399', fondo: '#1F6B4E' },
  { clave: 'parcial', x: 208, borde: '#F2B54A', fondo: '#7A5A1A' },
  { clave: 'no_sostenida', x: 320, borde: '#F07167', fondo: '#7A2E2A' },
] as const;

/** El dibujo tiene sitio para nueve hojas; la cifra exacta está en su cartel.
 *  Sin recuento no hay hojas de muestra ni una pila verde por defecto. */
export function dibujarCajasJuez(g: CanvasRenderingContext2D, fondo: HTMLImageElement, recuentos: Recuentos) {
  if (!fondo.complete || !fondo.naturalWidth || !fondo.naturalHeight) return;
  const sx = fondo.naturalWidth / 1064, sy = fondo.naturalHeight / 1312;
  for (const c of CAJAS) {
    // El suelo vacío de la misma sala tapa las pilas pintadas en la demo.
    g.drawImage(fondo, 512 * sx, 488 * sy, 88 * sx, 88 * sy, c.x, 488, 88, 88);
    const n = recuentos?.[c.clave];
    const hojas = n !== undefined && Number.isFinite(n) && n > 0 ? Math.min(9, Math.floor(n)) : 0;
    for (let i = 0; i < hojas; i++) {
      const y = 549 - i * 6;
      g.fillStyle = '#E4E0D6'; g.fillRect(c.x + 8, y, 64, 5);
      g.fillStyle = '#F4F1EA'; g.fillRect(c.x + 8, y, 64, 2);
    }
    g.fillStyle = c.fondo; g.fillRect(c.x + 4, 556, 72, 16);
    g.fillStyle = c.borde;
    g.fillRect(c.x, 548, 4, 28); g.fillRect(c.x + 76, 548, 4, 28);
    g.fillRect(c.x, 572, 80, 4); g.fillRect(c.x, 552, 80, 4);
  }
}

/** Incluye todas las cajas, incluso cuando solo una tiene afirmaciones. */
export function resumenCajasJuez(v: Recuentos): string | null {
  if (!v) return null;
  return [
    [tr('Sostenida'), v.sostenida], [tr('Parcial'), v.parcial],
    [tr('No sostenida'), v.no_sostenida], [tr('Otros veredictos'), v.otras],
  ].map(([nombre, n]) => `${nombre}: ${formatearEntero(n as number)}`).join(' · ');
}
