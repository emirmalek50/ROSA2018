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

/** Los tramos de la enfermedad, en el orden en que ocurren. Es el mismo
 *  orden que `CAPAS` en `rosa/causal.py`, que es donde se decide. */
export const CAPAS = ['factores', 'patologia', 'dano', 'marcadores', 'desenlace'] as const;
export type Capa = (typeof CAPAS)[number] | 'otros';

/** El rótulo de cada columna. Los identificadores van sin tilde; el texto que
 *  se lee, con ella. */
export const TITULO_CAPA: Record<Capa, string> = {
  factores: 'FACTORES',
  patologia: 'PATOLOGÍA',
  dano: 'DAÑO',
  marcadores: 'MARCADORES',
  desenlace: 'DESENLACE',
  otros: 'OTROS',
};

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
const ETIQUETA_DE_RESPALDO: Record<string, string> = {
  neurodegeneracion: 'neurodegeneración',
  cognicion: 'cognición',
  neuroinflamacion: 'neuroinflamación',
  'funcion renal': 'función renal',
};

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
      if (!nodos.has(id)) nodos.set(id, { id, etiqueta, capa, enJuego: 0 });
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
  const orden = new Map(CAPAS.map((c, i) => [c as Capa, i]));
  const lista = [...nodos.values()].sort(
    (x, y) => (orden.get(x.capa) ?? 99) - (orden.get(y.capa) ?? 99) || y.enJuego - x.enJuego || x.id.localeCompare(y.id),
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
const NOMBRE_ANTIGUO: Record<string, string> = {
  ajuste: 'Ajuste por confusores',
  confusion: 'Ajuste por confusores',
  replicacion: 'Replicación independiente',
};

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
export const CLASE_AMENAZA: Record<string, string> = {
  alternativa_confusor: 'Confusor',
  alternativa_causa_inversa: 'Causa inversa',
  alternativa_artefacto: 'Artefacto de medida',
  alternativa_seleccion: 'Sesgo de selección',
  alternativa_otra: 'Otra explicación',
};

export interface Amenaza {
  id: string;
  clase: string;
  texto: string;
}

/** Las explicaciones alternativas de un grafo: lo que tendría que ser falso
 *  para que el efecto sea del actor y no de otra cosa. */
export function amenazasDe(grafo: GrafoCausal | null | undefined): Amenaza[] {
  if (!grafo || !Array.isArray(grafo.nodos)) return [];
  return grafo.nodos
    .filter((n) => typeof n.rol === 'string' && n.rol.startsWith('alternativa_'))
    .map((n) => ({ id: n.id, clase: CLASE_AMENAZA[n.rol] ?? 'Otra explicación', texto: n.etiqueta ?? '' }));
}

/** La exposición y el desenlace de un grafo, que es lo que la hipótesis
 *  afirma que se mueve con qué. */
export function actoresDe(grafo: GrafoCausal | null | undefined): { exposicion: string; desenlace: string } {
  const busca = (rol: string) => (grafo?.nodos ?? []).find((n) => n.rol === rol)?.etiqueta ?? '';
  return { exposicion: busca('exposicion'), desenlace: busca('desenlace') };
}

/** Cómo se lee un veredicto de identificación, con su explicación. */
export const EN_LLANO_IDENTIFICACION: Record<string, { titulo: string; que: string }> = {
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
};

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
