"""El reparto por iteración se amplía solo mientras la corrida tenga tope
(28 de septiembre de 2026).

El tope de una iteración lo estima el planificador; el que pone una persona es
el de la corrida. Cuando la estimación se quedaba corta, la corrida se paraba y
pedía que alguien ampliara el tope: la corrida 1 del 28 de septiembre se paró a
las 17:00 con 1.535 llamadas todavía disponibles en su propio tope. Emir: "Rosa
nunca puede terminar en error y quedarse esperando que alguien toque un botón...
debería poder investigar por un minuto o por una semana sin interrupciones".

Lo que estos tests sujetan es tanto lo que ahora NO para (el reparto del plan)
como lo que SÍ tiene que seguir parando: el tope de la corrida, un permiso que
una persona denegó, y la autonomía de gasto puesta en "preguntar".
"""

from __future__ import annotations

from rosa.bucle import corrida as CO
from rosa.tests.test_integracion_corrida import _preparar


def _corrida(al, ids):
    return next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])


def _iteracion(al, ids):
    return next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])


def _preparar_topes(al, ids, *, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200, denegado=False, autonomia="actuar"):
    """La corrida en marcha con el reparto de la iteración agotado y el tope de
    la corrida con o sin holgura."""

    def fn(e):
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["estado"] = "en_marcha"
        c["presupuesto"]["limiteLlamadas"] = corrida_limite
        c["gasto"]["llamadas"] = corrida_gasto
        c["iteracionActual"] = 1
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["numero"] = 1
        it["terminadaEn"] = None
        it["presupuesto"] = {"limite": it_limite, "usado": it_usado, "reservaCierre": 5}
        if denegado:
            it["_presupuestoDenegado"] = True
        e["autonomia"]["gastar_grande"] = autonomia
        return True

    al.mutar(fn, "preparar_topes")


def _pausar(al, ids):
    return al.mutar(lambda e: CO._pausar_por_presupuesto(e, ids["cor"]), "pausa")


def test_el_reparto_de_la_iteracion_se_amplia_solo_y_la_corrida_no_se_para():
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200)
    assert _pausar(al, ids) is not False
    c, it = _corrida(al, ids), _iteracion(al, ids)
    # No se pausó: sigue en marcha y el reparto llega hasta donde llega la corrida.
    assert c["estado"] == "en_marcha"
    assert it["presupuesto"]["limite"] == 900  # 200 usadas + las 700 que le quedan a la corrida
    assert it["presupuesto"]["ampliadoSolo"] == 1
    assert CO.tope_agotado_en(al.estado, ids["cor"], 1) is None  # ya puede seguir llamando
    ev = al.estado["eventos"][-1]
    assert ev["tipo"] == "presupuesto" and "se amplió sola" in ev["texto"] and "sin esperar a nadie" in ev["texto"]
    assert "Amplía el tope" not in ev["texto"]
    al.cerrar()


def test_cuando_se_acaba_el_tope_de_la_corrida_si_se_para():
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=500, corrida_gasto=500, it_limite=200, it_usado=200)
    assert _pausar(al, ids) is not False
    c, it = _corrida(al, ids), _iteracion(al, ids)
    assert c["estado"] == "pausada_por_presupuesto"
    assert "ampliadoSolo" not in it["presupuesto"] and it["presupuesto"]["limite"] == 200
    assert "Amplía el tope" in c["presupuesto"]["motivoPausa"]
    al.cerrar()


def test_un_permiso_denegado_por_una_persona_sigue_parando_la_corrida():
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200, denegado=True)
    assert _pausar(al, ids) is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    assert "ampliadoSolo" not in _iteracion(al, ids)["presupuesto"]
    al.cerrar()


def test_con_la_autonomia_en_preguntar_no_se_amplia_sola():
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200, autonomia="preguntar")
    assert _pausar(al, ids) is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    assert "ampliadoSolo" not in _iteracion(al, ids)["presupuesto"]
    al.cerrar()


