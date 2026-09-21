// Superficie cerebral ilustrativa y relieve del corte sagital existente.
// Comparte la cámara orbital del árbol. La evidencia conserva sus claves y
// conteos; la profundidad es exclusivamente ilustrativa.
import { useEffect, useRef, useState } from 'react';
import { acotarCamara, proyectar, SENSIBILIDAD_GIRO, type Camara } from '../lib/arbol3d';
import { CONTORNO_CEREBRO, NOMBRE_CORTO, RECORTADAS, REGIONES_DIBUJO, TRAZOS_FINOS, VISTA } from '../lib/atlas_dibujo';
import { intensidad, NO_LOCALIZADAS, type Atlas, type RegionAtlas } from '../lib/atlas';
import { pintarSuperficie, superficieCerebral } from '../lib/atlas_superficie';

type Punto = { x: number; y: number };
type Trazo = { puntos: Punto[]; cerrado: boolean };
const inicial = (): Camara => ({ guinada: -0.42, cabeceo: 0.18, distancia: 1100 });
const regiones = REGIONES_DIBUJO.filter((r) => !NO_LOCALIZADAS.has(r.clave));
const FONDO = '#0b0a14';
const GROSOR = 95;
// El atlas ocupa más que el tronco del árbol: impedir atravesar su volumen.
const ajustar = (c: Camara): Camara => acotarCamara({ ...c, distancia: Math.max(760, c.distancia) });

/** El navegador muestrea cada subtrazado por separado: conserva agujeros y
 * vasos disjuntos, sin unirlos con diagonales inventadas. Solo al montar. */
