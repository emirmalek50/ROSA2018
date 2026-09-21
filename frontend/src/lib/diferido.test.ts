// @vitest-environment jsdom
// useCalculoDiferido: calculando en el primer render, el valor después del
// pintado, de nuevo calculando al cambiar las deps, y el error del cálculo
// llega al límite de errores. useEnVuelo: marca mientras la promesa no
// resuelve, ignora el clic repetido y desmarca aunque falle.
import { Component, StrictMode, act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo } from './diferido';

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.restoreAllMocks();
});
/** Deja pasar un frame y el temporizador que viene detrás (rAF en jsdom corre cada 16 ms). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('useCalculoDiferido', () => {
  const registro: string[] = [];
  function Pesado({ semilla, calcular }: { semilla: number; calcular: (s: number) => number }) {
    const { valor, calculando } = useCalculoDiferido(() => calcular(semilla), [semilla]);
    registro.push(`${calculando ? 'calculando' : 'listo'}:${valor ?? 'nulo'}`);
    return createElement('output', { 'data-calculando': String(calculando) }, valor === null ? 'esqueleto' : String(valor));
  }
  beforeEach(() => {
    registro.length = 0;
  });

  it('el primer render devuelve calculando sin haber calculado, y el valor llega después del pintado', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(Pesado, { semilla: 21, calcular })));
    expect(registro[0]).toBe('calculando:nulo');
    expect(nodo.textContent).toBe('esqueleto');
    expect(nodo.querySelector('output')?.getAttribute('data-calculando')).toBe('true');
    expect(calcular).not.toHaveBeenCalled();
    await esperarPintado();
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(nodo.textContent).toBe('42');
    expect(nodo.querySelector('output')?.getAttribute('data-calculando')).toBe('false');
  });

  it('al cambiar las deps vuelve a calculando en ese mismo render, conserva el valor viejo y luego trae el nuevo', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(Pesado, { semilla: 1, calcular })));
    await esperarPintado();
    expect(nodo.textContent).toBe('2');
    registro.length = 0;
    await act(async () => root.render(createElement(Pesado, { semilla: 5, calcular })));
    expect(registro[0]).toBe('calculando:2');
    expect(nodo.querySelector('output')?.getAttribute('data-calculando')).toBe('true');
    await esperarPintado();
    expect(nodo.textContent).toBe('10');
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('un render con las mismas deps no vuelve a calcular ni a marcar calculando', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(Pesado, { semilla: 3, calcular })));
    await esperarPintado();
    registro.length = 0;
    await act(async () => root.render(createElement(Pesado, { semilla: 3, calcular })));
    expect(registro).toEqual(['listo:6']);
    await esperarPintado();
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('si el componente se desmonta antes del pintado, el cálculo no se ejecuta', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(Pesado, { semilla: 7, calcular })));
    await act(async () => root.render(null));
    await esperarPintado();
    expect(calcular).not.toHaveBeenCalled();
  });

  it('si las deps cambian dos veces antes del pintado solo se calcula la última', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(Pesado, { semilla: 1, calcular })));
    await act(async () => root.render(createElement(Pesado, { semilla: 2, calcular })));
    await act(async () => root.render(createElement(Pesado, { semilla: 3, calcular })));
    await esperarPintado();
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(calcular).toHaveBeenLastCalledWith(3);
    expect(nodo.textContent).toBe('6');
  });

  it('un error del cálculo llega al límite de errores en vez de perderse en el temporizador', async () => {
    class Limite extends Component<{ children: ReactNode }, { error: string | null }> {
      state = { error: null as string | null };
      static getDerivedStateFromError(error: unknown) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      render() {
        return this.state.error ? createElement('p', { role: 'alert' }, this.state.error) : this.props.children;
      }
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calcular = vi.fn(() => {
      throw new Error('el árbol no se pudo construir');
    });
    await act(async () => root.render(createElement(Limite, null, createElement(Pesado, { semilla: 1, calcular }))));
    await esperarPintado();
    expect(nodo.querySelector('[role="alert"]')?.textContent).toBe('el árbol no se pudo construir');
  });

  it('en StrictMode, que monta y desmonta los efectos dos veces, calcula una sola vez', async () => {
    const calcular = vi.fn((s: number) => s * 2);
    await act(async () => root.render(createElement(StrictMode, null, createElement(Pesado, { semilla: 4, calcular }))));
    expect(nodo.textContent).toBe('esqueleto');
    await esperarPintado();
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(nodo.textContent).toBe('8');
  });

  it('sin requestAnimationFrame cae a setTimeout y sigue calculando después', async () => {
    const original = window.requestAnimationFrame;
    // @ts-expect-error se quita a propósito para probar el camino sin rAF
    window.requestAnimationFrame = undefined;
    try {
      const calcular = vi.fn((s: number) => s + 1);
      await act(async () => root.render(createElement(Pesado, { semilla: 9, calcular })));
      expect(nodo.textContent).toBe('esqueleto');
      await esperarPintado(30);
      expect(nodo.textContent).toBe('10');
    } finally {
      window.requestAnimationFrame = original;
    }
  });
});

describe('useEnVuelo', () => {
  function Boton({ accion }: { accion: () => Promise<unknown> | unknown }) {
    const [enVuelo, envolver] = useEnVuelo();
    // En JSX se escribe `onClick={envolver(accion)}`; aquí, sin JSX, el
    // literal de createElement no acepta esa firma y se tipa el manejador.
    const alPulsar: () => Promise<void> = envolver(accion);
    return createElement('button', { type: 'button', className: 'btn', ...atributosEnVuelo(enVuelo), onClick: alPulsar }, enVuelo ? 'Enviando' : 'Enviar');
  }
  function boton(): HTMLButtonElement {
    return nodo.querySelector('button') as HTMLButtonElement;
  }
  async function pulsar() {
    await act(async () => {
      boton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('marca en vuelo mientras la promesa no resuelve y desmarca al resolver', async () => {
    let resolver!: () => void;
    const accion = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    await act(async () => root.render(createElement(Boton, { accion })));
    expect(boton().hasAttribute('data-en-vuelo')).toBe(false);
    expect(boton().hasAttribute('aria-busy')).toBe(false);
    await pulsar();
    expect(boton().getAttribute('data-en-vuelo')).toBe('true');
    expect(boton().getAttribute('aria-busy')).toBe('true');
    expect(boton().textContent).toBe('Enviando');
    await act(async () => {
      resolver();
    });
    expect(boton().hasAttribute('data-en-vuelo')).toBe(false);
    expect(boton().hasAttribute('aria-busy')).toBe(false);
    expect(boton().textContent).toBe('Enviar');
  });

  it('ignora el clic repetido mientras hay algo en vuelo: la acción corre una sola vez', async () => {
    let resolver!: () => void;
    const accion = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    await act(async () => root.render(createElement(Boton, { accion })));
    await pulsar();
    await pulsar();
    await pulsar();
    expect(accion).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolver();
    });
    await pulsar();
    expect(accion).toHaveBeenCalledTimes(2);
  });

  it('desmarca también cuando la acción falla, y el fallo llega a quien envolvió', async () => {
    const accion = vi.fn(() => Promise.reject(new Error('sin servidor')));
    await act(async () => root.render(createElement(Boton, { accion })));
    let capturado: unknown = null;
    // Se llama al envoltorio directamente para poder observar el rechazo.
    function Directo() {
      const [enVuelo, envolver] = useEnVuelo();
      return createElement('button', { type: 'button', className: 'btn', ...atributosEnVuelo(enVuelo), onClick: () => void envolver(accion)().catch((e: unknown) => { capturado = e; }) }, enVuelo ? 'Enviando' : 'Enviar');
    }
    await act(async () => root.render(createElement(Directo)));
    await pulsar();
    await act(async () => {
      await Promise.resolve();
    });
    expect(accion).toHaveBeenCalledTimes(1);
    expect(capturado).toBeInstanceOf(Error);
    expect(boton().hasAttribute('data-en-vuelo')).toBe(false);
  });

  it('acepta acciones síncronas y pasa los argumentos', async () => {
    const recibido: unknown[] = [];
    function ConArgumentos() {
      const [enVuelo, envolver] = useEnVuelo();
      const guardar = envolver((id: string, n: number) => {
        recibido.push(id, n);
      });
      return createElement('button', { type: 'button', className: 'btn', ...atributosEnVuelo(enVuelo), onClick: () => void guardar('h1', 2) }, 'Enviar');
    }
    await act(async () => root.render(createElement(ConArgumentos)));
    await pulsar();
    expect(recibido).toEqual(['h1', 2]);
    expect(boton().hasAttribute('data-en-vuelo')).toBe(false);
  });

  it('no toca el estado si el componente se desmontó antes de que respondiera', async () => {
    let resolver!: () => void;
    const accion = vi.fn(() => new Promise<void>((r) => { resolver = r; }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.render(createElement(Boton, { accion })));
    await pulsar();
    await act(async () => root.render(null));
    await act(async () => {
      resolver();
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('atributosEnVuelo devuelve los atributos solo cuando hay algo en vuelo', () => {
    expect(atributosEnVuelo(true)).toEqual({ 'data-en-vuelo': 'true', 'aria-busy': true });
    expect(atributosEnVuelo(false)).toEqual({});
  });
});
