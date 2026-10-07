import { describe, expect, it } from 'vitest';
import type { AfirmacionLab } from '../../lib/labVivo';
import { claveJuicioLab, seleccionarJuicioPendiente } from './puestaEnEscena';

function afirmacion(id: string, veredicto: AfirmacionLab['veredicto'] = 'sostenida'): AfirmacionLab {
  return { id, texto: `Observación ${id}`, veredicto,
    caja: ['sostenida', 'parcial', 'no_sostenida'].includes(veredicto) ? veredicto as AfirmacionLab['caja'] : 'otras',
    motivo: 'Decisión guardada', cita: 'Página 4', articulo: 'Artículo de prueba', biblioteca: null,
    procedenciaVeredicto: { origen: 'juez', modelo: 'Modelo de prueba', comprobaciones: [] } };
}

function recorrer(filas: readonly AfirmacionLab[]): AfirmacionLab[] {
  const vistas = new Set<string>(), salida: AfirmacionLab[] = [];
  let ultimo: AfirmacionLab['veredicto'] | null = null;
  for (let i = 0; i <= filas.length; i++) {
    const a = seleccionarJuicioPendiente(filas, vistas, ultimo);
    if (!a) return salida;
    salida.push(a); vistas.add(claveJuicioLab(a)); ultimo = a.veredicto;
  }
  throw new Error('La cola repite una decisión ya presentada');
}

describe('la cola visual del juez conserva sus decisiones reales', () => {
  it('muestra el rechazo después de la primera de 89 sostenidas y mantiene el orden interno', () => {
    const sostenidas = Array.from({ length: 89 }, (_, i) => afirmacion(`s-${i}`));
    const rechazo = afirmacion('rechazo', 'no_sostenida');
    const filas = Object.freeze([...sostenidas, rechazo]);
    const foto = structuredClone(filas), salida = recorrer(filas);
    expect(salida.slice(0, 3)).toEqual([sostenidas[0], rechazo, sostenidas[1]]);
    expect(salida.filter(a => a.veredicto === 'sostenida')).toEqual(sostenidas);
    expect(salida).toHaveLength(90);
    expect(new Set(salida.map(a => a.id)).size).toBe(90);
    expect(filas).toEqual(foto);
    expect(salida.every(a => filas.includes(a))).toBe(true);
  });

  it('un rechazo que llega durante la cola obtiene el siguiente turno sin reiniciar las sostenidas', () => {
    const s = Array.from({ length: 8 }, (_, i) => afirmacion(`s-${i}`));
    const vistas = new Set(s.slice(0, 3).map(claveJuicioLab));
    const rechazo = afirmacion('nuevo-rechazo', 'no_sostenida');
    const siguiente = seleccionarJuicioPendiente([...s, rechazo], vistas, 'sostenida');
    expect(siguiente).toBe(rechazo);
    vistas.add(claveJuicioLab(siguiente!));
    expect(seleccionarJuicioPendiente([...s, rechazo], vistas, 'no_sostenida')).toBe(s[3]);
    expect(vistas.size).toBe(4);
  });

  it('si todas son sostenidas no inventa otra categoría, no repite y termina', () => {
    const filas = Array.from({ length: 5 }, (_, i) => afirmacion(`s-${i}`));
    expect(recorrer(filas)).toEqual(filas);
    const vistas = new Set(filas.map(claveJuicioLab));
    expect(seleccionarJuicioPendiente(filas, vistas, 'sostenida')).toBeNull();
    expect(seleccionarJuicioPendiente(null, new Set(), null)).toBeNull();
    expect(seleccionarJuicioPendiente(undefined, new Set(), null)).toBeNull();
  });

  it('rota tres categorías reales conservando el orden incluso al agotarse una', () => {
    const s0 = afirmacion('s0'), s1 = afirmacion('s1'), s2 = afirmacion('s2');
    const p0 = afirmacion('p0', 'parcial'), p1 = afirmacion('p1', 'parcial');
    const n0 = afirmacion('n0', 'no_sostenida');
    expect(recorrer([s0, s1, s2, p0, p1, n0])).toEqual([s0, p0, n0, s1, p1, s2]);
  });

  it('excluye históricos sin autoría, reglas y pendientes, aunque añadan variedad aparente', () => {
    const negativas = ['antigua', 'regla', 'sin-autor'].map(id => afirmacion(id, 'no_sostenida'));
    negativas[0]!.procedenciaVeredicto = undefined;
    negativas[1]!.procedenciaVeredicto = { origen: 'regla', modelo: null, comprobaciones: ['Cita'] };
    negativas[2]!.procedenciaVeredicto = { origen: 'sin_verificar', modelo: null, comprobaciones: [] };
    const pendiente = afirmacion('pendiente', 'sin_verificar');
    const real = afirmacion('parcial-real', 'parcial');
    real.procedenciaVeredicto = { origen: 'mixta', modelo: 'Modelo de prueba', comprobaciones: ['Cobertura'] };
    expect(recorrer([...negativas, pendiente, real])).toEqual([real]);
    expect(seleccionarJuicioPendiente([...negativas, pendiente], new Set(), 'sostenida')).toBeNull();
  });

  it('una decisión que cambia de veredicto puede presentarse de nuevo con el mismo ID real', () => {
    const anterior = afirmacion('af-revisada'), otra = afirmacion('af-otra');
    const vistas = new Set([claveJuicioLab(anterior)]);
    const nueva = { ...anterior, veredicto: 'no_sostenida' as const, caja: 'no_sostenida' as const, motivo: 'La revisión encontró otra población' };
    expect(seleccionarJuicioPendiente([otra, nueva], vistas, 'sostenida')).toBe(nueva);
    vistas.add(claveJuicioLab(nueva));
    expect(seleccionarJuicioPendiente([otra, nueva], vistas, 'no_sostenida')).toBe(otra);
    expect(claveJuicioLab(nueva)).not.toBe(claveJuicioLab(anterior));
  });

  it('copias idénticas y motivos corregidos conservan la misma semántica de versión del motor', () => {
    const a = afirmacion('af-unica');
    expect(recorrer([a, structuredClone(a)])).toEqual([a]);
    const corregida = { ...a, motivo: 'Motivo corregido' };
    expect(seleccionarJuicioPendiente([corregida], new Set([claveJuicioLab(a)]), 'sostenida')).toBe(corregida);
  });

  it('si desaparece la última categoría continúa con las que siguen existiendo, sin mutar la memoria', () => {
    const a = afirmacion('af-siguiente'), vistas = new Set<string>();
    expect(seleccionarJuicioPendiente([a], vistas, 'no_sostenida')).toBe(a);
    expect(vistas.size).toBe(0);
    expect(seleccionarJuicioPendiente([a], vistas, 'no_sostenida')).toBe(a);
  });
});
