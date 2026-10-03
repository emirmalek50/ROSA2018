// La parte de arriba de la ficha de una investigación, rehecha el 3 de octubre
// de 2026 sobre el diseño "Objetivo y datos · v2": la cabecera con lo que te
// espera al lado, la divisoria (la pregunta y las hipótesis que compiten por
// responderla), la misión con sus reglas, las áreas comparadas con su coste y
// su demora a escala, y los pasos que separan un dataset de un descubrimiento.
//
// Todo sale del estado. El coste, la demora y la factibilidad de cada área los
// escribe ROSA2018 en prosa; aquí se leen con una expresión y, si el texto no
// encaja, se enseña el texto tal cual en vez de inventar la barra.

import { useState, type ReactNode } from 'react';
import { acciones } from '../datos/almacen';
import type { AreaInvestigacion, Corrida, EstadoHipotesis, Hipotesis, Investigacion as Inv } from '../datos/tipos';
import { ESTADO_CORRIDA, ESTADO_HIPOTESIS, ESTADO_INVESTIGACION } from '../lib/etiquetas';
import { coma, formatearDuracion, formatearEntero } from '../lib/formato';
import { primeraFrase } from '../lib/modo';
import { partesAutomatizadas, textoAutomatizacion } from '../lib/parada';
import { rutaDe } from '../lib/ruta';
import { tr, trp } from '../lib/idioma';
import { Chip, Confirmar, Momento, Seccion } from './piezas';
import { FormularioMision, GobiernoArea } from './Rosa2018';

/* Cabecera ------------------------------------------------------------- */

export function CabeceraInvestigacion({ inv, origen, corridas, ahora, irA, alEditarMision, aviso }: { inv: Inv; origen: Inv | null; corridas: Corrida[]; ahora: number; irA: (hash: string) => void; alEditarMision: () => void; aviso: ReactNode }) {
  const ultima = corridas[0];
  return (
    <header className="inv-cabecera">
      <div className="inv-cabecera-texto">
        <div className="inv-meta">
          <span className={`inv-estado inv-estado-${inv.estado}`}>{ESTADO_INVESTIGACION[inv.estado]}</span>
          {inv.vigilarLiteraturaHasta && inv.vigilarLiteraturaHasta > ahora && (
            <span className="inv-meta-dato">
              {tr("Vigilando literatura hasta")} <Momento t={inv.vigilarLiteraturaHasta} ahora={ahora} soloRelativo />
            </span>
          )}
          {ultima && (
            <a className="inv-meta-dato enlace" href={rutaDe(inv.id, 'corrida', ultima.id)}>
              {trp("Corrida {n} · {estado}", { n: ultima.numero, estado: ESTADO_CORRIDA[ultima.estado] })}
            </a>
          )}
          {origen && (
            <span className="inv-meta-dato">
              {tr("Rama de")} <a className="enlace" href={rutaDe(origen.id, 'investigacion')}>{origen.titulo}</a>
            </span>
          )}
        </div>
        <h2>{inv.titulo}</h2>
        <div className="acciones">
          <button type="button" className="btn btn-s" onClick={alEditarMision}>
            {(inv.mision ? tr("Editar la misión") : tr("Escribir la misión"))}
          </button>
          <Confirmar
            etiqueta={tr("Bifurcar")}
            pregunta={tr("Se crea una investigación nueva con el mismo objetivo y una copia del modelo de mundo. La original sigue igual.")}
            pedirTexto={{ etiqueta: tr('Nombre de la rama (di para que es)'), marcador: tr('Secuencia GFAP-NfL solo en Alzheimer familiar') }}
            onConfirmar={(motivo) => {
              const id = acciones.bifurcarInvestigacion(inv.id, motivo);
              if (id) irA(rutaDe(id, 'corrida'));
            }}
          />
        </div>
      </div>
      {aviso}
    </header>
  );
}

/* Divisoria ------------------------------------------------------------ */

/** El orden en que se cuentan las respuestas: lo que más ha avanzado primero. */
const ORDEN_GRUPOS: EstadoHipotesis[] = ['aceptada', 'en_revision', 'refinar', 'aclarando', 'propuesta', 'descartada'];
const MAX_RESPUESTAS = 8;
const ALTO_GRUPO = 30;
const ALTO_FILA = 62;
const ALTO_MAS = 34;
const ALTO_MINIMO = 300;

