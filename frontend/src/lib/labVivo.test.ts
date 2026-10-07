import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoCorrida, EntradaTranscripcion, EstadoRosa, Iteracion } from '../datos/tipos';
import type { AfirmacionEvidencia, Evidencia } from './evidencia';
import { datosDelLaboratorio } from './labVivo';

function caso(tipo = 'literatura', transcripcion: EntradaTranscripcion[] = [{ t: 1000, tipo: 'accion', texto: 'Consulta: MAPT' }]) {
  const e = estadoDeMuestra();
  const inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find((c) => c.investigacionId === inv.id)!, estado: 'en_marcha' as EstadoCorrida, iteracionActual: 1, terminadaEn: null };
  const original = e.iteraciones.find((i) => i.corridaId === c.id)!;
  const paso = { ...original.plan[0]!, id: 'paso-real', tipo, estado: 'en_curso' as const };
  const i: Iteracion = { ...original, id: 'iteracion-real', numero: 1, terminadaEn: null, resumen: '', revisionRegistro: null, plan: [paso], planAprobado: true, pistas: [{ ...original.pistas[0]!, id: 'pista-real', pasoId: paso.id, tipo: tipo === 'hipotesis' ? 'modelo' : 'literatura', estado: 'en_curso', fuente: 'PubMed', titulo: tipo === 'hipotesis' ? 'Generar y revisar hipótesis' : 'Búsqueda MAPT', resumen: '', transcripcion }] };
  const estado: EstadoRosa = { ...e, conexion: 'en_linea' as const, solicitudes: [], incidencias: [], iteraciones: [i], corridas: [c] };
  c.busqueda = { ...c.busqueda, consultas: [] };
  return { estado, inv, c, i, datos: () => datosDelLaboratorio(estado, inv, c, i) };
}

function cadena(corridaId: string, veredictos: AfirmacionEvidencia['veredicto'][]): Evidencia {
  return { corridaId, version: 10, consultas: [], fuentes: [], afirmaciones: veredictos.map((veredicto, n) => ({
    id: `af-real-${n}`, texto: `Afirmación del registro ${n}`, cita: `PMID ${n}, tabla 2`, veredicto,
    motivo: 'Motivo registrado', entidadDistinta: false, tipo: 'literatura', tema: 'MAPT', fuenteId: `fuente-${n}`,
    localizador: 'tabla 2', iteracion: 1,
  })) };
}

