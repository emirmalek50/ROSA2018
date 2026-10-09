"""Empaqueta lo que ROSA2018 necesita para vivir en otra máquina.

El `git pull` trae el código y nada más: el estado (`rosa.db`, 143 MB) y todo
`datos/` están en `.gitignore` a propósito. Esto empaqueta lo imprescindible y
dice por pantalla qué queda por mover a mano, que es lo pesado.

Por qué un script y no un `cp`: `rosa.db` es SQLite en modo WAL y el servidor
escribe en él. Copiarlo con `cp` mientras tanto da una base a medio escribir,
y puede parecer sana hasta que falta media iteración. Aquí se usa la API de
respaldo de SQLite, que saca una copia consistente aunque haya escrituras, y
después se comprueba con `PRAGMA integrity_check` y contando las filas.

NO mete secretos: ni `.env` ni `datos/_token_interno`. Esos se pasan por otro
canal y se vuelven a escribir en el destino.

    ./.venv/bin/python scripts/empaquetar_mudanza.py [--salida DIR]
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

# Bases SQLite: se copian con la API de respaldo, nunca con cp.
BASES = {
    "rosa.db": "el estado entero (investigaciones, corridas, hipótesis, evidencia)",
    "datos/_correo/rosa.db.db": "las cuentas y las sesiones; sin esto nadie puede entrar",
    "datos/traducciones.db": "el catálogo de traducciones ya pagadas",
}

# Carpetas pequeñas de estado que sí caben en el paquete.
CARPETAS = {
    "datos/_ejecuciones": "las ejecuciones de análisis registradas",
    "datos/_asistente_indices": "los índices del asistente",
}

# Lo que pesa y se mueve aparte, con rsync. (ruta, para qué, se_puede_rehacer)
APARTE = [
    ("pdfs/", "los PDF de las citas; sin ellos una cita no resuelve a su página", False),
    ("datos/_datasets/", "los datasets subidos y sus perfiles", False),
    ("datos/_gepa/", "lo que GEPA aprendió optimizando los prompts", False),
    ("datos/_respaldos/", "los respaldos del estado", False),
    ("datos/_indice/", "el índice semántico", True),
    ("datos/_transcriptoma/", "los transcriptomas de Ensembl (humano, ratón, rata)", True),
    ("datos/_herramientas/", "los binarios de BLAST", True),
]

VARIABLES = [
    ("ROSA_GATEWAY_KEY", "la clave del AI Gateway de Vercel; sin ella no hay modelos"),
    ("ROSA_GATEWAY_URL", "el extremo del Gateway"),
    ("ROSA_ADMIN", "el correo de la administradora"),
    ("ROSA_LOGIN_EMAIL", "la cuenta del equipo"),
    ("ROSA_LOGIN_PASSWORD_HASH", "su huella scrypt, no la contraseña"),
    ("CONVEX_URL", "el espejo de Convex (opcional)"),
    ("CONVEX_DEPLOY_KEY", "su clave (opcional)"),
    ("ROSA_EXA_KEY", "Exa, para la literatura gris (opcional)"),
    ("ROSA_NCBI_KEY", "NCBI, sube el tope de consultas (opcional)"),
    ("ROSA_BD", "dónde vive rosa.db si no es la raíz del repo"),
    ("ROSA_HOSTS", "los dominios desde los que se sirve, separados por comas"),
    ("ROSA_PUERTO", "el puerto, 8765 por defecto"),
]


def copiar_base(origen: Path, destino: Path) -> str:
    """Una copia consistente aunque el servidor esté escribiendo, comprobada."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{origen}?mode=ro", uri=True)
    try:
        salida = sqlite3.connect(destino)
        try:
            con.backup(salida)
            estado = salida.execute("PRAGMA integrity_check").fetchone()[0]
            if estado != "ok":
                raise SystemExit(f"La copia de {origen.name} no está sana: {estado}")
            tablas = [r[0] for r in salida.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            filas = sum(salida.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in tablas)
        finally:
            salida.close()
    finally:
        con.close()
    return f"{len(tablas)} tablas, {filas} filas"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default=str(RAIZ.parent / "mudanza-rosa"))
    a = ap.parse_args()
    destino = Path(a.salida).resolve()
    if destino.exists() and any(destino.iterdir()):
        raise SystemExit(f"{destino} ya tiene cosas dentro. Borra o elige otra con --salida.")
    destino.mkdir(parents=True, exist_ok=True)

    print(f"Paquete en {destino}\n")
    for rel, para_que in BASES.items():
        origen = RAIZ / rel
        if not origen.exists():
            print(f"  (falta {rel}: no estaba, se salta)")
            continue
        resumen = copiar_base(origen, destino / rel)
        mb = (destino / rel).stat().st_size / 1e6
        print(f"  {rel}  {mb:.0f} MB  {resumen}\n      {para_que}")
    for rel, para_que in CARPETAS.items():
        origen = RAIZ / rel
        if not origen.exists():
            continue
        shutil.copytree(origen, destino / rel)
        print(f"  {rel}\n      {para_que}")

    total = sum(f.stat().st_size for f in destino.rglob("*") if f.is_file())
    print(f"\nEl paquete pesa {total / 1e6:.0f} MB. Mándalo entero, respetando las rutas.\n")

    print("Lo que NO va aquí y hay que mover aparte (desde la raíz del repo):")
    for rel, para_que, rehacer in APARTE:
        nota = "se puede volver a bajar en destino" if rehacer else "NO se puede rehacer"
        print(f"  rsync -a --progress {rel} USUARIO@DESTINO:RUTA_DEL_REPO/{rel}")
        print(f"      {para_que} ({nota})")

    print("\nOjo con dos cosas en el destino:")
    print("  - datos/_herramientas tiene el BLAST de macOS arm64: en Linux NO sirve.")
    print("    Baja el de su plataforma de ftp.ncbi.nlm.nih.gov y déjalo en esa misma")
    print("    carpeta. Sin blastn, la criba cae al barrido exacto y lo dice en pantalla.")
    print("  - Los transcriptomas y los índices de BLAST se rehacen en destino; las URL")
    print("    están en rosa/criba.py (DE_DONDE) y rosa/especie.py (ESPECIES).")

    print("\nVariables de entorno que hay que escribir allí (los valores, por otro canal):")
    for nombre, para_que in VARIABLES:
        print(f"  {nombre:28} {para_que}")

    print("\nY la regla que no se negocia en el destino: UNA sola instancia.")
    print("Dos procesos escribiendo en rosa.db bifurcan el registro de auditoría.")
    print("Nada de despliegues solapados: parar, y entonces arrancar.")


if __name__ == "__main__":
    main()
