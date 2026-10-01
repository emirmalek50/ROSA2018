// Cadenas que mi codemod envolvio pero que son IDENTIFICADORES: valor de una
// propiedad que nombra o enlaza (id, clave, de, a, origen, destino...).
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const CLAVES_DE_ID = new Set(['id', 'clave', 'key', 'de', 'a', 'origen', 'destino', 'desde', 'hasta', 'ref', 'slug', 'ruta', 'path', 'nodo', 'padre', 'hijo', 'idNodo', 'idHecho', 'idFuente', 'idHipotesis', 'hipotesisId', 'fuenteId', 'nombreClave', 'valor', 'codigo']);
const ficheros = execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n');
let n = 0;
for (const f of ficheros) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr' && x.arguments.length === 1) {
      const p = x.parent;
      if (p && ts.isPropertyAssignment(p) && CLAVES_DE_ID.has(p.name.getText())) {
        const { line } = sf.getLineAndCharacterOfPosition(x.getStart());
        console.log(`  ${f}:${line + 1}  ${p.name.getText()}: ${x.arguments[0].getText().slice(0, 70)}`);
        n++;
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
console.log(`\n${n} identificadores envueltos por error`);
