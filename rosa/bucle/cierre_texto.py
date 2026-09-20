"""Texto por regla que el cierre de una iteración añade después de rehacer las
conclusiones (18 de septiembre de 2026; lo vio Emir en la corrida 13. Revisado
el 19 con el informe del adversario).

El resumen técnico y el resumen en llano de una iteración se escriben en
`_cerrar_iteracion` (rosa/bucle/corrida.py) antes de acumular la evidencia y de
rehacer las conclusiones, y ese orden lo necesitan otros bloques. Si en ese
mismo cierre una hipótesis sube o baja de certeza, el texto que lee la persona
dice "todas mantienen una certeza muy baja" mientras la ficha de la hipótesis
ya dice "baja". Este módulo no paga otra llamada al modelo: compara la certeza
y la dirección de cada hipótesis viva antes y después del cierre y, si algo
cambió, redacta por regla un párrafo en castellano y lo pega al final del
resumen, del resumen en llano (en la lista `cambios`, la que la interfaz pinta
como "Qué cambió desde la iteración anterior") y del informe de la iteración;
y si el llano afirma que la certeza se mantiene en un nivel que ya no es el de
la hipótesis de la que habla, antepone el aviso `AVISO_DESFASE`.

El aviso se decide por hipótesis, no por nivel global (informe del adversario
del 19 de septiembre): una frase sobre todas las hipótesis ("todas mantienen
una certeza muy baja", "ninguna pasa de muy baja", verbo en plural) queda
desfasada si alguna de las que cambiaron está ahora en otro nivel; una frase
sobre una hipótesis concreta ("la normalización de P-tau181 pasó a recibir
apoyo, con certeza muy baja") solo si nombra a una que cambió y el nivel que
afirma no es el nuevo de esa hipótesis. Nombrar es compartir dos o más
palabras significativas con el título (o la versión breve) de la hipótesis, o
una palabra del título que ninguna otra hipótesis de la investigación lleva.
Y "la certeza sigue siendo muy baja" sin decir de quién va por la hipótesis
que el texto nombra, si nombra alguna; si no nombra ninguna, por todas.

Vocabulario: la "certeza" es el nivel GRADE de la conclusión (muy baja, baja,
moderada, alta); la "dirección" dice si la evidencia está a favor, en contra,
es mixta o no hay evidencia directa; el "techo" es el nivel máximo que la
regla de rosa/certeza.py permite con la evidencia que hay (solo literatura de
una cohorte no pasa de muy baja; sin datos reales no pasa de baja). El
"juez" es el modelo que escribe la conclusión; su nivel queda bajo el techo, y
puede quedar por debajo: entonces lo que explica el cambio es su motivo, no el
techo.

Todo es puro y tolerante con registros raros: un llano ausente, en otro
formato o con campos de otro tipo no rompe el cierre (se deja como está).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from rosa import certeza as CERTEZA

NIVELES: tuple[str, ...] = tuple(CERTEZA.NIVELES)

ETIQUETA_DIRECCION: dict[str, str] = {
    "apoya": "a favor",
    "mixta": "mixta",
    "en_contra": "en contra",
    "sin_evidencia_directa": "sin evidencia directa",
}

# Lo que se antepone a un texto del llano que afirma algo sobre la certeza que
# el cierre acaba de dejar desfasado. Termina en punto y coma: el texto original
# sigue detrás con la inicial en minúscula.
AVISO_DESFASE = "Ojo: lo que sigue se escribió antes de rehacer las conclusiones;"

# Título de la sección que se añade al informe de la iteración (Markdown).
TITULO_INFORME = "## Cambios de certeza en este cierre"

# Campos del resumen en llano que escribe el modelo antes de reconcluir: son los
# que pueden afirmar algo desfasado sobre la certeza. `titulo`, `colaPorRegla`,
# `aprendizaje`, `alDia` y `terminos` no hablan de certeza o se escriben por regla.
CAMPOS_LLANO_TEXTO: tuple[str, ...] = ("queBuscaba", "queHizo", "limitaciones", "queFalta", "queTeToca")
CAMPOS_LLANO_LISTA: tuple[str, ...] = ("mensajesClave", "queEncontro", "cambios", "quePropone")

# Cuántas hipótesis se nombran una a una en cada frase del párrafo; el resto se
# cuenta ("y 3 más") para que un primer cierre con muchas conclusiones nuevas no
# deje un párrafo de media página.
MAX_NOMBRADAS = 6
MAX_TITULO = 100
MAX_MOTIVO = 160

# Cuántas palabras significativas del título (o de la versión breve) de una
# hipótesis tienen que aparecer en un texto para que el texto "hable" de ella;
# y el tamaño mínimo de una palabra significativa (gfap, nfl, tau, pet) y de una
# palabra única con la que basta una sola (gfap; "tau" solo no).
MIN_SOLAPE = 2
MIN_LETRAS = 3
MIN_LETRAS_UNICA = 4



def _normalizar(texto: str) -> str:
    """Minúsculas y sin tildes, para que los patrones no dependan de si el modelo acentuó."""
    sin_marcas = "".join(ch for ch in unicodedata.normalize("NFD", texto) if unicodedata.category(ch) != "Mn")
    return sin_marcas.lower()


# Palabras que no distinguen una hipótesis de otra: artículos, preposiciones,
# conjunciones, el propio vocabulario del cierre. Se escriben con sus tildes y
# se normalizan al importar, porque se comparan con texto ya normalizado (y
# así el revisor de tildes no las toca).
_PALABRAS_VACIAS: frozenset[str] = frozenset(
    _normalizar(p)
    for p in (
        "de la el los las un una unos unas y o u e en con sin por para del al que no su sus se es son ser está están "
        "este esto ese esa eso aquel aquella ni si pero sino cuando donde cual cuales quien cuyo cuya otro otra otros "
        "otras mismo misma mismos mismas más menos muy ya lo le les a ante bajo entre hacia hasta sobre tras como tanto "
        "tan solo frente respecto hipótesis certeza certezas evidencia nivel niveles cambio cambios fue han hay había "
        "era eran sea sean ha he hemos todo toda todos todas nada algo alguna alguno cada porque aunque mientras también "
        "además según pasa pasó pasaron sigue siguen"
    ).split()
)

_NIVEL_RE = r"(?P<nivel>muy bajas?|bajas?|moderadas?|altas?)"
# Verbos de "mantenerse", solo en formas conjugadas: con comodín ("sigu\\w*")
# casaban "siguiente", "a continuación", "conservador" o "quedar".
_VERBOS_MANTENER = (
    r"(?P<verbo>mantiene|mantienen|mantuvo|mantuvieron|sigue|siguen|siguio|siguieron|conserva|conservan|conservo|"
    r"conservaron|permanece|permanecen|permanecio|permanecieron|continua|continuan|continuo|continuaron|queda|quedan|"
    r"quedo|quedaron|siempre)"
)
_VERBOS_PLURAL: frozenset[str] = frozenset(_normalizar(v) for v in "mantienen mantuvieron siguen siguieron conservan conservaron permanecen permanecieron continúan continuaron quedan quedaron".split())
_SUJETO_GLOBAL = r"(?:todas|toda|ninguna|ambas|cada una|las demas|el resto|las (?:\w+ )?hipotesis)"

# Frases que afirman que la certeza se mantiene (o que las hipótesis están) en
# un nivel. Se aplican sobre una frase en minúsculas y sin tildes. Cada patrón
# lleva su alcance: "global" (habla de todas), "condicional" (habla de la
# hipótesis que el texto nombra; si no nombra ninguna, de todas) o "local"
# (habla de una hipótesis concreta: solo cuenta si la nombra).
_PATRONES_DESFASE: tuple[tuple[str, re.Pattern[str]], ...] = (
    # "todas las hipótesis mantienen una certeza muy baja", "ninguna pasa de una certeza muy baja", "las nueve hipótesis siguen con certezas muy bajas"
    ("global", re.compile(r"\b" + _SUJETO_GLOBAL + r"\b[^.;:]{0,80}?\bcertezas?\b[^.;:]{0,25}?\b" + _NIVEL_RE + r"\b")),
    # "mantiene(n) una certeza muy baja", "sigue(n) con certeza baja", "siempre con certeza muy baja"
    ("verbo", re.compile(r"\b" + _VERBOS_MANTENER + r"\b[^.;:]{0,40}?\bcertezas?\b[^.;:]{0,25}?\b" + _NIVEL_RE + r"\b")),
    # "la certeza sigue siendo muy baja", "la certeza se mantiene baja", "la certeza no cambió: muy baja"
    ("condicional", re.compile(r"\bcertezas?\b[^.;:]{0,30}?\b(?P<verbo>sigue|siguen|se mantiene|se mantienen|se mantuvo|permanece|permanecen|continua|continuan|se queda|se quedan|queda|quedan|no (?:cambia|cambio|varia|vario|sube|subio))\b[^.;]{0,25}?\b" + _NIVEL_RE + r"\b")),
    # "..., con certeza muy baja": la forma en que el modelo describe una hipótesis concreta
    ("local", re.compile(r"\bcon (?:una |la )?certezas? " + _NIVEL_RE + r"\b")),
)
# Dentro de una frase, lo que dice que se habla de todas ("en las tres, la
# certeza sigue siendo muy baja").
_MARCA_GLOBAL = re.compile(r"\b(todas|todos|ninguna|ninguno|ambas|cada una|las demas|el resto|en conjunto|en general|las (?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+))\b")
# Lo que dice que el texto habla de una hipótesis concreta aunque no se
# reconozca cuál ("la hipótesis de que el daño vascular...").
_MARCA_HIPOTESIS_CONCRETA = re.compile(r"\b(la|esta|esa|dicha|aquella|una|otra) hipotesis\b")
_PALABRA = re.compile(r"[a-z0-9][a-z0-9\-]*")


# ---------------------------------------------------------------------------
# Instantánea y comparación
# ---------------------------------------------------------------------------


def _clave(nivel: Any) -> str | None:
    """'muy baja' o 'muy_baja' -> 'muy_baja'; lo que no es un nivel conocido, tal cual (o None)."""
    if not isinstance(nivel, str) or not nivel.strip():
        return None
    return nivel.strip().lower().replace(" ", "_")


def _indice(nivel: Any) -> int:
    k = _clave(nivel)
    return NIVELES.index(k) if k in NIVELES else -1


def _instante(valor: Any) -> int | float | None:
    """Un instante en milisegundos (`recalculadaEn`) o None; un booleano no lo es."""
    return valor if isinstance(valor, (int, float)) and not isinstance(valor, bool) else None


def nivel_texto(nivel: Any) -> str:
    """El nivel para una persona: 'muy_baja' -> 'muy baja'; None -> 'sin nivel'."""
    k = _clave(nivel)
    return k.replace("_", " ") if k else "sin nivel"


def direccion_texto(direccion: Any) -> str:
    """La dirección para una persona: 'apoya' -> 'a favor'; None -> 'sin dirección'."""
    if not isinstance(direccion, str) or not direccion.strip():
        return "sin dirección"
    return ETIQUETA_DIRECCION.get(direccion.strip(), direccion.strip().replace("_", " "))


def instantanea_certezas(e: dict[str, Any], investigacion_id: str) -> dict[str, dict[str, Any]]:
    """Certeza, dirección, techo, motivos, versión breve y `recalculadaEn` de
    cada hipótesis de la investigación (todas, también las descartadas: quien
    compara decide cuáles cuentan), por id. Solo tipos simples: se guarda en
    `it._cierre` cuando el cierre se corta por presupuesto y se retoma, para
    comparar contra lo de antes del primer intento y no contra una conclusión
    ya rehecha. `breve` (el `hipotesisBreve` del juez) sirve para reconocer de
    qué hipótesis habla un texto; `recalculadaEn`, para saber si un cambio vino
    de la regla (M-14) o del juez."""
    salida: dict[str, dict[str, Any]] = {}
    for h in (e.get("hipotesis") or []) if isinstance(e, dict) else []:
        if not isinstance(h, dict) or h.get("investigacionId") != investigacion_id:
            continue
        hid = h.get("id")
        if not isinstance(hid, str) or not hid:
            continue
        k = h.get("conclusion") if isinstance(h.get("conclusion"), dict) else {}
        techo = k.get("techo") if isinstance(k.get("techo"), dict) else {}
        cambio = k.get("cambio") if isinstance(k.get("cambio"), dict) else {}
        salida[hid] = {
            "titulo": str(h.get("titulo") or ""),
            "breve": str(k.get("hipotesisBreve") or ""),
            "estado": str(h.get("estado") or ""),
            "certeza": k.get("certeza") if isinstance(k.get("certeza"), str) else None,
            "direccion": k.get("direccion") if isinstance(k.get("direccion"), str) else None,
            "techo": techo.get("nivel") if isinstance(techo.get("nivel"), str) else None,
            "motivoTecho": str(techo.get("motivo") or ""),
            "motivoCambio": str(cambio.get("motivo") or ""),
            "recalculadaEn": _instante(k.get("recalculadaEn")),
        }
    return salida


def _cambio_de_direccion(c: dict[str, Any]) -> bool:
    """La dirección cambió entre dos valores conocidos. Una conclusión antigua
    sin dirección guardada que la recibe ahora no "cambia de dirección"."""
    a, d = c.get("direccionAntes"), c.get("direccionDespues")
    return isinstance(a, str) and isinstance(d, str) and a != d


def _explicacion_del_cambio(nivel: str | None, techo: str | None, por_regla: bool) -> str:
    """Qué explica el nivel nuevo. 'techo': el nivel es el techo por regla (o
    no hay con qué comparar), así que el motivo del techo lo explica. 'juez': el
    juez dejó la certeza por debajo del techo, y lo que la explica es su motivo,
    no un techo que está por encima. 'techo_sube': la regla subió el techo por
    encima de lo que dio el juez y la certeza volvió a la del juez."""
    if techo in NIVELES and nivel in NIVELES and _indice(nivel) < _indice(techo):
        return "techo_sube" if por_regla else "juez"
    return "techo"


def cambios_de_certeza(antes: Any, despues: Any) -> list[dict[str, Any]]:
    """Qué hipótesis vivas cambiaron de certeza o de dirección entre dos
    instantáneas (`instantanea_certezas`). Cada entrada lleva `tipo`:
    'subio' o 'bajo' (la certeza cambió entre niveles conocidos), 'cambio' (la
    certeza cambió y algún nivel no se reconoce) o 'direccion' (misma certeza,
    otra dirección); más id, título, versión breve, certeza y dirección antes
    y después, techo, `porRegla` (la conclusión la recalculó la regla en este
    cierre: `recalculadaEn` cambió; si no, la escribió el juez), `explicacion`
    ('techo', 'juez' o 'techo_sube', ver `_explicacion_del_cambio`) y `motivo`
    (el del techo cuando el techo explica el nivel; el que dejó el juez cuando
    quedó por debajo). Las descartadas no cuentan, ni las que siguen sin
    conclusión, ni las que la reciben por primera vez en este cierre: sin nivel
    anterior no hay cambio que contar, y el cierre retomado por presupuesto
    (S-14) debe dejar el resumen tal como lo escribió el modelo cuando lo único
    que hizo fue concluir por primera vez. Instantáneas que no son diccionarios
    valen como vacías."""
    if not isinstance(despues, dict):
        return []
    antes = antes if isinstance(antes, dict) else {}
    cambios: list[dict[str, Any]] = []
    for hid, d in despues.items():
        if not isinstance(d, dict) or d.get("estado") == "descartada":
            continue
        a = antes.get(hid) if isinstance(antes.get(hid), dict) else {}
        c_a, c_d = _clave(a.get("certeza")), _clave(d.get("certeza"))
        d_a, d_d = a.get("direccion"), d.get("direccion")
        if c_d is None or c_a is None:
            continue  # sigue sin conclusión, o la recibe por primera vez: no hay cambio que contar
        techo = _clave(d.get("techo"))
        rec_d = _instante(d.get("recalculadaEn"))
        por_regla = rec_d is not None and rec_d != _instante(a.get("recalculadaEn"))
        explicacion = _explicacion_del_cambio(c_d, techo, por_regla)
        motivo_techo, motivo_juez = str(d.get("motivoTecho") or ""), str(d.get("motivoCambio") or "")
        base = {
            "id": hid,
            "titulo": str(d.get("titulo") or ""),
            "breve": str(d.get("breve") or ""),
            "certezaAntes": c_a,
            "certezaDespues": c_d,
            "direccionAntes": d_a if isinstance(d_a, str) else None,
            "direccionDespues": d_d if isinstance(d_d, str) else None,
            "techo": techo,
            "porRegla": por_regla,
            "explicacion": explicacion,
            "motivo": motivo_juez if explicacion == "juez" else (motivo_techo or motivo_juez),
        }
        if c_a != c_d:
            if c_a in NIVELES and c_d in NIVELES:
                cambios.append({**base, "tipo": "subio" if _indice(c_d) > _indice(c_a) else "bajo"})
            else:
                cambios.append({**base, "tipo": "cambio"})
        elif _cambio_de_direccion(base):
            cambios.append({**base, "tipo": "direccion"})
    return cambios


# ---------------------------------------------------------------------------
# El párrafo
# ---------------------------------------------------------------------------


def _sin_parentesis_a_medias(corte: str) -> tuple[str, str]:
    """(texto, cierre) para un recorte que puede haber caído dentro de un
    paréntesis (el motivo de la regla lleva entre paréntesis las fuentes sin
    cohorte). Si hay un «(» sin pareja, se corta justo antes del primero; si
    eso lo deja vacío, se devuelven los «)» que faltan para ponerlos detrás
    de los puntos suspensivos."""
    abiertos: list[int] = []
    for i, ch in enumerate(corte):
        if ch == "(":
            abiertos.append(i)
        elif ch == ")" and abiertos:
            abiertos.pop()
    if not abiertos:
        return corte.rstrip(" ,;:"), ""
    antes = corte[: abiertos[0]].rstrip(" ,;:")
    if antes:
        return antes, ""
    return corte.rstrip(" ,;:"), ")" * len(abiertos)


def _recortar(texto: str, maximo: int) -> str:
    """El texto en una línea y, si pasa de `maximo`, cortado en un espacio y
    con puntos suspensivos, sin dejar un paréntesis abierto."""
    t = " ".join(str(texto or "").split())
    if len(t) <= maximo:
        return t
    corte = t[:maximo].rsplit(" ", 1)[0] if " " in t[:maximo] else t[:maximo]
    cuerpo, cierre = _sin_parentesis_a_medias(corte)
    return f"{cuerpo}...{cierre}"


def _minuscula_inicial(texto: str) -> str:
    """La inicial en minúscula si era una mayúscula seguida de minúscula (una
    sigla se queda): el motivo del juez empieza en mayúscula y va dentro de un
    paréntesis a media frase."""
    if len(texto) >= 2 and texto[0].isupper() and texto[1].islower():
        return texto[0].lower() + texto[1:]
    return texto


def _titulo(c: dict[str, Any]) -> str:
    t = _recortar(str(c.get("titulo") or "").strip().rstrip("."), MAX_TITULO)
    return f"«{t}»" if t else "una hipótesis sin título"


def _explicacion(c: dict[str, Any]) -> str:
    """La explicación guardada en el cambio o, en un cambio sin ella, la que
    sale de comparar el nivel nuevo con el techo."""
    ex = c.get("explicacion")
    if ex in ("techo", "juez", "techo_sube"):
        return ex
    return _explicacion_del_cambio(_clave(c.get("certezaDespues")), _clave(c.get("techo")), bool(c.get("porRegla")))


def _parentesis_techo(c: dict[str, Any]) -> str:
    """El paréntesis que explica el nivel nuevo. Con el nivel en el techo:
    "(techo por regla: baja; solo literatura...)". Con el juez por debajo del
    techo: "(motivo del juez: ...; techo por regla: baja)", porque un techo
    por encima del nivel no es lo que lo bajó. Con el techo subido por regla
    por encima del juez: "(el techo por regla subió a alta: ...; la certeza
    queda en la que dio el juez)"."""
    techo = c.get("techo")
    motivo = _recortar(_minuscula_inicial(str(c.get("motivo") or "").strip().rstrip(".")), MAX_MOTIVO)
    nivel_techo = nivel_texto(techo)
    ex = _explicacion(c)
    if techo and ex == "juez":
        if motivo:
            return f" (motivo del juez: {motivo}; techo por regla: {nivel_techo})"
        return f" (por decisión del juez, por debajo del techo por regla: {nivel_techo})"
    if techo and ex == "techo_sube":
        if motivo:
            return f" (el techo por regla subió a {nivel_techo}: {motivo}; la certeza queda en la que dio el juez)"
        return f" (el techo por regla subió a {nivel_techo}; la certeza queda en la que dio el juez)"
    if techo and motivo:
        return f" (techo por regla: {nivel_techo}; {motivo})"
    if techo:
        return f" (techo por regla: {nivel_techo})"
    if motivo:
        return f" ({motivo})"
    return ""


