// @vitest-environment jsdom
// La pantalla de citas: que la lista y la ficha salgan de lo que devuelve el
// servidor, que el pasaje quede resaltado dentro de la página, que el veredicto
// que se enseña sea el del verificador y no una deducción de la pantalla, y que
// lo que no tiene página lo diga en vez de inventarla.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import type { ComprobacionDeHoy, FichaCita, ListaCitas } from '../lib/citas';
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
    paginaDeCita: (c: string, a: string) => `/api/corridas/${c}/citas/${a}/pagina.png`,
  },
}));

const PASAJE = 'Plasma GFAP was associated with amyloid beta PET burden';
const PAGINA = `Antes del pasaje. ${PASAJE}. Después del pasaje.`;
// Los tramos vienen del servidor en posiciones del texto original: se calculan
// aquí igual que allí, para que el test no dependa de contar a mano.
const TRAMO = { inicio: PAGINA.indexOf(PASAJE), fin: PAGINA.indexOf(PASAJE) + PASAJE.length, texto: PASAJE };

const HOY_BIEN: ComprobacionDeHoy = { resuelve: true, motivoResuelve: '', literal: true, falta: null, localizadorAdmitido: true };

const LISTA: ListaCitas = {
  corridaId: 'cor-1',
  resumen: { total: 3, porVeredicto: { sostenida: 1, no_sostenida: 1, parcial: 1 }, porClase: { pagina: 1, resumen: 1, web: 1 }, conPagina: 1, conPdf: 1, bloqueosViejos: 1, conCitaEnOrden: 2, bloqueadasConCitaEnOrden: 2, resuelvenHoy: 3, literalesHoy: 2 },
  afirmaciones: [
    { id: 'af-1', texto: 'El GFAP se asocia al amiloide.', cita: '[Pereira 2021, pág. 3508]', veredicto: 'sostenida', iteracion: 1, fuenteId: 'f-1', referencia: 'Pereira 2021', localizador: 'pág. 3508', clase: 'pagina', conTexto: true, conPdf: true, hoy: HOY_BIEN, bloqueoViejo: false },
    { id: 'af-2', texto: 'Sube un treinta por ciento.', cita: '[Syrjanen 2022, resumen]', veredicto: 'no_sostenida', iteracion: 1, fuenteId: 'f-2', referencia: 'Syrjanen 2022', localizador: 'resumen', clase: 'resumen', conTexto: true, conPdf: false, hoy: { ...HOY_BIEN, literal: false, falta: 'un treinta por ciento' }, bloqueoViejo: false },
    { id: 'af-3', texto: 'Algo del texto de la web.', cita: '[Schindler 2019, texto web, parte 2]', veredicto: 'parcial', iteracion: 2, fuenteId: 'f-3', referencia: 'Schindler 2019', localizador: 'texto web, parte 2', clase: 'web', conTexto: true, conPdf: false, hoy: HOY_BIEN, bloqueoViejo: true },
  ],
};

