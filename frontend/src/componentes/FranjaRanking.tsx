// La franja compacta que expone, por fila del ranking, cada componente que
// ROSA2018 calcula sobre una hipótesis sin sumarlos (informe de priorización de
// ROSA2018). Orden fijo para que la vista se lea en columnas: certeza GRADE
// con su techo, dirección de la evidencia, cohortes distintas, evidencia a
// favor, en contra y que socava, decisión del Killer, bloqueos, fuerza de
// Bradley-Terry con su intervalo y los partidos, novedad, paso de la ruta
// terapéutica, conflictos, pendiente de revisar y fusión. Cada chip lleva en
// su `title` la definición del término en una frase, porque quien lee el
// ranking es ingeniero de IA, no médico. Todo el texto en castellano con sus
// tildes; los identificadores sin acento.
//
// Solo lee: la lógica vive en lib/ranking.ts (componentesDe) y ahí se prueba.
// Toda búsqueda en una tabla de etiquetas pasa por `de()`, que solo mira las
// claves propias: un valor raro como "constructor" cae en la etiqueta de
// repuesto en vez de sacar una función del prototipo y tumbar la fila.

import type { CertezaEvidencia, DecisionKiller, DireccionEvidencia, Hipotesis, PasoRutaTerapeutica } from '../datos/tipos';
import { BLOQUEO, CERTEZA_EVIDENCIA, DECISION_KILLER, DIRECCION_EVIDENCIA, PASO_RUTA } from '../lib/etiquetas';
import { formatearEntero, plural } from '../lib/formato';
import { EXPLICACION_BLOQUEO } from '../lib/priorizacion';
import { componentesDe, queCambiariaElOrden, type ComponentesRanking, type EstadoNovedad, type EstadoParaRanking } from '../lib/ranking';
import { Chip } from './piezas';
import { traducido, tr, trp } from '../lib/idioma';

type Tono = 'ok' | 'aviso' | 'mal' | 'acento' | 'borde' | 'neutro';

/** Una entrada de una tabla de etiquetas por su clave propia, o undefined. */
function de<T>(tabla: Record<string, T>, clave: unknown): T | undefined {
  return typeof clave === 'string' && Object.hasOwn(tabla, clave) ? tabla[clave] : undefined;
}

function legible(x: unknown): string {
  return String(x).replace(/_/g, ' ');
}

const NOVEDAD: Record<EstadoNovedad, { etiqueta: string; tono: Tono; nota: string }> = traducido({
  no_comprobado: { etiqueta: 'Novedad sin comprobar', tono: 'borde', nota: 'La búsqueda de precedentes no se hizo o la fuente no respondió. No comprobado no es lo mismo que nuevo.' },
  nueva: { etiqueta: 'Sin precedente', tono: 'ok', nota: 'Nadie la propuso antes en la literatura buscada (comprobación de precedente, tipo Owl).' },
  parcial: { etiqueta: 'Precedente parcial', tono: 'aviso', nota: 'Hay trabajos parecidos, pero ninguno con esta formulación, población o desenlace.' },
  precedente: { etiqueta: 'Ya publicada', tono: 'mal', nota: 'Alguien ya la publicó: como idea no es nueva, aunque siga siendo útil comprobarla aquí.' },
});

