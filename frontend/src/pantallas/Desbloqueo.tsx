// Qué desbloquea más: candados y llaves.
//
// Es la cuarta pantalla de estructura, junto al Atlas (dónde, en el cuerpo),
// el Árbol (de dónde, el linaje) y Mecanismos (por qué, la cadena causal).
// Contesta la pregunta de quien dirige el laboratorio: qué dato conseguir
// primero para que avancen más hipótesis.
//
// Una sola imagen. Cada hipótesis viva es un candado, con una muesca por cada
// dato que le falta para poder comprobar sus supuestos. Cada dato es una llave,
// y las llaves van en fila en el mejor orden (el plan de lib/desbloqueo.ts). Se
// elige hasta qué llave se llega y se ve qué candados se abren: abierto quiere
// decir que todo lo que le falta a esa hipótesis sería comprobable. Pasando por
// una llave se ve a quién llega ella sola; pasando por un candado, lo que le
// falta; pinchándolo, sus supuestos con la frase que decidió cada uno.
//
// La primera versión (23 de septiembre de 2026) tenía cuatro zonas, dos
// párrafos de explicación, hilos, cuadritos de cinco colores y una gráfica de
// escalones, y Emir la paró: "a cualquiera le hartaría ver eso". La lógica es
// la misma (tablero, plan y vigencia, medidas y probadas); cambió cómo se ve.
//
// Lo que nunca se abre pidiendo datos se ve distinto, para que nadie crea que
// solo faltan más llaves: con una interrogación, lo que pide biología que nadie
// ha medido; con una grieta, lo que ya tiene evidencia en contra; con una
// muesca punteada, lo que tiene un supuesto que ninguna regla sabe clasificar.
//
// No hay endpoint nuevo: los supuestos de cada ficha ya viajan en el estado, y
// la clasificación es una regla en el navegador.

import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { ingrediente as ingredienteDe, LO_QUE_FALTABA, plan, tablero, vigenciaEnLlano, type FilaHipotesis, type IdIngrediente, type SupuestoFlojo } from '../lib/desbloqueo';
import { ESTADO_HIPOTESIS } from '../lib/etiquetas';
import { atributosEnVuelo, useEnVuelo } from '../lib/diferido';
import { rutaDe } from '../lib/ruta';
import { acciones } from '../datos/almacen';
import { AvisoMuestra } from '../componentes/piezas';
import '../desbloqueo.css';

const DONDE: Record<string, string> = {
  publicado: 'en lo publicado',
  cohorte: 'en la cohorte',
  analisis: 'analizando',
  investigacion: 'investigando',
};

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** El texto del supuesto con la frase que decidió su ingrediente marcada, en
 *  la posición exacta en que casó la regla. */
function Marcado({ s }: { s: SupuestoFlojo }) {
  const texto = s.texto;
  if (s.motivo === null || s.posicion === null || texto.slice(s.posicion, s.posicion + s.motivo.length) !== s.motivo) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, s.posicion)}
      <mark title="La frase que decidió el dato que le falta">{s.motivo}</mark>
      {texto.slice(s.posicion + s.motivo.length)}
    </>
  );
}

/** Lo que un candado enseña, sacado de su fila del tablero. */
interface Candado {
  fila: FilaHipotesis;
  /** Los datos que le faltan y se consiguen pidiendo, en el orden del plan. */
  pedibles: IdIngrediente[];
  /** Le falta biología que nadie ha medido: no se abre pidiendo. */
  investigar: boolean;
  /** Tiene algún supuesto que ninguna regla clasifica: no se sabe qué pide. */
  sinClase: boolean;
}

function describir(f: FilaHipotesis, ordenDe: Map<IdIngrediente, number>): Candado {
  const pedibles = f.necesita.filter((n) => ingredienteDe(n).via !== 'investigacion');
  pedibles.sort((a, b) => (ordenDe.get(a) ?? 99) - (ordenDe.get(b) ?? 99));
  return {
    fila: f,
    pedibles,
    investigar: f.necesita.some((n) => ingredienteDe(n).via === 'investigacion'),
    sinClase: f.pendientes.some((s) => s.ingrediente === null),
  };
}

