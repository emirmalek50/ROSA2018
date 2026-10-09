"""Causas de HTTP tipadas, sin red ni esperas posteriores al último intento."""

import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from rosa.fuentes import base as B


def test_excepcion_conserva_construccion_y_args_anteriores():
    ex = B.FuenteNoDisponible("Mensaje existente")
    assert str(ex) == "Mensaje existente" and ex.args == ("Mensaje existente",)
    assert ex.causa == "desconocida" and ex.status_http is None
    assert isinstance(B.NoEncontrado("404"), B.FuenteNoDisponible)


@pytest.mark.parametrize("fallo,causa,status", [
    (httpx.ReadTimeout("simulado"), "timeout", None),
    (httpx.ConnectTimeout("simulado"), "timeout", None),
    (httpx.ConnectError("simulado"), "red", None),
    (httpx.RemoteProtocolError("simulado"), "red", None),
    (401, "http", 401), (403, "http", 403), (404, "http", 404),
    (429, "http", 429), (502, "http", 502), (503, "http", 503), (504, "http", 504),
])
def test_preserva_causa_http_sin_esperar_tras_el_ultimo_intento(monkeypatch, fallo, causa, status):
    peticiones = []
    dormir = AsyncMock()
    monkeypatch.setattr(B.asyncio, "sleep", dormir)
    limitador = B.Limitador(3)
    monkeypatch.setattr(limitador, "esperar", AsyncMock())

    def responder(request):
        peticiones.append(request)
        if isinstance(fallo, Exception):
            raise fallo
        return httpx.Response(fallo, headers={"retry-after": "60"})

    async def ejecutar():
        async with httpx.AsyncClient(transport=httpx.MockTransport(responder)) as cliente:
            monkeypatch.setattr(B, "cliente", lambda: cliente)
            with pytest.raises(B.FuenteNoDisponible) as capturada:
                await B.pedir("GET", "https://example.org/consulta", limitador, intentos=1)
            return capturada.value

    ex = asyncio.run(ejecutar())
    assert ex.causa == causa and ex.status_http == status
    assert len(peticiones) == 1 and dormir.await_count == 0
    assert isinstance(ex, B.NoEncontrado) is (status == 404)


def test_json_invalido_conserva_status_y_causa_formato():
    respuesta = httpx.Response(200, text="<html>fuente inaccesible</html>", request=httpx.Request("GET", "https://example.org"))
    with pytest.raises(B.FuenteNoDisponible) as capturada:
        B.json_de(respuesta)
    assert capturada.value.causa == "formato" and capturada.value.status_http == 200
