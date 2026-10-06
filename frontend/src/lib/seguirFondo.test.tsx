// @vitest-environment jsdom
// El chat que sigue el fondo. Dos capas: el gancho (con una ventana de
// mentira, sin muelle) y el muelle de verdad sobre la ventana de jsdom, que
// es donde vivían los fallos de la revisión del 6 de octubre de 2026: la
// bajada que seguía tras desmontar, la persona que no podía escapar del
// autoscroll, y una tecla en el cuadro de escribir que paraba la bajada.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEGADO_PX, QUIETO_S, VUELTA_PX, distanciaAlFondo, useSeguirFondo, ventana, type Lector } from './seguirFondo';

// Una ventana de mentira: alto del documento, posición y tamaño de la vista.
// `ocupada` imita al muelle: mientras es cierto, los scrolls son nuestros.
function lectorFalso(alto: number, arriba: number, vent = 700) {
  const l = {
    estado: { alto, arriba, ventana: vent },
    ocupada: false,
    bajadas: [] as number[],
    paradas: 0,
    alto: () => l.estado.alto,
    arriba: () => l.estado.arriba,
    ventana: () => l.estado.ventana,
    bajar: (top: number) => {
      l.bajadas.push(top);
      l.estado.arriba = top - l.estado.ventana;
    },
    ocupado: () => l.ocupada,
    parar: () => {
      l.paradas += 1;
      l.ocupada = false;
    },
  };
  return l;
}

function Chat({ contenido, forzar, l, activo = true }: { contenido: number; forzar: number; l: Lector; activo?: boolean }) {
  useSeguirFondo(contenido, forzar, activo, l);
  return <div>{contenido}</div>;
}

let nodo: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(() => {
  act(() => root.unmount());
  nodo.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const scroll = () => window.dispatchEvent(new Event('scroll'));

describe('el chat sigue el fondo', () => {
  it('pegado al fondo, cada contenido nuevo baja', async () => {
    const l = lectorFalso(1000, 300); // 1000 - 300 - 700 = 0: pegado
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    l.estado.alto = 1400; // entra un paso nuevo
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)).toBe(1400);
    l.estado.alto = 2600; // y la respuesta entera
    await act(async () => root.render(<Chat contenido={3} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)).toBe(2600);
  });

  it('si la persona subió a leer, NO se la arranca de ahí', async () => {
    const l = lectorFalso(3000, 2300); // pegado al inicio
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    const antes = l.bajadas.length;
    l.estado.arriba = 1400; // sube 900 px
    scroll();
    expect(distanciaAlFondo(l)).toBeGreaterThan(PEGADO_PX);
    l.estado.alto = 3600; // llega contenido
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    expect(l.bajadas.length).toBe(antes); // y no se baja
  });

  it('cuando la persona manda un mensaje se baja siempre, esté donde esté', async () => {
    const l = lectorFalso(3000, 0); // arriba del todo, leyendo
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    scroll();
    l.estado.alto = 3300;
    await act(async () => root.render(<Chat contenido={2} forzar={1} l={l} />));
    expect(l.bajadas.at(-1)).toBe(3300);
  });

  it('el scroll de NUESTRA bajada no cuenta como que la persona subió', async () => {
    const l = lectorFalso(1000, 300);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    l.estado.alto = 5000;
    l.ocupada = true; // el muelle está bajando
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={l} />));
    // A mitad de la bajada la distancia es grande: ese scroll es nuestro.
    l.estado.arriba = 1000;
    scroll();
    l.ocupada = false;
    l.estado.arriba = 4300;
    l.estado.alto = 5400;
    await act(async () => root.render(<Chat contenido={3} forzar={0} l={l} />));
    expect(l.bajadas.at(-1)).toBe(5400);
  });

  it('al desmontar, o al apagarlo, para la bajada en curso', async () => {
    const l = lectorFalso(1000, 300);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    expect(l.paradas).toBe(0);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} activo={false} />));
    expect(l.paradas).toBe(1);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={l} />));
    act(() => root.unmount());
    expect(l.paradas).toBe(2);
  });
});

/** La ventana de jsdom, con medidas: el documento mide `alto`, la vista
 *  768 px (jsdom), y `scrollTo` mueve el scroll de verdad. */
