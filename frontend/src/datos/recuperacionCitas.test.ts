// La regla de `pedirRecuperacionCitas`, gemela de `pedir_recuperacion_citas` en
// rosa/estado/acciones.py (28 de septiembre de 2026): no abre una segunda
// mientras hay una pendiente, guarda la anterior, y no acepta una corrida de
// otra investigación. rosa/tests/test_recuperacion_citas.py prueba lo mismo del
// lado del servidor.
import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from './muestra';
import { pedirRecuperacionCitas, RECUPERACION_PENDIENTE } from './acciones';

describe('pedir la recuperación de citas', () => {
  const base = estadoDeMuestra();
  const inv = base.investigaciones[0]!;
  const corrida = base.corridas.find((c) => c.investigacionId === inv.id)!;

  it('abre un registro pedido con el alcance, quién y cuándo, y deja un evento', () => {
    const e = pedirRecuperacionCitas(base, inv.id, null, 'emir@alzheimerproject.com', 5000);
    const reg = e.investigaciones.find((i) => i.id === inv.id)!.recuperacionCitas!;
    expect(reg).toMatchObject({ estado: 'pedida', pedidaEn: 5000, quien: 'emir@alzheimerproject.com', corridaId: null, revisadas: 0, total: 0, fase: null });
    expect(e.eventos.at(-1)!.texto).toContain('Recuperación de citas pedida');
    expect(e.eventos.at(-1)!.texto).toContain('de todas las corridas de la investigación');
  });

  it('no abre otra mientras haya una pendiente, y guarda la anterior al abrir la siguiente', () => {
    const e1 = pedirRecuperacionCitas(base, inv.id, null, 'a', 1);
    expect(pedirRecuperacionCitas(e1, inv.id, corrida.id, 'b', 2)).toBe(e1);
    for (const estado of RECUPERACION_PENDIENTE) {
      const pendiente = { ...e1, investigaciones: e1.investigaciones.map((i) => (i.id === inv.id ? { ...i, recuperacionCitas: { ...i.recuperacionCitas!, estado } } : i)) };
      expect(pedirRecuperacionCitas(pendiente, inv.id, null, 'b', 2)).toBe(pendiente);
    }
    const terminada = { ...e1, investigaciones: e1.investigaciones.map((i) => (i.id === inv.id ? { ...i, recuperacionCitas: { ...i.recuperacionCitas!, estado: 'terminada' as const } } : i)) };
    const e2 = pedirRecuperacionCitas(terminada, inv.id, corrida.id, '', 3);
    const inv2 = e2.investigaciones.find((i) => i.id === inv.id)!;
    expect(inv2.recuperacionCitas).toMatchObject({ estado: 'pedida', corridaId: corrida.id, quien: 'persona' });
    expect(inv2.recuperacionesAnteriores![0]!.estado).toBe('terminada');
  });

  it('una investigación que no existe o una corrida de otra no cambian nada', () => {
    expect(pedirRecuperacionCitas(base, 'inv-que-no-existe', null, 'a', 1)).toBe(base);
    expect(pedirRecuperacionCitas(base, inv.id, 'cor-de-otra', 'a', 1)).toBe(base);
  });
});
