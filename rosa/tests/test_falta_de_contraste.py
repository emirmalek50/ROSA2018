"""Una hipótesis que solo acumula apoyos es una pregunta, no una certeza.

El 29 de septiembre de 2026 se contaron las relaciones de las 34 hipótesis de la
base: 117 afirmaciones a favor y UNA en contra, con once hipótesis de cuatro o
más apoyos y cero contras (una con diecisiete). La literatura de una hipótesis
biológica real no se ve así. No prueba que las hipótesis sean falsas: prueba que
ROSA2018 no había ido a buscar lo que las tumba, porque nada en la tubería se lo
pedía. Esta regla lo dice en voz alta y por escrito, sin tocar la certeza.
"""

from rosa import cuestiones as CU
from rosa.bucle.corrida import APOYOS_SIN_CONTRA_QUE_PREOCUPAN, _cuestiones_por_falta_de_contraste


def _h(id_, titulo, apoyos, contras=0, socava=0, estado="propuesta", refuta=None, inv="inv-1"):
    afs = [{"relacion": "apoya"} for _ in range(apoyos)] + [{"relacion": "contradice"} for _ in range(contras)] + [{"relacion": "socava"} for _ in range(socava)]
    h = {"id": id_, "investigacionId": inv, "titulo": titulo, "estado": estado, "afirmaciones": afs, "tarjeta": {}}
    if refuta:
        h["experimento"] = {"refuta": refuta}
    return h


def _e(*hipotesis):
    return {"hipotesis": list(hipotesis), "cuestiones": []}


def test_abre_la_cuestion_con_el_criterio_de_refutacion_dentro():
    e = _e(_h("h1", "SULF2 como barrera a la entrada de tau", 7, refuta="Una interacción de dirección opuesta con controles válidos"))
    assert _cuestiones_por_falta_de_contraste(e, "inv-1", 1000) == 1
    c = e["cuestiones"][0]
    assert "Ninguna fuente contradice" in c["texto"] and "7 afirmaciones a favor" in c["texto"]
    # Lo que la resolvería lleva el criterio concreto: es lo que el generador de
    # consultas lee para escribir la búsqueda (contexto.preguntas_abiertas).
    assert "Una interacción de dirección opuesta" in c["queLaResolveria"]
    assert c["hipotesisIds"] == ["h1"] and c["prioridad"] == 2


def test_una_sola_en_contra_o_que_socave_ya_basta():
    """Basta con que ROSA2018 haya encontrado algo que tire del otro lado: lo que
    la regla vigila es que no haya mirado, no que el resultado sea negativo."""
    assert _cuestiones_por_falta_de_contraste(_e(_h("h1", "T", 9, contras=1)), "inv-1", 1000) == 0
    assert _cuestiones_por_falta_de_contraste(_e(_h("h1", "T", 9, socava=1)), "inv-1", 1000) == 0


def test_con_pocos_apoyos_no_se_dice_nada():
    """Con uno o dos apoyos puede que no haya dado tiempo; el umbral es cuatro."""
    n = APOYOS_SIN_CONTRA_QUE_PREOCUPAN
    assert _cuestiones_por_falta_de_contraste(_e(_h("h1", "T", n - 1)), "inv-1", 1000) == 0
    assert _cuestiones_por_falta_de_contraste(_e(_h("h1", "T", n)), "inv-1", 1000) == 1


def test_no_mira_las_descartadas_ni_las_de_otra_investigacion():
    e = _e(_h("h1", "Descartada", 9, estado="descartada"), _h("h2", "Suspendida", 9, estado="suspendida"), _h("h3", "De otra", 9, inv="inv-2"))
    assert _cuestiones_por_falta_de_contraste(e, "inv-1", 1000) == 0


def test_no_la_repite_en_la_iteracion_siguiente():
    e = _e(_h("h1", "T", 7, refuta="lo contrario"))
    assert _cuestiones_por_falta_de_contraste(e, "inv-1", 1000) == 1
    assert _cuestiones_por_falta_de_contraste(e, "inv-1", 2000) == 0
    assert len([c for c in e["cuestiones"] if c["estado"] == "abierta"]) == 1