def test_si_lo_que_se_agoto_no_fue_el_reparto_no_se_toca_nada():
    """El reparto tiene holgura y la pausa viene de otra cosa (el cierre, que
    pre-pausa con su propio motivo): no se amplía nada."""
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=500, it_usado=100)
    assert _pausar(al, ids) is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    assert _iteracion(al, ids)["presupuesto"]["limite"] == 500 and "ampliadoSolo" not in _iteracion(al, ids)["presupuesto"]
    al.cerrar()


def test_ampliar_dos_veces_no_pasa_del_tope_de_la_corrida():
    """Se amplía cuantas veces haga falta, pero nunca por encima de la corrida:
    la segunda vez, ya sin holgura, para de verdad."""
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200)
    _pausar(al, ids)
    assert _iteracion(al, ids)["presupuesto"]["limite"] == 900
    # La corrida gasta todo lo que le quedaba y el reparto se vuelve a agotar.
    al.mutar(lambda e: (_corrida(al, ids)["gasto"].__setitem__("llamadas", 1000), _iteracion(al, ids)["presupuesto"].__setitem__("usado", 900)) and True, "gastar")
    assert _pausar(al, ids) is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    assert _iteracion(al, ids)["presupuesto"]["limite"] == 900  # no subió más
    al.cerrar()


def test_una_corrida_sin_iteracion_abierta_se_pausa_como_siempre():
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200)
    al.mutar(lambda e: _iteracion(al, ids).__setitem__("terminadaEn", 1) or True, "cerrar_it")
    assert _pausar(al, ids) is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    al.cerrar()


def test_un_reparto_con_un_limite_raro_no_rompe_la_pausa():
    for malo in (None, "muchas", True, [1]):
        al, ids = _preparar()
        _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300)
        al.mutar(lambda e, malo=malo: _iteracion(al, ids)["presupuesto"].__setitem__("limite", malo) or True, "limite_raro")
        assert _pausar(al, ids) is not False, f"limite {malo!r}"
        assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto", f"limite {malo!r}"
        al.cerrar()


def test_la_pre_pausa_del_cierre_manda_y_no_se_amplia_por_encima():
    """S-14: cuando el cierre no cabe en lo que le queda a la CORRIDA, esa pausa
    llega con su propio motivo y manda. Ampliar el reparto de la iteración no
    añadiría ni una llamada; solo dejaría que el cierre se comiera el resto del
    tope a medias y muriera igual."""
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=990, it_limite=200, it_usado=200)
    motivo = "El cierre de la iteración 1 necesita unas 60 llamadas y a la corrida le quedan 10."
    assert al.mutar(lambda e: CO._pausar_por_presupuesto(e, ids["cor"], motivo=motivo), "pausa") is not False
    c, it = _corrida(al, ids), _iteracion(al, ids)
    assert c["estado"] == "pausada_por_presupuesto"
    assert c["presupuesto"]["motivoPausa"] == motivo
    assert "ampliadoSolo" not in it["presupuesto"] and it["presupuesto"]["limite"] == 200
    al.cerrar()


def test_el_tope_que_salta_dentro_del_cierre_si_amplia_y_el_cierre_se_retoma():
    """El otro camino del cierre (`detalle`) es el contrario: el cierre ya empezó
    y se quedó sin reparto con la corrida entera por delante. Ahí sí se amplía,
    y el tick lo retoma leyendo `it._cierre` sin repagar lo ya calculado."""
    al, ids = _preparar()
    _preparar_topes(al, ids, corrida_limite=1000, corrida_gasto=300, it_limite=200, it_usado=200)
    assert al.mutar(lambda e: CO._pausar_por_presupuesto(e, ids["cor"], detalle="Le faltan unas 12 llamadas."), "pausa") is not False
    c, it = _corrida(al, ids), _iteracion(al, ids)
    assert c["estado"] == "en_marcha"
    assert it["presupuesto"]["limite"] == 900 and it["presupuesto"]["ampliadoSolo"] == 1
    al.cerrar()
