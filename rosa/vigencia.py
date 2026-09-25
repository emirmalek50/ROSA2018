"""Vigencia de los supuestos de una hipótesis: si el estado de cada uno
(respaldado, plausible, sin evidencia, contradicho) sigue siendo el que
saldría hoy.

Ese estado lo pone el evaluador (programa `evaluar_supuesto`, rol de volumen)
cuando se revisa la hipótesis (`_revisar_hipotesis` en rosa/bucle/pasos.py), y
no se recalcula solo. Se queda viejo por dos caminos:

1. Cambia la regla. `REGLA_SUPUESTOS` cuenta sus versiones:
   1. Hasta el arranque del 18 de septiembre de 2026 a las 05:48, que cargó el
      commit 80bc256: el evaluador recibía los primeros 8000 caracteres de las
      afirmaciones de toda la corrida, no la evidencia propia de la hipótesis,
      y un "contradicho" valía aunque ninguna afirmación lo negara.
   2. Desde entonces: primero la evidencia propia, con la lista numerada exacta
      contra la que se validan los índices, y "contradicho" solo si señala la
      afirmación que lo niega; la ausencia no es negación (S-08 y S-10).
   3. Desde el 23 de septiembre de 2026 (lectura de las conversaciones de Claude
      Science): cada supuesto dice además su `alcance` (resuelto, tocado sin
      respuesta, no tocado, no evaluado), dónde estaría la respuesta y, si un
      nulo lo acota, el límite. Y un nulo sin intervalo ni potencia ya no
      contradice: el estado de un supuesto evaluado con la 2 puede cambiar.
      No se pide sola (ver `REEVALUAR_AL_CARGAR_HASTA_REGLA`).
2. Llega evidencia después. La revisión se pide sola con dos afirmaciones o una
   fuente nueva (rosa/bucle/evidencia.py), no con una, y además espera a que
   una corrida con presupuesto pase por la hipótesis.

La auditoría del 23 de septiembre de 2026 (sin modelo) dio que solo 27 de los
164 supuestos flojos estaban al día: 20 hipótesis evaluadas con la regla 1 (en
8 el evaluador vio 6 de sus 60 afirmaciones) y 4 con evidencia posterior. Y el
Killer había propuesto descartar 4 hipótesis por supuestos, con la regla vieja.

Por eso cada evaluación deja un sello público en la hipótesis,
`supuestosEvaluados`, que viaja al navegador (las claves con guion bajo no):

    {"en": ms, "regla": int, "afirmaciones": int | None, "fallidos": int,
     "pedidaEn": ms | None, "noAtendida": str | None, "reconstruido": bool}

- `afirmaciones`: cuántas tenía la hipótesis al evaluarlos. Si hoy tiene más,
  llegó evidencia después.
- `fallidos`: supuestos que el modelo no pudo evaluar. El paso los guarda como
  "sin evidencia" con la nota "No se pudo evaluar", y eso es "no pude
  comprobar", nunca "no hay".
- `pedidaEn`: reevaluación pedida y todavía no hecha. La marca interna
  `_revisionPedida` la ponen y la quitan una decena de sitios; `pedidaEn` solo
  la escriben esta pantalla y la migración, y la carga la reconcilia con la
  marca real (`reconciliar`), así que no se queda colgada.
- `noAtendida`: por qué no se pudo hacer (la corrida sin presupuesto).

`vigencia` en frontend/src/lib/desbloqueo.ts aplica la misma regla en el
navegador. La pantalla "Qué desbloquea más" que la enseñaba se retiró el 25 de
septiembre de 2026 (ya hay bastantes apartados que dicen si una hipótesis es
buena); la regla y los datos siguen, porque los usan las acciones y la ficha de
cada hipótesis.
"""

from __future__ import annotations

import re
from typing import Any

REGLA_SUPUESTOS = 3

# El arranque del servidor que cargó la regla 2: evento ev-mu6rzvrs-9, "ROSA2018
# volvió a arrancar; la corrida 3 retoma donde estaba". Entre el commit (05:30)
# y este arranque no se evaluó ningún supuesto.
INICIO_REGLA_2 = 1789724900726

# Hasta qué regla se pide la reevaluación sola al cargar, una vez por hipótesis.
# La de la regla 1 se pidió así con el visto bueno de Emir (23 de septiembre de
# 2026). Una regla nueva no la pide sola: subir esta cifra es decidir gastar.
REEVALUAR_AL_CARGAR_HASTA_REGLA = 1

NO_SE_PUDO = "No se pudo evaluar"

_EVIDENCIA_NUEVA = re.compile(r"^Evidencia nueva para «.*?»: (\d+) afirmaci")


def _andar(lista: Any, profundidad: int = 0):
    if not isinstance(lista, list) or profundidad > 12:
        return
    for s in lista:
        if isinstance(s, dict):
            yield s
            yield from _andar(s.get("hijos"), profundidad + 1)


def n_afirmaciones(h: dict[str, Any]) -> int:
    a = h.get("afirmaciones")
    return len(a) if isinstance(a, list) else 0


def sello(afirmaciones: int, ahora: int, fallidos: int = 0) -> dict[str, Any]:
    """El sello de una evaluación recién hecha con la regla de hoy."""
    return {"en": ahora, "regla": REGLA_SUPUESTOS, "afirmaciones": afirmaciones, "fallidos": fallidos, "pedidaEn": None, "noAtendida": None, "reconstruido": False}


