// Qué cambió entre dos versiones de una hipótesis, campo a campo. Es el
// espejo exacto de rosa/registro.py: mismos campos, mismo orden, mismas
// etiquetas y el mismo resumen en castellano; los casos de registro.test.ts
// son los mismos que los de rosa/tests/test_registro.py, con la misma salida
// esperada. Sin React: lo prueba vitest. Si cambia una regla aquí, cambia
// igual allí.
//
// Reglas de tolerancia, iguales en los dos lados:
// - Una clave ausente, null o undefined vale '' (vacío); una tarjeta null
//   vale una tarjeta vacía, así que una tarjeta que aparece o desaparece
//   entera cuenta campo a campo.
// - Los riesgos (lista) se comparan unidos por '; ' sin sus entradas vacías;
//   un texto suelto en riesgos vale lo mismo que la lista ya unida.
// - Los espacios de los extremos no cuentan como cambio. El conjunto que se
//   recorta es el mismo en los dos lados (ESPACIOS): ni String.prototype.trim()
//   ni str.strip() por separado, porque recortan conjuntos distintos (uno
//   quita el BOM y no \x1f, el otro al revés).
// - Un valor que no es texto se normaliza igual que en Python: un número
//   entero (también 2.0) se escribe sin decimales; uno con decimales se
//   escribe como repr() de Python; un booleano, un objeto o una lista anidada
//   valen '' (no hay texto que enseñar), en vez de 'true' o '[object Object]'.
// - Las búsquedas en las tablas son por clave propia (Object.hasOwn): un
//   campo llamado 'constructor' o 'toString' es un campo desconocido, no una
//   función heredada del prototipo.

import { PASO_RUTA } from './etiquetas';
import { traducido, tr, trp } from './idioma';

/** Los campos que se comparan, con su ruta en punto (la misma clave que
 *  guarda el servidor en versiones[].cambios). */
export type CampoDiff =
  | 'titulo'
  | 'enunciado'
  | 'mecanismo'
  | 'comprobacion.biomarcador'
  | 'comprobacion.cohorte'
  | 'comprobacion.diseno'
  | 'tarjeta.diana'
  | 'tarjeta.celula'
  | 'tarjeta.etapa'
  | 'tarjeta.intervencion'
  | 'tarjeta.direccion'
  | 'tarjeta.prediccionFalsable'
  | 'tarjeta.riesgos'
  | 'tarjeta.pasoRuta';

export interface ComprobacionVersion {
  biomarcador?: string | null;
  cohorte?: string | null;
  diseno?: string | null;
}

export interface TarjetaVersion {
  diana?: string | null;
  celula?: string | null;
  etapa?: string | null;
  intervencion?: string | null;
  direccion?: string | null;
  prediccionFalsable?: string | null;
  riesgos?: readonly string[] | string | null;
  pasoRuta?: string | null;
}

/** Lo mínimo que hace falta para comparar. Una VersionHipotesis o una
 *  Hipotesis del estado (datos/tipos.ts) encajan tal cual, sin adaptar. */
export interface InstantaneaHipotesis {
  titulo?: string | null;
  enunciado?: string | null;
  mecanismo?: string | null;
  comprobacion?: ComprobacionVersion | null;
  tarjeta?: TarjetaVersion | null;
  /** Solo la hipótesis actual lo lleva: numera la última revisión. */
  version?: number | null;
}

/** Una versión guardada: la instantánea más quién la cambió, cuándo y por qué. */
export interface VersionRegistro extends InstantaneaHipotesis {
  n?: number | null;
  fecha?: number | null;
  quien?: string | null;
  motivo?: string | null;
}

/** Un campo que cambió, con el valor normalizado de antes y el de después. */
export interface CambioCampo {
  campo: CampoDiff;
  antes: string;
  despues: string;
}

/** Un cambio tal como puede venir del servidor: el campo puede ser una clave
 *  que esta versión de la interfaz no conoce, y se nombra por su clave. */
export interface CambioRegistro {
  campo: string;
  antes?: string | null;
  despues?: string | null;
}

