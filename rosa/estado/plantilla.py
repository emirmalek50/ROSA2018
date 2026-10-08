"""Estado inicial y constructores de objetos del dominio.

La forma de cada objeto es la de `frontend/src/datos/tipos.ts`, campo por
campo y con los mismos nombres (camelCase). El frontend no valida: pinta lo
que recibe, asi que aqui se rellenan todos los campos siempre.

Los tiempos son milisegundos desde 1970, como `Date.now()` en el navegador.
"""

from __future__ import annotations

import itertools
import json
import time
from pathlib import Path
from typing import Any

from rosa import config, politicas

_contador = itertools.count(1)


def ahora_ms() -> int:
    return int(time.time() * 1000)


def nuevo_id(prefijo: str) -> str:
    """Ids legibles: prefijo, tiempo en base 36 y un contador. Mismo estilo que
    `nuevoId` del frontend para que se distingan a simple vista."""
    t = ahora_ms()
    base36 = ""
    digitos = "0123456789abcdefghijklmnopqrstuvwxyz"
    while t:
        t, r = divmod(t, 36)
        base36 = digitos[r] + base36
    return f"{prefijo}-{base36}-{next(_contador)}"


CLASES_ACCION = ["buscar_literatura", "correr_analisis", "gastar_grande", "escribir_modelo_mundo", "descartar_hipotesis", "contactar_laboratorio"]

CRITERIOS_INICIALES = [
    "Distinguir 'no está en los documentos' de 'no pude comprobar'.",
    "Una cifra sin cita a página exacta no se afirma.",
    "Marcar como interpretación lo que la fuente no dice literalmente.",
    "Si el dato es de otra entidad (otro fármaco, cohorte o estudio), no se atribuye.",
]

TIPOS_REVISION = ["inicial", "completa", "profunda", "observacion", "simulacion", "torneo"]


def casos_de_control() -> list[dict[str, Any]]:
    """Los 17 casos del RAG anterior, tal como se traspasaron (todos sin aprobar)."""
    ruta = Path(config.RAIZ) / "casos_evaluacion.jsonl"
    if not ruta.exists():
        return []
    casos = []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        d = json.loads(linea)
        casos.append(
            {
                "clave": d["clave"],
                "categoria": d["categoria"],
                "pregunta": d["pregunta"],
                "respuestaEsperada": d.get("respuestaEsperada", ""),
                "estado": d.get("estado", "propuesto"),
                "critico": bool(d.get("critico", False)),
                "origen": d.get("origen", "generado"),
            }
        )
    return casos


def estado_inicial() -> dict[str, Any]:
    """Un estado vacío pero completo: sin investigaciones, con los ajustes por
    defecto y los casos de control reales."""
    return {
        "conexion": "en_linea",
        "investigaciones": [],
        "corridas": [],
        "iteraciones": [],
        "solicitudes": [],
        "incidencias": [],
        "permisos": [],
        "autonomia": {c: ("preguntar" if c in ("contactar_laboratorio", "descartar_hipotesis") else "actuar") for c in CLASES_ACCION},
        "hipotesis": [],
        "comentarios": [],
        "hechos": [],
        # Cuestiones persistentes por investigación (rosa/cuestiones.py): lo que está
        # abierto, de dónde salió y qué lo resolvería.
        "cuestiones": [],
        # Lecciones por regla: lo que la investigación aprendió a no repetir (rosa/lecciones.py).
        "lecciones": [],
        # Cola de triaje (rosa/tareas.py): lo que un paso vio y pidió investigar, con
        # el veredicto del triaje y su motivo escrito. Una cuestión dice qué no
        # sabemos; una tarea dice qué se hace para saberlo.
        "tareas": [],
        "evaluaciones": [],
        "conjuntoDorado": [],
        "entidadesCache": {},
        "permisosConectores": {},
        "skills": [],
        "conectores": [],
        # Cuántas estructuras MEDIDAS tiene el PDB de cada proteína diana, por
        # accession de UniProt. Lo rellena el bucle (rosa/bucle/corrida.py) y
        # lo enseña la sección de laboratorio: hasta ahora el pie de página
        # decía que se usaba el PDB y no se usaba nunca.
        "estructurasMedidas": {},
        # La secuencia del transcrito canónico de cada diana, por accession de
        # UniProt, para diseñar oligonucleótidos antisentido (rosa/aso.py). La
        # rellena el bucle; el cDNA no viaja al navegador, solo el diseño.
        "secuencias": {},
        "criba": {},
        "relaciones": __import__("rosa.causal", fromlist=["relaciones_iniciales"]).relaciones_iniciales(),
        "artefactos": [],
        "casos": casos_de_control(),
        "metricas": [],
        "gepa": [],
        "memoria": [],
        "planesGuardados": [
            {"id": "plan-novedad", "nombre": "Comprobación de novedad estándar", "pasos": ["Open Targets", "ClinicalTrials.gov v2", "Precedente en literatura (OpenAlex)"], "vecesUsado": 0, "exitos": 0},
        ],
        "criteriosRevision": list(CRITERIOS_INICIALES),
        "avisos": {
            "correo": {"activo": False, "direccion": ""},
            "slack": {"activo": False, "canal": ""},
            "cuando": {"hipotesisNueva": True, "permisoPendiente": True, "corridaDetenida": True, "resumenDiario": False},
        },
        "politicaEsperas": {"horas": 24, "accion": "recordar", "escalarA": ""},
        "eventos": [],
        "ultimaVisita": None,
        # Registros de ROSA2018 (septiembre de 2026).
        "decisiones": [],
        "planesAnalisis": [],
        "ejecuciones": [],
        "reproducciones": [],
        "aprendizaje": [],
        "metodos": metodos_iniciales(),
        "politicas": _politicas(),
        # Registro de datasets del programa (rosa/datasets_programa.py): cada conjunto
        # público o subido que ROSA2018 vio, con su acceso y en qué investigaciones se usó.
        "datasetsPrograma": [],
        # Salud de los modelos del gateway por rol (cerebro, juez, volumen, réplica),
        # escrita por rosa/vigilante_modelos.py y por los sondeos del supervisor.
        "saludModelos": {},
    }


