// Segunda parte del codemod: las cadenas de .tsx/.ts que NO son texto JSX y
// que el primer paso no tocaba. Props de componentes, ternarios, valores de
// objeto, elementos de array, argumentos y returns.
//
// LO QUE NO SE ENVUELVE, y es lo unico que importa aqui: una cadena que se
// COMPARA. `if (x === 'sostenida')` con tr() dentro dejaria de ser cierto en
// ingles, y el fallo no saldria en las pruebas, que corren en castellano
// (donde tr() devuelve lo mismo). Por eso se excluyen comparaciones, `case`,
// claves de objeto, acceso indexado y los metodos que buscan por valor
// (includes, startsWith, has, get...). Ante la duda, no se envuelve: dejar
// una frase sin traducir se ve; romper una comparacion, no.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Es texto si tiene un espacio o una tilde y no parece codigo ni un
// identificador. Mas ancho que buscar palabras castellanas: «casi perfecto»
// no lleva ninguna y se ve en pantalla igual.
function pareceTexto(t) {
  const s = t.trim();
  if (s.length < 4) return false;
  if (!/\s/.test(s) && !/[ñáéíóúÁÉÍÓÚÑ]/.test(s)) return false;
  if (/^[a-z0-9_.\/-]+$/i.test(s)) return false;
  if (/[<>{}`$\\|]|=>|\bfunction\b|\bconst\b|^\s*[.#]/.test(s)) return false;
  if (/^[A-Z_]+$/.test(s)) return false;            // CONSTANTE
  if (/^\d[\d\s.,:%+-]*$/.test(s)) return false;    // solo numeros
  if (/^(?:https?:|\/|\.\.?\/)/.test(s)) return false;
  // Lo mismo que sacan los desenvolver_*.mjs. Tienen que ser las MISMAS
  // reglas: con reglas distintas, este volvia a envolver lo que aquellos
  // quitaban (colores, clases, trazados) y se deshacian el uno al otro. Paso
  // el 2 de octubre de 2026 y llego a un commit sin que nada lo dijera.
  if (/var\(--|^-?[\d.]+%\s|^(?:center|left|right|top|bottom)\b/.test(s)) return false;
  if (/^(?:rgba?|hsla?)\(/i.test(s) || /^#[0-9a-f]{3,8}$/i.test(s)) return false;
  if (/^[Mm][\s-]?-?[\d.]+[\s,]/.test(s)) return false;
  if (/^(?:anthropic|openai|google|meta|mistral|xai)\//.test(s)) return false;
  if (/^(?:CC[ -]|MIT|Apache|GPL|BSD|ODbL)\b/.test(s)) return false;  // una licencia se llama como se llama
  // Un selector CSS: «script, style, code, [data-sin-traducir], .mono».
  if (/\[[\w-]+(?:=[^\]]*)?\]|(?:^|,\s*)\.[a-z][\w-]*/i.test(s) && s.split(',').every((x) => /^\s*[\w.#\[\]="\-]+\s*$/.test(x))) return false;
  const fichas = s.split(/\s+/);
  if (fichas.every((f) => /^[a-z][a-z0-9-]*$/.test(f)) && fichas.some((f) => f.includes('-'))) return false;
  return /[a-záéíóúñ]/i.test(s);
}
const METODOS_DE_BUSQUEDA = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'has', 'get', 'set', 'delete', 'add', 'match', 'search', 'split', 'join', 'replace', 'replaceAll', 'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute', 'getItem', 'setItem', 'removeItem', 'localeCompare', 'normalize', 'padStart', 'padEnd', 'repeat', 'test', 'exec', 'toFixed']);
const PROPS_QUE_NO_SE_VEN = new Set(['className', 'id', 'key', 'type', 'name', 'htmlFor', 'role', 'href', 'src', 'rel', 'target', 'method', 'action', 'value', 'data-tipo', 'data-eje', 'data-estado', 'style', 'xmlns', 'd', 'fill', 'stroke', 'viewBox', 'transform', 'points', 'rx', 'ry', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'preserveAspectRatio', 'strokeLinecap', 'strokeLinejoin', 'strokeWidth', 'fontFamily', 'textAnchor', 'dominantBaseline', 'autoComplete', 'inputMode', 'pattern', 'accept', 'encType']);

function noSeToca(n) {
  const p = n.parent;
  if (!p) return true;
  // comparaciones y concatenaciones de comparacion
  if (ts.isBinaryExpression(p)) {
    const k = p.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
         ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(k)) return true;
  }
  if (ts.isCaseClause(p)) return true;
  // clave de objeto, no valor
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  // argumento de un metodo que busca por valor
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)
      && METODOS_DE_BUSQUEDA.has(p.expression.name.text)) return true;
  if (ts.isCallExpression(p) && ts.isIdentifier(p.expression)
      && ['tr', 'trc', 'trp', 'traducido', 'require', 'Symbol'].includes(p.expression.text)) return true;
  // prop que no se ve
  if (ts.isJsxAttribute(p) && PROPS_QUE_NO_SE_VEN.has(p.name.getText())) return true;
  // dentro de un traducido(...) o de un tr(...)
  for (let q = p; q; q = q.parent) {
    if (ts.isCallExpression(q) && ts.isIdentifier(q.expression) && ['traducido', 'tr', 'trc', 'trp'].includes(q.expression.text)) return true;
  }
  return false;
}

// Primera pasada sobre TODO el arbol: que cadenas se comparan en alguna
// parte. Esas no se envuelven aunque en otro sitio se vean en pantalla: una
// comparacion rota en ingles no la cazan las pruebas, que corren en
// castellano. Mejor una frase sin traducir que un `if` que deja de valer.
const PROHIBIDAS = new Set();
// Las listas de vocabulario para comparar texto, nombradas una a una en
// no-traducir.json (sale de las constantes de acciones.ts). Un pase del
// codemod las volvio a envolver despues de haberlas sacado, y el catalogo
// las tradujo: la deteccion de negaciones se habria roto en ingles sin que
// nada lo dijera. Por nombre no hay heuristica que fallar.
for (const t of JSON.parse(readFileSync('scripts/i18n/no-traducir.json', 'utf8'))) PROHIBIDAS.add(t);
{
  // Sin los tests: `expect(x).toBe('PATOLOGÍA')` compara lo que se VE, no es
  // una comparacion del programa, y con los tests dentro se quedaban sin
  // envolver «Al laboratorio», «PATOLOGÍA» o «Búsqueda de la corrida» (2 de
  // octubre de 2026). Los tests corren en castellano, donde tr() es la
  // identidad, asi que envolver no los rompe.
  const todos = execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '\\.test\\.'", { encoding: 'utf8' }).trim().split('\n');
  for (const f of todos) {
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const ver = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        const p = n.parent;
        const comparado = p && ((ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind))
          || ts.isCaseClause(p)
          || (ts.isPropertyAssignment(p) && p.name === n)
          || (ts.isElementAccessExpression(p) && p.argumentExpression === n)
          || ts.isLiteralTypeNode(p)
          || (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && METODOS_DE_BUSQUEDA.has(p.expression.name.text)));
        if (comparado) PROHIBIDAS.add(n.text);
      }
      ts.forEachChild(n, ver);
    };
    ver(sf);
  }
}
console.log(`${PROHIBIDAS.size} cadenas se comparan en alguna parte: esas no se tocan\n`);

const soloEstos = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const escribir = process.argv.includes('--escribir');
// idioma.ts define tr() (no puede importarse a si mismo) y ademas los
// nombres de los idiomas van cada uno en el suyo: «Español», no «Spanish».
// idioma.ts define tr(); y los reductores (datos/acciones.ts) escriben en el
// estado, que no puede depender del idioma de quien mira: ver
// desenvolver_estado.mjs.
const FUERA = new Set(['src/lib/idioma.ts', 'src/datos/acciones.ts']);
const ficheros = (soloEstos.length ? soloEstos
  : execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '.test.' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n')).filter((f) => !FUERA.has(f));

let total = 0;
const todas = new Set();
for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sitios = [];
  const visitar = (n) => {
    let enLista = false;
    for (let q = n.parent; q; q = q.parent) {
      if (ts.isVariableDeclaration(q) && ts.isIdentifier(q.name) && /^(?:VACIAS|DIRECCION|NUMEROS|NEGACIONES|GENERICOS|PARADAS|CAUSALES|TEMPORALES|STOPWORDS)/.test(q.name.text)) { enLista = true; break; }
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !noSeToca(n) && !enLista) {
      const t = n.text;
      if (pareceTexto(t) && !PROHIBIDAS.has(t)) sitios.push(n);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  if (!sitios.length) continue;
  total += sitios.length;
  sitios.forEach((n) => todas.add(n.text));
  console.log(`${String(sitios.length).padStart(4)}  ${f}`);
  if (!escribir) continue;

  let salida = src;
  for (const n of [...sitios].sort((a, b) => b.getStart() - a.getStart())) {
    const a = n.getStart(), b = n.getEnd();
    const enJsxAttr = ts.isJsxAttribute(n.parent);
    const texto = salida.slice(a, b);
    salida = salida.slice(0, a) + (enJsxAttr ? `{tr(${texto})}` : `tr(${texto})`) + salida.slice(b);
  }
  if (!/import \{[^}]*\btr\b[^}]*\} from '[^']*idioma'/.test(salida)) {
    const sf2 = ts.createSourceFile(f, salida, ts.ScriptTarget.Latest, true);
    const imports = sf2.statements.filter(ts.isImportDeclaration);
    const ya = imports.find((i) => /idioma'$/.test(i.moduleSpecifier.getText().replace(/['"]/g, '') + "'"));
    const prof = f.split('/').length - 2;
    const ruta = f.startsWith('src/lib/') ? './idioma' : (prof === 0 ? './lib/idioma' : '../lib/idioma');
    if (ya) {
      const t = ya.getText();
      salida = salida.replace(t, t.replace(/import \{ /, 'import { tr, '));
    } else {
      const corte = imports.length ? imports[imports.length - 1].getEnd() : (sf2.statements[0]?.getStart() ?? 0);
      salida = salida.slice(0, corte) + `\nimport { tr } from '${ruta}';` + salida.slice(corte);
    }
  }
  writeFileSync(f, salida);
}
console.log(`\n${total} sitios, ${todas.size} cadenas distintas`);
writeFileSync('/tmp/cadenas2.json', JSON.stringify([...todas].sort(), null, 1));
