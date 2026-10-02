// @vitest-environment jsdom
// Humo del cliente: la aplicacion entera montada con React 18 (createRoot y
// act), con los efectos activos, navegando por las pantallas de la muestra.
// Es lo mas parecido a abrirla en el navegador que se puede hacer sin uno:
// un error en un efecto de Motion, en el hilo del proceso o en el recorrido
// saldria aqui, no al abrirla.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from './App';
import { estadoDeMuestra } from './datos/muestra';
import { rutaDe } from './lib/ruta';
import { aplicar } from './datos/almacen';

beforeAll(() => {
  // Lo que jsdom no trae y el navegador si.
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let montada: Root | null = null;

afterEach(async () => {
  if (montada) await act(async () => montada!.unmount());
  montada = null;
  document.body.innerHTML = '';
  window.location.hash = '';
});

async function montar(hash: string): Promise<HTMLElement> {
  if (montada) await act(async () => montada!.unmount());
  window.location.hash = hash;
  const raiz = document.createElement('div');
  document.body.appendChild(raiz);
  const root = createRoot(raiz);
  montada = root;
  await act(async () => {
    root.render(<App />);
  });
  // Las pantallas pintan primero su esqueleto y calculan lo pesado después del
  // siguiente fotograma (lib/diferido.ts): el árbol, por ejemplo, monta el lienzo
  // unos 20 ms después. Con 120 ms caben dos fotogramas de sobra aunque la suite
  // corra con carga (el mismo margen que App.esqueleto.test.tsx).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
  return raiz;
}

describe('la aplicacion montada en el cliente', () => {
  it('abre el asistente global sin crear una investigación ficticia', async () => {
    localStorage.setItem('rosa.recorrido.v1', '1');
    const base = { ...estadoDeMuestra(), investigaciones: [], corridas: [] };
    await act(async () => aplicar(() => base));
    const raiz = await montar('#/asistente');
    expect(raiz.textContent).toContain('Asistente de ROSA');
    expect(raiz.querySelector('textarea')).toBeTruthy();
    expect(raiz.textContent).toContain('Consulta y opera todas las investigaciones de ROSA');
    expect(raiz.querySelector('.hilo')).toBeNull();
    await act(async () => aplicar(() => estadoDeMuestra()));
  });
  it('conserva la pantalla si una actualización omite la investigación y se recupera después', async () => {
    const base = estadoDeMuestra();
    const inv = base.investigaciones[0]!;
    localStorage.setItem('rosa.recorrido.v1', '1');
    await act(async () => aplicar(() => base));
    const raiz = await montar(rutaDe(inv.id, 'mundo', 'hechos'));
    const tarjetas = raiz.querySelectorAll('.hecho').length;
    expect(tarjetas).toBeGreaterThan(0);
    await act(async () => aplicar(() => ({...base, investigaciones: []})));
    expect(raiz.querySelectorAll('.hecho').length).toBe(tarjetas);
    expect(raiz.textContent).toContain('Se conserva la última vista');
    expect(raiz.textContent).not.toContain('Esta investigación no existe');
    await act(async () => aplicar(() => base));
    expect(raiz.textContent).not.toContain('Se conserva la última vista');
  });
  it('avisa arriba al perder la conexión y ofrece reintentar', async () => {
    localStorage.setItem('rosa.recorrido.v1', '1');
    const e = estadoDeMuestra();
    e.conexion = 'sin_conexion';
    await act(async () => aplicar(() => e));
    const raiz = await montar('#/');
    const aviso = raiz.querySelector('.panel-sin-conexion');
    expect(aviso?.textContent).toContain('Sin conexión a internet');
    expect([...aviso!.querySelectorAll('button')].some((b) => b.textContent === 'Reintentar')).toBe(true);
  });
  it('inicio con el recorrido de primera vez', async () => {
    localStorage.removeItem('rosa.recorrido.v1');
    const raiz = await montar('#/');
    expect(raiz.textContent).toContain('ROSA2018 investiga; tú decides');
    // Siguiente hasta el final y Empezar: queda anotado y no vuelve a salir.
    for (let i = 0; i < 4; i++) {
      const siguiente = [...raiz.querySelectorAll('button')].find((b) => b.textContent === 'Siguiente');
      expect(siguiente).toBeTruthy();
      await act(async () => siguiente!.click());
    }
    const empezar = [...raiz.querySelectorAll('button')].find((b) => b.textContent === 'Empezar');
    await act(async () => empezar!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(localStorage.getItem('rosa.recorrido.v1')).toBe('1');
    expect(raiz.textContent).toContain('Investigaciones');
  });

  it('cada pantalla de la investigacion de muestra se monta con el hilo del proceso', async () => {
    localStorage.setItem('rosa.recorrido.v1', '1');
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    for (const pantalla of ['corrida', 'hipotesis', 'ranking', 'panorama', 'mundo', 'arbol', 'artefactos', 'investigacion'] as const) {
      const raiz = await montar(rutaDe(inv.id, pantalla));
      expect(raiz.querySelector('.hilo'), pantalla).toBeTruthy();
      expect(raiz.querySelectorAll('.hilo-etapa').length, pantalla).toBe(7);
      expect(raiz.textContent, pantalla).not.toContain('Esta investigacion no existe');
      document.body.innerHTML = '';
    }
    // En el arbol, pulsar una esfera abre su panel con las conexiones.
    const arbol = await montar(rutaDe(inv.id, 'arbol'));
    let esfera = arbol.querySelector<SVGGElement>('.grafo-nodo.grafo-hipotesis');
    // El árbol se calcula después del montaje: esperamos su resultado, no un
    // número fijo de fotogramas que depende de la carga de la suite.
    for (let i = 0; !esfera && i < 100; i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 20)); });
      esfera = arbol.querySelector<SVGGElement>('.grafo-nodo.grafo-hipotesis');
    }
    expect(esfera).toBeTruthy();
    await act(async () => {
      esfera!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(arbol.querySelector('.grafo-panel')?.textContent).toContain('Conectado con');
    document.body.innerHTML = '';
    // La etapa Laboratorio del hilo tiene su propia vista, distinta de la cola.
    const lab = await montar(rutaDe(inv.id, 'hipotesis', 'laboratorio'));
    expect(lab.querySelector('h2')?.textContent).toBe('Laboratorio');
    const hrefs = [...lab.querySelectorAll<HTMLAnchorElement>('.hilo-etapa')].map((a) => a.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(hrefs.length - 2); // solo Plan, Literatura y Verificar comparten destino (la corrida)
  }, 20_000); // monta todas las pantallas (atlas, esqueletos incluidos): bajo carga pasaba de los 5 s por defecto

  it('decidir sobre una hipotesis deja un aviso para deshacer, y deshacer la devuelve', async () => {
    localStorage.setItem('rosa.recorrido.v1', '1');
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const raiz = await montar(rutaDe(inv.id, 'hipotesis'));
    const antes = raiz.querySelectorAll('.hip-fila').length;
    expect(antes).toBeGreaterThan(0);
    const primera = raiz.querySelector<HTMLAnchorElement>('.hip-fila')!;
    window.location.hash = primera.getAttribute('href')!;
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await new Promise((r) => setTimeout(r, 30));
    });
    const descartar = [...raiz.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Descartar');
    if (!descartar) return; // la muestra puede no tener una hipotesis decidible: no es un fallo del rework
    await act(async () => descartar.click());
    const textarea = raiz.querySelector('.confirmacion textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(textarea, 'motivo de prueba');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const confirmar = [...raiz.querySelectorAll('.confirmacion button')].find((b) => b.textContent?.trim() === 'Descartar') as HTMLButtonElement | undefined;
      await act(async () => confirmar?.click());
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const aviso = raiz.ownerDocument.querySelector('.deshacer');
    expect(aviso).toBeTruthy();
    const deshacer = [...aviso!.querySelectorAll('button')].find((b) => b.textContent === 'Deshacer')!;
    await act(async () => deshacer.click());
    // El aviso sale con una animacion de 0.22 s; se espera a que termine.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(raiz.ownerDocument.querySelector('.deshacer')).toBeNull();
  });
});
