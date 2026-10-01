// Cuantos tr() quedaron dentro de una constante de modulo (se evaluan al
// importar y no reaccionan al cambio de idioma) y cuantos dentro de una
// funcion o componente (se vuelven a evaluar en cada render, y si funcionan).
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
let congeladas = 0, vivas = 0;
const porFichero = new Map();
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr', 'trc', 'trp'].includes(x.expression.text)) {
      // ¿hay una funcion entre esta llamada y la raiz?
      let dentroDeFuncion = false;
      for (let p = x.parent; p; p = p.parent) {
        if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p) || ts.isGetAccessor(p)) { dentroDeFuncion = true; break; }
      }
      if (dentroDeFuncion) vivas++;
      else { congeladas++; porFichero.set(f, (porFichero.get(f) || 0) + 1); }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
console.log(`${vivas} dentro de funciones: se reevaluan, funcionan`);
console.log(`${congeladas} en constantes de modulo: CONGELADAS al importar\n`);
for (const [f, n] of [...porFichero].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(n).padStart(4)}  ${f.replace('src/', '')}`);
