"""Tanda 1, grupo almacén y servidor (17 de septiembre de 2026).

Regresiones de S-01 (cerrojo de instancia, escritura condicional por versión,
cadena con bifurcaciones y reanclaje, apagado con tope), S-17 primer corte
(instantánea cacheada por versión, SSE sin versiones repetidas, GZip), S-21
(token antes que sesión, puerta sin verificar cerrada, contraseña con topes,
administrador explícito), S-22 (actor desde la sesión), B-16 (partes tras un reducer que
lanza), M-29 (cuerpos acotados antes de leer) y las migraciones de novedad y
de progreso. Cada test falla sin su arreglo.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa.estado import plantilla as P
from rosa.estado.almacen import (
    NOMBRE_REANCLAJE,
    Almacen,
    AlmacenOcupado,
    EscritorObsoleto,
    _migrar_contexto_xy,
    _migrar_novedad_no_comprobada,
    _migrar_progreso_por_ventana,
    componer_json_con_avisos,
    hash_fila,
    ruta_cerrojo,
)
from rosa.servidor import crear_app

RAIZ_REPO = Path(__file__).resolve().parents[2]
SESION = "dra@alzheimerproject.com"
COPIA_ESTADO = Path("/private/tmp/claude-502/-Users-emirmalek-traspaso-alzheimer-agente/75fbc617-6a69-4c07-8e51-f2a1f337f4df/scratchpad/estado_ahora.json")


def _ruta_temporal() -> Path:
    return Path(tempfile.mkdtemp()) / "t.db"


@pytest.fixture
def cliente(monkeypatch):
    """Servidor con sesión simulada (como en test_servidor.py): aísla las rutas
    del dominio del acceso real."""
    raiz = Path(tempfile.mkdtemp())
    monkeypatch.setattr(config, "RAIZ", raiz)
    monkeypatch.setattr(config, "FRONTEND_DIST", raiz / "dist-inexistente")
    monkeypatch.setattr(config, "ROSA_TOKEN", "")
    al = Almacen(raiz / "t.db")
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: SESION if token == "sesion-test" else None, es_admin=lambda email: email == SESION, salir=lambda token: None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: {**al.estado["avisos"], "correo": {"activo": True, "direccion": email}})
    c = TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-test"})
    yield c, al, app
    al.cerrar()


# ---------------------------------------------------------------------------
# S-01: cerrojo de instancia
# ---------------------------------------------------------------------------

GUION_HIJO = """
import sys
sys.path.insert(0, %r)
from rosa.estado.almacen import Almacen
al = Almacen(%r)
print("listo", flush=True)
sys.stdin.readline()
al.cerrar()
print("cerrado", flush=True)
"""


def test_dos_procesos_sobre_la_misma_base_el_segundo_falla_con_mensaje_claro():
    ruta = _ruta_temporal()
    hijo = subprocess.Popen([sys.executable, "-c", GUION_HIJO % (str(RAIZ_REPO), str(ruta))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=str(RAIZ_REPO))
    try:
        assert hijo.stdout.readline().strip() == "listo"
        assert ruta_cerrojo(ruta).read_text().strip() == str(hijo.pid)
        t0 = time.monotonic()
        with pytest.raises(AlmacenOcupado) as ex:
            Almacen(ruta)
        assert time.monotonic() - t0 < 2
        texto = str(ex.value)
        assert "Otra ROSA2018" in texto and str(hijo.pid) in texto and "solo_lectura" in texto
        # Con espera breve tampoco entra mientras el otro no suelte.
        t0 = time.monotonic()
        with pytest.raises(AlmacenOcupado):
            Almacen(ruta, espera_cerrojo=1.2)
        assert 1.0 <= time.monotonic() - t0 < 4
        # Leer sin escribir sí se puede mientras el otro trabaja.
        lector = Almacen(ruta, solo_lectura=True)
        assert lector.version == 0 and isinstance(lector.estado, dict)
        with pytest.raises(EscritorObsoleto):
            lector.mutar(lambda e: True)
        lector.cerrar()
        # Cuando el primero cierra, el segundo entra (es el reinicio real).
        hijo.stdin.write("\n")
        hijo.stdin.flush()
        assert hijo.stdout.readline().strip() == "cerrado"
        hijo.wait(timeout=20)
        al = Almacen(ruta, espera_cerrojo=5)
        assert al.aplicar("anadirCriterio", {"texto": "tras el reinicio"}) is True
        al.cerrar()
    finally:
        if hijo.poll() is None:
            hijo.kill()


def test_espera_del_cerrojo_avisa_y_entra_cuando_el_otro_suelta(capsys):
    ruta = _ruta_temporal()
    hijo = subprocess.Popen([sys.executable, "-c", GUION_HIJO % (str(RAIZ_REPO), str(ruta))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=str(RAIZ_REPO))
    try:
        assert hijo.stdout.readline().strip() == "listo"

        def soltar_luego():
            time.sleep(1.0)
            hijo.stdin.write("\n")
            hijo.stdin.flush()

        threading.Thread(target=soltar_luego, daemon=True).start()
        al = Almacen(ruta, espera_cerrojo=30)
        assert al.version == 0
        al.cerrar()
        hijo.wait(timeout=20)
        assert "sigue cerrando" in capsys.readouterr().err
    finally:
        if hijo.poll() is None:
            hijo.kill()


def test_en_el_mismo_proceso_comparten_cerrojo_y_la_version_condicional_impide_pisar():
    """Los tests que simulan un reinicio abren un segundo Almacen sin cerrar el
    primero: comparten el cerrojo. Lo que impide que el atrasado pise es el
    UPDATE condicional por versión."""
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    al2 = Almacen(ruta)
    assert al.aplicar("anadirCriterio", {"texto": "escrito por el primero"}) is True
    assert al.version == 1 and al2.version == 0
    llamadas = []

    def fn(e):
        llamadas.append(1)
        e["criteriosRevision"].append("intento del atrasado")
        return True

    with pytest.raises(EscritorObsoleto) as ex:
        al2.mutar(fn)
    assert "versión 1" in str(ex.value) and "creía tener la 0" in str(ex.value)
    en_disco = sqlite3.connect(str(ruta)).execute("SELECT version, json FROM estado WHERE clave='rosa'").fetchone()
    assert en_disco[0] == 1 and json.loads(en_disco[1])["criteriosRevision"][-1] == "escrito por el primero"
    # Obsoleto: la memoria vuelve a lo que hay en disco (la versión 1 del vivo), no a lo que creía tener.
    assert al2.obsoleto is True and al2.version == 1 and al2.estado["criteriosRevision"][-1] == "escrito por el primero"
    # Obsoleto: ya no aplica nada, ni siquiera llama al reducer.
    with pytest.raises(EscritorObsoleto):
        al2.mutar(fn)
    assert len(llamadas) == 1
    # El vivo sigue escribiendo con normalidad y la cadena queda intacta.
    assert al.aplicar("anadirCriterio", {"texto": "segundo del vivo"}) is True
    assert al.version == 2 and al.verificar_cadena()["ok"]
    al2.cerrar()
    # Cerrar el segundo no suelta el cerrojo del primero.
    assert al.aplicar("anadirCriterio", {"texto": "tercero"}) is True
    al.cerrar()
    # Ahora sí está libre.
    al3 = Almacen(ruta)
    assert al3.version == 3
    al3.cerrar()


def test_escritura_externa_detras_del_almacen_no_se_pisa():
    """Simula un escritor ajeno (otra máquina, un .lock borrado): la versión en
    disco avanza sin que este proceso lo sepa y la siguiente escritura falla."""
    al = Almacen(_ruta_temporal())
    al.aplicar("anadirCriterio", {"texto": "uno"})
    otro = sqlite3.connect(str(al.ruta), isolation_level=None)
    otro.execute("UPDATE estado SET version=version+5 WHERE clave='rosa'")
    otro.close()
    with pytest.raises(EscritorObsoleto):
        al.aplicar("anadirCriterio", {"texto": "dos"})
    assert al.obsoleto and al.version == 6  # la versión de disco, que es la verdad; "dos" no quedó en memoria
    assert al.estado["criteriosRevision"][-1] == "uno"  # el estado inicial trae criterios propios
    al.cerrar()


def test_cerrar_dos_veces_y_cerrojo_se_suelta_si_falla_la_carga(tmp_path):
    ruta = tmp_path / "rota.db"
    ruta.write_text("esto no es una base sqlite " * 100)
    with pytest.raises(sqlite3.DatabaseError):
        Almacen(ruta)
    # El cerrojo no queda tomado tras el fallo: otro Almacen sobre otra base con
    # el mismo cerrojo no aplica, pero el registro interno debe estar limpio.
    from rosa.estado import almacen as M

    assert str(ruta.resolve()) not in M._CERROJOS
    al = Almacen(tmp_path / "buena.db")
    al.cerrar()
    al.cerrar()  # idempotente


# ---------------------------------------------------------------------------
# S-01: cadena de auditoría con bifurcaciones y reanclaje
# ---------------------------------------------------------------------------

def _insertar_fila(ruta: Path, nombre: str, hash_anterior: str, version: int, actor: str | None = None) -> str:
    con = sqlite3.connect(str(ruta), isolation_level=None)
    t = P.ahora_ms()
    args = json.dumps({"cambiaron": ["x"]})
    res = "true"
    h = hash_fila(hash_anterior, t, nombre, args, res, version, actor)
    con.execute("INSERT INTO acciones(t, nombre, args, resultado, version, hash, hash_anterior, actor) VALUES (?,?,?,?,?,?,?,?)", (t, nombre, args, res, version, h, hash_anterior, actor))
    con.close()
    return h


def _hash_de(ruta: Path, seq: int) -> str:
    con = sqlite3.connect(str(ruta))
    h = con.execute("SELECT hash FROM acciones WHERE seq=?", (seq,)).fetchone()[0]
    con.close()
    return h


def test_la_cadena_reconoce_una_bifurcacion_por_reinicio_y_sigue_verificando():
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    for i in range(5):
        al.aplicar("anadirCriterio", {"texto": f"c{i}"})
    al.cerrar()
    # El proceso viejo escribe dos filas enlazadas con la fila 2 (versiones que retroceden).
    h_rama = _insertar_fila(ruta, "llamada_modelo", _hash_de(ruta, 2), 3)
    _insertar_fila(ruta, "killer", h_rama, 4)
    # El proceso nuevo retoma desde la fila 5 (la punta de la rama principal).
    _insertar_fila(ruta, "pista", _hash_de(ruta, 5), 6)
    al = Almacen(ruta)
    r = al.verificar_cadena()
    assert r["ok"] is False and r["rotaEn"] == 6 and r["bifurcaciones"] == 1 and r["alteradas"] == 0
    assert "dos procesos" in r["motivo"] and "borrada" in r["motivo"]
    rotura = r["roturas"][0]
    assert rotura["tipo"] == "bifurcacion" and rotura["enlazaConSeq"] == 2 and rotura["filas"] == 2 and rotura["hastaSeq"] == 7
    assert r["encadenadas"] == 8  # sigue contando después de la rotura
    # Una fila borrada de verdad se distingue: su hash anterior no existe.
    _insertar_fila(ruta, "pista", "0" * 64, 7)
    r = al.verificar_cadena()
    assert [x["tipo"] for x in r["roturas"]] == ["bifurcacion", "borrada"]
    # Una fila alterada también.
    con = sqlite3.connect(str(ruta), isolation_level=None)
    con.execute("UPDATE acciones SET args='{\"cambiaron\": [\"manipulado\"]}' WHERE seq=3")
    con.close()
    r = al.verificar_cadena()
    assert r["alteradas"] == 1 and any(x["tipo"] == "alterada" and x["seq"] == 3 for x in r["roturas"])
    al.cerrar()


def test_el_reanclaje_documenta_el_corte_y_la_cadena_vuelve_a_verde():
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    for i in range(4):
        al.aplicar("anadirCriterio", {"texto": f"c{i}"})
    with pytest.raises(ValueError, match="no tiene roturas"):
        al.reanclar_registro("Un motivo suficientemente largo", "admin@alzheimerproject.com")
    al.cerrar()
    h_rama = _insertar_fila(ruta, "llamada_modelo", _hash_de(ruta, 2), 3)
    _insertar_fila(ruta, "killer", h_rama, 4)
    al = Almacen(ruta)  # como una ROSA2018 nueva: encadena desde la última fila
    assert al.verificar_cadena()["ok"] is False
    with pytest.raises(ValueError, match="motivo"):
        al.reanclar_registro("corto", "admin@alzheimerproject.com")
    r = al.reanclar_registro("Dos procesos escribieron a la vez el 15/09/2026 al reiniciar con el Killer en vuelo", "admin@alzheimerproject.com")
    assert r["ok"] and r["roturasDocumentadas"] == 1
    v = al.verificar_cadena()
    assert v["ok"] is True and v["cortesDocumentados"] == 1 and v["bifurcaciones"] == 1 and v["rotaEn"] is None
    assert "1 corte documentado" in v["motivo"]
    assert v["reanclajes"][0]["quien"] == "admin@alzheimerproject.com" and "Killer" in v["reanclajes"][0]["motivo"]
    assert v["roturasDocumentadas"][0]["tipo"] == "bifurcacion"
    # Lo que se escribe después sigue encadenado desde el reanclaje.
    al.aplicar("anadirCriterio", {"texto": "después"})
    v = al.verificar_cadena()
    assert v["ok"] and v["cortesDocumentados"] == 1
    con = sqlite3.connect(str(ruta))
    assert con.execute("SELECT nombre FROM acciones ORDER BY seq DESC LIMIT 2").fetchall()[1][0] == NOMBRE_REANCLAJE
    con.close()
    # Alterar el propio reanclaje se detecta.
    con = sqlite3.connect(str(ruta), isolation_level=None)
    con.execute("UPDATE acciones SET args=replace(args, 'Killer', 'nadie') WHERE nombre=?", (NOMBRE_REANCLAJE,))
    con.close()
    v = al.verificar_cadena()
    assert v["ok"] is False and v["alteradas"] == 1
    al.cerrar()


def test_reanclar_por_la_api_solo_administracion(cliente):
    c, al, app = cliente
    r = c.post("/api/registro/reanclar", json={"motivo": "Un motivo con más de diez letras"}, headers={"X-Rosa": "1"})
    assert r.status_code == 400  # admin, pero la cadena está intacta
    app.state.acceso = SimpleNamespace(usuario=lambda token: SESION if token == "sesion-test" else None, es_admin=lambda email: False)
    r = c.post("/api/registro/reanclar", json={"motivo": "Un motivo con más de diez letras"}, headers={"X-Rosa": "1"})
    assert r.status_code == 403
    r = c.get("/api/registro/integridad")
    assert r.status_code == 200 and r.json()["ok"] and r.json()["roturas"] == [] and r.json()["cortesDocumentados"] == 0


def test_el_actor_entra_en_el_hash_y_las_filas_viejas_sin_actor_siguen_valiendo():
    al = Almacen(_ruta_temporal())
    al.aplicar("anadirCriterio", {"texto": "sin actor"})
    al.aplicar("anadirCriterio", {"texto": "con actor"}, actor=SESION)
    con = sqlite3.connect(str(al.ruta))
    filas = con.execute("SELECT actor FROM acciones ORDER BY seq").fetchall()
    con.close()
    assert filas == [(None,), (SESION,)]
    assert al.verificar_cadena()["ok"]
    # Cambiar el actor de una fila la deja como alterada.
    con = sqlite3.connect(str(al.ruta), isolation_level=None)
    con.execute("UPDATE acciones SET actor='otra@alzheimerproject.com' WHERE seq=2")
    con.close()
    assert al.verificar_cadena()["alteradas"] == 1
    al.cerrar()


# ---------------------------------------------------------------------------
# S-01: apagado con tope (main.py)
# ---------------------------------------------------------------------------

class _ServidorFalso:
    def __init__(self):
        self.should_exit = False

    async def serve(self):
        while not self.should_exit:
            await asyncio.sleep(0.02)


class _SupervisorFalso:
    def __init__(self, tarda: float):
        self.tarda = tarda
        self.parado = asyncio.Event() if False else None
        self.termino = False
        self.cancelado = False

    def parar(self):
        self._parar = True

    async def correr(self):
        self._parar = False
        try:
            while not self._parar:
                await asyncio.sleep(0.02)
            await asyncio.sleep(self.tarda)  # "la llamada al modelo en vuelo"
            self.termino = True
        except asyncio.CancelledError:
            self.cancelado = True
            raise


@pytest.mark.asyncio
async def test_apagado_deja_terminar_el_paso_en_vuelo_y_corta_pasado_el_tope():
    from rosa.main import correr_con_tope

    servidor = _ServidorFalso()
    supervisor = _SupervisorFalso(tarda=0.3)

    async def parar_luego():
        await asyncio.sleep(0.1)
        servidor.should_exit = True

    asyncio.get_running_loop().create_task(parar_luego())
    t0 = time.monotonic()
    await correr_con_tope(servidor, supervisor, tope_s=5)
    assert supervisor.termino and not supervisor.cancelado and time.monotonic() - t0 < 3

    servidor = _ServidorFalso()
    supervisor = _SupervisorFalso(tarda=30)
    asyncio.get_running_loop().create_task(parar_luego())
    t0 = time.monotonic()
    await correr_con_tope(servidor, supervisor, tope_s=0.4)
    assert supervisor.cancelado and not supervisor.termino and time.monotonic() - t0 < 3


# ---------------------------------------------------------------------------
# S-17 primer corte: instantánea cacheada, SSE sin repetir, GZip
# ---------------------------------------------------------------------------

def test_instantanea_cacheada_devuelve_el_mismo_objeto_para_la_misma_version():
    al = Almacen(_ruta_temporal())
    al.mutar(lambda e: e["hipotesis"].append({**P.nueva_hipotesis("inv", 1, 1, titulo="H con ñ y tilde: cognición"), "_privada": "no viaja"}) or True)
    j1 = al.instantanea_json()
    j2 = al.instantanea_json()
    assert j1 is j2
    e = json.loads(j1)
    assert e == al.instantanea() and "_privada" not in j1 and "cognición" in j1  # ensure_ascii=False
    assert ",\"avisos\":" in j1 and e["conexion"] == "en_linea"
    sin = al.instantanea_json(request_filtrada=True)
    assert sin is al.instantanea_json(request_filtrada=True) and '"avisos"' not in sin
    prefs = {"correo": {"activo": True, "direccion": SESION}}
    compuesto = json.loads(componer_json_con_avisos(sin, json.dumps(prefs)))
    assert compuesto["avisos"] == prefs and compuesto["hipotesis"] == e["hipotesis"]
    assert json.loads(componer_json_con_avisos("{}", "1")) == {"avisos": 1}
    # Una mutación invalida la caché; la siguiente lectura es otro objeto.
    al.aplicar("anadirCriterio", {"texto": "nuevo"})
    j3 = al.instantanea_json()
    assert j3 is not j1 and json.loads(j3)["criteriosRevision"][-1] == "nuevo"
    al.cerrar()


def test_get_estado_usa_la_cache_y_va_en_gzip(cliente):
    c, al, _ = cliente
    r = c.get("/api/estado", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers.get("content-encoding") == "gzip" and r.headers["x-rosa-version"] == str(al.version)
    e = r.json()
    assert e["avisos"]["correo"]["direccion"] == SESION  # los avisos son los de la persona
    assert e["conexion"] == "en_linea" and set(e) >= {"hipotesis", "corridas", "avisos"}
    r2 = c.get("/api/estado", headers={"Accept-Encoding": "identity"})
    assert r2.headers.get("content-encoding") is None and r2.json() == e


def _arrancar_servidor_real(app):
    """uvicorn en un hilo con puerto libre: el único camino fiable para probar el
    SSE de punta a punta (TestClient no entrega eventos hasta cerrar)."""
    import uvicorn

    servidor = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error", loop="asyncio"))
    hilo = threading.Thread(target=servidor.run, daemon=True)
    hilo.start()
    for _ in range(200):
        if servidor.started and servidor.servers:
            break
        time.sleep(0.02)
    puerto = servidor.servers[0].sockets[0].getsockname()[1]
    return servidor, hilo, puerto


def test_el_sse_no_repite_la_misma_version_y_manda_los_avisos_forzados(monkeypatch):
    raiz = Path(tempfile.mkdtemp())
    monkeypatch.setattr(config, "RAIZ", raiz)
    monkeypatch.setattr(config, "FRONTEND_DIST", raiz / "no")
    monkeypatch.setattr(config, "ROSA_TOKEN", "")
    al = Almacen(raiz / "t.db")
    app = crear_app(al)
    servidor, hilo, puerto = _arrancar_servidor_real(app)
    # El lifespan real puso acceso y correo de verdad; se sustituyen por los simulados.
    app.state.acceso = SimpleNamespace(usuario=lambda token: SESION if token == "s" else None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: al.estado["avisos"])
    eventos: list[tuple[str, float]] = []
    listo = threading.Event()

    def leer():
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{puerto}", cookies={"rosa_sesion": "s"}, timeout=3) as h:
                with h.stream("GET", "/api/eventos") as r:
                    for linea in r.iter_lines():
                        if linea.startswith("id:"):
                            eventos.append((linea.split(":", 1)[1].strip(), time.time()))
                            listo.set()
                        if len(eventos) >= 6 or time.time() > fin:
                            break
        except httpx.HTTPError:
            pass  # el servidor se apaga al final del test

    fin = time.time() + 6
    hilo_lector = threading.Thread(target=leer, daemon=True)
    hilo_lector.start()
    try:
        assert listo.wait(5)  # la instantánea inicial
        for i in range(3):
            al.aplicar("anadirCriterio", {"texto": f"c{i}"})
            time.sleep(0.15)
        for _ in range(5):
            al._avisar()  # misma versión: no debe producir eventos
            time.sleep(0.05)
        time.sleep(0.4)
        antes = len(eventos)
        al._avisar(forzar=True)  # cambio de avisos: sí se manda aunque la versión no cambie
        # Espera por condición y no por tiempo fijo: con la máquina cargada (la suite
        # entera corriendo) el evento tardaba más de medio segundo y el test fluctuaba.
        limite = time.time() + 4
        while len(eventos) < antes + 1 and time.time() < limite:
            time.sleep(0.05)
        ids = [v for v, _ in eventos]
        assert ids[:4] == ["0", "1", "2", "3"], ids
        assert antes == 4 and len(eventos) == 5 and ids[4] == "3"
    finally:
        fin = 0
        servidor.should_exit = True
        hilo.join(timeout=5)
        hilo_lector.join(timeout=5)
        al.cerrar()


# ---------------------------------------------------------------------------
# S-21: token antes que sesión; puerta sin verificar; administrador
# ---------------------------------------------------------------------------

def test_el_token_de_red_va_antes_que_la_sesion_y_sin_excepciones(cliente, monkeypatch):
    c, al, app = cliente
    monkeypatch.setattr(config, "ROSA_TOKEN", "llave-de-red")
    # Con cookie pero sin token: nada de la API.
    r = c.get("/api/estado")
    assert r.status_code == 401 and "token" in r.json()["detail"].lower()
    assert c.get("/api/acceso/estado").status_code == 401  # tampoco las rutas públicas
    assert c.post("/api/acceso/entrar_sin_verificar", json={"correo": "x@alzheimerproject.com"}, headers={"X-Rosa": "1"}).status_code == 401
    # Token correcto sin cookie: las públicas pasan, el resto pide sesión.
    sin_cookie = TestClient(app, base_url="http://127.0.0.1:8765")
    r = sin_cookie.get("/api/estado", headers={"X-Rosa-Token": "llave-de-red"})
    assert r.status_code == 401 and "sesión" in r.json()["detail"]
    r = sin_cookie.post("/api/acceso/salir", json={}, headers={"X-Rosa-Token": "llave-de-red", "X-Rosa": "1"})
    assert r.status_code == 200  # ruta pública: con la llave de red pasa sin sesión
    # Token equivocado: fuera, aunque haya cookie.
    assert c.get("/api/estado", headers={"X-Rosa-Token": "otra"}).status_code == 401
    # Token correcto con cookie: dentro (por cabecera y por parámetro, como el SSE).
    assert c.get("/api/estado", headers={"X-Rosa-Token": "llave-de-red"}).status_code == 200
    assert c.get("/api/salud?token=llave-de-red").status_code == 200
    # El token interno del propio servidor no necesita la llave de red.
    interno = (config.RAIZ / "datos" / "_token_interno").read_text().strip()
    r = c.post("/api/acciones/marcarVisita", json={"ahora": 5}, headers={"X-Rosa-Interno": interno})
    assert r.status_code == 200


def test_la_puerta_sin_verificar_esta_cerrada_y_administra_rosa_admin_no_la_primera_cuenta(tmp_path, monkeypatch):
    """Desde el 18 de septiembre de 2026 la entrada es correo y contraseña
    (ROSA_LOGIN_EMAIL y ROSA_LOGIN_PASSWORD_HASH): hereda los topes y la purga
    de la puerta antigua, y esta ya no crea nada. Administra ROSA_ADMIN; sin
    ella, la cuenta configurada (la única que puede entrar), nunca una que
    entró sin verificar ni una que confirmó un enlace antes o después."""
    import re

    from rosa.acceso import Acceso, _huella_contrasena
    from rosa.correo import Correo

    monkeypatch.delenv("ROSA_ADMIN", raising=False)
    monkeypatch.delattr(config, "ROSA_ADMIN", raising=False)
    email = "persona@alzheimerproject.com"
    clave = "contraseña de prueba"
    monkeypatch.setattr(config, "ROSA_LOGIN_EMAIL", email)
    monkeypatch.setattr(config, "ROSA_LOGIN_PASSWORD_HASH", _huella_contrasena(clave))
    al = Almacen(tmp_path / "rosa.db")
    correo = Correo(al)
    a = Acceso(correo)
    # Una cuenta que entró por la puerta antigua antes del cambio sigue en la base
    # (verificada NULL): es la más vieja y aun así nunca administra.
    antigua = "antigua@alzheimerproject.com"
    with a.db:
        a.db.execute("INSERT INTO cuentas(correo, creada) VALUES (?, 1)", (antigua,))
    # La puerta está cerrada: no crea cuenta ni sesión ni consume intentos.
    with pytest.raises(ValueError, match="ya no existe"):
        a.entrar_sin_verificar(email, "10.0.0.7")
    assert a.db.execute("SELECT COUNT(*) FROM sesiones").fetchone()[0] == 0
    assert a.db.execute("SELECT COUNT(*) FROM limites_acceso").fetchone()[0] == 0
    # La contraseña tiene los mismos topes que el enlace: tres fallos por correo en
    # 15 minutos (un rollback los borraba) y el cuarto no entra ni con la buena.
    # Acertar no gasta intentos: los borra, para que dos erratas y dos entradas
    # en un cuarto de hora no bloqueen a la persona legítima.
    for _ in range(3):
        with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
            a.entrar_con_contrasena(email, "mala", "10.0.0.7")
    with pytest.raises(ValueError, match="Demasiados"):
        a.entrar_con_contrasena(email, clave, "10.0.0.8")
    assert a.db.execute("SELECT COUNT(*) FROM limites_acceso").fetchone()[0] == 3
    with a.db:
        a.db.execute("DELETE FROM limites_acceso WHERE t<?", (time.time() + 1,))
    for _ in range(2):
        with pytest.raises(ValueError, match="Correo o contraseña incorrectos"):
            a.entrar_con_contrasena(email, "mala", "10.0.0.7")
    token, _ = a.entrar_con_contrasena(email, clave, "10.0.0.7")
    assert a.db.execute("SELECT COUNT(*) FROM limites_acceso").fetchone()[0] == 0
    assert a.usuario(token) == email
    assert a.db.execute("SELECT verificada FROM cuentas WHERE correo=?", (email,)).fetchone()[0] is not None
    # Las sesiones caducadas se purgan también por esta puerta.
    with a.db:
        a.db.execute("UPDATE sesiones SET vence=1")
        a.db.execute("DELETE FROM limites_acceso")
    a.entrar_con_contrasena(email, clave, "10.0.0.8")
    assert a.db.execute("SELECT COUNT(*) FROM sesiones").fetchone()[0] == 1
    # ROSA_ADMIN manda cuando está: la cuenta configurada no administra aunque sea la primera verificada.
    monkeypatch.setenv("ROSA_ADMIN", "Jefa@AlzheimerProject.com")
    assert a.es_admin("jefa@alzheimerproject.com") and not a.es_admin(email) and not a.es_admin(antigua)
    monkeypatch.delenv("ROSA_ADMIN")
    # Sin ROSA_ADMIN: la cuenta configurada; nunca la antigua sin verificar aunque
    # sea más vieja, ni quien confirmó un enlace antes del cambio (verificada más
    # antigua y ya sin forma de entrar), ni quien confirme uno después.
    with a.db:
        a.db.execute("INSERT INTO cuentas(correo, creada, verificada) VALUES (?, 2, 2)", ("colega@alzheimerproject.com",))
    assert a.es_admin(email) and not a.es_admin(antigua) and not a.es_admin("colega@alzheimerproject.com")
    correo.configurar({"remitente": "rosa@alzheimerproject.com", "clave": "clave-de-prueba", "url": "http://localhost:5174"})
    a.solicitar("jefa@alzheimerproject.com", "local")
    carga = json.loads(correo.db.execute("SELECT carga FROM cola WHERE tipo='acceso' ORDER BY rowid DESC LIMIT 1").fetchone()[0])
    enlace = re.search(r"#acceso=([^\s]+)", carga["text"]).group(1)
    a.confirmar(enlace)
    assert a.es_admin(email) and not a.es_admin("jefa@alzheimerproject.com")
    correo.cerrar()
    al.cerrar()


def test_la_puerta_sin_verificar_contesta_410_con_la_explicacion_con_sesion_y_sin_ella(cliente, monkeypatch):
    from rosa.acceso import MENSAJE_PUERTA_CERRADA

    c, al, app = cliente
    sin_sesion = TestClient(app, base_url="http://127.0.0.1:8765")
    # Ni en local ni en la red, ni con sesión ni sin ella: ya no hay puerta, y el
    # mensaje dice que no existe y cómo entrar. Nunca deja cookie.
    for host in ("127.0.0.1", "0.0.0.0"):
        monkeypatch.setattr(config, "HOST", host)
        for quien in (c, sin_sesion):
            r = quien.post("/api/acceso/entrar_sin_verificar", json={"correo": "x@alzheimerproject.com"}, headers={"X-Rosa": "1"})
            assert r.status_code == 410 and r.json()["detail"] == MENSAJE_PUERTA_CERRADA and "set-cookie" not in r.headers
    assert "ya no existe" in MENSAJE_PUERTA_CERRADA and "contraseña" in MENSAJE_PUERTA_CERRADA
    # Un cuerpo roto recibe la misma respuesta: la puerta no lee nada.
    r = sin_sesion.post("/api/acceso/entrar_sin_verificar", content=b"{", headers={"X-Rosa": "1", "Content-Type": "application/json"})
    assert r.status_code == 410
    # Sin sesión, el resto de la API pide iniciar sesión con la contraseña, no con un "correo verificado".
    r = sin_sesion.get("/api/estado")
    assert r.status_code == 401 and "contraseña" in r.json()["detail"]


# ---------------------------------------------------------------------------
# S-22: el actor es la sesión
# ---------------------------------------------------------------------------

def test_el_actor_de_la_sesion_firma_las_decisiones_y_queda_en_el_registro(cliente):
    c, al, _ = cliente
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}})
    r = c.post("/api/acciones/proponerHipotesis", json={"investigacion_id": inv, "datos": {"titulo": "H", "enunciado": "E", "cohorte": "OASIS-3"}, "quien": "Dra. Suplantada"}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"]
    h = al.estado["hipotesis"][0]
    assert "Suplantada" not in json.dumps(al.estado, ensure_ascii=False)
    r = c.post("/api/acciones/revisarHipotesis", json={"hipotesis_id": h["id"], "accion": "aceptar", "nota": "bien", "quien": "Dra. Suplantada"}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"]
    assert h["revisiones"][-1]["quien"] == SESION
    assert "Suplantada" not in json.dumps(al.estado, ensure_ascii=False)
    con = sqlite3.connect(str(al.ruta))
    filas = con.execute("SELECT nombre, actor FROM acciones ORDER BY seq").fetchall()
    con.close()
    assert filas[-1] == ("revisarHipotesis", SESION) and filas[-2] == ("proponerHipotesis", SESION)
    assert filas[0][1] is None  # la creada sin sesión (desde el bucle) no lleva actor
    assert al.verificar_cadena()["ok"]
    # Sin sesión (bucle o token interno) el `quien` del cuerpo se respeta.
    assert al.aplicar("anadirCriterio", {"texto": "x"}) is True


# ---------------------------------------------------------------------------
# B-16: partes coherentes tras un reducer que lanza
# ---------------------------------------------------------------------------

def test_tras_un_reducer_que_lanza_el_registro_no_dice_que_cambio_todo():
    al = Almacen(_ruta_temporal())

    def rompe(e):
        e["criteriosRevision"].append("a medias")
        raise RuntimeError("fallo a mitad")

    with pytest.raises(RuntimeError):
        al.mutar(rompe)
    assert "a medias" not in al.estado["criteriosRevision"]
    al.mutar(lambda e: e.__setitem__("ultimaVisita", 12345) or True, "prueba")
    con = sqlite3.connect(str(al.ruta))
    args = json.loads(con.execute("SELECT args FROM acciones ORDER BY seq DESC LIMIT 1").fetchone()[0])
    con.close()
    assert args["cambiaron"] == ["ultimaVisita"]
    al.cerrar()


# ---------------------------------------------------------------------------
# M-29: cuerpos acotados antes de leer
# ---------------------------------------------------------------------------

async def _llamar_asgi(app, metodo: str, ruta: str, cabeceras: dict, trozos: list[bytes]):
    """Llama a la app ASGI a mano para controlar Content-Length y los trozos que
    entrega `receive`. Devuelve (código, cuerpo, trozos que pidió el servidor)."""
    pedidos = 0
    pendientes = list(trozos)

    async def receive():
        nonlocal pedidos
        pedidos += 1
        if pendientes:
            return {"type": "http.request", "body": pendientes.pop(0), "more_body": bool(pendientes)}
        return {"type": "http.request", "body": b"", "more_body": False}

    salida = {"status": None, "body": b""}

    async def send(msg):
        if msg["type"] == "http.response.start":
            salida["status"] = msg["status"]
        elif msg["type"] == "http.response.body":
            salida["body"] += msg.get("body", b"")

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": metodo, "scheme": "http", "path": ruta, "raw_path": ruta.encode(), "query_string": b"", "root_path": "", "headers": [(k.lower().encode(), v.encode()) for k, v in cabeceras.items()], "client": ("127.0.0.1", 40000), "server": ("127.0.0.1", 8765), "state": {}}
    await app(scope, receive, send)
    return salida["status"], salida["body"], pedidos


@pytest.mark.asyncio
async def test_un_content_length_grande_se_rechaza_sin_leer_el_cuerpo(cliente):
    _, al, app = cliente
    cab = {"host": "127.0.0.1:8765", "cookie": "rosa_sesion=sesion-test", "x-rosa": "1", "content-type": "application/json", "content-length": str(300_000_000)}
    estado, cuerpo, pedidos = await _llamar_asgi(app, "POST", "/api/acciones/marcarVisita", cab, [b"{" * 10])
    assert estado == 413 and pedidos == 0
    # Sin Content-Length (chunked) y un cuerpo que miente: corta al pasar el tope, sin esperar al final.
    cab.pop("content-length")
    trozos = [b"[" + b"1," * 300_000 for _ in range(6)]  # 6 trozos de 600 kB, tope 1 MB
    estado, cuerpo, pedidos = await _llamar_asgi(app, "POST", "/api/acciones/marcarVisita", cab, trozos)
    assert estado == 413 and pedidos <= 2
    # Un Content-Length que no es un número: 400.
    estado, _, _ = await _llamar_asgi(app, "POST", "/api/acciones/marcarVisita", {**cab, "content-length": "muchos"}, [b"{}"])
    assert estado == 400
    # Un cuerpo normal sigue funcionando y el sello de tiempo lo pone el servidor.
    v = al.version
    estado, cuerpo, _ = await _llamar_asgi(app, "POST", "/api/acciones/anadirCriterio", cab, [b'{"texto": "cabe"}'])
    assert estado == 200 and json.loads(cuerpo)["ok"] and al.version == v + 1


@pytest.mark.asyncio
async def test_preguntar_tiene_tope_y_firma_con_la_sesion(cliente, monkeypatch):
    c, al, app = cliente
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}})
    import rosa.herramientas as H

    async def falsa(cerebro, estado, investigacion_id, pregunta, contexto, almacen=None):
        return {"respuesta": "R", "limites": "", "herramientas": [], "consultas": [], "iteraciones": 1}

    monkeypatch.setattr(H, "preguntar", falsa)
    app.state.modelos = SimpleNamespace(cerebro=None)
    cab = {"host": "127.0.0.1:8765", "cookie": "rosa_sesion=sesion-test", "x-rosa": "1", "content-type": "application/json"}
    grande = json.dumps({"pregunta": "x" * 20_000}).encode()
    estado, _, pedidos = await _llamar_asgi(app, "POST", f"/api/investigaciones/{inv}/preguntar", {**cab, "content-length": str(len(grande))}, [grande])
    assert estado == 413 and pedidos == 0
    estado, _, _ = await _llamar_asgi(app, "POST", f"/api/investigaciones/{inv}/preguntar", {**cab, "content-type": "text/plain"}, [b"{}"])
    assert estado == 415
    r = c.post(f"/api/investigaciones/{inv}/preguntar", json={"pregunta": "¿Qué sabe ROSA2018 de GFAP?", "quien": "Suplantada"}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["ok"], r.text
    registrada = al.estado["investigaciones"][0]["preguntasABases"][-1]
    assert registrada["quien"] == SESION and "Suplantada" not in json.dumps(al.estado)


@pytest.mark.asyncio
async def test_preguntar_en_un_hilo_ve_los_turnos_guardados_y_no_los_que_manda_el_navegador(cliente, monkeypatch):
    """La conversación del modelo de mundo: la segunda pregunta del mismo hilo
    lleva en el contexto la primera con su respuesta, leída de lo guardado. Un
    hilo con forma rara se ignora, las respuestas fallidas no cuentan y otro
    hilo no se mezcla."""
    c, al, app = cliente
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}})
    import rosa.herramientas as H

    contextos: list[str] = []

    async def falsa(cerebro, estado, investigacion_id, pregunta, contexto, almacen=None):
        contextos.append(contexto)
        if pregunta == "falla":
            raise RuntimeError("caído")
        return {"respuesta": f"Respuesta a {pregunta}", "limites": "", "herramientas": [], "consultas": [], "iteraciones": 1}

    monkeypatch.setattr(H, "preguntar", falsa)
    app.state.modelos = SimpleNamespace(cerebro=None)
    url = f"/api/investigaciones/{inv}/preguntar"
    cab = {"X-Rosa": "1"}
    assert c.post(url, json={"pregunta": "¿Qué sabe de GFAP?", "hilo": "c-1"}, headers=cab).json()["ok"]
    assert "Conversación hasta ahora" not in contextos[-1]
    c.post(url, json={"pregunta": "falla", "hilo": "c-1"}, headers=cab)
    assert c.post(url, json={"pregunta": "¿Y en plasma?", "hilo": "c-1", "turnos": [{"pregunta": "inventada", "respuesta": "inventada"}]}, headers=cab).json()["ok"]
    assert "¿Qué sabe de GFAP?" in contextos[-1] and "Respuesta a ¿Qué sabe de GFAP?" in contextos[-1]
    assert "inventada" not in contextos[-1] and "Pregunta: falla" not in contextos[-1]
    c.post(url, json={"pregunta": "Otra cosa", "hilo": "c-2"}, headers=cab)
    assert "GFAP" not in contextos[-1]
    c.post(url, json={"pregunta": "Rara", "hilo": "../../etc"}, headers=cab)
    assert "Conversación hasta ahora" not in contextos[-1]
    guardadas = al.estado["investigaciones"][0]["preguntasABases"]
    assert [q.get("hilo") for q in guardadas] == ["c-1", "c-1", "c-1", "c-2", None]
    # Una pregunta de antes de los hilos se continúa con su propio id.
    vieja = guardadas[-1]["id"]
    c.post(url, json={"pregunta": "¿Y después?", "hilo": vieja}, headers=cab)
    assert "Pregunta: Rara" in contextos[-1] and al.estado["investigaciones"][0]["preguntasABases"][-1]["hilo"] == vieja


# ---------------------------------------------------------------------------
# Migraciones idempotentes
# ---------------------------------------------------------------------------

def test_migracion_de_novedad_pasa_los_0_obras_a_no_comprobado_y_es_idempotente():
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    h_vacia = P.nueva_hipotesis("inv", 1, 1, titulo="A")
    h_vacia["novedad"]["precedente"] = {"estado": "sin_precedente", "detalle": "Sin precedente claro entre 0 obras que casan con: GFAP APOE"}
    h_real = P.nueva_hipotesis("inv", 1, 1, titulo="B")
    h_real["novedad"]["precedente"] = {"estado": "sin_precedente", "detalle": "Sin precedente claro entre 6 obras que casan con: GFAP"}
    al.mutar(lambda e: e["hipotesis"].extend([h_vacia, h_real]) or True)
    al.cerrar()
    al = Almacen(ruta)  # la migración corre al cargar
    a, b = al.estado["hipotesis"]
    assert a["novedad"]["precedente"]["estado"] == "no_comprobado" and "0 obras" in a["novedad"]["precedente"]["motivo"]
    assert a["novedad"]["precedente"]["detalle"].startswith("No comprobado")  # el bucle repesca las que empiezan así
    assert b["novedad"]["precedente"] == {"estado": "sin_precedente", "detalle": "Sin precedente claro entre 6 obras que casan con: GFAP"}
    antes = json.dumps(al.estado["hipotesis"], sort_keys=True)
    _migrar_novedad_no_comprobada(al.estado)
    assert json.dumps(al.estado["hipotesis"], sort_keys=True) == antes
    al.cerrar()
    # Formas raras: no rompen la carga.
    for raro in ({"hipotesis": "texto"}, {"hipotesis": [None, 3, {"novedad": None}, {"novedad": {"precedente": "texto"}}, {"novedad": {"precedente": {"detalle": None}}}]}, {}):
        _migrar_novedad_no_comprobada(raro)


def test_migracion_cambia_la_frase_falsa_de_la_flecha_xy():
    """Los grafos guardados antes del 23 de septiembre de 2026 decían que
    ninguna afirmación sostenida nombraba X e Y a la vez, y en 16 de 21 era
    falso. La carga lo cambia por el texto verdadero; una flecha que subió a
    inferencia con evidencia solo por nombrar las dos cosas vuelve a supuesto,
    con su relación del modelo de mundo."""
    from rosa import causal as CAUSAL

    def grafo(tipo, contexto):
        return {"aristas": [{"de": "X", "a": "Y", "tipo": tipo, "contexto": contexto}, {"de": "A1", "a": "Y", "tipo": "supuesto", "contexto": "Artefacto de medida planteado por el Killer"}], "resumen": "El efecto esta acotado: 2 de 3 supuestos cumplidos; faltan 1. Lo que falta es lo que un experimento o un dataset tendría que aportar."}

    e = {
        "hipotesis": [
            {"id": "h1", "grafoCausal": grafo("supuesto", "Lo que afirma la hipótesis (ninguna afirmación sostenida nombra las dos cosas a la vez)")},
            {"id": "h2", "grafoCausal": grafo("supuesto", "Lo que afirma la hipotesis (ninguna afirmacion sostenida nombra las dos cosas a la vez)")},
            {"id": "h3", "grafoCausal": grafo("inferencia_con_evidencia", "Lo que afirma la hipótesis (con afirmaciones sostenidas que nombran las dos cosas)")},
            # Una que ya puso el juez con su propio texto: no se toca.
            {"id": "h4", "grafoCausal": grafo("inferencia_con_evidencia", "Sostenida por el juez con tres afirmaciones")},
            {"id": "h5", "grafoCausal": None},
        ],
        "relaciones": [
            {"hipotesisId": "h3", "tipo": "inferencia_con_evidencia"},
            {"hipotesisId": "h4", "tipo": "inferencia_con_evidencia"},
            {"hipotesisId": None, "tipo": "base_curada"},
        ],
    }
    _migrar_contexto_xy(e)
    xy = {h["id"]: h["grafoCausal"]["aristas"][0] for h in e["hipotesis"] if h["grafoCausal"]}
    assert [xy[i]["contexto"] for i in ("h1", "h2", "h3")] == [CAUSAL.CONTEXTO_XY] * 3
    assert [xy[i]["tipo"] for i in ("h1", "h2", "h3", "h4")] == ["supuesto", "supuesto", "supuesto", "inferencia_con_evidencia"]
    assert xy["h4"]["contexto"] == "Sostenida por el juez con tres afirmaciones"
    assert [r["tipo"] for r in e["relaciones"]] == ["supuesto", "inferencia_con_evidencia", "base_curada"]
    assert all(h["grafoCausal"]["aristas"][1]["contexto"] == "Artefacto de medida planteado por el Killer" for h in e["hipotesis"] if h["grafoCausal"])
    assert e["hipotesis"][0]["grafoCausal"]["resumen"].startswith("El efecto está acotado: 2 de 3 supuestos cumplidos; falta 1. Lo que")
    antes = json.dumps(e, sort_keys=True)
    _migrar_contexto_xy(e)
    assert json.dumps(e, sort_keys=True) == antes
    # Formas raras: no rompen la carga.
    for raro in ({"hipotesis": "texto"}, {"hipotesis": [None, 3, {"grafoCausal": "x"}, {"grafoCausal": {"aristas": [None, {"de": "X", "a": "Y", "contexto": None}]}}], "relaciones": "x"}, {}):
        _migrar_contexto_xy(raro)


def test_migracion_de_progreso_recuenta_con_la_ventana_temporal(monkeypatch):
    from rosa import progreso as PROG

    e = P.estado_inicial()
    c = P.nueva_corrida("inv", 1, 1000)
    c["estado"] = "terminada"
    c["progreso"] = [{"iteracion": 1, "hipotesisNuevas": 7, "peldanosSubidos": 0, "peldanosBajados": 0, "certezas": [], "hechosNuevos": 0, "fallidos": {}}, {"iteracion": 2, "hipotesisNuevas": 7, "peldanosSubidos": 0, "peldanosBajados": 0, "certezas": [], "hechosNuevos": 0, "fallidos": {}}]
    c["metrica"] = {"hipotesisNuevas": 14}
    e["corridas"].append(c)
    e["iteraciones"].extend([{"id": "it1", "corridaId": c["id"], "numero": 1, "empezadaEn": 1000, "terminadaEn": 2000}, {"id": "it2", "corridaId": c["id"], "numero": 2, "empezadaEn": 2000, "terminadaEn": None}])
    viva = P.nueva_corrida("inv", 2, 3000)
    viva["progreso"] = [{"iteracion": 1, "hipotesisNuevas": 9}]
    e["corridas"].append(viva)

    def nacidas_falsa(estado, investigacion_id, it, *args, **kwargs):
        return ["h"] * (2 if it["numero"] == 1 else 1)

    # Si rosa/progreso.py trae `recalcular_progreso` (la regla única del grupo C), la migración delega en ella.
    llamadas = []
    monkeypatch.setattr(PROG, "recalcular_progreso", lambda estado: llamadas.append(estado) or 0, raising=False)
    _migrar_progreso_por_ventana(e)
    assert llamadas == [e] and [p["hipotesisNuevas"] for p in c["progreso"]] == [7, 7]
    # Sin ella, codifica contra el contrato de `hipotesis_nacidas_en`.
    monkeypatch.delattr(PROG, "recalcular_progreso", raising=False)
    monkeypatch.setattr(PROG, "hipotesis_nacidas_en", nacidas_falsa, raising=False)
    _migrar_progreso_por_ventana(e)
    assert [p["hipotesisNuevas"] for p in c["progreso"]] == [2, 1]
    assert c["metrica"]["hipotesisNuevas"] == 3 and c["metrica"]["iteraciones"] == 2  # métrica rehecha por regla
    assert viva["progreso"][0]["hipotesisNuevas"] == 9  # la corrida viva no se toca
    copia = json.dumps(e, sort_keys=True, default=str)
    _migrar_progreso_por_ventana(e)
    assert json.dumps(e, sort_keys=True, default=str) == copia
    # Sin la función (otro grupo aún no la escribió): no se toca nada.
    monkeypatch.delattr(PROG, "hipotesis_nacidas_en", raising=False)
    c["progreso"][0]["hipotesisNuevas"] = 7
    _migrar_progreso_por_ventana(e)
    assert c["progreso"][0]["hipotesisNuevas"] == 7
    # Formas raras.
    _migrar_progreso_por_ventana({"corridas": "x", "iteraciones": []})
    _migrar_progreso_por_ventana({"corridas": [None, {"estado": "terminada", "progreso": "x"}], "iteraciones": [None]})


@pytest.mark.skipif(not COPIA_ESTADO.exists(), reason="no está la copia del estado real")
def test_el_estado_real_carga_con_las_migraciones_nuevas():
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    estado = json.loads(COPIA_ESTADO.read_text())
    estado.pop("conexion", None)
    con = sqlite3.connect(str(ruta), isolation_level=None)
    con.execute("UPDATE estado SET json=?, version=7 WHERE clave='rosa'", (json.dumps(estado, ensure_ascii=False),))
    con.close()
    al.cerrar()
    t0 = time.perf_counter()
    al = Almacen(ruta)
    assert time.perf_counter() - t0 < 30
    precedentes = [((h.get("novedad") or {}).get("precedente") or {}) for h in al.estado["hipotesis"]]
    assert not any(str(p.get("detalle", "")).startswith("Sin precedente claro entre 0 obras") for p in precedentes)
    assert all(p.get("motivo") for p in precedentes if p.get("estado") == "no_comprobado")
    j = al.instantanea_json()
    assert json.loads(j)["hipotesis"] and "_fuentes" not in j
    assert al.aplicar("anadirCriterio", {"texto": "el estado real se puede seguir escribiendo"}) is True
    al.cerrar()


# ---------------------------------------------------------------------------
# Revisión adversarial del grupo (17 de septiembre de 2026): lo que se rompió
# al intentar romperlo y ahora queda cubierto.
# ---------------------------------------------------------------------------

def test_un_reanclaje_metido_a_mano_que_no_enlaza_no_documenta_nada():
    """Antes, cualquier fila `reanclaje_registro` con su hash bien calculado
    dejaba la cadena en verde aunque su hash anterior no fuera el de ninguna
    fila: bastaba insertarla a mano para tapar una bifurcación."""
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    for i in range(4):
        al.aplicar("anadirCriterio", {"texto": f"c{i}"})
    al.cerrar()
    h_rama = _insertar_fila(ruta, "killer", _hash_de(ruta, 2), 3)  # bifurcación real
    con = sqlite3.connect(str(ruta), isolation_level=None)
    t = P.ahora_ms()
    args = json.dumps({"motivo": "reanclaje falso metido a mano", "quien": "nadie"})
    h = hash_fila("f" * 64, t, NOMBRE_REANCLAJE, args, "null", 4)
    con.execute("INSERT INTO acciones(t, nombre, args, resultado, version, hash, hash_anterior) VALUES (?,?,?,?,?,?,?)", (t, NOMBRE_REANCLAJE, args, "null", 4, h, "f" * 64))
    con.close()
    al = Almacen(ruta)
    r = al.verificar_cadena()
    assert r["ok"] is False and r["cortesDocumentados"] == 0 and r["reanclajes"] == []
    assert [x["tipo"] for x in r["roturas"]] == ["bifurcacion", "reanclaje_suelto"]
    assert "no documenta" in r["roturas"][1]["motivo"]
    # El reanclaje legítimo (encadenado al último hash) sí documenta las dos roturas.
    v = al.reanclar_registro("Bifurcación del reinicio y una fila suelta metida a mano el 17/09/2026", "admin@alzheimerproject.com")
    assert v["roturasDocumentadas"] == 2
    r = al.verificar_cadena()
    assert r["ok"] is True and r["cortesDocumentados"] == 1 and [x["tipo"] for x in r["roturasDocumentadas"]] == ["bifurcacion", "reanclaje_suelto"]
    assert h_rama  # la rama sigue en el registro, solo que documentada
    al.cerrar()


def test_un_reducer_que_lanza_tras_arrancar_no_deja_el_estado_sin_migrar():
    """La recarga tras un reducer que lanza se hacía sin migración: un estado
    guardado por una ROSA2018 anterior (sin `cuestiones`, `datasetsPrograma`,
    `conectores`...) perdía en memoria las claves que la migración le había
    puesto al arrancar, y la interfaz las recibía ausentes hasta el siguiente
    reinicio."""
    ruta = _ruta_temporal()
    al = Almacen(ruta)
    al.aplicar("anadirCriterio", {"texto": "c"})
    al.cerrar()
    con = sqlite3.connect(str(ruta), isolation_level=None)
    e = json.loads(con.execute("SELECT json FROM estado WHERE clave='rosa'").fetchone()[0])
    claves = ("cuestiones", "datasetsPrograma", "conectores", "skills", "politicas")
    for k in claves:
        e.pop(k, None)
    con.execute("UPDATE estado SET json=? WHERE clave='rosa'", (json.dumps(e),))
    con.close()
    al = Almacen(ruta)
    assert all(k in al.estado for k in claves)

    def rompe(e2):
        e2["criteriosRevision"].append("a medias")
        raise ValueError("argumento malo del navegador")

    with pytest.raises(ValueError):
        al.mutar(rompe)
    assert "a medias" not in al.estado["criteriosRevision"]
    assert all(k in al.estado for k in claves), [k for k in claves if k not in al.estado]
    assert '"cuestiones"' in al.instantanea_json()
    # Y la línea base de las partes sigue coherente (B-16).
    al.mutar(lambda e2: e2.__setitem__("ultimaVisita", 7) or True, "prueba")
    con = sqlite3.connect(str(ruta))
    args = json.loads(con.execute("SELECT args FROM acciones ORDER BY seq DESC LIMIT 1").fetchone()[0])
    con.close()
    assert set(args["cambiaron"]) <= {"ultimaVisita"} | set(claves)  # las migradas se guardan con la primera escritura
    al.cerrar()


def test_al_quedar_obsoleto_la_memoria_vuelve_a_disco_y_se_avisa_una_vez(cliente):
    """Antes, el almacén obsoleto se quedaba en memoria con la mutación que no
    pudo guardar (la interfaz la veía como si existiera) y nadie paraba el
    bucle: seguía pagando llamadas al modelo que jamás podría escribir. Ahora
    la memoria vuelve a lo que hay en disco, se llama a `al_quedar_obsoleto`
    (main.py para el supervisor y el servidor) y la API responde 503."""
    c, al, _ = cliente
    avisos = []
    al.al_quedar_obsoleto(lambda: avisos.append(1))
    al.aplicar("anadirCriterio", {"texto": "uno"})
    otro = sqlite3.connect(str(al.ruta), isolation_level=None)
    otro.execute("UPDATE estado SET version=version+5, json=? WHERE clave='rosa'", (json.dumps({**json.loads(otro.execute("SELECT json FROM estado").fetchone()[0]), "criteriosRevision": ["escrito por la otra ROSA2018"]}),))
    otro.close()
    with pytest.raises(EscritorObsoleto):
        al.aplicar("anadirCriterio", {"texto": "dos"})
    assert al.obsoleto and avisos == [1]
    assert al.estado["criteriosRevision"] == ["escrito por la otra ROSA2018"] and al.version == 6  # lo que hay en disco, no "dos"
    assert json.loads(al.instantanea_json())["criteriosRevision"] == ["escrito por la otra ROSA2018"]
    # El segundo intento no vuelve a avisar ni toca el reducer.
    with pytest.raises(EscritorObsoleto):
        al.aplicar("anadirCriterio", {"texto": "tres"})
    assert avisos == [1]
    # Por la API: 503 con motivo, no un 500 mudo; y /api/salud lo dice.
    r = c.post("/api/acciones/anadirCriterio", json={"texto": "cuatro"}, headers={"X-Rosa": "1"})
    assert r.status_code == 503 and "no puede guardar" in r.json()["detail"]
    s = c.get("/api/salud").json()
    assert s["ok"] is False and s["obsoleto"] is True and s["version"] == 6
    assert c.get("/api/estado").status_code == 200  # leer sigue funcionando mientras se cierra


@pytest.mark.asyncio
async def test_correr_con_tope_no_se_cae_si_una_tarea_llega_cancelada():
    """`Task.exception()` lanza CancelledError sobre una tarea cancelada; el
    apagado tiene que sobrevivir a que el servidor termine así."""
    from rosa.main import correr_con_tope

    class ServidorCancelado:
        should_exit = False

        async def serve(self):
            raise asyncio.CancelledError()

    supervisor = _SupervisorFalso(tarda=0.01)
    await correr_con_tope(ServidorCancelado(), supervisor, tope_s=2)
    assert supervisor.termino
