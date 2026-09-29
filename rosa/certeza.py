"""Techo de certeza por regla (GRADE), peso de la evidencia y la escalera para
subir.

La certeza de la evidencia sobre una hipótesis la escribe el juez
(`ConcluirHipotesis`), con sus factores y su explicación. Pero el nivel queda
acotado por una regla determinista sobre lo que ROSA2018 tiene contado, igual que
el Killer o el riesgo de sesgo: el juez explica dentro de la caja, no la fija.

La regla solo baja, nunca sube. Con lo que hay en el registro:

Reglas de estructura (qué clase de evidencia hay):

- "sin apoyos": sin ninguna afirmación sostenida o parcial que cuente como
  apoyo (no sintética, no en contra, no socavada): muy baja.
- "una cohorte": solo literatura de una cohorte (o sin cohorte identificada),
  sin réplica ni evidencia directa: muy baja. Si el juez documentó un efecto
  grande, baja.
- "dos cohortes": solo literatura pero de dos o más cohortes distintas: como
  mucho baja.
- "evidencia directa": un resultado de laboratorio contra el prerregistro o un
  análisis in silico sobre datos reales (nunca sintéticos) de una cohorte:
  como mucho moderada.
- "réplica directa": evidencia directa y dos o más cohortes distintas: puede
  llegar a alta.

Reglas de peso (cuánto pesa lo que hay; 16 y 17 de septiembre de 2026):

Cada afirmación pesa según su relación con la hipótesis (`PESO_RELACION`), el
diseño del estudio del que viene (`PESO_DISENO`, solo penaliza lo conocido
como débil), el riesgo de sesgo de esa fuente (`PESO_SESGO`) y el tamaño de
muestra (`PESO_N`) y la sección de la que sale (`PESO_SECCION_FONDO`: una
frase de la introducción o los antecedentes resume estudios ajenos, pesa 0,25
y no da cohorte a su fuente; `deFondo` lo escribe el extractor y, si falta,
se lee de la cita). El riesgo de sesgo se relee por dominios
(`juicio_sesgo_util`): "sin información" no es "riesgo alto" y queda como
sin evaluar, con peso neutro. El peso es el producto de esos factores con el
signo de la relación, y cada factor lleva su motivo (`peso_afirmacion`). La suma de los
apoyos es `aFavor`; la de las que contradicen, `enContra` (en positivo). Una
afirmación que socava no pesa por sí misma: descuenta el apoyo que ataca,
que deja de contar mientras esté socavado (`balance_pesos`).

- "en contra pesa": si enContra >= aFavor y enContra > 0: muy baja.
- "peso mínimo para baja": aFavor >= 1.0 (dos revisiones narrativas suman
  0.6 y no llegan).
- "peso mínimo para moderada": aFavor >= 1.5 y enContra <= aFavor / 2.
- "peso mínimo para alta": aFavor >= 2.5 y enContra <= aFavor / 3.

El nivel final es el menor entre el que da la estructura y el que da el peso,
y el motivo dice cuál de los dos frena. Lo que no apoya no cuenta como apoyo:
una afirmación que contradice, una que socava y una socavada quedan fuera de
las sostenidas que sostienen el techo, y una fuente cuyas afirmaciones
emparejables son todas de esa clase no aporta cohorte. Una fuente sin ninguna
afirmación emparejable (registros anteriores a la acumulación de evidencia)
sigue contando, porque no se puede afirmar lo contrario. Un registro antiguo
sin relación, sin tipo de estudio o sin riesgo de sesgo pesa 1.0 por cada
factor ausente: da exactamente lo que daba antes de esta regla. Una relación
vacía ("" o None) es la de origen; `socavadaPor` se acepta como lista o como
una sola cadena.

Emparejar una afirmación con su fuente (`fuente_de`): por `fuenteId` si lo
trae; si no, porque su cita empieza por "[" + referencia (la cita se construye
como "[referencia, localizador]"). Cuando varias referencias encajan gana la
más larga ("Kim et al., 2025, Nature" antes que "Kim et al., 2025"). Dos
fuentes con la misma referencia (dos artículos del mismo primer autor y año)
o con el mismo id (el mismo artículo citado en varias páginas) son una sola
identidad a efectos de emparejar: la afirmación empareja con todas. Para
contar fuentes (las que no tienen la cohorte identificada) la identidad es
el id si lo hay y, si no, la referencia (la precedencia de siempre: dos
artículos distintos del mismo primer autor y año con ids distintos son dos
fuentes), y además las entradas del mismo artículo (`claves_de_fuente`,
abajo) son una.

Mismo artículo, dos entradas (S-06, 17 de septiembre de 2026): cuando el
mismo artículo se registró en dos corridas llega a la hipótesis con dos
`fuenteId` distintos y, a veces, con dos nombres de cohorte distintos (Raket
2026 como "TRAILBLAZER-ALZ (NCT...)" y como "donanemab trial"), y el techo
contaba tres cohortes donde había dos. Las entradas que comparten un
identificador bibliográfico (`claves_de_fuente`: DOI, PMID, NCT o título de
20 caracteres o más, la misma regla con la que rosa/bucle/pasos.py reconoce
una fuente ya vista) son el mismo artículo y aportan una sola cohorte: la
del primer nombre que resuelve al catálogo de rosa/metodos.py o, si ninguno
resuelve, el primero. Dos entradas con el mismo id y cohortes distintas
siguen contando dos cohortes (el registro dice que el artículo trabaja con
dos), porque ahí no hay duda de identidad sino dos cohortes declaradas:
cada identificador bibliográfico enlaza una sola entrada por id (la
primera), así que compartir el DOI, que `_fuente_publica` copia en todas
las entradas de una misma fuente, no las funde entre sí.

Todo lo que se
compara con una tabla (relación, diseño, riesgo de sesgo) se normaliza a
minúsculas sin espacios alrededor; un valor que no es texto se convierte a
texto y, si no se reconoce, no penaliza ni cuenta. Nada de lo que llega
rompe: una hipótesis o una afirmación que no sea un diccionario vale como
vacía.

Una hipótesis nueva de ROSA2018 arranca casi siempre en muy baja y no es un
fallo: es el punto de partida de toda hipótesis que nadie ha probado. La
escalera dice qué le falta para el siguiente nivel, por regla, para que la
persona vea el camino en vez de una etiqueta roja; cuando lo que frena es el
peso, lo dice (apoyos de más peso, o resolver la evidencia en contra). Los
peldaños son consecutivos: cada uno da por cumplido lo que pidieron los
anteriores (la segunda cohorte, la evidencia directa y la réplica aportan
como mucho un apoyo de peso entero, 1.0, y el peso que un peldaño exigió
queda alcanzado para el siguiente), así que solo avisa del peso cuando
seguiría faltando después. La evidencia en contra que hoy frena se dice
siempre, porque está ahí. Cuando ni la estructura ni el peso frenan un
peldaño y fue el juez quien se quedó abajo, el peldaño nombra los factores
reales con los que bajó (`factores_que_bajan`), no uno genérico (M-06).
15 y 16 de septiembre de 2026.

Lo que sale de aquí para la conclusión (17 de septiembre de 2026):

- `acotar` devuelve además `techo.cohortesDistintas`, la lista que contó,
  para que la conclusión la lleve desde que se escribe (M-04).
- `frase_plantilla` es la frase calibrada de (dirección, certeza); con
  dirección "sin_evidencia_directa" distingue "no encontramos evidencia
  directa" (ninguna afirmación a favor) de "solo encontramos evidencia
  indirecta" (todos los apoyos en otra población, marcador o desenlace),
  con el recuento (M-06). El motivo del techo también lo dice al juez.
- `reacotar_conclusion` rehace techo, certeza (`min(juez, techo)`),
  escalera, cohortes y frase de una conclusión ya escrita, sin juez, con
  los factores guardados, y deja el mismo rastro que deja el cierre cuando
  escribe una conclusión: si la certeza cambia, `cambio` y `recalculadaEn`
  (lo que la interfaz lee para enseñar que cambió) y una línea con fecha en
  el registro de procedencia; si solo cambia el techo o la frase, la línea.
  Es la única implementación del recálculo por regla:
  `priorizacion.reacotar_conclusiones` la recorre al cerrar cada iteración
  (`marcar_candidatas`) y da el evento cuando una certeza baja, y
  rosa/bucle/corrida.py `recalcular_conclusiones_por_regla` debe delegar
  en ella (M-10, S-06, M-01, M-14). La frase se vuelve a generar también
  cuando la certeza no se mueve pero la plantilla de hoy dice otra cosa
  ("solo evidencia indirecta" donde antes decía "no encontramos evidencia
  directa"), y solo si la frase guardada es una plantilla
  (`es_frase_plantilla`): un texto de persona o de modelo no se toca (M-06).
"""

from __future__ import annotations

import numbers
import re
import time
from datetime import datetime, timezone
from typing import Any

NIVELES = ("muy_baja", "baja", "moderada", "alta")
CLASES_DIRECTAS = ("observacion_original", "derivado")
VEREDICTOS_QUE_CUENTAN = ("sostenida", "parcial")
# La relación None es la de las afirmaciones que motivaron el nacimiento (de origen).
RELACIONES_APOYO = (None, "apoya", "apoya_indirecta")

