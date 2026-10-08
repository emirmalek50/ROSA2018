import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCharla, TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import type { ActividadLab, DatosLab } from '../../lib/labVivo';
import type { EventoLab } from '../../datos/tipos';
import { claveVozPlan, turnoVigente, vozDisponible } from './vozDisponible';

const AHORA = 1_790_000_000_000;
const actividad = (cambios: Partial<ActividadLab> = {}): ActividadLab => ({
  id: 'pi-real:0:0', agente: 'Generador de consultas', sala: 'r1', tipo: 'accion', texto: 'Comienza la búsqueda real',
  pistaId: 'pi-real', pasoId: 'paso-real', titulo: 'Buscar literatura', fuente: 'PubMed', t: 0,
  enCurso: true, abierta: true, estadoAgente: 'en_curso', ...cambios,
});
const datos = (cambios: Partial<DatosLab> = {}): DatosLab => ({
  identidad: 'cor-real/it-real', corrida: 2, iteracion: 1, titulo: 'MAPT', conexion: 'en_linea',
  estado: 'en_marcha', estadoTexto: 'En marcha', motivo: null, trabajando: true, pasada: false,
  salas: { plan: 'listo', r1: 'ahora', r2: 'despues', r3: 'despues', r4: 'despues', r5: 'despues', r6: 'despues', r7: 'despues' },
  foco: 'r1', activos: ['Generador de consultas'], actividad: [actividad()],
  pasos: { total: 1, primero: 'Buscar literatura', aprobado: true, estados: ['ahora'], enCurso: { n: 1, titulo: 'Buscar literatura' },
    lista: [{ id: 'paso-real', tipo: 'literatura', titulo: 'Buscar literatura', detalle: 'Comparar MAPT y tau', estado: 'en_curso' }] },
  fuentes: [], lectura: { resultados: null, sirven: null, recuperados: null, leidos: null, afirmaciones: null },
  juez: { hechas: null, total: null, sinJuez: null, veredictos: null }, pide: null,
  modelos: { cerebro: null, volumen: null, juez: null }, salud: { cerebro: 'ok', volumen: 'ok', juez: 'ok' }, ideas: { vivas: 0, descartadas: 0, partidos: 0 }, presupuesto: null, afirmaciones: null, ...cambios,
});
const turno = (cambios: Partial<TurnoLaboratorio> = {}): TurnoLaboratorio => ({
  id: 'voz-real', temaId: 'tema-real', iteracionId: 'it-real', idioma: 'es', momento: 'inicio_tarea', tipoConversacion: 'actividad',
  agente: 'Generador de consultas', destinatario: 'Explorador', texto: 'Quiero comparar lo de tau.', fecha: AHORA, modelo: 'prueba',
  materiales: [{ id: 'inicio_tarea:it-real:pi-real:pista:Generador de consultas', clase: 'tarea', pistaId: 'pi-real', pasoId: 'paso-real',
    agente: 'Generador de consultas', tipo: 'literatura', estado: 'en_curso', titulo: 'Buscar literatura', detalle: 'Comparar MAPT y tau', texto: 'Comparar MAPT y tau' }], ...cambios,
});
const planGuardado = (): DatosLab => {
  const d = datos({ estado: 'esperando_plan', trabajando: false, activos: [], actividad: [] });
  return { ...d, pasos: { ...d.pasos, aprobado: false, enCurso: null, estados: ['pendiente'], lista: d.pasos.lista.map(p => ({ ...p, estado: 'pendiente' })) } };
};
const vozDelPlan = (): TurnoLaboratorio => ({ ...turno(), momento: 'plan_propuesto', tipoConversacion: 'companeros', agente: 'Planificador', destinatario: 'Misión, Áreas y Pregunta',
  materiales: [{ id: 'plan_propuesto:it-real', clase: 'plan', aprobado: false, texto: 'Propuesta pendiente de aprobación',
    pasos: [{ id: 'paso-real', tipo: 'literatura', titulo: 'Buscar literatura', detalle: 'Comparar MAPT y tau' }] }] });

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(AHORA); });
afterEach(() => { vi.restoreAllMocks(); });

