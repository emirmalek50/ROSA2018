"""Mapa del estado de la enfermedad, por regla.

El plan de ROSA2018 pide un "mapa del estado de la enfermedad": dónde está la
evidencia reunida por estadio (la fase del Alzheimer en que se sitúa el dato),
por región cerebral o compartimento (hipocampo, corteza entorrinal, plasma o
LCR como compartimento periférico...), por tipo celular (astrocito, microglía,
neurona...) y por nivel (molecular, celular, tisular, clínico). ROSA2018 ya
guarda esos ejes, pero dispersos: en la misión de la investigación
(`inv["mision"]`: población, etapa, célula o tejido), en la tarjeta de cada
hipótesis (célula, etapa), en las entidades canónicas de hechos e hipótesis
(ids CL para tipos celulares, UBERON para regiones y tejidos; rosa/ontologias.py)
y en el texto de cada hecho, hipótesis o afirmación. Este módulo los junta en
un mapa determinista, sin llamar a ningún modelo, y devuelve con cada valor el
motivo: qué regla lo dio y sobre qué fragmento del texto original.

Conceptos, por su nombre:

- Eje: una dimensión por la que se clasifica la evidencia. Hay cuatro:
  estadio, región, tipo celular y nivel.
- Celda: una combinación concreta de estadio, región y tipo celular, con los
  hechos y las hipótesis que caen en ella, la mayor certeza GRADE entre esas
  hipótesis (la certeza la fija rosa/certeza.py; aquí solo se lee) y las
  cohortes distintas que nombran sus hechos e hipótesis.
- Cohorte de una celda: para cada hecho, el campo `cohorte` de las
  afirmaciones que lo sostienen (`afirmacionIds`, buscadas en las claves
  privadas `_afirmaciones` de las corridas) y, si ninguna lo trae, la cohorte
  de las fuentes de su procedencia (`procedencia[].fuenteId` en `_fuentes`);
  para cada hipótesis, el campo `cohorte` de su copia de afirmaciones y, si
  ninguna lo trae, la lista canónica `cohortesDistintas` del ranking o la
  cohorte de las fuentes de su procedencia. La cohorte de una fuente sigue
  el orden de `metodos._nombre` (la regla del techo GRADE y del ranking): su
  campo `cohorte`, su método canónico (`metodo.cohorte`, que el bucle escribe
  al extraer) y su registro `nct`; una fuente anterior a que el bucle
  guardara `metodo` (295 de las 440 de la base del 19 de septiembre de 2026)
  se lee con la misma regla del catálogo (`metodos.metodo_de_fuente` sobre
  título, fragmentos y afirmaciones) la primera vez que un hecho o una
  hipótesis la pide, y el resultado se recuerda por proceso
  (`_CohortesPorFuente`, `_cohorte_por_catalogo`); una fuente con `metodo` y
  sin cohorte ya pasó por esa regla en el bucle y es "no pude comprobar". Los
  nombres se agrupan con el catálogo de rosa/metodos.py (`agrupar_cohortes`:
  "ADNI-3", "adni" y "Alzheimer's Disease Neuroimaging Initiative" son ADNI;
  un NCT es su ensayo; dos nombres libres que comparten una palabra no
  genérica son la misma), la misma regla que el techo GRADE y el ranking. La
  etiqueta de un grupo del catálogo es la canónica y la de un grupo de
  nombres libres es el menor de sus nombres sin distinguir mayúsculas, de
  modo que la misma cohorte lleva el mismo nombre en todas las celdas (antes
  era el primer nombre que llegaba a cada celda, y la interfaz contaba dos
  veces "Cohorte sueca de ADAD" y "ADAD longitudinal cohort study"). Antes del
  19 de septiembre de 2026 solo aportaban cohortes las hipótesis, y toda
  celda sin hipótesis salía a 0 cohortes aunque tuviera decenas de hechos (66
  de 66 en la investigación grande). `cohortesPorRegion` repite la cuenta por
  región, deduplicada entre las celdas de la región (se agrupan los nombres,
  no las etiquetas), para que la interfaz no la rehaga. Un hecho sin cohorte
  identificada no aporta ninguna: es "no pude comprobar", nunca "sin cohorte".
- Misión aprobada (`misionAprobada`): solo cuando `mision.aprobadaEn` no es
  None, que es lo que escribe rosa/estado/acciones.py cuando la persona
  aprueba la misión (sola o junto con el primer plan). Una misión que ROSA2018
  propuso y nadie aprobó (`propuestaPorRosa` con `aprobadaEn` nulo) no cuenta
  como aprobada: sus ejes y sus huecos se calculan igual (la interfaz los
  enseña como propuesta y el bucle sigue abriendo cuestiones por hueco, como
  hasta ahora), pero el resumen los llama orientativos y dice que solo
  contarán cuando la persona la apruebe. Aprobar la misión es una decisión
  humana (regla del 19 de septiembre de 2026; antes bastaba con que la misión
  existiera).
- Hueco: una combinación que la misión nombra y que ningún hecho ni hipótesis
  cubre por su propio contenido.

Estadio. Se resuelve con reglas sobre escalas conocidas y sobre palabras, en
castellano y en inglés, sobre el texto en minúsculas y sin tildes:

    Braak (estadio neuropatológico de la extensión de los ovillos de tau, I a
      VI): I y II preclínica; III y IV prodrómica/DCL; V demencia leve; VI
      demencia moderada o grave. Un intervalo (III-IV, V/VI) se lee por su
      límite inferior; "Braak > III" se lee como IV (al menos el siguiente) y
      "Braak ≥ III" como III. Braak 0 no es un estadio de la enfermedad.
    CDR (Clinical Dementia Rating, escala clínica global de 0 a 3): 0
      preclínica; 0,5 prodrómica/DCL; 1 demencia leve; 2 y 3 demencia moderada
      o grave. Se acepta "0.5" y "0,5" (coma decimal del castellano). "CDR > 0"
      se lee como la categoría siguiente (0,5) y "CDR < 1" como la anterior
      (0,5); ">=" y "≥" incluyen el valor. CDR-SB (suma de cajas, de 0 a 18)
      no es la escala global y se ignora.
    MMSE (Mini-Mental State Examination, de 0 a 30): 27 a 30 preclínica
      (cognición conservada); 24 a 26 prodrómica/DCL; 20 a 23 demencia leve;
      menos de 20 demencia moderada o grave. Un intervalo se lee por su punto
      medio; "> 26" se lee como 27 y "< 20" como 19; ">= 26" y "≥ 26" se leen
      como 26 (el límite incluido); "24/30" o "24 de 30" es 24 sobre el
      máximo, no un intervalo. Un valor fuera de 0 a 30 no cuenta.
    Thal (fase de extensión de las placas de amiloide, 1 a 5): 1 y 2
      preclínica; 3 prodrómica/DCL; 4 demencia leve; 5 demencia moderada o
      grave. Es una aproximación neuropatológica, no clínica.
    CERAD (densidad de placas neuríticas: escasa, moderada, frecuente): escasa
      preclínica; moderada prodrómica/DCL; frecuente demencia moderada o
      grave. Misma advertencia que Thal. La batería neuropsicológica CERAD
      (lista de palabras, recuerdo) no es la escala de placas y se ignora.
    Palabras: "preclinical", "presymptomatic", "asintomática", "cognitively
      unimpaired" (preclínica); "prodromal", "MCI", "DCL", "mild cognitive
      impairment" (prodrómica/DCL); "mild AD", "demencia leve" (demencia
      leve); "moderate", "severe", "grave", "avanzada" junto a demencia o
      Alzheimer (demencia moderada o grave; "advanced stage" o "estadio
      avanzado" solo si la misma frase habla de la enfermedad, la demencia o
      pacientes); "ADAD", "DIAN", "PSEN1", "PSEN2", "presenilina", "autosomal
      dominant", "familial AD", "FAD" (salvo junto a flavina o cofactor), y
      "APP" solo pegado a mutación, portador, duplicación o variante ("APP
      mutation", "mutaciones en APP"; "APP" a secas es la proteína precursora
      del amiloide y aparece en textos de Alzheimer esporádico).

  Cuando un texto nombra varios estadios gana la clase más específica (la
  forma autosómica dominante define la población; después las palabras
  clínicas y el CDR; después el MMSE; después Braak, Thal y CERAD, que son
  neuropatológicas) y, dentro de la clase, el primero que aparece en el
  texto; los demás quedan en el motivo y en la lista `estadios`, que es la
  que se usa para decidir si un registro cubre una combinación de la misión
  (un hecho sobre "portadores presintomáticos de PSEN1" cubre la forma
  autosómica dominante y también la fase preclínica). "Preclinical" seguido
  de "model", "study", "mice", "and clinical", "in vivo" o similares es
  investigación preclínica en animales o en fármacos, no la fase, y no cuenta.

Región. Una lista, porque un hecho puede hablar de dos regiones. Se resuelve
por expresión regular sobre el texto y por identificador UBERON de las
entidades canónicas (con dos puntos o con guion bajo, "UBERON:0002421" y
"UBERON_0002421", que es como OLS4 devuelve el short_form); una entidad
UBERON que no está en la tabla se resuelve por su etiqueta y sus alias con
las mismas expresiones. El plasma, la sangre y el suero son un solo
compartimento periférico; el LCR (líquido cefalorraquídeo) es otro; el flujo,
la presión y los vasos sanguíneos no son el compartimento (los vasos van a la
vasculatura). "Cerebro" o "corteza" a secas solo cuentan si el texto no nombra
ninguna región concreta. "Ca2+" (calcio) no es la región CA2 del hipocampo y
el hipotálamo no es el tálamo.

Tipo celular. Una lista, por expresión regular y por identificador CL (Cell
Ontology). "Oligodendrocyte precursor cells" son OPC, no oligodendrocitos; la
endotelina (un péptido) no es el endotelio.

Nivel. Una lista: molecular (genes, proteínas, biomarcadores, metabolitos),
celular (tipos celulares, cultivos, célula única), tisular (regiones,
atrofia, imagen, neuropatología) y clínico (pacientes, cognición, escalas,
diagnóstico, ensayos). Un plasma o un LCR no hacen tisular un dato: son el
compartimento donde se mide una molécula.

Cómo se combinan las fuentes (`ejes_de_hecho`, `ejes_de_hipotesis`). Por
orden de prioridad: la tarjeta de la hipótesis (célula, etapa), las
entidades canónicas, el texto propio (tema y enunciado del hecho; título,
enunciado y mecanismo de la hipótesis) y, solo si un eje sigue vacío, las
afirmaciones de la hipótesis (texto y cohorte). Las listas se unen; el
estadio lo da la primera fuente que lo resuelve. La misión de la
investigación entra la última y solo completa los ejes que siguen vacíos en
un hecho o hipótesis ya situado por su propio contenido: si rellenara
también lo que no tiene ningún eje, todo caería en la celda de la misión y
los huecos desaparecerían sin que nadie los cubriera. El estadio solo lo
completa cuando la misión nombra una sola fase: si abarca varias
("preclínica y prodrómica", o una fase más la forma autosómica dominante),
elegir la primera sería inventar en qué fase está el dato, así que el
registro queda sin estadio y el motivo lo dice. Cada eje lleva su `origen`
(tarjeta, entidades, texto, afirmaciones, mision) y `sinMision` guarda los
valores propios (con la lista `estadios`), que son los que cuentan para los
huecos.

Lo que no rompe: un estado sin la clave, una investigación sin misión
(anteriores a septiembre de 2026), un hecho sin `entidades`, un registro que
no es un diccionario, un texto en inglés o en castellano con o sin tildes, un
hecho heredado (id con "-inv-": se cuenta como los demás), un mapa guardado
por una versión anterior de este módulo sin alguna clave (`texto_mapa` lo lee
con valores por defecto). Nada de puntuaciones combinadas: la certeza de una
celda es la mayor certeza GRADE de sus hipótesis, o None si ninguna tiene
conclusión todavía. El `resumen` se calcula al final, de las celdas y los ejes
ya construidos (`resumen_de`), nunca de recuentos anteriores: un mapa guardado
cuyas celdas cambiaron después (rosa/hechos.py remapea los ids de las celdas
al fundir hechos repetidos) se vuelve a resumir con `resumen_de(mapa)` y las
cifras siguen a las celdas (el 19 de septiembre de 2026 el texto guardado
decía 217 hechos con 211 en sus celdas).
"""

from __future__ import annotations

import copy
import re
import unicodedata
from functools import lru_cache
from itertools import product
from typing import Any

from rosa import metodos as METODOS
from rosa.certeza import NIVELES as NIVELES_GRADE

# ---------------------------------------------------------------------------
# Tablas: valores, etiquetas y definiciones
# ---------------------------------------------------------------------------

