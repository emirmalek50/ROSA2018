import { describe, expect, it } from 'vitest';
import type { EstadoRosa, Hipotesis } from '../datos/tipos';
import { estadoDeMuestra } from '../datos/muestra';
import casos from './desbloqueo.casos.json';
import { clasificar, esViva, INGREDIENTES, plan, plano, REGLA_SUPUESTOS, supuestosFlojos, tablero, VIAS, vigencia, vigenciaEnLlano, type IdIngrediente } from './desbloqueo';
import { reevaluarSupuestos } from '../datos/acciones';

type Nodo = { id?: string; texto?: string; estado?: string; evidencia?: string; hijos?: Nodo[] };

function hip(id: string, supuestos: Nodo[], extra: Partial<Hipotesis> = {}): Hipotesis {
  return { id, investigacionId: 'inv', titulo: `Hipótesis ${id}`, estado: 'propuesta', supuestos, ...extra } as unknown as Hipotesis;
}

const sin = (texto: string, id = texto.slice(0, 12)): Nodo => ({ id, texto, estado: 'sin_evidencia', evidencia: 'ninguna', hijos: [] });

describe('la clasificación frente a la lectura hecha a mano', () => {
  // Los 164 supuestos flojos de la base del 23 de septiembre de 2026, cada uno
  // con la etiqueta (o las dos, cuando pide de verdad dos cosas) que le puso
  // una persona leyéndolo. Si una regla nueva baja de aquí, se ve.
  const lista = casos as { texto: string; validos: string[]; estado: string }[];

  it('coincide en al menos 162 de 164', () => {
    const bien = lista.filter((c) => {
      const r = clasificar(c.texto);
      return r.ingrediente !== null && c.validos.includes(r.ingrediente);
    });
    expect(lista).toHaveLength(164);
    expect(bien.length).toBeGreaterThanOrEqual(162);
  });

  it('no se equivoca en ninguno: lo que no reconoce sale sin clasificar, no en otro sitio', () => {
    const errados = lista.filter((c) => {
      const r = clasificar(c.texto);
      return r.ingrediente !== null && !c.validos.includes(r.ingrediente);
    });
    expect(errados.map((c) => c.texto)).toEqual([]);
  });

  it('las etiquetas del conjunto son ingredientes que existen', () => {
    const ids = new Set(INGREDIENTES.map((i) => i.id as string));
    for (const c of lista) for (const v of c.validos) expect(ids.has(v)).toBe(true);
  });
});

describe('clasificar', () => {
  it('devuelve la frase exacta del original, con sus tildes, como motivo', () => {
    const texto = 'Existe un intervalo de referencia de P-tau181 plasmático en personas amiloide-negativas.';
    expect(clasificar(texto)).toEqual({ ingrediente: 'referencia', motivo: 'intervalo de referencia', posicion: texto.indexOf('intervalo') });
    const m = clasificar('La variabilidad analítica intraindividuo no domina la señal.');
    expect(m.ingrediente).toBe('medida');
    expect(m.motivo).toBe('variabilidad analítica');
  });

  it('"ensayo" de laboratorio no es un ensayo clínico', () => {
    expect(clasificar('Es posible definir un límite de referencia específico del ensayo para GFAP.').ingrediente).toBe('referencia');
    expect(clasificar('La variabilidad analítica de ambos ensayos es pequeña.').ingrediente).toBe('medida');
    expect(clasificar('Los ensayos citados publican GFAP frente a placebo.').ingrediente).toBe('ensayos');
  });

  it('lo que el supuesto solo menciona no gana a lo que pide', () => {
    // Nombra el estado amiloide como término de comparación, no lo pide.
    expect(clasificar('El cociente aporta información pronóstica adicional a la del propio estado amiloide basal.').ingrediente).toBe('investigar');
    // Lo pide: que esté documentado.
    expect(clasificar('La positividad amiloide basal está documentada con fecha y método.').ingrediente).toBe('amiloide');
    // "Cruce del umbral" es la fecha del cambio, no un intervalo de referencia.
    expect(clasificar('El primer cruce del umbral no es un artefacto de variabilidad analítica.').ingrediente).toBe('medida');
    // "Dentro del intervalo de referencia" describe un resultado; no pide el intervalo.
    expect(clasificar('Esos ensayos publican la proporción que queda dentro del intervalo de referencia.').ingrediente).toBe('ensayos');
  });

  it('la posición señala la frase que casó, no la primera vez que sale esa palabra', () => {
    const texto = 'El primer cruce del umbral es estable y el umbral se fija en una referencia externa.';
    const r = clasificar(texto);
    expect(r.ingrediente).toBe('referencia');
    expect(r.posicion).toBe(texto.indexOf('umbral se fija'));
    expect(texto.slice(r.posicion!, r.posicion! + r.motivo!.length)).toBe('umbral');
  });

  it('sin regla que case, sin clasificar, y un texto vacío o raro no rompe', () => {
    expect(clasificar('Lo que vale en PSEN1 vale en el esporádico.')).toEqual({ ingrediente: null, motivo: null, posicion: null });
    expect(clasificar('')).toEqual({ ingrediente: null, motivo: null, posicion: null });
    expect(clasificar(undefined as unknown as string)).toEqual({ ingrediente: null, motivo: null, posicion: null });
  });

  it('no distingue mayúsculas ni tildes', () => {
    expect(clasificar('EXISTE UN NÚMERO SUFICIENTE DE PORTADORES').ingrediente).toBe('subcohorte');
    expect(clasificar('existe un numero suficiente de portadores').ingrediente).toBe('subcohorte');
  });
});

