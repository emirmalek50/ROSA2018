// La decoración de cada sala: lo que hace que «Juzgan las ideas» se reconozca
// como un tribunal y «Proponen ideas» como un taller, y no como el mismo
// suelo de damero con gente encima (Emir, 8 de octubre de 2026: «no hay
// decoración ni nada, me gustaría que cada cuarto tenga su propia decoración
// característica»).
//
// Mismo estilo que el fondo (assets/labvivo/fondo.png): bloques planos con
// contorno de 1 px #17131F, maderas y metales apagados. Las posiciones salen
// del mapa de cada sala (dónde están los personajes, sus rótulos y sus
// pasillos), para no tapar a nadie: casi todo va en la pared o en los huecos
// que dejan las filas. Lo que puede contar algo real lo cuenta: los palitos
// de la pared del Killer son las hipótesis descartadas, el mapa de la
// revisión final tiene un nodo por hipótesis viva, el corcho de Ayo se llena
// con las afirmaciones sostenidas, el cronómetro marca los segundos de verdad
// y la ventana de la recepción enseña el cielo de la hora del ordenador.
// Lo que se anima solo lo hace cuando su sala trabaja, salvo el reloj.

import type { DatosLab } from '../../lib/labVivo';
import { luzPorHora, nivelDePila } from './vida';

export interface Ambiente {
  g: CanvasRenderingContext2D;
  D: DatosLab;
  /** Reloj real en segundos, para lo que late. */
  rt: number;
  /** Menos movimiento: nada se anima. */
  quieto: boolean;
  ahora: Date;
}

const T = '#17131F';
const C = {
  madera: '#6D4B39', maderaClara: '#8A5A3A', maderaOsc: '#4A3326',
  metal: '#4A4458', metalClaro: '#77728C', metalOsc: '#2E2A3A',
  papel: '#F4F1EA', papelOsc: '#D9D4CA', linea: '#9C97B3', lineaOsc: '#5A5670',
  oro: '#C9962E', oroClaro: '#F2C14E',
  verde: '#3ECF8E', verdeSuave: '#7FD1A5', rojo: '#E2706A', ambar: '#F2C14E', azul: '#7CC7E8', lila: '#B79CF2',
  corcho: '#B08A5A', corchoOsc: '#8F6E45', pizarra: '#24303A', tiza: '#D9D4CA',
  alfombra: '#2A1C26', alfombraBorde: '#43283A', alfombraOro: '#6E5434',
};

function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c; g.fillRect(x, y, w, h);
}
/** Un bloque con su contorno, como los muebles del fondo. */
function caja(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, relleno: string, borde = T) {
  px(g, x - 1, y - 1, w + 2, h + 2, borde); px(g, x, y, w, h, relleno);
}
/** Un marco de cuadro: listón de madera y el interior. */
function marco(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, interior: string, liston = C.maderaOsc) {
  caja(g, x, y, w, h, liston); px(g, x + 2, y + 2, w - 4, h - 4, interior);
}
/** Un número estable para colocar cosas «al azar» siempre en el mismo sitio. */
function semilla(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
const trabaja = (D: DatosLab, sala: keyof DatosLab['salas']) => D.trabajando && D.salas[sala] === 'ahora';
const activo = (D: DatosLab, ...nombres: string[]) => D.trabajando && nombres.some((n) => D.activos.includes(n));

/* ---------------------------------------------------------------- el plan */
function salaPlan({ g }: Ambiente) {
  // El calendario de pared, junto a la placa: la cuadrícula del mes y una
  // casilla marcada.
  caja(g, 120, 8, 28, 34, C.papel);
  px(g, 120, 8, 28, 7, C.rojo);
  for (let f = 0; f < 4; f++) for (let k = 0; k < 5; k++) px(g, 122 + k * 5, 18 + f * 6, 4, 4, f === 2 && k === 3 ? C.rojo : C.papelOsc);
  // Las flechas de Mateo en la parte libre de la pizarra.
  const nodo = (x: number, y: number, c: string) => { caja(g, x, y, 10, 7, c); };
  nodo(330, 34, '#E8925A'); nodo(370, 62, C.azul); nodo(334, 96, C.verdeSuave); nodo(374, 116, C.lila);
  g.fillStyle = C.lineaOsc;
  const flecha = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i += 2) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
    g.fillRect(x1 - 1, y1 - 1, 3, 3);
  };
  flecha(341, 38, 368, 62); flecha(372, 70, 344, 94); flecha(345, 100, 372, 116);
  // El pósit de Rashid en la esquina del marco.
  caja(g, 156, 112, 10, 10, C.ambar); px(g, 158, 115, 6, 1, C.maderaClara); px(g, 158, 118, 4, 1, C.maderaClara);
}

