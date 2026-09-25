"""Del estado al texto que leen los modelos.

Cada función toma partes del estado y las convierte en texto compacto y
numerado, para que las firmas puedan citar "afirmación 7" o "hipótesis
hip-x". Nada de esto llama a un modelo, salvo `modelo_de_mundo_para`, que
pide un embedding al índice semántico para elegir qué hechos entran.

Dos reglas del 15 de septiembre de 2026, tras la corrida que juzgó la
relevancia con las preguntas de otra investigación:

- Conocimiento y criterio se separan. Los hechos heredados de otra
  investigación (`heredarModeloDe`, bifurcar) siguen siendo conocimiento y
  entran al modelo de mundo con la etiqueta de su origen; pero las preguntas
  abiertas heredadas no deciden qué se lee: el criterio de relevancia
  empieza por el objetivo y la pregunta de la corrida, y solo admite una
  pregunta heredada si nombra algo del objetivo.
- El árbol se lee bajo demanda. Con 140 hechos y un tope de 60 líneas, la
  mitad no llegaba nunca al modelo, y las que llegaban eran las de mayor
  prioridad, no las que venían al caso. `modelo_de_mundo_para` da un mapa
  del árbol (qué hay, por tema, cuánto es heredado) más los hechos más
  parecidos a lo que se está haciendo en ese paso, elegidos con el índice
  semántico; sin índice, cae al orden por prioridad de antes.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import config
from rosa import certeza as CERTEZA
from rosa import indice_semantico, politicas


def es_heredado(h: dict[str, Any]) -> bool:
    """Un hecho copiado de otra investigación (al crear esta con
    `heredarModeloDe` o al bifurcar): su id lleva el sufijo `-<id de la
    investigación de destino>`, así que contiene "-inv-"."""
    return "-inv-" in str(h.get("id", ""))


def origen_de_heredado(h: dict[str, Any], hechos_por_id: dict[str, dict[str, Any]], investigaciones: list[dict[str, Any]]) -> str | None:
    """Título de la investigación de la que viene un hecho heredado, siguiendo
    la cadena de copias hasta la original. None si no se puede seguir."""
    titulos = {i["id"]: i.get("titulo") or i["id"] for i in investigaciones}
    actual = h
    titulo = None
    for _ in range(8):
        sufijo = f"-{actual.get('investigacionId', '')}"
        if not sufijo.strip("-") or not str(actual.get("id", "")).endswith(sufijo):
            break
        original = hechos_por_id.get(str(actual["id"])[: -len(sufijo)])
        if not original:
            break
        titulo = titulos.get(original.get("investigacionId"), titulo)
        actual = original
    return titulo


def _linea_hecho(h: dict[str, Any], origen: str | None = None) -> str:
    proc = "; ".join(f"{p['referencia']}{', pág. ' + str(p['pagina']) if p['pagina'] else ''}" for p in h["procedencia"][:3])
    extra = f" [descartado: {h['motivoDescarte']}]" if h["estado"] == "descartado" else ""
    heredado = f" [heredado de «{origen}»]" if origen else (" [heredado de otra investigación]" if es_heredado(h) else "")
    return f"- ({h['estado']}, prioridad {h['prioridad']}, {h['tipo']}, {h['tema']}) {h['enunciado']}{' <' + proc + '>' if proc else ''}{extra}{heredado}"


def _ordenados(propios: list[dict[str, Any]]) -> list[dict[str, Any]]:
    orden = {"abierto": 0, "sabido": 1, "descartado": 2}
    return sorted(propios, key=lambda h: (orden.get(h["estado"], 3), h["prioridad"]))


def mapa_del_modelo(propios: list[dict[str, Any]], hechos_por_id: dict[str, dict[str, Any]] | None = None, investigaciones: list[dict[str, Any]] | None = None) -> str:
    """Diez líneas que dicen qué hay en el árbol aunque no se enseñe entero:
    cuántos hechos por estado, los temas con más hechos y cuántos son
    heredados y de dónde."""
    if not propios:
        return "Modelo de mundo vacío."
    por_estado = {k: sum(1 for h in propios if h["estado"] == k) for k in ("sabido", "abierto", "descartado")}
    temas: dict[str, int] = {}
    for h in propios:
        temas[h.get("tema") or "sin tema"] = temas.get(h.get("tema") or "sin tema", 0) + 1
    lineas = [f"Mapa del modelo de mundo: {len(propios)} hechos ({por_estado['sabido']} sabidos, {por_estado['abierto']} preguntas abiertas, {por_estado['descartado']} descartados)."]
    lineas.append("Temas: " + "; ".join(f"{t} ({n})" for t, n in sorted(temas.items(), key=lambda x: -x[1])[:8]) + ".")
    heredados = [h for h in propios if es_heredado(h)]
    if heredados:
        origenes: dict[str, int] = {}
        for h in heredados:
            o = origen_de_heredado(h, hechos_por_id or {}, investigaciones or []) or "otra investigación"
            origenes[o] = origenes.get(o, 0) + 1
        lineas.append(f"Heredados: {len(heredados)} hechos vienen de " + "; ".join(f"«{o}» ({n})" for o, n in sorted(origenes.items(), key=lambda x: -x[1])) + ". Se midieron en la población de aquella investigación: valen como contexto, no como datos de esta.")
    return "\n".join(lineas)


def modelo_de_mundo(hechos: list[dict[str, Any]], investigacion_id: str, maximo: int = 60, investigaciones: list[dict[str, Any]] | None = None) -> str:
    """El modelo de mundo por prioridad (sin índice): mapa más las `máximo`
    primeras líneas por estado y prioridad. Los hechos heredados llevan su
    origen si se pasan las investigaciones."""
    propios = [h for h in hechos if h["investigacionId"] == investigacion_id]
    if not propios:
        return "Vacío: es la primera iteración. No hay hechos sabidos ni preguntas abiertas todavía."
    por_id = {h["id"]: h for h in hechos}
    elegidos = _ordenados(propios)[:maximo]
    cuerpo = "\n".join(_linea_hecho(h, origen_de_heredado(h, por_id, investigaciones) if investigaciones and es_heredado(h) else None) for h in elegidos)
    return mapa_del_modelo(propios, por_id, investigaciones) + f"\n\nHechos ({len(elegidos)} de {len(propios)}, por prioridad):\n" + cuerpo


NUCLEO_ABIERTAS = 10
NUCLEO_DESCARTADOS = 5


def nucleo_del_modelo(propios: list[dict[str, Any]], descartados: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Lo que entra siempre, sea cual sea el paso: las preguntas abiertas
    propias de mayor prioridad y los hechos descartados con su motivo (para
    no volver a caer en lo mismo). Los descartados llegan elegidos por
    parecido con el paso cuando hay índice; si no, los más recientes."""
    abiertas = sorted([h for h in propios if h["estado"] == "abierto" and not es_heredado(h)], key=lambda h: h["prioridad"])[:NUCLEO_ABIERTAS]
    if descartados is None:
        descartados = sorted([h for h in propios if h["estado"] == "descartado"], key=lambda h: -(h.get("actualizadoEn") or 0))[:NUCLEO_DESCARTADOS]
    return abiertas + list(descartados)[:NUCLEO_DESCARTADOS]


