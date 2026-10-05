// @vitest-environment jsdom
// La pantalla de citas: que la lista y la ficha salgan de lo que devuelve el
// servidor, que el pasaje quede resaltado dentro de la página, que el veredicto
// que se enseña sea el del verificador y no una deducción de la pantalla, y que
// lo que no tiene página lo diga en vez de inventarla.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoRosa, Investigacion, RecuperacionCitas } from '../datos/tipos';
import type { CitasRecuperables, ComprobacionDeHoy, FichaCita, ListaCitas } from '../lib/citas';
import { Citas } from './Citas';
import { acciones } from '../datos/almacen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const respuestas = vi.hoisted(() => ({
  lista: null as ListaCitas | null | 'sin_respuesta',
  ficha: null as FichaCita | null | 'sin_respuesta',
  pedidas: [] as string[],
  recuperables: null as CitasRecuperables | null | 'sin_respuesta',
  recuperaciones: [] as [string, string | null][],
}));
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: {
    citasDe: vi.fn(async () => respuestas.lista),
    citaDe: vi.fn(async (_c: string, id: string) => {
      respuestas.pedidas.push(id);
      return respuestas.ficha;
    }),
    citasRecuperables: vi.fn(async () => respuestas.recuperables),
    pedirRecuperacionCitas: vi.fn(async (i: string, c: string | null) => {
      respuestas.recuperaciones.push([i, c]);
      return true;
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
  vi.clearAllMocks();
  // Cada respuesta HTTP se deserializa como una instantánea nueva, también
  // cuando su contenido no cambió entre dos avisos SSE.
  vi.mocked(acciones.citasDe).mockImplementation(async () => respuestas.lista && typeof respuestas.lista === 'object' ? structuredClone(respuestas.lista) : respuestas.lista);
  vi.mocked(acciones.citaDe).mockImplementation(async (_c, id) => {
    respuestas.pedidas.push(id);
    return respuestas.ficha;
  });
  vi.mocked(acciones.pedirRecuperacionCitas).mockImplementation(async (i, c = null) => {
    respuestas.recuperaciones.push([i, c]);
    return true;
  });
  respuestas.lista = LISTA;
  respuestas.ficha = FICHA;
  respuestas.pedidas = [];
  respuestas.recuperables = null;
  respuestas.recuperaciones = [];
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  vi.useRealTimers();
});

const montar = async (investigacion: Investigacion = inv) => {
  await act(async () => root.render(<Citas inv={investigacion} estado={estado} />));
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
    // La cifra grande del banco: cuántas resuelven a página, de cuántas.
    const cifra = nodo.querySelector('.cit-cifra')!;
    expect(cifra.querySelector('b')?.textContent).toBe('1');
    expect(cifra.textContent).toContain('de 3');
    expect(cifra.textContent).toContain('a página exacta del PDF');
  });

  it('el pasaje queda resaltado dentro de la página y el resto del texto se conserva entero', async () => {
    await montar();
    const hoja = nodo.querySelector('.cit-hoja')!;
    // La hoja lleva el encabezado de la sección encima del texto de la página.
    expect(hoja.querySelector('.cit-hoja-encabezado')?.textContent).toBe('Resultados');
    expect(hoja.querySelector('.cit-hoja-texto')?.textContent).toBe(PAGINA);
    const marca = hoja.querySelector('mark')!;
    expect(marca.textContent).toBe(PASAJE);
    expect(nodo.querySelector('.cit-hoja-num')?.textContent).toBe('3508');
  });

  it('el veredicto que se enseña es el guardado y se dice que es del momento de extraerla', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' }, completo: true };
    await montar();
    const comparacion = nodo.querySelector('.cit-comparacion')!.textContent ?? '';
    expect(comparacion).toContain('la cita no resuelve');
    expect(comparacion).toContain('Veredicto al extraerla');
  });

  it('las dos señales van separadas: el texto puede coincidir con la fuente aunque la cita no apunte a ningún sitio', async () => {
    respuestas.ficha = { ...FICHA, hoy: { resuelve: false, motivoResuelve: 'La fuente no tiene ese localizador.', literal: false, falta: null, localizadorAdmitido: true }, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' } };
    await montar();
    const senales = nodo.querySelectorAll('.cit-senales li');
    expect(senales.length).toBe(2);
    expect(senales[0]!.textContent).toContain('La cita apunta a un sitio que existe');
    expect(senales[0]!.querySelector('.cit-check.cit-mal')).not.toBeNull();
    expect(senales[1]!.textContent).toContain('El pasaje está ahí, literal');
    // Y al revés: el sitio no existe pero el texto sí coincidiría.
    await act(async () => root.render(<div />));
    respuestas.ficha = { ...FICHA, hoy: { resuelve: true, motivoResuelve: '', literal: false, falta: 'un tramo inventado' }, afirmacion: { ...FICHA.afirmacion, veredicto: 'no_sostenida' } } as FichaCita;
    await montar();
    const dos = nodo.querySelectorAll('.cit-senales li');
    expect(dos[0]!.querySelector('.cit-check.cit-bien')).not.toBeNull();
    expect(dos[1]!.querySelector('.cit-check.cit-mal')).not.toBeNull();
    expect(nodo.querySelector('.citas-falta')?.textContent).toBe('un tramo inventado');
  });

  it('un bloqueo de una versión anterior se marca y se puede filtrar, sin reescribir el veredicto', async () => {
    respuestas.ficha = { ...FICHA, bloqueoViejo: true, afirmacion: { ...FICHA.afirmacion, veredicto: 'cita_no_resuelve' } };
    await montar();
    expect(nodo.querySelector('.cit-rancio')?.textContent).toContain('versión anterior del verificador');
    // El veredicto guardado sigue ahí: la pantalla no decide por el verificador.
    expect(nodo.querySelector('.cit-comparacion')?.textContent).toContain('la cita no resuelve');
    expect(texto()).toContain('Ya no bloquearían');
    await pulsar(boton('Ya no bloquearían'));
    expect(nodo.querySelectorAll('.citas-af').length).toBe(1);
    expect(nodo.querySelector('.cit-rancia')?.textContent).toBe('ya no bloquearía');
  });

  it('cuando falta un tramo del pasaje lo enseña tachado, que es el motivo del veredicto', async () => {
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, veredicto: 'no_sostenida' }, completo: false, falta: 'in ninety per cent of participants', tramos: [], hoy: { resuelve: true, motivoResuelve: '', literal: false, falta: 'in ninety per cent of participants', localizadorAdmitido: true } };
    await montar();
    expect(nodo.querySelector('.citas-falta')?.textContent).toBe('in ninety per cent of participants');
    expect(texto()).toContain('No está en la fuente');
    expect(nodo.querySelector('.cit-hoja mark')).toBeNull();
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
    expect(nodo.querySelector('img.cit-pagina-img')).toBe(null);
    await act(async () => {
      boton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const imagen = nodo.querySelector('img.cit-pagina-img')!;
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
    expect(nodo.querySelector('img.cit-pagina-img')).not.toBe(null);
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

describe('las citas siguen al estado real', () => {
  const actualizar = async (e: EstadoRosa = { ...estado, corridas: [...estado.corridas] }, i = inv) => {
    await act(async () => root.render(<Citas inv={i} estado={e} />));
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    await act(async () => vi.advanceTimersByTimeAsync(10));
  };

  it('un aviso SSE de corridas refresca cifras y fuente sin perder la afirmación elegida', async () => {
    await montar();
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, id: 'af-2', texto: 'Segunda afirmación', veredicto: 'no_sostenida' } };
    await pulsar(nodo.querySelectorAll('.citas-af')[1]!);
    vi.useFakeTimers();
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, total: 4 }, afirmaciones: [...LISTA.afirmaciones, { ...LISTA.afirmaciones[0]!, id: 'af-4' }] };
    respuestas.ficha = { ...respuestas.ficha, afirmacion: { ...respuestas.ficha.afirmacion, veredicto: 'sostenida', motivo: 'Recuperada en el servidor' } };
    await actualizar();
    expect(nodo.querySelectorAll('.citas-af')).toHaveLength(4);
    expect(nodo.querySelector('.cit-elegida')?.textContent).toContain('Sube un treinta');
    expect(nodo.querySelector('.cit-comparacion')?.textContent).toContain('Recuperada en el servidor');
    expect(respuestas.pedidas.at(-1)).toBe('af-2');
    const n = vi.mocked(acciones.citasDe).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(vi.mocked(acciones.citasDe).mock.calls).toHaveLength(n);
  });

  it('una recuperación en curso actualiza la ficha aunque no cambie su ID', async () => {
    await montar();
    vi.useFakeTimers();
    respuestas.ficha = { ...FICHA, afirmacion: { ...FICHA.afirmacion, motivo: 'Nuevo veredicto del juez' } };
    await actualizar(estado, { ...inv, recuperacionCitas: { ...REGISTRO, revisadas: 160 } });
    expect(nodo.querySelector('.cit-comparacion')?.textContent).toContain('Nuevo veredicto del juez');
    expect(vi.mocked(acciones.citasRecuperables).mock.calls).toHaveLength(2);
  });

  it('un filtro vacío deja de enseñar la ficha de una afirmación oculta', async () => {
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, porVeredicto: { sostenida: 3 } }, afirmaciones: LISTA.afirmaciones.map((a) => ({ ...a, veredicto: 'sostenida' })) };
    await montar();
    await pulsar(boton('Fallidas'));
    expect(nodo.querySelector('.cit-comparacion')).toBeNull();
    expect(nodo.querySelector('.cit-hoja')).toBeNull();
    expect(texto()).toContain('Ninguna afirmación con ese filtro.');
  });

  it('cambiar de corrida borra los contadores y la ficha anteriores incluso si falla la nueva', async () => {
    await montar();
    let terminar!: (l: ListaCitas | 'sin_respuesta') => void;
    vi.mocked(acciones.citasDe).mockImplementationOnce(() => new Promise((r) => { terminar = r; }));
    const select = nodo.querySelector('select')!;
    await act(async () => {
      select.value = 'cor-0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(nodo.querySelector('.cit-cifra')).toBeNull();
    expect(nodo.querySelector('.cit-hoja')).toBeNull();
    await act(async () => terminar('sin_respuesta'));
    expect(nodo.querySelector('.cit-cifra')).toBeNull();
    expect(texto()).toContain('No pude comprobar las citas');
    await pulsar(boton('Reintentar'));
    expect(nodo.querySelectorAll('.citas-af')).toHaveLength(3);
  });

  it('ignora la respuesta tardía de otra corrida', async () => {
    await montar();
    let terminar!: (l: ListaCitas) => void;
    vi.mocked(acciones.citasDe).mockImplementationOnce(() => new Promise((r) => { terminar = r; }));
    const select = nodo.querySelector('select')!;
    for (const id of ['cor-0', 'cor-1']) {
      await act(async () => {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await act(async () => terminar({ ...LISTA, corridaId: 'cor-0', afirmaciones: [{ ...LISTA.afirmaciones[0]!, texto: 'Respuesta obsoleta' }] }));
    expect(nodo.querySelectorAll('.citas-af')).toHaveLength(3);
    expect(texto()).not.toContain('Respuesta obsoleta');
  });

  it('un aviso durante una lectura en vuelo no se pierde ni crea peticiones solapadas', async () => {
    let terminar!: (l: ListaCitas) => void;
    vi.mocked(acciones.citasDe).mockImplementationOnce(() => new Promise((r) => { terminar = r; }));
    await montar();
    vi.useFakeTimers();
    await actualizar();
    expect(vi.mocked(acciones.citasDe).mock.calls).toHaveLength(1);
    respuestas.lista = { ...LISTA, afirmaciones: [...LISTA.afirmaciones, { ...LISTA.afirmaciones[0]!, id: 'af-nueva' }] };
    await act(async () => terminar(LISTA));
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(vi.mocked(acciones.citasDe).mock.calls).toHaveLength(2);
    expect(nodo.querySelectorAll('.citas-af')).toHaveLength(4);
  });

  it('los avisos continuos se agrupan, pero no posponen la lectura indefinidamente', async () => {
    await montar();
    vi.useFakeTimers();
    for (let n = 0; n < 10; n++) {
      await act(async () => root.render(<Citas inv={inv} estado={{ ...estado, corridas: [...estado.corridas] }} />));
      await act(async () => vi.advanceTimersByTimeAsync(300));
    }
    const llamadas = vi.mocked(acciones.citasDe).mock.calls.length;
    expect(llamadas).toBeGreaterThan(1);
    expect(llamadas).toBeLessThan(5);
  });

  it('distingue un fallo de carga de la fuente de una lista sin selección y permite reintentar', async () => {
    respuestas.ficha = 'sin_respuesta';
    await montar();
    expect(texto()).toContain('No pude cargar la fuente seleccionada');
    respuestas.ficha = FICHA;
    await pulsar(boton('Reintentar'));
    expect(nodo.querySelector('.cit-hoja mark')?.textContent).toBe(PASAJE);
  });

  it('el número de páginas comprobadas no incluye localizadores a páginas que no existen', async () => {
    respuestas.lista = { ...LISTA, afirmaciones: LISTA.afirmaciones.map((a) => ({ ...a, hoy: { ...a.hoy, resuelve: false } })) };
    await montar();
    expect(nodo.querySelector('.cit-cifra b')?.textContent).toBe('0');
    expect(boton('Con página').textContent).toContain('1');
    expect(texto()).toContain('no resuelve al texto guardado');
  });

  it('sin señales disponibles no inventa cero comprobaciones ni éxito', async () => {
    const resumen = { ...LISTA.resumen };
    delete (resumen as Partial<typeof resumen>).resuelvenHoy;
    delete (resumen as Partial<typeof resumen>).literalesHoy;
    respuestas.lista = { ...LISTA, resumen, afirmaciones: LISTA.afirmaciones.map((a) => ({ ...a, hoy: { ...a.hoy, disponible: false } })) };
    respuestas.ficha = { ...FICHA, hoy: { ...HOY_BIEN, disponible: false, motivoResuelve: 'Comprobación no disponible' } };
    await montar();
    expect(nodo.querySelector('.cit-cifra b')?.textContent).toBe('?');
    expect(nodo.querySelectorAll('.cit-medida.cit-neutro')).toHaveLength(2);
    expect(nodo.querySelector('.cit-senales')).toBeNull();
  });

  it('sin juez y no comprobable no cuentan como fallidas, y tienen su propio filtro', async () => {
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, total: 5, porVeredicto: { ...LISTA.resumen.porVeredicto, sin_verificar: 1, no_comprobable: 1 } }, afirmaciones: [...LISTA.afirmaciones, ...['sin_verificar', 'no_comprobable'].map((veredicto) => ({ ...LISTA.afirmaciones[0]!, id: veredicto, veredicto }))] };
    await montar();
    expect(boton('Fallidas').textContent).toBe('Fallidas 1');
    await pulsar(boton('Sin comprobar'));
    expect(nodo.querySelectorAll('.citas-af')).toHaveLength(2);
  });

  it('una referencia vacía no se cuenta como una fuente', async () => {
    respuestas.lista = { ...LISTA, afirmaciones: LISTA.afirmaciones.map((a) => ({ ...a, fuenteId: null, referencia: '' })) };
    await montar();
    expect(nodo.querySelector('.cit-cuenta')?.textContent).toContain('0 fuentes');
  });

  it('no anuncia una recuperación como pedida si el servidor la rechaza', async () => {
    vi.mocked(acciones.pedirRecuperacionCitas).mockResolvedValueOnce(false);
    await montar();
    await pulsar(boton('Recuperar las 1'));
    expect(texto()).toContain('El servidor no aceptó la recuperación');
    expect(texto()).not.toContain('Pedida: se hace en segundo plano');
  });

  it('permite continuar cuando solo falta enlazar evidencia ya recuperada', async () => {
    respuestas.recuperables = { ...RECUPERABLES, bloqueosViejos: 0, sinJuez: 0, porEnlazar: 7 };
    await montar();
    expect(nodo.querySelector('.cit-recuperar')?.textContent).toContain('7 afirmaciones recuperadas esperan enlazarse');
    await pulsar(boton('Continuar recuperación'));
    expect(respuestas.recuperaciones).toEqual([['inv-1', null]]);
  });

  it('la recuperación de una corrida incluye también sus afirmaciones sin juez', async () => {
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, porVeredicto: { ...LISTA.resumen.porVeredicto, sin_verificar: 4 } } };
    await montar();
    await pulsar(boton('Recuperar las 5'));
    expect(respuestas.recuperaciones).toEqual([['inv-1', 'cor-1']]);
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
    expect(nodo.querySelector('.cit-hoja mark')).not.toBeNull();
    expect(texto()).toContain('todavía no comprueba la cita');
    expect(nodo.querySelectorAll('.cit-senales li').length).toBe(0);
    expect(nodo.querySelector('.cit-rancio')).toBeNull();
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
    expect(nodo.querySelectorAll('.cit-senales .cit-check.cit-bien').length).toBe(2);
    // ...y aun así no se promete que se recupere: se dice por qué sigue caída.
    expect(nodo.querySelector('.cit-rancio')).toBeNull();
    expect(nodo.querySelector('.cit-sigue')?.textContent).toContain('NCT04437511');
  });

  it('la cabecera separa las dos cuentas cuando no coinciden', async () => {
    respuestas.lista = { ...LISTA, resumen: { ...LISTA.resumen, bloqueosViejos: 151, bloqueadasConCitaEnOrden: 153 } };
    await montar();
    // Las 151 que ya no bloquearían van en la lista, con su filtro y su
    // recuperación; las otras 2, en el banco, como lo que son.
    expect(nodo.querySelector('.cit-recuperar-fila')?.textContent).toContain('151 se juzgaron con reglas viejas');
    expect(nodo.querySelector('.cit-banco')?.textContent).toContain('2 tienen la cita en orden y siguen bloqueadas por otra comprobación');
  });

  it('el botón de una corrida pide la recuperación completa de esa corrida, en segundo plano', async () => {
    await montar();
    const b = boton('Recuperar las 1');
    expect(b).toBeTruthy();
    await pulsar(b);
    expect(respuestas.recuperaciones).toEqual([['inv-1', 'cor-1']]);
    expect(texto()).toContain('Pedida: se hace en segundo plano');
  });
});

