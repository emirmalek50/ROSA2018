// La cara de ROSA2018: un orbe que dice en qué está sin escribirlo. La idea
// es del componente `persona` de AI Elements de Vercel, con sus mismos
// estados (quieta, escuchando, pensando, hablando, dormida).
//
// Por qué NO se usa el de Vercel: aquel lo dibuja Rive, que son 5,9 MB de
// WASM y un cuarto contexto WebGL en una interfaz que ya tiene tres (Atlas3D,
// Cerebro3D y molstar); los contextos de WebGL se agotan y el propio código
// de AI Elements lleva un apaño para eso. Y sus animaciones se descargan de
// un almacenamiento de Vercel en tiempo de ejecución, lo que ata a ROSA2018 a
// una URL de fuera para pintar su propia cara, en una máquina que puede estar
// sin internet. Esto son dos círculos y un SVG: 0 dependencias, 0 peticiones.
//
// Los estados se leen de un vistazo y es lo único que importa de este
// componente: quien mira tiene que saber si ROSA2018 le está escuchando, está
// trabajando o está esperando, sin leer nada.

import { motion } from 'motion/react';

import { traducido, tr } from '../lib/idioma';
import { useMovimientoReducido } from '../lib/movimiento';

export type EstadoPersona = 'quieta' | 'escuchando' | 'pensando' | 'hablando' | 'dormida';

const QUE_HACE: Record<EstadoPersona, string> = traducido({
  quieta: 'ROSA2018 está lista',
  escuchando: 'ROSA2018 está escuchando',
  pensando: 'ROSA2018 está pensando',
  hablando: 'ROSA2018 está respondiendo',
  dormida: 'ROSA2018 está en reposo',
});

/** Cada estado con su movimiento. La duración y la escala son lo que
 *  distingue uno de otro: pensar va rápido y apretado, hablar va amplio. */
const MOVIMIENTO: Record<EstadoPersona, { escala: number[]; giro: number; duracion: number; opacidad: number[] }> = {
  quieta: { escala: [1, 1.03, 1], giro: 26, duracion: 5.2, opacidad: [0.85, 1, 0.85] },
  escuchando: { escala: [1, 1.07, 1], giro: 16, duracion: 2.4, opacidad: [0.9, 1, 0.9] },
  pensando: { escala: [1, 1.05, 0.98, 1.05, 1], giro: 5, duracion: 1.5, opacidad: [1, 0.78, 1] },
  hablando: { escala: [1, 1.12, 0.96, 1.1, 1], giro: 9, duracion: 0.9, opacidad: [1, 0.9, 1] },
  dormida: { escala: [1, 1.015, 1], giro: 60, duracion: 7.5, opacidad: [0.45, 0.6, 0.45] },
};

/** `marca`: el árbol del Alzheimer Project en el centro. Es la marca gráfica
 *  de ROSA2018 y no se sustituye por el orbe: el orbe pasa a ser su aura, que
 *  es lo que se mueve. */
export function Persona({ estado = 'quieta', tamano = 44, className = '', marca = false }: { estado?: EstadoPersona; tamano?: number; className?: string; marca?: boolean }) {
  const reducido = useMovimientoReducido();
  const m = MOVIMIENTO[estado];
  const comun = { repeat: Infinity, duration: m.duracion, ease: 'easeInOut' as const };
  return (
    <span
      className={`persona persona-${estado} ${className}`.trim()}
      style={{ width: tamano, height: tamano }}
      role="img"
      aria-label={tr(QUE_HACE[estado])}
      title={tr(QUE_HACE[estado])}
    >
      {/* El halo: solo cuando escucha o habla, que es cuando hay alguien al
          otro lado. Pensando no lo lleva, para no confundir «te atiende» con
          «está ocupada». */}
      {!reducido && (estado === 'escuchando' || estado === 'hablando') && (
        <motion.i
          className="persona-halo"
          initial={{ scale: 0.8, opacity: 0.5 }}
          animate={{ scale: [0.8, 1.45], opacity: [0.45, 0] }}
          transition={{ repeat: Infinity, duration: estado === 'hablando' ? 1.1 : 2 , ease: 'easeOut' }}
        />
      )}
      <motion.span
        className="persona-orbe"
        animate={reducido ? {} : { scale: m.escala, opacity: m.opacidad }}
        transition={comun}
      >
        <motion.svg viewBox="0 0 100 100" aria-hidden="true" animate={reducido ? {} : { rotate: 360 }} transition={{ repeat: Infinity, duration: m.giro, ease: 'linear' }}>
          <defs>
            <radialGradient id="persona-nucleo" cx="38%" cy="32%">
              <stop offset="0%" stopColor="var(--accent-contrast, #fff)" stopOpacity="0.95" />
              <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--accent-strong, var(--accent))" stopOpacity="1" />
            </radialGradient>
            <radialGradient id="persona-brillo" cx="50%" cy="50%">
              <stop offset="55%" stopColor="transparent" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="url(#persona-nucleo)" />
          {/* Dos lóbulos girando: dan la sensación de que algo se mueve
              dentro, sin dibujar una cara. */}
          <ellipse cx="50" cy="34" rx="30" ry="19" fill="var(--accent-contrast, #fff)" opacity="0.14" />
          <ellipse cx="50" cy="68" rx="24" ry="14" fill="var(--bg)" opacity="0.12" />
          <circle cx="50" cy="50" r="46" fill="url(#persona-brillo)" />
        </motion.svg>
      </motion.span>
      {marca && (
        // Un disco oscuro debajo del arbol: el arbol es morado y sobre el
        // orbe morado no se leia. Asi el orbe queda como un aro de luz
        // alrededor, que es lo que respira.
        <span className="persona-disco" aria-hidden="true" />
      )}
      {marca && (
        // El arbol no gira con el orbe: una marca que da vueltas deja de
        // leerse. Solo respira con el, un poco menos.
        <motion.img
          className="persona-marca"
          src="/arbol-marca.png"
          alt=""
          aria-hidden="true"
          animate={reducido ? {} : { scale: m.escala.map((x) => 1 + (x - 1) * 0.5) }}
          transition={comun}
        />
      )}
    </span>
  );
}
