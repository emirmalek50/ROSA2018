"""Pone tildes a los textos visibles del frontend sin tocar el codigo.

Solo actua sobre: texto JSX entre etiquetas (sin llaves), los atributos de
texto (titulo, nota, placeholder, aria-label, title, etiqueta, label, texto,
explicacion, definicion, pista) y los valores (no las claves) de etiquetas.ts
y glosario.ts. Nunca toca identificadores, claves, rutas ni nombres de clase.
Diccionario cerrado de palabras con acento inequivoco; las ambiguas (esta,
como, que, si, solo, aun) se dejan como estan.
"""

import re
import sys
from pathlib import Path

PALABRAS = {
    # Séptima tanda (29 de septiembre de 2026): huecos que salieron al auditar el
    # diccionario contra el vocabulario del proyecto. "métrica" estaba y "métrico"
    # no, y "deriva analítica entre lotes" (el artefacto que más sale en el grafo
    # causal de la muestra) se quedaba sin tilde en las dos palabras.
    "irian": "irían", "iria": "iría", "irias": "irías", "analitica": "analítica", "analiticas": "analíticas", "analitico": "analítico", "analiticos": "analíticos",
    "metrico": "métrico", "metricos": "métricos", "serologico": "serológico", "serologica": "serológica",
    "topologico": "topológico", "topologica": "topológica", "toxicologico": "toxicológico", "toxicologica": "toxicológica",
    "busquedas": "búsquedas", "consulto": "consultó", "retomo": "retomó",
    # Cuarta tanda: verbos de los eventos del backend
    "alcanzo": "alcanzó", "altero": "alteró", "devolvio": "devolvió", "reintento": "reintentó", "reparo": "reparó", "congelo": "congeló", "comprobo": "comprobó", "autorizo": "autorizó", "denego": "denegó",
    # Tercera tanda (14 de septiembre): verbos en pasado y futuro sin forma ambigua, adverbios, -sion, vocabulario biomedico
    "crecio": "creció", "perdio": "perdió", "gano": "ganó", "salio": "salió", "aprobo": "aprobó", "recargo": "recargó",
    # Cuarta tanda (18 de septiembre): pretéritos en -ió sin forma ambigua que se habían escapado ("no escribio el resumen")
    "escribio": "escribió", "recibio": "recibió", "decidio": "decidió", "subio": "subió", "pidio": "pidió", "aparecio": "apareció",
    "cumplio": "cumplió", "respondio": "respondió", "corrigio": "corrigió", "encontro": "encontró", "empezo": "empezó", "resolvio": "resolvió",
    "midio": "midió", "eligio": "eligió", "consiguio": "consiguió", "anadio": "añadió", "sugirio": "sugirió", "advirtio": "advirtió",
    "ocurrio": "ocurrió", "surgio": "surgió",
    "actualizo": "actualizó", "detecto": "detectó", "verifico": "verificó", "abrio": "abrió", "leyo": "leyó", "agoto": "agotó",
    "ejecuto": "ejecutó", "estaran": "estarán", "tendran": "tendrán", "podran": "podrán", "haran": "harán", "veran": "verán",
    "daran": "darán", "aparecera": "aparecerá", "vendra": "vendrá", "saldra": "saldrá", "llegara": "llegará", "seguira": "seguirá",
    "pedira": "pedirá", "abrira": "abrirá", "empezara": "empezará", "esperara": "esperará", "recibira": "recibirá", "reanudara": "reanudará",
    "parara": "parará", "quiza": "quizá", "ojala": "ojalá", "dificilmente": "difícilmente", "clinicamente": "clínicamente", "tipicamente": "típicamente",
    "fisiologico": "fisiológico", "fisiologica": "fisiológica", "inmunologico": "inmunológico", "inmunologica": "inmunológica", "histologico": "histológico", "metodologico": "metodológico",
    "metodologica": "metodológica", "epidemiologico": "epidemiológico", "epidemiologica": "epidemiológica", "radiologico": "radiológico", "radiologica": "radiológica", "tecnologico": "tecnológico",
    "tecnologica": "tecnológica", "psicologico": "psicológico", "ontologico": "ontológico", "etiologico": "etiológico", "etiologia": "etiología", "sintomatico": "sintomático",
    "sintomatica": "sintomática", "asintomatico": "asintomático", "asintomatica": "asintomática", "traumatico": "traumático", "genomicas": "genómicas", "genomicos": "genómicos",
    "transcriptomica": "transcriptómica", "metabolomica": "metabolómica", "proteomicas": "proteómicas", "reido": "reído", "traida": "traída", "traidos": "traídos",
    "traidas": "traídas", "reunion": "reunión", "cancion": "canción", "razon": "razón", "corazon": "corazón", "patron": "patrón",
    "expansion": "expansión", "suspension": "suspensión", "concision": "concisión", "ocasion": "ocasión", "invasion": "invasión", "evasion": "evasión",
    "colision": "colisión", "inmersion": "inmersión", "excursion": "excursión", "propulsion": "propulsión", "expulsion": "expulsión", "mansion": "mansión",
    "ascension": "ascensión", "aprension": "aprensión", "persuasion": "persuasión", "disuasion": "disuasión", "cesion": "cesión", "escision": "escisión",
    "incision": "incisión", "adaptacion": "adaptación", "mayusculas": "mayúsculas", "mayuscula": "mayúscula", "minusculas": "minúsculas", "minuscula": "minúscula",
    "nitrogeno": "nitrógeno", "fosforo": "fósforo", "hematies": "hematíes", "macrofago": "macrófago", "macrofagos": "macrófagos", "axon": "axón",
    "nucleotido": "nucleótido", "nucleotidos": "nucleótidos", "aminoacido": "aminoácido", "aminoacidos": "aminoácidos", "peptido": "péptido", "peptidos": "péptidos",
    "lipido": "lípido", "lipidos": "lípidos", "glucidos": "glúcidos", "cation": "catión", "anion": "anión", "proton": "protón",
    "electron": "electrón", "neutron": "neutrón", "atomo": "átomo", "atomos": "átomos", "antigeno": "antígeno", "antigenos": "antígenos",
    "organulo": "orgánulo", "organulos": "orgánulos", "organo": "órgano", "organos": "órganos", "higado": "hígado", "rinon": "riñón",
    "rinones": "riñones", "pulmon": "pulmón", "estomago": "estómago", "pancreas": "páncreas", "medula": "médula", "hipofisis": "hipófisis",
    "linfatico": "linfático", "linfatica": "linfática", "oseo": "óseo", "osea": "ósea", "oseos": "óseos", "oseas": "óseas",
    "cardiaca": "cardíaca", "cutaneo": "cutáneo", "cutanea": "cutánea", "autonomo": "autónomo", "autonoma": "autónoma", "simpatico": "simpático",
    "parasimpatico": "parasimpático", "talamo": "tálamo", "hipotalamo": "hipotálamo", "amigdala": "amígdala", "mesencefalo": "mesencéfalo", "diencefalo": "diencéfalo",
    "telencefalo": "telencéfalo", "lobulo": "lóbulo", "lobulos": "lóbulos", "ventriculo": "ventrículo", "ventriculos": "ventrículos", "liquor": "licor",
    "cefalorraquideos": "cefalorraquídeos", "raquideo": "raquídeo", "craneo": "cráneo", "vertebra": "vértebra", "vertebras": "vértebras", "femur": "fémur",
    "perone": "peroné", "humero": "húmero", "cubito": "cúbito", "clavicula": "clavícula", "escapula": "escápula", "esternon": "esternón",
    "musculos": "músculos", "tendon": "tendón", "cartilago": "cartílago", "articulacion": "articulación",
    # Segunda tanda (14 de septiembre): lo que quedaba tras revisar cada palabra visible con un diccionario de frecuencias
    "afirmacion": "afirmación", "ningun": "ningún", "busqueda": "búsqueda", "arbol": "árbol", "arboles": "árboles", "catalogo": "catálogo",
    "catalogos": "catálogos", "inhibicion": "inhibición", "preocupacion": "preocupación", "inflamacion": "inflamación", "neuroinflamacion": "neuroinflamación", "anticipacion": "anticipación",
    "propagacion": "propagación", "alteracion": "alteración", "monografia": "monografía", "monografias": "monografías", "boton": "botón", "metrica": "métrica",
    "metricas": "métricas", "validacion": "validación", "compilacion": "compilación", "exito": "éxito", "demas": "demás", "union": "unión",
    "sanguineo": "sanguíneo", "sanguinea": "sanguínea", "liquido": "líquido", "liquidos": "líquidos", "cefalorraquideo": "cefalorraquídeo", "metabolico": "metabólico",
    "metabolica": "metabólica", "metabolicos": "metabólicos", "metabolicas": "metabólicas", "algun": "algún", "ingenieria": "ingeniería", "clausula": "cláusula",
    "clausulas": "cláusulas", "fraccion": "fracción", "redaccion": "redacción", "compensacion": "compensación", "liberacion": "liberación", "formacion": "formación",
    "caida": "caída", "caidas": "caídas", "periferica": "periférica", "periferico": "periférico", "perifericos": "periféricos", "perifericas": "periféricas",
    "hepatica": "hepática", "hepatico": "hepático", "correlacion": "correlación", "discusion": "discusión", "legitima": "legítima", "legitimo": "legítimo",
    "implicitamente": "implícitamente", "modulacion": "modulación", "toxica": "tóxica", "toxico": "tóxico", "presion": "presión", "vacunacion": "vacunación",
    "periodo": "período", "periodos": "períodos", "farmacologica": "farmacológica", "farmacologico": "farmacológico", "item": "ítem", "items": "ítems",
    "demostracion": "demostración", "restriccion": "restricción", "contemporaneo": "contemporáneo", "contemporanea": "contemporánea", "autorizacion": "autorización", "estimacion": "estimación",
    "recuperacion": "recuperación", "regulacion": "regulación", "comite": "comité", "duracion": "duración", "raton": "ratón", "parafrasis": "paráfrasis",
    "alli": "allí", "comun": "común", "computo": "cómputo", "ambar": "ámbar", "cientificamente": "científicamente", "friccion": "fricción",
    "preclinico": "preclínico", "preclinica": "preclínica", "preclinicos": "preclínicos", "preclinicas": "preclínicas", "autosomico": "autosómico", "autosomica": "autosómica",
    "autosomicos": "autosómicos", "autosomicas": "autosómicas", "mecanistica": "mecanística", "mecanistico": "mecanístico", "mecanisticas": "mecanísticas", "mecanisticos": "mecanísticos",
    "tauopatias": "tauopatías", "tauopatia": "tauopatía", "hiperfosforilacion": "hiperfosforilación", "sinaptica": "sináptica", "sinaptico": "sináptico", "sinapticas": "sinápticas",
    "sinapticos": "sinápticos", "proteomica": "proteómica", "genomica": "genómica", "multiomica": "multiómica", "omicos": "ómicos", "omicas": "ómicas",
    "lipidico": "lipídico", "lipidica": "lipídica", "lipidicos": "lipídicos", "lipidicas": "lipídicas", "sinergica": "sinérgica", "sinergico": "sinérgico",
    "hematoencefalica": "hematoencefálica", "multietnica": "multiétnica", "genericas": "genéricas", "genericos": "genéricos", "generica": "genérica", "generico": "genérico",
    "latinoamerica": "Latinoamérica", "sobreafirmacion": "sobreafirmación", "secuenciacion": "secuenciación", "optimizacion": "optimización", "estadisticamente": "estadísticamente", "metaanalisis": "metaanálisis",
    "estandar": "estándar", "lider": "líder", "modulos": "módulos", "modulo": "módulo", "astrocitica": "astrocítica", "glia": "glía",
    "microglia": "microglía", "astroglia": "astroglía", "dinamicas": "dinámicas", "dinamicos": "dinámicos", "electrica": "eléctrica", "fisicos": "físicos",
    "biologicas": "biológicas", "biologicos": "biológicos", "fisiologia": "fisiología", "inmunologia": "inmunología", "histologia": "histología", "terminologia": "terminología",
    "teorias": "teorías", "comprobaria": "comprobaría", "refutaria": "refutaría", "frenaria": "frenaría", "daria": "daría", "confirmaria": "confirmaría",
    "romperia": "rompería", "explicaria": "explicaría", "aportaria": "aportaría", "anticiparia": "anticiparía", "subiria": "subiría", "bajaria": "bajaría",
    "importaria": "importaría", "tendria": "tendría", "podria": "podría", "podrian": "podrían", "fallaria": "fallaría", "ensenaria": "enseñaría",
    "propondria": "propondría", "habria": "habría", "veria": "vería", "habia": "había", "habian": "habían", "queria": "quería",
    "deberia": "debería", "deberian": "deberían", "serian": "serían", "seria": "sería", "tendrian": "tendrían", "haria": "haría",
    "harian": "harían", "estaria": "estaría", "estarian": "estarían", "llegaria": "llegaría", "cambiaria": "cambiaría", "quedaria": "quedaría",
    "tenia": "tenía", "tenian": "tenían", "venia": "venía", "sabia": "sabía", "sabian": "sabían", "decia": "decía",
    "salia": "salía", "rapidos": "rápidos", "rapidas": "rápidas", "faciles": "fáciles", "dificiles": "difíciles", "pag": "pág",
    "sintactica": "sintáctica", "toxicos": "tóxicos", "toxicas": "tóxicas", "axonico": "axónico", "glucido": "glúcido", "nucleo": "núcleo",
    "nucleos": "núcleos", "deposito": "depósito", "depositos": "depósitos", "indices": "índices", "enfasis": "énfasis", "maximas": "máximas",
    "minimas": "mínimas", "optimo": "óptimo", "optima": "óptima", "proximos": "próximos", "proximas": "próximas", "tipico": "típico",
    "tipica": "típica", "identicos": "idénticos", "identicas": "idénticas", "organico": "orgánico", "inorganico": "inorgánico", "sistemico": "sistémico",
    "sistemica": "sistémica", "quimicos": "químicos", "quimicas": "químicas", "graficos": "gráficos", "graficas": "gráficas", "especifico": "específico",
    "angulo": "ángulo", "angulos": "ángulos", "rotulo": "rótulo", "capitulos": "capítulos", "vehiculo": "vehículo", "calculos": "cálculos",
    "recalculo": "recálculo", "supero": "superó", "tolero": "toleró", "medico": "médico", "vinculo": "vínculo", "validas": "válidas",
    "calculo": "cálculo", "perdida": "pérdida", "perdidas": "pérdidas", "auditoria": "auditoría", "auditorias": "auditorías", "termino": "término",
    "terminos": "términos",
    # Palabras con ñ (14 de septiembre, segunda pasada)
    "pestana": "pestaña", "pestanas": "pestañas", "senala": "señala", "senalan": "señalan", "senalar": "señalar", "senalado": "señalado",
    "senalada": "señalada", "senalados": "señalados", "senaladas": "señaladas", "ensenado": "enseñado", "ensenada": "enseñada", "ensene": "enseñe",
    "anadiendo": "añadiendo", "anadio": "añadió", "anadiste": "añadiste", "anadimos": "añadimos", "anaden": "añaden", "anadira": "añadirá",
    "anadirlo": "añadirlo", "anadirla": "añadirla", "resena": "reseña", "resenas": "reseñas", "contrasena": "contraseña", "contrasenas": "contraseñas",
    "manana": "mañana", "companera": "compañera", "companeros": "compañeros", "companeras": "compañeras", "disenar": "diseñar", "disenado": "diseñado",
    "disenada": "diseñada", "disenados": "diseñados", "disenadas": "diseñadas", "extrano": "extraño", "extrana": "extraña", "extranos": "extraños",
    "extranas": "extrañas", "engano": "engaño", "enganoso": "engañoso", "enganosa": "engañosa", "enganosos": "engañosos", "enganosas": "engañosas",
    "dueno": "dueño", "duena": "dueña", "nino": "niño", "ninos": "niños", "nina": "niña", "ninas": "niñas",
    "sueno": "sueño", "cumpleanos": "cumpleaños", "otono": "otoño", "danado": "dañado", "danada": "dañada", "danar": "dañar",
    "punado": "puñado", "tamanos": "tamaños", "pequenez": "pequeñez", "ensenanza": "enseñanza", "antano": "antaño", "desempeno": "desempeño",
    "empeno": "empeño", "panuelo": "pañuelo",
    # -cion / -sion
    "hipotesis": "hipótesis", "investigacion": "investigación", "iteracion": "iteración", "decision": "decisión", "revision": "revisión",
    "verificacion": "verificación", "extraccion": "extracción", "comprobacion": "comprobación", "informacion": "información", "poblacion": "población",
    "intervencion": "intervención", "prediccion": "predicción", "reproduccion": "reproducción", "clasificacion": "clasificación", "evaluacion": "evaluación",
    "atencion": "atención", "seccion": "sección", "opcion": "opción", "configuracion": "configuración", "generacion": "generación", "replicacion": "replicación",
    "relacion": "relación", "publicacion": "publicación", "situacion": "situación", "condicion": "condición", "direccion": "dirección", "explicacion": "explicación",
    "descripcion": "descripción", "funcion": "función", "version": "versión", "precision": "precisión", "aprobacion": "aprobación", "ejecucion": "ejecución",
    "calibracion": "calibración", "aclaracion": "aclaración", "reformulacion": "reformulación", "retractacion": "retractación", "mision": "misión",
    "conclusion": "conclusión", "exclusion": "exclusión", "inclusion": "inclusión", "fusion": "fusión", "expresion": "expresión", "vision": "visión",
    "division": "división", "conexion": "conexión", "dimension": "dimensión", "cuestion": "cuestión", "gestion": "gestión", "extension": "extensión",
    "sesion": "sesión", "region": "región", "opinion": "opinión", "atribucion": "atribución", "transcripcion": "transcripción", "interpretacion": "interpretación",
    "refutacion": "refutación", "confirmacion": "confirmación", "formulacion": "formulación", "priorizacion": "priorización", "normalizacion": "normalización",
    "agregacion": "agregación", "simulacion": "simulación", "migracion": "migración", "sincronizacion": "sincronización", "integracion": "integración",
    "notificacion": "notificación", "resolucion": "resolución", "distribucion": "distribución", "evolucion": "evolución", "proporcion": "proporción",
    "correccion": "corrección", "seleccion": "selección", "coleccion": "colección", "deteccion": "detección", "inyeccion": "inyección", "produccion": "producción",
    "reduccion": "reducción", "construccion": "construcción", "posicion": "posición", "disposicion": "disposición", "composicion": "composición",
    "exposicion": "exposición", "transicion": "transición", "edicion": "edición", "definicion": "definición", "medicion": "medición", "peticion": "petición",
    "repeticion": "repetición", "cognicion": "cognición", "mutacion": "mutación", "asociacion": "asociación", "variacion": "variación", "operacion": "operación",
    "aplicacion": "aplicación", "comunicacion": "comunicación", "ubicacion": "ubicación", "identificacion": "identificación", "certificacion": "certificación",
    "justificacion": "justificación", "especificacion": "especificación", "modificacion": "modificación", "calificacion": "calificación",
    "estratificacion": "estratificación", "cuantificacion": "cuantificación", "comparacion": "comparación", "preparacion": "preparación", "reparacion": "reparación",
    "separacion": "separación", "declaracion": "declaración", "colaboracion": "colaboración", "consideracion": "consideración", "exploracion": "exploración",
    "elaboracion": "elaboración", "valoracion": "valoración", "creacion": "creación", "negacion": "negación", "obligacion": "obligación", "navegacion": "navegación",
    "indicacion": "indicación", "conservacion": "conservación", "observacion": "observación", "activacion": "activación", "elevacion": "elevación",
    "atenuacion": "atenuación", "continuacion": "continuación", "actuacion": "actuación", "puntuacion": "puntuación", "ecuacion": "ecuación", "solucion": "solución",
    "contribucion": "contribución", "institucion": "institución", "sustitucion": "sustitución", "disminucion": "disminución", "senalizacion": "señalización",
    "deduplicacion": "deduplicación", "compactacion": "compactación", "presentacion": "presentación", "documentacion": "documentación", "recomendacion": "recomendación",
    "autenticacion": "autenticación", "asignacion": "asignación", "combinacion": "combinación", "eliminacion": "eliminación", "determinacion": "determinación",
    "coordinacion": "coordinación", "imaginacion": "imaginación", "inclinacion": "inclinación", "terminacion": "terminación", "contaminacion": "contaminación",
    "informacion": "información", "anotacion": "anotación", "interaccion": "interacción", "reaccion": "reacción", "accion": "acción", "traduccion": "traducción",
    "adopcion": "adopción", "excepcion": "excepción", "recepcion": "recepción", "percepcion": "percepción", "concepcion": "concepción", "descripcion": "descripción",
    "inscripcion": "inscripción", "suscripcion": "suscripción", "prescripcion": "prescripción", "conversion": "conversión", "inversion": "inversión",
    "progresion": "progresión", "regresion": "regresión", "agresion": "agresión", "depresion": "depresión", "supresion": "supresión", "compresion": "compresión",
    "impresion": "impresión", "admision": "admisión", "emision": "emisión", "omision": "omisión", "remision": "remisión", "transmision": "transmisión",
    "comision": "comisión", "tension": "tensión", "hipertension": "hipertensión", "pension": "pensión", "comprension": "comprensión", "aprehension": "aprehensión",
    "extension": "extensión", "pretension": "pretensión", "dispersion": "dispersión", "confusion": "confusión", "difusion": "difusión", "profusion": "profusión",
    "ilusion": "ilusión", "colusion": "colusión", "alusion": "alusión", "erosion": "erosión", "explosion": "explosión", "corrosion": "corrosión",
    "lesion": "lesión", "adhesion": "adhesión", "cohesion": "cohesión", "revision": "revisión", "supervision": "supervisión", "prevision": "previsión",
    "provision": "provisión", "television": "televisión", "concesion": "concesión", "sucesion": "sucesión", "posesion": "posesión", "recesion": "recesión",
    "obsesion": "obsesión", "profesion": "profesión", "confesion": "confesión", "expresion": "expresión", "represion": "represión",
    # esdrujulas y otras
    "analisis": "análisis", "sintesis": "síntesis", "tecnico": "técnico", "tecnica": "técnica", "tecnicos": "técnicos", "tecnicas": "técnicas",
    "clinico": "clínico", "clinica": "clínica", "clinicos": "clínicos", "clinicas": "clínicas", "medica": "médica", "medicos": "médicos", "medicas": "médicas",
    "cientifico": "científico", "cientifica": "científica", "cientificos": "científicos", "cientificas": "científicas", "estadistico": "estadístico",
    "estadistica": "estadística", "estadisticos": "estadísticos", "estadisticas": "estadísticas", "biologico": "biológico", "biologica": "biológica",
    "genetica": "genética", "genetico": "genético", "geneticos": "genéticos", "geneticas": "genéticas", "plasmatico": "plasmático", "plasmatica": "plasmática",
    "plasmaticos": "plasmáticos", "plasmaticas": "plasmáticas", "publica": "pública", "publicos": "públicos", "publicas": "públicas",
    "unico": "único", "unica": "única", "unicos": "únicos", "unicas": "únicas", "ultimo": "último", "ultima": "última", "ultimos": "últimos", "ultimas": "últimas",
    "numero": "número", "numeros": "números", "numerico": "numérico", "numerica": "numérica", "codigo": "código", "codigos": "códigos", "metodo": "método", "metodos": "métodos",
    "minimo": "mínimo", "minima": "mínima", "minimos": "mínimos", "maximo": "máximo", "maxima": "máxima", "maximos": "máximos", "automatico": "automático",
    "automatica": "automática", "automaticos": "automáticos", "automaticas": "automáticas", "valida": "válida", "validos": "válidos",
    "rapida": "rápida", "rapido": "rápido", "dificil": "difícil", "facil": "fácil", "aqui": "aquí", "asi": "así", "mas": "más", "tambien": "también",
    "despues": "después", "segun": "según", "pagina": "página", "paginas": "páginas", "dia": "día", "dias": "días", "todavia": "todavía", "categoria": "categoría",
    "categorias": "categorías", "articulo": "artículo", "articulos": "artículos", "especifica": "específica", "especificos": "específicos",
    "especificas": "específicas", "farmaco": "fármaco", "farmacos": "fármacos", "celula": "célula", "celulas": "células", "molecula": "molécula", "moleculas": "moléculas",
    "proteina": "proteína", "proteinas": "proteínas", "ademas": "además", "area": "área", "areas": "áreas", "campana": "campaña", "campanas": "campañas",
    "anadir": "añadir", "anade": "añade", "anadido": "añadido", "anadida": "añadida", "anadidos": "añadidos", "anadidas": "añadidas", "ensena": "enseña", "ensenan": "enseñan",
    "ensenar": "enseñar", "pequeno": "pequeño", "pequena": "pequeña", "pequenos": "pequeños", "pequenas": "pequeñas", "tamano": "tamaño", "ano": "año", "anos": "años",
    "diseno": "diseño", "disenos": "diseños", "senal": "señal", "senales": "señales", "dano": "daño", "danos": "daños", "companero": "compañero", "espanol": "español",
    "cronologico": "cronológico", "cronologica": "cronológica", "historico": "histórico", "historica": "histórica", "indice": "índice", "limite": "límite",
    "limites": "límites", "practica": "práctica", "practico": "práctico", "grafico": "gráfico", "grafica": "gráfica", "critica": "crítica",
    "criticos": "críticos", "criticas": "críticas", "logica": "lógica", "logico": "lógico", "proximo": "próximo", "proxima": "próxima", "linea": "línea", "lineas": "líneas",
    "medicion": "medición", "epoca": "época", "capitulo": "capítulo", "titulo": "título", "titulos": "títulos", "musculo": "músculo", "energia": "energía",
    "teoria": "teoría", "memoria": "memoria", "mecanico": "mecánico", "quimico": "químico", "quimica": "química", "fisico": "físico", "fisica": "física",
    "matematico": "matemático", "matematica": "matemática", "electronico": "electrónico", "electronica": "electrónica", "cronico": "crónico", "cronica": "crónica",
    "sintoma": "síntoma", "sintomas": "síntomas", "diagnostico": "diagnóstico", "diagnostica": "diagnóstica", "pronostico": "pronóstico", "pronostica": "pronóstica",
    "terapeutico": "terapéutico", "terapeutica": "terapéutica", "terapeuticos": "terapéuticos", "terapeuticas": "terapéuticas", "patologico": "patológico",
    "patologica": "patológica", "neurologico": "neurológico", "neurologica": "neurológica", "cognitivo": "cognitivo", "amiloide": "amiloide", "vinculos": "vínculos",
    "parrafo": "párrafo", "parrafos": "párrafos", "sabado": "sábado", "miercoles": "miércoles", "credito": "crédito", "proposito": "propósito",
    "propositos": "propósitos", "hipotetico": "hipotético", "hipotetica": "hipotética", "sistematico": "sistemático", "sistematica": "sistemática",
    "sistematicas": "sistemáticas", "aleatorio": "aleatorio", "electrico": "eléctrico", "atomico": "atómico", "dinamico": "dinámico", "dinamica": "dinámica",
    "semantico": "semántico", "semantica": "semántica", "esporadico": "esporádico", "esporadica": "esporádica", "periodico": "periódico", "periodica": "periódica",
    "cardiaco": "cardíaco", "basico": "básico", "basica": "básica", "basicos": "básicos", "basicas": "básicas", "practicas": "prácticas", "practicos": "prácticos",
    "identico": "idéntico", "identica": "idéntica", "autentico": "auténtico", "autentica": "auténtica", "fantastico": "fantástico", "drastico": "drástico",
    "elastico": "elástico", "plastico": "plástico", "estatico": "estático", "estatica": "estática", "sintetico": "sintético", "sintetica": "sintética",
    "sinteticos": "sintéticos", "sinteticas": "sintéticas", "canonico": "canónico", "canonica": "canónica", "canonicos": "canónicos", "canonicas": "canónicas",
    "heuristico": "heurístico", "heuristica": "heurística", "determinista": "determinista", "empirico": "empírico", "empirica": "empírica",
    "bibliografico": "bibliográfico", "bibliografica": "bibliográfica", "biomedico": "biomédico", "biomedica": "biomédica", "academico": "académico",
    "academica": "académica", "economico": "económico", "economica": "económica", "politica": "política", "politicas": "políticas", "estrategico": "estratégico",
    "estrategica": "estratégica", "geografico": "geográfico", "electronicos": "electrónicos", "utiles": "útiles", "util": "útil", "inutil": "inútil", "debil": "débil",
    "debiles": "débiles", "fragil": "frágil", "fragiles": "frágiles", "estable": "estable", "movil": "móvil", "moviles": "móviles", "habil": "hábil",
    "facilmente": "fácilmente", "rapidamente": "rápidamente", "ultimamente": "últimamente", "unicamente": "únicamente", "automaticamente": "automáticamente",
    "tecnicamente": "técnicamente", "practicamente": "prácticamente", "basicamente": "básicamente", "especificamente": "específicamente",
    "explicitamente": "explícitamente", "explicito": "explícito", "explicita": "explícita", "implicito": "implícito", "implicita": "implícita",
    "podra": "podrá", "sera": "será", "seran": "serán", "habra": "habrá", "estara": "estará", "tendra": "tendrá", "hara": "hará", "dira": "dirá",
    "volvera": "volverá", "quedara": "quedará", "cambiara": "cambiará", "arrancara": "arrancará", "ira": "irá", "iran": "irán", "pondra": "pondrá", "dejara": "dejará",
    "empezo": "empezó", "propuso": "propuso", "encontro": "encontró", "decidio": "decidió", 
    "llego": "llegó", "quedo": "quedó", "volvio": "volvió", "corrio": "corrió", "recibio": "recibió", 
    "respondio": "respondió", "resolvio": "resolvió", "reformulo": "reformuló", "murio": "murió", "mostro": "mostró", "pidio": "pidió",
    "mientras": "mientras", "esta": "esta", "estan": "están", "estas": "estas", "esto": "esto",
    "biomarcador": "biomarcador", "electronico": "electrónico", "acido": "ácido", "acidos": "ácidos", "oxigeno": "oxígeno", "hidrogeno": "hidrógeno",
    "torax": "tórax", "cancer": "cáncer", "cerebro": "cerebro", "cranial": "cranial", "neuron": "neurón", "regimen": "régimen", "origen": "origen",
    "examen": "examen", "imagen": "imagen", "volumen": "volumen", "margen": "margen", "orden": "orden", "joven": "joven", "jovenes": "jóvenes", "examenes": "exámenes",
    "imagenes": "imágenes", "volumenes": "volúmenes", "margenes": "márgenes", "ordenes": "órdenes", "origenes": "orígenes", "regimenes": "regímenes",
    "caracter": "carácter", "caracteres": "caracteres", "cinetica": "cinética", "cinetico": "cinético",
    "dolares": "dólares", "dolar": "dólar", "porcentaje": "porcentaje", "parametro": "parámetro", "parametros": "parámetros", "topico": "tópico",
    "simbolo": "símbolo", "simbolos": "símbolos", "vertice": "vértice", "pelicula": "película", "peninsula": "península", "formula": "fórmula", "formulas": "fórmulas",
    "cupula": "cúpula", "molecular": "molecular", "cronologia": "cronología", "metodologia": "metodología", "tecnologia": "tecnología", "biologia": "biología",
    "genealogia": "genealogía", "patologia": "patología", "neurologia": "neurología", "epidemiologia": "epidemiología", "ontologia": "ontología",
    "ontologias": "ontologías", "farmacologia": "farmacología", "ecologia": "ecología", "teologia": "teología", "geologia": "geología", "tipologia": "tipología",
    "jerarquia": "jerarquía", "garantia": "garantía", "guia": "guía", "guias": "guías", "via": "vía", "vias": "vías", "compania": "compañía", "companias": "compañías",
    "mayoria": "mayoría", "minoria": "minoría", "autonomia": "autonomía", "economia": "economía", "anatomia": "anatomía", "autopsia": "autopsia",
    "policia": "policía", "cirugia": "cirugía", "alergia": "alergia", "energia": "energía", "sinergia": "sinergia", "estrategia": "estrategia",
    "todavia": "todavía", "frio": "frío", "rio": "río", "vacio": "vacío", "vacia": "vacía", "vacios": "vacíos", "vacias": "vacías", "raiz": "raíz", "raices": "raíces",
    "pais": "país", "paises": "países", "maiz": "maíz", "oido": "oído", "caido": "caído", "traido": "traído", "leido": "leído", "leidos": "leídos", "leida": "leída", "leidas": "leídas",
    "construido": "construido", "incluido": "incluido", "continuo": "continuo", "reune": "reúne", "reunen": "reúnen", "prohibe": "prohíbe", "prohibido": "prohibido",
    "ahi": "ahí", "baul": "baúl", "atras": "atrás", "detras": "detrás", "ademas": "además", "jamas": "jamás", "quizas": "quizás", "traves": "través",
    "veras": "verás", "sabras": "sabrás", "podras": "podrás", "tendras": "tendrás", "estaras": "estarás", "encontraras": "encontrarás",
    "interes": "interés", "intereses": "intereses", "frances": "francés", "ingles": "inglés", "japones": "japonés", "portugues": "portugués",
    "marques": "marqués", "despues": "después", "entremes": "entremés", "reves": "revés", "ademas": "además",
    "vesícula": "vesícula", "invalido": "inválido", "invalida": "inválida", "invalidos": "inválidos", "invalidas": "inválidas",
}
# El imperfecto de subjuntivo de los verbos en -ar es IDÉNTICO al futuro sin la
# tilde: "no hay ninguna afirmación que hoy dejara de estarlo" (subjuntivo, con
# antecedente negado) frente a "dejará"; "si el NfL cambiara antes que el GFAP, la
# hipótesis quedaría refutada" (condicional) frente a "cambiará". Las dos formas
# son correctas y significan cosas distintas, así que el guion NO las decide: las
# saca del diccionario y las lista con `--a-mano` para que las mire una persona.
# Es la regla de CLAUDE.md ("las palabras que cambian de sentido con la tilde se
# deciden a mano por contexto") escrita en el código que la incumplía.
SUBJUNTIVO_O_FUTURO = {"arrancara", "arrancaras", "arrancaran", "cambiara", "cambiaras", "cambiaran", "dejara", "dejaras", "dejaran", "empezara", "empezaras", "empezaran", "esperara", "esperaras", "esperaran", "llegara", "llegaras", "llegaran", "parara", "pararas", "pararan", "quedara", "quedaras", "quedaran", "reanudara", "reanudaran", "encontraras", "encontrara", "encontraran", "tomara", "tomaran", "usara", "usaran", "pasara", "pasaran", "bajara", "bajaran", "subiera", "mirara", "miraran", "acabara", "acabaran"}

