"""Escaneo de secretos: busca en los ficheros del repo los prefijos de claves
que CLAUDE.md prohíbe commitear. Sale con 1 si encuentra alguno.

Uso, desde la raíz: `python3 scripts/escanear_secretos.py` (revisa los
ficheros que sigue git más los que están en el índice).
"""
from __future__ import annotations

import re
import subprocess
import sys

# Un prefijo solo cuenta si le sigue un cuerpo de clave, para no saltar con la
# lista de prefijos escrita en la documentación.
PREFIJOS = ["sk-proj-", "sb_secret_", "vcp_", "vck_", "github_pat_", "ghp_", "eyJhbGci", "eyJ2MiI6", "ntn_", "secret_", "GOCSPX-"]
PATRON = re.compile("(" + "|".join(re.escape(p) for p in PREFIJOS) + r")[A-Za-z0-9_\-]{16,}")


def main() -> int:
    ficheros = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    hallazgos = []
    for ruta in filter(None, ficheros):
        try:
            with open(ruta, encoding="utf-8") as f:
                for n, linea in enumerate(f, 1):
                    for m in PATRON.finditer(linea):
                        hallazgos.append(f"{ruta}:{n}: {m.group(1)}… ({len(m.group(0))} caracteres)")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
    if hallazgos:
        print("Posibles secretos:")
        print("\n".join(hallazgos))
        return 1
    print(f"Sin secretos en {len([f for f in ficheros if f])} ficheros.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
