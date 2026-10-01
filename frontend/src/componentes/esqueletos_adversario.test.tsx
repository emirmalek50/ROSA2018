// @vitest-environment jsdom
// Adversario de los esqueletos de carga (19 de septiembre de 2026). Cada test
// de este fichero reproduce un fallo encontrado al intentar romper el
// estándar de Emir (bloques con la silueta y el tamaño del contenido, botón en
// vuelo sin duplicar el envío, ninguna espera fingida). Fallan HOY a propósito:
// son la especificación de lo que hay que reparar y se ponen en verde con el
// arreglo, no al revés. Las medidas en píxeles que se citan salen de Chromium
// (Playwright sobre la compilación de trabajo, scratchpad/esq_resultados.json);
// aquí, en jsdom, se comprueba la causa estructural de cada una.
//
// No se usa vi.mock del almacén: se monta con el almacén real en modo muestra
// (sin red) y se espía, para que las acciones devuelvan exactamente lo que
// devuelven en la aplicación de verdad.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { acciones, aplicar } from '../datos/almacen';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa } from '../datos/tipos';
import { rutaDe } from '../lib/ruta';
import { Hipotesis } from '../pantallas/Hipotesis';
import { Investigacion } from '../pantallas/Investigacion';
import { Ranking } from '../pantallas/Ranking';
import { Correo } from './Correo';

beforeAll(() => {
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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  localStorage.setItem('rosa.recorrido.v1', '1');
  window.location.hash = '';
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Deja pasar el fotograma (rAF de jsdom, 16 ms) y el temporizador que viene detrás, varias veces. */
async function esperarPintado(veces = 2, ms = 60) {
  for (let i = 0; i < veces; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
}
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
const pulsar = (b: HTMLButtonElement) => act(async () => b.click());

describe('botones en vuelo con las acciones reales del almacén', () => {
  it('las acciones que envuelven los botones devuelven su promesa (hoy enviar() es fuego y olvido y devuelven undefined)', () => {
    // Con ids inexistentes el reducer no toca nada y, en modo muestra, no hay red.
    // Sin promesa, useEnVuelo apaga la marca en el mismo tick: en la aplicación
    // real ningún botón que pase por enviar() enseña el estado en vuelo.
    const devueltos = {
      generarDossier: acciones.generarDossier('hip-no-existe'),
      pausarCorrida: acciones.pausarCorrida('cor-no-existe'),
      aprobarPlan: acciones.aprobarPlan('it-no-existe'),
      solicitarRevision: acciones.solicitarRevision('hip-no-existe'),
    } as Record<string, unknown>;
    const sinPromesa = Object.entries(devueltos)
      .filter(([, v]) => !(v instanceof Promise))
      .map(([k]) => k);
    expect(sinPromesa, `acciones sin promesa: ${sinPromesa.join(', ')}`).toEqual([]);
  });

  it('dos clics en "Generar dossier" mandan un solo generarDossier y el botón queda en vuelo (hoy: dos envíos y sin marca)', async () => {
    const generar = vi.spyOn(acciones, 'generarDossier');
    const e: EstadoRosa = { ...estadoDeMuestra(), conexion: 'en_linea' };
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Hipotesis inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId="hip-1" cajonAbierto={false} setCajonAbierto={() => undefined} />));
    await esperarPintado();
    const b = boton('Generar dossier');
    expect(b).toBeDefined();
    expect(b!.disabled).toBe(false);
    await pulsar(b!);
    // En Chromium, con la acción real, dos clics más Enter mandaron tres POST /api/acciones/generarDossier
    // (scratchpad/esq_resultados.json, botones.generarDossier.posts = 3): el servidor guarda un dossier por cada uno.
    expect(b!.getAttribute('data-en-vuelo'), 'el botón debería estar en vuelo tras el primer clic').toBe('true');
    await pulsar(b!);
    expect(generar).toHaveBeenCalledTimes(1);
  });
});

describe('la silueta del árbol desde App', () => {
  // Este es el único test del fichero que pasa hoy: la compilación medida en
  // Chromium (App.tsx anterior a las 22:33) pintaba la figura genérica de App
  // (465 px, cabecera 43) y un fotograma después la silueta propia del árbol
  // (1147 px, cabecera 383); App.tsx ya usa EsqueletoArbol y el salto no está.
  // Queda como guarda: App.esqueleto.test.tsx compara solo el rótulo oculto,
  // que era el mismo en las dos siluetas, y no lo habría detectado.
  it('al ir al árbol se ve UNA silueta, la propia del árbol, no la figura genérica de App seguida de la del árbol', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => aplicar(() => e));
    window.location.hash = rutaDe(inv.id, 'investigacion');
    await act(async () => root.render(<App />));
    await esperarPintado(3, 40);
    // Anota, tras cada commit, la forma de la silueta visible (sus clases y si trae el marco del grafo).
    const formas: string[] = [];
    const anotar = () => {
      const s = nodo.querySelector('[role="status"][aria-busy="true"]');
      const forma = s ? `${s.className.replace(/\s+/g, ' ').trim()} | marco del grafo: ${s.querySelector('.grafo-marco') !== null}` : 'sin silueta';
      if (formas[formas.length - 1] !== forma) formas.push(forma);
    };
    const observador = new MutationObserver(anotar);
    observador.observe(nodo, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-busy'] });
    await act(async () => {
      window.location.hash = rutaDe(inv.id, 'arbol');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await esperarPintado(5, 40);
    observador.disconnect();
    const siluetas = formas.filter((f) => f !== 'sin silueta');
    expect(nodo.querySelector('.grafo-marco'), 'el árbol tiene que haber llegado').not.toBeNull();
    // App.esqueleto.test.tsx solo compara el rótulo oculto, que es el mismo en las dos; por eso no ve el salto.
    expect(siluetas, `siluetas distintas vistas en orden:\n  ${siluetas.join('\n  ')}`).toHaveLength(1);
    expect(siluetas[0]).toContain('marco del grafo: true');
  });
});

describe('el tamaño de la silueta de pantalla frente al contenido', () => {
  it('la cabecera de EsqueletoPantalla lleva el mismo margen superior que la cabecera real (16 px) para no saltar', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Ranking inv={inv} estado={e} detalleId="lista" irA={() => undefined} />));
    const cabEsqueleto = nodo.querySelector('.esqueleto-pantalla .pantalla-cabecera') as HTMLElement | null;
    expect(cabEsqueleto).not.toBeNull();
    await esperarPintado();
    const cabReal = nodo.querySelector('.contenido .pantalla-cabecera') as HTMLElement | null;
    expect(cabReal).not.toBeNull();
    expect(nodo.querySelector('.esqueleto-pantalla')).toBeNull();
    // Medido en Chromium: la cabecera del esqueleto mide 43 px sin margen; la real, 118 px (ranking), 75 (cola, artefactos), 97 (panorama), 220 (corrida) con 16 px de margen arriba.
    expect(cabEsqueleto!.style.marginTop, 'el margen superior de la cabecera del esqueleto').toBe(cabReal!.style.marginTop);
  });

  it('la silueta de lista pinta tantas filas como hipótesis tiene la investigación (el estado ya lo sabe sin calcular nada), no 8 fijas', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    // Tres hipótesis propias: la lista real tendrá tres filas.
    const propias = e.hipotesis.filter((h) => h.investigacionId === inv.id).slice(0, 3);
    const e3: EstadoRosa = { ...e, hipotesis: [...propias, ...e.hipotesis.filter((h) => h.investigacionId !== inv.id)] };
    await act(async () => root.render(<Ranking inv={inv} estado={e3} detalleId="lista" irA={() => undefined} />));
    const filasEsqueleto = nodo.querySelectorAll('.esqueleto-fila').length;
    await esperarPintado();
    const filasReales = nodo.querySelectorAll('.ranking-fila').length;
    expect(filasReales).toBe(3);
    expect(filasEsqueleto, 'filas de la silueta frente a filas reales').toBe(filasReales);
  });
});

