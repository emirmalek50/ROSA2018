// Prueba de navegador aislada: datos sintéticos y ninguna llamada al backend.
// Uso: node scripts/probar-atlas3d.mjs [URL del Vite ya arrancado]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.route('**/api/**', (r) => r.abort());
  await page.route('**/__prueba_atlas3d', (r) => r.fulfill({ contentType: 'text/html', body: `
    <html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
    <script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = await import('/node_modules/.vite/deps/react.js');
    const {createRoot} = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {Atlas} = await import('/src/pantallas/Atlas.tsx');
    const {estadoDeMuestra} = await import('/src/datos/muestra.ts');
    const {ETIQUETAS_MAPA, DEFINICIONES_MAPA} = await import('/src/componentes/MapaEnfermedad.tsx');
    await import('/src/styles.css');
    const e = structuredClone(estadoDeMuestra());
    const inv = e.investigaciones[0];
    const regiones = ['hipocampo', 'plasma', 'lcr', 'corteza_prefrontal'];
    const hechos = e.hechos.filter(h => h.investigacionId === inv.id && h.tipo === 'hecho').slice(0,4);
    const hip = e.hipotesis.find(h => h.investigacionId === inv.id);
    inv.mapaEnfermedad = {ejes:{region:{},estadio:{},tipoCelular:{}}, celdas:regiones.map((region,i)=>({region, estadio:i%2?'leve':'preclinico', tipoCelular:'astrocito', hechos:hechos[i]?[hechos[i].id]:[], hipotesis:hip?[hip.id]:[], preguntas:[], cohortes:Array.from({length:i+1},(_,j)=>'Cohorte de prueba '+j), certezaMax:null,porMision:0})),huecos:[],sinEjes:0,hipotesisSinEjes:0,heredados:0,fecha:Date.now(),iteracion:1,etiquetas:ETIQUETAS_MAPA,definiciones:DEFINICIONES_MAPA};
    const root = createRoot(document.getElementById('root'));
    root.render(React.default.createElement(Atlas,{estado:e,inv}));
    window.cambiarInvestigacion = () => root.render(React.default.createElement(Atlas,{estado:{...e,investigaciones:[{...inv,id:'otra'}]},inv:{...inv,id:'otra'}}));
    </script></body></html>` }));
  await page.goto(`${base}/__prueba_atlas3d`);
  await page.waitForLoadState('networkidle');
  assert.deepEqual(errores, [], 'El atlas debe montar sin errores');
  await page.getByRole('button', { name: 'Vista 3D', exact: true }).click();
  const canvas = page.locator('.atlas-3d-canvas');
  await canvas.waitFor();
  await page.waitForFunction(() => document.querySelector('.atlas-3d-canvas')?.width > 300);
  const imagen = () => canvas.evaluate((c) => c.toDataURL());
  const inicial = await imagen();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  assert.notEqual(await imagen(), inicial, 'Las flechas deben girar el relieve');
  await page.getByRole('button', { name: 'Restablecer vista' }).click();
  await page.waitForTimeout(80);
  assert.equal(await imagen(), inicial, 'Restablecer debe recuperar exactamente la cámara');
  await canvas.screenshot({ path: '/tmp/atlas-cerebro-completo.png' });
  await page.getByRole('button', { name: 'Corte y evidencia', exact: true }).click();
  await page.waitForTimeout(150);
  assert.notEqual(await imagen(), inicial, 'El corte debe mostrar una representación distinta');
  await page.getByRole('button', { name: 'Cerebro completo', exact: true }).click();
  const selector = page.getByLabel('Seleccionar región del atlas 3D');
  await selector.selectOption('hipocampo');
  await page.locator('.atlas-panel h3').filter({ hasText: 'hipocampo' }).waitFor();
  await page.getByRole('button', { name: 'Vista 2D', exact: true }).click();
  assert.equal(await page.locator('path[data-clave="hipocampo"]').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Vista 3D', exact: true }).click();
  assert.equal(await selector.inputValue(), 'hipocampo');
  await page.getByRole('button', { name: 'Quitar la selección' }).click();
  // Comprueba el hit-test contra píxeles del lienzo real, sin simular callbacks.
  const caja = await canvas.boundingBox();
  let encontrado = false;
  for (let y = 0.25; y <= 0.75 && !encontrado; y += 0.1) {
    for (let x = 0.25; x <= 0.75; x += 0.1) {
      await page.mouse.move(caja.x + caja.width * x, caja.y + caja.height * y);
      if ((await page.locator('.atlas-3d-lectura').innerText()).includes('registros')) {
        await page.mouse.click(caja.x + caja.width * x, caja.y + caja.height * y);
        assert.notEqual(await selector.inputValue(), ''); encontrado = true; break;
      }
    }
  }
  assert.ok(encontrado, 'Una región visible debe poder seleccionarse con el ratón');
  const antesArrastre = await selector.inputValue();
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.mouse.down(); await page.mouse.move(caja.x + caja.width / 2 + 90, caja.y + caja.height / 2 + 30, { steps: 8 }); await page.mouse.up();
  assert.equal(await selector.inputValue(), antesArrastre, 'Arrastrar no debe seleccionar otra región');
  // Zoom repetido y vuelta completa: la cámara no atraviesa el volumen.
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Acercar atlas', exact: true }).click();
  await canvas.focus();
  for (let i = 0; i < 54; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await page.waitForTimeout(80);
  await page.getByRole('button', { name: 'Restablecer vista' }).click();
  await page.screenshot({ path: '/tmp/atlas3d-escritorio.png', fullPage: true });
  // Cambiar de fase actualiza las cifras sin desmontar la cámara.
  const fase = page.getByRole('group', { name: 'Fase de la enfermedad' }).getByRole('button').nth(1);
  const nodo = await canvas.elementHandle();
  await fase.click(); await page.waitForTimeout(150);
  assert.ok(await nodo.evaluate((c) => c.isConnected));
  for (const width of [900, 600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(100);
    assert.ok(await canvas.evaluate((c) => c.getBoundingClientRect().right <= innerWidth + 1), 'El 3D no debe desbordar el móvil');
  }
  await page.screenshot({ path: '/tmp/atlas3d-movil.png', fullPage: true });
  await page.getByRole('button', { name: 'Cerebro completo', exact: true }).click();
  await page.waitForTimeout(150);
  await canvas.screenshot({ path: '/tmp/atlas-cerebro-movil.png' });
  await page.evaluate(() => window.cambiarInvestigacion());
  await page.waitForTimeout(200);
  assert.equal(await selector.inputValue(), '');
  // Un navegador sin canvas conserva una salida explícita hacia el 2D.
  await page.getByRole('button', { name: 'Vista 2D', exact: true }).click();
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.getByRole('button', { name: 'Vista 3D', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Este navegador no permite' }).waitFor();
  await page.getByRole('button', { name: 'Vista 2D', exact: true }).click();
  assert.ok(await page.locator('.atlas-figura').isVisible());
  assert.deepEqual(errores, []);
  console.log('Atlas 3D: cámara, teclado, selección real, arrastre, filtros, 2D/3D, cambio de investigación y 4 anchos correctos.');
} finally { await browser.close(); }
