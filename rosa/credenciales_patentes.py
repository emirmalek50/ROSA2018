"""Credencial local de SerpApi, separada del estado público y de sus exportaciones."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any

from rosa import config


def ruta(base: Path | str | None = None) -> Path:
    bd = Path(base) if base is not None else config.RUTA_BD
    return bd.parent / "datos" / "_credenciales_patentes" / (bd.name + ".json")


def _leer(base: Path | str | None = None) -> dict[str, Any]:
    archivo = ruta(base)
    if not archivo.exists():
        return {}
    try:
        valor = json.loads(archivo.read_text(encoding="utf-8"))
        if not isinstance(valor, dict) or set(valor) - {"clave", "desactivada"}:
            raise ValueError("Formato inválido")
        desactivada = valor.get("desactivada", False)
        guardada = valor.get("clave")
        if not isinstance(desactivada, bool):
            raise ValueError("Formato inválido")
        if desactivada:
            if guardada is not None:
                raise ValueError("Formato inválido")
        elif not isinstance(guardada, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", guardada):
            raise ValueError("Formato inválido")
        return valor
    except (OSError, ValueError):
        # Un fichero roto no habilita inadvertidamente la credencial del entorno.
        return {"desactivada": True, "error": "No pude leer la configuración local de SerpApi."}


def clave(base: Path | str | None = None) -> str:
    valor = _leer(base)
    if valor.get("desactivada"):
        return ""
    guardada = valor.get("clave")
    return guardada if isinstance(guardada, str) and guardada else config.CLAVE_SERPAPI.strip()


def estado(base: Path | str | None = None) -> dict[str, Any]:
    valor = _leer(base)
    disponible = bool(clave(base))
    return {"proveedor": "serpapi", "configurada": disponible,
            "origen": ("archivo" if valor.get("clave") else "entorno") if disponible else None,
            **({"error": valor["error"]} if valor.get("error") else {})}


def guardar(cambios: Any, base: Path | str | None = None) -> dict[str, Any]:
    if not isinstance(cambios, dict) or set(cambios) - {"clave", "borrarClave"}:
        raise ValueError("Configuración de SerpApi inválida.")
    borrar = cambios.get("borrarClave", False)
    if not isinstance(borrar, bool) or (borrar and "clave" in cambios):
        raise ValueError("Indica una clave o desconecta el proveedor, sin combinar ambas acciones.")
    nueva = cambios.get("clave")
    if not borrar and (not isinstance(nueva, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", nueva.strip())):
        raise ValueError("Introduce una clave válida de SerpApi, sin espacios ni caracteres de control.")
    datos = {"desactivada": True} if borrar else {"clave": str(nueva).strip(), "desactivada": False}
    archivo = ruta(base)
    archivo.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    archivo.parent.chmod(0o700)
    fd, temporal = tempfile.mkstemp(prefix=".patentes-", dir=archivo.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(datos, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporal, archivo)
    finally:
        if os.path.exists(temporal):
            os.unlink(temporal)
    return estado(base)
