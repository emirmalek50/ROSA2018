/**
 * Los reducers de la interfaz están portados uno a uno de `rosa/estado/acciones.py`
 * (misma regla en los dos lados, CLAUDE.md). Esto comprueba los tres sitios donde
 * el 29 de septiembre de 2026 los dos lados habían dejado de decir lo mismo:
 *
 * - `aprobarPlan` no aprobaba la misión ni la pregunta de la campaña, así que en
 *   la interfaz la misión se quedaba sin aprobar para siempre y la pantalla
 *   seguía pidiéndolo.
 * - `actualizarPoliticaEsperas` no ponía tope a las horas ni comprobaba la
 *   acción, así que aceptaba lo que el servidor luego rechazaba sin explicar.
 * - `volverAIteracion` hacía la primera mitad de `podar_desde` (quitar las
 *   cuestiones creadas después del punto) y no la segunda (deshacer los
 *   movimientos posteriores de ROSA2018), así que una cuestión resuelta con un
 *   hecho que la poda acababa de borrar se quedaba resuelta.
 */
import { describe, expect, it } from 'vitest';

import { actualizarPoliticaEsperas, aprobarPlan, volverAIteracion } from './acciones';
import { estadoDeMuestra } from './muestra';
import type { Cuestion, EstadoRosa, Iteracion } from './tipos';

const T = 1_800_000_000_000;

function conIteracionPorAprobar(e: EstadoRosa): { estado: EstadoRosa; it: Iteracion } {
  const it: Iteracion = { ...e.iteraciones[0]!, id: 'it-nueva', numero: 99, planAprobado: false, terminadaEn: null, empezadaEn: T };
  return { estado: { ...e, iteraciones: [...e.iteraciones, it] }, it };
}

