// @vitest-environment jsdom
// La pantalla de mecanismos: que la cascada salga del grafo y no de una tabla
// escrita aparte, que el veredicto que se enseña sea el que calculó el
// servidor, que encender un supuesto que falta se vea como una pregunta y no
// como un resultado, y que cuando no hay ninguna arista sostenida por
// evidencia propia se diga en vez de esconderlo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import { Mecanismos } from './Mecanismos';

const INV = { id: 'inv-1', titulo: 'Una investigación' } as unknown as Investigacion;

type Nodo = { id: string; etiqueta: string; rol: string; capa?: string };
type Arista = { de: string; a: string; tipo: string; contexto: string };

function hip(
  id: string,
  opciones: {
    titulo?: string;
    nodos?: Nodo[];
    aristas?: Arista[];
    identificacion?: string;
    cumplidos?: string[];
    faltantes?: string[];
  } = {},
): Hipotesis {
  return {
    id,
    investigacionId: 'inv-1',
    titulo: opciones.titulo ?? `Hipótesis ${id}`,
    grafoCausal: {
      nodos: opciones.nodos ?? [],
      aristas: opciones.aristas ?? [],
      identificacion: opciones.identificacion ?? 'acotado',
      supuestosCumplidos: opciones.cumplidos ?? [],
      supuestosFaltantes: opciones.faltantes ?? [],
      resumen: '',
      calculadoEn: 0,
    },
  } as unknown as Hipotesis;
}

