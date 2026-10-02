// Las frases partidas, juntas en una sola con sus huecos. Es lo que faltaba
// para que el inglés suene a inglés y no a castellano traducido a trozos.
//
// Dos casos:
//
// 1. Plantillas con un valor dentro:
//      `Calculado al cerrar la iteración ${iteracion}.`
//    pasa a
//      trp("Calculado al cerrar la iteración {iteracion}.", { iteracion })
//
// 2. Texto JSX partido por expresiones, que el primer codemod tradujo trozo
//    a trozo («, reunidas de» suelto no hay manera de traducirlo bien):
//      {tr("Diccionario de columnas (")}{n}; {m} sin descripcion)
//    pasa a
//      {trp("Diccionario de columnas ({n}; {m} sin descripcion)", { n, m })}
//
// La regla que hace que esto no rompa nada, y por la que se usa el
// comprobador de tipos de TypeScript y no una expresión regular: un trozo
// solo entra en la frase si su valor es de verdad un texto o un número. Un
// elemento de React, un null o un booleano se pintan distinto metidos en una
// cadena (un null saldría como «{v}»), así que esos parten la frase y se
// quedan como están.
//
// Y una cosa más: el plural. `{n} {n === 1 ? 'bloqueo' : 'bloqueos'}` no
// tiene ninguna palabra que delate el castellano y se escapaba. Cuando un
// hueco es un «sí o no» entre dos textos fijos, se sacan dos frases enteras,
// una por rama: «{n} bloqueo» y «{n} bloqueos», que en inglés son «{n}
// blocker» y «{n} blockers».
//
// Sin --escribir no toca nada: enseña lo que haría.

import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const escribir = process.argv.includes('--escribir');
const ES = /[ñáéíóú¿¡]|\b(?:de|la|el|los|las|que|con|para|por|una|un|sin|del|más|cada|como|está|son|hay|qué|se|lo|al|su|sus|aún|entre|sobre|pero|cuando|donde|todavía|ningún|ninguna|no|y|o|es|ya|tu|te|le|desde|hasta|tras|muy|otra|otro)\b/i;
const NO_SE_VEN = new Set(['className', 'id', 'key', 'type', 'name', 'htmlFor', 'role', 'href', 'src', 'rel', 'target', 'method', 'style', 'd', 'fill', 'stroke', 'viewBox', 'transform', 'points', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'data-tipo', 'data-estado', 'value', 'defaultValue', 'pattern', 'accept', 'autoComplete']);
const METODOS_DE_BUSQUEDA = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'has', 'get', 'set', 'delete', 'add', 'match', 'search', 'split', 'join', 'replace', 'replaceAll', 'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute', 'getItem', 'setItem', 'removeItem', 'localeCompare', 'test', 'exec', 'log', 'warn', 'error', 'info', 'debug']);
const CAMPOS_DE_DATOS = new Set(['id', 'clave', 'key', 'de', 'a', 'origen', 'destino', 'ref', 'slug', 'ruta', 'path', 'href', 'alias', 'patron', 'regex', 'nct', 'codigo', 'consulta', 'query', 'endpoint', 'host', 'tipo', 'estado', 'hilo', 'url']);
const ETIQUETAS_SIN_TEXTO = new Set(['code', 'pre', 'kbd', 'script', 'style', 'samp']);

const cfgPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, path.dirname(cfgPath));

/** Un texto o un número, y nada que pueda ser null, undefined o booleano. */
function esPrimitivo(checker, t) {
  if (t.isUnion()) return t.types.every((x) => esPrimitivo(checker, x));
  const F = ts.TypeFlags;
  return (t.flags & (F.String | F.Number | F.StringLiteral | F.NumberLiteral | F.TemplateLiteral | F.BigInt | F.BigIntLiteral)) !== 0;
}

function esTr(n, nombres = ['tr']) {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && nombres.includes(n.expression.text);
}

/** El texto fijo de un trozo: una cadena, una plantilla sin huecos o un
 *  tr('...'). null si no es texto fijo. */
function literal(n) {
  if (ts.isParenthesizedExpression(n)) return literal(n.expression);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (esTr(n) && n.arguments.length === 1 && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) return n.arguments[0].text;
  return null;
}

