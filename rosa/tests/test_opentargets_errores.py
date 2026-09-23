"""Open Targets devuelve los errores de GraphQL con HTTP 200: eso tiene que
salir como `FuenteNoDisponible` ("no pude comprobar"), no como un NameError.
Hasta el 23 de septiembre de 2026 la excepción se usaba sin importarla (lo
encontró ruff, F821)."""
import pytest

from rosa.fuentes.base import FuenteNoDisponible
from rosa.fuentes.opentargets import _sin_errores


def test_errores_graphql_son_fuente_no_disponible() -> None:
    with pytest.raises(FuenteNoDisponible, match="Open Targets"):
        _sin_errores({"data": None, "errors": [{"message": "Syntax Error"}]})


def test_respuesta_sin_forma_de_objeto() -> None:
    with pytest.raises(FuenteNoDisponible):
        _sin_errores(["no", "es", "un", "objeto"])


def test_respuesta_limpia_pasa() -> None:
    cuerpo = {"data": {"search": {"hits": []}}}
    assert _sin_errores(cuerpo) is cuerpo
