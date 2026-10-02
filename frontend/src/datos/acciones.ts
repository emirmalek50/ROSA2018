// Las acciones de la interfaz como funciones puras sobre el estado: cada
// boton de ROSA2018 llama a una de estas. Devuelven un estado nuevo y no mutan el
// anterior, asi que vitest las prueba sin React y el almacen las aplica tal
// cual. Cuando el almacen real exista, cada una se convierte en una mutacion
// del servidor con la misma firma; las pantallas no cambian.
//
// Reglas del dominio que se hacen cumplir aqui y no en la pantalla:
// - La aprobacion va antes del efecto: aceptar una hipotesis la pasa al
//   modelo de mundo como abierta (para perseguir), nunca como sabida.
// - Descartar exige motivo y deja el rastro en el modelo de mundo.
// - Un permiso concedido con alcance mayor que "una vez" queda listado y se
//   puede revocar en Ajustes.
// - Los comentarios se acumulan como pendientes y salen juntos al enviar.
// - El plan de una iteracion no se ejecuta hasta que se aprueba.
// - El presupuesto global pausa la corrida, no la mata; una pregunta
//   pendiente tiene prioridad sobre el tope.
// - Toda accion relevante deja un evento, para el resumen "mientras no
//   estabas".

import { partesAutomatizadas } from '../lib/parada';
import { esViva, vigencia } from '../lib/desbloqueo';
import { traducido } from '../lib/idioma';
import type {
  Afirmacion,
  AlcancePermiso,
  RecuperacionCitas,
  SelloSupuestos,
  Cuestion,
  Amplitud,
  AnclaComentario,
  AreaInvestigacion,
  Avisos,
  CambioAprendizaje,
  CampoEnmendable,
  CampoLecturaEnmendable,
  CasoDorado,
  ClaseAccion,
  ClasificacionDatos,
  Comentario,
  ConocimientoOperativo,
  Corrida,
  Dataset,
  EnmiendaPrerregistro,
  Experimento,
  EstadoArea,
  EstadoRosa,
  Evento,
  Fuente,
  HechoMundo,
  TipoHecho,
  Hipotesis,
  Investigacion,
  Iteracion,
  LecturaExperimento,
  MetodoRegistrado,
  Mision,
  NivelAutonomia,
  NivelDesenlace,
  NivelPermisoConector,
  PasoPlan,
  PoliticaEsperas,
  PreguntaCampana,
  ProcedenciaDataset,
  PropositoBiomarcador,
  ProtocoloReal,
  PuertaReproduccion,
  Reproduccion,
  Revision,
  RevisionHumana,
  SistemaExperimental,
  TipoArtefacto,
  TipoEvento,
  TipoLectura,
  TipoSistema,
} from './tipos';

let contador = 0;
/** Ids locales. El almacen real los asigna el servidor. */
export function nuevoId(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${Date.now().toString(36)}-${contador}`;
}

function reemplazar<T extends { id: string }>(lista: T[], id: string, cambio: (x: T) => T): T[] {
  return lista.map((x) => (x.id === id ? cambio(x) : x));
}

export function conEvento(estado: EstadoRosa, investigacionId: string, tipo: TipoEvento, texto: string, ruta: string | null, t: number): EstadoRosa {
  const evento: Evento = { id: nuevoId('ev'), investigacionId, t, tipo, texto, ruta };
  return { ...estado, eventos: [...estado.eventos, evento] };
}

export function iteracionActualDe(estado: EstadoRosa, corrida: Corrida): Iteracion | null {
  const propias = estado.iteraciones.filter((i) => i.corridaId === corrida.id);
  if (propias.length === 0) return null;
  return propias.reduce((max, i) => (i.numero > max.numero ? i : max));
}

function corridaDe(estado: EstadoRosa, corridaId: string): Corrida | null {
  return estado.corridas.find((c) => c.id === corridaId) ?? null;
}

/* ---------------------------------------------------------------------
   Visita
   --------------------------------------------------------------------- */

/** Marca que la persona vio el resumen: lo siguiente que pase cuenta como
 *  "mientras no estabas". */
export function marcarVisita(estado: EstadoRosa, ahora: number): EstadoRosa {
  return { ...estado, ultimaVisita: ahora };
}

/* ---------------------------------------------------------------------
   Corrida
   --------------------------------------------------------------------- */

export function pausarCorrida(estado: EstadoRosa, corridaId: string): EstadoRosa {
  return {
    ...estado,
    corridas: reemplazar(estado.corridas, corridaId, (c) => (c.estado === 'en_marcha' ? { ...c, estado: 'pausada' } : c)),
  };
}

export function reanudarCorrida(estado: EstadoRosa, corridaId: string): EstadoRosa {
  return {
    ...estado,
    // Una solicitud pendiente no impide reanudar: ROSA2018 sigue con lo demás y
    // la tarjeta se queda esperando. Desde `esperando_modelo` es el "Reintentar
    // ahora" de la persona: la corrida vuelve a en marcha sin esperar al sondeo.
    // Misma regla que `reanudar_corrida` en rosa/estado/acciones.py.
    corridas: reemplazar(estado.corridas, corridaId, (c) => (c.estado === 'pausada' || c.estado === 'esperando_modelo' ? { ...c, estado: 'en_marcha', esperandoModelo: null } : c)),
  };
}

export function detenerCorrida(estado: EstadoRosa, corridaId: string, motivo: string, ahora: number, vigilarLiteraturaDias: number | null = null): EstadoRosa {
  const texto = motivo.trim() === '' ? 'Detenida por la investigadora.' : motivo.trim();
  const corrida = corridaDe(estado, corridaId);
  if (!corrida || corrida.estado === 'detenida' || corrida.estado === 'terminada') return estado;
  let siguiente: EstadoRosa = {
    ...estado,
    // Una corrida detenida ya no espera a ningún modelo (misma regla que
    // `detener_corrida` en rosa/estado/acciones.py): la franja de modelos no
    // debe seguir diciendo "esperando a GPT-6 Astra" sobre una corrida parada,
    // ni su incidencia automática quedar "resolviéndose sola" para siempre.
    corridas: reemplazar(estado.corridas, corridaId, (c) => ({ ...c, estado: 'detenida', terminadaEn: ahora, motivoCierre: texto, esperandoModelo: null })),
    incidencias: estado.incidencias.map((i) =>
      i.corridaId === corridaId && i.estado === 'pendiente' && i.tipo === 'modelo_sin_respuesta'
        ? { ...i, estado: 'resuelta' as const, resueltaEn: ahora, resolucion: 'La corrida se detuvo; ROSA2018 ya no espera a ese modelo' }
        : i,
    ),
  };
  if (vigilarLiteraturaDias !== null && vigilarLiteraturaDias > 0) {
    siguiente = {
      ...siguiente,
      investigaciones: reemplazar(siguiente.investigaciones, corrida.investigacionId, (i) => ({ ...i, vigilarLiteraturaHasta: ahora + vigilarLiteraturaDias * 86_400_000 })),
    };
  }
  return conEvento(siguiente, corrida.investigacionId, 'corrida_estado', `Corrida ${corrida.numero} detenida: ${texto}`, null, ahora);
}

/** Ampliar el tope de llamadas de la corrida y, con el mismo margen que la
 *  persona concede, el de la iteración en curso; si estaba pausada por
 *  presupuesto, vuelve a marchar. Misma regla que `ampliar_presupuesto` en
 *  rosa/estado/acciones.py (17 de septiembre de 2026, S-15):
 *  - el tope nuevo tiene que ser mayor que lo gastado y que cero;
 *  - margen = max(topeNuevo - topeAnterior, 0);
 *  - la iteración en curso (la de número más alto de la corrida) pasa a
 *    limite = max(limite, usado + margen). Antes solo se tocaba el tope de la
 *    corrida y, cuando lo que había cortado era el tope de la iteración,
 *    ampliar la ponía en marcha y la primera llamada la volvía a pausar. */
export function ampliarPresupuesto(estado: EstadoRosa, corridaId: string, nuevoLimite: number, ahora: number): EstadoRosa {
  const corrida = corridaDe(estado, corridaId);
  if (!corrida || !Number.isFinite(nuevoLimite)) return estado;
  const limite = Math.round(nuevoLimite);
  if (limite <= corrida.gasto.llamadas || limite <= 0) return estado;
  const margen = Math.max(limite - (corrida.presupuesto.limiteLlamadas ?? 0), 0);
  const propias = estado.iteraciones.filter((i) => i.corridaId === corridaId);
  const actual = propias.length ? propias.reduce((a, b) => (b.numero > a.numero ? b : a)) : null;
  // Un registro antiguo puede no traer `presupuesto` en la iteración: igual que el
  // servidor (`isinstance(it.get("presupuesto"), dict)`), entonces no se toca.
  const presupuestoIt = actual && actual.presupuesto && typeof actual.presupuesto === 'object' ? actual.presupuesto : null;
  const limiteIteracion = presupuestoIt ? Math.max(presupuestoIt.limite ?? 0, (presupuestoIt.usado ?? 0) + margen) : null;
  const siguiente: EstadoRosa = {
    ...estado,
    corridas: reemplazar(estado.corridas, corridaId, (c) => ({
      ...c,
      presupuesto: {
        ...c.presupuesto,
        limiteLlamadas: limite,
        avisadas: c.presupuesto.avisadas.filter((a) => c.gasto.llamadas / limite >= a),
        // Al reanudar, el motivo de la pausa deja de valer (misma regla que el servidor).
        ...(c.estado === 'pausada_por_presupuesto' ? { motivoPausa: '' } : {}),
      },
      estado: c.estado === 'pausada_por_presupuesto' ? 'en_marcha' : c.estado,
      // Al retomar, un registro de espera de modelo dejado durante la pausa ya no
      // vale (misma regla que `ampliar_presupuesto` en el servidor).
      ...(c.estado === 'pausada_por_presupuesto' ? { esperandoModelo: null } : {}),
    })),
    iteraciones:
      actual && limiteIteracion !== null
        ? reemplazar(estado.iteraciones, actual.id, (it) => ({ ...it, presupuesto: { ...it.presupuesto, limite: limiteIteracion } }))
        : estado.iteraciones,
  };
  const texto = `Presupuesto ampliado a ${limite} llamadas` + (actual && margen && limiteIteracion !== null ? `; la iteración ${actual.numero} puede gastar hasta ${limiteIteracion}` : '');
  return conEvento(siguiente, corrida.investigacionId, 'presupuesto', texto, null, ahora);
}

/** Una indicacion de la investigadora entra al plan de la iteracion en
 *  curso, justo despues del paso actual, marcada como humana. */
export function dirigirCorrida(estado: EstadoRosa, corridaId: string, texto: string): EstadoRosa {
  const limpio = texto.trim();
  if (limpio === '') return estado;
  const corrida = corridaDe(estado, corridaId);
  if (!corrida) return estado;
  const iteracion = iteracionActualDe(estado, corrida);
  if (!iteracion) return estado;
  const paso: PasoPlan = { id: nuevoId('paso'), titulo: 'Indicación de la investigadora', detalle: limpio, estado: 'pendiente', indicacionHumana: true, motivoFallo: null, presupuesto: null };
  const idx = iteracion.plan.findIndex((p) => p.estado === 'en_curso');
  const plan = [...iteracion.plan];
  plan.splice(idx === -1 ? plan.length : idx + 1, 0, paso);
  return { ...estado, iteraciones: reemplazar(estado.iteraciones, iteracion.id, (it) => ({ ...it, plan })) };
}

/** Editar el plan de una iteracion que aun no se aprobo: reordenar, quitar,
 *  anadir o cambiar el presupuesto de un paso. Un plan aprobado no se edita:
 *  se dirige. */
export function editarPlan(estado: EstadoRosa, iteracionId: string, plan: PasoPlan[]): EstadoRosa {
  const it = estado.iteraciones.find((i) => i.id === iteracionId);
  if (!it || it.planAprobado) return estado;
  const limpio = plan.filter((p) => p.titulo.trim() !== '');
  if (limpio.length === 0) return estado;
  return { ...estado, iteraciones: reemplazar(estado.iteraciones, iteracionId, (i) => ({ ...i, plan: limpio })) };
}

export function aprobarPlan(estado: EstadoRosa, iteracionId: string, ahora: number, quien = 'Investigadora'): EstadoRosa {
  const it = estado.iteraciones.find((i) => i.id === iteracionId);
  if (!it || it.planAprobado) return estado;
  const corrida = corridaDe(estado, it.corridaId);
  let siguiente: EstadoRosa = {
    ...estado,
    iteraciones: reemplazar(estado.iteraciones, iteracionId, (i) => ({ ...i, planAprobado: true, empezadaEn: ahora })),
    corridas: reemplazar(estado.corridas, it.corridaId, (c) => (c.estado === 'esperando_plan' ? { ...c, estado: 'en_marcha' } : c)),
  };
  if (!corrida) return siguiente;
  // Aprobar el primer plan aprueba también la misión tal como está en pantalla:
  // la persona la vio encima del plan. Y la pregunta de la campaña, si ROSA2018
  // la formuló, queda aprobada con el plan. Las dos cosas las hace
  // `aprobar_plan` en rosa/estado/acciones.py y hasta el 29 de septiembre de
  // 2026 este lado no, así que la misión se quedaba sin aprobar para siempre y
  // la pantalla seguía pidiéndolo.
  const inv = estado.investigaciones.find((x) => x.id === corrida.investigacionId);
  if (inv?.mision && !inv.mision.aprobadaEn) {
    siguiente = {
      ...siguiente,
      investigaciones: reemplazar(siguiente.investigaciones, inv.id, (x) => (x.mision ? { ...x, mision: { ...x.mision, aprobadaEn: ahora, aprobadaPor: quien } } : x)),
    };
    siguiente = conEvento(siguiente, inv.id, 'mision', 'Misión aprobada junto con el primer plan', `#/investigaciones/${inv.id}/investigacion`, ahora);
  }
  if (corrida.pregunta && !corrida.pregunta.aprobadaEn) {
    siguiente = { ...siguiente, corridas: reemplazar(siguiente.corridas, corrida.id, (c) => (c.pregunta ? { ...c, pregunta: { ...c.pregunta, aprobadaEn: ahora } } : c)) };
  }
  return conEvento(siguiente, corrida.investigacionId, 'corrida_estado', `Plan de la iteración ${it.numero} aprobado`, null, ahora);
}

export function fijarAutoaprobacionPlan(estado: EstadoRosa, corridaId: string, segundos: number | null): EstadoRosa {
  return { ...estado, corridas: reemplazar(estado.corridas, corridaId, (c) => ({ ...c, autoAprobarPlanSegundos: segundos })) };
}

/** Parar una pista sin parar la corrida (Claude Science no lo permite). */
export function detenerPista(estado: EstadoRosa, pistaId: string, indicacion: string): EstadoRosa {
  const nota = indicacion.trim();
  return {
    ...estado,
    iteraciones: estado.iteraciones.map((it) => ({
      ...it,
      pistas: it.pistas.map((p) =>
        p.id === pistaId && p.estado === 'en_curso'
          ? {
              ...p,
              estado: 'detenida',
              resumen: nota === '' ? 'Detenida por la investigadora' : `Detenida: ${nota}`,
              transcripcion: [...p.transcripcion, { t: p.transcripcion.length * 2_500, tipo: 'nota' as const, texto: nota === '' ? 'Detenida por la investigadora.' : `Detenida por la investigadora: ${nota}` }],
            }
          : p,
      ),
    })),
  };
}

/** Parar un proceso de computo con una indicacion que vuelve a ROSA2018. */
export function detenerProceso(estado: EstadoRosa, corridaId: string, procesoId: string, indicacion: string): EstadoRosa {
  const corrida = corridaDe(estado, corridaId);
  if (!corrida) return estado;
  let siguiente: EstadoRosa = {
    ...estado,
    corridas: reemplazar(estado.corridas, corridaId, (c) => ({ ...c, procesos: c.procesos.map((p) => (p.id === procesoId ? { ...p, estado: 'detenido' as const, cpu: 0, memoriaMb: 0 } : p)) })),
  };
  if (indicacion.trim() !== '') siguiente = dirigirCorrida(siguiente, corridaId, `Proceso detenido por la investigadora: ${indicacion.trim()}`);
  return siguiente;
}

/** Volver a un punto: una iteracion nueva que retoma el plan de una anterior
 *  (pasos a pendiente) y, si se pide, quita del modelo de mundo lo que ROSA2018
 *  anadio despues. La corrida original se conserva en el historial. */
export function volverAIteracion(estado: EstadoRosa, iteracionId: string, que: 'plan' | 'mundo' | 'ambos', ahora: number): EstadoRosa {
  const origen = estado.iteraciones.find((i) => i.id === iteracionId);
  if (!origen || origen.terminadaEn === null) return estado;
  const corrida = corridaDe(estado, origen.corridaId);
  if (!corrida) return estado;
  const actual = iteracionActualDe(estado, corrida);
  const numero = (actual?.numero ?? origen.numero) + 1;
  const base = que === 'mundo' ? actual?.plan ?? origen.plan : origen.plan;
  const plan: PasoPlan[] = base.map((p) => ({ ...p, id: nuevoId('paso'), estado: 'pendiente' as const, motivoFallo: null }));
  const nueva: Iteracion = {
    id: nuevoId('it'),
    corridaId: corrida.id,
    numero,
    empezadaEn: ahora,
    terminadaEn: null,
    plan,
    planAprobado: false,
    planPropuestoEn: ahora,
    pistas: [],
    presupuesto: { limite: origen.presupuesto.limite, usado: 0 },
    resumen: '',
  };
  const iteraciones = [
    ...estado.iteraciones.map((i) => (i.id === actual?.id && i.terminadaEn === null ? { ...i, terminadaEn: ahora, resumen: i.resumen || `Cerrada al volver a la iteración ${origen.numero}` } : i)),
    nueva,
  ];
  let hechos = estado.hechos;
  let cuestiones = estado.cuestiones ?? [];
  if (que === 'mundo' || que === 'ambos') {
    const limite = origen.terminadaEn;
    hechos = estado.hechos.filter((h) => !(h.investigacionId === corrida.investigacionId && h.actualizadoEn > limite && h.historial.every((m) => m.quien === 'Rosa')));
    // Misma regla para las cuestiones que ROSA2018 abrió después del punto (rosa/cuestiones.py podar_desde).
    const deRosa = (m: { quien?: string }) => (m.quien ?? 'Rosa') === 'Rosa';
    cuestiones = cuestiones
      .filter((c) => !(c.investigacionId === corrida.investigacionId && c.creadaEn > limite && c.historial.every(deRosa)))
      // Segunda mitad de `podar_desde`, que hasta el 29 de septiembre de 2026 no
      // estaba en este lado: en las cuestiones creadas ANTES del límite se
      // deshacen los movimientos posteriores hechos solo por ROSA2018. Una que
      // ROSA2018 dio por resuelta con un hecho que esta misma poda acaba de
      // borrar tiene que volver a abierta; si no, la pantalla enseña una
      // pregunta contestada con evidencia que ya no existe.
      .map((c) => {
        if (c.investigacionId !== corrida.investigacionId) return c;
        const posteriores = c.historial.filter((m) => m.fecha > limite);
        if (posteriores.length === 0 || !posteriores.every(deRosa)) return c;
        const historial = c.historial.filter((m) => m.fecha <= limite);
        const vuelta = posteriores[0]!.de;
        const estadoPrevio: Cuestion['estado'] = vuelta === 'abierta' || vuelta === 'resuelta' || vuelta === 'descartada' ? vuelta : 'abierta';
        if (estadoPrevio !== 'resuelta') return { ...c, historial, estado: estadoPrevio, resueltaEn: null, resolucion: null, actualizadaEn: limite };
        // Vuelve a la resolución que tenía en el límite, no a la posterior.
        const ultimo = [...historial].reverse().find((m) => m.a === 'resuelta');
        return {
          ...c,
          historial,
          estado: estadoPrevio,
          resueltaEn: ultimo ? ultimo.fecha : limite,
          resolucion: ultimo ? { por: ultimo.por ?? ultimo.quien ?? 'Rosa', motivo: ultimo.motivo || 'Resuelta' } : c.resolucion,
          actualizadaEn: limite,
        };
      });
  }
  const siguiente: EstadoRosa = {
    ...estado,
    iteraciones,
    cuestiones,
    hechos,
    corridas: reemplazar(estado.corridas, corrida.id, (c) => ({ ...c, iteracionActual: numero, estado: c.estado === 'en_marcha' || c.estado === 'esperando_plan' ? 'esperando_plan' : c.estado })),
  };
  return conEvento(siguiente, corrida.investigacionId, 'corrida_estado', `Se volvió a la iteración ${origen.numero} (${que}); la ${numero} espera tu aprobación del plan`, null, ahora);
}

