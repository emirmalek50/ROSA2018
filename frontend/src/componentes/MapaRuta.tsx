// La vista de programa de la ruta terapéutica (plan completo, sección 10;
// rosa/ruta.py mapa_ruta): una fila por diana o proceso con hipótesis vivas y
// una columna por cada uno de los ocho pasos que separan un mecanismo de un
// beneficio para una persona. En cada celda, cuántas hipótesis cubren el
// paso, cuántas lo cubren a medias, cuántos hechos lo tocan y la mayor
// certeza GRADE entre ellas. Un paso hueco (ninguna hipótesis de esa diana lo
// cubre) se pinta en gris. El resumen en llano va encima de la tabla.

import type { CeldaMapaRuta, EstadoRosa, MapaRuta as Mapa, PasoRutaTerapeutica } from '../datos/tipos';
import { CERTEZA_EVIDENCIA, PASO_RUTA } from '../lib/etiquetas';
import { plural } from '../lib/formato';
import { rutaDe } from '../lib/ruta';
import { tr, trp } from '../lib/idioma';

/** Los ocho pasos en orden. */
export const PASOS_RUTA: PasoRutaTerapeutica[] = ['mecanismo', 'opciones_intervencion', 'compromiso_diana', 'efecto_funcional', 'selectividad_toxicidad', 'exposicion', 'replicacion_independiente', 'evidencia_poblacion'];

/** Qué comprueba cada paso, en una frase. Copiado de rosa/ruta.py
 *  DEFINICIONES_PASO; si cambia allí, cambia aquí. */
export const DEFINICIONES_PASO: Record<PasoRutaTerapeutica, string> = {
  mecanismo: tr('qué proceso biológico explica el efecto y con qué evidencia'),
  opciones_intervencion: tr('con qué se podría actuar sobre la diana (fármaco, anticuerpo, modulación) y en qué dirección'),
  compromiso_diana: tr('que la intervención o la medida llega a la diana y la cambia de forma medible'),
  efecto_funcional: tr('que cambiar la diana cambia algo que importa: cognición, síntomas, función celular'),
  selectividad_toxicidad: tr('que el efecto es sobre la diana y no sobre otras, y qué daño produce'),
  exposicion: tr('que el fármaco o el marcador llega a donde tiene que llegar (sangre, LCR, cerebro), con qué dosis y cuánto tiempo'),
  replicacion_independiente: tr('que el efecto se ha visto en al menos dos cohortes distintas (grupos de personas estudiados por separado)'),
  evidencia_poblacion: tr('que hay estudios primarios en personas (cohortes, casos y controles, transversales o ensayos) con al menos 50 participantes'),
};

function celdaVacia(): CeldaMapaRuta {
  return { hipotesis: 0, parciales: 0, hechos: 0, certezaMax: null };
}

