import { tr } from '../lib/idioma';
import { veredictoDe } from '../lib/etiquetas';
import type { EstadoCharla, TurnoLaboratorio } from '../lib/conversacionesLaboratorio';
import './labvivo/conversaciones.css';

const ESTADO: Record<EstadoCharla, string> = {
  cargando: 'Conectando las conversaciones', conversando: 'Preparando el siguiente intercambio',
  esperando_hallazgos: 'Esperan nuevos hallazgos', pausada: 'Conversaciones en pausa',
  sin_presupuesto: 'Presupuesto reservado para la investigación', no_disponible: 'Las conversaciones no están disponibles',
};
export function ConversacionesLaboratorio({ estado, turnos, activo, onCambiar }: { estado: EstadoCharla; turnos: TurnoLaboratorio[]; activo: boolean; onCambiar: (activo: boolean) => void }) {
  return <section className="lab-charlas" aria-label={tr('Conversaciones del laboratorio')}>
    <div className="lab-charlas-cab">
      <div><h3>{tr('Conversaciones del laboratorio')}</h3><p role="status">{tr(ESTADO[estado])}</p></div>
      <label><input type="checkbox" checked={activo} onChange={(e) => onCambiar(e.target.checked)} />{tr('Conversaciones de IA')}</label>
    </div>
    <p className="lab-charlas-nota">{tr('Comentan los hallazgos reales y responden a sus compañeros. Sus interpretaciones no cambian los resultados de la investigación.')}</p>
    {turnos.length === 0 ? <p className="lab-charlas-vacia">{tr('La próxima conversación aparecerá cuando haya un hallazgo que comentar.')}</p> : <ol>
      {turnos.slice(-12).map((t) => <li key={t.id} data-turno={t.id}>
        <div className="lab-charlas-quien"><strong>{tr(t.agente)}</strong><span>→ {tr(t.destinatario)}</span></div>
        <p>{t.texto}</p>
        <details><summary>{tr('Ver lo que leyeron')}</summary>{t.materiales.map((m) => <div className="lab-charlas-fuente" key={m.id}>
          <strong>{m.titulo || (m.clase === 'registro' ? tr('Registro de la corrida') : tr('Afirmación de la corrida'))}</strong>
          <p>{m.texto}</p>{m.cita && <p>{m.cita}</p>}{m.fragmento && <blockquote>{m.fragmento}</blockquote>}
          {m.veredicto && <small>{veredictoDe(m.veredicto).etiqueta}</small>}
        </div>)}</details>
      </li>)}
    </ol>}
  </section>;
}
