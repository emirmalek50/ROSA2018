// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Corrida, EstadoRosa, Iteracion } from '../datos/tipos';
import type { Evidencia } from '../lib/evidencia';
import type { DatosLab } from '../lib/labVivo';
import { senalDeTope } from '../lib/diferido';
import { rutaNovedad } from '../lib/ruta';
import { LaboratorioVivo } from './LaboratorioVivo';
import { montarLaboratorio, type Respuestas } from './labvivo/motor';

vi.mock('../datos/almacen', () => ({ acciones: {}, cabeceras: () => ({ 'X-Rosa': '1' }) }));
vi.mock('../lib/diferido', () => ({ senalDeTope: vi.fn(() => ({})) }));
vi.mock('../lib/conversacionesLaboratorio', () => ({ useConversacionesLaboratorio: () => ({ estado: 'pausada', turnos: [] }) }));
vi.mock('./ConversacionesLaboratorio', () => ({ ConversacionesLaboratorio: () => null }));
vi.mock('./labvivo/motor', () => ({ ANCHO: 1064, ALTO: 1416, montarLaboratorio: vi.fn(() => ({ actualizar: vi.fn(), conversar: vi.fn(), desmontar: vi.fn() })) }));

let nodo: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(senalDeTope).mockReset().mockReturnValue({});
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.location.hash = '#/inicio';
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

function enLinea(tipo: 'extraccion' | 'verificacion' = 'verificacion') {
  const f = caso(), original = f.iteracion!;
  const iteracion: Iteracion = { ...original, numero: 1, terminadaEn: null, resumen: '', planAprobado: true,
    pistas: [{ ...original.pistas[0]!, id: 'pista-cadena', tipo, estado: 'en_curso' as const, transcripcion: [] }],
  };
  const corrida: Corrida = { ...f.corrida, iteracionActual: 1, estado: 'en_marcha', terminadaEn: null };
  const estado: EstadoRosa = { ...f.estado, conexion: 'en_linea', corridas: [corrida], iteraciones: [iteracion], solicitudes: [], incidencias: [] };
  return { ...f, corrida, iteracion, estado };
}
type CasoEnLinea = ReturnType<typeof enLinea>;
function cadena(f: CasoEnLinea, version = 1): Evidencia {
  return { corridaId: f.corrida.id, version, consultas: [], fuentes: [], afirmaciones: [{
    id: 'af-real', texto: 'Asociación descrita en el registro', cita: 'Artículo de fixture, p. 4', veredicto: 'sostenida', motivo: 'El fragmento contiene la asociación',
    entidadDistinta: false, tipo: 'literatura', tema: '', fuenteId: 'fuente-real', localizador: 'p. 4', iteracion: f.iteracion.numero,
  }] };
}
const devolverCadena = (d: Evidencia) => ({ ok: true, json: async () => d });
function ultimoDato(): DatosLab {
  const lab = vi.mocked(montarLaboratorio).mock.results[0]!.value;
  return vi.mocked(lab.actualizar).mock.calls.at(-1)![0];
}
async function pintar(f: CasoEnLinea) {
  await act(async () => root.render(<LaboratorioVivo {...f} onVolver={vi.fn()} />));
}
function anadirEntrada(f: CasoEnLinea, tipo: 'resultado' | 'nota', texto: string) {
  const p = f.iteracion.pistas[0]!;
  f.iteracion = { ...f.iteracion, pistas: [{ ...p, transcripcion: [...p.transcripcion, { t: p.transcripcion.length, tipo, texto }] }] };
  f.estado = { ...f.estado, iteraciones: [f.iteracion] };
}
async function avanzar(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function esperarHastaAborto(_url: RequestInfo | URL, opciones?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = opciones?.signal;
    const cancelar = () => reject(new DOMException('Petición abortada', 'AbortError'));
    if (signal?.aborted) cancelar();
    else signal?.addEventListener('abort', cancelar, { once: true });
  });
}

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

