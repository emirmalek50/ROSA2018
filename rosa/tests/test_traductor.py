"""La traducción bajo demanda (rosa/traductor.py). Con un modelo falso: no
cuesta llamadas y se puede hacer que falle o que traduzca mal a propósito."""

from __future__ import annotations

from rosa import traductor as T


def _cache(tmp_path):
    return T.Cache(tmp_path / "traducciones.db")


def test_traduce_lo_que_falta_y_lo_guarda(tmp_path):
    c = _cache(tmp_path)
    llamadas = []

    def falso(lote):
        llamadas.append(list(lote))
        return {t: f"EN {t}" for t in lote}

    r = T.traducir(["La GFAP sube antes.", "Hipótesis propuesta"], llamar=falso, almacen=c)
    assert r["traducciones"] == {"La GFAP sube antes.": "EN La GFAP sube antes.", "Hipótesis propuesta": "EN Hipótesis propuesta"}
    assert len(llamadas) == 1
    # La segunda vez sale de la caché: el modelo no se vuelve a llamar.
    r2 = T.traducir(["La GFAP sube antes."], llamar=falso, almacen=c)
    assert r2["traducciones"]["La GFAP sube antes."] == "EN La GFAP sube antes."
    assert len(llamadas) == 1
    assert c.cuantas() == 2


def test_la_cache_sobrevive_a_reabrirla(tmp_path):
    T.traducir(["algo que traducir"], llamar=lambda lote: {t: "something to translate" for t in lote}, almacen=_cache(tmp_path))
    otra = _cache(tmp_path)
    assert T.traducir(["algo que traducir"], llamar=None, almacen=otra)["traducciones"] == {"algo que traducir": "something to translate"}


def test_lo_que_incumple_las_reglas_no_se_guarda_y_se_queda_en_castellano(tmp_path):
    """Una traducción que dice otra cosa es peor que no traducir: el
    castellano se entiende, una afirmación de más no."""
    c = _cache(tmp_path)
    malas = {
        "No pude comprobar la cohorte": "There is no cohort",  # «no pude comprobar» no es «no hay»
        "La evidencia sostiene la hipótesis": "The evidence proves the hypothesis",  # afirma de más
        "Quedan {n} de {m}": "{n} remaining",  # se come un hueco
        "Una frase normal": "A normal sentence \u2014 with a dash",  # guion largo
    }
    r = T.traducir(list(malas), llamar=lambda lote: {t: malas[t] for t in lote}, almacen=c)
    assert r["traducciones"] == {}
    assert set(r["rechazadas"]) == set(malas)
    assert c.cuantas() == 0


def test_si_el_modelo_falla_no_se_guarda_nada_y_no_se_lanza(tmp_path):
    def roto(lote):
        raise TimeoutError("sin respuesta")

    r = T.traducir(["una frase"], llamar=roto, almacen=_cache(tmp_path))
    assert r["traducciones"] == {}
    assert "no respondió" in r["rechazadas"]["una frase"]


def test_lo_que_el_modelo_no_devuelve_se_dice(tmp_path):
    r = T.traducir(["a traducir", "otra"], llamar=lambda lote: {"a traducir": "to translate"}, almacen=_cache(tmp_path))
    assert r["traducciones"] == {"a traducir": "to translate"}
    assert r["rechazadas"] == {"otra": "el modelo no la devolvió"}


def test_la_peticion_se_limpia_y_tiene_tope():
    assert T.limpiar("no es una lista") == []
    assert T.limpiar(["a", "a", "", "   ", 5, None, "b"]) == ["a", "b"]
    assert len(T.limpiar([f"t{i}" for i in range(500)])) == T.MAX_POR_PETICION
    assert T.limpiar(["x" * (T.MAX_CARACTERES + 1)]) == []


def test_los_lotes_van_por_tamaño():
    lotes = T._lotes(["x" * 3000, "y" * 3000, "z" * 100])
    assert len(lotes) == 2


def test_las_reglas_son_las_mismas_que_las_del_catalogo():
    """La regla comparativa: «confirma» en el original permite «confirms»."""
    assert T.comprobar("Detecta o confirma la enfermedad", "It detects or confirms the disease") is None
    assert T.comprobar("Sostiene la hipótesis", "It confirms the hypothesis") is not None


