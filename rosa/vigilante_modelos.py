"""Vigilante de modelos: reintentar con el MISMO modelo hasta que vuelva.

Regla de Emir (TRASPASO.md 7.4, 18 de septiembre de 2026): el cerebro es GPT-6
Astra y solo Astra; el juez es Claude Opus 5 y solo Opus. Cuando no responden,
ROSA2018 espera y reintenta con el mismo modelo; nunca degrada el rol a Claude
Sonnet ni a otro. Sonnet queda para el rol de volumen.

Qué hace `llamar_vigilado`:

- Acota cada intento a `TIEMPO_AVISO_S[rol]` segundos (antes eran 600 s por
  llamada, y LiteLLM por dentro reintentaba 4 veces de 5 minutos: la corrida 13
  perdió una hora entera el 18 de septiembre esperando a Opus).
- Un fallo transitorio (tiempo agotado, conexión, 429, 5xx) se reintenta hasta
  `MAX_INTENTOS` veces con el mismo modelo, esperando `ESPERAS_S` entre
  intentos. Antes de agotar cada espera sondea el gateway (`sondear`) y, si el
  modelo ya contesta, reintenta sin esperar más.
- Un fallo de contenido (filtro, respuesta vacía, salida que no se parsea) en
  el cerebro, el juez o la réplica se reintenta hasta `MAX_REINTENTOS_CONTENIDO`
  veces con `lm.copy(rollout_id=n)`: mismo prompt, mismo modelo, clave de caché
  distinta (sin variar el `rollout_id`, DSPy devolvería la misma respuesta vacía
  desde la caché). Si persiste, el paso falla con `ModeloBloqueado` y una
  incidencia `modelo_bloqueado`. Nunca se cambia de modelo.
- Escribe lo que pasa donde la persona lo ve: la incidencia
  `modelo_sin_respuesta` (que ROSA2018 abre y resuelve sola), los eventos
  `modelo_sin_respuesta` y `modelo_recuperado`, la salud por rol en
  `saludModelos` y la espera de la corrida en `esperandoModelo` (con la corrida
  en estado `esperando_modelo`, cuyo tiempo no cuenta como trabajo).

Todo lo que toca el mundo exterior (dormir, sondear, escribir el estado) entra
por `Ganchos`, para que los tests lo sustituyan por dobles y no esperen ni
salgan a la red. Las funciones sobre el estado (`registrar_salud`,
`fijar_espera_modelo`, `abrir_incidencia_sin_respuesta`...) son reducers puros:
toleran que `saludModelos` o `esperandoModelo` no existan (registros antiguos).
"""

from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable

from rosa.estado import plantilla as P
from rosa.modulos.contador import PresupuestoAgotado

# Segundos que se le da a cada intento antes de darlo por perdido. Medido sobre
# la tabla `llamadas` del 14 al 18 de septiembre de 2026: cerebro p99 100 s
# (máximo 327 s), juez p99 119 s (máximo 376 s, en la recuperación del 18),
# volumen p99 37 s. Un intento que supera esto es un fallo transitorio, no una
# espera.
TIEMPO_AVISO_S: dict[str, int] = {"cerebro": 240, "juez": 300, "volumen": 120, "replica": 300}
# Espera entre intentos, por número de fallo (el último valor se repite).
ESPERAS_S: tuple[int, ...] = (15, 30, 60, 60)
# Intentos seguidos con el mismo modelo antes de lanzar `ModeloSinRespuesta`.
MAX_INTENTOS = 4
# Cada cuánto se sondea el gateway mientras se espera (también la cadencia del
# supervisor cuando la corrida queda en `esperando_modelo`).
INTERVALO_SONDEO_S = 60
# Reintentos con `rollout_id` distinto ante un filtro o una respuesta vacía.
MAX_REINTENTOS_CONTENIDO = 2
# Un intento cortado por tiempo mientras el gateway responde al sondeo no es una
# caída: es el modelo tardando con esta petición (medido en `llamadas`: cerebro
# hasta 327 s con 2 de 258 por encima de 240 s; juez hasta 376 s). Se amplía el
# tope una vez (x FACTOR_LENTO, sin pasar de TOPE_LENTO_S) y, si vuelve a
# cortarse con el sondeo vivo, el paso falla con `ModeloBloqueado` e incidencia
# `modelo_bloqueado`: nunca entra en el bucle esperar-sondear-relanzar, que
# pagaría cada generación cortada sin terminar ninguna.
MAX_LENTOS = 1
FACTOR_LENTO = 2
TOPE_LENTO_S = 600
# Con éxito y sin fallo previo, `ultimaRespuestaEn` se refresca como mucho cada
# tanto: si no, cada llamada al modelo sería una escritura más del estado.
REFRESCO_SALUD_MS = 60_000

# Roles cuyo modelo no se sustituye por otro (regla de Emir). El volumen es el
# único que hoy usa Sonnet, y tampoco se sustituye: simplemente no se reintenta
# por contenido (sus llamadas son muchas y baratas, y el ejecutor conserva el
# artículo "sin puntuar").
ROLES_QUE_NO_SE_SUSTITUYEN = ("cerebro", "juez", "replica")

TIPO_INCIDENCIA = "modelo_sin_respuesta"
EVENTO_SIN_RESPUESTA = "modelo_sin_respuesta"
EVENTO_RECUPERADO = "modelo_recuperado"

# Palabras que hoy distinguen un fallo de contenido (las que usaba Ctx.llamar).
PALABRAS_CONTENIDO: tuple[str, ...] = ("content", "filter", "policy", "refus", "empty", "no output", "parse")
# Palabras de un fallo transitorio cuando la excepción no es de un tipo conocido.
PALABRAS_TRANSITORIAS: tuple[str, ...] = (
    "timeout",
    "timed out",
    "time out",
    "connection error",
    "connection reset",
    "connection refused",
    "connecterror",
    "network",
    "temporarily unavailable",
    "service unavailable",
    "overloaded",
    "rate limit",
    "too many requests",
    "internal server error",
    "bad gateway",
    "gateway timeout",
    "remote protocol error",
    "server disconnected",
)

