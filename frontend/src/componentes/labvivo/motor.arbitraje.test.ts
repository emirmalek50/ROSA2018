// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { montarLaboratorio, type Laboratorio } from './motor';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;
function datos(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'it-arbitraje', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso-arbitraje', tipo: 'extraccion', titulo: 'Leer las fuentes', detalle: 'Extraer los datos publicados', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i), activos: [], actividad: [], pelicula: { eventos: [], ideas: [] } };
}
function montar(d: DatosLab) {
  motor = montarLaboratorio(nodo, d, { conceder: async () => true, denegar: async () => true, aprobarPlan: async () => true,
    ampliarPresupuesto: async () => true, resolverIncidencia: async () => true, verEnLaCorrida: () => undefined, verNovedad: () => undefined });
}
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    tiempo += 100; frame(tiempo);
    for (let k = 0; k < 8; k++) await Promise.resolve();
    observar?.();
  }
}
function turno(id: string, agente: string, destinatario: string, cambios: Partial<TurnoLaboratorio> = {}): TurnoLaboratorio {
  return { id, temaId: `tema-${id}`, iteracionId: 'it-arbitraje', idioma: 'es', agente, destinatario,
    texto: 'Vale, voy a revisar ese límite.', fecha: Date.now(), modelo: 'prueba', materiales: [], tipoConversacion: 'companeros', ...cambios };
}
function conEventos(d: DatosLab, eventos: EventoVisualLab[]): DatosLab {
  return { ...d, pelicula: { eventos, ideas: [] } };
}
const extraccion = (id = 'extraccion-real'): EventoVisualLab => ({ id, sala: 'r1', agentes: ['Extractor de afirmaciones'], tipo: 'extraccion', texto: 'Fuente 8 de 14: 11 afirmaciones extraídas' });
const documentos = () => [...nodo.querySelectorAll<HTMLElement>('.lv-documento')];
function posicion(el: HTMLElement): [number, number] {
  const p = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(el.style.transform);
  return p ? [Number(p[1]), Number(p[2])] : [0, 0];
}
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; motor = null; nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(async () => { motor?.desmontar(); nodo.remove(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('las conversaciones y los acontecimientos reales se dejan avanzar', () => {
  it('el Extractor muestra su resultado mientras otros dos compañeros hablan en la misma sala', async () => {
    const d = datos(); montar(d); const e = extraccion();
    motor!.actualizar(conEventos(d, [e]));
    motor!.conversar([turno('turno-real', 'Puntuador amplitud', 'Generador de consultas', {
      texto: 'Buena idea. Antes de aislar NfL, yo revisaría si CXCL10 y GFAP también cambian distinto según cohorte.',
    })]);
    let primera: number | null = null, charla = false;
    await avanzar(80, () => {
      if (primera === null && documentos().some(el => el.dataset.evento === e.id)) primera = tiempo;
      charla ||= !!nodo.querySelector('.lv-bub[data-turno="turno-real"]');
    });
    expect(primera).not.toBeNull(); expect(primera!).toBeLessThan(8000); expect(charla).toBe(true);
  });

  it('tres conversaciones en salas distintas no consumen el límite de películas', async () => {
    const d = datos(); montar(d); const e = extraccion();
    motor!.conversar([
      turno('evidencia', 'Juez', 'Señalizador de sesgo'),
      turno('ideas', 'Analogía', 'Contradicción'),
      turno('patentes', 'Especialista en patentes', 'Especialista en compañías'),
    ]);
    await avanzar(1);
    expect(nodo.querySelectorAll('[data-escena="conversacion_espera"]')).toHaveLength(6);
    motor!.actualizar(conEventos(d, [e]));
    await avanzar(20);
    expect(documentos().some(el => el.dataset.evento === e.id)).toBe(true);
    expect(nodo.querySelectorAll('[data-escena="conversacion_espera"]')).toHaveLength(6);
  });

  it('la espera entre respuestas libera a los actores para una película pendiente', async () => {
    const d = datos(); montar(d);
    motor!.conversar([turno('primero', 'Extractor de afirmaciones', 'Puntuador preguntas', { texto: 'Vale.' })]);
    await avanzar(1);
    const e = extraccion(); motor!.actualizar(conEventos(d, [e]));
    let primera: number | null = null;
    await avanzar(110, () => { if (primera === null && documentos().some(el => el.dataset.evento === e.id)) primera = tiempo; });
    expect(primera).not.toBeNull(); expect(primera!).toBeLessThan(12000);
  });

  it('una ráfaga de respuestas permite presentar una fuente y conserva las voces en orden sin repetir la película', async () => {
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'fuente:it-arbitraje:PubMed', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: 'PubMed\nResultados: 24' };
    motor!.actualizar(conEventos({ ...d, fuentes: [{ nombre: 'PubMed', salen: 24, sirven: 4, fallo: false, consultas: 1 }] }, [e]));
    await avanzar(1);
    const textos = ['Voy a revisar esa comparación.', 'Vale, miro los controles.', 'Queda pendiente la otra cohorte.'];
    const turnos = textos.map((texto, i) => turno(`respuesta-${i}`, i === 1 ? 'Explorador' : 'Generador de consultas', i === 1 ? 'Generador de consultas' : 'Explorador', { temaId: 'tema-continuado', texto }));
    const nodos = [...nodo.querySelectorAll<HTMLElement>('.lv-ag')], objetos = new Set<HTMLElement>(), voces: string[] = [];
    let primera: number | null = null, saltos = 0;
    const generador = nodo.querySelector<HTMLElement>('[data-agente="Generador de consultas"]')!;
    let anterior = posicion(generador);
    await avanzar(800, () => {
      if (tiempo === 1000) motor!.conversar([turnos[0]!]);
      if (tiempo === 2000) motor!.conversar([turnos[1]!]);
      if (tiempo === 3000) motor!.conversar([turnos[2]!]);
      documentos().filter(el => el.dataset.evento === e.id).forEach(el => { objetos.add(el); primera ??= tiempo; });
      nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach(el => { if (!voces.includes(el.dataset.turno!)) voces.push(el.dataset.turno!); });
      const ahora = posicion(generador); saltos = Math.max(saltos, Math.hypot(ahora[0] - anterior[0], ahora[1] - anterior[1])); anterior = ahora;
    });
    expect(primera).not.toBeNull(); expect(primera!).toBeLessThan(15000);
    expect(objetos.size).toBe(1); expect(voces).toEqual(turnos.map(t => t.id));
    expect(saltos).toBeLessThan(15); expect([...nodo.querySelectorAll('.lv-ag')]).toEqual(nodos);
  });

  it('al ceder entre turnos, la respuesta del mismo tema sigue después del resultado real', async () => {
    const d = datos(); montar(d);
    const apertura = turno('apertura', 'Extractor de afirmaciones', 'Puntuador preguntas', { temaId: 'tema-datos', texto: 'Voy a contrastarlo.' });
    const respuesta = turno('respuesta', 'Puntuador preguntas', 'Extractor de afirmaciones', { temaId: 'tema-datos', texto: 'Vale, reviso la cohorte.' });
    motor!.conversar([apertura, respuesta]); await avanzar(1);
    const e = extraccion(); motor!.actualizar(conEventos(d, [e]));
    const orden: string[] = [];
    await avanzar(350, () => {
      const cosas = [...nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')].map(el => el.dataset.turno!);
      if (documentos().some(el => el.dataset.evento === e.id)) cosas.push(e.id);
      cosas.forEach(id => { if (!orden.includes(id)) orden.push(id); });
    });
    expect(orden).toEqual([apertura.id, e.id, respuesta.id]);
  });

  it('el interlocutor que no participa en la película no retiene prioridad hasta vaciar toda la cola', async () => {
    const d = datos(); montar(d);
    const apertura = turno('abrir-fuentes', 'Generador de consultas', 'Explorador', { temaId: 'tema-fuentes', texto: 'Voy a mirar las fuentes.' });
    const respuesta = turno('responder-fuentes', 'Explorador', 'Generador de consultas', { temaId: 'tema-fuentes', texto: 'Vale, sigo contigo.' });
    motor!.conversar([apertura, respuesta]); await avanzar(1);
    const fuentes = [{ nombre: 'PubMed', salen: 24, sirven: 4, fallo: false, consultas: 1 }, { nombre: 'Europe PMC', salen: 12, sirven: 3, fallo: false, consultas: 1 }];
    const eventos: EventoVisualLab[] = fuentes.map(f => ({ id: `fuente:it-arbitraje:${f.nombre}`, sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: `${f.nombre}\nResultados: ${f.salen}` }));
    motor!.actualizar(conEventos({ ...d, fuentes }, eventos)); const orden: string[] = [];
    await avanzar(900, () => {
      const cosas = documentos().map(el => el.dataset.evento!);
      nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach(el => cosas.push(el.dataset.turno!));
      cosas.forEach(id => { if (!orden.includes(id)) orden.push(id); });
    });
    expect(orden.indexOf(eventos[0]!.id)).toBeGreaterThan(-1);
    expect(orden.indexOf(respuesta.id)).toBeGreaterThan(orden.indexOf(eventos[0]!.id));
    expect(orden.indexOf(eventos[1]!.id)).toBeGreaterThan(orden.indexOf(respuesta.id));
  });
});
