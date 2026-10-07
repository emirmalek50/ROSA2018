import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../../datos/muestra';
import type { Iteracion } from '../../datos/tipos';
import { datosDelLaboratorio, type DatosLab } from '../../lib/labVivo';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { ColaPelicula } from './colaPelicula';
import { escenasDeApertura, MAX_ESCENAS_APERTURA } from './inicioPelicula';

function datos(): DatosLab {
  const e = structuredClone(estadoDeMuestra()), inv = e.investigaciones[0]!;
  const c = { ...e.corridas.find(c => c.investigacionId === inv.id)!, estado: 'en_marcha' as const, iteracionActual: 1, terminadaEn: null };
  c.busqueda = { ...c.busqueda, consultas: [] };
  const anterior = e.iteraciones.find(i => i.corridaId === c.id)!;
  const i: Iteracion = { ...anterior, id: 'it-real', numero: 1, terminadaEn: null, resumen: '', planAprobado: true, revisionRegistro: null,
    plan: [{ ...anterior.plan[0]!, id: 'paso-real', tipo: 'verificacion', titulo: 'Verificar las citas', detalle: 'Página exacta', estado: 'en_curso' }], pistas: [] };
  return { ...datosDelLaboratorio({ ...e, conexion: 'en_linea', solicitudes: [], incidencias: [] }, inv, c, i),
    activos: [], actividad: [], pelicula: { eventos: [], ideas: [] } };
}
function evento(id: string, tipo: EventoVisualLab['tipo'], sala: EventoVisualLab['sala'], agentes: string[], texto = 'Resultado registrado'): EventoVisualLab {
  return { id, tipo, sala, agentes, texto };
}
function articulo(n: number): EventoVisualLab {
  return { ...evento(`registro:pista:${n}:10`, 'filtro', 'r1', ['Puntuador preguntas'], `Artículo ${n}`),
    dato: { tipo: 'articulo', id: `PMID:${n}`, titulo: `Título original ${n}`, estado: 'incluido', motivo: 'Motivo del cribado', modo: 'foco' } };
}
function agregar(d: DatosLab, ...eventos: EventoVisualLab[]) { d.pelicula!.eventos.push(...eventos); }