it('la evidencia real llega a las afirmaciones y también a la película del motor', async () => {
  const f = enLinea(), ev = cadena(f);
  vi.mocked(fetch).mockResolvedValue(devolverCadena(ev) as Response);
  await pintar(f);
  expect(ultimoDato().afirmaciones).toEqual([expect.objectContaining({ id: 'af-real', veredicto: 'sostenida', cita: ev.afirmaciones[0]!.cita })]);
  expect(ultimoDato().pelicula?.eventos).toContainEqual(expect.objectContaining({ id: expect.stringContaining('afirmacion:'), texto: expect.stringContaining(ev.afirmaciones[0]!.texto) }));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/evidencia'), expect.objectContaining({ headers: { 'X-Rosa': '1' }, signal: expect.any(AbortSignal) }));
});

it('rechaza una respuesta de otra corrida y una cadena sin sus listas contractuales', async () => {
  const f = enLinea(), ajena = { ...cadena(f), corridaId: 'otra-corrida' };
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(ajena) as Response);
  await pintar(f);
  expect(ultimoDato().afirmaciones).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena({ corridaId: f.corrida.id } as Evidencia) as Response);
  f.corrida = { ...f.corrida, gasto: { ...f.corrida.gasto, llamadas: f.corrida.gasto.llamadas + 20 } };
  await pintar(f);
  expect(ultimoDato().afirmaciones).toBeNull();
});