/** El nombre del hueco, sacado de la expresión cuando se puede: {iteracion}
 *  se traduce mejor que {v1}. Solo ASCII, que es lo que reconoce trp. */
function nombreDe(e) {
  let n = null;
  if (ts.isIdentifier(e)) n = e.text;
  else if (ts.isPropertyAccessExpression(e)) n = e.name.text === 'length' && ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : e.name.text === 'length' && ts.isIdentifier(e.expression) ? e.expression.text : e.name.text;
  else if (ts.isCallExpression(e) && e.arguments.length >= 1 && (ts.isIdentifier(e.arguments[0]) || ts.isPropertyAccessExpression(e.arguments[0]))) n = nombreDe(e.arguments[0]);
  n = (n ?? 'v').replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(n) ? n : 'v';
}

/** Lo que se ve en pantalla de un JsxText, con la misma regla que React
 *  (Babel cleanJSXElementLiteralChild): las líneas de solo espacio se van y
 *  los saltos de línea pasan a un espacio. */
function textoJsx(raw) {
  const lineas = raw.split(/\r\n|\n|\r/);
  let ultimaLlena = 0;
  lineas.forEach((l, i) => { if (/[^ \t]/.test(l)) ultimaLlena = i; });
  let out = '';
  lineas.forEach((l, i) => {
    let t = l.replace(/\t/g, ' ');
    if (i !== 0) t = t.replace(/^[ ]+/, '');
    if (i !== lineas.length - 1) t = t.replace(/[ ]+$/, '');
    if (t) { if (i !== ultimaLlena) t += ' '; out += t; }
  });
  return out;
}

/** ¿Es un sí-o-no entre dos textos fijos? Devuelve sus dos ramas. */
function condicionalLiteral(e) {
  const x = ts.isParenthesizedExpression(e) ? e.expression : e;
  if (!ts.isConditionalExpression(x)) return null;
  const a = literal(x.whenTrue), b = literal(x.whenFalse);
  // `yaTr`: las dos ramas ya iban traducidas. Entonces el sí-o-no solo no
  // gana nada al reescribirlo, y reescribirlo cada vuelta no convergía.
  const traducida = (r) => esTr(ts.isParenthesizedExpression(r) ? r.expression : r);
  return a !== null && b !== null ? { cond: x.condition, a, b, yaTr: traducida(x.whenTrue) && traducida(x.whenFalse) } : null;
}

/** Arma la frase a partir de sus trozos: texto fijo y expresiones. Devuelve
 *  el código que la sustituye, o null si no hay nada que ganar. */
