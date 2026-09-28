"""Tanda 1 de la revisión del 17 de septiembre de 2026, zona corrida: lo que
engañaba o tiraba evidencia en el cierre de la iteración y en el supervisor.

- S-16: "hipótesis nuevas" por ventana de fecha, cola por regla en el resumen.
- S-14: el presupuesto agotado dentro del cierre pausa la corrida y el tick
  relanza con retroceso, no cada dos segundos.
- S-15: el corte dice qué tope saltó de verdad.
- S-18: un fichero de laboratorio sintético nunca cuenta como observación original.
- S-24: la evaluación de criterios con el juez caído no escribe cifras.
- S-13: reconcluir solo cuando cambia la huella de la evidencia.
- S-17: el tick no muta el estado por segundos.
- M-07: la dirección de la conclusión la fija la regla.
- M-23: un paso sin trabajo termina en "sin_trabajo".
- S-08: la evidencia que cambió desde la última decisión del Killer pide revisión.

Todo con modelos simulados, reutilizando el arnés de test_integracion_corrida."""

import asyncio
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from rosa import progreso as PROG
from rosa import revisor_registro as RR
from rosa.bucle import corrida as CO
from rosa.estado import plantilla as P
from rosa.modulos import contador as CT
from rosa.modulos.contador import PresupuestoAgotado
from rosa.tests.test_integracion_corrida import _af, _con_experimento_asignado, _hip, _pred_conclusion, _pred_llano, _preparar, _supervisor

import os

# Prueba manual sobre una copia del estado real: se activa con ROSA_ESTADO_REAL=<ruta al JSON>.
ESTADO_REAL = Path(os.environ.get("ROSA_ESTADO_REAL", "/ruta/inexistente/estado_real.json"))


def _corrida(al, ids):
    return next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])


def _it(al, ids, iteracion_id=None):
    return next(x for x in al.estado["iteraciones"] if x["id"] == (iteracion_id or ids["it"]))


def _respuestas_cierre():
    return {"resumir": SimpleNamespace(resumen="Resumen técnico de la iteración."), "en_llano": _pred_llano(), "concluir": _pred_conclusion()}


def _abrir_iteracion(al, ids, numero, empezada):
    """Una iteración nueva, aprobada y sin plan (el cierre no la trata como vacía)."""
    it = P.nueva_iteracion(ids["cor"], numero, empezada, [])
    it["planAprobado"] = True

    def fn(e):
        e["iteraciones"].append(it)
        next(c for c in e["corridas"] if c["id"] == ids["cor"])["iteracionActual"] = numero
        return True

    al.mutar(fn, "iteracion")
    return it


# ---------------------------------------------------------------------------
# S-16: hipótesis nuevas por ventana y cola por regla
# ---------------------------------------------------------------------------


def test_hipotesis_nacidas_en_cuenta_por_ventana_de_fecha_y_no_por_numero():
    it = {"numero": 1, "empezadaEn": 10_000, "terminadaEn": None}
    vieja = {"id": "v", "investigacionId": "inv", "creadaEn": 10_000 - 5 * 86_400_000, "iteracion": 1, "origen": "rosa"}
    nueva = {"id": "n", "investigacionId": "inv", "creadaEn": 12_000, "iteracion": 1, "origen": "rosa"}
    humana = {"id": "h", "investigacionId": "inv", "creadaEn": 13_000, "iteracion": 1, "origen": "humana"}
    otra = {"id": "o", "investigacionId": "otra", "creadaEn": 12_500, "iteracion": 1, "origen": "rosa"}
    tarde = {"id": "t", "investigacionId": "inv", "creadaEn": 50_000, "iteracion": 1, "origen": "rosa"}
    e = {"hipotesis": [vieja, nueva, humana, otra, tarde]}
    # Iteración abierta: hasta `ahora`.
    assert [h["id"] for h in PROG.hipotesis_nacidas_en(e, "inv", it, ahora=20_000)] == ["n", "h"]
    assert [h["id"] for h in PROG.hipotesis_nacidas_en(e, "inv", it, ahora=20_000, origen="rosa")] == ["n"]
    # Cerrada: hasta terminadaEn, aunque se pase un `ahora` posterior.
    assert [h["id"] for h in PROG.hipotesis_nacidas_en(e, "inv", {**it, "terminadaEn": 12_500}, ahora=99_999)] == ["n"]
    # Sin `ahora` ni terminadaEn no hay tope superior.
    assert [h["id"] for h in PROG.hipotesis_nacidas_en(e, "inv", it)] == ["n", "h", "t"]
    # Formas raras: nada explota y no se inventa un recuento.
    assert PROG.hipotesis_nacidas_en(e, "inv", None) == []
    assert PROG.hipotesis_nacidas_en(e, "inv", {"numero": 1}) == []
    assert PROG.hipotesis_nacidas_en({"hipotesis": [{"investigacionId": "inv", "creadaEn": None}, "basura", None]}, "inv", it, ahora=20_000) == []
    assert PROG.hipotesis_nacidas_en({}, "inv", it, ahora=20_000) == []


def test_recalcular_progreso_pone_a_cero_las_nuevas_fantasma_y_es_idempotente():
    e = {
        "investigaciones": [],
        "hipotesis": [{"id": "a", "investigacionId": "inv", "creadaEn": 1_000, "iteracion": 1, "origen": "rosa", "estado": "propuesta", "conclusion": None}],
        "iteraciones": [{"corridaId": "c7", "numero": 1, "empezadaEn": 500_000, "terminadaEn": 600_000}, {"corridaId": "c7", "numero": 2, "empezadaEn": 600_000, "terminadaEn": None}],
        "corridas": [{"id": "c7", "investigacionId": "inv", "gasto": {"usd": 1.0, "llamadas": 3}, "progreso": [
            {"iteracion": 1, "fecha": 600_000, "hipotesisNuevas": 3, "peldanosSubidos": 0, "peldanosBajados": 0, "certezas": [], "fallidos": {}},
            {"iteracion": 2, "fecha": 700_000, "hipotesisNuevas": 2, "peldanosSubidos": 0, "peldanosBajados": 0, "certezas": [], "fallidos": {}},
            {"iteracion": 9, "fecha": 800_000, "hipotesisNuevas": 4, "peldanosSubidos": 0, "peldanosBajados": 0, "certezas": [], "fallidos": {}},
        ], "metrica": {"hipotesisNuevas": 5, "peldanosNetos": 0}}],
    }
    assert PROG.recalcular_progreso(e) == 2
    serie = e["corridas"][0]["progreso"]
    assert [p["hipotesisNuevas"] for p in serie] == [0, 0, 4]  # la iteración 9 no existe: se deja como está
    assert e["corridas"][0]["metrica"]["hipotesisNuevas"] == 4 and e["corridas"][0]["metrica"]["iteraciones"] == 3
    assert PROG.recalcular_progreso(e) == 0
    # Registros rotos no tumban la migración.
    assert PROG.recalcular_progreso({"corridas": [None, {"progreso": "texto"}, {"id": "x", "progreso": [None, 3]}], "iteraciones": []}) == 0


