// El chat del modelo de mundo como lo ve la persona: una respuesta ya dada
// (con sus pasos a la vista) y una pregunta en vuelo (pensando). La pregunta
// en vuelo se simula reteniendo la peticion, para no gastar una llamada.
//   node scripts/i18n/ver_chat.mjs <investigacion> <hilo>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inv, hilo] = process.argv.slice(2);
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 2, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
// la pregunta nueva se queda colgada: es el estado «pensando»
await ctx.route('**/preguntar', () => new Promise(() => {}));
await ctx.addInitScript(([i, h]) => {
  localStorage.setItem('rosa.recorrido.v1', '1');
  sessionStorage.setItem(`rosa.mundo.hilo.${i}`, h);
}, [inv, hilo]);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));
await p.goto(`http://127.0.0.1:8765/#/investigaciones/${inv}/mundo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
await p.fill('textarea.mundo-compositor-texto', 'verifica si puedes ahora');
await p.waitForTimeout(500);
const escuchando = await p.evaluate(() => document.querySelector('.mundo-compositor-cara')?.className);
await p.press('textarea.mundo-compositor-texto', 'Enter');
await p.waitForTimeout(1800);
const d = await p.evaluate(() => ({
  caras: [...document.querySelectorAll('.mundo-marca')].map((x) => [...x.classList].find((c) => c.startsWith('persona-') && c !== 'persona-marca')),
  pasosVisibles: document.querySelectorAll('.rastro-paso').length,
  brillo: !!document.querySelector('.mundo-pensando .brillo'),
  cajaPensando: document.querySelector('.mundo-compositor-cara')?.className,
}));
console.log('  al escribir, la cara de la caja:', escuchando);
console.log('  caras en el hilo:', JSON.stringify(d.caras));
console.log('  pasos visibles sin abrir nada:', d.pasosVisibles);
console.log('  el texto de pensando brilla:', d.brillo);
console.log('  la cara de la caja al enviar:', d.cajaPensando);
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/chat.png' });
const r = await p.$('.mundo-turno:last-child .mundo-respuesta-cabeza');
if (r) await r.screenshot({ path: '/tmp/chat_cara.png' });
// la cara sola, en tres momentos del giro
const cara = await p.$('.mundo-turno:last-child .persona');
for (const [i, ms] of [[0, 0], [1, 300], [2, 300]]) {
  await p.waitForTimeout(ms);
  if (cara) await cara.screenshot({ path: `/tmp/cara_${i}.png`, scale: 'device' });
}
console.log('  captura: /tmp/chat.png');
console.log('  estilo del aro:', JSON.stringify(await p.evaluate(() => {
  const o = document.querySelector('.mundo-turno:last-child .persona-orbe');
  if (!o) return null;
  const c = getComputedStyle(o);
  return { fondo: c.backgroundImage.slice(0, 70), animacion: c.animationName + ' ' + c.animationDuration, svg: getComputedStyle(o.querySelector('svg')).display, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'), blue: getComputedStyle(document.documentElement).getPropertyValue('--blue') };
})));
await nav.close();
