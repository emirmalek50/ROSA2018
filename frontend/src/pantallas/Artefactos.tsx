// Artefactos versionados: informes, tablas y el estado del modelo de mundo
// por iteración. Selector de versiones y diff contra cualquier anterior; las
// versiones viejas son de solo lectura. Exportación de todas las fuentes de
// la investigación en BibTeX, RIS y CSV. Y pedir el dossier para el
// laboratorio de una hipótesis, que el servidor arma y guarda aquí como
// artefacto (la ficha de la hipótesis tiene el mismo botón).
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado (los artefactos de la investigación y las fuentes de sus
// hipótesis) se calcula después de pintar la silueta (EsqueletoPantalla,
// "lista" para la rejilla y "ficha" para el detalle). Cada botón de descarga
// se marca en vuelo mientras arma el fichero (useEnVuelo) y no admite un
// segundo clic. "Generar dossier" es una petición al servidor sin respuesta
// directa: el dossier llega por el canal en vivo como artefacto nuevo o como
// versión nueva del que ya había, así que el botón sigue en vuelo hasta que
// la huella del dossier de esa hipótesis cambia, o hasta que pasa un minuto.

import { useState } from 'react';
import { acciones } from '../datos/almacen';
import type { Artefacto, EstadoRosa, Fuente, Hipotesis, Investigacion } from '../datos/tipos';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjeta } from '../componentes/Esqueleto';
import { IconStar } from '../componentes/icons';
import { AvisoMuestra, Chip, Momento, Vacio, descargar } from '../componentes/piezas';
import { atributosEnVuelo, useCalculoDiferido, useEnVuelo, useEsperaSenal } from '../lib/diferido';
import { diferenciarLineas, resumenDiff } from '../lib/diff';
import { TIPO_ARTEFACTO } from '../lib/etiquetas';
import { ProcedenciaDeArtefacto } from '../componentes/Rosa2018';
import { aBibtex, aCsv, aRis } from '../lib/exportar';
import { rutaDe } from '../lib/ruta';

/** Cuánto espera el botón del dossier a que el servidor lo devuelva por el
 *  canal en vivo antes de darse por vencido y decirlo. */
export const ESPERA_DOSSIER_MS = 60_000;

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

/** Un botón que descarga un fichero armado en el momento. Va en vuelo desde el
 *  clic hasta que el navegador recibe el fichero, y mientras tanto ignora los
 *  clics repetidos (una descarga, no dos). */
function BotonDescarga({ etiqueta, nombre, tipo, construir, disabled, className = 'btn btn-s' }: { etiqueta: string; nombre: string; tipo?: string; construir: () => string; disabled?: boolean; className?: string }) {
  const [enVuelo, envolver] = useEnVuelo();
  const bajar = envolver(async () => {
    await trasElPintado();
    descargar(nombre, construir(), tipo);
  });
  return (
    <button type="button" className={className} disabled={disabled} {...atributosEnVuelo(enVuelo)} onClick={bajar}>
      {etiqueta}
    </button>
  );
}

