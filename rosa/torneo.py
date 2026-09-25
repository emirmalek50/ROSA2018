"""El torneo de hipótesis: Elo por pares con juez y debias.

Como en Co-Scientist: se emparejan hipótesis de Elo cercano (y las nuevas con
alguien del top para situarlas rápido), el juez compara A con B y luego B con
A; si discrepa, el partido queda en tablas y no mueve el Elo. K = 32 y el Elo
inicial es 1500 (es el que usa la interfaz).

Desde la revisión del 17 de septiembre de 2026 (S-13):

- Un par que ya se enfrentó no se rejuega salvo que alguna de las dos tenga
  evidencia nueva (su huella de evidencia, `rosa.killer.huella_evidencia`,
  difiere de la que guardó el último partido) o el último partido fuera
  tablas; tras dos tablas seguidas con la misma evidencia, tampoco. Antes de
  cualquier revancha se agotan los pares que nunca se han enfrentado.
- Bradley-Terry cuenta cada par UNA vez por estado de la evidencia: en la
  corrida 9 había 44 partidos sobre 25 pares, uno jugado cinco veces sin
  evidencia nueva, y eso no son 44 observaciones independientes.

Bradley-Terry (`bradley_terry`, con el algoritmo de Hunter y bootstrap) es lo
que ordena a las candidatas cuando hay partidos suficientes; con menos de 30
hipótesis, el Elo es más legible y se puede seguir a mano.
"""

from __future__ import annotations

import itertools
import random
import time
from typing import Any

K = 32

ESTADOS_QUE_JUEGAN = ("propuesta", "en_revision", "refinar", "aceptada")


def esperado(a: float, b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((b - a) / 400.0))


def actualizar(elo_a: float, elo_b: float, gano_a: bool) -> tuple[int, int]:
    ea = esperado(elo_a, elo_b)
    sa = 1.0 if gano_a else 0.0
    return round(elo_a + K * (sa - ea)), round(elo_b + K * ((1 - sa) - (1 - ea)))


def _misma_evidencia(p: dict[str, Any], a_id: str, b_id: str, huellas: dict[str, str]) -> bool:
    """El partido `p` (guardado en la hipótesis `a_id` contra `b_id`) se jugó con
    exactamente la evidencia actual de las dos. Los partidos antiguos sin
    huella no cuentan como repetidos: se juegan una vez más y quedan con huella."""
    return bool(p.get("_huellaPropia")) and bool(p.get("_huellaRival")) and p["_huellaPropia"] == huellas.get(a_id) and p["_huellaRival"] == huellas.get(b_id)


def revancha_permitida(a: dict[str, Any], b: dict[str, Any], huellas: dict[str, str]) -> bool:
    """Si `a` y `b` pueden volver a enfrentarse: nunca jugaron, o alguna tiene
    evidencia nueva desde el último partido, o el último partido fue tablas
    (el juez cambió de opinión al invertir A y B: no es un resultado, se
    rejuega una vez). Tras dos tablas seguidas con la misma evidencia, no: el
    Elo no se mueve y el juez no aporta. `huellas` es {id: huella de evidencia}
    de las hipótesis vivas."""
    contra_b = [p for p in (a.get("partidos") or []) if isinstance(p, dict) and p.get("rivalId") == b.get("id")]
    if not contra_b:
        return True
    ultimo = contra_b[-1]
    if not _misma_evidencia(ultimo, a["id"], b["id"], huellas):
        return True
    if ultimo.get("resultado") != "tablas":
        return False
    penultimo = contra_b[-2] if len(contra_b) >= 2 else None
    return not (penultimo is not None and penultimo.get("resultado") == "tablas" and _misma_evidencia(penultimo, a["id"], b["id"], huellas))