/* ---------------------------------------------------------------------
   Permisos, incidencias y autonomía
   --------------------------------------------------------------------- */

export function resolverSolicitud(
  estado: EstadoRosa,
  solicitudId: string,
  decision: 'conceder' | 'denegar',
  alcance: AlcancePermiso | null,
  ahora: number,
  argumentos?: Record<string, string>,
): EstadoRosa {
  const solicitud = estado.solicitudes.find((s) => s.id === solicitudId);
  if (!solicitud || solicitud.estado !== 'pendiente') return estado;
  if (decision === 'conceder' && (alcance === null || !solicitud.alcances.includes(alcance))) return estado;
  const corrida = corridaDe(estado, solicitud.corridaId);

  let siguiente: EstadoRosa = {
    ...estado,
    solicitudes: reemplazar(estado.solicitudes, solicitudId, (s) => ({
      ...s,
      estado: decision === 'conceder' ? 'concedida' : 'denegada',
      alcanceConcedido: decision === 'conceder' ? alcance : null,
      resueltaEn: ahora,
      argumentos: argumentos ? s.argumentos.map((a) => (a.editable && argumentos[a.nombre] !== undefined ? { ...a, valor: argumentos[a.nombre]!.trim() || a.valor } : a)) : s.argumentos,
    })),
  };

  if (decision === 'conceder' && alcance !== null && alcance !== 'una_vez') {
    siguiente = {
      ...siguiente,
      permisos: [
        ...siguiente.permisos,
        {
          id: nuevoId('per'),
          tipo: solicitud.tipo,
          recurso: solicitud.recurso,
          alcance,
          concedidoEn: ahora,
          investigacionId: alcance === 'siempre' ? null : corrida?.investigacionId ?? null,
        },
      ],
    };
  }

  if (solicitud.tipo === 'aceptar_hipotesis' && solicitud.hipotesisId && decision === 'conceder') {
    siguiente = revisarHipotesis(siguiente, solicitud.hipotesisId, 'aceptar', 'Aceptada desde la tarjeta de permiso', 'Investigadora', ahora, false);
  }

  const quedan = siguiente.solicitudes.some((s) => s.corridaId === solicitud.corridaId && s.estado === 'pendiente');
  siguiente = {
    ...siguiente,
    corridas: reemplazar(siguiente.corridas, solicitud.corridaId, (c) => (c.estado === 'esperando_aprobacion' && !quedan ? { ...c, estado: 'en_marcha' } : c)),
  };
  return corrida ? conEvento(siguiente, corrida.investigacionId, 'permiso_resuelto', `${decision === 'conceder' ? 'Permitido' : 'Denegado'}: ${solicitud.recurso}`, null, ahora) : siguiente;
}

/** Varias solicitudes a la vez con el mismo alcance. Las que no lo ofrecen se saltan. */
export function resolverSolicitudes(estado: EstadoRosa, ids: string[], decision: 'conceder' | 'denegar', alcance: AlcancePermiso | null, ahora: number): EstadoRosa {
  let e = estado;
  for (const id of ids) {
    const s = e.solicitudes.find((x) => x.id === id);
    if (!s) continue;
    if (decision === 'conceder' && alcance !== null && !s.alcances.includes(alcance)) continue;
    e = resolverSolicitud(e, id, decision, alcance, ahora);
  }
  return e;
}

export function revocarPermiso(estado: EstadoRosa, permisoId: string): EstadoRosa {
  return { ...estado, permisos: estado.permisos.filter((p) => p.id !== permisoId) };
}

export function resolverIncidencia(estado: EstadoRosa, incidenciaId: string, resolucion: string, ahora: number): EstadoRosa {
  const inc = estado.incidencias.find((i) => i.id === incidenciaId);
  if (!inc || inc.estado !== 'pendiente') return estado;
  const texto = resolucion.trim() === '' ? inc.alternativa ?? 'Resuelta por la investigadora' : resolucion.trim();
  const corrida = corridaDe(estado, inc.corridaId);
  const siguiente: EstadoRosa = {
    ...estado,
    incidencias: reemplazar(estado.incidencias, incidenciaId, (i) => ({ ...i, estado: 'resuelta', resueltaEn: ahora, resolucion: texto })),
  };
  return corrida ? conEvento(siguiente, corrida.investigacionId, 'incidencia', `Incidencia resuelta: ${inc.titulo} (${texto})`, null, ahora) : siguiente;
}

export function fijarAutonomia(estado: EstadoRosa, clase: ClaseAccion, nivel: NivelAutonomia): EstadoRosa {
  return { ...estado, autonomia: { ...estado.autonomia, [clase]: nivel } };
}

/** Si se han concedido tres o mas permisos del mismo tipo con alcance amplio,
 *  ROSA2018 puede proponer una regla. Devuelve las sugerencias. */
export function sugerenciasDeAutonomia(estado: EstadoRosa): { tipo: string; veces: number }[] {
  const cuenta = new Map<string, number>();
  for (const p of estado.permisos) if (p.alcance === 'siempre' || p.alcance === 'esta_investigacion') cuenta.set(p.tipo, (cuenta.get(p.tipo) ?? 0) + 1);
  return [...cuenta.entries()].filter(([, n]) => n >= 3).map(([tipo, veces]) => ({ tipo, veces }));
}

/* ---------------------------------------------------------------------
   Hipotesis
   --------------------------------------------------------------------- */

export type AccionRevision = 'aceptar' | 'descartar' | 'refinar' | 'reabrir' | 'no_puedo_juzgar';

const ESTADO_TRAS_ACCION: Record<AccionRevision, Hipotesis['estado']> = {
  aceptar: 'aceptada',
  descartar: 'descartada',
  refinar: 'refinar',
  reabrir: 'en_revision',
  no_puedo_juzgar: 'aclarando',
};

const ACCION_REVISION: Record<AccionRevision, Revision['accion']> = {
  aceptar: 'aceptada',
  descartar: 'descartada',
  refinar: 'refinar',
  reabrir: 'reabierta',
  no_puedo_juzgar: 'no_puedo_juzgar',
};

export function revisarHipotesis(
  estado: EstadoRosa,
  hipotesisId: string,
  accion: AccionRevision,
  nota: string,
  quien: string,
  ahora: number,
  aCiegas = false,
  revisionHumana: Omit<RevisionHumana, 'fecha' | 'quien'> | null = null,
  versionEsperada: number | null = null,
): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h) return estado;
  // La decisión se tomó mirando una versión; si la hipótesis cambió, no se aplica.
  if (versionEsperada !== null && versionEsperada !== (h.version ?? 1)) return estado;
  // Idempotencia: una decisión que ya está aplicada (aceptar sobre una aceptada,
  // descartar sobre una descartada) no se registra dos veces. Pasa cuando la
  // persona pulsa dos veces, o cuando la interfaz reaplica una decisión
  // pendiente sobre un estado del servidor que ya la trae. Misma regla que
  // `revisar_hipotesis` en rosa/estado/acciones.py.
  if (h.estado === ESTADO_TRAS_ACCION[accion]) return estado;
  const notaLimpia = nota.trim();
  // Descartar y "no puedo juzgar" exigen motivo: es lo que queda para que
  // nadie vuelva a proponer lo mismo, o lo que ROSA2018 tiene que aclarar.
  if ((accion === 'descartar' || accion === 'no_puedo_juzgar') && notaLimpia === '') return estado;

  const revision: Revision = { fecha: ahora, quien, accion: ACCION_REVISION[accion], nota: notaLimpia, aCiegas };
  const mensajes = notaLimpia === '' ? h.procedencia.mensajes : [...h.procedencia.mensajes, { id: nuevoId('m'), de: 'investigadora' as const, texto: notaLimpia, creadoEn: ahora }];
  const tieneRevision = revisionHumana !== null && (revisionHumana.supuestosCuestionados.trim() !== '' || revisionHumana.literaturaQueFalta.trim() !== '' || revisionHumana.problemaExperimental.trim() !== '');
  const revisionesHumanas = tieneRevision && revisionHumana ? [...h.revisionesHumanas, { ...revisionHumana, fecha: ahora, quien }] : h.revisionesHumanas;

  const hipotesis = reemplazar(estado.hipotesis, hipotesisId, (x) => ({
    ...x,
    estado: ESTADO_TRAS_ACCION[accion],
    revisiones: [...x.revisiones, revision],
    revisionesHumanas,
    procedencia: { ...x.procedencia, mensajes },
  }));

  const sinEntrada = estado.hechos.filter((e) => !(e.tipo === 'hipotesis' && e.id === `he-${hipotesisId}`));
  let hechos = sinEntrada;
  if (accion === 'aceptar' || accion === 'descartar') {
    const entrada: HechoMundo = {
      id: `he-${hipotesisId}`,
      investigacionId: h.investigacionId,
      tipo: 'hipotesis',
      tema: 'Revisión humana',
      enunciado: accion === 'aceptar' ? `Hipótesis aceptada para perseguir: ${h.titulo}` : h.titulo,
      estado: accion === 'aceptar' ? 'abierto' : 'descartado',
      origen: 'inferencia',
      procedencia: h.procedencia.fuentes.map((f) => ({ fuenteId: f.id, referencia: f.referencia, pagina: f.pagina })),
      motivoDescarte: accion === 'descartar' ? `${notaLimpia} (${quien})` : null,
      actualizadoEn: ahora,
      prioridad: accion === 'aceptar' ? 1 : 9,
      citas: [],
      historial: [{ fecha: ahora, de: null, a: accion === 'aceptar' ? 'abierto' : 'descartado', quien, motivo: notaLimpia || (accion === 'aceptar' ? 'Aceptada' : 'Descartada') }],
    };
    hechos = [...sinEntrada, entrada];
  }
  const siguiente = { ...estado, hipotesis, hechos };
  const textos: Record<AccionRevision, string> = {
    aceptar: `Aceptada: ${h.titulo}`,
    descartar: `Descartada: ${h.titulo}`,
    refinar: `Pedida refinación: ${h.titulo}`,
    reabrir: `Reabierta: ${h.titulo}`,
    no_puedo_juzgar: `Marcada como "no puedo juzgar": ${h.titulo}`,
  };
  return conEvento(siguiente, h.investigacionId, 'hipotesis_decidida', textos[accion], `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

/** ROSA2018 responde a un "no puedo juzgar": aclara y la devuelve a revision.
 *  Lo dispara la simulacion; en produccion, el bucle. */
export function aclararHipotesis(estado: EstadoRosa, hipotesisId: string, aclaracion: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h || h.estado !== 'aclarando') return estado;
  return {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (x) => ({
      ...x,
      estado: 'en_revision',
      revisiones: [...x.revisiones, { fecha: ahora, quien: 'Rosa', accion: 'aclarada', nota: aclaracion, aCiegas: false }],
      procedencia: { ...x.procedencia, mensajes: [...x.procedencia.mensajes, { id: nuevoId('m'), de: 'rosa' as const, texto: aclaracion, creadoEn: ahora }] },
    })),
  };
}

export function votarRelevancia(estado: EstadoRosa, hipotesisId: string, voto: 'alta' | 'media' | 'baja'): EstadoRosa {
  return { ...estado, hipotesis: reemplazar(estado.hipotesis, hipotesisId, (h) => ({ ...h, relevancia: { ...h.relevancia, votoHumano: voto } })) };
}

/** Pedir una revision automatica ahora. Deja el rastro; en produccion la
 *  hace el revisor del bucle. */
export function solicitarRevision(estado: EstadoRosa, hipotesisId: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h) return estado;
  const siguiente: EstadoRosa = {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (x) => ({
      ...x,
      ultimaRevisionAutomatica: ahora,
      revisionesAutomaticas: x.revisionesAutomaticas.map((r) => (r.estado === 'pendiente' ? { ...r, estado: 'hecha' as const, fecha: ahora, resumen: 'Revisada a petición de la investigadora: sin hallazgos nuevos.' } : r)),
      procedencia: { ...x.procedencia, mensajes: [...x.procedencia.mensajes, { id: nuevoId('m'), de: 'revisor' as const, texto: 'Revisión pedida por la investigadora: releidas las afirmaciones, el plan y el registro. Sin hallazgos nuevos.', creadoEn: ahora }] },
    })),
  };
  return conEvento(siguiente, h.investigacionId, 'revision_automatica', `Revisión pedida sobre: ${h.titulo}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

/** Pedir que ROSA2018 vuelva a revisar las hipótesis vivas cuyos supuestos no
 *  están al día (la misma regla que rosa/vigencia.py, en lib/desbloqueo.ts).
 *  Aquí solo queda la petición con su fecha; la revisión la hace el bucle, con
 *  el presupuesto de la última corrida de cada investigación. */
export function reevaluarSupuestos(estado: EstadoRosa, investigacionId: string | null, ahora: number): EstadoRosa {
  const porInvestigacion = new Map<string, number>();
  const hipotesis = estado.hipotesis.map((h) => {
    if (!esViva(h) || (investigacionId && h.investigacionId !== investigacionId)) return h;
    if (vigencia(h).alDia || h.supuestosEvaluados?.pedidaEn) return h;
    porInvestigacion.set(h.investigacionId, (porInvestigacion.get(h.investigacionId) ?? 0) + 1);
    const sello: SelloSupuestos = h.supuestosEvaluados
      ? { ...h.supuestosEvaluados, pedidaEn: ahora, noAtendida: null }
      : { en: null, regla: 0, afirmaciones: null, fallidos: 0, pedidaEn: ahora, noAtendida: null, reconstruido: false };
    return {
      ...h,
      supuestosEvaluados: sello,
      procedencia: { ...h.procedencia, mensajes: [...h.procedencia.mensajes, { id: nuevoId('m'), de: 'revisor' as const, texto: 'Reevaluación de supuestos pedida desde Qué desbloquea más: no estaban al día. ROSA2018 los reevalúa con la regla de hoy y vuelve a pasar el Killer.', creadoEn: ahora }] },
    };
  });
  let siguiente: EstadoRosa = { ...estado, hipotesis };
  for (const [inv, n] of porInvestigacion) {
    siguiente = conEvento(siguiente, inv, 'revision_automatica', `Reevaluación de supuestos pedida para ${n} hipótesis cuyos supuestos no estaban al día.`, null, ahora);
  }
  return siguiente;
}

/** Estados de una recuperación de citas en los que el supervisor aún tiene
 *  trabajo (rosa/recuperacion_citas.py ESTADOS_PENDIENTES). */
export const RECUPERACION_PENDIENTE: ReadonlySet<RecuperacionCitas['estado']> = new Set(['pedida', 'en_curso', 'en_espera']);

/** Pide la recuperación de las afirmaciones bloqueadas por reglas que ya no
 *  valen, de toda la investigación o de una corrida. No abre otra si hay una
 *  pendiente; la anterior se guarda. Misma regla que `pedir_recuperacion_citas`
 *  en rosa/estado/acciones.py. */
export function pedirRecuperacionCitas(estado: EstadoRosa, investigacionId: string, corridaId: string | null, quien: string, ahora: number): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  if (!inv) return estado;
  if (corridaId && !estado.corridas.some((c) => c.id === corridaId && c.investigacionId === investigacionId)) return estado;
  const actual = inv.recuperacionCitas;
  if (actual && RECUPERACION_PENDIENTE.has(actual.estado)) return estado;
  const anteriores = [...(actual ? [actual] : []), ...(inv.recuperacionesAnteriores ?? [])].slice(0, 5);
  const registro: RecuperacionCitas = {
    estado: 'pedida', pedidaEn: ahora, quien: quien.trim() || 'persona', corridaId: corridaId || null, empezadaEn: null, terminadaEn: null, fase: null,
    total: 0, revisadas: 0, recuento: {}, desbloqueadas: 0, enlazadas: 0, hipotesisConEvidencia: [], nacidas: [], reconcluidas: [], llamadas: 0, notas: [], motivo: null,
  };
  const investigaciones = estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, recuperacionCitas: registro, recuperacionesAnteriores: anteriores } : i));
  const alcance = corridaId ? 'de esta corrida' : 'de todas las corridas de la investigación';
  return conEvento({ ...estado, investigaciones }, investigacionId, 'revision_automatica', `Recuperación de citas pedida: ROSA2018 vuelve a juzgar las afirmaciones bloqueadas ${alcance} con reglas que ya no valen, enlaza a las hipótesis las que salgan sostenidas y rehace sus conclusiones.`, `#/investigaciones/${investigacionId}/citas`, ahora);
}

/** Replicar la hipotesis con N trayectorias independientes. Gasta presupuesto;
 *  la simulacion avanza las trayectorias. */
