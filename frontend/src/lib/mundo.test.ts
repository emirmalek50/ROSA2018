import { describe, expect, it } from 'vitest';
import type { EntidadCanonica, HechoMundo, PreguntaABases } from '../datos/tipos';
import { SIN_TEMA, analizarLinea, analizarTexto, conversaciones, cuentaEstado, esLineaDeFuente, filtrarHechos, hiloDe, inicialFuente, nuevoHilo, rastro, recortar, referenciasDe, resumenBusqueda, sugerencias, temasDeHechos, textoPlano, unirLista, veredictoAtribucion } from './mundo';

const ent = (id: string, etiqueta: string, tipo = 'gen', alias: string[] = []): EntidadCanonica => ({ id, etiqueta, ontologia: id.split(':')[0]!, tipo, alias });

let n = 0;
function hecho(enunciado: string, entidades: EntidadCanonica[], extra: Partial<HechoMundo> = {}): HechoMundo {
  n++;
  return { id: `he-x${n}-1`, investigacionId: 'inv', tipo: 'hecho', tema: 't', enunciado, entidades, estado: 'sabido', origen: 'fuente', procedencia: [], motivoDescarte: null, actualizadoEn: n, prioridad: 3, citas: [], historial: [], ...extra };
}

const GFAP = ent('HGNC:4235', 'GFAP', 'gen', ['FLJ45472']);
const ECSCR = ent('HGNC:35454', 'ECSCR', 'gen', ['ARIA', 'ECSM2']);
const LCR = ent('UBERON:0001359', 'cerebrospinal fluid', 'tejido', ['LCR']);
const TAU = ent('HGNC:6893', 'MAPT (tau)', 'gen', ['MAPT']);

describe('los temas del modelo de mundo', () => {
  const hechos = [
    hecho('GFAP plasmático sube antes que NfL.', [GFAP, LCR]),
    hecho('GFAP en LCR no distingue.', [GFAP, LCR], { estado: 'abierto', tipo: 'pregunta' }),
    hecho('La tau fosforilada sube.', [TAU]),
    hecho('ARIA aparece en el 12 % de los tratados con lecanemab.', [ECSCR]),
    hecho('ARIA-E fue más frecuente en portadores de APOE4.', [ECSCR], { estado: 'descartado' }),
    hecho('Un hecho sin entidades.', []),
  ];
  const temas = temasDeHechos(hechos);

  it('ordena los estantes por número de hechos y cuenta cada estado', () => {
    expect(temas.estantes.map((e) => e.nombre)).toEqual(['GFAP', 'Líquido cefalorraquídeo', 'Tau (MAPT)']);
    expect(temas.estantes[0]!.recuento).toEqual({ sabido: 1, abierto: 1, descartado: 0 });
    expect(temas.estantes[1]!.clase).toBe('fluido');
    expect(temas.estantes[1]!.original).toBe('cerebrospinal fluid');
    expect(temas.estantes[0]!.original).toBeNull();
  });

  it('aparta el gen que solo casó por una sigla (ARIA no es ECSCR) y dice cuál', () => {
    expect(temas.dudosos).toEqual([{ entidad: ECSCR, sigla: 'ARIA', total: 2 }]);
    // Los hechos que solo tenían la entidad dudosa cuentan como sin tema.
    expect(temas.sinTema).toBe(3);
    const dudosos = new Set(temas.dudosos.map((d) => d.entidad.id));
    expect(filtrarHechos(hechos, { texto: '', estado: 'todos', origen: 'todos', tema: SIN_TEMA, dudosos }).length).toBe(3);
  });

  it('un gen nombrado por lo que lleva entre paréntesis no es dudoso', () => {
    expect(temas.dudosos.some((d) => d.entidad.id === TAU.id)).toBe(false);
  });

  it('una sigla que es el símbolo sin número (BACE) o un nombre largo con cifras (CD146) no es dudosa; HD por HTT sí', () => {
    const BACE1 = ent('HGNC:933', 'BACE1', 'gen', ['BACE']);
    const MCAM = ent('HGNC:6934', 'MCAM', 'gen', ['CD146']);
    const HTT = ent('HGNC:4851', 'HTT', 'gen', ['HD']);
    const t = temasDeHechos([hecho('Los inhibidores de BACE fallaron.', [BACE1]), hecho('CD146 marca el endotelio.', [MCAM]), hecho('En HD el patrón es otro.', [HTT])]);
    expect(t.dudosos.map((d) => d.entidad.etiqueta)).toEqual(['HTT']);
  });

  it('registros raros no tumban el cálculo', () => {
    const raro = hecho('x', [null as unknown as EntidadCanonica, { id: 'GO:1' } as EntidadCanonica]);
    const t = temasDeHechos([raro, { ...raro, entidades: undefined }]);
    expect(t.estantes.length).toBe(1);
    expect(t.sinTema).toBe(1);
  });

  it('filtra por estado, origen, tema y texto (también por alias y por id)', () => {
    const f = (x: Partial<Parameters<typeof filtrarHechos>[1]>) => filtrarHechos(hechos, { texto: '', estado: 'todos', origen: 'todos', tema: null, ...x }).length;
    expect(f({ estado: 'abierto' })).toBe(1);
    expect(f({ tema: GFAP.id })).toBe(2);
    expect(f({ tema: GFAP.id, estado: 'sabido' })).toBe(1);
    expect(f({ texto: 'hgnc:4235' })).toBe(2);
    expect(f({ texto: 'líquido' })).toBe(2);
    expect(f({ origen: 'inferencia' })).toBe(0);
  });

  it('las cuentas van en singular cuando es uno', () => {
    expect(cuentaEstado('abierto', 1)).toBe('1 abierto');
    expect(cuentaEstado('abierto', 3)).toBe('3 abiertos');
  });

  it('las sugerencias salen de lo que hay y no inventan lo que falta', () => {
    const s = sugerencias(hechos, temas);
    expect(s[0]).toEqual({ icono: 'tema', pregunta: '¿Qué se sabe de GFAP?', nota: '2 hechos' });
    expect(s.map((x) => x.icono)).toEqual(['tema', 'pregunta', 'descarte', 'tema']);
    expect(s.some((x) => x.icono === 'contraste')).toBe(false);
    expect(sugerencias([], temasDeHechos([]))).toEqual([]);
  });
});

