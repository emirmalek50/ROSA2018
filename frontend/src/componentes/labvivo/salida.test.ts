import { describe, expect, it } from 'vitest';
import { ORDEN_SALIDA, elQueSeQuedo, planDeSalida, salaAOscuras, seQueda } from './salida';

const gente = [
  { nombre: 'Planificador', sala: 'plan' }, { nombre: 'Reformulador', sala: 'plan' },
  { nombre: 'Explorador', sala: 'r1' }, { nombre: 'Juez', sala: 'r2' }, { nombre: 'Señalizador de sesgo', sala: 'r2' },
  { nombre: 'Killer', sala: 'r4' }, { nombre: 'Revisor inicial', sala: 'r4' },
  { nombre: 'Tú', sala: 'rec' }, { nombre: 'Traductor', sala: 'rec' },
];

describe('la hora de salir', () => {
  it('recepción no cierra, y el Juez y el Killer se quedan hasta tarde', () => {
    expect(seQueda({ nombre: 'Traductor', sala: 'rec' })).toBe(true);
    expect(seQueda({ nombre: 'Tú', sala: 'rec' })).toBe(true);
    expect(seQueda({ nombre: 'Juez', sala: 'r2' })).toBe(true);
    expect(seQueda({ nombre: 'Killer', sala: 'r4' })).toBe(true);
    expect(seQueda({ nombre: 'Revisor inicial', sala: 'r4' })).toBe(false);
    expect(seQueda({ nombre: 'Explorador', sala: 'r1' })).toBe(false);
  });

  it('sale quien se va, nadie más, y nadie dos veces', () => {
    const plan = planDeSalida(gente);
    expect(plan.map((s) => s.nombre)).toEqual(['Planificador', 'Reformulador', 'Explorador', 'Señalizador de sesgo', 'Revisor inicial']);
    expect(new Set(plan.map((s) => s.nombre)).size).toBe(plan.length);
  });

  it('cada sala sale junta, y entre salas hay una pausa más larga', () => {
    const plan = planDeSalida(gente, { primera: 10, dentro: 2, entre: 6 });
    const t = Object.fromEntries(plan.map((s) => [s.nombre, s.t]));
    // Los dos de la sala del plan, seguidos.
    expect(t['Reformulador']! - t['Planificador']!).toBe(2);
    // Entre la última del plan y la siguiente sala, la pausa larga.
    expect(t['Explorador']! - t['Reformulador']!).toBe(8);
    expect(t['Planificador']).toBe(10);
    // Y van en el orden de las salas, nunca al revés.
    expect(plan.map((s) => s.t)).toEqual([...plan.map((s) => s.t)].sort((a, b) => a - b));
  });

  it('el orden de salida sigue el camino de la corrida y no se deja ninguna sala', () => {
    expect(ORDEN_SALIDA).toEqual(['plan', 'r1', 'bib', 'r2', 'r3', 'r4', 'r5', 'r7', 'r6']);
    expect(ORDEN_SALIDA).not.toContain('rec');
  });

  it('una sala se apaga solo cuando se queda sin nadie, y una sala sin gente no se apaga sola', () => {
    const estado = [
      { sala: 'plan', fuera: true }, { sala: 'plan', fuera: true },
      { sala: 'r4', fuera: true }, { sala: 'r4', fuera: false },
    ];
    expect(salaAOscuras('plan', estado)).toBe(true);
    expect(salaAOscuras('r4', estado)).toBe(false);
    expect(salaAOscuras('r9', estado)).toBe(false);
  });

  it('quien se queda solo en su sala lleva la lámpara; con la sala llena o vacía, nadie', () => {
    const r4 = [
      { nombre: 'Killer', sala: 'r4', fuera: false }, { nombre: 'Revisor inicial', sala: 'r4', fuera: true },
      { nombre: 'Concluidor', sala: 'r4', fuera: true },
    ];
    expect(elQueSeQuedo('r4', r4)).toBe('Killer');
    expect(elQueSeQuedo('r4', r4.map((p) => ({ ...p, fuera: false })))).toBeNull();
    expect(elQueSeQuedo('r4', r4.map((p) => ({ ...p, fuera: true })))).toBeNull();
  });

  it('con todo el elenco de verdad, recepción entera se queda y arriba quedan dos', () => {
    const todos = [...gente, { nombre: 'Asistente del chat', sala: 'rec' }, { nombre: 'Concluidor', sala: 'r4' }];
    const salen = new Set(planDeSalida(todos).map((s) => s.nombre));
    expect(todos.filter((p) => p.sala === 'rec').every((p) => !salen.has(p.nombre))).toBe(true);
    expect([...todos].filter((p) => p.sala !== 'rec' && !salen.has(p.nombre)).map((p) => p.nombre)).toEqual(['Juez', 'Killer']);
  });
});
