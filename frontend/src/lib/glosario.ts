// Glosario vivo: cada termino tecnico de ROSA2018 con su definicion en una frase,
// para que la ayuda de cada seccion lo explique donde aparece (en vez de
// obligar a buscarlo). Las claves son expresiones regulares sobre el texto
// del titulo y la nota de la seccion.

import { traducido } from './idioma';

export const GLOSARIO: { patron: RegExp; termino: string; definicion: string }[] = traducido([
  { patron: /\bElo\b/, termino: 'Elo', definicion: 'Puntuación del ranking, como en ajedrez: sube cuando una hipótesis gana un partido del torneo contra otra y baja cuando pierde. Empieza en 1500.' },
  { patron: /Bradley-?Terry|\bBT\b/, termino: 'Bradley-Terry', definicion: 'Otra forma de ordenar por partidos, con un intervalo de confianza: dice cuanta seguridad hay en el orden, no solo el orden.' },
  { patron: /\bkappa\b/i, termino: 'Kappa', definicion: 'Medida de acuerdo entre dos evaluadores (el juez y una persona) corregida por el acuerdo que se daría por azar. 0,6 o más es sustancial.' },
  { patron: /\bGRADE\b/, termino: 'GRADE', definicion: 'Marco de la medicina basada en evidencia para decir cuanta certeza hay (alta, moderada, baja, muy baja) y por que sube o baja.' },
  { patron: /prerregistr/i, termino: 'Prerregistro', definicion: 'Congelar por escrito, con fecha, la hipótesis, el protocolo y los criterios de éxito antes de tener datos, para que nadie cambie las reglas después.' },
  { patron: /puerta de reproducci/i, termino: 'Puerta de reproducción', definicion: 'Antes de descubrir nada, ROSA2018 tiene que reproducir tres análisis ya publicados dentro de una tolerancia. Si no puede, un resultado nuevo no se distingue de un error.' },
  { patron: /\bKiller\b/, termino: 'Killer', definicion: 'El revisor que somete cada hipótesis a quince comprobaciones fijas (citas reales, fidelidad a la fuente, supuestos, novedad...) y del que sale, por regla, si avanza, se reformula, se suspende o se descarta.' },
  { patron: /modelo de mundo/i, termino: 'Modelo de mundo', definicion: 'Lo que ROSA2018 da por sabido en esta investigación, hecho a hecho, cada uno con su fuente y su página. Nada entra sin pasar por la verificación.' },
  { patron: /procedencia/i, termino: 'Procedencia', definicion: 'De donde salió cada cosa: que fuente, que página, que código, que ejecución. Es lo que permite comprobar a ROSA2018 desde fuera.' },
  { patron: /\bhash\b|sha256/i, termino: 'Hash (sha256)', definicion: 'Una huella digital corta de un fichero o un texto: si cambia una coma, cambia la huella. Sirve para demostrar que algo no se toco.' },
  { patron: /sandbox/i, termino: 'Sandbox', definicion: 'El contenedor aislado y sin red donde ROSA2018 ejecuta el código de análisis: no puede tocar el ordenador ni salir a internet.' },
  { patron: /in silico/i, termino: 'In silico', definicion: 'Análisis hecho con código sobre datos ya existentes, en vez de en el laboratorio.' },
  { patron: /torneo/i, termino: 'Torneo', definicion: 'Comparaciones de dos en dos entre hipótesis rivales, juzgadas por un modelo, que alimentan el Elo. El juez las compara a ciegas: no ve el título, ni el cluster, ni lo que dictaminaron las revisiones automáticas, ni quién ganó partidos anteriores.' },
  { patron: /\bsolidez\b/i, termino: 'Solidez', definicion: 'Si la evidencia que se cita sostiene de verdad la hipótesis. La decide una regla sobre el registro, no un modelo: afirmaciones que su fuente no sostiene o cuya cita no resuelve, fuentes retractadas, análisis dados por no válidos, o descarte del Killer. Una hipótesis sin solidez pierde el partido del torneo sin que ningún modelo lo juzgue. Que algo esté sin verificar no quita solidez: eso es "no pude comprobar".' },
  { patron: /riesgo de sesgo/i, termino: 'Riesgo de sesgo', definicion: 'Cuanto puede estar distorsionado el resultado de un estudio por su diseño. Se evalua con instrumentos validados (RoB 2, ROBINS-I...), pregunta a pregunta.' },
  { patron: /entidad(es)? canonica/i, termino: 'Entidad canónica', definicion: 'Un gen, una célula o una enfermedad enlazados a su identificador oficial (HGNC, Cell Ontology, MONDO), para que GFAP y "glial fibrillary acidic protein" sean lo mismo.' },
  { patron: /libro de procedencia/i, termino: 'Libro de procedencia', definicion: 'La ficha de un dataset: de donde viene, con que licencia, si se puede usar con IA, su hash y que significa cada columna.' },
  { patron: /\bmision\b|\bmisión\b/i, termino: 'Misión', definicion: 'El marco de la investigación que ROSA2018 propone y tú apruebas: población, etapa, tejido, mecanismo, tipo de intervención, capacidades del laboratorio y presupuesto.' },
  { patron: /autonomia/i, termino: 'Autonomía', definicion: 'Cuanto hace ROSA2018 sola en cada clase de acción: sugerir, preguntar antes o actuar. Nunca toma sola una decisión que toque el mundo real.' },
  { patron: /\bskill/i, termino: 'Skill', definicion: 'Un método de análisis empaquetado (instrucciones y código) que ROSA2018 carga cuando el plan lo pide, como una plantilla de laboratorio.' },
  { patron: /conector/i, termino: 'Conector', definicion: 'La conexión a una base pública (PubMed, Open Targets, GEO...). Cada consulta queda registrada con lo que devolvió.' },
  { patron: /e-?valor/i, termino: 'E-valor', definicion: 'Una medida de evidencia acumulable prueba a prueba, alternativa al valor p, que permite seguir mirando sin inflar los falsos positivos.' },
  { patron: /\bRO-?Crate\b|\bPROV\b/, termino: 'RO-Crate y PROV', definicion: 'Formatos estándar para empaquetar un expediente con su procedencia de modo que cualquier herramienta de terceros lo verifique sin ROSA2018.' },
  { patron: /PRISMA/, termino: 'PRISMA', definicion: 'La guía con la que se reporta una revisión de la literatura: cuantos artículos se encontraron, se cribaron, se leyeron y se usaron, y por que se excluyo el resto.' },
  { patron: /cobertura/i, termino: 'Cobertura', definicion: 'Cuanto de lo relevante estima ROSA2018 haber encontrado ya en la literatura sobre un tema.' },
]);

export function terminosEn(texto: string): { termino: string; definicion: string }[] {
  const vistos = new Set<string>();
  const salida: { termino: string; definicion: string }[] = [];
  for (const g of GLOSARIO) {
    if (g.patron.test(texto) && !vistos.has(g.termino)) {
      vistos.add(g.termino);
      salida.push({ termino: g.termino, definicion: g.definicion });
    }
  }
  return salida;
}
