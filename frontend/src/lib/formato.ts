// Formato de numeros, tiempos y plurales. Sin React: lo prueba vitest tal
// cual. En castellano los numeros grandes llevan separador de miles de punto
// y decimales con coma, como se leen en Republica Dominicana y Espana; en
// ingles es al reves. No es cosmetica: «1.171» leido en ingles es poco mas
// de uno, no mil ciento setenta y uno, asi que el separador tiene que seguir
// al idioma.
import { idiomaActual } from './idioma';

/** El separador decimal del idioma. Se aplica sobre la cadena que ya produjo
 *  `toFixed` o `toString`, que siempre traen punto. */
export function coma(s: string): string {
  return idiomaActual() === 'es' ? s.replace('.', ',') : s;
}

/** "0,8 s", "12 s", "1 min 4 s", "2 h 10 min". Sin decimales a partir de
 *  10 s: a ese tamano la decima no informa de nada. */
export function formatearDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${coma((Math.max(1, Math.round(ms / 100)) / 10).toString())} s`;
  const s = ms / 1000;
  if (s < 10) return `${coma((Math.round(s * 10) / 10).toString())} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.floor(s / 60);
  if (min < 60) {
    const resto = Math.round(s - min * 60);
    return resto > 0 ? `${min} min ${resto} s` : `${min} min`;
  }
  const h = Math.floor(min / 60);
  const restoMin = min - h * 60;
  if (h < 48) return restoMin > 0 ? `${h} h ${restoMin} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restoH = h - d * 24;
  return restoH > 0 ? `${d} d ${restoH} h` : `${d} d`;
}

/** "hace un momento", "hace 6 min", "hace 2 h", "hace 3 d". Para el futuro
 *  devuelve "en N min". */
export function tiempoRelativo(momento: number, ahora: number): string {
  const diff = ahora - momento;
  const abs = Math.abs(diff);
  const prefijo = diff >= 0 ? 'hace' : 'en';
  // Un desfase pequeno hacia el futuro es reloj de pantalla (se relee cada
  // 15 s), no un momento futuro: se dice "hace un momento".
  if (abs < 45_000) return 'hace un momento';
  const min = Math.round(abs / 60_000);
  if (min < 60) return `${prefijo} ${min} min`;
  const h = Math.round(abs / 3_600_000);
  if (h < 24) return `${prefijo} ${h} h`;
  const d = Math.round(abs / 86_400_000);
  return `${prefijo} ${d} d`;
}

/** Entero con puntos de miles: 48200000 -> "48.200.000". */
export function formatearEntero(n: number): string {
  if (!Number.isFinite(n)) return '';
  const negativo = n < 0;
  const digitos = Math.round(Math.abs(n)).toString();
  const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, idiomaActual() === 'es' ? '.' : ',');
  return negativo ? `-${conPuntos}` : conPuntos;
}

/** Cantidad compacta con coma decimal: 48200000 -> "48,2 M", 3950 -> "3,9 k",
 *  412 -> "412". */
export function formatearCompacto(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const signo = n < 0 ? '-' : '';
  const unaDecimal = (x: number) => coma((Math.round(x * 10) / 10).toString());
  if (abs >= 1_000_000_000) return `${signo}${unaDecimal(abs / 1_000_000_000)} G`;
  if (abs >= 1_000_000) return `${signo}${unaDecimal(abs / 1_000_000)} M`;
  if (abs >= 10_000) return `${signo}${unaDecimal(abs / 1_000)} k`;
  return `${signo}${formatearEntero(abs)}`;
}

/** 0.891 -> "89 %". Con `decimales` se conservan: 0.891 -> "89,1 %". */
export function formatearPorcentaje(fraccion: number, decimales = 0): string {
  if (!Number.isFinite(fraccion)) return '';
  const factor = 10 ** decimales;
  const valor = Math.round(fraccion * 100 * factor) / factor;
  return `${coma(valor.toString())} %`;
}

/** "1 hipotesis", "3 hipotesis"; con plural explicito para palabras que
 *  cambian ("afirmacion" -> "afirmaciones"). */
export function plural(n: number, singular: string, pluralExplicito?: string): string {
  const palabra = n === 1 ? singular : pluralExplicito ?? `${singular}s`;
  return `${formatearEntero(n)} ${palabra}`;
}

/** Fecha corta legible: "10 sep, 14:30". */
export function fechaCorta(ms: number): string {
  const d = new Date(ms);
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${meses[d.getMonth()]}, ${hh}:${mm}`;
}
