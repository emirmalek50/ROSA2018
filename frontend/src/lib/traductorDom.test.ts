// @vitest-environment jsdom
// La traducción al pintarse de lo que no cabe en el catálogo. Con un servidor
// falso, así que se puede hacer que traduzca, que falle o que tarde.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _olvidar, activar, desactivar, pareceCastellano, traducirSuelto } from './traductorDom';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  it('las etiquetas del servidor que ya están en el catálogo aparecen en inglés sin red', () => {
    raiz.innerHTML = '<p>cuerpo calloso</p><p>Severidad basal</p><button title="sin tipo celular">MOTIVOS</button><code>cuerpo calloso</code>';
    const pedir = falso({});
    activar(raiz, pedir);
    expect(raiz.querySelector('p')!.textContent).toBe('corpus callosum');
    expect(raiz.querySelector('button')!.textContent).toBe('MOTIFS');
    expect(raiz.querySelector('button')!.title).toBe('no cell type');
    expect(raiz.querySelector('code')!.textContent).toBe('cuerpo calloso');
    expect(pedir).not.toHaveBeenCalled();
    desactivar();
    expect(raiz.querySelector('p')!.textContent).toBe('cuerpo calloso');
  });

  it('un fallo temporal se reintenta y no queda memorizado como traducción', async () => {
    vi.useFakeTimers();
    raiz.innerHTML = '<p>La evidencia nueva de esta cohorte</p>';
    const pedir = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue({ 'La evidencia nueva de esta cohorte': 'New evidence from this cohort' });
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(1700);
    expect(raiz.textContent).toBe('New evidence from this cohort');
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('los rechazos persistentes tienen reintentos acotados y conservan el original', async () => {
    vi.useFakeTimers();
    raiz.innerHTML = '<p>La afirmación que no se pudo traducir</p>';
    const pedir = falso({});
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(raiz.textContent).toBe('La afirmación que no se pudo traducir');
    expect(pedir).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pedir).toHaveBeenCalledTimes(4);
  });

  it('otro repintado no duplica una frase que ya está en vuelo', async () => {
    vi.useFakeTimers();
    let terminar!: (r: Record<string, string>) => void;
    const pedir = vi.fn(() => new Promise<Record<string, string>>((r) => { terminar = r; }));
    raiz.innerHTML = '<p>La evidencia nueva de esta cohorte</p>';
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(200);
    const otro = document.createElement('p');
    otro.textContent = 'La evidencia nueva de esta cohorte';
    raiz.append(otro);
    await vi.advanceTimersByTimeAsync(200);
    expect(pedir).toHaveBeenCalledTimes(1);
    terminar({ 'La evidencia nueva de esta cohorte': 'New evidence from this cohort' });
    await vi.advanceTimersByTimeAsync(200);
    expect([...raiz.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['New evidence from this cohort', 'New evidence from this cohort']);
  });

  it('un reintento lento no retrasa una frase recién abierta', async () => {
    vi.useFakeTimers();
    raiz.innerHTML = '<p>La frase que falla</p>';
    const pedir = falso({ 'La frase nueva': 'New sentence' });
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(200);
    const nuevo = document.createElement('p');
    nuevo.textContent = 'La frase nueva';
    raiz.append(nuevo);
    await vi.advanceTimersByTimeAsync(200);
    expect(nuevo.textContent).toBe('New sentence');
  });

  it('el texto fuera de pantalla espera hasta que se ve, sin retrasar el visible', async () => {
    vi.useFakeTimers();
    let avisar!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { avisar = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    raiz.innerHTML = '<p>La evidencia visible</p><p>La evidencia fuera de pantalla</p>';
    const pedir = falso({ 'La evidencia visible': 'Visible evidence', 'La evidencia fuera de pantalla': 'Offscreen evidence' });
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(200);
    expect(pedir).not.toHaveBeenCalled();
    const [primero, segundo] = raiz.querySelectorAll('p');
    const aparece = (target: Element) => avisar([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    aparece(primero!);
    await vi.advanceTimersByTimeAsync(200);
    expect(pedir).toHaveBeenLastCalledWith(['La evidencia visible']);
    expect(segundo!.textContent).toBe('La evidencia fuera de pantalla');
    aparece(segundo!);
    await vi.advanceTimersByTimeAsync(200);
    expect(segundo!.textContent).toBe('Offscreen evidence');
  });

  it('los párrafos se reparten sin hacer esperar a una pantalla por un lote enorme', async () => {
    vi.useFakeTimers();
    const textos = Array.from({ length: 12 }, (_, i) => `La evidencia de la cohorte ${i}. ${'Datos de la investigación. '.repeat(60)}`);
    const pedir = vi.fn(async (lote: string[]) => Object.fromEntries(lote.map((t) => [t, t.replace('La evidencia de la cohorte', 'Evidence from cohort').replaceAll('Datos de la investigación.', 'Research data.')])));
    raiz.innerHTML = textos.map((t) => `<p>${t}</p>`).join('');
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(1000);
    for (const [lote] of pedir.mock.calls) expect(lote.reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(4500);
    expect(raiz.textContent).not.toContain('cohorte');
  });

  it('prepara todas las opciones cuando el selector nativo aparece, aunque esté cerrado', async () => {
    vi.useFakeTimers();
    let avisar!: IntersectionObserverCallback;
    const observar = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { avisar = callback; }
      observe = observar;
      disconnect = vi.fn();
    });
    raiz.innerHTML = '<select><option value="inv-1">La investigación sobre tau</option><option value="inv-2">La investigación sobre amiloide</option></select>';
    const pedir = falso({ 'La investigación sobre tau': 'Tau investigation', 'La investigación sobre amiloide': 'Amyloid investigation' });
    activar(raiz, pedir);
    const selector = raiz.querySelector('select')!;
    expect(observar).toHaveBeenCalledWith(selector);
    const rect = selector.getBoundingClientRect();
    avisar([{ target: selector, isIntersecting: true, boundingClientRect: rect, intersectionRect: rect, intersectionRatio: 1, rootBounds: null, time: 0 }], {} as IntersectionObserver);
    await vi.advanceTimersByTimeAsync(200);
    expect([...selector.options].map((o) => [o.value, o.textContent])).toEqual([['inv-1', 'Tau investigation'], ['inv-2', 'Amyloid investigation']]);
  });

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

  it('una respuesta tardía no cambia el texto después de volver al castellano', async () => {
    vi.useFakeTimers();
    let terminar!: (r: Record<string, string>) => void;
    const pedir = vi.fn(() => new Promise<Record<string, string>>((r) => { terminar = r; }));
    raiz.innerHTML = '<p>La evidencia de la investigación pendiente</p>';
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(200);
    desactivar();
    terminar({ 'La evidencia de la investigación pendiente': 'Evidence from the pending investigation' });
    await vi.advanceTimersByTimeAsync(200);
    expect(raiz.textContent).toBe('La evidencia de la investigación pendiente');
    activar(raiz, pedir);
    expect(raiz.textContent).toBe('Evidence from the pending investigation');
    expect(pedir).toHaveBeenCalledTimes(1);
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

  it('una respuesta que cambia la dosis no se muestra ni se memoriza', async () => {
    vi.useFakeTimers();
    const original = 'La dosis propuesta es de 20 µM para esta investigación';
    const valido = 'The proposed dose is 20 µM for this investigation';
    raiz.textContent = original;
    const pedir = vi.fn().mockResolvedValueOnce({ [original]: valido.replace('µM', 'mM') }).mockResolvedValue({ [original]: valido });
    activar(raiz, pedir);
    await vi.advanceTimersByTimeAsync(200);
    expect(raiz.textContent).toBe(original);
    await vi.advanceTimersByTimeAsync(1500);
    expect(raiz.textContent).toBe(valido);
    expect(pedir).toHaveBeenCalledTimes(2);
    desactivar();
    expect(raiz.textContent).toBe(original);
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

describe('lo que se lee fuera del texto', () => {
  it('traduce title, aria-label, placeholder y alt', async () => {
    // Un botón cuyo globo sigue en castellano no está traducido.
    raiz.innerHTML = `
      <button title="La hipótesis tal como está">x</button>
      <span aria-label="Confusión por fisiología sistémica">y</span>
      <input placeholder="Escribe una pregunta" />
      <img src="z.png" alt="El árbol del proyecto" />`;
    activar(raiz, falso({
      'La hipótesis tal como está': 'The hypothesis as it stands',
      'Confusión por fisiología sistémica': 'Confounding by systemic physiology',
      'Escribe una pregunta': 'Type a question',
      'El árbol del proyecto': "The project's tree",
    }));
    await espera();
    expect(raiz.querySelector('button')!.title).toBe('The hypothesis as it stands');
    expect(raiz.querySelector('span')!.getAttribute('aria-label')).toBe('Confounding by systemic physiology');
    expect(raiz.querySelector('input')!.placeholder).toBe('Type a question');
    expect(raiz.querySelector('img')!.alt).toBe("The project's tree");
  });

  it('el texto de un <option> sí, pero su value no se toca', async () => {
    // Los desplegables salían enteros en castellano: `select` estaba en la
    // lista de lo que no se toca. Lo que se compara con el servidor es el
    // value, que no es texto que se lea.
    raiz.innerHTML = '<select><option value="h-7">La dosis de APOE modifica la brecha</option></select>';
    activar(raiz, falso({ 'La dosis de APOE modifica la brecha': 'APOE dose changes the gap' }));
    await espera();
    const o = raiz.querySelector('option')!;
    expect(o.textContent).toBe('APOE dose changes the gap');
    expect(o.value).toBe('h-7');
  });

  it('lo que la persona escribe no se le toca', async () => {
    // Un textarea guarda lo que hay dentro: traducírselo sería cambiarle lo
    // que va a guardar. El placeholder sí, que ese no se guarda.
    raiz.innerHTML = '<textarea placeholder="Escribe aquí">La respuesta que debe dar</textarea>';
    activar(raiz, falso({ 'La respuesta que debe dar': 'MAL', 'Escribe aquí': 'Type here' }));
    await espera();
    expect(raiz.querySelector('textarea')!.textContent).toBe('La respuesta que debe dar');
    expect(raiz.querySelector('textarea')!.placeholder).toBe('Type here');
  });

  it('[data-sin-traducir] también vale para los atributos', async () => {
    raiz.innerHTML = '<button data-sin-traducir aria-label="Español">ES</button>';
    const pedir = falso({ 'Español': 'Spanish' });
    activar(raiz, pedir);
    await espera();
    expect(raiz.querySelector('button')!.getAttribute('aria-label')).toBe('Español');
    expect(pedir).not.toHaveBeenCalled();
  });

  it('un atributo que aparece después también se traduce', async () => {
    raiz.innerHTML = '<div></div>';
    activar(raiz, falso({ 'Sin diana conocida': 'No known target' }));
    await espera();
    const b = document.createElement('button');
    b.title = 'Sin diana conocida';
    raiz.querySelector('div')!.append(b);
    await espera();
    expect(b.title).toBe('No known target');
  });

  it('al volver al castellano los atributos vuelven', async () => {
    raiz.innerHTML = '<button title="La hipótesis tal como está">x</button>';
    activar(raiz, falso({ 'La hipótesis tal como está': 'The hypothesis as it stands' }));
    await espera();
    expect(raiz.querySelector('button')!.title).toBe('The hypothesis as it stands');
    desactivar();
    expect(raiz.querySelector('button')!.title).toBe('La hipótesis tal como está');
  });
});

describe('lo que ya está en inglés no se paga', () => {
  it('un marcador de cita con «et al.» no se manda', () => {
    // «al» es palabra castellana, pero el «et al.» de una cita es latín. Sin
    // esto, Citas mandaba 169 frases inglesas al modelo en cada corrida.
    expect(pareceCastellano('[Dark et al., 2024, Results section]')).toBe(false);
    expect(pareceCastellano('[Pettigrew et al., 2025, abstract]')).toBe(false);
    expect(pareceCastellano('Pettigrew et al., 2025 · doi:10.1002/dad2.70081')).toBe(false);
    expect(pareceCastellano('Xie et al. describe GFAP abnormality preceding NfL')).toBe(false);
  });

  it('y el castellano de verdad sigue pasando', () => {
    expect(pareceCastellano('Valor pronóstico de la brecha GFAP–NfL')).toBe(true);
    expect(pareceCastellano('la cita no resuelve')).toBe(true);
    expect(pareceCastellano('Al mes 24 la cohorte sigue abierta')).toBe(true);
  });
});

describe('lo que se lee fuera del árbol', () => {
  it('traduce el título de la pestaña, que no está en el DOM', async () => {
    activar(raiz, falso({ 'GFAP y NfL en portadores de APOE4': 'GFAP and NfL in APOE4 carriers' }));
    let visto: string | null = null;
    traducirSuelto('GFAP y NfL en portadores de APOE4', (en) => { visto = en; });
    await espera();
    expect(visto).toBe('GFAP and NfL in APOE4 carriers');
  });

  it('si no se puede traducir, no llama y se queda el castellano', async () => {
    activar(raiz, falso({}));
    let visto: string | null = null;
    traducirSuelto('Una frase que el servidor no devuelve', (en) => { visto = en; });
    await espera();
    expect(visto).toBeNull();
  });

  it('apagado no pide nada', async () => {
    const pedir = falso({ 'Progresión en Alzheimer': 'Progression in Alzheimer' });
    let visto: string | null = null;
    traducirSuelto('Progresión en Alzheimer', (en) => { visto = en; });
    await espera();
    expect(pedir).not.toHaveBeenCalled();
    expect(visto).toBeNull();
  });
});

describe('lo corto que escribe ROSA2018', () => {
  it('detecta las duraciones y los sustantivos del dominio sin tilde', () => {
    // «1 hora» es la condición de parada de una investigación: la escribe
    // ROSA2018, no lleva tilde y ninguna palabra función, y se quedaba en
    // castellano (2 de octubre de 2026).
    expect(pareceCastellano('1 hora')).toBe(true);
    expect(pareceCastellano('72 horas')).toBe(true);
    expect(pareceCastellano('10 hipotesis sin revisar')).toBe(true);
    expect(pareceCastellano('3 corridas')).toBe(true);
    expect(pareceCastellano('2 citas')).toBe(true);
  });

  it('y no confunde el inglés que lleva esas letras', () => {
    expect(pareceCastellano('1 hour')).toBe(false);
    expect(pareceCastellano('Run 3 of the mission')).toBe(false);
    expect(pareceCastellano('No data available')).toBe(false);
  });
});
