// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fijarIdioma } from '../lib/idioma';
import { ConfiguracionAcademicas } from './ConfiguracionAcademicas';

vi.mock('../datos/almacen', () => ({ cabeceras: () => ({ 'X-Rosa': '1', 'Content-Type': 'application/json' }) }));
let nodo: HTMLDivElement, root: Root;
const estado = (administrador = true) => ({ administrador, campos: [{ id: 'elsevier_api_key', configurado: true }] });
const respuesta = (datos: unknown, status = 200) => ({ ok: status === 200, status, json: async () => datos }) as Response;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fijarIdioma('es');
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function montar(servidor = true) { await act(async () => root.render(<ConfiguracionAcademicas servidor={servidor} />)); }

it('distingue páginas públicas de acceso institucional sin fingir verificación', async () => {
  const fetch = vi.fn().mockResolvedValue(respuesta(estado())); vi.stubGlobal('fetch', fetch);
  await montar();
  expect(nodo.textContent).toContain('cobertura parcial de páginas públicas');
  expect(nodo.textContent).toContain('Configurado; permiso sin comprobar');
  expect(nodo.querySelectorAll('input[type="password"]')).toHaveLength(8);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', headers: { 'X-Rosa': '1' } });
});

it('oculta todos los campos secretos al lector', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(estado(false)))); await montar();
  expect(nodo.querySelector('input')).toBeNull();
  expect(nodo.textContent).not.toContain('Guardar acceso');
});

it('guarda solo campos nuevos y borra la contraseña al enviarla', async () => {
  const fetch = vi.fn().mockResolvedValue(respuesta({ ...estado(), clave: 'no-visible' })); vi.stubGlobal('fetch', fetch);
  const local = vi.spyOn(Storage.prototype, 'setItem');
  await montar();
  const input = nodo.querySelector<HTMLInputElement>('#academica-elsevier_api_key')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ficticia-secreta');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => nodo.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ valores: { elsevier_api_key: 'ficticia-secreta' } });
  expect(input.value).toBe('');
  expect(nodo.textContent).not.toContain('no-visible');
  expect(nodo.textContent).toContain('El permiso de acceso se comprobará');
  expect(local).not.toHaveBeenCalled();
});

it('desconecta únicamente el proveedor elegido', async () => {
  const fetch = vi.fn().mockResolvedValue(respuesta(estado())); vi.stubGlobal('fetch', fetch); await montar();
  const boton = Array.from(nodo.querySelectorAll('button')).find(b => b.textContent === 'Desconectar acceso institucional')!;
  await act(async () => boton.click());
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ eliminar: ['elsevier_api_key', 'elsevier_insttoken'] });
});

it('no consulta el servidor cuando está fuera de línea', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); await montar(false);
  expect(fetch).not.toHaveBeenCalled(); expect(nodo.querySelector('input')).toBeNull();
});

it('no muestra el cuerpo de errores ni campos con credenciales devueltos', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({ detail: 'clave-no-visible' }, 403))); await montar();
  expect(nodo.textContent).not.toContain('clave-no-visible'); expect(nodo.querySelector('input')).toBeNull();
});

it('muestra el estado y las limitaciones en inglés', async () => {
  fijarIdioma('en'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(estado()))); await montar();
  expect(nodo.textContent).toContain('partial coverage of public pages');
  expect(nodo.textContent).toContain('Configured; permission not checked');
  expect(nodo.textContent).not.toContain('Sin configurar');
});
