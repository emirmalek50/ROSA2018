"""El visor de citas: dónde está exactamente, en la página de la fuente, el
pasaje que sostiene cada afirmación.

ROSA2018 ya exige que una cita resuelva a la página exacta y el verificador ya
lo comprueba (`rosa/verificador.py`), pero hasta ahora eso solo se veía como un
veredicto en un registro. Este módulo devuelve lo que hace falta para
enseñarlo: el texto de la página tal como se leyó, los tramos exactos que hay
que resaltar dentro de él, y, cuando el pasaje no está entero, qué tramo falta.

Lo delicado es el resaltado. El verificador compara en normalizado y compacto
(sin tildes, sin espacios, sin marcas de cita), porque así una ligadura o un
número de línea de un preprint no tumban una cita buena. Pero para pintar hace
falta el rango en el texto ORIGINAL, que es el que se enseña. La solución es
comparar por PALABRAS guardando la posición de cada una:

1. El texto de la página se parte en palabras con su posición de inicio y fin.
2. El pasaje se parte igual, y por elisiones ("...", "[...]") en tramos, que es
   la convención normal de cita: cada tramo tiene que estar y en orden.
3. Cada tramo se busca como subsecuencia de palabras, saltando en el texto las
   que son solo un número (los números de línea de los preprints) cuando no
   casan. El rango va del inicio de la primera palabra al fin de la última.

Así el resaltado cae sobre el texto de verdad, con su puntuación y sus
mayúsculas, y sigue siendo el mismo criterio que usó el verificador. Si un
tramo no aparece, se devuelve lo que sí se encontró y el tramo que falta: eso
es exactamente lo que convierte un veredicto en algo discutible.

El texto de la página no se vuelve a sacar del PDF: ya se guardó al leerla
(`fragmentos[*].texto` en `pasos.py`), así que el visor enseña lo mismo que vio
el verificador, no una relectura que podría diferir.

DOS SEÑALES QUE NO SON LA MISMA. Un veredicto como `cita_no_resuelve` junta en
una sola etiqueta dos preguntas distintas:

1. ¿La cita APUNTA a un sitio localizable? Es decir, si la referencia y el
   localizador ("pág. 3508", "texto web, parte 2") existen en las fuentes de la
   corrida. Es una propiedad de la dirección, no del contenido.
2. ¿El pasaje citado ESTÁ ahí, literal? Es una propiedad del contenido.

Se pueden dar las cuatro combinaciones, y la interfaz tiene que poder decir
"el texto coincide con la fuente, pero la cita no apunta a una posición
direccionable", que es informativo, en vez de un solo aprobado o suspenso.

Y hay un tercer eje: el veredicto guardado se tomó CUANDO se extrajo la
afirmación, con el verificador de entonces y con los fragmentos que la fuente
tenía entonces. `comprobacion_de_hoy` vuelve a resolver la cita con las reglas
y los fragmentos de ahora, sin coste de modelo (es determinista, menos de un
milisegundo por afirmación), y así se ve cuándo un bloqueo es viejo. Lo que la
recomprobación NO puede decir es si la afirmación sería sostenida: eso lo
decide el juez, y aquí solo se afirma lo que se comprueba.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Any

from rosa import verificador as V

# Una palabra: letras o cifras, con los apóstrofos y guiones interiores fuera
# (un guion de fin de línea ya lo une la normalización del verificador).
_PALABRA = re.compile(r"\w+", re.UNICODE)


def palabras_con_posicion(texto: str) -> list[tuple[str, int, int]]:
    """(palabra normalizada, inicio, fin) por cada palabra del texto, con las
    posiciones referidas al texto tal cual entra. La normalización es la del
    verificador (sin tildes, minúsculas), para comparar lo mismo que él."""
    salida: list[tuple[str, int, int]] = []
    for m in _PALABRA.finditer(texto or ""):
        # NFKC antes de normalizar, como hace el verificador con el texto de un
        # PDF: si no, una ligadura ("ﬁbrilar") no casa con su forma suelta.
        p = V.normalizar(unicodedata.normalize("NFKC", m.group(0)))
        if p:
            salida.append((p, m.start(), m.end()))
    return salida


def _es_numero(palabra: str) -> bool:
    return palabra.isdigit()


def _buscar_tramo(palabras: list[tuple[str, int, int]], tramo: list[str], desde: int) -> tuple[int, int] | None:
    """Busca la secuencia `tramo` dentro de `palabras` a partir del índice
    `desde`. Devuelve (índice de la primera, índice de la última) o None.

    Al comparar se pueden saltar en el texto las palabras que son solo un
    número: son los números de línea de los preprints, que el verificador
    quita en su normalización y que aquí, palabra a palabra, aparecerían en
    medio del pasaje. No se salta nada más: una palabra distinta es una cita
    que no cuadra, y eso tiene que verse."""
    if not tramo:
        return None
    for inicio in range(desde, len(palabras)):
        if palabras[inicio][0] != tramo[0]:
            continue
        i = inicio
        j = 0
        ultimo = inicio
        while j < len(tramo) and i < len(palabras):
            if palabras[i][0] == tramo[j]:
                ultimo = i
                i += 1
                j += 1
            elif _es_numero(palabras[i][0]) and not _es_numero(tramo[j]):
                i += 1
            else:
                break
        if j == len(tramo):
            return (inicio, ultimo)
    return None


def marcar_pasaje(texto: str, pasaje: str) -> dict[str, Any]:
    """Dónde está el pasaje dentro del texto de la página.

    Devuelve `{"tramos": [{"inicio", "fin", "texto"}], "falta": str | None,
    "completo": bool}`. `inicio` y `fin` son posiciones del texto tal cual se
    pasó, listas para resaltar. `falta` es el primer tramo del pasaje que no se
    encontró, en las palabras del pasaje, o None si está entero."""
    palabras = palabras_con_posicion(texto)
    trozos = [t for t in V._ELISION.split(pasaje or "") if t and t.strip()]
    if not trozos:
        return {"tramos": [], "falta": None, "completo": False}
    tramos: list[dict[str, Any]] = []
    desde = 0
    for trozo in trozos:
        buscado = [p for p, _, _ in palabras_con_posicion(trozo)]
        if not buscado:
            continue
        encontrado = _buscar_tramo(palabras, buscado, desde)
        if encontrado is None:
            return {"tramos": tramos, "falta": " ".join(buscado), "completo": False}
        i, j = encontrado
        tramos.append({"inicio": palabras[i][1], "fin": palabras[j][2], "texto": texto[palabras[i][1]:palabras[j][2]]})
        desde = j + 1
    return {"tramos": tramos, "falta": None, "completo": bool(tramos)}


def _fragmentos_para_verificador(corrida: dict[str, Any]) -> list[Any]:
    """Los fragmentos de la corrida en la forma que espera el verificador."""
    return [
        V.Fragmento(
            fuente_id=fid,
            referencia=f.get("referencia", ""),
            localizador=fr.get("localizador", ""),
            texto=fr.get("texto", ""),
            encabezado=fr.get("encabezado", ""),
        )
        for fid, f in _fuentes_de(corrida).items()
        for fr in (f.get("fragmentos") or [])
    ]


def comprobacion_de_hoy(afirmacion: dict[str, Any], fragmentos: list[Any]) -> dict[str, Any]:
    """Las dos señales, separadas, con las reglas y los fragmentos de ahora:

    - `resuelve`: la cita apunta a una posición que existe (fuente más
      localizador). Si no, `motivoResuelve` dice por qué, con el motivo del
      propio verificador.
    - `literal`: el pasaje citado está entero en esa posición. Si no,
      `falta` trae el tramo que no aparece.

    Estas dos señales son de la CITA. Que las dos estén bien no quiere decir
    que la afirmación deje de estar bloqueada: el verificador comprueba además
    los identificadores que nombra y las ausencias que declara, y por ahí puede
    seguir cayendo. Para eso está `bloquea_hoy`. Y para saber si es sostenida
    hace falta el juez, que no se llama aquí."""
    cita = afirmacion.get("cita") or ""
    pasaje = afirmacion.get("fragmento") or ""
    fuente_id = afirmacion.get("fuenteId") or None
    if not cita.strip():
        return {"resuelve": False, "motivoResuelve": "La afirmación no lleva cita.", "literal": False, "falta": None, "localizadorAdmitido": False}
    admitido = V.PATRON_CITA.match(cita.strip()) is not None
    candidatos = V.candidatos_cita(cita, fragmentos, fuente_id)
    if not candidatos:
        return {
            "resuelve": False,
            "motivoResuelve": V.motivo_cita_no_resuelta(cita, fragmentos, fuente_id),
            "literal": False,
            "falta": None,
            "localizadorAdmitido": admitido,
        }
    if not pasaje.strip():
        return {"resuelve": True, "motivoResuelve": "", "literal": False, "falta": None, "localizadorAdmitido": admitido}
    con_pasaje = [c for c in candidatos if V.pasaje_en_texto(pasaje, c.texto)]
    if con_pasaje:
        return {"resuelve": True, "motivoResuelve": "", "literal": True, "falta": None, "localizadorAdmitido": admitido}
    falta = V.pasaje_faltante(pasaje, candidatos[0].texto)
    return {"resuelve": True, "motivoResuelve": "", "literal": False, "falta": falta, "localizadorAdmitido": admitido}


def bloquea_hoy(afirmacion: dict[str, Any], fragmentos: list[Any]) -> dict[str, Any]:
    """Si el verificador de HOY seguiría bloqueando esta afirmación, con todas
    sus comprobaciones deterministas, no solo las dos de la cita.

    Hace falta porque una cita puede resolver y ser literal y la afirmación
    seguir bloqueada por otra razón: un identificador de ensayo que no aparece
    en el fragmento, o una ausencia que la fuente desmiente. Contar esas como
    recuperables sería inflar la cifra, que es justo lo que no se hace aquí."""
    r = V.comprobar_determinista(
        afirmacion.get("texto", ""),
        afirmacion.get("cita", ""),
        afirmacion.get("fragmento"),
        fragmentos,
        fragmentos,
        None,
        afirmacion.get("fuenteId"),
    )
    return {"veredicto": r.veredicto, "motivo": r.motivo or "", "bloquea": r.veredicto in V.BLOQUEAN}


def _fragmento_de(fuente: dict[str, Any], localizador: str) -> dict[str, Any] | None:
    """El fragmento de la fuente cuyo localizador es el de la cita. La
    comparación es laxa en espacios y mayúsculas porque el localizador viaja
    dentro del texto de la afirmación ("[ref, pág. 12]") y puede volver con
    otro espaciado."""
    objetivo = V.normalizar(localizador)
    for fr in fuente.get("fragmentos", []) or []:
        if V.normalizar(fr.get("localizador", "")) == objetivo:
            return fr
    return None


def _clase_de_localizador(localizador: str) -> str:
    """En qué se apoya la cita: una página de PDF, una sección del XML, el
    resumen o el texto de la web. Solo la primera resuelve a página exacta."""
    loc = V.normalizar(localizador)
    if loc.startswith("pag"):
        return "pagina"
    if loc.startswith("seccion"):
        return "seccion"
    if loc.startswith("resumen"):
        return "resumen"
    if "web" in loc:
        return "web"
    return "otro"


def _numero_de_pagina(localizador: str) -> int | None:
    m = re.search(r"(\d+)", localizador or "")
    return int(m.group(1)) if m else None


def _fuentes_de(corrida: dict[str, Any]) -> dict[str, Any]:
    fuentes = corrida.get("_fuentes")
    return fuentes if isinstance(fuentes, dict) else {}


def lista(corrida: dict[str, Any]) -> list[dict[str, Any]]:
    """Las afirmaciones de la corrida para la columna de la izquierda: texto,
    veredicto guardado, cita, de qué se apoya, si su página se puede enseñar y
    qué dicen hoy las dos señales deterministas."""
    fuentes = _fuentes_de(corrida)
    fragmentos = _fragmentos_para_verificador(corrida)
    salida = []
    for a in corrida.get("_afirmaciones", []) or []:
        if not isinstance(a, dict):
            continue
        localizador = a.get("localizador") or ""
        fuente = fuentes.get(a.get("fuenteId") or "")
        fragmento = _fragmento_de(fuente, localizador) if fuente else None
        hoy = comprobacion_de_hoy(a, fragmentos)
        veredicto_hoy = bloquea_hoy(a, fragmentos)
        salida.append(
            {
                "id": a.get("id"),
                "texto": a.get("texto"),
                "cita": a.get("cita"),
                "veredicto": a.get("veredicto"),
                "motivo": a.get("motivo"),
                "tipo": a.get("tipo"),
                "tema": a.get("tema"),
                "iteracion": a.get("iteracion", 0),
                "fuenteId": a.get("fuenteId"),
                "referencia": (fuente or {}).get("referencia") or "",
                "localizador": localizador,
                "clase": _clase_de_localizador(localizador),
                # Si hay texto guardado de ese localizador, la ficha se puede abrir.
                "conTexto": bool(fragmento and fragmento.get("texto")),
                "conPdf": bool(fragmento and fragmento.get("_ruta") and Path(str(fragmento["_ruta"])).exists()),
                "hoy": hoy,
                "veredictoDeHoy": veredicto_hoy,
                # El veredicto guardado bloquea y el verificador de hoy ya no:
                # el bloqueo es de una versión anterior. No basta con que la
                # cita resuelva, porque puede seguir cayendo por otra regla.
                "bloqueoViejo": bool(a.get("veredicto") in V.BLOQUEAN and not veredicto_hoy["bloquea"]),
            }
        )
    return salida


def ficha(corrida: dict[str, Any], afirmacion_id: str) -> dict[str, Any] | None:
    """Todo lo que la pantalla necesita para una afirmación: la fuente, la
    página tal como se leyó, dónde cae el pasaje dentro de ella, qué falta si
    falta, y qué otras páginas de esa misma fuente se leyeron."""
    afirmacion = next((a for a in corrida.get("_afirmaciones", []) or [] if isinstance(a, dict) and a.get("id") == afirmacion_id), None)
    if not afirmacion:
        return None
    fuentes = _fuentes_de(corrida)
    fuente = fuentes.get(afirmacion.get("fuenteId") or "") or {}
    localizador = afirmacion.get("localizador") or ""
    fragmento = _fragmento_de(fuente, localizador) if fuente else None
    texto = (fragmento or {}).get("texto") or ""
    pasaje = afirmacion.get("fragmento") or ""
    marcado = marcar_pasaje(texto, pasaje) if texto and pasaje else {"tramos": [], "falta": None, "completo": False}
    # Las demás páginas o secciones leídas de la misma fuente, para moverse.
    leidos = [
        {
            "localizador": fr.get("localizador"),
            "clase": _clase_de_localizador(fr.get("localizador", "")),
            "pagina": _numero_de_pagina(fr.get("localizador", "")),
            "actual": V.normalizar(fr.get("localizador", "")) == V.normalizar(localizador),
        }
        for fr in (fuente.get("fragmentos") or [])
    ]
    fragmentos = _fragmentos_para_verificador(corrida)
    hoy = comprobacion_de_hoy(afirmacion, fragmentos)
    veredicto_hoy = bloquea_hoy(afirmacion, fragmentos)
    return {
        "hoy": hoy,
        "veredictoDeHoy": veredicto_hoy,
        "bloqueoViejo": bool(afirmacion.get("veredicto") in V.BLOQUEAN and not veredicto_hoy["bloquea"]),
        "afirmacion": {
            "id": afirmacion.get("id"),
            "texto": afirmacion.get("texto"),
            "cita": afirmacion.get("cita"),
            "veredicto": afirmacion.get("veredicto"),
            "motivo": afirmacion.get("motivo"),
            "tipo": afirmacion.get("tipo"),
            "tema": afirmacion.get("tema"),
            "iteracion": afirmacion.get("iteracion", 0),
            "pasaje": pasaje,
        },
        "fuente": {
            "id": fuente.get("id"),
            "referencia": fuente.get("referencia") or "",
            "titulo": fuente.get("titulo") or "",
            "doi": fuente.get("doi"),
            "pmid": fuente.get("pmid"),
            "nct": fuente.get("nct"),
            "anio": fuente.get("anio"),
            "tipo": fuente.get("tipo"),
            "tipoEstudio": fuente.get("tipoEstudio"),
            "retraccion": fuente.get("retraccion"),
            "textoCompleto": bool(fuente.get("textoCompleto")),
        },
        "localizador": localizador,
        "clase": _clase_de_localizador(localizador),
        "pagina": _numero_de_pagina(localizador) if _clase_de_localizador(localizador) == "pagina" else None,
        "encabezado": (fragmento or {}).get("encabezado") or "",
        "texto": texto,
        "tramos": marcado["tramos"],
        "falta": marcado["falta"],
        "completo": marcado["completo"],
        "conPdf": bool(fragmento and fragmento.get("_ruta") and Path(str(fragmento["_ruta"])).exists()),
        "url": (fragmento or {}).get("_url") or "",
        "leidos": leidos,
    }


def ruta_pdf(corrida: dict[str, Any], afirmacion_id: str) -> Path | None:
    """El PDF del que salió la página de esa afirmación, si está en disco.
    Solo se devuelve una ruta que esté DENTRO del directorio de PDF: la ruta
    viene del estado, y el estado no manda sobre qué ficheros sirve ROSA2018."""
    from rosa import config

    ficha_ = ficha(corrida, afirmacion_id)
    if not ficha_:
        return None
    fuente = _fuentes_de(corrida).get((next((a for a in corrida.get("_afirmaciones", []) if isinstance(a, dict) and a.get("id") == afirmacion_id), {}) or {}).get("fuenteId") or "") or {}
    fragmento = _fragmento_de(fuente, ficha_["localizador"]) if fuente else None
    cruda = (fragmento or {}).get("_ruta")
    if not cruda:
        return None
    ruta = Path(str(cruda)).resolve()
    directorio = Path(config.DIR_PDFS).resolve()
    if not ruta.is_file() or directorio not in ruta.parents:
        return None
    return ruta


# El resaltado del PDF. Chrome no sabe hacerlo: su visor solo lee `nameddest`,
# `navpanes`, `page`, `toolbar`, `view` y `zoom`
# (chrome/browser/resources/pdf/open_pdf_params_parser.ts), y `search=` lo
# ignora sin decir nada. Por eso el PDF se abría por la página buena y el
# pasaje sin marcar. Como el PDF lo sirve ROSA2018, lo marca ROSA2018: se
# pintan las palabras del pasaje sobre la página y se devuelve una imagen.
# Naranja de la interfaz (.citas-texto mark), para que marque igual en los dos
# sitios.
class PdfIlegible(Exception):
    """El PDF está en disco pero no se puede abrir (roto, cifrado, truncado).
    No es lo mismo que no tenerlo, y se dice distinto: si se juntaran las dos
    cosas en un 404 se estaría escondiendo un fallo detrás de una ausencia."""


MARCA = (0.94, 0.63, 0.19)
OPACIDAD_MARCA = 0.38
ESCALA_PAGINA = 2.0
# Un respiro alrededor de la palabra, para que se lea como un subrayador y no
# como una caja pegada a las letras.
HOLGURA = 1.2


def _palabras_del_pdf(pagina: Any) -> list[tuple[str, Any]]:
    """(palabra normalizada, rectángulo) por cada palabra de la página, en el
    orden de lectura y con la misma normalización que el texto.

    Una "palabra" del PDF puede llevar puntuación pegada ("(ADAD),"), así que
    se parte igual que el texto y cada trozo se queda con el rectángulo de la
    palabra entera: se resalta un pelo de más, que es lo que hace un
    subrayador, nunca de menos."""
    salida: list[tuple[str, Any]] = []
    for x0, y0, x1, y1, palabra, *_ in pagina.get_text("words"):
        for m in _PALABRA.finditer(palabra):
            p = V.normalizar(unicodedata.normalize("NFKC", m.group(0)))
            if p:
                salida.append((p, (x0, y0, x1, y1)))
    return salida


def rectangulos_del_pasaje(pagina: Any, pasaje: str) -> dict[str, Any]:
    """Dónde cae el pasaje dentro de una página de PDF, en rectángulos.

    Misma regla que `marcar_pasaje`: los mismos tramos por elisión, la misma
    normalización y el mismo `_buscar_tramo`, para que lo que se pinta sobre
    el PDF sea exactamente lo que el verificador dio por encontrado. Devuelve
    `{"rectangulos": [...], "falta": str | None, "completo": bool}`."""
    palabras = _palabras_del_pdf(pagina)
    # `_buscar_tramo` solo mira la palabra; las posiciones le dan igual, así
    # que se le pasa el índice en las dos y se reaprovecha tal cual.
    indexadas = [(p, i, i) for i, (p, _) in enumerate(palabras)]
    trozos = [t for t in V._ELISION.split(pasaje or "") if t and t.strip()]
    if not trozos or not palabras:
        return {"rectangulos": [], "falta": None, "completo": False}
    rectangulos: list[tuple[float, float, float, float]] = []
    desde = 0
    for trozo in trozos:
        buscado = [p for p, _, _ in palabras_con_posicion(trozo)]
        if not buscado:
            continue
        encontrado = _buscar_tramo(indexadas, buscado, desde)
        if encontrado is None:
            return {"rectangulos": rectangulos, "falta": " ".join(buscado), "completo": False}
        i, j = encontrado
        rectangulos.extend(r for _, r in palabras[i : j + 1])
        desde = j + 1
    return {"rectangulos": rectangulos, "falta": None, "completo": bool(rectangulos)}


def _unir_por_linea(rectangulos: list[tuple[float, float, float, float]]) -> list[tuple[float, float, float, float]]:
    """Junta en un solo trazo las palabras seguidas de una misma línea.

    Palabra a palabra el resaltado sale a huecos, porque los espacios de en
    medio no son de ninguna palabra y quedan sin pintar: se lee como una fila
    de cajitas en vez de como un subrayador. Se unen las que comparten línea y
    están pegadas; entre líneas no se une nada, que si no el trazo cruzaría el
    margen."""
    if not rectangulos:
        return []
    # Por líneas: dos palabras son de la misma si sus bandas verticales se
    # solapan más de la mitad de la altura de la más baja.
    ordenados = sorted(rectangulos, key=lambda r: (round(r[1], 1), r[0]))
    salida: list[list[float]] = []
    for x0, y0, x1, y1 in ordenados:
        if salida:
            ax0, ay0, ax1, ay1 = salida[-1]
            solape = min(ay1, y1) - max(ay0, y0)
            misma_linea = solape > 0.5 * min(ay1 - ay0, y1 - y0)
            # El hueco de un espacio, no el de una columna entera.
            pegadas = x0 - ax1 <= 0.6 * (ay1 - ay0)
            if misma_linea and pegadas:
                salida[-1] = [min(ax0, x0), min(ay0, y0), max(ax1, x1), max(ay1, y1)]
                continue
        salida.append([x0, y0, x1, y1])
    return [(a, b, c, d) for a, b, c, d in salida]


def pagina_marcada(corrida: dict[str, Any], afirmacion_id: str, escala: float = ESCALA_PAGINA) -> tuple[bytes, dict[str, Any]] | None:
    """La página del PDF de esa cita, en PNG, con el pasaje pintado encima.

    Devuelve `(png, {"pagina", "marcado", "palabras", "falta"})`, o None si no
    hay PDF. `marcado` en False es una página honrada sin marca: se enseña la
    página igual y se dice que el pasaje no se encontró ahí, que es
    justamente lo que hay que poder discutir."""
    import pymupdf

    ruta = ruta_pdf(corrida, afirmacion_id)
    if ruta is None:
        return None
    ficha_ = ficha(corrida, afirmacion_id)
    if not ficha_:
        return None
    try:
        documento = pymupdf.open(ruta)
    except Exception as ex:  # noqa: BLE001  un PDF roto o cifrado no es "no hay PDF"
        raise PdfIlegible(f"el PDF guardado no se pudo abrir: {type(ex).__name__}") from ex
    try:
        pasaje = ficha_["afirmacion"].get("pasaje") or ""
        numero = ficha_.get("pagina")
        declarada = isinstance(numero, int) and 1 <= numero <= documento.page_count
        if declarada:
            indice = numero - 1
        else:
            # El número de página no cae dentro del PDF, así que no dice dónde
            # mirar: se busca el pasaje por el documento y se enseña la página
            # donde esté de verdad. Si no está en ninguna, la primera, que es
            # lo único que se puede enseñar sin inventar.
            indice = next(
                (i for i in range(documento.page_count) if rectangulos_del_pasaje(documento[i], pasaje)["completo"]),
                0,
            )
        pagina = documento[indice]
        hallado = rectangulos_del_pasaje(pagina, pasaje)
        for x0, y0, x1, y1 in _unir_por_linea(hallado["rectangulos"]):
            pagina.draw_rect(
                pymupdf.Rect(x0 - HOLGURA, y0 - HOLGURA, x1 + HOLGURA, y1 + HOLGURA),
                color=None,
                fill=MARCA,
                fill_opacity=OPACIDAD_MARCA,
                overlay=True,
            )
        imagen = pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala))
        return imagen.tobytes("png"), {
            "pagina": indice + 1,
            "paginas": documento.page_count,
            "marcado": bool(hallado["rectangulos"]),
            "palabras": len(hallado["rectangulos"]),
            "falta": hallado["falta"],
            "completo": hallado["completo"],
            "paginaDeclarada": bool(declarada),
        }
    finally:
        documento.close()


# Estados en los que la corrida tiene trabajo en vuelo: reverificar a la vez
# sería escribir sobre las mismas afirmaciones desde dos sitios.
ESTADOS_VIVOS = ("en_marcha", "esperando_aprobacion", "esperando_plan", "esperando_modelo")


def a_reverificar(corrida: dict[str, Any]) -> list[dict[str, Any]]:
    """Las afirmaciones bloqueadas que el verificador de hoy ya no bloquearía.
    Son las que tiene sentido volver a pasar: las demás siguen caídas por una
    razón que no ha cambiado."""
    fragmentos = _fragmentos_para_verificador(corrida)
    return [
        a
        for a in corrida.get("_afirmaciones", []) or []
        if isinstance(a, dict) and a.get("veredicto") in V.BLOQUEAN and not bloquea_hoy(a, fragmentos)["bloquea"]
    ]


async def reverificar(almacen: Any, programas: Any, modelos: Any, corrida_id: str) -> dict[str, Any]:
    """Vuelve a verificar las afirmaciones que hoy ya no estarían bloqueadas:
    primero las comprobaciones deterministas y, para las que las pasan, el
    juez. Escribe el veredicto nuevo en el estado.

    Se hace con el mismo camino que usa el bucle (`verificar_afirmaciones`), no
    con una copia: el veredicto que sale de aquí es el mismo que saldría de una
    iteración, con su registro de llamadas y su presupuesto."""
    from rosa.bucle import pasos as PASOS

    estado = almacen.estado
    corrida = next((c for c in estado["corridas"] if c["id"] == corrida_id), None)
    if corrida is None:
        return {"ok": False, "motivo": "Corrida desconocida"}
    if corrida.get("estado") in ESTADOS_VIVOS:
        return {"ok": False, "motivo": "La corrida está trabajando ahora mismo: se reverifica cuando pare, para no escribir las mismas afirmaciones desde dos sitios."}
    afirmaciones = a_reverificar(corrida)
    if not afirmaciones:
        return {"ok": True, "revisadas": 0, "recuento": {}, "desbloqueadas": 0, "motivo": "No hay ninguna afirmación bloqueada que hoy dejara de estarlo."}
    iteraciones = [i for i in estado["iteraciones"] if i.get("corridaId") == corrida_id]
    ultima = iteraciones[-1] if iteraciones else None
    ctx = PASOS.Ctx(
        almacen=almacen,
        programas=programas,
        modelos=modelos,
        corrida_id=corrida_id,
        investigacion_id=corrida["investigacionId"],
        iteracion_id=(ultima or {}).get("id", ""),
        numero=(ultima or {}).get("numero", 0),
    )
    inv = next((i for i in estado["investigaciones"] if i["id"] == corrida["investigacionId"]), {})
    antes = {a["id"]: a.get("veredicto") for a in afirmaciones}
    recuento = await PASOS.verificar_afirmaciones(ctx, afirmaciones, None, inv.get("objetivo", ""))
    desbloqueadas = sum(1 for a in afirmaciones if antes.get(a["id"]) in V.BLOQUEAN and a.get("veredicto") not in V.BLOQUEAN)
    return {"ok": True, "revisadas": len(afirmaciones), "recuento": recuento, "desbloqueadas": desbloqueadas}


def resumen(corrida: dict[str, Any]) -> dict[str, Any]:
    """Cuántas afirmaciones hay por veredicto y cuántas resuelven a página
    exacta. Es la cifra honesta de la pantalla: la mayoría de las fuentes no
    tienen PDF, y eso se dice en vez de disimularlo."""
    filas = lista(corrida)
    por_veredicto: dict[str, int] = {}
    por_clase: dict[str, int] = {}
    for f in filas:
        por_veredicto[f["veredicto"] or "sin veredicto"] = por_veredicto.get(f["veredicto"] or "sin veredicto", 0) + 1
        por_clase[f["clase"]] = por_clase.get(f["clase"], 0) + 1
    return {
        "total": len(filas),
        "porVeredicto": por_veredicto,
        "porClase": por_clase,
        "conPagina": sum(1 for f in filas if f["clase"] == "pagina"),
        "conPdf": sum(1 for f in filas if f["conPdf"]),
        # Bloqueadas que el verificador de hoy ya no bloquea. Es el número que
        # cuenta para recuperarlas, y NO es el mismo que el de las que tienen
        # la cita en orden: alguna pasa las dos señales y sigue cayendo por un
        # identificador que no aparece o por una ausencia que la fuente niega.
        "bloqueosViejos": sum(1 for f in filas if f["bloqueoViejo"]),
        "conCitaEnOrden": sum(1 for f in filas if f["hoy"]["resuelve"] and f["hoy"]["literal"]),
        "bloqueadasConCitaEnOrden": sum(1 for f in filas if f["veredicto"] in V.BLOQUEAN and f["hoy"]["resuelve"] and f["hoy"]["literal"]),
        "resuelvenHoy": sum(1 for f in filas if f["hoy"]["resuelve"]),
        "literalesHoy": sum(1 for f in filas if f["hoy"]["literal"]),
    }
