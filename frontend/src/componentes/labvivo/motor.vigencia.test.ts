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
const voces = () => [...nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')];
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    tiempo += 50; frame(tiempo);
    for (let k = 0; k < 8; k++) await Promise.resolve();
    observar?.();
  }
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

describe('regresión de vigencia antes de comentar una película', () => {
  it('una voz en cola caducada no se publica aunque haya una entrega disponible', async () => {
    let ahora = 1790000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => ahora);
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'extraccion-test-caducidad', sala: 'r1', agentes: ['Extractor de afirmaciones'], tipo: 'extraccion', texto: 'Resultado guardado' };
    motor!.actualizar({ ...d, pelicula: { eventos: [e], ideas: [] } });
    await avanzar(1);
    expect(nodo.querySelector('[data-evento="extraccion-test-caducidad"]')).not.toBeNull();
    const t = turno('voz-caducada', 'Extractor de afirmaciones', 'Puntuador preguntas', { tipoConversacion: 'actividad', fecha: ahora - 89900 });
    motor!.conversar([t]);
    ahora += 200;
    await avanzar(1);
    expect(voces().map(el => el.dataset.turno)).not.toContain(t.id);
  });
  it('una intención cuya tarea ya cerró no se publica durante la película que queda en pantalla', async () => {
    const tarea = { id: 'entrada-activa', agente: 'Extractor de afirmaciones', sala: 'r1' as const, texto: 'Extraer afirmaciones', tipo: 'estado' as const,
      pistaId: 'pista-actual', pasoId: 'paso-cadencia', fuente: 'PubMed', titulo: 'Leer originales', enCurso: true, abierta: true, estadoAgente: 'en_curso' as const, t: 0 };
    const d = { ...datos(), activos: ['Extractor de afirmaciones'], actividad: [tarea] }; montar(d);
    const e: EventoVisualLab = { id: 'extraccion-test-cierre', sala: 'r1', agentes: ['Extractor de afirmaciones'], tipo: 'extraccion', texto: 'Resultado guardado' };
    const actual = { ...d, pelicula: { eventos: [e], ideas: [] } }; motor!.actualizar(actual); await avanzar(1);
    const t = turno('voz-tarea-cerrada', 'Extractor de afirmaciones', 'Puntuador preguntas', { tipoConversacion: 'actividad', momento: 'inicio_tarea', materiales: [{ id: 'inicio-actual', clase: 'tarea', pistaId: tarea.pistaId, pasoId: tarea.pasoId,
      entradaId: tarea.id, agente: tarea.agente, texto: tarea.texto, estado: 'en_curso' }] });
    motor!.conversar([t]);
    motor!.actualizar({ ...actual, activos: ['Contradicción'], actividad: [{ ...tarea, enCurso: false, abierta: false, estadoAgente: 'terminado' }] });
    await avanzar(1);
    expect(voces().map(el => el.dataset.turno)).not.toContain(t.id);
  });
});
