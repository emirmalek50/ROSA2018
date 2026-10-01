// La gráfica de progreso de la investigación: peldaños de certeza por
// iteración a través de todas las corridas, hechos acumulados, la banda de
// fallidos abajo (como la "Failed" de rekursiv.ai) y las marcas de cambio de
// arnés. SVG puro, sin librerías, en el estilo de la gráfica de Elo.
import { useMemo } from 'react';
import type { Corrida } from '../datos/tipos';
import { resumenMetrica, serieDeProgreso } from '../lib/progreso';
import { Seccion } from './piezas';
import { tr } from '../lib/idioma';

const PELDANO = ['muy baja', 'baja', 'moderada', 'alta'];

export function GraficaProgreso({ corridas }: { corridas: Corrida[] }) {
  const puntos = useMemo(() => serieDeProgreso(corridas), [corridas]);
  if (puntos.length === 0) return null;
  const W = 640;
  const H = 190;
  // Márgenes: a la izquierda caben "peldaños" y "fallos" enteros (con 34 se
  // recortaban a "eldaños" y "fall"); arriba, el título del eje no pisa el número.
  const ml = 62;
  const mr = 26;
  const mt = 24;
  const alturaBanda = 22;
  const mb = 30 + alturaBanda;
  const n = puntos.length;
  const x = (i: number) => ml + (n === 1 ? (W - ml - mr) / 2 : (i / (n - 1)) * (W - ml - mr));
  // Sin peldaños todavía, el eje lo dice con palabras: un "1" arriba se leía como si alguna hipótesis hubiera subido (Emir, 17 de septiembre de 2026).
  const maxReal = Math.max(0, ...puntos.map((p) => p.peldanosTotales));
  const maxPeld = Math.max(1, maxReal);
  const yPeld = (v: number) => mt + (1 - v / maxPeld) * (H - mt - mb);
  const maxHechos = Math.max(1, ...puntos.map((p) => p.hechosAcumulados));
  // La línea de hechos acumulados siempre acaba en su máximo: se dibuja al 88 % de la altura para que no se esconda bajo la rejilla superior.
  const yHechos = (v: number) => mt + (1 - (0.88 * v) / maxHechos) * (H - mt - mb);
  const camino = (f: (p: (typeof puntos)[number]) => number) => puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
  const ultimo = puntos[n - 1]!;
  const terminadas = corridas.filter((c) => c.metrica).sort((a, b) => b.numero - a.numero);
  const yBanda = H - mb + 14;
  // Las cruces de fallidos se centran en su punto pero sin salirse del marco ni
  // pisar la etiqueta "fallos" (en el primer y el último punto quedaban cortadas).
  const xBanda = (i: number) => Math.min(Math.max(x(i), ml + 14), W - mr - 14);
  const marcaFallidos = (f: number) => (f <= 3 ? '×'.repeat(f) : `×${f}`);
  return (
    <Seccion
      titulo="Progreso de la investigación"
      nota="Cada punto es una iteración cerrada, de todas las corridas seguidas. La línea morada suma los peldaños de certeza (muy baja 0, baja 1, moderada 2, alta 3) de las hipótesis vivas; la gris, los hechos acumulados. Abajo, en rojo, lo que falló en cada iteración. Las rayas verticales marcan un cambio de versión de ROSA2018. Es la vara: si la línea morada no sube, ROSA2018 lee pero no avanza."
    >
      <svg className="grafica-progreso" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Progreso: ${ultimo.peldanosTotales} peldaños de certeza tras ${n} iteraciones${maxReal === 0 ? '; ninguna hipótesis ha subido todavía' : ''}`}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} className="gp-rejilla" x1={ml} x2={W - mr} y1={yPeld(f * maxPeld)} y2={yPeld(f * maxPeld)} />
        ))}
        <text className="gp-eje" x={ml - 4} y={yPeld(maxPeld) + 4} textAnchor="end">{maxReal > 0 ? maxPeld : 'ninguno'}</text>
        <text className="gp-eje" x={ml - 4} y={yPeld(0) + 4} textAnchor="end">0</text>
        <text className="gp-eje gp-titulo-eje" x={ml - 4} y={mt - 10} textAnchor="end">peldaños</text>
        {puntos.filter((p) => p.cambioDeArnes).map((p) => (
          <g key={`arnes-${p.indice}`}>
            <line className="gp-arnes" x1={x(p.indice)} x2={x(p.indice)} y1={mt} y2={H - mb + 4} />
            <text className="gp-eje" x={x(p.indice) + 3} y={mt + 8}>ROSA2018 {p.arnes ?? '?'}</text>
          </g>
        ))}
        <path className="gp-hechos" d={camino((p) => yHechos(p.hechosAcumulados))} />
        <path className="gp-peldanos" d={camino((p) => yPeld(p.peldanosTotales))} />
        {puntos.map((p) => (
          <g key={p.indice}>
            <circle className={`gp-punto ${p.peldanosSubidos > 0 ? 'gp-sube' : ''} ${p.peldanosBajados > 0 ? 'gp-baja' : ''}`} cx={x(p.indice)} cy={yPeld(p.peldanosTotales)} r={p.peldanosSubidos > 0 || p.peldanosBajados > 0 ? 4 : 2.6}>
              <title>{`Corrida ${p.corrida}, iteración ${p.iteracion}: ${p.peldanosTotales} peldaños (${p.peldanosSubidos} subidos, ${p.peldanosBajados} bajados), certeza máxima ${PELDANO[p.maxPeldano] ?? '?'}, ${p.hipotesisVivas} hipótesis vivas, ${p.hechosAcumulados} hechos acumulados, ${p.usdAcumulado.toFixed(2)} USD acumulados`}</title>
            </circle>
            {p.fallidos > 0 && (
              <text className="gp-fallido" x={xBanda(p.indice)} y={yBanda} textAnchor="middle">
                {marcaFallidos(p.fallidos)}
                <title>{`${p.fallidos} fallidos en la iteración ${p.iteracion} de la corrida ${p.corrida} (pasos, pistas, cierres del Killer y afirmaciones bloqueadas)`}</title>
              </text>
            )}
            {p.nuevaCorrida && (
              <text className="gp-eje" x={x(p.indice)} y={H - 6} textAnchor="middle">C{p.corrida}</text>
            )}
          </g>
        ))}
        <text className="gp-eje gp-fallido-etiqueta" x={ml - 4} y={yBanda} textAnchor="end">fallos</text>
      </svg>
      {maxReal === 0 && <p className="meta">{tr("Ninguna hipótesis ha subido un peldaño de certeza todavía: la línea morada está en cero y el eje marca hasta dónde llegaría el primero.")}</p>}
      <div className="gp-leyenda meta">
        <span><i className="gp-muestra gp-muestra-peldanos" /> peldaños de certeza</span>
        <span><i className="gp-muestra gp-muestra-hechos" /> hechos acumulados</span>
        <span><i className="gp-muestra gp-muestra-fallos" /> fallos</span>
      </div>
      {terminadas.length > 0 && (
        <ul className="lista-limpia gp-balances">
          {terminadas.slice(0, 3).map((c) => (
            <li key={c.id} className="meta">
              Corrida {c.numero}: {resumenMetrica(c.metrica)}
              {c.metrica?.banco?.puntuacion != null ? ` · banco «${c.metrica.banco.objetivo}»: ${c.metrica.banco.puntuacion}` : ''}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
