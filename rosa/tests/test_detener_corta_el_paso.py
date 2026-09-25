"""Detener o pausar cortan el paso en curso (rosa/bucle/pasos.py, CorridaParada).

Hasta el 25 de septiembre de 2026 el estado de la corrida solo se miraba entre
paso y paso: la corrida 15 se detuvo con 2 llamadas hechas y el paso de
literatura siguió hasta pagar 146 más, y quedó "hecho". Ahora `Ctx.llamar` lo
mira antes de cada llamada en el contexto que ejecuta pasos, y el paso vuelve a
pendiente con sus pistas "detenida". El trabajo de fondo que pide la persona
sobre una corrida parada (una revisión, los datos del laboratorio) sigue
funcionando. Sin red ni modelos.
"""

import asyncio
from types import SimpleNamespace

import pytest

from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.tests.test_integracion_corrida import _preparar


def _corrida(al, ids):
    return next(c for c in al.estado["corridas"] if c["id"] == ids["cor"])


def _llamadas_falsas(monkeypatch, al, ids, parar_en: int | None, accion=A.detener_corrida):
    """Sustituye la llamada al gateway: cuenta las llamadas y, en la número
    `parar_en`, la persona pulsa Detener (o Pausar)."""
    hechas = []

    async def vigilado(ejecutar, rol, lm, ganchos=None):
        hechas.append(rol)
        if parar_en is not None and len(hechas) == parar_en:
            al.mutar(lambda e: accion(e, ids["cor"], "Emir", 5000) if accion is A.detener_corrida else accion(e, ids["cor"]), "persona")
        await asyncio.sleep(0)
        return SimpleNamespace(ok=True)

    monkeypatch.setattr(PASOS.VIG, "llamar_vigilado", vigilado)
    monkeypatch.setattr(PASOS, "presupuesto_ok", lambda *a, **k: True)
    return hechas


def _modelos():
    lm = SimpleNamespace(model="sim")
    return SimpleNamespace(cerebro=lm, juez=lm, volumen=lm)


def test_el_contexto_de_un_paso_no_llama_con_la_corrida_detenida(monkeypatch):
    al, ids = _preparar()
    hechas = _llamadas_falsas(monkeypatch, al, ids, None)
    ctx = Ctx(al, SimpleNamespace(), _modelos(), ids["cor"], ids["inv"], ids["it"], 1, de_paso=True)
    asyncio.run(ctx.llamar("juez", "programa"))
    assert hechas == ["juez"]
    for estado in PASOS.ESTADOS_QUE_PARAN_EL_PASO:
        _corrida(al, ids)["estado"] = estado
        with pytest.raises(PASOS.CorridaParada) as ex:
            asyncio.run(ctx.llamar("juez", "programa"))
        assert ex.value.estado == estado
    assert hechas == ["juez"]  # ninguna más


def test_el_trabajo_de_fondo_sobre_una_corrida_parada_sigue_llamando(monkeypatch):
    """Lo que pide la persona con la corrida detenida (una revisión, los datos
    del laboratorio) usa un contexto sin `de_paso` y no se corta."""
    al, ids = _preparar()
    hechas = _llamadas_falsas(monkeypatch, al, ids, None)
    _corrida(al, ids)["estado"] = "detenida"
    ctx = Ctx(al, SimpleNamespace(), _modelos(), ids["cor"], ids["inv"], ids["it"], 1)
    asyncio.run(ctx.llamar("juez", "programa"))
    assert hechas == ["juez"]


@pytest.mark.parametrize("accion", [A.detener_corrida, A.pausar_corrida])
def test_detener_o_pausar_a_mitad_de_un_paso_corta_las_llamadas_y_deja_el_paso_pendiente(monkeypatch, accion):
    """El escenario de la corrida 15: un paso con veinte llamadas en paralelo
    que, además, se traga los fallos de cada elemento (como la verificación y
    los supuestos). La persona detiene durante la primera: no hay ninguna más."""
    al, ids = _preparar()
    hechas = _llamadas_falsas(monkeypatch, al, ids, parar_en=1, accion=accion)

    async def paso_de_veinte(ctx, paso):
        async def una(i):
            try:
                await ctx.llamar("juez", "juzgar")
            except Exception:  # noqa: BLE001  el patrón de los pasos reales
                pass
        sem = asyncio.Semaphore(1)

        async def acotada(i):
            async with sem:
                await una(i)

        await PASOS._en_paralelo(*(acotada(i) for i in range(20)))
        return "20 juzgadas"

    monkeypatch.setitem(PASOS.EJECUTORES, "verificacion", paso_de_veinte)
    monkeypatch.setattr(CO.T, "inferir_tipo_paso", lambda paso: "verificacion")
    sup = CO.Supervisor(al, SimpleNamespace(), _modelos())
    paso = {"id": "p1", "titulo": "Verificar", "detalle": "", "estado": "pendiente"}

    def poner_paso(e):
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["plan"] = [dict(paso)]
        it["pistas"] = [{"id": "pi1", "pasoId": "p1", "estado": "en_curso", "titulo": "Verificar", "resumen": ""}]
        return True

    al.mutar(poner_paso, "t")
    c = _corrida(al, ids)
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    termina = asyncio.run(sup._ejecutar_paso(c, it, it["plan"][0]))
    assert len(hechas) == 1, f"después de detener se hicieron {len(hechas) - 1} llamadas más"
    assert termina is True
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    assert it["plan"][0]["estado"] == "pendiente"  # no "hecho" con basura
    pista = it["pistas"][0]
    assert pista["estado"] == "detenida" and "no se hizo ninguna llamada más" in pista["resumen"]


def test_la_senal_se_propaga_por_en_paralelo_aunque_se_pidan_las_excepciones():
    async def corta():
        raise PASOS.CorridaParada("detenida")

    async def normal():
        await asyncio.sleep(0.01)
        return 1

    with pytest.raises(PASOS.CorridaParada):
        asyncio.run(PASOS._en_paralelo(corta(), normal(), return_exceptions=True))
