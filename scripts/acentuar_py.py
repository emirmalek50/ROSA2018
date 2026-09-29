"""Tildes y ñ en los textos en castellano del backend de ROSA2018.

Reutiliza el diccionario y las reglas de `frontend/scripts/acentuar.py`
(`acentuar_texto`) y los aplica a los literales de cadena de `rosa/` y
`tests/` que lee una persona: eventos, pistas, incidencias, dossier, frases
GRADE, mensajes del Killer, docstrings. Regla: una cadena se acentúa si tiene
un espacio y no parece código. Se deja tal cual si contiene `_ = { } $ / \\ < >`
o `palabra.palabra` (claves, rutas, plantillas, expresiones regulares), si
tiene pinta de SQL, o si está en inglés. En las f-strings y en las plantillas
de `format` solo se toca el texto fuera de las llaves, y lo que va entre
comillas invertidas (`sintetico`, `direccion` en un docstring) es un
identificador y se deja tal cual. Uso:

    python3 scripts/acentuar_py.py            # aplica
    python3 scripts/acentuar_py.py --seco     # solo cuenta y muestra ejemplos
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "frontend" / "scripts"))
from acentuar import acentuar_texto  # noqa: E402

CODIGO = re.compile(r"[_$/\\<>|*^\[\]]|\w\.\w|%[sdrf(]")
# `re.I`: el SQL de los tests va en minúsculas ("create table estado (...)") y sin
# esto se acentuaba el nombre de una columna, que es lo que rompe una base.
SQL = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|CREATE|TABLE|WHERE|FROM|PRAGMA|ORDER BY|VALUES)\b", re.I)
LLAVES = re.compile(r"(\{[^{}]*\})")
# Un tramo entre comillas invertidas dentro de una cadena o un docstring nombra un
# identificador (`sintetico`, `direccion`): acentuarlo rompería la referencia.
INVERTIDAS = re.compile(r"(`[^`\n]+`)")


def partir_llaves(cuerpo: str) -> list[str]:
    """Separa texto y expresiones {…} contando la profundidad de las llaves
    (una f-string puede llevar `{(inv or {}).get('titulo')}`); `{{` y `}}`
    son texto."""
    partes: list[str] = []
    actual = ""
    i = 0
    profundidad = 0
    while i < len(cuerpo):
        c = cuerpo[i]
        if profundidad == 0 and cuerpo.startswith(("{{", "}}"), i):
            actual += cuerpo[i : i + 2]
            i += 2
            continue
        if c == "{":
            if profundidad == 0:
                partes.append(actual)
                actual = ""
            profundidad += 1
            actual += c
        elif c == "}" and profundidad > 0:
            profundidad -= 1
            actual += c
            if profundidad == 0:
                partes.append(actual)
                actual = ""
        else:
            actual += c
        i += 1
    partes.append(actual)
    return partes


def acentuar_cuerpo(cuerpo: str, con_llaves: bool) -> str:
    if " " not in cuerpo:
        return cuerpo
    partes = partir_llaves(cuerpo) if con_llaves else [cuerpo]
    salida = []
    for parte in partes:
        if con_llaves and parte.startswith("{"):
            salida.append(parte)
            continue
        if CODIGO.search(parte) or SQL.search(parte):
            salida.append(parte)
            continue
        for tramo in INVERTIDAS.split(parte):
            salida.append(tramo if INVERTIDAS.fullmatch(tramo) else acentuar_texto(tramo))
    return "".join(salida)


PREFIJO = re.compile(r"^([fFrRbBuU]{0,2})(\"\"\"|'''|\"|')")


def acentuar_literal(literal: str) -> str:
    """Un token STRING completo (con prefijo y comillas)."""
    m = PREFIJO.match(literal)
    if not m:
        return literal
    prefijo, comillas = m.group(1), m.group(2)
    if "r" in prefijo.lower() or "b" in prefijo.lower():
        return literal
    cuerpo = literal[m.end() : len(literal) - len(comillas)]
    if "{" in cuerpo and "f" not in prefijo.lower() and re.search(r"\{\s*[\"']", cuerpo):
        return literal  # un JSON escrito a mano
    return f"{prefijo}{comillas}{acentuar_cuerpo(cuerpo, con_llaves='{' in cuerpo)}{comillas}"


# Claves cuyo valor es un IDENTIFICADOR y no un texto que alguien lee: se compara
# con el servidor o se busca en un diccionario. Igual que en el guion del frontend.
CLAVES_DE_IDENTIFICADOR = {"id", "de", "a", "clave", "capa", "rol", "tipo", "estado", "origen", "nombre", "key", "slug", "ruta", "veredicto", "clasificacion", "relacion", "accion", "decision"}


def acentuar_python(codigo: str, solo_docstrings: bool = False) -> str:
    """Recorre los tokens del fichero (tokenize sabe que es cadena y que es
    comentario o código, cosa que una expresión regular no) y reescribe solo
    los tokens STRING. Con Python 3.9 las f-strings son un solo token."""
    import io
    import tokenize

    lineas = codigo.split("\n")
    cambios: list[tuple[int, int, int, int, str, int]] = []
    tokens: list[Any] = []
    inicios: list[bool] = []
    empieza_linea = True
    try:
        for tok in tokenize.generate_tokens(io.StringIO(codigo).readline):
            if tok.type in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.COMMENT):
                # El siguiente token significativo EMPIEZA una línea lógica: es el
                # dato que distingue un docstring (primera cosa del cuerpo) de una
                # cadena que es el valor de una clave de diccionario, porque las dos
                # llevan un ":" delante.
                empieza_linea = True
                continue
            if tok.type != tokenize.STRING:
                tokens.append(tok)
                inicios.append(empieza_linea)
                empieza_linea = False
                continue
            # Una línea marcada con "# sin tildes" se respeta tal cual (por
            # ejemplo, el resultado esperado de una función que quita tildes).
            if "# sin tildes" in tok.line:
                continue
            tokens.append(tok)
            inicios.append(empieza_linea)
            empieza_linea = False
            nuevo = acentuar_literal(tok.string)
            if nuevo != tok.string:
                cambios.append((*tok.start, *tok.end, nuevo, len(tokens) - 1))
    except (tokenize.TokenError, SyntaxError):
        return codigo
    # Dos cosas que NO se tocan aunque el texto lo pida, y que hasta el 29 de
    # septiembre de 2026 se tocaban (por eso este guion corrompió identificadores
    # una vez, como avisa CLAUDE.md):
    #
    # - Una cadena seguida de ":" es una CLAVE de diccionario. El diccionario se
    #   busca por ella; acentuarla parte la búsqueda en dos.
    # - Una cadena cuya clave es de identificador ({"de": "funcion renal"}) es un
    #   valor que se compara con el servidor, no un texto que alguien lee.
    # Claves y argumentos con nombre cuyo valor SÍ es texto que alguien lee. El
    # resto de las cadenas del backend son datos: se comparan con `==` o con `in`,
    # se pasan como el nombre de un parámetro de pytest, o son la clave de un
    # diccionario. Acentuar una de esas rompe una comparación en silencio, que es
    # peor que dejar un texto sin tilde. Por eso la lista dice qué SÍ, no qué no.
    CLAVES_DE_TEXTO = {"texto", "motivo", "resumen", "detalle", "mensaje", "titulo", "título", "nota", "explicacion", "explicación", "descripcion", "descripción", "etiqueta", "contexto", "limitaciones", "aporta", "frase", "objetivo", "pregunta", "recomendacion", "recomendación", "advertencia", "razon", "razón", "justificacion", "justificación", "conclusion", "conclusión", "interpretacion", "interpretación", "falta", "queLaResolveria", "prediccion_falsable", "condicionParada"}

    def _es_texto_para_leer(i: int) -> bool:
        """La cadena está en un sitio donde solo puede ser texto que se lee."""
        anterior = tokens[i - 1] if i >= 1 else None
        if anterior is None:
            return True  # docstring de módulo
        # Docstring: primera cadena tras `:` de un def/class, o tras NEWLINE al inicio.
        if anterior.type == tokenize.OP and anterior.string == ":" and i >= 2:
            clave = tokens[i - 2]
            if clave.type == tokenize.STRING:
                return clave.string.strip("\"'fFrRbBuU") in CLAVES_DE_TEXTO
            return True  # `def f() -> None:` seguido de cadena: docstring
        # `texto=...` como argumento con nombre.
        if anterior.type == tokenize.OP and anterior.string == "=" and i >= 2 and tokens[i - 2].type == tokenize.NAME:
            return tokens[i - 2].string in CLAVES_DE_TEXTO
        # `print("...")` y `raise X("...")`: mensajes.
        if anterior.type == tokenize.OP and anterior.string == "(" and i >= 2 and tokens[i - 2].type == tokenize.NAME:
            return tokens[i - 2].string in ("print", "ValueError", "RuntimeError", "HTTPException", "EscritorObsoleto")
        # Cadena suelta detrás de otra cadena o de un salto: continuación de un
        # docstring o de un texto partido en varias líneas.
        return bool(anterior.type == tokenize.STRING)

    def _es_clave_o_identificador(i: int) -> bool:
        siguiente = tokens[i + 1] if i + 1 < len(tokens) else None
        if siguiente is not None and siguiente.type == tokenize.OP and siguiente.string == ":":
            return True
        if i >= 2 and tokens[i - 1].type == tokenize.OP and tokens[i - 1].string == ":":
            clave = tokens[i - 2]
            if clave.type == tokenize.STRING:
                return clave.string.strip("\"'fFrRbBuU") in CLAVES_DE_IDENTIFICADOR
        if i >= 2 and tokens[i - 1].type == tokenize.OP and tokens[i - 1].string == "=" and tokens[i - 2].type == tokenize.NAME:
            return tokens[i - 2].string in CLAVES_DE_IDENTIFICADOR
        return False

    def _es_docstring(i: int) -> bool:
        # Un docstring es la primera cosa de su línea lógica; el valor de una clave
        # de diccionario, no, aunque los dos lleven un ":" delante.
        return bool(inicios[i]) or (i >= 1 and tokens[i - 1].type == tokenize.STRING)

    if solo_docstrings:
        # En los tests, una cadena que no es docstring es un DATO: se compara con
        # `==` o con `in`, o es el valor que el test acaba de meter y luego lee.
        # Acentuar dos de las tres copias de un mismo literal deja el test roto, y
        # eso pasó de verdad el 29 de septiembre de 2026 con "progresion en
        # alzheimer". La prosa de los tests son sus docstrings, y esos sí.
        cambios = [c for c in cambios if _es_docstring(c[5])]
    cambios = [c for c in cambios if _es_texto_para_leer(c[5]) and not _es_clave_o_identificador(c[5])]
    # De atrás hacia delante para que las posiciones sigan valiendo.
    for f0, c0, f1, c1, nuevo, _ in reversed(cambios):
        if f0 == f1:
            l = lineas[f0 - 1]
            lineas[f0 - 1] = l[:c0] + nuevo + l[c1:]
        else:
            primera = lineas[f0 - 1][:c0]
            ultima = lineas[f1 - 1][c1:]
            lineas[f0 - 1 : f1] = (primera + nuevo + ultima).split("\n")
    return "\n".join(lineas)


def main() -> None:
    seco = "--seco" in sys.argv
    cambiados = 0
    ejemplos: list[str] = []
    for carpeta in ("rosa", "tests"):
        for f in sorted((RAIZ / carpeta).rglob("*.py")):
            antes = f.read_text(encoding="utf-8")
            despues = acentuar_python(antes, solo_docstrings="tests" in f.parts or f.name.startswith("test_"))
            if despues == antes:
                continue
            cambiados += 1
            if seco and len(ejemplos) < 40:
                for a, d in zip(antes.split("\n"), despues.split("\n")):
                    if a != d and len(ejemplos) < 40:
                        ejemplos.append(f"{f.relative_to(RAIZ)}: {d.strip()[:150]}")
            if not seco:
                f.write_text(despues, encoding="utf-8")
    print(f"{cambiados} ficheros {'cambiarían' if seco else 'con tildes nuevas'}")
    for e in ejemplos:
        print(" ", e)


if __name__ == "__main__":
    main()
