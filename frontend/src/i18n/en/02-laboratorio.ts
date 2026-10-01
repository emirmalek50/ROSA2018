/** «Al laboratorio»: la lámina, el oligonucleótido, el cribado, las especies
 *  y de qué fiarse. Es la pantalla con más texto propio de ROSA2018.
 *
 *  Términos que no se improvisan: «diana» es `target`, «cribado» es
 *  `screening`, «hueco» (el de ADN del gapmer) es `gap`, «ala» es `wing`,
 *  «fuera de diana» es `off-target`, «afirmación» es `claim`. */
export const LABORATORIO: Record<string, string> = {
  'Todas las dianas': 'All targets',
  'Todo lo que ROSA2018 ha verificado': 'Everything ROSA2018 has verified',
  'Lo que ROSA2018 mandaría al laboratorio': 'What ROSA2018 would send to the lab',
  'LA DECISIÓN DE ROSA2018': "ROSA2018'S DECISION",
  'POR QUÉ ESTA Y NO OTRA': 'WHY THIS ONE AND NOT ANOTHER',
  'POR QUÉ ESTE Y NO OTRO': 'WHY THIS ONE AND NOT ANOTHER',
  'Qué la cambiaría:': 'What would change it:',
  'Frente a las que sí competían:': 'Against the ones that did compete:',
  'Las que ni compitieron:': 'The ones that did not compete at all:',
  PROTEÍNAS: 'PROTEINS',
  'SE PUEDEN MANDAR': 'READY TO SEND',
  SOSTENIDAS: 'SUPPORTED',
  HIPÓTESIS: 'HYPOTHESES',
  'CON OLIGO DISEÑADO': 'WITH AN OLIGO DESIGNED',
  COMPUESTOS: 'COMPOUNDS',
  'SIN EXPERIMENTO': 'NO EXPERIMENT',
  AMINOÁCIDOS: 'AMINO ACIDS',
  ÁTOMOS: 'ATOMS',
  'TRAMO FIABLE': 'RELIABLE STRETCH',
  'CONFIANZA DEL MODELO': 'MODEL CONFIDENCE',
  LÁMINA: 'SHEET',
  PARTES: 'PARTS',
  'Acerca la rueda del ratón sobre la proteína': 'Scroll the mouse wheel over the protein',
  'Modelo predicho, no medido: el color dice de qué tramos se fía.':
    'A predicted model, not a measured one: the color says which stretches it trusts.',
  predicha: 'predicted',
  'PARA EL LABORATORIO': 'FOR THE LAB',
  copiar: 'copy',
  Copiar: 'Copy',

  // --- El oligonucleótido -------------------------------------------------
  'OLIGONUCLEÓTIDO ANTISENTIDO': 'ANTISENSE OLIGONUCLEOTIDE',
  'Cortar la producción de': 'Shut down production of',
  'Candidatos para reducir la producción': 'Candidates to lower production',
  'Candidata al laboratorio': 'Lab candidate',
  'Lo que NO hace:': 'What it does NOT do:',
  'A qué momento apunta la hipótesis que lo respalda:':
    'Which stage the supporting hypothesis points to:',
  'LA QUÍMICA DEL PEDIDO': 'THE CHEMISTRY OF THE ORDER',
  ARQUITECTURA: 'ARCHITECTURE',
  ALAS: 'WINGS',
  HUECO: 'GAP',
  ENLACES: 'LINKAGES',
  CITOSINAS: 'CYTOSINES',
  'CÓMO SE ADMINISTRA': 'HOW IT IS GIVEN',
  'A tener en cuenta:': 'Worth bearing in mind:',
  'DÓNDE CAE EN EL ARN': 'WHERE IT FALLS ON THE RNA',
  'DÓNDE CAE': 'WHERE IT FALLS',
  'CÓMO QUEDA PEGADO AL ARN': 'HOW IT SITS ON THE RNA',
  'Ampliación del ARN': 'RNA close-up',
  'Desliza la figura para recorrer las dos cadenas.': 'Drag the figure to travel along both strands.',
  'Banda del filtro: 40 a 60 % de G y C': 'Filter band: 40 to 60 % G and C',
  '% de G y C': '% G and C',
  'G MÁS C': 'G PLUS C',
  CpG: 'CpG',
  'SE PEGA A SÍ MISMO': 'SELF-COMPLEMENTARITY',
  MOTIVOS: 'MOTIFS',
  'LA DECISIÓN QUE NO TOMA ROSA2018': 'THE DECISION ROSA2018 DOES NOT MAKE',
  'Cuál bajar no es lo mismo que cuánta bajar': 'Which one to lower is not the same as how much to lower',
  'EL CRIBADO': 'THE SCREEN',
  CANDIDATOS: 'CANDIDATES',
  'Ala de 2\'-MOE: protege y agarra, pero aquí la RNasa H1 no corta':
    "2'-MOE wing: it protects and grips, but RNase H1 does not cut here",

  // --- El cribado contra el transcriptoma ---------------------------------
  'CRIBADO CONTRA EL TRANSCRIPTOMA HUMANO': 'SCREENED AGAINST THE HUMAN TRANSCRIPTOME',
  'Sin cribar contra el transcriptoma': 'Not screened against the transcriptome',
  'Sin parecido peligroso en ningún otro ARN humano': 'No dangerous match in any other human RNA',
  'Sin choque exacto en ningún otro ARN humano': 'No exact clash in any other human RNA',
  'Se parece a otros genes, pero al borde de lo que da el azar':
    'It resembles other genes, but at the edge of what chance alone produces',
  'No se puede pedir: encaja en otro gen donde la RNasa H1 cortaría':
    'Cannot be ordered: it matches another gene where RNase H1 would cut',
  'No aparece ni en su propio gen: hay que aclararlo':
    'It does not appear even in its own gene: this needs clearing up',
  'en su propio gen': 'in its own gene',
  'en otros genes': 'in other genes',
  ninguno: 'none',
  'mismo sitio, otro nombre': 'same locus, different name',
  'Dónde más encaja:': 'Where else it matches:',
  'fallos en las alas': 'mismatches in the wings',
  'genes ajenos donde cortaría': 'other genes it would cut',
  'al azar': 'by chance',
  'ninguno (idéntico)': 'none (identical)',
  'Qué NO cubre este cribado': 'What this screen does NOT cover',

  // --- Las especies -------------------------------------------------------
  '¿SE PUEDE PROBAR EN UN ROEDOR?': 'CAN THIS BE TESTED IN A RODENT?',
  'Sí: el experimento se hace con esta misma molécula':
    'Yes: the experiment can be run with this very molecule',
  'No: haría falta un oligo sustituto para el animal':
    'No: a surrogate oligo would be needed for the animal',
  'No se pudo comprobar': 'Could not be checked',
  especie: 'species',
  gen: 'gene',
  veredicto: 'verdict',
  'Qué NO dice esto': 'What this does NOT say',

  // --- El plegado ---------------------------------------------------------
  '¿ESTÁ ABIERTO EL SITIO EN EL ARN?': 'IS THE SITE OPEN ON THE RNA?',
  'El tramo está abierto': 'The stretch is open',
  'El tramo está a medias': 'The stretch is half open',
  'El tramo está tapado': 'The stretch is closed off',
  accesibilidad: 'accessibility',
  'en su transcrito': 'within its transcript',
  'el mejor sitio que hay': 'the best site there is',
  'mediana del transcrito': 'transcript median',
  'Qué NO dice este cálculo': 'What this calculation does NOT say',

  // --- De qué fiarse ------------------------------------------------------
  'DE QUÉ FIARSE Y DE QUÉ NO': 'WHAT TO TRUST AND WHAT NOT TO',
  'Qué es esto:': 'What this is:',
  'Lo que NO se ha comprobado': 'What has NOT been checked',
  'Exacto: se puede comprobar': 'Exact: it can be verified',
  'Modelo: algoritmo real, pero predicción': 'Model: a real algorithm, but a prediction',
  'Estadística: de experimentos de otros oligos': 'Statistics: from experiments on other oligos',
  'Esto lo decidió ROSA2018, y nadie lo ha validado':
    'ROSA2018 decided this, and nobody has validated it',

  // --- La dúplex ----------------------------------------------------------
  'largo de la dúplex': 'duplex length',
  'vueltas de hélice': 'helical turns',
  'giro por par': 'twist per pair',
  'surco menor': 'minor groove',
  'el ARN de la diana': 'the target RNA',
  'alas de 2\'-MOE': "2'-MOE wings",
  'hueco de ADN': 'DNA gap',
  'aquí corta la RNasa H1': 'RNase H1 cuts here',
  Alas: 'Wings',
  Hueco: 'Gap',
  ARN: 'RNA',
  'Qué es y qué NO es este dibujo': 'What this drawing is and is NOT',

  // --- Lo que no está en el muro -----------------------------------------
  'Lo que no está en el muro': 'What is not on the wall',
  'Nombradas y sin estructura que traer:': 'Named with no structure to fetch:',
  'Descartadas por resolverse solo por alias:': 'Dropped because they only resolved via an alias:',
  'Los compuestos que nombra': 'The compounds it names',
  FÓRMULA: 'FORMULA',
  PESO: 'WEIGHT',
  SMILES: 'SMILES',
  INCHIKEY: 'INCHIKEY',
  PUBCHEM: 'PUBCHEM',
};
