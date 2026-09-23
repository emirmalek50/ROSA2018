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
  desvioDeArco,
  EN_LLANO_IDENTIFICACION,
  intensidad,
  nombreDeSupuesto,
  posicionesCascada,
  recuentoAristas,
  recuentoVeredictos,
  supuestosAgregados,
  supuestosDeLaFicha,
  TITULO_CAPA,
  veredictoPorRegla,
  type Capa,
  type NodoCascada,
} from '../lib/mecanismos';
import { rutaDe } from '../lib/ruta';
import { AvisoMuestra } from '../componentes/piezas';
import '../mecanismos.css';

const AYUDA =
  'El grafo causal de cada hipótesis: qué dice que causa qué, sobre el fondo de lo que el campo ya da por sentado, y con las explicaciones alternativas que tendrían que ser falsas para que el efecto sea del actor y no de otra cosa.';
const META =
  'Un efecto es identificable cuando se puede estimar sin que lo confunda otra causa. Las tres amenazas clásicas son la causa inversa (que Y cause X), el confusor (una causa común de X y de Y) y el artefacto de medida (que lo que se mueva sea el instrumento). Un ensayo aleatorizado las cierra por diseño; sin él hacen falta temporalidad, ajuste por confusores y replicación independiente. ROSA2018 comprueba esos tres supuestos por regla, sin modelo, y de ahí sale el veredicto de la derecha.';

/** El lienzo de la cascada, en sus propias coordenadas. Las cajas se colocan
 *  en porcentaje sobre estas mismas medidas, así el dibujo y las etiquetas no
 *  se separan al cambiar el tamaño de la ventana. */
const ANCHO = 1000;
const ALTO = 430;
/** La banda de la hipótesis (X e Y) y la de las amenazas, debajo de la
 *  cascada. La hipótesis se dibuja: si no, las flechas rojas no tienen a qué
 *  apuntar y la pantalla acaba inventando un destino. */
const Y_HIPOTESIS = ALTO + 24;
const Y_AMENAZAS = ALTO + 150;
const LIENZO_ALTO = ALTO + 300;

/** Cuánto ocupa una caja, para que las flechas salgan del borde y no del
 *  centro. En coordenadas del lienzo. */
const CAJA_ANCHO = 128;
const CAJA_ALTO = 46;

/** Una arista de consenso, curvada del borde derecho de una caja al izquierdo
 *  de la otra. Si van en la misma columna se rodea por debajo. */
