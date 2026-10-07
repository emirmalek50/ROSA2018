// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import { ModeloDeMundo } from './ModeloDeMundo';
import { asistenteGeneral } from '../lib/conversacionesAsistente';
import type { PreguntaABases } from '../datos/tipos';
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

const boton = (texto: string) => [...nodo.querySelectorAll('button')].find(b => b.textContent === texto) ?? null;
const turno = (id: string, hilo: string, pregunta: string, respuesta: string): PreguntaABases => ({
  id, hilo, pregunta, respuesta, fecha: AHORA_MUESTRA, quien: 'persona',
  limites: '', herramientas: [], consultas: [], iteraciones: 1, error: null,
});

it.each(['general', 'investigación'])('busca en todos los hechos sin conexión al comenzar una conversación nueva desde %s', async (pagina) => {
  const e = estadoDeMuestra();
  const primera = e.investigaciones[0]!;
  e.investigaciones = [primera, { ...primera, id: 'inv-otra' }];
  e.hechos = [
    { ...e.hechos[0]!, id: 'he-a', investigacionId: primera.id, enunciado: 'Evidencia de MAPT en la investigación A' },
    { ...e.hechos[0]!, id: 'he-b', investigacionId: 'inv-otra', enunciado: 'Evidencia de MAPT en la investigación B' },
  ];
  const inv = pagina === 'general' ? asistenteGeneral(e) : primera;
  await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  expect(nodo.querySelector('.mundo-compositor-nota')?.textContent).toContain('los 2 hechos');
  await act(async () => escribir(nodo.querySelector('textarea')!, 'MAPT'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(nodo.querySelectorAll('.mundo-encontrados li')).toHaveLength(2);
  expect(nodo.querySelector('.mundo-turnos')?.textContent).toContain('Evidencia de MAPT en la investigación A');
  expect(nodo.querySelector('.mundo-turnos')?.textContent).toContain('Evidencia de MAPT en la investigación B');
  expect(api.preguntarALasBases).not.toHaveBeenCalled();
});

it('la búsqueda local de un hilo antiguo sigue su investigación aunque se abra desde otra página', async () => {
  const e = estadoDeMuestra();
  const primera = e.investigaciones[0]!;
  const segunda = { ...primera, id: 'inv-otra', preguntasABases: [turno('b', 'h-anterior', 'Pregunta anterior', 'Respuesta anterior')] };
  e.investigaciones = [primera, segunda];
  e.hechos = [
    { ...e.hechos[0]!, id: 'he-a', investigacionId: primera.id, enunciado: 'Evidencia de MAPT en la investigación A' },
    { ...e.hechos[0]!, id: 'he-b', investigacionId: segunda.id, enunciado: 'Evidencia de MAPT en la investigación B' },
  ];
  await act(async () => root.render(<ModeloDeMundo inv={primera} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await pulsar(boton('Conversaciones anteriores'));
  await pulsar([...nodo.querySelectorAll('.mundo-historial-panel li button')].find(b => b.textContent?.includes('Pregunta anterior'))!);
  expect(nodo.querySelector('.mundo-compositor-nota')?.textContent).toContain('los 1 hechos');
  await act(async () => escribir(nodo.querySelector('textarea')!, 'MAPT'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(nodo.querySelectorAll('.mundo-encontrados li')).toHaveLength(1);
  expect(nodo.querySelector('.mundo-turnos')?.textContent).toContain('Evidencia de MAPT en la investigación B');
  expect(nodo.querySelector('.mundo-turnos')?.textContent).not.toContain('Evidencia de MAPT en la investigación A');
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Unicornios'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(nodo.querySelector('.mundo-turnos')?.textContent).toContain('Entre los 1 hechos');
});

it('abre un chat vacío aunque exista un hilo recordado y ofrece todo el historial desde cualquier investigación', async () => {
  const e = estadoDeMuestra();
  const primera = { ...e.investigaciones[0]!, preguntasABases: [turno('a', 'h-antiguo', 'Pregunta anterior de MAPT', 'Respuesta anterior de MAPT')] };
  const segunda = { ...primera, id: 'inv-otra', preguntasABases: [turno('b', 'h-antiguo', 'Pregunta anterior de GFAP', 'Respuesta anterior de GFAP')] };
  e.investigaciones = [primera, segunda];
  e.asistenteGlobal = { ...asistenteGeneral(e), preguntasABases: [turno('g', 'h-general', 'Pregunta general anterior', 'Respuesta general anterior')] };
  sessionStorage.setItem('rosa.mundo.hilo.global', 'h-general');
  sessionStorage.setItem(`rosa.mundo.hilo.${primera.id}`, 'h-antiguo');
  await act(async () => root.render(<ModeloDeMundo inv={e.asistenteGlobal!} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  expect(nodo.querySelector('.mundo-turnos')).toBeNull();
  expect(nodo.querySelector('textarea')!.value).toBe('');
  await pulsar(boton('Conversaciones anteriores'));
  expect(nodo.querySelectorAll('.mundo-historial-panel li')).toHaveLength(3);
  await pulsar([...nodo.querySelectorAll('.mundo-historial-panel li button')].find(b => b.textContent?.includes('Pregunta anterior de GFAP'))!);
  expect(nodo.textContent).toContain('Respuesta anterior de GFAP');
  expect(nodo.textContent).not.toContain('Respuesta anterior de MAPT');

  await act(async () => root.unmount());
  root = createRoot(nodo);
  await act(async () => root.render(<ModeloDeMundo inv={primera} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  expect(nodo.querySelector('.mundo-turnos')).toBeNull();
  await pulsar(boton('Conversaciones anteriores'));
  expect(nodo.querySelectorAll('.mundo-historial-panel li')).toHaveLength(3);
  await pulsar([...nodo.querySelectorAll('.mundo-historial-panel li button')].find(b => b.textContent?.includes('Pregunta general anterior'))!);
  expect(nodo.textContent).toContain('Respuesta general anterior');
});

it('continúa un hilo antiguo en su contexto y guarda las conversaciones nuevas en el asistente general', async () => {
  api.preguntarALasBases.mockImplementation(() => new Promise(() => {}));
  const e = estadoDeMuestra();
  e.conexion = 'en_linea';
  const primera = e.investigaciones[0]!;
  const segunda = { ...primera, id: 'inv-otra', preguntasABases: [turno('b', 'h-anterior', 'Revisa GFAP', 'Respuesta de GFAP')] };
  e.investigaciones = [primera, segunda];
  await act(async () => root.render(<ModeloDeMundo inv={primera} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await pulsar(boton('Conversaciones anteriores'));
  await pulsar([...nodo.querySelectorAll('.mundo-historial-panel li button')].find(b => b.textContent?.includes('Revisa GFAP'))!);
  await act(async () => escribir(nodo.querySelector('textarea')!, '¿Qué controles faltan?'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  const llamada = api.preguntarALasBases.mock.calls[0]!;
  expect(llamada[0]).toBe(segunda.id);
  expect(llamada[2]).toBe('h-anterior');
  expect(llamada[4]).toMatchObject({ investigacionId: primera.id });
  expect((boton('Nueva conversación') as HTMLButtonElement).disabled).toBe(true);
  const q = { ...turno('continuacion', 'h-anterior', llamada[1], 'Estos son los controles'), fecha: Date.now(), seguimiento: llamada[3] };
  const actualizado = { ...e, investigaciones: [primera, { ...segunda, preguntasABases: [...segunda.preguntasABases, q] }] };
  await act(async () => root.render(<ModeloDeMundo inv={primera} estado={actualizado} ahora={Date.now()} />));
  expect(nodo.textContent).toContain('Estos son los controles');
  expect(nodo.querySelector('[aria-label="Detener respuesta"]')).toBeNull();
  await pulsar(boton('Nueva conversación'));
  expect(nodo.querySelector('.mundo-turnos')).toBeNull();
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Investiga TREM2'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  expect(api.preguntarALasBases.mock.calls[1]![0]).toBe('global');
  expect(api.preguntarALasBases.mock.calls[1]![2]).not.toBe('h-anterior');
});

it('vuelve a un chat nuevo si desaparece la investigación de una conversación antigua abierta desde el asistente general', async () => {
  const e = estadoDeMuestra();
  const primera = { ...e.investigaciones[0]!, preguntasABases: [turno('a', 'h-antiguo', 'Revisa MAPT', 'Respuesta de MAPT')] };
  e.investigaciones = [primera];
  const general = asistenteGeneral(e);
  await act(async () => root.render(<ModeloDeMundo inv={general} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await pulsar(boton('Conversaciones anteriores'));
  await pulsar(nodo.querySelector('.mundo-historial-panel li button'));
  expect(nodo.textContent).toContain('Respuesta de MAPT');
  await act(async () => root.render(<ModeloDeMundo inv={general} estado={{ ...e, investigaciones: [] }} ahora={AHORA_MUESTRA} />));
  expect(nodo.querySelector('.mundo-turnos')).toBeNull();
  expect(nodo.querySelector('textarea')!.value).toBe('');
});

it('resuelve las referencias de una conversación antigua al abrirla desde el asistente general', async () => {
  const e = estadoDeMuestra();
  const hecho = { ...e.hechos[0]!, id: 'he-mu44icl1-9037' };
  e.hechos = [hecho];
  const primera = { ...e.investigaciones[0]!, preguntasABases: [turno('a', 'h-antiguo', 'Revisa la evidencia', 'Consulta el hecho he-mu44icl1-9037.')] };
  e.investigaciones = [primera];
  await act(async () => root.render(<ModeloDeMundo inv={asistenteGeneral(e)} estado={e} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await pulsar(boton('Conversaciones anteriores'));
  await pulsar(nodo.querySelector('.mundo-historial-panel li button'));
  const referencia = nodo.querySelector<HTMLButtonElement>('.mundo-ref-hecho');
  expect(referencia?.title).toBe(hecho.enunciado);
  await pulsar(referencia);
  expect(nodo.querySelector('.mundo-detalle')?.textContent).toContain(hecho.enunciado);
});


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
  expect(id).toBe('global');
  expect(api.cancelarRespuesta).toHaveBeenLastCalledWith(id, seguimiento);
  await pulsar(detener());
  expect(nodo.querySelector<HTMLButtonElement>('[aria-label="Deteniendo respuesta"]')?.disabled).toBe(true);
  expect(api.preguntarALasBases).toHaveBeenCalledTimes(1);
  expect(nodo.textContent).not.toContain('No se pudo confirmar la cancelación.');
  const q = { id: 'pb-cancelada', fecha: Date.now(), pregunta, hilo, seguimiento, cancelada: true, respuesta: 'Respuesta detenida.', limites: '', herramientas: [], consultas: [], iteraciones: 0, quien: 'persona', error: null };
  const actualizado = { ...e, asistenteGlobal: { ...asistenteGeneral(e), preguntasABases: [q] } };
  await act(async () => root.render(<ModeloDeMundo inv={inv} estado={actualizado} ahora={Date.now()} />));
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
  const pintar = (hilosEliminados: string[]) => act(async () => root.render(<ModeloDeMundo inv={inv} estado={{ ...e, asistenteGlobal: { ...asistenteGeneral(e), hilosEliminados } }} ahora={AHORA_MUESTRA} />));
  await pintar([]);
  await esperarPintado();
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Consulta que borraré'));
  await pulsar(nodo.querySelector('[aria-label="Enviar"]'));
  const hilo = api.preguntarALasBases.mock.calls[0]![2];
  await act(async () => escribir(nodo.querySelector('textarea')!, 'Conserva este borrador'));
  // Un borrado en otro hilo no afecta a la respuesta actual.
  await pintar(['h-ajeno']);
  expect(nodo.querySelector('[aria-label="Detener respuesta"]')).not.toBeNull();
  await pintar(['h-ajeno', hilo]);
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

it.each(['eliminarConversacion', 'eliminarInvestigacion'])('muestra una confirmación explícita para %s', async nombre => {
  api.resolverAccionAsistente.mockResolvedValue({ ok: true, estado: 'ejecutada' });
  const e = estadoDeMuestra();
  e.conexion = 'en_linea';
  const inv = { ...e.investigaciones[0]!, preguntasABases: [{
    id: 'pb-borrar', hilo: 'h-borrar', pregunta: 'Borra esta conversación', respuesta: 'Confirma para eliminarla.',
    fecha: AHORA_MUESTRA, quien: 'persona', limites: '', herramientas: [], consultas: [], iteraciones: 0, error: null,
    acciones: [{ id: 'op-borrar', nombre, argumentos: { investigacion_id: e.investigaciones[0]!.id, ...(nombre === 'eliminarConversacion' ? { hilo: 'h-borrar' } : {}) }, resumen: 'Eliminar MAPT', estado: 'pendiente' as const }],
  }] };
  const actualizado = { ...e, investigaciones: e.investigaciones.map(i => i.id === inv.id ? inv : i) };
  await act(async () => root.render(<ModeloDeMundo inv={inv} estado={actualizado} ahora={AHORA_MUESTRA} />));
  await esperarPintado();
  await pulsar([...nodo.querySelectorAll('button')].find(b => b.textContent === 'Conversaciones anteriores')!);
  await pulsar(nodo.querySelector('.mundo-historial-panel li button'));
  const boton = [...nodo.querySelectorAll('button')].find(b => b.textContent === (nombre === 'eliminarConversacion' ? 'Eliminar conversación' : 'Eliminar investigación'));
  expect(boton).toBeDefined();
  expect(api.resolverAccionAsistente).not.toHaveBeenCalled();
  await pulsar(boton!);
  expect(api.resolverAccionAsistente).toHaveBeenCalledWith(inv.id, 'pb-borrar', 'op-borrar', true, undefined);
});
