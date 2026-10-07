import { describe, expect, it } from 'vitest';
import { CadenciaDialogos, pausaDeRespuesta } from './cadenciaDialogos';

describe('cadencia de las conversaciones', () => {
  it('una tanda solo permite una entrada y conserva una separación entre 1,2 y 2,2 segundos', () => {
    const cadencia = new CadenciaDialogos();
    expect(cadencia.registrar('primero', 0)).toBe(true);
    expect(cadencia.registrar('segundo', 0)).toBe(false);
    expect(cadencia.puedeHablar(1.199)).toBe(false);
    expect(cadencia.puedeHablar(2.2)).toBe(true);
  });

  it('el ID da un ritmo estable y variable, sin desplazarlo por consultas repetidas', () => {
    const tiempos = Array.from({ length: 12 }, (_, i) => {
      const id = `turno-${i}`, a = new CadenciaDialogos(), b = new CadenciaDialogos();
      a.registrar(id, 0); b.registrar(id, 0);
      let primero = -1;
      for (let t = 1200; t <= 2200; t++) {
        expect(a.puedeHablar(t / 1000)).toBe(b.puedeHablar(t / 1000));
        if (primero === -1 && a.puedeHablar(t / 1000)) primero = t;
      }
      return primero;
    });
    expect(new Set(tiempos).size).toBeGreaterThan(6);
  });

  it('una entrada aún bloqueada no reserva tiempo ni retrasa la siguiente', () => {
    const a = new CadenciaDialogos(), b = new CadenciaDialogos();
    a.registrar('primero', 1); b.registrar('primero', 1);
    a.registrar('demasiado-pronto', 1.1);
    expect(a.registrar('segundo', 3.3)).toBe(b.registrar('segundo', 3.3));
    expect(a.puedeHablar(4.5)).toBe(b.puedeHablar(4.5));
  });

  it('una respuesta espera entre 0,4 y 0,9 segundos, con una pausa reproducible', () => {
    for (const id of ['primero', 'segundo', 'respuesta-final', 'charla:v3:5']) {
      const pausa = pausaDeRespuesta(id);
      expect(pausa).toBeGreaterThanOrEqual(0.4); expect(pausa).toBeLessThanOrEqual(0.9);
      expect(pausaDeRespuesta(id)).toBe(pausa);
    }
  });

  it('un cambio de sesión limpia la espera y los tiempos inválidos no abren un turno', () => {
    const cadencia = new CadenciaDialogos();
    expect(cadencia.registrar('primero', Number.NaN)).toBe(false);
    expect(cadencia.registrar('primero', 10)).toBe(true);
    expect(cadencia.puedeHablar(0)).toBe(false);
    cadencia.limpiar(); expect(cadencia.registrar('nueva-sesión', 0)).toBe(true);
  });
});
