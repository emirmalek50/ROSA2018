// Canvas y portapapeles no pasan por el observador del DOM. Usan el mismo
// endpoint y contrato científico, sin modificar los datos originales.
import { EN } from '../i18n/en';
import { comprobarTraduccion } from './terminologia';
import { pareceCastellano } from './traductorDom';
import contrato from '../../../rosa/terminologia_traduccion.json';

export type PedirTraducciones = (textos: string[]) => Promise<Record<string, string>>;
const memoria = new Map<string, string>();
const literal = (t: string) => !/[a-záéíóúñ]{2}/i.test(t)
  || /^[ACGTU]{6,}$/.test(t) || contrato.simbolos.includes(t)
  || /^(?:(?:ENSG|ENST|ENSP|NCT)\d+(?:\.\d+)?|[A-Z]{2,}:\d+)$/.test(t)
  || /^(?:SMILES|INCHIKEY):/i.test(t);

/** Solo devuelve resultados que conservan los datos verificables. Un fallo
 *  deja la clave ausente: quien exporta puede impedir una copia incompleta. */
export async function traducirTextosExternos(textos: string[], pedir: PedirTraducciones,
  alLlegar?: (traducidas: Record<string, string>) => void): Promise<Record<string, string>> {
  const resultado: Record<string, string> = {};
  const lotes: string[][] = [];
  let lote: string[] = [];
  let caracteres = 0;
  for (const t of new Set(textos)) {
    const local = EN[t] ?? memoria.get(t);
    if (local !== undefined && comprobarTraduccion(t, local) === null) resultado[t] = local;
    else if (literal(t)) resultado[t] = t;
    else if (t.length <= 4000) {
      if (lote.length && (lote.length >= 60 || caracteres + t.length > 4500)) {
        lotes.push(lote); lote = []; caracteres = 0;
      }
      lote.push(t); caracteres += t.length;
    }
  }
  if (lote.length) lotes.push(lote);
  if (Object.keys(resultado).length) alLlegar?.({ ...resultado });
  // Tres lotes simultáneos, igual que el traductor de la página.
  for (let i = 0; i < lotes.length; i += 3) {
    await Promise.all(lotes.slice(i, i + 3).map(async (textosLote) => {
      try {
        const recibidas = await pedir(textosLote);
        const validas: Record<string, string> = {};
        for (const t of textosLote) {
          const en = recibidas[t];
          if (typeof en !== 'string') continue;
          // Una línea que ya está en inglés puede llevar miles con coma.
          // Devolverla idéntica conserva todos sus datos; el contrato ES/EN
          // solo se aplica cuando realmente se cambió su contenido.
          if (en === t ? pareceCastellano(t) : comprobarTraduccion(t, en) !== null) continue;
          memoria.set(t, en); resultado[t] = en; validas[t] = en;
        }
        if (Object.keys(validas).length) alLlegar?.(validas);
      } catch {
        // No responder no equivale a traducir. No se guarda el fallo.
      }
    }));
  }
  return resultado;
}

/** Conserva los saltos y la sangría del protocolo. No permite exportar una
 *  mezcla silenciosa si el servidor no pudo traducir todas sus líneas. */
export async function traducirDocumentoExterno(texto: string, pedir: PedirTraducciones): Promise<string | null> {
  const partes = texto.split(/(\r?\n)/);
  const textos = partes.filter((_, i) => i % 2 === 0).map(t => t.trim()).filter(Boolean);
  const traducciones = await traducirTextosExternos(textos, pedir);
  if (textos.some(t => traducciones[t] === undefined)) return null;
  return partes.map((t, i) => i % 2 || !t.trim() ? t
    : t.replace(/^(\s*)(.*?)(\s*)$/, (_, antes: string, contenido: string, despues: string) =>
      antes + traducciones[contenido]! + despues)).join('');
}