def test_el_cierre_no_cuenta_como_nueva_una_hipotesis_de_hace_cinco_dias_y_pasa_la_cola(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)

    def envejecer(e):
        h = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])
        h["creadaEn"] = 1000 - 5 * 86_400_000  # nació hace cinco días con `iteracion` 1, como las nueve reales
        h["decisionKiller"] = "suspender"
        e["decisiones"].append(P.nueva_decision(ids["inv"], h["id"], 1, "killer_1", "suspender", "sesgo_evidencia: una única publicación observacional", "juez", 900, None, ""))
        return True

    al.mutar(envejecer, "envejecer")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    resumir = next(kw for p, kw in llamadas.vistas if p == "resumir")
    assert resumir["hipotesis_nuevas"] == "Ninguna"
    # La cola la escribe la regla (T.cola_de_hipotesis): recuento primero, motivo real del Killer después.
    assert resumir["cola"].splitlines()[0].startswith("1 en cola") and "1 suspendida" in resumir["cola"].splitlines()[0]
    assert "sesgo_evidencia: una única publicación observacional" in resumir["cola"]
    llano = next(kw for p, kw in llamadas.vistas if p == "en_llano")
    assert llano["hipotesis_nuevas"] == "Ninguna" and "una única publicación observacional" in llano["estado_hipotesis"] and llano["cola"].splitlines()[0].startswith("1 en cola")
    c = _corrida(al, ids)
    assert c["progreso"][-1]["hipotesisNuevas"] == 0
    it = _it(al, ids)
    assert it["resumenLlano"]["colaPorRegla"] == "1 hipótesis en cola: 0 con descarte propuesto por el Killer, 1 suspendida, 0 sin juzgar; 0 nacieron en esta iteración"
    informe = next(a for a in al.estado["artefactos"] if a["nombre"].startswith("Informe de la iteración"))
    assert "## Hipótesis nuevas en la cola (0)" in informe["versiones"][-1]["contenido"]
    revisar = next(kw for p, kw in llamadas.vistas if p == "revisar_registro")
    assert "HIPÓTESIS NUEVAS EN ESTA ITERACIÓN: 0 (" in revisar["registro"]
    assert "_cierre" not in it  # lo parcial se limpia al cerrar


def test_una_hipotesis_nacida_en_la_iteracion_si_cuenta(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == ids["hip"]).__setitem__("creadaEn", 1500) or True, "nacer")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["progreso"][-1]["hipotesisNuevas"] == 1
    assert next(kw for p, kw in llamadas.vistas if p == "resumir")["hipotesis_nuevas"] == "- GFAP sube antes que NfL"


def test_el_revisor_atrapa_por_regla_un_recuento_de_cola_falso():
    e = {"hechos": [], "hipotesis": [{"investigacionId": "inv", "iteracion": 1, "creadaEn": 1, "titulo": f"H{i}", "decisionKiller": "suspender", "estado": "propuesta"} for i in range(9)], "ejecuciones": [], "investigaciones": [{"id": "inv", "datasets": []}]}
    it = {"numero": 1, "empezadaEn": 1000, "plan": [], "pistas": []}
    corpus = RR.corpus_del_registro(e, "inv", it, {"_afirmaciones": [], "busqueda": {"consultas": []}})
    assert corpus["recuentos"]["cola"] == {9} and corpus["recuentos"]["hipotesis"] == {9, 0}
    malos = [h for h in RR.comprobaciones_deterministas("Quedan en cola dos hipótesis suspendidas.", corpus, it, 0) if "cola" in h["detalle"]]
    assert len(malos) == 1 and malos[0]["gravedad"] == "alta" and "en cola hay 9" in malos[0]["detalle"]
    assert not [h for h in RR.comprobaciones_deterministas("Quedan en cola nueve hipótesis.", corpus, it, 0) if "cola" in h["detalle"]]
    assert RR.recuentos_en_cola("Nueve hipótesis siguen en cola; en cola hay 3") == [(9, "Nueve hipótesis siguen en cola"), (3, "en cola hay 3")]


# ---------------------------------------------------------------------------
# S-14: presupuesto agotado en el cierre y retroceso del tick
# ---------------------------------------------------------------------------


def _agotar_corrida_y_iteracion(e, ids, it_limite: int = 40):
    """El tope de la CORRIDA gastado (el que sí pausa) y el de la iteración
    también: así el corte es el real y no el reparto del plan, que se amplía solo."""
    c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
    c["gasto"]["llamadas"] = c["presupuesto"]["limiteLlamadas"]
    next(i for i in e["iteraciones"] if i["id"] == ids["it"])["presupuesto"].update({"limite": it_limite, "usado": it_limite})
    return True


def test_presupuesto_agotado_en_el_cierre_pausa_y_el_cierre_se_retoma_sin_repagar(monkeypatch):
    al, ids = _preparar()

    def sin_presupuesto(kw):
        raise PresupuestoAgotado("tope de la iteración")

    respuestas = {**_respuestas_cierre(), "concluir": sin_presupuesto}
    sup, ctx, llamadas = _supervisor(al, ids, respuestas, monkeypatch)
    # El tope que se agota es el de la CORRIDA: el de la iteración se amplía solo
    # mientras la corrida tenga (28 de septiembre de 2026).
    al.mutar(lambda e: _agotar_corrida_y_iteracion(e, ids), "tope")
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c, it = _corrida(al, ids), _it(al, ids)
    assert c["estado"] == "pausada_por_presupuesto" and it["terminadaEn"] is None
    assert c["presupuesto"]["motivoPausa"].startswith(f"La corrida agotó su tope de {c['presupuesto']['limiteLlamadas']} llamadas")
    ev = [x for x in al.estado["eventos"] if x["tipo"] == "presupuesto"]
    assert len(ev) == 1 and ev[0]["texto"] == c["presupuesto"]["motivoPausa"]
    assert it["_cierre"]["resumen"] == "Resumen técnico de la iteración." and it["_cierre"]["llano"]["titulo"] == "Qué pasó"
    assert [p for p in it["pistas"] if p["titulo"].startswith("Evidencia nueva")][-1]["estado"] != "en_curso"  # ninguna pista huérfana
    # La persona amplía: el cierre se retoma con el resumen y el llano ya calculados.
    respuestas["concluir"] = _pred_conclusion()

    def ampliar(e):
        c2 = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c2["estado"] = "en_marcha"
        c2["presupuesto"]["limiteLlamadas"] = c2["gasto"]["llamadas"] + 500
        return True

    al.mutar(ampliar, "ampliar")
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    it = _it(al, ids)
    assert it["terminadaEn"] is not None and "_cierre" not in it and it["resumen"] == "Resumen técnico de la iteración."
    assert [p for p, _ in llamadas.vistas].count("resumir") == 1 and [p for p, _ in llamadas.vistas].count("en_llano") == 1
    assert _hip(al, ids)["conclusion"]


def test_el_tick_no_relanza_cada_dos_segundos_una_tarea_que_murio(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def rota(cid):
        raise ValueError("bucle roto a propósito")

    monkeypatch.setattr(sup, "correr_corrida", rota)

    def incidencias():
        return [i for i in al.estado["incidencias"] if i["tipo"] == "bucle_reventado"]

    async def cuerpo():
        t0 = 1_000_000
        sup._tick(ahora=t0)
        t1 = sup.tareas[ids["cor"]]
        await asyncio.sleep(0)
        assert t1.done() and isinstance(t1.exception(), ValueError)
        sup._tick(ahora=t0 + 2_000)  # el tick ve la tarea muerta: incidencia y espera de 30 s
        assert sup.tareas[ids["cor"]] is t1  # no se relanza a los 2 s
        assert len(incidencias()) == 1 and "ValueError" in incidencias()[0]["titulo"] and "30 s" in incidencias()[0]["titulo"]
        sup._tick(ahora=t0 + 20_000)
        sup._tick(ahora=t0 + 31_000)
        assert sup.tareas[ids["cor"]] is t1
        sup._tick(ahora=t0 + 33_000)
        t2 = sup.tareas[ids["cor"]]
        assert t2 is not t1  # pasados los 30 s sí
        await asyncio.sleep(0)
        sup._tick(ahora=t0 + 35_000)  # segunda muerte: espera de 60 s
        assert sup.tareas[ids["cor"]] is t2
        assert len(incidencias()) == 1 and "60 s" in incidencias()[0]["titulo"] and "fallo 2 seguido" in incidencias()[0]["titulo"]  # se actualiza, no se duplica
        sup._tick(ahora=t0 + 80_000)
        assert sup.tareas[ids["cor"]] is t2
        sup._tick(ahora=t0 + 96_000)
        t3 = sup.tareas[ids["cor"]]
        assert t3 is not t2
        await asyncio.sleep(0)
        sup._tick(ahora=t0 + 98_000)  # tercera muerte: 5 minutos
        assert "5 min" in incidencias()[0]["titulo"]
        # La corrida no queda retenida en "esperando aprobación" por esta incidencia.
        al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "esperando_aprobacion") or True, "estado")
        sup._tick(ahora=t0 + 100_000)
        assert _corrida(al, ids)["estado"] == "en_marcha"

    asyncio.run(cuerpo())