type Fila = { tipo: 'grupo'; estado: EstadoHipotesis; cuantas: number } | { tipo: 'hip'; h: Hipotesis; centro: number } | { tipo: 'mas'; resto: number };

/** Las filas de la columna de respuestas y la altura que ocupan. Las alturas
 *  son fijas (el título va recortado a dos líneas) para que las curvas del
 *  SVG lleguen al centro de cada fila sin medir el DOM. */
function filasDivisoria(hipotesis: Hipotesis[]) {
  const grupos = ORDEN_GRUPOS.map((e) => ({ estado: e, hs: hipotesis.filter((h) => h.estado === e).sort((a, b) => b.elo - a.elo) })).filter((g) => g.hs.length > 0);
  const filas: Fila[] = [];
  let y = 0;
  let mostradas = 0;
  for (const g of grupos) {
    if (mostradas >= MAX_RESPUESTAS) break;
    filas.push({ tipo: 'grupo', estado: g.estado, cuantas: g.hs.length });
    y += ALTO_GRUPO;
    for (const h of g.hs.slice(0, MAX_RESPUESTAS - mostradas)) {
      filas.push({ tipo: 'hip', h, centro: y + ALTO_FILA / 2 });
      y += ALTO_FILA;
      mostradas++;
    }
  }
  if (hipotesis.length > mostradas) {
    filas.push({ tipo: 'mas', resto: hipotesis.length - mostradas });
    y += ALTO_MAS;
  }
  const alto = Math.max(y, ALTO_MINIMO);
  const desfase = (alto - y) / 2;
  return { filas, alto, desfase };
}

/** "Una propiedad que separe los grupos: A, B, C o D. Debe venir con..." se
 *  parte en la cabeza, las opciones y el resto. Si la primera frase no es una
 *  lista corta, no se parte. */
function partirRelevancia(texto: string) {
  const primera = primeraFrase(texto);
  const resto = texto.trim().slice(primera.length).trim();
  const dos = primera.indexOf(':');
  if (dos < 0) return { cabeza: primera, opciones: [] as string[], resto };
  const opciones = primera
    .slice(dos + 1)
    .replace(/[.]$/, '')
    .split(',')
    .map((p) => p.trim().replace(/^(o|y|u|e)\s+/, ''))
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (opciones.length < 2 || opciones.length > 6 || opciones.some((p) => p.length > 90)) return { cabeza: primera, opciones: [], resto };
  return { cabeza: primera.slice(0, dos).trim(), opciones, resto };
}