export function replicarHipotesis(estado: EstadoRosa, hipotesisId: string, total: number, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h || (h.replicacion && h.replicacion.estado === 'en_curso') || total < 2) return estado;
  const siguiente: EstadoRosa = {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (x) => ({
      ...x,
      replicacion: { total, hechas: 0, sostienen: 0, contradicen: 0, estado: 'en_curso', empezadaEn: ahora },
      revisiones: [...x.revisiones, { fecha: ahora, quien: 'Investigadora', accion: 'replicada', nota: `${total} trayectorias independientes`, aCiegas: false }],
      coste: { ...x.coste, analisis: x.coste.analisis + total * 1.2 },
    })),
  };
  return conEvento(siguiente, h.investigacionId, 'revision_automatica', `Replicación x${total} lanzada sobre: ${h.titulo}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

export interface DatosHipotesisHumana {
  titulo: string;
  enunciado: string;
  mecanismo: string;
  biomarcador: string;
  cohorte: string;
  diseno: string;
  cluster: string;
}

/** La investigadora mete su propia hipotesis al torneo. Entra con Elo
 *  inicial, marcada como humana, y ROSA2018 la trata como a las demas. */
export function proponerHipotesis(estado: EstadoRosa, investigacionId: string, datos: DatosHipotesisHumana, quien: string, ahora: number): { estado: EstadoRosa; id: string | null } {
  if (datos.titulo.trim() === '' || datos.enunciado.trim() === '' || (datos.biomarcador.trim() === '' && datos.cohorte.trim() === '')) return { estado, id: null };
  const corrida = estado.corridas.filter((c) => c.investigacionId === investigacionId).sort((a, b) => b.numero - a.numero)[0];
  const iteracion = corrida?.iteracionActual ?? 0;
  const id = nuevoId('hip');
  const h: Hipotesis = {
    id,
    investigacionId,
    titulo: datos.titulo.trim(),
    enunciado: datos.enunciado.trim(),
    mecanismo: datos.mecanismo.trim(),
    comprobacion: { biomarcador: datos.biomarcador.trim(), cohorte: datos.cohorte.trim(), diseno: datos.diseno.trim() },
    estado: 'propuesta',
    elo: 1_500,
    historialElo: [{ iteracion, elo: 1_500 }],
    rivales: [],
    novedad: {
      openTargets: { estado: 'sin_evidencia', detalle: 'Pendiente de comprobar en la siguiente iteración' },
      ensayos: { estado: 'sin_ensayo', detalle: 'Pendiente de comprobar', nct: null },
      agora: { estado: 'no_nominada', detalle: 'Pendiente de comprobar' },
      precedente: { estado: 'sin_precedente', detalle: 'Pendiente de comprobar' },
    },
    afirmaciones: [],
    procedencia: {
      mensajes: [{ id: nuevoId('m'), de: 'investigadora', texto: `Hipótesis propuesta por ${quien}. ROSA2018 la revisará y la meterá al torneo en la siguiente iteración.`, creadoEn: ahora }],
      codigo: '',
      registro: [`${new Date(ahora).toISOString()} hipótesis humana añadida por ${quien}`],
      entorno: { lenguaje: 'Python', version: '3.12.14', paquetes: [], modelos: [] },
      fuentes: [],
    },
    hallazgos: [],
    revisiones: [{ fecha: ahora, quien, accion: 'propuesta', nota: 'Propuesta por una persona', aCiegas: false }],
    creadaEn: ahora,
    iteracion,
    origen: 'humana',
    derivadaDe: null,
    cluster: datos.cluster.trim() || 'Sin cluster',
    evidenciaEstadistica: 'no_aplica',
    relevancia: { justificacion: 'Propuesta por la investigadora; ROSA2018 la justificara al revisarla.', votoHumano: 'alta' },
    partidos: [],
    revisionesAutomaticas: (['inicial', 'completa', 'profunda', 'observacion', 'simulacion', 'torneo'] as const).map((tipo) => ({ tipo, estado: 'pendiente' as const, resumen: '', fecha: null })),
    supuestos: [],
    revisionesHumanas: [],
    replicacion: null,
    ultimaRevisionAutomatica: null,
    coste: { literatura: 0, analisis: 0 },
    experimento: null,
    prerregistradaEn: ahora,
  };
  const siguiente = conEvento({ ...estado, hipotesis: [...estado.hipotesis, h] }, investigacionId, 'hipotesis_nueva', `Hipótesis propuesta por ${quien}: ${h.titulo}`, `#/investigaciones/${investigacionId}/hipotesis/${id}`, ahora);
  return { estado: siguiente, id };
}

/* ---------------------------------------------------------------------
   Experimentos (traspaso al laboratorio)
   --------------------------------------------------------------------- */

/** Asignar el experimento a un laboratorio lo prerregistra: la hipotesis, el
 *  protocolo y los criterios quedan congelados con fecha en un artefacto,
 *  antes de que exista ningun dato. Misma regla en el servidor. */
export function asignarExperimento(estado: EstadoRosa, hipotesisId: string, laboratorio: string, ahora: number = Date.now()): EstadoRosa {
  const lab = laboratorio.trim();
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (lab === '' || !h || !h.experimento) return estado;
  // Misma regla que rosa/estado/acciones.py: sin criterio de confirmación y de refutación no se prerregistra.
  // Con el contrato del experimento también vale una lectura que tenga los dos criterios (rosa/experimento.py es_interpretable).
  const interpretable =
    ((h.experimento.confirma ?? '').trim() !== '' && (h.experimento.refuta ?? '').trim() !== '') ||
    (h.experimento.ensayo ?? '').trim() !== '' ||
    normalizarContrato(h.experimento).lecturas.some((l) => l.queConfirma !== '' && l.queRefuta !== '');
  if (!h.experimento.prerregistradoEn && !interpretable) {
    return conEvento(estado, h.investigacionId, 'incidencia', `No se puede prerregistrar «${h.titulo.slice(0, 60)}»: faltan el criterio de confirmación o el de refutación`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
  }
  let siguiente: EstadoRosa = {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (x) => ({ ...x, experimento: { ...x.experimento!, laboratorio: lab, estado: 'asignado' } })),
  };
  if (!h.experimento.prerregistradoEn) {
    const corrida = estado.corridas.filter((c) => c.investigacionId === h.investigacionId).sort((a, b) => b.numero - a.numero)[0];
    const r = guardarArtefacto(siguiente, h.investigacionId, `Prerregistro: ${h.titulo.slice(0, 80)}`, 'informe', textoPrerregistro(h, lab, ahora, corrida?.arnes), `Congelado al asignarlo a ${lab}`, corrida?.iteracionActual ?? h.iteracion, ahora);
    // El hash de las lecturas se congela con el prerregistro: una enmienda posterior se nota porque el hash actual ya no coincide.
    const hash = hashLecturas(h.experimento);
    siguiente = {
      ...r.estado,
      hipotesis: reemplazar(r.estado.hipotesis, hipotesisId, (x) => ({ ...x, experimento: { ...x.experimento!, prerregistradoEn: ahora, prerregistroArtefactoId: r.id, hashLecturas: hash } })),
    };
    siguiente = conEvento(siguiente, h.investigacionId, 'hipotesis_decidida', `Experimento prerregistrado y asignado a ${lab}: ${h.titulo}`, `#/investigaciones/${h.investigacionId}/artefactos/${r.id}`, ahora);
  }
  return siguiente;
}

export function resolverHallazgoRegistro(estado: EstadoRosa, iteracionId: string, hallazgoId: string, nuevoEstado: 'atendido' | 'descartado' | 'abierto', respuesta: string, quien: string, ahora: number): EstadoRosa {
  const it = estado.iteraciones.find((i) => i.id === iteracionId);
  if (!it?.revisionRegistro || !it.revisionRegistro.hallazgos.some((h) => h.id === hallazgoId)) return estado;
  const hallazgos = it.revisionRegistro.hallazgos.map((h) => (h.id === hallazgoId ? { ...h, estado: nuevoEstado, respuesta: respuesta.trim().slice(0, 400), resueltoPor: quien.trim() || 'persona', resueltoEn: ahora } : h));
  // 'rebatido' cuenta como abierto: la rebatida la escribe quien escribió el texto.
  const revision = { ...it.revisionRegistro, hallazgos, estado: hallazgos.some((h) => ['abierto', 'rebatido'].includes(h.estado ?? 'abierto')) ? ('con_hallazgos' as const) : ('limpia' as const) };
  return { ...estado, iteraciones: estado.iteraciones.map((i) => (i.id === iteracionId ? { ...i, revisionRegistro: revision } : i)) };
}

/** Misma regla que `decidir_tarea`: una persona acepta o rechaza una tarea de la
 *  cola de triaje, y el rechazo pide motivo. */
export function decidirTarea(estado: EstadoRosa, tareaId: string, nuevoEstado: 'aceptada' | 'rechazada', motivo: string, quien: string, ahora: number): EstadoRosa {
  const t = (estado.tareas ?? []).find((x) => x.id === tareaId);
  if (!t || t.estado === 'hecha' || t.estado === 'programada') return estado;
  if (nuevoEstado === 'rechazada' && !motivo.trim()) return estado;
  const firma = quien.trim() || 'persona';
  const texto = motivo.trim() ? `${firma}: ${motivo.trim().slice(0, 280)}` : `${firma} la aceptó`;
  const nueva = { ...t, estado: nuevoEstado, motivo: texto, quien: firma, historial: [...t.historial, { estado: nuevoEstado, motivo: texto, fecha: ahora }] };
  return { ...estado, tareas: (estado.tareas ?? []).map((x) => (x.id === tareaId ? nueva : x)) };
}

export const NIVELES_PERMISO_CONECTOR: NivelPermisoConector[] = ['permitir', 'solo_persona', 'bloquear'];

/** Misma regla que `fijar_permiso_conector`: cambia el permiso y deja un cambio de politica. */
export function fijarPermisoConector(estado: EstadoRosa, nombre: string, nivel: NivelPermisoConector, quien: string, ahora: number): EstadoRosa {
  const c = (estado.conectores ?? []).find((x) => x.nombre === nombre);
  if (!c || !NIVELES_PERMISO_CONECTOR.includes(nivel)) return estado;
  const anterior = estado.permisosConectores?.[nombre] ?? 'permitir';
  if (anterior === nivel) return estado;
  return {
    ...estado,
    permisosConectores: { ...(estado.permisosConectores ?? {}), [nombre]: nivel },
    conectores: (estado.conectores ?? []).map((x) => (x.nombre === nombre ? { ...x, permiso: nivel } : x)),
    aprendizaje: [...(estado.aprendizaje ?? []), { id: nuevoId('apr'), investigacionId: null, nivel: 3, tipo: 'politica', descripcion: `Conector ${c.fuente}: de ${anterior} a ${nivel}`, origen: `conector:${nombre}`, estado: 'promovido', evaluacion: null, quien, fecha: ahora, resueltoEn: ahora, resueltoPor: quien }],
  };
}

export function anadirMemoria(estado: EstadoRosa, investigacionId: string, texto: string, quien: string, ahora: number): EstadoRosa {
  const limpio = texto.trim();
  if (limpio === '' || limpio.length > 400 || !estado.investigaciones.some((i) => i.id === investigacionId)) return estado;
  return { ...estado, investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, memoria: [...(i.memoria ?? []), { id: nuevoId('mem'), texto: limpio, quien: quien.trim() || 'persona', fecha: ahora }] } : i)) };
}

export function quitarMemoria(estado: EstadoRosa, investigacionId: string, memoriaId: string): EstadoRosa {
  return { ...estado, investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, memoria: (i.memoria ?? []).filter((m) => m.id !== memoriaId) } : i)) };
}

export const ESTADOS_AREA: EstadoArea[] = ['propuesta', 'elegida', 'pausada', 'sin_explorar'];

/** Misma regla que `cambiar_estado_area` en el servidor: pausar exige la
 *  condicion de reapertura; asignar a una campana exige que sea de esta
 *  investigacion; todo cambio queda en el historial del area. */
export function cambiarEstadoArea(estado: EstadoRosa, investigacionId: string, areaId: string, nuevoEstado: EstadoArea | null, quien: string, ahora: number, condicionReapertura = '', corridaId: string | null | undefined = undefined, motivo = ''): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  const area = inv?.mision?.areas?.find((a) => a.id === areaId);
  if (!inv || !inv.mision || !area) return estado;
  let a: AreaInvestigacion = { ...area, historial: [...(area.historial ?? [])] };
  let cambio = false;
  let campana: Corrida | undefined;
  if (nuevoEstado !== null) {
    if (!ESTADOS_AREA.includes(nuevoEstado)) return estado;
    if (nuevoEstado === 'pausada' && condicionReapertura.trim() === '') return estado;
    if (nuevoEstado !== a.estado) {
      a.historial!.push({ fecha: ahora, de: a.estado, a: nuevoEstado, quien: quien.trim() || 'persona', motivo: (motivo || condicionReapertura).trim().slice(0, 300) });
      a = { ...a, estado: nuevoEstado };
      cambio = true;
    }
    if (nuevoEstado === 'pausada') a = { ...a, condicionReapertura: condicionReapertura.trim().slice(0, 300) };
    else if (nuevoEstado === 'elegida' && a.condicionReapertura) a = { ...a, condicionReapertura: '' };
  }
  if (corridaId !== undefined) {
    campana = corridaId ? estado.corridas.find((c) => c.id === corridaId) : undefined;
    if (corridaId && (!campana || campana.investigacionId !== investigacionId)) return estado;
    if ((corridaId || null) !== (a.corridaId ?? null)) {
      a.historial!.push({ fecha: ahora, de: a.estado, a: a.estado, quien: quien.trim() || 'persona', motivo: campana ? `asignada a la campaña ${campana.numero}` : 'desasignada de su campaña' });
      a = { ...a, corridaId: corridaId || null };
      cambio = true;
    }
  }
  if (!cambio) return estado;
  const siguiente: EstadoRosa = { ...estado, investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, mision: { ...i.mision!, areas: (i.mision!.areas ?? []).map((x) => (x.id === areaId ? a : x)) } } : i)) };
  return conEvento(siguiente, investigacionId, 'mision', `Área '${a.titulo.slice(0, 60)}': ${a.estado.replace('_', ' ')}${corridaId && campana ? ` (campaña ${campana.numero})` : ''}`, `#/investigaciones/${investigacionId}/investigacion`, ahora);
}

export const CAMPOS_ENMENDABLES: CampoEnmendable[] = ['protocolo', 'ensayo', 'controles', 'tamanoMuestral', 'confirma', 'refuta', 'analisisPedido'];

/** Enmienda fechada del prerregistro: solo despues de congelarlo y antes de
 *  evaluar datos; guarda el texto anterior, quien y por que. Misma regla que
 *  `enmendar_experimento` en el servidor. */
