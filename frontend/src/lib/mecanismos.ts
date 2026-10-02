// La pantalla de mecanismos: qué causa qué, según la hipótesis, según la
// evidencia y según el consenso del campo.
//
// De dónde salen los datos. No hay endpoint nuevo: cada hipótesis ya trae su
// `grafoCausal` (lo calcula `rosa/causal.py`, sin modelo) y ya viaja al
// navegador dentro del estado. Aquí solo se juntan los grafos de todas las
// hipótesis para dibujar la cascada de la enfermedad una sola vez, con los
// nodos de cada hipótesis colgando de ella.
//
// Los tres tipos de arista dicen cosas distintas y no se pueden mezclar:
//
//   `base_curada`             consenso del campo, escrito a mano en
//                             `rosa/causal.py` y revisable. No es verdad
//                             revelada: es contexto declarado.
//   `supuesto`                lo afirma la hipótesis o una explicación
//                             alternativa, sin dato propio que lo sostenga.
//   `inferencia_con_evidencia` hay afirmaciones sostenidas que lo respaldan.
//
// Medido el 22 de septiembre de 2026 sobre las 21 hipótesis con grafo de la
// corrida 16: 118 supuestos, 176 de consenso y CERO con evidencia propia. Que
// el contador de la tercera salga a cero no es un fallo de la pantalla, es lo
// que hay, y por eso se enseña en vez de esconderse.

import type { GrafoCausal, Hipotesis } from '../datos/tipos';
import { traducido, tr } from './idioma';

/** Los tramos de la enfermedad, en el orden en que ocurren. Es el mismo
 *  orden que `CAPAS` en `rosa/causal.py`, que es donde se decide. */
export const CAPAS = ['factores', 'patologia', 'dano', 'marcadores', 'desenlace'] as const;
export type Capa = (typeof CAPAS)[number] | 'otros';

/** El rótulo de cada columna. Los identificadores van sin tilde; el texto que
 *  se lee, con ella. */
export const TITULO_CAPA: Record<Capa, string> = traducido({
  factores: 'FACTORES',
  patologia: 'PATOLOGÍA',
  dano: 'DAÑO',
  marcadores: 'MARCADORES',
  desenlace: 'DESENLACE',
  otros: 'OTROS',
});

/** Compatibilidad con los grafos calculados ANTES del 22 de septiembre de
 *  2026, que no traen `capa` en el nodo. Los nuevos la traen del servidor
 *  (`rosa/causal.py`, CAPA_DE) y esta tabla no se usa. No se amplía: si
 *  aparece un nodo nuevo, lo manda el servidor. */
const CAPA_DE_RESPALDO: Record<string, Capa> = {
  APOE4: 'factores',
  edad: 'factores',
  'funcion renal': 'factores',
  amiloide: 'patologia',
  tau: 'patologia',
  neuroinflamacion: 'patologia',
  neurodegeneracion: 'dano',
  GFAP: 'marcadores',
  'p-tau181': 'marcadores',
  NfL: 'marcadores',
  cognicion: 'desenlace',
};

/** Cómo se escribe un nodo cuyo identificador va sin tilde. Solo para grafos
 *  viejos: los nuevos traen la etiqueta hecha desde `rosa/causal.py`. */
const ETIQUETA_DE_RESPALDO: Record<string, string> = traducido({
  neurodegeneracion: 'neurodegeneración',
  cognicion: 'cognición',
  neuroinflamacion: 'neuroinflamación',
  'funcion renal': 'función renal',
});

/** El nombre de un nodo de la cascada, para LEERLO. El identificador no se
 *  toca: una arista se busca por el id, y traducirlo rompe el grafo (paso con
 *  «B:funcion renal» el 2 de octubre de 2026).
 *
 *  Hace falta una tabla porque el traductor de pantalla
 *  (`lib/traductorDom.ts`) da por castellano lo que lleva tilde o palabra
 *  funcion, y «amiloide», «edad» o «tau» no tienen ninguna de las dos: se
 *  quedaban en castellano en el grafo causal. El vocabulario es cerrado, asi
 *  que la tabla lo cubre entero. */
