"""La cola de triaje: un paso que ve algo raro puede pedir trabajo, y la cola lo
acepta o lo rechaza SIEMPRE con motivo escrito (rosa/tareas.py).

Del arnés de Yoon y otros (2026): 98 de sus 119 tareas las abrieron los propios
agentes, y el descubrimiento que el artículo destaca salió de una tarea que un
worker abrió después de rechazar lo que investigaba. En ROSA2018 el plan lo
escribía el cerebro al empezar y se congelaba: 50 iteraciones con planes de 6 o 7
pasos y siempre los mismos seis tipos.

Lo que se comprueba aquí es lo que la cola NO puede hacer: rechazar sin decir por
qué, duplicar lo mismo, resucitar lo ya rechazado, crecer sin tope, perder una
tarea en silencio, o dejar que el planificador la entierre. Sin red ni modelos.
"""

from typing import Any

from rosa import politicas
from rosa import tareas as TA
from rosa.estado import acciones as A


def _e(**extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"tareas": [], "lecciones": [], "investigaciones": [{"id": "inv", "datasets": []}], "hipotesis": [], "eventos": []}
    base.update(extra)
    return base


def _t(que_vio: str = "GWAS Catalog devolvió 0 para APOE con el filtro puesto", que_haria: str = "Repetir la consulta con el parámetro mapped_gene y comprobar el recuento", herramienta: str = "literatura", **k: Any) -> dict[str, Any]:
    return TA.nueva("inv", que_vio, que_haria, "Decide si la novedad genética de tres hipótesis es un cero real", herramienta, {"tipo": "paso", "pasoId": "p1", "iteracion": 3}, 1000, **k)


# -- El rechazo siempre lleva motivo ---------------------------------------------


def test_toda_salida_del_triaje_trae_un_motivo_escrito():
    """Es la mitad del valor de la cola de Yoon: una cola que rechaza sin decir por
    qué es una papelera."""
    casos = [
        _t(que_haria=""),
        _t(que_vio=""),
        _t(herramienta="mandar_un_correo"),
        _t(herramienta="analisis"),
        _t(),
    ]
    for t in casos:
        estado, motivo = TA.triar(_e(), t, 1000)
        assert estado in TA.ESTADOS + ("fusionada",)
        assert motivo.strip(), f"sin motivo: {t['queHaria']!r}"
        assert len(motivo) > 20, f"motivo demasiado corto para entenderse: {motivo!r}"


def test_sin_que_haria_se_rechaza_sola_porque_no_es_trabajo():
    estado, motivo = TA.triar(_e(), _t(que_haria="   "), 1000)
    assert estado == "rechazada" and "no dice qué haría" in motivo


def test_sin_que_vio_tampoco_porque_no_se_puede_juzgar():
    estado, motivo = TA.triar(_e(), _t(que_vio=""), 1000)
    assert estado == "rechazada" and "no dice qué vio" in motivo


def test_una_herramienta_que_rosa2018_no_tiene_se_rechaza_nombrando_las_que_hay():
    estado, motivo = TA.triar(_e(), _t(herramienta="contactar_laboratorio"), 1000)
    assert estado == "rechazada" and "contactar_laboratorio" in motivo and "literatura" in motivo


def test_las_herramientas_de_una_tarea_son_las_nueve_que_existen_y_ninguna_toca_el_mundo():
    from rosa.bucle import pasos as PASOS

    assert set(TA.HERRAMIENTAS) == set(PASOS.EJECUTORES), "una tarea no puede pedir algo que no existe"
    assert "contactar_laboratorio" not in TA.HERRAMIENTAS, "la cola no sube el nivel de autonomía de ROSA2018"