function DetalleArtefacto({ a, inv, ahora }: { a: Artefacto; inv: Investigacion; ahora: number }) {
  const ultima = a.versiones[a.versiones.length - 1]!;
  const [n, setN] = useState(ultima.n);
  const [contra, setContra] = useState<number | null>(null);
  const version = a.versiones.find((v) => v.n === n) ?? ultima;
  const base = contra !== null ? a.versiones.find((v) => v.n === contra) ?? null : null;
  const diff = base ? diferenciarLineas(base.contenido, version.contenido) : null;
  const resumen = diff ? resumenDiff(diff) : null;
  return (
    <div className="contenido">
      <p style={{ marginBottom: 14 }}>
        <a className="enlace" href={rutaDe(inv.id, 'artefactos')}>
          Volver a los artefactos
        </a>
      </p>
      <div className="pantalla-cabecera">
        <div>
          <h2 className="mono" style={{ fontSize: 18 }}>
            {a.nombre}
          </h2>
          <p>
            {TIPO_ARTEFACTO[a.tipo]} · {a.versiones.length} {a.versiones.length === 1 ? 'versión' : 'versiones'}
          </p>
        </div>
        <div className="acciones">
          <BotonDescarga className="btn" etiqueta={`Descargar v${version.n}`} nombre={a.nombre} construir={() => version.contenido} />
          <button type="button" className={`btn ${a.destacado ? 'btn-primario' : ''}`} onClick={() => acciones.destacarArtefacto(a.id)}>
            <IconStar size={13} /> {a.destacado ? 'Destacado' : 'Destacar'}
          </button>
        </div>
      </div>
      <div className="acciones" style={{ marginBottom: 14 }}>
        <span className="meta">Versión</span>
        <div className="segmentos" role="group" aria-label="Versión">
          {a.versiones.map((v) => (
            <button key={v.n} type="button" aria-pressed={v.n === n} onClick={() => setN(v.n)} title={`${v.resumen} · ${new Date(v.creadaEn).toLocaleString('es')}`}>
              v{v.n}
            </button>
          ))}
        </div>
        {a.versiones.length > 1 && (
          <>
            <span className="meta">Comparar con</span>
            <select className="entrada" style={{ width: 'auto', minHeight: 30 }} value={contra ?? ''} onChange={(e) => setContra(e.target.value === '' ? null : Number(e.target.value))} aria-label="Comparar con">
              <option value="">Sin comparar</option>
              {a.versiones
                .filter((v) => v.n !== n)
                .map((v) => (
                  <option key={v.n} value={v.n}>
                    v{v.n} · {v.resumen}
                  </option>
                ))}
            </select>
          </>
        )}
        {n !== ultima.n && <Chip tono="aviso">Versión anterior, solo lectura</Chip>}
      </div>
      <p className="meta" style={{ marginBottom: 10 }}>
        v{version.n} · iteración {version.iteracion} · <Momento t={version.creadaEn} ahora={ahora} /> · {version.resumen}
        {resumen && (
          <>
            {' · '}
            <span className="subida">+{resumen.anadidas}</span> <span className="bajada">-{resumen.quitadas}</span> frente a v{contra}
          </>
        )}
      </p>
      {diff ? (
        <pre className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.tipo}>
              {l.tipo === 'anadida' ? '+ ' : l.tipo === 'quitada' ? '- ' : '  '}
              {l.texto}
            </div>
          ))}
        </pre>
      ) : (
        <pre className="contenido-artefacto">{version.contenido}</pre>
      )}
      <details className="versiones">
        <summary>Procedencia de la versión {version.n}: mensajes, código, registro de ejecución, entorno y revisión</summary>
        <ProcedenciaDeArtefacto p={version.procedencia} />
      </details>
    </div>
  );
}

/** La huella del dossier de una hipótesis: qué artefacto es y cuántas
 *  versiones tiene. Cambia cuando el servidor genera uno nuevo (artefacto
 *  nuevo) o lo regenera (versión nueva del mismo), y eso cierra la espera. */
export function huellaDossier(h: Hipotesis | null, artefactos: Artefacto[]): string {
  if (!h) return '';
  const id = h.dossierArtefactoId ?? '';
  const versiones = id ? artefactos.find((a) => a.id === id)?.versiones.length ?? 0 : 0;
  return `${id}|${versiones}`;
}

/** Pedir al servidor el dossier para el laboratorio de una hipótesis. El
 *  botón queda en vuelo hasta que el dossier llega por el canal en vivo (la
 *  huella cambia) o hasta que pasa ESPERA_DOSSIER_MS; entonces lo dice. */
