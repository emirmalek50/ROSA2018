import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Afirmacion, Ejecucion, PlanAnalisis } from '../datos/tipos';
import { fijarIdioma } from './idioma';
import { alternar, buscar, construirArbol, pesoHipotesis, distancias, ENLACES_EVIDENCIA, ESTRUCTURA, fraseProfundidad, incorporarNovedades, medicionDeAfirmacion, medicionDeEjecucion, NOMBRE_ENLACE, NOMBRE_TIPO, paso, posicionInicial, recortar, visiblesIniciales, type EnlaceArbol, type Grafo, type NodoArbol, type Posicion } from './arbol';

describe('el arbol de la investigacion', () => {
  const e = estadoDeMuestra();
  const inv = e.investigaciones[0]!;
  const g = construirArbol(e, inv);
  const hip = e.hipotesis.filter((h) => h.investigacionId === inv.id);

  it('el grupo sin familia conserva ids y enlaces al traducir sus etiquetas', () => {
    const estado = structuredClone(e);
    for (const h of estado.hipotesis) if (h.investigacionId === inv.id) h.cluster = '';
    const original = JSON.stringify(estado);
    fijarIdioma('es');
    const es = construirArbol(estado, inv);
    fijarIdioma('en');
    try {
      const en = construirArbol(estado, inv);
      expect(en.nodos.map(n => n.id)).toEqual(es.nodos.map(n => n.id));
      expect(en.enlaces.map(n => [n.de, n.a, n.tipo])).toEqual(es.enlaces.map(n => [n.de, n.a, n.tipo]));
      expect(en.porId.get('rama-Sin cluster')?.etiqueta).toBe('No cluster');
      expect(JSON.stringify(estado)).toBe(original);
    } finally { fijarIdioma('es'); }
  });

  it('muestra cualquier tipo de nodo nuevo con sus conexiones', () => {
    for (const nodo of g.nodos) {
      const anteriores = new Set(g.nodos.filter((n) => n.id !== nodo.id).map((n) => n.id));
      const visibles = incorporarNovedades(g, anteriores, new Set(['objetivo']));
      expect(visibles.has(nodo.id)).toBe(true);
      for (const vecino of g.vecinos.get(nodo.id) ?? []) expect(visibles.has(vecino)).toBe(true);
    }
  });

  it('no despliega nodos plegados al recibir el mismo grafo y elimina los borrados', () => {
    const anteriores = new Set(g.nodos.map((n) => n.id));
    expect(incorporarNovedades(g, anteriores, new Set(['objetivo', 'borrado']))).toEqual(new Set(['objetivo']));
  });

  it('tiene tronco, ramas y hojas, y ningun enlace suelto', () => {
    expect(g.porId.get('objetivo')?.tipo).toBe('objetivo');
    const clustersConVarias = new Set(hip.map((h) => h.cluster || 'Sin cluster').filter((c, _, arr) => arr.filter((x) => x === c).length >= 2));
    expect(g.nodos.filter((n) => n.tipo === 'rama').length).toBe(clustersConVarias.size);
    expect(g.nodos.filter((n) => n.tipo === 'hipotesis').length).toBe(hip.length);
    for (const en of g.enlaces) {
      expect(g.porId.has(en.de), en.de).toBe(true);
      expect(g.porId.has(en.a), en.a).toBe(true);
    }
    // Cada hipotesis cuelga de su rama; cada fuente citada existe una sola vez.
    for (const h of hip) expect(g.enlaces.some((en) => en.tipo === 'rama' && en.a === h.id && (en.de === 'objetivo' || en.de.startsWith('rama-')))).toBe(true);
    // Una rama existe solo si agrupa dos o mas hipotesis.
    for (const r of g.nodos.filter((n) => n.tipo === 'rama')) expect(g.enlaces.filter((en) => en.de === r.id && en.tipo === 'rama').length).toBeGreaterThanOrEqual(2);
    const fuentes = g.nodos.filter((n) => n.tipo === 'fuente').map((n) => n.id);
    expect(new Set(fuentes).size).toBe(fuentes.length);
  });

  it('al abrir se ven pocas cosas y al pulsar se despliegan y se pliegan', () => {
    const v0 = visiblesIniciales(g, hip);
    expect(v0.has('objetivo')).toBe(true);
    expect([...v0].every((id) => ['objetivo', 'rama', 'area', 'hipotesis', 'experimento'].includes(g.porId.get(id)!.tipo))).toBe(true);
    const h = hip[0]!;
    const v1 = alternar(g, v0, h.id);
    expect(v1.size).toBeGreaterThan(v0.size);
    // Plegar quita lo que solo se sostenia por esta hipotesis; lo compartido con
    // otras visibles se queda (es la regla, no un fallo).
    const v2 = alternar(g, v1, h.id);
    expect(v2.size).toBeLessThanOrEqual(v1.size);
    for (const id of g.vecinos.get(h.id) ?? []) {
      const n = g.porId.get(id)!;
      if (['objetivo', 'rama', 'area', 'hipotesis'].includes(n.tipo)) continue;
      const otros = [...(g.vecinos.get(id) ?? [])].filter((o) => o !== h.id && v2.has(o));
      expect(v2.has(id), id).toBe(otros.length > 0);
    }
  });

  it('busca por etiqueta y por identificador o alias', () => {
    const conEntidad = g.nodos.find((n) => n.tipo === 'entidad');
    if (conEntidad) expect(buscar(g, conEntidad.alias![0]!).has(conEntidad.id)).toBe(true);
    expect(buscar(g, hip[0]!.titulo.slice(0, 12)).has(hip[0]!.id)).toBe(true);
    expect(buscar(g, 'x').size).toBe(0);
  });

  it('la disposicion por fuerzas separa los nodos y deja el tronco fijo', () => {
    const visibles = visiblesIniciales(g, hip);
    const pos = new Map<string, Posicion>();
    let s = 1;
    for (const id of visibles) pos.set(id, posicionInicial(g, pos, id, s++));
    for (let i = 0; i < 200; i++) paso(g, visibles, pos, Math.max(0.05, 1 - i / 200));
    expect(pos.get('objetivo')).toMatchObject({ x: 0, y: 0 });
    const ids = [...visibles];
    let minimo = Infinity;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i]!)!;
      const b = pos.get(ids[j]!)!;
      minimo = Math.min(minimo, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(minimo).toBeGreaterThan(8);
    for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

/* ---------------------------------------------------------------------
   Profundidad hasta el dato. El estado de muestra no trae ejecuciones ni
   planes de análisis: se inyectan a mano una ejecución válida, su plan y una
   afirmación con dato (observación original) sobre hip-1.
   --------------------------------------------------------------------- */

function ejecucion(id: string, hipotesisId: string | null, planId: string, extra: Partial<Ejecucion> = {}): Ejecucion {
  return {
    id,
    investigacionId: 'inv-1',
    hipotesisId,
    planId,
    tipo: 'hipotesis',
    codigo: 'print("RESULTADO r=0.41")',
    entorno: { python: '3.12', paquetes: [] },
    semilla: 7,
    hashDatos: 'sha256:datos',
    hashPlan: 'sha256:plan',
    inicio: 1,
    fin: 2,
    estado: 'completado',
    runtime: 'docker',
    red: 'deshabilitada',
    codigoSalida: 0,
    duracionS: 1,
    salida: 'RESULTADO r=0.41',
    error: '',
    resultados: { r: '0.41' },
    baseline: { r: '0.02' },
    controlNegativo: { r: '0.01' },
    repeticiones: [],
    interpretacion: { estado: 'efecto_detectado', resumen: 'Correlación moderada, baseline y control negativo en orden.' },
    plausibilidadVerificada: true,
    auditoria: { veredicto: 'valido', comprobaciones: [], motivo: 'Baseline y control negativo en orden; n plausible.', quien: 'Killer II', fecha: 2 },
    ...extra,
  };
}

function plan(id: string, hipotesisId: string, datasetId: string): PlanAnalisis {
  return {
    id,
    investigacionId: 'inv-1',
    hipotesisId,
    datasetId,
    tipo: 'confirmatorio',
    pregunta: '¿Se correlacionan GFAP y NfL en la cohorte abierta?',
    variables: ['gfap', 'nfl'],
    poblacion: 'Portadores de APOE4',
    preprocesado: [],
    prueba: 'Correlación de Spearman',
    hipotesisNula: 'rho = 0',
    hipotesisAlternativa: 'rho > 0',
    alpha: 0.05,
    direccionEsperada: 'positiva',
    tamanoEfectoMinimo: 'rho 0,2',
    baseline: 'permutación',
    controlNegativo: 'etiquetas barajadas',
    correccionMultiplicidad: 'ninguna',
    umbralEfecto: 'rho 0,2',
    criterioNoEvaluable: 'n < 50',
    semilla: 1,
    hashDatos: 'sha256:datos',
    hashPlan: 'sha256:plan',
    congeladoEn: 1,
    autor: 'rosa',
    reproduccionId: null,
  };
}

function afirmacionDato(texto: string, extra: Partial<Afirmacion> = {}): Afirmacion {
  return { texto, cita: '[Ejecución run-1, celda 3]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'dato', trayectoria: null, clase: 'observacion_original', ...extra };
}

/** Copia profunda del estado de muestra: `estadoDeMuestra()` devuelve las
 *  mismas instancias de hipótesis en cada llamada, y estos tests las modifican. */
const muestraCopia = () => structuredClone(estadoDeMuestra());

/** Estado de muestra más una ejecución válida, su plan y una observación original sobre hip-1. */
function estadoConDato() {
  const e = muestraCopia();
  const inv = e.investigaciones[0]!;
  const h = e.hipotesis.find((x) => x.id === 'hip-1')!;
  const datasetId = inv.datasets[0]?.id ?? 'conjunto-abierto';
  const run = ejecucion('run-1', h.id, 'plan-1');
  e.ejecuciones = [run];
  e.planesAnalisis = [plan('plan-1', h.id, datasetId)];
  h.afirmaciones = [...h.afirmaciones, afirmacionDato('La correlación entre GFAP y NfL en la cohorte abierta fue de 0,41 (n = 212).', { trayectoria: { id: 'run-1', celda: 3 }, afirmacionId: 'obs-1' })];
  return { e, inv, h, run, datasetId, g: construirArbol(e, inv) };
}

/** BFS de referencia, escrita aparte, para contrastar la del módulo nodo a nodo. */
function referencia(nodos: NodoArbol[], enlaces: EnlaceArbol[], origenes: Set<string>): Map<string, number | null> {
  const salida = new Map<string, number | null>();
  for (const n of nodos) {
    let mejor: number | null = null;
    const vistos = new Map<string, number>([[n.id, 0]]);
    const cola = [n.id];
    while (cola.length) {
      const id = cola.shift()!;
      const k = vistos.get(id)!;
      if (origenes.has(id)) {
        mejor = k;
        break;
      }
      for (const en of enlaces) {
        if (!ENLACES_EVIDENCIA.has(en.tipo)) continue;
        const otro = en.de === id ? en.a : en.a === id ? en.de : null;
        if (otro && !vistos.has(otro)) {
          vistos.set(otro, k + 1);
          cola.push(otro);
        }
      }
    }
    salida.set(n.id, mejor);
  }
  return salida;
}

// El guión largo (U+2014) va escapado para que el carácter no aparezca en el código.
const sinGuionLargo = (t: string | undefined) => !(t ?? '').includes('\u2014');

describe('profundidad hasta el dato', () => {
  it('añade la afirmación con dato, el análisis, el conjunto de datos y los enlaces "dato", sin aristas sueltas', () => {
    const { g, h, run, datasetId, inv } = estadoConDato();
    expect(g.porId.get('af-obs-1')?.tipo).toBe('afirmacion');
    expect(g.porId.get('af-obs-1')?.etiqueta.length).toBeLessThanOrEqual(60);
    expect(g.porId.get('af-obs-1')?.sub?.startsWith('medición propia')).toBe(true);
    expect(g.porId.get(run.id)?.tipo).toBe('ejecucion');
    expect(g.porId.get(run.id)?.etiqueta).toBe('Análisis in silico');
    expect(g.porId.get(run.id)?.sub).toBe('completado · auditoría: válido');
    expect(g.porId.get(`ds-${datasetId}`)?.tipo).toBe('dataset');
    expect(g.porId.get(`ds-${datasetId}`)?.etiqueta).toBe(inv.datasets[0]?.nombre ?? datasetId);
    const tiene = (de: string, a: string) => g.enlaces.some((en) => en.tipo === 'dato' && en.de === de && en.a === a);
    expect(tiene(h.id, 'af-obs-1')).toBe(true);
    expect(tiene(h.id, run.id)).toBe(true);
    expect(tiene('af-obs-1', run.id)).toBe(true);
    expect(tiene(run.id, `ds-${datasetId}`)).toBe(true);
    for (const en of g.enlaces) {
      expect(g.porId.has(en.de), en.de).toBe(true);
      expect(g.porId.has(en.a), en.a).toBe(true);
      expect(NOMBRE_ENLACE[en.tipo]).toBeTruthy();
    }
    for (const n of g.nodos) {
      expect(NOMBRE_TIPO[n.tipo]).toBeTruthy();
      expect(sinGuionLargo(n.etiqueta) && sinGuionLargo(n.sub) && sinGuionLargo(n.alerta)).toBe(true);
    }
    expect(NOMBRE_TIPO.afirmacion).toBe('Afirmación con dato');
    expect(NOMBRE_TIPO.ejecucion).toBe('Análisis in silico');
    expect(NOMBRE_TIPO.dataset).toBe('Conjunto de datos');
    expect(NOMBRE_TIPO.laboratorio).toBe('Resultado del laboratorio');
    expect(NOMBRE_TIPO.hipotesis).toBe('Hipótesis');
  });

  it('la hipótesis con análisis válido está a 1 salto; el análisis y la observación a 0; una fuente sin camino es null', () => {
    const { g, h, run, datasetId } = estadoConDato();
    expect(g.profundidadDato!.get(h.id)).toBe(1);
    expect(g.porId.get(h.id)?.profundidadDato).toBe(1);
    expect(g.porId.get(run.id)?.profundidadDato).toBe(0);
    expect(g.porId.get(run.id)?.medicion).toContain('válido');
    expect(g.porId.get('af-obs-1')?.profundidadDato).toBe(0);
    expect(g.porId.get(`ds-${datasetId}`)?.profundidadDato).toBe(1);
    // El tronco es estructura: los enlaces 'rama' no llevan evidencia.
    expect(g.porId.get('objetivo')?.profundidadDato).toBeNull();
    // La fuente retractada solo la cita la hipótesis descartada, que no tiene dato alguno.
    expect(g.porId.get('fu-f-retractado')?.profundidadDato).toBeNull();
    expect(g.porId.get('hip-5')?.profundidadDato).toBeNull();
    expect(g.nodos.some((n) => n.tipo === 'fuente' && n.profundidadDato === null)).toBe(true);
    // Contraste nodo a nodo con una BFS escrita aparte.
    const esperado = referencia(g.nodos, g.enlaces, new Set(g.nodos.filter((n) => n.medicion).map((n) => n.id)));
    for (const n of g.nodos) expect(n.profundidadDato, n.id).toBe(esperado.get(n.id));
  });

  it('la hipótesis que cita una fuente leída está a 1 salto de literatura; la fuente, a 0; una fuente sin texto no es origen', () => {
    const { e, inv, h } = estadoConDato();
    const h3 = e.hipotesis.find((x) => x.id === 'hip-3')!;
    // Copias, no las fuentes compartidas del módulo de muestra.
    h3.procedencia.fuentes = h3.procedencia.fuentes.map((f) => ({ ...f, textoCompleto: false, fragmento: '' }));
    const g = construirArbol(e, inv);
    expect(g.porId.get(h.id)?.profundidadLiteratura).toBe(1);
    expect(g.porId.get('fu-f-cohorte-2025')?.profundidadLiteratura).toBe(0);
    const noLeida = g.porId.get(`fu-${h3.procedencia.fuentes[0]!.id}`)!;
    expect(noLeida.profundidadLiteratura).not.toBe(0);
    const esperado = referencia(g.nodos, g.enlaces, new Set(g.nodos.filter((n) => n.profundidadLiteratura === 0).map((n) => n.id)));
    for (const n of g.nodos) expect(n.profundidadLiteratura, n.id).toBe(esperado.get(n.id));
  });

  it('los nodos nuevos no se ven al abrir y se despliegan al pulsar la hipótesis', () => {
    const { g, e, inv, h, run } = estadoConDato();
    const hip = e.hipotesis.filter((x) => x.investigacionId === inv.id);
    const v0 = visiblesIniciales(g, hip);
    for (const n of g.nodos) if (['afirmacion', 'ejecucion', 'dataset', 'laboratorio'].includes(n.tipo)) expect(v0.has(n.id), n.id).toBe(false);
    const v1 = alternar(g, v0, h.id);
    expect(v1.has('af-obs-1') && v1.has(run.id)).toBe(true);
    // La disposición por fuerzas conoce el enlace nuevo: nada se va al infinito.
    const todos = new Set(g.nodos.map((n) => n.id));
    const pos = new Map<string, Posicion>();
    let s = 1;
    for (const id of todos) pos.set(id, posicionInicial(g, pos, id, s++));
    for (let i = 0; i < 120; i++) paso(g, todos, pos, Math.max(0.05, 1 - i / 120));
    for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('el resultado del laboratorio cuelga del experimento (o de la hipótesis si no hay nodo de experimento) y es medición', () => {
    const e = muestraCopia();
    const inv = e.investigaciones[0]!;
    const h4 = e.hipotesis.find((x) => x.id === 'hip-4')!;
    const resultado = { veredicto: 'confirma' as const, resultado: 'GFAP se alteró antes que NfL en 31 de 40 portadores.', motivo: '', limitaciones: '', cifras: [], exploratorio: '', fecha: 3, fichero: null };
    h4.experimento = { ...h4.experimento!, estado: 'datos_recibidos', laboratorio: 'FLENI', resultado };
    let g = construirArbol(e, inv);
    expect(g.porId.get('lab-hip-4')?.tipo).toBe('laboratorio');
    expect(g.porId.get('lab-hip-4')?.sub).toBe('confirma · FLENI');
    expect(g.enlaces.some((en) => en.tipo === 'dato' && en.de === 'ex-hip-4' && en.a === 'lab-hip-4')).toBe(true);
    expect(g.porId.get('lab-hip-4')?.profundidadDato).toBe(0);
    expect(g.porId.get('ex-hip-4')?.profundidadDato).toBe(1);
    expect(g.porId.get('hip-4')?.profundidadDato).toBe(2);
    // Un resultado con el experimento aún 'propuesto' (registro raro) cuelga de la hipótesis.
    h4.experimento = { ...h4.experimento, estado: 'propuesto' };
    g = construirArbol(e, inv);
    expect(g.porId.has('ex-hip-4')).toBe(false);
    expect(g.enlaces.some((en) => en.tipo === 'dato' && en.de === 'hip-4' && en.a === 'lab-hip-4')).toBe(true);
    expect(g.porId.get('hip-4')?.profundidadDato).toBe(1);
  });

  it('qué cuenta como medición propia, con su motivo, y qué no', () => {
    expect(medicionDeEjecucion({ estado: 'completado', auditoria: { veredicto: 'valido', comprobaciones: [], motivo: '', quien: '', fecha: 0 } })).toContain('válido');
    expect(medicionDeEjecucion({ estado: 'completado', auditoria: null })).toBeNull();
    expect(medicionDeEjecucion({ estado: 'tiempo_agotado', auditoria: { veredicto: 'valido', comprobaciones: [], motivo: '', quien: '', fecha: 0 } })).toBeNull();
    expect(medicionDeEjecucion({ estado: 'completado', auditoria: { veredicto: 'no_valido', comprobaciones: [], motivo: '', quien: '', fecha: 0 } })).toBeNull();
    expect(medicionDeAfirmacion(afirmacionDato('x'))).toContain('observación original');
    expect(medicionDeAfirmacion(afirmacionDato('x', { clase: 'derivado', veredicto: 'parcial' }))).toContain('en parte');
    // Registro antiguo sin clase: literatura por defecto, no medición.
    expect(medicionDeAfirmacion(afirmacionDato('x', { clase: undefined }))).toBeNull();
    expect(medicionDeAfirmacion(afirmacionDato('x', { sintetico: true }))).toBeNull();
    expect(medicionDeAfirmacion(afirmacionDato('x', { veredicto: 'no_sostenida' }))).toBeNull();
    expect(medicionDeAfirmacion(afirmacionDato('x', { tipo: 'literatura' }))).toBeNull();
    expect(medicionDeAfirmacion(afirmacionDato('x', { clase: 'literatura' }))).toBeNull();
  });

  it('registros antiguos y casos límite: sin ejecuciones, dato sin clase, tiempo agotado, ids repetidos, texto en inglés', () => {
    // El estado de muestra tal cual: sin `ejecuciones` ni `planesAnalisis`. La
    // afirmación de dato de hip-2 (trayectoria r7, sin clase) existe pero no es medición.
    const e = muestraCopia();
    const inv = e.investigaciones[0]!;
    let g = construirArbol(e, inv);
    const afHip2 = g.nodos.find((n) => n.tipo === 'afirmacion' && g.enlaces.some((en) => en.de === 'hip-2' && en.a === n.id));
    expect(afHip2?.id).toBe('af-hip-2-4');
    expect(afHip2?.sub?.startsWith('dato ·')).toBe(true);
    expect(afHip2?.medicion).toBeUndefined();
    expect(g.nodos.filter((n) => n.tipo === 'ejecucion' || n.tipo === 'dataset' || n.tipo === 'laboratorio')).toEqual([]);
    for (const n of g.nodos) expect(n.profundidadDato, n.id).toBeNull();
    expect(g.profundidadDato!.size).toBe(g.nodos.length);
    // Sin hipótesis ni hechos: solo el tronco, sin romper.
    const vacio = construirArbol({ ...e, hipotesis: [], hechos: [], ejecuciones: undefined, planesAnalisis: undefined }, inv);
    expect(vacio.nodos.map((n) => n.tipo)).toContain('objetivo');
    expect(vacio.porId.get('objetivo')?.profundidadDato).toBeNull();
    // Tiempo agotado con auditoría válida: no es medición y lleva alerta; una
    // ejecución repetida en el estado y compartida por dos hipótesis es un solo nodo.
    const h1 = e.hipotesis.find((x) => x.id === 'hip-1')!;
    const h2 = e.hipotesis.find((x) => x.id === 'hip-2')!;
    const agotada = ejecucion('run-t', h1.id, 'plan-1', { estado: 'tiempo_agotado' });
    e.ejecuciones = [agotada, { ...agotada }];
    e.planesAnalisis = [plan('plan-1', h1.id, 'ds-x')];
    h2.ejecuciones = ['run-t'];
    // La misma observación enlazada a dos hipótesis (afirmacionId compartido) es un solo nodo.
    const compartida = afirmacionDato('Shared observation written in English that is clearly longer than sixty characters in total.', { afirmacionId: 'obs-c' });
    h1.afirmaciones = [...h1.afirmaciones, compartida];
    h2.afirmaciones = [...h2.afirmaciones, { ...compartida }];
    g = construirArbol(e, inv);
    expect(g.nodos.filter((n) => n.id === 'run-t').length).toBe(1);
    expect(g.porId.get('run-t')?.medicion).toBeUndefined();
    expect(g.porId.get('run-t')?.alerta).toContain('tiempo agotado');
    expect(g.porId.get('run-t')?.sub).toBe('tiempo agotado · auditoría: válido');
    expect(g.enlaces.filter((en) => en.tipo === 'dato' && en.a === 'run-t').map((en) => en.de).sort()).toEqual(['hip-1', 'hip-2']);
    expect(g.nodos.filter((n) => n.id === 'af-obs-c').length).toBe(1);
    expect(g.enlaces.filter((en) => en.a === 'af-obs-c').map((en) => en.de).sort()).toEqual(['hip-1', 'hip-2']);
    expect(g.porId.get('af-obs-c')?.etiqueta.endsWith('...')).toBe(true);
    expect(g.porId.get('af-obs-c')?.etiqueta.length).toBeLessThanOrEqual(60);
    // La observación compartida sí es medición (0): las dos hipótesis quedan a 1
    // salto; el análisis agotado, que no es medición, a 2; su conjunto de datos a 3.
    expect(g.porId.get('af-obs-c')?.profundidadDato).toBe(0);
    expect(g.porId.get('hip-1')?.profundidadDato).toBe(1);
    expect(g.porId.get('hip-2')?.profundidadDato).toBe(1);
    expect(g.porId.get('run-t')?.profundidadDato).toBe(2);
    expect(g.porId.get('ds-ds-x')?.profundidadDato).toBe(3);
    // Una trayectoria que no es ninguna ejecución no crea enlace.
    expect(g.enlaces.some((en) => en.a === 'r7' || en.de === 'r7')).toBe(false);
    // Un valor de estado desconocido (registro más nuevo que la interfaz) se enseña tal cual.
    const rara = ejecucion('run-n', h1.id, 'plan-1', { estado: 'estado_nuevo' as Ejecucion['estado'], auditoria: null });
    e.ejecuciones = [rara];
    g = construirArbol(e, inv);
    expect(g.porId.get('run-n')?.sub).toBe('estado nuevo · sin auditar');
  });

  it('la frase del panel y el recorte son deterministas', () => {
    expect(fraseProfundidad({ profundidadDato: 0, profundidadLiteratura: null, medicion: 'prueba' })).toBe('Es una medición propia: prueba.');
    expect(fraseProfundidad({ profundidadDato: 1, profundidadLiteratura: 1 })).toBe('A 1 salto de una medición propia.');
    expect(fraseProfundidad({ profundidadDato: 3, profundidadLiteratura: 1 })).toBe('A 3 saltos de una medición propia.');
    expect(fraseProfundidad({ profundidadDato: null, profundidadLiteratura: 2 })).toBe('Sin medición propia detrás; literatura a 2 saltos.');
    expect(fraseProfundidad({ profundidadDato: null, profundidadLiteratura: 0 })).toBe('Sin medición propia detrás; es una fuente leída.');
    expect(fraseProfundidad({ profundidadDato: null, profundidadLiteratura: null })).toBe('Sin medición propia detrás ni fuente leída que la sostenga.');
    expect(fraseProfundidad({})).toBe('Sin medición propia detrás ni fuente leída que la sostenga.');
    expect(recortar('corto', 60)).toBe('corto');
    expect(recortar('a'.repeat(70), 60).length).toBe(60);
    expect(recortar('', 60)).toBe('');
    expect(ESTRUCTURA.has('objetivo') && ESTRUCTURA.has('rama') && ESTRUCTURA.has('area') && !ESTRUCTURA.has('hipotesis')).toBe(true);
    // distancias sobre un grafo suelto: los orígenes que no existen se ignoran.
    const nodos: NodoArbol[] = [{ id: 'a', tipo: 'hipotesis', etiqueta: 'a', peso: 1, iteracion: 1 }, { id: 'b', tipo: 'fuente', etiqueta: 'b', peso: 1, iteracion: 1 }];
    const d = distancias(nodos, [{ de: 'a', a: 'b', tipo: 'rival' }], new Set(['b', 'no-existe']));
    expect(d.get('a')).toBeNull();
    expect(d.get('b')).toBe(0);
    const grafoMinimo: Grafo = { nodos, enlaces: [], vecinos: new Map(), porId: new Map(nodos.map((n) => [n.id, n])), iteracionMax: 1 };
    expect(grafoMinimo.profundidadDato).toBeUndefined();
  });
});

describe('el peso de una hipótesis dice cuánto vale', () => {
  const base = { estado: 'propuesta', candidata: false, conclusion: null } as unknown as Parameters<typeof pesoHipotesis>[0];
  const con = (certeza: string | null, elo: number, extra: Record<string, unknown> = {}) => pesoHipotesis({ ...base, ...(certeza ? { conclusion: { certeza } } : {}), ...extra } as unknown as Parameters<typeof pesoHipotesis>[0], elo);
  it('crece con la certeza GRADE por encima de cualquier diferencia de Elo', () => {
    expect(con('muy_baja', 1800)).toBeLessThan(con('baja', 1200));
    expect(con('baja', 1800)).toBeLessThan(con('moderada', 1200));
    expect(con('moderada', 1800)).toBeLessThan(con('alta', 1200));
  });
  it('dentro del mismo nivel, el torneo mueve hasta 0,3 y la candidatura suma 0,15', () => {
    expect(con('muy_baja', 1500)).toBe(1);
    expect(con('muy_baja', 1800)).toBe(1.3);
    expect(con('muy_baja', 2400)).toBe(1.3);
    expect(con('muy_baja', 1200)).toBe(0.7);
    expect(con('muy_baja', 1500, { candidata: true })).toBe(1.15);
  });
  it('sin conclusión vale como muy baja; una descartada va al mínimo; un Elo roto no rompe', () => {
    expect(con(null, 1500)).toBe(1);
    expect(con('alta', 1900, { estado: 'descartada' })).toBe(0.8);
    expect(Number.isFinite(con('baja', Number.NaN))).toBe(true);
    expect(con('inventada', 1500)).toBe(1);
  });
});