/* ------------------------------------------------ buscan y leen artículos */
function salaLectura({ g }: Ambiente) {
  // El corcho de los artículos pendientes, a la derecha de la placa.
  marco(g, 670, 8, 86, 40, C.corcho);
  for (let i = 0; i < 6; i++) {
    const x = 675 + i * 13, y = 13 + (i % 2) * 5;
    caja(g, x, y, 10, 13, C.papel);
    px(g, x + 2, y + 3, 6, 1, C.linea); px(g, x + 2, y + 6, 5, 1, C.linea); px(g, x + 2, y + 9, 6, 1, C.linea);
    px(g, x + 4, y - 1, 2, 2, i % 3 === 0 ? C.rojo : i % 3 === 1 ? C.azul : C.verde);
  }
  // El carrito de libros entre la mesa y el pasillo.
  caja(g, 562, 152, 40, 6, C.metalClaro); caja(g, 562, 170, 40, 6, C.metalClaro);
  px(g, 563, 158, 2, 12, C.metal); px(g, 599, 158, 2, 12, C.metal);
  const lomos = ['#4F7FB0', '#B04F4F', '#4FA06A', '#C89A3A', '#7A5AB0', '#3AA0A8'];
  for (let i = 0; i < 6; i++) px(g, 566 + i * 6, 144 + (i % 2), 5, 8 - (i % 2), lomos[i]!);
  for (let i = 0; i < 5; i++) px(g, 567 + i * 7, 163, 6, 7, lomos[(i + 2) % 6]!);
  caja(g, 566, 178, 5, 5, T); caja(g, 593, 178, 5, 5, T);
}

/* ----------------------------------------------------------- la biblioteca */
function biblioteca({ g }: Ambiente) {
  // La escalera de mano, apoyada entre la primera y la segunda estantería.
  px(g, 866, 20, 2, 236, C.maderaClara); px(g, 873, 20, 2, 236, C.maderaClara);
  for (let y = 28; y < 252; y += 12) px(g, 866, y, 9, 2, C.madera);
  px(g, 865, 20, 11, 2, C.maderaOsc);
}

/* -------------------------------------------------- comprueban cada dato */
function salaVerificacion({ g, D }: Ambiente) {
  // El soporte de los sellos: verde, ámbar y rojo.
  caja(g, 282, 304, 44, 6, C.madera);
  [C.verde, C.ambar, C.rojo].forEach((c, i) => {
    const x = 288 + i * 13;
    px(g, x + 2, 310, 2, 6, C.metalClaro); caja(g, x, 316, 6, 5, c); caja(g, x - 1, 322, 8, 4, C.metalOsc);
  });
  // La escalera de certeza GRADE: cuatro peldaños que encogen.
  marco(g, 334, 298, 78, 38, C.papel);
  [[C.verde, 64], [C.azul, 48], [C.ambar, 32], [C.rojo, 18]].forEach(([c, w], i) => px(g, 340, 304 + i * 7, w as number, 4, c as string));
  // El corcho de Ayo: una ficha por cada tanto de afirmaciones sostenidas.
  marco(g, 510, 296, 104, 40, C.corcho);
  const n = Math.round(nivelDePila(D.juez.veredictos?.sostenida ?? 0, 800) * 24);
  for (let i = 0; i < n; i++) {
    const col = i % 9, fila = Math.floor(i / 9), x = 515 + col * 11, y = 301 + fila * 11;
    caja(g, x, y, 8, 7, C.papel); px(g, x + 3, y - 1, 2, 2, [C.rojo, C.azul, C.verde][i % 3]!);
  }
}

