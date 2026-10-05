// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import { ModeloDeMundo } from './ModeloDeMundo';
const api = vi.hoisted(() => ({ preguntarALasBases: vi.fn(), cancelarRespuesta: vi.fn(), resolverAccionAsistente: vi.fn(), razonamientoDePregunta: vi.fn().mockResolvedValue(null) }));
vi.mock('../datos/almacen', async (original) => ({ ...(await original<typeof import('../datos/almacen')>()), acciones: api }));

beforeAll(() => {
  // Las secciones entran con `whileInView` (motion): jsdom no trae IntersectionObserver ni ResizeObserver.
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const pulsar = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}


it('detiene la respuesta vacía, permite reintentar si falla y conserva el siguiente mensaje', async () => {
  sessionStorage.clear();
  const pendientes: ((error: string | null) => void)[] = [];
  api.preguntarALasBases.mockImplementation(() => new Promise(resolve => pendientes.push(resolve)));
  api.cancelarRespuesta.mockResolvedValueOnce('No se pudo confirmar la cancelación.').mockResolvedValue(null);
  const e = estadoDeMuestra();
  e.conexion = 'en_linea';
  const inv = e.investigaciones[0]!;
  inv.preguntasABases = [];
  await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Revisa MAPT'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(nodo.querySelector('textarea')!.value).toBe('');
  const detener = () => nodo.querySelector<HTMLButtonElement>('[aria-label="Detener respuesta"]');
  expect(detener()?.disabled).toBe(false);
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Mi siguiente mensaje'));
  await pulsar(detener());
  expect(nodo.textContent).toContain('No se pudo confirmar la cancelación.');
  expect(detener()?.disabled).toBe(false);
  const [id, pregunta, hilo, seguimiento] = api.preguntarALasBases.mock.calls[0]!;
  expect(api.cancelarRespuesta).toHaveBeenLastCalledWith(id, seguimiento);
  await pulsar(detener());
  expect(nodo.querySelector<HTMLButtonElement>('[aria-label="Deteniendo respuesta"]')?.disabled).toBe(true);
  expect(api.preguntarALasBases).toHaveBeenCalledTimes(1);
  expect(nodo.textContent).not.toContain('No se pudo confirmar la cancelación.');
  const q = { id: 'pb-cancelada', fecha: Date.now(), pregunta, hilo, seguimiento, cancelada: true, respuesta: 'Respuesta detenida.', limites: '', herramientas: [], consultas: [], iteraciones: 0, quien: 'persona', error: null };
  const inv2 = { ...inv, preguntasABases: [q] };
  await act(async () => root.render(<ModeloDeMundo inv={inv2} estado={e} ahora={Date.now()} />));
  expect(nodo.textContent).toContain('Respuesta detenida.');
  expect(nodo.querySelector('[aria-label="Deteniendo respuesta"]')).toBeNull();
  expect(nodo.querySelector('textarea')!.value).toBe('Mi siguiente mensaje');
  expect(nodo.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')?.disabled).toBe(false);
  expect(nodo.textContent).not.toContain('Léemela');
  // La misma pregunta enviada enseguida no se confunde con la cancelada.
  await act(async () => escribir(nodo.querySelector('textarea')!, pregunta));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(api.preguntarALasBases).toHaveBeenCalledTimes(2);
  expect(detener()?.disabled).toBe(false);
  await act(async () => pendientes[0]!(null));
  expect(detener()?.disabled).toBe(false);
  // Una confirmación tardía del primer HTTP tampoco deja lista la segunda.
  expect(nodo.textContent).not.toContain('Respuesta lista. Llegando...');
});

it('limpia el hilo eliminado desde otra pestaña y no recupera una respuesta tardía', async () => {
  const respuestas: ((error: string | null) => void)[] = [];
  api.preguntarALasBases.mockImplementation(() => new Promise(resolve => respuestas.push(resolve)));
  const e = estadoDeMuestra();
  e.conexion = 'en_linea';
  const inv = { ...e.investigaciones[0]!, preguntasABases: [] };
  const pintar = (actual: typeof inv & { hilosEliminados?: string[] }) => act(async () => root.render(<ModeloDeMundo inv={actual} estado={e} ahora={AHORA_MUESTRA} />));
  await pintar(inv);
  await esperarPintado();
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Consulta que borraré'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  const hilo = api.preguntarALasBases.mock.calls[0]![2];
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Conserva este borrador'));
  // Un borrado en otro hilo no afecta a la respuesta actual.
  await pintar({ ...inv, hilosEliminados: ['h-ajeno'] });
  expect(nodo.querySelector('[aria-label="Detener respuesta"]')).not.toBeNull();
  await pintar({ ...inv, hilosEliminados: ['h-ajeno', hilo] });
  expect(nodo.querySelector('[aria-label="Detener respuesta"]')).toBeNull();
  expect(nodo.textContent).not.toContain('Consulta que borraré');
  expect(sessionStorage.getItem(`rosa.mundo.hilo.${inv.id}`)).toBeNull();
  expect(nodo.querySelector('textarea')!.value).toBe('Conserva este borrador');
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(api.preguntarALasBases.mock.calls[1]![2]).not.toBe(hilo);
  await act(async () => respuestas[0]!('Fallo tardío del hilo eliminado'));
  expect(nodo.textContent).not.toContain('Fallo tardío');
  expect(nodo.querySelector('[aria-label="Detener respuesta"]')).not.toBeNull();
});

it('muestra una confirmación explícita antes de eliminar la conversación', async () => {
  api.resolverAccionAsistente.mockResolvedValue({ ok: true, estado: 'ejecutada' });
  const e = estadoDeMuestra();
  e.conexion = 'en_linea';
  const inv = { ...e.investigaciones[0]!, preguntasABases: [{
    id: 'pb-borrar', hilo: 'h-borrar', pregunta: 'Borra esta conversación', respuesta: 'Confirma para eliminarla.',
    fecha: AHORA_MUESTRA, quien: 'persona', limites: '', herramientas: [], consultas: [], iteraciones: 0, error: null,
    acciones: [{ id: 'op-borrar', nombre: 'eliminarConversacion', argumentos: { investigacion_id: e.investigaciones[0]!.id, hilo: 'h-borrar' }, resumen: 'Eliminar conversación: MAPT', estado: 'pendiente' as const }],
  }] };
  sessionStorage.setItem(`rosa.mundo.hilo.${inv.id}`, 'h-borrar');
  await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  const boton = [...nodo.querySelectorAll('button')].find(b => b.textContent === 'Eliminar conversación');
  expect(boton).toBeDefined();
  expect(api.resolverAccionAsistente).not.toHaveBeenCalled();
  await pulsar(boton!);
  expect(api.resolverAccionAsistente).toHaveBeenCalledWith(inv.id, 'pb-borrar', 'op-borrar', true, undefined);
});