# ---------------------------------------------------------------------------
# S-15: qué tope cortó
# ---------------------------------------------------------------------------


def test_el_corte_dice_que_tope_salto_y_un_limite_cero_corta():
    al, ids = _preparar()
    e = al.estado
    assert CT.tope_agotado(al, ids["cor"], 1) is None and CT.presupuesto_ok(al, ids["cor"], 1) is True
    it = _it(al, ids)
    it["presupuesto"] = {"limite": 447, "usado": 447}
    assert CT.tope_agotado(al, ids["cor"], 1) == "iteracion" and CT.presupuesto_ok(al, ids["cor"], 1) is False
    assert CT.tope_agotado(al, ids["cor"]) is None  # sin iteración solo mira la corrida
    # Con el reparto de la iteración agotado y la corrida con tope de sobra NO se
    # pausa: se amplía sola (28 de septiembre de 2026, rosa/tests/test_presupuesto_iteracion.py).
    al.mutar(lambda e2: CO._pausar_por_presupuesto(e2, ids["cor"]), "pausa")
    c = _corrida(al, ids)
    assert c["estado"] == "en_marcha"
    limite = c["presupuesto"]["limiteLlamadas"]
    assert _it(al, ids)["presupuesto"]["limite"] == 447 + limite  # 447 usadas más todo lo que le queda a la corrida
    assert "se amplió sola" in al.estado["eventos"][-1]["texto"]
    assert "global" not in al.estado["eventos"][-1]["texto"]
    # El motivo del tope de la iteración sigue existiendo para cuando sí toque pausar
    # (autonomía en «preguntar», o un permiso denegado).
    it["presupuesto"] = {"limite": 447, "usado": 447}
    assert CO.motivo_de_pausa_por_presupuesto(al.estado, c, "iteracion") == f"La iteración 1 gastó las 447 llamadas que le tocaban (la corrida lleva 0 de {limite}): la corrida se pausó. Amplía el tope para seguir."
    # Denegación con la iteración recién abierta: límite 0 tiene que cortar.
    it["presupuesto"] = {"limite": 0, "usado": 0}
    assert CT.tope_agotado(al, ids["cor"], 1) == "iteracion"
    # El tope de la corrida manda cuando es el que saltó.
    it["presupuesto"] = {"limite": 447, "usado": 10}
    c["gasto"]["llamadas"] = c["presupuesto"]["limiteLlamadas"]
    c["estado"] = "en_marcha"
    assert CT.tope_agotado(al, ids["cor"], 1) == "corrida"
    al.mutar(lambda e2: CO._pausar_por_presupuesto(e2, ids["cor"]), "pausa")
    assert _corrida(al, ids)["presupuesto"]["motivoPausa"].startswith(f"La corrida agotó su tope de {limite} llamadas ({limite} gastadas)")
    # Registro antiguo sin presupuesto en la iteración ni motivoPausa: no rompe.
    it.pop("presupuesto", None)
    assert CT.tope_agotado_en({"corridas": [{"id": "x", "gasto": {"llamadas": 0}, "presupuesto": {"limiteLlamadas": 5}}], "iteraciones": [{"corridaId": "x", "numero": 1}]}, "x", 1) is None
    assert CT.tope_agotado_en({"corridas": []}, "no-existe", 1) is None


# ---------------------------------------------------------------------------
# S-18: datos sintéticos del laboratorio
# ---------------------------------------------------------------------------


def _resultado_apoyo():
    from rosa.tests.test_integracion_corrida import _pred_resultado

    return _pred_resultado("confirma", "apoyo_reproducido", [("GFAP en plasma", "+35 %")])


def _evaluar_con_fichero(al, ids, tmp_path, monkeypatch, nombre, flags=None):
    from rosa import datos as D

    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)

    def fn(e):
        x = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["experimento"]
        x["ficheroDatos"] = nombre
        x.update(flags or {})
        return True

    al.mutar(fn, "fichero")
    d = D.ruta_de(ids["hip"], nombre)
    d.write_text("grupo,gfap\ncontrol,10\ntratado,13.5\n")
    sup, ctx, _ = _supervisor(al, ids, {"evaluar_resultado": _resultado_apoyo(), "concluir": _pred_conclusion()}, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    return _hip(al, ids)


def test_un_csv_llamado_sintetico_no_cuenta_como_observacion_original(monkeypatch, tmp_path):
    al, ids = _preparar()
    h = _evaluar_con_fichero(al, ids, tmp_path, monkeypatch, "datos_gfap_nfl_sintetico.csv")
    lab = [a for a in h["afirmaciones"] if a.get("trayectoria")]
    assert len(lab) == 1 and lab[0]["sintetico"] is True and lab[0]["cita"].startswith("[Datos de prueba, SINTÉTICOS: datos_gfap_nfl_sintetico.csv")
    assert h["evidenciaEstadistica"] == "no_aplica" and h["experimento"]["resultado"]["sintetico"] is True
    assert not any(hch.get("origen") == "laboratorio" or "laboratorio" in str(hch.get("tipo", "")) for hch in al.estado["hechos"])
    assert not any(ev["tipo"] == "hecho_nuevo" for ev in al.estado["eventos"])
    assert any("SINTÉTICOS" in r for r in h["procedencia"]["registro"])
    # Y el techo GRADE no sube por él: sin datos reales no pasa de baja.
    from rosa import certeza as CERTEZA

    assert CERTEZA.techo(h)[0] in ("baja", "muy_baja")


def test_la_casilla_de_la_subida_marca_sintetico_aunque_el_nombre_sea_neutro(monkeypatch, tmp_path):
    al, ids = _preparar()
    h = _evaluar_con_fichero(al, ids, tmp_path, monkeypatch, "resultados.csv", {"datosSinteticos": "si"})
    lab = [a for a in h["afirmaciones"] if a.get("trayectoria")]
    assert lab[0]["sintetico"] is True and not any(ev["tipo"] == "hecho_nuevo" for ev in al.estado["eventos"])
    # "no" no es verdadero: el valor por defecto del formulario no marca nada.
    assert CO.es_resultado_sintetico({"datosSinteticos": "no"}, "resultados.csv") is False
    assert CO.es_resultado_sintetico({"ensayoEnSeco": True}, "resultados.csv") is True
    assert CO.es_resultado_sintetico(None, "datos-SINTÉTICOS.csv") is True
    assert CO.es_resultado_sintetico({}, "resultados.csv", "id,valor # fichero sintetico de prueba") is True


def test_un_csv_real_sigue_contando_y_entra_al_modelo_de_mundo(monkeypatch, tmp_path):
    al, ids = _preparar()
    h = _evaluar_con_fichero(al, ids, tmp_path, monkeypatch, "resultados_lab.csv")
    lab = [a for a in h["afirmaciones"] if a.get("trayectoria")]
    assert lab[0]["sintetico"] is False and lab[0]["cita"].startswith("[Datos del laboratorio: resultados_lab.csv")
    assert h["evidenciaEstadistica"] == "fuerte" and any(ev["tipo"] == "hecho_nuevo" for ev in al.estado["eventos"])


# ---------------------------------------------------------------------------
# S-24: evaluación de criterios con el juez caído
# ---------------------------------------------------------------------------


def _con_decision_humana(al, ids):
    def fn(e):
        h = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])
        h["estado"] = "aceptada"
        h2 = copy.deepcopy(h)
        h2["id"] = "hip-segunda"
        h2["estado"] = "descartada"
        h2["titulo"] = "NfL sube antes que GFAP"
        e["hipotesis"].append(h2)
        e["decisiones"].append(P.nueva_decision(ids["inv"], h["id"], 1, "persona", "aceptada", "la acepto", "Dra. Allegri", 5000, None, ""))
        e["decisiones"].append(P.nueva_decision(ids["inv"], h2["id"], 1, "persona", "descartada", "la descarto", "Dra. Allegri", 5000, None, ""))
        cambio = P.nuevo_cambio_aprendizaje(ids["inv"], 2, "criterio", "Exigir dos cohortes", f"arnes:{ids['cor']}", "propuesto", "Rosa", 1)
        cambio["descripcion"] = "Exigir dos cohortes"
        cambio["_evaluar"] = 1
        e["aprendizaje"].append(cambio)
        return cambio["id"]

    return al.mutar(fn, "reservado")