PESO_RELACION: dict[str | None, float] = {"apoya": 1.0, "apoya_indirecta": 0.5, "contradice": -1.0, "socava": 0.0, None: 1.0}
# Solo penaliza lo conocido como débil; el resto de diseños y el desconocido pesan 1.0.
PESO_DISENO: dict[str, float] = {"revision_narrativa": 0.3, "otro": 0.5, "serie_de_casos": 0.5, "in_vitro": 0.6, "preclinico": 0.6, "transversal": 0.8}
PESO_SESGO: dict[str, float] = {"alto": 0.5, "algunas_dudas": 0.8}
# Una afirmación tomada de la introducción o los antecedentes de un artículo
# resume trabajo ajeno: es una revisión narrativa dentro del artículo, no un
# resultado de su cohorte. Pesa como tal y no aporta cohorte (M-10, 17 de
# septiembre de 2026: eran el 47 % del peso a favor en 11 hipótesis).
PESO_SECCION_FONDO = 0.25
# La sección puede venir numerada ("sección 1. Introduction", "sección 2 BACKGROUND").
_SECCION_FONDO = re.compile(r"secci[oó]n\s+(?:\d+(?:\.\d+)*\.?\s+)?(?:Introduction|Background|Introducci[oó]n|Antecedentes)\b", re.I)
# Fichero de laboratorio de prueba aunque falte la bandera (S-18). Es la única
# copia de la regla: rosa/estado/acciones.py (`es_fichero_sintetico`) la importa
# de aquí. Delatan un fichero de prueba: "sintético"/"synthetic" en cualquier
# posición; "dummy", "fake" o "mock" como palabra (el guion bajo cuenta como
# separador, que es lo normal en un nombre de fichero); "de prueba" o "datos
# prueba" como locución; y "prueba" solo como nombre entero del fichero
# ("prueba.csv", "prueba_2.csv"). NO delatan: "prueba" suelta ("prueba_cognitiva_MMSE.csv",
# "resultados_prueba_ELISA.csv": en clínica "prueba" es un ensayo o un test real)
# ni "humo"/"smoke" ("exposicion_humo_tabaco.csv" es un dato real). La regla
# solo fuerza a sintético; un falso positivo tiraría evidencia real en silencio,
# así que se prefiere no acertar un fichero de prueba mal nombrado (la casilla
# de la ficha sigue mandando) a descartar uno real.
NOMBRE_SINTETICO = re.compile(
    r"sint[eé]tic|synthetic"
    r"|(?<![a-z0-9])(?:dummy|fake|mock)(?![a-z0-9])"
    r"|(?<![a-z0-9])(?:datos?|data)[_\- ]?(?:de[_\- ]?)?prueba(?![a-z0-9])"
    r"|(?<![a-z0-9])de[_\- ]prueba(?![a-z0-9])"
    r"|^\s*prueba(?:[_\- ]?\d+)?\.[a-z0-9]+\s*$",
    re.I,
)
_NOMBRE_SINTETICO = NOMBRE_SINTETICO
PESO_N: dict[str, float] = {"menos_de_20": 0.7, "de_20_a_99": 0.9, "100_o_mas": 1.0, "desconocido": 1.0}
# Por nivel: (peso mínimo a favor, divisor máximo de la evidencia en contra respecto a la a favor).
UMBRALES_PESO: dict[str, tuple[float, int | None]] = {"baja": (1.0, None), "moderada": (1.5, 2), "alta": (2.5, 3)}

ETIQUETAS_RELACION: dict[str | None, str] = {None: "de origen", "apoya": "a favor", "apoya_indirecta": "apoyo indirecto", "contradice": "en contra", "socava": "socava un apoyo"}
ETIQUETAS_DISENO = {
    "revision_sistematica": "revisión sistemática", "ensayo_aleatorizado": "ensayo aleatorizado", "cohorte": "cohorte", "caso_control": "casos y controles",
    "transversal": "transversal", "serie_de_casos": "serie de casos", "preclinico": "preclínico", "in_vitro": "in vitro", "revision_narrativa": "revisión narrativa",
    "registro": "registro", "otro": "sin diseño reconocido",
}
ETIQUETAS_SESGO = {"bajo": "riesgo de sesgo bajo", "algunas_dudas": "algunas dudas de sesgo", "alto": "riesgo de sesgo alto"}
# Los factores GRADE que escribe el juez (rosa/modulos/firmas.py FactorCerteza), en castellano.
ETIQUETAS_FACTOR = {
    "riesgo_de_sesgo": "riesgo de sesgo", "inconsistencia": "inconsistencia", "evidencia_indirecta": "evidencia indirecta", "imprecision": "imprecisión",
    "sesgo_de_publicacion": "sesgo de publicación", "efecto_grande": "efecto grande", "gradiente": "gradiente dosis-respuesta", "replicacion_independiente": "replicación independiente",
}
# Prefijos que se quitan a un DOI antes de compararlo ("https://doi.org/10.1/x" y "doi: 10.1/x" son el mismo).
_PREFIJO_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.I)
# Frases plantilla de la conclusión por (dirección, certeza), como las tablas de
# Santesso 2020 y Cochrane Iberoamérica. Misma tabla que rosa/bucle/corrida.py;
# la copia canónica es esta, para que 'probablemente' signifique siempre lo mismo.
VERBO_CERTEZA = {"alta": "La evidencia reunida sostiene que", "moderada": "La evidencia reunida probablemente sostiene que", "baja": "La evidencia sugiere, con limitaciones, que", "muy_baja": "La evidencia es muy incierta sobre si"}
VERBO_CONTRA = {"alta": "La evidencia reunida contradice que", "moderada": "La evidencia reunida probablemente contradice que", "baja": "La evidencia sugiere, con limitaciones, que no se cumple que", "muy_baja": "La evidencia es muy incierta sobre si"}
# La subcadena común a las tres formas con que la frase dice que un supuesto del
# que depende la hipótesis está contradicho ("aunque un ...", ", y un ...", ";
# además, un ..."): el recálculo por regla la busca en el enunciado guardado
# para conservar el aviso, igual que rosa/bucle/corrida.py.
MARCA_SUPUESTO_CONTRADICHO = "supuesto del que depende está contradicho"
_MOTIVO_BAJO_PESO_BAJA = "los apoyos son de bajo peso (revisiones narrativas, sesgo alto o muestras pequeñas)"
_MOTIVOS_RELACION = {
    None: "de origen (motivó el nacimiento de la hipótesis): cuenta entera",
    "apoya": "a favor (misma población, marcador y sentido): cuenta entera",
    "apoya_indirecta": "apoyo indirecto (otra población, desenlace o plataforma): cuenta la mitad",
    "contradice": "en contra (misma población y marcador, sentido contrario o sin efecto): resta entera",
    "socava": "socava un apoyo: no pesa por sí misma, descuenta el apoyo que ataca",
}
# Lo que puede seguir a la referencia dentro de una cita "[referencia, localizador]".
_DELIMITADORES_CITA = ",;:] ."
# Misma lista que rosa/metodos.py `_GENERICOS_COHORTE`, que es la que hoy agrupa; se conserva para quien la importe.
_GENERICOS_COHORTE = {"cohorte", "cohort", "study", "estudio", "longitudinal", "portadores", "familias", "alzheimer", "disease", "enfermedad", "mutaciones", "carriers", "participantes", "pacientes", "et", "al", "the", "of", "de", "del", "la", "los", "las", "con", "and", "familial", "autosomal", "dominant", "autosómico", "dominante", "ensayo", "ensayos", "trial", "trials"}


def _tokens_cohorte(nombre: str) -> set[str]:
    limpio = re.sub(r"\(.*?\)", " ", (nombre or "").lower())
    return {t for t in re.findall(r"[a-záéíóúñ0-9][a-záéíóúñ0-9\-]{2,}", limpio) if t not in _GENERICOS_COHORTE}


def _norm(t: Any) -> str:
    return re.sub(r"\s+", " ", str(t or "")).strip().lower()


def _nivel_texto(nivel: str) -> str:
    return nivel.replace("_", " ")


def _dict(x: Any) -> dict[str, Any]:
    """Un diccionario o, si no lo es (None, texto, lista), uno vacío."""
    return x if isinstance(x, dict) else {}


def _dicts(x: Any) -> list[dict[str, Any]]:
    """Los diccionarios de una lista; cualquier otra cosa vale como lista vacía."""
    return [d for d in x if isinstance(d, dict)] if isinstance(x, (list, tuple)) else []


def _fuentes(h: Any) -> list[dict[str, Any]]:
    return _dicts(_dict(_dict(h).get("procedencia")).get("fuentes"))


def _afirmaciones(h: Any) -> list[dict[str, Any]]:
    return _dicts(_dict(h).get("afirmaciones"))


def _nombre_cohorte(f: dict[str, Any]) -> str:
    """El nombre de la cohorte de una fuente como texto limpio; vacío si no
    consta, no es texto o no identifica ninguna cohorte (un cuantificador
    plural, o una bolsa de tres o más sistemas en la misma cadena; la regla
    está en `rosa/metodos.py`). Vacío quiere decir «esta fuente no aporta
    cohorte independiente», y el motivo del techo lo cuenta aparte."""
    from rosa import metodos as METODOS  # import local: metodos no puede importar certeza

    nombre = f.get("cohorte")
    if not isinstance(nombre, str) or not nombre.strip():
        return ""
    try:
        return METODOS._nombre_identificado(nombre.strip())
    except Exception:  # noqa: BLE001  un nombre raro no tumba el techo
        return nombre.strip()