def test_un_analisis_sin_dataset_aprobado_se_rechaza_con_el_motivo_concreto():
    estado, motivo = TA.triar(_e(), _t(herramienta="analisis"), 1000)
    assert estado == "rechazada" and "ningún dataset aprobado con fichero" in motivo
    # Con dataset aprobado, pasa.
    e = _e(investigaciones=[{"id": "inv", "datasets": [{"estado": "aprobado", "procedencia": {"hash": "abc"}}]}])
    assert TA.triar(e, _t(herramienta="analisis"), 1000)[0] == "aceptada"


# -- No se duplica ni se resucita -------------------------------------------------


def test_dos_pasos_que_ven_lo_mismo_se_funden_y_suben_el_recuento():
    e = _e()
    TA.registrar_con_motivo(e, _t(), 1000)
    estado, motivo = TA.registrar_con_motivo(e, _t(que_vio="GWAS Catalog devolvió 0 para APOE con el filtro puesto"), 2000)
    assert estado == "fusionada" and "dice lo mismo" in motivo
    assert len(e["tareas"]) == 1 and e["tareas"][0]["veces"] == 2
    assert e["tareas"][0]["historial"][-1]["motivo"].startswith("otro paso vio lo mismo")


def test_lo_ya_rechazado_no_vuelve_y_se_cita_la_vez_anterior():
    e = _e()
    TA.registrar_con_motivo(e, _t(herramienta="inventada"), 1000)
    assert e["tareas"][0]["estado"] == "rechazada"
    estado, motivo = TA.triar(e, _t(), 2000)
    assert estado == "rechazada" and "ya se propuso y quedó rechazada" in motivo


def test_una_tarea_que_choca_con_una_leccion_se_rechaza_citando_la_leccion():
    """Es el "do not re-mine" que ya funciona: las lecciones se generan por regla al
    cerrar y entran en los prompts de la iteración siguiente."""
    e = _e(lecciones=[{"id": "lec-1", "investigacionId": "inv", "ambito": "consultas", "texto": "GWAS Catalog devolvió 0 para APOE con el filtro puesto: repetir la consulta con mapped_gene y comprobar el recuento"}])
    estado, motivo = TA.triar(e, _t(), 1000)
    assert estado == "rechazada" and "lec-1" in motivo and "choca con una lección" in motivo


def test_la_pregunta_al_reves_no_es_la_misma_tarea():
    """Se reutiliza `cuestiones.equivalencia`, que ya distingue el orden."""
    e = _e()
    TA.registrar_con_motivo(e, _t(que_vio="GFAP sube antes que NfL en la cohorte", que_haria="Comprobar si GFAP sube antes que NfL en otra cohorte"), 1000)
    estado, _ = TA.triar(e, _t(que_vio="NfL sube antes que GFAP en la cohorte", que_haria="Comprobar si NfL sube antes que GFAP en otra cohorte"), 2000)
    assert estado == "aceptada", "dicen lo contrario: no son la misma tarea"


# -- Los topes -------------------------------------------------------------------


def test_la_cola_llena_rechaza_y_lo_dice():
    e = _e()
    for i in range(politicas.MAX_TAREAS_EN_COLA):
        TA.registrar_con_motivo(e, _t(que_vio=f"cosa distinta número {i} sobre el marcador M{i}", que_haria=f"comprobar el marcador M{i} en otra cohorte con datos seriados"), 1000)
    assert len(TA.aceptadas(e, "inv")) == politicas.MAX_TAREAS_EN_COLA
    estado, motivo = TA.triar(e, _t(que_vio="otra cosa nueva del todo", que_haria="mirar otra base distinta a las de antes"), 2000)
    assert estado == "rechazada" and "la cola está llena" in motivo


def test_el_tope_por_iteracion_rechaza_diciendo_cuantas_van():
    estado, motivo = TA.triar(_e(), _t(), 1000, aceptadas_ya=politicas.MAX_TAREAS_ACEPTADAS_POR_ITERACION)
    assert estado == "rechazada" and "que es el tope" in motivo


