// Deja traducido de antemano lo que ROSA2018 escribió, para que quien la vea en
// inglés no espere. Sin esto, la primera vez que se abre una pantalla en
// inglés el modelo tiene que traducir lo nuevo al vuelo (Citas, con unas 250
// frases, tarda un par de minutos). Con esto, se ve traducida desde el
// principio. Lo que ya está en la caché no se vuelve a pagar.
//
// Recorre las pantallas de cada investigación con la interfaz en inglés,
// junta todo el texto que sigue en castellano y lo manda a /api/traducir
// hasta que no queda nada (o lo que queda lo rechazan las reglas).
//
//   node scripts/i18n/precalentar.mjs            todas las investigaciones
//   node scripts/i18n/precalentar.mjs inv-gfap   solo una
//
// Necesita el servidor en marcha. Cuesta llamadas al modelo la primera vez.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8765';
const token = readFileSync('/Users/emirmalek/traspaso-alzheimer-agente/datos/_token_interno', 'utf8').trim();
const cab = { 'x-rosa-interno': token, 'Content-Type': 'application/json', 'X-Rosa': '1' };
const PANTALLAS = ['corrida', 'ranking', 'ranking/pendientes', 'ranking/lista', 'ranking/laboratorio', 'panorama', 'mundo', 'arbol', 'atlas', 'mecanismos', 'citas', 'artefactos', 'calidad', 'investigacion'];

const estado = await (await fetch(`${BASE}/api/estado`, { headers: cab })).json();
const invs = process.argv[2] ? [process.argv[2]] : estado.investigaciones.map((i) => i.id);

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { 'x-rosa-interno': token } });
await ctx.route('**/api/acceso/estado', (r) => r.fulfill({ json: { correo: 'e@x.com', administrador: true, correoConfigurado: true, instalacionLocal: false } }));
// En inglés, y con el traductor de la página apagado: aquí se pide todo de una.
await ctx.route('**/api/traducir', (r) => r.fulfill({ json: { traducciones: {} } }));
await ctx.addInitScript(() => { localStorage.setItem('rosa.recorrido.v1', '1'); localStorage.setItem('rosa.idioma', 'en'); localStorage.setItem('rosa.modo', 'detalle'); });
const p = await ctx.newPage();

// La misma regla que lib/traductorDom.ts pareceCastellano.
const juntar = () => p.evaluate(() => {
  const TILDES = /[ñáéíóúü¿¡]/i;
  const ES = /\b(?:de|del|la|las|los|el|que|con|para|por|una|un|sin|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna|y|es|ya|desde|hasta|tras|muy|otra|otro|esta|este|esto|ese|esa|también|porque|según|nos|le|les|ni|o)\b/gi;
  const EN = /\b(?:the|of|and|to|is|in|for|with|on|at|by|an|be|this|that|from|are|was|were|it|as|or|not|has|have|which|its|yes|data|page)\b/gi;
  const es = (s) => {
    if (s.length < 3 || !/[a-záéíóúñ]{2}/i.test(s)) return false;
    if (TILDES.test(s)) return true;
    const c = s.replace(/\bet\s+al\.?/gi, ' '); // «et al.» es latin de una cita inglesa
    const a = new Set((c.match(ES) ?? []).map((x) => x.toLowerCase()));
    const b = new Set((c.match(EN) ?? []).map((x) => x.toLowerCase()));
    return a.size >= 2 || (a.size >= 1 && b.size === 0);
  };
  const NO = 'script, style, code, pre, kbd, samp, textarea, input, [contenteditable="true"], [data-sin-traducir], .mono';
  const ATR = ['title', 'aria-label', 'placeholder', 'alt'];
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const e = n.parentElement;
    if (!e || e.closest(NO)) continue;
    const t = (n.nodeValue ?? '').trim();
    if (t && es(t)) out.add(t);
  }
  // Y lo que se lee sin ser texto: el globo del ratón, lo que dice el lector
  // de pantalla, el aviso de una caja vacía y el alt de una imagen.
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
    if (el.closest('[data-sin-traducir]')) continue;
    for (const a of ATR) {
      const v = (el.getAttribute(a) ?? '').trim();
      if (v && es(v)) out.add(v);
    }
  }
  return [...out];
});

async function traducir(textos) {
  let hechas = 0, rechazadas = 0;
  const lotes = [];
  for (let i = 0; i < textos.length; i += 60) lotes.push(textos.slice(i, i + 60));
  // Tres a la vez, que es lo que admite el servidor.
  for (let i = 0; i < lotes.length; i += 3) {
    const rs = await Promise.all(lotes.slice(i, i + 3).map(async (l) => {
      const r = await fetch(`${BASE}/api/traducir`, { method: 'POST', headers: cab, body: JSON.stringify({ textos: l }) });
      return r.ok ? r.json() : { traducciones: {}, rechazadas: {} };
    }));
    for (const r of rs) { hechas += Object.keys(r.traducciones ?? {}).length; rechazadas += Object.keys(r.rechazadas ?? {}).length; }
  }
  return { hechas, rechazadas };
}

let total = 0, totalRech = 0;
const t0 = Date.now();
for (const inv of invs) {
  const textos = new Set();
  for (const pant of ['/', '/ajustes', '/laboratorio', ...PANTALLAS.map((x) => `/investigaciones/${inv}/${x}`)]) {
    await p.goto(`${BASE}/#${pant}`, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(2200);
    (await juntar().catch(() => [])).forEach((t) => textos.add(t));
  }
  const r = await traducir([...textos]);
  total += r.hechas; totalRech += r.rechazadas;
  console.log(`  ${inv}: ${textos.size} textos en castellano, ${r.hechas} traducidos, ${r.rechazadas} rechazados por las reglas  (${Math.round((Date.now() - t0) / 1000)} s)`);
}
console.log(`\n${total} traducidos, ${totalRech} rechazados, en ${Math.round((Date.now() - t0) / 1000)} s`);
await nav.close();
