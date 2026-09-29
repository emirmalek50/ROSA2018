// @vitest-environment jsdom
// S-23 (17 de septiembre de 2026): una decisión humana diferida (aceptar,
// descartar) se aplicaba en pantalla y viajaba al servidor 6 s después; si
// entre medias llegaba un estado por SSE (mediana de 1,2 s entre empujes con la
// corrida en marcha), la tarjeta volvía a "propuesta" con el aviso de Deshacer
// aún vivo; si la persona cerraba la pestaña, el POST nunca salía; y un segundo
// clic registraba la decisión dos veces. Este test monta el almacén real con
// fetch y EventSource falsos y exige lo contrario en los tres casos.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from './muestra';
import type { EstadoRosa } from './tipos';

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
  empujar(estado: unknown, version: number) {
    for (const fn of this.oyentes.get('estado') ?? []) fn({ data: JSON.stringify(estado), lastEventId: String(version) });
  }
}

const posts: { nombre: string; cuerpo: Record<string, unknown>; keepalive: boolean }[] = [];
let remoto: EstadoRosa;
// El almacén es un singleton del módulo y descarta estados con versión menor
// que la última vista: cada test arranca con una versión mayor que el anterior.
let version = 1000;
const v = (n: number) => version + n;
let respuestaPost: () => Response = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const idPropuesta = () => remoto.hipotesis.find((h) => h.estado === 'propuesta')!.id;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

beforeEach(() => {
  posts.length = 0;
  EventSourceFalso.instancias.length = 0;
  remoto = { ...estadoDeMuestra(), conexion: 'en_linea' };
  version += 1000;
  vi.stubGlobal('EventSource', EventSourceFalso);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/estado')) return new Response(JSON.stringify(remoto), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Rosa-Version': String(version) } });
      if (String(url).startsWith('/api/acciones/')) {
        posts.push({ nombre: String(url).slice('/api/acciones/'.length), cuerpo: JSON.parse(String(init?.body ?? '{}')), keepalive: Boolean((init as { keepalive?: boolean } | undefined)?.keepalive) });
        return respuestaPost();
      }
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

async function montar() {
  const A = await import('./almacen');
  const { ToastDeshacer } = await import('../componentes/Deshacer');
  const cont = document.createElement('div');
  document.body.appendChild(cont);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(cont);
    root.render(<ToastDeshacer />);
  });
  // Cuántas decisiones siguen pendientes, leído por el mismo hook que usa el aviso
  // (el aviso viejo sigue en el DOM mientras dura su animación de salida).
  let pendientesVivas = 0;
  function Cuenta() {
    pendientesVivas = A.useAccionesPendientes().length;
    return null;
  }
  await act(async () => createRoot(document.body.appendChild(document.createElement('div'))).render(<Cuenta />));
  const estadoHip = (id: string): string => {
    let e: EstadoRosa | null = null;
    A.aplicar((x) => {
      e = x;
      return x;
    });
    return e!.hipotesis.find((x) => x.id === id)!.estado;
  };
  // Vaciar la cola que otro test haya dejado (el módulo es un singleton).
  A.vaciarPendientes();
  posts.length = 0;
  expect(await A.conectar(false)).toBe('servidor');
  return { A, cont, root: root as unknown as Root, estadoHip, pendientes: () => pendientesVivas, es: EventSourceFalso.instancias.at(-1)! };
}

