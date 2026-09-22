import { describe, expect, it } from 'vitest';
import type { Hipotesis } from '../datos/tipos';
import type { NodoCascada, Capa } from './mecanismos';
import {
  amenazasDe,
  actoresDe,
  cascada,
  desvioDeArco,
  idBase,
  intensidad,
  nombreDeSupuesto,
  recuentoAristas,
  recuentoVeredictos,
  posicionesCascada,
  supuestosAgregados,
  veredictoPorRegla,
} from './mecanismos';

type Nodo = { id: string; etiqueta: string; rol: string; capa?: string };
type Arista = { de: string; a: string; tipo: string; contexto: string };

function hip(id: string, grafo: { nodos?: Nodo[]; aristas?: Arista[]; identificacion?: string; cumplidos?: string[]; faltantes?: string[] } | null): Hipotesis {
  return {
    id,
    grafoCausal: grafo
      ? {
          nodos: grafo.nodos ?? [],
          aristas: grafo.aristas ?? [],
          identificacion: grafo.identificacion ?? 'acotado',
          supuestosCumplidos: grafo.cumplidos ?? [],
          supuestosFaltantes: grafo.faltantes ?? [],
          resumen: '',
          calculadoEn: 0,
        }
      : null,
  } as unknown as Hipotesis;
}

const BASE = (id: string, capa?: string): Nodo => ({ id: `B:${id}`, etiqueta: id, rol: 'base', ...(capa ? { capa } : {}) });

describe('la cascada del campo', () => {
  it('junta el mismo nodo aunque un grafo lo escriba con tilde y otro sin ella', () => {
    // Hasta el 22 de septiembre de 2026 `función renal` se usaba CON tilde como
    // identificador, así que los grafos viejos guardaron una forma y los nuevos
    // otra. Sin normalizar, la cascada sale con la misma cosa dos veces.
    const c = cascada([
      hip('h1', { nodos: [{ id: 'B:funcion renal', etiqueta: 'funcion renal', rol: 'base' }] }),
      hip('h2', { nodos: [{ id: 'B:función renal', etiqueta: 'función renal', rol: 'base', capa: 'factores' }] }),
    ]);
    expect(c.nodos).toHaveLength(1);
    expect(c.nodos[0]!.id).toBe('funcion renal');
    expect(c.nodos[0]!.enJuego).toBe(2);
    // Para leer se usa la forma con tilde, aunque el identificador no la lleve.
    expect(c.nodos[0]!.etiqueta).toBe('función renal');
  });

  it('usa la capa que manda el servidor y, si el grafo es viejo y no la trae, la deduce', () => {
    const c = cascada([
      hip('h1', { nodos: [BASE('GFAP', 'marcadores'), { id: 'B:cognicion', etiqueta: 'cognicion', rol: 'base' }] }),
    ]);
    expect(c.nodos.find((n) => n.id === 'GFAP')!.capa).toBe('marcadores');
    expect(c.nodos.find((n) => n.id === 'cognicion')!.capa).toBe('desenlace');
  });

  it('un nodo desconocido no rompe nada: cae en otros', () => {
    const c = cascada([hip('h1', { nodos: [{ id: 'B:lo que sea', etiqueta: 'lo que sea', rol: 'base' }] })]);
    expect(c.nodos[0]!.capa).toBe('otros');
  });

  it('cuenta un grafo una sola vez por nodo aunque lo repita', () => {
    const c = cascada([hip('h1', { nodos: [BASE('tau', 'patologia'), BASE('tau', 'patologia')] })]);
    expect(c.nodos[0]!.enJuego).toBe(1);
    expect(c.total).toBe(1);
  });

  it('solo toma las aristas del consenso, no los supuestos de la hipótesis', () => {
    const c = cascada([
      hip('h1', {
        nodos: [BASE('amiloide', 'patologia'), BASE('GFAP', 'marcadores')],
        aristas: [
          { de: 'B:amiloide', a: 'B:GFAP', tipo: 'base_curada', contexto: 'sube con la carga amiloide' },
          { de: 'X', a: 'Y', tipo: 'supuesto', contexto: 'lo que afirma' },
        ],
      }),
    ]);
    expect(c.aristas).toHaveLength(1);
    expect(c.aristas[0]).toMatchObject({ de: 'amiloide', a: 'GFAP', grafos: 1 });
  });

  it('ordena por el tramo de la enfermedad, no alfabéticamente', () => {
    const c = cascada([
      hip('h1', { nodos: [BASE('cognicion', 'desenlace'), BASE('APOE4', 'factores'), BASE('tau', 'patologia')] }),
    ]);
    expect(c.nodos.map((n) => n.id)).toEqual(['APOE4', 'tau', 'cognicion']);
  });

  it('una hipótesis sin grafo, o con el grafo a medias, se salta sin tumbar la pantalla', () => {
    const c = cascada([
      hip('h1', null),
      { id: 'h2', grafoCausal: { identificacion: 'acotado' } } as unknown as Hipotesis,
      hip('h3', { nodos: [BASE('tau', 'patologia')] }),
    ]);
    expect(c.total).toBe(1);
    expect(c.nodos).toHaveLength(1);
  });
});

