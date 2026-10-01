// El árbol vivo de la pantalla de acceso: un árbol de conocimiento en SVG,
// con el tronco (el objetivo), tres ramas, hojas (hipótesis) y, alrededor, lo
// que las sostiene (fuentes, hechos, un experimento). Cada tres segundos se
// ilumina la parte del árbol que corresponde a una etapa del proceso de ROSA2018
// y cambia la frase de abajo: quien llega por primera vez ve qué hace ROSA2018
// antes de entrar. Los nodos se balancean despacio, como en la pantalla del
// Árbol. Con movimiento reducido no hay balanceo ni cambio de etapa.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useMovimientoReducido } from '../lib/movimiento';
import { traducido, tr } from '../lib/idioma';

type Tipo = 'objetivo' | 'rama' | 'hipotesis' | 'hecho' | 'fuente' | 'experimento';

interface Nodo {
  id: string;
  tipo: Tipo;
  x: number;
  y: number;
  r: number;
}

const NODOS: Nodo[] = [
  { id: 'objetivo', tipo: 'objetivo', x: 180, y: 372, r: 22 },
  { id: 'r1', tipo: 'rama', x: 96, y: 282, r: 11 },
  { id: 'r2', tipo: 'rama', x: 186, y: 250, r: 12 },
  { id: 'r3', tipo: 'rama', x: 272, y: 286, r: 11 },
  { id: 'h1', tipo: 'hipotesis', x: 52, y: 196, r: 9 },
  { id: 'h2', tipo: 'hipotesis', x: 118, y: 176, r: 10 },
  { id: 'h3', tipo: 'hipotesis', x: 176, y: 150, r: 11 },
  { id: 'h4', tipo: 'hipotesis', x: 236, y: 180, r: 9 },
  { id: 'h5', tipo: 'hipotesis', x: 306, y: 200, r: 9 },
  { id: 'h6', tipo: 'hipotesis', x: 150, y: 92, r: 8 },
  { id: 'e1', tipo: 'hecho', x: 86, y: 130, r: 5 },
  { id: 'e2', tipo: 'hecho', x: 210, y: 104, r: 5 },
  { id: 'e3', tipo: 'hecho', x: 274, y: 138, r: 5 },
  { id: 'e4', tipo: 'hecho', x: 32, y: 250, r: 4 },
  { id: 'f1', tipo: 'fuente', x: 40, y: 150, r: 4 },
  { id: 'f2', tipo: 'fuente', x: 122, y: 60, r: 4 },
  { id: 'f3', tipo: 'fuente', x: 196, y: 52, r: 4 },
  { id: 'f4', tipo: 'fuente', x: 258, y: 78, r: 4 },
  { id: 'f5', tipo: 'fuente', x: 330, y: 150, r: 4 },
  { id: 'f6', tipo: 'fuente', x: 326, y: 262, r: 4 },
  { id: 'x1', tipo: 'experimento', x: 330, y: 340, r: 8 },
];

const ENLACES: [string, string, 'rama' | 'sostiene' | 'cita' | 'experimento'][] = [
  ['objetivo', 'r1', 'rama'],
  ['objetivo', 'r2', 'rama'],
  ['objetivo', 'r3', 'rama'],
  ['r1', 'h1', 'rama'],
  ['r1', 'h2', 'rama'],
  ['r2', 'h3', 'rama'],
  ['r2', 'h6', 'rama'],
  ['r3', 'h4', 'rama'],
  ['r3', 'h5', 'rama'],
  ['h1', 'e1', 'sostiene'],
  ['h2', 'e1', 'sostiene'],
  ['h3', 'e2', 'sostiene'],
  ['h6', 'e2', 'sostiene'],
  ['h4', 'e3', 'sostiene'],
  ['h5', 'e3', 'sostiene'],
  ['h1', 'e4', 'sostiene'],
  ['e1', 'f1', 'cita'],
  ['h6', 'f2', 'cita'],
  ['e2', 'f3', 'cita'],
  ['h4', 'f4', 'cita'],
  ['h5', 'f5', 'cita'],
  ['r3', 'f6', 'cita'],
  ['h5', 'x1', 'experimento'],
];

/** Las etapas del proceso, en el orden en que se iluminan. `nodos` y
 *  `enlaces` dicen qué parte del árbol se enciende en cada una. */