export function enmendarExperimento(estado: EstadoRosa, hipotesisId: string, campo: CampoEnmendable, despues: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  const x = h?.experimento;
  if (!h || !x || !CAMPOS_ENMENDABLES.includes(campo) || !x.prerregistradoEn || x.resultado) return estado;
  const nuevo = despues.trim();
  const razon = motivo.trim();
  if (nuevo === '' || razon === '' || nuevo === (x[campo] ?? '')) return estado;
  const enmienda: EnmiendaPrerregistro = { fecha: ahora, quien: quien.trim() || 'persona', campo, antes: x[campo] ?? '', despues: nuevo, motivo: razon };
  const experimento: Experimento = { ...x, [campo]: nuevo };
  // Un registro antiguo (sin lecturas separadas) congela una lectura derivada del
  // ensayo y del par confirma/refuta: enmendar esos campos cambia esa lectura y
  // el hash congelado dejaría de ser cierto en silencio. Misma regla que el
  // servidor (rosa/estado/acciones.py enmendar_experimento): se recalcula y la
  // enmienda guarda el anterior y el nuevo. Sin hash previo no se inventa.
  if (x.hashLecturas) {
    const hashDespues = hashLecturas(experimento);
    if (hashDespues !== x.hashLecturas) {
      enmienda.hashAntes = x.hashLecturas;
      enmienda.hashDespues = hashDespues;
      experimento.hashLecturas = hashDespues;
    }
  }
  const enmiendas = [...(x.enmiendas ?? []), enmienda];
  const siguiente = {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (y) => ({ ...y, experimento: { ...experimento, enmiendas }, procedencia: { ...y.procedencia, registro: [...y.procedencia.registro, `${new Date(ahora).toISOString()} enmienda ${enmiendas.length} del prerregistro por ${quien}: ${campo} (${razon.slice(0, 80)})`] } })),
  };
  return conEvento(siguiente, h.investigacionId, 'hipotesis_decidida', `Enmienda ${enmiendas.length} del prerregistro (${campo}): ${h.titulo.slice(0, 80)}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

/* ---------------------------------------------------------------------
   Contrato del experimento (espejo de rosa/experimento.py)

   Conceptos por su nombre: una "lectura" es una medida del experimento con su
   criterio de confirmación y de refutación; el "compromiso de diana" es la
   lectura que demuestra que la intervención llegó a la diana y la modificó;
   el "propósito BEST" es para qué sirve el biomarcador según la clasificación
   BEST de la FDA y el NIH (riesgo, diagnóstico, monitorización, pronóstico,
   predicción de respuesta, farmacodinámico, seguridad). Las claves van sin
   tilde porque se comparan con el servidor; las etiquetas son lo que se lee.
   --------------------------------------------------------------------- */

export const TIPOS_LECTURA: Record<TipoLectura, { etiqueta: string; definicion: string }> = {
  compromiso_diana: { etiqueta: 'compromiso de diana', definicion: 'Demuestra que la intervención llegó a la diana y la modificó: ocupación, fosforilación, expresión o actividad de la molécula a la que apunta.' },
  viabilidad: { etiqueta: 'viabilidad', definicion: 'Demuestra que las células o el modelo sobrevivieron y toleraron la intervención; sin ella un efecto puede ser toxicidad.' },
  funcion_mecanismo: { etiqueta: 'función o mecanismo', definicion: 'Mide el proceso biológico que la hipótesis propone, en la dirección que predice (por ejemplo, fagocitosis, secreción de citoquinas, sinapsis).' },
  biomarcador: { etiqueta: 'biomarcador', definicion: 'Una medida indirecta del estado biológico que se puede tomar en personas (por ejemplo, GFAP en plasma, PET de amiloide).' },
  seguridad: { etiqueta: 'seguridad', definicion: 'Señales de daño o de efectos adversos de la intervención (por ejemplo, muerte celular fuera de la diana, microhemorragias).' },
};

export const SISTEMAS_EXPERIMENTALES: Record<TipoSistema, { etiqueta: string; definicion: string; queNoRepresenta: string; intervencional: boolean }> = {
  observacional_humano: { etiqueta: 'observacional en humanos', definicion: 'Cohorte, casos y controles o corte transversal en personas: se observa, no se interviene.', queNoRepresenta: 'no establece causalidad (confusión, causa inversa, selección) ni permite intervenir; las asociaciones dependen de la cohorte y de la plataforma de medida', intervencional: false },
  datos_publicos_existentes: { etiqueta: 'datos públicos ya existentes', definicion: 'Reanálisis de datos ya recogidos y de acceso abierto (GEO, SEA-AD abierto, OASIS con registro gratuito).', queNoRepresenta: 'no es una medición nueva ni un diseño pensado para esta pregunta; hereda la selección, los faltantes y la calidad de la cohorte original, y solo permite lo que sus variables contienen', intervencional: false },
  celulas_humanas_donante: { etiqueta: 'células humanas de donante', definicion: 'Células primarias de personas donantes (microglía, astrocitos o neuronas de tejido post mortem o de biopsia) en cultivo.', queNoRepresenta: 'no reproduce la interacción entre tipos celulares ni el entorno del tejido envejecido; las células cambian de fenotipo al cultivarse y el donante introduce variabilidad no controlada', intervencional: true },
  ipsc: { etiqueta: 'células iPSC', definicion: 'Neuronas o glía derivadas de células madre pluripotentes inducidas (iPSC) humanas, reprogramadas desde células de una persona.', queNoRepresenta: 'no reproduce la edad (su madurez epigenética es fetal) ni el entorno del tejido; hay variabilidad entre líneas y clones y el fondo genético de cada donante pesa', intervencional: true },
  organoide: { etiqueta: 'organoide cerebral', definicion: 'Agregado tridimensional de células derivadas de iPSC que se organiza en capas parecidas a las del cerebro en desarrollo.', queNoRepresenta: 'no tiene vasos sanguíneos ni microglía salvo que se añadan, no llega a la maduración adulta, tiene un núcleo necrótico por falta de oxígeno y varía entre lotes', intervencional: true },
  cocultivo: { etiqueta: 'cocultivo', definicion: 'Dos o más tipos celulares cultivados juntos para medir cómo se afectan entre sí (por ejemplo, neuronas con microglía).', queNoRepresenta: 'no reproduce la arquitectura del tejido ni las señales del resto del organismo; las proporciones entre tipos celulares las fija el protocolo, no la biología', intervencional: true },
  animal: { etiqueta: 'animal', definicion: 'Modelo animal, casi siempre ratón transgénico con amiloide o tau humanos.', queNoRepresenta: 'no reproduce la variación genética humana ni la edad; los ratones con amiloide no desarrollan tau ni neurodegeneración completa', intervencional: true },
  in_silico: { etiqueta: 'in silico', definicion: 'Modelo computacional o análisis sobre datos ya existentes, sin medir nada nuevo.', queNoRepresenta: 'no mide nada nuevo: hereda lo que contienen los datos de entrada y los supuestos del modelo; un resultado in silico es una predicción hasta que se mide', intervencional: false },
};

export const PROPOSITOS_BIOMARCADOR: Record<PropositoBiomarcador, { etiqueta: string; definicion: string }> = {
  susceptibilidad_riesgo: { etiqueta: 'susceptibilidad o riesgo', definicion: 'Indica el potencial de desarrollar la enfermedad en una persona que hoy no la tiene de forma clínicamente aparente (por ejemplo, ser portador de APOE e4).' },
  diagnostico: { etiqueta: 'diagnóstico', definicion: 'Detecta o confirma la presencia de la enfermedad, o identifica a las personas con un subtipo de ella (por ejemplo, PET de amiloide positivo).' },
  monitorizacion: { etiqueta: 'monitorización', definicion: 'Se mide de forma repetida para seguir el estado de la enfermedad o la exposición a una intervención o a un agente (por ejemplo, NfL en plasma cada seis meses).' },
  pronostico: { etiqueta: 'pronóstico', definicion: 'En personas que ya tienen la enfermedad, indica la probabilidad de un evento clínico, de recurrencia o de progresión (por ejemplo, p-tau217 alto y progresión a demencia).' },
  prediccion_respuesta: { etiqueta: 'predicción de respuesta', definicion: 'Identifica a las personas con más probabilidad que otras similares de tener un efecto favorable o desfavorable ante una intervención concreta (por ejemplo, APOE e4 y ARIA con anticuerpos antiamiloide).' },
  farmacodinamico_respuesta: { etiqueta: 'farmacodinámico o de respuesta', definicion: 'Cambia en respuesta a la exposición a una intervención: muestra que hubo una respuesta biológica, incluido el compromiso de diana (por ejemplo, caída de amiloide en PET tras el tratamiento).' },
  seguridad: { etiqueta: 'seguridad', definicion: 'Se mide antes o después de una exposición para indicar la probabilidad, la presencia o la extensión de una toxicidad como efecto adverso (por ejemplo, microhemorragias en RM).' },
};

export const NIVELES_DESENLACE: Record<NivelDesenlace, { etiqueta: string; definicion: string }> = {
  molecular: { etiqueta: 'molecular', definicion: 'Una molécula o su cantidad o estado: proteína, ARN, metabolito, fosforilación (por ejemplo, GFAP en plasma, p-tau181).' },
  celular: { etiqueta: 'celular', definicion: 'El comportamiento o el estado de células: viabilidad, morfología, fagocitosis, activación, sinapsis contadas (por ejemplo, microglía que fagocita amiloide).' },
  fisiologico_imagen: { etiqueta: 'fisiológico o de imagen', definicion: 'La función de un tejido u órgano medida en el organismo vivo: PET, resonancia, EEG, presión, volumen (por ejemplo, atrofia del hipocampo en resonancia).' },
  funcional_clinico: { etiqueta: 'funcional o clínico', definicion: 'Lo que la persona hace, siente o le ocurre: cognición, función en la vida diaria, síntomas, diagnóstico clínico, progresión a demencia.' },
};

/** Las cinco claves del contrato con su valor vacío (rosa/experimento.py normalizar_contrato). */
export interface ContratoExperimento {
  lecturas: LecturaExperimento[];
  sistema: SistemaExperimental | null;
  propositoBiomarcador: PropositoBiomarcador | null;
  nivelDesenlace: NivelDesenlace | null;
  puenteAlBeneficio: string;
}

type Vocabulario = Record<string, { etiqueta: string }>;

// Espacios como los entiende Python (\s incluye \x1c a \x1f y \x85, que el \s de JavaScript no).
const ESPACIOS = /[\s\u001c-\u001f\u0085]+/g;

/** Cadena limpia como `_texto` de rosa/experimento.py: null y lo que no es texto se convierten sin romper; una lista se une con espacios. */
function textoLimpio(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(textoLimpio).join(' ').replace(ESPACIOS, ' ').trim();
  return String(v).replace(ESPACIOS, ' ').trim();
}

function sinTildes(t: string): string {
  return t.normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Forma comparable de un nombre (`_clave` en Python): minúsculas, sin tildes, sin signos, un espacio. */
function claveComparable(t: unknown): string {
  return sinTildes(textoLimpio(t)).toLowerCase().replace(/[^\p{L}\p{N}_%]+/gu, ' ').replace(ESPACIOS, ' ').trim();
}

/** Lee un campo probando varios nombres (camelCase y snake_case), como `_campo` en Python. */
function campoDe(obj: unknown, ...nombres: string[]): unknown {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const n of nombres) if (Object.prototype.hasOwnProperty.call(o, n) && o[n] !== null && o[n] !== undefined) return o[n];
  return '';
}

/** La clave del vocabulario a la que corresponde un valor escrito de otra forma («Biomarcador», «iPSC», «compromiso de diana»); [texto tal cual, false] si no corresponde a ninguna. Es normalización de forma, no interpretación. */
function claveVocabulario(valor: unknown, vocabulario: Vocabulario): [string, boolean] {
  const t = textoLimpio(valor);
  if (t === '') return ['', false];
  const tiene = (k: string) => Object.prototype.hasOwnProperty.call(vocabulario, k);
  if (tiene(t)) return [t, true];
  const k = sinTildes(t).toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');
  if (tiene(k)) return [k, true];
  const ck = claveComparable(t);
  for (const [clave, v] of Object.entries(vocabulario)) if (ck === claveComparable(v.etiqueta)) return [clave, true];
  return [t, false];
}

/** La etiqueta legible de una clave; la clave con espacios si no está en el vocabulario. */
export function etiquetaContrato(vocabulario: Vocabulario, clave: unknown): string {
  const v = clave !== null && clave !== undefined ? vocabulario[String(clave)] : undefined;
  return v ? v.etiqueta : String(clave ?? '').replace(/_/g, ' ');
}

function lecturaLimpia(l: unknown): LecturaExperimento | null {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const extra = Object.fromEntries(Object.entries(l as Record<string, unknown>).filter(([k]) => k !== 'que_confirma' && k !== 'que_refuta'));
  const d: LecturaExperimento = {
    ...extra,
    nombre: textoLimpio(campoDe(l, 'nombre')),
    tipo: claveVocabulario(campoDe(l, 'tipo'), TIPOS_LECTURA)[0] as TipoLectura,
    queConfirma: textoLimpio(campoDe(l, 'queConfirma', 'que_confirma')),
    queRefuta: textoLimpio(campoDe(l, 'queRefuta', 'que_refuta')),
    control: textoLimpio(campoDe(l, 'control')),
    unidad: textoLimpio(campoDe(l, 'unidad')),
  };
  if (d.nombre === '' && d.queConfirma === '' && d.queRefuta === '') return null;
  return d;
}

function sistemaLimpio(s: unknown): SistemaExperimental | null {
  if (s === null || s === undefined || typeof s === 'number' || typeof s === 'boolean' || Array.isArray(s)) return null;
  if (typeof s === 'string') {
    const tipo = claveVocabulario(s, SISTEMAS_EXPERIMENTALES)[0];
    return tipo ? { tipo: tipo as TipoSistema, quePrueba: '', queNoRepresenta: '' } : null;
  }
  if (typeof s !== 'object') return null;
  const d: SistemaExperimental = {
    tipo: claveVocabulario(campoDe(s, 'tipo'), SISTEMAS_EXPERIMENTALES)[0] as TipoSistema,
    quePrueba: textoLimpio(campoDe(s, 'quePrueba', 'que_prueba')),
    queNoRepresenta: textoLimpio(campoDe(s, 'queNoRepresenta', 'que_no_representa')),
  };
  if (!d.tipo && !d.quePrueba && !d.queNoRepresenta) return null;
  return d;
}

/** El contrato del experimento con las claves nuevas rellenadas desde los
 *  campos antiguos cuando faltan (espejo de rosa/experimento.py
 *  normalizar_contrato). Un registro antiguo (solo ensayo, confirma, refuta,
 *  controles) da una lectura de tipo biomarcador con eso mismo; el sistema,
 *  el propósito, el nivel y el puente no se deducen. Un valor fuera del
 *  vocabulario queda vacío. Lo que no sea un objeto vale como experimento vacío. */
export function normalizarContrato(experimento: unknown): ContratoExperimento {
  const x = experimento && typeof experimento === 'object' && !Array.isArray(experimento) ? (experimento as Record<string, unknown>) : {};
  let lecturas: LecturaExperimento[] = Array.isArray(x.lecturas) ? x.lecturas.map(lecturaLimpia).filter((l): l is LecturaExperimento => l !== null) : [];
  if (lecturas.length === 0) {
    const ensayo = textoLimpio(x.ensayo);
    const confirma = textoLimpio(x.confirma);
    const refuta = textoLimpio(x.refuta);
    if (ensayo || confirma || refuta) lecturas = [{ nombre: ensayo || 'medida principal', tipo: 'biomarcador', queConfirma: confirma, queRefuta: refuta, control: textoLimpio(x.controles), unidad: '' }];
  }
  const delVocabulario = (clave: 'propositoBiomarcador' | 'nivelDesenlace', vocabulario: Vocabulario): string | null => {
    const [valor, enVocabulario] = claveVocabulario(textoLimpio(x[clave]), vocabulario);
    return valor && enVocabulario ? valor : null;
  };
  return {
    lecturas,
    sistema: sistemaLimpio(x.sistema),
    propositoBiomarcador: delVocabulario('propositoBiomarcador', PROPOSITOS_BIOMARCADOR) as PropositoBiomarcador | null,
    nivelDesenlace: delVocabulario('nivelDesenlace', NIVELES_DESENLACE) as NivelDesenlace | null,
    puenteAlBeneficio: textoLimpio(x.puenteAlBeneficio),
  };
}

/** La lista canónica de lecturas que se congela al prerregistrar (espejo de
 *  rosa/experimento.py lecturas_para_hash): solo las seis claves del contrato,
 *  ordenadas por tipo, nombre y criterios; la misma lista con las lecturas en
 *  otro orden o con claves de más. */
export function lecturasParaHash(experimento: unknown): LecturaExperimento[] {
  const canonicas = normalizarContrato(experimento).lecturas.map((l) => ({
    nombre: textoLimpio(l.nombre),
    tipo: textoLimpio(l.tipo) as TipoLectura,
    queConfirma: textoLimpio(l.queConfirma),
    queRefuta: textoLimpio(l.queRefuta),
    control: textoLimpio(l.control),
    unidad: textoLimpio(l.unidad),
  }));
  // Comparación por punto de código, como la de Python; localeCompare cambiaría el orden.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return canonicas.sort(
    (a, b) =>
      cmp(a.tipo, b.tipo) ||
      cmp(claveComparable(a.nombre), claveComparable(b.nombre)) ||
      cmp(claveComparable(a.queConfirma), claveComparable(b.queConfirma)) ||
      cmp(claveComparable(a.queRefuta), claveComparable(b.queRefuta)) ||
      cmp(claveComparable(a.control), claveComparable(b.control)) ||
      cmp(a.unidad, b.unidad),
  );
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 en hexadecimal de un texto (UTF-8), síncrono para poder usarlo en
 *  un reducer (WebCrypto solo lo da asíncrono). Mismo resultado que hashlib. */
export function sha256Hex(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  const largo = bytes.length;
  const relleno = (((largo + 9 + 63) / 64) | 0) * 64;
  const m = new Uint8Array(relleno);
  m.set(bytes);
  m[largo] = 0x80;
  const vista = new DataView(m.buffer);
  const bits = largo * 8;
  vista.setUint32(relleno - 8, Math.floor(bits / 0x100000000));
  vista.setUint32(relleno - 4, bits >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let desde = 0; desde < relleno; desde += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(desde + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 de la lista canónica de lecturas (espejo de rosa/experimento.py
 *  hash_lecturas y rosa/sello.py hash_canonico: JSON con claves ordenadas,
 *  sin espacios, sin escapar los caracteres no ASCII). */
export function hashLecturas(experimento: unknown): string {
  const canonico = JSON.stringify(lecturasParaHash(experimento).map((l) => ({ control: l.control, nombre: l.nombre, queConfirma: l.queConfirma, queRefuta: l.queRefuta, tipo: l.tipo, unidad: l.unidad })));
  return sha256Hex(canonico);
}

/** Las líneas del contrato para el prerregistro (espejo de rosa/experimento.py
 *  bloque_prerregistro): lecturas fijadas de antemano con su hash, sistema,
 *  propósito, nivel y puente. Lista vacía si no hay nada que congelar. */
export function bloquePrerregistro(experimento: unknown): string[] {
  const x = normalizarContrato(experimento);
  if (x.lecturas.length === 0 && !x.sistema && !x.propositoBiomarcador && !x.nivelDesenlace && x.puenteAlBeneficio === '') return [];
  const L = ['', '## Lecturas fijadas de antemano (contrato del experimento)'];
  if (x.lecturas.length > 0) {
    for (const l of lecturasParaHash(x)) {
      L.push(`- ${l.nombre || 'sin nombre'} [${etiquetaContrato(TIPOS_LECTURA, l.tipo)}${l.unidad ? `, ${l.unidad}` : ''}]: confirma si ${l.queConfirma || 'sin criterio'}; refuta si ${l.queRefuta || 'sin criterio'}; control: ${l.control || 'sin control declarado'}`);
    }
    L.push(`Hash SHA-256 de las lecturas en orden canónico: ${hashLecturas(x)}`);
  } else {
    L.push('Lecturas: ninguna declarada; no hay criterio por lectura que congelar.');
  }
  const s = x.sistema;
  if (s) {
    const tipo = s.tipo || '';
    const info = Object.prototype.hasOwnProperty.call(SISTEMAS_EXPERIMENTALES, tipo) ? SISTEMAS_EXPERIMENTALES[tipo as TipoSistema] : undefined;
    L.push(`Sistema experimental: ${etiquetaContrato(SISTEMAS_EXPERIMENTALES, tipo) || 'sin tipo'}${info ? ` (${info.definicion})` : ''}`);
    L.push(`  Prueba: ${s.quePrueba || 'no declarado'}`);
    if (s.queNoRepresenta) {
      L.push(`  No representa: ${s.queNoRepresenta}`);
    } else {
      const limite = info?.queNoRepresenta ?? '';
      L.push(`  No representa: no declarado${limite ? `; límite general de este sistema: ${limite}` : ''}`);
    }
  } else {
    L.push('Sistema experimental: no declarado');
  }
  const p = x.propositoBiomarcador;
  L.push(p ? `Propósito del biomarcador (BEST): ${etiquetaContrato(PROPOSITOS_BIOMARCADOR, p)}. ${PROPOSITOS_BIOMARCADOR[p].definicion}` : 'Propósito del biomarcador (BEST): no declarado');
  const n = x.nivelDesenlace;
  L.push(n ? `Nivel del desenlace: ${etiquetaContrato(NIVELES_DESENLACE, n)}. ${NIVELES_DESENLACE[n].definicion}` : 'Nivel del desenlace: no declarado');
  L.push(x.puenteAlBeneficio ? `Puente al beneficio: ${x.puenteAlBeneficio}` : 'Puente al beneficio: no declarado; el resultado, por sí solo, no habla de beneficio para una persona');
  return L;
}

export const CAMPOS_LECTURA_ENMENDABLES: CampoLecturaEnmendable[] = ['queConfirma', 'queRefuta', 'control', 'unidad'];

/** Enmienda fechada de una lectura del contrato (espejo de `enmendar_lectura`
 *  en rosa/estado/acciones.py, misma regla y misma forma): solo después de
 *  prerregistrar y antes de evaluar datos, con motivo, y solo si el texto
 *  cambia, sobre una lectura declarada en `experimento.lecturas` (índice) y
 *  uno de sus cuatro campos enmendables. La enmienda lleva
 *  `campo: "lecturas[i].campo"` y en `lectura` el nombre de la lectura. Como
 *  las lecturas cambian, `hashLecturas` se recalcula (pasa a ser el vigente) y
 *  la enmienda guarda `hashAntes` (el congelado, si es la primera) y
 *  `hashDespues`; que difieran es lo que delata que el contrato cambió después
 *  de congelarse. La pantalla enseña como congelado `enmiendas[0].hashAntes`. */
export function enmendarLectura(estado: EstadoRosa, hipotesisId: string, indice: number, campo: CampoLecturaEnmendable, despues: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((y) => y.id === hipotesisId);
  const x = h?.experimento;
  if (!h || !x || !CAMPOS_LECTURA_ENMENDABLES.includes(campo) || !x.prerregistradoEn || x.resultado) return estado;
  const lecturas = Array.isArray(x.lecturas) ? x.lecturas : [];
  if (!Number.isInteger(indice) || indice < 0 || indice >= lecturas.length) return estado;
  const l = lecturas[indice];
  if (!l || typeof l !== 'object') return estado;
  const nuevo = despues.trim();
  const razon = motivo.trim();
  // Recortado como en el servidor (`str(lectura.get(campo) or "").strip()`):
  // un texto guardado con espacios de más no debe pasar por "cambio".
  const antes = String(l[campo] ?? '').trim();
  if (nuevo === '' || razon === '' || nuevo === antes) return estado;
  const nombre = textoLimpio(l.nombre) || `lectura ${indice + 1}`;
  const nuevas = lecturas.map((y, i) => (i === indice ? { ...y, [campo]: nuevo } : y));
  const hashAntes = x.hashLecturas || hashLecturas(x);
  const hashDespues = hashLecturas({ ...x, lecturas: nuevas });
  const enmienda: EnmiendaPrerregistro = { fecha: ahora, quien: quien.trim() || 'persona', campo: `lecturas[${indice}].${campo}`, lectura: nombre, antes, despues: nuevo, motivo: razon, hashAntes, hashDespues };
  const enmiendas = [...(x.enmiendas ?? []), enmienda];
  const siguiente = {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (y) => ({
      ...y,
      experimento: { ...y.experimento!, lecturas: nuevas, enmiendas, hashLecturas: hashDespues },
      procedencia: { ...y.procedencia, registro: [...y.procedencia.registro, `${new Date(ahora).toISOString()} enmienda ${enmiendas.length} del prerregistro por ${quien}: lectura «${nombre}», ${campo} (${razon.slice(0, 80)})`] },
    })),
  };
  return conEvento(siguiente, h.investigacionId, 'hipotesis_decidida', `Enmienda ${enmiendas.length} del prerregistro (lectura «${nombre}», ${campo}): ${h.titulo.slice(0, 80)}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

/** El protocolo realmente ejecutado, con desviaciones e identidad de muestras.
 *  Si los datos ya se evaluaron, el resultado se borra para que el juez los
 *  reevalue con esta informacion (el servidor lo hace). */
export function registrarProtocoloReal(estado: EstadoRosa, hipotesisId: string, protocoloReal: { texto: string; desviaciones: string; identidadMuestras: string }, quien: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  const x = h?.experimento;
  if (!h || !x || x.estado === 'propuesto' || protocoloReal.texto.trim() === '') return estado;
  const pr: ProtocoloReal = { texto: protocoloReal.texto.trim().slice(0, 4000), desviaciones: protocoloReal.desviaciones.trim().slice(0, 2000), identidadMuestras: protocoloReal.identidadMuestras.trim().slice(0, 2000), registradoEn: ahora, quien: quien.trim() || 'persona' };
  const reevalua = Boolean(x.resultado && x.ficheroDatos);
  return {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (y) => ({
      ...y,
      experimento: { ...y.experimento!, protocoloReal: pr, resultado: reevalua ? null : y.experimento!.resultado },
      procedencia: { ...y.procedencia, registro: [...y.procedencia.registro, (pr.desviaciones ? `${new Date(ahora).toISOString()} protocolo real registrado por ${quien}; con desviaciones` : `${new Date(ahora).toISOString()} protocolo real registrado por ${quien}; sin desviaciones declaradas`)] },
    })),
  };
}

