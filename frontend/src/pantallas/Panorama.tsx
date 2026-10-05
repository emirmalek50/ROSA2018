// El panorama de investigación: la síntesis por encima de las hipótesis,
// como el "research overview" de Co-Scientist (direcciones principales, por
// qué investigar, qué investigar, idea ejemplo, y áreas inesperadas), la
// meta-revisión con las debilidades recurrentes de la corrida, y la
// exportación como página de Specific Aims.
//
// Rehecho el 5 de octubre de 2026 sobre el diseño "Panorama · v1": un titular
// que cuenta cuántos caminos hay y cuántos no se esperaban, un mapa con las
// direcciones de un vistazo, cada dirección como un capítulo (porqué, lo que
// se sabe frente a lo que falta, la idea concreta y las hipótesis que salen
// de ella) y la meta-revisión con el progreso de lo ya inyectado como
// criterio. Estilos en panorama.css.
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado se calcula después de pintar la silueta de la pantalla
// (EsqueletoPantalla, variante "panel"), así que al abrirla o al cambiar de
// investigación nunca hay una pantalla vacía; el botón de exportar se marca en
// vuelo mientras arma el fichero y no admite un segundo clic.

import { acciones } from '../datos/almacen';
import type { Corrida, Direccion as DireccionPanorama, EstadoRosa, Hipotesis, Investigacion, MetaRevision } from '../datos/tipos';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjeta } from '../componentes/Esqueleto';
import { AvisoMuestra, Momento, Vacio, descargar } from '../componentes/piezas';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo } from '../lib/diferido';
import { specificAims } from '../lib/exportar';
import { primeraFrase } from '../lib/modo';
import { rutaDe } from '../lib/ruta';
import { traducido, tr, trp } from '../lib/idioma';
import '../panorama.css';

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
/** Medido en Chromium a 1440 px: cada dirección mide entre 700 y 900 px. */
const ALTO_DIRECCION = 780;

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

/** Del uno al diez en letra y con mayúscula: el titular se lee como una frase. */
const EN_LETRA = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez'];
const enLetra = (n: number) => (n >= 1 && n <= EN_LETRA.length ? tr(EN_LETRA[n - 1]!) : String(n));

/** "Cuatro caminos para responder la pregunta. Uno no lo esperábamos." */
function titularPanorama(direcciones: DireccionPanorama[]): string {
  const n = direcciones.length;
  const k = direcciones.filter((d) => d.inesperada).length;
  const caminos = n === 1 ? tr('Un camino para responder la pregunta.') : trp('{n} caminos para responder la pregunta.', { n: enLetra(n) });
  if (k === 0) return caminos;
  const sorpresa = n === 1 ? tr('Y no lo esperábamos.') : k === 1 ? tr('Uno no lo esperábamos.') : k === n ? tr('No esperábamos ninguno.') : trp('{k} no los esperábamos.', { k: enLetra(k) });
  return `${caminos} ${sorpresa}`;
}

const dosCifras = (n: number) => String(n).padStart(2, '0');
const recortar = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t);
const cuentaHipotesis = (n: number) => (n === 1 ? tr('1 hipótesis') : trp('{n} hipótesis', { n }));