describe('la silueta del correo frente al formulario real', () => {
  it('tiene tantos campos como el formulario de administración por SMTP (9), no 5: en Chromium la tarjeta pasa de 736 px a 1181 px', async () => {
    let responder: (datos: unknown) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            responder = (datos) => resolve({ ok: true, json: async () => datos });
          }),
      ),
    );
    await act(async () => root.render(<Correo servidor />));
    const camposSilueta = nodo.querySelectorAll('[aria-busy="true"] .campo').length;
    expect(camposSilueta).toBeGreaterThan(0);
    await act(async () =>
      responder({
        remitente: 'rosa@alzheimerproject.com',
        url: 'http://localhost:5174',
        hora: 8,
        zona: 'America/Santo_Domingo',
        proveedor: 'smtp',
        smtpServidor: 'smtp.gmail.com',
        smtpPuerto: 587,
        smtpUsuario: 'rosa@alzheimerproject.com',
        claveGuardada: true,
        configurado: true,
        administrador: true,
        error: null,
        historial: [],
      }),
    );
    const camposReales = nodo.querySelectorAll('form .campo').length;
    expect(camposReales).toBe(9);
    expect(nodo.querySelector('[aria-busy="true"]')).toBeNull();
    expect(camposSilueta, 'campos de la silueta frente a campos del formulario').toBe(camposReales);
  });
});

describe('el programa de la investigación mientras una corrida espera a una persona', () => {
  it('un plan sin aprobar o un presupuesto agotado no son una carga: las tarjetas no deberían brillar con aria-busy sin plazo', async () => {
    for (const estado of ['esperando_aprobacion', 'pausada_por_presupuesto'] as const) {
      const e = estadoDeMuestra();
      e.corridas = [{ ...e.corridas[0]!, estado, iteracionActual: 1 }];
      const inv = e.investigaciones[0]!;
      await act(async () => root.render(<Investigacion inv={inv} estado={e} ahora={AHORA_MUESTRA} irA={() => undefined} />));
      await esperarPintado();
      // Nadie calcula nada hasta que la persona actúe (aprobar el plan, ampliar el presupuesto):
      // el brillo promete un resultado que no va a llegar solo.
      const esperas = nodo.querySelectorAll('.programa [role="status"][aria-busy="true"]').length;
      expect(esperas, `corrida ${estado} en la iteración 1`).toBe(0);
      await act(async () => root.render(null));
    }
  });
});
