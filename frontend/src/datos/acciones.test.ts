import { describe, expect, it } from 'vitest';
import {
  aclararHipotesis,
  ampliarPresupuesto,
  anadirComentario,
  asignarExperimento,
  cambiarEstadoArea,
  enmendarExperimento,
  FICHERO_SINTETICO,
  enmendarLectura,
  bloquePrerregistro,
  hashLecturas,
  lecturasParaHash,
  normalizarContrato,
  sha256Hex,
  registrarProtocoloReal,
  aprobarPlan,
  abrirCuestion,
  atenderPendiente,
  bifurcarInvestigacion,
  copiarHechos,
  descartarCuestion,
  empeoraAlEvaluar,
  fusionarHipotesis,
  promoverAprendizaje,
  rechazarFusion,
  reabrirCuestion,
  resolverCuestion,
  borrarCriterio,
  crearInvestigacion,
  decidirDataset,
  detenerCorrida,
  detenerPista,
  dirigirCorrida,
  editarPlan,
  editarRespuestaCaso,
  enviarComentarios,
  inyectarDebilidad,
  pausarCorrida,
  preguntarAlModeloDeMundo,
  proponerHipotesis,
  quitarComentario,
  reanudarCorrida,
  replicarHipotesis,
  resolverIncidencia,
  resolverSolicitud,
  resolverSolicitudes,
  registrarDatosExperimento,
  revisarHipotesis,
  revocarPermiso,
  volverAIteracion,
  editarInvestigacion,} from './acciones';
import { AHORA_MUESTRA, estadoDeMuestra } from './muestra';
import { nuevaIteracion } from './simulacion';

const T = AHORA_MUESTRA + 1000;

