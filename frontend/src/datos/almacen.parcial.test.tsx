// @vitest-environment jsdom
// El navegador baja solo lo que cambió (28 de septiembre de 2026): con la versión
// que ya tiene pide `/api/estado?desde=N` y el servidor contesta con las claves
// de primer nivel que cambiaron después, marcadas con X-Rosa-Parcial. Lo que no
// se puede romper: que lo fundido sea el estado del servidor, que una decisión
// que la persona deshizo no se quede pegada (la parcial se funde sobre la última
// copia pura del servidor, no sobre lo que se ve), y que una parcial que no
// encaja lleve a pedir el estado entero en vez de pintar un estado mezclado.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from './muestra';
import type { AccionPendiente } from './almacen';
import type { EstadoRosa } from './tipos';
import { pedirRecuperacionCitas } from './acciones';

type Oyente = (ev: unknown) => void;
class EventSourceFalso {
  static instancias: EventSourceFalso[] = [];
  oyentes = new Map<string, Oyente[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    EventSourceFalso.instancias.push(this);
  }
  addEventListener(tipo: string, fn: Oyente) {
    this.oyentes.set(tipo, [...(this.oyentes.get(tipo) ?? []), fn]);
  }
  close() {}
  /** Lo que manda el servidor de hoy: solo la versión nueva. */
  avisar(version: number) {
    for (const fn of this.oyentes.get('version') ?? []) fn({ data: '', lastEventId: String(version) });
  }
}

/** Un servidor de juguete con la misma regla que rosa/estado/almacen.py
 *  `instantanea_desde`: parcial con lo cambiado después de `desde`. */
const servidor = {
  estado: null as unknown as EstadoRosa,
  version: 0,
  cambios: new Map<number, string[]>(),
  parcial: true,
  /** Para forzar respuestas raras en un test. */
  trucar: null as null | ((desde: number | null) => Response | null),
};
const pedidas: string[] = [];
// El almacén es un singleton del módulo: cada test sube la versión por encima del anterior.
let base = 1000;

function cambiar(claves: (keyof EstadoRosa)[], fn: (e: EstadoRosa) => EstadoRosa) {
  servidor.estado = fn(servidor.estado);
  servidor.version += 1;
  servidor.cambios.set(servidor.version, claves as string[]);
}

function responder(url: string): Response {
  const u = new URL(url, 'http://localhost');
  const crudo = u.searchParams.get('desde');
  const desde = crudo !== null && /^\d+$/.test(crudo) ? Number(crudo) : null;
  const trucada = servidor.trucar?.(desde);
  if (trucada) return trucada;
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json', 'X-Rosa-Version': String(servidor.version) };
  if (servidor.parcial && desde !== null && desde <= servidor.version) {
    const claves = new Set<string>();
    for (const [v, ks] of servidor.cambios) if (v > desde) ks.forEach((k) => claves.add(k));
    const cuerpo: Record<string, unknown> = { conexion: 'en_linea' };
    for (const k of claves) cuerpo[k] = (servidor.estado as unknown as Record<string, unknown>)[k];
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { ...cabeceras, 'X-Rosa-Parcial': '1', 'X-Rosa-Desde': String(desde) } });
  }
  return new Response(JSON.stringify(servidor.estado), { status: 200, headers: cabeceras });
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