function GenerarDossier({ estado, hipotesis }: { estado: EstadoRosa; hipotesis: Hipotesis[] }) {
  const ordenadas = hipotesis.slice().sort((a, b) => Number(a.estado === 'descartada') - Number(b.estado === 'descartada') || b.elo - a.elo);
  const [elegidaId, setElegidaId] = useState<string>('');
  const elegida = ordenadas.find((h) => h.id === elegidaId) ?? ordenadas[0] ?? null;
  // La espera se cierra cuando cambia la huella del dossier de la hipótesis
  // pedida (lib/diferido.ts, useEsperaSenal) o al minuto. Se guarda qué
  // hipótesis se pidió para vigilar su huella aunque la persona cambie la
  // elegida en el selector mientras espera.
  const [pedidaId, setPedidaId] = useState<string | null>(null);
  const huellaPedida = huellaDossier(hipotesis.find((h) => h.id === pedidaId) ?? null, estado.artefactos);
  const espera = useEsperaSenal(huellaPedida, ESPERA_DOSSIER_MS);
  // El viaje del POST al servidor también cuenta: la acción devuelve su promesa.
  const [enviando, envolverEnvio] = useEnVuelo();
  const pedido = enviando || espera.esperando;
  const aviso = espera.agotada ? 'Sin respuesta del servidor en un minuto. Si el dossier no aparece abajo, vuelve a pedirlo.' : null;
  const pedir = envolverEnvio(() => {
    if (!elegida || pedido) return;
    setPedidaId(elegida.id);
    // La referencia es la huella de la hipótesis que se pide ahora, no la del
    // render (pedidaId todavía apunta a la anterior).
    espera.pedir(huellaDossier(elegida, estado.artefactos));
    return acciones.generarDossier(elegida.id);
  });
  const muestra = estado.conexion === 'muestra';
  return (
    <div className="acciones" style={{ marginBottom: 16 }}>
      <span className="meta">Dossier para el laboratorio:</span>
      {ordenadas.length === 0 ? (
        <span className="meta">sin hipótesis todavía; el dossier se arma a partir de una.</span>
      ) : (
        <>
          <select className="entrada entrada-s" style={{ width: 'auto', maxWidth: 360 }} value={elegida?.id ?? ''} onChange={(e) => setElegidaId(e.target.value)} aria-label="Hipótesis del dossier">
            {ordenadas.map((h) => (
              <option key={h.id} value={h.id}>
                {h.titulo.length > 70 ? `${h.titulo.slice(0, 67)}...` : h.titulo}
                {h.estado === 'descartada' ? ' (descartada)' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-s" disabled={!elegida || muestra} title={muestra ? 'Con datos de muestra no hay servidor que lo arme' : 'El servidor arma el dossier con lo que hay en el estado, sin ningún modelo, y lo guarda aquí como artefacto'} {...atributosEnVuelo(pedido)} onClick={() => void pedir()}>
            {elegida?.dossierArtefactoId ? 'Regenerar dossier' : 'Generar dossier'}
          </button>
          {pedido && <span className="meta">Esperando al servidor: el dossier aparecerá en la lista.</span>}
          {aviso && (
            <span className="meta tono-aviso" role="status">
              {aviso}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Lo que la pantalla deriva del estado para una investigación: sus
 *  artefactos, sus hipótesis y las fuentes citadas por ellas, sin repetir. */
function derivarArtefactos(estado: EstadoRosa, invId: string) {
  const propios = estado.artefactos.filter((a) => a.investigacionId === invId);
  const hipotesis = estado.hipotesis.filter((h) => h.investigacionId === invId);
  const fuentes: Fuente[] = [];
  const vistas = new Set<string>();
  for (const h of hipotesis) {
    for (const f of h.procedencia.fuentes) {
      if (!vistas.has(f.id)) {
        vistas.add(f.id);
        fuentes.push(f);
      }
    }
  }
  return { invId, propios, hipotesis, fuentes };
}

const CABECERA_ARTEFACTOS = {
  titulo: 'Artefactos',
  descripcion: 'Lo que ROSA2018 guarda en cada iteración: informes, tablas, el estado del modelo de mundo. Cada guardado con el mismo nombre es una versión nueva.',
};
/** Medido en Chromium a 1440 px: cada tarjeta de artefacto mide entre 202 y 248 px. */
const ALTO_ARTEFACTO = 224;

/** La silueta de la rejilla de artefactos: la cabecera con su texto real y la
 *  caja de búsqueda en gris, la fila de exportación (28 px), la fila del
 *  dossier (30 px) y una tarjeta por artefacto (el estado ya sabe cuántos). */
export function EsqueletoArtefactos({ tarjetas }: { tarjetas: number }) {
  return (
    <EsqueletoPantalla variante="lista" rotulo="los artefactos" margenSuperior={16} cabecera={CABECERA_ARTEFACTOS} acciones={<Esqueleto className="esqueleto-entrada" />}>
      <div className="acciones" style={{ marginBottom: 16 }} aria-hidden="true">
        <Esqueleto alto={12} ancho={300} />
        <Esqueleto className="esqueleto-boton-s" ancho={72} />
        <Esqueleto className="esqueleto-boton-s" ancho={56} />
        <Esqueleto className="esqueleto-boton-s" ancho={56} />
      </div>
      <div className="acciones" style={{ marginBottom: 16 }} aria-hidden="true">
        <Esqueleto alto={12} ancho={160} />
        <Esqueleto alto={30} ancho={320} radio={6} />
        <Esqueleto className="esqueleto-boton-s" />
      </div>
      {tarjetas === 0 ? (
        <EsqueletoTarjeta lineas={2} alto={110} />
      ) : (
        <div className="artefactos-rejilla" aria-hidden="true">
          {Array.from({ length: Math.min(24, tarjetas) }, (_, i) => (
            <EsqueletoTarjeta key={i} lineas={4} alto={ALTO_ARTEFACTO} />
          ))}
        </div>
      )}
    </EsqueletoPantalla>
  );
}

export function Artefactos({ inv, estado, ahora, detalleId }: { inv: Investigacion; estado: EstadoRosa; ahora: number; detalleId: string | null }) {
  const [busqueda, setBusqueda] = useState('');
  const { valor: base } = useCalculoDiferido(() => derivarArtefactos(estado, inv.id), [estado.artefactos, estado.hipotesis, inv.id]);
  // Esqueleto al abrir y al cambiar de investigación; con una actualización del
  // canal en vivo se conserva lo calculado hasta que llega lo nuevo. Cuántas
  // tarjetas habrá lo sabe el estado sin derivar nada.
  if (base === null || base.invId !== inv.id) {
    if (detalleId) return <EsqueletoPantalla variante="ficha" rotulo="el artefacto" />;
    return <EsqueletoArtefactos tarjetas={estado.artefactos.filter((a) => a.investigacionId === inv.id).length} />;
  }
  const { propios, hipotesis, fuentes } = base;
  const seleccionado = propios.find((a) => a.id === detalleId);
  if (seleccionado) return <DetalleArtefacto key={seleccionado.id} a={seleccionado} inv={inv} ahora={ahora} />;
  const q = busqueda.trim().toLowerCase();
  const visibles = propios.filter((a) => q === '' || a.nombre.toLowerCase().includes(q) || TIPO_ARTEFACTO[a.tipo].toLowerCase().includes(q)).sort((a, b) => Number(b.destacado) - Number(a.destacado));
  const fecha = new Date(ahora).toISOString().slice(0, 10);
  return (
    <div className="contenido">
      <AvisoMuestra conexion={estado.conexion} />
      <div className="pantalla-cabecera" style={{ marginTop: 16 }}>
        <div>
          <h2>{CABECERA_ARTEFACTOS.titulo}</h2>
          <p>{CABECERA_ARTEFACTOS.descripcion}</p>
        </div>
        <input className="entrada" style={{ maxWidth: 300 }} value={busqueda} placeholder="Buscar artefactos" onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar artefactos" />
      </div>
      <div className="acciones" style={{ marginBottom: 16 }}>
        <span className="meta">
          {fuentes.length} {fuentes.length === 1 ? 'fuente citada' : 'fuentes citadas'} en la investigación. Exportar:
        </span>
        <BotonDescarga etiqueta="BibTeX" disabled={fuentes.length === 0} nombre={`rosa-${inv.id}-fuentes-${fecha}.bib`} construir={() => aBibtex(fuentes)} />
        <BotonDescarga etiqueta="RIS" disabled={fuentes.length === 0} nombre={`rosa-${inv.id}-fuentes-${fecha}.ris`} construir={() => aRis(fuentes)} />
        <BotonDescarga etiqueta="CSV" disabled={fuentes.length === 0} nombre={`rosa-${inv.id}-fuentes-${fecha}.csv`} tipo="text/csv;charset=utf-8" construir={() => aCsv(fuentes)} />
      </div>
      <GenerarDossier estado={estado} hipotesis={hipotesis} />
      {visibles.length === 0 ? (
        <Vacio titulo="Sin artefactos">Nada coincide con la búsqueda.</Vacio>
      ) : (
        <div className="artefactos-rejilla">
          {visibles.map((a) => {
            const ultima = a.versiones[a.versiones.length - 1]!;
            return (
              <a key={a.id} className="tarjeta tarjeta-interactiva artefacto" href={rutaDe(inv.id, 'artefactos', a.id)}>
                <div className="artefacto-tipo">
                  <span>{TIPO_ARTEFACTO[a.tipo]}</span>
                  {a.destacado && <IconStar size={13} />}
                </div>
                <h3>{a.nombre}</h3>
                <p className="meta">{ultima.resumen}</p>
                <div className="versiones">
                  <Chip>v{ultima.n}</Chip>
                  <span className="meta">
                    <Momento t={ultima.creadaEn} ahora={ahora} soloRelativo />
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