def _pred_killer():
    return SimpleNamespace(revision=SimpleNamespace(comprobaciones=[]))


def _cambio(al, cambio_id):
    return next(c for c in al.estado["aprendizaje"] if c["id"] == cambio_id)


def test_juez_caido_en_todo_no_escribe_acuerdo_cero(monkeypatch):
    al, ids = _preparar()
    cambio_id = _con_decision_humana(al, ids)
    sup, ctx, llamadas = _supervisor(al, ids, {}, monkeypatch)  # sin "killer": el juez lanza siempre
    asyncio.run(sup._evaluar_cambio(_cambio(al, cambio_id)))
    c = _cambio(al, cambio_id)
    ev = c["evaluacion"]
    assert c["estado"] == "propuesto" and "_evaluar" not in c
    assert ev["casos"] == 2 and ev["juzgadas"] == 0 and ev["sinRespuesta"] == 2 and ev["antes"] is None and ev["despues"] is None
    assert ev["nota"].startswith("2 de 2 sin respuesta del juez")
    assert [p for p, _ in llamadas.vistas].count("killer") == 2  # la segunda pasada no se hizo
    assert any(e_["tipo"] == "aprendizaje" and "sin evaluar" in e_["texto"] for e_ in al.estado["eventos"])


def test_juez_caido_en_una_llamada_de_la_segunda_pasada_no_revierte(monkeypatch):
    al, ids = _preparar()
    cambio_id = _con_decision_humana(al, ids)
    llamadas_hechas = []

    def killer(kw):
        llamadas_hechas.append(1)
        if len(llamadas_hechas) == 4:
            raise RuntimeError("El modelo no respondió en 600 s")
        return _pred_killer()

    sup, ctx, _ = _supervisor(al, ids, {"killer": killer}, monkeypatch)
    from rosa import killer as K

    monkeypatch.setattr(K, "decidir", lambda comprobaciones, tiene_prediccion, version: ("avanzar", ""))
    asyncio.run(sup._evaluar_cambio(_cambio(al, cambio_id)))
    c = _cambio(al, cambio_id)
    assert c["estado"] == "propuesto" and c["evaluacion"]["juzgadas"] == 1 and c["evaluacion"]["sinRespuesta"] == 1
    assert c["evaluacion"]["antes"] is not None and "1 de 2 sin respuesta del juez" in c["evaluacion"]["nota"]
    # Con el juez respondiendo en todo, la cifra sí se escribe y el criterio queda evaluado.
    al2, ids2 = _preparar()
    cambio2 = _con_decision_humana(al2, ids2)
    sup2, _, _ = _supervisor(al2, ids2, {"killer": _pred_killer()}, monkeypatch)
    asyncio.run(sup2._evaluar_cambio(_cambio(al2, cambio2)))
    c2 = _cambio(al2, cambio2)
    assert c2["estado"] == "evaluado" and c2["evaluacion"] == {"conjunto": "hipótesis con decisión humana", "casos": 2, "juzgadas": 2, "sinRespuesta": 0, "antes": 0.5, "despues": 0.5, "nota": "No cambia el acuerdo"}


def test_evaluacion_pareada_compara_solo_las_juzgadas_en_las_dos_pasadas():
    antes = {"acuerdos": {"a": True, "b": False, "c": True}, "fallos": 0, "juzgadas": 3}
    despues = {"acuerdos": {"a": True, "c": False}, "fallos": 1, "juzgadas": 2}
    ev = CO.evaluacion_pareada(antes, despues, 3)
    assert ev["juzgadas"] == 2 and ev["sinRespuesta"] == 1 and ev["antes"] == 1.0 and ev["despues"] == 0.5 and ev["nota"].startswith("1 de 3 sin respuesta del juez")
    e = {"aprendizaje": [{"id": "x", "estado": "propuesto", "origen": "arnes:c", "investigacionId": "inv", "_evaluar": 1}], "eventos": []}
    assert CO._fijar_evaluacion(e, "x", ev, 10) is True
    assert e["aprendizaje"][0]["estado"] == "propuesto"  # ni evaluado ni revertido con la evaluación incompleta
    completa = CO.evaluacion_pareada(antes, {"acuerdos": {"a": True, "b": False, "c": False}, "fallos": 0, "juzgadas": 3}, 3)
    assert completa["nota"] == "Empeora el acuerdo"
    assert CO._fijar_evaluacion(e, "x", completa, 11) is True and e["aprendizaje"][0]["estado"] == "revertido"


# ---------------------------------------------------------------------------
# S-13: reconcluir solo con huella distinta
# ---------------------------------------------------------------------------


def test_reconcluir_solo_cuando_cambia_la_huella_de_la_evidencia(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)

    def concluidas():
        return [p for p, _ in llamadas.vistas].count("concluir")

    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    h = _hip(al, ids)
    assert concluidas() == 1 and h["conclusion"]["huella"] == CO.huella_de_conclusion(h)
    # Segunda iteración: solo un partido nuevo del torneo. No mueve la certeza: se conserva.
    it2 = _abrir_iteracion(al, ids, 2, 20_000)
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["partidos"].append({"resultado": "gana", "ejeDecisivo": "comprobabilidad", "resumenDebate": "ganó por comprobabilidad", "iteracion": 2}) or True, "partido")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids, it2["id"])))
    h = _hip(al, ids)
    assert concluidas() == 1
    assert h["procedencia"]["registro"][-1] == "iteración 2: sin cambios en la evidencia contada; se conserva la conclusión de la iteración 1"
    assert h["conclusion"]["iteracion"] == 1
    # Tercera: una afirmación nueva sí cambia la huella y se reconcluye.
    it3 = _abrir_iteracion(al, ids, 3, 30_000)
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["afirmaciones"].append(_af("GFAP también sube en A4", cohorte="A4")) or True, "afirmacion")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids, it3["id"])))
    assert concluidas() == 2 and _hip(al, ids)["conclusion"]["iteracion"] == 3


def test_motivo_para_reconcluir_cubre_los_disparadores():
    h = {"id": "h", "afirmaciones": [], "supuestos": [], "novedad": {}, "procedencia": {"fuentes": []}, "version": 1, "revisiones": [], "revisionesHumanas": [], "experimento": None}
    assert CO.motivo_para_reconcluir(h) == "sin conclusión previa"
    h["conclusion"] = {"huella": CO.huella_de_conclusion(h), "iteracion": 1}
    h["_conclusionIntentada"] = 1
    assert CO.motivo_para_reconcluir(h) is None
    assert CO.motivo_para_reconcluir(h, {"h"}) == "evidencia nueva en esta iteración"
    assert CO.motivo_para_reconcluir({**h, "pendienteRevision": {"causa": "x"}}) == "pendiente de revisar"
    assert CO.motivo_para_reconcluir({**h, "_recalcularPorFuente": 5}) == "cambio editorial de una fuente"
    sin_marca = dict(h)
    sin_marca.pop("_conclusionIntentada")
    assert CO.motivo_para_reconcluir(sin_marca) == "resultado o evidencia nueva marcada"
    assert CO.motivo_para_reconcluir({**h, "decisionKiller": "suspender"}) == "la evidencia contada cambió"
    # Una conclusión antigua sin huella se rehace una vez; un partido nuevo no cambia la huella.
    assert CO.motivo_para_reconcluir({**h, "conclusion": {"iteracion": 1}}) == "la evidencia contada cambió"
    assert CO.huella_de_conclusion({**h, "partidos": [{"resultado": "gana"}]}) == CO.huella_de_conclusion(h)
    # Registros con formas raras no rompen la huella.
    CO.huella_de_conclusion({"afirmaciones": ["texto", None], "supuestos": "texto", "novedad": None, "procedencia": "texto", "experimento": "texto"})


