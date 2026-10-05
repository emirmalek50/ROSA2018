// Los paneles de la corrida en vivo bajo el recorrido (diseño "Corrida en vivo
// · v1", 5 de octubre de 2026): lo que van encontrando las búsquedas, lo que
// lleva gastado, la corrida en el tiempo con sus condiciones de parada,
// dirigir la corrida y las tarjetas de "Más de esta corrida". Cada cifra sale
// del registro (lib/escenario.ts y la corrida); nada se escribe a mano.

import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { Corrida } from '../datos/tipos';
import { Contexto } from './Contexto';
import { IconoEsc, type NombreIcono } from './IconosEscenario';
import type { Busqueda, Limite, TramoIteracion } from '../lib/escenario';
import { coma, formatearCompacto, formatearDuracion, formatearEntero } from '../lib/formato';
import { tr, trp } from '../lib/idioma';
import { useMovimientoReducido } from '../lib/movimiento';

// ---------------------------------------------------------------- búsquedas

type Filtro = 'todas' | 'pubmed' | 'exa' | 'epmc' | 'otra';

const FILTROS: { clave: Exclude<Filtro, 'todas'>; nombre: string }[] = [
  { clave: 'pubmed', nombre: 'PubMed' },
  { clave: 'exa', nombre: 'Exa' },
  { clave: 'epmc', nombre: 'Europe PMC' },
  { clave: 'otra', nombre: 'Otras' },
];

/** Exa y su literatura gris van juntas en el filtro. */
const filtroDe = (b: Busqueda['base']): Exclude<Filtro, 'todas'> => (b === 'gris' ? 'exa' : b);

const FILAS = 8;

