// Comentarios anclados, como en Claude Science: la investigadora selecciona
// un tramo del enunciado, del mecanismo o de una afirmacion, escribe una
// linea, y el comentario queda pendiente. Guardar no envia: los pendientes se
// acumulan en una bandeja, se pueden editar o quitar, y salen todos con el
// siguiente mensaje a ROSA2018.

import { useCallback, useEffect, useState } from 'react';
import type { AnclaComentario, Comentario } from '../datos/tipos';
import { IconMessage, IconPen, IconX } from './icons';
import { tr, trp } from '../lib/idioma';

const TOPE = 1000;

function campoDe(nodo: Node | null): AnclaComentario['campo'] | null {
  let actual: Node | null = nodo;
  while (actual !== null) {
    if (actual instanceof HTMLElement && actual.dataset.campo) {
      const c = actual.dataset.campo;
      if (c === 'enunciado' || c === 'mecanismo' || c === 'afirmacion' || c === 'comprobacion' || c === 'fuente') return c;
    }
    actual = actual.parentNode;
  }
  return null;
}

export function useSeleccionComentable(contenedor: React.RefObject<HTMLElement>): [AnclaComentario | null, () => void] {
  const [ancla, setAncla] = useState<AnclaComentario | null>(null);
  useEffect(() => {
    const alSoltar = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const rango = sel.getRangeAt(0);
      if (!contenedor.current?.contains(rango.commonAncestorContainer)) return;
      const campo = campoDe(rango.commonAncestorContainer);
      if (campo === null) return;
      const cita = sel.toString().trim().replace(/\s+/g, ' ');
      if (cita.length < 3) return;
      setAncla({ cita: cita.length > 240 ? `${cita.slice(0, 237)}...` : cita, campo });
    };
    document.addEventListener('mouseup', alSoltar);
    document.addEventListener('keyup', alSoltar);
    return () => {
      document.removeEventListener('mouseup', alSoltar);
      document.removeEventListener('keyup', alSoltar);
    };
  }, [contenedor]);
  const limpiar = useCallback(() => setAncla(null), []);
  return [ancla, limpiar];
}

export function NuevoComentario({ ancla, onGuardar, onCancelar }: { ancla: AnclaComentario; onGuardar: (nota: string) => void; onCancelar: () => void }) {
  const [nota, setNota] = useState('');
  return (
    <div className="comentario-nuevo" role="dialog" aria-label={tr("Nuevo comentario")}>
      <q>{ancla.cita}</q>
      <textarea
        className="entrada"
        value={nota}
        maxLength={TOPE}
        placeholder={tr("Qué quieres decirle a ROSA2018 sobre este tramo")}
        onChange={(e) => setNota(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && nota.trim() !== '') {
            e.preventDefault();
            onGuardar(nota);
          }
        }}
        autoFocus
        rows={2}
      />
      <div className="acciones">
        <button type="button" className="btn btn-primario btn-s" disabled={nota.trim() === ''} onClick={() => onGuardar(nota)}>
          Guardar comentario
        </button>
        <button type="button" className="btn btn-fantasma btn-s" onClick={onCancelar}>
          Cancelar
        </button>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          {trp("Enter guarda, Shift+Enter salta de línea · {nota} / {TOPE}", { nota: nota.length, TOPE })}
        </span>
      </div>
    </div>
  );
}

function Pendiente({ c, onQuitar, onEditar }: { c: Comentario; onQuitar: () => void; onEditar: (nota: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState(c.nota);
  return (
    <li className="comentario-pendiente">
      <div>
        <q>{c.ancla.cita}</q>
        {editando ? (
          <textarea
            className="entrada"
            value={nota}
            rows={2}
            maxLength={TOPE}
            onChange={(e) => setNota(e.target.value)}
            onBlur={() => {
              if (nota.trim() !== '') onEditar(nota);
              else setNota(c.nota);
              setEditando(false);
            }}
            autoFocus
            aria-label={tr("Editar comentario")}
          />
        ) : (
          c.nota
        )}
      </div>
      <div className="acciones" style={{ gap: 2 }}>
        <button type="button" className="btn btn-fantasma btn-icono btn-s" aria-label={tr("Editar comentario")} onClick={() => setEditando(true)}>
          <IconPen size={12} />
        </button>
        <button type="button" className="btn btn-fantasma btn-icono btn-s" aria-label={tr("Quitar comentario")} onClick={onQuitar}>
          <IconX size={12} />
        </button>
      </div>
    </li>
  );
}

export function BandejaComentarios({
  pendientes,
  onQuitar,
  onEditar,
  onEnviar,
}: {
  pendientes: Comentario[];
  onQuitar: (id: string) => void;
  onEditar: (id: string, nota: string) => void;
  onEnviar: (mensaje: string) => void;
}) {
  const [mensaje, setMensaje] = useState('');
  if (pendientes.length === 0) return null;
  return (
    <div className="comentarios-pendientes" aria-live="polite">
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IconMessage size={14} />
          {(pendientes.length === 1 ? trp("{pendientes} comentario pendiente", { pendientes: pendientes.length }) : trp("{pendientes} comentarios pendientes", { pendientes: pendientes.length }))}
        </strong>
        <span className="meta">{tr("Salen juntos con el siguiente mensaje")}</span>
      </div>
      <ul className="lista-limpia">
        {pendientes.map((c) => (
          <Pendiente key={c.id} c={c} onQuitar={() => onQuitar(c.id)} onEditar={(n) => onEditar(c.id, n)} />
        ))}
      </ul>
      <div className="dirigir">
        <textarea className="entrada" value={mensaje} placeholder={tr("Mensaje para ROSA2018 (opcional)")} onChange={(e) => setMensaje(e.target.value)} rows={1} />
        <button
          type="button"
          className="btn btn-primario"
          onClick={() => {
            onEnviar(mensaje);
            setMensaje('');
          }}
        >
          Enviar a ROSA2018
        </button>
      </div>
    </div>
  );
}
