// @vitest-environment jsdom
// Hablar con ROSA2018 de viva voz. Sin micrófono ni altavoz: se sustituye el
// reconocimiento y la síntesis del navegador por unos falsos que se pueden
// mandar desde la prueba («di esto», «cállate»).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fijarIdioma } from './idioma';
import { SILENCIO_PARA_ENVIAR_MS, callar, errorDeVoz, escuchar, hablar, idiomaDeVoz, puedeEscuchar, puedeHablar, textoParaLeer } from './voz';

type Falso = {
  lang: string;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
let ultimo: Falso | null = null;

class ReconocedorFalso implements Falso {
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor() {
    ultimo = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {}
}

/** Lo que oye el reconocedor: un trozo, final o no. */
function oye(r: Falso, trozos: { t: string; final: boolean }[]) {
  const results = trozos.map((x) => Object.assign([{ transcript: x.t }], { isFinal: x.final }));
  r.onresult?.({ resultIndex: 0, results });
}

const dichas: { texto: string; lang: string }[] = [];

beforeEach(() => {
  ultimo = null;
  dichas.length = 0;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = ReconocedorFalso;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    lang = '';
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  };
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    cancel: vi.fn(),
    getVoices: () => [],
    speak: (u: { text: string; lang: string; onend: () => void }) => {
      dichas.push({ texto: u.text, lang: u.lang });
      u.onend();
    },
  };
});

afterEach(() => {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  fijarIdioma('es');
  try {
    localStorage.removeItem('rosa.idioma');
  } catch {
    // nada
  }
});

describe('oír la pregunta', () => {
  afterEach(() => vi.useRealTimers());

  const nada = { alParcial: vi.fn(), alError: vi.fn(), alTerminar: vi.fn() };

  it('pararse a pensar un segundo NO envía: hace falta el silencio entero', () => {
    // Es el fallo que vio Emir: el navegador cortaba al primer silencio de
    // menos de un segundo y se mandaba medio párrafo.
    vi.useFakeTimers();
    const final = vi.fn();
    escuchar({ ...nada, alFinal: final });
    const r = ultimo!;
    oye(r, [{ t: 'la GFAP sube', final: true }]);
    vi.advanceTimersByTime(1200);
    expect(final).not.toHaveBeenCalled();
    // Sigue hablando tras la pausa: la cuenta vuelve a empezar.
    oye(r, [{ t: 'la GFAP sube', final: true }, { t: 'antes que la NfL', final: true }]);
    vi.advanceTimersByTime(SILENCIO_PARA_ENVIAR_MS - 100);
    expect(final).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(final).toHaveBeenCalledWith('la GFAP sube antes que la NfL');
  });

  it('si el navegador corta la escucha por su cuenta, se vuelve a arrancar y se sigue sumando', () => {
    // Chrome corta la escucha continua cada cierto tiempo. Si eso se tomara
    // como «ha terminado», sería el mismo fallo por otro camino.
    vi.useFakeTimers();
    const final = vi.fn();
    const arranques = vi.spyOn(ReconocedorFalso.prototype, 'start');
    escuchar({ ...nada, alFinal: final });
    const r = ultimo!;
    oye(r, [{ t: 'primera parte', final: true }]);
    r.onend?.();
    expect(arranques).toHaveBeenCalledTimes(2);
    expect(final).not.toHaveBeenCalled();
    oye(r, [{ t: 'segunda parte', final: true }]);
    vi.advanceTimersByTime(SILENCIO_PARA_ENVIAR_MS + 50);
    expect(final).toHaveBeenCalledWith('primera parte segunda parte');
    arranques.mockRestore();
  });

  it('va escribiendo lo que entiende mientras hablas', () => {
    const parciales: string[] = [];
    escuchar({ ...nada, alParcial: (t) => parciales.push(t), alFinal: vi.fn() });
    oye(ultimo!, [{ t: 'qué sabes de', final: false }]);
    oye(ultimo!, [{ t: 'qué sabes de p-tau217', final: false }]);
    expect(parciales).toEqual(['qué sabes de', 'qué sabes de p-tau217']);
  });

  it('enseña la cuenta atrás, y se quita mientras hablas', () => {
    vi.useFakeTimers();
    const cuentas: (number | null)[] = [];
    escuchar({ ...nada, alFinal: vi.fn(), alCuenta: (ms) => cuentas.push(ms) });
    oye(ultimo!, [{ t: 'algo', final: true }]);
    vi.advanceTimersByTime(1000);
    expect(cuentas[0]).toBe(SILENCIO_PARA_ENVIAR_MS);
    expect(cuentas.some((c) => c !== null && c < SILENCIO_PARA_ENVIAR_MS)).toBe(true);
  });

  it('«enviar» la manda ya, sin esperar al silencio', () => {
    vi.useFakeTimers();
    const final = vi.fn();
    const e = escuchar({ ...nada, alFinal: final });
    oye(ultimo!, [{ t: 'qué se sabe de p-tau217', final: true }]);
    e.enviar();
    expect(final).toHaveBeenCalledWith('qué se sabe de p-tau217');
  });

  it('«soltar» deja de escuchar SIN enviar: lo oído se queda para corregirlo', () => {
    // Es lo que pasa al tocar el teclado. Mandar algo que estabas corrigiendo
    // sería peor que no mandarlo.
    vi.useFakeTimers();
    const final = vi.fn();
    const terminar = vi.fn();
    const e = escuchar({ ...nada, alFinal: final, alTerminar: terminar });
    oye(ultimo!, [{ t: 'casi lo tengo', final: true }]);
    e.soltar();
    vi.advanceTimersByTime(SILENCIO_PARA_ENVIAR_MS * 2);
    expect(final).not.toHaveBeenCalled();
    expect(terminar).toHaveBeenCalled();
  });

  it('si no oyó nada no manda una pregunta vacía', () => {
    const final = vi.fn();
    const e = escuchar({ ...nada, alFinal: final });
    e.enviar();
    expect(final).not.toHaveBeenCalled();
  });

  it('pararlo a mano no se enseña como error, ni una pausa larga con algo ya dicho', () => {
    const error = vi.fn();
    escuchar({ ...nada, alError: error, alFinal: vi.fn() });
    ultimo!.onerror?.({ error: 'aborted' });
    oye(ultimo!, [{ t: 'algo', final: true }]);
    ultimo!.onerror?.({ error: 'no-speech' });
    expect(error).not.toHaveBeenCalled();
  });

  it('los errores se dicen en llano, y «no te oí» no es un fallo', () => {
    expect(errorDeVoz('not-allowed')).toMatch(/permiso para usar el micrófono/);
    expect(errorDeVoz('no-speech')).toMatch(/No te oí/);
    expect(errorDeVoz('audio-capture')).toMatch(/ningún micrófono/);
    expect(errorDeVoz('loquesea')).toMatch(/Puedes escribir/);
  });

  it('sin reconocimiento en el navegador no hay botón que finja funcionar', () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    expect(puedeEscuchar()).toBe(false);
    const error = vi.fn();
    const terminar = vi.fn();
    escuchar({ alParcial: vi.fn(), alFinal: vi.fn(), alError: error, alTerminar: terminar });
    expect(error).toHaveBeenCalled();
    expect(terminar).toHaveBeenCalled();
  });
});

