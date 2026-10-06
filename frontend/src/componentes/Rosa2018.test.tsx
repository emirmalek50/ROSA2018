// @vitest-environment jsdom
// Las piezas nuevas de ROSA2018 en la ficha de la hipótesis, montadas de
// verdad (createRoot y act, como Arbol.test.tsx): la ruta terapéutica con los
// estados que calcula rosa/ruta.py, el contrato del experimento de
// rosa/experimento.py (lecturas, sistema, propósito BEST, problemas, veredicto
// por lectura y lectura del negativo, enmienda de una lectura) y el perfil de
// la diana de rosa/dianas.py (seis capas con su chip). Cada bloque se intenta
// romper con registros a medias: sin tarjeta, sin experimento, con lecturas
// basura, con capas que no son lista, con estados que esta versión no conoce.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { CapaPerfilDiana, Hipotesis, PerfilDiana, ResultadoExperimento, RutaTerapeuticaEvaluada } from '../datos/tipos';
import { ContratoDelExperimento, Jerarquia, PerfilDeLaDiana, ProtocoloYEnmiendas, PuertaYReproducciones, RutaTerapeutica, TarjetaDeHipotesis } from './Rosa2018';
import { fijarIdioma } from '../lib/idioma';

const almacen = vi.hoisted(() => ({
  acciones: {} as Record<string, unknown>,
  aplicar: vi.fn(),
  cabeceras: () => ({}),
  modoActual: (() => 'muestra') as () => 'muestra' | 'servidor',
  QUIEN: 'la persona responsable',
  avisar: vi.fn(),
  conectar: vi.fn(async () => 'servidor' as const),
  useRosa: () => ({ corridas: [] }),
}));
vi.mock('../datos/almacen', () => almacen);

const SIN_TILDE = /\b(hipotesis|conclusion|iteracion|todavia|segun|direccion|comprobacion|explicacion|seleccion|medicion|analisis|poblacion|informacion|aqui|vacio|genetica|expresion|proteina|farmacologia|diagnostico|pronostico|monitorizacion|terapeutica|proposito|ademas|asi|sintomas|cognicion|replicacion|fisiologico|clinico|farmacodinamico|sistematica|Vacio|Genetica|Expresion|Proteina|Farmacologia|Terapeutica|Proposito|Ademas|Asi)\b/;
const GUION_LARGO = /\u2014/;

beforeAll(() => {
  // Las secciones (piezas.tsx) animan al entrar en pantalla con IntersectionObserver, que jsdom no trae.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
  almacen.acciones = {};
  almacen.aplicar.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  fijarIdioma('es');
});

const render = (el: React.ReactElement) => act(async () => root.render(el));

it('traduce los estados de áreas y campañas sin cambiar sus valores canónicos', async () => {
  const e = structuredClone(estadoDeMuestra());
  const inv = e.investigaciones[0]!;
  inv.mision = { poblacion: '', etapa: '', celulaTejido: '', mecanismo: '', tipoIntervencion: '', capacidadesLaboratorio: [], presupuesto: { llamadas: 10, usd: 1, horas: 1 }, propuestaPorRosa: false, aprobadaEn: null, aprobadaPor: null,
    areas: (['elegida', 'propuesta', 'pausada', 'sin_explorar'] as const).map((estado, i) => ({ id: `area-${i}`, titulo: `Area ${i}`, familiaMecanismo: '', relevancia: '', valorIntervencion: '', incertidumbre: '', comprobabilidad: '', coste: '', demora: '', dependeDe: '', estado, condicionReapertura: '', corridaId: i === 0 ? e.corridas[0]!.id : null })),
  };
  const original = JSON.stringify(inv);
  fijarIdioma('en');
  await render(<Jerarquia inv={inv} corridas={e.corridas} />);
  await pulsar(nodo.querySelector('.seccion-plegar')!);
  const chips = [...nodo.querySelectorAll('.arbol .chip')].map((x) => x.textContent);
  expect(chips).toEqual(['Chosen', 'Proposed', 'Paused', 'Unexplored']);
  expect(nodo.textContent).not.toMatch(/elegida|propuesta|pausada|sin explorar|en_curso/);
  expect(JSON.stringify(inv)).toBe(original);
  expect([...nodo.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).join('\n')).not.toContain('Explicar');
});

it('la puerta eximida muestra el estado, la persona y el motivo también en inglés', async () => {
  const e = structuredClone(estadoDeMuestra());
  const inv = e.investigaciones[0]!;
  inv.puertaReproduccion = { requeridas: 3, superadas: 1, estado: 'eximida', eximidaPor: 'Emir Malek', motivo: 'Synthetic demonstration', fecha: 1 };
  const original = JSON.stringify(inv);
  fijarIdioma('en');
  await render(<PuertaYReproducciones inv={inv} estado={e} ahora={2} />);
  expect(nodo.textContent).toContain('Waived by Emir Malek');
  expect(nodo.textContent).toContain('Reason: Synthetic demonstration');
  expect(nodo.textContent).not.toContain('Eximida');
  expect(nodo.textContent).toContain('1 of 3');
  expect(JSON.stringify(inv)).toBe(original);
  fijarIdioma('es');
  await render(<PuertaYReproducciones inv={inv} estado={e} ahora={2} />);
  expect(nodo.textContent).toContain('Eximida por Emir Malek');
});
const titulos = () => [...nodo.querySelectorAll('[title]')].map((c) => c.getAttribute('title') ?? '');
const todoElTexto = () => [nodo.textContent ?? '', ...titulos()].join('\n');
const boton = (texto: string) => [...nodo.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
const pulsar = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const escribir = async (el: HTMLInputElement | HTMLSelectElement, valor: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, valor);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });

function hipConExperimento(): Hipotesis {
  const e = structuredClone(estadoDeMuestra());
  return e.hipotesis.find((h) => h.experimento)!;
}

function rutaEvaluada(): RutaTerapeuticaEvaluada {
  return {
    hipotesisId: 'hip-4',
    pasos: [
      { paso: 'mecanismo', estado: 'cubierto', evidencia: [{ tipo: 'afirmacion', id: 'a1', texto: 'GFAP sube en astrocitos reactivos' }], motivo: '3 afirmaciones sostenidas de mecanismo' },
      { paso: 'opciones_intervencion', estado: 'parcial', evidencia: [], motivo: 'una sola mención a un fármaco, sin dirección' },
      { paso: 'compromiso_diana', estado: 'vacio', evidencia: [], motivo: 'nada de lo reunido mide la diana tras intervenir' },
      { paso: 'efecto_funcional', estado: 'vacio', evidencia: [], motivo: 'sin desenlace funcional' },
      { paso: 'selectividad_toxicidad', estado: 'no_comprobable', evidencia: [], motivo: 'ChEMBL no respondió: no pude comprobar' },
      { paso: 'exposicion', estado: 'vacio', evidencia: [], motivo: 'sin matriz de exposición' },
      { paso: 'replicacion_independiente', estado: 'parcial', evidencia: [], motivo: 'una sola cohorte identificada (BioFINDER)' },
      { paso: 'evidencia_poblacion', estado: 'cubierto', evidencia: [], motivo: '2 estudios primarios con n mayor o igual que 50' },
    ],
    siguiente: 'opciones_intervencion',
    cubiertos: 2,
    declarado: 'efecto_funcional',
    coherente: false,
    motivoCoherencia: 'la tarjeta declara «Efecto funcional» pero «Compromiso de diana» sigue vacío: el paso declarado va por delante de la evidencia',
    porEstado: { cubierto: 2, parcial: 2, vacio: 3, no_comprobable: 1 },
    resumen: '2 de 8 pasos cubiertos (Mecanismo y Evidencia en la población); 2 parciales; sin poder comprobar: Selectividad y toxicidad; siguiente paso: Opciones de intervención.',
  };
}

