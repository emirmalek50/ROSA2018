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


def _con_mapa(mapa: dict[str, str], fn: Any, clave: str = "raton") -> Any:
    """Corre `fn` con un mapa de transcritos de mentira para una especie."""
    antes = dict(E._MAPAS)
    por: dict[str, set[str]] = {}
    for t, g in mapa.items():
        por.setdefault(g, set()).add(t)
    E._MAPAS[clave] = (mapa, por)
    try:
        return fn()
    finally:
        E._MAPAS.clear()
        E._MAPAS.update(antes)


def test_el_nombre_en_raton_lleva_la_primera_en_mayuscula():
    # Es la convención: MAPT en persona es Mapt en ratón.
    assert E.nombres_posibles("MAPT")[0] == "Mapt"
    assert E.nombres_posibles("GFAP")[0] == "Gfap"
    # Y se prueban más formas, porque algunos conservan las mayúsculas.
    assert "C3" in E.nombres_posibles("C3")
    assert E.nombres_posibles("") == []


def test_encaje_perfecto_en_el_raton_es_la_misma_molecula():
    v = _con_mapa({"T1": "Mapt"}, lambda: E._veredicto("raton", "MAPT", [("T1", 0, [])]))
    assert v["sirve"] is True
    assert v["veredicto"] == "sirve tal cual"
    assert v["ortologo"] == "Mapt"
    assert "la misma molécula" in v["porQue"]


def test_un_fallo_en_el_HUECO_lo_invalida_y_en_las_ALAS_no():
    """La regla es la misma que la del cribado, usada al revés: la RNasa H1
    reconoce el hueco de ADN, así que es ahí donde tiene que encajar."""
    # En el ala: sigue sirviendo, con menos afinidad.
    v = _con_mapa({"T1": "Gfap"}, lambda: E._veredicto("raton", "GFAP", [("T1", 1, [2])]))
    assert v["sirve"] is True
    assert v["veredicto"] == "probablemente sirve, con menos fuerza"
    assert "más dosis" in v["porQue"]
    # La misma letra de fallo, pero dentro del hueco: ya no.
    v2 = _con_mapa({"T1": "Gfap"}, lambda: E._veredicto("raton", "GFAP", [("T1", 1, [10])]))
    assert v2["sirve"] is False
    assert v2["falloEnElHueco"] is True
    assert "oligo sustituto" in v2["porQue"]


def test_demasiados_fallos_en_las_alas_tampoco_valen():
    v = _con_mapa({"T1": "Atm"}, lambda: E._veredicto("raton", "ATM", [("T1", 4, [1, 2, 19, 20])]))
    assert v["sirve"] is False
    assert "demasiadas" in v["porQue"]


def test_sin_encaje_en_el_gen_de_la_especie_hace_falta_un_sustituto():
    v = _con_mapa({"T1": "Mapt"}, lambda: E._veredicto("raton", "MAPT", []))
    assert v["sirve"] is False
    assert v["veredicto"] == "no sirve"
    assert "oligo sustituto" in v["porQue"]


def test_no_encontrar_el_gen_equivalente_NO_es_que_no_sirva():
    """La regla de ROSA2018. Y pasa de verdad: CA2 en ratón se llama Car2, así
    que la heurística del nombre falla en 1 de las 17 dianas."""
    v = _con_mapa({"T1": "Car2"}, lambda: E._veredicto("raton", "CA2", [("T1", 0, [])]))
    assert v["veredicto"] == "no pude comprobar"
    assert v["sirve"] is None
    assert "NO quiere decir que el oligo no sirva" in v["porQue"]
    assert "a mano" in v["porQue"]


def test_se_queda_con_el_mejor_encaje_del_gen():
    # Si un transcrito encaja perfecto y otro con fallos, manda el perfecto.
    v = _con_mapa(
        {"T1": "App", "T2": "App"},
        lambda: E._veredicto("raton", "APP", [("T1", 2, [10, 11]), ("T2", 0, [])]),
    )
    assert v["sirve"] is True
    assert v["fallos"] == 0
    assert v["transcritosQueEncajan"] == 2


def test_la_regla_del_hueco_es_LA_MISMA_que_la_del_cribado():
    # Si en rosa/criba.py cambia dónde está el hueco, aquí cambia solo: son el
    # mismo mecanismo visto desde los dos lados.
    assert E.en_el_hueco is CRIBA.en_el_hueco
    assert (CRIBA.HUECO_DESDE, CRIBA.HUECO_HASTA) == (6, 15)


