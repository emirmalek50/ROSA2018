// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversacionesLaboratorio } from './conversacionesLaboratorio';

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

it('se recupera de un fallo de red y retira su visita al desactivar', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValue({ ok: true, json: async () => ({ estado: 'conversando', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  expect(nodo.textContent).toContain('no_disponible');
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(nodo.textContent).toContain('conversando');
  expect(fetch.mock.calls[0]![1].signal).not.toBe(fetch.mock.calls[1]![1].signal);
  await act(async () => root.render(<Vista activo={false} />));
  const cuerpos = fetch.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(cuerpos.at(-1).activo).toBe(false);
  expect(cuerpos[0].cliente).toBe(cuerpos.at(-1).cliente);
});

it('una respuesta tardía de otra iteración no sustituye las conversaciones actuales', async () => {
  let resolver: (v: unknown) => void = () => undefined;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolver = r; })).mockResolvedValue({ ok: true, json: async () => ({ estado: 'esperando_hallazgos', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista it="anterior" />));
  await act(async () => root.render(<Vista it="actual" />));
  await act(async () => { resolver({ ok: true, json: async () => ({ estado: 'conversando', turnos: [{ texto: 'Una conversación antigua' }] }) }); });
  expect(nodo.textContent).not.toContain('antigua'); expect(nodo.textContent).toContain('esperando_hallazgos');
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ iteracionId: 'anterior', activo: false });
});
