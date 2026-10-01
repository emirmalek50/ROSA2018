// Deshace el envoltorio tr() donde la cadena NO es texto de pantalla sino
// dato con el que se compara o se busca: identificadores de nodo, alias de
// cohorte con los que se reconoce un nombre en la literatura, fragmentos de
// expresion regular, codigo que se enseña tal cual. Envolverlas no rompe
// nada hoy (tr() sin entrada devuelve la misma cadena), pero deja la puerta
// abierta a que alguien las «traduzca» y entonces el reconocimiento falla
// en ingles y en silencio. Mejor que no se puedan traducir.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CLAVES_DE_DATO = new Set([
  'id', 'clave', 'key', 'de', 'a', 'origen', 'destino', 'ref', 'slug', 'ruta', 'path',
  'alias', 'sinonimos', 'patron', 'patrones', 'regex', 'excepto', 'noTras', 'nct',
  'terminos', 'palabras', 'codigo', 'consulta', 'query', 'endpoint', 'host',
]);
const escribir = process.argv.includes('--escribir');
const ficheros = execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n');
let total = 0;
for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const quitar = [];
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr'
        && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0])) {
      // sube por arrays y objetos hasta encontrar el nombre de la propiedad
      let p = x.parent, salto = 0;
      while (p && salto < 3 && (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p))) { p = p.parent; salto++; }
      if (p && ts.isPropertyAssignment(p) && CLAVES_DE_DATO.has(p.name.getText())) {
        quitar.push(x);
        const { line } = sf.getLineAndCharacterOfPosition(x.getStart());
        console.log(`  ${f}:${line + 1}  ${p.name.getText()}: ${x.arguments[0].getText().slice(0, 62)}`);
      }
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
  if (!quitar.length) continue;
  total += quitar.length;
  if (!escribir) continue;
  let salida = src;
  for (const x of quitar.sort((a, b) => b.getStart() - a.getStart())) {
    salida = salida.slice(0, x.getStart()) + x.arguments[0].getText() + salida.slice(x.getEnd());
  }
  writeFileSync(f, salida);
}
console.log(`\n${total} desenvueltas`);
