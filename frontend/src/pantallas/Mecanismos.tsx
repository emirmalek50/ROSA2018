// Mecanismos: qué causa qué.
//
// Es la tercera pantalla de estructura, junto al Atlas (dónde, en el cuerpo) y
// al Árbol (de dónde, el linaje de las hipótesis). Esta contesta el porqué: la
// cadena causal que la hipótesis afirma, la que el campo da por sentada, y las
// explicaciones alternativas que tendrían que ser falsas para que el efecto
// sea del actor y no de otra cosa.
//
// Lo que la hace útil y no un adorno es el panel de la derecha: ROSA2018 ya
// calcula por regla (rosa/causal.py, sin modelo) si el efecto es
// `identificable`, `acotado` o `sin_resolver`, y con qué supuestos. Aquí se
// puede encender un supuesto que hoy falta para ver a dónde llevaría, que es
// la pregunta que nadie podía contestar mirando la interfaz: qué me falta
// exactamente para creerme esto.
//
// No hay endpoint nuevo: el grafo ya viaja dentro del estado.

import { useEffect, useMemo, useState } from 'react';
import type { EstadoRosa, Hipotesis, Investigacion } from '../datos/tipos';
import {
  actoresDe,
  amenazasDe,
  cascada,
  EN_LLANO_IDENTIFICACION,
  idBase,
  intensidad,
  nombreDeSupuesto,
  posicionesCascada,
  recuentoAristas,
  recuentoVeredictos,
  supuestosAgregados,
  TITULO_CAPA,
  veredictoPorRegla,
  type Capa,
  type NodoCascada,
} from '../lib/mecanismos';
import { rutaDe } from '../lib/ruta';
import { AvisoMuestra } from '../componentes/piezas';
import '../mecanismos.css';

/** El lienzo de la cascada, en sus propias coordenadas. Las cajas se colocan
 *  en porcentaje sobre estas mismas medidas, así el dibujo y las etiquetas no
 *  se separan al cambiar el tamaño de la ventana. */
const ANCHO = 1000;
const ALTO = 430;

/** Cuánto ocupa una caja, para que las flechas salgan del borde y no del
 *  centro. En coordenadas del lienzo. */
const CAJA_ANCHO = 128;
const CAJA_ALTO = 46;

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={activo ? 'mec-chip activo' : 'mec-chip'} aria-pressed={activo} onClick={onClick}>
      {children}
    </button>
  );
}

/** Una arista de consenso, curvada del borde derecho de una caja al izquierdo
 *  de la otra. Si van en la misma columna se rodea por debajo. */
function curva(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = a.x + CAJA_ANCHO / 2;
  const x2 = b.x - CAJA_ANCHO / 2;
  if (x2 <= x1) {
    const caida = Math.max(Math.abs(b.y - a.y), 40);
    return `M${a.x},${a.y + CAJA_ALTO / 2} C${a.x},${a.y + caida} ${b.x},${b.y + caida} ${b.x},${b.y + CAJA_ALTO / 2}`;
  }
  const medio = (x1 + x2) / 2;
  return `M${x1},${a.y} C${medio},${a.y} ${medio},${b.y} ${x2},${b.y}`;
}

