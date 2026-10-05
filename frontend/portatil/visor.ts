import type { Visor } from '../src/lib/visorMolecular';

// Mantiene operativos los paneles de la proteína sin cargar Molstar ni estructuras.
export async function crearVisor(nodo: HTMLElement): Promise<Visor> {
  const aviso = document.createElement('div');
  aviso.className = 'portatil-sin-3d';
  aviso.textContent = 'Visualización 3D omitida. Explora la ficha y los oligonucleótidos con datos de muestra.';
  nodo.append(aviso);
  return {
    cargar: async () => ({ atomos: 0, residuos: 0, plddtMedio: 0, fiable: 0 }),
    estilo: async () => {}, encuadrar: () => {}, distancia: () => 100,
    irA: () => {}, proyectar: () => ({ x: 0, y: 0 }), centroDe: () => null,
    pisa: rects => rects.map(() => 0), residuo: () => undefined,
    residuosDe: () => [], vecinos: () => 0, enfocar: () => false,
    alDibujar: () => () => {}, vaciar: async () => {}, capturar: async () => null,
    alSeñalar: () => () => {}, girar: () => {}, orbitar: () => {}, destruir: () => aviso.remove(),
  };
}
