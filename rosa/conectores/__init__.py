"""Capa de conectores: catálogo, registro de consultas y los conectores a
bases públicas. Importar el paquete registra todos los conectores."""

from rosa.conectores import bases, bases2, exa, pubtator, web  # noqa: F401  (registran los conectores)
from rosa.conectores.base import REGISTRO, Resultado, catalogo, consultar

__all__ = ["REGISTRO", "Resultado", "catalogo", "consultar"]