describe('corrida', () => {
  it('pausa y reanuda sin tocar las demas corridas', () => {
    const e0 = estadoDeMuestra();
    const e1 = pausarCorrida(e0, 'cor-3');
    expect(e1.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('pausada');
    expect(e1.corridas.find((c) => c.id === 'cor-2')?.estado).toBe('terminada');
    const e2 = reanudarCorrida(e1, 'cor-3');
    expect(e2.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('en_marcha');
  });
  it('detener pone motivo por defecto, deja evento y opcionalmente vigila la literatura', () => {
    const e1 = detenerCorrida(estadoDeMuestra(), 'cor-3', '   ', T, 30);
    const c = e1.corridas.find((x) => x.id === 'cor-3')!;
    expect(c.estado).toBe('detenida');
    expect(c.motivoCierre).toBe('Detenida por la investigadora.');
    expect(e1.eventos.at(-1)?.tipo).toBe('corrida_estado');
    expect(e1.investigaciones[0]!.vigilarLiteraturaHasta).toBe(T + 30 * 86_400_000);
    const e2 = detenerCorrida(e1, 'cor-3', 'otro', T + 1);
    expect(e2).toBe(e1);
  });
  it('dirigir inserta la indicacion justo despues del paso en curso', () => {
    const e1 = dirigirCorrida(estadoDeMuestra(), 'cor-3', 'Prioriza GFAP sobre NfL');
    const plan = e1.iteraciones.find((i) => i.id === 'it-14')!.plan;
    const idx = plan.findIndex((p) => p.indicacionHumana);
    expect(idx).toBe(3);
    expect(plan[idx - 1]?.estado).toBe('en_curso');
    expect(plan[idx]?.detalle).toBe('Prioriza GFAP sobre NfL');
  });
  it('ampliar el presupuesto reanuda una corrida pausada por presupuesto y no admite un tope menor que lo gastado', () => {
    let e = estadoDeMuestra();
    e = { ...e, corridas: e.corridas.map((c) => (c.id === 'cor-3' ? { ...c, estado: 'pausada_por_presupuesto' as const } : c)) };
    expect(ampliarPresupuesto(e, 'cor-3', 1000, T)).toBe(e);
    const e2 = ampliarPresupuesto(e, 'cor-3', 4500, T);
    const c = e2.corridas.find((x) => x.id === 'cor-3')!;
    expect(c.estado).toBe('en_marcha');
    expect(c.presupuesto.limiteLlamadas).toBe(4500);
    // Con el tope nuevo ya no se ha cruzado el 80 %, asi que esa alerta volvera a avisar.
    expect(c.presupuesto.avisadas).toEqual([0.5]);
  });
  it('ampliar el presupuesto sube también el tope de la iteración en curso con el mismo margen (misma regla que rosa/estado/acciones.py)', () => {
    let e = estadoDeMuestra();
    // La iteración en curso agotó su tope: 120 de 120. Antes, ampliar solo tocaba la corrida y
    // la primera llamada volvía a pausar por el tope de la iteración.
    e = {
      ...e,
      corridas: e.corridas.map((c) => (c.id === 'cor-3' ? { ...c, estado: 'pausada_por_presupuesto' as const } : c)),
      iteraciones: e.iteraciones.map((i) => (i.id === 'it-14' ? { ...i, presupuesto: { limite: 120, usado: 120 } } : i)),
    };
    const antes = e.corridas.find((c) => c.id === 'cor-3')!.presupuesto.limiteLlamadas;
    const e2 = ampliarPresupuesto(e, 'cor-3', antes + 300, T);
    const it = e2.iteraciones.find((i) => i.id === 'it-14')!;
    expect(it.presupuesto.limite).toBe(120 + 300);
    expect(it.presupuesto.usado).toBe(120);
    expect(e2.corridas.find((c) => c.id === 'cor-3')!.estado).toBe('en_marcha');
    expect(e2.eventos.at(-1)?.texto).toContain(`la iteración ${it.numero} puede gastar hasta 420`);
    // Las otras iteraciones no se tocan y el estado anterior no muta.
    expect(e2.iteraciones.filter((i) => i.id !== 'it-14')).toEqual(e.iteraciones.filter((i) => i.id !== 'it-14'));
    expect(e.iteraciones.find((i) => i.id === 'it-14')!.presupuesto.limite).toBe(120);
    // Sin margen (tope igual al anterior) la iteración se queda como estaba.
    const e3 = ampliarPresupuesto(e, 'cor-3', antes, T);
    expect(e3.iteraciones.find((i) => i.id === 'it-14')!.presupuesto.limite).toBe(120);
    // Una iteración con margen de sobra no baja: max(limite, usado + margen).
    const e4 = ampliarPresupuesto({ ...e, iteraciones: e.iteraciones.map((i) => (i.id === 'it-14' ? { ...i, presupuesto: { limite: 5000, usado: 10 } } : i)) }, 'cor-3', antes + 300, T);
    expect(e4.iteraciones.find((i) => i.id === 'it-14')!.presupuesto.limite).toBe(5000);
  });
  it('ampliar el presupuesto limpia el motivo de la pausa y no rompe con una iteración antigua sin presupuesto (misma regla que el servidor)', () => {
    let e = estadoDeMuestra();
    const corrida = e.corridas.find((c) => c.id === 'cor-3')!;
    e = {
      ...e,
      corridas: e.corridas.map((c) => (c.id === 'cor-3' ? { ...c, estado: 'pausada_por_presupuesto' as const, presupuesto: { ...c.presupuesto, motivoPausa: 'la iteración 14 gastó sus 120 llamadas' } } : c)),
      // Registro antiguo: la iteración en curso no trae `presupuesto`.
      iteraciones: e.iteraciones.map((i) => (i.id === 'it-14' ? ({ ...i, presupuesto: undefined } as unknown as typeof i) : i)),
    };
    const e2 = ampliarPresupuesto(e, 'cor-3', corrida.presupuesto.limiteLlamadas + 300, T);
    const c2 = e2.corridas.find((c) => c.id === 'cor-3')!;
    expect(c2.estado).toBe('en_marcha');
    expect(c2.presupuesto.motivoPausa).toBe('');
    expect(e2.iteraciones.find((i) => i.id === 'it-14')!.presupuesto).toBeUndefined();
    expect(e2.eventos.at(-1)?.texto).toBe(`Presupuesto ampliado a ${corrida.presupuesto.limiteLlamadas + 300} llamadas`);
    // Un tope no finito o no mayor que lo gastado no cambia nada.
    expect(ampliarPresupuesto(e, 'cor-3', Number.POSITIVE_INFINITY, T)).toBe(e);
    expect(ampliarPresupuesto(e, 'cor-3', Number.NaN, T)).toBe(e);
    expect(ampliarPresupuesto(e, 'cor-3', corrida.gasto.llamadas, T)).toBe(e);
  });
  it('detener una pista la marca detenida con la indicacion y deja la corrida en marcha', () => {
    const e1 = detenerPista(estadoDeMuestra(), 'pi-4', 'usa menos memoria');
    const p = e1.iteraciones.find((i) => i.id === 'it-14')!.pistas.find((x) => x.id === 'pi-4')!;
    expect(p.estado).toBe('detenida');
    expect(p.transcripcion.at(-1)?.texto).toContain('usa menos memoria');
    expect(e1.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('en_marcha');
  });
  it('no muta el estado anterior', () => {
    const e0 = estadoDeMuestra();
    const antes = JSON.stringify(e0);
    pausarCorrida(e0, 'cor-3');
    dirigirCorrida(e0, 'cor-3', 'x');
    detenerCorrida(e0, 'cor-3', 'x', T);
    ampliarPresupuesto(e0, 'cor-3', 9000, T);
    expect(JSON.stringify(e0)).toBe(antes);
  });
});

describe('plan por aprobar', () => {
  it('un plan sin aprobar se edita y al aprobarlo la corrida arranca', () => {
    let e = estadoDeMuestra();
    const it = nuevaIteracion('cor-3', 15, T);
    e = { ...e, iteraciones: [...e.iteraciones, it], corridas: e.corridas.map((c) => (c.id === 'cor-3' ? { ...c, estado: 'esperando_plan' as const, iteracionActual: 15 } : c)) };
    const planEditado = [...it.plan.slice(1), { ...it.plan[0]!, titulo: 'Paso movido al final' }];
    e = editarPlan(e, it.id, planEditado);
    expect(e.iteraciones.find((i) => i.id === it.id)!.plan.at(-1)?.titulo).toBe('Paso movido al final');
    e = aprobarPlan(e, it.id, T + 5);
    expect(e.iteraciones.find((i) => i.id === it.id)!.planAprobado).toBe(true);
    expect(e.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('en_marcha');
    // Ya aprobado, no se edita.
    expect(editarPlan(e, it.id, it.plan.slice(0, 1))).toBe(e);
  });
  it('un plan vacio no se guarda', () => {
    let e = estadoDeMuestra();
    const it = nuevaIteracion('cor-3', 15, T);
    e = { ...e, iteraciones: [...e.iteraciones, it] };
    expect(editarPlan(e, it.id, [])).toBe(e);
  });
});

describe('volver a una iteracion', () => {
  it('abre una iteracion nueva con el plan de la anterior, sin aprobar, y cierra la actual', () => {
    const e0 = estadoDeMuestra();
    const e1 = volverAIteracion(e0, 'it-13', 'plan', T);
    const nueva = e1.iteraciones.reduce((m, i) => (i.numero > m.numero ? i : m));
    expect(nueva.numero).toBe(15);
    expect(nueva.planAprobado).toBe(false);
    expect(nueva.plan.every((p) => p.estado === 'pendiente')).toBe(true);
    expect(nueva.plan).toHaveLength(7);
    expect(e1.iteraciones.find((i) => i.id === 'it-14')!.terminadaEn).toBe(T);
    expect(e1.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('esperando_plan');
  });
  it('con "mundo" quita lo que ROSA2018 anadio despues del punto', () => {
    const e0 = estadoDeMuestra();
    // he-9 se cerro hace 50 min (despues de terminar la iteracion 13? no: la 13 termino hace 7 min). Anadimos uno posterior.
    const e = { ...e0, hechos: [...e0.hechos, { ...e0.hechos[0]!, id: 'he-tarde', actualizadoEn: AHORA_MUESTRA - 60_000, historial: [{ fecha: AHORA_MUESTRA - 60_000, de: null, a: 'sabido' as const, quien: 'Rosa', motivo: 'x' }] }] };
    const e1 = volverAIteracion(e, 'it-13', 'mundo', T);
    expect(e1.hechos.some((h) => h.id === 'he-tarde')).toBe(false);
    expect(e1.hechos.some((h) => h.id === 'he-1')).toBe(true);
  });
  it('no se puede volver a una iteracion sin terminar', () => {
    const e0 = estadoDeMuestra();
    expect(volverAIteracion(e0, 'it-14', 'plan', T)).toBe(e0);
  });
});

describe('permisos', () => {
  it('conceder con alcance mayor que una vez lo lista en permisos y deja evento', () => {
    const e1 = resolverSolicitud(estadoDeMuestra(), 'sol-2', 'conceder', 'esta_investigacion', T);
    const s = e1.solicitudes.find((x) => x.id === 'sol-2')!;
    expect(s.estado).toBe('concedida');
    const nuevo = e1.permisos.find((p) => p.recurso === 'api.niagads.org');
    expect(nuevo?.alcance).toBe('esta_investigacion');
    expect(nuevo?.investigacionId).toBe('inv-1');
    expect(e1.eventos.at(-1)?.tipo).toBe('permiso_resuelto');
  });
  it('los argumentos editables se guardan con la decision', () => {
    const e1 = resolverSolicitud(estadoDeMuestra(), 'sol-1', 'conceder', 'una_vez', T, { Llamadas: '200', Hipotesis: 'otra' });
    const s = e1.solicitudes.find((x) => x.id === 'sol-1')!;
    expect(s.argumentos.find((a) => a.nombre === 'Llamadas')?.valor).toBe('200');
    expect(s.argumentos.find((a) => a.nombre === 'Hipotesis')?.valor).toBe('hip-2 (NLRP3)');
    expect(e1.permisos.length).toBe(estadoDeMuestra().permisos.length);
  });
  it('un alcance que la solicitud no ofrece se rechaza', () => {
    const e0 = estadoDeMuestra();
    expect(resolverSolicitud(e0, 'sol-1', 'conceder', 'siempre', T)).toBe(e0);
  });
  it('aprobar por lotes salta las que no ofrecen ese alcance', () => {
    const e1 = resolverSolicitudes(estadoDeMuestra(), ['sol-1', 'sol-2', 'sol-3'], 'conceder', 'siempre', T);
    expect(e1.solicitudes.find((x) => x.id === 'sol-1')?.estado).toBe('pendiente');
    expect(e1.solicitudes.find((x) => x.id === 'sol-2')?.estado).toBe('concedida');
    expect(e1.solicitudes.find((x) => x.id === 'sol-3')?.estado).toBe('concedida');
    expect(e1.permisos.filter((p) => p.alcance === 'siempre' && p.investigacionId === null).length).toBe(estadoDeMuestra().permisos.filter((p) => p.alcance === 'siempre').length + 2);
  });
  it('la corrida que esperaba aprobacion sigue cuando no quedan pendientes', () => {
    let e = estadoDeMuestra();
    e = { ...e, corridas: e.corridas.map((c) => (c.id === 'cor-3' ? { ...c, estado: 'esperando_aprobacion' as const } : c)) };
    e = resolverSolicitudes(e, ['sol-1', 'sol-2'], 'denegar', null, T);
    expect(e.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('esperando_aprobacion');
    e = resolverSolicitud(e, 'sol-3', 'denegar', null, T);
    expect(e.corridas.find((c) => c.id === 'cor-3')?.estado).toBe('en_marcha');
  });
  it('revocar quita el permiso', () => {
    expect(revocarPermiso(estadoDeMuestra(), 'per-3').permisos.some((p) => p.id === 'per-3')).toBe(false);
  });
  it('una incidencia se resuelve con la alternativa por defecto y no se resuelve dos veces', () => {
    const e1 = resolverIncidencia(estadoDeMuestra(), 'inc-1', '', T);
    const i = e1.incidencias.find((x) => x.id === 'inc-1')!;
    expect(i.estado).toBe('resuelta');
    expect(i.resolucion).toMatch(/gpt-6-astra/);
    expect(resolverIncidencia(e1, 'inc-1', 'otra', T)).toBe(e1);
  });
});

describe('revisar hipotesis', () => {
  it('aceptar la pasa al modelo de mundo como abierta, no como sabida, con historial', () => {
    const e1 = revisarHipotesis(estadoDeMuestra(), 'hip-1', 'aceptar', 'Comprobable en FLENI', 'la persona responsable', T);
    expect(e1.hipotesis.find((h) => h.id === 'hip-1')?.estado).toBe('aceptada');
    const entrada = e1.hechos.find((h) => h.id === 'he-hip-1')!;
    expect(entrada.estado).toBe('abierto');
    expect(entrada.historial[0]?.quien).toBe('la persona responsable');
    expect(entrada.procedencia.map((p) => p.pagina)).toEqual([7, null]);
    expect(e1.eventos.at(-1)?.tipo).toBe('hipotesis_decidida');
  });
  it('descartar y no puedo juzgar exigen motivo', () => {
    const e0 = estadoDeMuestra();
    expect(revisarHipotesis(e0, 'hip-1', 'descartar', '  ', 'la persona responsable', T)).toBe(e0);
    expect(revisarHipotesis(e0, 'hip-1', 'no_puedo_juzgar', '', 'la persona responsable', T)).toBe(e0);
  });
  it('no puedo juzgar la deja aclarando y ROSA2018 la devuelve a revision', () => {
    let e = revisarHipotesis(estadoDeMuestra(), 'hip-1', 'no_puedo_juzgar', 'No entiendo si habla de PSEN1 o de todo el familiar', 'la persona responsable', T);
    expect(e.hipotesis.find((h) => h.id === 'hip-1')?.estado).toBe('aclarando');
    e = aclararHipotesis(e, 'hip-1', 'Me refiero a PSEN1.', T + 1);
    const h = e.hipotesis.find((x) => x.id === 'hip-1')!;
    expect(h.estado).toBe('en_revision');
    expect(h.revisiones.at(-1)?.accion).toBe('aclarada');
    expect(aclararHipotesis(e, 'hip-1', 'otra', T + 2)).toBe(e);
  });
  it('la revision estructurada de la persona se guarda, y a ciegas se marca', () => {
    const e1 = revisarHipotesis(estadoDeMuestra(), 'hip-1', 'refinar', 'Quita la cifra', 'la persona responsable', T, true, { supuestosCuestionados: 'Que valga en esporadico', literaturaQueFalta: '', problemaExperimental: '' });
    const h = e1.hipotesis.find((x) => x.id === 'hip-1')!;
    expect(h.revisionesHumanas).toHaveLength(1);
    expect(h.revisiones.at(-1)?.aCiegas).toBe(true);
    const e2 = revisarHipotesis(estadoDeMuestra(), 'hip-1', 'refinar', 'x', 'la persona responsable', T, false, { supuestosCuestionados: ' ', literaturaQueFalta: '', problemaExperimental: '' });
    expect(e2.hipotesis.find((x) => x.id === 'hip-1')!.revisionesHumanas).toHaveLength(0);
  });
  it('reabrir quita la entrada del modelo de mundo', () => {
    let e = revisarHipotesis(estadoDeMuestra(), 'hip-1', 'aceptar', '', 'la persona responsable', T);
    e = revisarHipotesis(e, 'hip-1', 'reabrir', 'Nueva evidencia', 'la persona responsable', T + 1);
    expect(e.hechos.some((h) => h.id === 'he-hip-1')).toBe(false);
    expect(e.hipotesis.find((x) => x.id === 'hip-1')!.estado).toBe('en_revision');
  });
  it('replicar arranca las trayectorias, cobra coste y no se relanza en curso', () => {
    const e1 = replicarHipotesis(estadoDeMuestra(), 'hip-1', 5, T);
    const h = e1.hipotesis.find((x) => x.id === 'hip-1')!;
    expect(h.replicacion).toMatchObject({ total: 5, hechas: 0, estado: 'en_curso' });
    expect(h.coste.analisis).toBe(6);
    expect(replicarHipotesis(e1, 'hip-1', 5, T)).toBe(e1);
    const e0 = estadoDeMuestra();
    expect(replicarHipotesis(e0, 'hip-1', 1, T)).toBe(e0);
  });
});

describe('hipotesis humana', () => {
  it('exige titulo, enunciado y biomarcador o cohorte', () => {
    const e0 = estadoDeMuestra();
    const r = proponerHipotesis(e0, 'inv-1', { titulo: 'x', enunciado: 'y', mecanismo: '', biomarcador: '', cohorte: '', diseno: '', cluster: '' }, 'la persona responsable', T);
    expect(r.id).toBeNull();
  });
  it('entra al torneo con Elo inicial, marcada como humana, con evento', () => {
    const r = proponerHipotesis(estadoDeMuestra(), 'inv-1', { titulo: 'La funcion renal sesga p-tau217', enunciado: 'En cohortes con mas diabetes los umbrales se desplazan', mecanismo: '', biomarcador: 'p-tau217 y creatinina', cohorte: 'FLENI', diseno: 'ajustar por filtrado', cluster: '' }, 'la persona responsable', T);
    const h = r.estado.hipotesis.find((x) => x.id === r.id)!;
    expect(h.origen).toBe('humana');
    expect(h.elo).toBe(1500);
    expect(h.estado).toBe('propuesta');
    expect(h.iteracion).toBe(14);
    expect(h.cluster).toBe('Sin cluster');
    expect(r.estado.eventos.at(-1)?.tipo).toBe('hipotesis_nueva');
  });
});

describe('comentarios', () => {
  const ancla = { cita: 'anticipa varios anos', campo: 'enunciado' as const };
  it('se acumulan, se quitan y se envian agrupados', () => {
    let e = anadirComentario(estadoDeMuestra(), 'hip-1', ancla, 'Sin cifra', T);
    e = anadirComentario(e, 'hip-1', { cita: 'PSEN1', campo: 'enunciado' }, 'Y PSEN2?', T);
    expect(e.comentarios.filter((c) => c.estado === 'pendiente')).toHaveLength(2);
    e = quitarComentario(e, e.comentarios[1]!.id);
    e = enviarComentarios(e, 'hip-1', 'Dos cosas:', 'la persona responsable', T + 1);
    const h = e.hipotesis.find((x) => x.id === 'hip-1')!;
    expect(h.estado).toBe('en_revision');
    expect(h.procedencia.mensajes.at(-1)?.texto).toBe('Dos cosas:\nSobre «anticipa varios anos»: Sin cifra');
  });
});

describe('meta-revision y modelo de mundo', () => {
  it('inyectar una debilidad la convierte en criterio una sola vez', () => {
    const e1 = inyectarDebilidad(estadoDeMuestra(), 'cor-3', 'deb-1');
    expect(e1.criteriosRevision.at(-1)).toMatch(/barrera hematoencefálica/);
    expect(inyectarDebilidad(e1, 'cor-3', 'deb-1')).toBe(e1);
    // deb-3 ya estaba inyectada en la muestra.
    const e0 = estadoDeMuestra();
    expect(inyectarDebilidad(e0, 'cor-3', 'deb-3')).toBe(e0);
  });
  it('preguntar al modelo de mundo responde solo con lo que hay, separando sabido, abierto y descartado', () => {
    const e = estadoDeMuestra();
    const r = preguntarAlModeloDeMundo(e.hechos, 'inv-1', 'que se sabe del cociente p-tau217/Abeta42');
    expect(r.respuesta).toMatch(/^Se sabe: /);
    expect(r.respuesta).toContain('Cohorte clínica, 2025, pág. 7');
    expect(r.respuesta).toContain('Se descartó:');
    expect(r.nodos.length).toBeGreaterThan(0);
    expect(preguntarAlModeloDeMundo(e.hechos, 'inv-1', 'unicornios').nodos).toEqual([]);
    expect(preguntarAlModeloDeMundo(e.hechos, 'inv-1', 'a b').respuesta).toMatch(/palabra del dominio/);
  });
  it('el asistente general consulta todas las investigaciones y los hilos antiguos conservan su ámbito', () => {
    const e = estadoDeMuestra();
    const hechos = [
      { ...e.hechos[0]!, id: 'he-a', investigacionId: 'inv-a', enunciado: 'Evidencia de MAPT en la investigación A' },
      { ...e.hechos[0]!, id: 'he-b', investigacionId: 'inv-b', enunciado: 'Evidencia de MAPT en la investigación B' },
    ];
    expect(preguntarAlModeloDeMundo(hechos, 'global', 'MAPT').nodos.map(h => h.id)).toEqual(['he-a', 'he-b']);
    expect(preguntarAlModeloDeMundo(hechos, 'inv-b', 'MAPT').nodos.map(h => h.id)).toEqual(['he-b']);
    expect(preguntarAlModeloDeMundo(hechos, 'inexistente', 'MAPT').nodos).toEqual([]);
  });
});

describe('investigaciones y datos', () => {
  it('crear exige titulo, objetivo y condicion de parada, y puede heredar el modelo de mundo', () => {
    const e0 = estadoDeMuestra();
    expect(crearInvestigacion(e0, { titulo: 'x', objetivo: '', relevancia: '', limites: [], condicionParada: 'y', revisores: [] }, T).id).toBeNull();
    const r = crearInvestigacion(e0, { titulo: 'T', objetivo: 'O', relevancia: '', limites: ['a', ' '], condicionParada: 'P', revisores: ['la persona responsable'], heredarModeloDe: 'inv-1' }, T);
    const heredados = r.estado.hechos.filter((h) => h.investigacionId === r.id);
    expect(heredados).toHaveLength(e0.hechos.length);
    expect(r.estado.investigaciones.find((i) => i.id === r.id)!.limites).toEqual(['a']);
  });
  it('bifurcar hereda el modelo de mundo con ids propios', () => {
    const e0 = estadoDeMuestra();
    const r = bifurcarInvestigacion(e0, 'inv-1', 'Perseguir hip-1', T);
    expect(r.estado.investigaciones.find((i) => i.id === r.id)!.ramaDe).toBe('inv-1');
    const rama = r.estado.investigaciones.find((i) => i.id === r.id)!;
    // Lo que se escribe al bifurcar es el nombre de la rama, para distinguirla de la original.
    expect(rama.titulo === `${r.estado.investigaciones[0]!.titulo} (rama)` || !rama.titulo.endsWith('(rama)')).toBe(true);
    expect(new Set(r.estado.hechos.map((h) => h.id)).size).toBe(r.estado.hechos.length);
  });
  it('un dataset no se aprueba con columnas sin diccionario o centinelas', () => {
    const e0 = estadoDeMuestra();
    expect(decidirDataset(e0, 'inv-1', 'ds-1', 'aprobado')).toBe(e0);
    const limpio = { ...e0, investigaciones: e0.investigaciones.map((i) => ({ ...i, datasets: i.datasets.map((d) => ({ ...d, columnasSinDiccionario: 0, valoresCentinela: 0, nombresDuplicados: 0 })) })) };
    expect(decidirDataset(limpio, 'inv-1', 'ds-1', 'aprobado').investigaciones[0]!.datasets[0]!.estado).toBe('aprobado');
    expect(decidirDataset(e0, 'inv-1', 'ds-1', 'rechazado').investigaciones[0]!.datasets[0]!.estado).toBe('rechazado');
  });
});

describe('casos', () => {
  it('no guarda una respuesta esperada vacia', () => {
    const e0 = estadoDeMuestra();
    expect(editarRespuestaCaso(e0, 'tabla-001', '   ')).toBe(e0);
    expect(editarRespuestaCaso(e0, 'tabla-001', '2025.').casos.find((c) => c.clave === 'tabla-001')?.respuestaEsperada).toBe('2025.');
  });
});

describe('protocolo real y enmiendas fechadas', () => {
  const conExperimento = () => {
    const e = estadoDeMuestra();
    const h = e.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    return { e, id: h.id };
  };
  it('no enmienda antes de prerregistrar ni sin motivo, y guarda antes y despues', () => {
    const { e, id } = conExperimento();
    expect(enmendarExperimento(e, id, 'confirma', 'nuevo', 'motivo', 'persona', T)).toBe(e);
    const asignado = asignarExperimento(e, id, 'Lab X', T);
    expect(enmendarExperimento(asignado, id, 'confirma', 'nuevo', '', 'persona', T)).toBe(asignado);
    const conEnmienda = enmendarExperimento(asignado, id, 'ensayo', 'Tiempo hasta alteracion, con efecto minimo del 20 %', 'efecto minimo explicito', 'persona', T + 1);
    const x = conEnmienda.hipotesis.find((h) => h.id === id)!.experimento!;
    expect(x.ensayo).toContain('20 %');
    expect(x.enmiendas).toHaveLength(1);
    expect(x.enmiendas?.[0]?.antes).toContain('Tiempo hasta la primera alteración');
    expect(x.enmiendas?.[0]?.quien).toBe('persona');
  });
  it('el protocolo real exige asignacion y texto; con resultado ya evaluado lo borra para reevaluar', () => {
    const { e, id } = conExperimento();
    expect(registrarProtocoloReal(e, id, { texto: 'hecho', desviaciones: '', identidadMuestras: '' }, 'persona', T)).toBe(e);
    const asignado = asignarExperimento(e, id, 'Lab X', T);
    expect(registrarProtocoloReal(asignado, id, { texto: '  ', desviaciones: '', identidadMuestras: '' }, 'persona', T)).toBe(asignado);
    const conReal = registrarProtocoloReal(asignado, id, { texto: 'Se midio GFAP', desviaciones: 'n = 12 en vez de 20', identidadMuestras: 'lote 7' }, 'persona', T + 5);
    const x = conReal.hipotesis.find((h) => h.id === id)!.experimento!;
    expect(x.protocoloReal?.desviaciones).toBe('n = 12 en vez de 20');
    expect(conReal.hipotesis.find((h) => h.id === id)!.procedencia.registro.at(-1)).toContain('con desviaciones');
    const evaluado = { ...conReal, hipotesis: conReal.hipotesis.map((h) => (h.id === id ? { ...h, experimento: { ...h.experimento!, ficheroDatos: 'd.csv', resultado: { veredicto: 'confirma', resultado: '', motivo: '', limitaciones: '', cifras: [], exploratorio: '', fecha: T, fichero: 'd.csv' } as never } } : h)) };
    expect(enmendarExperimento(evaluado, id, 'refuta', 'otra', 'm', 'persona', T)).toBe(evaluado);
    const reevalua = registrarProtocoloReal(evaluado, id, { texto: 'corregido', desviaciones: '', identidadMuestras: '' }, 'persona', T + 9);
    expect(reevalua.hipotesis.find((h) => h.id === id)!.experimento!.resultado).toBeNull();
  });
});

describe('gobierno de areas', () => {
  const conArea = () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const area = { id: 'area-1', titulo: 'Neuroinflamacion', familiaMecanismo: 'inmune', relevancia: '', valorIntervencion: '', incertidumbre: '', comprobabilidad: '', coste: '', demora: '', dependeDe: '', estado: 'propuesta' as const, condicionReapertura: '' };
    const conMision = { ...e, investigaciones: e.investigaciones.map((i) => (i.id === inv.id ? { ...i, mision: { ...(i.mision ?? ({} as never)), areas: [area] } } : i)) } as typeof e;
    return { e: conMision, invId: inv.id, corrida: e.corridas.find((c) => c.investigacionId === inv.id)! };
  };
  it('pausar exige condicion; reabrir la limpia; el historial guarda cada paso', () => {
    const { e, invId } = conArea();
    expect(cambiarEstadoArea(e, invId, 'area-1', 'pausada', 'persona', T)).toBe(e);
    const pausada = cambiarEstadoArea(e, invId, 'area-1', 'pausada', 'persona', T, 'dataset con TREM2');
    const a1 = pausada.investigaciones.find((i) => i.id === invId)!.mision!.areas![0]!;
    expect(a1.estado).toBe('pausada');
    expect(a1.condicionReapertura).toBe('dataset con TREM2');
    expect(a1.historial).toHaveLength(1);
    const reabierta = cambiarEstadoArea(pausada, invId, 'area-1', 'elegida', 'persona', T + 1, '', undefined, 'reabierta');
    const a2 = reabierta.investigaciones.find((i) => i.id === invId)!.mision!.areas![0]!;
    expect(a2.estado).toBe('elegida');
    expect(a2.condicionReapertura).toBe('');
    expect(a2.historial?.[1]?.motivo).toBe('reabierta');
    expect(cambiarEstadoArea(reabierta, invId, 'area-1', 'elegida', 'persona', T + 2)).toBe(reabierta);
  });
  it('asignar a una campana solo de la misma investigacion; cadena vacia desasigna', () => {
    const { e, invId, corrida } = conArea();
    expect(cambiarEstadoArea(e, invId, 'area-1', null, 'persona', T, '', 'c-ajena')).toBe(e);
    const asignada = cambiarEstadoArea(e, invId, 'area-1', null, 'persona', T, '', corrida.id);
    expect(asignada.investigaciones.find((i) => i.id === invId)!.mision!.areas![0]!.corridaId).toBe(corrida.id);
    const suelta = cambiarEstadoArea(asignada, invId, 'area-1', null, 'persona', T + 1, '', '');
    expect(suelta.investigaciones.find((i) => i.id === invId)!.mision!.areas![0]!.corridaId).toBeNull();
  });
});

describe('borrarCriterio', () => {
  it('borra por texto y no por posicion cuando la lista cambio', () => {
    const base = { ...estadoDeMuestra(), criteriosRevision: ['a', 'b', 'c'] };
    // La persona veia 'b' en la posicion 1, pero el servidor ya quito 'a'.
    const servidor = { ...base, criteriosRevision: ['b', 'c'] };
    expect(borrarCriterio(servidor, 1, 'b').criteriosRevision).toEqual(['c']);
    expect(borrarCriterio(servidor, 1).criteriosRevision).toEqual(['b']);
    expect(borrarCriterio(servidor, 5, 'zzz')).toBe(servidor);
  });
});

describe('grafo de evidencia: fusión, herencia de enlaces y puerta al promover', () => {
  it('fusionar hereda afirmaciones y fuentes sin duplicar y descarta la absorbida con fusionadaEn', () => {
    const e0 = estadoDeMuestra();
    const vivas = e0.hipotesis.filter((h) => h.estado !== 'descartada' && h.investigacionId === e0.hipotesis[0]!.investigacionId);
    const [g, a] = [vivas[0]!, vivas[1]!];
    const e1 = fusionarHipotesis(e0, g.id, a.id, 'equivalentes según el torneo', 'Allegri', T);
    const g1 = e1.hipotesis.find((h) => h.id === g.id)!;
    const a1 = e1.hipotesis.find((h) => h.id === a.id)!;
    const clave = (x: { afirmacionId?: string; texto: string; cita: string }) => x.afirmacionId ?? `${x.texto}|${x.cita}`;
    expect(new Set(g1.afirmaciones.map(clave)).size).toBe(g1.afirmaciones.length);
    expect(g1.afirmaciones.length).toBeGreaterThanOrEqual(g.afirmaciones.length);
    expect(new Set(g1.procedencia.fuentes.map((f) => f.id)).size).toBe(g1.procedencia.fuentes.length);
    expect(g1.absorbe).toEqual([a.id]);
    expect(a1.estado).toBe('descartada');
    expect(a1.fusionadaEn).toBe(g.id);
    expect(e1.eventos.some((ev) => ev.tipo === 'hipotesis_decidida' && ev.texto.startsWith('Fusión'))).toBe(true);
    // Repetir no hace nada; fusionar consigo misma tampoco.
    expect(fusionarHipotesis(e1, g.id, a.id, 'otra vez', 'Allegri', T)).toBe(e1);
    expect(fusionarHipotesis(e1, g.id, g.id, 'consigo misma', 'Allegri', T)).toBe(e1);
  });
  it('rechazar la fusión retira la propuesta y lo anota', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis[0]!;
    const e = { ...e0, hipotesis: e0.hipotesis.map((x) => (x.id === h.id ? { ...x, fusionPropuesta: { con: 'hip-otra', relacion: 'equivalentes' as const, motivo: 'm', propuestaEn: T } } : x)) };
    const e1 = rechazarFusion(e, h.id, 'Allegri', T);
    const h1 = e1.hipotesis.find((x) => x.id === h.id)!;
    expect(h1.fusionPropuesta).toBeNull();
    expect(h1.procedencia.registro.at(-1)).toContain('rechazada por Allegri');
    expect(rechazarFusion(e1, h.id, 'Allegri', T)).toBe(e1);
  });
  it('copiarHechos remapea los enlaces entre hechos hacia las copias', () => {
    const e0 = estadoDeMuestra();
    const inv = e0.hechos[0]!.investigacionId;
    const viejo = { ...e0.hechos[0]!, id: 'he-viejo', investigacionId: inv, sustituidoPor: 'he-nuevo' };
    const nuevo = { ...e0.hechos[0]!, id: 'he-nuevo', investigacionId: inv, sustituyeA: ['he-viejo', 'he-de-otra'] };
    const copias = copiarHechos([viejo, nuevo], inv, 'inv-rama');
    expect(copias.map((h) => h.id)).toEqual(['he-viejo-inv-rama', 'he-nuevo-inv-rama']);
    expect(copias[1]!.sustituyeA).toEqual(['he-viejo-inv-rama', 'he-de-otra']);
    expect(copias[0]!.sustituidoPor).toBe('he-nuevo-inv-rama');
    expect(nuevo.sustituyeA).toEqual(['he-viejo', 'he-de-otra']);
  });
  it('promover no pasa si la evaluación empeora, pero sí sin evaluación o si iguala', () => {
    const e0 = estadoDeMuestra();
    const base = { id: 'apr-x', investigacionId: null, nivel: 2 as const, tipo: 'criterio' as const, descripcion: 'Criterio de prueba', origen: 'debilidad:x', quien: 'Rosa', fecha: T, resueltoEn: null, resueltoPor: null };
    const peor = { ...base, id: 'apr-peor', estado: 'evaluado' as const, evaluacion: { conjunto: 'reservado', casos: 6, antes: 0.8, despues: 0.5, nota: '' } };
    const igual = { ...base, id: 'apr-igual', estado: 'evaluado' as const, evaluacion: { conjunto: 'reservado', casos: 6, antes: 0.8, despues: 0.8, nota: '' } };
    const sin = { ...base, id: 'apr-sin', estado: 'propuesto' as const, evaluacion: null };
    const e = { ...e0, aprendizaje: [peor, igual, sin] };
    expect(empeoraAlEvaluar(peor)).toBe(true);
    const e1 = promoverAprendizaje(e, 'apr-peor', 'Allegri', T);
    expect(e1.aprendizaje!.find((c) => c.id === 'apr-peor')!.estado).toBe('evaluado');
    expect(e1.eventos.some((ev) => ev.tipo === 'incidencia' && ev.texto.includes('empeora'))).toBe(true);
    expect(promoverAprendizaje(e, 'apr-igual', 'Allegri', T).aprendizaje!.find((c) => c.id === 'apr-igual')!.estado).toBe('promovido');
    expect(promoverAprendizaje(e, 'apr-sin', 'Allegri', T).aprendizaje!.find((c) => c.id === 'apr-sin')!.estado).toBe('promovido');
  });
});

describe('cuestiones persistentes y pendientes de revisar', () => {
  it('abrir deduplica por texto normalizado, resolver exige estar abierta, descartar exige motivo, reabrir vuelve a abierta', () => {
    const e0 = estadoDeMuestra();
    const inv = e0.investigaciones[0]!.id;
    const e1 = abrirCuestion(e0, inv, '¿La plataforma Simoa mide GFAP igual que Lumipulse?', 'Un estudio cabeza a cabeza', 'Allegri', T);
    expect(e1.cuestiones).toHaveLength(1);
    const e2 = abrirCuestion(e1, inv, 'La plataforma SIMOA mide GFAP igual que Lumipulse', '', 'Allegri', T + 1);
    expect(e2.cuestiones).toHaveLength(1);
    expect(e2.cuestiones![0]!.veces).toBe(2);
    expect(abrirCuestion(e2, inv, '   ', '', 'Allegri', T)).toBe(e2);
    const id = e2.cuestiones![0]!.id;
    expect(descartarCuestion(e2, id, '', 'Allegri', T)).toBe(e2);
    const e3 = resolverCuestion(e2, id, 'Lo respondió el estudio X', 'Allegri', T + 2);
    expect(e3.cuestiones![0]!.estado).toBe('resuelta');
    expect(e3.cuestiones![0]!.resolucion).toEqual({ por: 'Allegri', motivo: 'Lo respondió el estudio X' });
    expect(resolverCuestion(e3, id, 'otra vez', 'Allegri', T)).toBe(e3);
    const e4 = reabrirCuestion(e3, id, 'no era concluyente', 'Allegri', T + 3);
    expect(e4.cuestiones![0]!.estado).toBe('abierta');
    expect(e4.cuestiones![0]!.historial.map((m) => m.a)).toEqual(['abierta', 'resuelta', 'abierta']);
  });
  it('volver a una iteración con "mundo" poda las cuestiones que ROSA2018 abrió después del punto y respeta las de la persona', () => {
    const e0 = estadoDeMuestra();
    const inv = e0.corridas.find((c) => c.id === 'cor-3')!.investigacionId;
    const base = { investigacionId: inv, estado: 'abierta' as const, origen: { tipo: 'killer' as const, id: null }, queLaResolveria: '', hipotesisIds: [], hechoIds: [], prioridad: 3, actualizadaEn: 0, resueltaEn: null, resolucion: null, veces: 1 };
    const rosa = { ...base, id: 'cu-rosa', texto: 'De ROSA2018, tarde', creadaEn: AHORA_MUESTRA - 60_000, historial: [{ fecha: AHORA_MUESTRA - 60_000, de: null, a: 'abierta', quien: 'Rosa', motivo: 'x' }] };
    const persona = { ...base, id: 'cu-persona', texto: 'De la persona, tarde', creadaEn: AHORA_MUESTRA - 60_000, historial: [{ fecha: AHORA_MUESTRA - 60_000, de: null, a: 'abierta', quien: 'Allegri', motivo: 'x' }] };
    const e = { ...e0, cuestiones: [rosa, persona] };
    const e1 = volverAIteracion(e, 'it-13', 'mundo', T);
    expect(e1.cuestiones!.map((c) => c.id)).toEqual(['cu-persona']);
  });
  it('atender un pendiente de revisar lo quita, anota el registro y levanta el bloqueo', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis[0]!;
    const e = { ...e0, hipotesis: e0.hipotesis.map((x) => (x.id === h.id ? { ...x, pendienteRevision: { causa: 'hecho_sustituido' as const, detalle: 'El hecho X fue sustituido', origenId: 'he-x', desde: T }, bloqueos: ['dependencia_pendiente' as const] } : x)) };
    const e1 = atenderPendiente(e, 'hipotesis', h.id, 'Allegri', 'revisada', T);
    const h1 = e1.hipotesis.find((x) => x.id === h.id)!;
    expect(h1.pendienteRevision).toBeNull();
    expect(h1.bloqueos).toEqual([]);
    expect(h1.procedencia.registro.at(-1)).toContain('atendida por Allegri');
    expect(atenderPendiente(e1, 'hipotesis', h.id, 'Allegri', 'otra vez', T)).toBe(e1);
    const hecho = e0.hechos[0]!;
    const e2 = { ...e0, hechos: e0.hechos.map((x) => (x.id === hecho.id ? { ...x, pendienteRevision: { causa: 'fuente_retractada' as const, detalle: 'd', origenId: 'doi', desde: T } } : x)) };
    const e3 = atenderPendiente(e2, 'hecho', hecho.id, 'Allegri', 'ok', T);
    const hecho3 = e3.hechos.find((x) => x.id === hecho.id)!;
    expect(hecho3.pendienteRevision).toBeNull();
    expect(hecho3.historial.at(-1)!.motivo).toContain('atendida');
  });
});

describe('contrato del experimento (espejo de rosa/experimento.py)', () => {
  // El mismo experimento que se pasó a rosa/experimento.py para obtener las líneas y el hash esperados.
  const CONTRATO = {
    ensayo: 'Tiempo hasta la primera alteración',
    confirma: 'GFAP sube antes',
    refuta: 'NfL sube antes',
    controles: 'controles sanos',
    lecturas: [
      { nombre: 'GFAP en plasma', tipo: 'biomarcador', queConfirma: 'aumento de al menos 20 %', queRefuta: 'cambio menor del 5 %', control: 'sin tratar', unidad: 'pg/mL' },
      { nombre: 'Fosforilación de la diana', tipo: 'Compromiso de diana', queConfirma: 'caída del 50 %', queRefuta: 'sin cambio', control: 'vehículo', unidad: '' },
    ],
    sistema: { tipo: 'ipsc', quePrueba: 'microglía derivada', queNoRepresenta: '' },
    propositoBiomarcador: 'Monitorización',
    nivelDesenlace: 'molecular',
    puenteAlBeneficio: 'si GFAP baja, menos gliosis',
  };
  const HASH_CONTRATO = 'f7eef51d30d222fc06e06d4f97b03ad886019b373976551478f59ceb982bd018';
  const LINEAS_IPSC = [
    'Sistema experimental: células iPSC (Neuronas o glía derivadas de células madre pluripotentes inducidas (iPSC) humanas, reprogramadas desde células de una persona.)',
  ];
  const NO_REPRESENTA_IPSC = '  No representa: no declarado; límite general de este sistema: no reproduce la edad (su madurez epigenética es fetal) ni el entorno del tejido; hay variabilidad entre líneas y clones y el fondo genético de cada donante pesa';

  it('sha256Hex coincide con hashlib, también con texto no ASCII', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // Sin lecturas la lista canónica es "[]": el hash que da rosa/experimento.py hash_lecturas({}).
    expect(hashLecturas({})).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
    expect(hashLecturas(null)).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  });
  it('el hash de las lecturas es el del servidor y no depende del orden ni de claves de más', () => {
    expect(hashLecturas(CONTRATO)).toBe(HASH_CONTRATO);
    const alReves = { ...CONTRATO, lecturas: [...CONTRATO.lecturas].reverse().map((l) => ({ ...l, id: 'marca de la interfaz', nombre: `  ${l.nombre}  ` })) };
    expect(hashLecturas(alReves)).toBe(HASH_CONTRATO);
    expect(lecturasParaHash(CONTRATO).map((l) => l.tipo)).toEqual(['biomarcador', 'compromiso_diana']);
    // Un texto distinto cambia el hash.
    expect(hashLecturas({ ...CONTRATO, lecturas: [{ ...CONTRATO.lecturas[0]!, queConfirma: 'aumento de al menos 25 %' }, CONTRATO.lecturas[1]!] })).not.toBe(HASH_CONTRATO);
  });
  it('bloquePrerregistro reproduce el texto del servidor línea a línea', () => {
    expect(bloquePrerregistro(CONTRATO)).toEqual([
      '',
      '## Lecturas fijadas de antemano (contrato del experimento)',
      '- GFAP en plasma [biomarcador, pg/mL]: confirma si aumento de al menos 20 %; refuta si cambio menor del 5 %; control: sin tratar',
      '- Fosforilación de la diana [compromiso de diana]: confirma si caída del 50 %; refuta si sin cambio; control: vehículo',
      `Hash SHA-256 de las lecturas en orden canónico: ${HASH_CONTRATO}`,
      ...LINEAS_IPSC,
      '  Prueba: microglía derivada',
      NO_REPRESENTA_IPSC,
      'Propósito del biomarcador (BEST): monitorización. Se mide de forma repetida para seguir el estado de la enfermedad o la exposición a una intervención o a un agente (por ejemplo, NfL en plasma cada seis meses).',
      'Nivel del desenlace: molecular. Una molécula o su cantidad o estado: proteína, ARN, metabolito, fosforilación (por ejemplo, GFAP en plasma, p-tau181).',
      'Puente al beneficio: si GFAP baja, menos gliosis',
    ]);
  });
  it('un registro antiguo da una lectura de tipo biomarcador derivada del ensayo, con el hash del servidor', () => {
    const antiguo = { ensayo: 'Tiempo hasta la primera alteración', confirma: 'GFAP sube antes', refuta: 'NfL sube antes', controles: 'controles sanos' };
    expect(bloquePrerregistro(antiguo)).toEqual([
      '',
      '## Lecturas fijadas de antemano (contrato del experimento)',
      '- Tiempo hasta la primera alteración [biomarcador]: confirma si GFAP sube antes; refuta si NfL sube antes; control: controles sanos',
      'Hash SHA-256 de las lecturas en orden canónico: 466991306bf9dea00ab61a8002008ed26e5cfaeb42f4408f375cd5288c7910d5',
      'Sistema experimental: no declarado',
      'Propósito del biomarcador (BEST): no declarado',
      'Nivel del desenlace: no declarado',
      'Puente al beneficio: no declarado; el resultado, por sí solo, no habla de beneficio para una persona',
    ]);
  });
  it('un sistema escrito como texto se toma como su tipo sin inventar lo que prueba', () => {
    const lineas = bloquePrerregistro({ lecturas: [{ nombre: 'A', tipo: 'viabilidad' }], sistema: 'iPSC' });
    expect(lineas[2]).toBe('- A [viabilidad]: confirma si sin criterio; refuta si sin criterio; control: sin control declarado');
    expect(lineas[3]).toBe('Hash SHA-256 de las lecturas en orden canónico: 471bc0992a5adf3a3d70d823b70e993b78f299c1796bde74a5d3edca9f8b35d6');
    expect(lineas.slice(4, 7)).toEqual([...LINEAS_IPSC, '  Prueba: no declarado', NO_REPRESENTA_IPSC]);
  });
  it('sin nada que congelar no hay bloque, y la basura no rompe', () => {
    expect(bloquePrerregistro({ protocolo: 'x', costeEstimado: 'c' })).toEqual([]);
    expect(bloquePrerregistro(null)).toEqual([]);
    expect(bloquePrerregistro(undefined)).toEqual([]);
    expect(bloquePrerregistro('texto suelto')).toEqual([]);
    expect(bloquePrerregistro([1, 2])).toEqual([]);
    expect(bloquePrerregistro({ lecturas: [null, 7, 'x', { unidad: '%' }], sistema: 42, propositoBiomarcador: 'adivinar' })).toEqual([]);
  });
  it('normalizarContrato deja vacío lo que está fuera del vocabulario y acepta la etiqueta legible y snake_case', () => {
    const c = normalizarContrato({ lecturas: 'no es lista', sistema: 42, propositoBiomarcador: 'adivinar', nivelDesenlace: 'Fisiológico o de imagen', puenteAlBeneficio: ['a', 'b'] });
    expect(c.lecturas).toEqual([]);
    expect(c.sistema).toBeNull();
    expect(c.propositoBiomarcador).toBeNull();
    expect(c.nivelDesenlace).toBe('fisiologico_imagen');
    expect(c.puenteAlBeneficio).toBe('a b');
    expect(normalizarContrato({ lecturas: [null, 'x', { unidad: '%' }, { nombre: 'B', que_confirma: 'sube', que_refuta: 'baja' }] }).lecturas).toEqual([{ nombre: 'B', tipo: '', queConfirma: 'sube', queRefuta: 'baja', control: '', unidad: '' }]);
    expect(normalizarContrato({ sistema: { tipo: 'Datos públicos ya existentes' } }).sistema).toEqual({ tipo: 'datos_publicos_existentes', quePrueba: '', queNoRepresenta: '' });
  });
  it('el prerregistro de la muestra lleva el contrato derivado del ensayo antiguo y congela su hash', () => {
    const e = estadoDeMuestra();
    const h = e.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    const asignado = asignarExperimento(e, h.id, 'Lab X', T);
    const x = asignado.hipotesis.find((y) => y.id === h.id)!.experimento!;
    // Hash de rosa/experimento.py para el ensayo de la muestra, sin confirma ni refuta.
    expect(x.hashLecturas).toBe('0eac5dca25b361bf676fe4595154e442a4f2faf71b528dfc53d31289cc93fe3b');
    const arte = asignado.artefactos.find((a) => a.id === x.prerregistroArtefactoId)!;
    const texto = arte.versiones.at(-1)!.contenido;
    expect(texto).toContain('## Lecturas fijadas de antemano (contrato del experimento)');
    expect(texto).toContain(`Hash SHA-256 de las lecturas en orden canónico: ${x.hashLecturas}`);
    expect(texto.indexOf('## Ensayo y criterios fijados de antemano')).toBeLessThan(texto.indexOf('## Lecturas fijadas de antemano'));
    expect(texto.indexOf('## Lecturas fijadas de antemano')).toBeLessThan(texto.indexOf('## Coste estimado'));
  });
  it('un experimento solo con lecturas completas se puede prerregistrar; con una lectura a medias, no', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    const lectura = { nombre: 'GFAP', tipo: 'biomarcador' as const, queConfirma: 'sube', queRefuta: 'no sube', control: '', unidad: '' };
    const soloLecturas = { ...e0, hipotesis: e0.hipotesis.map((x) => (x.id === h.id ? { ...x, experimento: { ...x.experimento!, ensayo: '', confirma: '', refuta: '', lecturas: [lectura] } } : x)) };
    expect(asignarExperimento(soloLecturas, h.id, 'Lab X', T).hipotesis.find((y) => y.id === h.id)!.experimento!.prerregistradoEn).toBe(T);
    const aMedias = { ...soloLecturas, hipotesis: soloLecturas.hipotesis.map((x) => (x.id === h.id ? { ...x, experimento: { ...x.experimento!, lecturas: [{ ...lectura, queRefuta: '' }] } } : x)) };
    const rechazado = asignarExperimento(aMedias, h.id, 'Lab X', T);
    expect(rechazado.hipotesis.find((y) => y.id === h.id)!.experimento!.prerregistradoEn).toBeUndefined();
    expect(rechazado.eventos.at(-1)?.tipo).toBe('incidencia');
  });
});

describe('enmendarLectura', () => {
  const conLecturas = () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    const lecturas = [{ nombre: 'GFAP en plasma', tipo: 'biomarcador' as const, queConfirma: 'sube 20 %', queRefuta: 'no sube', control: 'sin tratar', unidad: 'pg/mL' }];
    const e = { ...e0, hipotesis: e0.hipotesis.map((x) => (x.id === h.id ? { ...x, experimento: { ...x.experimento!, lecturas } } : x)) };
    return { e, id: h.id };
  };
  it('no enmienda sin prerregistro, sin lecturas, fuera de rango, sin motivo, sin cambio, con campo ajeno ni con resultado', () => {
    const { e, id } = conLecturas();
    expect(enmendarLectura(e, id, 0, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(e);
    const asignado = asignarExperimento(e, id, 'Lab X', T);
    expect(enmendarLectura(asignado, id, 1, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, -1, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, 0.5, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, Number.NaN, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, 0, 'queConfirma', 'sube 30 %', '   ', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, 0, 'queConfirma', '   ', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, 0, 'queConfirma', 'sube 20 %', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, id, 0, 'nombre' as never, 'otro', 'm', 'p', T)).toBe(asignado);
    expect(enmendarLectura(asignado, 'no-existe', 0, 'queConfirma', 'x', 'm', 'p', T)).toBe(asignado);
    const sinLecturas = asignarExperimento(estadoDeMuestra(), id, 'Lab X', T);
    expect(enmendarLectura(sinLecturas, id, 0, 'queConfirma', 'x', 'm', 'p', T)).toBe(sinLecturas);
    const evaluado = { ...asignado, hipotesis: asignado.hipotesis.map((h) => (h.id === id ? { ...h, experimento: { ...h.experimento!, resultado: { veredicto: 'confirma', resultado: '', motivo: '', limitaciones: '', cifras: [], exploratorio: '', fecha: T, fichero: null } as never } } : h)) };
    expect(enmendarLectura(evaluado, id, 0, 'queConfirma', 'sube 30 %', 'm', 'p', T)).toBe(evaluado);
  });
  it('guarda antes y después con la lectura y el campo en la forma del servidor, recalcula el hash vigente y conserva el congelado en hashAntes (misma regla que rosa/estado/acciones.py enmendar_lectura)', () => {
    const { e, id } = conLecturas();
    const asignado = asignarExperimento(e, id, 'Lab X', T);
    const hash = asignado.hipotesis.find((y) => y.id === id)!.experimento!.hashLecturas;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const e1 = enmendarLectura(asignado, id, 0, 'queConfirma', 'sube al menos 30 %', 'potencia recalculada', 'Allegri', T + 1);
    const h1 = e1.hipotesis.find((y) => y.id === id)!;
    const x = h1.experimento!;
    expect(x.lecturas![0]!.queConfirma).toBe('sube al menos 30 %');
    expect(x.lecturas![0]!.queRefuta).toBe('no sube');
    expect(x.enmiendas).toHaveLength(1);
    // Forma del servidor: campo "lecturas[i].campo" y lectura con el nombre.
    expect(x.enmiendas![0]).toMatchObject({ campo: 'lecturas[0].queConfirma', lectura: 'GFAP en plasma', antes: 'sube 20 %', despues: 'sube al menos 30 %', quien: 'Allegri', motivo: 'potencia recalculada', hashAntes: hash });
    // El hash vigente cambia y queda en el experimento y en la enmienda; el congelado sobrevive en hashAntes.
    expect(x.hashLecturas).not.toBe(hash);
    expect(x.hashLecturas).toBe(hashLecturas(x));
    expect(x.enmiendas![0]!.hashDespues).toBe(x.hashLecturas);
    expect(h1.procedencia.registro.at(-1)).toContain('lectura «GFAP en plasma», queConfirma');
    expect(e1.eventos.at(-1)?.texto).toContain('Enmienda 1 del prerregistro (lectura «GFAP en plasma», queConfirma)');
    expect(asignado.hipotesis.find((y) => y.id === id)!.experimento!.lecturas![0]!.queConfirma).toBe('sube 20 %');
    const e2 = enmendarLectura(e1, id, 0, 'unidad', 'ng/mL', 'unidad corregida', 'Allegri', T + 2);
    const x2 = e2.hipotesis.find((y) => y.id === id)!.experimento!;
    expect(x2.enmiendas).toHaveLength(2);
    expect(x2.lecturas![0]!.unidad).toBe('ng/mL');
    // La segunda enmienda parte del vigente, no del congelado: la cadena de hashes se sigue.
    expect(x2.enmiendas![1]!.hashAntes).toBe(x.hashLecturas);
    expect(x2.enmiendas![1]!.hashDespues).toBe(x2.hashLecturas);
    expect(x2.enmiendas![0]!.hashAntes).toBe(hash);
  });
  it('adversario: un texto guardado con espacios de más se compara recortado, como en el servidor, y "antes" queda recortado en la enmienda', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    const lecturas = [{ nombre: 'GFAP', tipo: 'biomarcador' as const, queConfirma: '  sube 20 %  ', queRefuta: 'no sube', control: '', unidad: '' }];
    const e = { ...e0, hipotesis: e0.hipotesis.map((x) => (x.id === h.id ? { ...x, experimento: { ...x.experimento!, lecturas } } : x)) };
    const asignado = asignarExperimento(e, h.id, 'Lab X', T);
    // Mismo texto salvo los espacios: el servidor (`.strip()`) no lo da por cambio; aquí tampoco.
    expect(enmendarLectura(asignado, h.id, 0, 'queConfirma', 'sube 20 %', 'm', 'p', T)).toBe(asignado);
    const e1 = enmendarLectura(asignado, h.id, 0, 'queConfirma', 'sube 30 %', 'm', 'p', T);
    expect(e1.hipotesis.find((y) => y.id === h.id)!.experimento!.enmiendas![0]).toMatchObject({ antes: 'sube 20 %', despues: 'sube 30 %' });
  });
  it('adversario: el hash de un registro antiguo (solo ensayo, confirma y refuta) y de lecturas con valores raros es el de rosa/experimento.py', () => {
    // Vectores calculados con PYTHONPATH=. ./.venv/bin/python (hash_lecturas) el 17 de septiembre de 2026.
    expect(hashLecturas({ ensayo: 'ELISA de GFAP en plasma', confirma: 'GFAP sube 30 %', refuta: 'GFAP no cambia', protocolo: 'p' })).toBe('6fee532d4786932e5a741e7a31cdab976abc8207a290e3a2cf44e7c2f731606d');
    expect(hashLecturas({ lecturas: [{ nombre: ' GFAP ', tipo: 'biomarcador', queConfirma: 'sube', queRefuta: 'baja', control: '', unidad: 'pg/mL' }] })).toBe('2341476cc291956bc4057ce65a9fa45c7c17bc0db2532d3294db98fbd736a07b');
    expect(hashLecturas({ lecturas: [{ nombre: 'ñandú «x»', tipo: 'raro', queConfirma: 'a  b', queRefuta: 'c/d', control: null, unidad: 5 }] })).toBe('3417fd8038ead6f1fbce5973745f3a151dee34c67fedd0a88248f1456f3c1423');
  });
});

describe('investigación nueva con los campos de ROSA2018', () => {
  it('la muestra trae datasetsPrograma vacío y crear o bifurcar arrancan mapa, ruta y cifras en null', () => {
    const e0 = estadoDeMuestra();
    expect(e0.datasetsPrograma).toEqual([]);
    const { estado: e1, id } = crearInvestigacion(e0, { titulo: 'T', objetivo: 'O', relevancia: '', limites: [], condicionParada: 'P', revisores: [] }, T);
    const inv = e1.investigaciones.find((i) => i.id === id)!;
    expect(inv.mapaEnfermedad).toBeNull();
    expect(inv.mapaRuta).toBeNull();
    expect(inv.cifrasAprendizaje).toBeNull();
    const conMapa = { ...e1, investigaciones: e1.investigaciones.map((i) => (i.id === id ? { ...i, mapaRuta: { investigacionId: id!, filas: [], resumen: 'Sin hipótesis vivas en esta investigación: no hay ruta que mapear.' } } : i)) };
    const rama = bifurcarInvestigacion(conMapa, id!, 'rama de prueba', T);
    expect(rama.estado.investigaciones.find((i) => i.id === rama.id)!.mapaRuta).toBeNull();
    expect(rama.estado.investigaciones.find((i) => i.id === id)!.mapaRuta?.filas).toEqual([]);
  });
});

// 17 de septiembre de 2026: idempotencia de la decisión humana (S-23), bandera
// de datos sintéticos del laboratorio (S-18) y hash recalculado también al
// enmendar un campo de texto (M-32), como hace el servidor.
describe('revisarHipotesis es idempotente', () => {
  it('aceptar sobre una aceptada (o descartar sobre una descartada) devuelve el mismo estado: ni segunda revisión ni segundo hecho', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis.find((x) => x.estado === 'propuesta')!;
    const e1 = revisarHipotesis(e0, h.id, 'aceptar', '', 'Allegri', T);
    expect(e1.hipotesis.find((x) => x.id === h.id)!.estado).toBe('aceptada');
    const revisiones = e1.hipotesis.find((x) => x.id === h.id)!.revisiones.length;
    // El segundo clic (o la reaplicación de una pendiente sobre el estado del servidor que ya la trae) no cambia nada.
    expect(revisarHipotesis(e1, h.id, 'aceptar', '', 'Allegri', T + 1)).toBe(e1);
    expect(e1.hipotesis.find((x) => x.id === h.id)!.revisiones.length).toBe(revisiones);
    expect(e1.hechos.filter((x) => x.id === `he-${h.id}`)).toHaveLength(1);
    // Cambiar de decisión sí se aplica (descartar una aceptada exige motivo).
    const e2 = revisarHipotesis(e1, h.id, 'descartar', 'no reproducible', 'Allegri', T + 2);
    expect(e2).not.toBe(e1);
    expect(e2.hipotesis.find((x) => x.id === h.id)!.estado).toBe('descartada');
    expect(revisarHipotesis(e2, h.id, 'descartar', 'otra vez', 'Allegri', T + 3)).toBe(e2);
  });
});

