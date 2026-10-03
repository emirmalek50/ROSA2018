// @vitest-environment jsdom
// La línea de tiempo del razonamiento, como la de Kimi. Lo que defiende:
// - Que un pensamiento no se confunda con un hecho: va marcado como tal.
// - Que una herramienta que falló diga «no pude comprobar», no «listo».
// - Que lo que está pasando ahora se vea en marcha, y lo terminado, no.
// - Que ya contestada se pliegue en una línea, sin tapar la respuesta.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Razonamiento } from './Razonamiento';
import type { PasoRazonamiento } from '../datos/tipos';

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

const T = Date.UTC(2026, 9, 2, 12, 0, 0);
const pintar = (ui: React.ReactElement) => act(async () => root.render(ui));
const pulsar = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** Las filas que son PASOS (pensar o herramienta). El sub-paso con punto que
 *  cuelga de una herramienta (`.razon-sub`) es otra fila visual, pero no un
 *  paso: se cuenta aparte. */
const filas = () => [...nodo.querySelectorAll('.razon-pensar, .razon-herramienta, .razon-prosa')];
const subpasos = () => [...nodo.querySelectorAll('.razon-sub')];

const PASOS: PasoRazonamiento[] = [
  { id: 'p1', tipo: 'pensar', texto: 'Consultaré primero el modelo de mundo. Después, la literatura longitudinal.', inicio: T },
  { id: 'p2', tipo: 'herramienta', herramienta: 'leer_modelo_de_mundo', familia: 'mundo', nombre: 'el modelo de mundo', argumentos: { tema: 'p-tau217 plasmática' }, inicio: T + 100, fin: T + 1000, error: null, resumen: '12 hechos' },
  { id: 'p3', tipo: 'herramienta', herramienta: 'buscar_pubmed', familia: 'base', nombre: 'PubMed', argumentos: { consulta: 'p-tau217 plasma prognosis' }, inicio: T + 1100, fin: T + 1500, error: 'Error: la base no respondió a tiempo', resumen: '' },
  { id: 'p4', tipo: 'pensar', texto: 'Con eso basta.', cierra: true, inicio: T + 1600 },
];

describe('la línea de tiempo del razonamiento', () => {
  it('pinta cada paso con su etiqueta y lo que buscó, con mayúscula al principio', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} />);
    expect(filas()).toHaveLength(4);
    const t = nodo.textContent ?? '';
    expect(t).toContain('Consultaré primero el modelo de mundo.');
    expect(t).toContain('El modelo de mundo');
    expect(t).toContain('p-tau217 plasmática');
    expect(t).toContain('Listo para responder');
  });

  it('una herramienta que falló dice «no pude comprobar», no «listo»', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} />);
    const fallida = filas()[2]!;
    expect(fallida.className).toContain('razon-fallo');
    expect(fallida.textContent).toContain('no pude comprobar');
    expect(fallida.textContent).not.toContain('listo');
    await pulsar(fallida.querySelector('button')!);
    expect(fallida.textContent).toContain('No es «sin resultados»');
  });

  it('al desplegar un pensamiento avisa de que no es un hecho comprobado', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} />);
    await pulsar(filas()[0]!.querySelector('button')!);
    expect(filas()[0]!.textContent).toContain('no un hecho comprobado');
    expect(filas()[0]!.textContent).toContain('Después, la literatura longitudinal.');
  });

  it('en marcha, lo que está pasando ahora late y lo terminado no', async () => {
    const vivos: PasoRazonamiento[] = [
      PASOS[0]!,
      { id: 'p2', tipo: 'herramienta', herramienta: 'buscar_pubmed', familia: 'base', nombre: 'PubMed', argumentos: { consulta: 'x' }, inicio: T, fin: null },
    ];
    await pintar(<Razonamiento pasos={vivos} ahora={T + 3000} enMarcha />);
    expect(filas()[0]!.className).not.toContain('razon-viva');
    expect(filas()[1]!.className).toContain('razon-viva');
    expect(filas()[1]!.querySelector('.brillo, .brillo-quieto')).not.toBeNull();
  });

  it('sin pasos todavía pero en marcha dice que está empezando; sin pasos y parado, nada', async () => {
    await pintar(<Razonamiento pasos={[]} ahora={T} enMarcha />);
    expect(nodo.textContent).toContain('Pensando');
    await pintar(<Razonamiento pasos={[]} ahora={T} />);
    expect(nodo.textContent).toBe('');
  });

  it('ya contestada se pliega en una línea, con las que fallaron a la vista', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} plegable />);
    expect(filas()).toHaveLength(0);
    const resumen = nodo.querySelector('.razon-resumen')!;
    expect(resumen.textContent).toContain('Usó 2 herramientas');
    expect(resumen.textContent).toContain('1 sin poder comprobar');
    await pulsar(resumen);
    expect(filas()).toHaveLength(4);
  });
});

