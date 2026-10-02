// El mapa del estado de la enfermedad (plan completo, etapa A;
// rosa/mapa_enfermedad.py mapa): dónde está la evidencia reunida por la
// investigación, situada por fase de la enfermedad (estadio), región del
// cerebro o compartimento (región) y tipo de célula. Primero el resumen en
// llano que escribe el servidor por regla; después, plegada como el resto de
// la ingeniería, la rejilla estadio x región con una ficha por tipo celular
// (hechos, hipótesis y la mayor certeza GRADE), los huecos que la misión
// nombra y nadie cubre, y el aviso de lo que no se pudo situar.

import type { CeldaMapa, EjeMapa, HuecoMapa, MapaEnfermedad as Mapa } from '../datos/tipos';
import { CERTEZA_EVIDENCIA } from '../lib/etiquetas';
import { plural } from '../lib/formato';
import { SoloDetalle } from './piezas';
import { traducido, tr, trc, trp } from '../lib/idioma';

/** Etiquetas de reserva, copiadas de rosa/mapa_enfermedad.py ETIQUETAS. Las
 *  que llegan con el mapa (mapa.etiquetas) mandan; estas cubren un mapa
 *  servido a demanda, que no las trae. */
export const ETIQUETAS_MAPA: Record<EjeMapa, Record<string, string>> = traducido({
  estadio: {
    preclinica: 'preclínica',
    prodromica_dcl: 'prodrómica o DCL',
    demencia_leve: 'demencia leve',
    demencia_moderada_grave: 'demencia moderada o grave',
    autosomico_dominante: 'autosómica dominante',
  },
  region: {
    hipocampo: 'hipocampo',
    corteza_entorrinal: 'corteza entorrinal',
    corteza_prefrontal: 'corteza frontal y prefrontal',
    corteza_temporal: 'corteza temporal',
    corteza_parietal: 'corteza parietal',
    cingulo_precuneo: 'cíngulo y precúneo',
    corteza_occipital: 'corteza occipital',
    amigdala: 'amígdala',
    ganglios_basales_talamo: 'ganglios basales y tálamo',
    tronco_locus_coeruleus: 'tronco encefálico y locus coeruleus',
    cerebelo: 'cerebelo',
    sustancia_blanca: 'sustancia blanca',
    vascular_bhe: 'vasculatura cerebral y barrera hematoencefálica',
    bulbo_olfatorio: 'bulbo y vía olfatoria',
    retina: 'retina',
    intestino_microbiota: 'intestino y microbiota',
    plasma: 'sangre, plasma y suero (compartimento periférico)',
    lcr: 'líquido cefalorraquídeo (LCR)',
    neocorteza: 'corteza cerebral (sin región concreta)',
    cerebro_sin_region: 'cerebro (sin región concreta)',
  },
  tipoCelular: {
    astrocito: 'astrocito',
    microglia: 'microglía',
    neurona: 'neurona',
    oligodendrocito: 'oligodendrocito',
    opc: 'OPC (célula precursora de oligodendrocitos)',
    endotelio: 'endotelio',
    pericito: 'pericito',
    inmune_periferico: 'célula inmune periférica (linfocito, monocito, macrófago)',
  },
  nivel: { molecular: 'molecular', celular: 'celular', tisular: 'tisular', clinico: 'clínico' },
});

/** Definiciones de reserva (rosa/mapa_enfermedad.py DEFINICIONES_ESTADIO y DEFINICIONES_NIVEL). */
export const DEFINICIONES_MAPA: { estadio: Record<string, string>; nivel: Record<string, string> } = traducido({
  estadio: {
    preclinica: 'biomarcadores alterados sin síntomas cognitivos',
    prodromica_dcl: 'deterioro cognitivo leve, síntomas sin demencia',
    demencia_leve: 'demencia establecida en su fase inicial',
    demencia_moderada_grave: 'demencia moderada o grave',
    autosomico_dominante: 'forma hereditaria por mutación en PSEN1, PSEN2 o APP; cohortes como DIAN',
  },
  nivel: {
    molecular: 'genes, proteínas, biomarcadores y metabolitos',
    celular: 'tipos celulares, cultivos y célula única',
    tisular: 'regiones, atrofia, imagen y neuropatología',
    clinico: 'pacientes, cognición, escalas, diagnóstico y ensayos',
  },
});

const ORDEN_ESTADIO = ['preclinica', 'prodromica_dcl', 'demencia_leve', 'demencia_moderada_grave', 'autosomico_dominante'];
const ORDEN_NIVEL = ['molecular', 'celular', 'tisular', 'clinico'];
const SIN = tr('sin situar');