describe('plano', () => {
  it('quita las tildes y conserva la longitud, para que las posiciones sirvan en el original', () => {
    const original = 'Función renal, ε4 y ñandú';
    expect(plano(original)).toBe('Funcion renal, ε4 y nandu');
    expect(plano(original)).toHaveLength(original.normalize('NFC').length);
  });

  it('un texto en forma descompuesta queda igual de largo que su forma compuesta', () => {
    const descompuesto = 'Función';
    expect(plano(descompuesto)).toBe('Funcion');
    expect(plano(descompuesto)).toHaveLength(descompuesto.normalize('NFC').length);
  });
});

describe('supuestosFlojos', () => {
  it('recorre el árbol entero y se queda con los sin evidencia y los contradichos', () => {
    const h = hip('h', [
      { id: 'a', texto: 'Respaldado.', estado: 'respaldado', hijos: [sin('Existe un intervalo de referencia independiente.', 'a1')] },
      { id: 'b', texto: 'La tau puede propagarse sin amiloide.', estado: 'contradicho', hijos: [] },
      { id: 'c', texto: 'Plausible.', estado: 'plausible', hijos: [] },
    ]);
    const f = supuestosFlojos(h);
    expect(f.map((s) => [s.id, s.estado, s.ingrediente])).toEqual([
      ['a1', 'sin_evidencia', 'referencia'],
      ['b', 'contradicho', null],
    ]);
    expect(f.every((s) => s.hipotesisId === 'h')).toBe(true);
  });

  it('un árbol roto o con un ciclo no cuelga ni rompe', () => {
    const ciclo: Nodo = { id: 'x', texto: 'Hay suficientes portadores.', estado: 'sin_evidencia', hijos: [] };
    ciclo.hijos = [ciclo];
    const f = supuestosFlojos(hip('h', [ciclo, null as unknown as Nodo, 3 as unknown as Nodo, { estado: 'sin_evidencia' }]));
    expect(f.length).toBeGreaterThan(0);
    expect(f.length).toBeLessThanOrEqual(13);
    expect(supuestosFlojos({ id: 'z' } as unknown as Hipotesis)).toEqual([]);
    expect(supuestosFlojos(hip('z', 'texto' as unknown as Nodo[]))).toEqual([]);
  });
});

describe('esViva', () => {
  it('ni descartada ni fundida en otra', () => {
    expect(esViva(hip('a', []))).toBe(true);
    expect(esViva(hip('b', [], { estado: 'descartada' }))).toBe(false);
    expect(esViva(hip('c', [], { fusionadaEn: 'a' }))).toBe(false);
  });
});