ESTADIOS = ("preclinica", "prodromica_dcl", "demencia_leve", "demencia_moderada_grave", "autosomico_dominante")
ETIQUETAS_ESTADIO = {
    "preclinica": "preclínica",
    "prodromica_dcl": "prodrómica o DCL",
    "demencia_leve": "demencia leve",
    "demencia_moderada_grave": "demencia moderada o grave",
    "autosomico_dominante": "autosómica dominante",
}
DEFINICIONES_ESTADIO = {
    "preclinica": "biomarcadores alterados sin síntomas cognitivos",
    "prodromica_dcl": "deterioro cognitivo leve, síntomas sin demencia",
    "demencia_leve": "demencia establecida en su fase inicial",
    "demencia_moderada_grave": "demencia moderada o grave",
    "autosomico_dominante": "forma hereditaria por mutación en PSEN1, PSEN2 o APP; cohortes como DIAN",
}

NIVELES_BIOLOGICOS = ("molecular", "celular", "tisular", "clinico")
ETIQUETAS_NIVEL = {"molecular": "molecular", "celular": "celular", "tisular": "tisular", "clinico": "clínico"}
DEFINICIONES_NIVEL = {
    "molecular": "genes, proteínas, biomarcadores y metabolitos",
    "celular": "tipos celulares, cultivos y célula única",
    "tisular": "regiones, atrofia, imagen y neuropatología",
    "clinico": "pacientes, cognición, escalas, diagnóstico y ensayos",
}

# Regiones y compartimentos: (clave, etiqueta, expresión regular, ids UBERON).
# Las expresiones se aplican al texto en minúsculas y sin tildes. Las dos
# últimas claves son genéricas: solo cuentan si no hay una concreta.
REGIONES: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    ("hipocampo", "hipocampo", r"hipocamp\w*|hippocamp\w*|\bca[1-4]\b(?!\s*\+)|dentate gyrus|giro dentado|subicul\w*", frozenset({"UBERON:0002421", "UBERON:0001954", "UBERON:0001885"})),
    ("corteza_entorrinal", "corteza entorrinal", r"entorrinal|entorhinal|transentorhinal|transentorrinal|perirhinal|perirrinal", frozenset({"UBERON:0002728"})),
    ("corteza_prefrontal", "corteza frontal y prefrontal", r"prefrontal|frontal cortex|corteza frontal|frontal lobe|lobulo frontal|\bdlpfc\b|\bpfc\b|brodmann area 9|\bba9\b", frozenset({"UBERON:0001870", "UBERON:0000451"})),
    ("corteza_temporal", "corteza temporal", r"temporal (?:cortex|lobe|gyrus|pole|neocortex)|corteza temporal|lobulo temporal|giro temporal|\bmtg\b|\bitg\b|\bmtl\b|middle temporal|inferior temporal|superior temporal|fusiform|parahippocamp\w*|parahipocamp\w*", frozenset({"UBERON:0001871", "UBERON:0016538"})),
    ("corteza_parietal", "corteza parietal", r"parietal|angular gyrus|giro angular|supramarginal", frozenset({"UBERON:0001872"})),
    ("cingulo_precuneo", "cíngulo y precúneo", r"cingul\w*|precune\w*|retrosplenial|\bpcc\b", frozenset({"UBERON:0003027", "UBERON:0006093"})),
    ("corteza_occipital", "corteza occipital", r"occipital|visual cortex|corteza visual", frozenset({"UBERON:0002021"})),
    ("amigdala", "amígdala", r"amigdal\w*|amygdal\w*", frozenset({"UBERON:0001876"})),
    ("ganglios_basales_talamo", "ganglios basales y tálamo", r"striat\w*|estriad\w*|caudate|caudado|putamen|accumbens|basal ganglia|ganglios basales|(?<!hypo)thalam\w*|(?<!hipo)talam\w*|nucleus basalis|meynert|basal forebrain|prosencefalo basal", frozenset({"UBERON:0002435", "UBERON:0001873", "UBERON:0001874", "UBERON:0001897", "UBERON:0002420"})),
    ("tronco_locus_coeruleus", "tronco encefálico y locus coeruleus", r"locus c(?:o)?eruleus|brainstem|brain stem|tronco (?:del )?encef\w*|raphe|\brafe\b|substantia nigra|sustancia negra|medulla oblongata|bulbo raquideo", frozenset({"UBERON:0002148", "UBERON:0002298", "UBERON:0002038"})),
    ("cerebelo", "cerebelo", r"cerebel\w*|cerebell\w*", frozenset({"UBERON:0002037"})),
    ("sustancia_blanca", "sustancia blanca", r"white matter|sustancia blanca|materia blanca|\bwmh\b|hiperintensidad\w*|hyperintensit\w*|corpus callosum|cuerpo calloso", frozenset({"UBERON:0002316", "UBERON:0002336"})),
    ("vascular_bhe", "vasculatura cerebral y barrera hematoencefálica", r"blood[- ]brain barrier|barrera hematoencef\w*|\bbbb\b|\bbhe\b|cerebrovascular|vascular cerebral|neurovascular|capillar\w*|capilar\w*|microvasc\w*|arteriol\w*|perivascular|\bcaa\b|angiopat\w*|angiopath\w*|blood vessels?|vasos sanguineos", frozenset()),
    ("bulbo_olfatorio", "bulbo y vía olfatoria", r"olfact\w*|olfat\w*", frozenset({"UBERON:0002264"})),
    ("retina", "retina", r"\bretina\b|\bretinal\b|\bretinas\b|retinian\w*|\brnfl\b|optical coherence tomography|tomografia de coherencia optica", frozenset({"UBERON:0000966"})),
    ("intestino_microbiota", "intestino y microbiota", r"\bgut\b|intestin\w*|microbio(?:ta|me|mas?)\b", frozenset({"UBERON:0000160"})),
    ("plasma", "sangre, plasma y suero (compartimento periférico)", r"(?<!membrana )(?<!membrane )\bplasma\b(?! membrane)|(?<!membrana )plasmatic\w*|\bsangre\b|\bblood\b(?![- ](?:brain|flow|pressure|vessels?|supply|oxygen))|\bserum\b|\bsuero\b|\bserico\w*|\bserica\w*|peripheral blood|\bpbmc\b|leucocit\w*|leukocyt\w*|(?<!vasos )(?<!flujo )(?<!presion )sanguine\w*", frozenset({"UBERON:0001969", "UBERON:0000178", "UBERON:0001977"})),
    ("lcr", "líquido cefalorraquídeo (LCR)", r"\blcr\b|\bcsf\b|cefalorraquide\w*|cerebrospinal|\bliquor\b|lumbar puncture|puncion lumbar", frozenset({"UBERON:0001359"})),
    ("neocorteza", "corteza cerebral (sin región concreta)", r"neocort\w*|cerebral cortex|corteza cerebral|\bcortical\b|\bcortex\b|\bcorteza\b|isocort\w*|gr[ae]y matter|sustancia gris|materia gris", frozenset({"UBERON:0000956", "UBERON:0001950", "UBERON:0002020"})),
    ("cerebro_sin_region", "cerebro (sin región concreta)", r"\bbrain\b|\bcerebro\b|\bcerebral\b|encefal\w*|whole[- ]brain|intracranial|intracerebral", frozenset({"UBERON:0000955"})),
)
# Las genéricas ceden ante cualquier región concreta del sistema nervioso.
_REGIONES_GENERICAS = ("neocorteza", "cerebro_sin_region")
# Las que no son regiones del sistema nervioso central (no hacen ceder a las genéricas).
_COMPARTIMENTOS_PERIFERICOS = frozenset({"plasma", "lcr", "intestino_microbiota", "retina"})
ETIQUETAS_REGION = {clave: etiqueta for clave, etiqueta, _, _ in REGIONES}
_REGION_POR_UBERON = {id_: clave for clave, _, _, ids in REGIONES for id_ in ids}
_REGIONES_RE = [(clave, re.compile(patron)) for clave, _, patron, _ in REGIONES]

# Tipos celulares: (clave, etiqueta, expresión regular, ids CL).
_OPC_RE = re.compile(r"\bopcs?\b|oligodendrocyte (?:precursor|progenitor)\w*|(?:precursor|progenitor)\w* de (?:los )?oligodendrocit\w*|\bng2[- ]?(?:glia|cells?|\+)")
TIPOS_CELULARES: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    ("astrocito", "astrocito", r"astrocit\w*|astrocyt\w*|astrogli\w*", frozenset({"CL:0000127"})),
    ("microglia", "microglía", r"microgli\w*", frozenset({"CL:0000129"})),
    ("neurona", "neurona", r"\bneuron\w*|interneuron\w*|piramidal\w*|pyramidal|granule cells?|celulas granulares|motoneuron\w*|colinergic\w*|cholinergic", frozenset({"CL:0000540", "CL:0000598", "CL:0000099", "CL:0000108"})),
    ("oligodendrocito", "oligodendrocito", r"oligodendrocit\w*|oligodendrocyt\w*|oligodendrogli\w*", frozenset({"CL:0000128"})),
    ("opc", "OPC (célula precursora de oligodendrocitos)", _OPC_RE.pattern, frozenset({"CL:0002453"})),
    ("endotelio", "endotelio", r"endoteli(?!n)\w*|endotheli(?!n)\w*", frozenset({"CL:0000115", "CL:0002139"})),
    ("pericito", "pericito", r"pericit\w*|pericyt\w*|mural cells?|celulas murales", frozenset({"CL:0000669"})),
    ("inmune_periferico", "célula inmune periférica (linfocito, monocito, macrófago)", r"\bt cells?\b|linfocit\w*|lymphocyt\w*|monocit\w*|monocyt\w*|macrofag\w*|macrophag\w*|neutrofil\w*|neutrophil\w*|\bcd[48]\+", frozenset({"CL:0000084", "CL:0000576", "CL:0000235", "CL:0000542", "CL:0000775"})),
)
ETIQUETAS_TIPO_CELULAR = {clave: etiqueta for clave, etiqueta, _, _ in TIPOS_CELULARES}
_TIPO_POR_CL = {id_: clave for clave, _, _, ids in TIPOS_CELULARES for id_ in ids}
_TIPOS_RE = [(clave, re.compile(patron)) for clave, _, patron, _ in TIPOS_CELULARES]

ETIQUETAS = {"estadio": ETIQUETAS_ESTADIO, "region": ETIQUETAS_REGION, "tipoCelular": ETIQUETAS_TIPO_CELULAR, "nivel": ETIQUETAS_NIVEL}

# Nivel biológico: expresiones sobre el texto y ontología de las entidades.
_NIVEL_RE = {
    "molecular": re.compile(r"\bprotein\w*|\bproteina\w*|\bgen\b|\bgenes?\b|\bgene\b|\bmrna\b|\barnm\b|expresion\b|expression|biomarcador\w*|biomarker\w*|\bp-?tau\w*|\bptau\w*|amiloide|amyloid|\bgfap\b|\bnfl\b|\bapoe\w*|\btrem2\b|transcript\w*|metilaci\w*|methylation|fosforilaci\w*|phosphorylat\w*|receptor\w*|cytokin\w*|citoquin\w*|citocin\w*|\bil-?\d+\b|\btnf\w*|\blipid\w*|\blipido\w*|metabolit\w*|enzim\w*|enzym\w*|kinas\w*|quinas\w*|cinas\w*|peptid\w*|molecular|proteom\w*|transcriptom\w*|metabolom\w*|variant\w*|polimorfism\w*|polymorphism\w*|\bsnp\w*|mutaci\w*|mutation\w*"),
    "celular": re.compile(r"\bcelula\w*|\bcells?\b|\bcellular|\bcelular\w*|astrocit\w*|astrocyt\w*|microgli\w*|\bneuron\w*|oligodendro\w*|pericit\w*|pericyt\w*|endoteli\w*|endotheli\w*|single[- ]?(?:cell|nucleus|nuclei)|\bsc?rna-?seq\b|\bsnrna-?seq\b|\bipsc\w*|organoid\w*|\bcultivo\w*|\bcultur\w*|senescen\w*|fagocit\w*|phagocyt\w*|autofagi\w*|autophag\w*|\blinfocit\w*|lymphocyt\w*|monocit\w*|monocyt\w*|macrofag\w*|macrophag\w*"),
    "tisular": re.compile(r"\btejido\w*|\btissue\w*|atrofia|atrophy|\bmri\b|resonancia|\bpet\b|\bplacas?\b|\bplaques?\b|ovillos?|tangles?|neuropatolog\w*|neuropatholog\w*|post-?mortem|autopsia|autopsy|\bcortical\b|hipocamp\w*|hippocamp\w*|\bcorteza\b|\bcortex\b|\bvolumen\b|\bvolume\b|\bgrosor\b|thickness|white matter|sustancia blanca|\bbraak\b|\bcerad\b|\bthal\b|conectiv\w*|connectiv\w*|neurodegenera\w*|\bregion\w*|\blobulo\w*|\blobe\b|histolog\w*|inmunohistoquim\w*|immunohistochem\w*"),
    "clinico": re.compile(r"\bpaciente\w*|\bpatients?\b|cognici\w*|cognitiv\w*|cognition|demencia|dementia|\bmmse\b|\bcdr\b|\bmoca\b|\badas\w*|\bsintoma\w*|\bsymptom\w*|diagnos\w*|ensayo\w* clinic\w*|\bclinical\b|\bclinic\w*|progresi\w*|progression|conversi\w*|conversion|supervivencia|survival|\briesgo\b|\brisk\b|incidencia|incidence|prevalencia|prevalence|\bcohorte\w*|\bcohorts?\b|participante\w*|participants?|\bmemoria\b|\bmemory\b|deterioro|impairment|\bdcl\b|\bmci\b|preclinic\w*\b(?!\s+(?:model|models|modelo|modelos|stud(?:y|ies)|estudios?|mouse|mice|rats?|animal\w*))|prodrom\w*|\bfarmaco\w*|\bdrug\b|tratamiento|treatment|\bensayo\b|\btrial\b"),
}
_NIVEL_POR_ONTOLOGIA = {"HGNC": "molecular", "CHEBI": "molecular", "CL": "celular"}