def _frase_nivel(c: dict[str, Any]) -> str:
    verbo = {"subio": "subió", "bajo": "bajó"}.get(str(c.get("tipo")), "pasó")
    frase = f"{_titulo(c)} {verbo} de {nivel_texto(c.get('certezaAntes'))} a {nivel_texto(c.get('certezaDespues'))}"
    if _cambio_de_direccion(c):
        frase += f", y la dirección pasó de {direccion_texto(c.get('direccionAntes'))} a {direccion_texto(c.get('direccionDespues'))}"
    return frase + _parentesis_techo(c)


def _enumerar(frases: list[str]) -> str:
    resto = len(frases) - MAX_NOMBRADAS
    texto = "; ".join(frases[:MAX_NOMBRADAS])
    return texto + (f"; y {resto} más" if resto > 0 else "")


def parrafo_de_cambios(cambios: list[dict[str, Any]] | None) -> str:
    """El párrafo por regla, en castellano claro, o '' si no cambió nada. Por
    ejemplo: "En este cierre cambió la certeza de 1 hipótesis: «La
    normalización de P-tau181...» subió de muy baja a baja (techo por regla:
    baja; solo literatura, sin experimento ni análisis sobre datos reales,
    aunque de 2 cohortes distintas). Ninguna bajó." Con solo bajadas, la
    variante "Ninguna subió."; con las dos, la lista sin coletilla. Los cambios
    de dirección sin cambio de certeza van en una frase aparte. Sin
    porcentajes, sin "demostrado"."""
    if not isinstance(cambios, list) or not cambios:
        return ""
    de_nivel = [c for c in cambios if isinstance(c, dict) and c.get("tipo") in ("subio", "bajo", "cambio")]
    solo_direccion = [c for c in cambios if isinstance(c, dict) and c.get("tipo") == "direccion"]
    if not (de_nivel or solo_direccion):
        return ""
    frases: list[str] = []
    if de_nivel:
        frases.append(f"En este cierre cambió la certeza de {len(de_nivel)} hipótesis: {_enumerar([_frase_nivel(c) for c in de_nivel])}.")
        subieron = sum(1 for c in de_nivel if c.get("tipo") == "subio")
        bajaron = sum(1 for c in de_nivel if c.get("tipo") == "bajo")
        if subieron and not bajaron and len(de_nivel) == subieron:
            frases.append("Ninguna bajó.")
        elif bajaron and not subieron and len(de_nivel) == bajaron:
            frases.append("Ninguna subió.")
    else:
        frases.append("En este cierre no subió ni bajó la certeza de ninguna hipótesis que ya tuviera conclusión.")
    if solo_direccion:
        lista = _enumerar([f"{_titulo(c)} pasó de {direccion_texto(c.get('direccionAntes'))} a {direccion_texto(c.get('direccionDespues'))}" for c in solo_direccion])
        frases.append(f"Cambió la dirección de la evidencia de {len(solo_direccion)} hipótesis sin cambiar su certeza: {lista}.")
    return " ".join(frases)


