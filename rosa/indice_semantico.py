"""Índice semántico del registro de ROSA2018: buscar por significado en lo que
ROSA2018 ya sabe (hechos, hipótesis, fuentes).

Hasta ahora el registro solo se buscaba por palabras, así que dos
afirmaciones que dicen lo mismo con otras palabras eran dos, y una hipótesis
nueva podía repetir una descartada dos corridas antes sin que nadie lo
viera. Este módulo convierte cada texto en un vector (embedding) con un
modelo del AI Gateway de Vercel, lo guarda en un SQLite privado junto al
almacén y compara por similitud coseno con numpy: unos miles de vectores se
recorren en milisegundos y no hace falta un servidor nuevo.

Usos: deduplicación por significado en el Killer (una hipótesis que se
parece mucho a otra, viva o descartada, lleva la comprobación de redundancia
con la similitud y el estado de la parecida), la búsqueda global de la
interfaz ("por significado", además de por palabras) y, cuando la corrida
lo pida, "¿qué sabemos ya que se parezca a esto?".

Coste: openai/text-embedding-3-small cuesta 0,02 USD por millón de tokens;
indexar todo el registro actual son céntimos, y después solo se incrusta lo
que cambia (hash del texto). Sin clave del gateway el índice no hace nada y
lo dice. Añadido el 15 de septiembre de 2026.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from rosa.fuentes.base import FuenteNoDisponible, Limitador, json_de, pedir
from rosa.gateway import URL_GATEWAY, clave

MODELO = os.environ.get("ROSA_EMBEDDINGS_MODELO", "openai/text-embedding-3-small")
LOTE = 64
_limitador = Limitador(4.0)
UMBRAL_REDUNDANCIA = 0.90


def disponible() -> bool:
    return bool(MODELO) and bool(os.environ.get("ROSA_GATEWAY_KEY", ""))


def _hash(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:24]


async def incrustar(textos: list[str]) -> tuple[list[list[float]], int]:
    """Vectores de una lista de textos, por lotes. Devuelve (vectores, tokens)."""
    vectores: list[list[float]] = []
    tokens = 0
    for i in range(0, len(textos), LOTE):
        lote = [(t or " ")[:8000] for t in textos[i : i + LOTE]]
        r = await pedir("POST", f"{URL_GATEWAY.rstrip('/')}/embeddings", _limitador, headers={"Authorization": f"Bearer {clave()}", "Content-Type": "application/json"}, json={"model": MODELO, "input": lote})
        d = json_de(r)
        filas = sorted((x for x in d.get("data") or [] if isinstance(x, dict)), key=lambda x: x.get("index", 0))
        if len(filas) != len(lote):
            raise FuenteNoDisponible(f"embeddings: {len(filas)} vectores para {len(lote)} textos")
        vectores.extend([float(v) for v in x["embedding"]] for x in filas)
        tokens += int((d.get("usage") or {}).get("total_tokens") or 0)
    return vectores, tokens


class Indice:
    def __init__(self, ruta: Path | str):
        ruta = Path(ruta)
        if str(ruta) != ":memory:":
            ruta.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(str(ruta), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS vectores (
                id TEXT PRIMARY KEY, tipo TEXT NOT NULL, investigacion_id TEXT,
                hash TEXT NOT NULL, texto TEXT NOT NULL, vector BLOB NOT NULL, dim INTEGER NOT NULL,
                modelo TEXT NOT NULL, actualizado REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS vectores_inv ON vectores (investigacion_id, tipo);
        """)
        self.tokens = 0
        self.investigaciones_eliminadas: Callable[[], set[str]] = lambda: set()
        self._cache: tuple[list[str], np.ndarray, list[sqlite3.Row]] | None = None

    def cerrar(self) -> None:
        self.db.close()

    def _invalidar(self) -> None:
        self._cache = None

    def pendientes(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Los ítems cuyo texto cambió o que no están en el índice."""
        actuales = {r["id"]: r["hash"] for r in self.db.execute("SELECT id, hash FROM vectores")}
        return [x for x in items if x.get("texto") and actuales.get(x["id"]) != _hash(x["texto"])]

    async def indexar(self, items: list[dict[str, Any]]) -> int:
        """ítems: {id, tipo, investigacionId, texto}. Incrusta solo lo nuevo o
        cambiado. Devuelve cuántos vectores se escribieron."""
        if not disponible():
            return 0
        eliminadas = self.investigaciones_eliminadas()
        items = [x for x in items if x.get('investigacionId') not in eliminadas]
        # Lo que ya no está en el estado se retira del índice, haya o no nuevos.
        vivos = {x["id"] for x in items}
        if vivos:
            marcadores = ",".join("?" for _ in vivos)
            with self.db:
                borrados = self.db.execute(f"DELETE FROM vectores WHERE id NOT IN ({marcadores})", tuple(vivos)).rowcount
            if borrados:
                self._invalidar()
        nuevos = self.pendientes(items)
        if not nuevos:
            return 0
        vectores, tokens = await incrustar([x["texto"] for x in nuevos])
        self.tokens += tokens
        ahora = time.time()
        eliminadas = self.investigaciones_eliminadas()
        escritos = 0
        with self.db:
            for x, v in zip(nuevos, vectores):
                if x.get('investigacionId') in eliminadas:
                    continue
                arr = np.asarray(v, dtype=np.float32)
                self.db.execute(
                    "INSERT OR REPLACE INTO vectores VALUES (?,?,?,?,?,?,?,?,?)",
                    (x["id"], x["tipo"], x.get("investigacionId"), _hash(x["texto"]), x["texto"][:2000], arr.tobytes(), int(arr.shape[0]), MODELO, ahora),
                )
                escritos += 1
        self._invalidar()
        return escritos

    def _matriz(self) -> tuple[list[str], np.ndarray, list[sqlite3.Row]]:
        if self._cache is None:
            filas = self.db.execute("SELECT id, tipo, investigacion_id, texto, vector, dim FROM vectores WHERE modelo=?", (MODELO,)).fetchall()
            if filas:
                m = np.vstack([np.frombuffer(r["vector"], dtype=np.float32, count=r["dim"]) for r in filas])
                normas = np.linalg.norm(m, axis=1, keepdims=True)
                normas[normas == 0] = 1.0
                m = m / normas
            else:
                m = np.zeros((0, 1), dtype=np.float32)
            self._cache = ([r["id"] for r in filas], m, filas)
        return self._cache

    def parecidos(self, vector: list[float], k: int = 10, investigacion_id: str | None = None, tipos: tuple[str, ...] | None = None, excluir: set[str] | None = None, umbral: float = 0.0) -> list[dict[str, Any]]:
        ids, m, filas = self._matriz()
        if not ids:
            return []
        q = np.asarray(vector, dtype=np.float32)
        n = np.linalg.norm(q) or 1.0
        sims = m @ (q / n)
        orden = np.argsort(-sims)
        salida: list[dict[str, Any]] = []
        eliminadas = self.investigaciones_eliminadas()
        for i in orden:
            r = filas[int(i)]
            if r['investigacion_id'] in eliminadas:
                continue
            if excluir and r["id"] in excluir:
                continue
            if investigacion_id and r["investigacion_id"] != investigacion_id:
                continue
            if tipos and r["tipo"] not in tipos:
                continue
            s = float(sims[int(i)])
            if s < umbral:
                break
            salida.append({"id": r["id"], "tipo": r["tipo"], "investigacionId": r["investigacion_id"], "texto": r["texto"], "similitud": round(s, 4)})
            if len(salida) >= k:
                break
        return salida

    async def buscar(self, texto: str, k: int = 10, investigacion_id: str | None = None, tipos: tuple[str, ...] | None = None, excluir: set[str] | None = None, umbral: float = 0.0) -> list[dict[str, Any]]:
        if not disponible() or not (texto or "").strip():
            return []
        vectores, tokens = await incrustar([texto])
        self.tokens += tokens
        return self.parecidos(vectores[0], k=k, investigacion_id=investigacion_id, tipos=tipos, excluir=excluir, umbral=umbral)

    def total(self) -> int:
        return int(self.db.execute("SELECT COUNT(*) FROM vectores").fetchone()[0])


# ---------------------------------------------------------------------------
# El índice del almacén de ROSA2018
# ---------------------------------------------------------------------------

_INDICES: dict[str, Indice] = {}


def de_almacen(almacen: Any) -> Indice:
    """Un índice por base de datos, junto a ella (datos/_indice/<base>.db)."""
    ruta = Path(almacen.ruta)
    if str(ruta) == ":memory:":
        clave_ = ":memory:"
        destino: Path | str = ":memory:"
    else:
        clave_ = str(ruta.resolve())
        destino = ruta.parent / "datos" / "_indice" / (ruta.name + ".db")
    if clave_ not in _INDICES:
        _INDICES[clave_] = Indice(destino)
    _INDICES[clave_].investigaciones_eliminadas = lambda: set(almacen.estado.get('investigacionesEliminadas', []))
    return _INDICES[clave_]


def items_del_estado(e: dict[str, Any]) -> list[dict[str, Any]]:
    """Lo que se indexa del estado: hechos, hipótesis (vivas y descartadas) y
    las fuentes de cada corrida por título y resumen. Nunca datos privados
    de personas; todo esto es literatura pública o texto de ROSA2018."""
    items: list[dict[str, Any]] = []
    for h in e.get("hechos", []):
        if h.get("enunciado"):
            items.append({"id": f"hecho:{h['id']}", "tipo": "hecho", "investigacionId": h.get("investigacionId"), "texto": h["enunciado"]})
    for h in e.get("hipotesis", []):
        texto = f"{h.get('titulo', '')}. {h.get('enunciado', '')}".strip(". ")
        if texto:
            items.append({"id": f"hipotesis:{h['id']}", "tipo": "hipotesis", "investigacionId": h.get("investigacionId"), "texto": texto})
    # Cuestiones abiertas (rosa/cuestiones.py): el modelo de mundo bajo demanda y
    # el criterio de relevancia las encuentran por parecido.
    for c in e.get("cuestiones", []):
        if c.get("estado") == "abierta" and c.get("texto"):
            items.append({"id": f"cuestion:{c['id']}", "tipo": "cuestion", "investigacionId": c.get("investigacionId"), "texto": (c["texto"] + (". " + c["queLaResolveria"] if c.get("queLaResolveria") else ""))[:600]})
    for c in e.get("corridas", []):
        for fid, f in (c.get("_fuentes") or {}).items():
            texto = f"{f.get('titulo', '')}. {(f.get('resumen') or '')[:600]}".strip(". ")
            if texto and f.get("titulo"):
                items.append({"id": f"fuente:{fid}", "tipo": "fuente", "investigacionId": c.get("investigacionId"), "texto": texto})
        # Afirmaciones sostenidas de la corrida: lo verificado, para reencontrarlo por significado.
        for a in c.get("_afirmaciones") or []:
            if a.get("veredicto") in ("sostenida", "parcial") and a.get("id") and a.get("texto"):
                items.append({"id": f"afirmacion:{a['id']}", "tipo": "afirmacion", "investigacionId": c.get("investigacionId"), "texto": a["texto"][:800]})
    # Lecciones, decisiones negativas, semillas del vivero y ejecuciones: la memoria de errores.
    for lec in e.get("lecciones", []):
        items.append({"id": f"leccion:{lec['id']}", "tipo": "leccion", "investigacionId": lec.get("investigacionId"), "texto": f"[{lec.get('ambito')}] {lec.get('texto', '')}"})
    for d in e.get("decisiones", []):
        if d.get("decision") in ("descartar_en_contexto", "suspender", "descartada") and (d.get("motivo") or d.get("queHariaFalta")):
            items.append({"id": f"decision:{d['id']}", "tipo": "decision", "investigacionId": d.get("investigacionId"), "texto": f"{d.get('motivo', '')} Haría falta: {d.get('queHariaFalta') or ''}"[:800]})
    for inv in e.get("investigaciones", []):
        for s in (inv.get("vivero") or []) + (inv.get("viveroRetiradas") or []):
            items.append({"id": f"semilla:{s['id']}", "tipo": "semilla", "investigacionId": inv["id"], "texto": f"{s.get('titulo', '')}. {s.get('enunciado', '')}. Le falta: {s.get('falta') or s.get('motivo') or ''}"[:800]})
    for run in e.get("ejecuciones", []):
        interp = (run.get("interpretacion") or {}).get("resumen")
        if interp:
            items.append({"id": f"ejecucion:{run['id']}", "tipo": "ejecucion", "investigacionId": run.get("investigacionId"), "texto": f"Análisis {run.get('tipo', '')}: {interp}"[:800]})
    return items


async def indexar_estado(almacen: Any) -> int:
    """Indexa lo nuevo o cambiado del estado. Devuelve cuántos vectores escribió."""
    if not disponible():
        return 0
    indice = de_almacen(almacen)
    return await indice.indexar(items_del_estado(almacen.estado))


async def hipotesis_parecidas(almacen: Any, h: dict[str, Any], umbral: float = UMBRAL_REDUNDANCIA, k: int = 3) -> list[dict[str, Any]]:
    """Hipótesis de la misma investigación que se parecen por significado a
    `h` (incluidas las descartadas: repetir una descartada es lo que más
    interesa ver). Cada una con similitud y estado."""
    if not disponible():
        return []
    indice = de_almacen(almacen)
    e = almacen.estado
    propias = [x for x in e.get("hipotesis", []) if x.get("investigacionId") == h.get("investigacionId")]
    await indice.indexar([{"id": f"hipotesis:{x['id']}", "tipo": "hipotesis", "investigacionId": x.get("investigacionId"), "texto": f"{x.get('titulo', '')}. {x.get('enunciado', '')}".strip(". ")} for x in propias])
    texto = f"{h.get('titulo', '')}. {h.get('enunciado', '')}".strip(". ")
    parecidas = await indice.buscar(texto, k=k, investigacion_id=h.get("investigacionId"), tipos=("hipotesis",), excluir={f"hipotesis:{h['id']}"}, umbral=umbral)
    por_id = {x["id"]: x for x in propias}
    salida = []
    for p in parecidas:
        x = por_id.get(p["id"].split(":", 1)[1])
        if x:
            salida.append({"id": x["id"], "titulo": x.get("titulo", ""), "estado": x.get("estado"), "decisionKiller": x.get("decisionKiller"), "similitud": p["similitud"]})
    return salida


def resumen(almacen: Any) -> dict[str, Any]:
    if not disponible():
        return {"disponible": False, "vectores": 0, "modelo": MODELO, "tokens": 0}
    indice = de_almacen(almacen)
    return {"disponible": True, "vectores": indice.total(), "modelo": MODELO, "tokens": indice.tokens}


def serializable(x: Any) -> Any:
    return json.loads(json.dumps(x, ensure_ascii=False, default=str))
