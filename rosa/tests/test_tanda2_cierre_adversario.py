"""Adversario del constructor "cierre" (tanda 2, revisión del 17 de septiembre
de 2026). Intenta romper S-27 (réplica), S-13 (Bradley-Terry sin duplicados)
y S-14 (coste del cierre) tal como quedaron en el árbol de trabajo. Ningún
test llama a la red ni al gateway: `Ctx.llamar` se sustituye por un doble que
lanza si alguien lo intenta.

Lo que cada test demuestra está en su nombre; los que empiezan por
`test_falla_` son los hallazgos (fallan si el problema sigue, pasan cuando se
arregle). Los demás son comprobaciones que el constructor no hizo y que hoy
pasan.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from rosa import torneo
from rosa import verificador as V
from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.tests.test_integracion_pasos import _afirmacion, _ctx, _hipotesis


def _corrida_con_fuente(e: dict[str, Any], inv_id: str, numero: int, fuente_id: str, referencia: str, fragmentos: list[tuple[str, str]]) -> dict[str, Any]:
    """Una corrida terminada con una fuente privada y sus fragmentos (localizador, texto)."""
    c = P.nueva_corrida(inv_id, numero, 1000)
    c["estado"] = "terminada"
    c["_fuentes"] = {fuente_id: {"id": fuente_id, "referencia": referencia, "titulo": f"Título de {fuente_id} con veinte letras", "fragmentos": [{"localizador": loc, "texto": texto, "encabezado": "Results"} for loc, texto in fragmentos]}}
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


# ---------------------------------------------------------------------------
# S-27: la réplica no puede cruzar fuentes homónimas (regla 3 del verificador, S-04)
# ---------------------------------------------------------------------------


def test_falla_la_replica_cae_a_una_fuente_homonima_cuando_la_propia_no_tiene_ese_localizador():
    """La cita lleva `fuenteId` = X. X está registrada en una corrida de la
    investigación pero sin el localizador de la cita (la página no se
    extrajo). Otra fuente Z, una obra DISTINTA con la misma referencia corta
    ("A et al., 2025" son dos artículos del mismo primer autor y año), sí tiene
    esa página en otra corrida. `V.candidatos_cita` se niega a caer a la
    referencia en este caso ("caería en una fuente homónima distinta y la
    afirmación se juzgaría contra el texto equivocado"); el respaldo que añadió
    `_preparar_copias_replica` (`candidatos_cita(..., None)` cuando el id no
    resuelve) deshace esa protección: la cita "resuelve" al texto de Z, el
    `fuenteId` de la copia pasa a ser Z y la réplica juzga contra la obra
    equivocada. Lo esperado: no resolver a Z y caer al pasaje guardado
    (marcado "no releída") o a "no comprobable"."""
    e = P.estado_inicial()
    _corrida_con_fuente(e, "inv", 1, "f-x", "A et al., 2025", [("resumen", "Resumen de la obra X, que no habla de la página siete.")])
    _corrida_con_fuente(e, "inv", 2, "f-z", "A et al., 2025", [("pág. 7", "Texto de la obra Z, un artículo distinto del mismo autor y año.")])
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x", cita="[A et al., 2025, pág. 7]", fragmento="GENHEP increases in reactive astrocytes of the hippocampus")])
    frags = T.fragmentos_de_investigacion(e, "inv")
    # El verificador, con el id de la fuente, dice que NO resuelve (X no tiene la página 7).
    assert V.resolver_cita("[A et al., 2025, pág. 7]", frags, "f-x") is None
    copias, comprobables, guardados, citas = CO._preparar_copias_replica(h, frags)
    copia = comprobables[0]
    assert copia["fuenteId"] != "f-z", f"la copia cambió de fuente a la homónima Z: {copia['fuenteId']}"
    assert not copia["fragmento"].startswith("Texto de la obra Z"), "la afirmación se juzgaría contra la obra equivocada"
    assert citas["resuelven"] == 0 and (citas["guardadas"] == 1 or citas["sinComprobar"] == 1), citas
    assert CO.citas_de_replica(e, h)["resuelven"] == 0


def test_la_replica_si_puede_caer_a_la_referencia_cuando_el_id_no_esta_en_ninguna_corrida():
    """El caso que el respaldo quería cubrir (S-06: la misma obra registrada
    con otro id en otra corrida) sigue funcionando: el id X no está en ningún
    fragmento y la referencia y el localizador coinciden. Este test pasa hoy;
    fija el comportamiento que el arreglo del anterior no debe perder."""
    e = P.estado_inicial()
    _corrida_con_fuente(e, "inv", 2, "f-y", "A et al., 2025", [("pág. 3", "GENHEP increases in reactive astrocytes of the hippocampus in this cohort.")])
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-x-borrada")])
    frags = T.fragmentos_de_investigacion(e, "inv")
    _, comprobables, _, citas = CO._preparar_copias_replica(h, frags)
    assert citas["resuelven"] == 1 and comprobables[0]["fuenteId"] == "f-y"


# ---------------------------------------------------------------------------
# S-27: un pasaje guardado sin releer no puede fabricar una contradicción
# ---------------------------------------------------------------------------


def test_falla_el_pasaje_guardado_sin_releer_produce_una_contradiccion_determinista(monkeypatch):
    """La fuente no está en ninguna corrida; la afirmación conserva el pasaje
    (600 caracteres como mucho, `_entrada`). El texto de la afirmación nombra
    un identificador (el NCT del ensayo) que en la fuente estaba en otra frase
    de la misma página, así que al extraer se juzgó SOSTENIDA contra la página
    entera. En la réplica, el determinista compara los identificadores contra
    el pasaje de 600 caracteres, no los encuentra y dictamina `no_sostenida`
    sin llamar al juez; `no_sostenida` bloquea y la trayectoria se cuenta como
    "contradice". Nadie releyó la fuente: por el contrato del proyecto eso es
    "no pude comprobar", nunca una contradicción. El constructor acotó el
    veredicto positivo a "parcial" pero dejó el negativo entero."""
    al, ctx = _ctx()
    intentos = _llamar_prohibido(monkeypatch)
    texto = "In CLARITY AD (NCT03887455), lecanemab reduced brain amyloid by 59 centiloids at 18 months"
    pasaje = "Lecanemab reduced brain amyloid by 59 centiloids at 18 months compared with placebo in the modified intention-to-treat population."
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-perdida", cita="[A et al., 2025, pág. 3]", texto=texto, fragmento=pasaje)])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    assert CO.citas_de_replica(al.estado, h) == {"total": 1, "resuelven": 0, "guardadas": 1, "sinComprobar": 0}
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    assert intentos == [], "el determinista lo decidió solo: ningún modelo intervino"
    r = next(x for x in al.estado["hipotesis"] if x["id"] == h["id"])["replicacion"]
    assert r["hechas"] == 1 and r["estado"] == "terminada"
    assert r["contradicen"] == 0, f"una fuente que no se pudo releer se contó como contradicción: {r} / {r.get('trayectorias')}"
    al.cerrar()


def test_una_trayectoria_solo_de_pasajes_guardados_sostenidos_no_se_anuncia_como_replica_que_sostiene(monkeypatch):
    """Simétrico del anterior, hoy pasa a medias y se deja como comprobación:
    con TODAS las citas sobre pasaje guardado (nada releído) el veredicto de
    cada afirmación queda en "parcial", pero la trayectoria se cuenta entera
    como "sostiene" y el mensaje final dice "1 de 1 trayectorias sostienen".
    El test solo fija que el mensaje y `trayectorias` dejan constancia de que
    nada se releyó (lo que el constructor sí hizo)."""
    al, ctx = _ctx()
    _llamar_prohibido(monkeypatch)
    h = _hipotesis(afirmaciones=[_afirmacion(fuenteId="f-perdida")])
    h["replicacion"] = {"total": 1, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": 1}
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")

    async def verificar(ctx_, copias, pista, pregunta, rol="juez", rollout_id=None):
        for a in copias:
            a["veredicto"] = "sostenida"
        return {}

    from rosa.bucle import pasos as PASOS

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar)
    sup = CO.Supervisor(al, SimpleNamespace(), ctx.modelos)
    asyncio.run(sup._replicar_paso(ctx, h))
    x = next(y for y in al.estado["hipotesis"] if y["id"] == h["id"])
    r = x["replicacion"]
    assert r["trayectorias"][0]["noReleidas"] == 1 and r["trayectorias"][0]["comprobadas"] == 1
    assert any("sin releer la fuente" in m["texto"] for m in x["procedencia"]["mensajes"])
    al.cerrar()


# ---------------------------------------------------------------------------
# S-13: el "último" partido de un par antiguo no se puede elegir por el número de iteración
# ---------------------------------------------------------------------------


def test_falla_partidos_unicos_elige_como_ultimo_el_de_mayor_numero_de_iteracion_aunque_sea_de_una_corrida_anterior():
    """Los partidos antiguos (sin huella) del mismo par se colapsan "al último"
    ordenando por (iteración, posición). El número de iteración se reinicia en
    cada corrida (M-20): un partido de la corrida 8, iteración 3, gana a uno
    de la corrida 9, iteración 1, que es el más reciente de verdad. Si el
    ganador cambió entre los dos, Bradley-Terry se queda con el resultado
    viejo. Aquí `a` ganó en la corrida 8 (iteración 3) y `b` ganó después, en
    la corrida 9 (iteración 1): el orden de la lista de partidos (que sí es
    cronológico dentro de cada hipótesis) dice que el último es el de `b`."""
    a = {"id": "a", "estado": "propuesta", "elo": 1500, "partidos": [{"rivalId": "b", "resultado": "gano", "iteracion": 3}, {"rivalId": "b", "resultado": "perdio", "iteracion": 1}]}
    b = {"id": "b", "estado": "propuesta", "elo": 1500, "partidos": [{"rivalId": "a", "resultado": "perdio", "iteracion": 3}, {"rivalId": "a", "resultado": "gano", "iteracion": 1}]}
    assert torneo._partidos_unicos([a, b]) == [("b", "a")], "el más reciente es el que ganó b (posición 2 en las dos listas), no el de la iteración 3"


# ---------------------------------------------------------------------------
# S-14: comprobaciones que el constructor no hizo (hoy pasan)
# ---------------------------------------------------------------------------


def test_llamadas_restantes_y_coste_toleran_registros_antiguos_sin_presupuesto_ni_plan():
    c = {"investigacionId": "inv", "presupuesto": {}, "gasto": {}}
    assert CO.llamadas_restantes({}, c, None) == 0
    assert CO.llamadas_restantes({}, c, {}) == 0
    e = {"hipotesis": [], "investigaciones": []}
    assert CO.coste_estimado_del_cierre(e, c, {"numero": 1}) == {"total": 0, "desglose": {}} or CO.coste_estimado_del_cierre(e, c, {"numero": 1})["total"] >= 0
    assert CO.coste_previsto_del_cierre(e, "inv") == 5  # resumen, llano, revisor y la vuelta de reparación (2)


def test_el_retroceso_no_se_reinicia_mientras_la_tarea_muera_al_poco_de_relanzarse():
    """`_puede_relanzar` cuenta el fallo como seguido si la tarea murió menos de
    diez minutos después de relanzarse; la espera entre fallos (hasta 30 min)
    no entra en esa cuenta, así que la escalera 30 s, 60 s, 5, 10, 20, 30 min
    se sostiene. Se comprueba con un supervisor mínimo y tareas ya muertas."""

    class Tarea:
        def __init__(self, ex: BaseException) -> None:
            self._ex = ex

        def cancelled(self) -> bool:
            return False

        def exception(self) -> BaseException:
            return self._ex

    sup = CO.Supervisor.__new__(CO.Supervisor)
    sup._fallos = {}
    mutaciones: list[str] = []
    sup.almacen = SimpleNamespace(mutar=lambda fn, nombre="": mutaciones.append(nombre))
    c = {"id": "c1", "numero": 1, "investigacionId": "inv"}
    ahora = 1_000_000
    esperas = []
    for _ in range(6):
        t = Tarea(RuntimeError("se cayó"))
        assert sup._puede_relanzar(c, t, ahora) is False  # primer tick tras la muerte: incidencia y espera
        esperas.append(sup._fallos["c1"]["espera"])
        ahora += sup._fallos["c1"]["espera"]
        assert sup._puede_relanzar(c, t, ahora) is True  # pasó la espera: se relanza
        ahora += 1_000  # muere un segundo después
    assert esperas == [30_000, 60_000, 300_000, 600_000, 1_200_000, 1_800_000]
