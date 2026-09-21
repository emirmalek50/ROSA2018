// Relieve del corte sagital existente, no una reconstrucción anatómica.
// Comparte la cámara orbital del árbol (lib/arbol3d.ts). La evidencia conserva
// sus claves y conteos; la profundidad es exclusivamente ilustrativa.
//
// Cómo se pinta (21 de septiembre de 2026): se extruye la silueta del atlas
// (CONTORNO_CEREBRO, la lámina más el bulbo) un grosor fijo y en la cara que
// mira a la cámara se pinta la lámina anatómica en sus colores naturales
// (los campos y los trazos de tinta de lib/cerebro_base.ts, con Path2D) y
// encima las regiones con el MISMO color que el 2D (lib/atlas_color.ts,
// rellenoRegion: la fórmula de atlas.css en código, porque el lienzo no
// entiende color-mix), los huecos rayados, las marcas, las guías y las
// etiquetas. Los compartimentos de fuera (ojo, gota, intestino) son también
// volúmenes (requisito de Emir del 21 de septiembre: planos parecían recortes
// de papel junto al relieve del cerebro): cada uno se extruye con el mismo
// procedimiento que la silueta, con un grosor propio (la gota y el ojo,
// redondos, la mitad de su anchura; el intestino, un tubo, la mitad de su
// diámetro), paredes sombreadas en su color natural y la cara delantera con su
// base y, encima, su capa de evidencia, etiqueta, guía y marcas. El ojo es la
// excepción: un globo es una esfera, no un disco extruido, así que se pinta
// como esfera (su silueta es siempre un círculo: gradiente radial con la luz
// arriba a la izquierda, sombra hacia el borde y un brillo) y dentro, en el
// plano medio y recortados a la esfera, el corte con la córnea, el iris, el
// cristalino y la retina tintada forrando el fondo; el nervio sale por detrás.
// Los sólidos se pintan de lejos a cerca por la profundidad de su centro (el
// algoritmo del pintor), como las paredes de cada uno.
//
// Cómo entra: de frente, idéntico al 2D (guiñada 0, cabeceo 0, y la cámara a
// FOCAL + GROSOR, de modo que la cara cercana se proyecta a escala 1), y gira
// en unos 700 ms hasta la vista en reposo (guiñada -0,42, cabeceo 0,18,
// distancia 1100). Emir se quejó de una "transición incómoda" al cambiar de
// vista; así el 3D nace donde estaba el 2D. Con movimiento reducido no hay
// animación: empieza ya en reposo. Cualquier gesto (arrastre, rueda, teclado,
// botones) corta la animación. El lienzo va dentro de una caja .atlas-lienzo
// del mismo tamaño que la del 2D, con las herramientas superpuestas dentro,
// para que la maqueta no salte al cambiar de vista.
import { useEffect, useRef, useState } from 'react';
import { acotarCamara, FOCAL, proyectar, SENSIBILIDAD_GIRO, type Camara } from '../lib/arbol3d';
import { rellenoRegion, tokenAtlas } from '../lib/atlas_color';
import { BASE_EXTERIOR, CONTORNO_CEREBRO, finGuia, GLOBO_OCULAR, NOMBRE_CORTO, puntoMarca, RECORTADAS, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA } from '../lib/atlas_dibujo';
import { CEREBRO_BASE } from '../lib/cerebro_base';
import { intensidad, NO_LOCALIZADAS, type Atlas, type RegionAtlas } from '../lib/atlas';
import { useMovimientoReducido } from '../lib/movimiento';