describe('una decisión humana diferida frente al servidor', () => {
  it('un empuje SSE dentro de la ventana de Deshacer no la deshace en pantalla; el POST sale una sola vez al vencer', async () => {
    // Los temporizadores falsos van antes de montar: el reloj del aviso (useAhora) tiene que ser el falso.
    vi.useFakeTimers();
    const { A, cont, estadoHip, pendientes, es } = await montar();
    const id = idPropuesta();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 12);
    });
    expect(estadoHip(id)).toBe('aceptada');
    expect(cont.textContent).toMatch(/Se envía en [67] s/);
    // Tres empujes del servidor con la hipótesis todavía "propuesta" (la decisión no ha llegado).
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
        es.empujar(remoto, v(1 + i));
      });
      expect(estadoHip(id)).toBe('aceptada');
    }
    expect(cont.textContent).toMatch(/Se envía en [34] s/);
    expect(posts).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(posts.map((p) => p.nombre)).toEqual(['revisarHipotesis']);
    expect(posts[0]!.cuerpo).toMatchObject({ hipotesis_id: id, accion: 'aceptar', version_esperada: 1, segundos_revision: 12 });
    // Enviada: ya no queda pendiente y la tarjeta sigue aceptada hasta que el servidor confirme.
    expect(pendientes()).toBe(0);
    expect(estadoHip(id)).toBe('aceptada');
    // El servidor confirma con su propio estado: nada que reaplicar, coincide.
    const confirmado = { ...remoto, hipotesis: remoto.hipotesis.map((h) => (h.id === id ? { ...h, estado: 'aceptada' as const } : h)) };
    await act(async () => es.empujar(confirmado, v(110)));
    expect(estadoHip(id)).toBe('aceptada');
  });

  it('un segundo clic sobre la misma decisión no programa otro envío, y una decisión que el servidor ya trae no se registra dos veces', async () => {
    const { A, estadoHip, es } = await montar();
    const id = idPropuesta();
    vi.useFakeTimers();
    await act(async () => {
      expect(A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 5)).toBe(true);
    });
    await act(async () => {
      expect(A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 6)).toBe(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(posts).toHaveLength(1);
    // El servidor ya aplicó la decisión (estado aceptada) y la persona vuelve a pulsar: el reducer no cambia nada y no sale POST.
    const yaAceptada = { ...remoto, hipotesis: remoto.hipotesis.map((h) => (h.id === id ? { ...h, estado: 'aceptada' as const } : h)) };
    await act(async () => es.empujar(yaAceptada, v(120)));
    expect(estadoHip(id)).toBe('aceptada');
    await act(async () => {
      expect(A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 7)).toBe(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(posts).toHaveLength(1);
  });

  it('al cerrar la pestaña (pagehide) las pendientes salen ya, con keepalive', async () => {
    const { A, estadoHip } = await montar();
    const id = idPropuesta();
    vi.useFakeTimers();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3);
    });
    expect(posts).toHaveLength(0);
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.keepalive).toBe(true);
    expect(posts[0]!.cuerpo).toMatchObject({ hipotesis_id: id, accion: 'aceptar' });
    // El temporizador ya no manda nada más.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(posts).toHaveLength(1);
    expect(estadoHip(id)).toBe('aceptada');
  });

  it('al pasar la pestaña a segundo plano (visibilitychange a hidden) también salen', async () => {
    const { A } = await montar();
    const id = idPropuesta();
    vi.useFakeTimers();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'refinar', 'afinar la cohorte', false, null, 1, 3);
    });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(posts.map((p) => [p.nombre, p.cuerpo.accion, p.keepalive])).toEqual([['revisarHipotesis', 'refinar', true]]);
  });

  it('Deshacer antes de vencer restaura la tarjeta y no manda nada; si llegó un SSE entre medias, recarga del servidor', async () => {
    const { A, cont, estadoHip, es } = await montar();
    const id = idPropuesta();
    vi.useFakeTimers();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3);
    });
    const boton = [...cont.querySelectorAll('button')].find((b) => b.textContent === 'Deshacer')!;
    await act(async () => boton.click());
    expect(estadoHip(id)).toBe('propuesta');
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(posts).toHaveLength(0);
    // Segunda vez, con un empuje entre medias: se resincroniza en vez de restaurar una copia vieja.
    const llamadasEstadoAntes = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).startsWith('/api/estado')).length;
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3);
    });
    await act(async () => es.empujar(remoto, v(130)));
    expect(estadoHip(id)).toBe('aceptada');
    // El aviso anterior sigue en el DOM mientras dura su animación de salida (con
    // temporizadores falsos no termina): el botón vivo es el último.
    const boton2 = [...cont.querySelectorAll('button')].filter((b) => b.textContent === 'Deshacer').at(-1)!;
    await act(async () => boton2.click());
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(posts).toHaveLength(0);
    const llamadasEstadoDespues = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).startsWith('/api/estado')).length;
    expect(llamadasEstadoDespues - llamadasEstadoAntes).toBe(1);
  });

  it('si el servidor no responde al enviar, avisa y reintenta en vez de callar', async () => {
    const { A } = await montar();
    const id = idPropuesta();
    respuestaPost = () => new Response('caído', { status: 503 });
    vi.useFakeTimers();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3);
    });
    await act(async () => {
      vi.advanceTimersByTime(6500);
      await Promise.resolve();
    });
    expect(posts).toHaveLength(1);
    let aviso: { texto: string } | null = null;
    // El aviso de conflicto es un almacén aparte: se lee por su hook con un componente mínimo.
    const { useAvisoConflicto } = A;
    const cont = document.createElement('div');
    document.body.appendChild(cont);
    function Aviso() {
      aviso = useAvisoConflicto();
      return null;
    }
    await act(async () => createRoot(cont).render(<Aviso />));
    expect(aviso!.texto).toContain('No pude registrar tu decisión');
    expect(aviso!.texto).toContain('reintenta en 5 s');
    await act(async () => {
      vi.advanceTimersByTime(5500);
      await Promise.resolve();
    });
    expect(posts).toHaveLength(2);
    respuestaPost = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  it('adversario: una decisión distinta sobre la misma hipótesis dentro del margen (aceptar y después reabrir) no se tira: la primera sale ya y la segunda se programa encima', async () => {
    const { A, estadoHip } = await montar();
    const id = idPropuesta();
    vi.useFakeTimers();
    await act(async () => {
      expect(A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3)).toBe(true);
    });
    expect(estadoHip(id)).toBe('aceptada');
    // La persona se arrepiente y pulsa "Reabrir" a los 2 s: antes esto no hacía nada durante 6 s.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      expect(A.acciones.revisarHipotesis(id, 'reabrir', 'me precipité', false, null, 1, 5)).toBe(true);
    });
    expect(estadoHip(id)).toBe('en_revision');
    expect(posts.map((p) => p.cuerpo.accion)).toEqual(['aceptar']);
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(posts.map((p) => p.cuerpo.accion)).toEqual(['aceptar', 'reabrir']);
    expect(estadoHip(id)).toBe('en_revision');
  });

  it('adversario: un empuje SSE entre que el POST sale y el servidor contesta no devuelve la tarjeta a "propuesta"', async () => {
    const { A, estadoHip, es } = await montar();
    const id = idPropuesta();
    let contestar: (r: Response) => void = () => undefined;
    respuestaPost = () => undefined as never;
    // El POST se queda colgado hasta que el test lo suelte.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/estado')) return new Response(JSON.stringify(remoto), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Rosa-Version': String(version) } });
        posts.push({ nombre: String(url).slice('/api/acciones/'.length), cuerpo: JSON.parse(String(init?.body ?? '{}')), keepalive: false });
        return new Promise<Response>((res) => {
          contestar = res;
        });
      }),
    );
    vi.useFakeTimers();
    await act(async () => {
      A.acciones.revisarHipotesis(id, 'aceptar', '', false, null, 1, 3);
    });
    await act(async () => {
      vi.advanceTimersByTime(6500);
    });
    expect(posts).toHaveLength(1);
    // El bucle empuja un estado sin la decisión mientras el POST está en vuelo.
    await act(async () => es.empujar(remoto, v(140)));
    expect(estadoHip(id)).toBe('aceptada');
    // El servidor contesta y confirma con su estado: la decisión ya no se reaplica, pero coincide.
    await act(async () => {
      contestar(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const confirmado = { ...remoto, hipotesis: remoto.hipotesis.map((h) => (h.id === id ? { ...h, estado: 'aceptada' as const } : h)) };
    await act(async () => es.empujar(confirmado, v(141)));
    expect(estadoHip(id)).toBe('aceptada');
    // Y una vez contestado, un estado del servidor sin la decisión manda (por ejemplo, otra persona la reabrió).
    await act(async () => es.empujar(remoto, v(142)));
    expect(estadoHip(id)).toBe('propuesta');
    respuestaPost = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});

describe('subida de datos del laboratorio marcados como sintéticos (S-18)', () => {
  const conExperimento = (datosSinteticos: boolean) => {
    const h = remoto.hipotesis.find((x) => x.experimento)!;
    remoto = { ...remoto, hipotesis: remoto.hipotesis.map((x) => (x.id === h.id ? { ...x, experimento: { ...x.experimento!, estado: 'datos_recibidos' as const, ficheroDatos: 'gfap_guardado.csv', datosSinteticos } } : x)) };
    return h.id;
  };
  const subidas: { url: string; sintetico: string | null }[] = [];
  const stubSubida = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/estado')) return new Response(JSON.stringify(remoto), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Rosa-Version': String(version) } });
        if (String(url).includes('/datos')) {
          subidas.push({ url: String(url), sintetico: (init?.body as FormData).get('sintetico') as string | null });
          return new Response(JSON.stringify({ ok: true, fichero: 'gfap_guardado.csv', bytes: 3, version }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (String(url).startsWith('/api/acciones/')) {
          posts.push({ nombre: String(url).slice('/api/acciones/'.length), cuerpo: JSON.parse(String(init?.body ?? '{}')), keepalive: false });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`fetch inesperado: ${url}`);
      }),
    );
  };

  it('si el servidor no dejó la bandera puesta (endpoint que ignora el campo), la interfaz manda la acción con sintetico "si" sobre el nombre guardado', async () => {
    const { A } = await montar();
    const id = conExperimento(false);
    subidas.length = 0;
    stubSubida();
    const error = await A.acciones.subirDatosExperimento(id, new File(['a,b'], 'gfap.csv'), 'medias', true);
    expect(error).toBeNull();
    expect(subidas).toHaveLength(1);
    expect(subidas[0]!.sintetico).toBe('si');
    expect(posts.map((p) => [p.nombre, p.cuerpo.fichero, p.cuerpo.sintetico])).toEqual([['registrarDatosExperimento', 'gfap_guardado.csv', 'si']]);
    // Y en pantalla el experimento ya figura como sintético.
    let e: EstadoRosa | null = null;
    A.aplicar((x) => {
      e = x;
      return x;
    });
    expect(e!.hipotesis.find((h) => h.id === id)!.experimento!.datosSinteticos).toBe(true);
  });

  it('si el servidor sí la puso, no manda nada más; sin la casilla, tampoco', async () => {
    const { A } = await montar();
    const id = conExperimento(true);
    subidas.length = 0;
    stubSubida();
    expect(await A.acciones.subirDatosExperimento(id, new File(['a,b'], 'gfap.csv'), '', true)).toBeNull();
    expect(posts).toHaveLength(0);
    conExperimento(false);
    expect(await A.acciones.subirDatosExperimento(id, new File(['a,b'], 'gfap.csv'), '', false)).toBeNull();
    expect(posts).toHaveLength(0);
    expect(subidas.map((s) => s.sintetico)).toEqual(['si', 'no']);
  });
});