/** La etiqueta visible de un valor de un eje: la que trae el mapa, si no la de
 *  reserva, si no la clave tal cual. Con null, "sin situar". */
export function etiquetaEje(mapa: Mapa | null | undefined, eje: EjeMapa, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return tr(SIN);
  const propias = mapa?.etiquetas && typeof mapa.etiquetas === 'object' ? mapa.etiquetas[eje] : undefined;
  return (propias && typeof propias === 'object' && typeof propias[valor] === 'string' && propias[valor]) || ETIQUETAS_MAPA[eje][valor] || valor;
}

function definicion(mapa: Mapa | null | undefined, eje: 'estadio' | 'nivel', valor: string | null): string | undefined {
  if (valor === null) return eje === 'estadio' ? tr('Registros con fase de la enfermedad sin identificar por su contenido ni por la misión.') : undefined;
  const propias = mapa?.definiciones && typeof mapa.definiciones === 'object' ? mapa.definiciones[eje] : undefined;
  return (propias && typeof propias === 'object' && typeof propias[valor] === 'string' && propias[valor]) || DEFINICIONES_MAPA[eje][valor];
}

const clave = (x: string | null | undefined) => (x === null || x === undefined || x === '' ? '' : String(x));
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
/** Texto seguro para pintar o poner en un title: lo que no es texto se omite (nunca "[object Object]"). */
const texto = (x: unknown): string => (typeof x === 'string' ? x : '');
/** Un recuento: número finito y no negativo; lo demás cuenta como 0. */
const cuentaDe = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
/** Los recuentos de un eje: solo un objeto llano con valores numéricos (una lista o un texto no son recuentos). */
const recuentos = (x: unknown): Record<string, number> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  const salida: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) salida[k] = v;
  return salida;
};
const claveCelda = (e: string, r: string) => `${e}\u0000${r}`;

function ordenar(valores: Set<string>, orden: string[], cuenta: Record<string, number>): string[] {
  return [...valores].sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (b === '' && a !== '') return -1;
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return (cuenta[b] ?? 0) - (cuenta[a] ?? 0) || a.localeCompare(b);
  });
}

function Ficha({ celda, mapa }: { celda: CeldaMapa; mapa: Mapa }) {
  const hechos = lista(celda.hechos).length;
  const hipotesis = lista(celda.hipotesis).length;
  const preguntas = lista(celda.preguntas).length;
  const certeza = celda.certezaMax && CERTEZA_EVIDENCIA[celda.certezaMax] ? CERTEZA_EVIDENCIA[celda.certezaMax] : null;
  const tipo = etiquetaEje(mapa, 'tipoCelular', celda.tipoCelular);
  const cohortes = lista(celda.cohortes);
  const certezaMotivo = texto(celda.certezaMotivo);
  const porMision = cuentaDe(celda.porMision);
  const titulo = [
    `${tipo === tr(SIN) ? tr('Sin tipo celular') : tipo}: ${plural(hechos, tr("hecho"))}, ${plural(hipotesis, tr("hipótesis"), trc("plural", "hipótesis"))}${preguntas ? trp(", {preguntas} (no cuentan como cobertura)", { preguntas: plural(preguntas, tr('pregunta abierta'), tr('preguntas abiertas')) }) : ''}.`,
    certeza ? `Certeza máxima: ${certeza.etiqueta.toLowerCase()}${certezaMotivo ? ` (${certezaMotivo})` : ''}.` : tr('Sin conclusión con certeza GRADE todavía.'),
    cohortes.length ? `Cohortes: ${cohortes.join(', ')}.` : '',
    porMision ? trp("{porMision} situados aquí solo por heredar los ejes de la misión.", { porMision }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`mapa-enf-ficha ${certeza ? `mapa-enf-certeza-${certeza.tono}` : ''}`} title={titulo}>
      <span className="mapa-enf-ficha-tipo">{tipo === tr(SIN) ? tr('sin tipo celular') : tipo}</span>
      <span className="mapa-enf-ficha-cifras">
        {trp("{hechos} h · {hipotesis} hip", { hechos, hipotesis })}</span>
      {certeza && <span className={`chip chip-${certeza.tono}`}>{certeza.etiqueta.replace('Certeza ', '')}</span>}
    </div>
  );
}

