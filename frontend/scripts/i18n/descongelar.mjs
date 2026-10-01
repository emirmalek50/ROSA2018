// Las cadenas que quedaron en una constante de modulo con tr() alrededor se
// traducen UNA VEZ, al importar el fichero, y no cambian cuando se pulsa EN.
// Aqui se les quita el tr() y se envuelve la constante entera en
// traducido(), que es un Proxy: traduce al leer, asi que reacciona al cambio
// de idioma y, de paso, no cuesta nada mientras nadie lea el valor.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const escribir = process.argv.includes('--escribir');
const soloEstos = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const ficheros = soloEstos.length ? soloEstos
  : execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n');

let constantes = 0, quitados = 0, directas = 0;
for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const trabajos = [];   // { decl, llamadas[], yaEnvuelta }
  for (const st of sf.statements) {
    const vs = ts.isVariableStatement(st) ? st
      : (ts.isExportAssignment(st) ? null : null);
    if (!vs) continue;
    for (const d of vs.declarationList.declarations) {
      if (!d.initializer) continue;
      const llamadas = [];
      const buscar = (x) => {
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr'
            && x.arguments.length === 1 && (ts.isStringLiteral(x.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(x.arguments[0]))) {
          // si esta dentro de una funcion, se queda: alli si se reevalua
          for (let p = x.parent; p && p !== d; p = p.parent) {
            if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) return;
          }
          llamadas.push(x);
        }
        ts.forEachChild(x, buscar);
      };
      buscar(d.initializer);
      if (!llamadas.length) continue;
      const ini = d.initializer;
      const esEstructura = ts.isObjectLiteralExpression(ini) || ts.isArrayLiteralExpression(ini)
        || (ts.isAsExpression(ini) && (ts.isObjectLiteralExpression(ini.expression) || ts.isArrayLiteralExpression(ini.expression)));
      const yaEnvuelta = ts.isCallExpression(ini) && ts.isIdentifier(ini.expression) && ini.expression.text === 'traducido';
      if (!esEstructura && !yaEnvuelta) { directas += llamadas.length; continue; }
      trabajos.push({ d, llamadas, yaEnvuelta });
      constantes++; quitados += llamadas.length;
    }
  }
  if (!trabajos.length) continue;
  console.log(`${String(quitados).padStart(5)}  ${f.replace('src/', '')}  (${trabajos.length} constantes)`);
  if (!escribir) continue;

  // de atras hacia delante para no mover posiciones
  let salida = src;
  const ediciones = [];
  for (const t of trabajos) {
    for (const c of t.llamadas) ediciones.push({ a: c.getStart(), b: c.getEnd(), texto: c.arguments[0].getText() });
    if (!t.yaEnvuelta) {
      const ini = t.d.initializer;
      ediciones.push({ a: ini.getStart(), b: ini.getStart(), texto: 'traducido(' });
      ediciones.push({ a: ini.getEnd(), b: ini.getEnd(), texto: ')' });
    }
  }
  ediciones.sort((x, y) => y.a - x.a || y.b - x.b);
  for (const e of ediciones) salida = salida.slice(0, e.a) + e.texto + salida.slice(e.b);
  if (!/import \{[^}]*\btraducido\b[^}]*\} from '[^']*idioma'/.test(salida)) {
    const m = salida.match(/import \{ ([^}]*) \} from '(\.{1,2}\/(?:lib\/)?idioma)';/);
    if (m) salida = salida.replace(m[0], `import { traducido, ${m[1]} } from '${m[2]}';`);
  }
  writeFileSync(f, salida);
}
console.log(`\n${quitados} tr() descongelados en ${constantes} constantes`);
console.log(`${directas} siguen congelados: const X = tr('...') suelto, sin estructura que envolver`);