describe('los tres tipos de arista', () => {
  it('cuenta cada tipo por separado y deja el de evidencia a cero si lo está', () => {
    // Medido el 22 de septiembre de 2026 sobre la corrida 16: de 294 aristas,
    // 118 supuestos, 176 de consenso y ninguna con evidencia propia. Que salga
    // cero es el dato, no un fallo: por eso se cuenta y se enseña.
    const r = recuentoAristas([
      hip('h1', {
        aristas: [
          { de: 'X', a: 'Y', tipo: 'supuesto', contexto: '' },
          { de: 'A1', a: 'Y', tipo: 'supuesto', contexto: '' },
          { de: 'B:tau', a: 'B:p-tau181', tipo: 'base_curada', contexto: '' },
        ],
      }),
    ]);
    expect(r).toEqual({ supuesto: 2, inferencia_con_evidencia: 0, base_curada: 1, total: 3 });
  });

  it('cuenta la arista con evidencia cuando la hay', () => {
    const r = recuentoAristas([hip('h1', { aristas: [{ de: 'X', a: 'Y', tipo: 'inferencia_con_evidencia', contexto: '' }] })]);
    expect(r.inferencia_con_evidencia).toBe(1);
  });
});

describe('los veredictos de identificación', () => {
  it('cuenta cuántas hay de cada uno', () => {
    const r = recuentoVeredictos([
      hip('h1', { identificacion: 'identificable' }),
      hip('h2', { identificacion: 'acotado' }),
      hip('h3', { identificacion: 'acotado' }),
      hip('h4', { identificacion: 'sin_resolver' }),
    ]);
    expect(r).toEqual({ identificable: 1, acotado: 2, sin_resolver: 1 });
  });
});

describe('los supuestos agregados', () => {
  it('junta el mismo supuesto aunque esté escrito con tilde y sin ella', () => {
    // En los registros de la corrida 16 conviven "Confusión" y "Confusion":
    // agrupar por el texto tal cual daría dos filas para lo mismo.
    const filas = supuestosAgregados([
      hip('h1', { faltantes: ['Confusión: la evidencia no declara ajuste'] }),
      hip('h2', { faltantes: ['Confusion: la evidencia no declara ajuste'] }),
      hip('h3', { cumplidos: ['Temporalidad: hay evidencia longitudinal'] }),
    ]);
    // Las dos formas caen en el mismo supuesto, que hoy se llama así.
    const confusion = filas.find((f) => f.nombre === 'Ajuste por confusores')!;
    expect(confusion.faltan).toBe(2);
    expect(filas.find((f) => f.clave === 'temporalidad')!.cumplen).toBe(1);
  });

  it('ordena por lo que más falta, que es lo accionable', () => {
    const filas = supuestosAgregados([
      hip('h1', { faltantes: ['Replicación: sin cohorte'], cumplidos: ['Temporalidad: sí'] }),
      hip('h2', { faltantes: ['Confusión: no ajusta'] }),
      hip('h3', { faltantes: ['Confusión: no ajusta'] }),
    ]);
    expect(filas[0]!.nombre).toBe('Ajuste por confusores');
    expect(filas[0]!.faltan).toBe(2);
  });

  it('el nombre del supuesto es lo que va antes de los dos puntos', () => {
    expect(nombreDeSupuesto('Temporalidad: hay evidencia longitudinal de precedencia')).toBe('Temporalidad');
    expect(nombreDeSupuesto('   ')).toBe('');
    // Un nombre que no se reconoce se devuelve tal cual, sin inventar.
    expect(nombreDeSupuesto('Lo que sea: con su cola')).toBe('Lo que sea');
  });
});

