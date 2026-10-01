// Las explicaciones alternativas de una hipótesis: lo que también explicaría
// la asociación observada sin que la hipótesis sea cierta (Platt, "strong
// inference"). Cada una lleva su clase con la definición en una frase y qué
// observación la distinguiría de la hipótesis, porque eso es lo que convierte
// una duda en un experimento.
//
// De dónde salen, por orden: del campo opcional `alternativas` de la
// hipótesis (objetos {texto, clase, queLaDistinguiria, iteracion} o, como las
// escribe hoy el Killer en `rosa/bucle/pasos.py`, cadenas sueltas) y, si ese
// campo no existe, de los nodos `alternativa_<clase>` del grafo causal
// (`rosa/causal.py` los crea a partir de las mismas cadenas), que sí viajan al
// navegador. Mientras el integrador no añada `alternativas` a tipos.ts, el
// componente se tipa con una interfaz estructural local, así que acepta una
// Hipotesis completa sin cambios (las dos propiedades son opcionales).
//
// Tolerante y explicable: una entrada sin texto, con una clase que esta
// interfaz no conoce o con un campo que no es texto no rompe la lista; una
// cadena sin clase se clasifica con la misma regla de palabras que el backend
// y se dice que la clase es inferida y por qué.

import type { ReactNode } from 'react';
import { plural } from '../lib/formato';
import { Chip } from './piezas';
import { traducido, tr } from '../lib/idioma';

export type ClaseAlternativa = 'causa_inversa' | 'confusor' | 'seleccion' | 'artefacto' | 'otra';

export interface Alternativa {
  /** La explicación rival, en una o dos frases. */
  texto: string;
  clase: ClaseAlternativa;
  /** Qué observación, medida o diseño separaría esta explicación de la hipótesis. */
  queLaDistinguiria: string;
  /** Iteración en la que ROSA2018 la escribió, si se sabe. */
  iteracion?: number | null;
}

/** Lo mínimo que el componente necesita de una hipótesis: el campo nuevo (si
 *  ya existe) y el grafo causal (que existe desde el Killer). */
export interface ConAlternativas {
  alternativas?: (Alternativa | string)[] | null;
  /** Los nodos se leen como desconocidos: un registro a medias (un nulo dentro) no debe romper el tipo ni la lista. */
  grafoCausal?: { nodos?: unknown[] | null } | null;
}

/** Una alternativa ya limpia, con la explicación de cómo se leyó. */
export interface AlternativaLeida extends Alternativa {
  iteracion: number | null;
  /** La clase tal como venía escrita (en minúsculas), para no perder información. */
  claseOriginal: string;
  /** True si la clase no venía y se dedujo del texto por regla. */
  claseInferida: boolean;
  /** Por qué se le dio esa clase (la clave declarada, el alias, o las palabras que la delataron). */
  motivoClase: string;
  origen: 'alternativas' | 'grafo_causal';
}

export const CLASE_ALTERNATIVA: Record<ClaseAlternativa, { etiqueta: string; definicion: string; tono: 'ok' | 'aviso' | 'mal' | 'acento' | 'borde' | 'neutro' }> = traducido({
  causa_inversa: { etiqueta: 'Causa inversa', definicion: 'El desenlace produce la exposición y no al revés: la enfermedad cambia el marcador, en vez de que el marcador anticipe la enfermedad.', tono: 'aviso' },
  confusor: { etiqueta: 'Confusor', definicion: 'Una tercera variable explica las dos a la vez (la edad, la función renal, el genotipo APOE), y por eso parecen relacionadas sin que una cause la otra.', tono: 'aviso' },
  seleccion: { etiqueta: 'Sesgo de selección', definicion: 'Quién entra en la muestra distorsiona la asociación: los participantes de una cohorte clínica no son la población, y lo que se ve en ellos puede no valer fuera.', tono: 'aviso' },
  artefacto: { etiqueta: 'Artefacto de medida', definicion: 'La medida o la plataforma producen la señal: el ensayo, el lote de reactivo o el preanalítico crean la diferencia, no la biología.', tono: 'mal' },
  otra: { etiqueta: 'Otra explicación', definicion: 'Una explicación rival que no encaja en las cuatro clases anteriores; su texto dice cuál.', tono: 'borde' },
});