def texto_del_cierre(antes: Any, e: dict[str, Any], investigacion_id: str) -> tuple[list[dict[str, Any]], str]:
    """Los cambios entre la instantánea `antes` y el estado `e` de ahora, y el
    párrafo que los cuenta ('' si no hay ninguno)."""
    cambios = cambios_de_certeza(antes, instantanea_certezas(e, investigacion_id))
    return cambios, parrafo_de_cambios(cambios)


# ---------------------------------------------------------------------------
# De qué hipótesis habla un texto
# ---------------------------------------------------------------------------


def _palabras(texto_normalizado: str, minimo: int = MIN_LETRAS) -> set[str]:
    """Las palabras significativas de un texto ya normalizado: sin las vacías,
    sin números sueltos, con los guiones internos ("p-tau181")."""
    salida: set[str] = set()
    for p in _PALABRA.findall(texto_normalizado):
        p = p.strip("-")
        if len(p) >= minimo and p not in _PALABRAS_VACIAS and not p.isdigit():
            salida.add(p)
    return salida


def _candidatas(cambios: list[dict[str, Any]], hipotesis: Any) -> dict[str, dict[str, Any]]:
    """Las hipótesis que un texto puede nombrar: todas las de la investigación
    (`hipotesis`, la instantánea de después, si se da) más las de `cambios`;
    cada una con título, versión breve y su cambio de nivel (None si no cambió)."""
    salida: dict[str, dict[str, Any]] = {}
    if isinstance(hipotesis, dict):
        for hid, h in hipotesis.items():
            if isinstance(hid, str) and isinstance(h, dict):
                salida[hid] = {"titulo": str(h.get("titulo") or ""), "breve": str(h.get("breve") or ""), "cambio": None}
    for i, c in enumerate(cambios):
        hid = c.get("id") if isinstance(c.get("id"), str) and c.get("id") else f"cambio-{i}"
        entrada = salida.setdefault(hid, {"titulo": "", "breve": "", "cambio": None})
        entrada["cambio"] = c
        entrada["titulo"] = entrada["titulo"] or str(c.get("titulo") or "")
        entrada["breve"] = entrada["breve"] or str(c.get("breve") or "")
    return salida