describe('las cajas cuentan las afirmaciones reales de la iteración', () => {
  it('muestra decisiones durante la verificación y cambia la caja al cambiar el veredicto', () => {
    const f = caso('verificacion', [{ t: 1, tipo: 'resultado', texto: 'Deterministas: 2 resueltas sin juez; 3 van al juez' }, { t: 2, tipo: 'resultado', texto: 'Juez: 1 de 3' }]);
    f.i.pistas[0]!.tipo = 'verificacion';
    const evidencia = cadena(f.c.id, ['sostenida', 'parcial', 'no_sostenida', 'sin_verificar', 'cita_no_resuelve']);
    const obtener = () => datosDelLaboratorio(f.estado, f.inv, f.c, f.i, { evidencia });
    const antes = obtener();
    expect(antes.juez).toEqual({ hechas: 1, total: 3, sinJuez: 2, veredictos: { sostenida: 1, parcial: 1, no_sostenida: 1, otras: 2 } });
    expect(antes.afirmaciones?.filter(a => a.caja === 'otras')).toHaveLength(2);
    evidencia.afirmaciones[0]!.veredicto = 'no_sostenida';
    evidencia.afirmaciones[3]!.veredicto = 'parcial';
    const despues = obtener();
    expect(despues.juez.veredictos).toEqual({ sostenida: 0, parcial: 2, no_sostenida: 2, otras: 1 });
    expect(despues.afirmaciones?.filter(a => a.caja === 'no_sostenida')).toHaveLength(2);
    expect(antes.juez.veredictos).toEqual({ sostenida: 1, parcial: 1, no_sostenida: 1, otras: 2 });
  });

  it('una cadena cargada vacía da ceros y prevalece sobre el resumen de otro intento', () => {
    const f = caso('verificacion');
    f.i.pistas[0]!.tipo = 'verificacion'; f.i.pistas[0]!.estado = 'hecha';
    f.i.pistas[0]!.resumen = '30 afirmaciones: 30 sostenida; 0 bloqueadas';
    const d = datosDelLaboratorio(f.estado, f.inv, f.c, f.i, { evidencia: cadena(f.c.id, []) });
    expect(d.afirmaciones).toEqual([]);
    expect(d.juez.veredictos).toEqual({ sostenida: 0, parcial: 0, no_sostenida: 0, otras: 0 });
  });

  it('sin cadena conserva el resumen válido, y sin resumen mantiene desconocidos los conteos', () => {
    const f = caso('verificacion'); f.i.pistas[0]!.tipo = 'verificacion';
    expect(f.datos().juez.veredictos).toBeNull();
    f.i.pistas[0]!.estado = 'hecha'; f.i.pistas[0]!.resumen = '3 afirmaciones: 1 sostenida, 1 parcial, 1 no sostenida; 1 bloqueadas';
    expect(f.datos().juez.veredictos).toEqual({ sostenida: 1, parcial: 1, no_sostenida: 1, otras: 0 });
  });

  it('filtra la iteración, rechaza otra corrida y nunca mezcla la cadena con la muestra', () => {
    const f = caso('verificacion'), evidencia = cadena(f.c.id, ['parcial']);
    evidencia.afirmaciones.push({ ...evidencia.afirmaciones[0]!, id: 'af-otra-iteracion', veredicto: 'sostenida', iteracion: 2 });
    const actual = datosDelLaboratorio(f.estado, f.inv, f.c, f.i, { evidencia });
    expect(actual.juez.veredictos).toEqual({ sostenida: 0, parcial: 1, no_sostenida: 0, otras: 0 });
    for (const corridaId of ['otra-corrida', f.c.id]) {
      const estado = corridaId === f.c.id ? { ...f.estado, conexion: 'muestra' as const } : f.estado;
      const d = datosDelLaboratorio(estado, f.inv, f.c, f.i, { evidencia: { ...evidencia, corridaId } });
      expect(d.afirmaciones).toBeNull(); expect(d.juez.veredictos).toBeNull();
    }
    const ajena = datosDelLaboratorio(f.estado, f.inv, f.c, { ...f.i, corridaId: 'otra-corrida' }, { evidencia });
    expect(ajena.afirmaciones).toBeNull(); expect(ajena.juez.veredictos).toBeNull();
  });

  it('un histórico sin procedencia mantiene su veredicto y solo cuenta la iteración elegida', () => {
    const f = caso('verificacion'), evidencia = cadena(f.c.id, ['sostenida', 'parcial', 'no_sostenida']);
    evidencia.afirmaciones.push({ ...evidencia.afirmaciones[0]!, id: 'af-actual', iteracion: 2 });
    f.c.iteracionActual = 2; f.i.terminadaEn = f.i.empezadaEn + 1000;
    const d = datosDelLaboratorio(f.estado, f.inv, f.c, f.i, { pasada: true, evidencia });
    expect(d.juez.veredictos).toEqual({ sostenida: 1, parcial: 1, no_sostenida: 1, otras: 0 });
    expect(d.afirmaciones).toHaveLength(3); expect(d.afirmaciones![0]).not.toHaveProperty('procedenciaVeredicto');
    expect(d.pasada).toBe(true); expect(d.trabajando).toBe(false);
  });
});

