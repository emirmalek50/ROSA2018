import { describe, expect, it } from 'vitest';
import type { ConsultaBusqueda, Corrida, Investigacion, Iteracion, PasoPlan, Pista } from '../datos/tipos';
import { avanceDe, baseDe, busquedasDe, elencoDe, haceCuanto, latidoDe, limitesDe, pasoFoco, pistaFoco, relojDe, temaParaProfundizar, topesDe, tramosDe } from './escenario';

const paso = (id: string, estado: PasoPlan['estado'], tipo = 'literatura') => ({ id, estado, tipo, titulo: id }) as unknown as PasoPlan;
const pista = (p: Partial<Pista>) => ({ id: 'p', pasoId: 'a', titulo: 't', fuente: 'Exa', estado: 'hecha', ms: 0, resumen: '', transcripcion: [], ...p }) as unknown as Pista;
const iteracion = (plan: PasoPlan[], pistas: Pista[] = [], extra: Partial<Iteracion> = {}) => ({ numero: 1, plan, pistas, terminadaEn: null, presupuesto: { usado: 0 }, ...extra }) as unknown as Iteracion;

describe('pasoFoco', () => {
  it('pone en grande el paso en curso; si no hay, donde se quedó; con todo hecho, el último', () => {
    expect(pasoFoco(iteracion([paso('a', 'hecho'), paso('b', 'en_curso'), paso('c', 'pendiente')]))?.id).toBe('b');
    expect(pasoFoco(iteracion([paso('a', 'hecho'), paso('b', 'pendiente'), paso('c', 'pendiente')]))?.id).toBe('b');
    expect(pasoFoco(iteracion([paso('a', 'hecho'), paso('b', 'hecho')]))?.id).toBe('b');
    expect(pasoFoco(iteracion([]))).toBeNull();
  });
});

describe('avanceDe', () => {
  it('cuenta lo que dice la transcripción del juez, con su ritmo y lo que falta', () => {
    const tr = [
      { t: 60_000, tipo: 'resultado', texto: 'Juez: 100 de 243' },
      { t: 80_000, tipo: 'resultado', texto: 'Juez: 110 de 243' },
    ];
    const it = iteracion([paso('a', 'en_curso', 'verificacion')], [pista({ estado: 'en_curso', tipo: 'verificacion', transcripcion: tr } as Partial<Pista>)]);
    const a = avanceDe(it, it.plan[0]!)!;
    expect(a.hechos).toBe(110);
    expect(a.total).toBe(243);
    expect(a.juzgadas).toBe(true);
    expect(a.ritmo).toMatch(/^10 cada/);
    expect(a.faltan).toMatch(/^faltan 133, alrededor de/);
  });

  it('sin transcripción que cuente, cuenta las pistas del paso', () => {
    const it = iteracion([paso('a', 'en_curso')], [pista({ id: '1', estado: 'hecha' }), pista({ id: '2', estado: 'en_curso' })]);
    const a = avanceDe(it, it.plan[0]!)!;
    expect([a.hechos, a.total, a.faltan]).toEqual([1, 2, 'faltan 1']);
  });

  it('no convierte el cribado en pasos ni mantiene una estimación de llegada al pausar', () => {
    const p = paso('a', 'en_curso', 'verificacion');
    const its = iteracion([p], [pista({ estado: 'en_curso', tipo: 'verificacion', transcripcion: [
      { t: 1000, tipo: 'resultado', texto: 'Juez: 10 de 100' },
      { t: 2000, tipo: 'resultado', texto: 'Juez: 20 de 100' },
    ] })]);
    expect(avanceDe(its, p, false)).toMatchObject({ hechos: 20, ritmo: null, faltan: 'faltan 80' });
    its.pistas[0]!.transcripcion = [{ t: 1000, tipo: 'resultado', texto: 'Cribado: 13 de 30 relevantes' }];
    expect(avanceDe(its, p)?.unidad).toBe('pistas terminadas');
  });

  it('un reintento reciente desplaza la pista fallida anterior', () => {
    const p = paso('a', 'hecho');
    const its = iteracion([p], [pista({ id: 'vieja', estado: 'fallida' }), pista({ id: 'nueva', estado: 'hecha' })]);
    expect(pistaFoco(its, p)?.id).toBe('nueva');
  });
});