def _quien_habla(texto_normalizado: str, cambios: list[dict[str, Any]], hipotesis: Any) -> tuple[list[dict[str, Any]], bool]:
    """(los cambios de las hipótesis de las que habla el texto, si el texto
    habla de alguna hipótesis que no cambió). Un texto habla de una hipótesis
    si comparte con su título al menos `MIN_SOLAPE` palabras significativas,
    o con su versión breve, o una palabra del título que ninguna otra
    hipótesis de la investigación lleva (solo con el conjunto completo en
    `hipotesis`). Cuando varias cumplen, se queda con las de más peso: cada
    palabra del título compartida vale 1 entre el número de títulos de la
    investigación que la llevan, así "p-tau181" (en ocho de nueve) casi no
    cuenta y "selectiva" (en uno) cuenta entera. Un texto sobre "reducir
    P-tau181 respecto a tau total predice mejor el beneficio clínico" comparte
    cuatro palabras con el título de la normalización y cuatro con el de la
    reducción selectiva, pero pesa más en la segunda ("mejor" solo está ahí) y
    habla de ella. La versión breve nombra pero pesa poco: es larga y comparte
    palabras corrientes con otras. "La hipótesis de que..." cuenta como hablar
    de una concreta aunque no se reconozca cuál."""
    candidatas = _candidatas(cambios, hipotesis)
    palabras_texto = _palabras(texto_normalizado)
    palabras_titulo = {hid: _palabras(_normalizar(c["titulo"])) for hid, c in candidatas.items()}
    frecuencia: dict[str, int] = {}
    for propias in palabras_titulo.values():
        for p in propias:
            frecuencia[p] = frecuencia.get(p, 0) + 1
    conjunto_completo = isinstance(hipotesis, dict)
    pesos: dict[str, float] = {}
    for hid, c in candidatas.items():
        solape = palabras_texto & palabras_titulo[hid]
        unica = conjunto_completo and any(frecuencia[p] == 1 and len(p) >= MIN_LETRAS_UNICA for p in solape)
        if len(solape) >= MIN_SOLAPE or unica:
            pesos[hid] = sum(1.0 / frecuencia[p] for p in solape)
        elif len(palabras_texto & _palabras(_normalizar(c["breve"]))) >= MIN_SOLAPE:
            pesos[hid] = 0.5
    tope = max(pesos.values()) if pesos else 0.0
    dominantes = [hid for hid, p in pesos.items() if p >= tope - 1e-9]
    cambiadas = [candidatas[hid]["cambio"] for hid in dominantes if candidatas[hid]["cambio"] is not None]
    otra = any(candidatas[hid]["cambio"] is None for hid in dominantes) or bool(_MARCA_HIPOTESIS_CONCRETA.search(texto_normalizado))
    return cambiadas, otra


