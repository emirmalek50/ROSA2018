// @vitest-environment jsdom
// La pantalla de la corrida con el vigilante de modelos (18 de septiembre de
// 2026): la franja "Modelos" arriba, el aviso de esperando_modelo con el botón
// "Reintentar ahora" que llama a acciones.reanudarCorrida, las incidencias
// modelo_sin_respuesta fuera de "Algo impide seguir", el reloj de trabajo
// parado mientras espera al modelo, y un registro anterior al vigilante (sin
// saludModelos ni esperandoModelo) que no rompe nada. Mismo montaje que
// Corrida.hooks.test.tsx (createRoot y act, con los observadores que jsdom no
// trae); las acciones son un doble que apunta cada llamada.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Corrida as CorridaTipo, EsperaModelo, EstadoRosa, Incidencia, SaludModelo } from '../datos/tipos';
import { Corrida, ESTADOS_DE_ESPERA_HUMANA, ESTADOS_DE_PAUSA_DEL_PROCESO, esperandoPersona, pausaDelProceso, segundosDeTrabajo } from './Corrida';

const { llamadas } = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock('../datos/almacen', () => ({
  acciones: new Proxy(
    {},
    {
      get:
        (_t, nombre) =>
        (...args: unknown[]) => {
          llamadas.push([nombre, ...args]);
          return undefined;
        },
    },
  ),
}));

