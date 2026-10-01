import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const formas = new Map(); const sueltas = [];
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr','trc','trp'].includes(x.expression.text)) {
      let enFuncion = false;
      for (let p = x.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)||ts.isFunctionExpression(p)||ts.isArrowFunction(p)||ts.isMethodDeclaration(p)) { enFuncion = true; break; }
      if (!enFuncion) {
        // sube hasta la declaracion de nivel superior y mide la profundidad
        let prof = 0, decl = null;
        for (let p = x.parent; p; p = p.parent) {
          if (ts.isObjectLiteralExpression(p) || ts.isArrayLiteralExpression(p)) prof++;
          if (ts.isVariableDeclaration(p)) { decl = p; break; }
        }
        if (!decl) { sueltas.push(`${f}: ${x.getText().slice(0,50)}`); return; }
        const clave = prof === 0 ? 'directa (const X = tr(...))' : `dentro de estructura, profundidad ${prof}`;
        formas.set(clave, (formas.get(clave)||0)+1);
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
for (const [k,v] of [...formas].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`  ${String(sueltas.length).padStart(4)}  fuera de una declaracion`);
for (const s of sueltas.slice(0,6)) console.log('        ', s.replace('src/',''));