# ---------------------------------------------------------------------------
# Dónde se pega
# ---------------------------------------------------------------------------


def _nivel_afirmado(m: re.Match[str]) -> str | None:
    """El nivel que casa un patrón, en singular ('certezas muy bajas' es la
    misma afirmación que 'certeza muy baja')."""
    return _clave(re.sub(r"s$", "", m.group("nivel")))


def _afirmaciones_de_nivel(frase: str) -> list[tuple[str, str]]:
    """[(alcance, nivel)] por cada afirmación de que la certeza se mantiene en
    un nivel dentro de una frase normalizada. El alcance del patrón del verbo
    depende del verbo: en plural ("mantienen") habla de varias, así que es
    global; "siempre" es la coletilla de una hipótesis concreta, local; en
    singular ("mantiene una certeza muy baja") va por la hipótesis que el texto
    nombra, condicional."""
    salida: list[tuple[str, str]] = []
    for alcance, patron in _PATRONES_DESFASE:
        for m in patron.finditer(frase):
            nivel = _nivel_afirmado(m)
            if nivel is None:
                continue
            if alcance == "verbo":
                verbo = m.group("verbo")
                alcance_real = "global" if verbo in _VERBOS_PLURAL else ("local" if verbo == "siempre" else "condicional")
            else:
                alcance_real = alcance
            salida.append((alcance_real, nivel))
    return salida