async def modelo_de_mundo_para(almacen: Any, investigacion_id: str, consulta: str, maximo: int = 60) -> str:
    """El modelo de mundo para un paso concreto: el mapa del árbol, el núcleo
    (preguntas abiertas propias y descartados) y, hasta `máximo`, los hechos
    más parecidos a `consulta` según el índice semántico. Si el índice no
    está o falla, se completa por prioridad, como antes. Cuesta un embedding."""
    e = almacen.estado
    hechos = e["hechos"]
    propios = [h for h in hechos if h["investigacionId"] == investigacion_id]
    if not propios:
        return "Vacío: es la primera iteración. No hay hechos sabidos ni preguntas abiertas todavía."
    por_id = {h["id"]: h for h in hechos}
    investigaciones = e.get("investigaciones", [])
    hits: list[dict[str, Any]] = []
    modo = "por prioridad"
    if indice_semantico.disponible() and (consulta or "").strip():
        try:
            hits = await indice_semantico.de_almacen(almacen).buscar(consulta[:2000], k=maximo * 2, investigacion_id=investigacion_id, tipos=("hecho",))
            modo = "por parecido con este paso"
        except Exception as ex:  # noqa: BLE001  el índice nunca tumba un paso
            hits = []
            modo = f"por prioridad; el índice semántico no respondió ({type(ex).__name__})"
    ids_hits = [str(h_["id"]).split(":", 1)[-1] for h_ in hits]
    # Los descartados del núcleo se eligen por parecido con el paso, no por antigüedad:
    # el descarte sobre GFAP aparece cuando el paso habla de GFAP.
    descartados_hits = [por_id[hid] for hid in ids_hits if hid in por_id and por_id[hid]["investigacionId"] == investigacion_id and por_id[hid]["estado"] == "descartado"]
    elegidos = nucleo_del_modelo(propios, descartados_hits if descartados_hits else None)
    ya = {h["id"] for h in elegidos}
    if hits:
        try:
            for hid in ids_hits:
                if hid in por_id and hid not in ya and por_id[hid]["investigacionId"] == investigacion_id:
                    elegidos.append(por_id[hid])
                    ya.add(hid)
                if len(elegidos) >= maximo:
                    break
        except Exception as ex:  # noqa: BLE001  el índice nunca tumba un paso
            modo = f"por prioridad; el índice semántico no respondió ({type(ex).__name__})"
    for h in _ordenados(propios):
        if len(elegidos) >= maximo:
            break
        if h["id"] not in ya:
            elegidos.append(h)
            ya.add(h["id"])
    # Vecinos del grafo (rosa/grafo.py): qué hipótesis respalda cada hecho elegido.
    vecinos = _hipotesis_por_hecho(e, investigacion_id, elegidos)
    cuerpo = "\n".join(_linea_hecho(h, origen_de_heredado(h, por_id, investigaciones) if es_heredado(h) else None) + _sufijo_vecinos(vecinos.get(h["id"])) for h in elegidos)
    texto = mapa_del_modelo(propios, por_id, investigaciones) + f"\n\nHechos pertinentes ({len(elegidos)} de {len(propios)}, {modo}):\n" + cuerpo
    from rosa import cuestiones as CU

    if CU.abiertas(e, investigacion_id, 1):
        texto += "\n\n" + CU.texto_abiertas(e, investigacion_id, maximo=8)
    # Mapa del estado de la enfermedad (rosa/mapa_enfermedad.py): dónde está la
    # evidencia por estadio, región, célula y nivel, y qué huecos nombra la misión.
    # Si el cierre de la iteración ya lo guardó en la investigación se reutiliza
    # (precalculado); si no, se calcula aquí. Un fallo no tumba el paso.
    try:
        from rosa import mapa_enfermedad as MAPA

        inv = next((i for i in investigaciones if i.get("id") == investigacion_id), None)
        texto += "\n\n" + MAPA.texto_mapa(e, investigacion_id, maximo=8, precalculado=(inv or {}).get("mapaEnfermedad"))
    except Exception as ex:  # noqa: BLE001  el mapa nunca tumba un paso
        texto += f"\n\nMapa del estado de la enfermedad: no pude construirlo ({type(ex).__name__})."
    return texto


