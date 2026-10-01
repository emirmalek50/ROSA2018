"""El estado se guarda con orjson y el navegador baja solo lo que cambió
(28 de septiembre de 2026).

Dos ineficiencias medidas sobre la rosa.db real: cada mutación reserializaba
con json.dumps los 31 MB del estado (149 ms; con orjson, 15), y cada versión
nueva obligaba al navegador a bajar y parsear el estado entero (15,9 MB) aunque
solo hubiera cambiado `corridas` o `iteraciones` (lo habitual: el 29 % del
estado). Lo que no se puede romper: que lo guardado se relea igual, que lo
fundido en el navegador sea exactamente el estado del servidor, y que la
versión que se le dice al navegador sea la del contenido que recibe.
"""

from __future__ import annotations

import json
import random
import sqlite3
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa.estado import almacen as ALM
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen, volcar_json


def _almacen() -> Almacen:
    return Almacen(Path(tempfile.mkdtemp()) / "t.db")


def _fundir(base: dict, parcial: dict) -> dict:
    """Lo que hace el navegador con una respuesta parcial."""
    return {**base, **parcial}


def _sin_conexion(e: dict) -> dict:
    return {k: v for k, v in e.items() if k != "conexion"}


# ---------------------------------------------------------------------------
# Lo guardado
# ---------------------------------------------------------------------------


def test_lo_guardado_es_texto_y_se_relee_igual():
    al = _almacen()
    al.mutar(lambda e: e["hipotesis"].append({**P.nueva_hipotesis("inv", 1, 1, titulo="Cognición, ñandú y «comillas»"), "_privada": {"x": [1, 2.5, None, True]}}) or True)
    al.aplicar("anadirCriterio", {"texto": "línea\ncon salto y \"comillas\" y \\ barra"})
    con = sqlite3.connect(al.ruta)
    tipo, texto = con.execute("SELECT typeof(json), json FROM estado WHERE clave='rosa'").fetchone()
    con.close()
    assert tipo == "text" and isinstance(texto, str)
    assert json.loads(texto) == al.estado
    al.cerrar()
    # Y otro proceso que la abra ve lo mismo.
    al2 = Almacen(al.ruta)
    assert al2.estado["hipotesis"][-1]["titulo"] == "Cognición, ñandú y «comillas»"
    assert al2.estado["criteriosRevision"][-1] == "línea\ncon salto y \"comillas\" y \\ barra"
    al2.cerrar()


@pytest.mark.parametrize(
    "valor",
    [
        {"a": "tildes áéíóú ñ Ñ ü", "b": [1, -2, 3.25, 1e-7, 10**18], "c": None, "d": True, "e": {"f": []}},
        "control \x01\x1f y emoji 🧠 y   separador",
        [{"anidado": [{"muy": {"hondo": [0.1, 0.2, 0.30000000000000004]}}]}],
        {"": "clave vacía", " ": "espacio"},
    ],
)
def test_orjson_escribe_lo_mismo_que_json_dumps(valor):
    assert json.loads(volcar_json(valor)) == json.loads(json.dumps(valor, ensure_ascii=False)) == valor


def test_claves_no_textuales_como_las_convertia_json_dumps():
    raras = {7: "a", 2.5: "b", True: "c", None: "d"}  # True no puede ir con 1: en Python son la misma clave
    assert len(raras) == 4
    assert json.loads(volcar_json(raras)) == json.loads(json.dumps(raras)) == {"7": "a", "2.5": "b", "true": "c", "null": "d"}


def test_una_fecha_en_el_estado_sigue_siendo_un_error_y_no_se_guarda():
    al = _almacen()
    v = al.version
    with pytest.raises(TypeError):
        al.mutar(lambda e: e["criteriosRevision"].append(datetime(2026, 9, 28)) or True, "fecha")
    con = sqlite3.connect(al.ruta)
    assert con.execute("SELECT version FROM estado").fetchone()[0] == v
    con.close()
    al.cerrar()


