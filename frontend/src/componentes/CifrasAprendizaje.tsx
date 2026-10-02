// Las tres cifras con las que el programa mide si ROSA2018 aprende (plan
// completo, etapa G; rosa/cifras_aprendizaje.py): cuántas predicciones
// prerregistradas acertaron, cuánto tarda cada hipótesis en recibir una
// decisión y cuántos hechos heredados de otra investigación se usaron de
// verdad. Primero el texto en llano que escribe el servidor por regla; debajo,
// cada cifra con su regla de cálculo y su detalle plegados. Una tasa que no se
// puede calcular se dice así ("todavía no se puede medir"), nunca como 0 %.

import type { ReactNode } from 'react';
import type { AgregadoAcierto, CasoPrerregistrado, CifrasAprendizaje as Cifras, ReutilizacionHeredada, TiempoHastaDecision } from '../datos/tipos';
import { CERTEZA_EVIDENCIA } from '../lib/etiquetas';
import { coma, formatearEntero, formatearPorcentaje, plural } from '../lib/formato';
import { traducido, tr, trp, trc } from '../lib/idioma';

/** Glosario de reserva, copiado de rosa/cifras_aprendizaje.py GLOSARIO; el
 *  que llega con las cifras manda, este cubre un registro que no lo traiga. */
export const GLOSARIO_CIFRAS: Record<string, string> = traducido({
  prerregistro: 'lo que ROSA2018 deja por escrito antes de mirar los datos: qué espera ver y qué hará según salga',
  acierto: "el resultado cayó del lado que el prerregistro llamó 'confirma'",
  decision: 'cada juicio registrado sobre una hipótesis: del Killer (killer_1, killer_2), de la priorización, de una persona o del retorno del laboratorio',
  mediana: 'el valor del medio: la mitad de los casos queda por debajo',
  p90: 'el valor por debajo del cual queda el 90 % de los casos',
  hecho_heredado: 'un hecho del modelo de mundo copiado de otra investigación al crear esta',
});

/** Qué palabras del texto llevan cada término del glosario (la clave del
 *  glosario va sin tilde porque se compara con el servidor). */
const PATRONES_TERMINO: [string, RegExp][] = [
  ['prerregistro', /\bprerregistr\w*/i],
  ['acierto', /\baciert\w*/i],
  ['decision', /\bdecisi(?:ón|on|ones)\b/i],
  ['mediana', /\bmediana\b/i],
  ['p90', /\bp90\b|90 % de los casos/i],
  ['hecho_heredado', /\bhechos? heredad\w*/i],
];

const ETAPA: Record<string, string> = traducido({
  killer_1: 'Killer 1 (antes de gastar)',
  killer_2: 'Killer 2 (auditoría del análisis)',
  priorizacion: 'priorización',
  persona: 'persona',
  retorno: 'retorno del laboratorio',
});

const CLASE_CASO: Record<CasoPrerregistrado['clase'], { etiqueta: string; tono: 'ok' | 'mal' | 'borde' | 'aviso' }> = traducido({
  acierto: { etiqueta: 'Acierto', tono: 'ok' },
  fallo: { etiqueta: 'Fallo', tono: 'mal' },
  sin_direccion: { etiqueta: 'Sin dirección', tono: 'borde' },
  no_evaluable: { etiqueta: 'No evaluable', tono: 'aviso' },
});

/** Envuelve la primera aparición de cada término del glosario en un span con
 *  la definición como tooltip. Cada término se explica una vez por texto. */
export function conGlosario(texto: string, glosario: Record<string, string>): ReactNode[] {
  const salida: ReactNode[] = [];
  const vistos = new Set<string>();
  let resto = texto;
  let clave = 0;
  for (;;) {
    let mejor: { termino: string; indice: number; largo: number } | null = null;
    for (const [termino, patron] of PATRONES_TERMINO) {
      if (vistos.has(termino) || !glosario[termino]) continue;
      const m = patron.exec(resto);
      if (m && (mejor === null || m.index < mejor.indice)) mejor = { termino, indice: m.index, largo: m[0].length };
    }
    if (mejor === null) break;
    if (mejor.indice > 0) salida.push(resto.slice(0, mejor.indice));
    salida.push(
      <span key={clave++} className="termino-glosario" title={glosario[mejor.termino]}>
        {resto.slice(mejor.indice, mejor.indice + mejor.largo)}
      </span>,
    );
    vistos.add(mejor.termino);
    resto = resto.slice(mejor.indice + mejor.largo);
  }
  if (resto) salida.push(resto);
  return salida;
}

