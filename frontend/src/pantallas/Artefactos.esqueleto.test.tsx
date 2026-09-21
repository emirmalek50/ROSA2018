// @vitest-environment jsdom
// Los artefactos con esqueleto (estándar de Emir, 19 de septiembre de 2026):
// la rejilla se anuncia con la silueta de lista y el detalle con la de ficha;
// cada descarga va en vuelo mientras arma el fichero y no admite un segundo
// clic; "Generar dossier" pide al servidor y sigue en vuelo hasta que el
// dossier llega por el canal en vivo (artefacto nuevo o versión nueva) o
// hasta que pasa un minuto, y entonces lo dice. Con datos de muestra no hay
// servidor y el botón queda deshabilitado.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import type { Artefacto, EstadoRosa } from '../datos/tipos';
import { Artefactos } from './Artefactos';

/** Lo que espera el botón del dossier antes de darse por vencido (ESPERA_DOSSIER_MS en Artefactos.tsx, que no se exporta para conservar el refresco en caliente). */
const ESPERA_DOSSIER_MS = 60_000;

const llamadas = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: new Proxy(
    {},
    {
      get: (_objetivo, nombre: string) => {
        if (!llamadas.has(nombre)) llamadas.set(nombre, vi.fn());
        return llamadas.get(nombre);
      },
    },
  ),
}));

