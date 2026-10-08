// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { Iteracion } from '../datos/tipos';
import { busquedasDe } from '../lib/escenario';
import { fijarIdioma } from '../lib/idioma';
import { resumenResultadosConsulta } from '../lib/evidencia';
import { BusquedasDeLaIteracion } from './PanelesCorrida';

afterEach(() => fijarIdioma('es'));

it.each(['es', 'en'] as const)('muestra parcial y candidatos sin convertir null en cero (%s)', async idioma => {
  fijarIdioma(idioma);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const consulta = { base: 'Embase', consulta: 'APOE', resultados: null, recuperados: 3, estado: 'parcial' as const, limitaciones: ['Cobertura limitada'], fecha: 1, iteracion: 1 };
  const it = { id: 'it', numero: 1, empezadaEn: 1, terminadaEn: null, pistas: [] } as unknown as Iteracion;
  const nodo = document.createElement('div');
  const root = createRoot(nodo);
  try {
    await act(async () => root.render(<BusquedasDeLaIteracion busquedas={busquedasDe(it, [consulta])} consultas={1} />));
    const fila = nodo.querySelector('.esc-fila')!;
    expect(fila.querySelector('.esc-fila-cifras b')?.textContent).toBe('?');
    expect(fila.textContent).toContain(idioma === 'en' ? 'Partial' : 'Parcial');
    expect(fila.textContent).toContain(idioma === 'en' ? '3 candidates retrieved' : '3 candidatos recuperados');
    expect(fila.textContent).toContain('Cobertura limitada');
    expect(fila.textContent).not.toContain('no pude comprobar');
    expect(resumenResultadosConsulta(consulta)).toBe(idioma === 'en' ? 'Total not verified · 3 candidates retrieved' : 'Total no comprobado · 3 candidatos recuperados');
  } finally {
    await act(async () => root.unmount());
  }
});
