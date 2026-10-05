import { describe, expect, it } from 'vitest';
import type { Corrida, Iteracion, PasoPlan, Pista } from '../datos/tipos';
import { avanceDe, baseDe, busquedasDe, haceCuanto, latidoDe, limitesDe, pasoFoco, relojDe, temaParaProfundizar, tramosDe } from './escenario';

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
});

describe('la corrida en el tiempo', () => {
  it('cada iteración con su coste; la abierta se lleva lo que falta hasta el total', () => {
    const its = [iteracion([], [], { numero: 2, terminadaEn: null, presupuesto: { usado: 50 } } as Partial<Iteracion>), iteracion([], [], { numero: 1, terminadaEn: 5, presupuesto: { usado: 300 } } as Partial<Iteracion>)];
    const c = { progreso: [{ iteracion: 1, hechosNuevos: 12, usdAcumulado: 4 }] } as unknown as Corrida;
    expect(tramosDe(its, c, 6.5)).toEqual([
      { numero: 1, llamadas: 300, hechos: 12, usd: 4, abierta: false },
      { numero: 2, llamadas: 50, hechos: null, usd: 2.5, abierta: true },
    ]);
  });

  it('los límites que la paran sola, acotados entre 0 y 1', () => {
    const c = { parada: { horas: 4, iteraciones: 7 }, presupuesto: { limiteLlamadas: 1000 }, gasto: { llamadas: 1500 } } as unknown as Corrida;
    const l = limitesDe(c, 2 * 3600 + 15 * 60, 3);
    expect(l.map((x) => x.valor)).toEqual(['2 h 15 de 4 h', '3 de 7', '1.500 de 1.000']);
    expect(l.map((x) => x.fraccion)).toEqual([2.25 / 4, 3 / 7, 1]);
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
