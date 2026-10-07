// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';
import { HistorialAsistente } from './HistorialAsistente';
import type { PreguntaHistorial } from '../lib/conversacionesAsistente';
import { fijarIdioma } from '../lib/idioma';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

it('la fecha sigue el idioma elegido y conserva el hilo al volver a español', async () => {
  const nodo = document.createElement('div'), root = createRoot(nodo), elegir = vi.fn();
  const fecha = new Date(2026, 0, 26).getTime();
  const preguntas = [pregunta('turno', 'h-mapt', 'MAPT', fecha)];
  try {
    fijarIdioma('en');
    await act(async () => root.render(<HistorialAsistente preguntas={preguntas} conversacion={null} alElegir={elegir} />));
    await act(async () => nodo.querySelector('button')!.click());
    expect(nodo.querySelector('li')?.textContent).toContain('1/26/2026');
    fijarIdioma('es');
    await act(async () => root.render(<HistorialAsistente preguntas={preguntas} conversacion={null} alElegir={elegir} />));
    expect(nodo.querySelector('li')?.textContent).toContain('26/1/2026');
    await act(async () => nodo.querySelector<HTMLButtonElement>('li button')!.click());
    expect(elegir).toHaveBeenCalledWith({ investigacionId: 'global', hilo: 'h-mapt' });
  } finally { fijarIdioma('es'); await act(async () => root.unmount()); }
});

const pregunta = (id: string, hilo: string | undefined, texto: string, fecha: number): PreguntaHistorial => ({ investigacionId: 'global', id, hilo, pregunta: texto, respuesta: 'Respuesta sobre MAPT', fecha, limites: '', herramientas: [], consultas: [], iteraciones: 1, quien: 'persona', error: null });
it('recupera hilos persistidos sin sessionStorage, agrupa turnos y busca también respuestas', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const elegir = vi.fn();
  const preguntas = [pregunta('vieja', undefined, 'Primera pregunta', 1), pregunta('a', 'h2', 'Objetivo completo', 2), pregunta('b', 'h2', 'Continuación', 3)];
  await act(async () => root.render(<HistorialAsistente preguntas={preguntas} conversacion={null} alElegir={elegir} />));
  await act(async () => nodo.querySelector('button')!.click());
  expect(nodo.querySelectorAll('li')).toHaveLength(2);
  expect(nodo.querySelector('li')!.textContent).toContain('Objetivo completo');
  expect(nodo.querySelector('li')!.textContent).toContain('2 mensajes');
  const input = nodo.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Primera');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(nodo.querySelectorAll('li')).toHaveLength(1);
  await act(async () => nodo.querySelector<HTMLButtonElement>('li button')!.click());
  expect(elegir).toHaveBeenCalledWith({ investigacionId: 'global', hilo: 'vieja' });
  expect(nodo.querySelector('section')).toBeNull();
  await act(async () => root.unmount());
});
it('permite llegar a conversaciones más allá de la primera página', async () => {
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const preguntas = Array.from({ length: 40 }, (_, n) => pregunta(String(n), `h${n}`, `Tema ${n}`, n));
  await act(async () => root.render(<HistorialAsistente preguntas={preguntas} conversacion={null} alElegir={() => {}} />));
  await act(async () => nodo.querySelector('button')!.click());
  expect(nodo.querySelectorAll('li')).toHaveLength(30);
  const mas = [...nodo.querySelectorAll('button')].find(b => b.textContent === 'Ver más conversaciones')!;
  await act(async () => mas.click());
  expect(nodo.querySelectorAll('li')).toHaveLength(40);
  await act(async () => root.unmount());
});

it('no mezcla hilos con el mismo identificador de investigaciones distintas', async () => {
  const nodo = document.createElement('div'), root = createRoot(nodo), elegir = vi.fn();
  const preguntas = [
    { ...pregunta('a', 'h-comun', 'Consulta de MAPT', 1), investigacionId: 'inv-a' },
    { ...pregunta('b', 'h-comun', 'Consulta de GFAP', 2), investigacionId: 'inv-b' },
    { ...pregunta('c', 'h-comun', 'Sigue con MAPT', 3), investigacionId: 'inv-a' },
  ];
  try {
    await act(async () => root.render(<HistorialAsistente preguntas={preguntas} conversacion={{ investigacionId: 'inv-b', hilo: 'h-comun' }} alElegir={elegir} />));
    await act(async () => nodo.querySelector('button')!.click());
    const botones = [...nodo.querySelectorAll<HTMLButtonElement>('li button')];
    expect(botones).toHaveLength(2);
    expect(botones[0]?.textContent).toContain('Consulta de MAPT');
    expect(botones[0]?.textContent).toContain('2 mensajes');
    expect(botones[0]?.getAttribute('aria-current')).toBeNull();
    expect(botones[1]?.getAttribute('aria-current')).toBe('true');
    await act(async () => botones[1]!.click());
    expect(elegir).toHaveBeenCalledWith({ investigacionId: 'inv-b', hilo: 'h-comun' });
  } finally { await act(async () => root.unmount()); }
});
