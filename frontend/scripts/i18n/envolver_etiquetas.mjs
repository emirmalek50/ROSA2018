// Las etiquetas cortas que los otros codemods no ven.
//
// `envolver.mjs` y `resto_tsx.mjs` deciden si algo es castellano por una
// tilde o por una palabra funcion (de, la, que...). Eso deja fuera las
// etiquetas cortas: «Entendido», «Aplicar», «Denegar», «Respuesta
// esperada», «Zona horaria». Y el traductor de pantalla
// (`lib/traductorDom.ts`) usa la MISMA regla, asi que tampoco las coge en
// vivo: se quedaban en castellano con la interfaz en ingles, sin que
// ninguna de las dos medidas las contara.
//
// Aqui el criterio es el contrario: lo que se LEE se envuelve, salvo que
// este en la lista de lo que no se traduce. Solo mira dos sitios, que son
// prosa siempre y nunca un identificador: el texto JSX y los cuatro
// atributos que se leen.
//
//   node scripts/i18n/envolver_etiquetas.mjs [--escribir]

import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const escribir = process.argv.includes('--escribir');
const ATRIBUTOS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

/** Props que NO se leen: identificadores, rutas, estilo y atributos de SVG.
 *  Misma lista que `envolver.mjs`. Cualquier otra prop con una cadena dentro
 *  es un rotulo: `titulo="Enunciado"` en un <Seccion> se ve en pantalla, y
 *  como es una palabra sola sin tilde no la cogia ningun codemod (los
 *  encabezados Enunciado, Novedad, Supuestos, Revisor, Rivales e Historial
 *  llevaban asi desde siempre; 2 de octubre de 2026). */
const PROPS_QUE_NO_SE_VEN = new Set(['className', 'id', 'key', 'type', 'name', 'htmlFor', 'role', 'href', 'src', 'rel', 'target', 'method', 'action', 'value', 'data-tipo', 'data-eje', 'data-estado', 'data-sin-traducir', 'style', 'xmlns', 'd', 'fill', 'stroke', 'viewBox', 'transform', 'points', 'rx', 'ry', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'preserveAspectRatio', 'strokeLinecap', 'strokeLinejoin', 'strokeWidth', 'fontFamily', 'textAnchor', 'dominantBaseline', 'autoComplete', 'inputMode', 'pattern', 'accept', 'encType', 'clave', 'ambito', 'icono', 'tono', 'variante', 'modo', 'vista', 'panel', 'orden', 'formato']);

/** Marcas, formatos, siglas y unidades: se escriben igual en los dos
 *  idiomas, y traducirlas seria un error. */
const TAL_CUAL = new Set([
  'ROSA2018', 'Alzheimer Project', 'AI Robotix', 'INTEC', 'Claude', 'Opus', 'Sonnet', 'Astra',
  'DOI', 'doi', 'PMID', 'PMCID', 'NCT', 'ORCID', 'ISSN', 'ISBN', 'URL', 'API', 'SMTP', 'IMAP',
  'BibTeX', 'RIS', 'CSV', 'TSV', 'JSON', 'JSONL', 'PDF', 'XML', 'HTML', 'ZIP', 'SVG', 'PNG',
  'Resend', 'Google Workspace', 'GitHub', 'PubMed', 'Europe PMC', 'ClinicalTrials.gov',
  'OpenAlex', 'Crossref', 'Unpaywall', 'Ensembl', 'BLAST', 'ViennaRNA', 'RNAplfold',
  'ELO', 'Elo', 'BT', 'GRADE', 'PRISMA', 'RO-Crate', 'PROV', 'RFC 3161', 'DSPy', 'GEPA',
  'Erratum', 'sha256', 'Cmd K', 'Ctrl K', 'nt', 'ms', 'px', 'USD', 'kDa', 'pg/mL', 'nm',
  'AlphaFold DB', 'Agora', 'MLflow', 'Open Targets', 'PubChem', 'ChEMBL', 'UniProt',
  'DisGeNET', 'STRING', 'Reactome', 'KEGG', 'ADNI', 'UK Biobank', 'Weights & Biases',
]);