describe('RutaTerapeutica con la ruta evaluada', () => {
  it('sin ruta pinta los ocho pasos como antes, sin resumen ni símbolos', async () => {
    await render(<RutaTerapeutica paso="compromiso_diana" />);
    const pasos = [...nodo.querySelectorAll('.ruta-terapeutica li')];
    expect(pasos).toHaveLength(8);
    expect(pasos[2]!.className).toBe('actual');
    expect(pasos[0]!.className).toBe('previo');
    expect(pasos[0]!.getAttribute('data-estado')).toBeNull();
    expect(nodo.querySelector('[data-ruta-resumen]')).toBeNull();
    // La definición del paso va en el title para quien lo lee por primera vez.
    expect(pasos[2]!.getAttribute('title')).toContain('llega a la diana');
  });

  it('con ruta pinta el estado de cada paso, el motivo en el title, el resumen encima y el aviso de incoherencia', async () => {
    await render(<RutaTerapeutica paso="efecto_funcional" ruta={rutaEvaluada()} />);
    const pasos = [...nodo.querySelectorAll('.ruta-terapeutica li')];
    expect(pasos.map((p) => p.getAttribute('data-estado'))).toEqual(['cubierto', 'parcial', 'vacio', 'vacio', 'no_comprobable', 'vacio', 'parcial', 'cubierto']);
    expect(pasos[2]!.getAttribute('title')).toContain('Estado: vacío');
    expect(pasos[2]!.getAttribute('title')).toContain('nada de lo reunido mide la diana');
    expect(pasos[4]!.getAttribute('title')).toContain('no pude comprobar');
    expect(pasos[3]!.className).toBe('actual');
    const resumen = nodo.querySelector('[data-ruta-resumen]')!;
    expect(resumen.textContent).toContain('2 de 8 pasos cubiertos');
    // El resumen va antes que la lista en el documento.
    expect(resumen.compareDocumentPosition(nodo.querySelector('.ruta-terapeutica')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const aviso = [...nodo.querySelectorAll('.chip-aviso')].find((c) => c.textContent?.includes('por delante'));
    expect(aviso).toBeDefined();
    expect(nodo.textContent).toContain('Compromiso de diana» sigue vacío');
    // La leyenda explica los cuatro estados.
    expect(nodo.textContent).toContain('no comprobable');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
    expect(todoElTexto()).not.toMatch(GUION_LARGO);
  });

  it('con ruta coherente no hay aviso, y un paso que falta en el registro se dice como no comprobable', async () => {
    const r = rutaEvaluada();
    r.coherente = true;
    r.pasos = r.pasos.slice(0, 3);
    await render(<RutaTerapeutica paso="mecanismo" ruta={r} />);
    expect([...nodo.querySelectorAll('.chip-aviso')].some((c) => c.textContent?.includes('por delante'))).toBe(false);
    const pasos = [...nodo.querySelectorAll('.ruta-terapeutica li')];
    expect(pasos[7]!.getAttribute('data-estado')).toBe('no_comprobable');
    expect(pasos[7]!.getAttribute('title')).toContain('no trae este paso');
  });

  it('no se rompe con una ruta basura: pasos que no son lista, entradas nulas, estado desconocido, paso declarado fuera de la ruta', async () => {
    const rara = { pasos: [null, 'texto', { paso: 'mecanismo', estado: 'raro', motivo: 7 }, { paso: 'exposicion' }], resumen: 5, coherente: 'no', motivoCoherencia: null } as unknown as RutaTerapeuticaEvaluada;
    await render(<RutaTerapeutica paso={'inventado' as unknown as 'mecanismo'} ruta={rara} />);
    const pasos = [...nodo.querySelectorAll('.ruta-terapeutica li')];
    expect(pasos).toHaveLength(8);
    expect(pasos[0]!.getAttribute('data-estado')).toBe('no_comprobable');
    expect(pasos[0]!.className).toBe('actual');
    expect(nodo.querySelector('[data-ruta-resumen]')).toBeNull();
    await render(<RutaTerapeutica paso="mecanismo" ruta={{ pasos: 'nada' } as unknown as RutaTerapeuticaEvaluada} />);
    expect(nodo.querySelectorAll('.ruta-terapeutica li')).toHaveLength(8);
    expect(nodo.querySelector('[data-estado]')).toBeNull();
  });

  it('la tarjeta pasa la ruta de la hipótesis, también cuando no hay tarjeta', async () => {
    const h = hipConExperimento();
    h.tarjeta = null;
    h.ruta = rutaEvaluada();
    await render(<TarjetaDeHipotesis h={h} />);
    expect(nodo.textContent).toContain('ROSA2018 no pudo rellenar la tarjeta');
    expect(nodo.querySelector('[data-ruta-resumen]')).not.toBeNull();
    // Sin tarjeta, el paso actual es el declarado por la ruta.
    expect(nodo.querySelector('.ruta-terapeutica li.actual')!.textContent).toContain('Efecto funcional');
    h.ruta = null;
    await render(<TarjetaDeHipotesis h={h} />);
    expect(nodo.querySelector('.ruta-terapeutica')).toBeNull();
  });
});

function contratoCompleto(h: Hipotesis, extra: Partial<NonNullable<Hipotesis['experimento']>> = {}): Hipotesis {
  h.experimento = {
    ...h.experimento!,
    lecturas: [
      { nombre: 'Fosforilación de SYK en microglía', tipo: 'compromiso_diana', queConfirma: 'sube al menos un 30 % frente al vehículo', queRefuta: 'no cambia', control: 'vehículo', unidad: '% frente a control' },
      { nombre: 'Fagocitosis de amiloide', tipo: 'funcion_mecanismo', queConfirma: 'sube al menos un 25 %', queRefuta: 'no cambia o baja', control: 'microglía sin tratar', unidad: '%' },
      { nombre: 'Viabilidad', tipo: 'viabilidad', queConfirma: 'mayor del 80 %', queRefuta: 'menor del 60 %', control: '', unidad: '' },
    ],
    sistema: { tipo: 'ipsc', quePrueba: 'que activar TREM2 en microglía humana aumenta la fagocitosis', queNoRepresenta: '' },
    propositoBiomarcador: 'farmacodinamico_respuesta',
    nivelDesenlace: 'celular',
    puenteAlBeneficio: 'más fagocitosis de amiloide es el paso previo a menos placa; el beneficio clínico no se mide aquí',
    problemasContrato: ['Falta una lectura de seguridad: sin ella un efecto puede ser toxicidad.', 'El sistema no declara qué no representa.'],
    hashLecturas: 'f7eef51d0a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5',
    ...extra,
  };
  return h;
}

describe('ContratoDelExperimento', () => {
  it('la enmienda en inglés distingue las medidas experimentales de leer texto', async () => {
    fijarIdioma('en');
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1 });
    const original = JSON.stringify(h);
    await render(<ContratoDelExperimento h={h} />);
    await pulsar(boton('Amend')!);
    const form = nodo.querySelector('[data-enmienda-lectura]')!;
    expect(form.querySelector('select')?.getAttribute('aria-label')).toBe('Readout field to amend');
    expect([...form.querySelectorAll('input')].map((el) => el.getAttribute('aria-label'))).toEqual(['New readout text', 'Reason for amending the readout']);
    expect(form.textContent).toContain('Record a readout amendment');
    expect(form.textContent).not.toContain('reading');
    expect(JSON.stringify(h)).toBe(original);
  });

  it('pinta las lecturas con sus etiquetas, el sistema con su límite general, el propósito BEST, el nivel, el puente y los problemas', async () => {
    const h = contratoCompleto(hipConExperimento());
    await render(<ContratoDelExperimento h={h} />);
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')];
    expect(filas).toHaveLength(3);
    expect(filas[0]!.textContent).toContain('Fosforilación de SYK en microglía');
    expect(filas[0]!.textContent).toContain('compromiso de diana');
    expect(filas[0]!.textContent).toContain('sube al menos un 30 %');
    expect(filas[1]!.textContent).toContain('función o mecanismo');
    expect(filas[2]!.textContent).toContain('sin control declarado');
    // Nunca la clave con guiones bajos.
    expect(nodo.textContent).not.toContain('compromiso_diana');
    expect(nodo.textContent).not.toContain('funcion_mecanismo');
    expect(nodo.textContent).not.toContain('farmacodinamico_respuesta');
    // La definición del tipo va en el title del chip.
    expect(titulos().some((t) => t.includes('la intervención llegó a la diana'))).toBe(true);
    expect(nodo.textContent).toContain('células iPSC');
    expect(nodo.textContent).toContain('Qué prueba: que activar TREM2');
    expect(nodo.textContent).toContain('no declarado; límite general de este sistema: no reproduce la edad');
    expect(nodo.textContent).toContain('farmacodinámico o de respuesta');
    expect(nodo.textContent).toContain('Nivel del desenlace');
    expect(nodo.textContent).toContain('celular');
    expect(nodo.textContent).toContain('más fagocitosis de amiloide');
    const problemas = [...nodo.querySelectorAll('.supuesto-aviso')].map((x) => x.textContent);
    expect(problemas).toEqual(['Falta una lectura de seguridad: sin ella un efecto puede ser toxicidad.', 'El sistema no declara qué no representa.']);
    expect(nodo.textContent).toContain('f7eef51d0a3b4c5d');
    // Sin prerregistrar no se enmienda.
    expect(boton('Enmendar')).toBeUndefined();
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
    expect(todoElTexto()).not.toMatch(GUION_LARGO);
  });

  it('un registro antiguo (solo ensayo, confirma y refuta) se enseña como una lectura derivada, dicha como tal, y sin experimento no pinta nada', async () => {
    const h = hipConExperimento();
    h.experimento = { ...h.experimento!, confirma: 'GFAP se altera antes que NfL', refuta: 'NfL se altera antes o a la vez', controles: 'no portadores de R47H' };
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.textContent).toContain('no declara lecturas separadas');
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')];
    expect(filas).toHaveLength(1);
    expect(filas[0]!.textContent).toContain('biomarcador');
    expect(filas[0]!.textContent).toContain('GFAP se altera antes que NfL');
    expect(filas[0]!.textContent).toContain('no portadores de R47H');
    expect(nodo.textContent).toContain('No declarado: el experimento no dice en qué sistema');
    expect(nodo.textContent).toContain('Propósito del biomarcador (BEST)');
    expect(nodo.textContent).toContain('No declarado. BEST es la clasificación');
    h.experimento = null;
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.textContent).toBe('');
    await render(<ContratoDelExperimento h={{ ...h, experimento: 'texto' as unknown as Hipotesis['experimento'] }} />);
    expect(nodo.textContent).toBe('');
  });

  it('no se rompe con lecturas basura ni con un tipo fuera del vocabulario, y lo dice sin guiones bajos', async () => {
    const h = hipConExperimento();
    h.experimento = {
      ...h.experimento!,
      lecturas: [null, 'texto', 42, { nombre: 'Rara', tipo: 'nivel_de_algo', queConfirma: 'x', queRefuta: 'y' }, { nombre: 7, tipo: 'biomarcador' }] as unknown as NonNullable<Hipotesis['experimento']>['lecturas'],
      sistema: [1, 2] as unknown as NonNullable<Hipotesis['experimento']>['sistema'],
      propositoBiomarcador: 'inventado' as unknown as NonNullable<Hipotesis['experimento']>['propositoBiomarcador'],
      problemasContrato: ['ok', null, 3] as unknown as string[],
    };
    await render(<ContratoDelExperimento h={h} />);
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')];
    expect(filas.length).toBeGreaterThanOrEqual(1);
    expect(nodo.textContent).toContain('nivel de algo');
    expect(nodo.textContent).not.toContain('nivel_de_algo');
    expect([...nodo.querySelectorAll('.supuesto-aviso')]).toHaveLength(1);
    expect(nodo.textContent).toContain('No declarado: el experimento no dice en qué sistema');
  });

  it('con resultado pinta el veredicto por lectura y destaca la lectura del negativo cuando refuta o queda inconcluso', async () => {
    const resultado: ResultadoExperimento = {
      veredicto: 'refuta',
      resultado: 'La diana se fosforiló pero la fagocitosis no cambió.',
      motivo: 'El criterio de refutación se cumplió en la lectura de efecto.',
      limitaciones: '',
      cifras: [
        { nombre: 'Fosforilación de SYK en microglía', valor: '+41 %' },
        { nombre: 'Fagocitosis de amiloide', valor: '+2 %' },
      ],
      exploratorio: '',
      fecha: 1,
      fichero: 'datos.csv',
      veredictosPorLectura: [
        { lectura: 'Fosforilación de SYK en microglía', tipo: 'compromiso_diana', veredicto: 'confirma', motivo: '+41 % supera el 30 % del criterio', cifras: ['Fosforilación de SYK en microglía = +41 %'] },
        { lectura: 'Fagocitosis de amiloide', tipo: 'funcion_mecanismo', veredicto: 'refuta', motivo: '+2 % no llega al 25 %; cumple "no cambia"', cifras: ['Fagocitosis de amiloide = +2 %'] },
        { lectura: 'Viabilidad', tipo: 'viabilidad', veredicto: 'no_evaluable', motivo: 'ninguna cifra la nombra', cifras: [] },
      ],
      lecturaDelNegativo: { rama: 'diana_comprometida_sin_efecto', explicacion: 'La intervención llegó a la diana (SYK fosforilado) y el efecto no apareció: el negativo cuestiona el mecanismo, no el ensayo.' },
    };
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, resultado });
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.textContent).toContain('Veredicto por lectura');
    const tablas = nodo.querySelectorAll('table.tabla');
    expect(tablas).toHaveLength(2);
    const filas = [...tablas[1]!.querySelectorAll('tbody tr')];
    expect(filas[0]!.textContent).toContain('confirma');
    expect(filas[1]!.textContent).toContain('refuta');
    expect(filas[2]!.textContent).toContain('no evaluable');
    expect(filas[2]!.textContent).toContain('ninguna cifra la nombra');
    const negativo = nodo.querySelector('[data-lectura-negativo]')!;
    expect(negativo.getAttribute('data-lectura-negativo')).toBe('destacada');
    expect(negativo.className).toContain('criterio-mal');
    expect(negativo.textContent).toContain('La diana se tocó y el efecto no apareció');
    expect(negativo.textContent).toContain('cuestiona el mecanismo');
    // Con resultado ya no se enmienda nada.
    expect(boton('Enmendar')).toBeUndefined();
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
    // Con veredicto confirma el negativo no se destaca.
    h.experimento!.resultado = { ...resultado, veredicto: 'confirma', lecturaDelNegativo: { rama: null, explicacion: 'no es un negativo' } };
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.querySelector('[data-lectura-negativo]')!.getAttribute('data-lectura-negativo')).toBe('discreta');
  });

  it('enmienda una lectura solo cuando está prerregistrado y sin resultado, con motivo, siempre por la acción del almacén (sin camino de reserva)', async () => {
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, estado: 'asignado', laboratorio: 'FLENI' });
    const accion = vi.fn();
    almacen.acciones = { enmendarLectura: accion };
    await render(<ContratoDelExperimento h={h} />);
    const botones = [...nodo.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Enmendar');
    expect(botones).toHaveLength(3);
    expect(nodo.querySelector('[data-enmienda-lectura]')).toBeNull();
    await pulsar(botones[1]!);
    const form = nodo.querySelector('[data-enmienda-lectura]')!;
    expect(form.textContent).toContain('Fagocitosis de amiloide');
    const registrar = boton('Registrar enmienda de la lectura')!;
    expect(registrar.disabled).toBe(true);
    const [texto, motivo] = [...form.querySelectorAll('input')];
    await escribir(form.querySelector('select')!, 'queRefuta');
    await escribir(texto!, 'baja o no cambia');
    expect(registrar.disabled).toBe(true);
    await escribir(motivo!, 'el criterio anterior no cubría una bajada');
    expect(registrar.disabled).toBe(false);
    await pulsar(registrar);
    // La acción del almacén (que aplica el reducer y manda el POST) recibe la lectura, el campo, el texto y el motivo; el reducer local no se llama aparte.
    expect(accion).toHaveBeenCalledWith(h.id, 1, 'queRefuta', 'baja o no cambia', 'el criterio anterior no cubría una bajada');
    expect(almacen.aplicar).not.toHaveBeenCalled();
    expect(nodo.querySelector('[data-enmienda-lectura]')).toBeNull();
    await pulsar([...nodo.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Enmendar')[0]!);
    const form2 = nodo.querySelector('[data-enmienda-lectura]')!;
    await escribir([...form2.querySelectorAll('input')][0]!, 'sube al menos un 20 %');
    await escribir([...form2.querySelectorAll('input')][1]!, 'ajuste de potencia');
    await pulsar(boton('Registrar enmienda de la lectura')!);
    expect(accion).toHaveBeenCalledWith(h.id, 0, 'queConfirma', 'sube al menos un 20 %', 'ajuste de potencia');
    expect(accion).toHaveBeenCalledTimes(2);
    // Una lectura derivada de los criterios antiguos no se enmienda desde aquí.
    h.experimento = { ...h.experimento!, lecturas: [], confirma: 'x', refuta: 'y' };
    await render(<ContratoDelExperimento h={h} />);
    expect(boton('Enmendar')).toBeUndefined();
    expect(nodo.textContent).toContain('se enmienda desde los campos de texto');
  });
});

