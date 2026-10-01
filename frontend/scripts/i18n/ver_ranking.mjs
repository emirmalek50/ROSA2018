// Comprueba en el navegador de verdad lo que la fusión tenía que conseguir:
// el menú sin «Cola de hipótesis», las cinco vistas del ranking, el aviso de
// pendientes, y que los enlaces viejos sigan llegando a donde deben.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
await ctx.addInitScript(() => localStorage.setItem('rosa.recorrido.v1', '1'));
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR DE PAGINA:', String(e).slice(0, 180)));

await p.goto('http://127.0.0.1:8765/#/', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const inv = await p.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/investigaciones/"]')].map((x) => x.getAttribute('href') ?? '');
  const m = a.map((h) => h.match(/investigaciones\/([^/]+)/)).find(Boolean);
  return m ? m[1] : null;
});
if (!inv) { console.log('no encontre ninguna investigacion'); await nav.close(); process.exit(1); }

const ir = async (hash) => { await p.goto(`http://127.0.0.1:8765/#${hash}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2200); };
const leer = () => p.evaluate(() => ({
  hash: location.hash,
  h2: document.querySelector('.contenido h2')?.textContent?.trim() ?? null,
  menu: [...document.querySelectorAll('a.nav-item')].map((a) => a.textContent?.replace(/\s+/g, ' ').trim()),
  vistas: [...document.querySelectorAll('.segmentos[aria-label] button')].map((b) => `${b.textContent?.replace(/\s+/g, ' ').trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
  aviso: document.querySelector('.aviso-pendientes')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  filas: document.querySelectorAll('a.hip-fila, a.ranking-fila, .podio-tarjeta').length,
}));

await ir(`/investigaciones/${inv}/ranking`);
const base = await leer();
console.log('MENU:', JSON.stringify(base.menu));
console.log('  hay entrada de cola?', base.menu.some((x) => /Cola de hip/i.test(x ?? '')) ? 'SI (mal)' : 'no (bien)');
console.log('  entrada del ranking:', base.menu.find((x) => /ranking/i.test(x ?? '')));
console.log('\nVISTAS:', JSON.stringify(base.vistas));
console.log('AVISO:', base.aviso);

for (const v of ['podio', 'pendientes', 'lista', 'clusters', 'laboratorio']) {
  await ir(`/investigaciones/${inv}/ranking/${v}`);
  const d = await leer();
  console.log(`  ${v.padEnd(12)} h2=${JSON.stringify(d.h2)} filas=${d.filas} marcada=${d.vistas.find((x) => x.endsWith('*'))}`);
}

console.log('\nENLACES VIEJOS:');
for (const vieja of [`/investigaciones/${inv}/hipotesis`, `/investigaciones/${inv}/hipotesis/laboratorio`]) {
  await ir(vieja);
  const d = await leer();
  console.log(`  ${vieja.split('/').slice(3).join('/')}  ->  ${d.hash.split('/').slice(3).join('/')}  h2=${JSON.stringify(d.h2)}`);
}
// y una ficha, que no se mueve
await ir(`/investigaciones/${inv}/ranking/pendientes`);
const href = await p.evaluate(() => document.querySelector('a.hip-fila')?.getAttribute('href') ?? null);
if (href) {
  await ir(href.replace('#', ''));
  const d = await leer();
  console.log(`  ficha                 ->  ${d.hash.split('/').slice(3).join('/').slice(0, 40)}  h2=${JSON.stringify((d.h2 ?? '').slice(0, 50))}`);
  const volver = await p.evaluate(() => [...document.querySelectorAll('a.enlace')].map((a) => a.textContent?.trim()).find((t) => /Volver/i.test(t ?? '')) ?? null);
  console.log('  el enlace de volver dice:', JSON.stringify(volver));
}
await p.screenshot({ path: '/tmp/ranking_fusion.png' });
await nav.close();
