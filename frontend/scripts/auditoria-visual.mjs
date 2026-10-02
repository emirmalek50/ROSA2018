// Auditoria visual de Rosa: abre cada pantalla en un Chromium real a varios
// anchos y en los dos modos, y busca lo que una prueba de DOM no ve: textos
// recortados por su caja, textos que se superponen, y contenido que se sale
// del ancho de la ventana. Saca capturas a frontend/auditoria/ y un informe
// JSON. Uso: node scripts/auditoria-visual.mjs [url base] (por defecto el
// servidor de Rosa en 127.0.0.1:8765, que sirve el bundle construido).

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const ANCHOS = [1440, 1100, 800, 420];
const MODOS = ['sencillo', 'detalle'];
const SALIDA = new URL('../auditoria/', import.meta.url).pathname;
mkdirSync(SALIDA, { recursive: true });

// El estado está tras la puerta: se lee con la credencial interna del servidor
// (datos/_token_interno), la misma que usan después las páginas del navegador.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let tokenInterno = '';
try {
  tokenInterno = readFileSync(resolve(process.cwd(), '..', 'datos', '_token_interno'), 'utf8').trim();
} catch {
  console.warn('Sin datos/_token_interno: si Rosa exige sesión, todas las pantallas serán la puerta.');
}
const respuestaEstado = await fetch(`${BASE}/api/estado`, { headers: tokenInterno ? { 'x-rosa-interno': tokenInterno } : {} });
if (!respuestaEstado.ok) {
  console.error(`No se pudo leer el estado (${respuestaEstado.status}); sin credencial interna la auditoría solo vería la puerta.`);
  process.exit(1);
}
const estado = await respuestaEstado.json();
const inv = estado.investigaciones[0]?.id;
const hip = estado.hipotesis.find((h) => h.investigacionId === inv)?.id;
const rutas = ['#/', '#/nueva', '#/ajustes'];
if (inv) {
  for (const p of ['corrida', 'hipotesis', 'ranking', 'panorama', 'mundo', 'arbol', 'artefactos', 'investigacion']) rutas.push(`#/investigaciones/${inv}/${p}`);
  rutas.push(`#/investigaciones/${inv}/hipotesis/laboratorio`);
  if (hip) rutas.push(`#/investigaciones/${inv}/hipotesis/${hip}`);
}