# ---------------------------------------------------------------------------
# S-17: el tick no muta por segundos
# ---------------------------------------------------------------------------


def test_el_tick_no_escribe_el_estado_por_segundos_y_el_tope_lee_la_memoria(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def dormida(cid):
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)

    async def cuerpo():
        t0 = 1000 + 5_000  # la corrida empezó en 1000
        sup._tick(ahora=t0)
        v0 = al.version
        for dt in (2_000, 10_000, 20_000, 29_000):
            sup._tick(ahora=t0 + dt)
        assert al.version == v0 and _corrida(al, ids)["gasto"]["segundos"] == 0
        sup._tick(ahora=t0 + 31_000)
        assert al.version == v0 + 1 and _corrida(al, ids)["gasto"]["segundos"] == round((t0 + 31_000 - 1000) / 1000)
        # Espera humana: se acumula en memoria y el tope la ve sin escribirla.
        al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "esperando_plan") or True, "estado")
        sup._tick(ahora=t0 + 33_000)  # el cambio de estado vuelca una vez
        v1 = al.version
        sup._tick(ahora=t0 + 43_000)
        sup._tick(ahora=t0 + 53_000)
        c = _corrida(al, ids)
        assert al.version == v1 and c["esperaHumanaMs"] == 2_000  # lo volcado con el cambio de estado; lo demás sigue en memoria
        assert sup._con_reloj(c)["esperaHumanaMs"] == 22_000  # 2 s del tic del cambio más 10 más 10
        assert CO.tiempo_trabajo_ms(sup._con_reloj(c), t0 + 53_000) == (t0 + 53_000) - 1000 - 22_000  # el tope en horas ve la espera en memoria
        # Al terminar la corrida, el reloj se escribe entero aunque no hayan pasado 30 s.
        al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "terminada") or True, "fin")
        sup._tick(ahora=t0 + 55_000)
        c = _corrida(al, ids)
        assert c["esperaHumanaMs"] == 22_000 and c["gasto"]["segundos"] == round((t0 + 53_000 - 1000 - 22_000) / 1000)
        assert ids["cor"] not in sup._reloj
        for t in sup.tareas.values():
            t.cancel()

    asyncio.run(cuerpo())


# ---------------------------------------------------------------------------
# M-07: dirección por regla
# ---------------------------------------------------------------------------


def test_direccion_por_regla_no_dice_contradictoria_sin_afirmaciones_en_contra(monkeypatch):
    apoyo = _af("GFAP sube")
    contra = {**_af("GFAP no cambia"), "relacion": "contradice"}
    h = {"afirmaciones": [apoyo] * 14, "supuestos": [{"texto": "NfL es específico", "estado": "contradicho"}], "experimento": None}
    # La misma regla por los dos caminos: la de contexto.py (grupo B1) y la local de respaldo.
    for fn in (CO.direccion_por_regla, CO._direccion_por_regla_local):
        # La DIRECCIÓN es la misma por los dos caminos (el aviso del supuesto solo
        # lo calcula `direccion_por_regla`; la local devuelve siempre False).
        assert fn(h, "mixta")[0] == "apoya" and fn(h, "apoya")[0] == "apoya", fn
        assert fn({**h, "afirmaciones": [apoyo, contra]}, "apoya") == ("mixta", False)
        assert fn({**h, "afirmaciones": [contra]}, "apoya") == ("en_contra", False)
        assert fn({**h, "afirmaciones": []}, "apoya")[0] == "sin_evidencia_directa"
        assert fn({**h, "experimento": {"resultado": {"veredicto": "refuta"}}}, "apoya") == ("en_contra", False)
        assert fn({**h, "afirmaciones": [{**contra, "sintetico": True}]}, "apoya")[0] == "sin_evidencia_directa"
    # El aviso del supuesto contradicho sale diga lo que diga el juez (28 de
    # septiembre de 2026): antes hacía falta que el juez ya hubiera dicho
    # "mixta" o "en contra", así que con un juez que decía "apoya" (lo normal,
    # porque con esa regla no mira los supuestos) la conclusión salía sin
    # mencionarlo. Así llegó la hipótesis de SULF2 a un dossier.
    assert CO.direccion_por_regla(h, "mixta") == ("apoya", True)
    assert CO.direccion_por_regla(h, "apoya") == ("apoya", True)
    assert CO.direccion_por_regla({**h, "afirmaciones": []}, "apoya") == ("sin_evidencia_directa", True)
    # Sin supuesto contradicho no hay aviso, y con una dirección que ya cuenta
    # la contradicción por sí sola (mixta, en contra) tampoco.
    assert CO.direccion_por_regla({**h, "supuestos": []}, "mixta") == ("apoya", False)
    assert CO.direccion_por_regla({**h, "supuestos": []}, "apoya") == ("apoya", False)
    assert CO.direccion_por_regla({**h, "afirmaciones": [apoyo, contra]}, "apoya") == ("mixta", False)
    assert CO.direccion_por_regla({**h, "afirmaciones": [contra]}, "apoya") == ("en_contra", False)
    assert "aunque un supuesto del que depende está contradicho" in CO.frase_plantilla("apoya", "baja", "GFAP sube antes", supuesto_contradicho=True)
    assert CO.frase_plantilla("apoya", "baja", "GFAP sube antes").startswith("La evidencia sugiere, con limitaciones, que")
    # Camino real: el juez dice "mixta" con 0 en contra y un supuesto contradicho.
    al, ids = _preparar()
    pred = _pred_conclusion()
    pred.conclusion.direccion = "mixta"
    sup, ctx, _ = _supervisor(al, ids, {"concluir": pred}, monkeypatch)
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["supuestos"].append({"id": "s", "texto": "NfL refleja daño axonal de forma específica", "estado": "contradicho", "evidencia": "NfL es inespecífico", "hijos": []}) or True, "supuesto")
    asyncio.run(sup._concluir_hipotesis(ctx, _hip(al, ids)))
    k = _hip(al, ids)["conclusion"]
    assert k["direccion"] == "apoya" and k["direccionDelJuez"] == "mixta" and "contradictoria" not in k["enunciado"] and "supuesto del que depende" in k["enunciado"]
    assert any("el juez propuso dirección «mixta»" in r for r in _hip(al, ids)["procedencia"]["registro"])


# ---------------------------------------------------------------------------
# M-23: pasos sin trabajo
# ---------------------------------------------------------------------------


