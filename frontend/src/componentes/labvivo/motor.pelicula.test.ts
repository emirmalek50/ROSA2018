// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { EventoLab, Iteracion } from '../../datos/tipos';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { fijarIdioma } from '../../lib/idioma';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { montarLaboratorio, type Laboratorio, type Respuestas } from './motor';

let nodo: HTMLDivElement, motor: Laboratorio | null, frame: FrameRequestCallback, tiempo: number;
function datos(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  c.busqueda = { ...c.busqueda, consultas: [] };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'iteracion-real', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso-real', tipo: 'literatura', titulo: 'Consultar MAPT', detalle: 'Leer originales', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i),
    activos: [], actividad: [], pelicula: { eventos: [], ideas: [] } };
}
function montar(d: DatosLab) {
  const resp: Respuestas = { conceder: vi.fn(async () => true), denegar: vi.fn(async () => true), aprobarPlan: vi.fn(async () => true),
    ampliarPresupuesto: vi.fn(async () => true), resolverIncidencia: vi.fn(async () => true), verEnLaCorrida: vi.fn(), verNovedad: vi.fn() };
  motor = montarLaboratorio(nodo, d, resp); return resp;
}
async function avanzar(n: number, observar?: () => void) {
  for (let j = 0; j < n; j++) {
    tiempo += 100; frame(tiempo);
    for (let k = 0; k < 4; k++) await Promise.resolve();
    observar?.();
  }
}
function conEvento(d: DatosLab, evento: EventoVisualLab): DatosLab {
  return { ...d, pelicula: { eventos: [...(d.pelicula?.eventos ?? []), evento], ideas: d.pelicula?.ideas ?? [] } };
}
function posiciones(a: HTMLElement): [number, number] {
  const p = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(a.style.transform);
  expect(p).not.toBeNull(); return [Number(p![1]), Number(p![2])];
}
function documentos(): HTMLElement[] { return [...nodo.querySelectorAll<HTMLElement>('.lv-documento')]; }
beforeEach(() => {
  fijarIdioma('es'); tiempo = 0; motor = null; nodo = document.createElement('div'); document.body.append(nodo);
  vi.spyOn(performance, 'now').mockImplementation(() => tiempo);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(async () => { motor?.desmontar(); nodo.remove(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('el motor representa la película del registro, sin inventar el trabajo ni la voz', () => {
  it.each(['incluido', 'excluido', 'no_comprobado'] as const)('representa un artículo %s con su título y motivo reales, sin diálogo técnico', async estado => {
    const d = datos(); montar(d);
    const dato: EventoLab = { tipo: 'articulo', id: 'PMID:123', titulo: '<img src=x onerror=alert(1)> MAPT real', estado, motivo: 'Motivo real del cribado', modo: 'foco' };
    const e: EventoVisualLab = { id: 'pista-real:articulo:1', sala: 'r1', agentes: ['Puntuador preguntas'], tipo: 'filtro', dato, texto: 'Registro técnico: artículo MAPT' };
    motor!.actualizar(conEvento(d, e)); const vistos = new Set<string>();
    await avanzar(450, () => documentos().forEach(el => vistos.add(el.title)));
    const esperado = estado === 'incluido' ? 'Incluido' : estado === 'excluido' ? 'Excluido' : 'No pude comprobar';
    expect([...vistos].some(t => t.includes(dato.titulo) && t.includes(esperado) && t.includes(dato.motivo))).toBe(true);
    expect(nodo.querySelector('img[src=x]')).toBeNull(); expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });

  it('el plan transporta todos los pasos canónicos y conserva los mismos personajes después de editarlo', async () => {
    const d = datos(); montar(d); const planificador = nodo.querySelector('[data-agente="Planificador"]');
    const lista = [{ id: 'p1', titulo: 'Buscar TREM2 en PubMed', detalle: 'Solo originales', estado: 'hecho' as const },
      { id: 'p2', titulo: 'Contrastar las citas', detalle: 'Página exacta', estado: 'pendiente' as const },
      { id: 'p3', titulo: 'Comparar hipótesis rivales', detalle: 'Dos revisores', estado: 'pendiente' as const }];
    const e: EventoVisualLab = { id: 'plan:iteracion-real', sala: 'plan', agentes: ['Planificador'], tipo: 'plan', texto: 'Plan real aprobado' };
    const actualizado = conEvento({ ...d, pasos: { ...d.pasos, lista } }, e);
    motor!.actualizar(actualizado);
    await avanzar(700, () => expect(nodo.querySelector('.lv-documento[data-sala="plan"]')).toBeNull());
    nodo.querySelector<HTMLButtonElement>('[aria-label="Abrir la pizarra del plan"]')!.click();
    expect([...nodo.querySelectorAll('.lv-o-pasos li b')].map(p => p.textContent)).toEqual(lista.map(p => p.titulo));
    expect(nodo.querySelector('[data-agente="Planificador"]')).toBe(planificador);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });

  it.each([false, true])('una fuente con fallo=%s muestra cero comprobado o el fallo real sin convertirlo en ausencia', async fallo => {
    const d = datos(); montar(d);
    const texto = fallo ? 'PubMed\nAlgunas consultas no respondieron' : 'PubMed\nResultados: 0';
    const actualizado = conEvento({ ...d, fuentes: [{ nombre: 'PubMed', salen: fallo ? null : 0, sirven: fallo ? null : 0, fallo, consultas: 1 }] },
      { id: 'fuente:iteracion-real:PubMed', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto });
    motor!.actualizar(actualizado); const vistos = new Set<string>();
    await avanzar(500, () => documentos().forEach(el => vistos.add(el.title)));
    expect(vistos.has(texto)).toBe(true);
    if (fallo) expect([...vistos].some(t => t.includes('Resultados: 0'))).toBe(false);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });

  it('el tablón enseña solo ideas recibidas con identidad explícita y escapa el texto', async () => {
    const d = datos(); montar(d);
    const ideas = [{ hipotesisId: 'hip-1', titulo: 'Modular TREM2', enfoque: 'analogia' },
      { hipotesisId: 'hip-2', titulo: '<svg onload=alert(1)> MAPT', enfoque: 'contradiccion' }];
    motor!.actualizar({ ...d, pelicula: { eventos: [], ideas } }); await avanzar(30);
    const tarjetas = [...nodo.querySelectorAll<HTMLElement>('.lv-tarjeta-idea')];
    expect(tarjetas.map(el => el.dataset.hipotesis)).toEqual(['hip-1', 'hip-2']);
    expect(tarjetas.map(el => el.title)).toEqual(ideas.map(i => i.titulo));
    expect(nodo.querySelector('svg[onload]')).toBeNull(); expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
    motor!.actualizar({ ...d, identidad: 'otra-corrida/otra-iteracion' });
    expect(nodo.querySelectorAll('.lv-tarjeta-idea')).toHaveLength(0);
  });

  it('el torneo tipado compara los dos títulos reales y muestra el resultado registrado, sin crear otros pares', async () => {
    const d = datos(); montar(d);
    const dato: EventoLab = { tipo: 'torneo', hipotesisAId: 'hip-a', hipotesisBId: 'hip-b', tituloA: 'Rival MAPT', tituloB: 'Rival TREM2', estado: 'b', porRegla: false };
    const e: EventoVisualLab = { id: 'torneo-real', sala: 'r4', agentes: ['Juez del torneo', 'Juez del torneo B'], tipo: 'torneo', dato, texto: 'Par real registrado' };
    motor!.actualizar(conEvento(d, e)); const vistos = new Set<string>();
    await avanzar(500, () => documentos().forEach(el => vistos.add(el.title)));
    expect([...vistos].some(t => t.includes(dato.tituloA) && t.includes(dato.tituloB))).toBe(true);
    expect([...vistos].some(t => t.includes('Resultado registrado: Rival TREM2'))).toBe(true);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0);
  });

  it('un torneo reglado muestra su par y decisión estáticos sin asignar la comparación a jueces humanos', async () => {
    const d = datos(); montar(d);
    const dato: EventoLab = { tipo: 'torneo', hipotesisAId: 'hip-a', hipotesisBId: 'hip-b', tituloA: 'MAPT reglado', tituloB: 'TREM2 reglado', estado: 'a', porRegla: true };
    const e: EventoVisualLab = { id: 'torneo-reglado', sala: 'r4', agentes: [], tipo: 'torneo', dato, texto: 'Comparación por regla registrada' };
    motor!.actualizar(conEvento(d, e)); const vistos = new Set<string>(); let actores = false;
    await avanzar(300, () => {
      const expediente = nodo.querySelector<HTMLElement>('.lv-expediente-torneo');
      if (expediente && !expediente.hidden) vistos.add(expediente.textContent ?? '');
      actores ||= [...nodo.querySelectorAll<HTMLElement>('.lv-ag')].some(el => el.dataset.evento === e.id);
    });
    expect(actores).toBe(false);
    expect([...vistos].some(t => t.includes(dato.tituloA) && t.includes(dato.tituloB))).toBe(true);
    expect([...vistos].some(t => t.includes('Comparación por regla: MAPT reglado'))).toBe(true);
    expect(nodo.querySelector<HTMLElement>('.lv-expediente-torneo')!.dataset).toMatchObject({ hipotesisA: 'hip-a', hipotesisB: 'hip-b' });
  });

  it('una frase que menciona rivales no crea por sí sola un partido ni un resultado', async () => {
    const d = datos(); montar(d);
    motor!.actualizar(conEvento(d, { id: 'revision-real', sala: 'r4', agentes: ['Killer'], tipo: 'revision', texto: 'Revisé MAPT vs TREM2: el artículo es ambiguo' }));
    const vistos = new Set<string>(); await avanzar(350, () => documentos().forEach(el => vistos.add(el.title)));
    expect([...vistos].some(t => t.includes('el artículo es ambiguo'))).toBe(true);
    expect([...vistos].some(t => t.includes('Resultado registrado'))).toBe(false);
    expect(nodo.querySelectorAll('.lv-tarjeta-idea')).toHaveLength(0);
  });

  it('la máquina solo identifica una ejecución recibida y conserva la marca sintética y sus estados', async () => {
    const d = datos(); montar(d); expect(nodo.querySelector<HTMLElement>('.lv-maquina')!.hidden).toBe(true);
    const dato: EventoLab = { tipo: 'analisis', ejecucionId: 'ej-real-123', estado: 'ejecutando', sintetico: true };
    const e: EventoVisualLab = { id: 'ejecucion:123', sala: 'r5', agentes: ['Programador y Reparador'], tipo: 'analisis', dato, texto: 'Ejecutando el código registrado' };
    motor!.actualizar(conEvento(d, e));
    const maquina = nodo.querySelector<HTMLElement>('.lv-maquina')!;
    expect(maquina.hidden).toBe(false); expect(maquina.dataset.ejecucion).toBe('ej-real-123');
    expect(maquina.dataset.estado).toBe('ejecutando'); expect(maquina.textContent).toContain('Ensayo sintético');
    motor!.actualizar(conEvento(d, { ...e, dato: { ...dato, estado: 'fallido' } }));
    expect(maquina.dataset.estado).toBe('fallido'); expect(maquina.textContent).toContain('falló');
    motor!.actualizar({ ...d, identidad: 'otra-corrida/otra-iteracion' });
    expect(maquina.hidden).toBe(true); expect(maquina.dataset.ejecucion).toBeUndefined();
  });

  it('las etiquetas de máquina y torneo cambian al inglés manteniendo los datos científicos recibidos', () => {
    fijarIdioma('en'); const d = datos(); montar(d);
    const analisis: EventoVisualLab = { id: 'analisis-real', sala: 'r5', agentes: ['Programador y Reparador'], tipo: 'analisis', texto: 'Recorded analysis',
      dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'fallido', sintetico: true } };
    const torneo: EventoVisualLab = { id: 'par-real', sala: 'r4', agentes: [], tipo: 'torneo', texto: 'Recorded pair',
      dato: { tipo: 'torneo', hipotesisAId: 'a', hipotesisBId: 'b', tituloA: 'Exact title A', tituloB: 'Exact title B', estado: 'no_comprobado', porRegla: true } };
    motor!.actualizar(conEvento(conEvento(d, analisis), torneo));
    expect(nodo.querySelector('.lv-maquina')!.textContent).toBe('Synthetic test · Execution failed');
    const texto = nodo.querySelector('.lv-expediente-torneo')!.textContent;
    expect(texto).toContain('Exact title A'); expect(texto).toContain('Exact title B');
    expect(texto).toContain('Versus'); expect(texto).toContain('Rule-based comparison');
    expect(texto).not.toMatch(/Comparación|Frente a|No pude comprobar/);
  });

  it('el resumen final de una corrida terminada se entrega con su texto real, sin reiniciar investigación', async () => {
    const d = datos(); const resp = montar(d);
    const e: EventoVisualLab = { id: 'cierre-real', sala: 'r6', agentes: ['Resumidor'], tipo: 'cierre', texto: 'La evidencia sobre TREM2 quedó parcial. Falta comparar cohortes.' };
    motor!.actualizar(conEvento({ ...d, estado: 'terminada', trabajando: false }, e));
    const vistos = new Set<string>(); await avanzar(650, () => documentos().forEach(el => vistos.add(el.title)));
    expect(vistos.has(e.texto)).toBe(true); expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(0);
    expect(nodo.querySelectorAll('.lv-bub')).toHaveLength(0); expect(resp.aprobarPlan).not.toHaveBeenCalled();
  });

  it('SSE repetido no reproduce un acontecimiento ya representado ni reemplaza los personajes', async () => {
    const d = datos(); montar(d); const a = nodo.querySelector<HTMLElement>('[data-agente="Puntuador preguntas"]')!;
    const dato: EventoLab = { tipo: 'articulo', id: 'PMID:456', titulo: 'Cribado único MAPT', estado: 'no_comprobado', motivo: 'Sin respuesta del puntuador', modo: 'foco' };
    const e: EventoVisualLab = { id: 'articulo-unico', sala: 'r1', agentes: ['Puntuador preguntas'], tipo: 'filtro', dato, texto: 'Registro único' };
    const actualizado = conEvento(d, e); motor!.actualizar(actualizado);
    const objetos = new Set<HTMLElement>();
    await avanzar(700, () => {
      documentos().filter(el => el.dataset.evento === e.id).forEach(el => objetos.add(el));
      if (tiempo % 500 === 0) motor!.actualizar(actualizado);
      expect(nodo.querySelector('[data-agente="Puntuador preguntas"]')).toBe(a);
    });
    expect(objetos.size).toBe(1);
  });

  it('la conversación de IA interrumpe una entrega y la reencola sin teletransportar ni duplicar la voz', async () => {
    const d = datos(); montar(d);
    const dato: EventoLab = { tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Propuesta de MAPT', enfoque: 'analogia' };
    const e: EventoVisualLab = { id: 'idea-interrumpida', sala: 'r3', agentes: ['Analogía'], tipo: 'idea', dato, texto: 'Hipótesis guardada' };
    const actualizado = conEvento(d, e); motor!.actualizar(actualizado);
    const a = nodo.querySelector<HTMLElement>('[data-agente="Analogía"]')!;
    await avanzar(10); expect(a.dataset.evento).toBe(e.id);
    const turno: TurnoLaboratorio = { id: 'turno-ia-real', temaId: 'tema-real', iteracionId: 'iteracion-real', idioma: 'es', agente: 'Analogía', destinatario: 'Contradicción',
      texto: 'Vale, voy a contrastarlo con otra cohorte.', fecha: Date.now(), modelo: 'prueba', materiales: [] };
    motor!.conversar([turno, turno]);
    let ultima = posiciones(a), maximoSalto = 0; const voces = new Set<HTMLElement>(); const escenas = new Set<string>();
    await avanzar(1100, () => {
      const ahora = posiciones(a); maximoSalto = Math.max(maximoSalto, Math.hypot(ahora[0] - ultima[0], ahora[1] - ultima[1])); ultima = ahora;
      nodo.querySelectorAll<HTMLElement>('.lv-bub[data-turno]').forEach(el => voces.add(el));
      if (a.dataset.escena) escenas.add(a.dataset.escena);
      if (tiempo % 1000 === 0) motor!.actualizar(actualizado);
    });
    expect(escenas.has('conversacion')).toBe(true); expect(escenas.has('pelicula')).toBe(true);
    expect(voces.size).toBe(1); expect([...voces][0]!.title).toBe(turno.texto);
    expect(maximoSalto).toBeLessThan(15); expect(nodo.querySelector('[data-agente="Analogía"]')).toBe(a);
  });

  it('sin verificar permanece pendiente y no produce sello ni caja de veredicto', async () => {
    const d = datos(); d.activos = ['Juez']; d.foco = 'r2';
    d.afirmaciones = [{ id: 'a-pendiente', texto: 'Afirmación que aún espera comprobación', veredicto: 'sin_verificar', caja: 'otras',
      motivo: 'El juez no terminó', cita: 'PMID 123, tabla 2', articulo: 'Artículo real', biblioteca: 'PubMed' }];
    montar(d); let sello = false, caja = false;
    await avanzar(500, () => { sello ||= !!nodo.querySelector('.lv-sello'); caja ||= !!nodo.querySelector('.lv-tag.pop'); });
    expect(sello).toBe(false); expect(caja).toBe(false);
  });

  it('un fallo parcial conserva la cifra comprobada de la biblioteca', () => {
    const d = datos(); montar({ ...d, fuentes: [{ nombre: 'PubMed', salen: 28, sirven: 6, fallo: true, consultas: 2 }] });
    const cartel = nodo.querySelector<HTMLElement>('.lv-tag.cartel')!;
    expect(cartel.textContent).toContain('28'); expect(cartel.textContent).not.toContain('no responde');
    expect(cartel.title).toContain('Algunas consultas');
  });

  it('la decisión registrada se representa una sola vez aunque el juez siga activo', async () => {
    const d = datos(); d.activos = ['Juez']; d.foco = 'r2';
    d.afirmaciones = [{ id: 'af-decidida', texto: 'Dato comprobado', veredicto: 'sostenida', caja: 'sostenida', motivo: 'Respaldo registrado', cita: 'PMID 1', articulo: 'Artículo', biblioteca: null, procedenciaVeredicto: { origen: 'juez', modelo: 'modelo de prueba', comprobaciones: [] } }];
    montar(d); const sellos = new Set<HTMLElement>();
    await avanzar(1100, () => {
      nodo.querySelectorAll<HTMLElement>('.lv-sello').forEach(s => sellos.add(s));
      if (tiempo % 1000 === 0) motor!.actualizar(d);
    });
    expect(sellos.size).toBe(1); expect(d.afirmaciones[0]!.veredicto).toBe('sostenida');
  });

  it('seguir manualmente una afirmación pendiente tampoco la sella ni afirma que el juez la decidió', async () => {
    const d = datos(); d.afirmaciones = [{ id: 'a-pendiente', texto: 'Afirmación pendiente', veredicto: 'sin_verificar', caja: 'otras',
      motivo: 'El juez no terminó', cita: 'PMID 123, tabla 2', articulo: 'Artículo real', biblioteca: 'PubMed' }];
    montar(d); nodo.querySelector<HTMLButtonElement>('.lv-sigue')!.click(); const narraciones = new Set<string>(); let sello = false;
    await avanzar(600, () => { sello ||= !!nodo.querySelector('.lv-sello'); narraciones.add(nodo.querySelector('.lv-narra')!.textContent ?? ''); });
    expect(sello).toBe(false);
    expect([...narraciones].some(t => t.includes('Cae en la caja'))).toBe(false);
    expect([...narraciones].some(t => t.includes('pendiente') || t.includes('Sin comprobar'))).toBe(true);
  });

  it('regresa de la estantería por el paso inferior, sin saltos ni atravesar la pared', async () => {
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'fuente:iteracion-real:PubMed', sala: 'r1', agentes: ['Generador de consultas'], tipo: 'fuente', texto: 'PubMed\nResultados: 24' };
    motor!.actualizar(conEvento({ ...d, fuentes: [{ nombre: 'PubMed', salen: 24, sirven: null, fallo: false, consultas: 1 }] }, e));
    const a = nodo.querySelector<HTMLElement>('[data-agente="Generador de consultas"]')!;
    await avanzar(1);
    let biblioteca = false, vuelta = false, anterior = posiciones(a), salto = 0;
    await avanzar(700, () => {
      const [x, y] = posiciones(a);
      if (x > 775 && y < 110) biblioteca = true;
      if (biblioteca && x < 660 && y > 260) vuelta = true;
      if (x > 746 && x < 778) expect(y).toBeGreaterThanOrEqual(264);
      salto = Math.max(salto, Math.hypot(x - anterior[0], y - anterior[1])); anterior = [x, y];
    });
    expect(biblioteca).toBe(true); expect(vuelta).toBe(true); expect(salto).toBeLessThan(15);
  });

  it('al reanudar descarta escenas de antes de la pausa y toma solo el trabajo actual', async () => {
    const d = datos(); montar(d);
    const antiguo: EventoVisualLab = { id: 'articulo-viejo', sala: 'r1', agentes: ['Puntuador preguntas'], tipo: 'filtro',
      dato: { tipo: 'articulo', id: 'PMID:1', titulo: 'Artículo anterior', estado: 'incluido', motivo: 'Decisión anterior', modo: 'foco' }, texto: 'Antes de pausar' };
    const previo = conEvento(d, antiguo); motor!.actualizar(previo); await avanzar(5);
    motor!.actualizar({ ...previo, trabajando: false, estado: 'pausada' }); await avanzar(20);
    const actual: EventoVisualLab = { id: 'idea-actual', sala: 'r3', agentes: ['Analogía'], tipo: 'idea',
      dato: { tipo: 'idea', hipotesisId: 'hip-actual', titulo: 'Trabajo actual', enfoque: 'analogia' }, texto: 'Ahora propongo una idea' };
    motor!.actualizar({ ...conEvento(previo, actual), activos: ['Analogía'], foco: 'r3' });
    const observadas = new Set<string>(); await avanzar(650, () => nodo.querySelectorAll<HTMLElement>('.lv-ag[data-evento]').forEach(a => observadas.add(a.dataset.evento!)));
    expect(observadas.has(actual.id)).toBe(true); expect(observadas.has(antiguo.id)).toBe(false);
  });

  it('el resumen puede acabar su entrega aunque lleguen más estados de la corrida terminada', async () => {
    const d = datos(); montar(d);
    const e: EventoVisualLab = { id: 'resumen-final', sala: 'r6', agentes: ['Resumidor'], tipo: 'cierre', texto: 'Resumen final realmente guardado' };
    const final = { ...conEvento(d, e), trabajando: false, estado: 'terminada' as const };
    motor!.actualizar(final);
    const a = nodo.querySelector<HTMLElement>('[data-agente="Resumidor"]')!;
    let bandeja = false;
    await avanzar(650, () => {
      const [x, y] = posiciones(a); bandeja ||= x < 150 && y > 1220;
      if (tiempo % 1000 === 0) motor!.actualizar(final);
    });
    expect(bandeja).toBe(true); expect(nodo.querySelectorAll('.lv-ag.activo')).toHaveLength(0);
  });
});
