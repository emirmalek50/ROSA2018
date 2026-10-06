// La cabecera mientras ROSA2018 trabaja: en qué FASE va, dicho en llano
// («Buscando en PubTator 3», «Mirando el árbol de la investigación»), no lo
// que piensa literalmente, y los logos de cada base o herramienta que va
// tocando, que entran uno a uno según los consulta (Emir, 6 de octubre de
// 2026). Todo sale de los pasos reales del servidor: un logo es una consulta
// que pasó, y el que late es el que está corriendo ahora.

import { AnimatePresence, motion } from 'motion/react';

import {
  IconActivity, IconBook, IconBookmark, IconBranch, IconBulb, IconClock, IconCompass, IconDatabase, IconFileText, IconFolder,
  IconGauge, IconGlobe, IconGrid, IconLayers, IconMessage, IconPen, IconPlug, IconSearch, IconServer, IconSettings, IconTable,
  IconTrash, IconTree, IconTrophy,
} from './icons';
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

/** Lo que se está haciendo al llamar cada herramienta propia del chat
 *  (rosa/asistente.py y rosa/asistente_servicios.py), dicho en llano, y su
 *  nombre bonito para la fila. Las que no estén aquí dicen el suyo. */
const PROPIAS: Record<string, { fase: string; nombre: string }> = traducido({
  leer_modelo_de_mundo: { fase: 'Revisando el modelo de mundo', nombre: 'Modelo de mundo' },
  buscar_en_proyecto: { fase: 'Buscando en el proyecto', nombre: 'Búsqueda en el proyecto' },
  leer_cuestiones: { fase: 'Mirando las cuestiones abiertas', nombre: 'Cuestiones abiertas' },
  consultar_arbol: { fase: 'Mirando el árbol de la investigación', nombre: 'Árbol de la investigación' },
  catalogo_proyecto: { fase: 'Repasando el catálogo del proyecto', nombre: 'Catálogo del proyecto' },
  panorama_del_tema: { fase: 'Repasando el panorama del tema', nombre: 'Panorama del tema' },
  consultar_proyecto: { fase: 'Consultando el proyecto', nombre: 'Consulta al proyecto' },
  leer_registro: { fase: 'Leyendo el registro', nombre: 'Lectura de registro' },
  catalogo_acciones: { fase: 'Mirando qué acciones puede preparar', nombre: 'Catálogo de acciones' },
  preparar_accion: { fase: 'Preparando la acción', nombre: 'Preparar acción' },
  leer_conversacion: { fase: 'Releyendo la conversación', nombre: 'Conversación' },
  listar_conversaciones: { fase: 'Repasando las conversaciones', nombre: 'Historial de conversaciones' },
  prever_eliminacion_investigacion: { fase: 'Calculando qué se borraría', nombre: 'Previsión de borrado' },
  catalogo_servicios: { fase: 'Mirando qué servicios hay', nombre: 'Catálogo de servicios' },
  consultar_servicio: { fase: 'Consultando un servicio', nombre: 'Consulta a servicio' },
  consultar_vista: { fase: 'Leyendo lo que hay en pantalla', nombre: 'Vista actual' },
  consultar_vista_calculada: { fase: 'Calculando la vista', nombre: 'Vista calculada' },
  leer_documento: { fase: 'Leyendo el documento', nombre: 'Lectura de documento' },
  leer_skill: { fase: 'Leyendo la skill', nombre: 'Skill' },
  leer_dataset: { fase: 'Abriendo el dataset', nombre: 'Dataset' },
  consultar_dataset: { fase: 'Recorriendo el dataset', nombre: 'Consulta al dataset' },
  consultar_documentacion: { fase: 'Leyendo la documentación', nombre: 'Documentación' },
  consultar_gepa: { fase: 'Mirando el historial de GEPA', nombre: 'Historial de GEPA' },
});

/** Cómo se mueve cada icono mientras su herramienta corre (`.mov-*` en
 *  mundo.css). Uno por herramienta: con todas en lupa no se distinguía qué
 *  hacía ROSA2018 (Emir, 6 de octubre de 2026, «solo aparecen lupas»). */
export type Mov =
  | 'bombilla' | 'globo' | 'lupa' | 'capas' | 'mensaje' | 'arbol' | 'engranaje' | 'datos' | 'hoja' | 'libro' | 'rejilla'
  | 'servidor' | 'enchufe' | 'brujula' | 'aguja' | 'pulso' | 'papelera' | 'reloj' | 'lapiz' | 'carpeta' | 'trofeo' | 'rama';

type Aspecto = [Icono, Mov];

/** El icono de cada herramienta. Va aparte de PROPIAS porque no se traduce. */
const ASPECTO: Record<string, Aspecto> = {
  leer_modelo_de_mundo: [IconLayers, 'capas'],
  buscar_en_proyecto: [IconSearch, 'lupa'],
  leer_cuestiones: [IconMessage, 'mensaje'],
  consultar_arbol: [IconTree, 'arbol'],
  catalogo_proyecto: [IconGrid, 'rejilla'],
  panorama_del_tema: [IconCompass, 'brujula'],
  consultar_proyecto: [IconDatabase, 'datos'],
  leer_registro: [IconFileText, 'hoja'],
  catalogo_acciones: [IconSettings, 'engranaje'],
  preparar_accion: [IconPen, 'lapiz'],
  leer_conversacion: [IconMessage, 'mensaje'],
  listar_conversaciones: [IconClock, 'reloj'],
  prever_eliminacion_investigacion: [IconTrash, 'papelera'],
  catalogo_servicios: [IconServer, 'servidor'],
  consultar_servicio: [IconPlug, 'enchufe'],
  consultar_vista: [IconGauge, 'aguja'],
  consultar_vista_calculada: [IconActivity, 'pulso'],
  leer_documento: [IconFileText, 'hoja'],
  leer_skill: [IconBook, 'libro'],
  leer_dataset: [IconTable, 'rejilla'],
  consultar_dataset: [IconTable, 'rejilla'],
  consultar_documentacion: [IconBook, 'libro'],
  consultar_gepa: [IconTrophy, 'trofeo'],
};

