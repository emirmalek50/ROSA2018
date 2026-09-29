"""Trinquete de mypy: el backend arrancó con 265 errores de tipos (23 de
septiembre de 2026). No se exige cero de golpe; se exige no empeorar. Falla si
hay más errores que LIMITE, y avisa para bajar LIMITE cuando hay menos.

Uso, desde la raíz: `python3 scripts/trinquete_mypy.py` (necesita `uv`).
"""
from __future__ import annotations

import re
import subprocess
import sys

LIMITE = 263


def main() -> int:
    python = sys.executable
    salida = subprocess.run(
        ["uvx", "mypy", "--python-executable", python, "--no-incremental"],
        capture_output=True,
        text=True,
    )
    texto = salida.stdout + salida.stderr
    m = re.search(r"Found (\d+) errors?", texto)
    if m:
        n = int(m.group(1))
    elif "Success" in texto:
        n = 0
    else:
        print(texto)
        print("No se pudo leer el resultado de mypy.")
        return 2
    if n > LIMITE:
        print(texto)
        print(f"mypy: {n} errores, el límite es {LIMITE}. Este cambio añadió errores de tipos.")
        return 1
    if n < LIMITE:
        print(f"mypy: {n} errores (límite {LIMITE}). Baja LIMITE a {n} en scripts/trinquete_mypy.py.")
    else:
        print(f"mypy: {n} errores, igual que el límite.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
