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
//   una copia invisible en la que cada estructura lleva un color que es su
//   número, y se lee el píxel. Es exacto y no cuesta geometría aparte.
// - TRANSPARENCIA AL MIRAR DENTRO. El hipocampo o el tálamo están dentro del
//   cerebro: al señalarlos, la corteza se vuelve translúcida para dejarlos
//   ver, en vez de esconder la evidencia.
import { useEffect, useMemo, useRef, useState } from 'react';
import { distanciaParaEncuadrar, normal3, orbita, perspectiva, transformar } from '../lib/matriz4';
import { encuadre, leerMalla, validarIndice, type EstructuraCerebro, type IndiceCerebro, type Malla } from '../lib/cerebro_malla';
import { rellenoRegion, tokenAtlas } from '../lib/atlas_color';
import { intensidad, type Atlas } from '../lib/atlas';
import { useMovimientoReducido } from '../lib/movimiento';
import { Esqueleto } from './Esqueleto';

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

/** Las estructuras que están dentro del cerebro: al mirarlas, la corteza se aparta. */
const PROFUNDAS: ReadonlySet<string> = new Set(['hipocampo', 'amigdala', 'corteza_entorrinal', 'ganglios_basales_talamo', 'sustancia_blanca', 'lcr', 'vascular_bhe', 'cingulo_precuneo']);
/** Las que forman la cáscara: al mirar dentro casi desaparecen. */
const CASCARA: ReadonlySet<string> = new Set(['corteza_prefrontal', 'corteza_sensitivomotora', 'corteza_parietal', 'corteza_temporal', 'corteza_occipital', 'insula', 'neocorteza', 'corteza']);
/** Las que envuelven las estructuras profundas por dentro: la sustancia blanca
 *  y el cuerpo calloso taparían el hipocampo aunque fueran translúcidas. */
const ENVOLTURA: ReadonlySet<string> = new Set(['sustancia_blanca', 'cuerpo_calloso']);
/** Cuánto se ve cada cosa con el cerebro abierto. Diecisiete capas a un
 *  quinto cada una suman una nube: por eso lo que envuelve casi desaparece. */
const opacidadAbierta = (clave: string): number => (CASCARA.has(clave) ? 0.09 : ENVOLTURA.has(clave) ? 0.05 : 0.16);
/** El color del tejido en reposo, antes del tinte de la evidencia. */
const TEJIDO: Record<string, [number, number, number]> = {
  corteza: [233, 199, 192],
  cerebelo: [226, 198, 176],
  tronco_locus_coeruleus: [231, 218, 188],
  sustancia_blanca: [238, 232, 224],
  lcr: [198, 218, 232],
  ganglios_basales_talamo: [206, 175, 176],
  hipocampo: [212, 176, 170],
  amigdala: [208, 170, 168],
  vascular_bhe: [198, 120, 112],
};
const TEJIDO_POR_DEFECTO: [number, number, number] = [226, 196, 190];
const FOV = 0.82;
/** La vista en reposo: de lado y algo desde delante, como se enseña un cerebro. */
const REPOSO = { guinada: -1.75, cabeceo: 0.12 };
/** La distancia que encuadra el cerebro: el radio de la caja es la media
 *  diagonal, mayor que el cuerpo en cualquier dirección, y con él tal cual el
 *  cerebro salía pequeño. */
const distanciaReposo = (radio: number): number => distanciaParaEncuadrar(radio * 0.74, FOV, 16 / 9, 0.06);

const VERTICES_GLSL = `
attribute vec3 posicion;
attribute vec3 normal;
uniform mat4 proyeccion;
uniform mat4 vista;
uniform mat3 normalMat;
varying vec3 vNormal;
varying vec3 vHaciaCamara;
void main() {
  vNormal = normalize(normalMat * normal);
  vec4 enCamara = vista * vec4(posicion, 1.0);
  vHaciaCamara = -enCamara.xyz;
  gl_Position = proyeccion * enCamara;
}`;

