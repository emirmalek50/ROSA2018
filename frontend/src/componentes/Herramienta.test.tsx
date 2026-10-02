// @vitest-environment jsdom
// La tarjeta de cada llamada a una base.
//
// Lo que de verdad defiende este fichero es una sola regla del proyecto, la
// que más caro sale romper: una base que no responde es «no pude comprobar»,
// nunca «sin resultados». Son dos estados distintos y confundirlos hace creer
// que se miró y no había, cuando no se llegó a mirar. El resto de las
// pruebas son para que esa distinción no se pierda al tocar el componente.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Herramienta, Herramientas, estadoDe } from './Herramienta';
import type { ConsultaBase } from '../datos/tipos';

let nodo: HTMLDivElement;
let root: Root;

beforeEach(() => {
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});

afterEach(() => {
  act(() => root.unmount());
  nodo.remove();
});

const AHORA = Date.UTC(2026, 9, 2, 12, 0, 0);

function consulta(p: Partial<ConsultaBase> = {}): ConsultaBase {
  return {
    id: 'c1',
    herramienta: 'buscar_pubmed',
    fuente: 'PubMed',
    argumentos: { term: 'GFAP AND APOE4', retmax: '100' },
    fecha: AHORA - 60_000,
    n: 12,
    ids: ['40112233', '40112234'],
    version: '2026-09',
    invariante: { ok: true, detalle: 'los ids devueltos existen en la base' },
    error: null,
    ms: 820,
    resumen: '',
    ...p,
  };
}

const pintar = (ui: React.ReactElement) => act(async () => root.render(ui));
const texto = () => nodo.textContent ?? '';

describe('«no pude comprobar» no es «sin resultados»', () => {
  it('una base que falla lo dice así, y lo dice explícitamente', async () => {
    await pintar(<Herramienta c={consulta({ error: 'tiempo agotado a los 30 s', n: null, ids: [] })} ahora={AHORA} abiertaDeInicio />);
    expect(texto()).toContain('no pude comprobar');
    expect(texto()).toContain('tiempo agotado a los 30 s');
    // Y lo deja escrito, que es lo que impide la lectura equivocada.
    expect(texto()).toContain('No es «sin resultados»');
    expect(texto()).not.toMatch(/\b0 resultados\b/);
  });

  it('una base que responde cero SÍ es una ausencia, y se dice distinto', async () => {
    await pintar(<Herramienta c={consulta({ n: 0, ids: [] })} ahora={AHORA} abiertaDeInicio />);
    expect(texto()).toContain('sin resultados');
    expect(texto()).not.toContain('no pude comprobar');
  });

  it('sin conteo pero con ids hay resultados; sin conteo y sin ids, no se sabe', () => {
    // `n` nulo es «la base no dijo cuántos», no «cero».
    expect(estadoDe({ error: null, n: null, ids: ['a'] })).toBe('bien');
    expect(estadoDe({ error: null, n: null, ids: [] })).toBe('sin_respuesta');
    expect(estadoDe({ error: null, n: 0, ids: [] })).toBe('vacia');
    expect(estadoDe({ error: 'lo que sea', n: 99, ids: ['a'] })).toBe('sin_respuesta');
  });

  it('el recuento de arriba no suma las que fallaron a las vacías', async () => {
    const cs = [
      consulta({ id: 'a', n: 5 }),
      consulta({ id: 'b', n: 0, ids: [] }),
      consulta({ id: 'c', error: 'la base no respondió', n: null, ids: [] }),
      consulta({ id: 'd', error: '502', n: null, ids: [] }),
    ];
    await pintar(<Herramientas consultas={cs} ahora={AHORA} />);
    expect(texto()).toContain('4 consultas');
    expect(texto()).toContain('1 sin resultados');
    expect(texto()).toContain('2 no pude comprobar');
  });
});

describe('lo que se puede comprobar desde fuera', () => {
  it('abierta enseña los argumentos exactos, lo que volvió y el invariante', async () => {
    await pintar(<Herramienta c={consulta()} ahora={AHORA} abiertaDeInicio />);
    expect(texto()).toContain('GFAP AND APOE4');
    expect(texto()).toContain('retmax');
    expect(texto()).toContain('12 resultados');
    expect(texto()).toContain('40112233');
    expect(texto()).toContain('los ids devueltos existen en la base');
  });

  it('sin invariante lo dice y explica qué se pierde, en vez de callarlo', async () => {
    await pintar(<Herramienta c={consulta({ invariante: null })} ahora={AHORA} abiertaDeInicio />);
    expect(texto()).toContain('Sin invariante registrado');
    expect(texto()).toContain('no se puede dar por buena desde fuera');
  });

  it('cerrada no enseña el detalle, y se abre al pulsar', async () => {
    await pintar(<Herramienta c={consulta()} ahora={AHORA} />);
    expect(texto()).toContain('PubMed');
    expect(texto()).not.toContain('GFAP AND APOE4');
    const b = nodo.querySelector('button.llamada-cabeza')!;
    expect(b.getAttribute('aria-expanded')).toBe('false');
    await act(async () => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(nodo.querySelector('button.llamada-cabeza')!.getAttribute('aria-expanded')).toBe('true');
    expect(texto()).toContain('GFAP AND APOE4');
  });

  it('no se cae con una consulta a medias', async () => {
    // El estado viejo o un registro roto no pueden tumbar el hilo entero.
    const rota = { id: 'x', herramienta: '', fuente: '', argumentos: {}, fecha: 0, n: null, ids: [], version: null, invariante: null, error: null, ms: 0, resumen: '' } as ConsultaBase;
    await pintar(<Herramienta c={rota} ahora={AHORA} abiertaDeInicio />);
    expect(texto()).toContain('Sin argumentos registrados');
  });
});
