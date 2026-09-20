"""Método como nodo: cohortes, plataformas de medida y muestras con identificador canónico.

Hoy ROSA2018 decide "misma cohorte" en tres sitios con tres reglas distintas:
`priorizacion.cohortes_de` compara la cadena exacta en minúsculas,
`certeza.cohortes_distintas` compara tokens quitando paréntesis y palabras
genéricas, y `killer.grupos_de_cohorte` compara la cadena exacta y añade la
heurística de autores, centro y año. Y la lista de cohortes que reconoce en
un título (`killer.COHORTES_CONOCIDAS`) son 30 nombres sin alias: "Swedish
BioFINDER" no es "BioFINDER" y "Alzheimer's Disease Neuroimaging Initiative"
no es "ADNI".

Aquí el método deja de ser una cadena y pasa a ser un nodo con identificador
estable, como las entidades de `ontologias.py`:

  cohorte:adni        ADNI, Alzheimer's Disease Neuroimaging Initiative, ADNI-3...
  plataforma:simoa    Simoa, Quanterix, HD-X, ALZpath...
  muestra:plasma      plasma, plasmático...
  ensayo:NCT0123...   cualquier registro de ClinicalTrials.gov (no está en el catálogo)

Con eso las tres reglas se sustituyen por una: dos fuentes son de la misma
cohorte si resuelven al mismo identificador; si ninguna resuelve, se comparan
por tokens como hacía `certeza.py` ("ADAD (Belder et al.)" y "ADAD" son una).
Y el Killer y la escalera GRADE pueden decir algo que antes no podían: que
tres cohortes distintas medidas todas con Simoa concuerdan, pero esa
concordancia no es independiente del instrumento (Cochrane 7.2.2 sobre la
unidad de análisis; GRADE sobre la consistencia).

Reglas de reconocimiento, todas deterministas y con motivo:

- Bordes de palabra que no rompen con guiones ni números: "BioFINDER-2" y
  "ADNI-3" resuelven a BioFINDER y ADNI; "adnexal" no resuelve a nada. Si el
  alias termina en cifra ("A4", "H70") tampoco puede seguirle otra cifra, para
  que "A40" y "H700" no cuenten. Las tildes son opcionales en el texto
  ("liquido cefalorraquideo" sin acentos, como sale de algunos PDF, casa con
  "líquido cefalorraquídeo") y "Alzheimer's", "Alzheimers" y "Alzheimer" son
  la misma palabra.
- Las siglas (todo mayúsculas, sin espacios) se buscan respetando las
  mayúsculas en texto libre: "wrap", "triad", "finger", "alfa" o "map" en
  minúsculas son palabras, no cohortes. Los nombres largos y mixtos se buscan
  sin distinguir mayúsculas. En un campo que ya es un nombre de cohorte
  (`canonizar_cohorte`) las mayúsculas no importan.
- Los nombres ambiguos por sí solos no cuentan (`AMBIGUOS`, con su motivo):
  "Mayo" es un mes y un centro con varias cohortes, "Gothenburg" y
  "Rotterdam" son la afiliación de medio campo, "ROS" son especies reactivas
  de oxígeno, "ADC" es un coeficiente de difusión, "3C" es un panel de figura.
- Cuando dos nombres se solapan en el texto gana el más largo que empieza
  antes: "J-ADNI" es J-ADNI, no ADNI.
- Un nombre precedido de "non-" niega ("non-ADNI cohorts" no es ADNI) y un
  alias puede llevar contexto que lo anula: lo que le sigue (`excepto`:
  "Framingham risk score", "Alamar Blue"), lo que le precede (`no_tras`:
  "Table A4", "Fig. A4") o cualquier cosa en el mismo texto (`salvo_si`:
  "PEA" no es Olink si el texto habla de palmitoiletanolamida). "Memory and
  Aging Project" es ROSMAP salvo que sea el de la Washington University, que
  es el Knight ADRC; "Uniform Data Set" solo cuenta con sus mayúsculas.
- El nombre de una cohorte no dice nada de la muestra ni del instrumento: al
  buscar muestras y plataformas se saltan los tramos que ocupa un nombre de
  cohorte ("Neuroimaging Initiative" no es imagen).
- Una fuente sin cohorte identificada es "no pude comprobar", nunca "misma"
  ni "distinta": `misma_cohorte` devuelve None y los grupos la ignoran. Un
  nombre que solo dice "varias" tampoco identifica ninguna: "multiple
  population-based cohorts" o "múltiples ensayos de terapias dirigidas al
  amiloide" son el extractor diciendo que hubo varias (`_nombre_identificado`,
  19 de septiembre de 2026; antes contaban como una cohorte más en el techo
  GRADE y en el atlas). Un nombre libre cuyas palabras son todas genéricas
  ("The study") sigue contando como suyo: test_certeza_adversarial lo exige.
- Cuando un nombre resuelve al catálogo y el otro no, son la misma cohorte si
  el nombre libre contiene, palabra a palabra y sin contar genéricos, uno de
  los nombres de esa entrada: "Rotterdam" (lo que escribía el killer antiguo)
  y "Rotterdam Study" son una; "PSEN1 carriers" no es "PSEN1 E280A"; "Mayo"
  no es "Mayo Clinic Study of Aging". Un nombre libre nunca funde dos cohortes
  del catálogo. Cuando ninguno resuelve, la regla de tokens de certeza.py.
- Toda entrada rara se tolera: None, enteros, bytes, un campo `cohorte` que
  ya es un nodo ({"id", "etiqueta"}) o un identificador ("cohorte:adni"),
  listas donde se esperaba un texto, afirmaciones o fuentes que no son
  listas ni diccionarios. Nada rompe; lo que no se entiende es "no
  identificado".
- Las búsquedas sobre un mismo texto se recuerdan (`_tramos`, caché acotada
  a 2048 textos): el Killer y la escalera releen las mismas fuentes en cada
  iteración. Lo que sale de la caché son tuplas; cada llamada devuelve
  diccionarios nuevos que se pueden mutar sin tocar el catálogo.

16 de septiembre de 2026.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

# ---------------------------------------------------------------------------
# Catálogos
# ---------------------------------------------------------------------------

# Un alias es una cadena o un diccionario {"alias", "excepto", "no_tras",
# "salvo_si", "mayusculas"}:
#   excepto:    expresión regular que, si sigue al nombre, lo anula
#               ("Framingham risk score" es una escala, no la cohorte).
#   no_tras:    palabras que, si preceden al nombre, lo anulan
#               ("Table A4" y "Fig. A4" son una tabla y una figura).
#   salvo_si:   expresión regular que, si aparece en cualquier parte del
#               texto, anula el alias entero ("PEA" no es Olink en un texto
#               que habla de palmitoiletanolamida).
#   mayusculas: obliga a respetar mayúsculas aunque el alias lleve espacios
#               ("PREVENT Dementia" sí; "prevent dementia" es una frase).
# Un alias que termina en "*" es una raíz: "neuropatholog*" casa con
# "neuropathology" y "neuropathological". Y "non-" delante niega cualquier
# alias ("non-ADNI cohorts" no es ADNI).
_FIGURAS = ["Table", "Tab.", "Fig.", "Figure", "Appendix", "Section", "eTable", "eFigure", "Panel"]

_A = dict

_COHORTES_DEF: tuple[tuple[str, str, list[Any], dict[str, Any]], ...] = (
    ("adni", "ADNI", ["Alzheimer's Disease Neuroimaging Initiative", "ADNI-1", "ADNI-2", "ADNI-3", "ADNI-GO", "ADNI-DOD"], {}),
    ("j_adni", "J-ADNI", ["Japanese ADNI", "Japanese Alzheimer's Disease Neuroimaging Initiative"], {}),
    ("biofinder", "BioFINDER", ["Swedish BioFINDER", "BioFINDER-1", "BioFINDER-2", "Biomarkers For Identifying Neurodegenerative Disorders Early and Reliably"], {}),
    # "Table A4" es una tabla y "A4 paper" un tamaño de papel.
    ("a4", "A4", [_A(alias="A4", no_tras=_FIGURAS, excepto=r"\s+(?:paper|sheet|size|format)"), "Anti-Amyloid Treatment in Asymptomatic Alzheimer's", "A4 Study"], {"nct": ["NCT02008357"], "etiqueta_busca": False}),
    ("ahead", "AHEAD 3-45", [_A(alias="AHEAD Study", mayusculas=True), _A(alias="AHEAD 3-45 Study", mayusculas=True)], {"nct": ["NCT04468659"]}),
    ("aibl", "AIBL", ["Australian Imaging, Biomarkers and Lifestyle", "Australian Imaging, Biomarker and Lifestyle"], {}),
    # "Memory and Aging Project" a solas es el de Rush (ROSMAP); el de la
    # Washington University es la cohorte del Knight ADRC.
    ("rosmap", "ROSMAP", ["ROS/MAP", "ROS-MAP", "Religious Orders Study", "Rush Memory and Aging Project", _A(alias="Memory and Aging Project", excepto=r"(?:\s*\(MAP\))?\s+(?:at|of)\s+(?:the\s+)?(?:Knight|Washington|WashU)")], {}),
    ("msbb", "MSBB", ["Mount Sinai Brain Bank"], {}),
    ("mcsa", "MCSA", ["Mayo Clinic Study of Aging"], {}),
    ("nacc", "NACC", ["National Alzheimer's Coordinating Center", "NACC UDS", _A(alias="Uniform Data Set", mayusculas=True)], {}),
    ("uk_biobank", "UK Biobank", ["UKB", "United Kingdom Biobank"], {}),
    ("sea_ad", "SEA-AD", ["Seattle Alzheimer's Disease Brain Cell Atlas"], {}),
    ("wrap", "WRAP", ["Wisconsin Registry for Alzheimer's Prevention"], {}),
    ("wisconsin_adrc", "Wisconsin ADRC", ["Wisconsin Alzheimer's Disease Research Center"], {}),
    ("dian", "DIAN", ["Dominantly Inherited Alzheimer Network", "DIAN-OBS", "DIAN-TU", "DIAN Observational Study", "DIAN Trials Unit"], {"nct": ["NCT01760005"]}),
    ("knight_adrc", "Knight ADRC", ["Knight Alzheimer's Disease Research Center", "Washington University ADRC", "WashU ADRC", "Charles F. and Joanne Knight", "Washington University Memory and Aging Project", "Knight ADRC Memory and Aging Project"], {}),
    ("biocard", "BIOCARD", ["Biomarkers for Older Controls at Risk for Dementia"], {}),
    ("alfa", "ALFA", ["ALFA+", "ALzheimer and FAmilies", "ALFA study", "ALFA cohort"], {}),
    ("adc_amsterdam", "Amsterdam Dementia Cohort", ["Amsterdam ADC", "ADC Amsterdam"], {}),
    ("h70", "Gothenburg H70", ["H70", "Gothenburg H70 Birth Cohort", "H70 Birth Cohort Studies", "Gothenburg birth cohort"], {}),
    ("triad", "TRIAD", ["Translational Biomarkers in Aging and Dementia", "McGill TRIAD"], {}),
    # "Framingham, MA" es la dirección del centro, no la cohorte.
    ("framingham", "Framingham", [_A(alias="Framingham", excepto=r"\s+(?:risk|stroke|cardiovascular|general|coronary|score|10-year)|,\s*(?:MA|Massachusetts)(?![A-Za-z])"), "Framingham Heart Study", "FHS", "Framingham Offspring"], {"etiqueta_busca": False}),
    ("rotterdam", "Rotterdam Study", ["Rotterdam Scan Study", "Rotterdam Elderly Study", "Estudio de Rotterdam", "Estudio Rotterdam", "ERGO"], {}),
    ("prevent_ad", "PREVENT-AD", ["Pre-symptomatic Evaluation of Experimental or Novel Treatments for Alzheimer's Disease"], {}),
    ("prevent_dementia", "PREVENT Dementia", [_A(alias="PREVENT dementia", mayusculas=True), _A(alias="PREVENT Dementia programme", mayusculas=True), _A(alias="PREVENT Dementia study", mayusculas=True)], {"etiqueta_mayusculas": True}),
    ("habs", "HABS", [_A(alias="HABS", excepto=r"[-‐–\s]?HD(?![A-Za-z])"), "Harvard Aging Brain Study"], {"etiqueta_busca": False}),
    ("habs_hd", "HABS-HD", ["Health and Aging Brain Study", "Health & Aging Brain Study", "Health and Aging Brain Study-Health Disparities"], {}),
    ("oasis", "OASIS", ["Open Access Series of Imaging Studies", "OASIS-3", "OASIS-4"], {}),
    ("epad", "EPAD", ["European Prevention of Alzheimer's Dementia", "EPAD LCS"], {"nct": ["NCT02804789"]}),
    ("sydney_mas", "Sydney MAS", ["Sydney Memory and Ageing Study", "Sydney Memory", "Memory and Ageing Study"], {}),  # sin tildes
    ("three_city", "Three-City", ["Three City Study", "3C Study", "3-City", "Trois Cités", "Etude des Trois Cités"], {}),
    ("whitehall", "Whitehall II", ["Whitehall", "Whitehall 2", "Whitehall-II"], {}),
    ("amp_ad", "AMP-AD", ["Accelerating Medicines Partnership-Alzheimer's Disease", "AMP-AD Knowledge Portal"], {}),
    ("api_colombia", "API Colombia", ["Alzheimer's Prevention Initiative", "API ADAD", "PSEN1 E280A", "E280A", "Colombian kindred", "Paisa kindred", "Antioquia kindred"], {"nct": ["NCT01998841"]}),
    ("finger", "FINGER", [_A(alias="FINGER", excepto=r"[-‐–\s]?(?:prick|tapping|print|tip)"), "Finnish Geriatric Intervention Study to Prevent Cognitive Impairment and Disability", "FINGER trial"], {"etiqueta_busca": False, "nct": ["NCT01041989"]}),
    # Ensayos de fase 2 y 3 del campo (17 de septiembre de 2026, M-03): antes el
    # catálogo no los conocía y la regla de tokens fundía "TRAILBLAZER-ALZ" con
    # "TRAILBLAZER-ALZ 2" (dos ensayos distintos) y separaba "ALZ 2" de "ALZ2" (el
    # mismo). Cada ensayo es su propia cohorte; el NCT manda cuando viene. Los
    # nombres con espacio se buscan respetando mayúsculas para que "study 201" en
    # una frase corriente no cuente.
    ("trailblazer_alz", "TRAILBLAZER-ALZ", ["TRAILBLAZER-ALZ 1", "TRAILBLAZER-ALZ1"], {"nct": ["NCT03367403"], "etiqueta_mayusculas": True}),
    ("trailblazer_alz2", "TRAILBLAZER-ALZ 2", ["TRAILBLAZER-ALZ2", "TRAILBLAZER-ALZ-2"], {"nct": ["NCT04437511"], "etiqueta_mayusculas": True}),
    ("trailblazer_alz3", "TRAILBLAZER-ALZ 3", ["TRAILBLAZER-ALZ3", "TRAILBLAZER-ALZ-3"], {"nct": ["NCT05026866"], "etiqueta_mayusculas": True}),
    ("clarity_ad", "CLARITY AD", ["Clarity AD", "CLARITY-AD"], {"nct": ["NCT03887455"], "etiqueta_mayusculas": True}),
    ("study_201", "Study 201", [_A(alias="Study 201 core", mayusculas=True), "BAN2401-G000-201", _A(alias="lecanemab Study 201", mayusculas=True)], {"nct": ["NCT01767311"], "etiqueta_mayusculas": True}),
    ("emerge", "EMERGE", [_A(alias="EMERGE trial", mayusculas=True)], {"nct": ["NCT02484547"]}),
    ("engage", "ENGAGE", [_A(alias="ENGAGE trial", mayusculas=True)], {"nct": ["NCT02477800"]}),
    ("graduate_1", "GRADUATE I", [_A(alias="GRADUATE 1", mayusculas=True), _A(alias="GRADUATE-I", mayusculas=True)], {"nct": ["NCT03444870"], "etiqueta_mayusculas": True}),
    ("graduate_2", "GRADUATE II", [_A(alias="GRADUATE 2", mayusculas=True), _A(alias="GRADUATE-II", mayusculas=True)], {"nct": ["NCT03443973"], "etiqueta_mayusculas": True}),
    # evoke y evoke+ (semaglutida, NCT04777396 y NCT04777409) no entran: "evoke" es una
    # palabra inglesa corriente y su NCT ya resuelve solo como "ensayo:NCT...". Están en
    # AMBIGUOS con ese motivo, igual que FLENI (el centro de la médica usuaria, que
    # aparece en la afiliación de sus artículos y tiene varias cohortes).
    ("invoke_2", "INVOKE-2", ["INVOKE2"], {"nct": ["NCT04592874"]}),
    ("insight46", "Insight 46", ["Insight46", "MRC National Survey of Health and Development", "NSHD", "1946 British birth cohort"], {}),
    ("emif_ad", "EMIF-AD", ["European Medical Information Framework for Alzheimer's Disease", "EMIF-AD MBD"], {}),
    ("blsa", "BLSA", ["Baltimore Longitudinal Study of Aging"], {}),
    ("aric", "ARIC", ["Atherosclerosis Risk in Communities", "ARIC-NCS"], {}),
    ("lothian", "Lothian Birth Cohort", ["LBC1936", "LBC 1936", "LBC1921"], {}),
    ("memento", "MEMENTO", ["MEMENTO cohort"], {}),
    ("snac_k", "SNAC-K", ["Swedish National study on Aging and Care in Kungsholmen", "Kungsholmen Project"], {}),
    ("paquid", "PAQUID", [], {}),
    ("vantaa", "Vantaa 85+", ["Vantaa 85"], {}),
    ("betula", "Betula", ["Betula study", "Betula project", "Betula cohort"], {"etiqueta_busca": False}),
    ("abc_ds", "ABC-DS", ["Alzheimer Biomarker Consortium-Down Syndrome", "Alzheimer's Biomarkers Consortium-Down Syndrome"], {}),
    ("cable", "CABLE", ["Chinese Alzheimer's Biomarker and LifestylE"], {}),
)

# (clave, etiqueta, alias, extras). "familia" agrupa instrumentos del mismo
# principio de medida; la interfaz y el juez pueden usarla.
_PLATAFORMAS_DEF: tuple[tuple[str, str, list[Any], dict[str, Any]], ...] = (
    ("simoa", "Simoa", ["Quanterix", "HD-X", "HD-1", "SR-X", "single-molecule array", "ALZpath"], {"familia": "inmunoensayo digital"}),
    ("lumipulse", "Lumipulse", ["Fujirebio", "Lumipulse G"], {"familia": "inmunoensayo quimioluminiscente"}),
    ("elecsys", "Elecsys", ["Roche cobas", "cobas"], {"familia": "inmunoensayo electroquimioluminiscente"}),
    # "MSD (Merck Sharp & Dohme)" es un financiador, no el instrumento.
    ("msd", "MSD", [_A(alias="MSD", excepto=r"\s*\(?\s*Merck|,\s*(?:Kenilworth|Rahway)"), "Meso Scale Discovery", "Meso Scale", "MesoScale", "S-PLEX", "U-PLEX"], {"familia": "inmunoensayo electroquimioluminiscente", "etiqueta_busca": False}),
    ("elisa", "ELISA", ["Innotest", "Euroimmun", "enzyme-linked immunosorbent assay"], {"familia": "inmunoensayo"}),
    ("espectrometria", "Espectrometría de masas", ["mass spectrometry", "IP-MS", "IP/MS", "LC-MS", "LC-MS/MS", "PrecivityAD", "Precivity", "C2N", "immunoprecipitation-mass spectrometry", "MALDI-TOF"], {"familia": "espectrometría de masas"}),
    # "PEA" también es la palmitoiletanolamida, un lípido que se estudia en el
    # Alzheimer; si el texto la nombra, la sigla no es la plataforma.
    ("olink", "Olink", ["proximity extension assay", _A(alias="PEA", salvo_si=r"palmitoylethanolam|palmitoiletanolam"), "Olink Explore", "Olink Target"], {"familia": "proteómica por PEA"}),  # sin tildes
    # "Alamar Blue" (alamarBlue) es un ensayo de viabilidad celular, no NULISA.
    ("nulisa", "NULISA", [_A(alias="Alamar", excepto=r"\s*blue"), "NULISAseq", "Alamar Biosciences"], {"familia": "inmunoensayo NULISA"}),
    ("luminex", "Luminex", ["xMAP", "INNO-BIA", "AlzBio3", "Milliplex"], {"familia": "inmunoensayo multiplex"}),
    ("somascan", "SomaScan", ["SomaLogic", "aptamer", "aptámero"], {"familia": "proteómica por aptámeros"}),
    # "el PIB del país" es el producto interior bruto, no el trazador.
    ("pet_amiloide", "PET de amiloide", ["amyloid-PET", "Aβ-PET", "PET amiloide", _A(alias="PiB", excepto=r"\s+(?:del|de\s+la|per\s+c[aá]pita|nacional|mundial|real|nominal)"), "Pittsburgh compound-B", "[11C]PiB", "11C-PiB", "florbetapir", "Amyvid", "AV-45", "flutemetamol", "Vizamyl", "florbetaben", "Neuraceq", "NAV4694", "flutafuranol", "Centiloid"], {"familia": "imagen PET"}),
    ("pet_tau", "PET de tau", ["tau-PET", "flortaucipir", "AV-1451", "T807", "Tauvid", "MK-6240", "florquinitau", "PI-2620", "RO-948", "GTP1", "JNJ-067", "PBB3", "APN-1607", "THK-5351", "THK5317"], {"familia": "imagen PET"}),
    ("fdg_pet", "FDG-PET", ["[18F]FDG", "18F-FDG", "fluorodeoxyglucose", "fluorodesoxiglucosa"], {"familia": "imagen PET"}),
    ("rm", "RM", ["MRI", "magnetic resonance", "resonancia magnética", "T1-weighted", "FreeSurfer", "volumetric MRI", "diffusion tensor"], {"familia": "imagen RM", "etiqueta_busca": False}),
    ("rnaseq", "RNA-seq", ["RNA sequencing", "secuenciación de ARN", "snRNA-seq", "scRNA-seq", "single-nucleus RNA", "single-cell RNA", "bulk RNA", "transcriptom*"], {"familia": "transcriptómica"}),
    # Sin "genotyp*": el genotipo APOE es covariable en casi todo artículo y
    # convertiría el genotipado en plataforma común de cualquier conjunto.
    ("genotipado", "Genotipado", ["GWAS", "genome-wide association", "whole-genome sequencing", "whole-exome sequencing", "WGS", "WES", "polygenic risk"], {"familia": "genómica"}),
    ("ihq", "Inmunohistoquímica", ["inmunohistoquimic*", "immunohistochem*", "IHC"], {"familia": "histología"}),
    ("western", "Western blot", ["Western blot*", "immunoblot*"], {"familia": "histología"}),
)

_MUESTRAS_DEF: tuple[tuple[str, str, list[Any], dict[str, Any]], ...] = (
    ("plasma", "plasma", ["plasmatic*"], {}),
    ("suero", "suero", ["serum", "sera", "séric*"], {}),
    # "blood-brain barrier", "blood pressure" y "blood flow" no son una muestra de sangre.
    ("sangre", "sangre", [_A(alias="blood", excepto=r"[-‐–\s]?brain[-‐–\s]?barrier|\s+(?:pressure|flow|vessels?|supply|oxygen)"), "sanguín*", "dried blood spot"], {}),
    ("lcr", "LCR", ["CSF", "cerebrospinal fluid", "líquido cefalorraquídeo", "lumbar puncture", "punción lumbar"], {}),
    ("tejido", "tejido cerebral post mortem", ["post-mortem", "brain tissue", "autopsy", "autopsia", "necrops*", "neuropatholog*", "neuropatológ*", "brain bank", "tejido cerebral", "formalin-fixed", "frozen brain", "cortical tissue", "brain samples"], {}),
    ("saliva", "saliva", ["saliv*"], {}),
    ("orina", "orina", ["urine", "urinary", "urinari*"], {}),
    ("imagen", "imagen", ["PET", "MRI", "imaging", "neuroimaging", "neuroimagen", "resonancia", "tomografía", "SUVR", "Centiloid", "positron emission"], {"etiqueta_busca": False}),
    ("retina", "retina", ["retinal", "optical coherence tomography"], {}),
    ("modelo", "modelo animal o celular", ["mouse", "mice", "murine", "ratón", "ratones", "transgénic*", "5xFAD", "APP/PS1", "3xTg", "Tg2576", "APP23", "iPSC", "organoid*", "organoide*", "cell culture", "cultivo celular", "in vitro", "Drosophila", "zebrafish", "C. elegans"], {"etiqueta_busca": False}),
)

# Nombres que a solas no cuentan, con el motivo. La interfaz puede enseñarlos
# para que se entienda por qué una fuente quedó "sin cohorte identificada".
AMBIGUOS: dict[str, str] = {
    "Mayo": "es un mes en castellano y un centro con varias cohortes (MCSA, ADRC, banco de cerebros); solo cuenta 'Mayo Clinic Study of Aging' o 'MCSA'",
    "Mayo Clinic": "tiene varias cohortes (MCSA, ADRC, banco de cerebros de AMP-AD); solo cuenta 'Mayo Clinic Study of Aging' o 'MCSA'",
    "Gothenburg": "es la ciudad de Blennow y Zetterberg: aparece en la afiliación de casi todos los artículos de biomarcadores; solo cuenta 'H70' o 'Gothenburg H70'",
    "Rotterdam": "aparece en la afiliación del Erasmus MC; solo cuenta 'Rotterdam Study'",
    "ROS": "especies reactivas de oxígeno; solo cuenta 'ROSMAP', 'ROS/MAP' o 'Religious Orders Study'",
    "MAP": "proteína asociada a microtúbulos y otros usos; solo cuenta 'Memory and Aging Project'",
    "ADC": "coeficiente aparente de difusión en RM y los Alzheimer's Disease Centers del NACC; solo cuenta 'Amsterdam Dementia Cohort' o 'Amsterdam ADC'",
    "MAS": "'más' sin tilde y varias escalas clínicas; la sigla solo cuenta pegada a Sydney, o el nombre completo 'Sydney Memory and Ageing Study'",
    "3C": "panel de figura ('Fig. 3C'); solo cuenta 'Three-City' o '3C Study'",
    "API": "interfaz de programación; solo cuenta 'API Colombia' o 'Alzheimer's Prevention Initiative'",
    "PREVENT": "verbo; solo cuenta 'PREVENT-AD' o 'PREVENT Dementia' en mayúsculas",
    "LEARN": "verbo; el estudio LEARN comparte cribado con A4 y no se distingue por el nombre",
    "TMT": "Trail Making Test en neuropsicología, no tandem mass tag; no se toma como espectrometría",
    "RM": "'RM-ANOVA' y otros usos; solo cuentan 'resonancia magnética' y 'MRI'",
    "OCT": "abreviatura de octubre; solo cuenta 'optical coherence tomography'",
    "DTI": "también interacción fármaco-diana; solo cuenta 'diffusion tensor'",
    "PRS": "varias siglas; solo cuenta 'polygenic risk'",
    "evoke": "verbo inglés corriente ('these findings evoke'); los ensayos evoke (NCT04777396) y evoke+ (NCT04777409) de semaglutida se reconocen por su NCT, no por el nombre",
    "evoke+": "ensayo de semaglutida (NCT04777409); se reconoce por su NCT, porque 'evoke' a solas es un verbo y los dos ensayos comparten la palabra",
    "FLENI": "es el centro de Buenos Aires de la médica usuaria: aparece en la afiliación de sus artículos y tiene varias cohortes (esporádico, familiar, imagen); cuenta el nombre de la cohorte, no el del centro",
}

_NCT = re.compile(r"\bNCT\d{8}\b", re.I)
_GUIONES = "[-‐–\\s]?"
_VOCALES = (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"))


def _es_sigla(alias: str) -> bool:
    """Todo mayúsculas, sin espacios y con alguna letra: 'ADNI', 'HD-X', 'ROS/MAP'."""
    return " " not in alias and alias == alias.upper() and bool(re.search(r"[A-Z]", alias))


def _regex_alias(alias: str, excepto: str | None) -> str:
    raiz = alias.endswith("*")
    cuerpo_alias = alias[:-1] if raiz else alias
    partes: list[str] = []
    for token in cuerpo_alias.split():
        t = re.escape(token)
        t = t.replace("'s", "(?:['’]?s)?")  # "Alzheimer's" casa con "Alzheimer", "Alzheimers" y "Alzheimer’s"
        t = t.replace("\\-", _GUIONES)  # "BioFINDER-2" casa con "BioFINDER 2" y "BioFINDER2"
        t = t.replace(",", ",?")  # "Imaging, Biomarkers" casa con y sin coma
        t = re.sub(r"(?i)ag(?:e)?ing", "age?ing", t)  # Aging y Ageing
        for con, sin in _VOCALES:  # los PDF pierden tildes: "líquido" casa con "liquido"
            t = t.replace(con, f"[{sin}{con}]")
        partes.append(t)
    cuerpo = r"\s+".join(partes)
    if raiz:
        fin = ""
    elif cuerpo_alias[-1].isdigit():
        fin = r"(?![A-Za-z0-9])"
    else:
        fin = r"(?![A-Za-z])"
    exc = f"(?!(?i:{excepto}))" if excepto else ""
    return r"(?<![A-Za-z0-9])" + cuerpo + exc + fin


def _compilar(alias: str, excepto: str | None, mayusculas: bool) -> tuple[re.Pattern[str], re.Pattern[str]]:
    """(patrón estricto para texto libre, patrón laxo para campos que ya son un nombre)."""
    regex = _regex_alias(alias, excepto)
    estricto = re.compile(regex, 0 if (mayusculas or _es_sigla(alias)) else re.I)
    return estricto, re.compile(regex, re.I)


def _regex_no_tras(palabras: list[str] | None) -> re.Pattern[str] | None:
    """Patrón que casa con el final del texto que precede a un nombre cuando
    termina en una de esas palabras ("Table A4": 'Table' precede a 'A4')."""
    if not palabras:
        return None
    return re.compile("(?i)(?:" + "|".join(re.escape(p) for p in palabras) + r")\s*$")


def _clave_exacta(texto: str) -> str:
    t = (texto or "").lower().replace("‐", "-").replace("–", "-").replace("'", "").replace("’", "")
    t = re.sub(r"\s+", " ", t).strip(" .,;:()[]")
    return t


# (estricto, laxo, nombre del alias, no_tras, salvo_si)
_Patron = tuple[re.Pattern[str], re.Pattern[str], str, re.Pattern[str] | None, re.Pattern[str] | None]


def _construir(tipo: str, definiciones: tuple[tuple[str, str, list[Any], dict[str, Any]], ...]) -> tuple[list[dict[str, Any]], list[tuple[dict[str, Any], list[_Patron]]]]:
    catalogo: list[dict[str, Any]] = []
    patrones: list[tuple[dict[str, Any], list[_Patron]]] = []
    for clave, etiqueta, alias, extras in definiciones:
        entrada: dict[str, Any] = {"id": f"{tipo}:{clave}", "etiqueta": etiqueta, "alias": [], "tipo": tipo}
        for k in ("familia", "nct"):
            if k in extras:
                entrada[k] = extras[k]
        # Cada patrón: (estricto, laxo, nombre, no_tras compilado o None, salvo_si compilado o None).
        compilados: list[_Patron] = []
        if extras.get("etiqueta_busca", True):
            compilados.append((*_compilar(etiqueta, None, bool(extras.get("etiqueta_mayusculas"))), etiqueta, None, None))
        for a in alias:
            spec = a if isinstance(a, dict) else {"alias": a}
            nombre = str(spec["alias"])
            salvo_si = re.compile(spec["salvo_si"], re.I) if spec.get("salvo_si") else None
            compilados.append((*_compilar(nombre, spec.get("excepto"), bool(spec.get("mayusculas"))), nombre, _regex_no_tras(spec.get("no_tras")), salvo_si))
            if nombre.rstrip("*") != etiqueta and nombre.rstrip("*") not in entrada["alias"]:
                entrada["alias"].append(nombre.rstrip("*"))
        catalogo.append(entrada)
        patrones.append((entrada, compilados))
    return catalogo, patrones


COHORTES, _PATRONES_COHORTES = _construir("cohorte", _COHORTES_DEF)
PLATAFORMAS, _PATRONES_PLATAFORMAS = _construir("plataforma", _PLATAFORMAS_DEF)
MUESTRAS, _PATRONES_MUESTRAS = _construir("muestra", _MUESTRAS_DEF)
# Lista plana para la interfaz: cada entrada es serializable tal cual.
CATALOGO: list[dict[str, Any]] = [*COHORTES, *PLATAFORMAS, *MUESTRAS]

_PATRONES = {"cohorte": _PATRONES_COHORTES, "plataforma": _PATRONES_PLATAFORMAS, "muestra": _PATRONES_MUESTRAS}
_POR_ID: dict[str, dict[str, Any]] = {e["id"]: e for e in CATALOGO}
# Nombre exacto (normalizado) de cohorte -> entrada, para campos que ya son el nombre.
_EXACTAS_COHORTE: dict[str, dict[str, Any]] = {}
for _e in COHORTES:
    for _n in [_e["etiqueta"], *_e["alias"]]:
        _EXACTAS_COHORTE.setdefault(_clave_exacta(_n), _e)
# NCT conocidos -> cohorte (un artículo que cita el registro del ensayo A4 es de A4).
_NCT_CONOCIDOS: dict[str, dict[str, Any]] = {n: e for e in COHORTES for n in e.get("nct", [])}

# Réplica de la regla de tokens de certeza.py, para nombres que no están en el catálogo.
# "ensayo" y "trial" entraron el 17 de septiembre de 2026 (M-03): "Ensayo Omega" y
# "Ensayo Omega 2" compartían la palabra "ensayo" y se fundían aunque difieren en el
# sufijo numérico; la palabra que distingue es el nombre del ensayo, no "ensayo".
# "cohorts", "cohortes", "population-based" y los cuantificadores ("multiple",
# "several", "varios") entraron el 19 de septiembre de 2026: "multiple
# population-based cohorts" no nombra ninguna cohorte.
_GENERICOS_COHORTE = {"cohorte", "cohortes", "cohort", "cohorts", "study", "estudio", "longitudinal", "portadores", "familias", "alzheimer", "disease", "enfermedad", "mutaciones", "carriers", "participantes", "pacientes", "et", "al", "the", "of", "de", "del", "la", "los", "las", "con", "and", "familial", "autosomal", "dominant", "autosómico", "dominante", "ensayo", "ensayos", "trial", "trials", "population-based", "population", "based", "multiple", "múltiples", "multiples", "varios", "varias", "several", "various"}

# Un nombre que empieza por uno de estos solo dice "varias": no identifica cohorte.
_CUANTIFICADORES_VARIAS = {"multiple", "múltiples", "multiples", "varios", "varias", "several", "various", "numerous", "diversos", "diversas", "distintos", "distintas", "many", "muchos", "muchas", "other", "otros", "otras"}


def _nombre_identificado(nombre: str) -> str:
    """El nombre tal cual si identifica una cohorte, o "" si solo dice
    "varias": empieza por un cuantificador plural ("multiple population-based
    cohorts", "múltiples ensayos de terapias dirigidas al amiloide") y no
    resuelve al catálogo ni a un NCT. "Multiple sclerosis" es una enfermedad,
    no "varias", y no se descarta."""
    t = (nombre or "").strip()
    if not t or canonizar_cohorte(t):
        return t
    primera = re.split(r"[\s,;:(]+", t.lower(), 1)[0]
    if primera in _CUANTIFICADORES_VARIAS and not re.match(r"(?i)(?:multiple|múltiple)\s+(?:sclerosis|esclerosis)", t):
        return ""
    return t


def por_id(id_: str) -> dict[str, Any] | None:
    """La entrada del catálogo con ese identificador, o None."""
    return _POR_ID.get(id_ or "")


def _resumen(entrada: dict[str, Any]) -> dict[str, Any]:
    return {"id": entrada["id"], "etiqueta": entrada["etiqueta"], "tipo": entrada["tipo"]}


def _de_nct(nct: str) -> dict[str, Any]:
    n = nct.upper()
    conocida = _NCT_CONOCIDOS.get(n)
    if conocida:
        return {**_resumen(conocida), "texto": n, "motivo": f"{n} es el registro del ensayo de {conocida['etiqueta']}"}
    return {"id": f"ensayo:{n}", "etiqueta": n, "tipo": "ensayo", "texto": n, "motivo": "registro de ClinicalTrials.gov"}


def _texto(x: Any) -> str:
    """Lo que llegue, como texto: None es "", los bytes se decodifican y
    cualquier otra cosa se convierte. Un registro raro no rompe la búsqueda."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, (bytes, bytearray)):
        return bytes(x).decode("utf-8", errors="ignore")
    return str(x)


# "non-" delante de un nombre lo niega ("non-ADNI cohorts" no es ADNI).
_NEGACION = re.compile(r"(?i)non[-‐–\s]?$")
# Caracteres que se miran delante de un nombre para "non-" y para `no_tras`.
_ANTES = 24


@lru_cache(maxsize=2048)
def _tramos(t: str, tipo: str, laxo: bool) -> tuple[tuple[int, int, str, str], ...]:
    """Los tramos (inicio, fin, id, coincidencia) del texto que nombran una
    entrada de `tipo`, ya sin solapes: si dos nombres se solapan gana el más
    largo que empieza antes. Cacheado porque el Killer y la escalera releen
    las mismas fuentes en cada iteración; devuelve tuplas para que nadie
    pueda mutar lo cacheado."""
    hallazgos: list[tuple[int, int, int, str, str]] = []
    for orden, (entrada, compilados) in enumerate(_PATRONES[tipo]):
        for estricto, flexible, _alias, no_tras, salvo_si in compilados:
            if salvo_si is not None and salvo_si.search(t):
                continue
            for m in (flexible if laxo else estricto).finditer(t):
                if m.end() <= m.start():
                    continue
                antes = t[max(0, m.start() - _ANTES) : m.start()]
                if _NEGACION.search(antes) or (no_tras is not None and no_tras.search(antes)):
                    continue
                hallazgos.append((m.start(), m.end(), orden, entrada["id"], m.group(0)))
    hallazgos.sort(key=lambda x: (x[0], -(x[1] - x[0]), x[2]))
    ocupados: list[tuple[int, int]] = []
    if tipo != "cohorte":
        # El nombre de una cohorte no dice nada de la muestra ni del instrumento:
        # "Neuroimaging Initiative" no es imagen, "Australian Imaging" tampoco.
        ocupados.extend((ini, fin) for ini, fin, _id, _c in _tramos(t, "cohorte", False))
    salida: list[tuple[int, int, str, str]] = []
    for ini, fin, _orden, id_, coincidencia in hallazgos:
        if any(ini < f and fin > i for i, f in ocupados):
            continue
        ocupados.append((ini, fin))
        salida.append((ini, fin, id_, coincidencia))
    return tuple(salida)


def _buscar(texto: Any, tipo: str, laxo: bool = False) -> list[dict[str, Any]]:
    """Entradas del catálogo de `tipo` presentes en el texto, por orden de
    aparición y sin repetir identificador. `laxo` ignora mayúsculas también
    en las siglas. Cada llamada devuelve diccionarios nuevos."""
    t = _texto(texto)
    if not t.strip():
        return []
    vistos: set[str] = set()
    salida: list[dict[str, Any]] = []
    for ini, _fin, id_, coincidencia in _tramos(t, tipo, laxo):
        if id_ in vistos:
            continue
        vistos.add(id_)
        salida.append({**_resumen(_POR_ID[id_]), "texto": coincidencia, "posicion": ini, "motivo": f"el texto nombra '{coincidencia}'"})
    return salida


# ---------------------------------------------------------------------------
# Cohortes
# ---------------------------------------------------------------------------


def canonizar_cohorte(texto: str | None) -> dict[str, Any] | None:
    """Un nombre de cohorte (el campo `cohorte` de una fuente, o lo que dijo el
    extractor) a su nodo canónico: {"id", "etiqueta", "tipo", "texto", "motivo"}.
    Un NCT da {"id": "ensayo:NCT...", "etiqueta": "NCT..."} salvo que sea el
    registro de una cohorte conocida. None si no resuelve. Como el texto ya
    es un nombre, aquí las mayúsculas no importan ("adni" es ADNI)."""
    t = re.sub(r"\s+", " ", _nombre_de(texto) if not isinstance(texto, str) else texto).strip()
    if not t:
        return None
    m = _NCT.search(t)
    if m:
        return _de_nct(m.group(0))
    nodo = _POR_ID.get(t)
    if nodo and nodo["tipo"] == "cohorte":
        return {**_resumen(nodo), "texto": t, "motivo": f"'{t}' es el identificador de {nodo['etiqueta']}"}
    exacta = _EXACTAS_COHORTE.get(_clave_exacta(t))
    if exacta:
        return {**_resumen(exacta), "texto": t, "motivo": f"'{t}' es el nombre o un alias de {exacta['etiqueta']}"}
    hallados = _buscar(t, "cohorte", laxo=True)
    if hallados:
        h = hallados[0]
        return {**_resumen(h), "texto": t, "motivo": f"'{t}' contiene '{h['texto']}'"}
    return None


_PALABRAS_SUELTAS_AL_CORTAR = {"de", "del", "y", "e", "o", "u", "en", "la", "el", "los", "las", "con", "para", "por", "a", "and", "of", "the", "in", "with", "for", "or"}


def recortar_nombre_cohorte(texto: Any, maximo: int = 60) -> str:
    """El nombre de cohorte que escribe el extractor, recortado a `maximo`
    caracteres sin romper ni perder ningún registro NCT ni ningún nombre del
    catálogo (M-03, 17 de septiembre de 2026): antes el corte a 60 dejaba
    "TRAILBLAZER-ALZ (NCT03367403) y TRAILBLAZER-ALZ 2 (NCT044375", con el
    segundo NCT roto y el nombre libre fundido con otro ensayo. Si el texto
    cabe, se devuelve tal cual (con espacios normalizados). Si no, se corta
    en el último espacio hasta `maximo` (o en `maximo` si no hay espacio en
    la segunda mitad), nunca por dentro de un identificador, se quitan
    las palabras sueltas que quedan colgando al final ("de", "y", "en") y
    los identificadores que el corte dejaría fuera (los NCT y los tramos que
    nombran una cohorte del catálogo, como el "(ADNI, A4)" al final de una
    descripción larga del estado de muestra) se añaden en un paréntesis
    final, en el orden en que aparecían y sin repetir. El resultado puede
    pasar de `maximo` solo por ese paréntesis, porque es la parte del nombre
    que identifica la cohorte (`canonizar_cohorte` lee primero el NCT y
    después el catálogo). Lo que no es texto vale como vacío."""
    t = re.sub(r"\s+", " ", _texto(texto)).strip()
    if maximo <= 0 or not t:
        return ""
    if len(t) <= maximo:
        return t
    # (inicio, fin, texto) de cada identificador: el NCT en mayúsculas y el tramo
    # del texto que nombra una cohorte del catálogo (laxo: el campo ya es un nombre).
    hallados: list[tuple[int, int, str]] = [(m.start(), m.end(), m.group(0).upper()) for m in _NCT.finditer(t)]
    ocupados = [(ini, fin) for ini, fin, _x in hallados]
    for ini, fin, _id, coincidencia in _tramos(t, "cohorte", True):
        if not any(ini < f and fin > i for i, f in ocupados):
            hallados.append((ini, fin, coincidencia))
            ocupados.append((ini, fin))
    hallados.sort()
    k = maximo
    if " " in t[maximo // 2 : maximo + 1]:
        k = t.rfind(" ", 0, maximo + 1)  # una palabra que termina justo en `maximo` cabe entera
    # Nunca cortar por dentro de un identificador: el corte retrocede a su inicio.
    for ini, fin, _x in hallados:
        if ini < k < fin:
            k = min(k, ini)
    perdidos: list[str] = []
    for _ini, fin, x in hallados:
        if fin > k and x.upper() not in {y.upper() for y in perdidos}:
            perdidos.append(x)
    corte = t[:k].strip(" ,;:(-")
    palabras = corte.split(" ")
    while palabras and palabras[-1].lower() in _PALABRAS_SUELTAS_AL_CORTAR:
        palabras.pop()
    corte = " ".join(palabras).strip(" ,;:(-")
    if not perdidos:
        return corte
    return f"{corte} ({', '.join(perdidos)})" if corte else ", ".join(perdidos)


def cohortes_en_texto(texto: str | None) -> list[dict[str, Any]]:
    """Todas las cohortes y registros NCT nombrados en un texto libre, por
    orden de aparición. Siglas solo en mayúsculas; ver la cabecera."""
    t = _texto(texto)
    salida = _buscar(t, "cohorte")
    vistos = {x["id"] for x in salida}
    for m in _NCT.finditer(t):
        d = _de_nct(m.group(0))
        if d["id"] in vistos:
            continue
        vistos.add(d["id"])
        salida.append({**d, "posicion": m.start()})
    salida.sort(key=lambda x: x["posicion"])
    return salida


def cohorte_en_texto(texto: str | None) -> str:
    """La etiqueta canónica de la cohorte de un texto libre, o "". Un NCT manda
    sobre un nombre (es el identificador más preciso); si no, la primera
    cohorte nombrada. "BioFINDER-2" da "BioFINDER" y "ADNI-3" da "ADNI"."""
    t = _texto(texto)
    m = _NCT.search(t)
    if m:
        return _de_nct(m.group(0))["etiqueta"]
    hallados = _buscar(t, "cohorte")
    return hallados[0]["etiqueta"] if hallados else ""


def _tokens_cohorte(nombre: str) -> set[str]:
    """Palabras que distinguen un nombre libre de cohorte, sin genéricas ni
    paréntesis. Un número suelto que sigue a una palabra se le pega
    ("TRAILBLAZER-ALZ 2" y "TRAILBLAZER-ALZ2" dan las dos 'trailblazer-alz2'),
    de modo que dos nombres que solo difieren en el sufijo numérico NO
    comparten token: "TRAILBLAZER-ALZ" y "TRAILBLAZER-ALZ 2" son ensayos
    distintos (M-03, 17 de septiembre de 2026). Antes el '2' suelto se
    perdía (menos de tres caracteres) y producía el efecto contrario."""
    limpio = re.sub(r"\(.*?\)", " ", (nombre or "").lower())

    def pegar(m: re.Match[str]) -> str:
        palabra, numero = m.group(1), m.group(2)
        # "and 3" o "phase 2" no son un nombre con sufijo: la genérica se queda suelta.
        return m.group(0) if palabra in _GENERICOS_COHORTE or palabra in _GENERICOS_MIXTA else palabra + numero

    limpio = re.sub(r"([a-záéíóúñ][a-záéíóúñ0-9\-]*[a-záéíóúñ])[\s\-]+(\d{1,2})(?![a-záéíóúñ0-9])", pegar, limpio)
    return {t for t in re.findall(r"[a-záéíóúñ0-9][a-záéíóúñ0-9\-]{2,}", limpio) if t not in _GENERICOS_COHORTE}


# Palabras que, además de las genéricas de certeza.py, no distinguen una
# cohorte cuando se compara un nombre libre con los nombres del catálogo:
# "Memory" solo no es ROSMAP, "ADAD" solo no es API Colombia.
_GENERICOS_MIXTA = _GENERICOS_COHORTE | {"memory", "aging", "ageing", "brain", "center", "centre", "centers", "research", "project", "initiative", "registry", "network", "consortium", "biobank", "university", "birth", "adad", "fad", "eoad", "load", "sporadic", "trial", "trials", "ensayo", "prevention", "prevención", "prevencion", "prevent", "data", "datos", "dementia", "demencia", "bank", "banco", "kindred", "unit", "programme", "program", "neuroimaging", "imaging", "health", "european", "national", "biomarker", "biomarkers", "treatment", "treatments", "observational", "older", "controls", "risk", "cognitive", "impairment", "clinical", "series", "studies", "open", "access", "for", "with", "des", "etude", "translational", "families", "family", "japanese", "chinese", "swedish", "australian", "finnish", "british", "knowledge", "portal", "medical", "information", "framework", "evaluation", "experimental", "novel", "intervention", "disability", "geriatric", "survey", "development", "syndrome", "lifestyle", "care", "elderly", "offspring", "heart", "scan", "atlas", "cell", "mayo", "clinic"}


def _tokens_de_entrada(entrada: dict[str, Any], repetidos: set[str]) -> list[set[str]]:
    """Los tokens de cada nombre (etiqueta y alias) de una entrada del catálogo,
    sin genéricos y sin los que aparecen en más de una entrada ('wisconsin'
    está en WRAP y en el Wisconsin ADRC, 'adrc' en Knight y en Wisconsin);
    los nombres que se quedan sin ningún token quedan fuera ("Memory and
    Aging Project" no deja ninguno)."""
    conjuntos = [_tokens_cohorte(n) - _GENERICOS_MIXTA - repetidos for n in (entrada["etiqueta"], *entrada["alias"])]
    return [c for c in conjuntos if c]


def _tokens_repetidos() -> set[str]:
    visto: dict[str, str] = {}
    repetidos: set[str] = set()
    for e in COHORTES:
        for n in (e["etiqueta"], *e["alias"]):
            for t in _tokens_cohorte(n) - _GENERICOS_MIXTA:
                if visto.setdefault(t, e["id"]) != e["id"]:
                    repetidos.add(t)
    return repetidos


_REPETIDOS = _tokens_repetidos()
_TOKENS_ENTRADA: dict[str, list[set[str]]] = {e["id"]: _tokens_de_entrada(e, _REPETIDOS) for e in COHORTES}


def _parte_del_nombre(libre: str, entrada: dict[str, Any] | None) -> str | None:
    """Motivo si un nombre fuera del catálogo contiene entero, palabra a
    palabra y sin contar genéricos, uno de los nombres de la entrada:
    'Rotterdam' y 'Rotterdam Study' son una (el killer antiguo escribía
    'Rotterdam'); 'PSEN1 carriers' no es 'PSEN1 E280A' porque le falta la
    mutación; 'Mayo' no es 'Mayo Clinic Study of Aging' porque le falta
    'Clinic'. None si no encaja. Es la regla de tokens de certeza.py aplicada
    entre un nombre libre y el catálogo, en la dirección conservadora."""
    if not entrada:
        return None
    toks = _tokens_cohorte(libre) - _GENERICOS_MIXTA
    if not toks:
        return None
    for nombre_tokens in _TOKENS_ENTRADA.get(entrada["id"], []):
        if nombre_tokens <= toks:
            return f"'{libre}' contiene el nombre de {entrada['etiqueta']} palabra a palabra ('{sorted(nombre_tokens)[0]}')"
    return None


def _nombre_de(valor: Any) -> str:
    """Un valor del campo `cohorte` como texto. Una cadena, tal cual; un nodo
    ({"id", "etiqueta"}), por su etiqueta o su identificador; una lista, sus
    elementos seguidos; None, un número o un booleano, "" (no identificado)."""
    if isinstance(valor, (str, bytes, bytearray)):
        return _texto(valor).strip()
    if isinstance(valor, dict):
        return _nombre_de(valor.get("etiqueta") or valor.get("id") or valor.get("nombre") or valor.get("texto"))
    if isinstance(valor, (list, tuple, set, frozenset)):
        return " ".join(x for x in (_nombre_de(v) for v in valor) if x).strip()
    return ""  # None, números, booleanos u objetos: no es un nombre


def _nombre(x: Any) -> str:
    """El nombre de cohorte de una fuente (campo `cohorte`, o su `nct` si no lo
    hay), de un nodo ({"id", "etiqueta"}) o de una cadena. Nunca falla con
    registros antiguos sin las claves: devuelve ""."""
    if isinstance(x, dict):
        if "cohorte" in x or "nct" in x:
            return _nombre_identificado(_nombre_de(x.get("cohorte"))) or _nombre_de(x.get("nct"))
        if x.get("etiqueta") and isinstance(x.get("id"), str) and ":" in x["id"]:
            return _nombre_de(x)
        return ""
    return _nombre_identificado(_nombre_de(x))


def misma_cohorte_motivo(a: Any, b: Any) -> tuple[bool | None, str]:
    """(veredicto, motivo). None si a alguna le falta la cohorte: no se puede
    afirmar ni que sea la misma ni que sea distinta. True si las dos resuelven
    al mismo identificador canónico. Si solo una resuelve, True cuando el
    nombre libre contiene el nombre de esa cohorte palabra a palabra
    (`_parte_del_nombre`). Si ninguna resuelve, la regla de tokens de
    certeza.py: misma si comparten alguna palabra que no sea genérica."""
    na, nb = _nombre(a), _nombre(b)
    if not na or not nb:
        return None, "a una de las dos fuentes le falta la cohorte: no se puede comprobar"
    if na.lower() == nb.lower():
        return True, f"el mismo nombre ('{na}')"
    ca, cb = canonizar_cohorte(na), canonizar_cohorte(nb)
    if ca and cb:
        if ca["id"] == cb["id"]:
            return True, f"las dos resuelven a {ca['etiqueta']} ('{na}' y '{nb}')"
        return False, f"resuelven a cohortes distintas: {ca['etiqueta']} y {cb['etiqueta']}"
    if ca or cb:
        conocida, libre = (ca, nb) if ca else (cb, na)
        motivo = _parte_del_nombre(libre, por_id(conocida["id"]))
        if motivo:
            return True, motivo
        return False, f"solo una resuelve a una cohorte conocida ({conocida['etiqueta']}); '{libre}' es un nombre libre sin relación con ella"
    ta = _tokens_cohorte(na) or {na.lower()}
    tb = _tokens_cohorte(nb) or {nb.lower()}
    comunes = sorted(ta & tb)
    if comunes:
        return True, f"ninguna está en el catálogo pero comparten la palabra '{comunes[0]}' fuera de las genéricas"
    return False, f"ninguna está en el catálogo y no comparten ninguna palabra: '{na}' y '{nb}'"


def misma_cohorte(a: Any, b: Any) -> bool | None:
    """Ver `misma_cohorte_motivo`; esta devuelve solo el veredicto."""
    return misma_cohorte_motivo(a, b)[0]


def _lista(x: Any) -> list[Any]:
    """Lo que llegue, como lista: None, un texto, un número o cualquier cosa
    que no sea una secuencia dan []; un diccionario suelto se envuelve."""
    if isinstance(x, (list, tuple, set, frozenset)):
        return list(x)
    if isinstance(x, dict):
        return [x]
    return []


def _fuentes_de(x: Any) -> list[dict[str, Any]]:
    """Acepta una lista de fuentes, una hipótesis ({"procedencia": {"fuentes"}})
    o un diccionario con "fuentes". Cualquier otra cosa (None, un texto, un
    número) es "sin fuentes". Una fuente repetida (mismo id) cuenta una vez:
    se queda la primera."""
    if isinstance(x, dict):
        if isinstance(x.get("procedencia"), dict):
            crudas = _lista(x["procedencia"].get("fuentes"))
        else:
            crudas = _lista(x.get("fuentes"))
    else:
        crudas = _lista(x)
    vistos: set[str] = set()
    fuentes: list[dict[str, Any]] = []
    for f in crudas:
        if not isinstance(f, dict):
            continue
        id_ = f.get("id")
        if id_ is not None:
            if str(id_) in vistos:
                continue
            vistos.add(str(id_))
        fuentes.append(f)
    return fuentes


def _id_fuente(f: dict[str, Any], i: int) -> str:
    return str(f.get("id") or f"fuente-{i + 1}")


def _agrupar_nombres(items: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """Agrupa (id de fuente, nombre de cohorte) con las reglas de
    `misma_cohorte_motivo`, por union-find sobre los nombres distintos (cada
    nombre se resuelve y se compara una sola vez, no una por fuente):

    1. los nombres que resuelven al catálogo se unen por su identificador;
    2. un nombre libre se une al primer grupo del catálogo cuyo nombre
       contiene palabra a palabra (`_parte_del_nombre`), y solo a uno: un
       nombre libre nunca funde dos cohortes del catálogo;
    3. los nombres libres se unen entre sí por la regla de tokens de
       certeza.py, sin fundir tampoco dos grupos del catálogo distintos.

    Los grupos salen en el orden en que aparece su primera fuente. Cada grupo:
    {"ids", "id" (canónico o None), "etiqueta", "nombres", "motivos"}."""
    nombres: list[str] = []
    indice: dict[str, int] = {}
    for _id_f, nombre in items:
        if nombre not in indice:
            indice[nombre] = len(nombres)
            nombres.append(nombre)
    canon = [canonizar_cohorte(n) for n in nombres]
    padre = list(range(len(nombres)))
    # raíz -> id canónico del grupo, para no fundir dos cohortes del catálogo.
    canon_de_raiz: dict[int, str] = {}
    motivos: dict[int, list[str]] = {}

    def raiz(i: int) -> int:
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    def unir(i: int, j: int, motivo: str) -> None:
        ri, rj = raiz(i), raiz(j)
        if ri == rj:
            return
        ci, cj = canon_de_raiz.get(ri), canon_de_raiz.get(rj)
        if ci and cj and ci != cj:
            return  # dos cohortes del catálogo distintas: no se funden por un nombre libre
        nueva, vieja = min(ri, rj), max(ri, rj)  # el representante es el que apareció antes
        padre[vieja] = nueva
        if ci or cj:
            canon_de_raiz[nueva] = ci or cj  # type: ignore[assignment]
        canon_de_raiz.pop(vieja, None)
        motivos.setdefault(nueva, []).extend(motivos.pop(vieja, []))
        motivos[nueva].append(motivo)

    # 1. Mismo identificador canónico.
    primero_por_id: dict[str, int] = {}
    for i, c in enumerate(canon):
        if not c:
            continue
        j = primero_por_id.setdefault(c["id"], i)
        canon_de_raiz[raiz(i)] = c["id"]
        if j != i:
            unir(j, i, f"'{nombres[i]}' y '{nombres[j]}' resuelven a {c['etiqueta']}" if nombres[i].lower() != nombres[j].lower() else f"el mismo nombre ('{nombres[j]}')")

    libres = [i for i, c in enumerate(canon) if not c]
    # 2. Nombre libre que contiene el nombre de una cohorte del catálogo presente.
    for i in libres:
        for id_c, j in primero_por_id.items():
            motivo = _parte_del_nombre(nombres[i], por_id(id_c))
            if motivo:
                unir(j, i, motivo)
                break
    # 2b. Alias aprendido dentro del registro (M-03): "X (NCT01234567)" enseña que X
    # es ese ensayo, así que otro registro que solo dice "X" se une al grupo del
    # NCT, aunque el ensayo no esté en el catálogo. Solo si los tokens del nombre
    # libre están todos en el texto que acompaña al NCT (dirección conservadora).
    ensayos_por_texto = [(j, _tokens_cohorte(_NCT.sub(" ", nombres[j])) - _GENERICOS_MIXTA) for j, c in enumerate(canon) if c and c["id"].startswith("ensayo:")]
    for i in libres:
        if raiz(i) != i and canon_de_raiz.get(raiz(i)):
            continue  # ya está en un grupo del catálogo
        toks_i = _tokens_cohorte(nombres[i]) - _GENERICOS_MIXTA
        if not toks_i:
            continue
        for j, toks_j in ensayos_por_texto:
            if toks_j and toks_i <= toks_j:
                unir(j, i, f"'{nombres[i]}' es el nombre que acompaña al registro {canon[j]['etiqueta']} en '{nombres[j]}'")
                break
    # 3. Libres entre sí por tokens (los tokens se calculan una vez por nombre).
    tokens = {i: (_tokens_cohorte(nombres[i]) or {nombres[i].lower()}) for i in libres}
    for a, i in enumerate(libres):
        for j in libres[a + 1 :]:
            if raiz(i) == raiz(j):
                continue
            if nombres[i].lower() == nombres[j].lower():
                unir(i, j, f"el mismo nombre ('{nombres[i]}')")
                continue
            comunes = sorted(tokens[i] & tokens[j])
            if comunes:
                unir(i, j, f"ninguna está en el catálogo pero comparten la palabra '{comunes[0]}' fuera de las genéricas")

    etiqueta_de_id = {c["id"]: c["etiqueta"] for c in canon if c}  # también los ensayo:NCT, que no están en el catálogo
    grupos: dict[int, dict[str, Any]] = {}
    orden: list[int] = []
    for id_f, nombre in items:
        r = raiz(indice[nombre])
        g = grupos.get(r)
        if g is None:
            id_c = canon_de_raiz.get(r)
            g = grupos[r] = {"ids": [], "id": id_c, "etiqueta": etiqueta_de_id.get(id_c or "", nombre), "nombres": [], "motivos": list(dict.fromkeys(motivos.get(r, [])))}
            orden.append(r)
        if id_f not in g["ids"]:
            g["ids"].append(id_f)
        if nombre not in g["nombres"]:
            g["nombres"].append(nombre)
    for g in grupos.values():
        if len(g["ids"]) > 1 and not g["motivos"]:
            g["motivos"].append(f"el mismo nombre ('{g['nombres'][0]}')")
    return [grupos[r] for r in orden]


def agrupar_cohortes(fuentes: Any) -> list[dict[str, Any]]:
    """Grupos de fuentes que son la misma cohorte, por el campo `cohorte` (o el
    `nct`) de cada una. Las fuentes sin cohorte no entran en ningún grupo:
    no se puede afirmar que sean independientes ni que no lo sean."""
    fs = _fuentes_de(fuentes)
    items = [(_id_fuente(f, i), _nombre(f)) for i, f in enumerate(fs) if _nombre(f)]
    return _agrupar_nombres(items)


def grupos_de_cohorte(fuentes: Any) -> list[list[str]]:
    """Los ids de fuente agrupados por misma cohorte (ver `agrupar_cohortes`)."""
    return [g["ids"] for g in agrupar_cohortes(fuentes)]


def cohortes_distintas(fuentes: Any) -> list[str]:
    """Una etiqueta por grupo: la canónica si el nombre está en el catálogo, o
    el primer nombre tal como lo dio la fuente. Sustituye a
    `priorizacion.cohortes_de` y `certeza.cohortes_distintas`."""
    return [g["etiqueta"] for g in agrupar_cohortes(fuentes)]


def fuentes_sin_cohorte(fuentes: Any) -> int:
    return sum(1 for f in _fuentes_de(fuentes) if not _nombre(f))


# ---------------------------------------------------------------------------
# Plataformas y muestras
# ---------------------------------------------------------------------------


def plataformas_en_texto(texto: str | None) -> list[dict[str, Any]]:
    """Todas las plataformas de medida nombradas, por orden de aparición."""
    return _buscar(texto or "", "plataforma")


def plataforma_en_texto(texto: str | None) -> dict[str, Any] | None:
    """La primera plataforma nombrada en el texto, o None."""
    h = plataformas_en_texto(texto)
    return h[0] if h else None


def muestras_en_texto(texto: str | None) -> list[dict[str, Any]]:
    """Las muestras (matrices) mencionadas en el texto, por orden de aparición.
    Son las mencionadas, no las medidas: un artículo de plasma que compara con
    LCR nombra las dos."""
    return _buscar(texto or "", "muestra")


def _texto_afirmaciones(afirmaciones: Any) -> tuple[list[str], str]:
    """(cohortes que dijo el extractor, texto de las afirmaciones). Acepta
    cualquier cosa: lo que no sea una lista de diccionarios se ignora."""
    campos: list[str] = []
    trozos: list[str] = []
    for a in _lista(afirmaciones):
        if not isinstance(a, dict):
            continue
        nombre = _nombre_identificado(_nombre_de(a.get("cohorte")))
        if nombre:
            campos.append(nombre)
        trozos.extend(_texto(a.get(k)) for k in ("texto", "fragmento"))
    return campos, " ".join(x for x in trozos if x)


def metodo_de_fuente(fuente: dict[str, Any] | None, afirmaciones: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Cohorte, plataforma y muestras de una fuente. La cohorte se busca por
    orden en el campo `cohorte`, el `nct`, el título, el fragmento (o los
    `fragmentos` de la copia privada) y las afirmaciones; `origen` dice dónde
    se encontró. Un nombre libre en el campo que no resuelve al catálogo se
    conserva con id None. Las plataformas y muestras se buscan en todos los
    textos; `plataforma` es la primera y `plataformas` todas (los estudios
    cabeza a cabeza usan varias). Registros antiguos sin claves: todo None."""
    f = fuente if isinstance(fuente, dict) else {}
    campo = _nombre_identificado(_nombre_de(f.get("cohorte")))
    nct = _nombre_de(f.get("nct"))
    titulo = _texto(f.get("titulo"))
    fragmento = " ".join(x for x in (_texto(f.get("fragmento")), *(_texto(fr.get("texto")) for fr in _lista(f.get("fragmentos")) if isinstance(fr, dict))) if x)
    campos_afs, texto_afs = _texto_afirmaciones(afirmaciones)

    # Un solo texto con el título primero, el fragmento después y las
    # afirmaciones al final: la posición del primer hallazgo dice de dónde
    # salió y respeta el orden de preferencia, y las tres búsquedas (cohorte,
    # plataforma, muestra) recorren el texto una vez cada una.
    trozos: list[str] = []
    limites: list[tuple[int, str]] = []
    for nombre_origen, texto in (("titulo", titulo), ("fragmento", fragmento), ("afirmaciones", texto_afs)):
        if texto:
            limites.append((sum(len(x) + 1 for x in trozos), nombre_origen))
            trozos.append(texto)
    todo = " ".join(trozos)

    def origen_en(posicion: int) -> str:
        return next((o for ini, o in reversed(limites) if posicion >= ini), "fragmento")

    def de_campos_afs() -> dict[str, Any] | None:
        # Lo que dijo el extractor en el campo cohorte de cada afirmación manda sobre su texto.
        return next((c for c in (canonizar_cohorte(x) for x in campos_afs) if c), None)

    cohorte: dict[str, Any] | None = None
    origen: str | None = None
    if campo:
        cohorte = canonizar_cohorte(campo)
        origen = "campo" if cohorte else None
    m_nct = _NCT.search(nct) if (cohorte is None and nct) else None
    if m_nct:
        cohorte, origen = _de_nct(m_nct.group(0)), "campo"
    if cohorte is None and todo:
        hallados = cohortes_en_texto(todo)
        if hallados:
            origen = origen_en(hallados[0]["posicion"])
            cohorte = (de_campos_afs() if origen == "afirmaciones" else None) or {k: v for k, v in hallados[0].items() if k != "posicion"}
    if cohorte is None and campos_afs:
        cohorte = de_campos_afs()
        origen = "afirmaciones" if cohorte else None
    if cohorte is None and campo:
        cohorte = {"id": None, "etiqueta": campo, "tipo": "cohorte", "texto": campo, "motivo": "nombre libre: no resuelve a una cohorte del catálogo"}
        origen = "campo"

    # El título va primero: la primera plataforma y la primera muestra que
    # nombra son las principales ("Plasma p-tau217 by Simoa...").
    plataformas = plataformas_en_texto(todo)
    muestras = muestras_en_texto(todo)
    return {
        "cohorte": {k: v for k, v in cohorte.items() if k != "posicion"} if cohorte else None,
        "plataforma": plataformas[0] if plataformas else None,
        "plataformas": plataformas,
        "muestra": muestras[0] if muestras else None,
        "muestras": muestras,
        "origen": origen,
    }


# ---------------------------------------------------------------------------
# Resumen para el juez, la escalera y la interfaz
# ---------------------------------------------------------------------------


def _afirmaciones_por_fuente(x: Any) -> dict[str, list[dict[str, Any]]]:
    """Acepta {id de fuente: [afirmaciones]} o una lista plana con `fuenteId`.
    Cualquier otra cosa es "sin afirmaciones"."""
    if isinstance(x, dict):
        return {str(k): [a for a in _lista(v) if isinstance(a, dict)] for k, v in x.items()}
    por: dict[str, list[dict[str, Any]]] = {}
    for a in _lista(x):
        if isinstance(a, dict) and a.get("fuenteId"):
            por.setdefault(str(a["fuenteId"]), []).append(a)
    return por


def resumen_metodos(fuentes: Any, afirmaciones_por_fuente: Any = None) -> dict[str, Any]:
    """Qué cohortes, plataformas y muestras hay detrás de un conjunto de fuentes
    y si comparten instrumento o matriz. `compartenPlataforma` es True cuando
    hay al menos dos fuentes con plataforma identificada y una misma
    plataforma aparece en todas ellas: entonces la concordancia entre estudios
    no es independiente del instrumento. `compartenMuestra` mira la muestra
    principal de cada fuente (la primera que nombra, empezando por el título),
    porque una mención de fondo ("comparado con PET de amiloide") no es la
    matriz medida. Las fuentes sin plataforma o sin muestra identificada se
    cuentan aparte: no se sabe, no "no usan"."""
    fs = _fuentes_de(fuentes)
    afs_por = _afirmaciones_por_fuente(afirmaciones_por_fuente)
    metodos = [(_id_fuente(f, i), metodo_de_fuente(f, afs_por.get(_id_fuente(f, i)))) for i, f in enumerate(fs)]

    items = [(id_f, m["cohorte"]["etiqueta"]) for id_f, m in metodos if m["cohorte"] and m["cohorte"].get("etiqueta")]
    cohortes = [{"id": g["id"], "etiqueta": g["etiqueta"], "fuentes": g["ids"]} for g in _agrupar_nombres(items)]

    def acumular(clave: str) -> tuple[list[dict[str, Any]], list[str]]:
        por: dict[str, dict[str, Any]] = {}
        con: list[str] = []
        for id_f, m in metodos:
            encontrados = m[clave]
            if encontrados:
                con.append(id_f)
            for x in encontrados:
                d = por.setdefault(x["id"], {"id": x["id"], "etiqueta": x["etiqueta"], "fuentes": []})
                if id_f not in d["fuentes"]:
                    d["fuentes"].append(id_f)
        return list(por.values()), con

    plataformas, con_plataforma = acumular("plataformas")
    muestras, con_muestra = acumular("muestras")
    comparten_plataforma = len(con_plataforma) >= 2 and any(len(p["fuentes"]) == len(con_plataforma) for p in plataformas)
    principales = {m["muestra"]["id"] for _id, m in metodos if m["muestra"]}
    comparten_muestra = len(con_muestra) >= 2 and len(principales) == 1
    muestra_comun = next((m for m in muestras if m["id"] in principales), None) if comparten_muestra else None
    return {
        "cohortes": cohortes,
        "plataformas": plataformas,
        "muestras": muestras,
        "compartenPlataforma": comparten_plataforma,
        "compartenMuestra": comparten_muestra,
        "muestraComun": {"id": muestra_comun["id"], "etiqueta": muestra_comun["etiqueta"]} if muestra_comun else None,
        "fuentesSinCohorte": sum(1 for _id, m in metodos if not m["cohorte"]),
        "fuentesSinPlataforma": len(metodos) - len(con_plataforma),
        "fuentesSinMuestra": len(metodos) - len(con_muestra),
        "totalFuentes": len(metodos),
    }


def _enumerar(etiquetas: list[str]) -> str:
    """'A', 'A y B', 'A, B y C'; con 'e' delante de i- o hi- ('plasma e imagen')."""
    if not etiquetas:
        return ""
    if len(etiquetas) == 1:
        return etiquetas[0]
    ultimo = etiquetas[-1]
    conj = "e" if re.match(r"(?i)h?i(?!e)", ultimo) else "y"
    return f"{', '.join(etiquetas[:-1])} {conj} {ultimo}"


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def texto_metodos(fuentes: Any, afirmaciones_por_fuente: Any = None) -> str:
    """El resumen de métodos en castellano, para el juez y la escalera GRADE.
    Por ejemplo: "Cohortes: ADNI y BioFINDER (2 distintas). Plataforma: Simoa
    en todas las fuentes, así que la concordancia entre estudios no es
    independiente del instrumento. Muestra: plasma." Todo por regla."""
    r = resumen_metodos(fuentes, afirmaciones_por_fuente)
    n = r["totalFuentes"]
    if n == 0:
        return "Sin fuentes: no hay métodos que resumir."
    partes: list[str] = []

    cohortes = r["cohortes"]
    sin_c = r["fuentesSinCohorte"]
    if not cohortes:
        partes.append("Cohorte: la única fuente no la nombra, así que no se puede afirmar nada sobre su independencia." if n == 1 else f"Cohorte: ninguna de las {n} fuentes la nombra, así que no se puede afirmar que sean independientes.")
    elif len(cohortes) == 1:
        et = cohortes[0]["etiqueta"]
        if n == 1:
            partes.append(f"Cohorte: {et} (una sola fuente).")
        else:
            donde = "en todas las fuentes" if not sin_c else f"en todas las fuentes que la nombran ({n - sin_c} de {n})"
            partes.append(f"Cohorte: {et} {donde}: varias publicaciones de la misma cohorte son una sola evidencia.")
    else:
        cola = f"; {_plural(sin_c, 'fuente', 'fuentes')} sin cohorte identificada" if sin_c else ""
        partes.append(f"Cohortes: {_enumerar([c['etiqueta'] for c in cohortes])} ({len(cohortes)} distintas){cola}.")

    plataformas = r["plataformas"]
    con_p = n - r["fuentesSinPlataforma"]
    if not plataformas:
        partes.append("Plataforma: no identificada en ninguna fuente.")
    elif r["compartenPlataforma"]:
        comun = next(p for p in plataformas if len(p["fuentes"]) == con_p)
        otras = [p["etiqueta"] for p in plataformas if p is not comun]
        donde = "en todas las fuentes" if con_p == n else f"en todas las fuentes que la indican ({con_p} de {n})"
        extra = f", junto a {_enumerar(otras)} en alguna," if otras else ","
        partes.append(f"Plataforma: {comun['etiqueta']} {donde}{extra} así que la concordancia entre estudios no es independiente del instrumento.")
    elif con_p == 1:
        cola = f"; {_plural(n - con_p, 'fuente', 'fuentes')} sin plataforma identificada" if n - con_p else ""
        if len(plataformas) == 1:
            partes.append(f"Plataforma: {plataformas[0]['etiqueta']} (una sola fuente la indica){cola}.")
        else:
            partes.append(f"Plataformas: {_enumerar([p['etiqueta'] for p in plataformas])} en una sola fuente (comparación cabeza a cabeza){cola}.")
    else:
        lista = _enumerar([f"{p['etiqueta']} ({_plural(len(p['fuentes']), 'fuente', 'fuentes')})" for p in plataformas])
        cola = f"; {_plural(n - con_p, 'fuente', 'fuentes')} sin plataforma identificada" if n - con_p else ""
        partes.append(f"Plataformas: {lista} ({len(plataformas)} distintas): la concordancia entre instrumentos distintos no depende de uno solo{cola}.")

    muestras = r["muestras"]
    if not muestras:
        partes.append("Muestra: no identificada.")
    elif len(muestras) == 1:
        partes.append(f"Muestra: {muestras[0]['etiqueta']}.")
    else:
        comun = r["muestraComun"]
        cola = f"; la principal es {comun['etiqueta']} en todas las fuentes que la indican" if comun else ""
        partes.append(f"Muestras mencionadas: {_enumerar([m['etiqueta'] for m in muestras])}{cola}.")
    return " ".join(partes)