def _hipotesis_por_hecho(e: dict[str, Any], investigacion_id: str, hechos: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Títulos de las hipótesis vecinas de cada hecho en el grafo de la
    investigación (arista 'respalda'). Si el grafo no se puede construir, vacío:
    el modelo de mundo nunca se cae por los vecinos."""
    if not hechos:
        return {}
    inv = next((i for i in e.get("investigaciones", []) if i["id"] == investigacion_id), None)
    if not inv:
        return {}
    try:
        from rosa import grafo as GR

        g = GR.construir_cacheado(e, inv)
        salida: dict[str, list[str]] = {}
        for h in hechos:
            vecinos = GR.vecinos_de(g, f"he-{h['id']}", tipos=("hipotesis",))
            if vecinos:
                salida[h["id"]] = [v["etiqueta"] for v in vecinos[:3]]
        return salida
    except Exception:  # noqa: BLE001
        return {}


def _sufijo_vecinos(titulos: list[str] | None) -> str:
    if not titulos:
        return ""
    return " → respalda: " + "; ".join(f"«{t[:60]}»" for t in titulos)


def preguntas_abiertas(hechos: list[dict[str, Any]], investigacion_id: str, objetivo: str, maximo: int = 8, pregunta: str | None = None, cuestiones: list[dict[str, Any]] | None = None) -> str:
    """El criterio de relevancia: primero el objetivo y la pregunta de la
    corrida, después las preguntas abiertas propias por prioridad. Una
    pregunta heredada de otra investigación solo entra si nombra algo del
    objetivo (un nombre propio, o dos términos clave): el conocimiento
    heredado sirve para razonar, no para decidir qué se lee."""
    cabecera = f"Objetivo: {objetivo.strip()}" + (f"\nPregunta de esta corrida: {pregunta.strip()}" if pregunta and pregunta.strip() else "")
    abiertas = sorted([h for h in hechos if h["investigacionId"] == investigacion_id and h["estado"] == "abierto"], key=lambda h: h["prioridad"])
    propias = [h for h in abiertas if not es_heredado(h)]
    base = f"{objetivo} {pregunta or ''}"
    nombres = {n.lower() for n in nombres_propios(base)}
    terminos = {t.lower() for t in terminos_clave(base, maximo=30) if len(t) >= 5 and t.lower() not in nombres}

    def pertinente(h: dict[str, Any]) -> bool:
        t = h["enunciado"].lower()
        return any(n in t for n in nombres) or sum(x in t for x in terminos) >= 2

    heredadas = [h for h in abiertas if es_heredado(h) and pertinente(h)]
    elegidas = (propias + heredadas)[:maximo]
    # Cuestiones persistentes (rosa/cuestiones.py) que no son preguntas del modelo de
    # mundo (esas ya están arriba): lo que el Killer o la escalera piden, con lo que
    # las resolvería, para que el cribado sepa qué artículo las cierra.
    otras = [c for c in (cuestiones or []) if c.get("investigacionId") == investigacion_id and c.get("estado") == "abierta" and (c.get("origen") or {}).get("tipo") != "pregunta_modelo"]
    otras.sort(key=lambda c: (c.get("prioridad", 5), c.get("creadaEn", 0)))
    otras = otras[: max(0, maximo - len(elegidas))]
    if not elegidas and not otras:
        return cabecera + "\nSin preguntas abiertas propias todavía."
    lineas = [f"{i + 1}. {h['enunciado']}" + (" (heredada)" if es_heredado(h) else "") for i, h in enumerate(elegidas)]
    lineas += [f"{len(elegidas) + i + 1}. {c['texto']}" + (f" (la resolvería: {c['queLaResolveria']})" if c.get("queLaResolveria") else "") for i, c in enumerate(otras)]
    return cabecera + "\nPreguntas abiertas:\n" + "\n".join(lineas)


def terminos_registro(objetivo: str, pregunta: str | None = None, detalle: str = "", maximo: int = 3) -> list[str]:
    """Términos para ClinicalTrials.gov, que está en inglés: primero los
    nombres propios (fármacos, ensayos), después siglas y genes. Nunca
    palabras sueltas en castellano ("mantiene precedencia" dio 0 estudios)."""
    texto = " ".join(x for x in (objetivo, pregunta or "", detalle or "") if x)
    salida: list[str] = []

    def anadir(x: str) -> None:
        if x.lower() not in {v.lower() for v in salida} and not any(x.lower() in v.lower() for v in salida):
            salida.append(x)

    for n in nombres_propios(texto):
        anadir(n)
    for tok in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", texto):
        if (tok.isupper() and len(tok) >= 3 and tok.lower() not in _GENERICAS) or (re.search(r"\d", tok) and re.search(r"[A-Za-z]", tok)):
            anadir(tok)
    return salida[:maximo]


def hechos_numerados(hechos: list[dict[str, Any]], investigacion_id: str, maximo: int = 40) -> tuple[str, list[dict[str, Any]]]:
    """Los hechos sabidos de la investigación, numerados, para que el paso de
    modelo de mundo pueda decir cuál sustituye o contradice un hecho nuevo (el
    mismo patrón que `afirmaciones_sostenidas`: el índice 1-based del modelo se
    resuelve contra la lista devuelta). Primero los propios por prioridad y
    fecha; los heredados se marcan."""
    propios = [h for h in hechos if h.get("investigacionId") == investigacion_id and h.get("estado") == "sabido" and h.get("tipo") != "hipotesis"]
    propios.sort(key=lambda h: (es_heredado(h), h.get("prioridad", 5), -(h.get("actualizadoEn") or 0)))
    lista = propios[:maximo]
    lineas = [f"{i + 1}. [{h.get('tema', '')}] {h.get('enunciado', '')}" + (" (heredado)" if es_heredado(h) else "") for i, h in enumerate(lista)]
    return ("\n".join(lineas) if lineas else "Ninguno todavía."), lista


def afirmaciones_sostenidas(afirmaciones: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """Texto numerado de las afirmaciones sostenidas o parciales, y la lista
    en ese mismo orden para resolver índices."""
    validas = [a for a in afirmaciones if a["veredicto"] in ("sostenida", "parcial")]
    lineas = [f"{i + 1}. ({a['tipo']}{', parcial' if a['veredicto'] == 'parcial' else ''}) {a['texto']} {a['cita']}" for i, a in enumerate(validas)]
    return ("\n".join(lineas) if lineas else "Ninguna afirmación sostenida todavía."), validas


def hipotesis_existentes(hipotesis: list[dict[str, Any]], investigacion_id: str, maximo: int | None = None, con_descartadas: int | None = None) -> str:
    """Las hipótesis vivas de la investigación, por Elo, con tope; de las
    descartadas solo las últimas (su motivo evita repetirlas). Sin tope, el
    prompt del Killer crecia con cada iteración."""
    maximo = politicas.MAX_HIPOTESIS_EN_CONTEXTO if maximo is None else maximo
    con_descartadas = politicas.MAX_DESCARTADAS_EN_CONTEXTO if con_descartadas is None else con_descartadas
    propias = [h for h in hipotesis if h["investigacionId"] == investigacion_id]
    if not propias:
        return "Ninguna."
    vivas = sorted([h for h in propias if h["estado"] != "descartada"], key=lambda h: -h.get("elo", 0))[:maximo]
    descartadas = sorted([h for h in propias if h["estado"] == "descartada"], key=lambda h: -((h.get("revisiones") or [{}])[-1].get("fecha") or 0))[:con_descartadas]
    omitidas = len(propias) - len(vivas) - len(descartadas)
    lineas = []
    for h in vivas + descartadas:
        nota = ""
        if h["estado"] == "descartada":
            ult = next((r for r in reversed(h["revisiones"]) if r["accion"] == "descartada"), None)
            nota = f" motivo: {ult['nota']}" if ult else ""
        elif h["estado"] == "refinar":
            ult = next((r for r in reversed(h["revisiones"]) if r["accion"] == "refinar"), None)
            nota = f" pide refinar: {ult['nota']}" if ult else ""
        elif h["estado"] == "en_revision" and h.get("decisionKiller") == "descartar_en_contexto":
            # Con autonomía "preguntar" el descarte espera a la persona: aun así, no proponer variantes.
            ult = next((r for r in reversed(h["revisiones"]) if r["accion"] == "killer"), None)
            nota = f" Killer propone descartar (pendiente de persona): {ult['nota'][:200]}" if ult else " Killer propone descartar (pendiente de persona)"
        lineas.append(f"- {h['id']} [{h['estado']}, elo {h['elo']}] {h['titulo']}{nota}")
    if omitidas > 0:
        lineas.append(f"- ({omitidas} hipótesis más no se listan por tope de contexto)")
    return "\n".join(lineas)


def hipotesis_texto(h: dict[str, Any]) -> str:
    c = h["comprobacion"]
    return f"Título: {h['titulo']}\nEnunciado: {h['enunciado']}\nMecanismo: {h['mecanismo']}\nComprobación: biomarcador {c['biomarcador']}; cohorte {c['cohorte']}; diseño {c['diseno']}\nCluster: {h['cluster']}"


def hipotesis_con_revisiones(h: dict[str, Any]) -> str:
    """La ficha COMPLETA de una hipótesis, con su título, su cluster y sus
    revisiones automáticas. NO es la tarjeta del torneo (esa es
    `pasos.hipotesis_para_torneo`, que va a ciegas desde el 25 de septiembre de
    2026): alimenta a `todas_las_hipotesis`, que es el panorama que ve
    MetaRevisar, y ahí el veredicto del Killer y el linaje SÍ hacen falta, porque
    el meta-revisor razona sobre la cartera entera. Se renombró para que nadie
    ciegue el meta-revisor por error ni desciegue el torneo."""
    afs = "\n".join(f"  - [{a['veredicto']}{', EN CONTRA' if a.get('relacion') == 'contradice' else (', indirecta' if a.get('relacion') == 'apoya_indirecta' else '')}] {a['texto']} {a['cita']}" for a in h["afirmaciones"][:8])
    sup = "\n".join(f"  - [{s['estado']}] {s['texto']}" for s in h["supuestos"][:6])
    return f"{hipotesis_texto(h)}\nAfirmaciones:\n{afs or '  (ninguna)'}\nSupuestos:\n{sup or '  (ninguno)'}\nRevisiones automáticas: " + "; ".join(f"{r['tipo']}: {r['resumen']}" for r in h["revisionesAutomaticas"] if r["estado"] != "pendiente")


_NOMBRES_DE_MODELO = {n.split("/")[-1].lower() for n in ("openai/gpt-6-astra", "anthropic/claude-opus-5", "anthropic/claude-sonnet-5")} | {"rosa2018"}


def es_persona(quien: Any) -> bool:
    """Si esa firma es de una persona. ROSA2018 firma con `config.QUIEN_ROSA` y
    sus modelos con el id del gateway, que siempre lleva barras
    ("openai/anthropic/claude-opus-5", "openai/openai/gpt-6-astra"); los nombres
    de persona no las llevan.

    La caza de fallos del 23 de septiembre encontró el fallo que esto arregla: el
    Killer firma sus revisiones con el id del modelo juez, y sus 131 revisiones
    (127 de Opus, 4 de Astra) llegaban al torneo y a la conclusión GRADE por el
    campo `revisiones_humanas`, cuya descripción decía "Lo que dijeron las
    personas" y cuyo docstring añadía que pesan más que las automáticas. En las
    28 hipótesis del estado hay CERO revisiones humanas de verdad: el 100 % de
    ese campo era salida de modelo presentada como opinión de persona.

    Límite conocido: una firma de persona que llevara una barra ("Ana/Luis") se
    leería como modelo. Se acepta porque la interfaz firma con el nombre de quien
    entró, no con texto libre, y porque el error cae del lado prudente: de más
    dejaría pasar a un modelo como persona, de menos deja fuera una nota humana
    que el juez habría visto."""
    q = str(quien or "").strip()
    if not q or q == config.QUIEN_ROSA:
        return False
    if "/" in q:
        return False
    # Los tres modelos de ROSA2018 por su nombre pelado, por si alguna firma llegó
    # sin el prefijo del gateway: son los de `rosa/gateway.py` y ninguno es persona.
    return q.lower() not in _NOMBRES_DE_MODELO


def revisiones_humanas(h: dict[str, Any]) -> str:
    """Lo que escribió una PERSONA sobre la hipótesis: el formulario estructurado
    (`revisionesHumanas`), las revisiones firmadas por alguien que no es ROSA2018
    ni un modelo, y el voto de relevancia humano. Casi siempre "Ninguna."."""
    partes = []
    for r in h["revisionesHumanas"]:
        partes.append(f"{r['quien']}: supuestos cuestionados: {r['supuestosCuestionados']}; literatura que falta: {r['literaturaQueFalta']}; problema experimental: {r['problemaExperimental']}")
    for r in h["revisiones"]:
        if es_persona(r.get("quien")) and r["nota"]:
            partes.append(f"{r['quien']} ({r['accion']}): {r['nota']}")
    if h["relevancia"].get("votoHumano"):
        partes.append(f"Voto de relevancia humano: {h['relevancia']['votoHumano']}")
    return "\n".join(partes) if partes else "Ninguna."


def todas_las_hipotesis(hipotesis: list[dict[str, Any]], investigacion_id: str) -> str:
    propias = [h for h in hipotesis if h["investigacionId"] == investigacion_id]
    bloques = []
    for h in propias:
        revs = "; ".join(f"{r['quien']} {r['accion']}: {r['nota']}" for r in h["revisiones"][-4:])
        bloques.append(f"## {h['id']} [{h['estado']}, elo {h['elo']}, origen {h['origen']}]\n{hipotesis_con_revisiones(h)}\nRevisiones: {revs}")
    return "\n\n".join(bloques) if bloques else "Ninguna."


def configuracion(inv: dict[str, Any]) -> str:
    c = inv["configuracion"]
    amplitud = c.get("amplitud") or politicas.AMPLITUD_POR_DEFECTO
    return f"Preferencias: {c['preferencias'] or 'ninguna'}\nAtributos deseados: {', '.join(c['atributos']) or 'ninguno'}\nRestricciones: {', '.join(c['restricciones']) or 'ninguna'}\nLímites de la investigación: {'; '.join(inv['limites']) or 'ninguno'}\nAmplitud de búsqueda: {amplitud} (parte de las consultas que exploran fuera de la pregunta: {int(politicas.AMPLITUD.get(amplitud, 0) * 100)} %)"


def indicaciones_humanas(iteracion: dict[str, Any] | None, pendientes_solo: bool = False) -> str:
    if not iteracion:
        return "Ninguna."
    pasos = [p for p in iteracion["plan"] if p["indicacionHumana"] and (not pendientes_solo or p["estado"] in ("pendiente", "en_curso"))]
    return "\n".join(f"- {p['detalle']}" for p in pasos) if pasos else "Ninguna."


def plan_ejecutado(iteracion: dict[str, Any]) -> str:
    lineas = []
    for p in iteracion["plan"]:
        pistas = [x for x in iteracion["pistas"] if x["pasoId"] == p["id"]]
        res = "; ".join(f"{x['titulo']}: {x['resumen']}" for x in pistas)
        lineas.append(f"- [{p['estado']}] {p['titulo']}{' (fallo: ' + p['motivoFallo'] + ')' if p['motivoFallo'] else ''}{' | ' + res if res else ''}")
    return "\n".join(lineas)


def inferir_tipo_paso(paso: dict[str, Any]) -> str:
    """Un paso editado o añadido por la investigadora no trae `tipo`; se
    infiere del título. Si no se reconoce, se trata como indicación."""
    if paso.get("tipo"):
        return paso["tipo"]
    if paso.get("indicacionHumana"):
        return "indicacion"
    t = (paso.get("titulo", "") + " " + paso.get("detalle", "")).lower()
    for clave, tipo in [
        ("ensayo", "ensayos"),
        ("clinicaltrials", "ensayos"),
        ("literatura", "literatura"),
        ("buscar", "literatura"),
        ("pubmed", "literatura"),
        ("extra", "extraccion"),
        ("afirmaci", "extraccion"),
        ("verific", "verificacion"),
        ("noved", "novedad"),
        ("modelo de mundo", "modelo"),
        ("hechos", "modelo"),
        ("hipotesis", "hipotesis"),
        ("torneo", "hipotesis"),
        ("analisis", "analisis"),
        ("in silico", "analisis"),
        ("reproduc", "analisis"),
        ("meta", "meta"),
        ("panorama", "meta"),
    ]:
        if clave in t:
            return tipo
    return "indicacion"


_LETRA = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ"
_PATRON_TOKEN = re.compile(rf"[{_LETRA}][{_LETRA}0-9\-]{{2,}}")
# Un término que un índice en inglés entiende: una sigla o gen (dos mayúsculas o
# más: GFAP, NfL, APOE, MCI), o un token con letra y cifra (p-tau181, BACE1, Aβ42
# no, porque la β no es ASCII y OpenAlex no lo casa). Nunca una palabra en
# minúscula en castellano.
_PATRON_INGLES = re.compile(r"^(?=.*[A-Z].*[A-Z]|.*\d)[A-Za-z][A-Za-z0-9\-]{1,}$")


def terminos_clave(texto: str, maximo: int = 6) -> list[str]:
    """Palabras del dominio para consultas rápidas: siglas, genes, y palabras
    largas que no sean conectores. Acepta tildes y ñ: antes la expresión
    cortaba en la tilde y "información" salía como "informaci" (revisión del
    17 de septiembre de 2026, S-02)."""
    parar = {"sobre", "entre", "hasta", "desde", "para", "como", "cuando", "donde", "porque", "aunque", "mientras", "antes", "despues", "después", "portadores", "pacientes", "personas", "estudio", "nivel", "niveles", "plasma", "cambio", "cambios"}
    vistos: list[str] = []
    for tok in _PATRON_TOKEN.findall(texto or ""):
        if tok.lower() in parar or tok.lower() in {v.lower() for v in vistos}:
            continue
        if tok.isupper() or re.search(r"\d", tok) or len(tok) >= 7:
            vistos.append(tok)
        if len(vistos) >= maximo:
            break
    return vistos


# Siglas que en castellano se escriben distinto que en inglés y un índice en inglés
# no reconoce: se traducen antes de consultar.
_SIGLAS_ES_EN = {"LCR": "CSF", "DCL": "MCI", "RM": "MRI", "TEP": "PET", "ARN": "RNA", "ADN": "DNA"}

# Tokens que cumplen la forma de una sigla pero no nombran nada del dominio: la
# estadística de un enunciado ("HR 1,8; IC 95 %; OR 2,1"), los metadatos de una
# cita (DOI, PMID), las siglas de la propia ROSA2018 y sus marcos (GRADE, PRISMA) y las
# preposiciones y artículos de un título escrito en mayúsculas. Mandarlos a OpenAlex
# da obras que no tienen nada que ver y, con ellas evaluadas, un "sin precedente"
# falso (adversario del 17 de septiembre de 2026: "HR IC OR" y "TULO EN MAY").
_NO_BUSCABLES = {
    "IC", "HR", "OR", "RR", "SD", "SE", "CI", "IQR", "AUC", "USD", "DOI", "PMID", "ROSA", "GRADE", "PRISMA", "PUBMED", "FDA", "EMA", "OMS", "WHO", "NIH", "NIA", "VS", "ET", "AL",
    "EN", "DE", "LA", "EL", "LOS", "LAS", "CON", "SIN", "POR", "UN", "UNA", "DEL", "SU", "SUS", "ES", "NO", "QUE", "LO", "LE", "MAS", "SOBRE", "ENTRE", "PARA", "COMO", "ANTE", "HACIA", "HASTA", "DESDE", "SEGUN", "TRAS", "THE", "AND", "OF", "IN", "FOR", "WITH", "TO",
}
# Un token de letras y cifras que puede llevar tilde o ñ dentro: se recoge entero
# para que "TÍTULO" no salga como "TULO" (después `_token_en_ingles` lo descarta por
# no ser ASCII, que es lo correcto: no es una sigla en inglés).
_PATRON_TOKEN_BRUTO = re.compile(rf"[{_LETRA}][{_LETRA}0-9\-]*")
# Una letra y una cifra ("e4" de "APOE e4", "E4") es el resto de un alelo, no un término.
_LETRA_Y_CIFRA = re.compile(r"^[A-Za-z]\d$")


def _parte_en_castellano(parte: str) -> bool:
    """Un trozo de token que es una palabra en minúscula de cuatro letras o más
    sin cifra ("amiloide" en "amiloide-PET"): no lo entiende un índice en inglés."""
    return len(parte) >= 4 and parte.isalpha() and parte.islower()


def _token_en_ingles(tok: str, solo_con_cifra: bool = False) -> str | None:
    """El token tal como se manda, o None si no sirve: se admite si cumple
    `_PATRON_INGLES`; en los compuestos con guion se quitan las partes en
    castellano ("amiloide-PET" queda en "PET"; "p-tau181" y "Tau-PET" se
    mantienen enteros); las siglas castellanas se traducen. Con
    `solo_con_cifra` (el texto de origen está escrito en mayúsculas, así que
    "MEMORIA" parece una sigla y no lo es) solo pasan los tokens con cifra."""
    tok = tok.strip(" ,.;:()[]\u00ab\u00bb\"'").strip("-")
    if not tok:
        return None
    partes = [x for x in tok.split("-") if x]
    if any(_parte_en_castellano(x) for x in partes):
        partes = [x for x in partes if not _parte_en_castellano(x)]
        tok = "-".join(partes)
    if not tok or not _PATRON_INGLES.match(tok):
        return None
    if tok.upper() in _NO_BUSCABLES or _LETRA_Y_CIFRA.match(tok):
        return None
    if solo_con_cifra and not re.search(r"\d", tok):
        return None
    return _SIGLAS_ES_EN.get(tok.upper(), tok) if tok.isupper() else tok


def _escrito_en_mayusculas(texto: str) -> bool:
    """Un texto con doce letras o más y cuatro de cada cinco en mayúscula está
    escrito en mayúsculas: sus palabras no son siglas."""
    letras = [c for c in texto if c.isalpha()]
    return len(letras) >= 12 and sum(1 for c in letras if c.isupper()) / len(letras) >= 0.8


def terminos_para_ingles(h: dict[str, Any], maximo: int = 3) -> list[str]:
    """Los términos con los que se busca el precedente de una hipótesis en un
    índice en inglés (OpenAlex, ClinicalTrials.gov): siglas, genes y tokens con
    cifra, tomados por este orden de las entidades que anotó el generador
    (`_entidades`), de la diana de la tarjeta, del biomarcador de la
    comprobación, del título, del enunciado y, por último, de la etiqueta
    canónica de las entidades (`entidades`; nunca sus alias, porque los alias
    de HGNC como FLJ45472 o DDPAC vuelven a dar 0 obras). Las palabras en
    castellano se descartan: "Precedencia anormalidad GFAP APOE" daba 0 obras
    y "GFAP NfL APOE" da cientos. Pocos términos (tres) porque el índice los
    exige todos y la novedad prefiere encontrar de más que de menos. Si
    devuelve menos de dos, no hay con qué consultar y la novedad queda "no
    comprobado", nunca "sin precedente"."""
    if not isinstance(h, dict):
        return []
    tarjeta = h.get("tarjeta") if isinstance(h.get("tarjeta"), dict) else {}
    comprobacion = h.get("comprobacion") if isinstance(h.get("comprobacion"), dict) else {}
    candidatos: list[tuple[str, bool]] = [(x, False) for x in (h.get("_entidades") or []) if isinstance(x, str)]
    for texto in (tarjeta.get("diana"), comprobacion.get("biomarcador"), h.get("titulo"), h.get("enunciado")):
        if isinstance(texto, str) and texto:
            en_mayusculas = _escrito_en_mayusculas(texto)
            candidatos.extend((tok, en_mayusculas) for tok in _PATRON_TOKEN_BRUTO.findall(texto))
    for x in h.get("entidades") or []:
        if isinstance(x, dict) and isinstance(x.get("etiqueta"), str):
            candidatos.append((x["etiqueta"], False))
    vistos: list[str] = []
    for bruto, solo_con_cifra in candidatos:
        tok = _token_en_ingles(bruto, solo_con_cifra=solo_con_cifra)
        if not tok or tok.lower() in {v.lower() for v in vistos}:
            continue
        # Un trozo de un término ya recogido (APOE dentro de APOE4) no aporta nada, y
        # un compuesto de uno ya recogido (TSPO-PET tras TSPO) tampoco: gasta el sitio
        # de otro término.
        if any(tok.lower() != v.lower() and (tok.lower() in v.lower() or v.lower() in tok.lower()) for v in vistos):
            continue
        vistos.append(tok)
        if len(vistos) >= maximo:
            break
    return vistos


_SUFIJOS_FARMACO = ("mab", "tide", "nib", "stat", "ast", "vir", "pril", "sartan", "gliptin", "mide")
_GENERICAS = {"alzheimer", "covid", "gwas", "pet", "mri", "csf", "adni", "apoe", "gfap", "nfl", "mci", "dcl", "cdr", "cdr-sb", "mmse", "sd", "ic", "hr", "or", "rr", "iqr", "usd", "fda", "ema", "oms", "who", "nia", "nih", "doi", "pmid", "rosa", "grade", "prisma", "pubmed"}


def nombres_propios(texto: str) -> list[str]:
    """Fármacos, ensayos y cohortes nombrados en un texto: lo que hay que
    buscar por nombre exacto porque la búsqueda por significado lo pierde.
    Reglas sin modelo: siglas con cifra o guion (INVOKE-2, AL002,
    TRAILBLAZER-ALZ 2), palabras en mayúsculas de cuatro letras o más que no
    son términos generales, fármacos por sufijo (-mab, -tide, -nib) y nombres
    de ensayo en minúscula pegados a "+" o "/" (evoke/evoke+)."""
    vistos: list[str] = []

    def anadir(x: str) -> None:
        x = x.strip(" ,.;:()")
        # Ni genéricas, ni repetidas, ni una sigla que es trozo de un nombre ya
        # recogido (INVOKE dentro de INVOKE-2); "evoke" y "evoke+" son dos ensayos.
        if len(x) < 3 or x.lower() in _GENERICAS or x.lower() in {v.lower() for v in vistos}:
            return
        if x.isupper() and any(x.lower() in v.lower() for v in vistos):
            return
        vistos.append(x)

    for m in re.finditer(r"[A-Z]{2,}[A-Z0-9\-]*\d[A-Z0-9\-]*(?:\s\d)?|[A-Z]{2,}-[A-Z]+(?:\s\d)?", texto or ""):
        anadir(m.group(0))
    for m in re.finditer(r"\b[A-Z]{4,}\b", texto or ""):
        anadir(m.group(0))
    for m in re.finditer(r"\b([a-z]{4,}\+)", texto or ""):
        anadir(m.group(1))
    for m in re.finditer(r"\b([a-z]{8,})\b", texto or ""):
        if any(m.group(1).endswith(s) for s in _SUFIJOS_FARMACO):
            anadir(m.group(1))
    for m in re.finditer(r"\b([a-z]{4,})/([a-z]{4,}\+?)", texto or ""):
        anadir(m.group(1))
        anadir(m.group(2))
    return vistos[:12]


def hipotesis_vivas(hipotesis: list[dict[str, Any]], investigacion_id: str, maximo: int = 8) -> str:
    """Las hipótesis en competencia con su estado de creencia, para que el
    plan y las consultas elijan lo que las discrimina: que evidencia subiría
    o bajaría su certeza, y de que dependen más."""
    vivas = [h for h in hipotesis if h["investigacionId"] == investigacion_id and h["estado"] not in ("descartada",)]
    if not vivas:
        return "Ninguna todavía."
    vivas.sort(key=lambda h: -h["elo"])
    lineas = []
    for h in vivas[:maximo]:
        k = h.get("conclusion") or {}
        lineas.append(f"- {h['id']} [{h['estado']}, elo {h['elo']}, certeza {k.get('certeza', 'sin conclusión')}, dirección {k.get('direccion', '?')}] {h['titulo']}")
        if k:
            lineas.append(f"    depende más de: {k.get('loMasFragil', '')}")
            lineas.append(f"    subiría si: {k.get('subiria', '')}")
            lineas.append(f"    bajaría si: {k.get('bajaria', '')}")
            escalera = k.get("escalera") or []
            cohortes = CERTEZA.cohortes_distintas(h)
            if escalera:
                lineas.append(f"    peldaño siguiente (por regla): para subir a {escalera[0]['a'].replace('_', ' ')} le falta {escalera[0]['falta']}. Cohortes distintas hoy: {len(cohortes)}" + (f" ({', '.join(cohortes)})" if cohortes else ""))
    return "\n".join(lineas)


def vivero_texto(inv: dict[str, Any], maximo: int = 8) -> str:
    """Las ideas del vivero para el plan, las consultas y el generador: no son
    hipótesis todavía; cada una dice qué le falta para nacer. Buscar esa
    evidencia es un paso tan válido como subir una hipótesis viva."""
    semillas = list(inv.get("vivero") or [])
    if not semillas:
        retiradas = sorted(inv.get("viveroRetiradas") or [], key=lambda s: -(s.get("retiradaEn") or 0))[:4]
        if retiradas:
            return "Vivero de ideas: vacío. Ideas retiradas (no reproponerlas sin evidencia nueva): " + "; ".join(f"«{s['titulo'][:60]}» ({(s.get('motivo') or '')[:80]})" for s in retiradas)
        return "Vivero de ideas: vacío."
    semillas.sort(key=lambda s: -(s.get("actualizadaEn") or 0))
    lineas = [f"Vivero de ideas ({len(semillas)}; no son hipótesis todavía: nacen cuando su evidencia dé para certeza baja):"]
    for s in semillas[:maximo]:
        cohortes = CERTEZA.cohortes_distintas({"procedencia": {"fuentes": s.get("fuentes", [])}})
        lineas.append(f"- {s['id']} (desde la iteración {s.get('iteracion')}, {len(s.get('afirmaciones', []))} afirmaciones, cohortes: {', '.join(cohortes) or 'ninguna identificada'}) {s['titulo']}")
        lineas.append(f"    le falta: {s.get('falta', '')}")
    retiradas = sorted(inv.get("viveroRetiradas") or [], key=lambda s: -(s.get("retiradaEn") or 0))[:4]
    if retiradas:
        lineas.append("Ideas retiradas del vivero (no reproponerlas sin evidencia nueva): " + "; ".join(f"«{s['titulo'][:60]}» ({(s.get('motivo') or '')[:80]})" for s in retiradas))
    return "\n".join(lineas)


def resultado_experimental(h: dict[str, Any]) -> str:
    x = h.get("experimento") or {}
    r = x.get("resultado") if isinstance(x, dict) else None
    if not r:
        return "Ninguno"
    if not isinstance(r, dict):
        return "Hay un resultado registrado con forma que no pude leer (no es un registro con veredicto); tratarlo como no comprobado."
    cifras = "; ".join(f"{c.get('nombre')}: {c.get('valor')}" for c in (r.get("cifras") or []) if isinstance(c, dict))
    texto = f"Veredicto contra el prerregistro: {r.get('veredicto')}. {r.get('resultado') or ''} Motivo: {r.get('motivo') or ''} Limitaciones: {r.get('limitaciones') or ''} Cifras: {cifras or 'ninguna'}. Exploratorio (no prerregistrado): {r.get('exploratorio') or 'nada'}"
    if r.get("veredicto") in ("refuta", "inconcluso"):
        # Un negativo se lee por lecturas separadas (rosa/experimento.py): si la
        # diana quedó comprometida y el efecto no apareció, cuestiona el mecanismo;
        # si la diana no se comprometió, habla del ensayo. El cerebro de la
        # siguiente iteración tiene que saber cuál de las dos es.
        try:
            from rosa import experimento as XP

            texto += " Lectura del negativo: " + XP.texto_lectura_del_negativo(r.get("veredictosPorLectura") or [])
        except Exception as ex:  # noqa: BLE001
            texto += f" Lectura del negativo: no pude leerla por lecturas ({type(ex).__name__})."
    return texto


def consultas_de_la_investigacion(e: dict[str, Any], investigacion_id: str) -> list[dict[str, Any]]:
    """Todas las consultas hechas en todas las corridas de la investigación,
    con el número de corrida, en orden temporal."""
    salida: list[dict[str, Any]] = []
    for c in sorted([x for x in e.get("corridas", []) if x["investigacionId"] == investigacion_id], key=lambda x: x["numero"]):
        for q in (c.get("busqueda") or {}).get("consultas", []):
            salida.append(dict(q, corrida=c["numero"]))
    return salida


def consultas_hechas(e: dict[str, Any], investigacion_id: str) -> list[str]:
    """Las cadenas ya enviadas en cualquier corrida de la investigación, para
    no repetirlas (antes solo se miraba la corrida en curso)."""
    vistas: list[str] = []
    for q in consultas_de_la_investigacion(e, investigacion_id):
        if q.get("consulta") and q["consulta"] not in vistas:
            vistas.append(q["consulta"])
    return vistas


def consultas_previas_texto(e: dict[str, Any], investigacion_id: str, maximo: int = 40) -> str:
    """Las consultas previas con su rendimiento, para que el generador no
    repita lo que no rindió: «consulta» (base, corrida M, it N): R resultados,
    C relevantes."""
    todas = consultas_de_la_investigacion(e, investigacion_id)
    if not todas:
        return "Ninguna"
    lineas = []
    for q in todas[-maximo:]:
        rel = q.get("relevantes")
        lineas.append(f"«{q['consulta'][:160]}» ({q['base']}, corrida {q['corrida']}, iteración {q.get('iteracion')}): {q.get('resultados')} resultados" + (f", {rel} relevantes" if rel is not None else "") + (" [amplitud]" if q.get("modo") == "amplitud" else ""))
    return "\n".join(lineas)


def traspaso_iteracion(e: dict[str, Any], it: dict[str, Any], c: dict[str, Any]) -> str:
    """Lo que la iteración anterior deja, del registro y no del modelo: pasos y
    pistas fallidos con su motivo, consultas vacías, bases caídas, afirmaciones
    sin verificar, incidencias pendientes, cambios de creencia y hallazgos del
    revisor abiertos. Es el traspaso "ejecutable, no solo legible"."""
    lineas: list[str] = []
    fallidos = [p for p in it.get("plan", []) if p.get("estado") in ("fallido", "omitido")]
    if fallidos:
        lineas.append("Pasos que no terminaron: " + "; ".join(f"«{p['titulo'][:60]}» ({p['estado']}: {(p.get('motivoFallo') or 'sin motivo')[:100]})" for p in fallidos))
    pistas = [p for p in it.get("pistas", []) if p.get("estado") == "fallida"]
    if pistas:
        lineas.append("Pistas fallidas: " + "; ".join(f"«{p['titulo'][:60]}»: {(p.get('resumen') or '')[:100]}" for p in pistas[:6]))
    vacias = [q for q in (c.get("busqueda") or {}).get("consultas", []) if q.get("iteracion") == it.get("numero") and (int(q.get("resultados") or 0) == 0 or q.get("relevantes") == 0)]
    if vacias:
        lineas.append("Consultas que no rindieron (no repetir igual): " + "; ".join(f"«{q['consulta'][:80]}» en {q['base']} ({q.get('resultados')} resultados, {q.get('relevantes', '?')} relevantes)" for q in vacias[:8]))
    caidas = {b: n for b, n in (c.get("_fallosFuente") or {}).items() if int(n or 0) >= 3}
    if caidas:
        lineas.append("Bases que no respondieron (es «no pude comprobar», no «no hay»): " + ", ".join(f"{b} ({n} fallos)" for b, n in caidas.items()))
    sin_verificar = sum(1 for a in c.get("_afirmaciones", []) if a.get("iteracion") == it.get("numero") and a.get("veredicto") == "sin_verificar")
    if sin_verificar:
        lineas.append(f"{sin_verificar} afirmaciones quedaron sin verificar (no cuentan como evidencia hasta que se verifiquen)")
    pendientes = [i for i in e.get("incidencias", []) if i.get("corridaId") == c["id"] and i.get("estado") == "pendiente"]
    if pendientes:
        lineas.append("Incidencias pendientes: " + "; ".join(f"{i.get('tipo')} con {i.get('recurso')}: {i.get('titulo', '')[:80]}" for i in pendientes[:5]))
    desde = int(it.get("empezadaEn") or 0)
    creencias = [a for a in e.get("aprendizaje", []) if a.get("investigacionId") == c["investigacionId"] and a.get("tipo") == "creencia" and int(a.get("fecha") or a.get("creadoEn") or 0) >= desde]
    if creencias:
        lineas.append("Cambios de creencia en la iteración: " + "; ".join((a.get("descripcion") or "")[:120] for a in creencias[:6]))
    abiertos = [hz for hz in ((it.get("revisionRegistro") or {}).get("hallazgos") or []) if hz.get("estado") == "abierto"]
    if abiertos:
        lineas.append("Hallazgos del revisor de registro abiertos: " + "; ".join(f"{str(hz.get('clase', '')).replace('_', ' ')}: {(hz.get('detalle') or '')[:100]}" for hz in abiertos[:5]))
    # Cuestiones persistentes y pendientes de revisar (grafo de evidencia).
    desde = it.get("empezadaEn") or 0
    cuestiones = [x for x in e.get("cuestiones", []) if x.get("investigacionId") == c.get("investigacionId")]
    nuevas_c = [x for x in cuestiones if (x.get("creadaEn") or 0) >= desde and x.get("estado") == "abierta"]
    resueltas_c = [x for x in cuestiones if (x.get("resueltaEn") or 0) >= desde and x.get("estado") == "resuelta"]
    if nuevas_c:
        lineas.append("Cuestiones abiertas en la iteración: " + "; ".join(f"«{x['texto'][:80]}»" + (f" (la resolvería: {x['queLaResolveria'][:60]})" if x.get("queLaResolveria") else "") for x in nuevas_c[:5]))
    if resueltas_c:
        lineas.append("Cuestiones resueltas en la iteración: " + "; ".join(f"«{x['texto'][:80]}»" for x in resueltas_c[:5]))
    try:
        from rosa import dependencias as DEP

        if DEP.pendientes(e, c.get("investigacionId")):
            lineas.append(DEP.texto_pendientes(e, c.get("investigacionId"), maximo=5).replace("\n", "; "))
    except Exception:  # noqa: BLE001
        pass
    if not lineas:
        return "La iteración anterior no dejó pasos fallidos, consultas vacías, bases caídas ni hallazgos abiertos."
    return "\n".join(f"- {l}" for l in lineas)


def traspaso_de_corrida(e: dict[str, Any], investigacion_id: str) -> str:
    """Lo que la corrida anterior de la misma investigación deja a la nueva:
    cómo terminó y su balance, la pregunta que aprobó, las hipótesis que el
    Killer cerró y por qué, las consultas hechas, y las debilidades del
    panorama que no llegaron a inyectarse."""
    previas = sorted([x for x in e.get("corridas", []) if x["investigacionId"] == investigacion_id and x["estado"] in ("terminada", "detenida")], key=lambda x: x["numero"])
    if not previas:
        return "Primera corrida de la investigación: no hay traspaso."
    c = previas[-1]
    lineas = [f"Corrida {c['numero']} ({c['estado']}): {c.get('motivoCierre') or 'sin motivo registrado'}"]
    m = c.get("metrica") or {}
    if m:
        lineas.append(f"Balance: {m.get('peldanosNetos', 0)} peldaños netos de certeza en {m.get('iteraciones', 0)} iteraciones, {m.get('hechosNuevos', 0)} hechos nuevos, {m.get('usd', 0):.2f} USD; fallidos: {m.get('fallidos')}")
    if (c.get("pregunta") or {}).get("enunciado"):
        lineas.append(f"Pregunta que trabajó: {c['pregunta']['enunciado'][:300]}")
    its = [x for x in e.get("iteraciones", []) if x.get("corridaId") == c["id"] and x.get("terminadaEn")]
    if its:
        ult = max(its, key=lambda x: x.get("numero", 0))
        if ult.get("resumen"):
            lineas.append(f"Última iteración ({ult['numero']}): {ult['resumen'][:400]}")
    titulos = {h["id"]: h["titulo"] for h in e.get("hipotesis", [])}
    ini, fin = int(c.get("empezadaEn") or 0), int(c.get("terminadaEn") or 0) or 10**18
    # Las decisiones `sinJuez` (suspensión técnica tras tres fallos del juez, S-09) no
    # son cierres científicos: el planificador no debe leerlas como "no reproponer".
    cierres = [d for d in e.get("decisiones", []) if d.get("investigacionId") == investigacion_id and str(d.get("etapa", "")).startswith("killer") and d.get("decision") in ("descartar_en_contexto", "suspender") and not d.get("sinJuez") and ini <= int(d.get("fecha") or 0) <= fin]
    if cierres:
        lineas.append("Hipótesis cerradas por el Killer (no reproponerlas iguales): " + "; ".join(f"«{titulos.get(d.get('hipotesisId'), '?')[:60]}» por {', '.join(str(x.get('comprobacion')).replace('_', ' ') for x in d.get('comprobaciones', []) if x.get('resultado') == 'falla') or 'sin detalle'}" for d in cierres[:6]))
    consultas = (c.get("busqueda") or {}).get("consultas", [])
    if consultas:
        lineas.append(f"Consultas hechas: {len(consultas)} (las últimas: " + "; ".join(f"«{q['consulta'][:60]}»" for q in consultas[-5:]) + "). Están todas en consultas_previas con su rendimiento.")
    debilidades = [d for mr in c.get("metaRevisiones", []) for d in mr.get("debilidades", []) if not d.get("inyectada")]
    if debilidades:
        lineas.append("Debilidades del panorama no atendidas: " + "; ".join((d.get("texto") or "")[:100] for d in debilidades[:4]))
    if (c.get("arnes") or {}).get("commit"):
        lineas.append(f"Corrió con ROSA2018 {c['arnes']['commit']}")
    return "\n".join(f"- {l}" for l in lineas)


# ---------------------------------------------------------------------------
# La cola de hipótesis por regla (revisión del 17 de septiembre de 2026, S-16)
# ---------------------------------------------------------------------------

EN_COLA = ("propuesta", "en_revision")


def _fecha_corta(ms: Any) -> str:
    try:
        from datetime import datetime, timezone

        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).date().isoformat() if ms else "sin fecha"
    except (TypeError, ValueError, OSError, OverflowError):
        return "sin fecha"