def _politicas() -> dict[str, Any]:
    from rosa import politicas

    return politicas.resumen()


# ---------------------------------------------------------------------------
# Constructores
# ---------------------------------------------------------------------------


def nueva_corrida(investigacion_id: str, numero: int, ahora: int, limite: int | None = None, parada: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": nuevo_id("cor"),
        "investigacionId": investigacion_id,
        "numero": numero,
        "estado": "esperando_plan",
        "empezadaEn": ahora,
        "terminadaEn": None,
        "iteracionActual": 1,
        # `usd` es la estimación por tokens con la tabla de respaldo; `usdReal` acumula
        # aparte lo que el gateway facturó (`usage.cost`), para poder compararlos (S-19).
        "gasto": {"tokensEntrada": 0, "tokensSalida": 0, "llamadas": 0, "segundos": 0, "articulosLeidos": 0, "usd": 0.0, "usdReal": 0.0},
        "motivoCierre": None,
        # `motivoPausa`: qué tope cortó cuando la corrida se pausó por presupuesto (el
        # de la corrida o el de la iteración N), para que el aviso no culpe al global.
        "presupuesto": {"limiteLlamadas": limite or config.PRESUPUESTO_CORRIDA, "alertas": list(config.ALERTAS_PRESUPUESTO), "avisadas": [], "motivoPausa": ""},
        "contexto": {"tokensUsados": 0, "tokensLimite": 400_000, "compactaciones": 0, "ultimaCompactacion": None},
        "busqueda": {"identificados": 0, "cribados": 0, "textoCompleto": 0, "usados": 0, "consultas": [], "excluidos": [], "traidos": 0, "msBases": 0, "msFuentes": 0},
        "coberturas": [],
        "metaRevisiones": [],
        "procesos": [],
        "panorama": [],
        # Por defecto el plan se aprueba solo tras 60 s: dos corridas perdieron su
        # tiempo esperando una aprobación que nadie dio (Emir, 17 de septiembre de
        # 2026). La casilla de la pantalla de la corrida lo apaga.
        "autoAprobarPlanSegundos": 60,
        # Tiempo esperando a una persona y pausas del proceso: no cuentan como
        # tiempo de trabajo frente al tope en horas (rosa/bucle/corrida.py).
        "esperaHumanaMs": 0,
        "pausaMs": 0,
        # Qué modelo espera la corrida cuando está en `esperando_modelo` (rol, modelo,
        # desde, sondeos, paso, intentos); None el resto del tiempo.
        "esperandoModelo": None,
        "arnes": _arnes(),
        "pregunta": None,
        # Parada propia de la corrida (horas, iteraciones, llamadas, texto); lo que
        # llegue primero. None: solo vale la condición de la investigación.
        "parada": parada,
        # Serie de progreso por iteración (rosa/progreso.py) y métrica única al cerrar.
        "progreso": [],
        "metrica": None,
    }