describe('tablero', () => {
  const hs = [
    hip('h1', [sin('Existe un intervalo de referencia independiente.'), sin('Los ensayos citados publican GFAP frente a placebo.'), sin('Lo que vale en PSEN1 vale en el esporádico.')]),
    hip('h2', [sin('Existe otro intervalo de referencia externo.'), { id: 'c', texto: 'Contradicho.', estado: 'contradicho', hijos: [] }]),
    hip('h3', [sin('El GFAP en plasma refleja astrogliosis.')], { estado: 'descartada' }),
  ];

  it('cuenta pendientes, contradichos y sin clasificar solo de las vivas', () => {
    const t = tablero(hs);
    expect(t.filas.map((f) => f.hipotesis.id)).toEqual(['h1', 'h2']);
    expect(t.pendientes).toBe(4);
    expect(t.contradichos).toBe(1);
    expect(t.sinClasificar.map((s) => s.texto)).toEqual(['Lo que vale en PSEN1 vale en el esporádico.']);
  });

  it('ordena por hipótesis tocadas y, a igualdad, por supuestos; y no lista lo que no pide nadie', () => {
    const t = tablero(hs);
    expect(t.ingredientes.map((f) => [f.ingrediente.id, f.hipotesis.length, f.supuestos])).toEqual([
      ['referencia', 2, 2],
      ['ensayos', 1, 1],
    ]);
  });

  it('cada fila dice qué ingredientes piden sus pendientes', () => {
    const t = tablero(hs);
    expect(t.filas[0]!.necesita).toEqual(['ensayos', 'referencia']);
    expect(t.filas[1]!.necesita).toEqual(['referencia']);
    expect(t.filas[1]!.contradichos).toHaveLength(1);
  });
});

describe('plan', () => {
  it('elige primero lo que acaba liberando hipótesis, no lo que más supuestos abre', () => {
    const hs = [
      // Se libera con tres ingredientes que abren pocos supuestos.
      hip('lib', [sin('Hay suficientes portadores.'), sin('La cadencia de extracciones basta.'), sin('La brecha es identificable.')]),
      // Nunca se libera (biología sin medir), pero abre muchos supuestos de ensayos.
      hip('no', [sin('Los ensayos citados publican A.'), sin('Los ensayos citados publican B.'), sin('Los ensayos citados publican C.'), sin('Los ensayos citados publican D.'), sin('El GFAP refleja astrogliosis.')]),
    ];
    const pasos = plan(tablero(hs));
    expect(pasos.slice(0, 3).map((p) => p.ingrediente).sort()).toEqual(['estimable', 'seriado', 'subcohorte']);
    expect(pasos[2]!.libres).toEqual(['lib']);
    expect(pasos.map((p) => p.ingrediente)).toContain('ensayos');
    expect(pasos.map((p) => p.ingrediente)).not.toContain('investigar');
    expect(pasos[pasos.length - 1]!.libresAcumuladas).toEqual(['lib']);
  });

  it('lleva la cuenta acumulada de supuestos y para cuando nada suma', () => {
    const hs = [hip('a', [sin('Existe un intervalo de referencia independiente.'), sin('Hay suficientes portadores.')])];
    const pasos = plan(tablero(hs));
    expect(pasos.map((p) => p.acumulados)).toEqual([1, 2]);
    expect(pasos[1]!.libres).toEqual(['a']);
  });

  it('una hipótesis con un supuesto sin clasificar nunca queda libre', () => {
    const hs = [hip('a', [sin('Existe un intervalo de referencia independiente.'), sin('Lo que vale en PSEN1 vale en el esporádico.')])];
    const pasos = plan(tablero(hs));
    expect(pasos).toHaveLength(1);
    expect(pasos[0]!.libresAcumuladas).toEqual([]);
  });

  it('sin nada pedible, no hay plan', () => {
    expect(plan(tablero([hip('a', [sin('El GFAP refleja astrogliosis.')])]))).toEqual([]);
    expect(plan(tablero([]))).toEqual([]);
  });
});

describe('el catálogo', () => {
  it('cada ingrediente tiene una vía que existe, y todo texto lleva sus tildes y ningún guion largo', () => {
    const vias = new Set(VIAS.map((v) => v.id));
    for (const i of INGREDIENTES) {
      expect(vias.has(i.via)).toBe(true);
      for (const texto of [i.nombre, i.que, i.donde]) expect(texto).not.toContain('\u2014');
    }
    expect(INGREDIENTES.find((i) => i.id === 'subcohorte')!.donde).toContain('acceso controlado');
  });

  it('solo la biología sin medir va por investigación nueva', () => {
    expect(INGREDIENTES.filter((i) => i.via === 'investigacion').map((i) => i.id)).toEqual(['investigar' as IdIngrediente]);
  });
});

describe('sobre los datos de muestra', () => {
  it('no lanza, deja fuera la descartada y libera la que se puede liberar', () => {
    const e = estadoDeMuestra();
    const t = tablero(e.hipotesis);
    expect(t.filas.some((f) => f.hipotesis.estado === 'descartada')).toBe(false);
    expect(t.pendientes).toBeGreaterThan(0);
    const pasos = plan(t);
    expect(pasos.length).toBeGreaterThan(0);
    expect(pasos[pasos.length - 1]!.libresAcumuladas).toContain('hip-4');
  });
});