const DEFINICIONES = traducido({
  certeza: 'Certeza GRADE: cuánto se puede confiar en la evidencia reunida (alta, moderada, baja, muy baja). Es independiente de la dirección: dice cuánto se sabe, no si la hipótesis es cierta.',
  techo: 'Techo por regla: el nivel máximo que permite lo que hay contado (cohortes distintas, evidencia directa no sintética, peso de los apoyos). El juez explica dentro de esa caja, no la fija.',
  direccion: 'Dirección de la evidencia: hacia dónde apunta lo reunido (apoya, mixta, en contra, sin evidencia directa). Va separada de la certeza.',
  cohortes: 'Cohortes distintas: grupos de personas o muestras de los que salen los datos. Dos artículos de la misma cohorte son una sola evidencia, no dos; para pasar de muy baja a baja hacen falta dos.',
  aFavor: 'Afirmaciones sostenidas por su fuente que apoyan la hipótesis (de origen, directas o indirectas) y que nadie socava.',
  enContra: 'Afirmaciones sostenidas por su fuente que contradicen la hipótesis.',
  socavan: 'Afirmaciones que atacan el método o la inferencia de un apoyo; ese apoyo deja de contar mientras esté socavado.',
  killer: 'Hypothesis Killer: el revisor que somete cada hipótesis a comprobaciones fijas (citas reales, fidelidad a la fuente, supuestos, falsabilidad, novedad...) y decide por regla si avanza, se reformula, se suspende o se descarta.',
  bt: 'Fuerza de Bradley-Terry: otra forma de ordenar por los partidos del torneo, en escala Elo, con un intervalo del 95 % por bootstrap. El intervalo dice cuánta seguridad hay en el orden, no solo el orden. Es lo que ordena a las candidatas.',
  partidos: 'Partidos del torneo: debates de dos en dos contra hipótesis rivales, juzgados por un modelo. Con menos de 3 el Elo y la fuerza dicen poco.',
  pasoRuta: 'Paso de la ruta terapéutica en el que está la hipótesis (mecanismo, opciones de intervención, compromiso de diana, efecto funcional, selectividad, exposición, replicación, evidencia en la población). Una campaña celular completada no completa la ruta.',
  conflicto: 'Conflicto: dos hipótesis que no pueden ser ciertas a la vez (marco de argumentación). ROSA2018 lo marca; no descarta ninguna. Si las dos van al laboratorio, una sobra o hay que diseñar el experimento que las separe.',
  pendiente: 'Pendiente de revisar: algo de lo que depende cambió (una fuente se retractó, un hecho fue sustituido o contradicho) y nadie la volvió a concluir.',
  fusionada: 'Fusionada: el torneo la encontró equivalente a otra o un caso particular de ella; su evidencia vive en la otra. No fue refutada.',
  absorbe: 'Absorbió por fusión: heredó las afirmaciones y fuentes de otra hipótesis redundante con esta.',
  candidata: 'Candidata al laboratorio: sin bloqueos, el Killer la dejó avanzar y está entre las mejores con diversidad de cluster.',
  sinBloqueos: 'Sin bloqueos no compensables: ninguno de los motivos que sacan a una hipótesis de las candidatas puntúe lo que puntúe en lo demás.',
  bloqueosServidor: 'Bloqueos tal como los guardó el servidor: la regla de la interfaz no pudo evaluar este registro (trae un valor que esta versión no conoce).',
  bloqueosSinComprobar: 'Bloqueos sin comprobar: la regla de la interfaz no pudo evaluar este registro y el servidor no guardó sus bloqueos. No se puede afirmar que no tenga; no comprobado no es lo mismo que sin bloqueos.',
});

function etiquetaCerteza(nivel: CertezaEvidencia): { etiqueta: string; tono: Tono } {
  return de(CERTEZA_EVIDENCIA as Record<string, { etiqueta: string; tono: Tono }>, nivel) ?? { etiqueta: `Certeza ${legible(nivel)}`, tono: 'borde' };
}

function etiquetaDireccion(d: DireccionEvidencia): { etiqueta: string; tono: Tono } {
  return de(DIRECCION_EVIDENCIA as Record<string, { etiqueta: string; tono: Tono }>, d) ?? { etiqueta: trp("Dirección: {d}", { d: legible(d) }), tono: 'borde' };
}

function etiquetaKiller(k: DecisionKiller): { etiqueta: string; tono: Tono; nota: string } {
  return de(DECISION_KILLER as Record<string, { etiqueta: string; tono: Tono; nota: string }>, k) ?? { etiqueta: legible(k), tono: 'borde', nota: tr('Decisión del Killer que esta versión de la interfaz no conoce.') };
}

function etiquetaPaso(p: PasoRutaTerapeutica): string {
  const e = de(PASO_RUTA as Record<string, { etiqueta: string; orden: number }>, p);
  return e ? `Ruta ${e.orden}/8: ${e.etiqueta}` : `Ruta: ${legible(p)}`;
}

/** La ruta evaluada por regla: cuántos pasos de ocho cubre la evidencia y cuál toca. */
function etiquetaRuta(r: NonNullable<ComponentesRanking['ruta']>): string {
  if (!r.siguiente) return `Ruta ${r.cubiertos}/8: completa`;
  const e = de(PASO_RUTA as Record<string, { etiqueta: string; orden: number }>, r.siguiente);
  return `Ruta ${r.cubiertos}/8, toca ${e ? e.etiqueta.toLowerCase() : legible(r.siguiente)}`;
}

function ChipCerteza({ c }: { c: ComponentesRanking }) {
  if (!c.certeza) {
    return (
      <Chip tono="borde" title={trp("{certeza} ROSA2018 todavía no ha escrito una conclusión: la escribe al cerrar cada iteración.", { certeza: DEFINICIONES.certeza })}>
        {tr("Sin conclusión todavía")}
      </Chip>
    );
  }
  const e = etiquetaCerteza(c.certeza.nivel);
  const t = c.certeza.techo;
  const partesTitulo = [DEFINICIONES.certeza];
  if (t) partesTitulo.push(`${DEFINICIONES.techo} Techo: ${t.etiqueta.toLowerCase()}${t.acotada ? tr(' (acotada: el juez había dicho más)') : ''}${t.motivo ? `. Motivo: ${t.motivo}` : ''}.`);
  return (
    <Chip tono={e.tono} title={partesTitulo.join(' ')}>
      {e.etiqueta}
      {t && t.acotada && ` · techo ${t.etiqueta.toLowerCase().replace(/^certeza /, '')}`}
    </Chip>
  );
}