describe('paridad con rosa/estado/acciones.py', () => {
  it('aprobar el primer plan aprueba la misión y la pregunta de la campaña', () => {
    const base = estadoDeMuestra();
    const corrida = base.corridas.find((c) => c.investigacionId === base.investigaciones[0]!.id)!;
    let e: EstadoRosa = {
      ...base,
      investigaciones: base.investigaciones.map((x, i) => (i === 0 ? { ...x, mision: { ...(x.mision ?? { texto: 'm', creadaEn: T, criterios: [] }), aprobadaEn: null, aprobadaPor: null } } : x)) as EstadoRosa['investigaciones'],
      corridas: base.corridas.map((c) => (c.id === corrida.id ? { ...c, pregunta: { texto: '¿GFAP antes que NfL?', aprobadaEn: null, formuladaEn: T } } : c)) as EstadoRosa['corridas'],
    };
    const conIt = conIteracionPorAprobar(e);
    e = { ...conIt.estado, iteraciones: conIt.estado.iteraciones.map((i) => (i.id === 'it-nueva' ? { ...i, corridaId: corrida.id } : i)) };

    const r = aprobarPlan(e, 'it-nueva', T + 5, 'Emir');
    const inv = r.investigaciones[0]!;
    expect(inv.mision?.aprobadaEn).toBe(T + 5);
    expect(inv.mision?.aprobadaPor).toBe('Emir');
    expect(r.corridas.find((c) => c.id === corrida.id)?.pregunta?.aprobadaEn).toBe(T + 5);
    // Y deja el evento de misión, como `con_evento` en el reducer de Python.
    expect(r.eventos.some((ev) => ev.tipo === 'mision' && ev.texto.includes('junto con el primer plan'))).toBe(true);
  });

  it('una misión ya aprobada no se vuelve a aprobar con el plan siguiente', () => {
    const base = estadoDeMuestra();
    const corrida = base.corridas[0]!;
    const conIt = conIteracionPorAprobar(base);
    const e = { ...conIt.estado, iteraciones: conIt.estado.iteraciones.map((i) => (i.id === 'it-nueva' ? { ...i, corridaId: corrida.id } : i)) };
    const antes = e.investigaciones.find((x) => x.id === corrida.investigacionId)!.mision?.aprobadaEn ?? null;
    const r = aprobarPlan(e, 'it-nueva', T + 5);
    if (antes !== null) expect(r.investigaciones.find((x) => x.id === corrida.investigacionId)!.mision?.aprobadaEn).toBe(antes);
  });

  it('la política de esperas tiene los mismos límites que el servidor', () => {
    const e = estadoDeMuestra();
    const buena = { horas: 12, accion: 'recordar' as const, escalarA: ' emir@ai-robotix.com ' };
    expect(actualizarPoliticaEsperas(e, buena).politicaEsperas.escalarA).toBe('emir@ai-robotix.com');
    // Un año es el tope (24 * 365 horas).
    expect(actualizarPoliticaEsperas(e, { ...buena, horas: 24 * 365 + 1 })).toBe(e);
    expect(actualizarPoliticaEsperas(e, { ...buena, horas: 0 })).toBe(e);
    expect(actualizarPoliticaEsperas(e, { ...buena, horas: Number.POSITIVE_INFINITY })).toBe(e);
    // Una acción que el bucle no sabe hacer.
    expect(actualizarPoliticaEsperas(e, { ...buena, accion: 'apagar' as never })).toBe(e);
  });

  it('volver al modelo de mundo reabre la cuestión que ROSA2018 resolvió después del punto', () => {
    const e0 = estadoDeMuestra();
    const origen = e0.iteraciones.find((i) => i.id === 'it-13')!;
    const limite = origen.terminadaEn!;
    const inv = e0.corridas.find((c) => c.id === origen.corridaId)!.investigacionId;
    const cuestion: Cuestion = {
      id: 'cu-prueba',
      investigacionId: inv,
      texto: '¿GFAP precede a NfL?',
      estado: 'resuelta',
      origen: { tipo: 'pregunta_modelo', id: null },
      queLaResolveria: 'una cohorte más',
      hipotesisIds: [],
      hechoIds: ['he-tarde'],
      prioridad: 1,
      creadaEn: limite - 100_000,
      actualizadaEn: limite + 60_000,
      resueltaEn: limite + 60_000,
      resolucion: { por: 'he-tarde', motivo: 'La resuelve el hecho he-tarde' },
      veces: 1,
      historial: [
        { fecha: limite - 100_000, de: null, a: 'abierta', quien: 'Rosa', motivo: 'Abierta' },
        { fecha: limite + 60_000, de: 'abierta', a: 'resuelta', quien: 'Rosa', motivo: 'La resuelve el hecho he-tarde', por: 'he-tarde' },
      ],
    };
    const e1 = volverAIteracion({ ...e0, cuestiones: [cuestion] }, 'it-13', 'mundo', T);
    const c = e1.cuestiones!.find((x) => x.id === 'cu-prueba')!;
    // El hecho que la resolvía se podó: la cuestión vuelve a estar abierta.
    expect(c.estado).toBe('abierta');
    expect(c.resueltaEn).toBeNull();
    expect(c.resolucion).toBeNull();
    expect(c.historial).toHaveLength(1);
  });

  it('una cuestión que tocó una persona después del punto no se deshace', () => {
    const e0 = estadoDeMuestra();
    const origen = e0.iteraciones.find((i) => i.id === 'it-13')!;
    const limite = origen.terminadaEn!;
    const inv = e0.corridas.find((c) => c.id === origen.corridaId)!.investigacionId;
    const cuestion: Cuestion = {
      id: 'cu-humana',
      investigacionId: inv,
      texto: '¿Sirve el biomarcador?',
      estado: 'descartada',
      origen: { tipo: 'persona', id: null },
      queLaResolveria: '',
      hipotesisIds: [],
      hechoIds: [],
      prioridad: 1,
      creadaEn: limite - 100_000,
      actualizadaEn: limite + 60_000,
      resueltaEn: null,
      resolucion: null,
      veces: 1,
      historial: [
        { fecha: limite - 100_000, de: null, a: 'abierta', quien: 'Rosa', motivo: 'Abierta' },
        { fecha: limite + 60_000, de: 'abierta', a: 'descartada', quien: 'Emir', motivo: 'No aplica a esta cohorte' },
      ],
    };
    const e1 = volverAIteracion({ ...e0, cuestiones: [cuestion] }, 'it-13', 'mundo', T);
    const c = e1.cuestiones!.find((x) => x.id === 'cu-humana')!;
    expect(c.estado).toBe('descartada');
    expect(c.historial).toHaveLength(2);
  });
});