it('agrupa las entradas del juez sin refrescar por cada fragmento de texto', async () => {
  const f = enLinea();
  vi.mocked(fetch).mockResolvedValue(devolverCadena(cadena(f)) as Response);
  await pintar(f);
  for (let n = 0; n < 12; n++) { anadirEntrada(f, 'nota', `Fragmento ${n}`); await pintar(f); }
  for (let n = 0; n < 4; n++) { anadirEntrada(f, 'resultado', `Decisión ${n}`); await pintar(f); }
  expect(fetch).toHaveBeenCalledTimes(1);
  anadirEntrada(f, 'resultado', 'Quinta decisión'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(montarLaboratorio).toHaveBeenCalledTimes(1);
});

it('refresca al llegar progreso real del juez aunque aún no haya cinco entradas', async () => {
  const f = enLinea();
  vi.mocked(fetch).mockResolvedValue(devolverCadena(cadena(f)) as Response);
  await pintar(f);
  anadirEntrada(f, 'resultado', 'Deterministas: 4 resueltas sin juez; 10 van al juez'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 10'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('refresca por fuentes extraídas y por el cierre de la tarea sin esperar otras llamadas', async () => {
  const f = enLinea('extraccion');
  vi.mocked(fetch).mockResolvedValue(devolverCadena(cadena(f)) as Response);
  await pintar(f);
  anadirEntrada(f, 'nota', 'Leyendo un fragmento'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(1);
  anadirEntrada(f, 'resultado', 'Fuente 1 de 2: artículo, 3 afirmaciones (3 acumuladas)'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  f.iteracion = { ...f.iteracion, pistas: [{ ...f.iteracion.pistas[0]!, estado: 'hecha' }] };
  await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('aborta la petición anterior al cambiar de corrida y no aplica su respuesta tardía', async () => {
  const f = enLinea();
  let completar!: (r: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { completar = resolve; }));
  await pintar(f);
  const senalAnterior = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  const siguiente = enLinea();
  siguiente.corrida = { ...siguiente.corrida, id: 'cor-siguiente' };
  siguiente.iteracion = { ...siguiente.iteracion, id: 'it-siguiente', corridaId: siguiente.corrida.id };
  siguiente.estado = { ...siguiente.estado, corridas: [siguiente.corrida], iteraciones: [siguiente.iteracion] };
  const ev = cadena(siguiente); ev.afirmaciones[0]!.id = 'af-siguiente';
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(ev) as Response);
  await pintar(siguiente);
  expect(senalAnterior.aborted).toBe(true);
  await act(async () => completar(devolverCadena(cadena(f)) as Response));
  expect(ultimoDato().afirmaciones?.map(a => a.id)).toEqual(['af-siguiente']);
  expect(montarLaboratorio).toHaveBeenCalledTimes(1);
});

it('conserva el tope de espera y también aborta al desmontar', async () => {
  vi.useFakeTimers();
  const f = enLinea(), tope = new AbortController();
  vi.mocked(senalDeTope).mockReturnValueOnce({ signal: tope.signal });
  vi.mocked(fetch).mockImplementation(esperarHastaAborto);
  await pintar(f);
  const primera = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  await act(async () => tope.abort()); expect(primera.aborted).toBe(true);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 20'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(1);
  await avanzar(10000);
  const segunda = vi.mocked(fetch).mock.calls[1]![1]!.signal!;
  expect(segunda).not.toBe(primera); expect(segunda.aborted).toBe(false);
  expect(senalDeTope).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(segunda.aborted).toBe(true);
  await avanzar(60000); expect(fetch).toHaveBeenCalledTimes(2);
});

it('no retrocede a una versión de evidencia más antigua de la misma corrida', async () => {
  const f = enLinea(), reciente = cadena(f, 8), antigua = cadena(f, 7);
  reciente.afirmaciones[0]!.texto = 'Resultado actual'; antigua.afirmaciones[0]!.texto = 'Resultado antiguo';
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(reciente) as Response).mockResolvedValueOnce(devolverCadena(antigua) as Response);
  await pintar(f);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 20'); await pintar(f);
  expect(ultimoDato().afirmaciones?.[0]?.texto).toBe('Resultado actual');
});

it('el historial usa la misma cadena filtrada a la iteración elegida, sin nueva petición', async () => {
  const f = enLinea(), anterior = { ...f.iteracion, numero: 1, terminadaEn: Date.now() };
  f.iteracion = { ...f.iteracion, id: 'iteracion-actual', numero: 2 };
  f.corrida = { ...f.corrida, iteracionActual: 2 };
  f.estado = { ...f.estado, iteraciones: [anterior, f.iteracion], corridas: [f.corrida] };
  const ev = cadena(f); ev.afirmaciones.push({ ...ev.afirmaciones[0]!, id: 'af-anterior', iteracion: 1 });
  vi.mocked(fetch).mockResolvedValue(devolverCadena(ev) as Response);
  await pintar(f);
  expect(ultimoDato().afirmaciones?.map(a => a.id)).toEqual(['af-real']);
  const boton = nodo.querySelector<HTMLButtonElement>('button[aria-label="Iteración anterior"]')!;
  await act(async () => boton.click());
  expect(ultimoDato().afirmaciones?.map(a => a.id)).toEqual(['af-anterior']);
  expect(ultimoDato().pasada).toBe(true);
  expect(ultimoDato().trabajando).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('refresca cada diez segundos aunque el SSE no cambie la clave, sin peticiones simultáneas', async () => {
  vi.useFakeTimers();
  const f = enLinea(), inicial = cadena(f, 8), actual = cadena(f, 9);
  actual.afirmaciones[0]!.veredicto = 'no_sostenida';
  let completar!: (r: Response) => void;
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(inicial) as Response)
    .mockImplementationOnce(() => new Promise(resolve => { completar = resolve; }))
    .mockResolvedValue(devolverCadena(actual) as Response);
  await pintar(f); await avanzar(9999); expect(fetch).toHaveBeenCalledTimes(1);
  await avanzar(1); expect(fetch).toHaveBeenCalledTimes(2);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 30'); await pintar(f);
  anadirEntrada(f, 'resultado', 'Juez: 20 de 30'); await pintar(f);
  await avanzar(60000); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => completar(devolverCadena(actual) as Response));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(ultimoDato().afirmaciones![0]!.veredicto).toBe('no_sostenida');
  expect(ultimoDato().juez.veredictos).toEqual({ sostenida: 0, parcial: 0, no_sostenida: 1, otras: 0 });
  await avanzar(9999); expect(fetch).toHaveBeenCalledTimes(3);
  await avanzar(1); expect(fetch).toHaveBeenCalledTimes(4);
});

it('un 503 no deja congelado el veredicto anterior y el progreso no salta el backoff', async () => {
  vi.useFakeTimers();
  const f = enLinea(), inicial = cadena(f, 8), actual = cadena(f, 9);
  actual.afirmaciones[0]!.veredicto = 'parcial';
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(inicial) as Response)
    .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    .mockResolvedValue(devolverCadena(actual) as Response);
  await pintar(f);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 20'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(ultimoDato().afirmaciones![0]!.veredicto).toBe('sostenida');
  anadirEntrada(f, 'resultado', 'Juez: 20 de 20'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  await avanzar(9999); expect(fetch).toHaveBeenCalledTimes(2);
  await avanzar(1); expect(fetch).toHaveBeenCalledTimes(3);
  expect(ultimoDato().afirmaciones![0]!.veredicto).toBe('parcial');
  expect(ultimoDato().juez.veredictos).toEqual({ sostenida: 0, parcial: 1, no_sostenida: 0, otras: 0 });
});

it('los fallos repetidos esperan diez, veinte y como máximo treinta segundos', async () => {
  vi.useFakeTimers();
  const f = enLinea();
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502 } as Response);
  await pintar(f);
  for (const [ms, antes] of [[10000, 1], [20000, 2], [30000, 3], [30000, 4]]) {
    await avanzar(ms! - 1); expect(fetch).toHaveBeenCalledTimes(antes!);
    await avanzar(1); expect(fetch).toHaveBeenCalledTimes(antes! + 1);
  }
  expect(ultimoDato().afirmaciones).toBeNull();
});

it.each([401, 403])('no reintenta un acceso rechazado %s por reloj ni por progreso', async status => {
  vi.useFakeTimers();
  const f = enLinea();
  vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response);
  await pintar(f); await avanzar(90000);
  anadirEntrada(f, 'resultado', 'Juez: 10 de 20'); await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(1);
  f.estado = { ...f.estado, conexion: 'sin_conexion' }; await pintar(f);
  vi.mocked(fetch).mockResolvedValue(devolverCadena(cadena(f)) as Response);
  f.estado = { ...f.estado, conexion: 'en_linea' }; await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2); expect(ultimoDato().afirmaciones).toHaveLength(1);
});

