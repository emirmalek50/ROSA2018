"""El reloj de una corrida que espera no se escribe por tiempo, y un reinicio no
convierte la espera en trabajo (28 de septiembre de 2026).

Antes, una corrida pausada por presupuesto volcaba su espera cada 30 s aunque
nada se moviera: 504 tics en un día sin nada en marcha, cada uno reescribiendo
el estado entero y dejando una fila en el registro de auditoría. El volcado
periódico protegía una cosa real: que al reiniciar, el tiempo en pausa no
contara como trabajo (lo que dispara el tope en horas). Ahora lo protege el
ancla `_relojEn`: el instante hasta el que los contadores guardados son exactos.
"""

from __future__ import annotations

import asyncio

from rosa.bucle import corrida as CO
from rosa.tests.test_integracion_corrida import _preparar, _supervisor

DIA_MS = 24 * 3_600_000


def _corrida(al, ids):
    return next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])


def _poner_estado(al, ids, estado):
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", estado) or True, "estado")


def _con_tareas_dormidas(sup, monkeypatch):
    async def dormida(cid):
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)


def _cancelar(sup):
    for t in sup.tareas.values():
        t.cancel()


def test_una_corrida_en_espera_no_se_vuelca_por_tiempo(monkeypatch):
    al, ids = _preparar()
    _poner_estado(al, ids, "pausada_por_presupuesto")
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)

    async def cuerpo():
        t0 = 10_000
        sup._tick(ahora=t0)  # la primera vez escribe el ancla
        v0 = al.version
        assert _corrida(al, ids)["_relojEn"] == t0
        for minuto in range(1, 121):  # dos horas de tics, uno por minuto
            sup._tick(ahora=t0 + minuto * 60_000)
        assert al.version == v0, "una corrida en espera no debe reescribir el estado por el paso del tiempo"
        c = _corrida(al, ids)
        # En memoria la espera está al día: el tope en horas la ve.
        assert sup._con_reloj(c)["esperaHumanaMs"] == int(c.get("esperaHumanaMs") or 0) + 120 * 60_000
        _cancelar(sup)

    asyncio.run(cuerpo())


def test_tras_reiniciar_los_dias_en_pausa_no_cuentan_como_trabajo(monkeypatch):
    al, ids = _preparar()
    _poner_estado(al, ids, "pausada_por_presupuesto")
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)
    t0 = 50_000

    async def antes():
        sup._tick(ahora=t0)
        _cancelar(sup)

    asyncio.run(antes())
    c = _corrida(al, ids)
    trabajo_antes = CO.tiempo_trabajo_ms(c, t0)

    # Reinicio: un supervisor nuevo, sin nada en memoria, tres días después.
    sup2, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup2, monkeypatch)
    t1 = t0 + 3 * DIA_MS

    async def despues():
        sup2._tick(ahora=t1)
        _cancelar(sup2)

    asyncio.run(despues())
    c = _corrida(al, ids)
    en_memoria = sup2._con_reloj(c)
    assert CO.tiempo_trabajo_ms(en_memoria, t1) == trabajo_antes, "los tres días en pausa se contaron como trabajo"
    assert en_memoria["esperaHumanaMs"] == int(c.get("esperaHumanaMs") or 0) + 3 * DIA_MS
    # Y sigue sin escribir: el hueco vive en memoria hasta el próximo cambio de estado.
    assert c["_relojEn"] == t0


def test_sin_ancla_el_reloj_no_arrastra_el_hueco_y_la_escribe_una_vez(monkeypatch):
    """Un estado de antes de este cambio no tiene ancla: el primer tic la escribe
    (una escritura) y desde ahí la espera ya no se vuelca por tiempo."""
    al, ids = _preparar()
    _poner_estado(al, ids, "pausada")
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).pop("_relojEn", None) or True, "sin_ancla")
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)

    async def cuerpo():
        v = al.version
        sup._tick(ahora=1_000_000)
        assert al.version == v + 1 and _corrida(al, ids)["_relojEn"] == 1_000_000
        sup._tick(ahora=1_000_000 + DIA_MS)
        assert al.version == v + 1
        _cancelar(sup)

    asyncio.run(cuerpo())


