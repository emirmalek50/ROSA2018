// El presupuesto global de la corrida: barra con marcas al 50, 80 y 100 %,
// proyeccion de cuando se llega al tope al ritmo actual, y ampliar. Al
// llegar, la corrida se pausa (no muere) y se reanuda ampliando; una
// pregunta pendiente tiene prioridad sobre el tope (patron de los Managed
// Agents de Anthropic).

import { useState } from 'react';
import type { Corrida } from '../datos/tipos';
import { estadoPresupuesto } from '../lib/calidad';
import { formatearDuracion, formatearEntero, formatearPorcentaje } from '../lib/formato';
import { Barra, Chip } from './piezas';
import { tr } from '../lib/idioma';

export function Presupuesto({ corrida, onAmpliar }: { corrida: Corrida; onAmpliar: (limite: number) => void }) {
  const p = estadoPresupuesto(corrida);
  const [nuevo, setNuevo] = useState(String(Math.round(corrida.presupuesto.limiteLlamadas * 1.5)));
  const tono = p.agotado || p.fraccion >= 0.8 ? 'mal' : p.fraccion >= 0.5 ? 'aviso' : 'ok';
  const pausada = corrida.estado === 'pausada_por_presupuesto';
  return (
    <div className={`tarjeta presupuesto ${pausada ? 'presupuesto-pausado' : ''}`}>
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>{tr("Tope de toda la corrida")}</strong>
        <span className="meta">
          {formatearEntero(corrida.gasto.llamadas)} de {formatearEntero(corrida.presupuesto.limiteLlamadas)} {tr("llamadas en total ·")} {formatearPorcentaje(p.fraccion)}
        </span>
      </div>
      <Barra fraccion={p.fraccion} marcas={corrida.presupuesto.alertas} tono={tono} />
      <p className="meta" style={{ margin: tr('6px 0 0') }}>
        {tr("Cuenta todas las llamadas al modelo de la corrida: el plan, los pasos de cada iteración y el juez. El presupuesto que aparece en cada iteración cuenta solo las llamadas de sus pasos, por eso es más pequeño.")}
      </p>
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <span className="meta">
          {pausada
            ? tr('Tope alcanzado: la corrida está pausada, no muerta. Amplia el tope para seguir.')
            : p.msHastaTope !== null
              ? `Al ritmo actual llegas al tope en ${formatearDuracion(p.msHastaTope)}. Una pregunta pendiente tiene prioridad sobre el tope.`
              : tr('Sin ritmo medible todavía.')}
        </span>
        {corrida.presupuesto.avisadas.map((a) => (
          <Chip key={a} tono={a >= 0.8 ? 'mal' : 'aviso'}>
            avisado al {Math.round(a * 100)} %
          </Chip>
        ))}
      </div>
      <div className="dirigir">
        <input className="entrada entrada-s" type="number" min={corrida.gasto.llamadas + 1} step={100} value={nuevo} onChange={(e) => setNuevo(e.target.value)} aria-label={tr("Nuevo tope de llamadas")} style={{ maxWidth: 160 }} />
        <button type="button" className={`btn ${pausada ? 'btn-primario' : ''}`} disabled={!(Number(nuevo) > corrida.gasto.llamadas)} onClick={() => onAmpliar(Number(nuevo))}>
          {pausada ? tr('Ampliar y reanudar') : tr('Ampliar tope')}
        </button>
      </div>
    </div>
  );
}