def _arnes() -> dict[str, str]:
    from rosa.version import arnes

    return arnes()


def nuevo_paso(titulo: str, detalle: str, presupuesto: int | None = None, humano: bool = False, valor_decision: str = "", espera: str = "", si_no_aparece: str = "") -> dict[str, Any]:
    return {"id": nuevo_id("paso"), "titulo": titulo, "detalle": detalle, "estado": "pendiente", "indicacionHumana": humano, "motivoFallo": None, "presupuesto": presupuesto, "valorDecision": valor_decision, "espera": espera, "siNoAparece": si_no_aparece}


def nueva_iteracion(corrida_id: str, numero: int, ahora: int, plan: list[dict[str, Any]], limite: int | None = None, reserva_cierre: int | None = None) -> dict[str, Any]:
    """La iteración recién nacida. `reserva_cierre` es la parte del tope
    apartada para el cierre (resumen, evidencia, conclusiones, revisor; S-14) y
    queda en `presupuesto.reservaCierre` desde el principio, que es lo que lee
    la solicitud de gasto grande para enseñar el plan y el cierre por separado;
    sin ella la clave no se escribe y la forma es la de siempre."""
    it = {
        "id": nuevo_id("it"),
        "corridaId": corrida_id,
        "numero": numero,
        "empezadaEn": ahora,
        "terminadaEn": None,
        "plan": plan,
        "planAprobado": False,
        "planPropuestoEn": ahora,
        "pistas": [],
        "presupuesto": {"limite": limite or config.PRESUPUESTO_ITERACION, "usado": 0},
        "resumen": "",
    }
    if reserva_cierre is not None:
        it["presupuesto"]["reservaCierre"] = int(reserva_cierre)
    return it


def nueva_pista(iteracion_id: str, paso_id: str | None, tipo: str, titulo: str, fuente: str) -> dict[str, Any]:
    return {"id": nuevo_id("pi"), "iteracionId": iteracion_id, "pasoId": paso_id, "tipo": tipo, "titulo": titulo, "fuente": fuente, "estado": "en_curso", "resumen": "empezando", "ms": 0, "transcripcion": []}


def nueva_fuente(**campos: Any) -> dict[str, Any]:
    base = {
        "id": nuevo_id("f"),
        "referencia": "",
        "titulo": "",
        "tipo": "articulo",
        "doi": None,
        "pmid": None,
        "nct": None,
        "pagina": None,
        "fragmento": "",
        "retraccion": None,
        "retraccionComprobadaEn": None,
        "anio": None,
        "autores": [],
        "centro": None,
        "tipoEstudio": "otro",
        "nivelEvidencia": 2,
        "textoCompleto": False,
        "citas": None,
    }
    base.update(campos)
    return base


def procedencia_vacia(mensaje: str, ahora: int, codigo: str = "", registro: list[str] | None = None) -> dict[str, Any]:
    import dspy

    return {
        "mensajes": [{"id": nuevo_id("m"), "de": "rosa", "texto": mensaje, "creadoEn": ahora}],
        "codigo": codigo,
        "registro": registro or [],
        "entorno": {
            "lenguaje": "Python",
            "version": "3.12",
            "paquetes": [{"nombre": "dspy", "version": dspy.__version__}],
            "modelos": [
                {"nombre": "openai/gpt-6-astra (cerebro)", "version": "gateway"},
                {"nombre": "anthropic/claude-opus-5 (juez)", "version": "gateway"},
                {"nombre": "anthropic/claude-sonnet-5 (extractor)", "version": "gateway"},
            ],
        },
        "fuentes": [],
    }


def novedad_pendiente() -> dict[str, Any]:
    return {
        "openTargets": {"estado": "sin_evidencia", "detalle": "No comprobado todavía"},
        "ensayos": {"estado": "sin_ensayo", "detalle": "No comprobado todavía", "nct": None},
        # Conectores (11 de septiembre de 2026): genetica humana, farmacos y datos publicos.
        "genetica": {"estado": "no_comprobado", "detalle": "No comprobado todavía"},
        "farmacos": {"estado": "no_comprobado", "detalle": "No comprobado todavía"},
        "datosPublicos": {"estado": "no_comprobado", "detalle": "No comprobado todavía", "series": []},
        # Exa (15 de septiembre de 2026): patentes y proyectos financiados anteriores a la hipótesis.
        "patentes": {"estado": "no_comprobado", "detalle": "No comprobado todavía", "url": None},
        "financiacion": {"estado": "no_comprobado", "detalle": "No comprobado todavía", "url": None},
        "agora": {"estado": "no_comprobado", "detalle": "Revisión de Agora pendiente: se consultará antes del cierre de la corrida."},
        "precedente": {"estado": "sin_precedente", "detalle": "No comprobado todavía"},
    }