def _frases(texto_normalizado: str) -> list[str]:
    return [f for f in re.split(r"(?<=[.;])\s+", texto_normalizado) if f.strip()]


def frase_desfasada(texto: Any, cambios: list[dict[str, Any]] | None, hipotesis: Any = None) -> bool:
    """True si `texto` afirma que la certeza se mantiene en un nivel que el
    cierre acaba de dejar atrás. Por hipótesis: una afirmación sobre todas
    ("todas mantienen una certeza muy baja", verbo en plural, "en las tres")
    queda desfasada si alguna de las que cambiaron está ahora en otro nivel;
    una sobre una hipótesis concreta ("..., con certeza muy baja", "siempre
    con certeza muy baja", "mantiene una certeza muy baja") solo si el texto
    nombra a una que cambió (`_quien_habla`) y esa está ahora en otro nivel;
    "la certeza sigue siendo muy baja" sin sujeto va por la que el texto nombra
    y, si no nombra ninguna, por todas. `hipotesis` es la instantánea de
    después (`instantanea_certezas`) con todas las de la investigación: con
    ella se reconoce que un texto habla de una que no cambió; sin ella solo
    cuentan los títulos de `cambios`. "Todas mantienen una certeza muy baja"
    con una que subió a baja es desfasada; con una que bajó a muy baja, no."""
    if not isinstance(texto, str) or not texto.strip() or not isinstance(cambios, list) or not cambios:
        return False
    de_nivel = [c for c in cambios if isinstance(c, dict) and c.get("tipo") in ("subio", "bajo", "cambio") and _clave(c.get("certezaDespues"))]
    if not de_nivel:
        return False
    t = _normalizar(texto)
    cambiadas, otra = _quien_habla(t, de_nivel, hipotesis)

    def desfasa(lista: list[dict[str, Any]], nivel: str) -> bool:
        return any(_clave(c.get("certezaDespues")) != nivel for c in lista)

    for frase in _frases(t):
        global_en_frase = bool(_MARCA_GLOBAL.search(frase))
        for alcance, nivel in _afirmaciones_de_nivel(frase):
            if alcance == "global" or (alcance == "condicional" and global_en_frase):
                if desfasa(de_nivel, nivel):
                    return True
            elif alcance == "condicional":
                if cambiadas:
                    if desfasa(cambiadas, nivel):
                        return True
                elif not otra and desfasa(de_nivel, nivel):
                    return True
            elif cambiadas and desfasa(cambiadas, nivel):
                return True
    return False