def claves_de_fuente(f: Any) -> set[str]:
    """Identificadores normalizados con los que se reconoce que dos entradas
    son el mismo artículo: "doi:...", "pmid:...", "nct:..." y "titulo:..."
    (título de 20 caracteres o más, en minúsculas y sin puntuación). Es la
    misma regla con la que rosa/bucle/pasos.py (`claves_de_fuente`) reconoce
    una fuente ya vista al registrarla; aquí vive la copia canónica para el
    techo (S-06, 17 de septiembre de 2026). Nunca devuelve la cadena vacía:
    dos entradas sin nada en común no se funden. Lo que no es texto ni número
    (None, listas, booleanos) no da clave; un registro raro no rompe."""
    f = _dict(f)
    claves: set[str] = set()
    doi = f.get("doi")
    if isinstance(doi, str):
        d = _PREFIJO_DOI.sub("", doi.strip().lower()).rstrip(".").strip()
        if d:
            claves.add(f"doi:{d}")
    for campo in ("pmid", "nct"):
        v = f.get(campo)
        if isinstance(v, bool) or not isinstance(v, (str, int)):
            continue
        t = str(v).strip().lower()
        if t:
            claves.add(f"{campo}:{t}")
    titulo = f.get("titulo")
    if isinstance(titulo, str):
        t = re.sub(r"[^a-z0-9]+", " ", titulo.lower()).strip()
        if len(t) >= 20:
            claves.add(f"titulo:{t}")
    return claves


def _clave(v: Any) -> str | None:
    """Un valor que se compara con una tabla (relación, diseño, juicio de
    sesgo): texto en minúsculas sin espacios alrededor; None si está vacío.
    Lo que no es texto se convierte a texto para que nunca rompa una búsqueda
    en un diccionario; si no se reconoce, no cuenta ni penaliza."""
    if v is None or isinstance(v, bool):
        return None if v is None else str(v).lower()
    if isinstance(v, str):
        limpio = v.strip().lower()
        return limpio or None
    return str(v).strip().lower() or None


def _hashable(v: Any) -> bool:
    try:
        hash(v)
    except TypeError:
        return False
    return True


def etiqueta_relacion(rel: str | None) -> str:
    """La relación de una afirmación con la hipótesis en castellano: 'a favor',
    'apoyo indirecto', 'en contra', 'socava un apoyo' o 'de origen' (None o
    vacío, la que motivó el nacimiento)."""
    return ETIQUETAS_RELACION.get(_clave(rel), "relación sin clasificar")


def _relacion(a: dict[str, Any]) -> str | None:
    """La relación tal como cuenta: una clave ausente o vacía es None (de
    origen, la que motivó el nacimiento); el resto, en minúsculas."""
    return _clave(a.get("relacion"))


def _socavadores(a: dict[str, Any]) -> list[Any]:
    """Quiénes socavan esta afirmación: `socavadaPor` como lista; una cadena
    suelta cuenta como una. Vacío o ausente: nadie."""
    v = _dict(a).get("socavadaPor")
    if not v:
        return []
    if isinstance(v, (list, tuple, set, frozenset)):
        return list(v)
    return [v]


def socavada(a: dict[str, Any]) -> bool:
    """True si otra afirmación ataca el método o la inferencia de esta
    (`socavadaPor` no vacío): mientras lo esté, no cuenta como apoyo."""
    return bool(_socavadores(a))


def es_abstencion(a: dict[str, Any]) -> bool:
    """La afirmación declara que algo no se pudo comprobar, o que no se
    encontró dentro de lo leído. Es honesta y su veredicto es `sostenida`,
    porque su cita no falla; pero no afirma nada del mundo y no puede contar
    como evidencia a favor.

    Sin esto (28 de septiembre de 2026), tres frases que dicen "no pude
    comprobar" sumaban 3,0 de peso, que es el umbral de `alta`, y el techo
    subía a `baja` por tener tres cohortes distintas. ROSA2018 podía escribir
    "la evidencia sugiere que..." apoyándose en declaraciones de ignorancia.

    Los registros anteriores a la marca se reconocen por el motivo que escribió
    el verificador, que es la única señal que tenían."""
    if not isinstance(a, dict):
        return False
    if a.get("abstencion"):
        return True
    motivo = str(a.get("motivo") or "")
    return motivo.startswith("Declaración honesta de comprobación no hecha") or motivo.startswith("Declaración de ausencia sin contradicción")


def es_sintetica(a: dict[str, Any]) -> bool:
    """La afirmación es de un ensayo en seco y no cuenta como evidencia: lleva
    `sintetico` verdadero, o es un dato directo (laboratorio o análisis) cuyo
    fichero o cita delatan que es de prueba aunque la bandera falte o sea
    falsa (registros anteriores al 17 de septiembre de 2026, S-18). Una
    afirmación de literatura nunca se marca por su cita: un artículo puede
    hablar de datos sintéticos y ser real."""
    a = _dict(a)
    if a.get("sintetico"):
        return True
    if a.get("tipo") != "dato" or _clave(a.get("clase")) not in CLASES_DIRECTAS:
        return False
    tray = a.get("trayectoria")
    fichero = str(_dict(tray).get("id") or "") if isinstance(tray, dict) else str(tray or "")
    cita = str(a.get("cita") or "")
    return bool(_NOMBRE_SINTETICO.search(fichero)) or (cita.lstrip().startswith("[Datos") and bool(_NOMBRE_SINTETICO.search(cita)))


def de_fondo(a: dict[str, Any]) -> bool:
    """La afirmación sale de la introducción o los antecedentes del artículo
    (`deFondo`, que escribe el extractor desde el localizador del fragmento);
    para registros sin la clave, se lee de la cita ("sección Introduction",
    "sección Background", "Introducción", "Antecedentes"). Un `deFondo` falso
    explícito manda sobre la cita. La discusión no cuenta como fondo: los
    autores hablan ahí de sus propios datos."""
    a = _dict(a)
    v = a.get("deFondo")
    if isinstance(v, bool):
        return v
    return bool(_SECCION_FONDO.search(str(a.get("cita") or "")))


def juicio_sesgo_util(riesgo: Any) -> tuple[str | None, str]:
    """(clave del juicio que cuenta para el peso, motivo). Desde el 17 de
    septiembre de 2026 (M-01) "sin información" no es "riesgo alto": la regla
    vive en rosa/sesgo.py `juicio_util` (una sola para el peso GRADE y para la
    comprobación `sesgo_evidencia` del Killer) y aquí solo se traduce a las
    claves de PESO_SESGO. Solo puede rebajar la penalización, nunca subirla."""
    from rosa import sesgo as SESGO

    juicio, motivo = SESGO.juicio_util(riesgo)
    if juicio is not None and juicio not in PESO_SESGO and juicio != "bajo":
        return None, "riesgo de sesgo sin evaluar"
    return juicio, motivo


def _cortes(cuerpo: str) -> list[int]:
    """Las longitudes de prefijo de una cita que pueden ser una referencia
    entera: hasta el final o hasta justo antes de un delimitador, de la más
    larga a la más corta (gana la referencia más larga que encaje)."""
    cortes = [k for k, c in enumerate(cuerpo) if k > 0 and c in _DELIMITADORES_CITA]
    cortes.append(len(cuerpo))
    return sorted(set(cortes), reverse=True)


def _representantes(n: int, lazos: list[list[int]]) -> list[int]:
    """Para cada posición de 0 a n-1, el representante (la menor posición) del
    grupo al que la unen los `lazos` (listas de posiciones que van juntas).
    Unión-búsqueda lineal; sin lazos, cada posición es su propio grupo."""
    padre = list(range(n))

    def raiz(i: int) -> int:
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    for lazo in lazos:
        for j in lazo[1:]:
            a, b = raiz(lazo[0]), raiz(j)
            if a != b:
                padre[max(a, b)] = min(a, b)
    return [raiz(i) for i in range(n)]


class _Indice:
    """Las fuentes de una hipótesis indexadas por id y por referencia
    normalizada, para emparejar cada afirmación en tiempo constante. Las
    fuentes que comparten id o referencia son una identidad: la afirmación
    empareja con todas. Dos identidades más, calculadas una vez:

    - `grupo[j]`: la identidad para contar fuentes: el id si lo hay y, si no,
      la referencia (la precedencia de siempre: dos artículos distintos del
      mismo primer autor y año con ids distintos son dos fuentes), más el
      identificador bibliográfico (`claves_de_fuente`). La cuenta de fuentes
      sin cohorte no repite una identidad.
    - `articulo[j]`: solo por identificador bibliográfico (DOI, PMID, NCT,
      título): dos entradas del mismo artículo con ids distintos aportan una
      sola cohorte (S-06). Cada clave enlaza una sola entrada por id (la
      primera), así que el mismo id con dos cohortes declaradas no se funde
      por compartir el DOI: son dos cohortes del mismo registro."""

    def __init__(self, fuentes: list[dict[str, Any]]) -> None:
        self.fuentes = fuentes
        self.por_id: dict[Any, list[int]] = {}
        self.por_ref: dict[str, list[int]] = {}
        por_ref_sin_id: dict[str, list[int]] = {}
        por_clave: dict[str, list[int]] = {}
        ids_por_clave: dict[str, set[Any]] = {}
        for j, f in enumerate(fuentes):
            fid = f.get("id")
            con_id = bool(fid) and _hashable(fid)
            ref = _norm(f.get("referencia")).rstrip(".")
            if con_id:
                self.por_id.setdefault(fid, []).append(j)
            if ref:
                self.por_ref.setdefault(ref, []).append(j)
                if not con_id:
                    por_ref_sin_id.setdefault(ref, []).append(j)
            for clave in claves_de_fuente(f):
                if con_id:
                    ids = ids_por_clave.setdefault(clave, set())
                    if fid in ids:
                        continue
                    ids.add(fid)
                por_clave.setdefault(clave, []).append(j)
        lazos_articulo = [lst for lst in por_clave.values() if len(lst) > 1]
        self.articulo: list[int] = _representantes(len(fuentes), lazos_articulo)
        lazos_grupo = lazos_articulo + [lst for lst in self.por_id.values() if len(lst) > 1] + [lst for lst in por_ref_sin_id.values() if len(lst) > 1]
        self.grupo: list[int] = _representantes(len(fuentes), lazos_grupo)

    def resolver(self, a: dict[str, Any]) -> list[int]:
        """Los índices de las fuentes con las que empareja la afirmación; []
        si ninguna."""
        fid = a.get("fuenteId")
        if fid and _hashable(fid) and fid in self.por_id:
            return self.por_id[fid]
        cita = _norm(a.get("cita"))
        if not cita or not self.por_ref:
            return []
        cuerpos = (cita[1:], cita) if cita.startswith("[") else (cita,)
        for cuerpo in cuerpos:
            for k in _cortes(cuerpo):
                encontrados = self.por_ref.get(cuerpo[:k])
                if encontrados:
                    return encontrados
        return []


