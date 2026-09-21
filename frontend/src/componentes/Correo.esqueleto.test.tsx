// @vitest-environment jsdom
// La tarjeta del correo mientras responde el servidor: la silueta del
// formulario, los botones y el historial con aria-busy; al llegar el estado,
// el contenido real; y los botones (prueba, guardar, desconectar) vuelan con
// data-en-vuelo y aria-busy sin admitir un segundo clic. El error de carga
// sigue saliendo como antes, sin esqueleto.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Correo } from './Correo';

vi.mock('../datos/almacen', () => ({ cabeceras: () => ({ 'Content-Type': 'application/json' }) }));

type Llamada = { url: string; metodo: string; responder: (ok: boolean, datos: unknown) => void; fallar: (e: unknown) => void };

const ESTADO = {
  remitente: 'rosa@equipo.do',
  url: 'http://localhost:5174',
  hora: 8,
  zona: 'America/Santo_Domingo',
  proveedor: 'smtp' as const,
  smtpServidor: 'smtp.gmail.com',
  smtpPuerto: 587,
  smtpUsuario: 'rosa@equipo.do',
  claveGuardada: true,
  configurado: true,
  administrador: false,
  error: null,
  historial: [] as { id: string; tipo: string; destinatario: string; estado: string; creado: number; intentos: number; error: string | null }[],
};

let root: Root;
let nodo: HTMLDivElement;
let llamadas: Llamada[];
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  llamadas = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          llamadas.push({
            url,
            metodo: init?.method ?? 'GET',
            responder: (ok, datos) => resolve({ ok, json: async () => datos }),
            fallar: reject,
          });
        }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.unstubAllGlobals();
});

const render = (el: React.ReactElement) => act(async () => root.render(el));
const espera = () => nodo.querySelector('[aria-busy="true"]');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const responder = (i: number, ok: boolean, datos: unknown) => act(async () => llamadas[i]!.responder(ok, datos));
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}