describe('las amenazas de un grafo', () => {
  it('nombra cada clase en llano y deja fuera lo que no es alternativa', () => {
    const a = amenazasDe({
      nodos: [
        { id: 'X', etiqueta: 'la exposición', rol: 'exposicion' },
        { id: 'A1', etiqueta: 'la edad sube el GFAP sin enfermedad', rol: 'alternativa_confusor' },
        { id: 'A2', etiqueta: 'deriva de lote entre plataformas', rol: 'alternativa_artefacto' },
        { id: 'A3', etiqueta: 'solo llegan los que sobreviven', rol: 'alternativa_seleccion' },
        { id: 'A4', etiqueta: 'quizá Y causa X', rol: 'alternativa_causa_inversa' },
      ],
      aristas: [],
      identificacion: 'acotado',
      supuestosCumplidos: [],
      supuestosFaltantes: [],
      resumen: '',
      calculadoEn: 0,
    });
    expect(a.map((x) => x.clase)).toEqual(['Confusor', 'Artefacto de medida', 'Sesgo de selección', 'Causa inversa']);
  });

  it('sin grafo no hay amenazas y no revienta', () => {
    expect(amenazasDe(null)).toEqual([]);
    expect(amenazasDe(undefined)).toEqual([]);
  });
});

describe('los actores de la hipótesis', () => {
  it('saca la exposición y el desenlace', () => {
    const g = {
      nodos: [
        { id: 'X', etiqueta: 'dosis de APOE e4', rol: 'exposicion' },
        { id: 'Y', etiqueta: 'brecha GFAP-NfL', rol: 'desenlace' },
      ],
      aristas: [],
      identificacion: 'acotado' as const,
      supuestosCumplidos: [],
      supuestosFaltantes: [],
      resumen: '',
      calculadoEn: 0,
    };
    expect(actoresDe(g)).toEqual({ exposicion: 'dosis de APOE e4', desenlace: 'brecha GFAP-NfL' });
    expect(actoresDe(null)).toEqual({ exposicion: '', desenlace: '' });
  });
});

describe('el identificador de un nodo de la base', () => {
  it('quita el prefijo y las tildes, que es lo que identifica', () => {
    expect(idBase('B:función renal')).toBe('funcion renal');
    expect(idBase('B:neurodegeneración')).toBe('neurodegeneracion');
    expect(idBase('B:GFAP')).toBe('GFAP');
    expect(idBase('')).toBe('');
  });
});

describe('los nombres que cambiaron', () => {
  it('junta el supuesto que antes se llamaba distinto según se cumpliera o faltara', () => {
    // Hasta el 22 de septiembre de 2026 el cumplido era "Ajuste" y el faltante
    // "Confusión": el mismo supuesto con dos nombres. Los grafos ya guardados
    // los siguen trayendo, así que la pantalla tiene que juntarlos.
    const filas = supuestosAgregados([
      hip('h1', { cumplidos: ['Ajuste: la evidencia declara estratificación'] }),
      hip('h2', { faltantes: ['Confusión: la evidencia no declara ajuste'] }),
      hip('h3', { faltantes: ['Confusion: la evidencia no declara ajuste'] }),
      hip('h4', { cumplidos: ['Replicación independiente: se vio en dos cohortes'] }),
      hip('h5', { faltantes: ['Replicación: sin cohorte independiente'] }),
    ]);
    expect(filas).toHaveLength(2);
    const ajuste = filas.find((f) => f.nombre === 'Ajuste por confusores')!;
    expect(ajuste).toMatchObject({ cumplen: 1, faltan: 2 });
    const replica = filas.find((f) => f.nombre === 'Replicación independiente')!;
    expect(replica).toMatchObject({ cumplen: 1, faltan: 1 });
  });
});