def test_lo_que_mas_veces_se_pidio_va_primero_en_el_prompt_del_plan():
    e = _e()
    TA.registrar_con_motivo(e, _t(que_vio="lo primero que se vio del marcador A", que_haria="comprobar el marcador A en otra cohorte"), 1000)
    TA.registrar_con_motivo(e, _t(que_vio="lo segundo que se vio del marcador B", que_haria="comprobar el marcador B en otra cohorte"), 2000)
    TA.registrar_con_motivo(e, _t(que_vio="lo segundo que se vio del marcador B", que_haria="comprobar el marcador B en otra cohorte"), 3000)
    texto = TA.texto_para_plan(e, "inv")
    assert texto.index("marcador B") < texto.index("marcador A")
    assert "pedida 2 veces" in texto


def test_el_texto_para_el_plan_dice_quien_la_abrio_y_con_que_herramienta():
    e = _e()
    TA.registrar_con_motivo(e, _t(), 1000)
    texto = TA.texto_para_plan(e, "inv")
    assert "(literatura, la abrió un paso de la iteración 3)" in texto
    assert "Vio:" in texto and "Haría:" in texto and "Importa porque:" in texto
    assert TA.texto_para_plan(_e(), "inv") == "Ninguna."


# -- Nada se pierde en silencio ---------------------------------------------------


def test_una_tarea_que_nadie_programa_caduca_con_su_motivo_y_no_se_fuerza_en_el_plan():
    """La tarea forzada por regla se dejó fuera a propósito: podía costar hasta 90
    llamadas y el mismo efecto sale gratis, porque el planificador tiene que
    explicar por escrito cada tarea que deja fuera."""
    assert not hasattr(politicas, "MAX_TAREAS_FORZADAS_POR_ITERACION")
    e = _e()
    TA.registrar_con_motivo(e, _t(), 1000)
    tid = e["tareas"][0]["id"]
    assert TA.caducar_viejas(e, "inv", 4, 2000) == 0, "todavía dentro de la paciencia"
    assert TA.caducar_viejas(e, "inv", 3 + politicas.ITERACIONES_MAX_EN_COLA + 1, 3000) == 1
    t = next(x for x in e["tareas"] if x["id"] == tid)
    assert t["estado"] == "caducada" and "sin que ningún plan la programara" in t["motivo"]
    assert t["historial"][-1]["estado"] == "caducada"


def test_cada_cambio_de_estado_queda_en_el_historial_con_su_motivo():
    e = _e()
    TA.registrar_con_motivo(e, _t(), 1000)
    tid = e["tareas"][0]["id"]
    TA.marcar(e, tid, "programada", "entra en el plan de la iteración 4", 2000)
    TA.marcar(e, tid, "hecha", "la hizo el paso de literatura", 3000)
    t = e["tareas"][0]
    assert [h["estado"] for h in t["historial"]] == ["aceptada", "programada", "hecha"]
    assert all(h["motivo"].strip() for h in t["historial"])


# -- Las tareas por regla, sin ningún modelo --------------------------------------


def test_una_base_caida_tres_veces_abre_una_tarea_por_regla():
    c = {"investigacionId": "inv", "_fallosFuente": {"PubMed": 3, "Europe PMC": 1}}
    tareas = TA.por_regla_al_terminar_paso(_e(), c, {"id": "p1", "titulo": "Buscar"}, None, 3, 1000)
    assert len(tareas) == 1 and "PubMed no respondió 3 veces" in tareas[0]["queVio"]
    assert "no es una ausencia de evidencia" in tareas[0]["porQue"], "una base caída es «no pude comprobar», nunca «no hay»"
    assert "no pude comprobar" in tareas[0]["queHaria"]