/** Una versión guardada con lo que cambió hasta la siguiente (o hasta la actual). */
export interface RevisionVersion<V extends VersionRegistro> {
  version: V;
  deN: number;
  aN: number;
  cambios: CambioCampo[];
}

interface DefinicionCampo {
  ruta: readonly string[];
  etiqueta: string;
  nombreEnFrase: string;
}

/** El orden fijo en que se informan los campos. */
export const CAMPOS_DIFF: readonly CampoDiff[] = [
  'titulo',
  'enunciado',
  'mecanismo',
  'comprobacion.biomarcador',
  'comprobacion.cohorte',
  'comprobacion.diseno',
  'tarjeta.diana',
  'tarjeta.celula',
  'tarjeta.etapa',
  'tarjeta.intervencion',
  'tarjeta.direccion',
  'tarjeta.prediccionFalsable',
  'tarjeta.riesgos',
  'tarjeta.pasoRuta',
];

const DEFINICIONES: Record<CampoDiff, DefinicionCampo> = traducido({
  titulo: { ruta: ['titulo'], etiqueta: 'Título', nombreEnFrase: 'el título' },
  enunciado: { ruta: ['enunciado'], etiqueta: 'Enunciado', nombreEnFrase: 'el enunciado' },
  mecanismo: { ruta: ['mecanismo'], etiqueta: 'Mecanismo', nombreEnFrase: 'el mecanismo' },
  'comprobacion.biomarcador': { ruta: ['comprobacion', 'biomarcador'], etiqueta: 'Biomarcador', nombreEnFrase: 'el biomarcador' },
  'comprobacion.cohorte': { ruta: ['comprobacion', 'cohorte'], etiqueta: 'Cohorte', nombreEnFrase: 'la cohorte' },
  'comprobacion.diseno': { ruta: ['comprobacion', 'diseno'], etiqueta: 'Diseño', nombreEnFrase: 'el diseño' },
  'tarjeta.diana': { ruta: ['tarjeta', 'diana'], etiqueta: 'Diana', nombreEnFrase: 'la diana' },
  'tarjeta.celula': { ruta: ['tarjeta', 'celula'], etiqueta: 'Célula', nombreEnFrase: 'la célula' },
  'tarjeta.etapa': { ruta: ['tarjeta', 'etapa'], etiqueta: 'Etapa', nombreEnFrase: 'la etapa' },
  'tarjeta.intervencion': { ruta: ['tarjeta', 'intervencion'], etiqueta: 'Intervención', nombreEnFrase: 'la intervención' },
  'tarjeta.direccion': { ruta: ['tarjeta', 'direccion'], etiqueta: 'Dirección', nombreEnFrase: 'la dirección' },
  'tarjeta.prediccionFalsable': { ruta: ['tarjeta', 'prediccionFalsable'], etiqueta: 'Predicción falsable', nombreEnFrase: 'la predicción falsable' },
  'tarjeta.riesgos': { ruta: ['tarjeta', 'riesgos'], etiqueta: 'Riesgos', nombreEnFrase: 'los riesgos' },
  'tarjeta.pasoRuta': { ruta: ['tarjeta', 'pasoRuta'], etiqueta: 'Paso de la ruta', nombreEnFrase: 'el paso de la ruta' },
});

/** La definición de un campo conocido, buscada por clave propia: 'constructor'
 *  o 'toString' no son campos, aunque el prototipo los tenga. */
function definicion(campo: unknown): DefinicionCampo | undefined {
  return typeof campo === 'string' && Object.hasOwn(DEFINICIONES, campo) ? DEFINICIONES[campo as CampoDiff] : undefined;
}

/** Lectura por clave propia en una tabla de textos (misma regla que definicion). */
function enTabla(tabla: Record<string, string>, clave: string): string | undefined {
  return Object.hasOwn(tabla, clave) ? tabla[clave] : undefined;
}

/** La dirección de la intervención es un identificador; en el resumen se
 *  enseña con su etiqueta. Misma tabla que DIRECCION_LEGIBLE en rosa/registro.py. */
