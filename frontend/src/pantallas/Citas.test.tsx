// @vitest-environment jsdom
// La pantalla de citas: que la lista y la ficha salgan de lo que devuelve el
// servidor, que el pasaje quede resaltado dentro de la página, que el veredicto
// que se enseña sea el del verificador y no una deducción de la pantalla, y que
// lo que no tiene página lo diga en vez de inventarla.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import type { FichaCita, ListaCitas } from '../lib/citas';
import { Citas } from './Citas';

const respuestas = vi.hoisted(() => ({
  lista: null as ListaCitas | null | 'sin_respuesta',
  ficha: null as FichaCita | null | 'sin_respuesta',
  pedidas: [] as string[],
}));
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: {
    citasDe: vi.fn(async () => respuestas.lista),
    citaDe: vi.fn(async (_c: string, id: string) => {
      respuestas.pedidas.push(id);
      return respuestas.ficha;
    }),
    pdfDeCita: (c: string, a: string) => `/api/corridas/${c}/citas/${a}/pdf`,
  },
}));

const PASAJE = 'Plasma GFAP was associated with amyloid beta PET burden';
const PAGINA = `Antes del pasaje. ${PASAJE}. Después del pasaje.`;
// Los tramos vienen del servidor en posiciones del texto original: se calculan
// aquí igual que allí, para que el test no dependa de contar a mano.
const TRAMO = { inicio: PAGINA.indexOf(PASAJE), fin: PAGINA.indexOf(PASAJE) + PASAJE.length, texto: PASAJE };

const LISTA: ListaCitas = {
  corridaId: 'cor-1',
  resumen: { total: 3, porVeredicto: { sostenida: 1, no_sostenida: 1, parcial: 1 }, porClase: { pagina: 1, resumen: 1, web: 1 }, conPagina: 1, conPdf: 1 },
  afirmaciones: [
    { id: 'af-1', texto: 'El GFAP se asocia al amiloide.', cita: '[Pereira 2021, pág. 3508]', veredicto: 'sostenida', iteracion: 1, fuenteId: 'f-1', referencia: 'Pereira 2021', localizador: 'pág. 3508', clase: 'pagina', conTexto: true, conPdf: true },
    { id: 'af-2', texto: 'Sube un treinta por ciento.', cita: '[Syrjanen 2022, resumen]', veredicto: 'no_sostenida', iteracion: 1, fuenteId: 'f-2', referencia: 'Syrjanen 2022', localizador: 'resumen', clase: 'resumen', conTexto: true, conPdf: false },
    { id: 'af-3', texto: 'Algo del texto de la web.', cita: '[Schindler 2019, texto web, parte 2]', veredicto: 'parcial', iteracion: 2, fuenteId: 'f-3', referencia: 'Schindler 2019', localizador: 'texto web, parte 2', clase: 'web', conTexto: true, conPdf: false },
  ],
};

const FICHA: FichaCita = {
  afirmacion: { id: 'af-1', texto: 'El GFAP se asocia al amiloide.', cita: '[Pereira 2021, pág. 3508]', veredicto: 'sostenida', motivo: 'Literal en la página.', iteracion: 1, pasaje: PASAJE },
  fuente: { id: 'f-1', referencia: 'Pereira 2021', titulo: 'Plasma GFAP is an early marker', doi: '10.1093/brain/awab223', anio: 2021, textoCompleto: true },
  localizador: 'pág. 3508',
  clase: 'pagina',
  pagina: 3508,
  encabezado: 'Resultados',
  texto: PAGINA,
  tramos: [TRAMO],
  falta: null,
  completo: true,
  conPdf: true,
  url: '',
  leidos: [
    { localizador: 'pág. 3507', clase: 'pagina', pagina: 3507, actual: false },
    { localizador: 'pág. 3508', clase: 'pagina', pagina: 3508, actual: true },
  ],
};

let nodo: HTMLDivElement;
let root: Root;
const inv = { id: 'inv-1', titulo: 'Una investigación' } as Investigacion;
const estado = {
  conexion: 'servidor',
  corridas: [
    { id: 'cor-1', investigacionId: 'inv-1', numero: 13 },
    { id: 'cor-0', investigacionId: 'inv-1', numero: 12 },
  ],
} as unknown as EstadoRosa;