/** Cómo puede venir escrita cada clase (castellano e inglés, con o sin
 *  "sesgo de"); la clave ya normalizada (sin tildes, minúsculas, guiones bajos). */
const ALIAS_CLASE: Record<string, ClaseAlternativa> = {
  causa_inversa: 'causa_inversa',
  causalidad_inversa: 'causa_inversa',
  inversa: 'causa_inversa',
  reverse_causation: 'causa_inversa',
  reverse_causality: 'causa_inversa',
  reverse: 'causa_inversa',
  confusor: 'confusor',
  confusion: 'confusor',
  confusor_comun: 'confusor',
  causa_comun: 'confusor',
  common_cause: 'confusor',
  confounder: 'confusor',
  confounding: 'confusor',
  seleccion: 'seleccion',
  sesgo_de_seleccion: 'seleccion',
  selection: 'seleccion',
  selection_bias: 'seleccion',
  artefacto: 'artefacto',
  artefacto_de_medida: 'artefacto',
  artifact: 'artefacto',
  artefact: 'artefacto',
  measurement: 'artefacto',
  measurement_artifact: 'artefacto',
  otra: 'otra',
  other: 'otra',
};

/** La misma regla de palabras que `_clasificar_alternativa` en rosa/causal.py,
 *  en el mismo orden (inversa, confusor, selección, artefacto), aplicada al
 *  texto sin tildes para que "al revés" cuente igual que "al reves". */
const REGLAS_CLASE: { clase: ClaseAlternativa; patron: RegExp }[] = [
  { clase: 'causa_inversa', patron: /invers|reverse|consecuencia|consequence|al reves|epifenomen|epiphenomen/i },
  { clase: 'confusor', patron: /confus|confound|causa comun|common cause|tercera variable|third variable|\bedad\b|\bage\b|comorbilid|comorbid/i },
  { clase: 'seleccion', patron: /selecci|selection|supervivencia|survivor|colider|collider|voluntari/i },
  { clase: 'artefacto', patron: /artefact|artifact|medida|measurement|ensayo|assay|plataforma|platform|lote|batch|preanal/i },
];