/* --------------------------------------------------- proponen ideas nuevas */
function salaIdeas({ g, D, rt, quieto }: Ambiente) {
  // La guirnalda de bombillas bajo la pared: se encienden cuando la sala trabaja.
  const encendida = trabaja(D, 'r3');
  px(g, 640, 340, 418, 1, C.metalOsc);
  for (let i = 0; i < 26; i++) {
    const x = 646 + i * 16, y = 341 + (i % 2);
    const brilla = encendida && (quieto || Math.floor(rt * 2 + i) % 3 !== 0);
    px(g, x + 1, y, 1, 2, C.metalOsc);
    caja(g, x, y + 2, 3, 4, brilla ? [C.ambar, C.lila, C.verdeSuave, C.azul][i % 4]! : C.metal);
  }
  // La pizarra de Hiroshi en su caballete: un engranaje y flechas de otro campo.
  px(g, 652, 392, 2, 48, C.maderaOsc); px(g, 696, 392, 2, 48, C.maderaOsc); px(g, 674, 392, 2, 44, C.maderaOsc);
  marco(g, 646, 350, 58, 44, C.papel, C.madera);
  g.fillStyle = C.lineaOsc;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2, r = a % 2 ? 7 : 9;
    g.fillRect(Math.round(664 + Math.cos(ang) * r), Math.round(372 + Math.sin(ang) * r), 2, 2);
  }
  px(g, 662, 370, 4, 4, '#E8925A');
  px(g, 676, 371, 12, 1, C.lineaOsc); px(g, 686, 369, 2, 5, C.lineaOsc);
  caja(g, 690, 366, 8, 8, C.azul); px(g, 652, 357, 20, 1, C.linea); px(g, 680, 384, 18, 1, C.linea);
  // El puf del rincón.
  caja(g, 1000, 440, 46, 22, '#5B3A6B'); px(g, 1004, 442, 38, 6, '#7A5A8B');
}

