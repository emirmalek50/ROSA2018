"""El cierre consulta Agora sin saltarse una parada ni fabricar evidencia."""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace

import pytest

from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.tests.test_integracion_corrida import _hip, _preparar, _supervisor
from rosa.tests.test_tanda1_corrida import _corrida, _it, _respuestas_cierre


@pytest.fixture
def arnes(monkeypatch):
    almacen, ids = _preparar()
    supervisor, ctx, llamadas = _supervisor(almacen, ids, _respuestas_cierre(), monkeypatch)
    consultas = []

    def huella(e, inv_id):
        return sorted((h["id"], h.get("version", 1)) for h in e["hipotesis"] if h["investigacionId"] == inv_id and h["estado"] != "descartada")

    def vigente(e, c):
        revision = c.get("revisionAgora") or {}
        return revision.get("huella") == huella(e, c["investigacionId"]) and revision.get("estado") in ("completa", "parcial", "no_aplica", "no_comprobado")

    def texto(h):
        revision = h.get("revisionAgora") or {}
        return str(revision.get("detalle") or "Agora pendiente")

    async def revisar(ctx, *, motivo=None):
        consultas.append((ctx.numero, motivo))
        assert ctx.de_paso
        assert ctx.corrida()["estado"] not in ("detenida", "terminada")

        def guardar(e):
            c = A.corrida_de(e, ctx.corrida_id)
            c["revisionAgora"] = {"estado": "completa", "huella": huella(e, ctx.investigacion_id)}
            for h in e["hipotesis"]:
                if h["investigacionId"] == ctx.investigacion_id:
                    h["revisionAgora"] = {"estado": "completa", "detalle": f"Agora consultada para {h['id']}; datos de base sin verificar"}
            return True

        ctx.mutar(guardar, "agora_simulada")
        return ctx.corrida()["revisionAgora"]

    monkeypatch.setattr(CO.AGORA, "revision_vigente", vigente)
    monkeypatch.setattr(CO.AGORA, "revisar_cierre", revisar)
    monkeypatch.setattr(CO.AGORA, "texto_revision", texto)
    try:
        yield almacen, ids, supervisor, ctx, llamadas, consultas
    finally:
        almacen.cerrar()