# ---------------------------------------------------------------------------
# Estadio: escalas y palabras
# ---------------------------------------------------------------------------

_ROMANOS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6}
_NUM = r"(vi|iv|v|iii|ii|i|[0-6])"
_SEP = r"(?:\s*(?:-|/|to|a|y|and|,|o|or)\s*)"
# Operadores de comparación: ">=" y "≥" incluyen el valor; ">" y "<" no.
_OP = r"(>=|<=|≥|≤|>|<)?"
_BRAAK_RE = re.compile(r"\bbraak\b(?:\s*(?:nft|tau|neurofibrillary|stage|stages|estadio|estadios|fase|fases|score|:|=))*\s*" + _OP + r"\s*" + _NUM + r"\b(?:" + _SEP + _NUM + r"\b)?")
_CDR_RE = re.compile(r"\bcdr\b(?![- ]?(?:sb|sob|sum))(?:\s*(?:global|score|puntuacion|of|de|:|=))*\s*" + _OP + r"\s*(0[.,]5|0|1|2|3)\b(?:" + _SEP + r"(0[.,]5|0|1|2|3)\b)?")
# MMSE: el separador entre dos números se captura para distinguir "24/30" (24
# sobre el máximo) de "20-26" (intervalo).
_MMSE_RE = re.compile(r"\bmmse\b(?:\s*(?:score|scores|puntuacion|total|of|de|:|=))*\s*" + _OP + r"\s*(\d{1,2})\b(?:\s*(-|/|to|a|y|and|,|o|or|de|of|sobre|out of)\s*(\d{1,2})\b)?")
_MMSE_SOBRE_MAXIMO = ("/", "de", "of", "sobre", "out of")
_THAL_RE = re.compile(r"\bthal\b(?:\s*(?:amyloid|abeta|phase|phases|fase|fases|score|:|=))*\s*" + _OP + r"\s*([0-5])\b(?:" + _SEP + r"([0-5])\b)?")
_CERAD_RE = re.compile(r"\bcerad\b[^.;]{0,40}?\b(frequent|frecuentes?|moderate|moderad[ao]s?|sparse|escas[ao]s?|none|ausentes?|absent)\b|\bcerad\b[^.;]{0,30}?\b(?:score|puntuacion|grade|grado)\s*([abc0-3])\b")
# La batería neuropsicológica CERAD (lista de palabras, recuerdo) no es la escala de placas.
_CERAD_BATERIA_RE = re.compile(r"word list|list learning|recall|batter\w*|neuropsycholog\w*|neuropsicolog\w*|\bmemory\b|\bverbal\b|delayed|constructional|praxis|bateria|recuerdo|lista de palabras|fluency|fluencia|naming|denominacion")
_CERAD_PLACAS_RE = re.compile(r"plaque|placa|neuritic|neuritica|densit|densid|score|puntuacion|grade|grado|neuropatholog|neuropatolog")
_CDR_ORDEN = ("0", "0.5", "1", "2", "3")

BRAAK_A_ESTADIO = {1: "preclinica", 2: "preclinica", 3: "prodromica_dcl", 4: "prodromica_dcl", 5: "demencia_leve", 6: "demencia_moderada_grave"}
CDR_A_ESTADIO = {"0": "preclinica", "0.5": "prodromica_dcl", "1": "demencia_leve", "2": "demencia_moderada_grave", "3": "demencia_moderada_grave"}
THAL_A_ESTADIO = {1: "preclinica", 2: "preclinica", 3: "prodromica_dcl", 4: "demencia_leve", 5: "demencia_moderada_grave"}
CERAD_A_ESTADIO = {"sparse": "preclinica", "a": "preclinica", "1": "preclinica", "moderate": "prodromica_dcl", "b": "prodromica_dcl", "2": "prodromica_dcl", "frequent": "demencia_moderada_grave", "c": "demencia_moderada_grave", "3": "demencia_moderada_grave"}
_CERAD_PALABRAS = {"frecuente": "frequent", "frecuentes": "frequent", "moderada": "moderate", "moderado": "moderate", "moderadas": "moderate", "moderados": "moderate", "escasa": "sparse", "escaso": "sparse", "escasas": "sparse", "escasos": "sparse"}
_BRAAK_FASE = {1: "fase transentorrinal", 2: "fase transentorrinal", 3: "fase límbica", 4: "fase límbica", 5: "fase isocortical", 6: "fase isocortical"}


def mmse_a_estadio(valor: int) -> tuple[str | None, str]:
    """(estadio, tramo) para una puntuación MMSE de 0 a 30; fuera de ese rango, None."""
    if valor > 30:
        return None, "fuera de escala"
    if valor >= 27:
        return "preclinica", "27 a 30, cognición conservada"
    if valor >= 24:
        return "prodromica_dcl", "24 a 26"
    if valor >= 20:
        return "demencia_leve", "20 a 23"
    if valor >= 0:
        return "demencia_moderada_grave", "menos de 20"
    return None, "fuera de escala"


# "Preclinical" seguido de estas palabras es investigación en animales o en
# fármacos, no la fase de la enfermedad. "Phase" solo se excluye si no va
# seguido de la enfermedad ("preclinical phase of Alzheimer's disease" sí es la fase).
_ANIMAL = r"(?!\s+(?:model|models|modelo|modelos|stud(?:y|ies)|estudios?|data|datos|evidence|evidencia|research|investigacion|animal\w*|mouse|mice|rat|rats|raton\w*|trial|trials|testing|development|desarrollo|pipeline|efficacy|eficacia|work|drug|drugs|and clinical|to clinical|y clinic\w*|a clinic\w*|phase(?!\s+of\s+(?:ad\b|alzheimer|the disease|dementia|sporadic|autosomal|familial))))"
_MUT = r"(?:mutaci\w*|mutation\w*|mutant\w*|carrier\w*|portador\w*|duplicaci\w*|duplication\w*|variant\w*)"
# Contexto que confirma que "advanced stage" o "estadio avanzado" habla de la enfermedad.
_CONTEXTO_ENFERMEDAD_RE = re.compile(r"\bad\b|alzheimer|dementia|demencia|patients?|pacientes?|disease|enfermedad|neurodegenera\w*|cognitiv\w*|cognition|cognici\w*")
_PALABRA_ESTADIO_GENERICA_RE = re.compile(r"\b(?:stage|fase|estadio)\b")
_PALABRA_ENFERMEDAD_RE = re.compile(r"\bad\b|alzheimer|dementia|demencia")
# "FAD" junto a estas palabras es el cofactor flavina adenina dinucleótido.
_FLAVINA_RE = re.compile(r"flavin\w*|dinucleot\w*|cofactor\w*|oxidas\w*|\bnadh?\b|\bfadh2?\b|reductas\w*|dehydrogenas\w*|deshidrogenas\w*")
# "APP" con "portadores" de APOE es Alzheimer esporádico, no autosómico dominante.
_APOE_RE = re.compile(r"\bapoe\b|\bapoe[- ]?[eε]?4\b|\bε4\b|\be4\b")
_MUT_FUERTE_RE = re.compile(r"mutaci\w*|mutation\w*|mutant\w*|duplicaci\w*|duplication\w*|variant\w*|\bpsen|presenilin")
# (estadio, clase de regla, expresión, nombre de la regla). Clase: 0 autosómica dominante, 1 palabras clínicas.
_PALABRAS_ESTADIO: tuple[tuple[str, int, re.Pattern[str], str], ...] = (
    ("autosomico_dominante", 0, re.compile(r"\badad\b|\bdian\b|autosomal[- ]dominant\w*|autosomic[oa][- ]dominante\w*|\bpsen-?[12]\b|presenilin\w*|\bfad\b|\beofad\b|familial alzheimer\w*|alzheimer\w* familiar|\bapp\b(?=[^.]{0,60}\b" + _MUT + r")|" + _MUT + r"[^.]{0,60}\bapp\b"), "palabra de forma autosómica dominante (ADAD, DIAN, PSEN1/PSEN2, APP con mutación o portador)"),
    ("preclinica", 1, re.compile(r"\bpreclinic\w*\b" + _ANIMAL + r"|\bpre-?sympt\w*|\bpresintomat\w*|\basymptomat\w*|\basintomat\w*|cognitively (?:unimpaired|normal|healthy|intact)|cognitivamente (?:sanos?|sanas?|normales?|intact\w*)|sin deterioro cognitivo|sin sintomas"), "palabra de fase preclínica"),
    ("prodromica_dcl", 1, re.compile(r"\bprodrom\w*|\bmci\b|\bamci\b|\bdcl\b|mild cognitive impairment|deterioro cognitivo (?:leve|ligero)"), "palabra de fase prodrómica o DCL"),
    ("demencia_leve", 1, re.compile(r"\bmild(?:[- ]stage)?[- ](?:ad\b|alzheimer\w*|dementia|demencia|probable ad\b)|\bmild[- ]to[- ]moderate|\b(?:demencia|alzheimer|\bea\b)\s+(?:leve|ligera|inicial)\b|demencia (?:en )?(?:fase|estadio) (?:leve|inicial|temprana)|early[- ]stage (?:ad\b|alzheimer\w*|dementia)"), "palabra de demencia leve"),
    ("demencia_moderada_grave", 1, re.compile(r"\b(?:moderate|moderada|severe|severa|grave|advanced|avanzad[ao])(?:[- ]to[- ](?:severe|grave))?[- ](?:ad\b|alzheimer\w*|dementia|demencia|stage|fase|estadio)|\b(?:demencia|alzheimer)\s+(?:moderad[ao]|grave|sever[ao]|avanzad[ao])\b|late[- ]stage (?:ad\b|alzheimer\w*|dementia)|estadio (?:moderado|grave|avanzado)|demencia moderada a grave"), "palabra de demencia moderada o grave"),
)
# Clase de cada regla de escala: 1 clínica (CDR), 2 MMSE, 3 neuropatológica (Braak, Thal, CERAD).
_CLASES = {"adad": 0, "palabra": 1, "cdr": 1, "mmse": 2, "braak": 3, "thal": 3, "cerad": 3}

# ---------------------------------------------------------------------------
# Ayudantes
# ---------------------------------------------------------------------------


