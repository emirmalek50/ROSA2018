import { beforeEach, describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { ConclusionHipotesis, Decision, Ejecucion, EntradaTranscripcion, EstadoRosa, EventoDecisionHipotesisLab, EventoLab, EventoRevisionRegistroLab, Iteracion, RevisionRegistro } from '../datos/tipos';
import type { Evidencia } from './evidencia';
import { fijarIdioma } from './idioma';
import { datosDelLaboratorio } from './labVivo';
import { eventoLabValido } from './peliculaLab';

function caso(eventos: EventoLab[] = []) {
  const estado = structuredClone(estadoDeMuestra());
  estado.conexion = 'en_linea'; estado.solicitudes = []; estado.incidencias = [];
  const inv = estado.investigaciones[0]!;
  const corrida = { ...estado.corridas.find(c => c.investigacionId === inv.id)!, id: 'corrida-propia', estado: 'en_marcha' as const,
    iteracionActual: 1, terminadaEn: null, planificando: false };
  const original = estado.iteraciones[0]!;
  const iteracion: Iteracion = { ...original, id: 'iteracion-propia', corridaId: corrida.id, numero: 1, terminadaEn: null,
    resumen: '', revisionRegistro: null, planAprobado: true,
    plan: [{ ...original.plan[0]!, id: 'paso-propio', tipo: 'hipotesis', estado: 'en_curso' }],
    pistas: [{ ...original.pistas[0]!, id: 'pista-propia', iteracionId: 'iteracion-propia', pasoId: 'paso-propio', tipo: 'modelo',
      titulo: 'Generar y revisar hipótesis', fuente: 'ROSA2018', estado: 'en_curso', resumen: '',
      transcripcion: eventos.map((eventoLab, n): EntradaTranscripcion => ({ t: n + 1, texto: 'La misma frase en todas las etapas', tipo: 'nota', eventoLab })) }] };
  const hipotesis = { ...estado.hipotesis.find(h => h.investigacionId === inv.id)!, id: 'hip-propia', investigacionId: inv.id, version: 1,
    titulo: 'Un título que también usa otra hipótesis', conclusion: null };
  estado.corridas = [corrida]; estado.iteraciones = [iteracion]; estado.hipotesis = [hipotesis]; estado.decisiones = []; estado.ejecuciones = [];
  return { estado, inv, corrida, iteracion, hipotesis,
    datos: (evidencia: Evidencia | null = null, opciones: { pasada?: boolean } = {}) => datosDelLaboratorio(estado, inv, corrida, iteracion, { ...opciones, evidencia }) };
}
function decision(etapa: EventoDecisionHipotesisLab['etapa'] = 'killer', cambios: Partial<EventoDecisionHipotesisLab> = {}): EventoDecisionHipotesisLab {
  return { tipo: 'decision_hipotesis', hipotesisId: 'hip-propia', version: 1, etapa, estado: 'terminado', decision: 'retener',
    comprobaciones: ['La misma cohorte y unidades'], hechoIds: [], origen: 'juez', modelo: 'modelo-verificado', ...cambios };
}
function revision(etapa: EventoRevisionRegistroLab['etapa'], cambios: Partial<EventoRevisionRegistroLab> = {}): EventoRevisionRegistroLab {
  return { tipo: 'revision_registro', iteracionId: 'iteracion-propia', etapa, estado: 'terminado', vuelta: 1, totalHallazgos: 0,
    hallazgos: [], comprobaciones: [], origen: 'sin_verificar', modelo: 'modelo-redactor', ...cambios };
}
function conclusion(f: ReturnType<typeof caso>, version = 1): ConclusionHipotesis {
  return { corridaId: f.corrida.id, iteracionId: f.iteracion.id, version, certeza: 'baja', direccion: 'mixta', conclusion: 'La evidencia es limitada',
    factores: [], base: { afirmaciones: 1, sostenidas: 0, fuentes: 1, datos: 0, interpretaciones: 0 }, enunciado: 'La evidencia podría apoyar la hipótesis',
    aFavor: [], enContra: [], loMasFragil: 'Una cohorte', subiria: 'Una réplica independiente', bajaria: 'Evidencia opuesta',
    noComprobado: [], cambio: null, fechaBusqueda: null, fecha: 12, iteracion: 1 };
}
function registro(f: ReturnType<typeof caso>, cambios: Partial<Decision> = {}): Decision {
  return { id: 'decision-propia', investigacionId: f.inv.id, corridaId: f.corrida.id, iteracionId: f.iteracion.id,
    hipotesisId: f.hipotesis.id, version: 1, etapa: 'killer_1', decision: 'suspender', motivo: 'La misma frase en todas las etapas',
    comprobaciones: [], queHariaFalta: '', quien: 'modelo-verificado', fecha: 12, auditoria: null, ...cambios };
}
function ejecucion(f: ReturnType<typeof caso>, cambios: Partial<Ejecucion> = {}): Ejecucion {
  return { id: 'ejecucion-propia', investigacionId: f.inv.id, corridaId: f.corrida.id, iteracionId: f.iteracion.id, sintetico: true,
    hipotesisId: f.hipotesis.id, planId: 'plan-congelado', tipo: 'hipotesis', codigo: 'CÓDIGO INTERNO',
    entorno: { python: '3.12', paquetes: [] }, semilla: 7, hashDatos: 'datos', hashPlan: 'plan', inicio: 12, fin: 30,
    estado: 'completado', runtime: 'local_sintetico', red: 'deshabilitada', codigoSalida: 0, duracionS: 18,
    salida: 'LOG INTERNO', error: 'ERROR INTERNO', resultados: { tau: '4,2 pg/mL', diferencia: '-0,2 pg/mL' },
    baseline: { tau: '4,4 pg/mL' }, controlNegativo: { diferencia: '0 pg/mL' },
    repeticiones: [{ semilla: 8, resultados: { diferencia: '-0,1 pg/mL' } }, { semilla: 9, resultados: { diferencia: '-0,3 pg/mL' } }],
    interpretacion: { estado: 'no_evaluable', resumen: 'La tabla sintética no permite concluir eficacia' },
    plausibilidadVerificada: false, auditoria: { veredicto: 'no_valido', comprobaciones: [], motivo: 'Solo datos sintéticos', quien: 'auditor', fecha: 31 }, ...cambios };
}
function evidencia(f: ReturnType<typeof caso>): Evidencia {
  return { corridaId: f.corrida.id, version: 1, consultas: [], fuentes: [], afirmaciones: [{ id: 'af-propia', texto: 'Asociación observada',
    cita: 'PMID 123, tabla 2', veredicto: 'parcial', motivo: 'Solo una parte', entidadDistinta: false, tipo: 'literatura', tema: 'MAPT',
    fuenteId: 'fuente-no-cargada', localizador: 'tabla 2', iteracion: 1 }] };
}

beforeEach(() => fijarIdioma('es'));

describe('material real de cada etapa de la película', () => {
  it('preserva cada etapa y versión aunque todos los textos y títulos coincidan', () => {
    const f = caso([decision('revision_inicial'), decision('supuestos'), decision('killer'), decision('killer', { version: 2 }),
      decision('killer', { hipotesisId: 'hip-distinta' })]);
    const p = f.datos().pelicula!;
    expect(p.etapas!.tribunal.map(e => [e.dato.hipotesisId, e.dato.version, e.dato.etapa])).toEqual([
      ['hip-propia', 1, 'revision_inicial'], ['hip-propia', 1, 'supuestos'], ['hip-propia', 1, 'killer'], ['hip-propia', 2, 'killer'], ['hip-distinta', 1, 'killer']]);
    expect(new Set(p.etapas!.tribunal.map(e => e.id)).size).toBe(5);
    expect(p.etapas!.tribunal[3]!.material.hipotesis).toBeNull();
    expect(p.etapas!.tribunal[4]!.material.hipotesis).toBeNull();
  });

  it('solo adjunta decisiones y conclusiones con la versión y los tres IDs correctos', () => {
    const f = caso([decision()]);
    f.estado.hipotesis[0]!.conclusion = conclusion(f);
    f.estado.decisiones = [registro(f), registro(f, { id: 'otra-corrida', corridaId: 'corrida-ajena' }),
      registro(f, { id: 'otra-iteracion', iteracionId: 'iteracion-ajena' }), registro(f, { id: 'otra-version', version: 2 }),
      registro(f, { id: 'otra-investigacion', investigacionId: 'inv-ajena' }), registro(f, { id: 'historica', corridaId: undefined, iteracionId: undefined })];
    const material = f.datos().pelicula!.etapas!.tribunal[0]!.material;
    expect(material.registros.map(d => d.id)).toEqual(['decision-propia']); expect(material.conclusion?.certeza).toBe('baja');
    f.estado.hipotesis[0]!.conclusion!.version = 2;
    expect(f.datos().pelicula!.etapas!.tribunal[0]!.material.conclusion).toBeNull();
    f.estado.hipotesis[0]!.conclusion = { ...conclusion(f), corridaId: undefined, iteracionId: undefined };
    expect(f.datos().pelicula!.etapas!.tribunal[0]!.material.conclusion).toBeNull();
  });

  it('una decisión por regla conserva su origen sin representar a un juez de modelo', () => {
    const f = caso([decision('viabilidad', { origen: 'regla', modelo: null })]);
    expect(f.datos().pelicula!.etapas!.tribunal[0]).toMatchObject({ sala: 'r4', agentes: [], dato: { origen: 'regla', modelo: null } });
    expect(f.datos().activos).not.toContain('Juez de viabilidad');
  });

  it('el resultado conserva unidades, controles, repeticiones y auditoría adversa sin filtrar código ni logs', () => {
    const f = caso([{ tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'terminado', sintetico: true }]);
    f.estado.ejecuciones = [ejecucion(f)];
    const material = f.datos().pelicula!.etapas!.analisis[0]!.material.ejecucion!;
    expect(material).toMatchObject({ estado: 'completado', sintetico: true, plausibilidadVerificada: false,
      resultados: { tau: '4,2 pg/mL', diferencia: '-0,2 pg/mL' }, baseline: { tau: '4,4 pg/mL' }, controlNegativo: { diferencia: '0 pg/mL' },
      repeticiones: [{ semilla: 8, resultados: { diferencia: '-0,1 pg/mL' } }, { semilla: 9, resultados: { diferencia: '-0,3 pg/mL' } }],
      interpretacion: { estado: 'no_evaluable' }, auditoria: { veredicto: 'no_valido' } });
    const texto = JSON.stringify(material);
    expect(texto).not.toContain('INTERNO'); expect(material).not.toHaveProperty('codigo'); expect(material).not.toHaveProperty('salida');
    expect(material).not.toHaveProperty('error'); expect(material).not.toHaveProperty('entorno');
  });

  it.each(['no_ejecutado', 'error_tecnico', 'tiempo_agotado'] as const)('el estado %s no se convierte en un resultado científico positivo', estado => {
    const f = caso([{ tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'fallido', sintetico: false }]);
    f.estado.ejecuciones = [ejecucion(f, { estado, sintetico: false, resultados: {}, interpretacion: null, auditoria: null })];
    expect(f.datos().pelicula!.etapas!.analisis[0]!.material.ejecucion).toMatchObject({ estado, resultados: {}, interpretacion: null, auditoria: null, sintetico: false });
  });

  it.each(['corrida', 'iteracion', 'investigacion', 'historia', 'sintetico'] as const)('no enlaza una ejecución por su título ni por coincidencias parciales de %s', cambio => {
    const f = caso([{ tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'terminado', sintetico: true }]);
    const e = ejecucion(f);
    if (cambio === 'corrida') e.corridaId = 'otra-corrida';
    if (cambio === 'iteracion') e.iteracionId = 'otra-iteracion';
    if (cambio === 'investigacion') e.investigacionId = 'otra-investigacion';
    if (cambio === 'historia') { delete e.corridaId; delete e.iteracionId; }
    if (cambio === 'sintetico') e.sintetico = false;
    f.estado.ejecuciones = [e];
    expect(f.datos().pelicula!.etapas!.analisis[0]!.material.ejecucion).toBeNull();
  });

  it('asigna el hecho y sus afirmaciones solo mediante los IDs guardados y declara las no cargadas', () => {
    const f = caso([{ tipo: 'asignacion_hecho', hechoId: 'hecho-propio', afirmacionIds: ['af-propia', 'af-no-cargada'], estado: 'fundido', enunciado: 'Texto anterior del evento' }]);
    const original = f.estado.hechos[0]!;
    f.estado.hechos = [{ ...original, id: 'hecho-propio', investigacionId: f.inv.id, enunciado: 'Texto actual del hecho', afirmacionIds: ['af-propia', 'af-no-cargada'] },
      { ...original, id: 'hecho-ajeno', investigacionId: 'otra-investigacion', enunciado: 'Texto anterior del evento' }];
    const e = evidencia(f);
    e.afirmaciones.push({ ...e.afirmaciones[0]!, id: 'af-no-cargada', iteracion: 2 });
    const h = f.datos(e).pelicula!.etapas!.hechos[0]!;
    expect(h.dato.enunciado).toBe('Texto anterior del evento'); expect(h.material.hecho?.enunciado).toBe('Texto actual del hecho');
    expect(h.material.afirmaciones.map(a => a.id)).toEqual(['af-propia']); expect(h.material.afirmacionIdsNoCargadas).toEqual(['af-no-cargada']);
    f.estado.hechos[0]!.investigacionId = 'otra-investigacion';
    expect(f.datos(e).pelicula!.etapas!.hechos[0]!.material.hecho).toBeNull();
  });

  it('reparar el texto no cierra hallazgos abiertos o rebatidos ni reduce el total a la lista acotada', () => {
    const hallazgo = { id: 'hallazgo-propio', clase: 'contradiccion', gravedad: 'alta', estado: 'rebatido', origen: 'regla', detalle: 'La etapa no produjo datos' };
    const f = caso([revision('revision', { totalHallazgos: 25, hallazgos: [hallazgo], origen: 'mixta' }),
      revision('reparacion', { totalHallazgos: 25, hallazgos: [hallazgo] }), revision('comprobacion_reparacion', { totalHallazgos: 25, hallazgos: [hallazgo], origen: 'regla', modelo: null }), revision('resumen')]);
    const registro: RevisionRegistro = { hallazgos: [{ id: 'hallazgo-propio', clase: 'contradiccion_con_registro', gravedad: 'alta', estado: 'rebatido', origen: 'regla', detalle: hallazgo.detalle, arregloFalso: true }],
      porRegla: 1, juez: null, resumen: 'La publicación sigue retenida', vueltas: [{ vuelta: 1, estado: 'rechazada', motivo: 'No cambia el hecho original' }] };
    f.iteracion.revisionRegistro = registro;
    const p = f.datos().pelicula!.etapas!;
    expect(p.revision.map(r => r.dato.etapa)).toEqual(['revision', 'reparacion', 'comprobacion_reparacion', 'resumen']);
    expect(p.revision[0]!.dato.totalHallazgos).toBe(25); expect(p.revision[0]!.dato.hallazgos).toHaveLength(1);
    expect(p.revision[1]!.agentes).toEqual(['Rehacedor']); expect(p.revision[2]!.agentes).toEqual([]);
    expect(p.registroRevisionActual!.hallazgos[0]).toMatchObject({ estado: 'rebatido', arregloFalso: true });
    expect(p.revision.every(r => r.material.registroActual?.vueltas?.[0]?.estado === 'rechazada')).toBe(true);
  });

  it('un dossier antiguo sigue accesible sin fabricar etapa, modelo ni hallazgo con ID nuevo', () => {
    const f = caso(); f.iteracion.revisionRegistro = { hallazgos: [{ clase: 'contradiccion_con_registro', gravedad: 'alta', origen: 'regla', detalle: 'Sin identificador antiguo' }], porRegla: 1, juez: null, resumen: 'Pendiente' };
    const p = f.datos().pelicula!.etapas!;
    expect(p.revision).toEqual([]); expect(p.registroRevisionActual).toEqual(f.iteracion.revisionRegistro);
    expect(p.registroRevisionActual!.hallazgos[0]).not.toHaveProperty('id');
  });

  it('rechaza metadatos ajenos y payloads con campos privados sin ocultar la línea original', () => {
    const f = caso([revision('revision', { iteracionId: 'iteracion-ajena' })]);
    expect(f.datos().pelicula!.etapas!.revision).toEqual([]); expect(f.datos().actividad[0]!.texto).toBe('La misma frase en todas las etapas');
    expect(eventoLabValido({ ...decision(), codigo: 'un código privado' })).toBe(false);
    expect(eventoLabValido({ ...revision('revision'), totalHallazgos: 0, hallazgos: [{ id: 'h', clase: 'c', gravedad: 'g', estado: 'e', origen: 'regla', detalle: 'd' }] })).toBe(false);
    expect(eventoLabValido({ ...decision(), version: true })).toBe(false);
    expect(eventoLabValido({ ...decision(), origen: 'parece_juez' })).toBe(false);
  });

  it('mantiene la foto de procedencia explícita y no deduce juez de palabras como «revisado»', () => {
    const f = caso(); const e = evidencia(f);
    e.afirmaciones[0]!.motivo = 'El juez lo revisó';
    expect(f.datos(e).afirmaciones![0]).not.toHaveProperty('procedenciaVeredicto');
    e.afirmaciones[0]!.procedenciaVeredicto = { origen: 'regla', modelo: null, comprobaciones: ['Localizador exacto'] };
    const a = f.datos(e).afirmaciones![0]!;
    expect(a.procedenciaVeredicto).toEqual({ origen: 'regla', modelo: null, comprobaciones: ['Localizador exacto'] });
    a.procedenciaVeredicto!.comprobaciones.push('Otra'); expect(e.afirmaciones[0]!.procedenciaVeredicto.comprobaciones).toHaveLength(1);
  });

  it('las etapas nuevas activan y liberan a su actor sin depender de la pista meta todavía abierta', () => {
    const f = caso([revision('reparacion', { estado: 'en_curso' })]);
    f.iteracion.pistas[0]!.tipo = 'modelo'; f.iteracion.pistas[0]!.titulo = 'Meta-revisión y panorama';
    expect(f.datos().activos).toEqual(['Rehacedor']); expect(f.datos().salas.r6).toBe('ahora');
    f.iteracion.pistas[0]!.transcripcion.push({ t: 2, tipo: 'resultado', texto: 'Sin palabras especiales', eventoLab: revision('reparacion') });
    expect(f.datos().activos).toEqual([]); expect(f.datos().actividad[0]!.abierta).toBe(false);
    f.iteracion.pistas[0]!.transcripcion.push({ t: 3, tipo: 'accion', texto: 'Sin palabras especiales', eventoLab: revision('comprobacion_reparacion', { estado: 'en_curso', origen: 'juez' }) });
    expect(f.datos().activos).toEqual(['Revisor de la reparación']);
  });

  it('las fases secuenciales de un análisis no dejan al programador trabajando al empezar la auditoría', () => {
    const f = caso([{ tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'ejecutando', sintetico: true },
      { tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'interpretando', sintetico: true },
      { tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'auditando', sintetico: true }]);
    expect(f.datos().actividad.map(a => a.abierta)).toEqual([false, false, true]); expect(f.datos().activos).toEqual(['Auditor del análisis']);
  });

  it('revisión inicial y supuestos paralelos mantienen solo la tarea que no terminó', () => {
    const f = caso([decision('revision_inicial', { estado: 'en_curso' }), decision('supuestos', { estado: 'en_curso' }), decision('revision_inicial')]);
    expect(f.datos().activos).toEqual(['Evaluador de supuestos']); expect(f.datos().actividad.map(a => a.abierta)).toEqual([false, true, false]);
  });

  it('puede planificar N+1 antes de crear su iteración sin atribuirlo a la anterior', () => {
    const f = caso(); f.corrida.planificando = true;
    Object.assign(f.corrida, { planificandoIteracion: 2 });
    const d = f.datos(); expect(d).toMatchObject({ planificando: true, planificandoIteracion: 2 }); expect(d.activos).toContain('Planificador');
    const inicial = datosDelLaboratorio(f.estado, f.inv, f.corrida, null);
    expect(inicial.planificando).toBe(true); expect(inicial.iteracion).toBeNull();
    f.corrida.estado = 'esperando_plan' as typeof f.corrida.estado;
    expect(datosDelLaboratorio(f.estado, f.inv, f.corrida, null).planificando).toBe(true);
    f.corrida.planificando = false;
    expect(f.datos().planificando).toBe(false); expect(f.datos()).not.toHaveProperty('planificandoIteracion');
  });

  it('planificación antigua, ajena, desconectada o pausada no activa al planificador', () => {
    const f = caso(); f.corrida.planificando = true; Object.assign(f.corrida, { planificandoIteracion: 2 });
    f.corrida.iteracionActual = 2;
    expect(f.datos(null, { pasada: true }).planificando).toBe(false);
    expect(f.datos().planificando).toBe(false);
    f.corrida.iteracionActual = 1; f.estado.conexion = 'sin_conexion';
    expect(f.datos().planificando).toBe(false);
    f.estado.conexion = 'en_linea'; f.corrida.estado = 'pausada' as typeof f.corrida.estado;
    expect(f.datos().planificando).toBe(false);
    f.corrida.estado = 'en_marcha'; f.corrida.investigacionId = 'otra-investigacion';
    const d = f.datos(); expect(d.planificando).toBe(false); expect(d.activos).not.toContain('Planificador');
  });

  it('la proyección no modifica el estado y sus materiales no mantienen referencias mutables', () => {
    const f = caso([decision(), { tipo: 'analisis', ejecucionId: 'ejecucion-propia', estado: 'terminado', sintetico: true }]);
    f.estado.ejecuciones = [ejecucion(f)]; f.estado.decisiones = [registro(f)];
    const antes: EstadoRosa = structuredClone(f.estado), p = f.datos().pelicula!;
    expect(f.estado).toEqual(antes);
    p.etapas!.tribunal[0]!.material.registros[0]!.motivo = 'Cambio visual';
    p.etapas!.analisis[0]!.material.ejecucion!.repeticiones[0]!.resultados.diferencia = '100 mg';
    p.etapas!.tribunal[0]!.dato.comprobaciones.push('Cambio visual');
    expect(f.estado).toEqual(antes);
  });
});
