import { describe, expect, it } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa } from '../datos/tipos';
import { VENTANA_SIN_VISITA_MS, digest, digestComoTexto, duracionEnLlano, loQueEspera } from './digest';
import { fijarIdioma } from './idioma';

describe('digest', () => {
  it('traduce duraciones completas sin mezclar horas y minutos de ambos idiomas', () => {
    fijarIdioma('en');
    try {
      expect(duracionEnLlano(12 * 60_000)).toBe('12 minutes');
      expect(duracionEnLlano(125 * 60_000)).toBe('2 hours and 5 minutes');
      expect(duracionEnLlano(61 * 60_000)).toBe('1 hour and 1 minute');
    } finally { fijarIdioma('es'); }
    expect(duracionEnLlano(125 * 60_000)).toBe('2 horas y 5 minutos');
  });
  it('solo cuenta lo posterior a la última visita y deja fuera los hechos nuevos', () => {
    const e = estadoDeMuestra();
    const d = digest(e, 'inv-1', AHORA_MUESTRA);
    // La visita fue hace 10 h: el evento de hace 14 h queda fuera.
    expect(d.eventos.some((x) => x.id === 'ev-1')).toBe(false);
    expect(d.eventos.some((x) => x.id === 'ev-2')).toBe(true);
    expect(d.eventos.every((x) => x.tipo !== 'hecho_nuevo')).toBe(true);
    expect(d.iteraciones).toBe(2);
    expect(d.hipotesisNuevas).toBe(2);
    expect(d.incidencias).toBe(2);
    expect(d.hayNovedades).toBe(true);
  });
  it('sin última visita, la ventana son siete días', () => {
    const e = { ...estadoDeMuestra(), ultimaVisita: null };
    const d = digest(e, 'inv-1', AHORA_MUESTRA);
    expect(d.desde).toBeNull();
    expect(d.ventanaDesde).toBe(AHORA_MUESTRA - VENTANA_SIN_VISITA_MS);
    expect(d.eventos.some((x) => x.id === 'ev-1')).toBe(true);
  });
  it('lo que espera incluye permisos, incidencias e hipótesis pendientes, con la edad de la más antigua', () => {
    const e = estadoDeMuestra();
    const w = loQueEspera(e, 'inv-1', AHORA_MUESTRA);
    // 3 solicitudes + 2 incidencias + 3 hipótesis pendientes (propuesta, en revisión, refinar)
    expect(w.total).toBe(8);
    expect(w.masAntiguaMs).toBe(9 * 3_600_000);
  });
  it('las líneas se leen y el texto plano lleva cabecera', () => {
    const e = estadoDeMuestra();
    const d = digest(e, 'inv-1', AHORA_MUESTRA);
    expect(d.lineas.some((l) => l.includes('la más antigua lleva 9 h'))).toBe(true);
    expect(d.lineas.some((l) => /^Gasto de la corrida \d+: 2318 llamadas/.test(l))).toBe(true);
    const texto = digestComoTexto(d, 'Prueba');
    expect(texto.startsWith('ROSA2018 · Prueba\n- ')).toBe(true);
  });
  it('traduce el gasto y conserva llamadas, porcentaje y dólares al volver a español', () => {
    const e = estadoDeMuestra();
    const corrida = e.corridas.find((c) => c.investigacionId === 'inv-1')!;
    corrida.gasto.usd = 12.34;
    const original = JSON.stringify(e);
    const pct = Math.round(corrida.gasto.llamadas / corrida.presupuesto.limiteLlamadas * 100);
    fijarIdioma('en');
    try {
      expect(digest(e, 'inv-1', AHORA_MUESTRA).lineas).toContain(`Run ${corrida.numero} spending: ${corrida.gasto.llamadas} model calls (${pct} % of the limit), 12.34 USD`);
      expect(JSON.stringify(e)).toBe(original);
    } finally {
      fijarIdioma('es');
    }
    expect(digest(e, 'inv-1', AHORA_MUESTRA).lineas).toContain(`Gasto de la corrida ${corrida.numero}: ${corrida.gasto.llamadas} llamadas (${pct} % del tope), 12.34 USD`);
  });
  it('«Visto» cierra la tarjeta aunque queden decisiones pendientes', () => {
    const e = { ...estadoDeMuestra(), ultimaVisita: AHORA_MUESTRA };
    const d = digest(e, 'inv-1', AHORA_MUESTRA);
    expect(d.esperan.total).toBeGreaterThan(0);
    expect(d.hayNovedades).toBe(false);
    expect(d.eventos).toHaveLength(0);
    expect(digestComoTexto(d, 'X')).toBe('ROSA2018 · X\n- Sin novedades');
  });
  it('cuenta lo que importa: certeza que sube, corrida cerrada, evidencia enlazada y vivero', () => {
    const base = estadoDeMuestra();
    const h0 = base.hipotesis.find((h) => h.investigacionId === 'inv-1')!;
    const t = AHORA_MUESTRA - 3_600_000;
    const e: EstadoRosa = {
      ...base,
      ultimaVisita: AHORA_MUESTRA - 2 * 3_600_000,
      hipotesis: [
        { ...h0, id: 'h-sube', titulo: 'GFAP antes que NfL en portadores de APOE ε4', conclusion: { ...(h0.conclusion ?? ({} as never)), certeza: 'baja', direccion: 'apoya', fecha: t, cambio: { de: { certeza: 'muy_baja', direccion: 'apoya', iteracion: 1 }, motivo: 'segunda cohorte' } } },
      ],
      corridas: base.corridas.map((c) => (c.investigacionId === 'inv-1' ? { ...c, estado: 'terminada' as const, terminadaEn: t, motivoCierre: 'Se cumplió el tiempo fijado para esta corrida (1 hora)' } : c)),
      eventos: [
        { id: 'x1', investigacionId: 'inv-1', t, tipo: 'revision_automatica', texto: 'Evidencia nueva para «GFAP antes que NfL»: 2 afirmaciones, 1 en contra, 1 fuentes nuevas', ruta: null },
        { id: 'x2', investigacionId: 'inv-1', t, tipo: 'vivero', texto: 'Idea al vivero (todavía no nace como hipótesis): X. Le falta: una segunda cohorte', ruta: null },
        { id: 'x3', investigacionId: 'inv-1', t, tipo: 'hipotesis_nueva', texto: 'Nace del vivero con evidencia de 2 cohortes: Y', ruta: null },
        { id: 'x4', investigacionId: 'inv-1', t, tipo: 'hecho_nuevo', texto: 'Hecho nuevo: ruido', ruta: null },
      ],
    };
    const d = digest(e, 'inv-1', AHORA_MUESTRA);
    expect(d.lineas[0]).toMatch(/^La corrida \d+ terminó: Se cumplió el tiempo fijado/);
    expect(d.lineas.some((l) => l === '«GFAP antes que NfL en portadores de APOE ε4» subió de certeza muy baja a baja')).toBe(true);
    expect(d.lineas.some((l) => l === '1 hipótesis recibió evidencia nueva (1 afirmación en contra)')).toBe(true);
    expect(d.lineas.some((l) => l === '1 idea entró al vivero, 1 idea nació como hipótesis')).toBe(true);
    expect(d.eventos.some((x) => x.tipo === 'hecho_nuevo')).toBe(false);
  });
});
