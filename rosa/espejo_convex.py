"""Espejo del estado en Convex (base de datos en la nube con sincronizacion
en tiempo real). SQLite en el servidor de ROSA2018 sigue siendo la fuente de
verdad y el unico escritor; aqui se copia cada entidad publica del estado
(sin claves privadas `_`) a una tabla `entidades` de Convex, una fila por
entidad, y se actualiza solo lo que cambio (por hash). Sirve para leer el
estado desde cualquier sitio sin depender del Mac donde corre el bucle, y
para que varias personas lo vean a la vez.

Como funciona: el servidor se suscribe a los cambios del almacen; tras un
cambio espera unos segundos (para agrupar rafagas) y manda a Convex, por
lotes, las entidades cuyo hash cambio y los ids que desaparecieron, con la
version del estado. La clave de despliegue y la URL vienen del entorno
(`CONVEX_DEPLOY_KEY`, `CONVEX_URL`) y nunca se escriben en el estado ni en
los registros. Sin clave, el espejo esta apagado y ROSA2018 funciona igual.

Limites de Convex que se respetan: un documento pesa como maximo 1 MiB (las
entidades mayores se guardan recortadas con `truncado: true`), y una
mutation admite pocos MB de argumentos (lotes de 200 entidades o 6 MB).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from typing import Any

import httpx

from rosa import config
from rosa.estado.almacen import _limpiar_para_cliente

COLECCIONES = ("investigaciones", "corridas", "iteraciones", "hipotesis", "hechos", "artefactos", "decisiones", "ejecuciones", "planesAnalisis", "reproducciones", "aprendizaje", "metodos", "comentarios", "incidencias", "relaciones", "evaluaciones", "casos")
GLOBALES = ("autonomia", "politicas", "conectores", "skills", "criteriosRevision", "avisos", "permisosConectores")
MAX_BYTES_DOC = 900_000
MAX_LOTE = 200
MAX_BYTES_LOTE = 6_000_000
ESPERA_S = 4.0
MAX_EVENTOS = 500
# Seguro contra otra instalación con la misma clave (5 de octubre de 2026: una
# compañera arrancó ROSA2018 en su máquina con el .env de Emir, es decir, con
# una base vacía y la clave del espejo de la base de producción). El diff
# habría mandado borrar las 1.743 entidades del espejo. En una base normal
# no desaparece casi nada entre dos ciclos: si un ciclo quiere borrar más de
# esta fracción de lo que el espejo tiene (y más de MIN_BORRADOS_SOSPECHOSOS),
# lo que hay enfrente es otra base, y este servidor no toca el espejo.
FRACCION_BORRADO_SOSPECHOSA = 0.5
MIN_BORRADOS_SOSPECHOSOS = 20


def activo() -> bool:
    return bool(config.CONVEX_URL and config.CONVEX_DEPLOY_KEY)


def _hash(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:24]


def _recortar_valor(v: Any, texto_max: int, lista_max: int) -> Any:
    if isinstance(v, str):
        return v if len(v) <= texto_max else v[:texto_max] + " ... [recortado para el espejo]"
    if isinstance(v, list):
        return [_recortar_valor(x, texto_max, lista_max) for x in v[:lista_max]]
    if isinstance(v, dict):
        return {k: _recortar_valor(x, texto_max, lista_max) for k, x in v.items()}
    return v


def _recortar(datos: dict[str, Any], bytes_: int) -> dict[str, Any]:
    """Una entidad mayor que el límite de Convex: se recortan textos y listas
    a cualquier profundidad, cada vez más, hasta caber; si ni así cabe,
    queda solo la identidad con la nota. Siempre devuelve algo bajo el límite."""
    for texto_max, lista_max in ((20_000, 60), (4_000, 30), (800, 12), (200, 5)):
        out = _recortar_valor(datos, texto_max, lista_max)
        out["_truncadoEspejo"] = {"bytesOriginales": bytes_, "nota": "Entidad mayor que el límite de Convex; el original está en el servidor de ROSA2018"}
        if len(json.dumps(out, ensure_ascii=False, default=str).encode("utf-8")) <= MAX_BYTES_DOC:
            return out
    return {k: datos.get(k) for k in ("id", "investigacionId", "titulo", "nombre", "estado") if k in datos} | {"_truncadoEspejo": {"bytesOriginales": bytes_, "nota": "Entidad demasiado grande para el espejo incluso recortada"}}


def es_otra_base(borrados: int, en_espejo: int) -> bool:
    """Si un ciclo que quiere borrar `borrados` de las `en_espejo` entidades del
    espejo delata que este servidor trabaja sobre OTRA base que la que lo llenó."""
    return borrados > MIN_BORRADOS_SOSPECHOSOS and borrados > en_espejo * FRACCION_BORRADO_SOSPECHOSA


def entidades_de(estado: dict[str, Any]) -> list[dict[str, Any]]:
    """Las entidades públicas del estado como filas del espejo."""
    filas: list[dict[str, Any]] = []
    limpio = _limpiar_para_cliente(estado)
    for col in COLECCIONES:
        items = limpio.get(col) or []
        if col == "eventos":
            items = items[-MAX_EVENTOS:]
        for x in items:
            if not isinstance(x, dict):
                continue
            id_ = str(x.get("id") or x.get("clave") or "")
            if not id_:
                continue
            texto = json.dumps(x, ensure_ascii=False, sort_keys=True, default=str)
            bytes_ = len(texto.encode("utf-8"))
            truncado = bytes_ > MAX_BYTES_DOC
            datos = _recortar(x, bytes_) if truncado else x
            if truncado:
                texto = json.dumps(datos, ensure_ascii=False, sort_keys=True, default=str)
                bytes_ = len(texto.encode("utf-8"))
            filas.append({"coleccion": col, "id": id_, "investigacionId": x.get("investigacionId") if isinstance(x.get("investigacionId"), str) else None, "hash": _hash(texto), "bytes": bytes_, "truncado": truncado, "datos": datos})
    # Los eventos van aparte (muchos y pequenos): solo los ultimos.
    for x in (limpio.get("eventos") or [])[-MAX_EVENTOS:]:
        texto = json.dumps(x, ensure_ascii=False, sort_keys=True, default=str)
        filas.append({"coleccion": "eventos", "id": str(x.get("id")), "investigacionId": x.get("investigacionId"), "hash": _hash(texto), "bytes": len(texto), "truncado": False, "datos": x})
    glob = {k: limpio.get(k) for k in GLOBALES if k in limpio}
    texto = json.dumps(glob, ensure_ascii=False, sort_keys=True, default=str)
    filas.append({"coleccion": "global", "id": "estado", "investigacionId": None, "hash": _hash(texto), "bytes": len(texto), "truncado": False, "datos": glob})
    return filas


class Espejo:
    """Sincroniza el estado con Convex en segundo plano."""

    def __init__(self, almacen: Any):
        self.almacen = almacen
        self.hashes: dict[tuple[str, str], str] = {}
        self.estado: dict[str, Any] = {"activo": activo(), "url": config.CONVEX_URL, "ultimaVersion": None, "sincronizadoEn": None, "entidades": 0, "pendiente": False, "error": None, "envios": 0, "ms": 0}
        self._tarea: asyncio.Task | None = None
        self._ultimo_aviso = ""
        self._cliente = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0), headers={"Authorization": f"Convex {config.CONVEX_DEPLOY_KEY}", "Content-Type": "application/json"})

    async def _llamar(self, tipo: str, path: str, args: dict[str, Any]) -> Any:
        r = await self._cliente.post(f"{config.CONVEX_URL}/api/{tipo}", json={"path": path, "args": args, "format": "json"})
        r.raise_for_status()
        d = r.json()
        if d.get("status") != "success":
            raise RuntimeError(str(d.get("errorMessage") or d)[:300])
        return d.get("value")

    async def cargar_hashes(self) -> None:
        """Al arrancar, lo que Convex ya tiene, para mandar solo diferencias."""
        filas = await self._llamar("query", "espejo:hashes", {}) or []
        self.hashes = {(f["coleccion"], f["id"]): f["hash"] for f in filas}
        meta = await self._llamar("query", "espejo:meta", {})
        if meta:
            self.estado.update(ultimaVersion=meta.get("version"), sincronizadoEn=meta.get("sincronizadoEn"), entidades=meta.get("entidades", 0))

    def _entidades(self) -> list[dict[str, Any]]:
        with self.almacen._lock:
            return entidades_de(self.almacen.estado)

    async def sincronizar(self) -> dict[str, Any]:
        """Un ciclo: diff contra los hashes conocidos y envio por lotes."""
        t0 = time.monotonic()
        version = self.almacen.version
        # Instantanea bajo el cerrojo y en un hilo: ni lee un estado a medio
        # mutar ni bloquea el bucle de eventos con el escaneo.
        filas = await asyncio.to_thread(self._entidades)
        actuales = {(f["coleccion"], f["id"]): f for f in filas}
        cambios = [f for k, f in actuales.items() if self.hashes.get(k) != f["hash"]]
        borrados = [{"coleccion": c, "id": i} for (c, i) in self.hashes if (c, i) not in actuales]
        if es_otra_base(len(borrados), len(self.hashes)):
            self.estado.update(pendiente=False, error=f"El espejo tiene {len(self.hashes)} entidades y esta base querría borrar {len(borrados)}: el espejo es de otra instalación de ROSA2018 y este servidor no lo toca. Quita CONVEX_DEPLOY_KEY y CONVEX_URL de este .env si no es tu espejo.")
            return {"cambios": 0, "borrados": 0, "escritas": 0, "lotes": 0, "rechazado": True}
        lotes: list[list[dict[str, Any]]] = [[]]
        tam = 0
        for f in cambios:
            if len(lotes[-1]) >= MAX_LOTE or tam + f["bytes"] > MAX_BYTES_LOTE:
                lotes.append([])
                tam = 0
            lotes[-1].append(f)
            tam += f["bytes"]
        escritas = 0
        for i, lote in enumerate(lotes):
            ultimo = i == len(lotes) - 1
            r = await self._llamar("mutation", "espejo:sincronizar", {"version": version, "origen": "servidor-rosa", "cambios": lote, "borrados": borrados if ultimo else [], "ultimoLote": ultimo})
            escritas += int((r or {}).get("escritas", 0))
            for f in lote:
                self.hashes[(f["coleccion"], f["id"])] = f["hash"]
        for b in borrados:
            self.hashes.pop((b["coleccion"], b["id"]), None)
        self.estado.update(ultimaVersion=version, sincronizadoEn=int(time.time() * 1000), entidades=len(actuales), pendiente=False, error=None, ms=int((time.monotonic() - t0) * 1000))
        self.estado["envios"] += 1
        return {"cambios": len(cambios), "borrados": len(borrados), "escritas": escritas, "lotes": len(lotes)}

    async def correr(self) -> None:
        """Tarea de fondo: escucha los cambios del almacen y sincroniza con
        espera para agrupar rafagas. Un fallo de red se anota y se reintenta
        al siguiente cambio; nunca tumba el servidor."""
        if not activo():
            return
        try:
            await self.cargar_hashes()
        except Exception as ex:  # noqa: BLE001
            self.estado["error"] = f"No se pudo leer Convex al arrancar: {str(ex)[:200]}"
        cola = self.almacen.suscribir()
        try:
            await self._intentar()
            while True:
                await cola.get()
                self.estado["pendiente"] = True
                await asyncio.sleep(ESPERA_S)
                while not cola.empty():
                    cola.get_nowait()
                await self._intentar()
        finally:
            self.almacen.desuscribir(cola)

    async def _intentar(self) -> None:
        try:
            r = await self.sincronizar()
        except Exception as ex:  # noqa: BLE001
            self.estado["error"] = f"{type(ex).__name__}: {str(ex)[:200]}"
            self.estado["pendiente"] = True
            self._avisar(self.estado["error"])
            return
        if r.get("rechazado"):
            self._avisar(self.estado["error"] or "")

    def _avisar(self, texto: str) -> None:
        """El fallo del espejo, al registro del servidor, una vez por motivo
        distinto: hasta el 5 de octubre de 2026 solo vivía en memoria
        (/api/espejo) y el espejo llevaba 13 días parado sin que nada lo dijera."""
        if texto and texto != self._ultimo_aviso:
            self._ultimo_aviso = texto
            print(f"Espejo en Convex: {texto}", file=sys.stderr, flush=True)

    def arrancar(self) -> None:
        if activo() and self._tarea is None:
            self._tarea = asyncio.create_task(self.correr(), name="espejo-convex")

    async def parar(self) -> None:
        if self._tarea:
            self._tarea.cancel()
        await self._cliente.aclose()