describe('una acción inmediata que el servidor no guarda', () => {
  it('un 503 al pausar la corrida avisa y resincroniza en vez de dejar el cambio pintado', async () => {
    // Las acciones inmediatas (pausar, detener, fijar amplitud) van por `enviar`,
    // que hasta el 29 de septiembre de 2026 en un 5xx solo marcaba "sin conexión" y
    // volvía: el cambio optimista se quedaba en pantalla como aplicado, sin aviso.
    // El 503 es el de EscritorObsoleto (otra ROSA2018 se quedó con la base): el
    // servidor está vivo, responde, y no va a guardar nada.
    const { A } = await montar();
    const corrida = remoto.corridas.find((c) => c.estado === 'en_marcha') ?? remoto.corridas[0]!;
    respuestaPost = () => new Response('obsoleto', { status: 503 });
    const antes = posts.length;
    await act(async () => {
      await A.acciones.pausarCorrida(corrida.id);
    });
    expect(posts.length).toBe(antes + 1);

    let aviso: { texto: string } | null = null;
    const { useAvisoConflicto } = A;
    const cont = document.createElement('div');
    document.body.appendChild(cont);
    function Aviso() {
      aviso = useAvisoConflicto();
      return null;
    }
    await act(async () => createRoot(cont).render(<Aviso />));
    expect(aviso).not.toBeNull();
    expect(aviso!.texto).toContain('No se guardó la acción "pausarCorrida"');
    // El 503 se nombra por lo que es, no como un fallo genérico.
    expect(aviso!.texto).toContain('otra se quedó con la base');
    expect(aviso!.texto).toContain('Lo que veías como aplicado no lo está');
    respuestaPost = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  it('un 500 cualquiera también avisa, con el código', async () => {
    const { A } = await montar();
    const corrida = remoto.corridas[0]!;
    respuestaPost = () => new Response('boom', { status: 500 });
    await act(async () => {
      await A.acciones.pausarCorrida(corrida.id);
    });
    let aviso: { texto: string } | null = null;
    const { useAvisoConflicto } = A;
    const cont = document.createElement('div');
    document.body.appendChild(cont);
    function Aviso() {
      aviso = useAvisoConflicto();
      return null;
    }
    await act(async () => createRoot(cont).render(<Aviso />));
    expect(aviso!.texto).toContain('El servidor falló al guardar (500)');
    respuestaPost = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
