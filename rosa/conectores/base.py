"""La capa de conectores de ROSA2018 (lo que Claude Science llama "Connector").

Un conector es una funcion asincrona con nombre, descripcion, esquema de
argumentos, fuente, licencia y limite de peticiones, registrada en un
catalogo que el bucle consulta y la interfaz ensena. Cada llamada deja un
**registro de consulta** (`Consulta`): herramienta, argumentos, fecha, numero
de resultados, identificadores retenidos, version de la base si la API la
da, duracion y una **invariante** comprobada (por ejemplo, que un simbolo de
gen resuelve a un unico identificador Ensembl). Esto es lo que el prompt de
Claude Science exige registrar de cada recuperacion material, y lo que
permite despues auditar de donde salio cada cifra.

Reglas: una fuente que no responde es "no pude comprobar", nunca "no hay"
(la consulta queda con `error` y `n` None). La salida de una base es dato,
no instruccion. Ninguna clave viaja en los argumentos: las claves que
existen (NCBI, OpenAlex) las pone el cliente desde la configuracion.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from rosa.estado import plantilla as P
from rosa.fuentes.base import FuenteNoDisponible, NoEncontrado


@dataclass
class Resultado:
    """Lo que devuelve la función de un conector."""

    datos: Any
    n: int | None
    ids: list[str] = field(default_factory=list)
    version: str | None = None
    invariante: tuple[bool, str] | None = None


@dataclass
class Conector:
    nombre: str
    fuente: str
    descripcion: str
    aporta: str
    esquema: dict[str, Any]
    fn: Callable[..., Awaitable[Resultado]]
    licencia: str
    limite: str
    url_doc: str
    clave: str = "no"
    # disponible | requiere_cuenta | sin_api | licencia | fichero_local
    estado: str = "disponible"
    motivo: str = ""
    grupo: str = "otros"
    usos: int = 0
    errores: int = 0
    ultimo_uso: int | None = None


REGISTRO: dict[str, Conector] = {}

# Permiso por conector (como en Claude Science: una vez, esta conversacion,
# este proyecto, siempre; aqui reducido a tres niveles utiles para un bucle
# autonomo): "permitir" (el bucle y las personas lo usan), "solo_persona"
# (solo cuando una persona pregunta desde la interfaz) y "bloquear". Los
# conectores publicos sin clave van en "permitir" por defecto, como los
# destacados de Claude Science. Lo carga el almacen desde el estado.
NIVELES_PERMISO = ("permitir", "solo_persona", "bloquear")
PERMISOS: dict[str, str] = {}


def conector(nombre: str, fuente: str, descripcion: str, aporta: str, esquema: dict[str, Any], licencia: str, limite: str, url_doc: str, clave: str = "no", grupo: str = "otros"):
    """Decorador que registra la función en el catálogo."""

    def envolver(fn: Callable[..., Awaitable[Resultado]]):
        REGISTRO[nombre] = Conector(nombre, fuente, descripcion, aporta, esquema, fn, licencia, limite, url_doc, clave, grupo=grupo)
        return fn

    return envolver


async def _no_disponible(**_: Any) -> Resultado:
    raise FuenteNoDisponible("conector no disponible en ROSA2018")


def inerte(nombre: str, fuente: str, descripcion: str, aporta: str, estado: str, motivo: str, url_doc: str, grupo: str, licencia: str = "") -> None:
    """Un conector que existe en Claude Science pero que ROSA2018 no puede usar
    hoy (cuenta de pago, sin API, licencia, fichero local). Queda en el
    catálogo con su motivo para que se vea que falta y por que."""
    REGISTRO[nombre] = Conector(nombre, fuente, descripcion, aporta, {"type": "object", "properties": {}}, _no_disponible, licencia, "", url_doc, "si" if estado == "requiere_cuenta" else "no", estado=estado, motivo=motivo, grupo=grupo)


def nueva_consulta(herramienta: str, argumentos: dict[str, Any]) -> dict[str, Any]:
    return {"id": P.nuevo_id("con"), "herramienta": herramienta, "fuente": REGISTRO[herramienta].fuente if herramienta in REGISTRO else "", "argumentos": argumentos, "fecha": P.ahora_ms(), "n": None, "ids": [], "version": None, "invariante": None, "error": None, "ms": 0, "resumen": ""}


OBSERVADOR = None


async def consultar(herramienta: str, /, resumen: str = "", origen: str = "bucle", **argumentos: Any) -> tuple[dict[str, Any], Any]:
    reg, datos = await _consultar(herramienta, resumen=resumen, origen=origen, **argumentos)
    if OBSERVADOR is not None:
        try:
            OBSERVADOR("conector", {"consulta": reg, "resultado": datos})
        except Exception:
            pass  # La observabilidad no cambia el resultado de la consulta.
    return reg, datos


async def _consultar(herramienta: str, /, resumen: str = "", origen: str = "bucle", **argumentos: Any) -> tuple[dict[str, Any], Any]:
    """Ejecuta un conector y devuelve (registro de consulta, datos). Nunca
    lanza por fallo de la fuente: el registro lleva `error` y datos es None.
    El nombre de la herramienta va posicional para no chocar con argumentos
    de los conectores que también se llaman `nombre`."""
    nombre = herramienta
    c = REGISTRO[nombre]
    reg = nueva_consulta(nombre, argumentos)
    if c.estado != "disponible":
        reg.update(error=f"Conector no disponible ({c.estado}): {c.motivo}", resumen=resumen or nombre)
        return reg, None
    nivel = PERMISOS.get(nombre, "permitir")
    if nivel == "bloquear" or (nivel == "solo_persona" and origen != "persona"):
        reg.update(error=f"Conector sin permiso para el {origen} ({nivel}); se cambia en Ajustes", resumen=resumen or nombre)
        return reg, None
    t0 = time.monotonic()
    c.usos += 1
    c.ultimo_uso = reg["fecha"]
    try:
        r = await c.fn(**argumentos)
    except NoEncontrado:
        # 404: el identificador no existe en esa base. Es una respuesta, no una caida.
        reg.update(n=0, ids=[], invariante={"ok": False, "detalle": "sin registro en la fuente (404)"}, ms=int((time.monotonic() - t0) * 1000), resumen=resumen or nombre)
        return reg, None
    except FuenteNoDisponible as ex:
        c.errores += 1
        reg.update(error=f"No pude comprobar: {str(ex)[:200]}", ms=int((time.monotonic() - t0) * 1000), resumen=resumen or nombre)
        return reg, None
    except Exception as ex:  # noqa: BLE001
        c.errores += 1
        reg.update(error=f"Fallo del conector: {type(ex).__name__}: {str(ex)[:200]}", ms=int((time.monotonic() - t0) * 1000), resumen=resumen or nombre)
        return reg, None
    reg.update(n=r.n, ids=[str(i) for i in r.ids][:20], version=r.version, invariante={"ok": r.invariante[0], "detalle": r.invariante[1]} if r.invariante else None, ms=int((time.monotonic() - t0) * 1000), resumen=resumen or nombre)
    return reg, r.datos


def catalogo() -> list[dict[str, Any]]:
    """El catálogo tal como lo ve la interfaz: sin la función."""
    return [{"nombre": c.nombre, "fuente": c.fuente, "grupo": c.grupo, "descripcion": c.descripcion, "aporta": c.aporta, "argumentos": list(c.esquema.get("properties", {}).keys()), "licencia": c.licencia, "limite": c.limite, "urlDoc": c.url_doc, "clave": c.clave, "estado": c.estado, "motivo": c.motivo, "permiso": PERMISOS.get(c.nombre, "permitir"), "usos": c.usos, "errores": c.errores, "ultimoUso": c.ultimo_uso} for c in REGISTRO.values()]