describe('el veredicto sale de contar', () => {
  it('sigue la misma regla que el servidor', () => {
    // rosa/causal.py: identificable si no falta nada, acotado si falta algo
    // pero se cumple algo, sin resolver si no se cumple nada.
    expect(veredictoPorRegla(3, 0)).toBe('identificable');
    expect(veredictoPorRegla(1, 2)).toBe('acotado');
    expect(veredictoPorRegla(0, 3)).toBe('sin_resolver');
    // Sin supuestos de ningún lado no hay nada que identificar.
    expect(veredictoPorRegla(0, 0)).toBe('sin_resolver');
  });

  it('encender el supuesto que falta cambia el veredicto', () => {
    expect(veredictoPorRegla(1, 2)).toBe('acotado');
    expect(veredictoPorRegla(2, 1)).toBe('acotado');
    expect(veredictoPorRegla(3, 0)).toBe('identificable');
  });
});

describe('la disposición de la cascada', () => {
  const nodo = (id: string, capa: string): NodoCascada => ({ id, etiqueta: id, capa: capa as Capa, enJuego: 1, profundidad: 0 });

  it('pone una columna por tramo, en el orden en que ocurre la enfermedad', () => {
    const p = posicionesCascada([nodo('cognicion', 'desenlace'), nodo('APOE4', 'factores'), nodo('tau', 'patologia')], 900, 400);
    const x = Object.fromEntries(p.map((q) => [q.id, q.x]));
    expect(x.APOE4).toBeLessThan(x.tau!);
    expect(x.tau).toBeLessThan(x.cognicion!);
  });

  it('reparte a lo alto los que comparten columna y centra al que va solo', () => {
    const p = posicionesCascada([nodo('GFAP', 'marcadores'), nodo('NfL', 'marcadores')], 900, 400);
    expect(p[0]!.y).toBe(100);
    expect(p[1]!.y).toBe(300);
    const solo = posicionesCascada([nodo('tau', 'patologia')], 900, 400);
    expect(solo[0]).toMatchObject({ x: 450, y: 200 });
  });

  it('es determinista: la misma cascada da el mismo dibujo', () => {
    const ns = [nodo('a', 'factores'), nodo('b', 'marcadores'), nodo('c', 'factores')];
    expect(posicionesCascada(ns, 800, 300)).toEqual(posicionesCascada(ns, 800, 300));
  });

  it('un nodo de capa desconocida cae en su propia columna al final', () => {
    const p = posicionesCascada([nodo('APOE4', 'factores'), nodo('raro', 'otros')], 900, 400);
    expect(p.find((q) => q.id === 'raro')!.x).toBe(900);
  });

  it('sin nodos no hay posiciones y no revienta', () => {
    expect(posicionesCascada([], 900, 400)).toEqual([]);
  });
});

describe('cuánto pesa un nodo', () => {
  it('reparte en tres fuerzas por la proporción, no por estar en el grafo', () => {
    expect(intensidad(20, 21)).toBe('alta');
    expect(intensidad(14, 21)).toBe('alta');
    expect(intensidad(10, 21)).toBe('media');
    expect(intensidad(5, 21)).toBe('baja');
    expect(intensidad(0, 21)).toBe('baja');
  });

  it('sin hipótesis no se inventa fuerza', () => {
    expect(intensidad(0, 0)).toBe('baja');
  });
});