beforeEach(() => {
  pedidas.length = 0;
  EventSourceFalso.instancias.length = 0;
  base += 1000;
  servidor.estado = { ...estadoDeMuestra(), conexion: 'en_linea' };
  servidor.version = base;
  servidor.cambios = new Map();
  servidor.parcial = true;
  servidor.trucar = null;
  vi.stubGlobal('EventSource', EventSourceFalso);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/estado')) {
        pedidas.push(String(url));
        return responder(String(url));
      }
      if (String(url).startsWith('/api/acciones/')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function esperar() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function montar() {
  const A = await import('./almacen');
  let pendientes: AccionPendiente[] = [];
  function Cuenta() {
    pendientes = A.useAccionesPendientes();
    return null;
  }
  await act(async () => createRoot(document.body.appendChild(document.createElement('div'))).render(<Cuenta />));
  A.vaciarPendientes();
  expect(await A.conectar(false)).toBe('servidor');
  const actual = (): EstadoRosa => {
    let e: EstadoRosa | null = null;
    A.aplicar((x) => {
      e = x;
      return x;
    });
    return e!;
  };
  return { A, actual, pendientes: () => pendientes, es: EventSourceFalso.instancias.at(-1)! };
}

const sinLocales = (e: EstadoRosa) => {
  const { conexion: _c, ultimaVisita: _u, ...resto } = e as EstadoRosa & { ultimaVisita?: unknown };
  return resto;
};

describe('el navegador baja solo lo que cambió', () => {
  it('pide desde su versión, funde la parcial y conserva el resto', async () => {
    const { actual, es } = await montar();
    const v0 = servidor.version;
    cambiar(['criteriosRevision'], (e) => ({ ...e, criteriosRevision: [...e.criteriosRevision, 'criterio nuevo'] }));
    await act(async () => {
      es.avisar(servidor.version);
      await esperar();
    });
    expect(pedidas.at(-1)).toContain(`desde=${v0}`);
    expect(actual().criteriosRevision.at(-1)).toBe('criterio nuevo');
    expect(sinLocales(actual())).toEqual(sinLocales(servidor.estado));
  });

  it('tras varias parciales seguidas lo que se ve es el estado del servidor', async () => {
    const { actual, es } = await montar();
    for (let i = 0; i < 6; i += 1) {
      if (i % 2 === 0) cambiar(['criteriosRevision'], (e) => ({ ...e, criteriosRevision: [...e.criteriosRevision, `c${i}`] }));
      else cambiar(['hipotesis'], (e) => ({ ...e, hipotesis: e.hipotesis.map((h, j) => (j === 0 ? { ...h, titulo: `título ${i}` } : h)) }));
      await act(async () => {
        es.avisar(servidor.version);
        await esperar();
      });
      expect(sinLocales(actual())).toEqual(sinLocales(servidor.estado));
    }
    expect(pedidas.slice(1).every((u) => u.includes('desde='))).toBe(true);
  });

  it('una decisión que la persona deshizo no se queda pegada aunque la parcial no traiga hipótesis', async () => {
    const { A, actual, pendientes, es } = await montar();
    const id = servidor.estado.hipotesis.find((h) => h.estado === 'propuesta')!.id;
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 4);
    });
    expect(actual().hipotesis.find((h) => h.id === id)!.estado).toBe('aceptada');
    // Llega una parcial que solo trae otra clave: la decisión pendiente se reaplica encima.
    cambiar(['criteriosRevision'], (e) => ({ ...e, criteriosRevision: [...e.criteriosRevision, 'otro'] }));
    await act(async () => {
      es.avisar(servidor.version);
      await esperar();
    });
    expect(actual().hipotesis.find((h) => h.id === id)!.estado).toBe('aceptada');
    expect(actual().criteriosRevision.at(-1)).toBe('otro');
    // La persona deshace: vuelve a lo que dice el servidor, que nunca la aceptó.
    await act(async () => {
      pendientes().find((p) => p.clave.includes(id))!.deshacer();
      await esperar();
    });
    expect(actual().hipotesis.find((h) => h.id === id)!.estado).toBe('propuesta');
    expect(sinLocales(actual())).toEqual(sinLocales(servidor.estado));
  });

  it('una decisión cuyo envío falló (500) no se queda pegada cuando llega una parcial sin hipótesis', async () => {
    // Un 500 no recarga el estado (solo marca la conexión): la decisión deja de
    // reaplicarse y lo que manda es el servidor, que nunca la aplicó. Si la
    // parcial se fundiera sobre lo que se ve, la aceptación optimista quedaría
    // dentro para siempre.
    vi.useFakeTimers();
    const { A, actual, es } = await montar();
    const id = servidor.estado.hipotesis.find((h) => h.estado === 'propuesta')!.id;
    const fetchReal = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => (String(url).startsWith('/api/acciones/') ? new Response('fallo', { status: 500 }) : fetchReal(url, init))),
    );
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 4);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000); // vence el margen: sale el POST y falla
    });
    cambiar(['criteriosRevision'], (e) => ({ ...e, criteriosRevision: [...e.criteriosRevision, 'tras el fallo'] }));
    await act(async () => {
      es.avisar(servidor.version);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(pedidas.at(-1)).toContain('desde=');
    expect(actual().criteriosRevision.at(-1)).toBe('tras el fallo');
    expect(actual().hipotesis.find((h) => h.id === id)!.estado).toBe('propuesta');
  });

  it('una parcial que no encaja lleva a pedir el estado entero', async () => {
    const { actual, es } = await montar();
    cambiar(['criteriosRevision'], (e) => ({ ...e, criteriosRevision: [...e.criteriosRevision, 'x'] }));
    // El servidor dice que la parcial es desde otra versión: fundirla mezclaría estados.
    servidor.trucar = (desde) => (desde === null ? null : new Response(JSON.stringify({ conexion: 'en_linea', criteriosRevision: ['mezclado'] }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Rosa-Version': String(servidor.version), 'X-Rosa-Parcial': '1', 'X-Rosa-Desde': String(desde + 1) } }));
    vi.useFakeTimers();
    await act(async () => {
      es.avisar(servidor.version);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(actual().criteriosRevision).not.toContain('mezclado');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pedidas.at(-1)).not.toContain('desde=');
    expect(sinLocales(actual())).toEqual(sinLocales(servidor.estado));
  });

  it('con un servidor anterior, que ignora `desde` y manda el entero, sigue funcionando', async () => {
    const { actual, es } = await montar();
    servidor.parcial = false;
    cambiar(['hipotesis'], (e) => ({ ...e, hipotesis: e.hipotesis.slice(1) }));
    await act(async () => {
      es.avisar(servidor.version);
      await esperar();
    });
    expect(sinLocales(actual())).toEqual(sinLocales(servidor.estado));
  });
});

describe('un corte breve del flujo de eventos', () => {
  // Por rosa.alzheimerproject.com el proxy de Vercel corta cada petición a los
  // 120 s y EventSource reabre en 2 s: la franja «sin conexión» no debe
  // parpadear en cada corte, pero sí salir si el flujo no vuelve (5 de
  // octubre de 2026).
  it('no avisa «sin conexión» si el flujo vuelve en la gracia, y sí si no vuelve', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const A = await import('./almacen');
    expect(await A.conectar(false)).toBe('servidor');
    const es = EventSourceFalso.instancias.at(-1)!;
    const conexion = () => {
      let c = '';
      A.aplicar((x) => {
        c = x.conexion;
        return x;
      });
      return c;
    };
    // El EventSource falso no trae readyState: abierto salvo que el test lo cambie.
    (es as unknown as { readyState: number }).readyState = 1;
    vi.stubGlobal('EventSource', Object.assign(EventSourceFalso, { OPEN: 1 }));
    es.onopen?.();
    expect(conexion()).toBe('en_linea');
    // Corte y vuelta en 2 s: nada cambia a la vista.
    es.onerror?.();
    vi.advanceTimersByTime(2000);
    expect(conexion()).toBe('en_linea');
    es.onopen?.();
    vi.advanceTimersByTime(A.GRACIA_CAIDA_MS + 500);
    expect(conexion()).toBe('en_linea');
    // Corte sin vuelta: pasada la gracia, se avisa.
    (es as unknown as { readyState: number }).readyState = 0;
    es.onerror?.();
    vi.advanceTimersByTime(A.GRACIA_CAIDA_MS - 100);
    expect(conexion()).toBe('en_linea');
    vi.advanceTimersByTime(200);
    expect(conexion()).toBe('sin_conexion');
  });
});

describe('la recuperación de citas requiere aceptación real', () => {
  it('no inventa una recuperación mientras espera el POST; tras la aceptación lee el registro canónico', async () => {
    const { A, actual } = await montar();
    const id = servidor.estado.investigaciones[0]!.id;
    const antes = actual().investigaciones[0]!.recuperacionCitas;
    let contestar!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/estado')) return Promise.resolve(responder(url));
      return new Promise<Response>((r) => { contestar = r; });
    }));
    let peticion!: Promise<boolean | null>;
    await act(async () => { peticion = A.acciones.pedirRecuperacionCitas(id); });
    expect(actual().investigaciones[0]!.recuperacionCitas).toEqual(antes);
    cambiar(['investigaciones'], (e) => pedirRecuperacionCitas(e, id, null, 'revisora', 123));
    await act(async () => {
      contestar(new Response(JSON.stringify({ ok: true })));
      expect(await peticion).toBe(true);
    });
    expect(actual().investigaciones[0]!.recuperacionCitas).toEqual(servidor.estado.investigaciones[0]!.recuperacionCitas);
    expect(actual().investigaciones[0]!.recuperacionCitas?.estado).toBe('pedida');
  });

  it.each([
    { status: 200, ok: false, resultado: false },
    { status: 403, ok: false, resultado: false },
    { status: 503, ok: false, resultado: null },
    { status: 0, ok: false, resultado: null },
  ])('un rechazo o corte ($status) no deja una recuperación ficticia', async ({ status, ok, resultado }) => {
    const { A, actual } = await montar();
    const id = servidor.estado.investigaciones[0]!.id;
    const antes = actual().investigaciones[0]!.recuperacionCitas;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/estado')) return responder(url);
      if (!status) throw new Error('Sin conexión');
      return new Response(JSON.stringify({ ok }), { status });
    }));
    await act(async () => { expect(await A.acciones.pedirRecuperacionCitas(id)).toBe(resultado); });
    expect(actual().investigaciones[0]!.recuperacionCitas).toEqual(antes);
  });
});


