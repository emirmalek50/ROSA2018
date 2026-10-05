// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Desplegable } from './Desplegable';
import { Seccion } from './piezas';

const preferencia = vi.hoisted(() => ({ reducida: false }));
vi.mock('../lib/movimiento', async (original) => ({
  ...await original<typeof import('../lib/movimiento')>(),
  useMovimientoReducido: () => preferencia.reducida,
}));

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  preferencia.reducida = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('scrollTo', vi.fn());
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.unstubAllGlobals();
});

async function montar(jsx: JSX.Element) {
  await act(async () => root.render(jsx));
}

describe('Desplegables sin acciones ocultas ni montajes anticipados', () => {
  it('no monta componentes ni dispara sus efectos mientras están cerrados', async () => {
    const efecto = vi.fn();
    function Datos() { useEffect(efecto, []); return <button>Consultar</button>; }
    await montar(<Desplegable abierto={false}><Datos /></Desplegable>);
    expect(nodo.textContent).toBe('');
    expect(efecto).not.toHaveBeenCalled();
    await montar(<Desplegable abierto><Datos /></Desplegable>);
    expect(efecto).toHaveBeenCalledTimes(1);
  });

  it('al cerrar desactiva el contenido inmediatamente y después lo desmonta', async () => {
    const contenido = <button>Aplicar cambio</button>;
    await montar(<Desplegable abierto>{contenido}</Desplegable>);
    expect(nodo.querySelector('[inert]')).toBeNull();
    await montar(<Desplegable abierto={false}>{contenido}</Desplegable>);
    expect(nodo.querySelector('.desplegable')?.getAttribute('aria-hidden')).toBe('true');
    expect(nodo.querySelector('.desplegable')?.hasAttribute('inert')).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(nodo.querySelector('button')).toBeNull();
  });

  it('reabrir durante el cierre conserva una sola copia y vuelve a habilitarla', async () => {
    const contenido = <input defaultValue="Criterio escrito" />;
    await montar(<Desplegable abierto>{contenido}</Desplegable>);
    const entrada = nodo.querySelector('input')!;
    entrada.value = 'Sin perder el borrador';
    await montar(<Desplegable abierto={false}>{contenido}</Desplegable>);
    await montar(<Desplegable abierto>{contenido}</Desplegable>);
    expect(nodo.querySelectorAll('input')).toHaveLength(1);
    expect(nodo.querySelector('input')?.value).toBe('Sin perder el borrador');
    expect(nodo.querySelector('[inert], [aria-hidden="true"]')).toBeNull();
  });

  it('una actualización de datos no reinicia el formulario abierto', async () => {
    const pintar = (texto: string) => <Desplegable abierto><p>{texto}</p><input defaultValue="" /></Desplegable>;
    await montar(pintar('Antes'));
    nodo.querySelector('input')!.value = 'Borrador';
    await montar(pintar('Después'));
    expect(nodo.textContent).toBe('Después');
    expect(nodo.querySelector('input')!.value).toBe('Borrador');
  });

  it('con movimiento reducido aparece completo y se cierra sin espera', async () => {
    preferencia.reducida = true;
    await montar(<Desplegable abierto id="prueba"><button>Consultar</button></Desplegable>);
    expect(nodo.querySelector('#prueba')?.getAttribute('style')).toBeNull();
    await montar(<Desplegable abierto={false}><button>Consultar</button></Desplegable>);
    expect(nodo.childElementCount).toBe(0);
  });

  it('enlaza el botón con su sección y permite abrir y cerrar con el estado correcto', async () => {
    preferencia.reducida = true;
    await montar(<Seccion titulo="Métodos" plegable abierta={false} resumen="Ver métodos"><button>Ejecutar</button></Seccion>);
    const boton = nodo.querySelector<HTMLButtonElement>('.seccion-plegar')!;
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(nodo.textContent).toContain('Ver métodos');
    expect(nodo.textContent).not.toContain('Ejecutar');
    await act(async () => boton.click());
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(boton.getAttribute('aria-controls')!)?.textContent).toBe('Ejecutar');
    await act(async () => boton.click());
    expect(nodo.textContent).not.toContain('Ejecutar');
  });

  it('no añade envoltorios a las secciones que no se pliegan', async () => {
    await montar(<Seccion titulo="Resultados"><table className="tabla"><tbody><tr><td>Resultado</td></tr></tbody></table></Seccion>);
    expect(nodo.querySelector('.seccion > .tabla')).not.toBeNull();
    expect(nodo.querySelector('.desplegable')).toBeNull();
    await montar(<Seccion titulo="Resultados" abierta={false}><p>Oculto por contrato</p></Seccion>);
    expect(nodo.textContent).not.toContain('Oculto por contrato');
  });
});
