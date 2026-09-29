"""Las dos lecturas de un partido del torneo van a la vez (28 de septiembre de
2026).

Un partido se juzga dos veces, A contra B y B contra A, para que el orden en
que se le presentan las candidatas no decida el resultado. Las dos lecturas
son independientes y se pedían UNA DESPUÉS DE OTRA: con una mediana de 18 s
por llamada al juez, cada partido costaba unos 36 s de espera, y el torneo es
la parte más lenta del paso de hipótesis.

Medido sobre la corrida `cor-mulntlr0-42`: 2,26 h de reloj con una
concurrencia media de 2,02 llamadas, donde los semáforos permiten 4. El
trabajo no llegaba en tandas suficientes para llenarlos.

Lo que este test sujeta es que las dos lecturas se solapan en el tiempo, y lo
que NO cambia: que siguen siendo dos llamadas, que el orden de los partidos
entre sí se respeta (es lo único que afectaría al Elo, que es acumulativo) y
que si una de las dos falla el partido se salta como antes.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from rosa.bucle import pasos as PASOS


class _Juez:
    """Un juez de mentira que tarda `demora` en cada llamada y anota cuándo
    empezó y acabó cada una, para poder ver si dos se solapan."""

    def __init__(self, demora: float = 0.25) -> None:
        self.demora = demora
        self.tramos: list[tuple[float, float]] = []
        self.llamadas = 0

    async def __call__(self, *_a: Any, **_k: Any) -> Any:
        inicio = time.perf_counter()
        self.llamadas += 1
        await asyncio.sleep(self.demora)
        fin = time.perf_counter()
        self.tramos.append((inicio, fin))
        return None

    @property
    def se_solapan(self) -> bool:
        if len(self.tramos) < 2: return False
        a, b = sorted(self.tramos)[:2]
        return b[0] < a[1]


def test_en_paralelo_solapa_de_verdad():
    """La pieza que usa el torneo: dos corrutinas lanzadas juntas se solapan."""
    juez = _Juez(0.25)

    async def cuerpo():
        return await PASOS._en_paralelo(juez(), juez())

    t0 = time.perf_counter()
    asyncio.run(cuerpo())
    total = time.perf_counter() - t0
    assert juez.llamadas == 2, "siguen siendo dos lecturas, no una"
    assert juez.se_solapan, "las dos lecturas del par tienen que ir a la vez"
    assert total < 0.45, f"en serie tardaría 0,50 s; tardó {total:.2f}"


def test_si_una_lectura_falla_el_partido_se_salta_y_no_tumba_el_torneo():
    """`_en_paralelo` propaga la excepción, que es lo que el torneo espera:
    el `except` de alrededor salta ese partido y sigue con el siguiente."""

    async def buena():
        await asyncio.sleep(0.01)
        return "ok"

    async def mala():
        await asyncio.sleep(0.01)
        raise RuntimeError("el juez no respondió")

    async def cuerpo():
        return await PASOS._en_paralelo(buena(), mala())

    with pytest.raises(RuntimeError, match="no respondió"):
        asyncio.run(cuerpo())


def test_las_excepciones_que_cortan_el_paso_siguen_cortando():
    """Presupuesto agotado y modelo sin respuesta tienen que salir del torneo
    enteras, no quedarse dentro del partido: el `except` de arriba las
    relanza. Si `_en_paralelo` se las tragara, la corrida seguiría gastando."""
    from rosa.modulos.contador import PresupuestoAgotado

    async def agota():
        await asyncio.sleep(0.01)
        raise PresupuestoAgotado("sin tope")

    async def lenta():
        await asyncio.sleep(0.5)
        return "tarde"

    async def cuerpo():
        return await PASOS._en_paralelo(agota(), lenta())

    t0 = time.perf_counter()
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(cuerpo())
    # Y no se queda esperando a la lenta para enterarse.
    assert time.perf_counter() - t0 < 0.45


def test_el_torneo_pide_las_dos_lecturas_juntas():
    """El código del torneo usa `_en_paralelo` para el par, no dos `await`
    seguidos. Si alguien lo vuelve a poner en serie, esto lo dice."""
    import inspect

    fuente = inspect.getsource(PASOS)
    i = fuente.index("Los partidos con juez, a ciegas")
    tramo = fuente[i:i + 2200]
    assert "p1, p2 = await _en_paralelo(" in tramo, "las dos lecturas del par volvieron a ir en serie"
    assert "p1 = await ctx.llamar" not in tramo