export const DIRECCION_LEGIBLE: Record<string, string> = traducido({
  aumenta: 'aumenta',
  disminuye: 'disminuye',
  modula: 'modula',
  sin_intervencion: 'sin intervención',
});

/** El paso de la ruta terapéutica se enseña con la etiqueta de PASO_RUTA, el
 *  mismo sitio que usa la pantalla. rosa/registro.py lleva una copia
 *  (PASO_RUTA_LEGIBLE); los casos compartidos vigilan que no se separen. */
const PASO_RUTA_LEGIBLE: Record<string, string> = Object.fromEntries(Object.entries(PASO_RUTA).map(([clave, v]) => [clave, v.etiqueta]));

/** Un valor entra entre paréntesis en el resumen solo si es corto y de una
 *  sola línea; un enunciado de tres frases se nombra pero no se copia. */
export const LARGO_MAXIMO_EN_RESUMEN = 40;

export const SIN_CAMBIOS = 'Sin cambios en los campos de la hipótesis';

/** Cómo se nombra en el resumen un cambio guardado sin campo (registro roto):
 *  se dice que algo cambió, no se calla. Misma frase que en rosa/registro.py. */
export const CAMPO_SIN_NOMBRE = 'un campo sin nombre';

const SEPARADOR_RIESGOS = '; ';

/** Los caracteres que se recortan en los extremos, en los dos lados igual: la
 *  unión de lo que quitan str.strip() en Python y trim() en JavaScript
 *  (espacio, tabulador, saltos de línea, separadores de información \x1c a
 *  \x1f, NEL, los espacios Unicode de la categoría Zs, los separadores de
 *  línea y párrafo y el BOM). Misma lista que ESPACIOS en rosa/registro.py. */
export const ESPACIOS = ' \t\n\r\f\v\x1c\x1d\x1e\x1f\x85\u00a0\u1680' + Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)).join('') + '\u2028\u2029\u202f\u205f\u3000\ufeff';

