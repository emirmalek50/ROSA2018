// Lo que no es texto aunque lo parezca: listas de palabras para comparar,
// colores rgba/hsl y trazados SVG. Traducir cualquiera de las tres rompe algo
// sin que se vea: la comparacion deja de encontrar palabras, el color deja de
// ser un color y el trazado deja de dibujar.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const NO_ES_TEXTO = [
  /^(?:rgba?|hsla?)\(/i,
  /^#[0-9a-f]{3,8}$/i,
  /^[Mm][\s-]?-?[\d.]+[\s,]/,          // trazado SVG
  /^[A-Za-z]?[-\d.]+(?:\s+[-\d.]+){4,}/, // lista de numeros
];
const CLAVES_DE_LISTA = /^(?:VACIAS|DIRECCION|NUMEROS|NEGACIONES|GENERICOS|PARADAS|CAUSALES|TEMPORALES|STOPWORDS)/;
const escribir = process.argv.includes('--escribir');
let n = 0;
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n')) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const quitar = [];
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr'
        && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0])) {
      const t = x.arguments[0].text;
      let decl = null;
      for (let p = x.parent; p; p = p.parent) if (ts.isVariableDeclaration(p)) { decl = p; break; }
      const enLista = decl && ts.isIdentifier(decl.name) && CLAVES_DE_LISTA.test(decl.name.text);
      if (NO_ES_TEXTO.some((r) => r.test(t)) || enLista) {
        quitar.push(x);
        console.log(`  ${f.replace('src/','')}  ${(decl && ts.isIdentifier(decl.name) ? decl.name.text + ': ' : '')}${t.slice(0, 54)}`);
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
  if (!quitar.length) continue;
  n += quitar.length;
  if (!escribir) continue;
  let salida = src;
  for (const x of quitar.sort((a, b) => b.getStart() - a.getStart())) salida = salida.slice(0, x.getStart()) + x.arguments[0].getText() + salida.slice(x.getEnd());
  writeFileSync(f, salida);
}
console.log(`\n${n} desenvueltas: listas de comparacion, colores y trazados`);
