// Búsqueda global (Cmd+K o Ctrl+K): hipótesis, hechos, fuentes, artefactos,
// iteraciones y eventos de la investigación actual. Overlay con lista y
// teclado: flechas para moverse, Enter para ir, Escape para cerrar.
//
// Espera (estándar de Emir, 19 de septiembre de 2026): la lista por palabras
// sale al instante; la búsqueda por significado la responde el servidor y,
// mientras responde, el bloque "Por significado" enseña tres filas en gris
// con la forma de un resultado (chip, título y similitud) y aria-busy. Si ya
// había resultados por significado se quedan hasta que llegan los nuevos.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoRosa } from '../datos/tipos';
import { buscar, type Resultado } from '../lib/buscar';
import { cabeceras } from '../datos/almacen';
import { esTiempoAgotado, senalDeTope } from '../lib/diferido';
import { Cargando, Esqueleto } from './Esqueleto';
import { IconSearch, IconX } from './icons';
import { Chip } from './piezas';

const TIPO: Record<Resultado['tipo'], string> = {
  hipotesis: 'Hipótesis',
  hecho: 'Modelo de mundo',
  fuente: 'Fuente',
  artefacto: 'Artefacto',
  iteracion: 'Iteración',
  evento: 'Evento',
};

/** Tres filas con la silueta de un resultado por significado (.busqueda-item:
 *  chip, título y similitud), del mismo alto que las reales. */
function EsqueletoSemantico() {
  return (
    <Cargando
      activo
      rotulo="los resultados por significado"
      esqueleto={
        <ul className="busqueda-resultados" aria-hidden="true">
          {[76, 58, 68].map((ancho, i) => (
            <li key={i}>
              <div className="busqueda-item">
                <Esqueleto className="esqueleto-chip" ancho={64} />
                <Esqueleto alto={13} ancho={`${ancho}%`} />
                <Esqueleto alto={12} ancho={82} />
              </div>
            </li>
          ))}
        </ul>
      }
    >
      {null}
    </Cargando>
  );
}