describe('la nueva investigación se crea en el servidor', () => {
  const datos = { titulo: 'Nueva', objetivo: 'Evaluar GFAP', condicionParada: '3 iterations', relevancia: '', limites: [], revisores: ['Emir Malek'] };
  it('no adelanta la navegación ni crea datos locales antes de la confirmación canónica', async () => {
    const { A, actual } = await montar();
    const inicial = actual().investigaciones.length;
    const previa = vi.mocked(fetch).getMockImplementation()!;
    let confirmar!: () => void;
    vi.mocked(fetch).mockImplementation(async (url, opciones) => {
      if (String(url).startsWith('/api/acciones/')) {
        expect(String(url)).toBe('/api/acciones/crearInvestigacionEIniciar');
        expect(JSON.parse(String(opciones?.body))).toMatchObject({ datos, id_: 'inv-atomica' });
        await new Promise<void>((resolve) => { confirmar = resolve; });
        const inv = { ...servidor.estado.investigaciones[0]!, id: 'inv-atomica', titulo: datos.titulo };
        const cor = { ...servidor.estado.corridas[0]!, id: 'cor-atomica', investigacionId: inv.id };
        cambiar(['investigaciones', 'corridas'], (e) => ({ ...e, investigaciones: [...e.investigaciones, inv], corridas: [...e.corridas, cor] }));
        return new Response(JSON.stringify({ ok: true, resultado: { investigacionId: inv.id, corridaId: cor.id } }));
      }
      return previa(url, opciones);
    });
    const pendiente = A.acciones.crearInvestigacion(datos, 'inv-atomica');
    expect(actual().investigaciones.length).toBe(inicial);
    confirmar();
    expect(await pendiente).toEqual({ estado: 'creada', investigacionId: 'inv-atomica', corridaId: 'cor-atomica' });
    expect(actual().corridas.some((c) => c.id === 'cor-atomica')).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/acciones/'))).toHaveLength(1);
  });
  it.each(['rechazo', 'caída', 'sin_ids', 'id_ajeno'])('con %s conserva el estado y no inicia otra corrida', async (caso) => {
    const { A, actual } = await montar();
    const antes = JSON.stringify(actual().investigaciones);
    const previa = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, opciones) => {
      if (String(url).startsWith('/api/acciones/')) {
        if (caso === 'caída') throw new Error('Sin conexión');
        return new Response(JSON.stringify(caso === 'rechazo' ? { ok: false } : caso === 'sin_ids' ? { ok: true } : { ok: true, resultado: { investigacionId: 'inv-ajena', corridaId: 'cor-ajena' } }));
      }
      return previa(url, opciones);
    });
    expect(await A.acciones.crearInvestigacion(datos, 'inv-pedida')).toEqual({ estado: caso === 'rechazo' ? 'rechazada' : 'sin_respuesta' });
    expect(JSON.stringify(actual().investigaciones)).toBe(antes);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/iniciarCorrida'))).toHaveLength(0);
  });
});