const LLAVE = (
  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
    <circle cx="8" cy="12" r="4.3" fill="none" stroke="currentColor" strokeWidth="2.1" />
    <path d="M12.3 12H21M17.3 12v3.3M20 12v2.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);

/** El candado dibujado. Las muescas son los datos que le faltan: llenas las que
 *  ya tendría con las llaves elegidas, vacías las que no, punteada la de un
 *  supuesto sin clasificar. */
function DibujoCandado({ puntos, investigar, contra }: { puntos: ('tengo' | 'falta' | 'sin')[]; investigar: boolean; contra: boolean }) {
  const n = puntos.length;
  const paso = n > 4 ? 34 / (n - 1) : 9.2;
  return (
    <svg className="des-dibujo" viewBox="0 0 64 70" width="60" height="66" aria-hidden="true">
      <path className="des-arco des-arco-cerrado" d="M20 32 V20 A12 12 0 0 1 44 20 V32" />
      <path className="des-arco des-arco-abierto" d="M20 32 V12 A12 12 0 0 1 44 12 V18" />
      <rect className="des-cuerpo" x="10" y="31" width="44" height="37" rx="9" />
      {puntos.map((p, i) => (
        <circle key={i} className={`des-punto des-punto-${p}`} cx={32 - ((n - 1) * paso) / 2 + i * paso} cy="50" r={p === 'tengo' ? 3.3 : 3} />
      ))}
      {contra && <path className="des-grieta" d="M15 37 l6 5 l-3.5 5 l7 6.5" />}
      {investigar && (
        <g className="des-interrogacion">
          <circle cx="53" cy="31" r="8" />
          <text x="53" y="35" textAnchor="middle">
            ?
          </text>
        </g>
      )}
    </svg>
  );
}

export function Desbloqueo({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const [alcance, cambiarAlcance] = useState<'programa' | 'investigacion'>('programa');
  // Hasta qué llave se llega. null es "la primera": se abre con algo encendido.
  const [paso, irAPaso] = useState<number | null>(null);
  const [sobreLlave, señalarLlave] = useState<number | null>(null);
  const [sobreCandado, señalarCandado] = useState<string | null>(null);
  const [fijado, fijar] = useState<string | null>(null);
  const [pidiendo, envolverPedir] = useEnVuelo();

  const todas = estado.hipotesis ?? [];
  const programa = useMemo(() => tablero(todas), [todas]);
  const t = useMemo(() => (alcance === 'programa' ? programa : tablero(todas.filter((h) => h.investigacionId === inv.id))), [alcance, programa, todas, inv.id]);
  const pasos = useMemo(() => plan(t), [t]);
  const enEsta = programa.filas.filter((f) => f.hipotesis.investigacionId === inv.id).length;

  const k = Math.min(paso ?? (pasos.length ? 1 : 0), pasos.length);
  const usadas = useMemo(() => new Set(pasos.slice(0, k).map((p) => p.ingrediente)), [pasos, k]);
  const abiertas = useMemo(() => new Set(k ? pasos[k - 1]!.libresAcumuladas : []), [pasos, k]);
  const ordenDe = useMemo(() => new Map(pasos.map((p, i) => [p.ingrediente, i + 1])), [pasos]);
  const final = pasos.length ? pasos[pasos.length - 1]!.libresAcumuladas.length : 0;
  const llaveSenalada = sobreLlave !== null ? (pasos[sobreLlave]?.ingrediente ?? null) : null;

  const candados = useMemo(() => t.filas.map((f) => describir(f, ordenDe)), [t, ordenDe]);
  const titulos = useMemo(() => new Map((estado.investigaciones ?? []).map((i) => [i.id, i.titulo])), [estado.investigaciones]);
  // Por investigación, la de esta pantalla primero; las demás en el orden en que aparecen.
  const grupos = useMemo(() => {
    const orden: string[] = [];
    for (const c of candados) if (!orden.includes(c.fila.hipotesis.investigacionId)) orden.push(c.fila.hipotesis.investigacionId);
    orden.sort((a, b) => (a === inv.id ? -1 : b === inv.id ? 1 : 0));
    return orden.map((id) => ({
      id,
      candados: candados.filter((c) => c.fila.hipotesis.investigacionId === id),
    }));
  }, [candados, inv.id]);

  const nInvestigar = candados.filter((c) => c.investigar).length;
  const nContra = candados.filter((c) => c.fila.contradichos.length > 0).length;
  const nSinClase = candados.filter((c) => c.sinClase).length;

  // La revisión pedida se hace con el presupuesto de la última corrida de la
  // investigación: si está pausada por presupuesto, la petición espera.
  const ultimaCorrida = useMemo(() => {
    const m = new Map<string, { numero: number; estado: string }>();
    for (const c of estado.corridas ?? []) {
      const x = m.get(c.investigacionId);
      if (!x || c.numero > x.numero) m.set(c.investigacionId, { numero: c.numero, estado: c.estado });
    }
    return m;
  }, [estado.corridas]);

  function cambiar(a: 'programa' | 'investigacion') {
    cambiarAlcance(a);
    irAPaso(null);
    fijar(null);
    señalarCandado(null);
  }

  const cabecera = (
    <div className="des-cabecera">
      <div>
        <h2>Qué desbloquea más</h2>
        <p>Cada candado es una hipótesis. Cada llave, un dato que falta. Elige hasta qué llave llegas y mira cuántos se abren.</p>
      </div>
      <div className="des-cabecera-lado">
        {t.porReevaluar.length > 0 && avisoViejos()}
        <div className="des-alcance" role="group" aria-label="Qué hipótesis se miran">
          <button type="button" aria-pressed={alcance === 'programa'} onClick={() => cambiar('programa')}>
            Todo el programa · {programa.filas.length}
          </button>
          <button type="button" aria-pressed={alcance === 'investigacion'} onClick={() => cambiar('investigacion')}>
            Esta investigación · {enEsta}
          </button>
        </div>
      </div>
    </div>
  );

  // Lo que no está al día: una línea con el botón. El porqué, en el título y en
  // la tarjeta de cada candado.
  function avisoViejos(): JSX.Element {
    const viejas = t.porReevaluar;
    const pedidas = viejas.filter((f) => f.vigencia.pedidaEn);
    const sinPedir = viejas.filter((f) => !f.vigencia.pedidaEn);
    const porRegla = new Map<number | null, number>();
    for (const f of viejas) if (f.vigencia.motivo === 'regla') porRegla.set(f.vigencia.regla, (porRegla.get(f.vigencia.regla) ?? 0) + 1);
    const partes = [
      ...[...porRegla.entries()]
        .sort(([a], [b]) => (a ?? -1) - (b ?? -1))
        .map(([r, n]) => `${n} ${n === 1 ? 'evaluada' : 'evaluadas'} ${r !== null && LO_QUE_FALTABA[r] ? LO_QUE_FALTABA[r] : 'con una regla anterior a la de hoy'}`),
      ...(['evidencia', 'fallidos', 'sin_sello'] as const).map((m) => {
        const n = viejas.filter((f) => f.vigencia.motivo === m).length;
        if (!n) return '';
        return m === 'evidencia' ? `${n} con evidencia llegada después` : m === 'fallidos' ? `${n} con supuestos que el modelo no pudo evaluar` : `${n} sin fecha de evaluación`;
      }),
    ].filter(Boolean);
    const detalle = `${partes.join('; ')}. Hasta que ROSA2018 los reevalúe, este orden es provisional.`;
    return (
      <div className="des-aviso" role="status" title={detalle}>
        <span>
          Orden provisional: {plural(viejas.length, 'hipótesis', 'hipótesis')} por reevaluar
          {pedidas.length > 0 && !sinPedir.length ? ', ya pedida' : ''}
        </span>
        {sinPedir.length > 0 && (
          <button
            type="button"
            title="Vuelve a revisarlas como cuando llega evidencia nueva: reevalúa sus supuestos y vuelve a pasar el Killer (salvo en las aceptadas), con el presupuesto de la última corrida de cada investigación. Gasta llamadas al modelo; descartar sigue necesitando a una persona."
            disabled={pidiendo}
            {...atributosEnVuelo(pidiendo)}
            onClick={envolverPedir(() => acciones.reevaluarSupuestos(alcance === 'programa' ? null : inv.id))}
          >
            Reevaluar {sinPedir.length}
          </button>
        )}
      </div>
    );
  }

  if (!t.filas.length || (!t.pendientes && !t.contradichos)) {
    return (
      <div className="contenido contenido-ancho des">
        <AvisoMuestra conexion={estado.conexion} />
        {cabecera}
        <p className="nota">
          {!t.filas.length
            ? alcance === 'programa'
              ? 'Todavía no hay hipótesis vivas en el programa.'
              : 'Esta investigación no tiene hipótesis vivas. En "Todo el programa" están las de las demás.'
            : 'Ninguna hipótesis viva tiene supuestos sin evidencia ni contradichos: no falta nada que pedir.'}
        </p>
      </div>
    );
  }

  // Las que esperan presupuesto: la única cosa del aviso que pide actuar en otra pantalla.
  const esperan = t.porReevaluar.filter((f) => f.vigencia.pedidaEn && ultimaCorrida.get(f.hipotesis.investigacionId)?.estado === 'pausada_por_presupuesto');
  const pausadas = [...new Set(esperan.map((f) => ultimaCorrida.get(f.hipotesis.investigacionId)!.numero))];
  const noAtendida = t.porReevaluar.find((f) => !f.vigencia.pedidaEn && f.vigencia.noAtendida)?.vigencia.noAtendida ?? null;

  const activo = fijado ?? sobreCandado;

  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      fijar(null);
      señalarCandado(null);
    }
  }

  return (
    <div className="contenido contenido-ancho des" onKeyDown={teclas}>
      <AvisoMuestra conexion={estado.conexion} />
      {cabecera}
      {(esperan.length > 0 || noAtendida) && (
        <p className="des-espera">
          {esperan.length > 0 && `${plural(esperan.length, 'reevaluación espera', 'reevaluaciones esperan')} a que la corrida ${pausadas.join(' y la ')} tenga presupuesto. `}
          {noAtendida}
        </p>
      )}

      <section className="des-llavero" aria-label="Las llaves, en el mejor orden">
        <div className="des-cuenta" aria-live="polite">
          {pasos.length ? (
            <>
              <div>
                <span className="des-n">{abiertas.size}</span> <span className="des-de">de {t.filas.length}</span>
              </div>
              <p>
                {k === pasos.length
                  ? `hipótesis se podrían probar con ${k === 1 ? 'esta llave' : `las ${k} llaves`}. Es lo máximo pidiendo datos.`
                  : `hipótesis se podrían probar ya con ${k === 1 ? 'esta llave' : `estas ${k} llaves`}. Con las ${pasos.length}, ${final}.`}
              </p>
              <div className="des-botones">
                <button type="button" aria-label="Llave anterior" disabled={k <= 1} onClick={() => irAPaso(Math.max(1, k - 1))}>
                  ◀
                </button>
                <button type="button" className="des-siguiente" disabled={k >= pasos.length} onClick={() => irAPaso(Math.min(pasos.length, k + 1))}>
                  {k >= pasos.length ? 'Todas las llaves' : 'Siguiente llave ▶'}
                </button>
              </div>
            </>
          ) : (
            <p>Nada de lo que les falta se consigue pidiendo: o pide biología que nadie ha medido, o ya está en contra, o no se sabe qué pide.</p>
          )}
        </div>
        {pasos.length > 0 && (
          <div className="des-pista-caja">
            <div className="des-pista-dentro" style={{ '--n': pasos.length } as CSSProperties}>
              <span className="des-linea" aria-hidden="true">
                <i
                  style={{
                    width: pasos.length > 1 ? `${((k - 1) / (pasos.length - 1)) * 100}%` : '0%',
                  }}
                />
              </span>
              <ol
                className="des-pista"
                style={{
                  gridTemplateColumns: `repeat(${pasos.length}, minmax(96px, 1fr))`,
                }}
              >
                {pasos.map((p, i) => {
                  const ing = ingredienteDe(p.ingrediente);
                  const n = i + 1;
                  const clase = n < k ? 'des-usada' : n === k ? 'des-usada des-actual' : n === k + 1 ? 'des-proxima' : '';
                  return (
                    <li key={p.ingrediente} className={`des-llave ${clase}`}>
                      <button
                        type="button"
                        aria-label={`Llave ${n}, ${ing.nombre}: ${p.libres.length ? `abre ${plural(p.libres.length, 'hipótesis', 'hipótesis')} más` : 'no abre ninguna sola, acerca otras'}. ${ing.que}`}
                        aria-current={n === k ? 'step' : undefined}
                        onClick={() => irAPaso(n)}
                        onMouseEnter={() => señalarLlave(i)}
                        onMouseLeave={() => señalarLlave(null)}
                        onFocus={() => señalarLlave(i)}
                        onBlur={() => señalarLlave(null)}
                      >
                        <span className="des-num">{n}</span>
                        <span className="des-circ">{LLAVE}</span>
                        <span className="des-nombre">{ing.nombre}</span>
                        <span className="des-donde">{DONDE[ing.via] ?? ing.via}</span>
                        <span className={`des-mas ${p.libres.length ? 'des-mas-si' : ''}`}>
                          {p.libres.length ? `+${p.libres.length} ${p.libres.length === 1 ? 'abierta' : 'abiertas'}` : 'acerca otras'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </section>

      <div className="des-grupos">
        {grupos.map((g) => {
          const abiertasAqui = g.candados.filter((c) => abiertas.has(c.fila.hipotesis.id)).length;
          return (
            <section key={g.id} className="des-grupo" aria-label={titulos.get(g.id) ?? g.id}>
              <h3>
                {titulos.get(g.id) ?? g.id}
                <span>
                  {plural(g.candados.length, 'hipótesis', 'hipótesis')} · {abiertasAqui} {abiertasAqui === 1 ? 'abierta' : 'abiertas'}
                </span>
              </h3>
              <div className="des-fila">
                {g.candados.map((c, i) => {
                  const h = c.fila.hipotesis;
                  const abierto = abiertas.has(h.id);
                  const tengo = c.pedibles.filter((n) => usadas.has(n)).length;
                  const tocado = !abierto && tengo > 0;
                  const alcanza = llaveSenalada !== null && c.pedibles.includes(llaveSenalada);
                  const puntos: ('tengo' | 'falta' | 'sin')[] = [...c.pedibles.map((n) => (usadas.has(n) ? 'tengo' : 'falta') as 'tengo' | 'falta'), ...(c.sinClase ? (['sin'] as const) : [])];
                  const clases = ['des-cand', abierto ? 'des-cand-abierto' : tocado ? 'des-cand-tocado' : '', alcanza ? 'des-alcanza' : '', fijado === h.id ? 'des-cand-fijado' : '']
                    .filter(Boolean)
                    .join(' ');
                  const resumen = abierto
                    ? 'se podría probar con las llaves elegidas'
                    : c.pedibles.length
                      ? `le ${c.pedibles.length === 1 ? 'falta 1 dato' : `faltan ${c.pedibles.length} datos`}, ${tengo} con las llaves elegidas`
                      : 'no le falta ningún dato que se consiga pidiendo';
                  const extra = [
                    c.investigar ? 'le falta biología que nadie ha medido' : '',
                    c.fila.contradichos.length ? `tiene ${plural(c.fila.contradichos.length, 'supuesto', 'supuestos')} en contra` : '',
                    c.sinClase ? 'tiene un supuesto sin clasificar' : '',
                  ].filter(Boolean);
                  return (
                    <div key={h.id} className="des-cand-caja">
                      <button
                        type="button"
                        className={clases}
                        aria-label={`${h.titulo}: ${[resumen, ...extra].join('; ')}`}
                        aria-expanded={fijado === h.id}
                        onMouseEnter={() => señalarCandado(h.id)}
                        onMouseLeave={() => señalarCandado(null)}
                        onFocus={() => señalarCandado(h.id)}
                        onBlur={() => señalarCandado(null)}
                        onClick={() => fijar(fijado === h.id ? null : h.id)}
                      >
                        <DibujoCandado puntos={puntos} investigar={c.investigar} contra={c.fila.contradichos.length > 0} />
                        <span className="des-cand-titulo">{h.titulo}</span>
                      </button>
                      {activo === h.id && (
                        <Tarjeta
                          c={c}
                          usadas={usadas}
                          ordenDe={ordenDe}
                          fijada={fijado === h.id}
                          izquierda={g.candados.length > 3 && i >= Math.ceil(g.candados.length / 2)}
                          cerrar={() => fijar(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="des-leyenda" aria-label="Qué significa cada marca">
        <span>
          <i className="des-l-punto des-l-tengo" /> dato que ya tendrías
        </span>
        <span>
          <i className="des-l-punto des-l-falta" /> dato que falta
        </span>
        {nInvestigar > 0 && (
          <span>
            <i className="des-l-interrogacion">?</i> {plural(nInvestigar, 'necesita', 'necesitan')} biología que nadie ha medido: se investiga, no se pide
          </span>
        )}
        {nContra > 0 && (
          <span>
            <i className="des-l-grieta" /> {plural(nContra, 'tiene', 'tienen')} ya algo en contra
          </span>
        )}
        {nSinClase > 0 && (
          <span>
            <i className="des-l-punto des-l-sin" /> {plural(nSinClase, 'tiene', 'tienen')} un supuesto que ninguna regla clasifica
          </span>
        )}
      </div>
    </div>
  );
}

/** Lo que le falta a una hipótesis. Al pasar por el candado, lo justo; al
 *  pincharlo, además sus supuestos con la frase que decidió cada uno. */
function Tarjeta({
  c,
  usadas,
  ordenDe,
  fijada,
  izquierda,
  cerrar,
}: {
  c: Candado;
  usadas: Set<IdIngrediente>;
  ordenDe: Map<IdIngrediente, number>;
  fijada: boolean;
  izquierda: boolean;
  cerrar: () => void;
}) {
  const f = c.fila;
  const h = f.hipotesis;
  const total = f.pendientes.length + f.contradichos.length;
  const bloques: { titulo: string; supuestos: SupuestoFlojo[] }[] = [
    ...f.necesita.map((n) => ({
      titulo: ingredienteDe(n).nombre,
      supuestos: f.pendientes.filter((s) => s.ingrediente === n),
    })),
    {
      titulo: 'Sin clasificar',
      supuestos: f.pendientes.filter((s) => s.ingrediente === null),
    },
    { titulo: 'En contra', supuestos: f.contradichos },
  ].filter((b) => b.supuestos.length > 0);
  return (
    <div className={`des-tarjeta ${izquierda ? 'des-tarjeta-izq' : ''} ${fijada ? 'des-tarjeta-fijada' : ''}`} role={fijada ? 'dialog' : 'tooltip'} aria-label={`Lo que le falta a ${h.titulo}`}>
      {fijada && (
        <button type="button" className="des-cerrar" aria-label="Cerrar" onClick={cerrar}>
          ×
        </button>
      )}
      <p className="des-tarjeta-titulo">{h.titulo}</p>
      <p className="des-tarjeta-sub">
        {ESTADO_HIPOTESIS[h.estado] ?? h.estado}
        {c.pedibles.length ? ` · para poder probarla le ${c.pedibles.length === 1 ? 'falta 1 dato' : `faltan ${c.pedibles.length} datos`}:` : ''}
      </p>
      {(c.pedibles.length > 0 || c.investigar || c.sinClase) && (
        <ul>
          {c.pedibles.map((n) => (
            <li key={n} className={usadas.has(n) ? 'des-tengo' : undefined}>
              <span className="des-marca" aria-hidden="true">
                {usadas.has(n) ? '✓' : '○'}
              </span>
              <span>{ingredienteDe(n).nombre}</span>
              <span className="des-cual">{ordenDe.has(n) ? `llave ${ordenDe.get(n)}` : 'fuera del plan'}</span>
            </li>
          ))}
          {c.investigar && (
            <li className="des-investigar">
              <span className="des-marca" aria-hidden="true">
                ?
              </span>
              <span>Biología que nadie ha medido</span>
              <span className="des-cual">se investiga</span>
            </li>
          )}
          {c.sinClase && (
            <li>
              <span className="des-marca" aria-hidden="true">
                ◌
              </span>
              <span>Un supuesto que ninguna regla clasifica</span>
              <span className="des-cual">no se sabe qué pide</span>
            </li>
          )}
        </ul>
      )}
      {f.contradichos.length > 0 && <p className="des-tarjeta-contra">Ya tiene {plural(f.contradichos.length, 'supuesto', 'supuestos')} en contra: conseguir datos no lo arregla.</p>}
      {!f.vigencia.alDia && <p className="des-tarjeta-vieja">Por reevaluar. {vigenciaEnLlano(f.vigencia)}</p>}
      {fijada ? (
        <>
          <div className="des-supuestos">
            {bloques.map((b) => (
              <div key={b.titulo}>
                <p className="des-bloque">{b.titulo}</p>
                <ul>
                  {b.supuestos.map((s) => (
                    <li key={s.id}>
                      <Marcado s={s} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <a className="enlace" href={rutaDe(h.investigacionId, 'hipotesis', h.id)}>
            Abrir la hipótesis →
          </a>
        </>
      ) : (
        <p className="des-tarjeta-pista">Pincha el candado para ver {total === 1 ? 'su supuesto' : `sus ${total} supuestos`}.</p>
      )}
    </div>
  );
}