/* ------------------------------------------------------ juzgan las ideas */
function salaJuicio({ g, D, rt, quieto }: Ambiente) {
  // Alfombra de tribunal en todo el suelo, con su borde y su filete dorado.
  px(g, 4, 662, 424, 254, C.alfombraBorde);
  px(g, 8, 666, 416, 246, C.alfombra);
  for (let x = 12; x < 420; x += 6) { px(g, x, 669, 3, 1, C.alfombraOro); px(g, x, 908, 3, 1, C.alfombraOro); }
  for (let y = 672; y < 906; y += 6) { px(g, 11, y, 1, 3, C.alfombraOro); px(g, 420, y, 1, 3, C.alfombraOro); }
  // La pared de Rocío: un palito por hipótesis descartada (de cinco en cinco).
  marco(g, 228, 616, 66, 38, C.pizarra, C.madera);
  // La cabecera de tiza: una cruz y una raya; se lee como la pared del Killer
  // aunque todavía no haya ninguna descartada.
  for (let k = 0; k < 5; k++) { px(g, 232 + k, 619 + k, 1, 1, C.tiza); px(g, 236 - k, 619 + k, 1, 1, C.tiza); }
  px(g, 240, 621, 48, 1, C.tiza);
  const palitos = Math.min(32, D.ideas.descartadas);
  for (let i = 0; i < palitos; i++) {
    const grupo = Math.floor(i / 5), dentro = i % 5, gx = 233 + (grupo % 4) * 14, gy = 626 + Math.floor(grupo / 4) * 13;
    if (dentro < 4) px(g, gx + dentro * 3, gy, 1, 10, C.tiza);
    else for (let k = 0; k < 11; k++) px(g, gx - 1 + k, gy + 9 - k, 1, 1, C.tiza);
  }
  if (D.ideas.descartadas > 32) { px(g, 286, 649, 4, 1, C.tiza); px(g, 287, 648, 1, 3, C.tiza); }
  // El cuadro de eliminatorias del torneo: cuatro, dos y la final, que
  // parpadea en oro mientras los jueces comparan.
  marco(g, 300, 616, 72, 38, C.papel);
  const ranura = (x: number, y: number, c = C.papelOsc) => caja(g, x, y, 12, 4, c);
  [622, 630, 638, 646].forEach((y) => ranura(305, y));
  px(g, 318, 624, 4, 1, C.lineaOsc); px(g, 318, 632, 4, 1, C.lineaOsc); px(g, 321, 624, 1, 9, C.lineaOsc);
  px(g, 318, 640, 4, 1, C.lineaOsc); px(g, 318, 648, 4, 1, C.lineaOsc); px(g, 321, 640, 1, 9, C.lineaOsc);
  ranura(324, 626); ranura(324, 642);
  px(g, 337, 628, 4, 1, C.lineaOsc); px(g, 337, 644, 4, 1, C.lineaOsc); px(g, 340, 628, 1, 17, C.lineaOsc);
  const final = activo(D, 'Juez del torneo', 'Juez del torneo B') && !quieto && Math.floor(rt * 2) % 2 === 0;
  ranura(344, 634, final || D.ideas.partidos > 0 ? C.oroClaro : C.papelOsc);
  // El reloj de arena de Inés, en su repisa: la arena cae mientras la sala trabaja.
  px(g, 378, 652, 22, 2, C.madera);
  caja(g, 383, 634, 10, 2, C.maderaOsc); caja(g, 383, 650, 10, 2, C.maderaOsc);
  const t = trabaja(D, 'r4') && !quieto ? (rt % 6) / 6 : 0.5;
  for (let j = 0; j < 6; j++) {
    const w = 8 - j; px(g, 384 + j / 2, 637 + j, w, 1, j / 6 < 1 - t ? C.ambar : '#CFE6FF55');
    px(g, 384 + j / 2, 648 - j, w, 1, j / 6 < t ? C.ambar : '#CFE6FF55');
  }
  // El estrado, a la derecha de la primera fila, con el mazo que golpea
  // cuando el Killer trabaja.
  caja(g, 356, 690, 64, 6, C.maderaClara);
  caja(g, 362, 696, 52, 40, C.madera);
  px(g, 366, 700, 44, 32, C.maderaOsc); px(g, 368, 702, 40, 28, C.madera);
  px(g, 383, 708, 10, 1, C.oro); px(g, 387, 708, 2, 10, C.oro); px(g, 381, 716, 14, 2, C.oro);
  px(g, 381, 710, 1, 4, C.oro); px(g, 394, 710, 1, 4, C.oro);
  const golpe = activo(D, 'Killer') && !quieto && Math.floor(rt * 1.5) % 2 === 0;
  caja(g, 396, 685, 16, 4, C.maderaClara);
  const yM = golpe ? 670 : 676;
  px(g, 382, yM + 4, 16, 2, '#C9A27A');
  caja(g, 398, yM, 14, 9, '#C9A27A'); px(g, 403, yM, 2, 9, C.oro); px(g, 400, yM + 1, 1, 7, '#E3C49A');
  // La trituradora de descartes, al final de la segunda fila.
  caja(g, 374, 826, 40, 26, C.metal);
  px(g, 378, 828, 32, 3, C.metalOsc); px(g, 406, 834, 4, 4, activo(D, 'Killer', 'Auditor de descartes') && !quieto && Math.floor(rt * 3) % 2 ? C.rojo : '#5A3438');
  for (let i = 0; i < 5; i++) px(g, 381 + i * 5, 840 + (i % 2) * 2, 2, 10 - (i % 2) * 3, C.papel);
  caja(g, 372, 852, 44, 4, C.metalOsc);
}