NOMBRES_MODELOS: dict[str, str] = {
    "openai/gpt-6-astra": "GPT-6 Astra",
    "anthropic/claude-opus-5": "Claude Opus 5",
    "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "anthropic/claude-fable-5.1": "Claude Fable 5.1",
}

NOMBRES_ROLES: dict[str, str] = {"cerebro": "cerebro", "juez": "juez", "volumen": "modelo de volumen", "replica": "juez de réplica"}


class ModeloSinRespuesta(RuntimeError):
    """El modelo del rol no respondió en `MAX_INTENTOS` intentos seguidos.
    ROSA2018 no cambia de modelo: quien la recibe (el supervisor de la corrida)
    deja la corrida en `esperando_modelo`, sondea cada `INTERVALO_SONDEO_S` y
    retoma el paso cuando el modelo vuelva."""

    def __init__(self, rol: str, modelo: str, intentos: int, desde: int, nombre: str | None = None) -> None:
        self.rol = rol
        self.modelo = modelo
        self.intentos = intentos
        self.desde = desde
        self.nombre = nombre or nombre_de_modelo(modelo)
        super().__init__(f"{self.nombre} ({NOMBRES_ROLES.get(rol, rol)}) no respondió en {intentos} intentos seguidos desde las {hora(desde)}; ROSA2018 espera a que vuelva y no cambia de modelo")


class ModeloBloqueado(RuntimeError):
    """El paso falla de forma visible sin cambiar de modelo. Dos motivos:
    "contenido" (respondió vacío, filtrado o sin poder parsearse, y siguió así
    tras variar el `rollout_id`) y "lento" (el intento se cortó por tiempo
    `reintentos` veces mientras el gateway sí respondía al sondeo: el modelo
    vive, pero tarda más de lo que ROSA2018 espera con esta petición)."""

    def __init__(self, rol: str, modelo: str, reintentos: int, detalle: str, motivo: str = "contenido") -> None:
        self.rol = rol
        self.modelo = modelo
        self.reintentos = reintentos
        self.detalle = detalle
        self.motivo = motivo
        quien = f"{nombre_de_modelo(modelo)} ({NOMBRES_ROLES.get(rol, rol)})"
        if motivo == "lento":
            super().__init__(f"{quien} tarda más de lo que ROSA2018 espera con esta petición ({intentos_texto(reintentos)} cortados por tiempo con el gateway respondiendo): {detalle[:200]}")
        else:
            super().__init__(f"{quien} no dio una respuesta usable tras {reintentos + 1} intentos con el mismo modelo: {detalle[:200]}")


class CortePorTiempo(asyncio.TimeoutError):
    """El intento se cortó al cumplirse el tope del vigilante. Es distinto de un
    `TimeoutError` que lance el propio programa (LiteLLM o httpx por dentro):
    aquí sabemos que el modelo no había contestado nada en `tiempo_s` segundos,
    y con eso se decide si está caído (el sondeo tampoco responde) o solo lento
    con esta petición (el sondeo sí responde)."""

    def __init__(self, tiempo_s: float) -> None:
        self.tiempo_s = float(tiempo_s)
        super().__init__(f"el intento se cortó a los {int(tiempo_s)} s sin respuesta")


# ---------------------------------------------------------------------------
# Nombres, horas y textos
# ---------------------------------------------------------------------------


def id_modelo(lm: Any) -> str:
    """El id del modelo en el gateway: `lm.model` sin el prefijo `openai/` de
    LiteLLM (una sola vez: "openai/openai/gpt-6-astra" es "openai/gpt-6-astra")."""
    modelo = str(getattr(lm, "model", None) or lm or "")
    return modelo[len("openai/"):] if modelo.startswith("openai/") and modelo.count("/") >= 2 else modelo


def nombre_de_modelo(modelo: str) -> str:
    """Nombre legible del modelo para los textos que lee una persona."""
    limpio = id_modelo(modelo)
    if limpio in NOMBRES_MODELOS:
        return NOMBRES_MODELOS[limpio]
    cola = limpio.rsplit("/", 1)[-1]
    return " ".join(p.capitalize() if not p[:1].isdigit() else p for p in cola.replace("-", " ").split()) or limpio or "el modelo"


def hora(ms: int | float | None) -> str:
    """HH:MM en hora local del servidor; "?" si no hay marca."""
    if not isinstance(ms, (int, float)):
        return "?"
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M")


def hora_con_segundos(ms: int | float | None) -> str:
    if not isinstance(ms, (int, float)):
        return "?"
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")