function perfil(capas: unknown): PerfilDiana {
  return {
    diana: 'TREM2',
    identificadores: { simbolo: 'TREM2', nombre: 'triggering receptor expressed on myeloid cells 2', ensembl: 'ENSG00000095970', uniprot: 'Q9NZC2', entrez: '54209', gencode: null },
    capas: capas as CapaPerfilDiana[],
    resumen: 'TREM2: de 5 capas, 3 con registro (genética humana, expresión en tejido, literatura), 1 sin nada en las bases (farmacología), 1 sin poder comprobar (expresión por tipo celular); dirección genética - (menos función de la diana, más riesgo). Sin puntuación combinada: cada capa responde a una pregunta distinta.',
    registro: [],
    consultadoEn: 1,
    contexto: 'microglía',
    version: 2,
  };
}

const capa = (c: CapaPerfilDiana['capa'], estado: CapaPerfilDiana['estado'], detalle: string, direccion: '+' | '-' | null = null, fuentes: string[] = []): CapaPerfilDiana => ({ capa: c, estado, detalle, direccion, fuentes, registro: [], datos: {} });

describe('PerfilDeLaDiana', () => {
  it('pinta seis filas con su chip, el detalle, la dirección solo en genética y el resumen encima', async () => {
    const h = hipConExperimento();
    h.perfilDiana = perfil([
      capa('genetica_humana', 'presente', 'GWAS Catalog: 12 asociaciones con el Alzheimer; ClinVar: R47H patogénica', '-', ['Open Targets', 'GWAS Catalog', 'ClinVar']),
      capa('expresion_tejido', 'presente', 'HPA: detectada en corteza y hipocampo', null, ['HPA']),
      capa('expresion_celular', 'no_pude_comprobar', 'HPA no respondió (tiempo agotado)', null, ['HPA']),
      capa('farmacologia', 'ausente', 'ChEMBL: ningún compuesto contra la diana', null, ['ChEMBL']),
      capa('literatura', 'presente', 'PubTator: 1.240 publicaciones con Alzheimer', null, ['PubTator']),
    ]);
    await render(<PerfilDeLaDiana h={h} />);
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')];
    expect(filas).toHaveLength(6);
    expect(filas.map((f) => f.querySelector('.chip')!.textContent!.trim())).toEqual(['presente', 'presente', 'no pude comprobar', 'no pude comprobar', 'ausente', 'presente']);
    expect(filas[0]!.textContent).toContain('Genética humana');
    expect(filas[0]!.textContent).toContain('¿la genética humana vincula el gen con el Alzheimer?');
    expect(filas[0]!.textContent).toContain('menos función de la diana, más riesgo');
    expect(filas[0]!.textContent).toContain('Bases: Open Targets, GWAS Catalog, ClinVar');
    // La proteína y función no viene en el registro: no pude comprobar, nunca ausente.
    expect(filas[3]!.textContent).toContain('Proteína y función');
    expect(filas[3]!.textContent).toContain('El registro no trae esta capa');
    // Dirección solo en genética.
    expect(filas[1]!.textContent).not.toContain('Dirección del efecto');
    expect(filas[0]!.querySelector('.chip')!.className).toContain('chip-ok');
    expect(filas[2]!.querySelector('.chip')!.className).toContain('chip-aviso');
    const resumen = [...nodo.querySelectorAll('p')].find((p) => p.textContent?.startsWith('TREM2: de 5 capas'))!;
    expect(resumen.compareDocumentPosition(nodo.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nodo.textContent).toContain('Contexto: microglía');
    expect(nodo.textContent).toContain('versión 2');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
    expect(todoElTexto()).not.toMatch(GUION_LARGO);
  });

  it('sin perfil no pinta nada; con capas que no son lista o estados desconocidos, seis filas de no pude comprobar', async () => {
    const h = hipConExperimento();
    h.perfilDiana = null;
    await render(<PerfilDeLaDiana h={h} />);
    expect(nodo.textContent).toBe('');
    delete h.perfilDiana;
    await render(<PerfilDeLaDiana h={h} />);
    expect(nodo.textContent).toBe('');
    h.perfilDiana = perfil('texto');
    await render(<PerfilDeLaDiana h={h} />);
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')];
    expect(filas).toHaveLength(6);
    expect(filas.every((f) => f.querySelector('.chip')!.textContent!.trim() === 'no pude comprobar')).toBe(true);
    h.perfilDiana = perfil([null, 'x', { capa: 'literatura', estado: 'raro', detalle: 3, direccion: '+', fuentes: 'PubTator' }]);
    (h.perfilDiana as unknown as { identificadores: unknown }).identificadores = null;
    await render(<PerfilDeLaDiana h={h} />);
    const ultima = [...nodo.querySelectorAll('table.tabla tbody tr')][5]!;
    expect(ultima.querySelector('.chip')!.textContent!.trim()).toBe('no pude comprobar');
    expect(ultima.textContent).toContain('Sin detalle en el registro');
    expect(ultima.textContent).not.toContain('Dirección del efecto');
    expect(nodo.textContent).toContain('TREM2');
  });
});

// Segunda vuelta adversarial: lo que asume la integración y antes no hacía falta.
describe('adversario: enmiendas de lecturas', () => {
  it('la enmienda va a la lectura pulsada aunque el registro traiga entradas nulas o vacías delante: el índice es el de experimento.lecturas, no el de la tabla', async () => {
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, estado: 'asignado', laboratorio: 'FLENI' });
    const [a, b] = h.experimento!.lecturas!;
    // Un nulo y una lectura sin nombre ni criterios (el normalizador la descarta) delante de las dos reales.
    h.experimento!.lecturas = [null, { nombre: '', tipo: 'biomarcador', queConfirma: '', queRefuta: '', control: '', unidad: '' }, a!, b!] as unknown as NonNullable<Hipotesis['experimento']>['lecturas'];
    const accion = vi.fn();
    almacen.acciones = { enmendarLectura: accion };
    await render(<ContratoDelExperimento h={h} />);
    const botones = [...nodo.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'Enmendar');
    expect(botones).toHaveLength(2);
    await pulsar(botones[0]!);
    const form = nodo.querySelector('[data-enmienda-lectura]')!;
    expect(form).not.toBeNull();
    expect(form.textContent).toContain('Fosforilación de SYK en microglía');
    expect(form.textContent).not.toContain('lectura 1»');
    await escribir([...form.querySelectorAll('input')][0]!, 'sube al menos un 20 %');
    await escribir([...form.querySelectorAll('input')][1]!, 'ajuste de potencia');
    await pulsar(boton('Registrar enmienda de la lectura')!);
    // El reducer y el servidor indexan experimento.lecturas tal como está guardado: la primera lectura real es la tercera entrada.
    expect(accion).toHaveBeenCalledWith(h.id, 2, 'queConfirma', 'sube al menos un 20 %', 'ajuste de potencia');
  });

  it('al cambiar de hipótesis se cierra el formulario y se vacía lo escrito: nada de lo tecleado para una pasa a la otra', async () => {
    const a = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, estado: 'asignado', laboratorio: 'FLENI' });
    const b = structuredClone(a);
    b.id = 'hip-otra';
    await render(<ContratoDelExperimento h={a} />);
    await pulsar([...nodo.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'Enmendar')[1]!);
    const form = nodo.querySelector('[data-enmienda-lectura]')!;
    await escribir(form.querySelector('select')!, 'control');
    await escribir([...form.querySelectorAll('input')][0]!, 'texto de la primera');
    await escribir([...form.querySelectorAll('input')][1]!, 'motivo de la primera');
    await render(<ContratoDelExperimento h={b} />);
    expect(nodo.querySelector('[data-enmienda-lectura]')).toBeNull();
    await pulsar([...nodo.querySelectorAll('button')].filter((x) => x.textContent?.trim() === 'Enmendar')[1]!);
    const form2 = nodo.querySelector('[data-enmienda-lectura]')!;
    expect([...form2.querySelectorAll('input')].map((i) => i.value)).toEqual(['', '']);
    expect(form2.querySelector('select')!.value).toBe('queConfirma');
  });

  it('la lista de enmiendas lee la forma del servidor (lectura como texto y campo «lecturas[i].campo») y no se rompe con campos raros', async () => {
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, estado: 'asignado', laboratorio: 'FLENI' });
    h.experimento!.enmiendas = [
      { fecha: 1, quien: 'ana', campo: 'lecturas[1].queRefuta', lectura: 'Fagocitosis de amiloide', antes: 'no cambia o baja', despues: 'baja', motivo: 'ajuste' },
      { fecha: 2, quien: 'ana', campo: 'confirma', antes: 'x', despues: 'y', motivo: 'm' },
      { fecha: 3, quien: 'ana', campo: 'constructor', lectura: { indice: 0, nombre: '', campo: 'constructor' }, antes: null, despues: undefined, motivo: 'm' },
      { fecha: 4, quien: 'ana', campo: 'lecturas[0].unidad', antes: '', despues: 'pg/mL', motivo: 'm' },
    ] as unknown as NonNullable<Hipotesis['experimento']>['enmiendas'];
    await render(<ProtocoloYEnmiendas h={h} ahora={Date.now()} />);
    const items = [...nodo.querySelectorAll('.lista-plana li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('lectura «Fagocitosis de amiloide», refuta si');
    expect(items[0]).not.toContain('lecturas[1]');
    expect(items[1]).toContain('criterio de confirmación');
    expect(items[2]).not.toContain('function');
    expect(items[3]).toContain('lectura 1, unidad');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });
});

