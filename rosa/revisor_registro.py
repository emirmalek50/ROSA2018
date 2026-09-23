"""El revisor de registro (lo que Claude Science llama RequestReview): al
cerrar una iteración y al generar un dossier, se compara lo que ROSA2018 dice
con lo que el registro prueba. Seis clases de hallazgo, las mismas que el
revisor de Claude Science detecta:

- calculo_no_ejecutado: se afirma un resultado o una ejecución que no consta.
- contradiccion_con_registro: una cifra o un hecho contradice un fichero,
  una ejecución o una afirmación verificada.
- cita_sin_soporte: se cita una fuente que no esta en el registro o que no
  dice eso.
- identificador_no_coincide: un DOI, PMID, NCT o GSE que no aparece en las
  fuentes ni en las consultas.
- paso_incompleto: el plan tiene pasos sin terminar y el resumen no lo dice.
- conclusion_no_sigue: la conclusión afirma mas de lo que el metodo permite.
- cifra_fuera_de_contexto: la cifra esta en el registro, pero referida a otra
  entidad que la de la frase (el umbral de un marcador puesto sobre otro).

Primero las comprobaciones por regla (cifras e identificadores contra el
registro, verbos de ejecución contra las ejecuciones, pasos del plan);
después el juez lee resumen y registro y añade lo que la regla no ve. Un
hallazgo no borra nada: queda a la vista con su clase y su gravedad, y la
iteración se marca "con hallazgos" hasta que alguien los atienda.

Cifras con procedencia (23 de septiembre de 2026). Comprobar que una cifra
del texto "aparece en el registro" no basta: el registro entero es un saco de
números, y el umbral de un marcador colocado sobre otro marcador pasa la
comprobación porque el número existe en alguna parte. Es el fallo más repetido
que el revisor de Claude Science le encontró a su propio agente (13 de sus 64
fallos), y su verificador tenía este mismo diseño: "only tests whether a
numeral STRING exists anywhere in the spec, not whether it is attached to the
correct field". Por eso cada cifra se guarda junto a las entidades que la
rodean (`anclar_numeros`): el marcador, el tipo celular, el tejido, la cohorte.
Una cifra que existe en el registro pero con anclas que no tocan las de la
frase es un hallazgo aparte, `cifra_fuera_de_contexto`, y no se confunde con
la que no existe. Es la misma exigencia que ya se le hace a las citas, que
resuelven a la página exacta: una cifra resuelve a su sujeto.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import ontologias as ONT
from rosa import progreso as PROG

CLASES = ("calculo_no_ejecutado", "contradiccion_con_registro", "cita_sin_soporte", "identificador_no_coincide", "paso_incompleto", "conclusion_no_sigue", "cifra_fuera_de_contexto")
# Las que el juez puede emitir: `cifra_fuera_de_contexto` sale solo de la regla,
# que compara anclas, y no se le ofrece al modelo para que no la use de comodin.
CLASES_JUEZ = CLASES[:6]

_NUM = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{2,}(?:[.,]\d+)?|\d[.,]\d+|[.,]\d+)(?![\w])")
_DOI = re.compile(r"10\.\d{4,9}/[^\s\]\)>,;]+", re.I)
_NCT = re.compile(r"NCT\d{8}")
_GSE = re.compile(r"GSE\d{3,7}")
_PMID = re.compile(r"PMID[:\s]*(\d{6,9})", re.I)
_EJECUCION = re.compile(r"\b(se ejecut\w*|se reprodu\w*|se calcul\w*|corri[oó]|se analiz\w*|analisis in silico|sandbox|reproducci[oó]n superada|valor reproducido)\b", re.I)
_RESERVA = re.compile(r"\b(pendiente|fall[oó]|fallid[oa]s?|sin terminar|incomplet[oa]s?|no pudo|no se pudo|no respondi[oó]|interrumpid[oa]|quedo sin|queda sin|omitid[oa]s?)\b", re.I)


def _norm(n: str) -> str:
    n = n.replace("\u00b7", ".")
    # "1,234" es ambiguo (mil doscientos treinta y cuatro en ingles, uno coma
    # doscientos treinta y cuatro en castellano) y se lee como miles, que es de
    # donde vienen los fragmentos en ingles. "0,027" no lo es: nadie escribe un
    # grupo de miles con un cero delante. Se leia como 27 y una p de 0,001 como
    # 1, justo las cifras que ROSA2018 mas escribe (23 de septiembre de 2026).
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", n) and not re.match(r"0,", n):
        n = n.replace(",", "")
    else:
        n = n.replace(",", ".")
    if n.startswith("."):
        n = "0" + n
    try:
        return f"{float(n):g}"
    except ValueError:
        return n


def _numeros(texto: str) -> set[str]:
    return {n for n, _, _ in _numeros_situados(texto)}


def _numeros_situados(texto: str) -> list[tuple[str, int, int]]:
    """Cada cifra con dónde está, para poder mirar qué la rodea. Los años
    sueltos se saltan, como en la comprobación de siempre."""
    out: list[tuple[str, int, int]] = []
    for m in _NUM.finditer((texto or "").replace("\u00b7", ".")):
        n = _norm(m.group(1))
        try:
            v = float(n)
        except ValueError:
            continue
        if 1900 <= v <= 2099 and "." not in n:
            continue
        out.append((n, m.start(1), m.end(1)))
    return out


# Cuánto texto a cada lado cuenta como "lo que la cifra dice ser". Noventa
# caracteres cogen la frase corta entera y no saltan a la siguiente.
VENTANA_ANCLA = 90

# Siglas del dominio que sirven de ancla y no están en el diccionario curado
# (cohortes, escalas, ensayos). Se comparan en mayúsculas.
_SIGLA = re.compile(r"\b[A-Z][A-Z0-9]{2,9}\b")
_ETIQUETA_ANCLA = {i: e for _, i, e, _, _ in ONT.CURADAS}
# Lo que ROSA2018 escribe en mayúsculas y no identifica a nadie.
_NO_SON_ANCLA = frozenset({
    "ROSA", "ROSA2018", "GRADE", "PRISMA", "DOI", "PMID", "NCT", "GSE", "URL", "API", "JSON", "CSV", "PDF", "HTTP", "HTTPS",
    "AND", "NOT", "PERO", "SOLO", "TODO", "NADA", "MAS", "MENOS", "ESTE", "ESTA", "ESTOS", "ESTAS", "PARA", "POR", "CON", "SIN",
    "IC95", "IC90", "IC", "SD", "EE", "DE", "LA", "EL", "LOS", "LAS", "UNA", "UNO",
})


# Lo que convierte una cifra en una medida y no en contabilidad. Un decimal ya
# lo es (valores p, tamaños de efecto, correlaciones, umbrales); un entero solo
# si lleva unidad detrás. Sin esto, "de 35 afirmaciones, 29 sostenidas" se
# anclaba al marcador que la frase nombrara de paso: 16 falsos positivos en los
# 40 resúmenes reales del estado, todos de recuentos (23 de septiembre de 2026).
# Los recuentos tienen su propia comprobación, que los recalcula del registro.
_UNIDAD = re.compile(
    r"\s*(?:%|por\s+ciento|pg\s*/\s*m[lL]|ng\s*/\s*[mlL]|[uµ]?g\s*/\s*[mlL]|mg|kg|[uµ]M|nM|mM|pM|mm|cm|nm|ml|dL|"
    r"z\b|SD\b|DE\b|SUVR|Centiloid|UI\b|U\s*/\s*L|a[ñn]os?|meses|d[ií]as?|semanas?|horas?|min\b|puntos?|veces)",
    re.IGNORECASE,
)


def es_medida(texto: str, n: str, fin: int) -> bool:
    """Si la cifra mide algo o solo cuenta objetos de ROSA2018. Solo se le
    pregunta de quién es a lo que mide: un recuento no tiene dueño biológico, y
    el marcador que la frase nombre de paso no lo convierte en uno."""
    return "." in n or bool(_UNIDAD.match(texto or "", fin))


def anclas_cerca(texto: str, inicio: int, fin: int, ventana: int = VENTANA_ANCLA) -> frozenset[str]:
    """De qué habla una cifra: las entidades que la rodean en el texto. Salen
    del diccionario curado de `rosa/ontologias.py` (determinista, sin red), de
    los identificadores de conjunto de datos y de ensayo, y de las siglas del
    dominio. Vacío significa que la frase no nombra a nadie, y entonces no se
    puede decir nada sobre si la cifra está en su sitio."""
    trozo = (texto or "")[max(0, inicio - ventana):fin + ventana]
    anclas = {a["id"] for a in ONT.anotar_curadas(trozo)}
    anclas |= {f"gse:{x.upper()}" for x in _GSE.findall(trozo)}
    anclas |= {f"nct:{x.upper()}" for x in _NCT.findall(trozo)}
    anclas |= {f"sig:{x}" for x in _SIGLA.findall(trozo) if x not in _NO_SON_ANCLA}
    return frozenset(anclas)


def anclar_numeros(texto: str, destino: dict[str, set[str]] | None = None) -> dict[str, set[str]]:
    """Cada cifra del texto con la unión de las anclas de todas sus apariciones.
    Se acumula sobre `destino` para recorrer el registro texto a texto: una
    cifra del hecho A no hereda las anclas del hecho B."""
    out = destino if destino is not None else {}
    for n, i, j in _numeros_situados(texto):
        if not es_medida(texto, n, j):
            continue
        out.setdefault(n, set()).update(anclas_cerca(texto, i, j))
    return out


def corpus_del_registro(e: dict[str, Any], inv_id: str, it: dict[str, Any] | None, corrida: dict[str, Any] | None, hipotesis: dict[str, Any] | None = None) -> dict[str, Any]:
    """Todo lo que el registro sabe: números, identificadores y textos, para
    contrastar un resumen o un dossier."""
    textos: list[str] = []
    numeros: set[str] = set()
    ids: set[str] = set()
    hips = [hipotesis] if hipotesis else [h for h in e.get("hipotesis", []) if h["investigacionId"] == inv_id]
    afs = list((corrida or {}).get("_afirmaciones", [])) + [a for h in hips for a in h.get("afirmaciones", [])]
    for a in afs:
        textos += [a.get("texto", ""), a.get("fragmento", ""), a.get("cita", ""), a.get("efecto", ""), a.get("incertidumbre", ""), a.get("n", "")]
    for h in hips:
        textos += [h.get("titulo", ""), h.get("enunciado", ""), h.get("mecanismo", "")]
        for f in h.get("procedencia", {}).get("fuentes", []):
            ids.update(x for x in (f.get("doi"), f.get("pmid"), f.get("nct")) if x)
            textos.append(f.get("referencia", ""))
        for q in h.get("consultas", []):
            ids.update(q.get("ids", []))
            ids.update(str(v) for v in q.get("argumentos", {}).values())
        for pr in (h.get("procedencia", {}).get("registro") or []):
            textos.append(pr)
    for hch in e.get("hechos", []):
        if hch["investigacionId"] == inv_id:
            textos.append(hch.get("enunciado", ""))
            for p in hch.get("procedencia", []):
                ids.update(x for x in (p.get("doi"), p.get("pmid")) if x)
    for r in e.get("ejecuciones", []):
        if r.get("investigacionId") == inv_id or any(r.get("hipotesisId") == h["id"] for h in hips):
            for d in (r.get("resultados"), r.get("baseline"), r.get("controlNegativo")):
                for k, v in (d or {}).items():
                    textos.append(f"{k}={v}")
            textos.append(r.get("salida", "")[-2000:])
    for rep in e.get("reproducciones", []):
        if rep.get("investigacionId") == inv_id:
            textos += [str(rep.get("valorPublicado")), str(rep.get("valorObtenido")), rep.get("referencia", ""), rep.get("doi", "")]
            if rep.get("doi"):
                ids.add(rep["doi"])
    for inv in e.get("investigaciones", []):
        if inv["id"] == inv_id:
            for ds in inv.get("datasets", []):
                textos += [ds.get("nombre", ""), ds.get("descripcion", ""), str((ds.get("procedencia") or {}).get("filas", ""))]
                ids.update(_GSE.findall(ds.get("nombre", "") + " " + ds.get("descripcion", "")))
    if it:
        for p in it.get("plan", []):
            textos += [p.get("titulo", ""), p.get("detalle", ""), p.get("motivoFallo") or ""]
        for pi in it.get("pistas", []):
            textos += [pi.get("titulo", ""), pi.get("resumen", "") or ""]
            for ev in pi.get("transcripcion", []) or []:
                textos.append(str(ev.get("texto", "")) + " " + str((ev.get("consulta") or {}).get("resultados", "")))
    for q in (corrida or {}).get("busqueda", {}).get("consultas", []) or []:
        textos.append(f"{q.get('base', '')} {q.get('consulta', '')} {q.get('resultados', '')}")
    if it:
        textos += [str(len(it.get("plan", []))), str(sum(1 for p in it.get("pistas", []) if p.get("estado") == "hecha")), str(len(it.get("pistas", [])))]
    anclados: dict[str, set[str]] = {}
    for t in textos:
        numeros |= _numeros(t)
        anclar_numeros(t, anclados)
        ids.update(_DOI.findall(t)); ids.update(_NCT.findall(t)); ids.update(_GSE.findall(t))
    return {"numeros": numeros, "anclados": anclados, "ids": {str(i).lower().rstrip(".") for i in ids}, "textos": textos, "recuentos": recuentos_del_registro(e, inv_id, it, corrida)}


_RECUENTO = re.compile(r"(\d{1,5})(?:\s+de\s+(\d{1,5}))?\s+(hechos?|afirmaci(?:ó|o)n(?:es)?|fuentes?|art(?:í|i)culos?|publicaciones?|b(?:ú|u)squedas?|consultas?|hip(?:ó|o)tesis|ejecuci(?:ó|o)n(?:es)?|pasos?|pistas?)\b", re.IGNORECASE)
_CLAVE_RECUENTO = {"hecho": "hechos", "afirmaci": "afirmaciones", "fuente": "fuentes", "art": "fuentes", "publicaci": "fuentes", "b": "consultas", "consulta": "consultas", "hip": "hipotesis", "ejecuci": "ejecuciones", "paso": "pasos", "pista": "pistas"}
_KILLER_CERRADA = {"descartar", "descartar_en_contexto", "suspender"}


def _clave_recuento(sustantivo: str) -> str:
    s_ = sustantivo.lower()
    for prefijo, clave in _CLAVE_RECUENTO.items():
        if s_.startswith(prefijo):
            return clave
    return s_


# "N hipótesis en cola" es un recuento de la cola, no del total de hipótesis: lo
# comprueba `recuentos_en_cola`, y aquí se deja pasar. Sin esto, la frase por regla
# "6 hipótesis en cola" con 7 hipótesis en la investigación salía como contradicción.
_TRAS_EN_COLA = re.compile(r"\s+(?:(?:siguen|quedan|permanecen|est(?:á|a)n)\s+)?en\s+(?:la\s+)?cola\b", re.IGNORECASE)


def recuentos_del_texto(texto: str) -> list[tuple[int, str, str]]:
    """Los "N cosas" del texto: (n, clave, tal como aparece). "40 de 59 hechos"
    da los dos números con la misma clave. "N hipótesis en cola" no entra: es un
    recuento de la cola (ver `recuentos_en_cola`)."""
    salida = []
    for m in _RECUENTO.finditer(texto or ""):
        clave = _clave_recuento(m.group(3))
        if clave == "hipotesis" and _TRAS_EN_COLA.match(texto or "", m.end()):
            continue
        salida.append((int(m.group(1)), clave, m.group(0)))
        if m.group(2):
            salida.append((int(m.group(2)), clave, m.group(0)))
    return salida


_PALABRAS_NUMERO = {"una": 1, "un": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12, "ninguna": 0, "ningun": 0, "ninguno": 0}
# El número que va detrás de "en cola" tiene que ir seguido de "hipótesis", de
# puntuación o del final: "en cola un total de nueve" no es "en cola una".
_EN_COLA = re.compile(r"(?:quedan?|hay|siguen|permanecen|est(?:á|a)n?)?\s*en\s+(?:la\s+)?cola\s+(?:de\s+hip(?:ó|o)tesis\s+)?(?:quedan?\s+|hay\s+)?(\d{1,3}|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|ninguna|ninguno|ning(?:ú|u)n)\b(?=\s*(?:hip(?:ó|o)tesis|[.,;:)]|$))|(\d{1,3}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|ninguna)\s+hip(?:ó|o)tesis\s+(?:siguen\s+|quedan\s+|permanecen\s+|est(?:á|a)n\s+)?en\s+(?:la\s+)?cola\b", re.IGNORECASE)


def _numero_de(palabra: str) -> int | None:
    p = palabra.lower().replace("ú", "u").replace("ó", "o")
    if p.isdigit():
        return int(p)
    return _PALABRAS_NUMERO.get(p)


# Calificativos que convierten un recuento de la cola en un desglose ("dos
# hipótesis en cola suspendidas", "3 en cola con descarte propuesto").
_CALIFICATIVO_COLA = re.compile(r"descart|suspend|sin\s+juzgar|sin\s+decisi(?:ó|o)n|por\s+juzgar", re.IGNORECASE)


def _en_cola_con_contexto(texto: str) -> list[tuple[int, str, bool]]:
    """(n, tal como aparece, lleva calificativo de desglose en las 60 letras que
    rodean al recuento)."""
    salida = []
    texto = texto or ""
    for m in _EN_COLA.finditer(texto):
        n = _numero_de(m.group(1) or m.group(2) or "")
        if n is None:
            continue
        ventana = texto[max(0, m.start() - 60): m.end() + 60]
        salida.append((n, m.group(0).strip(), bool(_CALIFICATIVO_COLA.search(ventana))))
    return salida


def recuentos_en_cola(texto: str) -> list[tuple[int, str]]:
    """Los "en cola N" o "N hipótesis en cola" del texto, con el número en cifra
    o en letra (uno a doce, ninguna): (n, tal como aparece)."""
    return [(n, tal_cual) for n, tal_cual, _ in _en_cola_con_contexto(texto)]


def recuentos_del_registro(e: dict[str, Any], inv_id: str, it: dict[str, Any] | None, corrida: dict[str, Any] | None) -> dict[str, set[int]]:
    """Los recuentos que el registro admite para cada palabra: total de la
    investigación, lo de esta iteración y los desgloses (por veredicto, por
    base). Un resumen que dice "59 hechos" cuando el registro tiene 40 en
    total y 11 nuevos se contradice con el registro, y eso se ve sin juez."""
    c = corrida or {}
    desde = int((it or {}).get("empezadaEn") or 0)
    numero = (it or {}).get("numero")
    hechos = [h for h in e.get("hechos", []) if h.get("investigacionId") == inv_id]
    hips = [h for h in e.get("hipotesis", []) if h.get("investigacionId") == inv_id]
    en_cola = [h for h in hips if h.get("estado") in ("propuesta", "en_revision")]
    afs = list(c.get("_afirmaciones", []))
    afs_it = [a for a in afs if a.get("iteracion") == numero]
    consultas = list((c.get("busqueda") or {}).get("consultas") or [])
    consultas_it = [q for q in consultas if q.get("iteracion") == numero]
    por_base: dict[str, int] = {}
    for q in consultas_it:
        por_base[q.get("base", "")] = por_base.get(q.get("base", ""), 0) + 1
    por_veredicto: dict[str, int] = {}
    for a in afs_it:
        por_veredicto[a.get("veredicto", "")] = por_veredicto.get(a.get("veredicto", ""), 0) + 1
    fuentes = c.get("_fuentes") or {}
    b = c.get("busqueda") or {}
    ejecuciones = [r for r in e.get("ejecuciones", []) if r.get("investigacionId") == inv_id]
    plan = (it or {}).get("plan", []) or []
    pistas = (it or {}).get("pistas", []) or []
    return {
        "hechos": {len(hechos), sum(1 for h in hechos if int(h.get("actualizadoEn") or 0) >= desde and desde)},
        "afirmaciones": {len(afs), len(afs_it), *por_veredicto.values()},
        "fuentes": {len(fuentes), int(b.get("identificados") or 0), int(b.get("cribados") or 0), int(b.get("textoCompleto") or 0), int(b.get("traidos") or 0), sum(1 for f in fuentes.values() if f.get("relevancia", 0) and int(f.get("_iteracion") or 0) == numero) if numero else 0},
        "consultas": {len(consultas), len(consultas_it), *por_base.values()},
        # "Nuevas" por ventana de fecha (rosa/progreso.py), no por número de iteración:
        # el número vuelve a 1 en cada corrida y daba por buenas cifras falsas.
        "hipotesis": {len(hips), len(PROG.hipotesis_nacidas_en(e, inv_id, it))},
        "cola": {len(en_cola)},
        # Los desgloses de la cola (descarte propuesto, suspendidas, sin juzgar) también
        # se admiten, porque "5 hipótesis en cola con descarte propuesto" es verdad.
        "colaDesglose": {sum(1 for h in en_cola if h.get("decisionKiller") in ("descartar_en_contexto", "descartar")), sum(1 for h in en_cola if h.get("decisionKiller") == "suspender"), sum(1 for h in en_cola if not h.get("decisionKiller"))},
        "ejecuciones": {len(ejecuciones), sum(1 for r in ejecuciones if r.get("estado") == "completado")},
        "pasos": {len(plan), sum(1 for p_ in plan if p_.get("estado") == "hecho")},
        "pistas": {len(pistas), sum(1 for p_ in pistas if p_.get("estado") == "hecha")},
    }


def comprobaciones_deterministas(texto: str, corpus: dict[str, Any], it: dict[str, Any] | None, ejecuciones_ok: int, hipotesis: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Los hallazgos que se pueden derivar sin modelo."""
    hallazgos: list[dict[str, Any]] = []
    # Recuentos ("59 hechos", "2 búsquedas") frente a lo que el registro admite.
    recuentos = corpus.get("recuentos") or {}
    malos = []
    for n, clave, tal_cual in recuentos_del_texto(texto):
        admitidos = recuentos.get(clave)
        if admitidos and n not in admitidos:
            malos.append(f"«{tal_cual.strip()}» (el registro admite {', '.join(str(x) for x in sorted(admitidos))})")
    if malos:
        hallazgos.append({"clase": "contradiccion_con_registro", "gravedad": "media", "detalle": "Recuentos del texto que no cuadran con el registro: " + "; ".join(malos[:6]), "origen": "regla"})
    # "Quedan en cola dos hipótesis" frente a las que de verdad esperan (propuestas o en
    # revisión). El número puede ir en cifra o en letra; 26 hallazgos del juez repetían
    # esta contradicción y ahora la ve la regla, gratis.
    en_cola = recuentos.get("cola")
    if en_cola:
        # Un desglose ("3 en cola con descarte propuesto") solo vale si la frase lo
        # nombra; "quedan en cola dos hipótesis" a secas se compara con el total.
        desglose = set(recuentos.get("colaDesglose") or ())
        malos_cola = [f"«{tal_cual.strip()}» (en cola hay {', '.join(str(x) for x in sorted(en_cola))})" for n, tal_cual, calificado in _en_cola_con_contexto(texto) if n not in en_cola and not (calificado and n in desglose)]
        if malos_cola:
            hallazgos.append({"clase": "contradiccion_con_registro", "gravedad": "alta", "detalle": "El texto da un recuento de la cola de hipótesis que no es el del estado: " + "; ".join(malos_cola[:4]), "origen": "regla"})
    # Una hipótesis que el Killer descartó o suspendió no puede aparecer como pendiente o viva.
    t_bajo = (texto or "").lower()
    for h in hipotesis or []:
        decision = h.get("decisionKiller")
        titulo = (h.get("titulo") or "").strip()
        if decision in _KILLER_CERRADA and titulo and titulo[:40].lower() in t_bajo and not re.search(r"descart|suspend", t_bajo):
            hallazgos.append({"clase": "contradiccion_con_registro", "gravedad": "alta", "detalle": f"El texto habla de «{titulo[:80]}» y el Killer la dejó en «{decision}»; el texto no lo dice", "origen": "regla"})
    sueltas = sorted(n for n in _numeros(texto) if n not in corpus["numeros"] and not any(abs(float(n) - float(x)) < 1e-9 for x in corpus["numeros"] if _es_num(x)))
    if sueltas:
        hallazgos.append({"clase": "contradiccion_con_registro", "gravedad": "media", "detalle": f"Cifras del texto que no aparecen en ninguna afirmación, ejecución, hecho ni pista del registro: {', '.join(sueltas[:8])}" + (" ..." if len(sueltas) > 8 else ""), "origen": "regla"})
    fuera = cifras_fuera_de_contexto(texto, corpus)
    if fuera:
        hallazgos.append({"clase": "cifra_fuera_de_contexto", "gravedad": "alta", "detalle": "Cifras que sí están en el registro, pero dichas de otra cosa: " + "; ".join(fuera[:4]) + (" ..." if len(fuera) > 4 else ""), "origen": "regla"})
    ident = {i.lower().rstrip(".") for i in _DOI.findall(texto) + _NCT.findall(texto) + _GSE.findall(texto) + _PMID.findall(texto)}
    faltan = sorted(i for i in ident if i not in corpus["ids"])
    if faltan:
        hallazgos.append({"clase": "identificador_no_coincide", "gravedad": "alta", "detalle": "Identificadores citados que no están en las fuentes, datasets ni consultas: " + ", ".join(faltan[:6]), "origen": "regla"})
    if _EJECUCION.search(texto or "") and ejecuciones_ok == 0:
        hallazgos.append({"clase": "calculo_no_ejecutado", "gravedad": "alta", "detalle": "El texto habla de ejecuciones, cálculos o reproducciones y no hay ninguna ejecución completada en el registro", "origen": "regla"})
    if it:
        sin_terminar = [p for p in it.get("plan", []) if p.get("estado") not in ("hecho", "omitido", "sin_trabajo")]
        if sin_terminar and not _RESERVA.search(texto or ""):
            hallazgos.append({"clase": "paso_incompleto", "gravedad": "media", "detalle": f"{len(sin_terminar)} pasos del plan sin terminar ({'; '.join(p.get('titulo', '')[:40] for p in sin_terminar[:3])}) y el resumen no lo dice", "origen": "regla"})
    return hallazgos