type Punto = { x: number; y: number };
type Trazo = { puntos: Punto[]; cerrado: boolean };
/** Grosor del relieve, en unidades del lienzo. */
export const GROSOR = 95;
/** La vista en reposo: un poco de lado y desde arriba. */
export const inicial = (): Camara => ({ guinada: -0.42, cabeceo: 0.18, distancia: 1100 });
/** La vista frontal idéntica al 2D: la cara cercana (z = -GROSOR) queda a FOCAL de la cámara y se proyecta a escala 1. */
export const frontal = (): Camara => ({ guinada: 0, cabeceo: 0, distancia: FOCAL + GROSOR });
/** Cuánto dura el giro de entrada, en milisegundos. */
export const DURACION_ENTRADA = 700;
const regiones = REGIONES_DIBUJO.filter((r) => !NO_LOCALIZADAS.has(r.clave));
const FONDO = '#0b0a14';
const TEXTO = '#f4efe4';
const DISCORDIA = '#d1352b';
const SELECCION = '#2b1b10';
const BORDE = 'rgba(255, 255, 255, 0.78)';
const TINTA = CEREBRO_BASE.tinta;
/** Medio grosor de cada compartimento exterior, en unidades del lienzo: la gota
 *  (56 de ancho) y el ojo (72) son redondos, el intestino un tubo de unos 22. */
const GROSOR_EXTERIOR: Record<string, number> = { plasma: 26, retina: 0, intestino_microbiota: 11 };
/** El color de las paredes de cada sólido según la luz (0 en sombra, 1 de cara a la cámara). */
const PARED: Record<string, (luz: number) => string> = {
  cerebro: (luz) => `hsl(18 30% ${Math.round(22 + 24 * luz)}%)`,
  plasma: (luz) => `hsl(358 62% ${Math.round(22 + 18 * luz)}%)`,
  intestino_microbiota: (luz) => `hsl(6 42% ${Math.round(40 + 24 * luz)}%)`,
};
// El atlas ocupa más que el tronco del árbol: impedir atravesar su volumen.
const ajustar = (c: Camara): Camara => acotarCamara({ ...c, distancia: Math.max(760, c.distancia) });
/** Salida suave (la misma curva que lib/movimiento.ts, cúbica). */
const suavizar = (k: number): number => 1 - (1 - k) ** 3;
const entre = (a: Camara, b: Camara, k: number): Camara => ({ guinada: a.guinada + (b.guinada - a.guinada) * k, cabeceo: a.cabeceo + (b.cabeceo - a.cabeceo) * k, distancia: a.distancia + (b.distancia - a.distancia) * k });

/** El navegador muestrea cada subtrazado por separado: conserva agujeros y
 * vasos disjuntos, sin unirlos con diagonales inventadas. Solo al montar. */
function muestrear(d: string, paso = 3): Trazo[] {
  return (d.match(/[Mm][^Mm]*/g) ?? []).map((parte) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', parte);
    const longitud = path.getTotalLength();
    const n = Math.max(4, Math.ceil(longitud / paso));
    return { cerrado: /[Zz]\s*$/.test(parte), puntos: Array.from({ length: n + 1 }, (_, i) => {
      const p = path.getPointAtLength(longitud * i / n);
      return { x: p.x - VISTA.ancho / 2, y: p.y - VISTA.alto / 2 };
    }) };
  });
}

function camino(trazos: Trazo[], z: number, camara: Camara): Path2D {
  const path = new Path2D();
  for (const trazo of trazos) {
    trazo.puntos.forEach((p, i) => {
      const q = proyectar({ ...p, z }, camara, VISTA.ancho, VISTA.alto);
      if (i === 0) path.moveTo(q.x, q.y); else path.lineTo(q.x, q.y);
    });
    if (trazo.cerrado) path.closePath();
  }
  return path;
}

/** Un punto del lienzo lógico proyectado con la cámara, a la profundidad dada. */
function punto(p: readonly [number, number], z: number, camara: Camara): Punto {
  const q = proyectar({ x: p[0] - VISTA.ancho / 2, y: p[1] - VISTA.alto / 2, z }, camara, VISTA.ancho, VISTA.alto);
  return { x: q.x, y: q.y };
}

