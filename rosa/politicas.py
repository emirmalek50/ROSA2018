"""Las politicas de ROSA2018: los limites que ningun agente puede editar.

El documento de concepto ROSA2018 (version 1.0, septiembre de 2026) exige
que las reglas de gobierno vivan fuera del alcance de los agentes. En ROSA2018
eso significa este fichero: el estado (`rosa.db`) lo escriben el bucle y la
interfaz, pero este modulo solo cambia con un commit, y el commit queda
registrado en el `arnes` de cada corrida. Cambiar una politica es un cambio
de aprendizaje de nivel 3: lo hace una persona, se anota en el registro de
aprendizaje y se puede auditar.

Cada constante lleva su motivo. Si alguna vez hace falta cambiarla, cambiar
tambien el motivo.
"""

from __future__ import annotations

# Hipótesis vivas por misión. Más allá de esto, la cola deja de ser
# revisable por una persona en una sesión y el torneo pierde partidos por
# hipótesis. ROSA2018 deja de generar (no descarta) al llegar aquí. Bajado de 20
# a 10 el 15 de septiembre de 2026: el valor de una corrida es cuánto suben
# las hipótesis que ya existen, no cuántas nacen.
MAX_HIPOTESIS_VIVAS_POR_MISION = 10

# Propuestas nuevas por iteración. Una hipótesis nace solo si su evidencia ya
# da para certeza baja (dos cohortes distintas); si no, va al vivero.
MAX_PROPUESTAS_POR_ITERACION = 2

# Vivero de ideas: propuestas que esperan evidencia para nacer. Tope y
# paciencia (iteraciones sin evidencia nueva antes de retirarlas).
MAX_VIVERO = 12
ITERACIONES_MAX_EN_VIVERO = 6

# Evaluaciones costosas (analisis in silico con datos) por mision y corrida.
# Cada una gasta codigo, tiempo de maquina y una auditoria; el documento fija
# cinco para la demostracion.
MAX_EVALUACIONES_COSTOSAS = 5

# Candidatos que salen al laboratorio por ciclo: entre cero y tres. Cero es
# un resultado legitimo (abstenerse); mas de tres no se puede ejecutar.
MAX_CANDIDATOS_LABORATORIO = 3

# Reformulaciones por hipotesis. A la tercera vez que el Killer pide
# reformular, la hipotesis se descarta en este contexto: reformular sin
# limite es la forma de esquivar una critica sin responderla.
MAX_REFORMULACIONES = 2

# Analisis publicados que hay que reproducir, dentro de tolerancia, antes de
# que el modulo de analisis con datos pueda descubrir algo nuevo. Sin esta
# puerta, un resultado nuevo no se distingue de un error del pipeline.
REPRODUCCIONES_REQUERIDAS = 3

# Fraccion de los descartes del Killer que se auditan con un modelo de otra
# familia. Un critico que mata ideas buenas es tan caro como uno que deja
# pasar malas; la auditoria mide lo primero.
FRACCION_DESCARTES_AUDITADOS = 0.34

# Tiempo maximo de una ejecucion in silico y memoria maxima, para el sandbox.
SEGUNDOS_MAX_EJECUCION = 180
MEMORIA_MAX_EJECUCION_MB = 2048

# Presupuesto por defecto de una mision en dinero (dolares, estimado a partir
# de los tokens) y en horas de reloj. Se pueden fijar por mision; estos son
# los topes si nadie dice nada.
PRESUPUESTO_USD_POR_DEFECTO = 60.0
PRESUPUESTO_HORAS_POR_DEFECTO = 72.0

# Decisiones que puede tomar el Killer sobre una hipotesis. El generador no
# esta en la lista: nunca aprueba lo suyo.
DECISIONES_KILLER = ("avanzar", "reformular", "suspender", "descartar_en_contexto")

