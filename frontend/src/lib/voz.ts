// Hablar con ROSA2018 de viva voz: oírte y contestarte en voz alta. Con lo
// que trae el navegador (Web Speech API), sin dependencias ni claves.
//
// Lo que hay que saber de dónde va el audio, porque no es obvio y en un
// proyecto médico importa: el RECONOCIMIENTO (oírte) en Chrome manda el audio
// a los servidores de Google para transcribirlo, y en Safari a los de Apple
// (o lo hace en el dispositivo, según la versión de macOS). La SÍNTESIS
// (contestarte) usa las voces instaladas en el Mac y no sale de la máquina.
// Lo que se transcribe es la pregunta de investigación, no datos de
// pacientes; aun así va dicho en la interfaz, al lado del botón.
//
// Sin soporte (Firefox, o un navegador que no lo traiga) no se rompe nada: el
// botón no sale y se escribe como siempre.

import { idiomaActual } from './idioma';

type Reconocedor = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function claseReconocedor(): (new () => Reconocedor) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function puedeEscuchar(): boolean {
  return claseReconocedor() !== null;
}

export function puedeHablar(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** El idioma para el reconocimiento y la voz. En castellano se respeta la
 *  variante del navegador si la tiene (es-DO, es-MX...), porque reconoce
 *  mejor el acento de quien habla; si no, es-ES. */
export function idiomaDeVoz(): string {
  if (idiomaActual() === 'en') return 'en-US';
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return /^es-/i.test(nav) ? nav : 'es-ES';
}

/** Mensajes de error del reconocimiento, en llano. «no-speech» no es un
 *  fallo: es que no oyó nada, y se dice así. */
export function errorDeVoz(codigo: string): string {
  switch (codigo) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'El navegador no tiene permiso para usar el micrófono. Se da en el candado de la barra de direcciones.';
    case 'no-speech':
      return 'No te oí. Prueba otra vez, un poco más cerca del micrófono.';
    case 'audio-capture':
      return 'No encuentro ningún micrófono en este ordenador.';
    case 'network':
      return 'El reconocimiento de voz necesita internet y no hay conexión.';
    default:
      return 'No pude oírte. Puedes escribir la pregunta.';
  }
}

/** Cuánto silencio hace falta para dar la pregunta por terminada. El
 *  reconocedor del navegador, en modo de frase única, corta al primer
 *  silencio de menos de un segundo, y eso partía un párrafo en cuanto alguien
 *  se paraba a pensar (Emir, 2 de octubre de 2026). Ahora escucha seguido y
 *  quien decide que has acabado es esto. */
export const SILENCIO_PARA_ENVIAR_MS = 3500;

/** Lo que se puede hacer con una escucha en marcha. */
export interface Escucha {
  /** Dar la pregunta por terminada ya, sin esperar al silencio. */
  enviar: () => void;
  /** Dejar de escuchar SIN enviar: lo oído se queda en la caja para
   *  corregirlo. Es lo que pasa al tocar el teclado. */
  soltar: () => void;
}

/** Empieza a escuchar. `alParcial` recibe lo que va entendiendo (para verlo
 *  escribirse en la caja); `alCuenta`, cuánto falta para enviar, en ms, o
 *  null mientras hablas; `alFinal`, la pregunta entera al acabar. */