def test_sin_el_transcriptoma_de_una_especie_se_dice_y_no_se_finge():
    t = E.hay("raton")
    assert set(t) >= {"hay", "clave", "nombre", "de", "motivo"}
    if not t["hay"]:
        assert "no es lo mismo que decir que no sirve" in t["motivo"]


# ---------------------------------------------------------------------------
# El veredicto de conjunto: lo que piden los reguladores no son tres especies
# ---------------------------------------------------------------------------


def _esp(clave: str, papel: str, sirve: bool | None) -> dict[str, Any]:
    return {"clave": clave, "nombre": clave, "papel": papel, "sirve": sirve}


def test_un_roedor_y_el_no_roedor_son_el_paquete_completo():
    """Lo que piden ICH M3(R2) y la FDA son DOS especies, un roedor y un no
    roedor. No tres: ratón y rata son los dos roedores y hace falta uno."""
    v = E.juntar({
        "raton": _esp("raton", "roedor", True),
        "rata": _esp("rata", "roedor", False),
        "macaco": _esp("macaco", "no roedor", True),
    })
    assert v["veredicto"] == "paquete completo"
    assert v["tieneRoedor"] and v["tieneNoRoedor"]
    # Y con solo DOS de las tres, que es justo lo que se quería probar.
    assert v["cuantas"] == 2


def test_servir_en_los_dos_roedores_no_basta_sin_el_no_roedor():
    v = E.juntar({
        "raton": _esp("raton", "roedor", True),
        "rata": _esp("rata", "roedor", True),
        "macaco": _esp("macaco", "no roedor", False),
    })
    assert v["veredicto"] == "falta el no roedor"
    # Y se dice por qué el macaco importa el doble en el cerebro.
    assert "punción lumbar" in v["porQue"] or "la vía es la misma que en" in v["porQue"]


def test_el_macaco_solo_deja_el_roedor_sin_cubrir():
    v = E.juntar({
        "raton": _esp("raton", "roedor", False),
        "rata": _esp("rata", "roedor", False),
        "macaco": _esp("macaco", "no roedor", True),
    })
    assert v["veredicto"] == "falta el roedor"
    assert v["tieneNoRoedor"] and not v["tieneRoedor"]


def test_no_servir_en_ninguna_NO_es_un_muro():
    """Es lo normal, y la FDA acepta oligos sustitutos específicos de especie.
    Decirlo como si fuera el final del camino sería mentir."""
    v = E.juntar({
        "raton": _esp("raton", "roedor", False),
        "macaco": _esp("macaco", "no roedor", False),
    })
    assert v["veredicto"] == "hacen falta sustitutos"
    assert "no cierra el camino" in v["porQue"].lower() or "No cierra el camino" in v["porQue"]
    assert "sustituto" in v["porQue"]


def test_el_marco_regulatorio_viaja_con_el_veredicto():
    """Para que la pantalla no repita el mito de «tienen que ser las tres»."""
    v = E.juntar({"macaco": _esp("macaco", "no roedor", True)})
    m = v["marco"]
    assert "DOS especies" in m["queSePide"]
    assert "un roedor y un no roedor" in m["queSePide"]
    assert "macaco" in m["elNoRoedor"]
    # Y lo del cerebro, que es nuestro caso.
    assert "intratecal" in m["yEnElCerebro"]
    assert "sustituto" in m["siNoSirve"]


def test_las_tres_especies_tienen_su_papel_y_su_via():
    for clave, esp in E.ESPECIES.items():
        assert esp["papel"] in ("roedor", "no roedor"), clave
        assert esp["via"], clave
        assert esp["latin"] and esp["ensamblado"], clave
    # Dos roedores y un no roedor.
    papeles = [e["papel"] for e in E.ESPECIES.values()]
    assert papeles.count("roedor") == 2
    assert papeles.count("no roedor") == 1


def test_en_primates_el_gen_se_llama_como_en_persona():
    # En roedores la primera en mayúscula; en macaco suele conservarse.
    assert E.nombres_posibles("MAPT", "roedor")[0] == "Mapt"
    assert E.nombres_posibles("MAPT", "no roedor")[0] == "MAPT"
