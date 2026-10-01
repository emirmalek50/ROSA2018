// Valores CSS, nombres de clase, etiquetas de formato de exportacion y
// licencias. Nada de eso se traduce: «6px 0» traducido deja de ser un
// margen, «btn btn-s» deja de ser una clase y «ER  - » rompe el fichero RIS.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const UNIDAD = '(?:px|em|rem|ex|ch|vh|vw|vmin|vmax|fr|%|s|ms|deg|turn)';
const NO_ES_TEXTO = [
  new RegExp(`^-?[\\\\d.]+${UNIDAD}?(?:\\\\s+-?[\\\\d.]+${UNIDAD}?)+$`),   // 6px 0 / 1 1 260px / 0 20px
  // Clase CSS: cada ficha lleva guion («btn-s») o es una palabra sola de la
  // lista exacta. Sin el guion, «columnas sin diccionario» pasaba por clase
  // porque empieza por «col».
  /^(?:(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+)|btn|chip|meta|num|fila|grid|flex)(?:\s+(?:(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+)|btn|chip|meta|num|fila|grid|flex))*$/,
  /^[A-Z]{2}\s{2}- ?$/,                            // etiqueta RIS: «ER  - »
  /^(?:CC[ -]|MIT|Apache|GPL|BSD|ODbL)\b/,         // licencia
  /^(?:normal|bold|italic|center|left|right|flex|grid|none|auto|hidden|visible|inherit|pointer)(?:\s+\w+)*$/,
];
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
      if (NO_ES_TEXTO.some((r) => r.test(t))) { quitar.push(x); console.log(`  ${f.replace('src/','')}  ${JSON.stringify(t).slice(0, 50)}`); }
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
console.log(`\n${n} desenvueltas: CSS, clases, etiquetas de formato y licencias`);
