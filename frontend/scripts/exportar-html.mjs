/** Compila los componentes reales en un HTML autónomo con fixtures locales.
 * No usa Vite env, bases de datos, capturas ni endpoints del proyecto. */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const salida = resolve(process.argv[2] || resolve(frontend, 'dist-portatil/ROSA-interactivo.html'));
const aliases = new Map([
  ['Acceso', 'Acceso.tsx'], ['Atlas3D', 'Sin3D.tsx'], ['Cerebro3D', 'Sin3D.tsx'], ['visorMolecular', 'visor.ts'],
]);
const marca = `data:image/png;base64,${(await readFile(resolve(frontend, 'public/arbol-marca.png'))).toString('base64')}`;

const resultado = await build({
  absWorkingDir: frontend, entryPoints: ['portatil/entrada.ts'], bundle: true,
  write: false, outfile: 'ROSA-interactivo.js', format: 'iife', platform: 'browser',
  target: 'es2022', jsx: 'automatic', minify: true, legalComments: 'none', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined',
    localStorage: '__ROSA_DEMO_STORAGE__', sessionStorage: '__ROSA_DEMO_STORAGE__', 'window.localStorage': '__ROSA_DEMO_STORAGE__' },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  plugins: [{ name: 'copia-portatil', setup(b) {
    b.onResolve({ filter: /\/(Acceso|Atlas3D|Cerebro3D|visorMolecular)$/ }, args => {
      const nombre = args.path.split('/').at(-1);
      return { path: resolve(frontend, 'portatil', aliases.get(nombre)) };
    });
    b.onLoad({ filter: /\/src\/.*\.[jt]sx?$/ }, async args => {
      let contents = await readFile(args.path, 'utf8');
      contents = contents.replaceAll('"/arbol-marca.png"', JSON.stringify(marca));
      if (args.path.endsWith('/ModeloDeMundo.tsx')) {
        const original = 'const modo: ModoPregunta = estado.conexion === "en_linea" ? "bases" : "local";';
        if (!contents.includes(original)) throw new Error('Cambió el selector del asistente; revisar la demo');
        contents = contents.replace(original, 'const modo: ModoPregunta = "bases";');
        contents = contents.replace('ROSA consulta todo el proyecto y sus bases públicas. Los cambios que le pidas se revisan y aplican aquí.', 'Demo interactiva: respuestas de ejemplo, sin IA ni consultas externas. Los cambios se reinician al recargar.');
      }
      if (args.path.endsWith('/Arbol.tsx')) {
        contents = contents.replace("const [tipoVista, setTipoVista] = useState<Vista>(leerVista);", "const [tipoVista, setTipoVista] = useState<Vista>('plana');");
        contents = contents.replace("onClick={() => cambiarVista('3d')}", "disabled");
      }
      if (args.path.endsWith('/Laboratorio.tsx')) {
        const arbol = ts.createSourceFile(args.path, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const miniatura = arbol.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'Miniatura');
        if (!miniatura) throw new Error('No se encuentra la miniatura del laboratorio');
        contents = contents.slice(0, miniatura.getStart(arbol)) + 'function Miniatura() { return <div className="portatil-sin-3d portatil-miniatura">Visualización 3D omitida</div>; }' + contents.slice(miniatura.end);
      }
      return { contents, loader: extname(args.path) === '.tsx' ? 'tsx' : 'ts' };
    });
  } }],
});
if (Object.keys(resultado.metafile.inputs).some(p => p.includes('node_modules/molstar') || /cerebro3d\/.+\.bin$/.test(p))) throw new Error('La copia incluye recursos 3D');
const js = resultado.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = resultado.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';
const bootstrap = `
var __ROSA_DEMO_STORAGE__ = (function () {
  var memoria = new Map();
  return {getItem:function(k){return memoria.has(k)?memoria.get(k):null},setItem:function(k,v){memoria.set(k,String(v))},removeItem:function(k){memoria.delete(k)},clear:function(){memoria.clear()}};
})();
__ROSA_DEMO_STORAGE__.setItem('rosa-tema','oscuro');
__ROSA_DEMO_STORAGE__.setItem('rosa.recorrido.v1','1');
document.documentElement.dataset.theme='dark';
// Todo fetch termina aquí. Nunca se delega en el fetch nativo.
window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;
window.fetch=async function(){return new Response(JSON.stringify({detail:'Esta función requiere el servidor y no se ejecuta en la demo.'}),{status:503,headers:{'Content-Type':'application/json'}})};
window.EventSource=class {constructor(){throw new Error('SSE no disponible en la demo')}};
window.WebSocket=class {constructor(){throw new Error('Conexiones no disponibles en la demo')}};
`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#101010"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src blob:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"><link rel="icon" href="${marca}"><title>ROSA · Demo interactiva</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><noscript>Activa JavaScript para abrir la interfaz de ROSA.</noscript><script>${bootstrap}</script><script>${js}</script></body></html>`;
await mkdir(dirname(salida), { recursive: true });
await writeFile(salida, html);
console.log(`HTML creado: ${salida} (${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB)`);
