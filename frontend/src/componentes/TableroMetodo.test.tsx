// @vitest-environment jsdom
// El tablero del método montado de verdad: sin tablero (antes de la primera
// iteración), con avisos (que van primero), con un indicador roto y con todo
// en orden. Mismo patrón que MapaEnfermedad.test.tsx.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IndicadorMetodo, TableroMetodo as Tablero } from '../datos/tipos';
import { TableroMetodo } from './TableroMetodo';

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  root = createRoot(nodo);
});
afterEach(() => {
  act(() => root.unmount());
  nodo.remove();
});

function pintar(t: Tablero | null) {
  act(() => root.render(<TableroMetodo tablero={t} />));
}

const ind = (clave: string, estado: IndicadorMetodo['estado'], extra: Partial<IndicadorMetodo> = {}): IndicadorMetodo => ({
  clave,
  titulo: `Indicador ${clave}`,
  estado,
  cifra: `cifra de ${clave}`,
  texto: `texto de ${clave}`,
  fase: 'cribado',
  queHariaFalta: `lo que haría falta para ${clave}`,
  datos: {},
  ...extra,
});

describe('TableroMetodo', () => {
  it('sin tablero explica qué se calculará y que no gasta llamadas', () => {
    pintar(null);
    expect(nodo.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(nodo.textContent).toContain('sin gastar ninguna llamada');
  });

  it('los avisos van primero, con lo que haría falta; los demás no lo enseñan', () => {
    pintar({ fecha: 1, iteracion: 7, corridaId: 'c1', avisos: ['balanza'], indicadores: [ind('tiempo', 'bien'), ind('conectores', 'sin_datos'), ind('balanza', 'aviso', { titulo: 'Lo que apoya frente a lo que contradice', cifra: '117 a favor, 1 en contra' })] });
    const filas = [...nodo.querySelectorAll('.metodo-fila')];
    expect(filas).toHaveLength(3);
    expect(filas[0]!.className).toContain('metodo-aviso');
    expect(filas[0]!.textContent).toContain('117 a favor, 1 en contra');
    expect(filas[0]!.textContent).toContain('Haría falta');
    expect(filas[1]!.textContent).not.toContain('Haría falta');
    expect(nodo.textContent).toContain('1 aviso de 3 indicadores, calculado al cerrar la iteración 7.');
    expect(nodo.textContent).toContain('Fase: cribado');
  });

  it('sin avisos lo dice así', () => {
    pintar({ fecha: 1, iteracion: null, corridaId: null, avisos: [], indicadores: [ind('tiempo', 'bien'), ind('balanza', 'bien')] });
    expect(nodo.textContent).toContain('Ningún aviso de 2 indicadores, calculado con lo que había al arrancar ROSA2018');
  });

  it('un indicador roto o un tablero raro no tumban la tarjeta', () => {
    pintar({ fecha: 1, iteracion: 2, corridaId: null, avisos: [], indicadores: [null, 'basura', { clave: 'x' }, ind('tiempo', 'bien')] as unknown as IndicadorMetodo[] });
    expect(nodo.querySelectorAll('.metodo-fila')).toHaveLength(1);
    pintar({ fecha: 1, iteracion: 2, corridaId: null, avisos: [], indicadores: 'no es una lista' } as unknown as Tablero);
    expect(nodo.textContent).toContain('Se calcula al cerrar la primera iteración');
  });
});
