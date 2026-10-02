// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccionesAsistente } from './AccionesAsistente';
const resolver = vi.fn();
vi.mock('../datos/almacen', () => ({ acciones: { resolverAccionAsistente: (...args: unknown[]) => resolver(...args) } }));
it('presenta el cambio y solo lo aplica al pulsar, mostrando el resultado real', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  resolver.mockResolvedValue({ ok: true, estado: 'ejecutada', resultado: 'cor-nueva' });
  await act(async () => root.render(<AccionesAsistente investigacionId="inv-1" preguntaId="pb-1" operaciones={[{ id: 'op-1', nombre: 'iniciarCorrida', argumentos: { investigacion_id: 'inv-2' }, resumen: 'Iniciar la investigación sobre MAPT', estado: 'pendiente' }]} />));
  expect(resolver).not.toHaveBeenCalled();
  expect(nodo.textContent).toContain('inv-2');
  await act(async () => nodo.querySelector('button')!.click());
  expect(resolver).toHaveBeenCalledWith('inv-1', 'pb-1', 'op-1', true, undefined);
  expect(nodo.textContent).toContain('Cambio aplicado en ROSA');
  expect(nodo.textContent).toContain('cor-nueva');
  expect(nodo.querySelector('button')).toBeNull();
  await act(async () => root.unmount());
});
it('comprueba una operación interrumpida sin volver a aprobarla', async () => {
  resolver.mockClear();
  resolver.mockResolvedValue({ ok: true, estado: 'resultado_desconocido', resultado: { estadoActualCoincide: true } });
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const operaciones = [{ id: 'op-2', nombre: 'servicio:sellar', argumentos: {}, resumen: 'Sello', estado: 'resultado_desconocido' as const }];
  await act(async () => root.render(<AccionesAsistente investigacionId="global" preguntaId="pb-2" operaciones={operaciones} />));
  expect(resolver).toHaveBeenCalledTimes(1);
  expect(resolver).toHaveBeenCalledWith('global', 'pb-2', 'op-2', false, 'comprobar');
  await act(async () => root.render(<AccionesAsistente investigacionId="global" preguntaId="pb-2" operaciones={[...operaciones]} />));
  expect(resolver).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it('reintenta el razonamiento sin repetir la operación aplicada', async () => {
  resolver.mockClear();
  resolver.mockResolvedValue({ ok: true });
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  await act(async () => root.render(<AccionesAsistente investigacionId="global" preguntaId="pb-3" operaciones={[{ id: 'op-3', nombre: 'iniciarCorrida', argumentos: {}, resumen: 'Corrida', estado: 'ejecutada', continuacion: 'error' }]} />));
  expect(resolver).not.toHaveBeenCalled();
  await act(async () => nodo.querySelector('button')!.click());
  expect(resolver).toHaveBeenCalledWith('global', 'pb-3', 'op-3', false, 'continuar');
  await act(async () => root.unmount());
});
