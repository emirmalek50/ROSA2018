import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr','trc','trp'].includes(x.expression.text)) {
      let enFuncion = false;
      for (let p = x.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)||ts.isFunctionExpression(p)||ts.isArrowFunction(p)||ts.isMethodDeclaration(p)) { enFuncion = true; break; }
      if (!enFuncion) {
        let d = null; for (let p = x.parent; p; p = p.parent) if (ts.isVariableDeclaration(p)) { d = p; break; }
        const { line } = sf.getLineAndCharacterOfPosition(x.getStart());
        console.log(`  ${f.replace('src/','')}:${line+1}  ${(d ? d.getText() : x.getText()).replace(/\s+/g,' ').slice(0,105)}`);
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
