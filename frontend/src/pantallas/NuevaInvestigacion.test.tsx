// @vitest-environment jsdom
// El formulario conserva el borrador si falla el servidor y navega únicamente
// tras la confirmación, sin duplicar la petición al pulsar dos veces.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuevaInvestigacion } from './NuevaInvestigacion';
import { acciones } from '../datos/almacen';
import { estadoDeMuestra } from '../datos/muestra';
import { crearInvestigacion } from '../datos/acciones';
import { fijarIdioma } from '../lib/idioma';
import type { EstadoRosa } from '../datos/tipos';

vi.mock('../datos/almacen', () => ({ acciones: { crearInvestigacion: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let nodo: HTMLDivElement, root: Root, estado: EstadoRosa;
const irA = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  fijarIdioma('es');
  estado = { ...estadoDeMuestra(), conexion: 'en_linea', investigaciones: [], hechos: [] };
  nodo = document.body.appendChild(document.createElement('div'));
  root = createRoot(nodo);
  await act(async () => root.render(<NuevaInvestigacion estado={estado} irA={irA} />));
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); });
async function escribir(id: string, texto: string) {
  const campo = nodo.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, 'value')!.set!.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function rellenar() {
  await escribir('n-titulo', '  Investigación  ');
  await escribir('n-objetivo', 'Evaluar la progresión de GFAP con un biomarcador medible en una cohorte longitudinal de Alzheimer.');
  await escribir('n-parada', '3 iterations or 72 hours');
}
async function enviar() { await act(async () => nodo.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function boton(nombre: string) {
  const b = Array.from(nodo.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === nombre)!;
  await act(async () => b.click());
}
it('bloquea envíos simultáneos y cuenta también el revisor pendiente', async () => {
  await rellenar();
  await escribir('n-revisores', 'Emir Malek, Emir Malek');
  expect(nodo.querySelector('.ni-resumen')!.textContent).toContain('1 persona');
  let resolver!: (r: Awaited<ReturnType<typeof acciones.crearInvestigacion>>) => void;
  vi.mocked(acciones.crearInvestigacion).mockImplementation(() => new Promise((r) => { resolver = r; }));
  await enviar(); await enviar();
  expect(acciones.crearInvestigacion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(acciones.crearInvestigacion).mock.calls[0]![0]).toMatchObject({ titulo: 'Investigación', revisores: ['Emir Malek'] });
  expect(irA).not.toHaveBeenCalled();
  expect(nodo.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true);
  await act(async () => resolver({ estado: 'creada', investigacionId: 'inv-real', corridaId: 'cor-real' }));
  expect(irA).toHaveBeenCalledWith('#/investigaciones/inv-real/corrida');
});
it('conserva el borrador y el ID al reintentar una respuesta perdida', async () => {
  await rellenar();
  vi.mocked(acciones.crearInvestigacion).mockResolvedValue({ estado: 'sin_respuesta' });
  await enviar(); await enviar();
  expect(irA).not.toHaveBeenCalled();
  expect(nodo.querySelector('[role=alert]')!.textContent).toContain('No pude confirmar');
  const llamadas = vi.mocked(acciones.crearInvestigacion).mock.calls;
  expect(llamadas[0]![1]).toBe(llamadas[1]![1]);
  expect(nodo.querySelector<HTMLInputElement>('#n-titulo')!.value).toBe('  Investigación  ');
  await escribir('n-titulo', 'Otra investigación'); await enviar();
  expect(llamadas[2]![1]).not.toBe(llamadas[0]![1]);
});
it('no envía una misión vacía y conserva una misión de solo tejido', async () => {
  await rellenar();
  await boton('Escribirla yo');
  vi.mocked(acciones.crearInvestigacion).mockResolvedValue({ estado: 'rechazada' });
  await enviar();
  expect(vi.mocked(acciones.crearInvestigacion).mock.calls[0]![0].mision).toBeUndefined();
  await escribir('nm-celulaTejido', '  Astrocitos  '); await enviar();
  expect(vi.mocked(acciones.crearInvestigacion).mock.calls[1]![0].mision?.celulaTejido).toBe('Astrocitos');
  expect(irA).not.toHaveBeenCalled();
});
it('no guarda con campos vacíos y muestra los avisos en inglés', async () => {
  await act(async () => fijarIdioma('en'));
  await enviar();
  expect(acciones.crearInvestigacion).not.toHaveBeenCalled();
  expect(nodo.querySelector('[role=alert]')!.textContent).toContain('The title');
  await rellenar();
  expect(nodo.querySelector('.ni-resumen')!.textContent).toContain('3 iterations');
  expect(nodo.querySelector('.ni-resumen')!.textContent).not.toContain('iteraciones');
});
it.each([{ celulaTejido: 'Astrocitos' }, { capacidadesLaboratorio: ['Simoa'] }])('el reducer conserva misiones parciales %j', (mision) => {
  const r = crearInvestigacion(estado, { titulo: 'T', objetivo: 'O', relevancia: '', limites: [], condicionParada: '3 iterations', revisores: [], mision }, 1000);
  expect(r.estado.investigaciones[0]!.mision).toMatchObject({ ...mision, aprobadaEn: 1000, aprobadaPor: 'Investigadora' });
});

it('cuenta los hechos que se heredan sin duplicados y permite recuperarse si la partida desaparece', async () => {
  const muestra = estadoDeMuestra();
  const hecho = muestra.hechos[0]!;
  const origen = muestra.investigaciones.find((i) => i.id === hecho.investigacionId)!;
  estado = { ...estado, investigaciones: [origen], hechos: [hecho, { ...hecho, id: 'he-duplicado' }] };
  await act(async () => root.render(<NuevaInvestigacion estado={estado} irA={irA} />));
  await act(async () => nodo.querySelector<HTMLInputElement>(`input[value="${origen.id}"]`)!.click());
  expect(nodo.querySelector('.ni-resumen')!.textContent).toContain('1 nodo heredado');
  await rellenar();
  estado = { ...estado, investigaciones: [], hechos: [] };
  await act(async () => root.render(<NuevaInvestigacion estado={estado} irA={irA} />));
  await enviar();
  expect(acciones.crearInvestigacion).not.toHaveBeenCalled();
  expect(nodo.querySelector('[role=alert]')!.textContent).toContain('ya no existe');
  await act(async () => nodo.querySelector<HTMLInputElement>('#n-heredar')!.click());
  vi.mocked(acciones.crearInvestigacion).mockResolvedValue({ estado: 'rechazada' });
  await enviar();
  expect(vi.mocked(acciones.crearInvestigacion).mock.calls[0]![0].heredarModeloDe).toBeNull();
});
