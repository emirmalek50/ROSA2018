/** El arbol, el atlas del cerebro, el glosario y «que desbloquea mas».
 *
 *  La anatomia y los tipos celulares van con el nombre que usa la literatura
 *  en ingles (entorhinal cortex, locus coeruleus, oligodendrocyte precursor
 *  cell), no con una traduccion literal del castellano. Lo mismo con GRADE,
 *  PRISMA y RoB 2, que ya tienen su terminologia propia. */
export const ARBOL_ATLAS: Record<string, string> = {
  // El arbol: tipos de nodo y de enlace.
  'Afirmación con dato': 'Claim with data',
  'Análisis in silico': 'In silico analysis',
  'Cluster de mecanismo': 'Mechanism cluster',
  'Conjunto de datos': 'Dataset',
  'Entidad canónica': 'Canonical entity',
  'Experimento en el laboratorio': 'Experiment in the lab',
  'Hecho del modelo de mundo': 'World-model fact',
  'Pregunta abierta': 'Open question',
  'Resultado del laboratorio': 'Lab result',
  'Área del programa': 'Programme area',
  'pertenece a': 'belongs to',
  'relación causal': 'causal relation',
  'rival en el torneo': 'rival in the tournament',
  'se prueba en': 'is tested in',

  // Distancia al dato.
  'Es una medición propia.': 'It is a measurement of its own.',
  'Es una medición propia: {q}.': 'It is a measurement of its own: {q}.',
  'A {n} salto de una medición propia.': '{n} hop from a measurement of its own.',
  'A {n} saltos de una medición propia.': '{n} hops from a measurement of its own.',
  'Sin medición propia detrás; es una fuente leída.': 'No measurement of its own behind it; it is a source that was read.',
  'Sin medición propia detrás; literatura a {n} salto.': 'No measurement of its own behind it; literature {n} hop away.',
  'Sin medición propia detrás; literatura a {n} saltos.': 'No measurement of its own behind it; literature {n} hops away.',
  'Sin medición propia detrás ni fuente leída que la sostenga.': 'Neither a measurement of its own nor a source read that supports it.',
  'medición propia': 'measurement of its own',
  'dato sintético: no cuenta como observación': 'synthetic data: it does not count as an observation',
  'análisis in silico completado y auditado como válido': 'in silico analysis completed and audited as valid',
  '{clase} {veredicto} por el verificador': '{clase} {veredicto} by the verifier',
  'dato derivado': 'derived datum',
  'observación original': 'original observation',
  'sostenida en parte': 'partly upheld',
  'resultado del laboratorio sobre el prerregistro': 'lab result against the preregistration',

  // Estados de ejecucion, auditoria y veredicto.
  'no ejecutado': 'not run',
  'error técnico': 'technical error',
  'error técnico: no es "sin efecto"': 'technical error: this is not "no effect"',
  'tiempo agotado': 'timed out',
  'tiempo agotado: no es "sin efecto"': 'timed out: this is not "no effect"',
  'no evaluable': 'not assessable',
  'válido': 'valid',
  'no válido': 'not valid',
  'sin auditar': 'not audited',
  'el auditor no lo dio por válido': 'the auditor did not find it valid',
  'no sostenida': 'not upheld',
  'sin verificar': 'not verified',
  'la cita no resuelve': 'the citation does not resolve',
  'ausencia refutada': 'absence refuted',
  'sin cita': 'no citation',
  'sin dato': 'no data',
  'sin efecto': 'no effect',
  'el verificador no la sostiene': 'the verifier does not uphold it',
  'el Killer propone descartar': 'the Killer proposes discarding it',

  // El atlas: regiones.
  'Estructura del lóbulo temporal medial, esencial para formar recuerdos nuevos. Es de las primeras regiones que se atrofian en el Alzheimer.':
    'A medial temporal lobe structure, essential for forming new memories. It is among the first regions to atrophy in Alzheimer.',
  'Puerta de entrada de la información hacia el hipocampo. Es donde empiezan los ovillos de tau (estadios I y II de Braak), antes de cualquier síntoma.':
    'The gateway for information into the hippocampus. It is where tau tangles begin (Braak stages I and II), before any symptom.',
  'Parte delantera del cerebro: planificar, decidir y controlar la conducta. Se afecta más tarde que las regiones de la memoria.':
    'The front of the brain: planning, deciding and controlling behaviour. It is affected later than the memory regions.',
  'Lóbulo lateral que procesa el lenguaje, el oído y el reconocimiento de caras y objetos. La corteza temporal media es de las primeras zonas neocorticales donde llega la tau.':
    'The lateral lobe that processes language, hearing and the recognition of faces and objects. The middle temporal cortex is among the first neocortical areas tau reaches.',
  'Región superior y posterior que integra el espacio y la atención. Su atrofia es más marcada en las formas de inicio temprano.':
    'The upper, posterior region that integrates space and attention. Its atrophy is more marked in early-onset forms.',
  'Cara interna de los hemisferios, parte de la red por defecto. El precúneo y el cíngulo posterior están entre los primeros sitios donde se deposita amiloide y donde baja el metabolismo en el PET.':
    'The medial surface of the hemispheres, part of the default mode network. The precuneus and posterior cingulate are among the first places where amyloid deposits and where metabolism drops on PET.',
  'Parte posterior del cerebro, donde se procesa la visión. Suele conservarse hasta fases avanzadas, salvo en la variante visual (atrofia cortical posterior).':
    'The back of the brain, where vision is processed. It is usually spared until late stages, except in the visual variant (posterior cortical atrophy).',
  'Núcleo del lóbulo temporal medial que procesa el miedo y la emoción. Se afecta pronto y se relaciona con los síntomas de conducta.':
    'A medial temporal lobe nucleus that processes fear and emotion. It is affected early and is linked to behavioural symptoms.',
  'Núcleos profundos que regulan el movimiento, la motivación y el paso de la información sensorial (tálamo). Incluye el núcleo basal de Meynert, de donde sale la acetilcolina de la corteza que se pierde en el Alzheimer.':
    'Deep nuclei that regulate movement, motivation and the relay of sensory information (thalamus). They include the nucleus basalis of Meynert, the source of the cortical acetylcholine that is lost in Alzheimer.',
  'La parte más baja del encéfalo, que conecta con la médula. El locus coeruleus, fuente de noradrenalina, es donde se ha descrito tau anómala más temprano.':
    'The lowest part of the brain, connecting to the spinal cord. The locus coeruleus, the source of noradrenaline, is where abnormal tau has been described earliest.',
  'Parte posterior e inferior que coordina el movimiento y el equilibrio. Se afecta poco en el Alzheimer, por eso sirve de región de referencia en el PET.':
    'The posterior, inferior part that coordinates movement and balance. It is little affected in Alzheimer, which is why it serves as the reference region on PET.',
  'Los cables del cerebro: los axones recubiertos de mielina que conectan unas regiones con otras. Sus lesiones (hiperintensidades en la resonancia) señalan daño vascular y pérdida de mielina.':
    'The brain’s wiring: the myelin-sheathed axons that connect one region to another. Its lesions (white matter hyperintensities on MRI) signal vascular damage and myelin loss.',
  'Los vasos que riegan el cerebro y la barrera hematoencefálica que filtra lo que pasa de la sangre al tejido. Cuando falla, deja pasar proteínas y células, y acompaña a la angiopatía amiloide.':
    'The vessels that supply the brain and the blood-brain barrier that filters what passes from blood into tissue. When it fails it lets proteins and cells through, and it accompanies amyloid angiopathy.',
  'Primera estación del olfato. La pérdida de olfato es un síntoma temprano y allí la tau aparece pronto.':
    'The first relay of smell. Loss of smell is an early symptom, and tau appears there early.',
  'Tejido nervioso del ojo, prolongación directa del cerebro. Se explora con tomografía de coherencia óptica (OCT) como ventana no invasiva.':
    'The nervous tissue of the eye, a direct extension of the brain. It is examined with optical coherence tomography (OCT) as a non-invasive window.',
  'El intestino y las bacterias que lo habitan. Se estudia su comunicación con el cerebro (eje intestino-cerebro) y su papel en la inflamación.':
    'The gut and the bacteria that live in it. Its communication with the brain (the gut-brain axis) and its role in inflammation are under study.',
  'Compartimento periférico: lo que se mide en un análisis de sangre. Biomarcadores como p-tau217, GFAP o NfL llegan aquí desde el cerebro. No es una región anatómica; en la figura va fuera del cerebro.':
    'A peripheral compartment: what a blood test measures. Biomarkers such as p-tau217, GFAP or NfL reach it from the brain. It is not an anatomical region; in the figure it sits outside the brain.',
  'Líquido que baña el cerebro y la médula; se obtiene por punción lumbar. Refleja de forma directa la bioquímica del cerebro (amiloide beta 42, tau total, p-tau181).':
    'The fluid that bathes the brain and spinal cord; it is obtained by lumbar puncture. It reflects the brain’s biochemistry directly (amyloid beta 42, total tau, p-tau181).',
  'La capa externa del cerebro en general, cuando la fuente no dice qué región concreta. No es un lugar: es una localización fallida, y por eso va en la bandeja de no localizados.':
    'The outer layer of the brain in general, when the source does not say which specific region. It is not a place: it is a failed localisation, which is why it goes in the unlocated tray.',
  'El cerebro en su conjunto, o sin región concreta en la fuente (una imagen global, un tejido sin especificar). No es un lugar: es una localización fallida, y por eso va en la bandeja de no localizados.':
    'The brain as a whole, or with no specific region in the source (a global image, unspecified tissue). It is not a place: it is a failed localisation, which is why it goes in the unlocated tray.',
  'Región nueva del backend, sin definición en llano todavía.': 'A new region from the backend, with no plain-language definition yet.',

  // El atlas: tipos celulares.
  'La célula que transmite señales eléctricas. La pérdida de neuronas y de sus sinapsis es lo que produce los síntomas.':
    'The cell that transmits electrical signals. The loss of neurons and their synapses is what produces the symptoms.',
  'Célula de sostén con forma de estrella: alimenta a las neuronas, regula el medio y forma parte de la barrera hematoencefálica. Cuando se activa libera GFAP.':
    'A star-shaped support cell: it feeds neurons, regulates their environment and forms part of the blood-brain barrier. When activated it releases GFAP.',
  'La célula inmune propia del cerebro: limpia restos y placas y, activada de forma crónica, mantiene la inflamación.':
    'The brain’s own immune cell: it clears debris and plaques and, chronically activated, sustains inflammation.',
  'Célula que fabrica la mielina que aísla los axones.': 'The cell that makes the myelin insulating the axons.',
  'Célula precursora que puede convertirse en oligodendrocito y reparar la mielina.':
    'A precursor cell that can become an oligodendrocyte and repair myelin.',
  'Capa de células que recubre el interior de los vasos y forma la barrera hematoencefálica.':
    'The cell layer lining the inside of the vessels, forming the blood-brain barrier.',
  'Célula que envuelve los capilares: regula el flujo y la permeabilidad de la barrera. Su pérdida la debilita.':
    'The cell that wraps the capillaries: it regulates flow and the barrier’s permeability. Losing it weakens the barrier.',
  'Células inmunes de la sangre (linfocitos, monocitos, macrófagos) que pueden entrar al cerebro o influir desde fuera.':
    'Immune cells from the blood (lymphocytes, monocytes, macrophages) that can enter the brain or act on it from outside.',

  // El atlas: resumen y ejes.
  'Ningún hecho ni hipótesis situados con estos filtros.': 'No fact or hypothesis placed under these filters.',
  '{hechos} y {hipotesis} situados en {celdas} (estadio, región y tipo celular).':
    '{hechos} and {hipotesis} placed across {celdas} (stage, region and cell type).',
  '{ejes}: la misión lo nombra y ningún hecho ni hipótesis lo cubre por su propio contenido.':
    '{ejes}: the mission names it and no fact or hypothesis covers it by its own content.',
  'Sin ejes': 'No axes',
  'Estadios': 'Stages',
  'Regiones': 'Regions',
  'Tipos celulares': 'Cell types',
  'sin fase identificada': 'no stage identified',
  'sin tipo celular': 'no cell type',
  hecho: 'fact',
  celda: 'cell',
  'hipótesis': 'hypothesis',
  'plural\u0004hipótesis': 'hypotheses',

  // El glosario.
  'Puntuación del ranking, como en ajedrez: sube cuando una hipótesis gana un partido del torneo contra otra y baja cuando pierde. Empieza en 1500.':
    'The ranking score, as in chess: it rises when a hypothesis wins a tournament match against another and falls when it loses. It starts at 1500.',
  'Otra forma de ordenar por partidos, con un intervalo de confianza: dice cuanta seguridad hay en el orden, no solo el orden.':
    'Another way of ranking from matches, with a confidence interval: it says how much certainty there is in the order, not just the order.',
  'Comparaciones de dos en dos entre hipótesis rivales, juzgadas por un modelo, que alimentan el Elo. El juez las compara a ciegas: no ve el título, ni el cluster, ni lo que dictaminaron las revisiones automáticas, ni quién ganó partidos anteriores.':
    'Pairwise comparisons between rival hypotheses, judged by a model, that feed the Elo. The judge compares them blind: it sees neither the title, nor the cluster, nor what the automatic reviews ruled, nor who won earlier matches.',
  'Marco de la medicina basada en evidencia para decir cuanta certeza hay (alta, moderada, baja, muy baja) y por que sube o baja.':
    'The evidence-based medicine framework for stating how much certainty there is (high, moderate, low, very low) and why it is rated up or down.',
  'Cuanto puede estar distorsionado el resultado de un estudio por su diseño. Se evalua con instrumentos validados (RoB 2, ROBINS-I...), pregunta a pregunta.':
    'How far a study’s result may be distorted by its design. It is assessed with validated instruments (RoB 2, ROBINS-I...), domain by domain.',
  'Medida de acuerdo entre dos evaluadores (el juez y una persona) corregida por el acuerdo que se daría por azar. 0,6 o más es sustancial.':
    'A measure of agreement between two raters (the judge and a person) corrected for the agreement that would occur by chance. 0.6 or above is substantial.',
  'La guía con la que se reporta una revisión de la literatura: cuantos artículos se encontraron, se cribaron, se leyeron y se usaron, y por que se excluyo el resto.':
    'The guideline for reporting a literature review: how many records were found, screened, read and used, and why the rest were excluded.',
  'Congelar por escrito, con fecha, la hipótesis, el protocolo y los criterios de éxito antes de tener datos, para que nadie cambie las reglas después.':
    'Freezing in writing, with a date, the hypothesis, the protocol and the success criteria before there are any data, so nobody changes the rules afterwards.',
  'Lo que ROSA2018 da por sabido en esta investigación, hecho a hecho, cada uno con su fuente y su página. Nada entra sin pasar por la verificación.':
    'What ROSA2018 takes as known in this investigation, fact by fact, each with its source and page. Nothing enters without passing verification.',
  'El marco de la investigación que ROSA2018 propone y tú apruebas: población, etapa, tejido, mecanismo, tipo de intervención, capacidades del laboratorio y presupuesto.':
    'The frame of the investigation that ROSA2018 proposes and you approve: population, stage, tissue, mechanism, kind of intervention, lab capabilities and budget.',
  'El revisor que somete cada hipótesis a quince comprobaciones fijas (citas reales, fidelidad a la fuente, supuestos, novedad...) y del que sale, por regla, si avanza, se reformula, se suspende o se descarta.':
    'The reviewer that puts every hypothesis through fifteen fixed checks (real citations, fidelity to the source, assumptions, novelty...) and from which it follows, by rule, whether it advances, is reformulated, is suspended or is discarded.',
  'Un gen, una célula o una enfermedad enlazados a su identificador oficial (HGNC, Cell Ontology, MONDO), para que GFAP y "glial fibrillary acidic protein" sean lo mismo.':
    'A gene, a cell or a disease linked to its official identifier (HGNC, Cell Ontology, MONDO), so that GFAP and "glial fibrillary acidic protein" are the same thing.',
  'De donde salió cada cosa: que fuente, que página, que código, que ejecución. Es lo que permite comprobar a ROSA2018 desde fuera.':
    'Where each thing came from: which source, which page, which code, which run. It is what makes ROSA2018 checkable from outside.',
  'Una huella digital corta de un fichero o un texto: si cambia una coma, cambia la huella. Sirve para demostrar que algo no se toco.':
    'A short fingerprint of a file or a text: change one comma and the fingerprint changes. It serves to show that something was not touched.',
  'Formatos estándar para empaquetar un expediente con su procedencia de modo que cualquier herramienta de terceros lo verifique sin ROSA2018.':
    'Standard formats for packaging a dossier with its provenance so that any third-party tool can verify it without ROSA2018.',
  'El contenedor aislado y sin red donde ROSA2018 ejecuta el código de análisis: no puede tocar el ordenador ni salir a internet.':
    'The isolated, network-free container where ROSA2018 runs analysis code: it cannot touch the computer or reach the internet.',
  'Análisis hecho con código sobre datos ya existentes, en vez de en el laboratorio.':
    'An analysis done with code over existing data, rather than in the lab.',
  'Un método de análisis empaquetado (instrucciones y código) que ROSA2018 carga cuando el plan lo pide, como una plantilla de laboratorio.':
    'A packaged analysis method (instructions and code) that ROSA2018 loads when the plan calls for it, like a lab template.',
  'La conexión a una base pública (PubMed, Open Targets, GEO...). Cada consulta queda registrada con lo que devolvió.':
    'The connection to a public database (PubMed, Open Targets, GEO...). Every query is logged with what it returned.',
  'La ficha de un dataset: de donde viene, con que licencia, si se puede usar con IA, su hash y que significa cada columna.':
    'A dataset’s record: where it comes from, under what licence, whether it may be used with AI, its hash and what each column means.',
  'Antes de descubrir nada, ROSA2018 tiene que reproducir tres análisis ya publicados dentro de una tolerancia. Si no puede, un resultado nuevo no se distingue de un error.':
    'Before discovering anything, ROSA2018 has to reproduce three already published analyses within a tolerance. If it cannot, a new result is indistinguishable from a bug.',
  'Cuanto hace ROSA2018 sola en cada clase de acción: sugerir, preguntar antes o actuar. Nunca toma sola una decisión que toque el mundo real.':
    'How much ROSA2018 does on its own for each class of action: suggest, ask first, or act. It never takes a decision that touches the real world on its own.',
  'Cuanto de lo relevante estima ROSA2018 haber encontrado ya en la literatura sobre un tema.':
    'How much of what is relevant ROSA2018 estimates it has already found in the literature on a topic.',
  'Una medida de evidencia acumulable prueba a prueba, alternativa al valor p, que permite seguir mirando sin inflar los falsos positivos.':
    'A measure of evidence that accumulates test by test, an alternative to the p-value, that allows continued looking without inflating false positives.',
  'Si la evidencia que se cita sostiene de verdad la hipótesis. La decide una regla sobre el registro, no un modelo: afirmaciones que su fuente no sostiene o cuya cita no resuelve, fuentes retractadas, análisis dados por no válidos, o descarte del Killer. Una hipótesis sin solidez pierde el partido del torneo sin que ningún modelo lo juzgue. Que algo esté sin verificar no quita solidez: eso es "no pude comprobar".':
    'Whether the evidence cited really supports the hypothesis. A rule over the record decides it, not a model: claims their source does not support or whose citation does not resolve, retracted sources, analyses ruled not valid, or a Killer discard. A hypothesis without soundness loses its tournament match without any model judging it. Something being unverified does not remove soundness: that is "could not check".',
  'Autonomía': 'Autonomy',
  'Puerta de reproducción': 'Reproduction gate',
  'Riesgo de sesgo': 'Risk of bias',
  'Libro de procedencia': 'Provenance ledger',
  'Modelo de mundo': 'World model',
  'Misión': 'Mission',
  'In silico': 'In silico',
  'Hash (sha256)': 'Hash (sha256)',
  'RO-Crate y PROV': 'RO-Crate and PROV',

  // Que desbloquea mas: vias e ingredientes.
  'Pedir datos de una cohorte': 'Request data from a cohort',
  'Buscar en lo publicado': 'Search what is published',
  'Hacer el análisis': 'Run the analysis',
  'Investigación nueva': 'New research',
  'hace falta una solicitud de datos': 'a data request is needed',
  'artículos, suplementos y registros de ensayos': 'articles, supplements and trial registries',
  'no hace falta pedir nada': 'nothing needs to be requested',
  'un estudio que todavía no existe': 'a study that does not exist yet',
  'Estado amiloide de cada persona': 'Each person’s amyloid status',
  'Si cada participante tiene amiloide cerebral, medido por PET o en líquido cefalorraquídeo, con fecha y método, y sin usar los marcadores que se estudian.':
    'Whether each participant has brain amyloid, measured by PET or in cerebrospinal fluid, with date and method, and without using the markers under study.',
  'La cohorte de estudio (en ADNI, PET amiloide y líquido cefalorraquídeo).': 'The study cohort (in ADNI, amyloid PET and cerebrospinal fluid).',
  'Muestras seriadas frecuentes': 'Frequent serial samples',
  'Varias extracciones por persona, lo bastante seguidas como para fechar cuándo cambia cada marcador.':
    'Several draws per person, close enough together to date when each marker changes.',
  'La cohorte de estudio: número, espaciado y duración de las extracciones.': 'The study cohort: number, spacing and duration of the draws.',
  'Tamaño del subgrupo en la cohorte': 'Subgroup size in the cohort',
  'Cuántas personas cumplen a la vez todas las condiciones de la hipótesis (APOE ε4, amiloide positivo, cognición normal, plasma seriado). Sin ese número no se sabe si el estudio se puede hacer.':
    'How many people meet all the hypothesis’s conditions at once (APOE ε4, amyloid positive, normal cognition, serial plasma). Without that number there is no telling whether the study can be done.',
  'ADNI, que es de acceso controlado y que hoy el proyecto no solicita.': 'ADNI, which is controlled access and which the project is not requesting today.',
  'Fiabilidad de la medida': 'Reliability of the measurement',
  'Que el marcador se mida con precisión (variación del ensayo, lotes, muestras archivadas) y de forma comparable entre visitas, laboratorios, plataformas y compartimentos.':
    'That the marker is measured precisely (assay variation, batches, archived samples) and comparably across visits, laboratories, platforms and compartments.',
  'La validación analítica de cada ensayo y los estudios de armonización entre plataformas.':
    'The analytical validation of each assay and the cross-platform harmonisation studies.',
  'Intervalo de referencia': 'Reference interval',
  'Los límites de lo normal para cada marcador, sacados de personas sanas y amiloide-negativas que no son las del estudio, con el mismo ensayo de laboratorio y ajustados por edad y sexo.':
    'The limits of normal for each marker, taken from healthy, amyloid-negative people who are not those in the study, with the same laboratory assay and adjusted for age and sex.',
  'Publicaciones de valores de referencia por plataforma; si no existen, una muestra de referencia propia.':
    'Published reference values per platform; failing that, a reference sample of one’s own.',
  'Covariables para ajustar': 'Covariates to adjust for',
  'Peso, función renal, volumen plasmático, edad y sexo medidos junto a cada muestra, para separar un efecto real de lo que solo lo imita.':
    'Weight, renal function, plasma volume, age and sex measured alongside each sample, to separate a real effect from what merely mimics one.',
  'La cohorte o el ensayo, junto a cada extracción.': 'The cohort or the trial, alongside each draw.',
  'Resultados de cohortes por subgrupo': 'Cohort results by subgroup',
  'Lo que las cohortes ya publicaron, desglosado por el subgrupo que pide la hipótesis (APOE ε4, amiloide positivo) y con la cifra que hace falta.':
    'What the cohorts have already published, broken down by the subgroup the hypothesis asks for (APOE ε4, amyloid positive) and with the figure that is needed.',
  'Artículos de las cohortes longitudinales y su material suplementario.': 'Articles from the longitudinal cohorts and their supplementary material.',
  'Resultados de ensayos clínicos': 'Clinical trial results',
  'Lo que cada ensayo publicó de cada biomarcador, tratamiento frente a placebo: valores absolutos, con su incertidumbre y por subgrupos.':
    'What each trial published for each biomarker, treatment versus placebo: absolute values, with their uncertainty and by subgroup.',
  'Artículos y suplementos de los ensayos, y los resultados estructurados de ClinicalTrials.gov, que ROSA2018 todavía no lee.':
    'Trial articles and supplements, and the structured results on ClinicalTrials.gov, which ROSA2018 does not read yet.',
  'Desenlace clínico comparable': 'Comparable clinical outcome',
  'Una medida clínica que valga lo mismo entre ensayos (CDR-SB frente a iADRS, duraciones distintas) y que se mueva lo bastante para ver el efecto.':
    'A clinical measure that means the same across trials (CDR-SB versus iADRS, different durations) and that moves enough for the effect to be visible.',
  'Estudios de equivalencia entre escalas y el protocolo de cada ensayo.': 'Equivalence studies between scales and each trial’s protocol.',
  'Biología sin medir': 'Unmeasured biology',
  'Lo que la hipótesis da por hecho y nadie ha medido todavía: qué refleja de verdad un marcador, si un fármaco llega al cerebro, si un efecto depende de la dosis.':
    'What the hypothesis takes for granted and nobody has measured yet: what a marker really reflects, whether a drug reaches the brain, whether an effect depends on dose.',
  'Un estudio nuevo o una revisión dirigida. No se resuelve pidiendo un conjunto de datos.':
    'A new study or a targeted review. It is not resolved by requesting a dataset.',
  'Que el análisis se pueda estimar': 'That the analysis can be estimated',
  'Que el diseño permita estimar lo que se pide (una brecha entre dos fechas que no se observan exactas, un modelo con varios estados) sin supuestos que no se puedan comprobar.':
    'That the design allows estimating what is asked (a gap between two dates that are not observed exactly, a multi-state model) without assumptions that cannot be checked.',
  'No hace falta pedir nada: se prueba con datos sintéticos antes de tocar los reales (el ensayo en seco de ROSA2018).':
    'Nothing needs to be requested: it is tested on synthetic data before touching the real data (ROSA2018’s dry run).',

  // Vigencia de los supuestos.
  'Sus supuestos están al día.': 'Its assumptions are up to date.',
  'Sus supuestos se evaluaron {regla}.': 'Its assumptions were assessed {regla}.',
  'con una regla anterior a la de hoy': 'under a rule older than today’s',
  'Le llegó 1 afirmación después de evaluar sus supuestos.': '1 claim arrived after its assumptions were assessed.',
  'Le llegaron {n} afirmaciones después de evaluar sus supuestos.': '{n} claims arrived after its assumptions were assessed.',
  'El modelo no pudo evaluar alguno de sus supuestos: eso es "no pude comprobar", no "no hay".':
    'The model could not assess some of its assumptions: that is "could not check", not "there is none".',
  'No consta cuándo se evaluaron sus supuestos.': 'There is no record of when its assumptions were assessed.',
  'antes del 18 de septiembre, cuando el evaluador no miraba la evidencia propia de la hipótesis sino el principio de las afirmaciones de la corrida':
    'before 18 September, when the assessor looked not at the hypothesis’s own evidence but at the start of the run’s claims',
  'antes del 23 de septiembre, cuando «sin evidencia» no decía si las fuentes habían tocado el tema, ni qué límite ponía un resultado nulo':
    'before 23 September, when "no evidence" did not say whether the sources had touched the topic, nor what bound a null result placed',
  'cada ensayo': 'each trial',
  'los ensayos': 'the trials',
  'ambos ensayos': 'both trials',
  'específico del ensayo': 'assay-specific',
  'se publican métricas de calibración': 'calibration metrics are published',
  'cruce del umbral': 'threshold crossing',
};
