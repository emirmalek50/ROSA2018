// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Resumen } from './Resumen';
import type { Digest } from '../lib/digest';
import { fijarIdioma } from '../lib/idioma';

const pedir = vi.fn();
vi.mock('../datos/almacen', () => ({ acciones: { traducirTextos: (...args: unknown[]) => pedir(...args) } }));
let nodo: HTMLDivElement, root: Root;
const escribir = vi.fn();
const resumen = (linea: string): Digest => ({ desde: null, ventanaDesde: 0, eventos: [], iteraciones: 1,
  hipotesisNuevas: 0, decisiones: 0, incidencias: 0, esperan: { total: 0, masAntiguaMs: 0 }, lineas: [linea], hayNovedades: true });
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
  pedir.mockReset(); escribir.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: escribir } });
  fijarIdioma('en');
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); });
async function montar(d: Digest) {
  await act(async () => root.render(<Resumen d={d} titulo="MAPT" ahora={1} onVisto={() => {}} />));
}
it('traduce el resumen para copiar, conserva sus datos y deja el original intacto', async () => {
  const d = resumen('El análisis de MAPT incluyó 12 cohortes.');
  const original = JSON.stringify(d);
  pedir.mockResolvedValue({ 'ROSA2018 · MAPT': 'ROSA2018 · MAPT', '- El análisis de MAPT incluyó 12 cohortes.': '- The MAPT analysis included 12 cohorts.' });
  await montar(d);
  await act(async () => nodo.querySelector('button')!.click());
  expect(escribir).toHaveBeenCalledWith('ROSA2018 · MAPT\n- The MAPT analysis included 12 cohorts.');
  expect(nodo.querySelector('button')?.textContent).toContain('Copied');
  expect(JSON.stringify(d)).toBe(original);
});
it('si falta una traducción no copia una mezcla ni dice que se copió', async () => {
  pedir.mockResolvedValue({ 'ROSA2018 · MAPT': 'ROSA2018 · MAPT' });
  await montar(resumen('La nueva cohorte de MAPT tiene 37 muestras.'));
  await act(async () => nodo.querySelector('button')!.click());
  expect(escribir).not.toHaveBeenCalled();
  expect(nodo.querySelector('[role="alert"]')?.textContent).toContain('could not be translated');
  expect(nodo.querySelector('button')?.textContent).not.toContain('Copied');
});
it('rechaza una traducción que cambia el tamaño de la cohorte', async () => {
  pedir.mockResolvedValue({ 'ROSA2018 · MAPT': 'ROSA2018 · MAPT', '- Se incluyeron 43 muestras de MAPT.': '- 44 MAPT samples were included.' });
  await montar(resumen('Se incluyeron 43 muestras de MAPT.'));
  await act(async () => nodo.querySelector('button')!.click());
  expect(escribir).not.toHaveBeenCalled();
  expect(nodo.querySelector('[role="alert"]')).not.toBeNull();
});
it('descarta una traducción tardía al cambiar a español', async () => {
  let resolver!: (v: Record<string, string>) => void;
  pedir.mockImplementation(() => new Promise(r => { resolver = r; }));
  const d = resumen('Se revisaron 19 cohortes de MAPT.');
  await montar(d);
  await act(async () => nodo.querySelector('button')!.click());
  expect(nodo.querySelector('button')?.disabled).toBe(true);
  await act(async () => fijarIdioma('es'));
  await act(async () => resolver({ 'ROSA2018 · MAPT': 'ROSA2018 · MAPT', '- Se revisaron 19 cohortes de MAPT.': '- 19 MAPT cohorts were reviewed.' }));
  expect(escribir).not.toHaveBeenCalled();
  await act(async () => nodo.querySelector('button')!.click());
  expect(escribir).toHaveBeenCalledWith('ROSA2018 · MAPT\n- Se revisaron 19 cohortes de MAPT.');
});
