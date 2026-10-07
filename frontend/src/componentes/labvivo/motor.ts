// El motor del laboratorio en vivo: el lienzo en pixel art, los agentes que
// caminan y hablan, las salas y la cámara que se acerca a quien pide permiso.
// Es imperativo a propósito (un bucle de animación con su reloj propio y
// promesas que esperan a que el reloj avance): React monta el contenedor y le
// pasa los datos reales cada vez que cambian, el motor no los inventa.
//
// La navegación entre salas solo cambia lo que se mira. La actividad, los
// mensajes y los contadores se actualizan desde DatosLab al recibir SSE.

import { tr, trp } from '../../lib/idioma';
import type { TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import './escenas.css';
import { formatearEntero } from '../../lib/formato';
import { ALCANCE } from '../../lib/etiquetas';
import type { ActividadLab, DatosLab, EstadoPasoLab, EstadoSala, FuenteLab, SalaLab } from '../../lib/labVivo';
import urlFondo from '../../assets/labvivo/fondo.png';
import fgZuSK4 from '../../assets/labvivo/fg/ZuSK4.png';
import fgkXLTR from '../../assets/labvivo/fg/kXLTR.png';
import fgjIMNV from '../../assets/labvivo/fg/jIMNV.png';
import fgj8HvCL from '../../assets/labvivo/fg/j8HvCL.png';
import fgAtk5r from '../../assets/labvivo/fg/Atk5r.png';
import fgOYY7v from '../../assets/labvivo/fg/OYY7v.png';
import fgg2cCg4 from '../../assets/labvivo/fg/g2cCg4.png';
import fgW36uP from '../../assets/labvivo/fg/W36uP.png';
import fgnrxJI from '../../assets/labvivo/fg/nrxJI.png';
import fgivrh2 from '../../assets/labvivo/fg/ivrh2.png';

export const ANCHO = 1064;
export const ALTO_VISTA = 1312;
export const ALTO = 1416;

export interface Respuestas {
  conceder: (id: string, alcance: string | null) => Promise<boolean | null>;
  denegar: (id: string) => Promise<boolean | null>;
  aprobarPlan: (iteracionId: string) => Promise<boolean | null>;
  verEnLaCorrida: () => void;
}

export interface Laboratorio {
  actualizar: (d: DatosLab) => void;
  conversar: (turnos: TurnoLaboratorio[], habilitada?: boolean) => void;
  desmontar: () => void;
}

type Sala = 'bib' | 'rec' | SalaLab;
type Obj = 'paper' | 'book' | 'card';

/** Geometría de las salas sobre el fondo (coordenadas del dibujo de 1064 × 1312). */
const GEOM: Record<Sala, [number, number, number, number]> = {
  plan: [0, 0, 416, 280],
  r1: [424, 0, 336, 280],
  bib: [768, 0, 296, 280],
  r2: [0, 288, 624, 312],
  r3: [632, 288, 432, 312],
  r4: [0, 608, 432, 312],
  r5: [440, 608, 624, 312],
  r6: [0, 928, 1064, 200],
  rec: [0, 1136, 1064, 176],
};
const NUMERO: Partial<Record<Sala, number>> = { r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6 };
const COLOR_ESTADO: Record<EstadoSala | 'siempre', { bg: string; c: string }> = {
  listo: { bg: '#1F3B2F', c: '#7FD1A5' },
  ahora: { bg: '#4A2A17', c: '#FFB27A' },
  espera: { bg: '#332B1B', c: '#F2C14E' },
  fallo: { bg: '#3D2326', c: '#E2706A' },
  despues: { bg: '#2A2738', c: '#9C97B3' },
  no_toca: { bg: '#24222E', c: '#77728C' },
  siempre: { bg: '#1E2B3A', c: '#7CC7E8' },
};
/** Las seis estanterías de la biblioteca (esquina superior derecha) y dónde va su cartel. */
const ESTANTE: [number, number][] = [[784, 24], [876, 24], [968, 24], [784, 152], [876, 152], [968, 152]];
const CARTEL: [number, number][] = [[776, 131], [868, 131], [960, 131], [776, 259], [868, 259], [960, 259]];
/** Los colores de la pizarra del plan, renglón a renglón. */
const RENGLON: Record<EstadoPasoLab, { caja: string; linea: string; fondo?: string }> = {
  hecho: { caja: '#3ECF8E', linea: '#5A5670' },
  ahora: { caja: '#E8925A', linea: '#5A5670', fondo: '#F7D9C4' },
  pendiente: { caja: '#B3B0C2', linea: '#B3B0C2' },
  omitido: { caja: '#77728C', linea: '#77728C' },
  fallo: { caja: '#E2706A', linea: '#B3B0C2' },
};

/** Las fuentes en el orden en que las recorren en la biblioteca: la primera
 *  con cifra (la visita el generador), la segunda (el explorador) y en medio
 *  la que no respondió, que el explorador se encuentra de camino. */
function ordenFuentes(fuentes: FuenteLab[]): FuenteLab[] {
  const con = fuentes.filter((f) => !f.fallo), caidas = fuentes.filter((f) => f.fallo);
  return [con[0], con[1], caidas[0], ...con.slice(2), ...caidas.slice(1)].filter((f): f is FuenteLab => f !== undefined).slice(0, ESTANTE.length);
}

const ROL_DE_COLOR: Record<string, 'cerebro' | 'volumen' | 'juez' | 'tu'> = { '#B79CF2': 'cerebro', '#7CC7E8': 'volumen', '#E3A57C': 'juez', '#F4F1EA': 'tu' };

/* nombre|etiqueta|x|y|bata|peinado|piel|pelo|camisa|accesorios|bajada etiqueta|en mesa|qué hace */
const ELENCO = `Puntuador preguntas|Puntuador de relevancia|568|56|#7CC7E8|corto|1|0|0|b|92|1|Lee cada artículo y puntúa si responde a la pregunta.
Puntuador amplitud|Puntuador de relevancia|680|56|#7CC7E8|rizos|3|3|4|g|92|1|Puntúa si el artículo cubre bien el tema, para no quedarse con una sola visión.
Extractor de afirmaciones|Extractor de afirmaciones|456|56|#7CC7E8|largo|0|6|3||92|1|Saca de cada artículo útil frases concretas que se pueden comprobar.
Generador de consultas|Generador de consultas|612|192|#B79CF2|melena|2|2|2|g|66|0|Convierte la pregunta en búsquedas para las bibliotecas.
Explorador|Explorador|692|192|#B79CF2|afro|4|5|1||66|0|Busca fuera de lo obvio y trae fuentes que nadie pidió.
Planificador|Planificador|16|80|#B79CF2|flequillo|1|1|0||66|0|Escribe el plan de la iteración y pide permiso para gastar.
Misión, Áreas y Pregunta|Misión, Áreas y Pregunta|24|174|#B79CF2|rapado|3|4|4|gb|64|0|Fija la misión, las áreas y la pregunta de la investigación.
Proponente de experimento|Proponente de experimento|104|174|#B79CF2|mono|0|0|3||64|0|Propone qué experimento haría falta para salir de dudas.
Aclarador y Respondedor|Aclarador y Respondedor|184|174|#B79CF2|coleta|2|3|2||64|0|Aclara las dudas del plan y responde preguntas.
Reformulador|Reformulador|264|174|#B79CF2|corto|4|6|1|b|64|0|Reescribe la pregunta cuando está mal planteada.
Derivador por contexto|Derivador por contexto|344|174|#B79CF2|rizos|1|2|0|g|64|0|Saca preguntas nuevas a partir de lo que ya se sabe.
Juez|Verificador de afirmaciones|232|340|#E3A57C|melena|0|5|1|g|136|1|Compara cada afirmación con el artículo del que sale y decide si el artículo la sostiene.
Señalizador de sesgo|Señalizador de sesgo|32|424|#E3A57C|melena|0|1|3||86|1|Avisa si una fuente puede estar sesgada.
Asignador de evidencia|Asignador de evidencia|548|364|#7CC7E8|afro|2|4|2||66|0|Lleva cada prueba comprobada a la idea a la que afecta.
Actualizador del modelo de mundo|Actualizador del modelo de mundo|548|472|#B79CF2|flequillo|4|0|1||66|0|Actualiza el mapa de lo que se sabe con lo comprobado.
Analogía|Analogía con otro campo|712|376|#B79CF2|rapado|1|3|0|b|82|1|Busca ideas en campos parecidos.
Contradicción|Contradicción|784|376|#B79CF2|coleta|0|2|3|g|82|1|Parte de lo que no encaja para proponer ideas.
Mecanismo opuesto|Mecanismo opuesto|856|376|#B79CF2|mono|3|6|4|g|82|1|Prueba la idea contraria a la que todos dan por buena.
Otra escala|Otra escala|928|376|#B79CF2|corto|2|5|2|b|82|1|Mira el problema a otra escala: célula, persona, población.
Planificador de análisis|Planificador de análisis|596|770|#B79CF2|rizos|4|1|1||66|0|Decide qué análisis de datos hace falta.
Programador y Reparador|Programador y Reparador|680|770|#B79CF2|largo|1|4|0||66|0|Escribe el código del análisis y lo arregla si falla.
Intérprete|Intérprete|764|770|#E3A57C|melena|3|0|4|g|66|0|Explica qué significa el resultado.
Auditor del análisis|Auditor del análisis|848|770|#E3A57C|afro|0|3|3||66|0|Revisa que el análisis esté bien hecho.
Killer|Killer|18|672|#E3A57C|flequillo|2|6|2||66|0|Intenta tumbar cada idea antes de gastar en ella.
Revisor inicial|Revisor inicial|102|672|#E3A57C|rapado|4|2|1|gb|66|0|Primer filtro: aparta las ideas que no cumplen lo básico.
Evaluador de supuestos|Evaluador de supuestos|186|672|#7CC7E8|mono|1|5|0||66|0|Saca a la luz lo que cada idea da por hecho.
Juez del torneo|Juez del torneo ×2|270|672|#E3A57C|corto|0|4|3|b|66|0|Enfrenta ideas de dos en dos y elige la mejor.
Juez del torneo B|Juez del torneo|306|666|#E3A57C|corto|0|4|3|b|66|0|Enfrenta ideas de dos en dos y elige la mejor.
Juez de viabilidad|Juez de viabilidad|354|672|#E3A57C|rizos|2|0|2||66|0|Decide si la idea se puede probar con lo que hay.
Auditor de descartes|Auditor de descartes|18|792|#B79CF2|largo|4|3|1||66|0|Revisa que no se haya tirado una buena idea.
Concluidor|Concluidor|102|792|#E3A57C|melena|1|6|0||66|0|Cierra cada idea con una conclusión.
Evaluador de resultado|Evaluador de resultado|186|792|#E3A57C|afro|3|2|4|g|66|0|Juzga si el resultado responde a la pregunta.
Tarjeta y Nombre corto|Tarjeta y Nombre corto|270|792|#7CC7E8|flequillo|0|5|3||66|0|Pone a cada idea una tarjeta y un nombre corto.
Resumen en llano|Resumen en llano|354|792|#B79CF2|rapado|2|1|2|b|66|0|Resume cada idea en palabras sencillas.
Revisor del registro|Revisor del registro|52|998|#E3A57C|mono|4|4|1||68|0|Repasa el registro de todo lo que pasó.
Rehacedor|Rehacedor|204|998|#B79CF2|coleta|1|0|0||68|0|Rehace lo que salió mal.
Revisor de la reparación|Revisor de la reparación|356|998|#E3A57C|corto|3|3|4|gb|68|0|Comprueba que lo rehecho quedó bien.
Meta-revisor|Meta-revisor|508|998|#B79CF2|rizos|0|6|3||68|0|Revisa a los revisores.
Revisor del arnés|Revisor del arnés|660|998|#B79CF2|largo|2|2|2|g|68|0|Vigila que el sistema que mueve a los agentes funcione.
Resumidor|Resumidor y Explicador en llano|812|998|#B79CF2|melena|4|5|1||68|0|Resume la iteración para ti, sin jerga.
Auditor de GEPA|Auditor de GEPA|964|998|#E3A57C|afro|1|1|0||68|0|Revisa si los cambios automáticos a las instrucciones mejoran.
Tú|Tú · apruebas y respondes|60|1188|#F4F1EA|mono|1|2|3||100|1|Tú. Apruebas los gastos y respondes cuando te preguntan.
Asistente del chat|Asistente del chat|330|1200|#B79CF2|rapado|0|0|3|ba|86|1|Te responde en el chat sobre la investigación.
Preguntador|Preguntador|568|1220|#B79CF2|mono|2|3|2|a|66|0|Te pregunta cuando necesita tu criterio.
Traductor|Traductor|850|1200|#E3A57C|coleta|4|6|1|a|86|1|Traduce entre español e inglés.`;

/** El nombre propio de cada agente; sale en su ficha al hacer clic. */
const NOMBRE_PROPIO: Record<string, string> = {
  'Puntuador preguntas': 'Tomás', 'Puntuador amplitud': 'Amara', 'Extractor de afirmaciones': 'Ingrid', 'Generador de consultas': 'Lucía',
  Explorador: 'Kofi', Planificador: 'Mateo', 'Misión, Áreas y Pregunta': 'Rashid', 'Proponente de experimento': 'Clara',
  'Aclarador y Respondedor': 'Valentina', Reformulador: 'Jabari', 'Derivador por contexto': 'Noa', Juez: 'Elena',
  'Señalizador de sesgo': 'Marta', 'Asignador de evidencia': 'Diego', 'Actualizador del modelo de mundo': 'Ayo', Analogía: 'Hiroshi',
  Contradicción: 'Freya', 'Mecanismo opuesto': 'Priya', 'Otra escala': 'Santiago', 'Planificador de análisis': 'Zuri',
  'Programador y Reparador': 'Mei', Intérprete: 'Leila', 'Auditor del análisis': 'Oskar', Killer: 'Rocío',
  'Revisor inicial': 'Bayo', 'Evaluador de supuestos': 'Yuki', 'Juez del torneo': 'Pablo', 'Juez del torneo B': 'Pedro',
  'Juez de viabilidad': 'Inés', 'Auditor de descartes': 'Nia', Concluidor: 'Carmen', 'Evaluador de resultado': 'Malik',
  'Tarjeta y Nombre corto': 'Lars', 'Resumen en llano': 'Omar', 'Revisor del registro': 'Imani', Rehacedor: 'Julia',
  'Revisor de la reparación': 'Arjun', 'Meta-revisor': 'Emma', 'Revisor del arnés': 'Camila', Resumidor: 'Ada',
  'Auditor de GEPA': 'Bruno', 'Asistente del chat': 'Iván', Preguntador: 'Paula', Traductor: 'Aisha',
};


/* ---------- sprites: rejilla de 12 × 16 ---------- */
const CUERPO = ['..#BBccBB#..', '.#BBBccBBB#.', '.#BBBccBgB#.', '.#BBBccBBB#.', '.#sBBccBBs#.', '..#BBBBBB#..', '..#PP#.#PP#.', '..#PP#.#PP#.', '..####.####.'];
const CABEZAS: Record<string, string[]> = {
  corto: ['....####....', '...#HHHH#...', '..#HHHHHH#..', '..#HssssH#..', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
  rapado: ['....####....', '...#ssss#...', '..#ssssss#..', '..#HssssH#..', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
  largo: ['....####....', '...#HHHH#...', '..#HHHHHH#..', '..#HssssH#..', '..#HossoH#..', '..#HssssH#..', '..#HHssHH#..', '..#HBccBH#..'],
  afro: ['...######...', '..#HHHHHH#..', '.#HHHHHHHH#.', '.#HHssssHH#.', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
  coleta: ['....####....', '...#HHHH#...', '..#HHHHHH##.', '..#HssssH#H#', '..#sossos#H#', '..#ssssss##.', '...#ssss#...'],
  rizos: ['...##..##...', '..#HH##HH#..', '..#HHHHHH#..', '..#HssssH#..', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
  flequillo: ['....####....', '...#HHHH#...', '..#HHHHHH#..', '..#HHHHsH#..', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
  melena: ['....####....', '...#HHHH#...', '..#HHHHHH#..', '..#HHsssH#..', '..#HossoH#..', '..#HssssH#..', '..#H#ss#H#..'],
  mono: ['....#HH#....', '...#HHHH#...', '..#HHHHHH#..', '..#HssssH#..', '..#sossos#..', '..#ssssss#..', '...#ssss#...'],
};
const PIEL = ['#F6D5B5', '#E9B98F', '#C98D62', '#8E5B3C', '#5E3B27'];
const PELO = ['#2E2A3A', '#5B3A29', '#C9A26B', '#8A3B2E', '#1A1824', '#D9D4CA', '#7A4B2A'];
const CAMISA = ['#F4F1EA', '#2E2A3A', '#C6524A', '#4F8A6B', '#D9C27A'];

/** Los muebles que tapan a quien está sentado: [imagen, x, y, ancho, alto]. */
const DELANTE: [string, number, number, number, number][] = [
  [fgZuSK4, 544, 88, 96, 56], [fgkXLTR, 432, 88, 96, 56], [fgjIMNV, 656, 88, 96, 56], [fgj8HvCL, 144, 396, 224, 72], [fgAtk5r, 16, 464, 80, 40],
  [fgOYY7v, 704, 420, 288, 32], [fgg2cCg4, 24, 1232, 120, 48], [fgW36uP, 306, 1232, 96, 56], [fgnrxJI, 826, 1232, 96, 56], [fgivrh2, 892, 1244, 24, 16],
];

interface Aspecto { s: string; k: number; h: number; c: number; g: boolean; b: boolean; a: boolean }
interface Bocadillo { el: HTMLDivElement; until: number; w?: number }
interface Agente {
  i: number; name: string; quien: string; label: string; hx: number; hy: number; x: number; y: number; coat: string; look: Aspecto; ldy: number; desk: boolean; what: string;
  path: { x: number; y: number }[]; face: number; carry: Obj | null; bub: Bocadillo | null; busy: boolean; typing: number; cool: number;
  room: Sala; ictx: Ctx | null; away: boolean; bob: number; el: HTMLDivElement; lb: HTMLDivElement;
}

const PARAR = { parar: true };

class Ctx {
  dead = false;
  constructor(private readonly esperas: Espera[], private readonly reloj: () => number) {}
  until(cond: () => boolean): Promise<void> {
    return new Promise((res, rej) => {
      if (this.dead) { rej(PARAR); return; }
      this.esperas.push({ c: this, cond, res, rej });
    });
  }
  wait(s: number): Promise<void> {
    const at = this.reloj() + s;
    return this.until(() => this.reloj() >= at);
  }
  kill() { this.dead = true; }
}
interface Espera { c: Ctx; cond: () => boolean; res: () => void; rej: (e: unknown) => void }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function corta(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
const ent = (n: number) => formatearEntero(n);

export function montarLaboratorio(raiz: HTMLElement, inicial: DatosLab, resp: Respuestas): Laboratorio {
  let D = inicial;
  const REDUCIR = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const div = (cls: string, padre: HTMLElement | null, html?: string): HTMLDivElement => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    padre?.appendChild(d);
    return d;
  };

  raiz.innerHTML = `<div class="lv-vista"><div class="lv-mundo"><canvas class="lv-lienzo" width="${ANCHO * 2}" height="${ALTO_VISTA * 2}"></canvas><div class="lv-salas"></div><div class="lv-marcas"></div><div class="lv-agentes"></div><div class="lv-bocadillos"></div></div><div class="lv-ficha" hidden></div><div class="lv-pide" hidden role="dialog" aria-live="assertive"></div></div><div class="lv-barra"><div class="lv-capitulos"></div><div class="lv-pie"><button type="button" class="lv-play"></button><div class="lv-texto"><div class="lv-capk"></div><div class="lv-capt"></div></div><div class="lv-suceso"></div><div class="lv-velocidad"><button type="button" data-s="1" class="on">1×</button><button type="button" data-s="2">2×</button></div></div></div>`;
  const q = <T extends HTMLElement = HTMLDivElement>(s: string) => raiz.querySelector(s) as T;
  const vista = q('.lv-vista'), mundo = q('.lv-mundo'), capaSalas = q('.lv-salas'), capaMarcas = q('.lv-marcas'), capaAgentes = q('.lv-agentes'), capaBocadillos = q('.lv-bocadillos');
  const ficha = q('.lv-ficha'), pideEl = q('.lv-pide'), capitulos = q('.lv-capitulos'), botonPlay = q<HTMLButtonElement>('.lv-play'), capk = q('.lv-capk'), capt = q('.lv-capt'), suceso = q('.lv-suceso');
  const cv = q<HTMLCanvasElement>('.lv-lienzo');
  const g = cv.getContext('2d');

  /* ---------- reloj ---------- */
  let simT = 0, speed = 1, playing = true, vivo = true;
  const ESPERAS: Espera[] = [];
  const reloj = () => simT;
  const nuevoCtx = () => new Ctx(ESPERAS, reloj);
  const spawn = (p: Promise<unknown>) => { p.catch((e) => { if (e !== PARAR) console.error(e); }); };
  function processWaits() {
    for (let i = ESPERAS.length - 1; i >= 0; i--) {
      const w = ESPERAS[i]!;
      if (w.c.dead) { ESPERAS.splice(i, 1); w.rej(PARAR); }
      else if (w.cond()) { ESPERAS.splice(i, 1); w.res(); }
    }
  }

  /* ---------- textos ---------- */
  const TITULO_SALA: Partial<Record<Sala, string>> = { plan: tr('El plan'), r1: tr('Buscan y leen artículos'), r2: tr('Comprueban cada dato'), r3: tr('Proponen ideas nuevas'), r4: tr('Juzgan las ideas'), r5: tr('Las prueban con datos'), r6: tr('Revisan el trabajo'), rec: tr('Hablan contigo') };
  const estadoDe = (s: Sala): EstadoSala | 'siempre' => (s === 'bib' ? 'listo' : s === 'rec' ? 'siempre' : D.salas[s]);
  const NOMBRE_ESTADO: Record<EstadoSala | 'siempre', string> = { listo: tr('Listo'), ahora: tr('Ahora'), despues: tr('Después'), no_toca: tr('No toca'), espera: tr('En espera'), fallo: tr('Falló'), siempre: tr('Siempre') };
  // Con la corrida parada, la sala en foco es donde se quedó, no algo que esté pasando.
  const nombreEstado = (e: EstadoSala | 'siempre'): string => (e === 'ahora' && !D.trabajando ? tr('Aquí paró') : NOMBRE_ESTADO[e]);
  const leyenda = (e: EstadoSala | 'siempre'): string => {
    if (e === 'espera') return D.estadoTexto;
    if (e === 'fallo') return tr('Esta etapa registró un fallo');
    if (e === 'listo') return tr('Ya pasó en esta iteración');
    if (e === 'ahora' && !D.trabajando) return D.iteracion !== null ? trp('Aquí se quedó la iteración {n} · así trabajan', { n: D.iteracion }) : tr('Aquí se quedó · así trabajan');
    if (e === 'ahora') return D.iteracion !== null ? trp('Está pasando ahora · iteración {n}', { n: D.iteracion }) : tr('Está pasando ahora');
    if (e === 'no_toca') return tr('Sin trabajo ejecutado en esta sala');
    if (e === 'despues') return tr('Todavía no ha llegado');
    return tr('Siempre');
  };
  const modeloDe = (coat: string): string => {
    const rol = ROL_DE_COLOR[coat];
    if (rol === 'tu') return tr('Tú');
    if (rol === 'cerebro') return trp('{m} · cerebro: planea y piensa', { m: D.modelos.cerebro ?? tr('modelo cerebro') });
    if (rol === 'volumen') return trp('{m} · volumen: lee mucho, rápido', { m: D.modelos.volumen ?? tr('modelo de volumen') });
    return trp('{m} · juez: decide', { m: D.modelos.juez ?? tr('modelo juez') });
  };

  /* ---------- sprites ---------- */
  const SPR = new Map<string, HTMLCanvasElement>();
  function sprite(a: Agente, frame: number): HTMLCanvasElement {
    const key = a.i + '-' + frame;
    const hecho = SPR.get(key);
    if (hecho) return hecho;
    const L = a.look, head = CABEZAS[L.s] ?? CABEZAS.corto!;
    const rej = [...head, ...CUERPO.slice(head.length - 7)].map((r) => r.split(''));
    const fila = (y: number) => rej[y]!;
    if (frame === 1) for (let x = 2; x < 6; x++) { fila(14)[x] = '#'; fila(15)[x] = '.'; }
    if (frame === 2) for (let x = 7; x < 11; x++) { fila(14)[x] = '#'; fila(15)[x] = '.'; }
    const pal: Record<string, string> = { '#': '#17131F', H: PELO[L.h]!, s: PIEL[L.k]!, o: '#17131F', B: a.coat, c: CAMISA[L.c]!, g: '#F4F1EA', P: '#3A3550' };
    const c = document.createElement('canvas');
    c.width = 12; c.height = 16;
    const x = c.getContext('2d');
    if (x) {
      const px = (i: number, j: number, col: string) => { x.fillStyle = col; x.fillRect(i, j, 1, 1); };
      rej.forEach((r, j) => r.forEach((ch, i) => { const col = pal[ch]; if (col) px(i, j, col); }));
      if (L.b) [[3, 5], [5, 5], [6, 5], [8, 5], [4, 6], [5, 6], [6, 6], [7, 6]].forEach(([i, j]) => px(i!, j!, PELO[L.h]!));
      else { px(5, 5, '#B5654A'); px(6, 5, '#B5654A'); }
      if (L.g) { [[3, 4], [5, 4], [6, 4], [8, 4]].forEach(([i, j]) => px(i!, j!, '#17131F')); [[4, 4], [7, 4]].forEach(([i, j]) => px(i!, j!, '#CFE6FF')); }
      if (L.a) [[4, 0], [5, 0], [6, 0], [7, 0], [2, 3], [2, 4], [9, 3], [9, 4], [3, 6]].forEach(([i, j]) => px(i!, j!, '#F2C14E'));
    }
    SPR.set(key, c);
    return c;
  }

  /* ---------- agentes ---------- */
  const salaDe = (x: number, y: number): Sala => {
    for (const k of Object.keys(GEOM) as Sala[]) {
      const r = GEOM[k];
      if (x + 24 >= r[0] && x + 24 < r[0] + r[2] && y + 40 >= r[1] && y + 40 < r[1] + r[3]) return k;
    }
    return 'rec';
  };
  const AG: Agente[] = ELENCO.trim().split('\n').map((l, i) => {
    const f = l.split('|');
    const hx = Number(f[2]), hy = Number(f[3]), acc = f[9] ?? '';
    const nombre = f[0]!;
    const el = div('lv-ag' + (nombre === 'Juez del torneo B' ? ' twin' : ''), capaAgentes);
    const lb = div('lv-lbl', el, esc(tr(f[1]!)));
    return {
      i, name: nombre, quien: NOMBRE_PROPIO[nombre] ?? '', label: tr(f[1]!), hx, hy, x: hx, y: hy, coat: f[4]!, look: { s: f[5]!, k: Number(f[6]), h: Number(f[7]), c: Number(f[8]), g: acc.includes('g'), b: acc.includes('b'), a: acc.includes('a') },
      ldy: Number(f[10]), desk: f[11] === '1', what: tr(f[12]!), path: [], face: 1, carry: null, bub: null, busy: false, typing: 0, cool: 0,
      room: salaDe(hx, hy), ictx: null, away: false, bob: 0, el, lb,
    };
  });
  const P = (n: string): Agente => AG.find((a) => a.name === n) ?? AG[0]!;
  const atHome = (a: Agente) => a.path.length === 0 && Math.abs(a.x - a.hx) < 1 && Math.abs(a.y - a.hy) < 1;

  function walk(ctx: Ctx, a: Agente, pts: [number, number][]) {
    if (ctx.dead) return Promise.reject(PARAR);
    a.path = pts.map(([x, y]) => ({ x, y })); return ctx.until(() => a.path.length === 0);
  }
  function home(ctx: Ctx, a: Agente) {
    const pts: [number, number][] = [];
    if (Math.abs(a.y - a.hy) > 1 && Math.abs(a.x - a.hx) > 1) pts.push([a.x, a.hy]);
    pts.push([a.hx, a.hy]);
    return walk(ctx, a, pts);
  }
  function say(a: Agente, html: string, dur = 2.2, kind = '') {
    a.bub?.el.remove();
    a.bub = { el: div('lv-bub ' + kind, capaBocadillos, html), until: simT + dur };
  }
  function type(a: Agente, s: number) { a.typing = simT + s; }

  interface Vuelo { kind: Obj; from: number[]; to: number[]; t0: number; dur: number; arc: number }
  const FLY: Vuelo[] = [];

  /* ---------- salas y marcas ---------- */
  const salaEl = {} as Record<Sala, HTMLDivElement>;
  const placaEl: Partial<Record<Sala, HTMLDivElement>> = {};
  for (const k of Object.keys(GEOM) as Sala[]) {
    const r = GEOM[k];
    const d = div('lv-sala', capaSalas);
    d.style.cssText = `left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px`;
    salaEl[k] = d;
    if (TITULO_SALA[k]) placaEl[k] = div('lv-placa' + (NUMERO[k] ? '' : ' nonum'), d);
  }
  function pintarSalas() {
    for (const k of Object.keys(placaEl) as Sala[]) {
      const st = COLOR_ESTADO[estadoDe(k)], n = NUMERO[k];
      placaEl[k]!.innerHTML = (n ? `<div class="num" style="background:${st.c}">${n}</div>` : '') + `<div class="t">${esc(TITULO_SALA[k]!)}</div><div class="pill" style="background:${st.bg};color:${st.c}"><i></i>${esc(nombreEstado(estadoDe(k)))}</div>`;
    }
  }

  const TAG: Record<string, HTMLDivElement> = {};
  const marca = (id: string, x: number, y: number, color: string) => { const t = div('lv-tag', capaMarcas); t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.color = color; TAG[id] = t; };
  marca('sirven', 514, 184, '#7FD1A5'); marca('van', 514, 214, '#F4F1EA'); marca('cola', 380, 372, '#C9C4DA');
  marca('S', 96, 580, '#7FD1A5'); marca('P', 208, 580, '#F2C14E'); marca('N', 322, 580, '#E2706A'); marca('X', 436, 580, '#9C97B3'); marca('lleva', 380, 444, '#FFB27A');
  CARTEL.forEach(([x, y], i) => { marca('f' + i, x, y, '#F4F1EA'); TAG['f' + i]!.classList.add('cartel'); });
  marca('pizarra', 186, 153, '#F4F1EA');
  const poner = (id: string, html: string | null) => { const t = TAG[id]!; t.innerHTML = html ?? ''; t.style.visibility = html ? 'visible' : 'hidden'; };
  function pintarMarcas() {
    const { resultados, sirven } = D.lectura, j = D.juez, v = j.veredictos;
    const orden = ordenFuentes(D.fuentes);
    CARTEL.forEach((_, i) => {
      const f = orden[i];
      poner('f' + i, f ? `<span>${esc(f.nombre)}</span> ${f.fallo ? `<span style="color:#E2706A">${esc(tr('no responde'))}</span>` : f.salen !== null ? `<span style="color:#7CC7E8">${ent(f.salen)}</span>` : ''}` : null);
    });
    const ec = D.pasos.enCurso;
    poner('pizarra', ec ? `<span style="color:#E8925A">●</span> ${esc(trp('Paso {n} de {m}: {t}', { n: ec.n, m: D.pasos.total, t: corta(ec.titulo, 34) }))}`
      : D.pasos.total > 0 ? esc(D.pasos.estados.every((e) => e === 'hecho') ? trp('Los {m} pasos, hechos', { m: D.pasos.total }) : trp('Plan de {m} pasos', { m: D.pasos.total })) : null);
    poner('sirven', sirven !== null && resultados !== null ? trp('<b>{n}</b> de {m} sirven', { n: ent(sirven), m: ent(resultados) }) : null);
    const alJuez = j.total;
    poner('van', alJuez !== null ? trp('<b>{n}</b> van al juez', { n: ent(alJuez) }) : null);
    const faltan = j.total !== null && j.hechas !== null ? j.total - j.hechas : null;
    poner('cola', faltan !== null && faltan > 0 ? trp('Faltan <b>{n}</b>', { n: ent(faltan) }) : null);
    poner('lleva', j.hechas !== null && j.total !== null && j.hechas < j.total ? trp('Lleva <b>{n}</b> de {m}', { n: ent(j.hechas), m: ent(j.total) }) : null);
    const bin = (k: string, nombre: string, n: number | null) => poner(k, n !== null ? `${esc(nombre)} <b>${ent(n)}</b>` : esc(nombre));
    bin('S', tr('Sostenida'), v ? v.sostenida : null);
    bin('P', tr('Parcial'), v ? v.parcial : null);
    bin('N', tr('No sostenida'), v ? v.no_sostenida : null);
    bin('X', tr('Otros veredictos'), v ? v.otras : null);
  }
  const STAMPS: Bocadillo[] = [];
  const setEv = (html: string) => { suceso.innerHTML = html || '&nbsp;'; };

  /* ---------- cámara y fichas ---------- */
  // La cámara se centra en quien miras y lo sigue cuando camina. El centro es
  // el de la parte del laboratorio que se ve en pantalla, que puede ser más
  // alto que la ventana. Guarda qué punto del mundo queda en ese centro.
  let sel: Agente | null = null, asking = false, mira: Agente | null = null, miraS = 1;
  const cam = { s: 1, cx: ANCHO / 2, cy: ALTO_VISTA / 2, tx: 0, ty: 0 };
  const vis = { x: ANCHO / 2, y: ALTO_VISTA / 2, k: 1, izq: 0, der: ANCHO, arr: 0, aba: ALTO_VISTA };
  function medirVisible() {
    const r = vista.getBoundingClientRect(), k = r.width / ANCHO || 1;
    const arr = Math.max(0, -r.top / k), aba = Math.min(ALTO_VISTA, (window.innerHeight - r.top) / k);
    const izq = Math.max(0, -r.left / k), der = Math.min(ANCHO, (window.innerWidth - r.left) / k);
    Object.assign(vis, aba - arr > 80 ? { arr, aba } : { arr: 0, aba: ALTO_VISTA }, der - izq > 80 ? { izq, der } : { izq: 0, der: ANCHO }, { k });
    vis.x = (vis.izq + vis.der) / 2; vis.y = (vis.arr + vis.aba) / 2;
  }
  function zoomTo(a: Agente, s: number) { mira = a; miraS = s; }
  function zoomOut() { mira = null; miraS = 1; }
  function camara(dt: number) {
    medirVisible();
    const s = mira ? miraS : 1;
    let cx = mira ? mira.x + 24 : vis.x, cy = mira ? mira.y + 32 : vis.y;
    if (mira) {
      // Centrado en el agente, pero sin dejar más de BORDE de vacío fuera del laboratorio.
      const BORDE = 32, ajusta = (c: number, a: number, b: number, total: number) => {
        const lo = a / s - BORDE, hi = total + BORDE - b / s;
        return lo > hi ? total / 2 : Math.min(hi, Math.max(lo, c));
      };
      cx = ajusta(cx, vis.x - vis.izq, vis.der - vis.x, ANCHO);
      cy = ajusta(cy, vis.y - vis.arr, vis.aba - vis.y, ALTO_VISTA);
    }
    const f = REDUCIR ? 1 : 1 - Math.exp(-dt * 5);
    cam.s += (s - cam.s) * f; cam.cx += (cx - cam.cx) * f; cam.cy += (cy - cam.cy) * f;
    if (!mira && Math.abs(cam.s - 1) < 0.002) { cam.s = 1; cam.cx = vis.x; cam.cy = vis.y; }
    cam.tx = vis.x - cam.cx * cam.s; cam.ty = vis.y - cam.cy * cam.s;
    mundo.style.transform = cam.s === 1 ? '' : `translate(${cam.tx}px,${cam.ty}px) scale(${cam.s})`;
    // Ficha y petición se ven a su tamaño aunque el laboratorio esté encogido.
    const kf = Math.min(1.8, Math.max(1, 1 / vis.k));
    pideEl.style.scale = String(kf);
    pideEl.style.bottom = ALTO_VISTA - vis.aba + 24 + 'px';
    colocarFicha(kf);
  }
  /** La ficha muestra la voz generada; el registro técnico se consulta en el historial. */
  function haciendo(a: Agente): string {
    if (a.bub?.el.classList.contains('ask')) return tr('Necesito tu permiso');
    if (D.conexion !== 'en_linea') return tr('No estoy recibiendo actualizaciones de la corrida.');
    if (!D.trabajando) return D.estadoTexto;
    const comentario = ultimaCharla.get(a.name);
    return comentario?.texto ?? tr(D.activos.includes(a.name) ? 'Preparando el siguiente intercambio' : 'Esperan nuevos hallazgos');
  }
  let fichaDe: Agente | null = null, fichaTexto = '';
  function refrescarFicha() {
    if (!fichaDe || ficha.hidden) return;
    const t = haciendo(fichaDe);
    if (t === fichaTexto) return;
    fichaTexto = t;
    const el = ficha.querySelector<HTMLElement>('.lv-ahora b');
    if (!el) return;
    el.textContent = t;
    el.classList.remove('nuevo'); void el.offsetWidth; el.classList.add('nuevo');
  }
  /** La ficha va al lado del agente, por dentro de lo que se ve, y lo acompaña si se mueve. */
  function colocarFicha(kf: number) {
    const a = fichaDe;
    if (!a || ficha.hidden) return;
    ficha.style.scale = String(kf);
    const w = ficha.offsetWidth * kf, h = ficha.offsetHeight * kf;
    const ax = cam.tx + (a.x + 24) * cam.s, ay = cam.ty + (a.y + 32) * cam.s, mx = 24 * cam.s + 14, my = 32 * cam.s + 14;
    const enX = (x: number) => Math.max(vis.izq + 10, Math.min(x, vis.der - w - 10));
    const enY = (y: number) => Math.max(vis.arr + 10, Math.min(y, vis.aba - h - 10));
    // A un lado si cabe; si no, debajo o encima, para no tapar al agente.
    let x: number, y: number;
    if (ax + mx + w <= vis.der - 10) { x = ax + mx; y = enY(ay - h / 2); }
    else if (ax - mx - w >= vis.izq + 10) { x = ax - mx - w; y = enY(ay - h / 2); }
    else if (ay + my + h <= vis.aba - 10) { x = enX(ax - w / 2); y = ay + my; }
    else { x = enX(ax - w / 2); y = enY(ay - my - h); }
    ficha.style.left = x + 'px'; ficha.style.top = y + 'px';
  }
  function showCard(a: Agente) {
    const est = estadoDe(a.room), st = COLOR_ESTADO[est], n = NUMERO[a.room];
    fichaDe = a; fichaTexto = haciendo(a);
    const rol = a.label.replace(' ×2', '');
    const nombre = a.quien || rol;
    ficha.style.setProperty('--c', a.coat);
    ficha.innerHTML = `<div class="lv-f-cab"><div class="lv-retrato"><canvas width="12" height="11"></canvas></div><div class="lv-f-id"><h4>${esc(nombre)}</h4>${a.quien ? `<div class="lv-rol">${esc(rol)}</div>` : ''}<div class="lv-modelo"><i></i>${esc(modeloDe(a.coat))}</div></div></div>`
      + `<div class="lv-ahora${D.trabajando ? ' vivo' : ''}"><span><i></i>${esc(D.trabajando ? tr('Ahora mismo') : tr('En la escena'))}</span><b>${esc(fichaTexto)}</b></div>`
      + `<div class="lv-f-que"><span>${esc(tr('Su trabajo'))}</span>${esc(a.what)}</div>`
      + (ultimaCharla.has(a.name) ? `<div class="lv-f-que lv-charla"><span>${esc(tr('Último comentario a un compañero'))}</span>${esc(ultimaCharla.get(a.name)!.texto)}</div>` : '')
      + `<div class="lv-f-sala">${n ? `<div class="num" style="background:${st.c}">${n}</div>` : ''}<div class="t">${esc(TITULO_SALA[a.room] ?? tr('Biblioteca'))}</div><div class="pill" style="background:${st.bg};color:${st.c}"><i></i>${esc(nombreEstado(est))}</div></div>`;
    const lienzoRetrato = ficha.querySelector('canvas')?.getContext('2d');
    if (lienzoRetrato) lienzoRetrato.drawImage(sprite(a, 0), 0, 0, 12, 11, 0, 0, 12, 11);
    ficha.hidden = false;
    colocarFicha(Math.min(1.8, Math.max(1, 1 / vis.k)));
  }

  /* ---------- navegación y actividad del registro ---------- */
  const CH: { room: SalaLab; title: string; chip?: HTMLButtonElement }[] = [
    { room: 'plan', title: tr('El plan') }, { room: 'r1', title: tr('Buscan y leen') },
    { room: 'r2', title: tr('Comprueban datos') }, { room: 'r3', title: tr('Proponen ideas') },
    { room: 'r4', title: tr('Las juzgan') }, { room: 'r5', title: tr('Las prueban') }, { room: 'r6', title: tr('Revisan todo') },
  ];
  const capituloDe = (s: SalaLab) => Math.max(0, CH.findIndex((c) => c.room === s));
  let chIdx = capituloDe(D.foco);
  let hoja = false, conv = 0;
  const vistas = new Map<string, string>();
  let identidad = D.identidad;
  // La coreografía continúa entre mensajes del servidor. Estas escenas no
  // añaden actividad al registro ni convierten a un compañero en trabajador.
  interface Escena { ctx: Ctx; agentes: Agente[]; trabajo: boolean; temaId?: string; listos?: boolean; hasta?: number; esperarHasta?: number; saliendo?: boolean }
  const escenas = new Map<Agente, Escena>();
  const dialogos: TurnoLaboratorio[] = [], dialogosVistos = new Set<string>();
  const ultimaCharla = new Map<string, TurnoLaboratorio>();
  const proximaEscena = new Map<Agente, number>();
  let rondaEscena = 0, proximoPaseo = 1.5;
  function cancelarEscena(a: Agente) {
    const escena = escenas.get(a);
    if (!escena) return;
    escena.ctx.kill();
    for (const b of escena.agentes) {
      if (escenas.get(b) !== escena) continue;
      escenas.delete(b);
      if (b.ictx !== escena.ctx) continue;
      b.ictx = null; b.busy = false; b.path = []; b.carry = null;
      b.typing = 0;
      if (b.bub?.el.dataset.escena) { b.bub.el.remove(); b.bub = null; }
      delete b.el.dataset.escena;
    }
  }
  const escenaDisponible = () => vivo && !REDUCIR && !asking && D.trabajando && D.conexion === 'en_linea'
    && !raiz.querySelector('.lv-narra:not([hidden])');
  const libreParaEscena = (a: Agente) => !a.ictx && !a.busy && !a.bub && !escenas.has(a);
  const actividadDe = (a: Agente) => [...D.actividad].reverse().find((e) => e.agente === a.name && e.enCurso);
  function hablarEnEscena(a: Agente, b: Agente | null, texto: string, dur: number) {
    const destinatario = b ? trp('Para {nombre}', { nombre: b.quien || b.label }) : tr('En la escena');
    say(a, `<em>${esc(destinatario)}</em>${esc(corta(texto, 220))}`, dur, 'escena');
    if (a.bub) {
      a.bub.el.dataset.escena = 'dialogo';
      a.bub.el.dataset.agente = a.name;
      if (b) a.bub.el.dataset.interlocutor = b.name;
      a.bub.el.title = texto;
    }
  }
  // Pasillos bajo las mesas, sin cruzar las paredes ni las cajas de evidencia.
  function pasillo(a: Agente): number {
    const suelo: Partial<Record<Sala, number>> = { r1: 192, r2: a.hy < 400 ? 412 : 516, r3: 472, r4: a.hy < 750 ? 708 : 820, r5: 806, r6: 1034 };
    return suelo[a.room] ?? Math.min(GEOM[a.room][1] + GEOM[a.room][3] - 76, a.hy + 28);
  }
  function desplazarse(ctx: Ctx, a: Agente, x: number, y: number) {
    // Quienes están sentados salen por el lado de su mesa antes de bajar.
    const salida = a.desk && atHome(a) ? [[a.hx - 12, a.hy] as [number, number]] : [];
    return walk(ctx, a, [...salida, [salida.length ? a.hx - 12 : a.x, y], [x, y]]);
  }
  function empezarEscena(a: Agente, trabajo: boolean) {
    const companeros = AG.filter((b) => b !== a && b.room === a.room && b.name !== 'Tú' && libreParaEscena(b) && (trabajo || !D.activos.includes(b.name)));
    const b = companeros.length ? companeros[rondaEscena % companeros.length]! : null;
    const ctx = nuevoCtx(), participantes = b ? [a, b] : [a];
    const escena: Escena = { ctx, agentes: participantes, trabajo };
    const turno = rondaEscena++;
    participantes.forEach((p) => { escenas.set(p, escena); p.ictx = ctx; p.busy = true; p.el.dataset.escena = D.activos.includes(p.name) ? 'trabajo' : 'espera'; });
    const [rx, , rw] = GEOM[a.room], izquierda = rx + 12, derecha = rx + rw - 62;
    const centro = b ? (a.hx + b.hx) / 2 : a.hx + (turno % 2 ? -40 : 40);
    const x = Math.max(izquierda, Math.min(derecha - (b ? 60 : 0), centro - (b ? 30 : 0)));
    const y = pasillo(a);
    const esperar = async (s: number) => { await ctx.wait(s); if (ctx.dead) throw PARAR; };
    spawn((async () => {
      try {
        if (trabajo) a.carry = actividadDe(a)?.tipo === 'resultado' ? 'paper' : 'card';
        await Promise.all([desplazarse(ctx, a, x, y), ...(b ? [desplazarse(ctx, b, x + 60, y)] : [])]);
        if (ctx.dead) throw PARAR;
        a.face = 1; if (b) b.face = -1;
        // El reloj solo anima. Lo que se dicen viene del servicio de conversación.
        if (trabajo) type(a, 4);
        await esperar(trabajo ? 4.5 : 3);
        a.carry = null;
        await Promise.all(participantes.map((p) => desplazarse(ctx, p, p.hx, pasillo(p))));
        await Promise.all(participantes.map((p) => home(ctx, p)));
      } finally {
        for (const p of participantes) {
          // Una entrada SSE nueva puede haber sustituido esta escena.
          if (escenas.get(p) !== escena) continue;
          escenas.delete(p);
          if (p.ictx !== ctx) continue;
          p.ictx = null; p.busy = false; p.path = []; p.carry = null;
          delete p.el.dataset.escena;
          proximaEscena.set(p, simT + 3 + p.i % 5);
        }
      }
    })());
  }
  function mostrarDialogo(t: TurnoLaboratorio, a: Agente, b: Agente, dur: number) {
    hablarEnEscena(a, b, t.texto, dur);
    a.bub?.el.setAttribute('data-turno', t.id);
    ultimaCharla.set(a.name, t);
    setEv(esc(t.texto));
    if (fichaDe === a && !ficha.hidden) showCard(a);
  }
  function mantenerDialogos() {
    let charla = [...escenas.values()].find((e) => e.temaId);
    const siguiente = dialogos[0];
    if (charla?.saliendo) return;
    if (charla && simT < (charla.hasta ?? 0)) return;
    if (charla && (!siguiente || siguiente.temaId !== charla.temaId)) {
      if (!siguiente && simT < (charla.esperarHasta ?? 0)) return;
      const anterior = charla; anterior.saliendo = true;
      spawn((async () => {
        try { await Promise.all(anterior.agentes.map((a) => home(anterior.ctx, a))); }
        finally { if (escenas.get(anterior.agentes[0]!) === anterior) cancelarEscena(anterior.agentes[0]!); }
      })());
      return;
    }
    if (!siguiente) return;
    const a = AG.find((x) => x.name === siguiente.agente), b = AG.find((x) => x.name === siguiente.destinatario);
    if (!a || !b || a.room !== b.room) { dialogos.shift(); return; }
    if (!charla) {
      [a, b].forEach((p) => { cancelarEscena(p); p.ictx?.kill(); p.path = []; p.bub?.el.remove(); p.bub = null; });
      const ctx = nuevoCtx(); charla = { ctx, agentes: [a, b], trabajo: true, temaId: siguiente.temaId, listos: false };
      const nueva = charla;
      [a, b].forEach((p) => { escenas.set(p, nueva); p.ictx = ctx; p.busy = true; p.el.dataset.escena = 'conversacion'; });
      const [rx, , rw] = GEOM[a.room], x = Math.max(rx + 12, Math.min(rx + rw - 122, (a.hx + b.hx) / 2 - 30)), y = pasillo(a);
      spawn((async () => {
        await Promise.all([desplazarse(ctx, a, x, y), desplazarse(ctx, b, x + 60, y)]);
        if (ctx.dead) throw PARAR;
        a.face = 1; b.face = -1; nueva.listos = true;
      })());
    }
    if (!charla.listos) return;
    dialogos.shift();
    const dur = Math.max(7, Math.min(14, siguiente.texto.length / 26));
    mostrarDialogo(siguiente, a, b, dur);
    charla.hasta = simT + dur + 0.5; charla.esperarHasta = charla.hasta + 15;
    a.carry = 'card'; b.carry = null;
    FLY.push({ kind: 'card', from: [a.x + 42, a.y + 44], to: [b.x + 6, b.y + 44], t0: simT, dur: 0.7, arc: 18 });
  }
  function mantenerEscenas() {
    if (!escenaDisponible()) { [...escenas.keys()].forEach(cancelarEscena); return; }
    mantenerDialogos();
    for (const a of AG) {
      if (D.activos.includes(a.name) && libreParaEscena(a) && simT >= (proximaEscena.get(a) ?? 0)) empezarEscena(a, true);
    }
    // Dos encuentros de espera como máximo: el foco sigue siendo la tarea real.
    const esperas = new Set([...escenas.values()].filter((e) => !e.trabajo)).size;
    if (simT < proximoPaseo || esperas >= 2) return;
    proximoPaseo = simT + 3;
    const libres = AG.filter((a) => a.room !== 'rec' && !D.activos.includes(a.name) && !AG.some((b) => b.room === a.room && D.activos.includes(b.name))
      && ![...escenas.keys()].some((b) => b.room === a.room) && libreParaEscena(a) && simT >= (proximaEscena.get(a) ?? 0));
    const sala = rondaEscena % 3 === 0 ? D.foco : libres[rondaEscena % Math.max(1, libres.length)]?.room;
    const a = libres.find((p) => p.room === sala);
    if (a) empezarEscena(a, false);
  }
  function pararActividad() {
    [...escenas.keys()].forEach(cancelarEscena);
    proximaEscena.clear(); proximoPaseo = simT + 1.5;
    AG.forEach((a) => {
      a.ictx?.kill(); a.ictx = null; a.busy = false; a.path = [];
      a.carry = null; a.away = false; a.typing = 0;
      a.bub?.el.remove(); a.bub = null;
    });
    FLY.length = 0; STAMPS.forEach((s) => s.el.remove()); STAMPS.length = 0;
    hoja = false;
    processWaits();
  }
  function anunciar(e: ActividadLab, animar: boolean) {
    const a = P(e.agente);
    // El registro permanece en el historial. Solo la IA pone voz a los personajes.
    setEv(esc(e.texto));
    // Una actualización no interrumpe una caminata ni una conversación en curso.
    if (!animar || REDUCIR || escenas.has(a) || a.ictx) return;
    const ctx = nuevoCtx(); a.ictx = ctx;
    a.busy = true;
    spawn((async () => {
      try {
        if ((a.name === 'Generador de consultas' || a.name === 'Explorador') && e.tipo === 'accion') {
          const indice = Math.max(0, ordenFuentes(D.fuentes).findIndex((f) => e.fuente.includes(f.nombre)));
          const destino = ESTANTE[indice]!;
          await walk(ctx, a, [[a.x, 268], [destino[0], 268], [destino[0], destino[1] + 60]]);
          await ctx.wait(1); await home(ctx, a);
        } else if (!a.desk) {
          const [rx, , rw] = GEOM[a.room];
          await desplazarse(ctx, a, Math.min(rx + rw - 62, a.hx + 56), pasillo(a));
          if (ctx.dead) throw PARAR;
          type(a, 3); await ctx.wait(3); await home(ctx, a);
        } else { type(a, 4); await ctx.wait(4); }
      } finally {
        if (a.ictx === ctx) { a.busy = false; a.ictx = null; a.carry = null; }
      }
    })());
  }
  function sincronizarActividad(inicial = false) {
    const nuevas = D.actividad.filter((e) => vistas.get(e.id) !== e.texto);
    vistas.clear(); D.actividad.forEach((e) => vistas.set(e.id, e.texto));
    const porAgente = new Map<string, ActividadLab>();
    nuevas.forEach((e) => { if (!inicial || (e.enCurso && D.activos.includes(e.agente))) porAgente.set(e.agente, e); });
    if (D.conexion === 'en_linea' && !asking) {
      [...porAgente.values()].slice(-6).forEach((e) => anunciar(e, D.trabajando && D.activos.includes(e.agente)));
    }
    AG.forEach((a) => {
      a.el.dataset.agente = a.name;
      a.el.setAttribute('aria-label', a.label + ': ' + haciendo(a));
      a.el.classList.toggle('activo', D.activos.includes(a.name));
    });
    hoja = D.activos.includes('Juez');
    processWaits();
    paintChapter();
  }

  /* ---------- quien pide permiso: la cámara va a por él ---------- */
  let pidiendo: string | null = null;
  const descartadas = new Set<string>();
  function mostrarPeticion() {
    const p = D.pide;
    if (!p || descartadas.has(p.id) || pidiendo === p.id) return;
    pararActividad();
    pidiendo = p.id; asking = true; sel = null; ficha.hidden = true;
    const quien = P(p.quien);
    quien.face = -1;
    say(quien, esc(p.clase === 'plan' ? tr('¿Me apruebas el plan?') : tr('¿Me das permiso?')), 3600, 'ask');
    zoomTo(quien, 2.3);
    setEv(esc(trp('{q} necesita tu respuesta', { q: quien.label })));
    if (p.clase === 'plan') {
      pideEl.innerHTML = `<div class="k">${esc(tr('El planificador te enseña el plan'))}</div><h3>${esc(trp('El plan tiene {m} pasos', { m: D.pasos.total }))}</h3><ol class="plan">${D.pasos.lista.map((paso) => `<li><b>${esc(paso.titulo)}</b>${paso.detalle ? `<small>${esc(paso.detalle)}</small>` : ''}</li>`).join('')}</ol><div class="row"><button type="button" class="no" data-a="ver">${esc(tr('Revisarlo en la corrida'))}</button><button type="button" class="yes" data-a="plan">${esc(tr('Aprobar el plan'))}</button></div><button type="button" class="luego" data-a="luego">${esc(tr('Ahora no'))}</button>`;
    } else {
      pideEl.innerHTML = `<div class="k">${esc(trp('{q} pide permiso', { q: quien.label }))}</div><h3>${esc(p.titulo)}</h3><p>${esc(p.detalle)}</p>${p.alcances.length ? `<label>${esc(tr('Alcance del permiso'))}<select class="lv-alcance">${p.alcances.map((a) => `<option value="${esc(a)}">${esc(ALCANCE[a])}</option>`).join('')}</select></label>` : ''}<div class="row"><button type="button" class="no" data-a="no">${esc(tr('Denegar'))}</button>${p.requiereArgumentos ? `<button type="button" class="yes" data-a="ver">${esc(tr('Completar en la corrida'))}</button>` : `<button type="button" class="yes" data-a="si">${esc(tr('Permitir'))}</button>`}</div><div class="row2"><button type="button" class="luego" data-a="ver">${esc(tr('Verlo en la corrida'))}</button><button type="button" class="luego" data-a="luego">${esc(tr('Ahora no'))}</button></div>`;
    }
    pideEl.insertAdjacentHTML('beforeend', '<p class="lv-respuesta" role="status"></p>');
    pideEl.hidden = false;
  }
  function cerrarPeticion() {
    if (!pidiendo) return;
    pidiendo = null; asking = false; pideEl.hidden = true; zoomOut();
    const quien = AG.find((a) => a.bub?.el.classList.contains('ask'));
    if (quien) { quien.bub?.el.remove(); quien.bub = null; }
    paintChapter();
  }
  let enviando: string | null = null;
  pideEl.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button'), p = D.pide;
    if (!b || !p || pidiendo !== p.id) return;
    const accion = b.dataset.a;
    if (accion === 'luego') { descartadas.add(p.id); cerrarPeticion(); return; }
    if (accion === 'ver') { resp.verEnLaCorrida(); return; }
    if (enviando || D.conexion !== 'en_linea') return;
    const alcance = pideEl.querySelector<HTMLSelectElement>('.lv-alcance')?.value ?? null;
    if (accion === 'si' && (p.requiereArgumentos || (alcance !== null && !p.alcances.includes(alcance as typeof p.alcances[number])))) return;
    const enviar = accion === 'plan' && p.clase === 'plan' ? () => resp.aprobarPlan(p.id)
      : accion === 'si' && p.clase === 'permiso' ? () => resp.conceder(p.id, alcance)
        : accion === 'no' && p.clase === 'permiso' ? () => resp.denegar(p.id) : null;
    if (!enviar) return;
    enviando = p.id;
    pideEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach((x) => { x.disabled = true; });
    const mensaje = pideEl.querySelector<HTMLElement>('.lv-respuesta');
    if (mensaje) mensaje.textContent = tr('Guardando tu respuesta…');
    let ok: boolean | null = null;
    try { ok = await enviar(); } catch { /* El estado sigue pendiente hasta confirmarlo. */ }
    if (!vivo) return;
    enviando = null;
    if (pidiendo !== p.id || D.pide?.id !== p.id) return;
    pideEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach((x) => { x.disabled = ok === true; });
    if (mensaje) mensaje.textContent = ok === true ? tr('Respuesta guardada. Esperando el estado actualizado…') : ok === false ? tr('El servidor rechazó la respuesta. Revisa el estado de la corrida.') : tr('No pude comprobar si se guardó. Revisa la corrida antes de repetir.');
  });

  /* ---------- interfaz ---------- */
  AG.forEach((a) => {
    a.el.setAttribute('role', 'button');
    a.el.tabIndex = 0;
    a.el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.el.click(); } };
    const nb = AG.filter((b) => b !== a && Math.abs(b.hy - a.hy) < 12 && b.name !== 'Juez del torneo B' && a.name !== 'Juez del torneo B').map((b) => Math.abs(b.hx - a.hx));
    a.lb.style.maxWidth = Math.max(64, Math.min(104, (nb.length ? Math.min(...nb) : 120) - 6)) + 'px';
    a.el.onmouseenter = () => { if (!asking) showCard(a); };
    a.el.onmouseleave = () => { if (sel === a) return; if (sel) showCard(sel); else ficha.hidden = true; };
    a.el.onclick = (e) => {
      e.stopPropagation();
      if (asking) return;
      AG.forEach((b) => b.el.classList.remove('sel'));
      if (sel === a) { sel = null; zoomOut(); ficha.hidden = true; return; }
      sel = a; a.el.classList.add('sel'); zoomTo(a, 2); showCard(a);
    };
  });
  vista.onclick = () => { if (sel && !asking) { sel.el.classList.remove('sel'); sel = null; zoomOut(); ficha.hidden = true; } };
  CH.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lv-chip';
    b.onclick = () => {
      if (asking) return;
      chIdx = i; paintChapter();
      const ultima = [...D.actividad].reverse().find((e) => e.sala === c.room);
      if (ultima) anunciar(ultima, false);
    };
    capitulos.appendChild(b); c.chip = b;
  });
  function pintarChips() {
    CH.forEach((c, i) => {
      const est = D.salas[c.room], st = COLOR_ESTADO[est];
      c.chip!.innerHTML = `<span class="n" style="background:${st.c}">${NUMERO[c.room] ?? '·'}</span>${esc(c.title)}<span class="s" style="color:${st.c}">${esc(est === 'ahora' && !D.trabajando ? tr('Paró') : NOMBRE_ESTADO[est])}</span><span class="pg"></span>`;
      c.chip!.classList.toggle('on', i === chIdx);
    });
  }
  const IC = {
    pause: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10" fill="#F4F1EA"/><rect x="7" y="1" width="3" height="10" fill="#F4F1EA"/></svg>',
    play: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1l8 5-8 5z" fill="#F4F1EA"/></svg>',
  };
  const pintarPlay = () => { botonPlay.innerHTML = playing ? IC.pause : IC.play; botonPlay.title = playing ? tr('Pausar la animación') : tr('Seguir la animación'); botonPlay.setAttribute('aria-label', botonPlay.title); };
  pintarPlay();
  botonPlay.onclick = () => { playing = !playing; pintarPlay(); };
  raiz.querySelectorAll<HTMLButtonElement>('.lv-velocidad button').forEach((b) => {
    b.onclick = () => { speed = Number(b.dataset.s); raiz.querySelectorAll('.lv-velocidad button').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const teclas = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input,textarea,select,[contenteditable="true"]'))) return;
    if (e.key === 'Escape' && pidiendo && D.pide) { descartadas.add(D.pide.id); cerrarPeticion(); }
    else if (e.key === 'Escape' && sel) vista.click();
  };
  window.addEventListener('keydown', teclas);

  function paintChapter() {
    const c = CH[chIdx]!, est = D.salas[c.room], st = COLOR_ESTADO[est];
    for (const k of Object.keys(GEOM) as Sala[]) {
      const el = salaEl[k];
      el.classList.toggle('on', k === c.room || estadoDe(k) === 'ahora');
      el.classList.toggle('dim', k !== c.room && k !== 'rec' && !(k === 'bib' && c.room === 'r1'));
      el.style.setProperty('--c', st.c); el.style.setProperty('--g', st.c + '55');
    }
    pintarChips();
    const n = NUMERO[c.room];
    capk.innerHTML = `<span style="color:${st.c}">${esc(n ? trp('Sala {n}', { n }) : tr('El plan'))} · ${esc(leyenda(est))}</span>`;
    const ultima = [...D.actividad].reverse().find((e) => e.sala === c.room);
    capt.textContent = ultima?.texto ?? (c.room === 'plan' ? D.estadoTexto : tr('Sin actividad registrada en esta iteración'));
    capt.title = capt.textContent;
    suceso.title = D.estadoTexto;
    if (!D.trabajando) setEv(esc(D.estadoTexto));
  }

  /* ---------- dibujo ---------- */
  const carga = (src: string) => { const im = new Image(); im.src = src; return im; };
  const FONDO = carga(urlFondo);
  const FG = DELANTE.map(([src, x, y, w, h]) => ({ im: carga(src), x, y, w, h }));
  const CL = 230 + 104;
  const convAt = (s: number): [number, number, number] => (s <= 230 ? [476, 182 + s, 0] : [476 - (s - 230), 412, 1]);
  function drawObj(kind: Obj, x: number, y: number, rot: number) {
    if (!g) return;
    g.save(); g.translate(Math.round(x), Math.round(y));
    if (kind === 'paper') {
      const w = rot ? 14 : 11, h = rot ? 11 : 14;
      g.fillStyle = '#17131F'; g.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
      g.fillStyle = '#F4F1EA'; g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#9C97B3'; g.fillRect(-w / 2 + 2, -h / 2 + 3, w - 4, 1); g.fillRect(-w / 2 + 2, -h / 2 + 6, w - 5, 1);
    } else if (kind === 'book') {
      g.fillStyle = '#17131F'; g.fillRect(-6, -7, 12, 14); g.fillStyle = '#C6524A'; g.fillRect(-5, -6, 10, 12); g.fillStyle = '#F2C14E'; g.fillRect(-5, -2, 10, 2);
    } else {
      g.fillStyle = '#17131F'; g.fillRect(-8, -6, 16, 12); g.fillStyle = '#B79CF2'; g.fillRect(-7, -5, 14, 10); g.fillStyle = '#F4F1EA'; g.fillRect(-5, -2, 8, 1); g.fillRect(-5, 1, 5, 1);
    }
    g.restore();
  }
  function drawAgent(a: Agente) {
    if (!g) return;
    const moving = a.path.length > 0;
    const frame = moving ? (Math.floor(simT * 7) % 2 ? 1 : 2) : 0;
    let bob = 0;
    if (moving) bob = frame === 1 ? -1 : 0;
    else if (a.typing > simT) bob = Math.floor(simT * 5) % 2 ? -1 : 0;
    a.bob = bob;
    const s = sprite(a, frame);
    g.save();
    if (a.face < 0) { g.translate(a.x + 48, a.y + bob * 2); g.scale(-1, 1); g.drawImage(s, 0, 0, 48, 64); }
    else g.drawImage(s, a.x, a.y + bob * 2, 48, 64);
    g.restore();
    if (a.carry) drawObj(a.carry, a.x + (a.face < 0 ? 6 : 42), a.y + 44 + bob * 2, 0);
  }
  function draw() {
    if (!g) return;
    g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = '#0E0D14'; g.fillRect(0, 0, ANCHO, ALTO_VISTA);
    if (FONDO.complete) g.drawImage(FONDO, -0.5, -0.5, ANCHO + 1, ALTO_VISTA + 1);
    ordenFuentes(D.fuentes).forEach((f, i) => {
      const [x, y] = ESTANTE[i]!;
      g.fillStyle = f.fallo ? '#E2706A' : '#7CC7E8'; g.fillRect(x, y, 81, 5);
      if (f.fallo) { g.fillRect(x, y + 44, 81, 8); g.fillStyle = '#C6524A'; g.fillRect(x + 12, y + 41, 8, 13); g.fillRect(x + 59, y + 41, 8, 13); }
    });
    D.pasos.estados.slice(0, 7).forEach((e, i) => {
      const r = RENGLON[e], y = 40 + i * 14;
      if (r.fondo) { g.fillStyle = r.fondo; g.fillRect(152, y - 3, 224, 13); }
      g.fillStyle = r.caja; g.fillRect(167, y, 8, 8);
      if (e !== 'pendiente') { g.fillStyle = r.fondo ?? '#E8E6F0'; g.fillRect(169, y + 2, 4, 4); }
      g.fillStyle = r.linea; g.fillRect(183, y + 3, 70 + ((i * 37) % 60), 3);
    });
    // La cinta lleva papeles mientras quedan afirmaciones por juzgar.
    const quedan = D.juez.total !== null && D.juez.hechas !== null ? D.juez.total - D.juez.hechas : 0;
    const n = D.trabajando && D.activos.includes('Juez') ? Math.min(11, Math.max(0, quedan)) : 0;
    for (let i = 0; i < n; i++) { const s = CL - 6 - i * 26 + (conv % 26); if (s < 0 || s > CL) continue; const p = convAt(s); drawObj('paper', p[0], p[1], p[2]); }
    const seated = AG.filter((a) => a.desk && atHome(a)), rest = AG.filter((a) => !(a.desk && atHome(a))).sort((p, q) => p.y - q.y);
    seated.forEach(drawAgent);
    FG.forEach((f) => { if (f.im.complete) g.drawImage(f.im, f.x, f.y, f.w, f.h); });
    if (hoja) drawObj('paper', 312, 378, 0);
    rest.forEach(drawAgent);
    FLY.forEach((f) => {
      const t = Math.min(1, (simT - f.t0) / f.dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      drawObj(f.kind, f.from[0]! + (f.to[0]! - f.from[0]!) * e, f.from[1]! + (f.to[1]! - f.from[1]!) * e - Math.sin(Math.PI * t) * f.arc, 0);
    });
  }
  function syncDom() {
    AG.forEach((a) => {
      const b = a.bob * 2;
      a.el.style.transform = `translate(${a.x}px,${a.y + b}px)`;
      a.lb.style.top = (atHome(a) ? a.ldy : 66) + 'px';
      a.el.classList.toggle('away', a.away);
      if (a.bub) {
        if (simT > a.bub.until) { a.bub.el.remove(); a.bub = null; }
        else {
          const w = (a.bub.w ||= a.bub.el.offsetWidth), cx = a.x + 24, x = Math.min(ANCHO - w / 2 - 6, Math.max(w / 2 + 6, cx));
          a.bub.el.style.left = x + 'px'; a.bub.el.style.top = a.y - 4 + b + 'px';
          a.bub.el.style.setProperty('--dx', Math.max(-w / 2 + 10, Math.min(w / 2 - 10, cx - x)) + 'px');
        }
      }
    });
    refrescarFicha();
    for (let i = STAMPS.length - 1; i >= 0; i--) if (simT > STAMPS[i]!.until) { STAMPS[i]!.el.remove(); STAMPS.splice(i, 1); }
    const c = CH[chIdx]!;
    const pg = c.chip?.querySelector<HTMLElement>('.pg');
    if (pg) pg.style.width = D.salas[c.room] === 'listo' ? '100%' : '0%';
  }
  function step(dt: number) {
    simT += dt;
    AG.forEach((a) => {
      const p = a.path[0];
      if (!p) return;
      const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), m = 70 * dt;
      if (Math.abs(dx) > 0.5) a.face = dx > 0 ? 1 : -1;
      if (d <= m) { a.x = p.x; a.y = p.y; a.path.shift(); } else { a.x += (dx / d) * m; a.y += (dy / d) * m; }
    });
    if (D.trabajando && D.activos.includes('Juez')) conv += 12 * dt;
    AG.forEach((a) => { if (D.activos.includes(a.name) && !REDUCIR) a.typing = simT + 1; });
    processWaits();
    mantenerEscenas();
  }
  let last = performance.now(), raf = 0;
  function frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (document.hidden) { raf = requestAnimationFrame(frame); return; }
    camara(dt);
    if (playing && !document.hidden && !REDUCIR) { dt *= speed; while (dt > 0) { const d = Math.min(0.05, dt); step(d); dt -= d; } }
    draw(); syncDom();
    raf = requestAnimationFrame(frame);
  }

  pintarSalas(); pintarMarcas();
  sincronizarActividad(true);
  mostrarPeticion();
  raf = requestAnimationFrame(frame);

  return {
    conversar(turnos: TurnoLaboratorio[], habilitada = true) {
      if (!habilitada) {
        dialogos.length = 0;
        [...escenas.entries()].filter(([, e]) => e.temaId).forEach(([a]) => cancelarEscena(a));
        AG.forEach((a) => { if (a.bub?.el.dataset.turno) { a.bub.el.remove(); a.bub = null; } });
      }
      for (const t of turnos) {
        if (!D.identidad.endsWith('/' + t.iteracionId) || dialogosVistos.has(t.id)) continue;
        dialogosVistos.add(t.id); ultimaCharla.set(t.agente, t);
        if (!habilitada || !D.trabajando || D.conexion !== 'en_linea' || Date.now() - t.fecha > 90000) continue;
        if (REDUCIR) {
          const a = AG.find((x) => x.name === t.agente), b = AG.find((x) => x.name === t.destinatario);
          if (a && b) mostrarDialogo(t, a, b, 14);
        } else dialogos.push(t);
      }
      if (dialogos.length > 20) dialogos.splice(0, dialogos.length - 20);
    },
    actualizar(d: DatosLab) {
      const antes = D;
      D = d;
      const cambio = identidad !== d.identidad;
      if (cambio) { identidad = d.identidad; vistas.clear(); descartadas.clear(); cerrarPeticion(); }
      // La corrida puede cambiar de tarea mientras termina el intercambio visual.
      // Solo detenerla, perder la conexión o cambiar de iteración cancela las escenas.
      const detener = !d.trabajando || d.conexion !== 'en_linea';
      if (cambio || detener) pararActividad();
      if (cambio) { dialogos.length = 0; dialogosVistos.clear(); ultimaCharla.clear(); }
      if (!d.trabajando || d.conexion !== 'en_linea') dialogos.length = 0;
      pintarSalas(); pintarMarcas(); pintarChips();
      if (pidiendo && (!d.pide || d.pide.id !== pidiendo)) cerrarPeticion();
      if (pidiendo && !enviando && (JSON.stringify(antes.pide) !== JSON.stringify(d.pide) || JSON.stringify(antes.pasos.lista) !== JSON.stringify(d.pasos.lista))) cerrarPeticion();
      if (d.pide && !pidiendo) mostrarPeticion();
      if (!asking && (cambio || antes.foco !== d.foco)) chIdx = capituloDe(d.foco);
      sincronizarActividad(cambio);
    },
    desmontar() {
      vivo = false;
      cancelAnimationFrame(raf);
      pararActividad();
      AG.forEach((a) => a.ictx?.kill());
      processWaits();
      window.removeEventListener('keydown', teclas);
      raiz.innerHTML = '';
    },
  };
}