def cifras_fuera_de_contexto(texto: str, corpus: dict[str, Any]) -> list[str]:
    """Las cifras del texto que existen en el registro pero no dichas de lo que
    la frase dice. Prudente a propósito: solo habla cuando la frase nombra a
    alguien Y el registro también, y ni una sola ancla coincide. Sin anclas a
    un lado no se puede saber, y callar es lo correcto: un falso positivo aquí
    hace que se deje de mirar la lista entera."""
    anclados = corpus.get("anclados") or {}
    if not anclados:
        return []
    fuera: list[str] = []
    vistas: set[tuple[str, frozenset[str]]] = set()
    for n, i, j in _numeros_situados(texto):
        if not es_medida(texto, n, j):
            continue
        del_registro = anclados.get(n)
        if not del_registro:
            continue  # o no está en el registro (ya lo dice `sueltas`), o nadie la ancló
        aqui = anclas_cerca(texto, i, j)
        if not aqui or not _discrepan(aqui, del_registro):
            continue
        clave = (n, aqui)
        if clave in vistas:
            continue
        vistas.add(clave)
        fuera.append(f"«{texto[max(0, i - 40):j + 40].strip()}» ({n} está en el registro, pero de {_nombres(del_registro)}, no de {_nombres(aqui)})")
    return fuera