def test_un_paso_sin_trabajo_no_queda_como_hecho(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def nada(ctx, paso):
        return "No hay fuentes nuevas de las que extraer"

    async def trabaja(ctx, paso):
        pista = ctx.pista(paso["id"], "extraccion", "Extraer", "Sonnet 5")
        pista.cerrar("3 afirmaciones")
        return "3 afirmaciones extraídas de 2 fuentes"

    class SinTrabajo(RuntimeError):
        pass

    async def lanza(ctx, paso):
        raise SinTrabajo("Todas las hipótesis tienen la novedad comprobada")

    monkeypatch.setitem(CO.PASOS.EJECUTORES, "extraccion", nada)
    monkeypatch.setitem(CO.PASOS.EJECUTORES, "verificacion", trabaja)
    monkeypatch.setitem(CO.PASOS.EJECUTORES, "novedad", lanza)
    monkeypatch.setattr(CO.PASOS, "SinTrabajo", SinTrabajo, raising=False)
    pasos = []
    for tipo in ("extraccion", "verificacion", "novedad"):
        p = P.nuevo_paso(tipo.capitalize(), "d", 10)
        p["tipo"] = tipo
        pasos.append(p)
    al.mutar(lambda e: next(i for i in e["iteraciones"] if i["id"] == ids["it"])["plan"].extend(pasos) or True, "plan")
    for p in pasos:
        asyncio.run(sup._ejecutar_paso(_corrida(al, ids), _it(al, ids), p))
    it = _it(al, ids)
    estados = {p["tipo"]: (p["estado"], p["motivoFallo"]) for p in it["plan"]}
    assert estados["extraccion"] == ("sin_trabajo", "No hay fuentes nuevas de las que extraer")
    assert estados["verificacion"] == ("hecho", None)
    assert estados["novedad"] == ("sin_trabajo", "Todas las hipótesis tienen la novedad comprobada")
    snap = PROG.instantanea(al.estado, _corrida(al, ids), it, 0, 0, 0, 5000)
    assert snap["fallidos"]["sinTrabajo"] == 2 and snap["fallidos"]["pasos"] == 0
    corpus = {"numeros": set(), "ids": set(), "textos": [], "recuentos": {}}
    assert not any(h["clase"] == "paso_incompleto" for h in RR.comprobaciones_deterministas("Resumen.", corpus, it, 0))
    assert CO.paso_sin_trabajo("0 ensayos encontrados, 0 registrados", [{"estado": "hecha"}]) is True
    assert CO.paso_sin_trabajo("12 ensayos encontrados, 3 registrados", [{"estado": "hecha"}]) is False
    assert CO.paso_sin_trabajo(None, []) is True


def test_el_analisis_que_se_deja_fuera_del_plan_deja_un_evento(monkeypatch):
    al, ids = _preparar()
    plan = SimpleNamespace(plan=[SimpleNamespace(tipo="literatura", titulo="Leer", detalle="d", valor_decision="", espera="", si_no_aparece=""), SimpleNamespace(tipo="analisis", titulo="Analizar GEO", detalle="d", valor_decision="", espera="", si_no_aparece="")])
    sup, ctx, _ = _supervisor(al, ids, {"plan": plan}, monkeypatch)
    sup.programas.plan = "plan"

    async def sin_red(*a, **k):
        return ""

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", sin_red)
    monkeypatch.setattr(CO.LEC, "para", sin_red)

    def preparar(e):
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["_misionIntentada"] = True
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["_preguntaIntentada"] = True
        c["pregunta"] = {"enunciado": "¿Qué distingue a un biomarcador?"}
        return True

    al.mutar(preparar, "preparar")
    asyncio.run(sup._proponer_plan(_corrida(al, ids), None))
    it = [i for i in al.estado["iteraciones"] if i["corridaId"] == ids["cor"]][-1]
    assert [p["tipo"] for p in it["plan"]] == ["literatura"]
    ev = [x for x in al.estado["eventos"] if "Analizar GEO" in x["texto"]]
    assert len(ev) == 1 and "no hay ningún dataset aprobado" in ev[0]["texto"]


# ---------------------------------------------------------------------------
# S-08: revisión pedida por huella
# ---------------------------------------------------------------------------


def _hipotesis_juzgada(hid, inv="inv", **campos):
    h = {"id": hid, "investigacionId": inv, "estado": "propuesta", "titulo": f"Hipótesis {hid}", "afirmaciones": [_af(f"a {hid}")], "supuestos": [], "novedad": {}, "procedencia": {"fuentes": [], "registro": []}, "version": 1, "decisionKiller": "suspender", "experimento": None}
    h.update(campos)
    return h


def test_pedir_revision_por_huella_marca_una_vez_lo_que_cambio():
    igual = _hipotesis_juzgada("igual")
    distinta = _hipotesis_juzgada("distinta")
    vieja = _hipotesis_juzgada("vieja")  # decisión sin huella, con evento de evidencia posterior
    quieta = _hipotesis_juzgada("quieta")  # decisión sin huella, sin evidencia después
    nunca = _hipotesis_juzgada("nunca", decisionKiller=None)
    agotada = _hipotesis_juzgada("agotada", _killerIntentos=3)
    e = {
        "hipotesis": [igual, distinta, vieja, quieta, nunca, agotada],
        "decisiones": [
            {"hipotesisId": "igual", "etapa": "killer_1", "fecha": 100, "huella": CO.huella_evidencia(igual)},
            {"hipotesisId": "distinta", "etapa": "killer_1", "fecha": 100, "huella": "otra-huella"},
            {"hipotesisId": "vieja", "etapa": "killer_1", "fecha": 100},
            {"hipotesisId": "quieta", "etapa": "killer_1", "fecha": 100},
            {"hipotesisId": "agotada", "etapa": "killer_1", "fecha": 100, "huella": "otra"},
        ],
        "eventos": [{"tipo": "revision_automatica", "t": 200, "texto": "Evidencia nueva para «Hipótesis vieja»: 3 afirmaciones", "ruta": "#/investigaciones/inv/hipotesis/vieja"}, {"tipo": "revision_automatica", "t": 50, "texto": "Evidencia nueva para «Hipótesis quieta»", "ruta": "#/investigaciones/inv/hipotesis/quieta"}],
    }
    assert CO.pedir_revision_por_huella(e, 1000) == 2
    assert distinta["_revisionPedida"] is True and vieja["_revisionPedida"] is True
    assert all("_revisionPedida" not in h for h in (igual, quieta, nunca, agotada))
    assert vieja["procedencia"]["registro"][-1].endswith("revisión pedida: la evidencia cambió desde la última decisión del Killer")
    # Segunda pasada: la misma huella no se vuelve a pedir, ni aunque la marca se haya quitado.
    distinta.pop("_revisionPedida")
    assert CO.pedir_revision_por_huella(e, 2000) == 0
    # Evidencia nueva otra vez: huella distinta, se pide de nuevo.
    distinta["afirmaciones"].append(_af("más evidencia"))
    assert CO.pedir_revision_por_huella(e, 3000) == 1 and distinta["_revisionPedida"] is True
    # Filtrar por investigación y aguantar registros rotos.
    assert CO.pedir_revision_por_huella(e, 4000, "otra-inv") == 0
    assert CO.pedir_revision_por_huella({"hipotesis": [None, "x", {"estado": "propuesta"}], "decisiones": [], "eventos": []}, 1) == 0


def test_la_peticion_de_revision_solo_se_cierra_si_el_killer_decidio():
    h = _hipotesis_juzgada("h", _revisionPedida=True)
    e = {"hipotesis": [h], "decisiones": []}
    assert CO._cerrar_peticion_de_revision(e, "h", 0) is True
    assert h["_revisionPedida"] is True and h["_killerIntentos"] == 1
    CO._cerrar_peticion_de_revision(e, "h", 0)
    assert h["_killerIntentos"] == 2 and h.get("_revisionPedida")
    CO._cerrar_peticion_de_revision(e, "h", 0)
    assert "_revisionPedida" not in h and h["_killerIntentos"] == 3 and "abandonada tras 3 intentos" in h["procedencia"]["registro"][-1]
    # Con decisión nueva: se quita la marca y se olvidan los intentos.
    h["_revisionPedida"] = True
    e["decisiones"].append({"hipotesisId": "h", "etapa": "killer_1", "fecha": 5})
    CO._cerrar_peticion_de_revision(e, "h", 0)
    assert "_revisionPedida" not in h and "_killerIntentos" not in h
    assert CO._cerrar_peticion_de_revision(e, "no-existe", 0) is False


# ---------------------------------------------------------------------------
# Sobre la copia del estado real
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not ESTADO_REAL.exists(), reason="sin copia del estado real")
def test_sobre_el_estado_real_las_nuevas_fantasma_desaparecen_y_la_cola_se_cuenta_bien():
    e = json.loads(ESTADO_REAL.read_text())
    inv = "inv-mu2sz2ns-3"
    antes = {c["numero"]: [p["hipotesisNuevas"] for p in c.get("progreso") or []] for c in e["corridas"] if c["investigacionId"] == inv and c.get("progreso")}
    assert antes[12] == [3, 2, 2]
    PROG.recalcular_progreso(e)
    for c in e["corridas"]:
        if c["investigacionId"] == inv and c.get("progreso"):
            for p in c["progreso"]:
                it = next(x for x in e["iteraciones"] if x["corridaId"] == c["id"] and x["numero"] == p["iteracion"])
                assert p["hipotesisNuevas"] == len(PROG.hipotesis_nacidas_en(e, inv, it, ahora=p["fecha"], origen="rosa"))
            if c["numero"] >= 4:
                assert all(p["hipotesisNuevas"] == 0 for p in c["progreso"]), c["numero"]
    assert PROG.recalcular_progreso(e) == 0
    assert CO.frase_de_la_cola(e, inv) == "9 hipótesis en cola: 5 con descarte propuesto por el Killer, 4 suspendidas, 0 sin juzgar"
    cola = CO.cola_de_hipotesis(e, inv)
    assert cola.count("\n- ") == 9 and cola.count("nació el") == 9 and cola.count("sesgo_evidencia") >= 1
    estado = CO.estado_de_la_cola(e, inv)
    assert estado.count("\n") == 8 and "sesgo_evidencia" in estado
    # La contradicción que el juez repetía 26 veces la ve la regla.
    it = next(x for x in e["iteraciones"] if x["id"] == "it-mu5kkbc2-11205")
    c = next(x for x in e["corridas"] if x["id"] == it["corridaId"])
    corpus = RR.corpus_del_registro(e, inv, it, c)
    hall = RR.comprobaciones_deterministas("Quedan en cola dos hipótesis.", corpus, it, 0)
    assert any("recuento de la cola" in h["detalle"] and "en cola hay 9" in h["detalle"] for h in hall)
    # El saneamiento de la revisión pedida corre sobre el estado real sin romper y marca las que ganaron evidencia después de su Killer.
    n = CO.pedir_revision_por_huella(e, 1_800_000_000_000)
    assert n >= 1
    for h in e["hipotesis"]:
        if h["investigacionId"] == inv and h.get("_revisionPedida"):
            d = CO._ultima_decision_killer(e, h)
            assert CO._hubo_evidencia_despues(e, h, d["fecha"])
    # Las conclusiones antiguas no traen huella: se rehacen una vez y después se conservan.
    h = next(x for x in e["hipotesis"] if x["id"] == "hip-mu2zz5y8-2440")
    assert CO.motivo_para_reconcluir(h) is not None
    h["conclusion"]["huella"] = CO.huella_de_conclusion(h)
    h["_conclusionIntentada"] = 1
    assert CO.motivo_para_reconcluir(h) is None