const CLASE_ESPACIOS = '[' + Array.from(ESPACIOS, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`).join('') + ']';
const RECORTE = new RegExp(`^${CLASE_ESPACIOS}+|${CLASE_ESPACIOS}+$`, 'gu');

function recortar(t: string): string {
  return t.replace(RECORTE, '');
}

function esDiccionario(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Baja por la ruta de claves; cualquier tramo que no sea un objeto (null,
 *  tarjeta ausente, registro antiguo) devuelve undefined. */
function leer(obj: unknown, ruta: readonly string[]): unknown {
  let actual: unknown = obj;
  for (const clave of ruta) {
    if (!esDiccionario(actual)) return undefined;
    actual = actual[clave];
  }
  return actual;
}

/** repr() de Python para un flotante finito con decimales: los dígitos más
 *  cortos que lo reproducen (los mismos que da toExponential sin argumento),
 *  en notación fija si el exponente decimal está entre -4 y 15, y si no en
 *  científica con el exponente a dos cifras como mínimo ('1e-05'). Así '0.00001'
 *  no separa los dos lados. */
function flotanteComoPython(v: number): string {
  const [mantisa = '0', expTexto = '0'] = Math.abs(v).toExponential().split('e');
  const exp = Number(expTexto);
  const digitos = mantisa.replace('.', '');
  const signo = v < 0 ? '-' : '';
  if (exp >= -4 && exp < 16) {
    if (exp < 0) return `${signo}0.${'0'.repeat(-exp - 1)}${digitos}`;
    const enteros = digitos.slice(0, exp + 1).padEnd(exp + 1, '0');
    const decimales = digitos.slice(exp + 1);
    return `${signo}${enteros}.${decimales || '0'}`;
  }
  const resto = digitos.slice(1);
  return `${signo}${digitos[0]}${resto ? `.${resto}` : ''}e${exp < 0 ? '-' : '+'}${Math.abs(exp).toString().padStart(2, '0')}`;
}

/** Un número a texto como lo escribe Python: un entero (también 2.0 o 1e21)
 *  sin decimales ni exponente; NaN e infinito son vacío; el resto como repr(). */
function numero(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return BigInt(v).toString();
  return flotanteComoPython(v);
}

/** Un valor suelto a texto: el texto recortado; un número según `numero`; lo
 *  demás (null, undefined, booleanos, objetos, listas anidadas, funciones) es
 *  vacío. Misma regla que `_escalar` en rosa/registro.py. */
function escalar(valor: unknown): string {
  if (typeof valor === 'string') return recortar(valor);
  if (typeof valor === 'number') return numero(valor);
  if (typeof valor === 'bigint') return valor.toString();
  return '';
}

/** Normaliza un valor a texto comparable: null y undefined son vacío, una
 *  lista se une por '; ' sin sus entradas vacías, y los espacios de los
 *  extremos no cuentan. */
function texto(valor: unknown): string {
  if (Array.isArray(valor)) {
    return valor.map(escalar).filter((p) => p !== '').join(SEPARADOR_RIESGOS);
  }
  return escalar(valor);
}

/** El valor normalizado de un campo en una instantánea (o en la hipótesis
 *  actual). Campo desconocido: vacío. */
export function valorCampo(h: unknown, campo: string): string {
  const def = definicion(campo);
  if (!def) return '';
  return texto(leer(h, def.ruta));
}

/** Los campos que cambiaron entre dos instantáneas, en el orden fijo de
 *  CAMPOS_DIFF. Sin entradas cuando nada cambia. Tolera null, claves
 *  ausentes y tarjeta null: una tarjeta que aparece o desaparece entera
 *  cuenta campo a campo (solo los campos que dejan de estar vacíos o pasan a
 *  estarlo). */
export function diffVersion(antes: InstantaneaHipotesis | null | undefined, despues: InstantaneaHipotesis | null | undefined): CambioCampo[] {
  const cambios: CambioCampo[] = [];
  for (const campo of CAMPOS_DIFF) {
    const a = valorCampo(antes, campo);
    const d = valorCampo(despues, campo);
    if (a !== d) cambios.push({ campo, antes: a, despues: d });
  }
  return cambios;
}

/** La etiqueta en castellano de un campo del diff. Un campo desconocido
 *  vuelve tal cual, para que nunca se pierda en pantalla; uno que no es texto
 *  es vacío. */
export function etiquetaCampo(campo: string): string {
  const def = definicion(campo);
  if (def) return def.etiqueta;
  return typeof campo === 'string' ? campo : '';
}

/** El valor tal como se enseña en el resumen: los identificadores de la
 *  dirección y del paso de la ruta pasan a su etiqueta; uno que no esté en la
 *  tabla se enseña con espacios en vez de guiones bajos; el resto del texto va
 *  tal cual. Un valor que no es texto se normaliza antes con la misma regla
 *  del diff. */
export function valorLegible(campo: string, valor: unknown): string {
  const t = texto(valor);
  if (!t) return '';
  if (campo === 'tarjeta.direccion') return enTabla(DIRECCION_LEGIBLE, t) ?? t.replace(/_/g, ' ');
  if (campo === 'tarjeta.pasoRuta') return enTabla(PASO_RUTA_LEGIBLE, t) ?? t.replace(/_/g, ' ');
  return t;
}

function corto(t: string): boolean {
  // Longitud en puntos de código, como len() en Python, no en unidades UTF-16.
  const n = Array.from(t).length;
  return n > 0 && n <= LARGO_MAXIMO_EN_RESUMEN && !t.includes('\n') && !t.includes('\r');
}

/** Lo que va entre paréntesis detrás del nombre del campo: "(A -> B)" si los
 *  dos valores son cortos, "(nuevo: B)" si antes no había nada, "(quitado: A)"
 *  si ahora no hay nada, y nada si alguno es largo. */
function detalle(campo: string, antes: string, despues: string): string {
  const a = valorLegible(campo, antes);
  const d = valorLegible(campo, despues);
  if (a && d) return corto(a) && corto(d) ? ` (${a} -> ${d})` : '';
  if (!a && corto(d)) return ` (nuevo: ${d})`;
  if (!d && corto(a)) return ` (quitado: ${a})`;
  return '';
}

/** Una frase en castellano con lo que cambió: "Cambió el enunciado y la
 *  cohorte (ADNI -> BioFINDER)". Sin cambios: SIN_CAMBIOS. Los campos van en
 *  el orden en que vienen (el de diffVersion); uno desconocido se nombra por
 *  su clave; uno sin clave (registro roto) se nombra CAMPO_SIN_NOMBRE. Una
 *  entrada que no es objeto, o una lista que no es lista, se ignora en vez
 *  de romper. */
export function resumenDiff(cambios: readonly CambioRegistro[] | null | undefined): string {
  const partes: string[] = [];
  for (const c of Array.isArray(cambios) ? cambios : []) {
    if (!esDiccionario(c)) continue;
    const campo = typeof c.campo === 'string' ? c.campo : '';
    const nombre = definicion(campo)?.nombreEnFrase || campo || tr(CAMPO_SIN_NOMBRE);
    partes.push(nombre + detalle(campo, texto(c.antes), texto(c.despues)));
  }
  if (partes.length === 0) return tr(SIN_CAMBIOS);
  const lista = partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]!}`;
  return trp("Cambió {lista}", { lista });
}

