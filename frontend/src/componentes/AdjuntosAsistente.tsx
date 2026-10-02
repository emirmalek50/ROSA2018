import { useState } from 'react';
import { acciones, useRosa } from '../datos/almacen';
import { tr } from '../lib/idioma';

/** Carga por los endpoints del laboratorio: el fichero no entra en el prompt. */
export function AdjuntosAsistente({ investigacionId, alSubir, disabled = false }: {
  investigacionId: string; alSubir: (texto: string) => void; disabled?: boolean;
}) {
  const e = useRosa();
  const [abierto, setAbierto] = useState(false);
  const [investigacionElegida, setInvestigacionElegida] = useState('');
  const investigacionDestino = investigacionId === 'global' ? investigacionElegida : investigacionId;
  const investigaciones = e.investigaciones ?? [];
  const investigacion = investigaciones.find(i => i.id === investigacionDestino);
  const [destino, setDestino] = useState('dataset');
  const [fichero, setFichero] = useState<File | null>(null);
  const [sintetico, setSintetico] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const hipotesis = e.hipotesis.filter(h => h.investigacionId === investigacionDestino && h.experimento);
  const subir = async () => {
    if (!fichero || ocupado) return;
    if (!investigacion || (destino !== 'dataset' && !hipotesis.some(h => h.id === destino))) { setAviso(tr('Elige una investigación y un destino disponibles.')); return; }
    setOcupado(true);
    setAviso('');
    try {
      const error = destino === 'dataset'
        ? await acciones.subirDataset(investigacionDestino, fichero, fichero.name, '', sintetico)
        : await acciones.subirDatosExperimento(destino, fichero, '', sintetico);
      if (error) { setAviso(error); return; }
      setAviso(tr('Archivo guardado en ROSA.'));
      alSubir(destino === 'dataset'
        ? `Acabo de subir el dataset «${fichero.name}» a la investigación «${investigacion.titulo}» (${investigacionDestino}). Revisa su ficha y dime qué falta para poder analizarlo.`
        : `Acabo de subir «${fichero.name}» como resultados del experimento ${destino}, investigación ${investigacionDestino}. Revisa su estado y los siguientes pasos.`);
      setFichero(null);
      setAbierto(false);
    } catch { setAviso(tr('No se pudo subir el archivo. Comprueba la conexión.')); }
    finally { setOcupado(false); }
  };
  return <div className="mundo-adjuntos">
    <button type="button" className="mundo-accion" disabled={disabled || ocupado} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{tr('Adjuntar datos')}</button>
    {abierto && <fieldset disabled={ocupado || disabled}>
      <legend>{tr('Guardar archivo en ROSA')}</legend>
      {investigacionId === 'global' && <label>{tr('Investigación destinataria')}<select aria-label={tr('Investigación destinataria')} value={investigacionElegida} onChange={ev => { setInvestigacionElegida(ev.target.value); setDestino('dataset'); setAviso(''); }}>
        <option value="">{tr('Elige una investigación')}</option>
        {investigaciones.map(i => <option key={i.id} value={i.id}>{i.titulo}</option>)}
      </select></label>}
      {investigacionId === 'global' && investigaciones.length === 0 && <p>{tr('Crea una investigación para guardar estos datos.')} <a href="#/nueva">{tr('Crear investigación')}</a></p>}
      <label>{tr('Destino')}<select aria-label={tr('Destino')} value={destino} onChange={ev => setDestino(ev.target.value)}>
        <option value="dataset">{tr('Dataset de esta investigación')}</option>
        {hipotesis.map(h => <option key={h.id} value={h.id}>{tr('Resultados experimentales')}: {h.titulo}</option>)}
      </select></label>
      <label>{tr('Archivo')}<input type="file" onChange={ev => setFichero(ev.target.files?.[0] ?? null)} /></label>
      <label><input type="checkbox" checked={sintetico} onChange={ev => setSintetico(ev.target.checked)} />{tr('Son datos sintéticos de prueba')}</label>
      <p>{tr('Los datasets conservan su libro de procedencia y requieren aprobación antes de analizarlos. Los resultados experimentales se contrastan con el prerregistro.')}</p>
      <button type="button" className="mundo-accion" disabled={!fichero || !investigacion} onClick={() => void subir()}>{tr(ocupado ? 'Guardando…' : 'Guardar archivo')}</button>
    </fieldset>}
    {aviso && <p role="status">{aviso}</p>}
  </div>;
}
