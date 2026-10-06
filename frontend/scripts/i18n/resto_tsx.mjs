// Lo que el codemod de JSX no toco: cadenas en .tsx que no son texto JSX.
// Asignaciones, ternarios, props de componentes propios y plantillas. El
// criterio de "es texto" es el mismo de siempre: tiene espacio o tilde y no
// parece un identificador, una clase CSS ni una ruta.
import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

function archivos(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap(e => {
    const ruta = `${directorio}/${e.name}`;
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) && !ruta.includes('.test.') && !ruta.includes('/i18n/') ? [ruta] : [];
  });
}
const ficheros = archivos('src');
const ES = /[ñáéíóú¿¡]|\b(?:de|la|el|los|las|que|con|para|por|una|sin|del|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna)\b/i;
const out = [];
for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visitar = (n) => {
    const envuelto = (x) => {
      let hijo = x;
      let p = x.parent;
      // Solo la plantilla pasa por trp(). Sus valores no se traducen:
      // trp('A {n}', {n: 'muchos'}) debe señalar «muchos» como pendiente.
      while (p) {
        if (ts.isCallExpression(p) && ts.isIdentifier(p.expression)) {
          const nombre = p.expression.text;
          if (nombre === 'traducido' && p.arguments[0] === hijo) return true;
          if (['tr', 'trp'].includes(nombre) && p.arguments[0] === hijo) return true;
          if (nombre === 'trc' && p.arguments[1] === hijo) return true;
        }
        hijo = p;
        p = p.parent;
      }
      return false;
    };
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ts.isJsxText(n)) {
      const t = n.text;
      if (t.length > 3 && ES.test(t) && !/^[a-z0-9_.\/-]+$/i.test(t) && !envuelto(n)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
        out.push({ f, l: line + 1, t, tipo: ts.SyntaxKind[n.parent.kind] });
      }
    }
    if (ts.isTemplateExpression(n) && !envuelto(n)) {
      const texto = n.head.text + n.templateSpans.map((s) => s.literal.text).join(' {} ');
      if (ES.test(texto) && texto.trim().length > 3) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
        out.push({ f, l: line + 1, t: '`' + texto.trim() + '`', tipo: 'Plantilla' });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
}
const porFichero = new Map();
for (const o of out) porFichero.set(o.f, (porFichero.get(o.f) || 0) + 1);
console.log(`${out.length} cadenas sin envolver en ${porFichero.size} ficheros\n`);
for (const [f, n] of [...porFichero].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${String(n).padStart(4)}  ${f}`);
const porTipo = new Map();
for (const o of out) porTipo.set(o.tipo, (porTipo.get(o.tipo) || 0) + 1);
console.log('\npor donde aparecen:');
for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`);
const salida = process.argv.indexOf('--salida');
writeFileSync(salida >= 0 ? process.argv[salida + 1] : '/tmp/resto_tsx.json', JSON.stringify(out, null, 1));
