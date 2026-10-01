// Tema de la interfaz: claro, oscuro, o lo que diga el sistema. Misma
// decision que en el RAG: el CSS no consulta prefers-color-scheme para los
// tokens, depende de un data-theme explicito en <html> que este modulo
// escribe siempre, y asi la paleta oscura vive una sola vez.

import { useEffect, useState } from 'react';
import { tr } from './idioma';

export type Tema = 'sistema' | 'claro' | 'oscuro';

const CLAVE = 'rosa-tema';

const COLOR_UI: Record<'claro' | 'oscuro', string> = { claro: '#FAFAF9', oscuro: '#101010' };

function esTema(valor: unknown): valor is Tema {
  return valor === 'sistema' || valor === 'claro' || valor === 'oscuro';
}

export function leerTema(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    return esTema(guardado) ? guardado : 'sistema';
  } catch {
    return 'sistema';
  }
}

export function guardarTema(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento: el tema dura lo que la pestana.
  }
}

export function resolverTema(tema: Tema): 'claro' | 'oscuro' {
  if (tema !== 'sistema') return tema;
  return window.matchMedia(tr('(prefers-color-scheme: dark)')).matches ? 'oscuro' : 'claro';
}

export function aplicarTema(tema: Tema): void {
  const efectivo = resolverTema(tema);
  document.documentElement.dataset.theme = efectivo === 'oscuro' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLOR_UI[efectivo]);
}

export function observarSistema(): void {
  const consulta = window.matchMedia(tr('(prefers-color-scheme: dark)'));
  consulta.addEventListener('change', () => {
    if (leerTema() === 'sistema') aplicarTema('sistema');
  });
}

/** El tema elegido y como cambiarlo, para el selector de Ajustes. */
export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTema] = useState<Tema>(() => leerTema());
  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);
  return [
    tema,
    (t) => {
      guardarTema(t);
      setTema(t);
    },
  ];
}
