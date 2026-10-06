"""Contrato compartido para traducir ciencia sin cambiar sus datos.

Las fuentes y los términos revisados viven en JSON, leído también por el
frontend. Estas barreras detectan pérdidas concretas; no certifican por sí
solas la equivalencia semántica de una traducción.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

CONTRATO = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
REVISADAS: dict[str, str] = CONTRATO["traducciones"]
REGLAS = [
    (r["id"], re.compile(r["es"], re.I), re.compile(r["en"], re.I))
    for r in CONTRATO["reglas"]
]
NUMERO = r"(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:[eE][+\-]?\d+)?"
CIFRAS = re.compile(r"[+\-−]?" + NUMERO)
PROTEGIDOS = re.compile(
    r'\b(?:NCT\d{8}|PMID\s*:?\s*\d+|(?:ENSG|ENST|ENSP)\d+(?:\.\d+)?|(?:NM|NR|NP|XM|XR|XP)_\d+(?:\.\d+)?)\b|\b10\.\d{4,9}/[^\s\]<>"}]+|https?://[^\s\]<>"}]+|\b[ACGTU]{6,}\b|\bp-tau\d+\b'
)
IDENTIFICADORES = re.compile(
    r"(?<![A-Za-z0-9_])[A-Z][A-Za-z]*\d+[A-Za-z0-9]*(?![A-Za-z0-9_])"
)
LITERALES = re.compile(r"```[\s\S]*?```|`[^`\n]+`")

SIMBOLOS = [
    (s, re.compile(r"(?<![A-Za-z0-9_])" + re.escape(s) + r"(?![A-Za-z0-9_])"))
    for s in CONTRATO["simbolos"]
]
UNIDADES: dict[str, str] = CONTRATO["unidades"]
ALTERNATIVAS = "|".join(
    re.escape(u).replace(r"\ ", r"\s+") for u in sorted(UNIDADES, key=len, reverse=True)
)
CANTIDADES = re.compile(
    r"(?<!\w)([+\-−]?"
    + NUMERO
    + r"|\{\w+\})\s*(?:-\s*)?("
    + ALTERNATIVAS
    + r")((?:\s*/\s*(?:"
    + ALTERNATIVAS
    + r"))*)(?!\w)"
)
COMPARADOR = re.compile(r"(<=|>=|[<>≤≥])\s*([+\-−]?" + NUMERO + ")")
EXCEPCIONES = {(e["valor"], e["unidad"]) for e in CONTRATO["excepciones_unidades"]}


def numero_canonico(t: str, *, ingles: bool = False) -> str:
    """Permite coma decimal y ceros finales, sin convertir unidades ni miles."""
    if ingles and "," in t:
        # En inglés 1,500 significa mil quinientos, no 1.5. Un separador
        # inválido se rechaza, nunca se interpreta como decimal por comodidad.
        if not re.fullmatch(
            r"[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+\-]?\d+)?", t
        ):
            return "formato numérico ambiguo: " + t
        t = t.replace(",", "")
    t = t.replace("−", "-").replace(",", ".").lower().lstrip("+")
    # No reinterpretar fechas, versiones ni agrupaciones con varios puntos.
    if t.count(".") > 1 or "e" in t:
        return t
    signo = "-" if t.startswith("-") else ""
    t = t.lstrip("-")
    entero, _, decimales = t.partition(".")
    entero = entero.lstrip("0") or "0"
    decimales = decimales.rstrip("0")
    n = entero + ("." + decimales if decimales else "")
    return (signo if n != "0" else "") + n


def contexto_numerico(texto: str) -> str:
    # IC95% y 95% CI nombran la misma medida. ROSA2018 es la marca, no un dato.
    return re.sub(r"\b(?:IC|CI)(?=\d+%)", "", texto).replace("ROSA2018", "ROSA")


def cifras(texto: str, *, ingles: bool = False) -> list[str]:
    # Los dígitos de TREM2, R47H o un DOI pertenecen al identificador literal;
    # no son cantidades y pueden cambiar de posición al traducir la frase.
    texto = CONTRATO["normalizaciones_cifras"].get(texto, texto)
    if texto.split("\n", 1)[0] in CONTRATO["cabeceras_csv"]:
        texto = texto.replace(",", " ")
    texto = re.sub(r"\{\w+\}", " ", contexto_numerico(texto))
    for patron in (LITERALES, PROTEGIDOS, IDENTIFICADORES):
        texto = patron.sub(" ", texto)
    return [numero_canonico(m[0], ingles=ingles) for m in CIFRAS.finditer(texto)]


def invariantes(original: str, traducido: str) -> str | None:
    """Cifras, datos literales, unidades y términos verificables por regla."""
    if Counter(re.findall(r"\{(\w+)\}", original)) != Counter(
        re.findall(r"\{(\w+)\}", traducido)
    ):
        return "los huecos no coinciden"
    if cifras(original) != cifras(traducido, ingles=True):
        return "las cifras o su orden cambiaron"
    for patron in (PROTEGIDOS, LITERALES):
        if Counter(patron.findall(original)) != Counter(patron.findall(traducido)):
            return "cambió un identificador, enlace, secuencia o código literal"
    if Counter(IDENTIFICADORES.findall(contexto_numerico(original))) != Counter(
        IDENTIFICADORES.findall(contexto_numerico(traducido))
    ):
        return "cambió un identificador alfanumérico"
    for simbolo, patron in SIMBOLOS:
        if len(patron.findall(original)) != len(patron.findall(traducido)):
            return f"cambió el símbolo {simbolo}"

    def unidad(t: str) -> str:
        return UNIDADES.get(re.sub(r"\s+", " ", t), "")

    def medidas(
        texto: str, *, ingles: bool = False
    ) -> list[tuple[str, str, tuple[str, ...]]]:
        return [
            (
                numero_canonico(m[1], ingles=ingles),
                unidad(m[2]),
                tuple(unidad(u.strip()) for u in m[3].split("/")[1:]),
            )
            for m in CANTIDADES.finditer(contexto_numerico(texto))
            if (m[1], m[2]) not in EXCEPCIONES
        ]

    if Counter(medidas(original)) != Counter(medidas(traducido, ingles=True)):
        return "cambió una cantidad o su unidad"

    def limites(texto: str, *, ingles: bool = False) -> list[tuple[str, str]]:
        return [
            (
                op.replace("≤", "<=").replace("≥", ">="),
                numero_canonico(n, ingles=ingles),
            )
            for op, n in COMPARADOR.findall(texto)
        ]

    if limites(original) != limites(traducido, ingles=True):
        return "cambió un umbral o el sentido de una desigualdad"
    es = "".join(
        c
        for c in unicodedata.normalize("NFD", re.sub(r"\{\w+\}", " ", original))
        if not unicodedata.combining(c)
    )
    for nombre, patron_es, patron_en in REGLAS:
        if patron_es.search(es) and not patron_en.search(traducido):
            return f"terminología incorrecta: {nombre}"
    return None