const FICHA: FichaCita = {
  hoy: HOY_BIEN,
  bloqueoViejo: false,
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

  it('el veredicto que se enseña es el guardado y se dice que es del momento de extraerla', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' }, completo: true };
    await montar();
    const comparacion = nodo.querySelector('.citas-comparacion')!.textContent ?? '';
    expect(comparacion).toContain('la cita no resuelve');
    expect(comparacion).toContain('Veredicto al extraerla');
  });

  it('las dos señales van separadas: el texto puede coincidir con la fuente aunque la cita no apunte a ningún sitio', async () => {
    respuestas.ficha = { ...FICHA, hoy: { resuelve: false, motivoResuelve: 'La fuente no tiene ese localizador.', literal: false, falta: null, localizadorAdmitido: true }, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' } };
    await montar();
    const senales = nodo.querySelectorAll('.citas-senales li');
    expect(senales.length).toBe(2);
    expect(senales[0]!.textContent).toContain('La cita apunta a un sitio que existe');
    expect(senales[0]!.querySelector('.citas-no')).not.toBeNull();
    expect(senales[1]!.textContent).toContain('El pasaje está ahí, literal');
    // Y al revés: el sitio no existe pero el texto sí coincidiría.
    await act(async () => root.render(<div />));
    respuestas.ficha = { ...FICHA, hoy: { resuelve: true, motivoResuelve: '', literal: false, falta: 'un tramo inventado' }, afirmacion: { ...FICHA.afirmacion, veredicto: 'no_sostenida' } } as FichaCita;
    await montar();
    const dos = nodo.querySelectorAll('.citas-senales li');
    expect(dos[0]!.querySelector('.citas-si')).not.toBeNull();
    expect(dos[1]!.querySelector('.citas-no')).not.toBeNull();
    expect(nodo.querySelector('.citas-falta')?.textContent).toBe('un tramo inventado');
  });

  it('un bloqueo de una versión anterior se marca y se puede filtrar, sin reescribir el veredicto', async () => {
    respuestas.ficha = { ...FICHA, bloqueoViejo: true, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' } };
    await montar();
    expect(nodo.querySelector('.citas-rancio')?.textContent).toContain('versión anterior del verificador');
    // El veredicto guardado sigue ahí: la pantalla no decide por el verificador.
    expect(nodo.querySelector('.citas-comparacion')?.textContent).toContain('la cita no resuelve');
    expect(texto()).toContain('Ya no bloquearían');
    await pulsar(boton('Ya no bloquearían'));
    expect(nodo.querySelectorAll('.citas-af').length).toBe(1);
    expect(nodo.querySelector('.citas-marca-rancio')?.textContent).toBe('ya no bloquearía');
  });

  it('cuando falta un tramo del pasaje lo enseña tachado, que es el motivo del veredicto', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'no_sostenida' }, completo: false, falta: 'in ninety per cent of participants', tramos: [], hoy: { resuelve: true, motivoResuelve: '', literal: false, falta: 'in ninety per cent of participants', localizadorAdmitido: true } };
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

  it('en un PDF la marca se enseña dentro: el botón abre la página pintada', async () => {
    await montar();
    // Antes se enseñaba la página del PDF en el visor del navegador con
    // `search=`, que Chrome ignora: abría por la página buena y sin marcar
    // nada (Emir, 22 de septiembre de 2026). Ahora la marca la pinta ROSA2018.
    const boton = [...nodo.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Ver la cita marcada'))!;
    expect(boton.textContent).toBe('Ver la cita marcada en la página 3508');
    expect(nodo.querySelector('img.citas-pagina')).toBe(null);
    await act(async () => {
      boton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const imagen = nodo.querySelector('img.citas-pagina')!;
    expect(imagen.getAttribute('src')).toBe('/api/corridas/cor-1/citas/af-1/pagina.png');
    expect(imagen.getAttribute('alt')).toContain('marcado en naranja');
  });

  it('el enlace al PDF entero no promete una marca: solo lleva a la página', async () => {
    await montar();
    const enlace = [...nodo.querySelectorAll('a')].find((a) => a.textContent === 'Abrir el PDF entero')!;
    const href = enlace.getAttribute('href') ?? '';
    expect(href).toBe('/api/corridas/cor-1/citas/af-1/pdf#page=3508');
    expect(href).not.toContain('search=');
  });

  it('si el pasaje no está en esa página, la página se enseña igual y se dice', async () => {
    respuestas.ficha = { ...FICHA, completo: false, tramos: [] };
    await montar();
    const boton = [...nodo.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Ver la cita marcada'))!;
    await act(async () => {
      boton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(nodo.querySelector('img.citas-pagina')).not.toBe(null);
    expect(nodo.textContent).toContain('El pasaje no está en esta página');
  });

  it('en una fuente web, el botón lleva al texto y el navegador lo resalta solo', async () => {
    respuestas.ficha = { ...FICHA, conPdf: false, clase: 'web', pagina: null, localizador: 'texto web, parte 2', url: 'https://ejemplo.org/articulo' };
    await montar();
    const enlace = [...nodo.querySelectorAll('a')].find((a) => a.textContent === 'Ver la cita en la fuente')!;
    const href = enlace.getAttribute('href') ?? '';
    expect(href.startsWith('https://ejemplo.org/articulo#:~:text=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('Plasma GFAP was associated');
    expect(texto()).toContain('salta solo hasta el pasaje');
  });

  it('una cita al resumen también lleva al texto, por la página del artículo', async () => {
    respuestas.ficha = { ...FICHA, conPdf: false, clase: 'resumen', pagina: null, url: '' };
    await montar();
    expect([...nodo.querySelectorAll('a')].some((a) => (a.textContent ?? '').startsWith('Ver la cita en el PDF'))).toBe(false);
    const enlace = [...nodo.querySelectorAll('a')].find((a) => a.textContent === 'Ver la cita en la fuente')!;
    expect((enlace.getAttribute('href') ?? '').startsWith('https://doi.org/10.1093/brain/awab223#:~:text=')).toBe(true);
    expect(texto()).toContain('salta solo hasta el pasaje');
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
    respuestas.lista = { corridaId: 'cor-1', resumen: { total: 0, porVeredicto: {}, porClase: {}, conPagina: 0, conPdf: 0, bloqueosViejos: 0, conCitaEnOrden: 0, bloqueadasConCitaEnOrden: 0, resuelvenHoy: 0, literalesHoy: 0 }, afirmaciones: [] };
    await montar();
    expect(texto()).toContain('todavía no tiene afirmaciones extraídas');
  });
});

describe('la pantalla de citas con un servidor anterior', () => {
  it('si la ficha llega sin las señales nuevas, lo dice y no rompe la pantalla', async () => {
    // Es lo que pasa justo después de desplegar: el servidor que está vivo
    // arrancó antes y su respuesta no trae `hoy`.
    const sinSenales = { ...FICHA } as Partial<FichaCita>;
    delete sinSenales.hoy;
    delete sinSenales.bloqueoViejo;
    respuestas.ficha = sinSenales as FichaCita;
    await montar();
    expect(nodo.querySelector('.citas-hoja mark')).not.toBeNull();
    expect(texto()).toContain('todavía no comprueba la cita');
    expect(nodo.querySelectorAll('.citas-senales li').length).toBe(0);
    expect(nodo.querySelector('.citas-rancio')).toBeNull();
  });

  it('una lista sin las cifras nuevas tampoco rompe: el filtro extra no aparece', async () => {
    const resumen = { ...LISTA.resumen } as Partial<ListaCitas['resumen']>;
    delete resumen.bloqueosViejos;
    respuestas.lista = { ...LISTA, resumen: resumen as ListaCitas['resumen'], afirmaciones: LISTA.afirmaciones.map((a) => ({ ...a, bloqueoViejo: undefined as unknown as boolean })) };
    await montar();
    expect(texto()).toContain('El GFAP se asocia al amiloide.');
    expect(texto()).not.toContain('Ya no bloquearían');
  });
});

describe('la cuenta de los bloqueos que ya no se sostienen', () => {
  it('una cita en orden que sigue bloqueada por otra comprobación no se cuenta como recuperada', async () => {
    respuestas.ficha = {
      ...FICHA,
      bloqueoViejo: false,
      hoy: HOY_BIEN,
      veredictoDeHoy: { veredicto: 'no_sostenida', motivo: 'Identificadores que no aparecen en el fragmento citado: NCT04437511.', bloquea: true },
      afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' },
    };
    await montar();
    // Las dos señales de la cita están en verde...
    expect(nodo.querySelectorAll('.citas-senales .citas-si').length).toBe(2);
    // ...y aun así no se promete que se recupere: se dice por qué sigue caída.
    expect(nodo.querySelector('.citas-rancio')).toBeNull();
    expect(nodo.querySelector('.citas-sigue')?.textContent).toContain('NCT04437511');
  });

  it('la cabecera separa las dos cuentas cuando no coinciden', async () => {
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, bloqueosViejos: 151, bloqueadasConCitaEnOrden: 153 } };
    await montar();
    const cabecera = nodo.querySelector('.pantalla-cabecera')!.textContent ?? '';
    expect(cabecera).toContain('151 afirmaciones quedaron bloqueadas');
    expect(cabecera).toContain('Otras 2 tienen la cita en orden pero siguen bloqueadas por otra comprobación');
  });
});