describe('las conversaciones', () => {
  const q = (id: string, fecha: number, pregunta: string, hilo?: string): PreguntaABases => ({ id, fecha, pregunta, respuesta: 'r', limites: '', herramientas: [], consultas: [], iteraciones: 1, quien: 'x', error: null, ...(hilo ? { hilo } : {}) });

  it('agrupa por hilo, y una pregunta de antes de los hilos es su propio hilo', () => {
    const cs = conversaciones([q('pb-1', 1, 'Vieja'), q('pb-2', 5, '¿Y GFAP?', 'c-a'), q('pb-3', 3, '¿Qué sabe?', 'c-a'), q('pb-4', 7, 'Sigue la vieja', 'pb-1')]);
    expect(cs.map((c) => [c.hilo, c.titulo, c.turnos.length])).toEqual([
      ['pb-1', 'Vieja', 2],
      ['c-a', '¿Qué sabe?', 2],
    ]);
    expect(hiloDe(q('pb-9', 1, 'x'))).toBe('pb-9');
  });

  it('el id de hilo nuevo tiene la forma que acepta el servidor', () => {
    expect(nuevoHilo()).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it('el rastro resume las herramientas en el orden en que se usaron, con la fuente de las consultas', () => {
    const r = rastro({ herramientas: ['leer_modelo_de_mundo', 'buscar_en_proyecto', 'exa_publicaciones', 'exa_publicaciones', 'otra_cosa'], consultas: [{ herramienta: 'exa_publicaciones', fuente: 'Exa (índice de publicaciones)' } as PreguntaABases['consultas'][number]] });
    expect(r).toEqual(['leyó el modelo de mundo', 'buscó en el proyecto', '2 búsquedas en Exa (índice de publicaciones)', '1 búsqueda en otra cosa']);
    expect(unirLista(r.slice(0, 3))).toBe('leyó el modelo de mundo, buscó en el proyecto y 2 búsquedas en Exa (índice de publicaciones)');
    expect(rastro({ herramientas: undefined as unknown as string[], consultas: undefined as unknown as [] })).toEqual([]);
  });

  it('recorta por palabra', () => {
    expect(recortar('una frase bastante larga para recortar', 20)).toBe('una frase bastante...');
    expect(recortar('corta', 20)).toBe('corta');
  });
});

describe('el texto de la respuesta', () => {
  const RESPUESTA = [
    '**p-tau217 es un candidato, pero no un sustituto validado.** Es decir: no basta.',
    '',
    '### Qué muestran las fuentes',
    '',
    '- **Donanemab:** bajó desde la semana 12 (r = 0,484).  ',
    '  **Fuente:** `exa_publicaciones`, Pontecorvo et al., 2022. DOI `10.1001/jamaneurol.2022.3392`.',
    '',
    '- **Semaglutida:** registros `NCT04777396` y NCT04777409.',
    '',
    'La memoria lo recoge en el hecho `he-mu44icl1-9037`, PMID 12345678 y doi 10.1000/xyz123.',
    '1. primero',
    '2. segundo *con cursiva*',
  ].join('\n');
  const bloques = analizarTexto(RESPUESTA, new Set(['exa_publicaciones']));

  it('lee párrafos, títulos y listas con sus líneas de continuación', () => {
    expect(bloques.map((b) => b.tipo)).toEqual(['parrafo', 'titulo', 'lista', 'parrafo', 'lista']);
    const lista = bloques[2] as Extract<(typeof bloques)[number], { tipo: 'lista' }>;
    expect(lista.items.length).toBe(2);
    expect(lista.items[0]!.lineas.length).toBe(2);
    expect(esLineaDeFuente(lista.items[0]!.lineas[1]!)).toBe(true);
    expect(esLineaDeFuente(lista.items[0]!.lineas[0]!)).toBe(false);
    expect((bloques[4] as { ordenada: boolean }).ordenada).toBe(true);
  });

  it('reconoce DOIs, ensayos, PMIDs, hechos y herramientas, sin comerse el punto final', () => {
    expect(referenciasDe(bloques)).toEqual({ dois: ['10.1001/jamaneurol.2022.3392', '10.1000/xyz123'], ensayos: ['NCT04777396', 'NCT04777409'], pmids: ['12345678'], hechos: ['he-mu44icl1-9037'] });
    const fuente = (bloques[2] as { items: { lineas: ReturnType<typeof analizarLinea>[] }[] }).items[0]!.lineas[1]!;
    expect(fuente.some((t) => t.tipo === 'herramienta' && t.nombre === 'exa_publicaciones')).toBe(true);
  });

  it('un asterisco suelto o una negrita sin cerrar se quedan como texto', () => {
    expect(textoPlano(analizarLinea('3 * 4 = 12 y **sin cerrar'))).toBe('3 * 4 = 12 y **sin cerrar');
    expect(analizarLinea('a **b** c').map((t) => t.tipo)).toEqual(['texto', 'negrita', 'texto']);
    expect(analizarLinea('a *b* c').map((t) => t.tipo)).toEqual(['texto', 'cursiva', 'texto']);
  });

  it('el texto vacío o raro no rompe', () => {
    expect(analizarTexto('')).toEqual([]);
    expect(analizarTexto(undefined as unknown as string)).toEqual([]);
    expect(analizarTexto('<script>alert(1)</script>')[0]).toEqual({ tipo: 'parrafo', lineas: [[{ tipo: 'texto', texto: '<script>alert(1)</script>' }]] });
  });
});

describe('la cabecera y el pie de una respuesta', () => {
  const consulta = (herramienta: string, fuente: string, ids: string[], error: string | null = null) => ({ id: `c-${herramienta}-${ids.join('')}`, herramienta, fuente, argumentos: {}, fecha: 1, n: ids.length, ids, version: null, invariante: null, error, ms: 10, resumen: '' });

  it('cuenta las búsquedas, los documentos distintos sin los fallidos, los segundos y las fuentes en orden', () => {
    const r = resumenBusqueda({
      herramientas: ['leer_modelo_de_mundo', 'buscar_pubmed', 'buscar_pubmed', 'buscar_ensayos'],
      consultas: [consulta('buscar_pubmed', 'PubMed', ['1', '2']), consulta('buscar_pubmed', 'PubMed', ['2', '3']), consulta('buscar_ensayos', 'ClinicalTrials.gov', ['NCT1'], 'No pude comprobar: 503')],
      duracionMs: 18_600,
    });
    expect(r).toEqual({ busquedas: 4, documentos: 3, segundos: 19, fuentes: ['modelo de mundo', 'PubMed', 'ClinicalTrials.gov'] });
  });

  it('una respuesta de antes, sin duración ni herramientas, no inventa segundos', () => {
    const r = resumenBusqueda({ herramientas: [], consultas: [consulta('buscar_pubmed', 'PubMed', [])] });
    expect(r.segundos).toBeNull();
    expect(r.busquedas).toBe(1);
    expect(r.documentos).toBe(0);
    expect(r.fuentes).toEqual(['PubMed']);
  });

  it('la inicial de una fuente salta los artículos', () => {
    expect(inicialFuente('Europe PMC')).toBe('E');
    expect(inicialFuente('el proyecto')).toBe('P');
    expect(inicialFuente('modelo de mundo')).toBe('M');
  });

  it('abstenerse sin citar está bien; afirmar sin citar, no', () => {
    const no = { estado: 'no_esta' as const, parte: 'p', nota: '' };
    expect(veredictoAtribucion({ atribucion: { citadas: [], sinRespaldo: [] }, cobertura: [no] })?.tono).toBe('bien');
    expect(veredictoAtribucion({ atribucion: { citadas: [], sinRespaldo: [] }, cobertura: [no] })?.texto).toContain('nada que atribuir');
    expect(veredictoAtribucion({ atribucion: { citadas: [], sinRespaldo: [] }, cobertura: [{ ...no, estado: 'respondido' }] })?.tono).toBe('aviso');
    expect(veredictoAtribucion({ atribucion: { citadas: [], sinRespaldo: [] } })?.tono).toBe('neutro');
  });

  it('una referencia que ninguna búsqueda devolvió se nombra; sin atribución guardada no hay pie', () => {
    const v = veredictoAtribucion({ atribucion: { citadas: ['PMID 1', '10.1/x', 'NCT01234567'], sinRespaldo: ['NCT01234567'] } })!;
    expect(v.tono).toBe('aviso');
    expect(v.texto).toContain('1 de 3');
    expect(v.sinRespaldo).toEqual(['NCT01234567']);
    expect(veredictoAtribucion({ atribucion: { citadas: ['PMID 1'], sinRespaldo: ['PMID 1'] } })!.texto).toContain('La referencia que cita no sale');
    expect(veredictoAtribucion({ atribucion: { citadas: ['PMID 1', '10.1/x'], sinRespaldo: [] } })!.tono).toBe('bien');
    expect(veredictoAtribucion({})).toBeNull();
  });
});
