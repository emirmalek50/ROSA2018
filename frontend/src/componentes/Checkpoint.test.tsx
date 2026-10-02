// @vitest-environment jsdom
// La marca de lo que ROSA2018 se guarda de ti. Dos reglas, y las dos son del
// proyecto: lo guarda una PERSONA (ROSA2018 no se apunta nada sola) y se
// puede quitar. Una memoria que no se puede quitar no es una preferencia.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Checkpoint, GuardarEnMemoria } from './Checkpoint';

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
const pulsar = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const AHORA = Date.UTC(2026, 9, 2, 12, 0, 0);
const MEM = { id: 'mem-1', texto: 'Me llamo Emir y prefiero respuestas en llano', quien: 'la persona responsable', fecha: AHORA - 3600_000 };

describe('la marca de lo que ROSA2018 recuerda', () => {
  it('dice qué se guardó y cuándo', async () => {
    await pintar(<Checkpoint m={MEM} ahora={AHORA} />);
    expect(nodo.textContent).toContain('ROSA2018 se guardó esto');
    expect(nodo.textContent).toContain('Me llamo Emir');
  });

  it('se puede quitar, y sin botón no se pinta uno falso', async () => {
    const quitar = vi.fn();
    await pintar(<Checkpoint m={MEM} ahora={AHORA} alQuitar={quitar} />);
    const b = nodo.querySelector('button.hito-quitar')!;
    expect(b).not.toBeNull();
    await pulsar(b);
    expect(quitar).toHaveBeenCalledTimes(1);

    await pintar(<Checkpoint m={MEM} ahora={AHORA} />);
    expect(nodo.querySelector('button.hito-quitar')).toBeNull();
  });
});

describe('guardar algo en la memoria', () => {
  it('no guarda al pulsar: propone el texto y lo decides tú', async () => {
    // Es la misma regla que con las hipótesis: ROSA2018 propone, decide una
    // persona. Un clic no puede escribir en la memoria del proyecto.
    const guardar = vi.fn();
    await pintar(<GuardarEnMemoria propuesta="qué sabes de p-tau217" alGuardar={guardar} />);
    await pulsar(nodo.querySelector('button')!);
    expect(guardar).not.toHaveBeenCalled();
    const t = nodo.querySelector('textarea') as HTMLTextAreaElement;
    expect(t.value).toBe('qué sabes de p-tau217');

    const enviar = [...nodo.querySelectorAll('button')].find((b) => /Guardar/.test(b.textContent ?? ''))!;
    await pulsar(enviar);
    expect(guardar).toHaveBeenCalledWith('qué sabes de p-tau217');
  });

  it('no deja guardar algo vacío', async () => {
    const guardar = vi.fn();
    await pintar(<GuardarEnMemoria propuesta="   " alGuardar={guardar} />);
    await pulsar(nodo.querySelector('button')!);
    const enviar = [...nodo.querySelectorAll('button')].find((b) => /Guardar/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
  });

  it('cancelar cierra sin guardar', async () => {
    const guardar = vi.fn();
    await pintar(<GuardarEnMemoria propuesta="algo" alGuardar={guardar} />);
    await pulsar(nodo.querySelector('button')!);
    const cancelar = [...nodo.querySelectorAll('button')].find((b) => /Cancelar/.test(b.textContent ?? ''))!;
    await pulsar(cancelar);
    expect(guardar).not.toHaveBeenCalled();
    expect(nodo.querySelector('textarea')).toBeNull();
  });
});
