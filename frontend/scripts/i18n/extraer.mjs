// Extrae y envuelve las cadenas visibles usando el AST de TypeScript, no
// expresiones regulares: en TSX, un `>` dentro de una cadena o un atributo
// con llaves rompe cualquier regex, y aquí romper algo es dejar la pantalla
// en blanco.
//
// Qué se considera visible:
//   - el texto suelto dentro de JSX (JsxText)
//   - los atributos que lee una persona: title, aria-label, placeholder, alt,
//     aria-description
// Qué NO se toca: className, href, id, key, los valores que se comparan con
// el servidor, y todo lo que no tenga pinta de castellano.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const ATRIBUTOS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'aria-roledescription']);
// Castellano sin tildes y sin ninguna de estas palabras se escapaba: a
// «Inyectar como criterio» le faltaba «como» y se quedo sin traducir con
// el recuento diciendo cero. Mas vale que sobre una palabra y la
// revisemos que no que falte y no se vea.
const ESP = /[áéíóúñÁÉÍÓÚÑ¿¡]|\b(el|la|los|las|de|del|que|para|con|sin|por|una|un|este|esta|esto|no|se|su|lo|al|y|o|en|más|menos|cada|todo|toda|hay|son|está|ser|hace|dice|puede|sobre|como|desde|hasta|entre|pero|aunque|mientras|cuando|donde|muy|ya|aun|tras|ante|bajo|según|contra|nada|algo|otro|otra|otros|otras|mismo|misma|tan|tanto|solo|sólo|aqui|aquí|aun|aún|aquel|ese|esa|esos|esas|aquella|nuevo|nueva|aquello)\b/i;

