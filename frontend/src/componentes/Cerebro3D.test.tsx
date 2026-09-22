// @vitest-environment jsdom
// El visor del cerebro fuera del navegador: jsdom no tiene WebGL, así que
// aquí se prueba lo que pasa cuando no se puede dibujar y cuando no hay
// modelo, que es lo que una persona vería en un navegador sin tarjeta.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Cerebro3D, hayModeloCerebro } from './Cerebro3D';
import type { Atlas } from '../lib/atlas';

let nodo: HTMLDivElement;
let root: Root;
beforeEach(() => {
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});
/** Un atlas sin regiones: aquí solo importa cómo reacciona el visor, no la evidencia. */
const atlas = { regiones: [], maximo: 0, cohortesMax: 0, cohortesMin: 0, estadios: [], celulas: [], huecos: [], sinEjes: 0 } as unknown as Atlas;

describe('el visor del cerebro en tres dimensiones', () => {
  it('sabe que el modelo anatómico está instalado en esta copia', () => {
    expect(hayModeloCerebro()).toBe(true);
  });

  it('sin WebGL no se rompe: dice que este navegador no puede dibujarlo y manda a la vista 2D', async () => {
    await act(async () => root.render(<Cerebro3D atlas={atlas} seleccion={null} seleccionar={() => {}} />));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const aviso = nodo.querySelector('[role="status"]')?.textContent ?? '';
    expect(aviso).toContain('no puede dibujar el cerebro');
    expect(aviso).toContain('Vista 2D');
    expect(nodo.querySelector('canvas')).toBeNull();
  });

  it('sin modelo instalado lo dice en llano, en vez de quedarse en blanco', async () => {
    await act(async () => root.render(<Cerebro3D atlas={atlas} seleccion={null} seleccionar={() => {}} modelo={null} />));
    const aviso = nodo.querySelector('[role="status"]')?.textContent ?? '';
    expect(aviso).toContain('todavía no está instalado');
  });
});