/** El mapa completo. `mapa` en null o undefined pinta el aviso de cuándo se calcula. */
export function MapaEnfermedad({ mapa }: { mapa: Mapa | null | undefined }) {
  if (!mapa || typeof mapa !== 'object') {
    return (
      <article className="tarjeta mapa-enf" aria-label={tr("Mapa de la enfermedad")}>
        <h3 className="mapa-enf-cabecera">{tr("Mapa de la enfermedad")}</h3>
        <p className="meta">{tr("Se calcula al cerrar la primera iteración: dónde cae la evidencia reunida por fase de la enfermedad, región del cerebro y tipo de célula, y qué combinaciones que nombra la misión siguen sin cubrir.")}</p>
      </article>
    );
  }
  const celdas = (Array.isArray(mapa.celdas) ? mapa.celdas : []).filter((c): c is CeldaMapa => Boolean(c) && typeof c === 'object');
  const huecos = (Array.isArray(mapa.huecos) ? mapa.huecos : []).filter((h): h is HuecoMapa => Boolean(h) && typeof h === 'object');
  const mision = mapa.mision && typeof mapa.mision === 'object' ? mapa.mision : null;
  const ejes = mapa.ejes && typeof mapa.ejes === 'object' && !Array.isArray(mapa.ejes) ? mapa.ejes : ({} as Partial<Mapa['ejes']>);
  const cuenta = (eje: EjeMapa): Record<string, number> => recuentos(ejes[eje]);
  const sinEjes = cuentaDe(mapa.sinEjes);
  const hipSinEjes = cuentaDe(mapa.hipotesisSinEjes);
  const iteracion = cuentaDe(mapa.iteracion);
  const resumen = texto(mapa.resumen);

  const estadios = new Set<string>();
  const regiones = new Set<string>();
  for (const c of celdas) {
    estadios.add(clave(c.estadio));
    regiones.add(clave(c.region));
  }
  for (const h of huecos) {
    estadios.add(clave(h.estadio));
    regiones.add(clave(h.region));
  }
  for (const s of lista(mision?.estadios)) estadios.add(s);
  for (const r of lista(mision?.region)) regiones.add(r);
  const filas = ordenar(estadios, ORDEN_ESTADIO, cuenta('estadio'));
  const columnas = ordenar(regiones, [], cuenta('region'));
  // Índice por (fase, región) para no recorrer todas las celdas en cada casilla de la rejilla.
  const celdasPor = new Map<string, CeldaMapa[]>();
  for (const c of celdas) {
    const k = claveCelda(clave(c.estadio), clave(c.region));
    celdasPor.set(k, [...(celdasPor.get(k) ?? []), c]);
  }
  const huecosPor = new Map<string, HuecoMapa[]>();
  for (const h of huecos) {
    const k = claveCelda(clave(h.estadio), clave(h.region));
    huecosPor.set(k, [...(huecosPor.get(k) ?? []), h]);
  }
  const enCelda = (e: string, r: string) => celdasPor.get(claveCelda(e, r)) ?? [];
  const huecosEn = (e: string, r: string) => huecosPor.get(claveCelda(e, r)) ?? [];
  const niveles = Object.entries(cuenta('nivel')).sort(([a], [b]) => ORDEN_NIVEL.indexOf(a) - ORDEN_NIVEL.indexOf(b));
  const hayRejilla = filas.length > 0 && columnas.length > 0;

  return (
    <article className="tarjeta mapa-enf" aria-label={tr("Mapa de la enfermedad")}>
      <div className="mapa-enf-cabecera">
        <h3>{tr("Mapa de la enfermedad")}</h3>
        <span className="meta">{iteracion ? trp("Calculado al cerrar la iteración {iteracion}.", { iteracion }) : tr('Calculado a demanda.')}</span>
      </div>
      {resumen ? <p className="mapa-enf-resumen">{resumen}</p> : null}
      {(sinEjes > 0 || hipSinEjes > 0) && (
        <p className="aviso-muestra mapa-enf-aviso" role="status">
          {(sinEjes + hipSinEjes === 1 ? trp("{v} no se pudo situar en ningún eje: su texto no nombra fase, región ni tipo celular y la misión no {v2} fija. {v3} en el modelo de mundo.", { v: [sinEjes > 0 ? plural(sinEjes, tr("hecho")) : '', hipSinEjes > 0 ? plural(hipSinEjes, tr("hipótesis"), trc("plural", "hipótesis")) : ''].filter(Boolean).join(' y '), v2: sinEjes + hipSinEjes === 1 ? tr("lo") : tr("los"), v3: sinEjes + hipSinEjes === 1 ? tr("No está en la rejilla, pero cuenta") : tr("No están en la rejilla, pero cuentan") }) : trp("{v} no se pudieron situar en ningún eje: su texto no nombra fase, región ni tipo celular y la misión no {v2} fija. {v3} en el modelo de mundo.", { v: [sinEjes > 0 ? plural(sinEjes, tr("hecho")) : '', hipSinEjes > 0 ? plural(hipSinEjes, tr("hipótesis"), trc("plural", "hipótesis")) : ''].filter(Boolean).join(' y '), v2: sinEjes + hipSinEjes === 1 ? tr("lo") : tr("los"), v3: sinEjes + hipSinEjes === 1 ? tr("No está en la rejilla, pero cuenta") : tr("No están en la rejilla, pero cuentan") }))}
        </p>
      )}
      {huecos.length > 0 && (
        <div className="mapa-enf-huecos">
          <p className="campo-etiqueta" title={tr("Un hueco es una combinación de fase, región o tipo celular que la misión nombra y que ningún hecho ni hipótesis cubre por su propio contenido.")}>
            {trp("Huecos de la misión sin cubrir ({huecos})", { huecos: huecos.length })}</p>
          <ul className="lista-limpia">
            {huecos.slice(0, 20).map((h, i) => (
              <li key={i} className="mapa-enf-hueco">
                <span className="chip chip-aviso">{[h.estadio ? etiquetaEje(mapa, 'estadio', h.estadio) : '', h.region ? etiquetaEje(mapa, 'region', h.region) : '', h.tipoCelular ? etiquetaEje(mapa, 'tipoCelular', h.tipoCelular) : ''].filter(Boolean).join(' · ') || tr('sin ejes')}</span>
                <span className="meta">
                  {texto(h.motivo) || tr('La misión la nombra y ningún hecho ni hipótesis la cubre por su propio contenido.')}
                  {cuentaDe(h.heredanDeMision) ? trp(" {v} de la misión sin nombrarla.", { v: plural(cuentaDe(h.heredanDeMision), tr('registro la hereda'), tr('registros la heredan')) }) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SoloDetalle resumen={hayRejilla ? trp("La rejilla: {celdas} con evidencia en {filas} y {columnas}.", { celdas: plural(celdas.length, tr("celda")), filas: plural(filas.length, tr("fase")), columnas: plural(columnas.length, tr('región'), tr("regiones")) }) : tr('La rejilla estadio x región aparece cuando haya hechos o hipótesis situados.')}>
        {niveles.length > 0 && (
          <p className="meta mapa-enf-niveles">
            {tr("Nivel biológico al que habla la evidencia:")}{' '}
            {niveles.map(([n, v], i) => (
              <span key={n}>
                {i > 0 ? ' · ' : ''}
                <span className="termino-glosario" title={definicion(mapa, 'nivel', n) ?? n}>
                  {etiquetaEje(mapa, 'nivel', n)}
                </span>{' '}
                {v}
              </span>
            ))}
          </p>
        )}
        {hayRejilla ? (
          <div className="mapa-enf-tabla">
            <table className="tabla mapa-enf-rejilla">
              <thead>
                <tr>
                  <th title={tr("Fase de la enfermedad (estadio) en filas; región del cerebro o compartimento en columnas.")}>{tr("Fase \\ Región")}</th>
                  {columnas.map((r) => (
                    <th key={r || tr(SIN)} title={r ? trp("Región: {mapa}.", { mapa: etiquetaEje(mapa, 'region', r) }) : tr('Registros sin región identificada por su contenido ni por la misión.')}>
                      {etiquetaEje(mapa, 'region', r || null)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((e) => (
                  <tr key={e || tr(SIN)}>
                    <th scope="row" title={definicion(mapa, 'estadio', e || null)}>
                      {etiquetaEje(mapa, 'estadio', e || null)}
                    </th>
                    {columnas.map((r) => {
                      const fichas = enCelda(e, r);
                      const hs = huecosEn(e, r);
                      return (
                        <td key={r || tr(SIN)} className={`mapa-enf-celda ${hs.length > 0 ? 'mapa-enf-celda-hueco' : ''} ${fichas.length === 0 && hs.length === 0 ? 'mapa-enf-celda-vacia' : ''}`} title={hs.length > 0 ? hs.map((h) => texto(h.motivo)).filter(Boolean).join(' ') || undefined : undefined}>
                          {fichas.map((c, i) => (
                            <Ficha key={`${clave(c.tipoCelular)}-${i}`} celda={c} mapa={mapa} />
                          ))}
                          {hs.map((h, i) => (
                            <span key={`hueco-${i}`} className="mapa-enf-ficha-hueco" title={texto(h.motivo) || undefined}>{trp("hueco{v}", { v: h.tipoCelular ? `: ${etiquetaEje(mapa, 'tipoCelular', h.tipoCelular)}` : '' })}
                            </span>
                          ))}
                          {fichas.length === 0 && hs.length === 0 ? <span className="meta">·</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta">{tr("Todavía no hay hechos ni hipótesis situados: la rejilla aparece en cuanto ROSA2018 reúna evidencia con fase, región o tipo celular.")}</p>
        )}
      </SoloDetalle>
    </article>
  );
}
