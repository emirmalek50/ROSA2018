"""Procedencia y escenas de trabajo real, con SQLite temporal y modelos dobles."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS

import pytest

from rosa import verificador as V
from rosa.bucle import corrida as CO
from rosa.bucle import eventos_laboratorio as EL
from rosa.bucle import evidencia as EV
from rosa.bucle import pasos as PA
from rosa.modulos.contador import PresupuestoAgotado
from rosa.tests.test_eventos_laboratorio import _entradas, _eventos, _hipotesis, ctx as contexto_fixture
from rosa.tests.test_integracion_corrida import _pred_conclusion


@pytest.fixture
def ctx(tmp_path):
    yield from contexto_fixture.__wrapped__(tmp_path)


def _af(id_, texto="Texto científico"):
    return {"id": id_, "texto": texto, "cita": "[Referencia, pág. 1]", "fragmento": texto,
            "fuenteId": "fuente", "localizador": "pág. 1", "veredicto": "sin_verificar", "motivo": "", "iteracion": 1}


@pytest.mark.parametrize("total", [1, 7, 10, 13])
def test_juez_publica_final_exacto_incluso_lote_menor_de_diez(ctx, monkeypatch, total):
    ctx.programas.juzgar = "juzgar"
    afs = [_af(f"af-{n}") for n in range(total)]
    monkeypatch.setattr(PA, "_comprobar_determinista", lambda *a: V.Resultado("sin_verificar", "", necesita_juez=True))
    monkeypatch.setattr(V, "tramo_no_cubierto_por_el_pasaje", lambda *a: None)

    async def llamar(*a, **kw):
        return NS(veredicto=NS(veredicto="sostenida", motivo="Pasaje comprobado", entidad_distinta=False))

    ctx.llamar = llamar
    ctx.corrida()["_afirmaciones"] = afs
    pista = ctx.pista("p", "verificacion", "Verificación", "juez")
    asyncio.run(PA.verificar_afirmaciones(ctx, afs, pista, "Objetivo"))
    pista.cerrar("Fin")
    assert [e["texto"] for e in _entradas(ctx) if e["texto"].startswith("Juez:")][-1] == f"Juez: {total} de {total}"
    publica = ctx.almacen.evidencia_de(ctx.corrida_id)["afirmaciones"]
    assert all(a["procedenciaVeredicto"] == {"origen": "juez", "modelo": "juez-simulado", "comprobaciones": ["dictamen_del_modelo"]} for a in publica)


def test_interrupcion_no_completa_el_contador_ni_atribuye_pendientes(ctx, monkeypatch):
    ctx.programas.juzgar = "juzgar"
    afs = [_af(f"af-{n}", f"Texto {n}") for n in range(7)]
    monkeypatch.setattr(PA, "_comprobar_determinista", lambda *a: V.Resultado("sin_verificar", "", necesita_juez=True))
    monkeypatch.setattr(V, "tramo_no_cubierto_por_el_pasaje", lambda *a: None)

    async def probar():
        terminada = asyncio.Event()

        async def llamar(*a, **kw):
            if kw["afirmacion"] == "Texto 0":
                terminada.set()
                return NS(veredicto=NS(veredicto="sostenida", motivo="Leído", entidad_distinta=False))
            await terminada.wait()
            raise PresupuestoAgotado("Prueba")

        ctx.llamar = llamar
        pista = ctx.pista("p", "verificacion", "Verificación", "juez")
        with pytest.raises(PresupuestoAgotado):
            await PA.verificar_afirmaciones(ctx, afs, pista, "Objetivo")
        assert [e["texto"] for e in _entradas(ctx) if e["texto"].startswith("Juez:")] == ["Juez: 1 de 7"]
        pista.cerrar("Interrumpida", "detenida")

    asyncio.run(probar())
    avances = [e["texto"] for e in _entradas(ctx) if e["texto"].startswith("Juez:")]
    assert avances == ["Juez: 1 de 7"]
    assert afs[0]["procedenciaVeredicto"]["origen"] == "juez"
    assert all(a["procedenciaVeredicto"]["origen"] == "sin_verificar" for a in afs[1:])


def test_reglas_y_rebaja_del_modelo_tienen_procedencia_distinta(ctx, monkeypatch):
    ctx.programas.juzgar = "juzgar"
    afs = [_af("regla", "Cita ausente"), _af("mixta", "Dos partes"), _af("fallo", "El modelo fallará")]
    monkeypatch.setattr(PA, "_comprobar_determinista", lambda texto, *a: V.Resultado("cita_no_resuelve", "Cita apartada") if texto == "Cita ausente" else V.Resultado("sin_verificar", "", necesita_juez=True))
    monkeypatch.setattr(V, "tramo_no_cubierto_por_el_pasaje", lambda *a: "La segunda parte no aparece")

    async def llamar(*a, **kw):
        if kw["afirmacion"] == "El modelo fallará":
            raise RuntimeError("Sin respuesta")
        return NS(veredicto=NS(veredicto="sostenida", motivo="Dictamen", entidad_distinta=False))

    ctx.llamar = llamar
    asyncio.run(PA.verificar_afirmaciones(ctx, afs, None, "Objetivo"))
    assert [a["procedenciaVeredicto"]["origen"] for a in afs] == ["regla", "mixta", "sin_verificar"]
    assert afs[1]["veredicto"] == "parcial"


def test_proyeccion_no_adivina_legacy_y_no_filtra_claves_privadas(ctx):
    afs = [_af("legacy"), _af("real"), _af("invalida")]
    afs[0].update(veredicto="no_sostenida", motivo="Identificadores que no aparecen")
    afs[1]["procedenciaVeredicto"] = {"origen": "regla", "modelo": None, "comprobaciones": ["x" * 500], "_codigo": "privado"}
    afs[2]["procedenciaVeredicto"] = {"origen": ["juez"], "modelo": None, "comprobaciones": []}
    ctx.corrida()["_afirmaciones"] = afs
    publica = ctx.almacen.evidencia_de(ctx.corrida_id)["afirmaciones"]
    assert "procedenciaVeredicto" not in publica[0]
    assert set(publica[1]["procedenciaVeredicto"]) == {"origen", "modelo", "comprobaciones"}
    assert len(publica[1]["procedenciaVeredicto"]["comprobaciones"][0]) == 240
    assert "procedenciaVeredicto" not in publica[2]
    publica[1]["procedenciaVeredicto"]["comprobaciones"].append("Cambio del cliente")
    assert len(afs[1]["procedenciaVeredicto"]["comprobaciones"]) == 1


@pytest.mark.parametrize("origen", [None, "regla", "juez", "mixta", "invalido"])
def test_acumular_en_hipotesis_conserva_solo_procedencia_validada(origen):
    a = _af("af-enlazada")
    if origen is not None:
        a["procedenciaVeredicto"] = {"origen": origen, "modelo": "modelo-registrado", "comprobaciones": ["dictamen"], "_privado": "no copiar"}
    entrada = EV._entrada(a, "apoya", "Misma medida", 3)
    assert entrada["afirmacionId"] == "af-enlazada" and entrada["iteracion"] == 3
    if origen in {"regla", "juez", "mixta"}:
        p = entrada["procedenciaVeredicto"]
        assert p == {"origen": origen, "modelo": "modelo-registrado", "comprobaciones": ["dictamen"]}
        p["comprobaciones"].append("Cambio externo")
        assert a["procedenciaVeredicto"]["comprobaciones"] == ["dictamen"]
    else:
        assert "procedenciaVeredicto" not in entrada


@pytest.mark.parametrize("respuesta", ["discutida", "vaga", "acuerdo", "sin_respuesta"])
def test_recalculo_tras_auditoria_emite_solo_decision_real_por_regla(ctx, respuesta):
    h = _hipotesis(ctx, "h-auditada")
    h["tarjeta"] = {"prediccionFalsable": "La medida cambia frente al comparador"}
    ctx.programas.auditar_descarte = "auditar"
    comps = [{"comprobacion": "fidelidad_evidencia", "resultado": "falla", "detalle": "No coincide el pasaje"}]
    decision = ctx.mutar(lambda e: PA.A.registrar_decision(e, h, "killer_1", "descartar_en_contexto", "Pasaje discutido", "juez", 1001, comps), "prueba")

    async def llamar(*a, **kw):
        if respuesta == "sin_respuesta":
            raise RuntimeError("Sin respuesta")
        return NS(auditoria=NS(acuerdo=respuesta == "acuerdo", motivo="Revisé el pasaje",
                              mejor_argumento_a_favor="La cifra procede de otra tabla", comprobacion_discutida="fidelidad_evidencia" if respuesta == "discutida" else ""))

    ctx.llamar = llamar
    pista = ctx.pista("p", "killer", "Decisión", "juez", hipotesis_id=h["id"])
    recalculada = asyncio.run(PA._auditar_descarte(ctx, h, decision, comps, "Pasaje guardado", pista))
    pista.cerrar("Auditoría terminada")
    eventos = _eventos(ctx, "decision_hipotesis")
    if respuesta != "discutida":
        assert recalculada is None and eventos == []
        assert len(ctx.e["decisiones"]) == 1
        return
    guardada = ctx.e["decisiones"][-1]
    assert recalculada == guardada["decision"] == "suspender"
    assert guardada["corridaId"] == ctx.corrida_id and guardada["iteracionId"] == ctx.iteracion_id
    assert len(eventos) == 1
    assert eventos[0] == EL.validar(EL.decision_hipotesis(h, "killer", "terminado", "suspender", origen="regla", comprobaciones=["fidelidad_evidencia"]))
    assert eventos[0]["modelo"] is None and eventos[0]["version"] == guardada["version"]


def test_revision_reparacion_y_comprobacion_identifican_vuelta_real(ctx, monkeypatch):
    ctx.programas.revisar_registro = "revision"
    ctx.programas.rehacer_resumen = "reparacion"
    ctx.programas.revisar_reparacion = "comprobacion"
    monkeypatch.setattr(CO.RR, "comprobaciones_deterministas", lambda *a, **kw: [])
    monkeypatch.setattr(CO.RR, "toco_el_texto", lambda *a: True)
    llamadas = []

    async def llamar(rol, programa, **kw):
        llamadas.append(programa)
        ultimo = _eventos(ctx, "revision_registro")[-1]
        assert ultimo["estado"] == "en_curso" and ultimo["iteracionId"] == ctx.iteracion_id
        if programa == "revision":
            return NS(revision=NS(hallazgos=[NS(clase="conclusion_no_sigue", gravedad="alta", detalle="El resumen contiene una frase no sostenida")], resumen="Revisar la frase", tareas=[]))
        if programa == "reparacion":
            return NS(rehecho=NS(resumen="Resumen con la frase corregida", llano=None, decisiones=[]))
        hid = _eventos(ctx, "revision_registro")[-1]["hallazgos"][0]["id"]
        return NS(revision=NS(veredictos=[NS(id=hid, sigue=False)], resumen="La frase cambió", hallazgos=[]))

    ctx.llamar = llamar
    sup = CO.Supervisor(ctx.almacen, ctx.programas, ctx.modelos)

    async def probar():
        rev = await sup._revisar_registro(ctx, ctx.inv(), ctx.iteracion(), ctx.corrida(), "Resumen inicial", None)
        return await sup._reparar_resumen(ctx, ctx.inv(), ctx.iteracion(), ctx.corrida(), "Resumen inicial", None, rev)

    resultado = asyncio.run(probar())
    assert llamadas == ["revision", "reparacion", "comprobacion"]
    assert resultado["revision"]["hallazgos"][0]["estado"] == "atendido"
    eventos = _eventos(ctx, "revision_registro")
    assert {e["etapa"] for e in eventos} == {"revision", "reparacion", "comprobacion_reparacion"}
    assert eventos[-1]["vuelta"] == 1 and eventos[-1]["totalHallazgos"] == 1
    assert all(e["iteracionId"] == "it" for e in eventos)
    assert all(p["estado"] != "en_curso" for p in ctx.iteracion()["pistas"])


def test_conclusion_guardada_y_evento_conservan_ids_y_version(ctx):
    h = _hipotesis(ctx, "h-conclusion")
    h["version"] = 3
    ctx.programas.concluir = "concluir"

    async def llamar(*a, **kw):
        return _pred_conclusion()

    ctx.llamar = llamar
    sup = CO.Supervisor(ctx.almacen, ctx.programas, ctx.modelos)
    asyncio.run(sup._concluir_hipotesis(ctx, h))
    guardada = ctx.e["hipotesis"][0]["conclusion"]
    assert (guardada["corridaId"], guardada["iteracionId"], guardada["version"]) == ("cor", "it", 3)
    evento = _eventos(ctx, "decision_hipotesis")[-1]
    assert (evento["hipotesisId"], evento["version"], evento["etapa"], evento["estado"]) == ("h-conclusion", 3, "conclusion", "terminado")


def test_conclusion_tardia_no_se_aplica_a_otra_version(ctx):
    h = _hipotesis(ctx, "h-tardia")
    ctx.programas.concluir = "concluir"

    async def llamar(*a, **kw):
        ctx.e["hipotesis"][0]["version"] = 2
        return _pred_conclusion()

    ctx.llamar = llamar
    asyncio.run(CO.Supervisor(ctx.almacen, ctx.programas, ctx.modelos)._concluir_hipotesis(ctx, h))
    assert ctx.e["hipotesis"][0].get("conclusion") is None
    evento = _eventos(ctx, "decision_hipotesis")[-1]
    assert evento["version"] == 1 and evento["estado"] == "no_comprobado"


def test_entrega_del_modelo_identifica_hecho_y_afirmacion_guardados(ctx, monkeypatch):
    ctx.programas.mundo = "mundo"
    a = _af("af-respaldo", "Una medida aumenta en la muestra")
    a.update(veredicto="sostenida", tipo="dato", tema="Medición")
    ctx.corrida()["_afirmaciones"] = [a]
    ctx.fuentes()["fuente"] = {"id": "fuente", "referencia": "Referencia", "titulo": "Estudio", "fragmentos": []}

    async def mundo(*a, **kw):
        return ""

    monkeypatch.setattr(PA.T, "modelo_de_mundo_para", mundo)
    hp = NS(afirmaciones=[1], tipo="hecho", tema="Medición", enunciado="La medida aumenta en la muestra", prioridad=1,
            sustituye_a=[], contradice_a=[], resuelve_cuestiones=[])

    async def llamar(*a, **kw):
        return NS(hechos=[hp], tareas=[])

    ctx.llamar = llamar
    asyncio.run(PA.paso_modelo(ctx, {"id": "paso", "titulo": "Modelo", "detalle": ""}))
    entrega = _eventos(ctx, "asignacion_hecho")[0]
    guardado = next(h for h in ctx.e["hechos"] if h["id"] == entrega["hechoId"])
    assert entrega["afirmacionIds"] == guardado["afirmacionIds"] == ["af-respaldo"]
    assert entrega["enunciado"] == guardado["enunciado"] and entrega["estado"] == "nuevo"
    assert "hipotesisId" not in entrega


@pytest.mark.parametrize("fin", ["normal", "presupuesto", "cancelada"])
def test_planificando_solo_durante_la_llamada_y_sin_iteracion(ctx, monkeypatch, fin):
    ctx.programas.plan = "plan"
    ctx.inv()["_misionIntentada"] = True
    ctx.corrida().update(_preguntaIntentada=True, estado="esperando_plan")
    ctx.e["iteraciones"].clear()

    async def vacio(*a, **kw):
        return ""

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", vacio)
    monkeypatch.setattr(CO.LEC, "para", vacio)

    async def llamar(self, rol, programa, **kw):
        actual = self.corrida()
        assert actual["planificando"] is True
        assert actual["planificandoIteracion"] == 1 and self.e["iteraciones"] == []
        if fin == "presupuesto":
            raise PresupuestoAgotado("Prueba")
        if fin == "cancelada":
            raise asyncio.CancelledError
        return NS(plan=[], tareas_no_programadas=[])

    monkeypatch.setattr(PA.Ctx, "llamar", llamar)
    sup = CO.Supervisor(ctx.almacen, ctx.programas, ctx.modelos)
    if fin == "cancelada":
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(sup._proponer_plan(ctx.corrida(), None))
    else:
        asyncio.run(sup._proponer_plan(ctx.corrida(), None))
    assert ctx.corrida()["planificando"] is False
    assert "planificandoIteracion" not in ctx.corrida()


def test_reinicio_limpia_planificacion_persistida(ctx):
    ctx.corrida().update(planificando=True, planificandoIteracion=2)
    CO.Supervisor(ctx.almacen, ctx.programas, ctx.modelos).recuperar_tras_reinicio()
    assert ctx.corrida()["planificando"] is False
    assert "planificandoIteracion" not in ctx.corrida()


def test_eventos_acotados_con_total_real_y_sin_campos_privados():
    hallazgos = [{"id": f"rr-{n}", "clase": "c", "gravedad": "alta", "estado": "abierto", "origen": "regla", "detalle": "d" * 900, "_privado": "no viajará"} for n in range(30)]
    evento = EL.validar(EL.revision_registro("it", "revision", "terminado", origen="regla", hallazgos=hallazgos))
    assert evento["totalHallazgos"] == 30 and len(evento["hallazgos"]) == 24
    assert len(evento["hallazgos"][0]["detalle"]) == 320
    assert "_privado" not in evento["hallazgos"][0]
    with pytest.raises(ValueError):
        EL.validar({**evento, "vuelta": True})
    with pytest.raises(ValueError):
        EL.validar({**evento, "_codigo": "privado"})