def test_el_wal_no_se_vuelca_en_cada_escritura():
    al = _almacen()
    assert al._con.execute("PRAGMA wal_autocheckpoint").fetchone()[0] == ALM.WAL_AUTOCHECKPOINT_PAGINAS
    assert al._con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    al.cerrar()
    # Una base escrita así se sigue abriendo en solo lectura, sin tocar nada.
    solo = Almacen(al.ruta, solo_lectura=True)
    assert solo.estado["criteriosRevision"] == al.estado["criteriosRevision"]
    solo.cerrar()


def test_nan_se_guarda_como_null_y_no_como_un_json_que_el_navegador_no_lee():
    assert volcar_json(float("nan")) == b"null" and volcar_json(float("inf")) == b"null"


def test_serializar_con_orjson_es_mucho_mas_rapido_que_con_json_dumps():
    grande = {f"clave{i}": [{"texto": "afirmación con tildes " * 20, "cifra": j * 1.5, "lista": list(range(20))} for j in range(200)] for i in range(20)}

    def tiempo(fn):
        fn()
        return min(_medir(fn) for _ in range(3))

    lento = tiempo(lambda: {k: json.dumps(v, ensure_ascii=False) for k, v in grande.items()})
    rapido = tiempo(lambda: {k: volcar_json(v) for k, v in grande.items()})
    assert rapido * 2 < lento, f"orjson {rapido * 1000:.1f} ms frente a json.dumps {lento * 1000:.1f} ms"


def _medir(fn) -> float:
    t0 = time.perf_counter()
    fn()
    return time.perf_counter() - t0


# ---------------------------------------------------------------------------
# Lo que baja el navegador
# ---------------------------------------------------------------------------


def test_desde_la_version_actual_solo_viaja_la_conexion():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "uno"})
    version, cuerpo, parcial = al.instantanea_desde(al.version)
    assert parcial and version == al.version and json.loads(cuerpo) == {"conexion": "en_linea"}
    al.cerrar()


def test_solo_viajan_las_claves_que_cambiaron():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "primero"})
    v0 = al.version
    al.aplicar("anadirCriterio", {"texto": "nuevo"})
    version, cuerpo, parcial = al.instantanea_desde(v0)
    parcial_json = json.loads(cuerpo)
    assert parcial and version == v0 + 1
    assert set(parcial_json) == {"criteriosRevision", "conexion"}
    assert parcial_json["criteriosRevision"][-1] == "nuevo"
    al.cerrar()


def test_fundir_la_parcial_da_siempre_el_estado_entero():
    """La propiedad que importa, contra navegadores que se quedaron en cualquier
    versión anterior: su copia más la parcial es el estado de ahora."""
    rnd = random.Random(20260928)
    al = _almacen()
    enteras: dict[int, dict] = {al.version: json.loads(al.instantanea_json())}
    for i in range(60):
        tipo = rnd.choice(["criterio", "hipotesis", "evento_privado", "privada_top", "nada", "varias"])
        if tipo == "criterio":
            al.aplicar("anadirCriterio", {"texto": f"criterio {i}"})
        elif tipo == "hipotesis":
            al.mutar(lambda e, i=i: e["hipotesis"].append(P.nueva_hipotesis("inv", 1, i, titulo=f"H{i}")) or True, "h")
        elif tipo == "evento_privado":
            # Cambia solo una clave privada dentro de una pública: viaja la pública.
            al.mutar(lambda e, i=i: (e["hipotesis"][-1].__setitem__("_huella", i) if e["hipotesis"] else None) or True, "privado")
        elif tipo == "privada_top":
            al.mutar(lambda e, i=i: e.__setitem__("_interna", i) or True, "privada_top")
        elif tipo == "varias":
            al.mutar(lambda e, i=i: (e["criteriosRevision"].append(f"v{i}"), e["hipotesis"].append(P.nueva_hipotesis("inv", 1, i, titulo=f"V{i}"))) and True, "varias")
        else:
            al.mutar(lambda e: False, "nada")
        enteras[al.version] = json.loads(al.instantanea_json())
    ahora = enteras[al.version]
    assert "_interna" not in ahora
    for desde, copia in enteras.items():
        version, cuerpo, parcial = al.instantanea_desde(desde)
        recibido = json.loads(cuerpo)
        assert version == al.version
        resultado = _fundir(copia, recibido) if parcial else recibido
        assert resultado == ahora, f"desde la versión {desde}"
        assert not any(k.startswith("_") for k in recibido)
    al.cerrar()


