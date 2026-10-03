// @vitest-environment jsdom
// El menú «+» de adjuntar datos. Lo que se comprueba es lo mismo que antes
// del rediseño del 2 de octubre de 2026: que no se sube nada hasta pulsar
// guardar, que el destino y la marca de sintético llegan bien al endpoint, y
// que desde la vista global hay que elegir investigación primero. Lo que
// cambia es el camino: una fila del menú elige el destino y abre el selector
// de archivos; el archivo elegido sale en un chip, y ahí se guarda.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AdjuntosAsistente } from './AdjuntosAsistente';

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

it.each([['dataset', 'Dataset'], ['h-1', 'MAPT']])('adjunta %s solo al guardar y conserva la marca sintética', async (destino, rotulo) => {
  subirDataset.mockReset().mockResolvedValue(null);
  subirDatosExperimento.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const alSubir = vi.fn();
  await act(async () => root.render(<AdjuntosAsistente investigacionId="inv-1" alSubir={alSubir} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  // Solo los experimentos de ESTA investigación.
  expect(fila(nodo, 'Otra')).toBeUndefined();
  // Elegir la fila cierra el menú y deja el destino fijado.
  await act(async () => fila(nodo, rotulo).click());
  expect(abierto(nodo)).toBe(false);
  const fichero = new File(['grupo,valor\nA,1'], 'prueba.csv');
  await elegirArchivo(nodo, fichero);
  // El chip, con el nombre del archivo.
  expect(nodo.querySelector('.adjuntos-chip')?.textContent).toContain('prueba.csv');
  await act(async () => nodo.querySelector<HTMLInputElement>('.adjuntos-chip input[type="checkbox"]')!.click());
  expect(subirDataset).not.toHaveBeenCalled();
  expect(subirDatosExperimento).not.toHaveBeenCalled();
  await act(async () => nodo.querySelector<HTMLButtonElement>('[data-accion="guardar"]')!.click());
  if (destino === 'dataset') expect(subirDataset).toHaveBeenCalledWith('inv-1', fichero, 'prueba.csv', '', true);
  else expect(subirDatosExperimento).toHaveBeenCalledWith('h-1', fichero, '', true);
  expect(alSubir).toHaveBeenCalledWith(expect.stringContaining('prueba.csv'));
  expect(nodo.textContent).toContain('Archivo guardado');
  await act(async () => root.unmount());
});

it.each([['dataset', 'Dataset'], ['h-otra', 'Otra']])('desde global exige investigación y sube %s a la elegida', async (destino, rotulo) => {
  subirDataset.mockReset().mockResolvedValue(null);
  subirDatosExperimento.mockReset().mockResolvedValue(null);
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const alSubir = vi.fn();
  await act(async () => root.render(<AdjuntosAsistente investigacionId="global" alSubir={alSubir} />));
  await act(async () => nodo.querySelector<HTMLButtonElement>('.mundo-adjuntar')!.click());
  // Primero las investigaciones; todavía no hay destinos.
  expect(fila(nodo, 'Principal')).toBeTruthy();
  expect(fila(nodo, 'Dataset')).toBeUndefined();
  await act(async () => fila(nodo, 'Otra investigación').click());
  expect(abierto(nodo)).toBe(true);
  // Ahora los destinos de ESA investigación, y no los de la otra.
  expect(fila(nodo, 'MAPT')).toBeUndefined();
  await act(async () => fila(nodo, rotulo).click());
  const fichero = new File(['a,b\n1,2'], 'tabla.csv');
  await elegirArchivo(nodo, fichero);
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
  await act(async () => fila(nodo, 'Dataset').click());
  await elegirArchivo(nodo, new File(['x'], 'borrar.csv'));
  expect(nodo.querySelector('.adjuntos-chip')).toBeTruthy();
  await act(async () => nodo.querySelector<HTMLButtonElement>('.adjuntos-chip-quitar')!.click());
  expect(nodo.querySelector<HTMLInputElement>('input[type="file"]')!.value).toBe('');
  expect(subirDataset).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
