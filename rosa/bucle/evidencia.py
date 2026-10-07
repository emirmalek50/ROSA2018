"""Acumulación de evidencia: lo que ROSA2018 lee en cada iteración vuelve a las
hipótesis que ya existen.

Hasta el 15 de septiembre de 2026 una hipótesis nacía con las afirmaciones y
fuentes que la motivaron y ahí se quedaba: sus afirmaciones solo crecían con
un resultado de laboratorio o un análisis in silico, y sus fuentes (de donde
se cuentan las cohortes distintas) se fijaban una sola vez. La conclusión se
rehacía al cerrar cada iteración, pero sobre la misma evidencia, así que no
cambiaba. Por eso todas las hipótesis se quedaban en certeza muy baja.

Al cerrar cada iteración, para cada hipótesis viva:

1. Candidatas: las afirmaciones sostenidas o parciales de esta iteración que
   más se parecen a la hipótesis (embeddings por el gateway y coseno; sin
   embeddings, por términos clave compartidos), quitando las que ya tiene,
   las de otra entidad y las sospechosas de inyección.
2. Relación: un modelo de volumen decide, por población, marcador y sentido,
   si cada candidata la apoya, la apoya de forma indirecta, la contradice o no
   habla de ella (`AsignarEvidencia`). En la duda, fuera.
3. Se añaden las aceptadas con su cita, su cohorte, su relación y la
   iteración; la fuente entra en la procedencia de la hipótesis (y con ella
   su cohorte, que es lo que sube el techo de certeza); queda una línea en el
   registro de procedencia y un evento; y la conclusión se rehace.

Nunca inventa: solo enlaza afirmaciones ya verificadas, con su cita literal.
"""

from __future__ import annotations

import traceback
from typing import Any

import numpy as np

from rosa import certeza as CERTEZA
from rosa import indice_semantico
from rosa import politicas
from rosa import killer as K
from rosa import vigilancia
from rosa.vigilante_modelos import ModeloSinRespuesta
from rosa.bucle import contexto as T
from rosa.bucle import eventos_laboratorio as EL
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

MAX_CANDIDATAS_POR_HIPOTESIS = 8
UMBRAL_SIMILITUD = 0.30
MAX_HIPOTESIS_POR_CIERRE = 20
RELACIONES_QUE_CUENTAN = ("apoya", "apoya_indirecta", "contradice", "socava")


class PresupuestoAgotadoEvidencia(Exception):
    pass


def _texto_h(h: dict[str, Any]) -> str:
    return f"{h.get('titulo', '')}. {h.get('enunciado', '')}"


def _texto_a(a: dict[str, Any]) -> str:
    return f"{a.get('texto', '')} {a.get('fragmento', '')[:300] if a.get('fragmento') else ''}".strip()


def puede_ser_evidencia(a: dict[str, Any]) -> bool:
    """Si una afirmación puede enlazarse a una hipótesis: sostenida o parcial,
    con fuente, de la entidad correcta, sin sospecha de inyección y no sintética."""
    return (
        isinstance(a, dict) and a.get("veredicto") in ("sostenida", "parcial") and bool(a.get("fuenteId"))
        and not a.get("entidadDistinta") and not a.get("sospechosoInyeccion") and not a.get("sintetico")
        and not CERTEZA.es_abstencion(a) and bool((a.get("texto") or "").strip())
    )


def afirmaciones_nuevas(corrida: dict[str, Any], iteracion: int) -> list[dict[str, Any]]:
    """Las afirmaciones de esta iteración que pueden ser evidencia (`puede_ser_evidencia`)."""
    return [a for a in corrida.get("_afirmaciones", []) if a.get("iteracion") == iteracion and puede_ser_evidencia(a)]