/* -------------------------------------------------- patentes y compañías */
function salaNovedad({ g, rt, quieto, D }: Ambiente) {
  // Dos patentes enmarcadas, con su sello.
  for (const x of [820, 856]) {
    marco(g, x, 616, 30, 36, C.papel, C.oro);
    for (let j = 0; j < 4; j++) px(g, x + 5, 623 + j * 5, 18 - (j % 2) * 5, 1, C.linea);
    caja(g, x + 20, 642, 5, 5, C.rojo);
  }
  // El mapa de Damián, con chinchetas donde hay compañías ensayando.
  marco(g, 902, 614, 152, 42, '#2B5566');
  const tierra = '#4F8A6B';
  px(g, 912, 622, 24, 10, tierra); px(g, 918, 632, 14, 12, tierra); px(g, 950, 620, 22, 12, tierra); px(g, 958, 632, 10, 14, tierra);
  px(g, 980, 620, 44, 14, tierra); px(g, 1006, 634, 12, 8, tierra); px(g, 1028, 640, 16, 8, tierra);
  [[922, 626], [962, 624], [994, 626], [1012, 636], [1036, 643]].forEach(([x, y], i) => caja(g, x!, y!, 2, 2, i % 2 ? C.ambar : C.rojo));
  // El archivador de Sofía, con su candado: nadie más lo toca.
  caja(g, 640, 670, 46, 64, C.metalClaro);
  for (let j = 0; j < 3; j++) { px(g, 643, 674 + j * 20, 40, 16, C.metal); caja(g, 657, 680 + j * 20, 12, 3, C.metalOsc); }
  caja(g, 676, 676, 5, 6, C.oroClaro);
  // El globo terráqueo; gira mientras alguien de la sala trabaja.
  caja(g, 1016, 728, 22, 4, C.maderaOsc); px(g, 1026, 716, 2, 12, C.maderaOsc);
  const giro = activo(D, 'Especialista en patentes', 'Especialista en compañías') && !quieto ? Math.floor(rt * 3) % 8 : 0;
  g.fillStyle = T; for (let a = 0; a < 24; a++) { const ang = (a / 24) * Math.PI * 2; g.fillRect(Math.round(1027 + Math.cos(ang) * 11), Math.round(704 + Math.sin(ang) * 11), 2, 2); }
  for (let y = -9; y <= 9; y++) {
    const w = Math.round(Math.sqrt(81 - y * y));
    px(g, 1027 - w, 704 + y, w * 2, 1, '#2B5566');
    for (let x = -w; x < w; x++) if (((x + giro + 9) % 8 < 3) && Math.abs(y) < 7) px(g, 1027 + x, 704 + y, 1, 1, tierra);
  }
}

/* ------------------------------------------------- las prueban con datos */
function salaAnalisis({ g, D, rt, quieto }: Ambiente) {
  const vivo = activo(D, 'Planificador de análisis', 'Programador y Reparador', 'Intérprete', 'Auditor del análisis');
  // El servidor de la caja sin red, con sus luces.
  caja(g, 456, 800, 42, 98, C.metalOsc);
  // Arriba, la señal: aquí dentro no hay red (un enchufe tachado).
  px(g, 460, 803, 34, 12, '#221E2C');
  px(g, 470, 807, 12, 4, C.metalClaro); px(g, 473, 805, 2, 2, C.metalClaro); px(g, 477, 805, 2, 2, C.metalClaro);
  for (let k = 0; k < 12; k++) px(g, 469 + k, 813 - k, 2, 1, C.rojo);
  for (let j = 0; j < 6; j++) {
    px(g, 460, 818 + j * 13, 34, 10, '#221E2C');
    for (let k = 0; k < 4; k++) {
      const on = vivo ? (quieto ? (j + k) % 2 === 0 : semilla(j * 7 + k + Math.floor(rt * 4)) > 0.4) : k === 0;
      px(g, 463 + k * 4, 822 + j * 13, 2, 2, on ? (k === 3 ? C.ambar : C.verde) : '#2F5E45');
    }
    px(g, 482, 823 + j * 13, 10, 1, C.metal);
  }
  // El plan de análisis congelado, con candado, en su atril.
  px(g, 538, 846, 2, 44, C.maderaOsc); px(g, 520, 888, 38, 2, C.maderaOsc);
  marco(g, 522, 802, 34, 46, C.papel, C.madera);
  for (let j = 0; j < 5; j++) px(g, 527, 810 + j * 5, 22 - (j % 3) * 4, 1, C.linea);
  px(g, 527, 838, 14, 1, C.lineaOsc);
  caja(g, 546, 834, 7, 6, C.oroClaro); px(g, 547, 830, 1, 4, C.oroClaro); px(g, 551, 830, 1, 4, C.oroClaro); px(g, 547, 830, 5, 1, C.oroClaro);
  // La mesa del monitor de Leila: barras y la línea del umbral.
  caja(g, 924, 852, 96, 6, C.maderaClara); px(g, 930, 858, 3, 26, C.maderaOsc); px(g, 1010, 858, 3, 26, C.maderaOsc);
  caja(g, 944, 818, 44, 30, '#0F1A22'); px(g, 964, 848, 4, 4, C.metalOsc);
  [12, 18, 8, 22].forEach((h, i) => px(g, 949 + i * 9, 844 - h, 6, h, i === 2 ? C.ambar : C.verdeSuave));
  for (let x = 947; x < 986; x += 3) px(g, x, 828, 2, 1, C.rojo);
}

