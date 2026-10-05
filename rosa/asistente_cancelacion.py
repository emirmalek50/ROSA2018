"""Cancelación de respuestas, acotada a su autor y conversación.

El registro vive en el bucle de eventos de cada servidor. Conserva brevemente
las solicitudes terminadas y las cancelaciones que llegan antes que la pregunta.
Detener una respuesta no cancela las investigaciones iniciadas previamente.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException


@dataclass
class Solicitud:
    autor: str
    investigacion: str
    hilo: str = ""
    tarea: asyncio.Task[dict[str, Any]] | None = None
    reclamada: bool = False
    cancelada: bool = False
    terminada: bool = False
    tocada: float = field(default_factory=time.monotonic)


class Respuestas:
    def __init__(self) -> None:
        self.solicitudes: dict[str, Solicitud] = {}

    def _obtener(self, seguimiento: str, autor: str, investigacion: str) -> Solicitud:
        ahora = time.monotonic()
        for clave, anterior in list(self.solicitudes.items()):
            if (anterior.terminada or not anterior.reclamada) and ahora - anterior.tocada > 900:
                del self.solicitudes[clave]
        s = self.solicitudes.get(seguimiento)
        if s is not None:
            if (s.autor, s.investigacion) != (autor, investigacion):
                raise HTTPException(404, "No se encontró esa respuesta en tu conversación")
            return s
        if len(self.solicitudes) >= 512:
            caducables = [k for k, v in self.solicitudes.items() if v.terminada or not v.reclamada]
            if not caducables:
                raise HTTPException(429, "Hay demasiadas respuestas en curso")
            del self.solicitudes[min(caducables, key=lambda k: self.solicitudes[k].tocada)]
        s = Solicitud(autor, investigacion)
        self.solicitudes[seguimiento] = s
        return s

    def abrir(self, seguimiento: str, autor: str, investigacion: str, hilo: str = "") -> Solicitud:
        s = self._obtener(seguimiento, autor, investigacion)
        if s.reclamada:
            raise HTTPException(409, "Ese identificador de respuesta ya se utilizó")
        s.reclamada = True
        s.hilo = hilo
        return s

    def cancelar(self, seguimiento: str, autor: str, investigacion: str) -> dict[str, Any]:
        s = self._obtener(seguimiento, autor, investigacion)
        if s.terminada or (s.tarea is not None and s.tarea.done()):
            return {"ok": True, "estado": "cancelada" if s.cancelada else "terminada"}
        # Repetir la petición no interrumpe por segunda vez los finally de las herramientas.
        if not s.cancelada:
            s.cancelada = True
            s.tocada = time.monotonic()
            if s.tarea is not None:
                s.tarea.cancel()
        return {"ok": True, "estado": "cancelando"}

    def terminar(self, s: Solicitud) -> None:
        s.terminada = True
        s.tocada = time.monotonic()
        s.tarea = None

    def cancelar_hilo(self, investigacion: str, hilo: str) -> None:
        """Tras borrar el hilo, detiene sus respuestas, incluidas las de otras pestañas."""
        for seguimiento, s in list(self.solicitudes.items()):
            if s.reclamada and not s.terminada and (s.investigacion, s.hilo) == (investigacion, hilo):
                self.cancelar(seguimiento, s.autor, s.investigacion)

    async def cerrar(self) -> None:
        tareas = [s.tarea for s in self.solicitudes.values() if s.tarea is not None and not s.tarea.done()]
        for tarea in tareas:
            tarea.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)
