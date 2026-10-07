import type { DatosLab } from '../../lib/labVivo';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';

export function claveVozPlan(datos: DatosLab): string | null {
  if (!datos.planificando || !Number.isInteger(datos.planificandoIteracion) || (datos.planificandoIteracion ?? 0) < 1
    || !['en_marcha', 'esperando_plan'].includes(datos.estado) || datos.pasada) return null;
  return `plan:${datos.identidad.split('/')[0]}:${datos.planificandoIteracion}`;
}
export function vozDisponible(datos: DatosLab): boolean {
  return datos.conexion === 'en_linea' && !datos.pasada && (datos.trabajando || claveVozPlan(datos) !== null
    || (datos.estado === 'esperando_plan' && datos.pasos.lista.length > 0 && !datos.pasos.aprobado));
}
export function turnoVigente(t: TurnoLaboratorio, datos: DatosLab): boolean {
  if (!vozDisponible(datos) || !Number.isFinite(t.fecha) || Date.now() - t.fecha > 90000) return false;
  const plan = claveVozPlan(datos);
  if (plan) return t.iteracionId === plan && t.momento === 'inicio_tarea' && t.agente !== 'Tú';
  if (!datos.identidad.endsWith('/' + t.iteracionId)) return false;
  if (!datos.trabajando) {
    if (t.momento !== 'plan_propuesto' || t.tipoConversacion !== 'companeros') return false;
    const planes = t.materiales.filter(m => m.clase === 'plan');
    // Un saludo puede citar solo el objetivo. Si comenta los pasos, su
    // fotografía debe seguir coincidiendo con la propuesta guardada.
    if (!planes.length) return t.materiales.some(m => m.clase === 'objetivo');
    const contenido = (pasos: unknown): string | null => {
      if (!Array.isArray(pasos) || !pasos.length || pasos.some(p => !p || typeof p !== 'object'
        || ['id', 'tipo', 'titulo', 'detalle'].some(k => p[k] != null && typeof p[k] !== 'string'))) return null;
      return JSON.stringify(pasos.map(p => [p.id ?? null, p.tipo ?? null, p.titulo ?? '', p.detalle ?? '']));
    };
    const actual = contenido(datos.pasos.lista);
    return actual !== null && planes.every(m => m.aprobado !== true && contenido(m.pasos) === actual);
  }
  if (t.momento === 'inicio_tarea') {
    const tareas = t.materiales.filter(m => m.clase === 'tarea' && m.pistaId);
    if (!tareas.some(m => {
      const paso = m.pasoId ? datos.pasos.lista.find(p => p.id === m.pasoId) : null;
      if (m.pasoId && (!paso || (paso.estado !== 'en_curso' && paso.estado !== 'pendiente'))) return false;
      const filas = datos.actividad.filter(a => a.pistaId === m.pistaId);
      if (m.entradaId) {
        const apertura = filas.find(a => a.id === m.entradaId);
        if (!apertura || !apertura.enCurso || apertura.abierta !== true) return false;
      }
      const atribuida = filas.some(a => a.estadoAgente !== undefined || a.eventoLab?.tipo === 'decision_hipotesis'
        || a.eventoLab?.tipo === 'revision_registro' || a.eventoLab?.tipo === 'analisis');
      if (m.evento) return filas.some(a => a.enCurso && a.abierta === true && (!m.agente || m.agente === a.agente)
        && datos.activos.includes(a.agente) && JSON.stringify(a.eventoLab) === JSON.stringify(m.evento));
      // La entrada anterior puede conservar estadoAgente=en_curso después de
      // su cierre. La proyección marca abierta=false y ese cierre manda.
      const ultima = [...filas].reverse().find(a => !m.agente || m.agente === a.agente);
      return !!ultima && ultima.enCurso && datos.activos.includes(ultima.agente)
        && (atribuida ? ultima.abierta === true : ultima.estadoAgente === undefined);
    })) return false;
  }
  return t.momento !== 'plan_propuesto';
}
