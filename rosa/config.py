"""Configuración de ROSA2018: rutas, puertos y contacto para las APIs.

Todo lo que puede variar entre la Mac de la persona responsable y otra máquina vive aquí y se
lee del entorno (.env). Los valores por defecto sirven para arrancar sin
tocar nada: base de datos `rosa.db` en la raíz del repo, servidor en el
puerto 8765, MLflow en `mlflow.db`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

RAIZ = Path(__file__).resolve().parent.parent

RUTA_BD = Path(os.environ.get("ROSA_BD", RAIZ / "rosa.db"))
PUERTO = int(os.environ.get("ROSA_PUERTO", "8765"))
HOST = os.environ.get("ROSA_HOST", "127.0.0.1")
# Nombres de host con los que se sirve ROSA2018 fuera de localhost (coma separada).
# Sin comodines: es lo que frena el DNS rebinding cuando se escucha en 0.0.0.0.
HOSTS_PERMITIDOS = tuple(h.strip() for h in os.environ.get("ROSA_HOSTS", "").split(",") if h.strip())
MLFLOW_URI = os.environ.get("ROSA_MLFLOW_URI", f"sqlite:///{RAIZ / 'mlflow.db'}")
MLFLOW_UI = os.environ.get("ROSA_MLFLOW_UI", "http://127.0.0.1:5000")
# Trazas de cada llamada en MLflow: apagadas salvo para depurar (ROSA_MLFLOW_TRAZAS=1).
# Las de entrenamiento se guardan aparte, redactadas, en datos/_gepa (ver main.configurar_mlflow).
MLFLOW_TRAZAS = os.environ.get("ROSA_MLFLOW_TRAZAS", "").strip() == "1"
FRONTEND_DIST = RAIZ / "frontend" / "dist"

# Contacto que se manda a Crossref, Unpaywall y OpenAlex. Es público por
# diseño (piden un correo real para el "polite pool").
CORREO_CONTACTO = os.environ.get("ROSA_CORREO", "contacto-interno@example.invalid")
USER_AGENT = f"ROSA2018/0.1 (Alzheimer Project; mailto:{CORREO_CONTACTO})"

# Claves opcionales de fuentes. Sin ellas ROSA2018 funciona con los cupos públicos.
CLAVE_NCBI = os.environ.get("ROSA_NCBI_KEY", "")
CLAVE_OPENALEX = os.environ.get("ROSA_OPENALEX_KEY", "")
CLAVE_S2 = os.environ.get("ROSA_S2_KEY", "")
# Exa (exa.ai): búsqueda semántica de publicaciones. Sin clave, ROSA2018 no la usa
# y los conectores de Exa quedan en el catálogo como "requiere cuenta".
CLAVE_EXA = os.environ.get("ROSA_EXA_KEY", "")
# Google Patents mediante SerpApi, proveedor externo de búsqueda. La clave
# también se puede configurar desde Ajustes, sin reiniciar el servidor.
CLAVE_SERPAPI = (os.environ.get("ROSA_SERPAPI_KEY", "") or os.environ.get("SERPAPI_API_KEY", "")
                 or os.environ.get("SERPAPI_KEY", "") or os.environ.get("serp_api", ""))
# Token de acceso a la API. Obligatorio si el servidor escucha fuera de 127.0.0.1:
# sin él, cualquier equipo de la red podría arrancar corridas y gastar en el gateway.
ROSA_TOKEN = os.environ.get("ROSA_TOKEN", "")
# Acceso inicial de ROSA2018. La contraseña nunca vive en el código: este valor es
# una huella scrypt guardada exclusivamente en .env.
ROSA_LOGIN_EMAIL = os.environ.get("ROSA_LOGIN_EMAIL", "").strip().lower()
ROSA_LOGIN_PASSWORD_HASH = os.environ.get("ROSA_LOGIN_PASSWORD_HASH", "").strip().lower()
# Preguntas con herramientas (ReAct) por día: cuestan llamadas al cerebro y no
# pasan por el presupuesto de una corrida.
PREGUNTAS_MAX_DIA = int(os.environ.get("ROSA_PREGUNTAS_MAX_DIA", "40"))
# Espejo del estado en Convex (opcional): URL del deployment y clave de despliegue. Solo en .env.
CONVEX_URL = os.environ.get("CONVEX_URL", "").rstrip("/")
CONVEX_DEPLOY_KEY = os.environ.get("CONVEX_DEPLOY_KEY", "")

# Directorio donde se guardan los PDF descargados (texto completo por página).
DIR_PDFS = Path(os.environ.get("ROSA_PDFS", RAIZ / "pdfs"))

# Quien firma lo que hace ROSA2018 en los historiales.
# Valor que se guarda como autor en el estado (revisiones, historial, cuestiones):
# es un identificador de datos (570 registros reales lo llevan), así que no cambia
# aunque el nombre visible del producto sea ROSA2018 (petición de Emir, 18 de
# septiembre de 2026). La interfaz lo traduce al mostrarlo (nombreActor en etiquetas.ts).
QUIEN_ROSA = "Rosa"

# Presupuesto por defecto de una corrida nueva, en llamadas al modelo.
# Una iteración completa cuesta entre 120 y 250 llamadas (medido); 1500 da
# margen para varias iteraciones antes de que la corrida se pause y pregunte.
PRESUPUESTO_CORRIDA = int(os.environ.get("ROSA_PRESUPUESTO", "1500"))
ALERTAS_PRESUPUESTO = [0.5, 0.8, 0.95]
PRESUPUESTO_ITERACION = int(os.environ.get("ROSA_PRESUPUESTO_ITERACION", "300"))

# Precios de respaldo por millón de tokens (entrada, salida) en dólares, para
# cuando una llamada llega sin el coste del gateway. Actualizados el 17 de
# septiembre de 2026 (hallazgo S-19: la tabla anterior, 5/20, 15/75 y 3/15,
# hacía que ROSA2018 mostrara el doble del coste real y que el presupuesto de 60
# dólares de la misión cortara a los 30). Ajustados por mínimos cuadrados sobre
# 1.980 trazas de GEPA con `usage.cost`: Sonnet 5 y Opus 5 salen exactos; GPT-6
# Astra es aproximado (no es lineal por la caché de entrada; residuo de 0,10
# dólares por llamada), así que el coste que manda es siempre el del gateway.
# Se pueden sobreescribir con ROSA_PRECIOS='{"openai/gpt-6-astra": [12.08, 50.99], ...}'.
PRECIOS_FECHA = "2026-09-17"
_PRECIOS_POR_DEFECTO = {
    "openai/gpt-6-astra": (12.08, 50.99),
    "anthropic/claude-opus-5": (5.0, 25.0),
    "anthropic/claude-sonnet-5": (2.0, 10.0),
    # Sonnet 5.5: catálogo del AI Gateway comprobado el 8 de octubre de 2026.
    "anthropic/claude-sonnet-5.5": (2.0, 10.0),
}
try:
    import json as _json

    PRECIOS = {k: tuple(v) for k, v in _json.loads(os.environ.get("ROSA_PRECIOS", "{}")).items()} or dict(_PRECIOS_POR_DEFECTO)
except Exception:  # noqa: BLE001
    PRECIOS = dict(_PRECIOS_POR_DEFECTO)


def coste_usd(modelo: str, tokens_entrada: int, tokens_salida: int) -> float:
    """Coste estimado por la tabla de respaldo. Preferir `coste_desde_uso`."""
    # DSPy nombra los modelos del gateway como "openai/anthropic/claude-opus-5":
    # se quita el prefijo del proveedor compatible antes de buscar el precio.
    limpio = modelo.removeprefix("openai/") if modelo.count("/") > 1 else modelo
    entrada, salida = PRECIOS.get(modelo) or PRECIOS.get(limpio) or PRECIOS.get(modelo.split("/")[-1]) or _PRECIOS_POR_DEFECTO["openai/gpt-6-astra"]
    return (tokens_entrada * entrada + tokens_salida * salida) / 1_000_000


def coste_desde_uso(uso: Any, modelo: str) -> tuple[float, bool]:
    """(coste en dólares, es_real). El AI Gateway devuelve en `usage` el campo
    `cost` (lo facturado por esa llamada; también `market_cost` y
    `gateway_cost`). Si viene y es un número mayor que cero, manda; si no
    (usage vacío, sin `cost`, cero, texto raro), se cae a la tabla de respaldo
    con `prompt_tokens` y `completion_tokens` y `es_real` es False. Lo llaman
    `Contador.on_lm_end` (rosa/modulos/contador.py) y `gepa_continuo.on_lm_end`.
    Nunca lanza: un `usage` que no sea un diccionario cuenta como vacío."""
    u = uso if isinstance(uso, dict) else {}
    coste = u.get("cost")
    try:
        if coste is not None and not isinstance(coste, bool):
            valor = float(coste)
            if valor > 0 and valor == valor and valor != float("inf"):
                return round(valor, 6), True
    except (TypeError, ValueError):
        pass

    def _entero(v: Any) -> int:
        try:
            return max(int(v or 0), 0)
        except (TypeError, ValueError):
            return 0

    return round(coste_usd(str(modelo or ""), _entero(u.get("prompt_tokens")), _entero(u.get("completion_tokens"))), 6), False