export function anadirConocimientoOperativo(estado: EstadoRosa, investigacionId: string, texto: string, tipo: ConocimientoOperativo['tipo'], quien: string, ahora: number): EstadoRosa {
  const t = texto.trim();
  if (t.length < 8) return estado;
  return {
    ...estado,
    investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, conocimientoOperativo: [...(i.conocimientoOperativo ?? []), { id: `op-${ahora.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, texto: t.slice(0, 1200), tipo, quien: quien.trim() || 'persona', fecha: ahora, clase: 'conocimiento_operativo' as const }] } : i)),
  };
}

export function quitarConocimientoOperativo(estado: EstadoRosa, investigacionId: string, id: string): EstadoRosa {
  return { ...estado, investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, conocimientoOperativo: (i.conocimientoOperativo ?? []).filter((x) => x.id !== id) } : i)) };
}

/** Una persona cualificada etiqueta una comprobacion del Killer (conjunto dorado). Mismo criterio que rosa/estado/acciones.py. */
export function etiquetarComprobacion(estado: EstadoRosa, hipotesisId: string, comprobacion: string, veredictoHumano: 'pasa' | 'falla' | 'no_comprobable', quien: string, ahora: number, nota = ''): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h || !comprobacion) return estado;
  const decisiones = (estado.decisiones ?? []).filter((d) => d.hipotesisId === hipotesisId && d.etapa.startsWith('killer'));
  const ultima = decisiones[decisiones.length - 1];
  const delJuez = ultima?.comprobaciones.find((c) => c.comprobacion === comprobacion);
  if (!ultima || !delJuez) return estado;
  const version = h.version ?? 1;
  const caso: CasoDorado = {
    id: `oro-${ahora.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    hipotesisId,
    version,
    decisionId: ultima.id,
    comprobacion,
    veredictoJuez: delJuez.resultado,
    detalleJuez: (delJuez.detalle ?? '').slice(0, 300),
    veredictoHumano,
    nota: nota.trim().slice(0, 500),
    quien: quien.trim() || 'persona',
    fecha: ahora,
    modeloJuez: 'anthropic/claude-opus-5',
  };
  const previos = (estado.conjuntoDorado ?? []).filter((c) => !(c.hipotesisId === hipotesisId && c.comprobacion === comprobacion && c.version === version && c.quien === caso.quien));
  return {
    ...estado,
    conjuntoDorado: [...previos, caso],
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (y) => ({ ...y, procedencia: { ...y.procedencia, registro: [...y.procedencia.registro, `${new Date(ahora).toISOString()} conjunto dorado: ${caso.quien} dice que '${comprobacion}' ${veredictoHumano} (el juez dijo ${delJuez.resultado})`] } })),
  };
}

export function textoPrerregistro(h: Hipotesis, laboratorio: string, ahora: number, arnes?: { commit: string; firmas: string; optimizados: string }): string {
  const x = h.experimento!;
  const c = h.comprobacion;
  const k = h.conclusion;
  const fecha = new Date(ahora).toLocaleString('es');
  const lineas = [
    `# Prerregistro: ${h.titulo}`,
    '',
    `Congelado el ${fecha}. Asignado a: ${laboratorio}. Hipótesis ${h.id}, iteración ${h.iteracion}.`,
    '',
    '## Hipótesis (no se modifica después de esta fecha)',
    h.enunciado,
    '',
    '## Mecanismo propuesto',
    h.mecanismo,
    '',
    '## Cómo se comprobará',
    `Biomarcador: ${c.biomarcador}`,
    `Cohorte: ${c.cohorte}`,
    `Diseño: ${c.diseno}`,
    '',
    '## Protocolo',
    x.protocolo,
    '',
    '## Ensayo y criterios fijados de antemano',
    x.ensayo,
    // El contrato del experimento (lecturas, sistema, propósito, nivel y puente), espejo de rosa/experimento.py bloque_prerregistro.
    ...bloquePrerregistro(x),
    '',
    `## Coste estimado
${x.costeEstimado}`,
  ];
  if (x.analisisPedido) lineas.push('', '## Análisis sobre datos existentes', x.analisisPedido);
  if (k) lineas.push('', '## Estado de la evidencia al prerregistrar', `Certeza: ${k.certeza}. Dirección: ${k.direccion}.`, k.enunciado, `Subiría la certeza si: ${k.subiria}`, `Bajaría si: ${k.bajaria}`);
  if (arnes) lineas.push('', '## Versión de ROSA2018', `Commit ${arnes.commit}, firmas ${arnes.firmas}, programas optimizados: ${arnes.optimizados}.`);
  lineas.push('', 'Lo que se analice fuera de este registro se reporta como exploratorio, separado de lo prerregistrado.');
  return lineas.join('\n');
}

/** Un nombre de fichero que se declara de prueba ("datos_gfap_sintetico.csv",
 *  "synthetic", "dummy", "fake", "mock", "datos de prueba", "prueba.csv"): la
 *  bandera se fuerza a sí aunque la casilla no se marcara. Copia exacta de
 *  NOMBRE_SINTETICO en rosa/certeza.py (misma regla en los dos lados). "prueba"
 *  suelta no cuenta: en clínica "prueba_cognitiva_MMSE.csv" es un dato real. */
export const FICHERO_SINTETICO = /sint[eé]tic|synthetic|(?<![a-z0-9])(?:dummy|fake|mock)(?![a-z0-9])|(?<![a-z0-9])(?:datos?|data)[_\- ]?(?:de[_\- ]?)?prueba(?![a-z0-9])|(?<![a-z0-9])de[_\- ]prueba(?![a-z0-9])|^\s*prueba(?:[_\- ]?\d+)?\.[a-z0-9]+\s*$/i;

/** Registra el fichero de datos del laboratorio (espejo de
 *  `registrar_datos_experimento`). `sintetico` es lo que declaró la persona
 *  con la casilla "estos datos son sintéticos o de prueba"; un dato sintético
 *  se etiqueta siempre y nunca cuenta como observación ni sube el techo GRADE. */
export function registrarDatosExperimento(estado: EstadoRosa, hipotesisId: string, fichero: string, analisis: string, sintetico = false): EstadoRosa {
  if (fichero.trim() === '') return estado;
  const datosSinteticos = Boolean(sintetico) || FICHERO_SINTETICO.test(fichero);
  return {
    ...estado,
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (h) =>
      h.experimento ? { ...h, experimento: { ...h.experimento, ficheroDatos: fichero.trim(), analisisPedido: analisis.trim(), estado: 'datos_recibidos', datosSinteticos, resultado: null } } : h,
    ),
  };
}

/* ---------------------------------------------------------------------
   Comentarios anclados
   --------------------------------------------------------------------- */

export function anadirComentario(estado: EstadoRosa, hipotesisId: string, ancla: AnclaComentario, nota: string, ahora: number): EstadoRosa {
  const notaLimpia = nota.trim();
  if (notaLimpia === '' || ancla.cita.trim() === '') return estado;
  if (notaLimpia.length > 1000) return estado;
  const comentario: Comentario = { id: nuevoId('com'), hipotesisId, ancla, nota: notaLimpia, estado: 'pendiente', creadoEn: ahora };
  return { ...estado, comentarios: [...estado.comentarios, comentario] };
}

export function editarComentario(estado: EstadoRosa, comentarioId: string, nota: string): EstadoRosa {
  const limpia = nota.trim();
  if (limpia === '' || limpia.length > 1000) return estado;
  return { ...estado, comentarios: estado.comentarios.map((c) => (c.id === comentarioId && c.estado === 'pendiente' ? { ...c, nota: limpia } : c)) };
}

export function quitarComentario(estado: EstadoRosa, comentarioId: string): EstadoRosa {
  return { ...estado, comentarios: estado.comentarios.filter((c) => !(c.id === comentarioId && c.estado === 'pendiente')) };
}

export function enviarComentarios(estado: EstadoRosa, hipotesisId: string, mensaje: string, quien: string, ahora: number): EstadoRosa {
  const pendientes = estado.comentarios.filter((c) => c.hipotesisId === hipotesisId && c.estado === 'pendiente');
  const texto = mensaje.trim();
  if (pendientes.length === 0 && texto === '') return estado;
  const lineas = pendientes.map((c) => `Sobre «${c.ancla.cita}»: ${c.nota}`);
  const cuerpo = [texto, ...lineas].filter((l) => l !== '').join('\n');
  const revision: Revision = { fecha: ahora, quien, accion: 'comentada', nota: pendientes.length > 0 ? (pendientes.length === 1 ? `${pendientes.length} comentario` : `${pendientes.length} comentarios`) : 'Mensaje', aCiegas: false };
  return {
    ...estado,
    comentarios: estado.comentarios.map((c) => (c.hipotesisId === hipotesisId && c.estado === 'pendiente' ? { ...c, estado: 'enviado' as const } : c)),
    hipotesis: reemplazar(estado.hipotesis, hipotesisId, (h) => ({
      ...h,
      estado: h.estado === 'propuesta' ? 'en_revision' : h.estado,
      revisiones: [...h.revisiones, revision],
      procedencia: { ...h.procedencia, mensajes: [...h.procedencia.mensajes, { id: nuevoId('m'), de: 'investigadora' as const, texto: cuerpo, creadoEn: ahora }] },
    })),
  };
}

/* ---------------------------------------------------------------------
   Meta-revisión y modelo de mundo
   --------------------------------------------------------------------- */

/** Inyectar una debilidad recurrente como criterio de revision. */
export function inyectarDebilidad(estado: EstadoRosa, corridaId: string, debilidadId: string): EstadoRosa {
  const corrida = corridaDe(estado, corridaId);
  const deb = corrida?.metaRevisiones.flatMap((m) => m.debilidades).find((d) => d.id === debilidadId);
  if (!corrida || !deb || deb.inyectada) return estado;
  const criterios = estado.criteriosRevision.includes(deb.texto) ? estado.criteriosRevision : [...estado.criteriosRevision, deb.texto];
  return {
    ...estado,
    criteriosRevision: criterios,
    corridas: reemplazar(estado.corridas, corridaId, (c) => ({
      ...c,
      metaRevisiones: c.metaRevisiones.map((m) => ({ ...m, debilidades: m.debilidades.map((d) => (d.id === debilidadId ? { ...d, inyectada: true } : d)) })),
    })),
  };
}

/** Recomprobar retractaciones: en produccion consulta Crossref y Retraction
 *  Watch; aqui sella la fecha en todas las fuentes de la investigacion. */
export function recomprobarRetracciones(estado: EstadoRosa, investigacionId: string, ahora: number): EstadoRosa {
  const siguiente: EstadoRosa = {
    ...estado,
    hipotesis: estado.hipotesis.map((h) =>
      h.investigacionId === investigacionId ? { ...h, procedencia: { ...h.procedencia, fuentes: h.procedencia.fuentes.map((f) => ({ ...f, retraccionComprobadaEn: ahora })) } } : h,
    ),
  };
  return conEvento(siguiente, investigacionId, 'retraccion', 'Retractaciones recomprobadas contra Crossref y Retraction Watch: sin cambios', null, ahora);
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Responder con lo que hay dentro del modelo de mundo, citando nodos. Sin
 *  modelo de lenguaje: busca por palabras y devuelve los nodos que casan. */
export interface CitaComprobable {
  fuenteId: string;
  referencia: string;
  doi: string | null;
  pmid: string | null;
  titulo: string;
}

/** Responde con lo que hay en el modelo de mundo, citando cada hecho una sola
 *  vez por fuente. `fuentes` (por id) permite devolver el PMID y el DOI de
 *  cada cita para que se pueda comprobar fuera de ROSA2018: una referencia de
 *  2026 sin identificador parece inventada aunque venga de PubMed. */
export function preguntarAlModeloDeMundo(hechos: HechoMundo[], investigacionId: string, pregunta: string, fuentes: Map<string, Pick<Fuente, 'id' | 'referencia' | 'doi' | 'pmid' | 'titulo'>> = new Map()): { respuesta: string; nodos: HechoMundo[]; citas: CitaComprobable[] } {
  const palabras = normalizar(pregunta)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 3);
  if (palabras.length === 0) return { respuesta: 'Escribe una pregunta con alguna palabra del dominio.', nodos: [], citas: [] };
  const puntuados = hechos
    .filter((h) => h.investigacionId === investigacionId)
    .map((h) => {
      const texto = normalizar(`${h.enunciado} ${h.tema} ${h.motivoDescarte ?? ''}`);
      const aciertos = palabras.filter((p) => texto.includes(p)).length;
      return { h, aciertos };
    })
    .filter((x) => x.aciertos > 0)
    .sort((a, b) => b.aciertos - a.aciertos)
    .slice(0, 5);
  if (puntuados.length === 0) return { respuesta: 'El modelo de mundo no tiene nada sobre eso. No lo invento: queda como pregunta abierta si quieres añadirla.', nodos: [], citas: [] };
  const sabidos = puntuados.filter((x) => x.h.estado === 'sabido');
  const abiertos = puntuados.filter((x) => x.h.estado === 'abierto');
  const descartados = puntuados.filter((x) => x.h.estado === 'descartado');
  // Una cita por fuente y hecho (las paginas se agrupan), con PMID si se conoce.
  const citas = new Map<string, CitaComprobable>();
  const citar = (h: HechoMundo): string => {
    const porFuente = new Map<string, number[]>();
    for (const p of h.procedencia) {
      const lista = porFuente.get(p.fuenteId) ?? [];
      if (p.pagina !== null && !lista.includes(p.pagina)) lista.push(p.pagina);
      porFuente.set(p.fuenteId, lista);
    }
    return (
      [...porFuente.entries()]
        .map(([fid, paginas]) => {
          const ref = h.procedencia.find((p) => p.fuenteId === fid)!.referencia;
          const f = fuentes.get(fid);
          if (!citas.has(fid)) citas.set(fid, { fuenteId: fid, referencia: ref, doi: f?.doi ?? null, pmid: f?.pmid ?? null, titulo: f?.titulo ?? '' });
          return `${ref}${paginas.length ? `, pág. ${paginas.sort((a, b) => a - b).join(', ')}` : ''}${f?.pmid ? `, PMID ${f.pmid}` : ''}`;
        })
        .join('; ') || 'inferencia de ROSA2018'
    );
  };
  const partes: string[] = [];
  if (sabidos.length > 0) partes.push(`Se sabe: ${sabidos.map((x) => `${x.h.enunciado} [${citar(x.h)}]`).join(' ')}`);
  if (abiertos.length > 0) partes.push(`Está abierto: ${abiertos.map((x) => x.h.enunciado).join(' ')}`);
  if (descartados.length > 0) partes.push(`Se descartó: ${descartados.map((x) => `${x.h.enunciado} (${x.h.motivoDescarte ?? 'sin motivo registrado'})`).join(' ')}`);
  return { respuesta: partes.join('\n'), nodos: puntuados.map((x) => x.h), citas: [...citas.values()] };
}

/* ---------------------------------------------------------------------
   Investigaciones y datos
   --------------------------------------------------------------------- */

export interface DatosInvestigacion {
  titulo: string;
  objetivo: string;
  relevancia: string;
  limites: string[];
  condicionParada: string;
  revisores: string[];
  configuracion?: Investigacion['configuracion'];
  /** Investigacion cuyo modelo de mundo se hereda, si se pide. */
  heredarModeloDe?: string | null;
  /** La mision escrita por la persona al crear; si falta, ROSA2018 la propone. */
  mision?: Partial<Omit<Mision, 'presupuesto'>> & { presupuesto?: Partial<Mision['presupuesto']> };
  quien?: string;
}

export function misionVacia(): Mision {
  return { poblacion: '', etapa: '', celulaTejido: '', mecanismo: '', tipoIntervencion: '', capacidadesLaboratorio: [], presupuesto: { llamadas: 1500, usd: 60, horas: 72 }, propuestaPorRosa: false, aprobadaEn: null, aprobadaPor: null };
}

export function puertaVacia(): PuertaReproduccion {
  return { requeridas: 3, superadas: 0, estado: 'bloqueada', eximidaPor: null, motivo: '', fecha: null };
}

export function crearInvestigacion(estado: EstadoRosa, datos: DatosInvestigacion, ahora: number): { estado: EstadoRosa; id: string | null } {
  if (datos.titulo.trim() === '' || datos.objetivo.trim() === '' || datos.condicionParada.trim() === '') return { estado, id: null };
  const id = nuevoId('inv');
  const inv: Investigacion = {
    id,
    titulo: datos.titulo.trim(),
    objetivo: datos.objetivo.trim(),
    relevancia: datos.relevancia.trim(),
    limites: datos.limites.map((l) => l.trim()).filter((l) => l !== ''),
    condicionParada: datos.condicionParada.trim(),
    condicionParadaAutomatizada: partesAutomatizadas(String(datos.condicionParada ?? '')),
    revisores: datos.revisores.map((r) => r.trim()).filter((r) => r !== ''),
    estado: 'activa',
    creadaEn: ahora,
    ramaDe: null,
    configuracion: datos.configuracion ?? { preferencias: '', atributos: [], restricciones: [] },
    datasets: [],
    vigilarLiteraturaHasta: null,
    mision: null,
    puertaReproduccion: puertaVacia(),
    // Se calculan al cerrar cada iteración (rosa/estado/acciones.py crear_investigacion los crea en None).
    mapaEnfermedad: null,
    mapaRuta: null,
    cifrasAprendizaje: null,
  };
  let hechos = estado.hechos;
  if (datos.heredarModeloDe) {
    hechos = [...estado.hechos, ...copiarHechos(estado.hechos, datos.heredarModeloDe, id, ahora)];
  }
  let siguiente: EstadoRosa = { ...estado, investigaciones: [...estado.investigaciones, inv], hechos };
  const m = datos.mision;
  if (m && [m.poblacion, m.etapa, m.mecanismo, m.tipoIntervencion].some((v) => (v ?? '').trim() !== '')) {
    siguiente = aprobarMision(siguiente, id, m, datos.quien ?? 'Investigadora', ahora);
  }
  return { estado: siguiente, id };
}

/* ---------------------------------------------------------------------
   ROSA2018: misión, puerta, reproducciones, análisis, aprendizaje
   --------------------------------------------------------------------- */

/** La persona aprueba (o corrige y aprueba) la mision. Misma regla que
 *  `aprobar_mision` en el servidor: los presupuestos tienen que ser positivos. */
export function aprobarMision(estado: EstadoRosa, investigacionId: string, mision: DatosInvestigacion['mision'], quien: string, ahora: number): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  if (!inv || !mision) return estado;
  const base = inv.mision ?? misionVacia();
  const p = mision.presupuesto ?? {};
  const num = (v: number | undefined, fallback: number) => (v === undefined || v === null || Number.isNaN(v) ? fallback : v);
  const nueva: Mision = {
    ...base,
    poblacion: (mision.poblacion ?? base.poblacion).trim(),
    etapa: (mision.etapa ?? base.etapa).trim(),
    celulaTejido: (mision.celulaTejido ?? base.celulaTejido).trim(),
    mecanismo: (mision.mecanismo ?? base.mecanismo).trim(),
    tipoIntervencion: (mision.tipoIntervencion ?? base.tipoIntervencion).trim(),
    capacidadesLaboratorio: (mision.capacidadesLaboratorio ?? base.capacidadesLaboratorio).map((c) => c.trim()).filter((c) => c !== ''),
    presupuesto: { llamadas: Math.round(num(p.llamadas, base.presupuesto.llamadas)), usd: num(p.usd, base.presupuesto.usd), horas: num(p.horas, base.presupuesto.horas) },
    aprobadaEn: ahora,
    aprobadaPor: quien,
  };
  if (nueva.presupuesto.llamadas <= 0 || nueva.presupuesto.usd <= 0 || nueva.presupuesto.horas <= 0) return estado;
  const siguiente: EstadoRosa = {
    ...estado,
    investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, mision: nueva })),
    corridas: estado.corridas.map((c) => (c.investigacionId === investigacionId && c.estado !== 'detenida' && c.estado !== 'terminada' && nueva.presupuesto.llamadas > c.gasto.llamadas ? { ...c, presupuesto: { ...c.presupuesto, limiteLlamadas: nueva.presupuesto.llamadas } } : c)),
  };
  return conEvento(siguiente, investigacionId, 'mision', `Misión aprobada por ${quien}`, `#/investigaciones/${investigacionId}/investigacion`, ahora);
}

