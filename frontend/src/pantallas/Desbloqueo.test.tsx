// @vitest-environment jsdom
// Qué desbloquea más: que los números salgan de los supuestos de las fichas y
// no de una tabla escrita aparte; que elegir un ingrediente encienda las
// hipótesis que haría avanzar y que elegir una hipótesis encienda lo que le
// falta; que la frase que decidió cada supuesto se subraye donde casó; que lo
// que no se clasifica y lo contradicho se digan en vez de esconderse; y que el
// plan no meta la biología sin medir como si fuera un pedido.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import { estadoDeMuestra } from '../datos/muestra';
import { acciones } from '../datos/almacen';
import { Desbloqueo } from './Desbloqueo';
import { REGLA_SUPUESTOS } from '../lib/desbloqueo';

const INV = { id: 'inv-a', titulo: 'Investigación A' } as unknown as Investigacion;

type Nodo = { id: string; texto: string; estado: string; evidencia: string; hijos: Nodo[] };
const sin = (id: string, texto: string): Nodo => ({ id, texto, estado: 'sin_evidencia', evidencia: 'ninguna', hijos: [] });
const contra = (id: string, texto: string, evidencia: string): Nodo => ({ id, texto, estado: 'contradicho', evidencia, hijos: [] });

function hip(id: string, investigacionId: string, titulo: string, supuestos: Nodo[], estado = 'propuesta'): Hipotesis {
  return { id, investigacionId, titulo, estado, supuestos } as unknown as Hipotesis;
}

