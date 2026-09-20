// Tests adversarios del constructor "datos" del atlas (lib/atlas.ts). Cada
// test codifica lo que el atlas DEBERÍA hacer y falla hoy: son la prueba de
// cada hallazgo del informe, para que la fase de reparación tenga contra qué
// programar. Los campos que aún no existen en el contrato (iteracionOrdinal,
// hechosNuevos, sinResolver) se leen con `campo` para no romper tsc; cuando
// se añadan, los tests pasan sin tocarlos.
//
// Los hallazgos se comprobaron también contra el estado real de rosa.db (en
// modo solo lectura): en inv-mu2sz2ns-3 la figura enseña 254 registros sin
// filtro y 34 con todos los chips de célula marcados (188 registros no tienen
// célula y no hay chip que los represente); el mapa dice `iteracion: 2` cuando
// su fecha cae en la iteración seguida 27 de 28 (inv-gfap: 1 frente a 5 de 6);
// y hay 23 hechos vivos nacidos después del mapa (22 en inv-gfap) que el atlas
// presenta como "en vivo" sin poder decirlo.

import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { CeldaMapa, Corrida, EstadoRosa, HechoMundo, Hipotesis, Investigacion, Iteracion, MapaEnfermedad } from '../datos/tipos';
import { CELULAS_CLAVES, construirAtlas, hechosDe, hipotesisDe, type Atlas } from './atlas';

const HORA = 3_600_000;
const T0 = 1_760_000_000_000;

/** Lee un campo por nombre sin que tsc se queje de que aún no existe en el tipo. */
const campo = (x: unknown, nombre: string): unknown => (x && typeof x === 'object' ? (x as Record<string, unknown>)[nombre] : undefined);
const entero = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
/** Registros que enseña la pantalla: los de las regiones más los situados sin región. */
const total = (a: Atlas): number => a.regiones.reduce((s, r) => s + r.conteo, 0) + a.sinRegion;

function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

interface Opciones {
  /** Certeza VIVA de hip-a; la celda del mapa la guardó como 'baja'. */
  certezaHipA?: 'baja' | 'moderada';
  /** Una segunda corrida (cor-b, iteración 1) que empieza a T0+5h: el mapa se calculó en ella. */
  dosCorridas?: boolean;
  hechosExtra?: HechoMundo[];
  retocarMapa?: (m: MapaEnfermedad) => MapaEnfermedad;
}

/** Un estado de prueba con la misma forma que el del constructor: una corrida
 *  (cor-a) con tres iteraciones fechadas, tres hechos (uno nacido en la
 *  iteración 1, otro en la 2, otro sin fecha), una pregunta nacida en la 3, y
 *  dos hipótesis (hip-a de la iteración 1, hip-b de la 3, certeza moderada). */
