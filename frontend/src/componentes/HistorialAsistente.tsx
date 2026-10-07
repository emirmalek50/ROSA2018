import { useMemo, useRef, useState } from 'react';
import type { PreguntaHistorial, ReferenciaConversacion } from '../lib/conversacionesAsistente';
import { idiomaActual, tr } from '../lib/idioma';

export function HistorialAsistente({ preguntas, conversacion, alElegir, disabled = false }: {
  preguntas: PreguntaHistorial[]; conversacion: ReferenciaConversacion | null;
  alElegir: (referencia: ReferenciaConversacion) => void; disabled?: boolean;
}) {
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [limite, setLimite] = useState(30);
  const conversaciones = useMemo(() => {
    const grupos = new Map<string, ReferenciaConversacion & { clave: string; titulo: string; fecha: number; primera: number; cantidad: number; coincide: boolean }>();
    const consulta = busqueda.trim().toLocaleLowerCase();
    for (const q of preguntas) {
      const hilo = q.hilo || q.id;
      const clave = JSON.stringify([q.investigacionId, hilo]);
      const coincide = !consulta || `${q.pregunta} ${q.respuesta}`.toLocaleLowerCase().includes(consulta);
      const grupo = grupos.get(clave);
      if (grupo) {
        grupo.fecha = Math.max(grupo.fecha, q.fecha);
        grupo.cantidad++;
        grupo.coincide ||= coincide;
        if (q.fecha < grupo.primera) { grupo.primera = q.fecha; grupo.titulo = q.pregunta; }
      } else grupos.set(clave, { clave, investigacionId: q.investigacionId, hilo, titulo: q.pregunta, fecha: q.fecha, primera: q.fecha, cantidad: 1, coincide });
    }
    return [...grupos.values()].filter(g => g.coincide).sort((a, b) => b.fecha - a.fecha);
  }, [preguntas, busqueda]);
  return <div className="mundo-historial" onKeyDown={ev => { if (ev.key === 'Escape') { setAbierto(false); boton.current?.focus(); } }}>
    <button ref={boton} type="button" className="btn btn-s" disabled={disabled} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{tr('Conversaciones anteriores')}</button>
    {abierto && <section aria-label={tr('Historial de conversaciones')} className="mundo-historial-panel">
      <label>{tr('Buscar conversación')}<input type="search" value={busqueda} onChange={ev => { setBusqueda(ev.target.value); setLimite(30); }} /></label>
      {conversaciones.length === 0 && <p>{tr('No hay conversaciones que coincidan.')}</p>}
      <ul>{conversaciones.slice(0, limite).map(c => <li key={c.clave}>
        <button type="button" disabled={disabled} aria-current={conversacion?.hilo === c.hilo && conversacion.investigacionId === c.investigacionId ? 'true' : undefined} onClick={() => { alElegir({ investigacionId: c.investigacionId, hilo: c.hilo }); setAbierto(false); }}>
          <strong>{c.titulo}</strong><span>{new Date(c.fecha).toLocaleDateString(idiomaActual())} · {c.cantidad} {tr(c.cantidad === 1 ? 'mensaje' : 'mensajes')}</span>
        </button>
      </li>)}</ul>
      {limite < conversaciones.length && <button type="button" className="btn btn-s" onClick={() => setLimite(limite + 30)}>{tr('Ver más conversaciones')}</button>}
    </section>}
  </div>;
}