AMBIGUAS_EXCLUIDAS = SUBJUNTIVO_O_FUTURO | {"reintento", "esta", "estas", "esto", "publica", "mientras", "memoria", "biomarcador", "cerebro", "cranial", "examen", "imagen", "volumen", "margen", "orden", "joven", "origen", "caracteres", "porcentaje", "molecular", "autopsia", "alergia", "sinergia", "estrategia", "construido", "incluido", "continuo", "prohibido", "intereses", "aleatorio", "amiloide", "cognitivo", "determinista", "estable", "propuso", "vesícula", "neuron"}
for k in AMBIGUAS_EXCLUIDAS:
    PALABRAS.pop(k, None)

PATRON = re.compile(r"\b(" + "|".join(sorted(map(re.escape, PALABRAS), key=len, reverse=True)) + r")\b", re.I)


def acentuar_texto(texto: str) -> str:
    def rep(m: re.Match) -> str:
        palabra = m.group(0)
        base = PALABRAS[palabra.lower()]
        if palabra.isupper():
            return base.upper()
        if palabra[0].isupper():
            return base[0].upper() + base[1:]
        return base

    # Un texto en ingles (titulos de articulos en los datos de muestra) no se
    # toca: "revision" o "decision" alli no llevan tilde.
    if _INGLES.search(texto) and not _CASTELLANO.search(texto):
        return texto
    texto = PATRON.sub(rep, texto)
    # Toda palabra castellana en -cion singular lleva tilde; el plural (-ciones)
    # no, y no hay palabras inglesas en -cion, asi que la regla es segura.
    texto = _CION.sub(lambda m: m.group(1) + "ción", texto)
    # Interrogativos: tras "¿" siempre llevan tilde; "Que" y "Como" al empezar
    # una cadena son casi siempre pregunta indirecta ("Que toca hacer",
    # "Como crecio") en la interfaz de Rosa.
    texto = _INTERROGATIVO.sub(lambda m: m.group(1) + INTERROGATIVOS[m.group(2).lower()] if m.group(2)[0].islower() else m.group(1) + INTERROGATIVOS[m.group(2).lower()].capitalize(), texto)
    # ... salvo cuando sigue un articulo, un demostrativo, una mayuscula o una
    # cifra: "Que el efecto sea independiente" es un "que" completivo.
    texto = re.sub(r"^(Que|Como)(?=\s+(?![A-Z0-9]|(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|eso|esto|aquel|aquella|lo|si)\b))", lambda m: "Qué" if m.group(1) == "Que" else "Cómo", texto)
    # esta/está: si le sigue un participio, un gerundio, un adverbio o una
    # preposicion de estado, es el verbo.
    texto = _ESTA.sub(lambda m: ("Está" if m.group(1)[0].isupper() else "está") + m.group(2), texto)
    # aun/aún: "aun asi" es la unica forma sin tilde que aparece en la interfaz.
    texto = re.sub(r"\b([Aa])un\b(?!\s+as[ií]\b)", lambda m: m.group(1) + "ún", texto)
    return texto


