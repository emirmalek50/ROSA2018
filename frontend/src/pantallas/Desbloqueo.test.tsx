// @vitest-environment jsdom
// Qué desbloquea más, con candados y llaves: que las llaves salgan en el orden
// del plan y los candados se abran cuando el plan dice, no por una cuenta
// aparte; que pasar por una llave señale a quién llega ella sola; que lo que
// nunca se abre pidiendo datos se vea distinto (biología sin medir, algo en
// contra, un supuesto sin clasificar); que la tarjeta diga lo que le falta a
// cada hipótesis y, al pincharla, sus supuestos con la frase que decidió cada
// uno marcada; y que el aviso de lo que está por reevaluar pida con el alcance
// de la pantalla.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import { estadoDeMuestra } from '../datos/muestra';
import { acciones } from '../datos/almacen';
import { Desbloqueo } from './Desbloqueo';
import { ingrediente, plan, REGLA_SUPUESTOS, tablero } from '../lib/desbloqueo';

const INV = { id: 'inv-a', titulo: 'Investigación A' } as unknown as Investigacion;

type Nodo = { id: string; texto: string; estado: string; evidencia: string; hijos: Nodo[] };
const sin = (id: string, texto: string): Nodo => ({ id, texto, estado: 'sin_evidencia', evidencia: 'ninguna', hijos: [] });
const contra = (id: string, texto: string, evidencia: string): Nodo => ({ id, texto, estado: 'contradicho', evidencia, hijos: [] });

function hip(id: string, investigacionId: string, titulo: string, supuestos: Nodo[], estado = 'propuesta'): Hipotesis {
  return { id, investigacionId, titulo, estado, supuestos } as unknown as Hipotesis;
}

// h1 pide referencia y subgrupo; h2, referencia y ensayos, y tiene uno en
// contra; h3 pide biología sin medir y tiene uno que ninguna regla clasifica;
// h4 está descartada y no cuenta.
const HIPOTESIS = [
  hip('h1', 'inv-a', 'Brecha GFAP y NfL', [sin('s1', 'Existe un intervalo de referencia independiente para GFAP.'), sin('s2', 'Hay suficientes portadores en ADNI.')]),
  hip('h2', 'inv-a', 'Normalización de p-tau181', [
    sin('s3', 'Existe un intervalo de referencia de p-tau181 definido en una publicación independiente.'),
    sin('s4', 'Los ensayos citados publican p-tau181 frente a placebo.'),
    contra('s5', 'Las escalas de los ensayos son comparables.', 'Los ensayos usan CDR-SB e iADRS.'),
  ]),
  hip('h3', 'inv-b', 'GFAP y astrogliosis', [sin('s6', 'El GFAP en plasma refleja astrogliosis del sistema nervioso central.'), sin('s7', 'Lo que vale en PSEN1 vale en el esporádico.')]),
  hip('h4', 'inv-b', 'Descartada', [sin('s8', 'Existe un intervalo de referencia externo.')], 'descartada'),
];

function estadoCon(hipotesis: Hipotesis[]): EstadoRosa {
  return {
    hipotesis,
    investigaciones: [
      { id: 'inv-a', titulo: 'Investigación A' },
      { id: 'inv-b', titulo: 'Investigación B' },
    ],
    conexion: 'conectado',
  } as unknown as EstadoRosa;
}

// El plan que la pantalla tiene que enseñar, calculado con la misma librería.
const PLAN = plan(tablero(HIPOTESIS));

let nodo: HTMLDivElement;
let raiz: Root;

async function montar(estado: EstadoRosa) {
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  raiz = createRoot(nodo);
  await act(async () => {
    raiz.render(<Desbloqueo inv={INV} estado={estado} />);
  });
}

afterEach(async () => {
  await act(async () => raiz?.unmount());
  nodo?.remove();
});

const boton = (nombre: RegExp) => {
  const b = [...nodo.querySelectorAll('button')].find((x) => nombre.test(x.getAttribute('aria-label') ?? x.textContent ?? ''));
  if (!b) throw new Error(`no hay botón ${nombre}`);
  return b;
};
const pulsar = async (b: HTMLElement) => {
  await act(async () => b.click());
};
const enfocar = async (b: HTMLElement) => {
  await act(async () => b.focus());
};
const candado = (titulo: string) => boton(new RegExp(`^${titulo}:`));
const cuenta = () => nodo.querySelector('.des-n')!.textContent;
const abiertos = () => [...nodo.querySelectorAll('.des-cand-abierto')].map((b) => b.getAttribute('aria-label')!.split(':')[0]);

