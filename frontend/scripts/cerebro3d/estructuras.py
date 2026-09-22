# -*- coding: utf-8 -*-
"""Tabla de estructuras del atlas 3D de ROSA2018.

Cada entrada dice qué conceptos de BodyParts3D componen la estructura, con qué
clave la publica ROSA2018, cómo se llama en castellano y a cuántos triángulos se
simplifica. Los conceptos son nombres literales del fichero
``isa_element_parts.txt`` de BodyParts3D 4.0 (columna "name").

Las claves van en snake_case y sin tildes porque viajan al servidor y al DOM;
los nombres llevan sus tildes porque se pintan en pantalla.
"""

# (clave, nombre, [conceptos de BodyParts3D], triángulos objetivo, nota)
ESTRUCTURAS = [
    (
        "corteza_prefrontal",
        "Corteza prefrontal",
        [
            "superior frontal gyrus",
            "middle frontal gyrus",
            "inferior frontal gyrus",
            "orbital gyrus",
        ],
        24000,
        "Giros frontal superior, frontal medio, frontal inferior y orbitario "
        "de los dos hemisferios. No incluye el giro precentral, que va aparte.",
    ),
    (
        "corteza_sensitivomotora",
        "Corteza sensitivomotora",
        ["precentral gyrus", "postcentral gyrus"],
        15000,
        "Giro precentral (motor primario) y giro postcentral (somatosensorial "
        "primario). Clave propia de ROSA2018: no estaba en la lista de partida.",
    ),
    (
        "corteza_parietal",
        "Corteza parietal",
        [
            "supramarginal gyrus",
            "angular gyrus",
            "superior parietal lobule",
        ],
        20000,
        "Giro supramarginal, giro angular y lobulillo parietal superior. El "
        "precúneo no viene separado en BodyParts3D: queda dentro del lobulillo "
        "parietal superior, o sea dentro de esta malla.",
    ),
    (
        "corteza_temporal",
        "Corteza temporal",
        [
            "anterior part of superior temporal gyrus",
            "posterior part of superior temporal gyrus",
            "middle temporal gyrus",
            "inferior temporal gyrus",
            "fusiform gyrus",
        ],
        20000,
        "Giros temporal superior (partes anterior y posterior), temporal medio, "
        "temporal inferior y fusiforme.",
    ),
    (
        "corteza_occipital",
        "Corteza occipital",
        ["occipital lobe"],
        9000,
        "Lóbulo occipital entero. BodyParts3D no separa cuña, giro lingual ni "
        "polo occipital.",
    ),
    (
        "cingulo_precuneo",
        "Giro del cíngulo",
        ["cingulate gyrus"],
        5000,
        "Solo el giro del cíngulo. El precúneo no está segmentado en esta "
        "fuente y cae dentro de corteza_parietal.",
    ),
    (
        "insula",
        "Ínsula",
        ["insula"],
        5000,
        "Lóbulo de la ínsula de los dos hemisferios. Clave propia de ROSA2018.",
    ),
    (
        "hipocampo",
        "Hipocampo",
        ["hippocampus"],
        6000,
        "Hipocampo derecho e izquierdo.",
    ),
    (
        "amigdala",
        "Amígdala",
        ["amygdala"],
        6000,
        "Complejo amigdalino derecho e izquierdo.",
    ),
    (
        "corteza_entorrinal",
        "Giro parahipocampal (contiene la corteza entorrinal)",
        ["parahippocampal gyrus"],
        6000,
        "BodyParts3D no separa la corteza entorrinal. La corteza entorrinal "
        "ocupa la parte anterior del giro parahipocampal, que es esta malla; "
        "por eso la publicamos con la clave corteza_entorrinal y con el nombre "
        "que dice la verdad en pantalla.",
    ),
    (
        "ganglios_basales_talamo",
        "Ganglios basales y tálamo",
        ["thalamus", "caudate nucleus", "putamen", "globus pallidus"],
        18000,
        "Tálamo, núcleo caudado, putamen y globo pálido de los dos hemisferios. "
        "El núcleo accumbens y el claustro no vienen separados en esta fuente.",
    ),
    (
        "sustancia_blanca",
        "Sustancia blanca cerebral",
        ["cerebral white matter", "internal capsule"],
        22000,
        "Sustancia blanca de los dos hemisferios más la cápsula interna. El "
        "cuerpo calloso va en su propia malla.",
    ),
    (
        "cuerpo_calloso",
        "Cuerpo calloso",
        ["corpus callosum", "fornix of forebrain"],
        12000,
        "Cuerpo calloso y fórnix. Clave propia de ROSA2018.",
    ),
    (
        "lcr",
        "Ventrículos (líquido cefalorraquídeo)",
        [
            "lateral ventricle",
            "third ventricle",
            "fourth ventricle",
            "cerebral aqueduct",
        ],
        16000,
        "Ventrículos laterales, tercer ventrículo, acueducto de Silvio y cuarto "
        "ventrículo. Es el molde del LCR intraventricular, no el espacio "
        "subaracnoideo.",
    ),
    (
        "tronco_locus_coeruleus",
        "Tronco del encéfalo",
        ["midbrain", "pons", "medulla oblongata"],
        18000,
        "Mesencéfalo, protuberancia y bulbo raquídeo. El locus coeruleus no "
        "está segmentado en esta fuente: queda dentro de la protuberancia.",
    ),
    (
        "cerebelo",
        "Cerebelo",
        ["cerebellum"],
        22000,
        "Cerebelo entero, con sus dos hemisferios.",
    ),
    (
        "vascular_bhe",
        "Arterias cerebrales",
        [
            "anterior cerebral artery",
            "zone of middle cerebral artery",
            "zone of posterior cerebral artery",
            "basilar artery",
            "vertebral artery",
        ],
        14000,
        "Arterias cerebrales anterior, media y posterior, arteria basilar y "
        "arterias vertebrales. Es el árbol arterial, no la barrera "
        "hematoencefálica, que no es una superficie que se pueda dibujar.",
    ),
]

# El árbol arterial de BodyParts3D baja por el cuello: las arterias vertebrales
# llegan hasta la primera vértebra. Si se dejaran enteras, la caja envolvente del
# conjunto pasaría de 180 a 232 mm y el cerebro quedaría descentrado. Por eso el
# guion corta esta malla por el plano horizontal donde termina el tronco del
# encéfalo, que es el suelo anatómico del atlas.
CORTE_INFERIOR = {"vascular_bhe": "tronco_locus_coeruleus"}

# Estructuras que ROSA2018 pide y esta fuente no tiene. Se documentan para no
# dar por hecho que faltan por descuido.
AUSENTES = {
    "bulbo_olfatorio": "BodyParts3D 4.0 no segmenta el bulbo olfatorio.",
}