const CASCADA: Nodo[] = [
  { id: 'B:APOE4', etiqueta: 'APOE4', rol: 'base', capa: 'factores' },
  { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
  { id: 'B:GFAP', etiqueta: 'GFAP', rol: 'base', capa: 'marcadores' },
  { id: 'B:cognicion', etiqueta: 'cognición', rol: 'base', capa: 'desenlace' },
];

function estadoCon(hipotesis: Hipotesis[]): EstadoRosa {
  return { hipotesis, conexion: { estado: 'conectado' } } as unknown as EstadoRosa;
}

let nodo: HTMLDivElement;
let raiz: Root;

async function montar(estado: EstadoRosa) {
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  raiz = createRoot(nodo);
  await act(async () => {
    raiz.render(<Mecanismos inv={INV} estado={estado} />);
  });
}

beforeEach(() => {
  nodo = document.createElement('div');
});
afterEach(async () => {
  await act(async () => raiz?.unmount());
  nodo.remove();
});

describe('la pantalla de mecanismos', () => {
  it('pinta la cascada a partir de los grafos, con en cuántas entra cada nodo', async () => {
    await montar(
      estadoCon([
        hip('h1', { nodos: CASCADA }),
        hip('h2', { nodos: CASCADA.slice(0, 2) }),
      ]),
    );
    const cajas = [...nodo.querySelectorAll('.mec-nodo')].map((n) => n.textContent);
    expect(cajas).toHaveLength(4);
    expect(cajas[0]).toContain('APOE4');
    expect(cajas[0]).toContain('en 2 de 2');
    // GFAP solo está en un grafo de los dos.
    expect(cajas.find((c) => c?.includes('GFAP'))).toContain('en 1 de 2');
  });

  it('las columnas van en el orden en que ocurre la enfermedad', async () => {
    await montar(estadoCon([hip('h1', { nodos: CASCADA })]));
    const titulos = [...nodo.querySelectorAll('.mec-col')].map((c) => c.textContent);
    expect(titulos).toEqual(['FACTORES', 'PATOLOGÍA', 'MARCADORES', 'DESENLACE']);
  });

  it('enseña el veredicto que calculó el servidor, no uno propio', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: CASCADA,
          identificacion: 'identificable',
          cumplidos: ['Temporalidad: hay evidencia longitudinal', 'Ajuste por confusores: declara ajuste'],
        }),
      ]),
    );
    expect(nodo.querySelector('.mec-veredicto .mec-t')?.textContent).toBe('Efecto identificable');
    expect(nodo.querySelector('.mec-veredicto')?.className).toContain('identificable');
  });

  it('encender un supuesto que falta cambia el veredicto y avisa de que es una pregunta', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: CASCADA,
          identificacion: 'acotado',
          cumplidos: ['Temporalidad: hay evidencia longitudinal'],
          faltantes: ['Ajuste por confusores: la evidencia no declara ajuste'],
        }),
      ]),
    );
    expect(nodo.querySelector('.mec-veredicto .mec-t')?.textContent).toBe('Efecto acotado');
    expect(nodo.querySelector('.mec-d-nota')).toBe(null);

    const interruptor = nodo.querySelector<HTMLButtonElement>('button.mec-caja')!;
    await act(async () => {
      interruptor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(nodo.querySelector('.mec-veredicto .mec-t')?.textContent).toBe('Efecto identificable');
    // Y se dice que lo guardado sigue siendo lo otro: es una pregunta, no un dato.
    const nota = nodo.querySelector('.mec-d-nota')?.textContent ?? '';
    expect(nota).toContain('pregunta');
    expect(nota).toContain('acotado');
  });

  it('dice que ninguna arista está sostenida por evidencia propia cuando es así', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: CASCADA,
          aristas: [
            { de: 'X', a: 'Y', tipo: 'supuesto', contexto: '' },
            { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: '' },
          ],
        }),
      ]),
    );
    const aviso = nodo.querySelector('.mec-aviso')?.textContent ?? '';
    expect(aviso).toContain('Ninguna arista está sostenida por evidencia propia');
    expect(aviso).toContain('2 del grafo');
    expect(nodo.querySelector('.mec-cero')?.textContent).toContain('0 en esta corrida');
  });

  it('con una arista sostenida por evidencia, el aviso desaparece', async () => {
    await montar(
      estadoCon([
        hip('h1', { nodos: CASCADA, aristas: [{ de: 'X', a: 'Y', tipo: 'inferencia_con_evidencia', contexto: '' }] }),
      ]),
    );
    expect(nodo.querySelector('.mec-aviso')).toBe(null);
    expect(nodo.querySelector('.mec-cero')).toBe(null);
  });

  it('enseña las amenazas con su clase en llano y se pueden apagar', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: [
            ...CASCADA,
            { id: 'A1', etiqueta: 'la edad sube el GFAP sin enfermedad', rol: 'alternativa_confusor' },
            { id: 'A2', etiqueta: 'deriva de lote entre plataformas', rol: 'alternativa_artefacto' },
          ],
        }),
      ]),
    );
    expect(nodo.querySelectorAll('.mec-amenaza')).toHaveLength(2);
    expect(nodo.textContent).toContain('Confusor');
    expect(nodo.textContent).toContain('Artefacto de medida');

    const chip = [...nodo.querySelectorAll<HTMLButtonElement>('.mec-chip')].find((b) => b.textContent?.startsWith('Amenazas'))!;
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(nodo.querySelectorAll('.mec-amenaza')).toHaveLength(0);
  });

  it('sin ninguna hipótesis con grafo lo dice, en vez de pintar un lienzo vacío', async () => {
    await montar(estadoCon([]));
    expect(nodo.textContent).toContain('Todavía no hay ninguna hipótesis con grafo causal');
    expect(nodo.querySelector('.mec-lienzo')).toBe(null);
  });

  it('el reparto de supuestos cuenta las hipótesis, no las veces que aparece el texto', async () => {
    await montar(
      estadoCon([
        hip('h1', { nodos: CASCADA, cumplidos: ['Temporalidad: sí'], faltantes: ['Ajuste por confusores: no'] }),
        hip('h2', { nodos: CASCADA, cumplidos: ['Temporalidad: sí'], faltantes: ['Ajuste por confusores: no'] }),
        hip('h3', { nodos: CASCADA, cumplidos: ['Temporalidad: sí', 'Ajuste por confusores: sí'] }),
      ]),
    );
    const filas = [...nodo.querySelectorAll('.mec-falta li')].map((li) => li.textContent?.replace(/\s+/g, ' '));
    expect(filas[0]).toContain('Ajuste por confusores');
    expect(filas[0]).toContain('1 cumplen');
    expect(filas[0]).toContain('2 faltan');
    expect(filas[1]).toContain('Temporalidad');
    expect(filas[1]).toContain('3 cumplen');
  });
});

describe('cuando una hipótesis no tiene amenazas', () => {
  it('lo dice, y aclara que no significa que esté limpia', async () => {
    // El 22 de septiembre de 2026 una hipótesis se recalculó con cero
    // alternativas y las cajas rojas desaparecieron sin explicación.
    await montar(estadoCon([hip('h1', { nodos: CASCADA })]));
    expect(nodo.querySelectorAll('.mec-amenaza')).toHaveLength(0);
    const aviso = nodo.querySelector('.mec-sin-amenazas')?.textContent ?? '';
    expect(aviso).toContain('no tiene ninguna explicación alternativa');
    expect(aviso).toContain('No quiere decir que esté limpia');
  });

  it('con amenazas no sale ese aviso', async () => {
    await montar(
      estadoCon([
        hip('h1', { nodos: [...CASCADA, { id: 'A1', etiqueta: 'la edad', rol: 'alternativa_confusor' }] }),
      ]),
    );
    expect(nodo.querySelector('.mec-sin-amenazas')).toBe(null);
  });
});

