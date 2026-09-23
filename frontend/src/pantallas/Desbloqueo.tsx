// Qué desbloquea más: lo que les falta a todas las hipótesis, junto.
//
// Es la cuarta pantalla de estructura, junto al Atlas (dónde, en el cuerpo),
// el Árbol (de dónde, el linaje) y Mecanismos (por qué, la cadena causal).
// Mecanismos dice qué le falta a UNA hipótesis; esta contesta la pregunta de
// quien dirige el laboratorio: qué conseguir primero para que avancen más.
//
// A la izquierda, los ingredientes (lo que haría falta tener para poder
// comprobar un supuesto), ordenados por cuántas hipótesis tocan. A la derecha,
// las hipótesis vivas, cada una con un cuadrito por supuesto flojo. Al elegir
// un ingrediente salen hilos a las hipótesis que haría avanzar, y el grosor
// del hilo es cuántos supuestos de esa hipótesis abre; al elegir una
// hipótesis los hilos van al revés, de todo lo que le falta hacia ella.
// Debajo, el detalle de lo elegido (con la frase de cada supuesto que decidió
// su ingrediente) y el orden en que convendría pedir.
//
// No hay endpoint nuevo: los supuestos de cada ficha ya viajan en el estado, y
// la clasificación es una regla en el navegador (lib/desbloqueo.ts).

import { useMemo, useState } from 'react';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { ingrediente as ingredienteDe, plan, tablero, VIAS, type FilaHipotesis, type IdIngrediente, type SupuestoFlojo } from '../lib/desbloqueo';
import { ESTADO_HIPOTESIS } from '../lib/etiquetas';
import { rutaDe } from '../lib/ruta';
import { AvisoMuestra } from '../componentes/piezas';
import '../desbloqueo.css';

const AYUDA =
  'Cada hipótesis tiene supuestos que nadie ha podido comprobar todavía porque falta algo: un intervalo de referencia, los resultados de un ensayo, el tamaño de un subgrupo en ADNI. Muchos esperan lo mismo. Aquí se junta lo que falta en todas a la vez: pincha un ingrediente y se encienden las hipótesis que haría avanzar; pincha una hipótesis y se ve todo lo que le falta.';
const META =
  'Comprobar no es confirmar: el dato puede dar la razón al supuesto o quitársela. Cada supuesto va a un ingrediente por reglas de palabras, sin modelo, y al elegirlo se ve la frase que lo decidió. Medidas contra una lectura hecha a mano de los 164 supuestos flojos del 23 de septiembre de 2026, coinciden en 162 y los otros 2 quedan sin clasificar, a la vista.';

/** Las alturas de las filas, en píxeles. Los hilos se dibujan en estas mismas
 *  coordenadas, así que las filas las llevan fijas (ver desbloqueo.css). */
const CAB = 28;
const FILA_ING = 58;
const SEP = 22;
const FILA_OTRO = 34;
const CAB_GRUPO = 30;
const FILA_H = 28;
const HUECO_GRUPO = 8;
const HILOS = 150;
/** Cuántos supuestos se enseñan antes de "ver el resto". */
const VISIBLES = 6;

type Foco = { tipo: 'ingrediente'; id: IdIngrediente } | { tipo: 'hipotesis'; id: string } | { tipo: 'sin_clasificar' } | { tipo: 'contradichos' };

function clave(f: Foco | null): string {
  if (!f) return '';
  return f.tipo === 'ingrediente' || f.tipo === 'hipotesis' ? `${f.tipo}:${f.id}` : f.tipo;
}

const VIA_CORTA: Record<string, string> = { publicado: 'publicado', cohorte: 'cohorte', analisis: 'análisis', investigacion: 'investigación nueva' };

function nombreVia(via: string): string {
  return VIAS.find((v) => v.id === via)?.nombre ?? via;
}

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
      <mark title="La frase que decidió el ingrediente">{s.motivo}</mark>
      {texto.slice(s.posicion + s.motivo.length)}
    </>
  );
}