let clicEnlace: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:rosa';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  llamadas.clear();
  clicEnlace = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  nodo.remove();
  clicEnlace.mockRestore();
});
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const espera = () => nodo.querySelector('[role="status"][aria-busy="true"]');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** El estado de muestra como si viniera del servidor: el dossier se puede pedir. */
function estadoEnLinea(): EstadoRosa {
  return { ...estadoDeMuestra(), conexion: 'en_linea' };
}
/** Un dossier guardado por el servidor para una hipótesis, con `versiones` versiones. */
function dossierDe(base: Artefacto, hipotesisId: string, versiones: number): Artefacto {
  const v = base.versiones[0]!;
  return { ...base, id: `art-dossier-${hipotesisId}`, nombre: `Dossier para el laboratorio: ${hipotesisId}`, tipo: 'dossier', destacado: false, versiones: Array.from({ length: versiones }, (_, i) => ({ ...v, n: i + 1, contenido: `dossier ${i + 1}`, resumen: `versión ${i + 1}` })) };
}
async function elegirHipotesis(id: string) {
  const selector = nodo.querySelector<HTMLSelectElement>('select[aria-label="Hipótesis del dossier"]')!;
  const fijar = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    fijar.call(selector, id);
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('el esqueleto de los artefactos', () => {
  it('la rejilla se anuncia con la silueta de lista y el detalle con la de ficha', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Artefactos inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId={null} />));
    expect(espera()?.classList.contains('esqueleto-pantalla-lista')).toBe(true);
    expect(espera()?.querySelector('.sr-only')?.textContent).toBe('Cargando los artefactos');
    expect(nodo.querySelectorAll('.artefacto').length).toBe(0);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelectorAll('.artefacto').length).toBeGreaterThanOrEqual(3);
    expect(nodo.textContent).toContain('fuentes citadas en la investigación');
    expect(nodo.textContent).not.toContain('\u2014');
    // El detalle: al abrir un artefacto de otra investigación no calculada aún, silueta de ficha.
    const e2 = structuredClone(e);
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2' };
    for (const a of e2.artefactos) a.investigacionId = 'inv-2';
    await act(async () => root.render(<Artefactos inv={inv2} estado={e2} ahora={AHORA_MUESTRA} detalleId="art-1" />));
    expect(espera()?.classList.contains('esqueleto-pantalla-ficha')).toBe(true);
    expect(espera()?.querySelector('.sr-only')?.textContent).toBe('Cargando el artefacto');
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelector('h2')?.textContent).toBe('informe-iteracion.md');
    expect(nodo.textContent).toContain('versiones');
  });

  it('cada descarga va en vuelo mientras arma el fichero y un segundo clic no descarga dos veces', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Artefactos inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    const bibtex = boton('BibTeX');
    const ris = boton('RIS');
    await pulsar(bibtex);
    expect(bibtex.getAttribute('data-en-vuelo')).toBe('true');
    expect(bibtex.getAttribute('aria-busy')).toBe('true');
    expect(ris.hasAttribute('data-en-vuelo')).toBe(false); // cada botón lleva su propio vuelo
    await pulsar(bibtex); // repetido mientras vuela: se ignora
    await esperarPintado();
    expect(bibtex.hasAttribute('data-en-vuelo')).toBe(false);
    expect(clicEnlace).toHaveBeenCalledTimes(1);
    // El detalle también: "Descargar vN".
    await act(async () => root.render(<Artefactos inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId="art-1" />));
    await esperarPintado();
    const descargar = [...nodo.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Descargar v'))!;
    await pulsar(descargar);
    expect(descargar.getAttribute('data-en-vuelo')).toBe('true');
    await esperarPintado();
    expect(descargar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(clicEnlace).toHaveBeenCalledTimes(2);
  });

  it('con datos de muestra el dossier no se puede pedir: no hay servidor que lo arme', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<Artefactos inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    const pedir = boton('Generar dossier');
    expect(pedir.disabled).toBe(true);
    expect(pedir.title).toContain('datos de muestra');
  });

  it('pedir el dossier lo manda al servidor y sigue en vuelo hasta que llega por el canal en vivo, también al regenerarlo', async () => {
    const e = estadoEnLinea();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Artefactos inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    await elegirHipotesis('hip-2');
    const pedir = boton('Generar dossier');
    expect(pedir.disabled).toBe(false);
    await pulsar(pedir);
    expect(llamadas.get('generarDossier')).toHaveBeenCalledTimes(1);
    expect(llamadas.get('generarDossier')).toHaveBeenCalledWith('hip-2');
    expect(pedir.getAttribute('data-en-vuelo')).toBe('true');
    expect(pedir.getAttribute('aria-busy')).toBe('true');
    expect(nodo.textContent).toContain('Esperando al servidor');
    await pulsar(pedir); // repetido: no se manda dos veces
    expect(llamadas.get('generarDossier')).toHaveBeenCalledTimes(1);
    // Un estado sin novedades no cierra la espera.
    await act(async () => root.render(<Artefactos inv={inv} estado={structuredClone(e)} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    expect(boton('Generar dossier').getAttribute('data-en-vuelo')).toBe('true');
    // Llega el dossier: la hipótesis apunta al artefacto nuevo y está en la lista.
    const e2 = structuredClone(e);
    const dossier = dossierDe(e2.artefactos[0]!, 'hip-2', 1);
    e2.artefactos = [...e2.artefactos, dossier];
    e2.hipotesis.find((h) => h.id === 'hip-2')!.dossierArtefactoId = dossier.id;
    await act(async () => root.render(<Artefactos inv={inv} estado={e2} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    const regenerar = boton('Regenerar dossier');
    expect(regenerar.hasAttribute('data-en-vuelo')).toBe(false);
    expect(nodo.textContent).not.toContain('Esperando al servidor');
    expect(nodo.textContent).toContain('Dossier para el laboratorio: hip-2');
    // Regenerar: el mismo artefacto gana una versión y eso cierra la espera.
    await pulsar(regenerar);
    expect(regenerar.getAttribute('data-en-vuelo')).toBe('true');
    expect(llamadas.get('generarDossier')).toHaveBeenCalledTimes(2);
    const e3 = structuredClone(e2);
    e3.artefactos = e3.artefactos.map((a) => (a.id === dossier.id ? dossierDe(e3.artefactos[0]!, 'hip-2', 2) : a));
    await act(async () => root.render(<Artefactos inv={inv} estado={e3} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    expect(boton('Regenerar dossier').hasAttribute('data-en-vuelo')).toBe(false);
  });

  it('si el servidor no devuelve el dossier en un minuto, el botón sale del vuelo y lo dice', async () => {
    const e = estadoEnLinea();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<Artefactos inv={inv} estado={e} ahora={AHORA_MUESTRA} detalleId={null} />));
    await esperarPintado();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pedir = boton('Generar dossier');
    await pulsar(pedir);
    expect(pedir.getAttribute('data-en-vuelo')).toBe('true');
    await act(async () => {
      vi.advanceTimersByTime(ESPERA_DOSSIER_MS - 1000);
    });
    expect(pedir.getAttribute('data-en-vuelo')).toBe('true');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(pedir.hasAttribute('data-en-vuelo')).toBe(false);
    expect(nodo.textContent).toContain('Sin respuesta del servidor en un minuto');
    // Se puede volver a pedir.
    await pulsar(pedir);
    expect(pedir.getAttribute('data-en-vuelo')).toBe('true');
    expect(nodo.textContent).not.toContain('Sin respuesta del servidor');
  });
});