describe('vigencia de los supuestos (la regla de rosa/vigencia.py, uno a uno)', () => {
  const sello = (extra: Record<string, unknown> = {}) => ({ en: 1000, regla: REGLA_SUPUESTOS, afirmaciones: 2, fallidos: 0, pedidaEn: null, noAtendida: null, reconstruido: false, ...extra });
  const conSello = (s: unknown, afirmaciones = 2, supuestos: Nodo[] = [sin('Existe un intervalo de referencia independiente.')]) =>
    ({ ...hip('h', supuestos), afirmaciones: Array.from({ length: afirmaciones }, (_, i) => ({ texto: `a${i}` })), supuestosEvaluados: s }) as unknown as Hipotesis;

  it('dice por qué no está al día, y sin supuestos no hay nada que reevaluar', () => {
    expect(vigencia(conSello(null)).motivo).toBe('sin_sello');
    expect(vigencia(conSello(sello())).alDia).toBe(true);
    expect(vigencia(conSello(sello({ regla: 1 }))).motivo).toBe('regla');
    expect(vigencia(conSello(sello({ fallidos: 2 }))).motivo).toBe('fallidos');
    const nueva = vigencia(conSello(sello(), 4));
    expect([nueva.motivo, nueva.nuevas]).toEqual(['evidencia', 2]);
    expect(vigencia(conSello(null, 2, [])).alDia).toBe(true);
    expect(vigencia(conSello({ en: null, regla: 0, pedidaEn: 5 })).motivo).toBe('sin_sello');
    // Formas raras: no rompen.
    for (const raro of ['x', { en: 1, regla: '2' }, { en: 1, regla: 2.5 }]) vigencia(conSello(raro));
  });

  it('lleva la petición y el motivo de la última que no se pudo hacer', () => {
    const v = vigencia(conSello(sello({ regla: 1, pedidaEn: 77, noAtendida: null })));
    expect([v.pedidaEn, v.noAtendida]).toEqual([77, null]);
    expect(vigencia(conSello(sello({ regla: 1, noAtendida: 'La corrida 3 no tiene presupuesto.' }))).noAtendida).toContain('presupuesto');
    expect(vigenciaEnLlano(vigencia(conSello(sello({ regla: 1 }))))).toContain('18 de septiembre');
    expect(vigenciaEnLlano(vigencia(conSello(sello(), 3)))).toBe('Le llegó 1 afirmación después de evaluar sus supuestos.');
  });

  it('el tablero cuenta lo que está por reevaluar', () => {
    const t = tablero([
      conSello(sello()),
      { ...conSello(sello({ regla: 1 })), id: 'vieja' } as Hipotesis,
      { ...conSello(sello({ regla: 1 }), 2, []), id: 'sin_supuestos' } as Hipotesis,
    ]);
    expect(t.porReevaluar.map((f) => f.hipotesis.id)).toEqual(['vieja']);
    expect(t.flojosPorReevaluar).toBe(1);
  });

  it('el reductor pide solo lo que no está al día, en su alcance, y no repite lo ya pedido', () => {
    const base = { hipotesis: [] as Hipotesis[], eventos: [] } as unknown as EstadoRosa;
    const vieja = { ...conSello(sello({ regla: 1 })), id: 'vieja', investigacionId: 'inv', procedencia: { mensajes: [] } } as unknown as Hipotesis;
    const otra = { ...vieja, id: 'otra', investigacionId: 'inv-2' } as Hipotesis;
    const al = { ...conSello(sello()), id: 'al', investigacionId: 'inv', procedencia: { mensajes: [] } } as unknown as Hipotesis;
    const e1 = reevaluarSupuestos({ ...base, hipotesis: [vieja, otra, al] }, 'inv', 500);
    const pedida = (e: EstadoRosa, id: string) => e.hipotesis.find((h) => h.id === id)!.supuestosEvaluados?.pedidaEn ?? null;
    expect([pedida(e1, 'vieja'), pedida(e1, 'otra'), pedida(e1, 'al')]).toEqual([500, null, null]);
    expect(e1.eventos.map((ev) => ev.texto)).toEqual(['Reevaluación de supuestos pedida para 1 hipótesis cuyos supuestos no estaban al día.']);
    const e2 = reevaluarSupuestos(e1, null, 900);
    expect([pedida(e2, 'vieja'), pedida(e2, 'otra')]).toEqual([500, 900]);
  });
});