function irADireccion(i: number) {
  document.getElementById(`pan-dir-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const hay = direcciones.length > 0;
  return (
    <div className="contenido panorama">
      <AvisoMuestra conexion={estado.conexion} />
      <header className="pan-cabecera">
        <p className="pan-contexto">
          <span className="pan-ojo">{tr('Panorama')}</span>
          {corrida && <span>{trp('Corrida {n} · iteración {it}', { n: corrida.numero, it: corrida.iteracionActual })}</span>}
          <span>{cuentaHipotesis(hipotesis.length)}</span>
        </p>
        <h2 className="pan-titular">{hay ? titularPanorama(direcciones) : CABECERA_PANORAMA.titulo}</h2>
        <div className="pan-pregunta-fila">
          <div className="pan-pregunta">
            <span>{tr('La pregunta')}</span>
            <p>{inv.titulo}</p>
          </div>
          <button type="button" className="btn pan-exportar" onClick={exportarAims} disabled={hipotesis.length === 0} {...atributosEnVuelo(exportando)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5ZM9.5 1.5V5H13M8 7.5v4.5M6 10l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tr("Exportar como Specific Aims")}
          </button>
        </div>
      </header>

      {!hay ? (
        <Vacio titulo={tr("Sin panorama todavía")}>{tr("ROSA2018 lo sintetiza al cerrar cada iteración a partir de las hipótesis, las revisiones y el modelo de mundo.")}</Vacio>
      ) : (
        <>
          {/* El mapa: todas las direcciones de un vistazo antes de leer ninguna. */}
          <nav className="pan-mapa" aria-label={tr('Direcciones del panorama')}>
            {direcciones.map((d, i) => (
              <button key={i} type="button" className={`pan-indice ${d.inesperada ? 'pan-indice-inesperada' : ''}`} onClick={() => irADireccion(i)}>
                <span className="pan-indice-top">
                  <span className="pan-num">{dosCifras(i + 1)}</span>
                  {d.inesperada && <span className="pan-marca">{tr('Inesperada')}</span>}
                </span>
                <span className="pan-indice-titulo">{d.titulo}</span>
                <span className="pan-indice-cuenta">
                  {trp('{s} se sabe · {f} falta', { s: d.hallazgosRecientes.length, f: d.queInvestigar.length })} · {cuentaHipotesis(d.hipotesisIds.length)}
                </span>
              </button>
            ))}
          </nav>
          {direcciones.map((d, i) => (
            <Direccion key={i} d={d} i={i} total={direcciones.length} inv={inv} hipotesis={hipotesis} />
          ))}
        </>
      )}

      <MetaRevisionPanorama meta={meta} corrida={corrida} inv={inv} hipotesis={hipotesis} ahora={ahora} />
    </div>
  );
}

/** Una dirección como un capítulo: el porqué de entrada, lo que se sabe frente
 *  a lo que falta en paralelo (se comparan), la idea concreta destacada porque
 *  es lo único accionable, y las hipótesis que salen de ella. */
function Direccion({ d, i, total, inv, hipotesis }: { d: DireccionPanorama; i: number; total: number; inv: Investigacion; hipotesis: Hipotesis[] }) {
  const ligadas = d.hipotesisIds.map((id) => hipotesis.find((x) => x.id === id)).filter((h): h is Hipotesis => Boolean(h));
  return (
    <article id={`pan-dir-${i + 1}`} className={`direccion pan-dir ${d.inesperada ? 'direccion-inesperada' : ''}`}>
      <header className="pan-dir-cabeza">
        <p className="pan-dir-ojo">
          <span className="pan-num">{trp('Dirección {n} de {total}', { n: dosCifras(i + 1), total: dosCifras(total) })}</span>
          {d.inesperada && <span className="pan-marca pan-marca-caja">{tr('Área inesperada')}</span>}
        </p>
        <h3>{d.titulo}</h3>
        <p className="pan-dir-razon">{d.razon}</p>
      </header>
      <div className="pan-dir-columnas">
        <ListaNumerada titulo={tr('Qué se sabe ya')} clase="pan-sabe" items={d.hallazgosRecientes} />
        <ListaNumerada titulo={tr('Qué falta averiguar')} clase="pan-falta" items={d.queInvestigar} />
      </div>
      <section className="pan-idea">
        <h4>{tr('Una idea concreta')}</h4>
        <p>{d.ideaEjemplo}</p>
      </section>
      {ligadas.length > 0 && (
        <footer className="pan-salen">
          <span className="pan-salen-rotulo">{tr('De aquí salen')}</span>
          {ligadas.map((h) => (
            <a key={h.id} className="pan-salen-hip" href={rutaDe(inv.id, 'hipotesis', h.id)}>
              <span className="pan-salen-titulo">{recortar(h.titulo, 140)}</span>
              <span className="pan-salen-elo">{trp('Elo {elo}', { elo: h.elo })}</span>
              <span className="pan-flecha" aria-hidden="true">→</span>
            </a>
          ))}
        </footer>
      )}
    </article>
  );
}

function ListaNumerada({ titulo, clase, items }: { titulo: string; clase: string; items: string[] }) {
  return (
    <section className={`pan-lista ${clase}`}>
      <h4>
        {titulo} <span>{items.length}</span>
      </h4>
      <ol>
        {items.map((x, k) => (
          <li key={k}>
            <span className="pan-k" aria-hidden="true">{k + 1}</span>
            <span>{x}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MetaRevisionPanorama({ meta, corrida, inv, hipotesis, ahora }: { meta: MetaRevision[]; corrida: Corrida | null; inv: Investigacion; hipotesis: Hipotesis[]; ahora: number }) {
  const [ultima, ...anteriores] = meta;
  if (!ultima) {
    return (
      <section className="pan-meta">
        <div className="pan-meta-cabeza">
          <p className="pan-contexto">
            <span className="pan-ojo">{tr('Meta-revisión')}</span>
          </p>
          <p className="pan-meta-nota">{tr("Sin meta-revisión todavía.")}</p>
        </div>
      </section>
    );
  }
  const n = ultima.debilidades.length;
  const hechas = ultima.debilidades.filter((d) => d.inyectada).length;
  const nota =
    n === 0
      ? tr('Ninguna debilidad se repite en las revisiones de esta iteración.')
      : hechas === 0
        ? tr('Ninguna es criterio todavía. Inyectar una hace que la siguiente generación de hipótesis la tenga en cuenta.')
        : hechas === n
          ? tr('Todas son ya criterio de la siguiente generación de hipótesis.')
          : trp('{k} de {n} ya son criterio. Inyectar el resto hace que la siguiente generación de hipótesis las tenga en cuenta.', { k: hechas, n });
  return (
    <section className="pan-meta">
      <div className="pan-meta-cabeza">
        <p className="pan-contexto">
          <span className="pan-ojo">{tr('Meta-revisión')}</span>
          <span>{trp('Iteración {n}', { n: ultima.iteracion })}</span>
          <Momento t={ultima.fecha} ahora={ahora} soloRelativo />
        </p>
        <h3 className="pan-meta-titular">{n === 1 ? tr('1 debilidad se repite en todas las revisiones') : trp('{n} debilidades se repiten en todas las revisiones', { n })}</h3>
        <p className="pan-meta-nota">{nota}</p>
        {n > 0 && (
          <div className="pan-progreso" role="img" aria-label={trp('{k} de {n} ya son criterio', { k: hechas, n })}>
            {ultima.debilidades.map((d) => (
              <span key={d.id} className={d.inyectada ? 'pan-seg-hecho' : undefined} />
            ))}
          </div>
        )}
      </div>
      <ListaDebilidades m={ultima} corrida={corrida} inv={inv} hipotesis={hipotesis} />
      {/* Las iteraciones viejas van plegadas: interesan para ver qué cambió. */}
      {anteriores.map((m) => (
        <details key={m.iteracion} className="pan-anterior">
          <summary>
            {(m.debilidades.length === 1 ? trp("Iteración {iteracion} · {debilidades} debilidad · ", { iteracion: m.iteracion, debilidades: m.debilidades.length }) : trp("Iteración {iteracion} · {debilidades} debilidades · ", { iteracion: m.iteracion, debilidades: m.debilidades.length }))}<Momento t={m.fecha} ahora={ahora} soloRelativo />
          </summary>
          <ListaDebilidades m={m} corrida={corrida} inv={inv} hipotesis={hipotesis} />
        </details>
      ))}
    </section>
  );
}

/** Cada debilidad: su primera frase como resumen, el resto debajo, a qué
 *  hipótesis afecta y la acción a la derecha. */
function ListaDebilidades({ m, corrida, inv, hipotesis }: { m: MetaRevision; corrida: Corrida | null; inv: Investigacion; hipotesis: Hipotesis[] }) {
  return (
    <ol className="pan-debilidades">
      {m.debilidades.map((d, k) => {
        const lead = primeraFrase(d.texto);
        const resto = d.texto.trim().slice(lead.length).trim();
        const afectadas = d.hipotesisAfectadas.map((id) => hipotesis.find((x) => x.id === id)).filter((h): h is Hipotesis => Boolean(h));
        return (
          <li key={d.id}>
            <span className="pan-num pan-deb-k" aria-hidden="true">{dosCifras(k + 1)}</span>
            <div className="pan-deb-cuerpo">
              <p className="pan-deb-lead">{lead}</p>
              {resto && <p className="pan-deb-resto">{resto}</p>}
              {afectadas.length > 0 && (
                <p className="pan-deb-afecta">
                  {tr("Afecta a")}{' '}
                  {afectadas.map((h, j) => (
                    <span key={h.id}>
                      {j > 0 ? ', ' : ''}
                      <a href={rutaDe(inv.id, 'hipotesis', h.id)}>{recortar(h.titulo, 60)}</a>
                    </span>
                  ))}
                </p>
              )}
            </div>
            {d.inyectada ? (
              <span className="pan-deb-hecha">{tr("Ya es criterio")}</span>
            ) : (
              <button type="button" className="btn btn-s" onClick={() => corrida && acciones.inyectarDebilidad(corrida.id, d.id)}>
                {tr("Inyectar como criterio")}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
