// @vitest-environment jsdom
// La tabla del mapa de la ruta montada de verdad: sin mapa (registro antiguo),
// con filas (hipótesis enlazadas, celdas con certeza, huecos en gris), y con
// un mapa roto (filas con pasos incompletos, hipótesis que no son texto,
// celdas en null). Mismo patrón que FranjaRanking.test.tsx: createRoot y act.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, MapaRuta as Mapa } from '../datos/tipos';
import { DEFINICIONES_PASO, MapaRuta, PASOS_RUTA } from './MapaRuta';
import { fijarIdioma } from '../lib/idioma';

const SIN_TILDE = /\b(hipotesis|iteracion|todavia|Todavia|Iteracion|replicacion|poblacion|intervencion|exposicion|raton|maxima|mecanismo biologico)\b/;

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  fijarIdioma('es');
});

const titulos = () => [...nodo.querySelectorAll('[title]')].map((c) => c.getAttribute('title') ?? '');
const todoElTexto = () => [nodo.textContent ?? '', ...titulos()].join('\n');

const vacia = { hipotesis: 0, parciales: 0, hechos: 0, certezaMax: null } as const;

function mapa(): Mapa {
  return {
    investigacionId: 'inv-1',
    resumen: 'Dos dianas con hipótesis vivas. GFAP tiene el mecanismo cubierto por 2 hipótesis y la replicación a medias; ninguna llega al efecto funcional.',
    fecha: 5,
    iteracion: 3,
    filas: [
      {
        clave: 'GFAP',
        etiqueta: 'GFAP',
        hipotesis: ['hip-1', 'hip-2'],
        hechos: 4,
        huecos: ['efecto_funcional', 'selectividad_toxicidad', 'exposicion', 'evidencia_poblacion'],
        pasos: {
          mecanismo: { hipotesis: 2, parciales: 0, hechos: 3, certezaMax: 'baja' },
          opciones_intervencion: { hipotesis: 1, parciales: 1, hechos: 0, certezaMax: 'muy_baja' },
          compromiso_diana: { hipotesis: 0, parciales: 1, hechos: 1, certezaMax: null },
          efecto_funcional: { ...vacia },
          selectividad_toxicidad: { ...vacia },
          exposicion: { ...vacia, hechos: 2 },
          replicacion_independiente: { hipotesis: 1, parciales: 0, hechos: 0, certezaMax: 'moderada' },
          evidencia_poblacion: { ...vacia },
        },
      },
      {
        clave: 'TREM2',
        etiqueta: 'TREM2 (microglía)',
        hipotesis: ['hip-3'],
        hechos: 0,
        huecos: [...PASOS_RUTA].filter((p) => p !== 'mecanismo'),
        pasos: Object.fromEntries(PASOS_RUTA.map((p) => [p, p === 'mecanismo' ? { hipotesis: 1, parciales: 0, hechos: 0, certezaMax: 'alta' } : { ...vacia }])) as Mapa['filas'][number]['pasos'],
      },
    ],
  };
}

