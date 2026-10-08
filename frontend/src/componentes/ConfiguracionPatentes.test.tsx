// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fijarIdioma } from '../lib/idioma';
import { ConfiguracionPatentes } from './ConfiguracionPatentes';

vi.mock('../datos/almacen', () => ({ cabeceras: () => ({ 'X-Rosa': '1', 'X-Rosa-Token': 'sesion-de-prueba', 'Content-Type': 'application/json' }) }));

let nodo: HTMLDivElement, root: Root;
const estado = (cambios: Record<string, unknown> = {}) => ({ proveedor: 'serpapi', configurada: false, origen: null, administrador: true, ...cambios });
const respuesta = (datos: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => datos }) as Response;
const boton = (nombre: string) => Array.from(nodo.querySelectorAll('button')).find(b => b.textContent === nombre)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fijarIdioma('es');
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function montar() { await act(async () => root.render(<ConfiguracionPatentes />)); }
async function escribir(valor: string) {
  const input = nodo.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('carga el estado con autenticación y explica que falta la clave sin afirmar ausencia de patentes', async () => {
  const fetch = vi.fn().mockResolvedValue(respuesta(estado())); vi.stubGlobal('fetch', fetch);
  await montar();
  expect(fetch).toHaveBeenCalledWith('/api/patentes/configuracion', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'X-Rosa-Token': 'sesion-de-prueba' }), credentials: 'same-origin', signal: expect.any(AbortSignal) }));
  expect(nodo.textContent).toContain('Falta la clave de SerpApi');
  expect(nodo.textContent).toContain('no significa que no haya patentes');
  expect(nodo.querySelector('a')?.getAttribute('href')).toBe('https://serpapi.com/google-patents-api');
  expect(nodo.querySelector('input')?.type).toBe('password');
  expect(nodo.querySelector('input')?.getAttribute('autocomplete')).toBe('new-password');
  expect(boton('Probar acceso').disabled).toBe(true);
  expect(nodo.querySelector('input[type="url"]')).toBeNull();
});

it('oculta formulario y operaciones de administración a una persona no administradora', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(estado({ configurada: true, origen: 'entorno', administrador: false }))));
  await montar();
  expect(nodo.querySelector('form')).toBeNull();
  expect(nodo.querySelector('input')).toBeNull();
  expect(boton('Probar acceso')).toBeUndefined();
  expect(boton('Desconectar')).toBeUndefined();
  expect(nodo.textContent).toContain('Solo una persona administradora');
  expect(nodo.textContent).toContain('configuración del servidor');
});

it('envía la clave solo en el cuerpo autenticado, vacía el campo y no confunde guardado con verificación', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(respuesta(estado())).mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo', clave: 'no-se-debe-mostrar' })));
  vi.stubGlobal('fetch', fetch);
  const local = vi.spyOn(Storage.prototype, 'setItem');
  await montar(); await escribir('clave-ficticia-para-prueba');
  await act(async () => boton('Guardar clave').click());
  expect(fetch.mock.calls[1]![0]).toBe('/api/patentes/configuracion');
  expect(fetch.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Rosa-Token': 'sesion-de-prueba' }), body: JSON.stringify({ clave: 'clave-ficticia-para-prueba' }) }));
  expect(nodo.querySelector<HTMLInputElement>('input')?.value).toBe('');
  expect(nodo.textContent).not.toContain('clave-ficticia-para-prueba');
  expect(nodo.textContent).not.toContain('no-se-debe-mostrar');
  expect(local).not.toHaveBeenCalled();
  expect(nodo.textContent).toContain('El acceso todavía no está comprobado');
  expect(nodo.querySelector('.chip-ok')).toBeNull();
  expect(boton('Probar acceso').disabled).toBe(false);
});

it('prueba una sola consulta real, conserva la consulta registrada y evita doble clic', async () => {
  let completar!: (r: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockImplementationOnce(() => new Promise<Response>(resolve => { completar = resolve; }));
  vi.stubGlobal('fetch', fetch); await montar();
  expect(nodo.textContent).toContain('puede consumir cuota o generar cargos');
  await act(async () => { const b = boton('Probar acceso'); b.click(); b.click(); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]![0]).toBe('/api/patentes/prueba');
  expect(fetch.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Rosa': '1' }) }));
  expect(fetch.mock.calls[1]![1].body).toBeUndefined();
  await act(async () => completar(respuesta({ ok: true, detalle: 'Proveedor consultado.', consulta: { consulta: 'Alzheimer', fecha: '2026-10-08T12:00:00+00:00', parametros: { api_key: 'no-mostrar-clave' }, error: 'no-mostrar-otros-campos' } })));
  expect(nodo.textContent).toContain('Acceso comprobado en esta sesión');
  expect(nodo.textContent).toContain('Consulta de prueba: Alzheimer');
  expect(nodo.querySelector('time')?.textContent).toBe('2026-10-08T12:00:00+00:00');
  expect(nodo.querySelector('time')?.hasAttribute('data-sin-traducir')).toBe(true);
  expect(nodo.textContent).not.toContain('no-mostrar');
  expect(nodo.textContent).not.toContain('[object Object]');
});

it('un resultado negativo de la prueba no acredita acceso ni ausencia de patentes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockResolvedValueOnce(respuesta({ ok: false, detalle: 'Cuota agotada.' })));
  await montar(); await act(async () => boton('Probar acceso').click());
  expect(nodo.textContent).toContain('Acceso no comprobado');
  expect(nodo.textContent).toContain('Cuota agotada');
  expect(nodo.querySelector('.chip-ok')).toBeNull();
});

it('desconecta con el cuerpo previsto y respeta si sigue existiendo configuración del servidor', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'entorno' })));
  vi.stubGlobal('fetch', fetch); await montar();
  await act(async () => boton('Desconectar').click());
  expect(fetch.mock.calls[1]![1].body).toBe(JSON.stringify({ borrarClave: true }));
  expect(nodo.textContent).toContain('sigue activa la configuración del servidor');
  expect(nodo.textContent).not.toContain('SerpApi desconectado');
});