beforeEach(() => {
  respuestas.lista = LISTA;
  respuestas.ficha = FICHA;
  respuestas.pedidas = [];
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

const montar = async () => {
  await act(async () => root.render(<Citas inv={inv} estado={estado} />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const texto = () => nodo.textContent ?? '';
const boton = (t: string) => [...nodo.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith(t))!;
const pulsar = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe('la pantalla de citas', () => {
  it('lista las afirmaciones con su veredicto y de qué se apoyan, y dice cuántas resuelven a página', async () => {
    await montar();
    expect(texto()).toContain('El GFAP se asocia al amiloide.');
    expect(texto()).toContain('no sostenida');
    // Lo que no tiene página lo dice, en vez de inventarse una.
    expect(texto()).toContain('resumen, sin número de página');
    expect(texto()).toContain('texto web, parte 2, sin número de página');
    expect(texto()).toContain('1 afirmación resuelve a página exacta de 3');
  });

  it('el pasaje queda resaltado dentro de la página y el resto del texto se conserva entero', async () => {
    await montar();
    const hoja = nodo.querySelector('.citas-hoja')!;
    // La hoja lleva el encabezado de la sección encima del texto de la página.
    expect(hoja.querySelector('.citas-encabezado')?.textContent).toBe('Resultados');
    expect(hoja.querySelector('.citas-texto')?.textContent).toBe(PAGINA);
    const marca = hoja.querySelector('mark')!;
    expect(marca.textContent).toBe(PASAJE);
    expect(nodo.querySelector('.citas-numpag')?.textContent).toBe('3508');
  });

  it('el veredicto que se enseña es el del verificador, no una deducción de la pantalla', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' }, completo: true };
    await montar();
    const comparacion = nodo.querySelector('.citas-comparacion')!.textContent ?? '';
    expect(comparacion).toContain('la cita no resuelve');
    expect(comparacion).toContain('Lo que dijo ROSA2018');
  });

  it('cuando falta un tramo del pasaje lo enseña tachado, que es el motivo del veredicto', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'no_sostenida' }, completo: false, falta: 'in ninety per cent of participants', tramos: [] };
    await montar();
    expect(nodo.querySelector('.citas-falta')?.textContent).toBe('in ninety per cent of participants');
    expect(texto()).toContain('No está en la fuente');
    expect(nodo.querySelector('.citas-hoja mark')).toBeNull();
  });

  it('al filtrar, la ficha pasa a la primera del filtro en vez de quedarse en una que ya no se ve', async () => {
    await montar();
    expect(respuestas.pedidas).toEqual(['af-1']);
    await pulsar(boton('Fallidas'));
    // af-2 es la única que no es sostenida ni parcial.
    expect(respuestas.pedidas[respuestas.pedidas.length - 1]).toBe('af-2');
    expect(nodo.querySelectorAll('.citas-af').length).toBe(1);
  });

  it('el enlace al PDF solo aparece cuando la fuente tiene PDF guardado', async () => {
    await montar();
    expect([...nodo.querySelectorAll('a')].some((a) => a.textContent === 'Abrir el PDF')).toBe(true);
    await act(async () => root.render(<div />));
    respuestas.ficha = { ...FICHA, conPdf: false };
    await montar();
    expect([...nodo.querySelectorAll('a')].some((a) => a.textContent === 'Abrir el PDF')).toBe(false);
  });

  it('si el servidor no responde lo dice con esas palabras y no finge que no hay citas', async () => {
    respuestas.lista = 'sin_respuesta';
    await montar();
    expect(texto()).toContain('No pude comprobar las citas');
    expect(texto()).toContain('No quiere decir que no las haya');
  });

  it('con datos de muestra explica que las citas se leen del servidor', async () => {
    respuestas.lista = null;
    await montar();
    expect(texto()).toContain('se leen del servidor');
  });

  it('una corrida sin afirmaciones lo dice en llano', async () => {
    respuestas.lista = { corridaId: 'cor-1', resumen: { total: 0, porVeredicto: {}, porClase: {}, conPagina: 0, conPdf: 0 }, afirmaciones: [] };
    await montar();
    expect(texto()).toContain('todavía no tiene afirmaciones extraídas');
  });
});