def _sujetos(anclas: frozenset[str] | set[str]) -> set[str]:
    """De todo lo que rodea a una cifra, quién es el dueño: el gen o marcador,
    la cohorte, el ensayo. El tejido, la célula, la enfermedad y el compuesto
    son contexto, y dos medidas distintas comparten contexto todo el rato."""
    return {a for a in anclas if a.startswith(("HGNC:", "sig:", "gse:", "nct:"))}


def _discrepan(aqui: frozenset[str], del_registro: set[str]) -> bool:
    """Si la cifra está dicha de otra cosa. Cuando las dos frases nombran dueño,
    manda el dueño: un umbral de un marcador puesto sobre otro discrepa aunque
    las dos digan «en plasma». Cuando alguna no lo nombra, hace falta que no
    coincida nada para hablar."""
    s_aqui, s_reg = _sujetos(aqui), _sujetos(del_registro)
    if s_aqui and s_reg:
        return not (s_aqui & s_reg)
    return not (aqui & del_registro)


def _nombres(anclas: frozenset[str] | set[str]) -> str:
    """Las anclas en algo que una persona pueda leer."""
    salida = [a.split(":", 1)[1] if a.startswith(("gse:", "nct:", "sig:")) else _ETIQUETA_ANCLA.get(a, a) for a in sorted(anclas)[:3]]
    return ", ".join(salida) + (" ..." if len(anclas) > 3 else "")


