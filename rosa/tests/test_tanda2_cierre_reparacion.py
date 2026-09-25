"""Reparación de los hallazgos del adversario sobre el constructor "cierre"
(tanda 2 de la revisión del 17 de septiembre de 2026, segunda pasada). Cada
test falla sin su arreglo y ninguno llama a la red ni al gateway: el modelo es
un doble o está prohibido (`_llamar_prohibido`).

1. La réplica resuelve una cita por los otros ids de la MISMA obra
   (`_idsEquivalentes`, DOI compartido entre corridas) y nunca cae a la
   referencia corta cuando la fuente existe pero no tiene ese localizador
   (S-04: caería en una homónima).
2. Un veredicto negativo sobre el pasaje guardado, sin releer la fuente, es
   "no pude comprobar", nunca una contradicción; solo lo releído contradice.
3. El "último" partido de un par se decide por su posición en la serie (y por
   el instante `_t`), no por el número de iteración, que se reinicia en cada
   corrida (M-20).
4. La reserva del cierre no cuenta una conclusión por hipótesis viva y la
   solicitud de gasto grande separa el coste del plan y la reserva.
5. El recálculo del cierre y el de `marcar_candidatas` son la misma regla y la
   misma frase (M-06 y M-07), sin duplicar el registro.
6. Dos obras con el mismo título y DOI distinto no se funden.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from typing import Any

import pytest

from rosa import certeza as CERTEZA
from rosa import torneo
from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle import evidencia as EV
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import _limpiar_para_cliente
from rosa.tests.test_integracion_corrida import _preparar, _supervisor
from rosa.tests.test_integracion_pasos import _afirmacion, _ctx, _hipotesis
from rosa.tests.test_tanda1_corrida import _corrida, _it


def _corrida_con_fuente(e: dict[str, Any], inv_id: str, numero: int, fuente_id: str, referencia: str, fragmentos: list[tuple[str, str]], **datos: Any) -> dict[str, Any]:
    """Una corrida terminada con una fuente privada, sus fragmentos (localizador, texto) y los demás datos bibliográficos que se den por nombre (el DOI, el título)."""
    c = P.nueva_corrida(inv_id, numero, 1000)
    c["estado"] = "terminada"
    c["_fuentes"] = {fuente_id: {"id": fuente_id, "referencia": referencia, "titulo": datos.pop("titulo", f"Obra {fuente_id}"), **datos, "fragmentos": [{"localizador": loc, "texto": texto, "encabezado": "Results"} for loc, texto in fragmentos]}}
    e["corridas"].append(c)
    return c


def _llamar_prohibido(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """El modelo no se llama en estos tests: si algo lo intenta, se anota y lanza."""
    intentos: list[Any] = []

    async def llamar(self, rol, programa, **kw):
        intentos.append((rol, programa))
        raise RuntimeError("en los tests no se llama al modelo")

    monkeypatch.setattr(Ctx, "llamar", llamar)
    return intentos


def _h(al, hid: str) -> dict[str, Any]:
    return next(x for x in al.estado["hipotesis"] if x["id"] == hid)


# ---------------------------------------------------------------------------
# 1. La réplica resuelve por la misma obra, nunca por una homónima
# ---------------------------------------------------------------------------


def test_la_replica_resuelve_por_el_id_equivalente_de_la_misma_obra_antes_que_por_la_referencia():
    e = P.estado_inicial()
    # X (corrida 1) solo tiene el resumen; Z (corrida 2) es una obra DISTINTA con la misma
    # referencia corta y sí tiene la página 7; Y (corrida 3) es la MISMA obra que X (mismo
    # DOI), registrada con otro id y otra referencia corta, y tiene la página 7.
    _corrida_con_fuente(e, "inv", 1, "f-x", "A et al., 2025", [("resumen", "Resumen de la obra X.")], doi="10.1000/x")
    _corrida_con_fuente(e, "inv", 2, "f-z", "A et al., 2025", [("pág. 7", "Texto de la obra Z, homónima y distinta.")], doi="10.1000/z")
    _corrida_con_fuente(e, "inv", 3, "f-y", "A et al., 2025b", [("pág. 7", "GENHEP increases in reactive astrocytes of the hippocampus, page seven of X.")], doi="https://doi.org/10.1000/X")
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x", cita="[A et al., 2025, pág. 7]")])
    frags = T.fragmentos_de_investigacion(e, "inv")
    equivalentes = EV.ids_equivalentes_en_investigacion(e, "inv")
    assert equivalentes == {"f-x": {"f-y"}, "f-y": {"f-x"}}, "X e Y comparten DOI; Z no se funde con nadie"
    copias, comprobables, guardados, citas = CO._preparar_copias_replica(h, frags, equivalentes)
    assert citas == {"total": 1, "resuelven": 1, "guardadas": 0, "sinComprobar": 0}
    assert comprobables[0]["fuenteId"] == "f-y" and comprobables[0]["fragmento"].startswith("GENHEP increases") and guardados == []
    # Sin el mapa, lo anotado en la procedencia (`_idsEquivalentes`) basta, en los dos sentidos.
    h["procedencia"]["fuentes"][0].update({"id": "f-x", "_idsEquivalentes": ["f-y"]})
    assert CO.ids_equivalentes_de(h, "f-x") == ["f-y"]
    assert CO._preparar_copias_replica(h, frags)[1][0]["fuenteId"] == "f-y"
    h["procedencia"]["fuentes"][0].update({"id": "f-y", "_idsEquivalentes": ["f-x", "f-x", None]})
    assert CO.ids_equivalentes_de(h, "f-x") == ["f-y"]
    assert CO._preparar_copias_replica(h, frags)[3]["resuelven"] == 1
    # Sin equivalencia conocida, X existe pero no tiene la página 7: pasaje guardado, nunca Z.
    h["procedencia"]["fuentes"][0].pop("_idsEquivalentes")
    e["corridas"] = [c for c in e["corridas"] if c["numero"] != 3]
    frags = T.fragmentos_de_investigacion(e, "inv")
    copias, comprobables, guardados, citas = CO._preparar_copias_replica(h, frags, EV.ids_equivalentes_en_investigacion(e, "inv"))
    assert citas == {"total": 1, "resuelven": 0, "guardadas": 1, "sinComprobar": 0}
    assert comprobables[0]["noReleida"] is True and comprobables[0]["fuenteId"] == "f-x" and guardados[0].fuente_id == "f-x"
    # `citas_de_replica` (lo que la pantalla enseña antes de lanzar) usa el mismo mapa.
    e["hipotesis"].append(h)
    assert CO.citas_de_replica(e, h)["guardadas"] == 1
    _corrida_con_fuente(e, "inv", 3, "f-y", "A et al., 2025b", [("pág. 7", "GENHEP increases in reactive astrocytes of the hippocampus, page seven of X.")], doi="10.1000/x")
    assert CO.citas_de_replica(e, h) == {"total": 1, "resuelven": 1, "guardadas": 0, "sinComprobar": 0}


def test_sin_pasaje_guardado_el_motivo_dice_que_la_fuente_no_tiene_ese_localizador():
    e = P.estado_inicial()
    _corrida_con_fuente(e, "inv", 1, "f-x", "A et al., 2025", [("resumen", "Resumen de X.")])
    _corrida_con_fuente(e, "inv", 2, "f-z", "A et al., 2025", [("pág. 7", "Texto de Z.")])
    frags = T.fragmentos_de_investigacion(e, "inv")
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x", cita="[A et al., 2025, pág. 7]", fragmento="")])
    copias, comprobables, _, citas = CO._preparar_copias_replica(h, frags)
    assert comprobables == [] and citas == {"total": 1, "resuelven": 0, "guardadas": 0, "sinComprobar": 1}
    assert copias[0]["veredicto"] == "cita_no_resuelve" and copias[0]["noComprobable"] is True
    assert "no tiene el localizador de la cita [A et al., 2025, pág. 7] (tiene: resumen)" in copias[0]["motivo"], copias[0]["motivo"]
    assert copias[0]["motivo"].endswith("no se puede comprobar en la réplica.")
    # Sin cita ni pasaje tampoco rompe, y lo dice.
    h2 = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x", cita="", fragmento="")])
    copias2, comprobables2, _, _ = CO._preparar_copias_replica(h2, frags)
    assert comprobables2 == [] and copias2[0]["motivo"].startswith("La afirmación no lleva cita.")
    # Una afirmación sin fuenteId resuelve por referencia y localizador, como siempre.
    h3 = _hipotesis(afirmaciones=[_afirmacion(fuenteId=None, cita="[A et al., 2025, pág. 7]")])
    assert CO._preparar_copias_replica(h3, frags)[1][0]["fuenteId"] == "f-z"


# ---------------------------------------------------------------------------
# 2. Sin releer la fuente no hay contradicción
# ---------------------------------------------------------------------------


def test_el_determinista_sobre_el_pasaje_guardado_deja_la_trayectoria_en_no_comprobable_y_lo_dice(monkeypatch):
    """Camino real (sin dobles del verificador): el NCT de la afirmación estaba en
    otra frase de la página; sobre los 600 caracteres del pasaje el determinista
    dice `no_sostenida` sin llamar al juez. Eso es "no pude comprobar"."""
    al, ctx = _ctx()
    intentos = _llamar_prohibido(monkeypatch)
    texto = "In CLARITY AD (NCT03887455), lecanemab reduced brain amyloid by 59 centiloids at 18 months"
    pasaje = "Lecanemab reduced brain amyloid by 59 centiloids at 18 months compared with placebo in the modified intention-to-treat population."
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-perdida", cita="[A et al., 2025, pág. 3]", texto=texto, fragmento=pasaje)])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    assert intentos == []
    x = _h(al, h["id"])
    r = x["replicacion"]
    assert (r["hechas"], r["sostienen"], r["contradicen"], r["noComprobables"], r["negativasSinReleer"], r["estado"]) == (1, 0, 0, 1, 1, "terminada")
    assert r["trayectorias"] == [{"n": 1, "resultado": "no_comprobable", "comprobadas": 1, "juzgadas": 0, "apoyan": 0, "noReleidas": 1, "noComprobables": 1}]
    mensajes = [m["texto"] for m in x["procedencia"]["mensajes"]]
    assert any("0 de 1 trayectorias sostienen las afirmaciones, 0 las contradicen y 1 no se pudieron comprobar" in m and "1 veredicto negativo sobre pasaje guardado no cuenta como contradicción" in m for m in mensajes), mensajes
    al.cerrar()


def test_solo_lo_releido_contradice_y_el_negativo_sin_releer_queda_como_no_comprobable(monkeypatch):
    al, ctx = _ctx()

    def fuentes(e):
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        c["_fuentes"] = {"f-r": {"id": "f-r", "referencia": "B et al., 2024", "titulo": "Obra releída", "fragmentos": [{"localizador": "pág. 2", "texto": "GENHEP does not change in astrocytes of this cohort.", "encabezado": "Results"}]}}
        return True

    al.mutar(fuentes, "fuentes")
    h = _hipotesis(afirmaciones=[
        _afirmacion(fuenteId="f-perdida", texto="In CLARITY AD (NCT03887455), lecanemab reduced amyloid by 59 centiloids", fragmento="Lecanemab reduced amyloid by 59 centiloids at 18 months."),
        _afirmacion(afirmacionId="af-2", fuenteId="f-r", cita="[B et al., 2024, pág. 2]", texto="GENHEP increases in astrocytes of this cohort", fragmento="GENHEP does not change"),
    ])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    vistas: dict[str, Any] = {}

    async def verificar(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        vistas["copias"] = copias
        for a in copias:
            a["veredicto"] = "no_sostenida"
            a["motivo"] = "Identificadores que no aparecen en el fragmento citado: NCT03887455." if a.get("noReleida") else "El fragmento dice lo contrario."
        return {}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar)
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    no_releida = next(a for a in vistas["copias"] if a.get("noReleida"))
    releida = next(a for a in vistas["copias"] if not a.get("noReleida"))
    assert no_releida["veredicto"] == "sin_verificar" and no_releida["noComprobable"] is True and no_releida["veredictoJuez"] == "no_sostenida"
    assert no_releida["motivo"].startswith("La fuente no se pudo releer y el pasaje guardado al extraer no basta para contradecir") and no_releida["motivo"].endswith("NCT03887455.")
    assert releida["veredicto"] == "no_sostenida", "lo releído sí contradice"
    r = _h(al, h["id"])["replicacion"]
    assert (r["sostienen"], r["contradicen"], r["noComprobables"], r["negativasSinReleer"]) == (0, 1, 0, 1)
    assert r["trayectorias"][0] == {"n": 1, "resultado": "contradice", "comprobadas": 2, "juzgadas": 1, "apoyan": 0, "noReleidas": 1, "noComprobables": 1}
    # Un bloqueo distinto de `no_sostenida` sobre el pasaje guardado (el juez lo dio por cita no resuelta) tampoco contradice.
    h2 = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-perdida")])
    h2["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")

    async def bloqueo(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        for a in copias:
            a["veredicto"], a["motivo"] = "cita_no_resuelve", "raro"
        return {}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", bloqueo)
    asyncio.run(sup._replicar_paso(ctx, h2))
    r2 = _h(al, h2["id"])["replicacion"]
    assert (r2["contradicen"], r2["noComprobables"], r2["trayectorias"][0]["resultado"]) == (0, 1, "no_comprobable")
    al.cerrar()


# ---------------------------------------------------------------------------
# 3. El último partido de un par no se elige por el número de iteración
# ---------------------------------------------------------------------------


def test_registrar_partido_guarda_el_instante_y_partidos_unicos_ordena_por_posicion_en_la_serie():
    def hip(i: str) -> dict[str, Any]:
        return {"id": i, "titulo": i, "estado": "propuesta", "elo": 1500, "rivales": [], "partidos": [], "historialElo": [], "revisionesAutomaticas": []}

    a, b = hip("a"), hip("b")
    torneo.registrar_partido(a, b, True, 3, "debate", "eje")  # corrida 8, iteración 3
    torneo.registrar_partido(a, b, False, 1, "debate", "eje")  # corrida 9, iteración 1: el más reciente
    assert all(isinstance(p.get("_t"), int) and p["_t"] > 1_600_000_000_000 for p in a["partidos"] + b["partidos"])
    assert a["partidos"][0]["_t"] <= a["partidos"][1]["_t"]
    assert torneo._partidos_unicos([a, b]) == [("b", "a")], "el último partido lo ganó b aunque su número de iteración sea menor"
    assert "_t" not in _limpiar_para_cliente(a)["partidos"][0], "el instante es privado del bucle"
    # A igual posición en la serie (registros descuadrados) decide `_t`; sin `_t`, la iteración; los valores raros no rompen.
    x = {"id": "x", "estado": "propuesta", "elo": 1500, "partidos": [{"rivalId": "y", "resultado": "gano", "iteracion": 1, "_t": 10}]}
    y = {"id": "y", "estado": "propuesta", "elo": 1500, "partidos": [{"rivalId": "x", "resultado": "gano", "iteracion": 3, "_t": 20}]}
    assert torneo._partidos_unicos([x, y]) == [("y", "x")]
    x["partidos"][0]["_t"], y["partidos"][0]["_t"] = 30, None
    assert torneo._partidos_unicos([x, y]) == [("x", "y")]
    x["partidos"][0]["_t"] = "raro"
    assert torneo._partidos_unicos([x, y]) == [("y", "x")], "sin instante legible decide la iteración"
    # Un rival que ya no está entre las hipótesis no cuenta ni desplaza la posición de los demás.
    x["partidos"].insert(0, {"rivalId": "z", "resultado": "gano"})
    assert torneo._partidos_unicos([x, y]) == [("y", "x")]
    assert torneo._partidos_unicos([{"id": "solo", "estado": "propuesta", "elo": 1500, "partidos": ["texto", None]}]) == []


# ---------------------------------------------------------------------------
# 4. La reserva del cierre y la solicitud de gasto grande
# ---------------------------------------------------------------------------


def _con_conclusion_al_dia(h: dict[str, Any]) -> dict[str, Any]:
    h["conclusion"] = {"certeza": "muy_baja", "direccion": "apoya", "enunciado": "x", "iteracion": 1, "fecha": 1}
    h["_conclusionIntentada"] = 1
    h["conclusion"]["huella"] = CO.huella_de_conclusion(h)
    assert CO.motivo_para_reconcluir(h) is None
    return h


def test_la_reserva_del_cierre_no_cuenta_una_conclusion_por_hipotesis_viva():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "Grande", "objetivo": "GENHEP", "condicionParada": "3 iteraciones"}, 1000)
    for _ in range(28):
        h = _con_conclusion_al_dia(_hipotesis())
        h["investigacionId"] = inv
        e["hipotesis"].append(h)
    next(i for i in e["investigaciones"] if i["id"] == inv)["vivero"] = [{"id": f"sem-{k}"} for k in range(7)]
    d = CO.desglose_previsto_del_cierre(e, inv)
    assert d == {"resumen": 1, "meta": 1, "llano": 1, "evidencia": EV.MAX_HIPOTESIS_POR_CIERRE + 7, "conclusiones": CO.RESERVA_CONCLUSIONES_EXTRA, "revisor": 1, "reparacion": 2}
    assert CO.coste_previsto_del_cierre(e, inv) == sum(d.values()) < 59, "antes: 3 + 1 + 20 + 28 + 7 = 59"
    # Las que ya tienen motivo para reconcluir (sin conclusión, evidencia marcada) se suman a la reserva, sin pasar de las vivas.
    for h in e["hipotesis"][:2]:
        h.pop("conclusion")
    assert CO.desglose_previsto_del_cierre(e, inv)["conclusiones"] == 2 + CO.RESERVA_CONCLUSIONES_EXTRA
    for h in e["hipotesis"]:
        h.pop("conclusion", None)
        h["estado"] = "descartada" if e["hipotesis"].index(h) >= 2 else h["estado"]
    assert CO.desglose_previsto_del_cierre(e, inv)["conclusiones"] == 2 and CO.desglose_previsto_del_cierre(e, inv)["evidencia"] == 2 + 7
    assert CO.coste_previsto_del_cierre({"hipotesis": [None, "texto"], "investigaciones": []}, inv) == 5  # resumen, llano, revisor y la vuelta de reparación (2)


def test_el_plan_guarda_la_reserva_del_cierre_aparte_y_la_solicitud_de_gasto_grande_la_separa(monkeypatch):
    al, ids = _preparar()
    plan = SimpleNamespace(plan=[SimpleNamespace(tipo="literatura", titulo="Leer", detalle="d", valor_decision="", espera="", si_no_aparece="")])
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
        c["presupuesto"]["limiteLlamadas"] = 60
        c["gasto"]["llamadas"] = 0
        e["autonomia"]["gastar_grande"] = "preguntar"
        return True

    al.mutar(preparar, "preparar")
    reserva = CO.coste_previsto_del_cierre(al.estado, ids["inv"])
    asyncio.run(sup._proponer_plan(_corrida(al, ids), None))
    it = [i for i in al.estado["iteraciones"] if i["corridaId"] == ids["cor"]][-1]
    del_plan = max(sum(p["presupuesto"] for p in it["plan"]), 20)
    assert it["presupuesto"] == {"limite": del_plan + reserva, "usado": 0, "reservaCierre": reserva}
    # Con 60 llamadas en la corrida, el tope (plan más reserva) pasa de la mitad: se pide permiso y el detalle separa las dos cifras.
    assert asyncio.run(sup._permiso_presupuesto(_corrida(al, ids), it)) is False
    s = next(x for x in al.estado["solicitudes"] if x["tipo"] == "presupuesto_grande")
    assert s["titulo"] == f"La iteración 1 quiere gastar {del_plan + reserva} llamadas de las 60 que quedan"
    assert s["detalle"].startswith(f"Es más de la mitad del presupuesto restante: {del_plan} llamadas son para los pasos del plan y {reserva} quedan reservadas para el cierre de la iteración (resumen, evidencia nueva")
    assert s["detalle"].endswith("Puedes ajustar cuántas llamadas permitir.") and s["argumentos"][0]["valor"] == str(del_plan + reserva)
    # Una iteración antigua sin reserva guardada, o con una reserva que no cabe en el tope, recibe el texto de siempre.
    assert CO.detalle_de_gasto_grande({"presupuesto": {"limite": 40, "usado": 0}}) == "Es más de la mitad del presupuesto restante. Puedes ajustar cuántas llamadas permitir."
    assert CO.detalle_de_gasto_grande({"presupuesto": {"limite": 40, "reservaCierre": 90}}) == CO.detalle_de_gasto_grande({}) == CO.detalle_de_gasto_grande({"presupuesto": "raro"})
    al.cerrar()


# ---------------------------------------------------------------------------
# 5. Una sola regla y una sola frase para las dos rutas de recálculo
# ---------------------------------------------------------------------------


def _estado_sin_evidencia_directa(certeza: str = "baja", supuesto: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    e = P.estado_inicial()
    h = _hipotesis(afirmaciones=[_afirmacion(relacion="apoya_indirecta")])
    titulo = "GENHEP sube en astrocitos reactivos"
    h["conclusion"] = {"certeza": certeza, "direccion": "sin_evidencia_directa", "direccionDelJuez": "mixta", "hipotesisBreve": titulo, "enunciado": CO.frase_plantilla("sin_evidencia_directa", certeza, titulo, supuesto_contradicho=supuesto), "conclusion": "x", "factores": [], "base": {}, "aFavor": [], "enContra": [], "loMasFragil": "", "subiria": "", "bajaria": "", "noComprobado": [], "cambio": None, "fechaBusqueda": None, "fecha": 100, "iteracion": 1}
    e["hipotesis"].append(h)
    return e, h


def test_el_recalculo_del_cierre_usa_la_regla_canonica_conserva_el_supuesto_y_no_duplica_el_registro():
    e, h = _estado_sin_evidencia_directa()
    copia = copy.deepcopy(h)
    n_ev = len(e["eventos"])
    cambios = CO.recalcular_conclusiones_por_regla(e, 5000)
    CERTEZA.reacotar_conclusion(copia, 5000)
    k = h["conclusion"]
    assert cambios and cambios[0]["de"] == "baja" and cambios[0]["a"] == "muy_baja" == k["certeza"]
    assert k["enunciado"].startswith("Solo encontramos evidencia indirecta sobre si GENHEP sube en astrocitos reactivos: una afirmación"), "la variante M-06 llega a la conclusión real"
    assert CO.MARCA_SUPUESTO_CONTRADICHO in k["enunciado"], "el supuesto contradicho (M-07) se conserva al recalcular"
    assert {c: k[c] for c in ("certeza", "techo", "escalera", "enunciado", "cohortesDistintas")} == {c: copia["conclusion"][c] for c in ("certeza", "techo", "escalera", "enunciado", "cohortesDistintas")}, "misma conclusión por las dos rutas"
    assert k["cambio"]["de"]["certeza"] == "baja" and k["recalculadaEn"] == 5000
    lineas = [r for r in h["procedencia"]["registro"] if "recalcular el techo por regla" in r]
    assert len(lineas) == 1, lineas
    assert len(e["eventos"]) == n_ev + 1 and "bajó de baja a muy baja" in e["eventos"][-1]["texto"] and e["aprendizaje"][-1]["tipo"] == "creencia"
    # Idempotente: la segunda pasada no toca nada ni añade líneas ni eventos.
    antes = copy.deepcopy(h)
    assert CO.recalcular_conclusiones_por_regla(e, 6000) == [] and h == antes and len(e["eventos"]) == n_ev + 1
    # Sin supuesto contradicho no se inventa.
    e2, h2 = _estado_sin_evidencia_directa(supuesto=False)
    CO.recalcular_conclusiones_por_regla(e2, 5000)
    assert CO.MARCA_SUPUESTO_CONTRADICHO not in h2["conclusion"]["enunciado"] and h2["conclusion"]["enunciado"].startswith("Solo encontramos evidencia indirecta")


def test_frase_plantilla_de_corrida_es_la_canonica_con_la_variante_de_supuesto_contradicho():
    for direccion in ("apoya", "mixta", "en_contra", "sin_evidencia_directa"):
        for certeza in CERTEZA.NIVELES:
            for supuesto in (False, True):
                for indirectas in (None, 2):
                    a = CO.frase_plantilla(direccion, certeza, "GFAP sube antes que NfL", supuesto_contradicho=supuesto, indirectas=indirectas)
                    b = CERTEZA.frase_plantilla(direccion, certeza, "GFAP sube antes que NfL", supuesto_contradicho=supuesto, indirectas=indirectas)
                    assert a == b, (direccion, certeza, supuesto, indirectas, a, b)
                    assert ("\u2014" not in a) and (supuesto == (CO.MARCA_SUPUESTO_CONTRADICHO in a) or direccion in ("mixta", "en_contra"))
    # La conclusión del juez lleva el recuento de apoyos indirectos a la frase (M-06 también al concluir).
    frase = CO.frase_plantilla("sin_evidencia_directa", "muy_baja", "GFAP sube antes", indirectas=3)
    assert frase.startswith("Solo encontramos evidencia indirecta sobre si GFAP sube antes: 3 afirmaciones")


# ---------------------------------------------------------------------------
# 6. Mismo título, otro DOI: dos obras
# ---------------------------------------------------------------------------


def test_fuente_equivalente_no_funde_dos_obras_con_el_mismo_titulo_y_doi_distinto():
    articulo = {"id": "a", "titulo": "Lecanemab in Early Alzheimer's Disease", "doi": "10.1056/NEJMoa2212948"}
    carta = {"id": "c", "titulo": "Lecanemab in Early Alzheimer's Disease", "doi": "10.1056/NEJMc2301380"}
    assert EV.obras_distintas_por_doi(articulo, carta) is True and EV.obras_distintas_por_doi(articulo, {"id": "s"}) is False and EV.obras_distintas_por_doi(None, carta) is False
    assert EV.fuente_equivalente([articulo], carta) is None, "la carta al editor lleva el título del artículo con otro DOI: no es la misma obra"
    assert EV.fuente_equivalente([articulo], {"id": "b", "titulo": "Lecanemab in Early Alzheimer's Disease"}) is articulo, "sin DOI en una de las dos, el título sigue valiendo (regla de pasos.py)"
    assert EV.fuente_equivalente([articulo], {"id": "d", "doi": "https://doi.org/10.1056/nejmoa2212948."}) is articulo
    assert EV.fuente_equivalente([carta, articulo], {"id": "d", "doi": "doi: 10.1056/NEJMOA2212948"}) is articulo
    # El mapa de la investigación: un título compartido por dos DOI no agrupa a nadie, tampoco a la fuente sin DOI que lo lleva.
    e = {
        "corridas": [{"investigacionId": "inv", "_fuentes": {"a": articulo, "c": carta, "s": {"id": "s", "titulo": "Lecanemab in Early Alzheimer's Disease"}, "r": {"id": "r", "doi": "10.1056/NEJMoa2212948"}, "sin-id": {"titulo": "x"}}}, {"investigacionId": "otra", "_fuentes": {"o": {"id": "o", "doi": "10.1056/NEJMoa2212948"}}}, {"investigacionId": "inv", "_fuentes": "raro"}, None],
        "hipotesis": [{"investigacionId": "inv", "procedencia": {"fuentes": [{"id": "p", "_idsEquivalentes": ["q", None]}, "texto", {"id": None}]}}, {"investigacionId": "inv", "procedencia": "raro"}, None],
    }
    assert EV.ids_equivalentes_en_investigacion(e, "inv") == {"a": {"r"}, "r": {"a"}, "p": {"q"}, "q": {"p"}}
    assert EV.ids_equivalentes_en_investigacion({}, "inv") == {} and EV.ids_equivalentes_en_investigacion({"corridas": [None], "hipotesis": "raro"}, "inv") == {}
    assert CO.ids_equivalentes_de({"procedencia": "raro"}, "x") == [] and CO.ids_equivalentes_de({}, "x", {"x": {"y", "x"}}) == ["y"]