const FRAGMENTOS_GLSL = `
precision mediump float;
uniform vec3 color;
uniform float opacidad;
uniform float resalte;
varying vec3 vNormal;
varying vec3 vHaciaCamara;
void main() {
  vec3 N = normalize(vNormal);
  // Una malla simplificada trae algún triángulo del revés: se ilumina por la
  // cara que mira a la cámara, en vez de dejar un hueco negro.
  if (!gl_FrontFacing) N = -N;
  vec3 haciaCamara = normalize(vHaciaCamara);
  // La luz principal, arriba a la izquierda y algo por delante, y un relleno
  // suave por el otro lado para que la sombra no se cierre en negro.
  vec3 luz = normalize(vec3(-0.45, 0.62, 0.65));
  vec3 relleno = normalize(vec3(0.5, -0.3, 0.4));
  float difusa = max(0.0, dot(N, luz));
  float suave = max(0.0, dot(N, relleno)) * 0.28;
  // Luz de borde: enciende el contorno, donde la superficie se va de canto.
  float borde = pow(1.0 - max(0.0, dot(N, haciaCamara)), 2.6);
  // Brillo especular corto: el tejido fresco no es mate del todo.
  vec3 media = normalize(luz + haciaCamara);
  float brillo = pow(max(0.0, dot(N, media)), 28.0) * 0.16;
  vec3 base = color * (0.34 + 0.72 * difusa + suave);
  vec3 final = base + borde * 0.22 * (color * 0.5 + vec3(0.5)) + brillo;
  final += resalte * (0.22 + 0.55 * borde) * vec3(1.0, 0.82, 0.45);
  gl_FragColor = vec4(final, opacidad);
}`;

