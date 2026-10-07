// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { montarLaboratorio, type Laboratorio } from './motor';

let raiz: HTMLDivElement, lab: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;
function fotografia(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  c.busqueda = { ...c.busqueda, consultas: [] };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'iteracion-cadena', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'verificar', tipo: 'verificacion', titulo: 'Verificar MAPT', detalle: '', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i), foco: 'r2', activos: ['Juez'], actividad: [],
    pelicula: { eventos: [], ideas: [] }, afirmaciones: [{ id: 'afirmacion-real', texto: 'MAPT se midió en la cohorte indicada', articulo: 'Artículo original',
      cita: 'PMID 123, página 4', veredicto: 'parcial', caja: 'parcial', motivo: 'El resultado depende del subgrupo', biblioteca: 'PubMed', procedenciaVeredicto: { origen: 'juez', modelo: 'modelo de prueba', comprobaciones: [] } }] };
}
function montar(d: DatosLab) {
  lab = montarLaboratorio(raiz, d, { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true),
    ampliarPresupuesto: vi.fn(async () => true), resolverIncidencia: vi.fn(async () => true), verEnLaCorrida: vi.fn(), verNovedad: vi.fn() });
}
async function avanzar(segundos: number, observar: () => void = () => {}) {
  for (let n = 0; n < segundos * 10; n++) {
    tiempo += 100; frame(tiempo);
    for (let k = 0; k < 4; k++) await Promise.resolve();
    observar();
  }
}
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; lab = null; raiz = document.createElement('div'); document.body.append(raiz);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { lab?.desmontar(); raiz.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('un mismo papel conserva la afirmación y la cita desde el extractor hasta su caja real', async () => {
  const d = fotografia(); montar(d); const papeles = new Set<HTMLElement>(), etapas = new Set<string>(), sellos = new Set<Element>();
  await avanzar(35, () => {
    raiz.querySelectorAll<HTMLElement>('.lv-hoja-trazada').forEach(p => {
      papeles.add(p); etapas.add(p.dataset.etapa!);
      expect(p.dataset.afirmacion).toBe('afirmacion-real'); expect(p.title).toContain('PMID 123, página 4');
      if (p.dataset.etapa === 'caja') expect(p.dataset.veredicto).toBe('parcial');
    });
    raiz.querySelectorAll('.lv-sello').forEach(s => sellos.add(s));
    if (tiempo % 500 === 0) lab!.actualizar(d);
  });
  expect(papeles.size).toBe(1); expect([...etapas]).toEqual(['extractor', 'cinta', 'juez', 'caja']);
  expect(sellos.size).toBe(1); expect([...sellos][0]!.textContent).toBe('PARCIAL');
  expect(d.afirmaciones![0]!.veredicto).toBe('parcial'); expect(raiz.querySelectorAll('.lv-bub')).toHaveLength(0);
});

it('una afirmación pendiente no inicia el recorrido de una decisión ni genera un sello', async () => {
  const d = fotografia(); d.afirmaciones = d.afirmaciones!.map(a => ({ ...a, veredicto: 'sin_verificar', caja: 'otras' })); montar(d);
  await avanzar(25, () => {
    expect(raiz.querySelector('.lv-hoja-trazada')).toBeNull(); expect(raiz.querySelector('.lv-sello')).toBeNull();
  });
});

it('si se retira la decisión durante el viaje no deposita ni sella la versión anterior', async () => {
  const d = fotografia(); montar(d); await avanzar(3);
  expect(raiz.querySelector('.lv-hoja-trazada')?.getAttribute('data-etapa')).toBe('cinta');
  lab!.actualizar({ ...d, afirmaciones: d.afirmaciones!.map(a => ({ ...a, veredicto: 'sin_verificar', caja: 'otras' })) });
  let sello = false, caja = false;
  await avanzar(20, () => {
    sello ||= !!raiz.querySelector('.lv-sello'); caja ||= !!raiz.querySelector('.lv-hoja-trazada[data-etapa="caja"]');
  });
  expect(sello).toBe(false); expect(caja).toBe(false); expect(raiz.querySelector('.lv-hoja-trazada')).toBeNull();
});

it('la pausa retira la utilería sin dejar papeles ni sellos huérfanos', async () => {
  const d = fotografia(); montar(d); await avanzar(3); expect(raiz.querySelector('.lv-hoja-trazada')).not.toBeNull();
  lab!.actualizar({ ...d, trabajando: false, activos: [], estado: 'pausada' });
  await avanzar(8, () => { expect(raiz.querySelector('.lv-hoja-trazada')).toBeNull(); expect(raiz.querySelector('.lv-sello')).toBeNull(); });
});

it('la voz de IA acompaña el recorrido real del juez sin reiniciar el papel', async () => {
  const d = fotografia(); montar(d); await avanzar(3); const papel = raiz.querySelector('.lv-hoja-trazada');
  const turno: TurnoLaboratorio = { id: 'comentario-del-juez', temaId: 'comentario-real', iteracionId: 'iteracion-cadena', idioma: 'es', tipoConversacion: 'actividad',
    agente: 'Juez', destinatario: 'Asignador de evidencia', texto: 'Ojo, voy a revisar ese subgrupo.', fecha: Date.now(), modelo: 'prueba', materiales: [] };
  lab!.conversar([turno]); const papeles = new Set<Element>(), voces = new Set<string>(), sellos = new Set<Element>();
  await avanzar(30, () => {
    raiz.querySelectorAll('.lv-hoja-trazada').forEach(p => papeles.add(p));
    raiz.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach(p => voces.add(p.title));
    raiz.querySelectorAll('.lv-sello').forEach(s => sellos.add(s));
  });
  expect(papeles.size).toBe(1); expect([...papeles][0]).toBe(papel);
  expect(voces.has(turno.texto)).toBe(true); expect(sellos.size).toBe(1);
});

it('si se retira una decisión recién sellada no la deposita en la caja anterior', async () => {
  const d = fotografia(); montar(d); let retirada = false, depositada = false;
  await avanzar(25, () => {
    if (!retirada && raiz.querySelector('.lv-sello')) {
      retirada = true;
      lab!.actualizar({ ...d, afirmaciones: d.afirmaciones!.map(a => ({ ...a, veredicto: 'sin_verificar', caja: 'otras' })) });
    }
    depositada ||= !!raiz.querySelector('.lv-hoja-trazada[data-etapa="caja"]');
  });
  expect(retirada).toBe(true); expect(depositada).toBe(false);
  expect(raiz.querySelector('.lv-hoja-trazada')).toBeNull();
});

it('el juez vuelve andando a su mesa después de una charla interrumpida y retoma la lectura', async () => {
  const d = fotografia(); montar({ ...d, activos: [] });
  lab!.conversar([{ id: 'charla-antes-de-leer', temaId: 'tema-antes-de-leer', iteracionId: 'iteracion-cadena', idioma: 'es', tipoConversacion: 'companeros',
    agente: 'Juez', destinatario: 'Señalizador de sesgo', texto: 'Vale, luego lo reviso contigo.', fecha: Date.now(), modelo: 'prueba', materiales: [] }]);
  await avanzar(1);
  const juez = raiz.querySelector<HTMLElement>('[data-agente="Juez"]')!;
  const posicion = () => [...juez.style.transform.matchAll(/[-\d.]+(?=px)/g)].map(m => Number(m[0]));
  const fuera = juez.style.transform;
  lab!.conversar([], false); lab!.actualizar(d);
  expect(juez.style.transform).toBe(fuera);
  let anterior = posicion(), salto = 0; const sellos = new Set<Element>();
  await avanzar(25, () => {
    const ahora = posicion(); salto = Math.max(salto, Math.hypot(ahora[0]! - anterior[0]!, ahora[1]! - anterior[1]!)); anterior = ahora;
    raiz.querySelectorAll('.lv-sello').forEach(s => sellos.add(s));
    expect(raiz.querySelector('[data-agente="Juez"]')).toBe(juez);
  });
  expect(salto).toBeLessThan(10); expect(sellos.size).toBe(1);
});