/** Un número de versión: un entero (también 2.0), como `_entero` en Python.
 *  Un booleano, un texto o 1.5 no valen. */
function entero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) ? valor : null;
}

/** El número efectivo de cada versión guardada, ya ordenadas: el `n`
 *  declarado si avanza sobre el anterior; si falta, su posición; si se repite
 *  o retrocede, el anterior más uno. Así la cadena es estrictamente creciente
 *  y ninguna versión aparece dos veces. Misma regla que _numeros_de_version. */
function numerosDeVersion(ordenadas: readonly VersionRegistro[]): number[] {
  const numeros: number[] = [];
  let previo: number | null = null;
  ordenadas.forEach((v, i) => {
    let n = entero(v.n) ?? i + 1;
    if (previo !== null && n <= previo) n = previo + 1;
    numeros.push(n);
    previo = n;
  });
  return numeros;
}

/** Para cada versión guardada, qué cambió hasta la siguiente (la hipótesis
 *  actual para la última), con los números de versión de salida y llegada.
 *  Misma regla que revisiones_prov en rosa/registro.py: se ordenan por `n`
 *  (estable; una sin `n` toma su posición) y se numeran de forma
 *  estrictamente creciente (numerosDeVersion): un `n` repetido o una versión
 *  actual atrasada se corrigen para que cada versión aparezca una vez y
 *  ninguna revisión apunte a sí misma. Entradas que no son objetos, o una
 *  lista que no es lista, se ignoran. La interfaz lo usa para pintar "qué
 *  cambió" entre v{n} y v{n+1}. */
export function cambiosPorVersion<V extends VersionRegistro>(versiones: readonly V[] | null | undefined, actual: InstantaneaHipotesis | null | undefined): RevisionVersion<V>[] {
  const conIndice = (Array.isArray(versiones) ? versiones : []).filter((v): v is V => esDiccionario(v)).map((v, i) => ({ v, i }));
  conIndice.sort((x, y) => {
    const nx = entero(x.v.n) ?? x.i + 1;
    const ny = entero(y.v.n) ?? y.i + 1;
    return nx !== ny ? nx - ny : x.i - y.i;
  });
  const ordenadas = conIndice.map((x) => x.v);
  const numeros = numerosDeVersion(ordenadas);
  const salida: RevisionVersion<V>[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    const v = ordenadas[i]!;
    const n = numeros[i]!;
    const siguienteGuardada = ordenadas[i + 1];
    const siguiente: InstantaneaHipotesis | null | undefined = siguienteGuardada ?? actual;
    let aN = siguienteGuardada ? numeros[i + 1]! : entero(esDiccionario(actual) ? actual.version : undefined);
    if (aN === null || aN <= n) aN = n + 1;
    salida.push({ version: v, deN: n, aN, cambios: diffVersion(v, siguiente) });
  }
  return salida;
}
