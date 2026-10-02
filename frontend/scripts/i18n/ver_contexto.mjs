// El anillo del contexto en la corrida, con su ficha abierta.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
await ctx.addInitScript(() => {
  localStorage.setItem('rosa.recorrido.v1', '1');
  // El bloque del gasto solo sale en modo Detalle.
  localStorage.setItem('rosa.modo', 'detalle');
});
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));
await p.goto(`http://127.0.0.1:8765/#/investigaciones/${process.argv[2]}/corrida`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
const hay = await p.evaluate(() => document.querySelectorAll('.ctx').length);
console.log('  gasto-item en pantalla:', await p.evaluate(() => document.querySelectorAll('.gasto-item').length));
console.log('  secciones:', await p.evaluate(() => [...document.querySelectorAll('.contenido h3, .contenido h2')].map((x) => x.textContent?.trim().slice(0, 34)).slice(0, 10)));
console.log('  anillos de contexto:', hay);
if (hay) {
  await p.hover('.ctx-boton');
  await p.waitForTimeout(700);
  console.log('  ficha:', await p.evaluate(() => document.querySelector('.ctx-ficha')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 150) ?? 'no abrio'));
  const caja = await p.$('.gasto, .gasto-items, .ctx');
  await (caja ?? p).screenshot({ path: '/tmp/contexto.png' });
  console.log('  captura: /tmp/contexto.png');
}
await nav.close();
