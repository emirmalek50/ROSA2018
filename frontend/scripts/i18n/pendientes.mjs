// Lo que esta envuelto y todavia no tiene traduccion. Es la lista de trabajo.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const cat = new Set();
for (const f of execSync("ls src/i18n/en/*.ts", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
  const ver = (x) => {
    if (ts.isPropertyAssignment(x)) {
      const n = x.name;
      cat.add(ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : n.getText());
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
const faltan = new Map();
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr', 'trp'].includes(x.expression.text)
        && x.arguments.length >= 1 && (ts.isStringLiteral(x.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(x.arguments[0]))) {
      const t = x.arguments[0].text;
      if (!cat.has(t)) faltan.set(t, (faltan.get(t) || f));
    }
    // dentro de traducido(): todas las cadenas de la estructura
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'traducido') {
      const dentro = (y) => {
        if ((ts.isStringLiteral(y) || ts.isNoSubstitutionTemplateLiteral(y)) && !(ts.isPropertyAssignment(y.parent) && y.parent.name === y)) {
          const t = y.text;
          if (t.trim().length > 3 && /\s|[ñáéíóú]/.test(t) && !cat.has(t)) faltan.set(t, (faltan.get(t) || f));
        }
        ts.forEachChild(y, dentro);
      };
      dentro(x);
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
// Lo que esta dentro de una estructura traducida pero NO es texto: valores
// CSS, clases, licencias, nombres de modelo y de cohorte. No se puede
// «desenvolver» porque no lleva tr() propio; lo que se hace es no dejar que
// entre al catalogo, que es donde se decide si algo se traduce o no.
const UNIDAD = '(?:px|em|rem|vh|vw|fr|%|s|ms|deg)';
const NO_ES_TEXTO = [
  new RegExp(`^-?[\\d.]+${UNIDAD}?(?:\\s+-?[\\d.]+${UNIDAD}?)+$`),
  /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\s+[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/,
  /^(?:CC[ -]|MIT|Apache|GPL|BSD|ODbL)/,
  /^(?:anthropic|openai|google|meta|mistral|xai)\//,
  /^[A-Z]{2}\s{2}- ?$/,
];
for (const t of [...faltan.keys()]) if (NO_ES_TEXTO.some((r) => r.test(t))) faltan.delete(t);

console.log(`catalogo: ${cat.size} entradas`);
console.log(`faltan:   ${faltan.size} cadenas`);
const porFichero = new Map();
for (const [, f] of faltan) porFichero.set(f, (porFichero.get(f) || 0) + 1);
for (const [f, n] of [...porFichero].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${f.replace('src/', '')}`);
writeFileSync('/tmp/faltan.json', JSON.stringify([...faltan.keys()].sort((a, b) => a.length - b.length), null, 1));
