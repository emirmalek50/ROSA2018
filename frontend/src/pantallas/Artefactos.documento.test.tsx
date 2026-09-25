// @vitest-environment jsdom
// El documento controlado de un dossier en Artefactos (norma AP-DOC-002): que
// proponga el nombre corto que resumió ROSA2018 y deje cambiarlo, que emitir
// pida al servidor sin inventar el código en el navegador, que cada versión
// emitida se descargue en Word con su nombre de fichero, y que la misma versión
// del dossier no se ofrezca dos veces.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import type { Artefacto, EstadoRosa, VersionDocumento } from '../datos/tipos';
import { Artefactos } from './Artefactos';

const llamadas = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: new Proxy(
    {},
    {
      get: (_objetivo, nombre: string) => {
        if (!llamadas.has(nombre)) llamadas.set(nombre, vi.fn(async () => null));
        return llamadas.get(nombre);
      },
    },
  ),
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  llamadas.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const boton = (inicio: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(inicio));
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/** El estado de muestra en línea, con un dossier de la primera hipótesis. */
function conDossier(extra: { nombreCorto?: string | null; versionesDossier?: number; emitidas?: Partial<VersionDocumento>[] } = {}): { e: EstadoRosa; art: Artefacto } {
  const e: EstadoRosa = { ...structuredClone(estadoDeMuestra()), conexion: 'en_linea' };
  const inv = e.investigaciones[0]!;
  const base = e.artefactos[0]!;
  const n = extra.versionesDossier ?? 1;
  const art: Artefacto = { ...base, id: 'art-dos', investigacionId: inv.id, nombre: 'Dossier para el laboratorio: brecha', tipo: 'dossier', destacado: false, versiones: Array.from({ length: n }, (_, i) => ({ ...base.versiones[0]!, n: i + 1, contenido: `dossier ${i + 1}` })) };
  e.artefactos = [...e.artefactos, art];
  const h = e.hipotesis.find((x) => x.investigacionId === inv.id)!;
  h.dossierArtefactoId = art.id;
  if ('nombreCorto' in extra) h.nombreCorto = extra.nombreCorto;
  if (extra.emitidas) {
    h.documentoControlado = {
      id: 'AP-HYP-001',
      nombreCorto: 'Brecha GFAP NfL',
      versiones: extra.emitidas.map((v, i) => ({
        version: `v0${i + 1}`,
        emitidaEn: 1,
        fecha: 'Sep-17-2026',
        iniciales: 'AP',
        nombre: 'Brecha GFAP NfL',
        cabecera: `Brecha GFAP NfL | DOC | AP-HYP-001 | v0${i + 1}`,
        pie: 'Confidential | Alzheimer Project | AI Robotix | Sep-17-2026 | AP | Page X of Y',
        artefactoId: art.id,
        versionArtefacto: i + 1,
        quien: 'Emir',
        norma: 'AP-DOC-002 v01',
        comprobaciones: Array.from({ length: 8 }, (_, k) => ({ n: k + 1, norma: '', texto: `comprobación ${k + 1}`, ok: true })),
        controlado: true,
        ...v,
      })),
    };
  }
  return { e, art };
}

async function abrir(e: EstadoRosa, art: Artefacto) {
  await act(async () => root.render(<Artefactos inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} detalleId={art.id} />));
  await esperarPintado();
}

describe('el documento controlado de un dossier', () => {
  it('propone el nombre corto que resumió ROSA2018 y emite con el que quede', async () => {
    const { e, art } = conDossier({ nombreCorto: 'Brecha GFAP NfL en APOE4' });
    await abrir(e, art);
    const panel = nodo.querySelector('.doc-control')!;
    expect(panel.textContent).toContain('norma AP-DOC-002');
    const entrada = panel.querySelector<HTMLInputElement>('input')!;
    expect(entrada.value).toBe('Brecha GFAP NfL en APOE4');
    expect(panel.textContent).toContain('Resumen del título propuesto por ROSA2018');
    await pulsar(boton('Emitir documento controlado')!);
    expect(llamadas.get('emitirDocumento')).toHaveBeenCalledWith(expect.any(String), 'Brecha GFAP NfL en APOE4');
  });

  it('sin nombre no deja emitir, y una barra vertical no llega a la cabecera', async () => {
    const { e, art } = conDossier({ nombreCorto: null });
    await abrir(e, art);
    const entrada = nodo.querySelector<HTMLInputElement>('.doc-control input')!;
    expect(entrada.placeholder).toContain('Escríbelo');
    expect(boton('Emitir documento controlado')!.hasAttribute('disabled')).toBe(true);
    const fijar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      fijar.call(entrada, 'Brecha | GFAP');
      entrada.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pulsar(boton('Emitir documento controlado')!);
    expect(llamadas.get('emitirDocumento')).toHaveBeenCalledWith(expect.any(String), 'Brecha GFAP');
  });

  it('enseña las versiones emitidas, descarga cada una en Word y no ofrece volver a emitir la misma', async () => {
    const { e, art } = conDossier({ emitidas: [{}] });
    await abrir(e, art);
    const panel = nodo.querySelector('.doc-control')!;
    expect(panel.querySelector('h3')!.textContent).toBe('Documento controlado · AP-HYP-001');
    expect(panel.textContent).toContain('Brecha GFAP NfL | DOC | AP-HYP-001 | v01');
    expect(panel.textContent).toContain('8 de 8 comprobaciones');
    expect(panel.textContent).toContain('ya está emitida como v01');
    expect(boton('Emitir')).toBeUndefined();
    await pulsar(boton('Descargar Word v01')!);
    expect(llamadas.get('descargarDocumento')).toHaveBeenCalledWith(expect.any(String), 'v01', 'AP-HYP-001_v01.docx');
  });

  it('con el dossier regenerado ofrece la v02, y dice qué no cumple una versión que falla', async () => {
    const { e, art } = conDossier({ versionesDossier: 2, emitidas: [{ controlado: false, comprobaciones: [{ n: 8, norma: '', texto: 'Las iniciales del responsable están en el pie', ok: false }] }] });
    await abrir(e, art);
    expect(boton('Emitir v02')).toBeDefined();
    expect(nodo.querySelector('.doc-control')!.textContent).toContain('No cumple: Las iniciales del responsable están en el pie.');
  });

  it('el botón de descargar un dossier da el Word con el diseño del Alzheimer Project, y el texto sigue a mano', async () => {
    const { e, art } = conDossier();
    await abrir(e, art);
    await pulsar(boton('Descargar v1 (Word)')!);
    expect(llamadas.get('descargarDossier')).toHaveBeenCalledWith(art.id, 1);
    expect(boton('Texto (.md)')).toBeDefined();
  });

  it('un artefacto que no es dossier no enseña el panel', async () => {
    const { e } = conDossier();
    await abrir(e, e.artefactos[0]!);
    expect(nodo.querySelector('.doc-control')).toBeNull();
    // Ni el Word: los demás artefactos se descargan como siempre.
    expect(boton('Descargar v1 (Word)')).toBeUndefined();
  });
});
