// Lo que ROSA2018 mandaría al laboratorio.
//
// No es la vista de una hipótesis ni la de una investigación (regla de Emir, 29
// de septiembre de 2026): es la UNIÓN de todo lo que ROSA2018 tiene verificado
// hasta hoy, de todas sus investigaciones, en un solo sitio. Una proteína que
// nombran tres investigaciones sale una vez, con la evidencia de las tres
// sumada, y el orden del muro lo pone cuánta evidencia la sostiene.
//
// Se abre con el muro y, al elegir una diana, se entra en su lámina, que tiene
// ZOOM SEMÁNTICO: la información aparece y desaparece según lo cerca que esté
// la cámara, en tres niveles (lámina, partes, átomos).
//
// Nada de lo que se ve aquí lo ha diseñado ROSA2018. Las estructuras vienen de
// AlphaFold DB y del RCSB PDB, la química de PubChem y las anotaciones de
// UniProt, cada una con su licencia dicha en pantalla. ROSA2018 solo reúne lo
// que su evidencia nombra: ver el porqué en rosa/laboratorio.py.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { acciones } from '../datos/almacen';
import { AvisoMuestra } from '../componentes/piezas';
import type { CandidatoAso, Duplex as DuplexT, CompuestoDeLaboratorio, DianaDeLaboratorio, DisenoAso, ExperimentoDeDiana, Laboratorio as Datos, OligoQueMandaria, QuimicaDeDiana } from '../lib/laboratorio';
import type { Residuo, Visor } from '../lib/visorMolecular';
import '../laboratorio.css';
import { traducido, tr, trp } from '../lib/idioma';
import { coma } from '../lib/formato';

/* --------------------------------------------------------------------------
   Anotaciones de UniProt: lo que se marca sobre la proteína
   -------------------------------------------------------------------------- */

/** Qué anotaciones se enseñan y cómo se llaman en castellano. El orden manda
 *  cuando hay que recortar. Nada de esto se inventa: si UniProt no lo trae, no
 *  aparece.
 *
 *  `cuantas` es cuántas de esa clase caben. Casi todas van de una en una para
 *  que trece sitios de glicosilación no tapen la proteína, pero las
 *  REPETICIONES van hasta cuatro a propósito: en tau son las repeticiones de
 *  unión a microtúbulos (Tau/MAP 1 a 4, residuos 561 a 685) y son justo donde
 *  la proteína se agrega. La primera versión de esta lista se escribió
 *  mirando SULF2 y no pedía ese campo, así que en la proteína más nombrada de
 *  toda la investigación solo se marcaba «tramo desordenado». */
const QUE_MARCAR: { tipo: string; contiene?: string; nombre: string; detalle: string; cuantas?: number }[] = traducido([
  { tipo: 'Active site', nombre: 'Sitio activo', detalle: 'donde ocurre la reacción' },
  { tipo: 'Repeat', nombre: 'Repetición', detalle: 'se repite en la cadena', cuantas: 4 },
  { tipo: 'Region', contiene: 'Catalytic', nombre: 'Dominio catalítico', detalle: 'la parte que cataliza' },
  { tipo: 'Region', contiene: 'Hydrophilic', nombre: 'Dominio hidrofílico', detalle: '' },
  { tipo: 'Domain', nombre: 'Dominio', detalle: '' },
  { tipo: 'Motif', nombre: 'Motivo', detalle: '' },
  { tipo: 'Signal', nombre: 'Péptido señal', detalle: 'se corta al secretarse' },
  { tipo: 'Binding site', nombre: 'Sitio de unión', detalle: '' },
  { tipo: 'Site', nombre: 'Sitio', detalle: '' },
  { tipo: 'Region', contiene: 'Disordered', nombre: 'Tramo desordenado', detalle: 'sin forma fija' },
]);
const MAX_MARCAS = 8;

interface Marca {
  nombre: string;
  detalle: string;
  desde: number;
  hasta: number;
  /** Lo que UniProt escribe de esta anotación, tal cual. */
  descripcion: string;
  /** Con qué prueba la anota UniProt. No es un adorno: un péptido señal
   *  anotado por modelo de secuencia está PREDICHO, no medido, y quien vaya a
   *  cortar ahí tiene que saberlo. */
  pruebas: { codigo: string; fuente: string }[];
}

/* Los códigos de prueba de UniProt (ECO) en castellano. Lo que no está en la
   lista se enseña con su código: inventarle un nombre sería peor. */
const PRUEBA: Record<string, string> = traducido({
  'ECO:0000269': 'demostrado en un experimento publicado',
  'ECO:0000305': 'deducido por quien curó la entrada',
  'ECO:0000303': 'afirmado en una publicación, sin dato propio',
  'ECO:0000250': 'por parecido con otra proteína ya estudiada',
  'ECO:0000255': 'predicho por un modelo de secuencia, de forma automática',
  'ECO:0000256': 'predicho de forma automática',
  'ECO:0000259': 'importado de otra base de datos',
  'ECO:0000313': 'importado de otra base de datos',
  'ECO:0007829': 'leído de una estructura resuelta en el laboratorio',
});

/* Lo que es cada aminoácido: carga a pH fisiológico, si el lado es polar y lo
   que conviene saber al mutarlo. Es química de libro de texto, no algo que
   ROSA2018 haya medido, y la ficha lo dice. Sirve para lo de siempre en un
   laboratorio: decidir si una mutación va a cambiar algo. */
/** Números con el separador de miles en castellano. */
const n = (x: number) => x.toLocaleString('es');

/** Un decimal con coma, que es como se escribe en castellano. */
const dec = (x: number, d: number) => coma(x.toFixed(d));

const AMINOACIDOS: Record<string, { carga: 'positiva' | 'negativa' | 'sin carga'; polar: boolean; nota: string }> = traducido({
  ALA: { carga: 'sin carga', polar: false, nota: 'pequeño y sin reactividad; el cambio de referencia cuando se quiere quitar una cadena lateral sin meter otra cosa' },
  ARG: { carga: 'positiva', polar: true, nota: 'cadena larga y cargada; suele hacer puentes salinos y unir fosfatos o sulfatos' },
  ASN: { carga: 'sin carga', polar: true, nota: 'acepta glicosilación si va en la secuencia N-X-S/T' },
  ASP: { carga: 'negativa', polar: true, nota: 'ácido; frecuente en sitios catalíticos y en la unión de metales' },
  CYS: { carga: 'sin carga', polar: true, nota: 'forma puentes disulfuro y es el nucleófilo de muchas enzimas; mutarlo suele romper la actividad o el plegado' },
  GLN: { carga: 'sin carga', polar: true, nota: 'amida, hace puentes de hidrógeno' },
  GLU: { carga: 'negativa', polar: true, nota: 'ácido; frecuente en sitios catalíticos y en la unión de metales' },
  GLY: { carga: 'sin carga', polar: false, nota: 'sin cadena lateral: da flexibilidad y aparece donde la cadena tiene que girar' },
  HIS: { carga: 'positiva', polar: true, nota: 'se protona cerca del pH fisiológico; por eso es tan común en catálisis y en la unión de metales' },
  ILE: { carga: 'sin carga', polar: false, nota: 'hidrofóbico ramificado; suele estar en el interior' },
  LEU: { carga: 'sin carga', polar: false, nota: 'hidrofóbico; suele estar en el interior' },
  LYS: { carga: 'positiva', polar: true, nota: 'cargado; sitio habitual de ubiquitinación y acetilación' },
  MET: { carga: 'sin carga', polar: false, nota: 'hidrofóbico y oxidable; el primero de la cadena suele ser este' },
  PHE: { carga: 'sin carga', polar: false, nota: 'anillo aromático; se apila con otros anillos en el núcleo' },
  PRO: { carga: 'sin carga', polar: false, nota: 'dobla la cadena y rompe hélices; meterlo o quitarlo cambia la forma local' },
  SER: { carga: 'sin carga', polar: true, nota: 'se fosforila; también es el nucleófilo de muchas enzimas' },
  THR: { carga: 'sin carga', polar: true, nota: 'se fosforila y acepta glicosilación' },
  TRP: { carga: 'sin carga', polar: false, nota: 'el más grande; su fluorescencia se usa para seguir el plegado' },
  TYR: { carga: 'sin carga', polar: true, nota: 'aromático y se fosforila' },
  VAL: { carga: 'sin carga', polar: false, nota: 'hidrofóbico ramificado; suele estar en el interior' },
});

/** Las tres letras del fichero a la letra única de la secuencia, que es como
 *  se pide un péptido o un constructo a un laboratorio. */
const UNA_LETRA: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S',
  THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', SEC: 'U', PYL: 'O',
};

/** `null` es "no pude comprobar" (UniProt no respondió); una lista vacía es
 *  "UniProt no tiene nada que marcar aquí". No es lo mismo y se dice distinto. */
