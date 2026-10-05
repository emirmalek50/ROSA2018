import { useEffect, useRef, useState } from 'react';
import { acciones } from '../datos/almacen';
import type { AccionAsistente } from '../datos/tipos';
import { tr } from '../lib/idioma';

const nombres: Record<string, string> = {
  investigacion_id: tr('Investigación'), corrida_id: 'Corrida', hipotesis_id: tr('Hipótesis'),
  datos: tr('Datos de la investigación'), titulo: tr('Título'), objetivo: 'Objetivo',
  condicionParada: tr('Condición de parada'), limites: tr('Límites'), limite: tr('Límite de llamadas'),
  parada: tr('Condición de parada'), motivo: 'Motivo', decision: tr('Decisión'),
  mision: tr('Misión'), texto: 'Texto', plan: 'Plan', configuracion: tr('Configuración'),
  hilo: tr('Conversación'), mensajes: tr('Mensajes'), turnos: tr('Mensajes incluidos'),
};
function Detalle({ valor }: { valor: unknown }) {
  if (valor === null || valor === undefined) return <span>{tr('Sin especificar')}</span>;
  if (typeof valor === 'boolean') return <span>{tr(valor ? 'Sí' : 'No')}</span>;
  if (Array.isArray(valor)) return <ul>{valor.map((x, i) => <li key={i}><Detalle valor={x} /></li>)}</ul>;
  if (typeof valor === 'object') return <dl>{Object.entries(valor).map(([k, v]) => <div key={k}><dt>{tr(nombres[k] ?? k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1'))}</dt><dd><Detalle valor={v} /></dd></div>)}</dl>;
  return <span>{String(valor)}</span>;
}

export function AccionesAsistente({ investigacionId, preguntaId, operaciones }: {
  investigacionId: string; preguntaId: string; operaciones: AccionAsistente[];
}) {
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, { estado?: string; resultado?: unknown; error?: string }>>({});
  const resolver = async (op: AccionAsistente, aprobar: boolean, modo?: 'continuar' | 'comprobar') => {
    if (ocupada) return;
    setOcupada(op.id);
    try {
      const r = await acciones.resolverAccionAsistente(investigacionId, preguntaId, op.id, aprobar, modo);
      setResultados(prev => ({ ...prev, [op.id]: r }));
    } finally { setOcupada(null); }
  };
  const revisadas = useRef(new Set<string>());
  useEffect(() => {
    const op = operaciones.find(o => !revisadas.current.has(o.id) && ((o.estado === 'resultado_desconocido' && !o.comprobadaEn) || o.continuacion === 'pendiente'));
    if (!op || ocupada) return;
    revisadas.current.add(op.id);
    void resolver(op, false, op.estado === 'resultado_desconocido' ? 'comprobar' : 'continuar');
  }, [operaciones, ocupada]);
  return <section className="mundo-operaciones" aria-label={tr('Acciones de ROSA')}>
    {operaciones.map(op => {
      const local = resultados[op.id];
      const estado = op.estado !== 'pendiente' ? op.estado : local?.estado ?? op.estado;
      return <div className="mundo-operacion" key={op.id}>
        <strong>{op.resumen}</strong>
        <details><summary>{tr('Ver el cambio antes de aplicarlo')}</summary><Detalle valor={op.argumentos} />{op.contexto !== undefined && <details><summary>{tr('Estado que se está revisando')}</summary><Detalle valor={op.contexto} /></details>}</details>
        {estado === 'pendiente' ? <div className="mundo-respuesta-acciones">
          <button type="button" className="mundo-accion" disabled={!!ocupada} onClick={() => void resolver(op, true)}>{tr(ocupada === op.id ? 'Aplicando…' : op.nombre === 'eliminarConversacion' ? 'Eliminar conversación' : op.nombre === 'eliminarInvestigacion' ? 'Eliminar investigación' : 'Aplicar cambio')}</button>
          <button type="button" className="mundo-accion" disabled={!!ocupada} onClick={() => void resolver(op, false)}>{tr('Cancelar')}</button>
        </div> : <p role="status">{tr(estado === 'ejecutada' ? 'Cambio aplicado en ROSA.' : estado === 'cancelada' ? 'Operación cancelada.' : estado === 'resultado_desconocido' ? 'No se pudo comprobar el resultado. Consulta el estado de ROSA antes de repetir la operación.' : estado === 'en_curso' ? 'Operación iniciada. Si se interrumpe la conexión, comprueba su resultado antes de repetirla.' : 'No se aplicó: el estado actual o las reglas de ROSA no lo permiten.')}</p>}
        {(local?.resultado ?? op.comprobacion ?? op.resultado) !== undefined && (estado === 'ejecutada' || estado === 'no_aplicada' || estado === 'resultado_desconocido') && <details><summary>{tr('Resultado registrado')}</summary><Detalle valor={local?.resultado ?? op.comprobacion ?? op.resultado} /></details>}
        {op.continuacion === 'en_curso' && <p role="status">{tr('ROSA está continuando con tu petición…')}</p>}
        {op.continuacion === 'error' && <button type="button" disabled={!!ocupada} onClick={() => void resolver(op, false, 'continuar')}>{tr('Reintentar continuación sin repetir el cambio')}</button>}
        {estado === 'resultado_desconocido' && <button type="button" disabled={!!ocupada} onClick={() => void resolver(op, false, 'comprobar')}>{tr('Comprobar estado sin repetir')}</button>}
        {local?.error && <p role="alert">{local.error}</p>}
      </div>;
    })}
  </section>;
}