const RECUPERABLES: CitasRecuperables = {
  investigacionId: 'inv-1',
  bloqueosViejos: 1751,
  sinJuez: 33,
  porEnlazar: 0,
  corridasVivas: 0,
  porCorrida: [{ corridaId: 'cor-1', numero: 13, estado: 'terminada', viva: false, bloqueosViejos: 1751, sinJuez: 33, porEnlazar: 0 }],
};

const REGISTRO: RecuperacionCitas = {
  estado: 'en_curso', pedidaEn: Date.UTC(2026, 8, 28, 15), quien: 'emir@alzheimerproject.com', corridaId: null, empezadaEn: 1, terminadaEn: null, fase: 'juez',
  total: 1784, revisadas: 120, recuento: { sostenida: 98, parcial: 5, no_sostenida: 12, cita_no_resuelve: 5 }, desbloqueadas: 103, enlazadas: 0, hipotesisConEvidencia: [], nacidas: [], reconcluidas: [], llamadas: 118, notas: [], motivo: null,
};

describe('la recuperación de citas de toda la investigación', () => {
  it('dice cuántas hay, qué hará y qué cuesta, y el botón la pide para toda la investigación', async () => {
    respuestas.recuperables = RECUPERABLES;
    await montar();
    const panel = nodo.querySelector('.cit-recuperar')!.textContent ?? '';
    expect(panel).toContain('1.784 afirmaciones esperan volver a juzgarse en toda la investigación');
    expect(panel).toContain('1.751 siguen bloqueadas por reglas del verificador que ya no valen y 33 se quedaron sin juez');
    expect(panel).toContain('una llamada al juez por afirmación');
    expect(boton('Recuperar las 1.784').getAttribute('title')).toContain('Cuesta una llamada al juez por afirmación');
    await pulsar(boton('Recuperar las 1.784'));
    expect(respuestas.recuperaciones).toEqual([['inv-1', null]]);
  });

  it('mientras va, enseña el avance y no deja pedir otra, ni por corrida', async () => {
    respuestas.recuperables = RECUPERABLES;
    await montar({ ...inv, recuperacionCitas: REGISTRO });
    const panel = nodo.querySelector('.cit-recuperar')!;
    expect(panel.textContent).toContain('Volviendo a juzgar con el verificador de hoy: 120 de 1.784 (98 sostenidas, 5 parciales, 12 no sostenidas, 5 siguen bloqueadas por otra regla)');
    expect(panel.querySelector('progress')?.getAttribute('value')).toBe('120');
    expect([...nodo.querySelectorAll('button')].some((b) => (b.textContent ?? '').startsWith('Recuperar'))).toBe(false);
  });

  it('al terminar deja el informe con los cambios de certeza, en llano', async () => {
    const terminada: RecuperacionCitas = {
      ...REGISTRO, estado: 'terminada', fase: null, terminadaEn: 2, revisadas: 1784, enlazadas: 240, hipotesisConEvidencia: ['h-1', 'h-2'], nacidas: ['h-9'],
      reconcluidas: [{ hipotesisId: 'h-1', titulo: 'GFAP antes que NfL', antes: 'muy_baja', despues: 'baja' }, { hipotesisId: 'h-2', titulo: 'Otra', antes: 'baja', despues: 'baja' }],
      llamadas: 1830, notas: ['Corrida 12: se agotó su tope de llamadas; 3 afirmaciones quedan sin volver a juzgar.'],
    };
    respuestas.recuperables = { ...RECUPERABLES, bloqueosViejos: 0, sinJuez: 0, porCorrida: [] };
    await montar({ ...inv, recuperacionCitas: terminada });
    const informe = nodo.querySelector('.cit-recuperar-informe')!.textContent ?? '';
    expect(informe).toContain('pedida el');
    expect(informe).toContain('240 afirmaciones enlazadas a 2 hipótesis');
    expect(informe).toContain('1 idea del vivero nació como hipótesis');
    expect(informe).toContain('2 conclusiones rehechas, 1 cambió de certeza');
    expect(informe).toContain('«GFAP antes que NfL»: de certeza muy baja a certeza baja');
    expect(informe).toContain('se agotó su tope');
    expect(informe).toContain('Costó 1.830 llamadas a modelos');
  });

  it('si el servidor no responde al contar, lo dice y no finge que no haya nada', async () => {
    respuestas.recuperables = 'sin_respuesta';
    await montar();
    expect(nodo.querySelector('.cit-recuperar')?.textContent).toContain('No pude contar las afirmaciones por recuperar');
  });

  it('sin nada que recuperar y sin recuperaciones, el panel no aparece', async () => {
    respuestas.recuperables = { ...RECUPERABLES, bloqueosViejos: 0, sinJuez: 0 };
    await montar();
    expect(nodo.querySelector('.cit-recuperar')).toBeNull();
  });
});