def fuente_de(h: dict[str, Any], a: dict[str, Any]) -> dict[str, Any] | None:
    """La fuente de la procedencia de la que viene la afirmación: por
    `fuenteId` si lo trae, o porque su cita empieza por "[" + referencia de la
    fuente (sin distinguir mayúsculas ni espacios; gana la referencia más
    larga que encaje). Si varias fuentes comparten id o referencia, la
    primera. None si no se puede emparejar: entonces ni el diseño ni el sesgo
    la penalizan."""
    if not isinstance(a, dict):
        return None
    indice = _Indice(_fuentes(h))
    encontrados = indice.resolver(a)
    return indice.fuentes[encontrados[0]] if encontrados else None


def _entero(valor: Any) -> int | None:
    """El n como entero si se puede leer ("120", "n = 120", "104 participantes",
    120, 120.0, un entero de numpy); None si no consta."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, numbers.Integral):
        return int(valor)
    if isinstance(valor, numbers.Real):
        try:
            v = float(valor)
        except (TypeError, ValueError, OverflowError):
            return None
        return int(v) if v.is_integer() else None
    if not isinstance(valor, str):
        return None
    # Un número con signo menos delante ("-5") no es un n válido: no se lee.
    m = re.search(r"(?<![\d-])\d+(?:[.,]\d{3})*(?!\d)", valor)
    if not m:
        return None
    return int(re.sub(r"[.,]", "", m.group(0)))


def _tramo_n(n: int | None) -> str:
    """Un n que no consta o no es válido (cero o negativo) no penaliza."""
    if n is None or n <= 0:
        return "desconocido"
    if n < 20:
        return "menos_de_20"
    if n < 100:
        return "de_20_a_99"
    return "100_o_mas"


def _factor_relacion(a: dict[str, Any]) -> tuple[float, str]:
    """La magnitud con signo que aporta la relación, o 0 con el motivo por el
    que la afirmación no cuenta (sintética, no sostenida, socavada, socava)."""
    rel = _relacion(a)
    if es_sintetica(a):
        return 0.0, "sintética (ensayo en seco o fichero de prueba): no cuenta como evidencia"
    if es_abstencion(a):
        return 0.0, "declara que no se pudo comprobar algo, o que no se encontró en lo leído: no afirma nada del mundo"
    if a.get("veredicto") not in VEREDICTOS_QUE_CUENTAN:
        return 0.0, f"veredicto {a.get('veredicto') or 'sin veredicto'}: solo cuentan las sostenidas o parciales"
    if socavada(a):
        cuantas = len(_socavadores(a))
        return 0.0, f"{etiqueta_relacion(rel)}, pero socavada por {cuantas} {'afirmación que ataca' if cuantas == 1 else 'afirmaciones que atacan'} su método o su inferencia: no cuenta mientras no se resuelva"
    if rel not in PESO_RELACION:
        return 0.0, f"relación '{rel}' sin clasificar: no cuenta"
    return PESO_RELACION[rel], _MOTIVOS_RELACION[rel]


def peso_afirmacion(a: dict[str, Any], fuente: dict[str, Any] | None = None) -> dict[str, Any]:
    """{peso, factores}: el peso de una afirmación como evidencia y por qué.
    Producto de la magnitud de la relación por el diseño, el sesgo, el n y la
    sección (0,25 si es una frase de la introducción o los antecedentes),
    con el signo de la relación; 0 si socava, si está socavada, si es
    sintética o si no está sostenida. Cada factor: {factor, valor, motivo}."""
    a = _dict(a)
    fuente = fuente if isinstance(fuente, dict) else None
    magnitud, motivo_rel = _factor_relacion(a)
    factores: list[dict[str, Any]] = [{"factor": "relacion", "valor": magnitud, "motivo": motivo_rel}]

    tipo = _clave((fuente or {}).get("tipoEstudio"))
    if fuente is None:
        d, motivo_d = 1.0, "sin fuente emparejada: el diseño no se penaliza"
    elif not tipo:
        d, motivo_d = 1.0, "diseño del estudio sin clasificar: no se penaliza"
    else:
        d = PESO_DISENO.get(tipo, 1.0)
        motivo_d = f"{ETIQUETAS_DISENO.get(tipo, tipo)}: " + ("no se penaliza" if d == 1.0 else f"pesa {d:g}")
    factores.append({"factor": "diseno", "valor": d, "motivo": motivo_d})

    if fuente is None:
        s, motivo_s = 1.0, "sin fuente emparejada: el sesgo no se penaliza"
    else:
        global_, por_que = juicio_sesgo_util(fuente.get("riesgoSesgo"))
        if global_ not in PESO_SESGO and global_ != "bajo":
            s, motivo_s = 1.0, "riesgo de sesgo sin evaluar: no se penaliza" + (f" ({por_que})" if global_ is None and "sin información" in por_que else "")
        else:
            s = PESO_SESGO.get(global_, 1.0)
            motivo_s = f"{ETIQUETAS_SESGO.get(global_, global_)}: " + ("no se penaliza" if s == 1.0 else f"pesa {s:g}")
    factores.append({"factor": "sesgo", "valor": s, "motivo": motivo_s})

    n = _entero(a.get("n"))
    tramo = _tramo_n(n)
    pn = PESO_N[tramo]
    if tramo == "desconocido":
        motivo_n = "n desconocido o no válido: no se penaliza"
    elif pn == 1.0:
        motivo_n = f"n = {n}: no se penaliza"
    else:
        motivo_n = f"n = {n}: {'muestra pequeña' if tramo == 'menos_de_20' else 'muestra mediana (de 20 a 99)'}, pesa {pn:g}"
    factores.append({"factor": "n", "valor": pn, "motivo": motivo_n})

    # El factor "seccion" solo aparece cuando aplica (una frase de introducción o
    # antecedentes): las afirmaciones de resultados siguen con sus cuatro factores.
    sec = 1.0
    if de_fondo(a):
        sec = PESO_SECCION_FONDO
        factores.append({"factor": "seccion", "valor": sec, "motivo": f"frase de la introducción o los antecedentes (resume estudios ajenos, no un resultado de esta cohorte): pesa {PESO_SECCION_FONDO:g} y no aporta cohorte"})

    signo = -1.0 if magnitud < 0 else 1.0
    peso = signo * abs(magnitud) * d * s * pn * sec
    return {"peso": round(peso, 4) + 0.0, "factores": factores}


def _supuestos_contradichos(h: Any) -> list[str]:
    """Los textos de los supuestos que una evaluación dejó en `contradicho`.
    Un registro raro (sin lista, con entradas que no son diccionarios) da lista
    vacía: un supuesto mal formado no debe tumbar una hipótesis por accidente."""
    if not isinstance(h, dict):
        return []
    fuera = h.get("supuestos")
    if not isinstance(fuera, list):
        return []
    return [str(s.get("texto") or "").strip() for s in fuera if isinstance(s, dict) and s.get("estado") == "contradicho"]


class _Vista:
    """Una sola pasada sobre la hipótesis: afirmaciones, fuentes, con qué
    fuente empareja cada afirmación y cuánto pesa. Todo lo que calcula el
    módulo sale de aquí, así que el coste crece con el tamaño del registro,
    no con su cuadrado."""

    def __init__(self, h: Any) -> None:
        self.fuentes = _fuentes(h)
        self.afs = _afirmaciones(h)
        self.indice = _Indice(self.fuentes)
        self.emparejadas: list[list[int]] = [self.indice.resolver(a) for a in self.afs]
        self.pesos: list[dict[str, Any]] = [peso_afirmacion(a, self.fuente_principal(i)) for i, a in enumerate(self.afs)]
        reales = [i for i, a in enumerate(self.afs) if a.get("veredicto") in VEREDICTOS_QUE_CUENTAN and not es_sintetica(a) and not es_abstencion(a)]
        self.apoyos: list[int] = [i for i in reales if _relacion(self.afs[i]) in RELACIONES_APOYO and not socavada(self.afs[i])]
        # Apoyos que son frases de introducción: pesan 0,25 y no dan cohorte a su fuente.
        self.apoyos_de_fondo: set[int] = {i for i in self.apoyos if de_fondo(self.afs[i])}
        self.contras: list[int] = [i for i in reales if _relacion(self.afs[i]) == "contradice"]
        # Los supuestos contradichos: el techo los mira (28 de septiembre de 2026).
        # Hasta hoy este módulo no leía `supuestos` en ningún punto, así que una
        # hipótesis cuyo supuesto central ROSA2018 había probado falso salía con
        # certeza «baja / apoya» y así llegó a un dossier (SULF2, corrida
        # `cor-mulntlr0-42`). La regla ya existía en el Killer ("solo un supuesto
        # contradicho tumba"); aquí no estaba.
        self.supuestos_contradichos: list[str] = _supuestos_contradichos(h)
        self.socavadas = sum(1 for i in reales if socavada(self.afs[i]))
        self.socavan = sum(1 for i in reales if _relacion(self.afs[i]) == "socava")

    def fuente_principal(self, i: int) -> dict[str, Any] | None:
        encontrados = self.emparejadas[i]
        return self.fuentes[encontrados[0]] if encontrados else None

    def indices_que_cuentan(self) -> list[int]:
        """Posiciones (en `self.fuentes`) de las fuentes que aportan cohorte:
        las que tienen al menos un apoyo no socavado emparejado que no sea una
        frase de introducción, y las que no tienen ninguna afirmación
        emparejable (no se puede afirmar que no apoyen). Una fuente cuyas
        afirmaciones emparejables son todas en contra, socavan, están
        socavadas, no están sostenidas o son de fondo (resumen de estudios
        ajenos) no cuenta."""
        if not self.afs:
            return list(range(len(self.fuentes)))
        de_apoyo = set(self.apoyos) - self.apoyos_de_fondo
        con_afirmacion: set[int] = set()
        con_apoyo: set[int] = set()
        for i, encontrados in enumerate(self.emparejadas):
            for j in encontrados:
                con_afirmacion.add(j)
                if i in de_apoyo:
                    con_apoyo.add(j)
        return [j for j in range(len(self.fuentes)) if j not in con_afirmacion or j in con_apoyo]

    def fuentes_que_cuentan(self) -> list[dict[str, Any]]:
        """Las fuentes que aportan cohorte (ver `indices_que_cuentan`)."""
        return [self.fuentes[j] for j in self.indices_que_cuentan()]

    def nombres_por_articulo(self) -> list[list[str]]:
        """Los nombres de cohorte de las fuentes que cuentan, agrupados por
        artículo (`_Indice.articulo`: mismo DOI, PMID, NCT o título), en el
        orden de la primera entrada de cada artículo. Las fuentes sin nombre
        de cohorte no entran."""
        grupos: dict[int, list[str]] = {}
        orden: list[int] = []
        for j in self.indices_que_cuentan():
            nombre = _nombre_cohorte(self.fuentes[j])
            if not nombre:
                continue
            r = self.indice.articulo[j]
            if r not in grupos:
                grupos[r] = []
                orden.append(r)
            grupos[r].append(nombre)
        return [grupos[r] for r in orden]

    def cohortes(self) -> list[str]:
        # Método como nodo (rosa/metodos.py): el catálogo canónico con alias decide
        # qué nombres son la misma cohorte; sin catálogo, la regla de tokens de siempre.
        # Antes, cada entrada del mismo artículo (dos fuenteId, mismo DOI) aportaba
        # su propia cohorte (S-06): ahora el artículo aporta una, con el primer
        # nombre que resuelve al catálogo o, si ninguno, el primero.
        from rosa import metodos as METODOS

        def representativo(nombres: list[str]) -> str:
            for nombre in nombres:
                try:
                    if METODOS.canonizar_cohorte(nombre):
                        return nombre
                except Exception:  # noqa: BLE001  un nombre raro no tumba el techo
                    continue
            return nombres[0]

        return METODOS.cohortes_distintas([{"id": f"c{k}", "cohorte": representativo(nombres)} for k, nombres in enumerate(self.nombres_por_articulo())])

    def indirectos(self) -> int:
        """Cuántos apoyos son indirectos (el mismo patrón en otra población,
        otro marcador u otro desenlace)."""
        return sum(1 for i in self.apoyos if _relacion(self.afs[i]) == "apoya_indirecta")

    def solo_indirectos(self) -> bool:
        """Hay apoyos y todos son indirectos: no hay ninguna afirmación en la
        misma población y marcador que la hipótesis."""
        return bool(self.apoyos) and self.indirectos() == len(self.apoyos)

    def fuentes_solo_de_fondo(self) -> int:
        """Cuántas fuentes tienen apoyos emparejados pero todos de introducción
        o antecedentes: se les descuenta la cohorte."""
        con_real: set[int] = set()
        con_fondo: set[int] = set()
        for i in self.apoyos:
            for j in self.emparejadas[i]:
                (con_fondo if i in self.apoyos_de_fondo else con_real).add(j)
        return len(con_fondo - con_real)

    def sin_cohorte(self) -> int:
        """Cuántas identidades de fuente que aportan apoyo no tienen cohorte
        en ninguna de sus entradas. La identidad es el id si lo hay y, si no,
        la referencia; las entradas del mismo artículo (`claves_de_fuente`)
        son una (`_Indice.grupo`)."""
        nombradas: set[int] = set()
        vistas: list[int] = []
        for j in self.indices_que_cuentan():
            r = self.indice.grupo[j]
            if r not in vistas:
                vistas.append(r)
            if _nombre_cohorte(self.fuentes[j]):
                nombradas.add(r)
        return sum(1 for r in vistas if r not in nombradas)

    def directa(self) -> list[dict[str, Any]]:
        """Apoyos que vienen de datos (laboratorio o análisis sobre datos reales).
        Lo sintético ya no está en `apoyos`; se repite el filtro por si acaso."""
        return [self.afs[i] for i in self.apoyos if self.afs[i].get("tipo") == "dato" and _clave(self.afs[i].get("clase")) in CLASES_DIRECTAS and not es_sintetica(self.afs[i])]

    def motivos_bajo_peso(self) -> list[str]:
        """Qué resta peso a los apoyos, sin repetir: revisión narrativa, sesgo
        alto, muestra pequeña, apoyo solo indirecto."""
        vistos: list[str] = []
        for i in self.apoyos:
            for f in self.pesos[i]["factores"]:
                if 0.0 < f["valor"] < 1.0 and f["motivo"] not in vistos:
                    vistos.append(f["motivo"])
        return vistos

    def balance(self) -> dict[str, Any]:
        a_favor = round(sum(self.pesos[i]["peso"] for i in self.apoyos), 3) + 0.0
        en_contra = round(abs(sum(self.pesos[i]["peso"] for i in self.contras)), 3) + 0.0
        n_ap, n_co = len(self.apoyos), len(self.contras)
        partes = [f"{n_ap} {'apoyo' if n_ap == 1 else 'apoyos'} con peso {a_favor:g} a favor", f"{n_co} en contra con peso {en_contra:g}"]
        if self.socavadas:
            partes.append(f"{self.socavadas} {'apoyo socavado que no cuenta' if self.socavadas == 1 else 'apoyos socavados que no cuentan'}" + (f" ({self.socavan} {'afirmación lo socava' if self.socavan == 1 else 'afirmaciones los socavan'})" if self.socavan else ""))
        restan = self.motivos_bajo_peso()
        if restan:
            partes.append("resta peso: " + "; ".join(restan))
        return {"aFavor": a_favor, "enContra": en_contra, "socavadas": self.socavadas, "detalle": ". ".join(partes)}


def apoyos(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las afirmaciones que sostienen la hipótesis: sostenidas o parciales, no
    sintéticas, de origen o a favor (directo o indirecto) y no socavadas."""
    v = _Vista(h)
    return [v.afs[i] for i in v.apoyos]


