// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ESTILO_LABORATORIO, useConversacionesLaboratorio } from './conversacionesLaboratorio';

vi.mock('../datos/almacen', () => ({ cabeceras: () => ({ 'X-Rosa': '1', 'Content-Type': 'application/json' }) }));
let nodo: HTMLDivElement, root: Root;
type Props = { it?: string; disponible?: boolean; activo?: boolean };
function Vista({ it = 'it', disponible = true, activo = true }: Props) {
  const d = useConversacionesLaboratorio('corrida', it, 'es', disponible, activo);
  return <output>{JSON.stringify(d)}</output>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('los datos de muestra no piden conversaciones y muestran pausa', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista disponible={false} />));
  expect(fetch).not.toHaveBeenCalled(); expect(nodo.textContent).toContain('pausada');
});

it('descarta la voz anterior del servidor y conserva las referencias del diálogo natural', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estado: 'conversando', turnos: [
    { id: 'vieja', texto: 'Fuente 12:14: comprobaciones deterministas' },
    { id: 'nueva', estilo: ESTILO_LABORATORIO, texto: 'Me intriga lo de tau. Quiero mirarlo mejor.', materiales: [{ cita: 'PMID:123, p. 4' }] },
  ] }) }));
  await act(async () => root.render(<Vista />));
  expect(nodo.textContent).not.toContain('comprobaciones deterministas');
  expect(nodo.textContent).toContain('Me intriga lo de tau');
  expect(nodo.textContent).toContain('PMID:123, p. 4');
});

it('explica que el servidor está pendiente de actualizar en vez de fingir falta de hallazgos', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estado: 'conversando', turnos: [
    { id: 'vieja', texto: 'Fuente 12:14: comprobaciones deterministas' },
  ] }) }));
  await act(async () => root.render(<Vista />));
  expect(nodo.textContent).toContain('actualizando');
  expect(nodo.textContent).not.toContain('comprobaciones deterministas');
});

it('recibe el primer comentario al segundo y conserva una sola petición en vuelo', async () => {
  let resolver: (v: unknown) => void = () => undefined;
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [] }) })
    .mockImplementationOnce(() => new Promise((r) => { resolver = r; }))
    .mockResolvedValue({ ok: true, json: async () => ({ estado: 'pausada', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).activo).toBe(false);
  expect(JSON.parse(fetch.mock.calls[1]![1].body).activo).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetch).toHaveBeenCalledTimes(3);
  await act(async () => { resolver({ ok: true, json: async () => ({ estado: 'conversando', turnos: [
    { id: 'natural', estilo: ESTILO_LABORATORIO, texto: 'Me intriga lo de tau. ¿Tú cómo lo ves?' },
  ] }) }); });
  expect(nodo.textContent).toContain('Me intriga lo de tau');
});

it('no encarga voz antigua y activa la conversación en cuanto el servidor se actualiza', async () => {
  let actualizado = false;
  const fetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => actualizado
    ? { estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [] }
    : { estado: 'conversando', turnos: [{ id: 'antigua', texto: 'Fuente 12:14' }] } }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(nodo.textContent).toContain('actualizando');
  expect(fetch.mock.calls.every((c) => !JSON.parse(c[1].body).activo)).toBe(true);
  actualizado = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
  expect(fetch.mock.calls.some((c) => JSON.parse(c[1].body).activo)).toBe(true);
  expect(nodo.textContent).toContain('conversando');
});

it('se recupera de un fallo de red y retira su visita al desactivar', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValue({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  expect(nodo.textContent).toContain('no_disponible');
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(nodo.textContent).toContain('conversando');
  expect(fetch.mock.calls[0]![1].signal).not.toBe(fetch.mock.calls[1]![1].signal);
  await act(async () => root.render(<Vista activo={false} />));
  const cuerpos = fetch.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(cuerpos.at(-1).activo).toBe(false);
  expect(cuerpos.some((c) => c.activo)).toBe(true);
  expect(cuerpos[0].cliente).toBe(cuerpos.at(-1).cliente);
});

it('una respuesta tardía de otra iteración no sustituye las conversaciones actuales', async () => {
  let resolver: (v: unknown) => void = () => undefined;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolver = r; })).mockResolvedValue({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'esperando_hallazgos', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista it="anterior" />));
  await act(async () => root.render(<Vista it="actual" />));
  await act(async () => { resolver({ ok: true, json: async () => ({ estado: 'conversando', turnos: [{ texto: 'Una conversación antigua' }] }) }); });
  expect(nodo.textContent).not.toContain('antigua'); expect(nodo.textContent).toContain('esperando_hallazgos');
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ iteracionId: 'anterior', activo: false });
});
