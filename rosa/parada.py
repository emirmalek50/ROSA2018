"""Que parte de una condicion de parada puede automatizar ROSA2018.

La persona escribe la condicion en lenguaje corriente ("3 iteraciones o
cuando el modelo de mundo deje de cambiar"). El bucle solo puede medir tres
cosas: un numero de iteraciones, un tiempo de corrida y un numero de
llamadas al modelo (mas el presupuesto de la mision en dolares y horas). Lo
demas lo decide la persona con el boton de detener. Esta funcion dice, al
escribirla, que quedo automatizado y que no, para que la interfaz lo
muestre en vez de prometer mas de lo que hace. Espejo en
`frontend/src/lib/parada.ts`.
"""

from __future__ import annotations

import re
from typing import Any

_ITERACIONES = re.compile(r"(?<![\d.,+\-])\b(\d+)\s*(?:iteraci[oó]n(?:es)?|iterations?)\b")
_TIEMPO = re.compile(r"(?<![\d.,+\-])\b(\d+(?:[.,]\d+)?)\s*(min|minutes?|minutos?|hours?|horas?|h|d[ií]as?|days?)\b")
_LLAMADAS = re.compile(r"(?<![\d.,+\-])\b(\d+)\s*(?:llamadas?|calls?)\b")


def partes_automatizadas(texto: str) -> dict[str, Any]:
    """{iteraciones, tiempo, llamadas, resto, automatizada}. `resto` es lo que
    queda de la condición una vez quitadas las partes medibles; si no está
    vacío, esa parte la decide una persona."""
    t = (texto or "").lower()
    salida: dict[str, Any] = {"iteraciones": None, "tiempo": None, "llamadas": None, "resto": "", "automatizada": False}
    resto = t
    m = _ITERACIONES.search(t)
    if m:
        salida["iteraciones"] = int(m.group(1))
        resto = resto.replace(m.group(0), " ")
    m = _TIEMPO.search(t)
    if m:
        unidad = m.group(2)
        salida["tiempo"] = f"{m.group(1)} {'min' if unidad.startswith('min') else 'h' if unidad in ('h', 'hora') or unidad.startswith(('hor', 'hour')) else 'd'}"
        resto = resto.replace(m.group(0), " ")
    m = _LLAMADAS.search(t)
    if m:
        salida["llamadas"] = int(m.group(1))
        resto = resto.replace(m.group(0), " ")
    # El resto se conserva tal como lo escribio la persona: solo se limpian los
    # conectores sueltos de los bordes ("o", ", o", "y") y los espacios dobles.
    resto = re.sub(r"\s+", " ", resto).strip(" ,;.")
    resto = re.sub(r"^(o|y|u|e|or|and|,|;)\s+", "", resto).strip(" ,;.")
    resto = re.sub(r"\s+(o|y|u|e|or|and)$", "", resto).strip(" ,;.")
    salida["resto"] = resto if len(resto) >= 4 else ""
    salida["automatizada"] = any(salida[k] is not None for k in ("iteraciones", "tiempo", "llamadas"))
    return salida


def texto_automatizacion(partes: dict[str, Any]) -> str:
    """Una frase para la interfaz y el informe."""
    medibles = []
    if partes.get("iteraciones") is not None:
        medibles.append(f"{partes['iteraciones']} iteraciones")
    if partes.get("tiempo"):
        medibles.append(f"{partes['tiempo']} de corrida")
    if partes.get("llamadas") is not None:
        medibles.append(f"{partes['llamadas']} llamadas")
    if not medibles:
        return "ROSA2018 no puede medir esta condición: la corrida sigue hasta que la detengas o hasta agotar el presupuesto de la misión."
    frase = "ROSA2018 para sola al llegar a " + " o ".join(medibles) + " (y al agotar el presupuesto de la misión)"
    if partes.get("resto"):
        frase += f'. El resto ("{partes["resto"][:80]}") lo decides tu con el botón de detener'
    return frase + "."


# ---------------------------------------------------------------------------
# Parada por corrida (15 de septiembre de 2026): al crear una corrida nueva la
# persona puede fijar cuánto debe durar como mucho (horas), cuántas
# iteraciones, cuántas llamadas, o una condición en texto. Se detiene con lo
# que llegue primero, y la condición de parada de la investigación sigue
# valiendo además. Todo opcional: sin nada, la corrida se comporta como antes.
# ---------------------------------------------------------------------------