def apoyos_existentes(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Los apoyos que la hipótesis ya tiene (sostenidos o parciales, a favor o de
    origen, no socavados), numerables para que el modelo señale cuál socava."""
    return [a for a in h.get("afirmaciones", []) if a.get("veredicto") in ("sostenida", "parcial") and a.get("relacion") in (None, "apoya", "apoya_indirecta") and not a.get("socavadaPor")]


def _misma_afirmacion(x: dict[str, Any], objetivo: dict[str, Any]) -> bool:
    if objetivo.get("afirmacionId") and x.get("afirmacionId"):
        return x["afirmacionId"] == objetivo["afirmacionId"]
    return x.get("texto") == objetivo.get("texto") and x.get("cita") == objetivo.get("cita")


def _ya_tiene(h: dict[str, Any], a: dict[str, Any]) -> bool:
    ids = {x.get("afirmacionId") for x in h.get("afirmaciones", []) if x.get("afirmacionId")}
    textos = {(x.get("texto") or "").strip().lower() for x in h.get("afirmaciones", [])}
    return a.get("id") in ids or (a.get("texto") or "").strip().lower() in textos


def candidatas_por_terminos(h: dict[str, Any], afs: list[dict[str, Any]]) -> list[tuple[dict[str, Any], float]]:
    """Sin embeddings: las afirmaciones que nombran los términos clave de la
    hipótesis (siglas, genes, biomarcadores), con la misma exigencia que la
    vigilancia: dos términos si la hipótesis tiene tres o más, uno si no."""
    terminos = vigilancia.terminos_de(h)
    if not terminos:
        return []
    exigidos = 2 if len(terminos) >= 3 else 1
    salida = []
    for a in afs:
        hallados = vigilancia.coincidencias(terminos, _texto_a(a))
        if len(hallados) >= exigidos:
            salida.append((a, round(len(hallados) / len(terminos), 3)))
    salida.sort(key=lambda x: -x[1])
    return salida[:MAX_CANDIDATAS_POR_HIPOTESIS]


async def candidatas_por_parecido(vivas: list[dict[str, Any]], afs: list[dict[str, Any]]) -> dict[str, list[tuple[dict[str, Any], float]]]:
    """Con embeddings: coseno entre cada hipótesis y cada afirmación; por
    hipótesis, las mejores por encima del umbral."""
    vectores, _ = await indice_semantico.incrustar([_texto_h(h) for h in vivas] + [_texto_a(a) for a in afs])
    m = np.asarray(vectores, dtype=np.float32)
    normas = np.linalg.norm(m, axis=1, keepdims=True)
    normas[normas == 0] = 1.0
    m = m / normas
    hs, xs = m[: len(vivas)], m[len(vivas):]
    sims = hs @ xs.T
    salida: dict[str, list[tuple[dict[str, Any], float]]] = {}
    for i, h in enumerate(vivas):
        orden = np.argsort(-sims[i])
        pares = [(afs[int(j)], round(float(sims[i, int(j)]), 4)) for j in orden if float(sims[i, int(j)]) >= UMBRAL_SIMILITUD]
        salida[h["id"]] = pares[:MAX_CANDIDATAS_POR_HIPOTESIS]
    return salida


async def elegir_candidatas(vivas: list[dict[str, Any]], afs: list[dict[str, Any]], pista: Any = None) -> dict[str, list[tuple[dict[str, Any], float]]]:
    if indice_semantico.disponible():
        try:
            return await candidatas_por_parecido(vivas, afs)
        except Exception as ex:  # noqa: BLE001  sin embeddings se sigue por términos
            if pista:
                pista.nota(f"Embeddings no disponibles ({type(ex).__name__}); candidatas por términos clave")
    return {h["id"]: candidatas_por_terminos(h, afs) for h in vivas}


def doi_de(f: dict[str, Any] | None) -> str:
    """El DOI de una fuente normalizado (sin prefijo de URL ni "doi:", en
    minúsculas, sin punto final); cadena vacía si no lo trae."""
    import re

    if not isinstance(f, dict):
        return ""
    doi = str(f.get("doi") or "").strip().lower()
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi).rstrip(".")


def obras_distintas_por_doi(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    """Dos fuentes que traen DOI y no coinciden son dos obras aunque compartan
    el título: las cartas al editor de NEJM sobre lecanemab llevan el título
    del artículo original con otro DOI. Sin DOI en alguna de las dos no se
    puede afirmar nada y devuelve False."""
    da, db = doi_de(a), doi_de(b)
    return bool(da and db and da != db)


def fuente_equivalente(fuentes: list[dict[str, Any]], f: dict[str, Any] | None) -> dict[str, Any] | None:
    """La fuente de `fuentes` (la procedencia de una hipótesis o de una idea del
    vivero) que es la misma obra que `f`: mismo id, id ya anotado como
    equivalente, o alguna clave compartida (doi, pmid, nct o título
    normalizado, `claves_de_fuente` de pasos.py), salvo que las dos traigan
    DOI y difieran (`obras_distintas_por_doi`: mismo título, otra obra). None
    si no está. Un artículo registrado en dos corridas con dos ids (Raket 2026
    en hip-mu2tskgf-2920) contaba dos cohortes y subía el techo GRADE de muy
    baja a baja (S-06 b)."""
    from rosa.bucle.pasos import claves_de_fuente

    if not isinstance(f, dict):
        return None
    fid = f.get("id")
    try:
        claves = claves_de_fuente(f)
    except Exception:  # noqa: BLE001
        claves = set()
    for x in fuentes or []:
        if not isinstance(x, dict):
            continue
        if fid and (x.get("id") == fid or fid in (x.get("_idsEquivalentes") or [])):
            return x
        if claves and not obras_distintas_por_doi(f, x):
            try:
                if claves & claves_de_fuente(x):
                    return x
            except Exception:  # noqa: BLE001
                continue
    return None


def ids_equivalentes_en_investigacion(e: dict[str, Any], investigacion_id: Any) -> dict[str, set[str]]:
    """Para cada id de fuente de la investigación, los OTROS ids con los que la
    misma obra está registrada: en las `_fuentes` de cualquiera de sus corridas
    (una obra leída en dos corridas recibe dos ids, S-06) o en la procedencia
    de sus hipótesis (`_idsEquivalentes`, anotado al acumular evidencia). Dos
    fuentes son la misma obra si comparten DOI, PMID, NCT o título normalizado
    (`claves_de_fuente`); un título que llevan fuentes con DOI distintos es
    ambiguo (dos obras homónimas) y no agrupa a nadie. Es lo que la réplica
    usa para resolver una cita cuya fuente tiene otro id en otra corrida sin
    caer a la referencia corta, que sí cruza homónimas (S-04). Tolera corridas
    sin `_fuentes`, fuentes sin id y registros raros; sin nada equivalente
    devuelve un diccionario vacío."""
    from rosa.bucle.pasos import claves_de_fuente

    fuentes: dict[str, dict[str, Any]] = {}
    for c in e.get("corridas", []) or []:
        if not isinstance(c, dict) or c.get("investigacionId") != investigacion_id or not isinstance(c.get("_fuentes"), dict):
            continue
        for f in c["_fuentes"].values():
            if isinstance(f, dict) and f.get("id") and str(f["id"]) not in fuentes:
                fuentes[str(f["id"])] = f
    lazos: list[tuple[str, str]] = []
    for h in e.get("hipotesis", []) or []:
        if not isinstance(h, dict) or h.get("investigacionId") != investigacion_id:
            continue
        for f in ((h.get("procedencia") or {}).get("fuentes") or []) if isinstance(h.get("procedencia"), dict) else []:
            if not isinstance(f, dict) or not f.get("id"):
                continue
            fuentes.setdefault(str(f["id"]), f)
            for otro in f.get("_idsEquivalentes") or []:
                if otro:
                    lazos.append((str(f["id"]), str(otro)))
    por_clave: dict[str, list[str]] = {}
    dois_por_clave: dict[str, set[str]] = {}
    for fid, f in fuentes.items():
        try:
            claves = claves_de_fuente(f)
        except Exception:  # noqa: BLE001
            continue
        for clave in claves:
            por_clave.setdefault(clave, []).append(fid)
            if doi_de(f):
                dois_por_clave.setdefault(clave, set()).add(doi_de(f))
    for clave, ids in por_clave.items():
        if len(ids) < 2 or len(dois_por_clave.get(clave) or ()) > 1:
            continue  # un título compartido por dos DOI distintos no agrupa: son dos obras
        lazos.extend((ids[0], otro) for otro in ids[1:])
    if not lazos:
        return {}
    padre: dict[str, str] = {}

    def raiz(x: str) -> str:
        padre.setdefault(x, x)
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    for a, b in lazos:
        ra, rb = raiz(a), raiz(b)
        if ra != rb:
            padre[ra] = rb
    grupos: dict[str, set[str]] = {}
    for x in list(padre):
        grupos.setdefault(raiz(x), set()).add(x)
    salida: dict[str, set[str]] = {}
    for miembros in grupos.values():
        if len(miembros) < 2:
            continue
        for x in miembros:
            salida[x] = set(miembros) - {x}
    return salida


def _anotar_equivalente(existente: dict[str, Any], fuente_id: Any) -> None:
    """Deja en la fuente que ya estaba el id con el que la misma obra se
    registró en otra corrida (clave privada: no viaja al navegador)."""
    if fuente_id and existente.get("id") != fuente_id:
        ids = existente.setdefault("_idsEquivalentes", [])
        if fuente_id not in ids:
            ids.append(fuente_id)


def _entrada(a: dict[str, Any], relacion: str, motivo: str, iteracion: int, socava_a: str | None = None) -> dict[str, Any]:
    """La afirmación tal como la guarda la hipótesis: la misma forma que al
    nacer, más la relación y la iteración en que llegó, y el `fuenteId` de la
    fuente de la procedencia con la que empareja (rosa/certeza.py resuelve por
    él antes que por la referencia). Si socava un apoyo, `socavaA` es el
    afirmacionId del apoyo atacado."""
    return {**({"socavaA": socava_a} if relacion == "socava" else {}),
        "afirmacionId": a.get("id"), "fuenteId": a.get("fuenteId"), "texto": a["texto"], "cita": a["cita"], "veredicto": a["veredicto"], "motivo": a.get("motivo", ""),
        "entidadDistinta": False, "tipo": a.get("tipo", "dato"), "clase": a.get("clase", "literatura"), "sintetico": False, "cohorte": a.get("cohorte", ""),
        "sospechosoInyeccion": bool(a.get("sospechosoInyeccion")), "nivelMedicion": a.get("nivelMedicion", "resultado_analisis"), "n": a.get("n", ""),
        "comparador": a.get("comparador", ""), "efecto": a.get("efecto", ""), "incertidumbre": a.get("incertidumbre", ""), "sinResolver": list(a.get("sinResolver", [])),
        "trayectoria": None, "fragmento": (a.get("fragmento") or "")[:600], "relacion": relacion, "motivoRelacion": motivo[:300], "iteracion": iteracion, **EL.metadatos_veredicto(a),
    }


async def acumular(ctx: Any, iteracion: int, pista: Any = None, afirmaciones: list[dict[str, Any]] | None = None, etiqueta: str | None = None) -> dict[str, Any]:
    """Una pasada al cerrar la iteración. Devuelve {hipotesis, candidatas,
    anadidas, enContra, ids} con los ids de las hipótesis que ganaron evidencia.

    Con `afirmaciones`, en vez de las de esta iteración se usan esas (las que
    sirvan como evidencia): es lo que hace la recuperación de citas con las que
    dejaron de estar bloqueadas. `etiqueta` sustituye a "Iteración N" en la
    línea del registro de procedencia de cada hipótesis."""
    from rosa.bucle.pasos import PresupuestoAgotado, _fuente_publica

    resumen: dict[str, Any] = {"hipotesis": 0, "candidatas": 0, "anadidas": 0, "enContra": 0, "ids": []}
    e = ctx.e
    corrida = ctx.corrida()
    afs = [a for a in afirmaciones if puede_ser_evidencia(a)] if afirmaciones is not None else afirmaciones_nuevas(corrida, iteracion)
    rotulo = etiqueta or f"Iteración {iteracion}"
    vivas = sorted([h for h in e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id and h["estado"] not in ("descartada",)], key=lambda h: -h.get("elo", 0))[:MAX_HIPOTESIS_POR_CIERRE]
    if not afs or not vivas:
        if pista:
            pista.cerrar("Sin afirmaciones nuevas o sin hipótesis vivas: nada que acumular")
        return resumen
    resumen["hipotesis"] = len(vivas)
    candidatas = await elegir_candidatas(vivas, afs, pista)
    fuentes = ctx.fuentes()
    for h in vivas:
        cands = [(a, s) for a, s in candidatas.get(h["id"], []) if not _ya_tiene(h, a)]
        if not cands:
            continue
        resumen["candidatas"] += len(cands)
        lista = "\n".join(f"{i + 1}. [{a['veredicto']}, {a.get('tipo', 'dato')}{', cohorte ' + a['cohorte'] if a.get('cohorte') else ''}] {a['texto']} {a['cita']}" for i, (a, _) in enumerate(cands))
        existentes = apoyos_existentes(h)
        lista_existentes = "\n".join(f"{i + 1}. {a['texto'][:220]} {a.get('cita', '')}" for i, a in enumerate(existentes)) or "Ninguna"
        try:
            pred = await ctx.llamar("volumen", ctx.programas.asignar_evidencia, hipotesis=T.hipotesis_texto(h), afirmaciones=K.como_dato(lista), afirmaciones_existentes=K.como_dato(lista_existentes))
        except PresupuestoAgotado:
            raise
        except ModeloSinRespuesta:
            # Sonnet no responde tras los reintentos del vigilante: la evidencia nueva
            # se enlaza al retomar el cierre, no se pierde en silencio por hipótesis.
            raise
        except Exception:  # noqa: BLE001  una hipótesis que falla no tumba las demás
            traceback.print_exc()
            continue
        # (afirmación, relación, motivo, apoyo socavado o None)
        aceptadas: list[tuple[dict[str, Any], str, str, dict[str, Any] | None]] = []
        # Un índice repetido por el modelo añadía la MISMA afirmación dos veces
        # a la misma hipótesis, y `certeza._Vista.balance` suma el peso de cada
        # entrada sin agrupar por id: dos copias de un apoyo pesan 2,0. La
        # firma pide "una entrada por candidata" y nada lo comprobaba, así que
        # una repetición podía subir el techo GRADE un peldaño y decirle a la
        # médica que hay una afirmación de respaldo más de las que hay
        # (28 de septiembre de 2026).
        vistos: set[int] = set()
        for r in list(getattr(pred, "relaciones", []) or []):
            indice, relacion, motivo = getattr(r, "indice", 0), getattr(r, "relacion", ""), getattr(r, "motivo", "") or ""
            if not (1 <= int(indice) <= len(cands)) or relacion not in RELACIONES_QUE_CUENTAN:
                continue
            if int(indice) in vistos:
                continue
            vistos.add(int(indice))
            objetivo = None
            if relacion == "socava":
                sa = getattr(r, "socava_a", None)
                # Sin un apoyo concreto al que atacar, "socava" no es evidencia: fuera.
                if sa is None or not (1 <= int(sa) <= len(existentes)):
                    continue
                objetivo = existentes[int(sa) - 1]
            aceptadas.append((cands[int(indice) - 1][0], relacion, motivo, objetivo))
        if not aceptadas:
            continue
        ahora = P.ahora_ms()

        def fn(e2: dict[str, Any], h=h, aceptadas=aceptadas, ahora=ahora) -> bool:
            y = next((z for z in e2["hipotesis"] if z["id"] == h["id"]), None)
            if not y:
                return False
            nuevas_fuentes = 0
            equivalentes = 0
            for a, relacion, motivo, objetivo in aceptadas:
                socava_a = None
                if relacion == "socava" and objetivo is not None:
                    atacada = next((x for x in y["afirmaciones"] if _misma_afirmacion(x, objetivo)), None)
                    if atacada is None:
                        continue
                    socava_a = atacada.get("afirmacionId") or f"{atacada.get('texto', '')[:80]}|{atacada.get('cita', '')}"
                    atacada.setdefault("socavadaPor", []).append(a.get("id"))
                entrada = _entrada(a, relacion, motivo, iteracion, socava_a)
                f = fuentes.get(a["fuenteId"])
                # La fuente entra en la procedencia solo si no está ya, por id O por
                # clave compartida (doi, pmid, título): la misma obra registrada en otra
                # corrida con otro id es la misma fuente, y la afirmación apunta a la
                # que ya estaba para que la cuenta de cohortes no la vea doble (S-06 b).
                existente = fuente_equivalente(y["procedencia"]["fuentes"], f) if f else None
                if existente is not None and existente.get("id") != a["fuenteId"]:
                    entrada["fuenteId"] = existente.get("id")
                    _anotar_equivalente(existente, a["fuenteId"])
                    equivalentes += 1
                y["afirmaciones"].append(entrada)
                if f and existente is None:
                    y["procedencia"]["fuentes"].append(_fuente_publica(f, a))
                    nuevas_fuentes += 1
            en_contra = sum(1 for _, r, _, _ in aceptadas if r == "contradice")
            indirectas = sum(1 for _, r, _, _ in aceptadas if r == "apoya_indirecta")
            socavan = sum(1 for _, r, _, _ in aceptadas if r == "socava")
            # Cuántas llegaron por la búsqueda en amplitud: son los "diamantes de al lado".
            de_amplitud = sum(1 for a, _, _, _ in aceptadas if (fuentes.get(a["fuenteId"]) or {}).get("modo") == "amplitud")
            y["procedencia"]["registro"].append(f"{rotulo}: {len(aceptadas)} afirmaciones nuevas enlazadas ({len(aceptadas) - en_contra - indirectas - socavan} a favor, {indirectas} indirectas, {en_contra} en contra, {socavan} que socavan un apoyo), {nuevas_fuentes} fuentes nuevas" + (f", {de_amplitud} de búsqueda en amplitud" if de_amplitud else "") + (f", {equivalentes} de una fuente que ya estaba con otro id (misma obra, no cuenta como cohorte nueva)" if equivalentes else ""))
            y["_evidenciaNueva"] = iteracion
            y.pop("_conclusionIntentada", None)
            # Evidencia nueva que cambia lo que el Killer juzgó (una fuente nueva o
            # dos o más afirmaciones) pide una revisión: el paso de hipótesis de la
            # siguiente iteración la vuelve a pasar por el Killer, que actualiza la
            # decisión, las comprobaciones, la ruta, el perfil de la diana y las
            # alternativas. Antes una hipótesis suspendida el 15 con tres
            # afirmaciones de una fuente seguía "suspendida por una sola fuente" con
            # catorce afirmaciones de seis fuentes (Emir, 17 de septiembre de 2026).
            if nuevas_fuentes > 0 or len(aceptadas) >= 2:
                y["_revisionPedida"] = True
            A.recalcular_bloqueos(e2, y)
            texto = f"Evidencia nueva para «{y['titulo'][:60]}»: {len(aceptadas)} afirmaciones" + (f", {en_contra} en contra" if en_contra else "") + (f", {socavan} que socavan un apoyo" if socavan else "") + (f", {nuevas_fuentes} fuentes nuevas" if nuevas_fuentes else "") + (f", {de_amplitud} de búsqueda en amplitud" if de_amplitud else "")
            A.con_evento(e2, y["investigacionId"], "revision_automatica", texto, f"#/investigaciones/{y['investigacionId']}/hipotesis/{y['id']}", ahora)
            return True

        ctx.mutar(fn, "evidencia_acumulada")
        resumen["anadidas"] += len(aceptadas)
        resumen["enContra"] += sum(1 for _, r, _, _ in aceptadas if r == "contradice")
        resumen["socavan"] = resumen.get("socavan", 0) + sum(1 for _, r, _, _ in aceptadas if r == "socava")
        resumen["ids"].append(h["id"])
        if pista:
            pista.resultado(f"{h['titulo'][:60]}: {len(aceptadas)} afirmaciones nuevas")
    if pista:
        pista.cerrar(f"{resumen['anadidas']} afirmaciones enlazadas a {len(resumen['ids'])} hipótesis ({resumen['enContra']} en contra) de {resumen['candidatas']} candidatas" if resumen["anadidas"] else f"{resumen['candidatas']} candidatas, ninguna pertinente")
    return resumen


def _texto_semilla(s: dict[str, Any]) -> str:
    c = s.get("comprobacion") or {}
    return f"Título: {s['titulo']}\nEnunciado: {s['enunciado']}\nMecanismo: {s.get('mecanismo', '')}\nComprobación: biomarcador {c.get('biomarcador', '')}; cohorte {c.get('cohorte', '')}; diseño {c.get('diseno', '')}"


async def acumular_vivero(ctx: Any, iteracion: int, pista: Any = None, afirmaciones: list[dict[str, Any]] | None = None, etiqueta: str | None = None, retirar: bool = True) -> dict[str, Any]:
    """La misma acumulación sobre las ideas del vivero: las que llegan al
    listón (certeza baja por regla) nacen como hipótesis; las que llevan
    demasiadas iteraciones sin ganar nada se retiran con su motivo.

    `afirmaciones` y `etiqueta` como en `acumular`. Con `retirar=False` no se
    retira ninguna idea: una pasada que no es una iteración (la recuperación de
    citas) no cuenta como una iteración más sin evidencia."""
    from rosa.bucle import vivero as VIVERO
    from rosa.bucle.pasos import PresupuestoAgotado, _fuente_publica

    resumen: dict[str, Any] = {"semillas": 0, "anadidas": 0, "nacidas": [], "retiradas": []}
    semillas = [dict(x) for x in (ctx.inv().get("vivero") or [])]
    if not semillas:
        return resumen
    resumen["semillas"] = len(semillas)
    afs = [a for a in afirmaciones if puede_ser_evidencia(a)] if afirmaciones is not None else afirmaciones_nuevas(ctx.corrida(), iteracion)
    rotulo = etiqueta or f"Iteración {iteracion}"
    pseudo = [VIVERO.como_hipotesis(x) for x in semillas]
    candidatas = await elegir_candidatas(pseudo, afs, pista) if afs else {}
    fuentes = ctx.fuentes()
    for s_, ph in zip(semillas, pseudo):
        cands = [(a, sc) for a, sc in candidatas.get(s_["id"], []) if not _ya_tiene(ph, a)]
        aceptadas: list[tuple[dict[str, Any], str, str]] = []
        if cands:
            lista = "\n".join(f"{i + 1}. [{a['veredicto']}, {a.get('tipo', 'dato')}{', cohorte ' + a['cohorte'] if a.get('cohorte') else ''}] {a['texto']} {a['cita']}" for i, (a, _) in enumerate(cands))
            try:
                pred = await ctx.llamar("volumen", ctx.programas.asignar_evidencia, hipotesis=_texto_semilla(s_), afirmaciones=K.como_dato(lista), afirmaciones_existentes="Ninguna")
                # Mismo cuidado que en `acumular`: un índice repetido añadía
                # la misma afirmación dos veces, y en el vivero una cohorte de
                # más es lo que hace nacer una idea.
                vistos_v: set[int] = set()
                for r in list(getattr(pred, "relaciones", []) or []):
                    indice, relacion, motivo = getattr(r, "indice", 0), getattr(r, "relacion", ""), getattr(r, "motivo", "") or ""
                    if 1 <= int(indice) <= len(cands) and relacion in RELACIONES_QUE_CUENTAN and int(indice) not in vistos_v:
                        vistos_v.add(int(indice))
                        aceptadas.append((cands[int(indice) - 1][0], relacion, motivo))
            except PresupuestoAgotado:
                raise
            except ModeloSinRespuesta:
                raise  # el vivero también espera a que el modelo de volumen vuelva
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        ahora = P.ahora_ms()

        def fn(e2: dict[str, Any], s_=s_, aceptadas=aceptadas, ahora=ahora) -> bool:
            inv2 = next((i for i in e2["investigaciones"] if i["id"] == ctx.investigacion_id), None)
            x = next((y for y in (inv2 or {}).get("vivero", []) if y["id"] == s_["id"]), None)
            if x is None:
                return False
            for a, relacion, motivo in aceptadas:
                entrada = _entrada(a, relacion, motivo, iteracion)
                f = fuentes.get(a["fuenteId"])
                existente = fuente_equivalente(x["fuentes"], f) if f else None
                if existente is not None and existente.get("id") != a["fuenteId"]:
                    entrada["fuenteId"] = existente.get("id")
                    _anotar_equivalente(existente, a["fuenteId"])
                x["afirmaciones"].append(entrada)
                if f and existente is None:
                    x["fuentes"].append(_fuente_publica(f, a))
            if aceptadas:
                x["actualizadaEn"] = ahora
                x["historial"].append(f"{rotulo}: {len(aceptadas)} afirmaciones nuevas ({sum(1 for _, r, _ in aceptadas if r == 'contradice')} en contra)")
            x["falta"] = VIVERO.falta_de(x)
            nivel, _ = CERTEZA.techo(VIVERO.como_hipotesis(x))
            if CERTEZA.NIVELES.index(nivel) >= 1:
                h = VIVERO.nacer(e2, x, iteracion, ahora, ctx.corrida_id)
                resumen["nacidas"].append(h["id"])
            elif retirar and not aceptadas and iteracion - int(x.get("iteracion", iteracion)) >= politicas.ITERACIONES_MAX_EN_VIVERO:
                VIVERO.retirar(e2, x, f"{politicas.ITERACIONES_MAX_EN_VIVERO} iteraciones sin evidencia nueva; le seguía faltando: {x['falta'][:120]}", ahora)
                resumen["retiradas"].append(x["titulo"])
            return True

        ctx.mutar(fn, "vivero")
        resumen["anadidas"] += len(aceptadas)
    if pista:
        pista.resultado(f"Vivero: {resumen['semillas']} ideas, {resumen['anadidas']} afirmaciones nuevas, {len(resumen['nacidas'])} nacen, {len(resumen['retiradas'])} se retiran")
    return resumen