const AUDITAR = () => {
  const problemas = [];
  const visible = (el) => {
    // El texto solo para lectores de pantalla esta recortado a proposito (1 px
    // con overflow oculto): no es un fallo de maqueta y ensuciaba el informe
    // con 56 falsos positivos (28 de septiembre de 2026).
    if (el.closest('.sr-only')) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none')) return false;
    // Dentro de un <details> cerrado no hay nada que ver (Chromium mantiene la
    // caja pero no lo pinta): no cuenta, salvo el propio summary.
    const cerrado = el.closest('details:not([open])');
    if (cerrado && !(el.closest('summary') && el.closest('summary').parentElement === cerrado)) return false;
    let a = el.parentElement;
    while (a && a !== document.body) {
      if (getComputedStyle(a).contentVisibility === 'hidden') return false;
      a = a.parentElement;
    }
    return true;
  };
  // Un antecesor que se desplaza en horizontal a proposito (el hilo del proceso, una tabla ancha).
  const enScrollHorizontal = (el) => {
    let a = el.parentElement;
    while (a && a !== document.body) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
      a = a.parentElement;
    }
    return false;
  };
  const descr = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}: "${(el.textContent || '').trim().slice(0, 60)}"`;
  const todos = [...document.querySelectorAll('body *')].filter((el) => !el.closest('svg') && !el.closest('.recorrido-fondo') && visible(el));
  // 1. Texto recortado por su propia caja (overflow oculto y contenido mas ancho).
  for (const el of todos) {
    const cs = getComputedStyle(el);
    const tieneTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!tieneTexto) continue;
    const oculto = ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflow);
    if (oculto && cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp === 'none' && el.scrollWidth > el.clientWidth + 2) problemas.push({ tipo: 'texto recortado por su caja', el: descr(el), extra: `${el.scrollWidth} > ${el.clientWidth}` });
    // 2. Texto recortado por un antecesor con overflow oculto.
    const r = el.getBoundingClientRect();
    let a = el.parentElement;
    while (a && a !== document.body) {
      const ca = getComputedStyle(a);
      if (['hidden', 'clip'].includes(ca.overflowX) || ['hidden', 'clip'].includes(ca.overflow)) {
        const ra = a.getBoundingClientRect();
        if (r.right > ra.right + 2 || r.left < ra.left - 2) {
          if (ca.textOverflow !== 'ellipsis' && getComputedStyle(el).webkitLineClamp === 'none') problemas.push({ tipo: 'texto recortado por un antecesor', el: descr(el), extra: `antecesor ${descr(a).slice(0, 40)}` });
        }
        break;
      }
      a = a.parentElement;
    }
    // 3. Texto que se sale de la ventana.
    if (r.right > window.innerWidth + 2 && cs.position !== 'fixed' && !enScrollHorizontal(el)) problemas.push({ tipo: 'texto fuera de la ventana', el: descr(el), extra: `derecha ${Math.round(r.right)} > ${window.innerWidth}` });
  }
  // 4. Textos superpuestos: hojas con texto cuyas cajas se pisan (sin ser una antecesora de la otra).
  // Se comparan las cajas de cada linea (getClientRects), no la caja envolvente:
  // un texto en linea que ocupa dos renglones envuelve al chip que le sigue sin
  // pisarlo, y con la caja envolvente saldria como superposicion falsa.
  const hojas = todos.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && getComputedStyle(el).position !== 'fixed');
  const cajas = hojas.map((el) => ({ el, rs: [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0), env: el.getBoundingClientRect() }));
  const pisa = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (x <= 2 || y <= 2) return false;
    const menor = Math.min(a.width * a.height, b.width * b.height);
    return menor > 0 && (x * y) / menor > 0.3;
  };
  for (let i = 0; i < cajas.length; i++) {
    for (let j = i + 1; j < cajas.length; j++) {
      const A = cajas[i], B = cajas[j];
      if (!pisa(A.env, B.env)) continue; // criba rapida
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const posA = getComputedStyle(A.el).position, posB = getComputedStyle(B.el).position;
      if (posA === 'absolute' || posB === 'absolute') continue;
      if (A.rs.some((ra) => B.rs.some((rb) => pisa(ra, rb)))) problemas.push({ tipo: 'textos superpuestos', el: descr(A.el), extra: `con ${descr(B.el)}` });
    }
  }
  // 5. Titulos pegados al bloque anterior: falta de aire (lo que se ve como
  //    "un texto demasiado cerca de otra cosa"). Menos de 10 px es pegado.
  //    Se mira cualquier titulo (h2, h3, "que toca"), no solo los que estan
  //    dentro de una .seccion: el 14 de septiembre una clase rota dejo un
  //    titulo sin .seccion alrededor y esta regla lo saltaba en silencio. Se
  //    sube por los ancestros hasta encontrar un hermano anterior que quede
  //    por encima (no al lado, como el chevron de plegar) y se mide el hueco.
  for (const h of document.querySelectorAll('h2, h3, .quetoca')) {
    if (!visible(h) || h.closest('.recorrido, .cajon, .grafo-detalle, table')) continue;
    const rh = h.getBoundingClientRect();
    let sec = h;
    let prev = null;
    while (sec && sec !== document.body) {
      let p = sec.previousElementSibling;
      while (p && !visible(p)) p = p.previousElementSibling;
      if (p && p.getBoundingClientRect().bottom <= rh.top + 2) {
        prev = p;
        break;
      }
      // Un hermano al lado (el chevron de plegar, un chip) no cuenta: se sigue subiendo.
      sec = sec.parentElement;
    }
    if (!prev) continue;
    const rp = prev.getBoundingClientRect();
    // Un antetitulo (el tipo de artefacto, la fila de chips de una hipotesis)
    // va a proposito a 8 px de su titulo dentro de la misma tarjeta: no es un
    // bloque ajeno pegado. Se reconoce por ser bajo y hermano directo.
    const antetitulo = prev.parentElement === sec.parentElement && prev.matches('.artefacto-tipo, .acciones, .meta, .chips, .chip, .kicker');
    if (antetitulo && rh.top - rp.bottom >= 6) continue;
    if (rh.top - rp.bottom < 10) problemas.push({ tipo: 'titulo pegado al bloque anterior', el: descr(h), extra: `${Math.round(rh.top - rp.bottom)} px sobre ${descr(prev).slice(0, 40)}` });
  }
  // 6. Tarjetas de una misma fila de rejilla que no empiezan a la misma altura.
  for (const rej of document.querySelectorAll('.rejilla-2, .rejilla-3')) {
    if (!visible(rej)) continue;
    const hijos = [...rej.children].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (let i = 0; i < hijos.length; i++) {
      for (let j = i + 1; j < hijos.length; j++) {
        const A = hijos[i], B = hijos[j];
        const mismaFila = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top) > 20 && Math.abs(A.r.left - B.r.left) > 20;
        if (mismaFila && Math.abs(A.r.top - B.r.top) > 3) problemas.push({ tipo: 'tarjetas desalineadas en la rejilla', el: descr(A.el), extra: `${Math.round(A.r.top)} frente a ${Math.round(B.r.top)} de ${descr(B.el).slice(0, 40)}` });
      }
    }
  }
  // 7. Scroll horizontal del documento.
  if (document.documentElement.scrollWidth > window.innerWidth + 2) problemas.push({ tipo: 'scroll horizontal de la pagina', el: 'html', extra: `${document.documentElement.scrollWidth} > ${window.innerWidth}` });
  return problemas;
};

// La puerta de Rosa: sin sesión no se carga nada. La auditoría entra con la
// credencial interna del servidor (datos/_token_interno, solo legible en la
// máquina donde corre Rosa) y simula el estado de sesión que la puerta pide.
const SESION_AUDITORIA = { correo: 'auditoria@alzheimerproject.com', administrador: false, correoConfigurado: true, instalacionLocal: false };

const navegador = await chromium.launch();
const informe = [];
for (const modo of MODOS) {
  for (const ancho of ANCHOS) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: 1000 }, colorScheme: 'dark', extraHTTPHeaders: tokenInterno ? { 'x-rosa-interno': tokenInterno } : {} });
    await contexto.route('**/api/acceso/estado', (r) => r.fulfill({ json: SESION_AUDITORIA }));
    await contexto.addInitScript((m) => {
      localStorage.setItem('rosa.recorrido.v1', '1');
      localStorage.setItem('rosa.modo', m);
    }, modo);
    const pagina = await contexto.newPage();
    for (const ruta of rutas) {
      await pagina.goto(`${BASE}/${ruta}`, { waitUntil: 'networkidle' });
      await pagina.waitForTimeout(900);
      // Abrir lo plegado de detalle para auditarlo tambien.
      await pagina.evaluate(() => document.querySelectorAll('.seccion-plegar[aria-expanded="false"]').forEach((b) => b.click()));
      await pagina.waitForTimeout(500);
      const problemas = await pagina.evaluate(AUDITAR);
      const nombre = `${modo}-${ancho}-${ruta.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'inicio'}`;
      await pagina.screenshot({ path: `${SALIDA}${nombre}.png`, fullPage: true });
      informe.push({ modo, ancho, ruta, problemas });
      if (problemas.length) console.log(`${nombre}: ${problemas.length} problema(s)`);
    }
    await contexto.close();
  }
}
await navegador.close();
writeFileSync(`${SALIDA}informe.json`, JSON.stringify(informe, null, 1));
const total = informe.reduce((s, x) => s + x.problemas.length, 0);
const porTipo = {};
for (const x of informe) for (const p of x.problemas) porTipo[p.tipo] = (porTipo[p.tipo] ?? 0) + 1;
console.log(`\n${total} problemas en ${informe.length} pantallas. Por tipo:`, porTipo);
console.log(`Informe: ${SALIDA}informe.json`);
