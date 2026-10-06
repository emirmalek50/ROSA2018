import { useEffect, useMemo, useState } from 'react';
import type { Grafo } from './arbol';
import { tr, useIdioma } from './idioma';
import { traducirTextosExternos, type PedirTraducciones } from './traduccionExterna';

/** Una vista del grafo: traducir nunca cambia los identificadores, estados,
 *  citas, enlaces ni los datos guardados por ROSA2018. */
export function useArbolTraducido(original: Grafo, pedir: PedirTraducciones): Grafo {
  const idioma = useIdioma();
  const [textos, setTextos] = useState<Record<string, string>>({});
  useEffect(() => {
    if (idioma !== 'en') return;
    let vivo = true;
    const pendientes = original.nodos.flatMap(n => [
      ...(n.tipo === 'fuente' ? [] : [n.etiqueta]), n.sub ?? '', n.alerta ?? '',
    ]).filter(Boolean);
    void traducirTextosExternos(pendientes, pedir, recibidas => {
      if (vivo) setTextos(previos => ({ ...previos, ...recibidas }));
    });
    return () => { vivo = false; };
  }, [original, idioma, pedir]);
  return useMemo(() => {
    if (idioma === 'es') return original;
    const leer = (t: string | undefined) => t === undefined ? undefined : textos[t] ?? tr(t);
    const nodos = original.nodos.map(n => ({
      ...n, etiqueta: n.tipo === 'fuente' ? n.etiqueta : leer(n.etiqueta)!,
      sub: leer(n.sub), alerta: leer(n.alerta),
      // Buscar el título original sigue funcionando aunque se vea en inglés.
      alias: [...(n.alias ?? []), n.etiqueta],
    }));
    return { ...original, nodos, porId: new Map(nodos.map(n => [n.id, n])) };
  }, [original, idioma, textos]);
}