INTERROGATIVOS = {"que": "qué", "como": "cómo", "donde": "dónde", "cuando": "cuándo", "cual": "cuál", "cuales": "cuáles", "quien": "quién", "quienes": "quiénes", "cuanto": "cuánto", "cuanta": "cuánta", "cuantos": "cuántos", "cuantas": "cuántas"}
_INTERROGATIVO = re.compile(r"(¿\s*)(que|como|donde|cuando|cual|cuales|quien|quienes|cuanto|cuanta|cuantos|cuantas)\b", re.IGNORECASE)
_ESTA = re.compile(
    r"\b([Ee]sta)(\s+(?:"
    r"(?:bloquead|retractad|marcad|pausad|aprobad|sellad|congelad|conectad|desconectad|detenid|resuelt|ocupad|prohibid|publicad|registrad|verificad|comprobad|sostenid|refutad|descartad|aceptad|asignad|cerrad|abiert|agotad|alcanzad|cubiert|definid|fijad|calibrad|terminad|acabad|hech|dispuest|apagad|encendid|rot|escrit|previst|vist|dich|muert|descrit|contradich|list|activ|vac[ií]|llen|complet|viv)[oa]s?"
    r"|(?:pendiente|pendientes|disponible|disponibles|libre|libres|claro|clara|mejor|peor|igual|entre|bajo|sobre|encima|debajo|junto|justo|siempre|tan|en|por|a|de|para|con|sin|ya|aqu[ií]|ah[ií]|bien|mal|fuera|dentro|arriba|abajo|m[aá]s|muy|casi|todav[ií]a|a[uú]n|ahora|lejos|cerca|al)"
    r"|[a-záéíóúñ]+(?:ando|iendo|yendo)"
    r")\b)"
)