# ---------------------------------------------------------------------------
# Adversario de la zona corrida (17 de septiembre de 2026): lo que se rompió
# intentando romper la tanda 1, y su arreglo.
# ---------------------------------------------------------------------------


def _agotar(al, ids, estado="terminada"):
    """La corrida en `estado` con el tope de llamadas gastado."""

    def fn(e):
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["estado"] = estado
        c["gasto"]["llamadas"] = c["presupuesto"]["limiteLlamadas"]
        return True

    al.mutar(fn, "agotar")


def test_una_corrida_terminada_o_detenida_no_se_pausa_por_presupuesto():
    al, ids = _preparar()
    for estado in ("terminada", "detenida"):
        _agotar(al, ids, estado)
        eventos_antes = len(al.estado["eventos"])
        assert al.mutar(lambda e2: CO._pausar_por_presupuesto(e2, ids["cor"]), "pausa") is False
        assert _corrida(al, ids)["estado"] == estado and len(al.estado["eventos"]) == eventos_antes
    # Viva sí se pausa, una sola vez.
    _agotar(al, ids, "en_marcha")
    assert al.mutar(lambda e2: CO._pausar_por_presupuesto(e2, ids["cor"]), "pausa") is not False
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto"
    assert al.mutar(lambda e2: CO._pausar_por_presupuesto(e2, ids["cor"]), "pausa") is False


def test_evaluar_un_criterio_con_la_corrida_terminada_y_sin_presupuesto_no_la_resucita_ni_reintenta(monkeypatch):
    al, ids = _preparar()
    cambio_id = _con_decision_humana(al, ids)
    _agotar(al, ids, "terminada")
    sup, ctx, llamadas = _supervisor(al, ids, {"killer": _pred_killer()}, monkeypatch)
    asyncio.run(sup._evaluar_cambio(_cambio(al, cambio_id)))
    c, cambio = _corrida(al, ids), _cambio(al, cambio_id)
    assert c["estado"] == "terminada"  # antes: "pausada_por_presupuesto" y el tick la relanzaba
    assert "_evaluar" not in cambio and cambio["estado"] == "propuesto"  # no se reintenta cada tick; el botón sigue
    assert cambio["evaluacion"]["juzgadas"] == 0 and cambio["evaluacion"]["antes"] is None and "Sin presupuesto en la corrida 1" in cambio["evaluacion"]["nota"]
    assert llamadas.vistas == []  # ni una llamada al juez
    # Con la corrida viva, la evaluación pausa la corrida y deja la marca para cuando amplíen.
    al.mutar(lambda e: (_cambio(al, cambio_id).__setitem__("_evaluar", 1), _cambio(al, cambio_id).__setitem__("estado", "propuesto"), True)[-1], "otra")
    _agotar(al, ids, "en_marcha")
    asyncio.run(sup._evaluar_cambio(_cambio(al, cambio_id)))
    assert _corrida(al, ids)["estado"] == "pausada_por_presupuesto" and _cambio(al, cambio_id).get("_evaluar")
    assert llamadas.vistas == []


def test_la_huella_de_la_conclusion_se_fija_tras_atender_lo_pendiente_y_no_se_reconcluye_otra_vez(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, {"concluir": _pred_conclusion()}, monkeypatch)
    al.mutar(lambda e: _hip(al, ids).__setitem__("pendienteRevision", {"causa": "fuente_cambiada", "detalle": "la fuente se corrigió", "desde": 900}) or True, "pendiente")
    asyncio.run(sup._concluir_hipotesis(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    assert h["pendienteRevision"] is None and h["conclusion"]["huella"]
    # La huella guardada es la de la hipótesis tal como quedó: el siguiente cierre no paga otra conclusión.
    assert CO.motivo_para_reconcluir(h) is None
    assert h["conclusion"]["huella"] == CO.huella_de_conclusion(h)


def test_sin_presupuesto_en_el_llano_o_en_el_revisor_el_cierre_pausa_y_no_cierra_a_medias(monkeypatch):
    al, ids = _preparar()

    def sin_presupuesto(kw):
        raise PresupuestoAgotado("tope")

    respuestas = {**_respuestas_cierre(), "en_llano": sin_presupuesto}
    sup, ctx, llamadas = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c, it = _corrida(al, ids), _it(al, ids)
    assert c["estado"] == "pausada_por_presupuesto" and it["terminadaEn"] is None  # antes: se tragaba y la iteración cerraba sin resumen en llano
    assert it["_cierre"]["resumen"] == "Resumen técnico de la iteración." and "llano" not in it["_cierre"]
    # Ahora es el revisor de registro el que se queda sin presupuesto.
    respuestas["en_llano"] = _pred_llano()
    respuestas["revisar_registro"] = sin_presupuesto
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "en_marcha") or True, "ampliar")
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c, it = _corrida(al, ids), _it(al, ids)
    assert c["estado"] == "pausada_por_presupuesto" and it["terminadaEn"] is None and it["_cierre"]["llano"]["titulo"] == "Qué pasó"
    # Con presupuesto, cierra; el resumen técnico y el llano se pagaron una sola vez.
    respuestas.pop("revisar_registro")
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "en_marcha") or True, "ampliar")
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    it = _it(al, ids)
    assert it["terminadaEn"] is not None and "_cierre" not in it
    assert [p for p, _ in llamadas.vistas].count("resumir") == 1 and [p for p, _ in llamadas.vistas].count("en_llano") == 2  # el primero lanzó antes de responder
    assert [p for p, _ in llamadas.vistas].count("concluir") == 1  # la conclusión se conservó por huella en los dos reintentos


