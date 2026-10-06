// @vitest-environment jsdom
// La ficha de la hipótesis montada de verdad (createRoot y act, como
// Arbol.test.tsx): bajo la cabecera va la franja del ranking con su frase en
// llano, hay una sección de explicaciones alternativas, la ruta evaluada
// pone su resumen antes que los pasos, el contrato del experimento y el
// perfil de la diana se pintan, y un registro antiguo sin ninguna de esas
// claves sigue abriéndose.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fijarIdioma } from '../lib/idioma';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Hipotesis as Hip } from '../datos/tipos';
import { Hipotesis } from './Hipotesis';

vi.mock('../datos/almacen', () => ({ acciones: new Proxy({}, { get: () => () => undefined }), aplicar: () => undefined, cabeceras: () => ({}), modoActual: () => 'muestra', QUIEN: 'la persona responsable', avisar: () => undefined, conectar: async () => 'servidor' }));

beforeAll(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
});

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

/** Deja pasar el frame y el temporizador que viene detrás: desde el 19 de
 *  septiembre de 2026 la pantalla pinta primero su silueta (esqueleto) y el
 *  contenido llega tras el siguiente pintado (lib/diferido.ts). */
async function esperarPintado(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function montar(e: EstadoRosa, id: string) {
  const inv = e.investigaciones[0]!;
  await act(async () => root.render(<Hipotesis inv={inv} estado={e} ahora={Date.now()} detalleId={id} cajonAbierto={false} setCajonAbierto={() => undefined} />));
  await esperarPintado();
}

it('los niveles y las revisiones se traducen en la ficha real, conservando los valores canónicos', async () => {
  const e = structuredClone(estadoDeMuestra()), h = e.hipotesis[0]!;
  h.evidenciaEstadistica = 'debil';
  h.revisiones = [{ fecha: 1, quien: 'Emir Malek', accion: 'no_puedo_juzgar', nota: '', aCiegas: false }];
  const original = JSON.stringify(h);
  fijarIdioma('en');
  await montar(e, h.id);
  expect(nodo.textContent).toContain('Weak');
  expect(nodo.textContent).toContain('Unable to assess');
  expect(nodo.textContent).not.toContain('no puedo juzgar');
  expect(JSON.stringify(h)).toBe(original);
  fijarIdioma('es');
  await montar(e, h.id);
  expect(nodo.textContent).toContain('Débil');
  expect(nodo.textContent).toContain('No puedo juzgar');
});

it('el experimento asignado y el sello se traducen sin alterar hash, hora o archivo', async () => {
  const e = structuredClone(estadoDeMuestra());
  const h = e.hipotesis.find((x) => x.experimento)!;
  h.experimento!.estado = 'asignado';
  h.experimento!.laboratorio = 'INTEC';
  h.experimento!.prerregistradoEn = 1;
  h.experimento!.selloExterno = { algoritmo: 'sha256', hash: 'abcdef123456', pedidoEn: 1, ok: true, testigos: ['FreeTSA', 'DigiCert'], primeraHora: '2026-10-06T10:23:00Z', error: null, sellos: [] };
  const original = JSON.stringify(h);
  fijarIdioma('en');
  await montar(e, h.id);
  expect(nodo.textContent).toContain('Assigned to INTEC');
  expect(nodo.textContent).toContain('FreeTSA and DigiCert');
  const sello = [...nodo.querySelectorAll('[title]')].find((x) => x.getAttribute('title')?.startsWith('sha256'))!;
  expect(sello.getAttribute('title')).toContain('Timestamp signed by FreeTSA and DigiCert: 2026-10-06T10:23:00Z');
  expect(sello.getAttribute('title')).toContain('sha256 abcdef123456');
  expect(sello.getAttribute('title')).toContain('openssl ts -verify');
  expect(JSON.stringify(h)).toBe(original);
  h.experimento!.estado = 'datos_recibidos';
  h.experimento!.ficheroDatos = 'datos-ensayo.csv';
  await montar(e, h.id);
  expect(nodo.textContent).toContain('Data received: datos-ensayo.csv');
  fijarIdioma('es');
  await montar(e, h.id);
  expect(nodo.textContent).toContain('Datos recibidos: datos-ensayo.csv');
});

function conTodo(): { e: EstadoRosa; h: Hip } {
  const e = structuredClone(estadoDeMuestra());
  const h = e.hipotesis.find((x) => x.experimento)!;
  h.alternativas = [
    { texto: 'La función renal explica a la vez el GFAP y el NfL en plasma.', clase: 'confusor', queLaDistinguiria: 'Ajustar por filtrado glomerular o medir en LCR.', iteracion: 12 },
    { texto: 'La neurodegeneración ya en marcha sube el GFAP; no lo anticipa.', clase: 'causa_inversa', queLaDistinguiria: 'Muestras anteriores al primer síntoma.', iteracion: 12 },
  ];
  h.ruta = {
    hipotesisId: h.id,
    pasos: [
      { paso: 'mecanismo', estado: 'cubierto', evidencia: [], motivo: '2 afirmaciones sostenidas' },
      { paso: 'opciones_intervencion', estado: 'vacio', evidencia: [], motivo: 'sin intervención nombrada' },
      { paso: 'compromiso_diana', estado: 'vacio', evidencia: [], motivo: 'nada' },
      { paso: 'efecto_funcional', estado: 'vacio', evidencia: [], motivo: 'nada' },
      { paso: 'selectividad_toxicidad', estado: 'vacio', evidencia: [], motivo: 'nada' },
      { paso: 'exposicion', estado: 'parcial', evidencia: [], motivo: 'plasma como matriz' },
      { paso: 'replicacion_independiente', estado: 'no_comprobable', evidencia: [], motivo: 'ninguna fuente nombra su cohorte: no pude comprobar' },
      { paso: 'evidencia_poblacion', estado: 'cubierto', evidencia: [], motivo: '1 cohorte con n = 212' },
    ],
    siguiente: 'opciones_intervencion',
    cubiertos: 2,
    declarado: 'mecanismo',
    coherente: true,
    motivoCoherencia: 'la tarjeta declara «Mecanismo» y el primer paso vacío es «Opciones de intervención»: el paso declarado no va por delante de la evidencia',
    porEstado: { cubierto: 2, parcial: 1, vacio: 4, no_comprobable: 1 },
    resumen: '2 de 8 pasos cubiertos (Mecanismo y Evidencia en la población); 1 parcial (Entrega y exposición); sin poder comprobar: Replicación independiente; siguiente paso: Opciones de intervención. La tarjeta declara «Mecanismo» y el primer paso vacío es «Opciones de intervención»: el paso declarado no va por delante de la evidencia.',
  };
  h.tarjeta = { diana: 'GFAP', celula: 'astrocito', etapa: 'preclínica', intervencion: '', direccion: 'sin_intervencion', prediccionFalsable: 'GFAP se altera antes que NfL', riesgos: [], pasoRuta: 'mecanismo' } as unknown as Hip['tarjeta'];
  h.perfilDiana = {
    diana: 'GFAP',
    identificadores: { simbolo: 'GFAP', nombre: 'glial fibrillary acidic protein', ensembl: 'ENSG00000131095', uniprot: 'P14136', entrez: '2670', gencode: 'ENSG00000131095.14' },
    capas: [
      { capa: 'genetica_humana', estado: 'ausente', detalle: 'GWAS Catalog y ClinVar sin asociación con el Alzheimer', direccion: null, fuentes: ['Open Targets'], registro: [], datos: {} },
      { capa: 'expresion_tejido', estado: 'presente', detalle: 'HPA: enriquecida en cerebro', direccion: null, fuentes: ['HPA', 'GTEx'], registro: [], datos: {} },
      { capa: 'expresion_celular', estado: 'presente', detalle: 'HPA: astrocitos', direccion: null, fuentes: ['HPA'], registro: [], datos: {} },
      { capa: 'proteina_funcion', estado: 'presente', detalle: 'UniProt: filamento intermedio de astrocitos', direccion: null, fuentes: ['UniProt'], registro: [], datos: {} },
      { capa: 'farmacologia', estado: 'ausente', detalle: 'ChEMBL: sin compuestos', direccion: null, fuentes: ['ChEMBL'], registro: [], datos: {} },
      { capa: 'literatura', estado: 'no_pude_comprobar', detalle: 'PubTator no respondió', direccion: null, fuentes: ['PubTator'], registro: [], datos: {} },
    ],
    resumen: 'GFAP: de 6 capas, 3 con registro (expresión en tejido, expresión por tipo celular, proteína y función), 2 sin nada en las bases (genética humana, farmacología), 1 sin poder comprobar (literatura). Sin puntuación combinada: cada capa responde a una pregunta distinta.',
    registro: [],
    consultadoEn: Date.now() - 60_000,
    contexto: 'astrocito',
    version: 1,
  };
  h.experimento = {
    ...h.experimento!,
    lecturas: [
      { nombre: 'GFAP en plasma', tipo: 'biomarcador', queConfirma: 'se altera antes que NfL', queRefuta: 'se altera después o a la vez', control: 'no portadores', unidad: 'pg/mL' },
      { nombre: 'NfL en plasma', tipo: 'biomarcador', queConfirma: 'se altera después de GFAP', queRefuta: 'se altera antes', control: 'no portadores', unidad: 'pg/mL' },
    ],
    sistema: { tipo: 'observacional_humano', quePrueba: 'el orden temporal de dos marcadores en plasma', queNoRepresenta: 'no permite intervenir' },
    propositoBiomarcador: 'pronostico',
    nivelDesenlace: 'molecular',
    puenteAlBeneficio: '',
    problemasContrato: ['Falta una lectura de compromiso de diana.'],
  };
  return { e, h };
}

describe('la ficha de la hipótesis', () => {
  it('pinta la franja con su frase en llano, las alternativas, el resumen de la ruta antes que los pasos, el contrato y el perfil', async () => {
    const { e, h } = conTodo();
    await montar(e, h.id);
    // Franja bajo la cabecera, con la frase de qué la movería (explicar).
    const franja = nodo.querySelector('[role="group"][aria-label="Componentes del ranking, sin sumar"]')!;
    expect(franja).not.toBeNull();
    expect(franja.compareDocumentPosition(nodo.querySelector('h2')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // La explicación de por qué está donde está va plegada desde el 28 de
    // septiembre de 2026: era una frase de más de doce líneas que dominaba la
    // ficha por encima de la propia hipótesis. Sigue estando, con su rótulo.
    const explica = franja.parentElement!.querySelector('details.franja-explica')!;
    expect(explica).not.toBeNull();
    expect(explica.querySelector('summary')!.textContent).toContain('Qué le falta para subir');
    expect(explica.querySelector('p')!.textContent!.length).toBeGreaterThan(10);
    // Alternativas en su sección.
    expect(nodo.textContent).toContain('Explicaciones alternativas');
    expect(nodo.textContent).toContain('La función renal explica a la vez el GFAP y el NfL en plasma.');
    expect(nodo.textContent).toContain('Ajustar por filtrado glomerular');
    expect(nodo.textContent).toContain('Causa inversa');
    // Ruta: resumen antes que los pasos, y estados en los pasos.
    const resumen = nodo.querySelector('[data-ruta-resumen]')!;
    expect(resumen.textContent).toContain('2 de 8 pasos cubiertos');
    expect(resumen.compareDocumentPosition(nodo.querySelector('.ruta-terapeutica')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nodo.querySelectorAll('.ruta-terapeutica li[data-estado="vacio"]')).toHaveLength(4);
    // Contrato.
    const contrato = nodo.querySelector('[data-contrato-experimento]')!;
    expect(contrato.textContent).toContain('GFAP en plasma');
    expect(contrato.textContent).toContain('observacional en humanos');
    expect(contrato.textContent).toContain('pronóstico');
    expect(contrato.textContent).toContain('Falta una lectura de compromiso de diana.');
    expect(contrato.textContent).toContain('No declarado: el resultado, por sí solo, no habla de beneficio');
    // Perfil de la diana con sus seis chips.
    expect(nodo.textContent).toContain('Perfil de la diana');
    expect(nodo.textContent).toContain('¿en qué tipos celulares se expresa?');
    expect(nodo.textContent).toContain('GFAP: de 6 capas');
    expect(nodo.textContent).not.toContain('compromiso_diana');
    expect(nodo.textContent).not.toContain('observacional_humano');
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });

  it('un registro antiguo sin ruta, perfil, alternativas ni contrato se abre igual y dice los huecos como huecos', async () => {
    const e = structuredClone(estadoDeMuestra());
    const h = e.hipotesis.find((x) => x.experimento)!;
    delete h.ruta;
    delete h.perfilDiana;
    delete h.alternativas;
    h.tarjeta = null;
    await montar(e, h.id);
    expect(nodo.querySelector('[role="group"][aria-label="Componentes del ranking, sin sumar"]')).not.toBeNull();
    expect(nodo.textContent).toContain('ROSA2018 no ha escrito explicaciones alternativas');
    expect(nodo.querySelector('[data-ruta-resumen]')).toBeNull();
    expect(nodo.textContent).not.toContain('Perfil de la diana');
    // El contrato del experimento antiguo se enseña como lectura derivada.
    expect(nodo.querySelector('[data-contrato-experimento]')!.textContent).toContain('no declara lecturas separadas');
  });
});

describe('adversario: la ficha con las claves nuevas corruptas', () => {
  it('ruta, perfil, alternativas, lecturas y problemas guardados como texto o número se abren igual y se dicen como huecos', async () => {
    const e = structuredClone(estadoDeMuestra());
    const h = e.hipotesis.find((x) => x.experimento)!;
    h.ruta = 'texto' as unknown as Hip['ruta'];
    h.perfilDiana = 42 as unknown as Hip['perfilDiana'];
    h.alternativas = 'texto' as unknown as Hip['alternativas'];
    h.experimento = { ...h.experimento!, lecturas: 'texto', sistema: 'ipsc', propositoBiomarcador: 7, nivelDesenlace: null, puenteAlBeneficio: ['a', 'b'], problemasContrato: 'texto', hashLecturas: 5 } as unknown as Hip['experimento'];
    h.tarjeta = null;
    await montar(e, h.id);
    expect(nodo.querySelector('h2')).not.toBeNull();
    expect(nodo.querySelector('[data-ruta-resumen]')).toBeNull();
    expect(nodo.querySelector('.ruta-terapeutica')).toBeNull();
    expect(nodo.textContent).not.toContain('Perfil de la diana');
    expect(nodo.textContent).toContain('ROSA2018 no ha escrito explicaciones alternativas');
    const contrato = nodo.querySelector('[data-contrato-experimento]')!;
    // Sin lecturas legibles, los criterios antiguos valen como lectura derivada; el sistema escrito como texto se lee por el vocabulario.
    expect(contrato.textContent).toContain('no declara lecturas separadas');
    expect(contrato.textContent).toContain('células iPSC');
    expect(contrato.textContent).toContain('a b');
    expect(contrato.textContent).not.toContain('function');
    expect(nodo.textContent).not.toMatch(/\u2014/);
  });

  it('con procedencia y afirmaciones como texto la ficha no se cae en las piezas nuevas', async () => {
    const e = structuredClone(estadoDeMuestra());
    const h = e.hipotesis.find((x) => x.experimento)!;
    h.alternativas = [null, 'La edad explica las dos medidas.', { texto: 7, clase: 'raro', queLaDistinguiria: null }] as unknown as Hip['alternativas'];
    h.ruta = { pasos: 'nada', resumen: null, coherente: null } as unknown as Hip['ruta'];
    h.perfilDiana = { diana: null, identificadores: 'x', capas: null, resumen: 3, registro: null, consultadoEn: 'ayer', contexto: 4 } as unknown as Hip['perfilDiana'];
    await montar(e, h.id);
    expect(nodo.textContent).toContain('La edad explica las dos medidas.');
    expect(nodo.textContent).toContain('Perfil de la diana');
    const filas = [...nodo.querySelectorAll('table.tabla tbody tr')].filter((f) => f.textContent?.includes('no pude comprobar'));
    expect(filas.length).toBeGreaterThanOrEqual(6);
    expect(nodo.querySelector('[data-ruta-resumen]')).toBeNull();
  });
});

// 17 de septiembre de 2026: S-18 (casilla de datos sintéticos), S-09 (juicio
// pendiente por avería del modelo) y M-19 (un descarte que el Killer propuso
// y después retiró no sigue bloqueando la aceptación).
describe('la ficha con las reglas del 17 de septiembre', () => {
  it('la subida de datos del laboratorio lleva la casilla "sintéticos o de prueba" y enseña el chip cuando ya se marcó', async () => {
    const e = structuredClone(estadoDeMuestra());
    const h = e.hipotesis.find((x) => x.experimento)!;
    h.experimento = { ...h.experimento!, estado: 'asignado', laboratorio: 'FLENI', ficheroDatos: null, datosSinteticos: false };
    await montar(e, h.id);
    const casilla = [...nodo.querySelectorAll('label.interruptor')].find((l) => l.textContent?.includes('sintéticos o de prueba'))!;
    expect(casilla).toBeDefined();
    expect(casilla.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(nodo.textContent).not.toContain('Datos sintéticos o de prueba: no cuentan como evidencia');
    h.experimento = { ...h.experimento, estado: 'datos_recibidos', ficheroDatos: 'datos_gfap_nfl_sintetico.csv', datosSinteticos: true };
    await montar(structuredClone(e), h.id);
    expect(nodo.textContent).toContain('Datos sintéticos o de prueba: no cuentan como evidencia');
  });

  it('una suspensión técnica ("El juez no respondió") se enseña como pendiente de juicio en la ficha', async () => {
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id && x.estado === 'propuesta')!;
    h.decisionKiller = 'suspender';
    h.revisiones = [...h.revisiones, { fecha: Date.now(), quien: 'Rosa', accion: 'killer', nota: 'suspender: El juez no respondió: no se puede dar por revisada', aCiegas: false }];
    // La fila de la cola lo comprueba componentes/ColaHipotesis.test.tsx,
    // que es donde vive la lista desde el 1 de octubre de 2026.
    await montar(e, h.id);
    expect(nodo.textContent).toContain('Pendiente de juicio: el modelo no respondió');
    // Con la clave pública del servidor, igual, aunque la nota no lo diga.
    h.revisiones = h.revisiones.slice(0, -1);
    h.killerPendiente = { intentos: 2, motivo: 'la respuesta no se pudo leer' };
    await montar(structuredClone(e), h.id);
    expect(nodo.textContent).toContain('Pendiente de juicio: la respuesta no se pudo leer');
  });

  it('un hallazgo "El Killer propone descartarla" abierto se enseña atendido si la decisión vigente ya no es descartar, y deja de bloquear la aceptación', async () => {
    // Vive en la logica, no en la pantalla: la usan la fila de la cola y la ficha.
    const { hallazgosVigentes } = await import('../lib/hipotesis');
    const abierto = { id: 'x1', tipo: 'conclusion_no_sigue' as const, resumen: 'El Killer propone descartarla en este contexto', razonamiento: 'citas', estado: 'abierto' as const, respuestaDeRosa: null };
    const otro = { ...abierto, id: 'x2', resumen: 'Cita que no resuelve' };
    // Con descarte vigente, nada cambia.
    expect(hallazgosVigentes({ hallazgos: [abierto, otro], decisionKiller: 'descartar_en_contexto', version: 3 })).toEqual([abierto, otro]);
    // Con avanzar (o suspender) después, el de descarte pasa a atendido con su nota; el otro sigue abierto.
    const v = hallazgosVigentes({ hallazgos: [abierto, otro], decisionKiller: 'avanzar', version: 3 });
    expect(v[0]).toMatchObject({ id: 'x1', estado: 'atendido' });
    expect(v[0]!.respuestaDeRosa).toContain('versión 3');
    expect(v[0]!.respuestaDeRosa).toContain('avanza');
    expect(v[1]).toEqual(otro);
    // Sin decisión (la versión nueva aún no pasó por el Killer) o con "reformular" el
    // servidor no atiende el hallazgo (rosa/bucle/pasos.py solo lo hace con avanzar o
    // suspender): la ausencia de juicio no retira un descarte propuesto.
    expect(hallazgosVigentes({ hallazgos: [abierto], decisionKiller: null, version: 1 })[0]!.estado).toBe('abierto');
    expect(hallazgosVigentes({ hallazgos: [abierto], decisionKiller: undefined, version: 2 })[0]!.estado).toBe('abierto');
    expect(hallazgosVigentes({ hallazgos: [abierto], decisionKiller: 'reformular', version: 2 })[0]!.estado).toBe('abierto');
    expect(hallazgosVigentes({ hallazgos: [abierto], decisionKiller: 'suspender', version: 2 })[0]!.estado).toBe('atendido');
    // Un hallazgo ya atendido o descartado no se toca, y uno con respuesta propia la conserva.
    const atendido = { ...abierto, estado: 'atendido' as const, respuestaDeRosa: 'ya respondido' };
    expect(hallazgosVigentes({ hallazgos: [atendido], decisionKiller: 'avanzar', version: 2 })[0]).toEqual(atendido);
    // Registros raros: sin hallazgos, hallazgos que no son lista, entradas nulas.
    expect(hallazgosVigentes({ hallazgos: undefined as never, decisionKiller: 'avanzar' })).toEqual([]);
    expect(hallazgosVigentes({ hallazgos: [null as never, abierto], decisionKiller: 'avanzar' })[0]).toBeNull();
    // En la ficha: la sección Decisión ya no dice que un hallazgo bloquea, y la cola no lo cuenta como abierto.
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0]!;
    const h = e.hipotesis.find((x) => x.investigacionId === inv.id && x.estado === 'propuesta' && x.hallazgos.every((y) => y.estado !== 'abierto'))!;
    h.hallazgos = [abierto];
    h.decisionKiller = 'avanzar';
    await montar(e, h.id);
    expect(nodo.textContent).not.toContain('hallazgo del revisor sigue abierto');
    // El Revisor lo pinta como atendido (plegado, tono ok), no como abierto.
    const tarjetas = [...nodo.querySelectorAll('.hallazgo, .hallazgo-abierto, [data-hallazgo]')];
    expect(tarjetas.length === 0 || tarjetas.every((t) => !t.className.includes('mal'))).toBe(true);
  });
});

describe('el alcance de cada supuesto (regla 3, 23 de septiembre de 2026)', () => {
  /** La sección de supuestos es de detalle: en modo sencillo nace plegada. */
  async function abrirSupuestos() {
    // Exacto: «Supuestos causales» también lleva la palabra y va antes.
    const titulo = [...nodo.querySelectorAll('.seccion-plegar')].find((b) => b.textContent?.replace(/[▸▾]/g, '').trim() === 'Supuestos') as HTMLButtonElement | undefined;
    if (titulo && titulo.getAttribute('aria-expanded') === 'false') await act(async () => titulo.click());
  }

  it('dice si las fuentes tocaron el tema y dónde se respondería, que es lo que "sin evidencia" callaba', async () => {
    await montar(estadoDeMuestra(), 'hip-1');
    await abrirSupuestos();
    const notas = [...nodo.querySelectorAll('.supuesto-alcance')].map((x) => x.textContent);
    expect(notas).toContain('Las fuentes reunidas no hablan de esto · se respondería en el catálogo de una cohorte');
    expect(notas).toContain('Las fuentes tocan el tema, pero no lo resuelven · se respondería en la literatura');
    // Resuelto ya lo dice el estado: sin nota, salvo que haya cota.
    expect(nodo.querySelectorAll('.supuesto-alcance-resuelto')).toHaveLength(0);
  });

  it('enseña el límite de un nulo acotado', async () => {
    await montar(estadoDeMuestra(), 'hip-3');
    await abrirSupuestos();
    expect(nodo.textContent).toContain('Límite: si la pérdida de peso mueve el NfL, el efecto es menor que un 8 %');
  });

  it('a lo evaluado con una regla anterior no se le inventa alcance', async () => {
    await montar(estadoDeMuestra(), 'hip-2');
    await abrirSupuestos();
    expect(nodo.querySelectorAll('.supuesto').length).toBeGreaterThan(0);
    expect(nodo.querySelectorAll('.supuesto-alcance')).toHaveLength(0);
  });

  it('«no evaluado» se distingue de «no hay»', async () => {
    const e = structuredClone(estadoDeMuestra());
    const h = e.hipotesis.find((x) => x.id === 'hip-1')!;
    h.supuestos[2] = { ...h.supuestos[2]!, alcance: 'no_evaluado', dondeSeResponde: null, evidencia: 'No se pudo evaluar: el modelo no respondió (TimeoutError)' };
    await montar(e, 'hip-1');
    await abrirSupuestos();
    const nota = nodo.querySelector('.supuesto-alcance-no_evaluado');
    expect(nota?.textContent).toBe('No se pudo evaluar: no quiere decir que no haya');
  });
});