_CION = re.compile(r"\b([A-Za-z]{2,})cion\b")
_INGLES = re.compile(r"\b(the|of|and|with|for|from|into|between|among|versus|is|are|was|were|does|it)\b")
_CASTELLANO = re.compile(r"\b(el|la|los|las|de|del|que|y|en|con|para|por|una|un|se|es|al|lo|sin|como)\b")


ATRIBUTOS = ("titulo", "nota", "placeholder", "aria-label", "title", "etiqueta", "label", "texto", "explicacion", "definicion", "pista", "descripcion", "resumen", "sub")


def partir_llaves(texto: str) -> list[str]:
    """Separa texto y expresiones {...} contando la profundidad, para que una
    expresion con llaves dentro ({a ? {b} : c}) no rompa el reparto."""
    partes: list[str] = []
    actual = ""
    profundidad = 0
    for c in texto:
        if c == "{":
            if profundidad == 0:
                partes.append(actual)
                actual = ""
            profundidad += 1
            actual += c
        elif c == "}" and profundidad > 0:
            profundidad -= 1
            actual += c
            if profundidad == 0:
                partes.append(actual)
                actual = ""
        else:
            actual += c
    partes.append(actual)
    return partes


# Claves cuyo valor es un IDENTIFICADOR, no un texto que alguien lee: se compara
# con el servidor o se usa para buscar en un diccionario. CLAUDE.md lo dice:
# "los identificadores (variables, claves, clases CSS, rutas, valores que se
# comparan con el servidor) se quedan sin acento". Sin esta lista, el nodo
# 'B:funcion renal' del grafo causal salia acentuado en el id y sin acentuar en
# las aristas que lo nombran, y el grafo se partia en dos.
CLAVES_DE_IDENTIFICADOR = ("id", "de", "a", "clave", "capa", "rol", "tipo", "estado", "origen", "pasoId", "corridaId", "investigacionId", "hipotesisId", "fuenteId", "afirmacionId", "key", "slug", "ruta", "href")


