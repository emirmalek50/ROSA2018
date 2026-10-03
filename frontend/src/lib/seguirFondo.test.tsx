// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PEGADO_PX, distanciaAlFondo, useSeguirFondo } from './seguirFondo';

// Una ventana de mentira: alto del documento, posición y tamaño de la vista.
function lectorFalso(alto: number, arriba: number, ventana = 700) {
  const l = {
    estado: { alto, arriba, ventana },
    bajadas: [] as { top: number; suave: boolean }[],
    alto: () => l.estado.alto,
    arriba: () => l.estado.arriba,
    ventana: () => l.estado.ventana,
    bajar: (top: number, suave: boolean) => { l.bajadas.push({ top, suave }); l.estado.arriba = top - l.estado.ventana; },
  };
  return l;
}

function Chat({ contenido, forzar, l }: { contenido: number; forzar: number; l: ReturnType<typeof lectorFalso> }) {
  useSeguirFondo(contenido, forzar, true, l);
  return <div>{contenido}</div>;
}

let nodo: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo); });
afterEach(() => { act(() => root.unmount()); nodo.remove(); });

describe('el chat sigue el fondo', () => {
  it('pegado al fondo, cada contenido nuevo baja (suave)', async () => {
    const l = lectorFalso(1000, 300);           // 1000 - 300 - 700 = 0: pegado
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    l.estado.alto = 1400;                       // entra un paso nuevo
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)).toEqual({ top: 1400, suave: true });
    l.estado.alto = 2600;                       // y la respuesta entera
    await act(async () => root.render(<Chat contenido={3} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)).toEqual({ top: 2600, suave: true });
  });

  it('si la persona subió a leer, NO se la arranca de ahí', async () => {
    const l = lectorFalso(3000, 2300);          // pegado al inicio
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    const antes = l.bajadas.length;
    // Sube 900 px y pasa el tiempo de nuestra bajada.
    l.estado.arriba = 1400;
    await new Promise((r) => setTimeout(r, 650));
    window.dispatchEvent(new Event('scroll'));
    expect(distanciaAlFondo(l)).toBeGreaterThan(PEGADO_PX);
    l.estado.alto = 3600;                       // llega contenido
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    expect(l.bajadas.length).toBe(antes);       // y no se baja
  });

  it('cuando la persona manda un mensaje se baja siempre, esté donde esté, y de golpe', async () => {
    const l = lectorFalso(3000, 0);             // arriba del todo, leyendo
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    await new Promise((r) => setTimeout(r, 650));
    window.dispatchEvent(new Event('scroll'));
    l.estado.alto = 3300;
    await act(async () => root.render(<Chat contenido={2} forzar={1} l={l} />));
    expect(l.bajadas.at(-1)).toEqual({ top: 3300, suave: false });
  });

  it('el scroll de NUESTRA bajada suave no cuenta como que la persona subió', async () => {
    const l = lectorFalso(1000, 300);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    l.estado.alto = 5000;
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    // A mitad de la bajada suave, la distancia es grande: un scroll ahora
    // no debe marcar «subió».
    l.estado.arriba = 1000;
    window.dispatchEvent(new Event('scroll'));
    l.estado.arriba = 4300; l.estado.alto = 5400;
    await act(async () => root.render(<Chat contenido={3} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)?.top).toBe(5400);
  });
});