describe('adversario: registros basura en el resultado y en la ruta', () => {
  it('veredictos por lectura y lectura del negativo basura no tumban la ficha ni sacan funciones del prototipo', async () => {
    const resultado = {
      veredicto: 'refuta',
      resultado: 'x',
      motivo: 'y',
      limitaciones: '',
      cifras: [],
      exploratorio: '',
      fecha: 1,
      fichero: null,
      veredictosPorLectura: [null, 'x', { veredicto: 'constructor', tipo: 7, cifras: 'no', motivo: null }],
      lecturaDelNegativo: { rama: 'raro', explicacion: 5 },
    } as unknown as ResultadoExperimento;
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, resultado });
    await render(<ContratoDelExperimento h={h} />);
    const tablas = nodo.querySelectorAll('table.tabla');
    expect(tablas).toHaveLength(2);
    const filas = [...tablas[1]!.querySelectorAll('tbody tr')];
    expect(filas).toHaveLength(1);
    expect(filas[0]!.textContent).toContain('constructor');
    expect(filas[0]!.textContent).not.toContain('function');
    expect([...filas[0]!.querySelectorAll('.chip')].every((c) => !c.className.includes('function'))).toBe(true);
    expect(nodo.textContent).toContain('Sin explicación en el registro.');
    // Con lecturaDelNegativo como texto tampoco.
    h.experimento!.resultado = { ...resultado, lecturaDelNegativo: 'texto' as unknown as ResultadoExperimento['lecturaDelNegativo'] };
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.querySelector('[data-lectura-negativo]')).toBeNull();
  });

  it('una ruta guardada como texto o número no pinta la ruta en la tarjeta vacía', async () => {
    const h = hipConExperimento();
    h.tarjeta = null;
    h.ruta = 'texto' as unknown as RutaTerapeuticaEvaluada;
    await render(<TarjetaDeHipotesis h={h} />);
    expect(nodo.querySelector('.ruta-terapeutica')).toBeNull();
    expect(nodo.textContent).not.toContain('Ruta terapéutica');
    h.ruta = 7 as unknown as RutaTerapeuticaEvaluada;
    await render(<TarjetaDeHipotesis h={h} />);
    expect(nodo.querySelector('.ruta-terapeutica')).toBeNull();
  });
});

