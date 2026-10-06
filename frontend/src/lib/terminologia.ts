// Contrato común con rosa/terminologia_traduccion.py. Detecta alteraciones
// concretas de los datos; no sustituye una revisión semántica en contexto.
import contrato from '../../../rosa/terminologia_traduccion.json';

export const TRADUCCIONES_REVISADAS: Record<string, string> = contrato.traducciones;
const unidades: Record<string, string> = contrato.unidades;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numero = '(?:\\d+(?:[.,]\\d+)*|[.,]\\d+)(?:[eE][+\\-]?\\d+)?';
const cifras = new RegExp('[+\\-−]?' + numero, 'g');
const protegidos = /\b(?:NCT\d{8}|PMID\s*:?\s*\d+|(?:ENSG|ENST|ENSP)\d+(?:\.\d+)?|(?:NM|NR|NP|XM|XR|XP)_\d+(?:\.\d+)?)\b|\b10\.\d{4,9}\/[^\s\]<>"}]+|https?:\/\/[^\s\]<>"}]+|\b[ACGTU]{6,}\b|\bp-tau\d+\b/g;
const identificadores = /(?<![A-Za-z0-9_])[A-Z][A-Za-z]*\d+[A-Za-z0-9]*(?![A-Za-z0-9_])/g;
const literales = /```[\s\S]*?```|`[^`\n]+`/g;
const alternativas = Object.keys(unidades).sort((a, b) => b.length - a.length).map((u) => escapar(u).replace(/ /g, '\\s+')).join('|');
const cantidades = new RegExp('(?<![\\p{L}\\p{N}_])([+\\-−]?' + numero + '|\\{\\w+\\})\\s*(?:-\\s*)?(' + alternativas + ')((?:\\s*/\\s*(?:' + alternativas + '))*)(?![\\p{L}\\p{N}_])', 'gu');
const comparador = new RegExp('(<=|>=|[<>≤≥])\\s*([+\\-−]?' + numero + ')', 'g');
const simbolos = contrato.simbolos.map((s) => new RegExp('(?<![A-Za-z0-9_])' + escapar(s) + '(?![A-Za-z0-9_])', 'g'));
const excepciones = contrato.excepciones_unidades;
const unidad = (u = '') => unidades[u.replace(/\s+/g, ' ')] ?? '';
const reglas = contrato.reglas.map((r) => ({ nombre: r.id, es: new RegExp(r.es, 'i'), en: new RegExp(r.en, 'i') }));

function numeroCanonico(t: string, ingles = false): string {
  // En inglés 1,500 son mil quinientos. No aceptar una coma decimal como tal.
  if (ingles && t.includes(',')) {
    if (!/^[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+\-]?\d+)?$/.test(t)) return 'formato numérico ambiguo: ' + t;
    t = t.replace(/,/g, '');
  }
  t = t.replace('−', '-').replace(/,/g, '.').toLowerCase().replace(/^\+/, '');
  if (t.split('.').length > 2 || t.includes('e')) return t;
  const signo = t.startsWith('-') ? '-' : '';
  t = t.replace(/^-/, '');
  const [entero = '', decimales = ''] = t.split('.');
  const dec = decimales.replace(/0+$/, '');
  const n = (entero.replace(/^0+/, '') || '0') + (dec ? '.' + dec : '');
  return (n !== '0' ? signo : '') + n;
}
const mismos = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const valores = (t: string, p: RegExp) => [...t.matchAll(p)].map((m) => m[0]).sort();

// Los dígitos de un identificador no son cantidades; IC95% equivale a 95% CI.
const contextoNumerico = (t: string) => t.replace(/\b(?:IC|CI)(?=\d+%)/g, '').replace(/ROSA2018/g, 'ROSA');
const normalizaciones: Record<string, string> = contrato.normalizaciones_cifras;
const entradaNumerica = (t: string) => contrato.cabeceras_csv.includes(t.split('\n')[0]!) ? t.replace(/,/g, ' ') : normalizaciones[t] ?? t;
const numeros = (t: string, ingles = false) => [...contextoNumerico(entradaNumerica(t)).replace(/\{\w+\}/g, ' ').replace(literales, ' ').replace(protegidos, ' ').replace(identificadores, ' ').matchAll(cifras)].map((m) => numeroCanonico(m[0], ingles));

/** Rechaza lo que no se debe mostrar como traducción de información científica. */
export function comprobarTraduccion(original: string, traducido: string): string | null {
  if (!traducido.trim()) return 'vacía';
  if (traducido.includes('\u2014')) return 'lleva guion largo';
  if (!mismos(valores(original, /\{\w+\}/g), valores(traducido, /\{\w+\}/g))) return 'los huecos no coinciden';
  if (!mismos(numeros(original), numeros(traducido, true))) return 'las cifras o su orden cambiaron';
  for (const p of [protegidos, literales]) if (!mismos(valores(original, p), valores(traducido, p))) return 'cambió un identificador, enlace, secuencia o código literal';
  if (!mismos(valores(contextoNumerico(original), identificadores), valores(contextoNumerico(traducido), identificadores))) return 'cambió un identificador alfanumérico';
  for (const p of simbolos) if (!mismos(valores(original, p), valores(traducido, p))) return 'cambió un símbolo de gen o biomarcador';
  const medidas = (t: string, ingles = false) => [...contextoNumerico(t).matchAll(cantidades)].filter((m) => !excepciones.some((e) => e.valor === m[1] && e.unidad === m[2])).map((m) => JSON.stringify([numeroCanonico(m[1]!, ingles), unidad(m[2]), (m[3] ?? '').split('/').slice(1).map((u) => unidad(u.trim()))])).sort();
  if (!mismos(medidas(original), medidas(traducido, true))) return 'cambió una cantidad o su unidad';
  const limites = (t: string, ingles = false) => [...t.matchAll(comparador)].map((m) => [m[1]!.replace('≤', '<=').replace('≥', '>='), numeroCanonico(m[2]!, ingles)]);
  if (!mismos(limites(original), limites(traducido, true))) return 'cambió un umbral o el sentido de una desigualdad';
  const es = original.replace(/\{\w+\}/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const r of reglas) if (r.es.test(es) && !r.en.test(traducido)) return `terminología incorrecta: ${r.nombre}`;
  if (/\b(?:proven|proves|confirmed|confirms|demonstrates|demonstrated|establishes)\b/i.test(traducido) && !/\b(?:demostrad|demuestra|confirmad|confirma|establece|prueba que)/i.test(original)) return 'afirma de más (proven/confirmed)';
  if (/no (?:pude|se pudo|pudo) comprobar/i.test(original) && !/could not (?:be )?(?:check|verif)|unable to (?:check|verif)/i.test(traducido)) return '«no pude comprobar» no se tradujo como «could not check»';
  return null;
}