export function Divisoria({ inv, hipotesis }: { inv: Inv; hipotesis: Hipotesis[] }) {
  const { filas, alto, desfase } = filasDivisoria(hipotesis);
  const medio = alto / 2;
  const relevancia = inv.relevancia ? partirRelevancia(inv.relevancia) : null;
  const avanzadas = hipotesis.filter((h) => h.estado !== 'propuesta' && h.estado !== 'descartada').length;
  return (
    <section className="divisoria" aria-label={tr("La pregunta y las respuestas candidatas")}>
      <div className="div-rotulos" aria-hidden="true">
        <span>{tr("La pregunta")}</span>
        <span />
        <span>{tr("Respuestas candidatas")}</span>
      </div>
      <div className="div-cuerpo" style={{ height: alto }}>
        <div className="div-objetivo">
          <span className="div-etiqueta">{tr("Objetivo")}</span>
          <p>{inv.objetivo}</p>
        </div>
        <div className="div-centro">
          <svg className="div-lineas" viewBox={`0 0 1000 ${alto}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="div-tronco" d={`M0 ${medio} L470 ${medio}`} />
            {filas.map((f) => {
              if (f.tipo !== 'hip') return null;
              const y = f.centro + desfase;
              return <path key={f.h.id} className={`div-rama div-rama-${f.h.estado}`} d={`M530 ${medio} C 760 ${medio}, 760 ${y}, 1000 ${y}`} />;
            })}
          </svg>
          <div className="div-nodo" style={{ top: medio }}>
            <span className="div-halo" aria-hidden="true" />
            <span className="div-interrogacion" aria-hidden="true">?</span>
          </div>
          <p className="div-nodo-nota" style={{ top: medio + 46 }}>
            {hipotesis.length === 0
              ? tr("Sin respuestas todavía")
              : avanzadas > 0
                ? trp("{n} hipótesis compiten; {k} ya en revisión o más allá", { n: hipotesis.length, k: avanzadas })
                : trp("{n} hipótesis compiten", { n: hipotesis.length })}
          </p>
        </div>
        <ol className="div-respuestas" style={{ paddingTop: desfase }}>
          {hipotesis.length === 0 && <li className="div-vacio meta">{tr("ROSA2018 propondrá las primeras hipótesis en la primera iteración de una corrida.")}</li>}
          {filas.map((f) =>
            f.tipo === 'grupo' ? (
              <li key={`g-${f.estado}`} className={`div-grupo div-grupo-${f.estado}`} style={{ height: ALTO_GRUPO }}>
                {ESTADO_HIPOTESIS[f.estado]} <span>{f.cuantas}</span>
              </li>
            ) : f.tipo === 'hip' ? (
              <li key={f.h.id} className={`div-hip div-hip-${f.h.estado}`} style={{ height: ALTO_FILA }}>
                <a href={rutaDe(inv.id, 'hipotesis', f.h.id)}>
                  <span className="div-hip-titulo">{f.h.titulo}</span>
                  <span className="div-hip-meta">{trp("Elo {elo} · iteración {it}", { elo: Math.round(f.h.elo), it: f.h.iteracion })}</span>
                </a>
              </li>
            ) : (
              <li key="mas" className="div-mas" style={{ height: ALTO_MAS }}>
                <a className="enlace" href={rutaDe(inv.id, 'ranking')}>
                  {trp("{n} más en el ranking", { n: f.resto })}
                </a>
              </li>
            ),
          )}
        </ol>
      </div>
      <footer className="div-cuenta">
        <span className="div-etiqueta">{tr("Cuenta como respuesta")}</span>
        {relevancia === null ? (
          <p className="meta">{tr('Sin definir. ROSA2018 perseguira todo lo que parezca significativo.')}</p>
        ) : (
          <div className="div-cuenta-cuerpo">
            <p>{relevancia.cabeza}{relevancia.opciones.length > 0 ? ':' : ''}</p>
            {relevancia.opciones.length > 0 && (
              <ol className="div-opciones">
                {relevancia.opciones.map((o, i) => (
                  <li key={o}>
                    <span className="div-opcion-n">{String(i + 1).padStart(2, '0')}</span>
                    {o}
                  </li>
                ))}
              </ol>
            )}
            {relevancia.resto && <p className="meta">{relevancia.resto}</p>}
          </div>
        )}
      </footer>
    </section>
  );
}

/* Misión y reglas ------------------------------------------------------ */

/** La primera frase en claro y el resto en gris; con `entero` se ve todo. */
function Campo({ etiqueta, texto, entero }: { etiqueta: string; texto: string; entero: boolean }) {
  const limpio = texto.trim();
  const primera = limpio ? primeraFrase(limpio) : '';
  const resto = limpio.slice(primera.length).trim();
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>
        {limpio === '' ? (
          <span className="meta">{tr('sin fijar')}</span>
        ) : (
          <>
            <span className="mis-lead">{primera}</span>
            {resto && (entero ? <span className="mis-resto">{resto}</span> : <span className="mis-resto mis-resto-corto">{resto}</span>)}
          </>
        )}
      </dd>
    </>
  );
}

const ROLES_RESPONSABLES: { k: keyof NonNullable<NonNullable<Inv['mision']>['responsables']>; label: string }[] = [
  { k: 'patrocinador', label: 'Patrocinador' },
  { k: 'liderCientifico', label: 'Líder científico' },
  { k: 'metodos', label: 'Métodos' },
  { k: 'datos', label: 'Datos' },
  { k: 'ingenieria', label: 'Ingeniería' },
  { k: 'laboratorio', label: 'Laboratorio' },
  { k: 'evaluacion', label: 'Evaluación' },
];

function Reglas({ inv, corridas }: { inv: Inv; corridas: Corrida[] }) {
  const m = inv.mision;
  const corrida = corridas[0];
  const pausada = corrida?.estado === 'pausada_por_presupuesto';
  const limite = corrida?.presupuesto.limiteLlamadas ?? 0;
  const fraccion = corrida && limite > 0 ? Math.min(1, corrida.gasto.llamadas / limite) : 0;
  const usd = corrida ? corrida.gasto.usdReal ?? corrida.gasto.usd : undefined;
  const responsables = m?.responsables ? ROLES_RESPONSABLES.filter((r) => m.responsables?.[r.k]) : [];
  return (
    <aside className="mis-reglas" aria-label={tr("Reglas de la investigación")}>
      <div className="mis-regla">
        <span className="div-etiqueta">{tr("Límites")}</span>
        {inv.limites.length === 0 ? (
          <p className="meta">{tr("Sin límites escritos.")}</p>
        ) : (
          <ul className="mis-limites">
            {inv.limites.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="mis-regla">
        <span className="div-etiqueta">{tr("Presupuesto")}</span>
        {corrida ? (
          <>
            <div className="mis-gasto">
              <strong>
                {formatearEntero(corrida.gasto.llamadas)} <span>/ {formatearEntero(limite)}</span>
              </strong>
              {pausada && <Chip tono="aviso">{tr("Pausada por presupuesto")}</Chip>}
            </div>
            <div className={`mis-barra ${pausada ? 'mis-barra-aviso' : ''}`} role="img" aria-label={trp("{a} de {b} llamadas", { a: corrida.gasto.llamadas, b: limite })}>
              <span style={{ width: `${fraccion * 100}%` }} />
            </div>
            <p className="meta">
              {trp("Llamadas de la corrida {n}", { n: corrida.numero })}
              {usd !== undefined && ` · ${coma(usd.toFixed(1))} USD`}
              {` · ${formatearDuracion(corrida.gasto.segundos * 1000)}`}
            </p>
            {pausada && corrida.presupuesto.motivoPausa && <p className="meta">{corrida.presupuesto.motivoPausa}</p>}
          </>
        ) : (
          <p className="meta">{tr("Ninguna corrida ha gastado todavía.")}</p>
        )}
        {m && <p className="meta">{trp("Tope de la misión: {llamadas} llamadas · {v} USD · {horas} h", { llamadas: formatearEntero(m.presupuesto.llamadas), v: m.presupuesto.usd.toFixed(0), horas: m.presupuesto.horas })}</p>}
      </div>
      <div className="mis-regla">
        <span className="div-etiqueta">{tr("Parada y revisión")}</span>
        <p className="mis-parada">{inv.condicionParada || tr('sin fijar')}</p>
        <p className="meta">{textoAutomatizacion(inv.condicionParadaAutomatizada ?? partesAutomatizadas(inv.condicionParada))}</p>
        <div className="mis-revisores">
          <span className="meta">{tr("Quien revisa")}</span>
          <div className="acciones">
            {inv.revisores.length === 0 ? (
              <span className="meta">{tr("nadie todavía")}</span>
            ) : (
              inv.revisores.map((r) => (
                <Chip key={r} tono="borde">
                  {r}
                </Chip>
              ))
            )}
          </div>
        </div>
        {m &&
          (responsables.length > 0 ? (
            <p className="meta">{responsables.map((r) => `${tr(r.label)}: ${m.responsables?.[r.k]}`).join(' · ')}</p>
          ) : (
            <div className="mis-sin-responsables">
              <strong>{tr("Responsables sin asignar")}</strong>
              <span>{tr("Quien escribe una conclusión no puede ser su único evaluador.")}</span>
            </div>
          ))}
      </div>
    </aside>
  );
}

export function MisionYReglas({ inv, corridas, editando, alCerrarEdicion, alEditar }: { inv: Inv; corridas: Corrida[]; editando: boolean; alCerrarEdicion: () => void; alEditar: () => void }) {
  const [entera, setEntera] = useState(false);
  const m = inv.mision;
  const formulario = editando || !m;
  return (
    <Seccion
      id="mision"
      titulo={tr("La misión")}
      nota={tr("El marco que fija el programa antes de la primera corrida (etapa 0 de ROSA2018): a quién aplica, en qué etapa, en qué célula o tejido, qué mecanismo, qué tipo de resultado se busca, qué puede hacer el laboratorio y con qué presupuesto. ROSA2018 propone; una persona aprueba.")}
      acciones={
        m && !editando ? (
          <div className="acciones">
            {m.aprobadaEn ? (
              <Chip tono="ok" title={trp("Aprobada por {v}", { v: m.aprobadaPor ?? tr('una persona') })}>
                {tr("Aprobada")} <Momento t={m.aprobadaEn} ahora={Date.now()} soloRelativo />
              </Chip>
            ) : (
              <Chip tono="aviso">{tr("Propuesta por ROSA2018: falta tu aprobación")}</Chip>
            )}
            {m.propuestaPorRosa && <span className="meta">{tr("Valores propuestos por ROSA2018")}</span>}
            {!m.aprobadaEn && (
              <button type="button" className="btn btn-primario btn-s" onClick={() => acciones.aprobarMision(inv.id, {})}>
                {tr("Aprobar tal cual")}
              </button>
            )}
            <button type="button" className="btn btn-s" onClick={alEditar}>
              {(m.aprobadaEn ? tr("Editar") : tr("Corregir y aprobar"))}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mis-rejilla">
        <div className="mis-ficha">
          {formulario ? (
            <>
              {!m && <p className="meta">{tr("ROSA2018 propondrá la misión al arrancar la primera corrida. También puedes escribirla tú aquí.")}</p>}
              <FormularioMision key={editando ? 'editando' : 'nueva'} inv={inv} corridas={corridas} abiertoEnEdicion alCerrar={alCerrarEdicion} />
            </>
          ) : (
            <>
              <dl className="mis-campos">
                <Campo etiqueta={tr("Población")} texto={m.poblacion} entero={entera} />
                <Campo etiqueta={tr("Etapa")} texto={m.etapa} entero={entera} />
                <Campo etiqueta={tr("Célula o tejido")} texto={m.celulaTejido} entero={entera} />
                <Campo etiqueta={tr("Mecanismo")} texto={m.mecanismo} entero={entera} />
                <Campo etiqueta={tr("Tipo de intervención")} texto={m.tipoIntervencion} entero={entera} />
                <dt>{tr("Capacidades")}</dt>
                <dd>
                  {m.capacidadesLaboratorio.length === 0 ? (
                    <span className="meta">{tr('sin declarar')}</span>
                  ) : (
                    <>
                      <span className="mis-lead">{(entera ? m.capacidadesLaboratorio : m.capacidadesLaboratorio.slice(0, 3)).map((c) => `${c.trim().replace(/[.;,]+$/, '')}.`).join(' ')}</span>
                      {!entera && m.capacidadesLaboratorio.length > 3 && <span className="mis-resto">{trp("y {n} más", { n: m.capacidadesLaboratorio.length - 3 })}</span>}
                    </>
                  )}
                </dd>
              </dl>
              <button type="button" className="btn btn-fantasma btn-s mis-leer" aria-expanded={entera} onClick={() => setEntera((v) => !v)}>
                {(entera ? tr("Ver la misión resumida") : tr("Leer la misión completa"))}
              </button>
            </>
          )}
        </div>
        <Reglas inv={inv} corridas={corridas} />
      </div>
    </Seccion>
  );
}

/* Áreas comparadas ----------------------------------------------------- */

const MESES_A_SEMANAS = 4.35;

/** "10.000–20.000 € por campaña" o "Orden de 5.000–15.000 EUR" -> el rango y
 *  la moneda. "10^4–10^5 USD" no se lee: se enseña el texto. */
function leerCoste(texto: string): { min: number; max: number; moneda: string } | null {
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)\s*[–-]\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*(€|EUR|USD|\$)/.exec(texto);
  if (!m) return null;
  const n = (s: string) => Number(s.replace(/\./g, ''));
  const min = n(m[1]!);
  const max = n(m[2]!);
  if (!(max >= min && min >= 0)) return null;
  return { min, max, moneda: m[3] === 'EUR' ? '€' : m[3] === '$' ? 'USD' : m[3]! };
}

/** "8–12 semanas tras la auditoría" -> 8 a 12 semanas; los meses se pasan a semanas. */
function leerDemora(texto: string): { min: number; max: number; etiqueta: string } | null {
  const m = /(\d+)\s*[–-]\s*(\d+)\s*(semanas|meses)/.exec(texto);
  if (!m) return null;
  const f = m[3] === 'meses' ? MESES_A_SEMANAS : 1;
  return { min: Number(m[1]) * f, max: Number(m[2]) * f, etiqueta: m[3] === 'meses' ? trp("{a}–{b} meses", { a: m[1]!, b: m[2]! }) : trp("{a}–{b} sem.", { a: m[1]!, b: m[2]! }) };
}

const NIVEL_FACTIBILIDAD: Record<string, number> = { alta: 3, 'media-alta': 3, media: 2, 'media-baja': 1, baja: 1, limitada: 1 };

/** ROSA2018 cierra el valor de intervención con "Impacto alto y factibilidad media". */
function leerFactibilidad(texto: string): { nivel: number; etiqueta: string; impacto: string | null } | null {
  const f = /factibilidad\s+(media-alta|media-baja|alta|media|baja|limitada)/i.exec(texto);
  const i = /impacto(?:\s+potencial)?\s+(alto|medio|bajo)/i.exec(texto);
  if (!f) return null;
  const clave = f[1]!.toLowerCase();
  return { nivel: NIVEL_FACTIBILIDAD[clave] ?? 1, etiqueta: clave.charAt(0).toUpperCase() + clave.slice(1), impacto: i ? i[1]!.toLowerCase() : null };
}

/** El tope del eje: el siguiente 1, 2, 2,5 o 5 por potencia de diez. */
function topeEje(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function miles(n: number, moneda: string): string {
  return (n >= 1000 ? `${coma(String(Math.round(n / 100) / 10))}k ${moneda}` : `${n} ${moneda}`).trim();
}

const ESTADO_AREA: Record<AreaInvestigacion['estado'], { etiqueta: string; tono: 'acento' | 'borde' | 'aviso' | 'neutro' }> = {
  elegida: { etiqueta: 'Elegida', tono: 'acento' },
  propuesta: { etiqueta: 'Propuesta', tono: 'neutro' },
  pausada: { etiqueta: 'Pausada', tono: 'aviso' },
  sin_explorar: { etiqueta: 'Sin explorar', tono: 'borde' },
};

function Rango({ min, max, tope, etiqueta, activa }: { min: number; max: number; tope: number; etiqueta: string; activa: boolean }) {
  return (
    <div className="area-rango">
      <div className="area-pista">
        <span className={activa ? 'area-tramo' : 'area-tramo area-tramo-gris'} style={{ left: `${(min / tope) * 100}%`, width: `${Math.max(1.5, ((max - min) / tope) * 100)}%` }} />
      </div>
      <span className="area-rango-texto">{etiqueta}</span>
    </div>
  );
}

function FilaAreaFicha({ inv, a, corridas, ejeCoste, ejeDemora }: { inv: Inv; a: AreaInvestigacion; corridas: Corrida[]; ejeCoste: { tope: number; moneda: string } | null; ejeDemora: number | null }) {
  const [abierta, setAbierta] = useState(false);
  const dos = a.titulo.indexOf(':');
  const nombre = dos > 0 && dos < 60 ? a.titulo.slice(0, dos).trim() : a.titulo;
  const pregunta = dos > 0 && dos < 60 ? a.titulo.slice(dos + 1).trim() : '';
  const coste = leerCoste(a.coste);
  const demora = leerDemora(a.demora);
  const fact = leerFactibilidad(a.valorIntervencion);
  const activa = a.estado === 'elegida';
  const campana = corridas.find((c) => c.id === a.corridaId);
  const estado = ESTADO_AREA[a.estado];
  return (
    <>
      <tr className={`area-fila ${activa ? 'area-fila-elegida' : ''}`}>
        <td>
          <button type="button" className="area-nombre" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
            <span className="area-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
            <span>
              <strong>{nombre}</strong>
              {pregunta && <span className="area-pregunta">{pregunta}</span>}
            </span>
          </button>
        </td>
        <td className="area-familia">{a.familiaMecanismo}</td>
        <td>
          {fact ? (
            <div className="area-fact" title={a.valorIntervencion}>
              <span className="area-segmentos" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <i key={n} className={n <= fact.nivel ? 'lleno' : ''} />
                ))}
              </span>
              <span>{tr(fact.etiqueta)}</span>
              {fact.impacto && <span className="area-impacto">{trp("impacto {v}", { v: tr(fact.impacto) })}</span>}
            </div>
          ) : (
            <span className="meta">{tr("sin dato")}</span>
          )}
        </td>
        <td>
          {coste && ejeCoste && coste.moneda === ejeCoste.moneda ? (
            <Rango min={coste.min} max={coste.max} tope={ejeCoste.tope} etiqueta={`${miles(coste.min, '')}–${miles(coste.max, coste.moneda)}`} activa={activa} />
          ) : (
            <span className="meta area-texto-crudo">{a.coste.split(/[;,]/)[0]}</span>
          )}
        </td>
        <td>
          {demora && ejeDemora ? <Rango min={demora.min} max={demora.max} tope={ejeDemora} etiqueta={demora.etiqueta} activa={activa} /> : <span className="meta area-texto-crudo">{a.demora.split(/[;,]/)[0]}</span>}
        </td>
        <td className="area-estado">
          <Chip tono={estado.tono}>{tr(estado.etiqueta)}</Chip>
          {campana && <span className="meta">{trp("Campaña {numero}", { numero: campana.numero })}</span>}
          {a.estado !== 'elegida' && (
            <button type="button" className="btn btn-s" onClick={() => acciones.cambiarEstadoArea(inv.id, a.id, 'elegida', '', undefined, a.estado === 'pausada' ? 'reabierta' : 'elegida')}>
              {(a.estado === 'pausada' ? tr("Reabrir") : tr("Elegir"))}
            </button>
          )}
        </td>
      </tr>
      {abierta && (
        <tr className="area-detalle">
          <td colSpan={6}>
            <div className="area-detalle-rejilla">
              <dl>
                <dt>{tr("Valor de intervención")}</dt>
                <dd>{a.valorIntervencion}</dd>
                <dt>{tr("Relevancia")}</dt>
                <dd>{a.relevancia}</dd>
                <dt>{tr("Comprobabilidad")}</dt>
                <dd>{a.comprobabilidad}</dd>
                <dt>{tr("Incertidumbre")}</dt>
                <dd>{a.incertidumbre}</dd>
                <dt>{tr("Coste")}</dt>
                <dd>{a.coste}</dd>
                <dt>{tr("Demora")}</dt>
                <dd>{a.demora}</dd>
                {a.dependeDe && (
                  <>
                    <dt>{tr("Depende de")}</dt>
                    <dd>{a.dependeDe}</dd>
                  </>
                )}
                {a.estado === 'pausada' && a.condicionReapertura && (
                  <>
                    <dt>{tr("Se reabre si")}</dt>
                    <dd>{a.condicionReapertura}</dd>
                  </>
                )}
              </dl>
              <div className="area-gobierno">
                <span className="div-etiqueta">{tr("Gobierno")}</span>
                <GobiernoArea inv={inv} a={a} corridas={corridas} />
                {(a.historial?.length ?? 0) > 0 && (
                  <ul className="lista-plana area-historial">
                    {a.historial!.map((hi, i) => (
                      <li key={i} className="meta">
                        {new Date(hi.fecha).toLocaleDateString()} · {hi.de === hi.a ? hi.motivo : `${ESTADO_AREA[hi.de]?.etiqueta ?? hi.de} → ${ESTADO_AREA[hi.a]?.etiqueta ?? hi.a}${hi.motivo ? ` (${hi.motivo})` : ''}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AreasComparadas({ inv, corridas }: { inv: Inv; corridas: Corrida[] }) {
  const areas = inv.mision?.areas ?? [];
  if (areas.length === 0) return null;
  const elegidas = areas.filter((a) => a.estado === 'elegida').length;
  const costes = areas.map((a) => leerCoste(a.coste)).filter((c): c is NonNullable<typeof c> => c !== null);
  const moneda = costes[0]?.moneda;
  const ejeCoste = moneda ? { tope: topeEje(Math.max(...costes.filter((c) => c.moneda === moneda).map((c) => c.max))), moneda } : null;
  const demoras = areas.map((a) => leerDemora(a.demora)).filter((d): d is NonNullable<typeof d> => d !== null);
  const ejeDemora = demoras.length > 0 ? topeEje(Math.max(...demoras.map((d) => d.max))) : null;
  const titulo =
    areas.length === 1
      ? tr("Un área comparada.")
      : elegidas === 0
        ? trp("{n} áreas comparadas, ninguna elegida todavía.", { n: areas.length })
        : elegidas === 1
          ? trp("{n} áreas comparadas. Empieza por una.", { n: areas.length })
          : trp("{n} áreas comparadas. Empieza por {k}.", { n: areas.length, k: elegidas });
  return (
    <Seccion
      id="areas"
      titulo={titulo}
      nota={tr("ROSA2018 las compara por relevancia para la meta, valor de intervención, incertidumbre, comprobabilidad, coste, demora y dependencia, conservando familias de mecanismo distintas. La disponibilidad de datos no sustituye a la relevancia. Un mecanismo desconocido sigue siendo una explicación permitida.")}
    >
      <div className="tabla-desliza">
        <table className="tabla areas-tabla">
          <thead>
            <tr>
              <th>{tr("Área y pregunta")}</th>
              <th>{tr("Familia")}</th>
              <th>{tr("Factibilidad")}</th>
              <th>
                <span>{tr("Coste por campaña")}</span>
                {ejeCoste && (
                  <span className="area-eje" aria-hidden="true">
                    <span>0</span>
                    <span>{miles(ejeCoste.tope / 2, '')}</span>
                    <span>{miles(ejeCoste.tope, ejeCoste.moneda)}</span>
                  </span>
                )}
              </th>
              <th>
                <span>{tr("Demora")}</span>
                {ejeDemora && (
                  <span className="area-eje" aria-hidden="true">
                    <span>0</span>
                    <span>{ejeDemora / 2}</span>
                    <span>{trp("{n} sem.", { n: ejeDemora })}</span>
                  </span>
                )}
              </th>
              <th>{tr("Estado")}</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <FilaAreaFicha key={a.id} inv={inv} a={a} corridas={corridas} ejeCoste={ejeCoste} ejeDemora={ejeDemora} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta areas-nota">{tr("Coste, demora y factibilidad leídos del texto de ROSA2018. Abre un área para leerlo entero y gobernarla.")}</p>
    </Seccion>
  );
}

/* Del dataset al descubrimiento ---------------------------------------- */

type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

const CAMPOS_LIBRO = ['origen', 'version', 'licencia', 'permisos'] as const;

/** Los cinco campos del libro que la ficha cuenta: origen, versión, licencia,
 *  permisos y si el uso con IA está autorizado (desconocido no cuenta). */
function camposLibro(d: Inv['datasets'][number]): number {
  const p = d.procedencia;
  if (!p) return 0;
  return CAMPOS_LIBRO.filter((k) => (p[k] ?? '').trim() !== '').length + (p.usoIAAutorizado !== 'desconocido' ? 1 : 0);
}

export function PasosDatos({ inv }: { inv: Inv }) {
  const ds = inv.datasets;
  const puerta = inv.puertaReproduccion;
  const libros = ds.map(camposLibro);
  const librosCompletos = libros.filter((n) => n === 5).length;
  const aprobados = ds.filter((d) => d.estado === 'aprobado').length;
  const puertaAbierta = !puerta || puerta.estado !== 'bloqueada';
  const hechos = [ds.length > 0, ds.length > 0 && librosCompletos === ds.length, ds.length > 0 && aprobados === ds.length, puertaAbierta];
  const pasos: { titulo: string; nota: string; hecho: boolean }[] = [
    { titulo: tr("Dataset subido"), nota: ds.length === 0 ? tr("ninguno") : ds.length === 1 ? tr("1 fichero") : trp("{n} ficheros", { n: ds.length }), hecho: hechos[0]! },
    { titulo: tr("Libro de procedencia"), nota: ds.length === 0 ? tr("sin dataset") : ds.length === 1 ? trp("{k} de 5 campos", { k: libros[0]! }) : trp("{k} de {n} completos", { k: librosCompletos, n: ds.length }), hecho: hechos[1]! },
    { titulo: tr("Contrato de datos"), nota: ds.length === 0 ? tr("sin dataset") : ds.length === 1 ? (aprobados === 1 ? tr("aprobado") : ds[0]!.estado === 'rechazado' ? tr("rechazado") : tr("por aprobar")) : trp("{k} de {n} aprobados", { k: aprobados, n: ds.length }), hecho: hechos[2]! },
    { titulo: tr("Reproducción"), nota: !puerta ? tr("sin puerta") : puerta.estado === 'eximida' ? tr("eximida") : trp("{a} de {b}", { a: puerta.superadas, b: puerta.requeridas }), hecho: hechos[3]! },
    { titulo: tr("Descubrimiento"), nota: hechos[2] && hechos[3] ? tr("habilitado") : tr("bloqueado"), hecho: Boolean(hechos[2] && hechos[3]) },
  ];
  const actual = pasos.findIndex((p) => !p.hecho);
  const estadoDe = (i: number): EstadoPaso => (pasos[i]!.hecho ? 'hecho' : i === actual ? 'actual' : 'pendiente');
  return (
    <ol className="pasos-datos" aria-label={tr("Del dataset al descubrimiento")}>
      {pasos.map((p, i) => (
        <li key={p.titulo} className={`paso-dato paso-${estadoDe(i)}`} aria-current={i === actual ? 'step' : undefined}>
          <span className="paso-marca" aria-hidden="true">
            {p.hecho ? (
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span className="paso-texto">
            <strong>{p.titulo}</strong>
            <span>{p.nota}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
