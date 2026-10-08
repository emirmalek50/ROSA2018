// Las pilas acompañan los recuentos guardados; no suman las escenas animadas.
import type { DatosLab } from '../../lib/labVivo';
import { tr } from '../../lib/idioma';
import { formatearEntero } from '../../lib/formato';
import { llenadoDeCaja } from './vida';

type Recuentos = DatosLab['juez']['veredictos'];
const CAJAS = [
  { clave: 'sostenida', x: 96, borde: '#34D399', fondo: '#1F6B4E' },
  { clave: 'parcial', x: 208, borde: '#F2B54A', fondo: '#7A5A1A' },
  { clave: 'no_sostenida', x: 320, borde: '#F07167', fondo: '#7A2E2A' },
] as const;

/** El dibujo tiene sitio para nueve hojas; la cifra exacta está en su cartel.
 *  Las cajas se comparan entre sí (vida.ts, llenadoDeCaja): la más llena
 *  llega arriba y rebosa si pasa de cien, las demás a proporción, para que
 *  734 frente a 22 se vea como lo que es y no como dos pilas iguales. Sin
 *  recuento no hay hojas de muestra ni una pila verde por defecto. */
export function dibujarCajasJuez(g: CanvasRenderingContext2D, fondo: HTMLImageElement, recuentos: Recuentos) {
  if (!fondo.complete || !fondo.naturalWidth || !fondo.naturalHeight) return;
  const sx = fondo.naturalWidth / 1064, sy = fondo.naturalHeight / 1312;
  const mayor = recuentos ? Math.max(0, ...CAJAS.map((c) => recuentos[c.clave] || 0)) : 0;
  for (const c of CAJAS) {
    // El suelo vacío de la misma sala tapa las pilas pintadas en la demo.
    g.drawImage(fondo, 512 * sx, 488 * sy, 88 * sx, 88 * sy, c.x, 488, 88, 88);
    const n = recuentos?.[c.clave];
    const { hojas, rebosa } = n !== undefined && Number.isFinite(n) ? llenadoDeCaja(Math.floor(n), mayor) : { hojas: 0, rebosa: false };
    for (let i = 0; i < hojas; i++) {
      const y = 549 - i * 6;
      g.fillStyle = '#E4E0D6'; g.fillRect(c.x + 8, y, 64, 5);
      g.fillStyle = '#F4F1EA'; g.fillRect(c.x + 8, y, 64, 2);
    }
    if (rebosa) {
      // Hojas que asoman torcidas por encima del borde.
      g.fillStyle = '#F4F1EA'; g.fillRect(c.x + 4, 490, 30, 4); g.fillRect(c.x + 40, 486, 34, 4); g.fillRect(c.x + 18, 482, 26, 4);
      g.fillStyle = '#E4E0D6'; g.fillRect(c.x + 4, 494, 30, 1); g.fillRect(c.x + 40, 490, 34, 1); g.fillRect(c.x + 18, 486, 26, 1);
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