def test_una_corrida_que_trabajaba_no_cuenta_el_apagado_como_trabajo(monkeypatch):
    al, ids = _preparar()  # la corrida está en marcha desde 1000
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)
    t0 = 100_000

    async def antes():
        sup._tick(ahora=t0)
        sup._tick(ahora=t0 + 31_000)  # el volcado de los 30 s deja el ancla
        _cancelar(sup)

    asyncio.run(antes())
    c = _corrida(al, ids)
    assert c["_relojEn"] == t0 + 31_000
    trabajo_antes = CO.tiempo_trabajo_ms(sup._con_reloj(c), t0 + 31_000)

    sup2, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup2, monkeypatch)
    t1 = t0 + 31_000 + 3_600_000  # una hora con el proceso apagado

    async def despues():
        sup2._tick(ahora=t1)
        _cancelar(sup2)

    asyncio.run(despues())
    c = _corrida(al, ids)
    assert CO.tiempo_trabajo_ms(sup2._con_reloj(c), t1) == trabajo_antes, "la hora con el proceso apagado se contó como trabajo"
    assert sup2._con_reloj(c)["pausaMs"] == int(c.get("pausaMs") or 0) + 3_600_000


def test_un_ancla_rota_no_rompe_el_reloj(monkeypatch):
    for mala in ("ayer", True, -5, 10**15, None, [1], {"t": 1}):
        al, ids = _preparar()
        _poner_estado(al, ids, "esperando_plan")
        al.mutar(lambda e, mala=mala: next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("_relojEn", mala) or True, "ancla_rota")
        sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
        _con_tareas_dormidas(sup, monkeypatch)

        async def cuerpo(sup=sup):
            sup._tick(ahora=2_000_000)
            _cancelar(sup)

        asyncio.run(cuerpo())
        c = _corrida(al, ids)
        # Un ancla que no es un instante válido se ignora: no reparte ningún hueco
        # inventado y se sustituye por una buena.
        assert c["_relojEn"] == 2_000_000, f"ancla {mala!r}"
        assert int(sup._con_reloj(c)["esperaHumanaMs"]) == int(c.get("esperaHumanaMs") or 0), f"ancla {mala!r} repartió un hueco"


def test_al_reanudar_la_espera_se_escribe_exacta_una_vez(monkeypatch):
    al, ids = _preparar()
    _poner_estado(al, ids, "pausada")
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)

    async def cuerpo():
        sup._tick(ahora=10_000)
        espera0 = int(_corrida(al, ids).get("esperaHumanaMs") or 0)
        sup._tick(ahora=10_000 + 600_000)
        _poner_estado(al, ids, "en_marcha")
        v = al.version
        sup._tick(ahora=10_000 + 600_000 + 1_000)
        c = _corrida(al, ids)
        assert al.version == v + 1
        # La espera acumulada llega al disco con el cambio de estado.
        assert int(c["esperaHumanaMs"]) >= espera0 + 600_000
        assert c["_relojEn"] == 10_000 + 600_000 + 1_000
        _cancelar(sup)

    asyncio.run(cuerpo())


def test_una_corrida_que_trabaja_no_escribe_en_su_primer_tic(monkeypatch):
    """El ancla inmediata es solo para las que esperan: una corrida en marcha la
    recibe con su volcado de los 30 s, y el primer tic tras arrancar no escribe."""
    al, ids = _preparar()
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)

    async def cuerpo():
        v = al.version
        sup._tick(ahora=5_000)
        assert al.version == v and "_relojEn" not in _corrida(al, ids)
        _cancelar(sup)

    asyncio.run(cuerpo())


def test_el_ancla_no_viaja_al_navegador(monkeypatch):
    al, ids = _preparar()
    _poner_estado(al, ids, "pausada")
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)
    _con_tareas_dormidas(sup, monkeypatch)

    async def cuerpo():
        sup._tick(ahora=5_000)
        _cancelar(sup)

    asyncio.run(cuerpo())
    assert "_relojEn" in _corrida(al, ids)
    assert all("_relojEn" not in c for c in al.instantanea()["corridas"])
