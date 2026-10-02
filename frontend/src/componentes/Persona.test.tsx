// @vitest-environment jsdom
// La cara de ROSA2018. Lo que importa no es que se mueva bonito, sino que
// quien mira sepa en que esta sin leer nada, y que quien no puede ver el
// movimiento lo sepa igual: de ahi el aria-label por estado.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Persona, type EstadoPersona } from './Persona';

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

const pintar = (ui: React.ReactElement) => act(async () => root.render(ui));

describe('la cara de ROSA2018', () => {
  it('cada estado se dice con palabras, no solo con el movimiento', async () => {
    const dice: Record<EstadoPersona, RegExp> = {
      quieta: /lista/i,
      escuchando: /escuchando/i,
      pensando: /pensando/i,
      hablando: /respondiendo/i,
      dormida: /reposo/i,
    };
    for (const [e, r] of Object.entries(dice) as [EstadoPersona, RegExp][]) {
      await pintar(<Persona estado={e} />);
      const el = nodo.querySelector('.persona')!;
      expect(el.getAttribute('role')).toBe('img');
      expect(el.getAttribute('aria-label'), e).toMatch(r);
      expect(el.className).toContain(`persona-${e}`);
    }
  });

  it('el halo solo sale cuando hay alguien al otro lado', async () => {
    // Escuchar y hablar llevan halo; pensar no, para no confundir «te
    // atiende» con «esta ocupada».
    for (const e of ['escuchando', 'hablando'] as const) {
      await pintar(<Persona estado={e} />);
      expect(nodo.querySelector('.persona-halo'), e).not.toBeNull();
    }
    for (const e of ['quieta', 'pensando', 'dormida'] as const) {
      await pintar(<Persona estado={e} />);
      expect(nodo.querySelector('.persona-halo'), e).toBeNull();
    }
  });

  it('el tamaño se respeta y el SVG no trae texto que traducir', async () => {
    await pintar(<Persona estado="quieta" tamano={72} />);
    const el = nodo.querySelector('.persona') as HTMLElement;
    expect(el.style.width).toBe('72px');
    expect(nodo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(nodo.querySelector('svg')?.textContent).toBe('');
  });
});
