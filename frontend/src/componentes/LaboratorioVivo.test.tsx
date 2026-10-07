// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import { rutaNovedad } from '../lib/ruta';
import { LaboratorioVivo } from './LaboratorioVivo';
import { montarLaboratorio, type Respuestas } from './labvivo/motor';

vi.mock('../datos/almacen', () => ({ acciones: {} }));
vi.mock('../lib/conversacionesLaboratorio', () => ({ useConversacionesLaboratorio: () => ({ estado: 'pausada', turnos: [] }) }));
vi.mock('./ConversacionesLaboratorio', () => ({ ConversacionesLaboratorio: () => null }));
vi.mock('./labvivo/motor', () => ({ ANCHO: 1064, ALTO: 1416, montarLaboratorio: vi.fn(() => ({ actualizar: vi.fn(), conversar: vi.fn(), desmontar: vi.fn() })) }));

let nodo: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.location.hash = '#/inicio';
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); vi.unstubAllGlobals(); });

function caso(indice = 0) {
  const estado = estadoDeMuestra(), inv = estado.investigaciones[0]!;
  const corrida = estado.corridas.find(c => c.investigacionId === inv.id)!;
  const iteracion = estado.iteraciones.find(i => i.corridaId === corrida.id && i.numero === corrida.iteracionActual) ?? null;
  const hipotesis = estado.hipotesis.find(h => h.investigacionId === inv.id)!;
  if (indice) {
    inv.id = 'inv-siguiente'; corrida.id = 'cor-siguiente'; corrida.investigacionId = inv.id;
    hipotesis.id = 'hip-siguiente'; hipotesis.investigacionId = inv.id;
    if (iteracion) iteracion.corridaId = corrida.id;
  }
  return { estado, inv, corrida, iteracion, hipotesis };
}
function respuestas(): Respuestas { return vi.mocked(montarLaboratorio).mock.calls[0]![2]; }

it('la entrada del personaje abre su dossier real en la investigación actual', async () => {
  const f = caso();
  await act(async () => root.render(<LaboratorioVivo {...f} onVolver={vi.fn()} />));
  respuestas().verNovedad('patentes', f.hipotesis.id);
  expect(window.location.hash).toBe(rutaNovedad(f.inv.id, f.hipotesis.id, 'patentes'));
});

it('sin ID o con una hipótesis ajena abre solo el índice del especialista', async () => {
  const f = caso();
  f.estado.hipotesis.push({ ...f.hipotesis, id: 'hip-ajena', investigacionId: 'otra-investigacion' });
  await act(async () => root.render(<LaboratorioVivo {...f} onVolver={vi.fn()} />));
  respuestas().verNovedad('companias');
  expect(window.location.hash).toBe(rutaNovedad(f.inv.id, null, 'companias'));
  respuestas().verNovedad('patentes', 'hip-ajena');
  expect(window.location.hash).toBe(rutaNovedad(f.inv.id, null, 'patentes'));
  respuestas().verNovedad('patentes', 'hip-inexistente');
  expect(window.location.hash).toBe(rutaNovedad(f.inv.id, null, 'patentes'));
});

it('una investigación nueva actualiza el contexto del callback sin remontar el motor', async () => {
  const primera = caso(), siguiente = caso(1);
  await act(async () => root.render(<LaboratorioVivo {...primera} onVolver={vi.fn()} />));
  const resp = respuestas();
  await act(async () => root.render(<LaboratorioVivo {...siguiente} onVolver={vi.fn()} />));
  expect(montarLaboratorio).toHaveBeenCalledOnce();
  resp.verNovedad('companias', siguiente.hipotesis.id);
  expect(window.location.hash).toBe(rutaNovedad(siguiente.inv.id, siguiente.hipotesis.id, 'companias'));
  resp.verNovedad('patentes', primera.hipotesis.id);
  expect(window.location.hash).toBe(rutaNovedad(siguiente.inv.id, null, 'patentes'));
});
