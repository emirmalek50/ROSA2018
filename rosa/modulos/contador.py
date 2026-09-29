"""Contador de llamadas a modelos: cuenta, registra y corta por presupuesto.

Es un `BaseCallback` de DSPy: DSPy lo llama antes y después de cada llamada
al modelo. Antes, comprueba el presupuesto de la corrida y, si esta agotado,
lanza `PresupuestoAgotado` para que la pista pare limpia. Despues, lee
`lm.history[-1]` (donde DSPy deja `usage`) y suma tokens y llamadas al gasto
de la corrida, y registra la llamada en SQLite.

El contexto (que corrida y que iteración estan llamando) va en una variable
de contexto, porque las pistas corren en paralelo.
"""

from __future__ import annotations

import contextvars
import threading
import time
from dataclasses import dataclass
from typing import Any

import dspy
from dspy.utils.callback import BaseCallback

from rosa import config


class PresupuestoAgotado(RuntimeError):
    pass


@dataclass
class ContextoLlamada:
    corrida_id: str
    iteracion: int
    rol: str = ""


contexto_actual: contextvars.ContextVar[ContextoLlamada | None] = contextvars.ContextVar("rosa_contexto_llamada", default=None)


def tope_agotado_en(e: dict[str, Any], corrida_id: str, iteracion: int | None = None) -> str | None:
    """Qué tope cortó, sobre un estado ya cargado: None si hay presupuesto,
    "corrida" si el gasto de la corrida llegó a `limiteLlamadas`, "iteración" si
    la iteración dada gastó su `limite`. La corrida se mira primero porque es
    el tope que la persona amplía; el de la iteración es el que se recorta al
    denegar un permiso. Un límite de iteración de 0 (lo que deja una
    denegación con la iteración recién abierta) también corta: antes se
    trataba como "sin tope" y la denegación no tenía efecto (revisión del
    17 de septiembre de 2026, S-15)."""
    c = next((x for x in e.get("corridas", []) if x["id"] == corrida_id), None)
    if not c:
        return None
    if c["gasto"]["llamadas"] >= c["presupuesto"]["limiteLlamadas"]:
        return "corrida"
    if iteracion is not None:
        it = next((x for x in e.get("iteraciones", []) if x["corridaId"] == corrida_id and x["numero"] == iteracion), None)
        pres = (it or {}).get("presupuesto") or {}
        limite = pres.get("limite")
        if isinstance(limite, (int, float)) and not isinstance(limite, bool) and int(pres.get("usado") or 0) >= limite:
            return "iteracion"
    return None


def tope_agotado(almacen, corrida_id: str, iteracion: int | None = None) -> str | None:
    """`tope_agotado_en` sobre el estado del almacén."""
    return tope_agotado_en(almacen.estado, corrida_id, iteracion)


def presupuesto_ok(almacen, corrida_id: str, iteracion: int | None = None) -> bool:
    """La comprobación que corta de verdad: la llama Ctx.llamar antes de cada
    llamada al modelo. (Lanzar dentro del callback de DSPy no sirve: DSPy
    captura las excepciones de los callbacks y solo escribe un aviso.)
    Comprueba el tope de la corrida y, si se da la iteración, también el suyo:
    el límite que la persona ve (y que puede recortar al denegar un permiso)
    es el que corta, no solo el global. Sigue devolviendo un booleano porque
    `Ctx.llamar` hace `if not presupuesto_ok(...)`; quién necesite saber qué
    tope cortó usa `tope_agotado`."""
    return tope_agotado(almacen, corrida_id, iteracion) is None


def _entrada_de_esta_llamada(candidatos: list[dict[str, Any]], entradas: dict[str, Any] | None) -> dict[str, Any] | None:
    """La entrada del historial de DSPy cuyos `messages` (o `prompt`) coinciden
    con los de la llamada que termina. Se recorre de la más nueva a la más vieja."""
    if not entradas:
        return None
    mensajes = entradas.get("messages")
    prompt = entradas.get("prompt")
    for h in reversed(candidatos):
        if mensajes is not None and h.get("messages") == mensajes:
            return h
        if prompt is not None and h.get("prompt") == prompt:
            return h
    return None


