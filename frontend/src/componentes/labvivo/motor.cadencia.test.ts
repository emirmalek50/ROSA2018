// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { montarLaboratorio, type Laboratorio } from './motor';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number, reducido: boolean, oculta: boolean;
function datos(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'it-cadencia', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso-cadencia', tipo: 'literatura', titulo: 'Consultar fuentes', detalle: 'Solo las publicadas', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i), activos: [], actividad: [], pelicula: { eventos: [], ideas: [] } };
}
function montar(d = datos()) {
  motor = montarLaboratorio(nodo, d, { conceder: async () => true, denegar: async () => true, aprobarPlan: async () => true,
    ampliarPresupuesto: async () => true, resolverIncidencia: async () => true, verEnLaCorrida: () => undefined, verNovedad: () => undefined });
}
function turno(id: string, agente: string, destinatario: string, cambios: Partial<TurnoLaboratorio> = {}): TurnoLaboratorio {
  return { id, temaId: `tema-${id}`, iteracionId: 'it-cadencia', idioma: 'es', agente, destinatario,
    texto: 'Vale, voy a revisar esa comparación.', fecha: Date.now(), modelo: 'prueba', materiales: [], tipoConversacion: 'companeros', ...cambios };
}
function tanda(): TurnoLaboratorio[] {
  return [turno('evidencia', 'Juez', 'Señalizador de sesgo'), turno('ideas', 'Analogía', 'Contradicción'), turno('patentes', 'Especialista en patentes', 'Especialista en compañías')];
}
const voces = () => [...nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')];
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    tiempo += 50; frame(tiempo);
    for (let k = 0; k < 8; k++) await Promise.resolve();
    observar?.();
  }
}
function posicion(el: HTMLElement): [number, number] {
  const p = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(el.style.transform);
  return p ? [Number(p[1]), Number(p[2])] : [0, 0];
}
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; reducido = false; oculta = false; motor = null; nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => oculta);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: reducido }));
});
afterEach(async () => { motor?.desmontar(); nodo.remove(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('cada entrada se escucha a su ritmo, aunque los turnos lleguen juntos', () => {
  it.each([false, true])('escalona tres salas sin perder frecuencia, movimiento reducido=%s', async reduce => {
    reducido = reduce; montar(); const turnos = tanda(); motor!.conversar(turnos);
    expect(voces()).toHaveLength(0);
    const primeras = new Map<string, number>(); let juntas = 0;
    await avanzar(100, () => {
      voces().forEach(el => { if (!primeras.has(el.dataset.turno!)) primeras.set(el.dataset.turno!, tiempo); });
      juntas = Math.max(juntas, voces().length);
    });
    expect([...primeras.keys()]).toEqual(turnos.map(t => t.id));
    const tiempos = [...primeras.values()];
    expect(tiempos[0]).toBeLessThan(100);
    for (let i = 1; i < tiempos.length; i++) {
      expect(tiempos[i]! - tiempos[i - 1]!).toBeGreaterThanOrEqual(1190);
      expect(tiempos[i]! - tiempos[i - 1]!).toBeLessThanOrEqual(2250);
    }
    expect(juntas).toBeGreaterThanOrEqual(2);
    expect(tiempos.at(-1)).toBeLessThan(5000);
  });

  it.each([false, true])('una respuesta respeta la desaparición y una pausa antes de hablar, movimiento reducido=%s', async reduce => {
    reducido = reduce; montar();
    const a = turno('apertura', 'Especialista en patentes', 'Especialista en compañías', { temaId: 'tema-novedad', texto: 'Voy a contrastarlo.' });
    const b = turno('respuesta', 'Especialista en compañías', 'Especialista en patentes', { temaId: 'tema-novedad', texto: 'Vale, miro quién lo estudia.' });
    motor!.conversar([a, b]); let ultimaA = 0, primeraB = 0;
    await avanzar(240, () => {
      if (voces().some(el => el.dataset.turno === a.id)) ultimaA = tiempo;
      if (!primeraB && voces().some(el => el.dataset.turno === b.id)) primeraB = tiempo;
    });
    expect(primeraB).toBeGreaterThan(ultimaA);
    expect(primeraB - ultimaA).toBeGreaterThanOrEqual(350);
    expect(primeraB - ultimaA).toBeLessThanOrEqual(1000);
  });

  it.each([false, true])('las tandas repetidas no vuelven a mostrar un ID ni sustituyen los personajes, movimiento reducido=%s', async reduce => {
    reducido = reduce; montar(); const turnos = tanda(), personajes = [...nodo.querySelectorAll('.lv-ag')];
    const porId = new Map<string, Set<HTMLElement>>(); motor!.conversar(turnos);
    await avanzar(800, () => {
      if (tiempo % 1000 === 0) motor!.conversar(turnos);
      voces().forEach(el => { const conjunto = porId.get(el.dataset.turno!) ?? new Set<HTMLElement>(); conjunto.add(el); porId.set(el.dataset.turno!, conjunto); });
    });
    expect([...porId.keys()]).toEqual(turnos.map(t => t.id));
    expect([...porId.values()].map(s => s.size)).toEqual([1, 1, 1]);
    expect([...nodo.querySelectorAll('.lv-ag')]).toEqual(personajes);
    expect(voces()).toHaveLength(0);
  });

  it.each([false, true])('pausa y pestaña oculta congelan la cadencia y la lectura, movimiento reducido=%s', async reduce => {
    reducido = reduce; montar(); const turnos = tanda(); motor!.conversar(turnos); await avanzar(1);
    const primera = voces()[0]!; expect(primera.dataset.turno).toBe(turnos[0]!.id);
    nodo.querySelector<HTMLButtonElement>('.lv-play')!.click(); await avanzar(120);
    expect(voces()).toEqual([primera]);
    nodo.querySelector<HTMLButtonElement>('.lv-play')!.click(); oculta = true; await avanzar(120);
    expect(voces()).toEqual([primera]);
    oculta = false; await avanzar(10); expect(voces()).toEqual([primera]);
    await avanzar(40); expect(voces().some(el => el.dataset.turno === turnos[1]!.id)).toBe(true);
  });

  it('el movimiento reducido deja expirar los textos sin desplazar ningún cuerpo', async () => {
    reducido = true; const d = datos(); montar({ ...d, activos: ['Juez'] }); await avanzar(1);
    const personajes = [...nodo.querySelectorAll<HTMLElement>('.lv-ag')], posiciones = personajes.map(el => el.style.transform);
    motor!.conversar(tanda()); let leidas = 0; const vistas = new Set<string>();
    await avanzar(800, () => {
      voces().forEach(el => vistas.add(el.dataset.turno!)); leidas = Math.max(leidas, vistas.size);
      expect(personajes.map(el => el.style.transform)).toEqual(posiciones);
    });
    expect(leidas).toBe(3); expect(voces()).toHaveLength(0);
    expect(nodo.querySelector('[data-escena="pelicula"]')).toBeNull();
  });

  it('comenta una fuente y responde mientras continúa la entrega, con texto exacto y sin reencolar ni saltar', async () => {
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'fuente:it-cadencia:PubMed', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: 'PubMed\nResultados: 24' };
    motor!.actualizar({ ...d, activos: ['Generador de consultas'], fuentes: [{ nombre: 'PubMed', salen: 24, sirven: 4, fallo: false, consultas: 1 }], pelicula: { eventos: [e], ideas: [] } });
    await avanzar(1);
    const a = turno('leyendo', 'Generador de consultas', 'Explorador', { temaId: 'fuente-real', texto: 'Voy a contrastar lo que encontré en esta fuente.', tipoConversacion: 'actividad' });
    const b = turno('respondiendo', 'Explorador', 'Generador de consultas', { temaId: 'fuente-real', texto: 'Vale, reviso contigo el comparador.', tipoConversacion: 'actividad' });
    const personaje = nodo.querySelector<HTMLElement>('[data-agente="Generador de consultas"]')!, inicial = posicion(personaje);
    motor!.conversar([a, b]); const textos = new Map<string, string>(), documentos = new Set<HTMLElement>(); let ultima = inicial, salto = 0, movimiento = 0;
    await avanzar(800, () => {
      voces().forEach(el => textos.set(el.dataset.turno!, el.title));
      nodo.querySelectorAll<HTMLElement>('.lv-documento[data-evento]').forEach(el => { if (el.dataset.evento === e.id) documentos.add(el); });
      const ahora = posicion(personaje); salto = Math.max(salto, Math.hypot(ahora[0] - ultima[0], ahora[1] - ultima[1])); ultima = ahora;
      if (tiempo <= 2000) {
        movimiento = Math.max(movimiento, Math.hypot(ahora[0] - inicial[0], ahora[1] - inicial[1]));
        expect(personaje.dataset.evento).toBe(e.id); expect(personaje.dataset.escena).toBe('pelicula');
      }
      expect(nodo.querySelector('[data-agente="Generador de consultas"]')).toBe(personaje);
    });
    expect([...textos.entries()]).toEqual([[a.id, a.texto], [b.id, b.texto]]);
    expect(movimiento).toBeGreaterThan(50); expect(salto).toBeLessThan(8);
    expect(documentos.size).toBe(1);
  });

  it('si la actividad llega antes del primer frame espera la entrega y no adelanta la respuesta de su tema', async () => {
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'fuente:it-cadencia:Europe PMC', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: 'Europe PMC\nResultados: 12' };
    motor!.actualizar({ ...d, activos: ['Generador de consultas'], fuentes: [{ nombre: 'Europe PMC', salen: 12, sirven: 2, fallo: false, consultas: 1 }], pelicula: { eventos: [e], ideas: [] } });
    const a = turno('abriendo-antes', 'Generador de consultas', 'Explorador', { temaId: 'antes-del-frame', texto: 'Voy a revisar esta fuente.', tipoConversacion: 'actividad' });
    const b = turno('respuesta-antes', 'Explorador', 'Generador de consultas', { temaId: 'antes-del-frame', texto: 'Vale, miro contigo.', tipoConversacion: 'actividad' });
    motor!.conversar([a, b]); const vistos: string[] = []; let bajoEntrega = false;
    await avanzar(320, () => {
      voces().forEach(el => { if (!vistos.includes(el.dataset.turno!)) vistos.push(el.dataset.turno!); });
      if (voces().some(el => el.dataset.turno === a.id)) bajoEntrega ||= nodo.querySelector('[data-agente="Generador de consultas"]')?.getAttribute('data-evento') === e.id;
    });
    expect(vistos).toEqual([a.id, b.id]); expect(bajoEntrega).toBe(true);
  });

  it('el juez comenta la afirmación mientras el mismo papel sigue hasta su sello y su caja', async () => {
    const d = datos(), af = { id: 'af-cadencia', texto: 'MAPT aparece en las neuronas del modelo', veredicto: 'parcial' as const, caja: 'parcial' as const,
      motivo: 'El experimento aún no separa causa y consecuencia', cita: 'PMID de la prueba', articulo: 'Artículo de la prueba', biblioteca: null, procedenciaVeredicto: { origen: 'juez' as const, modelo: 'modelo de prueba', comprobaciones: [] } };
    montar({ ...d, foco: 'r2', activos: ['Juez'], afirmaciones: [af] }); await avanzar(1);
    const papel = nodo.querySelector<HTMLElement>('.lv-hoja-trazada')!, personaje = nodo.querySelector('[data-agente="Juez"]');
    expect(papel?.dataset.afirmacion).toBe(af.id);
    const a = turno('juicio-apertura', 'Juez', 'Señalizador de sesgo', { temaId: 'juicio-real', texto: 'Miro esa comparación.', tipoConversacion: 'actividad' });
    const b = turno('juicio-respuesta', 'Señalizador de sesgo', 'Juez', { temaId: 'juicio-real', texto: 'Vale, voy contigo.', tipoConversacion: 'actividad' });
    motor!.conversar([a, b]); const etapas = new Set<string>(), textos = new Map<string, string>(), sellos = new Set<HTMLElement>(), documentos = new Set<HTMLElement>();
    let ultimaA = 0, primeraB = 0;
    await avanzar(340, () => {
      voces().forEach(el => {
        textos.set(el.dataset.turno!, el.title);
        if (el.dataset.turno === a.id) ultimaA = tiempo;
        if (el.dataset.turno === b.id && !primeraB) primeraB = tiempo;
      });
      nodo.querySelectorAll<HTMLElement>('.lv-hoja-trazada').forEach(el => { expect(el).toBe(papel); etapas.add(el.dataset.etapa!); });
      nodo.querySelectorAll<HTMLElement>('.lv-documento-juicio').forEach(el => documentos.add(el));
      nodo.querySelectorAll<HTMLElement>('.lv-sello').forEach(el => sellos.add(el));
      expect(nodo.querySelector('[data-agente="Juez"]')).toBe(personaje);
    });
    expect([...textos.entries()]).toEqual([[a.id, a.texto], [b.id, b.texto]]);
    expect(primeraB - ultimaA).toBeGreaterThanOrEqual(350); expect(primeraB - ultimaA).toBeLessThanOrEqual(1000);
    expect([...etapas]).toEqual(['extractor', 'cinta', 'juez', 'caja']);
    expect(documentos.size).toBe(1); expect([...documentos][0]!.dataset.afirmacion).toBe(af.id);
    expect(sellos.size).toBe(1); expect([...sellos][0]!.textContent).toBe('PARCIAL');
  });

  it('al desactivar las voces descarta la espera y no revive turnos previos', async () => {
    montar(); const turnos = tanda(); motor!.conversar(turnos); await avanzar(1);
    motor!.conversar(turnos, false); expect(voces()).toHaveLength(0);
    motor!.conversar(turnos); await avanzar(100);
    expect(voces()).toHaveLength(0);
    const nuevo = turno('después-de-activar', 'Analogía', 'Contradicción'); motor!.conversar([nuevo]);
    await avanzar(1); expect(voces().map(el => el.dataset.turno)).toEqual([nuevo.id]);
  });
});
