// La serie de progreso de una investigación para la gráfica: una fila por
// iteración cerrada de cada corrida, en orden, con los peldaños de certeza
// (0 muy baja, 1 baja, 2 moderada, 3 alta) de las hipótesis vivas, los hechos
// acumulados, lo que falló y las marcas de cambio de arnés (otra versión de
// ROSA2018). Espejo de rosa/progreso.py; puro y probado.
import type { Corrida, ProgresoIteracion } from '../datos/tipos';
import { tr, trp } from './idioma';

export interface PuntoProgreso {
  /** Posición en el eje, de 0 a N-1, a través de todas las corridas. */
  indice: number;
  corrida: number;
  iteracion: number;
  fecha: number;
  peldanosTotales: number;
  peldanosSubidos: number;
  peldanosBajados: number;
  maxPeldano: number;
  hipotesisVivas: number;
  hechosAcumulados: number;
  fallidos: number;
  usdAcumulado: number;
  arnes: string | null;
  /** Primera iteración de una corrida con un arnés distinto al anterior. */
  cambioDeArnes: boolean;
  /** Primera iteración de una corrida nueva. */
  nuevaCorrida: boolean;
}

export function serieDeProgreso(corridas: Corrida[]): PuntoProgreso[] {
  const ordenadas = [...corridas].sort((a, b) => a.numero - b.numero);
  const puntos: PuntoProgreso[] = [];
  let hechos = 0;
  let arnesPrevio: string | null | undefined;
  for (const c of ordenadas) {
    const serie: ProgresoIteracion[] = c.progreso ?? [];
    serie.forEach((p, i) => {
      hechos += p.hechosNuevos;
      const f = p.fallidos;
      puntos.push({
        indice: puntos.length,
        corrida: c.numero,
        iteracion: p.iteracion,
        fecha: p.fecha,
        peldanosTotales: p.peldanosTotales,
        peldanosSubidos: p.peldanosSubidos,
        peldanosBajados: p.peldanosBajados,
        maxPeldano: p.certezas.reduce((m, x) => Math.max(m, x.peldano), 0),
        hipotesisVivas: p.hipotesisVivas,
        hechosAcumulados: hechos,
        fallidos: f.pasos + f.pistas + f.killer + f.afirmacionesBloqueadas,
        usdAcumulado: p.usdAcumulado,
        arnes: p.arnes ?? null,
        cambioDeArnes: i === 0 && arnesPrevio !== undefined && (p.arnes ?? null) !== arnesPrevio,
        nuevaCorrida: i === 0,
      });
      if (i === 0) arnesPrevio = p.arnes ?? null;
    });
  }
  return puntos;
}

/** El balance en una frase, como lo escribe rosa/progreso.py. */
export function resumenMetrica(m: Corrida['metrica']): string {
  if (!m) return '';
  const netos = m.peldanosNetos;
  const partes = [(netos >= 0 ? trp("subió {netos} {v} netos de certeza en {iteraciones} {v2}", { netos: Math.abs(netos), v: Math.abs(netos) === 1 ? tr("peldaño") : tr("peldaños"), iteraciones: m.iteraciones, v2: m.iteraciones === 1 ? tr("iteración") : tr("iteraciones") }) : trp("bajó {netos} {v} netos de certeza en {iteraciones} {v2}", { netos: Math.abs(netos), v: Math.abs(netos) === 1 ? tr("peldaño") : tr("peldaños"), iteraciones: m.iteraciones, v2: m.iteraciones === 1 ? tr("iteración") : tr("iteraciones") }))];
  if (m.peldanosPorDolar !== null) partes.push(trp("{peldanosPorDolar} por dólar", { peldanosPorDolar: m.peldanosPorDolar }));
  if (m.hipotesisEnBajaOMas > 0) partes.push(trp("{hipotesisEnBajaOMas} hipótesis en certeza baja o más", { hipotesisEnBajaOMas: m.hipotesisEnBajaOMas }));
  return partes.join('; ');
}