const NOMBRE_DE_NODO: Record<string, string> = traducido({
  amiloide: 'amiloide',
  tau: 'tau',
  edad: 'edad',
  cognicion: 'cognición',
  neurodegeneracion: 'neurodegeneración',
  neuroinflamacion: 'neuroinflamación',
  'funcion renal': 'función renal',
  sexo: 'sexo',
  'reserva cognitiva': 'reserva cognitiva',
  'barrera hematoencefalica': 'barrera hematoencefálica',
  'funcion hepatica': 'función hepática',
  'indice de masa corporal': 'índice de masa corporal',
  inflamacion: 'inflamación',
  vasculopatia: 'vasculopatía',
  sinapsis: 'sinapsis',
  microglia: 'microglía',
  astrocitos: 'astrocitos',
});

/** Como se escribe un nodo en pantalla. Si no esta en la tabla se deja tal
 *  cual: mejor el castellano que inventarse una traduccion. */
export function nombreDeNodo(etiqueta: string): string {
  return NOMBRE_DE_NODO[sinTildes(etiqueta).toLowerCase()] ?? etiqueta;
}

/** Sin tildes. Se usa para IDENTIFICAR, nunca para enseñar. */
export function sinTildes(texto: string): string {
  return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** El identificador de un nodo de la base, sin el prefijo `B:` y sin tildes.
 *
 *  Lo segundo importa: hasta el 22 de septiembre de 2026 `función renal` se
 *  usaba con tilde como identificador, así que los grafos viejos guardaron
 *  `funcion renal` y los nuevos `función renal`. Sin normalizar, la cascada
 *  sale con el mismo nodo dos veces. */
export function idBase(nodoId: string): string {
  return sinTildes((nodoId || '').replace(/^B:/, ''));
}

/** Un nodo de la cascada del campo, con en cuántas hipótesis entra en juego. */
export interface NodoCascada {
  id: string;
  etiqueta: string;
  capa: Capa;
  /** En cuántos grafos aparece: como actor de la hipótesis o como confusor
   *  que el campo pone encima. No es "cuántas lo estudian". */
  enJuego: number;
  /** Cuántos pasos de la cascada hay por delante de él. Ordena los nodos
   *  DENTRO de su columna, para que la cadena se lea de arriba abajo y las
   *  flechas no vayan hacia atrás. */
  profundidad: number;
}

export interface AristaCascada {
  de: string;
  a: string;
  contexto: string;
  /** En cuántos grafos aparece esta relación del consenso. */
  grafos: number;
}

export interface Cascada {
  nodos: NodoCascada[];
  aristas: AristaCascada[];
  /** Cuántas hipótesis tienen grafo, que es el denominador de `enJuego`. */
  total: number;
}

function conGrafo(hipotesis: Hipotesis[]): { h: Hipotesis; g: GrafoCausal }[] {
  const salida: { h: Hipotesis; g: GrafoCausal }[] = [];
  for (const h of hipotesis) {
    const g = h.grafoCausal;
    // Un registro viejo o a medias puede traer el grafo sin listas: se salta
    // en vez de tumbar la pantalla.
    if (g && Array.isArray(g.nodos) && Array.isArray(g.aristas)) salida.push({ h, g });
  }
  return salida;
}

/** La cascada del campo: la unión de los nodos y aristas de consenso de todos
 *  los grafos, con la cuenta de en cuántos aparece cada uno. */
export function cascada(hipotesis: Hipotesis[]): Cascada {
  const pares = conGrafo(hipotesis);
  const nodos = new Map<string, NodoCascada>();
  const aristas = new Map<string, AristaCascada>();
  for (const { g } of pares) {
    const vistosAqui = new Set<string>();
    for (const n of g.nodos) {
      if (n.rol !== 'base') continue;
      const id = idBase(n.id);
      if (!id) continue;
      const capa = ((n as { capa?: string }).capa as Capa | undefined) ?? CAPA_DE_RESPALDO[id] ?? 'otros';
      const etiqueta = n.etiqueta && sinTildes(n.etiqueta) !== n.etiqueta ? n.etiqueta : ETIQUETA_DE_RESPALDO[id] ?? n.etiqueta ?? id;
      if (!nodos.has(id)) nodos.set(id, { id, etiqueta, capa, enJuego: 0, profundidad: 0 });
      // Un grafo cuenta una vez por nodo aunque lo repita.
      if (!vistosAqui.has(id)) {
        vistosAqui.add(id);
        nodos.get(id)!.enJuego += 1;
      }
    }
    const aristasAqui = new Set<string>();
    for (const a of g.aristas) {
      if (a.tipo !== 'base_curada') continue;
      const de = idBase(a.de);
      const hacia = idBase(a.a);
      if (!de || !hacia) continue;
      const clave = `${de}\u0000${hacia}`;
      if (!aristas.has(clave)) aristas.set(clave, { de, a: hacia, contexto: a.contexto ?? '', grafos: 0 });
      if (!aristasAqui.has(clave)) {
        aristasAqui.add(clave);
        aristas.get(clave)!.grafos += 1;
      }
    }
  }
  // Profundidad: el camino más largo desde una raíz. Ordena dentro de la
  // columna. Sin ella los nodos salían por popularidad y `tau` quedaba encima
  // de `amiloide`, con la flecha `amiloide -> tau` apuntando hacia atrás.
  const prof = new Map<string, number>([...nodos.keys()].map((k) => [k, 0]));
  for (let vuelta = 0; vuelta < nodos.size; vuelta += 1) {
    let cambio = false;
    for (const a of aristas.values()) {
      const nueva = (prof.get(a.de) ?? 0) + 1;
      if (nueva > (prof.get(a.a) ?? 0)) {
        prof.set(a.a, nueva);
        cambio = true;
      }
    }
    if (!cambio) break;
  }
  for (const n of nodos.values()) n.profundidad = prof.get(n.id) ?? 0;

  const orden = new Map(CAPAS.map((c, i) => [c as Capa, i]));
  const lista = [...nodos.values()].sort(
    (x, y) =>
      (orden.get(x.capa) ?? 99) - (orden.get(y.capa) ?? 99) ||
      x.profundidad - y.profundidad ||
      y.enJuego - x.enJuego ||
      x.id.localeCompare(y.id),
  );
  return { nodos: lista, aristas: [...aristas.values()], total: pares.length };
}

/** Cuántas aristas hay de cada tipo en todos los grafos. La de evidencia
 *  puede salir a cero, y entonces se dice. */
export function recuentoAristas(hipotesis: Hipotesis[]): { supuesto: number; inferencia_con_evidencia: number; base_curada: number; total: number } {
  const r = { supuesto: 0, inferencia_con_evidencia: 0, base_curada: 0, total: 0 };
  for (const { g } of conGrafo(hipotesis)) {
    for (const a of g.aristas) {
      if (a.tipo === 'supuesto' || a.tipo === 'inferencia_con_evidencia' || a.tipo === 'base_curada') r[a.tipo] += 1;
      r.total += 1;
    }
  }
  return r;
}

/** Cuántas hipótesis hay en cada veredicto de identificación. */
export function recuentoVeredictos(hipotesis: Hipotesis[]): { identificable: number; acotado: number; sin_resolver: number } {
  const r = { identificable: 0, acotado: 0, sin_resolver: 0 };
  for (const { g } of conGrafo(hipotesis)) {
    if (g.identificacion === 'identificable' || g.identificacion === 'acotado' || g.identificacion === 'sin_resolver') r[g.identificacion] += 1;
  }
  return r;
}

/** Los nombres que un mismo supuesto tuvo antes del 22 de septiembre de 2026,
 *  cuando el cumplido y el faltante se llamaban distinto. Los grafos ya
 *  guardados (la corrida 16 entre ellos) los siguen trayendo, y sin esta tabla
 *  la pantalla enseñaría dos filas para lo mismo: medido allí, "Ajuste"
 *  cumplía en 5 y "Confusión" faltaba en 16, que son las 21 partidas en dos.
 *  Los grafos nuevos ya salen con un solo nombre desde `rosa/causal.py`. */
const NOMBRE_ANTIGUO: Record<string, string> = traducido({
  ajuste: 'Ajuste por confusores',
  confusion: 'Ajuste por confusores',
  replicacion: 'Replicación independiente',
});

/** El nombre corto de un supuesto: lo que va antes de los dos puntos.
 *  Se agrupa SIN tildes porque el mismo supuesto aparece escrito de las dos
 *  formas en los registros ("Confusión" y "Confusion"): agrupar por el texto
 *  tal cual partiría cada uno en dos. */
export function nombreDeSupuesto(texto: string): string {
  const cabeza = (texto || '').split(':')[0]!.trim();
  return NOMBRE_ANTIGUO[sinTildes(cabeza).toLowerCase()] ?? cabeza;
}

export interface SupuestoAgregado {
  clave: string;
  nombre: string;
  cumplen: number;
  faltan: number;
}

/** Cada supuesto con cuántas hipótesis lo cumplen y a cuántas les falta. */
export function supuestosAgregados(hipotesis: Hipotesis[]): SupuestoAgregado[] {
  const mapa = new Map<string, SupuestoAgregado>();
  const anotar = (texto: string, campo: 'cumplen' | 'faltan') => {
    const nombre = nombreDeSupuesto(texto);
    if (!nombre) return;
    const clave = sinTildes(nombre).toLowerCase();
    if (!mapa.has(clave)) mapa.set(clave, { clave, nombre, cumplen: 0, faltan: 0 });
    const fila = mapa.get(clave)!;
    // Se guarda la forma con tildes, que es la buena para leer.
    if (sinTildes(nombre) !== nombre) fila.nombre = nombre;
    fila[campo] += 1;
  };
  for (const { g } of conGrafo(hipotesis)) {
    for (const s of g.supuestosCumplidos ?? []) anotar(s, 'cumplen');
    for (const s of g.supuestosFaltantes ?? []) anotar(s, 'faltan');
  }
  return [...mapa.values()].sort((x, y) => y.faltan - x.faltan || x.nombre.localeCompare(y.nombre));
}

/** Las cuatro clases de amenaza, con su nombre en llano. El rol viene del
 *  servidor como `alternativa_<clase>`. */
export const CLASE_AMENAZA: Record<string, string> = traducido({
  alternativa_confusor: 'Confusor',
  alternativa_causa_inversa: 'Causa inversa',
  alternativa_artefacto: 'Artefacto de medida',
  alternativa_seleccion: 'Sesgo de selección',
  alternativa_otra: 'Otra explicación',
});

export interface Amenaza {
  id: string;
  clase: string;
  texto: string;
  /** A qué ataca, según las aristas del grafo: la exposición ('X'), el
   *  desenlace ('Y') o las dos. Medido el 22 de septiembre de 2026 sobre la
   *  corrida 16: las amenazas apuntan a Y 51 veces y a X 32, y NUNCA a un nodo
   *  de la cascada. Si la pantalla las dibuja apuntando a otra cosa, está
   *  inventando una relación. */
  hacia: string[];
}

/** Las explicaciones alternativas de un grafo: lo que tendría que ser falso
 *  para que el efecto sea del actor y no de otra cosa, con lo que ataca cada
 *  una. */
export function amenazasDe(grafo: GrafoCausal | null | undefined): Amenaza[] {
  if (!grafo || !Array.isArray(grafo.nodos)) return [];
  const aristas = Array.isArray(grafo.aristas) ? grafo.aristas : [];
  return grafo.nodos
    .filter((n) => typeof n.rol === 'string' && n.rol.startsWith('alternativa_'))
    .map((n) => ({
      id: n.id,
      clase: CLASE_AMENAZA[n.rol] ?? tr('Otra explicación'),
      texto: n.etiqueta ?? '',
      hacia: [...new Set(aristas.filter((a) => a.de === n.id).map((a) => a.a))],
    }));
}

/** La exposición y el desenlace de un grafo, que es lo que la hipótesis
 *  afirma que se mueve con qué. */
export function actoresDe(grafo: GrafoCausal | null | undefined): { exposicion: string; desenlace: string } {
  const busca = (rol: string) => (grafo?.nodos ?? []).find((n) => n.rol === rol)?.etiqueta ?? '';
  return { exposicion: busca('exposicion'), desenlace: busca('desenlace') };
}

/** Cómo se lee un veredicto de identificación, con su explicación. */
export const EN_LLANO_IDENTIFICACION: Record<string, { titulo: string; que: string }> = traducido({
  identificable: {
    titulo: 'Efecto identificable',
    que: 'Con la evidencia que hay se puede estimar el efecto sin que lo confunda otra causa.',
  },
  acotado: {
    titulo: 'Efecto acotado',
    que: 'Faltan supuestos concretos. Lo que falta es lo que un experimento o un conjunto de datos tendría que aportar.',
  },
  sin_resolver: {
    titulo: 'Sin resolver',
    que: 'No hay con qué separar el efecto de sus explicaciones alternativas.',
  },
});

/** El veredicto de identificación, por regla y no por modelo.
 *
 *  Es la MISMA línea que decide en `rosa/causal.py`:
 *
 *      identificacion = "identificable" if not faltantes
 *                       else ("acotado" if cumplidos else "sin_resolver")
 *
 *  Se repite aquí porque la pantalla deja encender un supuesto que hoy falta
 *  para ver a dónde llevaría, y ese recálculo no puede pedirse al servidor:
 *  no ha pasado, es una pregunta. Si la regla cambia allí, cambia aquí, y el
 *  test `el veredicto sale de contar` lo sujeta. */
export function veredictoPorRegla(cumplen: number, faltan: number): 'identificable' | 'acotado' | 'sin_resolver' {
  if (faltan <= 0) return cumplen > 0 ? 'identificable' : 'sin_resolver';
  return cumplen > 0 ? 'acotado' : 'sin_resolver';
}

/** Dónde va cada nodo de la cascada, en un lienzo de `ancho` por `alto`.
 *
 *  Una columna por tramo de la enfermedad, en el orden en que ocurre, y
 *  dentro de cada columna los nodos repartidos a lo alto. Es determinista: la
 *  misma cascada da siempre el mismo dibujo, que es lo que hace que la
 *  pantalla no baile entre renders. */
export interface Puesto {
  id: string;
  x: number;
  y: number;
  capa: Capa;
}

export function posicionesCascada(nodos: NodoCascada[], ancho: number, alto: number): Puesto[] {
  const usadas = CAPAS.filter((c) => nodos.some((n) => n.capa === c));
  const sueltos = nodos.some((n) => !usadas.includes(n.capa as (typeof CAPAS)[number]));
  const columnas: Capa[] = sueltos ? [...usadas, 'otros'] : [...usadas];
  if (!columnas.length) return [];
  const paso = columnas.length > 1 ? ancho / (columnas.length - 1) : 0;
  const puestos: Puesto[] = [];
  columnas.forEach((capa, i) => {
    const dentro = nodos.filter((n) => (columnas.includes(n.capa) ? n.capa === capa : capa === 'otros'));
    dentro.forEach((n, j) => {
      // Repartidos a lo alto y centrados: con uno solo cae en medio.
      const y = dentro.length === 1 ? alto / 2 : (alto * (j + 0.5)) / dentro.length;
      puestos.push({ id: n.id, x: columnas.length > 1 ? i * paso : ancho / 2, y, capa });
    });
  });
  return puestos;
}

/** Cuánto pesa un nodo en el programa, para pintarlo con más o menos fuerza.
 *
 *  El realce NO puede ser "está en el grafo de esta hipótesis": medido el 22
 *  de septiembre de 2026, el grafo de una hipótesis trae casi siempre los once
 *  nodos de la base (como actores o como confusores), así que todos saldrían
 *  encendidos y no distinguiría nada. Lo que sí distingue es en cuántas de
 *  todas entra en juego. */
export function intensidad(enJuego: number, total: number): 'alta' | 'media' | 'baja' {
  if (total <= 0) return 'baja';
  const parte = enJuego / total;
  if (parte >= 0.66) return 'alta';
  if (parte >= 0.33) return 'media';
  return 'baja';
}

/** Una caja del lienzo, en coordenadas del dibujo: centro y medidas. */
export interface Caja {
  id: string;
  x: number;
  y: number;
}

/** Cuánto hay que desviar una flecha para que NO pase por detrás de una caja
 *  que no es la suya.
 *
 *  Por qué existe. Una flecha que cruza por detrás de una caja parece salir de
 *  ella, y entonces el lector se cree una relación causal que no está en los
 *  datos. Pasó el 22 de septiembre de 2026: `edad -> neurodegeneracion` cruza
 *  por detrás de `amiloide` y se lee como `amiloide -> neurodegeneracion`, que
 *  no existe; y `amiloide -> GFAP` cruza por detrás de `neurodegeneracion` y se
 *  lee como `neurodegeneracion -> GFAP`, que tampoco.
 *
 *  Devuelve el desplazamiento vertical (0 si no estorba nadie). El signo elige
 *  el lado con más sitio: hacia arriba si la caja que estorba está por debajo
 *  de la trayectoria, y al revés. */
export function desvioDeArco(
  a: { x: number; y: number },
  b: { x: number; y: number },
  cajas: Caja[],
  anchoCaja: number,
  altoCaja: number,
): number {
  const izq = Math.min(a.x, b.x);
  const der = Math.max(a.x, b.x);
  // La altura por la que pasaría la curva en su tramo central.
  const medio = (a.y + b.y) / 2;
  let estorbo: Caja | null = null;
  for (const c of cajas) {
    // Solo las que quedan ENTRE las dos puntas, sin contar las puntas mismas.
    if (c.x <= izq + anchoCaja / 2 || c.x >= der - anchoCaja / 2) continue;
    if (Math.abs(c.y - medio) > altoCaja) continue;
    if (!estorbo || Math.abs(c.y - medio) < Math.abs(estorbo.y - medio)) estorbo = c;
  }
  if (!estorbo) return 0;
  const hueco = altoCaja * 0.85 + 12;
  // Se rodea por el lado contrario a donde está la caja que estorba.
  return estorbo.y >= medio ? -hueco : hueco;
}

/** Los supuestos de la FICHA de la hipótesis, contados por estado.
 *
 *  No son los mismos que los tres supuestos causales del panel. Los causales
 *  dicen si el efecto sería identificable; estos dicen si los ingredientes de
 *  la hipótesis existen. Pueden ir en direcciones opuestas y de hecho van:
 *  medido el 22 de septiembre de 2026, "La normalización de P-tau181" tiene
 *  los 3 causales cumplidos (identificable) y 10 de sus 12 supuestos de ficha
 *  SIN evidencia, incluido el que la define (que exista un intervalo de
 *  referencia de P-tau181 en amiloide-negativos). Enseñar solo los tres verdes
 *  la vende mejor de lo que es.
 *
 *  Vienen en árbol (`hijos`), así que se recorren enteros. */
export interface RecuentoSupuestos {
  total: number;
  respaldado: number;
  plausible: number;
  sin_evidencia: number;
  contradicho: number;
  /** Los que no se llegaron a evaluar: "no pude comprobar", nunca "no hay". */
  no_evaluado: number;
  /** Los que no sostienen nada: sin evidencia más contradichos. No incluye los
   *  que no se pudieron comprobar, que no dicen nada en ninguna dirección. */
  flojos: number;
}

type SupuestoArbol = { estado?: string; hijos?: SupuestoArbol[] };

export function supuestosDeLaFicha(hipotesis: Hipotesis | null | undefined): RecuentoSupuestos {
  const r: RecuentoSupuestos = { total: 0, respaldado: 0, plausible: 0, sin_evidencia: 0, contradicho: 0, no_evaluado: 0, flojos: 0 };
  const andar = (lista: SupuestoArbol[] | undefined, profundidad: number) => {
    // Un árbol roto o con un ciclo no puede colgar la pantalla.
    if (!Array.isArray(lista) || profundidad > 12) return;
    for (const s of lista) {
      if (!s || typeof s !== 'object') continue;
      r.total += 1;
      if (s.estado === 'respaldado') r.respaldado += 1;
      else if (s.estado === 'plausible') r.plausible += 1;
      else if (s.estado === 'sin_evidencia') r.sin_evidencia += 1;
      else if (s.estado === 'contradicho') r.contradicho += 1;
      else if (s.estado === 'no_evaluado') r.no_evaluado += 1;
      andar(s.hijos, profundidad + 1);
    }
  };
  andar((hipotesis as { supuestos?: SupuestoArbol[] } | null | undefined)?.supuestos, 0);
  // Los flojos son los que la evidencia no sostiene. Los que no se pudieron
  // comprobar se cuentan aparte: no saber no es lo mismo que saber que no.
  r.flojos = r.sin_evidencia + r.contradicho;
  return r;
}
