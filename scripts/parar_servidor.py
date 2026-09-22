#!/usr/bin/env python3
"""Para el servidor de ROSA2018, y se niega a hacerlo si hay una corrida viva.

Por qué existe. La regla "no reinicies con una corrida en marcha" estaba
escrita, se comprobaba a mano y aun así se saltó: el 22 de septiembre de 2026
un agente hizo la comprobación, obtuvo "la corrida 16 está en marcha" y paró el
servidor igualmente. Una regla que quien la ejecuta puede razonar y saltarse no
está implementada, está sugerida. Esto la implementa: si hay trabajo vivo, el
programa no para nada y sale con error.

Qué se arriesga al parar con trabajo en vuelo, medido en este código y no
supuesto:

- El estado NO se corrompe. Cada cambio es una transacción de SQLite con su
  hash encadenado (`rosa/estado/almacen.py`), así que un cambio entra entero o
  no entra.
- Lo ya hecho NO se repite. El bucle escribe por unidad terminada (por ejemplo,
  una fuente extraída se guarda en cuanto acaba, con sus marcas), y al reanudar
  solo quedan pendientes las que no tienen marca.
- Lo que SÍ se pierde es el trabajo en vuelo de esa unidad, con sus llamadas a
  los modelos ya pagadas. Se repiten al reanudar.
- Y si dos procesos llegan a escribir a la vez, el registro se bifurca. Eso ya
  pasó el 15 de septiembre de 2026: la comprobación de integridad lo detecta y
  lo dice ("dos procesos de ROSA2018 escribieron a la vez"), pero deja una
  cicatriz permanente en la cadena de auditoría.

Uso:

    ./.venv/bin/python scripts/parar_servidor.py           # para si es seguro
    ./.venv/bin/python scripts/parar_servidor.py --estado  # solo mira, no toca
    ./.venv/bin/python scripts/parar_servidor.py --forzar --motivo "..."

`--forzar` existe porque a veces hay que parar de verdad (un servidor colgado),
pero exige un motivo escrito que queda en la salida, y no es lo que se usa para
desplegar código nuevo: para eso se espera a que la corrida termine o se pausa
antes desde la interfaz.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# Los estados en los que una corrida tiene trabajo que puede estar en vuelo.
# `pausada` y `pausada_por_presupuesto` no: esperan a una persona y no llaman a
# ningún modelo. `detenida` y `terminada`, tampoco.
ESTADOS_VIVOS = ("en_marcha", "esperando_aprobacion", "esperando_plan", "esperando_modelo")
ESPERA_MAXIMA_S = 600
CODIGO_HAY_CORRIDA_VIVA = 2
CODIGO_SIN_SERVIDOR = 3


def corridas_vivas(ruta_db: Path) -> list[dict]:
    """Las corridas con trabajo vivo, leyendo la base en solo lectura. Si la
    base no se puede leer, se devuelve una corrida ficticia: no saber es motivo
    para no parar, nunca para seguir adelante."""
    try:
        con = sqlite3.connect(f"file:{ruta_db}?mode=ro", uri=True)
        fila = con.execute("select json from estado order by version desc limit 1").fetchone()
        con.close()
    except Exception as ex:  # noqa: BLE001  cualquier fallo de lectura cuenta como "no sé"
        return [{"numero": "?", "estado": f"no se pudo leer la base: {ex}", "id": "?"}]
    if not fila:
        return []
    estado = json.loads(fila[0])
    return [
        {"id": c.get("id"), "numero": c.get("numero"), "estado": c.get("estado"), "investigacionId": c.get("investigacionId")}
        for c in estado.get("corridas", [])
        if c.get("estado") in ESTADOS_VIVOS
    ]


def pid_del_servidor() -> int | None:
    """El proceso del servidor, por su línea de órdenes. None si no corre."""
    try:
        salida = subprocess.run(["pgrep", "-f", "rosa.main"], capture_output=True, text=True, timeout=10)
    except Exception:  # noqa: BLE001
        return None
    pids = [int(x) for x in salida.stdout.split() if x.strip().isdigit()]
    return pids[0] if pids else None


def sigue_vivo(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def parar(pid: int, espera_maxima: int = ESPERA_MAXIMA_S) -> bool:
    """Manda la señal de cierre y espera a que el proceso salga por su pie. El
    servidor cierra lo que tiene en curso antes de irse, y eso puede tardar
    minutos: no se le mete prisa ni se le mata."""
    os.kill(pid, signal.SIGTERM)
    inicio = time.time()
    while time.time() - inicio < espera_maxima:
        if not sigue_vivo(pid):
            return True
        time.sleep(1)
    return not sigue_vivo(pid)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Para el servidor de ROSA2018 si no hay trabajo vivo.")
    p.add_argument("--estado", action="store_true", help="solo dice qué hay, sin parar nada")
    p.add_argument("--forzar", action="store_true", help="para aunque haya una corrida viva (exige --motivo)")
    p.add_argument("--motivo", default="", help="por qué se fuerza, para que quede escrito")
    p.add_argument("--db", default=str(RAIZ / "rosa.db"), help="la base de estado")
    p.add_argument("--espera", type=int, default=ESPERA_MAXIMA_S, help="segundos de espera al cierre")
    a = p.parse_args(argv)

    vivas = corridas_vivas(Path(a.db))
    pid = pid_del_servidor()

    if a.estado:
        print(f"servidor: {'pid ' + str(pid) if pid else 'no está corriendo'}")
        if vivas:
            for c in vivas:
                print(f"  corrida {c['numero']} · {c['estado']}")
            print("NO es seguro parar: hay trabajo vivo.")
        else:
            print("no hay corridas vivas: es seguro parar.")
        return 0

    if vivas and not a.forzar:
        print("NO se para el servidor: hay trabajo vivo.")
        for c in vivas:
            print(f"  corrida {c['numero']} · {c['estado']}")
        print()
        print("Al parar ahora se perdería el trabajo en vuelo de la unidad en curso,")
        print("con sus llamadas a los modelos ya pagadas, y dos procesos escribiendo")
        print("a la vez bifurcan el registro de auditoría, como pasó el 15 de septiembre.")
        print()
        print("Qué hacer: esperar a que la corrida termine, o pausarla desde la interfaz")
        print("y volver a intentarlo. Para un servidor colgado: --forzar --motivo \"...\".")
        return CODIGO_HAY_CORRIDA_VIVA

    if pid is None:
        print("el servidor no está corriendo: no hay nada que parar.")
        return CODIGO_SIN_SERVIDOR

    if vivas and a.forzar:
        if not a.motivo.strip():
            print("--forzar exige --motivo: hay que escribir por qué se para con trabajo vivo.")
            return 1
        print(f"FORZADO con {len(vivas)} corrida(s) viva(s). Motivo: {a.motivo.strip()}")

    print(f"parando el servidor (pid {pid}); cierra lo que tiene en curso, puede tardar minutos...")
    if parar(pid, a.espera):
        print("el servidor ha salido.")
        return 0
    print(f"el servidor sigue vivo tras {a.espera} s: NO se arranca otro encima.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
