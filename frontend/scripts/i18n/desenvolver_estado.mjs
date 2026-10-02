// Fuera tr(), trc() y trp() del código que ESCRIBE en el estado.
//
// `src/datos/acciones.ts` son los reductores: lo que producen se guarda, y
// están duplicados uno a uno con `rosa/estado/acciones.py`, que escribe en
// castellano. Si el del navegador escribiera en el idioma de la pantalla, el
// mismo gesto guardaría «Hipótesis aceptada para perseguir» o «Hypothesis
// accepted for pursuit» según quién lo hiciera, y los dos lados dejarían de
// coincidir. Lo que se guarda no depende del idioma de quien mira: se traduce
// al ENSEÑARLO (lib/traductorDom.ts), no al guardarlo.
//
// Lo deshace todo, también lo que ya llegó a un commit (2 de octubre de 2026):
//   tr('x')                     -> 'x'
//   trc('ctx', 'x')             -> 'x'
//   trp('a {n} b', { n: e })    -> `a ${e} b`
//
//   node scripts/i18n/desenvolver_estado.mjs [--escribir]

import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

export const FICHEROS_DE_ESTADO = ['src/datos/acciones.ts'];
const escribir = process.argv.includes('--escribir');

function plantilla(texto, valores) {
  // Lo fijo, escapado para una plantilla de JavaScript.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  let out = '';
  let resto = texto;
  for (;;) {
    const m = resto.match(/\{(\w+)\}/);
    if (!m) { out += esc(resto); break; }
    out += esc(resto.slice(0, m.index));
    const v = valores.get(m[1]);
    out += v === undefined ? esc(m[0]) : `\${${v}}`;
    resto = resto.slice(m.index + m[0].length);
  }
  return `\`${out}\``;
}

let total = 0;
for (const f of FICHEROS_DE_ESTADO) {
  let src = readFileSync(f, 'utf8');
  // Varias vueltas: un trp puede llevar un tr dentro de sus valores.
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const ediciones = [];
    const visitar = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['tr', 'trc', 'trp'].includes(n.expression.text)) {
        const nombre = n.expression.text;
        const lit = nombre === 'trc' ? n.arguments[1] : n.arguments[0];
        if (lit && (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit))) {
          // Solo las más internas en cada vuelta, para no solapar.
          let dentro = false;
          n.arguments.forEach((a) => a.forEachChild(function mirar(x) { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr', 'trc', 'trp'].includes(x.expression.text)) dentro = true; else x.forEachChild(mirar); }));
          if (!dentro) {
            let nuevo;
            if (nombre === 'trp') {
              const obj = n.arguments[1];
              const valores = new Map();
              if (obj && ts.isObjectLiteralExpression(obj)) {
                for (const p of obj.properties) {
                  if (ts.isPropertyAssignment(p)) valores.set(p.name.getText(), p.initializer.getText());
                  else if (ts.isShorthandPropertyAssignment(p)) valores.set(p.name.text, p.name.text);
                }
              }
              nuevo = plantilla(lit.text, valores);
            } else {
              nuevo = lit.getText();
            }
            ediciones.push({ a: n.getStart(sf), b: n.getEnd(), texto: nuevo });
            return;
          }
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    if (!ediciones.length) break;
    total += ediciones.length;
    for (const e of ediciones.sort((x, y) => y.a - x.a)) src = src.slice(0, e.a) + e.texto + src.slice(e.b);
  }
  // Fuera los nombres que ya no se usan del import de idioma.
  src = src.replace(/import \{([^}]*)\} from '(\.\.\/lib\/idioma)';\n/, (m, nombres, ruta) => {
    const quedan = nombres.split(',').map((x) => x.trim()).filter((x) => x && !['tr', 'trc', 'trp'].includes(x));
    return quedan.length ? `import { ${quedan.join(', ')} } from '${ruta}';\n` : '';
  });
  console.log(`${f}: ${total} desenvueltas`);
  if (escribir) writeFileSync(f, src);
}
