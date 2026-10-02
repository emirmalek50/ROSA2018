// El panorama de investigación: la síntesis por encima de las hipótesis,
// como el "research overview" de Co-Scientist (direcciones principales, por
// qué investigar, qué investigar, idea ejemplo, y áreas inesperadas), la
// meta-revisión con las debilidades recurrentes de la corrida, y la
// exportación como página de Specific Aims.
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado se calcula después de pintar la silueta de la pantalla
// (EsqueletoPantalla, variante "panel"), así que al abrirla o al cambiar de
// investigación nunca hay una pantalla vacía; el botón de exportar se marca en
// vuelo mientras arma el fichero y no admite un segundo clic.

import { acciones } from '../datos/almacen';
import type { EstadoRosa, Investigacion } from '../datos/tipos';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjeta } from '../componentes/Esqueleto';
import { AvisoMuestra, Momento, Seccion, Vacio, descargar } from '../componentes/piezas';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo } from '../lib/diferido';
import { specificAims } from '../lib/exportar';
import { rutaDe } from '../lib/ruta';
import { traducido, tr, trp } from '../lib/idioma';

/** Una promesa que se resuelve después del siguiente pintado (un fotograma y
 *  un temporizador a cero, como lib/diferido.ts): así el botón en vuelo llega
 *  a verse antes de que el trabajo síncrono de armar el fichero bloquee el hilo. */
