"""Traducción al inglés, bajo demanda, de lo que no cabe en un catálogo.

La interfaz se traduce con un catálogo fijo (frontend/src/i18n). Pero lo que
escribe ROSA2018 (hipótesis, hechos, respuestas del chat, conclusiones) y la
prosa que genera el servidor cambian en cada corrida: no hay catálogo posible.
Esto los traduce cuando alguien los mira en inglés, una sola vez, y guarda la
traducción para la siguiente. Es lo que hacen el traductor de Chrome o Weglot,
con dos diferencias que importan aquí:

- Las reglas son las de ROSA2018 y se comprueban al recibir, no solo se
  piden: la terminología del campo (GRADE, anatomía, diseños de estudio),
  «no pude comprobar» separado de «no hay», sin «proven» ni «confirmed» que
  el original no diga, los huecos {n} intactos y sin guion largo. Lo que las
  incumple no se guarda y se queda en castellano, que se entiende, en vez de
  enseñar una traducción que diga otra cosa.
- El original no se toca. La traducción vive en una caché aparte
  (`datos/traducciones.db`), nunca en `rosa.db`, que es el almacén auditado
  con un solo escritor: lo que ROSA2018 escribió sigue siendo lo que escribió.

Modelo: Opus 5 por el AI Gateway, como el catálogo (`rosa.gateway`). Traducir
ciencia no es trabajo de Sonnet.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from rosa import config

RUTA = Path(getattr(config, "RAIZ", Path(__file__).resolve().parent.parent)) / "datos" / "traducciones.db"
MODELO = "anthropic/claude-opus-5"
# Lo que se manda de una vez y lo que se acepta por petición.
MAX_POR_PETICION = 80
MAX_CARACTERES = 4000
TOPE_LOTE = 4500

REGLAS = """Traduces la interfaz de ROSA2018, una IA que investiga el Alzheimer, del castellano al inglés.
Quien va a leer esto es un investigador o un médico anglófono. El texto es de interfaz: etiquetas, ayudas, explicaciones y conclusiones.

Reglas, por orden de importancia:

1. TERMINOLOGÍA QUE YA EXISTE EN INGLÉS. Usa la del campo, no una traducción literal.
   - GRADE: certainty (no "certainty level"), "high / moderate / low / very low", "rated down for risk of bias", "imprecision", "indirectness", "inconsistency", "publication bias".
   - Anatomía: entorhinal cortex, locus coeruleus, hippocampus, precuneus, posterior cingulate, white matter hyperintensities, blood-brain barrier.
   - Células: astrocyte, microglia, oligodendrocyte, oligodendrocyte precursor cell (OPC), pericyte, endothelium.
   - Estudios: cohort, case-control, cross-sectional, randomized trial, preregistration, target engagement, readout, held-out set.
   - PRISMA, RoB 2, ROBINS-I, BEST, Elo, Bradley-Terry, e-value, kappa: tal cual.

2. DOS COSAS QUE NO SE PUEDEN CONFUNDIR, porque es una regla del proyecto:
   - "no pude comprobar" / "no se pudo comprobar" -> "could not check". NUNCA "none found", "no results", "there is none".
   - "no hay" -> "there is none". Son estados distintos y la interfaz los distingue a propósito.
   - "tiempo agotado" -> "timed out", nunca "no results".

3. NUNCA uses "proven", "confirmed", "demonstrates" ni porcentajes de confianza que no estén en el original. ROSA2018 no demuestra nada; sostiene o no sostiene.

4. FORMA:
   - Conserva EXACTAMENTE los huecos entre llaves: {n}, {q}, {clase}. No los traduzcas ni los reordenes dentro de la llave.
   - Conserva los símbolos de gen y de biomarcador tal cual: GFAP, NfL, p-tau217, APOE e4, TREM2, Abeta42.
   - Conserva las cifras, las unidades, los identificadores (PMID, DOI, NCT, ids) y la puntuación final.
   - Comillas angulares « » -> comillas dobles " ".
   - NUNCA uses guion largo (U+2014). Usa coma, punto o dos puntos.
   - Si la cadena empieza o acaba con espacio, consérvalo.
   - Si la cadena ya está en inglés, es un nombre propio o no es texto, devuélvela igual.

