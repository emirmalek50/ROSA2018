"""El torneo a ciegas y la solidez eliminatoria (arnés de Yoon y otros, 2026).

Tres cosas se comprueban aquí, y la tercera es la que duele: que la tarjeta que ve
el juez no lleva nada que identifique a la hipótesis ni le diga lo que otros ya
dictaminaron; que una hipótesis cuya evidencia no la sostiene pierde el partido
por regla y SIN llamar al juez; y que ninguna de las dos cosas rompe la regla de
la casa de que "no pude comprobar" nunca es "no hay". Sin red ni modelos.

De Yoon se toman la rejilla completa (cada par una vez), el ciego y la pérdida
automática por solidez. NO se toma la rúbrica del 1 al 5 con pesos: las 20
conversaciones de Claude Science midieron 0,03 de correlación de Spearman entre
dos rondas de repuntuación a ciegas de lo mismo (TRASPASO.md).
"""

from typing import Any

from rosa import politicas, solidez, torneo
from rosa.bucle import contexto as T
from rosa.bucle import pasos as PASOS


def _h(i: int, **campos: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": f"h{i}",
        "titulo": f"Título inconfundible número {i}",
        "enunciado": f"El marcador M{i} sube antes que el marcador N en portadores",
        "mecanismo": f"Mecanismo {i}",
        "comprobacion": {"biomarcador": f"M{i}", "cohorte": "ADNI", "diseno": "longitudinal"},
        "cluster": f"Cluster secreto {i}",
        "estado": "propuesta",
        "investigacionId": "inv",
        "elo": 1500,
        "historialElo": [],
        "rivales": [],
        "partidos": [],
        "afirmaciones": [{"veredicto": "sostenida", "texto": f"Afirmación de {i}", "cita": "A, pág. 3"}],
        "supuestos": [],
        "procedencia": {"fuentes": []},
        "revisionesAutomaticas": [{"tipo": "torneo", "estado": "pendiente", "resumen": "", "fecha": None}, {"tipo": "killer", "estado": "hecha", "resumen": "El Killer dice descartar", "fecha": 1}],
        "revisiones": [],
        "revisionesHumanas": [],
        "relevancia": {"justificacion": "x", "votoHumano": None},
        "decisionKiller": None,
    }
    d.update(campos)
    return d


def _estado(*hs: dict[str, Any]) -> dict[str, Any]:
    return {"hipotesis": list(hs), "investigaciones": [{"id": "inv", "datasets": []}], "planesAnalisis": [], "ejecuciones": [], "artefactos": [], "iteraciones": []}


# -- La tarjeta a ciegas ---------------------------------------------------------


def test_la_tarjeta_del_torneo_no_lleva_nada_que_identifique_ni_prejuzgue():
    h = _h(1, cluster="Astrocitos", decisionKiller="descartar_en_contexto")
    h["partidos"] = [{"iteracion": 2, "rivalId": "h9", "resultado": "gano", "resumenDebate": "ganó a la de NfL", "ejeDecisivo": "utilidad"}]
    tarjeta = PASOS.hipotesis_para_torneo(h)
    # Nada de lo que la nombra ni de lo que otros dijeron de ella.
    for prohibido in ("Título inconfundible", "Cluster", "Astrocitos", "Revisiones automáticas", "descartar", "Killer", "ganó"):
        assert prohibido not in tarjeta, f"la tarjeta ciega filtra «{prohibido}»"
    # Lo que sí lleva: con qué se juzga.
    assert "El marcador M1 sube antes" in tarjeta and "Mecanismo 1" in tarjeta and "biomarcador M1" in tarjeta
    assert "Afirmación de 1" in tarjeta and "A, pág. 3" in tarjeta
    assert tarjeta.startswith("Candidata (anónima)")
    assert PASOS.hipotesis_para_torneo(h, etiqueta="Candidata B").startswith("Candidata B (anónima)")


def test_la_ficha_completa_del_meta_revisor_sigue_viendo_lo_que_el_torneo_ya_no_ve():
    """`contexto.hipotesis_con_revisiones` NO es la tarjeta del torneo: alimenta el
    panorama de MetaRevisar, que razona sobre la cartera entera y ahí el veredicto
    del Killer y el linaje sí hacen falta. Cegarla por error sería el fallo."""
    h = _h(1)
    ficha = T.hipotesis_con_revisiones(h)
    assert "Título inconfundible" in ficha and "Cluster" in ficha and "Revisiones automáticas" in ficha
    assert not hasattr(T, "hipotesis_para_torneo"), "el duplicado antiguo se renombró para que nadie desciegue el torneo"


def test_el_resumen_del_partido_no_deja_el_titulo_del_rival_en_la_ficha():
    a, b = _h(1), _h(2)
    torneo.registrar_partido(a, b, True, 4, "debate", "utilidad", relacion="distintas")
    resumen = next(r["resumen"] for r in a["revisionesAutomaticas"] if r["tipo"] == "torneo")
    assert "Título inconfundible número 2" not in resumen and "ganó" in resumen


# -- Quién cuenta como persona ---------------------------------------------------


