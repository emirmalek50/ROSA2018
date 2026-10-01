"""¿Sirve el mismo oligo en ratón? Porque primero se prueba ahí.

Lo que defienden estas pruebas: que la regla sea la del HUECO (la misma del
cribado, usada al revés), que «no pude comprobar» nunca se confunda con «no
sirve», y que el gen equivalente se busque de forma que la heurística del
nombre se vea.

No tocan el transcriptoma del ratón: son 156 MB que no están en el
repositorio. Se prueba la regla, que es lo que se puede romper sin darse
cuenta."""
from typing import Any

from rosa import criba as CRIBA
from rosa import especie as E


def _con_mapa(mapa: dict[str, str], fn: Any) -> Any:
    """Corre `fn` con un mapa de transcritos de ratón de mentira."""
    antes = (E._MAPA_CACHE, E._POR_SIMBOLO)
    por: dict[str, set[str]] = {}
    for t, g in mapa.items():
        por.setdefault(g, set()).add(t)
    E._MAPA_CACHE, E._POR_SIMBOLO = mapa, por
    try:
        return fn()
    finally:
        E._MAPA_CACHE, E._POR_SIMBOLO = antes


def test_el_nombre_en_raton_lleva_la_primera_en_mayuscula():
    # Es la convención: MAPT en persona es Mapt en ratón.
    assert E.nombres_en_raton("MAPT")[0] == "Mapt"
    assert E.nombres_en_raton("GFAP")[0] == "Gfap"
    # Y se prueban más formas, porque algunos conservan las mayúsculas.
    assert "C3" in E.nombres_en_raton("C3")
    assert E.nombres_en_raton("") == []


def test_encaje_perfecto_en_el_raton_es_la_misma_molecula():
    v = _con_mapa({"T1": "Mapt"}, lambda: E._veredicto("MAPT", [("T1", 0, [])]))
    assert v["sirve"] is True
    assert v["veredicto"] == "sirve tal cual"
    assert v["ortologo"] == "Mapt"
    assert "la misma molécula" in v["porQue"]


def test_un_fallo_en_el_HUECO_lo_invalida_y_en_las_ALAS_no():
    """La regla es la misma que la del cribado, usada al revés: la RNasa H1
    reconoce el hueco de ADN, así que es ahí donde tiene que encajar."""
    # En el ala: sigue sirviendo, con menos afinidad.
    v = _con_mapa({"T1": "Gfap"}, lambda: E._veredicto("GFAP", [("T1", 1, [2])]))
    assert v["sirve"] is True
    assert v["veredicto"] == "probablemente sirve, con menos fuerza"
    assert "más dosis" in v["porQue"]
    # La misma letra de fallo, pero dentro del hueco: ya no.
    v2 = _con_mapa({"T1": "Gfap"}, lambda: E._veredicto("GFAP", [("T1", 1, [10])]))
    assert v2["sirve"] is False
    assert v2["falloEnElHueco"] is True
    assert "oligo sustituto" in v2["porQue"]


def test_demasiados_fallos_en_las_alas_tampoco_valen():
    v = _con_mapa({"T1": "Atm"}, lambda: E._veredicto("ATM", [("T1", 4, [1, 2, 19, 20])]))
    assert v["sirve"] is False
    assert "demasiadas" in v["porQue"]


def test_sin_encaje_en_el_gen_del_raton_hace_falta_un_sustituto():
    v = _con_mapa({"T1": "Mapt"}, lambda: E._veredicto("MAPT", []))
    assert v["sirve"] is False
    assert v["veredicto"] == "no sirve en ratón"
    assert "ningún experimento con animales" in v["porQue"]


def test_no_encontrar_el_gen_equivalente_NO_es_que_no_sirva():
    """La regla de ROSA2018. Y pasa de verdad: CA2 en ratón se llama Car2, así
    que la heurística del nombre falla en 1 de las 17 dianas."""
    v = _con_mapa({"T1": "Car2"}, lambda: E._veredicto("CA2", [("T1", 0, [])]))
    assert v["veredicto"] == "no pude comprobar"
    assert v["sirve"] is None
    assert "NO quiere decir que el oligo no sirva" in v["porQue"]
    assert "a mano" in v["porQue"]


def test_se_queda_con_el_mejor_encaje_del_gen():
    # Si un transcrito encaja perfecto y otro con fallos, manda el perfecto.
    v = _con_mapa(
        {"T1": "App", "T2": "App"},
        lambda: E._veredicto("APP", [("T1", 2, [10, 11]), ("T2", 0, [])]),
    )
    assert v["sirve"] is True
    assert v["fallos"] == 0
    assert v["transcritosQueEncajan"] == 2


def test_la_regla_del_hueco_es_LA_MISMA_que_la_del_cribado():
    # Si en rosa/criba.py cambia dónde está el hueco, aquí cambia solo: son el
    # mismo mecanismo visto desde los dos lados.
    assert E.en_el_hueco is CRIBA.en_el_hueco
    assert (CRIBA.HUECO_DESDE, CRIBA.HUECO_HASTA) == (6, 15)


def test_sin_el_transcriptoma_del_raton_se_dice_y_no_se_finge():
    t = E.hay_raton()
    assert set(t) >= {"hay", "ficheros", "de", "motivo"}
    if not t["hay"]:
        assert "no es lo mismo que decir que no sirve" in t["motivo"]