it('no mantiene polling tras pausar y limpia el reloj al desconectar o entrar en muestra', async () => {
  vi.useFakeTimers();
  const f = enLinea(); vi.mocked(fetch).mockResolvedValue(devolverCadena(cadena(f)) as Response);
  await pintar(f);
  f.corrida = { ...f.corrida, estado: 'pausada' }; await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(2);
  await avanzar(60000); expect(fetch).toHaveBeenCalledTimes(2);
  f.corrida = { ...f.corrida, estado: 'en_marcha' }; await pintar(f);
  expect(fetch).toHaveBeenCalledTimes(3);
  f.estado = { ...f.estado, conexion: 'sin_conexion' }; await pintar(f);
  await avanzar(60000); expect(fetch).toHaveBeenCalledTimes(3);
  f.estado = { ...f.estado, conexion: 'muestra' }; await pintar(f);
  await avanzar(60000); expect(fetch).toHaveBeenCalledTimes(3);
  expect(ultimoDato().afirmaciones).toBeNull();
});

it('rechaza una versión malformada y la recuperación puede cargar una cadena válida', async () => {
  vi.useFakeTimers();
  const f = enLinea(), invalida = { ...cadena(f), version: Number.NaN };
  vi.mocked(fetch).mockResolvedValueOnce(devolverCadena(invalida) as Response)
    .mockResolvedValue(devolverCadena(cadena(f, 9)) as Response);
  await pintar(f); expect(ultimoDato().afirmaciones).toBeNull();
  await avanzar(10000); expect(ultimoDato().afirmaciones).toHaveLength(1);
});
