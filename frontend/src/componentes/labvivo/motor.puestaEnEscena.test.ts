// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { AnalisisVisualLab, AsignacionVisualLab, DecisionVisualLab, EventoVisualLab, RevisionVisualLab } from '../../lib/peliculaLab';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { fijarIdioma } from '../../lib/idioma';
import { montarLaboratorio, type Laboratorio } from './motor';
import { pasaPorJuez, seriesResultados } from './puestaEnEscena';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;
function fotografia(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'it-escena', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null, pistas: [],
    plan: [{ ...anterior.plan[0]!, id: 'paso-real', tipo: 'literatura', titulo: 'Buscar MAPT', detalle: '', estado: 'en_curso' }] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i),
    activos: [], actividad: [], pelicula: { eventos: [], ideas: [], etapas: { tribunal: [], hechos: [], analisis: [], revision: [] } } };
}
function contexto(d: DatosLab) { return { corridaId: d.identidad.split('/')[0]!, iteracionId: 'it-escena', pistaId: 'pista-real', fecha: 1 }; }
function montar(d: DatosLab, estadoPeticion = vi.fn()) {
  motor = montarLaboratorio(nodo, d, { conceder: async () => true, denegar: async () => true, aprobarPlan: async () => true,
    ampliarPresupuesto: async () => true, resolverIncidencia: async () => true, verEnLaCorrida: () => undefined, verNovedad: () => undefined, estadoPeticion });
  return estadoPeticion;
}
async function avanzar(segundos: number, observar: () => void = () => {}) {
  for (let j = 0; j < segundos * 10; j++) {
    tiempo += 100; frame(tiempo); for (let k = 0; k < 4; k++) await Promise.resolve(); observar();
  }
}
function agregar(d: DatosLab, e: EventoVisualLab): DatosLab { return { ...d, pelicula: { ...d.pelicula!, eventos: [e] } }; }
const papeles = () => [...nodo.querySelectorAll<HTMLElement>('.lv-expediente-viajero')];
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; motor = null; nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { motor?.desmontar(); nodo.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('las entregas conservan los datos de la corrida', () => {
  it('el libro sale de PubMed y llega al lector, sin sustituir al personaje entre fotos', async () => {
    const d = fotografia(); montar(d); const personaje = nodo.querySelector('[data-agente="Generador de consultas"]');
    const e: EventoVisualLab = { id: 'fuente:it-escena:PubMed', sala: 'r1', tipo: 'fuente', agentes: ['Generador de consultas'], texto: 'PubMed\nResultados: 27\nRelevantes: 5' };
    const foto = agregar({ ...d, fuentes: [{ nombre: 'PubMed', salen: 27, sirven: 5, fallo: false, consultas: 1 }] }, e);
    motor!.actualizar(foto); const vistos = new Set<HTMLElement>(), portadores = new Set<string>();
    await avanzar(45, () => {
      papeles().forEach(p => { vistos.add(p); if (p.dataset.portador) portadores.add(p.dataset.portador); expect(p.dataset.evento).toBe(e.id); });
      if (tiempo % 1000 === 0) motor!.actualizar(foto);
      expect(nodo.querySelector('[data-agente="Generador de consultas"]')).toBe(personaje);
    });
    expect(vistos.size).toBe(1); expect([...portadores]).toEqual(['Generador de consultas', 'Puntuador preguntas']);
  });

  it('escribe en la pizarra sin recuadros flotantes y mantiene el plan completo accesible', async () => {
    const d = fotografia(); montar(d);
    const lista = ['PubMed', 'Citas originales', 'Hipótesis rivales'].map((titulo, i) => ({ id: `paso-${i}`, titulo, detalle: `Detalle ${i}`, estado: 'pendiente' as const }));
    const e: EventoVisualLab = { id: 'plan:it-escena', sala: 'plan', tipo: 'plan', agentes: ['Planificador'], texto: 'Plan real' };
    motor!.actualizar(agregar({ ...d, pasos: { ...d.pasos, lista } }, e)); let transportado = false;
    await avanzar(60, () => {
      transportado ||= papeles().some(p => p.dataset.evento === e.id && !!p.dataset.portador);
      expect(nodo.querySelector('.lv-documento[data-sala="plan"]')).toBeNull();
      expect([...nodo.querySelectorAll('.lv-tag')].some(p => p.textContent?.includes('Paso '))).toBe(false);
    });
    expect(transportado).toBe(true);
    nodo.querySelector<HTMLButtonElement>('[aria-label="Abrir la pizarra del plan"]')!.click();
    expect([...nodo.querySelectorAll('.lv-o-pasos li b')].map(p => p.textContent)).toEqual(lista.map(p => p.titulo));
    expect([...nodo.querySelectorAll('.lv-o-pasos li small')].map(p => p.textContent)).toEqual(lista.map(p => p.detalle));
  });

  it('la asignación conserva los IDs de afirmaciones y el hecho exacto hasta el modelo', async () => {
    const d = fotografia(); montar(d);
    const af = { id: 'af-real', texto: 'Observación de MAPT', veredicto: 'sostenida' as const, caja: 'sostenida' as const, motivo: 'Se describe en el original', cita: 'Página 4', articulo: 'Original', biblioteca: null };
    const e: AsignacionVisualLab = { id: 'hecho-real', contexto: contexto(d), sala: 'r2', tipo: 'evidencia', agentes: ['Asignador de evidencia'], texto: 'Se incorporó la observación al modelo',
      dato: { tipo: 'asignacion_hecho', hechoId: 'mundo-real', afirmacionIds: [af.id], estado: 'nuevo', enunciado: af.texto },
      material: { hecho: null, afirmaciones: [af], afirmacionIdsNoCargadas: [] } };
    const foto = agregar(d, e); foto.pelicula!.etapas!.hechos = [e]; motor!.actualizar(foto);
    const etapas = new Set<string>();
    await avanzar(30, () => papeles().forEach(p => {
      expect(p.dataset.hecho).toBe('mundo-real'); expect(JSON.parse(p.dataset.afirmaciones!)).toEqual([af.id]);
      if (p.dataset.etapa) etapas.add(p.dataset.etapa);
    }));
    expect(etapas.has('modelo')).toBe(true); expect(nodo.querySelector<HTMLElement>('.lv-archivo-hechos')!.dataset.hecho).toBe('mundo-real');
  });

  it('el expediente del tablón llega al tribunal conservando hipótesis y versión', async () => {
    const d = fotografia(); montar(d);
    const e: DecisionVisualLab = { id: 'decision-real', contexto: contexto(d), sala: 'r4', tipo: 'revision', agentes: ['Revisor inicial'], texto: 'Revisión de la versión 3',
      dato: { tipo: 'decision_hipotesis', hipotesisId: 'hip-real', version: 3, etapa: 'revision_inicial', estado: 'terminado', decision: 'Cumple el filtro', origen: 'juez', modelo: 'modelo de prueba', comprobaciones: ['Pregunta delimitada'], hechoIds: [] },
      material: { hipotesis: { id: 'hip-real', titulo: 'Propuesta MAPT', version: 3 }, registros: [], conclusion: null } };
    const foto = agregar(d, e); foto.pelicula!.ideas = [{ hipotesisId: 'hip-real', titulo: 'Propuesta MAPT', enfoque: 'analogia' }]; foto.pelicula!.etapas!.tribunal = [e]; motor!.actualizar(foto);
    const portadores = new Set<string>(), hojas = new Set<HTMLElement>();
    await avanzar(70, () => papeles().forEach(p => {
      hojas.add(p); expect(p.dataset.hipotesis).toBe('hip-real'); expect(p.dataset.version).toBe('3'); if (p.dataset.portador) portadores.add(p.dataset.portador);
    }));
    expect(hojas.size).toBe(1); expect([...portadores]).toEqual(['Revisor inicial', 'Killer']);
  });

  it('muestra resultados, controles y series auténticas en el análisis; escapa el contenido', async () => {
    const d = fotografia(); montar(d);
    const e: AnalisisVisualLab = { id: 'analisis-real', contexto: contexto(d), sala: 'r5', tipo: 'analisis', agentes: ['Auditor del análisis'], texto: 'Auditoría del análisis',
      dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'auditando', sintetico: true }, material: { ejecucion: {
        id: 'ej-real', hipotesisId: 'hip-real', planId: 'plan-real', estado: 'completado', inicio: 1, fin: 2, runtime: 'local_sintetico', sintetico: true,
        resultados: { pendiente: '0.24', nota: '<img src=x onerror=alert(1)>' }, baseline: { pendiente: '0.01' }, controlNegativo: { pendiente: '-0.02' },
        repeticiones: [{ semilla: 3, resultados: { pendiente: '0.24' } }, { semilla: 9, resultados: { pendiente: '0.20' } }],
        interpretacion: { estado: 'efecto_detectado', resumen: 'Resultado del ensayo sintético' }, plausibilidadVerificada: true,
        auditoria: { veredicto: 'valido', motivo: 'Controles acordes al plan', quien: 'Auditor', fecha: 2, comprobaciones: [] },
      } } };
    const foto = agregar(d, e); foto.pelicula!.etapas!.analisis = [e]; motor!.actualizar(foto);
    const textos = new Set<string>(), grafos = new Set<string>();
    await avanzar(45, () => {
      nodo.querySelectorAll<HTMLElement>('.lv-documento').forEach(p => textos.add(p.title));
      nodo.querySelectorAll('.lv-serie svg').forEach(p => grafos.add(p.getAttribute('aria-label') ?? ''));
      expect(nodo.querySelector('img[src=x]')).toBeNull();
    });
    expect([...textos].some(t => t.includes('0.24') && t.includes('0.01') && t.includes('-0.02') && t.includes('Controles acordes al plan'))).toBe(true);
    expect([...grafos]).toEqual(['3: 0.24, 9: 0.2']);
    expect(seriesResultados({ ...e, dato: { ...e.dato, estado: 'programando' } })).toEqual([]);
  });

  it('el revisor camina por los hallazgos registrados y el resumen llega a la bandeja', async () => {
    const d = fotografia(); montar(d);
    const e: RevisionVisualLab = { id: 'revision-real', contexto: contexto(d), sala: 'r6', tipo: 'cierre', agentes: ['Revisor del registro'], texto: 'Revisión del registro',
      dato: { tipo: 'revision_registro', iteracionId: 'it-escena', etapa: 'revision', estado: 'terminado', vuelta: 0, origen: 'juez', modelo: 'modelo de prueba', comprobaciones: [], totalHallazgos: 2,
        hallazgos: ['Cita pendiente', 'Control por revisar'].map((detalle, i) => ({ id: `hallazgo-${i}`, detalle, clase: 'trazabilidad', gravedad: 'alta', estado: 'abierto', origen: 'registro' })) }, material: { registroActual: null } };
    const foto = agregar(d, e); foto.pelicula!.etapas!.revision = [e]; motor!.actualizar(foto);
    const vistos = new Set<string>();
    await avanzar(35, () => nodo.querySelectorAll<HTMLElement>('[data-hallazgo]').forEach(p => vistos.add(p.dataset.hallazgo!)));
    expect([...vistos]).toEqual(['hallazgo-0', 'hallazgo-1']);
    const resumen: EventoVisualLab = { id: 'resumen-real', sala: 'r6', tipo: 'cierre', agentes: ['Resumidor'], texto: 'Resumen de esta iteración, con sus límites' };
    motor!.actualizar(agregar(d, resumen)); await avanzar(45);
    const bandeja = nodo.querySelector<HTMLElement>('.lv-bandeja-recibida')!;
    expect(bandeja.hidden).toBe(false); expect(bandeja.title).toBe(resumen.texto); expect(bandeja.dataset.evento).toBe(resumen.id);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });
});

