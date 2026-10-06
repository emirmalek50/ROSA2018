// Lo que esta envuelto y todavia no tiene traduccion. Es la lista de trabajo.
import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
// Auditar el catálogo que consume la interfaz, incluida la revisión compartida
// con Python. Leer solo en/*.ts omitía esas traducciones y sus prioridades.
const compilado = await build({ entryPoints: ['src/i18n/en.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { EN } = await import(`data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString('base64')}`);
// Misma lista que el Proxy, leída de idioma.ts para que no se desincronice.
const fuenteIdioma = readFileSync('src/lib/idioma.ts', 'utf8');
const bloque = fuenteIdioma.slice(fuenteIdioma.indexOf('CAMPOS_DE_DATOS'), fuenteIdioma.indexOf(']);', fuenteIdioma.indexOf('CAMPOS_DE_DATOS')));
const CAMPOS_DE_DATOS = new Set([...bloque.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
const cat = new Set(Object.keys(EN));
// Los valores de enumeracion no van al catalogo: se comparan con el
// servidor, y traducidos dejan de encajar. Misma regla que el guardian de
// `src/i18n/catalogo.test.ts`.
const IDENTIFICADOR = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+[A-Z]\w*)$/;
const faltan = new Map();
function archivos(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((e) => {
    const ruta = `${directorio}/${e.name}`;
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) && !ruta.includes('/i18n/') && !ruta.includes('.test.') ? [ruta] : [];
  });
}
for (const f of archivos('src')) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Las constantes de texto del fichero. `tr(AYUDA)` no lleva el texto en la
  // llamada: hay que ir a buscarlo a `const AYUDA = '...'`. Sin esto, las
  // frases a las que se les movió el tr() al sitio de uso (para que no se
  // congelaran al importar) quedaban fuera del recuento sin que nada lo
  // dijera. Pasó con catorce ayudas de pantalla el 2 de octubre de 2026.
  const constantes = new Map();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) {
        constantes.set(d.name.text, d.initializer.text);
      }
    }
  }
  const ver = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr', 'trp'].includes(x.expression.text)
        && x.arguments.length >= 1 && ts.isIdentifier(x.arguments[0]) && constantes.has(x.arguments[0].text)) {
      const t = constantes.get(x.arguments[0].text);
      if (!cat.has(t)) faltan.set(t, faltan.get(t) || f);
    }
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['tr', 'trp'].includes(x.expression.text)
        && x.arguments.length >= 1 && (ts.isStringLiteral(x.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(x.arguments[0]))) {
      const t = x.arguments[0].text;
      // Un nombre tecnico («pLDDT») se escribe igual en los dos idiomas: sin
      // entrada, `tr()` devuelve la clave, que ya es lo correcto.
      if (!IDENTIFICADOR.test(t) && !cat.has(t)) faltan.set(t, (faltan.get(t) || f));
    }
    // dentro de traducido(): todas las cadenas de la estructura
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'traducido') {
      const dentro = (y) => {
        // Ni las claves ni los valores de los campos de datos (id, de, a,
        // alias...): el Proxy no los traduce, así que tampoco se piden.
        const enCampoDeDatos = ts.isPropertyAssignment(y.parent) && y.parent.initializer === y && CAMPOS_DE_DATOS.has(y.parent.name.getText());
        if ((ts.isStringLiteral(y) || ts.isNoSubstitutionTemplateLiteral(y)) && !(ts.isPropertyAssignment(y.parent) && y.parent.name === y) && !enCampoDeDatos) {
          const t = y.text;
          // Sin pedir espacio ni tilde: «Artefactos», «Atlas», «Corrida» e
          // «Inicio» son una sola palabra sin tilde, y con aquel filtro
          // siete rótulos del menú se quedaron en castellano sin que esto
          // los contara (2 de octubre de 2026). Lo que no es texto ya lo
          // quita CAMPOS_DE_DATOS.
          if (t.trim().length > 2 && /[a-záéíóúñ]{2}/i.test(t) && !IDENTIFICADOR.test(t) && !cat.has(t)) faltan.set(t, (faltan.get(t) || f));
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
// Sin letras no hay nada que traducir: «.» en inglés es «.».
for (const t of [...faltan.keys()]) if (!/[a-záéíóúñ]/i.test(t)) faltan.delete(t);

console.log(`catalogo: ${cat.size} entradas`);
console.log(`faltan:   ${faltan.size} cadenas`);
const porFichero = new Map();
for (const [, f] of faltan) porFichero.set(f, (porFichero.get(f) || 0) + 1);
for (const [f, n] of [...porFichero].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${f.replace('src/', '')}`);
writeFileSync('/tmp/faltan.json', JSON.stringify([...faltan.keys()].sort((a, b) => a.length - b.length), null, 1));
if (process.argv.includes('--comprobar') && faltan.size > 0) process.exitCode = 1;
