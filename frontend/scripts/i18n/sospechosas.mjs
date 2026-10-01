// De lo que el codemod envolvio, cuanto es castellano de verdad y cuanto
// parece otra cosa (nombre propio, sigla, texto ya en ingles, dato).
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const ES = /[ñáéíóú¿¡]|\b(?:de|la|el|los|las|que|con|para|por|una|sin|del|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna|no|y|o|un|es|si|ya|tu|te|me|le|nos)\b/i;
const buenas = new Set(), raras = new Map();
for (const f of execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v '/i18n/'", { encoding: 'utf8' }).trim().split('\n')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'tr'
        && x.arguments.length === 1 && ts.isStringLiteral(x.arguments[0])) {
      const t = x.arguments[0].text;
      if (ES.test(t)) buenas.add(t); else if (!raras.has(t)) raras.set(t, f);
    }
    ts.forEachChild(x, ver);
  };
  ver(sf);
}
console.log(`${buenas.size} en castellano claro`);
console.log(`${raras.size} sin marca de castellano (nombres propios, siglas, ya en ingles):\n`);
for (const [t, f] of [...raras].slice(0, 50)) console.log(`  ${t.slice(0, 68).padEnd(70)} ${f.replace('src/', '')}`);
