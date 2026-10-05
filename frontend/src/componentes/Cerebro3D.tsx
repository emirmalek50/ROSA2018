// El cerebro en tres dimensiones de verdad: una malla anatómica con sus
// circunvoluciones, girando con luz, y cada estructura encendida con la
// evidencia que ROSA2018 ha reunido sobre ella.
//
// Por qué no vale el relieve del corte (Emir, 21 de septiembre de 2026:
// "literalmente el cerebro en 3d"): levantar volumen sobre el dibujo sagital
// sigue siendo el dibujo sagital con un bulto detrás. Un cerebro es una
// superficie plegada, con giros y surcos que solo salen de una malla medida en
// un cerebro real. El modelo vive en src/datos/cerebro3d (su procedencia y su
// licencia, en el LICENCIA.md de esa carpeta, y el crédito se enseña en
// pantalla) y lo lee lib/cerebro_malla.ts.
//
// Cómo se pinta, con los conceptos por su nombre:
//
// - WEBGL. El dibujo lo hace la tarjeta gráfica: se le suben una vez los
//   vértices de cada estructura y en cada fotograma solo se le manda la
//   cámara. Por eso mueve cientos de miles de triángulos sin despeinarse,
//   donde el lienzo 2D, que pinta polígono a polígono, se ahogaría.
// - PROGRAMA DE SOMBREADO (shader). Dos programitas que corren en la tarjeta:
//   el de vértices coloca cada punto con las matrices de lib/matriz4.ts, y el
//   de fragmentos decide el color de cada píxel con la luz.
// - LUZ DIFUSA Y LUZ DE BORDE (rim). La difusa da el volumen: cuanto más de
//   cara a la luz está un trozo de superficie, más claro. La de borde ilumina
//   el contorno, que es lo que hace que un tejido parezca húmedo y no yeso.
// - PROFUNDIDAD (z-buffer). La tarjeta guarda a qué distancia quedó cada
//   píxel, así que lo de detrás no tapa lo de delante aunque se pinte después.
// - SELECCIÓN POR COLOR. Para saber qué estructura hay bajo el ratón se pinta
//   una copia en la que cada estructura lleva un color que es su número, se
//   lee el píxel y, EN LA MISMA TAREA, se vuelve a pintar la escena de
//   verdad. El navegador solo presenta lo que queda al final de la tarea, así
//   que la copia de colores no llega a verse (antes se repintaba al fotograma
//   siguiente y Emir veía parpadeos).
// - TRANSPARENCIA AL MIRAR DENTRO. El hipocampo o el tálamo están dentro del
//   cerebro: al señalarlos, todo lo demás se vuelve fantasma y ellos se
//   pintan enteros encima, como en una radiografía.
// - LOS COMPARTIMENTOS DE FUERA. El atlas 2D pone fuera del cerebro la sangre,
//   la retina y el intestino, que también miden la enfermedad. En la escena
//   son cuerpos generados por código (lib/formas3d.ts): el globo ocular
//   delante de los frontales, donde está, y la gota y el tubo debajo, que no
//   tienen sitio anatómico en la cabeza. No son anatomía medida y la leyenda
//   lo dice.
// - LOS NOMBRES. Un lienzo plano encima del de WebGL rotula las estructuras
//   como una lámina anatómica: dos columnas, sin pisarse, cada nombre con su
//   guía hasta la estructura (lib/rotulos3d.ts). Las de dentro solo se
//   nombran con el cerebro abierto.
import { useEffect, useMemo, useRef, useState } from 'react';
import { distanciaParaEncuadrar, multiplicar, normal3, orbita, perspectiva, transformar } from '../lib/matriz4';
import { encuadre, leerMalla, validarIndice, type EstructuraCerebro, type IndiceCerebro, type Malla } from '../lib/cerebro_malla';
import { cajaDe, esfera, gota, tubo, unir, type Forma } from '../lib/formas3d';
import { oclusionPorVertice } from '../lib/cavidad';
import { colocarRotulos, type Ancla } from '../lib/rotulos3d';
import { rellenoRegion, tokenAtlas } from '../lib/atlas_color';
import { NOMBRE_CORTO } from '../lib/atlas_dibujo';
import { intensidad, type Atlas } from '../lib/atlas';
import { useMovimientoReducido } from '../lib/movimiento';
import { Esqueleto } from './Esqueleto';
import { tr, trp, useIdioma } from '../lib/idioma';

/** Los ficheros del modelo, resueltos por Vite a direcciones que el navegador
 *  puede pedir. Si la carpeta todavía no está, los mapas salen vacíos y la
 *  pantalla lo dice en vez de romperse. */
