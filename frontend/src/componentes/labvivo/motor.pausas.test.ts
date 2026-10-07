// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import { montarLaboratorio, type Laboratorio } from './motor';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number, fecha: number;
function datos(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'it-pausa', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso-pausa', tipo: 'verificacion', titulo: 'Verificar afirmaciones', detalle: 'Con su fuente original', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i), activos: [], actividad: [], pelicula: { eventos: [], ideas: [] } };
}
function montar(d: DatosLab) {
  motor = montarLaboratorio(nodo, d, { conceder: async () => true, denegar: async () => true, aprobarPlan: async () => true,
    ampliarPresupuesto: async () => true, resolverIncidencia: async () => true, verEnLaCorrida: () => undefined, verNovedad: () => undefined });
}
function turno(id: string, agente = 'Analogía', destinatario = 'Contradicción', cambios: Partial<TurnoLaboratorio> = {}): TurnoLaboratorio {
  return { id, temaId: `tema-${id}`, iteracionId: 'it-pausa', idioma: 'es', agente, destinatario,
    texto: 'Vale, voy a mirar esa comparación.', fecha, modelo: 'prueba', materiales: [], tipoConversacion: 'companeros', ...cambios };
}
function tanda() { return [turno('ya-dicho', 'Juez', 'Señalizador de sesgo'), turno('idea-pendiente'), turno('novedad-pendiente', 'Especialista en patentes', 'Especialista en compañías')]; }
const voces = () => [...nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')];
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    tiempo += 50; fecha += 50; frame(tiempo);
    for (let k = 0; k < 8; k++) await Promise.resolve();
    observar?.();
  }
}
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; fecha = 1_800_000_000_000; motor = null;
  nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(Date, 'now').mockImplementation(() => fecha);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(async () => { motor?.desmontar(); nodo.remove(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('las pausas temporales conservan solamente la voz pendiente vigente', () => {
  it.each(['conexion', 'interfaz'] as const)('recupera los pendientes tras una pausa de %s sin repetir lo ya emitido ni sustituir cuerpos', async causa => {
    const d = datos(); montar(d); const turnos = tanda(), cuerpos = [...nodo.querySelectorAll('.lv-ag')];
    motor!.conversar(turnos, true, true); await avanzar(1);
    expect(voces().map(v => v.dataset.turno)).toEqual(['ya-dicho']);
    if (causa === 'conexion') motor!.actualizar({ ...d, conexion: 'sin_conexion', trabajando: false, activos: [] });
    motor!.conversar([], false, true); await avanzar(100);
    expect(voces()).toHaveLength(0);
    motor!.actualizar(d); motor!.conversar(turnos, true, true);
    const dichas = new Set<string>(); await avanzar(140, () => voces().forEach(v => dichas.add(v.dataset.turno!)));
    expect([...dichas]).toEqual(['idea-pendiente', 'novedad-pendiente']);
    expect([...nodo.querySelectorAll('.lv-ag')]).toEqual(cuerpos);
    motor!.conversar(turnos, true, true);
    await avanzar(300, () => voces().forEach(v => dichas.add(v.dataset.turno!)));
    expect([...dichas]).toEqual(['idea-pendiente', 'novedad-pendiente']);
  });

  it('un turno recibido mientras la interfaz pausa no se marca como dicho antes de poder escucharlo', async () => {
    const d = datos(); montar(d); const nuevo = turno('llego-durante-pausa');
    motor!.conversar([], false, true); motor!.conversar([nuevo], false, true);
    await avanzar(80); expect(voces()).toHaveLength(0);
    motor!.conversar([nuevo], true, true); await avanzar(1);
    expect(voces().map(v => v.dataset.turno)).toEqual([nuevo.id]);
  });

  it('el apagado manual descarta pendientes aunque la interfaz ya los hubiera pausado', async () => {
    const d = datos(); montar(d); const turnos = tanda();
    motor!.conversar(turnos, true, true); await avanzar(1);
    motor!.conversar([], false, true); motor!.conversar(turnos, false, false);
    motor!.conversar(turnos, true, true); await avanzar(140);
    expect(voces()).toHaveLength(0);
    const nuevo = turno('nuevo-tras-apagado'); motor!.conversar([nuevo], true, true); await avanzar(1);
    expect(voces().map(v => v.dataset.turno)).toEqual([nuevo.id]);
  });

  it('la conservación no resucita un comentario que haya caducado durante la pausa', async () => {
    const d = datos(); montar(d); const turnos = tanda();
    motor!.conversar(turnos, true, true); await avanzar(1); motor!.conversar([], false, true);
    fecha += 90_001;
    motor!.conversar(turnos, true, true); await avanzar(140);
    expect(voces()).toHaveLength(0);
    const fresco = turno('voz-reciente'); motor!.conversar([fresco], true, true); await avanzar(1);
    expect(voces().map(v => v.dataset.turno)).toEqual([fresco.id]);
  });

  it('al reanudar no reproduce una intención cuyo trabajo ya terminó', async () => {
    const d = datos(); d.activos = ['Juez'];
    d.actividad = [{ id: 'pista-juez:0:0', agente: 'Juez', sala: 'r2', texto: 'Verificar afirmaciones', tipo: 'accion', pistaId: 'pista-juez',
      pasoId: 'paso-pausa', fuente: '', titulo: 'Verificar afirmaciones', enCurso: true, t: 0, abierta: true, estadoAgente: 'en_curso' }];
    montar(d);
    const apertura = turno('ya-dicho', 'Juez', 'Señalizador de sesgo', { temaId: 'tema-juez' });
    const intencion = turno('intencion-pendiente', 'Juez', 'Señalizador de sesgo', { temaId: 'tema-juez', momento: 'inicio_tarea', tipoConversacion: 'actividad',
      materiales: [{ id: 'inicio-juez', clase: 'tarea', texto: 'Verificar afirmaciones', agente: 'Juez', pistaId: 'pista-juez', pasoId: 'paso-pausa', entradaId: 'pista-juez:0:0' }] });
    motor!.conversar([apertura, intencion], true, true); await avanzar(1); motor!.conversar([], false, true);
    motor!.actualizar({ ...d, activos: [], actividad: d.actividad.map(a => ({ ...a, enCurso: false, abierta: false, estadoAgente: 'terminado' })),
      pasos: { ...d.pasos, lista: d.pasos.lista.map(p => ({ ...p, estado: 'hecho' })) } });
    motor!.conversar([apertura, intencion], true, true); await avanzar(140);
    expect(voces()).toHaveLength(0);
  });

  it('cambiar de iteración elimina la espera anterior en lugar de reutilizarla', async () => {
    const d = datos(); montar(d); const turnos = tanda(); motor!.conversar(turnos, true, true); await avanzar(1);
    motor!.conversar([], false, true);
    motor!.actualizar({ ...d, identidad: `${d.identidad.split('/')[0]}/it-nueva`, iteracion: 2 });
    motor!.conversar(turnos, true, true); await avanzar(140); expect(voces()).toHaveLength(0);
    const nuevo = turno('voz-nueva-iteracion', 'Analogía', 'Contradicción', { iteracionId: 'it-nueva' });
    motor!.conversar([nuevo], true, true); await avanzar(1);
    expect(voces().map(v => v.dataset.turno)).toEqual([nuevo.id]);
  });
});
