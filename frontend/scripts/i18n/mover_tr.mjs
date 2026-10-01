// `const AYUDA = tr('...')` se evalua al importar y se queda en el idioma del
// arranque. Se le quita el tr() a la constante y se le pone a cada USO, que
// esta dentro de un componente y por tanto se reevalua en cada render.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const escribir = process.argv.includes('--escribir');
let total = 0;
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n')) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nombres = new Map();     // nombre -> { llamada, exportada }
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    const exportada = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const d of st.declarationList.declarations) {
      const ini = d.initializer;
      if (!ini || !ts.isIdentifier(d.name)) continue;
      if (ts.isCallExpression(ini) && ts.isIdentifier(ini.expression) && ini.expression.text === 'tr'
          && ini.arguments.length === 1 && ts.isStringLiteral(ini.arguments[0])) {
        nombres.set(d.name.text, { llamada: ini, exportada });
      }
    }
  }
  if (!nombres.size) continue;
  // usos (identificadores que no son la propia declaracion)
  const usos = [];
  const ver = (x) => {
    if (ts.isIdentifier(x) && nombres.has(x.text)) {
      const d = nombres.get(x.text);
      const esLaDeclaracion = x.parent && ts.isVariableDeclaration(x.parent) && x.parent.name === x;
      const esPropiedad = x.parent && ts.isPropertyAccessExpression(x.parent) && x.parent.name === x;
      const esClaveCorta = x.parent && ts.isShorthandPropertyAssignment(x.parent);
      const esExport = x.parent && (ts.isExportSpecifier(x.parent) || ts.isImportSpecifier(x.parent));
      if (!esLaDeclaracion && !esPropiedad && !esClaveCorta && !esExport && x.getStart() > d.llamada.getEnd()) usos.push(x);
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
  const fuera = [...nombres].filter(([, d]) => d.exportada).map(([n]) => n);
  console.log(`  ${f.replace('src/','')}: ${nombres.size} constantes, ${usos.length} usos${fuera.length ? `  (exportadas: ${fuera.join(', ')})` : ''}`);
  total += nombres.size;
  if (!escribir) continue;
  const ediciones = [];
  for (const [, d] of nombres) ediciones.push({ a: d.llamada.getStart(), b: d.llamada.getEnd(), texto: d.llamada.arguments[0].getText() });
  for (const u of usos) ediciones.push({ a: u.getStart(), b: u.getEnd(), texto: `tr(${u.text})` });
  ediciones.sort((x, y) => y.a - x.a);
  let salida = src;
  for (const e of ediciones) salida = salida.slice(0, e.a) + e.texto + salida.slice(e.b);
  writeFileSync(f, salida);
}
console.log(`\n${total} constantes descongeladas moviendo el tr() al uso`);
