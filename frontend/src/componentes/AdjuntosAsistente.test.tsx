// @vitest-environment jsdom
// El menú «+» de adjuntar datos. Lo que se comprueba es lo mismo que antes
// del rediseño del 2 de octubre de 2026: que no se sube nada hasta pulsar
// guardar, que el destino y la marca de sintético llegan bien al endpoint, y
// que desde la vista global hay que elegir investigación primero. El camino:
// el menú tiene DOS acciones (subir un dataset, subir resultados de un
// experimento); elegir una abre el selector de archivos; el archivo sale en
// un chip, y si son resultados, AHÍ se elige de qué experimento.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdjuntosAsistente } from './AdjuntosAsistente';
import { fijarIdioma } from '../lib/idioma';

afterEach(() => fijarIdioma('es'));

const subirDataset = vi.fn();
const subirDatosExperimento = vi.fn();
vi.mock('../datos/almacen', () => ({ acciones: { subirDataset: (...args: unknown[]) => subirDataset(...args), subirDatosExperimento: (...args: unknown[]) => subirDatosExperimento(...args) }, useRosa: () => ({ investigaciones: [{ id: 'inv-1', titulo: 'Principal' }, { id: 'otra', titulo: 'Otra investigación' }], hipotesis: [{ id: 'h-1', investigacionId: 'inv-1', titulo: 'MAPT', experimento: {} }, { id: 'h-otra', investigacionId: 'otra', titulo: 'Otra', experimento: {} }] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** El selector de archivos del sistema no existe en jsdom: en su lugar se
 *  pone el archivo en el input oculto y se dispara el cambio. */
async function elegirArchivo(nodo: HTMLElement, fichero: File) {
  const entrada = nodo.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(entrada, 'files', { value: [fichero], configurable: true });
  await act(async () => entrada.dispatchEvent(new Event('change', { bubbles: true })));
}

const fila = (nodo: HTMLElement, texto: string) => [...nodo.querySelectorAll<HTMLButtonElement>('.adjuntos-fila')].find(b => b.querySelector('.adjuntos-fila-texto > span')?.textContent?.trim().startsWith(texto))!;
/** El menú está abierto o cerrado según el botón: el nodo del menú puede
 *  seguir en el DOM un instante mientras AnimatePresence lo saca. */
const abierto = (nodo: HTMLElement) => nodo.querySelector('.mundo-adjuntar')!.getAttribute('aria-expanded') === 'true';

it.each([['dataset', 'Subir un dataset'], ['h-1', 'Subir resultados']])('adjunta %s solo al guardar y conserva la marca sintética', async (destino, rotulo) => {
  subirDataset.mockReset().mockResolvedValue(null);
  subirDatosExperimento.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const alSubir = vi.fn();
  await act(async () => root.render(<AdjuntosAsistente investigacionId="inv-1" alSubir={alSubir} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  // Dos acciones, no una fila por hipótesis: eso va en el chip.
  expect(nodo.querySelectorAll('.adjuntos-fila').length).toBe(2);
  // Elegir la acción cierra el menú.
  await act(async () => fila(nodo, rotulo).click());
  expect(abierto(nodo)).toBe(false);
  const fichero = new File(['grupo,valor\nA,1'], 'prueba.csv');
  await elegirArchivo(nodo, fichero);
  // El chip, con el nombre del archivo. Para resultados, el desplegable de
  // experimento solo lleva los de ESTA investigación.
  expect(nodo.querySelector('.adjuntos-chip')?.textContent).toContain('prueba.csv');
  const selector = nodo.querySelector<HTMLSelectElement>('.adjuntos-chip select');
  if (destino === 'dataset') expect(selector).toBeNull();
  else {
    expect([...selector!.options].map(o => o.value)).toEqual(['h-1']);
    await act(async () => { selector!.value = destino; selector!.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  await act(async () => nodo.querySelector<HTMLInputElement>('.adjuntos-chip input[type="checkbox"]')!.click());
  expect(subirDataset).not.toHaveBeenCalled();
  expect(subirDatosExperimento).not.toHaveBeenCalled();
  await act(async () => nodo.querySelector<HTMLButtonElement>('[data-accion="guardar"]')!.click());
  if (destino === 'dataset') expect(subirDataset).toHaveBeenCalledWith('inv-1', fichero, 'prueba.csv', '', true);
  else expect(subirDatosExperimento).toHaveBeenCalledWith('h-1', fichero, '', true);
  expect(alSubir).toHaveBeenCalledWith(expect.stringContaining('prueba.csv'));
  expect(alSubir).toHaveBeenCalledWith(expect.stringContaining('Acabo de subir'));
  expect(nodo.textContent).toContain('Archivo guardado');
  await act(async () => root.unmount());
});

it.each([['dataset', 'Upload a dataset'], ['h-1', 'Upload results']])('en inglés redacta el mensaje del adjunto %s sin cambiar sus identificadores', async (destino, rotulo) => {
  fijarIdioma('en');
  subirDataset.mockReset().mockResolvedValue(null);
  subirDatosExperimento.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const alSubir = vi.fn();
  await act(async () => root.render(<AdjuntosAsistente investigacionId="inv-1" alSubir={alSubir} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  await act(async () => fila(nodo, rotulo).click());
  await elegirArchivo(nodo, new File(['x\n1'], 'datos_MAPT.csv'));
  await act(async () => nodo.querySelector<HTMLButtonElement>('[data-accion="guardar"]')!.click());
  expect(alSubir.mock.calls[0]?.[0]).toContain('I just uploaded');
  expect(alSubir.mock.calls[0]?.[0]).toContain('datos_MAPT.csv');
  expect(alSubir.mock.calls[0]?.[0]).toContain('inv-1');
  expect(alSubir.mock.calls[0]?.[0]).not.toContain('Revisa');
  if (destino !== 'dataset') expect(alSubir.mock.calls[0]?.[0]).toContain('h-1');
  await act(async () => root.unmount());
});

it.each([['dataset', 'Subir un dataset'], ['h-otra', 'Subir resultados']])('desde global exige investigación y sube %s a la elegida', async (destino, rotulo) => {
  subirDataset.mockReset().mockResolvedValue(null);
  subirDatosExperimento.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const alSubir = vi.fn();
  await act(async () => root.render(<AdjuntosAsistente investigacionId="global" alSubir={alSubir} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  // Primero las investigaciones; todavía no hay acciones.
  expect(fila(nodo, 'Principal')).toBeTruthy();
  expect(fila(nodo, 'Subir un dataset')).toBeUndefined();
  await act(async () => fila(nodo, 'Otra investigación').click());
  expect(abierto(nodo)).toBe(true);
  await act(async () => fila(nodo, rotulo).click());
  const fichero = new File(['a,b\n1,2'], 'tabla.csv');
  await elegirArchivo(nodo, fichero);
  // Los experimentos del chip son los de la investigación ELEGIDA, no los de la otra.
  if (destino !== 'dataset') expect([...nodo.querySelector<HTMLSelectElement>('.adjuntos-chip select')!.options].map(o => o.value)).toEqual(['h-otra']);
  await act(async () => nodo.querySelector<HTMLButtonElement>('[data-accion="guardar"]')!.click());
  if (destino === 'dataset') expect(subirDataset).toHaveBeenCalledWith('otra', fichero, 'tabla.csv', '', false);
  else expect(subirDatosExperimento).toHaveBeenCalledWith('h-otra', fichero, '', false);
  expect(alSubir).toHaveBeenCalledWith(expect.stringContaining('otra'));
  await act(async () => root.unmount());
});

it('quitar el archivo del chip no sube nada y deja volver a empezar', async () => {
  subirDataset.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  await act(async () => root.render(<AdjuntosAsistente investigacionId="inv-1" alSubir={vi.fn()} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  await act(async () => fila(nodo, 'Subir un dataset').click());
  await elegirArchivo(nodo, new File(['x'], 'borrar.csv'));
  expect(nodo.querySelector('.adjuntos-chip')).toBeTruthy();
  await act(async () => nodo.querySelector<HTMLButtonElement>('.adjuntos-chip-quitar')!.click());
  expect(nodo.querySelector<HTMLInputElement>('input[type="file"]')!.value).toBe('');
  expect(subirDataset).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