export function escuchar(o: {
  alParcial: (texto: string) => void;
  alFinal: (texto: string) => void;
  alError: (mensaje: string) => void;
  alTerminar: () => void;
  alCuenta?: (ms: number | null) => void;
  silencioMs?: number;
}): Escucha {
  const C = claseReconocedor();
  if (!C) {
    o.alError('Este navegador no reconoce la voz. Puedes escribir la pregunta.');
    o.alTerminar();
    return { enviar: () => undefined, soltar: () => undefined };
  }
  const silencio = o.silencioMs ?? SILENCIO_PARA_ENVIAR_MS;
  const r = new C();
  r.lang = idiomaDeVoz();
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;

  // `previo`: lo que quedó firme en sesiones anteriores. El navegador corta
  // la escucha continua por su cuenta de vez en cuando (Chrome a los pocos
  // segundos de silencio largo, o al minuto); cuando pasa sin que hayamos
  // decidido acabar, se vuelve a arrancar y se sigue sumando.
  let previo = '';
  let sesion = '';
  let hayAlgo = false;
  let decidido: 'no' | 'enviar' | 'soltar' = 'no';
  let fatal = false;
  let reloj: ReturnType<typeof setTimeout> | null = null;
  let tic: ReturnType<typeof setInterval> | null = null;

  const texto = () => `${previo} ${sesion}`.replace(/\s+/g, ' ').trim();
  const pararReloj = () => {
    if (reloj) clearTimeout(reloj);
    if (tic) clearInterval(tic);
    reloj = null;
    tic = null;
  };
  const acabar = (como: 'enviar' | 'soltar') => {
    if (decidido !== 'no') return;
    decidido = como;
    pararReloj();
    o.alCuenta?.(null);
    try {
      r.stop();
    } catch {
      r.onend?.();
    }
  };
  // Cada vez que llega voz, la cuenta vuelve a empezar: se envía tras el
  // silencio, no tras la primera pausa.
  const armar = () => {
    pararReloj();
    const hasta = Date.now() + silencio;
    o.alCuenta?.(silencio);
    tic = setInterval(() => o.alCuenta?.(Math.max(0, hasta - Date.now())), 200);
    reloj = setTimeout(() => acabar('enviar'), silencio);
  };

  r.onresult = (e) => {
    // Cada trozo se une con un espacio: Chrome suele mandar el espacio delante
    // del trozo siguiente y Safari no, y pegados salia «subeantes».
    const firme: string[] = [];
    const parcial: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i]!;
      const t = (res[0]?.transcript ?? '').trim();
      if (!t) continue;
      (res.isFinal ? firme : parcial).push(t);
    }
    sesion = [...firme, ...parcial].join(' ');
    if (texto()) hayAlgo = true;
    o.alParcial(texto());
    if (hayAlgo) armar();
  };
  r.onerror = (e) => {
    if (e.error === 'aborted') return;
    // Sin oír nada, «no-speech» es «no te oí». Habiendo oído algo, solo es el
    // navegador cortando una pausa larga: se sigue.
    if (e.error === 'no-speech' && hayAlgo) return;
    fatal = true;
    o.alError(errorDeVoz(e.error));
  };
  r.onend = () => {
    if (decidido === 'no' && !fatal) {
      previo = texto();
      sesion = '';
      try {
        r.start();
        return;
      } catch {
        // No se dejó volver a arrancar: se acaba con lo que haya.
      }
    }
    pararReloj();
    o.alCuenta?.(null);
    const t = texto();
    if (t && decidido !== 'soltar') o.alFinal(t);
    o.alTerminar();
  };
  try {
    r.start();
  } catch {
    o.alError(errorDeVoz(''));
    o.alTerminar();
  }
  return { enviar: () => acabar('enviar'), soltar: () => acabar('soltar') };
}

/** Lo que se lee en voz alta de una respuesta: el texto, sin el andamiaje
 *  que se ve bien en pantalla pero que leído es ruido (referencias entre
 *  corchetes, identificadores, enlaces, marcas de formato). */
export function textoParaLeer(respuesta: string): string {
  return respuesta
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[[^\]]{0,80}\]/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\b(?:PMID|DOI|NCT)[:\s]*[\w./-]+/gi, '')
    .replace(/\b10\.\d{4,}\/\S+/g, '')
    .replace(/[*_#>]+/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let enCurso: SpeechSynthesisUtterance | null = null;

/** Lee un texto en voz alta. Corta lo que estuviera diciendo antes. */
export function hablar(texto: string, alTerminar: () => void): void {
  if (!puedeHablar()) {
    alTerminar();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(textoParaLeer(texto));
  u.lang = idiomaDeVoz();
  u.rate = 1.02;
  // La voz del sistema que mejor case con el idioma, si la hay.
  const voces = window.speechSynthesis.getVoices();
  const voz = voces.find((v) => v.lang === u.lang) ?? voces.find((v) => v.lang.slice(0, 2) === u.lang.slice(0, 2));
  if (voz) u.voice = voz;
  u.onend = () => {
    if (enCurso === u) enCurso = null;
    alTerminar();
  };
  u.onerror = () => {
    if (enCurso === u) enCurso = null;
    alTerminar();
  };
  enCurso = u;
  // Si el navegador rechaza la frase, se avisa igual de que termino: si no,
  // la cara se quedaba en «hablando» para siempre sin decir nada.
  try {
    window.speechSynthesis.speak(u);
  } catch {
    enCurso = null;
    alTerminar();
  }
}

export function callar(): void {
  if (puedeHablar()) window.speechSynthesis.cancel();
  enCurso = null;
}
