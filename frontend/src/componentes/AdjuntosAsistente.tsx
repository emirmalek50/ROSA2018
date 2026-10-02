import { useState } from 'react';
import { acciones, useRosa } from '../datos/almacen';
import { tr } from '../lib/idioma';

/** Carga por los endpoints del laboratorio: el fichero no entra en el prompt. */
export function AdjuntosAsistente({ investigacionId, alSubir, disabled = false }: {
  investigacionId: string; alSubir: (texto: string) => void; disabled?: boolean;
}) {
  const e = useRosa();
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState('dataset');
  const [fichero, setFichero] = useState<File | null>(null);
  const [sintetico, setSintetico] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const hipotesis = e.hipotesis.filter(h => h.investigacionId === investigacionId && h.experimento);
  const subir = async () => {
    if (!fichero || ocupado) return;
    setOcupado(true);
    setAviso('');
    try {
      const error = destino === 'dataset'
        ? await acciones.subirDataset(investigacionId, fichero, fichero.name, '', sintetico)
        : await acciones.subirDatosExperimento(destino, fichero, '', sintetico);
      if (error) { setAviso(error); return; }
      setAviso(tr('Archivo guardado en ROSA.'));
      alSubir(destino === 'dataset'
        ? `Acabo de subir el dataset «${fichero.name}» a esta investigación. Revisa su ficha y dime qué falta para poder analizarlo.`
        : `Acabo de subir «${fichero.name}» como resultados del experimento ${destino}. Revisa su estado y los siguientes pasos.`);
      setFichero(null);
      setAbierto(false);
    } catch { setAviso(tr('No se pudo subir el archivo. Comprueba la conexión.')); }
    finally { setOcupado(false); }
  };
  return <div className="mundo-adjuntos">
    <button type="button" className="mundo-accion" disabled={disabled || ocupado} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{tr('Adjuntar datos')}</button>
    {abierto && <fieldset disabled={ocupado || disabled}>
      <legend>{tr('Guardar archivo en ROSA')}</legend>
      <label>{tr('Destino')}<select value={destino} onChange={ev => setDestino(ev.target.value)}>
        <option value="dataset">{tr('Dataset de esta investigación')}</option>
        {hipotesis.map(h => <option key={h.id} value={h.id}>{tr('Resultados experimentales')}: {h.titulo}</option>)}
      </select></label>
      <label>{tr('Archivo')}<input type="file" onChange={ev => setFichero(ev.target.files?.[0] ?? null)} /></label>
      <label><input type="checkbox" checked={sintetico} onChange={ev => setSintetico(ev.target.checked)} />{tr('Son datos sintéticos de prueba')}</label>
      <p>{tr('Los datasets conservan su libro de procedencia y requieren aprobación antes de analizarlos. Los resultados experimentales se contrastan con el prerregistro.')}</p>
      <button type="button" className="mundo-accion" disabled={!fichero} onClick={() => void subir()}>{tr(ocupado ? 'Guardando…' : 'Guardar archivo')}</button>
    </fieldset>}
    {aviso && <p role="status">{aviso}</p>}
  </div>;
}
