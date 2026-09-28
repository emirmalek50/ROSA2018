"""Un supuesto contradicho corta la certeza en muy baja (28 de septiembre de 2026).

`rosa/certeza.py` no leía `supuestos` en ningún punto: el techo miraba cohortes,
peso y evidencia directa, y nada más. La regla «solo un supuesto contradicho
tumba» vivía solo en el Killer. Resultado real: la hipótesis «SULF2 neuronal
como barrera a la entrada de tau...» de la corrida `cor-mulntlr0-42` salió con
certeza «baja / apoya» y llegó a un dossier, teniendo su supuesto central
(«la degradación microglial de tau no depende críticamente de la sulfatación
6-O») marcado `contradicho` por la propia ROSA2018, que citaba cuatro
afirmaciones suyas para sostenerlo.

Y la frase de la conclusión tampoco lo decía: el aviso exigía que el juez
hubiera dicho antes «mixta» o «en contra», y el juez había dicho «apoya».
"""

from __future__ import annotations

from typing import Any

from rosa import certeza as CERTEZA
from rosa.bucle import corrida as CO


def _hipotesis(supuestos: Any) -> dict[str, Any]:
    """Dos cohortes distintas y dos apoyos sostenidos: sin supuestos, techo «baja»."""
    fuentes = [{"id": "f1", "referencia": "Rauch 2018", "cohorte": "ADNI"}, {"id": "f2", "referencia": "Puangmalai 2020", "cohorte": "A4"}]
    return {
        "afirmaciones": [
            {"texto": "SULF2 reduce la captación de tau", "veredicto": "sostenida", "fuenteId": "f1", "clase": "dato"},
            {"texto": "Silenciar Ext2 baja la p-tau", "veredicto": "sostenida", "fuenteId": "f2", "clase": "dato"},
        ],
        "fuentes": fuentes,
        "procedencia": {"fuentes": fuentes},
        "supuestos": supuestos,
        "experimento": None,
    }


CONTRADICHO = [{"texto": "La degradación microglial de tau no depende de la sulfatación 6-O", "estado": "contradicho"}]


def test_sin_supuesto_contradicho_el_techo_llega_a_baja():
    nivel, motivo = CERTEZA.techo(_hipotesis([{"texto": "x", "estado": "respaldado"}]))
    assert nivel == "baja" and "2 cohortes distintas" in motivo


def test_un_supuesto_contradicho_corta_en_muy_baja_y_dice_cuál():
    nivel, motivo = CERTEZA.techo(_hipotesis(CONTRADICHO))
    assert nivel == "muy_baja"
    assert "supuesto del que depende está contradicho" in motivo
    assert "sulfatación 6-O" in motivo, "el motivo nombra el supuesto, no dice solo que hay uno"


def test_acotar_baja_la_certeza_del_juez_y_lo_marca_como_acotada():
    r = CERTEZA.acotar("baja", _hipotesis(CONTRADICHO))
    assert r["certeza"] == "muy_baja"
    assert r["techo"]["nivel"] == "muy_baja" and r["techo"]["acotada"] is True and r["techo"]["certezaDelJuez"] == "baja"
    # Y el juez no puede subirla por encima ni diciendo "alta".
    assert CERTEZA.acotar("alta", _hipotesis(CONTRADICHO))["certeza"] == "muy_baja"


def test_varios_contradichos_se_cuentan_y_el_texto_largo_se_recorta():
    largo = "La degradación microglial de tau no depende críticamente de la sulfatación 6-O modificable por SULF2 neuronal y por tanto permanece intacta durante toda la ventana"
    sup = [{"texto": largo, "estado": "contradicho"}, {"texto": "otro", "estado": "contradicho"}]
    _, motivo = CERTEZA.techo(_hipotesis(sup))
    assert "(y 1 más)" in motivo and "..." in motivo and len(motivo) < 400


def test_un_registro_de_supuestos_raro_no_tumba_la_hipotesis():
    """Un supuesto mal formado no puede costarle un peldaño a una hipótesis."""
    for raro in (None, "texto", 7, [], ["texto"], [None], [{"estado": "contradicho"}], [{"texto": "x", "estado": "respaldado"}]):
        nivel, _ = CERTEZA.techo(_hipotesis(raro))
        esperado = "muy_baja" if raro == [{"estado": "contradicho"}] else "baja"
        assert nivel == esperado, f"supuestos={raro!r}"


def test_el_recalculo_por_regla_arregla_una_conclusion_ya_guardada():
    """La hipótesis que ya está en la base con «baja» tiene que bajar sola en el
    siguiente recálculo, sin volver a llamar al juez."""
    h = _hipotesis(CONTRADICHO)
    h["conclusion"] = {"certeza": "baja", "direccion": "apoya", "techo": {"nivel": "baja", "motivo": "viejo", "acotada": False, "certezaDelJuez": "baja", "cohortesDistintas": ["ADNI", "A4"]}, "enunciado": "La evidencia sugiere, con limitaciones, que pasa algo.", "factores": []}
    r = CERTEZA.reacotar_conclusion(h, 1_790_000_000_000)
    assert r["antes"]["certeza"] == "baja" and r["despues"]["certeza"] == "muy_baja"
    assert r["bajo"] is True and r["cambio"] is True
    assert h["conclusion"]["certeza"] == "muy_baja"
    assert "supuesto del que depende está contradicho" in h["conclusion"]["techo"]["motivo"]
    # El evento que verá quien mire la investigación dice por qué bajó.
    assert "bajó de baja a muy baja" in r["texto"] and "sulfatación 6-O" in r["texto"]
    # Y es idempotente: recalcular otra vez no vuelve a anunciar el cambio.
    assert CERTEZA.reacotar_conclusion(h, 1_790_000_000_001)["cambio"] is False


def test_la_frase_avisa_del_supuesto_aunque_el_juez_dijera_apoya():
    h = _hipotesis(CONTRADICHO)
    assert CO.direccion_por_regla(h, "apoya") == ("apoya", True)
    assert CO.direccion_por_regla(h, "mixta") == ("apoya", True)
    assert CO.direccion_por_regla(_hipotesis([]), "apoya") == ("apoya", False)
    frase = CO.frase_plantilla("apoya", "muy_baja", "SULF2 frena la entrada de tau", supuesto_contradicho=True)
    assert "supuesto del que depende está contradicho" in frase
