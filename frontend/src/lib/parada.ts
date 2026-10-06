// Que parte de una condicion de parada mide ROSA2018 sola. Espejo de rosa/parada.py:
// misma regla en los dos lados, para que la interfaz lo muestre al escribirla.

import type { ParadaCorrida } from '../datos/tipos';
import type { CondicionAutomatizada } from '../datos/tipos';
import { tr, trp } from './idioma';

export function partesAutomatizadas(texto: string): CondicionAutomatizada {
  const t = (texto ?? '').toLowerCase();
  const salida: CondicionAutomatizada = { iteraciones: null, tiempo: null, llamadas: null, resto: '', automatizada: false };
  let resto = t;
  let m = /(?<![\d.,+\-])\b(\d+)\s*(?:iteraci[oó]n(?:es)?|iterations?)\b/.exec(t);
  if (m) {
    salida.iteraciones = Number(m[1]);
    resto = resto.replace(m[0], ' ');
  }
  m = /(?<![\d.,+\-])\b(\d+(?:[.,]\d+)?)\s*(min|minutes?|minutos?|hours?|horas?|h|d[ií]as?|days?)\b/.exec(t);
  if (m) {
    const u = m[2]!;
    salida.tiempo = `${m[1]} ${u.startsWith('min') ? 'min' : u === 'h' || u.startsWith('hor') || u.startsWith('hour') ? 'h' : 'd'}`;
    resto = resto.replace(m[0], ' ');
  }
  m = /(?<![\d.,+\-])\b(\d+)\s*(?:llamadas?|calls?)\b/.exec(t);
  if (m) {
    salida.llamadas = Number(m[1]);
    resto = resto.replace(m[0], ' ');
  }
  // El resto se conserva tal como lo escribio la persona: solo se limpian los
  // conectores sueltos de los bordes y los espacios dobles.
  resto = resto.replace(/\s+/g, ' ').replace(/^[\s,;.]+|[\s,;.]+$/g, '');
  resto = resto.replace(/^(o|y|u|e|or|and|,|;)\s+/, '').replace(/\s+(o|y|u|e|or|and)$/, '').replace(/^[\s,;.]+|[\s,;.]+$/g, '');
  salida.resto = resto.length >= 4 ? resto : '';
  salida.automatizada = salida.iteraciones !== null || salida.tiempo !== null || salida.llamadas !== null;
  return salida;
}

export function textoAutomatizacion(p: CondicionAutomatizada): string {
  const medibles: string[] = [];
  if (p.iteraciones !== null) medibles.push(trp('{v} iteraciones', { v: p.iteraciones }));
  if (p.tiempo) medibles.push(trp("{tiempo} de corrida", { tiempo: p.tiempo }));
  if (p.llamadas !== null) medibles.push(trp('{v} llamadas', { v: p.llamadas }));
  if (medibles.length === 0) return tr('ROSA2018 no puede medir esta condición: la corrida sigue hasta que la detengas o hasta agotar el presupuesto de la misión.');
  let frase = trp("ROSA2018 para sola al llegar a {v} (y al agotar el presupuesto de la misión)", { v: medibles.join(tr(' o ')) });
  if (p.resto) frase += trp(". El resto (\"{v}\") lo decides tú con el botón de detener", { v: p.resto.slice(0, 80) });
  return `${frase}.`;
}


// ---------------------------------------------------------------------------
// La parada propia de una corrida (15 de septiembre de 2026): lo que la
// persona fija al crearla (horas, iteraciones, llamadas, texto) y que la
// detiene con lo que llegue primero, además de la condición de parada de la
// investigación. Espejo de rosa/parada.py (normalizar_parada, resumen_parada).
// ---------------------------------------------------------------------------

const LIMITES_PARADA: Record<'horas' | 'iteraciones' | 'llamadas' | 'cuantas' | 'sinCambio', [number, number]> = { horas: [1 / 60, 24 * 14], iteraciones: [1, 200], llamadas: [10, 100_000], cuantas: [1, 50], sinCambio: [1, 20] };
export const NIVELES_OBJETIVO = ['baja', 'moderada', 'alta'] as const;

export interface ParadaBorrador {
  horas: string;
  /** Unidad del valor escrito; se convierte a horas para el servidor. */
  unidadTiempo?: 'minutos' | 'horas' | 'dias';
  iteraciones: string;
  llamadas: string;
  texto: string;
  certeza: '' | 'baja' | 'moderada' | 'alta';
  cuantas: string;
  sinCambio: string;
}