def motivo_killer(e: dict[str, Any], h: dict[str, Any]) -> str:
    """El motivo real de la última decisión del Killer sobre la hipótesis, tal
    como quedó en `decisiones` (las comprobaciones que fallaron), o la nota de
    la última revisión "killer". Vacío si no hay: el modelo no lo inventa."""
    decisiones = [d for d in e.get("decisiones", []) or [] if isinstance(d, dict) and d.get("hipotesisId") == h.get("id") and str(d.get("etapa", "")).startswith("killer")]
    if decisiones:
        d = max(decisiones, key=lambda x: int(x.get("fecha") or 0))
        fallan = [str(c.get("comprobacion", "")).replace("_", " ") for c in (d.get("comprobaciones") or []) if isinstance(c, dict) and c.get("resultado") == "falla"]
        motivo = (d.get("motivo") or "").strip()
        if fallan:
            return f"falla en {', '.join(fallan)}" + (f": {motivo[:140]}" if motivo else "")
        if motivo:
            return motivo[:160]
    rev = next((r for r in reversed(h.get("revisiones") or []) if isinstance(r, dict) and r.get("accion") == "killer" and r.get("nota")), None)
    return str(rev["nota"])[:160] if rev else ""


def recuento_cola(e: dict[str, Any], investigacion_id: str) -> dict[str, int]:
    """Cuántas hipótesis esperan en la cola (propuestas o en revisión) y qué
    dijo el Killer de cada una: descarte propuesto, suspendida, sin juzgar, u
    otra decisión (avanzar, reformular). Solo cuenta, no interpreta."""
    en_cola = [h for h in e.get("hipotesis", []) or [] if h.get("investigacionId") == investigacion_id and h.get("estado") in EN_COLA]
    return {
        "total": len(en_cola),
        "descarte": sum(1 for h in en_cola if h.get("decisionKiller") == "descartar_en_contexto"),
        "suspendidas": sum(1 for h in en_cola if h.get("decisionKiller") == "suspender"),
        "sinJuzgar": sum(1 for h in en_cola if not h.get("decisionKiller")),
        "otras": sum(1 for h in en_cola if h.get("decisionKiller") and h.get("decisionKiller") not in ("descartar_en_contexto", "suspender")),
    }