def test_primero_las_que_mas_apoyos_acumulan_y_con_tope():
    e = _e(*[_h(f"h{i}", f"Hipótesis {i}", 4 + i) for i in range(6)])
    n = _cuestiones_por_falta_de_contraste(e, "inv-1", 1000, maximo=2)
    assert n == 2
    # La de 9 apoyos antes que la de 8: cuanto más desequilibrada, más urgente.
    assert "Hipótesis 5" in e["cuestiones"][0]["texto"] and "Hipótesis 4" in e["cuestiones"][1]["texto"]


def test_sin_criterio_escrito_la_cuestion_sigue_siendo_util():
    e = _e(_h("h1", "T", 5))
    assert _cuestiones_por_falta_de_contraste(e, "inv-1", 1000) == 1
    assert "al resultado contrario o al efecto nulo" in e["cuestiones"][0]["queLaResolveria"]


def test_la_cuestion_llega_al_criterio_del_cribado():
    """El círculo se cierra: la cuestión entra en `preguntas_abiertas`, que es lo
    que ve el generador de consultas y el cribado. Si esto se rompe, la regla
    abre cuestiones que nadie lee."""
    from rosa.bucle import contexto as T

    e = _e(_h("h1", "SULF2", 7, refuta="una interacción de dirección opuesta"))
    _cuestiones_por_falta_de_contraste(e, "inv-1", 1000)
    texto = T.preguntas_abiertas([], "inv-1", "objetivo de prueba", cuestiones=e["cuestiones"])
    assert "Ninguna fuente contradice" in texto and "dirección opuesta" in texto


def test_no_toca_la_certeza():
    """Decir "no lo he buscado" no es decir "es falso": el techo GRADE de la
    hipótesis no cambia porque se abra la cuestión."""
    from rosa import certeza as C

    h = _h("h1", "T", 5)
    h["procedencia"] = {"fuentes": [{"id": "f1", "cohorte": "ADNI"}, {"id": "f2", "cohorte": "BIOCARD"}]}
    h["afirmaciones"] = [{"relacion": "apoya", "veredicto": "sostenida", "tipo": "dato", "clase": "literatura"} for _ in range(5)]
    antes = C.techo(h)
    e = {"hipotesis": [h], "cuestiones": []}
    _cuestiones_por_falta_de_contraste(e, "inv-1", 1000)
    assert C.techo(h) == antes


def test_cuenta_el_apoyo_indirecto_como_apoyo():
    assert _cuestiones_por_falta_de_contraste({"hipotesis": [{"id": "h1", "investigacionId": "inv-1", "titulo": "T", "estado": "propuesta", "afirmaciones": [{"relacion": "apoya_indirecta"} for _ in range(5)], "tarjeta": {}}], "cuestiones": []}, "inv-1", 1000) == 1


def test_no_se_rompe_con_cuestiones_que_no_son_listas():
    assert _cuestiones_por_falta_de_contraste({"hipotesis": [], "cuestiones": None}, "inv-1", 1000) == 0
    assert CU.abiertas({"cuestiones": None}, "inv-1") == []


def _dossier_con(afirmaciones):
    """Un dossier real desde la plantilla (misma base que test_dossier_alternativas)."""
    from rosa import dossier as D
    from rosa.estado import plantilla as P

    e = P.estado_inicial()
    inv = dict(e["investigaciones"][0]) if e.get("investigaciones") else {"id": "inv-1", "objetivo": "O", "limites": [], "condicionParada": ""}
    inv.setdefault("id", "inv-1")
    e["investigaciones"] = [inv]
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="SULF2 como barrera")
    h["afirmaciones"] = afirmaciones
    e["hipotesis"] = [h]
    return D.texto_dossier(e, h, inv, None, 1_790_700_000_000)


def _af(relacion, i=0):
    return {"veredicto": "sostenida", "tipo": "dato", "clase": "literatura", "relacion": relacion, "texto": f"afirmación {i}", "cita": "[Ref, pág. 1]", "motivo": "", "fragmento": ""}