# Clases de evidencia del libro de procedencia. Cada afirmacion y cada dato
# llevan una; no se mezclan en el mismo recuento.
CLASES_EVIDENCIA = ("observacion_original", "derivado", "literatura", "prediccion", "conocimiento_operativo")

# Resultados que puede devolver el laboratorio. Cada uno tiene una accion
# distinta en el aprendizaje (ver `rosa/bucle/corrida.py`).
RESULTADOS_LABORATORIO = ("apoyo_reproducido", "negativo_interpretable", "inconcluso", "fallo_tecnico", "toxicidad_inviabilidad", "correccion_contexto")

# Bloqueos no compensables: si uno se cumple, la hipotesis no entra al
# ranking de candidatos aunque puntue alto en todo lo demas.
BLOQUEOS = ("trazabilidad_insuficiente", "datos_no_autorizados", "analisis_invalido", "sin_experimento_interpretable", "descartada_por_killer", "fuente_retractada", "revision_registro_abierta", "dependencia_pendiente")


# Contexto que entra al prompt (politica de contexto, no constantes sueltas).
MAX_HIPOTESIS_EN_CONTEXTO = 25
MAX_DESCARTADAS_EN_CONTEXTO = 6
MAX_HECHOS_EN_CONTEXTO = 60
# Literatura: cuantas fuentes por consulta, cuantas se leen a fondo, y el
# umbral de relevancia (0 a 10) para cribar.
MAX_FUENTES_POR_CONSULTA = 12
# Con reranker (rosa/reranker.py) se traen más candidatos por consulta y el
# modelo solo criba los mejores: el corte lo hace el reranker por pertinencia.
MAX_FUENTES_CON_RERANKER = 30
MAX_CRIBADO_MODELO = 12
MAX_FUENTES_EXTRAER = 14
MAX_FRAGMENTOS_POR_FUENTE = 6
RELEVANCIA_MINIMA = 5
# Torneo: factor K del Elo y Elo inicial.
ELO_K = 32
ELO_INICIAL = 1500
# Cuántos partidos CON JUEZ se juegan por iteración. Los que decide la regla de
# solidez (rosa/solidez.py) no cuentan contra este tope: no gastan ninguna
# llamada. Cada partido con juez son dos llamadas (A contra B y B contra A),
# unos 0,11 USD y 37 s. Con 9 hipótesis vivas la rejilla completa son 36 pares y
# se cierra en tres iteraciones; hasta el 25 de septiembre de 2026 `emparejar`
# solo llegaba a 4 por ronda porque gastaba cada hipótesis en un solo par.
MAX_PARTIDOS_CON_JUEZ_POR_ITERACION = 6
# Presupuesto de tokens de entrada por rol y llamada (politica de contexto):
# por encima, el contexto se recorta antes de llamar y queda registrado.
TOKENS_MAX_POR_ROL = {"cerebro": 120_000, "juez": 90_000, "volumen": 40_000, "replica": 90_000}


# Coste por decision: las horas de revision humana entran en el coste a esta
# tarifa declarada (USD por hora), para comparar con investigar sin ROSA2018.
TARIFA_HORA_REVISION_USD = 60.0

