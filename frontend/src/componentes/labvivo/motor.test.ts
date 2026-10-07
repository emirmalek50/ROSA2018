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
  return datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [] }, inv, c, i);
}
function montar(d = datos(), r: Partial<Respuestas> = {}) {
  const resp: Respuestas = { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true), verEnLaCorrida: vi.fn(), ...r };
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
