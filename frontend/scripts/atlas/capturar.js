// Captura previa.html con Playwright: la página entera a 1100x720 y, si se piden,
// recortes ampliados (x,y,ancho,alto en píxeles de la página, factor de escala 3).
// Uso: node capturar.js <html> <png_salida> [x,y,w,h nombre]...
const { chromium } = require('/Users/emirmalek/traspaso-alzheimer-agente/frontend/node_modules/playwright');
(async () => {
  const [html, salida, ...recortes] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1100, height: 720 } });
  await p.goto('file://' + html);
  await p.waitForTimeout(150);
  await p.screenshot({ path: salida });
  await p.close();
  if (recortes.length) {
    const z = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 3 });
    await z.goto('file://' + html);
    await z.waitForTimeout(150);
    for (let i = 0; i + 1 < recortes.length; i += 2) {
      const [x, y, w, h] = recortes[i].split(',').map(Number);
      await z.screenshot({ path: salida.replace(/\.png$/, '_' + recortes[i + 1] + '.png'), clip: { x, y, width: w, height: h } });
    }
  }
  await b.close();
})();
