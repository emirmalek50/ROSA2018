// Una traducción calculada al importar conserva el primer idioma para siempre.
// Las claves se guardan en castellano y se traducen al leerlas o al renderizar.
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function traduccionesCongeladas(fuente, fichero = 'texto.tsx') {
  const sf = ts.createSourceFile(fichero, fuente, ts.ScriptTarget.Latest, true);
  const errores = [];
  function visitar(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['tr', 'trp', 'trc'].includes(n.expression.text)) {
      let dentro = false;
      for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) if (ts.isFunctionLike(p)) dentro = true;
      if (!dentro) errores.push({ fichero, linea: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visitar);
  }
  visitar(sf);
  return errores;
}

function archivos(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const ruta = `${d}/${e.name}`;
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') && ruta !== 'src/main.tsx' ? [ruta] : [];
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errores = archivos('src').flatMap(f => traduccionesCongeladas(readFileSync(f, 'utf8'), f));
  for (const e of errores) console.log(`${e.fichero}:${e.linea}: traducción calculada al importar`);
  console.log(`${errores.length} traducciones congeladas`);
  process.exitCode = errores.length ? 1 : 0;
}