describe('las llaves y los candados', () => {
  it('pone las llaves en el orden del plan, sin la biología sin medir, y abre con la primera elegida', async () => {
    await montar(estadoCon(HIPOTESIS));
    const nombres = [...nodo.querySelectorAll('.des-llave .des-nombre')].map((x) => x.textContent);
    expect(nombres).toEqual(PLAN.map((p) => ingrediente(p.ingrediente).nombre));
    expect(nombres).not.toContain('Biología sin medir');
    expect(nodo.querySelector('.des-llave [aria-current="step"]')!.getAttribute('aria-label')).toMatch(/^Llave 1, /);
    // La primera llave sola no abre ninguna: el contador lo dice, con lo máximo al lado.
    expect(cuenta()).toBe(String(PLAN[0]!.libresAcumuladas.length));
    expect(nodo.querySelector('.des-cuenta')!.textContent).toContain('de 3');
    expect(nodo.querySelector('.des-cuenta')!.textContent).toContain(`Con las ${PLAN.length}, ${PLAN[PLAN.length - 1]!.libresAcumuladas.length}.`);
    // La descartada no está.
    expect(nodo.textContent).not.toContain('Descartada');
  });

  it('«Siguiente llave» abre los candados que el plan dice, y al final no deja pasar de ahí', async () => {
    await montar(estadoCon(HIPOTESIS));
    for (let k = 2; k <= PLAN.length; k++) {
      await pulsar(boton(/^Siguiente llave|^Todas las llaves/));
      expect(cuenta()).toBe(String(PLAN[k - 1]!.libresAcumuladas.length));
      expect(abiertos().sort()).toEqual(PLAN[k - 1]!.libresAcumuladas.map((id) => HIPOTESIS.find((h) => h.id === id)!.titulo).sort());
    }
    const fin = boton(/^Todas las llaves/);
    expect(fin.hasAttribute('disabled')).toBe(true);
    expect(nodo.querySelector('.des-cuenta')!.textContent).toContain('Es lo máximo pidiendo datos.');
    // Hacia atrás también.
    await pulsar(boton(/^Llave anterior/));
    expect(cuenta()).toBe(String(PLAN[PLAN.length - 2]!.libresAcumuladas.length));
    // La que nunca se abre pidiendo no se abre ni con todas.
    expect(abiertos()).not.toContain('GFAP y astrogliosis');
  });

  it('pinchar una llave salta a ese paso', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(boton(new RegExp(`^Llave ${PLAN.length}, `)));
    expect(cuenta()).toBe(String(PLAN[PLAN.length - 1]!.libresAcumuladas.length));
    expect(nodo.querySelector('.des-llave [aria-current="step"]')!.getAttribute('aria-label')).toMatch(new RegExp(`^Llave ${PLAN.length}, `));
  });

  it('pasar por una llave señala a quién llega ella sola', async () => {
    await montar(estadoCon(HIPOTESIS));
    const referencia = PLAN.findIndex((p) => p.ingrediente === 'referencia');
    await enfocar(boton(new RegExp(`^Llave ${referencia + 1}, Intervalo de referencia`)));
    expect(candado('Brecha GFAP y NfL').classList.contains('des-alcanza')).toBe(true);
    expect(candado('Normalización de p-tau181').classList.contains('des-alcanza')).toBe(true);
    expect(candado('GFAP y astrogliosis').classList.contains('des-alcanza')).toBe(false);
  });

  it('lo que nunca se abre pidiendo se ve distinto, y la leyenda lo cuenta', async () => {
    await montar(estadoCon(HIPOTESIS));
    const h3 = candado('GFAP y astrogliosis');
    expect(h3.querySelector('.des-interrogacion')).not.toBeNull();
    expect(h3.querySelector('.des-punto-sin')).not.toBeNull();
    expect(h3.getAttribute('aria-label')).toContain('le falta biología que nadie ha medido');
    expect(h3.getAttribute('aria-label')).toContain('tiene un supuesto sin clasificar');
    const h2 = candado('Normalización de p-tau181');
    expect(h2.querySelector('.des-grieta')).not.toBeNull();
    expect(h2.getAttribute('aria-label')).toContain('tiene 1 supuesto en contra');
    expect(candado('Brecha GFAP y NfL').querySelector('.des-grieta, .des-interrogacion')).toBeNull();
    const leyenda = nodo.querySelector('.des-leyenda')!.textContent!;
    expect(leyenda).toContain('1 necesita biología que nadie ha medido');
    expect(leyenda).toContain('1 tiene ya algo en contra');
    expect(leyenda).toContain('1 tiene un supuesto que ninguna regla clasifica');
  });

  it('las muescas son los datos que le faltan: llenas las que ya tendría', async () => {
    await montar(estadoCon(HIPOTESIS));
    const h1 = candado('Brecha GFAP y NfL');
    const llenas = h1.querySelectorAll('.des-punto-tengo').length;
    const vacias = h1.querySelectorAll('.des-punto-falta').length;
    expect(llenas + vacias).toBe(2);
    expect(llenas).toBe(['referencia', 'subcohorte'].includes(PLAN[0]!.ingrediente) ? 1 : 0);
  });
});

