"""Prueba de punta a punta del vigilante de modelos: los huecos cruzados que
quedaron entre los tres constructores (18 de septiembre de 2026) y sus guardias.

- `rosa/bucle/corrida.py` usa la excepción y el intervalo del vigilante (una
  sola definición), no una copia local.
- La revisión pedida con Opus caído no cuenta como intento del Killer ni se da
  por fallida: la petición sigue en pie y se hace cuando el juez vuelva.
- Una trayectoria de replicación con el juez caído no se consume como "no
  comprobable".
- Al terminar una corrida, sus incidencias `modelo_sin_respuesta` pendientes se
  resuelven (misma regla que al detenerla).
- `rosa/bucle/analisis.py` y `rosa/bucle/evidencia.py` relanzan
  `ModeloSinRespuesta` en vez de tragárselo como "no se pudo reparar/interpretar".

Ningún test sale a la red ni espera: los modelos se sustituyen por funciones
que lanzan lo que se quiere probar.
"""

from __future__ import annotations

import asyncio
import inspect
import re
from pathlib import Path
from typing import Any

import pytest

from rosa import vigilante_modelos as VIG
from rosa.bucle import analisis as AN
from rosa.bucle import corrida as CO
from rosa.bucle import evidencia as EV
from rosa.estado import plantilla as P
from rosa.tests.test_integracion_corrida import _hip, _preparar, _supervisor

OPUS = "openai/anthropic/claude-opus-5"
MIN = 60_000


def _corrida(al, ids) -> dict[str, Any]:
    return next(c for c in al.estado["corridas"] if c["id"] == ids["cor"])


def _pistas(al, ids) -> list[dict[str, Any]]:
    it = next((x for x in al.estado["iteraciones"] if x["id"] == ids["it"]), None)
    return list((it or {}).get("pistas", []))


def _sin_respuesta(rol: str = "juez") -> VIG.ModeloSinRespuesta:
    return VIG.ModeloSinRespuesta(rol, OPUS, 4, P.ahora_ms() - 20 * MIN)


# ---------------------------------------------------------------------------
# Una sola excepción para las dos piezas
# ---------------------------------------------------------------------------


def test_corrida_usa_la_excepcion_y_el_intervalo_del_vigilante_sin_copia_local():
    assert CO.ModeloSinRespuesta is VIG.ModeloSinRespuesta
    assert CO.INTERVALO_SONDEO_S == VIG.INTERVALO_SONDEO_S
    assert CO.VIG is VIG
    fuente = Path(CO.__file__).read_text(encoding="utf-8")
    assert "except ImportError" not in fuente.split("# Cada cuánto da una vuelta el supervisor")[0], "volvió la copia local de ModeloSinRespuesta en corrida.py"
    # Lo que lanza el vigilante lo captura el supervisor, y al revés.
    ex = VIG.ModeloSinRespuesta("juez", OPUS, 4, 123)
    assert isinstance(ex, CO.ModeloSinRespuesta) and (ex.rol, ex.modelo, ex.intentos, ex.desde) == ("juez", OPUS, 4, 123)


# ---------------------------------------------------------------------------
# Revisión pedida con el juez caído
# ---------------------------------------------------------------------------


def _pedir_revision_con_la_corrida_terminada(al, ids) -> None:
    def fn(e: dict[str, Any]) -> bool:
        next(x for x in e["corridas"] if x["id"] == ids["cor"])["estado"] = "terminada"
        next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["_revisionPedida"] = True
        return True

    al.mutar(fn, "pedir")


def test_la_revision_pedida_con_opus_caido_sigue_en_pie_y_no_cuenta_intento(monkeypatch):
    al, ids = _preparar()
    _pedir_revision_con_la_corrida_terminada(al, ids)
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)

    async def juez_caido(*a, **k):
        raise _sin_respuesta("juez")

    monkeypatch.setattr(CO.PASOS, "_revisar_hipotesis", juez_caido)
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(sup._atender_peticiones())
    h = _hip(al, ids)
    assert h.get("_revisionPedida") is True, "la petición de la persona se perdió mientras el juez no respondía"
    assert "_killerIntentos" not in h, "una caída del juez contó como intento del Killer (con tres, la petición se abandona)"
    pistas = _pistas(al, ids)
    assert len(pistas) == 1 and pistas[0]["estado"] == "fallida"
    assert "Claude Opus 5" in pistas[0]["resumen"] and "sigue en pie" in pistas[0]["resumen"]
    assert "La revisión falló" not in pistas[0]["resumen"]
    # Cuando el juez vuelve, la misma petición se atiende y se cierra.
    decidida = {"hecho": False}

    async def juez_vuelve(ctx, h2, texto, pista):
        decidida["hecho"] = True

    monkeypatch.setattr(CO.PASOS, "_revisar_hipotesis", juez_vuelve)
    asyncio.run(sup._atender_peticiones())
    assert decidida["hecho"], "la petición conservada tuvo que atenderse al volver el juez"