/** Lo que no es una etiqueta: cifras, simbolos, rutas, correos y codigo. */
function esTexto(t) {
  if (t.length < 2) return false;
  if (TAL_CUAL.has(t)) return false;
  if (!/[a-záéíóúñ]{2}/i.test(t)) return false;            // sin dos letras seguidas no es palabra
  if (/^[\s\d.,:;·%()[\]{}+/|$€£×–…¿?!¡"'`*#@~^<>=&-]*$/.test(t)) return false;
  if (/^[^A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/.test(t)) return false;    // empieza por simbolo: es un trozo de frase partida, lo junta agrupar.mjs
  if (/^[A-Z0-9][A-Z0-9·\-+/. ]*$/.test(t)) return false;  // sigla en mayusculas
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(t)) return false;     // correo
  if (/^(https?:\/\/|www\.|\/)/.test(t)) return false;     // url o ruta
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return false;          // proveedor/modelo, ruta de fichero
  // Un rotulo empieza por mayuscula, o lleva un espacio, o lleva tilde. Lo
  // que no cumple nada de eso y va de una pieza es un identificador: un
  // nombre de clase («btn-s», «ajuste-tab-general»), un valor de SVG
  // («currentColor», «evenodd», «userSpaceOnUse»), un modo («auto»,
  // «lazy»). Con esto entran «Enunciado» y «Descartar» y no entra el resto.
  if (!/\s/.test(t) && !/[ñáéíóúÁÉÍÓÚÑ]/.test(t) && !/^[A-ZÁÉÍÓÚÑ]/.test(t)) return false;
  if (/^(?:var\(|url\(|rotate\(|translate\(|scale\()/.test(t)) return false;  // valor CSS o SVG
  if (/^[A-Z][a-z]+[A-Z]/.test(t)) return false;           // SourceGraphic, PascalCase de SVG
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && t.length <= 3) return false; // doc, ms, nt
  return true;
}

const ficheros = execSync("find src -name '*.tsx' | grep -v '.test.'", { encoding: 'utf8' }).trim().split('\n');
const todas = new Set();
let total = 0;

for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dentroDeTr = (x) => {
    let p = x.parent;
    while (p) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ['tr', 'trc', 'trp', 'traducido'].includes(p.expression.text)) return true;
      p = p.parent;
    }
    return false;
  };
  const sitios = [];
  const visitar = (n) => {
    if (ts.isJsxText(n) && !dentroDeTr(n)) {
      const t = n.text.trim();
      // Los espacios y saltos de linea de alrededor los pinta React: se
      // conservan tal cual y solo se envuelve el nucleo.
      if (esTexto(t)) sitios.push({ tipo: 'texto', a: n.pos + n.text.indexOf(t.charAt(0), 0), nodo: n, t });
    } else if (ts.isJsxAttribute(n) && n.name && n.initializer && ts.isStringLiteral(n.initializer)) {
      const prop = n.name.getText(sf);
      // Los cuatro de siempre, y ademas cualquier prop que no este en la
      // lista de las que no se leen.
      if (ATRIBUTOS.has(prop) || !(PROPS_QUE_NO_SE_VEN.has(prop) || prop.startsWith('data-') || prop.startsWith('on'))) {
        const t = n.initializer.text.trim();
        if (esTexto(t)) sitios.push({ tipo: 'atributo', nodo: n.initializer, t });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  if (!sitios.length) continue;
  total += sitios.length;
  sitios.forEach((s) => todas.add(s.t));
  if (!escribir) { console.log(`${f}: ${sitios.length}`); continue; }

  let salida = src;
  const ediciones = sitios.map((s) => {
    if (s.tipo === 'atributo') {
      const a = s.nodo.getStart(sf), b = s.nodo.getEnd();
      return { a, b, texto: `{tr(${JSON.stringify(s.t)})}` };
    }
    // Texto JSX: se respeta el espacio de los bordes, que React sí pinta.
    const bruto = s.nodo.text;
    const i = bruto.indexOf(s.t);
    const a = s.nodo.pos + i;
    return { a, b: a + s.t.length, texto: `{tr(${JSON.stringify(s.t)})}` };
  });
  for (const e of ediciones.sort((x, y) => y.a - x.a)) salida = salida.slice(0, e.a) + e.texto + salida.slice(e.b);

  if (!/import \{[^}]*\btr\b[^}]*\} from '[^']*idioma'/.test(salida)) {
    const sf2 = ts.createSourceFile(f, salida, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = sf2.statements.filter(ts.isImportDeclaration);
    const ya = imports.find((i) => /idioma$/.test(i.moduleSpecifier.getText().replace(/['"]/g, '')));
    const prof = f.split('/').length - 2;
    const ruta = f.startsWith('src/lib/') ? './idioma' : (prof === 0 ? './lib/idioma' : '../lib/idioma');
    if (ya) {
      const t = ya.getText();
      salida = salida.replace(t, t.replace(/import \{ /, 'import { tr, '));
    } else {
      const corte = imports.length ? imports[imports.length - 1].getEnd() : (sf2.statements[0]?.getStart() ?? 0);
      salida = salida.slice(0, corte) + `\nimport { tr } from '${ruta}';` + salida.slice(corte);
    }
  }
  writeFileSync(f, salida);
  console.log(`${f}: ${sitios.length} envueltas`);
}
console.log(`\n${total} sitios, ${todas.size} etiquetas distintas`);
writeFileSync('/tmp/etiquetas.json', JSON.stringify([...todas].sort(), null, 1));