describe('las flechas que rodean las cajas', () => {
  // El 22 de septiembre de 2026 Emir leyó en el dibujo dos relaciones que no
  // existen, porque las flechas cruzaban por detrás de cajas ajenas.
  const CAJAS = [
    { id: 'edad', x: 100, y: 200 },
    { id: 'amiloide', x: 400, y: 200 },
    { id: 'neurodegeneracion', x: 700, y: 200 },
  ];

  it('desvía la flecha que pasaría por detrás de una caja ajena', () => {
    // edad -> neurodegeneracion cruzaría justo por amiloide.
    const d = desvioDeArco({ x: 100, y: 200 }, { x: 700, y: 200 }, CAJAS, 128, 46);
    expect(d).not.toBe(0);
  });

  it('no desvía la que va de una caja a la de al lado', () => {
    const d = desvioDeArco({ x: 100, y: 200 }, { x: 400, y: 200 }, CAJAS, 128, 46);
    expect(d).toBe(0);
  });

  it('no cuenta como estorbo una caja que está lejos en vertical', () => {
    const lejos = [{ id: 'otra', x: 400, y: 500 }];
    expect(desvioDeArco({ x: 100, y: 200 }, { x: 700, y: 200 }, lejos, 128, 46)).toBe(0);
  });

  it('rodea por el lado contrario al estorbo', () => {
    // El estorbo por debajo de la trayectoria: se rodea por arriba (negativo).
    expect(desvioDeArco({ x: 100, y: 100 }, { x: 700, y: 100 }, [{ id: 'x', x: 400, y: 120 }], 128, 46)).toBeLessThan(0);
    // Y al revés.
    expect(desvioDeArco({ x: 100, y: 200 }, { x: 700, y: 200 }, [{ id: 'x', x: 400, y: 180 }], 128, 46)).toBeGreaterThan(0);
  });

  it('sin cajas no hay desvío y no revienta', () => {
    expect(desvioDeArco({ x: 0, y: 0 }, { x: 100, y: 0 }, [], 128, 46)).toBe(0);
  });
});

describe('el orden dentro de una columna', () => {
  it('sigue la cadena, no la popularidad', () => {
    // amiloide -> tau, y los dos son PATOLOGÍA. Sin ordenar por la cadena, tau
    // salía primero por aparecer en más grafos y la flecha iba hacia atrás.
    const nodos = [
      { id: 'B:amiloide', etiqueta: 'amiloide', rol: 'base', capa: 'patologia' },
      { id: 'B:tau', etiqueta: 'tau', rol: 'base', capa: 'patologia' },
    ];
    const c = cascada([
      hip('h1', { nodos, aristas: [{ de: 'B:amiloide', a: 'B:tau', tipo: 'base_curada', contexto: '' }] }),
      // tau aparece en más grafos que amiloide.
      hip('h2', { nodos: [nodos[1]!] }),
      hip('h3', { nodos: [nodos[1]!] }),
    ]);
    expect(c.nodos.map((n) => n.id)).toEqual(['amiloide', 'tau']);
    expect(c.nodos[0]!.profundidad).toBe(0);
    expect(c.nodos[1]!.profundidad).toBe(1);
  });

  it('la profundidad es el camino más largo, no el más corto', () => {
    const nodos = [
      { id: 'B:a', etiqueta: 'a', rol: 'base', capa: 'patologia' },
      { id: 'B:b', etiqueta: 'b', rol: 'patologia', capa: 'patologia' },
      { id: 'B:c', etiqueta: 'c', rol: 'base', capa: 'patologia' },
    ];
    const c = cascada([
      hip('h1', {
        nodos: nodos.map((n) => ({ ...n, rol: 'base' })),
        aristas: [
          { de: 'B:a', a: 'B:b', tipo: 'base_curada', contexto: '' },
          { de: 'B:b', a: 'B:c', tipo: 'base_curada', contexto: '' },
          { de: 'B:a', a: 'B:c', tipo: 'base_curada', contexto: '' },
        ],
      }),
    ]);
    // c es alcanzable en 1 paso desde a, pero el camino más largo es 2.
    expect(c.nodos.find((n) => n.id === 'c')!.profundidad).toBe(2);
  });
});