export function BusquedasDeLaIteracion({ busquedas, consultas, onVerTodas }: { busquedas: Busqueda[]; consultas: number; onVerTodas?: () => void }) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const presentes = FILTROS.filter((f) => busquedas.some((b) => filtroDe(b.base) === f.clave));
  const vistas = busquedas.filter((b) => filtro === 'todas' || filtroDe(b.base) === filtro);
  return (
    <section className="esc-tarjeta esc-busquedas" aria-label={tr('Lo que va encontrando')}>
      <header className="esc-tarjeta-cabecera">
        <div>
          <h3>{tr('Lo que va encontrando')}</h3>
          <p>{tr('Cada búsqueda de esta iteración: dónde buscó, cuánto salió y cuánto sirve.')}</p>
        </div>
        <div className="esc-segmentos" role="group" aria-label={tr('Filtrar por base')}>
          <button type="button" aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
            {trp('Todas · {n}', { n: busquedas.length })}
          </button>
          {presentes.map((f) => (
            <button key={f.clave} type="button" aria-pressed={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
              {f.clave === 'otra' ? tr(f.nombre) : f.nombre}
            </button>
          ))}
        </div>
      </header>
      <ul className="esc-filas">
        {vistas.slice(0, FILAS).map((b) => {
          const texto = b.salen > 0 ? b.enteros / b.salen : 0;
          const rel = b.salen > 0 ? Math.max(0, b.sirven - b.enteros) / b.salen : 0;
          return (
            <li key={b.id} className={`esc-fila esc-base-${b.base}`}>
              <span className="esc-fila-fuente">
                <i aria-hidden="true" />
                {b.fuente}
              </span>
              <span className="esc-fila-medio">
                <span className="esc-fila-titulo" title={b.titulo}>
                  {b.titulo}
                </span>
                <span className="esc-rendimiento" aria-hidden="true">
                  <i className="esc-rend-texto" style={{ width: `${texto * 100}%` }} />
                  <i className="esc-rend-rel" style={{ width: `${rel * 100}%` }} />
                </span>
              </span>
              <span className="esc-fila-cifras">
                <span>
                  <b>{formatearEntero(b.salen)}</b>
                  <small>{tr('salen')}</small>
                </span>
                <span className={b.sirven > 0 ? 'esc-cifra-viva' : ''}>
                  <b>{formatearEntero(b.sirven)}</b>
                  <small>{tr('sirven')}</small>
                </span>
                <span className={b.enteros > 0 ? 'esc-cifra-viva' : ''}>
                  <b>{formatearEntero(b.enteros)}</b>
                  <small>{tr('enteros')}</small>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {onVerTodas && (
        <button type="button" className="esc-enlace" onClick={onVerTodas}>
          {trp('Ver las {n} búsquedas y sus consultas exactas', { n: Math.max(consultas, busquedas.length) })}
          <IconoEsc nombre="chevron-right" size={14} />
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- gasto

const R_ANILLO = 40;
const LARGO_ANILLO = 2 * Math.PI * R_ANILLO;

export interface FilaGasto {
  icono: NombreIcono;
  nombre: string;
  valor: ReactNode;
  title?: string;
}

export function LoQueLlevaGastado({ corrida, usd, usdTitle, filas }: { corrida: Corrida; usd: number | null; usdTitle?: string; filas: FilaGasto[] }) {
  const reducido = useMovimientoReducido();
  const g = corrida.gasto;
  const tope = corrida.presupuesto.limiteLlamadas;
  const f = tope > 0 ? Math.max(0, Math.min(1, g.llamadas / tope)) : 0;
  const aviso = f > 0.85;
  return (
    <section className="esc-tarjeta esc-gasto" aria-label={tr('Lo que lleva gastado')}>
      <header className="esc-gasto-cabecera">
        <h3>{tr('Lo que lleva gastado')}</h3>
        {tope > 0 && <span>{trp('tope: {n} llamadas', { n: formatearEntero(tope) })}</span>}
      </header>
      <div className="esc-gasto-principal">
        {tope > 0 && (
          <span className={`esc-anillo ${aviso ? 'esc-anillo-aviso' : ''}`}>
            <svg viewBox="0 0 92 92" width="92" height="92" aria-hidden="true">
              <circle cx="46" cy="46" r={R_ANILLO} className="esc-anillo-pista" />
              <motion.circle
                cx="46"
                cy="46"
                r={R_ANILLO}
                className="esc-anillo-valor"
                strokeDasharray={LARGO_ANILLO}
                initial={reducido ? false : { strokeDashoffset: LARGO_ANILLO }}
                animate={{ strokeDashoffset: LARGO_ANILLO * (1 - f) }}
                transition={reducido ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </svg>
            <span className="esc-anillo-texto">
              <b>{Math.round(f * 100)} %</b>
              <small>{tr('del tope')}</small>
            </span>
          </span>
        )}
        <div className="esc-gasto-llamadas">
          <b>{formatearEntero(g.llamadas)}</b>
          <span>{tr('llamadas al modelo')}</span>
          {tope > 0 && <small>{trp('quedan {n} antes de pausar', { n: formatearEntero(Math.max(0, tope - g.llamadas)) })}</small>}
        </div>
      </div>
      <div className="esc-gasto-rejilla">
        <div title={usdTitle}>
          <b>{usd !== null ? coma(usd.toFixed(2)) : '0'}</b>
          <span>{tr('USD gastados')}</span>
        </div>
        <div>
          <b>{formatearEntero(g.articulosLeidos)}</b>
          <span>{tr('artículos leídos')}</span>
        </div>
        <div>
          <b>{formatearCompacto(g.tokensEntrada)}</b>
          <span>{tr('tokens de entrada')}</span>
        </div>
        <div>
          <b>{formatearCompacto(g.tokensSalida)}</b>
          <span>{tr('tokens de salida')}</span>
        </div>
      </div>
      <div className="esc-gasto-lista">
        <span className="esc-rotulo">{tr('En esta corrida')}</span>
        <ul>
          {filas.map((x) => (
            <li key={x.nombre} title={x.title}>
              <IconoEsc nombre={x.icono} size={14} />
              <span>{x.nombre}</span>
              <b>{x.valor}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** El valor "contexto ocupado" de la lista: el anillo pequeño de siempre. */
export function ValorContexto({ corrida, ahora }: { corrida: Corrida; ahora: number }) {
  return <Contexto c={corrida.contexto} ahora={ahora} />;
}

// ------------------------------------------------------ la corrida en el tiempo

const ALTO_BARRAS = 112;
const MAX_POR_VENIR = 8;

export function LaCorridaEnElTiempo({ tramos, maxIteraciones, limites, horas }: { tramos: TramoIteracion[]; maxIteraciones: number | null; limites: Limite[]; horas: number | null }) {
  const reducido = useMovimientoReducido();
  const maxLlamadas = Math.max(1, ...tramos.map((t) => t.llamadas));
  const maxHechos = Math.max(1, ...tramos.map((t) => t.hechos ?? 0));
  const ultimo = tramos.length > 0 ? tramos[tramos.length - 1]!.numero : 0;
  const porVenir = maxIteraciones && maxIteraciones > ultimo ? Array.from({ length: Math.min(MAX_POR_VENIR, maxIteraciones - ultimo) }, (_, i) => ultimo + i + 1) : [];
  const metas = [horas ? formatearDuracion(horas * 3_600_000) : null, maxIteraciones ? (maxIteraciones === 1 ? tr('1 iteración') : trp('{n} iteraciones', { n: maxIteraciones })) : null].filter((x): x is string => x !== null);
  const alto = (v: number, max: number) => Math.max(6, Math.round((v / max) * ALTO_BARRAS));
  return (
    <section className="esc-tarjeta esc-tiempo-corrida" aria-label={tr('La corrida en el tiempo')}>
      <header className="esc-tarjeta-cabecera">
        <div>
          <h3>{tr('La corrida en el tiempo')}</h3>
          <p>
            {tr('Cada iteración aprende de la anterior.')}
            {metas.length > 0 && ` ${trp('Se detiene sola al llegar a {v}.', { v: metas.join(tr(' o a ')) })}`}
          </p>
        </div>
        <ul className="esc-leyenda">
          <li>
            <i className="esc-punto-llamadas" />
            {tr('llamadas')}
          </li>
          <li>
            <i className="esc-punto-hecho" />
            {tr('hechos nuevos')}
          </li>
        </ul>
      </header>
      <div className="esc-tiempo-cuerpo">
        <ol className="esc-tramos">
          {tramos.map((t, i) => (
            <li key={t.numero} className={`esc-tramo-it ${t.abierta ? 'esc-tramo-it-abierta' : ''}`}>
              <div className="esc-tramo-it-cabecera">
                <strong>{trp('Iteración {n}', { n: t.numero })}</strong>
                <span>{t.abierta ? tr('en curso') : tr('cerrada')}</span>
              </div>
              <div className="esc-barras" aria-hidden="true">
                <motion.i
                  className="esc-barra-llamadas"
                  initial={reducido ? false : { height: 0 }}
                  animate={{ height: alto(t.llamadas, maxLlamadas) }}
                  transition={reducido ? { duration: 0 } : { duration: 0.7, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                />
                <motion.i
                  className={`esc-barra-hechos ${t.hechos === null ? 'esc-barra-pendiente' : ''}`}
                  initial={reducido ? false : { height: 0 }}
                  animate={{ height: t.hechos === null ? 6 : alto(t.hechos, maxHechos) }}
                  transition={reducido ? { duration: 0 } : { duration: 0.7, delay: i * 0.06 + 0.05, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <div className="esc-tramo-it-cifras">
                <span>
                  <b>{formatearEntero(t.llamadas)}</b> {tr('llamadas')}
                </span>
                <span className="esc-tramo-it-hechos">{t.hechos === null ? tr('en curso') : t.hechos === 1 ? tr('1 hecho') : trp('{n} hechos', { n: t.hechos })}</span>
                {t.usd !== null && <small>{trp('{v} USD', { v: coma(t.usd.toFixed(2)) })}</small>}
              </div>
            </li>
          ))}
          {porVenir.map((n) => (
            <li key={n} className="esc-tramo-futuro">
              <b>{n}</b>
              <small>{tr('por venir')}</small>
            </li>
          ))}
        </ol>
        {limites.length > 0 && (
          <aside className="esc-parada">
            <strong>{tr('Cuándo se detiene')}</strong>
            <ul>
              {limites.map((l) => (
                <li key={l.nombre}>
                  <span className="esc-parada-fila">
                    <span>{l.nombre}</span>
                    <b>{l.valor}</b>
                  </span>
                  <span className={`esc-parada-barra ${l.aviso ? 'esc-parada-aviso' : ''}`} aria-hidden="true">
                    <i style={{ transform: `scaleX(${l.fraccion})` }} />
                  </span>
                </li>
              ))}
            </ul>
            <small>{tr('Lo primero que llegue pausa la corrida y te avisa.')}</small>
          </aside>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ dirigir

export function DirigirLaCorrida({ desde, tema, autoaprobar, onAutoaprobar, onEnviar }: { desde: string; tema: string | null; autoaprobar: boolean; onAutoaprobar: (v: boolean) => void; onEnviar: (texto: string) => void }) {
  const [texto, setTexto] = useState('');
  const sugerencias = [tema ? trp('Profundiza en {tema}', { tema }) : null, tr('Más ensayos de fase 3'), tr('Menos literatura gris')].filter((x): x is string => x !== null);
  return (
    <section className="esc-dirigir" aria-label={tr('Dirigir la corrida')}>
      <header>
        <span className="esc-dirigir-icono" aria-hidden="true">
          <IconoEsc nombre="compass" size={18} />
        </span>
        <div>
          <h3>{tr('Dirigir la corrida')}</h3>
          <p>{tr('El cerebro lo lee al planear el siguiente paso. No hace falta pausar.')}</p>
        </div>
        <span className="esc-dirigir-desde">{desde}</span>
      </header>
      <div className="esc-dirigir-caja">
        <textarea
          value={texto}
          rows={2}
          placeholder={tr('Por ejemplo: prioriza ensayos con biomarcadores de plasma y descarta modelos animales…')}
          onChange={(e) => setTexto(e.target.value)}
          aria-label={tr('Indicación para ROSA2018')}
        />
        <div className="esc-dirigir-pie">
          <div className="esc-sugerencias">
            {sugerencias.map((s) => (
              <button key={s} type="button" className="esc-chip" onClick={() => setTexto(s)}>
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="esc-enviar"
            disabled={texto.trim() === ''}
            onClick={() => {
              onEnviar(texto);
              setTexto('');
            }}
          >
            {tr('Enviar al cerebro')}
            <IconoEsc nombre="arrow-up" size={14} />
          </button>
        </div>
      </div>
      {/* Visible durante toda la corrida, no solo mientras un plan espera: dos
          corridas perdieron su tiempo porque la casilla solo aparecía en ese
          momento y nadie la vio (Emir, 17 de septiembre de 2026). */}
      <label className="interruptor esc-autoaprobar">
        <input type="checkbox" checked={autoaprobar} onChange={(e) => onAutoaprobar(e.target.checked)} />
        {tr('Autoaprobar cada plan si no respondo en 60 segundos. Si está apagado, ROSA2018 espera lo que haga falta y ese tiempo de espera no cuenta contra el tope de la corrida.')}
      </label>
    </section>
  );
}

// --------------------------------------------------------- más de esta corrida

export interface TarjetaMas {
  clave: string;
  icono: NombreIcono;
  titulo: string;
  sub: string;
}

export function MasDeEstaCorrida({ tarjetas, abierta, onAbrir }: { tarjetas: TarjetaMas[]; abierta: string | null; onAbrir: (clave: string | null) => void }) {
  if (tarjetas.length === 0) return null;
  return (
    <nav className="esc-mas" aria-label={tr('Más de esta corrida')}>
      {tarjetas.map((t) => (
        <button key={t.clave} type="button" className={`esc-mas-tarjeta ${abierta === t.clave ? 'esc-mas-abierta' : ''}`} aria-expanded={abierta === t.clave} onClick={() => onAbrir(abierta === t.clave ? null : t.clave)}>
          <IconoEsc nombre={t.icono} size={17} className="esc-mas-icono" />
          <span>
            <b>{t.titulo}</b>
            <small>{t.sub}</small>
          </span>
          <IconoEsc nombre={abierta === t.clave ? 'chevron-down' : 'chevron-right'} size={16} className="esc-mas-flecha" />
        </button>
      ))}
    </nav>
  );
}
