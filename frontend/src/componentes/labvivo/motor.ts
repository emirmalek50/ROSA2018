// El motor del laboratorio en vivo: el lienzo en pixel art, los agentes que
// caminan y hablan, las salas y la cámara que se acerca a quien pide permiso.
// Es imperativo a propósito (un bucle de animación con su reloj propio y
// promesas que esperan a que el reloj avance): React monta el contenedor y le
// pasa los datos reales cada vez que cambian, el motor no los inventa.
//
// La navegación entre salas solo cambia lo que se mira. La actividad, los
// mensajes y los contadores se actualizan desde DatosLab al recibir SSE.

import { tr, trp } from '../../lib/idioma';
import type { EmocionLaboratorio, GestoLaboratorio, TurnoLaboratorio } from '../../lib/conversacionesLaboratorio';
import { desplazamientoGesto, pintarExpresion } from './expresiones';
import './escenas.css';
import './pelicula.css';
import { ColaPelicula } from './colaPelicula';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { esPeticionDePresupuesto, pintarFoco, pintarPeticionIncidencia, pintarPeticionPresupuesto, topeConLlamadasMas, vozDePresupuesto } from './peticionPresupuesto';
import './peticionPresupuesto.css';
import { formatearEntero } from '../../lib/formato';
import { ALCANCE, veredictoDe } from '../../lib/etiquetas';
import { baseDe } from '../../lib/escenario';
import type { ActividadLab, AfirmacionLab, DatosLab, EstadoPasoLab, EstadoSala, FuenteLab, SalaLab } from '../../lib/labVivo';
import type { AgenteNovedad } from '../../lib/ruta';
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
  conceder: (id: string, alcance: string | null, argumentos?: Record<string, string>) => Promise<boolean | null>;
  denegar: (id: string) => Promise<boolean | null>;
  aprobarPlan: (iteracionId: string) => Promise<boolean | null>;
  ampliarPresupuesto: (corridaId: string, limite: number) => Promise<boolean | null>;
  resolverIncidencia: (id: string, resolucion: string) => Promise<boolean | null>;
  verEnLaCorrida: () => void;
  verNovedad: (agente: AgenteNovedad, hipotesisId?: string) => void;
}

export interface Laboratorio {
  actualizar: (d: DatosLab) => void;
  conversar: (turnos: TurnoLaboratorio[], habilitada?: boolean) => void;
  desmontar: () => void;
}

type Sala = 'bib' | 'rec' | SalaLab;
type Obj = 'paper' | 'book' | 'card' | 'coin';

/** Geometría de las salas sobre el fondo (coordenadas del dibujo de 1064 × 1312). */
const GEOM: Record<Sala, [number, number, number, number]> = {
  plan: [0, 0, 416, 280],
  r1: [424, 0, 336, 280],
  bib: [768, 0, 296, 280],
  r2: [0, 288, 624, 312],
  r3: [632, 288, 432, 312],
  r4: [0, 608, 432, 312],
  r7: [440, 608, 624, 144],
  r5: [440, 760, 624, 160],
  r6: [0, 928, 1064, 200],
  rec: [0, 1136, 1064, 176],
};
const NUMERO: Partial<Record<Sala, number>> = { r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7 };
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

