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
from rosa.bucle.eventos_laboratorio import validar as validar_evento_lab


class Pista:
    def __init__(self, almacen: Almacen, iteracion_id: str, paso_id: str | None, tipo: str, titulo: str, fuente: str, *, hipotesis_id: str | None = None):
        self.almacen = almacen
        self.iteracion_id = iteracion_id
        self.id = P.nuevo_id("pi")
        self._t0 = time.monotonic()
        pista = P.nueva_pista(iteracion_id, paso_id, tipo, titulo, fuente)
        pista["id"] = self.id
        if hipotesis_id is not None:
            pista["hipotesisId"] = hipotesis_id

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

    def linea(self, tipo: str, texto: str, consulta: dict[str, str] | None = None, *, agente: str | None = None, estado_agente: str | None = None, evento_lab: dict[str, Any] | None = None) -> None:
        entrada: dict[str, Any] = {"t": self._ms(), "tipo": tipo, "texto": texto}
        if evento_lab is not None:
            entrada["eventoLab"] = validar_evento_lab(evento_lab)
        if agente:
            entrada["agente"] = agente
            entrada["estadoAgente"] = estado_agente
        if consulta:
            entrada["consulta"] = consulta
        buffer = self.__dict__.setdefault("_buffer", [])
        buffer.append(entrada)
        # El primer registro debe llegar antes de esperar una llamada larga.
        # ESPERA_S se comprueba al recibir otra línea; no hay un temporizador
        # que publique por sí solo el búfer mientras el modelo responde.
        primera = "_ultimo_volcado" not in self.__dict__
        ultimo = self.__dict__.setdefault("_ultimo_volcado", time.monotonic())
        if primera or len(buffer) >= self.LOTE or time.monotonic() - ultimo >= self.ESPERA_S or tipo == "error":
            self.volcar()

    def linea_lab(self, tipo: str, texto: str, evento: dict[str, Any]) -> None:
        """Un evento real con su texto habitual, publicado antes de una tarea larga."""
        if tipo not in {"accion", "resultado", "nota", "error"}:
            raise ValueError("Tipo de entrada del laboratorio no admitido")
        self.linea(tipo, texto, evento_lab=evento)
        if tipo == "accion":
            self.volcar()

    def volcar(self) -> None:
        """Persiste las líneas pendientes en una sola mutación."""
        pendientes = list(self.__dict__.get("_buffer", []))
        if not pendientes:
            return
        self._buffer: list[dict[str, Any]] = []
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

    def actividad(self, agente: str, texto: str, estado: str) -> None:
        """Actividad atribuida a una función real, visible también en el laboratorio.

        Se persiste antes de esperar una llamada larga para que SSE pueda mostrar
        los miembros que están trabajando en paralelo, incluso sin resultados.
        """
        if estado not in {"en_curso", "terminado", "fallido"}:
            raise ValueError("Estado de actividad no admitido")
        self.linea("accion" if estado == "en_curso" else "error" if estado == "fallido" else "resultado", texto, agente=agente, estado_agente=estado)
        self.volcar()

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