const PICKING_GLSL = `
precision mediump float;
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

interface Pieza {
  estructura: EstructuraCerebro;
  posiciones: WebGLBuffer;
  normales: WebGLBuffer;
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
  const canvas = useRef<HTMLCanvasElement>(null);
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

  useEffect(() => {
    if (!indice) { setEstado('sin_modelo'); return; }
    const lienzo = canvas.current;
    if (!lienzo) return;
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
    if (!pintor || !selector) { setEstado('sin_webgl'); return; }
    let vivo = true;
    let frame = 0;
    let animacion = 0;
    const piezas: Pieza[] = [];
    let centro: [number, number, number] = [0, 0, 0];
    let radio = 100;
    const colores = new Map<string, [number, number, number]>();

    const subir = (m: Malla, e: EstructuraCerebro, orden: number) => {
      const pos = contexto.createBuffer();
      const nor = contexto.createBuffer();
      const ind = contexto.createBuffer();
      if (!pos || !nor || !ind) return;
      contexto.bindBuffer(contexto.ARRAY_BUFFER, pos);
      contexto.bufferData(contexto.ARRAY_BUFFER, m.posiciones, contexto.STATIC_DRAW);
      contexto.bindBuffer(contexto.ARRAY_BUFFER, nor);
      contexto.bufferData(contexto.ARRAY_BUFFER, m.normales, contexto.STATIC_DRAW);
      contexto.bindBuffer(contexto.ELEMENT_ARRAY_BUFFER, ind);
      contexto.bufferData(contexto.ELEMENT_ARRAY_BUFFER, m.indices, contexto.STATIC_DRAW);
      // El identificador va en el color: un número por canal, sin ambigüedad al leer el píxel.
      const n = orden + 1;
      piezas.push({ estructura: e, posiciones: pos, normales: nor, indices: ind, cuenta: m.indices.length, id: [(n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255] });
    };

    /** El color de cada estructura: su tejido con el tinte de la evidencia. */
    const prepararColores = () => {
      const frio = tokenAtlas('--atlas-frio', '');
      const calido = tokenAtlas('--atlas-calido', '');
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      colores.clear();
      for (const p of piezas) {
        const clave = p.estructura.clave;
        const dato = porClave.get(clave);
        const base = TEJIDO[clave] ?? (CASCARA.has(clave) ? TEJIDO.corteza! : TEJIDO_POR_DEFECTO);
        let [r, g, b] = base;
        if (dato?.conteo) {
          const t = intensidad(dato.cohortes.length, datos.current.atlas.cohortesMax);
          const relleno = rellenoRegion(t, { frio, calido });
          const tinte = (relleno.color.match(/\d+/g) ?? []).map(Number);
          if (tinte.length === 3) {
            const op = Math.max(0, Math.min(1, relleno.opacidad));
            r = r * (1 - op) + tinte[0]! * op;
            g = g * (1 - op) + tinte[1]! * op;
            b = b * (1 - op) + tinte[2]! * op;
          }
        }
        if (dato?.discordia.length) { r = r * 0.74 + 209 * 0.26; g = g * 0.74 + 53 * 0.26; b = b * 0.74 + 43 * 0.26; }
        colores.set(clave, [r / 255, g / 255, b / 255]);
      }
    };

    const dibujar = (prog: WebGLProgram, seleccionando: boolean) => {
      const lado = lienzo.width / (lienzo.height || 1);
      const proy = perspectiva(FOV, lado, Math.max(1, radio * 0.05), radio * 12);
      const vista = orbita(camara.current.guinada, camara.current.cabeceo, camara.current.distancia, centro);
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
      const mirada = focoRef.current ?? datos.current.seleccion;
      const porDentro = mirada !== null && PROFUNDAS.has(mirada);
      // Al mirar una estructura de dentro, todo lo demás se vuelve fantasma
      // (la corteza más que el resto) y ella queda entera. Primero lo opaco;
      // después lo translúcido de lejos a cerca, que es como se compone bien.
      const profundidadDe = (p: Pieza): number => {
        const c = p.estructura.caja;
        return transformar(vista, [(c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2]).z;
      };
      const esTranslucida = (p: Pieza): boolean => porDentro && !seleccionando && p.estructura.clave !== mirada;
      const esMirada = (p: Pieza): boolean => porDentro && !seleccionando && p.estructura.clave === mirada;
      // Con el cerebro abierto, la estructura mirada va la última y sin test de
      // profundidad: se ve entera aunque quede detrás de algo, como en una
      // radiografía. Es el sentido de abrirlo.
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
        contexto.bindBuffer(contexto.ELEMENT_ARRAY_BUFFER, p.indices);
        if (seleccionando) {
          contexto.uniform3fv(uColor, p.id);
        } else {
          const c = colores.get(p.estructura.clave) ?? [0.8, 0.7, 0.7];
          contexto.uniform3fv(uColor, c);
          contexto.uniform1f(uOpacidad, translucida ? opacidadAbierta(p.estructura.clave) : 1);
          contexto.uniform1f(uResalte, p.estructura.clave === mirada ? 1 : 0);
          contexto.depthMask(!translucida);
        }
        contexto.drawElements(contexto.TRIANGLES, p.cuenta, contexto.UNSIGNED_INT, 0);
      }
      contexto.depthMask(true);
      contexto.enable(contexto.DEPTH_TEST);
    };

    const pintar = () => {
      frame = 0;
      const rect = lienzo.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      contexto.viewport(0, 0, w, h);
      contexto.clearColor(0.043, 0.039, 0.078, 1);
      contexto.enable(contexto.DEPTH_TEST);
      contexto.enable(contexto.BLEND);
      contexto.blendFunc(contexto.SRC_ALPHA, contexto.ONE_MINUS_SRC_ALPHA);
      contexto.disable(contexto.CULL_FACE);
      contexto.clear(contexto.COLOR_BUFFER_BIT | contexto.DEPTH_BUFFER_BIT);
      dibujar(pintor, false);
    };
    const pedir = () => { if (!frame) frame = requestAnimationFrame(pintar); };
    redibujar.current = () => { prepararColores(); pedir(); };
    detener.current = () => { if (animacion) { cancelAnimationFrame(animacion); animacion = 0; } };

    detectar.current = (x, y) => {
      if (!piezas.length) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      contexto.clearColor(0, 0, 0, 1);
      contexto.disable(contexto.BLEND);
      contexto.clear(contexto.COLOR_BUFFER_BIT | contexto.DEPTH_BUFFER_BIT);
      dibujar(selector, true);
      const pixel = new Uint8Array(4);
      contexto.readPixels(Math.round(x * dpr), Math.round((lienzo.getBoundingClientRect().height - y) * dpr), 1, 1, contexto.RGBA, contexto.UNSIGNED_BYTE, pixel);
      pedir();
      const n = pixel[0]! + (pixel[1]! << 8) + (pixel[2]! << 16);
      return n > 0 && n <= piezas.length ? piezas[n - 1]!.estructura.clave : null;
    };

    // La carga del modelo: cada estructura por su lado, para que la primera se
    // vea sin esperar a la última.
    (async () => {
      try {
        const encaje = encuadre(indice.estructuras);
        centro = encaje.centro;
        radio = encaje.radio;
        radioRef.current = radio;
        camara.current = { ...camara.current, distancia: distanciaReposo(radio) };
        let orden = 0;
        for (const e of indice.estructuras) {
          let bytes: ArrayBuffer;
          if (cargarRef.current) {
            bytes = await cargarRef.current(e.fichero);
          } else {
            const ruta = Object.keys(FICHEROS).find((k) => k.endsWith(`/${e.fichero}`));
            if (!ruta) continue;
            const respuesta = await fetch(FICHEROS[ruta]!);
            if (!respuesta.ok) throw new Error(`No se pudo leer ${e.fichero}: el servidor respondió ${respuesta.status}.`);
            bytes = await respuesta.arrayBuffer();
          }
          const malla = leerMalla(bytes);
          if (!vivo) return;
          subir(malla, e, orden++);
          prepararColores();
          pedir();
        }
        if (!vivo) return;
        if (!piezas.length) { setEstado('sin_modelo'); return; }
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
            pintar();
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

  useEffect(() => { redibujar.current(); }, [atlas, seleccion, foco]);
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
  const nombre = indice?.estructuras.find((e) => e.clave === (foco ?? seleccion))?.nombre;

  // Sin WebGL, sin modelo o con un fallo de carga, la caja del lienzo se queda
  // con sus medidas y el aviso dentro: la maqueta no salta y la silueta de
  // espera sigue midiendo lo que el contenido (regla de los esqueletos).
  const respaldo = estado === 'sin_modelo' || estado === 'sin_webgl' || estado === 'error';
  const aviso = estado === 'sin_webgl' ? 'Este navegador no puede dibujar el cerebro en tres dimensiones. Puedes consultar toda la evidencia en «Vista 2D».'
    : estado === 'sin_modelo' ? 'El modelo anatómico del cerebro todavía no está instalado en esta copia. La evidencia está entera en «Vista 2D».'
    : `No se pudo cargar el modelo del cerebro. ${detalle}`;

  return (
    <section className="atlas-3d" aria-label="Cerebro en tres dimensiones">
      <div className="atlas-lienzo atlas-3d-lienzo">
        <div className="atlas-3d-herramientas">
          <button type="button" className="btn btn-s" onClick={() => { detener.current(); camara.current = { ...REPOSO, distancia: distanciaReposo(radioRef.current) }; redibujar.current(); }}>Restablecer vista</button>
          <button type="button" className="btn btn-s" aria-label="Girar a la izquierda" onClick={() => girar(-0.25, 0)}>◄</button>
          <button type="button" className="btn btn-s" aria-label="Girar a la derecha" onClick={() => girar(0.25, 0)}>►</button>
          <label>Estructura <select aria-label="Seleccionar estructura del cerebro" value={seleccion ?? ''} onChange={(e) => { if (e.target.value) seleccionar(e.target.value); }}>
            <option value="">Explorar estructuras</option>
            {(indice?.estructuras ?? []).map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}
          </select></label>
        </div>
        {estado === 'cargando' && <div className="atlas-3d-cargando"><Esqueleto alto={280} /><span className="sr-only">Cargando el modelo del cerebro</span></div>}
        {respaldo ? <p role="status" className="atlas-3d-sin-lienzo">{aviso}</p> : <canvas
          ref={canvas} className="atlas-3d-canvas" tabIndex={0} role="img"
          aria-label="Cerebro en tres dimensiones: arrastra o usa las flechas para girarlo, la rueda para acercarlo y el selector Estructura para consultar la evidencia de cada una."
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
              // Leer el píxel de selección para cada movimiento del ratón para
              // la tarjeta gráfica en seco: se resuelve una vez por fotograma.
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
        />}
      </div>
      <p className="meta">{indice?.atribucion ? `${indice.atribucion}. ` : ''}Las estructuras se encienden con la evidencia reunida: el color va por cohortes. Arrastra para girar el cerebro y pulsa una estructura para leer lo que hay sobre ella.</p>
      <p className="atlas-3d-lectura" aria-live="polite">{apuntada ? `${nombre ?? apuntada.etiqueta}: ${apuntada.conteo} registros · ${apuntada.cohortes.length} cohortes nombradas por sus hipótesis${apuntada.discordia.length ? ' · Discordia entre hechos' : ''}` : 'Señala una estructura para ver sus cifras y abrir su ficha.'}</p>
    </section>
  );
}