async function anotacionesDe(uniprot: string): Promise<Marca[] | null> {
  const campos = 'ft_domain,ft_act_site,ft_signal,ft_region,ft_binding,ft_repeat,ft_motif,ft_site';
  const r = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(uniprot)}.json?fields=${campos}`).catch(() => null);
  if (!r || !r.ok) return null;
  const fs: {
    type: string;
    description?: string;
    evidences?: { evidenceCode?: string; source?: string; id?: string }[];
    location: { start: { value: number }; end: { value: number } };
  }[] = (await r.json()).features ?? [];
  const salida: Marca[] = [];
  for (const q of QUE_MARCAR) {
    let puestas = 0;
    for (const f of fs) {
      if (f.type !== q.tipo) continue;
      if (q.contiene && !String(f.description ?? '').includes(q.contiene)) continue;
      if (!q.contiene && q.tipo === 'Region' && ['Catalytic', 'Hydrophilic', 'Disordered'].some((x) => String(f.description ?? '').includes(x))) continue;
      const desde = f.location?.start?.value;
      const hasta = f.location?.end?.value;
      if (typeof desde !== 'number' || typeof hasta !== 'number') continue;
      if (salida.some((m) => m.desde === desde && m.hasta === hasta)) continue;
      salida.push({
        nombre: q.cuantas && q.cuantas > 1 ? `${q.nombre} ${puestas + 1}` : q.nombre,
        detalle: q.detalle || String(f.description ?? '').slice(0, 60),
        desde,
        hasta,
        descripcion: String(f.description ?? ''),
        pruebas: (f.evidences ?? []).map((x) => ({ codigo: String(x.evidenceCode ?? ''), fuente: [x.source, x.id].filter(Boolean).join(' ') })),
      });
      puestas += 1;
      if (salida.length >= MAX_MARCAS) return salida;
      // Tantas por clase como diga `cuantas`, una si no lo dice: sin ese tope
      // los sesenta y cuatro residuos modificados de tau taparían la proteína.
      if (puestas >= (q.cuantas ?? 1)) break;
    }
  }
  return salida;
}

/* -------------------------------------------------------------------------- */

/** El rectángulo de un bloque de texto en coordenadas del lienzo, con margen.
 *  El margen deja que el degradado del bloque haga su trabajo antes de que la
 *  proteína estorbe de verdad. */
function rectDe(el: HTMLElement | null, lienzo: HTMLElement | null, margen = 12) {
  if (!el || !lienzo) return null;
  const r = el.getBoundingClientRect();
  const m = lienzo.getBoundingClientRect();
  return { x: r.left - m.left - margen, y: r.top - m.top - margen, ancho: r.width + margen * 2, alto: r.height + margen * 2 };
}

const CERCA = 0.46;
const MEDIO = 0.9;
/* Cuánto MÁS tiene que taparse un texto, respecto del encuadre de apertura,
   para que se aparte. Es un aumento y no un valor absoluto a propósito: en la
   composición aprobada la proteína ya pasa por detrás del título y el degradado
   la deja legible; lo que estorba es que el zoom la ponga encima de verdad. Con
   un umbral absoluto, una proteína desordenada como la tau despejaba el titular
   nada más abrir, y con uno por distancia de cámara despejaba tarde. */
const TAPA = 0.035;
/* Cuánto hay que esperar sin tocar nada para que la proteína empiece a girar
   sola. Es la misma espera del árbol 3D (`lib/arbol3d.ts`) para que las dos
   piezas se comporten igual. */
const ESPERA_GIRO_MS = 3000;
/* El lanzamiento. `SENSIBILIDAD` convierte píxeles de arrastre en radianes, y
   es la de Mol* para que la proteína siga girando justo al ritmo que llevaba al
   soltar. `ROZAMIENTO` es cuánto conserva por fotograma: 0,955 da algo más de
   un segundo de recorrido, que es lo que se siente al lanzar algo de verdad.
   `MINIMO` corta el bucle cuando el movimiento ya no se ve. */
const SENSIBILIDAD_LANZAR = 0.005;
const ROZAMIENTO_LANZAR = 0.955;
const MINIMO_LANZAR = 0.00012;
const ALTO_ETIQUETA = 44;

const CERTEZA: Record<string, string> = traducido({ muy_baja: 'certeza muy baja', baja: 'certeza baja', moderada: 'certeza moderada', alta: 'certeza alta' });
const SISTEMA: Record<string, string> = traducido({
  ipsc: 'neuronas de iPSC humanas',
  datos_publicos_existentes: 'datos públicos ya existentes',
  raton: 'ratón',
  linea_celular: 'línea celular',
  cohorte_humana: 'cohorte humana',
});
const AMINOACIDO: Record<string, string> = traducido({
  ALA: 'alanina', ARG: 'arginina', ASN: 'asparagina', ASP: 'aspártico', CYS: 'cisteína', GLN: 'glutamina',
  GLU: 'glutámico', GLY: 'glicina', HIS: 'histidina', ILE: 'isoleucina', LEU: 'leucina', LYS: 'lisina',
  MET: 'metionina', PHE: 'fenilalanina', PRO: 'prolina', SER: 'serina', THR: 'treonina', TRP: 'triptófano',
  TYR: 'tirosina', VAL: 'valina', SEC: 'selenocisteína', FGL: '3-oxoalanina',
});

function confianzaEnPalabras(plddt: number): string {
  return plddt > 90 ? tr('muy alta') : plddt > 70 ? 'alta' : plddt > 50 ? 'baja' : tr('muy baja');
}

/* El Killer decide si una hipótesis sigue, y eso manda sobre lo que se puede
   decir de su diana. Una proteína cuyas hipótesis están todas suspendidas se
   enseña igual (es lo que la evidencia nombra) pero no se presenta como algo
   que ya se podría pedir: se dice en qué estado la dejó el Killer. */
const KILLER: Record<string, { texto: string; tono: string }> = traducido({
  avanzar: { texto: 'el Killer la deja avanzar', tono: 'va' },
  reformular: { texto: 'el Killer pide reformularla', tono: 'espera' },
  suspender: { texto: 'el Killer la tiene suspendida', tono: 'espera' },
  descartar_en_contexto: { texto: 'el Killer la descarta en este contexto', tono: 'no' },
});
const ORDEN_KILLER = ['avanzar', 'reformular', 'suspender', 'descartar_en_contexto'];

/** La mejor decisión del Killer entre las hipótesis que nombran esta diana:
 *  si una avanza, la diana está viva aunque otra esté suspendida. */
function decisionDeLaDiana(d: DianaDeLaboratorio): string | null {
  let mejor: string | null = null;
  for (const h of d.hipotesis) {
    const k = h.decisionKiller;
    if (!k || !(k in KILLER)) continue;
    if (mejor === null || ORDEN_KILLER.indexOf(k) < ORDEN_KILLER.indexOf(mejor)) mejor = k;
  }
  return mejor;
}

/** Copiar al portapapeles. Esta sección existe para mandar algo a un
 *  laboratorio: un SMILES de novecientos caracteres no se transcribe a mano, y
 *  transcribirlo mal cambia el compuesto. */
function Copiar({ texto, que, clase = '' }: { texto: string; que: string; clase?: string }) {
  const [hecho, fijarHecho] = useState(false);
  return (
    <button
      type="button"
      className={`lab-copiar ${clase}`}
      title={`Copiar ${que}`}
      onClick={(ev) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(texto).then(() => fijarHecho(true));
        window.setTimeout(() => fijarHecho(false), 2000);
      }}
    >
      {(hecho ? tr("copiado") : tr("copiar"))}
    </button>
  );
}

/** La hoja de pedido como texto plano, que es lo que se pega en un correo. Sale
 *  de lo que ya está en la hoja: aquí no se añade ni se resume nada. */
function hojaComoTexto(d: DianaDeLaboratorio): string {
  const h = d.hojaDePedido;
  const l = [
    `DIANA: ${d.simbolo} (${d.nombre})`,
    `IDENTIFICADOR: ${h.identificador}`,
    (d.estructura.clase === 'predicha' ? trp("ESTRUCTURA: {url} ({fuente}, {licencia}, predicha, no medida)", { url: d.estructura.url, fuente: d.estructura.fuente, licencia: d.estructura.licencia }) : trp("ESTRUCTURA: {url} ({fuente}, {licencia}, medida)", { url: d.estructura.url, fuente: d.estructura.fuente, licencia: d.estructura.licencia })),
    h.hipotesis ? trp("HIPÓTESIS: {hipotesis}", { hipotesis: h.hipotesis }) : '',
    h.certeza ? `CERTEZA (GRADE): ${CERTEZA[h.certeza] ?? h.certeza}` : '',
    h.queSeHace ? trp("QUÉ SE HACE: {queSeHace}", { queSeHace: h.queSeHace }) : '',
    h.sistema ? `SISTEMA: ${SISTEMA[h.sistema] ?? h.sistema}` : '',
    h.controles ? `CONTROLES: ${h.controles}` : '',
    h.refuta ? trp("QUÉ LA REFUTARÍA: {refuta}", { refuta: h.refuta }) : '',
    h.faltan.length ? trp("SIN DEFINIR EN EL CONTRATO: {v}", { v: h.faltan.join(', ') }) : '',
    ...h.otrosExperimentos.flatMap((x, i) => [
      '',
      trp("OTRO EXPERIMENTO PROPUESTO ({v})", { v: i + 2 }),
      x.hipotesis ? trp("  HIPÓTESIS: {hipotesis}", { hipotesis: x.hipotesis }) : '',
      x.queSeHace ? trp("  QUÉ SE HACE: {queSeHace}", { queSeHace: x.queSeHace }) : '',
      x.sistema ? `  SISTEMA: ${SISTEMA[x.sistema] ?? x.sistema}` : '',
      x.controles ? `  CONTROLES: ${x.controles}` : '',
      x.refuta ? trp("  QUÉ LA REFUTARÍA: {refuta}", { refuta: x.refuta }) : '',
    ]),
    h.sinExperimento ? tr('NINGUNA HIPÓTESIS PROPONE TODAVÍA UN EXPERIMENTO SOBRE ESTA DIANA.') : '',
    h.sinExperimento && d.loQueSeSabe.length ? '' : '',
    ...(h.sinExperimento ? d.loQueSeSabe.flatMap((x) => [trp("LO QUE SE SABE · {tema}", { tema: x.tema }), `  ${x.enunciado}`, x.referencia ? `  [${x.referencia}]` : '']) : []),
    '',
    trp("EVIDENCIA: {hechos} afirmaciones la nombran, {sabidos} sostenidas por {fuentes} fuentes", { hechos: d.hechos, sabidos: d.sabidos, fuentes: d.fuentes }),
    d.investigaciones.length ? `INVESTIGACIONES: ${d.investigaciones.map((i) => i.titulo).join('; ')}` : '',
    '',
    tr('Lo reunió ROSA2018 a partir de lo que su evidencia nombra. ROSA2018 no ha diseñado ninguna estructura ni ha calculado acoplamientos.'),
  ];
  return l.filter(Boolean).join('\n');
}

const LECTURA: Record<string, string> = {
  compromiso_diana: tr('compromiso de diana'),
  mecanismo: 'mecanismo',
  desenlace: 'desenlace',
  seguridad: 'seguridad',
  control: 'control',
};
const NIVEL: Record<string, string> = {
  celular: 'celular',
  animal: 'animal',
  humano: 'humano',
  molecular: 'molecular',
};

/** Un campo largo del contrato. Se enseña entero: recortar media receta es
 *  mandar media receta. */
function Campo({ t, v, tono = '' }: { t: string; v: string; tono?: string }) {
  if (!v) return null;
  return (
    <div className={`lab-campo ${tono}`}>
      <dt>{t}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** El protocolo viene numerado por ROSA2018 («1. …\n2. …»). Se parte por esos
 *  números para que se lea como lo que es, una lista de pasos, en vez de como
 *  un muro de texto. */
function Protocolo({ texto }: { texto: string }) {
  const pasos = texto
    .split(/\n(?=\s*\d+\.\s)/)
    .map((x) => x.trim().replace(/^\d+\.\s*/, ''))
    .filter(Boolean);
  if (pasos.length < 2) return <p className="lab-parrafo">{texto}</p>;
  return (
    <ol className="lab-pasos">
      {pasos.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ol>
  );
}

function FichaQuimica({ q }: { q: QuimicaDeDiana }) {
  return (
    <div className="lab-quimica">
      <div className="lab-quimica-cab">
        <b>{q.nombre}</b>
        <span>{(q.juntas === 1 ? trp("en {v} afirmación junto a esta proteína", { v: q.juntas.toLocaleString('es') }) : trp("en {v} afirmaciones junto a esta proteína", { v: q.juntas.toLocaleString('es') }))}
        </span>
      </div>
      {q.enPubchem ? (
        <>
          {q.url2d ? <img className="lab-2d" src={q.url2d} alt={trp("Estructura plana de {nombre}", { nombre: q.nombre })} loading="lazy" /> : null}
          <dl className="lab-quimica-datos">
            <div>
              <dt>{tr("FÓRMULA")}</dt>
              <dd className="lab-mono">{q.formula}</dd>
            </div>
            <div>
              <dt>PESO</dt>
              <dd className="lab-mono">{q.peso} {tr("g/mol")}</dd>
            </div>
            <div>
              <dt>SMILES {q.smiles ? <Copiar texto={q.smiles} que={tr("el SMILES")} /> : null}</dt>
              <dd className="lab-mono lab-largo">{q.smiles}</dd>
            </div>
            <div>
              <dt>INCHIKEY {q.inchikey ? <Copiar texto={q.inchikey} que={tr("el InChIKey")} /> : null}</dt>
              <dd className="lab-mono">{q.inchikey}</dd>
            </div>
          </dl>
          {q.cerebro ? <p className="lab-nota">{q.cerebro.motivo}.</p> : null}
        </>
      ) : (
        <p className="lab-nota">
          {q.ontologiaId ? <span className="lab-mono">{q.ontologiaId}</span> : null} {tr("PubChem no lo tiene como molécula pequeña, así que no hay fórmula ni SMILES que mandar. Es lo normal en anticuerpos y en especies como el péptido amiloide, que se piden por su secuencia y no por su estructura química.")}
        </p>
      )}
    </div>
  );
}

/** El experimento entero, tal como está prerregistrado: el protocolo paso a
 *  paso, qué se mide, con qué controles, qué lo confirmaría y qué lo
 *  refutaría, la explicación rival, lo que cuesta y qué decisión cambia.
 *  Nada de esto lo escribe la pantalla; sale del contrato sellado. */
function Experimento({ diana, alCerrar }: { diana: DianaDeLaboratorio; alCerrar: () => void }) {
  const [cual, fijarCual] = useState(0);
  // El contrato entero se pide al abrir, no viene con el muro: son 100 KB por
  // visita que casi nadie llega a leer.
  const [contratos, fijarContratos] = useState<ExperimentoDeDiana[] | null>(null);
  const [falloContrato, fijarFalloContrato] = useState(false);
  useEffect(() => {
    let vivo = true;
    fijarContratos(null);
    fijarFalloContrato(false);
    if (!diana.hipotesis.length) return;
    void acciones.experimentosDe(diana.uniprot).then((r) => {
      if (!vivo) return;
      if (!r || r === 'sin_respuesta') return fijarFalloContrato(true);
      fijarContratos(r);
    });
    return () => {
      vivo = false;
    };
  }, [diana.uniprot, diana.hipotesis.length]);
  const h: ExperimentoDeDiana | undefined = contratos?.[cual];
  const cabecera = diana.hipotesis[cual];
  return (
    <section className="lab-experimento" aria-label={trp("Experimento sobre {simbolo}", { simbolo: diana.simbolo })}>
      <header>
        <div>
          <p className="lab-catalogo">
            <b>{tr("EL EXPERIMENTO")}</b> <i /> {diana.simbolo} <i />{trp(" UNIPROT {uniprot}", { uniprot: diana.uniprot })}
          </p>
          <h2>{cabecera ? cabecera.titulo : trp("Ninguna hipótesis propone todavía un experimento sobre {simbolo}", { simbolo: diana.simbolo })}</h2>
        </div>
        <div className="lab-acciones-exp">
          {h ? <Copiar texto={experimentoComoTexto(diana, h)} que={tr("el experimento entero")} clase="lab-copiar-grande" /> : null}
          <button type="button" className="lab-cerrar" onClick={alCerrar} aria-label={tr("Cerrar el experimento")}>
            ✕
          </button>
        </div>
      </header>

      {diana.hipotesis.length > 1 ? (
        <div className="lab-pestanas" role="tablist">
          {diana.hipotesis.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === cual} onClick={() => fijarCual(i)}>
              {i + 1}
              {x.decisionKiller ? <i className={`lab-punto-${KILLER[x.decisionKiller]?.tono ?? 'no'}`} /> : null}
            </button>
          ))}
          <span>
            {trp("{hipotesis} experimentos propuestos sobre esta proteína. No se funden en uno: cada uno tiene sus controles y su criterio de refutación.", { hipotesis: diana.hipotesis.length })}
          </span>
        </div>
      ) : null}

      <div className="lab-experimento-cuerpo">
        {diana.hipotesis.length && !contratos ? (
          <p className="lab-parrafo" role="status">
            {(falloContrato ? tr("No pude traer el contrato del experimento: el servidor no respondió. No quiere decir que no lo haya.") : tr("Trayendo el contrato del experimento…"))}
          </p>
        ) : null}
        {h ? (
          <>
            <div className="lab-insignias">
              <span className={`lab-grado lab-grado-${h.certeza ?? 'muy_baja'}`}>
                <i />{trp(" {v} · GRADE", { v: h.certeza ? (CERTEZA[h.certeza] ?? h.certeza) : tr('sin certeza asignada') })}</span>
              {h.decisionKiller && KILLER[h.decisionKiller] ? (
                <span className={`lab-grado lab-killer-${KILLER[h.decisionKiller]!.tono}`}>
                  <i /> {KILLER[h.decisionKiller]!.texto}
                </span>
              ) : null}
              {h.estadoExperimento ? (
                <span className="lab-grado lab-grado-neutro">
                  <i /> {h.estadoExperimento === 'propuesto' ? tr('propuesto, sin ejecutar') : h.estadoExperimento}
                </span>
              ) : null}
              {h.nivelDesenlace ? (
                <span className="lab-grado lab-grado-neutro">
                  <i />{trp(" desenlace {v}", { v: NIVEL[h.nivelDesenlace] ?? h.nivelDesenlace })}
                </span>
              ) : null}
            </div>

            {h.intervencion || h.sistema ? (
              <>
                <h3>{tr("QUÉ SE HACE")}</h3>
                {h.intervencion ? <p className="lab-parrafo lab-destacado">{h.intervencion}</p> : null}
                {h.sistema ? (
                  <p className="lab-parrafo">
                    <b>{tr("En")} {SISTEMA[h.sistema] ?? h.sistema}.</b> {h.quePrueba}
                  </p>
                ) : null}
              </>
            ) : null}

            {h.protocolo ? (
              <>
                <h3>{tr("EL PROTOCOLO, PASO A PASO")}</h3>
                <Protocolo texto={h.protocolo} />
              </>
            ) : null}

            {h.ensayo ? (
              <>
                <h3>{tr("QUÉ SE MIDE Y CON QUÉ")}</h3>
                <p className="lab-parrafo">{h.ensayo}</p>
              </>
            ) : null}

            {h.lecturas.length ? (
              <>
                <h3>{tr("LAS LECTURAS")}</h3>
                <div className="lab-lecturas">
                  {h.lecturas.map((l, i) => (
                    <div key={i}>
                      <b>{l.nombre}</b>
                      {l.tipo ? <span className="lab-tipo-lectura">{LECTURA[l.tipo] ?? l.tipo}</span> : null}
                      {l.queConfirma ? <p>{trp("Confirma: {queConfirma}", { queConfirma: l.queConfirma })}</p> : null}
                      {l.queRefuta ? <p className="lab-refuta-linea">{trp("Refuta: {queRefuta}", { queRefuta: l.queRefuta })}</p> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <h3>{tr("LO QUE DECIDE")}</h3>
            <dl className="lab-campos">
              <Campo t={tr("QUÉ LO CONFIRMARÍA")} v={h.confirma} />
              <Campo t={tr("QUÉ LO REFUTARÍA")} v={h.refuta} tono="lab-campo-refuta" />
              <Campo t={tr("LA EXPLICACIÓN RIVAL")} v={h.alternativa} />
              <Campo t="CONTROLES" v={h.controles} />
              <Campo t={tr("TAMAÑO MUESTRAL")} v={h.tamanoMuestral} />
              <Campo t={tr("QUÉ DECISIÓN CAMBIA")} v={h.decisionQueCambia} />
              <Campo t={tr("LO QUE CUESTA")} v={h.costeEstimado} />
              <Campo t={tr("QUÉ FALTARÍA PARA QUE BENEFICIE A ALGUIEN")} v={h.puenteAlBeneficio} />
            </dl>
          </>
        ) : (
          <p className="lab-parrafo">
            {trp("La evidencia de ROSA2018 señala esta proteína con {v} afirmaciones, pero ninguna hipótesis viva propone todavía un experimento sobre ella. No se rellena aquí un protocolo por rellenarlo: un experimento que nadie prerregistró no es un experimento.", { v: diana.hechos.toLocaleString('es') })}
          </p>
        )}

        {diana.quimica.length ? (
          <>
            <h3>{tr("LA QUÍMICA QUE SU EVIDENCIA NOMBRA")}</h3>
            <p className="lab-nota">
              {tr("Compuestos que aparecen en las mismas afirmaciones que esta proteína. Es coaparición en la evidencia, no afinidad medida: ROSA2018 no calcula acoplamientos. La identidad química es de PubChem.")}
            </p>
            {diana.quimica.map((q) => (
              <FichaQuimica key={q.nombre} q={q} />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** El experimento entero como texto plano, para mandarlo. Sale del contrato:
 *  aquí no se resume ni se añade nada. */
function experimentoComoTexto(d: DianaDeLaboratorio, h: ExperimentoDeDiana): string {
  const l = [
    trp("EXPERIMENTO SOBRE {simbolo} ({nombre})", { simbolo: d.simbolo, nombre: d.nombre }),
    `IDENTIFICADOR: UniProt ${d.uniprot}${d.hgnc ? ` · ${d.hgnc}` : ''}`,
    (d.estructura.clase === 'predicha' ? trp("ESTRUCTURA: {url} ({fuente}, {licencia}, predicha, no medida)", { url: d.estructura.url, fuente: d.estructura.fuente, licencia: d.estructura.licencia }) : trp("ESTRUCTURA: {url} ({fuente}, {licencia}, medida)", { url: d.estructura.url, fuente: d.estructura.fuente, licencia: d.estructura.licencia })),
    '',
    trp("HIPÓTESIS: {titulo}", { titulo: h.titulo }),
    h.certeza ? `CERTEZA (GRADE): ${CERTEZA[h.certeza] ?? h.certeza}` : '',
    h.estadoExperimento ? `ESTADO: ${h.estadoExperimento}` : '',
    '',
    h.intervencion ? trp("QUÉ SE HACE: {intervencion}", { intervencion: h.intervencion }) : '',
    h.sistema ? `SISTEMA: ${SISTEMA[h.sistema] ?? h.sistema}. ${h.quePrueba}` : '',
    '',
    h.protocolo ? `PROTOCOLO:\n${h.protocolo}` : '',
    '',
    h.ensayo ? trp("QUÉ SE MIDE: {ensayo}", { ensayo: h.ensayo }) : '',
    ...h.lecturas.flatMap((x) => [
      `LECTURA: ${x.nombre}${x.tipo ? ` (${x.tipo})` : ''}`,
      x.queConfirma ? `  CONFIRMA: ${x.queConfirma}` : '',
      x.queRefuta ? `  REFUTA: ${x.queRefuta}` : '',
    ]),
    '',
    h.confirma ? trp("QUÉ LO CONFIRMARÍA: {confirma}", { confirma: h.confirma }) : '',
    h.refuta ? trp("QUÉ LO REFUTARÍA: {refuta}", { refuta: h.refuta }) : '',
    h.alternativa ? trp("EXPLICACIÓN RIVAL: {alternativa}", { alternativa: h.alternativa }) : '',
    h.controles ? `CONTROLES: ${h.controles}` : '',
    h.tamanoMuestral ? trp("TAMAÑO MUESTRAL: {tamanoMuestral}", { tamanoMuestral: h.tamanoMuestral }) : '',
    h.decisionQueCambia ? trp("QUÉ DECISIÓN CAMBIA: {decisionQueCambia}", { decisionQueCambia: h.decisionQueCambia }) : '',
    h.costeEstimado ? trp("LO QUE CUESTA: {costeEstimado}", { costeEstimado: h.costeEstimado }) : '',
    h.puenteAlBeneficio ? trp("QUÉ FALTARÍA PARA QUE BENEFICIE A ALGUIEN: {puenteAlBeneficio}", { puenteAlBeneficio: h.puenteAlBeneficio }) : '',
    '',
    ...d.quimica.flatMap((q) => [
      `COMPUESTO NOMBRADO JUNTO A ESTA DIANA: ${q.nombre} (en ${q.juntas} afirmaciones)${q.ontologiaId ? ` · ${q.ontologiaId}` : ''}`,
      q.formula ? trp('  FÓRMULA: {formula}  ·  PESO: {peso} g/mol', { formula: q.formula, peso: q.peso ?? '' }) : '',
      q.smiles ? `  SMILES: ${q.smiles}` : '',
      q.inchikey ? `  INCHIKEY: ${q.inchikey}` : '',
      !q.enPubchem ? tr('  Sin ficha de molécula pequeña en PubChem: no hay SMILES que mandar.') : '',
    ]),
    '',
    trp("EVIDENCIA: {hechos} afirmaciones de ROSA2018 nombran esta proteína, {sabidos} sostenidas por {fuentes} fuentes.", { hechos: d.hechos, sabidos: d.sabidos, fuentes: d.fuentes }),
    d.investigaciones.length ? `INVESTIGACIONES: ${d.investigaciones.map((i) => i.titulo).join('; ')}` : '',
    '',
    tr('Lo reunió ROSA2018 de lo que su evidencia nombra y de contratos de experimento ya prerregistrados. ROSA2018 no ha diseñado ninguna estructura, no calcula acoplamientos y no propone estructuras nuevas.'),
  ];
  return l.filter((x) => x !== '').join('\n');
}

/** Lo que se puede decir de un tramo de la proteína.
 *
 *  Dos fuentes y ninguna más: UniProt dice qué es y con qué prueba lo anota, y
 *  el propio fichero de coordenadas da la secuencia de ese tramo y la
 *  confianza del modelo en él. La secuencia importa porque es lo que se pide a
 *  un laboratorio para hacer un péptido o un constructo; la confianza importa
 *  porque un tramo puede estar bien anotado y mal modelado, y son dos cosas
 *  distintas que aquí se ven juntas. */
function Parte({
  marca,
  diana,
  residuos,
  plddtProteina,
  alCerrar,
}: {
  marca: Marca;
  diana: DianaDeLaboratorio;
  residuos: Residuo[];
  plddtProteina: number;
  alCerrar: () => void;
}) {
  const largo = marca.hasta - marca.desde + 1;
  const secuencia = residuos.map((r) => UNA_LETRA[r.aa] ?? 'X').join('');
  const media = residuos.length ? residuos.reduce((a, r) => a + r.plddt, 0) / residuos.length : 0;
  const fiables = residuos.filter((r) => r.plddt > 70).length;
  const pct = residuos.length ? Math.round((fiables / residuos.length) * 100) : 0;
  const faltan = largo - residuos.length;
  return (
    <section className="lab-parte" aria-label={trp("{nombre} de {simbolo}", { nombre: marca.nombre, simbolo: diana.simbolo })}>
      <header>
        <div>
          <p className="lab-catalogo">
            <b>{diana.simbolo}</b> <i /> {marca.desde === marca.hasta ? `RESIDUO ${marca.desde}` : `RESIDUOS ${marca.desde}–${marca.hasta}`}
          </p>
          <h3>{marca.nombre}</h3>
          {marca.descripcion ? <p className="lab-parte-desc">{marca.descripcion}</p> : null}
        </div>
        <button type="button" className="lab-cerrar" onClick={alCerrar} aria-label={tr("Cerrar esta parte")}>
          ✕
        </button>
      </header>

      <div className="lab-parte-cifras">
        <div>
          <b>{largo.toLocaleString('es')}</b>
          <span>{(largo === 1 ? tr("RESIDUO") : tr("AMINOÁCIDOS"))}</span>
        </div>
        <div>
          <b>{media.toFixed(0)}</b>
          <span>{tr("pLDDT MEDIO")}</span>
        </div>
        <div className={pct < 50 ? 'lab-ojo' : ''}>
          <b>{pct} %</b>
          <span>{tr("FIABLE AQUÍ")}</span>
        </div>
      </div>

      <p className="lab-parte-lectura">
        {tr("El modelo se fía")} <b>{confianzaEnPalabras(media)}</b> {tr("de este tramo; de la proteína entera se fía")}{' '}
        <b>{confianzaEnPalabras(plddtProteina)}</b>{trp(" (pLDDT medio {v}). Un tramo puede estar bien anotado y mal modelado: lo que es sale de UniProt y lo bien resuelto que está, de AlphaFold.", { v: plddtProteina.toFixed(0) })}
      </p>

      {secuencia ? (
        <>
          <h4>
            {tr("LA SECUENCIA DE ESTE TRAMO")} <Copiar texto={secuencia} que={tr("la secuencia")} />
          </h4>
          <p className="lab-secuencia">{secuencia}</p>
          <p className="lab-nota">
            {trp("En código de una letra, leída del propio fichero de coordenadas. Es lo que se manda para hacer un péptido o un constructo.{v}", { v: faltan > 0 ? trp(" Faltan {faltan} residuos del tramo que el modelo no resuelve.", { faltan }) : '' })}
          </p>
        </>
      ) : null}

      <h4>{tr("DE DÓNDE SALE")}</h4>
      {marca.pruebas.length ? (
        <ul className="lab-pruebas">
          {marca.pruebas.map((x, i) => (
            <li key={i}>
              {PRUEBA[x.codigo] ?? `prueba ${x.codigo}`}
              {x.fuente ? <span className="lab-mono"> · {x.fuente}</span> : null}
              <span className="lab-mono lab-eco">{x.codigo}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lab-nota">{tr("UniProt no dice con qué prueba la anota.")}</p>
      )}
      <p className="lab-nota">
        {tr("Anotación de")}{' '}
        <a href={`https://www.uniprot.org/uniprotkb/${diana.uniprot}/entry#function`} target="_blank" rel="noreferrer">{trp("UniProt {uniprot}", { uniprot: diana.uniprot })}
        </a>{' '}
        {tr("(CC BY 4.0). ROSA2018 no la ha deducido: la trae y dice con qué prueba está.")}
      </p>
    </section>
  );
}

/** Lo que se puede decir de UN residuo.
 *
 *  Tres cosas y ninguna inventada: qué aminoácido es y qué implica eso
 *  (química de libro), cuánto se fía el modelo de él (del propio fichero), y
 *  dónde cae dentro de lo que UniProt anota. Lo de «enterrado» sale de contar
 *  vecinos a diez ángstrom, que es una medida cruda y así se dice: no es
 *  superficie accesible al disolvente. */
