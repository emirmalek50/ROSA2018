"""Tanda 2 de la revisión del 17 de septiembre de 2026, constructor "cierre":
lo que quedaba abierto en HEAD de S-13, S-14, B-02, M-07, M-14, S-27 y S-06 b.
Cada test falla sin su arreglo y ninguno llama a la red ni al gateway: los
modelos son dobles (`Ctx.llamar` simulado por nombre de programa).

- S-13: una sola huella de evidencia (la del Killer); el torneo agota los
  pares no jugados antes de cualquier revancha y solo rejuega con evidencia
  nueva o tras tablas; Bradley-Terry cuenta cada par una vez por estado de la
  evidencia; `ranking_cambio` solo cuando cambia el orden.
- S-14: coste del cierre calculado antes de entrar (pausa con desglose si no
  cabe; aviso con lo que falta si el tope salta dentro) y retroceso
  exponencial del relanzamiento a partir del cuarto fallo.
- B-02: la parada se reevalúa dentro de la mutación que crea la iteración y
  antes de pedir permiso de gasto.
- M-07: "sin evidencia directa" con un supuesto contradicho lo dice.
- M-14: techo, escalera y min(juez, techo) recalculados por regla al arrancar
  y al cerrar, también para investigaciones sin corrida, con evento si baja.
- S-27: la réplica lee los fragmentos de todas las corridas, juzga el pasaje
  guardado como "no releído" con máximo parcial y cuenta lo incomprobable
  aparte de las contradicciones; expone cuántas citas resuelven.
- S-06 b: la misma obra con otro id no entra dos veces en la procedencia.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from typing import Any

from rosa import certeza as CERTEZA
from rosa import killer as K
from rosa import torneo
from rosa import verificador as V
from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle import evidencia as EV
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.modulos.contador import PresupuestoAgotado
from rosa.tests.test_integracion_corrida import _hip, _pred_conclusion, _preparar, _supervisor
from rosa.tests.test_integracion_pasos import _afirmacion, _ctx, _hipotesis
from rosa.tests.test_tanda1_corrida import _abrir_iteracion, _corrida, _it, _respuestas_cierre


def _h(al, hid: str) -> dict[str, Any]:
    return next(x for x in al.estado["hipotesis"] if x["id"] == hid)


# ---------------------------------------------------------------------------
# S-13: una sola huella, torneo sin revanchas vacías, Bradley-Terry sin duplicados
# ---------------------------------------------------------------------------


def test_la_huella_de_evidencia_es_una_sola_la_del_killer():
    h = _hipotesis()
    assert CO.huella_evidencia(h) == K.huella_evidencia(h) == PASOS._huella(h)
    assert not hasattr(CO, "_huella_evidencia_local"), "la copia local de corrida.py daba otro hash para la misma evidencia"
    # No cambia con partidos ni Elo; sí con un veredicto.
    assert CO.huella_evidencia({**h, "partidos": [{"rivalId": "x", "resultado": "gano"}], "elo": 1600}) == CO.huella_evidencia(h)
    cambiada = copy.deepcopy(h)
    cambiada["afirmaciones"][0]["veredicto"] = "parcial"
    assert CO.huella_evidencia(cambiada) != CO.huella_evidencia(h)
    # Registros raros no la tumban (misma tolerancia que exigía la tanda 1).
    CO.huella_de_conclusion({"afirmaciones": ["texto", None], "supuestos": "texto", "novedad": None, "procedencia": "texto", "experimento": "texto"})


def _hip_torneo(i: str, elo: int, rivales=(), partidos=()) -> dict[str, Any]:
    return {"id": i, "titulo": i, "estado": "propuesta", "elo": elo, "rivales": list(rivales), "partidos": list(partidos), "historialElo": [], "revisionesAutomaticas": []}


def _partido(rival: str, resultado: str, propia: str = "", ajena: str = "", iteracion: int = 1) -> dict[str, Any]:
    p = {"rivalId": rival, "resultado": resultado, "iteracion": iteracion}
    if propia or ajena:
        p["_huellaPropia"], p["_huellaRival"] = propia, ajena
    return p


def test_emparejar_agota_los_pares_no_jugados_antes_de_las_revanchas():
    # a y b ya jugaron entre sí; c y d han jugado (contra alguien de fuera) pero
    # nunca contra a ni b. Todos con el mismo Elo.
    a = _hip_torneo("a", 1500, ["b"], [_partido("b", "gano")])
    b = _hip_torneo("b", 1500, ["a"], [_partido("a", "perdio")])
    c = _hip_torneo("c", 1500, ["z"], [_partido("z", "gano")])
    d = _hip_torneo("d", 1500, ["z"], [_partido("z", "gano")])
    pares = [frozenset((x["id"], y["id"])) for x, y in torneo.emparejar([a, b, c, d], maximo=2, semilla=0)]
    assert frozenset(("a", "b")) not in pares, "la revancha a-b no puede ir antes que un par que nunca se enfrentó"
    assert len(pares) == 2
    # Con hueco de sobra y sin huellas, la revancha entra al final (regla antigua: Elo a menos de 100).
    pares = [frozenset((x["id"], y["id"])) for x, y in torneo.emparejar([a, b], maximo=6, semilla=0)]
    assert pares == [frozenset(("a", "b"))]
    a["elo"] = 1620
    assert torneo.emparejar([a, b], maximo=6, semilla=0) == [], "a 120 puntos de Elo la regla antigua no rejuega"


def _par_jugado(hu_a="HA", hu_b="HB", resultado_a="gano") -> tuple[dict[str, Any], dict[str, Any]]:
    inverso = {"gano": "perdio", "perdio": "gano", "tablas": "tablas"}[resultado_a]
    a = _hip_torneo("a", 1500, ["b"], [_partido("b", resultado_a, hu_a, hu_b)])
    b = _hip_torneo("b", 1500, ["a"], [_partido("a", inverso, hu_b, hu_a)])
    return a, b


def test_con_huellas_solo_hay_revancha_con_evidencia_nueva_o_tras_unas_tablas():
    a, b = _par_jugado()
    assert torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB"}) == [], "misma evidencia que en el último partido: no se rejuega"
    assert len(torneo.emparejar([a, b], huellas={"a": "HA2", "b": "HB"})) == 1, "evidencia nueva en a: revancha"
    assert len(torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB2"})) == 1, "evidencia nueva en b: revancha"
    a, b = _par_jugado(resultado_a="tablas")
    assert len(torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB"})) == 1, "tras unas tablas se rejuega una vez"
    a["partidos"].append(dict(a["partidos"][0]))
    b["partidos"].append(dict(b["partidos"][0]))
    assert torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB"}) == [], "dos tablas seguidas con la misma evidencia: basta"
    a, b = _par_jugado(hu_a="", hu_b="")
    assert len(torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB"})) == 1, "un partido antiguo sin huella se juega una vez más"
    # La regla es la misma que la que la tanda 1 dejó en pasos.py: las dos no divergen.
    for a, b, huellas in ((_par_jugado() + ({"a": "HA", "b": "HB"},)), (_par_jugado() + ({"a": "X", "b": "HB"},)), (_par_jugado(resultado_a="tablas") + ({"a": "HA", "b": "HB"},))):
        assert torneo.revancha_permitida(a, b, huellas) is (not PASOS.par_sin_evidencia_nueva(a, b, huellas)), (a["partidos"], huellas)
    # Los forzados (redundantes por el Killer) se juegan aunque la evidencia sea la misma.
    a, b = _par_jugado()
    assert len(torneo.emparejar([a, b], huellas={"a": "HA", "b": "HB"}, forzados=[("a", "b")])) == 1


def test_bradley_terry_cuenta_cada_par_una_vez_por_estado_de_la_evidencia():
    def h(i: str, partidos: list[dict[str, Any]]) -> dict[str, Any]:
        return {"id": i, "estado": "propuesta", "elo": 1500, "partidos": partidos}

    # a ganó a b cinco veces con la MISMA evidencia (el torneo rejugaba cada cierre) y a c una vez.
    a = h("a", [_partido("b", "gano", "HA", "HB", k) for k in range(1, 6)] + [_partido("c", "gano", "HA", "HC", 1)])
    b = h("b", [_partido("a", "perdio", "HB", "HA", k) for k in range(1, 6)])
    c = h("c", [_partido("a", "perdio", "HC", "HA", 1)])
    unicos = torneo._partidos_unicos([a, b, c])
    assert sorted(unicos) == [("a", "b"), ("a", "c")], unicos
    bt = torneo.bradley_terry([a, b, c], remuestras=30)
    assert bt["a"]["fuerza"] > bt["b"]["fuerza"] and bt["a"]["fuerza"] > bt["c"]["fuerza"]
    assert bt["a"]["partidos"] == 6 and bt["a"]["partidosUnicos"] == 2, "la cifra que ve la persona son los partidos jugados; al ajuste entran los únicos"
    # La quinta con evidencia nueva en a sí es otra observación.
    a["partidos"][4]["_huellaPropia"] = "HA2"
    b["partidos"][4]["_huellaRival"] = "HA2"
    assert len(torneo._partidos_unicos([a, b, c])) == 3
    # Partidos antiguos sin huella: se colapsan al último por par (el resultado más reciente manda).
    x = h("x", [_partido("y", "gano", iteracion=1), _partido("y", "perdio", iteracion=3)])
    y = h("y", [_partido("x", "perdio", iteracion=1), _partido("x", "gano", iteracion=3)])
    assert torneo._partidos_unicos([x, y]) == [("y", "x")]
    # Las tablas no cuentan y una revancha con el ganador cambiado y la misma evidencia se queda con la última.
    p = h("p", [_partido("q", "gano", "HP", "HQ", 1), _partido("q", "perdio", "HP", "HQ", 2), _partido("q", "tablas", "HP", "HQ", 3)])
    q = h("q", [_partido("p", "perdio", "HQ", "HP", 1), _partido("p", "gano", "HQ", "HP", 2), _partido("p", "tablas", "HQ", "HP", 3)])
    assert torneo._partidos_unicos([p, q]) == [("q", "p")]


def test_ranking_cambio_solo_se_emite_cuando_cambia_el_orden_de_las_candidatas(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)
    # Cuatro cierres seguidos: la condición de parada no debe cerrar la corrida antes.
    al.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("condicionParada", "10 iteraciones") or True, "parada")
    candidatas: dict[str, list[str]] = {"ids": [ids["hip"]]}
    monkeypatch.setattr(CO.PR, "marcar_candidatas", lambda e, inv_id: list(candidatas["ids"]))
    monkeypatch.setattr(CO.ARG, "texto_conflictos", lambda e, inv_id, ids_: "")

    def eventos_ranking() -> list[str]:
        return [x["texto"] for x in al.estado["eventos"] if x["tipo"] == "ranking_cambio" and x["texto"].startswith("Candidatas al laboratorio")]

    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    assert len(eventos_ranking()) == 1, "la primera vez se anuncia"
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert inv["_candidatasEmitidas"] == [ids["hip"]]
    it2 = _abrir_iteracion(al, ids, 2, 3000)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids, it2["id"])))
    assert len(eventos_ranking()) == 1, "mismo orden: sin evento nuevo"
    candidatas["ids"] = []
    it3 = _abrir_iteracion(al, ids, 3, 4000)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids, it3["id"])))
    assert len(eventos_ranking()) == 1 and _corrida(al, ids)["estado"] == "en_marcha"
    candidatas["ids"] = [ids["hip"]]
    it4 = _abrir_iteracion(al, ids, 4, 5000)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids, it4["id"])))
    assert len(eventos_ranking()) == 2, "vuelve a haber candidata: cambió el orden, evento"
    from rosa.estado.almacen import _limpiar_para_cliente

    assert "_candidatasEmitidas" not in _limpiar_para_cliente(inv) and "_conflictosEmitidos" not in _limpiar_para_cliente(inv), "memoria privada del bucle: no viaja al navegador"
    al.cerrar()


# ---------------------------------------------------------------------------
# S-14: coste del cierre antes de entrar y retroceso exponencial
# ---------------------------------------------------------------------------


def test_el_retroceso_del_relanzamiento_es_exponencial_a_partir_del_cuarto_fallo():
    assert [CO.retroceso_ms(n) for n in range(1, 8)] == [30_000, 60_000, 300_000, 600_000, 1_200_000, 1_800_000, 1_800_000]
    assert CO.retroceso_ms(0) == 30_000 and CO.retroceso_ms(-3) == 30_000


def test_el_coste_estimado_del_cierre_descuenta_lo_ya_calculado_y_es_cero_en_un_cierre_vacio():
    al, ids = _preparar()
    c, it = _corrida(al, ids), _it(al, ids)
    e = al.estado
    estimado = CO.coste_estimado_del_cierre(e, c, it)
    assert estimado["desglose"] == {"resumen": 1, "meta": 0, "llano": 1, "evidencia": 0, "conclusiones": 1, "revisor": 1} and estimado["total"] == 4
    it["_cierre"] = {"resumen": "ya", "llano": {"titulo": "ya"}}
    assert CO.coste_estimado_del_cierre(e, c, it)["total"] == 2
    # Afirmaciones nuevas en la iteración: acumulación para cada hipótesis viva y, como mucho, una conclusión más por afirmación.
    c["_afirmaciones"] = [{"iteracion": 1, "veredicto": "sostenida", "fuenteId": "f", "texto": "x"}, {"iteracion": 1, "veredicto": "parcial", "fuenteId": "f", "texto": "y"}]
    d = CO.coste_estimado_del_cierre(e, c, it)["desglose"]
    assert d["evidencia"] == 1 and d["conclusiones"] == 1  # una sola hipótesis viva: no puede pasar de una conclusión
    # Un cierre vacío (ningún paso ejecutado) no llama a nada.
    it["plan"] = [{**P.nuevo_paso("Leer", "", 10), "estado": "pendiente"}]
    assert CO.coste_estimado_del_cierre(e, c, it) == {"total": 0, "desglose": {}}
    assert CO.llamadas_restantes(e, c, it) == min(c["presupuesto"]["limiteLlamadas"], it["presupuesto"]["limite"])
    it["presupuesto"] = {"limite": 10, "usado": 12}
    assert CO.llamadas_restantes(e, c, it) == 0
    assert CO.llamadas_restantes(e, c, {"presupuesto": {"limite": None, "usado": 0}}) == c["presupuesto"]["limiteLlamadas"]
    al.cerrar()


def test_el_cierre_se_pausa_antes_de_empezar_si_lo_que_queda_no_le_llega_y_dice_cuanto_ampliar(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)
    limite = _corrida(al, ids)["presupuesto"]["limiteLlamadas"]
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"])["gasto"].__setitem__("llamadas", limite - 2) or True, "gasto")
    estimado = CO.coste_estimado_del_cierre(al.estado, _corrida(al, ids), _it(al, ids))
    assert estimado["total"] == 4
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c, it = _corrida(al, ids), _it(al, ids)
    assert c["estado"] == "pausada_por_presupuesto" and it["terminadaEn"] is None and it.get("_cierre") is None
    assert not llamadas.vistas, "no se gastó nada en un cierre que no cabía"
    motivo = c["presupuesto"]["motivoPausa"]
    assert motivo.startswith("El cierre de la iteración 1 necesita unas 4 llamadas al modelo (1 conclusión; resumen, resumen en llano, revisor de registro) y quedan 2")
    assert "se pausó antes de empezarlo" in motivo and motivo.endswith("Amplía el tope en al menos 2 llamadas para seguir.")
    ev = [x for x in al.estado["eventos"] if x["tipo"] == "presupuesto"]
    assert len(ev) == 1 and ev[0]["texto"] == motivo
    # La persona amplía lo que el aviso pide: el cierre entra, termina y la conclusión se escribe.
    al.mutar(lambda e: A.ampliar_presupuesto(e, ids["cor"], limite + 2, 5000), "ampliar")
    assert _corrida(al, ids)["estado"] == "en_marcha"
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    assert _it(al, ids)["terminadaEn"] is not None and _hip(al, ids)["conclusion"]
    assert [p for p, _ in llamadas.vistas].count("concluir") == 1
    al.cerrar()


def test_si_el_tope_salta_dentro_del_cierre_el_aviso_dice_cuanto_le_faltaba(monkeypatch):
    al, ids = _preparar()

    def sin_presupuesto(kw):
        raise PresupuestoAgotado("tope de la iteración")

    sup, ctx, llamadas = _supervisor(al, ids, {**_respuestas_cierre(), "concluir": sin_presupuesto}, monkeypatch)
    al.mutar(lambda e: next(i for i in e["iteraciones"] if i["id"] == ids["it"])["presupuesto"].update({"limite": 40, "usado": 40}) or True, "tope")
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c, it = _corrida(al, ids), _it(al, ids)
    assert c["estado"] == "pausada_por_presupuesto" and it["terminadaEn"] is None
    motivo = c["presupuesto"]["motivoPausa"]
    assert motivo.startswith("La iteración 1 gastó las 40 llamadas que le tocaban"), "el aviso del tope (S-15) sigue delante"
    assert "El tope saltó dentro del cierre de la iteración 1: le faltan unas 2 llamadas (1 conclusión; revisor de registro); lo ya calculado se conserva" in motivo
    assert it["_cierre"]["resumen"] == "Resumen técnico de la iteración."
    al.cerrar()


def test_el_tope_de_una_iteracion_nueva_reserva_el_coste_del_cierre(monkeypatch):
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
        return True

    al.mutar(preparar, "preparar")
    reserva = CO.coste_previsto_del_cierre(al.estado, ids["inv"])
    # resumen, llano y revisor (3), más evidencia y conclusión de la única hipótesis
    # viva (2), más la vuelta del bucle de revisión (2: el cerebro rehace, el juez
    # comprueba). La partida de reparación va en la RESERVA y no solo en el estimado:
    # si no, el tope de la iteración no la reserva y el cierre pausa la corrida justo
    # en las iteraciones con hallazgos graves (S-14 otra vez).
    assert reserva == 7
    asyncio.run(sup._proponer_plan(_corrida(al, ids), None))
    it = [i for i in al.estado["iteraciones"] if i["corridaId"] == ids["cor"]][-1]
    assert it["presupuesto"]["limite"] == max(sum(p["presupuesto"] for p in it["plan"]), 20) + reserva
    al.cerrar()


# ---------------------------------------------------------------------------
# B-02: la parada se reevalúa al crear la iteración y antes del permiso de gasto
# ---------------------------------------------------------------------------


def test_la_parada_se_reevalua_dentro_de_la_mutacion_que_crea_la_iteracion(monkeypatch):
    al, ids = _preparar()

    def plan_que_llega_tarde(kw):
        # Mientras el planificador "piensa" (110 a 136 s reales), la corrida cruza las llamadas de la condición de parada.
        al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"])["gasto"].__setitem__("llamadas", 60) or True, "gasto")
        return SimpleNamespace(plan=[SimpleNamespace(tipo="literatura", titulo="Leer", detalle="d", valor_decision="", espera="", si_no_aparece="")])

    sup, ctx, llamadas = _supervisor(al, ids, {"plan": plan_que_llega_tarde}, monkeypatch)
    sup.programas.plan = "plan"

    async def sin_red(*a, **k):
        return ""

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", sin_red)
    monkeypatch.setattr(CO.LEC, "para", sin_red)

    def preparar(e):
        inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
        inv["_misionIntentada"] = True
        inv["condicionParada"] = "50 llamadas"
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["_preguntaIntentada"] = True
        c["pregunta"] = {"enunciado": "¿Qué distingue a un biomarcador?"}
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["terminadaEn"] = 2000
        it["resumen"] = "Primera iteración."
        return True

    al.mutar(preparar, "preparar")
    n_antes = len(al.estado["iteraciones"])
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    c = _corrida(al, ids)
    assert [p for p, _ in llamadas.vistas].count("plan") == 1, "la parada no se cumplía antes de llamar: el planificador corrió"
    assert len(al.estado["iteraciones"]) == n_antes, "la iteración condenada ya no nace"
    assert c["estado"] == "terminada" and "50 llamadas" in c["motivoCierre"] and c["iteracionActual"] == 1
    al.cerrar()


def test_correr_corrida_mira_la_parada_antes_de_pedir_permiso_de_gasto(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    cerradas: list[str] = []

    async def cerrar(c, it):
        cerradas.append(it["id"])
        al.mutar(lambda e: A.detener_corrida(e, ids["cor"], "fin de la prueba", 9000), "detener")

    monkeypatch.setattr(sup, "_cerrar_con_presupuesto", cerrar)

    def preparar(e):
        e["autonomia"]["gastar_grande"] = "preguntar"
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["condicionParada"] = "10 llamadas"
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["gasto"]["llamadas"] = 10  # la parada ya se cumplió
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        paso = P.nuevo_paso("Buscar literatura", "", 500)
        paso["tipo"] = "literatura"
        it["plan"] = [paso]
        it["presupuesto"] = {"limite": 1400, "usado": 0}  # más de la mitad de lo que queda: antes abría una solicitud
        return True

    al.mutar(preparar, "preparar")
    asyncio.run(asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=10))
    assert cerradas == [ids["it"]]
    assert not [s for s in al.estado["solicitudes"] if s["tipo"] == "presupuesto_grande"], "no se abre una solicitud para una iteración que va a cerrarse"
    paso = _it(al, ids)["plan"][0]
    assert paso["estado"] == "omitido" and "10 llamadas" in paso["motivoFallo"]
    al.cerrar()


# ---------------------------------------------------------------------------
# M-07: sin evidencia directa con un supuesto contradicho
# ---------------------------------------------------------------------------


def test_sin_evidencia_directa_con_supuesto_contradicho_lo_dice_en_la_frase():
    h = {"afirmaciones": [], "supuestos": [{"texto": "NfL es específico", "estado": "contradicho"}], "experimento": None}
    assert CO.direccion_por_regla(h, "mixta") == ("sin_evidencia_directa", True)
    assert CO.direccion_por_regla(h, "apoya") == ("sin_evidencia_directa", False)
    assert CO.direccion_por_regla({**h, "supuestos": None}, "mixta") == ("sin_evidencia_directa", False)
    assert CO.direccion_por_regla({**h, "supuestos": "texto raro"}, "en_contra") == ("sin_evidencia_directa", False)
    frase = CO.frase_plantilla("sin_evidencia_directa", "muy_baja", "GFAP sube antes", supuesto_contradicho=True)
    assert frase.startswith("No encontramos evidencia directa sobre si GFAP sube antes, y un supuesto del que depende está contradicho por las fuentes.") and frase.endswith("Esto no significa que no exista.")
    assert "contradictoria" not in frase and "supuesto" not in CO.frase_plantilla("sin_evidencia_directa", "muy_baja", "GFAP sube antes")


# ---------------------------------------------------------------------------
# M-14: conclusiones al día por regla
# ---------------------------------------------------------------------------


def _conclusion_vieja(certeza: str, techo: dict[str, Any] | None = None) -> dict[str, Any]:
    k = {"certeza": certeza, "direccion": "apoya", "direccionDelJuez": "apoya", "hipotesisBreve": "GENHEP sube en astrocitos reactivos", "enunciado": CO.frase_plantilla("apoya", certeza, "GENHEP sube en astrocitos reactivos"), "conclusion": "x", "factores": [{"factor": "evidencia_indirecta", "efecto": "baja", "explicacion": "solo literatura"}], "base": {}, "aFavor": [], "enContra": [], "loMasFragil": "", "subiria": "", "bajaria": "", "noComprobado": [], "cambio": None, "fechaBusqueda": None, "fecha": 100, "iteracion": 1}
    if techo is not None:
        k["techo"] = techo
    return k


def test_recalcular_conclusiones_por_regla_baja_al_techo_avisa_y_es_idempotente():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "Sin corrida", "objetivo": "GENHEP", "condicionParada": "3 iteraciones"}, 1000)
    h = _hipotesis()  # una fuente sin cohorte, una afirmación sostenida: techo muy baja por regla
    h["investigacionId"] = inv
    h["conclusion"] = _conclusion_vieja("baja")  # conclusión antigua, sin techo, por encima del techo actual
    e["hipotesis"].append(h)
    n_ev = len(e["eventos"])
    cambios = CO.recalcular_conclusiones_por_regla(e, 5000)
    k = h["conclusion"]
    assert [c["id"] for c in cambios] == [h["id"]] and cambios[0]["de"] == "baja" and cambios[0]["a"] == "muy_baja"
    assert k["certeza"] == "muy_baja" and k["techo"]["nivel"] == "muy_baja" and k["techo"]["certezaDelJuez"] == "baja" and k["techo"]["acotada"] is True
    assert k["escalera"] and k["escalera"][0]["de"] == "muy_baja" and k["escalera"][0]["a"] == "baja"
    assert k["enunciado"].startswith("La evidencia es muy incierta sobre si") and k["cambio"]["de"]["certeza"] == "baja" and k["cambio"]["motivo"].startswith("Recálculo del techo por regla")
    assert k["recalculadaEn"] == 5000 and k["fecha"] == 100 and k["iteracion"] == 1, "la fecha y la iteración de la conclusión del juez no se tocan"
    nuevos = e["eventos"][n_ev:]
    assert len(nuevos) == 1 and nuevos[0]["tipo"] == "revision_automatica" and "bajó de baja a muy baja al recalcular el techo por regla" in nuevos[0]["texto"]
    assert nuevos[0]["ruta"] == f"#/investigaciones/{inv}/hipotesis/{h['id']}"
    assert any("bajó de baja a muy baja" in r for r in h["procedencia"]["registro"])
    assert e["aprendizaje"][-1]["tipo"] == "creencia" and e["aprendizaje"][-1]["nivel"] == 1
    assert h["cohortesDistintas"] == [] and k["cohortesDistintas"] == []
    # Segunda pasada: nada cambia, ningún evento más.
    assert CO.recalcular_conclusiones_por_regla(e, 6000) == [] and len(e["eventos"]) == n_ev + 1
    # Una hipótesis descartada se recalcula (techo al día) pero no genera evento.
    d = _hipotesis()
    d["investigacionId"], d["estado"], d["conclusion"] = inv, "descartada", _conclusion_vieja("moderada")
    e["hipotesis"].append(d)
    assert CO.recalcular_conclusiones_por_regla(e, 7000)[0]["a"] == "muy_baja" and len(e["eventos"]) == n_ev + 1
    # Registros raros no la tumban.
    e["hipotesis"].append({"id": "rara", "investigacionId": inv, "conclusion": {"certeza": "baja"}, "afirmaciones": "texto", "procedencia": None})
    CO.recalcular_conclusiones_por_regla(e, 8000)
    assert CO.recalcular_conclusiones_por_regla({"hipotesis": [None, {"conclusion": None}, {"conclusion": {"sin_certeza": 1}}]}, 1) == []


def test_recalcular_sube_la_certeza_hasta_el_juez_cuando_el_techo_subio_sin_evento():
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f1", cohorte="ADNI"), _afirmacion(afirmacionId="af-2", fuenteId="f2", cohorte="BioFINDER", cita="[B et al., 2024, resumen]", texto="GENHEP also increases in BioFINDER astrocytes")])
    h["procedencia"]["fuentes"] = [{"id": "f1", "referencia": "A et al., 2025", "titulo": "GENHEP in astrocytes", "cohorte": "ADNI", "tipoEstudio": "cohorte"}, {"id": "f2", "referencia": "B et al., 2024", "titulo": "GENHEP in BioFINDER", "cohorte": "BioFINDER", "tipoEstudio": "cohorte"}]
    esperado = CERTEZA.acotar("baja", h, [])["certeza"]
    assert esperado == "baja", "dos cohortes de literatura: el techo por regla es baja"
    h["conclusion"] = _conclusion_vieja("muy_baja", techo={"nivel": "muy_baja", "motivo": "una sola cohorte (cuenta antigua)", "acotada": True, "certezaDelJuez": "baja"})
    e = {"hipotesis": [h], "eventos": [], "aprendizaje": []}
    cambios = CO.recalcular_conclusiones_por_regla(e, 5000)
    assert cambios and h["conclusion"]["certeza"] == "baja" and h["conclusion"]["techo"]["nivel"] == "baja"
    assert e["eventos"] == [] and e["aprendizaje"] == [], "subir no es una alarma: solo la línea del registro"
    assert any("subió de muy baja a baja" in r for r in h["procedencia"]["registro"])
    assert h["conclusion"]["enunciado"].startswith("La evidencia sugiere, con limitaciones, que")


def test_al_arrancar_se_recalculan_las_conclusiones_de_todas_las_investigaciones(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    e = P.estado_inicial()
    otra = A.crear_investigacion(al.estado, {"titulo": "Sin corrida", "objetivo": "GENHEP", "condicionParada": "3 iteraciones"}, 1000)
    h_sin_corrida = _hipotesis()
    h_sin_corrida["investigacionId"] = otra
    h_sin_corrida["conclusion"] = _conclusion_vieja("moderada")

    def fn(e2):
        e2["hipotesis"].append(h_sin_corrida)
        next(x for x in e2["hipotesis"] if x["id"] == ids["hip"])["conclusion"] = _conclusion_vieja("alta")
        return True

    al.mutar(fn, "preparar")
    sup.recuperar_tras_reinicio()
    k1, k2 = _h(al, ids["hip"])["conclusion"], _h(al, h_sin_corrida["id"])["conclusion"]
    assert k1["techo"] and k1["certeza"] == k1["techo"]["nivel"] and k1["techo"]["certezaDelJuez"] == "alta"
    assert k2["techo"]["nivel"] == "muy_baja" and k2["certeza"] == "muy_baja", "la investigación sin corrida también se recalcula"
    ev = [x for x in al.estado["eventos"] if x["tipo"] == "revision_automatica"]
    assert len(ev) == 2 and all("al recalcular el techo por regla" in x["texto"] for x in ev)
    al.cerrar()


def test_el_cierre_recalcula_las_conclusiones_que_conserva_sin_pagar_al_juez(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, _respuestas_cierre(), monkeypatch)

    def fn(e):
        h = next(x for x in e["hipotesis"] if x["id"] == ids["hip"])
        h["conclusion"] = _conclusion_vieja("alta", techo={"nivel": "alta", "motivo": "viejo", "acotada": False, "certezaDelJuez": "alta"})
        h["_conclusionIntentada"] = 0
        h["conclusion"]["huella"] = CO.huella_de_conclusion(h)
        return True

    al.mutar(fn, "conclusion_vieja")
    assert CO.motivo_para_reconcluir(_hip(al, ids)) is None
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    h = _hip(al, ids)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 0, "la conclusión se conserva: el juez no cobra"
    techo = CERTEZA.techo(h)[0]
    assert h["conclusion"]["certeza"] == techo != "alta" and h["conclusion"]["techo"]["nivel"] == techo
    assert any("sin cambios en la evidencia contada" in r for r in h["procedencia"]["registro"]) and any("bajó de alta a" in r for r in h["procedencia"]["registro"])
    ultimo = _corrida(al, ids)["progreso"][-1]
    assert next(x for x in ultimo["certezas"] if x["hipotesisId"] == ids["hip"])["certeza"] == techo, "la instantánea de progreso ve la certeza recalculada"
    al.cerrar()


# ---------------------------------------------------------------------------
# S-27: la réplica lee toda la investigación
# ---------------------------------------------------------------------------


def _corrida_con_fuente(e: dict[str, Any], inv_id: str, numero: int, fuente_id: str, referencia: str, localizador: str, texto: str) -> dict[str, Any]:
    c = P.nueva_corrida(inv_id, numero, 1000)
    c["estado"] = "terminada"
    c["_fuentes"] = {fuente_id: {"id": fuente_id, "referencia": referencia, "titulo": "t", "fragmentos": [{"localizador": localizador, "texto": texto, "encabezado": "Results"}]}}
    e["corridas"].append(c)
    return c


def test_fragmentos_de_investigacion_reune_todas_las_corridas_sin_repetir_y_prefiere_la_mas_reciente():
    e = P.estado_inicial()
    _corrida_con_fuente(e, "inv", 1, "f-1", "A et al., 2025", "pág. 3", "texto de la corrida 1")
    _corrida_con_fuente(e, "inv", 2, "f-1", "A et al., 2025", "pág. 3", "texto de la corrida 2")
    _corrida_con_fuente(e, "inv", 3, "f-3", "C et al., 2023", "resumen", "texto de la corrida 3")
    _corrida_con_fuente(e, "otra", 1, "f-x", "X, 2020", "resumen", "de otra investigación")
    e["corridas"].append({"id": "sin-fuentes", "investigacionId": "inv", "numero": 4})
    e["corridas"][0]["_fuentes"]["sin-id"] = {"referencia": "r", "fragmentos": [{"localizador": "resumen", "texto": "x"}]}
    frags = T.fragmentos_de_investigacion(e, "inv")
    assert [(f.fuente_id, f.localizador, f.texto) for f in frags] == [("f-3", "resumen", "texto de la corrida 3"), ("f-1", "pág. 3", "texto de la corrida 2")]
    assert T.fragmentos_de_investigacion(e, "nadie") == []


def test_la_replica_resuelve_las_citas_en_todas_las_corridas_de_la_investigacion(monkeypatch):
    al, ctx = _ctx()
    # La fuente de la afirmación vive en una corrida anterior, no en la viva (que no tiene fuentes).
    al.mutar(lambda e: _corrida_con_fuente(e, "inv", 0, "f-vieja", "A et al., 2025", "pág. 3", "GENHEP increases in reactive astrocytes of the hippocampus in this cohort.") and True, "corrida_vieja")
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-vieja")])
    h["replicacion"] = {"total": 2, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    assert CO.citas_de_replica(al.estado, h) == {"total": 1, "resuelven": 1, "guardadas": 0, "sinComprobar": 0}
    vistas: dict[str, Any] = {}

    async def verificar(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        vistas["frags"], vistas["copias"], vistas["rol"] = ctx_.fragmentos_verificador(), copias, rol
        assert ctx_.programas is ctx.programas and ctx_.corrida_id == ctx.corrida_id, "lo que no son fragmentos viene del contexto real"
        for a in copias:
            a["veredicto"] = "sostenida"
        return {"sostenida": len(copias)}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar)
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    copia = vistas["copias"][0]
    assert copia["fragmento"].startswith("GENHEP increases") and copia["fuenteId"] == "f-vieja" and copia["localizador"] == "pág. 3" and not copia.get("noReleida")
    assert [f.fuente_id for f in vistas["frags"]] == ["f-vieja"] and vistas["rol"] == "replica"
    x = _h(al, h["id"])
    r = x["replicacion"]
    assert r["hechas"] == 1 and r["sostienen"] == 1 and r["contradicen"] == 0 and r["noComprobables"] == 0 and r["estado"] == "en_curso"
    assert r["citas"] == {"total": 1, "resuelven": 1, "guardadas": 0, "sinComprobar": 0}
    assert r["trayectorias"] == [{"n": 1, "resultado": "sostiene", "comprobadas": 1, "juzgadas": 1, "apoyan": 1, "noReleidas": 0, "noComprobables": 0}]
    assert any(m["texto"].startswith("Réplica lanzada sobre 1 cita: 1 resuelven") for m in x["procedencia"]["mensajes"])
    al.cerrar()


def test_la_replica_juzga_el_pasaje_guardado_con_maximo_parcial_y_lo_incomprobable_no_es_contradiccion(monkeypatch):
    al, ctx = _ctx()
    h = _hipotesis(afirmaciones=[
        _afirmacion(fuenteId="f-perdida"),  # la fuente no está en ninguna corrida, pero la afirmación guarda el pasaje
        _afirmacion(afirmacionId="af-2", fuenteId="f-perdida", cita="[A et al., 2025, sección Results]", fragmento=""),  # ni fragmento ni pasaje
    ])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    assert CO.citas_de_replica(al.estado, h) == {"total": 2, "resuelven": 0, "guardadas": 1, "sinComprobar": 1}
    vistas: dict[str, Any] = {}

    async def verificar(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        frags = ctx_.fragmentos_verificador()
        vistas["encabezados"], vistas["copias"] = [f.encabezado for f in frags], copias
        for a in copias:
            # El determinista real resuelve la cita al pasaje guardado (misma fuente, mismo localizador).
            fr = V.resolver_cita(a["cita"], frags, a.get("fuenteId"))
            assert fr is not None and fr.texto.startswith("GENHEP increases")
            a["veredicto"] = "sostenida"
        return {}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar)
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    assert vistas["encabezados"] == ["Pasaje guardado al extraer; la fuente no se pudo releer"]
    assert len(vistas["copias"]) == 1 and vistas["copias"][0]["noReleida"] is True
    assert vistas["copias"][0]["veredicto"] == "parcial" and vistas["copias"][0]["veredictoJuez"] == "sostenida" and vistas["copias"][0]["motivo"].startswith("Sostenida sobre el pasaje guardado al extraer")
    x = _h(al, h["id"])
    r = x["replicacion"]
    assert (r["sostienen"], r["contradicen"], r["noComprobables"], r["estado"]) == (1, 0, 0, "terminada")
    assert r["citas"] == {"total": 2, "resuelven": 0, "guardadas": 1, "sinComprobar": 1}
    assert r["trayectorias"][0] == {"n": 1, "resultado": "sostiene", "comprobadas": 1, "juzgadas": 1, "apoyan": 1, "noReleidas": 1, "noComprobables": 1}
    mensajes = [m["texto"] for m in x["procedencia"]["mensajes"]]
    assert any("1 se juzgan sobre el pasaje guardado al extraer" in m and "1 no se pueden comprobar (no cuentan como contradicción)" in m for m in mensajes)
    assert any(m.startswith("Replicación terminada: 1 de 1 trayectorias sostienen las afirmaciones, 0 las contradicen y 0 no se pudieron comprobar.") and "1 cita se juzgó sobre el pasaje guardado" in m for m in mensajes)
    al.cerrar()


def test_una_trayectoria_sin_nada_que_juzgar_cuenta_como_no_comprobable_y_no_llama_al_juez(monkeypatch):
    al, ctx = _ctx()
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x", fragmento=""), _afirmacion(afirmacionId="af-2", cita="sin patrón de cita", fragmento="algo guardado")])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}  # registro antiguo, sin noComprobables
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    llamadas: list[Any] = []

    async def verificar(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        llamadas.append(copias)
        return {}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar)
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    assert llamadas == [], "sin nada comprobable no se paga al juez"
    r = _h(al, h["id"])["replicacion"]
    assert (r["hechas"], r["sostienen"], r["contradicen"], r["noComprobables"], r["estado"]) == (1, 0, 0, 1, "terminada")
    assert r["citas"] == {"total": 2, "resuelven": 0, "guardadas": 0, "sinComprobar": 2}
    assert any("1 de 1 trayectorias sostienen" not in m["texto"] and "0 de 1 trayectorias sostienen las afirmaciones, 0 las contradicen y 1 no se pudieron comprobar" in m["texto"] for m in _h(al, h["id"])["procedencia"]["mensajes"])
    # El juez que no responde tampoco es una contradicción.
    h2 = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-y")])
    h2["replicacion"] = {"total": 3, "hechas": 2, "sostienen": 1, "contradicen": 1, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")

    async def juez_caido(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        for a in copias:
            a["veredicto"], a["motivo"] = "sin_verificar", "El juez no dictaminó"
        return {}

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", juez_caido)
    asyncio.run(sup._replicar_paso(ctx, h2))
    r2 = _h(al, h2["id"])["replicacion"]
    assert (r2["hechas"], r2["sostienen"], r2["contradicen"], r2["noComprobables"], r2["estado"]) == (3, 1, 1, 1, "terminada")
    assert "citas" not in r2, "la cuenta de citas se deja al lanzar (primera trayectoria), no en la tercera"
    al.cerrar()


def test_fragmento_guardado_lleva_la_referencia_y_el_localizador_de_la_cita():
    fr = CO.fragmento_guardado("[Kim et al., 2025, texto web, parte 2]", "  GFAP rose earlier  ", "f-9")
    assert (fr.fuente_id, fr.referencia, fr.localizador, fr.texto) == ("f-9", "Kim et al., 2025", "texto web, parte 2", "GFAP rose earlier")
    assert V.resolver_cita("[Kim et al., 2025, texto web, parte 2]", [fr], "f-9") is fr and V.resolver_cita("[Kim et al., 2025, texto web, parte 2]", [fr], None) is fr
    sin_id = CO.fragmento_guardado("[Kim et al., 2025, pág. 4]", "x", None)
    assert sin_id.fuente_id.startswith("guardado:") and V.resolver_cita("[Kim et al., 2025, pág. 4]", [sin_id], None) is sin_id
    assert CO.fragmento_guardado("[Kim et al., 2025, pág. 4]", "   ", "f") is None and CO.fragmento_guardado("sin patrón", "texto", "f") is None


# ---------------------------------------------------------------------------
# S-06 b: la misma obra con otro id no entra dos veces en la procedencia
# ---------------------------------------------------------------------------


def _af_corrida(id_: str, fuente_id: str, cita: str, texto: str, cohorte: str) -> dict[str, Any]:
    return {"id": id_, "texto": texto, "cita": cita, "fragmento": texto, "veredicto": "sostenida", "motivo": "", "entidadDistinta": False, "tipo": "dato", "clase": "literatura", "sintetico": False, "cohorte": cohorte, "sospechosoInyeccion": False, "nivelMedicion": "resultado_analisis", "fuenteId": fuente_id, "localizador": "resumen", "iteracion": 1}


def test_acumular_no_duplica_una_fuente_que_ya_esta_con_otro_id_y_la_afirmacion_apunta_a_la_que_estaba(monkeypatch):
    al, ctx = _ctx()
    h = _hipotesis()
    h["procedencia"]["fuentes"][0].update({"doi": "10.1000/genhep.2025", "cohorte": "ADNI", "tipoEstudio": "cohorte"})
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")

    def fn(e):
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        # La misma obra, registrada en esta corrida con otro id y otra referencia corta (el DOI la delata); y una obra distinta.
        c["_fuentes"] = {
            "f-nueva": {"id": "f-nueva", "referencia": "A, 2025", "titulo": "GENHEP in astrocytes", "doi": "https://doi.org/10.1000/GENHEP.2025", "cohorte": "ADNI", "tipoEstudio": "cohorte", "fragmentos": []},
            "f-otra": {"id": "f-otra", "referencia": "Z et al., 2024", "titulo": "Unrelated GENHEP work", "doi": "10.1000/otra.2024", "cohorte": "BioFINDER", "tipoEstudio": "cohorte", "fragmentos": []},
        }
        c["_afirmaciones"] = [_af_corrida("af-n", "f-nueva", "[A, 2025, resumen]", "GENHEP rises in hippocampal astrocytes of ADNI participants", "ADNI"), _af_corrida("af-o", "f-otra", "[Z et al., 2024, resumen]", "GENHEP rises in BioFINDER astrocytes", "BioFINDER")]
        return True

    al.mutar(fn, "fuentes")

    async def elegir(vivas, afs, pista=None):
        return {x["id"]: [(a, 0.9) for a in afs] for x in vivas}

    async def llamar(self, rol, programa, **kw):
        return SimpleNamespace(relaciones=[SimpleNamespace(indice=1, relacion="apoya", motivo="misma población"), SimpleNamespace(indice=2, relacion="apoya", motivo="otra cohorte")])

    monkeypatch.setattr(EV, "elegir_candidatas", elegir)
    monkeypatch.setattr(Ctx, "llamar", llamar)
    resumen = asyncio.run(EV.acumular(ctx, 1))
    x = _h(al, h["id"])
    assert resumen["anadidas"] == 2 and resumen["ids"] == [h["id"]]
    assert [f["id"] for f in x["procedencia"]["fuentes"]] == ["f1", "f-otra"], "la misma obra con otro id no entra dos veces; la distinta sí"
    assert x["procedencia"]["fuentes"][0]["_idsEquivalentes"] == ["f-nueva"]
    assert [a.get("fuenteId") for a in x["afirmaciones"]] == [None, "f1", "f-otra"], "la afirmación apunta a la fuente que ya estaba"
    assert any("1 fuentes nuevas, 1 de una fuente que ya estaba con otro id (misma obra, no cuenta como cohorte nueva)" in r for r in x["procedencia"]["registro"])
    assert sorted(CERTEZA.cohortes_distintas(x)) == ["ADNI", "BioFINDER"], "dos cohortes reales, no tres"
    # Sin clave compartida no se fusiona nada; con el id ya anotado como equivalente, sí.
    assert EV.fuente_equivalente(x["procedencia"]["fuentes"], {"id": "f-nueva"}) is x["procedencia"]["fuentes"][0]
    assert EV.fuente_equivalente(x["procedencia"]["fuentes"], {"id": "f-q", "titulo": "corto"}) is None
    assert EV.fuente_equivalente(x["procedencia"]["fuentes"], None) is None
    assert EV.fuente_equivalente(x["procedencia"]["fuentes"], {"id": "f-t", "titulo": "GENHEP short"}) is None, "un título de menos de veinte letras no es clave"
    assert EV.fuente_equivalente(x["procedencia"]["fuentes"], {"id": "f-t", "titulo": "Unrelated GENHEP work"}) is x["procedencia"]["fuentes"][1]
    assert EV.fuente_equivalente([{"id": None}, "texto", {"id": "f1"}], {"id": "f1"}) == {"id": "f1"}
    al.cerrar()


def test_el_vivero_tampoco_duplica_la_fuente_equivalente(monkeypatch):
    from rosa.bucle import vivero as VIVERO

    al, ctx = _ctx()
    semilla = {"id": "sem-1", "investigacionId": "inv", "titulo": "GENHEP y astrocitos", "enunciado": "GENHEP sube en astrocitos", "mecanismo": "m", "comprobacion": {"biomarcador": "GENHEP", "cohorte": "", "diseno": "cohorte"}, "afirmaciones": [], "fuentes": [{"id": "f-vieja", "referencia": "A et al., 2025", "titulo": "GENHEP in astrocytes", "doi": "10.1000/genhep.2025", "cohorte": "ADNI"}], "historial": [], "iteracion": 1, "falta": ""}

    def fn(e):
        inv = next(i for i in e["investigaciones"] if i["id"] == "inv")
        inv["vivero"] = [semilla]
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        c["_fuentes"] = {"f-nueva": {"id": "f-nueva", "referencia": "A, 2025", "titulo": "GENHEP in astrocytes", "doi": "10.1000/genhep.2025", "cohorte": "ADNI", "fragmentos": []}}
        c["_afirmaciones"] = [_af_corrida("af-n", "f-nueva", "[A, 2025, resumen]", "GENHEP rises in hippocampal astrocytes", "ADNI")]
        return True

    al.mutar(fn, "vivero")

    async def elegir(vivas, afs, pista=None):
        return {x["id"]: [(a, 0.9) for a in afs] for x in vivas}

    async def llamar(self, rol, programa, **kw):
        return SimpleNamespace(relaciones=[SimpleNamespace(indice=1, relacion="apoya", motivo="m")])

    monkeypatch.setattr(EV, "elegir_candidatas", elegir)
    monkeypatch.setattr(Ctx, "llamar", llamar)
    monkeypatch.setattr(VIVERO, "nacer", lambda *a, **k: {"id": "no-nace"})
    monkeypatch.setattr(CERTEZA, "techo", lambda h, factores=None: ("muy_baja", "prueba"))
    asyncio.run(EV.acumular_vivero(ctx, 1))
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == "inv")
    s = inv["vivero"][0]
    assert [f["id"] for f in s["fuentes"]] == ["f-vieja"] and s["fuentes"][0]["_idsEquivalentes"] == ["f-nueva"]
    assert s["afirmaciones"][-1]["fuenteId"] == "f-vieja"
    al.cerrar()