describe('la tarjeta de cada candado', () => {
  it('al pasar dice lo que le falta, con qué llave y lo que ya tiene en contra', async () => {
    await montar(estadoCon(HIPOTESIS));
    await enfocar(candado('Normalización de p-tau181'));
    const t = nodo.querySelector('.des-tarjeta[role="tooltip"]')!;
    expect(t).not.toBeNull();
    const texto = t.textContent!;
    expect(texto).toContain('le faltan 2 datos');
    for (const id of ['referencia', 'ensayos'] as const) {
      const k = PLAN.findIndex((p) => p.ingrediente === id) + 1;
      expect(texto).toContain(`${ingrediente(id).nombre}llave ${k}`);
    }
    expect(texto).toContain('Ya tiene 1 supuesto en contra');
    expect(texto).toContain('Pincha el candado para ver sus 3 supuestos.');
  });

  it('al pinchar enseña sus supuestos con la frase marcada donde casó, y el enlace a la ficha', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(candado('Normalización de p-tau181'));
    const t = nodo.querySelector('.des-tarjeta[role="dialog"]')!;
    expect(t).not.toBeNull();
    const marcas = [...t.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marcas).toContain('intervalo de referencia');
    expect(t.textContent).toContain('En contra');
    expect(t.textContent).toContain('Las escalas de los ensayos son comparables.');
    expect((t.querySelector('a.enlace') as HTMLAnchorElement).getAttribute('href')).toBe('#/investigaciones/inv-a/hipotesis/h2');
    // Se cierra con la cruz y con Escape.
    await pulsar(boton(/^Cerrar$/));
    expect(nodo.querySelector('.des-tarjeta[role="dialog"]')).toBeNull();
    await pulsar(candado('Normalización de p-tau181'));
    await act(async () => {
      candado('Normalización de p-tau181').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(nodo.querySelector('.des-tarjeta')).toBeNull();
  });

  it('lo sin clasificar se dice en la tarjeta, no se reparte a ojo', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(candado('GFAP y astrogliosis'));
    const t = nodo.querySelector('.des-tarjeta')!.textContent!;
    expect(t).toContain('Un supuesto que ninguna regla clasifica');
    expect(t).toContain('Sin clasificar');
    expect(t).toContain('Lo que vale en PSEN1 vale en el esporádico.');
    expect(t).toContain('Biología que nadie ha medido');
  });
});

describe('alcance y estados vacíos', () => {
  it('«Esta investigación» recalcula con sus hipótesis y vuelve a la primera llave', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(boton(/^Todas las llaves|^Siguiente llave/));
    await pulsar(boton(/^Esta investigación/));
    expect(nodo.querySelectorAll('.des-cand')).toHaveLength(2);
    expect(nodo.textContent).not.toContain('GFAP y astrogliosis');
    expect(nodo.querySelector('.des-cuenta')!.textContent).toContain('de 2');
    expect(nodo.querySelector('.des-llave [aria-current="step"]')!.getAttribute('aria-label')).toMatch(/^Llave 1, /);
  });

  it('sin supuestos flojos lo dice, y sin hipótesis vivas también', async () => {
    await montar(estadoCon([hip('h', 'inv-a', 'Todo respaldado', [{ id: 'x', texto: 'Algo.', estado: 'respaldado', evidencia: '', hijos: [] }])]));
    expect(nodo.textContent).toContain('no falta nada que pedir');
    await act(async () => raiz.unmount());
    nodo.remove();
    await montar(estadoCon([]));
    expect(nodo.textContent).toContain('Todavía no hay hipótesis vivas en el programa.');
  });

  it('si nada se consigue pidiendo, lo dice en vez de enseñar una pista vacía', async () => {
    await montar(estadoCon([HIPOTESIS[2]!]));
    expect(nodo.querySelector('.des-pista')).toBeNull();
    expect(nodo.querySelector('.des-cuenta')!.textContent).toContain('Nada de lo que les falta se consigue pidiendo');
    expect(nodo.querySelectorAll('.des-cand')).toHaveLength(1);
  });

  it('no lanza con los datos de muestra', async () => {
    await montar(estadoDeMuestra());
    expect(nodo.querySelector('.des-pista')).not.toBeNull();
    expect(nodo.querySelectorAll('.des-cand').length).toBeGreaterThan(0);
  });
});

