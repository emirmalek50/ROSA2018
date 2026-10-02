// Recorre ROSA2018 en ingles y lista lo que sigue en castellano. La deteccion
// es por marcas que el ingles no tiene (ñ, tildes, ¿¡) y por palabras funcion
// que no aparecen en ingles. No pretende ser exacta: pretende dar la lista
// de lo que falta, ordenada por cuanto se repite.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
await ctx.addInitScript(() => { localStorage.setItem('rosa.recorrido.v1', '1'); localStorage.setItem('rosa.idioma', 'en'); });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));

// Las rutas de una investigacion de verdad, sacadas del estado, mas las cinco
// vistas del ranking. Antes la lista estaba a mano y se quedaba vieja.
const RUTAS = process.argv[2] ? process.argv[2].split(',') : null;
await p.goto('http://127.0.0.1:8765/#/', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const inv = await p.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/investigaciones/"]')].map((x) => x.getAttribute('href') ?? '');
  const m = a.map((h) => h.match(/investigaciones\/([^/]+)/)).find(Boolean);
  return m ? m[1] : null;
});
const rutas = RUTAS ?? ['/', '/ajustes', '/laboratorio',
  ...['corrida', 'ranking', 'ranking/pendientes', 'ranking/lista', 'ranking/laboratorio', 'panorama', 'mundo', 'arbol', 'atlas', 'mecanismos', 'citas', 'artefactos', 'calidad', 'investigacion'].map((x) => `/investigaciones/${inv}/${x}`)];

const cuenta = new Map();
const porRuta = new Map();
for (const r of rutas) {
  await p.goto(`http://127.0.0.1:8765/#${r}`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(2500);
  const trozos = await p.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.textContent || '').trim();
      if (t.length < 3) continue;
      const e = n.parentElement;
      if (!e || e.closest('script,style') || !e.offsetParent) continue;
      out.push(t);
    }
    return out;
  }).catch(() => []);
  const ES = /[ñ¿¡áéíóú]|\b(?:de|la|el|los|las|que|con|para|por|una|sin|del|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|ya|aún|entre|sobre|pero|cuando|donde)\b/i;
  const EN_SOLO = /^[\d\s.,:%()\-+/·$]+$/;
  for (const t of trozos) {
    if (EN_SOLO.test(t) || !ES.test(t)) continue;
    cuenta.set(t, (cuenta.get(t) || 0) + 1);
    if (!porRuta.has(r)) porRuta.set(r, new Set());
    porRuta.get(r).add(t);
  }
}
console.log('=== lo que sigue en castellano, por pantalla ===');
for (const [r, s] of porRuta) console.log(`  ${String(s.size).padStart(4)}  ${r}`);
const todas = [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n=== ${todas.length} frases distintas; las 45 que mas se repiten ===`);
for (const [t, n] of todas.slice(0, 45)) console.log(`  ${String(n).padStart(3)}x  ${t.slice(0, 110)}`);
await p.screenshot({ path: '/tmp/en_investigacion.png', fullPage: false });
await nav.close();