def test_una_etapa_que_no_produjo_abre_una_tarea_con_la_comprobacion_ya_calculada():
    """La misma comprobación de cierre, no una segunda definición: con dos
    definiciones de "el paso no produjo nada" ROSA2018 se contradiría en la interfaz."""
    comp = {"etapa": "literatura", "resultado": "falla", "detalle": "40 registros y ninguno pasó el cribado"}
    tareas = TA.por_regla_al_terminar_paso(_e(), {"investigacionId": "inv"}, {"id": "p1", "titulo": "Buscar"}, comp, 3, 1000)
    assert len(tareas) == 1 and tareas[0]["herramienta"] == "literatura"
    assert "ninguno pasó el cribado" in tareas[0]["queVio"] and "no repitiéndola igual" in tareas[0]["queHaria"]
    # `sin_materia` y `no_comprobable` no abren nada: no hubo nada que hacer, o la
    # fuente no respondió y ya hay una regla para eso.
    for r in ("sin_materia", "no_comprobable", "pasa"):
        assert TA.por_regla_al_terminar_paso(_e(), {"investigacionId": "inv"}, {"id": "p1"}, {**comp, "resultado": r}, 3, 1000) == []


def test_las_tareas_por_regla_respetan_el_tope_por_paso():
    c = {"investigacionId": "inv", "_fallosFuente": {"PubMed": 3, "Europe PMC": 4, "bioRxiv": 5}}
    comp = {"etapa": "literatura", "resultado": "falla", "detalle": "nada"}
    tareas = TA.por_regla_al_terminar_paso(_e(), c, {"id": "p1"}, comp, 3, 1000)
    assert len(tareas) <= politicas.MAX_TAREAS_PROPUESTAS_POR_PASO


# -- Lo que decide la persona -----------------------------------------------------


def test_una_persona_rechaza_solo_con_motivo_y_acepta_sin_el():
    e = _e()
    TA.registrar_con_motivo(e, _t(), 1000)
    tid = e["tareas"][0]["id"]
    assert A.decidir_tarea(e, tid, "rechazada", "   ", "Emir", 2000) is False, "el rechazo pide motivo"
    assert A.decidir_tarea(e, tid, "rechazada", "Ya lo sabemos por Kim 2025", "Emir", 2000) is True
    t = e["tareas"][0]
    assert t["estado"] == "rechazada" and "Emir: Ya lo sabemos" in t["motivo"]
    # Una tarea ya programada o hecha no se toca: su paso ya corrió o está en el plan.
    TA.marcar(e, tid, "programada", "en el plan", 3000)
    assert A.decidir_tarea(e, tid, "rechazada", "me arrepiento", "Emir", 4000) is False


def test_una_persona_abre_una_tarea_y_pasa_por_el_mismo_triaje():
    e = _e()
    assert A.abrir_tarea(e, "inv", "", "hacer algo", "", "literatura", "Emir", 1000) is False
    assert A.abrir_tarea(e, "inv", "vi que falta la cohorte de validación", "buscar una segunda cohorte con GFAP seriado", "sube la certeza", "literatura", "Emir", 1000) is True
    t = e["tareas"][0]
    assert t["estado"] == "aceptada" and t["quien"] == "Emir" and t["origen"]["tipo"] == "persona"
    # Y si choca con el triaje, se le dice por qué (luego puede aceptarla igual).
    assert A.abrir_tarea(e, "inv", "otra cosa", "mandar un correo al laboratorio", "porque sí", "contactar_laboratorio", "Emir", 2000) is True
    assert e["tareas"][1]["estado"] == "rechazada" and "no tiene herramienta" in e["tareas"][1]["motivo"]
    assert A.decidir_tarea(e, e["tareas"][1]["id"], "aceptada", "", "Emir", 3000) is True, "la persona manda sobre la regla"


def test_el_triaje_aguanta_un_estado_roto():
    for roto in ({}, {"tareas": None}, {"tareas": [None, "texto"], "investigaciones": []}):
        estado, motivo = TA.triar(dict(roto), _t(), 1000)
        assert estado in TA.ESTADOS + ("fusionada",) and motivo