describe('lo que no está al día (rosa/vigencia.py)', () => {
  const sello = (extra: Record<string, unknown> = {}) => ({ en: 1000, regla: REGLA_SUPUESTOS, afirmaciones: 0, fallidos: 0, pedidaEn: null, noAtendida: null, reconstruido: false, ...extra });
  const con = (h: Hipotesis, s: unknown) => ({ ...h, afirmaciones: [], supuestosEvaluados: s }) as unknown as Hipotesis;
  const estadoCorridas = (hs: Hipotesis[], corridas: unknown[] = []) => ({ ...estadoCon(hs), corridas }) as unknown as EstadoRosa;

  it('avisa en una línea, explica el porqué en el título y en la tarjeta, y pide con el alcance de la pantalla', async () => {
    const pedir = vi.spyOn(acciones, 'reevaluarSupuestos').mockResolvedValue(undefined);
    const [h1, h2, h3] = HIPOTESIS;
    await montar(estadoCorridas([con(h1!, sello({ regla: 1 })), con(h2!, sello()), con(h3!, sello({ afirmaciones: -1 }))]));
    const aviso = nodo.querySelector('.des-aviso')!;
    expect(aviso.textContent).toContain('Orden provisional: 2 hipótesis por reevaluar');
    expect(aviso.getAttribute('title')).toContain('1 evaluada antes del 18 de septiembre');
    expect(aviso.getAttribute('title')).toContain('1 con evidencia llegada después');
    await enfocar(candado('Brecha GFAP y NfL'));
    expect(nodo.querySelector('.des-tarjeta-vieja')!.textContent).toContain('Por reevaluar.');
    await enfocar(candado('Normalización de p-tau181'));
    expect(nodo.querySelector('.des-tarjeta-vieja')).toBeNull();
    await pulsar(boton(/^Reevaluar 2$/));
    expect(pedir).toHaveBeenLastCalledWith(null);
    await pulsar(boton(/^Esta investigación/));
    await pulsar(boton(/^Reevaluar 1$/));
    expect(pedir).toHaveBeenLastCalledWith('inv-a');
    pedir.mockRestore();
  });

  it('lo ya pedido no ofrece el botón y dice si espera presupuesto; lo no atendido dice por qué', async () => {
    const [h1, , h3] = HIPOTESIS;
    await montar(
      estadoCorridas(
        [con(h1!, sello({ regla: 1, pedidaEn: 5000 })), con(h3!, sello({ regla: 1, noAtendida: 'La corrida 3 no tiene presupuesto: amplíalo o abre otra corrida y vuelve a pedirla.' }))],
        [
          { id: 'c16', investigacionId: 'inv-a', numero: 16, estado: 'pausada_por_presupuesto' },
          { id: 'c15', investigacionId: 'inv-a', numero: 15, estado: 'terminada' },
          { id: 'c3', investigacionId: 'inv-b', numero: 3, estado: 'detenida' },
        ],
      ),
    );
    const espera = nodo.querySelector('.des-espera')!.textContent!;
    expect(espera).toContain('1 reevaluación espera a que la corrida 16 tenga presupuesto');
    expect(espera).toContain('La corrida 3 no tiene presupuesto');
    // Solo la no atendida se puede volver a pedir.
    expect(boton(/^Reevaluar 1$/)).toBeTruthy();
  });

  it('con todo al día no hay aviso', async () => {
    await montar(estadoCorridas(HIPOTESIS.map((h) => con(h, sello()))));
    expect(nodo.querySelector('.des-aviso')).toBeNull();
    expect(nodo.querySelector('.des-espera')).toBeNull();
  });
});
