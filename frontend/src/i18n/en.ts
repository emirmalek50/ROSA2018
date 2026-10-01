// El catálogo en inglés. La clave es la frase en castellano tal cual aparece
// en el código: ver `src/lib/idioma.ts` para por qué.
//
// Reglas al traducir, que aquí no son cosmética:
//
//   - Los términos del dominio van por su nombre establecido en inglés, no
//     por el que suena parecido: «afirmación» es `claim`, «diana» es
//     `target`, «cribado» es `screening`, «corrida» es `run`, «hipótesis
//     suspendida» es `on hold`. Un término mal traducido en una herramienta
//     científica es un error, no una errata.
//   - Lo que en castellano distingue «no pude comprobar» de «no hay» tiene
//     que seguir distinguiéndolo en inglés: `could not check` frente a
//     `none found`. Esa distinción es una regla del proyecto.
//   - Las frases de GRADE van con la redacción de GRADE en inglés, que es su
//     idioma original: `moderate certainty`, `very low certainty`.
//   - Lo que no esté aquí se ve en castellano. Es a propósito: una frase sin
//     traducir se lee; una clave sin traducir, no.
//
// Lo que falta todavía (1 de octubre de 2026): la prosa que genera el backend
// (el cribado, las especies, GRADE, el Killer) y las 48.987 frases que
// ROSA2018 escribió en sus corridas. Van en las etapas siguientes.

export const EN: Record<string, string> = {
  // --- La cáscara: lo que se ve en cualquier pantalla --------------------
  'Abrir el menú': 'Open the menu',
  'Navegación principal': 'Main navigation',
  Investigaciones: 'Investigations',
  'Nueva investigación': 'New investigation',
  'Esta investigación': 'This investigation',
  'De todas las investigaciones': 'Across all investigations',
  'Buscar en la investigación (Cmd+K o Ctrl+K)': 'Search this investigation (Cmd+K or Ctrl+K)',
  'Buscar (Cmd+K)': 'Search (Cmd+K)',
  Ajustes: 'Settings',
  Buscar: 'Search',
  Nueva: 'New',
  'Cómo funciona ROSA2018': 'How ROSA2018 works',

  Sencillo: 'Simple',
  Detalle: 'Detail',
  'Modo de la interfaz': 'Interface mode',
  'Sencillo: lo que decides tú, con la ingeniería plegada. Detalle: todo abierto.':
    'Simple: what you decide, with the engineering folded away. Detail: everything open.',
  'Permisos, incidencias, planes e hipótesis que esperan tu decisión':
    'Permissions, incidents, plans and hypotheses waiting on your decision',
  espera: 'waiting',
  esperan: 'waiting',
  'Ver el recorrido de ROSA2018': 'Take the ROSA2018 tour',
  'Cómo funciona ROSA2018, en cinco pasos': 'How ROSA2018 works, in five steps',
  'ROSA2018 investiga; la persona decide.': 'ROSA2018 investigates; a person decides.',
  'Ninguna hipótesis entra al modelo de mundo sin pasar por la cola.':
    'No hypothesis enters the world model without going through the queue.',

  // --- El idioma ----------------------------------------------------------
  Idioma: 'Language',
  'Idioma de la interfaz': 'Interface language',
  'Cambiar idioma': 'Change language',
  'Lo que todavía no está traducido se ve en castellano.':
    'Anything not yet translated is shown in Spanish.',

  // --- Las secciones ------------------------------------------------------
  'Al laboratorio': 'To the lab',
  'Atlas de la enfermedad': 'Disease atlas',
  'Cola de hipótesis': 'Hypothesis queue',
  'Corrida en vivo': 'Live run',
  Análisis: 'Analysis',
  'Modelo de mundo': 'World model',
  Hipótesis: 'Hypotheses',
  Afirmaciones: 'Claims',
  Fuentes: 'Sources',
  Conclusión: 'Conclusion',

  // --- Lo que no se puede confundir nunca ---------------------------------
  // «No pude comprobar» no es «no hay»: es una regla del proyecto y en
  // inglés tiene que seguir siendo dos cosas distintas.
  'No pude comprobar': 'Could not check',
  'no pude comprobar': 'could not check',
  'No quiere decir que no haya': 'It does not mean there is none',
  'Sin respuesta de la fuente': 'No response from the source',
  'Tiempo agotado': 'Timed out',
};
