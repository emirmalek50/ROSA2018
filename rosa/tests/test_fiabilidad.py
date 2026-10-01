"""De qué fiarse y de qué no.

Lo pidió Emir después de preguntar qué tan real era la simulación: «todo lo
que me dijiste tienes que justificarlo en la interfaz de rosa para que el que
lee lo sepa». Estas pruebas defienden que esa justificación no se puede
quedar a medias ni suavizar sin que salte algo."""
from rosa import aso as ASO
from rosa import fiabilidad as F


def test_estan_los_cuatro_grados_de_verdad_y_en_orden():
    # El orden importa: primero lo comprobable, último lo que decidió
    # ROSA2018 y nadie ha validado, que es lo que más fácil sería callar.
    assert [n["nivel"] for n in F.NIVELES] == ["exacto", "modelo", "estadistica", "mio"]
    for n in F.NIVELES:
        assert n["titulo"] and n["resumen"] and n["cosas"]
        for c in n["cosas"]:
            assert c["que"] and c["porQue"]


def test_se_dice_que_los_pesos_los_decidio_ROSA_y_no_estan_validados():
    """Es el eslabón más flojo de la pantalla. Si esto desaparece, la pantalla
    está vendiendo como resultado lo que es una apuesta."""
    mio = next(n for n in F.NIVELES if n["nivel"] == "mio")
    texto = " ".join(c["que"] + c["porQue"] for c in mio["cosas"]).lower()
    assert "nadie ha comprobado" in texto or "nadie ha validado" in texto
    # Y se dice qué significa en claro: el conjunto sí, el orden no.
    assert "orden" in texto and "conjunto" in texto


def test_se_dice_que_la_secuencia_SI_es_exacta():
    # Lo contrario también sería mentir: la secuencia es real y pedible, y
    # esconderlo entre avisos tampoco ayuda a decidir.
    exacto = next(n for n in F.NIVELES if n["nivel"] == "exacto")
    texto = " ".join(c["que"] + c["porQue"] for c in exacto["cosas"]).lower()
    assert "literalmente" in texto
    assert "complemento inverso" in texto


def test_se_dice_que_NO_es_un_farmaco_y_que_es_la_entrada_de_un_cribado():
    q = F.QUE_ES_ESTO
    assert "cribado primario" in q["es"]
    assert "no es un fármaco" in q["noEs"].lower()
    assert "el número uno no es" in q["noEs"].lower()
    # Y la premisa de arriba del todo: la diana es una hipótesis.
    assert "hipótesis" in q["yLaPremisa"].lower()
    assert "GRADE" in q["yLaPremisa"]


def test_lo_que_no_se_ha_comprobado_nombra_los_cuatro_huecos_reales():
    texto = " ".join(c["que"] + c["porQue"] for c in F.NO_COMPROBADO).lower()
    assert "intrones" in texto          # el pre-ARN, la toxicidad hepática
    assert "variante" in texto          # las variantes de cada persona
    assert "orden" in texto             # el orden no está validado
    assert "hígado" in texto or "adversos" in texto


def test_la_ficha_viaja_con_el_diseño():
    """Si no viaja, la justificación se queda en el código, que es justo lo
    que Emir pidió que dejara de pasar."""
    d = ASO.diseño({"cdna": "ACGT" * 600, "transcrito": "T1", "build": "GRCh38"})
    assert d is not None
    assert d["fiabilidad"]["version"] == F.VERSION
    assert len(d["fiabilidad"]["niveles"]) == 4


def test_el_texto_plano_lo_dice_todo_tambien():
    # Viaja con el pedido: quien lo reciba tiene que saber qué le mandan.
    t = F.como_texto()
    for trozo in ("DE QUÉ FIARSE", "LO QUE NO SE HA COMPROBADO", "QUÉ ES ESTO"):
        assert trozo in t
    assert "nadie ha" in t.lower()
