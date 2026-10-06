import { useMemo, useRef, useState } from 'react';
import type { PreguntaABases } from '../datos/tipos';
import { idiomaActual, tr } from '../lib/idioma';

export function HistorialAsistente({ preguntas, hilo, alElegir, disabled = false }: {
  preguntas: PreguntaABases[]; hilo: string | null; alElegir: (id: string) => void; disabled?: boolean;
}) {
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [limite, setLimite] = useState(30);
  const conversaciones = useMemo(() => {
    const grupos = new Map<string, { id: string; titulo: string; fecha: number; primera: number; cantidad: number; coincide: boolean }>();
    const consulta = busqueda.trim().toLocaleLowerCase();
    for (const q of preguntas) {
      const id = q.hilo || q.id;
      const coincide = !consulta || `${q.pregunta} ${q.respuesta}`.toLocaleLowerCase().includes(consulta);
      const grupo = grupos.get(id);
      if (grupo) {
        grupo.fecha = Math.max(grupo.fecha, q.fecha);
        grupo.cantidad++;
        grupo.coincide ||= coincide;
        if (q.fecha < grupo.primera) { grupo.primera = q.fecha; grupo.titulo = q.pregunta; }
      } else grupos.set(id, { id, titulo: q.pregunta, fecha: q.fecha, primera: q.fecha, cantidad: 1, coincide });
    }
    return [...grupos.values()].filter(g => g.coincide).sort((a, b) => b.fecha - a.fecha);
  }, [preguntas, busqueda]);
  return <div className="mundo-historial" onKeyDown={ev => { if (ev.key === 'Escape') { setAbierto(false); boton.current?.focus(); } }}>
    <button ref={boton} type="button" className="btn btn-s" disabled={disabled} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{tr('Conversaciones anteriores')}</button>
    {abierto && <section aria-label={tr('Historial de conversaciones')} className="mundo-historial-panel">
      <label>{tr('Buscar conversación')}<input type="search" value={busqueda} onChange={ev => { setBusqueda(ev.target.value); setLimite(30); }} /></label>
      {conversaciones.length === 0 && <p>{tr('No hay conversaciones que coincidan.')}</p>}
      <ul>{conversaciones.slice(0, limite).map(c => <li key={c.id}>
        <button type="button" disabled={disabled} aria-current={hilo === c.id ? 'true' : undefined} onClick={() => { alElegir(c.id); setAbierto(false); }}>
          <strong>{c.titulo}</strong><span>{new Date(c.fecha).toLocaleDateString(idiomaActual())} · {c.cantidad} {tr(c.cantidad === 1 ? 'mensaje' : 'mensajes')}</span>
        </button>
      </li>)}</ul>
      {limite < conversaciones.length && <button type="button" className="btn btn-s" onClick={() => setLimite(limite + 30)}>{tr('Ver más conversaciones')}</button>}
    </section>}
  </div>;
}