# Nivel de autonomia declarado, con la escala de Beal y Rogers (Mol Syst Biol
# 2020) que adopta la revision de laboratorios autonomos de Tobias y Wahab
# (Royal Society Open Science 2025): la mayoria de los sistemas actuales esta
# en el nivel 3 y ninguno en produccion pasa del 4. ROSA2018 opera en el nivel 2:
# asistencia cientifica proactiva (hipotesis, planes, protocolos, analisis in
# silico) con decision humana en lo que cambia el mundo real. No ejecuta
# ningun ciclo fisico sola y no pretende hacerlo.
NIVEL_AUTONOMIA_DECLARADO = 2
NIVELES_AUTONOMIA = (
    {"nivel": 0, "nombre": "Sin autonomía", "definicion": "Todo el trabajo lo hacen personas."},
    {"nivel": 1, "nombre": "Operación asistida", "definicion": "Asistencia de maquina en tareas definidas (manipuladores de líquidos, software de análisis)."},
    {"nivel": 2, "nombre": "Autonomía parcial", "definicion": "Asistencia científica proactiva: generación de protocolos e hipótesis, al menos un paso intelectual automatizado. Las decisiones que tocan el mundo real las toma una persona."},
    {"nivel": 3, "nombre": "Autonomía condicional", "definicion": "Mínimo para llamarse laboratorio autónomo: al menos un ciclo completo del método científico sin intervención salvo anomalias."},
    {"nivel": 4, "nombre": "Alta autonomía", "definicion": "Genera protocolos, ejecuta experimentos, analiza y ajusta hipótesis con los resultados (Adam, Eve)."},
    {"nivel": 5, "nombre": "Autonomía total", "definicion": "Automatización completa del método científico. No existe todavía."},
)


def nivel_autonomia_texto() -> str:
    n = next(x for x in NIVELES_AUTONOMIA if x["nivel"] == NIVEL_AUTONOMIA_DECLARADO)
    return f"Nivel {n['nivel']} de 5 ({n['nombre']}): {n['definicion']} Escala de Beal y Rogers (2020) usada por la revisión de laboratorios autonomos de 2025."


def puede_reformular(version: int) -> bool:
    """`versión` es la versión actual de la hipótesis (1 al nacer). Se puede
    reformular mientras la siguiente versión no supere el límite."""
    return version - 1 < MAX_REFORMULACIONES


def resumen() -> dict[str, object]:
    """Para la pantalla de Ajustes: las políticas tal como están en código."""
    return {
        "maxHipotesisVivas": MAX_HIPOTESIS_VIVAS_POR_MISION,
        "maxEvaluacionesCostosas": MAX_EVALUACIONES_COSTOSAS,
        "maxCandidatos": MAX_CANDIDATOS_LABORATORIO,
        "maxReformulaciones": MAX_REFORMULACIONES,
        "reproduccionesRequeridas": REPRODUCCIONES_REQUERIDAS,
        "fraccionDescartesAuditados": FRACCION_DESCARTES_AUDITADOS,
        "segundosMaxEjecucion": SEGUNDOS_MAX_EJECUCION,
        "memoriaMaxEjecucionMb": MEMORIA_MAX_EJECUCION_MB,
        "presupuestoUsd": PRESUPUESTO_USD_POR_DEFECTO,
        "presupuestoHoras": PRESUPUESTO_HORAS_POR_DEFECTO,
        "relevanciaMinima": RELEVANCIA_MINIMA,
        "maxClausulasAnd": MAX_CLAUSULAS_AND,
        "maxFragmentosPorFuente": MAX_FRAGMENTOS_POR_FUENTE,
        "maxPartesPorFragmento": MAX_PARTES_POR_FRAGMENTO,
        "maxCaracteresPorLlamadaExtractor": MAX_CARACTERES_POR_LLAMADA_EXTRACTOR,
        "maxForzadosPorNombre": MAX_FORZADOS_POR_NOMBRE,
        "maxConsultasPorNombreSinRelevantes": MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES,
        "diasVigenciaComprobacionRetraccion": DIAS_VIGENCIA_COMPROBACION_RETRACCION,
        "maxHipotesisEnContexto": MAX_HIPOTESIS_EN_CONTEXTO,
        "tokensMaxPorRol": dict(TOKENS_MAX_POR_ROL),
        "eloK": ELO_K,
        "maxPartidosConJuezPorIteracion": MAX_PARTIDOS_CON_JUEZ_POR_ITERACION,
        "tarifaHoraRevisionUsd": TARIFA_HORA_REVISION_USD,
        "nivelAutonomiaDeclarado": NIVEL_AUTONOMIA_DECLARADO,
        "nivelesAutonomia": list(NIVELES_AUTONOMIA),
    }