class Contador(BaseCallback):
    def __init__(self, almacen) -> None:
        super().__init__()
        self.almacen = almacen
        self._inicio: dict[str, tuple[float, ContextoLlamada | None, str, dict[str, Any] | None]] = {}
        self._lock = threading.Lock()

    def _presupuesto_ok(self, corrida_id: str) -> bool:
        return presupuesto_ok(self.almacen, corrida_id)

    def on_lm_start(self, call_id: str, instance: Any, inputs: dict[str, Any]) -> None:
        ctx = contexto_actual.get()
        modelo = getattr(instance, "model", "?")
        # El corte real esta en Ctx.llamar (DSPy se traga lo que un callback lance).
        with self._lock:
            self._inicio[call_id] = (time.monotonic(), ctx, modelo, inputs)

    def on_lm_end(self, call_id: str, outputs: Any, exception: Exception | None = None) -> None:
        with self._lock:
            inicio, ctx, modelo, entradas = self._inicio.pop(call_id, (time.monotonic(), contexto_actual.get(), "?", None))
        ms = int((time.monotonic() - inicio) * 1000)
        entrada = salida = 0
        historial = dspy.settings.lm.history if dspy.settings.lm is not None else []
        # Las pistas corren en paralelo: la última entrada del historial global
        # puede ser de otra llamada. Se busca hacia atras la entrada cuyos
        # mensajes (o prompt) son los de esta llamada; solo si no aparece se
        # toma la última por aproximacion.
        try:
            from dspy.clients.base_lm import GLOBAL_HISTORY

            candidatos = list(GLOBAL_HISTORY[-40:]) if GLOBAL_HISTORY else list(historial[-40:])
        except Exception:
            candidatos = list(historial[-40:])
        ultimo = _entrada_de_esta_llamada(candidatos, entradas) or (candidatos[-1] if candidatos else None)
        uso: dict[str, Any] = {}
        if ultimo and exception is None:
            uso = ultimo.get("usage") or {}
            entrada = int(uso.get("prompt_tokens", 0) or 0)
            salida = int(uso.get("completion_tokens", 0) or 0)
            modelo = ultimo.get("model", modelo)
        # S-19: el coste que manda es el que factura el gateway (`usage.cost`); la
        # tabla de precios de config es solo el respaldo cuando no viene. `usd`
        # acumula la mejor cifra disponible de cada llamada; `usdReal` solo lo
        # facturado, y `usdEsEstimado` queda a True si alguna llamada tuvo que
        # estimarse (así la interfaz sabe que las dos cifras no son comparables).
        usd_llamada, es_real = config.coste_desde_uso(uso, str(modelo))

        if exception is not None:
            # Una llamada que falló (tiempo agotado y cancelada por el vigilante,
            # conexión, 5xx, filtro) queda en la tabla `llamadas` con ok=0, el tipo y
            # el mensaje del error y lo que tardó, para poder auditar después qué
            # pasó (la hora perdida de la corrida 13 se reconstruyó desde aquí). No
            # suma tokens ni coste: DSPy no deja `usage` de una llamada fallida, y
            # tampoco cuenta contra el presupuesto de llamadas: cuatro intentos a un
            # modelo caído no son cuatro llamadas de la investigadora. `str(ex)` de
            # una cancelación es vacío, por eso va el tipo delante.
            texto = str(exception).strip().replace("\n", " ")
            error = f"{type(exception).__name__}: {texto}"[:200] if texto else type(exception).__name__[:200]
            self.almacen.registrar_llamada(str(modelo), ctx.rol if ctx else None, ctx.corrida_id if ctx else None, ctx.iteracion if ctx else None, 0, 0, ms, False, error)
            return

        def sumar(e: dict[str, Any]) -> bool:
            if not ctx:
                return False
            c = next((x for x in e["corridas"] if x["id"] == ctx.corrida_id), None)
            if not c:
                return False
            g = c["gasto"]
            g["llamadas"] += 1
            g["tokensEntrada"] += entrada
            g["tokensSalida"] += salida
            g["usd"] = round(g.get("usd", 0.0) + usd_llamada, 4)
            if es_real:
                g["usdReal"] = round(g.get("usdReal", 0.0) + usd_llamada, 4)
            elif entrada or salida:
                g["usdEsEstimado"] = True
            # El uso del contexto es lo que entro en la última llamada (tokens reales de
            # entrada), no una suma acumulada: dice cuanto de la ventana ocupa un prompt.
            if entrada:
                c["contexto"]["tokensUsados"] = min(c["contexto"]["tokensLimite"], entrada)
                c["contexto"]["tokensMaximo"] = max(int(c["contexto"].get("tokensMaximo") or 0), entrada)
            for it in e["iteraciones"]:
                if it["corridaId"] == ctx.corrida_id and it["numero"] == ctx.iteracion:
                    it["presupuesto"]["usado"] = it["presupuesto"]["usado"] + 1
            return True

        self.almacen.mutar(sumar, "llamada_modelo")
        self.almacen.registrar_llamada(str(modelo), ctx.rol if ctx else None, ctx.corrida_id if ctx else None, ctx.iteracion if ctx else None, entrada, salida, ms, exception is None, str(exception)[:300] if exception else None)