describe('leer la respuesta en voz alta', () => {
  it('lee el texto y avisa al terminar', () => {
    expect(puedeHablar()).toBe(true);
    const fin = vi.fn();
    hablar('La GFAP sube antes que la NfL.', fin);
    expect(dichas.map((d) => d.texto)).toEqual(['La GFAP sube antes que la NfL.']);
    expect(fin).toHaveBeenCalled();
  });

  it('no lee el andamiaje: enlaces, DOI, PMID ni corchetes de cita', () => {
    // Leído en voz alta, «h t t p s dos puntos barra barra» es ruido puro.
    const t = textoParaLeer('Sube antes [Pettigrew et al., 2025] (PMID: 40112233), ver https://exa.ai/x y 10.3389/fnagi.2026.1851072. **Es** `literal`.');
    expect(t).not.toMatch(/https?:|PMID|10\.3389|\[|\*|`/);
    expect(t).toContain('Sube antes');
  });

  it('habla en el idioma de la interfaz', () => {
    fijarIdioma('en');
    expect(idiomaDeVoz()).toBe('en-US');
    hablar('GFAP rises first.', () => undefined);
    expect(dichas.at(-1)?.lang).toBe('en-US');
    fijarIdioma('es');
    expect(idiomaDeVoz()).toMatch(/^es-/);
  });

  it('si el navegador rechaza la frase, no se queda «hablando» para siempre', () => {
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      getVoices: () => [],
      speak: () => {
        throw new TypeError('rechazada');
      },
    };
    const fin = vi.fn();
    expect(() => hablar('algo', fin)).not.toThrow();
    expect(fin).toHaveBeenCalled();
  });

  it('callarse corta lo que estuviera diciendo', () => {
    callar();
    expect((window as unknown as { speechSynthesis: { cancel: ReturnType<typeof vi.fn> } }).speechSynthesis.cancel).toHaveBeenCalled();
  });
});