function FichaResiduo({
  r,
  diana,
  marcas,
  vecinos,
  contexto,
  alCerrar,
}: {
  r: Residuo;
  diana: DianaDeLaboratorio;
  marcas: Marca[];
  vecinos: number;
  contexto: Residuo[];
  alCerrar: () => void;
}) {
  const info = AMINOACIDOS[r.aa];
  const nombre = AMINOACIDO[r.aa] ?? r.aa;
  const letra = UNA_LETRA[r.aa] ?? 'X';
  const dentro = marcas.filter((m) => r.numero >= m.desde && r.numero <= m.hasta);
  // Un residuo del interior de una proteína plegada suele pasar de veinte
  // vecinos a diez ángstrom; uno de la superficie se queda por debajo de doce.
  const donde = vecinos >= 20 ? tr('enterrado en el interior') : vecinos <= 11 ? tr('asomado a la superficie') : tr('a media profundidad');
  return (
    <section className="lab-parte lab-residuo-ficha" aria-label={trp("Residuo {numero} de {simbolo}", { numero: r.numero, simbolo: diana.simbolo })}>
      <header>
        <div>
          <p className="lab-catalogo">
            <b>{diana.simbolo}</b> <i />{trp(" RESIDUO {numero} ", { numero: r.numero })}<i /> {letra}
          </p>
          <h3>
            {nombre} {r.numero}
          </h3>
          {info ? (
            <p className="lab-parte-desc">{(info.polar ? trp("Cadena lateral polar, {v}.", { v: info.carga === 'sin carga' ? 'sin carga' : trp("con carga {carga}", { carga: info.carga }) }) : trp("Cadena lateral apolar, {v}.", { v: info.carga === 'sin carga' ? 'sin carga' : trp("con carga {carga}", { carga: info.carga }) }))}</p>
          ) : null}
        </div>
        <button type="button" className="lab-cerrar" onClick={alCerrar} aria-label={tr("Cerrar este residuo")}>
          ✕
        </button>
      </header>

      <div className="lab-parte-cifras">
        <div className={r.plddt <= 50 ? 'lab-ojo' : ''}>
          <b>{r.plddt.toFixed(0)}</b>
          <span>{tr("pLDDT")}</span>
        </div>
        <div>
          <b>{vecinos}</b>
          <span>{tr("VECINOS A 10 Å")}</span>
        </div>
      </div>

      <p className="lab-parte-lectura">
        {tr("El modelo se fía")} <b>{confianzaEnPalabras(r.plddt)}</b> {tr("de dónde está este residuo, y lo coloca")}{' '}
        <b>{donde}</b>{tr(". Lo de la profundidad sale de contar cuántos residuos tienen su centro a menos de diez ángstrom: es una cuenta cruda, no superficie accesible al disolvente.")}
      </p>

      {info ? (
        <>
          <h4>{tr("QUÉ IMPLICA MUTARLO")}</h4>
          <p className="lab-parte-lectura">{info.nota[0]!.toUpperCase() + info.nota.slice(1)}.</p>
          <p className="lab-nota">
            {tr("Química del aminoácido, de libro de texto. No es una medida sobre esta proteína ni una predicción de ROSA2018.")}
          </p>
        </>
      ) : null}

      <h4>{tr("DÓNDE CAE")}</h4>
      {dentro.length ? (
        <ul className="lab-pruebas">
          {dentro.map((m) => (
            <li key={`${m.nombre}-${m.desde}`}>
              {tr("dentro de")} <b>{m.nombre.toLowerCase()}</b>
              <span className="lab-mono lab-eco">
                {trp("{v} · UniProt", { v: m.desde === m.hasta ? `residuo ${m.desde}` : `${m.desde}–${m.hasta}` })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lab-nota">{tr("Fuera de todo lo que UniProt anota en esta proteína. No quiere decir que no importe: quiere decir que nadie lo ha anotado.")}</p>
      )}

      {contexto.length ? (
        <>
          <h4>
            {tr("EN LA SECUENCIA")} <Copiar texto={contexto.map((x) => UNA_LETRA[x.aa] ?? 'X').join('')} que={tr("el tramo")} />
          </h4>
          <p className="lab-secuencia lab-secuencia-contexto">
            {contexto.map((x) => (
              <b key={x.numero} className={x.numero === r.numero ? 'lab-este' : undefined}>
                {UNA_LETRA[x.aa] ?? 'X'}
              </b>
            ))}
          </p>
          <p className="lab-nota">
            {trp("Del residuo {numero} al {numero2}, con este marcado.", { numero: contexto[0]!.numero, numero2: contexto[contexto.length - 1]!.numero })}
          </p>
        </>
      ) : null}
    </section>
  );
}

/** Cuántos nucleótidos tiene cada ala de 2'-MOE. Lo fija rosa/aso.py; aquí
 *  solo se enseña, y si allí cambia, la longitud real sale de las partes. */
const ALAS_LARGO = 5;

/** El candidato como texto plano, que es lo que se manda a un proveedor.
 *  Sale de lo que ya está en la ficha: aquí no se calcula ni se añade nada. */
function asoComoTexto(simbolo: string, d: DisenoAso, c: CandidatoAso): string {
  const p = c.partes;
  return [
    trp("OLIGONUCLEÓTIDO ANTISENTIDO CANDIDATO · DIANA {simbolo}", { simbolo }),
    '',
    `SECUENCIA (5' a 3'): ${c.secuencia}`,
    `ARQUITECTURA: ${d.quimica.arquitectura}  ->  ${p.ala5} | ${p.hueco} | ${p.ala3}`,
    trp("  alas ({ala5} nt cada una): {alas}", { ala5: p.ala5.length, alas: d.quimica.alas }),
    `  hueco (${p.hueco.length} nt): ${d.quimica.hueco}`,
    `  enlaces: ${d.quimica.enlaces}`,
    `  citosinas: ${d.quimica.citosinas}`,
    '',
    `TRANSCRITO: ${d.transcrito} (${d.largo} nt, build ${d.build})`,
    trp('POSICIÓN EN EL TRANSCRITO: {desde} a {hasta}{zona}', { desde: c.posicion, hasta: c.hasta, zona: c.region ? ` (${c.region})` : '' }),
    `TRAMO DIANA: 5'-${c.diana}-3'`,
    '',
    trp("PROPORCIÓN G+C: {v} %", { v: Math.round(c.gc * 100) }),
    trp("DINUCLEÓTIDOS CpG: {cpg}", { cpg: c.cpg }),
    `AUTOCOMPLEMENTARIEDAD: ${c.autocomplementariedad} nt`,
    trp("MOTIVOS DE ACTIVIDAD: {motivosBuenos} a favor, {motivosMalos} en contra", { motivosBuenos: c.motivosBuenos, motivosMalos: c.motivosMalos }),
    '',
    d.via ? trp("VÍA DE ADMINISTRACIÓN: {via}", { via: d.via.via }) : '',
    d.via ? `  ${d.via.porQue}` : '',
    d.via ? `  ${d.via.precedente}` : '',
    '',
    trp("CRIBADO CONTRA EL TRANSCRIPTOMA: {v}", { v: c.criba?.veredicto?.toUpperCase() ?? (c.cribado ? 'HECHO' : tr('NO HECHO')) }),
    `  ${c.criba?.porQue ?? c.avisoCribado}`,
    c.criba?.cribado && d.criba?.hecho
      ? trp("  comparado contra {v} transcritos de Ensembl GRCh38 ({v2}); encaja en {propios} transcritos de su propio gen", { v: d.criba.transcritos.toLocaleString('es'), v2: d.criba.ficheros.join(', '), propios: c.criba.propios })
      : '',
    c.criba?.fuera.length
      ? trp("  encaja también en: {v}{v2}", { v: c.criba.fuera.join(', '), v2: c.criba.genesFuera > c.criba.fuera.length ? trp(" y {v} genes más", { v: c.criba.genesFuera - c.criba.fuera.length }) : '' })
      : '',
    // Lo que el cribado NO cubre viaja con el pedido a propósito: quien lo
    // reciba tiene que saber que «sin choque exacto» no es «seguro».
    ...(d.criba?.hecho ? [tr('  lo que este cribado NO cubre:'), ...d.criba.limites.map((l) => `    - ${l.que}: ${l.porQue}`)] : []),
    '',
    c.especies ? trp("SE PUEDE PROBAR EN UN ROEDOR: {v}", { v: c.especies.veredicto.toUpperCase() }) : '',
    c.especies ? `  ${c.especies.porQue}` : '',
    ...(c.especies
      ? Object.values(c.especies.porEspecie).map((x) => `  ${x.nombre}: ${x.veredicto}${x.ortologo ? ` · gen ${x.ortologo}` : ''}`)
      : []),
    c.especies ? `  ${c.especies.marco.siNoEncaja}` : '',
    '',
    trp("El gen tiene {transcritosDelGen} transcritos; este diseño va sobre el canónico. Cuál se baja no es lo mismo que cuánta se baja, y esa decisión es de quien dirige el experimento.", { transcritosDelGen: d.transcritosDelGen }),
    '',
    tr('Lo generó ROSA2018 por regla a partir de la secuencia pública del transcrito. Es un CANDIDATO PARA CRIBAR EN EL LABORATORIO, no un fármaco: los filtros aplicados son estadística de experimentos pasados, no una predicción de que funcione.'),
    '',
    // De qué fiarse y de qué no viaja con el pedido: quien lo reciba tiene
    // que saber qué le están mandando, y eso no puede quedarse en la
    // pantalla de quien lo generó.
    ...(d.fiabilidad
      ? [
          '='.repeat(60),
          tr('DE QUÉ FIARSE Y DE QUÉ NO'),
          '',
          ...d.fiabilidad.niveles.flatMap((nv) => [
            nv.titulo.toUpperCase(),
            `  ${nv.resumen}`,
            ...nv.cosas.map((x) => `  - ${x.que}: ${x.porQue}`),
            '',
          ]),
          tr('LO QUE NO SE HA COMPROBADO'),
          ...d.fiabilidad.noComprobado.map((x) => `  - ${x.que}: ${x.porQue}`),
          '',
          tr('QUÉ ES ESTO'),
          `  ${d.fiabilidad.queEsEsto.es}`,
          `  ${d.fiabilidad.queEsEsto.noEs}`,
          `  ${d.fiabilidad.queEsEsto.comoSeUsa}`,
          `  ${d.fiabilidad.queEsEsto.yLaPremisa}`,
        ]
      : []),
  ].join('\n');
}

/* --------------------------------------------------------------------------
   El oligonucleótido antisentido
   --------------------------------------------------------------------------
   Es lo único que ROSA2018 puede diseñar de verdad, porque se calcula desde la
   secuencia y no hace falta predecir ninguna forma. La pieza visual es la
   propia secuencia partida en sus tres tramos: así es como se escribe en un
   pedido a un proveedor, y así se ve de un vistazo qué parte hace qué. */

/** La secuencia de un candidato, con sus tres tramos. El hueco central de ADN
 *  es lo que reconoce la RNasa H1 para cortar; las alas de 2'-MOE protegen de
 *  las nucleasas y suben la afinidad, pero no permiten el corte. */
function Secuencia({ c, grande = false }: { c: CandidatoAso; grande?: boolean }) {
  return (
    <div className={`aso-secuencia${grande ? ' aso-grande' : ''}`}>
      <span className="aso-extremo">5&apos;</span>
      <span className="aso-ala" title={tr("Ala de 2'-MOE: protege y agarra, pero aquí la RNasa H1 no corta")}>
        {c.partes.ala5}
      </span>
      <span className="aso-hueco" title={tr("Hueco de ADN: es lo que la RNasa H1 reconoce para cortar el ARN")}>
        {c.partes.hueco}
      </span>
      <span className="aso-ala" title={tr("Ala de 2'-MOE: protege y agarra, pero aquí la RNasa H1 no corta")}>
        {c.partes.ala3}
      </span>
      <span className="aso-extremo">3&apos;</span>
    </div>
  );
}

/** El transcrito entero como una regla, con los candidatos marcados encima.
 *  Sin esto, «posición 3230» no le dice nada a nadie: con esto se ve que los
 *  candidatos vienen de sitios distintos del ARN y no de la misma región. */
function MapaTranscrito({ d, activo, alElegir }: { d: DisenoAso; activo: number; alElegir: (i: number) => void }) {
  const c = d.candidatos[activo];
  const ancho = 720, alto = 250, izq = 56, der = 28, arriba = 28, abajo = 44;
  const x = (pos: number) => izq + (pos - 1) / Math.max(1, d.largo - 1) * (ancho - izq - der);
  const y = (gc: number) => arriba + (1 - gc) * (alto - arriba - abajo);
  return (
    <figure className="aso-mapa aso-mapa-datos">
      <header><div><strong>{tr("Un transcrito, distintos sitios de unión")}</strong><p>{tr("Cada punto es un candidato. Selecciónalo para inspeccionarlo.")}</p></div><span>{trp("{candidatos} candidatos", { candidatos: n(d.candidatos.length) })}</span></header>
      <div className="aso-mapa-lienzo">
        <svg viewBox={`0 0 ${ancho} ${alto}`} role="group" aria-label={tr("Candidatos por posición en el transcrito y proporción de G y C")}>
          <rect x={izq} y={y(.6)} width={ancho - izq - der} height={y(.4) - y(.6)} className="aso-mapa-banda" />
          {[0, .2, .4, .6, .8, 1].map(v => <g key={v}><line x1={izq} x2={ancho-der} y1={y(v)} y2={y(v)} className="aso-mapa-rejilla" /><text x={izq-10} y={y(v)+4} textAnchor="end">{Math.round(v*100)} %</text></g>)}
          {[1, Math.round(d.largo / 2), d.largo].map(pos => <text key={pos} x={x(pos)} y={alto-18} textAnchor={pos===1?'start':pos===d.largo?'end':'middle'}>{n(pos)} nt</text>)}
          {c && <line x1={x(c.posicion)} x2={x(c.posicion)} y1={arriba} y2={alto-abajo} className="aso-mapa-guia" />}
          {d.candidatos.map((candidato, i) => <g key={candidato.posicion} role="button" tabIndex={i===activo?0:-1} aria-pressed={i===activo} aria-label={trp("Candidato {v}, posición {posicion}, G y C {v2} por ciento", { v: i+1, posicion: candidato.posicion, v2: Math.round(candidato.gc*100) })} className={`aso-punto${i===activo?' aso-punto-activo':''}`} onClick={() => alElegir(i)} onKeyDown={e=>{
            if(e.key==='Enter'||e.key===' '){e.preventDefault();alElegir(i);}
            else if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){
              e.preventDefault();const siguiente=e.key==='Home'?0:e.key==='End'?d.candidatos.length-1:(i+(e.key==='ArrowRight'?1:d.candidatos.length-1))%d.candidatos.length;
              alElegir(siguiente);(e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('.aso-punto')[siguiente])?.focus();
            }
          }}>
            <circle cx={x(candidato.posicion)} cy={y(candidato.gc)} r={14} className="aso-punto-hit" />
            <circle cx={x(candidato.posicion)} cy={y(candidato.gc)} r={i===activo?7:4.5} className="aso-punto-dato" />
            <title>{trp("Candidato {v}: {posicion} a {hasta} nt; G y C {v2} %", { v: i+1, posicion: n(candidato.posicion), hasta: n(candidato.hasta), v2: Math.round(candidato.gc*100) })}</title>
          </g>)}
        </svg>
      </div>
      <figcaption><span><i /> {tr("Banda del filtro: 40 a 60 % de G y C")}</span><span>{d.transcrito}</span></figcaption>
      {c && <div className="aso-mapa-seleccion" aria-live="polite"><strong>{trp("Candidato {v}", { v: activo+1 })}</strong><span>{n(c.posicion)} a {n(c.hasta)} nt</span><span>{trp("{v} % de G y C", { v: Math.round(c.gc*100) })}</span></div>}
    </figure>
  );
}


/* --------------------------------------------------------------------------
   El ARN, con sus letras
   --------------------------------------------------------------------------
   Un ARN mensajero no es una cinta estirada: se dobla sobre sí mismo y forma
   horquillas. Si el tramo de veinte letras al que va el oligo está emparejado
   dentro de una de esas horquillas, el oligo no entra, por buenas que sean
   sus letras.

   Antes esto eran arcos, sin una sola letra. El 1 de octubre de 2026 el
   compañero de Emir pidió lo contrario: que mandaran las letras del ARN, en
   grande. Así que se dibuja el ARN como se dibuja de verdad, un nucleótido
   una letra, en el sitio que le toca.

   Las coordenadas NO son inventadas: vienen de `naview_xy_coordinates` de
   ViennaRNA, que es la disposición clásica del campo (la de RNAplot y la de
   casi cualquier figura de estructura secundaria publicada). Los tallos salen
   como escaleras y los bucles como círculos, sin que las ramas se pisen. */

const COLOR_LETRA: Record<string, string> = { A: 'arn-a', U: 'arn-u', G: 'arn-g', C: 'arn-c' };

function ArnPlegado({ d }: { d: NonNullable<NonNullable<DisenoAso['plegado']>['dibujo']> }) {
  const [sobre, fijarSobre] = useState<number | null>(null);
  const [zoom, fijarZoom] = useState(1);
  const letras = d.letras ?? [];
  if (!letras.length) return null;

  // El lienzo se ajusta a la proporción del plegado para que no salga
  // estirado: un ARN con un tallo largo es alto y estrecho, y forzarlo a un
  // cuadrado deformaría los bucles.
  const base = 760;
  const ancho = d.proporcion >= 1 ? base : base * Math.max(0.42, d.proporcion);
  const alto = d.proporcion >= 1 ? base / d.proporcion : base;
  const m = 24;
  const X = (v: number) => m + v * (ancho - 2 * m);
  const Y = (v: number) => m + v * (alto - 2 * m);
  const porI = new Map(letras.map((l) => [l.i, l]));
  const enElSitio = letras.filter((l) => l.enElSitio);
  const aAbrir = enElSitio.filter((l) => l.emparejada).length;
  const act = sobre !== null ? porI.get(sobre) : null;
  const parActivo = (d.pares ?? []).find(([a, b]) => a === sobre || b === sobre);
  const parejaActiva = parActivo?.find(i => i !== sobre);

  return (
    <figure className="arn">
      <div className="lab-grafica-barra"><div><strong>{tr("Estructura secundaria del ARN")}</strong><span>{tr("Tramo del oligo resaltado en ámbar")}</span></div><div className="lab-grafica-zoom" role="group" aria-label={tr("Ampliación del ARN")}><button type="button" aria-label={tr("Alejar ARN")} disabled={zoom <= 1} onClick={() => fijarZoom(Math.max(1, zoom - .5))}>−</button><output>{Math.round(zoom * 100)} %</output><button type="button" aria-label={tr("Acercar ARN")} disabled={zoom >= 3} onClick={() => fijarZoom(Math.min(3, zoom + .5))}>+</button></div></div>
      <div className="arn-ventana" tabIndex={0} aria-label={tr("Gráfica desplazable del ARN")}><div className="arn-escala" style={{ width: `${zoom * 100}%` }}>
      <svg
        className="arn-svg"
        viewBox={`0 0 ${ancho.toFixed(0)} ${alto.toFixed(0)}`}
        role="group"
        aria-label={trp("El ARN entre las posiciones {desde} y {hasta}, plegado, con el tramo del oligo marcado", { desde: d.desde, hasta: d.hasta })}
        onMouseLeave={() => fijarSobre(null)}
      >
        {/* El esqueleto: la cadena, de una letra a la siguiente. */}
        <path
          className="arn-cadena"
          d={letras.map((l, k) => `${k ? 'L' : 'M'} ${X(l.x).toFixed(1)} ${Y(l.y).toFixed(1)}`).join(' ')}
        />
        {/* El tramo del oligo, por encima del esqueleto: es el hilo que hay
            que dejar libre. */}
        {enElSitio.length > 1 ? (
          <path
            className="arn-cadena-sitio"
            d={enElSitio.map((l, k) => `${k ? 'L' : 'M'} ${X(l.x).toFixed(1)} ${Y(l.y).toFixed(1)}`).join(' ')}
          />
        ) : null}
        {/* Los pares: cada barra es un emparejamiento que mantiene cerrada la
            horquilla. Las que caen en el sitio del oligo van encendidas,
            porque son justo las que hay que abrir. */}
        {(d.pares ?? []).map(([a, b]) => {
          const la = porI.get(a);
          const lb = porI.get(b);
          if (!la || !lb) return null;
          const dentro = la.enElSitio || lb.enElSitio;
          return (
            <line
              key={`${a}-${b}`}
              x1={X(la.x)}
              y1={Y(la.y)}
              x2={X(lb.x)}
              y2={Y(lb.y)}
              className={`arn-par${dentro ? ' arn-par-sitio' : ''}${a === sobre || b === sobre ? ' arn-par-activo' : ''}`}
            />
          );
        })}
        {/* Y las letras, que es de lo que va todo esto. */}
        {letras.map((l) => (
          <g
            key={l.i}
            className={`arn-n${l.enElSitio ? ' arn-n-sitio' : ''}${sobre === l.i ? ' arn-n-sobre' : ''}${parejaActiva === l.i ? ' arn-n-pareja' : ''}`}
            role="button" tabIndex={sobre === l.i || (sobre === null && l.i === letras[0]?.i) ? 0 : -1}
            aria-label={(l.emparejada ? trp("{letra}, posición {pos}, emparejada{v}", { letra: l.letra, pos: l.pos, v: l.enElSitio ? tr(", tramo del oligo") : "" }) : trp("{letra}, posición {pos}, libre{v}", { letra: l.letra, pos: l.pos, v: l.enElSitio ? tr(", tramo del oligo") : "" }))}
            onFocus={() => fijarSobre(l.i)} onClick={() => fijarSobre(l.i)}
            onKeyDown={e => { if(e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const indice=letras.indexOf(l); const siguiente=(indice+(e.key==='ArrowRight'?1:letras.length-1))%letras.length; (e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('.arn-n')[siguiente])?.focus(); } else if(e.key==='Enter'||e.key===' ') {e.preventDefault(); fijarSobre(l.i);} }}
            onMouseEnter={() => fijarSobre(l.i)}
          >
            <circle cx={X(l.x)} cy={Y(l.y)} r={l.enElSitio ? 11.5 : 9.5} className="arn-disco" />
            <text x={X(l.x)} y={Y(l.y)} className={`arn-letra ${COLOR_LETRA[l.letra] ?? ''}`} textAnchor="middle" dominantBaseline="central">
              {l.letra}
            </text>
          </g>
        ))}
      </svg>
      </div></div>
      <figcaption className="arn-pie">
        <p className="arn-pie-cuenta">
          {act ? (
            <>
              <b className="lab-mono">{act.letra}</b> {tr("en la posición")} <b>{n(act.pos)}</b>{(act.emparejada ? trp(" del transcrito · emparejada{v}", { v: act.enElSitio ? tr(" · dentro del tramo del oligo") : "" }) : trp(" del transcrito · libre{v}", { v: act.enElSitio ? tr(" · dentro del tramo del oligo") : "" }))}
            </>
          ) : (
            <>
              <b>{n(aAbrir)}</b>{trp(" de las {enElSitio} letras del tramo están emparejadas: son las que el oligo tiene que abrir para entrar. Selecciona una letra para inspeccionarla; usa las flechas para recorrer la cadena.", { enElSitio: n(enElSitio.length) })}
            </>
          )}
        </p>
        <p className="arn-pie-nota">
          {trp("El ARN entre las posiciones {desde} y {hasta}, plegado sobre sí mismo ({energia} kcal/mol). Cada letra es un nucleótido en el sitio que le toca; las barras son emparejamientos. Disposición {disposicion}.", { desde: n(d.desde), hasta: n(d.hasta), energia: dec(d.energia, 1), disposicion: d.disposicion })}</p>
      </figcaption>
    </figure>
  );
}


/* --------------------------------------------------------------------------
   La dúplex: el ARN y el oligo encajando, letra por letra
   --------------------------------------------------------------------------
   Antes esto era una doble hélice con las letras de reparto, pequeñas. El 1 de
   octubre de 2026 el compañero de Emir pidió que mandaran las letras del ARN y
   que se vieran en grande, así que se dio la vuelta: ahora el ARN es la fila
   de arriba y en grande, el oligo encaja debajo, y entre los dos van las
   barras del emparejamiento.

   Lo que explica, y es lo que no se entiende leyendo veinte letras seguidas:
   por qué la arquitectura es 5-10-5. Las alas de 2'-MOE agarran, pero la
   RNasa H1 no las reconoce; solo ve el hueco de ADN del centro, y ahí corta.
   El hueco va encendido y el corte marcado.

   Los números de la hélice (giro 32,7 grados y subida 2,62 Å por par) vienen
   del backend, medidos para una dúplex híbrida de ARN con ADN. No se dibujan
   átomos: los parámetros dan la forma, no dónde está cada átomo de cada base,
   y dibujarlos sería inventarlos. */
function Duplex({ d }: { d: DuplexT }) {
  const [sobre, fijarSobre] = useState<number | null>(null);
  const n2 = d.pares.length;
  const paso = 40;
  const ancho = 52 + n2 * paso;
  const yArn = 46;
  const yAso = 132;
  const X = (i: number) => 36 + (i - 0.5) * paso;
  const [c1, c2] = d.dondeCorta;
  const act = sobre !== null ? d.pares.find((p) => p.i === sobre) : null;
  return (
    <figure className="dux">
      <div className="lab-grafica-barra"><div><strong>{tr("Encuentro del ARN y el oligo")}</strong><span>{tr("Dos cadenas antiparalelas, base a base")}</span></div><span className="lab-grafica-modelo">{tr("Esquema molecular")}</span></div>
      <p className="lab-grafica-desplazar">{tr("Desliza la figura para recorrer las dos cadenas.")}</p>
      <div className="dux-marco" tabIndex={0} aria-label={tr("Gráfica desplazable de la dúplex")}>
        <svg
          className="dux-svg"
          viewBox={`0 0 ${ancho} 196`}
          role="group"
          aria-label={tr("El ARN de la diana con el oligo encajando debajo")}
          onMouseLeave={() => fijarSobre(null)}
        >
          {/* El hueco de ADN, de fondo: es lo único que la RNasa H1 reconoce. */}
          <rect
            x={X(d.hueco[0]) - paso / 2}
            y={18}
            width={(d.hueco[1] - d.hueco[0] + 1) * paso}
            height={150}
            className="dux-hueco"
            rx="10"
          />
          {/* Las dos cadenas, de fondo. */}
          <line x1={20} y1={yArn} x2={ancho - 20} y2={yArn} className="dux-hebra dux-hebra-arn" />
          <line x1={20} y1={yAso} x2={ancho - 20} y2={yAso} className="dux-hebra dux-hebra-aso" />
          {d.pares.map((p) => (
            <g
              key={p.i}
              className={`dux-col${sobre === p.i ? ' dux-col-sobre' : ''}`}
              role="button" tabIndex={sobre === p.i || (sobre === null && p.i === d.pares[0]?.i) ? 0 : -1}
              aria-label={(p.quimica === 'hueco' ? trp("Par {i}: ARN {arn}, oligo {aso}, hueco de ADN", { i: p.i, arn: p.arn, aso: p.aso }) : trp("Par {i}: ARN {arn}, oligo {aso}, ala de 2′-MOE", { i: p.i, arn: p.arn, aso: p.aso }))}
              onClick={() => fijarSobre(p.i)} onFocus={() => fijarSobre(p.i)}
              onKeyDown={e => {if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault(); const indice=d.pares.indexOf(p);const siguiente=(indice+(e.key==='ArrowRight'?1:d.pares.length-1))%d.pares.length;(e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('.dux-col')[siguiente])?.focus();} else if(e.key==='Enter'||e.key===' '){e.preventDefault();fijarSobre(p.i);}}}
              onMouseEnter={() => fijarSobre(p.i)}
            >
              {/* La barra del emparejamiento. */}
              <line x1={X(p.i)} y1={yArn + 15} x2={X(p.i)} y2={yAso - 15} className={`dux-par dux-par-${p.quimica}`} />
              <circle cx={X(p.i)} cy={yArn} r={16} className="dux-base-arn" />
              <circle cx={X(p.i)} cy={yAso} r={13} className="dux-base-aso" />
              <text x={X(p.i)} y={8} className="dux-indice" textAnchor="middle">{p.i}</text>
              {/* La letra del ARN, que es la que manda. */}
              <text x={X(p.i)} y={yArn} className="dux-arn" textAnchor="middle" dominantBaseline="central">
                {p.arn}
              </text>
              {/* Y la del oligo, debajo. */}
              <text x={X(p.i)} y={yAso} className={`dux-aso dux-aso-${p.quimica}`} textAnchor="middle" dominantBaseline="central">
                {p.aso}
              </text>
            </g>
          ))}
          {/* Los extremos, que en biología no son decoración: dicen en qué
              sentido se lee cada cadena, y una dúplex es antiparalela. */}
          <text x={16} y={yArn} className="dux-extremo" textAnchor="end" dominantBaseline="central">
            5&apos;
          </text>
          <text x={ancho - 16} y={yArn} className="dux-extremo" textAnchor="start" dominantBaseline="central">
            3&apos;
          </text>
          <text x={16} y={yAso} className="dux-extremo" textAnchor="end" dominantBaseline="central">
            3&apos;
          </text>
          <text x={ancho - 16} y={yAso} className="dux-extremo" textAnchor="start" dominantBaseline="central">
            5&apos;
          </text>
          {/* Dónde corta la RNasa H1. */}
          <path d={`M ${X(c1)} ${178} L ${X(c2)} ${178}`} className="dux-corte" />
          <text x={(X(c1) + X(c2)) / 2} y={192} className="dux-corte-texto" textAnchor="middle">
            {tr("aquí corta la RNasa H1")}
          </text>
        </svg>
      </div>
      <figcaption className="dux-pie">
        <p className="dux-pie-cuenta">
          {act ? (
            <>
              ARN <b className="lab-mono">{act.arn}</b> {tr("con oligo")} <b className="lab-mono">{act.aso}</b> · letra{' '}
              <b>{act.posAso}</b>{(act.quimica === 'hueco' ? tr(" del oligo · en el hueco de ADN, que es donde corta") : tr(" del oligo · en un ala de 2'-MOE, que la enzima no reconoce"))}
            </>
          ) : (
            <>
              {tr("Arriba el ARN de la diana leído de 5&apos; a 3&apos;, abajo el oligo, que va al revés porque una dúplex es antiparalela. Las")}{' '}
              <b>{trp("{v} del centro", { v: n(d.hueco[1] - d.hueco[0] + 1) })}</b> {tr("son el hueco de ADN: lo único que la RNasa H1 reconoce. Selecciona un par o recórrelos con las flechas del teclado.")}
            </>
          )}
        </p>
        <div className="dux-claves">
          <span className="dux-clave">
            <i className="dux-c-arn" /> {tr("el ARN de la diana")}
          </span>
          <span className="dux-clave">
            <i className="dux-c-ala" /> {tr("alas de 2&apos;-MOE")}
          </span>
          <span className="dux-clave">
            <i className="dux-c-hueco" /> {tr("hueco de ADN")}
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

/** La dúplex con su explicación y sus avisos. */
function FichaDuplex({ c }: { c: CandidatoAso }) {
  const d = c.duplex;
  if (!d) return null;
  return (
    <section className="aso-criba">
      <h3>{tr("CÓMO QUEDA PEGADO AL ARN")}</h3>
      <p className="aso-criba-porque">{d.porQueSoloElHueco}</p>
      <Duplex d={d} />
      <dl className="aso-criba-cuentas">
        <div>
          <dt>{tr("largo de la dúplex")}</dt>
          <dd>{dec(d.largoAngstroms, 1)} Å</dd>
        </div>
        <div>
          <dt>{tr("vueltas de hélice")}</dt>
          <dd>{dec(d.vueltas, 2)}</dd>
        </div>
        <div>
          <dt>{tr("giro por par")}</dt>
          <dd>{dec(d.giroPorPar, 1)}°</dd>
        </div>
        <div>
          <dt>{tr("surco menor")}</dt>
          <dd>~{dec(d.surcoMenor, 1)} Å</dd>
        </div>
      </dl>
      <p className="aso-criba-como">{d.porQueHibrida}</p>
      <ul className="dup-que-es">
        <li>
          <b>{tr("Alas:")}</b> {d.queEs.ala}
        </li>
        <li>
          <b>{tr("Hueco:")}</b> {d.queEs.hueco}
        </li>
        <li>
          <b>{tr("ARN:")}</b> {d.queEs.arn}
        </li>
      </ul>
      <details className="aso-criba-limites">
        <summary>{trp("Qué es y qué NO es este dibujo ({avisos})", { avisos: d.avisos.length })}</summary>
        <ul>
          {d.avisos.map((a) => (
            <li key={a.que}>
              <b>{a.que}.</b> {a.porQue}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}


/* --------------------------------------------------------------------------
   ¿Se puede probar en un roedor?
   --------------------------------------------------------------------------
   Es la pregunta práctica: si el oligo encaja en el ARN del ratón o de la
   rata, el experimento con animales se hace con ESTA misma molécula y se
   puede empezar mañana. Si no, hay que diseñar un oligo sustituto contra la
   secuencia del animal, probar ese, y aceptar que lo que se mide no es
   exactamente lo que iría a la persona.

   Se llegó a montar también el macaco, por el expediente regulatorio, y se
   quitó: cuesta decenas de miles de dólares, no se van a hacer experimentos
   con uno, y para investigar no hace falta. Lo de «dos especies» es de mucho
   después, al presentar para meterlo en personas. */
const CLASE_ESPECIE: Record<string, string> = {
  'se puede probar': 'aso-criba-bien',
  'hace falta un sustituto': 'aso-criba-mal',
  'no pude comprobar': 'aso-criba-duda',
};

function FichaEspecies({ c }: { c: CandidatoAso }) {
  const e = c.especies;
  if (!e) return null;
  const porEspecie = Object.values(e.porEspecie ?? {});
  return (
    <section className={`aso-criba ${CLASE_ESPECIE[e.veredicto] ?? 'aso-criba-duda'}`}>
      <h3>{tr("¿SE PUEDE PROBAR EN UN ROEDOR?")}</h3>
      <p className="aso-criba-titulo">
        {e.veredicto === 'se puede probar'
          ? tr('Sí: el experimento se hace con esta misma molécula')
          : e.veredicto === 'hace falta un sustituto'
            ? tr('No: haría falta un oligo sustituto para el animal')
            : tr('No se pudo comprobar')}
      </p>
      <p className="aso-criba-porque">{e.porQue}</p>
      <table className="esp-tabla">
        <thead>
          <tr>
            <th>{tr("especie")}</th>
            <th>gen</th>
            <th>{tr("veredicto")}</th>
          </tr>
        </thead>
        <tbody>
          {porEspecie.map((x) => (
            <tr key={x.clave} className={x.sirve ? 'esp-si' : x.sirve === false ? 'esp-no' : 'esp-duda'}>
              <th>
                {x.nombre}
                <i>{x.latin}</i>
              </th>
              <td className="lab-mono">{x.ortologo || '—'}</td>
              <td>
                {x.veredicto}
                {x.fallos ? (x.fallos === 1 ? trp(" ({fallos} letra de diferencia)", { fallos: n(x.fallos) }) : trp(" ({fallos} letras de diferencia)", { fallos: n(x.fallos) })) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* El porqué de cada especie que no es un «sí» limpio. Sin esto un «no
          pude comprobar» se queda en dos palabras y parece un «no». */}
      {porEspecie.some((x) => !x.sirve) ? (
        <ul className="esp-porques">
          {porEspecie
            .filter((x) => !x.sirve)
            .map((x) => (
              <li key={x.clave} className={x.sirve === null ? 'esp-porque-duda' : ''}>
                <b>{x.nombre}:</b> {x.porQue}
              </li>
            ))}
        </ul>
      ) : null}
      <ul className="esp-vias">
        {porEspecie.map((x) => (
          <li key={x.clave}>
            <b>{x.nombre}:</b> {x.via}
          </li>
        ))}
      </ul>
      <details className="aso-criba-limites">
        <summary>{trp("Qué NO dice esto ({v})", { v: e.avisos.length + 1 })}</summary>
        <ul>
          <li>
            <b>{tr("Para qué sirve esto.")}</b> {e.marco.paraInvestigar} {e.marco.siNoEncaja}
          </li>
          {e.avisos.map((a) => (
            <li key={a.que}>
              <b>{a.que}.</b> {a.porQue}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/* --------------------------------------------------------------------------
   De qué fiarse y de qué no
   --------------------------------------------------------------------------
   Lo pidió Emir después de preguntar qué tan real era todo esto: que la
   justificación esté en la pantalla y no en los comentarios del código, «para
   que el que lee lo sepa».

   El orden de los niveles no es casual: primero lo que se puede comprobar,
   último lo que decidió ROSA2018 y nadie ha validado, que es lo que más fácil
   sería callar. */
const ETIQUETA_NIVEL: Record<string, string> = {
  exacto: 'fia-exacto',
  modelo: 'fia-modelo',
  estadistica: 'fia-estadistica',
  mio: 'fia-mio',
};

function Fiabilidad({ f }: { f: NonNullable<DisenoAso['fiabilidad']> }) {
  return (
    <section className="fia">
      <h3>{tr("DE QUÉ FIARSE Y DE QUÉ NO")}</h3>
      <p className="fia-que-es">
        <b>{tr("Qué es esto:")}</b> {f.queEsEsto.es} <b>{f.queEsEsto.noEs}</b> {f.queEsEsto.comoSeUsa}
      </p>
      <p className="fia-premisa">{f.queEsEsto.yLaPremisa}</p>
      <ol className="fia-niveles">
        {f.niveles.map((nv) => (
          <li key={nv.nivel} className={ETIQUETA_NIVEL[nv.nivel] ?? ''}>
            <h4>{nv.titulo}</h4>
            <p className="fia-resumen">{nv.resumen}</p>
            <ul>
              {nv.cosas.map((c) => (
                <li key={c.que}>
                  <b>{c.que}.</b> {c.porQue}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <h4 className="fia-falta-titulo">{tr("Lo que NO se ha comprobado")}</h4>
      <ul className="fia-falta">
        {f.noComprobado.map((c) => (
          <li key={c.que}>
            <b>{c.que}.</b> {c.porQue}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Si el sitio del candidato está abierto o tapado, con el número crudo al lado. */
function FichaSitio({ c, d }: { c: CandidatoAso; d: DisenoAso }) {
  const s = c.sitio;
  const pl = d.plegado;
  if (!pl) return null;
  if (!pl.hecho || !s) {
    return (
      <section className="aso-criba aso-criba-duda">
        <h3>{tr("¿ESTÁ ABIERTO EL SITIO?")}</h3>
        <p className="aso-criba-titulo">{tr("No se pudo calcular")}</p>
        <p className="aso-criba-porque">{pl.motivo || tr('Falta el cálculo del plegado. No quiere decir que el sitio esté tapado.')}</p>
      </section>
    );
  }
  const clase = s.etiqueta === 'abierto' ? 'aso-criba-bien' : s.etiqueta === 'medio' ? 'aso-criba-duda' : 'aso-criba-mal';
  return (
    <section className={`aso-criba ${clase}`}>
      <h3>{tr("¿ESTÁ ABIERTO EL SITIO EN EL ARN?")}</h3>
      <p className="aso-criba-titulo">
        {s.etiqueta === 'abierto' ? tr('El tramo está abierto') : s.etiqueta === 'medio' ? tr('El tramo está a medias') : tr('El tramo está tapado')}
      </p>
      <p className="aso-criba-porque">{s.comoSeLee}</p>
      <dl className="aso-criba-cuentas">
        <div>
          <dt>{tr("accesibilidad")}</dt>
          <dd>{dec(s.accesibilidad, 4)}</dd>
        </div>
        <div>
          <dt>{tr("en su transcrito")}</dt>
          <dd>{trp("mejor que el {v} %", { v: s.percentil.toFixed(0) })}</dd>
        </div>
        <div>
          <dt>{tr("el mejor sitio que hay")}</dt>
          <dd>{trp("{mejorDelTranscrito} en la posición {posicionMejor}", { mejorDelTranscrito: dec(s.mejorDelTranscrito, 3), posicionMejor: n(s.posicionMejor) })}</dd>
        </div>
        <div>
          <dt>{tr("mediana del transcrito")}</dt>
          <dd>{dec(s.medianaDelTranscrito, 4)}</dd>
        </div>
      </dl>
      {pl.dibujo ? (
        <>
          <ArnPlegado d={pl.dibujo} />
        </>
      ) : null}
      <details className="aso-criba-limites">
        <summary>{trp("Qué NO dice este cálculo ({avisos})", { avisos: pl.avisos.length })}</summary>
        <ul>
          {pl.avisos.map((a) => (
            <li key={a.que}>
              <b>{a.que}.</b> {a.porQue}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** El título y el color de un veredicto del cribado, en UN sitio.
 *
 *  Estaba duplicado en la ficha del candidato y en la tarjeta de la decisión,
 *  y las dos veces que apareció un veredicto nuevo («sin parecido», «al borde
 *  del azar») una de las dos copias se quedó atrás y el título decía «encaja
 *  en otro gen» justo encima de un texto que decía lo contrario. Con una sola
 *  función eso no puede volver a pasar. */
function tituloCriba(v: string | undefined): { titulo: string; clase: 'bien' | 'mal' | 'duda' } {
  switch (v) {
    case 'descartado':
      return { titulo: tr('No se puede pedir: encaja en otro gen donde la RNasa H1 cortaría'), clase: 'mal' };
    case 'sin parecido':
      return { titulo: tr('Sin parecido peligroso en ningún otro ARN humano'), clase: 'bien' };
    case 'sin choque exacto':
      return { titulo: tr('Sin choque exacto en ningún otro ARN humano'), clase: 'bien' };
    case 'al borde del azar':
      return { titulo: tr('Se parece a otros genes, pero al borde de lo que da el azar'), clase: 'duda' };
    case 'revisar':
      return { titulo: tr('No aparece ni en su propio gen: hay que aclararlo'), clase: 'duda' };
    default:
      return { titulo: tr('Sin cribar contra el transcriptoma'), clase: 'duda' };
  }
}

/** El cribado de un candidato contra el transcriptoma humano entero.
 *
 * Es el bloque que decide si un candidato se puede pedir o no, así que enseña
 * el veredicto y TAMBIÉN lo que el cribado no cubre. Un cribado que se vende
 * como completo y no lo es hace más daño que no tenerlo. */
function FichaCriba({ c, d }: { c: CandidatoAso; d: DisenoAso }) {
  const v = c.criba?.veredicto ?? (c.cribado ? "sin choque exacto" : "sin cribar");
  const cr = c.criba;
  const criba = d.criba;
  const { titulo, clase: cl } = tituloCriba(v);
  const clase = `aso-criba-${cl}`;
  return (
    <section className={`aso-criba ${clase}`}>
      <h3>{tr("CRIBADO CONTRA EL TRANSCRIPTOMA HUMANO")}</h3>
      <p className="aso-criba-titulo">{titulo}</p>
      <p className="aso-criba-porque">{cr?.porQue ?? c.avisoCribado}</p>
      {cr?.cribado ? (
        <dl className="aso-criba-cuentas">
          <div>
            <dt>{tr("en su propio gen")}</dt>
            <dd>{trp("{propios} transcritos", { propios: n(cr.propios) })}</dd>
          </div>
          <div>
            <dt>{tr("en otros genes")}</dt>
            <dd className={cr.genesFuera ? "mal" : ""}>
              {cr.genesFuera ? `${n(cr.genesFuera)} genes, ${n(cr.transcritosFuera)} transcritos` : "ninguno"}
            </dd>
          </div>
          {cr.genesMismoSitio ? (
            <div>
              <dt>{tr("mismo sitio, otro nombre")}</dt>
              <dd>{trp("{transcritosMismoSitio} transcritos", { transcritosMismoSitio: n(cr.transcritosMismoSitio) })}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {cr?.fuera.length ? (
        <p className="aso-criba-genes">
          <b>{tr("Dónde más encaja:")}</b> {cr.fuera.join(", ")}
          {cr.genesFuera > cr.fuera.length ? trp(" y {v} genes más", { v: n(cr.genesFuera - cr.fuera.length) }) : ""}.
        </p>
      ) : null}
      {cr?.mismoSitioOtroNombre.length ? (
        <p className="aso-criba-genes suave">
          <b>{tr("Mismo sitio del cromosoma con otro nombre:")}</b>{trp(" {v}. No es un fuera de diana: es el mismo tramo transcrito con otra etiqueta de Ensembl.", { v: cr.mismoSitioOtroNombre.join(", ") })}
        </p>
      ) : null}
      {cr?.cribadoConDesajustes ? (
        <div className="aso-fallos">
          <p className="aso-fallos-que">
            {tr("Esto no cuenta fallos, mira")} <b>{tr("dónde caen")}</b>{tr(". La RNasa H1 no lee las veinte letras: reconoce la dúplex que forma el")} <b>{tr("hueco de ADN")}</b> {tr("(las posiciones")} {cr.huecoDesde} a {cr.huecoHasta}{tr("). Con el hueco perfecto corta aunque fallen las alas; con un fallo dentro del hueco, no.")}
          </p>
          <table className="aso-fallos-tabla">
            <thead>
              <tr>
                <th>{tr("fallos en las alas")}</th>
                <th>{tr("genes ajenos donde cortaría")}</th>
                <th>{tr("al azar")}</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((k) => {
                const cuantos = cr.cuantosPorFallos?.[String(k)] ?? 0;
                const az = cr.nulo?.[String(k)];
                return (
                  <tr key={k} className={cuantos && k <= 1 ? 'aso-fallos-mal' : ''}>
                    <th>{k === 0 ? tr('ninguno (idéntico)') : k === 1 ? '1' : k}</th>
                    <td className="lab-mono">
                      {cuantos ? `${n(cuantos)}: ${(cr.porFallos?.[String(k)] ?? []).slice(0, 5).join(', ')}${cuantos > 5 ? '…' : ''}` : '—'}
                    </td>
                    <td>{az !== undefined ? `${dec(az * 100, 1)} %` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="aso-criba-como">
            {trp("La columna «al azar» es el porcentaje de {v} secuencias de veinte letras ", { v: n(cr.nuloN ?? 300) })}<b>{tr("al azar")}</b>{tr(", con el mismo reparto de G y C, que tienen un encaje de ese nivel al pasar por esta misma tubería. Está aquí para que no haya que fiarse de la regla: por debajo del 1 % un encaje dice algo, por encima del 5 % es lo que pasa solo.")}
            {cr.conFalloEnElHueco ? (
              <>
                {trp(" Hay además {conFalloEnElHueco} gen(es) parecidos donde el fallo cae ", { conFalloEnElHueco: n(cr.conFalloEnElHueco) })}<b>{tr("dentro")}</b> {tr("del hueco: ahí la RNasa H1 no corta.")}
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {criba?.hecho ? (
        <>
          <p className="aso-criba-como">
            {trp("Comparado contra {transcritos} transcritos de Ensembl (GRCh38{v}){v2}. Se busca el complemento inverso del oligo, que es el tramo al que se pega.", { transcritos: n(criba.transcritos), v: criba.ficheros.length ? `, ${criba.ficheros.join(" y ")}` : "", v2: criba.segundos ? ` en ${criba.segundos} s` : "" })}
          </p>
          <details className="aso-criba-limites">
            <summary>{trp("Qué NO cubre este cribado ({limites})", { limites: criba.limites.length })}</summary>
            <ul>
              {criba.limites.map((l) => (
                <li key={l.que}>
                  <b>{l.que}.</b> {l.porQue}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : criba?.motivo ? (
        <p className="aso-criba-como">{criba.motivo}</p>
      ) : null}
    </section>
  );
}

function Aso({ diana, alCerrar }: { diana: DianaDeLaboratorio; alCerrar: () => void }) {
  const [cual, fijarCual] = useState(0);
  // El muro trae ocho candidatos; el cribado entero son sesenta y se pide al
  // abrir, porque sesenta por diecisiete dianas serían 400 KB por visita.
  const [completo, fijarCompleto] = useState<DisenoAso | null>(null);
  useEffect(() => {
    let vivo = true;
    fijarCompleto(null);
    void acciones.oligosDe(diana.uniprot).then((r) => {
      if (vivo && r && r !== 'sin_respuesta') fijarCompleto(r);
    });
    return () => {
      vivo = false;
    };
  }, [diana.uniprot]);
  const d = completo ?? diana.aso;
  // Las etapas que declaran las hipótesis que piden bajar esta diana: son las
  // que un oligonucleótido pondría a prueba.
  const etapas = [...new Set(diana.hipotesis.filter((h) => h.direccion === 'disminuye' && h.etapa).map((h) => h.etapa))];
  const c = d?.candidatos[cual];
  return (
    <section className="lab-experimento" aria-label={trp("Oligonucleótido antisentido para {simbolo}", { simbolo: diana.simbolo })}>
      <header>
        <div>
          <p className="lab-catalogo">
            <b>{tr("OLIGONUCLEÓTIDO ANTISENTIDO")}</b> <i /> {diana.simbolo} <i /> {d ? d.build : ""}
          </p>
          <h2>{trp("Cortar la producción de {simbolo} en su propio ARN", { simbolo: diana.simbolo })}</h2>
        </div>
        <div className="lab-acciones-exp">
          {d && c ? <Copiar texto={asoComoTexto(diana.simbolo, d, c)} que={tr("el candidato entero")} clase="lab-copiar-grande" /> : null}
          <button type="button" className="lab-cerrar" onClick={alCerrar} aria-label={tr("Cerrar")}>
            ✕
          </button>
        </div>
      </header>

      <div className="lab-experimento-cuerpo">
        {!d ? (
          <p className="lab-parrafo" role="status">
            {(diana.asoSinComprobar ? tr("No pude traer la secuencia del transcrito de esta proteína: Ensembl no respondió. No quiere decir que no se pueda diseñar.") : tr("Todavía no se ha traído la secuencia de esta proteína. En cuanto ROSA2018 la tenga, el diseño aparece aquí."))}
          </p>
        ) : !c ? (
          <p className="lab-parrafo" role="status">
            {trp("Ninguna ventana del transcrito pasa todos los filtros. Es raro y merece mirarse: de {ventanas} ventanas posibles, cero limpias.", { ventanas: n(d.ventanas) })}</p>
        ) : (
          <>
            <p className="lab-parrafo lab-destacado">
              {trp("Un oligonucleótido antisentido es una cadena de {secuencia} letras que encaja con un tramo del ARN mensajero de {simbolo}. Donde encaja, una enzima de la célula, la RNasa H1, corta el ARN. Sin ARN no se fabrica proteína nueva.", { secuencia: c.secuencia.length, simbolo: diana.simbolo })}
            </p>
            {d.queHace ? (
              <div className="aso-mecanismo">
                <p>
                  <b>{tr("Lo que NO hace:")}</b> {d.queHace.noHace}.
                </p>
                <p>
                  {d.queHace.matiz[0]!.toUpperCase() + d.queHace.matiz.slice(1)}. {d.queHace.evidencia[0]!.toUpperCase()}
                  {d.queHace.evidencia.slice(1)}. <span className="lab-nota-en-linea">{d.queHace.aviso}.</span>
                </p>
              </div>
            ) : null}
            {etapas.length ? (
              <p className="lab-nota">
                <b>{tr("A qué momento apunta la hipótesis que lo respalda:")}</b>{trp(" {v}. Importa porque el oligo actúa sobre la producción, no sobre lo ya depositado.", { v: etapas.join(' · ') })}
              </p>
            ) : null}

            <h3>{trp("EL CANDIDATO {v} DE {candidatos}", { v: cual + 1, candidatos: d.candidatos.length })}</h3>
            <Secuencia c={c} grande />
            <div className="aso-leyenda">
              <span>
                <i className="aso-punto-ala" />{trp(" alas de {ALAS_LARGO} nt, {alas}", { ALAS_LARGO, alas: d.quimica.alas })}
              </span>
              <span>
                <i className="aso-punto-hueco" />{trp(" hueco de {hueco} nt de {hueco2}", { hueco: c.partes.hueco.length, hueco2: d.quimica.hueco })}
              </span>
            </div>

            <FichaCriba c={c} d={d} />
            <FichaEspecies c={c} />
            <FichaSitio c={c} d={d} />
            <FichaDuplex c={c} />

            <h3>{tr("DÓNDE CAE EN EL ARN")}</h3>
            <MapaTranscrito d={d} activo={cual} alElegir={fijarCual} />
            <p className="lab-nota">
              {trp("Posición {posicion} a {hasta}{v}. El tramo al que va es 5&apos;-{diana}-3&apos;, y el oligo es su complemento inverso. Los {candidatos} candidatos vienen de sitios separados del transcrito a propósito: diez ventanas solapadas de la misma zona serían un candidato disfrazado de diez.", { posicion: n(c.posicion), hasta: n(c.hasta), v: c.region ? trp(", en la {region}", { region: c.region }) : "", diana: c.diana, candidatos: d.candidatos.length })}
            </p>

            <h3>{tr("POR QUÉ ESTE Y NO OTRO")}</h3>
            <div className="aso-medidas">
              <div>
                <b>{Math.round(c.gc * 100)} %</b>
                <span>{tr("G MÁS C")}</span>
              </div>
              <div>
                <b>{c.cpg}</b>
                <span>{tr("CpG")}</span>
              </div>
              <div>
                <b>{c.autocomplementariedad}</b>
                <span>{tr("SE PEGA A SÍ MISMO")}</span>
              </div>
              <div>
                <b>
                  +{c.motivosBuenos}/−{c.motivosMalos}
                </b>
                <span>MOTIVOS</span>
              </div>
            </div>
            <p className="lab-parrafo">
              {trp("De {ventanas} ventanas posibles en este transcrito, {pasanFiltros} pasan todos los filtros; de esas se eligen {candidatos} repartidas. Los filtros son: proporción de G y C entre el 40 y el 60 por ciento, sin dinucleótidos CpG (activan el receptor TLR9), sin tramos de cuatro guaninas (bajan la actividad y forman cuádruplex), sin que el oligo se pegue a sí mismo, y prefiriendo los motivos que en experimentos pasados salieron asociados a más actividad.", { ventanas: n(d.ventanas), pasanFiltros: n(d.pasanFiltros), candidatos: d.candidatos.length })}
            </p>
            <p className="lab-nota">
              <b>{tr("Esto es estadística, no una predicción.")}</b> {tr("Los filtros salen de mirar experimentos publicados: correlacionan con funcionar, no garantizan funcionar. Una patente de Ionis describe sintetizar 156 oligonucleótidos para llevar unos pocos a pruebas de dosis. Lo que hay aquí es una lista corta para cribar en el laboratorio.")}
            </p>

            <h3>{tr("LA QUÍMICA DEL PEDIDO")}</h3>
            <dl className="lab-campos">
              <Campo t="ARQUITECTURA" v={`${d.quimica.arquitectura}. ${d.quimica.porQue}`} />
              <Campo t="ALAS" v={d.quimica.alas} />
              <Campo t="HUECO" v={d.quimica.hueco} />
              <Campo t="ENLACES" v={d.quimica.enlaces} />
              <Campo t="CITOSINAS" v={d.quimica.citosinas} />
            </dl>

            {d.via ? (
              <>
                <h3>{tr("CÓMO SE ADMINISTRA")}</h3>
                <p className="lab-parrafo lab-destacado">{d.via.via}</p>
                <p className="lab-parrafo">
                  {d.via.porQue[0]!.toUpperCase() + d.via.porQue.slice(1)}. {d.via.precedente[0]!.toUpperCase()}
                  {d.via.precedente.slice(1)}.
                </p>
                <p className="lab-nota">{trp("A tener en cuenta: {limite}.", { limite: d.via.limite })}</p>
              </>
            ) : null}

            <h3>{tr("LA DECISIÓN QUE NO TOMA ROSA2018")}</h3>
            <p className="lab-parrafo">
              {tr("Este diseño va sobre")} {d.transcrito}{tr(", el transcrito canónico")}
              {d.transcritosDelGen > 1 ? <>{trp(" de los {transcritosDelGen} que tiene el gen", { transcritosDelGen: n(d.transcritosDelGen) })}</> : null}{tr(". Un gen no hace un solo ARN: hace varias versiones cortando y reuniendo los trozos de maneras distintas. Si el oligo cae en un trozo que está en todas, baja la proteína entera; si cae en uno que solo está en algunas, baja solo esas.")}{' '}
              <b>{tr("Cuál bajar no es lo mismo que cuánta bajar")}</b>{tr(", y esa es una decisión científica: ROSA2018 enseña las opciones y la toma una persona.")}
            </p>

            {d.fiabilidad ? <Fiabilidad f={d.fiabilidad} /> : null}

            {d.candidatos.length > 1 ? (
              <>
                <h3>
                  {trp("EL CRIBADO {v}", { v: completo ? `· ${d.candidatos.length} CANDIDATOS` : tr('· TRAYENDO EL RESTO…') })}
                </h3>
                <p className="lab-nota">
                  {completo
                    ? trp("Sesenta es el orden de magnitud de un cribado primario de verdad: el protocolo de Ionis describe probar unos ochenta en células para quedarse con ocho o diez, y esos ocho o diez son ya el resultado, no la entrada. Van separados al menos {v} nucleótidos entre sí para que vengan de sitios distintos del transcrito.", { v: d.separacionUsada ?? 60 })
                    : tr('El muro trae ocho; el cribado entero se está trayendo.')}
                </p>
                {d.criba?.hecho ? (
                  <p className="lab-nota">
                    {tr("Van ordenados por el cribado contra el transcriptoma, no solo por su puntuación:")}{' '}
                    <b>{trp("{v} sin choque exacto", { v: n(d.limpios ?? 0) })}</b>{trp(" y {v} descartados por encajar idéntico en otro gen. Los descartados no se esconden, van al final. El número uno es el primero que se puede pedir, que es lo que importa cuando ROSA2018 elige cuál mandaría.", { v: n(d.descartadosPorCriba ?? 0) })}
                  </p>
                ) : null}
                <div className="aso-lista">
                  {d.candidatos.map((x, i) => {
                    const v = x.criba?.veredicto;
                    return (
                      <button
                        key={x.posicion}
                        type="button"
                        className={`aso-fila${i === cual ? ' aso-fila-activa' : ''}${v === 'descartado' ? ' aso-fila-fuera' : ''}`}
                        onClick={() => fijarCual(i)}
                      >
                        <span className="aso-fila-n">{i + 1}</span>
                        <Secuencia c={x} />
                        <span className="aso-fila-datos">{trp("pos {posicion} · GC {v} % · motivos +{motivosBuenos}", { posicion: n(x.posicion), v: Math.round(x.gc * 100), motivosBuenos: x.motivosBuenos })}
                          {/* Que un candidato se pueda probar en un roedor se ve
                              AQUÍ, en la lista: es lo que deja comparar el
                              compromiso de un vistazo, porque el que se puede
                              probar puede tener peor accesibilidad que el que
                              no, y hay que verlo. */}
                          {x.especies?.sePuedeProbar ? (
                            <b className="aso-fila-sello bien">en {x.especies.sirvenEn.join(' y ')}</b>
                          ) : null}
                          {v === 'descartado' ? (
                            <b className="aso-fila-sello">{(x.criba.genesFuera === 1 ? trp("choca en {genesFuera} gen", { genesFuera: n(x.criba.genesFuera) }) : trp("choca en {genesFuera} genes", { genesFuera: n(x.criba.genesFuera) }))}
                            </b>
                          ) : v === 'revisar' ? (
                            <b className="aso-fila-sello duda">{tr("revisar")}</b>
                          ) : v === 'sin cribar' ? (
                            <b className="aso-fila-sello duda">{tr("sin cribar")}</b>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   La lámina de una diana, con zoom semántico
   -------------------------------------------------------------------------- */

interface Medido {
  atomos: number;
  residuos: number;
  plddtMedio: number;
  fiable: number;
}

/** La lámina ocupa de donde empiece hasta el borde de abajo de la ventana.
 *  Se mide, no se resta un número fijo: la cabecera y el hilo del proceso miden
 *  distinto según la investigación y según si hay avisos, y con un `calc` fijo
 *  quedaba una franja del color del fondo por debajo del cuadro. */
function useAltoHastaAbajo(ref: React.RefObject<HTMLElement | null>): number | null {
  const [alto, fijarAlto] = useState<number | null>(null);
  useEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const arriba = el.getBoundingClientRect().top;
      fijarAlto(Math.max(560, Math.round(window.innerHeight - arriba)));
    };
    medir();
    window.addEventListener('resize', medir);
    // La cabecera cambia de alto sola (el hilo del proceso crece con la
    // corrida), así que no basta con escuchar el resize de la ventana. Si no
    // hay ResizeObserver se sigue sin él: se pierde ese reajuste, no la
    // pantalla.
    const vigia = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    if (vigia && document.body) vigia.observe(document.body);
    return () => {
      window.removeEventListener('resize', medir);
      vigia?.disconnect();
    };
  }, [ref]);
  return alto;
}

function Lamina({ diana, abrirAso = false, alVolver }: { diana: DianaDeLaboratorio; abrirAso?: boolean; alVolver: () => void }) {
  const marco = useRef<HTMLDivElement | null>(null);
  const altoLamina = useAltoHastaAbajo(marco);
  const caja = useRef<HTMLDivElement | null>(null);
  const visorRef = useRef<Visor | null>(null);
  const [medido, fijarMedido] = useState<Medido | null>(null);
  const [nivel, fijarNivel] = useState(0);
  const [marcas, fijarMarcas] = useState<Marca[]>([]);
  const [marcasEstado, fijarMarcasEstado] = useState<'pidiendo' | 'listas' | 'sin_respuesta'>('pidiendo');
  const [puestos, fijarPuestos] = useState<{ x: number; y: number; ey: number; izq: boolean; visible: boolean }[]>([]);
  const [residuo, fijarResiduo] = useState<{ r: Residuo; x: number; y: number } | null>(null);
  // Qué textos está pisando la proteína ahora mismo. El despeje se dispara con
  // el choque y no con la distancia de la cámara: por distancia llegaba tarde,
  // la proteína ya estaba encima de las letras cuando empezaban a irse.
  const [pisados, fijarPisados] = useState<boolean[]>([false, false]);
  const bloqueRef = useRef<HTMLDivElement | null>(null);
  const abajoRef = useRef<HTMLDivElement | null>(null);
  const [fallo, fijarFallo] = useState<string | null>(null);
  const [verExperimento, fijarVerExperimento] = useState(false);
  const [hojaAbierta, fijarHojaAbierta] = useState(() => window.matchMedia?.(tr('(min-width: 981px)')).matches ?? false);
  // Se puede llegar con el panel ya abierto desde el muro (#/…/aso).
  const [verAso, fijarVerAso] = useState(abrirAso);
  // La parte abierta y sus residuos. Se guardan juntos porque los residuos se
  // leen del fichero en el momento de abrirla, no en cada fotograma.
  const [parte, fijarParte] = useState<{ marca: Marca; residuos: Residuo[] } | null>(null);
  // El residuo abierto. Se guarda con lo que se midió al abrirlo (vecinos y
  // tramo de secuencia), que no cambia mientras esté abierto.
  const [fijado, fijarFijado] = useState<{ r: Residuo; vecinos: number; contexto: Residuo[] } | null>(null);
  const distInicial = useRef(1);
  const cancelar = useRef(0);
  const base = useRef<number[]>([0, 0]);
  const marcasRef = useRef<Marca[]>([]);
  const nivelRef = useRef(0);

  marcasRef.current = marcas;
  nivelRef.current = nivel;

  useEffect(() => {
    let vivo = true;
    let visor: Visor | null = null;
    (async () => {
      const nodo = caja.current;
      if (!nodo) return;
      try {
        const { crearVisor } = await import('../lib/visorMolecular');
        visor = await crearVisor(nodo);
        if (!vivo) return visor.destruir();
        visorRef.current = visor;
        const m = await visor.cargar(diana.estructura.url, 'mmcif', 'ilustrativa');
        if (!vivo) return;
        fijarMedido(m);
        visor.encuadrar(0.62, -0.34);
        distInicial.current = visor.distancia();
        void anotacionesDe(diana.uniprot).then((a) => {
          if (!vivo) return;
          fijarMarcas(a ?? []);
          fijarMarcasEstado(a === null ? 'sin_respuesta' : 'listas');
        });
      } catch (ex) {
        if (vivo) fijarFallo(ex instanceof Error ? ex.message : String(ex));
      }
    })();
    return () => {
      vivo = false;
      visorRef.current?.destruir();
      visorRef.current = null;
    };
  }, [diana.estructura.url, diana.uniprot]);

  // Reproyectar las etiquetas en cada fotograma: van pegadas a la proteína al
  // girarla. Un ordenador por altura las separa para que no se pisen.
  const reproyectar = useCallback(() => {
    const visor = visorRef.current;
    const nodo = caja.current;
    if (!visor || !nodo) return;
    const ancho = nodo.clientWidth;
    const alto = nodo.clientHeight;
    const cuantos = marcasRef.current.length;
    // El nivel se calcula AQUÍ y se usa aquí mismo. Leerlo de `nivelRef` dejaba
    // las etiquetas un fotograma por detrás, y como Mol* deja de dibujar cuando
    // la cámara para, ese fotograma no llegaba nunca: al nivel de partes no
    // aparecía ninguna etiqueta y al de átomos aparecían las del nivel anterior.
    const f = visor.distancia() / distInicial.current;
    const n = f < CERCA ? 2 : f < MEDIO ? 1 : 0;
    fijarNivel((antes) => (antes === n ? antes : n));
    const enPartes = n === 1;
    const nuevos = marcasRef.current.map((m) => {
      const c = visor.centroDe(m.desde, m.hasta);
      if (!c) return { x: 0, y: 0, ey: 0, izq: false, visible: false };
      const p = visor.proyectar(c);
      return { x: p.x, y: p.y, ey: p.y, izq: p.x > ancho * 0.58, visible: enPartes && p.x > -60 && p.x < ancho + 60 && p.y > 0 && p.y < alto };
    });
    for (const lado of [true, false]) {
      const g = nuevos.filter((p) => p.visible && p.izq === lado).sort((a, b) => a.ey - b.ey);
      for (let k = 1; k < g.length; k += 1) if (g[k]!.ey - g[k - 1]!.ey < ALTO_ETIQUETA) g[k]!.ey = g[k - 1]!.ey + ALTO_ETIQUETA;
    }
    if (cuantos) fijarPuestos(nuevos);

    // El choque, contra los dos bloques de texto que la proteína puede tapar.
    // Se miden en coordenadas del lienzo; el margen deja que el degradado haga
    // su trabajo antes de que las letras estorben de verdad.
    const rs = [rectDe(bloqueRef.current, nodo), rectDe(abajoRef.current, nodo)];
    const medidos = visor.pisa(rs.map((r) => r ?? { x: -1, y: -1, ancho: 0, alto: 0 }));
    // Contra el cero de la apertura, no contra cero absoluto. Y solo cuenta si
    // la cámara se ha ACERCADO: girando, la proteína pasa por encima del texto
    // y volvería a salir, y el titular parpadearía cada vuelta.
    const acercada = visor.distancia() < distInicial.current * 0.99;
    const choca = rs.map((r, i) => (r && acercada ? medidos[i]! - (base.current[i] ?? 0) >= TAPA : false));
    fijarPisados((antes) => (antes[0] === choca[0] && antes[1] === choca[1] ? antes : choca));
  }, []);

  useEffect(() => {
    const visor = visorRef.current;
    if (!visor) return;
    const quitar = visor.alDibujar(reproyectar);
    const quitar2 = visor.alSeñalar((r) => {
      if (!r || nivelRef.current !== 2) return fijarResiduo(null);
      const p = visor.proyectar(r.centro);
      fijarResiduo({ r, x: p.x, y: p.y });
    });
    return () => {
      quitar();
      quitar2();
    };
  }, [reproyectar, medido]);

  // Cuánta proteína hay sobre cada texto EN EL ENCUADRE DE APERTURA. Ese es el
  // cero: en la composición aprobada la proteína pasa por detrás del texto y el
  // degradado la deja legible, así que al abrir no se despeja nada. Lo que
  // despeja es que el zoom la ponga MÁS encima de lo que ya estaba.
  useEffect(() => {
    if (!medido) return;
    let cancelado = false;
    const medirBase = () => {
      const visor = visorRef.current;
      const nodo = caja.current;
      if (cancelado || !visor || !nodo) return;
      const rs = [rectDe(bloqueRef.current, nodo), rectDe(abajoRef.current, nodo)];
      base.current = visor.pisa(rs.map((r) => r ?? { x: -1, y: -1, ancho: 0, alto: 0 })).map((f, i) => (rs[i] ? f : 0));
      distInicial.current = visor.distancia();
    };
    // Dos fotogramas: uno para que React pinte y otro para que el navegador
    // calcule el diseño con el contenido ya dentro. Medir antes daría el
    // rectángulo del bloque a medio crecer.
    const a = requestAnimationFrame(() => {
      cancelar.current = requestAnimationFrame(medirBase);
    });
    return () => {
      cancelado = true;
      cancelAnimationFrame(a);
      cancelAnimationFrame(cancelar.current);
    };
  }, [medido]);

  // Giro en reposo, como el árbol 3D: a los tres segundos sin tocar nada la
  // proteína empieza a girar despacio. Lo corta ARRASTRAR o hacer zoom, no
  // pasar el ratón por encima: al nivel de átomos el ratón se pasea por la
  // superficie para leer los residuos y eso no es querer pararla. Con
  // movimiento reducido no gira nunca.
  const reposo = useRef(0);
  // Con un panel abierto la proteína no gira: alguien está leyendo, y que se
  // mueva el fondo mientras se lee un protocolo de diez pasos estorba.
  const hayPanel = verExperimento || verAso || parte !== null || fijado !== null;

  // El lanzamiento: se mide la velocidad del arrastre en sus últimos
  // milisegundos y, al soltar, la proteína sigue girando y se va frenando. Mol*
  // no lo puede dar por su cuenta sin romper el zoom (ver visorMolecular.ts),
  // así que la velocidad se toma aquí y el giro lo aplica `orbitar`.
  useEffect(() => {
    if (!medido) return;
    const nodo = caja.current;
    if (!nodo) return;
    if (window.matchMedia?.(tr('(prefers-reduced-motion: reduce)'))?.matches) return;
    let arrastrando = false;
    let ultimo = { x: 0, y: 0, t: 0 };
    let vx = 0;
    let vy = 0;
    let lazo = 0;
    const abajo = (ev: PointerEvent) => {
      cancelAnimationFrame(lazo);
      lazo = 0;
      arrastrando = true;
      vx = vy = 0;
      ultimo = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
    };
    const mover = (ev: PointerEvent) => {
      if (!arrastrando) return;
      const dt = ev.timeStamp - ultimo.t;
      if (dt <= 0) return;
      // Media con el valor anterior: un solo fotograma da saltos, y con la
      // media el lanzamiento sale en la dirección en que iba la mano.
      vx = vx * 0.4 + ((ev.clientX - ultimo.x) / dt) * 0.6;
      vy = vy * 0.4 + ((ev.clientY - ultimo.y) / dt) * 0.6;
      ultimo = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
    };
    const soltar = () => {
      if (!arrastrando) return;
      arrastrando = false;
      // Píxeles por milisegundo a radianes por fotograma (16,7 ms).
      let gx = vx * 16.7 * SENSIBILIDAD_LANZAR;
      let gy = vy * 16.7 * SENSIBILIDAD_LANZAR;
      const paso = () => {
        const visor = visorRef.current;
        if (!visor || (Math.abs(gx) < MINIMO_LANZAR && Math.abs(gy) < MINIMO_LANZAR)) {
          lazo = 0;
          return;
        }
        visor.orbitar(gx, gy);
        gx *= ROZAMIENTO_LANZAR;
        gy *= ROZAMIENTO_LANZAR;
        lazo = requestAnimationFrame(paso);
      };
      lazo = requestAnimationFrame(paso);
    };
    nodo.addEventListener('pointerdown', abajo, { passive: true });
    window.addEventListener('pointermove', mover, { passive: true });
    window.addEventListener('pointerup', soltar, { passive: true });
    nodo.addEventListener('wheel', () => cancelAnimationFrame(lazo), { passive: true });
    return () => {
      cancelAnimationFrame(lazo);
      nodo.removeEventListener('pointerdown', abajo);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, [medido]);

  useEffect(() => {
    if (!medido) return;
    const nodo = caja.current;
    if (!nodo) return;
    const reducido = window.matchMedia?.(tr('(prefers-reduced-motion: reduce)'))?.matches ?? false;
    if (reducido || hayPanel) {
      visorRef.current?.girar(false);
      return;
    }
    let girando = false;
    const parar = () => {
      if (girando) {
        visorRef.current?.girar(false);
        girando = false;
      }
      window.clearTimeout(reposo.current);
      reposo.current = window.setTimeout(() => {
        visorRef.current?.girar(true);
        girando = true;
      }, ESPERA_GIRO_MS);
    };
    parar();
    for (const ev of ['pointerdown', 'wheel'] as const) nodo.addEventListener(ev, parar, { passive: true });
    return () => {
      window.clearTimeout(reposo.current);
      for (const ev of ['pointerdown', 'wheel'] as const) nodo.removeEventListener(ev, parar);
      visorRef.current?.girar(false);
    };
  }, [medido, hayPanel]);

  /** Abrir el residuo que está bajo el ratón. En el nivel de átomos el rótulo
   *  al pasar por encima dice el nombre y poco más; pulsando se queda abierto
   *  y con lo que hay que saber para decidir si tocarlo. */
  const abrirResiduo = () => {
    const visor = visorRef.current;
    if (!visor || nivel !== 2 || !residuo) return;
    const r = residuo.r;
    visor.girar(false);
    fijarParte(null);
    fijarFijado({ r, vecinos: visor.vecinos(r.numero), contexto: visor.residuosDe(r.numero - 6, r.numero + 6) });
  };

  /** Abrir una parte: la cámara va a ella y el panel dice qué es. Las dos
   *  cosas juntas, porque leer «residuos 96 a 110» sin verlos no dice nada. */
  const abrirParte = (m: Marca) => {
    const visor = visorRef.current;
    if (!visor) return;
    visor.girar(false);
    // Suelo de distancia: casi la mitad de la de apertura. Acerca de verdad
    // pero deja ver dónde cae el tramo dentro de la proteína; con un quinto,
    // un sitio activo de un residuo llenaba la pantalla de esferas sin nada
    // con lo que situarlo.
    visor.enfocar(m.desde, m.hasta, distInicial.current * 0.45);
    // Y a la derecha, porque la ficha ocupa la mitad izquierda: centrar el
    // tramo lo dejaba justo detrás del panel que lo explica.
    visor.encuadrar(1, -0.16);
    fijarFijado(null);
    fijarParte({ marca: m, residuos: visor.residuosDe(m.desde, m.hasta) });
  };

  const irANivel = (n: number) => {
    const visor = visorRef.current;
    if (!visor) return;
    if (n === 0) {
      fijarParte(null);
      fijarFijado(null);
    }
    // Las fracciones caen dentro de las bandas de CERCA y MEDIO, pero pegadas al
    // borde de fuera: la apertura ya es un encuadre cerrado, y a 0,7 el nivel de
    // partes no dejaba ver la proteína entera con sus partes marcadas.
    visor.irA(distInicial.current * (n === 0 ? 1 : n === 1 ? 0.85 : 0.38));
  };

  const h = diana.hipotesis[0];
  const hoja = diana.hojaDePedido;
  const clave = decisionDeLaDiana(diana);
  const killer = clave ? KILLER[clave] : null;
  // La cadena causal, del grafo curado de ROSA2018. No se infiere aquí: si el
  // grafo no tiene una flecha que la toque, no se escribe ninguna.
  const cadena = (() => {
    const arriba = diana.causal.aguasArriba.map((r) => r.otro);
    const abajo = diana.causal.aguasAbajo.map((r) => r.otro);
    if (!arriba.length && !abajo.length) return '';
    const izq = arriba.length ? `${arriba.join(', ')} → ` : '';
    const der = abajo.length ? ` → ${abajo.join(', ')}` : '';
    return `${izq}${diana.tambienLlamada || diana.simbolo}${der}`;
  })();
  const pct = (x: number) => `${Math.round(x * 100)} %`;

  return (
    <section ref={marco} className="lab-lamina" style={altoLamina ? { height: altoLamina } : undefined} aria-label={trp("Estructura de {simbolo}", { simbolo: diana.simbolo })}>
      {/* El clic va aquí y no en el lienzo de Mol*: Mol* se queda con el suyo
          para girar, y este solo lee cuál es el residuo que ya está señalado. */}
      <div className="lab-lienzo" ref={caja} onClick={abrirResiduo} />
      <div className={`lab-velo${nivel === 2 ? ' lab-velo-tenue' : ''}`} />

      {/* Etiquetas ancladas: nivel de partes */}
      <div className="lab-anclas" aria-hidden="true">
        <svg>
          {puestos.map((p, i) =>
            p.visible ? (
              <path key={i} d={`M${p.x},${p.y} L${p.x + (p.izq ? -40 : 40)},${p.ey} L${p.x + (p.izq ? -68 : 68)},${p.ey}`} />
            ) : null,
          )}
        </svg>
        {marcas.map((m, i) => {
          const p = puestos[i];
          if (!p) return null;
          return (
            <div key={`${m.nombre}-${m.desde}`}>
              <i className="lab-punto" style={{ left: p.x, top: p.y, opacity: p.visible ? 1 : 0 }} />
              <button
                type="button"
                className={`lab-ancla${p.izq ? ' lab-ancla-izq' : ''}${parte?.marca.desde === m.desde && parte?.marca.hasta === m.hasta ? ' lab-ancla-activa' : ''}`}
                style={{ left: p.x + (p.izq ? -74 : 74), top: p.ey, opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? 'auto' : 'none' }}
                onClick={() => abrirParte(m)}
              >
                <b>{m.nombre}</b>
                <span>
                  {m.detalle ? `${m.detalle} · ` : ''}
                  {m.desde === m.hasta ? `residuo ${m.desde}` : `${m.desde}–${m.hasta}`}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" className="lab-volver" onClick={alVolver}>
        {tr("← Todas las dianas")}
      </button>

      <div ref={bloqueRef} className={`lab-capa lab-bloque${nivel > 1 || pisados[0] ? ' lab-fuera' : ''}`}>
        <p className={`lab-catalogo lab-capa${nivel > 0 ? ' lab-fuera' : ''}`}>
          <b>{trp("UNIPROT {uniprot}", { uniprot: diana.uniprot })}</b> <i /> {diana.estructura.fuente.toUpperCase()} <i /> {diana.estructura.licencia}
        </p>
        {diana.estructura.medidas ? (
          <p className={`lab-medidas lab-capa${nivel > 0 ? ' lab-fuera' : ''}`}>
            {tr("Lo que ves es el modelo predicho, el único de longitud completa. El PDB tiene")}{' '}
            <a href={diana.estructura.urlPDB} target="_blank" rel="noreferrer">
              {trp("{v} estructuras medidas", { v: diana.estructura.medidas.toLocaleString('es') })}</a>{' '}
            {tr("de esta proteína; ROSA2018 no elige una porque casi todas son fragmentos.")}
          </p>
        ) : null}
        <h1>
          {diana.simbolo}
          {diana.tambienLlamada ? <small>{diana.tambienLlamada}</small> : null}
        </h1>
        <p className={`lab-binomio lab-capa${nivel > 1 ? ' lab-fuera' : ''}`}>{diana.nombre}</p>
        <div className={`lab-capa${nivel > 0 ? ' lab-fuera' : ''}`}>
          {/* Lo primero es el peso de la evidencia: por qué esta proteína está
              aquí. La intervención de una hipótesis va después, si la hay. */}
          <p className="lab-larga">
            {diana.hechos === 0 ? (
              <>
                {trp("Todavía ninguna afirmación verificada la nombra. Está aquí porque {v} como diana.", { v: diana.enHipotesis === 1 ? tr('una hipótesis la propone') : trp("{enHipotesis} hipótesis la proponen", { enHipotesis: diana.enHipotesis }) })}</>
            ) : (
              <>
                {tr("La nombran")} <b>{diana.hechos.toLocaleString('es')}</b> {tr("afirmaciones de ROSA2018,")}{' '}
                {diana.sabidos.toLocaleString('es')} {tr("sostenidas por")} {diana.fuentes} {diana.fuentes === 1 ? 'fuente' : 'fuentes'}
                {diana.investigaciones.length > 1 ? <>{trp(", en {investigaciones} investigaciones", { investigaciones: diana.investigaciones.length })}</> : null}.
              </>
            )}
          </p>
          {cadena ? <p className="lab-cadena">{cadena}</p> : null}
          <div className="lab-insignias">
            {diana.enHipotesis ? (
              <span className="lab-grado lab-grado-neutro">
                <i /> {diana.enHipotesis === 1 ? tr('1 experimento propuesto') : `${diana.enHipotesis} experimentos propuestos`}
              </span>
            ) : (
              <span className="lab-grado lab-killer-no">
                <i /> {tr("ninguna hipótesis propone un experimento")}
              </span>
            )}
            {h?.certeza ? (
              <span className={`lab-grado lab-grado-${h.certeza}`}>
                <i />{trp(" {v} · GRADE", { v: CERTEZA[h.certeza] ?? h.certeza })}</span>
            ) : null}
            {killer ? (
              <span className={`lab-grado lab-killer-${killer.tono}`}>
                <i /> {killer.texto}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div ref={abajoRef} className={`lab-capa lab-abajo${nivel > 0 || pisados[1] ? ' lab-fuera' : ''}`}>
      <div className="lab-cifras">
        <div className="lab-cifra">
          <b>{medido ? medido.residuos.toLocaleString('es') : '—'}</b>
          <span>{tr("AMINOÁCIDOS")}</span>
        </div>
        <div className="lab-cifra">
          <b>{medido ? medido.atomos.toLocaleString('es') : '—'}</b>
          <span>{tr("ÁTOMOS")}</span>
        </div>
        <div className="lab-cifra lab-ojo">
          <b>{medido ? pct(medido.fiable) : '—'}</b>
          <span>TRAMO FIABLE</span>
        </div>
        <div className="lab-cifra">
          <b>{diana.enHipotesis}</b>
          <span>{tr("HIPÓTESIS")}</span>
        </div>
      </div>
      </div>

      <p className={`lab-capa lab-pie${nivel > 0 || pisados[1] ? ' lab-fuera' : ''}`}>
        {(diana.estructura.clase === 'predicha' ? tr("Modelo predicho, no medido: el color dice de qué tramos se fía. Acerca la rueda del ratón sobre la proteína") : tr("Estructura medida en un laboratorio. Acerca la rueda del ratón sobre la proteína"))}
      </p>

      {!hayPanel && <button type="button" className={`lab-hoja-toggle${nivel > 0 ? ' lab-fuera' : ''}`} aria-expanded={hojaAbierta} aria-controls="ficha-laboratorio" onClick={() => fijarHojaAbierta(!hojaAbierta)}>
        {(hojaAbierta ? tr("Cerrar ficha") : tr("Para el laboratorio"))}
      </button>}
      <aside id="ficha-laboratorio" aria-label={tr("Para el laboratorio")} className={`lab-capa lab-hoja${nivel > 0 ? ' lab-fuera' : ''}${hojaAbierta ? ' lab-hoja-abierta' : ' lab-hoja-cerrada'}`}>
        <header className="lab-hoja-cabecera">
          <div className="lab-hoja-titulo"><h3>{(hoja.sinExperimento ? tr("Lo que se sabe") : tr("Para el laboratorio"))}</h3><Copiar texto={hojaComoTexto(diana)} que={tr("la hoja de pedido")} /><button type="button" className="lab-hoja-cerrar" aria-label={tr("Cerrar panel del laboratorio")} onClick={() => fijarHojaAbierta(false)}>{tr("Cerrar ×")}</button></div>
          <div className="lab-hoja-identidad"><strong>{diana.simbolo}</strong><span>{hoja.identificador}</span></div>
          <p className="lab-hoja-estado" data-alerta={hoja.contradiceLaIntervencion || hoja.sinExperimento}>
            <i aria-hidden="true" />{hoja.contradiceLaIntervencion ? tr('Contrato por revisar') : hoja.sinExperimento ? tr('Sin experimento propuesto') : tr('Experimento propuesto')}
          </p>
        </header>
        {hoja.contradiceLaIntervencion && <div className="lab-hoja-alerta" role="note"><strong>{tr("La intervención y el contrato no coinciden")}</strong><p>{tr("Se propone un experimento de banco, pero el contrato indica revisar lo publicado. Esta ficha no es un pedido para un laboratorio.")}</p></div>}
        <div className="lab-hoja-cuerpo" tabIndex={0} aria-label={tr("Detalles de la ficha")}>
          {hoja.sinExperimento ? <div className="lab-sabido">
            {diana.loQueSeSabe.length ? diana.loQueSeSabe.map((x, i) => <div key={i}><h4>{x.tema}</h4><p>{x.enunciado}</p>{x.referencia && <cite>{x.referencia}</cite>}</div>) : <p className="lab-faltan">{tr("Las afirmaciones que la nombran no han dejado todavía un enunciado sostenido con cita.")}</p>}
            <p className="lab-faltan">{tr("Ninguna hipótesis propone un experimento sobre ella. Esta evidencia permite decidir si merece uno.")}</p>
          </div> : <>
            {hoja.queSeHace && <section className="lab-hoja-propuesta"><h4>{tr("Qué se propone")}</h4><p>{hoja.queSeHace}</p></section>}
            {hoja.sistema && <p className="lab-hoja-sistema"><span>{tr("Sistema experimental")}</span><strong>{SISTEMA[hoja.sistema] ?? hoja.sistema}</strong></p>}
            {hoja.refuta && <details className="lab-hoja-refutacion"><summary><span><strong>{tr("Qué la refutaría")}</strong><small>{tr("El criterio que pone a prueba la hipótesis")}</small></span><span className="lab-ficha-desplegar" aria-hidden="true">+</span></summary><p>{hoja.refuta}</p></details>}
            {hoja.controles && <details className="lab-hoja-controles"><summary><span><strong>{tr("Controles")}</strong><small>{tr("Cómo distinguir el efecto de un sesgo")}</small></span><span className="lab-ficha-desplegar" aria-hidden="true">+</span></summary><p>{hoja.controles}</p></details>}
          </>}
          <details className="lab-hoja-origen"><summary><span><strong>{tr("De dónde viene la evidencia")}</strong><small>{(diana.investigaciones.length === 1 ? trp("{investigaciones} investigación · {fuentes} fuentes", { investigaciones: diana.investigaciones.length, fuentes: n(diana.fuentes) }) : trp("{investigaciones} investigaciones · {fuentes} fuentes", { investigaciones: diana.investigaciones.length, fuentes: n(diana.fuentes) }))}</small></span><span className="lab-ficha-desplegar" aria-hidden="true">+</span></summary>
            <p>{trp("{hechos} afirmaciones; {sabidos} sostenidas. {fuentes} fuentes.", { hechos: n(diana.hechos), sabidos: n(diana.sabidos), fuentes: n(diana.fuentes) })}</p>
            {diana.investigaciones.map((inv) => <div className="lab-origen-fila" key={inv.id}><span>{inv.titulo}</span><b>{n(inv.hechos)}</b><meter min={0} max={Math.max(1, ...diana.investigaciones.map(x => x.hechos))} value={inv.hechos} aria-label={trp("Afirmaciones de {titulo}", { titulo: inv.titulo })} /></div>)}
            <small>{tr("Las barras comparan el número de afirmaciones por investigación, no su certeza.")}</small>
          </details>
          {hoja.faltan.length > 0 && <p className="lab-faltan">{trp("El contrato todavía no dice: {v}.", { v: hoja.faltan.join(', ') })}</p>}
          {hoja.otrosExperimentos.length > 0 && <p className="lab-faltan">{(hoja.otrosExperimentos.length === 1 ? trp("Hay {otrosExperimentos} experimento adicional. Cada uno conserva sus controles y su criterio de refutación. Copiar incluye todos.", { otrosExperimentos: hoja.otrosExperimentos.length }) : trp("Hay {otrosExperimentos} experimentos adicionales. Cada uno conserva sus controles y su criterio de refutación. Copiar incluye todos.", { otrosExperimentos: hoja.otrosExperimentos.length }))}</p>}
        </div>
        <footer className="lab-hoja-acciones">
          {diana.aso?.candidatos.length ? <button type="button" className="lab-abrir-experimento lab-abrir-aso" onClick={() => fijarVerAso(true)}><span className="lab-hoja-numero">{n(diana.aso.candidatosEnTotal ?? diana.aso.candidatos.length)}</span><span><strong>{tr("Explorar oligonucleótidos")}</strong><small>{tr("Candidatos para reducir la producción")}</small></span><span aria-hidden="true">↗</span></button> : null}
          <button type="button" className="lab-abrir-experimento" onClick={() => fijarVerExperimento(true)}>{(hoja.sinExperimento ? tr("Ver la evidencia y la química") : tr("Ver el experimento entero"))}<span aria-hidden="true">↗</span></button>
        </footer>
      </aside>

      <div className={`lab-capa lab-leyenda${nivel > 0 ? ' lab-fuera' : ''}`}>
        <b>{tr("CONFIANZA DEL MODELO")}</b>
        <div>
          <i style={{ background: '#0053D6' }} /> {tr("muy alta, más de 90")}
        </div>
        <div>
          <i style={{ background: '#65CBF3' }} /> {tr("alta, 70 a 90")}
        </div>
        <div>
          <i style={{ background: '#FFDB13' }} /> {tr("baja, 50 a 70")}
        </div>
        <div>
          <i style={{ background: '#FF7D45' }} /> {tr("muy baja, menos de 50")}
        </div>
      </div>

      <div className={`lab-capa lab-mando${nivel > 0 ? ' lab-fuera' : ''}`} aria-hidden={nivel > 0}>
        <div className="lab-niveles">
          {[tr('LÁMINA'), 'PARTES', tr('ÁTOMOS')].map((t, i) => (
            <button key={t} type="button" tabIndex={nivel > 0 ? -1 : 0} aria-current={nivel === i} onClick={() => irANivel(i)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {nivel === 1 && !marcas.length ? (
        <p className="lab-sinmarcas">
          {marcasEstado === 'pidiendo'
            ? tr('Trayendo las anotaciones de UniProt…')
            : marcasEstado === 'sin_respuesta'
              ? tr('No pude comprobar qué partes tiene: UniProt no respondió. No quiere decir que no las tenga.')
              : trp("UniProt no tiene dominios ni sitios anotados para {simbolo}.", { simbolo: diana.simbolo })}
        </p>
      ) : null}

      {residuo && !fijado ? (
        <div className="lab-residuo" style={{ left: residuo.x, top: residuo.y }}>
          <b>
            {AMINOACIDO[residuo.r.aa] ?? residuo.r.aa} {residuo.r.numero}
          </b>
          <span>{trp("pLDDT {v} · confianza ", { v: residuo.r.plddt.toFixed(0) })}<em>{confianzaEnPalabras(residuo.r.plddt)}</em>
          </span>
          <i>{tr("pulsa para abrirlo")}</i>
        </div>
      ) : null}



      {!medido && !fallo ? <div className="lab-cargando">{trp("trayendo la estructura de {fuente}…", { fuente: diana.estructura.fuente })}</div> : null}
      {fijado ? (
        <FichaResiduo
          r={fijado.r}
          diana={diana}
          marcas={marcas}
          vecinos={fijado.vecinos}
          contexto={fijado.contexto}
          alCerrar={() => fijarFijado(null)}
        />
      ) : null}

      {parte ? (
        <Parte
          marca={parte.marca}
          diana={diana}
          residuos={parte.residuos}
          plddtProteina={medido?.plddtMedio ?? 0}
          alCerrar={() => fijarParte(null)}
        />
      ) : null}

      {verExperimento ? <Experimento diana={diana} alCerrar={() => fijarVerExperimento(false)} /> : null}
      {verAso ? <Aso diana={diana} alCerrar={() => fijarVerAso(false)} /> : null}

      {fallo ? (
        <div className="lab-cargando lab-fallo">
          {trp("No pude traer la estructura de {simbolo}. ", { simbolo: diana.simbolo })}<span>{fallo}</span>
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------------------
   El muro y los compuestos
   -------------------------------------------------------------------------- */

function FichaCompuesto({ c }: { c: CompuestoDeLaboratorio }) {
  return (
    <article className={`lab-compuesto${c.enPubchem ? '' : ' lab-sin-ficha'}`}>
      <header>
        <h3>{c.nombre}</h3>
        {c.enPubchem ? (
          <span className={`lab-cerebro lab-cerebro-${c.cerebro.veredicto}`}>
            {c.cerebro.veredicto === 'compatible'
              ? tr('perfil compatible con llegar al cerebro')
              : c.cerebro.veredicto === 'improbable'
                ? tr('improbable por difusión')
                : tr('no comprobable')}
          </span>
        ) : (
          <span className="lab-cerebro">{tr("sin ficha de molécula pequeña")}</span>
        )}
      </header>

      <p className="lab-peso-evidencia">
        {c.menciones === 0 ? (
          <>{tr("Lo nombra una intervención propuesta; todavía ninguna afirmación verificada.")}</>
        ) : (
          <>
            {tr("Lo nombran")} <b>{n(c.menciones)}</b> {c.menciones === 1 ? tr('afirmación') : 'afirmaciones'}
            {c.sostenidos ? <>{trp(", {sostenidos} sostenidas por su fuente", { sostenidos: n(c.sostenidos) })}</> : null}.
          </>
        )}
        {c.ontologiaId ? <span className="lab-mono"> {c.ontologiaId}</span> : null}
      </p>

      {c.enPubchem ? (
        <>
          {c.url2d ? <img className="lab-2d" src={c.url2d} alt={trp("Estructura plana de {nombre}", { nombre: c.nombre })} loading="lazy" /> : null}
          <p className="lab-cerebro-motivo">{c.cerebro.motivo}.</p>
          <dl>
            <div>
              <dt>{tr("FÓRMULA")}</dt>
              <dd className="lab-mono">{c.formula}</dd>
            </div>
            <div>
              <dt>PESO</dt>
              <dd className="lab-mono">{c.peso} {tr("g/mol")}</dd>
            </div>
            <div>
              <dt>SMILES {c.smiles ? <Copiar texto={c.smiles} que={tr("el SMILES")} /> : null}</dt>
              <dd className="lab-mono lab-largo">{c.smiles}</dd>
            </div>
            <div>
              <dt>INCHIKEY {c.inchikey ? <Copiar texto={c.inchikey} que={tr("el InChIKey")} /> : null}</dt>
              <dd className="lab-mono">{c.inchikey}</dd>
            </div>
            <div>
              <dt>PUBCHEM</dt>
              <dd className="lab-mono">CID {c.cid}</dd>
            </div>
          </dl>
          <p className="lab-nota">
            {tr("La fórmula NO identifica un compuesto: la comparten sus isómeros. Lo que lo fija para un pedido es el SMILES y el InChIKey.")}
          </p>
        </>
      ) : (
        /* Sin ficha en PubChem no se pintan filas de química vacías: se dice
           qué es lo que falta y por qué, que para un anticuerpo es lo normal. */
        <p className="lab-nota lab-nota-falta">
          {tr("PubChem no lo tiene como compuesto, así que no hay SMILES ni InChIKey que mandar")}
          {c.motivo && !c.motivo.startsWith('PubChem') ? <> ({c.motivo})</> : null}{tr(". Suele pasar con los anticuerpos y las proteínas terapéuticas: no son moléculas pequeñas y se piden por su secuencia o por su nombre comercial, no por su estructura química. Está aquí porque la evidencia lo nombra, no porque ROSA2018 pueda pedirlo.")}
        </p>
      )}
    </article>
  );
}

/** La decisión: de todo lo verificado, contra cuál diseñar el oligo.
 *
 *  No existe un oligonucleótido que las apague todas: un ASO empareja bases
 *  con UNA secuencia, y la que encaja con tau no encaja con APP. Lo que sí se
 *  puede reunir de toda la investigación es esta decisión, y lo que la hace
 *  útil es que cada término se ve y se puede discutir. */
function Decision({
  o,
  dianas,
  alAbrir,
}: {
  o: OligoQueMandaria;
  dianas: DianaDeLaboratorio[];
  alAbrir: (d: DianaDeLaboratorio, panel?: 'aso') => void;
}) {
  const diana = dianas.find((d) => d.uniprot === o.uniprot);
  const fuera = o.fueraDeConcurso;
  const etiquetaFuera: Record<string, string> = {
    subir: tr('porque la evidencia pide SUBIRLAS, y un oligo las bajaría'),
    modular: tr('porque se habla de modularlas sin decir en qué sentido'),
    mezclado: tr('porque hay hipótesis que piden subirlas y otras bajarlas'),
    ninguna: tr('porque ninguna hipótesis propone intervenir: son biomarcadores, no dianas de tratamiento todavía'),
  };
  // Fuera del JSX: un className multilínea rompe la comprobación de que
  // ninguna clase lleve caracteres fuera de ASCII, y además se lee peor.
  const pa = o.paraAnimales;
  const colorAnimales = pa?.hay && pa.esElMismo ? 'bien' : pa?.hay ? 'duda' : 'mal';
  return (
    <section className="lab-decision">
      <header>
        <p className="lab-migas">{tr("LA DECISIÓN DE ROSA2018")}</p>
        <h2>
          {tr("Si hubiera que mandar uno, sería contra")} <b>{o.simbolo}</b>
          {o.tambienLlamada ? <i> · {o.tambienLlamada}</i> : null}
        </h2>
        <p className="lab-decision-entrada">
          {tr("No existe un oligonucleótido que las apague todas: encaja con una secuencia y la de una proteína no es la de otra. Lo que sí se puede reunir de todo lo que ROSA2018 ha verificado es")} <b>{tr("a cuál apuntar")}</b>{tr(", y esta es la cuenta.")}
        </p>
      </header>

      <div className="lab-decision-cuerpo">
        <div className="lab-decision-oligo">
          <Secuencia c={o.candidato} grande />
          <p className="lab-nota">
            {(o.diseño.mismaIsoformaQueLaProteina ? trp("Posición {v} del transcrito {transcrito}{v2}. Es la misma versión del gen que la proteína de al lado, confirmado por MANE Select.", { v: o.candidato.posicion.toLocaleString('es'), transcrito: o.diseño.transcrito, v2: o.candidato.region ? trp(", en la {region}", { region: o.candidato.region }) : '' }) : trp("Posición {v} del transcrito {transcrito}{v2}. No se puede confirmar que sea la misma versión del gen que la proteína: este gen no tiene MANE Select.", { v: o.candidato.posicion.toLocaleString('es'), transcrito: o.diseño.transcrito, v2: o.candidato.region ? trp(", en la {region}", { region: o.candidato.region }) : '' }))}
          </p>
          {diana ? (
            <button type="button" className="lab-abrir-experimento lab-abrir-aso" onClick={() => alAbrir(diana, 'aso')}>
              {tr("Ver este oligonucleótido y los demás candidatos")}
              <i aria-hidden="true">→</i>
            </button>
          ) : null}
        </div>

        <div className="lab-decision-cuenta">
          <h3>{tr("POR QUÉ ESTA Y NO OTRA")}</h3>
          <table>
            <tbody>
              {o.porQue.map((t) => (
                <tr key={t.criterio}>
                  <th>{t.criterio}</th>
                  <td className="lab-mono">{t.valor}</td>
                  <td className={`lab-puntos${t.puntos > 0 ? ' lab-puntos-si' : ''}`}>
                    {t.puntos > 0 ? '+' : ''}
                    {t.puntos.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr className="lab-total">
                <th>{tr("total")}</th>
                <td />
                <td className="lab-puntos lab-puntos-si">{o.puntos.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="lab-decision-pie">
        {/* El cribado del elegido va ANTES que el resto del pie: de todo lo que
            hay en esta tarjeta, es lo único que decide si esto se puede pedir
            hoy o no. */}
        <p className={`lab-decision-criba lab-decision-criba-${tituloCriba(o.criba?.veredicto).clase}`}>
          <b>{tituloCriba(o.criba?.veredicto).titulo}.</b> {o.criba?.porQue ?? o.candidato.avisoCribado}
        </p>
        {/* La SEGUNDA respuesta. El que más evidencia tiene puede no encajar
            en ningún roedor, y entonces no se puede ni empezar: son dos
            decisiones distintas y se enseñan las dos en vez de esconder una
            en un peso. */}
        {o.paraAnimales ? (
          <p className={`lab-decision-criba lab-decision-criba-${colorAnimales}`}>
            <b>
              {o.paraAnimales.esElMismo
                ? tr('Y se puede probar en un roedor.')
                : o.paraAnimales.hay
                  ? trp("Para empezar en el animal, el {v}.", { v: o.paraAnimales.candidato?.secuencia ?? 'otro' })
                  : tr('Ninguno se puede probar en un roedor tal cual.')}
            </b>{' '}
            {o.paraAnimales.porQue}
            {o.paraAnimales.hay && !o.paraAnimales.esElMismo ? (
              <>
                {' '}
                <span className="lab-mono">{o.paraAnimales.candidato?.secuencia}</span>
                {o.paraAnimales.sirveEn?.length ? <>{trp(" (encaja en {v}).", { v: o.paraAnimales.sirveEn.join(' y ') })}</> : null}
              </>
            ) : null}
          </p>
        ) : null}
        {o.frenteA.length ? (
          <p>
            <b>{tr("Frente a las que sí competían:")}</b>{' '}
            {o.frenteA.map((x) => trp("{simbolo}, que {porQueNo}", { simbolo: x.simbolo, porQueNo: x.porQueNo })).join('; ')}.
          </p>
        ) : null}
        <p>
          <b>{tr("Las que ni compitieron:")}</b>{' '}
          {Object.entries(fuera)
            .map(([k, v]) => `${v.join(', ')} ${etiquetaFuera[k] ?? k}`)
            .join('; ')}
          .
        </p>
        <p className="lab-decision-refuta">
          <b>{tr("Qué la cambiaría:")}</b> {o.queLaCambiaria}
        </p>
      </div>
    </section>
  );
}

function Muro({ datos, alElegir }: { datos: Datos; alElegir: (d: DianaDeLaboratorio, panel?: 'aso') => void }) {
  const r = datos.resumen;
  return (
    <div className="lab-muro-marco">
      <header className="lab-cabecera">
        <p className="lab-migas">{tr("TODO LO QUE ROSA2018 HA VERIFICADO")}</p>
        <h1>{tr("Lo que ROSA2018 mandaría al laboratorio")}</h1>
        <p className="lab-entrada">
          {r.dianas === 0 ? (
            tr('Todavía ninguna afirmación verificada nombra una proteína con identificador resuelto. Cuando la nombre, su estructura aparecerá aquí.')
          ) : (
            <>
              {trp("{v}, reunidas de {v2} que ROSA2018 ha hecho. Las nombran {afirmaciones} afirmaciones, {sostenidas} de ellas sostenidas por su fuente. ", { v: r.dianas === 1 ? tr('Una proteína') : trp("{dianas} proteínas", { dianas: r.dianas }), v2: r.investigaciones === 1 ? tr('la investigación') : trp("las {investigaciones} investigaciones", { investigaciones: r.investigaciones }), afirmaciones: n(r.afirmaciones), sostenidas: n(r.sostenidas) })}
              <b>
                {r.deBanco === 0
                  ? tr('Hoy ninguna se podría mandar a un laboratorio: ninguna hipótesis propone todavía un experimento de banco sobre ellas.')
                  : r.deBanco === 1
                    ? tr('De todas ellas, hoy se podría mandar una: es la única con un experimento de banco propuesto.')
                    : trp("De todas ellas, hoy se podrían mandar {deBanco}: son las que tienen un experimento de banco propuesto.", { deBanco: r.deBanco })}
              </b>{' '}
              {tr("Por eso el orden empieza por esas y no por las más nombradas.")} <b>{tr("ROSA2018 no ha diseñado ninguna")}</b>{tr(", las nombra lo que ha verificado, y aquí se ven tal como son.")}
            </>
          )}
        </p>
        <div className="lab-tira">
          <div>
            <b>{r.dianas}</b>
            <span>{tr("PROTEÍNAS")}</span>
          </div>
          <div className={r.deBanco === 0 ? 'lab-ojo' : ''}>
            <b>{r.deBanco}</b>
            <span>{tr("SE PUEDEN MANDAR")}</span>
          </div>
          <div>
            <b>{n(r.sostenidas)}</b>
            <span>SOSTENIDAS</span>
          </div>
          <div>
            <b>{r.hipotesisConDiana}</b>
            <span>{tr("HIPÓTESIS")}</span>
          </div>
          <div className="lab-verde">
            <b>{r.conAso}</b>
            <span>{tr("CON OLIGO DISEÑADO")}</span>
          </div>
          <div>
            <b>{r.compuestos}</b>
            <span>COMPUESTOS</span>
          </div>
          <div className="lab-ojo">
            <b>{r.sinExperimento}</b>
            <span>{tr("SIN EXPERIMENTO")}</span>
          </div>
        </div>
      </header>

      {datos.oligoQueMandaria ? <Decision o={datos.oligoQueMandaria} alAbrir={alElegir} dianas={datos.dianas} /> : null}

      <div className="lab-muro" data-cuantas={Math.min(datos.dianas.length, 3)}>
        {datos.dianas.map((d, i) => (
          <div key={d.uniprot} className={`lab-pieza${i === 0 ? ' lab-grande' : ''}`}>
            <button type="button" className="lab-pieza-abrir" onClick={() => alElegir(d)}>
            <Miniatura diana={d} grande={i === 0} />
            <span className="lab-marca">
              <b>
                {d.simbolo}
                {d.tambienLlamada ? <i> · {d.tambienLlamada}</i> : null}
              </b>
              <em>{d.nombre}</em>
            </span>
            <span className="lab-cuantas">
              {d.hechos === 0 ? (
                <>{tr("sin afirmaciones todavía; la propone una hipótesis")}</>
              ) : (
                <>
                  {(d.sabidos === 1 ? trp("{sabidos} afirmación sostenida · {fuentes} {v}{v2}", { sabidos: n(d.sabidos), fuentes: d.fuentes, v: d.fuentes === 1 ? tr("fuente") : tr("fuentes"), v2: d.investigaciones.length > 1 ? ` · ${d.investigaciones.length} investigaciones` : '' }) : trp("{sabidos} afirmaciones sostenidas · {fuentes} {v}{v2}", { sabidos: n(d.sabidos), fuentes: d.fuentes, v: d.fuentes === 1 ? tr("fuente") : tr("fuentes"), v2: d.investigaciones.length > 1 ? ` · ${d.investigaciones.length} investigaciones` : '' }))}
                </>
              )}
              {d.enHipotesis ? (
                (() => {
                  const k = decisionDeLaDiana(d);
                  return (
                    <em className={k ? `lab-estado-${KILLER[k]!.tono}` : ''}>
                      {' '}
                      · {d.enHipotesis === 1 ? tr('1 hipótesis') : trp("{enHipotesis} hipótesis", { enHipotesis: d.enHipotesis })}
                      {k ? `, ${KILLER[k]!.texto}` : ''}
                    </em>
                  );
                })()
              ) : (
                <em className="lab-estado-no"> {tr("· ninguna hipótesis la propone")}</em>
              )}
            </span>
            <span className={`lab-mandar${d.deBanco ? ' lab-mandar-si' : ''}`}>
              {d.deBanco
                ? tr('se puede mandar: hay un experimento de banco')
                : d.hojaDePedido.queSeHace
                  ? tr('no se manda a un banco: lo propuesto es revisar lo publicado')
                  : tr('no hay experimento que mandar todavía')}
            </span>
            </button>
            {!d.aso?.candidatos.length && d.direccion.pide === 'subir' ? (
              /* Aquí un oligonucleótido iría al revés de lo que concluyó la
                 propia investigación, y eso hay que decirlo donde se ve. */
              <span className="lab-pieza-aso lab-pieza-aso-no">
                <span className="lab-pieza-aso-pie">{tr("un oligonucleótido la bajaría, y la evidencia pide subirla")}</span>
              </span>
            ) : null}
            {d.aso?.candidatos.length ? (
              <button type="button" className="lab-pieza-aso" onClick={() => alElegir(d, 'aso')}>
                <span className="lab-pieza-aso-sec">
                  {d.aso.candidatos[0]!.partes.ala5}
                  <i>{d.aso.candidatos[0]!.partes.hueco}</i>
                  {d.aso.candidatos[0]!.partes.ala3}
                </span>
                <span className="lab-pieza-aso-pie">
                  {trp("{v} oligonucleótidos para cortar su producción ", { v: d.aso.candidatosEnTotal ?? d.aso.candidatos.length })}<em>→</em>
                </span>
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {datos.compuestos.length ? (
        <section className="lab-seccion">
          <h2>{tr("Los compuestos que nombra")}</h2>
          <p className="lab-nota-seccion">
            {tr("Los elige la evidencia, no PubChem: entra el que las afirmaciones nombran, con su identificador de ontología. Que además PubChem lo tenga como molécula pequeña con su SMILES es un añadido, y un anticuerpo no lo va a tener nunca. ROSA2018 no ha diseñado ninguno.")}
          </p>
          <div className="lab-compuestos">
            {datos.compuestos.map((c) => (
              <FichaCompuesto key={c.nombre} c={c} />
            ))}
          </div>
        </section>
      ) : null}

      {datos.nombradasSinEstructura.length || datos.descartadasPorAlias.length ? (
        <section className="lab-seccion lab-descartes">
          <h2>{tr("Lo que no está en el muro")}</h2>
          {datos.nombradasSinEstructura.length ? (
            /* El motivo lo pone el backend, uno por proteína. Antes iba escrito
               aquí en duro y decía que TREM2 «no tiene acceso de UniProt»:
               TREM2 es Q9NZC2 y sí lo tiene. Repetir el texto en la pantalla
               hizo que arreglar el backend no arreglara la mentira. */
            <p>
              <b>{tr("Nombradas y sin estructura que traer:")}</b>{' '}
              {datos.nombradasSinEstructura.map((x) => (
                <span key={x.simbolo}>
                  {(x.hechos === 1 ? trp("{simbolo} ({hechos} afirmación): {motivo}. ", { simbolo: x.simbolo, hechos: x.hechos, motivo: x.motivo }) : trp("{simbolo} ({hechos} afirmaciones): {motivo}. ", { simbolo: x.simbolo, hechos: x.hechos, motivo: x.motivo }))}
                </span>
              ))}
            </p>
          ) : null}
          {datos.descartadasPorAlias.length ? (
            <p>
              <b>{tr("Descartadas por resolverse solo por alias:")}</b>{trp(" {v}. Son nombres que la normalización de entidades convirtió en genes que nadie mencionó: la escala ADAS-Cog entra como AGPS, la anomalía de imagen ARIA como ECSCR, los trazadores FDG y F18 como SMUG1 y MAMLD1. Mandar eso a un laboratorio sería un error caro, así que se quedan fuera y se dicen.", { v: datos.descartadasPorAlias.map((x) => `${x.simbolo} (${x.hechos})`).join(', ') })}
            </p>
          ) : null}
        </section>
      ) : null}

      {datos.sinResolver.length ? (
        <p className="lab-sinresolver">
          {trp("Nombres que se buscaron y PubChem no reconoce como compuesto: {v}. Suelen ser anticuerpos o nombres de familia, que no tienen ficha de molécula pequeña.", { v: datos.sinResolver.map((x) => x.nombre).join(', ') })}
        </p>
      ) : null}

      <p className="lab-pie-muro">
        {tr("Lo que se dibuja son siempre modelos")} <b>{tr("predichos")}</b> de <a href="https://alphafold.ebi.ac.uk">AlphaFold DB</a> {tr("(CC BY 4.0), que es lo único que hay de longitud completa para todas. En cada lámina se dice cuántas estructuras")} <b>{tr("medidas")}</b>{' '}
        {tr("guarda el")} <a href="https://www.rcsb.org">RCSB PDB</a> {tr("(CC0) de esa proteína y se enlaza; ROSA2018 no elige una porque casi todas son fragmentos y quedarse con uno al azar sería peor que el modelo completo. La química es de")}{' '}
        <a href="https://pubchem.ncbi.nlm.nih.gov">PubChem</a>{tr("; las entidades y las anotaciones, de")}{' '}
        <a href="https://www.genenames.org">HGNC</a> y <a href="https://www.uniprot.org">UniProt</a> {tr("(CC BY 4.0). Una predicción no es una medición, y en cada lámina se dice de qué tramos se fía el modelo. ROSA2018 no calcula acoplamientos ni propone estructuras nuevas.")}
      </p>
    </div>
  );
}

/** La proteína en pequeño, dentro de su tarjeta del muro. Se trae cuando la
 *  tarjeta entra en pantalla: cada estructura pesa de 0,5 a 2 MB. */
function Miniatura({ diana, grande }: { diana: DianaDeLaboratorio; grande: boolean }) {
  const caja = useRef<HTMLDivElement | null>(null);
  const [visible, fijarVisible] = useState(false);
  const [medido, fijarMedido] = useState<Medido | null>(null);
  const [fallo, fijarFallo] = useState(false);

  useEffect(() => {
    const nodo = caja.current;
    if (!nodo || typeof IntersectionObserver === 'undefined') return fijarVisible(true);
    // Se sigue vigilando después de la primera vez, a propósito: un navegador
    // no da más de unos dieciséis contextos WebGL a la vez y este muro ya tiene
    // diecisiete dianas. La tarjeta que sale de pantalla suelta el suyo.
    //
    // El margen es ancho (900 px, casi dos filas de tarjetas) para que un
    // desplazamiento normal no destruya y rehaga los visores todo el rato: con
    // 300 px, bajar una pantalla dejaba medio muro en «trayendo la
    // estructura». Con 900 quedan vivos unos ocho, por debajo del tope.
    const vigia = new IntersectionObserver((e) => fijarVisible(e.some((x) => x.isIntersecting)), { rootMargin: '900px' });
    vigia.observe(nodo);
    return () => vigia.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) {
      fijarMedido(null);
      return;
    }
    let vivo = true;
    let visor: Visor | null = null;
    (async () => {
      const nodo = caja.current;
      if (!nodo) return;
      try {
        const { crearVisor } = await import('../lib/visorMolecular');
        visor = await crearVisor(nodo, 0x0c0b10);
        if (!vivo) return visor.destruir();
        const m = await visor.cargar(diana.estructura.url, 'mmcif', 'ilustrativa');
        if (!vivo) return;
        fijarMedido(m);
        // Mol* encuadra la caja entera con mucho aire alrededor; en una tarjeta
        // eso deja la proteína pequeña en medio de un rectángulo vacío.
        visor.encuadrar(0.74, 0);
        // Las miniaturas NO giran. Eran diecisiete visores con oclusión
        // ambiental redibujando a sesenta por segundo a la vez: el muro se
        // arrastraba y no aportaba nada que no diga una imagen quieta.
      } catch {
        // La estructura la baja el NAVEGADOR de AlphaFold, no el servidor de
        // ROSA2018: una red que no llega allí deja la tarjeta sin proteína. Se
        // dice. Dejarla en "trayendo la estructura…" para siempre sería mentir.
        if (vivo) fijarFallo(true);
      }
    })();
    return () => {
      vivo = false;
      visor?.destruir();
    };
  }, [visible, diana.estructura.url]);

  const pct = medido ? Math.round(medido.fiable * 100) : null;
  return (
    <>
      <span className={`lab-mini${grande ? ' lab-mini-grande' : ''}`} ref={caja as unknown as React.RefObject<HTMLSpanElement>} />
      <span className="lab-zocalo">
        <span className="lab-barra" aria-hidden="true">
          <i style={{ width: pct === null ? '0%' : `${pct}%` }} />
        </span>
        <span className="lab-confianza">{fallo ? tr('no pude traer la estructura de AlphaFold') : pct === null ? tr('trayendo la estructura…') : trp("{pct} % del modelo con confianza alta", { pct })}</span>
      </span>
      <span className="lab-sello">{(diana.estructura.clase === 'predicha' ? tr("predicha") : tr("medida"))}</span>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function Laboratorio({
  dianaId,
  panel,
  alAbrirDiana,
}: {
  dianaId: string | null;
  panel: 'aso' | null;
  alAbrirDiana: (uniprot: string | null, panel?: 'aso' | null) => void;
}) {
  const [datos, fijarDatos] = useState<Datos | null>(null);
  const [fase, fijarFase] = useState<'cargando' | 'listo' | 'sin_servidor' | 'sin_respuesta'>('cargando');

  useEffect(() => {
    let vivo = true;
    fijarFase('cargando');
    void acciones.laboratorio().then((r) => {
      if (!vivo) return;
      if (r === null) return fijarFase('sin_servidor');
      if (r === 'sin_respuesta') return fijarFase('sin_respuesta');
      fijarDatos(r);
      fijarFase('listo');
    });
    return () => {
      vivo = false;
    };
  }, []);

  // La diana abierta va en la URL (#/laboratorio/P10636): así se puede enlazar
  // una proteína concreta y el botón de atrás del navegador funciona.
  const diana = useMemo(() => datos?.dianas.find((d) => d.uniprot === dianaId) ?? null, [datos, dianaId]);

  if (fase === 'sin_servidor') {
    return (
      <div className="contenido contenido-ancho">
        <AvisoMuestra conexion="muestra" />
        <p className="nota" role="status">
          {tr("Esta sección se arma con lo que ROSA2018 ha verificado en sus corridas, y ahora mismo estás viendo los datos de muestra. No hay estructuras que enseñar.")}
        </p>
      </div>
    );
  }
  if (fase === 'sin_respuesta') {
    return (
      <div className="contenido contenido-ancho">
        <p className="nota" role="status">
          {tr("No pude comprobar qué iría al laboratorio: el servidor no respondió. No quiere decir que no haya dianas.")}
        </p>
      </div>
    );
  }
  if (!datos) {
    return (
      <div className="contenido contenido-ancho">
        <p className="nota" role="status">
          {tr("Reuniendo lo que ROSA2018 ha verificado en todas sus investigaciones…")}
        </p>
      </div>
    );
  }
  if (diana) return <Lamina key={diana.uniprot} diana={diana} abrirAso={panel === 'aso'} alVolver={() => alAbrirDiana(null)} />;
  return <Muro datos={datos} alElegir={(d, p) => alAbrirDiana(d.uniprot, p)} />;
}