describe('relojes', () => {
  it('el reloj grande y las marcas del latido', () => {
    expect(relojDe(9068)).toBe('2:31:08');
    expect(relojDe(-3)).toBe('0:00:00');
    const l = latidoDe(pista({ transcripcion: [{ t: 1000, texto: 'uno' }, { t: 415_000, texto: 'dos' }] } as Partial<Pista>));
    expect(l).toEqual([{ marca: '6:55', texto: 'dos' }, { marca: '0:01', texto: 'uno' }]);
  });

  it('cuánto hace que empezó, en la unidad que se lee mejor', () => {
    expect(haceCuanto(0, 2 * 86_400_000 + 5)).toEqual({ cifra: '2', unidad: 'días' });
    expect(haceCuanto(0, 3 * 3_600_000)).toEqual({ cifra: '3', unidad: 'h' });
    expect(haceCuanto(0, 10_000)).toEqual({ cifra: '1', unidad: 'min' });
  });
});

describe('búsquedas', () => {
  it('reconoce la base y ordena de la que más sirvió a la que menos', () => {
    expect(baseDe('Exa (literatura gris)').base).toBe('gris');
    expect(baseDe('PubMed').base).toBe('pubmed');
    expect(baseDe('Europe PMC').base).toBe('epmc');
    expect(baseDe('ClinicalTrials.gov (v2)')).toEqual({ base: 'otra', nombre: 'ClinicalTrials.gov' });
    const it = iteracion([], [
      pista({ id: 'x', titulo: 'Amplitud: TDP-43', fuente: 'Exa', resumen: '20 resultados, 2 relevantes, 1 con texto completo' }),
      pista({ id: 'y', titulo: 'APOE', fuente: 'PubMed', resumen: '1.200 resultados, 9 relevantes, 4 con texto completo' }),
      pista({ id: 'z', titulo: 'sin cifras', resumen: 'nada' }),
    ]);
    const b = busquedasDe(it);
    expect(b.map((x) => [x.id, x.titulo, x.salen])).toEqual([['y', 'APOE', 1200], ['x', 'TDP-43', 20]]);
  });

  it('lee consultas canónicas antes del cierre, separa iteraciones y no inventa ceros', () => {
    const its = iteracion([], [pista({ id: 'pi', estado: 'detenida', fuente: 'PubMed', transcripcion: [{ t: 5, tipo: 'accion', texto: 'Consulta: MAPT' }], resumen: 'Presupuesto agotado' })], { id: 'it', numero: 3, empezadaEn: 100, terminadaEn: 200 });
    const qs: ConsultaBusqueda[] = [
      { base: 'PubMed', consulta: 'MAPT', fecha: 105, resultados: 87, relevantes: 12, iteracion: 3, tema: 'Tau' },
      { base: 'PubMed', consulta: 'vieja', fecha: 90, resultados: 900, iteracion: 2 },
      { base: 'ClinicalTrials.gov v2', consulta: 'TREM2', fecha: 120, resultados: 2 },
      { base: 'PubMed', consulta: 'fuera', fecha: 210, resultados: 600 },
    ];
    const bs = busquedasDe(its, qs);
    expect(bs).toHaveLength(2);
    expect(bs[0]).toMatchObject({ titulo: 'Tau', salen: 87, sirven: 12, enteros: null, estado: 'detenida' });
    expect(bs[1]).toMatchObject({ salen: 2, sirven: null, enteros: null });
    qs[0]!.pistaId = 'pi'; qs[0]!.textoCompleto = 4;
    expect(busquedasDe(its, qs)[0]?.enteros).toBe(4);
  });

  it('una fuente sin respuesta sigue visible como desconocida', () => {
    const its = iteracion([], [pista({ tipo: 'literatura', estado: 'fallida', fuente: 'PubMed', transcripcion: [{ t: 1, tipo: 'accion', texto: 'Consulta: MAPT' }] })]);
    expect(busquedasDe(its)[0]).toMatchObject({ estado: 'fallida', salen: null, sirven: null, enteros: null });
  });

  it('distingue reintentos de la misma consulta sin duplicar las filas ni recuperar cifras del intento fallido', () => {
    const transcripcion = [{ t: 1, tipo: 'accion' as const, texto: 'Consulta: MAPT' }];
    const its = iteracion([], [pista({ id: 'fallida', tipo: 'literatura', estado: 'detenida', fuente: 'PubMed', transcripcion }), pista({ id: 'retomada', tipo: 'literatura', fuente: 'PubMed', transcripcion, resumen: '10 resultados, 4 relevantes, 2 con texto completo' })]);
    const qs = [{ base: 'PubMed', consulta: 'MAPT', iteracion: 1, fecha: 100, resultados: 10 }, { base: 'PubMed', consulta: 'MAPT', iteracion: 1, fecha: 200, resultados: 10, relevantes: 4 }];
    const bs = busquedasDe(its, qs);
    expect(bs).toHaveLength(2);
    expect(bs[0]).toMatchObject({ estado: 'hecha', sirven: 4, enteros: 2 });
    expect(bs[1]).toMatchObject({ estado: 'detenida', sirven: null, enteros: null });
  });
});

