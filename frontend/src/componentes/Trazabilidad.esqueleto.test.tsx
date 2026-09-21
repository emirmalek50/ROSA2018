// @vitest-environment jsdom
// La cadena de evidencia de una corrida mientras responde el servidor: la
// sección sale ya con su título y una silueta (embudo, filtros, tres filas
// del árbol) con aria-busy, en vez de un hueco que después salta. Al llegar
// la evidencia se pinta el árbol; una petición posterior de la misma corrida
// no vuelve al esqueleto (el contenido sigue siendo válido); al cambiar de
// corrida sí, y la evidencia de la anterior no se enseña; y si el servidor
// falla, la sección no se pinta, como antes.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Corrida } from '../datos/tipos';
import type { Evidencia } from '../lib/evidencia';
import { fijarModo } from '../lib/modo';
import { consultasEnSilueta, Trazabilidad } from './Trazabilidad';

type Respuesta = { ok: boolean; json?: () => Promise<unknown> };

/** Una petición al servidor que el test resuelve cuando quiere. */
function diferida() {
  let resolver!: (v: Respuesta) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<Respuesta>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function evidenciaDe(corridaId: string, referencia = 'Pereira 2021'): Evidencia {
  return {
    corridaId,
    version: 1,
    consultas: [{ base: 'PubMed', consulta: 'GFAP plasma Alzheimer', fecha: 1, resultados: 12, iteracion: 1 }],
    fuentes: [
      {
        id: 'f1',
        referencia,
        titulo: 'GFAP en plasma como marcador temprano',
        tipo: 'articulo',
        doi: '10.1000/x',
        pmid: null,
        nct: null,
        anio: 2021,
        tipoEstudio: null,
        relevancia: 8,
        retraccion: null,
        retraccionDetalle: '',
        textoCompleto: true,
        fragmentos: 4,
        extraida: true,
        iteracion: 1,
        consultas: ['GFAP plasma Alzheimer'],
      },
    ],
    afirmaciones: [{ id: 'a1', texto: 'GFAP sube antes que NfL', cita: 'p. 3', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', tema: '', fuenteId: 'f1', localizador: '', iteracion: 1 }],
  };
}

beforeAll(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

let root: Root;
let nodo: HTMLDivElement;
let corrida: Corrida;
let peticiones: ReturnType<typeof diferida>[];
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // La sección es de detalle: en modo sencillo va plegada y no pinta hijos.
  fijarModo('detalle');
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  corrida = estadoDeMuestra().corridas[0]!;
  peticiones = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const d = diferida();
      peticiones.push(d);
      return d.promesa;
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.unstubAllGlobals();
  fijarModo('sencillo');
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const espera = () => nodo.querySelector('[aria-busy="true"]');
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}
const responder = (d: ReturnType<typeof diferida>, datos: unknown) => act(async () => d.resolver({ ok: true, json: async () => datos }));

it('enseña la silueta de la sección con aria-busy mientras responde el servidor, y el árbol después sin esqueleto', async () => {
  await render(<Trazabilidad corrida={corrida} activa />);
  expect(peticiones.length).toBe(1);
  expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe(`/api/corridas/${encodeURIComponent(corrida.id)}/evidencia`);
  const e = espera();
  expect(e).not.toBeNull();
  expect(textoAccesible(e!)).toBe('Cargando la cadena de evidencia');
  // El título de la sección ya está, para que al llegar el contenido no se mueva.
  expect(nodo.textContent).toContain('De la consulta a la afirmación');
  // La silueta: cinco pasos del embudo, la fila de filtros y tres filas del árbol.
  expect(e!.querySelectorAll('.embudo-compacto .embudo-paso').length).toBe(5);
  expect(e!.querySelector('.filtros-arbol')).not.toBeNull();
  // Una consulta por cada una que la corrida ya tiene en el estado, abierta con dos fuentes debajo.
  const consultas = consultasEnSilueta(corrida);
  expect(consultas).toBe(Math.min(12, Math.max(1, corrida.busqueda.consultas.length)));
  expect(e!.querySelectorAll('.arbol > .arbol-nodo').length).toBe(consultas);
  expect(e!.querySelectorAll('.arbol .arbol-fila').length).toBe(consultas * 3);
  // La corrida de muestra va por más de una iteración: las pestañas de iteración en gris en la cabecera.
  expect(corrida.iteracionActual).toBeGreaterThan(1);
  expect(nodo.querySelectorAll('.pestanas .esqueleto').length).toBe(Math.min(8, corrida.iteracionActual));
  expect(e!.querySelectorAll('.esqueleto').length).toBeGreaterThan(10);
  for (const bloque of e!.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
  // Nada de la silueta es un control.
  expect(e!.querySelector('button')).toBeNull();

  await responder(peticiones[0]!, evidenciaDe(corrida.id));
  expect(espera()).toBeNull();
  expect(nodo.querySelector('.esqueleto')).toBeNull();
  expect(nodo.querySelectorAll('.embudo-compacto .embudo-paso').length).toBe(5);
  expect(nodo.textContent).toContain('Consulta 1');
  expect(nodo.textContent).toContain('Pereira 2021');
  expect(nodo.textContent).toContain('12 resultados');
});

it('una petición posterior de la misma corrida no vuelve al esqueleto: el contenido se queda hasta que llega el nuevo', async () => {
  await render(<Trazabilidad corrida={corrida} activa />);
  await responder(peticiones[0]!, evidenciaDe(corrida.id));
  expect(nodo.textContent).toContain('Pereira 2021');
  // Cambia el gasto (una llamada más): se vuelve a pedir la evidencia.
  const conMasGasto: Corrida = { ...corrida, gasto: { ...corrida.gasto, llamadas: corrida.gasto.llamadas + 1 } };
  await render(<Trazabilidad corrida={conMasGasto} activa />);
  expect(peticiones.length).toBe(2);
  expect(espera()).toBeNull();
  expect(nodo.querySelector('.esqueleto')).toBeNull();
  expect(nodo.textContent).toContain('Pereira 2021');
  await responder(peticiones[1]!, evidenciaDe(corrida.id, 'Benedet 2022'));
  expect(nodo.textContent).toContain('Benedet 2022');
  expect(nodo.textContent).not.toContain('Pereira 2021');
});

it('al cambiar de corrida vuelve al esqueleto y no enseña la evidencia de la anterior; si el servidor falla, la sección no se pinta', async () => {
  await render(<Trazabilidad corrida={corrida} activa />);
  await responder(peticiones[0]!, evidenciaDe(corrida.id));
  expect(nodo.textContent).toContain('Pereira 2021');
  const otra: Corrida = { ...corrida, id: 'corrida-otra' };
  await render(<Trazabilidad corrida={otra} activa />);
  expect(peticiones.length).toBe(2);
  expect(espera()).not.toBeNull();
  expect(nodo.textContent).not.toContain('Pereira 2021');
  // El servidor responde con error: ni esqueleto ni sección, como antes.
  await act(async () => peticiones[1]!.resolver({ ok: false }));
  expect(espera()).toBeNull();
  expect(nodo.textContent).toBe('');
  // De vuelta a la primera corrida: su evidencia sigue guardada y sale sin esperar a la red.
  await render(<Trazabilidad corrida={corrida} activa />);
  expect(nodo.textContent).toContain('Pereira 2021');
});

it('si la primera petición falla (red caída) el esqueleto se retira y no queda nada, como antes', async () => {
  await render(<Trazabilidad corrida={corrida} activa />);
  expect(espera()).not.toBeNull();
  await act(async () => peticiones[0]!.rechazar(new TypeError('Failed to fetch')));
  expect(espera()).toBeNull();
  expect(nodo.textContent).toBe('');
});

it('sin servidor (activa=false) no pide nada ni pinta esqueleto', async () => {
  await render(<Trazabilidad corrida={corrida} activa={false} />);
  expect(peticiones.length).toBe(0);
  expect(espera()).toBeNull();
  expect(nodo.textContent).toBe('');
});

it('si el servidor acepta la conexión y no responde en el tope de tiempo, dice "no pude comprobar" y el botón vuelve a pedirla', async () => {
  await render(<Trazabilidad corrida={corrida} activa />);
  expect(espera()).not.toBeNull();
  await act(async () => peticiones[0]!.rechazar(Object.assign(new Error('agotado'), { name: 'TimeoutError' })));
  expect(espera()).toBeNull();
  expect(nodo.textContent).toContain('No pude comprobar la cadena de evidencia: el servidor no respondió a tiempo.');
  const volver = [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Volver a pedir')!;
  await act(async () => volver.click());
  expect(peticiones.length).toBe(2);
  expect(espera()).not.toBeNull();
  await responder(peticiones[1]!, evidenciaDe(corrida.id));
  expect(espera()).toBeNull();
  expect(nodo.textContent).toContain('Pereira 2021');
  expect(nodo.textContent).not.toContain('No pude comprobar');
});

it('con una corrida en su primera iteración la silueta no lleva pestañas de iteración', async () => {
  await render(<Trazabilidad corrida={{ ...corrida, iteracionActual: 1 }} activa />);
  expect(espera()).not.toBeNull();
  expect(nodo.querySelector('.pestanas')).toBeNull();
});