describe('el laboratorio recibe la corrida canónica', () => {
  it('los especialistas de patentes y compañías siguen actividad real independiente en la cuarto exclusivo de novedad', () => {
    const f = caso('novedad', [
      { t: 1, tipo: 'accion', texto: 'Revisando el tratamiento TREM2', agente: 'patentes', estadoAgente: 'en_curso' },
      { t: 2, tipo: 'accion', texto: 'Contrastando programas sobre TREM2', agente: 'companias', estadoAgente: 'en_curso' },
      { t: 3, tipo: 'resultado', texto: 'Informe de patentes guardado', agente: 'patentes', estadoAgente: 'terminado' },
    ]);
    f.i.pistas[0]!.tipo = 'novedad';
    f.i.pistas[0]!.hipotesisId = 'hip-trem2-real';
    const d = f.datos();
    expect(d.actividad.map(a => [a.agente, a.sala])).toEqual([
      ['Especialista en patentes', 'r7'], ['Especialista en compañías', 'r7'], ['Especialista en patentes', 'r7'],
    ]);
    expect(d.activos).toEqual(['Especialista en compañías']); expect(d.salas.r7).toBe('ahora');
    expect(d.foco).toBe('r7'); expect(d.actividad.every(a => a.hipotesisId === 'hip-trem2-real')).toBe(true);
    f.i.pistas[0]!.transcripcion.push({ t: 4, tipo: 'error', texto: 'No pude comprobar el programa empresarial', agente: 'companias', estadoAgente: 'fallido' });
    expect(f.datos().activos).toEqual([]);
  });
  it('una pista sin asociación no inventa el ID desde el título, y la novedad antigua no completa la sala nueva', () => {
    const f = caso('novedad');
    f.i.pistas[0]!.titulo = 'Especialista en patentes: hip-supuesto';
    f.i.plan[0]!.estado = 'hecho'; f.i.pistas[0]!.estado = 'hecha';
    const d = f.datos();
    expect(d.actividad.every(a => a.hipotesisId === null)).toBe(true);
    expect(d.salas.r7).toBe('no_toca');
  });
  it('la revisión de especialistas fuera del paso de novedad deja su cuarto completado en el replay', () => {
    const f = caso('hipotesis', [{ t: 1, tipo: 'resultado', texto: 'Informe guardado', agente: 'patentes', estadoAgente: 'terminado' }]);
    f.i.pistas[0]!.hipotesisId = 'hip-real'; f.i.pistas[0]!.estado = 'hecha'; f.i.plan[0]!.estado = 'hecho';
    f.i.terminadaEn = Date.now(); f.c.iteracionActual = 2;
    const d = datosDelLaboratorio(f.estado, f.inv, f.c, f.i, { pasada: true });
    expect(d.salas.r7).toBe('listo'); expect(d.activos).toEqual([]);
    expect(d.actividad[0]!.hipotesisId).toBe('hip-real'); expect(d.actividad[0]!.sala).toBe('r7');
  });
  it.each(['empezando', 'Empezando...', 'Empezando…'])('una pista sin registro muestra su tarea real en vez de «%s»', (resumen) => {
    const f = caso('literatura', []);
    f.i.pistas[0]!.resumen = resumen;
    expect(f.datos().actividad[0]!.texto).toBe('Búsqueda MAPT');
    expect(f.datos().activos).toEqual(['Generador de consultas']);
    f.c.estado = 'terminada';
    f.i.terminadaEn = f.i.empezadaEn + 1000;
    expect(f.datos().actividad[0]!.texto).toBe('Búsqueda MAPT');
    expect(f.datos().activos).toEqual([]);
  });

  it('atribuye el diálogo a su pista y no inventa cifras ni afirmaciones', () => {
    const f = caso(); const d = f.datos();
    expect(d.actividad[0]).toMatchObject({ texto: 'Consulta: MAPT', agente: 'Generador de consultas', fuente: 'PubMed', pistaId: 'pista-real', pasoId: 'paso-real', t: 1000 });
    expect(d.activos).toEqual(['Generador de consultas']);
    expect(d.lectura).toEqual({ resultados: null, sirven: null, recuperados: null, leidos: null, afirmaciones: null });
    expect(d).not.toHaveProperty('ejemplos');
  });
  it.each(['pausada', 'pausada_por_presupuesto', 'esperando_modelo', 'esperando_aprobacion', 'detenida', 'terminada'] as EstadoCorrida[])('detiene los agentes en %s aunque quede una pista en curso', (est) => {
    const f = caso(); f.c.estado = est;
    expect(f.datos().activos).toEqual([]); expect(f.datos().trabajando).toBe(false);
    expect(f.datos().salas.r1).not.toBe('ahora');
  });
  it('la muestra y el estado sin conexión no se presentan como actividad en vivo', () => {
    const f = caso();
    for (const conexion of ['muestra', 'sin_conexion', 'conectando'] as const) {
      const d = datosDelLaboratorio({ ...f.estado, conexion }, f.inv, f.c, f.i);
      expect(d.trabajando).toBe(false); expect(d.activos).toEqual([]); expect(d.pide).toBeNull();
    }
  });
  it('distingue resultados, texto recuperado y fuentes realmente leídas', () => {
    const f = caso();
    f.c.busqueda.consultas = [{ base: 'PubMed', consulta: 'MAPT', fecha: f.i.empezadaEn, resultados: 87, relevantes: 12, textoCompleto: 4, iteracion: 1, pistaId: 'pista-real' }];
    f.i.pistas.push({ ...f.i.pistas[0]!, id: 'extractor', tipo: 'extraccion', estado: 'hecha', resumen: '3 fuentes, 25 afirmaciones con cita', transcripcion: [] });
    expect(f.datos().lectura).toEqual({ resultados: 87, sirven: 12, recuperados: 4, leidos: 3, afirmaciones: 25 });
  });
  it('una consulta compartida o incompleta no produce un total falso', () => {
    const f = caso(); const q = { base: 'PubMed', consulta: 'MAPT', fecha: f.i.empezadaEn, resultados: 87, relevantes: 12, textoCompleto: 4, iteracion: 1, pistaId: 'pista-real' };
    f.c.busqueda.consultas = [q, { ...q, consulta: 'tau', relajadaDe: 'MAPT' }];
    expect(f.datos().lectura.sirven).toBeNull(); expect(f.datos().lectura.recuperados).toBeNull();
  });
  it('los reintentos fallidos conservan lo que alcanzó a verificar el juez', () => {
    const f = caso('verificacion', [{ t: 1, tipo: 'resultado', texto: 'Deterministas: 4 resueltas sin juez (cita_no_resuelve 4); 80 van al juez' }, { t: 2, tipo: 'resultado', texto: 'Juez: 10 de 80' }]);
    f.i.pistas[0]!.tipo = 'verificacion'; f.i.pistas[0]!.estado = 'fallida';
    f.i.pistas[0]!.resumen = '84 afirmaciones: 80 sostenida, 4 cita_no_resuelve';
    f.i.plan[0]!.estado = 'fallido';
    expect(f.datos().juez).toMatchObject({ hechas: 10, total: 80, sinJuez: 4, veredictos: null });
    expect(f.datos().salas.r2).toBe('fallo'); expect(f.datos().activos).toEqual([]);
  });
  it('no asigna la iteración de otra corrida ni reutiliza la anterior cuando cambia el número', () => {
    const f = caso();
    for (const i of [{ ...f.i, corridaId: 'otra' }, { ...f.i, numero: 2 }]) {
      const d = datosDelLaboratorio(f.estado, f.inv, f.c, i);
      expect(d.actividad).toEqual([]); expect(d.iteracion).toBeNull(); expect(d.pasos.total).toBe(0);
    }
  });
  it('los permisos de una corrida cerrada no se pueden responder desde la escena', () => {
    const f = caso(); const s = { ...estadoDeMuestra().solicitudes[0]!, id: 'permiso', corridaId: f.c.id, estado: 'pendiente' as const, argumentos: [] };
    const e = { ...f.estado, solicitudes: [s] };
    expect(datosDelLaboratorio(e, f.inv, { ...f.c, estado: 'terminada' }, f.i).pide).toBeNull();
  });
  it('espera a aprobar el plan completo y no anima su ejecución antes de aprobarlo', () => {
    const f = caso(); f.c.estado = 'esperando_plan'; f.i.planAprobado = false;
    const d = f.datos(); expect(d.pide?.clase).toBe('plan'); expect(d.pasos.lista).toHaveLength(1);
    expect(d.activos).toEqual([]); expect(d.trabajando).toBe(false); expect(d.foco).toBe('plan');
  });
  it('el planificador pide más llamadas cuando la corrida se pausa por presupuesto', () => {
    const f = caso(); f.c.estado = 'pausada_por_presupuesto';
    f.c.presupuesto.motivoPausa = 'El cierre necesita unas 26 llamadas y quedan 21. Amplía el tope en al menos 5 llamadas para seguir.';
    const d = f.datos();
    expect(d.pide).toMatchObject({ clase: 'presupuesto', quien: 'Planificador', alcances: [] });
    expect(d.pide?.titulo).toContain('al menos 5 llamadas más');
    expect(d.pide?.presupuesto).toEqual({ corridaId: f.c.id, limite: f.c.presupuesto.limiteLlamadas, usado: f.c.gasto.llamadas, propuesta: 5 });
    f.c.presupuesto.motivoPausa = 'El cierre de la iteración 1 quedó a medias: le faltan unas 12 llamadas.';
    expect(f.datos().pide?.presupuesto?.propuesta).toBe(12);
    expect(d.trabajando).toBe(false);
    f.c.estado = 'en_marcha'; expect(f.datos().pide).toBeNull();
    f.c.estado = 'pausada'; expect(f.datos().pide).toBeNull();
  });
  it('una incidencia pendiente sale en el laboratorio sin parar el resto del trabajo', () => {
    const f = caso();
    const base = { corridaId: f.c.id, tipo: 'modelo_bloqueado' as const, detalle: 'El modelo no devolvió nada.', recurso: 'anthropic/claude-sonnet-5', alternativa: 'Revisar el paso.', estado: 'pendiente' as const, resueltaEn: null, resolucion: null };
    f.estado.incidencias.push({ ...base, id: 'nueva', titulo: 'Nueva', creadaEn: 20 }, { ...base, id: 'vieja', titulo: 'Claude Sonnet 5 tarda más de 240 s', creadaEn: 10 }, { ...base, id: 'sola', tipo: 'modelo_sin_respuesta', titulo: 'Se resuelve sola', creadaEn: 1 }, { ...base, id: 'otra', corridaId: 'otra-corrida', titulo: 'Otra', creadaEn: 0 });
    const d = f.datos();
    expect(d.pide).toMatchObject({ id: 'vieja', clase: 'incidencia', quien: 'Generador de consultas', titulo: 'Claude Sonnet 5 tarda más de 240 s', incidencia: { tipo: 'modelo_bloqueado', recurso: 'anthropic/claude-sonnet-5', alternativa: 'Revisar el paso.', corridaEnMarcha: true } });
    expect(d.trabajando).toBe(true);
    expect(d.activos).toEqual(['Generador de consultas']);
    f.estado.incidencias.forEach((x) => { x.estado = 'resuelta'; });
    expect(f.datos().pide).toBeNull();
  });
  it('un permiso pendiente tiene prioridad sobre la pregunta de presupuesto', () => {
    const f = caso(); f.c.estado = 'pausada_por_presupuesto';
    f.estado.solicitudes.push({ ...estadoDeMuestra().solicitudes[0]!, id: 'permiso', corridaId: f.c.id, estado: 'pendiente', argumentos: [] });
    expect(f.datos().pide).toMatchObject({ id: 'permiso', clase: 'permiso' });
  });
  it('la planificación inicial está activa aunque la iteración todavía no exista', () => {
    const f = caso(); f.c.estado = 'esperando_plan';
    const d = datosDelLaboratorio(f.estado, f.inv, f.c, null);
    expect(d.activos).toEqual(['Planificador']); expect(d.foco).toBe('plan'); expect(d.trabajando).toBe(true);
  });
  it('los miembros en paralelo terminan y fallan de forma independiente', () => {
    const f = caso('hipotesis', [
      { t: 1, tipo: 'accion', texto: 'El miembro «analogia» genera propuestas', agente: 'analogia', estadoAgente: 'en_curso' },
      { t: 2, tipo: 'accion', texto: 'El miembro «contradiccion» genera propuestas', agente: 'contradiccion', estadoAgente: 'en_curso' },
      { t: 3, tipo: 'resultado', texto: 'El miembro «analogia» terminó', agente: 'analogia', estadoAgente: 'terminado' },
    ]);
    expect(f.datos().activos).toEqual(['Contradicción']);
    f.i.pistas[0]!.transcripcion.push({ t: 4, tipo: 'error', texto: 'El miembro «contradiccion» no respondió', agente: 'contradiccion', estadoAgente: 'fallido' });
    expect(f.datos().activos).toEqual([]);
  });
  it('una mención del Killer en un artículo no cambia quién está ejecutando la búsqueda', () => {
    const f = caso('literatura', [{ t: 1, tipo: 'resultado', texto: 'El artículo menciona al Killer y al torneo' }]);
    expect(f.datos().actividad[0]!.agente).toBe('Generador de consultas');
  });
  it('pasa de generar hipótesis al Killer y a los dos jueces dentro de la misma pista', () => {
    const f = caso('hipotesis', [
      { t: 1, tipo: 'resultado', texto: 'Terminó la generación', agente: 'analogia', estadoAgente: 'terminado' },
      { t: 2, tipo: 'accion', texto: 'El Killer revisa MAPT', agente: 'killer', estadoAgente: 'en_curso' },
    ]);
    expect(f.datos().activos).toEqual(['Killer']); expect(f.datos().foco).toBe('r4');
    f.i.pistas[0]!.transcripcion.push(
      { t: 3, tipo: 'resultado', texto: 'Terminó el Killer', agente: 'killer', estadoAgente: 'terminado' },
      { t: 4, tipo: 'accion', texto: 'Comparando A y B', agente: 'torneo_a', estadoAgente: 'en_curso' },
      { t: 5, tipo: 'accion', texto: 'Comparando B y A', agente: 'torneo_b', estadoAgente: 'en_curso' },
    );
    expect(f.datos().activos).toEqual(['Juez del torneo', 'Juez del torneo B']);
    f.i.pistas[0]!.transcripcion.push({ t: 6, tipo: 'resultado', texto: 'Terminó una lectura', agente: 'torneo_a', estadoAgente: 'terminado' });
    expect(f.datos().activos).toEqual(['Juez del torneo B']);
  });

});
