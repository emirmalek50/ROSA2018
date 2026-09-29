"""Tres cifras que ROSA2018 publicaba y no se podían leer
(28 de septiembre de 2026).

Las tres salen por la puerta: el kappa va al informe PRISMA-trAIce y al
Markdown que se pega en un manuscrito, el riesgo de sesgo se atribuye a un
instrumento con nombre (RoB 2) y el e-valor se enseña como "rechaza la
hipótesis nula al 10 %".

1. `acuerdo_dorado` solo comprobaba el mínimo de casos POR COMPROBACIÓN. El
   bloque global y el de por modelo salían sin él, así que un kappa de 1,0
   sobre DOS etiquetas se publicaba con la interpretación "casi perfecto".
2. `sesgo.juzgar_dominio` documenta "alto: alguna expone con seguridad o más
   de la mitad exponen", y el código era `exponen >= 1.5` con las seguras
   sumando 1,5: DOS respuestas "probablemente" llegaban al umbral. Con dos de
   cinco y ninguna segura, RoB 2 da "algunas dudas".
3. `secuencial.CLAVES_P` ponía la p cruda antes que la ajustada. Una ejecución
   que reporta las dos entraba con la cruda.
"""

from __future__ import annotations

from typing import Any

from rosa import acuerdo_dorado as AD
from rosa import secuencial as SEQ
from rosa import sesgo as SES


def _caso(juez: str, humano: str, comprobacion: str = "supuestos") -> dict[str, Any]:
    return {"veredictoJuez": juez, "veredictoHumano": humano, "comprobacion": comprobacion, "modeloJuez": "opus"}


def _estado(casos: list[dict[str, Any]]) -> dict[str, Any]:
    return {"hipotesis": [], "conjuntoDorado": casos}


def test_un_kappa_sobre_dos_etiquetas_no_se_llama_casi_perfecto():
    r = AD.acuerdo_dorado(_estado([_caso("pasa", "pasa"), _caso("falla", "falla")]))
    g = r["global"]
    assert g["suficiente"] is False
    assert "sin etiquetas suficientes" in g["interpretacion"]
    # Y el bloque por modelo tampoco se libra.
    assert r["porModelo"]["opus"]["suficiente"] is False


def test_con_casos_suficientes_si_se_publica():
    casos = [_caso("pasa", "pasa") for _ in range(4)] + [_caso("falla", "falla")]
    g = AD.acuerdo_dorado(_estado(casos))["global"]
    assert g["suficiente"] is True and "sin etiquetas suficientes" not in (g.get("interpretacion") or "")


def test_un_caso_a_medio_rellenar_no_tumba_el_informe():
    """`matriz_confusion` hacía `m[idx[None]]` y reventaba, y con el informe
    caía también el PRISMA."""
    casos = [_caso("pasa", "pasa"), {"veredictoJuez": None, "veredictoHumano": "pasa", "comprobacion": "supuestos"}]
    r = AD.acuerdo_dorado(_estado(casos))
    assert r["casos"] == 1, "el caso incompleto no cuenta ni como acuerdo ni como desacuerdo"


def test_rob2_no_dice_alto_con_dos_probablemente():
    dominio = {"preguntas": [{"id": f"2.{i}", "riesgoSi": True} for i in range(1, 6)]}
    juicio, motivo = SES.juzgar_dominio(dominio, {"2.1": "PY", "2.2": "PY", "2.3": "PN", "2.4": "PN", "2.5": "PN"})
    assert juicio == "algunas_dudas", f"dos de cinco y ninguna segura: RoB 2 da algunas dudas, no {juicio} ({motivo})"


def test_rob2_si_dice_alto_con_una_respuesta_segura():
    dominio = {"preguntas": [{"id": f"2.{i}", "riesgoSi": True} for i in range(1, 6)]}
    assert SES.juzgar_dominio(dominio, {"2.1": "Y", "2.2": "PN", "2.3": "PN", "2.4": "PN", "2.5": "PN"})[0] == "alto"


def test_rob2_si_dice_alto_con_mas_de_la_mitad():
    dominio = {"preguntas": [{"id": f"2.{i}", "riesgoSi": True} for i in range(1, 6)]}
    assert SES.juzgar_dominio(dominio, {"2.1": "PY", "2.2": "PY", "2.3": "PY", "2.4": "PN", "2.5": "PN"})[0] == "alto"


def test_la_p_ajustada_manda_sobre_la_cruda():
    assert SEQ.p_de({"p_valor": "0.002", "p_ajustada": "0.4"}) == 0.4
    assert SEQ.p_de({"p_valor": "0.002", "p_adj": "0.4"}) == 0.4
    # Sin ajustada, la cruda sigue valiendo.
    assert SEQ.p_de({"p_valor": "0.002"}) == 0.002


def test_una_p_ajustada_alta_no_rechaza_la_nula():
    """El caso que lo motiva: 50 genes, p cruda 0,002 y p ajustada 0,40. Con
    la cruda el e-valor decía "rechaza"; tras corregir no hay nada."""
    ejec = {"id": "run-1", "estado": "completado", "auditoria": {"veredicto": "valido"}, "hashDatos": "d1", "hashPlan": "p1", "resultados": {"p_valor": "0.002", "p_ajustada": "0.4"}}
    r = SEQ.agregar([ejec])
    assert r is not None and r["rechazaNula"] is False, r
    # Y con la cruda sola sí rechaza: la diferencia es la corrección, no otra cosa.
    solo_cruda = {**ejec, "resultados": {"p_valor": "0.002"}}
    assert SEQ.agregar([solo_cruda])["rechazaNula"] is True