const HIPOTESIS = [
  hip('h1', 'inv-a', 'Brecha GFAP y NfL', [
    sin('s1', 'Existe un intervalo de referencia independiente para GFAP.'),
    sin('s2', 'Hay suficientes portadores en ADNI.'),
  ]),
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
const filaHip = (titulo: string) => boton(new RegExp(`^${titulo}:`));
const apagada = (b: HTMLElement) => b.classList.contains('des-apagada');

describe('la pantalla de qué desbloquea más', () => {
  it('cuenta lo pendiente de las vivas, deja fuera la descartada y ordena por hipótesis tocadas', async () => {
    await montar(estadoCon(HIPOTESIS));
    const resumen = nodo.querySelector('.des-resumen')!.textContent!;
    expect(resumen).toContain('6 supuestos sin evidencia en 3 hipótesis vivas');
    expect(resumen).toContain('1 contradicho');
    expect(resumen).toContain('1 sin clasificar');
    expect(nodo.textContent).not.toContain('Descartada');
    const nombres = [...nodo.querySelectorAll('.des-ing .des-ing-nombre')].map((x) => x.textContent);
    // Intervalo de referencia toca dos hipótesis y va primero; la biología sin medir va aparte, al final.
    expect(nombres[0]).toBe('Intervalo de referencia');
    expect(nombres[nombres.length - 1]).toBe('Biología sin medir');
  });

  it('abre con el primer ingrediente elegido y sus hilos: el primer fotograma ya dice algo', async () => {
    await montar(estadoCon(HIPOTESIS));
    expect(boton(/^Intervalo de referencia:/).getAttribute('aria-pressed')).toBe('true');
    expect(nodo.querySelectorAll('.des-hilos path')).toHaveLength(2);
    expect(apagada(filaHip('Brecha GFAP y NfL'))).toBe(false);
    expect(apagada(filaHip('GFAP y astrogliosis'))).toBe(true);
    // El detalle enseña la frase que decidió el ingrediente, marcada donde casó.
    const marcas = [...nodo.querySelectorAll('.des-lista mark')].map((m) => m.textContent);
    expect(marcas).toEqual(['intervalo de referencia', 'intervalo de referencia']);
  });

  it('elegir otro ingrediente mueve los hilos y enciende sus hipótesis', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(boton(/^Resultados de ensayos clínicos:/));
    expect(nodo.querySelectorAll('.des-hilos path')).toHaveLength(1);
    expect(apagada(filaHip('Normalización de p-tau181'))).toBe(false);
    expect(apagada(filaHip('Brecha GFAP y NfL'))).toBe(true);
    expect(nodo.querySelector('.des-panel h3')!.textContent).toContain('Resultados de ensayos clínicos');
    expect(nodo.querySelector('.des-panel')!.textContent).toContain('ClinicalTrials.gov');
  });

  it('elegir una hipótesis enciende lo que le falta, con hilos hacia ella, y enseña lo contradicho con la nota del verificador', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(filaHip('Normalización de p-tau181'));
    expect(apagada(boton(/^Intervalo de referencia:/))).toBe(false);
    expect(apagada(boton(/^Resultados de ensayos clínicos:/))).toBe(false);
    expect(apagada(boton(/^Tamaño del subgrupo en la cohorte:/))).toBe(true);
    // Dos ingredientes y el contradicho: tres hilos, uno rojo.
    expect(nodo.querySelectorAll('.des-hilos path')).toHaveLength(3);
    expect(nodo.querySelectorAll('.des-hilos path.des-hilo-contra')).toHaveLength(1);
    const detalle = nodo.querySelector('.des-panel')!.textContent!;
    expect(detalle).toContain('Lo que le falta a esta hipótesis');
    expect(detalle).toContain('Los ensayos usan CDR-SB e iADRS.');
    const enlace = nodo.querySelector('.des-panel a.enlace') as HTMLAnchorElement;
    expect(enlace.getAttribute('href')).toBe('#/investigaciones/inv-a/hipotesis/h2');
  });

  it('lo sin clasificar se puede elegir y se lista, no se reparte a ojo', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(boton(/sin clasificar$/));
    expect(nodo.querySelector('.des-panel')!.textContent).toContain('Lo que vale en PSEN1 vale en el esporádico.');
    expect(apagada(filaHip('GFAP y astrogliosis'))).toBe(false);
    expect(apagada(filaHip('Brecha GFAP y NfL'))).toBe(true);
  });

  it('pasar a "esta investigación" recalcula todo con sus hipótesis y no deja una elección colgando', async () => {
    await montar(estadoCon(HIPOTESIS));
    await pulsar(boton(/^Tamaño del subgrupo en la cohorte:/));
    await pulsar(boton(/^Esta investigación/));
    const resumen = nodo.querySelector('.des-resumen')!.textContent!;
    expect(resumen).toContain('4 supuestos sin evidencia en 2 hipótesis vivas');
    expect(nodo.textContent).not.toContain('GFAP y astrogliosis');
    // Sigue elegido lo que existe aquí.
    expect(boton(/^Tamaño del subgrupo en la cohorte:/).getAttribute('aria-pressed')).toBe('true');
    await pulsar(boton(/^Todo el programa/));
    await pulsar(boton(/^Biología sin medir:/));
    await pulsar(boton(/^Esta investigación/));
    // La biología sin medir no existe en inv-a: vuelve al primero de la lista.
    expect(boton(/^Intervalo de referencia:/).getAttribute('aria-pressed')).toBe('true');
  });

  it('el plan no mete la biología sin medir y dice por qué quedan hipótesis sin liberar', async () => {
    await montar(estadoCon(HIPOTESIS));
    const plan = nodo.querySelector('.des-plan')!;
    const pasos = [...plan.querySelectorAll('.des-pasos li')].map((li) => li.firstElementChild!.textContent);
    expect(pasos).not.toContain('Biología sin medir');
    expect(pasos.length).toBeGreaterThan(0);
    const pie = plan.querySelector('.des-pie')!.textContent!;
    expect(pie).toContain('2 de 3');
    expect(pie).toContain('1 pide biología sin medir');
    expect(pie).toContain('1 tiene ya algún supuesto contradicho');
  });

  it('sin supuestos flojos lo dice, y sin hipótesis vivas también', async () => {
    await montar(estadoCon([hip('h', 'inv-a', 'Todo respaldado', [{ id: 'x', texto: 'Algo.', estado: 'respaldado', evidencia: '', hijos: [] }])]));
    expect(nodo.textContent).toContain('no falta nada que pedir');
    await act(async () => raiz.unmount());
    nodo.remove();
    await montar(estadoCon([]));
    expect(nodo.textContent).toContain('Todavía no hay hipótesis vivas en el programa.');
  });

  it('no lanza con los datos de muestra', async () => {
    await montar(estadoDeMuestra());
    expect(nodo.querySelector('.des-tablero')).not.toBeNull();
    expect(nodo.querySelectorAll('.des-hip').length).toBeGreaterThan(0);
  });
});

