from rosa import verificador as V

F = V.Fragmento
FRAGS = [
    F("f1", "Cohorte clínica, 2025", "pág. 7", "El cociente alcanzó una precisión de 0,91 (IC 95 % 0,86-0,95) en la cohorte FLENI, con el ensayo NCT01234567 como referencia.", "Resultados"),
    F("f2", "Cummings et al., 2026", "resumen", "En 2026 hay 138 fármacos en 182 ensayos; lecanemab y donanemab están aprobados.", ""),
]


def c(texto, cita, frag=None):
    return V.comprobar_determinista(texto, cita, frag, FRAGS, FRAGS)


def test_cifras_normalizadas_van_al_juez_como_pista():
    r = c("La precision fue 0.91.", "[Cohorte clinica, 2025, pág. 7]")
    assert r.necesita_juez and "0.91" in r.pistas
    assert c("La precision fue 0.91.", "[Cohorte clinica, 2025, pag. 7]").necesita_juez


def test_identificador_ausente_es_no_sostenida_sin_juez():
    r = c("El ensayo NCT99999999 sirvio de referencia.", "[Cohorte clinica, 2025, pág. 7]")
    assert r.veredicto == "no_sostenida" and not r.necesita_juez


def test_cita_que_no_resuelve_y_sin_cita():
    assert c("Hay 138 fármacos.", "[Cummings et al., 2026, pág. 3]").veredicto == "cita_no_resuelve"
    assert c("Hay 138 fármacos.", "").veredicto == "sin_cita"
    assert c("Hay 138 fármacos.", "[Cummings et al., 2026, resumen]", "texto que no esta").veredicto == "cita_no_resuelve"


def test_ausencia_refutada_y_honesta():
    assert c("No encuentro información sobre lecanemab en los documentos.", "").veredicto == "ausencia_refutada"
    assert c("No encuentro información sobre aducanumab en los documentos.", "").veredicto == "sostenida"
    assert c("No pude comprobar lo de lecanemab.", "").veredicto == "sostenida"
    assert c("No hay datos sobre GEN 1 pero la precisión fue 0,91.", "").veredicto == "sin_cita"


def test_normalizacion_y_fidelidad():
    assert V.normalizar_cifra("1.234,5") == V.normalizar_cifra("1,234.5") == "1234.5"
    assert V.fidelidad(["sostenida", "parcial", "sin_cita", "sostenida"]) == 2 / 3
    assert V.fidelidad(["sin_cita"]) is None
    assert V.bloquea("ausencia_refutada") and not V.bloquea("parcial")


def test_un_identificador_parecido_no_cuenta_como_el_mismo():
    """Hasta el 29 de septiembre de 2026 los identificadores se comparaban por
    subcadena en los dos sentidos, así que rs429358 "aparecía" en un pasaje que
    hablaba de rs4293588 (otra variante) y 10.1038/nature123 en uno que citaba
    10.1038/nature1234 (otro artículo). Sobre las 22 coincidencias reales de la
    base no había ni una que la regla laxa salvase: solo dejaba pasar el
    identificador equivocado, que es el fallo que el verificador existe para
    atrapar."""
    frags = [
        F("f1", "Genética, 2025", "pág. 4", "El alelo rs4293588 se asoció al riesgo (10.1038/nature1234).", "Resultados"),
    ]

    def d(texto):
        return V.comprobar_determinista(texto, "[Genética, 2025, pág. 4]", None, frags, frags)

    # Un SNP que se parece al del pasaje pero no es el del pasaje.
    r = d("El alelo rs429358 se asoció al riesgo.")
    assert r.veredicto == "no_sostenida" and "rs429358".upper() in r.motivo.upper()
    # Un DOI que es prefijo del del pasaje es OTRO artículo.
    assert d("Lo describe 10.1038/nature123.").veredicto == "no_sostenida"
    # El mismo sí pasa (no se ha roto la comprobación).
    assert d("El alelo rs4293588 se asoció al riesgo.").veredicto != "no_sostenida"


def test_el_doi_de_un_suplemento_del_mismo_trabajo_sigue_contando():
    """La única holgura que se mantiene: si el pasaje nombra 10.1234/abc.s001 y
    la afirmación cita 10.1234/abc, el pasaje nombra un componente del mismo
    trabajo. Al revés no, porque entonces la afirmación habla de un objeto que
    el pasaje no nombra."""
    frags = [F("f1", "Suplemento, 2025", "pág. 2", "Los datos están en 10.1234/abc.s001 junto al método.", "")]

    def d(texto):
        return V.comprobar_determinista(texto, "[Suplemento, 2025, pág. 2]", None, frags, frags)

    assert d("El método está en 10.1234/abc.").veredicto != "no_sostenida"
    frags2 = [F("f1", "Artículo, 2025", "pág. 2", "El artículo es 10.1234/abc.", "")]
    r = V.comprobar_determinista("Los datos crudos están en 10.1234/abc.s001.", "[Artículo, 2025, pág. 2]", None, frags2, frags2)
    assert r.veredicto == "no_sostenida"
