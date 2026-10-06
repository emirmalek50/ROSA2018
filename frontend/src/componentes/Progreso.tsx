// La cabecera mientras ROSA2018 trabaja: en qué FASE va, dicho en llano
// («Buscando en PubTator 3», «Mirando el árbol de la investigación»), no lo
// que piensa literalmente, y los logos de cada base o herramienta que va
// tocando, que entran uno a uno según los consulta (Emir, 6 de octubre de
// 2026). Todo sale de los pasos reales del servidor: un logo es una consulta
// que pasó, y el que late es el que está corriendo ahora.

import { AnimatePresence, motion } from 'motion/react';

import { IconGlobe, IconLayers, IconMessage, IconSearch, IconTree } from './icons';
import { Shimmer } from './Shimmer';
import type { PasoRazonamiento } from '../datos/tipos';
import { traducido, tr, trp } from '../lib/idioma';
import { useMovimientoReducido } from '../lib/movimiento';
import { inicialFuente } from '../lib/mundo';

/** Más logos que estos no se leen en una línea: el resto va en «+N». */
const LOGOS_VISIBLES = 6;

const SALIDA = [0.16, 1, 0.3, 1] as const;

/** «ChEBI (vía EBI Search)» → «ChEBI»: en la frase y en el logo basta el
 *  nombre de la base. */
export function nombreCorto(fuente: string): string {
  return fuente.replace(/\s*\(.*\)\s*$/, '').trim() || fuente;
}

/** El tono de una base, estable por nombre, para que PubMed sea siempre del
 *  mismo color. Los cinco tonos son los de `.mundo-fuente-N`. */