describe('la voz conserva el contexto real y la fase científica', () => {
  it.each(['sin_conexion', 'conectando', 'muestra'] as const)('sin datos en línea %s no genera voz ni reproduce un turno', conexion => {
    const d = datos({ conexion });
    expect(vozDisponible(d)).toBe(false); expect(turnoVigente(turno(), d)).toBe(false);
  });
  it.each(['pausada', 'pausada_por_presupuesto', 'detenida', 'terminada'] as const)('una corrida %s no recupera comienzos', estado => {
    const d = datos({ estado, trabajando: false });
    expect(vozDisponible(d)).toBe(false); expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('la vista pasada permanece silenciosa incluso con una bandera conservada', () => {
    const d = datos({ pasada: true, planificando: true, planificandoIteracion: 2 });
    expect(claveVozPlan(d)).toBeNull(); expect(vozDisponible(d)).toBe(false); expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('el primer plan permite voz sin una iteración ficticia y rechaza claves distintas', () => {
    const d = datos({ identidad: 'cor-real/sin-iteracion', iteracion: null, planificando: true, planificandoIteracion: 1, estado: 'esperando_plan',
      trabajando: true, actividad: [], activos: ['Planificador'] });
    const t = turno({ iteracionId: 'plan:cor-real:1', agente: 'Planificador', destinatario: 'Misión, Áreas y Pregunta',
      materiales: [{ id: 'objetivo:cor-real', clase: 'objetivo', texto: 'Comparar MAPT y tau' }] });
    expect(claveVozPlan(d)).toBe('plan:cor-real:1'); expect(vozDisponible(d)).toBe(true); expect(turnoVigente(t, d)).toBe(true);
    expect(turnoVigente({ ...t, iteracionId: 'plan:otra:1' }, d)).toBe(false);
    expect(turnoVigente({ ...t, iteracionId: 'plan:cor-real:2' }, d)).toBe(false);
    expect(turnoVigente({ ...t, momento: 'plan_propuesto' }, d)).toBe(false);
    expect(turnoVigente(t, { ...d, planificando: false })).toBe(false);
  });
  it.each([undefined, 0, -1, 1.5, NaN, Infinity])('el número de planificación %s no crea una clave', planificandoIteracion => {
    expect(claveVozPlan(datos({ planificando: true, planificandoIteracion }))).toBeNull();
  });
  it('un plan guardado puede comentarse quieto, pero no se ejecuta una tarea pendiente', () => {
    const d = planGuardado();
    expect(vozDisponible(d)).toBe(true); expect(turnoVigente(vozDelPlan(), d)).toBe(true);
    expect(turnoVigente(turno(), d)).toBe(false);
    expect(turnoVigente({ ...vozDelPlan(), tipoConversacion: 'actividad' }, d)).toBe(false);
    expect(turnoVigente(vozDelPlan(), datos())).toBe(false);
  });
  it('sin lista real no convierte esperando_plan en una propuesta', () => {
    const d = planGuardado(), sinPasos = { ...d, pasos: { ...d.pasos, total: 0, lista: [] } };
    expect(vozDisponible(sinPasos)).toBe(false); expect(turnoVigente(vozDelPlan(), sinPasos)).toBe(false);
  });
  it.each([
    { id: 'paso-distinto' }, { tipo: 'ensayos' }, { titulo: 'Buscar en otra dirección' }, { detalle: 'Otra pregunta real' },
  ])('editar %j retira un comentario sobre la propuesta anterior', cambio => {
    const d = planGuardado(); d.pasos.lista[0] = { ...d.pasos.lista[0]!, ...cambio };
    expect(turnoVigente(vozDelPlan(), d)).toBe(false);
  });
  it('cambiar cantidad u orden de pasos retira el comentario anterior', () => {
    const d = planGuardado(), t = vozDelPlan();
    const otro = { id: 'paso-dos', tipo: 'verificacion', titulo: 'Revisar citas', detalle: 'Comprobar el origen' };
    d.pasos.lista.push(otro);
    expect(turnoVigente(t, d)).toBe(false);
    t.materiales[0]!.pasos!.push(otro);
    expect(turnoVigente(t, d)).toBe(true);
    d.pasos.lista.reverse();
    expect(turnoVigente(t, d)).toBe(false);
  });
  it('el estado y el presupuesto no cambian el contenido ni dependen del orden de claves', () => {
    const d = planGuardado(), t = vozDelPlan();
    d.pasos.lista[0] = { detalle: 'Comparar MAPT y tau', titulo: 'Buscar literatura', tipo: 'literatura', id: 'paso-real', presupuesto: 40, estado: 'pendiente' };
    expect(turnoVigente(t, d)).toBe(true);
  });
  it('los campos opcionales ausentes o vacíos conservan la comparación del contenido', () => {
    const d = planGuardado(), t = vozDelPlan();
    d.pasos.lista[0] = { titulo: 'Buscar literatura', detalle: '' };
    t.materiales[0]!.pasos = [{ titulo: 'Buscar literatura' } as NonNullable<MaterialCharla['pasos']>[number]];
    expect(turnoVigente(t, d)).toBe(true);
  });
  it('un saludo referido solo al objetivo sigue válido después de editar los pasos', () => {
    const d = planGuardado(), t = { ...vozDelPlan(), texto: 'Vale.', materiales: [{ id: 'objetivo:cor-real', clase: 'objetivo' as const, texto: 'Comparar MAPT y tau' }] };
    d.pasos.lista[0] = { ...d.pasos.lista[0]!, detalle: 'Otra vía propuesta para el mismo objetivo' };
    expect(turnoVigente(t, d)).toBe(true);
  });
  it.each([undefined, [], null, [null], [{ titulo: 42 }]])('una fotografía de plan inválida %j no se publica', pasos => {
    const t = vozDelPlan(); t.materiales[0]!.pasos = pasos as MaterialCharla['pasos'];
    expect(turnoVigente(t, planGuardado())).toBe(false);
  });
  it('el cambio de iteración no admite un turno anterior', () => {
    expect(turnoVigente(turno(), datos({ identidad: 'cor-real/it-nueva', iteracion: 2 }))).toBe(false);
  });
  it('el segundo hablante conserva la tarea del autor aunque no trabaje su etapa', () => {
    expect(turnoVigente(turno(), datos())).toBe(true);
    expect(turnoVigente(turno({ agente: 'Explorador', destinatario: 'Generador de consultas', texto: 'Vale, miro esa comparación contigo.' }), datos())).toBe(true);
  });
  it('el cierre de la pista retira la apertura mientras sigue la corrida', () => {
    const d = datos({ activos: ['Juez'], actividad: [actividad({ enCurso: false, abierta: false, estadoAgente: 'terminado' })] });
    expect(vozDisponible(d)).toBe(true); expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('el paso completado no revive su intención mientras otro continúa', () => {
    const d = datos(); d.pasos.lista[0] = { ...d.pasos.lista[0]!, estado: 'hecho' };
    expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('un miembro terminado de una pista paralela no dice que empieza', () => {
    const d = datos({ actividad: [actividad({ enCurso: true, abierta: false, estadoAgente: 'terminado' })], activos: ['Explorador'] });
    expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('un inicio histórico no revive por conservar en_curso mientras el mismo autor vuelve a estar activo', () => {
    const d = datos({ actividad: [actividad({ abierta: false, estadoAgente: 'en_curso' }),
      actividad({ id: 'pi-real:1:10', tipo: 'resultado', texto: 'Terminó su tarea', abierta: false, estadoAgente: 'terminado' })] });
    expect(turnoVigente(turno(), d)).toBe(false);
  });
  it('el comienzo genuino de una pista sin metadatos también tiene voz antes del primer hallazgo', () => {
    const d = datos({ actividad: [actividad({ tipo: 'estado', estadoAgente: undefined, abierta: false })] });
    expect(turnoVigente(turno(), d)).toBe(true);
  });
  it('la segunda apertura del mismo miembro no revalida el comienzo anterior de la misma pista', () => {
    const t = turno(); t.materiales[0] = { ...t.materiales[0]!, entradaId: 'pi-real:0:0' };
    const d = datos({ actividad: [actividad({ abierta: false }),
      actividad({ id: 'pi-real:1:10', estadoAgente: 'terminado', abierta: false }),
      actividad({ id: 'pi-real:2:20', estadoAgente: 'en_curso', abierta: true })] });
    expect(turnoVigente(t, d)).toBe(false);
    expect(turnoVigente({ ...t, materiales: [{ ...t.materiales[0]!, entradaId: 'pi-real:2:20' }] }, d)).toBe(true);
  });
  it('otra pista no sostiene el comienzo aunque el mismo agente trabaje', () => {
    expect(turnoVigente(turno(), datos({ actividad: [actividad({ pistaId: 'pi-nueva' })] }))).toBe(false);
  });
  it('una tarea estructurada terminada no se mezcla con la etapa siguiente de la pista', () => {
    const evento: EventoLab = { tipo: 'decision_hipotesis', hipotesisId: 'hip-real', version: 1, etapa: 'killer', estado: 'en_curso',
      decision: '', comprobaciones: [], hechoIds: [], origen: 'juez', modelo: 'prueba' };
    const t = turno({ agente: 'Killer', destinatario: 'Revisor inicial', materiales: [{ id: 'inicio-real', clase: 'tarea', pistaId: 'pi-real',
      agente: 'Killer', texto: 'Revisar hipótesis MAPT', estado: 'en_curso', evento }] });
    const d = datos({ activos: ['Killer'], actividad: [actividad({ agente: 'Killer', eventoLab: evento })] });
    expect(turnoVigente(t, d)).toBe(true);
    expect(turnoVigente(t, { ...d, activos: ['Juez de viabilidad'], actividad: [
      actividad({ agente: 'Killer', eventoLab: { ...evento, estado: 'terminado' }, abierta: false, estadoAgente: 'terminado' }),
      actividad({ agente: 'Juez de viabilidad', eventoLab: { ...evento, etapa: 'viabilidad' } }),
    ] })).toBe(false);
  });
  it.each([90_001, 180_000])('un turno retenido %sms caduca antes de consumirse', espera => {
    expect(turnoVigente(turno({ fecha: AHORA - espera }), datos())).toBe(false);
  });
  it('un comentario reciente de resultados sin momento conserva compatibilidad', () => {
    expect(turnoVigente(turno({ momento: undefined, materiales: [{ id: 'af-real', clase: 'afirmacion', texto: 'Asociación en ratones' }] }), datos())).toBe(true);
  });
});