def contras(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las afirmaciones sostenidas o parciales que contradicen la hipótesis."""
    v = _Vista(h)
    return [v.afs[i] for i in v.contras]


def sostenidas_reales(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Afirmaciones sostenidas o parciales que cuentan como evidencia a favor:
    lo sintético (ensayo en seco) nunca cuenta, y desde el 16 de septiembre
    de 2026 tampoco las que contradicen, las que socavan ni las socavadas.
    Es `apoyos`; se conserva el nombre para quien ya lo usaba."""
    return apoyos(h)


def evidencia_directa(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las afirmaciones que vienen de datos, no de literatura: un resultado de
    laboratorio evaluado contra el prerregistro o un análisis in silico sobre
    datos reales."""
    return _Vista(h).directa()


def balance_pesos(h: dict[str, Any]) -> dict[str, Any]:
    """{aFavor, enContra, socavadas, detalle}: la suma de pesos de los apoyos,
    la de las que contradicen (en positivo), cuántos apoyos están socavados y
    un detalle en castellano de dónde sale cada cifra."""
    return _Vista(h).balance()


def cohortes_distintas(h: dict[str, Any]) -> list[str]:
    """Las cohortes nombradas en las fuentes de la hipótesis que aportan apoyo,
    agrupando los nombres que se refieren a la misma ("ADAD", "ADAD (Belder et
    al.)" y "Belder et al., cohorte ADAD" son una). Dos artículos de la misma
    cohorte son una sola evidencia; dos entradas del mismo artículo (mismo
    DOI, PMID, NCT o título, `claves_de_fuente`) son una sola fuente y aportan
    una sola cohorte aunque lleven ids y nombres distintos (S-06); una fuente
    sin cohorte identificada no cuenta como independiente, porque no se puede
    afirmar que lo sea; una fuente que solo contradice o socava no aporta
    cohorte."""
    return _Vista(h).cohortes()


def apoyos_indirectos(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Los apoyos cuya relación con la hipótesis es indirecta (el mismo patrón
    en otra población, otro marcador u otro desenlace)."""
    v = _Vista(h)
    return [v.afs[i] for i in v.apoyos if _relacion(v.afs[i]) == "apoya_indirecta"]


def solo_apoyo_indirecto(h: dict[str, Any]) -> bool:
    """True si la hipótesis tiene apoyos y todos son indirectos: no hay
    "nada", hay "solo evidencia indirecta", y la conclusión debe decirlo así
    (M-06: siete de nueve conclusiones decían "no encontramos evidencia
    directa" con seis a catorce afirmaciones sostenidas)."""
    return _Vista(h).solo_indirectos()


def fuentes_sin_cohorte(h: dict[str, Any]) -> int:
    """Cuántas fuentes que aportan apoyo no tienen la cohorte identificada (el
    mismo artículo citado en varias páginas cuenta una vez)."""
    return _Vista(h).sin_cohorte()


def efecto_grande_documentado(factores: list[Any]) -> bool:
    for f in factores or []:
        factor = f.get("factor") if isinstance(f, dict) else getattr(f, "factor", None)
        efecto = f.get("efecto") if isinstance(f, dict) else getattr(f, "efecto", None)
        if factor == "efecto_grande" and efecto == "sube":
            return True
    return False


def _frena_peso(a_favor: float, en_contra: float, nivel: str, restan: list[str] | None = None) -> str | None:
    """Por qué el peso no da para `nivel` ("peso mínimo para ..."), o None si
    da. `restan` son los factores que restan peso a los apoyos de hoy, para
    que el motivo diga cuáles."""
    minimo, divisor = UMBRALES_PESO[nivel]
    if a_favor < minimo:
        detalle = f" (resta peso: {'; '.join(restan)})" if restan else ""
        if nivel == "baja":
            return f"{_MOTIVO_BAJO_PESO_BAJA}: suman {a_favor:g} y baja exige al menos {minimo:g}{detalle}"
        return f"los apoyos pesan poco para {_nivel_texto(nivel)}: suman {a_favor:g} y hace falta al menos {minimo:g}{detalle}"
    if divisor and en_contra > a_favor / divisor:
        return f"la evidencia en contra ({en_contra:g}) pasa de {'la mitad' if divisor == 2 else 'un tercio'} de la a favor ({a_favor:g}), lo que {_nivel_texto(nivel)} no admite"
    return None


def _techo_peso(a_favor: float, en_contra: float) -> str:
    for nivel in ("alta", "moderada", "baja"):
        if _frena_peso(a_favor, en_contra, nivel) is None:
            return nivel
    return "muy_baja"


def _techo_estructura(v: _Vista, factores: list[Any] | None) -> tuple[str, str]:
    """El techo por la clase de evidencia que hay (cohortes, evidencia directa,
    efecto grande), dando por hecho que hay al menos un apoyo."""
    n = len(v.cohortes())
    directa = v.directa()
    sin = v.sin_cohorte()
    texto_cohortes = f"{n} cohortes distintas" if n >= 2 else ("una sola cohorte" if n == 1 else "ninguna cohorte identificada en las fuentes")
    if sin:
        texto_cohortes += f" ({sin} {'fuente' if sin == 1 else 'fuentes'} sin cohorte identificada, que no cuentan como independientes)"
    fondo = v.fuentes_solo_de_fondo()
    if fondo:
        texto_cohortes += f" ({fondo} {'fuente' if fondo == 1 else 'fuentes'} cuyos apoyos son frases de introducción, que no aportan cohorte)"
    # Que el juez vea que no hay ni una afirmación en la misma población y marcador
    # (M-06): eso es "solo evidencia indirecta", no "nada".
    n_apoyos = len(v.apoyos)
    indirecto = ("; el único apoyo es indirecto (el mismo patrón en otra población, otro marcador u otro desenlace): pesa la mitad" if n_apoyos == 1 else f"; los {n_apoyos} apoyos son todos indirectos (el mismo patrón en otra población, otro marcador u otro desenlace): pesan la mitad") if v.solo_indirectos() else ""
    if directa:
        clases = sorted(str(a.get("clase")) for a in directa)
        que = "resultado de laboratorio" if "observacion_original" in clases else "análisis sobre datos reales"
        if n >= 2:
            return "alta", f"hay evidencia directa ({que}) y {texto_cohortes}{indirecto}"
        return "moderada", f"hay evidencia directa ({que}) pero {texto_cohortes}: falta la réplica independiente{indirecto}"
    if n >= 2:
        return "baja", f"solo literatura, sin experimento ni análisis sobre datos reales, aunque de {texto_cohortes}{indirecto}"
    if efecto_grande_documentado(factores or []):
        return "baja", f"solo literatura de {texto_cohortes}, pero el juez documentó un efecto grande{indirecto}"
    return "muy_baja", f"solo literatura de {texto_cohortes}, sin réplica ni evidencia directa{indirecto}"


def _techo(v: _Vista, factores: list[Any] | None) -> tuple[str, str]:
    if v.supuestos_contradichos:
        cuantos = len(v.supuestos_contradichos)
        cual = v.supuestos_contradichos[0]
        cual = cual[:160] + "..." if len(cual) > 160 else cual
        resto = f" (y {cuantos - 1} más)" if cuantos > 1 else ""
        return "muy_baja", f"un supuesto del que depende está contradicho por la propia evidencia reunida{resto}: «{cual}»"
    balance = v.balance()
    a_favor, en_contra = balance["aFavor"], balance["enContra"]
    if not v.apoyos:
        if en_contra > 0:
            return "muy_baja", f"la evidencia en contra pesa tanto o más que la a favor (a favor {a_favor:g}, en contra {en_contra:g}): no queda ningún apoyo sostenido"
        if v.socavadas:
            return "muy_baja", f"no hay ninguna afirmación sostenida que no sea sintética y siga en pie: {v.socavadas} {'apoyo socavado' if v.socavadas == 1 else 'apoyos socavados'}"
        # El motivo dice cuál de las tres razones es: sin nada, todo sintético,
        # o todo abstenciones. Decir "sintética" de tres frases que dicen "no
        # pude comprobar" manda a buscar el fallo donde no está.
        abstenciones = sum(1 for a in v.afs if a.get("veredicto") in VEREDICTOS_QUE_CUENTAN and es_abstencion(a))
        if abstenciones:
            return "muy_baja", f"no hay ninguna afirmación que afirme algo del mundo: {abstenciones} {'declara' if abstenciones == 1 else 'declaran'} que no se pudo comprobar o que no se encontró en lo leído"
        return "muy_baja", "no hay ninguna afirmación sostenida que no sea sintética"
    if en_contra > 0 and en_contra >= a_favor:
        return "muy_baja", f"la evidencia en contra pesa tanto o más que la a favor (a favor {a_favor:g}, en contra {en_contra:g})"
    nivel, motivo = _techo_estructura(v, factores)
    nivel_peso = _techo_peso(a_favor, en_contra)
    if NIVELES.index(nivel_peso) < NIVELES.index(nivel):
        freno = _frena_peso(a_favor, en_contra, NIVELES[NIVELES.index(nivel_peso) + 1], v.motivos_bajo_peso()) or ""
        return nivel_peso, f"{freno}; por la clase de evidencia llegaría a {_nivel_texto(nivel)} ({motivo})"
    return nivel, motivo


def techo(h: dict[str, Any], factores: list[Any] | None = None) -> tuple[str, str]:
    """(nivel máximo, motivo) con lo que hay en el registro de la hipótesis: el
    menor entre el techo por estructura y el techo por peso."""
    return _techo(_Vista(h), factores)


def acotar(certeza_del_juez: str, h: dict[str, Any], factores: list[Any] | None = None) -> dict[str, Any]:
    """La certeza final: la del juez si cabe bajo el techo; el techo si no.
    Devuelve {certeza, techo: {nivel, motivo, acotada, certezaDelJuez,
    cohortesDistintas}}. `cohortesDistintas` es la lista que contó el techo
    (la misma que `cohortes_distintas`), para que la conclusión la lleve
    desde que se escribe y la interfaz no tenga que recalcularla (M-04)."""
    v = _Vista(h)
    nivel, motivo = _techo(v, factores)
    juez = _clave(certeza_del_juez)
    if juez not in NIVELES:
        juez = "muy_baja"
    final = juez if NIVELES.index(juez) <= NIVELES.index(nivel) else nivel
    return {"certeza": final, "techo": {"nivel": nivel, "motivo": motivo, "acotada": final != juez, "certezaDelJuez": juez, "cohortesDistintas": v.cohortes()}}


def factores_que_bajan(factores: list[Any] | None) -> list[str]:
    """Los factores GRADE con los que el juez bajó la certeza, en castellano y
    con su explicación: 'riesgo de sesgo (la cohorte perdió al 40 %)'. Acepta
    diccionarios y objetos (FactorCerteza); lo que no se entiende se salta."""
    salida: list[str] = []
    for f in factores or []:
        factor = f.get("factor") if isinstance(f, dict) else getattr(f, "factor", None)
        efecto = f.get("efecto") if isinstance(f, dict) else getattr(f, "efecto", None)
        explicacion = f.get("explicacion") if isinstance(f, dict) else getattr(f, "explicacion", None)
        if _clave(efecto) != "baja" or not isinstance(factor, str):
            continue
        nombre = ETIQUETAS_FACTOR.get(_clave(factor) or "", factor.replace("_", " "))
        texto = str(explicacion or "").strip().rstrip(".")
        salida.append(f"{nombre} ({texto})" if texto else nombre)
    return salida


def frase_plantilla(direccion: str, certeza: str, titulo: str, supuesto_contradicho: bool = False, indirectas: int | None = None) -> str:
    """La frase calibrada de (dirección, certeza), como las tablas de Santesso
    2020 y Cochrane Iberoamérica. El modelo no la escribe: se genera aquí para
    que 'probablemente' signifique siempre lo mismo. El título de la hipótesis
    hace de H con la inicial en minúscula. `supuesto_contradicho`: la dirección
    es a favor por las afirmaciones, pero un supuesto del que depende está
    contradicho; se dice, en vez de llamar "contradictoria" a la evidencia.
    `indirectas`: cuántos apoyos indirectos hay (sostenidos o parciales, los
    que cuentan `apoyos_indirectos`); con dirección "sin_evidencia_directa"
    distingue "nada" (ninguna afirmación a favor) de "solo evidencia
    indirecta" (M-06). En esa dirección el supuesto contradicho también se
    dice, con las mismas palabras que la frase de rosa/bucle/corrida.py, para
    que el recálculo por regla lo conserve. Un nivel de certeza que no se
    reconoce vale como muy baja; un recuento que no se puede leer, como cero."""
    h = (titulo or "").strip().rstrip(".")
    h = h[:1].lower() + h[1:] if h and not h[:2].isupper() else h
    nivel = _clave(certeza)
    if nivel not in NIVELES:
        nivel = "muy_baja"
    if direccion == "sin_evidencia_directa":
        try:
            n = int(indirectas or 0)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            cuantas = "una afirmación sostenida o parcial" if n == 1 else f"{n} afirmaciones sostenidas o parciales"
            supuesto = f"; además, un {MARCA_SUPUESTO_CONTRADICHO} por las fuentes" if supuesto_contradicho else ""
            return f"Solo encontramos evidencia indirecta sobre si {h}: {cuantas} con el mismo patrón en otra población, otro marcador u otro desenlace, y ninguna en la misma población y marcador{supuesto}; la certeza es {_nivel_texto(nivel)}. Que no haya evidencia directa no significa que no exista."
        if supuesto_contradicho:
            return f"No encontramos evidencia directa sobre si {h}, y un {MARCA_SUPUESTO_CONTRADICHO} por las fuentes. Esto no significa que no exista."
        return f"No encontramos evidencia directa sobre si {h}. Esto no significa que no exista."
    if direccion == "mixta":
        return f"La evidencia es contradictoria sobre si {h}; la certeza es {_nivel_texto(nivel)}."
    if direccion == "en_contra":
        return f"{VERBO_CONTRA[nivel]} {h}."
    if supuesto_contradicho:
        return f"{VERBO_CERTEZA[nivel]} {h}, aunque un {MARCA_SUPUESTO_CONTRADICHO} por las fuentes."
    return f"{VERBO_CERTEZA[nivel]} {h}."


# Con qué empieza toda frase que genera `frase_plantilla`: solo un enunciado que
# empiece así se vuelve a generar al recalcular sin que cambie la certeza.
_INICIOS_PLANTILLA = ("No encontramos evidencia directa sobre si", "Solo encontramos evidencia indirecta sobre si", "La evidencia es contradictoria sobre si", *VERBO_CERTEZA.values(), *VERBO_CONTRA.values())


def es_frase_plantilla(texto: Any) -> bool:
    """True si el enunciado lo generó `frase_plantilla` (empieza por uno de
    sus inicios). Un texto escrito por una persona o por un modelo no lo es y
    el recálculo no lo toca mientras la certeza no cambie."""
    return isinstance(texto, str) and texto.lstrip().startswith(_INICIOS_PLANTILLA)


def _direccion_de_plantilla(texto: Any) -> str | None:
    """La dirección con la que se generó una frase plantilla, leída de su
    inicio, para una conclusión antigua que no guardó `direccion`: sin esto,
    al regenerar la frase "No encontramos evidencia directa" pasaría a "La
    evidencia es muy incierta sobre si", que dice otra cosa. "La evidencia es
    muy incierta sobre si" es la misma en apoya y en contra: no se decide
    (None), y quien llama usa "apoya", como el cierre."""
    if not isinstance(texto, str):
        return None
    t = texto.lstrip()
    if t.startswith(("No encontramos evidencia directa sobre si", "Solo encontramos evidencia indirecta sobre si")):
        return "sin_evidencia_directa"
    if t.startswith("La evidencia es contradictoria sobre si"):
        return "mixta"
    if t.startswith(tuple(v for k, v in VERBO_CONTRA.items() if k != "muy_baja")):
        return "en_contra"
    if t.startswith(tuple(v for k, v in VERBO_CERTEZA.items() if k != "muy_baja")):
        return "apoya"
    return None


def instante(ahora: Any = None) -> int:
    """El instante en milisegundos desde 1970 que se apunta en `recalculadaEn`
    y en la línea del registro: el dado, si es un número; si no, ahora."""
    if isinstance(ahora, numbers.Real) and not isinstance(ahora, bool):
        return int(ahora)
    return int(time.time() * 1000)


def _fecha_iso(ahora: int) -> str:
    """La fecha del registro de procedencia, como la escribe rosa/bucle/corrida.py
    (ISO 8601 en UTC); vacía si el instante no se puede convertir."""
    try:
        return datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return ""


def reacotar_conclusion(h: dict[str, Any], ahora: Any = None) -> dict[str, Any] | None:
    """Vuelve a aplicar la regla, sin llamar al juez, sobre una conclusión ya
    escrita: techo, certeza final (`min(juez, techo)`), escalera, cohortes y
    frase plantilla, reutilizando los factores que el juez dejó guardados.
    Sirve cuando cambia lo contado sin que cambie lo leído (M-10: las frases
    de introducción dejaron de pesar entero; S-06: dos entradas del mismo
    artículo son una; M-01: "sin información" dejó de ser riesgo alto) y para
    registros con el techo obsoleto (M-14). El nivel del juez se toma de
    `techo.certezaDelJuez`; en una conclusión antigua sin techo, de su
    `certeza` (la regla solo puede bajar, así que no se inventa nada).

    Deja el mismo rastro que el cierre cuando escribe una conclusión, para que
    la persona vea que la certeza se movió aunque el juez no hablara: si la
    certeza cambia, `conclusion.cambio` (de dónde venía y por qué, lo que la
    interfaz enseña) y `conclusion.recalculadaEn` (`ahora`, en milisegundos;
    si no se da, el instante actual), y una línea con fecha en
    `procedencia.registro`; si solo cambia el nivel del techo, o el techo no
    existía, o la frase, la línea. Lo que la conclusión dice (`enunciado`) se
    vuelve a generar cuando cambia la certeza y también, sin que cambie, cuando
    la frase guardada es una plantilla (`es_frase_plantilla`) y la de hoy dice
    otra cosa: "solo evidencia indirecta" en vez de "no encontramos evidencia
    directa" (M-06), otro recuento, o el supuesto contradicho que se conserva
    por su marca (`MARCA_SUPUESTO_CONTRADICHO`). Un enunciado que no es
    plantilla solo se sustituye si la certeza cambió.

    Muta `h["conclusion"]` (y `h["cohortesDistintas"]`) y devuelve {"antes",
    "despues", "cambio" (algo se movió: certeza, techo, escalera, cohortes o
    frase), "bajo" (la certeza bajó de un nivel reconocido a otro menor: es lo
    que merece un evento), "texto" (lo que pasó con la certeza, para el evento:
    "bajó de baja a muy baja al recalcular el techo por regla: ..."), "nota" (la
    línea del registro, sin fecha), "enunciadoCambio"}; None si la hipótesis
    no tiene conclusión con certeza. Lo que escribió el juez (conclusión, a
    favor, en contra, factores) no se toca. Es idempotente: la segunda pasada
    no cambia nada ni añade líneas."""
    if not isinstance(h, dict) or not isinstance(h.get("conclusion"), dict):
        return None
    c = h["conclusion"]
    if "certeza" not in c:
        return None
    ahora = instante(ahora)
    factores = c.get("factores") if isinstance(c.get("factores"), list) else []
    techo_previo = _dict(c.get("techo"))
    juez = _clave(techo_previo.get("certezaDelJuez")) or _clave(c.get("certeza")) or "muy_baja"
    antes = {"certeza": c.get("certeza"), "techo": techo_previo.get("nivel"), "cohortesDistintas": list(c.get("cohortesDistintas") or []) if isinstance(c.get("cohortesDistintas"), list) else None}
    motivo_previo = techo_previo.get("motivo")
    escalera_previa = c.get("escalera")
    enunciado_previo = c.get("enunciado")
    acotada = acotar(juez, h, factores)
    c["techo"] = acotada["techo"]
    c["certeza"] = acotada["certeza"]
    c["escalera"] = escalera(h, acotada["certeza"], factores)
    c["cohortesDistintas"] = list(acotada["techo"]["cohortesDistintas"])
    h["cohortesDistintas"] = list(acotada["techo"]["cohortesDistintas"])
    motivo = str(c["techo"]["motivo"])
    certeza_cambio = c["certeza"] != antes["certeza"]
    # La frase: siempre que la certeza cambie; sin cambio de certeza, solo si la
    # guardada es una plantilla y la de hoy dice otra cosa (M-06).
    enunciado_cambio = False
    if certeza_cambio or es_frase_plantilla(enunciado_previo):
        titulo = str(c.get("hipotesisBreve") or h.get("titulo") or "").strip()
        supuesto = isinstance(enunciado_previo, str) and MARCA_SUPUESTO_CONTRADICHO in enunciado_previo
        direccion = str(c.get("direccion") or _direccion_de_plantilla(enunciado_previo) or "apoya")
        nuevo = frase_plantilla(direccion, c["certeza"], titulo, supuesto_contradicho=supuesto, indirectas=len(apoyos_indirectos(h)))
        if nuevo != enunciado_previo:
            c["enunciado"] = nuevo
            enunciado_cambio = True
    despues = {"certeza": c["certeza"], "techo": c["techo"]["nivel"], "cohortesDistintas": list(c["cohortesDistintas"])}
    techo_cambio = antes["techo"] != despues["techo"]
    cambio = certeza_cambio or techo_cambio or motivo_previo != motivo or escalera_previa != c["escalera"] or antes["cohortesDistintas"] != despues["cohortesDistintas"] or enunciado_cambio
    de_txt = _nivel_texto(str(antes["certeza"])) if antes["certeza"] else "sin certeza"
    a_txt = _nivel_texto(despues["certeza"])
    bajo = antes["certeza"] in NIVELES and NIVELES.index(despues["certeza"]) < NIVELES.index(antes["certeza"])
    texto = ""
    notas: list[str] = []
    if certeza_cambio:
        # Una certeza anterior que no es un nivel (una conclusión antigua con un valor
        # raro) no sube ni baja: pasa.
        sentido = "bajó" if bajo else ("subió" if antes["certeza"] in NIVELES else "pasó")
        texto = f"{sentido} de {de_txt} a {a_txt} al recalcular el techo por regla: {motivo}"
        notas.append(f"la certeza {texto}")
        c["cambio"] = {"de": {"certeza": antes["certeza"], "direccion": c.get("direccion"), "iteracion": c.get("iteracion")}, "motivo": f"Recálculo del techo por regla: {motivo}"[:300]}
        c["recalculadaEn"] = ahora
    elif not techo_previo:
        notas.append(f"techo GRADE calculado por regla para una conclusión que no lo tenía: {_nivel_texto(despues['techo'])} ({motivo[:160]})")
    elif techo_cambio:
        notas.append(f"el techo por regla pasó de {_nivel_texto(str(antes['techo'] or 'sin techo'))} a {_nivel_texto(despues['techo'])} sin mover la certeza: {motivo}")
    if enunciado_cambio and not certeza_cambio:
        notas.append(f"la frase de la conclusión se volvió a generar por regla sin mover la certeza: «{str(c['enunciado'])[:160]}»")
    nota = "; ".join(notas) if notas else ("recálculo del techo por regla sin mover la certeza ni la frase" if cambio else "sin cambios al recalcular el techo por regla")
    if notas:
        procedencia = h.get("procedencia")
        registro = procedencia.get("registro") if isinstance(procedencia, dict) else None
        if isinstance(registro, list):
            fecha = _fecha_iso(ahora)
            registro.append(f"{fecha} {nota}" if fecha else nota)
    return {"antes": antes, "despues": despues, "cambio": cambio, "bajo": bajo, "texto": texto, "nota": nota, "enunciadoCambio": enunciado_cambio}


def _remedios_de_peso(v: _Vista) -> list[str]:
    """Qué apoyo de más peso haría falta, según qué factor resta en los apoyos
    de hoy: diseño (revisión narrativa, diseño sin reconocer, diseño débil),
    sesgo, muestra o relación solo indirecta. Si nada resta, otro apoyo."""
    # Qué factor resta en algún apoyo (valor entre 0 y 1) y qué diseños débiles hay.
    bajos = {f["factor"] for i in v.apoyos for f in v.pesos[i]["factores"] if 0.0 < f["valor"] < 1.0}
    disenos = {_clave((v.fuente_principal(i) or {}).get("tipoEstudio")) for i in v.apoyos} & set(PESO_DISENO)
    remedios: list[str] = []
    if "diseno" in bajos:
        if "revision_narrativa" in disenos:
            remedios.append("un estudio primario en vez de una revisión narrativa")
        if "otro" in disenos:
            remedios.append("identificar el diseño de los estudios que constan sin diseño reconocido (cohorte, casos y controles, ensayo), que hoy pesan la mitad")
        debiles = sorted(ETIQUETAS_DISENO.get(d, d) for d in disenos if d and d not in ("revision_narrativa", "otro"))
        if debiles:
            remedios.append("un estudio con diseño más fuerte (cohorte, casos y controles o ensayo) en vez de " + ", ".join(debiles))
    if "seccion" in bajos:
        remedios.append("un resultado del propio estudio (sección de resultados) en vez de una frase de su introducción, que resume trabajo ajeno")
    if "sesgo" in bajos:
        remedios.append("una fuente con menos riesgo de sesgo")
    if "n" in bajos:
        remedios.append("una muestra mayor (n de 100 o más)")
    if "relacion" in bajos and not remedios:
        remedios.append("un apoyo directo en la misma población y marcador, no solo indirecto")
    if not remedios:
        remedios.append("otro apoyo independiente")
    return remedios


def _falta_por_peso(v: _Vista, balance: dict[str, Any], nivel: str, extra: float = 0.0) -> str | None:
    """Lo que falta por peso para `nivel`, en el lenguaje de la escalera; None
    si el peso ya da. La evidencia en contra que hoy frena se dice siempre,
    con las cifras de hoy. `extra` es el peso que ya aportarían los peldaños
    anteriores y las piezas estructurales que este pide (una cohorte más, la
    evidencia directa, la réplica: 1.0 cada una como mucho): del peso a favor
    solo se avisa cuando seguiría faltando después."""
    minimo, divisor = UMBRALES_PESO[nivel]
    a_favor, en_contra = balance["aFavor"], balance["enContra"]
    if en_contra > 0 and (en_contra >= a_favor or (divisor and en_contra > a_favor / divisor)):
        n_contras = len(v.contras)
        limite = f" (para {_nivel_texto(nivel)} no puede pasar de {'la mitad' if divisor == 2 else 'un tercio'} de la a favor)" if divisor else ""
        return f"resolver la evidencia en contra: {n_contras} {'afirmación en contra pesa' if n_contras == 1 else 'afirmaciones en contra pesan'} {en_contra:g} frente a {a_favor:g} a favor{limite}"
    con_extra = round(a_favor + extra, 3)
    if con_extra < minimo:
        suma = f"suman {a_favor:g}" + (f" y con lo anterior llegarían a {con_extra:g}" if extra else "")
        return f"apoyos de más peso: {', '.join(_remedios_de_peso(v))} ({suma}; {_nivel_texto(nivel)} exige al menos {minimo:g})"
    return None


def escalera(h: dict[str, Any], certeza: str, factores: list[Any] | None = None) -> list[dict[str, str]]:
    """Qué le falta a la hipótesis para cada nivel por encima del actual, por
    regla. Cada peldaño: {de, a, falta}. Vacía si ya está en alta. Cuando lo
    que frena es el peso de la evidencia, el "falta" lo dice. Los peldaños
    son consecutivos: cada uno da por cumplido lo que pidieron los
    anteriores. Cuando ni la estructura ni el peso frenan un peldaño (la
    regla llegaría y fue el juez quien se quedó abajo), el "falta" nombra los
    factores reales con los que el juez bajó (`factores`, efecto "baja") en
    vez de un peldaño genérico (M-06); sin factores, el texto por defecto."""
    v = _Vista(h)
    cohortes = len(v.cohortes())
    directa = bool(v.directa())
    balance = v.balance()
    a_favor = balance["aFavor"]
    nivel_actual = _clave(certeza)
    actual = NIVELES.index(nivel_actual) if nivel_actual in NIVELES else 0
    bajan = factores_que_bajan(factores)
    del_juez = ("que se resuelva lo que el juez señaló al bajar la certeza: " + "; ".join(bajan)) if bajan else None
    # Peso que ya aportarían los peldaños anteriores: las piezas estructurales
    # que pidieron (la segunda cohorte, la evidencia directa, la réplica; 1.0 cada
    # una) y el peso mínimo que exigieron, que al llegar a ese nivel se alcanzó.
    acumulado = 0.0
    pasos: list[dict[str, str]] = []

    def peldano(de: str, a: str, pieza: str | None, por_defecto: str) -> None:
        nonlocal acumulado, del_juez
        if pieza is not None:
            acumulado += 1.0
        freno = _falta_por_peso(v, balance, a, acumulado)
        if pieza is not None:
            falta = pieza + (f"; además, {freno}" if freno else "")
        else:
            # Los factores del juez frenan el primer peldaño que la regla no frena; a
            # partir de ahí, resueltos, vuelve el texto por defecto de cada nivel.
            falta = freno or del_juez or por_defecto
            if falta is del_juez:
                del_juez = None
        minimo = UMBRALES_PESO[a][0]
        if a_favor + acumulado < minimo:
            acumulado = round(minimo - a_favor, 3)
        pasos.append({"de": de, "a": a, "falta": falta})

    if actual < 1:
        pieza = None
        if cohortes < 2:
            pieza = "una segunda cohorte independiente que muestre lo mismo (en la literatura o por análisis), o un efecto grande documentado en la evidencia que ya hay"
            sin = v.sin_cohorte()
            if sin:
                pieza += f"; {sin} de sus fuentes no tienen la cohorte identificada: nombrarla (qué estudio o población) puede bastar"
        peldano("muy_baja", "baja", pieza, "que el juez deje de ver riesgo de sesgo, inconsistencia o imprecisión graves en las cohortes que ya hay")
    if actual < 2:
        pieza = None if directa else "evidencia directa: un análisis in silico sobre un dataset público aprobado (no sintético) o un resultado de laboratorio contra el prerregistro"
        peldano("baja", "moderada", pieza, "que la evidencia directa sea consistente y precisa: intervalo que no cruce el efecto mínimo")
    if actual < 3:
        pieza = None if (cohortes >= 2 and directa) else "réplica de ese resultado directo en una cohorte independiente, con las reglas de análisis congeladas antes de mirar los datos"
        peldano("moderada", "alta", pieza, "consistencia entre las cohortes y ausencia de sesgo de publicación")
    return pasos
