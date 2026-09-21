// @vitest-environment jsdom
// Los controles de GEPA en Calidad: el botón que se pulsa vuela (data-en-vuelo
// y aria-busy) hasta que el servidor responde, los demás solo quedan
// bloqueados, un segundo clic no manda otra petición, y al responder el botón
// aterriza y el aviso sale como siempre.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import { Calidad } from './Calidad';
import { fijarModo } from '../lib/modo';

afterEach(() => vi.unstubAllGlobals());

it('el botón de GEPA pulsado vuela hasta que el servidor responde; los otros solo quedan bloqueados', async () => {
  fijarModo('detalle');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const estado = estadoDeMuestra();
  estado.gepa = [];
  // Con datos de muestra los controles no se enseñan (no hay servidor que controlar): la prueba simula estar en línea.
  estado.conexion = 'en_linea';
  let responder!: (r: { ok: boolean; status?: number }) => void;
  const fetch = vi.fn(
    () =>
      new Promise<{ ok: boolean; status?: number }>((r) => {
        responder = r;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const contenedor = document.createElement('div');
  const root = createRoot(contenedor);
  try {
    await act(async () => root.render(<Calidad inv={estado.investigaciones[0]!} estado={estado} ahora={Date.now()} />));
    const botones = [...contenedor.querySelectorAll('button')];
    const pausar = botones.find((b) => b.textContent === 'Pausar promociones')!;
    const reanudar = botones.find((b) => b.textContent === 'Reanudar')!;
    expect(pausar).toBeDefined();
    expect(reanudar).toBeDefined();
    expect(pausar.hasAttribute('data-en-vuelo')).toBe(false);
    // Son botones de la maqueta (.btn): así el CSS les puede pintar el spinner.
    expect(pausar.classList.contains('btn')).toBe(true);

    await act(async () => pausar.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pausar.getAttribute('data-en-vuelo')).toBe('true');
    expect(pausar.getAttribute('aria-busy')).toBe('true');
    expect(pausar.disabled).toBe(true);
    expect(reanudar.disabled).toBe(true);
    expect(reanudar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(reanudar.hasAttribute('aria-busy')).toBe(false);

    // Un segundo clic mientras vuela no manda nada.
    await act(async () => pausar.click());
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => responder({ ok: true }));
    expect(pausar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(pausar.hasAttribute('aria-busy')).toBe(false);
    expect(pausar.disabled).toBe(false);
    expect(reanudar.disabled).toBe(false);
    expect(contenedor.textContent).toContain('Cambio confirmado');

    // Un fallo también aterriza el botón, y el aviso sigue siendo el de siempre.
    await act(async () => reanudar.click());
    expect(reanudar.getAttribute('data-en-vuelo')).toBe('true');
    expect(pausar.hasAttribute('data-en-vuelo')).toBe(false);
    await act(async () => responder({ ok: false, status: 403 }));
    expect(reanudar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(contenedor.textContent).toContain('Solo administración');
  } finally {
    await act(async () => root.unmount());
    fijarModo('sencillo');
  }
});
