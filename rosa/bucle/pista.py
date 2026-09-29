"""Una pista: la transcripción en vivo de una tarea del bucle.

Cada pista pertenece a un paso del plan y escribe líneas (acción, resultado,
nota, error) que la pantalla de corrida muestra al momento. Al cerrar, deja
un resumen de una línea y los milisegundos que tardo. Todo pasa por el
almacen para que cada línea llegue por SSE.
"""

from __future__ import annotations

import time
from typing import Any

from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen


class Pista:
    def __init__(self, almacen: Almacen, iteracion_id: str, paso_id: str | None, tipo: str, titulo: str, fuente: str):
        self.almacen = almacen
        self.iteracion_id = iteracion_id
        self.id = P.nuevo_id("pi")
        self._t0 = time.monotonic()
        pista = P.nueva_pista(iteracion_id, paso_id, tipo, titulo, fuente)
        pista["id"] = self.id

        def crear(e: dict[str, Any]) -> bool:
            for it in e["iteraciones"]:
                if it["id"] == iteracion_id:
                    it["pistas"].append(pista)
                    return True
            return False

        almacen.mutar(crear, "pista_nueva")

    def _ms(self) -> int:
        return int((time.monotonic() - self._t0) * 1000)

    def _editar(self, fn) -> None:
        def cambiar(e: dict[str, Any]) -> bool:
            for it in e["iteraciones"]:
                if it["id"] == self.iteracion_id:
                    for p in it["pistas"]:
                        if p["id"] == self.id:
                            fn(p)
                            return True
            return False

        self.almacen.mutar(cambiar, "pista")

    @property
    def abierta(self) -> bool:
        """La pista sigue en marcha: nadie la cerró ni la hizo fallar. Quien
        abre una pista y llama a algo que PUEDE cerrarla la comprueba antes de
        cerrarla otra vez, para no pisar el resumen que ya escribió."""
        for it in self.almacen.estado["iteraciones"]:
            if it["id"] == self.iteracion_id:
                for p in it["pistas"]:
                    if p["id"] == self.id:
                        return bool(p["estado"] == "en_curso")
        return False

    def detenida(self) -> bool:
        for it in self.almacen.estado["iteraciones"]:
            if it["id"] == self.iteracion_id:
                for p in it["pistas"]:
                    if p["id"] == self.id:
                        return p["estado"] == "detenida"
        return False

    # Cada mutacion reescribe el estado entero en disco: las lineas de traza se
    # agrupan (hasta LOTE lineas o ESPERA_S segundos) y se persisten juntas.
    LOTE = 8
    ESPERA_S = 1.5

    def linea(self, tipo: str, texto: str, consulta: dict[str, str] | None = None) -> None:
        entrada: dict[str, Any] = {"t": self._ms(), "tipo": tipo, "texto": texto}
        if consulta:
            entrada["consulta"] = consulta
        buffer = self.__dict__.setdefault("_buffer", [])
        buffer.append(entrada)
        ultimo = self.__dict__.setdefault("_ultimo_volcado", time.monotonic())
        if len(buffer) >= self.LOTE or time.monotonic() - ultimo >= self.ESPERA_S or tipo == "error":
            self.volcar()

    def volcar(self) -> None:
        """Persiste las líneas pendientes en una sola mutación."""
        pendientes = list(self.__dict__.get("_buffer", []))
        if not pendientes:
            return
        self._buffer = []
        self._ultimo_volcado = time.monotonic()

        def fn(p: dict[str, Any]) -> None:
            if p["estado"] != "en_curso":
                return
            p["transcripcion"].extend(pendientes)
            p["resumen"] = pendientes[-1]["texto"][:140]
            p["ms"] = pendientes[-1]["t"]

        self._editar(fn)

    def accion(self, texto: str, consulta: dict[str, str] | None = None) -> None:
        self.linea("accion", texto, consulta)

    def resultado(self, texto: str) -> None:
        self.linea("resultado", texto)

    def nota(self, texto: str) -> None:
        self.linea("nota", texto)

    def error(self, texto: str) -> None:
        self.linea("error", texto)

    def cerrar(self, resumen: str, estado: str = "hecha") -> None:
        self.volcar()
        ms = self._ms()

        def fn(p: dict[str, Any]) -> None:
            if p["estado"] == "detenida":
                return
            p["estado"] = estado
            p["resumen"] = resumen[:200]
            p["ms"] = ms

        self._editar(fn)

    def fallar(self, motivo: str) -> None:
        self.error(motivo)
        self.cerrar(motivo, "fallida")