describe('señalar un nodo enseña con qué está conectado', () => {
  const CADENA: Nodo[] = [
    { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
    { id: 'B:tau', etiqueta: 'tau', rol: 'base', capa: 'patologia' },
    { id: 'B:GFAP', etiqueta: 'GFAP', rol: 'base', capa: 'marcadores' },
    { id: 'B:NfL', etiqueta: 'NfL', rol: 'base', capa: 'marcadores' },
  ];
  const ARISTAS = [
    { de: 'B:amiloide', a: 'B:tau', tipo: 'base_curada', contexto: 'precede a tau' },
    { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: 'sube el GFAP' },
  ];

  it('enciende sus flechas y sus vecinos, y apaga lo demás', async () => {
    await montar(estadoCon([hip('h1', { nodos: CADENA, aristas: ARISTAS })]));
    const amiloide = [...nodo.querySelectorAll<HTMLElement>('.mec-nodo')].find((n) => n.textContent?.includes('amiloide'))!;
    await act(async () => {
      amiloide.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      amiloide.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    expect(nodo.querySelectorAll('.mec-nodo.mec-senalado')).toHaveLength(1);
    // tau y GFAP son vecinos; NfL no.
    const vecinos = [...nodo.querySelectorAll('.mec-nodo.mec-vecino')].map((n) => n.textContent);
    expect(vecinos.join(' ')).toContain('tau');
    expect(vecinos.join(' ')).toContain('GFAP');
    const apagados = [...nodo.querySelectorAll('.mec-nodo.mec-apagado')].map((n) => n.textContent);
    expect(apagados.join(' ')).toContain('NfL');
    // Las dos flechas de amiloide encendidas.
    expect(nodo.querySelectorAll('path.mec-consenso.mec-encendida')).toHaveLength(2);
  });

  it('al quitar el ratón vuelve todo a su sitio', async () => {
    await montar(estadoCon([hip('h1', { nodos: CADENA, aristas: ARISTAS })]));
    const amiloide = [...nodo.querySelectorAll<HTMLElement>('.mec-nodo')].find((n) => n.textContent?.includes('amiloide'))!;
    await act(async () => amiloide.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })));
    await act(async () => amiloide.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })));
    expect(nodo.querySelectorAll('.mec-nodo.mec-apagado')).toHaveLength(0);
    expect(nodo.querySelectorAll('path.mec-consenso.mec-encendida')).toHaveLength(0);
  });
});

describe('la hipótesis está en el mapa', () => {
  it('dibuja lo que mueve y dónde lo lee, para que las amenazas tengan a qué apuntar', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: [
            ...CASCADA,
            { id: 'X', etiqueta: 'dosis de APOE e4', rol: 'exposicion' },
            { id: 'Y', etiqueta: 'brecha GFAP-NfL a 24 meses', rol: 'desenlace' },
            { id: 'A1', etiqueta: 'la edad mueve las dos', rol: 'alternativa_confusor' },
          ],
          aristas: [
            { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: '' },
            { de: 'X', a: 'Y', tipo: 'supuesto', contexto: '' },
          ],
        }),
      ]),
    );
    const actores = [...nodo.querySelectorAll('.mec-actor')].map((n) => n.textContent);
    expect(actores).toHaveLength(2);
    expect(actores[0]).toContain('dosis de APOE e4');
    expect(actores[1]).toContain('brecha GFAP-NfL');
    // La amenaza ataca a Y, así que sale UNA flecha roja, no una inventada.
    expect(nodo.querySelectorAll('path.mec-amenaza-linea')).toHaveLength(1);
  });

  it('una amenaza que ataca a los dos dibuja dos flechas', async () => {
    await montar(
      estadoCon([
        hip('h1', {
          nodos: [
            ...CASCADA,
            { id: 'X', etiqueta: 'la exposición', rol: 'exposicion' },
            { id: 'Y', etiqueta: 'el desenlace', rol: 'desenlace' },
            { id: 'A1', etiqueta: 'causa común', rol: 'alternativa_confusor' },
          ],
          aristas: [
            { de: 'A1', a: 'X', tipo: 'supuesto', contexto: '' },
            { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: '' },
          ],
        }),
      ]),
    );
    expect(nodo.querySelectorAll('path.mec-amenaza-linea')).toHaveLength(2);
  });
});