export function Desbloqueo({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const [alcance, cambiarAlcance] = useState<'programa' | 'investigacion'>('programa');
  const [elegido, elegir] = useState<Foco | null>(null);
  // Lo que se señala con el ratón o el teclado: enseña sus hilos sin cambiar
  // lo elegido, que es lo que manda en el detalle de abajo.
  const [sobre, señalar] = useState<Foco | null>(null);
  // La lista de supuestos desplegada entera, por la clave de lo elegido: al
  // elegir otra cosa vuelve a salir recogida.
  const [desplegado, desplegar] = useState('');

  const todas = estado.hipotesis ?? [];
  const programa = useMemo(() => tablero(todas), [todas]);
  const t = useMemo(() => (alcance === 'programa' ? programa : tablero(todas.filter((h) => h.investigacionId === inv.id))), [alcance, programa, todas, inv.id]);
  const pasos = useMemo(() => plan(t), [t]);
  const enEsta = programa.filas.filter((f) => f.hipotesis.investigacionId === inv.id).length;

  const pedibles = t.ingredientes.filter((f) => f.ingrediente.via !== 'investigacion');
  const biologia = t.ingredientes.find((f) => f.ingrediente.via === 'investigacion') ?? null;
  const conSin = t.filas.filter((f) => f.pendientes.some((s) => s.ingrediente === null));
  const conContra = t.filas.filter((f) => f.contradichos.length > 0);
  const conPendientes = t.filas.filter((f) => f.pendientes.length > 0);

  const existe = (f: Foco | null): boolean => {
    if (!f) return false;
    if (f.tipo === 'ingrediente') return t.ingredientes.some((x) => x.ingrediente.id === f.id);
    if (f.tipo === 'hipotesis') return t.filas.some((x) => x.hipotesis.id === f.id);
    if (f.tipo === 'sin_clasificar') return t.sinClasificar.length > 0;
    return t.contradichos > 0;
  };
  const porDefecto: Foco | null = pedibles[0]
    ? { tipo: 'ingrediente', id: pedibles[0].ingrediente.id }
    : biologia
      ? { tipo: 'ingrediente', id: biologia.ingrediente.id }
      : t.sinClasificar.length
        ? { tipo: 'sin_clasificar' }
        : t.contradichos
          ? { tipo: 'contradichos' }
          : null;
  // Lo elegido tiene que existir en el alcance de ahora: al pasar a "esta
  // investigación" un ingrediente puede quedarse sin hipótesis.
  const actual = existe(elegido) ? elegido : porDefecto;
  const foco = existe(sobre) ? sobre : actual;
  const filaFoco = foco?.tipo === 'hipotesis' ? (t.filas.find((f) => f.hipotesis.id === foco.id) ?? null) : null;

  const titulos = useMemo(() => new Map((estado.investigaciones ?? []).map((i) => [i.id, i.titulo])), [estado.investigaciones]);

  // Dónde cae cada fila, en las coordenadas de los hilos.
  const disp = useMemo(() => {
    const yIng = new Map<string, number>();
    let y = CAB;
    for (const f of t.ingredientes) {
      if (f.ingrediente.via === 'investigacion') continue;
      yIng.set(`ingrediente:${f.ingrediente.id}`, y + FILA_ING / 2);
      y += FILA_ING;
    }
    const bio = t.ingredientes.find((f) => f.ingrediente.via === 'investigacion');
    if (bio || t.sinClasificar.length || t.contradichos) {
      y += SEP + CAB;
      if (bio) {
        yIng.set(`ingrediente:${bio.ingrediente.id}`, y + FILA_ING / 2);
        y += FILA_ING;
      }
      if (t.sinClasificar.length) {
        yIng.set('sin_clasificar', y + FILA_OTRO / 2);
        y += FILA_OTRO;
      }
      if (t.contradichos) {
        yIng.set('contradichos', y + FILA_OTRO / 2);
        y += FILA_OTRO;
      }
    }
    // Las hipótesis, por investigación, la de esta pantalla primero; las
    // demás en el orden en que aparecen.
    const orden: string[] = [];
    for (const f of t.filas) if (!orden.includes(f.hipotesis.investigacionId)) orden.push(f.hipotesis.investigacionId);
    orden.sort((a, b) => (a === inv.id ? -1 : b === inv.id ? 1 : 0));
    const grupos = orden.map((id) => ({ id, filas: t.filas.filter((f) => f.hipotesis.investigacionId === id) }));
    const yHip = new Map<string, number>();
    let yh = 0;
    for (const g of grupos) {
      yh += CAB_GRUPO;
      for (const f of g.filas) {
        yHip.set(f.hipotesis.id, yh + FILA_H / 2);
        yh += FILA_H;
      }
      yh += HUECO_GRUPO;
    }
    return { yIng, grupos, yHip, alto: Math.max(y, yh) };
  }, [t, inv.id]);

  const hilos = useMemo(() => {
    const salida: { clave: string; desde: number; hasta: number; grosor: number; contra: boolean }[] = [];
    if (!foco) return salida;
    const cuantos = (f: FilaHipotesis, id: IdIngrediente | null) => f.pendientes.filter((s) => s.ingrediente === id).length;
    const añadir = (claveHilo: string, desde: number | undefined, hasta: number | undefined, grosor: number, contra = false) => {
      if (desde !== undefined && hasta !== undefined && grosor > 0) salida.push({ clave: claveHilo, desde, hasta, grosor, contra });
    };
    if (foco.tipo === 'ingrediente') {
      for (const f of t.filas) añadir(f.hipotesis.id, disp.yIng.get(clave(foco)), disp.yHip.get(f.hipotesis.id), cuantos(f, foco.id));
    } else if (foco.tipo === 'sin_clasificar') {
      for (const f of t.filas) añadir(f.hipotesis.id, disp.yIng.get('sin_clasificar'), disp.yHip.get(f.hipotesis.id), cuantos(f, null));
    } else if (foco.tipo === 'contradichos') {
      for (const f of t.filas) añadir(f.hipotesis.id, disp.yIng.get('contradichos'), disp.yHip.get(f.hipotesis.id), f.contradichos.length, true);
    } else if (filaFoco) {
      const hasta = disp.yHip.get(filaFoco.hipotesis.id);
      for (const id of filaFoco.necesita) añadir(id, disp.yIng.get(`ingrediente:${id}`), hasta, cuantos(filaFoco, id));
      añadir('sin_clasificar', disp.yIng.get('sin_clasificar'), hasta, cuantos(filaFoco, null));
      añadir('contradichos', disp.yIng.get('contradichos'), hasta, filaFoco.contradichos.length, true);
    }
    return salida;
  }, [foco, filaFoco, t, disp]);

  const cabecera = (
    <div className="pantalla-cabecera" style={{ marginTop: 16, marginBottom: 14 }}>
      <div>
        <h2>Qué desbloquea más</h2>
        <p>{AYUDA}</p>
        <p className="meta">{META}</p>
      </div>
      <div className="des-alcance" role="group" aria-label="Qué hipótesis se miran">
        <button type="button" aria-pressed={alcance === 'programa'} onClick={() => cambiarAlcance('programa')}>
          Todo el programa · {programa.filas.length}
        </button>
        <button type="button" aria-pressed={alcance === 'investigacion'} onClick={() => cambiarAlcance('investigacion')}>
          Esta investigación · {enEsta}
        </button>
      </div>
    </div>
  );

  if (!t.filas.length || (!t.pendientes && !t.contradichos)) {
    return (
      <div className="contenido contenido-ancho">
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

  const encendidaHip = (f: FilaHipotesis): boolean => {
    if (!foco) return true;
    if (foco.tipo === 'ingrediente') return f.necesita.includes(foco.id);
    if (foco.tipo === 'sin_clasificar') return f.pendientes.some((s) => s.ingrediente === null);
    if (foco.tipo === 'contradichos') return f.contradichos.length > 0;
    return f.hipotesis.id === foco.id;
  };
  // Con una hipótesis en foco, se apagan los ingredientes que no le hacen falta.
  const apagadoIng = (claveFila: string): boolean => {
    if (!filaFoco) return false;
    if (claveFila === 'sin_clasificar') return !filaFoco.pendientes.some((s) => s.ingrediente === null);
    if (claveFila === 'contradichos') return !filaFoco.contradichos.length;
    return !filaFoco.necesita.includes(claveFila.replace('ingrediente:', '') as IdIngrediente);
  };
  const señales = (f: Foco) => ({
    onMouseEnter: () => señalar(f),
    onMouseLeave: () => señalar(null),
    onFocus: () => señalar(f),
    onBlur: () => señalar(null),
    onClick: () => elegir(f),
  });

  const filaIngrediente = (f: (typeof t.ingredientes)[number], aparte = false) => {
    const foc: Foco = { tipo: 'ingrediente', id: f.ingrediente.id };
    const k = clave(foc);
    const esElegido = clave(actual) === k;
    return (
      <button
        key={k}
        type="button"
        className={`des-ing${aparte ? ' des-ing-aparte' : ''}${esElegido ? ' des-elegido' : ''}${apagadoIng(k) ? ' des-apagada' : ''}`}
        style={{ height: FILA_ING }}
        aria-pressed={esElegido}
        aria-label={`${f.ingrediente.nombre}: ${plural(f.hipotesis.length, 'hipótesis', 'hipótesis')}, ${plural(f.supuestos, 'supuesto', 'supuestos')}`}
        title={f.ingrediente.que}
        {...señales(foc)}
      >
        <span className="des-ing-cuerpo">
          <span className="des-ing-nombre">{f.ingrediente.nombre}</span>
          <span className="des-ing-barra">
            <i style={{ width: `${((f.hipotesis.length / Math.max(1, t.filas.length)) * 100).toFixed(1)}%` }} />
          </span>
          <span className="des-ing-sup">
            {plural(f.supuestos, 'supuesto', 'supuestos')} <span>· {VIA_CORTA[f.ingrediente.via]}</span>
          </span>
        </span>
        <span className="des-ing-n">
          <b>{f.hipotesis.length}</b>
          <span>hipótesis</span>
        </span>
      </button>
    );
  };

  const filaOtra = (foc: Foco, texto: JSX.Element, cuadro: string, etiqueta: string, explicacion: string) => {
    const k = clave(foc);
    const esElegido = clave(actual) === k;
    return (
      <button
        key={k}
        type="button"
        className={`des-otro${esElegido ? ' des-elegido' : ''}${apagadoIng(k) ? ' des-apagada' : ''}`}
        style={{ height: FILA_OTRO }}
        aria-pressed={esElegido}
        aria-label={etiqueta}
        title={explicacion}
        {...señales(foc)}
      >
        <i className={cuadro} aria-hidden="true" />
        <span>{texto}</span>
      </button>
    );
  };

  const claseCuadro = (s: SupuestoFlojo): string => {
    if (s.estado === 'contradicho') return 'des-q des-q-contra';
    const sinClase = s.ingrediente === null;
    const elegidoAqui = (foco?.tipo === 'ingrediente' && s.ingrediente === foco.id) || (foco?.tipo === 'sin_clasificar' && sinClase);
    return `des-q${sinClase ? ' des-q-sin' : ''}${elegidoAqui ? ' des-q-elegido' : ''}`;
  };
  const tituloCuadro = (s: SupuestoFlojo): string =>
    `${s.estado === 'contradicho' ? 'Contradicho' : 'Sin evidencia'}${s.estado === 'contradicho' ? '' : `, ${s.ingrediente ? ingredienteDe(s.ingrediente).nombre.toLowerCase() : 'sin clasificar'}`}: ${s.texto}`;

  const enlaceHipotesis = (hipotesisId: string) => {
    const h = t.filas.find((f) => f.hipotesis.id === hipotesisId)?.hipotesis;
    if (!h) return null;
    return (
      <a className="enlace meta" href={rutaDe(h.investigacionId, 'hipotesis', h.id)}>
        {h.titulo}
      </a>
    );
  };

  const listaSupuestos = (lista: SupuestoFlojo[], conHipotesis: boolean, conEvidencia = false) => {
    const k = clave(actual);
    const todos = desplegado === k;
    const vistos = todos ? lista : lista.slice(0, VISIBLES);
    return (
      <>
        <ul className="des-lista">
          {vistos.map((s) => (
            <li key={`${s.hipotesisId}-${s.id}`}>
              <p>
                <Marcado s={s} />
              </p>
              {conEvidencia && <span className="meta">Lo que dice el verificador: {evidenciaDe(s)}</span>}
              {conHipotesis && enlaceHipotesis(s.hipotesisId)}
            </li>
          ))}
        </ul>
        {lista.length > VISIBLES && (
          <button type="button" className="enlace des-mas" onClick={() => desplegar(todos ? '' : k)}>
            {todos ? 'Ver menos' : `Ver los ${lista.length - VISIBLES} restantes`}
          </button>
        )}
      </>
    );
  };

  // El texto de evidencia del verificador vive en la ficha, no en el supuesto
  // flojo: se busca por hipótesis e id.
  function evidenciaDe(s: SupuestoFlojo): string {
    const h = todas.find((x) => x.id === s.hipotesisId) as { supuestos?: { id?: string; evidencia?: string; hijos?: unknown[] }[] } | undefined;
    let encontrada = '';
    const andar = (lista: unknown, profundidad: number) => {
      if (!Array.isArray(lista) || profundidad > 12 || encontrada) return;
      for (const n of lista as { id?: string; evidencia?: string; hijos?: unknown[] }[]) {
        if (!n || typeof n !== 'object') continue;
        if (n.id === s.id && typeof n.evidencia === 'string') {
          encontrada = n.evidencia;
          return;
        }
        andar(n.hijos, profundidad + 1);
      }
    };
    andar(h?.supuestos, 0);
    return encontrada || 'sin nota';
  }

  let detalle: JSX.Element | null = null;
  if (actual?.tipo === 'ingrediente') {
    const fila = t.ingredientes.find((f) => f.ingrediente.id === actual.id)!;
    const ing = fila.ingrediente;
    const suyos = t.filas.flatMap((f) => f.pendientes.filter((s) => s.ingrediente === ing.id));
    detalle = (
      <section className="des-panel" aria-label={`Detalle: ${ing.nombre}`}>
        <h3>
          {ing.nombre} <span className="chip">{nombreVia(ing.via).toLowerCase()}</span>
        </h3>
        <p>{ing.que}</p>
        <p className="des-donde">
          <b>Dónde se consigue:</b> {ing.donde}
        </p>
        <div className="des-sub">
          {ing.via === 'investigacion'
            ? `Los ${plural(suyos.length, 'supuesto', 'supuestos')} que piden investigación nueva, en ${plural(fila.hipotesis.length, 'hipótesis', 'hipótesis')}`
            : `Los ${plural(suyos.length, 'supuesto', 'supuestos')} que dejaría comprobar, en ${plural(fila.hipotesis.length, 'hipótesis', 'hipótesis')}`}
        </div>
        {listaSupuestos(suyos, true)}
      </section>
    );
  } else if (actual?.tipo === 'hipotesis') {
    const fila = t.filas.find((f) => f.hipotesis.id === actual.id)!;
    const h = fila.hipotesis;
    const grupos = t.ingredientes.filter((f) => fila.necesita.includes(f.ingrediente.id));
    const sinClase = fila.pendientes.filter((s) => s.ingrediente === null);
    detalle = (
      <section className="des-panel" aria-label="Detalle de la hipótesis">
        <h3>
          Lo que le falta a esta hipótesis <span className="chip">{ESTADO_HIPOTESIS[h.estado] ?? h.estado}</span>
        </h3>
        <p>
          <a className="enlace" href={rutaDe(h.investigacionId, 'hipotesis', h.id)}>
            {h.titulo}
          </a>
        </p>
        <p className="des-donde">
          {plural(fila.pendientes.length, 'supuesto sin evidencia', 'supuestos sin evidencia')}
          {fila.contradichos.length ? ` y ${plural(fila.contradichos.length, 'contradicho', 'contradichos')}` : ''}, que piden{' '}
          {plural(grupos.length, 'ingrediente', 'ingredientes')}
          {sinClase.length ? ` (y ${plural(sinClase.length, 'sin clasificar', 'sin clasificar')})` : ''}.
        </p>
        {grupos.map((g) => (
          <div key={g.ingrediente.id}>
            <div className="des-grupo-detalle">
              {g.ingrediente.nombre} <span>· {VIA_CORTA[g.ingrediente.via]}</span>
            </div>
            <ul className="des-lista" style={{ marginTop: 6 }}>
              {fila.pendientes
                .filter((s) => s.ingrediente === g.ingrediente.id)
                .map((s) => (
                  <li key={s.id}>
                    <p>
                      <Marcado s={s} />
                    </p>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {sinClase.length > 0 && (
          <div>
            <div className="des-grupo-detalle">
              Sin clasificar <span>· ninguna regla los reconoce</span>
            </div>
            <ul className="des-lista" style={{ marginTop: 6 }}>
              {sinClase.map((s) => (
                <li key={s.id}>
                  <p>{s.texto}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {fila.contradichos.length > 0 && (
          <div>
            <div className="des-grupo-detalle">
              Contradichos <span>· ya hay evidencia en contra</span>
            </div>
            <ul className="des-lista" style={{ marginTop: 6 }}>
              {fila.contradichos.map((s) => (
                <li key={s.id}>
                  <p>{s.texto}</p>
                  <span className="meta">Lo que dice el verificador: {evidenciaDe(s)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  } else if (actual?.tipo === 'sin_clasificar') {
    detalle = (
      <section className="des-panel" aria-label="Detalle: sin clasificar">
        <h3>Sin clasificar</h3>
        <p>
          Ninguna regla reconoce qué piden. No se reparten a ojo entre los ingredientes: salen aquí para que alguien los lea, y
          cuentan como pendientes en todo lo demás.
        </p>
        <div className="des-sub">{plural(t.sinClasificar.length, 'supuesto', 'supuestos')}, en {plural(conSin.length, 'hipótesis', 'hipótesis')}</div>
        {listaSupuestos(t.sinClasificar, true)}
      </section>
    );
  } else if (actual?.tipo === 'contradichos') {
    const lista = conContra.flatMap((f) => f.contradichos);
    detalle = (
      <section className="des-panel" aria-label="Detalle: contradichos">
        <h3>Contradichos</h3>
        <p>
          Ya hay evidencia en contra. Conseguir un ingrediente no los arregla por sí solo: o se revisa la hipótesis, o se revisa esa
          evidencia.
        </p>
        <div className="des-sub">{plural(lista.length, 'supuesto', 'supuestos')}, en {plural(conContra.length, 'hipótesis', 'hipótesis')}</div>
        {listaSupuestos(lista, true, true)}
      </section>
    );
  }

  // El plan: una escalera de hipótesis con todo lo pendiente comprobable.
  const ultimo = pasos[pasos.length - 1] ?? null;
  const libres = ultimo?.libresAcumuladas.length ?? 0;
  const tope = Math.max(1, conPendientes.length);
  const PW = 440;
  const PH = 150;
  const PX = 30;
  const PY = 14;
  const xs = (i: number) => PX + (i / Math.max(1, pasos.length)) * (PW - PX - 12);
  const ys = (v: number) => PY + (1 - v / tope) * (PH - PY - 22);
  let escalera = `M${xs(0)},${ys(0)}`;
  pasos.forEach((p, i) => {
    escalera += ` L${xs(i + 1)},${ys(i === 0 ? 0 : pasos[i - 1]!.libresAcumuladas.length)} L${xs(i + 1)},${ys(p.libresAcumuladas.length)}`;
  });
  const marcas = [...new Set(tope < 4 ? Array.from({ length: tope + 1 }, (_, i) => i) : [0, 0.25, 0.5, 0.75, 1].map((q) => Math.round(q * tope)))];
  const conBio = conPendientes.filter((f) => f.necesita.includes('investigar')).length;
  const soloSin = conPendientes.filter((f) => !f.necesita.includes('investigar') && f.pendientes.some((s) => s.ingrediente === null)).length;

  return (
    <div className="contenido contenido-ancho">
      <AvisoMuestra conexion={estado.conexion} />
      {cabecera}
      <p className="des-resumen">
        <span>
          <b>{t.pendientes}</b> supuestos sin evidencia en <b>{conPendientes.length}</b>
          {conPendientes.length !== t.filas.length ? ` de ${t.filas.length}` : ''} hipótesis vivas
        </span>
        <span>
          <b>{t.contradichos}</b> {t.contradichos === 1 ? 'contradicho' : 'contradichos'}
        </span>
        <span>
          <b>{t.sinClasificar.length}</b> sin clasificar
        </span>
      </p>

      <section className="des-tablero" aria-label="Ingredientes e hipótesis">
        <div className="des-ingredientes">
          <div className="des-cab" style={{ height: CAB }}>
            Se consigue pidiendo
          </div>
          {pedibles.map((f) => filaIngrediente(f))}
          {(biologia || t.sinClasificar.length > 0 || t.contradichos > 0) && (
            <>
              <div className="des-sep" style={{ height: SEP }} />
              <div className="des-cab" style={{ height: CAB }}>
                No se consigue pidiendo
              </div>
              {biologia && filaIngrediente(biologia, true)}
              {t.sinClasificar.length > 0 &&
                filaOtra(
                  { tipo: 'sin_clasificar' },
                  <>
                    <b>{t.sinClasificar.length}</b> sin clasificar: ninguna regla los reconoce
                  </>,
                  'des-q des-q-sin',
                  `${plural(t.sinClasificar.length, 'supuesto', 'supuestos')} sin clasificar`,
                  'Ninguna regla reconoce qué piden: no se reparten a ojo entre los ingredientes.',
                )}
              {t.contradichos > 0 &&
                filaOtra(
                  { tipo: 'contradichos' },
                  <>
                    <b>{t.contradichos}</b> {t.contradichos === 1 ? 'contradicho' : 'contradichos'} en {plural(conContra.length, 'hipótesis', 'hipótesis')}
                  </>,
                  'des-q des-q-contra',
                  `${plural(t.contradichos, 'supuesto contradicho', 'supuestos contradichos')}`,
                  'Ya hay evidencia en contra: conseguir un ingrediente no los arregla por sí solo.',
                )}
            </>
          )}
        </div>

        <svg className="des-hilos" width={HILOS} height={disp.alto} viewBox={`0 0 ${HILOS} ${disp.alto}`} aria-hidden="true">
          {hilos.map((h) => (
            <g key={h.clave}>
              <path
                className={h.contra ? 'des-hilo-contra' : undefined}
                d={`M0,${h.desde} C${HILOS * 0.55},${h.desde} ${HILOS * 0.45},${h.hasta} ${HILOS - 4},${h.hasta}`}
                strokeWidth={(1.1 + (h.grosor - 1) * 0.9).toFixed(2)}
              />
              <circle className={h.contra ? 'des-hilo-contra' : undefined} cx={HILOS - 4} cy={h.hasta} r={2.6} />
            </g>
          ))}
        </svg>

        <div className="des-hipotesis">
          {disp.grupos.map((g) => (
            <div key={g.id} style={{ marginBottom: HUECO_GRUPO }}>
              <div className="des-grupo" style={{ height: CAB_GRUPO }}>
                <span title={titulos.get(g.id) ?? g.id}>{titulos.get(g.id) ?? g.id}</span>
                <span className="des-grupo-n">
                  {g.filas.length}
                  {g.id === inv.id && alcance === 'programa' ? ' · esta investigación' : ''}
                </span>
              </div>
              {g.filas.map((f) => {
                const foc: Foco = { tipo: 'hipotesis', id: f.hipotesis.id };
                const esElegida = clave(actual) === clave(foc);
                return (
                  <button
                    key={f.hipotesis.id}
                    type="button"
                    className={`des-hip${esElegida ? ' des-elegido' : ''}${encendidaHip(f) ? '' : ' des-apagada'}`}
                    style={{ height: FILA_H }}
                    aria-pressed={esElegida}
                    aria-label={`${f.hipotesis.titulo}: ${plural(f.pendientes.length, 'supuesto sin evidencia', 'supuestos sin evidencia')}${f.contradichos.length ? `, ${plural(f.contradichos.length, 'contradicho', 'contradichos')}` : ''}`}
                    {...señales(foc)}
                  >
                    <span className="des-hip-estado">{ESTADO_HIPOTESIS[f.hipotesis.estado] ?? f.hipotesis.estado}</span>
                    <span className="des-hip-titulo" title={f.hipotesis.titulo}>
                      {f.hipotesis.titulo}
                    </span>
                    <span className="des-qs">
                      {[...f.pendientes, ...f.contradichos].map((s) => (
                        <i key={s.id} className={claseCuadro(s)} title={tituloCuadro(s)} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <div className="des-leyenda">
        <span>
          <i className="des-q" /> supuesto sin evidencia
        </span>
        <span>
          <i className="des-q des-q-elegido" /> lo deja comprobar el ingrediente elegido
        </span>
        <span>
          <i className="des-q des-q-contra" /> contradicho
        </span>
        <span>
          <i className="des-q des-q-sin" /> sin clasificar
        </span>
        <span>el grosor del hilo es cuántos supuestos de esa hipótesis abre</span>
      </div>

      <div className="des-bajo">
        {detalle}
        <section className="des-panel des-plan" aria-label="Orden en que conviene pedir">
          <h3>Si se pidieran en este orden</h3>
          <p>
            En cada paso, el ingrediente que deja más hipótesis con todo lo pendiente comprobable; a igualdad, el que más acerca a las que
            pueden quedar así. La biología sin medir no entra: no se pide, se investiga.
          </p>
          {pasos.length === 0 ? (
            <p className="nota" style={{ marginTop: 12 }}>
              Nada de lo que falta se consigue pidiendo: todo es biología sin medir o está sin clasificar.
            </p>
          ) : (
            <>
              <svg viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label={`Hipótesis con todo lo pendiente comprobable, paso a paso: de 0 a ${libres} de ${conPendientes.length}`}>
                {marcas.map((v) => (
                  <g key={v}>
                    <line className="des-rej" x1={PX} x2={PW - 12} y1={ys(v)} y2={ys(v)} />
                    <text className="des-eje" x={PX - 8} y={ys(v) + 3.5} textAnchor="end">
                      {v}
                    </text>
                  </g>
                ))}
                <path className="des-area" d={`${escalera} L${xs(pasos.length)},${ys(0)} Z`} />
                <path className="des-linea" d={escalera} />
                {pasos.map((_, i) => (
                  <text key={i} className="des-eje" x={xs(i + 1)} y={PH - 4} textAnchor="middle">
                    {i + 1}
                  </text>
                ))}
                <circle className="des-punto" cx={xs(pasos.length)} cy={ys(libres)} r={4} />
                <text className="des-fin" x={xs(pasos.length) - 8} y={ys(libres) - 9} textAnchor="end">
                  {libres} de {conPendientes.length}
                </text>
              </svg>
              <ol className="des-pasos">
                {pasos.map((p) => (
                  <li key={p.ingrediente}>
                    <span>{ingredienteDe(p.ingrediente).nombre}</span>
                    <span className={`des-paso-n${p.libres.length ? '' : ' des-cero'}`}>+{plural(p.libres.length, 'hipótesis', 'hipótesis')}</span>
                    <span className="des-paso-s">{p.supuestos} sup.</span>
                  </li>
                ))}
              </ol>
              <p className="des-pie">
                Con {pasos.length === 1 ? 'ese' : `los ${pasos.length}`},{' '}
                <b>
                  {libres} de {conPendientes.length}
                </b>{' '}
                hipótesis quedan con todo lo pendiente comprobable ({ultimo!.acumulados} de {t.pendientes} supuestos).
                {conPendientes.length - libres > 0 &&
                  ` ${conPendientes.length - libres === 1 ? 'La otra' : `Las otras ${conPendientes.length - libres}`}: ${[conBio ? `${conBio} ${conBio === 1 ? 'pide' : 'piden'} biología sin medir` : '', soloSin ? `${soloSin} ${soloSin === 1 ? 'tiene' : 'tienen'} algún supuesto sin clasificar` : ''].filter(Boolean).join(' y ')}.`}
                {conContra.length > 0 &&
                  ` Y ${conContra.length} ${conContra.length === 1 ? 'tiene' : 'tienen'} ya algún supuesto contradicho: comprobar el resto no ${conContra.length === 1 ? 'la salva' : 'las salva'}.`}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
