// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
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
  return datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i);
}
function montar(d = datos(), r: Partial<Respuestas> = {}) {
  const resp: Respuestas = { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true), ampliarPresupuesto: vi.fn(async () => true), resolverIncidencia: vi.fn(async () => true), verEnLaCorrida: vi.fn(), verNovedad: vi.fn(), ...r };
  motor = montarLaboratorio(nodo, d, resp);
  return resp;
}
function ticks(n = 80) { for (let j = 0; j < n; j++) { tiempo += 100; frame(tiempo); } }
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    ticks(1);
    // Las caminatas encadenan promesas; un frame real deja que se resuelvan.
    for (let k = 0; k < 4; k++) await Promise.resolve();
    observar?.();
  }
}
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
  it('ambos especialistas existen y reciben actividad sin recrear los personajes al actualizar', async () => {
    const d = datos(), a = { ...d.actividad[0]!, agente: 'Especialista en patentes', sala: 'r7' as const, texto: 'Revisión de patentes del tratamiento' };
    const actual = { ...d, foco: 'r7' as const, salas: { ...d.salas, r7: 'ahora' as const }, activos: ['Especialista en patentes'], actividad: [a] };
    montar(actual); await avanzar(10);
    const patentes = nodo.querySelector<HTMLElement>('[data-agente="Especialista en patentes"]')!;
    const companias = nodo.querySelector<HTMLElement>('[data-agente="Especialista en compañías"]')!;
    expect(patentes).not.toBeNull(); expect(companias).not.toBeNull();
    expect([...nodo.querySelectorAll<HTMLElement>('.lv-ag[data-sala="r7"]')].map(a => a.dataset.agente)).toEqual(['Especialista en patentes', 'Especialista en compañías']);
    expect(nodo.querySelector('.lv-sala[data-sala="r7"]')?.textContent).toContain('Patentes y compañías');
    expect(patentes.classList.contains('activo')).toBe(true);
    motor!.actualizar({ ...actual, activos: ['Especialista en compañías'], actividad: [{ ...a, id: 'companias-real', agente: 'Especialista en compañías' }] });
    expect(nodo.querySelector('[data-agente="Especialista en patentes"]')).toBe(patentes);
    expect(nodo.querySelector('[data-agente="Especialista en compañías"]')).toBe(companias);
    expect(patentes.classList.contains('activo')).toBe(false); expect(companias.classList.contains('activo')).toBe(true);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });
  it('click y Enter abren el dossier del especialista con el ID explícito, sin ficha ni zoom genéricos', () => {
    const d = datos(), a = { ...d.actividad[0]!, agente: 'Especialista en patentes', sala: 'r7' as const, hipotesisId: 'hip-real' };
    const resp = montar({ ...d, foco: 'r7', activos: ['Especialista en patentes'], actividad: [a] });
    const sofia = nodo.querySelector<HTMLElement>('[data-agente="Especialista en patentes"]')!;
    sofia.dispatchEvent(new MouseEvent('mouseenter'));
    expect(nodo.querySelector<HTMLElement>('.lv-ficha')!.hidden).toBe(true);
    expect(sofia.getAttribute('aria-label')).toContain('Sofía'); expect(sofia.getAttribute('aria-label')).toContain('Abrir dossier en Novedad');
    sofia.click(); expect(resp.verNovedad).toHaveBeenCalledWith('patentes', 'hip-real');
    expect(sofia.classList.contains('sel')).toBe(false); expect(nodo.querySelector<HTMLElement>('.lv-ficha')!.hidden).toBe(true);
    const damian = nodo.querySelector<HTMLElement>('[data-agente="Especialista en compañías"]')!;
    damian.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(resp.verNovedad).toHaveBeenLastCalledWith('companias', undefined);
    expect(nodo.querySelector<HTMLElement>('.lv-ficha')!.hidden).toBe(true);
    expect(resp.verEnLaCorrida).not.toHaveBeenCalled();
  });
  it('el dossier usa la asociación más reciente de su agente y el replay conserva el ID real', () => {
    const d = datos(), a = { ...d.actividad[0]!, agente: 'Especialista en compañías', sala: 'r7' as const, hipotesisId: 'hip-anterior' };
    const resp = montar({ ...d, trabajando: false, pasada: true, activos: [], actividad: [a] });
    const damian = nodo.querySelector<HTMLElement>('[data-agente="Especialista en compañías"]')!;
    damian.click(); expect(resp.verNovedad).toHaveBeenLastCalledWith('companias', 'hip-anterior');
    motor!.actualizar({ ...d, actividad: [a, { ...a, id: 'registro-nuevo', hipotesisId: 'hip-siguiente' }] });
    damian.click(); expect(resp.verNovedad).toHaveBeenLastCalledWith('companias', 'hip-siguiente');
    motor!.actualizar({ ...d, actividad: [a, { ...a, id: 'sin-asociacion', hipotesisId: null, titulo: 'Especialista en compañías: hip-inventada' }] });
    damian.click(); expect(resp.verNovedad).toHaveBeenLastCalledWith('companias', undefined);
    expect(nodo.querySelector('[data-agente="Especialista en compañías"]')).toBe(damian);
  });
  it('Sofía y Damián siguen conversando y caminando dentro de su cuarto, sin reiniciar los personajes', async () => {
    const d = datos(), actividad = { ...d.actividad[0]!, sala: 'r7' as const, agente: 'Especialista en patentes', hipotesisId: 'hip-real' };
    const estado = { ...d, foco: 'r7' as const, activos: ['Especialista en patentes'], actividad: [actividad] };
    const resp = montar(estado);
    const sofia = nodo.querySelector<HTMLElement>('[data-agente="Especialista en patentes"]')!;
    const damian = nodo.querySelector<HTMLElement>('[data-agente="Especialista en compañías"]')!;
    const base: TurnoLaboratorio = { id: 'sofia-1', temaId: 'novedad-real', iteracionId: d.identidad.split('/')[1]!, idioma: 'es', agente: 'Especialista en patentes', destinatario: 'Especialista en compañías', texto: 'Encontré una reivindicación parecida. ¿Tú ves el mismo tratamiento?', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    motor!.conversar([base, { ...base, id: 'damian-1', agente: base.destinatario, destinatario: base.agente, texto: 'Vale, voy a comprobar qué intervención están probando.' }]);
    const vistos = new Set<string>(), posiciones = new Set<string>();
    await avanzar(430, () => {
      for (const p of [sofia, damian]) {
        const m = /translate\(([\d.-]+)px,([\d.-]+)px\)/.exec(p.style.transform);
        expect(m).not.toBeNull();
        if (m) { expect(Number(m[1])).toBeGreaterThanOrEqual(440); expect(Number(m[1]) + 48).toBeLessThanOrEqual(1064); expect(Number(m[2])).toBeGreaterThanOrEqual(652); expect(Number(m[2]) + 64).toBeLessThanOrEqual(752); }
      }
      posiciones.add(sofia.style.transform);
      nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach(b => vistos.add(b.dataset.turno!));
      if (tiempo % 1000 === 0) motor!.actualizar(estado);
    });
    expect(vistos).toEqual(new Set(['sofia-1', 'damian-1'])); expect(posiciones.size).toBeGreaterThan(10);
    expect(nodo.querySelector('[data-agente="Especialista en patentes"]')).toBe(sofia);
    expect(nodo.querySelector('[data-agente="Especialista en compañías"]')).toBe(damian);
    expect(resp.verNovedad).not.toHaveBeenCalled();
  });
  it('la voz sigue el registro y el tiempo visual no ejecuta capítulos nuevos', async () => {
    montar(); ticks(400); await Promise.resolve();
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
    expect(nodo.querySelector('.lv-ag.activo')?.getAttribute('data-agente')).toBe('Generador de consultas');
    expect(nodo.querySelector('.lv-chip.on')?.textContent).toContain('Buscan y leen');
    expect(nodo.textContent).not.toContain('Yo miro el resto');
  });
  it('los registros técnicos no se convierten en voz ni en comentarios de la ficha', () => {
    const d = datos();
    const original = 'El Killer revisa «MAPT»: comprobaciones deterministas, fuente 12:14';
    const e = { ...d.actividad[0]!, agente: 'Killer', sala: 'r4' as const, texto: original };
    montar({ ...d, foco: 'r4', activos: ['Killer'], actividad: [e] });
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
    nodo.querySelector<HTMLElement>('[data-agente="Killer"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(nodo.querySelector('.lv-ahora b')?.textContent).toBe('Preparando el siguiente intercambio');
    expect(nodo.querySelector('.lv-ficha')?.textContent).not.toContain(original);
    expect(e.texto).toBe(original);
  });
  it('el registro queda consultable sin convertir los datos crudos en diálogo', () => {
    const d = datos(); montar(d);
    const e = { ...d.actividad[0]!, id: 'real:2:2', texto: '<img src=x onerror=alert(1)>: 87 resultados', tipo: 'resultado' as const };
    const siguiente = { ...d, actividad: [...d.actividad, e] };
    motor!.actualizar(siguiente);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
    expect(nodo.textContent).toContain(e.texto); expect(nodo.querySelector('img[src=x]')).toBeNull();
    motor!.actualizar(siguiente); expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
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
  it('la pausa abre la misma lupa de gasto y amplía el tope con las llamadas de más', async () => {
    const d = { ...datos(), estado: 'pausada_por_presupuesto' as const, activos: [], trabajando: false,
      pide: { id: 'presupuesto', clase: 'presupuesto' as const, quien: 'Planificador', titulo: 'La iteración 1 necesita al menos 5 llamadas más para seguir', detalle: 'La corrida lleva 369 de 1500 llamadas y está en pausa.', alcances: [], requiereArgumentos: false, presupuesto: { corridaId: 'corrida-real', limite: 1500, usado: 369, propuesta: 5 } } };
    const resp = montar(d, { ampliarPresupuesto: vi.fn(async () => false) });
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(false);
    expect(nodo.querySelector('.lv-bub.ask')?.textContent).toBe('¿Puedo gastar 5 llamadas más?');
    expect(nodo.querySelector('.lv-permiso-voz')?.textContent).toBe('¿Puedo gastar 5 llamadas más?');
    expect(nodo.querySelector('.lv-pide')?.textContent).toContain(d.pide.detalle);
    expect(nodo.querySelector('.lv-pide-presupuesto .lv-permiso-personaje canvas')).not.toBeNull();
    const input = nodo.querySelector<HTMLInputElement>('.lv-llamadas')!;
    expect(input.value).toBe('5');
    expect(nodo.querySelector('.lv-permiso-tope')?.textContent).toContain('1.505');
    expect(resp.ampliarPresupuesto).not.toHaveBeenCalled();
    const rueda = () => { const e = new WheelEvent('wheel', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; };
    expect(rueda()).toBe(true);
    motor!.actualizar(d); ticks(20);
    expect(nodo.querySelector('[data-a=si]')).toBeNull();
    expect(nodo.querySelector('[data-a=no]')).toBeNull();
    expect(nodo.querySelector('[data-a=luego]')).not.toBeNull();
    input.value = '40'; input.dispatchEvent(new Event('input'));
    expect(nodo.querySelector('.lv-permiso-acciones .yes')?.textContent).toBe('Aprobar 40');
    nodo.querySelector<HTMLButtonElement>('[data-a=presupuesto]')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(resp.conceder).not.toHaveBeenCalled(); expect(resp.denegar).not.toHaveBeenCalled();
    expect(resp.ampliarPresupuesto).toHaveBeenCalledWith('corrida-real', 1540);
    expect(nodo.querySelector('.lv-respuesta')?.textContent).toContain('rechazó');
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(false);
    motor!.actualizar({ ...d, estado: 'en_marcha', pide: null });
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(true);
    expect(rueda()).toBe(false);
  });
  it('el permiso de gasto permite ajustar llamadas y alcance sin salir del laboratorio', async () => {
    const d = { ...datos(), trabajando: false, activos: [], pide: { id: 'gasto-real', clase: 'permiso' as const, tipo: 'presupuesto_grande' as const, quien: 'Planificador', titulo: 'Gastar 447 llamadas', detalle: 'Buscar una réplica independiente', alcances: ['una_vez' as const, 'esta_corrida' as const], requiereArgumentos: true,
      argumentos: [{ nombre: 'llamadas', valor: '447', editable: true }], presupuesto: { corridaId: 'corrida-real', limite: 1500, usado: 642 } } };
    const resp = montar(d), input = nodo.querySelector<HTMLInputElement>('.lv-llamadas')!;
    expect(nodo.querySelector('.lv-permiso-voz')?.textContent).toBe('¿Puedo gastar 447 llamadas?');
    input.value = '859'; nodo.querySelector<HTMLButtonElement>('[data-a=si]')!.click(); expect(resp.conceder).not.toHaveBeenCalled();
    input.value = '300'; input.dispatchEvent(new Event('input'));
    nodo.querySelector<HTMLInputElement>('input[value=esta_corrida]')!.click();
    nodo.querySelector<HTMLButtonElement>('[data-a=si]')!.click(); nodo.querySelector<HTMLButtonElement>('[data-a=si]')!.click();
    expect(resp.conceder).toHaveBeenCalledOnce(); expect(resp.conceder).toHaveBeenCalledWith('gasto-real', 'esta_corrida', { llamadas: '300' });
    expect(input.disabled).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(false);
    motor!.actualizar({ ...d, pide: null }); expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(true);
  });
  it('Esc cierra la pantalla de gasto sin denegar ni cambiar el presupuesto', () => {
    const d = { ...datos(), trabajando: false, activos: [], pide: { id: 'presupuesto', clase: 'presupuesto' as const, quien: 'Planificador', titulo: 'Presupuesto', detalle: '', alcances: [], requiereArgumentos: false, presupuesto: { corridaId: 'real', limite: 100, usado: 100 } } };
    const resp = montar(d);
    nodo.querySelector<HTMLInputElement>('.lv-llamadas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(nodo.querySelector<HTMLElement>('.lv-pide')!.hidden).toBe(true);
    expect(resp.ampliarPresupuesto).not.toHaveBeenCalled(); expect(resp.denegar).not.toHaveBeenCalled();
  });
  it('una incidencia abre la lupa y se resuelve con lo que propone o con otra resolución', async () => {
    const d = { ...datos(), pide: { id: 'inc-real', clase: 'incidencia' as const, quien: 'Generador de consultas', titulo: 'Claude Sonnet 5 tarda más de 240 s con esta petición', detalle: 'La petición sigue sin respuesta.', alcances: [], requiereArgumentos: false,
      incidencia: { tipo: 'modelo_bloqueado' as const, recurso: 'anthropic/claude-sonnet-5', alternativa: 'Revisar el paso o la petición.', corridaEnMarcha: true } } };
    const resp = montar(d, { resolverIncidencia: vi.fn(async () => false) });
    const lupa = nodo.querySelector<HTMLElement>('.lv-pide.lv-pide-presupuesto')!;
    expect(lupa.hidden).toBe(false);
    expect(lupa.textContent).toContain('Revisar el paso o la petición.');
    expect(lupa.textContent).toContain('La corrida sigue con lo demás mientras decides.');
    expect(nodo.querySelector('.lv-foco-pide')?.textContent).toContain('encontró un problema');
    const rueda = new WheelEvent('wheel', { cancelable: true, bubbles: true }); document.body.dispatchEvent(rueda);
    expect(rueda.defaultPrevented).toBe(true);
    const input = nodo.querySelector<HTMLInputElement>('.lv-resolucion')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(resp.resolverIncidencia).toHaveBeenCalledWith('inc-real', 'Revisar el paso o la petición.');
    await Promise.resolve(); await Promise.resolve();
    expect(nodo.querySelector('.lv-respuesta')?.textContent).toContain('rechazó');
    input.value = 'Usar otro proveedor'; input.dispatchEvent(new Event('input'));
    expect(nodo.querySelector('.lv-permiso-acciones .yes')?.textContent).toBe('Aplicar mi resolución');
    nodo.querySelector<HTMLButtonElement>('[data-a=incidencia]')!.click();
    expect(resp.resolverIncidencia).toHaveBeenLastCalledWith('inc-real', 'Usar otro proveedor');
    await Promise.resolve(); await Promise.resolve();
    motor!.actualizar({ ...d, pide: null });
    expect(lupa.hidden).toBe(true);
  });
  it('sigue caminando entre entradas sin inventar conversaciones', async () => {
    const d = datos(), texto = 'El Killer revisa «Una hipótesis real sobre MAPT»';
    const e = { ...d.actividad[0]!, agente: 'Killer', sala: 'r4' as const, texto };
    const estado = { ...d, foco: 'r4' as const, activos: ['Killer'], actividad: [e] };
    const resp = montar(estado), killer = nodo.querySelector<HTMLElement>('[data-agente="Killer"]')!;
    const posiciones = new Set<string>();
    await avanzar(600, () => {
      if (tiempo % 1000 === 0) motor!.actualizar(estado);
      if (tiempo > 30000) posiciones.add(killer.style.transform);
      expect(nodo.querySelectorAll('.lv-bub[data-escena]')).toHaveLength(0);
      expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
    });
    expect(posiciones.size).toBeGreaterThan(20);
    expect(estado.actividad).toEqual([e]); expect(e.texto).toBe(texto);
    expect(resp.aprobarPlan).not.toHaveBeenCalled(); expect(resp.conceder).not.toHaveBeenCalled();
  });
  it('representa el intercambio generado y la respuesta, con procedencia sin duplicados', async () => {
    const d = datos(); montar(d);
    const turno: TurnoLaboratorio = { id: 'dialogo-1', temaId: 'tema', iteracionId: d.identidad.split('/')[1]!, idioma: 'es',
      agente: 'Generador de consultas', destinatario: 'Explorador', texto: 'Yo encontré una asociación en ratones. ¿Qué límite destacarías?', fecha: Date.now(), modelo: 'modelo-prueba',
      materiales: [{ id: 'fuente-1', clase: 'afirmacion', texto: 'Asociación en ratones', cita: 'PMID:123, p. 4' }] };
    const respuesta = { ...turno, id: 'dialogo-2', agente: turno.destinatario, destinatario: turno.agente, texto: 'Yo destacaría que una asociación no establece causalidad.' };
    motor!.conversar([turno, respuesta]);
    const vistos = new Set<string>();
    await avanzar(450, () => {
      for (const b of nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')) {
        vistos.add(b.dataset.turno!);
        expect(b.title).toBe(b.dataset.turno === turno.id ? turno.texto : respuesta.texto);
        expect(b.title).not.toContain('PMID');
        expect(b.dataset.interlocutor).toBe(b.dataset.turno === turno.id ? turno.destinatario : turno.agente);
      }
    });
    expect([...vistos]).toEqual([turno.id, respuesta.id]);
    motor!.conversar([turno, respuesta]);
    await avanzar(300);
    expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(0);
    nodo.querySelector<HTMLElement>('[data-agente="Explorador"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(nodo.querySelector('.lv-ficha .lv-charla')?.textContent).toContain(respuesta.texto);
    expect(d.actividad).toHaveLength(1);
  });
  it('silencia los bocadillos y no reproduce conversaciones de otra iteración o antiguas', async () => {
    const d = datos(); montar(d);
    const t: TurnoLaboratorio = { id: '1', temaId: 'tema', iteracionId: d.identidad.split('/')[1]!, idioma: 'es', agente: 'Generador de consultas', destinatario: 'Explorador', texto: 'Yo revisaría los límites de esta asociación.', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    motor!.conversar([{ ...t, id: 'otra', iteracionId: 'otra' }, { ...t, id: 'antigua', fecha: Date.now() - 100000 }]);
    await avanzar(300); expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(0);
    motor!.conversar([t]);
    for (let n = 0; n < 150 && !nodo.querySelector('.lv-bub[data-turno]'); n++) await avanzar(1);
    expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(1);
    motor!.conversar([t], false);
    expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(0);
    await avanzar(250); expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(0);
  });
  it('varias salas conversan a la vez sin marcar como trabajadores a quienes esperan', async () => {
    const d = datos(), resp = montar(d);
    const base: TurnoLaboratorio = { id: '', temaId: '', iteracionId: d.identidad.split('/')[1]!, idioma: 'es',
      agente: '', destinatario: '', texto: 'Hmm, quiero mirar mejor lo que leyeron sobre MAPT. ¿Tú cómo lo ves?', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    const parejas = [
      ['Generador de consultas', 'Explorador'], ['Planificador', 'Proponente de experimento'],
      ['Analogía', 'Contradicción'], ['Revisor del registro', 'Resumidor'],
    ];
    // La respuesta de una sala llega intercalada con el primer turno de otra.
    const turnos = [0, 1, 2].flatMap((n) => parejas.map(([a, b], i) => ({ ...base, id: `${i}-${n}`, temaId: `tema-${i}`,
      agente: (n === 1 ? b : a)!, destinatario: (n === 1 ? a : b)!, tipoConversacion: i ? 'companeros' as const : 'actividad' as const })));
    motor!.conversar(turnos);
    const vistos = new Set<string>(), hablado = new Map<string, string[]>();
    let simultaneas = 0;
    await avanzar(850, () => {
      const bocadillos = [...nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]')];
      simultaneas = Math.max(simultaneas, bocadillos.length);
      expect(bocadillos.length).toBeLessThanOrEqual(3);
      for (const b of bocadillos) {
        const t = turnos.find((t) => t.id === b.dataset.turno)!;
        expect(b.dataset.interlocutor).toBe(t.destinatario);
        if (!vistos.has(t.id)) { vistos.add(t.id); hablado.set(t.temaId, [...(hablado.get(t.temaId) ?? []), t.id]); }
      }
      expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
      parejas.slice(1).flat().forEach((p) => expect(nodo.querySelector(`[data-agente="${p}"]`)?.classList.contains('activo')).toBe(false));
    });
    expect(simultaneas).toBe(3);
    expect(vistos.size).toBe(turnos.length);
    parejas.forEach((_, i) => expect(hablado.get(`tema-${i}`)).toEqual([`${i}-0`, `${i}-1`, `${i}-2`]));
    motor!.conversar(turnos);
    await avanzar(600);
    expect(nodo.querySelectorAll('.lv-bub[data-turno]')).toHaveLength(0);
    expect(d.activos).toEqual(['Generador de consultas']);
    expect(resp.conceder).not.toHaveBeenCalled(); expect(resp.aprobarPlan).not.toHaveBeenCalled();
  });
  it('muestra el primer comentario al recibirlo, mientras se acercan los compañeros', async () => {
    const d = datos(); montar(d);
    const t: TurnoLaboratorio = { id: 'inmediata', temaId: 'tema', iteracionId: d.identidad.split('/')[1]!, idioma: 'es', tipoConversacion: 'companeros',
      agente: 'Planificador', destinatario: 'Proponente de experimento', texto: 'Me intriga lo que leyeron sobre MAPT. ¿Tú cómo lo ves?', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    const a = nodo.querySelector<HTMLElement>('[data-agente="Planificador"]')!;
    motor!.conversar([t]);
    await avanzar(1);
    expect(nodo.querySelector('.lv-bub[data-turno="inmediata"]')?.textContent).toContain(t.texto);
    const inicio = a.style.transform;
    await avanzar(10);
    expect(a.style.transform).not.toBe(inicio);
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(1);
  });
  it('conserva posiciones entre registros, cambios de tarea, conversaciones y permisos', async () => {
    const d = datos(); montar(d);
    const posiciones = () => new Map([...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => {
      const [x = 0, y = 0] = a.style.transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      return [a.dataset.agente!, [x, y]] as const;
    }));
    await avanzar(1);
    let anteriores = posiciones();
    const inicio = anteriores.get('Generador de consultas')!;
    let distancia = 0;
    const vistos = new Set<string>();
    const t: TurnoLaboratorio = { id: 'charla-natural', temaId: 'tema', iteracionId: d.identidad.split('/')[1]!, idioma: 'es',
      agente: 'Generador de consultas', destinatario: 'Explorador', texto: 'Hmm, quiero mirar mejor lo de MAPT. ¿Tú cómo lo ves?', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    for (let n = 0; n < 400; n++) {
      if (n % 10 === 0) motor!.actualizar({ ...d, activos: n % 20 ? ['Generador de consultas', 'Explorador'] : d.activos,
        actividad: [...d.actividad, { ...d.actividad[0]!, id: `entrada-${n}`, texto: `Fuente 12:${n}: comprobaciones deterministas` }] });
      if (n === 90) motor!.conversar([t]);
      if (n === 220) motor!.conversar([t], false);
      await avanzar(1);
      const actuales = posiciones();
      for (const [nombre, [x, y]] of actuales) {
        const antes = anteriores.get(nombre)!;
        // Velocidad 70 px/s: máximo 7 px por frame, más el balanceo de 2 px.
        expect(Math.hypot(x - antes[0], y - antes[1]), nombre).toBeLessThanOrEqual(10);
      }
      anteriores = actuales;
      const consulta = actuales.get('Generador de consultas')!;
      distancia = Math.max(distancia, Math.hypot(consulta[0] - inicio[0], consulta[1] - inicio[1]));
      nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach((b) => vistos.add(b.dataset.turno!));
    }
    expect(distancia).toBeGreaterThan(40);
    expect(vistos.has(t.id)).toBe(true);
    const antesPermiso = posiciones();
    motor!.actualizar({ ...d, trabajando: false, activos: [], pide: { id: 'permiso-en-camino', clase: 'permiso', quien: 'Explorador', titulo: 'Consultar una fuente', detalle: '', alcances: [], requiereArgumentos: false } });
    await avanzar(1);
    for (const [nombre, [x, y]] of posiciones()) {
      const antes = antesPermiso.get(nombre)!;
      expect(Math.hypot(x - antes[0], y - antes[1]), nombre).toBeLessThanOrEqual(2);
    }
    expect(nodo.querySelector('.lv-bub.ask')?.textContent).toBe('¿Me das permiso?');
  });
  it('el juez lee en su mesa una afirmación real de la iteración y sella su veredicto', async () => {
    const d = datos(), e = { ...d.actividad[0]!, agente: 'Juez', sala: 'r2' as const, texto: 'El juez compara las afirmaciones con sus artículos' };
    const af = { id: 'af-real', texto: 'MAPT se expresa en neuronas corticales', veredicto: 'no_sostenida' as const, caja: 'no_sostenida' as const, motivo: 'El artículo habla de glía, no de neuronas', cita: 'PMID 1', articulo: 'Un artículo real', biblioteca: null, procedenciaVeredicto: { origen: 'juez' as const, modelo: 'modelo de prueba', comprobaciones: [] } };
    montar({ ...d, foco: 'r2', activos: ['Juez'], actividad: [e], afirmaciones: [af] });
    const sellos = new Set<string>(), dichos = new Set<string>();
    await avanzar(200, () => {
      nodo.querySelectorAll('.lv-sello').forEach((s) => sellos.add(s.textContent ?? ''));
      nodo.querySelectorAll('.lv-documento-juicio').forEach((b) => dichos.add(b.textContent ?? ''));
    });
    expect([...sellos]).toEqual(['NO SOSTENIDA']);
    expect([...dichos].some((t) => t.includes(af.texto))).toBe(true);
    expect([...dichos].some((t) => t.includes(af.motivo))).toBe(true);
    expect(nodo.querySelectorAll('.lv-bub[data-escena="juicio"]')).toHaveLength(0);
    motor!.desmontar(); montar({ ...d, foco: 'r2', activos: ['Juez'], actividad: [e], afirmaciones: null });
    await avanzar(200, () => expect(nodo.querySelectorAll('.lv-sello')).toHaveLength(0));
  });
  it('los cuatro generadores salen de sus mesas mientras sus tareas siguen activas', async () => {
    const d = datos(), nombres = ['Analogía', 'Contradicción', 'Mecanismo opuesto', 'Otra escala'];
    montar({ ...d, foco: 'r3', activos: nombres, actividad: nombres.map((agente, i) => ({ ...d.actividad[0]!, id: `miembro:${i}`, agente, sala: 'r3', texto: `El miembro «${agente}» genera propuestas en la ronda 1` })) });
    const posiciones = nombres.map(() => new Set<string>());
    await avanzar(450, () => nombres.forEach((n, i) => posiciones[i]!.add(nodo.querySelector<HTMLElement>(`[data-agente="${n}"]`)!.style.transform)));
    posiciones.forEach((p) => expect(p.size).toBeGreaterThan(20));
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(4);
  });
  it('detiene encuentros, conversaciones y paseos al pausar o perder la conexión', async () => {
    const d = datos(); montar(d); await avanzar(180);
    expect(nodo.querySelectorAll('.lv-ag[data-escena]').length).toBeGreaterThan(0);
    motor!.actualizar({ ...d, trabajando: false, activos: [], estado: 'pausada', estadoTexto: 'Pausada' });
    await avanzar(2);
    const posiciones = [...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform);
    await avanzar(250);
    expect([...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform)).toEqual(posiciones);
    expect(nodo.querySelectorAll('[data-escena]')).toHaveLength(0);
    motor!.actualizar(d); await avanzar(180);
    motor!.actualizar({ ...d, conexion: 'sin_conexion', trabajando: false, activos: [] });
    await avanzar(250);
    expect(nodo.querySelectorAll('[data-escena]')).toHaveLength(0);
    expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(0);
  });
  it('respeta la animación pausada, la pestaña oculta y el movimiento reducido', async () => {
    montar(); await avanzar(180);
    const posiciones = () => [...nodo.querySelectorAll<HTMLElement>('.lv-ag')].map((a) => a.style.transform);
    nodo.querySelector<HTMLButtonElement>('.lv-play')!.click();
    const antes = posiciones(); await avanzar(150); expect(posiciones()).toEqual(antes);
    nodo.querySelector<HTMLButtonElement>('.lv-play')!.click();
    const oculto = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await avanzar(150); expect(posiciones()).toEqual(antes); oculto.mockRestore();
    motor!.desmontar(); vi.stubGlobal('matchMedia', () => ({ matches: true })); montar();
    await avanzar(2); const reducidas = posiciones(); await avanzar(500);
    expect(posiciones()).toEqual(reducidas);
    expect(nodo.querySelectorAll('[data-escena]')).toHaveLength(0);
  });
});