function trasElPintado(): Promise<void> {
  return new Promise((resolver) => {
    const luego = () => setTimeout(resolver, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(luego);
    else luego();
  });
}

/** Lo que la pantalla deriva del estado para una investigación: la última
 *  corrida, sus hipótesis, las direcciones del panorama y las meta-revisiones. */
function derivarPanorama(estado: EstadoRosa, invId: string) {
  const corrida = estado.corridas.filter((c) => c.investigacionId === invId).sort((a, b) => b.numero - a.numero)[0] ?? null;
  const hipotesis = estado.hipotesis.filter((h) => h.investigacionId === invId);
  const direcciones = corrida?.panorama ?? [];
  const meta = corrida?.metaRevisiones.slice().sort((a, b) => b.iteracion - a.iteracion) ?? [];
  return { invId, corrida, hipotesis, direcciones, meta };
}

const CABECERA_PANORAMA = traducido({
  titulo: 'Panorama de la investigación',
  descripcion: 'La síntesis por encima de las hipótesis: direcciones principales, por qué y qué investigar en cada una, y lo inesperado. Es lo que ROSA2018 le enseñaría primero al investigador clínico principal.',
});
/** Medido en Chromium a 1440 px: cada tarjeta de dirección mide entre 481 y 566 px. */
const ALTO_DIRECCION = 530;

/** La silueta del panorama: la cabecera con su texto real, el botón de
 *  exportar en gris y una tarjeta por dirección (la corrida más reciente ya
 *  sabe cuántas hay), o el hueco del vacío si no hay ninguna. */
export function EsqueletoPanorama({ direcciones }: { direcciones: number }) {
  return (
    <EsqueletoPantalla variante="panel" rotulo={tr("el panorama de la investigación")} margenSuperior={16} cabecera={CABECERA_PANORAMA} acciones={<Esqueleto className="esqueleto-boton esqueleto-boton-ancho" />}>
      {direcciones === 0 ? (
        <EsqueletoTarjeta lineas={3} alto={120} />
      ) : (
        <div className="seccion" aria-hidden="true">
          {Array.from({ length: Math.min(8, direcciones) }, (_, i) => (
            <EsqueletoTarjeta key={i} lineas={12} alto={ALTO_DIRECCION} />
          ))}
        </div>
      )}
    </EsqueletoPantalla>
  );
}

export function Panorama({ inv, estado, ahora }: { inv: Investigacion; estado: EstadoRosa; ahora: number }) {
  const { valor: base } = useCalculoDiferido(() => derivarPanorama(estado, inv.id), [estado.corridas, estado.hipotesis, inv.id]);
  const [exportando, envolver] = useEnVuelo();
  // Esqueleto al abrir y al cambiar de investigación; con una actualización del
  // canal en vivo se conserva lo calculado hasta que llega lo nuevo. Cuántas
  // direcciones va a haber lo dice la corrida más reciente sin calcular nada.
  if (base === null || base.invId !== inv.id) {
    const reciente = estado.corridas.filter((c) => c.investigacionId === inv.id).sort((a, b) => b.numero - a.numero)[0];
    return <EsqueletoPanorama direcciones={reciente?.panorama.length ?? 0} />;
  }
  const { corrida, hipotesis, direcciones, meta } = base;
  const exportarAims = envolver(async () => {
    await trasElPintado();
    const texto = specificAims(inv, hipotesis);
    acciones.guardarArtefacto(inv.id, 'specific-aims.md', 'specific_aims', texto, tr('Generado desde el panorama'), corrida?.iteracionActual ?? 0);
    descargar('specific-aims.md', texto, 'text/markdown;charset=utf-8');
  });
  return (
    <div className="contenido">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{CABECERA_PANORAMA.titulo}</h2>
          <p>{CABECERA_PANORAMA.descripcion}</p>
        </div>
        <button type="button" className="btn" onClick={exportarAims} disabled={hipotesis.length === 0} {...atributosEnVuelo(exportando)}>
          {tr("Exportar como Specific Aims")}
        </button>
      </div>

      {direcciones.length === 0 ? (
        <Vacio titulo={tr("Sin panorama todavía")}>{tr("ROSA2018 lo sintetiza al cerrar cada iteración a partir de las hipótesis, las revisiones y el modelo de mundo.")}</Vacio>
      ) : (
        <div className="seccion">
          {direcciones.map((d, i) => (
            // Cada dirección es un informe corto y se lee en su orden natural:
            // por qué, qué se sabe ya, qué falta averiguar y una idea concreta.
            // Antes iba en tres columnas de unos 28 caracteres, que es meter
            // prosa científica densa en un ancho de móvil (Emir, 28 de
            // septiembre de 2026: "no tengas miedo de reorganizar").
            <article key={i} className={`direccion ${d.inesperada ? 'direccion-inesperada' : ''}`}>
              <header className="direccion-cabecera">
                <span className="direccion-numero" aria-hidden="true">{i + 1}</span>
                <h3>{d.titulo}</h3>
                {d.inesperada && <span className="direccion-marca">{tr("Área inesperada")}</span>}
              </header>
              <p className="direccion-razon">{d.razon}</p>
              <div className="direccion-columnas">
                <section>
                  <h4>{tr("Qué se sabe ya")}</h4>
                  <ul>
                    {d.hallazgosRecientes.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>{tr("Qué falta averiguar")}</h4>
                  <ul>
                    {d.queInvestigar.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
              </div>
              {/* La idea concreta es lo único accionable de la dirección: va
                  entera, a todo el ancho, y con el acento. */}
              <section className="direccion-idea">
                <h4>{tr("Una idea concreta")}</h4>
                <p>{d.ideaEjemplo}</p>
              </section>
              {d.hipotesisIds.length > 0 && (
                <footer className="direccion-hipotesis">
                  <span>{tr("De aquí salen:")}</span>
                  {d.hipotesisIds.map((id) => {
                    const h = hipotesis.find((x) => x.id === id);
                    return h ? (
                      <a key={id} href={rutaDe(inv.id, 'hipotesis', id)}>
                        {h.titulo.length > 70 ? `${h.titulo.slice(0, 67)}...` : h.titulo} <b>{h.elo}</b>
                      </a>
                    ) : null;
                  })}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}

      <Seccion titulo={tr("Meta-revisión: debilidades recurrentes")} nota={tr("Lo que se repite en las revisiones de todas las hipótesis de la corrida. Inyectarlo como criterio hace que la siguiente generación lo tenga en cuenta.")}>
        {meta.length === 0 ? (
          <p className="meta">{tr("Sin meta-revisión todavía.")}</p>
        ) : (
          meta.map((m) => (
            // Once párrafos de cinco líneas, todos del mismo peso y con su
            // botón al lado, eran un muro. Ahora cada debilidad es una fila de
            // una lista agrupada, con el texto a un ancho legible y la acción
            // a la derecha; las iteraciones viejas van plegadas.
            <details key={m.iteracion} className="debilidades" open={m.iteracion === meta[0]!.iteracion}>
              <summary>
                {(m.debilidades.length === 1 ? trp("Iteración {iteracion} · {debilidades} debilidad · ", { iteracion: m.iteracion, debilidades: m.debilidades.length }) : trp("Iteración {iteracion} · {debilidades} debilidades · ", { iteracion: m.iteracion, debilidades: m.debilidades.length }))}<Momento t={m.fecha} ahora={ahora} />
              </summary>
              <ul>
                {m.debilidades.map((d) => (
                  <li key={d.id}>
                    <div className="debilidad-texto">
                      <p>{d.texto}</p>
                      {d.hipotesisAfectadas.length > 0 && (
                        <p className="debilidad-afecta">
                          Afecta a{' '}
                          {d.hipotesisAfectadas.map((id, k) => {
                            const h = hipotesis.find((x) => x.id === id);
                            return h ? (
                              <span key={id}>
                                {k > 0 ? ', ' : ''}
                                <a href={rutaDe(inv.id, 'hipotesis', id)}>{h.titulo.length > 40 ? `${h.titulo.slice(0, 37)}...` : h.titulo}</a>
                              </span>
                            ) : null;
                          })}
                        </p>
                      )}
                    </div>
                    {d.inyectada ? (
                      <span className="debilidad-hecha">{tr("Ya es criterio")}</span>
                    ) : (
                      <button type="button" className="btn btn-s" onClick={() => corrida && acciones.inyectarDebilidad(corrida.id, d.id)}>
                        {tr("Inyectar como criterio")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </Seccion>
    </div>
  );
}
