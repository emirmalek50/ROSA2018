"""Ejecucion aislada de analisis in silico (ROSA2018, etapas 5 y 6).

Que hace: toma un script escrito por el modelo y lo corre contra un fichero
de datos, sin red, con los datos en solo lectura, con limite de tiempo y de
memoria, y devuelve un registro de ejecucion (RunRecord) con el codigo, el
entorno, la semilla, la salida y el estado real. "No ejecutado", "error
tecnico" y "sin efecto detectable" son estados distintos; un tiempo agotado
es un error tecnico, nunca un resultado nulo.

Donde corre, por orden de preferencia:
1. Docker (`docker run --network none --memory ... -v datos:ro`): un
   contenedor por ejecucion con la imagen `rosa-sandbox` (pandas, numpy,
   scipy, statsmodels). Requiere Docker Desktop encendido.
2. Apple `container` (macOS 15.5 o superior, Apple Silicon): una micro-VM
   por ejecucion, mismas banderas.
3. Aislamiento blando local: solo si el dataset esta marcado como sintetico
   y la politica lo permite. Un subproceso `python -I` con el entorno
   vaciado, limite de CPU, y un preambulo que bloquea red, subprocesos y
   escritura fuera del directorio de trabajo. No protege de un adversario;
   protege de un error del modelo. Con datos reales no se usa nunca.

Si no hay runtime valido, el registro queda en `no_ejecutado` con el motivo
y la interfaz dice que hay que encender Docker. Nunca se cae a ejecutar en
la maquina sin aislamiento con datos reales.

Contrato de salida del script: lineas `RESULTADO nombre=valor`,
`BASELINE nombre=valor`, `CONTROL nombre=valor` y, si aplica,
`NO_EVALUABLE motivo`. Aqui se parsean; el modelo no vuelve a tocar las
cifras.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rosa import config, politicas

IMAGEN = os.environ.get("ROSA_SANDBOX_IMAGEN", "rosa-sandbox:1")
# Entornos del sandbox (como los "task environments" de Claude Science, pero
# fijos y declarados): la imagen tabular y la de celula unica. El plan de
# analisis elige el entorno y lo deja escrito; la ejecucion registra la
# imagen y las versiones de sus paquetes.
IMAGENES = {"tabular": (IMAGEN, "Dockerfile"), "celula_unica": (os.environ.get("ROSA_SANDBOX_IMAGEN_CELULA", "rosa-sandbox-celula:1"), "Dockerfile.celula")}
_VERSIONES: dict[str, list[dict[str, str]]] = {}
DIR_TRABAJO = Path(config.RAIZ) / "datos" / "_ejecuciones"
PAQUETES_SANDBOX = ["pandas", "numpy", "scipy", "statsmodels"]

# Permitir el aislamiento blando local con datos sinteticos. Es una politica:
# se cambia aqui, con commit, no desde la interfaz.
# El aislamiento blando local (sin Docker) es evadible: solo se activa a
# proposito con ROSA_PERMITIR_LOCAL_SINTETICO=1 y solo con datos sinteticos.
PERMITIR_LOCAL_SINTETICO = os.environ.get("ROSA_PERMITIR_LOCAL_SINTETICO", "") == "1"


@dataclass
class Resultado:
    estado: str  # no_ejecutado | error_tecnico | completado | tiempo_agotado
    runtime: str  # docker | container | local_sintetico | ninguno
    salida: str = ""
    error: str = ""
    codigo_salida: int | None = None
    duracion_s: float | None = None
    resultados: dict[str, str] = field(default_factory=dict)
    baseline: dict[str, str] = field(default_factory=dict)
    control: dict[str, str] = field(default_factory=dict)
    no_evaluable: str | None = None
    paquetes: list[dict[str, str]] = field(default_factory=list)


def hash_fichero(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Deteccion del runtime
# ---------------------------------------------------------------------------


def _docker_disponible() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, text=True, timeout=8)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:  # noqa: BLE001
        return False


def _container_disponible() -> bool:
    if not shutil.which("container"):
        return False
    try:
        r = subprocess.run(["container", "system", "status"], capture_output=True, text=True, timeout=8)
        return r.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def runtime_disponible(sintetico: bool) -> tuple[str, str]:
    """(runtime, motivo). `ninguno` con el motivo si no hay forma segura."""
    if _docker_disponible():
        return "docker", ""
    if _container_disponible():
        return "container", ""
    if sintetico and PERMITIR_LOCAL_SINTETICO:
        return "local_sintetico", "Sin Docker ni Apple container: aislamiento blando local, permitido solo porque el dataset es sintético"
    motivo = "Sin runtime de aislamiento: enciende Docker Desktop (o instala Apple container) para ejecutar análisis con datos reales."
    if sintetico:
        motivo = "Sin runtime de aislamiento y la política no permite ejecución local."
    return "ninguno", motivo


def _asegurar_imagen(runtime: str, entorno: str = "tabular") -> str | None:
    """Construye la imagen del sandbox del entorno si no existe. Devuelve un error o None."""
    cli = runtime
    imagen, dockerfile_nombre = IMAGENES.get(entorno, IMAGENES["tabular"])
    try:
        r = subprocess.run([cli, "image", "inspect", imagen], capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            return None
        dockerfile = Path(config.RAIZ) / "rosa" / "sandbox"
        r = subprocess.run([cli, "build", "-t", imagen, "-f", str(dockerfile / dockerfile_nombre), str(dockerfile)], capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            return f"No se pudo construir la imagen del sandbox: {r.stderr[-800:]}"
        return None
    except subprocess.TimeoutExpired:
        return "La construcción de la imagen del sandbox tardo más de 30 minutos"
    except Exception as ex:  # noqa: BLE001
        return f"No se pudo preparar la imagen del sandbox: {ex}"


# ---------------------------------------------------------------------------
# Ejecucion
# ---------------------------------------------------------------------------

PREAMBULO_LOCAL = r'''
# Preambulo de aislamiento blando de ROSA2018 (solo datos sinteticos y solo si se
# activa a proposito). Lectura limitada al directorio de trabajo, al dataset y
# al propio Python; escritura solo en el directorio de trabajo; sin red, sin
# procesos. Es una barrera contra errores, no contra un atacante decidido.
def _instalar_sandbox():
    import builtins, os, sys, io, resource, sysconfig
    trabajo = os.path.realpath(os.getcwd())
    datos = os.path.realpath(os.environ.get("ROSA_DATOS", ""))
    permitidos = tuple(p for p in {trabajo, datos, os.path.realpath(sys.prefix), os.path.realpath(sys.base_prefix), *(os.path.realpath(v) for v in sysconfig.get_paths().values() if v)} if p)
    resource.setrlimit(resource.RLIMIT_CPU, (__CPU__, __CPU__))
    try:
        resource.setrlimit(resource.RLIMIT_AS, (__MEM__, __MEM__))
    except (ValueError, OSError):
        pass
    abrir = builtins.open
    io_abrir = io.open
    def vigilado(f, mode="r", *a, **k):
        if isinstance(f, int):
            return abrir(f, mode, *a, **k)
        p = os.path.realpath(str(f))
        escribe = any(c in mode for c in "wax+")
        if escribe and not p.startswith(trabajo):
            raise PermissionError("ROSA2018: escritura fuera del directorio de trabajo")
        if not escribe and not p.startswith(permitidos):
            raise PermissionError("ROSA2018: lectura fuera del dataset y del directorio de trabajo")
        return abrir(f, mode, *a, **k)
    builtins.open = vigilado
    io.open = vigilado
    os_open = os.open
    def os_open_vigilado(path, flags, *a, **k):
        p = os.path.realpath(str(path))
        if (flags & (os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC)) and not p.startswith(trabajo):
            raise PermissionError("ROSA2018: escritura fuera del directorio de trabajo")
        if not p.startswith(permitidos):
            raise PermissionError("ROSA2018: lectura fuera del dataset y del directorio de trabajo")
        return os_open(path, flags, *a, **k)
    os.open = os_open_vigilado
    def sin(*a, **k):
        raise PermissionError("ROSA2018: operacion deshabilitada en el sandbox")
    import socket, _socket, subprocess, shutil
    socket.socket = sin; socket.create_connection = sin; _socket.socket = sin
    subprocess.Popen = sin; subprocess.run = sin; subprocess.call = sin; subprocess.check_output = sin
    os.system = sin; os.popen = sin; os.remove = sin; os.unlink = sin; os.rmdir = sin
    for n in ("fork", "forkpty", "execv", "execve", "execvp", "execvpe", "posix_spawn", "posix_spawnp", "spawnv", "spawnve"):
        if hasattr(os, n):
            setattr(os, n, sin)
    shutil.rmtree = sin; shutil.move = sin
_instalar_sandbox()
del _instalar_sandbox
# Fin del preambulo.
'''


MAX_CIFRAS = 60
CLAVES_PRIORITARIAS = ("valor_reproducido", "p_valor", "p", "estadistico", "n", "diferencia", "ic95_inferior", "ic95_superior", "numerador", "denominador")


def _parsear(salida: str) -> tuple[dict[str, str], dict[str, str], dict[str, str], str | None]:
    """Las lineas del contrato. Si un script imprime una cifra por gen, se
    guardan las prioritarias y las primeras hasta MAX_CIFRAS: el registro no
    debe pesar megas, y `valor_reproducido` nunca se pierde."""
    resultados: dict[str, str] = {}
    baseline: dict[str, str] = {}
    control: dict[str, str] = {}
    no_evaluable: str | None = None
    for linea in salida.splitlines():
        l = linea.strip()
        m = re.match(r"^(RESULTADO|BASELINE|CONTROL)\s+([^\s=]+)\s*=\s*(.+)$", l)
        if m:
            destino = {"RESULTADO": resultados, "BASELINE": baseline, "CONTROL": control}[m.group(1)]
            clave = m.group(2)
            if len(destino) >= MAX_CIFRAS and clave not in destino and clave not in CLAVES_PRIORITARIAS:
                destino.setdefault("_omitidas", "0")
                destino["_omitidas"] = str(int(destino["_omitidas"]) + 1)
                continue
            if clave not in destino and len([k for k in destino if k != "_omitidas"]) >= MAX_CIFRAS:
                expulsable = next((k for k in destino if k not in CLAVES_PRIORITARIAS and k != "_omitidas"), None)
                if expulsable is not None:
                    del destino[expulsable]
                    destino["_omitidas"] = str(int(destino.get("_omitidas", "0")) + 1)
            destino[clave] = m.group(3).strip()[:120]
            continue
        m = re.match(r"^NO_EVALUABLE\s*(.*)$", l)
        if m and no_evaluable is None:
            no_evaluable = m.group(1).strip() or "El script marco el análisis como no evaluable"
    return resultados, baseline, control, no_evaluable


def versiones_imagen(runtime: str, entorno: str = "tabular") -> list[dict[str, str]]:
    """Las versiones de los paquetes de la imagen, leídas una vez por proceso
    (el registro de procedencia exige el entorno exacto de cada artefacto)."""
    imagen = IMAGENES.get(entorno, IMAGENES["tabular"])[0]
    if imagen in _VERSIONES:
        return _VERSIONES[imagen]
    try:
        r = subprocess.run([runtime, "run", "--rm", "--network", "none", imagen, "python", "-c", "import importlib.metadata as m, json, platform; print(json.dumps({'python': platform.python_version(), **{d.metadata['Name']: d.version for d in m.distributions()}}))"], capture_output=True, text=True, timeout=120)
        datos = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 and r.stdout.strip() else {}
    except Exception:  # noqa: BLE001
        datos = {}
    if not isinstance(datos, dict) or not datos:
        return [{"nombre": "imagen", "version": imagen}, {"nombre": "versiones", "version": "no comprobadas"}]
    _VERSIONES[imagen] = [{"nombre": "imagen", "version": imagen}] + [{"nombre": k, "version": v} for k, v in sorted(datos.items()) if k.lower() in ("python", "pandas", "numpy", "scipy", "statsmodels", "scanpy", "anndata", "h5py", "matplotlib", "leidenalg", "igraph")]
    return _VERSIONES[imagen]


def _paquetes(runtime: str, entorno: str = "tabular") -> list[dict[str, str]]:
    if runtime == "local_sintetico":
        salida = []
        for p in PAQUETES_SANDBOX:
            try:
                mod = __import__(p)
                salida.append({"nombre": p, "version": getattr(mod, "__version__", "?")})
            except Exception:  # noqa: BLE001
                salida.append({"nombre": p, "version": "no instalado"})
        return salida
    return versiones_imagen(runtime, entorno) if runtime in ("docker", "container") else []


def _cola(ruta: Path, maximo: int) -> str:
    """Los últimos `máximo` bytes de un fichero de salida, como texto."""
    try:
        tam = ruta.stat().st_size
        with open(ruta, "rb") as f:
            if tam > maximo:
                f.seek(tam - maximo)
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _extras_validos(ficheros_extra: dict[str, str] | None) -> dict[str, str]:
    """Modulos de skills que se copian al directorio de trabajo: nombres de
    identificador, nunca analisis.py ni un nombre de la biblioteca estandar
    (sombrearia un modulo del sistema)."""
    return {n: c for n, c in (ficheros_extra or {}).items() if re.fullmatch(r"[a-z_][a-z0-9_]*\.py", n) and n != "analisis.py" and n[:-3] not in sys.stdlib_module_names}


def _con_ruta_de_modulos(codigo: str, directorio: str, extras: dict[str, str]) -> str:
    """`python -I` no pone el directorio del script en sys.path: si hay
    modulos de skills que importar, se anade a mano al principio."""
    if not extras:
        return codigo
    return f"import sys as _rosa_sys\n_rosa_sys.path.insert(0, {directorio!r})\ndel _rosa_sys\n" + codigo


def ejecutar(codigo: str, ruta_datos: Path, semilla: int, sintetico: bool, id_ejecucion: str, entorno: str = "tabular", ficheros_extra: dict[str, str] | None = None) -> Resultado:
    """Corre el script contra el fichero. Bloqueante: llamarlo desde un hilo.
    `entorno` elige la imagen (tabular o celula_unica); `ficheros_extra` son
    modulos de skills que se copian al directorio de trabajo para importarlos."""
    nombre_entorno = entorno
    runtime, motivo = runtime_disponible(sintetico)
    if runtime == "ninguno":
        return Resultado(estado="no_ejecutado", runtime="ninguno", error=motivo)
    DIR_TRABAJO.mkdir(parents=True, exist_ok=True)
    trabajo = Path(tempfile.mkdtemp(prefix=f"{id_ejecucion}-", dir=DIR_TRABAJO))
    inicio = time.monotonic()
    tiempo = politicas.SEGUNDOS_MAX_EJECUCION
    salida_dir: Path | None = None
    try:
        if runtime in ("docker", "container"):
            err = _asegurar_imagen(runtime, entorno)
            if err:
                return Resultado(estado="no_ejecutado", runtime=runtime, error=err)
            extras = _extras_validos(ficheros_extra)
            (trabajo / "analisis.py").write_text(_con_ruta_de_modulos(codigo, "/trabajo", extras), encoding="utf-8")
            for nombre, contenido in extras.items():
                (trabajo / nombre).write_text(contenido, encoding="utf-8")
            nombre_contenedor = f"rosa-{re.sub(r'[^a-zA-Z0-9_.-]', '-', id_ejecucion)[:60]}"
            cmd = [
                runtime, "run", "--rm",
                "--name", nombre_contenedor,
                "--network", "none",
                "--memory", f"{politicas.MEMORIA_MAX_EJECUCION_MB}m",
                "--memory-swap", f"{politicas.MEMORIA_MAX_EJECUCION_MB}m",
                "--cpus", "2",
                "--pids-limit", "256",
                "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges",
                "-v", f"{ruta_datos.resolve()}:/datos/{ruta_datos.name}:ro",
                "-v", f"{trabajo}:/trabajo",
                "-w", "/trabajo",
                "-e", f"ROSA_SEMILLA={semilla}",
                "-e", f"ROSA_DATOS=/datos/{ruta_datos.name}",
                IMAGENES.get(entorno, IMAGENES["tabular"])[0], "python", "-I", "/trabajo/analisis.py",
            ]
            entorno = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")}
            if runtime == "docker" and os.environ.get("DOCKER_HOST"):
                entorno["DOCKER_HOST"] = os.environ["DOCKER_HOST"]
            cwd = None
        else:
            preambulo = PREAMBULO_LOCAL.replace("__CPU__", str(tiempo)).replace("__MEM__", str(politicas.MEMORIA_MAX_EJECUCION_MB * 1024 * 1024))
            extras = _extras_validos(ficheros_extra)
            nombre_contenedor = None
            (trabajo / "analisis.py").write_text(preambulo + "\n" + _con_ruta_de_modulos(codigo, str(trabajo), extras), encoding="utf-8")
            for nombre, contenido in extras.items():
                (trabajo / nombre).write_text(contenido, encoding="utf-8")
            cmd = [sys.executable, "-I", str(trabajo / "analisis.py")]
            entorno = {"ROSA_DATOS": str(ruta_datos.resolve()), "ROSA_SEMILLA": str(semilla), "PATH": "/usr/bin:/bin", "HOME": str(trabajo), "PYTHONDONTWRITEBYTECODE": "1", "MPLBACKEND": "Agg"}
            cwd = str(trabajo)
        # La salida va a ficheros (no a memoria del servidor): un script que imprime
        # en bucle no puede agotar la RAM del proceso de ROSA2018.
        # Los ficheros de salida viven fuera del directorio montado: el script no
        # puede leerlos ni reescribirlos.
        salida_dir = Path(tempfile.mkdtemp(prefix=f"{id_ejecucion}-salida-", dir=DIR_TRABAJO))
        f_out, f_err = salida_dir / "stdout.txt", salida_dir / "stderr.txt"
        try:
            with open(f_out, "w", encoding="utf-8") as fo, open(f_err, "w", encoding="utf-8") as fe:
                r = subprocess.run(cmd, stdout=fo, stderr=fe, text=True, timeout=tiempo + 30, env=entorno, cwd=cwd)
        except subprocess.TimeoutExpired:
            if runtime in ("docker", "container") and nombre_contenedor:
                # Matar al cliente no mata el contenedor: se para y se borra por nombre.
                subprocess.run([runtime, "rm", "-f", nombre_contenedor], capture_output=True, text=True, timeout=30)
            return Resultado(estado="tiempo_agotado", runtime=runtime, salida=_cola(f_out, 4000), error=f"Tiempo agotado tras {tiempo} s. Es un error técnico, no un resultado nulo.", duracion_s=round(time.monotonic() - inicio, 1))
        duracion = round(time.monotonic() - inicio, 1)
        # Se parsea la salida completa (hasta 50 MB; un script puede imprimir mucho
        # antes de la cifra final) y se guarda recortada.
        stdout = _cola(f_out, 50 * 1024 * 1024)
        resultados, baseline, control, no_evaluable = _parsear(stdout)
        salida = stdout[-12000:]
        error = _cola(f_err, 4000)
        if r.returncode != 0:
            return Resultado(estado="error_tecnico", runtime=runtime, salida=salida, error=error or f"Código de salida {r.returncode}", codigo_salida=r.returncode, duracion_s=duracion, resultados=resultados, baseline=baseline, control=control, no_evaluable=no_evaluable, paquetes=_paquetes(runtime, nombre_entorno))
        if not resultados and not no_evaluable:
            return Resultado(estado="error_tecnico", runtime=runtime, salida=salida, error="El script término sin imprimir ninguna línea RESULTADO ni NO_EVALUABLE: no cumplio el contrato de salida.", codigo_salida=0, duracion_s=duracion, paquetes=_paquetes(runtime, nombre_entorno))
        return Resultado(estado="completado", runtime=runtime, salida=salida, error=error, codigo_salida=0, duracion_s=duracion, resultados=resultados, baseline=baseline, control=control, no_evaluable=no_evaluable, paquetes=_paquetes(runtime, nombre_entorno))
    finally:
        shutil.rmtree(trabajo, ignore_errors=True)
        if salida_dir:
            shutil.rmtree(salida_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Comprobaciones deterministas del auditor (Killer II sin modelo)
# ---------------------------------------------------------------------------


def comprobaciones_deterministas(codigo: str, plan: dict[str, Any], res: Resultado, repeticiones: list[dict[str, Any]] | None = None) -> list[dict[str, str]]:
    """Lo que se puede comprobar sin juez: semilla, fuga por ajuste antes de
    partir, variables del plan presentes en el código, baseline y control
    presentes, n por grupo, multiplicidad, y estabilidad entre semillas
    (crítica: un p que cruza el alfa según la semilla no es un efecto)."""
    c: list[dict[str, str]] = []
    c.append(estabilidad_entre_semillas(plan, res, repeticiones))
    tiene_semilla = bool(re.search(r"random_state|\.seed\(|default_rng\(|ROSA_SEMILLA", codigo))
    c.append({"comprobacion": "semilla", "resultado": "pasa" if tiene_semilla else "falla", "detalle": "El código fija la semilla" if tiene_semilla else "El código no fija ninguna semilla: no es repetible"})
    pos_fit = codigo.find(".fit(")
    pos_split = codigo.find("train_test_split(")
    if pos_split != -1 and pos_fit != -1 and pos_fit < pos_split:
        c.append({"comprobacion": "fuga_de_datos", "resultado": "falla", "detalle": "Hay un ajuste (.fit) antes de partir en entrenamiento y prueba: posible fuga"})
    elif re.search(r"(StandardScaler|MinMaxScaler|SimpleImputer)\(\)\.fit_transform\(", codigo) and pos_split != -1:
        c.append({"comprobacion": "fuga_de_datos", "resultado": "no_comprobable", "detalle": "Hay un escalado o imputación global; revisar si se ajusto solo con el entrenamiento"})
    else:
        c.append({"comprobacion": "fuga_de_datos", "resultado": "pasa" if pos_split != -1 else "no_aplica", "detalle": "Sin ajuste antes de partir" if pos_split != -1 else "No hay partición entrenamiento y prueba en este análisis"})
    variables = [re.sub(r"\s*\(.*\)$", "", v).strip() for v in plan.get("variables", [])]
    faltan = [v for v in variables if v and v.split()[0] not in codigo]
    c.append({"comprobacion": "coincide_con_plan", "resultado": "pasa" if not faltan else "falla", "detalle": "Todas las variables del plan aparecen en el código" if not faltan else "Variables del plan que no aparecen en el código: " + ", ".join(faltan[:6])})
    tiene_base = bool(res.baseline)
    tiene_control = bool(res.control)
    c.append({"comprobacion": "baseline_y_control", "resultado": "pasa" if (tiene_base and tiene_control) else ("no_aplica" if res.no_evaluable else "falla"), "detalle": f"Baseline: {'si' if tiene_base else 'no'}. Control negativo: {'si' if tiene_control else 'no'}"})
    ns = []
    for k, v in res.resultados.items():
        if re.match(r"^n(_|$)", k, re.I):
            try:
                ns.append(float(v))
            except ValueError:
                pass
    if ns:
        c.append({"comprobacion": "tamano_muestral", "resultado": "falla" if min(ns) < 5 else "pasa", "detalle": f"n mínimo por grupo {min(ns):g}" + (" (menos de 5)" if min(ns) < 5 else "")})
    else:
        c.append({"comprobacion": "tamano_muestral", "resultado": "no_comprobable", "detalle": "El código no imprimio n por grupo (RESULTADO n_...)"})
    pvalores = [k for k in res.resultados if re.search(r"^p(_|val|$)", k, re.I)]
    corrige = bool(re.search(r"bonferroni|holm|fdr|multipletests|benjamini", codigo, re.I)) or "una sola" in (plan.get("correccionMultiplicidad") or "").lower()
    c.append({"comprobacion": "multiplicidad", "resultado": "pasa" if (len(pvalores) <= 1 or corrige) else "falla", "detalle": f"{len(pvalores)} p-valores impresos; corrección en el código: {'si' if corrige else 'no'}"})
    return c


def _p_min(cifras: dict[str, Any]) -> float | None:
    ps = []
    for k, v in (cifras or {}).items():
        if re.search(r"^p(_|val|$)", str(k), re.I):
            try:
                ps.append(float(str(v).replace(",", ".")))
            except ValueError:
                continue
    return min(ps) if ps else None


def estabilidad_entre_semillas(plan: dict[str, Any], res: Resultado, repeticiones: list[dict[str, Any]] | None) -> dict[str, str]:
    """Comprobación crítica: el p-valor principal debe caer del mismo lado del
    alfa con todas las semillas. Sin repeticiones completadas, no comprobable."""
    hechas = list(repeticiones or [])
    def desconocido(detalle: str) -> dict[str, str]:
        return {"comprobacion": "estabilidad_semillas", "resultado": "no_comprobable", "detalle": detalle}
    if not hechas or any(r.get("estado") != "completado" for r in hechas):
        return desconocido("Faltan réplicas completadas; no se puede comprobar la estabilidad")
    claves = [k for k in res.resultados if re.search(r"^p(_|val|$)", k, re.I)]
    principal = plan.get("pPrincipal")
    if principal:
        claves = [principal]
    if not claves:
        return desconocido("El código no imprimió p-valores identificables")
    alpha = float(plan.get("alpha") or 0.05)
    if not math.isfinite(alpha) or not 0 < alpha < 1:
        return desconocido("Alfa no válido")
    cruzan = []
    for clave in claves:
        try:
            valores = [float(str(c[clave]).replace(",", ".")) for c in [res.resultados, *(r.get("resultados") or {} for r in hechas)]]
        except (KeyError, TypeError, ValueError):
            return desconocido(f"Falta {clave} o no es numérico en alguna réplica")
        if any(not math.isfinite(v) or not 0 <= v <= 1 for v in valores):
            return desconocido(f"{clave} contiene un p-valor no válido")
        if any((p < alpha) != (valores[0] < alpha) for p in valores[1:]):
            cruzan.append(clave)
    if cruzan:
        return {"comprobacion": "estabilidad_semillas", "resultado": "falla", "detalle": f"Cruzan el alfa {alpha:g} entre semillas: {', '.join(cruzan)}"}
    return {"comprobacion": "estabilidad_semillas", "resultado": "pasa", "detalle": f"Las mismas medidas permanecen del mismo lado del alfa {alpha:g} en {len(hechas) + 1} semillas"}