// M-32 y S-19 (17 de septiembre de 2026): el hash congelado que se enseña es el
// del prerregistro (enmiendas[0].hashAntes), no el recalculado; y el coste
// facturado por el gateway se suma desde las corridas cuando el servidor lo guardó.
describe('hash congelado frente a vigente, y factura del gateway', () => {
  it('hashCongelado es el hashAntes de la primera enmienda (o el propio hashLecturas sin enmiendas); hashVigente el último hashDespues o el recalculado', async () => {
    const { hashCongelado, hashVigente } = await import('./Rosa2018');
    const { hashLecturas } = await import('../datos/acciones');
    const lecturas = [{ nombre: 'GFAP en plasma', tipo: 'biomarcador' as const, queConfirma: 'sube 20 %', queRefuta: 'no sube', control: 'sin tratar', unidad: 'pg/mL' }];
    const congelado = hashLecturas({ lecturas });
    const sinEnmiendas = { hashLecturas: congelado, enmiendas: [], lecturas };
    expect(hashCongelado(sinEnmiendas)).toBe(congelado);
    expect(hashVigente(sinEnmiendas)).toBe(congelado);
    // Tras una enmienda del servidor: hashLecturas ya es el nuevo; el congelado vive en hashAntes.
    const nuevas = [{ ...lecturas[0]!, queConfirma: 'sube 30 %' }];
    const nuevo = hashLecturas({ lecturas: nuevas });
    const enmendado = { hashLecturas: nuevo, lecturas: nuevas, enmiendas: [{ fecha: 1, quien: 'p', campo: 'lecturas[0].queConfirma', lectura: 'GFAP en plasma', antes: 'sube 20 %', despues: 'sube 30 %', motivo: 'm', hashAntes: congelado, hashDespues: nuevo }] };
    expect(hashCongelado(enmendado)).toBe(congelado);
    expect(hashVigente(enmendado)).toBe(nuevo);
    expect(hashVigente(enmendado)).not.toBe(hashCongelado(enmendado));
    // Registros raros: enmiendas sin hash, enmiendas que no son lista, sin hash.
    expect(hashCongelado({ hashLecturas: congelado, enmiendas: [{ fecha: 1, quien: 'p', campo: 'protocolo', antes: '', despues: 'x', motivo: 'm' }] })).toBe(congelado);
    expect(hashCongelado({ hashLecturas: '', enmiendas: 'x' as never })).toBeNull();
    expect(hashCongelado({ hashLecturas: undefined, enmiendas: [null as never] })).toBeNull();
    expect(hashVigente({ hashLecturas: undefined, enmiendas: undefined, lecturas: 7 as never })).toBe(hashLecturas({ lecturas: 7 }));
  });

  it('la ficha del contrato enseña el hash congelado del prerregistro y avisa de que las lecturas se enmendaron después', async () => {
    const h = contratoCompleto(hipConExperimento(), { prerregistradoEn: 1, estado: 'asignado', laboratorio: 'FLENI' });
    const { hashLecturas } = await import('../datos/acciones');
    const congelado = hashLecturas(h.experimento);
    h.experimento!.hashLecturas = congelado;
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.textContent).toContain(`Hash de las lecturas congelado al prerregistrar: ${congelado.slice(0, 16)}`);
    expect(nodo.textContent).not.toContain('se enmendaron después');
    // El servidor recalculó el hash tras una enmienda: el congelado sigue siendo el de antes.
    const lecturas = h.experimento!.lecturas!.map((l, i) => (i === 0 ? { ...l, queConfirma: 'otro criterio' } : l));
    const nuevo = hashLecturas({ ...h.experimento, lecturas });
    h.experimento = { ...h.experimento!, lecturas, hashLecturas: nuevo, enmiendas: [{ fecha: 2, quien: 'p', campo: 'lecturas[0].queConfirma', lectura: 'x', antes: 'a', despues: 'otro criterio', motivo: 'm', hashAntes: congelado, hashDespues: nuevo }] };
    await render(<ContratoDelExperimento h={h} />);
    expect(nodo.textContent).toContain(`Hash de las lecturas congelado al prerregistrar: ${congelado.slice(0, 16)}`);
    expect(nodo.textContent).toContain(`se enmendaron después: hash actual ${nuevo.slice(0, 16)}`);
    expect(nodo.textContent).not.toContain(`congelado al prerregistrar: ${nuevo.slice(0, 16)}`);
  });

  it('facturadoPorGateway suma gasto.usdReal de las corridas de la investigación y dice cuántas lo traen; null si ninguna', async () => {
    const { facturadoPorGateway } = await import('./Rosa2018');
    const corridas = [
      { investigacionId: 'inv-1', gasto: { usd: 26.79, usdReal: 12.71 } },
      { investigacionId: 'inv-1', gasto: { usd: 19.16, usdReal: 10.75, usdEsEstimado: true } },
      { investigacionId: 'inv-1', gasto: { usd: 5 } },
      { investigacionId: 'inv-2', gasto: { usd: 1, usdReal: 1 } },
      null,
      { investigacionId: 'inv-1', gasto: null },
    ] as never;
    const f = facturadoPorGateway(corridas, 'inv-1')!;
    expect(f.usd).toBeCloseTo(23.46, 5);
    expect(f.conFactura).toBe(2);
    expect(f.total).toBe(4);
    expect(f.estimado).toBeCloseTo(50.95, 5);
    expect(f.mixto).toBe(true);
    expect(facturadoPorGateway(corridas, 'inv-3')).toBeNull();
    expect(facturadoPorGateway([{ investigacionId: 'inv-1', gasto: { usd: 5 } }] as never, 'inv-1')).toBeNull();
    expect(facturadoPorGateway('x' as never, 'inv-1')).toBeNull();
  });
});