def test_el_dossier_dice_la_balanza_en_la_primera_linea_de_la_evidencia():
    """El dossier de SULF2 que salió a revisión externa tenía 7 afirmaciones a
    favor y 0 en contra y no lo decía en ninguna parte."""
    t = _dossier_con([_af("apoya", i) for i in range(7)])
    assert "Balanza: 7 a favor y 0 en contra" in t
    assert "NINGUNA fuente la contradice" in t and "no es lo mismo que haber buscado" in t


def test_con_evidencia_en_contra_la_balanza_se_dice_sin_el_aviso():
    t = _dossier_con([_af("apoya", i) for i in range(5)] + [_af("contradice", 9)])
    assert "Balanza: 5 a favor y 1 en contra" in t
    assert "NINGUNA fuente la contradice" not in t


def test_con_pocos_apoyos_no_avisa_aunque_no_haya_contras():
    t = _dossier_con([_af("apoya", i) for i in range(2)])
    assert "Balanza: 2 a favor y 0 en contra" in t
    assert "NINGUNA fuente la contradice" not in t


def _con_conclusion(certeza, techo, factores, fuentes):
    from rosa import dossier as D
    from rosa.estado import plantilla as P

    e = P.estado_inicial()
    inv = dict(e["investigaciones"][0]) if e.get("investigaciones") else {"id": "inv-1", "objetivo": "O", "limites": [], "condicionParada": ""}
    inv.setdefault("id", "inv-1")
    e["investigaciones"] = [inv]
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="Duración conjunta GFAP-NfL")
    h["conclusion"] = {"certeza": certeza, "direccion": "apoya", "enunciado": "La evidencia sugiere que sí.", "techo": techo, "factores": factores}
    h["procedencia"]["fuentes"] = fuentes
    e["hipotesis"] = [h]
    return D.texto_dossier(e, h, inv, None, 1_790_700_000_000)


def test_el_dossier_dice_de_donde_sale_la_certeza():
    """GRADE, y la regla de este proyecto, piden los factores que suben o bajan
    la certeza A LA VISTA. El dossier decía "certeza baja" y punto, y había
    hipótesis cuyo techo es baja en vez de muy baja SOLO porque el juez marcó
    "efecto grande" sobre una única cohorte."""
    t = _con_conclusion(
        "baja",
        {"nivel": "baja", "motivo": "solo literatura de una sola cohorte, pero el juez documentó un efecto grande", "certezaDelJuez": "moderada"},
        [{"factor": "efecto_grande", "efecto": "sube"}, {"factor": "imprecision", "efecto": "baja"}],
        [{"id": "f1", "referencia": "R", "titulo": "T", "cohorte": "API Colombia"}],
    )
    assert "De dónde sale esa certeza: techo por regla baja" in t
    assert "el juez documentó un efecto grande" in t
    # Y que el techo mandó sobre el juez.
    assert "el juez había dicho moderada y manda el menor de los dos" in t
    assert "Factores GRADE que dejó el juez: bajan: imprecisión; suben: efecto grande" in t


def test_avisa_del_factor_que_la_estructura_desmiente():
    """«Replicación independiente» con una sola cohorte no es posible: replicar
    es que lo vea otra cohorte independiente. Pasa en la base (1 de 34)."""
    t = _con_conclusion(
        "baja",
        {"nivel": "baja", "motivo": "solo literatura de una sola cohorte", "certezaDelJuez": "baja"},
        [{"factor": "replicacion_independiente", "efecto": "sube"}],
        [{"id": "f1", "referencia": "R", "titulo": "T", "cohorte": "API Colombia"}],
    )
    assert "AVISO: el juez marcó «replicación independiente»" in t
    assert "una sola cohorte identificada (API Colombia)" in t
    assert "el factor no se sostiene sobre esta evidencia" in t


def test_con_dos_cohortes_la_replicacion_no_se_avisa():
    t = _con_conclusion(
        "baja",
        {"nivel": "baja", "motivo": "dos cohortes", "certezaDelJuez": "baja"},
        [{"factor": "replicacion_independiente", "efecto": "sube"}],
        [{"id": "f1", "referencia": "R1", "titulo": "T", "cohorte": "ADNI"}, {"id": "f2", "referencia": "R2", "titulo": "T", "cohorte": "BIOCARD"}],
    )
    assert "AVISO: el juez marcó" not in t
