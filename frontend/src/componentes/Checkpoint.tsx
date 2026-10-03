// El punto del hilo en el que ROSA2018 se guardó algo tuyo. La idea es del
// componente `checkpoint` de AI Elements de Vercel: una marca horizontal que
// parte la conversación y dice que ahí pasó algo que se conserva.
//
// Qué guarda ROSA2018, que ya existía y no se veía: la memoria del proyecto
// (`inv.memoria`, rosa/estado/acciones.py anadir_memoria). Son hechos cortos
// y estables que ROSA2018 relee en cada misión: tu nombre, cómo prefieres que
// te responda, una restricción, una decisión ya tomada. Estaba enterrada en
// una lista de ajustes; ahora se marca en el hilo, donde pasó.
//
// Dos reglas que se respetan aquí:
// - Lo guarda una PERSONA, nunca ROSA2018 por su cuenta. El botón te lo
//   propone y tú decides, que es la misma regla de las hipótesis.
// - Se puede deshacer. Una memoria que no se puede quitar no es una
//   preferencia, es una condena.

import { useState } from 'react';
import { motion } from 'motion/react';

import { IconBookmark, IconX } from './icons';
import type { MemoriaProyecto } from '../datos/tipos';
import { Momento } from './piezas';
import { tr } from '../lib/idioma';
import { DUR, useMovimientoReducido } from '../lib/movimiento';

/** La marca en el hilo: qué se guardó y cuándo, con la raya que lo separa
 *  de lo de antes. */
export function Checkpoint({ m, ahora, alQuitar }: { m: MemoriaProyecto; ahora: number; alQuitar?: () => void }) {
  const reducido = useMovimientoReducido();
  return (
    <motion.div
      className="hito"
      initial={reducido ? { opacity: 0 } : { opacity: 0, scaleX: 0.9 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ duration: DUR.media }}
    >
      <span className="hito-icono" aria-hidden="true">
        <IconBookmark size={13} />
      </span>
      <span className="hito-texto">
        <span className="hito-ceja">{tr('ROSA2018 se guardó esto')}</span>
        <span className="hito-que">{m.texto}</span>
      </span>
      <span className="meta hito-cuando">
        <Momento t={m.fecha} ahora={ahora} />
      </span>
      {alQuitar && (
        <button type="button" className="hito-quitar" onClick={alQuitar} title={tr('Que ROSA2018 deje de recordarlo')} aria-label={tr('Que ROSA2018 deje de recordarlo')}>
          <IconX size={12} />
        </button>
      )}
      <span className="hito-raya" aria-hidden="true" />
    </motion.div>
  );
}

/** El botón de guardar, al pie de una respuesta. Propone el texto y lo
 *  decides tú: ROSA2018 no se guarda nada sola. */
export function GuardarEnMemoria({ propuesta, alGuardar }: { propuesta: string; alGuardar: (texto: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(propuesta);
  if (!abierto) {
    return (
      <button type="button" className="mundo-accion" title={tr('Que lo recuerde')} onClick={() => { setTexto(propuesta); setAbierto(true); }}>
        <IconBookmark size={15} /> <span className="mundo-accion-nombre">{tr('Que lo recuerde')}</span>
      </button>
    );
  }
  return (
    <div className="hito-editor">
      <label htmlFor="hito-texto">{tr('Qué quieres que ROSA2018 recuerde de aquí en adelante')}</label>
      <textarea
        id="hito-texto"
        rows={2}
        value={texto}
        maxLength={400}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={tr('Por ejemplo: me llamo Emir, prefiero que me respondas en llano y sin rodeos')}
      />
      <p className="meta">{tr('Lo relee en cada misión. Son hechos cortos y estables, no resultados.')}</p>
      <div className="acciones">
        <button type="button" className="btn btn-primario btn-s" disabled={texto.trim().length === 0} onClick={() => { alGuardar(texto.trim()); setAbierto(false); }}>
          {tr('Guardar')}
        </button>
        <button type="button" className="btn btn-fantasma btn-s" onClick={() => setAbierto(false)}>
          {tr('Cancelar')}
        </button>
      </div>
    </div>
  );
}