describe('la corrida en el tiempo', () => {
  it('cada iteración con su coste; la abierta se lleva lo que falta hasta el total', () => {
    const its = [iteracion([], [], { numero: 2, terminadaEn: null, presupuesto: { usado: 50 } } as Partial<Iteracion>), iteracion([], [], { numero: 1, terminadaEn: 5, presupuesto: { usado: 300 } } as Partial<Iteracion>)];
    const c = { estado: 'pausada_por_presupuesto', gasto: { usd: 6.5, usdReal: 1, llamadas: 352 }, progreso: [{ iteracion: 1, hechosNuevos: 12, usdAcumulado: 4, llamadasAcumuladas: 302 }] } as unknown as Corrida;
    expect(tramosDe(its, c)).toEqual([
      { numero: 1, llamadas: 302, hechos: 12, usd: 4, abierta: false, estado: 'cerrada' },
      { numero: 2, llamadas: 50, hechos: null, usd: 2.5, abierta: true, estado: 'pausada_por_presupuesto' },
    ]);
  });

  it('los límites que la paran sola, acotados entre 0 y 1', () => {
    const c = { parada: { horas: 4, iteraciones: 7 }, presupuesto: { limiteLlamadas: 1000 }, gasto: { llamadas: 1500 } } as unknown as Corrida;
    const l = limitesDe(c, 2 * 3600 + 15 * 60, 3);
    expect(l.map((x) => x.valor)).toEqual(['2 h 15 min de 4 h', '3 de 7', '1.500 de 1.000']);
    expect(l.map((x) => x.fraccion)).toEqual([2.25 / 4, 3 / 7, 1]);
  });

  it('respeta los límites heredados, los propios por eje y el presupuesto de la misión', () => {
    const inv = { condicionParada: '1 hora o 2 iteraciones o 100 llamadas', mision: { presupuesto: { horas: 3, usd: 0 } } } as Investigacion;
    const c = { parada: { horas: 4, iteraciones: 7, llamadas: null, texto: '30 minutos' }, presupuesto: { limiteLlamadas: 1000 }, gasto: { llamadas: 20 } } as Corrida;
    expect(topesDe(c, inv)).toEqual({ horas: 0.5, iteraciones: 7, llamadas: 100 });
    c.parada = null;
    expect(topesDe(c, inv)).toEqual({ horas: 1, iteraciones: 2, llamadas: 100 });
    expect(limitesDe(c, 60, 0, inv).find((x) => x.nombre === 'Iteraciones cerradas')?.valor).toBe('0 de 2');
  });

  it('no adjudica el coste de varias iteraciones a una sola si falta el acumulado anterior', () => {
    const c = { estado: 'terminada', gasto: { usd: 6, llamadas: 350 }, progreso: [] } as unknown as Corrida;
    const its = [iteracion([], [], { numero: 1, terminadaEn: 5 }), iteracion([], [], { numero: 2, terminadaEn: 10 })];
    expect(tramosDe(its, c).map((t) => t.usd)).toEqual([null, null]);
  });
});

describe('modelos en escena', () => {
  it('el foco histórico no enciende modelos en una corrida pausada y reconoce fuentes con varios modelos', () => {
    const salud = { saludModelos: { cerebro: { modelo: 'GPT-6 Astra' }, juez: { modelo: 'Claude Opus 5' } } } as Parameters<typeof elencoDe>[0];
    const pi = pista({ fuente: 'GPT-6 Astra + Opus 5', estado: 'en_curso' });
    const its = iteracion([], [pi]);
    expect(elencoDe(salud, its, pi, false, (n) => n).some((a) => a.activo)).toBe(false);
    expect(elencoDe(salud, its, pi, true, (n) => n).filter((a) => a.activo).map((a) => a.rol)).toEqual(['juez', 'cerebro']);
    pi.estado = 'hecha';
    expect(elencoDe(salud, its, pi, true, (n) => n).some((a) => a.activo)).toBe(false);
  });
});

describe('temaParaProfundizar', () => {
  it('prefiere la búsqueda de amplitud que más sirvió y la pone en minúscula', () => {
    const c = { busqueda: { consultas: [
      { tema: '¿Qué papel tiene la copatología en la progresión?', modo: 'foco', relevantes: 20, iteracion: 3 },
      { tema: 'Copatología TDP-43', modo: 'amplitud', relevantes: 5, iteracion: 3 },
      { tema: 'Otra', modo: 'amplitud', relevantes: 9, iteracion: 2 },
    ] } } as unknown as Corrida;
    expect(temaParaProfundizar(c, 3)).toBe('copatología TDP-43');
    expect(temaParaProfundizar({ busqueda: { consultas: [] } } as unknown as Corrida, 3)).toBeNull();
  });
});