describe('lo que no está al día (rosa/vigencia.py)', () => {
  const sello = (extra: Record<string, unknown> = {}) => ({ en: 1000, regla: REGLA_SUPUESTOS, afirmaciones: 0, fallidos: 0, pedidaEn: null, noAtendida: null, reconstruido: false, ...extra });
  const con = (h: Hipotesis, s: unknown) => ({ ...h, afirmaciones: [], supuestosEvaluados: s }) as unknown as Hipotesis;
  const estadoCorridas = (hs: Hipotesis[], corridas: unknown[] = []) => ({ ...estadoCon(hs), corridas }) as unknown as EstadoRosa;

  it('avisa de cuántos supuestos están por reevaluar y por qué, marca las filas y pide con el alcance de la pantalla', async () => {
    const pedir = vi.spyOn(acciones, 'reevaluarSupuestos').mockResolvedValue(undefined);
    const [h1, h2, h3] = HIPOTESIS;
    await montar(estadoCorridas([con(h1!, sello({ regla: 1 })), con(h2!, sello()), con(h3!, sello({ afirmaciones: -1 }))]));
    const ojo = nodo.querySelector('.des-ojo')!.textContent!;
    // h1: 2 flojos (regla vieja); h3: 2 flojos (evidencia llegada después). h2 al día.
    expect(ojo).toContain('4 de 7 supuestos flojos están por reevaluar');
    expect(ojo).toContain('1 evaluada antes del 18 de septiembre');
    expect(ojo).toContain('1 con evidencia llegada después');
    expect(filaHip('Brecha GFAP y NfL').querySelector('.des-viejo')).not.toBeNull();
    expect(filaHip('Normalización de p-tau181').querySelector('.des-viejo')).toBeNull();
    expect(filaHip('Brecha GFAP y NfL').getAttribute('aria-label')).toContain('por reevaluar');
    expect(nodo.querySelector('.des-pie')!.textContent).toContain('Cuenta 4 supuestos por reevaluar');
    await pulsar(boton(/^Reevaluar 2 hipótesis con la regla de hoy/));
    expect(pedir).toHaveBeenLastCalledWith(null);
    await pulsar(boton(/^Esta investigación/));
    await pulsar(boton(/^Reevaluar 1 hipótesis con la regla de hoy/));
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
    const ojo = nodo.querySelector('.des-ojo')!.textContent!;
    expect(ojo).toContain('1 tiene la reevaluación pedida');
    expect(ojo).toContain('a que la corrida 16 tenga presupuesto');
    expect(ojo).toContain('1 no se pudo hacer: La corrida 3 no tiene presupuesto');
    // Solo la no atendida se puede volver a pedir.
    expect(boton(/^Reevaluar 1 hipótesis con la regla de hoy/)).toBeTruthy();
    await pulsar(filaHip('Brecha GFAP y NfL'));
    const nota = nodo.querySelector('.des-viejo-nota')!.textContent!;
    expect(nota).toContain('Por reevaluar.');
    expect(nota).toContain('Reevaluación pedida el');
  });

  it('con todo al día no hay aviso', async () => {
    await montar(estadoCorridas(HIPOTESIS.map((h) => con(h, sello()))));
    expect(nodo.querySelector('.des-ojo')).toBeNull();
    expect(nodo.querySelector('.des-viejo')).toBeNull();
  });
});
