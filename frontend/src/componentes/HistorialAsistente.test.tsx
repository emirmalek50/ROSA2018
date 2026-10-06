// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HistorialAsistente } from './HistorialAsistente';
import type { PreguntaABases } from '../datos/tipos';
import { fijarIdioma } from '../lib/idioma';

it('la fecha sigue el idioma elegido y conserva el hilo al volver a español', async () => {
  const nodo = document.createElement('div'), root = createRoot(nodo), elegir = vi.fn();
  const fecha = new Date(2026, 0, 26).getTime();
  const preguntas = [pregunta('turno', 'h-mapt', 'MAPT', fecha)];
  try {
    fijarIdioma('en');
    await act(async () => root.render(<HistorialAsistente preguntas={preguntas} hilo={null} alElegir={elegir} />));
    await act(async () => nodo.querySelector('button')!.click());
    expect(nodo.querySelector('li')?.textContent).toContain('1/26/2026');
    fijarIdioma('es');
    await act(async () => root.render(<HistorialAsistente preguntas={preguntas} hilo={null} alElegir={elegir} />));
    expect(nodo.querySelector('li')?.textContent).toContain('26/1/2026');
    await act(async () => nodo.querySelector<HTMLButtonElement>('li button')!.click());
    expect(elegir).toHaveBeenCalledWith('h-mapt');
  } finally { fijarIdioma('es'); await act(async () => root.unmount()); }
});

const pregunta = (id: string, hilo: string | undefined, texto: string, fecha: number): PreguntaABases => ({ id, hilo, pregunta: texto, respuesta: 'Respuesta sobre MAPT', fecha, limites: '', herramientas: [], consultas: [], iteraciones: 1, quien: 'persona', error: null });
it('recupera hilos persistidos sin sessionStorage, agrupa turnos y busca también respuestas', async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const elegir = vi.fn();
  const preguntas = [pregunta('vieja', undefined, 'Primera pregunta', 1), pregunta('a', 'h2', 'Objetivo completo', 2), pregunta('b', 'h2', 'Continuación', 3)];
  await act(async () => root.render(<HistorialAsistente preguntas={preguntas} hilo={null} alElegir={elegir} />));
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
  expect(elegir).toHaveBeenCalledWith('vieja');
  expect(nodo.querySelector('section')).toBeNull();
  await act(async () => root.unmount());
});
it('permite llegar a conversaciones más allá de la primera página', async () => {
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  const preguntas = Array.from({ length: 40 }, (_, n) => pregunta(String(n), `h${n}`, `Tema ${n}`, n));
  await act(async () => root.render(<HistorialAsistente preguntas={preguntas} hilo={null} alElegir={() => {}} />));
  await act(async () => nodo.querySelector('button')!.click());
  expect(nodo.querySelectorAll('li')).toHaveLength(30);
  const mas = [...nodo.querySelectorAll('button')].find(b => b.textContent === 'Ver más conversaciones')!;
  await act(async () => mas.click());
  expect(nodo.querySelectorAll('li')).toHaveLength(40);
  await act(async () => root.unmount());
});