def _ya_jugaron(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return b["id"] in (a.get("rivales") or []) or a["id"] in (b.get("rivales") or [])


def emparejar(hipotesis: list[dict[str, Any]], maximo: int = 6, semilla: int | None = None, forzados: list[tuple[str, str]] | None = None, huellas: dict[str, str] | None = None, una_vez_por_ronda: bool = True) -> list[tuple[dict, dict]]:
    """Pares para esta ronda, en este orden:

    1. Los pares forzados (dos hipótesis que el Killer marcó como redundantes:
       el partido dirimente decide si se fusionan).
    2. Cada hipótesis sin partidos contra una del top, para situarla rápido.
    3. Pares que NUNCA se han enfrentado: la información nueva se agota antes
       de repetir nada.
    4. Revanchas, solo si `revancha_permitida` con las `huellas` dadas
       (evidencia nueva en alguna de las dos, o tablas). Sin `huellas` (quien
       llama no las tiene) rige la regla antigua: revancha solo con Elo a
       menos de 100 puntos.

    `una_vez_por_ronda` (por omisión True, el comportamiento de siempre) gasta
    cada hipótesis en un solo par por ronda. Eso acota la ronda pero impide
    llegar a la rejilla completa: con 9 vivas devolvía 4 pares de los 36
    posibles aunque `maximo` valiera 6, porque a la quinta ya no quedaba nadie
    libre. Con False el guardia pasa a ser por par y no por hipótesis, y el
    paso 3 enumera TODOS los pares nunca jugados ordenados por cercanía de Elo
    (los más informativos primero) en vez de solo los que caen dentro de 150
    puntos: es lo que hace falta para "cada par una vez" (Yoon y otros, 2026:
    la rejilla completa, 342 pares ordenados).
    """
    vivas = [h for h in hipotesis if h["estado"] in ESTADOS_QUE_JUEGAN]
    if len(vivas) < 2:
        return []
    rng = random.Random(semilla)
    orden = sorted(vivas, key=lambda h: -h["elo"])
    pares: list[tuple[dict, dict]] = []
    usados: set[str] = set()
    hechos: set[frozenset[str]] = set()
    por_id = {h["id"]: h for h in vivas}

    def libre(a: dict[str, Any], b: dict[str, Any]) -> bool:
        if frozenset((a["id"], b["id"])) in hechos:
            return False
        return not (una_vez_por_ronda and (a["id"] in usados or b["id"] in usados))

    def anadir(a: dict[str, Any], b: dict[str, Any]) -> None:
        pares.append((a, b))
        hechos.add(frozenset((a["id"], b["id"])))
        if una_vez_por_ronda:
            usados.update({a["id"], b["id"]})

    for ida, idb in forzados or []:
        if len(pares) >= maximo:
            break
        if ida == idb or ida not in por_id or idb not in por_id or not libre(por_id[ida], por_id[idb]):
            continue
        anadir(por_id[ida], por_id[idb])
    for h in vivas:
        if len(pares) >= maximo:
            break
        if h.get("partidos") or (una_vez_por_ronda and h["id"] in usados):
            continue
        rivales = [r for r in orden[:5] if r["id"] != h["id"] and libre(h, r)]
        if rivales:
            anadir(h, rng.choice(rivales))
    # 3. Nunca enfrentados. Con la rejilla completa, todos; si no, los de Elo cercano.
    nunca = [(a, b) for a, b in itertools.combinations(orden, 2) if not _ya_jugaron(a, b)]
    if not una_vez_por_ronda:
        nunca.sort(key=lambda par: abs(par[0]["elo"] - par[1]["elo"]))
    for a, b in nunca:
        if len(pares) >= maximo:
            break
        if not libre(a, b) or (una_vez_por_ronda and abs(a["elo"] - b["elo"]) > 150):
            continue
        anadir(a, b)
    # 4. Revanchas, solo las que aportan.
    for a, b in itertools.combinations(orden, 2):
        if len(pares) >= maximo:
            break
        if not libre(a, b) or not _ya_jugaron(a, b):
            continue
        if abs(a["elo"] - b["elo"]) > 150:
            continue
        if huellas is None:
            if abs(a["elo"] - b["elo"]) > 100:
                continue
        elif not revancha_permitida(a, b, huellas):
            continue
        anadir(a, b)
    return pares


RELACION_INVERSA = {"a_subsume_b": "b_subsume_a", "b_subsume_a": "a_subsume_b"}


def relacion_acordada(rel_1: str | None, rel_2: str | None) -> str:
    """La relación entre A y B que el juez declaró en las dos llamadas (la
    segunda con A y B invertidas). Solo cuenta si coinciden; si no, 'distintas'."""
    r1 = rel_1 or "distintas"
    r2 = RELACION_INVERSA.get(rel_2 or "distintas", rel_2 or "distintas")
    return r1 if r1 == r2 and r1 != "distintas" else "distintas"


def registrar_partido(a: dict[str, Any], b: dict[str, Any], gano_a: bool | None, iteracion: int, resumen: str, eje: str, relacion: str | None = None, por_regla: bool = False) -> None:
    """Aplica el resultado a las dos hipótesis (en sitio). `gano_a=None` son
    tablas: se anota el debate pero el Elo no se mueve.

    `relacion` es lo que son una respecto a la otra (equivalentes, una subsume a
    la otra, incompatibles) y se guarda SIEMPRE desde el punto de vista de cada
    una, "distintas" incluida. Antes solo se guardaba cuando no era "distintas",
    y como `pasos._torneo` fuerza el par marcado como redundante mientras ningún
    partido suyo tenga relación guardada, un juez que dijera "distintas" hacía
    que el par se volviera a forzar en cada iteración para siempre: en
    inv-mu2sz2ns-3 hubo un par con 9 partidos. Guardarla cierra el dirimente.

    `por_regla` marca los partidos que decidió `rosa.solidez` sin llamar al juez:
    unas tablas por regla no son un desacuerdo del juez al invertir A y B, y el
    resumen del debate no debe decir que discrepó."""
    if gano_a is not None:
        a["elo"], b["elo"] = actualizar(a["elo"], b["elo"], gano_a)
    ahora = int(time.time() * 1000)
    for h, rival, gano, rel in ((a, b, gano_a, relacion), (b, a, None if gano_a is None else not gano_a, RELACION_INVERSA.get(relacion or "", relacion))):
        h["historialElo"].append({"iteracion": iteracion, "elo": h["elo"]})
        if rival["id"] not in h["rivales"]:
            h["rivales"].append(rival["id"])
        # `_t` (privada, no viaja al navegador) es el instante del partido: el número
        # de iteración se reinicia en cada corrida (M-20) y no sirve para saber cuál
        # de dos partidos del mismo par fue el último.
        detalle = resumen if (gano is not None or por_regla) else f"Tablas (el juez discrepó al invertir el orden): {resumen}"
        h["partidos"].append({"iteracion": iteracion, "rivalId": rival["id"], "resultado": "tablas" if gano is None else ("gano" if gano else "perdio"), "resumenDebate": detalle, "ejeDecisivo": eje, "_t": ahora, **({"relacion": rel} if rel else {}), **({"porRegla": True} if por_regla else {})})
        for r in h["revisionesAutomaticas"]:
            if r["tipo"] == "torneo":
                r["estado"] = "hecha" if r["estado"] == "pendiente" else "rehecha"
                # Sin el título del rival: este resumen viaja en la ficha completa de la
                # hipótesis (`contexto.hipotesis_con_revisiones`) y filtraba la identidad
                # de un tercero. La tabla de partidos de la interfaz sí lo enseña, que es
                # donde la persona lo quiere.
                r["resumen"] = f"Partido en la iteración {iteracion}: {'ganó' if gano else ('tablas' if gano is None else 'perdió')}{' (por la regla de solidez, sin juez)' if por_regla else ''}."
                r["fecha"] = None


# ---------------------------------------------------------------------------
# Bradley-Terry con intervalos por bootstrap (plan completo, ranking)
# ---------------------------------------------------------------------------


def _partidos_unicos(hipotesis: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(ganador, perdedor) por cada partido decidido, contando cada par UNA
    vez por estado de la evidencia. Cada partido se guarda en las dos hipótesis
    (ganó en una, perdió en la otra), así que basta con los 'ganó'. Las tablas
    no cuentan. Dos partidos del mismo par con las mismas huellas de evidencia
    (`_huellaPropia`, `_huellaRival`) son la misma observación repetida: se
    queda el último. Los partidos antiguos sin huella se tratan igual (todos
    comparten el estado "sin huella"): también se colapsan al último, porque
    en las corridas 7 a 9 el torneo rejugaba cada cierre sin evidencia nueva y
    no hay forma de distinguir los que sí la tenían.

    Cuál es "el último" no se decide por el número de iteración, que se
    reinicia en cada corrida (M-20: un partido de la corrida 8, iteración 3,
    parecía posterior a uno de la corrida 9, iteración 1). Se decide por el
    instante `_t` que guarda `registrar_partido` (un partido con instante es
    posterior a cualquiera sin él, que es de antes de guardarlo); entre
    partidos sin instante, por la posición dentro de la serie de partidos
    contra ese rival, que es cronológica y es la misma en las dos hipótesis
    porque cada partido se apunta en las dos a la vez; y, en último lugar,
    por el número de iteración."""
    ids = {h["id"] for h in hipotesis}
    por_clave: dict[tuple[str, str, str, str], tuple[tuple[int, int, int], tuple[str, str]]] = {}
    for h in hipotesis:
        posicion_por_rival: dict[str, int] = {}
        for p in h.get("partidos") or []:
            if not isinstance(p, dict) or p.get("rivalId") not in ids:
                continue
            r = p["rivalId"]
            posicion = posicion_por_rival.get(r, 0)
            posicion_por_rival[r] = posicion + 1
            if p.get("resultado") != "gano":
                continue
            g = h["id"]
            huella_g, huella_r = str(p.get("_huellaPropia") or ""), str(p.get("_huellaRival") or "")
            primero, segundo = sorted((g, r))
            clave = (primero, segundo, huella_g if primero == g else huella_r, huella_r if primero == g else huella_g)
            orden = (_entero(p.get("_t")) or -1, posicion, _entero(p.get("iteracion")))
            previo = por_clave.get(clave)
            if previo is None or orden >= previo[0]:
                por_clave[clave] = (orden, (g, r))
    return [par for _, par in sorted(por_clave.values(), key=lambda x: x[0])]


def _entero(v: Any) -> int:
    """Un entero tolerante: los registros antiguos traen None o cadenas."""
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _ajustar_bt(ids: list[str], pares: list[tuple[str, str]], iteraciones: int = 200) -> dict[str, float]:
    """Algoritmo de minorización y maximización de Hunter (2004) para las
    fuerzas de Bradley-Terry, con un suavizado mínimo para que una hipótesis
    invicta o sin victorias no se vaya a infinito o a cero."""
    import math

    idx = {i: k for k, i in enumerate(ids)}
    n = len(ids)
    if n == 0:
        return {}
    victorias = [0.5] * n  # suavizado: media victoria a cada uno
    enfrentamientos = [[0.0] * n for _ in range(n)]
    for g, p in pares:
        victorias[idx[g]] += 1
        enfrentamientos[idx[g]][idx[p]] += 1
        enfrentamientos[idx[p]][idx[g]] += 1
    for k in range(n):
        for j in range(n):
            if j != k:
                enfrentamientos[k][j] += 1.0 / n  # un enfrentamiento virtual repartido
    fuerza = [1.0] * n
    for _ in range(iteraciones):
        nueva = []
        for k in range(n):
            denominador = sum(enfrentamientos[k][j] / (fuerza[k] + fuerza[j]) for j in range(n) if j != k)
            nueva.append(victorias[k] / denominador if denominador > 0 else fuerza[k])
        media_geom = math.exp(sum(math.log(x) for x in nueva) / n)
        fuerza = [x / media_geom for x in nueva]
    return {ids[k]: fuerza[k] for k in range(n)}


def bradley_terry(hipotesis: list[dict[str, Any]], remuestras: int = 200, semilla: int = 0) -> dict[str, dict[str, Any]]:
    """Fuerza de cada hipótesis en escala Elo (1500 + 400 log10 p) con un
    intervalo del 95 % por bootstrap de los partidos únicos (un par cuenta una
    vez por estado de la evidencia, `_partidos_unicos`). Con menos de dos
    partidos únicos decididos no hay estimación. `partidos` es el recuento de
    partidos decididos que la hipótesis jugó de verdad (repeticiones incluidas):
    es la cifra que ve la persona, no la que entra al ajuste. El Elo se
    conserva como vista; esto es lo que ordena a las candidatas."""
    import math

    vivas = [h for h in hipotesis if h["estado"] != "descartada"]
    ids = [h["id"] for h in vivas]
    id_set = set(ids)
    pares = _partidos_unicos(vivas)
    if len(pares) < 2 or len(ids) < 2:
        return {}
    escala = lambda p: round(1500 + 400 * math.log10(p))  # noqa: E731
    central = _ajustar_bt(ids, pares)
    rng = random.Random(semilla)
    muestras: dict[str, list[float]] = {i: [] for i in ids}
    for _ in range(remuestras):
        re = [pares[rng.randrange(len(pares))] for _ in pares]
        f = _ajustar_bt(ids, re, iteraciones=60)
        for i in ids:
            muestras[i].append(f[i])
    salida = {}
    for h in vivas:
        m = sorted(muestras[h["id"]])
        lo, hi = m[int(0.025 * len(m))], m[max(0, int(0.975 * len(m)) - 1)]
        jugados = sum(1 for p in (h.get("partidos") or []) if isinstance(p, dict) and p.get("resultado") in ("gano", "perdio") and p.get("rivalId") in id_set)
        salida[h["id"]] = {"fuerza": escala(central[h["id"]]), "ic95": [escala(lo), escala(hi)], "partidos": jugados, "partidosUnicos": sum(1 for g, p in pares if h["id"] in (g, p))}
    return salida
