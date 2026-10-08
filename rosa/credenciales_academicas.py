"""Accesos institucionales privados; una clave configurada no acredita licencia."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from threading import RLock
from typing import Any

from rosa import config

CAMPOS = {
    "elsevier_api_key": ("Clave API de Elsevier", "ROSA_ELSEVIER_API_KEY", "ELSEVIER_API_KEY"),
    "elsevier_insttoken": ("Token institucional de Elsevier", "ROSA_ELSEVIER_INSTTOKEN", "ELSEVIER_INSTTOKEN"),
    "wos_api_key": ("Clave API de Web of Science", "ROSA_WOS_API_KEY", "WOS_API_KEY"),
    "ebsco_user": ("Usuario de la API de EBSCO", "ROSA_EBSCO_USER", "EBSCO_USER"),
    "ebsco_password": ("Contraseña de la API de EBSCO", "ROSA_EBSCO_PASSWORD", "EBSCO_PASSWORD"),
    "ebsco_profile": ("Perfil de EBSCO", "ROSA_EBSCO_PROFILE", "EBSCO_PROFILE"),
    "cinahl_db": ("Identificador de la base CINAHL", "ROSA_CINAHL_DB", "CINAHL_DB"),
    "psycinfo_db": ("Identificador de la base PsycINFO", "ROSA_PSYCINFO_DB", "PSYCINFO_DB"),
}
PROVEEDORES = {
    "elsevier": {"nombre": "Embase y Scopus", "campos": ["elsevier_api_key", "elsevier_insttoken"], "requeridos": ["elsevier_api_key"]},
    "wos": {"nombre": "Web of Science", "campos": ["wos_api_key"], "requeridos": ["wos_api_key"]},
    "ebsco": {"nombre": "CINAHL y PsycINFO", "campos": ["ebsco_user", "ebsco_password", "ebsco_profile", "cinahl_db", "psycinfo_db"], "requeridos": ["ebsco_user", "ebsco_password", "ebsco_profile"]},
}
_CANDADO = RLock()


def ruta(base: Path | str | None = None) -> Path:
    bd = Path(base) if base is not None else config.RUTA_BD
    return bd.parent / "datos" / "_credenciales_academicas" / (bd.name + ".json")


def _valido(campo: str, valor: Any) -> bool:
    if not isinstance(valor, str) or len(valor) > 2048 or re.search(r"[\x00-\x1f\x7f]", valor):
        return False
    if valor and campo in {"cinahl_db", "psycinfo_db", "ebsco_profile"}:
        return bool(re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", valor))
    return True


def _archivo(base: Path | str | None = None) -> tuple[dict[str, str], bool]:
    try:
        valor = json.loads(ruta(base).read_text(encoding="utf-8"))
        if not isinstance(valor, dict) or set(valor) - CAMPOS.keys() or any(not _valido(k, v) for k, v in valor.items()):
            raise ValueError("Formato inválido")
        return valor, False
    except FileNotFoundError:
        return {}, False
    except (OSError, ValueError):
        # No activar otra credencial por accidente si el archivo local está roto.
        return {}, True


def leer(base: Path | str | None = None) -> dict[str, str]:
    with _CANDADO:
        archivo, roto = _archivo(base)
        if roto:
            return {campo: "" for campo in CAMPOS}
        salida = {}
        for campo, (_, *nombres) in CAMPOS.items():
            valor = archivo.get(campo, next((os.environ[n] for n in nombres if os.environ.get(n)), ""))
            salida[campo] = valor if _valido(campo, valor) else ""
        return salida


def estado(base: Path | str | None = None) -> dict[str, Any]:
    with _CANDADO:
        valores = leer(base)
        archivo, roto = _archivo(base)
        return {
            "campos": [{"id": campo, "nombre": v[0], "configurado": bool(valores[campo]),
                        "origen": ("archivo" if campo in archivo else "entorno") if valores[campo] else None} for campo, v in CAMPOS.items()],
            "proveedores": [{"id": p, **v, "configurado": all(valores[k] for k in v["requeridos"]), "accesoVerificado": False} for p, v in PROVEEDORES.items()],
            "error": "No pude leer la configuración local. Vuelve a guardar los accesos." if roto else None,
        }


def guardar(cambios: Any, base: Path | str | None = None) -> dict[str, Any]:
    if not isinstance(cambios, dict) or set(cambios) - {"valores", "eliminar"}:
        raise ValueError("Configuración de fuentes académicas inválida.")
    valores, eliminar = cambios.get("valores", {}), cambios.get("eliminar", [])
    if (not isinstance(valores, dict) or set(valores) - CAMPOS.keys() or not isinstance(eliminar, list)
            or any(not isinstance(k, str) or k not in CAMPOS for k in eliminar)
            or set(valores).intersection(eliminar) or not (valores or eliminar)
            or any(not _valido(k, v) or not v for k, v in valores.items())):
        raise ValueError("Revisa los campos de acceso; no se guardó ningún cambio.")
    with _CANDADO:
        anteriores, _ = _archivo(base)
        anteriores.update(valores)
        anteriores.update({campo: "" for campo in eliminar})
        destino = ruta(base)
        destino.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destino.parent.chmod(0o700)
        fd, temporal = tempfile.mkstemp(prefix=".academicas-", dir=destino.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(anteriores, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporal, destino)
        finally:
            if os.path.exists(temporal):
                os.unlink(temporal)
        return estado(base)
