"""Una afirmación que dice más que su pasaje deja de ser «sostenida»
(28 de septiembre de 2026).

Caso real, afirmación 13 del dossier de SULF2 (corrida `cor-mulntlr0-42`):

    «En cortes agudos de cerebro ex vivo, la incubación con heparina, heparán
    sulfato o heparina 2-O-desulfatada redujo la captación de tau, mientras que
    la condroitín sulfato y la heparina 6-O-desulfatada NO lo hicieron...»

con este pasaje guardado (Rauch 2018, pág. 4):

    "incubation with heparin, heparan sulfate, or 2-O-desulfated heparin
    reduced uptake of tau as quantified by the median 488 fluorescence intensity"

La mitad negativa, que es justo la que sostenía la especificidad 6-O, no está
en el pasaje. El veredicto guardado fue `sostenida`, y esa afirmación era una
de las cuatro que sostenían un supuesto marcado `contradicho`.

Pasa porque el juez no ve el pasaje: ve una ventana de 6.000 caracteres de la
página (`ventana_para_juez`), donde la otra mitad suele estar. Vota bien y lo
que se guarda como respaldo sostiene media frase. Ninguna comprobación lo
miraba: `cifras_fuera_del_pasaje` solo compara números.

La comprobación tiene que sobrevivir a que la afirmación esté en castellano y
el pasaje en inglés, así que compara solo lo que no se traduce.
"""

from __future__ import annotations

from rosa import verificador as V

TEXTO = "En cortes agudos de cerebro ex vivo, la incubación con heparina, heparán sulfato o heparina 2-O-desulfatada redujo la captación de tau, mientras que la condroitín sulfato y la heparina 6-O-desulfatada no lo hicieron, confirmando que la 6-O-sulfatación también importa."
PASAJE = "incubation with heparin, heparan sulfate, or 2-O-desulfated heparin reduced uptake of tau as quantified by the median 488 fluorescence intensity"


def test_el_caso_real_se_caza_y_dice_que_termino_falta():
    motivo = V.tramo_no_cubierto_por_el_pasaje(TEXTO, PASAJE)
    assert motivo is not None
    assert "6-O" in motivo and "dice más de lo que su cita sostiene" in motivo


def test_con_el_pasaje_entero_no_dice_nada_aunque_cambie_el_idioma():
    """El pasaje en inglés («6-O-desulfated») y la afirmación en castellano
    («6-O-desulfatada») son la misma cosa: el núcleo anclado en la cifra casa."""
    entero = PASAJE + ", whereas chondroitin sulfate and 6-O-desulfated heparin did not reduce uptake"
    assert V.tramo_no_cubierto_por_el_pasaje(TEXTO, entero) is None


def test_el_nucleo_recorta_la_parte_que_cambia_al_traducir():
    assert V._nucleo("6-O-DESULFATADA") == "6-O" == V._nucleo("6-O-DESULFATED")
    for entero in ("P301L", "AT8", "IC95", "RS429358"):
        assert V._nucleo(entero) == entero, entero


def test_los_años_sueltos_no_son_terminos_tecnicos():
    assert V.terminos_tecnicos("el estudio de 2018 y el de 1997") == set()
    assert "P301L" in V.terminos_tecnicos("el modelo P301L de 2018")


def test_es_estrecha_a_proposito_y_prefiere_callar():
    """Solo mira afirmaciones con una segunda parte que niega y con términos que
    se puedan comparar. Sin eso no dice nada: un falso positivo aquí tumba una
    afirmación buena."""
    # Sin segunda parte.
    assert V.tramo_no_cubierto_por_el_pasaje("La heparina redujo la captación de tau.", PASAJE) is None
    # Segunda parte que no niega.
    assert V.tramo_no_cubierto_por_el_pasaje("La heparina redujo la captación, aunque el efecto fue modesto.", PASAJE) is None
    # Segunda parte que niega pero sin términos técnicos que comparar.
    assert V.tramo_no_cubierto_por_el_pasaje("La heparina redujo la captación, mientras que el control no lo hizo.", PASAJE) is None
    # Sin pasaje o sin texto.
    assert V.tramo_no_cubierto_por_el_pasaje(TEXTO, "") is None and V.tramo_no_cubierto_por_el_pasaje("", PASAJE) is None


def test_caza_otras_formas_de_negar_la_segunda_parte():
    pasaje = "donanemab reduced amyloid plaque by 84 centiloids at 76 weeks"
    for segunda in ("pero el lecanemab no mostró ese efecto en APOE4", "; el lecanemab tampoco lo logró en APOE4", "sin embargo no hubo reducción en portadores APOE4"):
        texto = f"El donanemab redujo la placa amiloide en 84 centiloides, {segunda}."
        assert V.tramo_no_cubierto_por_el_pasaje(texto, pasaje) is not None, segunda


def test_el_prompt_del_juez_dice_que_decir_de_mas_es_parcial():
    from rosa.modulos.firmas import JuzgarAfirmacion

    import re

    doc = re.sub(r"\s+", " ", (JuzgarAfirmacion.__doc__ or "").lower())
    assert "dice mas que el fragmento" in doc or "dice mas" in doc
    assert "es `parcial`, nunca `sostenida`" in doc
    assert "aparezca en otra parte del articulo" in doc, "el juez ve la página entera: hay que decírselo"
