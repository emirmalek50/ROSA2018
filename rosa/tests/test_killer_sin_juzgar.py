"""Una hipótesis que el Killer nunca juzgó deja de ser invisible
(28 de septiembre de 2026).

El Killer solo corre dentro del paso de hipótesis. El cierre de la iteración
hace nacer hipótesis del vivero (`rosa/bucle/vivero.py`) y las marca
`_revisionPedida` «para que el siguiente paso de hipótesis las revise». En la
última iteración ese paso no llega nunca, y además:

- `pedir_revision_por_huella` las saltaba a propósito (`if d is None: continue`);
- la red de fondo les quitaba la marca sin dejar rastro cuando la corrida se
  quedaba sin presupuesto.

Quedaban con `estado: "propuesta"` y `decisionKiller: None`, que es exactamente
lo que tiene una hipótesis que el Killer dejó avanzar. Competían en el torneo,
acumulaban Elo y salían en un dossier con su certeza; solo se frenaban al
elegir candidatas, en silencio. Cuatro de las seis hipótesis de la corrida
`cor-mulntlr0-42` nacieron así.
"""

from __future__ import annotations

from typing import Any

from rosa import dossier as DOS
from rosa.bucle import corrida as CO


def _hip(hid: str, **campos: Any) -> dict[str, Any]:
    h: dict[str, Any] = {"id": hid, "investigacionId": "inv", "estado": "propuesta", "titulo": f"Hipótesis {hid}", "afirmaciones": [], "supuestos": [], "novedad": {}, "procedencia": {"fuentes": [], "registro": []}, "version": 1, "decisionKiller": None, "experimento": None, "elo": 1500, "partidos": []}
    h.update(campos)
    return h


def test_la_nunca_juzgada_queda_con_la_revision_pedida():
    nunca = _hip("nunca")
    e = {"hipotesis": [nunca], "decisiones": [], "eventos": []}
    assert CO.pedir_revision_por_huella(e, 1000) == 1
    assert nunca["_revisionPedida"] is True
    # No se pide dos veces.
    assert CO.pedir_revision_por_huella(e, 2000) == 0


def test_no_se_insiste_con_la_que_ya_agoto_los_intentos_del_juez():
    agotada = _hip("agotada", _killerIntentos=CO.MAX_INTENTOS_KILLER)
    e = {"hipotesis": [agotada], "decisiones": [], "eventos": []}
    assert CO.pedir_revision_por_huella(e, 1000) == 0
    assert "_revisionPedida" not in agotada


def test_un_registro_sin_id_no_genera_una_peticion_a_nadie():
    e = {"hipotesis": [None, "texto", {"estado": "propuesta"}], "decisiones": [], "eventos": []}
    assert CO.pedir_revision_por_huella(e, 1000) == 0


def test_abandonar_por_presupuesto_deja_dicho_que_nunca_se_juzgo():
    """Antes se borraban las tres marcas y la hipótesis quedaba idéntica a una
    que el Killer dejó avanzar."""
    nunca = _hip("nunca", _revisionPedida=True)
    juzgada = _hip("juzgada", _revisionPedida=True, decisionKiller="suspender")
    e = {"hipotesis": [nunca, juzgada], "eventos": [], "investigaciones": []}
    corrida = {"id": "cor", "numero": 1, "estado": "terminada", "investigacionId": "inv"}
    for h in (nunca, juzgada):
        assert CO._abandonar_peticion_sin_presupuesto(e, h["id"], corrida) is not False
        assert "_revisionPedida" not in h
    assert nunca["killerPendiente"]["motivo"].startswith("el Killer no llegó a juzgarla")
    assert "sin presupuesto" in nunca["killerPendiente"]["motivo"]
    assert juzgada.get("killerPendiente") is None, "esa sí se juzgó: no lleva aviso"


def test_el_dossier_lo_avisa_arriba_y_no_en_una_linea_de_estado():
    nunca = _hip("nunca", killerPendiente={"intentos": 0, "maximo": 3, "motivo": "el Killer no llegó a juzgarla: la corrida 1 se quedó sin presupuesto"})
    texto = "\n".join(_lineas(nunca))
    assert "AVISO: el Killer NO ha juzgado esta hipótesis" in texto
    assert "se quedó sin presupuesto" in texto
    assert "no puede ser candidata al laboratorio" in texto
    assert "PENDIENTE (nunca juzgada)" in texto
    # Una juzgada no lleva el aviso.
    assert "AVISO: el Killer NO ha juzgado" not in "\n".join(_lineas(_hip("j", decisionKiller="avanzar")))


def _lineas(h: dict[str, Any]) -> list[str]:
    """Las líneas de la sección 1 del dossier, sin montar el estado entero."""
    L: list[str] = []
    if not h.get("decisionKiller"):
        pendiente = (h.get("killerPendiente") or {}).get("motivo") if isinstance(h.get("killerPendiente"), dict) else None
        L.append("AVISO: el Killer NO ha juzgado esta hipótesis" + (f" ({pendiente})" if pendiente else "") + ". No ha pasado las comprobaciones de citas, fidelidad, supuestos, falsabilidad ni novedad, así que lo que sigue no está filtrado por ellas y la hipótesis no puede ser candidata al laboratorio.")
    L.append(f"Estado: {h['estado']}. Elo {h['elo']} tras {len(h.get('partidos', []))} partidos. Decisión del Killer sobre esta versión: {h.get('decisionKiller') or 'PENDIENTE (nunca juzgada)'}.")
    return L


def test_las_lineas_del_dossier_son_las_del_modulo_de_verdad():
    """El ayudante de arriba copia el texto de rosa/dossier.py: si allí cambia,
    esto lo dice en vez de dar por buena una copia que ya no existe."""
    fuente = __import__("inspect").getsource(DOS)
    assert "AVISO: el Killer NO ha juzgado esta hipótesis" in fuente
    assert "PENDIENTE (nunca juzgada)" in fuente
    assert "no puede ser candidata al laboratorio" in fuente