export function esVisible(s, entero = false) {
  const t = s.trim();
  if (t.length < 2) return false;
  // Trozos intraducibles: texto partido por marcado anidado (un <b> en medio
  // de la frase) que deja cosas como «nt de», «en Exa» o «, en». Traducir eso
  // suelto da peor resultado que dejarlo, porque ni siquiera es una unidad de
  // sentido. Se quedan en castellano, sin tocar, y van anotados en
  // PENDIENTE.md para arreglarlos a mano cuando toque.
  const palabras = t.split(/\s+/).filter(Boolean);
  const empiezaMal = /^[,.;:)\u00bb\u2014-]|^[a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]/.test(t);
  const acabaColgando = /\b(con|de|en|por|para|que|y|o|del|al|la|el|los|las|un|una)$/.test(t);
  // `entero`: el texto es el UNICO hijo de su elemento, asi que es una
  // etiqueta completa y no un trozo. Sin esto se perdian las etiquetas cortas
  // en minuscula como «ya no bloquearia» (Citas.tsx), que el filtro tomaba
  // por fragmento: 3 palabras, minuscula y menos de 24 caracteres. El
  // recuento decia 0 pendientes y la pantalla seguia en castellano.
  if (!entero && t.length < 24 && (empiezaMal || acabaColgando) && palabras.length <= 3) return false;
  if (!/[a-záéíóúñ]/i.test(t)) return false;        // solo signos o números
  if (/^[\d\s.,%:+-]+$/.test(t)) return false;       // solo cifras
  if (/^[a-z][a-z0-9-]*$/.test(t) && !t.includes(' ')) return false;  // clase o id
  if (/^(https?:|#\/|\/|data:)/.test(t)) return false;
  return ESP.test(t);
}

export function procesar(ruta, { escribir = false } = {}) {
  const fuente = readFileSync(ruta, 'utf8');
  const sf = ts.createSourceFile(ruta, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cambios = [];   // {ini, fin, texto, cadena}
  const cadenas = new Set();

  // NOTA (1 de octubre de 2026): se intentó agrupar texto y variables en una
  // sola frase con huecos con nombre, que es lo que hacen las herramientas
  // buenas y lo que arregla los trozos sueltos. Se revirtió porque `trp`
  // devuelve una CADENA, y en este código muchas de esas variables son nodos
  // de React: salía «[object Object]» en pantalla y rompía 26 tests. Hacerlo
  // bien pide un componente que empalme nodos, no una función de texto, y eso
  // va en su propio paso. Está anotado en PENDIENTE.md.
  const visitar = (n) => {
    // Texto suelto dentro de JSX.
    if (ts.isJsxText(n)) {
      const bruto = n.getText();
      const crudo = bruto.trim();
      // JSX COLAPSA el espacio interior: un salto de línea con su sangría se
      // pinta como un espacio. Una cadena no.
      const texto = crudo.replace(/\s+/g, ' ');
      // Unico hijo con contenido: ni expresiones ni elementos hermanos.
      const hermanos = (n.parent?.children ?? []).filter((h) => !(ts.isJsxText(h) && h.getText().trim() === ''));
      const entero = hermanos.length === 1 && hermanos[0] === n;
      if (esVisible(texto, entero)) {
        const antes = bruto.slice(0, bruto.indexOf(crudo));
        const despues = bruto.slice(bruto.indexOf(crudo) + crudo.length);
        cadenas.add(texto);
        cambios.push({ ini: n.getStart(), fin: n.getEnd(), texto: `${antes}{tr(${JSON.stringify(texto)})}${despues}` });
      }
    }
    // Atributos que lee una persona.
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const nombre = n.name.getText();
      const v = n.initializer.text;
      const vn = v.replace(/\s+/g, ' ').trim();
      if (ATRIBUTOS.has(nombre) && esVisible(vn)) {
        cadenas.add(vn);
        cambios.push({ ini: n.initializer.getStart(), fin: n.initializer.getEnd(), texto: `{tr(${JSON.stringify(vn)})}` });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);

  if (escribir && cambios.length) {
    let salida = fuente;
    for (const c of [...cambios].sort((a, b) => b.ini - a.ini)) {
      salida = salida.slice(0, c.ini) + c.texto + salida.slice(c.fin);
    }
    // El import, si falta. Se coloca con el AST y no con una expresión
    // regular: el primer intento buscaba /^import .*?;/ y acabó metiendo la
    // línea DENTRO del comentario de cabecera del fichero.
    if (!/from '(\.\.?\/)+lib\/idioma'/.test(salida)) {
      const dentro = ruta.includes('/src/') ? ruta.split('/src/')[1] : ruta.replace(/^\.?\/?src\//, '');
      const prof = dentro.split('/').length - 1;
      const rel = prof === 0 ? './lib/idioma' : '../'.repeat(prof) + 'lib/idioma';
      const usaTrp = /\btrp\(/.test(salida);
      const linea = `import { tr${usaTrp ? ', trp' : ''} } from '${rel}';\n`;
      // Tras el último import de verdad; si no hay ninguno, tras el
      // comentario de cabecera, que en este proyecto siempre lo hay.
      const imports = sf.statements.filter((x) => ts.isImportDeclaration(x));
      if (imports.length) {
        const ultimo = imports[imports.length - 1];
        const corte = ultimo.getEnd() + 1;
        salida = salida.slice(0, corte) + linea + salida.slice(corte);
      } else {
        const corte = sf.statements.length ? sf.statements[0].getStart() : 0;
        salida = salida.slice(0, corte) + linea + '\n' + salida.slice(corte);
      }
    }
    writeFileSync(ruta, salida);
  }
  return { cadenas: [...cadenas], cambios: cambios.length };
}

if (process.argv[2]) {
  const escribir = process.argv.includes('--escribir');
  let total = 0;
  const todas = new Set();
  for (const f of process.argv.slice(2).filter((x) => !x.startsWith('--'))) {
    const r = procesar(f, { escribir });
    if (r.cambios) { total += r.cambios; r.cadenas.forEach((c) => todas.add(c)); console.log(`${String(r.cambios).padStart(4)}  ${f}`); }
  }
  console.log(`\n${total} sitios, ${todas.size} cadenas distintas`);
  writeFileSync('/tmp/cadenas.json', JSON.stringify([...todas].sort(), null, 1));
}
