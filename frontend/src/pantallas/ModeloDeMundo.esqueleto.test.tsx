// @vitest-environment jsdom
// El modelo de mundo con esqueleto (estándar de Emir, 19 de septiembre de
// 2026; rehecho el 1 de octubre con la conversación y "Los hechos"): al montar
// se ve la silueta de la vista que se abre (la barra real con los mandos
// deshabilitados y, debajo, la conversación vacía o los estantes y las filas)
// con aria-busy y rótulo oculto; el contenido llega en el fotograma siguiente.
// Un estado nuevo por el canal en vivo no vuelve a enseñar la silueta;
// cambiar de investigación sí. Y lo que se toca: un tema, una pregunta que se
// responde con lo que ya sabe, abrir un hecho desde la respuesta.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AHORA_MUESTRA, estadoDeMuestra } from '../datos/muestra';
import { ModeloDeMundo } from './ModeloDeMundo';

vi.mock('../datos/almacen', async (original) => ({ ...(await original<typeof import('../datos/almacen')>()), acciones: new Proxy({}, { get: () => () => undefined }) }));

beforeAll(() => {
  // Las secciones entran con `whileInView` (motion): jsdom no trae IntersectionObserver ni ResizeObserver.
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
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const espera = () => nodo.querySelector('[role="status"][aria-busy="true"]');
const rotulo = () => nodo.querySelector('[role="status"] .sr-only')?.textContent;
const hechos = () => nodo.querySelectorAll('.hecho').length;
const boton = (texto: string, dentro: ParentNode = nodo) => [...dentro.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(texto)) ?? null;
const pulsar = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('el esqueleto del modelo de mundo', () => {
  it('abre en la conversación: la silueta tiene la barra real deshabilitada, el compositor y cuatro sugerencias', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    expect(espera()).not.toBeNull();
    expect(rotulo()).toBe('Cargando el modelo de mundo');
    expect(nodo.querySelector('h2')?.textContent).toBe('Modelo de mundo');
    const barra = nodo.querySelector('.mundo-barra')!;
    expect(barra.getAttribute('aria-hidden')).toBe('true');
    const mandos = [...barra.querySelectorAll('button')];
    expect(mandos.length).toBe(4);
    expect(mandos.every((m) => m.disabled)).toBe(true);
    expect(nodo.querySelectorAll('[data-esqueleto="sugerencia"]').length).toBe(4);
    expect(nodo.querySelector('textarea')).toBeNull();
    for (const bloque of nodo.querySelectorAll('.esqueleto')) expect(bloque.getAttribute('aria-hidden')).toBe('true');
    // Ningún "Cargando" visible: el rótulo va solo al lector de pantalla.
    expect(nodo.textContent?.replace(rotulo() ?? '', '')).not.toContain('Cargando');
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(nodo.querySelectorAll('.esqueleto').length).toBe(0);
    expect(nodo.querySelector('textarea')).not.toBeNull();
    expect(nodo.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Conversar');
    // La bienvenida incluye las dos marcas, separadas del avatar de ROSA.
    expect([...nodo.querySelectorAll('.mundo-vacio .identidad-chat img')]
      .map((img) => img.getAttribute('alt'))).toEqual(['Alzheimer Project', 'AI Robotix']);
    expect(nodo.textContent).toContain('Qué cambió');
    expect(nodo.textContent).not.toContain('\u2014');
  });

  it('abierto en "Los hechos" la silueta es la de los estantes y las filas, no la del chat', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<ModeloDeMundo inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    expect(espera()).not.toBeNull();
    expect(nodo.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Los hechos');
    expect(nodo.querySelectorAll('[data-esqueleto="estante"]').length).toBeGreaterThan(0);
    expect(nodo.querySelectorAll('[data-esqueleto="hecho"]').length).toBeGreaterThan(0);
    expect(nodo.querySelectorAll('[data-esqueleto="sugerencia"]').length).toBe(0);
    expect(hechos()).toBe(0);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(hechos()).toBeGreaterThan(0);
    expect(nodo.querySelector('input[aria-label="Buscar"]')).not.toBeNull();
  });

  it('un estado nuevo por el canal en vivo conserva los hechos sin esqueleto, y la búsqueda sigue viva', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    await esperarPintado();
    const antes = hechos();
    const e2 = structuredClone(e);
    await act(async () => root.render(<ModeloDeMundo inv={e2.investigaciones[0]!} estado={e2} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    expect(espera()).toBeNull();
    expect(hechos()).toBe(antes);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(hechos()).toBe(antes);
    // Buscar filtra sin pasar por el esqueleto.
    await act(async () => escribir(nodo.querySelector<HTMLInputElement>('input[aria-label="Buscar"]')!, 'zzzz-no-existe'));
    expect(espera()).toBeNull();
    expect(hechos()).toBe(0);
    expect(nodo.textContent).toContain('Nada con este filtro.');
    await pulsar(boton('Quitar los filtros'));
    expect(hechos()).toBe(antes);
  });

  it('al cambiar de investigación vuelve la silueta y después llegan los hechos de la nueva', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<ModeloDeMundo inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    await esperarPintado();
    const e2 = structuredClone(e);
    const inv2 = { ...e2.investigaciones[0]!, id: 'inv-2', titulo: 'Otra investigación' };
    e2.investigaciones = [inv2];
    // Solo dos hechos pasan a la nueva investigación.
    for (const h of e2.hechos.slice(0, 2)) h.investigacionId = 'inv-2';
    await act(async () => root.render(<ModeloDeMundo inv={inv2} estado={e2} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    expect(espera()).not.toBeNull();
    expect(hechos()).toBe(0);
    await esperarPintado();
    expect(espera()).toBeNull();
    expect(hechos()).toBe(2);
  });
});

describe('lo que se toca en el modelo de mundo', () => {
  it('elegir un tema filtra las filas, enseña su cabecera, y "Preguntar sobre" lleva a la conversación con la pregunta escrita', async () => {
    const e = estadoDeMuestra();
    // La muestra no trae entidades enlazadas: se le pone el LCR a cuatro hechos
    // de la investigación (un tejido; un gen que el texto no nombra se aparta como dudoso).
    const LCR = { id: 'UBERON:0001359', etiqueta: 'cerebrospinal fluid', ontologia: 'UBERON', tipo: 'tejido', alias: [] };
    const propios = e.hechos.filter((h) => h.investigacionId === e.investigaciones[0]!.id);
    for (const h of propios.slice(0, 4)) h.entidades = [LCR];
    await act(async () => root.render(<ModeloDeMundo inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} vistaInicial="hechos" />));
    await esperarPintado();
    const estante = nodo.querySelector<HTMLButtonElement>('.mundo-estante');
    expect(estante).not.toBeNull();
    const nombre = estante!.querySelector('.mundo-estante-nombre')!.textContent!;
    const total = Number(estante!.querySelector('.mundo-estante-n')!.textContent);
    await pulsar(estante);
    expect(estante!.getAttribute('aria-pressed')).toBe('true');
    const sel = nodo.querySelector('.mundo-tema-sel');
    expect(sel?.querySelector('h3')?.textContent).toBe(nombre);
    // Cada grupo enseña hasta 6 con un filtro puesto; los que quedan se cuentan.
    const visibles = hechos();
    const restantes = [...nodo.querySelectorAll('.mundo-mas')].reduce((n, b) => n + Number(/quedan (\d+)|los (\d+)|el (\d+)/.exec(b.textContent ?? '')?.slice(1).find(Boolean) ?? 0), 0);
    expect(visibles + restantes).toBe(total);
    // Volver a pulsarlo lo quita.
    await pulsar(estante);
    expect(nodo.querySelector('.mundo-tema-sel')).toBeNull();
    await pulsar(estante);
    await pulsar(boton(`Preguntar sobre ${nombre}`));
    expect(nodo.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Conversar');
    expect(nodo.querySelector('textarea')?.value).toBe(`¿Qué se sabe de ${nombre}?`);
  });

  it('sin conexión una pregunta responde al momento con los hechos, y abrir uno lleva a su ficha', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const propio = e.hechos.find((h) => h.investigacionId === inv.id && h.estado === 'sabido')!;
    const palabra = propio.enunciado.split(/[^A-Za-zÁÉÍÓÚáéíóúñÑ0-9-]+/).find((p) => p.length > 5)!;
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    // Sin conexión (la muestra) no hay selector: responde con lo que ya sabe.
    expect(e.conexion).not.toBe('en_linea');
    expect(nodo.querySelector('[role="radio"]')).toBeNull();
    // Ni «Preguntado antes» ni iconos en las sugerencias.
    expect(nodo.textContent).not.toContain('Preguntado antes');
    expect(nodo.querySelector('.mundo-sugerencia svg')).toBeNull();
    expect(nodo.querySelector('.mundo-sugerencias-titulo')?.textContent).toBe('Para empezar');
    expect(nodo.querySelector('.mundo-vacio-cabeza .mundo-vacio-cara')).toBeNull();
    const entrada = nodo.querySelector('textarea')!;
    await act(async () => escribir(entrada, `¿Qué sabe de ${palabra}?`));
    await pulsar(nodo.querySelector('.mundo-enviar'));
    expect(nodo.querySelector('.mundo-chat')).not.toBeNull();
    expect(nodo.textContent).toContain(`¿Qué sabe de ${palabra}?`);
    expect(nodo.textContent).toContain('Solo lo que ya sabe · no se guarda');
    // Sin conexión no ofrece buscar fuera: fallaría.
    expect(boton('Buscar también en las publicaciones')).toBeNull();
    const encontrados = nodo.querySelectorAll('.mundo-encontrados button');
    expect(encontrados.length).toBeGreaterThan(0);
    const texto = encontrados[0]!.querySelector('.mundo-encontrado-texto')!.textContent!;
    await pulsar(encontrados[0]!);
    expect(nodo.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Los hechos');
    expect(nodo.querySelector('.mundo-detalle')?.textContent).toContain(texto.replace(/\.\.\.$/, ''));
    expect(nodo.querySelector('.mundo-detalle')?.textContent).toContain('De dónde sale');
  });

  it('una respuesta guardada lleva la marca, «Pensó s · búsquedas · documentos», la cobertura y el pie de atribución', async () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    inv.preguntasABases = [
      {
        id: 'pb-1', fecha: AHORA_MUESTRA - 60_000, pregunta: '¿Qué se sabe de p-tau217?', respuesta: 'No encuentro información sobre p-tau217 en los documentos.\n\n| Matriz | Estudios |\n| --- | --- |\n| Plasma | ninguno |', limites: 'No hay estudios en plasma.', hilo: 'h-prueba',
        herramientas: ['leer_modelo_de_mundo', 'buscar_pubmed', 'buscar_pubmed'], iteraciones: 4, quien: 'emir', error: null, duracionMs: 19_200,
        consultas: [{ id: 'c1', herramienta: 'buscar_pubmed', fuente: 'PubMed', argumentos: {}, fecha: 1, n: 7, ids: ['1', '2', '3', '4', '5', '6', '7'], version: null, invariante: null, error: null, ms: 900, resumen: '' }],
        cobertura: [
          { estado: 'no_esta', parte: 'Qué es p-tau217 y para qué se ha propuesto', nota: '' },
          { estado: 'no_esta', parte: 'Estudios en humanos en plasma, suero o LCR', nota: 'Ninguna búsqueda lo devolvió' },
        ],
        atribucion: { citadas: [], sinRespaldo: [] },
      },
    ];
    await act(async () => root.render(<ModeloDeMundo inv={inv} estado={e} ahora={AHORA_MUESTRA} />));
    await esperarPintado();
    await pulsar(boton('Conversaciones anteriores'));
    await pulsar(nodo.querySelector('.mundo-historial-panel li button'));
    const r = nodo.querySelector('.mundo-respuesta')!;
    // La marca del árbol sigue en cada respuesta (es la marca gráfica de
    // ROSA2018 y no se sustituye): desde el 2 de octubre de 2026 va dentro
    // del orbe animado, que dice con palabras en qué está.
    const cara = r.querySelector('.mundo-marca')!;
    expect(cara.getAttribute('role')).toBe('img');
    expect(cara.getAttribute('aria-label')).toMatch(/ROSA2018/);
    expect(cara.querySelector('img.persona-marca')?.getAttribute('src')).toBe('/arbol-marca.png');
    const cabeza = r.querySelector('.mundo-busqueda')!;
    expect([...cabeza.querySelectorAll('.mundo-busqueda-dato')].map((x) => x.textContent)).toEqual(['Pensó 19 s', '3 búsquedas', '7 documentos']);
    expect([...cabeza.querySelectorAll('.mundo-fuente')].map((x) => x.textContent)).toEqual(['M', 'P']);
    expect(r.querySelector('.mundo-cobertura-titulo')?.textContent).toBe('Cobertura de la pregunta');
    expect(r.querySelectorAll('.mundo-cobertura-parte.mundo-cob-no_esta')).toHaveLength(2);
    // El estado es una etiqueta corta; la larga, «con lo consultado», va en
    // el title. La nota, debajo de la parte.
    const parte = r.querySelectorAll('.mundo-cobertura-parte')[1]!;
    expect(parte.querySelector('.mundo-cobertura-estado')?.textContent).toBe('No está');
    expect(parte.querySelector('.mundo-cobertura-estado')?.getAttribute('title')).toBe('No está en lo consultado');
    expect(parte.querySelector('.mundo-cobertura-nota')?.textContent).toBe('Ninguna búsqueda lo devolvió');
    expect(r.querySelector('.mundo-cobertura-cuenta')?.textContent).toBe('0 de 2 respondidas');
    // El pie de atribución cierra la cobertura, no es otra caja aparte.
    expect(r.querySelector('.mundo-cobertura .mundo-atribucion')).not.toBeNull();
    // Con cobertura, «Lo que no pudo comprobar» no se repite aparte.
    expect(r.querySelector('.mundo-limites')).toBeNull();
    expect(r.querySelector('.mundo-atribucion-bien')?.textContent).toContain('La respuesta se abstiene y no cita: correcto, nada que atribuir.');
    // Una tabla en markdown se pinta como tabla, no como barras sueltas.
    expect([...r.querySelectorAll('.mundo-tabla th')].map((x) => x.textContent)).toEqual(['Matriz', 'Estudios']);
    expect([...r.querySelectorAll('.mundo-tabla td')].map((x) => x.textContent)).toEqual(['Plasma', 'ninguno']);
    expect(r.textContent).not.toContain('| ---');
    // Acciones solo con icono, pero con nombre para el lector de pantalla.
    expect(r.querySelector('.mundo-acciones-iconos .mundo-accion-nombre')?.textContent).toBe('Copiar');
    expect(r.textContent).not.toContain('Seguir preguntando');
    // Como en Kimi: la línea de tiempo se QUEDA, plegada en una línea encima
    // de la respuesta («Usó 1 herramienta, ...»), y se abre desde ahí. Lo que
    // se abre desde la cabecera es el detalle de cada consulta, otra cosa.
    // (Antes iba oculta «como Pensó 8 s en ChatGPT»; Emir, 3 de octubre de
    // 2026: las filas que se estaban viendo se esfumaban al llegar la
    // respuesta.)
    const resumen = r.querySelector<HTMLButtonElement>('.razon-resumen');
    expect(resumen).not.toBeNull();
    expect(resumen!.textContent).toContain('Usó');
    expect(r.querySelector('.mundo-rastro-detalle')).toBeNull();
    await pulsar(cabeza);
    expect(r.querySelector('.mundo-rastro-detalle')).not.toBeNull();
    expect(cabeza.getAttribute('aria-expanded')).toBe('true');
  });

  it('"Qué cambió" se abre sin romper y con sus tildes', async () => {
    const e = estadoDeMuestra();
    await act(async () => root.render(<ModeloDeMundo inv={e.investigaciones[0]!} estado={e} ahora={AHORA_MUESTRA} vistaInicial="cambios" />));
    await esperarPintado();
    expect(nodo.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Qué cambió');
    expect(nodo.textContent).not.toContain('\u2014');
    await pulsar(boton('Los hechos'));
    expect(hechos()).toBeGreaterThan(0);
  });
});