export const BORRADOR_VACIO: ParadaBorrador = { horas: '', iteraciones: '', llamadas: '', texto: '', certeza: '', cuantas: '', sinCambio: '' };

function numeroParada(v: string, clave: 'horas' | 'iteraciones' | 'llamadas' | 'cuantas' | 'sinCambio'): number | null {
  const n = Number(v.replace(',', '.'));
  if (!v.trim() || !Number.isFinite(n) || n <= 0) return null;
  const [minimo, maximo] = LIMITES_PARADA[clave];
  const acotado = Math.max(minimo, Math.min(maximo, n));
  return clave === 'horas' ? acotado : Math.floor(acotado);
}

/** Del formulario a la parada que viaja al servidor; null si no se fijó nada. */
export function normalizarParada(b: ParadaBorrador): ParadaCorrida | null {
  const certeza = (NIVELES_OBJETIVO as readonly string[]).includes(b.certeza) ? (b.certeza as 'baja' | 'moderada' | 'alta') : null;
  const p: ParadaCorrida = {
    horas: numeroParada(b.horas.trim() ? String(Number(b.horas.replace(',', '.')) * (b.unidadTiempo === 'minutos' ? 1 / 60 : b.unidadTiempo === 'dias' ? 24 : 1)) : '', 'horas'),
    iteraciones: numeroParada(b.iteraciones, 'iteraciones'),
    llamadas: numeroParada(b.llamadas, 'llamadas'),
    texto: b.texto.trim().slice(0, 300),
    certeza,
    cuantas: certeza ? (numeroParada(b.cuantas, 'cuantas') ?? 1) : null,
    sinCambio: numeroParada(b.sinCambio, 'sinCambio'),
  };
  if (p.horas === null && p.iteraciones === null && p.llamadas === null && !p.texto && p.certeza === null && p.sinCambio === null) return null;
  return p;
}

export function borradorDe(p: ParadaCorrida | null | undefined): ParadaBorrador {
  if (!p) return { ...BORRADOR_VACIO };
  return {
    horas: p.horas === null ? '' : String(p.horas),
    iteraciones: p.iteraciones === null ? '' : String(p.iteraciones),
    llamadas: p.llamadas === null ? '' : String(p.llamadas),
    texto: p.texto ?? '',
    certeza: p.certeza ?? '',
    cuantas: p.cuantas == null ? '' : String(p.cuantas),
    sinCambio: p.sinCambio == null ? '' : String(p.sinCambio),
  };
}

function horasTexto(h: number): string {
  if (h >= 24 && Number.isInteger(h / 24)) return (h === 24 ? trp("{v} día", { v: h / 24 }) : trp("{v} días", { v: h / 24 }));
  if (h < 1) {
    const m = Math.round(h * 60);
    return m === 1 ? tr('1 minuto') : trp('{v} minutos', { v: m });
  }
  return (h === 1 ? trp("{h} hora", { h }) : trp("{h} horas", { h }));
}

/** "2 horas o 6 iteraciones, lo que llegue primero". Vacío sin parada. */
export function resumenParada(p: ParadaCorrida | null | undefined): string {
  if (!p) return '';
  const partes: string[] = [];
  if (p.horas) partes.push(horasTexto(p.horas));
  if (p.iteraciones) partes.push((p.iteraciones === 1 ? trp("{iteraciones} iteración", { iteraciones: p.iteraciones }) : trp("{iteraciones} iteraciones", { iteraciones: p.iteraciones })));
  if (p.llamadas) partes.push(trp("{llamadas} llamadas al modelo", { llamadas: p.llamadas }));
  if (p.certeza) {
    const n = p.cuantas ?? 1;
    const certeza = tr(p.certeza);
    partes.push(n > 1 ? trp("{n} hipótesis en certeza {certeza}", { n, certeza }) : trp("una hipótesis en certeza {certeza}", { certeza }));
  }
  if (p.sinCambio) partes.push((p.sinCambio === 1 ? trp("{sinCambio} iteración sin avance", { sinCambio: p.sinCambio }) : trp("{sinCambio} iteraciones sin avance", { sinCambio: p.sinCambio })));
  if (p.texto) partes.push(`«${p.texto}»`);
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0] ?? '';
  const ultima = partes[partes.length - 1] ?? '';
  return trp("{v} o {ultima}, lo que llegue primero", { v: partes.slice(0, -1).join(', '), ultima });
}