const FICHEROS = import.meta.glob('../datos/cerebro3d/*.bin', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const INDICES = import.meta.glob('../datos/cerebro3d/indice.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** Si el modelo anatómico está instalado en esta copia. La pantalla del atlas
 *  lo pregunta para enseñar el cerebro de verdad en cuanto exista, y el
 *  relieve del corte mientras tanto. */
export function hayModeloCerebro(): boolean {
  const crudo = Object.values(INDICES)[0];
  return Boolean(crudo && validarIndice(crudo));
}

/** Las estructuras que están dentro del cerebro: al mirarlas, lo demás se aparta. */
const PROFUNDAS: ReadonlySet<string> = new Set(['hipocampo', 'amigdala', 'corteza_entorrinal', 'ganglios_basales_talamo', 'sustancia_blanca', 'cuerpo_calloso', 'lcr', 'vascular_bhe', 'cingulo_precuneo']);
/** Las que forman la cáscara: al mirar dentro casi desaparecen. */
const CASCARA: ReadonlySet<string> = new Set(['corteza_prefrontal', 'corteza_sensitivomotora', 'corteza_parietal', 'corteza_temporal', 'corteza_occipital', 'insula', 'neocorteza', 'corteza']);
/** Las que envuelven las estructuras profundas por dentro: la sustancia blanca
 *  y el cuerpo calloso taparían el hipocampo aunque fueran translúcidas. */
const ENVOLTURA: ReadonlySet<string> = new Set(['sustancia_blanca', 'cuerpo_calloso']);
/** Cuánto se ve cada cosa con el cerebro abierto. Diecisiete capas a un
 *  quinto cada una suman una nube: por eso lo que envuelve casi desaparece. */
const opacidadAbierta = (clave: string): number => (CASCARA.has(clave) ? 0.09 : ENVOLTURA.has(clave) ? 0.05 : 0.16);
/** El color del tejido en reposo, antes del tinte de la evidencia. */
/** El color del tejido de cada estructura, en reposo. Tonos naturales pero
 *  distintos por región, como en los atlas anatómicos: con todo el cerebro
 *  del mismo rosa no se sabía cuál era cuál (Emir, 22 sep). */
/** El color del tejido, medido sobre fotografías de cerebro FIJADO en formol
 *  (28 de septiembre de 2026). Los valores de antes eran pasteles de fábrica:
 *  la corteza estaba en L*=83 y la sustancia blanca en L*=93, que es nieve
 *  fresca, no mielina. Ningún tejido pasa de L*=78.
 *
 *  Medidas de referencia (media de dos fotografías de autopsia con licencia
 *  libre y un corte coronal con fondo neutro verificado):
 *    corteza pial      #B8A59B  L*69  a*5,1  b*7,4
 *    cresta de giro    #CDBEB5  L*78
 *    fondo de surco    #7A6564  L*45  a*8,2   (más oscuro Y más rojo)
 *    sustancia blanca  #D8B9A5  L*77,4
 *    cerebelo          #A89690  L*62
 *    tronco            #A99EA1  L*66  b*-0,1  (casi acromático, más frío)
 *    vasos grandes     #5B616E  b*-8,1  (azul grisáceo, no rojo)
 *
 *  El cerebro fijado tiene poco contraste entre gris y blanca (ΔL* de solo 4)
 *  y por eso una lámina de anatomía se ve beige: el original ya lo parece. Se
 *  elige el fijado y no el fresco porque es lo que la gente reconoce como
 *  cerebro, y porque el fresco (L*55, croma 35) competiría con el tinte de
 *  evidencia que se pinta encima.
 *
 *  Las variantes por región se separan alrededor de la corteza base con el
 *  mismo croma bajo, para que la identidad de la región se lea sin que el
 *  tejido deje de ser tejido. */
const TEJIDO: Record<string, [number, number, number]> = {
  corteza: [184, 165, 155],
  corteza_prefrontal: [188, 166, 152],
  corteza_sensitivomotora: [178, 160, 160],
  corteza_parietal: [182, 168, 148],
  corteza_temporal: [176, 162, 146],
  corteza_occipital: [170, 158, 168],
  insula: [186, 156, 146],
  cingulo_precuneo: [186, 166, 140],
  cerebelo: [168, 150, 144],
  tronco_locus_coeruleus: [169, 158, 161],
  sustancia_blanca: [216, 185, 165],
  cuerpo_calloso: [210, 182, 166],
  lcr: [150, 174, 196],
  ganglios_basales_talamo: [203, 168, 147],
  hipocampo: [178, 142, 132],
  amigdala: [172, 136, 132],
  corteza_entorrinal: [180, 150, 140],
  vascular_bhe: [130, 98, 94],
  retina: [214, 206, 198],
  iris: [72, 98, 120],
  pupila: [12, 10, 14],
  nervio: [206, 196, 180],
};

const TEJIDO_POR_DEFECTO: [number, number, number] = [184, 165, 155];
/** Cuánto del tinte de evidencia se deja pasar sobre el tejido en la vista 3D.
 *  En el atlas plano el color ES el dato y puede teñir la región entera; aquí
 *  el color del tejido también significa algo y a plena opacidad desaparecía. */
const TINTE_MAXIMO_3D = 0.34;
const FOV = 0.82;
/** La vista en reposo: de lado, con el lóbulo frontal a la izquierda como en la lámina del 2D. */
const REPOSO = { guinada: -1.75, cabeceo: 0.12 };
/** La distancia que encuadra la escena: el radio de la caja es la media
 *  diagonal, mayor que el cuerpo en cualquier dirección, y con él tal cual el
 *  cerebro salía pequeño. */
const distanciaReposo = (radio: number): number => distanciaParaEncuadrar(radio * 0.74, FOV, 16 / 9, 0.06);
/** El fondo de la escena. Negro puro delata el lienzo: un azul muy oscuro y
 *  desaturado lee como el fondo de un estudio y deja respirar al tejido. */
const FONDO: [number, number, number] = [0.043, 0.047, 0.059];
const TEXTO = '#f4efe4';
const TEXTO_TENUE = 'rgba(244, 239, 228, 0.72)';
const AMBAR = '#f0a030';

/** Los compartimentos de fuera del cerebro, como cuerpos en la escena. Las
 *  medidas van en milímetros, en el sistema del modelo (x a la derecha, y
 *  arriba, z hacia atrás). El ojo mide lo que mide un ojo; la gota y el tubo,
 *  lo que hace falta para verlos y nombrarlos. */
interface Satelite {
  estructura: EstructuraCerebro;
  forma: Forma;
  /** Con qué color de tejido se pinta (clave de TEJIDO). */
  tejido: string;
  /** Si lleva rótulo propio (el iris no: es parte del ojo). */
  rotulo: boolean;
}
function satelites(): Satelite[] {
  // Los ojos, justo debajo del polo frontal y algo por delante, donde están
  // las órbitas. La córnea asoma dos milímetros, como la de verdad, y no
  // como un casquete pegado; la pupila, menos de uno. Y de cada globo sale
  // el nervio óptico hacia el quiasma, bajo el cerebro: sin él, dos esferas
  // sueltas parecen bolas de billar y no ojos.
  const ojos = unir([esfera(11, [-30, -36, -86]), esfera(11, [30, -36, -86])]);
  const iris = unir([esfera(6.5, [-30, -36, -92.5], 12, 24), esfera(6.5, [30, -36, -92.5], 12, 24)]);
  const pupila = unir([esfera(2.8, [-30, -36, -94.9], 10, 20), esfera(2.8, [30, -36, -94.9], 10, 20)]);
  const nervio = (lado: number): [number, number, number][] => {
    const puntos: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      puntos.push([lado * (30 - 26 * t * t), -36 + 6 * t, -76 + 40 * t]);
    }
    return puntos;
  };
  const nervios = unir([tubo(nervio(-1), 1.6, 10), tubo(nervio(1), 1.6, 10)]);
  // La gota delante y abajo, el tubo detrás y abajo: vistos de lado no se tapan.
  const sangre = gota(12, [-36, -112, -76]);
  const curva: [number, number, number][] = [];
  for (let i = 0; i <= 40; i++) curva.push([34, -112 + Math.sin(i / 6.4) * 12, -10 + i * 2.1]);
  const intestino = tubo(curva, 7.5, 18);
  const con = (clave: string, nombre: string, forma: Forma, tejido: string, rotulo: boolean): Satelite => ({
    estructura: { clave, nombre, fichero: '', vertices: forma.posiciones.length / 3, triangulos: forma.indices.length / 3, caja: cajaDe(forma) },
    forma, tejido, rotulo,
  });
  return [
    con('retina', tr('Retina (globo ocular)'), ojos, 'retina', true),
    con('retina', tr('Retina (globo ocular)'), iris, 'iris', false),
    con('retina', tr('Retina (globo ocular)'), pupila, 'pupila', false),
    con('retina', tr('Retina (globo ocular)'), nervios, 'nervio', false),
    con('plasma', tr('Sangre y plasma'), sangre, 'plasma', true),
    con('intestino_microbiota', tr('Intestino y microbiota'), intestino, 'intestino_microbiota', true),
  ];
}

const VERTICES_GLSL = `
attribute vec3 posicion;
attribute vec3 normal;
// Oclusión ambiental calculada al cargar la malla (lib/cavidad.ts). 1 en la
// cresta de una circunvolución, bajo en el fondo de un surco.
attribute float oclusion;
uniform mat4 proyeccion;
uniform mat4 vista;
uniform mat3 normalMat;
varying vec3 vNormal;
varying vec3 vHaciaCamara;
varying vec3 vMundo;
varying float vOclusion;
void main() {
  vNormal = normalize(normalMat * normal);
  vec4 enCamara = vista * vec4(posicion, 1.0);
  vHaciaCamara = -enCamara.xyz;
  vMundo = posicion;
  vOclusion = oclusion;
  gl_Position = proyeccion * enCamara;
}`;

const FRAGMENTOS_GLSL = `
precision highp float;
uniform vec3 color;
uniform float opacidad;
uniform float resalte;
varying vec3 vNormal;
varying vec3 vHaciaCamara;
varying vec3 vMundo;
varying float vOclusion;

// Todo el cálculo de luz va en espacio LINEAL y solo al final se convierte a
// sRGB. Sumar luces directamente sobre colores sRGB (que es lo que hacía
// antes) apaga los medios tonos y deja la imagen lechosa: es el motivo número
// uno de que un render por WebGL parezca de los noventa.
vec3 aLineal(vec3 c) { return pow(c, vec3(2.2)); }
vec3 aPantalla(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

// Khronos PBR Neutral, en vez de la ACES aproximada de Narkowicz.
//
// Medido sobre el albedo de corteza #B8A59B con la misma luz: Narkowicz sube
// la claridad L* de 68 a 78 y baja el croma un 29 %; a exposición 1,6 lo baja
// un 58 % y gira el tono 7 grados hacia el amarillo. AgX conserva la claridad
// pero desatura entre un 39 % y un 55 %. PBR Neutral conserva el tono con
// exactitud (56 grados a 56) y el croma o lo sube un poco.
//
// La razón está en el diseño: se construyó comparando texturas de color base
// PBR contra el render final, no imágenes HDR contra SDR, así que no tiene la
// ganancia de una curva de cine. Cualquier color base por debajo de 231 en
// sRGB se reproduce fielmente. Entra y sale en Rec. 709 lineal.
// github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/pbrNeutral.glsl
vec3 tono(vec3 color) {
  const float inicioCompresion = 0.8 - 0.04;
  const float desaturacion = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float desplazamiento = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= desplazamiento;
  float pico = max(color.r, max(color.g, color.b));
  if (pico < inicioCompresion) return max(color, vec3(0.0));
  float d = 1.0 - inicioCompresion;
  float picoNuevo = 1.0 - d * d / (pico + d - inicioCompresion);
  color *= picoNuevo / pico;
  float g = 1.0 - 1.0 / (desaturacion * (pico - picoNuevo) + 1.0);
  return mix(color, picoNuevo * vec3(1.0), g);
}

// Rebote múltiple de la oclusión, de Jiménez, Wu, Pesce y Jarabo (Activision,
// SIGGRAPH 2016). La luz que entra en un surco rebota varias veces contra un
// albedo que absorbe más verde y azul que rojo, y sale MÁS ROJA. Eso no es
// pigmento: es geometría, y tiene fórmula cerrada.
//
// Importa porque el surco de un cerebro real no es la cresta oscurecida:
// medido en fotografía, es 33 puntos L* más oscuro Y 4,5 puntos de a* más
// rojo. Oscurecer por igual los tres canales deja el surco en a*=2,5 cuando
// lo medido es 8,2. Con esta fórmula la relación rojo/azul del surco sale
// 1,15 y lo medido en la foto es 1,16.
//
// Solo al difuso indirecto: la derivación asume luz de cielo uniforme.
vec3 multirrebote(float ao, vec3 albedo) {
  vec3 a = 2.0404 * albedo - 0.3324;
  vec3 b = -4.7951 * albedo + 0.6417;
  vec3 c = 2.7552 * albedo + 0.6903;
  return max(vec3(ao), ((ao * a + b) * ao + c) * ao);
}

void main() {
  vec3 N = normalize(vNormal);
  // Una malla simplificada trae algún triángulo del revés: se ilumina por la
  // cara que mira a la cámara, en vez de dejar un hueco negro.
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vHaciaCamara);
  vec3 albedo = aLineal(color);

  // La luz clave, arriba a la izquierda y algo por delante; y una de relleno
  // fría por el otro lado, que es lo que hace de "resto de la sala".
  vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
  vec3 Lrelleno = normalize(vec3(0.62, -0.18, 0.35));

  // DISPERSIÓN BAJO LA SUPERFICIE, aproximada: el tejido no es opaco, la luz
  // entra un poco y sale alrededor. Se simula envolviendo el difuso más allá
  // del terminador (wrap lighting) y tiñendo de rojo esa cola, que es el color
  // de la sangre bajo el tejido. Sin esto, la superficie parece cera pintada.
  //
  // La envoltura es corta (0,22) a propósito. Con 0,45 quedaba iluminado casi
  // todo el hemisferio y el terminador desaparecía: sin esa frontera entre luz
  // y sombra el volumen se pierde y la pieza se ve plana y pálida, que es
  // exactamente lo que pasaba (Emir, 28 de septiembre de 2026: "se ve
  // demasiado iluminado, está peor que antes").
  // El suelo del terminador con esta fórmula es envoltura/(1+envoltura). Con
  // 0,45 ese suelo era 0,31, que es justo lo más oscuro que la fotografía
  // permite en el fondo de un surco: el wrap se gastaba solo todo el
  // presupuesto de sombra. Con 0,22 el suelo es 0,18 y queda margen.
  float envoltura = 0.22;
  float difusa = max(0.0, (dot(N, L) + envoltura) / (1.0 + envoltura));
  float cola = max(0.0, (dot(N, L) + 0.75) / 1.75) - difusa;
  // El tinte de la cola, medido: la relación lineal cresta a surco del cerebro
  // fijado. El de antes era de dermis humana y pesaba entre dos y cuatro veces
  // de más (pico de 0,34 de aportación roja).
  vec3 subsuperficie = vec3(1.00, 0.79, 0.87) * max(0.0, cola) * 0.10;

  // OCLUSIÓN AMBIENTAL. Es lo que hace que un cerebro se lea como plegado:
  // los surcos reciben menos luz del ambiente que las crestas. Solo afecta al
  // ambiente y al relleno, nunca a la luz directa, que es como se comporta.
  float ao = clamp(vOclusion, 0.0, 1.0);

  // Ambiente de hemisferio: luz de cielo desde arriba y rebote cálido desde
  // abajo, en vez de una constante plana. Da profundidad hasta donde no llega
  // ninguna luz directa.
  //
  // Los niveles son bajos a propósito. Antes sumaban hasta 1,74 veces el
  // albedo entre ambiente, difusa y relleno, así que casi toda la superficie
  // llegaba saturada al mapeo de tono y salía blanca. Ahora el total se queda
  // por debajo de 1 y el tejido conserva su color.
  // Ajustado por barrido hasta reproducir la estadística de la fotografía de
  // cerebro fijado: claridad mediana L*=68, amplitud de 47 puntos entre los
  // percentiles 5 y 95, croma mediano 10,4, y ningún píxel por encima de
  // radiancia 1 antes del mapeo de tono. Las razones que importan son
  // ambiente/clave = 0,17 y relleno/clave = 0,21; antes el ambiente estaba en
  // 0,34, el doble, y eso es lo que aplanaba la imagen.
  float haciaArriba = N.y * 0.5 + 0.5;
  vec3 cielo = vec3(0.228, 0.252, 0.300);
  vec3 rebote = vec3(0.216, 0.168, 0.149);
  // El rebote múltiple tiñe el surco de rojo solo, sin una sola textura.
  vec3 ambiente = mix(rebote, cielo, haciaArriba) * multirrebote(ao, albedo);

  float relleno = max(0.0, dot(N, Lrelleno)) * 0.30 * mix(0.35, 1.0, ao);

  // FRESNEL: cualquier superficie refleja más de canto que de frente. De él
  // salen tanto el borde encendido como la fuerza del brillo, así que los dos
  // se mueven juntos y no como dos efectos pegados.
  float fresnel = pow(1.0 - max(0.0, dot(N, V)), 5.0);
  // F0 = 0,028 sale del índice de refracción 1,4 del tejido (Donner y Jensen);
  // antes estaba en 0,035, que es de un material más duro.
  float f0 = 0.028;
  float especularFuerza = f0 + (1.0 - f0) * fresnel;

  // Brillo especular en dos lóbulos: uno estrecho, que es el reflejo puntual
  // de la sala, y otro ancho y suave, que es el barniz húmedo del tejido.
  // El brillo NO es uniforme, y esa es la causa número uno de que una
  // superficie orgánica se sienta de plástico. La cresta de un giro está
  // mojada y refleja apretado; el fondo del surco está húmedo pero ocluido y
  // no debe brillar. Se modula con la oclusión, que aquí hace de curvatura.
  vec3 H = normalize(L + V);
  float mojado = smoothstep(0.55, 1.0, ao);
  float estrecho = pow(max(0.0, dot(N, H)), mix(60.0, 220.0, mojado));
  float ancho = pow(max(0.0, dot(N, H)), 18.0);
  // Medido en la craneotomía: solo el 4,1 % de la superficie pasa de L*=88.
  vec3 brillo = (estrecho * mix(0.10, 0.45, mojado) + ancho * 0.06) * especularFuerza * vec3(1.0, 0.98, 0.95);

  // El borde, ahora con Fresnel y apagado dentro de los surcos: un contorno
  // que se enciende también en el fondo de una hendidura delata el truco.
  vec3 borde = fresnel * 0.16 * mix(0.05, 1.0, ao) * (albedo * 0.55 + vec3(0.45));

  // La oclusión también muerde la luz directa, aunque menos: una hendidura
  // estrecha tampoco recibe toda la luz de la ventana.
  // La clave a 1,40, que es lo que el ajuste por barrido reprodujo contra la
  // fotografía. La oclusión muerde poco la directa: por definición es del
  // ambiente, y aplicarla a la luz directa es lo que ensucia un render.
  vec3 luz = albedo * (ambiente + difusa * 1.40 * mix(0.80, 1.0, ao) + relleno) + albedo * subsuperficie + brillo + borde;

  // El resalte del ratón: cálido, más fuerte en el canto, y también atenuado
  // por la oclusión para que no aplane lo que acabamos de dar de relieve.
  luz += resalte * (0.26 + 0.5 * fresnel) * mix(0.5, 1.0, ao) * aLineal(vec3(1.0, 0.84, 0.5));

  gl_FragColor = vec4(aPantalla(tono(luz)), opacidad);
}`;

const PICKING_GLSL = `
precision mediump float;
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

interface Pieza {
  estructura: EstructuraCerebro;
  /** La clave del color de tejido (para los satélites difiere de la clave de región). */
  tejido: string;
  /** Si es un compartimento de fuera (no se vuelve fantasma al abrir el cerebro). */
  exterior: boolean;
  rotulo: boolean;
  posiciones: WebGLBuffer;
  normales: WebGLBuffer;
  /** Oclusión ambiental por vértice (lib/cavidad.ts), o null en los cuerpos
   *  generados por código, que no son superficies plegadas y no la necesitan. */
  oclusion: WebGLBuffer | null;
  indices: WebGLBuffer;
  cuenta: number;
  /** El color con el que se pinta en la pasada de selección. */
  id: [number, number, number];
}

function compilar(gl: WebGLRenderingContext, tipo: number, fuente: string): WebGLShader | null {
  const s = gl.createShader(tipo);
  if (!s) return null;
  gl.shaderSource(s, fuente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}

function programa(gl: WebGLRenderingContext, fragmentos: string): WebGLProgram | null {
  const v = compilar(gl, gl.VERTEX_SHADER, VERTICES_GLSL);
  const f = compilar(gl, gl.FRAGMENT_SHADER, fragmentos);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
  return p;
}

/** El nombre corto con el que se rotula una estructura: el del atlas si lo
 *  tiene, y si no el del modelo en minúscula. */
const nombreCorto = (e: EstructuraCerebro): string => NOMBRE_CORTO[e.clave] ?? tr(e.nombre.charAt(0).toLowerCase() + e.nombre.slice(1));

export interface PropsCerebro3D {
  atlas: Atlas;
  seleccion: string | null;
  seleccionar: (clave: string) => void;
  /** Un modelo distinto del instalado, para las pruebas. */
  modelo?: IndiceCerebro | null;
  /** De dónde salen los bytes de cada malla; por defecto, los ficheros del proyecto. */
  cargar?: (fichero: string) => Promise<ArrayBuffer>;
}

export function Cerebro3D({ atlas, seleccion, seleccionar, modelo, cargar }: PropsCerebro3D) {
  const idioma = useIdioma();
  const canvas = useRef<HTMLCanvasElement>(null);
  const rotulos = useRef<HTMLCanvasElement>(null);
  const reducido = useMovimientoReducido();
  const reducidoRef = useRef(reducido);
  reducidoRef.current = reducido;
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin_modelo' | 'sin_webgl' | 'error'>('cargando');
  const [detalle, setDetalle] = useState('');
  const [foco, setFoco] = useState<string | null>(null);
  const focoRef = useRef<string | null>(null);
  const datos = useRef({ atlas, seleccion, seleccionar });
  datos.current = { atlas, seleccion, seleccionar };
  const redibujar = useRef(() => {});
  const detener = useRef(() => {});
  const detectar = useRef<(x: number, y: number) => string | null>(() => null);
  const camara = useRef({ ...REPOSO, distancia: 320 });
  const radioRef = useRef(100);
  const pendientePick = useRef<{ x: number; y: number } | null>(null);
  const framePick = useRef(0);
  const arrastre = useRef<{ id: number; x: number; y: number; movido: boolean } | null>(null);

  const indice: IndiceCerebro | null = useMemo(() => {
    if (modelo !== undefined) return modelo;
    const crudo = Object.values(INDICES)[0];
    return crudo ? validarIndice(crudo) : null;
  }, [modelo]);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  /** Lo que se puede elegir en el selector: el modelo y los compartimentos de fuera. */
  const seleccionables = useMemo<EstructuraCerebro[]>(() => {
    if (!indice) return [];
    const fuera = satelites().filter((s) => s.rotulo).map((s) => s.estructura);
    return [...indice.estructuras, ...fuera];
  }, [indice, idioma]);

  useEffect(() => {
    if (!indice) { setEstado('sin_modelo'); return; }
    const lienzo = canvas.current;
    const plano = rotulos.current;
    if (!lienzo || !plano) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = (lienzo.getContext('webgl2', { antialias: true, alpha: false }) ?? lienzo.getContext('webgl', { antialias: true, alpha: false })) as WebGLRenderingContext | null;
    } catch { gl = null; }
    if (!gl) { setEstado('sin_webgl'); return; }
    const contexto = gl;
    const esWebgl2 = typeof WebGL2RenderingContext !== 'undefined' && contexto instanceof WebGL2RenderingContext;
    if (!esWebgl2 && !contexto.getExtension('OES_element_index_uint')) { setEstado('sin_webgl'); return; }
    const pintor = programa(contexto, FRAGMENTOS_GLSL);
    const selector = programa(contexto, PICKING_GLSL);
    const tinta = plano.getContext('2d');
    if (!pintor || !selector || !tinta) { setEstado('sin_webgl'); return; }
    const rotulador = tinta;
    let vivo = true;
    let frame = 0;
    let animacion = 0;
    const piezas: Pieza[] = [];
    let centro: [number, number, number] = [0, 0, 0];
    let radio = 100;
    const colores = new Map<string, [number, number, number]>();
    let ultimaVista: Float32Array | null = null;
    let ultimaProy: Float32Array | null = null;

    const subir = (m: { posiciones: Float32Array; normales: Float32Array; indices: Uint32Array }, e: EstructuraCerebro, tejido: string, exterior: boolean, rotulo: boolean) => {
      const pos = contexto.createBuffer();
      const nor = contexto.createBuffer();
      const ind = contexto.createBuffer();
      if (!pos || !nor || !ind) return;
      contexto.bindBuffer(contexto.ARRAY_BUFFER, pos);
      contexto.bufferData(contexto.ARRAY_BUFFER, m.posiciones, contexto.STATIC_DRAW);
      contexto.bindBuffer(contexto.ARRAY_BUFFER, nor);
      contexto.bufferData(contexto.ARRAY_BUFFER, m.normales, contexto.STATIC_DRAW);
      // La oclusión ambiental se calcula una vez, aquí, sobre la malla real:
      // es lo que hace que los surcos se lean como surcos y no como dibujo.
      // Los cuerpos generados por código (el globo ocular, la gota, el tubo)
      // son formas convexas sin pliegues y se dejan a 1.
      let ocl: WebGLBuffer | null = null;
      if (!exterior) {
        const mapa = oclusionPorVertice(m.posiciones, m.normales, m.indices);
        ocl = contexto.createBuffer();
        if (ocl) {
          contexto.bindBuffer(contexto.ARRAY_BUFFER, ocl);
          contexto.bufferData(contexto.ARRAY_BUFFER, mapa, contexto.STATIC_DRAW);
        }
      }
      contexto.bindBuffer(contexto.ELEMENT_ARRAY_BUFFER, ind);
      contexto.bufferData(contexto.ELEMENT_ARRAY_BUFFER, m.indices, contexto.STATIC_DRAW);
      // El identificador va en el color: un número por canal, sin ambigüedad al leer el píxel.
      const n = piezas.length + 1;
      piezas.push({ estructura: e, tejido, exterior, rotulo, posiciones: pos, normales: nor, oclusion: ocl, indices: ind, cuenta: m.indices.length, id: [(n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255] });
    };

    /** El color de cada pieza: su tejido con el tinte de la evidencia de su región. */
    const prepararColores = () => {
      const frio = tokenAtlas('--atlas-frio', '');
      const calido = tokenAtlas('--atlas-calido', '');
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      colores.clear();
      for (const p of piezas) {
        const clave = p.estructura.clave;
        const dato = porClave.get(clave);
        const base = TEJIDO[p.tejido] ?? (CASCARA.has(clave) ? TEJIDO.corteza! : TEJIDO_POR_DEFECTO);
        let [r, g, b] = base;
        // El iris, la pupila y el nervio no se tiñen: la evidencia va en el globo.
        if (dato?.conteo && p.tejido !== 'iris' && p.tejido !== 'pupila' && p.tejido !== 'nervio') {
          const t = intensidad(dato.cohortes.length, datos.current.atlas.cohortesMax);
          const relleno = rellenoRegion(t, { frio, calido });
          const tinte = (relleno.color.match(/\d+/g) ?? []).map(Number);
          if (tinte.length === 3) {
            // El tinte de evidencia se acota en 3D. En el atlas plano puede
            // teñir la región entera porque allí el color ES el dato; aquí
            // compite con el tejido, y a plena opacidad sustituía la corteza
            // por ámbar y el cerebro parecía de mazapán (Emir, 28 de
            // septiembre de 2026). Con un tercio, la región se distingue y
            // sigue leyéndose como tejido.
            const op = Math.max(0, Math.min(1, relleno.opacidad)) * TINTE_MAXIMO_3D;
            r = r * (1 - op) + tinte[0]! * op;
            g = g * (1 - op) + tinte[1]! * op;
            b = b * (1 - op) + tinte[2]! * op;
          }
        }
        if (dato?.discordia.length) { r = r * 0.74 + 209 * 0.26; g = g * 0.74 + 53 * 0.26; b = b * 0.74 + 43 * 0.26; }
        colores.set(`${clave}|${p.tejido}`, [r / 255, g / 255, b / 255]);
      }
    };

    const dibujar = (prog: WebGLProgram, seleccionando: boolean) => {
      const lado = lienzo.width / (lienzo.height || 1);
      const proy = perspectiva(FOV, lado, Math.max(1, radio * 0.05), radio * 12);
      const vista = orbita(camara.current.guinada, camara.current.cabeceo, camara.current.distancia, centro);
      ultimaVista = vista;
      ultimaProy = proy;
      const nm = normal3(vista);
      contexto.useProgram(prog);
      const uProy = contexto.getUniformLocation(prog, 'proyeccion');
      const uVista = contexto.getUniformLocation(prog, 'vista');
      const uNormal = contexto.getUniformLocation(prog, 'normalMat');
      const uColor = contexto.getUniformLocation(prog, 'color');
      const uOpacidad = contexto.getUniformLocation(prog, 'opacidad');
      const uResalte = contexto.getUniformLocation(prog, 'resalte');
      contexto.uniformMatrix4fv(uProy, false, proy);
      contexto.uniformMatrix4fv(uVista, false, vista);
      if (uNormal) contexto.uniformMatrix3fv(uNormal, false, nm);
      const aPos = contexto.getAttribLocation(prog, 'posicion');
      const aNor = contexto.getAttribLocation(prog, 'normal');
      const aOcl = contexto.getAttribLocation(prog, 'oclusion');
      const mirada = focoRef.current ?? datos.current.seleccion;
      const porDentro = mirada !== null && PROFUNDAS.has(mirada);
      // Al mirar una estructura de dentro, todo lo del cerebro se vuelve
      // fantasma y ella queda entera. Primero lo opaco; después lo translúcido
      // de lejos a cerca, que es como se compone bien; la mirada, la última y
      // sin test de profundidad, como en una radiografía.
      const profundidadDe = (p: Pieza): number => {
        const c = p.estructura.caja;
        return transformar(vista, [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2]).z;
      };
      const esTranslucida = (p: Pieza): boolean => porDentro && !seleccionando && !p.exterior && p.estructura.clave !== mirada;
      const esMirada = (p: Pieza): boolean => porDentro && !seleccionando && p.estructura.clave === mirada;
      const orden = [...piezas].sort((a, b) => {
        const ma = Number(esMirada(a));
        const mb = Number(esMirada(b));
        if (ma !== mb) return ma - mb;
        const ta = Number(esTranslucida(a));
        const tb = Number(esTranslucida(b));
        if (ta !== tb) return ta - tb;
        return ta ? profundidadDe(a) - profundidadDe(b) : 0;
      });
      for (const p of orden) {
        const translucida = esTranslucida(p);
        if (esMirada(p)) contexto.disable(contexto.DEPTH_TEST);
        // En la pasada de selección, con el cerebro abierto, la cáscara no
        // estorba: así se puede pasar de una estructura de dentro a otra.
        if (seleccionando && porDentro && CASCARA.has(p.estructura.clave)) continue;
        contexto.bindBuffer(contexto.ARRAY_BUFFER, p.posiciones);
        contexto.enableVertexAttribArray(aPos);
        contexto.vertexAttribPointer(aPos, 3, contexto.FLOAT, false, 0, 0);
        if (aNor >= 0) {
          contexto.bindBuffer(contexto.ARRAY_BUFFER, p.normales);
          contexto.enableVertexAttribArray(aNor);
          contexto.vertexAttribPointer(aNor, 3, contexto.FLOAT, false, 0, 0);
        }
        if (aOcl >= 0) {
          if (p.oclusion) {
            contexto.bindBuffer(contexto.ARRAY_BUFFER, p.oclusion);
            contexto.enableVertexAttribArray(aOcl);
            contexto.vertexAttribPointer(aOcl, 1, contexto.FLOAT, false, 0, 0);
          } else {
            // Sin mapa (los cuerpos generados por código): expuesto del todo.
            contexto.disableVertexAttribArray(aOcl);
            contexto.vertexAttrib1f(aOcl, 1);
          }
        }
        contexto.bindBuffer(contexto.ELEMENT_ARRAY_BUFFER, p.indices);
        if (seleccionando) {
          contexto.uniform3fv(uColor, p.id);
        } else {
          const c = colores.get(`${p.estructura.clave}|${p.tejido}`) ?? [0.8, 0.7, 0.7];
          contexto.uniform3fv(uColor, c);
          contexto.uniform1f(uOpacidad, translucida ? opacidadAbierta(p.estructura.clave) : 1);
          contexto.uniform1f(uResalte, p.estructura.clave === mirada && p.tejido !== 'iris' && p.tejido !== 'pupila' && p.tejido !== 'nervio' ? 1 : 0);
          contexto.depthMask(!translucida);
        }
        contexto.drawElements(contexto.TRIANGLES, p.cuenta, contexto.UNSIGNED_INT, 0);
      }
      contexto.depthMask(true);
      contexto.enable(contexto.DEPTH_TEST);
    };

    /** Los nombres junto a las estructuras, en el lienzo plano de encima. */
    const rotular = (anchoCss: number, altoCss: number, dpr: number) => {
      const w = Math.round(anchoCss * dpr), h = Math.round(altoCss * dpr);
      if (plano.width !== w || plano.height !== h) { plano.width = w; plano.height = h; }
      rotulador.setTransform(dpr, 0, 0, dpr, 0, 0);
      rotulador.clearRect(0, 0, anchoCss, altoCss);
      if (!ultimaVista || !ultimaProy || !piezas.length) return;
      const mvp = multiplicar(ultimaProy, ultimaVista);
      const mirada = focoRef.current ?? datos.current.seleccion;
      const porDentro = mirada !== null && PROFUNDAS.has(mirada);
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      const fuente = (fuerte: boolean) => `${fuerte ? 600 : 500} 13px -apple-system, "Inter", "Segoe UI", sans-serif`;
      const anclas: Ancla[] = [];
      const vistas = new Set<string>();
      for (const p of piezas) {
        if (!p.rotulo || vistas.has(p.estructura.clave)) continue;
        vistas.add(p.estructura.clave);
        const clave = p.estructura.clave;
        // Las de dentro solo se nombran con el cerebro abierto o si son la mirada.
        if (PROFUNDAS.has(clave) && !porDentro && clave !== mirada) continue;
        // Diez nombres encima del cerebro tapaban los giros y no decían nada:
        // se nombra lo que tiene evidencia y lo que se señala; el resto está en
        // los chips de debajo y sale al pasar el ratón.
        const registros = porClave.get(clave)?.conteo ?? 0;
        if (!registros && clave !== mirada && !porDentro) continue;
        const c = p.estructura.caja;
        const q = transformar(mvp, [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2]);
        if (q.w <= 0) continue;
        const x = ((q.x + 1) / 2) * anchoCss;
        const y = ((1 - q.y) / 2) * altoCss;
        if (x < -40 || x > anchoCss + 40 || y < -40 || y > altoCss + 40) continue;
        const conteo = porClave.get(clave)?.conteo ?? 0;
        const texto = `${nombreCorto(p.estructura)}${conteo ? ` · ${conteo}` : ''}`;
        rotulador.font = fuente(conteo > 0 || clave === mirada);
        anclas.push({ clave, texto, x, y, ancho: rotulador.measureText(texto).width + 12, alto: 20, prioridad: clave === mirada ? 1000 : conteo + 1 });
      }
      // El centro del cerebro en pantalla: de él huyen los rótulos.
      const qc = transformar(mvp, centro);
      const centroX = ((qc.x + 1) / 2) * anchoCss;
      const centroY = ((1 - qc.y) / 2) * altoCss;
      // La franja de abajo es de los botones: los rótulos no entran ahí.
      const colocados = colocarRotulos(anclas, { ancho: anchoCss, alto: altoCss - 58, centroX, centroY, separacion: 16, paso: 9, intentos: 12, holgura: 3 });
      const fondo = `rgb(${Math.round(FONDO[0] * 255)}, ${Math.round(FONDO[1] * 255)}, ${Math.round(FONDO[2] * 255)})`;
      rotulador.textBaseline = 'middle';
      rotulador.textAlign = 'left';
      rotulador.lineJoin = 'round';
      for (const r of colocados) {
        const esMirada = r.clave === mirada;
        const conDatos = r.prioridad > 1;
        // La guía corta, del ancla al borde de la caja, con su punto en el ancla.
        rotulador.strokeStyle = esMirada ? AMBAR : 'rgba(244, 239, 228, 0.55)';
        rotulador.lineWidth = 1.2;
        rotulador.beginPath();
        rotulador.moveTo(r.x, r.y);
        rotulador.lineTo(r.gx, r.gy);
        rotulador.stroke();
        rotulador.beginPath();
        rotulador.arc(r.x, r.y, 2.6, 0, Math.PI * 2);
        rotulador.fillStyle = esMirada ? AMBAR : 'rgba(244, 239, 228, 0.9)';
        rotulador.fill();
        // El texto con halo del color del fondo, para que se lea sobre el tejido.
        rotulador.font = fuente(conDatos || esMirada);
        const tx = r.cx + 6;
        const ty = r.cy + r.alto / 2;
        rotulador.strokeStyle = fondo;
        rotulador.lineWidth = 4;
        rotulador.strokeText(r.texto, tx, ty);
        rotulador.fillStyle = esMirada ? AMBAR : conDatos ? TEXTO : TEXTO_TENUE;
        rotulador.fillText(r.texto, tx, ty);
      }
    };

    const pintarEscena = () => {
      frame = 0;
      const rect = lienzo.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      contexto.viewport(0, 0, w, h);
      contexto.clearColor(FONDO[0], FONDO[1], FONDO[2], 1);
      contexto.enable(contexto.DEPTH_TEST);
      contexto.enable(contexto.BLEND);
      contexto.blendFunc(contexto.SRC_ALPHA, contexto.ONE_MINUS_SRC_ALPHA);
      contexto.disable(contexto.CULL_FACE);
      contexto.clear(contexto.COLOR_BUFFER_BIT | contexto.DEPTH_BUFFER_BIT);
      dibujar(pintor, false);
      rotular(rect.width, rect.height, dpr);
    };
    const pedir = () => { if (!frame) frame = requestAnimationFrame(pintarEscena); };
    redibujar.current = () => { prepararColores(); pedir(); };
    detener.current = () => { if (animacion) { cancelAnimationFrame(animacion); animacion = 0; } };

    // La selección por color y, en la misma tarea, la escena de verdad otra
    // vez: el navegador solo presenta lo que queda al final, así que la copia
    // de colores no llega a verse.
    detectar.current = (x, y) => {
      if (!piezas.length) return null;
      const rect = lienzo.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      contexto.viewport(0, 0, lienzo.width, lienzo.height);
      contexto.clearColor(0, 0, 0, 1);
      contexto.disable(contexto.BLEND);
      contexto.enable(contexto.DEPTH_TEST);
      contexto.clear(contexto.COLOR_BUFFER_BIT | contexto.DEPTH_BUFFER_BIT);
      dibujar(selector, true);
      const pixel = new Uint8Array(4);
      contexto.readPixels(Math.max(0, Math.min(lienzo.width - 1, Math.round(x * dpr))), Math.max(0, Math.min(lienzo.height - 1, Math.round((rect.height - y) * dpr))), 1, 1, contexto.RGBA, contexto.UNSIGNED_BYTE, pixel);
      pintarEscena();
      const n = pixel[0]! + (pixel[1]! << 8) + (pixel[2]! << 16);
      return n > 0 && n <= piezas.length ? piezas[n - 1]!.estructura.clave : null;
    };

    // La carga del modelo: todas las estructuras, y después la escena entera
    // de una vez (pieza a pieza parecía un parpadeo).
    (async () => {
      try {
        const fuera = satelites();
        const encaje = encuadre([...indice.estructuras, ...fuera.map((s) => s.estructura)]);
        centro = encaje.centro;
        radio = encaje.radio;
        radioRef.current = radio;
        camara.current = { ...camara.current, distancia: distanciaReposo(radio) };
        const mallas: { malla: Malla; estructura: EstructuraCerebro }[] = [];
        for (const e of indice.estructuras) {
          let bytes: ArrayBuffer;
          if (cargarRef.current) {
            bytes = await cargarRef.current(e.fichero);
          } else {
            const ruta = Object.keys(FICHEROS).find((k) => k.endsWith(`/${e.fichero}`));
            if (!ruta) continue;
            const respuesta = await fetch(FICHEROS[ruta]!);
            if (!respuesta.ok) throw new Error(trp('No se pudo leer {fichero}: el servidor respondió {estado}.', { fichero: e.fichero, estado: respuesta.status }));
            bytes = await respuesta.arrayBuffer();
          }
          mallas.push({ malla: leerMalla(bytes), estructura: e });
          if (!vivo) return;
        }
        if (!vivo) return;
        for (const { malla, estructura } of mallas) subir(malla, estructura, estructura.clave, false, true);
        for (const s of fuera) subir(s.forma, s.estructura, s.tejido, true, s.rotulo);
        if (!piezas.length) { setEstado('sin_modelo'); return; }
        prepararColores();
        setEstado('listo');
        // La entrada: gira un poco hasta la vista en reposo, para que se vea
        // de entrada que es un cuerpo y no una foto.
        if (!reducidoRef.current) {
          const desde = { guinada: REPOSO.guinada + 0.55, cabeceo: 0.02, distancia: camara.current.distancia * 1.12 };
          const hasta = { ...camara.current };
          camara.current = { ...desde };
          let t0 = 0;
          const paso = (ahora: number) => {
            if (!t0) t0 = ahora;
            const k = Math.min(1, (ahora - t0) / 900);
            const s = 1 - (1 - k) ** 3;
            camara.current = {
              guinada: desde.guinada + (hasta.guinada - desde.guinada) * s,
              cabeceo: desde.cabeceo + (hasta.cabeceo - desde.cabeceo) * s,
              distancia: desde.distancia + (hasta.distancia - desde.distancia) * s,
            };
            pintarEscena();
            animacion = k < 1 ? requestAnimationFrame(paso) : 0;
          };
          animacion = requestAnimationFrame(paso);
        } else {
          pedir();
        }
      } catch (e) {
        if (!vivo) return;
        setDetalle(e instanceof Error ? e.message : String(e));
        setEstado('error');
      }
    })();

    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      detener.current();
      const d = camara.current.distancia * Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015);
      camara.current = { ...camara.current, distancia: Math.max(radio * 1.05, Math.min(radio * 8, d)) };
      pedir();
    };
    lienzo.addEventListener('wheel', rueda, { passive: false });
    const observador = new ResizeObserver(pedir);
    observador.observe(lienzo);
    return () => {
      vivo = false;
      cancelAnimationFrame(frame); detener.current(); observador.disconnect(); lienzo.removeEventListener('wheel', rueda);
      for (const p of piezas) { contexto.deleteBuffer(p.posiciones); contexto.deleteBuffer(p.normales); contexto.deleteBuffer(p.indices); }
      redibujar.current = () => {}; detener.current = () => {}; detectar.current = () => null;
    };
  }, [indice]);

  useEffect(() => { redibujar.current(); }, [atlas, seleccion, foco, idioma]);
  useEffect(() => () => { if (framePick.current) cancelAnimationFrame(framePick.current); }, []);

  const cambiarFoco = (clave: string | null) => {
    if (focoRef.current !== clave) { focoRef.current = clave; setFoco(clave); }
  };
  const girar = (dg: number, dc: number) => {
    detener.current();
    camara.current = { ...camara.current, guinada: camara.current.guinada + dg, cabeceo: Math.max(-1.35, Math.min(1.35, camara.current.cabeceo + dc)) };
    redibujar.current();
  };
  const apuntada = atlas.regiones.find((r) => r.clave === (foco ?? seleccion));
  const nombreOriginal = seleccionables.find((e) => e.clave === (foco ?? seleccion))?.nombre;
  const nombre = nombreOriginal ? tr(nombreOriginal) : undefined;
  // Sin WebGL, sin modelo o con un fallo de carga, la caja del lienzo se queda
  // con sus medidas y el aviso dentro: la maqueta no salta y la silueta de
  // espera sigue midiendo lo que el contenido (regla de los esqueletos).
  const respaldo = estado === 'sin_modelo' || estado === 'sin_webgl' || estado === 'error';
  const aviso = estado === 'sin_webgl' ? tr('Este navegador no puede dibujar el cerebro en tres dimensiones. Puedes consultar toda la evidencia en «Vista 2D».')
    : estado === 'sin_modelo' ? tr('El modelo anatómico del cerebro todavía no está instalado en esta copia. La evidencia está entera en «Vista 2D».')
    : trp("No se pudo cargar el modelo del cerebro. {detalle}", { detalle });
  const credito = indice?.atribucion ? `${tr(indice.atribucion).replace(/\.\s*$/, '')}. ` : '';
  const porClave = new Map(atlas.regiones.map((r) => [r.clave, r]));
  /** El color de tejido de cada chip, el mismo que en la escena. */
  const colorChip = (clave: string): string => {
    const t = TEJIDO[clave] ?? (CASCARA.has(clave) ? TEJIDO.corteza! : TEJIDO_POR_DEFECTO);
    return `rgb(${t[0]}, ${t[1]}, ${t[2]})`;
  };

  return (
    <section className="atlas-3d" aria-label={tr("Cerebro en tres dimensiones")}>
      <div className="atlas-lienzo atlas-3d-lienzo">
        <div className="atlas-3d-herramientas">
          <button type="button" className="btn btn-s" onClick={() => { detener.current(); camara.current = { ...REPOSO, distancia: distanciaReposo(radioRef.current) }; redibujar.current(); }}>{tr("Restablecer vista")}</button>
          <button type="button" className="btn btn-s" aria-label={tr("Girar a la izquierda")} onClick={() => girar(-0.25, 0)}>◄</button>
          <button type="button" className="btn btn-s" aria-label={tr("Girar a la derecha")} onClick={() => girar(0.25, 0)}>►</button>
          <label>{tr("Estructura")} <select aria-label={tr("Seleccionar estructura del cerebro")} value={seleccion ?? ''} onChange={(e) => { if (e.target.value) seleccionar(e.target.value); }}>
            <option value="">{tr("Explorar estructuras")}</option>
            {seleccionables.map((e) => <option key={e.clave} value={e.clave}>{tr(e.nombre)}</option>)}
          </select></label>
        </div>
        {estado === 'cargando' && <div className="atlas-3d-cargando"><Esqueleto alto={280} /><span className="sr-only">{tr("Cargando el modelo del cerebro")}</span></div>}
        {respaldo ? <p role="status" className="atlas-3d-sin-lienzo">{aviso}</p> : <>
          <canvas
            ref={canvas} className="atlas-3d-canvas" tabIndex={0} role="img"
            aria-label={tr("Cerebro en tres dimensiones: arrastra o usa las flechas para girarlo, la rueda para acercarlo y el selector Estructura para consultar la evidencia de cada una.")}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) return;
              e.preventDefault();
              if (e.key === 'ArrowLeft') girar(-0.12, 0);
              else if (e.key === 'ArrowRight') girar(0.12, 0);
              else if (e.key === 'ArrowUp') girar(0, -0.12);
              else if (e.key === 'ArrowDown') girar(0, 0.12);
              else { detener.current(); camara.current = { ...camara.current, distancia: camara.current.distancia * (e.key === '-' ? 1.15 : e.key === 'Home' ? 1 : 0.87) }; redibujar.current(); }
            }}
            onPointerDown={(e) => { if (e.button !== 0 || arrastre.current) return; detener.current(); arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY, movido: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              const a = arrastre.current;
              if (a && a.id === e.pointerId) {
                const dx = e.clientX - a.x, dy = e.clientY - a.y;
                if (!a.movido && Math.hypot(dx, dy) < 4) return;
                a.movido = true; a.x = e.clientX; a.y = e.clientY;
                girar(dx * 0.008, -dy * 0.008);
              } else if (!a) {
                // Una lectura de selección por fotograma, no por cada movimiento del ratón.
                const rect = e.currentTarget.getBoundingClientRect();
                pendientePick.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                if (!framePick.current) {
                  framePick.current = requestAnimationFrame(() => {
                    framePick.current = 0;
                    const q = pendientePick.current;
                    if (q) cambiarFoco(detectar.current(q.x, q.y));
                  });
                }
              }
            }}
            onPointerUp={(e) => {
              const a = arrastre.current;
              if (!a || a.id !== e.pointerId) return;
              if (!a.movido) {
                const rect = e.currentTarget.getBoundingClientRect();
                const clave = detectar.current(e.clientX - rect.left, e.clientY - rect.top);
                if (clave) datos.current.seleccionar(clave);
              }
              arrastre.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => { arrastre.current = null; cambiarFoco(null); }}
            onLostPointerCapture={() => { arrastre.current = null; }}
            onPointerLeave={() => cambiarFoco(null)}
          />
          <canvas ref={rotulos} className="atlas-3d-rotulos" aria-hidden="true" />
        </>}
      </div>
      {!respaldo && (
        <ul className="atlas-3d-leyenda" aria-label={tr("Estructuras del cerebro: pasa el ratón para verlas y pulsa para abrir su evidencia")}>
          {seleccionables.map((e) => {
            const dato = porClave.get(e.clave);
            const activo = e.clave === (foco ?? seleccion);
            return (
              <li key={e.clave}>
                <button type="button" className={`atlas-3d-chip${activo ? ' activo' : ''}${dato?.conteo ? ' con-datos' : ''}`} style={{ ['--tejido' as string]: colorChip(e.clave) }}
                  onMouseEnter={() => cambiarFoco(e.clave)} onMouseLeave={() => cambiarFoco(null)} onFocus={() => cambiarFoco(e.clave)} onBlur={() => cambiarFoco(null)} onClick={() => seleccionar(e.clave)}>
                  <span className="atlas-3d-chip-color" aria-hidden="true" />{nombreCorto(e)}{dato?.conteo ? <span className="atlas-cifra">{dato.conteo}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="meta">{trp("{credito}Las estructuras se encienden con la evidencia reunida: el color va por cohortes. El ojo, la gota de sangre y el intestino son cuerpos esquemáticos, no anatomía medida. Arrastra para girar el cerebro y pulsa una estructura para leer lo que hay sobre ella.", { credito })}</p>
      <p className="atlas-3d-lectura" aria-live="polite">{apuntada ? (apuntada.discordia.length ? trp("{v}: {conteo} registros · {cohortes} cohortes nombradas por sus hipótesis · Discordia entre hechos", { v: nombre ?? apuntada.etiqueta, conteo: apuntada.conteo, cohortes: apuntada.cohortes.length }) : trp("{v}: {conteo} registros · {cohortes} cohortes nombradas por sus hipótesis", { v: nombre ?? apuntada.etiqueta, conteo: apuntada.conteo, cohortes: apuntada.cohortes.length })) : tr('Señala una estructura para ver sus cifras y abrir su ficha.')}</p>
    </section>
  );
}
