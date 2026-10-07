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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [
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

it('conserva las charlas actuales y añade las reacciones nuevas con sus referencias', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [
    { id: 'actual', estilo: ESTILO_LABORATORIO, texto: 'Me intriga lo de tau.' },
    { id: 'reaccion', estilo: ESTILO_LABORATORIO, texto: 'Vale.', emocion: 'alegre', gesto: 'asentir', materiales: [{ id: 'af:a' }] },
  ] }) }));
  await act(async () => root.render(<Vista />));
  const datos = JSON.parse(nodo.textContent!);
  expect(datos.turnos).toHaveLength(2);
  expect(datos.turnos[1]).toMatchObject({ texto: 'Vale.', emocion: 'alegre', gesto: 'asentir', materiales: [{ id: 'af:a' }] });
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
  await act(async () => { resolver({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [
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
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolver = r; })).mockResolvedValue({ ok: true, json: async () => ({ estilo: 'conversacion-natural-v2', estado: 'esperando_hallazgos', turnos: [] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista it="anterior" />));
  await act(async () => root.render(<Vista it="actual" />));
  await act(async () => { resolver({ ok: true, json: async () => ({ estilo: ESTILO_LABORATORIO, estado: 'conversando', turnos: [{ estilo: ESTILO_LABORATORIO, texto: 'Una conversación antigua' }] }) }); });
  expect(nodo.textContent).not.toContain('antigua'); expect(nodo.textContent).toContain('esperando_hallazgos');
  expect(JSON.parse(nodo.textContent!).estilo).toBe('conversacion-natural-v2');
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ iteracionId: 'anterior', activo: false });
});

it.each(['conversacion-natural-v2', ESTILO_LABORATORIO])('negocia %s sin activar la primera visita y conserva solo su voz y procedencia', async (estilo) => {
  const material = { id: 'af:a', clase: 'afirmacion', texto: 'Asociación en ratones', cita: 'PMID:123, p. 4' };
  const turno = { id: 'admitida', estilo, texto: 'Voy a mirar esa asociación.', materiales: [material], emocion: 'curioso', gesto: 'ninguno' };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estilo, estado: 'conversando', turnos: [
    turno,
    { ...turno, id: 'otra-version', estilo: estilo === ESTILO_LABORATORIO ? 'conversacion-natural-v2' : ESTILO_LABORATORIO },
    { ...turno, id: 'v1', estilo: 'conversacion-natural-v1' },
    { id: 'sin-version', texto: 'Fuente 12:14' },
  ] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).activo).toBe(false);
  expect(JSON.parse(nodo.textContent!).turnos).toEqual([turno]);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(JSON.parse(fetch.mock.calls[1]![1].body).activo).toBe(true);
  expect(JSON.parse(nodo.textContent!).estilo).toBe(estilo);
});

it.each([undefined, 'conversacion-natural-v1', 'conversacion-natural-v4', 'desconocido'])('no negocia una versión ausente o desconocida: %s', async (estilo) => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ estilo, estado: 'conversando', turnos: [
    { id: 'suelta', estilo: ESTILO_LABORATORIO, texto: 'Esta voz no basta para negociar la respuesta.' },
    { id: 'antigua', estilo, texto: 'Fuente 12:14' },
  ] }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(JSON.parse(nodo.textContent!)).toMatchObject({ estado: 'actualizando', turnos: [] });
  expect(fetch.mock.calls.every((c) => !JSON.parse(c[1].body).activo)).toBe(true);
});

it('migra de v2 a v3 y rechaza una respuesta posterior v2 sin reiniciar la sesión', async () => {
  let estilo = 'conversacion-natural-v2';
  const fetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ estilo, estado: 'conversando', turnos: [
    { id: 'v2', estilo: 'conversacion-natural-v2', texto: 'Comentario anterior.', materiales: [{ id: 'af:a' }] },
    { id: 'v3', estilo: ESTILO_LABORATORIO, texto: 'Comentario nuevo.', materiales: [{ id: 'af:b', cita: 'PMID:456, p. 2' }] },
  ] }) }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<Vista />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(JSON.parse(nodo.textContent!).turnos.map((t: { id: string }) => t.id)).toEqual(['v2']);
  estilo = ESTILO_LABORATORIO;
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(JSON.parse(nodo.textContent!)).toMatchObject({ estilo: ESTILO_LABORATORIO, turnos: [
    { id: 'v3', materiales: [{ id: 'af:b', cita: 'PMID:456, p. 2' }] },
  ] });
  estilo = 'conversacion-natural-v2';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(JSON.parse(nodo.textContent!)).toMatchObject({ estilo: ESTILO_LABORATORIO, estado: 'actualizando', turnos: [] });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).activo).toBe(false);
  // Una pausa y un cambio de iteración conservan la negociación máxima del hook.
  await act(async () => root.render(<Vista activo={false} />));
  await act(async () => root.render(<Vista it="siguiente" />));
  expect(JSON.parse(nodo.textContent!)).toMatchObject({ estilo: ESTILO_LABORATORIO, estado: 'actualizando', turnos: [] });
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).activo).toBe(false);
  estilo = ESTILO_LABORATORIO;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(JSON.parse(nodo.textContent!)).toMatchObject({ estilo: ESTILO_LABORATORIO, estado: 'conversando' });
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).activo).toBe(true);
});