/** La pantalla de cada escritorio con ordenador (20 × 16), por agente. */
const PANTALLA: Record<string, [number, number]> = {
  'Extractor de afirmaciones': [440, 92], 'Puntuador preguntas': [552, 92], 'Puntuador amplitud': [664, 92], 'Asistente del chat': [314, 1236], Traductor: [834, 1236],
};
const GLIFO: Record<'!' | '?', string[]> = {
  '!': ['..##..', '..##..', '..##..', '..##..', '..##..', '......', '..##..', '..##..'],
  '?': ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..', '..##..'],
};
const GOTA = ['..#..', '.###.', '#####', '#####', '.###.'];
const ZETA = ['####', '..#.', '.#..', '####'];
/** Los estados de la corrida en que algo la paró y no va a seguir sola enseguida. */
const PARADA_ROJA = new Set(['detenida', 'pausada_por_presupuesto']);
const PARADA_AMBAR = new Set(['pausada', 'esperando_modelo']);

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
Planificador de análisis|Planificador de análisis|596|808|#B79CF2|rizos|4|1|1||66|0|Decide qué análisis de datos hace falta.
Programador y Reparador|Programador y Reparador|680|808|#B79CF2|largo|1|4|0||66|0|Escribe el código del análisis y lo arregla si falla.
Intérprete|Intérprete|764|808|#E3A57C|melena|3|0|4|g|66|0|Explica qué significa el resultado.
Auditor del análisis|Auditor del análisis|848|808|#E3A57C|afro|0|3|3||66|0|Revisa que el análisis esté bien hecho.
Killer|Killer|10|672|#E3A57C|flequillo|2|6|2||66|0|Intenta tumbar cada idea antes de gastar en ella.
Revisor inicial|Revisor inicial|80|672|#E3A57C|rapado|4|2|1|gb|66|0|Primer filtro: aparta las ideas que no cumplen lo básico.
Evaluador de supuestos|Evaluador de supuestos|150|672|#7CC7E8|mono|1|5|0||66|0|Saca a la luz lo que cada idea da por hecho.
Juez del torneo|Juez del torneo ×2|210|672|#E3A57C|corto|0|4|3|b|66|0|Enfrenta ideas de dos en dos y elige la mejor.
Juez del torneo B|Juez del torneo|238|666|#E3A57C|corto|0|4|3|b|66|0|Enfrenta ideas de dos en dos y elige la mejor.
Juez de viabilidad|Juez de viabilidad|298|672|#E3A57C|rizos|2|0|2||66|0|Decide si la idea se puede probar con lo que hay.
Especialista en patentes|Especialista en patentes|580|664|#B79CF2|melena|3|1|2|g|66|0|Lee patentes relacionadas con el tratamiento y distingue lo reivindicado de una semejanza.
Auditor de descartes|Auditor de descartes|10|792|#B79CF2|largo|4|3|1||66|0|Revisa que no se haya tirado una buena idea.
Concluidor|Concluidor|80|792|#E3A57C|melena|1|6|0||66|0|Cierra cada idea con una conclusión.
Evaluador de resultado|Evaluador de resultado|150|792|#E3A57C|afro|3|2|4|g|66|0|Juzga si el resultado responde a la pregunta.
Tarjeta y Nombre corto|Tarjeta y Nombre corto|220|792|#7CC7E8|flequillo|0|5|3||66|0|Pone a cada idea una tarjeta y un nombre corto.
Resumen en llano|Resumen en llano|290|792|#B79CF2|rapado|2|1|2|b|66|0|Resume cada idea en palabras sencillas.
Especialista en compañías|Especialista en compañías|860|664|#B79CF2|corto|1|3|4|b|66|0|Contrasta quién está probando o ha probado el tratamiento con registros y documentos públicos.
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
  'Especialista en patentes': 'Sofía', 'Especialista en compañías': 'Damián',
  'Tarjeta y Nombre corto': 'Lars', 'Resumen en llano': 'Omar', 'Revisor del registro': 'Imani', Rehacedor: 'Julia',
  'Revisor de la reparación': 'Arjun', 'Meta-revisor': 'Emma', 'Revisor del arnés': 'Camila', Resumidor: 'Ada',
  'Auditor de GEPA': 'Bruno', 'Asistente del chat': 'Iván', Preguntador: 'Paula', Traductor: 'Aisha',
};
const ESPECIALISTA: Record<string, AgenteNovedad> = { 'Especialista en patentes': 'patentes', 'Especialista en compañías': 'companias' };


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
  /** Cronómetro de la tarea abierta: desde cuándo espera la respuesta (hora real). */
  rj: HTMLDivElement; desde: number | null; rjTxt: string;
  /** Gesto encima de la cabeza (nuevo registro, nota, error) y gesto de espera. */
  emo: { k: '!' | '?' | 'gota'; t0: number } | null; gesto: { k: 'estira' | 'cafe' | 'mira'; hasta: number; cara: number } | null; prox: number; recado: boolean; turno: number;
  reaccion?: { emocion: EmocionLaboratorio; gesto: GestoLaboratorio; desde: number; hasta: number };
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
/** Tiempo transcurrido desde una hora real, como m:ss o h:mm:ss. */
function transcurrido(desde: number): string {
  const s = Math.max(0, Math.floor((Date.now() - desde) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

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

  raiz.innerHTML = `<div class="lv-vista"><div class="lv-mundo"><canvas class="lv-lienzo" width="${ANCHO * 2}" height="${ALTO_VISTA * 2}"></canvas><div class="lv-salas"></div><div class="lv-marcas"></div><div class="lv-hots"></div><div class="lv-agentes"></div><div class="lv-bocadillos"></div></div><div class="lv-ficha" hidden></div><div class="lv-pide" hidden role="dialog" aria-live="assertive"></div><div class="lv-objeto" hidden role="dialog"></div><div class="lv-narra" hidden role="status" aria-live="polite"></div></div><div class="lv-barra"><div class="lv-capitulos"></div><div class="lv-pie"><button type="button" class="lv-play"></button><div class="lv-texto"><div class="lv-capk"></div><div class="lv-capt"></div></div><div class="lv-suceso"></div><button type="button" class="lv-sigue"></button><div class="lv-velocidad"><button type="button" data-s="1" class="on">1×</button><button type="button" data-s="2">2×</button></div><button type="button" class="lv-sonido"></button></div></div>`;
  const q = <T extends HTMLElement = HTMLDivElement>(s: string) => raiz.querySelector(s) as T;
  const vista = q('.lv-vista'), mundo = q('.lv-mundo'), capaSalas = q('.lv-salas'), capaMarcas = q('.lv-marcas'), capaAgentes = q('.lv-agentes'), capaBocadillos = q('.lv-bocadillos');
  const ficha = q('.lv-ficha'), pideEl = q('.lv-pide'), capitulos = q('.lv-capitulos'), botonPlay = q<HTMLButtonElement>('.lv-play'), capk = q('.lv-capk'), capt = q('.lv-capt'), suceso = q('.lv-suceso');
  const capaHots = q('.lv-hots'), objetoEl = q('.lv-objeto'), narraEl = q('.lv-narra'), botonSigue = q<HTMLButtonElement>('.lv-sigue'), botonSonido = q<HTMLButtonElement>('.lv-sonido');
  const cv = q<HTMLCanvasElement>('.lv-lienzo');
  const utileria = div('lv-utileria', mundo);
  mundo.insertBefore(utileria, capaAgentes);
  const tablon = div('lv-tablon', utileria);
  let firmaTablon = '';
  const maquina = div('lv-maquina', utileria);
  const torneo = div('lv-expediente-torneo', utileria);
  // Mientras pide presupuesto, el que pide se queda nítido en su sitio y un cable lo une a la lupa.
  const focoEl = div('lv-foco', null), cableEl = div('lv-foco-cable', null);
  focoEl.hidden = true; cableEl.hidden = true; focoEl.setAttribute('aria-hidden', 'true'); cableEl.setAttribute('aria-hidden', 'true');
  vista.insertBefore(cableEl, pideEl); vista.insertBefore(focoEl, pideEl);
  const g = cv.getContext('2d');

  /* ---------- reloj ---------- */
  // simT avanza con la animación (se para en pausa); rt es el reloj real, para luces y gestos.
  let simT = 0, rt = 0, speed = 1, playing = true, vivo = true;
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

  /* ---------- sonidos de 8 bits: apagados salvo que los actives ---------- */
  const CLAVE_SONIDO = 'rosa.labvivo.sonido';
  let sonido = false;
  try { sonido = localStorage.getItem(CLAVE_SONIDO) === '1'; } catch { /* Sin almacenamiento local. */ }
  let audio: AudioContext | null = null;
  function tono(f: number, dur: number, forma: OscillatorType = 'square', vol = 0.04, retraso = 0) {
    if (!sonido || document.hidden || typeof AudioContext === 'undefined') return;
    try {
      audio ??= new AudioContext();
      const t = audio.currentTime + retraso, o = audio.createOscillator(), v = audio.createGain();
      o.type = forma; o.frequency.setValueAtTime(f, t);
      v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(v).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch { /* El navegador no deja sonar. */ }
  }
  const SON = {
    teclas: () => { for (let i = 0; i < 4; i++) tono(900 + Math.random() * 500, 0.03, 'square', 0.02, i * 0.09); },
    sello: () => { tono(140, 0.12, 'square', 0.06); tono(90, 0.16, 'triangle', 0.06, 0.04); },
    campana: () => { tono(988, 0.18, 'square', 0.035); tono(1319, 0.3, 'square', 0.035, 0.12); },
    moneda: () => { tono(1319, 0.06, 'square', 0.03); tono(1760, 0.16, 'square', 0.03, 0.06); },
  };

  /* ---------- textos ---------- */
  const TITULO_SALA: Partial<Record<Sala, string>> = { plan: tr('El plan'), r1: tr('Buscan y leen artículos'), r2: tr('Comprueban cada dato'), r3: tr('Proponen ideas nuevas'), r4: tr('Juzgan las ideas'), r5: tr('Las prueban con datos'), r6: tr('Revisan el trabajo'), r7: tr('Patentes y compañías'), rec: tr('Hablan contigo') };
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
    const emocion = a.reaccion && simT < a.reaccion.hasta ? a.reaccion.emocion : 'neutral';
    const key = a.i + '-' + frame + '-' + emocion;
    const hecho = SPR.get(key);
    if (hecho) return hecho;
    const L = a.look, head = CABEZAS[L.s] ?? CABEZAS.corto!;
    const rej = [...head, ...CUERPO.slice(head.length - 7)].map((r) => r.split(''));
    const fila = (y: number) => rej[y]!;
    if (frame === 1) for (let x = 2; x < 6; x++) { fila(14)[x] = '#'; fila(15)[x] = '.'; }
    if (frame === 2) for (let x = 7; x < 11; x++) { fila(14)[x] = '#'; fila(15)[x] = '.'; }
    if (frame === 3) {
      // Se estira: los brazos suben a los lados de la cabeza.
      for (let y = 3; y <= 10; y++) { fila(y)[0] = '#'; fila(y)[11] = '#'; fila(y)[1] = y < 5 ? 's' : 'B'; fila(y)[10] = y < 5 ? 's' : 'B'; }
      fila(2)[1] = '#'; fila(2)[10] = '#'; fila(11)[2] = 'B'; fila(11)[9] = 'B';
    }
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
      pintarExpresion(x, emocion, PIEL[L.k]!);
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
    const rj = div('lv-reloj', el); rj.hidden = true;
    return {
      i, name: nombre, quien: NOMBRE_PROPIO[nombre] ?? '', label: tr(f[1]!), hx, hy, x: hx, y: hy, coat: f[4]!, look: { s: f[5]!, k: Number(f[6]), h: Number(f[7]), c: Number(f[8]), g: acc.includes('g'), b: acc.includes('b'), a: acc.includes('a') },
      ldy: Number(f[10]), desk: f[11] === '1', what: tr(f[12]!), path: [], face: 1, carry: null, bub: null, busy: false, typing: 0, cool: 0,
      room: salaDe(hx, hy), ictx: null, away: false, bob: 0, el, lb, rj, desde: null, rjTxt: '',
      emo: null, gesto: null, prox: 4 + Math.random() * 20, recado: false, turno: 0,
    };
  });
  AG.forEach((a) => { a.turno = AG.filter((b) => b.room === a.room && b.i < a.i).length; });
  AG.forEach((a) => { a.el.dataset.sala = a.room; });
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

  interface Vuelo { kind: Obj; from: number[]; to: number[]; t0: number; dur: number; arc: number; fin?: () => void; ctx?: Ctx }
  const FLY: Vuelo[] = [];

  /* ---------- salas y marcas ---------- */
  const salaEl = {} as Record<Sala, HTMLDivElement>;
  const placaEl: Partial<Record<Sala, HTMLDivElement>> = {};
  for (const k of Object.keys(GEOM) as Sala[]) {
    const r = GEOM[k];
    const d = div('lv-sala', capaSalas);
    d.dataset.sala = k;
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
  marca('pizarra', 186, 153, '#F4F1EA'); marca('hucha', 82, 152, '#F2C14E');
  const poner = (id: string, html: string | null) => { const t = TAG[id]!; t.innerHTML = html ?? ''; t.style.visibility = html ? 'visible' : 'hidden'; };
  function pintarMarcas() {
    const { resultados, sirven } = D.lectura, j = D.juez, v = j.veredictos;
    const orden = ordenFuentes(D.fuentes);
    CARTEL.forEach((_, i) => {
      const f = orden[i];
      const cifra = f?.salen !== null && f?.salen !== undefined ? `<span style="color:#7CC7E8">${ent(f.salen)}</span>` : '';
      const fallo = f?.fallo ? `<span style="color:${f.salen === null ? '#E2706A' : '#F2C14E'}">${esc(f.salen === null ? tr('no responde') : '!')}</span>` : '';
      poner('f' + i, f ? `<span>${esc(f.nombre)}</span> ${cifra}${fallo}` : null);
      TAG['f' + i]!.title = f?.fallo ? tr('Algunas consultas no respondieron') : f?.nombre ?? '';
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
    const pr = D.presupuesto;
    poner('hucha', pr ? trp('<b>{n}</b>/{m} llamadas', { n: ent(pr.usado), m: ent(pr.limite) }) : null);
    pintarHots();
  }
  const STAMPS: Bocadillo[] = [];
  const setEv = (html: string) => { suceso.innerHTML = html || '&nbsp;'; };

  /* ---------- cámara y fichas ---------- */
  // La cámara se centra en quien miras y lo sigue cuando camina. El centro es
  // el de la parte del laboratorio que se ve en pantalla, que puede ser más
  // alto que la ventana. Guarda qué punto del mundo queda en ese centro.
  let sel: Agente | null = null, asking = false, mira: (() => [number, number]) | null = null, miraS = 1, kfAct = 1;
  const cam = { s: 1, cx: ANCHO / 2, cy: ALTO_VISTA / 2, tx: 0, ty: 0 };
  const vis = { x: ANCHO / 2, y: ALTO_VISTA / 2, k: 1, izq: 0, der: ANCHO, arr: 0, aba: ALTO_VISTA };
  function medirVisible() {
    const r = vista.getBoundingClientRect(), k = r.width / ANCHO || 1;
    // La cabecera de la página es pegajosa: lo que queda debajo de ella no se ve.
    const tapa = Math.max(0, document.querySelector('.cabecera')?.getBoundingClientRect().bottom ?? 0);
    const arr = Math.max(0, (tapa - r.top) / k), aba = Math.min(ALTO_VISTA, (window.innerHeight - r.top) / k);
    const izq = Math.max(0, -r.left / k), der = Math.min(ANCHO, (window.innerWidth - r.left) / k);
    Object.assign(vis, aba - arr > 80 ? { arr, aba } : { arr: 0, aba: ALTO_VISTA }, der - izq > 80 ? { izq, der } : { izq: 0, der: ANCHO }, { k });
    vis.x = (vis.izq + vis.der) / 2; vis.y = (vis.arr + vis.aba) / 2;
  }
  function zoomTo(a: Agente, s: number) { mira = () => [a.x + 24, a.y + 32]; miraS = s; }
  function zoomPunto(f: () => [number, number], s: number) { mira = f; miraS = s; }
  function zoomOut() { mira = null; miraS = 1; }
  function camara(dt: number) {
    medirVisible();
    const s = mira ? miraS : 1;
    let [cx, cy] = mira ? mira() : [vis.x, vis.y];
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
    if (pideEl.classList.contains('lv-pide-presupuesto')) colocarLupa();
    colocarFicha(kf);
    kfAct = kf;
    // El panel de un objeto va arriba, del lado contrario al objeto; la narración, abajo.
    if (!objetoEl.hidden) {
      objetoEl.style.scale = String(kf);
      objetoEl.style.top = vis.arr + 20 + 'px';
      objetoEl.style.maxHeight = Math.max(160, (vis.aba - vis.arr - 40) / kf) + 'px';
      objetoEl.style.left = (objetoIzq ? vis.izq + 20 : vis.der - 20 - objetoEl.offsetWidth * kf) + 'px';
    }
    if (!narraEl.hidden) { narraEl.style.scale = String(kf); narraEl.style.bottom = ALTO_VISTA - vis.aba + 24 + 'px'; }
  }
  /** Como en el diseño: la lupa y, a su derecha, el que pide resaltado y unido a ella por un
   * cable, todo centrado en lo que se ve del laboratorio. La página no se mueve mientras tanto. */
  function colocarLupa() {
    const e = 1 / vis.k, margen = 16 * e, HUECO = 10, FOCO = 136;
    const cabe = (vis.der - vis.izq) * vis.k - 32, conFoco = cabe >= 460 + HUECO + FOCO;
    const ancho = Math.max(220, Math.min(460, cabe)), w = ancho * e;
    pideEl.style.scale = String(e);
    pideEl.style.width = ancho + 'px';
    pideEl.style.right = 'auto'; pideEl.style.bottom = 'auto';
    pideEl.style.maxHeight = Math.max(180, (vis.aba - vis.arr) * vis.k - 32) + 'px';
    const h = pideEl.offsetHeight * e, left = vis.x - (w + (conFoco ? (HUECO + FOCO) * e : 0)) / 2;
    const top = Math.max(vis.arr + margen, Math.min(vis.y - h / 2, vis.aba - margen - h));
    pideEl.style.left = left + 'px';
    pideEl.style.top = top + 'px';
    focoEl.hidden = cableEl.hidden = !conFoco;
    if (!conFoco) return;
    const fx = left + w + HUECO * e, fy = top + 22 * e, et = focoEl.querySelector<HTMLElement>('.lv-foco-pide');
    focoEl.style.transform = `translate(${fx}px,${fy}px) scale(${e})`;
    if (et) et.style.left = Math.max(0, 68 - et.offsetWidth / 2) + 'px';
    Object.assign(cableEl.style, { left: left + w + 'px', top: fy + 74 * e + 'px', width: 44 * e + HUECO * e + 'px', height: 4 * e + 'px' });
  }
  /** Mientras se decide, la página no sube ni baja (solo el cuerpo de la lupa, si no cabe). */
  function quieta(e: Event) {
    const cuerpo = (e.target as Element | null)?.closest?.('.lv-permiso-cuerpo');
    if (!cuerpo || cuerpo.scrollHeight <= cuerpo.clientHeight) e.preventDefault();
  }
  function fijarPagina(si: boolean) {
    for (const t of ['wheel', 'touchmove'] as const) {
      if (si) window.addEventListener(t, quieta, { passive: false });
      else window.removeEventListener(t, quieta);
    }
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
    // Estos dos abren su dossier científico, sin la ficha genérica del motor.
    if (ESPECIALISTA[a.name]) { ficha.hidden = true; fichaDe = null; return; }
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
    { room: 'r7', title: tr('Novedad') },
  ];
  const capituloDe = (s: SalaLab) => Math.max(0, CH.findIndex((c) => c.room === s));
  let chIdx = capituloDe(D.foco);
  let hoja = false, conv = 0;
  const vistas = new Map<string, string>();
  let identidad = D.identidad;
  // La coreografía continúa entre mensajes del servidor. Estas escenas no
  // añaden actividad al registro ni convierten a un compañero en trabajador.
  interface Escena { ctx: Ctx; agentes: Agente[]; trabajo: boolean; evento?: EventoVisualLab; objetos?: HTMLElement[]; temaId?: string; listos?: boolean; hasta?: number; esperarHasta?: number; saliendo?: boolean }
  const escenas = new Map<Agente, Escena>();
  const pelicula = new ColaPelicula();
  const dialogos: TurnoLaboratorio[] = [], dialogosVistos = new Set<string>();
  const ultimaCharla = new Map<string, TurnoLaboratorio>();
  const proximaEscena = new Map<Agente, number>();
  let rondaEscena = 0, proximoPaseo = 1.5;
  function cancelarEscena(a: Agente, devolver = true) {
    const escena = escenas.get(a);
    if (!escena) return;
    escena.ctx.kill();
    escena.objetos?.forEach(o => o.remove());
    for (let i = FLY.length - 1; i >= 0; i--) if (FLY[i]!.ctx === escena.ctx) FLY.splice(i, 1);
    if (devolver && escena.evento) pelicula.devolver(escena.evento);
    for (const b of escena.agentes) {
      if (escenas.get(b) !== escena) continue;
      escenas.delete(b);
      if (b.ictx !== escena.ctx) continue;
      b.ictx = null; b.busy = false; b.path = []; b.carry = null;
      b.typing = 0; b.reaccion = undefined;
      delete b.el.dataset.evento;
      delete b.el.dataset.emocion; delete b.el.dataset.gesto;
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
    const suelo: Partial<Record<Sala, number>> = { r1: 192, r2: a.hy < 400 ? 412 : 516, r3: 472, r4: a.hy < 750 ? 708 : 820, r5: 806, r6: 1034, r7: 664 };
    return suelo[a.room] ?? Math.min(GEOM[a.room][1] + GEOM[a.room][3] - 76, a.hy + 28);
  }
  function desplazarse(ctx: Ctx, a: Agente, x: number, y: number) {
    // Una charla puede interrumpir la consulta en la biblioteca: se vuelve
    // por el paso inferior, sin atravesar la pared que separa las salas.
    if (a.room === 'r1' && a.x >= 760) return walk(ctx, a, [[a.x, 268], [a.hx, 268], [a.hx, y], [x, y]]);
    // Quienes están sentados salen por el lado de su mesa antes de bajar.
    const salida = a.desk && atHome(a) ? [[a.hx - 12, a.hy] as [number, number]] : [];
    return walk(ctx, a, [...salida, [salida.length ? a.hx - 12 : a.x, y], [x, y]]);
  }

  /* Los objetos siguen el registro. Las palabras de los personajes siguen la IA. */
  function documento(texto: string, sala: SalaLab, clase = '') {
    const [x, y, w] = GEOM[sala];
    const el = div('lv-documento ' + clase, utileria);
    el.style.left = x + w - 216 + 'px'; el.style.top = y + 24 + 'px';
    // Huecos libres entre la cabecera y las mesas; el papel no tapa las caras.
    const huecos: Partial<Record<SalaLab, [number, number, number, number]>> = {
      r1: [436, 170, 150, 88], r2: [12, 330, 180, 70], r4: [12, 650, 390, 18],
      r5: [450, 810, 126, 64], r6: [760, 934, 280, 42], r7: [770, 618, 270, 34],
    };
    const hueco = huecos[sala];
    if (hueco) Object.assign(el.style, { left: hueco[0] + 'px', top: hueco[1] + 'px', width: hueco[2] + 'px', maxHeight: hueco[3] + 'px' });
    el.textContent = corta(texto, 240); el.title = texto;
    return el;
  }
  function pintarUtileria() {
    const ideas = D.pelicula?.ideas ?? [];
    const ultimas = new Map<string, typeof ideas[number]>();
    ideas.forEach(i => ultimas.set(i.enfoque, i));
    const html = [...ultimas.values()].slice(-4).map(i => `<div class="lv-tarjeta-idea" data-hipotesis="${esc(i.hipotesisId)}" title="${esc(i.titulo)}"><i></i><span>${esc(corta(i.titulo, 80))}</span></div>`).join('');
    if (firmaTablon !== html) { firmaTablon = html; tablon.innerHTML = html; }
    tablon.hidden = !ideas.length;
    const partido = [...(D.pelicula?.eventos ?? [])].reverse().find(e => e.dato?.tipo === 'torneo')?.dato;
    torneo.hidden = partido?.tipo !== 'torneo';
    if (partido?.tipo === 'torneo') {
      torneo.dataset.hipotesisA = partido.hipotesisAId; torneo.dataset.hipotesisB = partido.hipotesisBId;
      torneo.dataset.estado = partido.estado;
      const resultado = partido.estado === 'comparando' ? tr('Comparando') : partido.estado === 'a' ? partido.tituloA : partido.estado === 'b' ? partido.tituloB : partido.estado === 'tablas' ? tr('Empate') : tr('No pude comprobar');
      const texto = `${partido.tituloA} · ${tr('Frente a')} ${partido.tituloB}\n${partido.porRegla ? tr('Comparación por regla') : tr('Resultado registrado')}: ${resultado}`;
      torneo.innerHTML = texto.split('\n').map(t => `<span>${esc(t)}</span>`).join(''); torneo.title = texto;
    } else { torneo.textContent = ''; delete torneo.dataset.hipotesisA; delete torneo.dataset.hipotesisB; delete torneo.dataset.estado; }
    const analisis = [...(D.pelicula?.eventos ?? [])].reverse().find(e => e.dato?.tipo === 'analisis')?.dato;
    maquina.hidden = analisis?.tipo !== 'analisis';
    if (analisis?.tipo === 'analisis') {
      maquina.dataset.estado = analisis.estado;
      maquina.dataset.ejecucion = analisis.ejecucionId;
      maquina.dataset.activa = String(playing && D.trabajando && D.conexion === 'en_linea' && !D.pasada);
      const estados = { programando: tr('Código en preparación'), ejecutando: tr('Ejecutando…'), terminado: tr('Ejecución terminada'), fallido: tr('La ejecución falló'), interpretando: tr('Interpretando el resultado'), auditando: tr('Revisando el análisis') };
      maquina.textContent = `${analisis.sintetico ? tr('Ensayo sintético') + ' · ' : ''}${estados[analisis.estado]}`;
    } else { maquina.textContent = ''; delete maquina.dataset.estado; delete maquina.dataset.ejecucion; delete maquina.dataset.activa; }
  }
  function sincronizarPelicula(inicial = false) {
    const eventos = D.pelicula?.eventos ?? [];
    pelicula.recibir(eventos, D.identidad, inicial);
    // Al abrir no se reproduce toda la historia. Solo una escena del trabajo actual por sala.
    if (inicial && D.trabajando && D.conexion === 'en_linea' && !D.pasada) {
      const actuales = new Map<SalaLab, EventoVisualLab>();
      eventos.forEach(e => { if (e.agentes.some(a => D.activos.includes(a))) actuales.set(e.sala, e); });
      actuales.forEach(e => pelicula.devolver(e));
    }
    pintarUtileria();
  }
  function actoresDe(e: EventoVisualLab): Agente[] {
    const nombres = [...e.agentes];
    // Son gestos de entrega, no nuevas tareas atribuidas a los compañeros.
    if (e.tipo === 'plan' && nombres.includes('Planificador')) nombres.unshift('Misión, Áreas y Pregunta');
    if (e.dato?.tipo === 'articulo' && e.dato.estado === 'incluido') nombres.push('Extractor de afirmaciones');
    if (e.tipo === 'evidencia' && nombres.includes('Asignador de evidencia')) nombres.push('Actualizador del modelo de mundo');
    if (e.tipo === 'analisis' && nombres.includes('Planificador de análisis')) nombres.push('Programador y Reparador');
    const entregaRevision: Record<string, string> = { 'Revisor inicial': 'Killer', Killer: 'Evaluador de supuestos', 'Juez de viabilidad': 'Concluidor' };
    if (e.tipo === 'revision' && entregaRevision[nombres[0]!]) nombres.push(entregaRevision[nombres[0]!]!);
    return [...new Set(nombres)].map(n => AG.find(a => a.name === n)).filter((a): a is Agente => !!a);
  }
  function mantenerPelicula() {
    const permitido = vivo && !REDUCIR && !asking && !D.pasada && D.conexion === 'en_linea' && !siguiendo;
    if (!permitido) return;
    const ocupadas = new Set([...escenas.values()].filter(e => e.evento || e.temaId).map(e => e.agentes[0]?.room));
    if (ocupadas.size >= 3) return;
    const e = pelicula.siguiente(e => {
      if (!D.trabajando && !(D.estado === 'terminada' && e.tipo === 'cierre')) return false;
      if (ocupadas.has(e.sala)) return false;
      const actores = actoresDe(e);
      return actores.length > 0 && actores.every(a => {
        const escena = escenas.get(a);
        return escena ? !escena.temaId && !escena.evento : libreParaEscena(a);
      });
    });
    if (!e) return;
    const actores = actoresDe(e), ctx = nuevoCtx();
    actores.forEach(a => cancelarEscena(a));
    const escena: Escena = { ctx, agentes: actores, trabajo: true, evento: e, objetos: [] };
    actores.forEach(a => { escenas.set(a, escena); a.ictx = ctx; a.busy = true; a.el.dataset.escena = 'pelicula'; a.el.dataset.evento = e.id; });
    const a = actores[0]!, b = actores[1];
    const esperar = async (s: number) => { await ctx.wait(s); if (ctx.dead) throw PARAR; };
    const mostrar = (texto = e.texto, sala = e.sala) => { const el = documento(texto, sala); el.dataset.evento = e.id; escena.objetos!.push(el); return el; };
    const vuelo = async (kind: Obj, desde: number[], hasta: number[]) => {
      FLY.push({ kind, from: desde, to: hasta, t0: simT, dur: 0.7, arc: 28, ctx }); await esperar(0.7);
    };
    const entregar = async () => {
      if (!b) { a.carry = 'paper'; type(a, 2); await esperar(2); return; }
      const [rx, , rw] = GEOM[e.sala], x = Math.max(rx + 12, Math.min(rx + rw - 122, (a.hx + b.hx) / 2 - 30)), y = pasillo(a);
      a.carry = 'card';
      await Promise.all([desplazarse(ctx, a, x, y), desplazarse(ctx, b, x + 60, y)]);
      if (ctx.dead) throw PARAR;
      a.face = 1; b.face = -1; a.carry = null;
      await vuelo('card', [a.x + 42, a.y + 44], [b.x + 6, b.y + 44]); b.carry = 'card'; await esperar(1.2);
    };
    setEv(esc(e.texto));
    spawn((async () => {
      try {
        if (e.tipo === 'plan') {
          await entregar();
          const planificador = actores.find(a => a.name === 'Planificador') ?? a;
          await desplazarse(ctx, planificador, 128, 158);
          mostrar(D.pasos.lista.length ? `${tr('Plan')}\n${D.pasos.lista.map((p, i) => `${i + 1}. ${p.titulo}`).join('\n')}` : e.texto);
          type(planificador, 3); await esperar(3);
        } else if (e.tipo === 'fuente' && ['Generador de consultas', 'Explorador'].includes(a.name)) {
          const indice = ordenFuentes(D.fuentes).findIndex(f => e.texto.includes(f.nombre));
          if (indice >= 0) {
            const [x, y] = ESTANTE[indice]!;
            await walk(ctx, a, [[a.x, 268], [x, 268], [x, y + 60]]);
            mostrar(); await esperar(1.5);
            const fuente = ordenFuentes(D.fuentes)[indice]!;
            if (fuente.salen !== null && fuente.salen > 0) a.carry = 'book';
            if (fuente.fallo) a.emo = { k: 'gota', t0: rt };
          } else { mostrar(); type(a, 2); await esperar(2); }
        } else if (e.dato?.tipo === 'articulo') {
          const dato = e.dato;
          await Promise.all(actores.map(a => home(ctx, a)));
          const doc = mostrar(`${dato.titulo}\n${dato.estado === 'incluido' ? tr('Incluido') : dato.estado === 'excluido' ? tr('Excluido') : tr('No pude comprobar')}\n${dato.motivo}`);
          type(a, 2); await esperar(2);
          doc.remove();
          if (dato.estado === 'incluido') {
            await entregar();
            if (b) { b.carry = null; await vuelo('paper', [b.x + 24, b.y + 44], convAt(0)); }
          } else if (dato.estado === 'excluido') await vuelo('paper', [a.x + 24, a.y + 44], [a.hx + 20, a.hy + 90]);
        } else if (e.tipo === 'lectura' || e.tipo === 'extraccion') {
          mostrar(); type(a, 2); await esperar(2);
          if ((D.lectura.afirmaciones ?? 0) > 0) await vuelo('paper', [a.x + 24, a.y + 44], convAt(0));
        } else if (e.dato?.tipo === 'idea') {
          a.carry = 'card'; await desplazarse(ctx, a, Math.max(648, Math.min(988, a.hx)), 472);
          a.carry = null;
          await vuelo('card', [a.x + 24, a.y + 44], [a.x + 24, 340]);
          tablon.classList.remove('lv-clavar'); void tablon.offsetWidth; tablon.classList.add('lv-clavar'); await esperar(1.8);
        } else if (e.dato?.tipo === 'torneo') {
          mostrar(`${e.dato.tituloA}\n${tr('Frente a')}\n${e.dato.tituloB}`);
          await entregar(); type(a, 2); if (b) type(b, 2); await esperar(2);
          if (e.dato.estado !== 'comparando') {
            const decision = e.dato.estado === 'a' ? e.dato.tituloA : e.dato.estado === 'b' ? e.dato.tituloB : e.dato.estado === 'tablas' ? tr('Empate') : tr('No pude comprobar');
            mostrar(`${tr('Resultado registrado')}: ${decision}`); await esperar(2);
          }
        } else if (e.tipo === 'analisis') {
          await entregar(); mostrar();
          const programador = actores.find(a => a.name === 'Programador y Reparador');
          if (programador) { await desplazarse(ctx, programador, 688, 816); type(programador, 3); }
          await esperar(3);
          if (e.dato?.tipo === 'analisis' && e.dato.estado === 'terminado') SON.campana();
        } else if (e.tipo === 'cierre') {
          mostrar(); a.carry = 'paper';
          if (a.name === 'Resumidor') {
            await walk(ctx, a, [[a.x, 1112], [116, 1112], [116, 1240]]);
            a.carry = null; await vuelo('paper', [a.x + 24, a.y + 44], [146, 1244]);
          } else { await desplazarse(ctx, a, Math.min(990, a.hx + 80), 1034); type(a, 2); }
          await esperar(2);
        } else {
          mostrar(); await entregar(); type(a, 2); await esperar(2);
        }
        await Promise.all(actores.map(a => {
          if (a.room === 'r1' && a.x >= 760) return walk(ctx, a, [[a.x, 268], [a.hx, 268], [a.hx, a.hy]]);
          if (a.room === 'r6' && a.y > 1128) return walk(ctx, a, [[a.x, 1112], [a.hx, 1112], [a.hx, a.hy]]);
          return walk(ctx, a, [[a.hx, a.y], [a.hx, a.hy]]);
        }));
      } finally {
        escena.objetos?.forEach(o => o.remove());
        for (const p of actores) {
          if (escenas.get(p) !== escena || p.ictx !== ctx) continue;
          escenas.delete(p); p.ictx = null; p.busy = false; p.carry = null; p.typing = 0;
          delete p.el.dataset.escena; delete p.el.dataset.evento;
          proximaEscena.set(p, simT + 3);
        }
      }
    })());
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
    a.reaccion = { emocion: t.emocion ?? 'neutral', gesto: t.gesto ?? 'ninguno', desde: simT, hasta: simT + dur };
    a.el.dataset.emocion = a.reaccion.emocion; a.el.dataset.gesto = a.reaccion.gesto;
    hablarEnEscena(a, b, t.texto, dur);
    a.bub?.el.setAttribute('data-turno', t.id);
    a.bub?.el.setAttribute('data-emocion', a.reaccion.emocion);
    ultimaCharla.set(a.name, t);
    setEv(esc(t.texto));
    if (fichaDe === a && !ficha.hidden) showCard(a);
  }
  function intervenir(charla: Escena, t: TurnoLaboratorio) {
    const a = charla.agentes.find((p) => p.name === t.agente), b = charla.agentes.find((p) => p.name === t.destinatario);
    if (!a || !b) return;
    const dur = t.texto.length < 60 ? Math.max(3.5, 2 + t.texto.length / 20) : Math.max(7, Math.min(14, t.texto.length / 26));
    mostrarDialogo(t, a, b, dur);
    charla.hasta = simT + dur + 0.2; charla.esperarHasta = charla.hasta + 30;
    a.carry = charla.trabajo && charla.listos ? 'card' : null; b.carry = null;
    if (charla.trabajo && charla.listos) FLY.push({ kind: 'card', from: [a.x + 42, a.y + 44], to: [b.x + 6, b.y + 44], t0: simT, dur: 0.7, arc: 18 });
  }
  function mantenerDialogos() {
    const charlas = new Set([...escenas.values()].filter((e) => e.temaId));
    // Cada pareja tiene su propio reloj y su propia cola de respuestas.
    for (const charla of charlas) {
      if (charla.saliendo || !charla.listos || simT < (charla.hasta ?? 0)) continue;
      const indice = dialogos.findIndex((t) => t.temaId === charla.temaId);
      if (indice < 0) {
        if (simT < (charla.esperarHasta ?? 0)) continue;
        charla.saliendo = true;
        spawn((async () => {
          try { await Promise.all(charla.agentes.map((a) => home(charla.ctx, a))); }
          finally { if (escenas.get(charla.agentes[0]!) === charla) cancelarEscena(charla.agentes[0]!); }
        })());
        continue;
      }
      const t = dialogos.splice(indice, 1)[0]!;
      intervenir(charla, t);
    }
    // Hasta tres intercambios en salas distintas, sin robar un interlocutor
    // a otra conversación ni convertir a los compañeros en tareas activas.
    for (let i = 0; i < dialogos.length && charlas.size < 3; i++) {
      const t = dialogos[i]!;
      if ([...charlas].some((e) => e.temaId === t.temaId)) continue;
      const a = AG.find((p) => p.name === t.agente), b = AG.find((p) => p.name === t.destinatario);
      if (!a || !b || a === b || a.name === 'Tú' || b.name === 'Tú' || a.room !== b.room) { dialogos.splice(i--, 1); continue; }
      if ([...charlas].some((e) => e.agentes.some((p) => p.room === a.room))) continue;
      [a, b].forEach((p) => { cancelarEscena(p); p.ictx?.kill(); p.path = []; p.bub?.el.remove(); p.bub = null; });
      const ctx = nuevoCtx();
      const nueva: Escena = { ctx, agentes: [a, b], trabajo: t.tipoConversacion !== 'companeros', temaId: t.temaId, listos: false };
      charlas.add(nueva);
      [a, b].forEach((p) => { escenas.set(p, nueva); p.ictx = ctx; p.busy = true; p.el.dataset.escena = nueva.trabajo ? 'conversacion' : 'conversacion_espera'; });
      // El primer comentario llega antes de la caminata; las respuestas mantienen su orden.
      dialogos.splice(i--, 1);
      intervenir(nueva, t);
      const [rx, , rw] = GEOM[a.room], x = Math.max(rx + 12, Math.min(rx + rw - 122, (a.hx + b.hx) / 2 - 30)), y = pasillo(a);
      spawn((async () => {
        await Promise.all([desplazarse(ctx, a, x, y), desplazarse(ctx, b, x + 60, y)]);
        if (ctx.dead) throw PARAR;
        a.face = 1; b.face = -1; nueva.listos = true;
      })());
    }
  }
  function mantenerEscenas() {
    if (!escenaDisponible()) {
      [...escenas.entries()].forEach(([a, e]) => { if (!(e.evento?.tipo === 'cierre' && D.estado === 'terminada' && D.conexion === 'en_linea' && !D.pasada && !asking)) cancelarEscena(a, false); });
      mantenerPelicula(); return;
    }
    mantenerDialogos();
    mantenerPelicula();
    mantenerJuicio();
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
    [...escenas.keys()].forEach(a => cancelarEscena(a, false));
    proximaEscena.clear(); proximoPaseo = simT + 1.5;
    AG.forEach((a) => {
      a.ictx?.kill(); a.ictx = null; a.busy = false; a.path = [];
      a.carry = null; a.away = false; a.typing = 0;
      if (!a.bub?.el.classList.contains('ask')) { a.bub?.el.remove(); a.bub = null; }
      a.recado = false; a.gesto = null; a.reaccion = undefined;
      delete a.el.dataset.emocion; delete a.el.dataset.gesto;
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
    if (D.pelicula || !animar || REDUCIR || escenas.has(a) || a.ictx) return;
    const ctx = nuevoCtx(); a.ictx = ctx;
    SON.teclas();
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
    // Un gesto sobre la cabeza: «!» registro nuevo, «?» nota o pregunta, gota de sudor si hubo error.
    if (!inicial) porAgente.forEach((e) => { const a = AG.find((x) => x.name === e.agente); if (a) a.emo = { k: e.tipo === 'error' ? 'gota' : e.tipo === 'nota' || e.texto.trim().endsWith('?') ? '?' : '!', t0: rt }; });
    if (D.conexion === 'en_linea' && !asking) {
      [...porAgente.values()].slice(-6).forEach((e) => anunciar(e, D.trabajando && D.activos.includes(e.agente)));
    }
    AG.forEach((a) => {
      const ab = D.trabajando && D.activos.includes(a.name) ? [...D.actividad].reverse().find((e) => e.agente === a.name && e.enCurso) : undefined;
      a.desde = ab?.abierta && ab.desde ? ab.desde : null;
      a.el.dataset.agente = a.name;
      const especialista = ESPECIALISTA[a.name];
      const descripcion = especialista ? `${a.quien} · ${a.label}: ${tr('Abrir dossier en Novedad')}` : a.label + ': ' + haciendo(a);
      a.el.setAttribute('aria-label', descripcion);
      if (especialista) a.el.title = `${descripcion}. ${haciendo(a)}`;
      a.el.classList.toggle('activo', D.activos.includes(a.name));
    });
    hoja = D.activos.includes('Juez');
    processWaits();
    paintChapter();
  }

  /* ---------- quien pide permiso: la cámara va a por él ---------- */
  let pidiendo: string | null = null;
  const descartadas = new Set<string>();
  let focoAntes: HTMLElement | null = null;
  function mostrarPeticion() {
    const p = D.pide;
    if (!p || descartadas.has(p.id) || pidiendo === p.id) return;
    pararActividad();
    dejarDeSeguir(false); cerrarObjeto(false);
    pidiendo = p.id; asking = true; sel = null; ficha.hidden = true;
    pintarSigue();
    const quien = P(p.quien);
    const presupuesto = esPeticionDePresupuesto(p), incidencia = p.clase === 'incidencia', lupa = presupuesto || incidencia;
    quien.face = -1;
    say(quien, esc(presupuesto ? vozDePresupuesto(p) : incidencia ? tr('Algo me impide seguir') : p.clase === 'plan' ? tr('¿Me apruebas el plan?') : p.clase === 'presupuesto' ? p.titulo : tr('¿Me das permiso?')), 3600, 'ask');
    // La lupa ya amplía al que pide: el laboratorio se queda entero detrás.
    if (lupa) zoomOut(); else zoomTo(quien, 2.3);
    setEv(esc(trp('{q} necesita tu respuesta', { q: quien.label })));
    pideEl.classList.toggle('lv-pide-presupuesto', lupa);
    vista.classList.toggle('lv-espera', lupa);
    pideEl.setAttribute('aria-label', p.titulo || tr('El planificador te enseña el plan'));
    if (lupa) {
      pideEl.setAttribute('aria-modal', 'true');
      if (incidencia) pintarPeticionIncidencia(pideEl, D, quien.label, sprite(quien, 0));
      else pintarPeticionPresupuesto(pideEl, D, quien.label, D.modelos.cerebro, sprite(quien, 0));
      pintarFoco(focoEl, quien.label, incidencia ? tr('encontró un problema') : p.clase === 'presupuesto' ? tr('pide presupuesto') : tr('pide permiso'), sprite(quien, 0));
      // Si apenas se ve el laboratorio, la página se coloca una vez para que quepa la lupa y ahí se queda.
      const r = vista.getBoundingClientRect(), tapa = Math.max(0, document.querySelector('.cabecera')?.getBoundingClientRect().bottom ?? 0);
      if (Math.min(window.innerHeight, r.bottom) - Math.max(tapa, r.top) < Math.min(640, window.innerHeight - tapa - 16)) {
        vista.style.scrollMarginTop = tapa + 12 + 'px';
        vista.scrollIntoView?.({ block: 'start' });
      }
      fijarPagina(true);
    } else if (p.clase === 'plan') {
      pideEl.innerHTML = `<div class="k">${esc(tr('El planificador te enseña el plan'))}</div><h3>${esc(trp('El plan tiene {m} pasos', { m: D.pasos.total }))}</h3><ol class="plan">${D.pasos.lista.map((paso) => `<li><b>${esc(paso.titulo)}</b>${paso.detalle ? `<small>${esc(paso.detalle)}</small>` : ''}</li>`).join('')}</ol><div class="row"><button type="button" class="no" data-a="ver">${esc(tr('Revisarlo en la corrida'))}</button><button type="button" class="yes" data-a="plan">${esc(tr('Aprobar el plan'))}</button></div><button type="button" class="luego" data-a="luego">${esc(tr('Ahora no'))}</button>`;
    } else if (p.clase === 'presupuesto') {
      pideEl.innerHTML = `<div class="k">${esc(tr('El preguntador necesita tu respuesta'))}</div><h3>${esc(p.titulo)}</h3><p>${esc(p.detalle)}</p><div class="row"><button type="button" class="yes" data-a="ver">${esc(tr('Revisar el presupuesto'))}</button></div><button type="button" class="luego" data-a="luego">${esc(tr('Ahora no'))}</button>`;
    } else {
      pideEl.innerHTML = `<div class="k">${esc(trp('{q} pide permiso', { q: quien.label }))}</div><h3>${esc(p.titulo)}</h3><p>${esc(p.detalle)}</p>${p.alcances.length ? `<label>${esc(tr('Alcance del permiso'))}<select class="lv-alcance">${p.alcances.map((a) => `<option value="${esc(a)}">${esc(ALCANCE[a])}</option>`).join('')}</select></label>` : ''}<div class="row"><button type="button" class="no" data-a="no">${esc(tr('Denegar'))}</button>${p.requiereArgumentos ? `<button type="button" class="yes" data-a="ver">${esc(tr('Completar en la corrida'))}</button>` : `<button type="button" class="yes" data-a="si">${esc(tr('Permitir'))}</button>`}</div><div class="row2"><button type="button" class="luego" data-a="ver">${esc(tr('Verlo en la corrida'))}</button><button type="button" class="luego" data-a="luego">${esc(tr('Ahora no'))}</button></div>`;
    }
    if (!lupa) pideEl.insertAdjacentHTML('beforeend', '<p class="lv-respuesta" role="status"></p>');
    pideEl.hidden = false;
    if (lupa) {
      focoAntes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      pideEl.querySelector<HTMLInputElement>('.lv-llamadas,.lv-resolucion')?.focus({ preventScroll: true });
    }
  }
  function cerrarPeticion() {
    if (!pidiendo) return;
    pidiendo = null; asking = false; pideEl.hidden = true; zoomOut(); pintarSigue();
    vista.classList.remove('lv-espera'); pideEl.classList.remove('lv-pide-presupuesto');
    focoEl.hidden = true; cableEl.hidden = true; fijarPagina(false);
    pideEl.removeAttribute('aria-modal');
    for (const propiedad of ['scale', 'width', 'left', 'right', 'bottom', 'top', 'max-height']) pideEl.style.removeProperty(propiedad);
    if (focoAntes?.isConnected) focoAntes.focus({ preventScroll: true });
    focoAntes = null;
    const quien = AG.find((a) => a.bub?.el.classList.contains('ask'));
    if (quien) { quien.bub?.el.remove(); quien.bub = null; }
    paintChapter();
  }
  let enviando: string | null = null, aprobada: string | null = null;
  pideEl.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button'), p = D.pide;
    if (!b || !p || pidiendo !== p.id) return;
    const accion = b.dataset.a;
    if (accion === 'luego') { descartadas.add(p.id); cerrarPeticion(); return; }
    if (accion === 'ver') { resp.verEnLaCorrida(); return; }
    if (enviando || D.conexion !== 'en_linea') return;
    const presupuesto = esPeticionDePresupuesto(p);
    const alcance = pideEl.querySelector<HTMLInputElement>('.lv-alcance:checked')?.value ?? pideEl.querySelector<HTMLSelectElement>('select.lv-alcance')?.value ?? null;
    const input = pideEl.querySelector<HTMLInputElement>('.lv-llamadas');
    if ((accion === 'si' && presupuesto) || accion === 'presupuesto') {
      if (!input?.reportValidity() || !Number.isSafeInteger(input.valueAsNumber)) return;
    }
    const propia = pideEl.querySelector<HTMLInputElement>('.lv-resolucion');
    if (accion === 'incidencia' && !propia?.value.trim() && !p.incidencia?.alternativa) { propia?.reportValidity(); return; }
    if (accion === 'si' && ((p.requiereArgumentos && !presupuesto) || (p.alcances.length > 0 && (alcance === null || !p.alcances.includes(alcance as typeof p.alcances[number]))))) return;
    const enviar = accion === 'plan' && p.clase === 'plan' ? () => resp.aprobarPlan(p.id)
      : accion === 'presupuesto' && p.clase === 'presupuesto' && p.presupuesto && input ? () => resp.ampliarPresupuesto(p.presupuesto!.corridaId, topeConLlamadasMas(p, input.valueAsNumber))
      : accion === 'si' && p.clase === 'permiso' ? () => presupuesto ? resp.conceder(p.id, alcance, { llamadas: input!.value }) : resp.conceder(p.id, alcance)
        : accion === 'no' && p.clase === 'permiso' ? () => resp.denegar(p.id)
          : accion === 'incidencia' && p.clase === 'incidencia' ? () => resp.resolverIncidencia(p.id, propia?.value.trim() || p.incidencia!.alternativa!) : null;
    if (!enviar) return;
    enviando = p.id;
    pideEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button,select,input').forEach((x) => { x.disabled = true; });
    const mensaje = pideEl.querySelector<HTMLElement>('.lv-respuesta');
    if (mensaje) mensaje.textContent = tr('Guardando tu respuesta…');
    let ok: boolean | null = null;
    try { ok = await enviar(); } catch { /* El estado sigue pendiente hasta confirmarlo. */ }
    if (!vivo) return;
    enviando = null;
    if (ok === true && accion !== 'no') aprobada = p.id;
    if (pidiendo !== p.id || D.pide?.id !== p.id) return;
    pideEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button,select,input').forEach((x) => { x.disabled = ok === true; });
    if (mensaje) mensaje.textContent = ok === true ? tr('Respuesta guardada. Esperando el estado actualizado…') : ok === false ? tr('El servidor rechazó la respuesta. Revisa el estado de la corrida.') : tr('No pude comprobar si se guardó. Revisa la corrida antes de repetir.');
  });

  /* ---------- interfaz ---------- */
  AG.forEach((a) => {
    a.el.setAttribute('role', 'button');
    a.el.tabIndex = 0;
    a.el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.el.click(); return; }
      const dir = FLECHA[e.key];
      if (!dir || asking) return;
      e.preventDefault();
      const b = vecino(a, dir[0], dir[1]);
      if (!b) return;
      b.el.focus({ preventScroll: !!sel });
      if (sel) b.el.click();
    };
    a.el.onfocus = () => { if (!asking && !sel) showCard(a); };
    a.el.onblur = () => { if (sel === a || asking) return; if (sel) showCard(sel); else if (fichaDe === a) ficha.hidden = true; };
    const nb = AG.filter((b) => b !== a && Math.abs(b.hy - a.hy) < 12 && b.name !== 'Juez del torneo B' && a.name !== 'Juez del torneo B').map((b) => Math.abs(b.hx - a.hx));
    a.lb.style.maxWidth = Math.max(64, Math.min(104, (nb.length ? Math.min(...nb) : 120) - 6)) + 'px';
    a.el.onmouseenter = () => { if (!asking) showCard(a); };
    a.el.onmouseleave = () => { if (sel === a) return; if (sel) showCard(sel); else ficha.hidden = true; };
    a.el.onclick = (e) => {
      e.stopPropagation();
      if (asking) return;
      cerrarObjeto(false); dejarDeSeguir(false);
      AG.forEach((b) => b.el.classList.remove('sel'));
      const especialista = ESPECIALISTA[a.name];
      if (especialista) {
        sel = null; ficha.hidden = true; fichaDe = null;
        const ultima = [...D.actividad].reverse().find((e) => e.agente === a.name);
        resp.verNovedad(especialista, ultima?.hipotesisId ?? undefined);
        return;
      }
      if (sel === a) { sel = null; zoomOut(); ficha.hidden = true; return; }
      sel = a; a.el.classList.add('sel'); zoomTo(a, 2); showCard(a);
    };
  });
  vista.onclick = () => {
    if (asking) return;
    cerrarObjeto(false);
    if (sel) { sel.el.classList.remove('sel'); sel = null; ficha.hidden = true; if (!siguiendo) zoomOut(); }
  };
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
      c.chip!.title = `${c.title} · ${nombreEstado(est)}`;
      c.chip!.setAttribute('aria-label', c.chip!.title);
      c.chip!.setAttribute('aria-pressed', String(i === chIdx));
    });
  }
  const IC = {
    pause: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10" fill="#F4F1EA"/><rect x="7" y="1" width="3" height="10" fill="#F4F1EA"/></svg>',
    play: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1l8 5-8 5z" fill="#F4F1EA"/></svg>',
  };
  const pintarPlay = () => { botonPlay.innerHTML = playing ? IC.pause : IC.play; botonPlay.title = playing ? tr('Pausar la animación') : tr('Seguir la animación'); botonPlay.setAttribute('aria-label', botonPlay.title); };
  pintarPlay();
  botonPlay.onclick = () => { playing = !playing; pintarPlay(); pintarUtileria(); };
  raiz.querySelectorAll<HTMLButtonElement>('.lv-velocidad button').forEach((b) => {
    b.onclick = () => { speed = Number(b.dataset.s); raiz.querySelectorAll('.lv-velocidad button').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const teclas = (e: KeyboardEvent) => {
    const t = e.target;
    if (asking && pideEl.classList.contains('lv-pide-presupuesto')) {
      if (e.key === 'Tab') {
        const elementos = [...pideEl.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary')];
        const primero = elementos[0], ultimo = elementos.at(-1);
        if (e.shiftKey && (t === primero || !pideEl.contains(t as Node))) { e.preventDefault(); ultimo?.focus(); }
        else if (!e.shiftKey && (t === ultimo || !pideEl.contains(t as Node))) { e.preventDefault(); primero?.focus(); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); if (!enviando && D.pide) { descartadas.add(D.pide.id); cerrarPeticion(); } return; }
      if (e.key === 'Enter' && t instanceof Element && pideEl.contains(t) && !t.closest('button,summary')) {
        e.preventDefault(); pideEl.querySelector<HTMLButtonElement>('.yes')?.click(); return;
      }
      // Las teclas que desplazan la página tampoco la mueven; dentro del número siguen editándolo.
      const enCampo = t instanceof Element && !!t.closest('input'), enBoton = t instanceof Element && !!t.closest('button');
      if ((['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key) && !enCampo) || (e.key === ' ' && !enCampo && !enBoton)) e.preventDefault();
    }
    if (t instanceof Element && t.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (e.key !== 'Escape') return;
    if (pidiendo && D.pide) { descartadas.add(D.pide.id); cerrarPeticion(); }
    else if (objetoId) cerrarObjeto();
    else if (siguiendo) dejarDeSeguir();
    else if (sel) vista.click();
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

  /* ---------- objetos que se abren: pizarra, hucha, estanterías y cajas ---------- */
  const ZONA: Record<string, [number, number, number, number]> = { pizarra: [152, 12, 248, 136], hucha: [84, 84, 52, 66], S: [92, 492, 88, 108], P: [204, 492, 88, 108], N: [316, 492, 88, 108], X: [430, 570, 130, 30] };
  ESTANTE.forEach(([x, y], i) => { ZONA['f' + i] = [x, y, 81, 120]; });
  const CAJA: Record<'S' | 'P' | 'N' | 'X', { caja: AfirmacionLab['caja']; nombre: string }> = {
    S: { caja: 'sostenida', nombre: tr('Sostenida') }, P: { caja: 'parcial', nombre: tr('Parcial') },
    N: { caja: 'no_sostenida', nombre: tr('No sostenida') }, X: { caja: 'otras', nombre: tr('Otros veredictos') },
  };
  const esCaja = (id: string): id is keyof typeof CAJA => Object.hasOwn(CAJA, id);
  const nombreCaja = (c: AfirmacionLab['caja']) => Object.values(CAJA).find((x) => x.caja === c)!.nombre;
  const NOMBRE_PASO: Record<EstadoPasoLab, string> = { hecho: tr('Completado'), ahora: tr('En curso'), pendiente: tr('Pendiente'), fallo: tr('Falló'), omitido: tr('Omitido') };
  const nombreDe = (a: Agente) => (a.quien ? `${a.quien} (${a.label})` : a.label);
  const HOT: Record<string, HTMLButtonElement> = {};
  for (const [id, [x, y, w, h]] of Object.entries(ZONA)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lv-hot';
    b.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    b.onclick = (e) => { e.stopPropagation(); if (!asking) abrirObjeto(id); };
    capaHots.appendChild(b); HOT[id] = b;
  }
  let objetoId: string | null = null, objetoIzq = false, objetoHtml = '';
  function pintarHots() {
    const orden = ordenFuentes(D.fuentes);
    const etiqueta = (b: HTMLButtonElement, t: string) => { b.setAttribute('aria-label', t); b.title = t; };
    etiqueta(HOT.pizarra!, tr('Abrir la pizarra del plan'));
    HOT.hucha!.hidden = !D.presupuesto; etiqueta(HOT.hucha!, tr('Abrir la hucha del presupuesto'));
    ESTANTE.forEach((_, i) => { const f = orden[i], b = HOT['f' + i]!; b.hidden = !f; if (f) etiqueta(b, trp('Abrir la estantería de {f}', { f: f.nombre })); });
    for (const [k, c] of Object.entries(CAJA)) etiqueta(HOT[k]!, trp('Abrir la caja «{c}»', { c: c.nombre }));
    if (objetoId && HOT[objetoId]?.hidden) cerrarObjeto(false); else pintarObjeto();
  }
  const registro = (es: ActividadLab[], titulo: string) => (es.length
    ? `<div class="lv-o-reg"><span>${esc(titulo)}</span><ul>${es.map((e) => { const ag = AG.find((x) => x.name === e.agente); return `<li><b>${esc(ag ? ag.quien || ag.label : e.agente)}</b> ${esc(corta(e.texto, 160))}</li>`; }).join('')}</ul></div>` : '');
  function pintarObjeto() {
    const id = objetoId;
    if (!id) return;
    let k = '', t = '', cuerpo = '';
    if (id === 'pizarra') {
      const L = D.pasos.lista, E = D.pasos.estados;
      k = tr('La pizarra del plan');
      t = L.length ? trp('{m} pasos · {n} hechos', { m: L.length, n: E.filter((e) => e === 'hecho').length }) : tr('Todavía no hay plan en esta iteración');
      cuerpo = L.length ? `<ol class="lv-o-pasos">${L.map((p, i) => { const e = E[i] ?? 'pendiente'; return `<li style="--c:${RENGLON[e].caja}"><i></i><div><b>${esc(p.titulo)}</b>${p.detalle ? `<small>${esc(p.detalle)}</small>` : ''}</div><span>${esc(NOMBRE_PASO[e])}</span></li>`; }).join('')}</ol>` : '';
    } else if (id === 'hucha') {
      const pr = D.presupuesto;
      if (!pr) { cerrarObjeto(false); return; }
      k = tr('La hucha del presupuesto');
      t = trp('{n} de {m} llamadas al modelo', { n: ent(pr.usado), m: ent(pr.limite) });
      cuerpo = `<div class="lv-o-barra"><i style="width:${Math.min(100, (pr.usado / pr.limite) * 100)}%"></i></div><p>${esc(pr.usado > pr.limite ? trp('Esta iteración pasó su tope en {n} llamadas.', { n: ent(pr.usado - pr.limite) }) : pr.usado === pr.limite ? tr('Esta iteración llegó a su tope de llamadas.') : trp('Quedan {n} llamadas en esta iteración.', { n: ent(pr.limite - pr.usado) }))}</p>`
        + (pr.reserva ? `<p>${esc(trp('{n} están reservadas para cerrar la iteración.', { n: ent(pr.reserva) }))}</p>` : '');
    } else if (esCaja(id)) {
      const c = CAJA[id], afs = D.afirmaciones?.filter((a) => a.caja === c.caja) ?? null, n = D.juez.veredictos ? D.juez.veredictos[c.caja] : null;
      k = tr('Caja del juez'); t = afs ? `${c.nombre} · ${ent(afs.length)}` : c.nombre;
      if (afs) {
        cuerpo = afs.length
          ? `<ul class="lv-o-afs">${afs.slice(0, 40).map((a) => `<li><q>${esc(corta(a.texto, 240))}</q><small>${esc(a.articulo)}</small>${c.caja === 'otras' ? `<em>${esc(veredictoDe(a.veredicto).etiqueta)}</em>` : ''}${a.motivo ? `<p>${esc(corta(a.motivo, 220))}</p>` : ''}</li>`).join('')}</ul>${afs.length > 40 ? `<p class="lv-o-mas">${esc(trp('Y {n} más…', { n: ent(afs.length - 40) }))}</p>` : ''}`
          : `<p>${esc(tr('Ninguna afirmación de esta iteración cayó en esta caja.'))}</p>`;
      } else {
        cuerpo = `<p>${esc(n !== null ? trp('El resumen de la verificación cuenta {n} en esta caja.', { n: ent(n) }) : tr('La verificación de esta iteración todavía no tiene recuento.'))}</p>`
          + registro(D.actividad.filter((e) => e.agente === 'Juez').slice(-4), tr('Lo último del registro del juez'));
      }
    } else {
      const f = ordenFuentes(D.fuentes)[Number(id.slice(1))];
      if (!f) { cerrarObjeto(false); return; }
      const no = tr('No registrado'), cifra = (x: number | null) => (x !== null ? ent(x) : no);
      k = tr('Estantería'); t = f.nombre;
      cuerpo = `<dl class="lv-o-cifras"><div><dt>${esc(tr('Resultados'))}</dt><dd>${esc(cifra(f.salen))}</dd></div><div><dt>${esc(tr('Sirven'))}</dt><dd>${esc(cifra(f.sirven))}</dd></div><div><dt>${esc(tr('Consultas'))}</dt><dd>${esc(ent(f.consultas))}</dd></div></dl>`
        + (f.fallo ? `<p class="lv-o-mal">${esc(tr('No responde: una consulta falló sin devolver resultados.'))}</p>` : '')
        + registro(D.actividad.filter((e) => e.fuente && (e.fuente.includes(f.nombre) || baseDe(e.fuente).nombre === f.nombre)).slice(-3), tr('Lo último del registro en esta biblioteca'));
    }
    const html = `<button type="button" class="lv-cerrar" aria-label="${esc(tr('Cerrar'))}">×</button><div class="k">${esc(k)}</div><h3>${esc(t)}</h3>${cuerpo}`;
    if (html === objetoHtml) return;
    const foco = objetoEl.contains(document.activeElement);
    objetoHtml = html; objetoEl.innerHTML = html; objetoEl.setAttribute('aria-label', t);
    if (foco) objetoEl.querySelector<HTMLButtonElement>('.lv-cerrar')?.focus({ preventScroll: true });
  }
  function abrirObjeto(id: string) {
    if (objetoId === id) { cerrarObjeto(); return; }
    dejarDeSeguir(false);
    if (sel) { sel.el.classList.remove('sel'); sel = null; ficha.hidden = true; }
    objetoId = id; objetoHtml = '';
    const [x, y, w, h] = ZONA[id]!, ox = x + w / 2, oy = y + h / 2;
    objetoIzq = ox > ANCHO / 2;
    objetoEl.classList.toggle('izq', objetoIzq);
    pintarObjeto(); objetoEl.hidden = false;
    // El objeto queda en el centro del hueco que deja el panel, con el zoom que quepa en ese hueco.
    medirVisible();
    const hueco = vis.der - vis.izq - objetoEl.offsetWidth * kfAct - 60;
    zoomPunto(() => [ox + ((objetoIzq ? -1 : 1) * objetoEl.offsetWidth * kfAct) / 2 / miraS, oy], Math.max(1, Math.min(1.7, hueco / (w + 48))));
    Object.entries(HOT).forEach(([k, b]) => b.classList.toggle('on', k === id));
    objetoEl.querySelector<HTMLButtonElement>('.lv-cerrar')?.focus({ preventScroll: true });
  }
  function cerrarObjeto(enfocar = true) {
    if (!objetoId) return;
    const b = HOT[objetoId];
    objetoId = null; objetoHtml = ''; objetoEl.hidden = true; objetoEl.innerHTML = '';
    Object.values(HOT).forEach((x) => x.classList.remove('on'));
    if (!sel && !asking && !siguiendo) zoomOut();
    if (enfocar && b && !b.hidden) b.focus({ preventScroll: true });
  }
  objetoEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('.lv-cerrar')) cerrarObjeto();
  });

  /* ---------- el mensajero y las monedas ---------- */
  /** Cuando el trabajo pasa de una sala a otra, alguien libre lleva el expediente. */
  function mensajero(de: SalaLab, a: SalaLab) {
    if (REDUCIR || asking || D.conexion !== 'en_linea' || de === a || de === 'r7' || a === 'r7') return;
    const m = AG.find((b) => b.room === de && !b.desk && !b.busy && !b.ictx && !b.recado && !D.activos.includes(b.name) && atHome(b));
    if (!m) return;
    const [gx, gy, gw, gh] = GEOM[a], dx = gx + gw / 2 - 24, dy = gy + gh - 76;
    const ctx = nuevoCtx();
    m.ictx = ctx; m.recado = true; m.busy = true; m.gesto = null; m.carry = 'card';
    setEv(esc(trp('{q} lleva el expediente a la sala siguiente: {sala}', { q: nombreDe(m), sala: TITULO_SALA[a]! })));
    spawn((async () => {
      try {
        await walk(ctx, m, [[m.x, dy], [dx, dy]]);
        m.carry = null;
        FLY.push({ kind: 'card', from: [dx + 42, dy + 44], to: [dx + 58, dy + 60], t0: simT, dur: 0.5, arc: 14 });
        const recibe = AG.find((b) => b.room === a && D.activos.includes(b.name));
        if (recibe) recibe.emo = { k: '!', t0: rt };
        await ctx.wait(1.2);
        await walk(ctx, m, [[m.hx, m.y], [m.hx, m.hy]]);
      } finally {
        if (m.ictx === ctx) { m.ictx = null; m.busy = false; m.recado = false; m.carry = null; }
      }
    })());
  }
  function monedas(n: number) {
    if (REDUCIR || !D.presupuesto || n <= 0) return;
    for (let i = 0; i < Math.min(5, n); i++) FLY.push({ kind: 'coin', from: [110, 30], to: [110, 92], t0: simT + i * 0.3, dur: 0.7, arc: 0, fin: SON.moneda });
  }

  /* ---------- gestos de espera ---------- */
  function gestos() {
    for (const a of AG) {
      if (a.gesto && simT >= a.gesto.hasta) { if (a.gesto.k === 'mira') a.face = a.gesto.cara; a.gesto = null; }
      if (a.gesto) { if (a.gesto.k === 'mira') a.face = Math.floor((a.gesto.hasta - simT) / 0.8) % 2 ? -a.gesto.cara : a.gesto.cara; continue; }
      if (simT < a.prox) continue;
      a.prox = simT + 10 + Math.random() * 22;
      if (asking || !atHome(a) || a.busy || a.ictx || a.bub || a.recado || a.name === 'Tú' || D.activos.includes(a.name) || dormido(a)) continue;
      const op = a.desk ? (['estira', 'mira'] as const) : (['estira', 'cafe', 'mira'] as const);
      const k = op[Math.floor(Math.random() * op.length)]!;
      a.gesto = { k, hasta: simT + (k === 'estira' ? 1.6 : k === 'cafe' ? 4 : 2.4), cara: a.face };
    }
  }

  /* ---------- sigue una afirmación ---------- */
  const papel = { x: 0, y: 0, on: false };
  let sigCtx: Ctx | null = null, sigIdx = -1, siguiendo = false, sigueHtml = '';
  function pintarSigue() {
    const afs = D.afirmaciones, t = siguiendo ? tr('Dejar de seguir') : tr('Sigue una afirmación');
    const html = `<svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true"><path d="M1 1h6l3 3v8H1z" fill="#F4F1EA"/><path d="M3 6h5M3 9h3" stroke="#9C97B3"/></svg><span>${esc(t)}</span>`;
    if (html !== sigueHtml) { sigueHtml = html; botonSigue.innerHTML = html; }
    botonSigue.disabled = !siguiendo && (!afs || afs.length === 0 || asking);
    botonSigue.title = siguiendo ? t : afs === null ? tr('La cadena de evidencia todavía no ha llegado') : afs.length === 0 ? tr('Esta iteración no tiene afirmaciones en la cadena de evidencia') : trp('Recorre una de las {n} afirmaciones de esta iteración, del artículo a su caja', { n: ent(afs.length) });
    botonSigue.setAttribute('aria-pressed', String(siguiendo));
  }
  function narrar(af: AfirmacionLab, pasos: string[], i: number) {
    const final = i < 0 || i === pasos.length - 1;
    narraEl.innerHTML = `<div class="k">${esc(i < 0 ? tr('Sigue una afirmación') : trp('Sigue una afirmación · paso {n} de {m}', { n: i + 1, m: pasos.length }))}</div><q>${esc(corta(af.texto, 220))}</q>`
      + (i < 0 ? `<ol>${pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : `<p>${esc(pasos[i]!)}</p>`)
      + `<div class="row">${final ? `<button type="button" data-a="cerrar">${esc(tr('Cerrar'))}</button><button type="button" class="yes" data-a="otra">${esc(tr('Seguir otra'))}</button>` : `<button type="button" data-a="cerrar">${esc(tr('Dejar de seguir'))}</button>`}</div>`;
    narraEl.hidden = false;
  }
  function volar(ctx: Ctx, x: number, y: number, dur: number, arc: number) {
    const x0 = papel.x, y0 = papel.y, t0 = simT;
    return ctx.until(() => {
      const t = Math.min(1, (simT - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      papel.x = x0 + (x - x0) * e; papel.y = y0 + (y - y0) * e - Math.sin(Math.PI * t) * arc;
      return t >= 1;
    });
  }
  const BOCA: Record<AfirmacionLab['caja'], [number, number]> = { sostenida: [136, 540], parcial: [248, 540], no_sostenida: [360, 540], otras: [490, 586] };
  const COLOR_CAJA: Record<AfirmacionLab['caja'], string> = { sostenida: '#7FD1A5', parcial: '#F2C14E', no_sostenida: '#E2706A', otras: '#9C97B3' };
  function seguir() {
    const afs = D.afirmaciones;
    if (!afs?.length || asking) return;
    dejarDeSeguir(false); cerrarObjeto(false);
    if (sel) { sel.el.classList.remove('sel'); sel = null; ficha.hidden = true; }
    sigIdx = (sigIdx + 1) % afs.length;
    const af = afs[sigIdx]!, ext = P('Extractor de afirmaciones');
    const orden = ordenFuentes(D.fuentes), fi = Math.max(0, af.biblioteca ? orden.findIndex((f) => f.nombre === af.biblioteca) : 0);
    const [ex, ey] = ESTANTE[fi]!, et = veredictoDe(af.veredicto).etiqueta, titulo = af.articulo.replace(/[.\s]+$/, '');
    const pasos = [
      af.biblioteca ? trp('Sale de un artículo que llegó desde {b}: «{a}».', { b: af.biblioteca, a: titulo }) : trp('Sale del artículo «{a}».', { a: titulo }),
      trp('{q} copia del artículo la frase que se puede comprobar.', { q: nombreDe(ext) }),
      tr('La cinta la lleva hasta la mesa del juez.'),
      (af.veredicto === 'sin_verificar' ? tr('Todavía no tiene una decisión registrada.') : trp('Decisión registrada: {v}.', { v: et })) + (af.motivo ? ' ' + af.motivo : ''),
      trp('Cae en la caja «{c}».', { c: nombreCaja(af.caja) }),
    ];
    if (af.veredicto === 'sin_verificar') pasos.pop();
    siguiendo = true; pintarSigue();
    if (REDUCIR) { narrar(af, pasos, -1); return; }
    const ctx = nuevoCtx(); sigCtx = ctx;
    papel.x = ex + 40; papel.y = ey + 50; papel.on = true;
    zoomPunto(() => [papel.x, papel.y], 1.8);
    spawn((async () => {
      narrar(af, pasos, 0); await ctx.wait(3.2);
      narrar(af, pasos, 1); await volar(ctx, ext.hx + 40, ext.hy + 40, 1.4, 30);
      type(ext, 2.4); SON.teclas(); await ctx.wait(2.6);
      narrar(af, pasos, 2); await volar(ctx, 476, 182, 0.8, 12);
      const t0 = simT;
      await ctx.until(() => { const d = Math.min(CL, (simT - t0) * 80), p = convAt(d); papel.x = p[0]; papel.y = p[1]; return d >= CL; });
      if (af.veredicto === 'sin_verificar') { narrar(af, pasos, 3); return; }
      narrar(af, pasos, 3); await volar(ctx, 312, 378, 0.9, 16); await ctx.wait(1);
      const st = div('lv-sello', capaBocadillos, esc(et));
      st.style.left = '312px'; st.style.top = '356px'; st.style.color = COLOR_CAJA[af.caja];
      STAMPS.push({ el: st, until: simT + 2.4 }); SON.sello();
      await ctx.wait(2.4);
      narrar(af, pasos, 4);
      const [bx, by] = BOCA[af.caja];
      await volar(ctx, bx, by, 1, 24);
    })());
  }
  function dejarDeSeguir(zoom = true) {
    if (!siguiendo) return;
    siguiendo = false; sigCtx?.kill(); sigCtx = null; processWaits();
    papel.on = false; narraEl.hidden = true; narraEl.innerHTML = '';
    pintarSigue();
    if (zoom && !sel && !asking && !objetoId) zoomOut();
  }
  narraEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'otra') seguir(); else if (a === 'cerrar') dejarDeSeguir();
  });
  botonSigue.onclick = () => { if (siguiendo) dejarDeSeguir(); else seguir(); };

  /* ---------- el juez lee una afirmación real y la sella ---------- */
  // Mientras el juez trabaja, su mesa enseña afirmaciones que ya decidió en
  // esta iteración (la cadena de evidencia): la lee, sella su veredicto y la
  // deja en su caja. Cada decisión se representa una vez, sin resolver nada nuevo.
  const MARCA_CAJA: Record<AfirmacionLab['caja'], string> = { sostenida: 'S', parcial: 'P', no_sostenida: 'N', otras: 'X' };
  const juzgadas = new Set<string>();
  let proximoJuicio = 2;
  const claveJuicio = (a: AfirmacionLab) => JSON.stringify([a.id, a.veredicto, a.motivo]);
  const textoSello = (af: AfirmacionLab) => af.caja === 'sostenida' ? tr('SOSTENIDA') : af.caja === 'parcial' ? tr('PARCIAL')
    : af.caja === 'no_sostenida' ? tr('NO SOSTENIDA') : veredictoDe(af.veredicto).etiqueta.toLocaleUpperCase();
  function siguienteJuicio(): AfirmacionLab | null {
    const afs = D.afirmaciones;
    if (!afs?.length) return null;
    return afs.find((a) => a.veredicto !== 'sin_verificar' && !juzgadas.has(claveJuicio(a))) ?? null;
  }
  function mantenerJuicio() {
    const J = P('Juez');
    if (siguiendo || simT < proximoJuicio || !D.activos.includes('Juez') || !libreParaEscena(J) || !atHome(J)) return;
    const af = siguienteJuicio();
    if (af) juzgar(J, af);
  }
  function juzgar(J: Agente, af: AfirmacionLab) {
    const clave = claveJuicio(af); juzgadas.add(clave);
    const ctx = nuevoCtx(), escena: Escena = { ctx, agentes: [J], trabajo: true, objetos: [] };
    escenas.set(J, escena); J.ictx = ctx; J.busy = true; J.el.dataset.escena = 'trabajo';
    const color = COLOR_CAJA[af.caja];
    const vuela = (from: number[], to: number[], dur: number, arc: number) => { FLY.push({ kind: 'paper', from, to, t0: simT, dur, arc, ctx }); return ctx.wait(dur); };
    spawn((async () => {
      try {
        hoja = false;
        await vuela(convAt(CL), [312, 378], 0.6, 30); hoja = true;
        setEv(esc(tr('Decisión registrada en la cadena de evidencia')));
        const doc = documento([tr('Decisión registrada'), af.texto, af.articulo, af.cita, af.motivo].filter(Boolean).join('\n'), 'r2', 'lv-documento-juicio');
        doc.dataset.afirmacion = af.id; escena.objetos!.push(doc);
        type(J, 2); await ctx.wait(3);
        const st = div('lv-sello', capaBocadillos, esc(textoSello(af)));
        st.style.left = '312px'; st.style.top = '352px'; st.style.color = color;
        STAMPS.push({ el: st, until: simT + 1.8 }); escena.objetos!.push(st); SON.sello();
        await ctx.wait(1.2); hoja = false;
        await vuela([312, 378], BOCA[af.caja], 0.7, 60);
        const t = TAG[MARCA_CAJA[af.caja]];
        if (t) { t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
        setEv(`<span style="color:${color}">${esc(trp('Veredicto: {v}', { v: veredictoDe(af.veredicto).etiqueta }))}</span>`);
        await ctx.wait(1);
      } finally {
        escena.objetos?.forEach(o => o.remove());
        if (ctx.dead) juzgadas.delete(clave);
        if (escenas.get(J) === escena) {
          hoja = D.activos.includes('Juez');
          escenas.delete(J);
          if (J.ictx === ctx) { J.ictx = null; J.busy = false; }
          delete J.el.dataset.escena;
        }
        proximoJuicio = simT + 4;
      }
    })());
  }

  /* ---------- sonido ---------- */
  function pintarSonido() {
    botonSonido.innerHTML = `<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 4h3l4-3v10L4 8H1z" fill="#F4F1EA"/>${sonido ? '<path d="M10 3.5c1 .8 1.5 1.6 1.5 2.5S11 7.7 10 8.5" stroke="#F4F1EA" stroke-width="1.4" fill="none"/>' : '<path d="M10 4l3 4M13 4l-3 4" stroke="#F4F1EA" stroke-width="1.4"/>'}</svg>`;
    botonSonido.title = sonido ? tr('Silenciar los sonidos') : tr('Activar los sonidos de 8 bits');
    botonSonido.setAttribute('aria-label', tr('Sonidos de 8 bits'));
    botonSonido.setAttribute('aria-pressed', String(sonido));
    botonSonido.classList.toggle('on', sonido);
  }
  botonSonido.onclick = () => {
    sonido = !sonido;
    try { localStorage.setItem(CLAVE_SONIDO, sonido ? '1' : '0'); } catch { /* Sin almacenamiento local. */ }
    pintarSonido(); SON.campana();
  };
  pintarSonido();

  /* ---------- teclado: de agente en agente con las flechas ---------- */
  function vecino(a: Agente, dx: number, dy: number): Agente | null {
    let mejor: Agente | null = null, min = Infinity;
    for (const b of AG) {
      if (b === a || b.name === 'Juez del torneo B') continue;
      const vx = b.hx - a.hx, vy = b.hy - a.hy, along = vx * dx + vy * dy, perp = Math.abs(vx * dy - vy * dx);
      if (along <= 8) continue;
      const sc = along + 2 * perp;
      if (sc < min) { min = sc; mejor = b; }
    }
    return mejor;
  }
  const FLECHA: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

  /* ---------- dibujo ---------- */
  const carga = (src: string) => { const im = new Image(); im.src = src; return im; };
  const FONDO = carga(urlFondo);
  const FG = DELANTE.map(([src, x, y, w, h]) => ({ im: carga(src), x, y, w, h }));
  const CL = 230 + 104;
  const convAt = (s: number): [number, number, number] => (s <= 230 ? [476, 182 + s, 0] : [476 - (s - 230), 412, 1]);
  /** Cuarto exclusivo de los dos especialistas, sobre el suelo ya existente. */
  function dibujarCuartoNovedad() {
    if (!g) return;
    const [x, y, w, h] = GEOM.r7;
    g.fillStyle = '#353146'; g.fillRect(x, y, w, 44);
    for (let dy = 44; dy < h; dy += 16) for (let dx = 0; dx < w; dx += 16) {
      g.fillStyle = (dx / 16 + Math.floor((dy - 44) / 16)) % 2 ? '#262332' : '#292635';
      g.fillRect(x + dx, y + dy, Math.min(16, w - dx), Math.min(16, h - dy));
    }
    g.fillStyle = '#17131F'; g.fillRect(x, y + h, w, 8);
    g.fillStyle = '#353146'; g.fillRect(x, y + h + 8, w, 44);
    g.fillStyle = '#5A5670'; g.fillRect(x, y + h + 8, w, 4);
    // Dos expedientes en la pared, con el mismo acento lavanda de sus batas.
    for (const dx of [w - 112, w - 64]) {
      g.fillStyle = '#17131F'; g.fillRect(x + dx, y + 10, 32, 26);
      g.fillStyle = '#B79CF2'; g.fillRect(x + dx + 4, y + 14, 24, 4);
      g.fillStyle = '#C9C4DA'; g.fillRect(x + dx + 4, y + 22, 16, 2); g.fillRect(x + dx + 4, y + 28, 20, 2);
    }
  }
  function drawObj(kind: Obj, x: number, y: number, rot: number) {
    if (!g) return;
    g.save(); g.translate(Math.round(x), Math.round(y));
    if (kind === 'paper') {
      const w = rot ? 14 : 11, h = rot ? 11 : 14;
      g.fillStyle = '#17131F'; g.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
      g.fillStyle = '#F4F1EA'; g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#9C97B3'; g.fillRect(-w / 2 + 2, -h / 2 + 3, w - 4, 1); g.fillRect(-w / 2 + 2, -h / 2 + 6, w - 5, 1);
    } else if (kind === 'coin') {
      g.fillStyle = '#17131F'; g.fillRect(-4, -4, 8, 8); g.fillStyle = '#F2C14E'; g.fillRect(-3, -3, 6, 6); g.fillStyle = '#FFF2B8'; g.fillRect(-2, -2, 2, 2);
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
    const ge = !moving && a.gesto && simT < a.gesto.hasta ? a.gesto : null;
    const frame = moving ? (Math.floor(simT * 7) % 2 ? 1 : 2) : ge?.k === 'estira' ? 3 : 0;
    let bob = 0;
    if (moving) bob = frame === 1 ? -1 : 0;
    else if (a.typing > simT) bob = Math.floor(simT * 5) % 2 ? -1 : 0;
    a.bob = bob;
    const s = sprite(a, frame);
    const [gx, gy] = a.reaccion ? desplazamientoGesto(a.reaccion.gesto, simT - a.reaccion.desde, REDUCIR || moving) : [0, 0];
    g.save();
    if (a.face < 0) { g.translate(a.x + 48 + gx!, a.y + bob * 2 + gy!); g.scale(-1, 1); g.drawImage(s, 0, 0, 48, 64); }
    else g.drawImage(s, a.x + gx!, a.y + bob * 2 + gy!, 48, 64);
    g.restore();
    if (a.carry) drawObj(a.carry, a.x + (a.face < 0 ? 6 : 42), a.y + 44 + bob * 2, 0);
    if (ge?.k === 'cafe') {
      // Una taza en la mano y un hilo de vapor.
      const x = a.x + (a.face < 0 ? 2 : 38), y = a.y + 34;
      g.fillStyle = '#17131F'; g.fillRect(x - 1, y - 1, 10, 10); g.fillRect(x + 9, y + 2, 3, 4);
      g.fillStyle = '#F4F1EA'; g.fillRect(x, y, 8, 8); g.fillStyle = '#7A4B2A'; g.fillRect(x + 1, y + 1, 6, 2);
      if (!REDUCIR) { g.fillStyle = '#C9C4DA88'; const o = Math.floor(rt * 3) % 2; g.fillRect(x + 2 + o, y - 5, 1, 3); g.fillRect(x + 5 - o, y - 8, 1, 3); }
    }
  }
  /** Una matriz de pixeles ('#') pintada a escala k. */
  function pixeles(m: string[], x: number, y: number, k: number, col: string) {
    if (!g) return;
    g.fillStyle = col;
    m.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') g.fillRect(x + i * k, y + j * k, k, k); });
  }
  function dibujarEmote(a: Agente) {
    if (!g || !a.emo) return;
    const t = rt - a.emo.t0;
    if (t > 3.2) { a.emo = null; return; }
    const pop = REDUCIR ? 0 : t < 0.25 ? Math.round((1 - t / 0.25) * 6) : 0, x = a.x + 40, y = a.y + 2 - pop + a.bob * 2;
    if (a.emo.k === 'gota') {
      const cae = REDUCIR ? 0 : Math.floor((t * 6) % 4);
      pixeles(GOTA, x - 1, y + 5 + cae, 2, '#17131F'); pixeles(GOTA, x, y + 4 + cae, 2, '#7CC7E8');
      return;
    }
    g.fillStyle = '#17131F'; g.fillRect(x - 1, y - 1, 16, 20);
    g.fillStyle = '#F4F1EA'; g.fillRect(x, y, 14, 18);
    pixeles(GLIFO[a.emo.k], x + 1, y + 1, 2, a.emo.k === '!' ? '#E8925A' : '#2E2A3A');
  }
  /** Quien no tiene trabajo en esta iteración da cabezadas. */
  function dibujarZetas(a: Agente) {
    if (!g) return;
    for (let j = 0; j < 3; j++) {
      const f = REDUCIR ? 0.15 + j * 0.33 : (rt * 0.5 + j / 3) % 1;
      g.globalAlpha = Math.max(0, 1 - f);
      pixeles(ZETA, Math.round(a.x + 36 + f * 12), Math.round(a.y + 6 - f * 26), f > 0.5 ? 2 : 1.5, '#C9C4DA');
    }
    g.globalAlpha = 1;
  }
  const dormido = (a: Agente) => {
    const e = estadoDe(a.room === 'bib' ? 'r1' : a.room);
    return e === 'no_toca' && a.turno % 3 === 0 && atHome(a) && !a.bub && !D.activos.includes(a.name) && !a.recado;
  };
  /** Las pantallas de los escritorios se llenan de renglones mientras alguien escribe. */
  function dibujarPantallas() {
    if (!g) return;
    for (const a of AG) {
      const p = PANTALLA[a.name];
      if (!p || a.typing <= simT || !atHome(a)) continue;
      const [x, y] = p, k0 = Math.floor(simT * 5);
      g.fillStyle = '#2B5566'; g.fillRect(x, y, 20, 16);
      for (let i = 0; i < 4; i++) {
        const k = k0 + i, w = i === 3 ? 2 + (Math.floor(simT * 10) % 12) : 4 + ((k * 7 + a.i * 3) % 11);
        g.fillStyle = i === 3 ? '#F4F1EA' : '#7FD1A5'; g.fillRect(x + 2, y + 2 + i * 3, w, 2);
      }
    }
  }
  /** La hucha del presupuesto: se llena de monedas según las llamadas al modelo gastadas. */
  function dibujarHucha() {
    if (!g) return;
    const pr = D.presupuesto, x = 94, y = 94, w = 32, h = 42;
    g.fillStyle = '#17131F'; g.fillRect(x - 2, y + h, w + 4, 4); g.fillRect(x + 2, y + h + 4, 3, 10); g.fillRect(x + w - 5, y + h + 4, 3, 10);
    g.fillStyle = '#5B3A29'; g.fillRect(x - 1, y + h + 1, w + 2, 2);
    const lleno = pr ? Math.min(1, pr.usado / pr.limite) : 0, tope = pr !== null && pr.usado >= pr.limite;
    g.fillStyle = tope && !REDUCIR && Math.floor(rt * 2) % 2 ? '#E2706A' : '#17131F';
    g.fillRect(x - 1, y + 3, w + 2, h - 2); g.fillRect(x + 3, y - 1, w - 6, 5);
    g.fillStyle = '#CFE6FF55'; g.fillRect(x, y + 4, w, h - 4);
    const hm = Math.round((h - 6) * lleno);
    if (hm > 0) {
      g.fillStyle = '#C9962E'; g.fillRect(x + 1, y + h - 1 - hm, w - 2, hm);
      g.fillStyle = '#F2C14E';
      for (let j = y + h - 1 - hm; j < y + h - 1; j += 4) for (let i = x + 2 + ((j / 4) % 2) * 3; i < x + w - 4; i += 6) g.fillRect(i, j, 4, 2);
    }
    g.fillStyle = '#F4F1EA88'; g.fillRect(x + 3, y + 7, 2, h - 14);
    g.fillStyle = '#8A3B2E'; g.fillRect(x + 4, y, w - 8, 4); g.fillStyle = '#17131F'; g.fillRect(x + 11, y + 1, 10, 2);
  }
  /** La luz de cada sala según su estado real, y la alarma donde la corrida paró o falló. */
  function dibujarLuces() {
    if (!g) return;
    for (const k of Object.keys(GEOM) as Sala[]) {
      if (k === 'rec') continue;
      const [x, y, w, h] = GEOM[k], e = estadoDe(k === 'bib' ? 'r1' : k);
      // Solo se atenúan, y poco, las salas que no forman parte de esta corrida; las que vienen después siguen encendidas.
      if (e === 'no_toca') { g.fillStyle = '#07060C2E'; g.fillRect(x, y, w, h); }
      else if (e === 'ahora' && D.trabajando && k !== 'bib') {
        const gr = g.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
        gr.addColorStop(0, '#FFC48A40'); gr.addColorStop(1, '#FFC48A00');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
      }
      if (k === 'bib') continue;
      const roja = e === 'fallo' || (e === 'ahora' && !D.trabajando && !D.pasada && PARADA_ROJA.has(D.estado));
      const ambar = !roja && e === 'ahora' && !D.trabajando && !D.pasada && PARADA_AMBAR.has(D.estado);
      if (roja || ambar) alarma(x + w - 30, y + 12, roja ? '#E2706A' : '#F2C14E');
    }
  }
  function alarma(x: number, y: number, col: string) {
    if (!g) return;
    const on = REDUCIR || Math.floor(rt * 2.4) % 2 === 0;
    if (on) {
      const gr = g.createRadialGradient(x + 7, y + 6, 2, x + 7, y + 6, 46);
      gr.addColorStop(0, col + '66'); gr.addColorStop(1, col + '00');
      g.fillStyle = gr; g.fillRect(x - 40, y - 40, 94, 94);
    }
    g.fillStyle = '#17131F'; g.fillRect(x - 1, y - 1, 16, 14); g.fillRect(x - 3, y + 12, 20, 5);
    g.fillStyle = on ? col : '#5A3438'; g.fillRect(x, y, 14, 12);
    g.fillStyle = on ? '#FFFFFFAA' : '#77728C55'; g.fillRect(x + 2, y + 2, 3, 4);
    g.fillStyle = '#3A3550'; g.fillRect(x - 2, y + 13, 18, 3);
  }
  function draw() {
    if (!g) return;
    g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = '#0E0D14'; g.fillRect(0, 0, ANCHO, ALTO_VISTA);
    if (FONDO.complete) g.drawImage(FONDO, -0.5, -0.5, ANCHO + 1, ALTO_VISTA + 1);
    dibujarCuartoNovedad();
    ordenFuentes(D.fuentes).forEach((f, i) => {
      const [x, y] = ESTANTE[i]!;
      g.fillStyle = f.fallo ? f.salen === null ? '#E2706A' : '#F2C14E' : '#7CC7E8'; g.fillRect(x, y, 81, 5);
      if (f.fallo && f.salen === null) { g.fillRect(x, y + 44, 81, 8); g.fillStyle = '#C6524A'; g.fillRect(x + 12, y + 41, 8, 13); g.fillRect(x + 59, y + 41, 8, 13); }
    });
    D.pasos.estados.slice(0, 7).forEach((e, i) => {
      const r = RENGLON[e], y = 40 + i * 14;
      if (r.fondo) { g.fillStyle = r.fondo; g.fillRect(152, y - 3, 224, 13); }
      g.fillStyle = r.caja; g.fillRect(167, y, 8, 8);
      if (e !== 'pendiente') { g.fillStyle = r.fondo ?? '#E8E6F0'; g.fillRect(169, y + 2, 4, 4); }
      g.fillStyle = r.linea; g.fillRect(183, y + 3, 70 + ((i * 37) % 60), 3);
    });
    dibujarHucha();
    // La cinta lleva papeles mientras quedan afirmaciones por juzgar.
    const quedan = D.juez.total !== null && D.juez.hechas !== null ? D.juez.total - D.juez.hechas : 0;
    const n = D.trabajando && D.activos.includes('Juez') ? Math.min(11, Math.max(0, quedan)) : 0;
    for (let i = 0; i < n; i++) { const s = CL - 6 - i * 26 + (conv % 26); if (s < 0 || s > CL) continue; const p = convAt(s); drawObj('paper', p[0], p[1], p[2]); }
    const seated = AG.filter((a) => a.desk && atHome(a)), rest = AG.filter((a) => !(a.desk && atHome(a))).sort((p, q) => p.y - q.y);
    seated.forEach(drawAgent);
    FG.forEach((f) => { if (f.im.complete) g.drawImage(f.im, f.x, f.y, f.w, f.h); });
    dibujarPantallas();
    if (hoja) drawObj('paper', 312, 378, 0);
    rest.forEach(drawAgent);
    for (let i = FLY.length - 1; i >= 0; i--) {
      const f = FLY[i]!;
      if (simT < f.t0) continue;
      const t = Math.min(1, (simT - f.t0) / f.dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      drawObj(f.kind, f.from[0]! + (f.to[0]! - f.from[0]!) * e, f.from[1]! + (f.to[1]! - f.from[1]!) * e - Math.sin(Math.PI * t) * f.arc, 0);
      if (t >= 1) { FLY.splice(i, 1); f.fin?.(); }
    }
    dibujarLuces();
    AG.forEach((a) => { if (dormido(a)) dibujarZetas(a); dibujarEmote(a); });
    if (papel.on) {
      g.fillStyle = '#FFB27A66'; g.fillRect(Math.round(papel.x) - 12, Math.round(papel.y) - 13, 24, 26);
      drawObj('paper', papel.x, papel.y, 0);
    }
  }
  function syncDom() {
    AG.forEach((a) => {
      if (a.reaccion && simT >= a.reaccion.hasta) {
        a.reaccion = undefined; delete a.el.dataset.emocion; delete a.el.dataset.gesto;
      }
      const b = a.bob * 2;
      a.el.style.transform = `translate(${a.x}px,${a.y + b}px)`;
      a.lb.style.top = (atHome(a) ? a.ldy : 66) + 'px';
      a.el.classList.toggle('away', a.away);
      const rjTxt = a.desde === null ? '' : trp('En curso · {t}', { t: transcurrido(a.desde) });
      if (rjTxt !== a.rjTxt) { a.rjTxt = rjTxt; a.rj.textContent = rjTxt; a.rj.hidden = !rjTxt; }
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
    gestos();
    processWaits();
    mantenerEscenas();
  }
  let last = performance.now(), raf = 0;
  function frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    rt += dt;
    if (document.hidden) { raf = requestAnimationFrame(frame); return; }
    camara(dt);
    if (playing && !document.hidden && !REDUCIR) { dt *= speed; while (dt > 0) { const d = Math.min(0.05, dt); step(d); dt -= d; } }
    draw(); syncDom();
    raf = requestAnimationFrame(frame);
  }

  pintarSalas(); pintarMarcas();
  sincronizarActividad(true);
  sincronizarPelicula(true);
  pintarSigue();
  mostrarPeticion();
  raf = requestAnimationFrame(frame);

  return {
    conversar(turnos: TurnoLaboratorio[], habilitada = true) {
      if (!habilitada) {
        dialogos.length = 0;
        [...escenas.entries()].filter(([, e]) => e.temaId).forEach(([a]) => cancelarEscena(a));
        AG.forEach((a) => {
          if (a.bub?.el.dataset.turno) { a.bub.el.remove(); a.bub = null; }
          a.reaccion = undefined; delete a.el.dataset.emocion; delete a.el.dataset.gesto;
        });
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
      if (cambio) { identidad = d.identidad; vistas.clear(); descartadas.clear(); cerrarPeticion(); dejarDeSeguir(); cerrarObjeto(false); sigIdx = -1; juzgadas.clear(); pelicula.limpiar(); }
      // La corrida puede cambiar de tarea mientras termina el intercambio visual.
      // Solo detenerla, perder la conexión o cambiar de iteración cancela las escenas.
      const detener = !d.trabajando || d.conexion !== 'en_linea';
      if (cambio || (detener && (antes.trabajando || antes.conexion !== d.conexion))) pararActividad();
      if (cambio) { dialogos.length = 0; dialogosVistos.clear(); ultimaCharla.clear(); }
      if (!d.trabajando || d.conexion !== 'en_linea') dialogos.length = 0;
      pintarSalas(); pintarMarcas(); pintarChips();
      if (pidiendo && (!d.pide || d.pide.id !== pidiendo)) cerrarPeticion();
      if (pidiendo && !enviando && (JSON.stringify(antes.pide) !== JSON.stringify(d.pide) || JSON.stringify(antes.pasos.lista) !== JSON.stringify(d.pasos.lista))) cerrarPeticion();
      if (d.pide && !pidiendo) mostrarPeticion();
      if (!asking && (cambio || antes.foco !== d.foco)) chIdx = capituloDe(d.foco);
      sincronizarActividad(cambio);
      const fotoNueva = cambio || antes.conexion !== d.conexion || (!antes.trabajando && d.trabajando) || (antes.trabajando && !d.trabajando && d.estado !== 'terminada');
      if (fotoNueva) pelicula.limpiar();
      sincronizarPelicula(fotoNueva);
      if (!D.pelicula && !cambio && antes.foco !== d.foco) mensajero(antes.foco, d.foco);
      const u0 = antes.presupuesto?.usado ?? null, u1 = d.presupuesto?.usado ?? null;
      if (!cambio && u0 !== null && u1 !== null && u1 > u0) monedas(u1 - u0);
      if (!cambio && (d.juez.hechas ?? 0) > (antes.juez.hechas ?? 0)) SON.sello();
      if (aprobada && d.pide?.id !== aprobada) { aprobada = null; SON.campana(); monedas(3); }
      pintarSigue();
    },
    desmontar() {
      vivo = false;
      cancelAnimationFrame(raf);
      pararActividad();
      pelicula.limpiar();
      AG.forEach((a) => a.ictx?.kill());
      processWaits();
      window.removeEventListener('keydown', teclas);
      fijarPagina(false);
      sigCtx?.kill();
      void audio?.close().catch(() => undefined);
      raiz.innerHTML = '';
    },
  };
}
