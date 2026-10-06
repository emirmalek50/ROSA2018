// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import { montarLaboratorio, type Laboratorio, type Respuestas } from './motor';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;
function datos(): DatosLab {
  const e = estadoDeMuestra(), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find((c) => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  const anterior = e.iteraciones.find((i) => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso', tipo: 'literatura', estado: 'en_curso' }],
    pistas: [{ ...anterior.pistas[0]!, id: 'real', pasoId: 'paso', estado: 'en_curso', tipo: 'literatura', fuente: 'PubMed', titulo: 'Buscar MAPT', resumen: '', transcripcion: [{ t: 1, tipo: 'accion', texto: 'Consulta: MAPT' }] }],
  };
  return datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [] }, inv, c, i);
}
function montar(d = datos(), r: Partial<Respuestas> = {}) {
  const resp: Respuestas = { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true), verEnLaCorrida: vi.fn(), ...r };
  motor = montarLaboratorio(nodo, d, resp);
  return resp;
}
function ticks(n = 80) { for (let j = 0; j < n; j++) { tiempo += 100; frame(tiempo); } }
beforeEach(() => {
  tiempo = 0; motor = null; nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(async () => { motor?.desmontar(); nodo.remove(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('el motor del laboratorio sigue al servidor', () => {
  it('los diálogos son literales y el tiempo visual no ejecuta capítulos nuevos', async () => {
    montar(); ticks(400); await Promise.resolve();
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
    expect(nodo.querySelector('.lv-ag.activo')?.getAttribute('data-agente')).toBe('Generador de consultas');
    expect(nodo.querySelector('.lv-chip.on')?.textContent).toContain('Buscan y leen');
    expect(nodo.textContent).not.toContain('Yo miro el resto');
  });
  it('una entrada nueva sustituye el diálogo y un estado idéntico no lo reinicia', () => {
    const d = datos(); montar(d);
    const e = { ...d.actividad[0]!, id: 'real:2:2', texto: '<img src=x onerror=alert(1)>: 87 resultados', tipo: 'resultado' as const };
    const siguiente = { ...d, actividad: [...d.actividad, e] };
    motor!.actualizar(siguiente);
    const bocadillo = nodo.querySelector('.lv-bub')!;
    expect(bocadillo.textContent).toContain(e.texto); expect(bocadillo.querySelector('img')).toBeNull();
    motor!.actualizar(siguiente); expect(nodo.querySelector('.lv-bub')).toBe(bocadillo);
  });
  it('la pausa cancela movimientos y la desconexión no deja personajes trabajando', () => {
    const d = datos(); montar(d); ticks(15);
    motor!.actualizar({ ...d, trabajando: false, activos: [], estadoTexto: 'Pausada', salas: { ...d.salas, r1: 'espera' } });
    const antes = [...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform);
    ticks();
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(0);
    const despues = [...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform);
    ticks(); expect([...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform)).toEqual(despues);
    expect(antes.length).toBe(despues.length);
    motor!.actualizar({ ...d, conexion: 'sin_conexion', trabajando: false, activos: [] });
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(0);
  });
  it('navegar entre salas enseña su último registro sin empezar una etapa', () => {
    montar(); (nodo.querySelectorAll('.lv-chip')[4] as HTMLButtonElement).click(); ticks();
    expect(nodo.querySelector('.lv-chip.on')?.textContent).toContain('Las juzgan');
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
    expect(nodo.textContent).not.toContain('Intento tumbarla');
  });
  it('limpia los diálogos de la iteración anterior al cambiar de iteración', () => {
    const d = datos(); montar(d);
    motor!.actualizar({ ...d, identidad: 'otra-iteracion', actividad: [], trabajando: false, activos: [] });
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });
  it('un rechazo real mantiene el permiso pendiente, evita doble envío y permite elegir alcance', async () => {
    const d = { ...datos(), activos: [], trabajando: false, pide: { id: 'permiso', clase: 'permiso' as const, quien: 'Explorador', titulo: 'Acceso a PubMed', detalle: 'Consultar MAPT', alcances: ['una_vez' as const, 'esta_corrida' as const], requiereArgumentos: false } };
    let resolver: (ok: boolean) => void = () => undefined;
    const conceder = vi.fn(() => new Promise<boolean>((r) => { resolver = r; }));
    montar(d, { conceder });
    const select = nodo.querySelector<HTMLSelectElement>('.lv-alcance')!; select.value = 'esta_corrida';
    const b = nodo.querySelector<HTMLButtonElement>('[data-a=si]')!; b.click(); b.click();
    expect(conceder).toHaveBeenCalledTimes(1); expect(conceder).toHaveBeenCalledWith('permiso', 'esta_corrida');
    expect(b.disabled).toBe(true); resolver(false); await Promise.resolve(); await Promise.resolve();
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(false);
    expect(nodo.querySelector('.lv-respuesta')?.textContent).toContain('rechazó'); expect(b.disabled).toBe(false);
    motor!.actualizar({ ...d, pide: null }); expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(true);
    expect(nodo.textContent).not.toContain('¡Gracias! Sigo');
  });
  it('muestra el plan entero y actualiza los pasos cuando se editan', () => {
    const d = { ...datos(), activos: [], trabajando: false, pide: { id: 'plan', clase: 'plan' as const, quien: 'Planificador', titulo: '', detalle: '', alcances: [], requiereArgumentos: false } };
    d.pasos.lista = [{ titulo: 'Buscar MAPT', detalle: 'PubMed' }, { titulo: 'Verificar', detalle: 'Conservar las citas' }];
    montar(d); expect(nodo.querySelectorAll('.lv-pide .plan li')).toHaveLength(2);
    motor!.actualizar({ ...d, pasos: { ...d.pasos, lista: [{ titulo: 'Plan editado', detalle: 'Consulta nueva' }] } });
    expect(nodo.querySelector('.lv-pide .plan')?.textContent).toContain('Plan editado');
    expect(nodo.querySelector('.lv-pide .plan')?.textContent).not.toContain('Buscar MAPT');
  });
  it('no concede solicitudes que requieren argumentos adicionales', () => {
    const d = { ...datos(), activos: [], trabajando: false, pide: { id: 'permiso', clase: 'permiso' as const, quien: 'Planificador', titulo: 'Presupuesto', detalle: 'Importe', alcances: ['una_vez' as const], requiereArgumentos: true } };
    const resp = montar(d); expect(nodo.querySelector('[data-a=si]')).toBeNull();
    (nodo.querySelector('.lv-pide .yes') as HTMLButtonElement).click(); expect(resp.verEnLaCorrida).toHaveBeenCalledOnce(); expect(resp.conceder).not.toHaveBeenCalled();
  });
});