def test_el_revisor_no_se_contradice_con_la_frase_de_la_cola_por_regla():
    hips = [{"id": f"h{i}", "investigacionId": "inv", "iteracion": 1, "creadaEn": 1, "titulo": f"H{i}", "decisionKiller": d, "estado": "propuesta"} for i, d in enumerate(["descartar_en_contexto"] * 3 + ["suspender"] * 2 + [None])]
    hips.append({"id": "h9", "investigacionId": "inv", "iteracion": 1, "creadaEn": 1, "titulo": "H9", "decisionKiller": "descartar_en_contexto", "estado": "descartada"})
    e = {"hechos": [], "hipotesis": hips, "ejecuciones": [], "investigaciones": [{"id": "inv", "datasets": []}], "decisiones": []}
    it = {"numero": 1, "empezadaEn": 1000, "plan": [], "pistas": []}
    corpus = RR.corpus_del_registro(e, "inv", it, {"_afirmaciones": [], "busqueda": {"consultas": []}})
    assert corpus["recuentos"]["cola"] == {6} and corpus["recuentos"]["colaDesglose"] == {3, 2, 1} and corpus["recuentos"]["hipotesis"] == {7, 0}
    frase = CO.frase_de_la_cola(e, "inv", 0)
    assert frase.startswith("6 hipótesis en cola: 3 con descarte propuesto por el Killer, 2 suspendidas, 1 sin juzgar")
    # La frase que ROSA2018 genera por regla no puede salir como contradicción del propio revisor
    # (antes: «6 hipótesis» frente a "el registro admite 7, 0").
    assert RR.comprobaciones_deterministas(frase, corpus, it, 0) == []
    # Los desgloses también son verdad; el total falso sigue saltando.
    assert RR.comprobaciones_deterministas("Las 3 hipótesis en cola con descarte propuesto siguen ahí.", corpus, it, 0) == []
    malos = RR.comprobaciones_deterministas("Quedan en cola dos hipótesis.", corpus, it, 0)
    assert len(malos) == 1 and "en cola hay 6" in malos[0]["detalle"]  # 2 suspendidas no salvan un "dos" a secas
    assert RR.comprobaciones_deterministas("Quedan en cola dos hipótesis suspendidas por el Killer.", corpus, it, 0) == []
    assert len(RR.comprobaciones_deterministas("Quedan en cola cuatro hipótesis suspendidas.", corpus, it, 0)) == 1  # ni el desglose cuadra
    # "en cola un total de nueve" no es "en cola una".
    assert RR.recuentos_en_cola("quedan en cola un total de nueve hipótesis") == []
    assert RR.recuentos_en_cola("hay en cola una hipótesis") == [(1, "hay en cola una")]
    assert RR.recuentos_en_cola("Quedan en cola dos.") == [(2, "Quedan en cola dos")]
    # "7 hipótesis" a secas sigue comprobándose contra el total.
    assert RR.recuentos_del_texto("7 hipótesis vivas y 6 hipótesis en cola") == [(7, "hipotesis", "7 hipótesis")]


def test_la_pausa_por_presupuesto_es_espera_humana_y_no_consume_el_tope_en_horas():
    c = {"empezadaEn": 0, "estado": "pausada_por_presupuesto", "esperaHumanaMs": 0, "pausaMs": 0}
    CO.contabilizar_tiempo(c, 1_000)
    assert CO.contabilizar_tiempo(c, 61_000) is True
    assert c["esperaHumanaMs"] == 60_000 and CO.tiempo_trabajo_ms(c, 61_000) == 1_000
    c["estado"] = "en_marcha"
    CO.contabilizar_tiempo(c, 91_000)
    assert c["esperaHumanaMs"] == 60_000 and CO.tiempo_trabajo_ms(c, 91_000) == 31_000


def test_revision_pedida_sin_presupuesto_no_abre_pista_ni_cuenta_intento_y_no_reintenta(monkeypatch):
    al, ids = _preparar()
    _agotar(al, ids, "terminada")
    al.mutar(lambda e: _hip(al, ids).__setitem__("_revisionPedida", True) or True, "pedir")
    sup, ctx, llamadas = _supervisor(al, ids, {}, monkeypatch)

    async def no_deberia_llamarse(*a, **k):
        raise AssertionError("el Killer no debe correr sin presupuesto")

    monkeypatch.setattr(CO.PASOS, "_revisar_hipotesis", no_deberia_llamarse)
    asyncio.run(sup._atender_peticiones())
    h = _hip(al, ids)
    assert "_revisionPedida" not in h and "_killerIntentos" not in h
    assert _it(al, ids)["pistas"] == []  # ni una pista (ni una mutación de 17 MB) por tick
    assert any("no tiene presupuesto" in x for x in h["procedencia"]["registro"])
    eventos = [x for x in al.estado["eventos"] if x["tipo"] == "presupuesto"]
    assert len(eventos) == 1 and "No se pudo revisar" in eventos[0]["texto"]
    assert _corrida(al, ids)["estado"] == "terminada"
    asyncio.run(sup._atender_peticiones())  # segundo tick: nada nuevo
    assert len([x for x in al.estado["eventos"] if x["tipo"] == "presupuesto"]) == 1
    # Si el tope salta ya dentro de la revisión (carrera), tampoco cuenta como "el juez no respondió".
    al2, ids2 = _preparar()
    al2.mutar(lambda e: (next(x for x in e["corridas"] if x["id"] == ids2["cor"]).__setitem__("estado", "terminada"), next(z for z in e["hipotesis"] if z["id"] == ids2["hip"]).__setitem__("_revisionPedida", True), True)[-1], "pedir")
    sup2, _, _ = _supervisor(al2, ids2, {}, monkeypatch)

    async def revienta(*a, **k):
        raise PresupuestoAgotado("tope a mitad")

    monkeypatch.setattr(CO.PASOS, "_revisar_hipotesis", revienta)
    asyncio.run(sup2._atender_peticiones())
    h2 = _hip(al2, ids2)
    assert "_revisionPedida" not in h2 and "_killerIntentos" not in h2
    pistas = _it(al2, ids2)["pistas"]
    assert len(pistas) == 1 and pistas[0]["estado"] == "fallida" and "Sin presupuesto" in pistas[0]["resumen"]


def test_la_pista_de_evidencia_no_queda_en_curso_si_acumular_revienta(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)

    async def revienta(ctx, numero, pista):
        raise ValueError("gateway raro")

    monkeypatch.setattr(CO.EV, "acumular", revienta)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    it = _it(al, ids)
    assert it["terminadaEn"] is not None
    pista = next(p for p in it["pistas"] if p["titulo"].startswith("Evidencia nueva"))
    assert pista["estado"] == "fallida" and "gateway raro" in pista["resumen"]


def test_el_reloj_en_memoria_olvida_corridas_que_ya_no_existen(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    sup._reloj["cor-borrada"] = {"estado": "en_marcha", "esperaHumanaMs": 0, "pausaMs": 0, "_ultimoTic": None, "volcadoEn": 0, "estadoVolcado": "en_marcha"}
    sup._fallos["cor-borrada"] = {"n": 1}
    sup._reloj_en_memoria(al.estado, 5_000)
    assert "cor-borrada" not in sup._reloj and "cor-borrada" not in sup._fallos and ids["cor"] in sup._reloj
