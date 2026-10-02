// La tarjeta de cada llamada dentro del hilo del modelo de mundo, en el
// navegador de verdad. El hilo abierto vive en sessionStorage, asi que hay
// que ponerlo: en una pestaña nueva el chat abre vacio y no se ve nada.
//   node scripts/i18n/ver_herramienta.mjs <investigacion> <hilo>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inv, hilo] = process.argv.slice(2);
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 2, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
await ctx.addInitScript(([i, h]) => {
  localStorage.setItem('rosa.recorrido.v1', '1');
  sessionStorage.setItem(`rosa.mundo.hilo.${i}`, h);
}, [inv, hilo]);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 180)));
await p.goto(`http://127.0.0.1:8765/#/investigaciones/${inv}/mundo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
// abrir el rastro de la respuesta
// El rastro lo abre el boton .mundo-busqueda («Ver que consulto»).
await p.evaluate(() => { document.querySelectorAll('button.mundo-busqueda').forEach((b) => b.click()); });
await new Promise((r) => setTimeout(r, 500));
// abrir la primera tarjeta, para ver tambien el detalle
await p.evaluate(() => { document.querySelector('button.llamada-cabeza')?.click(); });
await p.waitForTimeout(1200);
const d = await p.evaluate(() => ({
  turnos: document.querySelectorAll('.mundo-turno, .mundo-respuesta').length,
  llamadas: document.querySelectorAll('.llamada').length,
  cuenta: document.querySelector('.llamadas-cuenta')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  estados: [...document.querySelectorAll('.llamada')].map((x) => [...x.classList].find((c) => c.startsWith('llamada-') && c !== 'llamada-cabeza')),
  cabezas: [...document.querySelectorAll('.llamada-cabeza')].map((x) => x.textContent?.replace(/\s+/g, ' ').trim()),
}));
console.log('  turnos:', d.turnos, '| tarjetas:', d.llamadas);
console.log('  recuento:', d.cuenta);
console.log('  estados:', JSON.stringify(d.estados));
for (const c of d.cabezas) console.log('   ', c);
const el = await p.$('.llamadas');
if (el) { await el.screenshot({ path: '/tmp/herramienta.png' }); console.log('  captura: /tmp/herramienta.png'); }
await nav.close();
