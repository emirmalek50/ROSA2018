"""La solidez eliminatoria del torneo, por regla y sin ningún modelo.

En el torneo de Yoon y otros (2026) el juez puntúa impacto, novedad, solidez y
accionabilidad del 1 al 5 y un informe con solidez 2 o menos pierde el partido
automáticamente. ROSA2018 se queda con la parte eliminatoria y tira la
puntuación: las 20 conversaciones de Claude Science midieron una correlación de
Spearman de 0,03 entre dos rondas de repuntuación a ciegas de la misma
falsabilidad (TRASPASO.md, "Lo que NO se trajo de Claude Science"), así que un
número del 1 al 5 escrito por un modelo no aguanta el peso de decidir un
partido.

Lo eliminatorio sale de lo que ROSA2018 ya calcula sin modelo: los veredictos
del verificador, la retracción de las fuentes, la auditoría de los análisis y la
decisión por regla del Killer. Una hipótesis descalificada pierde el partido sin
llamar al juez; si las dos lo están, tablas y tampoco se llama. El torneo gasta
menos, no más.

"No pude comprobar" nunca descalifica: una hipótesis cuyas afirmaciones siguen
sin verificar porque el juez del verificador no respondió, o que todavía no pasó
por el Killer, se juega como cualquier otra. Tampoco descalifican las puertas de
proceso (revisión de registro abierta, dependencia pendiente, sin experimento
interpretable): son temporales y hoy las tiene el 100 % de las hipótesis de la
investigación en curso, así que descalificar por ellas dejaría el torneo entero
en tablas.
"""

from __future__ import annotations

from typing import Any

from rosa import priorizacion

# Los cuatro veredictos con los que la fuente NO sostiene la afirmación o la cita
# no llega a un pasaje. Son los mismos de `priorizacion.BLOQUEANTES`, que ya
# saca a la hipótesis de los candidatos, y los mismos que hacen fallar
# `citas_reales` y `fidelidad_evidencia`, las dos comprobaciones de
# `killer.DESCARTAN`. `sin_verificar` NO está en la lista a propósito.
#
# Medido el 25 de septiembre de 2026: esta regla NO dispara sobre el estado
# guardado, y conviene saber por qué antes de confiar en ella. A una hipótesis
# solo se le atan afirmaciones sostenidas o parciales
# (`evidencia.afirmaciones_nuevas`), y la réplica que baja un veredicto lo hace
# sobre copias (`corrida._preparar_copias_replica`, línea 2727: `dict(a, ...)`),
# así que hoy nada degrada en el sitio el veredicto de una afirmación ya atada:
# las 250 atadas están en "sostenida" o "parcial". La regla queda porque es la
# que sostiene el caso cuando eso cambie (una escritura de vuelta de la réplica,
# una migración que corrija veredictos viejos) y porque no cuesta nada; lo que
# hoy descalifica de verdad es el descarte del Killer.
VEREDICTOS_QUE_DESCALIFICAN = priorizacion.BLOQUEANTES

# Bloqueos de `priorizacion.bloqueos_de` que descalifican. Se recalculan, nunca
# se leen del campo guardado en la hipótesis, que puede venir de una regla vieja
# (regla de Emir: auditar la vigencia antes de construir encima).
BLOQUEOS_QUE_DESCALIFICAN = ("analisis_invalido", "datos_no_autorizados")


def motivos(e: dict[str, Any], h: dict[str, Any]) -> list[str]:
    """Por qué esta hipótesis pierde cualquier partido del torneo, en castellano
    y listo para el resumen del debate. Lista vacía: se juega con juez."""
    fuera: list[str] = []
    afs = [a for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
    malas = [a for a in afs if a.get("veredicto") in VEREDICTOS_QUE_DESCALIFICAN]
    if malas:
        cuenta: dict[str, int] = {}
        for a in malas:
            cuenta[str(a["veredicto"])] = cuenta.get(str(a["veredicto"]), 0) + 1
        detalle = ", ".join(f"{n} {_EN_CLARO.get(v, v)}" for v, n in sorted(cuenta.items()))
        fuera.append(f"{len(malas)} de sus {len(afs)} afirmaciones no se sostienen ({detalle})")
    procedencia = h.get("procedencia")
    fuentes = procedencia.get("fuentes") if isinstance(procedencia, dict) else None
    retractadas = [f for f in (fuentes if isinstance(fuentes, list) else []) if isinstance(f, dict) and f.get("retraccion") == "retractado"]
    if retractadas:
        fuera.append(f"{len(retractadas)} de las fuentes que la sostienen está retractada" if len(retractadas) == 1 else f"{len(retractadas)} de las fuentes que la sostienen están retractadas")
    if h.get("decisionKiller") == "descartar_en_contexto":
        fuera.append("el Killer la descartó en contexto")
    try:
        bloqueos = priorizacion.bloqueos_de(e, h)
    except Exception:  # noqa: BLE001  un registro roto no tumba el torneo
        bloqueos = []
    for b in BLOQUEOS_QUE_DESCALIFICAN:
        if b in bloqueos:
            fuera.append(_EN_CLARO[b])
    return fuera


_EN_CLARO = {
    "no_sostenida": "que su fuente no sostiene",
    "cita_no_resuelve": "cuya cita no resuelve al pasaje",
    "sin_cita": "sin cita",
    "ausencia_refutada": "cuya ausencia quedó refutada",
    "analisis_invalido": "la auditoría dio por no válido su análisis in silico",
    "datos_no_autorizados": "corrió sobre datos sin uso por IA autorizado",
}