def frase_recuento_cola(r: dict[str, int]) -> str:
    """La frase de recuento que el modelo copia tal cual: "N en cola: X con
    descarte propuesto, Y suspendidas, Z sin juzgar"."""
    if not r.get("total"):
        return "0 en cola."
    partes = [f"{r['descarte']} con descarte propuesto", f"{r['suspendidas']} suspendidas", f"{r['sinJuzgar']} sin juzgar"]
    if r.get("otras"):
        partes.append(f"{r['otras']} con otra decisión del Killer")
    return f"{r['total']} en cola: " + ", ".join(partes) + "."


def cola_de_hipotesis(e: dict[str, Any], investigacion_id: str, maximo: int = 30) -> str:
    """La cola completa por regla, para que el resumen de la iteración y el
    resumen en llano no confundan las hipótesis nuevas con las que esperan ni
    inventen motivos del Killer: primero la frase de recuento, después cada
    hipótesis viva con título, estado, decisión del Killer con su motivo real
    y fecha de nacimiento (iteración en que nació)."""
    vivas = [h for h in e.get("hipotesis", []) or [] if h.get("investigacionId") == investigacion_id and h.get("estado") != "descartada"]
    r = recuento_cola(e, investigacion_id)
    lineas = [frase_recuento_cola(r) + (f" Además {len(vivas) - r['total']} aceptadas o en otro estado." if len(vivas) > r["total"] else "")]
    if not vivas:
        return lineas[0] + " Ninguna hipótesis viva."
    orden = {"en_revision": 0, "propuesta": 1}
    vivas.sort(key=lambda h: (orden.get(h.get("estado"), 2), -(int(h.get("creadaEn") or 0))))
    for h in vivas[:maximo]:
        decision = h.get("decisionKiller") or "sin juzgar"
        motivo = motivo_killer(e, h) if h.get("decisionKiller") else ""
        lineas.append(f"- «{str(h.get('titulo') or '')[:90]}» [estado {h.get('estado')}; Killer: {decision}" + (f" ({motivo})" if motivo else "") + f"; nació el {_fecha_corta(h.get('creadaEn'))}, iteración {h.get('iteracion', '?')}]")
    if len(vivas) > maximo:
        lineas.append(f"- ({len(vivas) - maximo} hipótesis más no se listan por tope de contexto)")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------