describe('MapaRuta', () => {
  it('traduce la etiqueta sin diana del servidor también en los tooltips y conserva las claves', async () => {
    const m = mapa();
    m.filas[0]!.etiqueta = 'sin diana';
    const original = JSON.stringify(m);
    fijarIdioma('en');
    await act(async () => root.render(<MapaRuta mapa={m} />));
    expect(nodo.querySelector('tbody strong')?.textContent).toBe('no target');
    expect(titulos().join('\n')).toContain('no target');
    expect(todoElTexto()).not.toContain('sin diana');
    expect(JSON.stringify(m)).toBe(original);
    fijarIdioma('es');
    await act(async () => root.render(<MapaRuta mapa={m} />));
    expect(nodo.querySelector('tbody strong')?.textContent).toBe('sin diana');
  });
  it('sin mapa dice cuándo se calcula', async () => {
    await act(async () => root.render(<MapaRuta mapa={null} />));
    expect(nodo.textContent).toContain('Mapa de la ruta terapéutica');
    expect(nodo.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(nodo.querySelector('table')).toBeNull();
    await act(async () => root.render(<MapaRuta mapa={undefined} />));
    expect(nodo.textContent).toContain('Se calcula al cerrar la primera iteración');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('con mapa pero sin filas muestra el resumen del servidor y dice que no hay dianas', async () => {
    await act(async () => root.render(<MapaRuta mapa={{ investigacionId: 'inv-1', filas: [], resumen: 'Sin hipótesis vivas en esta investigación: no hay ruta que mapear.' }} />));
    expect(nodo.textContent).toContain('Sin hipótesis vivas en esta investigación');
    expect(nodo.textContent).toContain('Sin dianas que mapear');
    expect(nodo.textContent).toContain('Calculado a demanda');
    expect(nodo.querySelector('table')).toBeNull();
  });

  it('con filas pinta el resumen encima, ocho columnas con definición, celdas con certeza y huecos en gris', async () => {
    const estado = estadoDeMuestra();
    await act(async () => root.render(<MapaRuta mapa={mapa()} estado={estado} />));
    const texto = nodo.textContent ?? '';
    expect(texto.indexOf('Dos dianas con hipótesis vivas')).toBeLessThan(texto.indexOf('Diana o proceso'));
    expect(texto).toContain('Calculado al cerrar la iteración 3');
    // Cabecera: diana, hipótesis y los ocho pasos en orden, cada uno con su definición en title.
    const ths = [...nodo.querySelectorAll('thead th')];
    expect(ths.length).toBe(10);
    expect(ths.slice(2).map((t) => t.textContent?.replace(/^\d+\s*/, ''))).toEqual(['Mecanismo', 'Opciones de intervención', 'Compromiso de diana', 'Efecto funcional', 'Selectividad y toxicidad', 'Entrega y exposición', 'Replicación independiente', 'Evidencia en la población']);
    for (const p of PASOS_RUTA) expect(ths.map((t) => t.getAttribute('title')).join('\n')).toContain(DEFINICIONES_PASO[p]);
    // Filas: etiqueta, número de hipótesis y enlaces por título de la muestra.
    const filas = [...nodo.querySelectorAll('tbody tr')];
    expect(filas.length).toBe(2);
    expect(filas[0]!.querySelector('strong')?.textContent).toBe('GFAP');
    expect(filas[0]!.querySelectorAll('td')[1]!.textContent).toBe('2');
    const enlaces = [...filas[0]!.querySelectorAll('a.enlace')];
    expect(enlaces.length).toBe(2);
    expect(enlaces[0]!.getAttribute('href')).toBe('#/investigaciones/inv-1/hipotesis/hip-1');
    expect(enlaces[0]!.textContent).toBe(estado.hipotesis.find((h) => h.id === 'hip-1')!.titulo.slice(0, 60).replace(/(.{57}).+/, '$1...'));
    expect(texto).toContain('4 hechos del modelo de mundo');
    // Celdas de GFAP: mecanismo con 2 y certeza baja; compromiso parcial sin hipótesis; huecos en gris.
    const celdas = [...filas[0]!.querySelectorAll('td.ruta-celda')];
    expect(celdas.length).toBe(8);
    expect(celdas[0]!.querySelector('.ruta-celda-cifra')?.textContent).toBe('2');
    expect(celdas[0]!.querySelector('.chip')?.textContent).toBe('baja');
    expect(celdas[0]!.className).toContain('ruta-certeza-aviso');
    expect(celdas[1]!.textContent).toContain('+1 parcial');
    expect(celdas[2]!.querySelector('.ruta-celda-cifra')?.textContent).toBe('0');
    expect(celdas[2]!.textContent).toContain('+1 parcial');
    expect(celdas[2]!.textContent).toContain('1 hecho');
    expect(celdas[3]!.className).toContain('ruta-hueco');
    expect(celdas[3]!.textContent).toContain('hueco');
    // Un hueco con hechos que lo tocan lo dice, sin contarlos como cobertura.
    expect(celdas[5]!.className).toContain('ruta-hueco');
    expect(celdas[5]!.textContent).toContain('2 hechos');
    expect(celdas[5]!.getAttribute('title')).toContain('2 hechos del modelo de mundo lo tocan');
    expect(celdas[6]!.querySelector('.chip')?.textContent).toBe('moderada');
    // TREM2: solo mecanismo con certeza alta; los otros siete huecos.
    const celdas2 = [...filas[1]!.querySelectorAll('td.ruta-celda')];
    expect(celdas2[0]!.querySelector('.chip')?.textContent).toBe('alta');
    expect(celdas2[0]!.className).toContain('ruta-certeza-ok');
    expect(celdas2.filter((c) => c.className.includes('ruta-hueco')).length).toBe(7);
    // Los title de las celdas explican en llano.
    expect(celdas[0]!.getAttribute('title')).toContain('2 hipótesis cubren el paso');
    expect(celdas[0]!.getAttribute('title')).toContain('certeza máxima: certeza baja');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('con un mapa roto no lanza: filas sin pasos, hipótesis que no son texto, celdas nulas, certeza desconocida', async () => {
    const roto = {
      investigacionId: 7,
      filas: [
        { clave: 'X', etiqueta: '', hipotesis: [1, null, 'hip-9'], hechos: 'muchos', huecos: null, pasos: { mecanismo: null, efecto_funcional: { hipotesis: 'dos', parciales: -1, hechos: 1.7, certezaMax: 'altisima' } } },
        null,
        'texto',
        { clave: null, etiqueta: null, hipotesis: 'hip-1', pasos: null },
      ],
      resumen: null,
    } as unknown as Mapa;
    await act(async () => root.render(<MapaRuta mapa={roto} />));
    const filas = [...nodo.querySelectorAll('tbody tr')];
    expect(filas.length).toBe(2);
    expect(filas[0]!.querySelector('strong')?.textContent).toBe('X');
    expect(filas[0]!.querySelectorAll('td')[1]!.textContent).toBe('1');
    expect(filas[0]!.querySelector('a.enlace')?.textContent).toBe('hip-9');
    expect(filas[1]!.querySelector('strong')?.textContent).toBe('sin diana');
    const celdas = [...filas[0]!.querySelectorAll('td.ruta-celda')];
    expect(celdas.length).toBe(8);
    expect(celdas[0]!.className).toContain('ruta-hueco');
    // "dos" no es un número: 0 hipótesis; hechos 1.7 se lee como 1; la certeza desconocida no pinta chip.
    expect(celdas[3]!.textContent).toContain('1 hecho');
    expect(celdas[3]!.querySelector('.chip')).toBeNull();
    expect(nodo.textContent).not.toContain('NaN');
    expect(nodo.textContent).not.toContain('undefined');
    expect(nodo.textContent).not.toContain('null');
  });
});

describe('MapaRuta, adversario', () => {
  it('con un estado sin lista de hipótesis, ids repetidos y títulos vacíos no lanza ni duplica enlaces', async () => {
    const m = mapa();
    m.filas[0]!.hipotesis = ['hip-1', 'hip-1', 'hip-x', 'hip-x', 'hip-2'];
    const estado = { hipotesis: [{ id: 'hip-1', titulo: '' }, { id: 'hip-x', titulo: null }] } as unknown as EstadoRosa;
    await act(async () => root.render(<MapaRuta mapa={m} estado={estado} />));
    const fila = nodo.querySelector('tbody tr')!;
    const enlaces = [...fila.querySelectorAll('a.enlace')].map((a) => a.textContent);
    // Cada hipótesis una vez; sin título se ve el id, nunca un enlace vacío.
    expect(enlaces).toEqual(['hip-1', 'hip-x', 'hip-2']);
    expect(fila.querySelectorAll('td')[1]!.textContent).toBe('3');
    await act(async () => root.render(<MapaRuta mapa={m} estado={{} as unknown as EstadoRosa} />));
    expect(nodo.querySelectorAll('tbody tr').length).toBe(2);
    expect(nodo.textContent).not.toContain('undefined');
  });

  it('con resumen, etiqueta y huecos de otro tipo no lanza ni pinta [object', async () => {
    const roto = { ...mapa(), resumen: { texto: 'no' }, iteracion: 'tres' } as unknown as Mapa;
    roto.filas[0] = { ...roto.filas[0]!, etiqueta: { x: 1 }, huecos: 'mecanismo', hechos: null } as unknown as Mapa['filas'][number];
    await act(async () => root.render(<MapaRuta mapa={roto} />));
    const todo = todoElTexto();
    expect(todo).not.toContain('[object');
    expect(todo).not.toContain('undefined');
    expect(todo).not.toContain('NaN');
    // huecos como texto no es una lista: no marca en gris el mecanismo que sí tiene hipótesis.
    const celdas = [...nodo.querySelector('tbody tr')!.querySelectorAll('td.ruta-celda')];
    expect(celdas[0]!.className).not.toContain('ruta-hueco');
  });

  it('el mapa real con hipótesis sin tarjeta trae la fila "Sin diana declarada" con ocho huecos y se pinta', async () => {
    // Forma exacta de rosa/ruta.py mapa_ruta con dos hipótesis vivas sin tarjeta ni experimento.
    const real: Mapa = {
      investigacionId: 'inv-1',
      resumen: '1 diana o proceso con 2 hipótesis vivas; la más avanzada es Sin diana declarada (0 de 8 pasos con alguna hipótesis que los cubre); huecos en todas las filas.',
      filas: [{ clave: 'sin_diana', etiqueta: 'Sin diana declarada', hipotesis: ['hip-1', 'hip-2'], pasos: Object.fromEntries(PASOS_RUTA.map((p) => [p, { ...vacia }])) as Mapa['filas'][number]['pasos'], huecos: [...PASOS_RUTA], hechos: 0 }],
    };
    await act(async () => root.render(<MapaRuta mapa={real} />));
    const celdas = [...nodo.querySelectorAll('td.ruta-celda')];
    expect(celdas.length).toBe(8);
    expect(celdas.every((c) => c.className.includes('ruta-hueco'))).toBe(true);
    expect(nodo.textContent).toContain('Sin diana declarada');
    expect(nodo.textContent).toContain('Calculado a demanda');
  });
});