def novedad_no_comprobada(version: int, motivo: str = "reformulacion") -> dict[str, Any]:
    """Estado "no comprobado" de una consulta de novedad tras reformular: la
    versión N cambió el título o el enunciado y el precedente, las patentes y
    la financiación de la versión anterior ya no valen. `detalle` empieza por
    "No comprobado" porque `paso_novedad` (rosa/bucle/pasos.py) y el Killer
    detectan así lo pendiente; `estado` "no_comprobado" es la clave nueva del
    contrato del 17 de septiembre de 2026."""
    return {"estado": "no_comprobado", "detalle": f"No comprobado todavía para la versión {version}: el enunciado cambió", "motivo": motivo, "url": None}


def experimento_con_datos(x: dict[str, Any]) -> dict[str, Any]:
    """Completa en sitio un experimento con las claves de la subida de datos
    del laboratorio que un registro antiguo no trae: `datosSinteticos` (la
    persona declaró que el fichero es de prueba, o su nombre lo dice; nunca
    cuenta como evidencia, S-18). Devuelve el mismo diccionario."""
    x.setdefault("datosSinteticos", False)
    return x


def revisiones_automaticas_pendientes() -> list[dict[str, Any]]:
    return [{"tipo": t, "estado": "pendiente", "resumen": "", "fecha": None} for t in TIPOS_REVISION]


def nueva_hipotesis(investigacion_id: str, iteracion: int, ahora: int, **campos: Any) -> dict[str, Any]:
    h = {
        "id": nuevo_id("hip"),
        "investigacionId": investigacion_id,
        "titulo": "",
        "enunciado": "",
        "mecanismo": "",
        "comprobacion": {"biomarcador": "", "cohorte": "", "diseno": ""},
        "estado": "propuesta",
        "elo": politicas.ELO_INICIAL,
        "historialElo": [{"iteracion": iteracion, "elo": politicas.ELO_INICIAL}],
        "rivales": [],
        "novedad": novedad_pendiente(),
        "afirmaciones": [],
        "procedencia": procedencia_vacia("Hipótesis generada por ROSA2018.", ahora),
        "hallazgos": [],
        "revisiones": [{"fecha": ahora, "quien": config.QUIEN_ROSA, "accion": "propuesta", "nota": f"Iteración {iteracion}", "aCiegas": False}],
        "creadaEn": ahora,
        "iteracion": iteracion,
        "origen": "rosa",
        "derivadaDe": None,
        "cluster": "Sin cluster",
        "evidenciaEstadistica": "no_aplica",
        "relevancia": {"justificacion": "", "votoHumano": None},
        "partidos": [],
        "revisionesAutomaticas": revisiones_automaticas_pendientes(),
        "supuestos": [],
        "revisionesHumanas": [],
        "replicacion": None,
        "ultimaRevisionAutomatica": None,
        "coste": {"literatura": 0, "analisis": 0},
        "experimento": None,
        "prerregistradaEn": ahora,
        # ROSA2018: contrato mínimo, versiones, decisiones, bloqueos.
        "tarjeta": None,
        "version": 1,
        "versiones": [],
        "decisionKiller": None,
        "bloqueos": [],
        "candidata": False,
        "dossierArtefactoId": None,
        "ejecuciones": [],
        # Conectores: registro de consultas a bases y contexto de la diana.
        "consultas": [],
        "contextoBases": None,
        # Grafo de evidencia (16 de septiembre de 2026): ataques declarados entre
        # hipótesis (rosa/argumentacion.py), con quién está en conflicto entre las
        # candidatas, con quién es redundante (fusión por torneo), qué absorbió y en
        # quién se fusionó, y si depende de algo que cambió (rosa/dependencias.py).
        "ataca": [],
        "conflictoCon": [],
        "redundanteCon": [],
        "absorbe": [],
        "fusionadaEn": None,
        "fusionPropuesta": None,
        "pendienteRevision": None,
        # Ruta terapéutica por regla (rosa/ruta.py): estado de cada paso con su evidencia; la escribe el bucle al cerrar la conclusión, el Killer y el retorno del laboratorio.
        "ruta": None,
        # Perfil de la diana en bases públicas (rosa/dianas.py): seis capas con presente, ausente o no pude comprobar; lo escribe contexto_de_bases.
        "perfilDiana": None,
        # Explicaciones alternativas {texto, clase, queLaDistinguiria, iteracion}; clase en causa_inversa, confusor, seleccion, artefacto, otra.
        "alternativas": [],
    }
    h.update(campos)
    return h


