"""Los modelos de ROSA2018, todos por el AI Gateway de Vercel.

Decidido por la persona responsable el 9 y 10 de septiembre de 2026 (TRASPASO.md 2.2 y 2.3):
GPT-6 Astra de cerebro, Claude Opus 5 de juez, Claude Sonnet 5.5 en alto
volumen (actualizado por Emir el 8 de octubre de 2026). Claude Fable 5.1
queda fuera: sus filtros de doble uso en biología devuelven vacío por la API en hipótesis mecanísticas y dianas terapéuticas.

La clave sale del entorno (ROSA_GATEWAY_KEY en .env, ignorado por git) y
nunca del código. El prefijo ``openai/`` es el de LiteLLM para "endpoint
compatible con OpenAI"; el resto es el id del modelo en el gateway.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import dspy
from dotenv import load_dotenv

load_dotenv()

URL_GATEWAY = os.environ.get("ROSA_GATEWAY_URL", "https://ai-gateway.vercel.sh/v1")

CEREBRO = "openai/gpt-6-astra"
JUEZ = "anthropic/claude-opus-5"
VOLUMEN = "anthropic/claude-sonnet-5.5"


class ClaveAusente(RuntimeError):
    pass


def clave() -> str:
    valor = os.environ.get("ROSA_GATEWAY_KEY", "")
    if not valor:
        raise ClaveAusente("Falta ROSA_GATEWAY_KEY en el entorno (.env). Se copia del .env del RAG; nunca al código ni a un chat.")
    return valor


def lm(modelo: str, **kwargs) -> dspy.LM:
    """Un modelo del gateway listo para DSPy. `modelo` es el id del gateway.

    Caché. DSPy guarda cada respuesta en ~/.dspy_cache con la clave del
    request entero; una llamada idéntica (mismo prompt, mismos parámetros) se
    sirve del disco sin gastar. Eso es deliberado para el cerebro, el juez y
    el volumen: los repetidos entre corridas (la misma afirmación juzgada
    contra el mismo pasaje) salen gratis. Hay dos sitios donde NO se quiere la
    misma respuesta y hay que esquivarla (17 de septiembre de 2026, S-20):

    - las trayectorias de replicación (`rol="replica"`): el LM se construye con
      `cache=False`, porque va a temperatura 1,0 y su sentido es dar lecturas
      distintas; con caché, "5 de 5 trayectorias sostienen" era una sola
      llamada real repetida cinco veces;
    - las dos lecturas del examen de GEPA (rosa/gepa_continuo.py): usan el
      juez con `rollout_id` 0 y 1, que entra en la clave de la caché sin
      cambiar el prompt.

    `rollout_id` es la vía general: `Ctx.llamar(rol, programa, rollout_id=n,
    ...)` (rosa/bucle/pasos.py) puede pasarlo y el contexto usa
    `lm.copy(rollout_id=n)`; solo tiene efecto con temperatura distinta de 0
    (DSPy avisa si no)."""
    kwargs.setdefault("timeout", 300)  # segundos por petición HTTP al gateway; sin esto LiteLLM espera 6000
    # El único que reintenta es el vigilante de modelos (rosa/vigilante_modelos.py),
    # con sus esperas y sus sondeos a la vista. dspy.LM deja num_retries=3 y LiteLLM
    # repetía por dentro cada intento con su propio retroceso: ante un 5xx o un 429
    # eran 4 peticiones por intento (16 por ciclo), y contra un gateway que limita
    # por ritmo eso agrava el 429 que se quiere esperar (la corrida 13, 18 de
    # septiembre de 2026: "se reintentó 4 veces en serie").
    kwargs.setdefault("num_retries", 0)
    return dspy.LM(f"openai/{modelo}", api_base=URL_GATEWAY, api_key=clave(), **kwargs)


SEGUNDOS_SONDEO = 20.0


def _id_en_gateway(lm: dspy.LM | str) -> str:
    """El id del modelo tal como lo conoce el gateway: `lm.model` sin el prefijo
    `openai/` que añade `lm()` para LiteLLM ("openai/anthropic/claude-opus-5"
    es "anthropic/claude-opus-5"; "openai/openai/gpt-6-astra" es
    "openai/gpt-6-astra"). Un id sin ese doble prefijo se deja tal cual."""
    modelo = str(getattr(lm, "model", None) or lm or "")
    return modelo[len("openai/"):] if modelo.startswith("openai/") and modelo.count("/") >= 2 else modelo


async def sondear(lm: dspy.LM | str, *, cliente: Any | None = None, tiempo_s: float = SEGUNDOS_SONDEO) -> bool:
    """¿Contesta este modelo ahora mismo? Una petición mínima al gateway
    (`chat/completions`, un mensaje, `max_tokens` 1, `tiempo_s` de tope) con
    httpx directo, sin DSPy ni LiteLLM: si el modelo está caído no queremos
    sus reintentos internos ni su caché. Devuelve True solo con un 200 y una
    respuesta con `choices`; cualquier otra cosa (4xx, 5xx, tiempo agotado,
    sin red, sin clave) es False. Nunca lanza y no escribe nada en el estado:
    lo llama el vigilante de modelos (rosa/vigilante_modelos.py) entre
    intentos y el supervisor mientras una corrida está en `esperando_modelo`.
    `cliente` permite pasar un `httpx.AsyncClient` propio (los tests le dan
    uno con transporte falso)."""
    try:
        import httpx

        kw = getattr(lm, "kwargs", None)
        kw = kw if isinstance(kw, dict) else {}
        base = str(kw.get("api_base") or URL_GATEWAY).rstrip("/")
        clave_api = kw.get("api_key") or clave()
        cuerpo = {"model": _id_en_gateway(lm), "messages": [{"role": "user", "content": "ok"}], "max_tokens": 1}
        cabeceras = {"Authorization": f"Bearer {clave_api}", "Content-Type": "application/json"}

        async def pedir(c: Any) -> bool:
            r = await c.post(f"{base}/chat/completions", json=cuerpo, headers=cabeceras, timeout=tiempo_s)
            if r.status_code != 200:
                return False
            datos = r.json()
            return bool(isinstance(datos, dict) and datos.get("choices"))

        if cliente is not None:
            return await pedir(cliente)
        async with httpx.AsyncClient(timeout=tiempo_s) as c:
            return await pedir(c)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001  (un sondeo que falla es "no respondió", y no debe romper a quien espera)
        return False


@dataclass(frozen=True)
class Modelos:
    cerebro: dspy.LM
    juez: dspy.LM
    volumen: dspy.LM
    """El reflexivo de GEPA: la documentación pide un modelo fuerte a temperature=1.0 y max_tokens=32000."""
    reflexion: dspy.LM
    """El juez a temperatura alta para las trayectorias de replicación: lecturas distintas, no la misma llamada repetida."""
    replica: dspy.LM | None = None


def modelos() -> Modelos:
    return Modelos(
        cerebro=lm(CEREBRO),
        juez=lm(JUEZ, max_tokens=16000),  # el Killer razona largo y devuelve once comprobaciones con detalle: a 8000 aún se truncaba
        volumen=lm(VOLUMEN),
        reflexion=lm(JUEZ, temperature=1.0, max_tokens=32000),
        # Sin caché: cada trayectoria es una lectura nueva del juez (ver `lm`).
        replica=lm(JUEZ, temperature=1.0, max_tokens=16000, cache=False),
    )