function ventanaMedida(alto: number) {
  const html = document.documentElement;
  const m = { alto, top: 0 };
  Object.defineProperty(document, 'scrollingElement', { value: html, configurable: true });
  Object.defineProperty(html, 'scrollHeight', { get: () => m.alto, configurable: true });
  Object.defineProperty(html, 'scrollTop', { get: () => m.top, set: (v: number) => { m.top = v; }, configurable: true });
  vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
    const a = args[0];
    m.top = typeof a === 'number' ? (args[1] as number) : ((a as ScrollToOptions)?.top ?? m.top);
    window.dispatchEvent(new Event('scroll'));
  });
  return m;
}

describe('el muelle que baja la ventana', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  const cuadros = (n: number) => { for (let i = 0; i < n; i++) vi.advanceTimersByTime(16); };

  it('baja hasta el fondo sin pasarse, sigue al fondo si crece, y para cuando lleva un rato quieto', async () => {
    const m = ventanaMedida(2000);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={ventana} />));
    expect(ventana.ocupado?.()).toBe(true);
    // Nunca se pasa del fondo, y en segundo y medio está clavado en él.
    const tope = () => m.alto - 768;
    for (let i = 0; i < 90; i++) {
      cuadros(1);
      expect(m.top).toBeLessThanOrEqual(tope() + 0.01);
    }
    expect(m.top).toBe(tope());
    // El fondo se aleja (ROSA2018 sigue escribiendo): lo persigue sin cortar.
    m.alto = 2600;
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={ventana} />));
    expect(ventana.ocupado?.()).toBe(true);
    cuadros(90);
    expect(m.top).toBe(tope());
    // Quieto en el fondo QUIETO_S, termina solo.
    cuadros(Math.ceil((QUIETO_S * 1000) / 16) + 2);
    expect(ventana.ocupado?.()).toBe(false);
  });

  it('la rueda hacia arriba para el muelle y la persona deja de estar pegada hasta volver al fondo', async () => {
    const m = ventanaMedida(3000);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={ventana} />));
    cuadros(10);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(ventana.ocupado?.()).toBe(false);
    const donde = m.top;
    cuadros(30);
    expect(m.top).toBe(donde); // no se movió más
    // Ella sube un poco (menos de PEGADO_PX del fondo) y llega contenido: NO
    // se la arrastra, porque tomó el mando.
    m.top = m.alto - 768 - 100;
    scroll();
    m.alto = 3400;
    await act(async () => root.render(<Chat contenido={2} forzar={0} l={ventana} />));
    expect(ventana.ocupado?.()).toBe(false);
    // Vuelve al fondo de verdad: desde ahí se la sigue otra vez.
    m.top = m.alto - 768 - (VUELTA_PX - 1);
    scroll();
    m.alto = 3800;
    await act(async () => root.render(<Chat contenido={3} forzar={0} l={ventana} />));
    expect(ventana.ocupado?.()).toBe(true);
  });

  it('una flecha en el cuadro de escribir o un clic en un botón no paran la bajada; la barra arrastrada hacia arriba, sí', async () => {
    const m = ventanaMedida(3000);
    const caja = document.createElement('textarea');
    const boton = document.createElement('button');
    document.body.append(caja, boton);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={ventana} />));
    cuadros(5);
    caja.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    boton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ventana.ocupado?.()).toBe(true);
    // La barra de desplazamiento: el ratón cae sobre la propia página.
    document.documentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ventana.ocupado?.()).toBe(false);
    caja.remove();
    boton.remove();
    // Y un scroll ajeno hacia arriba a mitad de bajada también la para.
    await act(async () => root.render(<Chat contenido={2} forzar={1} l={ventana} />));
    cuadros(5);
    expect(ventana.ocupado?.()).toBe(true);
    m.top = Math.max(0, m.top - 200);
    cuadros(1);
    expect(ventana.ocupado?.()).toBe(false);
  });

  it('al cambiar de pantalla la bajada no sigue en la pantalla nueva', async () => {
    ventanaMedida(5000);
    await act(async () => root.render(<Chat contenido={1} forzar={0} l={ventana} />));
    cuadros(3);
    expect(ventana.ocupado?.()).toBe(true);
    act(() => root.unmount());
    root = createRoot(nodo);
    expect(ventana.ocupado?.()).toBe(false);
    const antes = (window.scrollTo as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    cuadros(30);
    expect((window.scrollTo as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(antes);
  });
});