def _es_valor_de_identificador(codigo: str, inicio: int) -> bool:
    """La cadena que empieza en `inicio` es el valor de una clave de identificador."""
    antes = codigo[max(0, inicio - 40) : inicio]
    return bool(re.search(r"(?<![.\w])\b(" + "|".join(CLAVES_DE_IDENTIFICADOR) + r")\s*:\s*$", antes))


def acentuar_tsx(codigo: str) -> str:
    # 1. Texto JSX entre etiquetas: solo tramos que son texto de verdad (en una
    #    linea, sin llaves ni signos de codigo: parentesis, igual, punto y coma,
    #    corchetes, flechas). Asi no se toca `=> b.numero - a.numero` ni tipos.
    #    Segunda version (14 de septiembre): el punto y coma, los parentesis y los
    #    dos puntos son puntuacion normal de una frase ("las ramas, los clusters;
    #    las hojas (GFAP, HGNC:4235)"), y un texto con expresiones {x} se acentua
    #    por tramos, fuera de las llaves. Siguen siendo marca de codigo el igual,
    #    la flecha, el acento grave, & y |, los corchetes, `palabra.palabra` y
    #    una anotacion de tipo (`nombre: Tipo`).
    def jsx(m: re.Match) -> str:
        t = m.group(1)
        if t.strip() == "":
            return m.group(0)
        partes = partir_llaves(t)
        textos = [x for x in partes if not x.startswith("{")]
        for x in textos:
            if re.search(r"[=`&|\[\]]|=>|\w\.\w", x) or re.search(r"\b\w+:\s*(?:string|number|boolean|null|undefined|[A-Z])", x):
                return m.group(0)
        return ">" + "".join(x if x.startswith("{") else acentuar_texto(x) for x in partes) + "<"

    codigo = re.sub(r">([^<>\n]+)<", jsx, codigo)
    #    JSX a varias lineas: una linea que empieza con texto y acaba en una
    #    etiqueta ("Como crecio: hasta la iteracion <strong>") o que sigue a una
    #    etiqueta hasta el final de la linea ("</strong> de {n}"). Mismas marcas
    #    de codigo; ademas la linea no puede ser una sentencia (return, const,
    #    import, export) ni contener un punto y coma final.

    def jsx_inicio(m: re.Match) -> str:
        t = m.group(2)
        if re.match(r"\s*(return|const|let|var|import|export|if|else|case|default|function|type|interface)\b", t) or not re.search(r"[A-Za-z]{3,}", t):
            return m.group(0)
        falso = jsx(re.match(r">([^<>\n]+)<", ">" + t + "<"))
        return m.group(1) + falso[1:-1] + "<"

    def jsx_final(m: re.Match) -> str:
        t = m.group(1)
        if not re.search(r"[A-Za-z]{3,}", t) or t.rstrip().endswith((";", ",", "{", "(", "=>", "&&", "||", "?", ":")):
            return m.group(0)
        falso = jsx(re.match(r">([^<>\n]+)<", ">" + t + "<"))
        return ">" + falso[1:-1]

    codigo = re.sub(r"^(\s+)([^<>\n{}][^<>\n]*)<", jsx_inicio, codigo, flags=re.MULTILINE)
    codigo = re.sub(r">([^<>\n]+)$", jsx_final, codigo, flags=re.MULTILINE)
    # 2. Atributos de texto con comillas dobles.
    def attr(m: re.Match) -> str:
        return f'{m.group(1)}="{acentuar_texto(m.group(2))}"'

    codigo = re.sub(r"\b(" + "|".join(ATRIBUTOS) + r')="([^"\n]*)"', attr, codigo)
    # 3. Atributos de texto con comillas simples dentro de objetos: etiqueta: '...', nota: '...'
    def prop(m: re.Match) -> str:
        # `m.group(2)` es el espaciado original alrededor de los dos puntos: hay que
        # devolverlo tal cual. Escribiendo ": " a pelo, un ternario
        # `x ? cifras.texto : \'\'` salia como `cifras.texto: \'\'`.
        return f"{m.group(1)}{m.group(2)}'{acentuar_texto(m.group(3))}'"

    # `(?<![.\w])` delante: `texto` es una clave de objeto, no el final de
    # `cifras.texto`. Sin esto, un acceso a propiedad se trataba como clave.
    codigo = re.sub(r"(?<![.\w])\b(" + "|".join(ATRIBUTOS) + r"|nombre|corto|frase)(\s*:\s*)'((?:[^'\\\n]|\\.)*)'", prop, codigo)
    # 4. Cadenas de texto largas (con espacio) entre comillas simples dentro de JSX o ternarios: solo si tienen al menos dos palabras y empiezan por mayuscula o por articulo.
    def cadena(m: re.Match) -> str:
        t = m.group(1)
        # Un identificador con prefijo de espacio de nombres ('B:funcion renal', el
        # nodo del grafo causal) cumple las tres condiciones de abajo y NO es texto:
        # acentuarlo parte el grafo, porque las aristas lo nombran desde otro sitio.
        if re.match(r"^[A-Za-z][\w-]{0,14}:\S", t) or _es_valor_de_identificador(codigo, m.start()):
            return m.group(0)
        if " " in t and not t.startswith(("#", "/", "http")) and re.match(r"^[A-ZÁÉÍÓÚÑ¿¡]", t):
            return "'" + acentuar_texto(t) + "'"
        return m.group(0)

    codigo = re.sub(r"'((?:[^'\\\n]|\\.){12,})'", cadena, codigo)
    # 5. Plantillas `...${x}...` con texto: se acentua solo el texto fuera de las
    #    llaves, y nunca en plantillas que forman rutas, clases o claves.
    def plantilla(m: re.Match) -> str:
        t = m.group(1)
        if any(c in t for c in "/#=") or " " not in t or "${" not in t:
            return m.group(0)
        # Plantillas de clases, ids o claves: `sección ${x}` seria un desastre.
        antes = m.string[max(0, m.start() - 14) : m.start()]
        if re.search(r"(className|class|id|key|htmlFor|name|href|data-\w+)=\{$", antes):
            return m.group(0)
        partes = re.split(r"(\$\{[^}]*\})", t)
        # Si algun trozo de texto parece codigo (acceso a propiedad, ternario,
        # plantilla anidada), la plantilla entera se deja como esta.
        if any(re.search(r"\w\.\w|[?]|\$\{", x) for x in partes if not x.startswith("${")):
            return m.group(0)
        return "`" + "".join(x if x.startswith("${") else acentuar_texto(x) for x in partes) + "`"

    codigo = re.sub(r"`([^`\n]*)`", plantilla, codigo)
    return codigo


