// Los cinco estados de la cara de ROSA2018, uno al lado de otro. Se monta en
// una pagina suelta porque en el chat solo se ve uno cada vez.
import { chromium } from 'playwright';
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 760, height: 260 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
// reutiliza las variables de color de ROSA2018 ya cargadas
await p.setContent(`<html class="dark"><head>${await p.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet],style')].map((e) => e.outerHTML).join(''))}</head>
<body style="background:var(--bg);padding:28px;font-family:var(--font-sans)">
<div id="r" style="display:flex;gap:34px;align-items:center"></div></body></html>`, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.evaluate(() => {
  const d = document.getElementById('r');
  for (const e of ['quieta', 'escuchando', 'pensando', 'hablando', 'dormida']) {
    const c = document.createElement('div');
    c.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--text-3);font-size:12px';
    c.innerHTML = `<div class="persona persona-${e}" style="width:56px;height:56px">
      ${e === 'escuchando' || e === 'hablando' ? '<i class="persona-halo"></i>' : ''}
      <span class="persona-orbe"><svg viewBox="0 0 100 100">
        <defs>
          <radialGradient id="n-${e}" cx="38%" cy="32%">
            <stop offset="0%" stop-color="var(--accent-contrast,#fff)" stop-opacity=".95"/>
            <stop offset="45%" stop-color="var(--accent)" stop-opacity=".9"/>
            <stop offset="100%" stop-color="var(--accent-strong,var(--accent))"/>
          </radialGradient>
          <radialGradient id="b-${e}" cx="50%" cy="50%">
            <stop offset="55%" stop-color="transparent"/><stop offset="100%" stop-color="var(--accent)" stop-opacity=".35"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="url(#n-${e})"/>
        <ellipse cx="50" cy="34" rx="30" ry="19" fill="var(--accent-contrast,#fff)" opacity=".14"/>
        <ellipse cx="50" cy="68" rx="24" ry="14" fill="var(--bg)" opacity=".12"/>
        <circle cx="50" cy="50" r="46" fill="url(#b-${e})"/>
      </svg></span></div><span>${e}</span>`;
    d.appendChild(c);
  }
});
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/persona.png' });
console.log('  captura: /tmp/persona.png');
await nav.close();
