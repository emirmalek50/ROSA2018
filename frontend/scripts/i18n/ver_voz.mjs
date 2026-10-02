// Hablar con ROSA2018, de punta a punta en el navegador, con un microfono y
// un altavoz falsos: pulsar la cara, «decir» una frase, ver que se escribe y
// que se envia sola; y que «Leemela» lee en voz alta.
//   node scripts/i18n/ver_voz.mjs <investigacion> <hilo>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inv, hilo] = process.argv.slice(2);
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
let enviada = null;
await ctx.route('**/preguntar', (r) => { enviada = r.request().postDataJSON(); return new Promise(() => {}); });
await ctx.addInitScript(([i, h]) => {
  localStorage.setItem('rosa.recorrido.v1', '1');
  sessionStorage.setItem(`rosa.mundo.hilo.${i}`, h);
  window.__dichas = [];
  // Los dos nombres: Chromium ya trae `SpeechRecognition` sin prefijo y
  // lib/voz.ts lo prefiere al prefijado.
  const Falso = class {
    constructor() { window.__oido = this; }
    start() { window.__escuchando = true; }
    stop() { window.__escuchando = false; this.onend?.(); }
    abort() {}
  };
  window.SpeechRecognition = Falso;
  window.webkitSpeechRecognition = Falso;
  // speechSynthesis es de solo lectura: con `=` no se sustituye y se mezclaba
  // el real con la frase falsa.
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, getVoices: () => [], speak(u) { window.__dichas.push(u.text); setTimeout(() => u.onend?.(), 50); } } });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
}, [inv, hilo]);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));
await p.goto(`http://127.0.0.1:8765/#/investigaciones/${inv}/mundo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

console.log('  boton de hablar:', await p.evaluate(() => document.querySelector('.mundo-hablar')?.getAttribute('aria-label') ?? 'NO HAY'));
await p.click('.mundo-hablar');
await p.waitForTimeout(300);
console.log('  al pulsar, escucha:', await p.evaluate(() => window.__escuchando === true), '| cara:', await p.evaluate(() => document.querySelector('.mundo-hablar .persona')?.className));
await p.screenshot({ path: '/tmp/voz_escuchando.png', clip: { x: 0, y: 760, width: 1100, height: 240 } });

// El caso de Emir: hablar, pararse a pensar 1,5 s y seguir. No se puede
// enviar en la pausa.
const di = (trozos) => p.evaluate((ts) => {
  const r = window.__oido;
  r.onresult({ resultIndex: 0, results: ts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
}, trozos);
await di([['la GFAP sube', true]]);
await p.waitForTimeout(1500);
console.log('  tras 1,5 s pensando, se envio?:', enviada !== null ? 'SI (mal)' : 'no (bien)');
console.log('  la cuenta atras dice:', JSON.stringify(await p.evaluate(() => document.querySelector('.mundo-voz-cuenta')?.textContent ?? null)));
await p.screenshot({ path: '/tmp/voz_cuenta.png', clip: { x: 0, y: 700, width: 1100, height: 300 } });
await di([['la GFAP sube', true], ['antes que la NfL en portadores de APOE4', true]]);
await p.waitForTimeout(1200);
console.log('  tras seguir hablando, se envio?:', enviada !== null ? 'SI (mal)' : 'no (bien)');
console.log('  la caja dice:', JSON.stringify(await p.inputValue('textarea.mundo-compositor-texto')));
await p.waitForTimeout(3800);
console.log('  tras 3,5 s de silencio, se envio:', JSON.stringify(enviada?.pregunta ?? null));
console.log('  cara mientras busca:', await p.evaluate(() => document.querySelector('.mundo-hablar .persona')?.className));

// «Leemela» en una respuesta ya dada
const lee = await p.evaluate(() => {
  const b = [...document.querySelectorAll('button.mundo-accion')].find((x) => /Léemela|Read it/.test(x.textContent ?? ''));
  if (!b) return 'NO HAY BOTON';
  b.click();
  return 'pulsado';
});
await p.waitForTimeout(300);
const dichas = await p.evaluate(() => window.__dichas);
console.log('  Leemela:', lee, '| leyo', dichas.length, 'texto(s):', JSON.stringify((dichas[0] ?? '').slice(0, 90)));
console.log('  sin URLs ni DOI al leer:', !/https?:|10\.\d{4}/.test(dichas[0] ?? ''));
await nav.close();