def test_una_clave_quitada_obliga_a_mandar_el_estado_entero():
    al = _almacen()
    al.mutar(lambda e: e.__setitem__("temporal", [1]) or True, "pon")
    v = al.version
    al.mutar(lambda e: e.pop("temporal") and True, "quita")
    _, cuerpo, parcial = al.instantanea_desde(v)
    assert not parcial and "temporal" not in json.loads(cuerpo)
    al.cerrar()


@pytest.mark.parametrize("desde", [None, -1, 10**9, True, "3"])
def test_una_version_que_no_encaja_manda_el_estado_entero(desde):
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "x"})
    _, cuerpo, parcial = al.instantanea_desde(desde)
    assert not parcial and json.loads(cuerpo) == json.loads(al.instantanea_json())
    al.cerrar()


def test_filtrada_no_manda_los_avisos_del_estado_ni_en_la_parcial():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "base"})
    v = al.version
    al.mutar(lambda e: e.__setitem__("avisos", {"correo": {"activo": True}}) or True, "avisos")
    _, cuerpo, parcial = al.instantanea_desde(v, request_filtrada=True)
    assert parcial and "avisos" not in json.loads(cuerpo)
    _, cuerpo, parcial = al.instantanea_desde(v, request_filtrada=False)
    assert parcial and json.loads(cuerpo)["avisos"] == {"correo": {"activo": True}}
    al.cerrar()


def test_justo_la_version_del_arranque_recibe_el_estado_entero():
    """Un navegador con la versión en la que arrancó el proceso pudo recibirla de
    un proceso anterior con cambios en memoria que no llegaron al disco."""
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "x"})
    al.cerrar()
    al2 = Almacen(al.ruta)
    _, _, parcial = al2.instantanea_desde(al2.version)
    assert not parcial
    al2.aplicar("anadirCriterio", {"texto": "y"})
    v = al2.version
    al2.aplicar("anadirCriterio", {"texto": "z"})
    _, cuerpo, parcial = al2.instantanea_desde(v)
    assert parcial and set(json.loads(cuerpo)) == {"criteriosRevision", "conexion"}
    al2.cerrar()


def test_tras_recargar_desde_disco_cuenta_todo_como_cambiado():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "antes"})
    v = al.version - 1

    def revienta(e):
        e["criteriosRevision"].append("a medias")
        raise ValueError("reducer que falla")

    with pytest.raises(ValueError):
        al.mutar(revienta, "falla")
    _, cuerpo, parcial = al.instantanea_desde(v + 1)
    assert not parcial  # no se sabe qué tiene el navegador: entero
    assert "a medias" not in json.loads(cuerpo)["criteriosRevision"]
    al.cerrar()


def test_si_la_escritura_falla_se_descarta_y_no_se_cuela_despues(monkeypatch):
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "base"})
    v = al.version
    original = al._guardar
    fallos = {"n": 1}

    def guardar(texto, version_anterior):
        if fallos["n"]:
            fallos["n"] -= 1
            raise sqlite3.OperationalError("disco lleno")
        return original(texto, version_anterior)

    monkeypatch.setattr(al, "_guardar", guardar)
    with pytest.raises(sqlite3.OperationalError):
        al.mutar(lambda e: e["hipotesis"].append(P.nueva_hipotesis("inv", 1, 1, titulo="en memoria sin guardar")) or True, "falla")
    al.aplicar("anadirCriterio", {"texto": "la siguiente sí"})
    _, cuerpo, parcial = al.instantanea_desde(v)
    recibido = json.loads(cuerpo)
    # Una operación rechazada no puede colarse con otra escritura independiente.
    assert recibido["hipotesis"] == []
    con = sqlite3.connect(al.ruta)
    en_disco = json.loads(con.execute("SELECT json FROM estado").fetchone()[0])
    con.close()
    assert en_disco["hipotesis"] == []
    al.cerrar()