function armar(opciones: Opciones = {}): { estado: EstadoRosa; inv: Investigacion; mapa: MapaEnfermedad } {
  const base = estadoDeMuestra();
  const invBase = base.investigaciones[0]!;
  const corridaBase = base.corridas[0]!;
  const iteracionBase = base.iteraciones[0]!;
  const hechoBase = base.hechos[0]!;
  const hipBase = base.hipotesis[0]!;
  const dos = opciones.dosCorridas === true;
  const fechaMapa = dos ? T0 + 5 * HORA + 30 * 60_000 : T0 + 2 * HORA;

  const mapaBase: MapaEnfermedad = {
    ejes: { estadio: {}, region: {}, tipoCelular: {}, nivel: {} },
    celdas: [
      celda({ estadio: 'preclinica', region: 'hipocampo', tipoCelular: 'astrocito', hechos: ['he-viejo', 'he-nuevo', 'he-fantasma'], hipotesis: ['hip-a'], preguntas: ['pr-tardia'], certezaMax: 'baja', cohortes: ['ADNI'] }),
      celda({ estadio: 'prodromica_dcl', region: 'hipocampo', tipoCelular: null, hechos: ['he-viejo', 'he-sinfecha'], hipotesis: ['hip-b'], certezaMax: 'moderada', cohortes: ['DIAN'] }),
      celda({ estadio: null, region: 'plasma', tipoCelular: 'microglia', hechos: ['he-nuevo'] }),
      celda({ estadio: 'preclinica', region: null, tipoCelular: null, hechos: ['he-sinfecha'] }),
    ],
    huecos: [],
    sinEjes: 0,
    hipotesisSinEjes: 0,
    heredados: 0,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen: 'Resumen de prueba.',
    fecha: fechaMapa,
    // El backend numera por corrida: en la segunda corrida vuelve a ser 1.
    iteracion: dos ? 1 : 2,
    etiquetas: { estadio: {}, region: {}, tipoCelular: {}, nivel: {} },
    definiciones: { estadio: {}, nivel: {} },
  };
  const mapa = opciones.retocarMapa ? opciones.retocarMapa(mapaBase) : mapaBase;
  const inv: Investigacion = { ...invBase, mapaEnfermedad: mapa };

  const corridas: Corrida[] = [{ ...corridaBase, id: 'cor-a', investigacionId: inv.id, numero: 1, empezadaEn: T0, terminadaEn: dos ? T0 + 3 * HORA : null }];
  const iteracion = (id: string, corridaId: string, numero: number, empezadaEn: number, terminadaEn: number | null): Iteracion => ({ ...iteracionBase, id, corridaId, numero, empezadaEn, terminadaEn });
  const iteraciones: Iteracion[] = [iteracion('it-a1', 'cor-a', 1, T0, T0 + HORA), iteracion('it-a2', 'cor-a', 2, T0 + HORA + 1, T0 + 2 * HORA), iteracion('it-a3', 'cor-a', 3, T0 + 2 * HORA + 1, dos ? T0 + 3 * HORA : null)];
  if (dos) {
    corridas.push({ ...corridaBase, id: 'cor-b', investigacionId: inv.id, numero: 2, empezadaEn: T0 + 5 * HORA, terminadaEn: null });
    iteraciones.push(iteracion('it-b1', 'cor-b', 1, T0 + 5 * HORA, null));
  }

  const hecho = (id: string, fecha: number | null, tema: string, tipo: HechoMundo['tipo'] = 'hecho'): HechoMundo => ({
    ...hechoBase,
    id,
    investigacionId: inv.id,
    tipo,
    tema,
    enunciado: `Enunciado de ${id}`,
    actualizadoEn: fecha === null ? (undefined as unknown as number) : fecha,
    historial: fecha === null ? [] : [{ fecha, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido por el bucle' }],
  });
  const hechos: HechoMundo[] = [
    hecho('he-viejo', T0 + 10, 'Biomarcadores'),
    hecho('he-nuevo', T0 + HORA + 10, 'Glía'),
    hecho('he-sinfecha', null, 'Genética'),
    hecho('pr-tardia', T0 + 2 * HORA + 30, 'Pregunta abierta', 'pregunta'),
    ...(opciones.hechosExtra ?? []),
  ];
  const hip = (id: string, creadaEn: number, iteracionN: number, certeza: 'baja' | 'moderada'): Hipotesis => ({
    ...hipBase,
    id,
    investigacionId: inv.id,
    titulo: `Hipótesis ${id}`,
    creadaEn,
    iteracion: iteracionN,
    conclusion: hipBase.conclusion ? { ...hipBase.conclusion, certeza } : ({ certeza } as unknown as Hipotesis['conclusion']),
  });
  const hipotesis: Hipotesis[] = [hip('hip-a', T0 + 20, 1, opciones.certezaHipA ?? 'baja'), hip('hip-b', T0 + 2 * HORA + 20, 3, 'moderada')];
  const estado: EstadoRosa = { ...base, investigaciones: [inv], corridas, iteraciones, hechos, hipotesis };
  return { estado, inv, mapa };
}

describe('hallazgo 1: los registros sin tipo celular no tienen chip ni clave de filtro', () => {
  it('hay un chip para "sin tipo celular" con su conteo, como lo hay para "sin fase identificada"', () => {
    const { estado, inv } = armar();
    const atlas = construirAtlas(estado, inv)!;
    // he-viejo, he-sinfecha e hip-b (celda 2) y he-sinfecha (celda 4): tres registros sin célula.
    const sinCelula = atlas.celulas.find((c) => !CELULAS_CLAVES.includes(c.clave));
    expect(sinCelula, 'falta el chip de los registros sin tipo celular').toBeDefined();
    expect(sinCelula?.conteo).toBe(3);
    expect(sinCelula?.etiqueta).toMatch(/sin tipo celular|sin célula/);
  });

  it('marcar todos los chips de célula enseña lo mismo que no marcar ninguno', () => {
    const { estado, inv } = armar();
    const todo = construirAtlas(estado, inv)!;
    const conTodosLosChips = construirAtlas(estado, inv, { celulas: todo.celulas.map((c) => c.clave) })!;
    // Hoy: 8 registros sin filtro (hipocampo 6, plasma 1, uno sin región) y 5 con
    // todos los chips, porque los tres registros sin célula no tienen clave que pedir.
    expect(total(conTodosLosChips)).toBe(total(todo));
    expect(conTodosLosChips.regiones.find((r) => r.clave === 'hipocampo')!.conteo).toBe(6);
  });
});

describe('hallazgo 2: la iteración del mapa va por corrida y el deslizador en numeración seguida', () => {
  it('la iteración en la que se calculó el mapa está en la misma numeración que iteracionMax', () => {
    const { estado, inv } = armar({ dosCorridas: true });
    const atlas = construirAtlas(estado, inv)!;
    expect(atlas.iteracionMax).toBe(4);
    // El mapa se calculó en la iteración 1 de la segunda corrida, que es la 4 de 4 en
    // la numeración del deslizador. Hoy `iteracion` vale 1 y no hay otro campo: la
    // pantalla diría "calculado al cerrar la iteración 1 de 4".
    const ordinal = entero(campo(atlas, 'iteracionOrdinal')) ?? atlas.iteracion;
    expect(ordinal).toBe(4);
  });
});

describe('hallazgo 3: el atlas no sabe cuántos hechos vivos nacieron después del mapa', () => {
  it('cuenta los hechos vivos de la investigación nacidos tras la fecha del mapa y fuera de él', () => {
    const muestra = estadoDeMuestra();
    const base = muestra.hechos[0]!;
    const propia = muestra.investigaciones[0]!.id;
    const posterior = (id: string, investigacionId: string, tipo: HechoMundo['tipo'], estado: HechoMundo['estado']): HechoMundo => ({
      ...base,
      id,
      investigacionId,
      tipo,
      estado,
      actualizadoEn: T0 + 2 * HORA + 50,
      historial: [{ fecha: T0 + 2 * HORA + 50, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido tras el mapa' }],
    });
    const { estado, inv } = armar({
      hechosExtra: [
        posterior('he-posterior', propia, 'hecho', 'sabido'),
        // Ni una pregunta, ni un hecho descartado, ni uno de otra investigación cuentan.
        posterior('pr-posterior', propia, 'pregunta', 'sabido'),
        posterior('he-descartado', propia, 'hecho', 'descartado'),
        posterior('he-ajeno', 'otra-investigacion', 'hecho', 'sabido'),
      ],
    });
    const atlas = construirAtlas(estado, inv)!;
    // Hoy el campo no existe: la pantalla enseña el mapa como "en vivo" aunque el
    // modelo de mundo tenga hechos nuevos que ROSA2018 situará al cerrar la iteración.
    expect(entero(campo(atlas, 'hechosNuevos'))).toBe(1);
  });
});

describe('hallazgo 4: la certeza de una región en el presente sale de la instantánea, no de la hipótesis viva', () => {
  it('la certeza en el presente es la viva de las hipótesis, como en su ficha', () => {
    // hip-a concluyó 'moderada' después de que el backend guardara la celda con 'baja'.
    const { estado, inv } = armar({ certezaHipA: 'moderada' });
    const hipocampo = (filtros: Parameters<typeof construirAtlas>[2]) => construirAtlas(estado, inv, filtros)!.regiones.find((r) => r.clave === 'hipocampo')!;
    expect(hipocampo({ estadio: 'preclinica' }).certezaMax).toBe('moderada');
  });

  it('volver al presente desde el deslizador no baja la certeza', () => {
    const { estado, inv } = armar({ certezaHipA: 'moderada' });
    const orden = ['muy_baja', 'baja', 'moderada', 'alta'];
    const hipocampo = (filtros: Parameters<typeof construirAtlas>[2]) => construirAtlas(estado, inv, filtros)!.regiones.find((r) => r.clave === 'hipocampo')!;
    const enElPasado = hipocampo({ estadio: 'preclinica', hasta: 1 }).certezaMax;
    const enElPresente = hipocampo({ estadio: 'preclinica' }).certezaMax;
    // Hoy: 'moderada' en la iteración 1 (viva) y 'baja' al volver al presente (instantánea).
    expect(orden.indexOf(enElPresente ?? '')).toBeGreaterThanOrEqual(orden.indexOf(enElPasado ?? ''));
  });
});

describe('hallazgo 5: un id que ya no está en el estado cuenta en el conteo pero no sale en la lista', () => {
  it('el conteo de la región cuadra con lo que el panel puede listar, o dice cuántos no se resolvieron', () => {
    const { estado, inv } = armar();
    const hipocampo = construirAtlas(estado, inv)!.regiones.find((r) => r.clave === 'hipocampo')!;
    const listados = hechosDe(estado, hipocampo.hechos).length + hipotesisDe(estado, hipocampo.hipotesis).length;
    // Hoy: conteo 6 y el panel lista 5 (he-fantasma no existe en el estado).
    expect(hipocampo.conteo - listados).toBe(entero(campo(hipocampo, 'sinResolver')) ?? 0);
  });
});

describe('hallazgo 6: el deslizador no filtra las preguntas abiertas', () => {
  it('una pregunta nacida en la iteración 3 no se lista en la iteración 1', () => {
    const { estado, inv } = armar();
    const hipocampo = construirAtlas(estado, inv, { hasta: 1 })!.regiones.find((r) => r.clave === 'hipocampo')!;
    expect(hipocampo.preguntas).not.toContain('pr-tardia');
    // En el presente sí.
    expect(construirAtlas(estado, inv)!.regiones.find((r) => r.clave === 'hipocampo')!.preguntas).toContain('pr-tardia');
  });
});

describe('hallazgo 7: una región que el backend añadiera después se etiqueta con su clave cruda', () => {
  it('la etiqueta de una región desconocida se lee en castellano, sin guiones bajos', () => {
    const { estado, inv } = armar({
      retocarMapa: (m) => ({ ...m, celdas: [...m.celdas, celda({ region: 'medula_espinal', hechos: ['he-viejo'] })] }),
    });
    const nueva = construirAtlas(estado, inv)!.regiones.at(-1)!;
    expect(nueva.clave).toBe('medula_espinal');
    expect(nueva.etiqueta).not.toContain('_');
  });
});