def test_revision_antes_del_resumen_y_del_juez_sin_anadir_evidencia(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes
    antes = copy.deepcopy(_hip(al, ids)["afirmaciones"])
    responder = llamadas.respuestas["resumir"]

    def resumen(kw):
        assert CO.AGORA.revision_vigente(al.estado, _corrida(al, ids))
        return responder

    llamadas.respuestas["resumir"] = resumen
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert len(consultas) == 1
    juicio = next(kw for programa, kw in llamadas.vistas if programa == "concluir")
    assert "datos de base sin verificar" in juicio["novedad"]
    assert _hip(al, ids)["afirmaciones"] == antes
    assert _it(al, ids)["terminadaEn"] is not None


def test_cierre_natural_de_ultima_iteracion_pasa_por_agora(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes
    al.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("condicionParada", "1 iteración") or True, "parada")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    c = _corrida(al, ids)
    assert c["estado"] == "terminada"
    assert c["revisionAgora"]["estado"] == "completa"
    assert len(consultas) == 1
    assert "_cierreAgoraPendiente" not in c


def test_iteracion_vacia_tambien_revisa_antes_de_cerrar(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes

    def preparar(e):
        it = next(i for i in e["iteraciones"] if i["id"] == ids["it"])
        paso = P.nuevo_paso("Paso omitido", "Llegó el límite", 1)
        paso.update(estado="omitido", motivoFallo="Se cumplió el tiempo")
        it["plan"] = [paso]
        return True

    al.mutar(preparar, "preparar")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert len(consultas) == 1
    assert not llamadas.vistas
    assert _it(al, ids)["terminadaEn"] is not None


def test_revision_se_actualiza_despues_de_nacer_una_hipotesis(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes

    async def nacer(ctx, numero, pista):
        nueva = P.nueva_hipotesis(ids["inv"], numero, P.ahora_ms(), titulo="Diana nueva")
        ctx.mutar(lambda e: e["hipotesis"].append(nueva) or True, "vivero_simulado")
        return {"nacidas": [nueva["id"]]}

    monkeypatch.setattr(CO.EV, "acumular_vivero", nacer)
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert len(consultas) == 2
    dictamenes = [kw for programa, kw in llamadas.vistas if programa == "concluir"]
    assert len(dictamenes) == 2
    assert all("datos de base sin verificar" in kw["novedad"] for kw in dictamenes)


def test_tope_antes_del_nuevo_plan_revisa_sin_llamar_planificador(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes

    def preparar(e):
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["condicionParada"] = "1 iteración"
        next(i for i in e["iteraciones"] if i["id"] == ids["it"])["terminadaEn"] = 2000
        return True

    al.mutar(preparar, "preparar")
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "terminada"
    assert len(consultas) == 1 and not llamadas.vistas


def test_tope_que_vence_durante_planificador_se_revisa_fuera_de_mutacion(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes
    sup.programas.plan = "plan"

    async def sin_red(*args, **kwargs):
        return "Ninguno"

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", sin_red)
    monkeypatch.setattr(CO.LEC, "para", sin_red)

    def preparar(e):
        next(i for i in e["iteraciones"] if i["id"] == ids["it"])["terminadaEn"] = 2000
        c = A.corrida_de(e, ids["cor"])
        c["pregunta"] = {"enunciado": "GFAP"}
        c["_preguntaIntentada"] = True
        return True

    al.mutar(preparar, "preparar")

    def plan(kw):
        al.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("condicionParada", "1 iteración") or True, "tope_durante_llamada")
        return SimpleNamespace(plan=[])

    llamadas.respuestas["plan"] = plan
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "terminada"
    assert len(consultas) == 1
    assert len(al.estado["iteraciones"]) == 1


@pytest.mark.parametrize("estado", ["detenida", "pausada"])
def test_parar_durante_agora_no_resucita_corrida(arnes, monkeypatch, estado):
    al, ids, sup, ctx, llamadas, consultas = arnes

    async def parar(ctx, *, motivo=None):
        if estado == "detenida":
            ctx.mutar(lambda e: A.detener_corrida(e, ids["cor"], "Parada humana", 4000), "detener")
        else:
            ctx.mutar(lambda e: A.pausar_corrida(e, ids["cor"]), "pausar")
        return {"estado": "parcial"}

    monkeypatch.setattr(CO.AGORA, "revisar_cierre", parar)
    asyncio.run(sup._cerrar_con_presupuesto(_corrida(al, ids), _it(al, ids)))
    c = _corrida(al, ids)
    assert c["estado"] == estado and not llamadas.vistas
    assert _it(al, ids)["terminadaEn"] is None
    if estado == "detenida":
        assert c["motivoCierre"] == "Parada humana"


def test_cancelacion_no_es_una_revision_completa(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes

    async def cancelar(ctx, *, motivo=None):
        raise asyncio.CancelledError

    monkeypatch.setattr(CO.AGORA, "revisar_cierre", cancelar)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "en_marcha"
    assert not _corrida(al, ids).get("revisionAgora")
    assert not llamadas.vistas


def test_intento_parcial_guardado_permite_cierre_con_limites_visibles(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes
    original = CO.AGORA.revisar_cierre

    async def parcial(ctx, *, motivo=None):
        await original(ctx, motivo=motivo)

        def guardar(e):
            A.corrida_de(e, ids["cor"])["revisionAgora"]["estado"] = "parcial"
            h = next(h for h in e["hipotesis"] if h["id"] == ids["hip"])
            h["revisionAgora"] = {"estado": "parcial", "detalle": "Agora: no pude comprobar MAPT por tiempo agotado; revisión parcial"}
            return True

        ctx.mutar(guardar, "agora_parcial")
        return ctx.corrida()["revisionAgora"]

    monkeypatch.setattr(CO.AGORA, "revisar_cierre", parcial)
    al.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("condicionParada", "1 iteración") or True, "parada")
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "terminada"
    assert _corrida(al, ids)["revisionAgora"]["estado"] == "parcial"
    assert any("no pude comprobar MAPT" in t for t in _hip(al, ids)["conclusion"]["noComprobado"])
    resumen = next(kw for programa, kw in llamadas.vistas if programa == "resumir")
    assert "revisión parcial" in resumen["sin_comprobar"]


def test_mutador_terminal_exige_revision_y_respeta_pausa(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes
    assert not CO._terminar_corrida(al.estado, ids["cor"], "Límite")
    asyncio.run(sup._revisar_agora_cierre(_corrida(al, ids), _it(al, ids)))
    A.pausar_corrida(al.estado, ids["cor"])
    assert not CO._terminar_corrida(al.estado, ids["cor"], "Límite")
    assert _corrida(al, ids)["estado"] == "pausada"


def test_condicion_cambiada_durante_revision_no_cierra(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes
    original = CO.AGORA.revisar_cierre

    def preparar(e):
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["condicionParada"] = "1 iteración"
        next(i for i in e["iteraciones"] if i["id"] == ids["it"])["terminadaEn"] = 2000
        return True

    al.mutar(preparar, "preparar")

    async def cambiar(ctx, *, motivo=None):
        resultado = await original(ctx, motivo=motivo)
        ctx.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("condicionParada", "10 iteraciones") or True, "ampliar_condicion")
        return resultado

    monkeypatch.setattr(CO.AGORA, "revisar_cierre", cambiar)
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "en_marcha"
    assert _corrida(al, ids)["terminadaEn"] is None


def test_inventario_cambiado_al_final_exige_otro_intento(arnes, monkeypatch):
    al, ids, sup, ctx, llamadas, consultas = arnes
    original = CO.AGORA.revisar_cierre

    def preparar(e):
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["condicionParada"] = "1 iteración"
        next(i for i in e["iteraciones"] if i["id"] == ids["it"])["terminadaEn"] = 2000
        return True

    al.mutar(preparar, "preparar")

    async def cambiar(ctx, *, motivo=None):
        resultado = await original(ctx, motivo=motivo)
        if len(consultas) == 1:
            nueva = P.nueva_hipotesis(ids["inv"], 1, P.ahora_ms(), titulo="Diana añadida durante la consulta")
            ctx.mutar(lambda e: e["hipotesis"].append(nueva) or True, "nueva_diana")
        return resultado

    monkeypatch.setattr(CO.AGORA, "revisar_cierre", cambiar)
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "en_marcha"
    assert _corrida(al, ids).get("_cierreAgoraPendiente")
    asyncio.run(sup._proponer_plan(_corrida(al, ids), _it(al, ids)))
    assert _corrida(al, ids)["estado"] == "terminada" and len(consultas) == 2


def test_cambio_de_revision_invalida_huella_y_no_aplica_no_es_pendiente(arnes):
    al, ids, sup, ctx, llamadas, consultas = arnes
    h = _hip(al, ids)
    antes = CO.huella_de_conclusion(h)
    h["revisionAgora"] = {"estado": "completa", "detalle": "Agora: nominación de gen consultada, sin acreditar eficacia"}
    assert CO.huella_de_conclusion(h) != antes
    h["revisionAgora"] = {"estado": "no_aplica", "detalle": "Sin gen aplicable"}
    h["novedad"]["agora"] = {"estado": "no_aplica", "detalle": "No comprobado: sin gen aplicable"}
    asyncio.run(sup._concluir_hipotesis(ctx, h))
    assert not any("Agora" in texto or "agora" in texto for texto in _hip(al, ids)["conclusion"]["noComprobado"])