it('no refleja un cuerpo de error que pudiera contener la clave y elimina el acceso al perder permisos', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respuesta(estado())).mockResolvedValueOnce(respuesta({ detail: 'clave-ficticia-repetida-en-error' }, 403)));
  await montar(); await escribir('clave-ficticia-repetida-en-error');
  await act(async () => boton('Guardar clave').click());
  expect(nodo.textContent).not.toContain('clave-ficticia-repetida-en-error');
  expect(nodo.querySelector('input')).toBeNull();
  expect(nodo.textContent).toContain('La sesión no permite esta operación');
});

it('aborta la prueba a los 35 segundos y devuelve los controles sin confirmar el acceso', async () => {
  vi.useFakeTimers();
  let senal!: AbortSignal;
  const fetch = vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockImplementationOnce((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    senal = init.signal as AbortSignal;
    senal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetch); await montar();
  await act(async () => boton('Probar acceso').click());
  await act(async () => vi.advanceTimersByTimeAsync(35_000));
  expect(senal.aborted).toBe(true);
  expect(nodo.textContent).toContain('No pude comprobar el resultado en 35 segundos');
  expect(boton('Probar acceso').disabled).toBe(false);
  expect(nodo.querySelector('.chip-ok')).toBeNull();
});

it('al salir aborta el guardado y una respuesta tardía no vuelve a pintar la clave', async () => {
  let senal!: AbortSignal, terminar!: (r: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(respuesta(estado())).mockImplementationOnce((_url, init: RequestInit) => new Promise<Response>(resolve => { senal = init.signal as AbortSignal; terminar = resolve; }));
  vi.stubGlobal('fetch', fetch); await montar(); await escribir('clave-para-salir');
  await act(async () => boton('Guardar clave').click());
  await act(async () => root.render(<p>Otra pantalla</p>));
  expect(senal.aborted).toBe(true);
  await act(async () => terminar(respuesta(estado({ configurada: true, origen: 'archivo' }))));
  expect(nodo.textContent).toBe('Otra pantalla');
});

it('no consulta ni solicita una clave con datos de muestra', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<ConfiguracionPatentes servidor={false} />));
  expect(fetch).not.toHaveBeenCalled();
  expect(nodo.querySelector('input')).toBeNull();
  expect(nodo.textContent).toContain('requiere conexión');
});

it('presenta la explicación y los controles en inglés con proveedor fijo', async () => {
  fijarIdioma('en');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(estado())));
  await montar();
  expect(nodo.textContent).toContain('Google Patents through SerpApi');
  expect(nodo.textContent).toContain('may consume quota or incur charges');
  expect(boton('Save key')).toBeDefined();
  expect(boton('Test access')).toBeDefined();
  expect(nodo.querySelector('select')).toBeNull();
});

it.each([true, false])('la prueba en inglés conserva procedencia y no presenta el detalle español, ok=%s', async ok => {
  fijarIdioma('en');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockResolvedValueOnce(respuesta({ ok, detalle: 'Detalle del proveedor escrito solo en español.', consulta: { consulta: 'Alzheimer', fecha: '2026-10-08T12:00:00+00:00' } })));
  await montar(); await act(async () => boton('Test access').click());
  expect(nodo.textContent).not.toContain('Detalle del proveedor');
  expect(nodo.textContent).toContain(ok ? 'Google Patents responded to the test query.' : 'Google Patents access could not be verified.');
  expect(nodo.textContent).toContain('Test query: Alzheimer');
  expect(nodo.textContent).toContain('Query date: 2026-10-08T12:00:00+00:00');
});

it('ignora tipos inválidos en procedencia sin inventar consulta ni fecha', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respuesta(estado({ configurada: true, origen: 'archivo' }))).mockResolvedValueOnce(respuesta({ ok: true, detalle: 'Consulta comprobada.', consulta: { consulta: { api_key: 'no-mostrar' }, fecha: 123 } })));
  await montar(); await act(async () => boton('Probar acceso').click());
  expect(nodo.textContent).toContain('Google Patents respondió');
  expect(nodo.textContent).not.toContain('Consulta de prueba:');
  expect(nodo.querySelector('time')).toBeNull();
  expect(nodo.textContent).not.toContain('no-mostrar');
});