def duracion_texto(ms: int | float) -> str:
    """"menos de un minuto", "1 minuto", "12 minutos", "1 hora y 5 minutos"."""
    minutos = int(max(0, ms) // 60_000)
    if minutos < 1:
        return "menos de un minuto"
    if minutos < 60:
        return "1 minuto" if minutos == 1 else f"{minutos} minutos"
    horas, resto = divmod(minutos, 60)
    texto_h = "1 hora" if horas == 1 else f"{horas} horas"
    if resto == 0:
        return texto_h
    return f"{texto_h} y {'1 minuto' if resto == 1 else f'{resto} minutos'}"


def intentos_texto(n: int) -> str:
    return "1 intento" if n == 1 else f"{n} intentos"


def texto_evento_sin_respuesta(nombre: str, desde: int) -> str:
    return f"{nombre} no responde desde las {hora(desde)}; ROSA2018 reintenta sola"


def texto_evento_recuperado(nombre: str, intentos: int, desde: int, ahora: int) -> str:
    return f"{nombre} volvió tras {intentos_texto(intentos)} y {duracion_texto(ahora - desde)}"


def texto_alternativa(nombre: str) -> str:
    return f"ROSA2018 lo está resolviendo sola: reintenta con {nombre} cada pocos segundos"


def texto_detalle_intento(rol: str, nombre: str, intentos: int, tiempo_s: float, proximo: int | None, error: str, *, cortado: bool = True, latencia_s: float | None = None) -> str:
    """"no respondió en 300 s" solo cuando el intento se cortó por tiempo; un
    ConnectError o un 503 que llegan en milisegundos dicen "falló al instante",
    y uno que tardó, "falló a los N s". Así la duración total que lee la
    persona cuadra con lo que pasó, no con el tope."""
    quien = f"El {NOMBRES_ROLES.get(rol, rol)} ({nombre})"
    if cortado:
        que = f"no respondió en {int(tiempo_s)} s"
    elif latencia_s is not None and latencia_s < 1:
        que = "falló al instante"
    elif latencia_s is not None:
        que = f"falló a los {int(latencia_s)} s"
    else:
        que = "falló"
    base = f"{quien} {que} (intento {intentos} de {MAX_INTENTOS}; {error})."
    if proximo is not None:
        return f"{base} Siguiente intento a las {hora_con_segundos(proximo)}."
    return base


def texto_detalle_lento(rol: str, nombre: str, tiempo_s: float, cortes: int) -> str:
    return (
        f"{nombre} tarda más de {int(tiempo_s)} s con esta petición ({intentos_texto(cortes)} cortados por tiempo mientras el gateway respondía al sondeo). "
        f"El {NOMBRES_ROLES.get(rol, rol)} vive, así que no es una caída: el paso falla para que se revise la petición; ROSA2018 no cambia de modelo ni sigue esperando."
    )


def texto_detalle_cerrada(nombre: str, intentos: int) -> str:
    return f"{nombre} no respondió en {intentos_texto(intentos)}, pero la corrida ya no seguía (detenida o terminada): ROSA2018 deja de esperarlo aquí."


RESOLUCION_CERRADA = "La corrida ya no seguía: se cierra sin esperar al modelo"


def texto_detalle_agotado(rol: str, nombre: str, desde: int, ahora: int) -> str:
    return (
        f"El {NOMBRES_ROLES.get(rol, rol)} ({nombre}) no respondió en {MAX_INTENTOS} intentos seguidos desde las {hora(desde)} ({duracion_texto(ahora - desde)}). "
        f"ROSA2018 sondea el gateway cada {INTERVALO_SONDEO_S} s y retoma el paso cuando vuelva; no cambia de modelo."
    )


def texto_detalle_recuperado(nombre: str, intentos: int, desde: int, ahora: int) -> str:
    return f"{nombre} volvió tras {intentos_texto(intentos)} y {duracion_texto(ahora - desde)} ({hora(desde)} a {hora(ahora)})."


def resumen_error(ex: BaseException) -> str:
    texto = str(ex).strip().replace("\n", " ")
    return f"{type(ex).__name__}: {texto[:120]}" if texto else type(ex).__name__


# ---------------------------------------------------------------------------
# Clasificar el fallo
# ---------------------------------------------------------------------------


def _tipos(nombres: tuple[tuple[str, str], ...]) -> tuple[type, ...]:
    salida: list[type] = []
    for modulo, nombre in nombres:
        try:
            mod = __import__(modulo, fromlist=[nombre])
            t = getattr(mod, nombre, None)
            if isinstance(t, type):
                salida.append(t)
        except Exception:  # noqa: BLE001  (la librería puede no estar en un entorno mínimo)
            continue
    return tuple(salida)


TIPOS_TRANSITORIOS: tuple[type, ...] = (asyncio.TimeoutError, TimeoutError, ConnectionError) + _tipos(
    (
        ("httpx", "TimeoutException"),
        ("httpx", "TransportError"),
        ("litellm", "Timeout"),
        ("litellm", "APIConnectionError"),
        ("litellm", "ServiceUnavailableError"),
        ("litellm", "InternalServerError"),
        ("litellm", "RateLimitError"),
    )
)
TIPOS_CONTENIDO: tuple[type, ...] = _tipos((("litellm", "ContentPolicyViolationError"), ("dspy.utils.exceptions", "AdapterParseError")))


def clasificar_fallo(ex: BaseException) -> str:
    """"transitorio" (esperar y reintentar con el mismo modelo), "contenido"
    (filtro, vacío, no parseable: variar el rollout_id) u "otro" (se propaga
    tal cual: una clave mala o un error de programación no se arreglan
    esperando). Primero por tipo, después por el código HTTP, después por las
    palabras del mensaje; el contenido gana a lo transitorio en las palabras
    porque "policy" o "filter" son más específicas que "error". Las excepciones
    del propio vigilante van antes que todo: una llamada vigilada dentro de otra
    (un ReAct que llame a un modelo por dentro) no debe reintentar fuera lo que
    ya se agotó dentro, aunque su mensaje lleve "empty" o "timeout"."""
    if isinstance(ex, (ModeloSinRespuesta, ModeloBloqueado)):
        return "otro"
    if TIPOS_CONTENIDO and isinstance(ex, TIPOS_CONTENIDO):
        return "contenido"
    if isinstance(ex, TIPOS_TRANSITORIOS):
        return "transitorio"
    codigo = getattr(ex, "status_code", None)
    if isinstance(codigo, int) and not isinstance(codigo, bool) and (codigo in (408, 425, 429) or codigo >= 500):
        return "transitorio"
    nombre = type(ex).__name__.lower()
    texto = str(ex).lower()
    if any(p in texto or p in nombre for p in PALABRAS_CONTENIDO):
        return "contenido"
    if any(p in texto or p in nombre for p in PALABRAS_TRANSITORIAS):
        return "transitorio"
    return "otro"


# ---------------------------------------------------------------------------
# Ganchos: lo que se inyecta
# ---------------------------------------------------------------------------


def _nada(*_a: Any, **_k: Any) -> None:
    return None


@dataclass
class Ganchos:
    """Lo que `llamar_vigilado` necesita del exterior. Por defecto no escribe
    nada (solo duerme y sondea de verdad); `ganchos_de_contexto(ctx)` da la
    versión que escribe en el estado de la corrida.

    - `dormir(segundos)`: espera entre intentos (los tests la anulan).
    - `sondear(lm)`: True si el modelo contesta a una petición mínima
      (`None` usa `rosa.gateway.sondear`).
    - `incidencia(accion, datos)`: "abrir", "actualizar" o "resolver" la
      incidencia `modelo_sin_respuesta`, o "bloqueo" para `modelo_bloqueado`.
      Devuelve False si no cambió nada (ya estaba abierta o ya resuelta): así
      el evento se emite una sola vez aunque veinte llamadas fallen a la vez.
    - `evento(tipo, texto)`: `modelo_sin_respuesta` o `modelo_recuperado`.
    - `salud(rol, modelo, cambio)`: `cambio["fase"]` es "fallo", "sondeo" u "ok".
    - `espera_pendiente(rol, modelo)`: lo que la corrida aún tiene anotado en
      `esperandoModelo` para ese modelo (dict) o None. Con él, una llamada que
      responde a la primera cierra una espera que dejó otra llamada (una que un
      ejecutor se tragó, o la de antes de un reinicio) en vez de dejar a la
      corrida "esperando" mientras ya trabaja.
    - `cerrar(rol, modelo, datos)`: al agotar los intentos, si la corrida ya no
      sigue (detenida o terminada), quita la espera y resuelve la incidencia con
      "la corrida ya no seguía"; si sigue, no hace nada (el supervisor sondea).
    - `ahora()` y `reloj()`: milisegundos de pared y segundos monótonos."""

    dormir: Callable[[float], Awaitable[None]] = asyncio.sleep
    sondear: Callable[[Any], Any] | None = None
    incidencia: Callable[[str, dict[str, Any]], Any] = _nada
    evento: Callable[[str, str], Any] = _nada
    salud: Callable[[str, str, dict[str, Any]], Any] = _nada
    espera_pendiente: Callable[[str, str], Any] | None = None
    cerrar: Callable[[str, str, dict[str, Any]], Any] = _nada
    ahora: Callable[[], int] = P.ahora_ms
    reloj: Callable[[], float] = time.monotonic
    extras: dict[str, Any] = field(default_factory=dict)


async def _sondear_con(ganchos: Ganchos, lm: Any) -> bool:
    fn = ganchos.sondear
    if fn is None:
        from rosa import gateway

        fn = gateway.sondear
    try:
        r = fn(lm)
        if inspect.isawaitable(r):
            r = await r
        return bool(r)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001  (un sondeo que falla es "no respondió", nunca rompe la espera)
        return False


def _espera_previa(ganchos: Ganchos, rol: str, modelo: str) -> dict[str, Any] | None:
    fn = ganchos.espera_pendiente
    if fn is None:
        return None
    try:
        r = fn(rol, modelo)
    except Exception:  # noqa: BLE001  (leer el estado nunca rompe una llamada que ya respondió)
        return None
    return r if isinstance(r, dict) and r else None


def _rollout_base(lm: Any) -> int | None:
    kw = getattr(lm, "kwargs", None)
    valor = kw.get("rollout_id") if isinstance(kw, dict) else None
    if valor is None:
        valor = getattr(lm, "rollout_id", None)
    return int(valor) if isinstance(valor, (int, float)) and not isinstance(valor, bool) else None


def rollout_de_reintento(base: int | None, n: int) -> int:
    """El `rollout_id` del reintento n por contenido: lejos de los ids pequeños
    que usan las trayectorias de réplica (0..4), y distinto por intento, para
    que la caché de DSPy no devuelva la misma respuesta vacía ni la de otra
    trayectoria."""
    return 1000 * n + (base or 0)


# ---------------------------------------------------------------------------
# La llamada vigilada
# ---------------------------------------------------------------------------


async def _sondeo_anotado(ganchos: Ganchos, lm: Any, rol: str, modelo: str) -> tuple[bool, int]:
    """Un sondeo al gateway, anotado en la salud (fase "sondeo"). Devuelve si
    respondió y la marca de tiempo del sondeo."""
    marca = ganchos.ahora()
    respondio = await _sondear_con(ganchos, lm)
    ganchos.salud(rol, modelo, {"fase": "sondeo", "ahora": ganchos.ahora(), "ultimoSondeo": marca, "respondio": respondio})
    return respondio, marca


async def _esperar_o_sondear(ganchos: Ganchos, lm: Any, rol: str, modelo: str, espera_s: float, *, ya_sondeado: bool = False) -> bool:
    """Sondea; si el modelo contesta, vuelve enseguida (True). Si no, duerme la
    espera a trozos de `INTERVALO_SONDEO_S`, sondeando entre trozos. False si
    la espera se agotó sin que el sondeo respondiera (se reintenta igual).
    `ya_sondeado`: el sondeo inicial ya se hizo (tras un corte por tiempo) y
    no respondió; no se repite."""

    async def sondeo() -> bool:
        respondio, _ = await _sondeo_anotado(ganchos, lm, rol, modelo)
        return respondio

    if not ya_sondeado and await sondeo():
        return True
    restante = float(espera_s)
    while restante > 0:
        trozo = min(restante, float(INTERVALO_SONDEO_S))
        await ganchos.dormir(trozo)
        restante -= trozo
        if restante > 0 and await sondeo():
            return True
    return False


async def _intento_acotado(ejecutar: Callable[[Any], Awaitable[Any]], lm: Any, tiempo_s: float) -> Any:
    """`await ejecutar(lm)` con tope. Si el tope se cumple sin que el programa
    haya salido por sí mismo, lanza `CortePorTiempo`; un `TimeoutError` que
    lance el propio programa (LiteLLM, httpx) sale tal cual. La distinción
    importa: en Python 3.11+ `asyncio.TimeoutError` ES `TimeoutError`, así que
    por el tipo no se puede saber quién lo lanzó."""
    salio = False

    async def envuelta() -> Any:
        nonlocal salio
        try:
            return await ejecutar(lm)
        except asyncio.CancelledError:
            raise
        except BaseException:
            salio = True
            raise

    try:
        return await asyncio.wait_for(envuelta(), timeout=tiempo_s)
    except asyncio.TimeoutError as ex:
        if salio:
            raise
        raise CortePorTiempo(tiempo_s) from ex


def _tope_ampliado(tiempo_s: float) -> float:
    return max(tiempo_s, min(tiempo_s * FACTOR_LENTO, float(TOPE_LENTO_S)))


async def llamar_vigilado(ejecutar: Callable[[Any], Awaitable[Any]], rol: str, lm: Any, *, ganchos: Ganchos | None = None) -> Any:
    """Ejecuta `await ejecutar(lm)` con el mismo modelo hasta que responda.

    `ejecutar(modelo)` hace la llamada real (el programa DSPy con ese modelo en
    contexto); recibe el modelo porque los reintentos por contenido pasan una
    copia con otro `rollout_id`. Lanza `ModeloSinRespuesta` tras `MAX_INTENTOS`
    fallos transitorios seguidos, `ModeloBloqueado` si el contenido sigue
    inservible tras `MAX_REINTENTOS_CONTENIDO` variaciones o si el intento se
    corta por tiempo más de `MAX_LENTOS` veces con el gateway respondiendo al
    sondeo (modelo vivo pero lento con esta petición), y propaga tal cual
    `PresupuestoAgotado` y cualquier fallo que no sea ni transitorio ni de
    contenido. Nunca llama a otro modelo que el que recibe.

    Una llamada que responde a la primera también cierra la espera que otra
    dejó anotada en la corrida para el mismo modelo (`espera_pendiente`):
    resuelve la incidencia y emite `modelo_recuperado` con los intentos y la
    duración reales de aquella espera."""
    g = ganchos or Ganchos()
    modelo = id_modelo(lm)
    nombre = nombre_de_modelo(modelo)
    tiempo = float(TIEMPO_AVISO_S.get(rol, TIEMPO_AVISO_S["juez"]))
    base_rollout = _rollout_base(lm)
    lm_actual = lm
    fallos = 0
    lentos = 0
    reintentos_contenido = 0
    desde: int | None = None
    while True:
        # Un punto de cesión antes de cada intento: si quien nos llama canceló la
        # tarea (el paso ya falló por una hermana, la corrida se apaga), la
        # cancelación entra aquí y no se paga otro intento. Con la red real cada
        # intento cede por sí mismo; con dobles instantáneos no cedería nunca.
        await asyncio.sleep(0)
        inicio_ms = g.ahora()
        t0 = g.reloj()
        try:
            resultado = await _intento_acotado(ejecutar, lm_actual, tiempo)
        except PresupuestoAgotado:
            raise
        except Exception as ex:  # noqa: BLE001
            latencia_s = max(0.0, g.reloj() - t0)
            cortado = isinstance(ex, CortePorTiempo)
            clase = clasificar_fallo(ex)
            if clase == "transitorio":
                ya_sondeado = False
                ultimo_sondeo: int | None = None
                if cortado:
                    # El tope se cumplió sin respuesta. Si el gateway contesta al sondeo,
                    # el modelo vive y solo tarda con esta petición: no es una caída, no
                    # abre incidencia de "no responde" ni cuenta en `caidas`.
                    respondio, ultimo_sondeo = await _sondeo_anotado(g, lm, rol, modelo)
                    if respondio:
                        lentos += 1
                        if lentos <= MAX_LENTOS:
                            tiempo = _tope_ampliado(tiempo)
                            continue
                        detalle = texto_detalle_lento(rol, nombre, tiempo, lentos)
                        g.incidencia(
                            "bloqueo",
                            {
                                "rol": rol,
                                "modelo": modelo,
                                "nombre": nombre,
                                "titulo": f"{nombre} tarda más de {int(tiempo)} s con esta petición",
                                "detalle": detalle,
                                "alternativa": f"Revisar el paso o la petición; ROSA2018 no sustituye a {nombre} por otro modelo en el rol de {NOMBRES_ROLES.get(rol, rol)} ni sigue esperando a esta petición.",
                            },
                        )
                        raise ModeloBloqueado(rol, modelo, lentos, detalle, motivo="lento") from ex
                    ya_sondeado = True
                fallos += 1
                if desde is None:
                    desde = inicio_ms
                ahora = g.ahora()
                error = f"TimeoutError: {ex}" if cortado else resumen_error(ex)
                if fallos >= MAX_INTENTOS:
                    proximo_sondeo = ahora + INTERVALO_SONDEO_S * 1000
                    g.salud(rol, modelo, {"fase": "fallo", "ahora": ahora, "intentos": fallos, "desde": desde, "proximoIntentoEn": proximo_sondeo, "agotado": True, "error": error, "tiempoS": tiempo, "ultimoSondeo": ultimo_sondeo})
                    datos_fin = {"rol": rol, "modelo": modelo, "nombre": nombre, "intentos": fallos, "desde": desde, "ahora": ahora}
                    g.incidencia("actualizar", {**datos_fin, "detalle": texto_detalle_agotado(rol, nombre, desde, ahora)})
                    # Si la corrida ya no sigue (la detuvieron o terminó mientras se
                    # reintentaba) nadie va a sondear por ella: la espera y la incidencia
                    # se cierran aquí en vez de quedar "resolviéndose solo" para siempre.
                    g.cerrar(rol, modelo, datos_fin)
                    raise ModeloSinRespuesta(rol, modelo, fallos, desde, nombre) from ex
                espera = ESPERAS_S[min(fallos - 1, len(ESPERAS_S) - 1)]
                proximo = ahora + int(espera * 1000)
                g.salud(rol, modelo, {"fase": "fallo", "ahora": ahora, "intentos": fallos, "desde": desde, "proximoIntentoEn": proximo, "agotado": False, "error": error, "tiempoS": tiempo, "ultimoSondeo": ultimo_sondeo})
                datos = {
                    "rol": rol,
                    "modelo": modelo,
                    "nombre": nombre,
                    "intentos": fallos,
                    "desde": desde,
                    "ahora": ahora,
                    "proximo": proximo,
                    "detalle": texto_detalle_intento(rol, nombre, fallos, tiempo, proximo, error, cortado=cortado, latencia_s=latencia_s),
                    "alternativa": texto_alternativa(nombre),
                }
                if fallos == 1:
                    if g.incidencia("abrir", datos) is not False:
                        g.evento(EVENTO_SIN_RESPUESTA, texto_evento_sin_respuesta(nombre, desde))
                else:
                    g.incidencia("actualizar", datos)
                await _esperar_o_sondear(g, lm, rol, modelo, espera, ya_sondeado=ya_sondeado)
                continue
            if clase == "contenido":
                if rol in ROLES_QUE_NO_SE_SUSTITUYEN and reintentos_contenido < MAX_REINTENTOS_CONTENIDO and hasattr(lm, "copy"):
                    reintentos_contenido += 1
                    lm_actual = lm.copy(rollout_id=rollout_de_reintento(base_rollout, reintentos_contenido))
                    continue
                if rol in ROLES_QUE_NO_SE_SUSTITUYEN:
                    detalle = resumen_error(ex)
                    g.incidencia(
                        "bloqueo",
                        {
                            "rol": rol,
                            "modelo": modelo,
                            "nombre": nombre,
                            "titulo": f"{nombre} no dio una respuesta usable",
                            "detalle": f"{detalle[:300]}. Se reintentó {reintentos_contenido} veces con el mismo modelo variando el rollout_id.",
                            "alternativa": f"Revisar el prompt o el paso; ROSA2018 no sustituye a {nombre} por otro modelo en el rol de {NOMBRES_ROLES.get(rol, rol)}.",
                        },
                    )
                    raise ModeloBloqueado(rol, modelo, reintentos_contenido, detalle) from ex
            raise
        latencia = int((g.reloj() - t0) * 1000)
        ahora = g.ahora()
        # Sin fallos en ESTA llamada, ¿dejó otra a la corrida esperando a este mismo
        # modelo? (un ejecutor que se tragó la excepción, un reinicio). Se cierra aquí.
        previa = None if fallos else _espera_previa(g, rol, modelo)
        if fallos or previa:
            intentos_ok = fallos if fallos else int((previa or {}).get("intentos") or 0)
            desde_ok = desde if fallos else (previa or {}).get("desde")
            desde_ok = int(desde_ok) if isinstance(desde_ok, (int, float)) and not isinstance(desde_ok, bool) else ahora
            g.salud(rol, modelo, {"fase": "ok", "ahora": ahora, "latenciaMs": latencia, "recuperado": True, "intentos": intentos_ok, "desde": desde_ok})
            resuelta = g.incidencia("resolver", {"rol": rol, "modelo": modelo, "nombre": nombre, "intentos": intentos_ok, "desde": desde_ok, "ahora": ahora, "detalle": texto_detalle_recuperado(nombre, intentos_ok, desde_ok, ahora)})
            if resuelta is not False:
                g.evento(EVENTO_RECUPERADO, texto_evento_recuperado(nombre, intentos_ok, desde_ok, ahora))
        else:
            g.salud(rol, modelo, {"fase": "ok", "ahora": ahora, "latenciaMs": latencia, "recuperado": False, "intentos": 0, "desde": None})
        return resultado


# ---------------------------------------------------------------------------
# Reducers sobre el estado (puros; toleran registros antiguos)
# ---------------------------------------------------------------------------


def salud_vacia(modelo: str) -> dict[str, Any]:
    return {"modelo": modelo, "estado": "ok", "desde": None, "intentos": 0, "proximoIntentoEn": None, "ultimaRespuestaEn": None, "ultimaLatenciaMs": None, "caidas": 0, "recuperadoEn": None}


def _salud_actual(e: dict[str, Any], rol: str) -> dict[str, Any] | None:
    salud = e.get("saludModelos")
    actual = salud.get(rol) if isinstance(salud, dict) else None
    return actual if isinstance(actual, dict) else None


def _min_marca(a: Any, b: Any) -> Any:
    marcas = [x for x in (a, b) if isinstance(x, (int, float)) and not isinstance(x, bool)]
    return min(marcas) if marcas else None


def registrar_salud(e: dict[str, Any], rol: str, modelo: str, cambio: dict[str, Any]) -> bool:
    """Aplica un `cambio` del vigilante a `saludModelos[rol]`. Devuelve False si
    no hay nada que escribir (así `mutar` no sube la versión). Dos corridas que
    ven caer el mismo modelo a la vez cuentan UNA caída: `caidas` solo sube al
    pasar de "ok" a caído, `desde` se queda con la marca más antigua e
    `intentos` con la mayor. No toca el estado hasta decidir que escribe."""
    actual = _salud_actual(e, rol)
    nuevo = dict(actual) if actual is not None else salud_vacia(modelo)
    for clave, valor in salud_vacia(modelo).items():
        nuevo.setdefault(clave, valor)
    fase = cambio.get("fase")
    if fase == "fallo":
        caido_ya = actual is not None and actual.get("estado") in ("lento", "sin_respuesta")
        intentos = int(cambio.get("intentos") or 1)
        nuevo["modelo"] = modelo
        if caido_ya:
            nuevo["intentos"] = max(int(actual.get("intentos") or 0), intentos)
            nuevo["desde"] = _min_marca(actual.get("desde"), cambio.get("desde"))
            nuevo["estado"] = "sin_respuesta" if (nuevo["intentos"] >= 2 or actual.get("estado") == "sin_respuesta") else "lento"
            proximo_actual = actual.get("proximoIntentoEn")
            ahora = cambio.get("ahora")
            vigente = proximo_actual if isinstance(proximo_actual, (int, float)) and isinstance(ahora, (int, float)) and proximo_actual > ahora else None
            nuevo["proximoIntentoEn"] = _min_marca(vigente, cambio.get("proximoIntentoEn"))
        else:
            nuevo["intentos"] = intentos
            nuevo["desde"] = cambio.get("desde")
            nuevo["estado"] = "lento" if intentos <= 1 else "sin_respuesta"
            nuevo["proximoIntentoEn"] = cambio.get("proximoIntentoEn")
            nuevo["caidas"] = int(nuevo.get("caidas") or 0) + 1
    elif fase == "ok":
        ahora = cambio.get("ahora")
        recuperado = actual is not None and actual.get("estado") in ("lento", "sin_respuesta")
        if actual is not None and not recuperado and not cambio.get("recuperado"):
            ultima = actual.get("ultimaRespuestaEn")
            if isinstance(ultima, (int, float)) and isinstance(ahora, (int, float)) and ahora - ultima < REFRESCO_SALUD_MS and actual.get("modelo") == modelo:
                return False
        nuevo.update({"modelo": modelo, "estado": "ok", "intentos": 0, "proximoIntentoEn": None, "ultimaRespuestaEn": ahora, "ultimaLatenciaMs": cambio.get("latenciaMs")})
        if recuperado or cambio.get("recuperado"):
            nuevo["recuperadoEn"] = ahora
            nuevo["desde"] = ahora
        elif nuevo.get("desde") is None:
            nuevo["desde"] = ahora
    else:
        # Un sondeo no cambia la salud del rol: queda en `esperandoModelo` de la corrida.
        return False
    if actual is not None and nuevo == actual:
        return False
    salud = e.get("saludModelos")
    if not isinstance(salud, dict):
        salud = e["saludModelos"] = {}
    salud[rol] = nuevo
    return True


def _corrida(e: dict[str, Any], corrida_id: str) -> dict[str, Any] | None:
    return next((c for c in e.get("corridas", []) or [] if c.get("id") == corrida_id), None)


# Estados en los que la corrida ya no va a seguir: no se le anota una espera y,
# al agotar los intentos, la incidencia se cierra en vez de quedar pendiente.
ESTADOS_QUE_NO_SIGUEN = ("detenida", "terminada")


def espera_pendiente_de(e: dict[str, Any], corrida_id: str, modelo: str) -> dict[str, Any] | None:
    """Lo que la corrida tiene anotado en `esperandoModelo` si es para `modelo`."""
    c = _corrida(e, corrida_id)
    espera = c.get("esperandoModelo") if c else None
    if isinstance(espera, dict) and espera.get("modelo") == modelo:
        return dict(espera)
    return None


def cerrar_espera_si_no_sigue(e: dict[str, Any], corrida_id: str, datos: dict[str, Any]) -> bool:
    """Al agotar los intentos: si la corrida está detenida o terminada, quita
    `esperandoModelo` y resuelve la incidencia `modelo_sin_respuesta` con "la
    corrida ya no seguía". Si la corrida sigue, no toca nada (el supervisor la
    sondea). Devuelve si escribió algo."""
    c = _corrida(e, corrida_id)
    if c is None or c.get("estado") not in ESTADOS_QUE_NO_SIGUEN:
        return False
    modelo = str(datos.get("modelo") or "")
    nombre = str(datos.get("nombre") or nombre_de_modelo(modelo))
    quitada = quitar_espera_modelo(e, corrida_id)
    resuelta = resolver_incidencia_sin_respuesta(e, corrida_id, {**datos, "detalle": texto_detalle_cerrada(nombre, int(datos.get("intentos") or 0)), "resolucion": RESOLUCION_CERRADA})
    return bool(quitada or resuelta)


def paso_en_curso(e: dict[str, Any], iteracion_id: str | None) -> str | None:
    """El id del paso `en_curso` de la iteración, si lo hay."""
    if not iteracion_id:
        return None
    it = next((x for x in e.get("iteraciones", []) or [] if x.get("id") == iteracion_id), None)
    if not it:
        return None
    paso = next((p for p in it.get("plan", []) or [] if p.get("estado") == "en_curso"), None)
    return paso.get("id") if paso else None


def fijar_espera_modelo(e: dict[str, Any], corrida_id: str, iteracion_id: str | None, rol: str, modelo: str, cambio: dict[str, Any]) -> bool:
    """Anota en la corrida qué modelo espera (`esperandoModelo`) y la pone en
    `esperando_modelo` si estaba en marcha (su tiempo va a `pausaMs`, no cuenta
    como trabajo). No pisa una pausa ni una detención hechas a mano."""
    c = _corrida(e, corrida_id)
    if c is None or c.get("estado") in ESTADOS_QUE_NO_SIGUEN:
        # Una corrida detenida o terminada no espera a nadie: anotarle una espera
        # dejaría la franja "resolviéndose solo" sobre una corrida que ya acabó.
        return False
    previa = c.get("esperandoModelo") if isinstance(c.get("esperandoModelo"), dict) else None
    intentos = int(cambio.get("intentos") or 1)
    ultimo_sondeo = cambio.get("ultimoSondeo")
    if not isinstance(ultimo_sondeo, (int, float)) or isinstance(ultimo_sondeo, bool):
        ultimo_sondeo = previa.get("ultimoSondeo") if previa else None
    nuevo = {
        "rol": rol,
        "modelo": modelo,
        "desde": _min_marca(previa.get("desde") if previa and previa.get("modelo") == modelo else None, cambio.get("desde")) or cambio.get("ahora"),
        "ultimoSondeo": ultimo_sondeo,
        "proximoSondeo": cambio.get("proximoIntentoEn"),
        "pasoId": paso_en_curso(e, iteracion_id),
        "intentos": max(int(previa.get("intentos") or 0), intentos) if previa and previa.get("modelo") == modelo else intentos,
    }
    cambiado = nuevo != previa
    c["esperandoModelo"] = nuevo
    if c.get("estado") == "en_marcha":
        c["estado"] = "esperando_modelo"
        cambiado = True
    return cambiado


def anotar_sondeo(e: dict[str, Any], corrida_id: str, cambio: dict[str, Any]) -> bool:
    """El último sondeo al gateway y su resultado, en `esperandoModelo`."""
    c = _corrida(e, corrida_id)
    espera = c.get("esperandoModelo") if c else None
    if not isinstance(espera, dict):
        return False
    espera["ultimoSondeo"] = cambio.get("ultimoSondeo")
    if cambio.get("respondio"):
        espera["proximoSondeo"] = cambio.get("ahora")
    return True


def quitar_espera_modelo(e: dict[str, Any], corrida_id: str) -> bool:
    """El modelo volvió: la corrida deja de esperar y vuelve a en marcha (solo
    si seguía en `esperando_modelo`; una pausa o detención a mano se respetan)."""
    c = _corrida(e, corrida_id)
    if c is None:
        return False
    cambiado = False
    if c.get("esperandoModelo") is not None:
        c["esperandoModelo"] = None
        cambiado = True
    if c.get("estado") == "esperando_modelo":
        c["estado"] = "en_marcha"
        cambiado = True
    return cambiado


def _incidencia_pendiente(e: dict[str, Any], corrida_id: str, modelo: str) -> dict[str, Any] | None:
    for inc in e.get("incidencias", []) or []:
        if inc.get("corridaId") == corrida_id and inc.get("estado") == "pendiente" and inc.get("tipo") == TIPO_INCIDENCIA and inc.get("recurso") == modelo:
            return inc
    return None


def abrir_incidencia_sin_respuesta(e: dict[str, Any], corrida_id: str, datos: dict[str, Any]) -> bool:
    """Crea la incidencia `modelo_sin_respuesta` de la corrida para ese modelo,
    con la alternativa "ROSA2018 lo está resolviendo sola". False si ya había
    una pendiente (veinte llamadas en paralelo abren una sola)."""
    modelo = str(datos["modelo"])
    if _incidencia_pendiente(e, corrida_id, modelo) is not None:
        return False
    nombre = datos.get("nombre") or nombre_de_modelo(modelo)
    e.setdefault("incidencias", []).append(
        {
            "id": P.nuevo_id("inc"),
            "corridaId": corrida_id,
            "tipo": TIPO_INCIDENCIA,
            "titulo": f"{nombre} no responde",
            "detalle": str(datos.get("detalle") or ""),
            "recurso": modelo,
            "alternativa": datos.get("alternativa") or texto_alternativa(nombre),
            "estado": "pendiente",
            "creadaEn": int(datos.get("ahora") or P.ahora_ms()),
            "resueltaEn": None,
            "resolucion": None,
        }
    )
    return True


def actualizar_incidencia_sin_respuesta(e: dict[str, Any], corrida_id: str, datos: dict[str, Any]) -> bool:
    """Pone al día el detalle (intento N de M, siguiente intento, o agotado)."""
    inc = _incidencia_pendiente(e, corrida_id, str(datos["modelo"]))
    if inc is None:
        # Si por un reinicio no quedó abierta, se abre con el detalle actual.
        return abrir_incidencia_sin_respuesta(e, corrida_id, datos)
    detalle = str(datos.get("detalle") or "")
    if inc.get("detalle") == detalle:
        return False
    inc["detalle"] = detalle
    return True


def resolver_incidencia_sin_respuesta(e: dict[str, Any], corrida_id: str, datos: dict[str, Any]) -> bool:
    """El modelo volvió: la incidencia pasa a resuelta con el detalle de los
    intentos y la duración. False si no había ninguna pendiente."""
    inc = _incidencia_pendiente(e, corrida_id, str(datos["modelo"]))
    if inc is None:
        return False
    inc["estado"] = "resuelta"
    inc["resueltaEn"] = int(datos.get("ahora") or P.ahora_ms())
    inc["resolucion"] = str(datos.get("resolucion") or "Se resolvió sola: el modelo volvió a responder")
    inc["detalle"] = str(datos.get("detalle") or inc.get("detalle") or "")
    return True


# ---------------------------------------------------------------------------
# Los ganchos de una corrida (los que usa Ctx.llamar)
# ---------------------------------------------------------------------------


def ganchos_de_contexto(ctx: Any) -> Ganchos:
    """Ganchos que escriben en el estado de la corrida de `ctx` (rosa/bucle/
    pasos.py, clase Ctx): incidencia, evento, salud y espera por `ctx.mutar`.
    Cada gancho hace una sola mutación aunque toque dos claves."""
    corrida_id = ctx.corrida_id
    iteracion_id = getattr(ctx, "iteracion_id", None)

    def incidencia(accion: str, datos: dict[str, Any]) -> Any:
        if accion == "abrir":
            return ctx.mutar(lambda e: abrir_incidencia_sin_respuesta(e, corrida_id, datos), "incidencia")
        if accion == "actualizar":
            return ctx.mutar(lambda e: actualizar_incidencia_sin_respuesta(e, corrida_id, datos), "incidencia")
        if accion == "resolver":
            return ctx.mutar(lambda e: resolver_incidencia_sin_respuesta(e, corrida_id, datos), "incidencia")
        if accion == "bloqueo":
            ctx.incidencia("modelo_bloqueado", str(datos.get("titulo") or "Modelo bloqueado"), str(datos.get("detalle") or ""), str(datos.get("modelo") or ""), datos.get("alternativa"))
            return True
        return False

    def evento(tipo: str, texto: str) -> None:
        ctx.evento(tipo, texto, f"#/investigaciones/{ctx.investigacion_id}/corrida")

    def salud(rol: str, modelo: str, cambio: dict[str, Any]) -> None:
        fase = cambio.get("fase")

        def fn(e: dict[str, Any]) -> bool:
            resultados = [registrar_salud(e, rol, modelo, cambio)]
            if fase == "fallo":
                resultados.append(fijar_espera_modelo(e, corrida_id, iteracion_id, rol, modelo, cambio))
            elif fase == "sondeo":
                resultados.append(anotar_sondeo(e, corrida_id, cambio))
            elif fase == "ok" and cambio.get("recuperado"):
                resultados.append(quitar_espera_modelo(e, corrida_id))
            return any(resultados)

        ctx.mutar(fn, "salud_modelo")

    def espera_pendiente(rol: str, modelo: str) -> dict[str, Any] | None:
        return espera_pendiente_de(ctx.almacen.estado, corrida_id, modelo)

    def cerrar(rol: str, modelo: str, datos: dict[str, Any]) -> Any:
        return ctx.mutar(lambda e: cerrar_espera_si_no_sigue(e, corrida_id, {**datos, "rol": rol, "modelo": modelo}), "salud_modelo")

    return Ganchos(incidencia=incidencia, evento=evento, salud=salud, espera_pendiente=espera_pendiente, cerrar=cerrar)