def _dic(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _lista(x: Any) -> list[Any]:
    return x if isinstance(x, list) else []


def _texto(x: Any) -> str:
    if x is None or isinstance(x, bool):
        return ""
    if isinstance(x, (list, tuple)):
        return " ".join(_texto(y) for y in x)
    if isinstance(x, dict):
        return " ".join(_texto(v) for v in x.values())
    return str(x)


@lru_cache(maxsize=4096)
def _caracter_normalizado(c: str) -> str:
    """Un carácter en minúscula y sin marca diacrítica, siempre de longitud 1.
    Los guiones tipográficos pasan a "-"; "\u2265" (mayor o igual) y "\u2264"
    (menor o igual) se conservan tal cual para que las reglas de las escalas
    distingan "mayor que" de "mayor o igual"."""
    if c in "\u2013\u2014\u2212":  # guion corto, guion largo y signo menos tipográficos
        return "-"
    if c in "\u2265\u2264":
        return c
    d = unicodedata.normalize("NFKD", c)
    base = next((ch for ch in d if unicodedata.category(ch) != "Mn"), "")
    return base if base else " "


def normalizar(texto: Any) -> str:
    """Minúsculas y sin marcas diacríticas, carácter a carácter: la cadena
    normalizada tiene la misma longitud que la original, así que las posiciones
    de una coincidencia sirven para citar el fragmento original con sus tildes.
    Los guiones tipográficos pasan a "-"; los símbolos de mayor o igual y menor
    o igual se conservan (las reglas de CDR, MMSE, Braak y Thal los aceptan
    junto a ">=" y "<="). Cada carácter se traduce una vez y se recuerda."""
    return "".join(_caracter_normalizado(c) for c in str(texto or "").lower())


def _fragmento(original: str, inicio: int, fin: int, largo: int = 60) -> str:
    """El trozo del texto original (con sus tildes) que dio la coincidencia."""
    trozo = original[inicio:fin].strip()
    return trozo[:largo] + ("..." if len(trozo) > largo else "")


def _valor_num(token: str) -> int | None:
    if token in _ROMANOS:
        return _ROMANOS[token]
    try:
        return int(token)
    except (TypeError, ValueError):
        return None


_FIN_FRASE_RE = re.compile(r"[.;\n]")


def _frase(t: str, posicion: int) -> str:
    """La frase del texto normalizado que contiene la posición (entre puntos,
    puntos y coma o saltos de línea), para comprobar el contexto de una regla."""
    inicio = max((m.end() for m in _FIN_FRASE_RE.finditer(t, 0, posicion)), default=0)
    m_fin = _FIN_FRASE_RE.search(t, posicion)
    return t[inicio : m_fin.start() if m_fin else len(t)]


def _palabra_estadio_valida(estadio: str, m: re.Match[str], t: str) -> str | None:
    """Filtros de contexto sobre una coincidencia de palabra: devuelve el motivo
    por el que no cuenta, o None si cuenta."""
    texto_m = m.group(0)
    frase = _frase(t, m.start())
    if estadio == "autosomico_dominante":
        if texto_m == "fad" and _FLAVINA_RE.search(frase):
            return "FAD junto a flavina o cofactor es el dinucleótido, no el Alzheimer familiar"
        if re.search(r"\bapp\b", texto_m) and not _MUT_FUERTE_RE.search(texto_m) and _APOE_RE.search(frase):
            return "los portadores son de APOE, no de una mutación en APP"
    if estadio == "demencia_moderada_grave" and _PALABRA_ESTADIO_GENERICA_RE.search(texto_m) and not _PALABRA_ENFERMEDAD_RE.search(texto_m):
        if not _CONTEXTO_ENFERMEDAD_RE.search(frase):
            return "estadio avanzado sin la enfermedad, la demencia ni pacientes en la misma frase"
    return None


def _quitar_genericas(regiones: list[str]) -> list[str]:
    """Las regiones genéricas ceden: "cerebro" y "corteza" a secas se quitan si
    hay una región concreta del sistema nervioso, y "cerebro" a secas se quita
    también si al menos hay "corteza"."""
    concretas = [r for r in regiones if r not in _REGIONES_GENERICAS and r not in _COMPARTIMENTOS_PERIFERICOS]
    if concretas:
        return [r for r in regiones if r not in _REGIONES_GENERICAS]
    if "neocorteza" in regiones:
        return [r for r in regiones if r != "cerebro_sin_region"]
    return regiones


def _unir(*listas: list[str], maximo: int = 6) -> list[str]:
    salida: list[str] = []
    for lista in listas:
        for x in lista:
            if x not in salida:
                salida.append(x)
    return salida[:maximo]


def etiqueta(eje: str, valor: Any) -> str:
    """La etiqueta en castellano de un valor de un eje, para la pantalla y el
    prompt; None se lee como "sin situar" y un valor desconocido se devuelve tal cual."""
    if valor is None:
        return "sin situar"
    return ETIQUETAS.get(eje, {}).get(str(valor), str(valor))


# ---------------------------------------------------------------------------
# Detección por texto
# ---------------------------------------------------------------------------


def estadios_de_texto(texto: Any) -> list[dict[str, Any]]:
    """Todos los estadios que nombra un texto, cada uno con su regla, su
    fragmento original, su clase (0 la más específica) y su posición. Ordenados
    por clase y después por posición. Sin repetir estadio."""
    original = _texto(texto)
    t = normalizar(original)
    if not t.strip():
        return []
    hallazgos: list[dict[str, Any]] = []

    def anotar(estadio: str | None, regla: str, clase: int, m: re.Match[str], detalle: str) -> None:
        if not estadio:
            return
        hallazgos.append({"estadio": estadio, "regla": regla, "clase": clase, "posicion": m.start(), "motivo": f"{detalle}: «{_fragmento(original, m.start(), m.end())}»"})

    for estadio, clase, patron, nombre in _PALABRAS_ESTADIO:
        for m in patron.finditer(t):
            if _palabra_estadio_valida(estadio, m, t) is None:
                anotar(estadio, "adad" if clase == 0 else "palabra", clase, m, nombre)
    for m in _CDR_RE.finditer(t):
        op, v = m.group(1) or "", m.group(2).replace(",", ".")
        indice = _CDR_ORDEN.index(v)
        leido = v
        if op == ">":
            leido = _CDR_ORDEN[min(indice + 1, len(_CDR_ORDEN) - 1)]
        elif op == "<":
            leido = _CDR_ORDEN[max(indice - 1, 0)]
        detalle = f"CDR global {leido.replace('.', ',')}" + (f" (leído de «{op} {v.replace('.', ',')}»)" if op in (">", "<") else "") + f" corresponde a {ETIQUETAS_ESTADIO.get(CDR_A_ESTADIO.get(leido, ''), '')}"
        anotar(CDR_A_ESTADIO.get(leido), "cdr", _CLASES["cdr"], m, detalle)
    for m in _MMSE_RE.finditer(t):
        op, a, sep, b = m.group(1) or "", _valor_num(m.group(2)), (m.group(3) or "").strip(), _valor_num(m.group(4)) if m.group(4) else None
        if a is None or a > 30 or (b is not None and b > 30):
            continue
        if b is not None and b == 30 and sep in _MMSE_SOBRE_MAXIMO:
            valor = a  # "24/30" o "24 de 30": 24 sobre el máximo, no un intervalo
        elif b is not None:
            valor = round((a + b) / 2)
        elif op == ">":
            valor = a + 1
        elif op == "<":
            valor = a - 1
        else:
            valor = a
        estadio, tramo = mmse_a_estadio(valor)
        anotar(estadio, "mmse", _CLASES["mmse"], m, f"MMSE {valor} (tramo {tramo}) corresponde a {ETIQUETAS_ESTADIO.get(estadio or '', '')}")
    for m in _BRAAK_RE.finditer(t):
        op = m.group(1) or ""
        a = _valor_num(m.group(2))
        b = _valor_num(m.group(3)) if m.group(3) else None
        if a is None:
            continue
        nombre_a = m.group(2).upper()
        if b is None and op in (">", "<"):
            a += 1 if op == ">" else -1  # "Braak > III" es al menos IV
            nombre_a = next((k.upper() for k, v in _ROMANOS.items() if v == a), str(a)) + f" (leído de «{op} {m.group(2).upper()}»)"
        estadio = BRAAK_A_ESTADIO.get(a)
        cruza = b is not None and BRAAK_A_ESTADIO.get(b) != estadio
        detalle = f"Braak {nombre_a}" + (f" a {m.group(3).upper()}" if b is not None else "") + f" ({_BRAAK_FASE.get(a, 'sin ovillos')}) corresponde a {ETIQUETAS_ESTADIO.get(estadio or '', 'ningún estadio')}" + ("; el intervalo cruza fases y se toma la más temprana" if cruza else "")
        anotar(estadio, "braak", _CLASES["braak"], m, detalle)
    for m in _THAL_RE.finditer(t):
        a = _valor_num(m.group(2))
        if a is None:
            continue
        estadio = THAL_A_ESTADIO.get(a)
        anotar(estadio, "thal", _CLASES["thal"], m, f"Thal {a} (fase de extensión del amiloide, aproximación neuropatológica) corresponde a {ETIQUETAS_ESTADIO.get(estadio or '', 'ningún estadio')}")
    for m in _CERAD_RE.finditer(t):
        frase = _frase(t, m.start())
        if _CERAD_BATERIA_RE.search(frase) and not _CERAD_PLACAS_RE.search(frase):
            continue  # batería neuropsicológica CERAD, no la escala de placas
        crudo = (m.group(1) or m.group(2) or "").lower()
        clave = _CERAD_PALABRAS.get(crudo, crudo)
        estadio = CERAD_A_ESTADIO.get(clave)
        anotar(estadio, "cerad", _CLASES["cerad"], m, f"CERAD {crudo} (densidad de placas neuríticas, aproximación neuropatológica) corresponde a {ETIQUETAS_ESTADIO.get(estadio or '', 'ningún estadio')}")

    hallazgos.sort(key=lambda x: (x["clase"], x["posicion"]))
    vistos: set[str] = set()
    salida = []
    for x in hallazgos:
        if x["estadio"] in vistos:
            continue
        vistos.add(x["estadio"])
        salida.append(x)
    return salida


def _estadio_de(todos: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """(estadio, motivo) a partir de la lista de `estadios_de_texto`: el primero
    por clase y posición; los demás, en el motivo."""
    if not todos:
        return None, None
    primero = todos[0]
    motivo = primero["motivo"]
    otros = [ETIQUETAS_ESTADIO[x["estadio"]] for x in todos[1:]]
    if otros:
        motivo += "; también se nombra: " + ", ".join(otros)
    return primero["estadio"], motivo


def _por_regex(texto_original: str, t: str, tabla: list[tuple[str, re.Pattern[str]]], quitar: re.Pattern[str] | None = None) -> dict[str, str]:
    """{clave: motivo} para cada patrón de la tabla que aparece en el texto
    normalizado `t`. `quitar` borra antes lo que confundiría (los OPC frente a
    los oligodendrocitos)."""
    salida: dict[str, str] = {}
    for clave, patron in tabla:
        base = t
        if quitar is not None and clave == "oligodendrocito":
            base = quitar.sub(lambda m: " " * (m.end() - m.start()), t)
        m = patron.search(base)
        if m:
            salida[clave] = f"texto: «{_fragmento(texto_original, m.start(), m.end())}»"
    return salida


_ID_ONTOLOGIA_RE = re.compile(r"^([A-Za-z]+)[_:]\s*(\S+)$")


def _id_canonico(id_: Any) -> str:
    """El identificador con el prefijo en mayúsculas y dos puntos: "uberon_0002421"
    (short_form de OLS4) y "UBERON:0002421" (obo_id) son la misma entidad."""
    texto = str(id_ or "").strip()
    m = _ID_ONTOLOGIA_RE.match(texto)
    return f"{m.group(1).upper()}:{m.group(2)}" if m else texto.upper()


def _por_entidades(entidades: Any, tabla_ids: dict[str, str], prefijo: str, tabla_re: list[tuple[str, re.Pattern[str]]]) -> dict[str, str]:
    """{clave: motivo} para las entidades canónicas con ese prefijo (UBERON o
    CL): por identificador si está en la tabla; si no, por su etiqueta y alias."""
    salida: dict[str, str] = {}
    for ent in _lista(entidades):
        ent = _dic(ent)
        id_ = _id_canonico(ent.get("id"))
        if not id_.startswith(prefijo + ":"):
            continue
        id_crudo = str(ent.get("id") or "").strip()  # el motivo cita el id tal como lo trae el registro
        clave = tabla_ids.get(id_)
        etiq = str(ent.get("etiqueta") or "")
        if clave:
            salida.setdefault(clave, f"entidad {id_crudo} ({etiq or 'sin etiqueta'})")
            continue
        nombres = " ; ".join([etiq] + [str(a) for a in _lista(ent.get("alias"))])
        for clave2, patron in tabla_re:
            if patron.search(normalizar(nombres)):
                salida.setdefault(clave2, f"entidad {id_crudo} por su etiqueta ({etiq or 'alias'})")
                break
    return salida


def _niveles(texto_original: str, t: str, entidades: Any) -> dict[str, str]:
    salida: dict[str, str] = {}
    for ent in _lista(entidades):
        ent = _dic(ent)
        id_ = _id_canonico(ent.get("id"))
        onto = str(ent.get("ontologia") or "").upper() or id_.split(":")[0]
        nivel = _NIVEL_POR_ONTOLOGIA.get(onto)
        if nivel:
            salida.setdefault(nivel, f"entidad {ent.get('id')} ({onto})")
        elif onto == "UBERON":
            clave = _REGION_POR_UBERON.get(id_)
            if clave and clave not in _COMPARTIMENTOS_PERIFERICOS:
                salida.setdefault("tisular", f"entidad {ent.get('id')} (región)")
    for nivel in NIVELES_BIOLOGICOS:
        m = _NIVEL_RE[nivel].search(t)
        if m:
            salida.setdefault(nivel, f"texto: «{_fragmento(texto_original, m.start(), m.end())}»")
    return {n: salida[n] for n in NIVELES_BIOLOGICOS if n in salida}


def ejes_de_texto(texto: Any, entidades: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Los cuatro ejes de un texto (y, si se pasan, de sus entidades canónicas):
    {"estadio": valor o None, "estadios": [todos los que nombra, el primero es `estadio`],
    "region": [...], "tipoCelular": [...], "nivel": [...],
    "motivos": {"estadio": str o None, "region": {valor: motivo}, "tipoCelular": {...}, "nivel": {...}}}.
    Determinista; acepta castellano e inglés, con o sin tildes."""
    original = _texto(texto)
    t = normalizar(original)
    todos = estadios_de_texto(original)
    estadio, motivo_estadio = _estadio_de(todos)
    # La entidad canónica (un identificador) es un motivo más preciso que el
    # texto: si las dos dan la misma región, se conserva el de la entidad.
    regiones = _por_entidades(entidades, _REGION_POR_UBERON, "UBERON", _REGIONES_RE)
    for clave, motivo in _por_regex(original, t, _REGIONES_RE).items():
        regiones.setdefault(clave, motivo)
    conservar = set(_quitar_genericas(list(regiones)))
    regiones = {k: v for k, v in regiones.items() if k in conservar}
    tipos = _por_entidades(entidades, _TIPO_POR_CL, "CL", _TIPOS_RE)
    for clave, motivo in _por_regex(original, t, _TIPOS_RE, quitar=_OPC_RE).items():
        tipos.setdefault(clave, motivo)
    niveles = _niveles(original, t, entidades)
    return {
        "estadio": estadio,
        "estadios": [x["estadio"] for x in todos],
        "region": _unir(list(regiones)),
        "tipoCelular": _unir(list(tipos)),
        "nivel": list(niveles),
        "motivos": {"estadio": motivo_estadio, "region": regiones, "tipoCelular": tipos, "nivel": niveles},
    }


# ---------------------------------------------------------------------------
# Combinación de fuentes: tarjeta, entidades, texto, afirmaciones, misión
# ---------------------------------------------------------------------------

_EJES_LISTA = ("region", "tipoCelular", "nivel")
_ORIGENES_DIRECTOS = ("tarjeta", "entidades", "texto")


@lru_cache(maxsize=256)
def _ejes_de_mision_cacheados(etapa: str, poblacion: str, celula_tejido: str) -> dict[str, Any]:
    """Los ejes de una misión a partir de sus tres textos, calculados una vez
    por combinación: el mapa los pide para cada hecho e hipótesis de la
    investigación. Quien los use recibe una copia (`ejes_de_mision`)."""
    estadios: list[str] = []
    motivos_estadio: dict[str, str] = {}
    for campo, texto in (("etapa", etapa), ("poblacion", poblacion)):
        for x in estadios_de_texto(texto):
            if x["estadio"] not in estadios:
                estadios.append(x["estadio"])
                motivos_estadio[x["estadio"]] = f"misión ({campo}): {x['motivo']}"
    ejes = ejes_de_texto(celula_tejido)
    return {
        "estadio": estadios[0] if estadios else None,
        "estadios": estadios,
        "region": ejes["region"],
        "tipoCelular": ejes["tipoCelular"],
        "motivos": {
            "estadio": motivos_estadio.get(estadios[0]) if estadios else None,
            "estadios": motivos_estadio,
            "region": {k: f"misión (celulaTejido): {v}" for k, v in ejes["motivos"]["region"].items()},
            "tipoCelular": {k: f"misión (celulaTejido): {v}" for k, v in ejes["motivos"]["tipoCelular"].items()},
        },
    }


def ejes_de_mision(inv: Any) -> dict[str, Any]:
    """Los ejes que fija la misión de la investigación: estadios (todos los que
    nombran la etapa y la población, en ese orden), regiones y tipos celulares
    de la célula o tejido. Vacío si no hay misión. Devuelve
    {estadio, estadios, region, tipoCelular, motivos}: la lista completa de
    estadios va en `estadios` porque la misión puede abarcar varias fases;
    `estadio` es el primero."""
    mision = _dic(_dic(inv).get("mision"))
    if not mision:
        return {"estadio": None, "estadios": [], "region": [], "tipoCelular": [], "motivos": {"estadio": None, "estadios": {}, "region": {}, "tipoCelular": {}}}
    return copy.deepcopy(_ejes_de_mision_cacheados(_texto(mision.get("etapa")), _texto(mision.get("poblacion")), _texto(mision.get("celulaTejido"))))


def _combinar(fuentes: list[tuple[str, dict[str, Any]]], inv: Any) -> dict[str, Any]:
    """Junta los ejes de varias fuentes ya calculadas, en orden de prioridad.
    Las directas (tarjeta, entidades, texto) se unen; las de respaldo
    (afirmaciones) solo rellenan lo vacío; la misión entra la última y solo si
    el registro ya está situado por lo suyo. Devuelve
    {estadio, region, tipoCelular, nivel, origen, motivos, sinMision, situado}:
    el origen y los motivos van por eje; `sinMision` guarda los valores propios."""
    salida: dict[str, Any] = {"estadio": None, "region": [], "tipoCelular": [], "nivel": [], "origen": {"estadio": None, "region": None, "tipoCelular": None, "nivel": None}, "motivos": {"estadio": None, "region": {}, "tipoCelular": {}, "nivel": {}}}
    estadios: list[str] = []
    directas = [(o, ej) for o, ej in fuentes if o in _ORIGENES_DIRECTOS]
    respaldo = [(o, ej) for o, ej in fuentes if o not in _ORIGENES_DIRECTOS]

    def con_origen(origen: str, motivo: Any) -> str:
        """"texto: «...»" no se duplica ("texto: texto: «...»") y la tarjeta o las
        afirmaciones dicen su nombre en vez de "texto"."""
        motivo = str(motivo or "")
        if motivo.startswith("texto: "):
            motivo = motivo[len("texto: ") :]
        return f"{origen}: {motivo}".rstrip(": ")

    for origen, ej in directas + respaldo:
        de_respaldo = origen not in _ORIGENES_DIRECTOS
        motivos_ej = _dic(ej.get("motivos"))
        if salida["estadio"] is None and ej.get("estadio"):
            salida["estadio"] = ej["estadio"]
            salida["origen"]["estadio"] = origen
            salida["motivos"]["estadio"] = con_origen(origen, motivos_ej.get("estadio"))
        # Todos los estadios que nombra la fuente cuentan para cubrir la misión
        # (un hecho sobre portadores presintomáticos de PSEN1 cubre la forma
        # autosómica dominante y la fase preclínica). Las de respaldo, solo si
        # las directas no dieron ninguno.
        if not (de_respaldo and estadios):
            estadios = _unir(estadios, [x for x in _lista(ej.get("estadios")) if isinstance(x, str)] or ([ej["estadio"]] if ej.get("estadio") else []))
        for eje in _EJES_LISTA:
            valores = list(ej.get(eje) or [])
            if not valores or (de_respaldo and salida[eje]):
                continue
            if not salida[eje]:
                salida["origen"][eje] = origen
            salida[eje] = _unir(salida[eje], valores)
            for v in valores:
                salida["motivos"][eje].setdefault(v, con_origen(origen, _dic(motivos_ej.get(eje)).get(v)))
    if salida["estadio"]:
        estadios = _unir([salida["estadio"]], estadios)
    salida["region"] = _quitar_genericas(salida["region"])
    salida["motivos"]["region"] = {k: v for k, v in salida["motivos"]["region"].items() if k in salida["region"]}
    salida["sinMision"] = {"estadio": salida["estadio"], "estadios": estadios, "region": list(salida["region"]), "tipoCelular": list(salida["tipoCelular"])}
    situado = bool(salida["estadio"] or salida["region"] or salida["tipoCelular"])
    if situado:
        mision = ejes_de_mision(inv)
        if salida["estadio"] is None and mision["estadios"]:
            if len(mision["estadios"]) == 1:
                salida["estadio"] = mision["estadio"]
                salida["origen"]["estadio"] = "mision"
                salida["motivos"]["estadio"] = mision["motivos"]["estadio"]
            else:
                # Elegir una de las fases de la misión sería inventar en cuál está el dato.
                salida["motivos"]["estadio"] = "sin estadio propio; la misión abarca varias fases (" + ", ".join(ETIQUETAS_ESTADIO.get(x, x) for x in mision["estadios"]) + ") y no se elige una"
        for eje in ("region", "tipoCelular"):
            if not salida[eje] and mision[eje]:
                salida[eje] = list(mision[eje])
                salida["origen"][eje] = "mision"
                salida["motivos"][eje] = dict(mision["motivos"][eje])
    salida["situado"] = situado
    return salida


def ejes_de_hecho(h: Any, inv: Any = None) -> dict[str, Any]:
    """Los ejes de un hecho del modelo de mundo: entidades canónicas, texto
    (tema y enunciado) y, si algo falta, la misión de `inv`. Un registro que no
    es un diccionario o sin texto queda sin situar (nunca rompe)."""
    h = _dic(h)
    entidades = _lista(h.get("entidades"))
    texto = " . ".join(x for x in (_texto(h.get("tema")), _texto(h.get("enunciado"))) if x)
    fuentes = [("entidades", ejes_de_texto("", entidades)), ("texto", ejes_de_texto(texto))]
    return _combinar(fuentes, inv)


def ejes_de_hipotesis(h: Any, inv: Any = None) -> dict[str, Any]:
    """Los ejes de una hipótesis: tarjeta (etapa, célula), entidades canónicas,
    texto (título, enunciado, mecanismo), afirmaciones (texto y cohorte, solo
    como respaldo) y, si algo falta, la misión de `inv`."""
    h = _dic(h)
    tarjeta = _dic(h.get("tarjeta"))
    fuentes: list[tuple[str, dict[str, Any]]] = []
    if tarjeta:
        etapa = _texto(tarjeta.get("etapa"))
        celula = _texto(tarjeta.get("celula"))
        ej_etapa = ejes_de_texto(etapa)
        ej_celula = ejes_de_texto(celula)
        # De la etapa solo se toma el estadio; de la célula, región y tipo celular.
        fuentes.append(("tarjeta", {"estadio": ej_etapa["estadio"], "estadios": ej_etapa["estadios"], "region": ej_celula["region"], "tipoCelular": ej_celula["tipoCelular"], "nivel": [], "motivos": {"estadio": ej_etapa["motivos"]["estadio"], "region": ej_celula["motivos"]["region"], "tipoCelular": ej_celula["motivos"]["tipoCelular"], "nivel": {}}}))
    fuentes.append(("entidades", ejes_de_texto("", _lista(h.get("entidades")))))
    texto = " . ".join(x for x in (_texto(h.get("titulo")), _texto(h.get("enunciado")), _texto(h.get("mecanismo"))) if x)
    fuentes.append(("texto", ejes_de_texto(texto)))
    afirmaciones = [_dic(a) for a in _lista(h.get("afirmaciones"))]
    if afirmaciones:
        texto_af = " . ".join(x for a in afirmaciones for x in (_texto(a.get("texto")), _texto(a.get("cohorte"))) if x)
        fuentes.append(("afirmaciones", ejes_de_texto(texto_af)))
    return _combinar(fuentes, inv)


# ---------------------------------------------------------------------------
# Cohortes de una celda
# ---------------------------------------------------------------------------


def _nombres_cohorte(valor: Any) -> list[str]:
    """El campo `cohorte` de una afirmación o de una fuente como nombres
    limpios (espacios plegados). Una cadena es un nombre; un nodo del catálogo
    ({"id", "etiqueta"}) da su etiqueta (o su id, nombre o texto si no la
    tiene); una lista da todos sus nombres; None, números, booleanos u otros
    objetos no son un nombre (cohorte no identificada)."""
    if isinstance(valor, str):
        n = " ".join(valor.split())
        return [n] if n else []
    if isinstance(valor, (bytes, bytearray)):
        return _nombres_cohorte(valor.decode("utf-8", "ignore"))
    if isinstance(valor, dict):
        for clave in ("etiqueta", "nombre", "texto", "id"):
            nombres = _nombres_cohorte(valor.get(clave))
            if nombres:
                return nombres
        return []
    if isinstance(valor, (list, tuple)):
        salida: list[str] = []
        for v in valor:
            _unir_nombres(salida, _nombres_cohorte(v))
        return salida
    return []


def _unir_nombres(destino: list[str], nuevos: list[str]) -> None:
    """Añade a `destino` los nombres que no estaban, sin distinguir mayúsculas
    ("ADNI" y "adni" son uno), conservando el orden y la primera grafía."""
    vistos = {n.casefold() for n in destino}
    for n in nuevos:
        k = n.casefold()
        if k not in vistos:
            vistos.add(k)
            destino.append(n)


# Cohorte que el catálogo lee en una fuente anterior a `metodo`, por id de fuente
# y huella de su contenido (`_huella_fuente`). Se calcula una vez por proceso:
# leer el fragmento de una fuente cuesta decenas de milisegundos y las 295
# fuentes antiguas de la base del 19 de septiembre de 2026 sumaban unos 10 s,
# que no caben en los 300 ms de un `mapa()`. Si el contenido de la fuente
# cambia (más fragmentos, otras afirmaciones) la huella cambia y se recalcula.
_CACHE_CATALOGO: dict[tuple[Any, ...], list[str]] = {}
_CACHE_CATALOGO_MAX = 8192


def _vaciar_cache_catalogo() -> None:
    """Olvida las cohortes leídas por el catálogo (para tests y diagnósticos)."""
    _CACHE_CATALOGO.clear()


def _huella_fuente(fid: str, f: dict[str, Any], afirmaciones: list[dict[str, Any]]) -> tuple[Any, ...]:
    """Lo que identifica el contenido que `metodos.metodo_de_fuente` lee de una
    fuente, sin copiar los textos: id, título, longitud del fragmento, longitud
    de cada fragmento privado, campo `cohorte`, `nct` y los ids de sus
    afirmaciones. Cambia si cambia cualquiera de ellos."""
    fragmentos = tuple(len(_texto(_dic(fr).get("texto"))) for fr in _lista(f.get("fragmentos")))
    ids_af = tuple(str(_dic(a).get("id") or "") for a in afirmaciones)
    return (fid, _texto(f.get("titulo")), len(_texto(f.get("fragmento"))), fragmentos, _texto(f.get("cohorte")), _texto(f.get("nct")), ids_af)


def _cohorte_por_catalogo(fid: str, f: dict[str, Any], afirmaciones: list[dict[str, Any]]) -> list[str]:
    """La cohorte que el catálogo de rosa/metodos.py lee en una fuente que no
    trae `metodo`, con la misma regla que el bucle aplica al extraer
    (`metodos.metodo_de_fuente(fuente, afirmaciones)`: campo, NCT, título,
    fragmentos y afirmaciones, en ese orden). Recordada por proceso en
    `_CACHE_CATALOGO`. Si el catálogo falla, [] (no pude comprobar): el mapa
    nunca se cae por una fuente rara. No muta la fuente."""
    clave = _huella_fuente(fid, f, afirmaciones)
    recordado = _CACHE_CATALOGO.get(clave)
    if recordado is not None:
        return list(recordado)
    try:
        nombres = _nombres_cohorte(_dic(METODOS.metodo_de_fuente(f, afirmaciones)).get("cohorte"))
    except Exception:  # noqa: BLE001  el catálogo nunca tumba el mapa
        nombres = []
    if len(_CACHE_CATALOGO) >= _CACHE_CATALOGO_MAX:
        _CACHE_CATALOGO.clear()
    _CACHE_CATALOGO[clave] = list(nombres)
    return list(nombres)


class _CohortesPorFuente:
    """Cohortes por id de fuente, con el orden de `metodos._nombre` (la regla
    del techo GRADE y del ranking): el campo `cohorte`, el método canónico
    `metodo.cohorte` y el registro `nct`. Una fuente sin ninguno de los tres y
    sin `metodo` (anterior a que el bucle lo guardara) se resuelve la primera
    vez que alguien la pide, con `_cohorte_por_catalogo`, y solo esa: las
    fuentes que ningún hecho ni hipótesis cita no se leen. Una fuente con
    `metodo` y sin cohorte ya pasó por esa regla en el bucle y queda como "no
    pude comprobar". Se lee como un diccionario de solo lectura (`fid in
    indice`, `indice[fid]`, `indice.get(fid)`): una fuente "está" si tiene
    cohorte identificada. Nunca muta las fuentes del estado; devuelve copias."""

    def __init__(self, afirmaciones_por_fuente: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self._directas: dict[str, list[str]] = {}
        self._pendientes: dict[str, dict[str, Any]] = {}
        self._resueltas: dict[str, list[str]] = {}
        self._afirmaciones = afirmaciones_por_fuente if afirmaciones_por_fuente is not None else {}

    def registrar(self, fid: str, f: dict[str, Any]) -> None:
        """Anota una fuente; con dos del mismo id gana la primera."""
        if fid in self._directas or fid in self._pendientes:
            return
        metodo = f.get("metodo")
        nombres = _nombres_cohorte(f.get("cohorte")) or _nombres_cohorte(_dic(metodo).get("cohorte")) or _nombres_cohorte(f.get("nct"))
        if nombres:
            self._directas[fid] = nombres
        elif f and not isinstance(metodo, dict):
            self._pendientes[fid] = f

    def get(self, fid: Any, por_defecto: Any = None) -> Any:
        """Los nombres de cohorte de la fuente (copia), o `por_defecto` si no tiene ninguno identificado."""
        if not isinstance(fid, str) or not fid:
            return por_defecto
        nombres = self._directas.get(fid)
        if nombres is None:
            nombres = self._resueltas.get(fid)
        if nombres is None:
            f = self._pendientes.get(fid)
            if f is None:
                return por_defecto
            nombres = self._resueltas[fid] = _cohorte_por_catalogo(fid, f, self._afirmaciones.get(fid) or [])
        return list(nombres) if nombres else por_defecto

    def __contains__(self, fid: object) -> bool:
        return self.get(fid) is not None

    def __getitem__(self, fid: str) -> list[str]:
        nombres = self.get(fid)
        if nombres is None:
            raise KeyError(fid)
        return nombres

    def __len__(self) -> int:
        return len(self._directas) + len(self._pendientes)

    def pendientes(self) -> int:
        """Fuentes anteriores a `metodo` que todavía nadie ha pedido."""
        return sum(1 for fid in self._pendientes if fid not in self._resueltas)


def _indice_cohortes(e: dict[str, Any]) -> tuple[dict[str, list[str]], _CohortesPorFuente]:
    """(cohortes por id de afirmación, cohortes por id de fuente), leídas de las
    claves privadas de las corridas (`_afirmaciones`, `_fuentes`), que no viajan
    al navegador. Se recorren todas las corridas del estado, no solo las de la
    investigación: los ids de afirmación y de fuente son únicos en todo el
    estado y así un hecho heredado de otra investigación encuentra la
    afirmación de su corrida de origen (misma regla que rosa/hechos.py
    `afirmaciones_por_fuente`). Las cohortes por fuente las da
    `_CohortesPorFuente`, que se lee como un diccionario y resuelve al pedirla
    la de una fuente anterior a `metodo` con el catálogo; para eso el índice
    agrupa también las afirmaciones de cada fuente (`fuenteId`). Lo que no es
    un diccionario, o no tiene id, se ignora; con dos registros del mismo id
    gana el primero."""
    por_afirmacion: dict[str, list[str]] = {}
    afirmaciones_por_fuente: dict[str, list[dict[str, Any]]] = {}
    por_fuente = _CohortesPorFuente(afirmaciones_por_fuente)
    for c in _lista(e.get("corridas")):
        c = _dic(c)
        for a in _lista(c.get("_afirmaciones")):
            a = _dic(a)
            fid_a = a.get("fuenteId")
            if isinstance(fid_a, str) and fid_a:
                afirmaciones_por_fuente.setdefault(fid_a, []).append(a)
            aid = a.get("id")
            if not isinstance(aid, str) or not aid or aid in por_afirmacion:
                continue
            nombres = _nombres_cohorte(a.get("cohorte"))
            if nombres:
                por_afirmacion[aid] = nombres
        fuentes = c.get("_fuentes")
        if isinstance(fuentes, dict):
            pares = [(str(k), _dic(v)) for k, v in fuentes.items()]
        else:
            pares = [(str(_dic(v).get("id") or ""), _dic(v)) for v in _lista(fuentes)]
        for fid, f in pares:
            if fid:
                por_fuente.registrar(fid, f)
    return por_afirmacion, por_fuente


def _cohortes_de_fuentes(ids: list[Any], por_fuente: Any) -> list[str]:
    """Los nombres de cohorte de esas fuentes, en orden y sin repetir.
    `por_fuente` es el índice de `_indice_cohortes` o cualquier cosa con
    `get` (un diccionario id -> nombres vale)."""
    salida: list[str] = []
    lector = getattr(por_fuente, "get", None)
    if not callable(lector):
        return salida
    for fid in ids:
        if not isinstance(fid, str) or not fid:
            continue
        nombres = lector(fid)
        if nombres:
            _unir_nombres(salida, [n for n in _lista(nombres) if isinstance(n, str) and n.strip()])
    return salida


def _cohortes_de_hecho(h: dict[str, Any], por_afirmacion: dict[str, list[str]], por_fuente: Any) -> list[str]:
    """Los nombres de cohorte de un hecho, en orden y sin repetir: el campo
    `cohorte` de las afirmaciones que lo sostienen (`afirmacionIds`) y, si
    ninguna lo trae, la cohorte de las fuentes de su procedencia
    (`procedencia[].fuenteId`). Sin ninguna de las dos, ninguna: el hecho no
    dice de qué cohorte viene, y eso no es "sin cohorte"."""
    nombres: list[str] = []
    for aid in _lista(h.get("afirmacionIds")):
        if isinstance(aid, str) and aid in por_afirmacion:
            _unir_nombres(nombres, por_afirmacion[aid])
    if nombres:
        return nombres
    procedencia = h.get("procedencia")
    entradas = _lista(procedencia) if isinstance(procedencia, list) else _lista(_dic(procedencia).get("fuentes"))
    return _cohortes_de_fuentes([_dic(p).get("fuenteId") or _dic(p).get("id") for p in entradas], por_fuente)


def _cohortes_de_hipotesis(h: dict[str, Any], por_afirmacion: dict[str, list[str]], por_fuente: Any) -> list[str]:
    """Los nombres de cohorte de una hipótesis: el campo `cohorte` de su copia
    de afirmaciones (la regla de siempre) y, si ninguna lo trae, la lista
    canónica `cohortesDistintas` que escribe rosa/priorizacion.py (la misma
    cuenta que el techo GRADE) y, si tampoco, la cohorte de las fuentes de su
    procedencia (`procedencia.fuentes[].cohorte`, o por su id en las corridas)."""
    nombres: list[str] = []
    for a in _lista(h.get("afirmaciones")):
        a = _dic(a)
        propios = _nombres_cohorte(a.get("cohorte"))
        if not propios:
            aid = a.get("id") or a.get("afirmacionId")
            propios = list(por_afirmacion[aid]) if isinstance(aid, str) and aid in por_afirmacion else []
        _unir_nombres(nombres, propios)
    if nombres:
        return nombres
    _unir_nombres(nombres, _nombres_cohorte([x for x in _lista(h.get("cohortesDistintas")) if isinstance(x, str)]))
    if nombres:
        return nombres
    fuentes = [_dic(f) for f in _lista(_dic(h.get("procedencia")).get("fuentes"))]
    for f in fuentes:
        _unir_nombres(nombres, _nombres_cohorte(f.get("cohorte")) or _cohortes_de_fuentes([f.get("id")], por_fuente))
    return nombres


def _etiqueta_de_grupo(g: Any) -> str:
    """La etiqueta de un grupo de `metodos.agrupar_cohortes`: la canónica si
    el grupo tiene identificador (cohorte del catálogo o registro de ensayo)
    y, si es un grupo de nombres libres, el menor de sus nombres sin
    distinguir mayúsculas, que no depende del orden en que llegaron."""
    g = _dic(g)
    etiqueta = g.get("etiqueta")
    etiqueta = " ".join(etiqueta.split()) if isinstance(etiqueta, str) else ""
    propios = [" ".join(n.split()) for n in _lista(g.get("nombres")) if isinstance(n, str) and n.strip()]
    if g.get("id") and etiqueta:
        return etiqueta
    if propios:
        return min(propios, key=lambda x: (x.casefold(), x))
    return etiqueta


def _cohortes_distintas(nombres: list[str]) -> list[str]:
    """Una etiqueta por cohorte distinta, ordenadas. Los nombres se agrupan con
    `metodos.agrupar_cohortes` (la regla del techo GRADE y del ranking): los
    que resuelven al catálogo, por su identificador ("ADNI-3", "adni" y
    "Alzheimer's Disease Neuroimaging Initiative" son ADNI; un NCT es su
    ensayo); dos nombres libres que comparten una palabra no genérica son la
    misma. La etiqueta de un grupo del catálogo es la canónica; la de un grupo
    de nombres libres es el menor de sus nombres sin distinguir mayúsculas
    (`_etiqueta_de_grupo`), no el primero que llegó a la celda: así la misma
    cohorte lleva el mismo nombre en todas las celdas y la interfaz no la
    cuenta dos veces. Si el catálogo falla con un nombre raro, se deduplica
    por el nombre en minúsculas: el mapa nunca se queda sin cohortes por un
    error del catálogo."""
    # Entre dos grafías del mismo nombre ("Cohorte x rara" y "cohorte X rara")
    # se queda la menor, no la primera que llegó: la etiqueta no depende del orden.
    por_clave: dict[str, str] = {}
    for n in nombres:
        if isinstance(n, str) and n.strip():
            n = " ".join(n.split())
            k = n.casefold()
            if k not in por_clave or n < por_clave[k]:
                por_clave[k] = n
    limpios = list(por_clave.values())
    if not limpios:
        return []
    try:
        etiquetas = [x for x in (_etiqueta_de_grupo(g) for g in _lista(METODOS.agrupar_cohortes([{"id": f"c{i}", "cohorte": n} for i, n in enumerate(limpios)]))) if x]
    except Exception:  # noqa: BLE001  el catálogo nunca deja una celda sin cohortes
        etiquetas = limpios
    salida: list[str] = []
    _unir_nombres(salida, etiquetas)
    return sorted(salida, key=lambda x: (x.casefold(), x))


# ---------------------------------------------------------------------------
# El mapa
# ---------------------------------------------------------------------------

_MAX_CELDAS_POR_REGISTRO = 12


def _sin_ids_repetidos(registros: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Un estado corrupto puede traer dos registros con el mismo id: cuenta el
    primero. Los que no tienen id se conservan todos (no se pueden confundir)."""
    vistos: set[str] = set()
    salida = []
    for r in registros:
        id_ = r.get("id")
        if isinstance(id_, str) and id_:
            if id_ in vistos:
                continue
            vistos.add(id_)
        salida.append(r)
    return salida


def _certeza_de(h: dict[str, Any]) -> str | None:
    c = _dic(h.get("conclusion")).get("certeza")
    c = str(c).strip().lower() if isinstance(c, str) else None
    return c if c in NIVELES_GRADE else None


def _mayor_certeza(niveles: list[str]) -> str | None:
    validos = [n for n in niveles if n in NIVELES_GRADE]
    return max(validos, key=NIVELES_GRADE.index) if validos else None


def _celdas_de(ejes: dict[str, Any]) -> list[tuple[str | None, str | None, str | None]]:
    regiones = list(ejes.get("region") or []) or [None]
    tipos = list(ejes.get("tipoCelular") or []) or [None]
    return list(product([ejes.get("estadio")], regiones, tipos))[:_MAX_CELDAS_POR_REGISTRO]


def _cubre(propios: dict[str, Any], combo: tuple[str | None, str | None, str | None]) -> bool:
    """Si los ejes propios de un registro (sin misión) cubren una combinación
    de la misión: cada eje que la combinación fija tiene que estar en el registro."""
    estadio, region, tipo = combo
    estadios = _lista(propios.get("estadios")) or ([propios.get("estadio")] if propios.get("estadio") else [])
    if estadio is not None and estadio not in estadios:
        return False
    if region is not None and region not in (propios.get("region") or []):
        return False
    if tipo is not None and tipo not in (propios.get("tipoCelular") or []):
        return False
    return True


def _describir_combo(combo: tuple[str | None, str | None, str | None]) -> str:
    partes = []
    for eje, valor in zip(("estadio", "region", "tipoCelular"), combo):
        if valor is not None:
            partes.append(etiqueta(eje, valor))
    return " · ".join(partes) if partes else "sin ejes"


def mapa(e: Any, investigacion_id: str) -> dict[str, Any]:
    """El mapa del estado de la enfermedad de una investigación:
    {"ejes": {"estadio": {valor: n}, "region": {...}, "tipoCelular": {...}, "nivel": {...}},
     "celdas": [{"estadio", "region", "tipoCelular", "hechos": [ids], "hipotesis": [ids], "preguntas": [ids],
                 "certezaMax": nivel GRADE o None, "certezaMotivo", "cohortes": [etiquetas], "porMision": n}],
     "cohortesPorRegion": {region: cohortes distintas entre las celdas de esa región},
     "huecos": [{"estadio", "region", "tipoCelular", "motivo", "heredanDeMision": n}],
     "sinEjes": n (hechos que no se pudieron situar), "hipotesisSinEjes": n, "heredados": n,
     "mision": ejes de la misión, "misionAprobada": bool, "resumen": str}.
    Cuentan los hechos no descartados (las preguntas abiertas van aparte) y las
    hipótesis no descartadas ni fusionadas. Un hecho heredado (id con "-inv-")
    cuenta como los demás. Las cohortes de una celda son las de sus hechos
    (afirmaciones enlazadas o fuente de la procedencia) y sus hipótesis,
    agrupadas por el catálogo de rosa/metodos.py; las preguntas no aportan.
    El resumen se calcula al final de las celdas y los ejes ya construidos
    (`resumen_de`). Determinista: las celdas van ordenadas por número de
    registros y después por sus claves; `cohortesPorRegion` por clave."""
    e = _dic(e)
    if not isinstance(investigacion_id, str) or not investigacion_id:
        # Sin investigación no hay mapa: con None, `None == None` juntaría los hechos sin investigacionId.
        return {"ejes": {"estadio": {}, "region": {}, "tipoCelular": {}, "nivel": {}}, "celdas": [], "cohortesPorRegion": {}, "huecos": [], "sinEjes": 0, "hipotesisSinEjes": 0, "heredados": 0, "mision": ejes_de_mision(None), "misionAprobada": False, "resumen": "Sin investigación no hay mapa de la enfermedad que construir."}
    inv = next((i for i in _lista(e.get("investigaciones")) if _dic(i).get("id") == investigacion_id), None)
    # La misión solo cuenta como aprobada si la persona la aprobó (`aprobadaEn`,
    # que escribe rosa/estado/acciones.py); una propuesta de ROSA2018 sin aprobar
    # trae la clave a None. `is not None`, no la verdad del valor: aprobar en t=0 vale.
    mision_inv = _dic(inv.get("mision")) if inv is not None else {}
    # Un hecho sustituido por otro más reciente (sustituidoPor) no cuenta aunque
    # un estado antiguo lo conserve como "sabido": contaría dos veces lo mismo.
    hechos = _sin_ids_repetidos([h for h in (_dic(x) for x in _lista(e.get("hechos"))) if h.get("investigacionId") == investigacion_id and h.get("estado") != "descartado" and not h.get("sustituidoPor")])
    hipotesis = _sin_ids_repetidos([h for h in (_dic(x) for x in _lista(e.get("hipotesis"))) if h.get("investigacionId") == investigacion_id and h.get("estado") != "descartada" and not h.get("fusionadaEn")])
    certeza_por_id = {str(h.get("id") or ""): _certeza_de(h) for h in hipotesis}
    # Cohorte por id de afirmación y por id de fuente, de las claves privadas de
    # las corridas: es lo que permite que un hecho aporte cohortes a su celda.
    por_afirmacion, por_fuente = _indice_cohortes(e) if (hechos or hipotesis) else ({}, {})

    celdas: dict[tuple[str | None, str | None, str | None], dict[str, Any]] = {}
    conteo: dict[str, dict[str, int]] = {"estadio": {}, "region": {}, "tipoCelular": {}, "nivel": {}}
    propios_situados: list[dict[str, Any]] = []
    heredan_solo_mision: list[dict[str, Any]] = []
    sin_ejes_hechos = 0
    sin_ejes_hip = 0
    heredados = 0

    def celda(clave: tuple[str | None, str | None, str | None]) -> dict[str, Any]:
        return celdas.setdefault(clave, {"estadio": clave[0], "region": clave[1], "tipoCelular": clave[2], "hechos": [], "hipotesis": [], "preguntas": [], "_certezas": [], "_cohortes": [], "porMision": 0})

    def contar(ejes: dict[str, Any]) -> None:
        if ejes.get("estadio"):
            conteo["estadio"][ejes["estadio"]] = conteo["estadio"].get(ejes["estadio"], 0) + 1
        for eje in _EJES_LISTA:
            for v in ejes.get(eje) or []:
                conteo[eje][v] = conteo[eje].get(v, 0) + 1

    for h in hechos:
        ejes = ejes_de_hecho(h, inv)
        es_pregunta = h.get("tipo") == "pregunta"
        if not es_pregunta:
            # El nivel se cuenta también para lo que no se pudo situar (un hecho
            # sobre GFAP es molecular aunque no diga región); una pregunta no.
            for n in ejes["nivel"]:
                conteo["nivel"][n] = conteo["nivel"].get(n, 0) + 1
        id_ = str(h.get("id") or "")
        if not ejes["situado"]:
            if not es_pregunta:
                sin_ejes_hechos += 1
            continue
        if not es_pregunta:
            # Una pregunta abierta se sitúa en su celda para verla, pero no cuenta
            # como cobertura: ni en los ejes ni frente a los huecos de la misión.
            if "-inv-" in id_:
                heredados += 1
            contar({**ejes, "nivel": []})
            propios_situados.append(ejes["sinMision"])
            if any(v == "mision" for v in ejes["origen"].values()):
                heredan_solo_mision.append(ejes)
        # Una pregunta abierta no cuenta como cobertura, así que tampoco aporta cohortes.
        cohortes_h = [] if es_pregunta else _cohortes_de_hecho(h, por_afirmacion, por_fuente)
        for clave in _celdas_de(ejes):
            c = celda(clave)
            c["preguntas" if es_pregunta else "hechos"].append(id_)
            if not es_pregunta:
                _unir_nombres(c["_cohortes"], cohortes_h)
                if "mision" in ejes["origen"].values():
                    c["porMision"] += 1

    for h in hipotesis:
        ejes = ejes_de_hipotesis(h, inv)
        for n in ejes["nivel"]:
            conteo["nivel"][n] = conteo["nivel"].get(n, 0) + 1
        if not ejes["situado"]:
            sin_ejes_hip += 1
            continue
        contar({**ejes, "nivel": []})
        propios_situados.append(ejes["sinMision"])
        if any(v == "mision" for v in ejes["origen"].values()):
            heredan_solo_mision.append(ejes)
        certeza = _certeza_de(h)
        cohortes_h = _cohortes_de_hipotesis(h, por_afirmacion, por_fuente)
        for clave in _celdas_de(ejes):
            c = celda(clave)
            c["hipotesis"].append(str(h.get("id") or ""))
            if certeza:
                c["_certezas"].append(certeza)
            _unir_nombres(c["_cohortes"], cohortes_h)
            if "mision" in ejes["origen"].values():
                c["porMision"] += 1

    lista_celdas = []
    nombres_por_region: dict[str, list[str]] = {}
    for clave in sorted(celdas, key=lambda k: (-(len(celdas[k]["hechos"]) + len(celdas[k]["hipotesis"])), str(k[0]), str(k[1]), str(k[2]))):
        c = celdas[clave]
        if not c["hechos"] and not c["hipotesis"] and not c["preguntas"]:
            continue
        certeza_max = _mayor_certeza(c.pop("_certezas"))
        sin_conclusion = sum(1 for hid in c["hipotesis"] if not certeza_por_id.get(hid))
        if certeza_max:
            cuantas = "la única hipótesis" if len(c["hipotesis"]) == 1 else f"las {len(c['hipotesis'])} hipótesis"
            motivo = f"la mayor certeza GRADE entre las conclusiones de {cuantas} de la celda" + (f"; {sin_conclusion} sin conclusión todavía" if sin_conclusion else "")
        elif c["hipotesis"]:
            motivo = "ninguna hipótesis de la celda tiene conclusión GRADE todavía"
        else:
            motivo = "sin hipótesis en la celda: la certeza GRADE se calcula por hipótesis"
        c["certezaMax"] = certeza_max
        c["certezaMotivo"] = motivo
        nombres = c.pop("_cohortes")
        c["cohortes"] = _cohortes_distintas(nombres)
        if isinstance(c["region"], str):
            # Por región se agrupan los NOMBRES de todas sus celdas, no las
            # etiquetas ya agrupadas: dos nombres libres de celdas distintas
            # que son la misma cohorte cuentan una vez también aquí.
            _unir_nombres(nombres_por_region.setdefault(c["region"], []), nombres)
        lista_celdas.append(c)

    mision = ejes_de_mision(inv)
    huecos: list[dict[str, Any]] = []
    estadios_m = list(mision["estadios"]) or [None]
    regiones_m = list(mision["region"]) or [None]
    tipos_m = list(mision["tipoCelular"]) or [None]
    if mision["estadios"] or mision["region"] or mision["tipoCelular"]:
        for combo in product(estadios_m, regiones_m, tipos_m):
            if any(_cubre(p, combo) for p in propios_situados):
                continue
            heredan = sum(1 for ej in heredan_solo_mision if _cubre({"estadio": ej["estadio"], "region": ej["region"], "tipoCelular": ej["tipoCelular"]}, combo))
            motivo = f"La misión nombra «{_describir_combo(combo)}» y ningún hecho ni hipótesis lo sitúa por su propio contenido"
            motivo += f" ({_n(heredan, 'registro lo hereda', 'registros lo heredan')} solo de la misión)." if heredan else "."
            huecos.append({"estadio": combo[0], "region": combo[1], "tipoCelular": combo[2], "motivo": motivo, "heredanDeMision": heredan})

    salida = {
        "ejes": conteo,
        "celdas": lista_celdas,
        "cohortesPorRegion": {r: len(_cohortes_distintas(ns)) for r, ns in sorted(nombres_por_region.items())},
        "huecos": huecos,
        "sinEjes": sin_ejes_hechos,
        "hipotesisSinEjes": sin_ejes_hip,
        "heredados": heredados,
        "mision": mision,
        "misionAprobada": bool(mision_inv) and mision_inv.get("aprobadaEn") is not None,
        "resumen": "",
    }
    # El resumen se escribe el último y sale de las celdas y los ejes ya
    # construidos, nunca de recuentos hechos por el camino.
    salida["resumen"] = resumen_de(salida)
    return salida


def resumen_de(m: Any) -> str:
    """El resumen en llano de un mapa, calculado de sus propias celdas y ejes:
    hechos e hipótesis distintos que aparecen en alguna celda, número de
    celdas, ejes, lo no situado, los heredados y los huecos. Vale para el mapa
    recién construido y para uno guardado cuyas celdas cambiaron después (al
    fundir hechos repetidos, rosa/hechos.py remapea los ids de las celdas y
    el texto guardado se quedaba con la cifra vieja: "217 hechos" con 211 en
    las celdas). Un mapa guardado por una versión anterior sin alguna clave se
    lee con valores por defecto; sin `misionAprobada` (mapas guardados antes del
    19 de septiembre de 2026) se toma por aprobada si sus ejes de misión fijan
    algo, así que un mapa guardado con una misión solo propuesta seguirá
    diciendo aprobada hasta el siguiente cierre de iteración, que ya escribe la
    clave; con la clave presente manda la clave. Nunca rompe: algo que no es un
    mapa da el texto de "sin nada que situar"."""
    m = _dic(m)
    celdas = [c for c in _lista(m.get("celdas")) if isinstance(c, dict)]
    ids_hechos = {str(x) for c in celdas for x in _lista(c.get("hechos"))}
    ids_hip = {str(x) for c in celdas for x in _lista(c.get("hipotesis"))}
    ejes_m = _dic(m.get("ejes"))
    ejes = {eje: {str(k): _entero(v) for k, v in _dic(ejes_m.get(eje)).items() if _entero(v) > 0} for eje in ("estadio", "region", "tipoCelular", "nivel")}
    mision_m = _dic(m.get("mision"))
    mision = {eje: [x for x in _lista(mision_m.get(eje)) if isinstance(x, str)] for eje in ("estadios", "region", "tipoCelular")}
    vista = {
        "celdas": celdas,
        "ejes": ejes,
        "huecos": [h for h in _lista(m.get("huecos")) if isinstance(h, dict)],
        "sinEjes": _entero(m.get("sinEjes")),
        "hipotesisSinEjes": _entero(m.get("hipotesisSinEjes")),
        "heredados": _entero(m.get("heredados")),
        "mision": mision,
    }
    aprobada = m.get("misionAprobada")
    if not isinstance(aprobada, bool):
        aprobada = bool(mision["estadios"] or mision["region"] or mision["tipoCelular"])
    return _resumen(vista, len(ids_hechos), len(ids_hip), aprobada)


def _n(n: int, singular: str, plural: str) -> str:
    """"1 hecho", "2 hechos": el número con su sustantivo concordado."""
    return f"{n} {singular if n == 1 else plural}"


def _top(conteo: dict[str, int], eje: str, maximo: int = 4) -> str:
    pares = sorted(conteo.items(), key=lambda kv: (-kv[1], kv[0]))[:maximo]
    return ", ".join(f"{etiqueta(eje, k)} {v}" for k, v in pares)


def _resumen(m: dict[str, Any], n_hechos: int, n_hip: int, hay_mision: bool) -> str:
    if not m["celdas"] and not m["sinEjes"] and not m["hipotesisSinEjes"]:
        base = "Todavía no hay hechos ni hipótesis que situar en el mapa de la enfermedad."
    elif not m["celdas"]:
        base = f"Ningún registro se pudo situar en el mapa de la enfermedad: {_n(m['sinEjes'], 'hecho', 'hechos')} y {_n(m['hipotesisSinEjes'], 'hipótesis', 'hipótesis')} sin estadio, región ni tipo celular en su propio contenido."
        if m["ejes"].get("nivel"):
            base += f" Niveles: {_top(m['ejes']['nivel'], 'nivel')}."
    else:
        base = f"{_n(n_hechos, 'hecho', 'hechos')} y {_n(n_hip, 'hipótesis', 'hipótesis')} situados en {_n(len(m['celdas']), 'celda', 'celdas')} (estadio, región y tipo celular)."
        for eje, nombre in (("estadio", "Estadios"), ("region", "Regiones"), ("tipoCelular", "Tipos celulares"), ("nivel", "Niveles")):
            if m["ejes"].get(eje):
                base += f" {nombre}: {_top(m['ejes'][eje], eje)}."
        if m["sinEjes"] or m["hipotesisSinEjes"]:
            base += f" Sin situar: {_n(m['sinEjes'], 'hecho', 'hechos')} y {_n(m['hipotesisSinEjes'], 'hipótesis', 'hipótesis')}."
        if m["heredados"]:
            base += f" {_n(m['heredados'], 'de los hechos situados es heredado', 'de los hechos situados son heredados')} de otra investigación."
    fija_algo = bool(m["mision"]["estadios"] or m["mision"]["region"] or m["mision"]["tipoCelular"])
    if not hay_mision:
        if m["huecos"] and fija_algo:
            # Hay una misión (propuesta por ROSA2018, o guardada sin aprobar) con ejes: sus
            # huecos se calculan igual, pero son orientativos hasta que la persona la apruebe.
            n_h = len(m["huecos"])
            base += f" La investigación no tiene misión aprobada: hay una misión propuesta y sin aprobar, y frente a ella {'queda' if n_h == 1 else 'quedan'} {_n(n_h, 'hueco orientativo', 'huecos orientativos')} que solo {'contará' if n_h == 1 else 'contarán'} cuando la persona la apruebe."
        else:
            base += " La investigación no tiene misión aprobada, así que no hay huecos que comprobar."
    elif not fija_algo:
        base += " La misión no fija estadio, región ni tipo celular, así que no hay huecos que comprobar."
    elif m["huecos"]:
        base += f" Huecos de la misión sin cubrir: {len(m['huecos'])} ({'; '.join(_describir_combo((h.get('estadio'), h.get('region'), h.get('tipoCelular'))) for h in m['huecos'][:4])}{'...' if len(m['huecos']) > 4 else ''})."
    else:
        base += " Todas las combinaciones que nombra la misión tienen al menos un hecho o una hipótesis."
    return base


def texto_mapa(e: Any, investigacion_id: str, maximo: int = 12, precalculado: dict[str, Any] | None = None) -> str:
    """El mapa en castellano, para el prompt del bucle y la pantalla: qué es
    (con cada eje definido en una frase la primera vez), las celdas hasta el
    máximo pedido con sus hechos, hipótesis y certeza máxima, los huecos de la
    misión y lo que no se pudo situar. Sin modelos, sin puntuaciones inventadas.
    Si quien llama ya tiene el resultado de `mapa` lo pasa en `precalculado` y
    no se vuelve a recorrer el estado (unos 270 ms con 800 hechos)."""
    m = precalculado if isinstance(precalculado, dict) and "celdas" in precalculado else mapa(e, investigacion_id)
    try:
        maximo = max(1, int(maximo))
    except (TypeError, ValueError):
        maximo = 12
    # Un mapa guardado por una versión anterior de este módulo puede no traer
    # alguna clave: se lee con valores por defecto, nunca rompe.
    celdas = [c for c in _lista(m.get("celdas")) if isinstance(c, dict)]
    huecos = [h for h in _lista(m.get("huecos")) if isinstance(h, dict)]
    sin_ejes = _entero(m.get("sinEjes"))
    hip_sin_ejes = _entero(m.get("hipotesisSinEjes"))
    lineas = [
        "Mapa del estado de la enfermedad (dónde está la evidencia reunida por estadio, la fase clínica del Alzheimer; región cerebral o compartimento; tipo celular; y nivel: molecular, celular, tisular o clínico). Se construye por regla a partir de la misión, la tarjeta de cada hipótesis, las entidades canónicas y el texto; la certeza es la mayor certeza GRADE de las hipótesis de cada celda; las cohortes de una celda son las que nombran las afirmaciones de sus hechos e hipótesis (o la fuente de su procedencia: su campo cohorte, su método canónico, su registro NCT o lo que el catálogo lee en su título y su texto), agrupadas por el catálogo de cohortes.",
        str(m.get("resumen") or "Sin resumen guardado."),
    ]
    if celdas:
        lineas.append(f"Celdas ({min(maximo, len(celdas))} de {len(celdas)}, de más a menos poblada):")
        for c in celdas[:maximo]:
            hechos_c, hip_c, preguntas_c = _lista(c.get("hechos")), _lista(c.get("hipotesis")), _lista(c.get("preguntas"))
            partes = [_n(len(hechos_c), "hecho", "hechos"), _n(len(hip_c), "hipótesis", "hipótesis")]
            if preguntas_c:
                partes.append(_n(len(preguntas_c), "pregunta abierta", "preguntas abiertas"))
            certeza_max = c.get("certezaMax")
            certeza = f"certeza máxima {str(certeza_max).replace('_', ' ')}" if isinstance(certeza_max, str) and certeza_max in NIVELES_GRADE else "sin conclusión GRADE todavía"
            cohortes = [str(x) for x in _lista(c.get("cohortes"))]
            extra = f"; cohortes: {', '.join(cohortes[:3])}" if cohortes else ""
            por_mision = _entero(c.get("porMision"))
            mision = f"; {_n(por_mision, 'situado', 'situados')} en algún eje solo por la misión" if por_mision else ""
            lineas.append(f"- {etiqueta('estadio', c.get('estadio'))} · {etiqueta('region', c.get('region'))} · {etiqueta('tipoCelular', c.get('tipoCelular'))}: {', '.join(partes)} ({certeza}{extra}{mision}).")
    por_region = {str(k): _entero(v) for k, v in _dic(m.get("cohortesPorRegion")).items() if _entero(v) > 0}
    if por_region:
        pares = sorted(por_region.items(), key=lambda kv: (-kv[1], kv[0]))[:maximo]
        lineas.append("Cohortes distintas por región (una cohorte nombrada por varios registros cuenta una vez): " + ", ".join(f"{etiqueta('region', k)} {v}" for k, v in pares) + ".")
    if huecos:
        lineas.append("Huecos (combinaciones que la misión nombra y ningún hecho ni hipótesis cubre por su propio contenido):")
        for h in huecos[:maximo]:
            heredan = _entero(h.get("heredanDeMision"))
            lineas.append(f"- {_describir_combo((h.get('estadio'), h.get('region'), h.get('tipoCelular')))}" + (f" ({_n(heredan, 'registro lo hereda', 'registros lo heredan')} solo de la misión)" if heredan else "") + ".")
    if sin_ejes or hip_sin_ejes:
        lineas.append(f"Sin situar (ni estadio, ni región, ni tipo celular en su propio contenido): {_n(sin_ejes, 'hecho', 'hechos')} y {_n(hip_sin_ejes, 'hipótesis', 'hipótesis')}.")
    return "\n".join(lineas)


def _entero(x: Any) -> int:
    """Un entero no negativo a partir de lo que traiga un mapa guardado (0 si no es un número)."""
    try:
        return max(0, int(x)) if not isinstance(x, bool) else 0
    except (TypeError, ValueError):
        return 0