function construir(piezas, checker, visible = false) {
  const usados = new Set();
  const params = [];
  let condicional = null;
  let plantillaA = '', plantillaB = '';
  let huecos = 0;
  for (const p of piezas) {
    if (p.texto !== undefined) { plantillaA += p.texto; plantillaB += p.texto; continue; }
    const c = condicionalLiteral(p.expr);
    if (c && !condicional) {
      condicional = c;
      plantillaA += c.a; plantillaB += c.b;
      continue;
    }
    if (!esPrimitivo(checker, checker.getTypeAtLocation(p.expr))) return { motivo: 'no-primitivo' };
    let nombre = nombreDe(p.expr);
    for (let i = 2; usados.has(nombre); i++) nombre = `${nombreDe(p.expr)}${i}`;
    usados.add(nombre);
    // Un segundo sí-o-no entre textos fijos (el primero ya se abrió en dos
    // frases): sus ramas son palabras sueltas en castellano y entrarían sin
    // traducir. Se envuelven en tr().
    const c2 = condicionalLiteral(p.expr);
    const conTexto = (w) => (/[a-záéíóúñ]/i.test(w) ? `tr(${JSON.stringify(w)})` : JSON.stringify(w));
    params.push({ nombre, codigo: c2 ? `${c2.cond.getText()} ? ${conTexto(c2.a)} : ${conTexto(c2.b)}` : p.expr.getText() });
    plantillaA += `{${nombre}}`; plantillaB += `{${nombre}}`;
    huecos++;
  }
  // Las fichas con guion son nombres de clase: «atlas-no-buscada» lleva un
  // «no» dentro y pasaba por castellano. Se quitan antes de buscarlo, y una
  // plantilla que solo tenga eso no se toca (2 de octubre de 2026: el
  // guardián de traduccion_segura.test.ts cazó dos clases del atlas).
  const fijo = (s) => s.replace(/\{\w+\}/g, ' ').split(/\s+/).filter((f) => !/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(f)).join(' ');
  // Que haya castellano en lo fijo. Con un sí-o-no de dos palabras se acepta
  // si las ramas son palabras en minúscula: «bloqueo/bloqueos» no tiene tilde.
  // En el JSX todo texto es visible, así que basta con que tenga letras: lo
  // que no sea castellano («Killer: {v}») el modelo lo devuelve igual. Fuera
  // del JSX se exige castellano, porque una plantilla suelta puede ser un
  // nombre de clase («tarjeta {v}») y traducirla rompería el estilo.
  const hayEs = ES.test(fijo(plantillaA)) || ES.test(fijo(plantillaB)) ||
    (visible && /[a-záéíóúñ]{3}/i.test(fijo(plantillaA))) ||
    (condicional && [condicional.a, condicional.b].every((w) => /^[a-záéíóúñü ]{3,}$/.test(w.trim())));
  if (!hayEs || !/[a-záéíóúñ]{2}/i.test(fijo(plantillaA))) return { motivo: 'sin-castellano' };
  if (huecos === 0 && !condicional) return { motivo: 'sin-huecos' };
  const textoFuera = piezas.some((p) => p.texto !== undefined && p.texto.trim());
  if (huecos === 0 && !textoFuera && condicional?.yaTr) return { motivo: 'nada-que-ganar' };
  const objeto = params.length ? `, { ${params.map((x) => (x.codigo === x.nombre ? x.nombre : `${x.nombre}: ${x.codigo}`)).join(', ')} }` : '';
  const llamada = (pl) => (params.length ? `trp(${JSON.stringify(pl)}${objeto})` : `tr(${JSON.stringify(pl)})`);
  const codigo = condicional ? `(${condicional.cond.getText()} ? ${llamada(plantillaA)} : ${llamada(plantillaB)})` : llamada(plantillaA);
  return { codigo, claves: condicional ? [plantillaA, plantillaB] : [plantillaA], usaTrp: params.length > 0 };
}

/** Lo que no se toca: comparaciones, claves, rutas, consola, clases... */
function plantillaIntocable(n) {
  const p = n.parent;
  if (!p) return true;
  if (ts.isTaggedTemplateExpression(p)) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p) || ts.isComputedPropertyName(p)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === n && CAMPOS_DE_DATOS.has(p.name.getText())) return true;
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && METODOS_DE_BUSQUEDA.has(p.expression.name.text)) return true;
  if (ts.isNewExpression(p)) return true;
  for (let q = p; q; q = q.parent) {
    // El objeto de valores de un trp() no cuenta como «ya traducido»: lo que
    // lleva dentro es texto suelto que se pega a la frase.
    if (ts.isObjectLiteralExpression(q) && q.parent && esTr(q.parent, ['trp']) && q.parent.arguments[1] === q) break;
    if (esTr(q, ['tr', 'trc', 'trp', 'traducido'])) return true;
    if (ts.isJsxAttribute(q)) return NO_SE_VEN.has(q.name.getText());
    if (ts.isFunctionLike(q) || ts.isSourceFile(q)) break;
  }
  // Dentro del objeto de valores de un trp(): ahí el texto SÍ se ve (es parte
  // de la frase), así que sí se trata. Antes se saltaba y quedaban 20 trozos
  // en castellano escondidos dentro de frases ya traducidas.
  for (let q = p; q; q = q.parent) {
    if (ts.isObjectLiteralExpression(q) && q.parent && esTr(q.parent, ['trp']) && q.parent.arguments[1] === q) {
      let enFuncion2 = false;
      for (let r = q; r; r = r.parent) if (ts.isFunctionLike(r)) { enFuncion2 = true; break; }
      return !enFuncion2;
    }
    if (ts.isFunctionLike(q) || ts.isSourceFile(q)) break;
  }
  // En el nivel del módulo se congelaría al importar (ver congeladas.mjs).
  let enFuncion = false;
  for (let q = p; q; q = q.parent) if (ts.isFunctionLike(q)) { enFuncion = true; break; }
  return !enFuncion;
}

