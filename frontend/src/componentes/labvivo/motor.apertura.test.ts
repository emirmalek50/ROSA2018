// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import { montarLaboratorio, type Laboratorio } from './motor';

let raiz: HTMLDivElement, lab: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;

/** El caso real: entrar durante el juez después de terminar el cribado. */
function fotografia(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  c.busqueda = { ...c.busqueda, consultas: [] };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'iteracion-apertura', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'verificar', tipo: 'verificacion', titulo: 'Comprobar las citas de MAPT', detalle: '', estado: 'en_curso' }], pistas: [] };
  const d = datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i);
  return { ...d, foco: 'r2', activos: ['Juez'], actividad: [],
    fuentes: [{ nombre: 'PubMed', salen: 28, sirven: 6, fallo: false, consultas: 1 }],
    lectura: { resultados: 28, sirven: 6, recuperados: 4, leidos: 4, afirmaciones: 12 },
    pelicula: { ideas: [], eventos: [
      { id: 'plan:iteracion-apertura', sala: 'plan', agentes: ['Planificador'], tipo: 'plan', texto: 'Plan aprobado: comprobar las citas de MAPT' },
      { id: 'fuente:iteracion-apertura:PubMed', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: 'PubMed\nResultados: 28\nRelevantes: 6' },
      { id: 'registro:articulo-real', sala: 'r1', agentes: ['Puntuador preguntas'], tipo: 'filtro', texto: 'Decisión registrada',
        dato: { tipo: 'articulo', id: 'PMID:123', titulo: 'Estudio de MAPT', estado: 'incluido', motivo: 'Mide el resultado buscado', modo: 'foco' } },
      { id: 'lectura:iteracion-apertura', sala: 'r1', agentes: ['Extractor de afirmaciones'], tipo: 'lectura', texto: 'Fuentes leídas: 4\nAfirmaciones extraídas: 12' },
      { id: 'verificacion:iteracion-apertura', sala: 'r2', agentes: ['Juez'], tipo: 'revision', texto: 'Juez: 3 / 12' },
    ] },
  };
}

function montar(d: DatosLab) {
  lab = montarLaboratorio(raiz, d, { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true),
    ampliarPresupuesto: vi.fn(async () => true), resolverIncidencia: vi.fn(async () => true), verEnLaCorrida: vi.fn(), verNovedad: vi.fn() });
}
async function avanzar(segundos: number, observar: () => void) {
  for (let n = 0; n < segundos * 10; n++) {
    tiempo += 100; frame(tiempo);
    for (let k = 0; k < 4; k++) await Promise.resolve();
    observar();
  }
}
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; lab = null; raiz = document.createElement('div'); document.body.append(raiz);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { lab?.desmontar(); raiz.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('al entrar a mitad de corrida muestra resultados guardados y el progreso actual, sin nuevas tareas', async () => {
  const d = fotografia(); montar(d);
  const vistas = new Map<string, Set<Element>>();
  const expedientes = new Map<string, Set<Element>>();
  await avanzar(85, () => {
    raiz.querySelectorAll<HTMLElement>('.lv-documento[data-evento]').forEach(el => {
      const id = el.dataset.evento!;
      if (!vistas.has(id)) vistas.set(id, new Set());
      vistas.get(id)!.add(el);
    });
    raiz.querySelectorAll<HTMLElement>('.lv-expediente-viajero').forEach(el => {
      const id = el.dataset.evento!;
      if (!expedientes.has(id)) expedientes.set(id, new Set());
      expedientes.get(id)!.add(el);
    });
    if (tiempo % 500 === 0) lab!.actualizar(d);
  });
  expect([...vistas.keys()]).toEqual(expect.arrayContaining(d.pelicula!.eventos.filter(e => e.tipo !== 'plan').map(e => e.id)));
  expect(vistas.has('plan:iteracion-apertura')).toBe(false);
  expect(expedientes.has('plan:iteracion-apertura')).toBe(true);
  // La pizarra conserva la escritura sin hojas flotantes. El mismo episodio
  // mantiene un único expediente al recibir la misma foto por SSE.
  expect([...expedientes.values()].every(elementos => elementos.size === 1)).toBe(true);
  expect(raiz.querySelector('[data-agente="Puntuador preguntas"]')!.classList.contains('activo')).toBe(false);
  expect(raiz.querySelectorAll('.lv-bub')).toHaveLength(0);
});

it('reanudar o recuperar conexión conserva solo la tarea actual y no vuelve a representar el cribado', async () => {
  const d = fotografia(); montar({ ...d, trabajando: false, estado: 'pausada' });
  lab!.actualizar(d);
  const vistas = new Set<string>();
  await avanzar(50, () => raiz.querySelectorAll<HTMLElement>('.lv-documento').forEach(el => vistas.add(el.dataset.evento ?? '')));
  expect(vistas.has('verificacion:iteracion-apertura')).toBe(true);
  expect(vistas.has('registro:articulo-real')).toBe(false);
  expect(vistas.has('fuente:iteracion-apertura:PubMed')).toBe(false);
});