/** El hueco de los bloqueos según de dónde salieron: por regla o del servidor
 *  se pintan uno a uno (o "Candidata" / "Sin bloqueos" si no hay); si no se
 *  pudieron comprobar, se dice eso, nunca "sin bloqueos". */
function Bloqueos({ c }: { c: ComponentesRanking }) {
  if (c.bloqueosOrigen === 'no_comprobado') {
    return (
      <Chip tono="borde" title={DEFINICIONES.bloqueosSinComprobar}>
        {tr("Bloqueos sin comprobar")}
      </Chip>
    );
  }
  if (c.bloqueos.length === 0) {
    const nota = c.bloqueosOrigen === 'servidor' ? ` ${DEFINICIONES.bloqueosServidor}` : '';
    return c.candidata ? (
      <Chip tono="ok" title={`${DEFINICIONES.candidata}${nota}`}>
        {tr("Candidata al laboratorio")}
      </Chip>
    ) : (
      <Chip tono="borde" title={`${DEFINICIONES.sinBloqueos}${nota}`}>
        {tr("Sin bloqueos")}
      </Chip>
    );
  }
  return (
    <span className="acciones" style={{ gap: 4 }} title={c.bloqueosOrigen === 'servidor' ? DEFINICIONES.bloqueosServidor : undefined}>
      {c.bloqueos.map((b) => (
        <Chip key={b} tono="mal" title={de(EXPLICACION_BLOQUEO as Record<string, string>, b) ?? tr('Bloqueo no compensable que esta versión de la interfaz no conoce.')}>
          {de(BLOQUEO as Record<string, string>, b) ?? legible(b)}
        </Chip>
      ))}
    </span>
  );
}

/** La franja: un chip por componente, en orden fijo. `estado` puede ser
 *  parcial (solo hace falta la lista de hipótesis para resolver títulos y lo
 *  que la regla de bloqueos lee). Con `explicar`, añade debajo la frase en
 *  llano de qué movería a la hipótesis. */
/** `compacto`: en la tabla del ranking solo se enseña lo que ordena y lo que
 *  cambia entre filas. Las quince piezas de la franja completa, repetidas en
 *  cada fila, eran tres líneas de ruido con la mitad de los valores idénticos
 *  (Emir, 28 de septiembre de 2026). La franja entera sigue en la ficha. */