def acentuar_valores_ts(codigo: str) -> str:
    # Valores de cadena tras ": " (no claves), y valores en arrays de textos.
    def valor(m: re.Match) -> str:
        v = m.group(2)
        # Una sola palabra en minuscula es casi siempre un valor que se compara
        # con el servidor ('sistematica', 'vacio'), no un texto visible.
        if " " not in v and v[:1].islower():
            return m.group(0)
        # Con pinta de codigo (claves, rutas, plantillas, llamadas): no se toca.
        if re.search(r"[_={}$/\\<>]|\w\.\w", v):
            return m.group(0)
        # La posicion de la COMILLA, no la del match: este empieza en los dos puntos.
        if _es_valor_de_identificador(codigo, m.start(2) - 1):
            return m.group(0)
        return f"{m.group(1)}'{acentuar_texto(v)}'"

    return re.sub(r"(:\s*)'((?:[^'\\\n]|\\.)*)'", valor, codigo)


def acentuar_cadenas_ts(codigo: str) -> str:
    """Ficheros de datos y del almacen: cualquier cadena entre comillas simples
    con un espacio y sin pinta de codigo es un texto que alguien lee (eventos,
    avisos, datos de muestra)."""

    def cadena(m: re.Match) -> str:
        v = m.group(1)
        if " " not in v or re.search(r"[_={}$/\\<>]|\w\.\w", v):
            return m.group(0)
        # Una cadena seguida de dos puntos es una CLAVE de objeto ('funcion renal':
        # 'factores'), y una clave no se acentua: el diccionario se busca por ella.
        if re.match(r"\s*:", codigo[m.end() :]):
            return m.group(0)
        if _es_valor_de_identificador(codigo, m.start()):
            return m.group(0)
        return f"'{acentuar_texto(v)}'"

    return re.sub(r"'((?:[^'\\\n]|\\.)*)'", cadena, codigo)