# Fragmentos de toda la investigación (revisión del 17 de septiembre de 2026, S-27)
# ---------------------------------------------------------------------------


def fragmentos_de_investigacion(e: dict[str, Any], investigacion_id: Any) -> list[Any]:
    """Los fragmentos del verificador (`rosa.verificador.Fragmento`) de TODAS
    las corridas de la investigación, de la más reciente a la más antigua, sin
    repetir (fuente, localizador). `Ctx.fragmentos_verificador()` solo mira la
    corrida viva: una hipótesis nacida en otra corrida no encontraba ninguna
    de sus citas y la réplica la daba por contradicha sin leer nada. Tolera
    corridas sin `_fuentes` y fuentes sin fragmentos."""
    from rosa import verificador as V

    corridas = sorted((c for c in e.get("corridas", []) if isinstance(c, dict) and c.get("investigacionId") == investigacion_id), key=lambda c: -int(c.get("numero") or 0))
    salida: list[Any] = []
    vistos: set[tuple[str, str]] = set()
    for c in corridas:
        fuentes = c.get("_fuentes")
        if not isinstance(fuentes, dict):
            continue
        for f in fuentes.values():
            if not isinstance(f, dict) or not f.get("id"):
                continue
            for fr in f.get("fragmentos") or []:
                if not isinstance(fr, dict) or not fr.get("texto"):
                    continue
                clave = (str(f["id"]), str(fr.get("localizador") or ""))
                if clave in vistos:
                    continue
                vistos.add(clave)
                salida.append(V.Fragmento(f["id"], f.get("referencia") or "", fr.get("localizador") or "", fr["texto"], fr.get("encabezado", "")))
    return salida