/** Las tablas de `consultar_proyecto` y `leer_registro`, en llano. Las
 *  etiquetas se traducen; el aspecto (icono y movimiento) no, y por eso van
 *  en dos mapas, pero con las MISMAS claves por tipo: añadir una tabla a uno
 *  y no al otro no compila (antes eran dos mapas sueltos en dos ficheros). */
const ETIQUETA_TABLA = traducido({
  investigaciones: 'investigaciones',
  hipotesis: 'hipótesis',
  hypothesis: 'hipótesis',
  hechos: 'hechos',
  memoria: 'memoria',
  corridas: 'corridas',
  iteraciones: 'iteraciones',
  artefactos: 'artefactos',
  decisiones: 'decisiones',
  relaciones: 'relaciones',
  cuestiones: 'cuestiones',
  eventos: 'eventos',
  datasets: 'datasets',
  fuentes: 'fuentes',
});
type Tabla = keyof typeof ETIQUETA_TABLA;

/** Consultar o leer el proyecto dice QUÉ tabla: las hipótesis con la
 *  bombilla, las corridas con el pulso, las decisiones con la rama. */
const ASPECTO_TABLA: Record<Tabla, Aspecto> = {
  investigaciones: [IconFolder, 'carpeta'],
  hipotesis: [IconBulb, 'bombilla'],
  hypothesis: [IconBulb, 'bombilla'],
  hechos: [IconBookmark, 'capas'],
  memoria: [IconBookmark, 'capas'],
  corridas: [IconActivity, 'pulso'],
  iteraciones: [IconActivity, 'pulso'],
  artefactos: [IconFileText, 'hoja'],
  decisiones: [IconBranch, 'rama'],
  relaciones: [IconBranch, 'rama'],
  cuestiones: [IconMessage, 'mensaje'],
  eventos: [IconClock, 'reloj'],
  datasets: [IconTable, 'rejilla'],
  fuentes: [IconGlobe, 'globo'],
};

/** Lo que se sabe de una tabla del proyecto, o nada si no es una conocida.
 *  El nombre lo elige el modelo: con `MAPA[tabla]` a secas, «constructor» o
 *  «toString» devolvían una función del prototipo y el chat reventaba al
 *  destructurarla (revisión del 6 de octubre de 2026). */
export function tablaDe(nombre: string | undefined): { etiqueta: string; Icono: Icono; mov: Mov } | undefined {
  if (!nombre || !Object.hasOwn(ASPECTO_TABLA, nombre)) return undefined;
  const t = nombre as Tabla;
  const [Icono, mov] = ASPECTO_TABLA[t];
  return { etiqueta: ETIQUETA_TABLA[t], Icono, mov };
}

/** La herramienta propia, si lo es. Misma regla que `tablaDe`: el nombre
 *  viene del servidor y no se mira el prototipo. */
function propiaDe(herramienta: string | undefined): { fase: string; nombre: string } | undefined {
  return herramienta && Object.hasOwn(PROPIAS, herramienta) ? PROPIAS[herramienta] : undefined;
}

function aspectoDe(herramienta: string | undefined): Aspecto | undefined {
  return herramienta && Object.hasOwn(ASPECTO, herramienta) ? ASPECTO[herramienta] : undefined;
}

const ASPECTO_FAMILIA: Record<NonNullable<PasoRazonamiento['familia']>, Aspecto> = {
  base: [IconGlobe, 'globo'],
  mundo: [IconLayers, 'capas'],
  proyecto: [IconSearch, 'lupa'],
  cuestiones: [IconMessage, 'mensaje'],
  otra: [IconSettings, 'engranaje'],
};

/** El icono de una herramienta y su movimiento, el mismo en la cabecera y
 *  en la línea de tiempo. Una familia que no se conozca (un servidor más
 *  nuevo que esta interfaz) cae en «otra», no en un error. */
export function iconoDe(p: PasoRazonamiento): { Icono: Icono; mov: Mov } {
  const h = p.herramienta;
  const tabla = (h === 'consultar_proyecto' || h === 'leer_registro') ? tablaDe(p.argumentos?.tabla) : undefined;
  const familia = p.familia && Object.hasOwn(ASPECTO_FAMILIA, p.familia) ? ASPECTO_FAMILIA[p.familia] : ASPECTO_FAMILIA.otra;
  const [Icono, mov] = tabla ? [tabla.Icono, tabla.mov] : aspectoDe(h) ?? familia;
  return { Icono, mov };
}

/** El nombre de la fila: el bonito si es propia, el del servidor si no. */
export function nombreHerramienta(p: PasoRazonamiento): string {
  return propiaDe(p.herramienta)?.nombre ?? (p.nombre || p.herramienta || '');
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
  return p.familia === 'base' ? nombreCorto(p.nombre || p.fuente || p.herramienta || '') : nombreHerramienta(p);
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
    // Las hipótesis y las corridas del proyecto son logos distintos: llevan
    // icono distinto.
    const clave = base ? `b:${nombre.toLowerCase()}` : `h:${p.herramienta ?? nombre}:${p.argumentos?.tabla ?? ''}`;
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
  const propia = propiaDe(u.herramienta);
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