def main(escribir: bool = True) -> None:
    """Recorre los .tsx y los .ts de lib/ y datos/ y acentúa sus textos.

    Con `escribir=False` (opción `--comprobar`) solo informa de qué ficheros
    tendrían tildes nuevas, sin tocar nada; es el modo para revisar el árbol
    cuando otra persona o agente lo está editando a la vez."""
    raiz = Path(__file__).resolve().parents[1] / "src"
    cambiados = 0
    for f in sorted(raiz.rglob("*.tsx")):
        if f.name.endswith(".test.tsx"):
            continue
        antes = f.read_text()
        despues = acentuar_tsx(antes)
        if despues != antes:
            if escribir:
                f.write_text(despues)
            else:
                print(f"  tildes nuevas en {f.relative_to(raiz)}")
            cambiados += 1
    for nombre in ("lib/etiquetas.ts", "lib/glosario.ts", "lib/objetivo.ts", "lib/digest.ts", "lib/priorizacion.ts", "lib/evidencia.ts", "lib/calidad.ts", "lib/hipotesis.ts", "lib/exportar.ts"):
        f = raiz / nombre
        if not f.exists():
            continue
        antes = f.read_text()
        despues = acentuar_valores_ts(antes)
        if despues != antes:
            if escribir:
                f.write_text(despues)
            else:
                print(f"  tildes nuevas en {f.relative_to(raiz)}")
            cambiados += 1
    for f in sorted(list((raiz / "lib").glob("*.ts")) + list((raiz / "datos").glob("*.ts"))):
        if f.name.endswith(".test.ts") or f.name == "tipos.ts":
            continue
        antes = f.read_text()
        despues = acentuar_cadenas_ts(antes)
        if despues != antes:
            if escribir:
                f.write_text(despues)
            else:
                print(f"  tildes nuevas en {f.relative_to(raiz)}")
            cambiados += 1
    print(f"{cambiados} ficheros con tildes nuevas" + ("" if escribir else " (sin escribir nada)"))