export const ETAPAS_VIVAS: { clave: string; titulo: string; frase: string; nodos: (n: Nodo) => boolean; enlaces: (t: string) => boolean }[] = traducido([
  { clave: 'objetivo', titulo: 'Un objetivo', frase: 'Todo empieza en el tronco: la pregunta que el equipo quiere responder.', nodos: (n) => n.tipo === 'objetivo', enlaces: () => false },
  { clave: 'literatura', titulo: 'Literatura', frase: 'ROSA2018 lee PubMed, Europe PMC y los registros de ensayos; cada consulta queda anotada con su fecha.', nodos: (n) => n.tipo === 'fuente', enlaces: (t) => t === 'cita' },
  { clave: 'verificar', titulo: 'Verificación', frase: 'Cada afirmación se contrasta con el pasaje literal de su fuente antes de contar como hecho.', nodos: (n) => n.tipo === 'hecho' || n.tipo === 'fuente', enlaces: (t) => t === 'cita' },
  { clave: 'mundo', titulo: 'Modelo de mundo', frase: 'Lo que resiste entra como hecho con su procedencia; lo abierto queda como pregunta.', nodos: (n) => n.tipo === 'hecho', enlaces: (t) => t === 'sostiene' },
  { clave: 'hipotesis', titulo: 'Hipótesis y Killer', frase: 'ROSA2018 propone hipótesis y el Killer las somete a quince comprobaciones. Las que quedan, las decide una persona.', nodos: (n) => n.tipo === 'hipotesis' || n.tipo === 'rama', enlaces: (t) => t === 'rama' },
  { clave: 'laboratorio', titulo: 'Laboratorio', frase: 'La candidata se prerregistra, se sella con un tercero y vuelve del laboratorio con datos que actualizan la certeza.', nodos: (n) => n.tipo === 'experimento' || n.id === 'h5', enlaces: (t) => t === 'experimento' },
]);

const INTERVALO_MS = 3400;

export function ArbolVivo({ className }: { className?: string }) {
  const reducido = useMovimientoReducido();
  const [etapa, setEtapa] = useState(reducido ? 4 : 0);
  useEffect(() => {
    if (reducido) return;
    const t = window.setInterval(() => setEtapa((e) => (e + 1) % ETAPAS_VIVAS.length), INTERVALO_MS);
    return () => window.clearInterval(t);
  }, [reducido]);
  const actual = ETAPAS_VIVAS[etapa]!;
  const porId = new Map(NODOS.map((n) => [n.id, n]));
  return (
    <div className={`arbol-vivo ${className ?? ''}`.trim()}>
      <svg viewBox="0 0 360 420" role="img" aria-label={tr("Árbol de conocimiento de ROSA2018: un objetivo, ramas, hipótesis y lo que las sostiene")} className={reducido ? 'arbol-vivo-quieto' : ''}>
        <defs>
          <radialGradient id="arbol-vivo-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="arbol-vivo-enlaces">
          {ENLACES.map(([a, b, tipo]) => {
            const na = porId.get(a)!;
            const nb = porId.get(b)!;
            return <line key={`${a}-${b}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} className={`enlace enlace-${tipo} ${actual.enlaces(tipo) ? 'encendido' : ''}`} />;
          })}
        </g>
        <g className="arbol-vivo-nodos">
          {NODOS.map((n, i) => {
            const encendido = actual.nodos(n);
            return (
              <g key={n.id} className={`nodo nodo-${n.tipo} ${encendido ? 'encendido' : ''}`} style={{ ['--i' as string]: i, ['--x' as string]: `${n.x}px`, ['--y' as string]: `${n.y}px` }}>
                {encendido && <circle cx={n.x} cy={n.y} r={n.r * 2.6} fill="url(#arbol-vivo-halo)" className="halo" />}
                <circle cx={n.x} cy={n.y} r={n.r} className="esfera" />
              </g>
            );
          })}
        </g>
      </svg>
      <div className="arbol-vivo-etapas" aria-live="polite">
        <ol className="arbol-vivo-puntos" aria-hidden="true">
          {ETAPAS_VIVAS.map((e, i) => (
            <li key={e.clave} className={i === etapa ? 'activa' : i < etapa ? 'pasada' : ''} />
          ))}
        </ol>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={actual.clave} initial={reducido ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reducido ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            <p className="arbol-vivo-titulo">{actual.titulo}</p>
            <p className="arbol-vivo-frase">{actual.frase}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