# Amplitud de búsqueda (16 de septiembre de 2026). ROSA2018 busca en dos modos en
# cada paso de literatura: foco (la pregunta de la corrida y el peldaño que le
# falta a cada hipótesis) y amplitud (temas adyacentes del modelo de mundo,
# novedad reciente del campo y sorpresa por significado). Regla de Emir y de
# su compañero: una ROSA2018 que solo mira el punto fijo se pierde los diamantes
# de al lado. La fracción es la parte de las consultas que van a explorar; la
# persona la elige por investigación con botones (enfocada, equilibrada,
# amplia); equilibrada por defecto.
AMPLITUD = {"enfocada": 0.0, "equilibrada": 0.34, "amplia": 0.5}
AMPLITUD_POR_DEFECTO = "equilibrada"
MAX_CONSULTAS_FOCO = 5
MAX_CONSULTAS_AMPLITUD = 4
# Lo explorado se puntúa con otra pregunta (qué podría cambiar) y con el listón
# un punto más bajo: un diamante nunca se tira por no responder a la pregunta.
RELEVANCIA_MINIMA_AMPLITUD = 4
# La "novedad del campo" mira lo publicado en los últimos seis meses.
DIAS_NOVEDAD_DEL_CAMPO = 180

# Consultas de literatura, tanda 2 de la revisión del 17 de septiembre de 2026 (S-07).
# Una consulta booleana lleva como máximo tres cláusulas unidas por AND: con cuatro o
# cinco, la corrida 7 trajo de 2 a 7 resultados y 0 relevantes en 10 de 20 temas. La
# precisión se gana con sinónimos dentro de cada cláusula, no con más cláusulas.
MAX_CLAUSULAS_AND = 3
# Relajación acotada: una consulta de foco con menos de estos resultados y al menos
# tantas cláusulas AND se relanza una sola vez sin la última cláusula, y queda anotado.
RESULTADOS_MINIMOS_ANTES_DE_RELAJAR = 5
CLAUSULAS_MINIMAS_PARA_RELAJAR = 3
# Una consulta con más de estos resultados y ninguno relevante entre los cribados es
# demasiado amplia: se marca en el registro para que el planificador la acote.
RESULTADOS_DEMASIADO_AMPLIA = 1000

# Extracción (S-26). Cuántos caracteres ve el extractor por llamada: un fragmento más
# largo (una sección de resultados de 15.000 caracteres) se lee en partes en vez de
# cortarse a secas, hasta este número de partes.
MAX_CARACTERES_POR_LLAMADA_EXTRACTOR = 6000
MAX_PARTES_POR_FRAGMENTO = 3

# Segunda pasada de la tanda 2 (18 de septiembre de 2026), tras el adversario.
# Red de seguridad por nombre (S-07): un nombre propio del objetivo se busca por
# nombre exacto hasta que una consulta simple traiga un relevante. Pero un nombre
# con miles de resultados y ningún relevante ("lecanemab" en Europe PMC) no se
# insiste sin tope: tras este número de consultas simples sin relevantes en la
# investigación (o una en la corrida en curso) deja de repetirse, y queda dicho.
MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES = 2
# Artículos cuyo título nombra un fármaco, ensayo o cohorte del objetivo pasan al
# modelo sin corte del reranker; acotados a este número por consulta (los primeros
# en el orden de la base), porque sin tope una consulta por nombre gastaba hasta 30
# llamadas de relevancia en vez de las 12 de MAX_CRIBADO_MODELO.
MAX_FORZADOS_POR_NOMBRE = 12
# Una comprobación de retracción en Crossref se reutiliza entre corridas si tiene
# menos de estos días; una que no llegó ("Crossref no respondió") no se reutiliza
# nunca: "no pude comprobar" es transitorio, no una comprobación.
DIAS_VIGENCIA_COMPROBACION_RETRACCION = 90