def test_una_revision_de_modelo_no_llega_al_juez_como_lo_que_dijo_una_persona():
    h = _h(1, revisiones=[
        {"quien": "openai/anthropic/claude-opus-5", "nota": "El Killer sugiere descartarla", "accion": "killer"},
        {"quien": "openai/openai/gpt-6-astra", "nota": "Reformulada por falsabilidad", "accion": "reformulada"},
        {"quien": "claude-sonnet-5.5", "nota": "Interpretación automática nueva", "accion": "x"},
        {"quien": "claude-sonnet-5", "nota": "Interpretación automática anterior", "accion": "x"},
        {"quien": "Rosa", "nota": "nota propia", "accion": "x"},
        {"quien": "Dra. Pérez", "nota": "La cohorte no vale: son todos hombres", "accion": "suspendida"},
    ])
    texto = T.revisiones_humanas(h)
    assert "Dra. Pérez" in texto and "son todos hombres" in texto
    for fantasma in ("claude-opus-5", "gpt-6-astra", "claude-sonnet-5.5", "claude-sonnet-5", "Killer", "Rosa", "Interpretación automática"):
        assert fantasma not in texto, f"«{fantasma}» no es una persona"
    assert T.revisiones_humanas(_h(2)) == "Ninguna."


# -- La solidez eliminatoria -----------------------------------------------------


def test_sin_verificar_y_el_killer_todavia_sin_juzgar_no_descalifican():
    """La regla de la casa: una fuente que no respondió es "no pude comprobar",
    nunca "no hay". Una hipótesis sin verificar se juega como cualquier otra."""
    h = _h(1, afirmaciones=[{"veredicto": "sin_verificar", "texto": "x", "cita": "c"}], decisionKiller=None)
    assert solidez.motivos(_estado(h), h) == []
    for no_descalifica in ("suspender", "reformular", None):
        assert solidez.motivos(_estado(h), _h(2, decisionKiller=no_descalifica)) == []


def test_las_puertas_de_proceso_no_descalifican_o_el_torneo_entero_queda_en_tablas():
    """`sin_experimento_interpretable`, `revision_registro_abierta` y
    `dependencia_pendiente` son bloqueos temporales de proceso, y hoy los tiene el
    100 % de las hipótesis de la investigación en curso."""
    h = _h(1, pendienteRevision=True)
    e = _estado(h)
    from rosa import priorizacion

    bloqueos = priorizacion.bloqueos_de(e, h)
    assert "sin_experimento_interpretable" in bloqueos and "dependencia_pendiente" in bloqueos
    assert solidez.motivos(e, h) == [], "un bloqueo de proceso no quita solidez"


def test_lo_que_si_descalifica_y_lo_dice_en_castellano():
    descartada = _h(1, decisionKiller="descartar_en_contexto")
    assert solidez.motivos(_estado(descartada), descartada) == ["el Killer la descartó en contexto"]
    mala = _h(2, afirmaciones=[{"veredicto": "no_sostenida", "texto": "x", "cita": "c"}, {"veredicto": "sostenida", "texto": "y", "cita": "c"}, {"veredicto": "cita_no_resuelve", "texto": "z", "cita": "c"}])
    m = solidez.motivos(_estado(mala), mala)
    assert m == ["2 de sus 3 afirmaciones no se sostienen (1 cuya cita no resuelve al pasaje, 1 que su fuente no sostiene)"]
    retractada = _h(3)
    retractada["procedencia"]["fuentes"] = [{"id": "f", "retraccion": "retractado"}]
    assert solidez.motivos(_estado(retractada), retractada) == ["1 de las fuentes que la sostienen está retractada"]


def test_la_solidez_aguanta_un_registro_roto_sin_tumbar_el_torneo():
    for basura in ({"afirmaciones": "no es lista"}, {"procedencia": "texto"}, {"afirmaciones": [None, "x"]}, {}):
        h = _h(1, **basura)
        assert isinstance(solidez.motivos({"hipotesis": [h]}, h), list)


# -- La ronda: qué va al juez y qué no -------------------------------------------


def test_el_partido_de_una_descalificada_se_resuelve_sin_llamar_al_juez():
    limpia, fuera = _h(1), _h(2, decisionKiller="descartar_en_contexto")
    e = _estado(limpia, fuera)
    r = PASOS.pares_del_torneo([limpia, fuera], [], 1, e=e)
    assert r.pares == [], "no hay nada que juzgar: una de las dos está descalificada"
    assert len(r.por_regla) == 1
    a, b, ma, mb = r.por_regla[0]
    ganadora_es_la_limpia = (a["id"] == "h1" and not ma) or (b["id"] == "h1" and not mb)
    assert ganadora_es_la_limpia and (ma or mb)


def test_si_las_dos_estan_descalificadas_son_tablas_y_tampoco_se_llama_al_juez():
    a, b = _h(1, decisionKiller="descartar_en_contexto"), _h(2, decisionKiller="descartar_en_contexto")
    r = PASOS.pares_del_torneo([a, b], [], 1, e=_estado(a, b))
    assert r.pares == [] and len(r.por_regla) == 1
    _, _, ma, mb = r.por_regla[0]
    assert ma and mb, "las dos tienen motivo: tablas por regla"