LIMITES_PARADA = {"horas": (1 / 60, 24 * 14), "iteraciones": (1, 200), "llamadas": (10, 100_000), "cuantas": (1, 50), "sinCambio": (1, 20)}
NIVELES_OBJETIVO = ("baja", "moderada", "alta")


def normalizar_parada(d: Any) -> dict[str, Any] | None:
    """La parada tal como la guarda la corrida: números acotados o None, texto
    recortado. None si no hay ninguna condición."""
    if not isinstance(d, dict):
        return None
    salida: dict[str, Any] = {"horas": None, "iteraciones": None, "llamadas": None, "texto": "", "certeza": None, "cuantas": None, "sinCambio": None}
    for clave, (minimo, maximo) in LIMITES_PARADA.items():
        v = d.get(clave)
        if v in (None, "", False):
            continue
        try:
            n = float(str(v).replace(",", "."))
        except ValueError:
            continue
        if n <= 0:
            continue
        n = max(minimo, min(maximo, n))
        salida[clave] = n if clave == "horas" else int(n)
    texto = d.get("texto")
    if isinstance(texto, str) and texto.strip():
        salida["texto"] = texto.strip()[:300]
    certeza = d.get("certeza")
    if isinstance(certeza, str) and certeza in NIVELES_OBJETIVO:
        salida["certeza"] = certeza
        salida["cuantas"] = salida["cuantas"] or 1
    else:
        salida["cuantas"] = None  # cuantas solo tiene sentido con un nivel de certeza
    if salida["horas"] is None and salida["iteraciones"] is None and salida["llamadas"] is None and not salida["texto"] and salida["certeza"] is None and salida["sinCambio"] is None:
        return None
    return salida


def _horas_texto(h: float) -> str:
    if h >= 24 and (h / 24).is_integer():
        return f"{h / 24:g} {'día' if h == 24 else 'días'}"
    if h < 1:
        m = int(round(h * 60))
        return f"{m} minutos" if m != 1 else "1 minuto"
    return f"{h:g} {'hora' if h == 1 else 'horas'}"


def resumen_parada(p: dict[str, Any] | None) -> str:
    """Una línea para la persona y para el plan: '2 horas o 6 iteraciones, lo
    que llegue primero'."""
    if not p:
        return ""
    partes = []
    if p.get("horas"):
        partes.append(_horas_texto(float(p["horas"])))
    if p.get("iteraciones"):
        partes.append(f"{p['iteraciones']} {'iteración' if p['iteraciones'] == 1 else 'iteraciones'}")
    if p.get("llamadas"):
        partes.append(f"{p['llamadas']} llamadas al modelo")
    if p.get("certeza"):
        n = int(p.get("cuantas") or 1)
        partes.append(f"{n} {'hipótesis' } en certeza {str(p['certeza']).replace('_', ' ')}" if n > 1 else f"una hipótesis en certeza {str(p['certeza']).replace('_', ' ')}")
    if p.get("sinCambio"):
        partes.append(f"{p['sinCambio']} {'iteración' if p['sinCambio'] == 1 else 'iteraciones'} sin avance")
    if p.get("texto"):
        partes.append(f"«{p['texto']}»")
    if not partes:
        return ""
    return partes[0] if len(partes) == 1 else ", ".join(partes[:-1]) + " o " + partes[-1] + ", lo que llegue primero"


def texto_condicion(inv: dict[str, Any], c: dict[str, Any] | None) -> str:
    """La condición completa que ve el planificador: la de esta corrida (si la
    hay) y la de la investigación en lo que esta corrida no fija. Lo que la
    persona fija para la corrida manda en su eje (tiempo, iteraciones, llamadas);
    el resto de la condición general sigue valiendo. El tiempo se cuenta como
    tiempo de trabajo: la espera a una persona y las pausas del equipo no cuentan."""
    propia = resumen_parada((c or {}).get("parada"))
    base = (inv.get("condicionParada") or "").strip() or "Sin condición de parada declarada"
    if not propia:
        return base
    return f"Esta corrida: como mucho {propia} (tiempo de trabajo, sin contar esperas). La condición de la investigación sigue valiendo en lo que esta corrida no fija: {base}"