5. REGISTRO: la interfaz tutea en castellano ("tu decisión"). En inglés, "your decision". Directo y llano, sin floreos.

6. VARIANTE: inglés de Estados Unidos, que es a quien va dirigido. "randomized", "analyze", "behavior", "program", "color", "gray matter", "aging", "catalog", "center", "license". Los nombres propios se quedan como se llaman.

Devuelves SOLO un objeto JSON: {"<original en castellano>": "<traducción al inglés>", ...}. Una entrada por cada cadena que te den, con la clave idéntica al original, carácter a carácter."""


def comprobar(original: str, traducido: str) -> str | None:
    """Lo que se revisa de cada traducción antes de aceptarla. Misma regla que
    scripts/traducir_catalogo.py y que frontend/src/i18n/catalogo.test.ts."""
    if not traducido.strip():
        return "vacía"
    if "\u2014" in traducido:
        return "lleva guion largo"
    if set(re.findall(r"\{(\w+)\}", original)) != set(re.findall(r"\{(\w+)\}", traducido)):
        return "los huecos no coinciden"
    bajo = traducido.lower()
    afirma_en = re.search(r"\b(?:proven|proves|confirmed|confirms|demonstrates|demonstrated|establishes)\b", bajo)
    afirma_es = re.search(r"\b(?:demostrad|demuestra|confirmad|confirma|establece|prueba que)", original.lower())
    if afirma_en and not afirma_es:
        return "afirma de más (proven/confirmed)"
    if re.search(r"no (?:pude|se pudo|pudo) comprobar", original, re.I) and not re.search(r"could not (?:be )?(?:check|verif)|unable to (?:check|verif)", bajo):
        return "«no pude comprobar» no se tradujo como «could not check»"
    return None


def _huella(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


class Cache:
    """La caché, en SQLite aparte. Un candado por proceso: el servidor es uno
    solo y la caché no es el registro de auditoría, así que con esto basta."""

    def __init__(self, ruta: Path = RUTA) -> None:
        self.ruta = ruta
        self._candado = threading.Lock()
        ruta.parent.mkdir(parents=True, exist_ok=True)
        with self._conectar() as c:
            c.execute("CREATE TABLE IF NOT EXISTS traducciones (huella TEXT PRIMARY KEY, origen TEXT NOT NULL, ingles TEXT NOT NULL, modelo TEXT NOT NULL, fecha INTEGER NOT NULL)")

    def _conectar(self) -> sqlite3.Connection:
        return sqlite3.connect(self.ruta, timeout=10)

    def leer(self, textos: list[str]) -> dict[str, str]:
        if not textos:
            return {}
        por_huella = {_huella(t): t for t in textos}
        salida: dict[str, str] = {}
        with self._candado, self._conectar() as c:
            huellas = list(por_huella)
            for i in range(0, len(huellas), 500):
                trozo = huellas[i : i + 500]
                filas = c.execute(f"SELECT huella, ingles FROM traducciones WHERE huella IN ({','.join('?' * len(trozo))})", trozo).fetchall()
                for h, en in filas:
                    salida[por_huella[h]] = en
        return salida

    def guardar(self, pares: dict[str, str], modelo: str) -> None:
        if not pares:
            return
        ahora = int(time.time() * 1000)
        with self._candado, self._conectar() as c:
            c.executemany(
                "INSERT OR REPLACE INTO traducciones (huella, origen, ingles, modelo, fecha) VALUES (?, ?, ?, ?, ?)",
                [(_huella(o), o, en, modelo, ahora) for o, en in pares.items()],
            )

    def cuantas(self) -> int:
        with self._candado, self._conectar() as c:
            return int(c.execute("SELECT COUNT(*) FROM traducciones").fetchone()[0])


def _lotes(textos: list[str]) -> list[list[str]]:
    fuera: list[list[str]] = []
    actual: list[str] = []
    n = 0
    for t in textos:
        if actual and n + len(t) > TOPE_LOTE:
            fuera.append(actual)
            actual, n = [], 0
        actual.append(t)
        n += len(t)
    if actual:
        fuera.append(actual)
    return fuera


def llamar_modelo(lote: list[str]) -> dict[str, str]:
    """Un lote al modelo, por el AI Gateway. Devuelve lo que vino, sin
    comprobar: eso lo hace `traducir`."""
    from rosa.gateway import lm

    cliente = lm(MODELO, max_tokens=16000)
    respuesta = cliente(
        messages=[
            {"role": "system", "content": REGLAS},
            {"role": "user", "content": f"Traduce estas {len(lote)} cadenas:\n{json.dumps(lote, ensure_ascii=False, indent=1)}"},
        ]
    )
    texto = respuesta[0] if isinstance(respuesta, list) else str(respuesta)
    m = re.search(r"\{.*\}", str(texto), re.S)
    if not m:
        return {}
    try:
        datos = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}
    return {str(k): str(v) for k, v in datos.items()} if isinstance(datos, dict) else {}


_CACHE: Cache | None = None
# Hasta 3 llamadas al modelo a la vez. Con un candado único, una pantalla con
# 250 frases nuevas (Citas) tardaba unos 3 minutos la primera vez. Lo que sí se
# mantiene: una frase que ya está pidiendo otra petición no se pide dos veces,
# se espera a que llegue (`_EN_CURSO`).
_SEMAFORO = threading.BoundedSemaphore(3)
_EN_CURSO: dict[str, threading.Event] = {}
_CANDADO_EN_CURSO = threading.Lock()
ESPERA_AJENA_S = 180


def cache() -> Cache:
    global _CACHE
    if _CACHE is None:
        _CACHE = Cache()
    return _CACHE


def limpiar(textos: Any) -> list[str]:
    """Lo que se acepta de una petición: textos no vacíos, sin repetir, con
    tope de cantidad y de largo. Lo demás se ignora sin error: un texto raro
    no puede tumbar la traducción del resto."""
    if not isinstance(textos, list):
        return []
    vistos: list[str] = []
    for t in textos[:MAX_POR_PETICION]:
        if isinstance(t, str) and t.strip() and len(t) <= MAX_CARACTERES and t not in vistos:
            vistos.append(t)
    return vistos


def traducir(
    textos: list[str],
    llamar: Callable[[list[str]], dict[str, str]] | None = llamar_modelo,
    almacen: Cache | None = None,
) -> dict[str, Any]:
    """Las traducciones de `textos`: primero de la caché y lo que falte, del
    modelo, comprobado y guardado. Devuelve las aceptadas y las rechazadas con
    su motivo. Con `llamar=None` solo lee la caché.

    Hasta tres llamadas al modelo a la vez, y una frase que ya está pidiendo
    otra petición no se paga dos veces: se espera a que llegue."""
    c = almacen or cache()
    textos = limpiar(textos)
    hechas = c.leer(textos)
    faltan = [t for t in textos if t not in hechas]
    rechazadas: dict[str, str] = {}
    if faltan and llamar is not None:
        with _CANDADO_EN_CURSO:
            mias = [t for t in faltan if t not in _EN_CURSO]
            ajenas = [_EN_CURSO[t] for t in faltan if t in _EN_CURSO]
            for t in mias:
                _EN_CURSO[t] = threading.Event()
        try:
            with _SEMAFORO:
                ya = c.leer(mias)
                hechas.update(ya)
                for lote in _lotes([t for t in mias if t not in ya]):
                    try:
                        vino = llamar(lote)
                    except Exception as ex:  # noqa: BLE001 - un lote que falla no para los demás
                        for t in lote:
                            rechazadas[t] = f"el modelo no respondió ({type(ex).__name__})"
                        continue
                    buenas: dict[str, str] = {}
                    for t in lote:
                        en = vino.get(t)
                        if en is None:
                            rechazadas[t] = "el modelo no la devolvió"
                            continue
                        fallo = comprobar(t, en)
                        if fallo:
                            rechazadas[t] = fallo
                        else:
                            buenas[t] = en
                    c.guardar(buenas, MODELO)
                    hechas.update(buenas)
        finally:
            with _CANDADO_EN_CURSO:
                for t in mias:
                    ev = _EN_CURSO.pop(t, None)
                    if ev is not None:
                        ev.set()
        # Lo que estaba pidiendo otra petición: se espera y se lee de la caché.
        for ev in ajenas:
            ev.wait(timeout=ESPERA_AJENA_S)
        quedan = [t for t in faltan if t not in hechas and t not in rechazadas]
        hechas.update(c.leer(quedan))
    return {"traducciones": hechas, "rechazadas": rechazadas}