function pasar() {
  const program = ts.createProgram(cfg.fileNames.filter((f) => !/\.test\.|\/i18n\//.test(f)), cfg.options);
  const checker = program.getTypeChecker();
  let total = 0;
  const claves = new Set();
  const motivos = {};
  for (const sf of program.getSourceFiles()) {
    const f = sf.fileName;
    // Fuera los reductores: lo que escriben se guarda (desenvolver_estado.mjs).
    if (!f.includes('/src/') || /\.test\.|\/i18n\/|node_modules/.test(f) || f.endsWith('/lib/idioma.ts') || f.endsWith('/datos/acciones.ts')) continue;
    const ediciones = [];
    let usaTrp = false, usaTr = false, usaTrc = false;

    const visitar = (n) => {
      // 0) plural(n, 'hecho') y plural(n, 'llamada', 'llamadas'): la palabra va
      //    suelta y salía en castellano dentro de una frase en inglés. Se
      //    envuelve; si el plural es igual al singular («hipótesis»), el plural
      //    va con contexto, que en inglés no son iguales.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'plural' && n.arguments.length >= 2) {
        const [, sing, plu] = n.arguments;
        const palabra = (x) => x && ts.isStringLiteral(x) && /^[a-záéíóúñ ]+$/i.test(x.text);
        if (palabra(sing)) {
          ediciones.push({ a: sing.getStart(sf), b: sing.getEnd(), texto: `tr(${JSON.stringify(sing.text)})` });
          usaTr = true;
          claves.add(sing.text);
        }
        if (palabra(plu)) {
          const igual = sing && ts.isStringLiteral(sing) && sing.text === plu.text;
          ediciones.push({ a: plu.getStart(sf), b: plu.getEnd(), texto: igual ? `trc("plural", ${JSON.stringify(plu.text)})` : `tr(${JSON.stringify(plu.text)})` });
          if (igual) usaTrc = true; else usaTr = true;
          claves.add(igual ? `plural\u0004${plu.text}` : plu.text);
        }
      }
      // 1) plantillas con huecos. Solo las más internas en cada pasada: si
      //    una plantilla tiene otra dentro, la de fuera espera a la siguiente.
      if (ts.isTemplateExpression(n) && !plantillaIntocable(n)) {
        let dentro = false;
        n.templateSpans.forEach((s) => s.expression.forEachChild(function mirar(x) { if (ts.isTemplateExpression(x)) dentro = true; else x.forEachChild(mirar); }));
        if (!dentro) {
          const piezas = [{ texto: n.head.text }];
          for (const s of n.templateSpans) piezas.push({ expr: s.expression }, { texto: s.literal.text });
          const r = construir(piezas, checker);
          if (r.codigo) {
            ediciones.push({ a: n.getStart(sf), b: n.getEnd(), texto: r.codigo });
            r.claves.forEach((c) => claves.add(c));
            usaTrp ||= r.usaTrp; usaTr ||= !r.usaTrp;
            return;
          }
          motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1;
        }
      }
      // 2) texto JSX partido por expresiones
      if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !(ts.isJsxElement(n) && ETIQUETAS_SIN_TEXTO.has(n.openingElement.tagName.getText()))) {
        const hijos = n.children;
        let tramo = [];
        const cerrar = () => {
          const t = tramo;
          tramo = [];
          const conTexto = t.filter((x) => (x.texto !== undefined && x.texto.trim()) || (x.expr && condicionalLiteral(x.expr)));
          const conExpr = t.filter((x) => x.expr);
          if (conExpr.length === 0 || conTexto.length === 0) return;
          const r = construir(t, checker, true);
          if (!r.codigo) { motivos[`jsx-${r.motivo}`] = (motivos[`jsx-${r.motivo}`] ?? 0) + 1; return; }
          // Se sustituye del primer al último trozo con contenido; los espacios
          // de borde con salto de línea (que React tira) se quedan como están.
          const primero = t.find((x) => x.nodo), ultimo = [...t].reverse().find((x) => x.nodo);
          // Un JsxText empieza en su `pos`: su getStart() tambien salta el
          // espacio, y ese espacio va dentro de la frase.
          const desde = ts.isJsxText(primero.nodo) ? primero.nodo.pos : primero.nodo.getStart(sf);
          ediciones.push({ a: desde, b: ultimo.nodo.getEnd(), texto: `{${r.codigo}}` });
          r.claves.forEach((c) => claves.add(c));
          usaTrp ||= r.usaTrp; usaTr ||= !r.usaTrp;
        };
        for (const h of hijos) {
          if (ts.isJsxText(h)) {
            // `h.text`, NO getText(): getText() se salta el espacio en blanco
            // por considerarlo relleno, y un «{n} {cosa} {mas}» perdia los
            // espacios de en medio («citadasen la investigacion»).
            const visible = textoJsx(h.text);
            if (!visible) continue;
            // Un texto que empieza o acaba con un salto de línea no lleva ese
            // espacio a la pantalla: se recorta lo que React tira.
            tramo.push({ texto: visible, nodo: h });
            continue;
          }
          if (ts.isJsxExpression(h)) {
            if (!h.expression) { cerrar(); continue; } // un comentario parte el tramo
            const lit = literal(h.expression);
            if (lit !== null) { tramo.push({ texto: lit, nodo: h }); continue; }
            if (esTr(h.expression, ['trp', 'trc'])) { cerrar(); continue; }
            tramo.push({ expr: h.expression, nodo: h });
            continue;
          }
          cerrar(); // un elemento parte la frase
        }
        cerrar();
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    if (!ediciones.length) continue;
    // Ediciones que se solapan (una frase JSX que contiene una plantilla): se
    // queda la de fuera y la de dentro espera a la siguiente pasada.
    ediciones.sort((x, y) => x.a - y.a || y.b - x.b);
    const finales = [];
    for (const e of ediciones) if (!finales.some((g) => e.a < g.b && e.b > g.a)) finales.push(e);
    total += finales.length;
    console.log(`${String(finales.length).padStart(4)}  ${f.split('/src/')[1]}`);
    if (!escribir) continue;
    let salida = sf.getFullText();
    for (const e of [...finales].sort((x, y) => y.a - x.a)) salida = salida.slice(0, e.a) + e.texto + salida.slice(e.b);
    // los imports de tr / trp
    const necesarios = [usaTr && 'tr', usaTrc && 'trc', usaTrp && 'trp'].filter(Boolean);
    const m = salida.match(/import \{([^}]*)\} from (['"])((?:\.\.?\/)+(?:lib\/)?idioma)\2;/);
    if (m) {
      const ya = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      const todos = [...new Set([...ya, ...necesarios])];
      salida = salida.replace(m[0], `import { ${todos.join(', ')} } from ${m[2]}${m[3]}${m[2]};`);
    } else if (necesarios.length) {
      const rel = path.relative(path.dirname(f), path.resolve('src/lib/idioma')).replace(/\\/g, '/');
      const ruta = rel.startsWith('.') ? rel : `./${rel}`;
      const sf2 = ts.createSourceFile(f, salida, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const imps = sf2.statements.filter(ts.isImportDeclaration);
      const corte = imps.length ? imps[imps.length - 1].getEnd() : 0;
      salida = salida.slice(0, corte) + `\nimport { ${necesarios.join(', ')} } from '${ruta}';` + salida.slice(corte);
    }
    writeFileSync(f, salida);
  }
  return { total, claves, motivos };
}

let vuelta = 0, acumulado = 0;
const todas = new Set();
for (;;) {
  vuelta++;
  const r = pasar();
  r.claves.forEach((c) => todas.add(c));
  acumulado += r.total;
  console.log(`  vuelta ${vuelta}: ${r.total} frases · descartados por motivo ${JSON.stringify(r.motivos)}\n`);
  if (!escribir || r.total === 0 || vuelta >= 4) break;
}
console.log(`${acumulado} frases juntadas, ${todas.size} claves nuevas`);
writeFileSync('/tmp/agrupadas.json', JSON.stringify([...todas].sort(), null, 1));