def _cliente(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    from rosa import config
    from rosa.estado.almacen import Almacen
    from rosa.servidor import crear_app

    monkeypatch.setattr(config, "RAIZ", tmp_path)
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>rosa</html>")
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    app = crear_app(Almacen(tmp_path / "t.db"))
    app.state.acceso = SimpleNamespace(usuario=lambda token: "test@alzheimerproject.com" if token == "sesion-test" else None)
    return TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-test"})


def test_el_endpoint_traduce_y_la_segunda_vez_sale_de_la_cache(tmp_path, monkeypatch):
    llamadas = []

    def falso(lote):
        llamadas.append(list(lote))
        return {t: f"EN {t}" for t in lote}

    monkeypatch.setattr(T, "llamar_modelo", falso)
    monkeypatch.setattr(T, "_CACHE", T.Cache(tmp_path / "traducciones.db"))
    c = _cliente(tmp_path, monkeypatch)
    cuerpo = {"textos": ["La GFAP sube antes que la NfL.", "La GFAP sube antes que la NfL.", 7]}
    r = c.post("/api/traducir", json=cuerpo, headers={"X-Rosa": "1"})
    assert r.status_code == 200, r.text
    assert r.json()["traducciones"] == {"La GFAP sube antes que la NfL.": "EN La GFAP sube antes que la NfL."}
    r = c.post("/api/traducir", json=cuerpo, headers={"X-Rosa": "1"})
    assert r.json()["traducciones"] == {"La GFAP sube antes que la NfL.": "EN La GFAP sube antes que la NfL."}
    assert len(llamadas) == 1, "la segunda vez tenía que salir de la caché"


def test_el_endpoint_sin_sesion_no_traduce(tmp_path, monkeypatch):
    monkeypatch.setattr(T, "_CACHE", T.Cache(tmp_path / "traducciones.db"))
    c = _cliente(tmp_path, monkeypatch)
    c.cookies.clear()
    r = c.post("/api/traducir", json={"textos": ["hola"]}, headers={"X-Rosa": "1"})
    assert r.status_code in (401, 403)


def test_el_endpoint_rechaza_dosis_alterada_y_devuelve_terminologia_revisada(tmp_path, monkeypatch):
    monkeypatch.setattr(T, 'llamar_modelo', lambda lote: {t: 'Dose of 20 mM' for t in lote})
    monkeypatch.setattr(T, '_CACHE', T.Cache(tmp_path / 'traducciones.db'))
    c = _cliente(tmp_path, monkeypatch)
    r = c.post('/api/traducir', json={'textos': ['Dosis de 20 µM', 'Puerta de reproducción']}, headers={'X-Rosa': '1'})
    assert r.status_code == 200
    assert r.json()['traducciones'] == {'Puerta de reproducción': 'Reproducibility gate'}
    assert 'Dosis de 20 µM' in r.json()['rechazadas']


def test_pasado_el_tope_del_dia_solo_lee_la_cache(tmp_path, monkeypatch):
    """Un freno contra un bucle: lo nuevo se queda en castellano, la
    pantalla no falla."""
    from rosa import servidor as S

    monkeypatch.setattr(S, "TRADUCCIONES_MAX_DIA", 0)
    monkeypatch.setattr(T, "llamar_modelo", lambda lote: {t: "nunca" for t in lote})
    monkeypatch.setattr(T, "_CACHE", T.Cache(tmp_path / "traducciones.db"))
    c = _cliente(tmp_path, monkeypatch)
    r = c.post("/api/traducir", json={"textos": ["una frase nueva"]}, headers={"X-Rosa": "1"})
    assert r.status_code == 200 and r.json()["traducciones"] == {}


def test_dos_peticiones_a_la_vez_no_pagan_dos_veces_la_misma_frase(tmp_path):
    """Con varias llamadas al modelo en paralelo, la misma frase pedida por
    dos pestañas a la vez se manda una sola vez."""
    import threading
    import time

    c = _cache(tmp_path)
    vistas: list[str] = []
    candado = threading.Lock()

    def lento(lote):
        with candado:
            vistas.extend(lote)
        time.sleep(0.3)
        return {t: f"EN {t}" for t in lote}

    resultados = []
    hilos = [threading.Thread(target=lambda: resultados.append(T.traducir(["la misma frase de la corrida"], llamar=lento, almacen=c))) for _ in range(3)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert vistas.count("la misma frase de la corrida") == 1
    assert all(r["traducciones"] == {"la misma frase de la corrida": "EN la misma frase de la corrida"} for r in resultados)