export function BusquedaGlobal({ estado, investigacionId, abierta, onCerrar }: { estado: EstadoRosa; investigacionId: string | null; abierta: boolean; onCerrar: () => void }) {
  const [q, setQ] = useState('');
  const [indice, setIndice] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const resultados = useMemo(() => (investigacionId ? buscar(estado, investigacionId, q) : []), [estado, investigacionId, q]);
  // Por significado (índice semántico del servidor): se pide con retardo, solo
  // con servidor conectado y a partir de cuatro letras; nunca bloquea la lista
  // por palabras, que sale al instante.
  const [semanticos, setSemanticos] = useState<{ id: string; tipo: string; texto: string; similitud: number }[]>([]);
  // Verdadero desde que sale la petición al servidor hasta que responde.
  const [buscandoSemantico, setBuscandoSemantico] = useState(false);
  // Verdadero si la última petición venció el tope de tiempo (15 s): el
  // bloque dice "no pude comprobar" en vez de callar como si no hubiera nada.
  const [sinRespuesta, setSinRespuesta] = useState(false);
  useEffect(() => {
    setSinRespuesta(false);
    if (!abierta || estado.conexion === 'muestra' || q.trim().length < 4) {
      setSemanticos([]);
      setBuscandoSemantico(false);
      return;
    }
    let vivo = true;
    const t = window.setTimeout(async () => {
      setBuscandoSemantico(true);
      try {
        const r = await fetch(`/api/buscar?q=${encodeURIComponent(q.trim())}${investigacionId ? `&investigacion=${encodeURIComponent(investigacionId)}` : ''}&k=6`, { headers: cabeceras(false), cache: 'no-store', ...senalDeTope(15000) });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { disponible: boolean; resultados: { id: string; tipo: string; texto: string; similitud: number }[] };
        if (vivo) setSemanticos(d.disponible ? d.resultados : []);
      } catch (error: unknown) {
        if (vivo) {
          setSemanticos([]);
          if (esTiempoAgotado(error)) setSinRespuesta(true);
        }
      } finally {
        if (vivo) setBuscandoSemantico(false);
      }
    }, 350);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [q, abierta, estado.conexion, investigacionId]);
  const rutaSemantica = (r: { id: string; tipo: string }): string | null => {
    const [tipo, id] = r.id.split(':', 2);
    if (!investigacionId || !id) return null;
    if (tipo === 'hipotesis') return `#/investigaciones/${investigacionId}/hipotesis/${id}`;
    if (tipo === 'hecho') return `#/investigaciones/${investigacionId}/mundo`;
    if (tipo === 'fuente') return `#/investigaciones/${investigacionId}/panorama`;
    return null;
  };

  useEffect(() => {
    if (abierta) {
      setQ('');
      setIndice(0);
      window.setTimeout(() => entrada.current?.focus(), 0);
    }
  }, [abierta]);

  if (!abierta) return null;
  const ir = (r: Resultado) => {
    window.location.hash = r.ruta;
    onCerrar();
  };
  return (
    <div className="scrim scrim-visible" onClick={onCerrar} role="presentation">
      <div className="busqueda" role="dialog" aria-label="Buscar en la investigación" onClick={(e) => e.stopPropagation()}>
        <div className="busqueda-entrada">
          <IconSearch size={15} />
          <input
            ref={entrada}
            value={q}
            placeholder={investigacionId ? 'Buscar hipótesis, hechos, fuentes, artefactos, iteraciones' : 'Abre una investigación para buscar dentro'}
            disabled={investigacionId === null}
            onChange={(e) => {
              setQ(e.target.value);
              setIndice(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCerrar();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndice((i) => Math.min(resultados.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndice((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && resultados[indice]) ir(resultados[indice]!);
            }}
            aria-label="Buscar"
          />
          <button type="button" className="btn btn-fantasma btn-icono" aria-label="Cerrar" onClick={onCerrar}>
            <IconX size={14} />
          </button>
        </div>
        {q.trim().length >= 2 && (
          <ul className="busqueda-resultados">
            {resultados.length === 0 && <li className="meta">Nada en esta investigación coincide con «{q}».</li>}
            {resultados.map((r, i) => (
              <li key={`${r.tipo}-${r.titulo}-${i}`}>
                <button type="button" className={`busqueda-item ${i === indice ? 'busqueda-activo' : ''}`} onMouseEnter={() => setIndice(i)} onClick={() => ir(r)}>
                  <Chip>{TIPO[r.tipo]}</Chip>
                  <span className="busqueda-titulo">{r.titulo}</span>
                  {r.detalle !== '' && <span className="meta">{r.detalle}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {(semanticos.length > 0 || buscandoSemantico || sinRespuesta) && (
          <div className="busqueda-semantica">
            <p className="meta" style={{ margin: '8px 0 4px' }}>Por significado (índice semántico)</p>
            {sinRespuesta && !buscandoSemantico && semanticos.length === 0 ? (
              <p className="meta">No pude comprobar el índice por significado: el servidor no respondió a tiempo. Escribe otra vez para volver a intentarlo.</p>
            ) : semanticos.length > 0 ? (
              <ul className="busqueda-resultados">
                {semanticos.map((r) => {
                  const ruta = rutaSemantica(r);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="busqueda-item"
                        onClick={() => {
                          if (ruta) {
                            window.location.hash = ruta;
                            onCerrar();
                          }
                        }}
                      >
                        <Chip>{r.tipo === 'hecho' ? 'Hecho' : r.tipo === 'hipotesis' ? 'Hipótesis' : 'Fuente'}</Chip>
                        <span className="busqueda-titulo">{r.texto.slice(0, 120)}</span>
                        <span className="meta">similitud {r.similitud.toFixed(2)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EsqueletoSemantico />
            )}
          </div>
        )}
        <p className="meta busqueda-pie">Flechas para moverte, Enter para abrir, Escape para cerrar.</p>
      </div>
    </div>
  );
}