describe('no sustituye procedencia ni contexto por una animación', () => {
  it.each(['regla', undefined] as const)('no pone al juez a sellar una autoría %s', async origen => {
    const d = fotografia(); const af = { id: 'af-auto', texto: 'Afirmación sin cita resoluble', veredicto: 'no_sostenida' as const, caja: 'no_sostenida' as const, motivo: 'Regla de cita', cita: '', articulo: 'Artículo', biblioteca: null,
      ...(origen ? { procedenciaVeredicto: { origen, modelo: null, comprobaciones: ['Cita no resoluble'] } } : {}) };
    expect(pasaPorJuez(af)).toBe(false); montar({ ...d, activos: ['Juez'], afirmaciones: [af] });
    await avanzar(20); expect(nodo.querySelector('.lv-hoja-trazada')).toBeNull(); expect(nodo.querySelector('.lv-sello')).toBeNull();
  });

  it('el comentario inicial del planificador se ve antes de tener plan y desaparece al acabar la llamada', async () => {
    const d = fotografia(), planificando = { ...d, estado: 'esperando_plan' as const, trabajando: false, planificando: true, planificandoIteracion: 2, pasos: { ...d.pasos, aprobado: false, lista: [] } };
    montar(planificando); const t: TurnoLaboratorio = { id: 'apertura-plan', temaId: 'inicio-plan', iteracionId: `plan:${d.identidad.split('/')[0]}:2`, idioma: 'es',
      momento: 'inicio_tarea', tipoConversacion: 'actividad', agente: 'Planificador', destinatario: 'Misión, Áreas y Pregunta', texto: 'Voy a ordenar esta pregunta. ¿Miramos primero qué se sabe de MAPT?', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    motor!.conversar([t]); await avanzar(1); expect(nodo.querySelector('.lv-bub[data-turno]')?.textContent).toContain(t.texto);
    expect(nodo.querySelector('.lv-expediente-viajero')).toBeNull();
    motor!.actualizar({ ...planificando, planificando: false }); await avanzar(1);
    expect(nodo.querySelector('.lv-bub[data-turno]')).toBeNull();
  });

  it('informa al wrapper al abrir y cerrar la aprobación, para no generar voces tapadas', () => {
    const d = fotografia(); const callback = vi.fn(); montar({ ...d, trabajando: false, estado: 'esperando_plan', pide: {
      id: 'it-escena', clase: 'plan', quien: 'Planificador', titulo: '', detalle: '', alcances: [], requiereArgumentos: false,
    } }, callback);
    expect(callback).toHaveBeenLastCalledWith(true);
    nodo.querySelector<HTMLButtonElement>('.lv-pide [data-a="luego"]')!.click();
    expect(callback).toHaveBeenLastCalledWith(false);
  });
});