describe('registrarDatosExperimento con la bandera de sintético', () => {
  const conExperimento = () => {
    const e = estadoDeMuestra();
    const h = e.hipotesis.find((x) => x.experimento)!;
    return { e, id: h.id };
  };
  it('guarda datosSinteticos cuando la persona lo marca, lo fuerza si el nombre del fichero lo dice, y borra el resultado anterior para que ROSA2018 reevalúe', () => {
    const { e, id } = conExperimento();
    const real = registrarDatosExperimento(e, id, 'datos_gfap.csv', 'tiempo hasta alteración');
    expect(real.hipotesis.find((x) => x.id === id)!.experimento).toMatchObject({ ficheroDatos: 'datos_gfap.csv', analisisPedido: 'tiempo hasta alteración', estado: 'datos_recibidos', datosSinteticos: false, resultado: null });
    const marcado = registrarDatosExperimento(e, id, 'datos_gfap.csv', '', true);
    expect(marcado.hipotesis.find((x) => x.id === id)!.experimento!.datosSinteticos).toBe(true);
    // El caso real del 11 de septiembre: datos_gfap_nfl_sintetico.csv sin casilla.
    const porNombre = registrarDatosExperimento(e, id, 'datos_gfap_nfl_sintetico.csv', '');
    expect(porNombre.hipotesis.find((x) => x.id === id)!.experimento!.datosSinteticos).toBe(true);
    expect(registrarDatosExperimento(e, id, 'SINTÉTICO-humo.csv', '').hipotesis.find((x) => x.id === id)!.experimento!.datosSinteticos).toBe(true);
    expect(registrarDatosExperimento(e, id, '   ', '', true)).toBe(e);
    // Misma regla que rosa/certeza.py NOMBRE_SINTETICO: delatan "synthetic", "dummy", "fake", "mock", "datos de prueba" y "prueba.csv"; "prueba" suelta y "humo" no.
    for (const nombre of ['synthetic.csv', 'dummy_gfap.csv', 'fake.tsv', 'mock-datos.json', 'datos_de_prueba.csv', 'data prueba.csv', 'gfap_de_prueba.csv', 'prueba.csv', 'prueba_2.csv']) expect(FICHERO_SINTETICO.test(nombre)).toBe(true);
    for (const nombre of ['prueba_cognitiva_MMSE.csv', 'resultados_prueba_ELISA.csv', 'exposicion_humo_tabaco.csv', 'datos_gfap.csv', 'faker.csv']) expect(FICHERO_SINTETICO.test(nombre)).toBe(false);
  });
});