def test_control_un_fallo_corriente_de_la_revision_pedida_si_cuenta_intento(monkeypatch):
    """Control: el comportamiento de antes para un fallo que no es una caída
    del modelo (S-08) sigue igual: cuenta el intento y la petición sigue viva
    hasta MAX_INTENTOS_KILLER."""
    al, ids = _preparar()
    _pedir_revision_con_la_corrida_terminada(al, ids)
    sup, _, _ = _supervisor(al, ids, {}, monkeypatch)

    async def revienta(*a, **k):
        raise RuntimeError("el Killer se rompió")

    monkeypatch.setattr(CO.PASOS, "_revisar_hipotesis", revienta)
    asyncio.run(sup._atender_peticiones())
    h = _hip(al, ids)
    assert h.get("_revisionPedida") is True and h.get("_killerIntentos") == 1
    assert _pistas(al, ids)[0]["resumen"].startswith("La revisión falló")


# ---------------------------------------------------------------------------
# Replicación con el juez de réplica caído
# ---------------------------------------------------------------------------


def _con_replicacion_en_curso(al, ids) -> None:
    def fn(e: dict[str, Any]) -> bool:
        h = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])
        h["replicacion"] = {"estado": "en_curso", "hechas": 0, "total": 3, "sostienen": 0, "contradicen": 0, "noComprobables": 0}
        return True

    al.mutar(fn, "replicar")


def _una_copia_comprobable(*a, **k):
    copia = {"id": "a1", "texto": "GFAP sube antes que NfL", "cita": "[Kim, 2025, pág. 3]", "fuenteId": "kim", "localizador": "pág. 3", "veredicto": "sin_verificar", "motivo": ""}
    return [copia], [copia], [], {"resuelven": 1, "guardadas": 0, "noComprobables": 0}


def test_una_trayectoria_de_replicacion_con_el_juez_caido_no_se_consume(monkeypatch):
    al, ids = _preparar()
    _con_replicacion_en_curso(al, ids)
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    monkeypatch.setattr(CO, "_preparar_copias_replica", _una_copia_comprobable)

    async def juez_caido(*a, **k):
        raise _sin_respuesta("replica")

    monkeypatch.setattr(CO.PASOS, "verificar_afirmaciones", juez_caido)
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(sup._replicar_paso(ctx, _hip(al, ids)))
    r = _hip(al, ids)["replicacion"]
    assert r["hechas"] == 0 and r["noComprobables"] == 0 and "trayectorias" not in r, f"la trayectoria se gastó sin juzgar nada: {r}"
    assert r["estado"] == "en_curso"


def test_control_un_fallo_corriente_de_la_replica_si_consume_la_trayectoria(monkeypatch):
    al, ids = _preparar()
    _con_replicacion_en_curso(al, ids)
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    monkeypatch.setattr(CO, "_preparar_copias_replica", _una_copia_comprobable)

    async def revienta(*a, **k):
        raise RuntimeError("otro fallo")

    monkeypatch.setattr(CO.PASOS, "verificar_afirmaciones", revienta)
    asyncio.run(sup._replicar_paso(ctx, _hip(al, ids)))
    r = _hip(al, ids)["replicacion"]
    assert r["hechas"] == 1 and r["noComprobables"] == 1


# ---------------------------------------------------------------------------
# Terminar la corrida resuelve las incidencias que ROSA2018 abre sola
# ---------------------------------------------------------------------------


def _incidencia(corrida_id: str, tipo: str, id_: str) -> dict[str, Any]:
    return {"id": id_, "corridaId": corrida_id, "tipo": tipo, "titulo": "t", "detalle": "", "recurso": "anthropic/claude-opus-5", "alternativa": None, "estado": "pendiente", "creadaEn": 1, "resueltaEn": None, "resolucion": None}