/** Un objeto de verdad (no null, no lista): lo que el servidor manda por cifra. */
const objeto = <T,>(x: T | null | undefined): x is T => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
/** Un recuento: número finito y no negativo; lo demás (undefined en un registro antiguo, texto) cuenta como 0. */
const cuenta = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
/** Texto seguro para pintar: nunca "[object Object]" ni "undefined". */
const texto = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');

/** La frase hace de centinela Y se lee en pantalla: se compara con
 *  `sinMedir()`, no con la cadena suelta, para que traducirla no rompa la
 *  comparacion. */
export const sinMedir = (): string => tr('todavía no se puede medir');
export const noAplica = (): string => tr('no aplica');

/** "todavía no se puede medir" cuando la tasa es null; nunca 0 %. */
export function textoTasa(tasa: number | null | undefined): string {
  return typeof tasa === 'number' && Number.isFinite(tasa) ? formatearPorcentaje(tasa) : sinMedir();
}

/** Horas en llano: menos de un día en horas, después en días con una decimal. */
export function textoHoras(horas: number | null | undefined): string {
  if (typeof horas !== 'number' || !Number.isFinite(horas) || horas < 0) return sinMedir();
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${coma((Math.round(horas * 10) / 10).toString())} h`;
  return trp("{v} días", { v: coma((Math.round(horas / 2.4) / 10).toString()) });
}

function Cifra({ titulo, definicion, valor, nota, regla, detalle, hayDetalle }: { titulo: string; definicion: string; valor: string; nota: string; regla: string; detalle: ReactNode; hayDetalle: boolean }) {
  const medible = valor !== sinMedir() && valor !== noAplica();
  return (
    <article className={`cifra-ap ${medible ? '' : 'cifra-ap-vacia'}`}>
      <h4 className="cifra-ap-titulo" title={definicion}>
        {titulo}
      </h4>
      <p className="cifra-ap-valor">{valor}</p>
      <p className="meta">{nota}</p>
      <details className="cifra-ap-detalle">
        <summary>{(hayDetalle ? tr("Cómo se calcula y el detalle") : tr("Cómo se calcula"))}</summary>
        <p className="meta cifra-ap-regla">{regla}</p>
        {hayDetalle ? detalle : <p className="meta">{tr("Sin casos que detallar todavía.")}</p>}
      </details>
    </article>
  );
}

function notaAcierto(a: AgregadoAcierto): string {
  if (!cuenta(a.casos)) return tr('Ninguna predicción prerregistrada con resultado todavía.');
  const partes = [trp("{v} de {v2}", { v: plural(cuenta(a.aciertos), tr("acierto")), v2: plural(cuenta(a.conDireccion), tr('predicción con dirección'), tr('predicciones con dirección')) })];
  if (cuenta(a.sinDireccion)) partes.push(trp("{sinDireccion} sin dirección declarada (no entran en la tasa)", { sinDireccion: cuenta(a.sinDireccion) }));
  if (cuenta(a.noEvaluables)) partes.push(trp("{noEvaluables} no evaluables", { noEvaluables: cuenta(a.noEvaluables) }));
  return `${partes.join('; ')}.`;
}

function notaTiempo(t: TiempoHastaDecision): string {
  const abiertas = cuenta(t.abiertasSinDecision);
  if (!cuenta(t.casos)) return abiertas ? trp("{abiertas} sin ninguna decisión todavía ({abiertasSinDecisionHoras} esperando).", { abiertas: plural(abiertas, tr('hipótesis viva'), tr('hipótesis vivas')), abiertasSinDecisionHoras: textoHoras(t.abiertasSinDecisionHoras) }) : tr('Ninguna hipótesis tiene todavía una decisión registrada.');
  const partes = [`p90 ${textoHoras(t.p90Horas)}`, trp("{v} sobre {v2}", { v: plural(cuenta(t.casos), tr('decisión'), tr("decisiones")), v2: plural(cuenta(t.hipotesis), tr("hipótesis"), trc("plural", "hipótesis")) })];
  if (abiertas) partes.push(trp("{abiertas} vivas sin decidir", { abiertas }));
  return `${partes.join(' · ')}.`;
}

function notaReutilizacion(r: ReutilizacionHeredada): string {
  const heredados = cuenta(r.hechosHeredados);
  if (!heredados) return tr('Esta investigación no heredó hechos de otra.');
  return trp("{v} de {heredados}; {v2} de {hipotesisVivas} se apoyan en alguno.", { v: plural(cuenta(r.usados), tr('hecho heredado usado'), tr('hechos heredados usados')), heredados: formatearEntero(heredados), v2: plural(cuenta(r.hipotesisConHerencia), tr('hipótesis viva'), tr('hipótesis vivas')), hipotesisVivas: cuenta(r.hipotesisVivas) });
}

/** La tarjeta "Aprendizaje" de la vista de programa. `cifras` en null o
 *  undefined (registro antiguo, datos de muestra, primera iteración sin
 *  cerrar) pinta el aviso de cuándo se calcula. */
export function CifrasAprendizaje({ cifras }: { cifras: Cifras | null | undefined }) {
  if (!cifras || typeof cifras !== 'object') {
    return (
      <article className="tarjeta cifras-ap" aria-label={tr("Aprendizaje")}>
        <h3 className="cifras-ap-cabecera">{tr("Aprendizaje")}</h3>
        <p className="meta">{tr("Se calcula al cerrar la primera iteración: acierto de las predicciones prerregistradas, tiempo hasta cada decisión y reutilización de lo heredado.")}</p>
      </article>
    );
  }
  // El glosario del servidor manda, pero solo sus entradas que son texto: un
  // valor de otro tipo acabaría como "[object Object]" en un tooltip.
  const glosario: Record<string, string> = { ...GLOSARIO_CIFRAS };
  if (objeto(cifras.glosario)) for (const [k, v] of Object.entries(cifras.glosario)) if (typeof v === 'string' && v) glosario[k] = v;
  const frases = (typeof cifras.texto === 'string' ? cifras.texto : '')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  // Cada cifra tiene que ser un objeto; un registro antiguo o roto (texto,
  // número, lista) se trata como ausente y su ficha no se pinta.
  const a = objeto(cifras.acierto) ? cifras.acierto : null;
  const t = objeto(cifras.tiempo) ? cifras.tiempo : null;
  const r = objeto(cifras.reutilizacion) ? cifras.reutilizacion : null;
  const detalleAcierto = Array.isArray(a?.detalle) ? a.detalle.filter(objeto) : [];
  const detalleTiempo = Array.isArray(t?.detalle) ? t.detalle.filter(objeto) : [];
  const detalleReut = Array.isArray(r?.detalle) ? r.detalle.filter(objeto) : [];
  const porEtapa = t && objeto(t.porEtapa) ? Object.entries(t.porEtapa) : [];
  const porNivel = a && objeto(a.porNivel) ? Object.entries(a.porNivel) : [];
  return (
    <article className="tarjeta cifras-ap" aria-label={tr("Aprendizaje")}>
      <div className="cifras-ap-cabecera">
        <h3>{tr("Aprendizaje")}</h3>
        <span className="meta">{cuenta(cifras.iteracion) ? trp("Calculado al cerrar la iteración {iteracion}.", { iteracion: cuenta(cifras.iteracion) }) : tr('Calculado a demanda.')}</span>
      </div>
      {frases.length > 0 ? (
        <div className="cifras-ap-texto">
          {frases.map((f, i) => (
            <p key={i}>{conGlosario(f, glosario)}</p>
          ))}
        </div>
      ) : (
        <p className="meta">{tr("El servidor no escribió el texto en llano de estas cifras; abajo están los números.")}</p>
      )}
      <div className="cifras-ap-rejilla">
        {a && (
          <Cifra
            titulo={tr("Acierto prerregistrado")}
            definicion={`Acierto: ${glosario.acierto}. Prerregistro: ${glosario.prerregistro}.`}
            valor={textoTasa(a.tasa)}
            nota={notaAcierto(a)}
            regla={texto(a.regla)}
            hayDetalle={detalleAcierto.length > 0 || porNivel.length > 0}
            detalle={
              <>
                {objeto(a.porFuente) && (
                  <p className="meta">
                    {trp("Por fuente: análisis in silico {tasa} ({casos} casos); laboratorio {tasa2} ({casos2} casos).", { tasa: textoTasa(a.porFuente.analisis?.tasa), casos: cuenta(a.porFuente.analisis?.casos), tasa2: textoTasa(a.porFuente.laboratorio?.tasa), casos2: cuenta(a.porFuente.laboratorio?.casos) })}</p>
                )}
                {porNivel.length > 0 && (
                  <p className="meta">
                    {trp("Por certeza GRADE de la hipótesis: {v}.", { v: porNivel.map(([nivel, v]) => trp("{v} {aciertos} de {casos}", { v: CERTEZA_EVIDENCIA[nivel as keyof typeof CERTEZA_EVIDENCIA]?.etiqueta.toLowerCase() ?? nivel, aciertos: cuenta(v?.aciertos), casos: cuenta(v?.casos) })).join('; ') })}</p>
                )}
                {objeto(a.excluidos) && (
                  <p className="meta">{trp("Excluidos: {planesSinCongelar} planes sin congelar, {planesSinEjecucionValida} sin ejecución válida, {planesReproduccion} de reproducción, {laboratorioSinPrerregistro} experimentos sin prerregistro.", { planesSinCongelar: cuenta(a.excluidos.planesSinCongelar), planesSinEjecucionValida: cuenta(a.excluidos.planesSinEjecucionValida), planesReproduccion: cuenta(a.excluidos.planesReproduccion), laboratorioSinPrerregistro: cuenta(a.excluidos.laboratorioSinPrerregistro) })}
                  </p>
                )}
                {detalleAcierto.length > 0 && (
                  <ul className="lista-limpia cifra-ap-casos">
                    {detalleAcierto.slice(0, 30).map((c, i) => (
                      <li key={`${texto(c.planId) || texto(c.ejecucionId) || texto(c.hipotesisId) || i}-${i}`}>
                        <span className={`chip chip-${CLASE_CASO[c.clase]?.tono ?? 'borde'}`}>{CLASE_CASO[c.clase]?.etiqueta ?? (texto(c.clase) || tr('sin clase'))}</span>
                        <span>
                          {(c.fuente === 'laboratorio' ? trp("Laboratorio{v}{v2}{v3}", { v: texto(c.hipotesisId) ? ` · ${texto(c.hipotesisId)}` : '', v2: texto(c.direccionEsperada) ? ` · esperaba: ${texto(c.direccionEsperada)}` : '', v3: texto(c.resultado) ? trp(" · salió: {resultado}", { resultado: texto(c.resultado) }) : '' }) : trp("Análisis{v}{v2}{v3}", { v: texto(c.hipotesisId) ? ` · ${texto(c.hipotesisId)}` : '', v2: texto(c.direccionEsperada) ? ` · esperaba: ${texto(c.direccionEsperada)}` : '', v3: texto(c.resultado) ? trp(" · salió: {resultado}", { resultado: texto(c.resultado) }) : '' }))}
                        </span>
                        <span className="meta">{texto(c.motivo)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            }
          />
        )}
        {t && (
          <Cifra
            titulo={tr("Tiempo hasta decidir")}
            definicion={trp('Decisión: {d}. Mediana: {m}. p90: {p}.', { d: glosario.decision ?? '', m: glosario.mediana ?? '', p: glosario.p90 ?? '' })}
            valor={textoHoras(t.medianaHoras) === sinMedir() ? sinMedir() : trp("{medianaHoras} de mediana", { medianaHoras: textoHoras(t.medianaHoras) })}
            nota={notaTiempo(t)}
            regla={texto(t.regla)}
            hayDetalle={detalleTiempo.length > 0 || porEtapa.length > 0}
            detalle={
              <>
                {porEtapa.length > 0 && (
                  <ul className="lista-limpia">
                    {porEtapa.map(([etapa, v]) => (
                      <li key={etapa}>
                        <span>{ETAPA[etapa] ?? etapa}</span>
                        <span className="meta">
                          {trp("{v} · mediana {medianaHoras}", { v: plural(cuenta(v?.casos), tr('decisión'), tr("decisiones")), medianaHoras: textoHoras(v?.medianaHoras) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {(cuenta(t.sinFechaCreacion) || cuenta(t.decisionesSinFecha) || cuenta(t.fechasInvertidas)) ? (
                  <p className="meta">
                    {trp("Registros que no se pudieron medir: {sinFechaCreacion} hipótesis sin fecha de creación, {decisionesSinFecha} decisiones sin fecha, {fechasInvertidas} decisiones anteriores a la creación (cuentan como 0 horas).", { sinFechaCreacion: cuenta(t.sinFechaCreacion), decisionesSinFecha: cuenta(t.decisionesSinFecha), fechasInvertidas: cuenta(t.fechasInvertidas) })}
                  </p>
                ) : null}
              </>
            }
          />
        )}
        {r && (
          <Cifra
            titulo={tr("Reutilización de lo heredado")}
            definicion={`Hecho heredado: ${glosario.hecho_heredado}.`}
            valor={!cuenta(r.hechosHeredados) ? noAplica() : textoTasa(r.tasa)}
            nota={notaReutilizacion(r)}
            regla={texto(r.regla)}
            hayDetalle={detalleReut.length > 0}
            detalle={
              <ul className="lista-limpia cifra-ap-casos">
                {detalleReut.slice(0, 30).map((d, i) => (
                  <li key={`${texto(d.hechoId) || i}-${i}`}>
                    <span className={`chip ${Array.isArray(d.usadoPor) && d.usadoPor.length > 0 ? 'chip-ok' : 'chip-borde'}`}>{(Array.isArray(d.usadoPor) && d.usadoPor.length > 0 ? tr("Usado") : tr("Sin usar"))}</span>
                    <span>{texto(d.tema) || texto(d.hechoId) || tr('hecho sin tema')}</span>
                    <span className="meta">{texto(d.motivo)}</span>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>
    </article>
  );
}