# ---------------------------------------------------------------------------
# Dirección de la evidencia por regla (revisión del 17 de septiembre de 2026, M-07)
# ---------------------------------------------------------------------------


def direccion_por_regla(afirmaciones: list[dict[str, Any]] | None, propuesta: str | None, experimento: dict[str, Any] | None = None) -> str:
    """La dirección de la evidencia sale de las afirmaciones, no de los
    supuestos ni de las ausencias. El juez la propone; esta regla la corrige:

    - Un resultado experimental que refuta: "en_contra".
    - Con afirmaciones en contra (sostenidas o parciales, relación
      "contradice") y ninguna a favor: "en_contra"; con las dos: "mixta".
    - "mixta" y "en_contra" exigen al menos una afirmación en contra. Sin
      ninguna, la propuesta del juez se corrige: sin apoyos,
      "sin_evidencia_directa"; con apoyos, "apoya" (o se respeta
      "sin_evidencia_directa" si todos los apoyos son indirectos, porque eso
      sí lo dicen las afirmaciones).

    Las afirmaciones se cuentan como en rosa/certeza.py (`_Vista`): solo las
    sostenidas o parciales no sintéticas; un apoyo socavado no cuenta."""
    afs = [a for a in (afirmaciones or []) if isinstance(a, dict)]
    v = CERTEZA._Vista({"afirmaciones": afs, "procedencia": {"fuentes": []}})
    apoyos = [v.afs[i] for i in v.apoyos]
    contras = [v.afs[i] for i in v.contras]
    resultado = (experimento or {}).get("resultado") if isinstance(experimento, dict) else None
    if isinstance(resultado, dict) and resultado.get("veredicto") == "refuta":
        return "en_contra"
    if contras and not apoyos:
        return "en_contra"
    if contras and apoyos:
        return "mixta"
    if not apoyos:
        return "sin_evidencia_directa"
    solo_indirectos = all(CERTEZA._relacion(a) == "apoya_indirecta" for a in apoyos)
    if propuesta == "sin_evidencia_directa" and solo_indirectos:
        return "sin_evidencia_directa"
    return "apoya"