def test_terminar_la_corrida_resuelve_sus_incidencias_de_modelo_y_solo_esas():
    al, ids = _preparar()

    def fn(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["esperandoModelo"] = {"rol": "juez", "modelo": "anthropic/claude-opus-5", "desde": 1, "ultimoSondeo": None, "proximoSondeo": None, "pasoId": None, "intentos": 2}
        e["incidencias"].extend([_incidencia(ids["cor"], "modelo_sin_respuesta", "inc-modelo"), _incidencia(ids["cor"], "fuente_sin_respuesta", "inc-fuente"), _incidencia("otra-corrida", "modelo_sin_respuesta", "inc-ajena")])
        return True

    al.mutar(fn, "preparar")
    assert al.mutar(lambda e: CO._terminar_corrida(e, ids["cor"], "Tope de iteraciones"), "terminar") is not False
    c = _corrida(al, ids)
    assert c["estado"] == "terminada" and c["esperandoModelo"] is None
    por_id = {i["id"]: i for i in al.estado["incidencias"]}
    assert por_id["inc-modelo"]["estado"] == "resuelta" and por_id["inc-modelo"]["resolucion"] == CO.RESOLUCION_CERRADA_SIN_MODELO and por_id["inc-modelo"]["resueltaEn"]
    assert por_id["inc-fuente"]["estado"] == "pendiente", "una incidencia que sí necesita a una persona no se cierra sola"
    assert por_id["inc-ajena"]["estado"] == "pendiente", "la incidencia de otra corrida no se toca"


def test_el_cierre_de_iteracion_que_termina_la_corrida_usa_la_misma_regla():
    fuente = inspect.getsource(CO.Supervisor._cerrar_iteracion)
    # La guarda lleva desde el 28 de septiembre de 2026 la comprobación del
    # estado: una corrida que una persona detuvo no pasa a "terminada" por la
    # condición de parada, que borraba el motivo escrito por esa persona.
    assert "if terminar and c2[\"estado\"] not in (\"detenida\", \"terminada\"):" in fuente
    bloque = fuente.split("if terminar and", 1)[1]
    assert "_resolver_incidencias_de_modelo_al_cerrar(e2, c2[\"id\"], ahora)" in bloque.split("return True", 1)[0]
    e = {"corridas": [], "incidencias": [_incidencia("c1", "modelo_sin_respuesta", "a"), _incidencia("c1", "modelo_sin_respuesta", "b"), _incidencia("c2", "modelo_sin_respuesta", "c")]}
    assert CO._resolver_incidencias_de_modelo_al_cerrar(e, "c1", 5) == 2
    assert CO._resolver_incidencias_de_modelo_al_cerrar(e, "c1", 6) == 0, "la segunda pasada no cambia nada"
    assert CO._resolver_incidencias_de_modelo_al_cerrar({"corridas": []}, "c1", 7) == 0, "un estado antiguo sin incidencias no rompe"


# ---------------------------------------------------------------------------
# analisis.py y evidencia.py relanzan la excepción del vigilante
# ---------------------------------------------------------------------------

_BLOQUE_PRESUPUESTO = re.compile(r"except PresupuestoAgotado:\n\s*raise[^\n]*\n(\s*)except ([\w.]+)")


@pytest.mark.parametrize("modulo, esperado, minimo", [(AN, "VIG.ModeloSinRespuesta", 4), (EV, "ModeloSinRespuesta", 2)])
def test_cada_except_de_presupuesto_alrededor_de_ctx_llamar_va_seguido_de_modelo_sin_respuesta(modulo, esperado, minimo):
    """Guardia sobre el código: en los dos módulos, cada `except PresupuestoAgotado:
    raise` (que envuelve una llamada al modelo) va seguido de `except
    ModeloSinRespuesta: raise`. Sin él, la caída del cerebro o del juez se
    tragaba como "no se pudo reparar/interpretar" y el paso seguía con huecos."""
    fuente = Path(modulo.__file__).read_text(encoding="utf-8")
    bloques = _BLOQUE_PRESUPUESTO.findall(fuente)
    assert len(bloques) >= minimo, f"{modulo.__name__}: se esperaban al menos {minimo} bloques, hay {len(bloques)}"
    siguientes = [siguiente for _, siguiente in bloques]
    assert all(s == esperado for s in siguientes), f"{modulo.__name__}: un except de presupuesto no va seguido de {esperado}: {siguientes}"


def test_evidencia_y_analisis_importan_la_excepcion_del_vigilante():
    assert EV.ModeloSinRespuesta is VIG.ModeloSinRespuesta
    assert AN.VIG is VIG
