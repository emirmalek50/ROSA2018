// El ingles del catalogo va en variante de Estados Unidos, porque es a quien
// va dirigido. Afecta solo al VALOR (la traduccion), nunca a la clave, que
// esta en castellano.
//
// Cuidado con dos cosas: los nombres propios se quedan como se llaman
// («Alzheimer's Disease Neuroimaging Initiative», «Medical Research
// Council»), y «practice/license» cambian de clase de palabra entre las dos
// variantes, asi que solo se tocan las formas que no son ambiguas.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Pares britanico -> estadounidense. Se aplican sin distinguir mayusculas y
// se devuelve la caja original, porque en la interfaz hay rotulos en
// MAYUSCULAS («QUE LE FALTA AL PROGRAMA») y frases capitalizadas.
const PAREJAS = [
  [/randomis(ed|ing|ation|e|es)?/gi, (s) => `randomiz${s ?? 'e'}`],
  [/analys(ed|ing|es|e)/gi, (s) => `analyz${s}`],
  [/behaviou(rs|ral|rally|r)/gi, (s) => `behavio${s}`],
  [/harmonis(ed|ing|ation|es|e)?/gi, (s) => `harmoniz${s ?? 'e'}`],
  [/organis(ed|ing|ation|es|e)/gi, (s) => `organiz${s}`],
  [/recognis(ed|ing|able|es|e)/gi, (s) => `recogniz${s}`],
  [/normalis(ed|ing|ation|es|e)/gi, (s) => `normaliz${s}`],
  [/summaris(ed|ing|es|e)/gi, (s) => `summariz${s}`],
  [/prioritis(ed|ing|ation|es|e)/gi, (s) => `prioritiz${s}`],
  [/characteris(ed|ing|ation|es|e)/gi, (s) => `characteriz${s}`],
  [/standardis(ed|ing|ation|es|e)/gi, (s) => `standardiz${s}`],
  [/localis(ed|ing|ation|es|e)/gi, (s) => `localiz${s}`],
  [/minimis(ed|ing|es|e)/gi, (s) => `minimiz${s}`],
  [/maximis(ed|ing|es|e)/gi, (s) => `maximiz${s}`],
  [/utilis(ed|ing|es|e)/gi, (s) => `utiliz${s}`],
  [/programme/gi, () => 'program'],
  [/colour(s|ed|ing)?/gi, (s) => `color${s ?? ''}`],
  [/grey/gi, () => 'gray'],
  [/ageing/gi, () => 'aging'],
  [/catalogue/gi, () => 'catalog'],
  [/licence/gi, () => 'license'],
  [/defence/gi, () => 'defense'],
  [/labelled/gi, () => 'labeled'],
  [/modelling/gi, () => 'modeling'],
  [/haem(o|a)/gi, (s) => `hem${s}`],  // haemorrhage, haematoma, haemoglobin
  [/oedema/gi, () => 'edema'],
  [/centre(s)?/gi, (s) => `center${s ?? ''}`],
  [/fibre(s)?/gi, (s) => `fiber${s ?? ''}`],
  [/litre(s)?/gi, (s) => `liter${s ?? ''}`],
  [/metre(s)?/gi, (s) => `meter${s ?? ''}`],
];

/** Devuelve `nueva` con la caja de `vieja`: TODO MAYUSCULAS, Capitalizada o
 *  tal cual. Sin esto, «PROGRAMME» se quedaba sin cambiar. */
function mismaCaja(vieja, nueva) {
  if (vieja === vieja.toUpperCase() && /[A-Z]{2}/.test(vieja)) return nueva.toUpperCase();
  if (vieja[0] === vieja[0].toUpperCase()) return nueva[0].toUpperCase() + nueva.slice(1);
  return nueva;
}


// Nombres propios que se quedan como se llaman, aunque lleven una de esas
// palabras. Se protegen antes de sustituir y se devuelven despues.
const NOMBRES = [
  "Alzheimer's Disease Neuroimaging Initiative",
  'Medical Research Council',
  'Mount Sinai Brain Bank',
  'Sydney Memory and Ageing Study',
  'Australian Imaging, Biomarkers and Lifestyle',
  'Centre for', 'Cochrane Centre',
  // El PREVENT Dementia programme se llama asi: es un estudio britanico.
  'PREVENT Dementia programme',
];

function aEEUU(s) {
  const guardados = [];
  let t = s;
  for (const n of NOMBRES) {
    if (t.includes(n)) {
      const marca = `\u0000${guardados.length}\u0000`;
      guardados.push(n);
      t = t.split(n).join(marca);
    }
  }
  for (const [re, f] of PAREJAS) {
    t = t.replace(new RegExp(`\\b${re.source}\\b`, re.flags), (m, ...g) => mismaCaja(m, f(g[0])));
  }
  guardados.forEach((n, i) => { t = t.split(`\u0000${i}\u0000`).join(n); });
  return t;
}

const escribir = process.argv.includes('--escribir');
let total = 0;
for (const f of execSync('ls src/i18n/en/*.ts', { encoding: 'utf8' }).trim().split('\n')) {
  const src = readFileSync(f, 'utf8');
  // solo el VALOR: lo que va despues de «: » hasta la coma final de la linea
  const salida = src.replace(/^(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-z0-9_ÁÉÍÓÚÑáéíóúñ]*)\s*:\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gm,
    (m, izq, val) => {
      const nuevo = aEEUU(val);
      if (nuevo !== val) { total++; if (!escribir) console.log(`  ${val.slice(0, 54)} -> ${nuevo.slice(0, 54)}`); }
      return izq + nuevo;
    });
  if (escribir && salida !== src) writeFileSync(f, salida);
}
console.log(`\n${total} valores pasados a ingles de Estados Unidos`);