it('enseña la silueta de la tarjeta con aria-busy mientras llega el estado, y el contenido real después', async () => {
  await render(<Correo servidor />);
  expect(llamadas.length).toBe(1);
  expect(llamadas[0]!.url).toBe('/api/correo');
  const e = espera();
  expect(e).not.toBeNull();
  expect(textoAccesible(e!)).toBe('Cargando la configuración del correo');
  // Los nueve campos del formulario de administración por SMTP (la instalación real), con rótulo y
  // entrada, más botones y líneas del historial, todos grises y fuera del árbol accesible.
  expect(e!.querySelectorAll('.campo').length).toBe(9);
  expect(e!.querySelectorAll('.esqueleto').length).toBeGreaterThan(12);
  for (const bloque of e!.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
  expect(e!.querySelector('button')).toBeNull();
  expect(nodo.querySelector('[role="status"]:not([aria-busy])')?.textContent).toBe('');
  // Lo que no depende del servidor ya está: el título y la explicación.
  expect(nodo.textContent).toContain('Envío real por correo');

  await responder(0, true, ESTADO);
  expect(espera()).toBeNull();
  expect(nodo.querySelector('.esqueleto')).toBeNull();
  expect(nodo.textContent).toContain('Todavía no hay envíos.');
  expect(boton('Enviar correo de prueba')!.disabled).toBe(false);
});

it('la prueba de envío vuela hasta que el servidor responde, no admite un segundo clic y al aterrizar sale el aviso', async () => {
  await render(<Correo servidor />);
  await responder(0, true, ESTADO);
  const prueba = boton('Enviar correo de prueba')!;
  await pulsar(prueba);
  expect(llamadas.length).toBe(2);
  expect(llamadas[1]!.url).toBe('/api/correo/prueba');
  expect(llamadas[1]!.metodo).toBe('POST');
  expect(prueba.getAttribute('data-en-vuelo')).toBe('true');
  expect(prueba.getAttribute('aria-busy')).toBe('true');
  expect(prueba.disabled).toBe(true);
  // Segundo clic en vuelo: nada sale.
  await pulsar(prueba);
  expect(llamadas.length).toBe(2);

  // El servidor acepta la prueba; la tarjeta vuelve a pedir el estado y sigue en vuelo hasta tenerlo.
  await responder(1, true, { ok: true });
  expect(llamadas.length).toBe(3);
  expect(llamadas[2]!.metodo).toBe('GET');
  expect(prueba.getAttribute('data-en-vuelo')).toBe('true');
  await responder(2, true, { ...ESTADO, historial: [{ id: 'e1', tipo: 'prueba', destinatario: 'emir@equipo.do', estado: 'pendiente', creado: 1_800_000_000, intentos: 1, error: null }] });
  expect(prueba.hasAttribute('data-en-vuelo')).toBe(false);
  expect(prueba.hasAttribute('aria-busy')).toBe(false);
  expect(prueba.disabled).toBe(false);
  expect(nodo.textContent).toContain('Prueba en cola.');
  expect(nodo.textContent).toContain('En cola / reintentó');
});

it('un rechazo del servidor aterriza el botón y enseña el detalle del error, como antes', async () => {
  await render(<Correo servidor />);
  await responder(0, true, ESTADO);
  const prueba = boton('Enviar correo de prueba')!;
  await pulsar(prueba);
  await responder(1, false, { detail: 'El proveedor rechazó la clave' });
  expect(prueba.hasAttribute('data-en-vuelo')).toBe(false);
  expect(prueba.disabled).toBe(false);
  expect(nodo.textContent).toContain('El proveedor rechazó la clave');
});

it('para administración, guardar la conexión vuela en su botón y bloquea el formulario; desconectar vuela en el suyo', async () => {
  await render(<Correo servidor />);
  await responder(0, true, { ...ESTADO, administrador: true });
  const guardar = boton('Guardar conexión')!;
  const desconectar = boton('Desconectar correo')!;
  const formulario = nodo.querySelector('form')!;
  await act(async () => formulario.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(llamadas.length).toBe(2);
  expect(llamadas[1]!.url).toBe('/api/correo/configuracion');
  expect(guardar.getAttribute('data-en-vuelo')).toBe('true');
  expect(desconectar.hasAttribute('data-en-vuelo')).toBe(false);
  expect(desconectar.disabled).toBe(true);
  expect(nodo.querySelector('fieldset')!.disabled).toBe(true);
  await responder(1, true, { ok: true });
  await responder(2, true, { ...ESTADO, administrador: true });
  expect(guardar.hasAttribute('data-en-vuelo')).toBe(false);
  expect(nodo.querySelector('fieldset')!.disabled).toBe(false);
  expect(nodo.textContent).toContain('Configuración guardada.');

  await pulsar(desconectar);
  expect(llamadas.length).toBe(4);
  expect(JSON.parse(String(((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[3]![1]).body))).toEqual({ borrarClave: true });
  expect(desconectar.getAttribute('data-en-vuelo')).toBe('true');
  expect(guardar.hasAttribute('data-en-vuelo')).toBe(false);
  await responder(3, true, { ok: true });
  await responder(4, true, { ...ESTADO, administrador: true, claveGuardada: false });
  expect(desconectar.hasAttribute('data-en-vuelo')).toBe(false);
  expect(nodo.textContent).toContain('Conexión eliminada');
});

it('si el estado no se puede cargar, el esqueleto se retira y sale el aviso de siempre', async () => {
  await render(<Correo servidor />);
  expect(espera()).not.toBeNull();
  await act(async () => llamadas[0]!.fallar(new TypeError('Failed to fetch')));
  expect(espera()).toBeNull();
  expect(nodo.querySelector('.esqueleto')).toBeNull();
  expect(nodo.textContent).toContain('No se pudo cargar el servicio de correo.');
});

it('en modo muestra no pide nada ni pinta esqueleto', async () => {
  await render(<Correo servidor={false} />);
  expect(llamadas.length).toBe(0);
  expect(espera()).toBeNull();
  expect(nodo.textContent).toContain('solo está disponible con el servidor conectado');
});

it('recuerda la forma de la última respuesta: sin administración la silueta no trae formulario, y por Resend trae seis campos', async () => {
  // Primera visita: SMTP con administración por defecto (nueve campos).
  await render(<Correo servidor />);
  expect(espera()!.querySelectorAll('.campo').length).toBe(9);
  await responder(0, true, ESTADO); // administrador: false
  expect(espera()).toBeNull();
  expect(nodo.querySelector('form')).toBeNull();
  await act(async () => root.unmount());
  root = createRoot(nodo);
  // Segunda visita: la silueta ya sabe que no habrá formulario, solo los botones y el historial.
  await render(<Correo servidor />);
  const sinAdmin = espera()!;
  expect(sinAdmin.querySelectorAll('.campo').length).toBe(0);
  expect(sinAdmin.querySelectorAll('.esqueleto').length).toBeGreaterThan(6);
  await responder(1, true, { ...ESTADO, administrador: true, proveedor: 'resend' });
  expect(nodo.querySelectorAll('form .campo').length).toBe(6);
  await act(async () => root.unmount());
  root = createRoot(nodo);
  // Tercera visita: seis campos, como el formulario por Resend que respondió la última vez.
  await render(<Correo servidor />);
  expect(espera()!.querySelectorAll('.campo').length).toBe(6);
  await responder(2, true, { ...ESTADO, administrador: true, proveedor: 'resend' });
  expect(nodo.querySelectorAll('form .campo').length).toBe(6);
});

it('si el servidor no responde en el tope de tiempo, la silueta se retira y sale el aviso de siempre', async () => {
  await render(<Correo servidor />);
  expect(espera()).not.toBeNull();
  await act(async () => llamadas[0]!.fallar(Object.assign(new Error('agotado'), { name: 'TimeoutError' })));
  expect(espera()).toBeNull();
  expect(nodo.textContent).toContain('No se pudo cargar el servicio de correo');
});