def test_sin_estado_no_hay_descalificacion_y_todo_va_al_juez():
    """`pares_del_torneo` sin `e` (quien llama no lo tiene) no descalifica a nadie:
    la regla necesita el estado para recalcular los bloqueos y no se inventa nada."""
    a, b = _h(1, decisionKiller="descartar_en_contexto"), _h(2)
    r = PASOS.pares_del_torneo([a, b], [], 1)
    assert len(r.pares) == 1 and r.por_regla == []


def test_la_rejilla_no_pasa_del_tope_de_partidos_con_juez_y_dice_cuantos_aplaza():
    hs = [_h(i, elo=1500 + i * 40) for i in range(8)]
    e = _estado(*hs)
    r = PASOS.pares_del_torneo(hs, [], 1, maximo=politicas.MAX_PARTIDOS_CON_JUEZ_POR_ITERACION, e=e)
    assert len(r.pares) == politicas.MAX_PARTIDOS_CON_JUEZ_POR_ITERACION
    # Los 28 pares de 8 hipótesis menos los que caben: lo que no cabe se dice.
    assert r.aplazados == 28 - politicas.MAX_PARTIDOS_CON_JUEZ_POR_ITERACION
    assert len({frozenset((x["id"], y["id"])) for x, y in r.pares}) == len(r.pares), "ningún par dos veces en la misma ronda"


def test_un_par_forzado_por_redundancia_se_dirime_una_vez_y_no_se_fuerza_mas():
    a, b = _h(1), _h(2)
    # Ya jugaron antes de que el Killer los marcara redundantes, y el juez dijo
    # "distintas": eso NO cuenta como dirimente (se preguntó por otra cosa).
    torneo.registrar_partido(a, b, True, 1, "debate", "utilidad", relacion="distintas")
    assert not PASOS._ya_dirimido(a, "h2")
    # El dirimente lo marca `_torneo` al jugar el par forzado, con una clave privada.
    a["_dirimidoCon"] = ["h2"]
    assert PASOS._ya_dirimido(a, "h2")
    # Y una relación de verdad (no "distintas") también lo cierra: solo la pudo
    # escribir un dirimente anterior.
    c, d = _h(3), _h(4)
    torneo.registrar_partido(c, d, True, 1, "debate", "novedad", relacion="a_subsume_b")
    assert PASOS._ya_dirimido(c, "h4")


def test_la_clave_del_dirimente_es_privada_y_no_viaja_al_navegador():
    assert PASOS._ya_dirimido({"_dirimidoCon": ["x"]}, "x")
    # La regla de la casa: lo que empieza por "_" no sale al cliente.
    assert "_dirimidoCon".startswith("_") and "_huellaPropia".startswith("_")


# -- La migración: las conclusiones ya escritas se rehacen, y se dice por qué ----


def test_la_migracion_marca_para_rehacer_las_conclusiones_que_contaron_mal_quien_reviso():
    from rosa.bucle.corrida import motivo_para_reconcluir
    from rosa.estado.almacen import _migrar_revisiones_de_modelo_como_humanas

    concl = {"huella": "loquesea", "iteracion": 3, "certeza": "baja"}
    con_killer = _h(1, conclusion=dict(concl), revisiones=[{"quien": "openai/anthropic/claude-opus-5", "nota": "descartar", "accion": "killer"}], _conclusionIntentada=3)
    con_persona = _h(2, conclusion=dict(concl), revisiones=[{"quien": "Dra. Pérez", "nota": "la cohorte no vale", "accion": "suspendida"}], _conclusionIntentada=3)
    solo_rosa = _h(3, conclusion=dict(concl), revisiones=[{"quien": "Rosa", "nota": "nota propia", "accion": "x"}], _conclusionIntentada=3)
    sin_conclusion = _h(4, revisiones=[{"quien": "openai/anthropic/claude-opus-5", "nota": "descartar", "accion": "killer"}])
    e = {"hipotesis": [con_killer, con_persona, solo_rosa, sin_conclusion, None, "roto"]}
    _migrar_revisiones_de_modelo_como_humanas(e)
    assert con_killer.get("_reconcluirPorRevisiones") is True
    assert "_reconcluirPorRevisiones" not in con_persona, "una revisión de persona sí era de persona"
    assert "_reconcluirPorRevisiones" not in solo_rosa, "ROSA2018 firmando no era una persona ni antes ni ahora"
    assert "_reconcluirPorRevisiones" not in sin_conclusion, "sin conclusión previa ya se rehace por otro motivo"
    # El motivo que ve la persona dice la verdad: la evidencia no cambió.
    assert motivo_para_reconcluir(con_killer) == "se escribió contando revisiones de modelo como si fueran de personas"
    assert motivo_para_reconcluir(con_persona) == "la evidencia contada cambió"
    antes = repr(e)
    _migrar_revisiones_de_modelo_como_humanas(e)
    assert repr(e) == antes, "idempotente"