def a_mano(raices: list[Path]) -> int:
    """Lista dónde aparecen las palabras que el guion NO decide (el imperfecto de
    subjuntivo de los verbos en -ar, que sin tilde es idéntico al futuro). Cada
    una la tiene que mirar una persona con el contexto delante: "que hoy dejara
    de estarlo" lleva subjuntivo y "el plan dejará de valer" lleva futuro."""
    patron = re.compile(r"\b(" + "|".join(sorted(SUBJUNTIVO_O_FUTURO)) + r")\b")
    total = 0
    for raiz in raices:
        for f in sorted(raiz.rglob("*")):
            if f.suffix not in (".ts", ".tsx", ".py") or not f.is_file():
                continue
            try:
                lineas = f.read_text().split("\n")
            except (OSError, UnicodeDecodeError):
                continue
            for n_linea, linea in enumerate(lineas, 1):
                for m in patron.finditer(linea):
                    total += 1
                    print(f"  {f}:{n_linea}: {m.group(1)} -> ¿{m.group(1)[:-1]}á{m.group(1)[len(m.group(1)) - 1:] if m.group(1)[-1] in 'sn' else ''}? | {linea.strip()[:110]}")
    print(f"{total} palabras que decide una persona (subjuntivo o futuro, no lo decide el guion)")
    return total


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--probar":
        print(acentuar_texto(sys.stdin.read()))
    elif len(sys.argv) > 1 and sys.argv[1] == "--a-mano":
        raiz = Path(__file__).resolve().parents[2]
        sys.exit(0 if a_mano([raiz / "frontend" / "src", raiz / "rosa"]) == 0 else 0)
    elif len(sys.argv) > 1 and sys.argv[1] == "--comprobar":
        main(escribir=False)
    else:
        main()