export function tonoDe(fuente: string): number {
  let h = 0;
  for (const c of nombreCorto(fuente)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}

type Icono = (p: { size?: number }) => JSX.Element;

/** Las herramientas propias del chat, con lo que se está haciendo al
 *  llamarlas y su icono. Las que no estén aquí dicen su nombre. */
const PROPIAS: Record<string, { fase: string; Icono: Icono }> = traducido({
  leer_modelo_de_mundo: { fase: 'Revisando el modelo de mundo', Icono: IconLayers },
  buscar_en_proyecto: { fase: 'Buscando en el proyecto', Icono: IconSearch },
  leer_cuestiones: { fase: 'Mirando las cuestiones abiertas', Icono: IconMessage },
  consultar_arbol: { fase: 'Mirando el árbol de la investigación', Icono: IconTree },
  catalogo_proyecto: { fase: 'Repasando el catálogo del proyecto', Icono: IconLayers },
  panorama_del_tema: { fase: 'Repasando el panorama del tema', Icono: IconLayers },
  consultar_proyecto: { fase: 'Consultando el proyecto', Icono: IconSearch },
  leer_registro: { fase: 'Leyendo el registro', Icono: IconSearch },
  catalogo_acciones: { fase: 'Mirando qué acciones puede preparar', Icono: IconSearch },
  preparar_accion: { fase: 'Preparando la acción', Icono: IconSearch },
  leer_conversacion: { fase: 'Releyendo la conversación', Icono: IconMessage },
  listar_conversaciones: { fase: 'Repasando las conversaciones', Icono: IconMessage },
  prever_eliminacion_investigacion: { fase: 'Calculando qué se borraría', Icono: IconSearch },
});

const ICONO_FAMILIA: Record<NonNullable<PasoRazonamiento['familia']>, Icono> = {
  base: IconGlobe,
  mundo: IconLayers,
  proyecto: IconSearch,
  cuestiones: IconMessage,
  otra: IconSearch,
};

/** Cómo se mueve cada icono mientras su herramienta corre (`.mov-*` en
 *  mundo.css): el globo gira, la lupa busca, las capas se apilan, el
 *  mensaje escribe, el árbol se mece y la bombilla se enciende. Va aparte de
 *  PROPIAS porque esto no se traduce. */
export type Mov = 'bombilla' | 'globo' | 'lupa' | 'capas' | 'mensaje' | 'arbol';

const MOV_FAMILIA: Record<NonNullable<PasoRazonamiento['familia']>, Mov> = {
  base: 'globo',
  mundo: 'capas',
  proyecto: 'lupa',
  cuestiones: 'mensaje',
  otra: 'lupa',
};

const MOV_PROPIA: Record<string, Mov> = {
  leer_modelo_de_mundo: 'capas',
  leer_cuestiones: 'mensaje',
  consultar_arbol: 'arbol',
  catalogo_proyecto: 'capas',
  panorama_del_tema: 'capas',
  leer_conversacion: 'mensaje',
  listar_conversaciones: 'mensaje',
};

/** El icono de una herramienta y su movimiento, el mismo en la cabecera y
 *  en la línea de tiempo. */
export function iconoDe(p: PasoRazonamiento): { Icono: Icono; mov: Mov } {
  const h = p.herramienta ?? '';
  const familia = p.familia ?? 'otra';
  return {
    Icono: PROPIAS[h]?.Icono ?? ICONO_FAMILIA[familia],
    mov: MOV_PROPIA[h] ?? (PROPIAS[h] ? 'lupa' : MOV_FAMILIA[familia]),
  };
}

interface Logo {
  clave: string;
  nombre: string;
  base: boolean;
  Icono: Icono;
  mov: Mov;
  vivo: boolean;
  fallo: boolean;
}

/** Una base se nombra por `nombre`, que el servidor rellena con la fuente del
 *  conector desde que la llamada empieza; `fuente` solo llega al acabar. Por
 *  eso la clave sale de `nombre`: el logo no cambia al terminar. */
function nombreDe(p: PasoRazonamiento): string {
  return p.familia === 'base' ? nombreCorto(p.nombre || p.fuente || p.herramienta || '') : p.nombre || p.herramienta || '';
}

function corriendo(p: PasoRazonamiento): boolean {
  return p.fin === null || p.fin === undefined;
}

/** Un logo por base o herramienta, en el orden en que se tocaron. Una base
 *  consultada dos veces es un logo; falla solo si fallaron todas. */
export function logosDe(pasos: PasoRazonamiento[]): Logo[] {
  const logos = new Map<string, Logo>();
  for (const p of pasos) {
    if (p.tipo !== 'herramienta') continue;
    const base = p.familia === 'base';
    const nombre = nombreDe(p);
    const clave = base ? `b:${nombre.toLowerCase()}` : `h:${p.herramienta ?? nombre}`;
    const { Icono, mov } = iconoDe(p);
    const antes = logos.get(clave);
    logos.set(clave, {
      clave,
      nombre,
      base,
      Icono,
      mov,
      vivo: corriendo(p) || !!antes?.vivo,
      fallo: !!p.error && (antes ? antes.fallo : true),
    });
  }
  return [...logos.values()];
}

/** La fase, en llano, a partir del último paso. */
export function faseDe(pasos: PasoRazonamiento[]): string {
  const u = pasos[pasos.length - 1];
  if (!u) return tr('Leyendo la pregunta');
  if (u.tipo === 'pensar') {
    if (u.cierra) return tr('Preparando la respuesta');
    return pasos.some((p) => p.tipo === 'herramienta') ? tr('Decidiendo el siguiente paso') : tr('Pensando qué consultar');
  }
  const nombre = nombreDe(u);
  if (u.error) return trp('No pude consultar {fuente}', { fuente: nombre });
  if (!corriendo(u)) return tr('Leyendo lo que encontró');
  const propia = PROPIAS[u.herramienta ?? ''];
  if (propia) return propia.fase;
  if (u.familia === 'base') return trp('Buscando en {fuente}', { fuente: nombre });
  return trp('Usando «{herramienta}»', { herramienta: nombre });
}

function LogoFuente({ l, reducido }: { l: Logo; reducido: boolean }) {
  return (
    <motion.i
      className={`progreso-logo ${l.base ? `mundo-fuente-${tonoDe(l.nombre)}` : `progreso-logo-propia mov-${l.mov}`} ${l.vivo ? 'progreso-logo-vivo' : ''} ${l.fallo ? 'progreso-logo-fallo' : ''}`.trim()}
      title={l.nombre}
      layout={!reducido}
      initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.3, x: -6 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={reducido ? { duration: 0.15 } : { type: 'spring', stiffness: 520, damping: 26 }}
    >
      {l.base ? inicialFuente(l.nombre) : <l.Icono size={11} />}
    </motion.i>
  );
}

/** `texto` manda sobre la fase cuando el turno ya no está buscando
 *  (deteniéndose, o con la respuesta lista). */
export function Progreso({ pasos, texto, segundos }: { pasos: PasoRazonamiento[]; texto?: string; segundos: number }) {
  const reducido = useMovimientoReducido();
  const logos = logosDe(pasos);
  const visibles = logos.slice(-LOGOS_VISIBLES);
  const resto = logos.length - visibles.length;
  const fase = texto ?? faseDe(pasos);
  const nombres = logos.map((l) => l.nombre).join(', ');
  return (
    <div className="mundo-pensando progreso" role="status">
      {logos.length > 0 && (
        <span className="progreso-logos" aria-label={trp('Consultado: {lista}', { lista: nombres })}>
          {resto > 0 && <i className="progreso-logo progreso-logo-resto" aria-hidden="true">+{resto}</i>}
          <AnimatePresence initial={false}>
            {visibles.map((l) => (
              <LogoFuente key={l.clave} l={l} reducido={reducido} />
            ))}
          </AnimatePresence>
        </span>
      )}
      <span className="progreso-fase">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={fase}
            className="progreso-fase-texto"
            initial={reducido ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reducido ? { opacity: 0 } : { opacity: 0, y: -8, filter: 'blur(3px)' }}
            transition={{ duration: 0.28, ease: SALIDA }}
          >
            <Shimmer>{fase}</Shimmer>
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="mundo-pensando-tiempo">{trp('{n} s', { n: segundos })}</span>
    </div>
  );
}
