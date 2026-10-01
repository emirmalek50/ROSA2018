// Deshace tr() en lo que es codigo, consulta de API, identificador de modelo
// o nombre propio de una base: nada de eso se traduce a ningun idioma, y
// dejarlo envuelto invita a que alguien lo intente.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const NO_ES_TEXTO = [
  /[&?]\w+=/,                      // db=pubmed&term=...
  /^(?:GET|POST|PUT|DELETE|PATCH) /,
  /^\w+:\/\//,
  /^[a-z][\w.-]*\/[\w.-]+/,        // anthropic/claude-sonnet-5
  /^\/[\w/.-]+/,                   // /api/v2/studies
  /\w+\([^)]*\)\s*\w*\([^)]*\)/,   // target(...) associatedDiseases(...)
  /^(?:esearch|efetch|esummary|REST|GraphQL|SPARQL|SQL|GET|POST):/i,
  /\b(?:AND|OR|NOT)\b.*\b(?:AND|OR|NOT)\b/,  // consulta booleana
  /^[A-Za-z0-9_.-]+\s*=\s*\w+\(/,  // salida = generar(...)
];
const escribir = process.argv.includes('--escribir');
let total = 0;
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n')) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const quitar = [];
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr'
        && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0])) {
      const t = x.arguments[0].text;
      if (NO_ES_TEXTO.some((r) => r.test(t))) {
        quitar.push(x);
        console.log(`  ${f.replace('src/', '')}  ${t.slice(0, 66)}`);
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
  if (!quitar.length) continue;
  total += quitar.length;
  if (!escribir) continue;
  let salida = src;
  for (const x of quitar.sort((a, b) => b.getStart() - a.getStart())) salida = salida.slice(0, x.getStart()) + x.arguments[0].getText() + salida.slice(x.getEnd());
  writeFileSync(f, salida);
}
console.log(`\n${total} desenvueltas por ser codigo o consulta`);