describe('enmendarExperimento recalcula el hash como el servidor', () => {
  it('con hash congelado y un campo que cambia las lecturas derivadas, guarda hashAntes y hashDespues y actualiza el vigente; sin hash previo no lo inventa', () => {
    const e0 = estadoDeMuestra();
    const h = e0.hipotesis.find((x) => x.experimento && x.experimento.estado === 'propuesto')!;
    const asignado = asignarExperimento(e0, h.id, 'Lab X', T);
    const x0 = asignado.hipotesis.find((y) => y.id === h.id)!.experimento!;
    expect(x0.hashLecturas).toMatch(/^[0-9a-f]{64}$/);
    const e1 = enmendarExperimento(asignado, h.id, 'confirma', 'sube al menos un 30 %', 'potencia recalculada', 'Allegri', T + 1);
    const x1 = e1.hipotesis.find((y) => y.id === h.id)!.experimento!;
    const en = x1.enmiendas![0]!;
    if (en.hashAntes) {
      // La lectura derivada del par confirma/refuta cambió: el hash también.
      expect(en.hashAntes).toBe(x0.hashLecturas);
      expect(en.hashDespues).toBe(x1.hashLecturas);
      expect(x1.hashLecturas).not.toBe(x0.hashLecturas);
    } else {
      // Las lecturas declaradas no dependen de "confirma": el hash sigue igual y no se anota.
      expect(x1.hashLecturas).toBe(x0.hashLecturas);
    }
    // Sin hash congelado (registro anterior) no se inventa ninguno.
    const sinHash = { ...asignado, hipotesis: asignado.hipotesis.map((y) => (y.id === h.id ? { ...y, experimento: { ...y.experimento!, hashLecturas: undefined } } : y)) };
    const e2 = enmendarExperimento(sinHash, h.id, 'protocolo', 'otro protocolo', 'motivo', 'Allegri', T + 2);
    const x2 = e2.hipotesis.find((y) => y.id === h.id)!.experimento!;
    expect(x2.hashLecturas).toBeUndefined();
    expect(x2.enmiendas![0]!.hashAntes).toBeUndefined();
  });
});

describe('editarInvestigacion', () => {
  it('cambia solo los campos con texto y no toca el resto (misma regla que el servidor)', () => {
    const e = estadoDeMuestra();
    const inv = e.investigaciones[0]!;
    const e2 = editarInvestigacion(e, inv.id, { titulo: '  Progresión en Alzheimer  ', objetivo: '' });
    expect(e2.investigaciones[0]!.titulo).toBe('Progresión en Alzheimer');
    expect(e2.investigaciones[0]!.objetivo).toBe(inv.objetivo);
    expect(editarInvestigacion(e, 'inv-x', { titulo: 'Otro' }).investigaciones).toEqual(e.investigaciones);
  });
});
