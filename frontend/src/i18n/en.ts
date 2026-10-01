// El catálogo en inglés. La clave es la frase en castellano tal cual aparece
// en el código: ver `src/lib/idioma.ts` para por qué.
//
// Va partido en lotes por pantalla para poder añadir sin tocar lo anterior, y
// porque un fichero de mil entradas no se revisa.
//
// Reglas al traducir, que aquí no son cosmética:
//
//   - Los términos del dominio van por su nombre establecido en inglés, no
//     por el que suena parecido: «afirmación» es `claim`, «diana» es
//     `target`, «cribado» es `screening`, «corrida» es `run`, «hueco» (el de
//     ADN del gapmer) es `gap`, «ala» es `wing`, «fuera de diana» es
//     `off-target`. Un término mal traducido en una herramienta científica es
//     un error, no una errata.
//   - Lo que en castellano distingue «no pude comprobar» de «no hay» tiene
//     que seguir distinguiéndolo en inglés: `could not check` frente a
//     `none found`. Esa distinción es una regla del proyecto.
//   - Las frases de GRADE van con la redacción de GRADE en inglés, que es su
//     idioma original: `moderate certainty`, `very low certainty`.
//   - Lo que no esté aquí se ve en castellano. Es a propósito: una frase sin
//     traducir se lee; una clave sin traducir, no.

import { CASCARA } from './en/01-cascara';
import { LABORATORIO } from './en/02-laboratorio';
import { ETIQUETAS } from './en/03-etiquetas';
import { ETIQUETAS2 } from './en/04-etiquetas';

export const EN: Record<string, string> = {
  ...CASCARA,
  ...LABORATORIO,
  ...ETIQUETAS,
  ...ETIQUETAS2,
};
