"""El dossier imprime las explicaciones rivales y qué las distinguiría
(28 de septiembre de 2026).

Es el experimento crucial de Platt: la hipótesis no vale por sí sola, vale por
lo que descarta. ROSA2018 lo calcula (27 de las 34 hipótesis de la base tienen
`alternativas` con `queLaDistinguiria`), la interfaz lo pinta
(`frontend/src/componentes/Alternativas.tsx`)... y el dossier, que es lo que
se descarga y lo que llega al laboratorio, no lo imprimía nunca. La sección se
titulaba "Riesgos, alternativas y que se aprende con cada resultado" y en el
cuerpo no había una sola referencia a `h["alternativas"]`.
"""

from __future__ import annotations

from typing import Any

from rosa import dossier
from rosa.estado import plantilla as P


def _minimo() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    e = P.estado_inicial()
    inv = dict(e["investigaciones"][0]) if e.get("investigaciones") else {"id": "inv-1", "objetivo": "Objetivo de prueba", "limites": [], "condicionParada": ""}
    inv.setdefault("id", "inv-1")
    e["investigaciones"] = [inv]
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="Una hipótesis")
    e["hipotesis"] = [h]
    return e, h, inv


def _texto(h: dict[str, Any]) -> str:
    e, base, inv = _minimo()
    base.update(h)
    return dossier.texto_dossier(e, base, inv, None, 1_790_700_000_000)


def test_imprime_la_alternativa_con_su_clase_y_lo_que_la_distinguiria():
    t = _texto({"alternativas": [{"texto": "Podría ser deriva del ensayo", "clase": "artefacto", "queLaDistinguiria": "Remedir en un solo lote", "iteracion": 1}]})
    assert "Explicaciones rivales y qué observación las separaría" in t
    assert "[artefacto]" in t and "Podría ser deriva del ensayo" in t
    assert "Qué la distinguiría: Remedir en un solo lote" in t


def test_una_alternativa_sin_prueba_que_la_separe_lo_dice_en_alto():
    """Una rival sin observación que la distinga no es una rival descartable:
    callarlo sería peor que no tenerla."""
    t = _texto({"alternativas": [{"texto": "Podría ser otra cosa", "clase": "mecanismo", "queLaDistinguiria": "  ", "iteracion": 1}]})
    assert "SIN DEFINIR" in t
    assert "ningún resultado descarta esta explicación" in t


def test_sin_alternativas_no_aparece_la_seccion():
    for valor in ([], None, "texto", [{}], [{"texto": "   "}]):
        t = _texto({"alternativas": valor})
        assert "Explicaciones rivales" not in t, repr(valor)


def test_varias_alternativas_salen_todas():
    t = _texto({"alternativas": [
        {"texto": "Primera rival", "clase": "confusor", "queLaDistinguiria": "Ajustar por edad", "iteracion": 1},
        {"texto": "Segunda rival", "clase": "causa_inversa", "queLaDistinguiria": "Medir antes", "iteracion": 2},
    ]})
    assert "Primera rival" in t and "Segunda rival" in t
    assert "[confusor]" in t and "[causa inversa]" in t, "el guion bajo se lee mal en un documento"


def test_un_registro_raro_no_tumba_el_dossier():
    for valor in ([None], ["texto"], [7], [{"texto": "vale", "clase": None, "queLaDistinguiria": None}]):
        _texto({"alternativas": valor})  # no revienta
