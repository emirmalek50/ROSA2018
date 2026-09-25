// @vitest-environment jsdom
// La franja del ranking y la lista de alternativas montadas de verdad: sobre
// las hipótesis de muestra y sobre hipótesis inyectadas a mano (con y sin
// conclusión, con conflicto, fusionada, pendiente, candidata, registro
// antiguo). Se comprueba que los chips esperados aparecen en su orden, que
// cada uno lleva su definición en el title, y que nada de lo que se pinta
// lleva guiones largos ni palabras sin tilde. Mismo patrón que Arbol.test.tsx
// (createRoot y act; testing-library no está en el proyecto).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { ConclusionHipotesis, Hipotesis } from '../datos/tipos';
import { Alternativas, alternativasDe, type Alternativa } from './Alternativas';
import { FranjaRanking } from './FranjaRanking';

const SIN_TILDE = /\b(hipotesis|conclusion|iteracion|todavia|segun|habia|subiria|bajaria|direccion|comprobacion|explicacion|seleccion|medicion|analisis|arbol|distinguiria|poblacion|informacion|aqui|Que la|Aqui|Todavia|Iteracion|Explicacion|Seleccion)\b/;

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});

const chips = () => [...nodo.querySelectorAll('.chip')].map((c) => c.textContent?.trim() ?? '');
const titulos = () => [...nodo.querySelectorAll('[title]')].map((c) => c.getAttribute('title') ?? '');
const todoElTexto = () => [nodo.textContent ?? '', ...titulos()].join('\n');

function conclusion(extra: Partial<ConclusionHipotesis> = {}): ConclusionHipotesis {
  return { certeza: 'muy_baja', direccion: 'apoya', conclusion: '', factores: [], base: { afirmaciones: 3, sostenidas: 2, fuentes: 2, datos: 0, interpretaciones: 1 }, enunciado: '', aFavor: [], enContra: [], loMasFragil: '', subiria: '', bajaria: '', noComprobado: [], cambio: null, fechaBusqueda: null, fecha: 1, iteracion: 13, ...extra };
}

