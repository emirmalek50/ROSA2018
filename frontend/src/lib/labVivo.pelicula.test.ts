import { beforeEach, describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EntradaTranscripcion, EstadoRosa, EventoLab, Iteracion } from '../datos/tipos';
import type { AfirmacionEvidencia, Evidencia, FuenteEvidencia } from './evidencia';
import { fijarIdioma } from './idioma';
import { datosDelLaboratorio } from './labVivo';
import { eventoLabValido, peliculaDelLaboratorio } from './peliculaLab';

function caso(transcripcion: EntradaTranscripcion[] = []) {
  const e = structuredClone(estadoDeMuestra());
  const inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  c.busqueda = { ...c.busqueda, consultas: [] };
  const original = e.iteraciones.find(i => i.corridaId === c.id)!;
  const paso = { ...original.plan[0]!, id: 'paso-real', titulo: 'Consultar MAPT', detalle: 'Contrastar las fuentes originales', tipo: 'literatura', estado: 'en_curso' as const };
  const i: Iteracion = { ...original, id: 'iteracion-real', corridaId: c.id, numero: 1, terminadaEn: null, resumen: '', revisionRegistro: null,
    plan: [paso], planAprobado: true, pistas: [{ ...original.pistas[0]!, id: 'pista-real', iteracionId: 'iteracion-real', pasoId: paso.id,
      tipo: 'literatura', titulo: 'Búsqueda MAPT', estado: 'en_curso', fuente: 'PubMed', resumen: '', transcripcion }] };
  const estado: EstadoRosa = { ...e, conexion: 'en_linea', solicitudes: [], incidencias: [], corridas: [c], iteraciones: [i] };
  const datos = (evidencia: Evidencia | null = null) => datosDelLaboratorio(estado, inv, c, i, { evidencia });
  return { estado, inv, c, i, datos };
}
function entrada(eventoLab: EventoLab, t = 1, texto = 'Acontecimiento guardado'): EntradaTranscripcion {
  return { t, tipo: 'resultado', texto, agente: 'analogia', estadoAgente: 'terminado', eventoLab };
}
function fuente(iteracion = 1): FuenteEvidencia {
  return { id: 'fuente-real', referencia: 'PMID 123, tabla 2', titulo: 'Estudio original de MAPT', tipo: 'articulo', doi: null,
    pmid: '123', nct: null, anio: 2025, tipoEstudio: 'cohorte', relevancia: 0.7, retraccion: null, retraccionDetalle: '',
    textoCompleto: true, fragmentos: 2, extraida: true, iteracion, consultas: ['MAPT'] };
}
function afirmacion(veredicto: AfirmacionEvidencia['veredicto'] = 'sin_verificar', iteracion = 1): AfirmacionEvidencia {
  return { id: 'afirmacion-real', texto: 'La asociación necesita verificación', cita: 'PMID 123, tabla 2', veredicto, motivo: 'Aún no se ha revisado la cita',
    entidadDistinta: false, tipo: 'literatura', tema: 'MAPT', fuenteId: 'fuente-real', localizador: 'tabla 2', iteracion };
}
function evidencia(corridaId: string): Evidencia {
  return { corridaId, version: 1, consultas: [], fuentes: [fuente()], afirmaciones: [afirmacion()] };
}

beforeEach(() => fijarIdioma('es'));