/** Eximir la puerta de reproduccion es una excepcion de politica (nivel 3):
 *  exige motivo y queda en el registro de aprendizaje. */
export function eximirPuerta(estado: EstadoRosa, investigacionId: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  const texto = motivo.trim();
  if (!inv || texto === '') return estado;
  const puerta = inv.puertaReproduccion ?? puertaVacia();
  if (puerta.estado === 'eximida') return estado;
  const cambio: CambioAprendizaje = { id: nuevoId('apr'), investigacionId, nivel: 3, tipo: 'politica', descripcion: `Puerta de reproducción eximida: ${texto}`, origen: 'puertaReproduccion', estado: 'aplicado', evaluacion: null, quien, fecha: ahora, resueltoEn: ahora, resueltoPor: quien };
  const siguiente: EstadoRosa = {
    ...estado,
    investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, puertaReproduccion: { ...puerta, estado: 'eximida', eximidaPor: quien, motivo: texto, fecha: ahora } })),
    aprendizaje: [...(estado.aprendizaje ?? []), cambio],
  };
  return conEvento(siguiente, investigacionId, 'aprendizaje', `Puerta de reproducción eximida por ${quien}: ${texto.slice(0, 120)}`, `#/investigaciones/${investigacionId}/investigacion`, ahora);
}

export function cerrarPuerta(estado: EstadoRosa, investigacionId: string, quien: string, ahora: number): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  if (!inv) return estado;
  const puerta = inv.puertaReproduccion ?? puertaVacia();
  if (puerta.estado !== 'eximida') return estado;
  const siguiente: EstadoRosa = {
    ...estado,
    investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, puertaReproduccion: { ...puerta, estado: puerta.superadas >= puerta.requeridas ? 'abierta' : 'bloqueada', eximidaPor: null, motivo: '', fecha: ahora } })),
  };
  return conEvento(siguiente, investigacionId, 'aprendizaje', `Puerta de reproducción vuelta a exigir por ${quien}`, null, ahora);
}

export interface DatosReproduccion {
  referencia: string;
  doi: string;
  descripcion: string;
  cifraPublicada: string;
  valorPublicado: number;
  tolerancia: number;
}

/** Registrar un analisis publicado que hay que reproducir. La tolerancia se
 *  fija aqui, antes de ejecutar nada. */
export function anadirReproduccion(estado: EstadoRosa, investigacionId: string, datasetId: string, datos: DatosReproduccion, ahora: number): { estado: EstadoRosa; id: string | null } {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  if (!inv || !inv.datasets.some((d) => d.id === datasetId)) return { estado, id: null };
  if (datos.referencia.trim() === '' || datos.descripcion.trim() === '' || !Number.isFinite(datos.valorPublicado) || !(datos.tolerancia > 0 && datos.tolerancia <= 1)) return { estado, id: null };
  const r: Reproduccion = { id: nuevoId('rep'), investigacionId, datasetId, referencia: datos.referencia.trim(), doi: datos.doi.trim(), descripcion: datos.descripcion.trim(), cifraPublicada: datos.cifraPublicada.trim(), valorPublicado: datos.valorPublicado, tolerancia: datos.tolerancia, planId: null, ejecucionId: null, valorObtenido: null, estado: 'pendiente', creadaEn: ahora };
  const siguiente = conEvento({ ...estado, reproducciones: [...(estado.reproducciones ?? []), r] }, investigacionId, 'analisis', `Reproducción registrada: ${r.referencia}`, `#/investigaciones/${investigacionId}/investigacion`, ahora);
  return { estado: siguiente, id: r.id };
}

/** Pedir a ROSA2018 un analisis in silico. Solo con un dataset aprobado y fijado
 *  por hash; el bucle lo ejecuta en el sandbox. */
export function pedirAnalisis(estado: EstadoRosa, hipotesisId: string, datasetId: string, pregunta: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h) return estado;
  const inv = estado.investigaciones.find((i) => i.id === h.investigacionId);
  const ds = inv?.datasets.find((d) => d.id === datasetId);
  if (!ds || ds.estado !== 'aprobado' || !ds.procedencia?.hash) return estado;
  const mensaje = { id: nuevoId('m'), de: 'investigadora' as const, texto: `Análisis pedido sobre ${ds.nombre}: ${pregunta.trim() || 'aplicar la predicción falsable de la hipótesis'}`, creadoEn: ahora };
  const siguiente: EstadoRosa = { ...estado, hipotesis: reemplazar(estado.hipotesis, hipotesisId, (x) => ({ ...x, procedencia: { ...x.procedencia, mensajes: [...x.procedencia.mensajes, mensaje] } })) };
  return conEvento(siguiente, h.investigacionId, 'analisis', `Análisis in silico pedido sobre ${ds.nombre}: ${h.titulo.slice(0, 80)}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

/** Promover un cambio de nivel 2. Solo una persona; un criterio promovido
 *  entra a los criterios de revision. */
/** Puerta "solo mejor o igual": un cambio evaluado cuyo acuerdo después es menor
 *  que antes no se promueve. Misma regla que rosa/estado/acciones.py. */
export function empeoraAlEvaluar(c: CambioAprendizaje): boolean {
  const ev = c.evaluacion;
  return !!ev && typeof ev.antes === 'number' && typeof ev.despues === 'number' && ev.despues < ev.antes;
}

export function promoverAprendizaje(estado: EstadoRosa, cambioId: string, quien: string, ahora: number): EstadoRosa {
  const c = (estado.aprendizaje ?? []).find((x) => x.id === cambioId);
  if (!c || c.nivel !== 2 || (c.estado !== 'propuesto' && c.estado !== 'evaluado')) return estado;
  if (empeoraAlEvaluar(c)) {
    return conEvento(estado, c.investigacionId ?? '', 'incidencia', `No se promueve el cambio '${c.descripcion.slice(0, 80)}': la evaluación empeora el acuerdo (${c.evaluacion?.antes} antes, ${c.evaluacion?.despues} después). Solo se promueve lo que iguala o mejora.`, '#/ajustes', ahora);
  }
  const criterios = c.tipo === 'criterio' && !estado.criteriosRevision.includes(c.descripcion) ? [...estado.criteriosRevision, c.descripcion] : estado.criteriosRevision;
  const siguiente: EstadoRosa = { ...estado, criteriosRevision: criterios, aprendizaje: (estado.aprendizaje ?? []).map((x) => (x.id === cambioId ? { ...x, estado: 'promovido', resueltoEn: ahora, resueltoPor: quien } : x)) };
  return conEvento(siguiente, c.investigacionId ?? '', 'aprendizaje', `Cambio de nivel 2 promovido por ${quien}: ${c.descripcion.slice(0, 100)}`, '#/ajustes', ahora);
}

/** Fusión de ramas por torneo: la ganadora hereda las afirmaciones y fuentes que no
 *  tenía; la absorbida queda descartada con fusionadaEn. Misma regla que
 *  rosa/estado/acciones.py fusionar_hipotesis. */
export function fusionarHipotesis(estado: EstadoRosa, ganadoraId: string, absorbidaId: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const g = estado.hipotesis.find((x) => x.id === ganadoraId);
  const a = estado.hipotesis.find((x) => x.id === absorbidaId);
  if (!g || !a || g === a || g.investigacionId !== a.investigacionId || a.estado === 'descartada' || g.estado === 'descartada') return estado;
  const clave = (x: Afirmacion) => (x.afirmacionId ? `id:${x.afirmacionId}` : `t:${x.texto}|${x.cita}`);
  const tiene = new Set(g.afirmaciones.map(clave));
  const heredadas = a.afirmaciones.filter((x) => !tiene.has(clave(x))).map((x) => ({ ...x, heredadaDe: a.id }));
  const idsFuentes = new Set(g.procedencia.fuentes.map((f) => f.id));
  const fuentesNuevas = a.procedencia.fuentes.filter((f) => !idsFuentes.has(f.id));
  const marca = new Date(ahora).toISOString();
  const m = motivo.trim().slice(0, 200);
  const hipotesis = estado.hipotesis.map((x) => {
    if (x.id === g.id) {
      return {
        ...x,
        afirmaciones: [...x.afirmaciones, ...heredadas],
        absorbe: [...(x.absorbe ?? []), a.id],
        fusionPropuesta: null,
        procedencia: {
          ...x.procedencia,
          fuentes: [...x.procedencia.fuentes, ...fuentesNuevas],
          registro: [...x.procedencia.registro, `${marca} fusión: absorbe a '${a.titulo.slice(0, 80)}' (${a.id}) por ${quien}: ${m}. ${heredadas.length} afirmaciones y ${fuentesNuevas.length} fuentes heredadas`],
          mensajes: [...x.procedencia.mensajes, { id: nuevoId('m'), de: 'rosa' as const, texto: `Fusionada con '${a.titulo.slice(0, 80)}': ${m}`, creadoEn: ahora }],
        },
      };
    }
    if (x.id === a.id) {
      return {
        ...x,
        estado: 'descartada' as const,
        candidata: false,
        fusionadaEn: g.id,
        fusionPropuesta: null,
        revisiones: [...x.revisiones, { fecha: ahora, quien, accion: 'descartada' as const, nota: `Fusionada en '${g.titulo.slice(0, 80)}' (${g.id}): ${m}`, aCiegas: false }],
        procedencia: { ...x.procedencia, registro: [...x.procedencia.registro, `${marca} fusionada en '${g.titulo.slice(0, 80)}' (${g.id}) por ${quien}: ${m}`] },
      };
    }
    return x;
  });
  // Los bloqueos los recalcula el servidor (rosa/priorizacion.py) y llegan por SSE.
  return conEvento({ ...estado, hipotesis }, g.investigacionId, 'hipotesis_decidida', `Fusión: '${a.titulo.slice(0, 60)}' se funde en '${g.titulo.slice(0, 60)}' (${motivo.trim().slice(0, 100)})`, `#/investigaciones/${g.investigacionId}/hipotesis/${g.id}`, ahora);
}

/** Texto normalizado para deduplicar cuestiones: misma regla base que rosa/cuestiones.py
 *  (minúsculas, sin tildes ni signos, espacios colapsados). El servidor además funde por
 *  solape de palabras; aquí basta para no duplicar en la vista optimista. */
export function normalizarCuestion(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function abrirCuestion(estado: EstadoRosa, investigacionId: string, texto: string, queLaResolveria: string, quien: string, ahora: number, hipotesisId: string | null = null): EstadoRosa {
  const t = texto.trim();
  if (t === '' || !estado.investigaciones.some((i) => i.id === investigacionId)) return estado;
  const lista = estado.cuestiones ?? [];
  const igual = lista.find((c) => c.investigacionId === investigacionId && c.estado === 'abierta' && normalizarCuestion(c.texto) === normalizarCuestion(t));
  if (igual) {
    const cuestiones = lista.map((c) => (c.id === igual.id ? { ...c, veces: c.veces + 1, actualizadaEn: ahora, hipotesisIds: hipotesisId && !c.hipotesisIds.includes(hipotesisId) ? [...c.hipotesisIds, hipotesisId] : c.hipotesisIds } : c));
    return { ...estado, cuestiones };
  }
  const nueva: Cuestion = {
    id: nuevoId('cu'),
    investigacionId,
    texto: t.slice(0, 300),
    estado: 'abierta',
    origen: { tipo: 'persona', id: null },
    queLaResolveria: queLaResolveria.trim().slice(0, 300),
    hipotesisIds: hipotesisId ? [hipotesisId] : [],
    hechoIds: [],
    prioridad: 3,
    creadaEn: ahora,
    actualizadaEn: ahora,
    resueltaEn: null,
    resolucion: null,
    veces: 1,
    historial: [{ fecha: ahora, de: null, a: 'abierta', quien, motivo: 'Abierta' }],
  };
  return conEvento({ ...estado, cuestiones: [...lista, nueva] }, investigacionId, 'hecho_nuevo', `Cuestión abierta por ${quien}: ${nueva.texto.slice(0, 100)}`, `#/investigaciones/${investigacionId}`, ahora);
}

function moverCuestion(estado: EstadoRosa, cuestionId: string, a: Cuestion['estado'], quien: string, motivo: string, ahora: number, resolucion: Cuestion['resolucion']): EstadoRosa {
  const c = (estado.cuestiones ?? []).find((x) => x.id === cuestionId);
  if (!c || c.estado === a) return estado;
  const cuestiones = (estado.cuestiones ?? []).map((x) => (x.id === cuestionId ? { ...x, estado: a, actualizadaEn: ahora, resueltaEn: a === 'resuelta' ? ahora : null, resolucion: a === 'resuelta' ? resolucion : null, historial: [...x.historial, { fecha: ahora, de: x.estado, a, quien, motivo }] } : x));
  return { ...estado, cuestiones };
}

export function resolverCuestion(estado: EstadoRosa, cuestionId: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const c = (estado.cuestiones ?? []).find((x) => x.id === cuestionId);
  if (!c || c.estado === 'resuelta') return estado;
  const m = motivo.trim() || 'Resuelta por una persona';
  return conEvento(moverCuestion(estado, cuestionId, 'resuelta', quien, m, ahora, { por: quien, motivo: m }), c.investigacionId, 'hecho_nuevo', `Cuestión resuelta por ${quien}: ${c.texto.slice(0, 100)}`, `#/investigaciones/${c.investigacionId}`, ahora);
}

export function descartarCuestion(estado: EstadoRosa, cuestionId: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  const c = (estado.cuestiones ?? []).find((x) => x.id === cuestionId);
  if (!c || motivo.trim() === '' || c.estado === 'descartada') return estado;
  return conEvento(moverCuestion(estado, cuestionId, 'descartada', quien, motivo.trim(), ahora, null), c.investigacionId, 'hecho_nuevo', `Cuestión descartada por ${quien}: ${c.texto.slice(0, 100)}`, `#/investigaciones/${c.investigacionId}`, ahora);
}

export function reabrirCuestion(estado: EstadoRosa, cuestionId: string, motivo: string, quien: string, ahora: number): EstadoRosa {
  return moverCuestion(estado, cuestionId, 'abierta', quien, motivo.trim() || 'Reabierta', ahora, null);
}

/** Una persona da por revisado lo que la propagación de dependencias marcó (rosa/dependencias.py). */
export function atenderPendiente(estado: EstadoRosa, tipo: 'hipotesis' | 'hecho' | 'plan', id: string, quien: string, nota: string, ahora: number): EstadoRosa {
  const marca = new Date(ahora).toISOString();
  if (tipo === 'hipotesis') {
    const h = estado.hipotesis.find((x) => x.id === id);
    if (!h || !h.pendienteRevision) return estado;
    const hipotesis = reemplazar(estado.hipotesis, id, (x) => ({ ...x, pendienteRevision: null, bloqueos: (x.bloqueos ?? []).filter((b) => b !== 'dependencia_pendiente'), procedencia: { ...x.procedencia, registro: [...x.procedencia.registro, `${marca} pendiente de revisar atendida por ${quien}: ${nota.trim()}`] } }));
    return conEvento({ ...estado, hipotesis }, h.investigacionId, 'hipotesis_decidida', `${quien} revisó «${h.titulo.slice(0, 60)}» tras el cambio del que dependía${nota.trim() ? `: ${nota.trim().slice(0, 100)}` : ''}`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
  }
  if (tipo === 'hecho') {
    const h = estado.hechos.find((x) => x.id === id);
    if (!h || !h.pendienteRevision) return estado;
    return { ...estado, hechos: estado.hechos.map((x) => (x.id === id ? { ...x, pendienteRevision: null, historial: [...x.historial, { fecha: ahora, de: x.estado, a: x.estado, quien, motivo: `Pendiente de revisar atendida: ${nota.trim()}` }] } : x)) };
  }
  const p = (estado.planesAnalisis ?? []).find((x) => x.id === id);
  if (!p || !p.pendienteRevision) return estado;
  return { ...estado, planesAnalisis: (estado.planesAnalisis ?? []).map((x) => (x.id === id ? { ...x, pendienteRevision: null } : x)) };
}

export function rechazarFusion(estado: EstadoRosa, hipotesisId: string, quien: string, ahora: number): EstadoRosa {
  const h = estado.hipotesis.find((x) => x.id === hipotesisId);
  if (!h || !h.fusionPropuesta) return estado;
  const con = h.fusionPropuesta.con;
  const hipotesis = reemplazar(estado.hipotesis, hipotesisId, (x) => ({ ...x, fusionPropuesta: null, procedencia: { ...x.procedencia, registro: [...x.procedencia.registro, `${new Date(ahora).toISOString()} fusión con ${con} rechazada por ${quien}`] } }));
  return conEvento({ ...estado, hipotesis }, h.investigacionId, 'hipotesis_decidida', `${quien} rechazó fusionar '${h.titulo.slice(0, 60)}'`, `#/investigaciones/${h.investigacionId}/hipotesis/${h.id}`, ahora);
}

export function revertirAprendizaje(estado: EstadoRosa, cambioId: string, quien: string, motivo: string, ahora: number): EstadoRosa {
  const c = (estado.aprendizaje ?? []).find((x) => x.id === cambioId);
  if (!c || c.nivel === 3 || c.estado === 'revertido') return estado;
  const criterios = c.tipo === 'criterio' ? estado.criteriosRevision.filter((x) => x !== c.descripcion) : estado.criteriosRevision;
  const evaluacion = motivo.trim() !== '' ? { ...(c.evaluacion ?? { conjunto: '', casos: 0, antes: null, despues: null }), nota: motivo.trim() } : c.evaluacion;
  const siguiente: EstadoRosa = { ...estado, criteriosRevision: criterios, aprendizaje: (estado.aprendizaje ?? []).map((x) => (x.id === cambioId ? { ...x, estado: 'revertido', resueltoEn: ahora, resueltoPor: quien, evaluacion } : x)) };
  return conEvento(siguiente, c.investigacionId ?? '', 'aprendizaje', `Cambio revertido por ${quien}: ${c.descripcion.slice(0, 100)}`, '#/ajustes', ahora);
}

/** La persona corrige la pregunta de la campana. La anterior se conserva. */
export function actualizarPregunta(estado: EstadoRosa, corridaId: string, pregunta: Partial<PreguntaCampana>, ahora: number): EstadoRosa {
  const c = corridaDe(estado, corridaId);
  if (!c) return estado;
  const base: PreguntaCampana = c.pregunta ?? { contexto: '', etapa: '', intervencion: '', comparador: '', desenlace: '', ventana: '', unidadBiologica: '', mecanismos: '', decision: '', umbralEfecto: '', umbralResuelto: false, pasoRuta: 'mecanismo', propuestaPorRosa: true, aprobadaEn: null };
  const nueva: PreguntaCampana = { ...base, ...pregunta, propuestaPorRosa: false, aprobadaEn: ahora };
  nueva.umbralResuelto = nueva.umbralEfecto.trim() !== '' && !nueva.umbralEfecto.toLowerCase().includes('sin resolver');
  const siguiente: EstadoRosa = { ...estado, corridas: reemplazar(estado.corridas, corridaId, (x) => ({ ...x, pregunta: nueva })) };
  return conEvento(siguiente, c.investigacionId, 'corrida_estado', `Pregunta de la corrida ${c.numero} corregida`, `#/investigaciones/${c.investigacionId}/corrida`, ahora);
}

/** El registro de metodos lo edita una persona. Cambiar el estado queda como
 *  cambio de nivel 2 promovido por ella. */
export function actualizarMetodo(estado: EstadoRosa, metodoId: string, cambios: Partial<MetodoRegistrado>, quien: string, ahora: number): EstadoRosa {
  const m = (estado.metodos ?? []).find((x) => x.id === metodoId);
  if (!m) return estado;
  const { id: _i, actualizadoEn: _a, ...resto } = cambios;
  const nuevo: MetodoRegistrado = { ...m, ...resto, actualizadoEn: ahora };
  let aprendizaje = estado.aprendizaje ?? [];
  if (cambios.estado && cambios.estado !== m.estado) {
    aprendizaje = [...aprendizaje, { id: nuevoId('apr'), investigacionId: null, nivel: 2, tipo: 'programa', descripcion: `Método '${m.nombre.slice(0, 60)}': de ${m.estado} a ${cambios.estado}`, origen: `metodo:${metodoId}`, estado: 'promovido', evaluacion: null, quien, fecha: ahora, resueltoEn: ahora, resueltoPor: quien }];
  }
  return { ...estado, metodos: (estado.metodos ?? []).map((x) => (x.id === metodoId ? nuevo : x)), aprendizaje };
}

/** La persona completa el libro de procedencia. El hash y el fichero los
 *  fija el servidor al subir; aqui no se tocan. */
export function actualizarProcedenciaDataset(estado: EstadoRosa, investigacionId: string, datasetId: string, procedencia: Partial<ProcedenciaDataset>): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  const ds = inv?.datasets.find((d) => d.id === datasetId);
  if (!inv || !ds) return estado;
  const base: ProcedenciaDataset = ds.procedencia ?? { origen: '', version: '', licencia: '', permisos: '', fechaObtencion: null, hash: '', fichero: null, filas: 0, diccionario: [], usoIAAutorizado: 'desconocido', sintetico: false, clase: 'observacion_original', cohorte: '', permiteLlmTerceros: false, restriccionIA: '', acceso: 'propio', columnas: [] };
  const { hash: _h, fichero: _f, filas: _n, columnas: _c, ...editables } = procedencia;
  const nueva: ProcedenciaDataset = { ...base, ...editables };
  const sinDiccionario = procedencia.diccionario ? nueva.diccionario.filter((c) => c.descripcion.trim() === '').length : ds.columnasSinDiccionario;
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: i.datasets.map((d) => (d.id === datasetId ? { ...d, procedencia: nueva, columnasSinDiccionario: sinDiccionario } : d)) })) };
}

