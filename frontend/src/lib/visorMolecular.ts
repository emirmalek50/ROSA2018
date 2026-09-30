// El visor de estructuras, detrás de una interfaz fina.
//
// Dentro es Mol* (MIT), que es el que usan el RCSB PDB y AlphaFold DB para sus
// propias páginas. Se eligió por una razón concreta y no por costumbre: trae
// oclusión ambiental y contorno, que es lo que da volumen de lámina científica;
// sin eso una proteína en pantalla parece plástico. Pesa unos 5 MB, así que se
// carga con `import()` solo cuando alguien abre la sección, y el resto de
// ROSA2018 no lo baja nunca.
//
// Todo lo que la pantalla necesita pasa por aquí (montar, pintar, encuadrar,
// proyectar, señalar). Si algún día conviene cambiar de motor, se reescribe este
// fichero y la pantalla no se entera.

import { Quat, Vec3, Vec4 } from 'molstar/lib/mol-math/linear-algebra';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import { Color } from 'molstar/lib/mol-util/color';

export type Estilo = 'ilustrativa' | 'cinta' | 'superficie';
export type Punto = [number, number, number];

/** Un residuo con lo que la pantalla enseña de él. */
export interface Residuo {
  numero: number;
  aa: string;
  /** Confianza del modelo en ese residuo (pLDDT), de 0 a 100. */
  plddt: number;
  centro: Punto;
}

export interface Visor {
  /** Carga una estructura desde su URL. Devuelve lo medido sobre el fichero. */
  cargar(url: string, formato: 'mmcif' | 'pdb', estilo: Estilo): Promise<{ atomos: number; residuos: number; plddtMedio: number; fiable: number }>;
  estilo(e: Estilo): Promise<void>;
  /** Acerca (`zoom` < 1) y corre el objeto a la derecha (`corrimiento` < 0). */
  encuadrar(zoom: number, corrimiento: number, ms?: number): void;
  /** Distancia de la cámara al objeto, para el zoom semántico. */
  distancia(): number;
  /** Lleva la cámara a una distancia dada, con animación. */
  irA(distancia: number, ms?: number): void;
  /** Proyecta un punto del espacio a píxeles del contenedor. */
  proyectar(p: Punto): { x: number; y: number };
  /** El centro de un tramo de residuos, donde se ancla su etiqueta. */
  centroDe(desde: number, hasta: number): Punto | null;
  /** Para cada rectángulo (en píxeles del contenedor), QUÉ FRACCIÓN de la
   *  proteína cae dentro, de 0 a 1. Se mira residuo a residuo y no por la caja
   *  envolvente: la caja de una proteína con colas largas cubre media pantalla
   *  y diría que pisa cuando no hay nada delante del texto. Devuelve fracción y
   *  no un sí o un no porque dos colas cruzando un título no son un choque:
   *  quien decide el umbral es la pantalla. */
  pisa(rects: { x: number; y: number; ancho: number; alto: number }[]): number[];
  residuo(numero: number): Residuo | undefined;
  /** Los residuos de un tramo, en orden. Con esto la pantalla saca la
   *  secuencia y la confianza de una parte sin pedir nada a la red. */
  residuosDe(desde: number, hasta: number): Residuo[];
  /** Cuántos residuos tienen su centro a menos de `radio` ángstrom del de
   *  este. Es una medida cruda de lo enterrado que está: no es superficie
   *  accesible al disolvente, y así hay que decirlo. */
  vecinos(numero: number, radio?: number): number;
  /** Lleva la cámara a un tramo: lo centra y se acerca lo justo para que
   *  quepa, sin pasar de `minimo`. Devuelve false si el tramo no está en el
   *  modelo. */
  enfocar(desde: number, hasta: number, minimo?: number, ms?: number): boolean;
  /** Avisa en cada fotograma dibujado. Devuelve cómo dejar de escuchar. */
  alDibujar(fn: () => void): () => void;
  /** Avisa del residuo bajo el ratón, o de null al salir. */
  alSeñalar(fn: (r: Residuo | null) => void): () => void;
  /** Giro automático, en radianes por segundo (la misma unidad y el mismo
   *  valor que el árbol 3D). */
  girar(si: boolean, radPorSegundo?: number): void;
  /** Gira la cámara alrededor de la proteína: `guinada` a los lados y
   *  `cabeceo` arriba y abajo, en radianes. Con esto la pantalla hace el
   *  lanzamiento al soltar, que Mol* no puede dar sin romper el zoom. */
  orbitar(guinada: number, cabeceo: number): void;
  destruir(): void;
}

const COLOR_CONFIANZA = 'plddt-confidence';

/** Giro automático en radianes por segundo. Es el mismo valor que el árbol 3D
 *  (`lib/arbol3d.ts`), para que las dos piezas se muevan igual. */