export function Atlas3D({ atlas, seleccion, seleccionar }: { atlas: Atlas; seleccion: string | null; seleccionar: (clave: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducido = useMovimientoReducido();
  const reducidoRef = useRef(reducido);
  reducidoRef.current = reducido;
  const camara = useRef(inicial());
  const datos = useRef({ atlas, seleccion, seleccionar });
  datos.current = { atlas, seleccion, seleccionar };
  const redibujar = useRef(() => {});
  const detener = useRef(() => {});
  const detectar = useRef<(x: number, y: number) => string | null>(() => null);
  const arrastre = useRef<{ id: number; x: number; y: number; movido: boolean } | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const focoRef = useRef<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const lienzo = canvas.current;
    if (!lienzo) return;
    let ctx: CanvasRenderingContext2D | null;
    try { ctx = lienzo.getContext('2d'); } catch { ctx = null; }
    if (!ctx || typeof SVGPathElement === 'undefined' || !SVGPathElement.prototype.getTotalLength) {
      setFallo(true);
      return;
    }
    const contexto = ctx;
    const contorno = muestrear(CONTORNO_CEREBRO);
    const formas = regiones.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    const finos = TRAZOS_FINOS.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    // La lámina: los campos (con su color) y la tinta, muestreados una vez; la médula se recorta con la propia silueta.
    const campos = CEREBRO_BASE.campos.map((c) => ({ fill: c.fill, trazos: muestrear(c.d, 4) }));
    const tinta = CEREBRO_BASE.trazos.map((t) => muestrear(t.d, 4));
    // Los sólidos: el cerebro (la silueta) y cada compartimento exterior (su primera base es el contorno que se extruye).
    const solidos = [
      { clave: 'cerebro', contorno, grosor: GROSOR, centro: [600, 300] as const, bases: [] as { fill: string; stroke?: string; papel?: string; trazos: Trazo[] }[] },
      ...Object.entries(BASE_EXTERIOR).map(([clave, partes]) => ({ clave, contorno: muestrear((partes.find((b) => b.papel === 'globo') ?? partes[0]!).d), grosor: GROSOR_EXTERIOR[clave] ?? 12, centro: (clave === 'retina' ? GLOBO_OCULAR.centro : REGIONES_DIBUJO.find((r) => r.clave === clave)?.centro ?? [500, 310]) as readonly [number, number], bases: partes.map((b) => ({ fill: b.fill, stroke: b.stroke, papel: b.papel, trazos: muestrear(b.d) })) })),
    ];
    // A qué sólido pertenece cada trazo fino (el ojo con su cristalino y su nervio, el brillo de la gota): el que contiene su primer punto de frente.
    const solidoDe = (t: Trazo[]): string => {
      const p = t[0]?.puntos[0];
      if (!p) return 'cerebro';
      for (const s of solidos) {
        if (s.clave === 'cerebro') continue;
        const path = new Path2D();
        s.contorno.forEach((tr) => tr.puntos.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y))));
        path.closePath();
        contexto.save(); contexto.resetTransform();
        const dentro = contexto.isPointInPath(path, p.x, p.y, 'evenodd');
        contexto.restore();
        if (dentro) return s.clave;
      }
      return 'cerebro';
    };
    const finosConSolido = finos.map((f) => ({ ...f, solido: solidoDe(f.trazos) }));
    const frio = tokenAtlas('--atlas-frio', '');
    const calido = tokenAtlas('--atlas-calido', '');
    const tile = document.createElement('canvas');
    tile.width = tile.height = 8;
    const tc = tile.getContext('2d')!;
    tc.strokeStyle = 'rgba(83, 46, 31, 0.45)';
    tc.lineWidth = 1.2;
    tc.moveTo(0, 8); tc.lineTo(8, 0); tc.stroke();
    const rayas = contexto.createPattern(tile, 'repeat');
    let frame = 0;
    let animacion = 0;
    let escala = 1;
    let ox = 0;
    let oy = 0;
    let zonas: { clave: string; path: Path2D; clip: Path2D | null; vasos: boolean }[] = [];
    const pintar = () => {
      frame = 0;
      const rect = lienzo.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      contexto.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Se limpia el lienzo entero (en píxeles del dispositivo, no en el alto fraccionario de la caja):
      // si no, la última fila, cubierta a medias, se mezclaba con la del fotograma anterior y dos
      // pintadas de la misma cámara no daban la misma imagen.
      contexto.clearRect(0, 0, w / dpr + 1, h / dpr + 1);
      contexto.fillStyle = FONDO; contexto.fillRect(0, 0, w / dpr + 1, h / dpr + 1);
      escala = Math.min(rect.width / VISTA.ancho, rect.height / VISTA.alto);
      ox = (rect.width - VISTA.ancho * escala) / 2;
      oy = (rect.height - VISTA.alto * escala) / 2;
      contexto.translate(ox, oy); contexto.scale(escala, escala);
      const c = camara.current;
      // La cara que mira a la cámara está en z negativa cuando la cámara mira de frente.
      const hacia = Math.cos(c.guinada) * Math.cos(c.cabeceo) >= 0 ? -1 : 1;
      const z = hacia * GROSOR;
      /** La z de la cara delantera de cada sólido, por clave de región exterior (el cerebro va en `z`). */
      const zDe = new Map<string, number>();
      const zRegion = (r: { clave: string; exterior?: boolean }) => (r.exterior ? zDe.get(r.clave) ?? z : z);
      /** Paredes de un sólido: un cuadrilátero por segmento del contorno entre -grosor y +grosor, de lejos a cerca, sombreado por la profundidad. */
      const pintarParedes = (trazos: Trazo[], grosor: number, color: (luz: number) => string) => {
        const paredes = trazos.flatMap((t) => t.puntos.slice(1).map((b, i) => {
          const a = t.puntos[i]!;
          const pts = [{ ...a, z: -grosor }, { ...b, z: -grosor }, { ...b, z: grosor }, { ...a, z: grosor }].map((p) => proyectar(p, c, VISTA.ancho, VISTA.alto));
          return { pts, profundidad: pts.reduce((s, p) => s + p.profundidad, 0) / 4 };
        })).sort((a, b) => b.profundidad - a.profundidad);
        for (const { pts, profundidad } of paredes) {
          contexto.beginPath();
          pts.forEach((p, i) => i ? contexto.lineTo(p.x, p.y) : contexto.moveTo(p.x, p.y));
          contexto.closePath();
          contexto.fillStyle = color(Math.max(0, Math.min(1, 0.5 + (c.distancia - profundidad) / 480)));
          contexto.fill();
        }
      };
      // Los sólidos de lejos a cerca (por la profundidad de su centro): paredes y después la cara delantera.
      const orden = solidos.map((s) => ({ s, profundidad: proyectar({ x: s.centro[0] - VISTA.ancho / 2, y: s.centro[1] - VISTA.alto / 2, z: 0 }, c, VISTA.ancho, VISTA.alto).profundidad })).sort((a, b) => b.profundidad - a.profundidad);
      let silueta = new Path2D();
      for (const { s } of orden) {
        if (s.grosor > 0) pintarParedes(s.contorno, s.grosor, PARED[s.clave] ?? PARED.cerebro!);
        const zc = hacia * s.grosor;
        const cara = camino(s.contorno, zc, c);
        if (s.clave === 'cerebro') {
          // La cara del cerebro: la lámina anatómica recortada a la silueta.
          silueta = cara;
          contexto.fillStyle = CEREBRO_BASE.campos[0]!.fill; contexto.fill(silueta, 'evenodd');
          contexto.save();
          contexto.clip(silueta, 'evenodd');
          for (const campo of campos) { contexto.fillStyle = campo.fill; contexto.fill(camino(campo.trazos, z, c), 'evenodd'); }
          contexto.fillStyle = TINTA;
          for (const t of tinta) contexto.fill(camino(t, z, c), 'evenodd');
          contexto.restore();
        } else if (s.clave === 'retina') {
          // El globo ocular como esfera, en el plano medio: el nervio detrás, la esfera sombreada, y dentro el corte.
          zDe.set(s.clave, 0);
          const q = proyectar({ x: GLOBO_OCULAR.centro[0] - VISTA.ancho / 2, y: GLOBO_OCULAR.centro[1] - VISTA.alto / 2, z: 0 }, c, VISTA.ancho, VISTA.alto);
          const R = GLOBO_OCULAR.radio * q.escala;
          for (const b of s.bases) if (b.papel === 'nervio') {
            const path = camino(b.trazos, 0, c);
            contexto.fillStyle = b.fill; contexto.fill(path, 'evenodd');
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
          const esfera = new Path2D();
          esfera.arc(q.x, q.y, R, 0, Math.PI * 2);
          const luz = contexto.createRadialGradient(q.x - 0.36 * R, q.y - 0.34 * R, R * 0.05, q.x - 0.1 * R, q.y - 0.08 * R, R * 1.15);
          luz.addColorStop(0, '#fbf8f2'); luz.addColorStop(0.62, '#efe7dc'); luz.addColorStop(1, '#a8978a');
          contexto.fillStyle = luz; contexto.fill(esfera);
          contexto.save();
          contexto.clip(esfera);
          for (const b of s.bases) if (b.papel !== 'nervio' && b.papel !== 'globo') {
            const path = camino(b.trazos, 0, c);
            contexto.fillStyle = b.fill; contexto.globalAlpha = b.papel === 'cornea' ? 0.75 : 1; contexto.fill(path, 'evenodd'); contexto.globalAlpha = 1;
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
          contexto.restore();
          // La córnea sobresale de la esfera: se repinta sin recorte, translúcida.
          for (const b of s.bases) if (b.papel === 'cornea') { contexto.fillStyle = b.fill; contexto.globalAlpha = 0.55; contexto.fill(camino(b.trazos, 0, c), 'evenodd'); contexto.globalAlpha = 1; }
          contexto.strokeStyle = '#8a6a5a'; contexto.lineWidth = 1; contexto.stroke(esfera);
          // El brillo, arriba a la izquierda.
          contexto.beginPath(); contexto.ellipse(q.x - 0.38 * R, q.y - 0.4 * R, 0.2 * R, 0.12 * R, 0, 0, Math.PI * 2);
          contexto.fillStyle = 'rgba(255, 255, 255, 0.6)'; contexto.fill();
        } else {
          zDe.set(s.clave, zc);
          for (const b of s.bases) {
            const path = camino(b.trazos, zc, c);
            contexto.fillStyle = b.fill; contexto.fill(path, 'evenodd');
            if (b.stroke) { contexto.strokeStyle = b.stroke; contexto.lineWidth = 1; contexto.stroke(path); }
          }
        }
        contexto.strokeStyle = 'rgba(238, 233, 255, 0.4)'; contexto.lineWidth = 0.9;
        for (const f of finosConSolido) if (f.solido === s.clave) contexto.stroke(camino(f.trazos, zc, c));
      }
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      zonas = [];
      for (const r of formas) {
        const dato = porClave.get(r.clave);
        const t = intensidad(dato?.cohortes.length ?? 0, datos.current.atlas.cohortesMax);
        const path = camino(r.trazos, zRegion(r), c);
        const clip = RECORTADAS.has(r.clave) ? silueta : null;
        const vasos = r.capa === 'vasos';
        const conFoco = r.clave === focoRef.current;
        const relleno = rellenoRegion(t, { frio, calido, foco: conFoco });
        contexto.save();
        if (clip) contexto.clip(clip, 'evenodd');
        if (vasos) {
          contexto.lineWidth = conFoco ? 4 : 3;
          contexto.lineCap = 'round';
          if (dato?.conteo) {
            contexto.strokeStyle = relleno.color; contexto.globalAlpha = conFoco ? 1 : 0.75 + 0.25 * t;
          } else {
            contexto.strokeStyle = `rgba(83, 46, 31, ${dato?.cobertura === 'buscada_sin_hallazgo' ? 0.7 : 0.45})`;
            contexto.setLineDash(dato?.cobertura === 'buscada_sin_hallazgo' ? [6, 3] : [4, 4]);
          }
          contexto.stroke(path);
          contexto.setLineDash([]);
          contexto.globalAlpha = 1;
        } else if (dato?.conteo) {
          contexto.fillStyle = relleno.color; contexto.globalAlpha = relleno.opacidad;
          contexto.fill(path, 'evenodd');
          contexto.globalAlpha = 1;
          contexto.strokeStyle = conFoco ? TEXTO : BORDE; contexto.lineWidth = conFoco ? 1.4 : 0.9;
          contexto.stroke(path);
        } else {
          // Hueco: rayas en la tinta de la lámina, tenues si nadie lo buscó y marcadas con contorno si se buscó sin hallazgo.
          const buscada = dato?.cobertura === 'buscada_sin_hallazgo';
          if (rayas) { contexto.fillStyle = rayas; contexto.globalAlpha = buscada || conFoco ? 0.85 : 0.5; contexto.fill(path, 'evenodd'); contexto.globalAlpha = 1; }
          contexto.strokeStyle = buscada ? 'rgba(83, 46, 31, 0.72)' : 'rgba(83, 46, 31, 0.16)'; contexto.lineWidth = buscada ? 1.1 : 0.8;
          if (conFoco) { contexto.strokeStyle = TEXTO; contexto.lineWidth = 1.4; }
          contexto.stroke(path);
        }
        if (dato?.discordia.length) {
          contexto.strokeStyle = DISCORDIA; contexto.lineWidth = vasos ? 4.5 : 1.8; contexto.setLineDash([3, 3]); contexto.stroke(path); contexto.setLineDash([]);
        }
        if (r.clave === datos.current.seleccion) {
          contexto.strokeStyle = BORDE; contexto.lineWidth = vasos ? 7 : 4.5; contexto.stroke(path);
          contexto.strokeStyle = SELECCION; contexto.lineWidth = vasos ? 5 : 2.2; contexto.stroke(path);
        }
        contexto.restore();
        zonas.push({ clave: r.clave, path, clip, vasos });
      }
      // Las marcas: el punto de «buscada sin hallazgo» y el de discordia, donde dice puntoMarca() con el texto que se pinta.
      for (const r of formas) {
        const dato = porClave.get(r.clave);
        if (!dato) continue;
        const buscada = dato.conteo === 0 && dato.cobertura === 'buscada_sin_hallazgo';
        const discordia = dato.discordia.length > 0;
        if (!buscada && !discordia) continue;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${dato.conteo ? ` · ${dato.conteo}` : ''}`;
        const p = punto(puntoMarca(r, texto), zRegion(r), c);
        contexto.beginPath(); contexto.arc(p.x, p.y, (discordia ? 4 : 3.2) / escala, 0, Math.PI * 2);
        contexto.fillStyle = discordia ? DISCORDIA : TINTA; contexto.fill();
        contexto.strokeStyle = '#ffffff'; contexto.lineWidth = 1 / escala; contexto.stroke();
      }
      // Una etiqueta enfocada evita tapar las estructuras pequeñas al girar.
      const clave = focoRef.current ?? datos.current.seleccion;
      const forma = formas.find((r) => r.clave === clave);
      if (forma) {
        const p = punto(forma.centro, zRegion(forma), c);
        contexto.beginPath(); contexto.arc(p.x, p.y, 5 / escala, 0, Math.PI * 2);
        contexto.fillStyle = '#fff1b8'; contexto.fill();
      }
      // De frente se conservan los nombres del corte, con sus guías; de perfil
      // solo la región enfocada para que las etiquetas no se apilen.
      contexto.font = `${12 / escala}px sans-serif`;
      contexto.textAlign = 'center'; contexto.textBaseline = 'middle';
      for (const r of formas) {
        if ((rect.width < 760 || Math.abs(Math.cos(c.guinada)) < 0.65) && r.clave !== clave) continue;
        const conteo = porClave.get(r.clave)?.conteo ?? 0;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${conteo ? ` · ${conteo}` : ''}`;
        const zr = zRegion(r);
        if (r.guia) {
          const a = punto(r.centro, zr, c);
          const b = punto(finGuia(r, texto), zr, c);
          contexto.beginPath(); contexto.moveTo(a.x, a.y); contexto.lineTo(b.x, b.y);
          contexto.strokeStyle = 'rgba(238, 233, 255, 0.34)'; contexto.lineWidth = 0.8; contexto.stroke();
        }
        const p = punto([r.etiqueta[0], r.etiqueta[1] - 4], zr, c);
        contexto.strokeStyle = FONDO; contexto.lineWidth = 3 / escala;
        contexto.strokeText(texto, p.x, p.y); contexto.fillStyle = conteo ? TEXTO : 'rgba(244, 239, 228, 0.78)'; contexto.fillText(texto, p.x, p.y);
      }
    };
    const pedir = () => { if (!frame) frame = requestAnimationFrame(pintar); };
    redibujar.current = pedir;
    // La entrada: de frente, como el 2D, y un giro suave hasta el reposo; nada con movimiento reducido.
    detener.current = () => { if (animacion) { cancelAnimationFrame(animacion); animacion = 0; } };
    if (!reducidoRef.current) {
      camara.current = frontal();
      let t0 = 0;
      const paso = (ahora: number) => {
        if (!t0) t0 = ahora;
        const k = Math.min(1, (ahora - t0) / DURACION_ENTRADA);
        camara.current = entre(frontal(), inicial(), suavizar(k));
        pintar();
        animacion = k < 1 ? requestAnimationFrame(paso) : 0;
      };
      animacion = requestAnimationFrame(paso);
    }
    detectar.current = (x, y) => {
      const px = (x - ox) / escala, py = (y - oy) / escala;
      contexto.save(); contexto.resetTransform();
      const zona = [...zonas].reverse().find((r) => {
        if (r.clip && !contexto.isPointInPath(r.clip, px, py, 'evenodd')) return false;
        contexto.lineWidth = 10;
        return r.vasos ? contexto.isPointInStroke(r.path, px, py) : contexto.isPointInPath(r.path, px, py, 'evenodd');
      });
      contexto.restore();
      return zona?.clave ?? null;
    };
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      detener.current();
      camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015) });
      pedir();
    };
    lienzo.addEventListener('wheel', rueda, { passive: false });
    const observador = new ResizeObserver(pedir);
    observador.observe(lienzo); pedir();
    return () => {
      cancelAnimationFrame(frame); detener.current(); observador.disconnect(); lienzo.removeEventListener('wheel', rueda);
      redibujar.current = () => {}; detener.current = () => {}; detectar.current = () => null;
    };
  }, []);

  useEffect(() => { redibujar.current(); }, [atlas, seleccion]);
  const cambiarFoco = (clave: string | null) => {
    if (focoRef.current !== clave) { focoRef.current = clave; setFoco(clave); redibujar.current(); }
  };
  const zoom = (factor: number) => {
    detener.current();
    camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * factor }); redibujar.current();
  };
  const restablecer = () => { detener.current(); camara.current = inicial(); redibujar.current(); };
  const apuntada: RegionAtlas | undefined = atlas.regiones.find((r) => r.clave === (foco ?? seleccion));
  return (
    <section className="atlas-3d" aria-label="Atlas en tres dimensiones">
      <div className="atlas-lienzo atlas-3d-lienzo">
        <div className="atlas-3d-herramientas">
          <button type="button" className="btn btn-s" onClick={restablecer}>Restablecer vista</button>
          <button type="button" className="btn btn-s" aria-label="Acercar atlas" onClick={() => zoom(0.85)}>+</button>
          <button type="button" className="btn btn-s" aria-label="Alejar atlas" onClick={() => zoom(1.18)}>−</button>
          <label>Región <select aria-label="Seleccionar región del atlas 3D" value={seleccion ?? ''} onChange={(e) => { if (e.target.value) seleccionar(e.target.value); }}>
            <option value="">Explorar regiones</option>
            {atlas.regiones.filter((r) => regiones.some((g) => g.clave === r.clave)).map((r) => <option key={r.clave} value={r.clave}>{r.etiqueta} · {r.conteo}</option>)}
          </select></label>
        </div>
        {fallo ? <p role="status" className="atlas-3d-sin-lienzo">Este navegador no permite dibujar el relieve. Puedes consultar toda la evidencia en «Vista 2D».</p> : <canvas
          ref={canvas} className="atlas-3d-canvas" tabIndex={0} role="img"
          aria-label="Relieve del atlas sobre la lámina anatómica: flechas para girar, + y - para acercar o alejar, Inicio para restablecer. Usa el selector Región para consultar evidencia con el teclado."
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) return;
            e.preventDefault();
            detener.current();
            const c = camara.current;
            if (e.key === 'Home') camara.current = inicial();
            else if (e.key === '+' || e.key === '=') zoom(0.85);
            else if (e.key === '-') zoom(1.18);
            else camara.current = acotarCamara({ ...c, guinada: c.guinada + (e.key === 'ArrowLeft' ? -0.12 : e.key === 'ArrowRight' ? 0.12 : 0), cabeceo: c.cabeceo + (e.key === 'ArrowUp' ? -0.12 : e.key === 'ArrowDown' ? 0.12 : 0) });
            redibujar.current();
          }}
          onPointerDown={(e) => { if (e.button !== 0 || arrastre.current) return; detener.current(); arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY, movido: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (a && a.id === e.pointerId) {
              const dx = e.clientX - a.x, dy = e.clientY - a.y;
              if (!a.movido && Math.hypot(dx, dy) < 4) return;
              a.movido = true; a.x = e.clientX; a.y = e.clientY;
              camara.current = acotarCamara({ ...camara.current, guinada: camara.current.guinada + dx * SENSIBILIDAD_GIRO, cabeceo: camara.current.cabeceo - dy * SENSIBILIDAD_GIRO });
              cambiarFoco(null); redibujar.current();
            } else if (!a) {
              const rect = e.currentTarget.getBoundingClientRect();
              cambiarFoco(detectar.current(e.clientX - rect.left, e.clientY - rect.top));
            }
          }}
          onPointerUp={(e) => {
            const a = arrastre.current;
            if (!a || a.id !== e.pointerId) return;
            if (!a.movido) { const rect = e.currentTarget.getBoundingClientRect(); const clave = detectar.current(e.clientX - rect.left, e.clientY - rect.top); if (clave) datos.current.seleccionar(clave); }
            arrastre.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => { arrastre.current = null; cambiarFoco(null); }}
          onLostPointerCapture={() => { arrastre.current = null; }}
          onPointerLeave={() => cambiarFoco(null)}
        />}
      </div>
      <p className="meta">Relieve 3D esquemático del corte sagital sobre la lámina anatómica, con grosor ilustrativo. No es una reconstrucción anatómica. Arrastra para girar, usa la rueda para acercar y pulsa una región para leer su evidencia.</p>
      <p className="atlas-3d-lectura" aria-live="polite">{apuntada ? `${apuntada.etiqueta}: ${apuntada.conteo} registros · ${apuntada.cohortes.length} cohortes nombradas por sus hipótesis${apuntada.discordia.length ? ' · Discordia entre hechos' : ''}${!apuntada.conteo ? apuntada.cobertura === 'buscada_sin_hallazgo' ? ' · Buscada sin hallazgo' : ' · No buscada' : ''}` : 'Selecciona una región para ver sus cifras y abrir su ficha.'}</p>
    </section>
  );
}
