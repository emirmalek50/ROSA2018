// @vitest-environment jsdom
// La búsqueda por significado mientras responde el servidor: tres filas en
// gris con la forma de un resultado y aria-busy bajo "Por significado", solo
// desde que sale la petición (tras el retardo de 350 ms) hasta que responde.
// Si ya había resultados se quedan mientras vuela la siguiente petición; con
// menos de cuatro letras, en modo muestra o si el índice no está disponible
// no hay bloque ni esqueleto.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa } from '../datos/tipos';
import { BusquedaGlobal } from './BusquedaGlobal';

vi.mock('../datos/almacen', () => ({ cabeceras: () => ({}) }));

type Respuesta = { ok: boolean; json?: () => Promise<unknown> };

let root: Root;
let nodo: HTMLDivElement;
let estado: EstadoRosa;
let peticiones: ((r: Respuesta) => void)[];
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Los temporizadores falsos van antes de montar: el retardo de la búsqueda tiene que ser el falso.
  vi.useFakeTimers();
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  estado = estadoDeMuestra();
  estado.conexion = 'en_linea';
  peticiones = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Respuesta>((resolve) => {
          peticiones.push(resolve);
        }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const escribir = async (el: HTMLInputElement, valor: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pasar = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
const espera = () => nodo.querySelector('[aria-busy="true"]');
const bloque = () => nodo.querySelector('.busqueda-semantica');
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}
async function abrirYEscribir(texto: string) {
  const inv = estado.investigaciones[0]!;
  await render(<BusquedaGlobal estado={estado} investigacionId={inv.id} abierta onCerrar={() => {}} />);
  const entrada = nodo.querySelector('input[aria-label="Buscar"]') as HTMLInputElement;
  await escribir(entrada, texto);
  return { inv, entrada };
}

it('filas grises con aria-busy desde que sale la petición hasta que el servidor responde; los resultados después', async () => {
  const { inv, entrada } = await abrirYEscribir('amiloide');
  // Antes del retardo no hay petición ni bloque: la lista por palabras ya está.
  expect(peticiones.length).toBe(0);
  expect(bloque()).toBeNull();
  expect(nodo.querySelector('.busqueda-resultados')).not.toBeNull();

  await pasar(350);
  expect(peticiones.length).toBe(1);
  expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toContain(`/api/buscar?q=amiloide&investigacion=${encodeURIComponent(inv.id)}`);
  expect(bloque()).not.toBeNull();
  expect(bloque()!.textContent).toContain('Por significado');
  const e = espera();
  expect(e).not.toBeNull();
  expect(textoAccesible(e!)).toBe('Cargando los resultados por significado');
  expect(e!.querySelectorAll('.busqueda-resultados .busqueda-item').length).toBe(3);
  for (const fila of e!.querySelectorAll('.busqueda-item')) expect(fila.querySelectorAll('.esqueleto').length).toBe(3);
  expect(e!.querySelector('button')).toBeNull();

  const hip = estado.hipotesis.find((h) => h.investigacionId === inv.id)!;
  await act(async () => peticiones[0]!({ ok: true, json: async () => ({ disponible: true, resultados: [{ id: `hipotesis:${hip.id}`, tipo: 'hipotesis', texto: 'La astroglía se activa antes que el daño axonal', similitud: 0.82 }] }) }));
  expect(espera()).toBeNull();
  expect(nodo.querySelector('.esqueleto')).toBeNull();
  expect(bloque()!.querySelectorAll('button.busqueda-item').length).toBe(1);
  expect(nodo.textContent).toContain('similitud 0.82');

  // Una letra más: los resultados que hay se quedan mientras vuela la petición nueva, sin esqueleto.
  await escribir(entrada, 'amiloides');
  await pasar(350);
  expect(peticiones.length).toBe(2);
  expect(espera()).toBeNull();
  expect(nodo.textContent).toContain('similitud 0.82');

  // Menos de cuatro letras: el bloque desaparece y la respuesta tardía no lo resucita.
  await escribir(entrada, 'ami');
  expect(bloque()).toBeNull();
  await act(async () => peticiones[1]!({ ok: true, json: async () => ({ disponible: true, resultados: [{ id: 'hecho:x', tipo: 'hecho', texto: 'tarde', similitud: 0.5 }] }) }));
  expect(bloque()).toBeNull();
  expect(espera()).toBeNull();
});

it('si el índice no está disponible o el servidor falla, el esqueleto se retira y no queda bloque', async () => {
  await abrirYEscribir('amiloide');
  await pasar(350);
  expect(espera()).not.toBeNull();
  await act(async () => peticiones[0]!({ ok: true, json: async () => ({ disponible: false, resultados: [] }) }));
  expect(espera()).toBeNull();
  expect(bloque()).toBeNull();

  const entrada = nodo.querySelector('input[aria-label="Buscar"]') as HTMLInputElement;
  await escribir(entrada, 'amiloide beta');
  await pasar(350);
  expect(peticiones.length).toBe(2);
  expect(espera()).not.toBeNull();
  await act(async () => peticiones[1]!({ ok: false }));
  expect(espera()).toBeNull();
  expect(bloque()).toBeNull();
});

it('en modo muestra no hay petición ni esqueleto', async () => {
  estado.conexion = 'muestra';
  await abrirYEscribir('amiloide');
  await pasar(1000);
  expect(peticiones.length).toBe(0);
  expect(bloque()).toBeNull();
  expect(espera()).toBeNull();
});

it('al cerrar la búsqueda con una petición en vuelo, el esqueleto se va y la respuesta tardía no lo devuelve', async () => {
  const { inv } = await abrirYEscribir('amiloide');
  await pasar(350);
  expect(espera()).not.toBeNull();
  await render(<BusquedaGlobal estado={estado} investigacionId={inv.id} abierta={false} onCerrar={() => {}} />);
  expect(nodo.textContent).toBe('');
  await act(async () => peticiones[0]!({ ok: true, json: async () => ({ disponible: true, resultados: [{ id: 'hecho:x', tipo: 'hecho', texto: 'tarde', similitud: 0.5 }] }) }));
  expect(nodo.textContent).toBe('');
});