export const VELOCIDAD_GIRO = 0.15;

/** Cuánto acerca una muesca de la rueda. Mol* trae 7 de 15 y con una proteína
 *  de mil residuos eso salta de la lámina al detalle en dos muescas, tanto al
 *  entrar como al salir. A 2,6 el recorrido se nota continuo. */
const VELOCIDAD_ZOOM = 2.6;

/* La inercia al soltar NO se hace con el `staticMoving` de Mol*, aunque parezca
   lo obvio: esa bandera es una sola para el giro, el zoom y el encuadre, y al
   apagarla el zoom pasa a aplicarse en cada fotograma mientras el rozamiento
   frena, de modo que una muesca de la rueda se multiplica por cincuenta. El
   giro con inercia sale bien y el zoom se dispara. Así que el zoom se queda
   crudo (`staticMoving` en su sitio) y el lanzamiento lo hace la pantalla
   llamando a `orbitar` con una velocidad que decae. */

/** Monta un visor sobre un elemento. La carga de Mol* es perezosa. */
export async function crearVisor(nodo: HTMLElement, fondo = 0x08070b): Promise<Visor> {
  const molstar = await import('molstar/lib/mol-plugin-ui');
  const { DefaultPluginUISpec } = await import('molstar/lib/mol-plugin-ui/spec');
  const { PluginConfig } = await import('molstar/lib/mol-plugin/config');
  const { renderReact18 } = await import('molstar/lib/mol-plugin-ui/react18');
  // El color por confianza (pLDDT) es una EXTENSIÓN de Mol*, no viene en el
  // spec por defecto. Sin registrar su comportamiento el tema no existe en el
  // registro y Mol* cae al color por cadena sin decir nada: la proteína sale
  // verde entera y la leyenda de la pantalla pasa a ser mentira.
  const { PluginSpec } = await import('molstar/lib/mol-plugin/spec');
  const { MAQualityAssessment } = await import('molstar/lib/extensions/model-archive/quality-assessment/behavior');

  const spec = DefaultPluginUISpec();
  const plugin = await molstar.createPluginUI({
    target: nodo,
    render: renderReact18,
    spec: {
      ...spec,
      behaviors: [...spec.behaviors, PluginSpec.Behavior(MAQualityAssessment)],
      layout: { initial: { isExpanded: false, showControls: false } },
      components: { ...spec.components, controls: { left: 'none', right: 'none', top: 'none', bottom: 'none' } },
      config: [
        [PluginConfig.Viewport.ShowExpand, false],
        [PluginConfig.Viewport.ShowControls, false],
        [PluginConfig.Viewport.ShowSelectionMode, false],
        [PluginConfig.Viewport.ShowAnimation, false],
        [PluginConfig.Viewport.ShowTrajectoryControls, false],
      ],
    },
  });

  plugin.canvas3d?.setProps({
    renderer: { backgroundColor: Color(fondo) },
    trackball: { zoomSpeed: VELOCIDAD_ZOOM },
    // Sin el eje de coordenadas de Mol*: esta pantalla tiene su propio mando.
    camera: { helper: { axes: { name: 'off', params: {} } } },
    postprocessing: {
      // La oclusión ambiental y el contorno son lo que convierte un amasijo de
      // esferas en un cuerpo con volumen. Es lo que separa esto de un diagrama.
      occlusion: { name: 'on', params: { samples: 32, multiScale: { name: 'off', params: {} }, radius: 5, bias: 0.8, blurKernelSize: 15, blurDepthBias: 0.5, resolutionScale: 1, color: Color(0x000000), transparentThreshold: 0.4 } },
      outline: { name: 'on', params: { scale: 1, threshold: 0.33, color: Color(0x000000), includeTransparent: true } },
    },
  });

  let porResiduo = new Map<number, Residuo>();
  // Mol* escribe aqui la proyeccion; se reutiliza para no crear basura en cada fotograma.
  const proyectado = Vec4();

  const cam = () => plugin.canvas3d?.camera;
  const distancia = () => {
    const c = cam();
    if (!c) return 1;
    return Vec3.distance(c.state.target, c.state.position) || 1;
  };

  async function pintar(estilo: Estilo) {
    const est = plugin.managers.structure.hierarchy.current.structures[0];
    if (!est) return;
    // Se rehace el componente: cambiar el tipo sobre uno ya montado deja la
    // geometría vieja y Mol* no recalcula la oclusión.
    await plugin.managers.structure.component.clear([est]);
    const tipo = estilo === 'cinta' ? 'cartoon' : estilo === 'superficie' ? 'molecular-surface' : 'spacefill';
    const comp = await plugin.builders.structure.tryCreateComponentStatic(est.cell, 'polymer', { label: 'estructura' });
    if (comp) {
      await plugin.builders.structure.representation.addRepresentation(comp, {
        type: tipo as 'spacefill',
        typeParams: { quality: 'high' },
        color: COLOR_CONFIANZA as 'uniform',
      });
    }
  }

  return {
    async cargar(url, formato, estilo) {
      const datos = await plugin.builders.data.download({ url, isBinary: false }, { state: { isGhost: true } });
      const trayectoria = await plugin.builders.structure.parseTrajectory(datos, formato);
      const modelo = await plugin.builders.structure.createModel(trayectoria);
      await plugin.builders.structure.createStructure(modelo);
      await pintar(estilo);
      plugin.managers.camera.reset(undefined, 0);

      // Coordenadas, número de residuo y pLDDT, leídos del propio fichero.
      const est = plugin.managers.structure.hierarchy.current.structures[0];
      const m = est?.cell.obj?.data.models[0];
      porResiduo = new Map();
      let suma = 0;
      let n = 0;
      let fiables = 0;
      if (m) {
        const c = m.atomicConformation;
        const h = m.atomicHierarchy;
        const b = c.B_iso_or_equiv.toArray();
        const idx = h.residueAtomSegments.index;
        const acumulado = new Map<number, { n: number; x: number; y: number; z: number; b: number; aa: string }>();
        for (let a = 0; a < c.x.length; a += 1) {
          const num = h.residues.auth_seq_id.value(idx[a]!);
          let r = acumulado.get(num);
          if (!r) {
            r = { n: 0, x: 0, y: 0, z: 0, b: 0, aa: h.atoms.label_comp_id.value(a) };
            acumulado.set(num, r);
          }
          r.n += 1;
          r.x += c.x[a]!;
          r.y += c.y[a]!;
          r.z += c.z[a]!;
          r.b += b[a]!;
          suma += b[a]!;
          n += 1;
          if (b[a]! > 70) fiables += 1;
        }
        for (const [num, r] of acumulado) {
          porResiduo.set(num, { numero: num, aa: r.aa, plddt: r.b / r.n, centro: [r.x / r.n, r.y / r.n, r.z / r.n] });
        }
      }
      return { atomos: n, residuos: porResiduo.size, plddtMedio: n ? suma / n : 0, fiable: n ? fiables / n : 0 };
    },

    estilo: pintar,

    encuadrar(zoom, corrimiento, ms = 0) {
      const c = cam();
      if (!c) return;
      const e = c.state;
      const d = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), e.target, e.position));
      // Vector "a la derecha" de la cámara: dirección por arriba.
      const r = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), d, e.up));
      const target = Vec3.scaleAndAdd(Vec3(), e.target, r, e.radius * corrimiento);
      // OJO: en perspectiva el `radius` de Mol* solo controla el recorte y la
      // niebla, no el tamaño. Lo que acerca es mover la posición.
      const dist = Vec3.distance(e.target, e.position) * zoom;
      const position = Vec3.scaleAndAdd(Vec3(), target, d, -dist);
      c.setState({ ...e, target, position }, ms);
      plugin.canvas3d?.requestDraw();
    },

    distancia,

    irA(dist, ms = 420) {
      const c = cam();
      if (!c) return;
      const e = c.state;
      const d = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), e.target, e.position));
      c.setState({ ...e, position: Vec3.scaleAndAdd(Vec3(), e.target, d, -dist) }, ms);
    },

    proyectar(p) {
      const c = cam();
      if (!c) return { x: -9999, y: -9999 };
      c.project(proyectado, Vec3.create(p[0], p[1], p[2]));
      const caja = nodo.getBoundingClientRect();
      // El lienzo va en píxeles de dispositivo y la caja en píxeles de CSS.
      const escala = caja.width ? c.viewport.width / caja.width : 1;
      return { x: proyectado[0]! / escala, y: caja.height - proyectado[1]! / escala };
    },

    centroDe(desde, hasta) {
      let n = 0;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = desde; i <= hasta; i += 1) {
        const r = porResiduo.get(i);
        if (!r) continue;
        n += 1;
        x += r.centro[0];
        y += r.centro[1];
        z += r.centro[2];
      }
      return n ? ([x / n, y / n, z / n] as Punto) : null;
    },

    residuo: (numero) => porResiduo.get(numero),

    residuosDe(desde, hasta) {
      const rs: Residuo[] = [];
      for (let i = desde; i <= hasta; i += 1) {
        const r = porResiduo.get(i);
        if (r) rs.push(r);
      }
      return rs;
    },

    vecinos(numero, radio = 10) {
      const r = porResiduo.get(numero);
      if (!r) return 0;
      const c = Vec3.create(r.centro[0], r.centro[1], r.centro[2]);
      const r2 = radio * radio;
      let n = 0;
      for (const otro of porResiduo.values()) {
        if (otro.numero === numero) continue;
        const d = Vec3.squaredDistance(c, Vec3.create(otro.centro[0], otro.centro[1], otro.centro[2]));
        if (d <= r2) n += 1;
      }
      return n;
    },

    enfocar(desde, hasta, minimo = 28, ms = 620) {
      const c = cam();
      if (!c) return false;
      const rs: Residuo[] = [];
      for (let i = desde; i <= hasta; i += 1) {
        const r = porResiduo.get(i);
        if (r) rs.push(r);
      }
      if (!rs.length) return false;
      const centro = Vec3.create(0, 0, 0);
      for (const r of rs) Vec3.add(centro, centro, Vec3.create(r.centro[0], r.centro[1], r.centro[2]));
      Vec3.scale(centro, centro, 1 / rs.length);
      // Radio del tramo: lo que hay que abarcar. Un sitio activo es un punto y
      // un dominio son cuatrocientos residuos, así que la distancia sale de su
      // tamaño y no de un número fijo.
      let radio = 0;
      for (const r of rs) radio = Math.max(radio, Vec3.distance(centro, Vec3.create(r.centro[0], r.centro[1], r.centro[2])));
      const e = c.state;
      const dir = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), e.target, e.position));
      // Un sitio activo es UN residuo: su radio es cero y sin suelo la cámara
      // se quedaba pegada a un átomo, sin nada alrededor con lo que situarlo.
      // El suelo lo pone quien llama, en proporción al tamaño de la proteína.
      const dist = Math.max(minimo, radio * 3.4);
      c.setState({ ...e, target: Vec3.clone(centro), position: Vec3.scaleAndAdd(Vec3(), centro, dir, -dist) }, ms);
      plugin.canvas3d?.requestDraw();
      return true;
    },

    pisa(rects) {
      const c = cam();
      const dentro = rects.map(() => 0);
      if (!c || !rects.length || !porResiduo.size) return dentro;
      const caja = nodo.getBoundingClientRect();
      const escala = caja.width ? c.viewport.width / caja.width : 1;
      // Una de cada `paso` para no proyectar novecientos puntos por fotograma;
      // con un tope de 300 basta para saber si algo tapa un párrafo.
      const todos = [...porResiduo.values()];
      const paso = Math.max(1, Math.ceil(todos.length / 300));
      let n = 0;
      for (let i = 0; i < todos.length; i += paso) {
        const p = todos[i]!.centro;
        c.project(proyectado, Vec3.create(p[0], p[1], p[2]));
        const x = proyectado[0]! / escala;
        const y = caja.height - proyectado[1]! / escala;
        n += 1;
        for (let k = 0; k < rects.length; k += 1) {
          const r = rects[k]!;
          if (x >= r.x && x <= r.x + r.ancho && y >= r.y && y <= r.y + r.alto) dentro[k]! += 1;
        }
      }
      return n ? dentro.map((d) => d / n) : dentro;
    },

    alDibujar(fn) {
      const s = plugin.canvas3d?.didDraw.subscribe(fn);
      return () => s?.unsubscribe();
    },

    alSeñalar(fn) {
      const s = plugin.behaviors.interaction.hover.subscribe((e) => {
        const loci = e.current?.loci;
        if (!loci || loci.kind !== 'element-loci' || !loci.elements.length) return fn(null);
        const el = loci.elements[0]!;
        // `indices` es un OrderedSet de Mol*, no un array: se lee con getAt.
        const ai = el.unit.elements[OrderedSet.getAt(el.indices, 0)];
        if (ai === undefined) return fn(null);
        const h = el.unit.model.atomicHierarchy;
        const num = h.residues.auth_seq_id.value(h.residueAtomSegments.index[ai]!);
        fn(porResiduo.get(num) ?? null);
      });
      return () => s?.unsubscribe();
    },

    orbitar(guinada, cabeceo) {
      const c = cam();
      if (!c || (!guinada && !cabeceo)) return;
      const e = c.state;
      const ojo = Vec3.sub(Vec3(), e.position, e.target);
      const arriba = Vec3.clone(e.up);
      const derecha = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), ojo, arriba));
      const q = Quat.multiply(Quat(), Quat.setAxisAngle(Quat(), arriba, -guinada), Quat.setAxisAngle(Quat(), derecha, -cabeceo));
      Vec3.transformQuat(ojo, ojo, q);
      Vec3.transformQuat(arriba, arriba, q);
      c.setState({ ...e, position: Vec3.add(Vec3(), e.target, ojo), up: arriba }, 0);
      plugin.canvas3d?.requestDraw();
    },

    girar(si, radPorSegundo = VELOCIDAD_GIRO) {
      plugin.canvas3d?.setProps({ trackball: { animate: si ? { name: 'spin', params: { speed: radPorSegundo } } : { name: 'off', params: {} } } });
    },

    destruir() {
      plugin.dispose();
    },
  };
}