def test_la_version_devuelta_es_la_del_contenido_aunque_el_bucle_escriba_a_la_vez():
    al = _almacen()
    enteras: dict[int, dict] = {}
    parar = threading.Event()

    def escritor():
        for i in range(150):
            al.aplicar("anadirCriterio", {"texto": f"c{i}"})
            enteras[al.version] = json.loads(al.instantanea_json())
        parar.set()

    # La base se fija ANTES de arrancar el escritor: leer `al.version` después es
    # una carrera del propio test (bajo carga el hilo ya pasó de esa versión y
    # `enteras` aún no la tiene). Falló así una vez de cada cuatro suites
    # completas el 28 de septiembre de 2026; el protocolo parcial no tenía nada
    # que ver (420.754 lecturas concurrentes contra él, cero desajustes).
    base_version = al.version
    enteras[base_version] = json.loads(al.instantanea_json())
    base = enteras[base_version]
    fundidas: list[tuple[int, dict]] = []
    hilo = threading.Thread(target=escritor)
    hilo.start()
    while not parar.is_set():
        version, cuerpo, parcial = al.instantanea_desde(base_version)
        base = _fundir(base, json.loads(cuerpo)) if parcial else json.loads(cuerpo)
        base_version = version
        fundidas.append((version, base))
    hilo.join()
    # Cada copia del navegador, parcial o entera, es exactamente el estado de la
    # versión que se le dijo que tenía.
    for version, copia in fundidas:
        assert _sin_conexion(copia) == _sin_conexion(enteras[version]), f"versión {version}"
    assert fundidas
    al.cerrar()


# ---------------------------------------------------------------------------
# El servidor
# ---------------------------------------------------------------------------


@pytest.fixture
def cliente(monkeypatch):
    raiz = Path(tempfile.mkdtemp())
    monkeypatch.setattr(config, "RAIZ", raiz)
    dist = raiz / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>rosa</html>")
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    al = Almacen(raiz / "t.db")
    from rosa.servidor import crear_app

    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: "test@alzheimerproject.com" if token == "sesion-test" else None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: {"correo": {"activo": False, "direccion": email}})
    return TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-test"}), al


def test_el_servidor_manda_la_parcial_con_sus_cabeceras(cliente):
    c, al = cliente
    al.aplicar("anadirCriterio", {"texto": "tras arrancar"})
    entera = c.get("/api/estado")
    assert entera.status_code == 200 and "x-rosa-parcial" not in entera.headers
    v = int(entera.headers["x-rosa-version"])
    base = entera.json()
    al.aplicar("anadirCriterio", {"texto": "desde el servidor"})
    r = c.get(f"/api/estado?desde={v}")
    assert r.status_code == 200 and r.headers["x-rosa-parcial"] == "1" and r.headers["x-rosa-desde"] == str(v)
    assert int(r.headers["x-rosa-version"]) == v + 1
    parcial = r.json()
    # Los avisos de la persona viajan siempre; los del estado, nunca.
    assert set(parcial) == {"criteriosRevision", "conexion", "avisos"}
    assert parcial["avisos"]["correo"]["direccion"] == "test@alzheimerproject.com"
    assert _fundir(base, parcial) == c.get("/api/estado").json()


@pytest.mark.parametrize("raro", ["abc", "-3", "1.5", "", "99999999999"])
def test_un_desde_raro_en_la_url_da_el_estado_entero(cliente, raro):
    c, al = cliente
    r = c.get(f"/api/estado?desde={raro}")
    assert r.status_code == 200 and "x-rosa-parcial" not in r.headers
    assert r.json()["conexion"] == "en_linea"


def test_la_cabecera_de_version_es_la_del_contenido(cliente, monkeypatch):
    """Si el bucle escribe mientras se compone la respuesta, la cabecera no puede
    adelantarse al contenido."""
    c, al = cliente
    original = ALM.Almacen.instantanea_desde

    def lenta(self, desde, request_filtrada=False):
        r = original(self, desde, request_filtrada)
        # Justo después de componer, llega una escritura del bucle.
        self.aplicar("anadirCriterio", {"texto": "llegó tarde"})
        return r

    monkeypatch.setattr(ALM.Almacen, "instantanea_desde", lenta)
    r = c.get("/api/estado")
    assert "llegó tarde" not in r.json()["criteriosRevision"]
    assert int(r.headers["x-rosa-version"]) == al.version - 1