/** Misma regla que rosa/estado/acciones.py editar_investigacion: solo cambian los
 *  campos que llegan con texto; un título vacío no borra el anterior. El evento lo
 *  escribe el servidor con el actor real. */
export function editarInvestigacion(estado: EstadoRosa, investigacionId: string, cambios: { titulo?: string; objetivo?: string }): EstadoRosa {
  const titulo = (cambios.titulo ?? '').trim();
  const objetivo = (cambios.objetivo ?? '').trim();
  return {
    ...estado,
    investigaciones: estado.investigaciones.map((i) => (i.id === investigacionId ? { ...i, ...(titulo ? { titulo } : {}), ...(objetivo ? { objetivo } : {}) } : i)),
  };
}

export function bifurcarInvestigacion(estado: EstadoRosa, investigacionId: string, motivo: string, ahora: number): { estado: EstadoRosa; id: string | null } {
  const origen = estado.investigaciones.find((i) => i.id === investigacionId);
  if (!origen) return { estado, id: null };
  const id = nuevoId('inv');
  const rama: Investigacion = {
    ...origen,
    id,
    titulo: motivo.trim() === '' ? `${origen.titulo} (rama)` : motivo.trim().slice(0, 90),
    objetivo: motivo.trim() === '' ? origen.objetivo : `${origen.objetivo}\n\nRama de '${origen.titulo}': ${motivo.trim()}`,
    creadaEn: ahora,
    ramaDe: origen.id,
    vigilarLiteraturaHasta: null,
    // La rama recalcula su mapa, su ruta y sus cifras; no hereda los del origen.
    mapaEnfermedad: null,
    mapaRuta: null,
    cifrasAprendizaje: null,
  };
  const hechos = copiarHechos(estado.hechos, investigacionId, id, ahora);
  return { estado: { ...estado, investigaciones: [...estado.investigaciones, rama], hechos: [...estado.hechos, ...hechos] }, id };
}

/** Copia los hechos de una investigación a otra con el sufijo del destino en el
 *  id y remapea los enlaces entre hechos (sustituyeA, sustituidoPor, resuelveA,
 *  contradiceA) hacia las copias; un enlace a un hecho que no viaja se conserva.
 *  Al heredar, los repetidos del origen (mismo texto normalizado o el mismo
 *  hecho con otras palabras, ver `mismoHecho`) se funden en el más antiguo,
 *  sumando procedencia, afirmaciones y citas, con un movimiento en su historial
 *  fechado en `ahora` (si no llega, en el `actualizadoEn` más reciente de las
 *  copias). Misma regla que rosa/estado/acciones.py copiar_hechos. */
export function copiarHechos(hechos: HechoMundo[], origenId: string, destinoId: string, ahora?: number): HechoMundo[] {
  const propios = hechos.filter((h) => h.investigacionId === origenId);
  const mapa = new Map(propios.map((h) => [h.id, `${h.id}-${destinoId}`]));
  const re = (v: string) => mapa.get(v) ?? v;
  const copias = propios.map((h) => ({
    ...h,
    id: mapa.get(h.id) ?? h.id,
    investigacionId: destinoId,
    ...(h.sustituyeA ? { sustituyeA: h.sustituyeA.map(re) } : {}),
    ...(h.resuelveA ? { resuelveA: h.resuelveA.map(re) } : {}),
    ...(h.contradiceA ? { contradiceA: h.contradiceA.map(re) } : {}),
    ...(h.sustituidoPor ? { sustituidoPor: re(h.sustituidoPor) } : {}),
  }));
  const fecha = ahora ?? copias.reduce((m, c) => Math.max(m, c.actualizadoEn ?? 0), 0);
  return fundirHechosRepetidos(copias, fecha).hechos;
}

/* ---------------------------------------------------------------------
   Hechos repetidos: la misma regla que rosa/hechos.py (y que
   rosa/cuestiones.py para la equivalencia de textos). El servidor la aplica
   también al cargar un estado guardado; aquí sirve para que la vista
   optimista de heredar o bifurcar coincida con lo que devolverá el servidor.
   --------------------------------------------------------------------- */