beforeAll(() => {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  llamadas.length = 0;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

const SIN_TILDE = /\b(ultima comprobacion|retomara|resolviendose|todavia sin|Esperando al modelo y|reintento de|sondeo del)\b/;
const a = (h: number, m: number) => new Date(2026, 8, 18, h, m, 0).getTime();
const AHORA = a(13, 0);

function salud(extra: Partial<SaludModelo>): SaludModelo {
  return { modelo: 'openai/gpt-6-astra', estado: 'ok', desde: null, intentos: 0, proximoIntentoEn: null, ultimaRespuestaEn: null, ultimaLatenciaMs: null, caidas: 0, recuperadoEn: null, ...extra };
}
const OK = salud({ ultimaRespuestaEn: AHORA - 40_000, ultimaLatenciaMs: 6_000 });
const CAIDO = salud({ modelo: 'anthropic/claude-opus-5', estado: 'sin_respuesta', desde: a(12, 34), intentos: 4, proximoIntentoEn: AHORA + 45_000, caidas: 1 });
const LENTO = salud({ modelo: 'anthropic/claude-sonnet-5', estado: 'lento', desde: a(12, 58), intentos: 1, proximoIntentoEn: AHORA + 12_000, caidas: 1 });
const ESPERA: EsperaModelo = { rol: 'juez', modelo: 'anthropic/claude-opus-5', desde: a(12, 34), ultimoSondeo: a(12, 59), proximoSondeo: AHORA + 30_000, pasoId: 'paso-1', intentos: 4 };

/** La corrida que la pantalla enseña para la primera investigación (la de mayor número). */
function laCorrida(estado: EstadoRosa): CorridaTipo {
  const inv = estado.investigaciones[0]!;
  return estado.corridas.filter((c) => c.investigacionId === inv.id).sort((x, y) => y.numero - x.numero)[0]!;
}

function conCorrida(estado: EstadoRosa, cambios: Partial<CorridaTipo>): EstadoRosa {
  const id = laCorrida(estado).id;
  return { ...estado, corridas: estado.corridas.map((c) => (c.id === id ? { ...c, ...cambios } : c)) };
}

/** Deja pasar el frame y el temporizador que viene detrás: desde el 19 de
 *  septiembre de 2026 la pantalla pinta primero su silueta (esqueleto) y el
 *  contenido llega tras el siguiente pintado (lib/diferido.ts). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function pintar(estado: EstadoRosa) {
  const inv = estado.investigaciones[0]!;
  await act(async () => root.render(<Corrida inv={inv} estado={estado} ahora={AHORA} irA={() => undefined} />));
  await esperarPintado();
}

const botones = () => [...nodo.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
const titulos = () => [...nodo.querySelectorAll('[title]')].map((c) => c.getAttribute('title') ?? '');
const todoElTexto = () => [nodo.textContent ?? '', ...titulos()].join('\n');

describe('la franja de modelos en la pantalla de la corrida', () => {
  it('va arriba, antes de la cabecera, con los tres estados', async () => {
    const base = estadoDeMuestra();
    await pintar({ ...base, saludModelos: { cerebro: OK, juez: CAIDO, volumen: LENTO } });
    const franja = nodo.querySelector('section[aria-label="Modelos"]')!;
    expect(franja).not.toBeNull();
    const cabecera = nodo.querySelector('.pantalla-cabecera')!;
    expect(franja.compareDocumentPosition(cabecera) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(franja.textContent).toContain('GPT-6 Astra (cerebro): responde, última respuesta hace 40 s (6 s)');
    expect(franja.textContent).toContain('Claude Opus 5 (juez): sin respuesta desde las 12:34 · 4 intentos sin respuesta · próximo sondeo en 45 s');
    expect(franja.textContent).toContain('Claude Sonnet 5 (volumen): tarda en responder desde las 12:58 · reintento 2 de 4 en 12 s');
    expect(franja.querySelectorAll('.vigilante-punto-ok')).toHaveLength(1);
    expect(franja.querySelectorAll('.vigilante-punto-mal')).toHaveLength(1);
    expect(franja.querySelectorAll('.vigilante-punto-aviso')).toHaveLength(1);
  });

  it('en esperando_modelo enseña el aviso, la etiqueta "Esperando al modelo", para el reloj y "Reintentar ahora" llama a reanudarCorrida', async () => {
    const base = estadoDeMuestra();
    const estado = conCorrida({ ...base, saludModelos: { cerebro: OK, juez: CAIDO } }, { estado: 'esperando_modelo', esperandoModelo: ESPERA, empezadaEn: AHORA - 3_600_000, gasto: { ...laCorrida(base).gasto, segundos: 90 } });
    await pintar(estado);
    expect(nodo.textContent).toContain('ROSA2018 espera a que Claude Opus 5 vuelva a responder. Sondea cada minuto y retomará sola; última comprobación 12:59.');
    expect(nodo.textContent).toContain('Esperando al modelo');
    expect(nodo.textContent).toContain('esperando al modelo: el reloj no corre');
    expect(nodo.textContent).not.toContain('en espera de una persona');
    // El reloj enseña lo guardado (90 s), no la hora de pared.
    expect(nodo.textContent).toContain('1 min 30 s de trabajo');
    expect(nodo.textContent).not.toContain('1 h de trabajo');
    // El botón es "Reintentar ahora", no "Reanudar", y Detener sigue disponible.
    expect(botones()).toContain('Reintentar ahora');
    expect(botones()).not.toContain('Reanudar');
    expect(botones()).toContain('Detener');
    const boton = [...nodo.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar ahora'))!;
    await act(async () => boton.click());
    expect(llamadas).toEqual([['reanudarCorrida', laCorrida(base).id]]);
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('con todos los modelos respondiendo, la franja no se pinta', async () => {
    const base = estadoDeMuestra();
    await pintar({ ...base, saludModelos: { cerebro: OK, juez: OK, volumen: OK } });
    expect(nodo.querySelector('section[aria-label="Modelos"]')).toBeNull();
  });

  it('la incidencia modelo_sin_respuesta pendiente no va en "Algo impide seguir": se lista en la franja como "resolviéndose solo"', async () => {
    const base = estadoDeMuestra();
    const corrida = laCorrida(base);
    const automatica: Incidencia = { id: 'inc-auto', corridaId: corrida.id, tipo: 'modelo_sin_respuesta', titulo: 'Claude Opus 5 no responde', detalle: 'El juez (Claude Opus 5) no respondió en 300 s (intento 1 de 4).', recurso: 'anthropic/claude-opus-5', alternativa: 'ROSA2018 lo está resolviendo sola: reintenta con Claude Opus 5 cada pocos segundos', estado: 'pendiente', creadaEn: AHORA - 5 * 60_000, resueltaEn: null, resolucion: null };
    const otrasPendientes = base.incidencias.filter((i) => i.corridaId === corrida.id && i.estado === 'pendiente').length;
    expect(otrasPendientes).toBe(2);
    await pintar({ ...base, saludModelos: { juez: CAIDO }, incidencias: [...base.incidencias, automatica] });
    // La sección sigue contando solo las que necesitan a una persona.
    expect(nodo.textContent).toContain('2 cosas impiden seguir');
    expect(nodo.textContent).not.toContain('3 cosas impiden seguir');
    const tarjetas = [...nodo.querySelectorAll('article.incidencia')].map((t) => t.textContent ?? '');
    expect(tarjetas.some((t) => t.includes('Claude Opus 5 no responde'))).toBe(false);
    expect(tarjetas).toHaveLength(2);
    // Y aparece en la franja, con su tiempo, sin botón de resolver.
    const franja = nodo.querySelector('section[aria-label="Modelos"]')!;
    expect(franja.textContent).toContain('resolviéndose solo');
    expect(franja.textContent).toContain('Claude Opus 5 no responde · desde hace 5 min');
    expect([...franja.querySelectorAll('button')]).toHaveLength(0);
    expect(nodo.textContent).not.toContain('ROSA2018 lo está resolviendo sola: reintenta con');
  });

  it('con solo la incidencia automática pendiente, "Algo impide seguir" no se pinta', async () => {
    const base = estadoDeMuestra();
    const corrida = laCorrida(base);
    const automatica: Incidencia = { id: 'inc-auto', corridaId: corrida.id, tipo: 'modelo_sin_respuesta', titulo: 'GPT-6 Astra no responde', detalle: '', recurso: 'openai/gpt-6-astra', alternativa: null, estado: 'pendiente', creadaEn: AHORA - 60_000, resueltaEn: null, resolucion: null };
    await pintar({ ...base, incidencias: [automatica] });
    expect(nodo.textContent).not.toContain('impide seguir');
    expect(nodo.textContent).not.toContain('impiden seguir');
    expect(nodo.textContent).toContain('resolviéndose solo');
  });

  it('un registro anterior al vigilante (sin saludModelos ni esperandoModelo) no rompe y la franja no se pinta', async () => {
    const base = estadoDeMuestra();
    const antiguo: EstadoRosa = { ...base, saludModelos: undefined, corridas: base.corridas.map((c) => ({ ...c, esperandoModelo: undefined })) };
    const errores: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errores.push(args);
    try {
      await pintar(conCorrida(antiguo, { estado: 'en_marcha' }));
      // Sin nada que contar, la franja no ocupa sitio en la corrida en vivo.
      expect(nodo.querySelector('section[aria-label="Modelos"]')).toBeNull();
      expect(nodo.textContent).toContain('Corrida');
      // La misma raíz pasa a esperando_modelo sin registro de qué espera (el
      // servidor la devolvería a en marcha al migrar; la interfaz no se cae).
      await pintar(conCorrida(antiguo, { estado: 'esperando_modelo' }));
      expect(nodo.textContent).toContain('ROSA2018 espera a que el modelo vuelva a responder');
      expect(nodo.textContent).toContain('todavía sin comprobación registrada');
      expect(botones()).toContain('Reintentar ahora');
      // Y una corrida terminada sin salud no pinta la franja.
      await pintar(conCorrida(antiguo, { estado: 'terminada', terminadaEn: AHORA }));
      expect(nodo.querySelector('section[aria-label="Modelos"]')).toBeNull();
    } finally {
      console.error = original;
    }
    expect(errores.filter((e) => JSON.stringify(e).includes('hooks'))).toEqual([]);
  });

  it('en una corrida pausada a mano el botón sigue siendo "Reanudar" y no hay aviso de modelo', async () => {
    const base = estadoDeMuestra();
    await pintar(conCorrida({ ...base, saludModelos: { cerebro: OK } }, { estado: 'pausada' }));
    expect(botones()).toContain('Reanudar');
    expect(botones()).not.toContain('Reintentar ahora');
    expect(nodo.textContent).not.toContain('vuelva a responder');
  });
});

describe('el reloj de trabajo con esperando_modelo', () => {
  it('esperando_modelo no es espera humana pero sí pausa del proceso: el reloj enseña lo guardado', () => {
    expect(esperandoPersona('esperando_modelo')).toBe(false);
    expect(ESTADOS_DE_ESPERA_HUMANA.has('esperando_modelo')).toBe(false);
    expect(pausaDelProceso('esperando_modelo')).toBe(true);
    expect(pausaDelProceso('en_marcha')).toBe(false);
    expect([...ESTADOS_DE_PAUSA_DEL_PROCESO]).toEqual(['esperando_modelo']);
    const c = { ...estadoDeMuestra().corridas[0]!, empezadaEn: 1_000_000, terminadaEn: null, estado: 'esperando_modelo' as const, gasto: { ...estadoDeMuestra().corridas[0]!.gasto, segundos: 100 }, esperaHumanaMs: 0, pausaMs: 0 };
    expect(segundosDeTrabajo(c, c.empezadaEn + 3_600_000)).toBe(100);
    // Al volver a en marcha, la espera ya está en pausaMs (la escribe el servidor) y no cuenta.
    expect(segundosDeTrabajo({ ...c, estado: 'en_marcha', pausaMs: 3_500_000 }, c.empezadaEn + 3_600_000)).toBe(100);
  });
});
