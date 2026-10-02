// Una pregunta REAL al chat (una llamada al modelo) y la linea de tiempo
// llegando en vivo. Captura la pantalla mientras piensa y al terminar.
//   node scripts/i18n/ver_razonamiento.mjs <investigacion> "<pregunta>"
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inv, pregunta] = process.argv.slice(2);
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 2, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
await ctx.addInitScript(() => { localStorage.setItem('rosa.recorrido.v1', '1'); sessionStorage.clear(); });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));
await p.goto(`http://127.0.0.1:8765/#/investigaciones/${inv}/mundo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.fill('textarea.mundo-compositor-texto', pregunta);
await p.press('textarea.mundo-compositor-texto', 'Enter');
const t0 = Date.now();
let capturada = false, ultimo = -1;
while (Date.now() - t0 < 240_000) {
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => ({
    filas: [...document.querySelectorAll('.razon .razon-fila')].map((f) => f.querySelector('.razon-cabeza')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 110)),
    vivo: !!document.querySelector('.mundo-pensando'),
  }));
  if (d.filas.length !== ultimo) {
    ultimo = d.filas.length;
    console.log(`  ${Math.round((Date.now() - t0) / 1000)} s · ${d.filas.length} pasos`);
    for (const f of d.filas.slice(-2)) console.log(`      ${f}`);
  }
  if (!capturada && d.filas.length >= 3 && d.vivo) {
    const el = await p.$('.mundo-turno:last-child');
    if (el) await el.screenshot({ path: '/tmp/razon_vivo.png' });
    capturada = true;
  }
  if (!d.vivo && Date.now() - t0 > 5000) break;
}
await p.waitForTimeout(1500);
const fin = await p.evaluate(() => ({
  resumen: document.querySelector('.mundo-turno:last-child .razon-resumen')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  error: document.querySelector('.mundo-turno:last-child .mundo-error')?.textContent ?? null,
}));
console.log(`  terminado en ${Math.round((Date.now() - t0) / 1000)} s`);
console.log('  plegado al acabar:', fin.resumen);
if (fin.error) console.log('  ERROR de la pregunta:', fin.error);
const el = await p.$('.mundo-turno:last-child');
if (el) await el.screenshot({ path: '/tmp/razon_fin.png' });
await nav.close();
