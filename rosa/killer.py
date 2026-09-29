"""El Hypothesis Killer (ROSA2018, etapa 4): la parte sin modelo.

El Killer es una lista de comprobaciones fija. Unas las resuelve ROSA2018 aquí,
de forma determinista, con lo que ya tiene (veredictos del verificador,
cohortes de las fuentes, la comprobación de novedad con recuperación); las
otras las hace el juez (Opus 5, de otra familia que el generador) con la
firma `MatarHipotesis`. La decisión no la da ningún modelo: se deriva de los
resultados con `decidir`, siguiendo la regla que salió de la investigación
del 11 de septiembre de 2026:

- descartar en este contexto solo si falla la evidencia misma: citas que no
  resuelven o afirmaciones no sostenidas;
- reformular si falla algo arreglable: dirección causal, falsabilidad,
  factibilidad, redundancia;
- suspender (no evaluable) si una comprobación crítica quedó sin poder
  comprobarse porque una fuente no respondió o falta el dato, o si un
  supuesto del que depende la hipótesis aparece contradicho (desde el 17 de
  septiembre de 2026: antes descartaba; ver DESCARTAN);
- avanzar solo si nada crítico falla y hay predicción falsable.

Separar detección de decisión evita el fallo documentado en revisores LLM
que señalan el problema y aun así aprueban.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from rosa import vigencia as VIGENCIA
from rosa import politicas
from rosa import dianas as DI
from rosa import metodos as METODOS
from rosa.priorizacion import cohortes_de

BLOQUEANTES = ("no_sostenida", "cita_no_resuelve", "sin_cita", "ausencia_refutada")

# Qué hace cada una de las quince comprobaciones cuando FALLA. Ninguna queda
# sin consecuencia: una hipótesis ya publicada o sin fuentes primarias no
# llega a candidata "con aviso".
#   descartar:  la evidencia no la sostiene (citas, fidelidad).
#   reformular: arreglable reescribiendo (causalidad, falsabilidad, factibilidad,
#               redundancia, dirección de la evidencia, unidades, novedad: si ya
#               está publicada, hay que decir qué añade; contexto humano: la diana
#               no se expresa en humanos donde la tarjeta pone el mecanismo, así
#               que hay que cambiar la diana, el tejido o explicar cómo llega).
#   suspender:  hace falta más o mejor evidencia antes de seguir (sin fuente
#               primaria, riesgo de sesgo serio en toda la evidencia, la diana no
#               resuelve en las bases, un supuesto contradicho): lo decide una
#               persona o una búsqueda nueva.
#   avisar:     avanza con la certeza limitada (una sola cohorte: es un factor
#               GRADE, no un fallo de la hipótesis).
#
# Por qué "supuestos" suspende y no descarta (revisión del 17 de septiembre de
# 2026, hallazgo S-10). Los supuestos que se evalúan no los escribe el
# generador: los redacta el revisor inicial (Opus) y los juzga Sonnet con la
# firma EvaluarSupuesto, que daba "contradicho" incluso cuando ninguna
# afirmación mencionaba el supuesto ("ausencia" leída como "negación"). Cuatro
# de los cinco descartes de la investigación viva salieron de ahí, la auditoría
# discrepó en todos los auditados y el juez Opus que lo negó fue ignorado por
# `fusionar`. Un supuesto contradicho es "hace falta más o mejor evidencia" (o
# un factor GRADE), no "la evidencia no sostiene la hipótesis": solo las citas y
# la fidelidad hablan de la evidencia misma. Suspendida, la hipótesis se queda
# en la cola como material que ROSA2018 mejora y el bucle la rejuzga; descartada,
# salía del bucle por el eslabón más barato y menos vigilado.
DESCARTAN = ("citas_reales", "fidelidad_evidencia")
REFORMULAN = ("direccion_causal", "falsabilidad", "factibilidad", "redundancia", "direccion_evidencia", "unidades", "novedad", "contexto_humano")
SUSPENDEN = ("fuente_primaria", "sesgo_evidencia", "identificadores_resuelven", "supuestos")
AVISAN = ("independencia_cohortes",)
# Las que, sin poder comprobarse, suspenden.
CRITICAS = ("citas_reales", "fidelidad_evidencia", "supuestos", "falsabilidad", "novedad")
CONSECUENCIA = {**{c: "descartar" for c in DESCARTAN}, **{c: "reformular" for c in REFORMULAN}, **{c: "suspender" for c in SUSPENDEN}, **{c: "avisar" for c in AVISAN}}

# Cohortes del Alzheimer que ROSA2018 reconoce en títulos y resúmenes cuando el
# extractor no la dijo. Comparar por nombre es la regla de Cochrane 7.2.2
# (misma cohorte = mismo estudio). El catálogo canónico con alias vive en
# rosa/metodos.py ("método como nodo"); aquí solo se conserva la lista de
# etiquetas por compatibilidad y la función delega.
COHORTES_CONOCIDAS = [c["etiqueta"] for c in METODOS.COHORTES]


def cohorte_en_texto(texto: str) -> str:
    return METODOS.cohorte_en_texto(texto)


def comprobaciones_deterministas(h: dict[str, Any], e: dict[str, Any]) -> list[dict[str, str]]:
    """Las comprobaciones que ROSA2018 resuelve sin modelo."""
    # Registros antiguos o rotos: `afirmaciones`, `procedencia` o `novedad` pueden
    # venir como None; se leen como vacíos en vez de tumbar el Killer entero.
    afs = [a for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
    h = {**h, "afirmaciones": afs}  # los ayudantes de abajo (medidas, cohortes) leen la misma lista limpia
    c: list[dict[str, str]] = []
    # 1. Citas reales: ninguna afirmación con cita que no resuelve o sin cita.
    rotas = [a for a in afs if a["veredicto"] in ("cita_no_resuelve", "sin_cita")]
    if not afs:
        # Cero afirmaciones es "todavía no se ha buscado", no "la evidencia
        # falla". Con `falla` la decisión salía `descartar_en_contexto` con el
        # motivo "La evidencia no sostiene la hipótesis", que saca del bucle a
        # una hipótesis recién nacida sin haberla mirado (28 de septiembre de
        # 2026). Es la regla de la casa rota en el eslabón más caro. Como
        # `no_comprobable` en una comprobación crítica, suspende, que es el
        # mismo criterio que la comprobación de fidelidad de aquí al lado ya
        # aplicaba para este caso, y el que S-10 argumentó para los supuestos.
        c.append({"comprobacion": "citas_reales", "resultado": "no_comprobable", "detalle": "La hipótesis todavía no cita ninguna afirmación: no se ha buscado evidencia para ella, no es que la evidencia falle"})
    elif rotas:
        c.append({"comprobacion": "citas_reales", "resultado": "falla", "detalle": f"{len(rotas)} afirmaciones con cita que no resuelve o sin cita: " + "; ".join(a["texto"][:80] for a in rotas[:3])})
    else:
        c.append({"comprobacion": "citas_reales", "resultado": "pasa", "detalle": "Todas las citas resuelven a una fuente y a un pasaje literal"})
    # 2. Fidelidad: sostenidas frente a no sostenidas y ausencias refutadas.
    no_sost = [a for a in afs if a["veredicto"] in ("no_sostenida", "ausencia_refutada")]
    sin_ver = [a for a in afs if a["veredicto"] == "sin_verificar"]
    sostenidas = [a for a in afs if a["veredicto"] in ("sostenida", "parcial")]
    if no_sost:
        c.append({"comprobacion": "fidelidad_evidencia", "resultado": "falla", "detalle": f"{len(no_sost)} afirmaciones que la fuente no sostiene" + (" (una es dato de otra entidad)" if any(a.get("entidadDistinta") for a in no_sost) else "") + ": " + "; ".join(a["texto"][:80] for a in no_sost[:3])})
    elif afs and sin_ver and not sostenidas:
        c.append({"comprobacion": "fidelidad_evidencia", "resultado": "no_comprobable", "detalle": f"{len(sin_ver)} afirmaciones sin verificar todavía (el juez no dictaminó)"})
    elif sostenidas:
        parciales = sum(1 for a in sostenidas if a["veredicto"] == "parcial")
        # Cifras del texto que no aparecen en el pasaje citado: el verificador pudo
        # dar por sostenida una afirmación cuya cifra se copió mal. No mata: deja la
        # comprobación en no_comprobable (suspender) para que alguien la mire.
        desviadas = [(a["texto"][:70], falt) for a in sostenidas for falt in [cifras_fuera_del_pasaje(a.get("texto", ""), a.get("fragmento", ""))] if falt]
        if desviadas:
            c.append({"comprobacion": "fidelidad_evidencia", "resultado": "no_comprobable", "detalle": f"{len(desviadas)} afirmaciones con cifras que no están en su pasaje: " + "; ".join(f"'{t}' ({', '.join(f)})" for t, f in desviadas[:3])})
        else:
            c.append({"comprobacion": "fidelidad_evidencia", "resultado": "pasa", "detalle": f"Las afirmaciones están sostenidas por su fuente y sus cifras aparecen en el pasaje" + (f"; {parciales} solo parcialmente" if parciales else "")})
    else:
        c.append({"comprobacion": "fidelidad_evidencia", "resultado": "no_comprobable", "detalle": "Sin afirmaciones verificadas"})
    # 3. Supuestos: falla solo si un supuesto necesario está CONTRADICHO por la
    # evidencia. Un supuesto sin evidencia no tumba la hipótesis: se lista como
    # aviso y como lo que haría falta comprobar. (El panel del 11 de septiembre
    # de 2026 mostró que dejar esto al juez descartaba el 100 % de las
    # hipótesis por supuestos "sin respaldo".)
    # Registros antiguos o de prueba: un supuesto puede venir como texto o None.
    sups = [x for x in (h.get("supuestos") or []) if isinstance(x, dict)]
    contradichos = [x for x in sups if x.get("estado") == "contradicho"]
    # Un supuesto que no se pudo evaluar no es un supuesto sin evidencia: es uno
    # sin comprobar, y eso no se da por bueno (28 de septiembre de 2026).
    no_evaluados = [x for x in sups if VIGENCIA.no_se_pudo_evaluar(x)]
    sin_ev = [x for x in sups if x.get("estado") == "sin_evidencia" and x not in no_evaluados]
    if contradichos:
        c.append({"comprobacion": "supuestos", "resultado": "falla", "detalle": f"{len(contradichos)} supuestos contradichos por la evidencia: " + "; ".join(f"{x['texto'][:90]} ({x.get('evidencia', '')[:80]})" for x in contradichos[:2])})
    elif not sups:
        c.append({"comprobacion": "supuestos", "resultado": "pasa", "detalle": "Sin supuestos declarados"})
    elif no_evaluados:
        c.append({"comprobacion": "supuestos", "resultado": "no_comprobable", "detalle": f"{len(no_evaluados)} supuestos que no se pudieron evaluar (el modelo no respondió), así que no se sabe si alguno está contradicho: " + "; ".join(x.get("texto", "")[:70] for x in no_evaluados[:3])})
    else:
        c.append({"comprobacion": "supuestos", "resultado": "pasa", "detalle": f"Ningún supuesto contradicho; {len(sin_ev)} sin evidencia todavía" + (": " + "; ".join(x["texto"][:70] for x in sin_ev[:3]) if sin_ev else "")})
    # 4. Independencia de cohortes: por nombre de cohorte y, cuando no lo hay,
    # por autores compartidos, mismo centro y periodo cercano.
    cohortes = cohortes_de(h)
    fuentes = [f for f in ((h.get("procedencia") or {}).get("fuentes") or []) if isinstance(f, dict)]
    primarias = [f for f in fuentes if f.get("tipoEstudio") not in ("revision_narrativa", "revision_sistematica", "otro")]
    grupos, pistas_misma = grupos_de_cohorte(fuentes)
    if len(fuentes) <= 1:
        c.append({"comprobacion": "independencia_cohortes", "resultado": "falla" if fuentes else "no_aplica", "detalle": "Una sola fuente: no hay replicación independiente" if fuentes else "Sin fuentes"})
    elif len(cohortes) >= 2:
        # Cohortes distintas, pero ¿misma plataforma de medida? La concordancia entre
        # estudios no es independiente del instrumento (rosa/metodos.py).
        try:
            metodos = METODOS.resumen_metodos(fuentes)
            aviso = " " + METODOS.texto_metodos(fuentes) if metodos.get("compartenPlataforma") else ""
        except Exception:  # noqa: BLE001
            aviso = ""
        c.append({"comprobacion": "independencia_cohortes", "resultado": "pasa", "detalle": f"{len(cohortes)} cohortes distintas: " + ", ".join(cohortes) + aviso})
    elif len(cohortes) == 1 and len(grupos) == 1:
        c.append({"comprobacion": "independencia_cohortes", "resultado": "falla", "detalle": f"Todas las fuentes con cohorte identificada salen de la misma ({cohortes[0]}): varias publicaciones no son varias evidencias"})
    elif len(grupos) == 1 and pistas_misma:
        c.append({"comprobacion": "independencia_cohortes", "resultado": "falla", "detalle": "Las fuentes parecen la misma cohorte aunque no la nombren: " + "; ".join(pistas_misma[:2])})
    else:
        c.append({"comprobacion": "independencia_cohortes", "resultado": "no_comprobable", "detalle": f"{len(fuentes)} fuentes, {len(cohortes)} con cohorte identificada, {len(primarias)} parecen primarias" + ("; posibles solapes: " + "; ".join(pistas_misma[:2]) if pistas_misma else "")})
    # 5. Dirección de la evidencia frente al enunciado, y unidades comparables.
    c.extend(consistencia_medidas(h))
    # 6. La diana de la tarjeta resuelve a identificadores estables (MyGene, UniProt).
    diana = ((h.get("tarjeta") or {}).get("diana") or "").strip()
    ctxb = h.get("contextoBases") or {}
    ids = ctxb.get("identificadores") or {}
    if not diana:
        c.append({"comprobacion": "identificadores_resuelven", "resultado": "no_aplica", "detalle": "La tarjeta no nombra una diana"})
    elif ids.get("ensembl"):
        c.append({"comprobacion": "identificadores_resuelven", "resultado": "pasa", "detalle": f"{ids.get('simbolo') or diana}: Ensembl {ids.get('ensembl')}, UniProt {ids.get('uniprot') or 'sin entrada revisada'}"})
    elif ctxb.get("consultadoEn") and not ids.get("ensembl"):
        c.append({"comprobacion": "identificadores_resuelven", "resultado": "falla", "detalle": f"'{diana}' no resuelve a un gen humano en MyGene: la diana es un proceso, un texto libre o un símbolo mal escrito; hay que nombrarla con identificador"})
    else:
        c.append({"comprobacion": "identificadores_resuelven", "resultado": "no_comprobable", "detalle": "Las bases no se han consultado todavía para esta diana"})
    # 7. Contexto humano: la diana se expresa en humanos (HPA, GTEx) en la célula o
    # el tejido que la tarjeta nombra. Lo resuelve rosa/dianas.py por regla sobre
    # el perfil de evidencia por diana que guardó contexto_de_bases; sin perfil, o
    # con un perfil de otra versión o de otro gen, queda no_comprobable (nunca
    # falla por falta de dato). Falla solo si HPA no detecta la diana en cerebro y
    # la hipótesis afirma un mecanismo cerebral.
    c.append(DI.comprobacion_contexto_humano(h, h.get("perfilDiana")))
    # 8. Novedad con recuperación.
    n = h.get("novedad") if isinstance(h.get("novedad"), dict) else {}
    prec = n.get("precedente") if isinstance(n.get("precedente"), dict) else {}
    # "no_comprobado" (17 de septiembre de 2026): la consulta no se hizo, devolvió
    # 0 obras o el modelo no respondió; también tras reformular (el precedente era
    # de la versión anterior). Nunca es "sin precedente".
    if prec.get("estado") == "no_comprobado" or str(prec.get("detalle", "")).startswith("No comprobado"):
        detalle_prec = str(prec.get("detalle", "") or "No comprobado todavía")
        if not detalle_prec.startswith("No comprobado"):
            detalle_prec = "No comprobado: " + detalle_prec  # `fusionar` reconoce la novedad pendiente por este prefijo
        c.append({"comprobacion": "novedad", "resultado": "no_comprobable", "detalle": detalle_prec[:160]})
    elif prec.get("estado") == "ya_publicado":
        c.append({"comprobacion": "novedad", "resultado": "falla", "detalle": prec.get("detalle", "")[:160]})
    elif prec.get("estado") == "parcial":
        c.append({"comprobacion": "novedad", "resultado": "pasa", "detalle": "Precedente parcial: " + prec.get("detalle", "")[:140]})
    else:
        c.append({"comprobacion": "novedad", "resultado": "pasa", "detalle": prec.get("detalle", "Sin precedente claro")[:160]})
    # Factibilidad parcial: si ClinicalTrials no respondio, no comprobable (el juez completa).
    ens = n.get("ensayos") if isinstance(n.get("ensayos"), dict) else {}
    if str(ens.get("detalle", "")).startswith("No comprobado"):
        c.append({"comprobacion": "factibilidad", "resultado": "no_comprobable", "detalle": "ClinicalTrials.gov no respondió: no se pudo ver si existe un ensayo o cohorte que la mida"})
    # Factibilidad con los criterios de elegibilidad reales de los ensayos que nombra la
    # prueba (rosa/viabilidad.py, 25 de septiembre de 2026). Cuando la hay, sustituye a
    # la de arriba: se apoya en citas literales del registro, y como las deterministas
    # mandan sobre el juez (`fusionar`), ya no se decide de memoria. Si falla, la
    # hipótesis se reformula con una prueba que se pueda hacer.
    from rosa import viabilidad as VIA

    fact = VIA.comprobacion_factibilidad(h)
    if fact:
        c = [x for x in c if x["comprobacion"] != "factibilidad"] + [fact]
    return c


# Comprobaciones en las que el juez puede ver algo que la regla no vio (una cifra
# distinta del pasaje, un supuesto contradicho en el texto). Si discrepa de la
# determinista, nadie manda: queda no_comprobable y la hipótesis se suspende
# hasta que una persona o el verificador lo resuelvan.
DISCREPABLES = ("fidelidad_evidencia", "citas_reales", "supuestos")
# Comprobaciones que solo resuelve una consulta a bases externas: el juez no las
# convierte en "pasa" ni en "falla" de memoria mientras estén pendientes de buscar
# (detalle "No comprobado todavía").
SOLO_POR_RECUPERACION = ("novedad",)


def fusionar(deterministas: list[dict[str, str]], del_juez: list[dict[str, str]]) -> list[dict[str, str]]:
    """Las deterministas mandan; el juez solo aporta las que ROSA2018 no resolvió.
    Excepción: en las comprobaciones DISCREPABLES, si la determinista dice
    pasa y el juez dice falla con detalle, el resultado es no_comprobable
    (los dos jueces discrepan: se abstiene, no mata)."""
    hechas = {c["comprobacion"] for c in deterministas if c["resultado"] != "no_comprobable"}
    # Una determinista que quedó en no_comprobable CON detalle encontró algo
    # (una cifra que no está en el pasaje, un identificador que no resuelve). El
    # juez puede confirmarlo (falla) pero no borrarlo diciendo "pasa".
    # Solo en las comprobaciones objetivas (las DISCREPABLES y la de identificadores).
    sospechosas = {c["comprobacion"] for c in deterministas if c["resultado"] == "no_comprobable" and (c.get("detalle") or "").strip() and c["comprobacion"] in DISCREPABLES + ("identificadores_resuelven",)}
    # La novedad solo la resuelve la recuperación (OpenAlex, Exa): si está
    # pendiente de buscar ("No comprobado todavía", porque la base no respondió o
    # el enunciado acaba de cambiar), el juez no puede darla por "pasa" ni por
    # "falla" de memoria (S-11, 17 de septiembre de 2026: una reformulación
    # heredaba un veredicto que nunca se recomprobó). Queda no_comprobable hasta
    # el paso de novedad.
    solo_recuperacion = {c["comprobacion"] for c in deterministas if c["resultado"] == "no_comprobable" and c["comprobacion"] in SOLO_POR_RECUPERACION and str(c.get("detalle") or "").startswith("No comprobado")}
    salida = list(deterministas)
    for c in del_juez:
        nombre = c.get("comprobacion")
        if nombre in solo_recuperacion:
            for d in salida:
                if d["comprobacion"] == nombre and (c.get("detalle") or "").strip():
                    d["detalle"] = (d.get("detalle") or "")[:220] + f" | El juez opina ({str(c.get('resultado'))}: {str(c.get('detalle'))[:120]}), pero la novedad solo la resuelve la búsqueda."
            continue
        if nombre in sospechosas and c.get("resultado") == "pasa":
            for d in salida:
                if d["comprobacion"] == nombre:
                    d["detalle"] = (d.get("detalle") or "")[:220] + f" | El juez dice que pasa, pero la regla no pudo confirmarlo: se mantiene sin comprobar."
            continue
        if nombre in DISCREPABLES and nombre in hechas and c.get("resultado") == "falla" and (c.get("detalle") or "").strip():
            for d in salida:
                if d["comprobacion"] == nombre and d["resultado"] == "pasa":
                    d["resultado"] = "no_comprobable"
                    d["detalle"] = f"El juez discrepa de la comprobación por regla: {c['detalle'][:200]}"
            continue
        # Simetría en "supuestos" (17 de septiembre de 2026): la "determinista" de
        # supuestos no es una regla sino el veredicto de Sonnet. Si dice falla y el
        # juez (Opus) dice que pasa con detalle, nadie manda: queda no_comprobable.
        if nombre == "supuestos" and nombre in hechas and c.get("resultado") == "pasa" and (c.get("detalle") or "").strip():
            for d in salida:
                if d["comprobacion"] == nombre and d["resultado"] == "falla":
                    d["resultado"] = "no_comprobable"
                    d["detalle"] = f"El evaluador de supuestos los da por contradichos y el juez discrepa: {c['detalle'][:200]}"
            continue
        if nombre in hechas:
            continue
        # Si ROSA2018 dejó una no_comprobable y el juez la resolvió, se sustituye.
        salida = [x for x in salida if x["comprobacion"] != nombre]
        salida.append({"comprobacion": nombre, "resultado": c.get("resultado", "no_comprobable"), "detalle": str(c.get("detalle", ""))[:400]})
    return salida


def decidir(comprobaciones: list[dict[str, str]], tiene_prediccion: bool, version: int) -> tuple[str, str]:
    """(decisión, motivo). Regla fija; ningún modelo la escribe."""
    por_nombre = {c["comprobacion"]: c for c in comprobaciones}
    fallan = [c for c in comprobaciones if c["resultado"] == "falla"]
    fallan_descarte = [c for c in fallan if c["comprobacion"] in DESCARTAN]
    if fallan_descarte:
        return "descartar_en_contexto", "La evidencia no sostiene la hipótesis: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:120]}" for c in fallan_descarte)
    no_comp = [c for c in comprobaciones if c["resultado"] == "no_comprobable" and c["comprobacion"] in CRITICAS]
    fallan_suspenden = [c for c in fallan if c["comprobacion"] in SUSPENDEN]
    fallan_reform = [c for c in fallan if c["comprobacion"] in REFORMULAN]
    if not tiene_prediccion and "falsabilidad" not in {c["comprobacion"] for c in fallan_reform}:
        fallan_reform.append({"comprobacion": "falsabilidad", "resultado": "falla", "detalle": "La tarjeta no tiene predicción falsable"})
    if fallan_reform:
        if not politicas.puede_reformular(version):
            return "descartar_en_contexto", f"Agotó las {politicas.MAX_REFORMULACIONES} reformulaciones de la política y sigue fallando: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:100]}" for c in fallan_reform)
        return "reformular", "Arreglable reescribiendo: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:120]}" for c in fallan_reform)
    if fallan_suspenden:
        return "suspender", "Hace falta más o mejor evidencia antes de seguir: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:120]}" for c in fallan_suspenden)
    if no_comp:
        return "suspender", "No evaluable todavía: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:120]}" for c in no_comp)
    otras = [c for c in fallan if c["comprobacion"] not in DESCARTAN + REFORMULAN + SUSPENDEN]
    nota = ("Avanza con avisos: " + "; ".join(f"{c['comprobacion']}: {c['detalle'][:100]}" for c in otras)) if otras else "Pasa todas las comprobaciones críticas y tiene predicción falsable"
    if por_nombre.get("independencia_cohortes", {}).get("resultado") == "falla":
        nota += ". Una sola cohorte: la certeza queda limitada hasta que haya replicación independiente"
    return "avanzar", nota


def _lista_o_texto(v: Any) -> list[str]:
    """`socavadaPor` viene como lista o como una sola cadena; None es []."""
    if v is None or v == "":
        return []
    if isinstance(v, (list, tuple, set)):
        return sorted(str(x) for x in v)
    return [str(v)]


def huella_evidencia(h: dict[str, Any]) -> str:
    """Hash estable (SHA-256, 16 hex) de la evidencia sobre la que decide el
    Killer y concluye el juez: ids, veredictos, relaciones y `socavadaPor` de
    las afirmaciones; ids de las fuentes; versión de la hipótesis; textos y
    estados de los supuestos; estado de la novedad (precedente, patentes,
    financiación). Cambia si entra una afirmación nueva, cambia un veredicto o
    un supuesto, o se recomprueba la novedad; NO cambia con el orden de las
    listas ni con los partidos del torneo, el Elo o las conclusiones. Sirve
    para no reconcluir ni rejugar sin evidencia nueva (contrato del grupo D,
    17 de septiembre de 2026). Tolera registros antiguos sin las claves."""
    h = h if isinstance(h, dict) else {}
    afs = [a for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
    afirmaciones = sorted(
        (str(a.get("afirmacionId") or a.get("id") or a.get("cita") or a.get("texto") or ""), str(a.get("veredicto") or ""), str(a.get("relacion") or ""), _lista_o_texto(a.get("socavadaPor")))
        for a in afs
    )
    procedencia = h.get("procedencia") if isinstance(h.get("procedencia"), dict) else {}
    fuentes = sorted(str(f.get("id") or f.get("referencia") or "") for f in (procedencia.get("fuentes") or []) if isinstance(f, dict))
    supuestos = sorted((str(x.get("texto") or ""), str(x.get("estado") or "")) for x in (h.get("supuestos") or []) if isinstance(x, dict))
    novedad = h.get("novedad") if isinstance(h.get("novedad"), dict) else {}
    estado_novedad = {k: str((novedad.get(k) or {}).get("estado") if isinstance(novedad.get(k), dict) else novedad.get(k)) for k in ("precedente", "patentes", "financiacion")}
    carga = {"afirmaciones": afirmaciones, "fuentes": fuentes, "version": h.get("version", 1), "supuestos": supuestos, "novedad": estado_novedad}
    return hashlib.sha256(json.dumps(carga, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def texto_tarjeta(h: dict[str, Any]) -> str:
    t = h.get("tarjeta") or {}
    if not t:
        return "Tarjeta: sin rellenar"
    return (
        f"Tarjeta: diana o proceso {t.get('diana') or 'sin especificar'}; célula o tejido {t.get('celula') or 'sin especificar'}; etapa {t.get('etapa') or 'sin especificar'}; "
        f"intervención {t.get('intervencion') or 'ninguna'} ({t.get('direccion', 'sin_intervencion')}); predicción falsable: {t.get('prediccionFalsable') or 'NINGUNA'}; "
        f"riesgos: {'; '.join(t.get('riesgos', [])) or 'ninguno declarado'}; paso de la ruta terapéutica: {t.get('pasoRuta', 'mecanismo')}"
    )


def muestrear_para_auditoria(indice: int) -> bool:
    """Qué descartes se auditan: uno de cada k según la fracción de la
    política, determinista por el orden en que llegan (auditable, sin azar)."""
    k = max(1, round(1 / politicas.FRACCION_DESCARTES_AUDITADOS))
    return indice % k == 0


def sospechoso_inyeccion(texto: str) -> bool:
    """Patrones de instrucción dirigida al modelo dentro de un fragmento. No
    bloquea (falsos positivos en texto técnico); marca para enseñarlo."""
    t = (texto or "").lower()
    patrones = [r"ignore (all |the )?(previous|above|prior) instructions", r"\bsystem prompt\b", r"\bas an ai\b", r"you must (now )?(respond|answer|output)", r"\bassistant:\s", r"disregard (all|the) (previous|above)", r"\bprompt injection\b", r"</?\s*(system|assistant|instruction)s?\s*>"]
    return any(re.search(p, t) for p in patrones)


MARCA_INICIO = "<<<DATO_RECUPERADO>>>"
MARCA_FIN = "<<<FIN_DATO_RECUPERADO>>>"


def como_dato(texto: str) -> str:
    """Delimita un texto recuperado para que el modelo lo trate como dato
    (spotlighting por delimitadores). Se quitan marcas falsas dentro."""
    limpio = (texto or "").replace(MARCA_INICIO, "").replace(MARCA_FIN, "")
    return f"{MARCA_INICIO}\n{limpio}\n{MARCA_FIN}"


# ---------------------------------------------------------------------------
# Misma cohorte sin nombre: autores, centro y periodo
# ---------------------------------------------------------------------------

_CENTRO_RUIDO = {"department", "dept", "of", "and", "the", "university", "hospital", "institute", "center", "centre", "school", "medicine", "medical", "faculty", "college", "clinic", "research", "for", "de", "la", "del", "y", "unit", "laboratory", "lab", "neurology", "neuroscience", "usa", "uk", "germany", "sweden", "spain", "netherlands", "italy", "france", "china", "japan"}


def _palabras_centro(centro: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", (centro or "").lower()) if w not in _CENTRO_RUIDO}


def posible_misma_cohorte(f1: dict[str, Any], f2: dict[str, Any]) -> str:
    """Un motivo si dos fuentes primarias sin cohorte nombrada parecen salir
    de la misma muestra: dos o más autores comunes, o el mismo centro, y
    publicadas con pocos años de diferencia. Cadena vacía si no hay pista.
    Es una heurística: sirve para no contar dos veces, nunca para descartar."""
    if METODOS.misma_cohorte(f1, f2) is False:
        return ""  # cohortes nombradas y distintas (por catálogo canónico): son independientes
    a1 = {a.lower() for a in f1.get("autores") or []}
    a2 = {a.lower() for a in f2.get("autores") or []}
    comunes = sorted(a1 & a2)
    anios = [f.get("anio") for f in (f1, f2)]
    cerca = all(anios) and abs(anios[0] - anios[1]) <= 4
    c1, c2 = _palabras_centro(f1.get("centro")), _palabras_centro(f2.get("centro"))
    mismo_centro = len(c1 & c2) >= 2
    if len(comunes) >= 2 and cerca:
        return f"{f1.get('referencia')} y {f2.get('referencia')} comparten autores ({', '.join(x.title() for x in comunes[:3])}) y período"
    if mismo_centro and cerca and comunes:
        return f"{f1.get('referencia')} y {f2.get('referencia')} salen del mismo centro ({', '.join(sorted(c1 & c2)[:2])}) con un autor común y período cercano"
    return ""


def grupos_de_cohorte(fuentes: list[dict[str, Any]]) -> tuple[list[list[str]], list[str]]:
    """Agrupa las fuentes primarias que probablemente son la misma cohorte:
    por nombre de cohorte igual o por la heurística de autores y centro.
    Devuelve los grupos (ids) y los motivos de cada unión heurística."""
    prim = [f for f in fuentes if f.get("tipoEstudio") not in ("revision_narrativa", "revision_sistematica", "otro")] or list(fuentes)
    padre = {f["id"]: f["id"] for f in prim}

    def raiz(x: str) -> str:
        while padre[x] != x:
            x = padre[x]
        return x

    motivos: list[str] = []
    for i, f1 in enumerate(prim):
        for f2 in prim[i + 1 :]:
            if METODOS.misma_cohorte(f1, f2) is True:
                padre[raiz(f1["id"])] = raiz(f2["id"])
                continue
            m = posible_misma_cohorte(f1, f2)
            if m:
                motivos.append(m)
                padre[raiz(f1["id"])] = raiz(f2["id"])
    grupos: dict[str, list[str]] = {}
    for f in prim:
        grupos.setdefault(raiz(f["id"]), []).append(f["id"])
    return list(grupos.values()), motivos


# ---------------------------------------------------------------------------
# Dirección y unidades: lo que se puede comprobar sin modelo
# ---------------------------------------------------------------------------

_SUBE = re.compile(r"\b(increas|higher|elevat|rise|rising|up-?regulat|greater|aument|mayor(es)?|elevad|sube|suben|incrementa|superior)", re.I)
_BAJA = re.compile(r"\b(decreas|lower|reduc|declin|down-?regulat|diminish|disminu|menor(es)?|baja|bajan|cae|caida|inferior)", re.I)
_UNIDADES = re.compile(r"\b(pg|ng|ug|µg|mg|pmol|nmol|umol|µmol|fmol)\s*/\s*(m?L|dL|l)\b", re.I)


def direccion_de(texto: str) -> str:
    """'sube', 'baja' o '' según las palabras del texto; '' si hay las dos o ninguna."""
    s, b = bool(_SUBE.search(texto or "")), bool(_BAJA.search(texto or ""))
    return "sube" if s and not b else "baja" if b and not s else ""


def unidad_de(texto: str) -> str:
    m = _UNIDADES.search(texto or "")
    if not m:
        return ""
    return (m.group(1).replace("µ", "u").lower() + "/" + m.group(2).replace("l", "L").replace("d", "d").replace("m", "m"))


def consistencia_medidas(h: dict[str, Any]) -> list[dict[str, str]]:
    """Dos comprobaciones automáticas sobre el registro de evidencia:
    direccion_evidencia (la evidencia sostenida va en la dirección que el
    enunciado dice; si va al revés, la hipótesis se reformula) y unidades
    (las cifras que se comparan están en la misma unidad; si no, aviso)."""
    bio = ((h.get("comprobacion") or {}).get("biomarcador") or h.get("biomarcador") or "").strip().lower()
    afs = [a for a in h.get("afirmaciones", []) if a.get("veredicto") in ("sostenida", "parcial")]
    relevantes = [a for a in afs if bio in a.get("texto", "").lower()] if bio else afs
    salida: list[dict[str, str]] = []
    dir_enunciado = direccion_de(h.get("enunciado", "") + " " + h.get("titulo", ""))
    dirs = [direccion_de(a.get("texto", "")) for a in relevantes]
    dirs = [d for d in dirs if d]
    if not relevantes or not dirs:
        salida.append({"comprobacion": "direccion_evidencia", "resultado": "no_aplica", "detalle": "Sin afirmaciones sostenidas con dirección sobre el biomarcador" if bio else "Sin biomarcador ni afirmaciones con dirección"})
    elif "sube" in dirs and "baja" in dirs:
        salida.append({"comprobacion": "direccion_evidencia", "resultado": "falla", "detalle": f"Las fuentes sostenidas van en direcciones opuestas sobre {bio or 'la medida'} ({dirs.count('sube')} suben, {dirs.count('baja')} bajan): hay que decir en que contexto sube y en cual baja"})
    elif dir_enunciado and all(d != dir_enunciado for d in dirs):
        salida.append({"comprobacion": "direccion_evidencia", "resultado": "falla", "detalle": f"El enunciado dice que {bio or 'la medida'} {dir_enunciado} y todas las afirmaciones sostenidas dicen que {dirs[0]}: dirección invertida"})
    else:
        salida.append({"comprobacion": "direccion_evidencia", "resultado": "pasa", "detalle": f"{len(dirs)} afirmaciones con dirección {dirs[0]}" + (", igual que el enunciado" if dir_enunciado else "")})
    unidades = sorted({unidad_de(a.get("efecto", "") or a.get("texto", "")) for a in relevantes} - {""})
    if len(unidades) >= 2:
        salida.append({"comprobacion": "unidades", "resultado": "falla", "detalle": "Las cifras sobre " + (bio or "la medida") + " vienen en unidades distintas (" + ", ".join(unidades) + "): comparar solo tras convertir"})
    elif unidades:
        salida.append({"comprobacion": "unidades", "resultado": "pasa", "detalle": f"Todas las cifras en {unidades[0]}"})
    else:
        salida.append({"comprobacion": "unidades", "resultado": "no_aplica", "detalle": "Sin cifras con unidad"})
    return salida


_NUMERO = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)(?![\w])")


def _normaliza_num(t: str) -> str:
    """'1,234' (miles) -> 1234; '.001' -> 0.001; '0,8' (decimal europeo) -> 0.8."""
    t = t.replace("\u00b7", ".")
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", t):
        t = t.replace(",", "")
    else:
        t = t.replace(",", ".")
    if t.startswith("."):
        t = "0" + t
    try:
        v = float(t)
    except ValueError:
        return t
    return f"{v:g}"


def cifras_fuera_del_pasaje(texto: str, pasaje: str) -> list[str]:
    """Las cifras del texto de una afirmación que no aparecen en su pasaje
    citado. Solo se comprueba cuando el pasaje existe y trae alguna cifra;
    los años (1900 a 2099) y los números de una cifra se ignoran porque
    aparecen en cualquier frase. Devuelve [] si no hay nada que objetar."""
    if not pasaje or not texto:
        return []
    pasaje = pasaje.replace("\u00b7", ".")
    texto = texto.replace("\u00b7", ".")
    en_pasaje = {_normaliza_num(m) for m in _NUMERO.findall(pasaje)}
    if not en_pasaje:
        return []
    faltan = []
    for m in _NUMERO.findall(texto):
        n = _normaliza_num(m)
        try:
            v = float(n)
        except ValueError:
            continue
        if v < 10 and "." not in n and not re.search(re.escape(m) + r"\s*(pg|ng|mg|ug|µg|%|mmol|pmol|nmol|fold|veces|x\b|mL|ml|HR|OR|SD|IC|CI)", texto, re.I):
            continue  # un dígito suelto sin unidad: "3 cohortes", "dos grupos"
        if 1900 <= v <= 2099 and "." not in n:
            continue  # año
        if n not in en_pasaje and not any(abs(v - float(x)) < 1e-9 for x in en_pasaje if _es_num(x)):
            faltan.append(m)
    return faltan


def _es_num(x: str) -> bool:
    try:
        float(x)
        return True
    except ValueError:
        return False
