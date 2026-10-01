"""Los datos que llegan del laboratorio: donde se guardan y como se resumen.

El resumen es determinista (sin modelo): filas, columnas, y por columna
numerica cuenta, media, desviacion, minimo, maximo y faltantes. Es lo que el
juez recibe junto con las primeras filas para aplicar los criterios del
prerregistro. Formatos: CSV, TSV, JSON (lista de objetos), TXT/MD, PDF (texto
por pagina con PyMuPDF). Un fichero que no se entiende se resume como texto.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import tempfile
import uuid
import re
import statistics
from pathlib import Path

from rosa import config

DIR_DATOS = Path(config.RAIZ) / "datos"
# 200 MB: una matriz de expresion publica de GEO en formato largo (una fila por
# sonda y muestra) ronda los 100 MB; los ficheros de laboratorio son mucho menores.
MAX_BYTES = 200 * 1024 * 1024


def nombre_seguro(nombre: str) -> str:
    base = Path(nombre).name
    base = re.sub(r"[^\w.\-]+", "_", base)
    if not base.strip(".") or base.strip(".-_") == "":
        base = "datos"  # '..', '...' o solo signos: no puede ser un nombre de fichero
    return base[:120] or "datos"


def ruta_de(hipotesis_id: str, fichero: str) -> Path | None:
    if not fichero:
        return None
    return DIR_DATOS / re.sub(r"[^\w\-]+", "_", hipotesis_id) / nombre_seguro(fichero)


def guardar(hipotesis_id: str, nombre: str, contenido: bytes) -> Path:
    if len(contenido) > MAX_BYTES:
        raise ValueError("El fichero supera los 200 MB")
    original = nombre_seguro(Path(nombre).stem)[:65] + nombre_seguro(Path(nombre).suffix) if Path(nombre).suffix else nombre_seguro(nombre)[:80]
    # El identificador va antes del nombre: conserva la extensión y la marca de sintético.
    ruta = ruta_de(hipotesis_id, f"{uuid.uuid4().hex}-{original}")
    assert ruta is not None
    ruta.parent.mkdir(parents=True, exist_ok=True)
    fd, temporal = tempfile.mkstemp(dir=ruta.parent, prefix=".entrega-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contenido)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporal, ruta)
    finally:
        if os.path.exists(temporal):
            os.unlink(temporal)
    return ruta


def _numero(v: str) -> float | None:
    t = v.strip()
    if not t or t.lower() in ("na", "nan", "null", "none", "n/a", "-", "."):
        return None
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", t):
        t = t.replace(",", "")  # separador de miles: 1,234,567
    elif t.count(",") == 1 and "." not in t:
        t = t.replace(",", ".")  # coma decimal europea: 0,8
    elif "," in t:
        return None
    try:
        n = float(t)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def _no_finito(v: str) -> bool:
    try:
        return not math.isfinite(float(v.strip())) and v.strip().lower() not in ("nan", "na", "")
    except ValueError:
        return False


def _ic_mediana(nums: list[float], remuestras: int = 2000) -> tuple[float, float]:
    """Intervalo percentil del 95 % para la mediana por bootstrap con semilla
    fija: mismo fichero, mismo intervalo. Es una aproximación para orientar al
    juez, no sustituye el análisis prerregistrado."""
    import random

    if len(nums) < 4:
        return (min(nums), max(nums))
    rng = random.Random(12345)
    # Con tablas grandes el remuestreo completo tarda minutos y bloquearia el
    # servidor: se remuestrea una submuestra fija de 5000 valores con menos
    # repeticiones. Es orientativo; el analisis prerregistrado va aparte.
    base = nums if len(nums) <= 5000 else rng.sample(nums, 5000)
    if len(nums) > 5000:
        remuestras = min(remuestras, 300)
    medianas = sorted(statistics.median(rng.choices(base, k=len(base))) for _ in range(remuestras))
    return (medianas[int(0.025 * remuestras)], medianas[max(0, int(0.975 * remuestras) - 1)])


def _resumen_grupos(cabecera: list[str], filas: list[list[str]]) -> str:
    """Conserva las relaciones grupo-medida sin enviar observaciones individuales.

    Solo estratifica por columnas de diseño reconocibles, nunca identificadores.
    Son descriptivos; no sustituyen un contraste ajustado o pareado prerregistrado.
    """
    patron = r"^(grupo|group|brazo|arm|tratamiento|treatment|condicion|condición|condition|visita|visit|tiempo|time|sexo|sex|lote|batch)$"
    indices = [i for i, c in enumerate(cabecera) if re.fullmatch(patron, c.strip(), re.I)]
    if not indices:
        return "Contraste entre grupos: no comprobable sin columnas de diseño identificadas. Los marginales no permiten inferir dirección, efecto ni equivalencia."
    grupos: dict[tuple[str, ...], list[list[str]]] = {}
    for fila in filas:
        clave = tuple(fila[i].strip() if i < len(fila) else "(faltante)" for i in indices)
        if clave not in grupos and len(grupos) >= 64:
            return "Contraste entre grupos: no comprobable en este resumen (más de 64 estratos). Requiere el análisis prerregistrado en el sandbox."
        grupos.setdefault(clave, []).append(fila)
    lineas = ["Descriptivos por estrato de diseño (no son pruebas de significación, equivalencia ni causalidad):"]
    for clave, fs in sorted(grupos.items()):
        lineas.append("Estrato " + "; ".join(f"{cabecera[i]}={v}" for i, v in zip(indices, clave)))
        for j, col in enumerate(cabecera):
            if j in indices:
                continue
            valores = [_numero(f[j]) for f in fs if j < len(f)]
            nums = [v for v in valores if v is not None]
            if nums and len(nums) >= len(fs) * 0.6:
                sd = statistics.stdev(nums) if len(nums) > 1 else None
                lineas.append(f"- {col}: n={len(nums)}, media={statistics.fmean(nums):.8g}, mediana={statistics.median(nums):.8g}, sd={sd if sd is not None else 'no estimable'}, faltantes_o_inválidos={len(fs)-len(nums)}")
    lineas.append("La comparación debe respetar emparejamientos y covariables del prerregistro. Sin su cálculo no se puede afirmar apoyo reproducido ni negativo interpretable solo con estos descriptivos.")
    return "\n".join(lineas)


def _resumen_tabla(cabecera: list[str], filas: list[list[str]]) -> str:
    lineas = [f"Tabla: {len(filas)} filas, {len(cabecera)} columnas."]
    for i, col in enumerate(cabecera):
        valores = [f[i] if i < len(f) else "" for f in filas]
        nums = [n for n in (_numero(v) for v in valores) if n is not None]
        faltan = sum(1 for v in valores if not v.strip() or v.strip().lower() in ("na", "nan", "null", "none", "n/a"))
        no_finitos = sum(1 for v in valores if _no_finito(v))
        if no_finitos:
            lineas.append(f"- {col}: {no_finitos} valores no finitos excluidos del cálculo; revisar el archivo.")
        if len(nums) >= max(2, (len(valores) - no_finitos) * 0.6):
            media = statistics.fmean(nums)
            sd = statistics.pstdev(nums) if len(nums) > 1 else 0.0
            ordenados = sorted(nums)
            q1, mediana, q3 = statistics.quantiles(ordenados, n=4) if len(nums) >= 4 else (ordenados[0], statistics.median(ordenados), ordenados[-1])
            positivos = sum(1 for x in nums if x > 0)
            negativos = sum(1 for x in nums if x < 0)
            ceros = len(nums) - positivos - negativos
            # Intervalo aproximado del 95 % para la mediana por remuestreo
            # determinista (semilla fija), util cuando el criterio pide la mediana.
            ic = _ic_mediana(nums)
            lineas.append(
                f"- {col} (numérica): n={len(nums)}, media={media:.4g}, sd={sd:.4g}, mediana={mediana:.4g} (IC95 aprox. {ic[0]:.4g} a {ic[1]:.4g}), Q1={q1:.4g}, Q3={q3:.4g}, min={min(nums):.4g}, max={max(nums):.4g}, positivos={positivos}, negativos={negativos}, ceros={ceros}, faltantes={faltan}"
            )
        else:
            distintos = {}
            for v in valores:
                k = v.strip() or "(vacio)"
                distintos[k] = distintos.get(k, 0) + 1
            top = sorted(distintos.items(), key=lambda kv: -kv[1])[:8]
            if len(distintos) <= 30:
                lineas.append(f"- {col} (categorica): {len(distintos)} valores distintos; más frecuentes: " + ", ".join(f"{k[:40]}={n}" for k, n in top) + f"; faltantes={faltan}")
            else:
                # Muchos valores distintos: podrian ser identificadores o texto libre de
                # personas. No se enumeran: solo cardinalidad y longitudes.
                longs = [len(k) for k in distintos]
                lineas.append(f"- {col} (texto o identificador): {len(distintos)} valores distintos (no se enumeran), longitud {min(longs)} a {max(longs)} caracteres; faltantes={faltan}")
    lineas.append(_resumen_grupos(cabecera, filas))
    return "\n".join(lineas)


DIR_DATASETS = DIR_DATOS / "_datasets"
CENTINELAS = {"-1", "-9", "-99", "-999", "NA", "N/A", "null", "NULL", "None", "#N/A", ".", "?"}


def ruta_dataset(investigacion_id: str, dataset_id: str, fichero: str) -> Path:
    return DIR_DATASETS / re.sub(r"[^\w\-]+", "_", investigacion_id) / re.sub(r"[^\w\-]+", "_", dataset_id) / nombre_seguro(fichero)


def guardar_dataset(investigacion_id: str, dataset_id: str, nombre: str, contenido: bytes) -> Path:
    if len(contenido) > MAX_BYTES:
        raise ValueError("El fichero supera los 200 MB")
    ruta = ruta_dataset(investigacion_id, dataset_id, nombre)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(contenido)
    return ruta


def _leer_tabla(ruta: Path) -> tuple[list[str], list[list[str]]] | None:
    suf = ruta.suffix.lower()
    raw = ruta.read_bytes()
    try:
        texto = raw.decode("utf-8")
    except UnicodeDecodeError:
        texto = raw.decode("latin-1", errors="replace")
    if suf == ".json":
        try:
            datos = json.loads(texto)
        except json.JSONDecodeError:
            return None
        if isinstance(datos, list) and datos and isinstance(datos[0], dict):
            cabecera = sorted({k for d in datos for k in d})
            return cabecera, [[str(d.get(k, "")) for k in cabecera] for d in datos]
        return None
    if suf in (".csv", ".tsv", ".txt"):
        try:
            dialecto = csv.Sniffer().sniff(texto[:5000], delimiters=",;\t|")
        except csv.Error:
            if suf == ".txt":
                return None  # un .txt sin delimitador reconocible no es una tabla
            dialecto = csv.excel
        filas = [f for f in csv.reader(io.StringIO(texto), dialecto) if any(c.strip() for c in f)]
        if len(filas) >= 2:
            return filas[0], filas[1:]
    return None


def perfil_dataset(ruta: Path) -> dict:
    """El contrato de datos que la interfaz ya pintaba pero nadie calculaba:
    columnas, filas, columnas con valores centinela, nombres duplicados, y el
    esqueleto del diccionario (tipo inferido, descripción vacía para que la
    persona la rellene). Determinista."""
    tabla = _leer_tabla(ruta)
    if tabla is None:
        return {"columnas": [], "filas": 0, "valoresCentinela": 0, "nombresDuplicados": 0, "diccionario": [], "tabular": False}
    cabecera, filas = tabla
    vistos: dict[str, int] = {}
    for c in cabecera:
        vistos[c.strip().lower()] = vistos.get(c.strip().lower(), 0) + 1
    duplicados = sum(1 for v in vistos.values() if v > 1)
    centinelas = 0
    diccionario = []
    for i, col in enumerate(cabecera):
        valores = [f[i] if i < len(f) else "" for f in filas]
        nums = [n for n in (_numero(v) for v in valores) if n is not None]
        no_vacios = [v for v in valores if v.strip()]
        # Un centinela real se repite: negativos codificados (-1, -9, -99, -999) en
        # al menos el 1 % de los valores, o 999 y 9999 en al menos el 2 %. Ocho
        # valores de 657.975 que valen 999 son datos, no centinelas.
        negativos = sum(1 for x in nums if x in (-1, -9, -99, -999))
        positivos = sum(1 for x in nums if x in (999, 9999))
        con_centinela = any(v.strip() in CENTINELAS for v in valores if not _numero(v)) or (bool(nums) and len(nums) >= 10 and (negativos >= max(3, 0.01 * len(nums)) or positivos >= max(3, 0.02 * len(nums))))
        if con_centinela:
            centinelas += 1
        if nums and len(nums) >= max(3, len(no_vacios) * 0.6):
            tipo = "numerica"
            if len(set(nums)) <= 2 and all(x in (0.0, 1.0) for x in nums):
                tipo = "categorica"
        elif all(re.match(r"^\d{4}-\d{2}-\d{2}", v.strip()) for v in no_vacios[:20] if v.strip()) and no_vacios:
            tipo = "fecha"
        elif len(set(no_vacios)) == len(no_vacios) and len(no_vacios) > 10 and re.search(r"id", col, re.I):
            tipo = "identificador"
        elif len(set(no_vacios)) <= max(12, len(no_vacios) * 0.1):
            tipo = "categorica"
        else:
            tipo = "texto"
        diccionario.append({"columna": col, "descripcion": "", "tipo": tipo, "unidad": ""})
    return {"columnas": list(cabecera), "filas": len(filas), "valoresCentinela": centinelas, "nombresDuplicados": duplicados, "diccionario": diccionario, "tabular": True}


def esquema_para_modelo(ruta: Path, procedencia: dict, incluir_filas: bool = False) -> str:
    """Lo que ve el modelo de un dataset: diccionario y estadísticos por
    columna. Las filas solo si el libro de procedencia lo permite; con datos
    controlados (NIH NOT-OD-25-081, DUA de A4 y del AD Knowledge Portal) no
    salen nunca hacia el gateway."""
    resumen, muestra = resumir(ruta, filas_muestra=20)
    lineas = [f"Dataset: {procedencia.get('origen') or 'origen sin declarar'}, versión {procedencia.get('version') or '?'}, {procedencia.get('filas', 0)} filas, sha256 {str(procedencia.get('hash', ''))[:12]}." + (" SINTÉTICO." if procedencia.get("sintetico") else "")]
    dic = procedencia.get("diccionario") or []
    if dic:
        lineas.append("Diccionario de columnas:")
        lineas += [f"- {c['columna']} ({c['tipo']}{', ' + c['unidad'] if c.get('unidad') else ''}): {c['descripcion'] or 'sin descripción'}" for c in dic]
    lineas += ["Resumen estadístico:", resumen]
    if incluir_filas and procedencia.get("permiteLlmTerceros"):
        lineas += ["Primeras filas (autorizado por el libro de procedencia):", muestra[:4000]]
    else:
        lineas.append("Filas individuales: no se muestran (el libro de procedencia no autoriza enviarlas a un modelo de terceros).")
    return "\n".join(lineas)


def resumir(ruta: Path, filas_muestra: int = 40) -> tuple[str, str]:
    """(resumen determinista, muestra literal)."""
    suf = ruta.suffix.lower()
    if suf == ".pdf":
        import pymupdf

        textos = []
        with pymupdf.open(str(ruta)) as doc:
            for p in doc:
                t = p.get_text("text").strip()
                if t:
                    textos.append(f"[pág. {p.number + 1}]\n{t}")
        texto = "\n\n".join(textos)
        return f"PDF de {len(textos)} páginas con texto, {len(texto)} caracteres.", texto[:12000]
    raw = ruta.read_bytes()
    try:
        texto = raw.decode("utf-8")
    except UnicodeDecodeError:
        texto = raw.decode("latin-1", errors="replace")
    if suf == ".json":
        try:
            datos = json.loads(texto)
        except json.JSONDecodeError:
            return f"JSON inválido, {len(texto)} caracteres.", texto[:8000]
        if isinstance(datos, list) and datos and isinstance(datos[0], dict):
            cabecera = sorted({k for d in datos for k in d})
            filas = [[str(d.get(k, "")) for k in cabecera] for d in datos]
            return _resumen_tabla(cabecera, filas), json.dumps(datos[:filas_muestra], ensure_ascii=False)[:8000]
        return f"JSON con {len(texto)} caracteres.", texto[:8000]
    if suf in (".csv", ".tsv", ".txt") and ("," in texto[:2000] or ";" in texto[:2000] or "\t" in texto[:2000]):
        try:
            dialecto = csv.Sniffer().sniff(texto[:5000], delimiters=",;\t|")
        except csv.Error:
            dialecto = csv.excel
        # Una celda mas ancha que el limite de campo de csv (131072 por defecto) es
        # dato legitimo, no un fichero roto: una nota de laboratorio larga, una
        # secuencia pegada. Se sube el limite para este fichero y, si aun asi falla,
        # se cae al resumen de texto en vez de dejar sin evaluar los datos.
        limite = csv.field_size_limit()
        try:
            csv.field_size_limit(min(2**31 - 1, max(limite, len(texto) + 1)))
            lector = list(csv.reader(io.StringIO(texto), dialecto))
        except (csv.Error, OverflowError):
            lector = []
        finally:
            csv.field_size_limit(limite)
        lector = [f for f in lector if any(c.strip() for c in f)]
        if len(lector) >= 2:
            cabecera, filas = lector[0], lector[1:]
            muestra = "\n".join(dialecto.delimiter.join(f) for f in lector[: filas_muestra + 1])
            return _resumen_tabla(cabecera, filas), muestra[:8000]
    return f"Texto de {len(texto)} caracteres y {texto.count(chr(10)) + 1} líneas.", texto[:8000]
