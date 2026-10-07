import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoCorrida, EntradaTranscripcion, EstadoRosa, Iteracion } from '../datos/tipos';
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

describe('el laboratorio recibe la corrida canónica', () => {
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
  it('el preguntador muestra la pausa por presupuesto aunque no haya solicitudes', () => {
    const f = caso(); f.c.estado = 'pausada_por_presupuesto';
    f.c.presupuesto.motivoPausa = 'Faltan 5 llamadas para cerrar';
    const d = f.datos();
    expect(d.pide).toMatchObject({ clase: 'presupuesto', quien: 'Preguntador', detalle: f.c.presupuesto.motivoPausa, alcances: [] });
    expect(d.pide?.presupuesto).toEqual({ corridaId: f.c.id, limite: f.c.presupuesto.limiteLlamadas, usado: f.c.gasto.llamadas });
    expect(d.trabajando).toBe(false);
    f.c.estado = 'en_marcha'; expect(f.datos().pide).toBeNull();
    f.c.estado = 'pausada'; expect(f.datos().pide).toBeNull();
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