/* --------------------------------------------------- revisan el trabajo */
function salaCierre({ g, D, ahora }: Ambiente) {
  // Las puntuaciones de Bruno: barras de cada salida, una en oro.
  marco(g, 326, 936, 86, 40, C.papel);
  for (let i = 0; i < 7; i++) {
    const h = 8 + Math.round(semilla(i + 3) * 22);
    px(g, 332 + i * 11, 970 - h, 7, h, i === 4 ? C.oroClaro : C.lila);
  }
  px(g, 331, 970, 76, 1, C.lineaOsc);
  // El cronómetro de Camila: la aguja marca los segundos reales.
  const cx = 686, cy = 956;
  g.fillStyle = T; for (let a = 0; a < 28; a++) { const ang = (a / 28) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(ang) * 14), Math.round(cy + Math.sin(ang) * 14), 2, 2); }
  for (let y = -12; y <= 12; y++) { const w = Math.round(Math.sqrt(144 - y * y)); px(g, cx - w, cy + y, w * 2, 1, C.papel); }
  caja(g, cx - 2, cy - 19, 4, 3, C.metalClaro);
  for (let k = 0; k < 12; k++) { const ang = (k / 12) * Math.PI * 2; px(g, Math.round(cx + Math.cos(ang) * 10), Math.round(cy + Math.sin(ang) * 10), 1, 1, C.lineaOsc); }
  const ang = ((ahora.getSeconds() + ahora.getMilliseconds() / 1000) / 60) * Math.PI * 2 - Math.PI / 2;
  for (let r = 0; r < 10; r++) px(g, Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), 1, 1, C.rojo);
  px(g, cx - 1, cy - 1, 2, 2, T);
  // El mapa de hipótesis de Emma: un nodo por hipótesis viva, unidos; las
  // descartadas en gris y tachadas.
  marco(g, 730, 934, 320, 44, C.papel, C.madera);
  const vivas = Math.min(14, D.ideas.vivas), muertas = Math.min(6, D.ideas.descartadas);
  const puntos = Array.from({ length: vivas + muertas }, (_, i) => [738 + Math.round(semilla(i + 11) * 300), 942 + Math.round(semilla(i + 47) * 28)] as const);
  g.fillStyle = C.linea;
  for (let i = 1; i < vivas; i++) {
    const [x0, y0] = puntos[i - 1]!, [x1, y1] = puntos[i]!, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= n; s += 3) g.fillRect(Math.round(x0 + ((x1 - x0) * s) / n) + 2, Math.round(y0 + ((y1 - y0) * s) / n) + 2, 1, 1);
  }
  puntos.forEach(([x, y], i) => {
    if (i < vivas) caja(g, x, y, 5, 5, [C.lila, C.azul, C.verdeSuave, '#E8925A'][i % 4]!);
    else { caja(g, x, y, 5, 5, C.papelOsc); px(g, x, y + 2, 5, 1, C.lineaOsc); }
  });
  // En los huecos del suelo: la calculadora de Imani y los borradores de Julia.
  caja(g, 118, 1004, 30, 22, C.maderaClara); px(g, 122, 1026, 2, 8, C.maderaOsc); px(g, 142, 1026, 2, 8, C.maderaOsc);
  caja(g, 124, 994, 16, 12, '#3A3550'); px(g, 126, 996, 12, 3, '#9CC3A0');
  for (let k = 0; k < 6; k++) px(g, 126 + (k % 3) * 4, 1000 + Math.floor(k / 3) * 3, 3, 2, C.papelOsc);
  caja(g, 280, 1010, 18, 20, C.metal); px(g, 282, 1008, 14, 2, C.metalOsc);
  for (let k = 0; k < 3; k++) caja(g, 280 + k * 6, 1004 - (k % 2) * 3, 5, 5, C.papel);
}

