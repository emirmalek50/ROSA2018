// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

it('una carga inicial en inglés no congela etiquetas ni ayuda al volver a español', async () => {
  vi.resetModules();
  const { fijarIdioma } = await import('../lib/idioma');
  fijarIdioma('en');
  const { VEREDICTO } = await import('../lib/etiquetas');
  const { DEFINICIONES_PASO } = await import('../componentes/MapaRuta');
  const { ESTADO_COBERTURA } = await import('../lib/mundo');
  const { valorLegible, resumenDiff } = await import('../lib/registro');
  const { EsqueletoAtlas } = await import('../pantallas/Atlas');
  const nodo = document.createElement('div'), root = createRoot(nodo);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<EsqueletoAtlas />));
    expect(nodo.textContent).toContain('sagittal');
    expect(DEFINICIONES_PASO.mecanismo).toContain('biological process');
    expect(valorLegible('tarjeta.pasoRuta', 'compromiso_diana')).toBe('Target engagement');
    fijarIdioma('es');
    await act(async () => root.render(<EsqueletoAtlas />));
    expect(nodo.textContent).toContain('un corte sagital');
    expect(nodo.textContent).not.toContain('sagittal');
    expect(DEFINICIONES_PASO.mecanismo).toContain('proceso biológico');
    expect(VEREDICTO.no_sostenida.etiqueta).toBe('No sostenida');
    expect(ESTADO_COBERTURA.respondido).toBe('Respondido con lo consultado');
    expect(valorLegible('tarjeta.pasoRuta', 'compromiso_diana')).toBe('Compromiso de diana');
    expect(resumenDiff([])).toBe('Sin cambios en los campos de la hipótesis');
  } finally {
    fijarIdioma('es'); await act(async () => root.unmount());
  }
});