describe('la primera foto de la corrida enseña resultados existentes y trabajo actual', () => {
  it('241 cribados y una ráfaga de 151 notas no se reproducen en masa; el progreso actual del juez sale primero', () => {
    const d = datos(); d.activos = ['Juez']; d.juez = { hechas: 30, total: 120, sinJuez: 5, veredictos: null };
    d.lectura = { resultados: 704, sirven: 89, recuperados: 29, leidos: 14, afirmaciones: 125 };
    d.fuentes = [{ nombre: 'PubMed', salen: 302, sirven: 2, consultas: 4, fallo: false }];
    agregar(d, evento('plan:it-real', 'plan', 'plan', ['Planificador'], 'Plan aprobado con pasos reales'),
      evento('fuente:it-real:PubMed', 'fuente', 'r1', ['Generador de consultas'], 'PubMed: 302 resultados'),
      ...Array.from({ length: 241 }, (_, n) => articulo(n)),
      ...Array.from({ length: 151 }, (_, n) => evento(`registro:verificacion:${n}:5`, 'revision', 'r2', ['Juez'], 'Comprobaciones deterministas: citas, cifras e identificadores')),
      evento('lectura:it-real', 'lectura', 'r1', ['Extractor de afirmaciones'], '14 fuentes leídas, 125 afirmaciones extraídas'),
      evento('verificacion:it-real', 'revision', 'r2', ['Juez'], 'Juez: 30 / 120; sin juez: 5'));
    const antes = structuredClone(d), escenas = escenasDeApertura(d);
    expect(escenas[0]!.id).toBe('verificacion:it-real');
    expect(escenas.length).toBeLessThanOrEqual(MAX_ESCENAS_APERTURA);
    expect(escenas.filter(e => e.dato?.tipo === 'articulo')).toEqual([d.pelicula!.eventos.find(e => e.dato?.tipo === 'articulo' && e.dato.id === 'PMID:240')]);
    expect(escenas.map(e => e.id)).toEqual(expect.arrayContaining(['plan:it-real', 'fuente:it-real:PubMed', 'lectura:it-real']));
    expect(new Set(escenas.map(e => e.id)).size).toBe(escenas.length); expect(d).toEqual(antes);
    expect(escenas.every(e => d.pelicula!.eventos.includes(e))).toBe(true);
    const cola = new ColaPelicula(); cola.recibir(d.pelicula!.eventos, d.identidad, true);
    escenas.forEach(e => cola.devolver(e));
    const emitidos: EventoVisualLab[] = [];
    for (let e = cola.siguiente(() => true); e; e = cola.siguiente(() => true)) emitidos.push(e);
    expect(emitidos).toEqual(escenas);
  });

  it('prefiere lectura agregada al último texto técnico y conserva el documento científico tal cual', () => {
    const d = datos(); d.activos = ['Extractor de afirmaciones']; d.lectura.leidos = 12; d.lectura.afirmaciones = 71;
    const resumen = evento('lectura:it-real', 'lectura', 'r1', ['Extractor de afirmaciones'], '12 fuentes, 71 afirmaciones');
    agregar(d, resumen, evento('registro:ext:1:1', 'extraccion', 'r1', ['Extractor de afirmaciones'], 'programas.extraccion: preparando la llamada'));
    expect(escenasDeApertura(d)[0]).toBe(resumen);
    expect(resumen.texto).toBe('12 fuentes, 71 afirmaciones');
  });

  it('conserva cero resultados real y escoge la última fuente con cifra, sin inventar un cero por fallo', () => {
    const d = datos(); d.fuentes = [
      { nombre: 'PubMed', salen: 20, sirven: 3, consultas: 1, fallo: false },
      { nombre: 'Europe PMC', salen: 0, sirven: 0, consultas: 1, fallo: false },
      { nombre: 'Exa', salen: null, sirven: null, consultas: 1, fallo: true },
    ];
    agregar(d, evento('fuente:it-real:PubMed', 'fuente', 'r1', ['Generador de consultas'], '20 resultados'),
      evento('fuente:it-real:Europe PMC', 'fuente', 'r1', ['Generador de consultas'], '0 resultados'),
      evento('fuente:it-real:Exa', 'fuente', 'r1', ['Generador de consultas'], 'La consulta no respondió'));
    const escenas = escenasDeApertura(d); expect(escenas).toHaveLength(1);
    expect(escenas[0]!.id).toBe('fuente:it-real:Europe PMC'); expect(escenas[0]!.texto).toBe('0 resultados');
  });

  it('sin trabajo activo también conserva el último resultado concreto de cada sala, siempre hasta ocho', () => {
    const d = datos(); d.fuentes = [{ nombre: 'PubMed', salen: 1, sirven: 1, consultas: 1, fallo: false }];
    d.lectura.leidos = 1; d.juez.hechas = 0;
    const idea: EventoVisualLab = { ...evento('idea-real', 'idea', 'r3', ['Analogía']), dato: { tipo: 'idea', hipotesisId: 'h-real', titulo: 'Idea real', enfoque: 'analogia' } };
    agregar(d, evento('plan:it-real', 'plan', 'plan', ['Planificador']), evento('fuente:it-real:PubMed', 'fuente', 'r1', ['Generador de consultas']), articulo(1),
      evento('lectura:it-real', 'lectura', 'r1', ['Extractor de afirmaciones']), evento('verificacion:it-real', 'revision', 'r2', ['Juez']), idea,
      evento('revision-real', 'revision', 'r4', ['Killer']), evento('analisis-real', 'analisis', 'r5', ['Intérprete']),
      evento('cierre-real', 'cierre', 'r6', ['Meta-revisor']), evento('patentes-real', 'revision', 'r7', ['Especialista en patentes']));
    const escenas = escenasDeApertura(d); expect(escenas).toHaveLength(8);
    expect(escenas.map(e => e.id)).toContain('idea-real'); expect(escenas.every(e => e.agentes.length > 0)).toBe(true);
  });

  it('la última versión de un artículo y una idea sustituye a la anterior y puede reencolarse', () => {
    const d = datos(); const vieja = articulo(1), nueva = { ...articulo(1), id: 'registro:otra-entrada:2:20', texto: 'Resultado actualizado', dato: { ...articulo(1).dato!, estado: 'excluido' } } as EventoVisualLab;
    const idea: EventoVisualLab = { ...evento('idea-1', 'idea', 'r3', ['Analogía']), dato: { tipo: 'idea', hipotesisId: 'h', titulo: 'Título viejo', enfoque: 'analogia' } };
    const revisada: EventoVisualLab = { ...idea, id: 'idea-2', dato: { tipo: 'idea', hipotesisId: 'h', titulo: 'Título actualizado', enfoque: 'analogia' } };
    agregar(d, vieja, idea, nueva, revisada);
    const escenas = escenasDeApertura(d); expect(escenas).toContain(nueva); expect(escenas).toContain(revisada);
    expect(escenas).not.toContain(vieja); expect(escenas).not.toContain(idea);
    const cola = new ColaPelicula(); cola.recibir(d.pelicula!.eventos, d.identidad, true); escenas.forEach(e => cola.devolver(e));
    expect(cola.siguiente(() => true)).toBe(nueva); expect(cola.siguiente(() => true)).toBe(revisada);
  });

  it('un análisis ya terminado no revive programando ni ejecutando ni una ejecución anterior', () => {
    const d = datos(); d.activos = ['Programador y Reparador'];
    const fase = (id: string, ejecucionId: string, estado: 'programando' | 'ejecutando' | 'terminado'): EventoVisualLab => ({
      ...evento(id, 'analisis', 'r5', ['Programador y Reparador']), dato: { tipo: 'analisis', ejecucionId, estado, sintetico: true },
    });
    const terminado = fase('ej-actual-terminado', 'ej-actual', 'terminado');
    agregar(d, fase('ej-anterior', 'ej-anterior', 'ejecutando'), fase('ej-actual-code', 'ej-actual', 'programando'), fase('ej-actual-run', 'ej-actual', 'ejecutando'), terminado);
    const escenas = escenasDeApertura(d); expect(escenas).toEqual([terminado]); expect(escenas[0]!.dato).toMatchObject({ estado: 'terminado', sintetico: true });
  });

  it('la comparación reglada no recibe jueces inventados aunque un estado malformado se los asigne', () => {
    const d = datos(); const reglado: EventoVisualLab = { ...evento('par-reglado', 'torneo', 'r4', ['Juez del torneo']),
      dato: { tipo: 'torneo', hipotesisAId: 'a', hipotesisBId: 'b', tituloA: 'A', tituloB: 'B', estado: 'a', porRegla: true } };
    agregar(d, reglado, evento('estatico-real', 'evidencia', 'r2', [], 'Veredicto por regla'));
    expect(escenasDeApertura(d)).toEqual([]);
  });

  it('una corrección con el mismo ID gana y los repetidos idénticos no producen escenas duplicadas', () => {
    const d = datos(); const a = articulo(1); const corregido = { ...a, texto: 'Corrección real' };
    agregar(d, a, a, corregido, corregido); expect(escenasDeApertura(d)).toEqual([corregido]);
  });

  it.each(['pausada', 'pausada_por_presupuesto', 'terminada', 'detenida'] as const)('no reproduce resultados antiguos al abrir una corrida %s', estado => {
    const d = datos(); d.estado = estado; d.trabajando = false; agregar(d, articulo(1)); expect(escenasDeApertura(d)).toEqual([]);
  });
  it.each(['pausada', 'pausada_por_presupuesto', 'terminada', 'detenida', 'esperando_plan', 'esperando_modelo', 'esperando_aprobacion'] as const)('estado %s bloquea una foto antigua aunque trabajando sea true', estado => {
    const d = datos(); d.estado = estado; d.trabajando = true; agregar(d, articulo(1)); expect(escenasDeApertura(d)).toEqual([]);
  });
  it.each(['sin_conexion', 'conectando', 'muestra'] as const)('la conexión %s nunca estrena una película real', conexion => {
    const d = datos(); d.conexion = conexion; agregar(d, articulo(1)); expect(escenasDeApertura(d)).toEqual([]);
  });
  it('una iteración pasada y una identidad incompleta no se escenifican como trabajo actual', () => {
    const d = datos(); agregar(d, articulo(1));
    expect(escenasDeApertura({ ...d, pasada: true })).toEqual([]);
    expect(escenasDeApertura({ ...d, iteracion: null })).toEqual([]);
    for (const identidad of ['', 'sin-iteracion', 'corrida/', '/iteracion', 'run/it/extra']) expect(escenasDeApertura({ ...d, identidad })).toEqual([]);
  });
  it('los agregados que nombran explícitamente otra iteración se rechazan', () => {
    const d = datos(); d.activos = ['Juez']; d.juez.hechas = 10;
    agregar(d, evento('verificacion:it-anterior', 'revision', 'r2', ['Juez'], '10 verificadas'), evento('plan:it-anterior', 'plan', 'plan', ['Planificador']));
    expect(escenasDeApertura(d)).toEqual([]);
  });
  it('sin eventos ni listas no fabrica planes, actores, hipótesis o resultados', () => {
    const d = datos(); d.pasos.lista = []; d.activos = ['Killer']; expect(escenasDeApertura(d)).toEqual([]);
  });
  it.each([null, undefined, {}, { trabajando: true, conexion: 'en_linea', pelicula: { eventos: null } }])('el estado parcial %# queda vacío sin lanzar', mal => {
    expect(escenasDeApertura(mal as unknown as DatosLab)).toEqual([]);
  });
  it('un lote malformado no genera asociaciones ni personajes sin identidad', () => {
    const d = datos(); d.pelicula!.eventos = [null, {}, { ...articulo(1), agentes: 'Juez' }, { ...articulo(2), sala: 'otro' },
      { ...articulo(3), texto: 42 }, { ...articulo(4), id: '' }, { ...articulo(5), dato: { tipo: 'idea' } }] as unknown as EventoVisualLab[];
    expect(escenasDeApertura(d)).toEqual([]);
  });
});