function muestrear(d: string): Trazo[] {
  return (d.match(/[Mm][^Mm]*/g) ?? []).map((parte) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', parte);
    const longitud = path.getTotalLength();
    const n = Math.max(4, Math.ceil(longitud / 3));
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

export function Atlas3D({ atlas, seleccion, seleccionar }: { atlas: Atlas; seleccion: string | null; seleccionar: (clave: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const camara = useRef(inicial());
  const datos = useRef({ atlas, seleccion, seleccionar });
  datos.current = { atlas, seleccion, seleccionar };
  const redibujar = useRef(() => {});
  const detectar = useRef<(x: number, y: number) => string | null>(() => null);
  const arrastre = useRef<{ id: number; x: number; y: number; movido: boolean } | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const focoRef = useRef<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [completo, setCompleto] = useState(!seleccion);
  const completoRef = useRef(completo);
  completoRef.current = completo;

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
    const superficie = superficieCerebral();
    const contorno = muestrear(CONTORNO_CEREBRO);
    const formas = regiones.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    const finos = TRAZOS_FINOS.map((r) => ({ ...r, trazos: muestrear(r.d) }));
    const tile = document.createElement('canvas');
    tile.width = tile.height = 8;
    const tc = tile.getContext('2d')!;
    tc.strokeStyle = '#c8bee842';
    tc.moveTo(0, 8); tc.lineTo(8, 0); tc.stroke();
    const rayas = contexto.createPattern(tile, 'repeat');
    let frame = 0;
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
      contexto.fillStyle = FONDO; contexto.fillRect(0, 0, rect.width, rect.height);
      escala = Math.min(rect.width / VISTA.ancho, rect.height / VISTA.alto);
      ox = (rect.width - VISTA.ancho * escala) / 2;
      oy = (rect.height - VISTA.alto * escala) / 2;
      contexto.translate(ox, oy); contexto.scale(escala, escala);
      const c = camara.current;
      if (completoRef.current) {
        zonas = [];
        pintarSuperficie(contexto, superficie, { ...c, guinada: c.guinada - 0.35, cabeceo: c.cabeceo + 0.22 });
        return;
      }
      const z = Math.cos(c.guinada) * Math.cos(c.cabeceo) >= 0 ? -GROSOR : GROSOR;
      // Paredes del relieve: profundidad fija, independiente de la evidencia.
      const paredes = contorno.flatMap((t) => t.puntos.slice(1).map((b, i) => {
        const a = t.puntos[i]!;
        const pts = [{ ...a, z: -GROSOR }, { ...b, z: -GROSOR }, { ...b, z: GROSOR }, { ...a, z: GROSOR }].map((p) => proyectar(p, c, VISTA.ancho, VISTA.alto));
        return { pts, profundidad: pts.reduce((s, p) => s + p.profundidad, 0) / 4 };
      })).sort((a, b) => b.profundidad - a.profundidad);
      for (const { pts, profundidad } of paredes) {
        contexto.beginPath();
        pts.forEach((p, i) => i ? contexto.lineTo(p.x, p.y) : contexto.moveTo(p.x, p.y));
        contexto.closePath();
        contexto.fillStyle = `hsl(259 25% ${Math.max(13, Math.min(32, 23 + (c.distancia - profundidad) / 20))}%)`;
        contexto.fill();
      }
      const silueta = camino(contorno, z, c);
      contexto.fillStyle = '#211b30'; contexto.fill(silueta, 'evenodd');
      const porClave = new Map(datos.current.atlas.regiones.map((r) => [r.clave, r]));
      zonas = [];
      for (const r of formas) {
        const dato = porClave.get(r.clave);
        const t = intensidad(dato?.cohortes.length ?? 0, datos.current.atlas.cohortesMax);
        const path = camino(r.trazos, r.exterior ? 0 : z, c);
        const clip = RECORTADAS.has(r.clave) ? silueta : null;
        const vasos = r.capa === 'vasos';
        contexto.save();
        if (clip) contexto.clip(clip, 'evenodd');
        contexto.fillStyle = `rgb(${130 + 119 * t}, ${108 + 74 * t}, ${194 - 110 * t})`;
        contexto.fillStyle = `color-mix(in oklab, #826cc2 ${100 - t * 100}%, #f9b654)`;
        contexto.strokeStyle = dato?.cobertura === 'buscada_sin_hallazgo' ? '#eee9ff' : '#b9aacf';
        if (vasos && dato?.conteo) contexto.strokeStyle = contexto.fillStyle;
        contexto.lineWidth = vasos ? 3 : 0.8;
        if (!vasos) {
          if (!dato?.conteo) contexto.fillStyle = '#282039';
          contexto.fill(path, 'evenodd');
          if (!dato?.conteo && rayas) { contexto.fillStyle = rayas; contexto.fill(path, 'evenodd'); }
        }
        contexto.stroke(path);
        if (!dato?.conteo && dato?.cobertura === 'buscada_sin_hallazgo') {
          const p = proyectar({ x: r.centro[0] - 500, y: r.centro[1] - 310, z: r.exterior ? 0 : z }, c, 1000, 620);
          contexto.beginPath(); contexto.arc(p.x, p.y, 3.5 / escala, 0, Math.PI * 2);
          contexto.fillStyle = '#eee9ff'; contexto.fill();
        }
        if (dato?.discordia.length) {
          contexto.strokeStyle = '#ff7b72'; contexto.lineWidth = 3; contexto.setLineDash([4, 4]); contexto.stroke(path); contexto.setLineDash([]);
        }
        if (r.clave === datos.current.seleccion || r.clave === focoRef.current) {
          contexto.strokeStyle = '#fff1b8'; contexto.lineWidth = 3; contexto.stroke(path);
        }
        contexto.restore();
        zonas.push({ clave: r.clave, path, clip, vasos });
      }
      contexto.strokeStyle = '#eee9ff66'; contexto.lineWidth = 0.9;
      for (const r of finos) {
        contexto.save();
        contexto.clip(silueta, 'evenodd');
        contexto.stroke(camino(r.trazos, z, c)); contexto.restore();
      }
      // Una etiqueta enfocada evita tapar las estructuras pequeñas al girar.
      const clave = focoRef.current ?? datos.current.seleccion;
      const forma = formas.find((r) => r.clave === clave);
      if (forma) {
        const p = proyectar({ x: forma.centro[0] - 500, y: forma.centro[1] - 310, z: forma.exterior ? 0 : z }, c, 1000, 620);
        contexto.beginPath(); contexto.arc(p.x, p.y, 5 / escala, 0, Math.PI * 2);
        contexto.fillStyle = '#fff1b8'; contexto.fill();
      }
      // De frente se conservan los nombres del corte; de perfil solo la
      // región enfocada para que las etiquetas no se apilen.
      contexto.font = `${12 / escala}px sans-serif`;
      contexto.textAlign = 'center'; contexto.textBaseline = 'middle';
      for (const r of formas) {
        if ((rect.width < 760 || Math.abs(Math.cos(c.guinada)) < 0.65) && r.clave !== clave) continue;
        const p = proyectar({ x: r.etiqueta[0] - 500, y: r.etiqueta[1] - 310, z: r.exterior ? 0 : z }, c, 1000, 620);
        const conteo = porClave.get(r.clave)?.conteo ?? 0;
        const texto = `${NOMBRE_CORTO[r.clave] ?? r.clave}${conteo ? ` · ${conteo}` : ''}`;
        contexto.strokeStyle = FONDO; contexto.lineWidth = 3 / escala;
        contexto.strokeText(texto, p.x, p.y); contexto.fillStyle = '#f4efe4'; contexto.fillText(texto, p.x, p.y);
      }
    };
    const pedir = () => { if (!frame) frame = requestAnimationFrame(pintar); };
    redibujar.current = pedir;
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
      camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015) });
      pedir();
    };
    lienzo.addEventListener('wheel', rueda, { passive: false });
    const observador = new ResizeObserver(pedir);
    observador.observe(lienzo); pedir();
    return () => {
      cancelAnimationFrame(frame); observador.disconnect(); lienzo.removeEventListener('wheel', rueda);
      redibujar.current = () => {}; detectar.current = () => null;
    };
  }, []);

  useEffect(() => { redibujar.current(); }, [atlas, seleccion, completo]);
  const cambiarFoco = (clave: string | null) => {
    if (focoRef.current !== clave) { focoRef.current = clave; setFoco(clave); redibujar.current(); }
  };
  const zoom = (factor: number) => {
    camara.current = ajustar({ ...camara.current, distancia: camara.current.distancia * factor }); redibujar.current();
  };
  const apuntada: RegionAtlas | undefined = atlas.regiones.find((r) => r.clave === (foco ?? seleccion));
  return (
    <section className="atlas-3d" aria-label="Atlas en tres dimensiones">
      <div className="atlas-3d-herramientas" role="group" aria-label="Representación del cerebro">
        <button type="button" className="btn btn-s" aria-pressed={completo} onClick={() => { setCompleto(true); cambiarFoco(null); }}>Cerebro completo</button>
        <button type="button" className="btn btn-s" aria-pressed={!completo} onClick={() => setCompleto(false)}>Corte y evidencia</button>
      </div>
      <div className="atlas-3d-herramientas">
        <button type="button" className="btn btn-s" onClick={() => { camara.current = inicial(); redibujar.current(); }}>Restablecer vista</button>
        <button type="button" className="btn btn-s" aria-label="Acercar atlas" onClick={() => zoom(0.85)}>+</button>
        <button type="button" className="btn btn-s" aria-label="Alejar atlas" onClick={() => zoom(1.18)}>−</button>
        <label>Región <select aria-label="Seleccionar región del atlas 3D" value={seleccion ?? ''} onChange={(e) => { if (e.target.value) { setCompleto(false); if (e.target.value !== seleccion) seleccionar(e.target.value); } }}>
          <option value="">Explorar regiones</option>
          {atlas.regiones.filter((r) => regiones.some((g) => g.clave === r.clave)).map((r) => <option key={r.clave} value={r.clave}>{r.etiqueta} · {r.conteo}</option>)}
        </select></label>
      </div>
      <p className="meta">{completo ? 'Dos hemisferios, cerebelo y tronco en una superficie ilustrativa. El rosa representa el tejido, no la certeza ni la cantidad de evidencia. Abre «Corte y evidencia» para explorar las regiones internas.' : 'Corte sagital esquemático. Los colores de evidencia conservan la leyenda del atlas. Pulsa una región para abrir su ficha.'} No es una reconstrucción anatómica de una resonancia. Arrastra para girar y usa la rueda para acercar.</p>
      {fallo ? <p role="status">Este navegador no permite dibujar el relieve. Puedes consultar toda la evidencia en «Vista 2D».</p> : <canvas
        ref={canvas} className="atlas-3d-canvas" tabIndex={0} role="img"
        aria-label="Cerebro ilustrativo del atlas: flechas para girar, + y - para acercar o alejar, Inicio para restablecer. Usa el selector Región para consultar evidencia con el teclado."
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) return;
          e.preventDefault();
          const c = camara.current;
          if (e.key === 'Home') camara.current = inicial();
          else if (e.key === '+' || e.key === '=') zoom(0.85);
          else if (e.key === '-') zoom(1.18);
          else camara.current = acotarCamara({ ...c, guinada: c.guinada + (e.key === 'ArrowLeft' ? -0.12 : e.key === 'ArrowRight' ? 0.12 : 0), cabeceo: c.cabeceo + (e.key === 'ArrowUp' ? -0.12 : e.key === 'ArrowDown' ? 0.12 : 0) });
          redibujar.current();
        }}
        onPointerDown={(e) => { if (e.button !== 0 || arrastre.current) return; arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY, movido: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
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
      <p className="atlas-3d-lectura" aria-live="polite">{apuntada ? `${apuntada.etiqueta}: ${apuntada.conteo} registros · ${apuntada.cohortes.length} cohortes nombradas por sus hipótesis${apuntada.discordia.length ? ' · Discordia entre hechos' : ''}${!apuntada.conteo ? apuntada.cobertura === 'buscada_sin_hallazgo' ? ' · Buscada sin hallazgo' : ' · No buscada' : ''}` : 'Selecciona una región para ver sus cifras y abrir su ficha.'}</p>
    </section>
  );
}