function texto(x: unknown): string {
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** La clave de una clase tal como se compara: minúsculas, sin tildes, con
 *  espacios y guiones convertidos en guiones bajos. */
function claveClase(s: string): string {
  return sinTildes(s).toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function esClase(k: string): k is ClaseAlternativa {
  return Object.hasOwn(CLASE_ALTERNATIVA, k);
}

/** La clase de una alternativa y por qué: declarada (o por alias) si venía;
 *  si no, inferida del texto con la regla del backend; si nada encaja, otra. */
function clasificar(claseDeclarada: string, textoAlternativa: string): { clase: ClaseAlternativa; claseInferida: boolean; motivoClase: string } {
  const k = claveClase(claseDeclarada);
  if (k && esClase(k)) return { clase: k, claseInferida: false, motivoClase: `Clase declarada: ${CLASE_ALTERNATIVA[k].etiqueta.toLowerCase()}.` };
  if (k && Object.hasOwn(ALIAS_CLASE, k)) return { clase: ALIAS_CLASE[k]!, claseInferida: false, motivoClase: `Clase declarada como "${claseDeclarada.trim()}", leída como ${CLASE_ALTERNATIVA[ALIAS_CLASE[k]!].etiqueta.toLowerCase()}.` };
  if (k) return { clase: 'otra', claseInferida: false, motivoClase: `Clase declarada "${claseDeclarada.trim()}", que esta interfaz no conoce; se enseña como otra explicación.` };
  const llano = sinTildes(textoAlternativa);
  for (const r of REGLAS_CLASE) {
    const m = r.patron.exec(llano);
    if (m) return { clase: r.clase, claseInferida: true, motivoClase: `Clase inferida del texto por regla (misma que rosa/causal.py): contiene "${m[0]}".` };
  }
  return { clase: 'otra', claseInferida: true, motivoClase: tr('Sin clase declarada y el texto no nombra causa inversa, confusor, selección ni artefacto.') };
}

function iteracionDe(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return null;
}

/** Las alternativas de la hipótesis como lista limpia. Del campo
 *  `alternativas` si existe (objetos o cadenas); si no, de los nodos
 *  `alternativa_<clase>` del grafo causal. Entradas que no son ni objeto ni
 *  texto, o sin texto ni qué las distinguiría, se descartan; una clase
 *  desconocida se conserva como 'otra' guardando el nombre original. */
export function alternativasDe(h: ConAlternativas | null | undefined): AlternativaLeida[] {
  const salida: AlternativaLeida[] = [];
  const crudas = Array.isArray(h?.alternativas) ? (h.alternativas as unknown[]) : [];
  for (const a of crudas) {
    if (typeof a === 'string') {
      const t = texto(a);
      if (!t) continue;
      salida.push({ texto: t, queLaDistinguiria: '', iteracion: null, claseOriginal: '', origen: 'alternativas', ...clasificar('', t) });
      continue;
    }
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const t = texto(o.texto);
    const q = texto(o.queLaDistinguiria);
    if (!t && !q) continue;
    const claseOriginal = texto(o.clase).toLowerCase();
    salida.push({ texto: t, queLaDistinguiria: q, iteracion: iteracionDe(o.iteracion), claseOriginal, origen: 'alternativas', ...clasificar(claseOriginal, t) });
  }
  if (salida.length > 0 || Array.isArray(h?.alternativas)) return salida;
  // Respaldo: los nodos del grafo causal que el Killer dejó como alternativas.
  const nodos = Array.isArray(h?.grafoCausal?.nodos) ? h.grafoCausal.nodos : [];
  for (const n of nodos) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const rol = texto(o.rol);
    if (!rol.startsWith('alternativa_')) continue;
    const t = texto(o.etiqueta);
    if (!t) continue;
    const claseOriginal = rol.slice('alternativa_'.length).toLowerCase();
    const c = clasificar(claseOriginal, t);
    salida.push({ texto: t, queLaDistinguiria: '', iteracion: null, claseOriginal, origen: 'grafo_causal', ...c, motivoClase: `${c.motivoClase} Leída del nodo ${texto(o.id) || tr('sin id')} del grafo causal.` });
  }
  return salida;
}

/** La lista de alternativas con su clase, definición y qué las distinguiría.
 *  `vacio` sustituye al texto por defecto cuando no hay ninguna. */
export function Alternativas({ h, vacio }: { h: ConAlternativas | null | undefined; vacio?: ReactNode }) {
  const lista = alternativasDe(h);
  if (lista.length === 0) {
    return (
      <p className="meta">
        {vacio ?? tr('ROSA2018 no ha escrito explicaciones alternativas para esta hipótesis todavía. Las escribe al concluir cada iteración: qué más explicaría lo observado (causa inversa, confusor, selección, artefacto) y qué observación lo separaría de la hipótesis.')}
      </p>
    );
  }
  const delGrafo = lista.every((a) => a.origen === 'grafo_causal');
  return (
    <div>
      <p className="meta">
        {plural(lista.length, tr('explicación alternativa'), tr('explicaciones alternativas'))}{tr(". Cada una dice qué observación la separaría de la hipótesis: eso es lo que convierte una duda en un experimento.")}
        {delGrafo && tr(' Leídas del grafo causal que construyó el Killer; ahí no consta qué las distinguiría.')}
      </p>
      <ul className="supuestos">
        {lista.map((a, i) => {
          const c = CLASE_ALTERNATIVA[a.clase];
          const desconocida = a.clase === 'otra' && a.claseOriginal !== '' && a.claseOriginal !== 'otra';
          return (
            <li key={i} className={`supuesto ${c.tono === 'mal' ? 'supuesto-mal' : c.tono === 'aviso' ? 'supuesto-aviso' : ''}`}>
              <div className="acciones" style={{ gap: 6 }}>
                <Chip tono={c.tono} title={`${c.definicion} ${a.motivoClase}`}>
                  {c.etiqueta}
                  {desconocida && ` (${a.claseOriginal})`}
                </Chip>
                <span className="meta">{c.definicion}</span>
                {a.claseInferida && a.clase !== 'otra' && <span className="meta">{tr("Clase inferida del texto por regla")}</span>}
                {a.iteracion !== null && <span className="meta">{tr("Iteración")} {a.iteracion}</span>}
              </div>
              {a.texto && <p>{a.texto}</p>}
              <p className="meta">
                <strong>{tr("Qué la distinguiría:")}</strong> {a.queLaDistinguiria || tr('ROSA2018 no lo dejó escrito; sin eso la alternativa no se puede separar de la hipótesis en un experimento.')}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