function entero(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** Texto seguro: un resumen o una etiqueta que no sean texto no se pintan (React no acepta objetos como hijos). */
const texto = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Una celda: números y certeza, o "hueco" en gris. */
function Celda({ celda, hueco, paso, diana }: { celda: CeldaMapaRuta | undefined; hueco: boolean; paso: PasoRutaTerapeutica; diana: string }) {
  const c = celda && typeof celda === 'object' ? celda : celdaVacia();
  const hip = entero(c.hipotesis);
  const parciales = entero(c.parciales);
  const hechos = entero(c.hechos);
  const certeza = c.certezaMax && CERTEZA_EVIDENCIA[c.certezaMax] ? CERTEZA_EVIDENCIA[c.certezaMax] : null;
  const etiquetaPaso = PASO_RUTA[paso]?.etiqueta ?? paso;
  if (hueco || (hip === 0 && parciales === 0 && hechos === 0)) {
    return (
      <td className="num ruta-celda ruta-hueco" title={trp("{diana}, {v}: ninguna hipótesis viva de esta diana cubre el paso{v2}.", { diana, v: etiquetaPaso.toLowerCase(), v2: hechos ? trp("; {hechos} del modelo de mundo lo tocan", { hechos: plural(hechos, tr("hecho")) }) : '' })}>
        <span className="ruta-hueco-texto">{tr("hueco")}</span>
        {hechos > 0 && <span className="meta ruta-celda-hechos">{plural(hechos, tr("hecho"))}</span>}
      </td>
    );
  }
  return (
    <td className={`num ruta-celda ${certeza ? `ruta-certeza-${certeza.tono}` : ''}`} title={trp("{diana}, {v}: {hip}, {parciales} a medias, {hechos} del modelo de mundo{v2}.", { diana, v: etiquetaPaso.toLowerCase(), hip: plural(hip, tr('hipótesis cubre el paso'), tr('hipótesis cubren el paso')), parciales, hechos: plural(hechos, tr("hecho")), v2: certeza ? trp("; certeza máxima: {v}", { v: certeza.etiqueta.toLowerCase() }) : '' })}>
      <span className="ruta-celda-cifra">{hip}</span>
      {parciales > 0 && <span className="meta ruta-celda-parciales">{(parciales === 1 ? trp("+{parciales} parcial", { parciales }) : trp("+{parciales} parciales", { parciales }))}</span>}
      {hechos > 0 && <span className="meta ruta-celda-hechos">{plural(hechos, tr("hecho"))}</span>}
      {certeza && <span className={`chip chip-${certeza.tono} ruta-celda-certeza`}>{certeza.etiqueta.replace('Certeza ', '')}</span>}
    </td>
  );
}

/** La tabla de la ruta. `mapa` en null o undefined pinta el aviso de cuándo se
 *  calcula; `estado` es opcional y solo sirve para enlazar las hipótesis de
 *  cada fila por su título. */
export function MapaRuta({ mapa, estado }: { mapa: Mapa | null | undefined; estado?: EstadoRosa }) {
  if (!mapa || typeof mapa !== 'object') {
    return (
      <article className="tarjeta mapa-ruta" aria-label={tr("Mapa de la ruta terapéutica")}>
        <h3 className="mapa-ruta-cabecera">{tr("Mapa de la ruta terapéutica")}</h3>
        <p className="meta">{tr("Se calcula al cerrar la primera iteración: por cada diana con hipótesis vivas, qué pasos de la ruta (del mecanismo a la evidencia en personas) están cubiertos y cuáles están huecos.")}</p>
      </article>
    );
  }
  const filas = Array.isArray(mapa.filas) ? mapa.filas.filter((f) => f && typeof f === 'object') : [];
  // `estado.hipotesis` puede faltar en un estado a medias; sin título se enseña el id, nunca un enlace vacío.
  const hipotesisDelEstado = Array.isArray(estado?.hipotesis) ? estado.hipotesis : [];
  const tituloDe = (id: string) => {
    const t = hipotesisDelEstado.find((h) => h && h.id === id)?.titulo;
    return typeof t === 'string' && t.trim() ? t : id;
  };
  const invId = typeof mapa.investigacionId === 'string' ? mapa.investigacionId : '';
  const iteracion = entero(mapa.iteracion);
  const resumen = texto(mapa.resumen);
  return (
    <article className="tarjeta mapa-ruta" aria-label={tr("Mapa de la ruta terapéutica")}>
      <div className="mapa-ruta-cabecera">
        <h3>{tr("Mapa de la ruta terapéutica")}</h3>
        <span className="meta">{iteracion ? trp("Calculado al cerrar la iteración {iteracion}.", { iteracion }) : tr('Calculado a demanda.')}</span>
      </div>
      {resumen ? <p className="mapa-ruta-resumen">{resumen}</p> : null}
      <p className="meta">
        {tr("Cada columna es un paso de la ruta terapéutica: los ocho pasos que separan un mecanismo de un beneficio para una persona. Pasa el ratón por el nombre del paso para leer qué comprueba. En cada celda, cuántas hipótesis vivas de esa diana cubren el paso; en gris, los pasos que ninguna cubre.")}
      </p>
      {filas.length === 0 ? (
        <p className="meta">{tr("Sin dianas que mapear: hace falta al menos una hipótesis viva en esta investigación (las que no declaran diana se agrupan en la fila \"Sin diana declarada\").")}</p>
      ) : (
        <div className="mapa-ruta-tabla">
          <table className="tabla">
            <thead>
              <tr>
                <th>{tr("Diana o proceso")}</th>
                <th className="num" title={tr("Hipótesis vivas de esta investigación que nombran esta diana.")}>{tr("Hipótesis")}</th>
                {PASOS_RUTA.map((p) => (
                  <th key={p} className="num ruta-paso" title={`${PASO_RUTA[p].etiqueta}: ${DEFINICIONES_PASO[p]}.`}>
                    <span className="ruta-paso-numero">{PASO_RUTA[p].orden}</span> {PASO_RUTA[p].etiqueta}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                // Cada hipótesis una vez aunque el registro la repita (evita enlaces y claves duplicados).
                const hip = [...new Set(Array.isArray(f.hipotesis) ? f.hipotesis.filter((x): x is string => typeof x === 'string' && x !== '') : [])];
                const huecos = new Set(Array.isArray(f.huecos) ? f.huecos : []);
                const pasos = f.pasos && typeof f.pasos === 'object' ? f.pasos : ({} as Partial<Record<PasoRutaTerapeutica, CeldaMapaRuta>>);
                const etiqueta = typeof f.etiqueta === 'string' && f.etiqueta ? f.etiqueta : typeof f.clave === 'string' && f.clave ? f.clave : tr('sin diana');
                return (
                  <tr key={`${f.clave ?? etiqueta}-${i}`}>
                    <td>
                      <strong>{etiqueta}</strong>
                      {hip.length > 0 && (
                        <span className="meta ruta-fila-hip">
                          {hip.slice(0, 4).map((id, j) => (
                            <span key={id}>
                              {j > 0 ? '; ' : ''}
                              <a className="enlace" href={rutaDe(invId, 'hipotesis', id)} title={tituloDe(id)}>
                                {tituloDe(id).length > 60 ? `${tituloDe(id).slice(0, 57)}...` : tituloDe(id)}
                              </a>
                            </span>
                          ))}
                          {hip.length > 4 ? trp(" y {v} más", { v: hip.length - 4 }) : ''}
                        </span>
                      )}
                      {entero(f.hechos) > 0 && <span className="meta ruta-fila-hechos">{trp("{v} del modelo de mundo", { v: plural(entero(f.hechos), tr("hecho")) })}</span>}
                    </td>
                    <td className="num">{hip.length}</td>
                    {PASOS_RUTA.map((p) => (
                      <Celda key={p} celda={pasos[p]} hueco={huecos.has(p)} paso={p} diana={etiqueta} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
