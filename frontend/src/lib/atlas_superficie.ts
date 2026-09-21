// Superficie procedural ilustrativa, sin coordenadas de pacientes ni asignación
// de evidencia. Las regiones científicas siguen en el corte del atlas.
import { proyectar, rotar, type Camara } from './arbol3d';

type Punto = { x: number; y: number; z: number; surco?: number };
type Cara = { puntos: [Punto, Punto, Punto]; normal: Punto; tono: number };
export function superficieCerebral(): Cara[] {
  const caras: Cara[] = [];
  function volumen(rx: number, ry: number, rz: number, centro: Punto, cerebelo = false) {
    const filas = 90, columnas = 144;
    const vertices: Punto[][] = [];
    for (let i = 0; i <= filas; i++) {
      const theta = Math.PI * i / filas;
      vertices[i] = [];
      for (let j = 0; j <= columnas; j++) {
        const phi = 2 * Math.PI * j / columnas;
        const x = Math.sin(theta) * Math.cos(phi), y = Math.cos(theta), z = Math.sin(theta) * Math.sin(phi);
        // Surcos sinuosos, no un mapa anatómico de circunvoluciones.
        const fase = cerebelo ? 35 * y + 2 * x : 15 * y + 3 * Math.sin(5 * x + 3 * z) + 2 * Math.sin(7 * z - 2 * y);
        const surco = Math.exp(-Math.pow(Math.sin(fase) / 0.42, 2));
        const relieve = 1 - 0.015 * surco;
        vertices[i]!.push({ x: centro.x + rx * x * relieve, y: centro.y + ry * y * relieve + (cerebelo ? 0 : 16 * x), z: centro.z + rz * z * relieve, surco });
      }
    }
    function agregar(a: Punto, b: Punto, c: Punto) {
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
      const largo = Math.hypot(n.x, n.y, n.z);
      if (largo < 0.00001) return;
      // Normal suave de la envolvente: evita destellos triangulares al girar.
      const suave = { x: ((a.x + b.x + c.x) / 3 - centro.x) / (rx * rx), y: ((a.y + b.y + c.y) / 3 - centro.y) / (ry * ry), z: ((a.z + b.z + c.z) / 3 - centro.z) / (rz * rz) };
      const norma = Math.hypot(suave.x, suave.y, suave.z);
      const surco = ((a.surco ?? 0) + (b.surco ?? 0) + (c.surco ?? 0)) / 3;
      caras.push({ puntos: [a, b, c], normal: { x: suave.x / norma, y: suave.y / norma, z: suave.z / norma }, tono: (cerebelo ? -5 : 0) - 18 * surco });
    }
    for (let i = 0; i < filas; i++) for (let j = 0; j < columnas; j++) {
      const a = vertices[i]![j]!, b = vertices[i + 1]![j]!, c = vertices[i + 1]![j + 1]!, d = vertices[i]![j + 1]!;
      agregar(a, b, c); agregar(a, c, d);
    }
  }
  volumen(38, 104, 38, { x: 110, y: 145, z: 0 }, true);
  for (const lado of [-1, 1]) {
    volumen(109, 70, 80, { x: 158, y: 112, z: lado * 63 }, true);
    volumen(270, 175, 105, { x: -20, y: -50, z: lado * 108 });
  }
  return caras;
}

export function pintarSuperficie(ctx: CanvasRenderingContext2D, caras: ReturnType<typeof superficieCerebral>, camara: Camara) {
  const sombra = ctx.createRadialGradient(500, 543, 5, 500, 543, 240);
  sombra.addColorStop(0, '#0009'); sombra.addColorStop(1, '#0000');
  ctx.save(); ctx.translate(0, 395); ctx.scale(1, 0.28); ctx.fillStyle = sombra; ctx.fillRect(200, 270, 600, 500); ctx.restore();
  const visibles = caras.map((cara) => ({ ...cara, n: rotar(cara.normal, camara), p: cara.puntos.map((p) => proyectar(p, camara, 1000, 620)) }))
    .filter((cara) => cara.n.z < 0.15 && cara.p.every((p) => p.visible))
    .sort((a, b) => b.p.reduce((s, p) => s + p.profundidad, 0) - a.p.reduce((s, p) => s + p.profundidad, 0));
  for (const cara of visibles) {
    const luz = Math.max(0, -cara.n.x * 0.35 - cara.n.y * 0.55 - cara.n.z * 0.75);
    const brillo = 35 + 42 * luz + cara.tono;
    ctx.fillStyle = `hsl(350 43% ${brillo}%)`;
    ctx.beginPath(); cara.p.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.45; ctx.stroke(); ctx.fill();
  }
}