def _es_num(x: str) -> bool:
    try:
        float(x)
        return True
    except ValueError:
        return False


def texto_registro(e: dict[str, Any], inv_id: str, it: dict[str, Any] | None, corrida: dict[str, Any] | None, hipotesis: dict[str, Any] | None = None, maximo: int = 9000) -> str:
    """El registro en texto para el juez: plan con estados, pistas, afirmaciones
    con veredicto, ejecuciones con cifras, reproducciones, consultas."""
    lineas: list[str] = ["Nota: 'CONSULTAS A BASES ESTRUCTURADAS' son solo las llamadas a bases de genes, fármacos y datos (conectores). Las búsquedas de literatura (PubMed, Europe PMC, OpenAlex) están en 'BÚSQUEDAS DE LITERATURA' con su base y su recuento."]
    if it:
        lineas.append("PLAN: " + "; ".join(f"{p.get('titulo', '')[:50]} [{p.get('estado')}]" for p in it.get("plan", [])))
        lineas.append("PISTAS (una pista fallida seguida de otra hecha con el mismo título significa que el paso se retomó y terminó): " + "; ".join(f"{p.get('titulo', '')[:40]} [{p.get('estado')}] {(p.get('resumen') or '')[:80]}" for p in it.get("pistas", [])[:20]))
        busq = []
        for p in it.get("pistas", []):
            for ev in p.get("transcripcion", []) or []:
                q = ev.get("consulta") or {}
                if q.get("base"):
                    busq.append(f"{q.get('base')}: {str(q.get('parametros', ''))[:60]} -> {q.get('resultados', '?')} resultados")
        for q in (corrida or {}).get("busqueda", {}).get("consultas", []) or []:
            if not it or q.get("iteracion") == it.get("numero"):
                busq.append(f"{q.get('base')}: {str(q.get('consulta', ''))[:60]} -> {q.get('resultados', '?')} resultados")
        lineas.append("BÚSQUEDAS DE LITERATURA: " + ("; ".join(busq[:30]) or "ninguna registrada en las pistas"))
    hips = [hipotesis] if hipotesis else [h for h in e.get("hipotesis", []) if h["investigacionId"] == inv_id]
    lineas.append("HIPÓTESIS DE LA INVESTIGACIÓN (título [estado, decisión del Killer, iteración en que nació]): " + ("; ".join(f"{h.get('titulo', '')[:90]} [{h.get('estado')}, {h.get('decisionKiller')}, it {h.get('iteracion')}]" for h in hips[:20]) or "ninguna"))
    if it and not hipotesis:
        # Nacidas en la ventana de la iteración (rosa/progreso.py), no por número de iteración.
        nuevas = PROG.hipotesis_nacidas_en(e, inv_id, it)
        lineas.append(f"HIPÓTESIS NUEVAS EN ESTA ITERACIÓN: {len(nuevas)} (" + "; ".join(h.get("titulo", "")[:60] for h in nuevas) + "); en cola (propuestas o en revisión) al cerrar: " + str(sum(1 for h in hips if h.get("estado") in ("propuesta", "en_revision"))))
        hechos_it = [x for x in e.get("hechos", []) if x["investigacionId"] == inv_id and x.get("actualizadoEn", 0) >= it.get("empezadaEn", 0)]
        lineas.append(f"HECHOS NUEVOS O ACTUALIZADOS EN ESTA ITERACIÓN: {len(hechos_it)}")
    afs = list((corrida or {}).get("_afirmaciones", [])) if not hipotesis else list(hipotesis.get("afirmaciones", []))
    if it and not hipotesis:
        afs = [a for a in afs if a.get("iteracion") == it.get("numero")]
    lineas.append("AFIRMACIONES:")
    lineas += [f"- [{a.get('veredicto')}] {a.get('texto', '')[:160]} {a.get('cita', '')}" for a in afs[:60]]
    runs = [r for r in e.get("ejecuciones", []) if any(r.get("hipotesisId") == h["id"] for h in hips) or r.get("investigacionId") == inv_id]
    lineas.append("EJECUCIONES:")
    lineas += [f"- {r['id']} [{r.get('estado')}] auditoría={((r.get('auditoria') or {}).get('veredicto'))} " + "; ".join(f"{k}={v}" for k, v in (r.get("resultados") or {}).items()) for r in runs[-12:]] or ["- ninguna"]
    reps = [r for r in e.get("reproducciones", []) if r.get("investigacionId") == inv_id]
    lineas.append("REPRODUCCIONES: " + ("; ".join(f"{r.get('referencia', '')[:40]} [{r.get('estado')}] obtenido={r.get('valorObtenido')} publicado={r.get('valorPublicado')}" for r in reps) or "ninguna"))
    cons = [q for h in hips for q in h.get("consultas", [])]
    lineas.append("CONSULTAS A BASES ESTRUCTURADAS (conectores): " + ("; ".join(f"{q.get('herramienta')}({', '.join(str(v) for v in q.get('argumentos', {}).values())}) n={q.get('n')}{' ERROR' if q.get('error') else ''}" for q in cons[-25:]) or "ninguna"))
    fuentes = {f.get("referencia"): f for h in hips for f in h.get("procedencia", {}).get("fuentes", [])}
    lineas.append("FUENTES: " + ("; ".join(f"{r} (doi {f.get('doi') or 'no'})" for r, f in list(fuentes.items())[:40]) or "ninguna"))
    return "\n".join(lineas)[:maximo]


def resumen_revision(hallazgos: list[dict[str, Any]]) -> str:
    if not hallazgos:
        return "El revisor no encontró discrepancias entre lo dicho y el registro"
    por = {}
    for h in hallazgos:
        por[h["clase"]] = por.get(h["clase"], 0) + 1
    return f"{len(hallazgos)} hallazgos: " + ", ".join(f"{k.replace('_', ' ')} ({v})" for k, v in por.items())