export function Mecanismos({ inv, estado }: { inv: Investigacion; estado: EstadoRosa }) {
  const hipotesis = useMemo(
    () => (estado.hipotesis ?? []).filter((h) => h.investigacionId === inv.id && h.grafoCausal),
    [estado.hipotesis, inv.id],
  );
  const casc = useMemo(() => cascada(hipotesis), [hipotesis]);
  const aristas = useMemo(() => recuentoAristas(hipotesis), [hipotesis]);
  const veredictos = useMemo(() => recuentoVeredictos(hipotesis), [hipotesis]);
  const supuestos = useMemo(() => supuestosAgregados(hipotesis), [hipotesis]);

  const [elegidaId, elegir] = useState<string | null>(null);
  const [verAmenazas, cambiarAmenazas] = useState(true);
  // Los supuestos que hoy faltan y la persona ha encendido para ver a dónde
  // llevarían. Se vacía al cambiar de hipótesis: son preguntas de esa, no del
  // programa.
  const [encendidos, encender] = useState<Set<string>>(new Set());

  const elegida: Hipotesis | null = useMemo(
    () => hipotesis.find((h) => h.id === elegidaId) ?? hipotesis[0] ?? null,
    [hipotesis, elegidaId],
  );
  useEffect(() => encender(new Set()), [elegida?.id]);

  const grafo = elegida?.grafoCausal ?? null;
  const amenazas = useMemo(() => (verAmenazas ? amenazasDe(grafo) : []), [grafo, verAmenazas]);
  const actores = useMemo(() => actoresDe(grafo), [grafo]);

  const cumplidos = grafo?.supuestosCumplidos ?? [];
  const faltantes = grafo?.supuestosFaltantes ?? [];
  const cumplenAhora = cumplidos.length + encendidos.size;
  const faltanAhora = Math.max(0, faltantes.length - encendidos.size);
  const veredictoAhora = veredictoPorRegla(cumplenAhora, faltanAhora);
  const tocado = encendidos.size > 0;

  const puestos = useMemo(() => posicionesCascada(casc.nodos, ANCHO - CAJA_ANCHO, ALTO - CAJA_ALTO), [casc.nodos]);
  const porId = useMemo(() => new Map(puestos.map((p) => [p.id, { x: p.x + CAJA_ANCHO / 2, y: p.y + CAJA_ALTO / 2 }])), [puestos]);
  // Los nodos de la base que esta hipótesis tiene en su grafo: se encienden.
  const suyos = useMemo(() => {
    const s = new Set<string>();
    for (const n of grafo?.nodos ?? []) if (n.rol === 'base') s.add(idBase(n.id));
    return s;
  }, [grafo]);

  const columnas = useMemo(() => {
    const vistas = new Map<Capa, number>();
    for (const p of puestos) if (!vistas.has(p.capa)) vistas.set(p.capa, p.x + CAJA_ANCHO / 2);
    return [...vistas.entries()];
  }, [puestos]);

  if (!hipotesis.length) {
    return (
      <div className="contenido contenido-ancho">
        <AvisoMuestra conexion={estado.conexion} />
        <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
          <div>
            <h2>Mecanismos</h2>
          </div>
        </div>
        <p className="nota">
          Todavía no hay ninguna hipótesis con grafo causal en esta investigación. El grafo lo calcula ROSA2018 sola, sin
          modelo, cuando una hipótesis tiene enunciado y evidencia que mirar.
        </p>
      </div>
    );
  }

  const enLlano = EN_LLANO_IDENTIFICACION[veredictoAhora] ?? EN_LLANO_IDENTIFICACION.acotado!;

  return (
    <div className="contenido contenido-ancho mec">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>Mecanismos</h2>
          <p>Qué causa qué: lo que afirma la hipótesis, lo que sostiene la evidencia y lo que da por sentado el campo.</p>
        </div>
      </div>

      <div className="mec-chips">
        <Chip activo={verAmenazas} onClick={() => cambiarAmenazas(!verAmenazas)}>
          Amenazas ({amenazasDe(grafo).length})
        </Chip>
        <span className="mec-cuenta">
          {casc.total} hipótesis con grafo · {veredictos.identificable} identificables · {veredictos.acotado} acotadas
          {veredictos.sin_resolver ? ` · ${veredictos.sin_resolver} sin resolver` : ''}
        </span>
      </div>

      {aristas.inferencia_con_evidencia === 0 && aristas.total > 0 && (
        <p className="mec-aviso">
          <b>Ninguna arista está sostenida por evidencia propia todavía.</b> De las {aristas.total} del grafo,{' '}
          {aristas.supuesto} son supuestos de la hipótesis y {aristas.base_curada} consenso del campo. No es un fallo de
          esta pantalla: es lo que hay, y por eso se cuenta.
        </p>
      )}

      <div className="mec-fila">
        <div className="mec-marco">
          <div className="mec-lienzo" style={{ aspectRatio: `${ANCHO} / ${ALTO + 150}` }}>
            <svg viewBox={`0 0 ${ANCHO} ${ALTO + 150}`} aria-hidden="true">
              <defs>
                <marker id="mec-gris" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                  <path d="M0,0 L9,3.5 L0,7 z" fill="var(--mec-consenso)" />
                </marker>
                <marker id="mec-rojo" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                  <path d="M0,0 L10,4 L0,8 z" fill="var(--mec-amenaza)" />
                </marker>
              </defs>
              {casc.aristas.map((a) => {
                const de = porId.get(a.de);
                const hacia = porId.get(a.a);
                if (!de || !hacia) return null;
                const suya = suyos.has(a.de) && suyos.has(a.a);
                return (
                  <path
                    key={`${a.de}-${a.a}`}
                    d={curva(de, hacia)}
                    className={suya ? 'mec-consenso suya' : 'mec-consenso'}
                    markerEnd="url(#mec-gris)"
                  />
                );
              })}
              {amenazas.map((am, i) => {
                const destino = porId.get(casc.nodos[Math.min(i * 3 + 3, casc.nodos.length - 1)]?.id ?? '');
                const x = (ANCHO * (i + 0.5)) / amenazas.length;
                if (!destino) return null;
                return (
                  <path
                    key={am.id}
                    d={`M${x},${ALTO + 42} C${x},${ALTO - 20} ${destino.x},${destino.y + 90} ${destino.x},${destino.y + CAJA_ALTO / 2 + 6}`}
                    className="mec-amenaza-linea"
                    markerEnd="url(#mec-rojo)"
                  />
                );
              })}
            </svg>

            {columnas.map(([capa, x]) => (
              <span key={capa} className="mec-col" style={{ left: `${(x / ANCHO) * 100}%` }}>
                {TITULO_CAPA[capa]}
              </span>
            ))}

            {casc.nodos.map((n: NodoCascada) => {
              const p = puestos.find((q) => q.id === n.id);
              if (!p) return null;
              return (
                <div
                  key={n.id}
                  className={`mec-nodo mec-${intensidad(n.enJuego, casc.total)}`}
                  style={{
                    left: `${((p.x + CAJA_ANCHO / 2) / ANCHO) * 100}%`,
                    top: `${(p.y / (ALTO + 150)) * 100}%`,
                    width: `${(CAJA_ANCHO / ANCHO) * 100}%`,
                  }}
                  title={`${n.etiqueta}: en juego en ${n.enJuego} de ${casc.total} hipótesis`}
                >
                  {n.etiqueta}
                  <span className="mec-cuantas">
                    {n.enJuego} de {casc.total}
                  </span>
                </div>
              );
            })}

            {amenazas.map((am, i) => (
              <div
                key={am.id}
                className="mec-amenaza"
                style={{
                  left: `${((i + 0.5) / amenazas.length) * 100}%`,
                  top: `${((ALTO + 46) / (ALTO + 150)) * 100}%`,
                  width: `${(94 / amenazas.length)}%`,
                }}
              >
                <b>{am.clase}</b>
                <span className="mec-amenaza-texto" title={am.texto}>
                  {am.texto}
                </span>
              </div>
            ))}
          </div>

          <p className="mec-pie">
            La cascada es el consenso del campo (marco ATN), escrito a mano en <code>rosa/causal.py</code> y revisable. No
            es verdad revelada: es contexto declarado. El número de cada caja es en cuántas hipótesis entra en juego, como
            actor o como confusor, no cuántas la estudian.
          </p>
        </div>

        <div className="mec-panel">
          <label className="mec-elige">
            <span className="meta">Hipótesis</span>
            <select value={elegida?.id ?? ''} onChange={(e) => elegir(e.target.value)}>
              {hipotesis.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.titulo || h.enunciado || h.id}
                </option>
              ))}
            </select>
          </label>

          <h3>{elegida?.titulo || elegida?.enunciado || ''}</h3>

          <div className={`mec-veredicto ${veredictoAhora}`}>
            <p className="mec-t">{enLlano.titulo}</p>
            <p className="mec-d">
              {cumplenAhora} de {cumplenAhora + faltanAhora} supuestos cumplidos{tocado ? ' con lo que has encendido' : ' con la evidencia que hay'}. {enLlano.que}
            </p>
            {tocado && (
              <p className="mec-d mec-d-nota">
                Esto es una pregunta, no un resultado: ROSA2018 sigue guardando{' '}
                <b>{EN_LLANO_IDENTIFICACION[grafo?.identificacion ?? 'acotado']?.titulo.toLowerCase()}</b>.
              </p>
            )}
          </div>

          {(actores.exposicion || actores.desenlace) && (
            <dl className="mec-actores">
              <dt>Afirma que mueve</dt>
              <dd>{actores.exposicion || 'sin declarar'}</dd>
              <dt>Y lo lee en</dt>
              <dd>{actores.desenlace || 'sin declarar'}</dd>
            </dl>
          )}

          <ul className="mec-supuestos">
            {cumplidos.map((s) => (
              <li key={s} className="mec-cumplido">
                <span className="mec-caja mec-si" aria-hidden="true">
                  <i />
                </span>
                <span>
                  <b>{nombreDeSupuesto(s)}</b>
                  <span className="mec-cola">{s.slice(s.indexOf(':') + 1).trim()}</span>
                </span>
              </li>
            ))}
            {faltantes.map((s) => {
              const puesto = encendidos.has(s);
              return (
                <li key={s} className={puesto ? 'mec-cumplido' : ''}>
                  <button
                    type="button"
                    className={`mec-caja ${puesto ? 'mec-si' : 'mec-no'}`}
                    aria-pressed={puesto}
                    aria-label={`Suponer que se cumple: ${s}`}
                    onClick={() =>
                      encender((antes) => {
                        const nuevo = new Set(antes);
                        if (nuevo.has(s)) nuevo.delete(s);
                        else nuevo.add(s);
                        return nuevo;
                      })
                    }
                  >
                    <i />
                  </button>
                  <span>
                    <b>{nombreDeSupuesto(s)}</b>
                    <span className="mec-cola">{s.slice(s.indexOf(':') + 1).trim()}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          {!!faltantes.length && (
            <p className="meta mec-pista">
              Enciende un supuesto que falta y el veredicto se recalcula por la misma regla que usa el servidor. Es para
              ver qué haría falta, no para darlo por hecho.
            </p>
          )}

          {elegida && (
            <a className="btn btn-s" href={rutaDe(inv.id, 'hipotesis', elegida.id)}>
              Abrir la hipótesis
            </a>
          )}
        </div>
      </div>

      <div className="mec-leyenda">
        <span>
          <i className="l-evidencia" />
          sostenido por evidencia propia{' '}
          {aristas.inferencia_con_evidencia === 0 ? <b className="mec-cero">(0 en esta corrida)</b> : `(${aristas.inferencia_con_evidencia})`}
        </span>
        <span>
          <i className="l-supuesto" />
          lo que afirma la hipótesis, sin dato propio ({aristas.supuesto})
        </span>
        <span>
          <i className="l-amenaza" />
          amenaza: confusor, artefacto, selección o causa inversa
        </span>
        <span>
          <i className="l-consenso" />
          consenso del campo ({aristas.base_curada})
        </span>
      </div>

      <div className="mec-falta">
        <p className="mec-falta-t">QUÉ LE FALTA AL PROGRAMA · los supuestos de las {casc.total} hipótesis con grafo</p>
        <ul>
          {supuestos.map((s) => (
            <li key={s.clave}>
              <span className="mec-n">{s.nombre}</span>
              <span className="mec-barra" aria-hidden="true">
                <i className="mec-cumple" style={{ flexGrow: s.cumplen }} />
                <i className="mec-parte-falta" style={{ flexGrow: s.faltan }} />
              </span>
              <span className="mec-c">
                {s.cumplen} cumplen · <b>{s.faltan} falta{s.faltan === 1 ? '' : 'n'}</b>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