def nuevo_hecho(investigacion_id: str, tipo: str, tema: str, enunciado: str, estado: str, origen: str, procedencia: list[dict[str, Any]], ahora: int, prioridad: int = 5, motivo: str = "", afirmacion_ids: list[str] | None = None, citas: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Un hecho del modelo de mundo. `afirmacion_ids` son las afirmaciones (con su
    fragmento y su cita) que lo sostienen; `citas` son las citas sobre el hecho al
    estilo Scite (apoya, menciona, contrasta). Los enlaces entre hechos (sustituyeA,
    sustituidoPor, resuelveA, contradiceA) los escribe el paso de modelo de mundo."""
    return {
        "id": nuevo_id("he"),
        "investigacionId": investigacion_id,
        "tipo": tipo,
        "tema": tema,
        "enunciado": enunciado,
        "estado": estado,
        "origen": origen,
        "procedencia": procedencia,
        "motivoDescarte": None,
        "actualizadoEn": ahora,
        "prioridad": prioridad,
        "citas": list(citas or []),
        "afirmacionIds": list(afirmacion_ids or []),
        "sustituyeA": [],
        "sustituidoPor": None,
        "resuelveA": [],
        "contradiceA": [],
        "cerradoEn": None,
        "historial": [{"fecha": ahora, "de": None, "a": estado, "quien": config.QUIEN_ROSA, "motivo": motivo or "Añadido por ROSA2018"}],
    }


def nuevo_evento(investigacion_id: str, tipo: str, texto: str, ruta: str | None, t: int) -> dict[str, Any]:
    return {"id": nuevo_id("ev"), "investigacionId": investigacion_id, "t": t, "tipo": tipo, "texto": texto, "ruta": ruta}


# ---------------------------------------------------------------------------
# ROSA2018: misión, tarjeta, decisiones, análisis, aprendizaje
# ---------------------------------------------------------------------------


def mision_vacia() -> dict[str, Any]:
    from rosa import politicas

    return {
        "poblacion": "",
        "etapa": "",
        "celulaTejido": "",
        "mecanismo": "",
        "tipoIntervencion": "",
        "capacidadesLaboratorio": [],
        "presupuesto": {"llamadas": config.PRESUPUESTO_CORRIDA, "usd": politicas.PRESUPUESTO_USD_POR_DEFECTO, "horas": politicas.PRESUPUESTO_HORAS_POR_DEFECTO},
        "propuestaPorRosa": False,
        "aprobadaEn": None,
        "aprobadaPor": None,
        # Plan completo ROSA2018: meta amplia, areas, acciones permitidas, roles.
        "metaAmplia": "",
        "areas": [],
        "accionesPermitidas": ["buscar_literatura", "extraer_y_verificar", "analisis_in_silico_con_datasets_aprobados"],
        "responsables": {"patrocinador": "", "liderCientifico": "", "metodos": "", "datos": "", "ingenieria": "", "laboratorio": "", "evaluacion": ""},
    }


def nueva_area(**campos: Any) -> dict[str, Any]:
    a = {"id": nuevo_id("area"), "titulo": "", "familiaMecanismo": "", "relevancia": "", "valorIntervencion": "", "incertidumbre": "", "comprobabilidad": "", "coste": "", "demora": "", "dependeDe": "", "estado": "propuesta", "condicionReapertura": "", "corridaId": None, "historial": []}
    a.update(campos)
    return a


def pregunta_vacia() -> dict[str, Any]:
    return {"contexto": "", "etapa": "", "intervencion": "", "comparador": "", "desenlace": "", "ventana": "", "unidadBiologica": "", "mecanismos": "", "decision": "", "umbralEfecto": "", "umbralResuelto": False, "pasoRuta": "mecanismo", "propuestaPorRosa": True, "aprobadaEn": None}


PASOS_RUTA = ("mecanismo", "opciones_intervencion", "compromiso_diana", "efecto_funcional", "selectividad_toxicidad", "exposicion", "replicacion_independiente", "evidencia_poblacion")


def nuevo_metodo(nombre: str, tipo: str, evalua: str, ahora: int, **campos: Any) -> dict[str, Any]:
    m = {
        "id": nuevo_id("met"),
        "nombre": nombre,
        "tipo": tipo,
        "evalua": evalua,
        "contextos": [],
        "exclusiones": [],
        "entradas": "",
        "salidas": "",
        "validacion": "",
        "fallosConocidos": "",
        "version": "",
        "dependeDe": [],
        "coste": "",
        "responsable": "",
        "estado": "implementado",
        "probadoEn": [],
        "actualizadoEn": ahora,
    }
    m.update(campos)
    return m


def metodos_iniciales() -> list[dict[str, Any]]:
    """El registro de métodos con lo que ROSA2018 ya tiene (plan completo,
    sección 5). Cada entrada dice que evalua, donde aplica, como se valido y
    en que estado esta. Lo probado en contexto lo marca la puerta de
    reproducción; lo demás empieza en 'implementado'."""
    t = ahora_ms()
    return [
        nuevo_metodo("Búsqueda bibliográfica (PubMed, Europe PMC, preprints)", "busqueda", "Qué literatura existe sobre una pregunta; cobertura estimada por tema", t, contextos=["literatura biomédica en inglés y español"], exclusiones=["texto completo sin acceso abierto"], entradas="consultas booleanas", salidas="fuentes con resumen y, si hay, texto completo por página", validacion="Cobertura estimada con curva 1 - exp(-n/tau); sin evaluación independiente todavía", fallosConocidos="Una fuente que no responde no es 'no hay'", version="rosa/fuentes", coste="1 llamada por artículo cribado", responsable="ingenieria"),
        nuevo_metodo("Verificador de afirmaciones (deterministas + juez Opus 5)", "revision", "Si un fragmento citado sostiene una afirmación; entidad distinta; ausencia refutada", t, contextos=["afirmaciones con cita a fragmento literal"], entradas="afirmación, fragmento, pistas normalizadas", salidas="veredicto TRASPASO 4.1", validacion="17 casos de control del RAG anterior, sin aprobar por humano", fallosConocidos="Interpretaciones: 58 % de acierto en Kosmos; aquí se marcan aparte", version="rosa/verificador.py", coste="1 llamada por afirmación que va al juez", responsable="metodos"),
        nuevo_metodo("Hypothesis Killer (lista fija + decisión por regla)", "revision", "Si una hipótesis avanza, se reformula, se suspende o se descarta en contexto", t, contextos=["hipótesis con tarjeta y afirmaciones verificadas"], entradas="hipótesis, afirmaciones, supuestos, comprobaciones deterministas", salidas="decisión con comprobaciones y auditoría muestreada", validacion="Pendiente: panel de prueba con fallos plantados (ver PLAN-ROSA2018.md)", fallosConocidos="Sesgo de autoridad y de posición en jueces LLM; se ocultan recuentos de citas", version="rosa/killer.py", coste="1 a 3 llamadas por hipótesis", responsable="metodos"),
        nuevo_metodo("Comparación de dos grupos (t de Welch o Mann-Whitney) con baseline y control barajado", "analisis", "Diferencia de una medida continua entre dos grupos independientes", t, contextos=["datos tabulares con una columna de grupo y una medida"], exclusiones=["medidas repetidas", "más de dos grupos sin corrección"], entradas="CSV con columna de grupo y medida", salidas="RESULTADO estadístico, p, IC, n por grupo; BASELINE; CONTROL", validacion="Sin probar en contexto hasta superar la puerta de reproducción", fallosConocidos="p grande con n pequeño no es 'sin efecto'", version="sandbox rosa-sandbox:1 (pandas, scipy, statsmodels)", coste="1 evaluación costosa", responsable="metodos", estado="implementado"),
        nuevo_metodo("Correlación y regresión simple con permutación", "analisis", "Asociación entre dos medidas continuas, ajustada por confusores declarados", t, contextos=["datos tabulares"], exclusiones=["causalidad: solo asociación"], entradas="CSV", salidas="coeficiente, p por permutación con reajuste, IC", validacion="Sin probar en contexto hasta la puerta", fallosConocidos="Asociación repetida no es causa", version="sandbox rosa-sandbox:1", coste="1 evaluación costosa", responsable="metodos"),
        nuevo_metodo("Reproducción de análisis publicado (GSE1297, OASIS-1, SEA-AD)", "analisis", "Si el pipeline reproduce una cifra publicada dentro de tolerancia", t, contextos=["datasets públicos del Alzheimer"], entradas="dataset con hash, referencia, cifra publicada, tolerancia congelada", salidas="superada o fallida; error técnico aparte", validacion="Es la validación de los demás métodos de análisis", version="rosa/bucle/analisis.py", coste="1 evaluación por reproducción", responsable="metodos"),
        nuevo_metodo("Open Targets, ClinicalTrials.gov y OpenAlex (novedad)", "recurso_datos", "Si una diana, un ensayo o una idea ya existen", t, contextos=["genes y proteínas humanas", "ensayos registrados"], entradas="símbolo de gen, términos", salidas="asociación, ensayos, precedente", validacion="APIs públicas; sin evaluación propia", fallosConocidos="Sin respuesta no es ausencia", version="rosa/fuentes", coste="llamadas HTTP", responsable="ingenieria"),
        nuevo_metodo("Modelos de lenguaje por el AI Gateway (Astra cerebro, Opus 5 juez, Sonnet 5 volumen)", "predictor", "Propuestas de plan, hipótesis, extracción y juicio; nunca confirmación independiente", t, contextos=["texto biomédico"], exclusiones=["Claude Fable 5.1: filtros de doble uso en biología"], entradas="firmas DSPy", salidas="campos tipados", validacion="Métricas del juez contra decisiones humanas (pantalla Calidad)", fallosConocidos="Un predictor no confirma sus propios datos de entrenamiento; acuerdo entre modelos no es evidencia", version="gateway", coste="por token", responsable="ingenieria"),
    ]


def puerta_reproduccion() -> dict[str, Any]:
    from rosa import politicas

    return {"requeridas": politicas.REPRODUCCIONES_REQUERIDAS, "superadas": 0, "estado": "bloqueada", "eximidaPor": None, "motivo": "", "fecha": None}


def tarjeta_vacia() -> dict[str, Any]:
    return {"diana": "", "celula": "", "etapa": "", "intervencion": "", "direccion": "sin_intervencion", "prediccionFalsable": "", "riesgos": [], "pasoRuta": "mecanismo"}


def version_de(h: dict[str, Any], ahora: int, quien: str, motivo: str) -> dict[str, Any]:
    """Instantánea de la hipótesis tal como está, para guardarla antes de reformular."""
    return {
        "n": h.get("version", 1),
        "fecha": ahora,
        "quien": quien,
        "motivo": motivo,
        "titulo": h["titulo"],
        "enunciado": h["enunciado"],
        "mecanismo": h["mecanismo"],
        "comprobacion": dict(h["comprobacion"]),
        "tarjeta": dict(h["tarjeta"]) if h.get("tarjeta") else None,
    }


def nueva_decision(investigacion_id: str, hipotesis_id: str, version: int, etapa: str, decision: str, motivo: str, quien: str, ahora: int, comprobaciones: list[dict[str, Any]] | None = None, que_haria_falta: str = "") -> dict[str, Any]:
    return {
        "id": nuevo_id("dec"),
        "investigacionId": investigacion_id,
        "hipotesisId": hipotesis_id,
        "version": version,
        "etapa": etapa,
        "decision": decision,
        "motivo": motivo,
        "comprobaciones": comprobaciones or [],
        "queHariaFalta": que_haria_falta,
        "quien": quien,
        "fecha": ahora,
        "auditoria": None,
    }


def nuevo_plan_analisis(investigacion_id: str, hipotesis_id: str | None, dataset_id: str, ahora: int, **campos: Any) -> dict[str, Any]:
    plan = {
        "id": nuevo_id("plan"),
        "investigacionId": investigacion_id,
        "hipotesisId": hipotesis_id,
        "datasetId": dataset_id,
        "tipo": "confirmatorio",
        "pregunta": "",
        "variables": [],
        "poblacion": "",
        "preprocesado": [],
        "prueba": "",
        "hipotesisNula": "",
        "hipotesisAlternativa": "",
        "alpha": 0.05,
        "direccionEsperada": "",
        "tamanoEfectoMinimo": "",
        "baseline": "",
        "controlNegativo": "",
        "correccionMultiplicidad": "",
        "umbralEfecto": "",
        "criterioNoEvaluable": "",
        # Intención completa (como pide el prerregistro): qué hará ROSA2018 según salga, y
        # de qué plan viene si es una réplica o una variante.
        "siConfirma": "",
        "siRefuta": "",
        "siNoEvaluable": "",
        "planPadre": None,
        "cambioRespectoAlPadre": "",
        "semilla": 12345,
        "entorno": "tabular",
        "hashDatos": "",
        "hashPlan": "",
        "congeladoEn": ahora,
        "autor": config.QUIEN_ROSA,
        "reproduccionId": None,
    }
    plan.update(campos)
    plan["hashPlan"] = hash_plan(plan)
    return plan


def hash_plan(plan: dict[str, Any]) -> str:
    """sha256 del plan canónico (sin id ni fechas): si cambia una variable o
    la prueba, cambia el hash y es otro plan."""
    import hashlib

    claves = ("tipo", "pregunta", "variables", "poblacion", "preprocesado", "prueba", "hipotesisNula", "hipotesisAlternativa", "alpha", "direccionEsperada", "tamanoEfectoMinimo", "baseline", "controlNegativo", "correccionMultiplicidad", "umbralEfecto", "criterioNoEvaluable", "semilla", "hashDatos", "datasetId")
    canonico_dict = {k: plan.get(k) for k in claves}
    # El entorno (imagen del sandbox, con sus versiones de numpy y scipy) forma
    # parte del plan: cambiarlo es otro plan. Solo se incluye si no es el de
    # siempre, para que los planes ya congelados conserven su hash.
    # La intención por resultado y el plan padre también son parte del plan: solo entran en
    # el hash cuando están rellenos, para conservar los hashes ya congelados.
    for clave in ("siConfirma", "siRefuta", "siNoEvaluable", "planPadre", "cambioRespectoAlPadre"):
        if plan.get(clave):
            canonico_dict[clave] = plan.get(clave)
    if (plan.get("entorno") or "tabular") != "tabular":
        canonico_dict["entorno"] = plan["entorno"]
    canonico = json.dumps(canonico_dict, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()[:16]


def nueva_ejecucion(investigacion_id: str, hipotesis_id: str | None, plan_id: str, tipo: str, codigo: str, semilla: int, hash_datos: str, ahora: int) -> dict[str, Any]:
    import platform

    return {
        "id": nuevo_id("run"),
        "investigacionId": investigacion_id,
        "hipotesisId": hipotesis_id,
        "planId": plan_id,
        "tipo": tipo,
        "codigo": codigo,
        "entorno": {"python": platform.python_version(), "paquetes": []},
        "semilla": semilla,
        "hashDatos": hash_datos,
        "hashPlan": "",
        "inicio": ahora,
        "fin": None,
        "estado": "no_ejecutado",
        "runtime": "ninguno",
        "red": "deshabilitada",
        "codigoSalida": None,
        "duracionS": None,
        "salida": "",
        "error": "",
        "resultados": {},
        "baseline": {},
        "controlNegativo": {},
        "repeticiones": [],
        "interpretacion": None,
        "plausibilidadVerificada": None,
        "auditoria": None,
    }


def nueva_reproduccion(investigacion_id: str, dataset_id: str, ahora: int, **campos: Any) -> dict[str, Any]:
    r = {
        "id": nuevo_id("rep"),
        "investigacionId": investigacion_id,
        "datasetId": dataset_id,
        "referencia": "",
        "doi": "",
        "descripcion": "",
        "cifraPublicada": "",
        "valorPublicado": 0.0,
        "tolerancia": 0.1,
        "planId": None,
        "ejecucionId": None,
        "valorObtenido": None,
        "estado": "pendiente",
        "creadaEn": ahora,
    }
    r.update(campos)
    return r


def nuevo_cambio_aprendizaje(investigacion_id: str | None, nivel: int, tipo: str, descripcion: str, origen: str, estado: str, quien: str, ahora: int, evaluacion: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": nuevo_id("apr"),
        "investigacionId": investigacion_id,
        "nivel": nivel,
        "tipo": tipo,
        "descripcion": descripcion,
        "origen": origen,
        "estado": estado,
        "evaluacion": evaluacion,
        "quien": quien,
        "fecha": ahora,
        "resueltoEn": ahora if estado in ("aplicado", "promovido") else None,
        "resueltoPor": quien if estado in ("aplicado", "promovido") else None,
    }


def procedencia_dataset_vacia() -> dict[str, Any]:
    return {
        "origen": "",
        "version": "",
        "licencia": "",
        "permisos": "",
        "fechaObtencion": None,
        "hash": "",
        "fichero": None,
        "filas": 0,
        "diccionario": [],
        "usoIAAutorizado": "desconocido",
        "sintetico": False,
        "clase": "observacion_original",
        "cohorte": "",
        "permiteLlmTerceros": False,
        "restriccionIA": "",
        "acceso": "propio",
        "columnas": [],
    }