export function FranjaRanking({ estado, h, explicar = false, compacto = false }: { estado: EstadoParaRanking; h: Hipotesis; explicar?: boolean; compacto?: boolean }) {
  const c = componentesDe(estado, h);
  const pocos = c.partidos < 3;
  const n = c.cohortesDistintas.length;
  const novedad = NOVEDAD[c.novedad.estado];
  return (
    <div>
      <div className="hip-meta" role="group" aria-label={tr("Componentes del ranking, sin sumar")}>
        <ChipCerteza c={c} />
        {!compacto && c.direccion && (
          <Chip tono={etiquetaDireccion(c.direccion).tono} title={DEFINICIONES.direccion}>
            {etiquetaDireccion(c.direccion).etiqueta}
          </Chip>
        )}
        <Chip tono={n >= 2 ? 'ok' : 'borde'} title={`${DEFINICIONES.cohortes}${n > 0 ? trp(" Aquí: {v}.", { v: c.cohortesDistintas.join('; ') }) : tr(' Aquí ninguna fuente nombra su cohorte: no se puede afirmar que sean independientes.')}`}>
          {n === 0 ? tr('Sin cohorte identificada') : plural(n, tr('cohorte distinta'), tr('cohortes distintas'))}
        </Chip>
        <Chip tono={c.aFavor > 0 ? 'ok' : 'borde'} title={DEFINICIONES.aFavor}>
          {trp("{aFavor} a favor", { aFavor: formatearEntero(c.aFavor) })}</Chip>
        <Chip tono={c.enContra > 0 ? 'mal' : 'borde'} title={DEFINICIONES.enContra}>
          {trp("{enContra} en contra", { enContra: formatearEntero(c.enContra) })}</Chip>
        {!compacto && <Chip tono={c.socavan > 0 ? 'aviso' : 'borde'} title={`${DEFINICIONES.socavan}${c.socavadas > 0 ? ` Hoy ${plural(c.socavadas, tr('apoyo socavado no cuenta'), tr('apoyos socavados no cuentan'))}.` : ''}`}>
          {c.socavan === 1 ? tr('1 socava') : `${formatearEntero(c.socavan)} socavan`}
        </Chip>}
        {!compacto && c.razonesEnContra > 0 && (
          <Chip tono="aviso" title={tr("Razones en contra que el juez enumera en la conclusión: no son afirmaciones verificadas (esas son las de 'en contra' y 'socavan'), sino ataques al paso inferencial o cosas que faltan. Se cuentan aparte para que '0 en contra' no se lea como 'sin objeciones'.")}>
            {c.razonesEnContra === 1 ? tr('1 razón en contra (juez)') : `${formatearEntero(c.razonesEnContra)} razones en contra (juez)`}
          </Chip>
        )}
        {c.killer ? (
          <Chip tono={etiquetaKiller(c.killer).tono} title={`${DEFINICIONES.killer} ${c.killerMotivo ? `Motivo: ${c.killerMotivo}` : etiquetaKiller(c.killer).nota}`}>{trp("Killer: {etiqueta}", { etiqueta: etiquetaKiller(c.killer).etiqueta })}
          </Chip>
        ) : (
          <Chip tono="borde" title={trp("{killer} Todavía no la juzgó.", { killer: DEFINICIONES.killer })}>
            {tr("Killer: sin juzgar")}
          </Chip>
        )}
        <Bloqueos c={c} />
        {compacto ? null : c.bt ? (
          <Chip title={DEFINICIONES.bt}>
            BT {formatearEntero(c.bt.fuerza)} ({formatearEntero(c.bt.ic95[0])} a {formatearEntero(c.bt.ic95[1])})
          </Chip>
        ) : (
          <Chip tono="borde" title={trp("{bt} Todavía no se calculó: hacen falta partidos.", { bt: DEFINICIONES.bt })}>
            {tr("Sin BT")}
          </Chip>
        )}
        <Chip tono={pocos ? 'aviso' : 'neutro'} title={DEFINICIONES.partidos}>
          {plural(c.partidos, tr("partido"))}
        </Chip>
        {!compacto && <Chip tono={novedad.tono} title={`${novedad.nota}${c.novedad.detalle ? ` Detalle: ${c.novedad.detalle}` : ''}`}>
          {novedad.etiqueta}
        </Chip>}
        {c.ruta ? (
          <Chip tono={c.ruta.coherente ? 'acento' : 'aviso'} title={(c.ruta.coherente ? tr("Ruta terapéutica evaluada por regla sobre la evidencia que tiene: pasos cubiertos de ocho y el primero que falta. El paso que declara la tarjeta es coherente con lo cubierto.") : tr("Ruta terapéutica evaluada por regla sobre la evidencia que tiene: pasos cubiertos de ocho y el primero que falta. El paso que declara la tarjeta va por delante de lo que la evidencia cubre."))}>
            {etiquetaRuta(c.ruta)}
          </Chip>
        ) : c.pasoRuta ? (
          <Chip tono="acento" title={DEFINICIONES.pasoRuta}>
            {etiquetaPaso(c.pasoRuta)}
          </Chip>
        ) : null}
        {c.conflictoCon.length > 0 && (
          <Chip tono="aviso" title={trp("{conflicto} Con: {v}.", { conflicto: DEFINICIONES.conflicto, v: c.conflictoCon.map((x) => x.titulo).join('; ') })}>{trp("Se contradice con {v}", { v: c.conflictoCon.length === 1 ? 'otra' : formatearEntero(c.conflictoCon.length) })}
          </Chip>
        )}
        {c.pendiente && (
          <Chip tono="aviso" title={`${DEFINICIONES.pendiente}${c.pendienteDetalle ? ` ${c.pendienteDetalle}` : ''}`}>
            {tr("Pendiente de revisar")}
          </Chip>
        )}
        {c.fusion === 'fusionada' && (
          <Chip tono="borde" title={`${DEFINICIONES.fusionada} En: ${c.fusionCon.map((x) => x.titulo).join('; ')}.`}>
            {tr("Fusionada en otra")}
          </Chip>
        )}
        {c.fusion === 'absorbe' && (
          <Chip tono="acento" title={trp("{absorbe} Absorbió: {v}.", { absorbe: DEFINICIONES.absorbe, v: c.fusionCon.map((x) => x.titulo).join('; ') })}>
            {trp("Absorbió {v}", { v: c.fusionCon.length === 1 ? 'otra' : formatearEntero(c.fusionCon.length) })}
          </Chip>
        )}
      </div>
      {/* Qué le falta para subir. Es una sola frase generada, pero puede pasar
          de doce líneas y dominaba la ficha entera por encima de la hipótesis
          (Emir, 28 de septiembre de 2026). Va plegada, con su rótulo. */}
      {explicar && (
        <details className="franja-explica">
          <summary>{tr("Qué le falta para subir y qué cambiaría su orden")}</summary>
          <p>{queCambiariaElOrden(h)}</p>
        </details>
      )}
    </div>
  );
}
