// @vitest-environment jsdom
// La traducción al pintarse de lo que no cabe en el catálogo. Con un servidor
// falso, así que se puede hacer que traduzca, que falle o que tarde.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _olvidar, activar, desactivar, pareceCastellano } from './traductorDom';

let raiz: HTMLDivElement;
const espera = () => new Promise((r) => setTimeout(r, 260));

beforeEach(() => {
  _olvidar();
  raiz = document.createElement('div');
  document.body.append(raiz);
});

afterEach(() => {
  desactivar();
  raiz.remove();
});

const falso = (mapa: Record<string, string>) => vi.fn(async (textos: string[]) => Object.fromEntries(textos.filter((t) => mapa[t]).map((t) => [t, mapa[t]!])));

describe('qué se manda a traducir', () => {
  it('castellano sí; inglés, cifras e identificadores no', () => {
    expect(pareceCastellano('La GFAP sube antes que la NfL')).toBe(true);
    expect(pareceCastellano('Hipótesis')).toBe(true);
    expect(pareceCastellano('No data available')).toBe(false); // un «no» suelto no basta
    expect(pareceCastellano('GFAP 0,18; NEFL 0,22')).toBe(false);
    expect(pareceCastellano('10.3389/fnagi.2026.1851072')).toBe(false);
    expect(pareceCastellano('  ')).toBe(false);
  });

  it('las frases cortas sin tilde también, si no hay inglés en ellas', () => {
    // «la cita no resuelve» salía 28 veces en Citas sin traducir: una sola
    // palabra de la lista y ninguna tilde.
    expect(pareceCastellano('la cita no resuelve')).toBe(true);
    expect(pareceCastellano('sin datos')).toBe(true);
    expect(pareceCastellano('No data on the page')).toBe(false);
    expect(pareceCastellano('Open the file')).toBe(false);
  });
});

describe('la traducción en pantalla', () => {
  it('traduce el texto que aparece, conservando sus espacios de borde', async () => {
    raiz.innerHTML = '<p>  La GFAP sube antes que la NfL.  </p>';
    const pedir = falso({ 'La GFAP sube antes que la NfL.': 'GFAP rises before NfL.' });
    activar(raiz, pedir);
    await espera();
    expect(raiz.querySelector('p')!.textContent).toBe('  GFAP rises before NfL.  ');
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('lo que aparece después también se traduce', async () => {
    const pedir = falso({ 'Una hipótesis nueva de la corrida': 'A new hypothesis from the run' });
    activar(raiz, pedir);
    const p = document.createElement('p');
    p.textContent = 'Una hipótesis nueva de la corrida';
    raiz.append(p);
    await espera();
    expect(p.textContent).toBe('A new hypothesis from the run');
  });

  it('si React vuelve a escribir el castellano, se vuelve a traducir sin pedirlo otra vez', async () => {
    raiz.innerHTML = '<p>La cita está en la página</p>';
    const pedir = falso({ 'La cita está en la página': 'The citation is on the page' });
    activar(raiz, pedir);
    await espera();
    const nodo = raiz.querySelector('p')!.firstChild as Text;
    nodo.nodeValue = 'La cita está en la página'; // lo que haría React al repintar
    await espera();
    expect(nodo.nodeValue).toBe('The citation is on the page');
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('no toca código, identificadores ni lo que se está escribiendo', async () => {
    raiz.innerHTML = '<code>la función de la diana</code><pre>sin cita de la fuente</pre><span class="mono">está en el gen</span><span data-sin-traducir>no se toca nada de esto</span><textarea>lo que escribes tú</textarea>';
    const pedir = falso({});
    activar(raiz, pedir);
    await espera();
    expect(pedir).not.toHaveBeenCalled();
  });

  it('al volver al castellano cada nodo recupera su original', async () => {
    raiz.innerHTML = '<p>Lo que ROSA2018 sabe de la diana</p>';
    activar(raiz, falso({ 'Lo que ROSA2018 sabe de la diana': 'What ROSA2018 knows about the target' }));
    await espera();
    expect(raiz.textContent).toBe('What ROSA2018 knows about the target');
    desactivar();
    expect(raiz.textContent).toBe('Lo que ROSA2018 sabe de la diana');
  });

  it('sin servidor se queda en castellano y no lo pide en bucle', async () => {
    raiz.innerHTML = '<p>Una frase que el servidor no puede traducir</p>';
    const pedir = vi.fn(async () => {
      throw new Error('sin red');
    });
    activar(raiz, pedir);
    await espera();
    await espera();
    expect(raiz.textContent).toBe('Una frase que el servidor no puede traducir');
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('lo que el servidor rechaza se queda en castellano, no en blanco', async () => {
    // El servidor no devuelve las traducciones que incumplen las reglas del
    // proyecto (rosa/traductor.py comprobar): mejor castellano que algo falso.
    raiz.innerHTML = '<p>No pude comprobar la cohorte de la hipótesis</p>';
    activar(raiz, falso({}));
    await espera();
    expect(raiz.textContent).toBe('No pude comprobar la cohorte de la hipótesis');
  });
});

describe('la velocidad', () => {
  it('con muchas frases nuevas manda varias peticiones a la vez, no de una en una', async () => {
    let enVuelo = 0;
    let maximo = 0;
    const lento = vi.fn(async (textos: string[]) => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 120));
      enVuelo--;
      return Object.fromEntries(textos.map((t) => [t, `EN ${t}`]));
    });
    raiz.innerHTML = Array.from({ length: 200 }, (_, i) => `<p>La frase número ${i} de la corrida</p>`).join('');
    activar(raiz, lento);
    await new Promise((r) => setTimeout(r, 900));
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(3);
    expect([...raiz.querySelectorAll('p')].every((p) => p.textContent?.startsWith('EN '))).toBe(true);
  });
});