describe('FranjaRanking', () => {
  const estado = estadoDeMuestra();
  const hip1 = estado.hipotesis.find((x) => x.id === 'hip-1')!;

  it('con hip-1 de la muestra pinta cada componente en orden fijo, con los huecos dichos como huecos', async () => {
    await act(async () => root.render(<FranjaRanking estado={estado} h={hip1} />));
    const lista = nodo.querySelector('[role="group"]')!;
    expect(lista.getAttribute('aria-label')).toBe('Componentes del ranking, sin sumar');
    const c = chips();
    // Orden: certeza, (dirección ausente), cohortes, a favor, en contra, socavan, Killer, bloqueos, BT, partidos, novedad.
    expect(c[0]).toBe('Sin conclusión todavía');
    expect(c[1]).toMatch(/cohorte/);
    expect(c[2]).toBe('3 a favor');
    expect(c[3]).toBe('0 en contra');
    expect(c[4]).toBe('0 socavan');
    expect(c[5]).toBe('Killer: sin juzgar');
    expect(c).toContain('Sin experimento interpretable');
    expect(c).toContain('Sin BT');
    expect(c).toContain('5 partidos');
    expect(c).toContain('Precedente parcial');
    // El orden relativo de lo que sigue a los bloqueos también es fijo.
    const iBT = c.indexOf('Sin BT');
    expect(c.indexOf('5 partidos')).toBe(iBT + 1);
    expect(c.indexOf('Precedente parcial')).toBe(iBT + 2);
    // No hay conflicto, pendiente ni fusión en la muestra.
    expect(nodo.textContent).not.toContain('Se contradice');
    expect(nodo.textContent).not.toContain('Pendiente de revisar');
    expect(nodo.textContent).not.toContain('Fusionada');
    // Cada chip explica su término: los title llevan las definiciones.
    const t = titulos().join('\n');
    expect(t).toContain('Certeza GRADE');
    expect(t).toContain('Hypothesis Killer');
    expect(t).toContain('Bradley-Terry');
    expect(t).toContain('Cohortes distintas');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('con conclusión acotada, BT, Killer, candidata, ruta, conflicto, pendiente y fusión pinta cada chip', async () => {
    const h: Hipotesis = {
      ...hip1,
      conclusion: conclusion({ certeza: 'baja', direccion: 'apoya', techo: { nivel: 'muy_baja', motivo: 'solo literatura de una sola cohorte', acotada: true, certezaDelJuez: 'moderada' }, escalera: [{ de: 'baja', a: 'moderada', falta: 'Evidencia directa sobre datos reales.' }], subiria: 'Un análisis in silico en la cohorte de FLENI', bajaria: 'Una réplica que no vea anticipación' }),
      decisionKiller: 'avanzar',
      candidata: true,
      bt: { fuerza: 1520, ic95: [1480, 1560], partidos: 4 },
      tarjeta: { diana: 'x', celula: 'x', etapa: 'x', intervencion: 'x', direccion: 'modula', prediccionFalsable: 'x', riesgos: [], pasoRuta: 'mecanismo' },
      conflictoCon: ['hip-2'],
      absorbe: ['hip-3'],
      experimento: { protocolo: '1', ensayo: 'e', costeEstimado: '', laboratorio: null, estado: 'propuesto', ficheroDatos: null, analisisPedido: '', confirma: 'sube', refuta: 'baja' },
    };
    await act(async () => root.render(<FranjaRanking estado={estado} h={h} explicar />));
    const c = chips();
    expect(c[0]).toBe('Certeza baja · techo muy baja');
    expect(c[1]).toBe('La evidencia apoya la hipótesis');
    expect(c).toContain('Killer: Avanza');
    expect(c).toContain('Candidata al laboratorio');
    expect(c).toContain('BT 1.520 (1.480 a 1.560)');
    expect(c).toContain('Ruta 1/8: Mecanismo');
    expect(c).toContain('Se contradice con otra');
    expect(c).toContain('Absorbió otra');
    expect(c).not.toContain('Sin bloqueos');
    // El techo y su motivo van en el title del chip de certeza.
    const certeza = nodo.querySelector('.chip')!;
    expect(certeza.getAttribute('title')).toContain('solo literatura de una sola cohorte');
    expect(certeza.getAttribute('title')).toContain('acotada');
    // El conflicto resuelve el título de la otra hipótesis.
    const conflicto = [...nodo.querySelectorAll('.chip')].find((x) => x.textContent?.startsWith('Se contradice'))!;
    expect(conflicto.getAttribute('title')).toContain(estado.hipotesis.find((x) => x.id === 'hip-2')!.titulo);
    // La frase en llano de qué la movería.
    expect(nodo.textContent).toContain('Para pasar de certeza baja a certeza moderada le falta: evidencia directa sobre datos reales.');
    expect(nodo.textContent).toContain('Lo que la subiría, según el juez: un análisis in silico en la cohorte de FLENI.');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('fusionada en otra y pendiente de revisar se ven aunque no haya conclusión', async () => {
    const h: Hipotesis = { ...hip1, fusionadaEn: 'hip-2', pendienteRevision: { causa: 'hecho_contradicho', detalle: 'El hecho h-3 fue contradicho.', origenId: 'h-3', desde: 1 } };
    await act(async () => root.render(<FranjaRanking estado={estado} h={h} />));
    const c = chips();
    expect(c).toContain('Fusionada en otra');
    expect(c).toContain('Pendiente de revisar');
    expect(c).toContain('Depende de algo que cambió y no se revisó');
    const pendiente = [...nodo.querySelectorAll('.chip')].find((x) => x.textContent === 'Pendiente de revisar')!;
    expect(pendiente.getAttribute('title')).toContain('El hecho h-3 fue contradicho.');
  });

  it('un registro antiguo sin listas no rompe la franja', async () => {
    const vieja = { id: 'hip-vieja-inv-1', investigacionId: 'inv-1', titulo: 'Old record', estado: 'propuesta' } as unknown as Hipotesis;
    await act(async () => root.render(<FranjaRanking estado={{ hipotesis: [vieja] }} h={vieja} />));
    const c = chips();
    expect(c[0]).toBe('Sin conclusión todavía');
    expect(c[1]).toBe('Sin cohorte identificada');
    expect(c).toContain('0 a favor');
    expect(c).toContain('0 partidos');
    expect(c).toContain('Novedad sin comprobar');
    expect(c).toContain('Trazabilidad insuficiente');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('evidencia en contra y que socava se pintan con su recuento', async () => {
    const h: Hipotesis = { ...hip1, afirmaciones: [...hip1.afirmaciones, { ...hip1.afirmaciones[0]!, relacion: 'contradice' }, { ...hip1.afirmaciones[0]!, relacion: 'socava', socavaA: 'a-1' }, { ...hip1.afirmaciones[0]!, relacion: 'apoya', socavadaPor: ['a-x'] }] };
    await act(async () => root.render(<FranjaRanking estado={estado} h={h} />));
    const c = chips();
    expect(c).toContain('3 a favor');
    expect(c).toContain('1 en contra');
    expect(c).toContain('1 socava');
    const socava = [...nodo.querySelectorAll('.chip')].find((x) => x.textContent === '1 socava')!;
    expect(socava.getAttribute('title')).toContain('1 apoyo socavado no cuenta');
  });
});

describe('Alternativas', () => {
  it('sin alternativas dice que ROSA2018 no las escribió todavía', async () => {
    await act(async () => root.render(<Alternativas h={{}} />));
    expect(nodo.textContent).toContain('no ha escrito explicaciones alternativas');
    await act(async () => root.render(<Alternativas h={null} vacio="Nada por aquí." />));
    expect(nodo.textContent).toContain('Nada por aquí.');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('pinta cada clase con su etiqueta, su definición en una frase y qué la distinguiría', async () => {
    const alternativas: Alternativa[] = [
      { texto: 'El deterioro cognitivo altera el marcador, no al revés.', clase: 'causa_inversa', queLaDistinguiria: 'Medir el marcador años antes del diagnóstico en la misma cohorte.', iteracion: 12 },
      { texto: 'La edad explica las dos.', clase: 'confusor', queLaDistinguiria: 'Ajustar por edad y estratificar.' },
      { texto: 'Solo entran pacientes de clínica de memoria.', clase: 'seleccion', queLaDistinguiria: 'Replicar en una cohorte poblacional.' },
      { texto: 'The Simoa lot differs between groups.', clase: 'artefacto', queLaDistinguiria: 'Re-run both groups on the same plate.' },
      { texto: 'Otra cosa.', clase: 'otra', queLaDistinguiria: '' },
    ];
    await act(async () => root.render(<Alternativas h={{ alternativas }} />));
    const c = chips();
    expect(c).toEqual(['Causa inversa', 'Confusor', 'Sesgo de selección', 'Artefacto de medida', 'Otra explicación']);
    expect(nodo.textContent).toContain('5 explicaciones alternativas');
    expect(nodo.textContent).toContain('El desenlace produce la exposición y no al revés');
    expect(nodo.textContent).toContain('Una tercera variable explica las dos a la vez');
    expect(nodo.textContent).toContain('Quién entra en la muestra distorsiona la asociación');
    expect(nodo.textContent).toContain('La medida o la plataforma producen la señal');
    expect(nodo.textContent).toContain('Iteración 12');
    expect(nodo.textContent).toContain('Medir el marcador años antes del diagnóstico en la misma cohorte.');
    expect(nodo.textContent).toContain('Re-run both groups on the same plate.');
    // Una alternativa sin "qué la distinguiría" lo dice, no lo esconde.
    expect(nodo.textContent).toContain('ROSA2018 no lo dejó escrito');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('una clase desconocida cae en "Otra explicación" sin perder el nombre, y la basura se descarta', () => {
    const lista = alternativasDe({ alternativas: [{ texto: 'x', clase: 'Mediacion' as unknown as Alternativa['clase'], queLaDistinguiria: 'y' }, null as unknown as Alternativa, { texto: '', clase: 'otra', queLaDistinguiria: '   ' }, { texto: 'z', clase: 'confusor', queLaDistinguiria: 'w', iteracion: Number.NaN }] });
    expect(lista.map((a) => a.clase)).toEqual(['otra', 'confusor']);
    expect(lista[0]!.claseOriginal).toBe('mediacion');
    expect(lista[1]!.iteracion).toBeNull();
    expect(alternativasDe(undefined)).toEqual([]);
    expect(alternativasDe({ alternativas: 'no es una lista' as unknown as Alternativa[] })).toEqual([]);
  });

  it('con una clase desconocida montada, el chip enseña el nombre original entre paréntesis', async () => {
    await act(async () => root.render(<Alternativas h={{ alternativas: [{ texto: 'x', clase: 'Mediacion' as unknown as Alternativa['clase'], queLaDistinguiria: 'y' }] }} />));
    expect(chips()).toEqual(['Otra explicación (mediacion)']);
  });
});

describe('adversario: la franja con valores que la interfaz no conoce o no puede comprobar', () => {
  const estado = estadoDeMuestra();
  const hip1 = estado.hipotesis.find((x) => x.id === 'hip-1')!;
  const raro = (extra: Partial<Hipotesis>): Hipotesis => ({ ...hip1, afirmaciones: [hip1.afirmaciones[0]!, { ...hip1.afirmaciones[0]!, veredicto: 'raro' as Hipotesis['afirmaciones'][number]['veredicto'] }], ...extra });

  it('si no se pudieron comprobar los bloqueos lo dice, y no pinta "Sin bloqueos" ni "Candidata"', async () => {
    await act(async () => root.render(<FranjaRanking estado={estado} h={raro({ bloqueos: undefined, candidata: true })} />));
    const c = chips();
    expect(c).toContain('Bloqueos sin comprobar');
    expect(c).not.toContain('Sin bloqueos');
    expect(c).not.toContain('Candidata al laboratorio');
    const chip = [...nodo.querySelectorAll(".chip")].find((x) => x.textContent === 'Bloqueos sin comprobar')!;
    expect(chip.getAttribute('title')).toContain('no comprobado no es lo mismo que sin bloqueos');
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('un bloqueo del servidor llamado "constructor" o desconocido no tumba la fila ni saca nada del prototipo', async () => {
    const h = raro({ bloqueos: ['constructor', 'toString', 'bloqueo_nuevo', 'bloqueo_nuevo'] as unknown as Hipotesis['bloqueos'] });
    await act(async () => root.render(<FranjaRanking estado={estado} h={h} />));
    const c = chips();
    expect(c).toContain('constructor');
    expect(c).toContain('toString');
    expect(c.filter((x) => x === 'bloqueo nuevo')).toHaveLength(1);
    const chip = [...nodo.querySelectorAll('.chip')].find((x) => x.textContent === 'constructor')!;
    expect(chip.getAttribute('title')).toContain('no conoce');
  });

  it('una certeza, dirección, Killer o paso llamados "constructor" caen en la etiqueta de repuesto', async () => {
    const h: Hipotesis = {
      ...hip1,
      conclusion: conclusion({ certeza: 'constructor' as ConclusionHipotesis['certeza'], direccion: 'constructor' as ConclusionHipotesis['direccion'] }),
      decisionKiller: 'constructor' as Hipotesis['decisionKiller'],
      tarjeta: { diana: 'x', celula: 'x', etapa: 'x', intervencion: 'x', direccion: 'modula', prediccionFalsable: 'x', riesgos: [], pasoRuta: 'constructor' as NonNullable<Hipotesis['tarjeta']>['pasoRuta'] },
    };
    await act(async () => root.render(<FranjaRanking estado={estado} h={h} />));
    const c = chips();
    expect(c[0]).toBe('Certeza constructor');
    expect(c[1]).toBe('Dirección: constructor');
    expect(c).toContain('Killer: constructor');
    expect(c).toContain('Ruta: constructor');
  });

  it('los bloqueos del servidor se marcan como tales y sin repetidos', async () => {
    await act(async () => root.render(<FranjaRanking estado={estado} h={raro({ bloqueos: ['fuente_retractada', 'fuente_retractada'] })} />));
    expect(chips().filter((x) => x === 'Fuente retractada')).toHaveLength(1);
    const grupo = nodo.querySelector('.acciones[title]')!;
    expect(grupo.getAttribute('title')).toContain('tal como los guardó el servidor');
  });

  it('el servidor dice que no hay bloqueos (lista vacía guardada): "Sin bloqueos" con la nota de origen', async () => {
    await act(async () => root.render(<FranjaRanking estado={estado} h={raro({ bloqueos: [] })} />));
    const chip = [...nodo.querySelectorAll('.chip')].find((x) => x.textContent === 'Sin bloqueos')!;
    expect(chip.getAttribute('title')).toContain('tal como los guardó el servidor');
  });
});

describe('adversario: alternativas como las escribe hoy el Killer y desde el grafo causal', () => {
  it('acepta cadenas sueltas e infiere la clase con la regla del backend, diciendo que es inferida', () => {
    const lista = alternativasDe({ alternativas: ['La edad explica las dos: es un confusor clásico.', 'The disease changes the marker: reverse causation.', 'Solo entran voluntarios de clínica de memoria.', 'El lote del ensayo Simoa difiere entre grupos.', 'Nada que ver con las cuatro clases.', '', 42 as unknown as string] });
    expect(lista.map((a) => a.clase)).toEqual(['confusor', 'causa_inversa', 'seleccion', 'artefacto', 'otra']);
    expect(lista.every((a) => a.claseInferida)).toBe(true);
    expect(lista[0]!.motivoClase).toContain('rosa/causal.py');
    expect(lista[0]!.motivoClase).toContain('edad');
    expect(lista[4]!.motivoClase).toContain('no nombra');
  });

  it('"al revés" con tilde cuenta como causa inversa aunque la regla del backend esté escrita sin tilde', () => {
    expect(alternativasDe({ alternativas: ['Es al revés: el deterioro cambia el marcador.'] })[0]!.clase).toBe('causa_inversa');
  });

  it('normaliza la clase declarada: tildes, espacios, guiones y alias en inglés', () => {
    const lista = alternativasDe({ alternativas: [
      { texto: 'a', clase: 'Selección' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
      { texto: 'b', clase: 'causa inversa' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
      { texto: 'c', clase: 'selection-bias' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
      { texto: 'd', clase: 'confounder' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
      { texto: 'e', clase: 'artifact' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
      { texto: 'f', clase: 'constructor' as unknown as Alternativa['clase'], queLaDistinguiria: '' },
    ] });
    expect(lista.map((a) => a.clase)).toEqual(['seleccion', 'causa_inversa', 'seleccion', 'confusor', 'artefacto', 'otra']);
    expect(lista.every((a) => !a.claseInferida)).toBe(true);
    expect(lista[5]!.claseOriginal).toBe('constructor');
  });

  it('un texto que es un objeto se trata como vacío, y una iteración en texto numérico se lee', () => {
    const lista = alternativasDe({ alternativas: [{ texto: {} as unknown as string, clase: 'otra', queLaDistinguiria: {} as unknown as string }, { texto: 'x', clase: 'otra', queLaDistinguiria: 'y', iteracion: '12' as unknown as number }] });
    expect(lista).toHaveLength(1);
    expect(lista[0]!.iteracion).toBe(12);
    expect(JSON.stringify(lista)).not.toContain('[object Object]');
  });

  it('sin el campo alternativas, lee los nodos alternativa_* del grafo causal y lo dice en pantalla', async () => {
    const h = { grafoCausal: { nodos: [{ id: 'X', etiqueta: 'APOE4', rol: 'exposicion' }, { id: 'A1', etiqueta: 'La edad explica las dos.', rol: 'alternativa_confusor' }, { id: 'A2', etiqueta: 'Reverse causation.', rol: 'alternativa_causa_inversa' }, { id: 'A3', etiqueta: 'Otra cosa.', rol: 'alternativa_rara' }, null, { id: 'A4', etiqueta: '', rol: 'alternativa_otra' }] } };
    const lista = alternativasDe(h);
    expect(lista.map((a) => [a.clase, a.origen])).toEqual([['confusor', 'grafo_causal'], ['causa_inversa', 'grafo_causal'], ['otra', 'grafo_causal']]);
    expect(lista[0]!.motivoClase).toContain('nodo A1');
    await act(async () => root.render(<Alternativas h={h} />));
    expect(nodo.textContent).toContain('Leídas del grafo causal');
    expect(chips()).toEqual(['Confusor', 'Causa inversa', 'Otra explicación (rara)']);
    expect(todoElTexto()).not.toContain('\u2014');
    expect(todoElTexto()).not.toMatch(SIN_TILDE);
  });

  it('con el campo alternativas presente pero vacío no cae al grafo causal: el campo manda', () => {
    expect(alternativasDe({ alternativas: [], grafoCausal: { nodos: [{ id: 'A1', etiqueta: 'x', rol: 'alternativa_confusor' }] } })).toEqual([]);
  });

  it('una cadena suelta montada enseña que la clase es inferida y que falta qué la distinguiría', async () => {
    await act(async () => root.render(<Alternativas h={{ alternativas: ['La edad explica las dos.'] }} />));
    expect(nodo.textContent).toContain('Clase inferida del texto por regla');
    expect(nodo.textContent).toContain('ROSA2018 no lo dejó escrito');
    expect(chips()).toEqual(['Confusor']);
  });
});

describe('chip de la ruta evaluada', () => {
  it('con h.ruta enseña los pasos cubiertos y el que toca, y avisa si el declarado no es coherente; sin ruta cae al paso declarado', async () => {
    const e = estadoDeMuestra();
    const base = e.hipotesis[0]!;
    const h = { ...base, tarjeta: { ...(base.tarjeta ?? {}), pasoRuta: 'evidencia_poblacion' }, ruta: { cubiertos: 4, siguiente: 'opciones_intervencion', coherente: false } } as unknown as typeof base;
    await act(async () => root.render(<FranjaRanking estado={e} h={h} />));
    const chips = [...nodo.querySelectorAll('.chip')].map((c) => c.textContent ?? '');
    expect(chips.some((c) => c.startsWith('Ruta 4/8, toca opciones de intervención'))).toBe(true);
    expect(chips.some((c) => c.includes('Ruta 8/8'))).toBe(false);
    const aviso = [...nodo.querySelectorAll('.chip')].find((c) => (c.textContent ?? '').startsWith('Ruta 4/8'))!;
    expect(aviso.getAttribute('title')).toContain('va por delante');
    const sinRuta = { ...h, ruta: null } as unknown as typeof base;
    await act(async () => root.render(<FranjaRanking estado={e} h={sinRuta} />));
    const chips2 = [...nodo.querySelectorAll('.chip')].map((c) => c.textContent ?? '');
    expect(chips2.some((c) => c.startsWith('Ruta 8/8'))).toBe(true);
  });
});

describe('razones en contra del juez y motivo del Killer', () => {
  it('cuenta aparte las razones del juez para que "0 en contra" no se lea como sin objeciones, y el chip del Killer lleva el motivo real', async () => {
    const e = estadoDeMuestra();
    const base = e.hipotesis[0]!;
    const h = {
      ...base,
      decisionKiller: 'suspender',
      revisiones: [{ fecha: 3, quien: 'rosa', accion: 'killer', nota: 'suspender: Hace falta más o mejor evidencia: sesgo_evidencia: una sola fuente', aCiegas: false }],
      conclusion: { ...(base.conclusion ?? {}), enContra: ['a', 'b', 'c', 'd', 'e', 'f'] },
    } as unknown as typeof base;
    await act(async () => root.render(<FranjaRanking estado={e} h={h} />));
    const chips = [...nodo.querySelectorAll('.chip')];
    const textos = chips.map((c) => c.textContent ?? '');
    expect(textos).toContain('6 razones en contra (juez)');
    const killer = chips.find((c) => (c.textContent ?? '').startsWith('Killer:'))!;
    expect(killer.textContent).toBe('Killer: Suspendida');
    expect(killer.getAttribute('title')).toContain('sesgo_evidencia: una sola fuente');
  });
});
