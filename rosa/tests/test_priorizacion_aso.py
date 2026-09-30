"""El plus por traer un oligonucleótido: suma y nunca resta.

Regla acordada el 30 de septiembre de 2026. Una hipótesis que además trae un
oligonucleótido antisentido diseñado se valora más, pero no tenerlo no
penaliza ni aparta a nadie. Importa que sea así: un ASO solo sabe bajar una
proteína, y si poder fabricarlo fuera un requisito, ROSA dejaría de hacer las
preguntas del tipo «esto falta» o «esto es protector»."""
from rosa import priorizacion as PR


def _hipotesis(id_, elo, uniprot=None, direccion=None):
    return {
        "id": id_, "investigacionId": "inv", "estado": "propuesta", "decisionKiller": "avanzar",
        "elo": elo, "creadaEn": 1000, "cluster": f"c-{id_}", "bt": {}, "bloqueos": [],
        "afirmaciones": [{"veredicto": "sostenida"}], "procedencia": {"fuentes": []},
        "experimento": {"confirma": "x", "refuta": "y"}, "dossierArtefactoId": None,
        "perfilDiana": {"identificadores": {"uniprot": uniprot, "simbolo": "X"}} if uniprot else None,
        "tarjeta": {"direccion": direccion} if direccion else {},
    }


def _estado(hs, con_diseño=()):
    return {
        "hipotesis": hs,
        "investigaciones": [{"id": "inv", "datasets": []}],
        "corridas": [], "iteraciones": [], "artefactos": [], "ejecuciones": [], "planesAnalisis": [],
        "secuencias": {
            u: {"comprobado": True, "diseño": {"transcrito": f"ENST{u}", "candidatos": [{"secuencia": "A" * 20}] * 60, "cribados": 0}}
            for u in con_diseño
        },
    }


def test_con_oligo_se_valora_mas_a_igualdad_de_fuerza():
    a = _hipotesis("sin", 1500)
    b = _hipotesis("con", 1500, uniprot="P10636", direccion="disminuye")
    e = _estado([a, b], con_diseño=("P10636",))
    assert [h["id"] for h in PR.candidatos(e, "inv")] == ["con", "sin"]


def test_no_tener_oligo_no_penaliza_ni_aparta():
    # Una hipótesis claramente más fuerte sigue delante aunque no tenga oligo:
    # el plus suma, no decide.
    a = _hipotesis("fuerte_sin", 1640)
    b = _hipotesis("flojo_con", 1500, uniprot="P10636", direccion="disminuye")
    e = _estado([a, b], con_diseño=("P10636",))
    orden = [h["id"] for h in PR.candidatos(e, "inv")]
    assert orden[0] == "fuerte_sin"
    # Y la que no tiene oligo NO desaparece de la lista.
    assert "fuerte_sin" in orden and "flojo_con" in orden


def test_el_plus_no_es_una_puerta_hacia_ninguna_direccion():
    # Sin ninguna hipótesis con oligo, la lista es la de siempre.
    a = _hipotesis("a", 1600)
    b = _hipotesis("b", 1500)
    e = _estado([a, b])
    assert [h["id"] for h in PR.candidatos(e, "inv")] == ["a", "b"]


def test_solo_cuenta_si_la_hipotesis_pide_BAJAR_la_proteina():
    # Un ASO solo baja. Una hipótesis que pide subirla no gana nada.
    sube = _hipotesis("sube", 1500, uniprot="P10636", direccion="aumenta")
    e = _estado([sube], con_diseño=("P10636",))
    assert PR.aso_de(e, sube) is None
    baja = _hipotesis("baja", 1500, uniprot="P10636", direccion="disminuye")
    assert PR.aso_de(_estado([baja], con_diseño=("P10636",)), baja) is not None


def test_sin_diseño_todavia_no_hay_plus():
    h = _hipotesis("h", 1500, uniprot="P10636", direccion="disminuye")
    assert PR.aso_de(_estado([h]), h) is None


def test_el_plus_se_anota_en_la_hipotesis_para_que_se_pueda_ver():
    # Un número que mueve el orden y no se explica es un número mágico.
    h = _hipotesis("h", 1500, uniprot="P10636", direccion="disminuye")
    e = _estado([h], con_diseño=("P10636",))
    PR.marcar_candidatas(e, "inv")
    assert h["aso"]["candidatos"] == 60
    assert h["aso"]["plus"] == PR.PLUS_ASO
    assert h["aso"]["cribado"] is False