const GRIEGAS: Record<string, string> = { α: 'alfa', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', κ: 'kappa', λ: 'lambda', μ: 'mu', σ: 'sigma', τ: 'tau', ω: 'omega' };

/** Minúsculas y sin marcas diacríticas (NFKD): `_sin_tildes` en rosa/cuestiones.py. */
function sinMarcasDiacriticas(t: string): string {
  return t.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Palabras vacías de hasta tres letras (castellano e inglés) que no cuentan como marca corta; la negación queda fuera a propósito. */
const VACIAS_CORTAS = new Set(
  (
    'a al así aún con de del e el en era es esa ese eso fue ha han hay he la las le les lo los más me mi mis muy nos o os por que se ser si son su sus tan te tu tus u un una uno y ya vs etc ' +
    'an and are as at be but by can did do for had has her his how if in is it its may of on or our out she so the to up was we who why you all any yet'
  )
    .split(/\s+/)
    .filter((p) => p !== '')
    .map(sinMarcasDiacriticas),
);

/** Palabras de orden o dirección: si dos textos comparten una, los tokens comunes tienen que ir en el mismo orden. */
const DIRECCION = new Set(
  (
    'antes después previo previa previos previas posterior posteriores anterior anteriores precede preceden precedido precedida ' +
    'primero primera luego tras sigue siguen seguido seguida causa causan causado causada provoca provocan predice predicen ' +
    'predictor predictora mayor mayores menor menores superior inferior aumenta aumentan reduce reducen induce inducen depende dependen ' +
    'before after prior precedes preceded earlier later first then follows followed following cause causes caused predict ' +
    'predicts predicted predictor higher lower greater larger smaller than increase increases decrease decreases induce induces ' +
    'mediate mediates depend depends upstream downstream'
  )
    .split(/\s+/)
    .filter((p) => p !== '')
    .map(sinMarcasDiacriticas),
);

const UMBRAL_JACCARD_HECHOS = 0.8;
const UMBRAL_MISMA_REFERENCIA = 0.6;
const TIPOS_FUNDIBLES: TipoHecho[] = ['hecho', 'pregunta'];
const ENLACES_HECHO = ['sustituyeA', 'resuelveA', 'contradiceA'] as const;

interface PerfilTexto {
  normalizado: string;
  largos: Set<string>;
  marcas: Set<string>;
  orden: string[];
}

const CACHE_PERFIL = new Map<string, PerfilTexto>();
const TOPE_CACHE_PERFIL = 8192;

/** `_perfil` de rosa/cuestiones.py: texto normalizado (letras griegas por su nombre), tokens largos, marcas cortas y orden de aparición.
 *  Con caché acotada: fundir compara cada hecho con los de su bloque y sin ella volvía a normalizar el mismo texto cientos de veces. */
function perfilTexto(texto: string): PerfilTexto {
  const clave = texto ?? '';
  const guardado = CACHE_PERFIL.get(clave);
  if (guardado) return guardado;
  const s = sinMarcasDiacriticas(clave).replace(/[αβγδεκλμστω]/g, (c) => GRIEGAS[c] ?? c);
  const normalizado = s.toLowerCase().replace(/[^0-9a-z\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const partes = normalizado === '' ? [] : normalizado.split(' ');
  const largos = new Set(partes.filter((t) => t.length > 3));
  const marcas = new Set(partes.filter((t) => t.length <= 3 && !VACIAS_CORTAS.has(t)));
  const orden = Array.from(new Set(partes.filter((t) => largos.has(t) || marcas.has(t))));
  const perfil = { normalizado, largos, marcas, orden };
  if (CACHE_PERFIL.size >= TOPE_CACHE_PERFIL) CACHE_PERFIL.clear();
  CACHE_PERFIL.set(clave, perfil);
  return perfil;
}

function mismosConjuntos(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function solapeDeTokens(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes += 1;
  return comunes / union.size;
}

function mismoOrden(pa: PerfilTexto, pb: PerfilTexto): boolean {
  const comunes = new Set(pa.orden.filter((t) => pb.orden.includes(t)));
  const oa = pa.orden.filter((t) => comunes.has(t));
  const ob = pb.orden.filter((t) => comunes.has(t));
  return oa.length === ob.length && oa.every((t, i) => t === ob[i]);
}

function compartenDireccion(pa: PerfilTexto, pb: PerfilTexto): boolean {
  return pa.orden.some((t) => DIRECCION.has(t) && pb.orden.includes(t));
}

function conComa(n: number, decimales: number): string {
  // Coma fija, NO coma() de lib/formato: esto va a texto que se guarda, y el
  // separador de coma() cambia con el idioma de la pantalla. Igual que en
  // rosa/estado/acciones.py.
  return n.toFixed(decimales).replace('.', ',');
}

/** Texto normalizado de un enunciado: minúsculas, sin tildes ni signos, letras griegas por su nombre. Misma regla que rosa/cuestiones.py normalizar. */
export function normalizarEnunciado(texto: string): string {
  return perfilTexto(texto).normalizado;
}

/** Motivo por el que dos textos dicen lo mismo, o null. Misma regla que rosa/cuestiones.py equivalencia:
 *  texto normalizado idéntico, o solape de tokens largos de al menos 0,8 con las mismas marcas cortas
 *  (siglas, cifras, negaciones) y, si comparten una palabra de dirección, el mismo orden. */
export function equivalenciaTextos(a: string, b: string): string | null {
  const pa = perfilTexto(a);
  const pb = perfilTexto(b);
  if (pa.normalizado === '' || pb.normalizado === '') return null;
  if (pa.normalizado === pb.normalizado) return 'texto normalizado idéntico';
  if (!mismosConjuntos(pa.marcas, pb.marcas)) return null;
  const j = solapeDeTokens(pa.largos, pb.largos);
  if (j < UMBRAL_JACCARD_HECHOS) return null;
  if (compartenDireccion(pa, pb) && !mismoOrden(pa, pb)) return null;
  return `solape de tokens ${conComa(j, 2)} >= ${conComa(UMBRAL_JACCARD_HECHOS, 1)}`;
}

/** Números escritos con letra: el solape de tokens no distingue "excluyeron cuatro" de "excluyeron seis". Misma lista que rosa/hechos.py NUMEROS_EN_LETRA. */
const NUMEROS_EN_LETRA = new Set(
  (
    'cero uno una dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince veinte treinta cuarenta cincuenta cien ciento mil millon millones mitad tercio doble triple ' +
    'zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million half third double triple'
  ).split(/\s+/),
);
/** Negaciones de más de tres letras, ya normalizadas ("no", "not", "sin" y "ni" son marcas cortas). */
const NEGACIONES_LARGAS = new Set('nunca jamás tampoco ninguna ningún ninguno never neither nor none without'.split(/\s+/).map((p) => normalizarEnunciado(p)));
/** La misma sigla en dos idiomas; solo pares de tres letras o más. */
const SINONIMOS_SIGLA: Record<string, string> = { csf: 'lcr', dcl: 'mci', tep: 'pet' };
/** Una referencia sin autor ("Sin autor", "Sin autor, 2023") no identifica una obra: solo vale el id de fuente. */
const REFERENCIA_GENERICA = 'sin autor';
const CITA_ENTRE_CORCHETES = /\[[^\]]*\]/g;
const TOKEN_CRUDO = /[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/gu;
/** `PATRON_CIFRA` de rosa/verificador.py: cifras con separador de miles o decimal. */
const PATRON_CIFRA = /(?<![\p{L}\p{N}_.])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(%|por ciento)?/gu;

/** El enunciado sin la cita entre corchetes que el paso de modelo añade al final. */
function sinCita(texto: string): string {
  return (texto ?? '').replace(CITA_ENTRE_CORCHETES, ' ');
}

/** `normalizar_cifra` de rosa/verificador.py: "1.234,5" y "1,234.5" quedan iguales; "12,5" y "12.5" también. */
function normalizarCifra(c: string): string {
  const t = c.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return t.replace(/[.,]/g, '');
  if (/^\d{1,3}([.,]\d{3})+[.,]\d+$/.test(t)) {
    const i = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    return t.slice(0, i).replace(/[.,]/g, '') + '.' + t.slice(i + 1);
  }
  return t.replace(/,/g, '.');
}

/** Las cifras del texto y los números escritos con letra. Misma regla que rosa/hechos.py numeros_de. */
export function numerosDe(texto: string): Set<string> {
  const salida = new Set<string>();
  for (const t of normalizarEnunciado(texto).split(' ')) if (NUMEROS_EN_LETRA.has(t)) salida.add(t);
  for (const m of (texto ?? '').matchAll(PATRON_CIFRA)) salida.add(normalizarCifra(m[1]!));
  return salida;
}

/** Las negaciones largas del texto normalizado (nunca, jamás, never...). Misma regla que rosa/hechos.py negaciones_de. */
export function negacionesDe(texto: string): Set<string> {
  return new Set(normalizarEnunciado(texto).split(' ').filter((t) => NEGACIONES_LARGAS.has(t)));
}

/** Las siglas y los nombres con cifra tal como están escritos: tokens de al menos tres caracteres con una mayúscula
 *  fuera de la primera letra (GFAP, sTREM2, NfL, ApoE) o con algún dígito (APOE4, p-tau217, YKL40), normalizados y sin
 *  espacios. Las palabras que solo empiezan por mayúscula (Belder, La) no cuentan; fuera quedan las cifras sueltas, los
 *  tokens de `excluir` (la referencia de la obra) y "et"/"al". Misma regla que rosa/hechos.py siglas_de. */
export function siglasDe(texto: string, excluir: Set<string> = new Set()): Set<string> {
  const salida = new Set<string>();
  for (const m of (texto ?? '').matchAll(TOKEN_CRUDO)) {
    const tok = m[0];
    if (tok.length < 3) continue;
    if (!(/\p{Lu}/u.test(tok.slice(1)) || /\p{N}/u.test(tok))) continue;
    const partes = normalizarEnunciado(tok).split(' ').filter((x) => x !== '');
    const n = partes.join('');
    if (n === '' || /^\p{N}+$/u.test(n) || n === 'et' || n === 'al' || excluir.has(n) || partes.every((x) => excluir.has(x))) continue;
    salida.add(SINONIMOS_SIGLA[n] ?? n);
  }
  return salida;
}

/** True si las dos procedencias comparten una fuente (mismo `fuenteId`) o una referencia corta normalizada: la señal de que
 *  dos enunciados parecidos salen del mismo artículo y no de dos cohortes; una referencia genérica ("Sin autor...") no cuenta.
 *  Misma regla que rosa/hechos.py comparte_referencia. */
export function comparteReferencia(a: HechoMundo['procedencia'] | null | undefined, b: HechoMundo['procedencia'] | null | undefined): boolean {
  const claves = (proc: HechoMundo['procedencia'] | null | undefined) => {
    const salida = new Set<string>();
    for (const p of proc ?? []) {
      if (!p) continue;
      if (p.fuenteId) salida.add(`id|${p.fuenteId}`);
      const ref = normalizarEnunciado(p.referencia ?? '');
      if (ref !== '' && !ref.startsWith(REFERENCIA_GENERICA)) salida.add(`ref|${ref}`);
    }
    return salida;
  };
  const ca = claves(a);
  for (const k of claves(b)) if (ca.has(k)) return true;
  return false;
}

function tokensDeReferencias(...hechos: HechoMundo[]): Set<string> {
  const salida = new Set<string>();
  for (const h of hechos) for (const p of h.procedencia ?? []) for (const t of normalizarEnunciado(p?.referencia ?? '').split(' ')) if (t !== '') salida.add(t);
  return salida;
}

/** Por qué dos hechos con palabras parecidas no pueden ser el mismo, o null si pasan las cuatro guardas del bucle
 *  (rosa/bucle/pasos.py hecho_duplicado): referencia compartida cuando alguno tiene procedencia, mismos números, mismas
 *  siglas y mismas negaciones largas. Misma regla que rosa/hechos.py guardas_de_parafrasis. */
export function guardasDeParafrasis(a: HechoMundo, b: HechoMundo): string | null {
  const pa = a.procedencia ?? [];
  const pb = b.procedencia ?? [];
  if ((pa.length > 0 || pb.length > 0) && !comparteReferencia(pa, pb)) return 'otra fuente sin referencia común: una replicación vive aparte';
  const la = sinCita(a.enunciado ?? '');
  const lb = sinCita(b.enunciado ?? '');
  if (!mismosConjuntos(numerosDe(la), numerosDe(lb))) return 'números distintos';
  if (!mismosConjuntos(negacionesDe(la), negacionesDe(lb))) return 'una negación que el otro no tiene';
  const ref = tokensDeReferencias(a, b);
  if (!mismosConjuntos(siglasDe(la, ref), siglasDe(lb, ref))) return 'siglas distintas';
  return null;
}

function referenciasDeHecho(h: HechoMundo): Set<string> {
  const refs = new Set<string>();
  for (const a of h.afirmacionIds ?? []) if (a) refs.add(`af|${a}`);
  for (const p of h.procedencia ?? []) if (p.fuenteId && p.pagina !== null && p.pagina !== undefined) refs.add(`fp|${p.fuenteId}|${p.pagina}`);
  return refs;
}

/** True si uno sustituye o contradice al otro: no son repetidos, son una pareja deliberada. */
function hechosEnlazados(a: HechoMundo, b: HechoMundo): boolean {
  for (const [x, y] of [[a, b.id], [b, a.id]] as const) {
    if ((x.sustituyeA ?? []).includes(y) || (x.contradiceA ?? []).includes(y) || x.sustituidoPor === y) return true;
  }
  return false;
}

/** Motivo por el que dos hechos son el mismo, o null. Misma regla que rosa/hechos.py mismo_hecho:
 *  misma investigación, mismo tipo (nunca las entradas de revisión de una hipótesis) y mismo estado,
 *  no enlazados entre sí; texto normalizado idéntico, o una paráfrasis que pasa las guardas del bucle
 *  (`guardasDeParafrasis`: referencia compartida, mismos números, siglas y negaciones largas); con una
 *  referencia fina compartida (afirmación, o fuente y página) el umbral de solape baja a 0,6 con las
 *  mismas guardas. La referencia sola no basta: un mismo artículo sostiene varios hechos distintos en
 *  la misma página. */
export function mismoHecho(a: HechoMundo, b: HechoMundo): string | null {
  if (a === b || a.id === b.id) return null;
  if (!TIPOS_FUNDIBLES.includes(a.tipo) || b.tipo !== a.tipo) return null;
  if (a.estado !== b.estado || a.investigacionId !== b.investigacionId) return null;
  if (hechosEnlazados(a, b)) return null;
  const na = normalizarEnunciado(a.enunciado ?? '');
  const nb = normalizarEnunciado(b.enunciado ?? '');
  if (na === '' || nb === '') return null;
  if (na === nb) return 'texto normalizado idéntico';
  if (guardasDeParafrasis(a, b)) return null;
  const motivo = equivalenciaTextos(a.enunciado, b.enunciado);
  if (motivo) return motivo;
  const ra = referenciasDeHecho(a);
  let comparten = false;
  for (const r of referenciasDeHecho(b)) {
    if (ra.has(r)) {
      comparten = true;
      break;
    }
  }
  if (!comparten) return null;
  const pa = perfilTexto(a.enunciado);
  const pb = perfilTexto(b.enunciado);
  if (pa.normalizado === '' || pb.normalizado === '') return null;
  if (!mismosConjuntos(pa.marcas, pb.marcas)) return null;
  const j = solapeDeTokens(pa.largos, pb.largos);
  if (j < UMBRAL_MISMA_REFERENCIA) return null;
  if (compartenDireccion(pa, pb) && !mismoOrden(pa, pb)) return null;
  return `misma referencia y solape de tokens ${conComa(j, 2)} >= ${conComa(UMBRAL_MISMA_REFERENCIA, 1)}`;
}

function sumarPorClave<T>(base: T[], extra: T[], clave: (x: T) => string): T[] {
  const vistos = new Set(base.map(clave));
  const salida = [...base];
  for (const x of extra) {
    const k = clave(x);
    if (!vistos.has(k)) {
      salida.push(x);
      vistos.add(k);
    }
  }
  return salida;
}

/** El hecho `destino` con lo que aporta `duplicado`: procedencia, afirmaciones, citas, entidades y enlaces
 *  sumados sin repetir, prioridad máxima, y un movimiento en el historial que nombra al repetido y el motivo.
 *  `actualizadoEn` no cambia; una lista guardada en null cuenta como vacía. Devuelve un objeto nuevo; no toca ninguno de los dos. Misma regla que rosa/hechos.py fundir. */
export function fundirHechos(destino: HechoMundo, duplicado: HechoMundo, ahora: number, motivo: string): HechoMundo {
  const enlaces: Partial<Pick<HechoMundo, 'sustituyeA' | 'resuelveA' | 'contradiceA'>> = {};
  for (const clave of ENLACES_HECHO) {
    const extra = (duplicado[clave] ?? []).filter((x) => x && x !== destino.id);
    if (extra.length > 0 || destino[clave] !== undefined) enlaces[clave] = Array.from(new Set([...(destino[clave] ?? []), ...extra]));
  }
  const cambios: Partial<HechoMundo> = {};
  if ((duplicado.entidades ?? []).length > 0) cambios.entidades = sumarPorClave(destino.entidades ?? [], duplicado.entidades ?? [], (x) => x.id);
  if (!destino.sustituidoPor && duplicado.sustituidoPor && duplicado.sustituidoPor !== destino.id) cambios.sustituidoPor = duplicado.sustituidoPor;
  if (!destino.pendienteRevision && duplicado.pendienteRevision) cambios.pendienteRevision = duplicado.pendienteRevision;
  if (!destino.motivoDescarte && duplicado.motivoDescarte) cambios.motivoDescarte = duplicado.motivoDescarte;
  if ((destino.cerradoEn ?? null) === null && (duplicado.cerradoEn ?? null) !== null) cambios.cerradoEn = duplicado.cerradoEn;
  return {
    ...destino,
    procedencia: sumarPorClave(destino.procedencia ?? [], duplicado.procedencia ?? [], (p) => `${p.fuenteId}|${p.pagina ?? ''}`),
    afirmacionIds: Array.from(new Set([...(destino.afirmacionIds ?? []), ...(duplicado.afirmacionIds ?? []).filter((x) => x !== '')])),
    citas: sumarPorClave(destino.citas ?? [], duplicado.citas ?? [], (c) => `${c.referencia}|${c.seccion}`),
    ...enlaces,
    ...cambios,
    prioridad: Math.max(destino.prioridad ?? 0, duplicado.prioridad ?? 0),
    historial: [
      ...(destino.historial ?? []),
      { fecha: ahora, de: destino.estado, a: destino.estado, quien: 'Rosa', motivo: `Fundido con ${duplicado.id}: «${(duplicado.enunciado ?? '').slice(0, 160)}» (${motivo}); se suman su procedencia y sus afirmaciones` },
    ],
  };
}

function remapearEnlacesDeHecho(h: HechoMundo, mapa: Map<string, string>): HechoMundo {
  const re = (v: string) => mapa.get(v) ?? v;
  const listas: Partial<Pick<HechoMundo, 'sustituyeA' | 'resuelveA' | 'contradiceA'>> = {};
  for (const clave of ENLACES_HECHO) {
    const lista = h[clave];
    if (lista && lista.some((x) => mapa.has(x))) listas[clave] = Array.from(new Set(lista.map(re))).filter((x) => x !== h.id);
  }
  const sp = h.sustituidoPor;
  const cambioSp = sp && mapa.has(sp) ? { sustituidoPor: mapa.get(sp) === h.id ? null : (mapa.get(sp) ?? null) } : {};
  return { ...h, ...listas, ...cambioSp };
}

/** Funde los hechos repetidos de una lista (en orden: el primero de cada grupo sobrevive) y remapea los enlaces
 *  que apuntaban a un repetido. Devuelve los supervivientes y el mapa de id repetido a id superviviente.
 *  Misma regla que rosa/hechos.py fundir_duplicados. */
export function fundirHechosRepetidos(hechos: HechoMundo[], ahora: number): { hechos: HechoMundo[]; mapa: Map<string, string> } {
  const supervivientes: HechoMundo[] = [];
  // Dos hechos solo pueden ser el mismo si coinciden en tipo, estado, investigación y marcas cortas (todas las
  // vías de `mismoHecho` lo exigen): los bloques evitan comparar todos con todos sin cambiar el resultado.
  const bloques = new Map<string, number[]>();
  const claveDeBloque = (h: HechoMundo) => `${h.tipo}|${h.estado}|${h.investigacionId}|${Array.from(perfilTexto(h.enunciado).marcas).sort().join(' ')}`;
  const mapa = new Map<string, string>();
  for (const h of hechos) {
    let fundido = false;
    const clave = claveDeBloque(h);
    const indices = bloques.get(clave) ?? [];
    for (const i of indices) {
      const s = supervivientes[i]!;
      const motivo = mismoHecho(s, h);
      if (motivo) {
        supervivientes[i] = fundirHechos(s, h, ahora, motivo);
        mapa.set(h.id, s.id);
        fundido = true;
        break;
      }
    }
    if (!fundido) {
      supervivientes.push(h);
      bloques.set(clave, [...indices, supervivientes.length - 1]);
    }
  }
  if (mapa.size === 0) return { hechos: supervivientes, mapa };
  return { hechos: supervivientes.map((h) => remapearEnlacesDeHecho(h, mapa)), mapa };
}

export function actualizarConfiguracion(estado: EstadoRosa, investigacionId: string, configuracion: Investigacion['configuracion']): EstadoRosa {
  return {
    ...estado,
    investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({
      ...i,
      configuracion: {
        preferencias: configuracion.preferencias.trim(),
        atributos: configuracion.atributos.map((a) => a.trim()).filter((a) => a !== ''),
        restricciones: configuracion.restricciones.map((r) => r.trim()).filter((r) => r !== ''),
        amplitud: configuracion.amplitud ?? i.configuracion.amplitud ?? 'equilibrada',
      },
    })),
  };
}

/** Cuánto explora ROSA2018 fuera de la pregunta (botones enfocada, equilibrada, amplia). Misma regla que rosa/estado/acciones.py. */
export function fijarAmplitud(estado: EstadoRosa, investigacionId: string, amplitud: Amplitud): EstadoRosa {
  if (!['enfocada', 'equilibrada', 'amplia'].includes(amplitud)) return estado;
  return {
    ...estado,
    investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, configuracion: { ...i.configuracion, amplitud } })),
  };
}

export function anadirDataset(estado: EstadoRosa, investigacionId: string, dataset: Omit<Dataset, 'id' | 'estado'>): EstadoRosa {
  if (dataset.nombre.trim() === '') return estado;
  const d: Dataset = { ...dataset, id: nuevoId('ds'), estado: 'pendiente' };
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: [...i.datasets, d] })) };
}

/** Aprobar el contrato de datos. No se aprueba si quedan columnas sin
 *  diccionario, valores centinela o nombres duplicados: primero se corrigen. */
export function decidirDataset(estado: EstadoRosa, investigacionId: string, datasetId: string, decision: 'aprobado' | 'rechazado'): EstadoRosa {
  const inv = estado.investigaciones.find((i) => i.id === investigacionId);
  const ds = inv?.datasets.find((d) => d.id === datasetId);
  if (!inv || !ds) return estado;
  if (decision === 'aprobado' && (ds.columnasSinDiccionario > 0 || ds.valoresCentinela > 0 || ds.nombresDuplicados > 0)) return estado;
  // Un dataset con fichero no se aprueba sin libro de procedencia completo.
  const p = ds.procedencia;
  if (decision === 'aprobado' && p && p.hash && (p.origen.trim() === '' || p.licencia.trim() === '' || p.usoIAAutorizado !== 'si')) return estado;
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: i.datasets.map((d) => (d.id === datasetId ? { ...d, estado: decision } : d)) })) };
}

/** ROSA2018 propone un diccionario de columnas y la persona lo aprueba: deja las
 *  columnas sin diccionario en cero. */
export function aprobarDiccionario(estado: EstadoRosa, investigacionId: string, datasetId: string): EstadoRosa {
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: i.datasets.map((d) => (d.id === datasetId ? { ...d, columnasSinDiccionario: 0 } : d)) })) };
}

/** Marcar los centinelas y duplicados como corregidos en el fichero. */
export function corregirDataset(estado: EstadoRosa, investigacionId: string, datasetId: string): EstadoRosa {
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: i.datasets.map((d) => (d.id === datasetId ? { ...d, valoresCentinela: 0, nombresDuplicados: 0 } : d)) })) };
}

export function clasificarDataset(estado: EstadoRosa, investigacionId: string, datasetId: string, clasificacion: ClasificacionDatos): EstadoRosa {
  return { ...estado, investigaciones: reemplazar(estado.investigaciones, investigacionId, (i) => ({ ...i, datasets: i.datasets.map((d) => (d.id === datasetId ? { ...d, clasificacion } : d)) })) };
}

/* ---------------------------------------------------------------------
   Artefactos
   --------------------------------------------------------------------- */

export function destacarArtefacto(estado: EstadoRosa, artefactoId: string): EstadoRosa {
  return { ...estado, artefactos: reemplazar(estado.artefactos, artefactoId, (a) => ({ ...a, destacado: !a.destacado })) };
}

/** Guardar un artefacto nuevo o una version nueva del mismo nombre. */
export function guardarArtefacto(estado: EstadoRosa, investigacionId: string, nombre: string, tipo: TipoArtefacto, contenido: string, resumen: string, iteracion: number, ahora: number): { estado: EstadoRosa; id: string } {
  const existente = estado.artefactos.find((a) => a.investigacionId === investigacionId && a.nombre === nombre);
  if (existente) {
    const n = existente.versiones.length + 1;
    return {
      estado: { ...estado, artefactos: reemplazar(estado.artefactos, existente.id, (a) => ({ ...a, versiones: [...a.versiones, { n, creadaEn: ahora, resumen, contenido, iteracion }] })) },
      id: existente.id,
    };
  }
  const id = nuevoId('art');
  return {
    estado: { ...estado, artefactos: [...estado.artefactos, { id, investigacionId, nombre, tipo, destacado: false, versiones: [{ n: 1, creadaEn: ahora, resumen, contenido, iteracion }] }] },
    id,
  };
}

/* ---------------------------------------------------------------------
   Calidad
   --------------------------------------------------------------------- */

export function cambiarEstadoCaso(estado: EstadoRosa, clave: string, nuevo: 'aprobado' | 'descartado' | 'propuesto'): EstadoRosa {
  return { ...estado, casos: estado.casos.map((c) => (c.clave === clave ? { ...c, estado: nuevo } : c)) };
}

export function editarRespuestaCaso(estado: EstadoRosa, clave: string, respuesta: string): EstadoRosa {
  const limpia = respuesta.trim();
  if (limpia === '' || limpia.length > 2000) return estado;
  return { ...estado, casos: estado.casos.map((c) => (c.clave === clave ? { ...c, respuestaEsperada: limpia } : c)) };
}

/* ---------------------------------------------------------------------
   Ajustes
   --------------------------------------------------------------------- */

export function editarRecuerdo(estado: EstadoRosa, id: string, texto: string): EstadoRosa {
  const limpio = texto.trim();
  if (limpio === '') return estado;
  return { ...estado, memoria: reemplazar(estado.memoria, id, (r) => ({ ...r, texto: limpio })) };
}

export function borrarRecuerdo(estado: EstadoRosa, id: string): EstadoRosa {
  return { ...estado, memoria: estado.memoria.filter((r) => r.id !== id) };
}

export function anadirCriterio(estado: EstadoRosa, texto: string): EstadoRosa {
  const limpio = texto.trim();
  if (limpio === '' || estado.criteriosRevision.includes(limpio)) return estado;
  return { ...estado, criteriosRevision: [...estado.criteriosRevision, limpio] };
}

export function borrarCriterio(estado: EstadoRosa, indice: number, texto?: string): EstadoRosa {
  // Con texto se borra la primera coincidencia; la posicion es solo el
  // respaldo cuando no se conoce el texto.
  const i = texto !== undefined ? estado.criteriosRevision.indexOf(texto) : indice;
  if (i < 0 || i >= estado.criteriosRevision.length) return estado;
  return { ...estado, criteriosRevision: estado.criteriosRevision.filter((_, j) => j !== i) };
}

export function actualizarAvisos(estado: EstadoRosa, avisos: Avisos): EstadoRosa {
  return { ...estado, avisos };
}

export function actualizarPoliticaEsperas(estado: EstadoRosa, politica: PoliticaEsperas): EstadoRosa {
  // Mismos límites que `actualizar_politica_esperas` en rosa/estado/acciones.py:
  // un año como tope (una espera de cien años no es una política, es un
  // descuido) y la acción dentro de las cuatro que el bucle sabe hacer. Hasta el
  // 29 de septiembre de 2026 este lado solo comprobaba que las horas fueran
  // positivas, así que la interfaz aceptaba lo que el servidor luego rechazaba
  // sin decir por qué.
  if (!Number.isFinite(politica.horas) || politica.horas <= 0 || politica.horas > 24 * 365) return estado;
  if (!['recordar', 'escalar', 'detener', 'continuar'].includes(politica.accion)) return estado;
  return { ...estado, politicaEsperas: { ...politica, escalarA: politica.escalarA.trim().slice(0, 200) } };
}

export function borrarPlanGuardado(estado: EstadoRosa, id: string): EstadoRosa {
  return { ...estado, planesGuardados: estado.planesGuardados.filter((p) => p.id !== id) };
}

/** La misma tabla, traducida al leerla, para ENSEÑARLA. Los reductores usan
 *  `PROPOSITOS_BIOMARCADOR`, en castellano, porque lo que escriben se guarda. */
export const PROPOSITOS_BIOMARCADOR_VISTA = traducido(PROPOSITOS_BIOMARCADOR);