describe('lo que hace que se parezca a Kimi', () => {
  it('la herramienta dice de qué base y cuántos trajo, con su círculo', async () => {
    // «Fetch URLs | ●●● 6 pages»: aquí la base y sus resultados, que vienen
    // del servidor. Sin ellos no se inventa nada.
    const pasos: PasoRazonamiento[] = [
      { id: 'a', tipo: 'herramienta', herramienta: 'buscar_europepmc', familia: 'base', nombre: 'Europe PMC', argumentos: { consulta: 'GFAP' }, inicio: T, fin: T + 900, error: null, resumen: 'Seis artículos sobre GFAP plasmático en portadores.', fuente: 'Europe PMC', n: 6 },
      { id: 'b', tipo: 'herramienta', herramienta: 'leer_modelo_de_mundo', familia: 'mundo', nombre: 'el modelo de mundo', argumentos: { tema: 'GFAP' }, inicio: T + 1000, fin: T + 1200, error: null, resumen: '' },
    ];
    await pintar(<Razonamiento pasos={pasos} ahora={T + 2000} />);
    const [a, b] = filas();
    expect(a!.querySelector('.razon-fuentes .mundo-fuente')?.textContent).toBe('E');
    expect(a!.textContent).toContain('6 resultados');
    // Sin fuente ni n: ni círculo ni cuenta; se ve lo que buscó.
    expect(b!.querySelector('.razon-fuentes')).toBeNull();
    expect(b!.textContent).not.toContain('resultados');
    expect(b!.textContent).toContain('GFAP');
  });

  it('bajo la herramienta cuelga el sub-paso con punto que resume lo que trajo', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} />);
    // Solo la herramienta que trajo algo (p2): la fallida (p3) no lleva.
    expect(subpasos()).toHaveLength(1);
    expect(subpasos()[0]!.textContent).toContain('12 hechos');
  });

  it('con fuente y cuenta en la fila, el sub-paso no repite lo mismo debajo', async () => {
    const pasos: PasoRazonamiento[] = [
      { id: 'a', tipo: 'herramienta', herramienta: 'exa', familia: 'base', nombre: 'Exa', argumentos: { consulta: 'GFAP' }, inicio: T, fin: T + 900, error: null, resumen: 'Exa: 10 resultados', fuente: 'Exa', n: 10 },
    ];
    await pintar(<Razonamiento pasos={pasos} ahora={T + 2000} />);
    expect(subpasos()).toHaveLength(0);
    expect(nodo.textContent).toContain('10 resultados');
  });

  it('un pensamiento largo es prosa, no una fila con bombilla', async () => {
    const largo = 'El modelo de mundo ya tiene cuatro hechos sobre GFAP en portadores de APOE4, pero ninguno longitudinal. Voy a buscar en la literatura cohortes con medidas seriadas antes de contestar.';
    const pasos: PasoRazonamiento[] = [
      { id: 'a', tipo: 'pensar', texto: largo, inicio: T },
      { id: 'b', tipo: 'pensar', texto: 'Con eso basta.', cierra: true, inicio: T + 100 },
    ];
    await pintar(<Razonamiento pasos={pasos} ahora={T + 2000} />);
    expect(nodo.querySelector('.razon-prosa .razon-prosa-texto')?.textContent).toBe(largo);
    // El corto sigue siendo fila.
    expect(nodo.querySelectorAll('.razon-pensar')).toHaveLength(1);
  });

  it('mientras está en marcha, el último pensamiento es fila aunque sea largo: está pensando AHORA', async () => {
    const largo = 'Estoy repasando los cuatro hechos del modelo de mundo sobre GFAP para ver si alguno es longitudinal antes de ir a la literatura.';
    await pintar(<Razonamiento pasos={[{ id: 'a', tipo: 'pensar', texto: largo, inicio: T }]} ahora={T + 500} enMarcha />);
    expect(nodo.querySelector('.razon-prosa')).toBeNull();
    expect(nodo.querySelector('.razon-viva')).toBeTruthy();
  });

  it('plegada dice cuántas herramientas y cuál fue la primera, como «Used 1 tool, Fetch…»', async () => {
    await pintar(<Razonamiento pasos={PASOS} ahora={T + 2000} plegable />);
    expect(nodo.querySelector('.razon-resumen')?.textContent).toContain('Usó 2 herramientas, la primera El modelo de mundo');
  });
});