def reconstruir_sello(h: dict[str, Any], eventos: Any) -> dict[str, Any] | None:
    """El sello de una hipótesis evaluada antes de que existiera, sacado de lo
    que el estado sí guarda. La fecha es la de la revisión profunda, que se
    escribe al evaluar los supuestos (la de `ultimaRevisionAutomatica` no vale:
    `solicitar_revision` la pone al PEDIR la revisión). La regla sale de esa
    fecha. Las afirmaciones que tenía entonces son las de hoy menos las que
    llegaron después según los eventos "Evidencia nueva para «...»: N
    afirmaciones". Sin supuestos o sin revisión, None: no hay nada que sellar."""
    if not any(True for _ in _andar(h.get("supuestos"))):
        return None
    revs = h.get("revisionesAutomaticas")
    profunda = next((r for r in (revs if isinstance(revs, list) else []) if isinstance(r, dict) and r.get("tipo") == "profunda" and r.get("estado") in ("hecha", "rehecha") and isinstance(r.get("fecha"), (int, float))), None)
    en = profunda["fecha"] if profunda else h.get("ultimaRevisionAutomatica")
    if not isinstance(en, (int, float)) or isinstance(en, bool) or en <= 0:
        return None
    llegadas = 0
    for ev in eventos if isinstance(eventos, list) else []:
        if not isinstance(ev, dict) or ev.get("tipo") != "revision_automatica" or not isinstance(ev.get("t"), (int, float)) or ev["t"] <= en:
            continue
        if str(ev.get("ruta") or "").rsplit("/", 1)[-1] != h.get("id"):
            continue
        m = _EVIDENCIA_NUEVA.match(str(ev.get("texto") or ""))
        if m:
            llegadas += int(m.group(1))
    fallidos = sum(1 for s in _andar(h.get("supuestos")) if str(s.get("evidencia") or "").startswith(NO_SE_PUDO))
    return {"en": int(en), "regla": 2 if en >= INICIO_REGLA_2 else 1, "afirmaciones": max(0, n_afirmaciones(h) - llegadas), "fallidos": fallidos, "pedidaEn": None, "noAtendida": None, "reconstruido": True}


def vigencia(h: dict[str, Any]) -> dict[str, Any]:
    """{"alDia": bool, "motivo": None | "sin_sello" | "regla" | "fallidos" |
    "evidencia", "nuevas": int}. Sin supuestos, al día: no hay nada que
    reevaluar. La regla es la misma que `vigencia` en lib/desbloqueo.ts."""
    if not any(True for _ in _andar(h.get("supuestos"))):
        return {"alDia": True, "motivo": None, "nuevas": 0}
    s = h.get("supuestosEvaluados")
    if not isinstance(s, dict) or not isinstance(s.get("en"), (int, float)):
        return {"alDia": False, "motivo": "sin_sello", "nuevas": 0}
    if not isinstance(s.get("regla"), int) or s["regla"] < REGLA_SUPUESTOS:
        return {"alDia": False, "motivo": "regla", "nuevas": 0}
    if isinstance(s.get("fallidos"), int) and s["fallidos"] > 0:
        return {"alDia": False, "motivo": "fallidos", "nuevas": 0}
    base = s.get("afirmaciones")
    nuevas = max(0, n_afirmaciones(h) - base) if isinstance(base, int) and not isinstance(base, bool) else 0
    if nuevas:
        return {"alDia": False, "motivo": "evidencia", "nuevas": nuevas}
    return {"alDia": True, "motivo": None, "nuevas": 0}


def es_viva(h: dict[str, Any]) -> bool:
    return isinstance(h, dict) and h.get("estado") != "descartada" and not h.get("fusionadaEn")


def pedir(h: dict[str, Any], ahora: int) -> bool:
    """Pide la reevaluación de una hipótesis: la marca que el bucle atiende
    (`_revisionPedida`, la misma que pone la evidencia nueva) y la fecha
    pública en el sello. Devuelve si cambió algo."""
    s = h.get("supuestosEvaluados")
    ya = bool(h.get("_revisionPedida")) and isinstance(s, dict) and s.get("pedidaEn")
    if ya:
        return False
    h["_revisionPedida"] = True
    if isinstance(s, dict):
        s["pedidaEn"] = ahora
        s["noAtendida"] = None
    else:
        h["supuestosEvaluados"] = {"en": None, "regla": 0, "afirmaciones": None, "fallidos": 0, "pedidaEn": ahora, "noAtendida": None, "reconstruido": False}
    return True


def no_atendida(h: dict[str, Any], motivo: str) -> None:
    """La revisión pedida se cerró sin hacerse: el sello lo dice."""
    s = h.get("supuestosEvaluados")
    if isinstance(s, dict):
        s["pedidaEn"] = None
        s["noAtendida"] = motivo[:300]


def reconciliar(h: dict[str, Any], ahora: int) -> None:
    """`pedidaEn` sigue a la marca real: si no hay revisión pedida, no hay
    fecha de petición; si la hay y el sello no la tiene (la pidió la evidencia
    nueva u otro camino), se pone la de ahora, que es cuándo se supo."""
    s = h.get("supuestosEvaluados")
    if not isinstance(s, dict):
        return
    if not h.get("_revisionPedida"):
        s["pedidaEn"] = None
    elif not s.get("pedidaEn"):
        s["pedidaEn"] = ahora
