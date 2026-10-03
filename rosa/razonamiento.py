"""El razonamiento de una pregunta del chat, paso a paso y mientras ocurre.

(No confundir con rosa/progreso.py, que es el progreso de una CORRIDA por
iteraciones: esto es solo la línea de tiempo de una pregunta del chat.)

Para qué: la pregunta con herramientas es un ReAct (rosa/herramientas.py
preguntar): el modelo piensa, elige una herramienta, la usa, lee lo que
devolvió y vuelve a pensar. Hasta ahora el navegador no se enteraba de nada
hasta el final y enseñaba «Consultando...» con un reloj. Esto escucha cada
vuelta del bucle y la deja donde el navegador la puede pedir, que es lo que
hace Kimi con su línea de tiempo (pedido por Emir, 2 de octubre de 2026).

Cómo se engancha, que es lo delicado: con los callbacks de DSPy
(`on_module_end` da el pensamiento y la herramienta elegida; `on_tool_start`
y `on_tool_end`, la llamada). Se ponen desde fuera con `dspy.context`, así
que no hay que tocar el ReAct. PERO `dspy.context(callbacks=[...])`
SUSTITUYE la lista entera, y rosa/main.py registra la suya con el contador
de coste: hay que sumar este a los que ya hay (`callbacks_con`), o las
preguntas del chat dejarían de contarse en el gasto sin que nada avisara.

Lo que NO es: un pensamiento del modelo no es un hecho comprobado. Es lo que
el modelo dice que va a hacer. Se enseña como «pensando», nunca como
evidencia, y lo que sí está registrado (la consulta con su base, sus
argumentos y su resultado) va aparte, en `consultas`.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any

import dspy
from dspy.utils.callback import BaseCallback

from rosa import conectores as CON

# Lo que se guarda de cada texto. El pensamiento entero puede ser largo; en la
# línea de tiempo se ve una frase y se despliega el resto.
MAX_PENSAMIENTO = 600
MAX_ARGUMENTO = 300
MAX_RESUMEN = 200
# Un seguimiento que nadie consulta en este tiempo se tira.
CADUCA_S = 15 * 60
# Ni la herramienta de cerrar ni sus pensamientos vacíos son un paso.
NO_ES_PASO = {"finish"}

# Lo que no es un conector pero sí es una herramienta del chat.
PROPIAS = {
    "leer_modelo_de_mundo": ("mundo", "el modelo de mundo"),
    "buscar_en_proyecto": ("proyecto", "el proyecto"),
    "leer_cuestiones": ("cuestiones", "las cuestiones abiertas"),
}

_ID_VALIDO = re.compile(r"[a-zA-Z0-9-]{8,48}")


def familia_y_nombre(herramienta: str) -> tuple[str, str]:
    """Qué clase de herramienta es (para el icono) y cómo se llama en llano."""
    if herramienta in PROPIAS:
        return PROPIAS[herramienta]
    c = CON.REGISTRO.get(herramienta)
    if c is not None:
        return "base", str(getattr(c, "fuente", "") or herramienta)
    return "otra", herramienta.replace("_", " ")


def _en_llano(texto: str, fuente: str, n: int | None) -> str:
    """Lo que trajo la herramienta, en UNA frase legible para el sub-paso de
    la línea de tiempo (el «• Audit RAG System Components...» de Kimi). La
    salida de una herramienta es JSON delimitado o texto largo: pintarlo tal
    cual deja «{"lecturas": {"eliminacion_dataset"...» en pantalla, que es
    lo que pasó la primera vez que se probó en vivo (2 de octubre de 2026).

    Con fuente y n se dice eso, que es lo que importa. Sin ellos, la primera
    línea de texto que no sea una marca ni empiece por llave o corchete; y si
    no la hay, nada: mejor sin sub-paso que con datos crudos."""
    if fuente and n is not None:
        return f"{fuente}: {n} resultado" + ("" if n == 1 else "s")
    if fuente:
        return fuente
    limpio = texto.replace("<<<DATO_RECUPERADO>>>", " ").replace("<<<FIN_DATO_RECUPERADO>>>", " ")
    for linea in limpio.splitlines():
        t = linea.strip()
        if not t or t[0] in "{[\"'" or t.startswith(("Error", "ARGUMENTOS")):
            continue
        # Una frase: hasta el primer punto si lo hay dentro de un largo razonable.
        m = re.match(r"(.{12,160}?[.!?])(\s|$)", t)
        return (m.group(1) if m else t[:140]).strip()
    return ""


def _fuente_y_n(texto: str) -> tuple[str, int | None]:
    """La fuente y el número de resultados de la salida de un conector, que
    `rosa/herramientas.py` devuelve como dato delimitado con las claves
    `fuente` y `n`. Si no están (búsqueda en el proyecto, modelo de mundo),
    nada: la fila se pinta sin avatar ni cuenta, no con uno inventado."""
    m_f = re.search(r"""["']fuente["']\s*:\s*["']([^"']{1,60})["']""", texto)
    m_n = re.search(r"""["']n["']\s*:\s*(\d{1,7})\b""", texto)
    return (m_f.group(1) if m_f else ""), (int(m_n.group(1)) if m_n else None)


def _recortar(t: Any, n: int) -> str:
    s = re.sub(r"\s+", " ", str(t or "")).strip().replace("\u2014", ", ")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _argumentos(inputs: Any) -> dict[str, str]:
    """Los argumentos de la llamada, planos y recortados. DSPy los pasa como
    {"kwargs": {...}} o directamente como el dict."""
    d = inputs.get("kwargs", inputs) if isinstance(inputs, dict) else {}
    if not isinstance(d, dict):
        return {}
    return {str(k)[:40]: _recortar(v, MAX_ARGUMENTO) for k, v in d.items() if v not in (None, "")}


class Progreso(BaseCallback):
    """Los pasos de UNA pregunta. Los callbacks pueden llegar desde hilos
    distintos (las herramientas síncronas corren en un hilo aparte), así que
    todo va bajo un candado."""

    def __init__(self) -> None:
        self._candado = threading.Lock()
        self._pasos: list[dict[str, Any]] = []
        self._por_llamada: dict[str, dict[str, Any]] = {}
        self.terminado = False
        self.tocado = time.time()

    # --- lo que da DSPy ---------------------------------------------------
    def on_module_end(self, call_id: str, outputs: Any | None, exception: Exception | None = None) -> None:
        pensado = getattr(outputs, "next_thought", None) if outputs is not None else None
        if not pensado:
            return
        siguiente = str(getattr(outputs, "next_tool_name", "") or "")
        with self._candado:
            if self.terminado:
                return
            self._pasos.append(
                {
                    "id": f"p{len(self._pasos) + 1}",
                    "tipo": "pensar",
                    "texto": _recortar(pensado, MAX_PENSAMIENTO),
                    # Si con esto da la respuesta por cerrada, se dice: es el
                    # último pensamiento antes de escribir.
                    "cierra": siguiente == "finish",
                    "inicio": int(time.time() * 1000),
                }
            )
            self.tocado = time.time()

    def on_tool_start(self, call_id: str, instance: Any, inputs: dict[str, Any]) -> None:
        nombre = str(getattr(instance, "name", "") or "")
        if not nombre or nombre in NO_ES_PASO:
            return
        familia, legible = familia_y_nombre(nombre)
        paso = {
            "id": f"p{len(self._pasos) + 1}",
            "tipo": "herramienta",
            "herramienta": nombre,
            "familia": familia,
            "nombre": legible,
            "argumentos": _argumentos(inputs),
            "inicio": int(time.time() * 1000),
            "fin": None,
            "error": None,
            "resumen": "",
            # Lo que trajo, para la fila: de qué base y cuántos resultados.
            # Es el «6 pages» con los avatares de Kimi.
            "fuente": "",
            "n": None,
        }
        with self._candado:
            if self.terminado:
                return
            self._pasos.append(paso)
            self._por_llamada[call_id] = paso
            self.tocado = time.time()

    def on_tool_end(self, call_id: str, outputs: Any | None, exception: Exception | None = None) -> None:
        with self._candado:
            paso = self._por_llamada.pop(call_id, None)
            if paso is None:
                return
            paso["fin"] = int(time.time() * 1000)
            texto = str(outputs or "")
            # Las herramientas de ROSA2018 no lanzan: devuelven el fallo como
            # texto («Error: ...», «No respondió...»). Se marca para que la
            # línea de tiempo diga «no pude comprobar», no «sin resultados».
            if exception is not None or re.match(r"\s*(error|no respond|tiempo agotado|fall[oó])", texto, re.I):
                paso["error"] = _recortar(str(exception) if exception else texto, MAX_RESUMEN)
            else:
                fuente, n = _fuente_y_n(texto)
                if fuente:
                    paso["fuente"] = fuente
                if n is not None:
                    paso["n"] = n
                paso["resumen"] = _en_llano(texto, fuente, n)
            self.tocado = time.time()

    # --- lo que pide el servidor ------------------------------------------
    def pasos(self) -> list[dict[str, Any]]:
        with self._candado:
            return [dict(p, argumentos=dict(p.get("argumentos", {}))) if p["tipo"] == "herramienta" else dict(p) for p in self._pasos]

    def cerrar(self) -> None:
        with self._candado:
            # Una llamada que nunca terminó (la pregunta se cortó por tiempo)
            # no se queda «en marcha» para siempre.
            ahora = int(time.time() * 1000)
            for p in self._por_llamada.values():
                p["fin"] = ahora
                p["error"] = p["error"] or "no terminó: la pregunta se cortó antes"
            self._por_llamada.clear()
            self.terminado = True
            self.tocado = time.time()


def callbacks_con(progreso: Progreso) -> list[Any]:
    """Los callbacks que ya hay MÁS este. `dspy.context(callbacks=...)`
    sustituye la lista, y en ella va el contador de coste de rosa/main.py."""
    return [*list(dspy.settings.get("callbacks", None) or []), progreso]


# --- el registro de seguimientos en curso ---------------------------------
_SEGUIMIENTOS: dict[str, Progreso] = {}
_CANDADO = threading.Lock()


def id_valido(s: Any) -> str | None:
    s = str(s or "").strip()
    return s if _ID_VALIDO.fullmatch(s) else None


def abrir(seguimiento: str) -> Progreso:
    p = Progreso()
    with _CANDADO:
        _purgar()
        _SEGUIMIENTOS[seguimiento] = p
    return p


def leer(seguimiento: str) -> dict[str, Any] | None:
    with _CANDADO:
        _purgar()
        p = _SEGUIMIENTOS.get(seguimiento)
    if p is None:
        return None
    return {"pasos": p.pasos(), "terminado": p.terminado}


def _purgar() -> None:
    limite = time.time() - CADUCA_S
    for k in [k for k, v in _SEGUIMIENTOS.items() if v.tocado < limite]:
        del _SEGUIMIENTOS[k]