/* ----------------------------------------------------------- la recepción */
const MARCA = typeof Image === 'function' ? Object.assign(new Image(), { src: '/arbol-marca.png' }) : null;
function recepcion({ g, ahora, rt, quieto }: Ambiente) {
  // El árbol del Alzheimer Project, enmarcado.
  marco(g, 232, 1142, 44, 42, C.papel, C.oro);
  if (MARCA?.complete && MARCA.naturalWidth) {
    g.save(); g.imageSmoothingEnabled = true; g.drawImage(MARCA, 236, 1146, 36, 34); g.restore();
  }
  // La ventana: el cielo de la hora del ordenador, con nubes de día y
  // estrellas de noche.
  const luz = luzPorHora(ahora.getHours(), ahora.getMinutes());
  const cielo = luz.tramo === 'dia' ? '#7CC7E8' : luz.tramo === 'tarde' ? '#E8925A' : luz.tramo === 'amanecer' ? '#C9A2C8' : '#121A3A';
  marco(g, 806, 1142, 96, 42, cielo, C.metalClaro);
  if (luz.tramo === 'noche') {
    for (let i = 0; i < 14; i++) px(g, 810 + Math.round(semilla(i) * 86), 1146 + Math.round(semilla(i + 30) * 32), 1, 1, i % 4 ? C.papelOsc : C.ambar);
    caja(g, 884, 1150, 7, 7, C.papelOsc); px(g, 888, 1150, 3, 3, cielo);
  } else {
    if (luz.tramo === 'dia') caja(g, 884, 1150, 8, 8, C.ambar);
    const nube = quieto ? 0 : Math.floor(rt * 3) % 100;
    for (const [x0, y] of [[0, 1156], [46, 1168]] as const) {
      const x = 808 + ((x0 + nube) % 92);
      if (x < 896) { px(g, x, y, Math.min(12, 900 - x), 3, C.papel); px(g, x + 3, y - 2, Math.min(6, 897 - x), 2, C.papel); }
    }
  }
  px(g, 852, 1144, 2, 38, C.metalClaro); px(g, 808, 1162, 92, 2, C.metalClaro);
  // El sofá de espera y la fuente de agua.
  caja(g, 440, 1240, 100, 26, '#5B3A6B'); px(g, 444, 1236, 92, 10, '#7A5A8B');
  caja(g, 436, 1236, 8, 30, '#4A2E58'); caja(g, 536, 1236, 8, 30, '#4A2E58');
  px(g, 446, 1266, 3, 6, T); px(g, 531, 1266, 3, 6, T);
  caja(g, 1004, 1222, 20, 40, C.papel); px(g, 1006, 1240, 16, 2, C.papelOsc);
  caja(g, 1006, 1204, 16, 18, '#9CD3F2'); px(g, 1009, 1207, 3, 10, '#CFEAF8');
  caja(g, 1011, 1244, 6, 3, C.azul);
}

/** Lo que va DETRÁS de los personajes: paredes, alfombras y muebles de suelo. */
export function decorarSalas(a: Ambiente) {
  salaPlan(a); salaLectura(a); biblioteca(a); salaVerificacion(a); salaIdeas(a);
  salaJuicio(a); salaNovedad(a); salaAnalisis(a); salaCierre(a); recepcion(a);
}

/** Lo que va ENCIMA de las mesas de primer plano (si no, la mesa lo tapa). */
export function decorarMesas({ g, D }: Ambiente) {
  // El montón de artículos en la mesa de Ingrid: su altura es la cifra de
  // resultados, logarítmica (12 son un folleto; 1.761, una torre).
  const nivel = nivelDePila(D.lectura.resultados);
  if (nivel > 0) {
    const alto = Math.max(2, Math.round(nivel * 20)), x = 500, y = 112 - alto;
    px(g, x - 1, y - 1, 18, alto + 1, T);
    for (let j = 0; j < alto; j++) px(g, x + (j % 3 === 0 ? 1 : 0), y + j, 16, 1, j % 2 ? C.papelOsc : C.papel);
  }
  // Los bolígrafos rojos de Marta: el amarillo es para optimistas.
  caja(g, 74, 456, 8, 8, C.metalClaro);
  px(g, 75, 452, 2, 4, C.rojo); px(g, 78, 451, 2, 5, C.rojo); px(g, 80, 453, 1, 3, C.rojo);
  // Los rotuladores de Priya, ordenados por color.
  [C.rojo, C.ambar, C.verde, C.azul, C.lila].forEach((c, i) => px(g, 900 + i * 3, 417, 2, 4, c));
  // El pato de goma de Mei, junto al monitor de la sala de análisis.
  caja(g, 996, 842, 9, 7, C.oroClaro); caja(g, 1001, 837, 6, 6, C.oroClaro); px(g, 1006, 839, 3, 2, '#E8925A'); px(g, 1003, 838, 1, 1, T);
}