def anteponer_aviso(texto: str) -> str:
    """`AVISO_DESFASE` delante del texto, con la inicial en minúscula si era
    una mayúscula seguida de minúscula (una sigla se queda). Idempotente."""
    t = str(texto or "").strip()
    if t.startswith(AVISO_DESFASE):
        return t
    return f"{AVISO_DESFASE} {_minuscula_inicial(t)}"


def resumen_con_cambios(resumen: Any, parrafo: str) -> Any:
    """El resumen técnico con el párrafo como última línea. Sin párrafo, o con
    el párrafo ya dentro, devuelve el resumen tal cual."""
    if not parrafo:
        return resumen
    r = resumen if isinstance(resumen, str) else ("" if resumen is None else str(resumen))
    if parrafo in r:
        return r
    return (r.rstrip() + "\n" + parrafo) if r.strip() else parrafo


def llano_con_cambios(llano: Any, parrafo: str, cambios: list[dict[str, Any]] | None, hipotesis: Any = None) -> Any:
    """El resumen en llano con el párrafo y los avisos. Si es el diccionario
    de `_explicar_en_llano`, se muta y se devuelve: el párrafo entra al final
    de la lista `cambios` (se crea si falta; si tiene otra forma no se pisa y
    el párrafo va en `cambiosDelCierre`), y cada campo de texto o de lista
    escrito por el modelo que afirme algo ya desfasado (`frase_desfasada`, por
    hipótesis; `hipotesis` es la instantánea de después con todas las de la
    investigación) lleva `AVISO_DESFASE` delante. Si es un texto, se devuelve
    con el párrafo al final. Si está ausente o tiene otra forma, o no hay
    párrafo, devuelve None: nada que escribir. Idempotente."""
    if not parrafo:
        return None
    if isinstance(llano, str):
        return llano if parrafo in llano else (llano.rstrip() + "\n\n" + parrafo if llano.strip() else parrafo)
    if not isinstance(llano, dict):
        return None
    # Los avisos van primero, sobre lo que escribió el modelo, antes de pegar el
    # párrafo nuevo (que nunca lleva aviso).
    for campo in CAMPOS_LLANO_TEXTO:
        v = llano.get(campo)
        if isinstance(v, str) and frase_desfasada(v, cambios, hipotesis):
            llano[campo] = anteponer_aviso(v)
    for campo in CAMPOS_LLANO_LISTA:
        v = llano.get(campo)
        if isinstance(v, list):
            llano[campo] = [anteponer_aviso(x) if isinstance(x, str) and x != parrafo and frase_desfasada(x, cambios, hipotesis) else x for x in v]
    lista = llano.get("cambios")
    if isinstance(lista, list):
        if parrafo not in lista:
            lista.append(parrafo)
    elif lista is None:
        llano["cambios"] = [parrafo]
    else:
        llano["cambiosDelCierre"] = parrafo
    return llano


def informe_con_cambios(informe: Any, parrafo: str) -> Any:
    """El informe de la iteración (Markdown) con una sección final para el párrafo."""
    if not parrafo or not isinstance(informe, str):
        return informe
    if parrafo in informe:
        return informe
    return f"{informe.rstrip()}\n\n{TITULO_INFORME}\n{parrafo}"
