/** Prueba del artefacto, incluido file://, sin levantar ni consultar ROSA. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

const archivo = resolve(process.argv[2] || 'frontend/dist-portatil/ROSA-interactivo.html');
const html = await readFile(archivo, 'utf8');
assert.ok(html.includes("connect-src 'none'"), 'Debe bloquear conexiones');
assert.ok(!/<script[^>]+src=/.test(html), 'Todo JavaScript debe ir integrado');
assert.ok(!/<link[^>]+rel=["']stylesheet/.test(html), 'Todo CSS debe ir integrado');
const errores = [];
const consola = new VirtualConsole();
consola.on('jsdomError', e => errores.push(e.message));
const dom = new JSDOM(html, {
  url: `file://${archivo}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
  beforeParse(w) {
    w.Response = Response;
    w.structuredClone = structuredClone;
    w.fetch = () => { throw new Error('Se intentó salir a la red'); };
    w.matchMedia = query => ({ matches: query.includes('reduced-motion'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
  },
});
const w = dom.window;
const d = w.document;
async function hasta(condicion) {
  for (let n = 0; n < 60; n++) { if (condicion()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('No llegó el estado esperado: ' + d.querySelector('main')?.textContent?.slice(0,300));
}
try {
  await hasta(() => d.querySelector('main h2'));
  assert.ok(d.querySelector('.portatil-aviso'));
  assert.match(d.querySelector('main').textContent, /Investigaciones/);
  const antes = w.__ROSA_DEMO_STORAGE__.getItem('rosa-tema');
  assert.equal(antes, 'oscuro');
  const respuesta = await w.fetch('https://example.invalid/api/estado');
  assert.equal(respuesta.status,503);
  assert.match((await respuesta.json()).detail,/demo/);
  assert.throws(() => new w.EventSource('/api/eventos'),/demo/);
  assert.equal(w.SpeechRecognition,undefined);
  const enlace = d.querySelector('a[href="#/nueva"]');
  assert.ok(enlace);enlace.click();
  await hasta(() => /Nueva investigación/.test(d.querySelector('main h1')?.textContent || '') && d.querySelector('form'));
  assert.ok(d.querySelector('form input'));
  w.location.hash = '#/laboratorio';
  await hasta(() => /MAPT/.test(d.querySelector('main')?.textContent || ''));
  assert.ok(d.querySelector('.portatil-miniatura'));
  assert.ok(!d.querySelector('canvas'), 'El laboratorio no debe montar WebGL');
  w.location.hash = '#/investigaciones/inv-1/citas';
  await hasta(() => /Documento de muestra/.test(d.querySelector('main')?.textContent || ''));
  w.location.hash = '#/investigaciones/inv-1/mundo';
  await hasta(() => d.querySelector('textarea'));
  assert.ok(d.querySelector('textarea'));
  assert.deepEqual(errores,[]);
  console.log('OK: HTML autónomo en file://, navegación React, formulario, laboratorio sin 3D, citas y chat. Red bloqueada y almacenamiento aislado.');
} finally { w.close(); }
