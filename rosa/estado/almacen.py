"""El almacen: un estado, una base SQLite, y quien quiera enterarse.

Es el equivalente de `frontend/src/datos/almacen.ts` en el servidor:

- `estado` es el diccionario canonico (forma de `EstadoRosa`).
- Cada cambio pasa por `aplicar(nombre, **args)` (una accion de la interfaz)
  o por `mutar(fn)` (el bucle, que cambia varias cosas a la vez). Los dos
  suben la version, guardan la instantanea en SQLite y avisan a los
  suscriptores (las conexiones SSE del servidor).
- La tabla `acciones` es un registro solo de anadir: que se pidio, con que
  argumentos y cuando. Sirve de auditoria y para reproducir el estado.
- La tabla `llamadas` guarda cada llamada a un modelo (modelo, tokens, ms,
  corrida, iteracion) para las pantallas de gasto y calidad.

SQLite en modo WAL con un solo escritor: este proceso. Un `threading.Lock`
serializa las escrituras porque DSPy hace llamadas en hilos.

Tres garantías añadidas el 17 de septiembre de 2026 (hallazgo S-01: dos
procesos de ROSA2018 escribieron a la vez sobre rosa.db en un reinicio con el
Killer en vuelo, se perdió una decisión pagada y se rompió la cadena de
auditoría):

- Cerrojo de instancia: `Almacen.__init__` toma un `fcntl.flock` exclusivo (en Windows, `msvcrt.locking`)
  sobre `rosa.db.lock`. Otro proceso que abra la misma base espera lo que se
  le diga (`espera_cerrojo`, con aviso cada pocos segundos) y después falla
  con `AlmacenOcupado` y un mensaje claro. Dentro del mismo proceso, dos
  `Almacen` sobre la misma ruta comparten el cerrojo (lo que hacen los tests
  que simulan un reinicio) y los protege la segunda garantía. Con
  `solo_lectura=True` no se toma el cerrojo y no se puede escribir (para
  scripts de análisis mientras ROSA2018 corre).
- Escritura condicional por versión: el `UPDATE` del estado exige que la
  versión en disco sea la que este proceso cree tener. Si no lo es, se
  deshace la transacción, el almacén queda marcado como obsoleto y `mutar`
  lanza `EscritorObsoleto`: un escritor atrasado nunca pisa el estado.
- La cadena de hashes distingue una bifurcación por reinicio (una fila que
  enlaza con una fila anterior que existe) de una fila borrada (el hash
  anterior no existe) o alterada, sigue verificando tras cada rotura y admite
  una fila `reanclaje_registro` que documenta el corte y vuelve a anclar la
  cadena.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import hashlib
import json
import os
import sqlite3
import sys
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable

import orjson

# El cerrojo de instancia es `flock` en Unix. Windows no trae `fcntl`: la
# primera compañera que arrancó ROSA2018 en Windows (5 de octubre de 2026) no
# pasó del import. Allí se usa `msvcrt.locking` sobre el primer byte del
# fichero, que es exclusivo entre procesos igual que `flock` y lo suelta el
# sistema si el proceso muere.
if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

from rosa import config
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.persistencia import preparar

ESQUEMA = """
CREATE TABLE IF NOT EXISTS estado (
  clave TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  actualizado_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS acciones (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  args TEXT NOT NULL,
  resultado TEXT,
  version INTEGER NOT NULL,
  hash TEXT,
  hash_anterior TEXT
);
CREATE TABLE IF NOT EXISTS llamadas (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  modelo TEXT NOT NULL,
  rol TEXT,
  corrida_id TEXT,
  iteracion INTEGER,
  tokens_entrada INTEGER,
  tokens_salida INTEGER,
  ms INTEGER,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS ix_llamadas_corrida ON llamadas(corrida_id, seq);
"""


NOMBRE_REANCLAJE = "reanclaje_registro"
# Páginas de WAL (de 4 KB) antes de volcarlo al fichero principal: 64 MB. Ver Almacen.__init__.
WAL_AUTOCHECKPOINT_PAGINAS = 16_384


class AlmacenOcupado(RuntimeError):
    """Otro proceso tiene el cerrojo de la base: no se puede abrir para escribir."""


class EscritorObsoleto(RuntimeError):
    """La versión en disco no es la que este proceso creía tener: otro proceso
    escribió sobre la base. Este proceso no vuelve a escribir."""


def hash_fila(hash_anterior: str, t: int, nombre: str, args_json: str, resultado_json: str, version: int, actor: str | None = None) -> str:
    """sha256 de la fila y del hash de la anterior: el eslabón de la cadena.
    El actor (correo de la sesión que pidió la acción) entra en el hash cuando
    existe; las filas anteriores a la columna `actor` (sin actor) conservan su
    hash de siempre, así la cadena vieja sigue verificándose."""
    partes = [hash_anterior or "", str(t), nombre, args_json, resultado_json, str(version)]
    if actor:
        partes.append(actor)
    return hashlib.sha256("\n".join(partes).encode("utf-8")).hexdigest()


# Cerrojos de fichero tomados por este proceso, por ruta resuelta de la base:
# {ruta: [descriptor, cuántos Almacen lo comparten]}. `flock` es por descripción
# de fichero abierta, así que un segundo `open` en el mismo proceso chocaría con
# el primero: por eso se comparte por contador en vez de abrir otro descriptor.
_CERROJOS: dict[str, list] = {}
_CERROJOS_LOCK = threading.Lock()


def ruta_cerrojo(ruta: Path) -> Path:
    return ruta.with_name(ruta.name + ".lock")


def _pid_del_cerrojo(ruta_lock: Path) -> str:
    try:
        return ruta_lock.read_text(encoding="utf-8").strip() or "desconocido"
    except OSError:
        return "desconocido"


def _bloquear(fd: int) -> None:
    """Intenta el cerrojo exclusivo sin esperar; OSError si otro proceso lo tiene."""
    if sys.platform == "win32":
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _desbloquear(fd: int) -> None:
    if sys.platform == "win32":
        # `locking` actúa desde la posición actual: tiene que ser el mismo byte.
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)


def _tomar_cerrojo(ruta: Path, espera: float) -> None:
    """Toma el cerrojo exclusivo de `ruta` (fichero `<base>.lock`). Si otro
    proceso lo tiene, reintenta cada medio segundo hasta `espera` segundos,
    avisando por stderr cada 5 s, y después lanza `AlmacenOcupado`."""
    clave = str(ruta.resolve())
    with _CERROJOS_LOCK:
        if clave in _CERROJOS:
            _CERROJOS[clave][1] += 1
            return
        ruta_lock = ruta_cerrojo(ruta)
        ruta_lock.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(ruta_lock), os.O_RDWR | os.O_CREAT, 0o644)
        inicio = time.monotonic()
        ultimo_aviso = -10.0
        while True:
            try:
                _bloquear(fd)
                break
            except OSError:
                pasado = time.monotonic() - inicio
                if pasado >= espera:
                    os.close(fd)
                    raise AlmacenOcupado(
                        f"Otra ROSA2018 (PID {_pid_del_cerrojo(ruta_lock)}) sigue escribiendo en {ruta.name}: "
                        f"espera a que ese proceso termine (está cerrando o acabando una llamada al modelo) antes de arrancar otra. "
                        f"Para leer la base sin escribir, abre el almacén con solo_lectura=True."
                    ) from None
                if pasado - ultimo_aviso >= 5.0:
                    ultimo_aviso = pasado
                    print(f"Otra ROSA2018 (PID {_pid_del_cerrojo(ruta_lock)}) sigue cerrando {ruta.name}, probablemente terminando una llamada al modelo; espero ({int(pasado)} s de {int(espera)} s como máximo)...", file=sys.stderr, flush=True)
                time.sleep(0.5)
        try:
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode("utf-8"))
        except OSError:
            pass
        _CERROJOS[clave] = [fd, 1]


def _soltar_cerrojo(ruta: Path) -> None:
    clave = str(ruta.resolve())
    with _CERROJOS_LOCK:
        entrada = _CERROJOS.get(clave)
        if not entrada:
            return
        entrada[1] -= 1
        if entrada[1] > 0:
            return
        fd = entrada[0]
        del _CERROJOS[clave]
        try:
            _desbloquear(fd)
        finally:
            os.close(fd)


# orjson escribe el mismo JSON que json.dumps(ensure_ascii=False) salvo el espacio
# tras las comas, y lo hace unas diez veces más rápido: sobre el estado real del 28
# de septiembre de 2026 (31 MB), 15 ms frente a 149 por cada mutación, con ida y
# vuelta idéntica. Claves no textuales, como las convertía json.dumps. Fechas y
# dataclasses NO se convierten solas (sí lo haría orjson por defecto): igual que
# con json.dumps, meterlas en el estado es un error y tiene que verse. La única
# diferencia es NaN/Infinito, que orjson escribe como null: json.dumps escribía
# NaN, que el navegador no sabe leer (JSON.parse lanza).
_OPCIONES_JSON = orjson.OPT_NON_STR_KEYS | orjson.OPT_PASSTHROUGH_DATETIME | orjson.OPT_PASSTHROUGH_DATACLASS


def volcar_json(valor: Any) -> bytes:
    """El JSON compacto (UTF-8, sin escapar tildes) de un valor del estado."""
    return orjson.dumps(valor, option=_OPCIONES_JSON)


_CONEXION_EN_LINEA = b'"en_linea"'


def _limpiar_para_cliente(valor: Any) -> Any:
    """Quita las claves privadas (empiezan por `_`) antes de mandar el estado
    al navegador. Son banderas internas del bucle."""
    if isinstance(valor, dict):
        return {k: _limpiar_para_cliente(v) for k, v in valor.items() if not (isinstance(k, str) and k.startswith("_"))}
    if isinstance(valor, list):
        return [_limpiar_para_cliente(v) for v in valor]
    return valor


class Almacen:
    def __init__(self, ruta: Path | str | None = None, *, espera_cerrojo: float = 0.0, solo_lectura: bool = False):
        """Abre (o crea) la base. `espera_cerrojo`: segundos que se espera a
        que otro proceso suelte el cerrojo antes de fallar con `AlmacenOcupado`
        (main.py pasa varios minutos; los tests, cero). `solo_lectura`: no toma
        el cerrojo y rechaza toda escritura (scripts de análisis con ROSA2018 en
        marcha)."""
        self.ruta = Path(ruta) if ruta else config.RUTA_BD
        self.solo_lectura = bool(solo_lectura)
        self.obsoleto = False  # True cuando otro proceso escribió sobre la base (EscritorObsoleto)
        self.cerrado = False
        self._cerrojo_tomado = False
        if self.solo_lectura and not self.ruta.exists():
            raise FileNotFoundError(f"No existe {self.ruta}: en solo lectura no se crea la base")
        if not self.solo_lectura:
            _tomar_cerrojo(self.ruta, espera_cerrojo)
            self._cerrojo_tomado = True
        self._lock = threading.RLock()
        try:
            if self.solo_lectura:
                self._con = sqlite3.connect(f"file:{self.ruta}?mode=ro", uri=True, timeout=30.0, check_same_thread=False, isolation_level=None)
            else:
                self._con = sqlite3.connect(str(self.ruta), timeout=30.0, check_same_thread=False, isolation_level=None)
                self._con.execute("PRAGMA journal_mode=WAL")
                self._con.execute("PRAGMA synchronous=NORMAL")
                # Cada escritura del estado son unos 31 MB (7.500 páginas), así que con
                # el umbral por defecto (1.000 páginas, 4 MB) SQLite pasaba el WAL al
                # fichero principal en TODAS las mutaciones: 53 ms de cada commit sobre
                # la base real (28 de septiembre de 2026). Con 64 MB el volcado ocurre
                # cada dos o tres escrituras y copia cada página una sola vez, la más
                # reciente. La durabilidad no cambia: lo confirmado ya está en el WAL.
                # El WAL que queda tras volcar se recorta a ese mismo tamaño.
                self._con.execute(f"PRAGMA wal_autocheckpoint={WAL_AUTOCHECKPOINT_PAGINAS}")
                self._con.execute(f"PRAGMA journal_size_limit={WAL_AUTOCHECKPOINT_PAGINAS * 4096}")
            self._con.execute("PRAGMA busy_timeout=30000")
            if not self.solo_lectura:
                self._con.executescript(ESQUEMA)
                preparar(self._con)
                # Bases anteriores al encadenado de hashes y a la columna del actor: se añaden las columnas.
                columnas = {fila[1] for fila in self._con.execute("PRAGMA table_info(acciones)")}
                for col in ("hash", "hash_anterior", "actor"):
                    if col not in columnas:
                        self._con.execute(f"ALTER TABLE acciones ADD COLUMN {col} TEXT")
            # En solo lectura una base antigua puede no tener aún la columna `actor`.
            self._columnas_acciones = {fila[1] for fila in self._con.execute("PRAGMA table_info(acciones)")}
            ultimo = self._con.execute("SELECT hash FROM acciones ORDER BY seq DESC LIMIT 1").fetchone() if "hash" in self._columnas_acciones else None
            self._ultimo_hash: str = (ultimo[0] if ultimo and ultimo[0] else "")
            self.version = 0
            self.estado: dict[str, Any] = self._cargar()
        except Exception:
            if self._cerrojo_tomado:
                _soltar_cerrojo(self.ruta)
                self._cerrojo_tomado = False
            raise
        self._partes: dict[str, bytes] = {}
        self._serializar()  # línea base para saber qué claves toca cada mutación
        # En qué versión cambió por última vez cada clave de primer nivel (28 de
        # septiembre de 2026). Con esto el navegador baja solo lo que cambió desde
        # la versión que ya tiene (`instantanea_desde`). Al arrancar no se sabe qué
        # cambió antes, así que todas cuentan como cambiadas en la versión actual y
        # solo se contesta en parcial a quien tenga una versión POSTERIOR a esta
        # (`_minimo_parcial`): un navegador que diga tener justo esta versión pudo
        # recibirla de un proceso anterior con cambios en memoria que nunca
        # llegaron al disco, y recibe el estado entero una vez.
        self._cambio_en: dict[str, int] = {k: self.version for k in self.estado}
        self._minimo_parcial = self.version
        self._suscriptores: set[asyncio.Queue] = set()
        self._bucle_asyncio: asyncio.AbstractEventLoop | None = None
        # Caché de la instantánea pública (S-17), ahora por clave: cada clave de
        # primer nivel se limpia y se serializa una sola vez por cambio, y la
        # instantánea entera o la parcial se componen con esos trozos. Antes se
        # limpiaba y serializaba todo el estado (167 ms) en cada versión aunque
        # solo cambiara una línea de una pista. `_cliente[clave]` es (versión con la
        # que se calculó, JSON); vale mientras la clave no cambie después.
        # `_cache_json` guarda la composición entera por versión, para que todos
        # los clientes de una misma versión compartan el mismo objeto.
        self._cliente: dict[str, tuple[int, bytes]] = {}
        self._cache_json: dict[str, Any] = {"version": -1}
        self._lock_cache = threading.Lock()
        self._al_quedar_obsoleto: list[Callable[[], Any]] = []

    # -- persistencia ------------------------------------------------------

    def _cargar(self, migrar: bool = True) -> dict[str, Any]:
        fila = self._con.execute("SELECT version, json FROM estado WHERE clave='rosa'").fetchone()
        if fila is None:
            estado = P.estado_inicial()
            if self.solo_lectura:
                return estado
            self._con.execute("INSERT INTO estado VALUES ('rosa', 0, ?, ?)", (json.dumps(estado, ensure_ascii=False), P.ahora_ms()))
            return estado
        self.version = fila[0]
        estado = json.loads(fila[1])
        self._persistidas = {k: volcar_json(v) for k, v in estado.items()}
        if migrar:
            # Campos nuevos que un estado guardado con una version anterior no tenga.
            for k, v in P.estado_inicial().items():
                estado.setdefault(k, v)
            _migrar(estado)
        return estado

    def _serializar(self, componer: bool = True) -> tuple[bytes, list[str]]:
        """El JSON del estado y las claves de primer nivel que cambiaron desde
        la última escritura. Se serializa por clave (mismo coste que entero) para
        poder decir en el registro que toco cada mutación del bucle y para que el
        navegador baje solo esas (`_cambio_en`). Con orjson (`volcar_json`)."""
        partes = {k: volcar_json(v) for k, v in self.estado.items()}
        anteriores = getattr(self, "_partes", {})
        cambiaron = [k for k, v in partes.items() if anteriores.get(k) != v] + [k for k in anteriores if k not in partes]
        self._partes = partes
        return (b"{" + b",".join(volcar_json(k) + b":" + v for k, v in partes.items()) + b"}" if componer else b""), cambiaron

    def _guardar(self, texto: bytes, version_anterior: int) -> None:
        """Control optimista de versión y escritura de las claves modificadas.

        La vista SQL `estado` sigue sirviendo el JSON completo. Cada parte y la
        auditoría se confirman en la misma transacción; no se reescriben las
        corridas históricas cuando solo cambia otra clave.
        """
        cur = self._con.execute("UPDATE estado_meta SET version=?, actualizado_en=? WHERE clave='rosa' AND version=?", (self.version, P.ahora_ms(), version_anterior))
        if cur.rowcount != 1:
            en_disco = self._con.execute("SELECT version FROM estado WHERE clave='rosa'").fetchone()
            raise EscritorObsoleto(
                f"Otro proceso escribió sobre {self.ruta.name}: en disco está la versión {en_disco[0] if en_disco else 'desconocida'} y este proceso "
                f"creía tener la {version_anterior}. Este proceso deja de escribir para no pisar el estado; hay que cerrarlo y arrancar una sola ROSA2018."
            )

        persistidas = getattr(self, "_persistidas", {})
        for k in persistidas.keys() - self._partes.keys():
            self._con.execute("DELETE FROM estado_partes WHERE estado='rosa' AND clave=?", (k,))
        for k, v in self._partes.items():
            if persistidas.get(k) != v:
                self._con.execute("INSERT INTO estado_partes VALUES ('rosa', ?, CAST(? AS TEXT)) ON CONFLICT(estado, clave) DO UPDATE SET json=excluded.json", (k, v))

    # -- lectura -----------------------------------------------------------

    def instantanea(self) -> dict[str, Any]:
        """Copia del estado tal como la ve el navegador."""
        with self._lock:
            e = _limpiar_para_cliente(self.estado)
            e["conexion"] = "en_linea"
            return e

    def instantanea_json(self, request_filtrada: bool = False) -> str:
        """El JSON de la instantánea pública, compuesto una sola vez por versión
        y compartido por todos los clientes (S-17). Con `request_filtrada=True`
        devuelve el JSON sin la clave `avisos`, para que el servidor añada la
        de la persona que pregunta sin volver a serializar 10 MB; con False,
        el JSON completo con los avisos del estado. Para la misma versión
        devuelve el mismo objeto `str`."""
        with self._lock_cache:
            self._componer_entera()
            return self._cache_json["sin_avisos"] if request_filtrada else self._cache_json["completo"]

    def instantanea_desde(self, desde: int | None, request_filtrada: bool = False) -> tuple[int, bytes, bool]:
        """Lo que le falta a un navegador que ya tiene la versión `desde`:
        `(versión, JSON, parcial)`. Si `parcial`, el JSON trae solo las claves de
        primer nivel que cambiaron después de `desde` (más `conexion`), y el
        navegador las funde sobre la última copia del servidor que tenía; si no,
        es la instantánea entera y la sustituye.

        La versión es la del contenido, tomada bajo el mismo cerrojo con el que se
        eligieron las claves: si se leyera después, un cambio llegado entre medias
        daría una cabecera más nueva que el JSON, y el navegador creería tener
        algo que nunca recibió (con envíos parciales, para siempre, hasta que esa
        clave volviera a cambiar).

        Entera en vez de parcial cuando: no hay `desde`, `desde` es de otra línea
        de versiones (mayor que la actual), no es posterior al arranque o a la
        última recarga desde disco (`_minimo_parcial`), faltan en el estado claves
        que cambiaron (una clave quitada: fundir no la borraría), o cambió todo."""
        with self._lock_cache:
            with self._lock:
                version = self.version
                publicas = [k for k in self.estado if not (isinstance(k, str) and k.startswith("_"))]
                if request_filtrada:
                    publicas = [k for k in publicas if k != "avisos"]
                cambiadas: list[str] | None = None
                if isinstance(desde, int) and not isinstance(desde, bool) and self._minimo_parcial < desde <= version:
                    tras = [k for k, v in self._cambio_en.items() if v > desde]
                    if all(k in self.estado for k in tras):
                        cambiadas = [k for k in publicas if k in tras]
                if cambiadas is None or len(cambiadas) == len(publicas):
                    cambiadas = None
                else:
                    trozos = self._trozos_cliente(cambiadas, version)
            if cambiadas is None:
                self._componer_entera()
                entera = self._cache_json["sin_avisos"] if request_filtrada else self._cache_json["completo"]
                return self._cache_json["version"], entera.encode("utf-8"), False
            partes = [volcar_json(k) + b":" + trozos[k] for k in cambiadas if k != "conexion"]
            partes.append(b'"conexion":' + _CONEXION_EN_LINEA)
            return version, b"{" + b",".join(partes) + b"}", True

    def _trozos_cliente(self, claves: list[str], version: int) -> dict[str, bytes]:
        """El JSON limpio (sin claves privadas) de cada clave pedida, de la caché
        por clave o calculado ahora. Se llama con `_lock` tomado: la limpieza lee
        el estado y tiene que ver una sola versión."""
        trozos: dict[str, bytes] = {}
        for k in claves:
            guardado = self._cliente.get(k)
            if guardado is not None and self._cambio_en.get(k, version + 1) <= guardado[0]:
                trozos[k] = guardado[1]
                continue
            trozos[k] = volcar_json(_limpiar_para_cliente(self.estado[k]))
            self._cliente[k] = (version, trozos[k])
        for k in [k for k in self._cliente if k not in self.estado]:
            del self._cliente[k]
        return trozos

    def _componer_entera(self) -> None:
        """Compone (una vez por versión) la instantánea entera, con y sin la clave
        `avisos`, a partir de los trozos por clave. Con `_lock_cache` tomado."""
        if self._cache_json.get("version") == self.version and "sin_avisos" in self._cache_json:
            return
        with self._lock:
            version = self.version
            publicas = [k for k in self.estado if not (isinstance(k, str) and k.startswith("_")) and k not in ("avisos", "conexion")]
            trozos = self._trozos_cliente(publicas + (["avisos"] if "avisos" in self.estado else []), version)
        cuerpo = b",".join(volcar_json(k) + b":" + trozos[k] for k in publicas)
        sin_avisos = ("{" + (cuerpo.decode("utf-8") + "," if cuerpo else "") + '"conexion":"en_linea"}')
        avisos_json = trozos["avisos"].decode("utf-8") if "avisos" in trozos else "null"
        self._cache_json = {"version": version, "sin_avisos": sin_avisos, "avisos": avisos_json, "completo": componer_json_con_avisos(sin_avisos, avisos_json)}

    # -- escritura ---------------------------------------------------------

    def mutar(self, fn: Callable[[dict[str, Any]], Any], nombre: str = "bucle", args: dict | None = None, *, actor: str | None = None) -> Any:
        """Aplica `fn(estado)` bajo el cerrojo. Si devuelve algo distinto de
        False, sube la versión, guarda y avisa. `actor` es el correo de la
        sesión que pidió la acción (None para el bucle) y queda en la fila del
        registro, dentro del hash."""
        with self._lock:
            if self.solo_lectura:
                raise EscritorObsoleto(f"El almacén sobre {self.ruta.name} se abrió solo para leer: no puede escribir.")
            if self.obsoleto:
                raise EscritorObsoleto(f"Otro proceso escribió sobre {self.ruta.name}; este almacén ya no escribe. Cierra este proceso y arranca una sola ROSA2018.")
            # TODO lo que va entre el reducer y la transacción entra en este try.
            # Antes solo lo estaba `fn(self.estado)`, y `_serializar`, los dos
            # `json.dumps` y `hash_fila` quedaban fuera: si cualquiera de los
            # tres lanzaba, el reducer ya había mutado la memoria y nadie lo
            # deshacía, así que el valor venenoso se quedaba dentro y TODAS las
            # mutaciones siguientes fallaban en el mismo punto, para siempre.
            #
            # Reproducido el 28 de septiembre de 2026 con un solo POST: un
            # sustituto Unicode suelto (lo que produce `JSON.stringify` de una
            # cadena cortada a mitad de un emoji) lo acepta `json.loads` pero no
            # orjson. A partir de ahí el bucle seguía aplicando reducers sobre
            # memoria y pagando llamadas al modelo, la versión no subía, el SSE
            # no empujaba nada, la interfaz se quedaba congelada en la última
            # instantánea buena y al reiniciar se perdía todo.
            try:
                resultado = fn(self.estado)
                if resultado is False:
                    return False
                texto, cambiaron = self._serializar(componer=False)
                # Registro solo de anadir encadenado: cada fila lleva el hash de la
                # anterior. Borrar o alterar una fila rompe la cadena desde ahi
                # (verificar_cadena). Las mutaciones del bucle, que no traen argumentos,
                # registran que claves del estado tocaron. Estado y registro se escriben
                # en la misma transaccion: o quedan los dos o ninguno.
                t = P.ahora_ms()
                args_json = json.dumps(args if args else {"cambiaron": cambiaron}, ensure_ascii=False, default=str)
                res_json = json.dumps(resultado, default=str)
                version_nueva = self.version + 1
                h = hash_fila(self._ultimo_hash, t, nombre, args_json, res_json, version_nueva, actor or None)
            except Exception:
                # Se vuelve a la ultima version persistida. Se rellena EL MISMO
                # diccionario (no se rebindea el atributo): las corrutinas del
                # bucle que capturaron `almacen.estado` siguen viendo el estado
                # bueno.
                self._recargar_desde_disco()
                raise
            try:
                self._con.execute("BEGIN IMMEDIATE")
                version_anterior = self.version
                self.version = version_nueva
                self._guardar(texto, version_anterior)
                self._con.execute("INSERT INTO acciones(t, nombre, args, resultado, version, hash, hash_anterior, actor) VALUES (?,?,?,?,?,?,?,?)", (t, nombre, args_json, res_json, version_nueva, h, self._ultimo_hash, actor or None))
                self._con.execute("COMMIT")
            except Exception as ex:
                if self._con.in_transaction:
                    self._con.execute("ROLLBACK")
                self.version = version_nueva - 1
                # La línea base ya describe un estado que no llegó al disco: la
                # próxima escritura tiene que contar como cambiadas todas las claves,
                # o lo que tocó esta mutación no se volvería a marcar para el
                # navegador ni para el registro.
                self._partes = {}
                if not isinstance(ex, EscritorObsoleto):
                    self._recargar_desde_disco()
                if isinstance(ex, EscritorObsoleto):
                    # Fallo ruidoso y definitivo: este almacén no vuelve a escribir. La
                    # memoria vuelve a lo que hay en disco (lo que escribió el otro
                    # proceso, que es la verdad), igual que tras un reducer que lanza,
                    # para que lo que sirva este proceso mientras se cierra no sea un
                    # estado que nunca se guardó. Y se avisa a quien se apuntó con
                    # `al_quedar_obsoleto` (main.py para el bucle y el servidor: seguir
                    # llamando a modelos cuyo resultado no se puede guardar es tirar
                    # dinero).
                    self.obsoleto = True
                    print(f"ALMACÉN OBSOLETO: {ex}", file=sys.stderr, flush=True)
                    try:
                        self._recargar_desde_disco()
                    except Exception as ex2:  # noqa: BLE001  la recarga no puede tapar el fallo original
                        print(f"No se pudo recargar el estado desde disco tras quedar obsoleto: {ex2!r}", file=sys.stderr, flush=True)
                    for fn_aviso in list(self._al_quedar_obsoleto):
                        try:
                            fn_aviso()
                        except Exception as ex2:  # noqa: BLE001
                            print(f"Un aviso de almacén obsoleto falló: {ex2!r}", file=sys.stderr, flush=True)
                raise
            self._persistidas = self._partes.copy()
            self._ultimo_hash = h
            for k in cambiaron:
                self._cambio_en[k] = version_nueva
            self._avisar()
            return resultado

    def _recargar_desde_disco(self) -> None:
        """Vuelve la memoria a la última versión persistida, rellenando EL MISMO
        diccionario (no se rebindea el atributo: las corrutinas del bucle que
        capturaron `almacen.estado` siguen viendo el estado bueno). Se recarga
        CON migración: un estado guardado por una versión anterior de ROSA2018
        recibe al cargar claves que aún no están en disco hasta la primera
        escritura (por ejemplo `cuestiones` o `datasetsPrograma`); si se
        recargara sin migrar, un reducer que lanza justo después de arrancar
        dejaría en memoria un estado sin esas claves y la interfaz lo recibiría
        así (revisión adversarial del 17 de septiembre de 2026). Después se
        recalcula la línea base de las partes serializadas (B-16): si se
        dejara vacía, la siguiente mutación diría que cambiaron todas las
        claves del estado."""
        recargado = self._cargar(migrar=True)
        self.estado.clear()
        self.estado.update(recargado)
        self._serializar()
        # PERMISOS (rosa/conectores/base.py) es una CACHÉ del estado, y el reducer
        # `fijar_permiso_conector` la escribe dentro del reducer. Si la transacción
        # se deshace, el estado vuelve atrás y la caché se quedaba con el valor
        # nuevo: el proceso llamaba a un conector que una persona acababa de
        # bloquear (o dejaba de llamar a uno permitido) mientras la pantalla decía
        # lo contrario. Al recargar desde disco se vuelve a sincronizar, que es el
        # único sitio por el que pasan todos los caminos de deshacer.
        from rosa.conectores.base import PERMISOS

        PERMISOS.clear()
        PERMISOS.update(self.estado.get("permisosConectores") or {})
        # Lo que tenía el navegador puede ser de un estado que ya no existe.
        self._cambio_en = {k: self.version for k in self.estado}
        self._minimo_parcial = self.version
        self._cliente = {}

    def al_quedar_obsoleto(self, fn: Callable[[], Any]) -> None:
        """Apunta una función que se llama (una vez, desde el hilo que detectó
        el fallo) cuando otro proceso escribió sobre la base y este almacén
        deja de escribir. main.py la usa para parar el supervisor y el servidor:
        una ROSA2018 obsoleta que sigue corriendo paga llamadas al modelo cuyo
        resultado no puede guardar."""
        self._al_quedar_obsoleto.append(fn)

    def aplicar(self, nombre: str, args: dict[str, Any], *, actor: str | None = None) -> Any:
        """Una acción de la interfaz por nombre (ver ACCIONES). Devuelve el
        resultado del reducer; lanza KeyError si la acción no existe. Si hay
        `actor` (la sesión que pidió la acción) y el reducer acepta `quien`, la
        firma de la decisión es el actor: lo que mande el navegador se ignora
        (S-22), igual que el sello de tiempo."""
        fn, con_ahora = ACCIONES[nombre]
        kwargs = dict(args)
        # El sello de tiempo lo pone el servidor: las decisiones, permisos y enmiendas
        # son piezas de auditoria y no pueden fecharse desde el navegador. La unica
        # excepcion es marcarVisita, que registra el reloj de la persona.
        if con_ahora and nombre != "marcarVisita":
            kwargs["ahora"] = P.ahora_ms()
        elif con_ahora and "ahora" not in kwargs:
            kwargs["ahora"] = P.ahora_ms()
        if actor and nombre in ACCIONES_CON_QUIEN:
            kwargs["quien"] = actor
        def aplicar_con_autoria(e):
            anteriores = {tabla: {x['id'] for x in e[tabla]} for tabla in ('investigaciones', 'corridas', 'hipotesis')}
            resultado = fn(e, **kwargs)
            if actor and resultado is not False:
                for tabla in anteriores:
                    for x in e[tabla]:
                        if x['id'] not in anteriores[tabla]:
                            x['_correoResponsable'] = actor
            return resultado

        return self.mutar(aplicar_con_autoria, nombre, args, actor=actor)

    def verificar_cadena(self) -> dict[str, Any]:
        """Recorre el registro entero y recalcula cada eslabón. Distingue tres
        roturas y sigue verificando después de cada una:

        - `bifurcacion`: la fila enlaza con una fila anterior que existe pero no
          es la inmediata. Es lo que dejan dos procesos escribiendo a la vez
          (un reinicio con trabajo en vuelo, S-01): nadie borró nada.
        - `borrada`: el hash anterior no es el de ninguna fila del registro
          (falta una fila o se insertó una ajena).
        - `alterada`: el contenido de la fila no corresponde a su hash.
        - `reanclaje_suelto`: una fila que dice ser reanclaje pero no enlaza con
          la anterior (insertada a mano): no documenta nada.

        Una fila `reanclaje_registro` (ver `reanclar_registro`) documenta las
        roturas anteriores y vuelve a anclar la cadena desde ahí: las roturas
        que quedan antes de un reanclaje cuentan como cortes documentados y no
        bajan `ok`. Devuelve, además de los campos de siempre (`ok`, `filas`,
        `encadenadas`, `sinHash`, `rotaEn`, `motivo`), la lista `roturas`, el
        número de `bifurcaciones`, los `cortesDocumentados` y las filas
        `alteradas`."""
        with self._lock:
            if "hash" not in getattr(self, "_columnas_acciones", {"hash"}):
                return {"ok": True, "filas": 0, "encadenadas": 0, "sinHash": 0, "rotaEn": None, "motivo": "registro sin encadenar", "roturas": [], "bifurcaciones": 0, "alteradas": 0, "cortesDocumentados": 0, "reanclajes": [], "roturasDocumentadas": [], "ultimoHash": ""}
            col_actor = "actor" if "actor" in getattr(self, "_columnas_acciones", {"actor"}) else "NULL"
            filas = self._con.execute(f"SELECT seq, t, nombre, args, resultado, version, hash, hash_anterior, {col_actor} FROM acciones ORDER BY seq").fetchall()
        anterior = ""
        encadenadas = 0
        sin_hash = 0
        vistos: dict[str, int] = {}  # hash -> seq de la fila que lo lleva
        roturas: list[dict[str, Any]] = []
        documentadas: list[dict[str, Any]] = []
        reanclajes: list[dict[str, Any]] = []
        alteradas = 0
        rama_abierta: dict[str, Any] | None = None  # bifurcación en curso: {rotura, tipDeLaRamaPrincipal}
        for seq, t, nombre, args, resultado, version, h, h_ant, actor in filas:
            if not h:
                sin_hash += 1
                continue
            h_ant = h_ant or ""
            contenido_ok = hash_fila(h_ant, t, nombre, args, resultado or "null", version, actor or None) == h
            if not contenido_ok:
                alteradas += 1
                roturas.append({"seq": seq, "tipo": "alterada", "motivo": "el contenido de la fila no corresponde a su hash (fila alterada)"})
            if nombre == NOMBRE_REANCLAJE and contenido_ok and encadenadas > 0 and h_ant != anterior:
                # Un reanclaje que no enlaza con la fila inmediatamente anterior no lo
                # escribió `reanclar_registro` (que siempre encadena al último hash):
                # es una fila metida a mano y no documenta nada. Se cuenta como rotura
                # propia y se sigue encadenando desde ella para verificar lo que venga.
                roturas.append({"seq": seq, "tipo": "reanclaje_suelto", "t": t, "motivo": f"la fila {seq} dice ser un reanclaje pero no enlaza con la fila anterior: no documenta ningún corte (fila insertada a mano)"})
                rama_abierta = None
                vistos[h] = seq
                anterior = h
                encadenadas += 1
                continue
            if nombre == NOMBRE_REANCLAJE and contenido_ok:
                # Corte documentado: las roturas anteriores quedan explicadas por esta
                # fila y la cadena vuelve a contarse desde su hash.
                try:
                    detalle = json.loads(args or "{}")
                except ValueError:
                    detalle = {}
                reanclajes.append({"seq": seq, "t": t, "motivo": str(detalle.get("motivo", ""))[:400], "quien": str(detalle.get("quien", ""))[:120], "roturasDocumentadas": len(roturas)})
                documentadas.extend(roturas)
                roturas = []
                rama_abierta = None
                vistos[h] = seq
                anterior = h
                encadenadas += 1
                continue
            if encadenadas > 0 and h_ant != anterior:
                if rama_abierta is not None and h_ant == rama_abierta["tip_principal"]:
                    # La rama principal retoma donde estaba antes de la bifurcación: se
                    # cierra la rama lateral sin contar una rotura nueva.
                    rama_abierta["rotura"]["filas"] = seq - rama_abierta["rotura"]["seq"]
                    rama_abierta["rotura"]["hastaSeq"] = seq - 1
                    rama_abierta = None
                elif h_ant in vistos:
                    rotura = {"seq": seq, "tipo": "bifurcacion", "enlazaConSeq": vistos[h_ant], "t": t, "version": version, "filas": None, "hastaSeq": None,
                              "motivo": f"la fila {seq} enlaza con la {vistos[h_ant]} en vez de con la anterior: dos procesos de ROSA2018 escribieron a la vez (reinicio con trabajo en vuelo); ninguna fila borrada"}
                    roturas.append(rotura)
                    rama_abierta = {"rotura": rotura, "tip_principal": anterior}
                else:
                    roturas.append({"seq": seq, "tipo": "borrada", "t": t, "motivo": f"el hash anterior de la fila {seq} no es el de ninguna fila del registro (fila borrada o insertada)"})
                    rama_abierta = None
            vistos[h] = seq
            anterior = h
            encadenadas += 1
        if rama_abierta is not None:
            rama_abierta["rotura"]["filas"] = (filas[-1][0] - rama_abierta["rotura"]["seq"] + 1) if filas else None
        primera = roturas[0] if roturas else None
        bifurcaciones = sum(1 for r in roturas + documentadas if r["tipo"] == "bifurcacion")
        resumen: dict[str, Any] = {
            "ok": not roturas,
            "filas": len(filas),
            "encadenadas": encadenadas,
            "sinHash": sin_hash,
            "rotaEn": primera["seq"] if primera else None,
            "motivo": primera["motivo"] if primera else None,
            "roturas": roturas,
            "bifurcaciones": bifurcaciones,
            "alteradas": alteradas,
            "cortesDocumentados": len(reanclajes),
            "reanclajes": reanclajes,
            "roturasDocumentadas": documentadas,
            "ultimoHash": anterior,
        }
        if not roturas and reanclajes:
            resumen["motivo"] = f"cadena intacta con {len(reanclajes)} corte{'s' if len(reanclajes) != 1 else ''} documentado{'s' if len(reanclajes) != 1 else ''}"
        return resumen

    def reanclar_registro(self, motivo: str, quien: str) -> dict[str, Any]:
        """Inserta una fila `reanclaje_registro` que documenta las roturas que
        hay hoy en la cadena (con sus filas y extremos) y desde la cual la
        verificación vuelve a contar. No toca el estado ni la versión. Lo
        decide una persona con motivo escrito: la fila queda encadenada al
        último hash y guarda quién la registró."""
        motivo = str(motivo or "").strip()
        if len(motivo) < 10:
            raise ValueError("El reanclaje necesita un motivo escrito (al menos diez caracteres) que explique el corte")
        with self._lock:
            if self.solo_lectura or self.obsoleto:
                raise EscritorObsoleto("Este almacén no puede escribir")
            informe = self.verificar_cadena()
            if not informe["roturas"]:
                raise ValueError("La cadena no tiene roturas sin documentar: no hace falta reanclar")
            t = P.ahora_ms()
            detalle = {"motivo": motivo, "quien": str(quien or "")[:120], "roturas": [{k: r.get(k) for k in ("seq", "tipo", "enlazaConSeq", "filas", "hastaSeq", "t")} for r in informe["roturas"]], "ultimoHashAnterior": self._ultimo_hash}
            args_json = json.dumps(detalle, ensure_ascii=False, default=str)
            res_json = json.dumps(None)
            h = hash_fila(self._ultimo_hash, t, NOMBRE_REANCLAJE, args_json, res_json, self.version, quien or None)
            self._con.execute("BEGIN IMMEDIATE")
            try:
                self._con.execute("INSERT INTO acciones(t, nombre, args, resultado, version, hash, hash_anterior, actor) VALUES (?,?,?,?,?,?,?,?)", (t, NOMBRE_REANCLAJE, args_json, res_json, self.version, h, self._ultimo_hash, quien or None))
                self._con.execute("COMMIT")
            except Exception:
                self._con.execute("ROLLBACK")
                raise
            self._ultimo_hash = h
            return {"ok": True, "seq": self._con.execute("SELECT MAX(seq) FROM acciones").fetchone()[0], "roturasDocumentadas": len(informe["roturas"])}

    def registrar_llamada(self, modelo: str, rol: str | None, corrida_id: str | None, iteracion: int | None, tokens_entrada: int, tokens_salida: int, ms: int, ok: bool, error: str | None = None) -> None:
        """Apunta la llamada en la tabla `llamadas`, que es de donde sale la
        contabilidad del gasto y con la que se reconstruyó la hora perdida de la
        corrida 13.

        Se salta los dos casos en los que este almacén no tiene derecho a
        escribir, que hasta el 29 de septiembre de 2026 no se comprobaban:

        - Solo lectura: el INSERT lanzaba `OperationalError` en crudo desde la
          ruta de la llamada al modelo, así que una llamada que YA había
          respondido se perdía por no poder apuntar su línea de registro. La
          telemetría no puede tumbar el trabajo que documenta.
        - Obsoleto: otro proceso se quedó con la base. Seguir apuntando aquí
          mezcla el gasto de dos ROSA2018 en la misma tabla, que es exactamente
          la bifurcación del registro que `EscritorObsoleto` existe para cortar.

        Y si sqlite falla por otra cosa (disco lleno, base bloqueada), se avisa
        por stderr y la llamada sigue: perder una línea de registro es malo,
        perder la respuesta del modelo es peor."""
        if self.solo_lectura or self.obsoleto:
            return
        with self._lock:
            try:
                self._con.execute(
                    "INSERT INTO llamadas(t, modelo, rol, corrida_id, iteracion, tokens_entrada, tokens_salida, ms, ok, error) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (P.ahora_ms(), modelo, rol, corrida_id, iteracion, tokens_entrada, tokens_salida, ms, 1 if ok else 0, error),
                )
            except sqlite3.Error as ex:
                print(f"No se pudo apuntar la llamada a {modelo} en el registro de llamadas ({ex!r}); el gasto de esta llamada no sale en la contabilidad.", file=sys.stderr, flush=True)

    def evidencia_de(self, corrida_id: str) -> dict[str, Any] | None:
        """La cadena de trazabilidad de una corrida: consultas, fuentes (con la
        consulta que las trajo) y afirmaciones con veredicto. Sin los
        fragmentos completos, para que pese poco."""
        with self._lock:
            c = next((x for x in self.estado["corridas"] if x["id"] == corrida_id), None)
            if not c:
                return None
            fuentes = []
            for f in c.get("_fuentes", {}).values():
                fuentes.append(
                    {
                        "id": f["id"],
                        "referencia": f["referencia"],
                        "titulo": f["titulo"],
                        "tipo": f["tipo"],
                        "doi": f.get("doi"),
                        "pmid": f.get("pmid"),
                        "nct": f.get("nct"),
                        "anio": f.get("anio"),
                        "tipoEstudio": f.get("tipoEstudio"),
                        "relevancia": f.get("relevancia", 0),
                        "retraccion": f.get("retraccion"),
                        "retraccionDetalle": f.get("_marcaDetalle", ""),
                        "textoCompleto": bool(f.get("textoCompleto")),
                        "fragmentos": len(f.get("fragmentos", [])),
                        "extraida": bool(f.get("extraida")),
                        "iteracion": f.get("iteracion", 0),
                        "consultas": list(f.get("consultas", [])),
                        "modo": f.get("modo") or "foco",
                        "porque": f.get("porque") or "",
                        "riesgoSesgo": ({"instrumento": f["riesgoSesgo"].get("instrumento"), "global": f["riesgoSesgo"].get("global"), "dominios": [{"id": d["id"], "nombre": d["nombre"], "juicio": d["juicio"]} for d in f["riesgoSesgo"].get("dominios", [])]} if isinstance(f.get("riesgoSesgo"), dict) else None),
                    }
                )
            afirmaciones = [
                {k: a.get(k) for k in ("id", "texto", "cita", "veredicto", "motivo", "entidadDistinta", "tipo", "tema", "fuenteId", "localizador", "iteracion")}
                for a in c.get("_afirmaciones", [])
            ]
            return {"corridaId": corrida_id, "version": self.version, "consultas": list(c["busqueda"]["consultas"]), "fuentes": fuentes, "afirmaciones": afirmaciones}

    def intervalos_de_llamadas(self, corrida_id: str) -> list[tuple[int, int]]:
        """(inicio, duración) de cada llamada al modelo de la corrida, para repartir
        su pared en el tablero del método (rosa/metodo.py)."""
        with self._lock:
            return [(int(t), int(ms or 0)) for t, ms in self._con.execute("SELECT t, ms FROM llamadas WHERE corrida_id=?", (corrida_id,)).fetchall() if t is not None]

    def instantes_de_actividad(self, desde: int, hasta: int) -> list[int]:
        """Los instantes del registro de auditoría en una ventana. Mientras el
        servidor vive, el bucle escribe un `tick` cada 10 a 30 segundos, así que un
        hueco largo aquí es que estaba parado o colgado (rosa/metodo.py)."""
        with self._lock:
            return [int(t) for (t,) in self._con.execute("SELECT t FROM acciones WHERE t BETWEEN ? AND ?", (int(desde), int(hasta))).fetchall()]

    def llamadas_de(self, corrida_id: str, limite: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            filas = self._con.execute("SELECT t, modelo, rol, iteracion, tokens_entrada, tokens_salida, ms, ok, error FROM llamadas WHERE corrida_id=? ORDER BY seq DESC LIMIT ?", (corrida_id, limite)).fetchall()
        claves = ["t", "modelo", "rol", "iteracion", "tokensEntrada", "tokensSalida", "ms", "ok", "error"]
        return [dict(zip(claves, f)) for f in filas]

    def pagina_llamadas(self, corrida_id: str, desde: int = 0, limite: int = 100, hasta: int | None = None) -> dict:
        """Cursor estable: la primera página fija la última secuencia visible."""
        desde, limite = max(0, desde), max(1, min(500, limite))
        with self._lock:
            if hasta is None:
                hasta = self._con.execute("SELECT COALESCE(MAX(seq),0) FROM llamadas WHERE corrida_id=?", (corrida_id,)).fetchone()[0]
            total = self._con.execute("SELECT count(*) FROM llamadas WHERE corrida_id=? AND seq<=?", (corrida_id, hasta)).fetchone()[0]
            filas = self._con.execute("SELECT seq,t,modelo,rol,iteracion,tokens_entrada,tokens_salida,ms,ok,error FROM llamadas WHERE corrida_id=? AND seq<=? ORDER BY seq DESC LIMIT ? OFFSET ?", (corrida_id, hasta, limite, desde)).fetchall()
        claves = ('secuencia', 't', 'modelo', 'rol', 'iteracion', 'tokensEntrada', 'tokensSalida', 'ms', 'ok', 'error')
        return {'total': total, 'desde': desde, 'hasta': hasta, 'siguiente': desde + len(filas) if desde + len(filas) < total else None, 'llamadas': [dict(zip(claves, f)) for f in filas]}

    # -- suscripciones (SSE) ----------------------------------------------

    def enganchar_bucle(self, bucle: asyncio.AbstractEventLoop) -> None:
        self._bucle_asyncio = bucle

    def suscribir(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._suscriptores.add(q)
        return q

    def desuscribir(self, q: asyncio.Queue) -> None:
        self._suscriptores.discard(q)

    def _avisar(self, forzar: bool = False) -> None:
        """Despierta a los suscriptores SSE con la versión nueva. Con
        `forzar=True` pone `None` en la cola: el servidor manda la instantánea
        aunque la versión no haya cambiado (lo usa el cambio de avisos de una
        persona, que no vive en el estado)."""
        if not self._suscriptores or self._bucle_asyncio is None:
            return
        version = None if forzar else self.version

        def poner() -> None:
            for q in list(self._suscriptores):
                if q.full():
                    # Un cliente lento: se le quita lo viejo, solo importa lo ultimo.
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(version)

        try:
            self._bucle_asyncio.call_soon_threadsafe(poner)
        except RuntimeError:
            pass

    def cerrar(self) -> None:
        """Cierra SQLite y suelta el cerrojo de instancia. Solo entonces otro
        proceso puede abrir la base para escribir; por eso se llama al final
        del apagado, cuando la última mutación ya terminó."""
        with self._lock:
            if self.cerrado:
                return
            self.cerrado = True
            try:
                self._con.commit()
                self._con.close()
            finally:
                if self._cerrojo_tomado:
                    _soltar_cerrojo(self.ruta)
                    self._cerrojo_tomado = False


def componer_json_con_avisos(sin_avisos: str, avisos_json: str) -> str:
    """Añade la clave `avisos` al JSON de la instantánea sin volver a
    serializarla (S-17): el servidor pone así los avisos de cada persona."""
    if sin_avisos.strip() == "{}":
        return '{"avisos":' + avisos_json + "}"
    return sin_avisos[:-1] + ',"avisos":' + avisos_json + "}"


def componer_bytes_con_avisos(sin_avisos: bytes, avisos_json: str) -> bytes:
    """Lo mismo que `componer_json_con_avisos` para el JSON en bytes que sale de
    `instantanea_desde`, entera o parcial."""
    avisos = avisos_json.encode("utf-8")
    if sin_avisos.strip() == b"{}":
        return b'{"avisos":' + avisos + b"}"
    return sin_avisos[:-1] + b',"avisos":' + avisos + b"}"


def _migrar(estado: dict[str, Any]) -> None:
    for c in estado.get("corridas", []):
        b = c.setdefault("busqueda", {})
        b.setdefault("excluidos", [])
        b.setdefault("traidos", 0)
    for inv in estado.get("investigaciones", []):
        inv.setdefault("conocimientoOperativo", [])
        # Se recalcula siempre: es derivado del texto y la regla puede mejorar.
        from rosa import parada as PARADA

        inv["condicionParadaAutomatizada"] = PARADA.partes_automatizadas(inv.get("condicionParada", ""))
    _migrar_fragmentos(estado)
    _migrar_consultas(estado)
    _migrar_conclusiones(estado)
    _migrar_experimentos(estado)
    _migrar_rosa2018(estado)
    _migrar_grafo(estado)
    _migrar_hechos_repetidos(estado)
    _migrar_siete_modulos(estado)
    _migrar_novedad_no_comprobada(estado)
    _migrar_contexto_xy(estado)
    _migrar_supuestos_evaluados(estado)
    _migrar_relacion_laboratorio(estado)
    _migrar_gwas_sin_filtro(estado)
    _migrar_progreso_por_ventana(estado)
    _migrar_vigilante_modelos(estado)
    _migrar_gasto_grande_automatico(estado)
    _migrar_revisiones_de_modelo_como_humanas(estado)
    estado.setdefault("tareas", [])  # cola de triaje (rosa/tareas.py), 25 de septiembre de 2026


def _migrar_revisiones_de_modelo_como_humanas(estado: dict[str, Any]) -> None:
    """25 de septiembre de 2026: hasta hoy, cualquier revisión firmada con algo
    distinto de `config.QUIEN_ROSA` contaba como humana, y el Killer firma con el
    id del modelo juez. En el estado guardado eso son 131 revisiones (127 de
    `openai/anthropic/claude-opus-5`, 4 de `openai/openai/gpt-6-astra`) y CERO
    revisiones humanas de verdad en las 28 hipótesis.

    Esas revisiones llegaban al juez del torneo y al de la conclusión GRADE en el
    campo `revisiones_humanas`, cuya descripción decía "Lo que dijeron las
    personas" y cuyo docstring añadía que pesan más que las automáticas. Así que
    las conclusiones ya escritas se contaron mal y hay que rehacerlas: se marcan
    con `_reconcluirPorRevisiones` (clave privada) para que
    `corrida.motivo_para_reconcluir` lo diga con esas palabras en vez de "la
    evidencia contada cambió", que sería falso: la evidencia no cambió, cambió
    quién se creía que la había revisado.

    No se toca ninguna revisión ni ninguna conclusión: solo se marca. La marca la
    quita `_concluir_hipotesis` al reescribir. Idempotente: una hipótesis ya
    marcada, o sin conclusión previa (que se rehace igual), no se vuelve a tocar."""
    from rosa.bucle.contexto import es_persona

    for h in estado.get("hipotesis", []) or []:
        if not isinstance(h, dict) or h.get("_reconcluirPorRevisiones") or not isinstance(h.get("conclusion"), dict):
            continue
        revisiones: list[Any] = h["revisiones"] if isinstance(h.get("revisiones"), list) else []
        if any(isinstance(r, dict) and r.get("nota") and not es_persona(r.get("quien")) and str(r.get("quien") or "") != "Rosa" for r in revisiones):
            h["_reconcluirPorRevisiones"] = True


def _migrar_gasto_grande_automatico(estado: dict[str, Any]) -> None:
    """Regla de Emir del 18 de septiembre de 2026: dentro de una corrida con tope,
    el gasto grande de una iteración no se consulta; ROSA2018 sigue y deja un
    aviso. La autonomía "gastar_grande" pasa de "preguntar" a "actuar" una sola
    vez (la marca evita rehacerlo si la persona vuelve a poner "preguntar")."""
    aut = estado.get("autonomia")
    if not isinstance(aut, dict) or estado.get("_gastoGrandeMigrado"):
        return
    if aut.get("gastar_grande") == "preguntar":
        aut["gastar_grande"] = "actuar"
    estado["_gastoGrandeMigrado"] = True


def _migrar_vigilante_modelos(estado: dict[str, Any]) -> None:
    """Claves del vigilante de modelos (18 de septiembre de 2026) en estados
    guardados antes: `saludModelos` en la raíz (vacío: nunca se midió) y
    `esperandoModelo` en cada corrida (None: no espera a ningún modelo). Una
    corrida que quedó en `esperando_modelo` sin el registro de qué esperaba no
    puede sondear nada: vuelve a en marcha y el paso pendiente se reintenta.
    Idempotente: la segunda pasada no cambia nada."""
    salud = estado.get("saludModelos")
    if not isinstance(salud, dict):
        estado["saludModelos"] = {}
    for c in estado.get("corridas", []):
        c.setdefault("esperandoModelo", None)
        if c.get("estado") == "esperando_modelo" and not isinstance(c.get("esperandoModelo"), dict):
            c["estado"] = "en_marcha"


PREFIJO_NOVEDAD_VACIA = "Sin precedente claro entre 0 obras"


def _migrar_novedad_no_comprobada(estado: dict[str, Any]) -> None:
    """Hallazgo S-02: el paso de novedad escribía "sin precedente" cuando la
    búsqueda de precedentes devolvía 0 obras, es decir, sin haber comparado
    nada. Toda hipótesis cuyo precedente empiece por "Sin precedente claro
    entre 0 obras" pasa a `no_comprobado` con el motivo, para que el bucle la
    vuelva a comprobar y para que la interfaz y el Killer no la den por nueva.
    Idempotente: una vez cambiada, el detalle ya no empieza por ese texto.
    Tolera hipótesis o novedades con forma rara (no dict): las salta."""
    hipotesis = estado.get("hipotesis")
    for h in hipotesis if isinstance(hipotesis, list) else []:
        if not isinstance(h, dict):
            continue
        novedad = h.get("novedad")
        precedente = novedad.get("precedente") if isinstance(novedad, dict) else None
        if not isinstance(precedente, dict):
            continue
        detalle = precedente.get("detalle")
        if isinstance(detalle, str) and detalle.startswith(PREFIJO_NOVEDAD_VACIA):
            precedente["estado"] = "no_comprobado"
            precedente["motivo"] = "la búsqueda de precedentes devolvió 0 obras: no se comparó con ninguna publicación"
            precedente["detalle"] = "No comprobado: la búsqueda de precedentes devolvió 0 obras (la consulta estaba mal construida), así que no se comparó con ninguna publicación. Pendiente de volver a buscar. Antes decía: " + detalle[:300]


# Lo que decía la flecha X -> Y del grafo causal antes del 23 de septiembre de
# 2026, sin tildes y en minúsculas (hay grafos guardados con y sin tildes).
_XY_NINGUNA = "lo que afirma la hipotesis (ninguna afirmacion sostenida nombra las dos cosas a la vez)"
_XY_NOMBRAN = "lo que afirma la hipotesis (con afirmaciones sostenidas que nombran las dos cosas)"


def _llano(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)).lower()


def _migrar_contexto_xy(estado: dict[str, Any]) -> None:
    """La flecha X -> Y del grafo causal decía "ninguna afirmación sostenida
    nombra las dos cosas a la vez" cada vez que su regla (los primeros 12
    caracteres de X y de Y dentro de una afirmación) no casaba, y en 16 de los
    21 grafos guardados sí había afirmaciones que nombraban las dos. Pasa a
    `causal.CONTEXTO_XY`. Si alguna flecha había subido a inferencia con
    evidencia por esa regla (solo por nombrar las dos cosas), vuelve a
    supuesto, y su relación en el modelo de mundo también. De paso, el resumen
    del grafo acotado recupera su tilde ("está acotado") y su singular ("falta
    1"). Idempotente: el texto nuevo no casa con los antiguos. Tolera formas
    raras: las salta."""
    from rosa import causal as CAUSAL

    rebajadas: set[str] = set()
    hipotesis = estado.get("hipotesis")
    for h in hipotesis if isinstance(hipotesis, list) else []:
        grafo = h.get("grafoCausal") if isinstance(h, dict) else None
        aristas = grafo.get("aristas") if isinstance(grafo, dict) else None
        for a in aristas if isinstance(aristas, list) else []:
            if not isinstance(a, dict) or a.get("de") != "X" or a.get("a") != "Y" or not isinstance(a.get("contexto"), str):
                continue
            antes = _llano(a["contexto"])
            if antes not in (_XY_NINGUNA, _XY_NOMBRAN):
                continue
            if antes == _XY_NOMBRAN and a.get("tipo") == "inferencia_con_evidencia":
                a["tipo"] = "supuesto"
                if isinstance(h.get("id"), str):
                    rebajadas.add(h["id"])
            a["contexto"] = CAUSAL.CONTEXTO_XY
        resumen = grafo.get("resumen") if isinstance(grafo, dict) else None
        if isinstance(resumen, str) and resumen.startswith("El efecto esta acotado"):
            resumen = "El efecto está acotado" + resumen[len("El efecto esta acotado"):]
            grafo["resumen"] = resumen.replace("; faltan 1.", "; falta 1.")
    relaciones = estado.get("relaciones")
    for r in relaciones if isinstance(relaciones, list) else []:
        if isinstance(r, dict) and r.get("hipotesisId") in rebajadas and r.get("tipo") == "inferencia_con_evidencia":
            r["tipo"] = "supuesto"


# El total que devolvía GWAS Catalog cuando ignoraba el filtro por gen: el
# catálogo entero. Una conclusión genética que lo cita salió de datos rotos.
_GWAS_SIN_FILTRO = "1192604"
_NOTA_GWAS = "Por comprobar otra vez: se sacó de GWAS Catalog cuando el conector no filtraba por gen (devolvía el catálogo entero y miraba 50 asociaciones de otras enfermedades); arreglado el 25 de septiembre de 2026."


def _migrar_gwas_sin_filtro(estado: dict[str, Any]) -> None:
    """Lo que ROSA2018 concluyó de GWAS Catalog con el conector roto (hasta el
    25 de septiembre de 2026) vuelve a "por comprobar": la novedad genética de
    la hipótesis pasa a no_comprobado (el paso de novedad la repite con el
    conector arreglado, sin modelo) y la capa genética del perfil de diana a
    no_pude_comprobar. Para GFAP el cero era cierto por casualidad; para APOE,
    falso (138 asociaciones). Se reconoce por el total del catálogo entero en
    el texto. Idempotente: el texto nuevo ya no lo lleva."""
    for h in estado.get("hipotesis", []):
        if not isinstance(h, dict):
            continue
        nov = h.get("novedad")
        if isinstance(nov, dict):
            g = nov.get("genetica")
            if isinstance(g, dict) and _GWAS_SIN_FILTRO in str(g.get("detalle") or ""):
                nov["genetica"] = {"estado": "no_comprobado", "detalle": _NOTA_GWAS}
        perfil = h.get("perfilDiana")
        for capa in (perfil.get("capas") or []) if isinstance(perfil, dict) else []:
            if isinstance(capa, dict) and _GWAS_SIN_FILTRO in str(capa.get("detalle") or ""):
                capa["estado"] = "no_pude_comprobar"
                capa["direccion"] = None
                capa["detalle"] = _NOTA_GWAS


def _migrar_relacion_laboratorio(estado: dict[str, Any]) -> None:
    """Las afirmaciones de laboratorio guardadas sin `relacion` (25 de
    septiembre de 2026): certeza.py las contaba como apoyo "de origen" aunque
    el laboratorio hubiera dado un negativo. Se les pone la relación por la
    clasificación del resultado o, si no la hay, por su veredicto; lo que no es
    apoyo ni negativo (inconcluso, corrección de contexto, sin veredicto) sale
    de la evidencia y queda guardado en el resultado del experimento. Y se
    marcan como sintéticas las que salieron de un fichero que lo dice en el
    nombre: se guardaron antes de que ROSA2018 lo detectara (S-18).
    Idempotente: solo toca las que no tienen relación."""
    from rosa.bucle.corrida import RELACION_LABORATORIO, es_resultado_sintetico

    for h in estado.get("hipotesis", []):
        if not isinstance(h, dict) or not isinstance(h.get("afirmaciones"), list):
            continue
        x_ = h.get("experimento")
        x: dict[str, Any] = x_ if isinstance(x_, dict) else {}
        r_ = x.get("resultado")
        r: dict[str, Any] = r_ if isinstance(r_, dict) else {}
        quedan = []
        for a in h["afirmaciones"]:
            cita = str(a.get("cita") or "") if isinstance(a, dict) else ""
            if not (cita.startswith("[Datos del laboratorio") or cita.startswith("[Datos de prueba")) or a.get("relacion"):
                quedan.append(a)
                continue
            fichero = (a.get("trayectoria") or {}).get("id") if isinstance(a.get("trayectoria"), dict) else None
            if es_resultado_sintetico(x, fichero or r.get("fichero"), ""):
                a["sintetico"] = True
            relacion = RELACION_LABORATORIO.get(str(r.get("clasificacion") or "")) or {"confirma": "apoya", "refuta": "contradice"}.get(str(r.get("veredicto") or ""))
            if relacion:
                a["relacion"] = relacion
                quedan.append(a)
            elif r:
                r.setdefault("afirmacionRetirada", a)
        h["afirmaciones"] = quedan


def _migrar_supuestos_evaluados(estado: dict[str, Any]) -> None:
    """El sello de vigencia de los supuestos (rosa/vigencia.py, 23 de
    septiembre de 2026). Tres cosas, idempotentes:

    1. A la hipótesis evaluada antes de que existiera el sello se le
       reconstruye con lo que el estado guarda (fecha de la revisión profunda,
       regla por esa fecha, afirmaciones de entonces por los eventos).
    2. La fecha pública de petición sigue a la marca interna `_revisionPedida`.
    3. Las hipótesis vivas evaluadas con una regla hasta
       `REEVALUAR_AL_CARGAR_HASTA_REGLA` quedan con la revisión pedida, una sola
       vez por hipótesis (`reevaluacionAutomatica`): si luego se abandona por
       falta de presupuesto, se vuelve a pedir desde la pantalla, no en cada
       arranque. El bucle la atiende como cualquier revisión pedida: reevalúa
       los supuestos con la evidencia propia y vuelve a pasar el Killer (salvo
       en las aceptadas, que ya decidió una persona).

    Tolera hipótesis y sellos con forma rara: los salta."""
    from rosa import vigencia as VIGENCIA

    ahora = P.ahora_ms()
    hipotesis = estado.get("hipotesis")
    pedidas: dict[str, int] = {}
    for h in hipotesis if isinstance(hipotesis, list) else []:
        if not isinstance(h, dict):
            continue
        if not isinstance(h.get("supuestosEvaluados"), dict):
            s = VIGENCIA.reconstruir_sello(h, estado.get("eventos"))
            if s is not None:
                h["supuestosEvaluados"] = s
        VIGENCIA.reconciliar(h, ahora)
        s = h.get("supuestosEvaluados")
        if not (VIGENCIA.es_viva(h) and isinstance(s, dict) and isinstance(s.get("regla"), int) and 1 <= s["regla"] <= VIGENCIA.REEVALUAR_AL_CARGAR_HASTA_REGLA and not s.get("reevaluacionAutomatica")):
            continue
        VIGENCIA.pedir(h, ahora)
        s["reevaluacionAutomatica"] = True
        mensajes = (h.get("procedencia") or {}).get("mensajes")
        if isinstance(mensajes, list):
            mensajes.append({"id": P.nuevo_id("m"), "de": "revisor", "texto": "Revisión pedida al cargar: sus supuestos se evaluaron con la regla anterior al 18 de septiembre de 2026, cuando el evaluador no miraba la evidencia propia de la hipótesis sino el principio de las afirmaciones de la corrida. ROSA2018 los reevalúa con la regla de hoy y vuelve a pasar el Killer.", "creadoEn": ahora})
        inv = h.get("investigacionId")
        if isinstance(inv, str):
            pedidas[inv] = pedidas.get(inv, 0) + 1
    for inv, n in pedidas.items():
        A.con_evento(estado, inv, "revision_automatica", f"Supuestos evaluados con la regla anterior al 18 de septiembre: ROSA2018 vuelve a revisar {n} hipótesis con la regla de hoy (supuestos y Killer).", None, ahora)


def _migrar_progreso_por_ventana(estado: dict[str, Any]) -> None:
    """Hallazgo sobre el recuento de hipótesis nuevas por iteración: la serie de
    progreso de las corridas terminadas contaba `hipotesisNuevas` con una
    regla distinta a la que usa el resto de ROSA2018. Se recalcula con
    `rosa.progreso.hipotesis_nacidas_en` (ventana temporal de la iteración) y,
    si la corrida ya tenía métrica, se rehace la métrica. Idempotente: el
    recálculo da lo mismo cada vez. Si `hipotesis_nacidas_en` aún no existe en
    este árbol (la escribe otro grupo), no se toca nada."""
    try:
        from rosa import progreso as PROG

        nacidas = getattr(PROG, "hipotesis_nacidas_en", None)
        recalcular = getattr(PROG, "recalcular_progreso", None)
    except Exception:  # noqa: BLE001
        nacidas = recalcular = None
    if recalcular is not None:
        # Una sola regla para todos: la de rosa/progreso.py (la misma que corre el
        # supervisor al arrancar). Aquí solo se adelanta a la carga del estado.
        try:
            recalcular(estado)
        except Exception as ex:  # noqa: BLE001  la carga del estado no se tumba por el recuento, pero se dice
            print(f"La migración del progreso por ventana temporal falló y se deja como estaba: {ex!r}", file=sys.stderr, flush=True)
        return
    if nacidas is None:
        return
    corridas = estado.get("corridas")
    iteraciones = estado.get("iteraciones")
    if not isinstance(corridas, list) or not isinstance(iteraciones, list):
        return
    for c in corridas:
        if not isinstance(c, dict) or c.get("estado") not in ("terminada", "detenida"):
            continue
        serie = c.get("progreso")
        if not isinstance(serie, list) or not serie:
            continue
        por_numero = {it.get("numero"): it for it in iteraciones if isinstance(it, dict) and it.get("corridaId") == c.get("id")}
        cambiado = False
        for p in serie:
            if not isinstance(p, dict):
                continue
            it = por_numero.get(p.get("iteracion"))
            if not it:
                continue
            try:
                n = len(nacidas(estado, c.get("investigacionId"), it))
            except Exception:  # noqa: BLE001  una iteración con forma rara no tumba la carga
                continue
            if p.get("hipotesisNuevas") != n:
                p["hipotesisNuevas"] = n
                cambiado = True
        if cambiado and c.get("metrica") is not None:
            try:
                c["metrica"] = PROG.metrica_de_corrida(estado, c["id"])
            except Exception:  # noqa: BLE001
                pass


def _migrar_siete_modulos(estado: dict[str, Any]) -> None:
    """Claves de los siete módulos del 16 de septiembre de 2026 (ruta
    terapéutica, perfil de la diana, alternativas, mapa de la enfermedad,
    mapa de rutas, cifras de aprendizaje, registro de datasets del programa).
    Un estado guardado antes no las tiene: cada una entra vacía (None o lista)
    y el bucle la rellena cuando toque. Idempotente: no pisa lo ya escrito.
    Tolera registros con formas raras (una hipótesis que no sea dict se
    salta; una lista de hipótesis o de investigaciones que no sea lista se
    trata como vacía) para no romper nunca la carga del estado real."""
    if not isinstance(estado.get("datasetsPrograma"), list):
        estado["datasetsPrograma"] = []
    hipotesis = estado.get("hipotesis")
    for h in hipotesis if isinstance(hipotesis, list) else []:
        if not isinstance(h, dict):
            continue
        h.setdefault("ruta", None)
        h.setdefault("perfilDiana", None)
        if not isinstance(h.get("alternativas"), list):
            h["alternativas"] = []
    investigaciones = estado.get("investigaciones")
    for inv in investigaciones if isinstance(investigaciones, list) else []:
        if not isinstance(inv, dict):
            continue
        inv.setdefault("mapaEnfermedad", None)
        inv.setdefault("mapaRuta", None)
        inv.setdefault("cifrasAprendizaje", None)


def _migrar_grafo(estado: dict[str, Any]) -> None:
    """Claves del grafo de evidencia (16 de septiembre de 2026): enlaces entre
    hechos y afirmaciones, cuestiones persistentes, ataques y fusiones entre
    hipótesis, pendientes de revisar. Un estado guardado antes no las tiene."""
    estado.setdefault("cuestiones", [])
    for h in estado.get("hechos", []):
        h.setdefault("citas", [])
        h.setdefault("historial", [])
        h.setdefault("afirmacionIds", [])
        h.setdefault("sustituyeA", [])
        h.setdefault("sustituidoPor", None)
        h.setdefault("resuelveA", [])
        h.setdefault("contradiceA", [])
        h.setdefault("cerradoEn", None)
    for h in estado.get("hipotesis", []):
        h.setdefault("ataca", [])
        h.setdefault("conflictoCon", [])
        h.setdefault("redundanteCon", [])
        h.setdefault("absorbe", [])
        h.setdefault("fusionadaEn", None)
        h.setdefault("fusionPropuesta", None)
        h.setdefault("pendienteRevision", None)


def _migrar_hechos_repetidos(estado: dict[str, Any]) -> None:
    """Hallazgo M-08 (revisión del 17 de septiembre de 2026): el modelo de mundo
    guardaba hechos repetidos con otras palabras (el mismo artículo traído en
    otra corrida, o heredados ya repetidos al bifurcar) y 333 de 381 hechos sin
    enlace a la afirmación que los sostenía. `rosa.hechos.migrar` enlaza cada
    hecho sin `afirmacionIds` con las afirmaciones de su fuente que quedan en
    las corridas (misma fuente, misma página, texto que lo cubre) y funde los
    repetidos de cada investigación en el más antiguo, sumando procedencia y
    remapeando lo que apuntaba a ellos; deja un evento por investigación que
    cambió. Idempotente: la segunda carga no encuentra nada. Va después de
    `_migrar_grafo`, que pone las claves del grafo en los hechos antiguos. Si
    falla, la carga del estado sigue y se dice en la salida de error."""
    try:
        from rosa import hechos as H

        H.migrar(estado)
    except Exception as ex:  # noqa: BLE001  la carga del estado no se tumba por esta migración, pero se dice
        print(f"La migración de hechos repetidos falló y se deja como estaba: {ex!r}", file=sys.stderr, flush=True)


def _migrar_rosa2018(estado: dict[str, Any]) -> None:
    """Campos de septiembre de 2026 (misión, tarjeta, versiones, decisiones,
    puerta, procedencia de datasets) en estados guardados antes. Las
    políticas se refrescan siempre desde el código: no viven en el estado."""
    estado["politicas"] = P._politicas()
    if not estado.get("metodos"):
        estado["metodos"] = P.metodos_iniciales()
    if not estado.get("relaciones"):
        from rosa.causal import relaciones_iniciales

        estado["relaciones"] = relaciones_iniciales()
    # El catalogo de conectores vive en el codigo, como las politicas.
    from rosa.conectores import REGISTRO, catalogo
    from rosa.conectores.base import PERMISOS

    estado.setdefault("permisosConectores", {})
    PERMISOS.clear()
    PERMISOS.update(estado["permisosConectores"])
    # Los contadores de uso VIVEN EN EL PROCESO (`Conector.usos`, `.errores`,
    # `.ultimo_uso`) y el catálogo del código los sobreescribía con cero en cada
    # arranque. Resultado, medido el 29 de septiembre de 2026: el estado guarda
    # 1.099 consultas a conectores hechas de verdad y la pantalla de Conectores
    # decía que los 87 tienen 0 usos y 0 errores, que es justo lo que esa pantalla
    # existe para enseñar (cuál responde y cuál lleva fallando). Se siembran desde
    # lo guardado antes de rehacer el catálogo, así que siguen sumando.
    for guardado in estado.get("conectores") or []:
        if not isinstance(guardado, dict):
            continue
        c = REGISTRO.get(str(guardado.get("nombre") or ""))
        if c is None:
            continue
        c.usos = max(int(c.usos or 0), int(guardado.get("usos") or 0))
        c.errores = max(int(c.errores or 0), int(guardado.get("errores") or 0))
        ultimo = guardado.get("ultimoUso")
        if isinstance(ultimo, int) and (c.ultimo_uso is None or ultimo > c.ultimo_uso):
            c.ultimo_uso = ultimo
    estado["conectores"] = catalogo()
    from rosa import skills as SK

    estado["skills"] = SK.catalogo()
    for inv in estado.get("investigaciones", []):
        inv.setdefault("memoria", [])
        inv.setdefault("preguntasABases", [])
    for a in estado.get("artefactos", []):
        for v in a.get("versiones", []):
            v.setdefault("procedencia", A.procedencia_artefacto())
    for it in estado.get("iteraciones", []):
        it.setdefault("revisionRegistro", None)
    for h in estado.get("hipotesis", []):
        h.setdefault("consultas", [])
        h.setdefault("contextoBases", None)
        for k, v in P.novedad_pendiente().items():
            h.setdefault("novedad", {}).setdefault(k, v)
    for inv in estado.get("investigaciones", []):
        inv.setdefault("mision", None)
        inv.setdefault("puertaReproduccion", P.puerta_reproduccion())
        if inv.get("mision"):
            for k, v in P.mision_vacia().items():
                inv["mision"].setdefault(k, v)
        for ds in inv.get("datasets", []):
            ds.setdefault("procedencia", None)
    for c in estado.get("corridas", []):
        c.setdefault("pregunta", None)
        c["gasto"].setdefault("usd", 0.0)
    for h in estado.get("hipotesis", []):
        h.setdefault("prerregistradaEn", h.get("creadaEn", 0))
        h.setdefault("tarjeta", None)
        h.setdefault("version", 1)
        h.setdefault("versiones", [])
        h.setdefault("decisionKiller", None)
        h.setdefault("bloqueos", [])
        h.setdefault("candidata", False)
        h.setdefault("dossierArtefactoId", None)
        h.setdefault("ejecuciones", [])
        for a in h.get("afirmaciones", []):
            a.setdefault("tipo", "literatura")
            a.setdefault("clase", "derivado" if a.get("tipo") == "dato" and a.get("trayectoria") else "literatura")
            a.setdefault("sintetico", False)
    # Los bloqueos se recalculan al arrancar: la regla vive en el codigo y puede
    # haber cambiado desde que se guardaron.
    from rosa.priorizacion import bloqueos_de

    for h in estado.get("hipotesis", []):
        h["bloqueos"] = bloqueos_de(estado, h)
        if h["bloqueos"]:
            h["candidata"] = False


def _migrar_experimentos(estado: dict[str, Any]) -> None:
    """Los experimentos del primer esquema (protocolo en un párrafo, criterios
    dentro del ensayo) se regeneran si aún no se asignaron. Los ya
    prerregistrados no se tocan: el prerregistro es inmutable."""
    for h in estado.get("hipotesis", []):
        x = h.get("experimento")
        if x and "confirma" not in x and x.get("estado") == "propuesto":
            h["experimento"] = None
            h.pop("_experimentoIntentado", None)


def _migrar_conclusiones(estado: dict[str, Any]) -> None:
    """Las conclusiones escritas con el primer esquema (grado único, sin
    certeza, dirección ni factores) se retiran para que el bucle las
    reescriba con el esquema GRADE."""
    for h in estado.get("hipotesis", []):
        c = h.get("conclusion")
        if c and ("certeza" not in c or "hipotesisBreve" not in c):
            h["conclusion"] = None
            h.pop("_conclusionIntentada", None)
    for it in estado.get("iteraciones", []):
        r = it.get("resumenLlano")
        if r and "mensajesClave" not in r:
            it.pop("resumenLlano", None)  # ausente = pendiente; None = el modelo fallo
            it.pop("_llanoIntentado", None)


def _migrar_fragmentos(estado: dict[str, Any]) -> None:
    """Las hipótesis anteriores al 10 de septiembre de 2026 no llevaban el
    pasaje literal en cada afirmación; se recupera de las afirmaciones de la
    corrida por su cita y texto."""
    for h in estado.get("hipotesis", []):
        if all("fragmento" in a for a in h.get("afirmaciones", [])):
            continue
        corridas = [c for c in estado.get("corridas", []) if c["investigacionId"] == h["investigacionId"]]
        indice = {}
        for c in corridas:
            for a in c.get("_afirmaciones", []):
                indice[(a["cita"], a["texto"])] = (a.get("fragmento") or "")[:600]
        for a in h.get("afirmaciones", []):
            a.setdefault("fragmento", indice.get((a["cita"], a["texto"]), ""))


def _migrar_consultas(estado: dict[str, Any]) -> None:
    """Ajustes a estados guardados por versiones anteriores de ROSA2018. Cada uno
    es idempotente. Hoy: las consultas de búsqueda anteriores al 10 de
    septiembre de 2026 no llevaban `iteración`; se infiere por la fecha dentro
    de la ventana de cada iteración de su corrida."""
    for c in estado.get("corridas", []):
        its = sorted([i for i in estado.get("iteraciones", []) if i["corridaId"] == c["id"]], key=lambda i: i["numero"])
        for q in c.get("busqueda", {}).get("consultas", []):
            if q.get("iteracion"):
                continue
            for i in its:
                fin = i["terminadaEn"] if i["terminadaEn"] is not None else float("inf")
                if i["planPropuestoEn"] <= q["fecha"] <= fin:
                    q["iteracion"] = i["numero"]
                    break
            else:
                if its:
                    q["iteracion"] = its[-1]["numero"]


def _con_ahora(fn: Callable) -> bool:
    return "ahora" in inspect.signature(fn).parameters


# Nombre de la accion en la interfaz -> (funcion, si necesita `ahora`).
# Los nombres son los de `acciones` en almacen.ts, en camelCase, para que la
# correspondencia sea de uno a uno.
_TABLA: dict[str, Callable] = {
    "marcarVisita": A.marcar_visita,
    "pausarCorrida": A.pausar_corrida,
    "reanudarCorrida": A.reanudar_corrida,
    "detenerCorrida": A.detener_corrida,
    "ampliarPresupuesto": A.ampliar_presupuesto,
    "dirigirCorrida": A.dirigir_corrida,
    "editarPlan": A.editar_plan,
    "aprobarPlan": A.aprobar_plan,
    "fijarAutoaprobacionPlan": A.fijar_autoaprobacion_plan,
    "detenerPista": A.detener_pista,
    "detenerProceso": A.detener_proceso,
    "volverAIteracion": A.volver_a_iteracion,
    "resolverSolicitud": A.resolver_solicitud,
    "resolverSolicitudes": A.resolver_solicitudes,
    "revocarPermiso": A.revocar_permiso,
    "resolverIncidencia": A.resolver_incidencia,
    "fijarAutonomia": A.fijar_autonomia,
    "revisarHipotesis": A.revisar_hipotesis,
    "votarRelevancia": A.votar_relevancia,
    "solicitarRevision": A.solicitar_revision,
    "reevaluarSupuestos": A.reevaluar_supuestos,
    "replicarHipotesis": A.replicar_hipotesis,
    "proponerHipotesis": A.proponer_hipotesis,
    "asignarExperimento": A.asignar_experimento,
    "registrarDatosExperimento": A.registrar_datos_experimento,
    "anadirComentario": A.anadir_comentario,
    "editarComentario": A.editar_comentario,
    "quitarComentario": A.quitar_comentario,
    "enviarComentarios": A.enviar_comentarios,
    "inyectarDebilidad": A.inyectar_debilidad,
    "recomprobarRetracciones": A.recomprobar_retracciones,
    "crearInvestigacion": A.crear_investigacion,
    "crearInvestigacionEIniciar": A.crear_investigacion_e_iniciar,
    "bifurcarInvestigacion": A.bifurcar_investigacion,
    "editarInvestigacion": A.editar_investigacion,
    "actualizarConfiguracion": A.actualizar_configuracion,
    "fijarAmplitud": A.fijar_amplitud,
    "anadirDataset": A.anadir_dataset,
    "decidirDataset": A.decidir_dataset,
    "aprobarDiccionario": A.aprobar_diccionario,
    "corregirDataset": A.corregir_dataset,
    "clasificarDataset": A.clasificar_dataset,
    "destacarArtefacto": A.destacar_artefacto,
    "guardarArtefacto": A.guardar_artefacto,
    "cambiarEstadoCaso": A.cambiar_estado_caso,
    "editarRespuestaCaso": A.editar_respuesta_caso,
    "editarRecuerdo": A.editar_recuerdo,
    "borrarRecuerdo": A.borrar_recuerdo,
    "anadirCriterio": A.anadir_criterio,
    "borrarCriterio": A.borrar_criterio,
    "actualizarAvisos": A.actualizar_avisos,
    "actualizarPoliticaEsperas": A.actualizar_politica_esperas,
    "borrarPlanGuardado": A.borrar_plan_guardado,
    "iniciarCorrida": A.iniciar_corrida,
    # ROSA2018
    "aprobarMision": A.aprobar_mision,
    "reformularHipotesis": A.reformular_hipotesis,
    "eximirPuerta": A.eximir_puerta,
    "cerrarPuerta": A.cerrar_puerta,
    "anadirReproduccion": A.anadir_reproduccion,
    "pedirAnalisis": A.pedir_analisis,
    "promoverAprendizaje": A.promover_aprendizaje,
    "revertirAprendizaje": A.revertir_aprendizaje,
    "fusionarHipotesis": A.fusionar_hipotesis,
    "rechazarFusion": A.rechazar_fusion,
    "abrirCuestion": A.abrir_cuestion,
    "resolverCuestion": A.resolver_cuestion,
    "descartarCuestion": A.descartar_cuestion,
    "reabrirCuestion": A.reabrir_cuestion,
    "atenderPendiente": A.atender_pendiente,
    "generarDossier": A.generar_dossier,
    "emitirDocumento": A.emitir_documento,
    "actualizarProcedenciaDataset": A.actualizar_procedencia_dataset,
    "evaluarAprendizaje": A.evaluar_aprendizaje,
    "actualizarPregunta": A.actualizar_pregunta,
    "actualizarMetodo": A.actualizar_metodo,
    "enmendarExperimento": A.enmendar_experimento,
    "enmendarLectura": A.enmendar_lectura,
    "registrarProtocoloReal": A.registrar_protocolo_real,
    "cambiarEstadoArea": A.cambiar_estado_area,
    "registrarEvaluacion": A.registrar_evaluacion,
    "registrarSelloExterno": A.registrar_sello_externo,
    "etiquetarComprobacion": A.etiquetar_comprobacion,
    "anadirConocimientoOperativo": A.anadir_conocimiento_operativo,
    "quitarConocimientoOperativo": A.quitar_conocimiento_operativo,
    "fijarPermisoConector": A.fijar_permiso_conector,
    "resolverHallazgoRegistro": A.resolver_hallazgo_registro,
    "decidirTarea": A.decidir_tarea,
    "abrirTarea": A.abrir_tarea,
    "anadirMemoria": A.anadir_memoria,
    "quitarMemoria": A.quitar_memoria,
    "registrarPreguntaBases": A.registrar_pregunta_bases,
    "eliminarConversacion": A.eliminar_conversacion,
    "resolverAccionAsistente": A.resolver_accion_asistente,
    "pedirRecuperacionCitas": A.pedir_recuperacion_citas,
}

ACCIONES: dict[str, tuple[Callable, bool]] = {n: (f, _con_ahora(f)) for n, f in _TABLA.items()}

# Acciones cuyo reducer acepta `quien`: con sesión, la firma la pone el servidor.
ACCIONES_CON_QUIEN: frozenset[str] = frozenset(n for n, f in _TABLA.items() if "quien" in inspect.signature(f).parameters)


def copia_profunda(e: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(e)