describe('película de acontecimientos reales', () => {
  it('conserva todo el registro, incluso la primera propuesta después de cuarenta entradas', () => {
    const idea: EventoLab = { tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Intervención MAPT', enfoque: 'analogia' };
    const f = caso([entrada(idea), ...Array.from({ length: 49 }, (_, n): EntradaTranscripcion => ({ t: n + 2, tipo: 'nota', texto: `Lectura ${n + 1}` }))]);
    const d = f.datos();
    expect(d.actividad).toHaveLength(50);
    expect(d.actividad[0]).toMatchObject({ id: 'pista-real:0:1', estadoAgente: 'terminado', tipoPista: 'literatura', eventoLab: idea });
    expect(d.pelicula?.ideas).toEqual([{ hipotesisId: 'hip-real', titulo: 'Intervención MAPT', enfoque: 'analogia' }]);
    expect(d.pelicula?.eventos.find(e => e.dato?.tipo === 'idea')).toMatchObject({ id: 'registro:pista-real:0:1', sala: 'r3', agentes: ['Analogía'], dato: idea });
  });

  it('un refresco idéntico no cambia IDs y las entradas nuevas no renumeran las antiguas', () => {
    const f = caso([{ t: 1, tipo: 'nota', texto: 'Primera lectura' }]);
    const antes = f.datos().pelicula!.eventos;
    expect(f.datos().pelicula!.eventos).toEqual(antes);
    f.i.pistas[0]!.transcripcion.push({ t: 2, tipo: 'nota', texto: 'Segunda lectura' });
    expect(f.datos().pelicula!.eventos.filter(e => antes.some(a => a.id === e.id))).toEqual(antes);
  });

  it('conservar el histórico no revive aperturas anteriores ni confunde un agente reanudado con otro ya cerrado', () => {
    const f = caso([
      { t: 1, tipo: 'accion', texto: 'Primera tarea', agente: 'analogia', estadoAgente: 'en_curso' },
      { t: 2, tipo: 'accion', texto: 'Otro enfoque', agente: 'contradiccion', estadoAgente: 'en_curso' },
      { t: 3, tipo: 'resultado', texto: 'Primera tarea acabada', agente: 'analogia', estadoAgente: 'terminado' },
      { t: 4, tipo: 'resultado', texto: 'Otro enfoque acabado', agente: 'contradiccion', estadoAgente: 'terminado' },
      { t: 5, tipo: 'accion', texto: 'Segunda tarea', agente: 'analogia', estadoAgente: 'en_curso' },
    ]);
    expect(f.datos().actividad.map(a => a.abierta)).toEqual([false, false, false, false, true]);
    expect(f.datos().activos).toEqual(['Analogía']);
  });

  it('aprobar y actualizar el plan revisa la misma entidad con su estado y detalle completos', () => {
    const f = caso(); f.i.planAprobado = false;
    const pendiente = f.datos().pelicula!.eventos.find(e => e.tipo === 'plan')!;
    expect(pendiente.texto).toContain('Contrastar las fuentes originales');
    f.i.planAprobado = true; f.i.plan[0]!.estado = 'hecho';
    const aprobado = f.datos().pelicula!.eventos.find(e => e.tipo === 'plan')!;
    expect(aprobado.id).toBe(pendiente.id);
    expect(aprobado.texto).toContain('Plan aprobado'); expect(aprobado.texto).toContain('Hecho');
    expect(aprobado.texto).not.toBe(pendiente.texto);
    expect(f.datos().pasos.lista[0]).toMatchObject({ id: 'paso-real', tipo: 'literatura', estado: 'hecho' });
  });

  it('los IDs son por fuente, no por el número de resultados, y el fallo parcial conserva las cifras conocidas', () => {
    const f = caso(); const d = f.datos();
    d.fuentes = [{ nombre: 'PubMed', salen: 12, sirven: 3, consultas: 2, fallo: false }];
    const antes = peliculaDelLaboratorio(d, f.i).eventos.find(e => e.tipo === 'fuente')!;
    d.fuentes[0]!.fallo = true; d.fuentes[0]!.salen = 18;
    const despues = peliculaDelLaboratorio(d, f.i).eventos.find(e => e.tipo === 'fuente')!;
    expect(despues.id).toBe(antes.id); expect(despues.texto).toContain('18');
    expect(despues.texto).toContain('Algunas consultas no respondieron');
    expect(despues.texto).not.toContain('La fuente no respondió');
  });

  it('cero resultados es comprobado y un error sin cifra no se convierte en cero', () => {
    const f = caso(); const d = f.datos();
    d.fuentes = [{ nombre: 'PubMed', salen: 0, sirven: 0, consultas: 1, fallo: false },
      { nombre: 'Europe PMC', salen: null, sirven: null, consultas: 1, fallo: true },
      { nombre: 'Pendiente', salen: null, sirven: null, consultas: 1, fallo: false }];
    const fuentes = peliculaDelLaboratorio(d, f.i).eventos.filter(e => e.id.startsWith('fuente:'));
    expect(fuentes).toHaveLength(2);
    expect(fuentes[0]!.texto).toContain('Resultados: 0');
    expect(fuentes[1]!.texto).toContain('no respondieron'); expect(fuentes[1]!.texto).not.toContain('0');
  });

  it('atribuye el recorrido de una fuente a su actividad real, sin repartir fuentes por orden', () => {
    const f = caso(); const d = f.datos();
    d.fuentes = [{ nombre: 'ClinicalTrials.gov', salen: 4, sirven: 1, consultas: 1, fallo: false },
      { nombre: 'PubMed', salen: 2, sirven: 1, consultas: 1, fallo: false }];
    d.actividad = [{ ...d.actividad[0]!, id: 'ensayo-real', agente: 'Explorador', fuente: 'ClinicalTrials.gov' },
      { ...d.actividad[0]!, id: 'literatura-real', agente: 'Generador de consultas', fuente: 'PubMed' }];
    const eventos = peliculaDelLaboratorio(d, f.i).eventos;
    expect(eventos.find(e => e.id.endsWith(':ClinicalTrials.gov'))!.agentes).toEqual(['Explorador']);
    expect(eventos.find(e => e.id.endsWith(':PubMed'))!.agentes).toEqual(['Generador de consultas']);
  });

  it('la lectura solo muestra cifras conocidas, sin llamar al extractor si solo hay resultados de búsqueda', () => {
    const f = caso(); const d = f.datos();
    expect(peliculaDelLaboratorio(d, f.i).eventos.some(e => e.tipo === 'lectura')).toBe(false);
    d.lectura.resultados = 0;
    const resultados = peliculaDelLaboratorio(d, f.i).eventos.find(e => e.tipo === 'lectura')!;
    expect(resultados.texto).toBe('Resultados de consultas: 0'); expect(resultados.agentes).toEqual([]);
    d.lectura.leidos = 0; d.lectura.afirmaciones = 0; d.lectura.recuperados = 4;
    const lectura = peliculaDelLaboratorio(d, f.i).eventos.find(e => e.tipo === 'lectura')!;
    expect(lectura.id).toBe(resultados.id); expect(lectura.texto).toContain('Texto completo: 4');
    expect(lectura.texto).toContain('Afirmaciones extraídas: 0'); expect(lectura.agentes).toEqual(['Extractor de afirmaciones']);
  });

  it('la evidencia corresponde a corrida e iteración, con citas reales y sin un juez atribuido por suposición', () => {
    const f = caso(); const ev = evidencia(f.c.id);
    ev.fuentes.push({ ...fuente(2), id: 'fuente-otra-iteracion' });
    ev.afirmaciones.push({ ...afirmacion('sostenida', 2), id: 'afirmacion-otra-iteracion' });
    const d = f.datos(ev); const eventos = d.pelicula!.eventos;
    expect(d.afirmaciones).toHaveLength(1); expect(d.afirmaciones![0]).toMatchObject({ caja: 'otras', veredicto: 'sin_verificar', articulo: 'Estudio original de MAPT' });
    const a = eventos.find(e => e.id === `afirmacion:${f.i.id}:afirmacion-real`)!;
    expect(a.agentes).toEqual([]); expect(a.texto).toContain('Sin comprobar'); expect(a.texto).toContain('PMID 123, tabla 2');
    expect(eventos.some(e => e.id.includes('otra-iteracion'))).toBe(false);
    expect(eventos.find(e => e.id.includes('fuente-documento'))!.texto).toContain('Estudio original');
    expect(f.datos({ ...ev, corridaId: 'otra-corrida' }).afirmaciones).toBeNull();
    expect(f.datos({ ...ev, corridaId: 'otra-corrida' }).pelicula!.eventos.some(e => e.tipo === 'evidencia')).toBe(false);
  });

  it('una actualización de veredicto cambia el contenido conservando el ID de la afirmación', () => {
    const f = caso(); const ev = evidencia(f.c.id);
    const antes = f.datos(ev).pelicula!.eventos.find(e => e.tipo === 'evidencia')!;
    ev.afirmaciones[0]!.veredicto = 'parcial'; ev.afirmaciones[0]!.motivo = 'El resultado solo cubre una parte';
    const despues = f.datos(ev).pelicula!.eventos.find(e => e.tipo === 'evidencia')!;
    expect(despues.id).toBe(antes.id); expect(despues.texto).toContain('Parcial');
    expect(despues.texto).not.toContain('Sin comprobar');
  });

  it('no fabrica una tarjeta de hipótesis por un título, una hipótesis del estado ni un payload antiguo de otra iteración', () => {
    const f = caso([{ t: 1, tipo: 'resultado', texto: 'Nueva: título hip-supuesto', agente: 'analogia', estadoAgente: 'terminado' }]);
    expect(f.estado.hipotesis.length).toBeGreaterThan(0); expect(f.datos().pelicula!.ideas).toEqual([]);
    f.i.pistas[0]!.transcripcion.push(entrada({ tipo: 'idea', hipotesisId: 'hip-de-otra', titulo: 'Título real', enfoque: 'analogia' }, 2));
    f.i.pistas[0]!.iteracionId = 'iteracion-ajena';
    expect(f.datos().pelicula!.ideas).toEqual([]);
    expect(f.datos().actividad.at(-1)!.eventoLab).toBeUndefined();
  });

  it('deduplica IDs de entradas y tarjetas sin perder los acontecimientos distintos de una misma idea', () => {
    const f = caso([entrada({ tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Primera versión', enfoque: 'analogia' }),
      entrada({ tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Versión corregida', enfoque: 'analogia' }, 2)]);
    const d = f.datos(); d.actividad.push(d.actividad[0]!);
    const p = peliculaDelLaboratorio(d, f.i);
    expect(p.eventos.filter(e => e.dato?.tipo === 'idea')).toHaveLength(2);
    // La repetición de la misma entrada no debe hacer retroceder la tarjeta.
    expect(p.ideas).toEqual([{ hipotesisId: 'hip-real', titulo: 'Versión corregida', enfoque: 'analogia' }]);
  });

  it('no atribuye un enfoque nuevo a un personaje conocido por adivinarlo', () => {
    const f = caso([entrada({ tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Propuesta real', enfoque: 'nuevo_enfoque' })]);
    expect(f.datos().pelicula!.ideas).toHaveLength(1);
    expect(f.datos().pelicula!.eventos.find(e => e.dato?.tipo === 'idea')!.agentes).toEqual([]);
  });

  it.each([true, false])('un torneo porRegla=%s conserva pares/resultado exactos y solo el torneo de modelos asigna jueces', porRegla => {
    const dato: EventoLab = { tipo: 'torneo', hipotesisAId: 'hip-a', hipotesisBId: 'hip-b', tituloA: 'A real', tituloB: 'B real', estado: 'comparando', porRegla };
    const f = caso([entrada(dato), entrada({ ...dato, estado: 'no_comprobado' }, 2)]);
    const partidos = f.datos().pelicula!.eventos.filter(e => e.dato?.tipo === 'torneo');
    expect(partidos).toHaveLength(2); expect(partidos[0]!.id).not.toBe(partidos[1]!.id);
    expect(partidos[0]!.dato).toEqual(dato); expect(partidos[1]!.dato).toMatchObject({ estado: 'no_comprobado' });
    expect(partidos[0]!.agentes).toEqual(porRegla ? [] : ['Juez del torneo', 'Juez del torneo B']);
  });

  it.each(['programando', 'ejecutando', 'terminado', 'fallido', 'interpretando', 'auditando'] as const)('el análisis conserva estado %s, ID y origen sintético reales', estado => {
    const dato: EventoLab = { tipo: 'analisis', ejecucionId: 'ej-real', estado, sintetico: true };
    const f = caso([entrada(dato)]); const e = f.datos().pelicula!.eventos.find(e => e.dato?.tipo === 'analisis')!;
    expect(e).toMatchObject({ sala: 'r5', dato });
    expect(e.agentes).toEqual([estado === 'auditando' ? 'Auditor del análisis' : estado === 'interpretando' ? 'Intérprete' : 'Programador y Reparador']);
    expect(e.texto).not.toMatch(/éxito|replicado|resultado significativo/);
  });

  it('no recoge los partidos ni las ejecuciones históricas que carecen de procedencia de corrida', () => {
    const f = caso(); expect(f.estado.hipotesis.some(h => h.partidos.length)).toBe(true);
    expect(f.datos().pelicula!.eventos.some(e => e.dato?.tipo === 'torneo' || e.dato?.tipo === 'analisis')).toBe(false);
  });

  it('los conteos finales de veredictos sin progreso intermedio generan contenido completo sin atribuir al juez', () => {
    const f = caso(); const d = f.datos(); d.activos = [];
    d.juez.veredictos = { sostenida: 0, parcial: 1, no_sostenida: 2, otras: 3 };
    const e = peliculaDelLaboratorio(d, f.i).eventos.find(e => e.id.startsWith('verificacion:'))!;
    expect(e.agentes).toEqual([]); expect(e.texto).toContain('Sostenida: 0'); expect(e.texto).toContain('Parcial: 1');
    expect(e.texto).toContain('Otros veredictos: 3'); expect(e.texto).not.toContain('Juez:');
  });

  it('la muestra y una iteración de otra corrida no se presentan como una película real', () => {
    const f = caso([entrada({ tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Propuesta', enfoque: 'analogia' })]);
    f.estado.conexion = 'muestra'; const muestra = f.datos(evidencia(f.c.id));
    expect(muestra.pelicula).toEqual({ eventos: [], ideas: [] }); expect(muestra.afirmaciones).toBeNull();
    f.estado.conexion = 'en_linea';
    const ajena = datosDelLaboratorio(f.estado, f.inv, f.c, { ...f.i, corridaId: 'otra' }, { evidencia: evidencia(f.c.id) });
    expect(ajena.pelicula).toEqual({ eventos: [], ideas: [] }); expect(ajena.afirmaciones).toBeNull();
    expect(peliculaDelLaboratorio(f.datos(), { ...f.i, corridaId: 'otra' })).toEqual({ eventos: [], ideas: [] });
    expect(peliculaDelLaboratorio(f.datos(), { ...f.i, id: 'otra-iteracion' })).toEqual({ eventos: [], ideas: [] });
  });

  it('no muta el estado ni la evidencia para representar la película', () => {
    const f = caso([entrada({ tipo: 'articulo', id: 'doi-real', titulo: 'Artículo', estado: 'no_comprobado', motivo: 'No respondió el puntuador', modo: 'foco' })]);
    const ev = evidencia(f.c.id); const antesEstado = structuredClone(f.estado); const antesEv = structuredClone(ev);
    f.datos(ev); expect(f.estado).toEqual(antesEstado); expect(ev).toEqual(antesEv);
  });

  it('traduce etiquetas y límites al inglés sin reescribir títulos, motivos ni citas de la evidencia', () => {
    fijarIdioma('en'); const f = caso(); const d = f.datos(); const ev = evidencia(f.c.id);
    d.fuentes = [{ nombre: 'PubMed', salen: 2, sirven: 1, fallo: true, consultas: 2 }];
    d.lectura.leidos = 2; d.lectura.afirmaciones = 0;
    d.juez.veredictos = { sostenida: 0, parcial: 0, no_sostenida: 0, otras: 1 };
    const eventos = peliculaDelLaboratorio(d, f.i, ev).eventos;
    expect(eventos.find(e => e.id.startsWith('fuente:'))!.texto).toContain('Some queries failed to respond');
    expect(eventos.find(e => e.tipo === 'lectura')!.texto).toContain('Sources read in the latest extraction: 2');
    expect(eventos.find(e => e.tipo === 'lectura')!.texto).toContain('Extracted statements: 0');
    expect(eventos.find(e => e.id.startsWith('verificacion:'))!.texto).toContain('Other verdicts: 1');
    const afirmacion = eventos.find(e => e.tipo === 'evidencia')!.texto;
    expect(afirmacion).toContain(ev.afirmaciones[0]!.texto); expect(afirmacion).toContain(ev.afirmaciones[0]!.cita);
    expect(afirmacion).not.toContain('Sin comprobar');
  });
});

describe('payloads estructurados como datos, con validación conservadora', () => {
  it.each([
    null, [], { tipo: 'idea', hipotesisId: '', titulo: 'Sin identidad', enfoque: 'analogia' },
    { tipo: 'torneo', hipotesisAId: 'a', hipotesisBId: 'a', tituloA: 'A', tituloB: 'A', estado: 'a', porRegla: false },
    { tipo: 'torneo', hipotesisAId: 'a', hipotesisBId: 'b', tituloA: 'A', tituloB: 'B', estado: 'a', porRegla: 'false' },
    { tipo: 'analisis', ejecucionId: 'ej', estado: 'confirmado', sintetico: false },
    { tipo: 'analisis', ejecucionId: 'ej', estado: 'terminado', sintetico: 0 },
    { tipo: 'articulo', id: 'f', titulo: 'Artículo', estado: { toString: () => 'incluido' }, motivo: '', modo: 'foco' },
    { tipo: 'articulo', id: 'f', titulo: 'Artículo', estado: 'incluido', motivo: '', modo: null },
  ])('rechaza el payload malformado %# sin crear asociaciones', valor => expect(eventoLabValido(valor)).toBe(false));

  it.each(['incluido', 'excluido', 'no_comprobado'] as const)('mantiene el artículo %s con su motivo y biblioteca reales', estado => {
    const dato: EventoLab = { tipo: 'articulo', id: 'PMID:123', titulo: 'Artículo original', estado, motivo: 'Motivo escrito durante el cribado', modo: 'amplitud' };
    expect(eventoLabValido(dato)).toBe(true);
    const f = caso([entrada(dato)]); const e = f.datos().pelicula!.eventos.find(e => e.dato?.tipo === 'articulo')!;
    expect(e).toMatchObject({ sala: 'r1', tipo: 'filtro', agentes: ['Puntuador amplitud'], dato });
    expect(e.dato).not.toHaveProperty('relevancia');
  });

  it('conserva el texto del registro inválido sin fabricar su ID de tarjeta', () => {
    const f = caso([{ ...entrada({ tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Propuesta', enfoque: 'analogia' }), eventoLab: { tipo: 'idea' } as EventoLab }]);
    const p = f.datos().pelicula!; expect(p.ideas).toEqual([]);
    expect(p.eventos.find(e => e.id.startsWith('registro:'))).toMatchObject({ texto: 'Acontecimiento guardado', dato: undefined });
  });
});