function curva(a: { x: number; y: number }, b: { x: number; y: number }, desvio = 0): string {
  const x1 = a.x + CAJA_ANCHO / 2;
  const x2 = b.x - CAJA_ANCHO / 2;
  if (x2 <= x1) {
    // Misma columna: se rodea por el LADO, no por debajo. Con un bucle hacia
    // abajo la curva se salía de la cascada y entraba en la banda de la
    // hipótesis, y entonces parecía que el nodo conectaba con ella (22 de
    // septiembre de 2026). Una flecha nunca puede acabar donde no acaba.
    const lado = a.x - CAJA_ANCHO / 2;
    const fuera = lado - 58;
    return `M${lado},${a.y} C${fuera},${a.y} ${fuera},${b.y} ${b.x - CAJA_ANCHO / 2},${b.y}`;
  }
  const medio = (x1 + x2) / 2;
  // Con desvío, los puntos de control se separan de la recta y la flecha
  // rodea la caja que estorba en vez de cruzarla por detrás.
  const cy1 = a.y + desvio;
  const cy2 = b.y + desvio;
  return `M${x1},${a.y} C${medio},${cy1} ${medio},${cy2} ${x2},${b.y}`;
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
  // El nodo que se está señalando con el ratón (o con el teclado). Al
  // señalarlo se encienden sus flechas y los nodos del otro extremo: es la
  // única forma de seguir una línea en un grafo con quince aristas.
  const [sobre, señalar] = useState<string | null>(null);

  const elegida: Hipotesis | null = useMemo(
    () => hipotesis.find((h) => h.id === elegidaId) ?? hipotesis[0] ?? null,
    [hipotesis, elegidaId],
  );
  useEffect(() => encender(new Set()), [elegida?.id]);

  const grafo = elegida?.grafoCausal ?? null;
  const todasLasAmenazas = useMemo(() => amenazasDe(grafo), [grafo]);
  const amenazas = verAmenazas ? todasLasAmenazas : [];
  const actores = useMemo(() => actoresDe(grafo), [grafo]);
  // Los supuestos de la FICHA, que no son los tres causales del panel y pueden
  // ir en dirección contraria: una hipótesis identificable puede tener casi
  // todos sus ingredientes sin evidencia.
  const ficha = useMemo(() => supuestosDeLaFicha(elegida), [elegida]);

  const cumplidos = grafo?.supuestosCumplidos ?? [];
  const faltantes = grafo?.supuestosFaltantes ?? [];
  const cumplenAhora = cumplidos.length + encendidos.size;
  const faltanAhora = Math.max(0, faltantes.length - encendidos.size);
  const veredictoAhora = veredictoPorRegla(cumplenAhora, faltanAhora);
  const tocado = encendidos.size > 0;

  const puestos = useMemo(() => posicionesCascada(casc.nodos, ANCHO - CAJA_ANCHO, ALTO - CAJA_ALTO), [casc.nodos]);
  const porId = useMemo(
    () => new Map(puestos.map((p) => [p.id, { x: p.x + CAJA_ANCHO / 2, y: p.y + CAJA_ALTO / 2 }])),
    [puestos],
  );

  const cajas = useMemo(
    () => puestos.map((p) => ({ id: p.id, x: p.x + CAJA_ANCHO / 2, y: p.y + CAJA_ALTO / 2 })),
    [puestos],
  );

  /** Los nodos al otro extremo de una flecha del señalado. */
  const vecinos = useMemo(() => {
    if (!sobre) return new Set<string>();
    const v = new Set<string>();
    for (const a of casc.aristas) {
      if (a.de === sobre) v.add(a.a);
      if (a.a === sobre) v.add(a.de);
    }
    return v;
  }, [sobre, casc.aristas]);

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
            <p>{AYUDA}</p>
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
  const guardado = EN_LLANO_IDENTIFICACION[grafo?.identificacion ?? 'acotado']?.titulo.toLowerCase() ?? '';

  return (
    <div className="contenido contenido-ancho mec">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>Mecanismos</h2>
          <p>{AYUDA}</p>
          <p className="meta">{META}</p>
        </div>
      </div>

      <p className="mec-comose">
        <b>Cómo se lee:</b>
        <span>
          <i className="mec-trazo mec-t-consenso" />
          lo que el campo da por sentado, sin comprobar ({aristas.base_curada})
        </span>
        <span>
          <i className="mec-trazo mec-t-afirma" />
          lo que afirma la hipótesis, sin dato propio ({aristas.supuesto})
        </span>
        <span>
          <i className="mec-trazo mec-t-evidencia" />
          sostenido por evidencia propia{' '}
          {aristas.inferencia_con_evidencia === 0 ? (
            <b className="mec-cero">(0 en esta corrida)</b>
          ) : (
            `(${aristas.inferencia_con_evidencia})`
          )}
        </span>
        <span>
          <i className="mec-trazo mec-t-amenaza" />
          lo que lo tumbaría: confusor, artefacto, selección o causa inversa
        </span>
      </p>
      <p className="mec-comose mec-comose-2">
        <b>El número de cada caja:</b>
        <span>
          en cuántas de las {casc.total} hipótesis entra en juego ese nodo, sea porque lo estudian o porque es un confusor
          que hay que vigilar. No es cuántas lo estudian. Cuanto más relleno está el recuadro, en más entra; el de borde
          discontinuo apenas aparece. Pasa el ratón por una flecha y te dice qué afirma.
        </span>
      </p>

      <div className="mec-chips">
        <button
          type="button"
          className={verAmenazas ? 'mec-chip mec-activo' : 'mec-chip'}
          aria-pressed={verAmenazas}
          onClick={() => cambiarAmenazas(!verAmenazas)}
        >
          Amenazas ({todasLasAmenazas.length})
        </button>
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
          <div className="mec-lienzo" style={{ aspectRatio: `${ANCHO} / ${LIENZO_ALTO}` }}>
            <svg viewBox={`0 0 ${ANCHO} ${LIENZO_ALTO}`}>
              <defs>
                <marker
                  id="mec-gris"
                  markerUnits="userSpaceOnUse"
                  markerWidth="9"
                  markerHeight="7"
                  refX="8"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L9,3.5 L0,7 z" fill="var(--text-3)" />
                </marker>
                <marker
                  id="mec-morado"
                  markerUnits="userSpaceOnUse"
                  markerWidth="11"
                  markerHeight="9"
                  refX="10"
                  refY="4.5"
                  orient="auto"
                >
                  <path d="M0,0 L11,4.5 L0,9 z" fill="var(--accent)" />
                </marker>
                <marker
                  id="mec-rojo"
                  markerUnits="userSpaceOnUse"
                  markerWidth="10"
                  markerHeight="8"
                  refX="9"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L10,4 L0,8 z" fill="var(--red)" />
                </marker>
              </defs>
              {casc.aristas.map((a) => {
                const de = porId.get(a.de);
                const hacia = porId.get(a.a);
                if (!de || !hacia) return null;
                // Sin las dos puntas: una flecha nunca estorba a sí misma.
                const estorbos = cajas.filter((c) => c.id !== a.de && c.id !== a.a);
                const desvio = desvioDeArco(de, hacia, estorbos, CAJA_ANCHO, CAJA_ALTO);
                return (
                  <path
                    key={`${a.de}-${a.a}`}
                    d={curva(de, hacia, desvio)}
                    className={
                      !sobre
                        ? 'mec-consenso'
                        : a.de === sobre || a.a === sobre
                          ? 'mec-consenso mec-encendida'
                          : 'mec-consenso mec-apagada'
                    }
                    markerEnd="url(#mec-gris)"
                  >
                    <title>{`Consenso del campo: ${a.de} lleva a ${a.a}. ${a.contexto}`}</title>
                  </path>
                );
              })}
              {/* La hipótesis: lo que afirma, de X a Y. Sin dato propio, por eso
                  va en morado discontinuo. */}
              {(actores.exposicion || actores.desenlace) && (
                <path
                  d={`M${ANCHO * 0.3 + CAJA_ANCHO},${Y_HIPOTESIS + CAJA_ALTO / 2} L${ANCHO * 0.7 - CAJA_ANCHO},${Y_HIPOTESIS + CAJA_ALTO / 2}`}
                  className="mec-afirma"
                  markerEnd="url(#mec-morado)"
                >
                  <title>Lo que afirma la hipótesis, sin dato propio que lo sostenga</title>
                </path>
              )}
              {amenazas.map((am, i) => {
                // A donde apunta DE VERDAD, segun las aristas del grafo.
                const aX = am.hacia.includes('X');
                const aY = am.hacia.includes('Y');
                const x = (ANCHO * (i + 0.5)) / amenazas.length;
                return [aX ? 'X' : null, aY ? 'Y' : null].filter(Boolean).map((cual) => {
                  const dx = cual === 'X' ? ANCHO * 0.3 : ANCHO * 0.7;
                  return (
                    <path
                      key={`${am.id}-${cual}`}
                      d={`M${x},${Y_AMENAZAS - 6} C${x},${Y_AMENAZAS - 50} ${dx},${Y_HIPOTESIS + CAJA_ALTO + 70} ${dx},${Y_HIPOTESIS + CAJA_ALTO + 8}`}
                      className="mec-amenaza-linea"
                      markerEnd="url(#mec-rojo)"
                    >
                      <title>{`${am.clase}: ataca a ${cual === 'X' ? 'lo que la hipótesis mueve' : 'lo que la hipótesis lee'}. ${am.texto}`}</title>
                    </path>
                  );
                });
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
                  className={[
                    'mec-nodo',
                    `mec-${intensidad(n.enJuego, casc.total)}`,
                    sobre === n.id ? 'mec-senalado' : '',
                    sobre && vecinos.has(n.id) ? 'mec-vecino' : '',
                    sobre && sobre !== n.id && !vecinos.has(n.id) ? 'mec-apagado' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  tabIndex={0}
                  onMouseEnter={() => señalar(n.id)}
                  onMouseLeave={() => señalar(null)}
                  onFocus={() => señalar(n.id)}
                  onBlur={() => señalar(null)}
                  style={{
                    left: `${((p.x + CAJA_ANCHO / 2) / ANCHO) * 100}%`,
                    top: `${(p.y / LIENZO_ALTO) * 100}%`,
                    width: `${(CAJA_ANCHO / ANCHO) * 100}%`,
                  }}
                  title={`${n.etiqueta} entra en juego en ${n.enJuego} de las ${casc.total} hipótesis, como actor o como confusor`}
                >
                  {n.etiqueta}
                  <span className="mec-cuantas">
                    en {n.enJuego} de {casc.total}
                  </span>
                </div>
              );
            })}

            {(actores.exposicion || actores.desenlace) && (
              <>
                <div
                  className="mec-actor"
                  style={{ left: '30%', top: `${(Y_HIPOTESIS / LIENZO_ALTO) * 100}%`, width: `${(CAJA_ANCHO * 1.7 / ANCHO) * 100}%` }}
                  title={actores.exposicion}
                >
                  <b>LO QUE MUEVE</b>
                  <span>{actores.exposicion || 'sin declarar'}</span>
                </div>
                <div
                  className="mec-actor"
                  style={{ left: '70%', top: `${(Y_HIPOTESIS / LIENZO_ALTO) * 100}%`, width: `${(CAJA_ANCHO * 1.7 / ANCHO) * 100}%` }}
                  title={actores.desenlace}
                >
                  <b>Y LO LEE EN</b>
                  <span>{actores.desenlace || 'sin declarar'}</span>
                </div>
              </>
            )}

            {amenazas.map((am, i) => (
              <div
                key={am.id}
                className="mec-amenaza"
                style={{
                  left: `${((i + 0.5) / amenazas.length) * 100}%`,
                  top: `${(Y_AMENAZAS / LIENZO_ALTO) * 100}%`,
                  width: `${94 / amenazas.length}%`,
                }}
              >
                <b>{am.clase}</b>
                <span className="mec-amenaza-texto" title={am.texto}>
                  {am.texto}
                </span>
              </div>
            ))}
          </div>

          {verAmenazas && !todasLasAmenazas.length && (
            <p className="mec-sin-amenazas">
              Esta hipótesis no tiene ninguna explicación alternativa apuntada en su grafo, así que no hay cajas rojas que
              pintar. <b>No quiere decir que esté limpia</b>: quiere decir que el Killer no dejó ninguna en el último
              cálculo. Las que se le conocen, si las hay, están en la ficha de la hipótesis.
            </p>
          )}

          <p className="mec-pie">
            Las cajas y sus flechas grises son la cascada del campo (marco ATN), escrita a mano en{' '}
            <code>rosa/causal.py</code> y revisable: es contexto declarado, no verdad comprobada. Debajo de cada caja, en
            cuántas de las {casc.total} hipótesis entra en juego ese nodo, como actor o como confusor. No es cuántas lo
            estudian.
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
              {cumplenAhora} de {cumplenAhora + faltanAhora} supuestos cumplidos
              {tocado ? ' con lo que has encendido' : ' con la evidencia que hay'}. {enLlano.que}
            </p>
            {tocado && (
              <p className="mec-d mec-d-nota">
                Esto es una pregunta, no un resultado: ROSA2018 sigue guardando <b>{guardado}</b>.
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

          {ficha.flojos > 0 && (
            <p className="mec-ojo">
              <b>
                Ojo: {ficha.flojos} de {ficha.total} supuestos de su ficha no sostienen nada
              </b>{' '}
              ({ficha.sin_evidencia} sin evidencia
              {ficha.contradicho ? `, ${ficha.contradicho} contradicho${ficha.contradicho === 1 ? '' : 's'}` : ''}). Los
              tres de aquí abajo dicen si el efecto sería <i>identificable</i>; esos dicen si los <i>ingredientes</i>{' '}
              existen, y son cosas distintas.{' '}
              {elegida && (
                <a href={rutaDe(inv.id, 'hipotesis', elegida.id)}>Verlos en la hipótesis</a>
              )}
            </p>
          )}

          <p className="mec-supuestos-t">QUÉ HACE FALTA PARA CREÉRSELO</p>
          <ul className="mec-supuestos">
            {cumplidos.map((s) => (
              <li key={s}>
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
                <li key={s}>
                  <button
                    type="button"
                    className={`mec-caja ${puesto ? 'mec-supuesto' : ''}`}
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
              Los que faltan se pueden encender para ver a dónde llevarían: el veredicto se recalcula con la misma regla
              que usa el servidor. Es para saber qué haría falta, no para darlo por hecho.
            </p>
          )}

          {elegida && (
            <a className="btn btn-s" href={rutaDe(inv.id, 'hipotesis', elegida.id)}>
              Abrir la hipótesis
            </a>
          )}
        </div>
      </div>

      <div className="mec-falta">
        <p className="mec-falta-t">QUÉ LE FALTA AL PROGRAMA</p>
        <p className="mec-falta-d">
          Los mismos supuestos, contados sobre las {casc.total} hipótesis con grafo. Lo ámbar es lo que habría que
          conseguir para que esos efectos dejaran de estar acotados.
        </p>
        <ul>
          {supuestos.map((s) => (
            <li key={s.clave}>
              <span className="mec-n">{s.nombre}</span>
              <span className="mec-barra" aria-hidden="true">
                <i className="mec-cumple" style={{ flexGrow: s.cumplen }} />
                <i className="mec-parte-falta" style={{ flexGrow: s.faltan }} />
              </span>
              <span className="mec-c">
                {s.cumplen} cumplen ·{' '}
                <b>
                  {s.faltan} falta{s.faltan === 1 ? '' : 'n'}
                </b>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
