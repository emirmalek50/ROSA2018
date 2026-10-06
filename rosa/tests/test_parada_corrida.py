"""La parada propia de una corrida: horas, iteraciones, llamadas o texto
fijados al crearla; se detiene con lo que llegue primero, además de la
condición de la investigación."""
from rosa import parada as PARADA
from rosa.bucle.corrida import _condicion_de_parada as f
from rosa.estado import acciones as A


def test_normalizar_parada_acota_y_descarta_lo_vacio():
    assert PARADA.normalizar_parada({"horas": 1 / 60})["horas"] == 1 / 60
    assert PARADA.normalizar_parada({"horas": 10 / 60})["horas"] * 3600 == 600
    assert PARADA.resumen_parada({"horas": 48}) == "2 días"
    assert PARADA.normalizar_parada(None) is None and PARADA.normalizar_parada({}) is None
    assert PARADA.normalizar_parada({"horas": "", "iteraciones": None, "llamadas": "", "texto": "  "}) is None
    p = PARADA.normalizar_parada({"horas": "2,5", "iteraciones": 6.9, "llamadas": "3", "texto": " hasta que cambie "})
    assert p == {"horas": 2.5, "iteraciones": 6, "llamadas": 10, "texto": "hasta que cambie", "certeza": None, "cuantas": None, "sinCambio": None}
    assert PARADA.normalizar_parada({"horas": -1, "iteraciones": "abc"}) is None
    assert PARADA.normalizar_parada({"horas": 9999})["horas"] == 336
    assert PARADA.normalizar_parada("2 horas") is None


def test_resumen_parada_y_texto_condicion():
    assert PARADA.resumen_parada(None) == ""
    assert PARADA.resumen_parada({"horas": 2}) == "2 horas"
    assert PARADA.resumen_parada({"horas": 0.5, "iteraciones": 6}) == "30 minutos o 6 iteraciones, lo que llegue primero"
    assert PARADA.resumen_parada({"horas": 1, "iteraciones": 3, "llamadas": 500, "texto": "sin cambios"}) == "1 hora, 3 iteraciones, 500 llamadas al modelo o «sin cambios», lo que llegue primero"
    inv = {"condicionParada": "cuando el modelo de mundo deje de cambiar"}
    assert PARADA.texto_condicion(inv, {"parada": None}) == "cuando el modelo de mundo deje de cambiar"
    assert PARADA.texto_condicion(inv, {"parada": {"horas": 2, "iteraciones": None, "llamadas": None, "texto": ""}}).startswith("Esta corrida: como mucho 2 horas (tiempo de trabajo, sin contar esperas). La condición de la investigación sigue valiendo en lo que esta corrida no fija")


def test_la_corrida_se_detiene_con_lo_que_llegue_primero():
    c = {"empezadaEn": 0, "gasto": {"llamadas": 50}, "parada": {"horas": 2, "iteraciones": 6, "llamadas": 800, "texto": ""}}
    # Ni el tiempo, ni las iteraciones, ni las llamadas propias, ni la condición de la investigación.
    assert f("cuando el modelo de mundo deje de cambiar", 3, c, ahora=3_600_000) is None
    assert f("cuando el modelo de mundo deje de cambiar", 3, c, ahora=7_200_000).startswith("Se cumplió el tiempo fijado para esta corrida (2 horas)")
    assert f("cuando el modelo de mundo deje de cambiar", 6, c, ahora=1000) == "Se alcanzaron las 6 iteraciones fijadas para esta corrida"
    assert f("x", 1, dict(c, gasto={"llamadas": 800}), ahora=1000) == "Se alcanzaron las 800 llamadas fijadas para esta corrida"
    # La condición de la investigación no vuelve a aplicar un eje que la corrida fijó
    # (la corrida dice 6 iteraciones: el "2 iteraciones" general no la cierra), pero
    # sí los ejes que la corrida no fijó (aquí el texto propio está vacío).
    assert f("2 iteraciones", 2, c, ahora=1000) is None
    assert f("2 iteraciones", 6, c, ahora=1000) == "Se alcanzaron las 6 iteraciones fijadas para esta corrida"
    # Texto propio automatizable.
    c2 = {"empezadaEn": 0, "gasto": {"llamadas": 0}, "parada": {"horas": None, "iteraciones": None, "llamadas": None, "texto": "30 minutos"}}
    assert f("nunca", 1, c2, ahora=29 * 60_000) is None and f("nunca", 1, c2, ahora=31 * 60_000).endswith("(fijada para esta corrida)")
    # Sin parada propia, todo como antes.
    assert f("2 horas", 1, {"empezadaEn": 0, "gasto": {"llamadas": 0}}, ahora=7_200_000)


def test_iniciar_corrida_guarda_la_parada_y_alinea_el_presupuesto():
    e = {"investigaciones": [{"id": "inv", "titulo": "t", "estado": "activa", "condicionParada": "cuando cambie"}], "corridas": [], "eventos": []}
    cid = A.iniciar_corrida(e, "inv", 1000, parada={"horas": "1.5", "llamadas": 400, "texto": ""})
    c = e["corridas"][0]
    assert c["id"] == cid and c["parada"] == {"horas": 1.5, "iteraciones": None, "llamadas": 400, "texto": "", "certeza": None, "cuantas": None, "sinCambio": None}
    assert c["presupuesto"]["limiteLlamadas"] == 400
    assert e["eventos"][-1]["texto"].endswith("Se detiene con 1.5 horas o 400 llamadas al modelo, lo que llegue primero")
    # Sin parada: como antes, y no se crea otra mientras la anterior viva.
    assert A.iniciar_corrida(e, "inv", 2000) is False
    c["estado"] = "terminada"
    cid2 = A.iniciar_corrida(e, "inv", 3000)
    c2 = next(x for x in e["corridas"] if x["id"] == cid2)
    assert c2["parada"] is None and c2["numero"] == 2 and "Se detiene" not in e["eventos"][-1]["texto"]


def _c(**k):
    base = {"estado": "en_marcha", "empezadaEn": 0, "gasto": {"llamadas": 0, "usd": 0.0}, "parada": None}
    base.update(k)
    return base


def test_la_parada_propia_manda_sobre_la_condicion_general_en_su_eje():
    """Corrida 9 (17 de septiembre de 2026): la persona fijó 3 horas y la corrida se
    cerró a la hora por el "1 hora" de la condición general de la investigación."""
    propia = {"horas": 3.0, "iteraciones": None, "llamadas": None, "texto": "", "certeza": None, "cuantas": None, "sinCambio": None}
    c = _c(parada=propia)
    dos_horas = 2 * 3_600_000
    assert f("1 hora o 3 iteraciones", 1, c, ahora=dos_horas) is None
    assert "3 horas" in (f("1 hora", 1, c, ahora=3 * 3_600_000) or "")
    # Los ejes que la corrida no fijó siguen viniendo de la investigación.
    assert "3 iteraciones" in (f("1 hora o 3 iteraciones", 3, c, ahora=dos_horas) or "")
    # Sin parada propia, la condición general aplica tal cual.
    assert "1 hora" in (f("1 hora", 1, _c(), ahora=dos_horas) or "")


def test_la_espera_humana_y_las_pausas_no_cuentan_como_tiempo_de_trabajo():
    from rosa.bucle import corrida as CO

    propia = {"horas": 1.0, "iteraciones": None, "llamadas": None, "texto": "", "certeza": None, "cuantas": None, "sinCambio": None}
    dos_horas = 2 * 3_600_000
    # Dos horas de reloj, hora y media esperando el plan: media hora de trabajo, no para.
    c = _c(parada=propia, esperaHumanaMs=int(1.5 * 3_600_000))
    assert f("", 1, c, ahora=dos_horas) is None
    assert CO.tiempo_trabajo_ms(c, dos_horas) == 30 * 60_000
    # Con el equipo dormido una hora, tampoco.
    c2 = _c(parada=propia, pausaMs=3_600_000 + 1)
    assert f("", 1, c2, ahora=dos_horas) is None
    # Sin esperas ni pausas, a las dos horas sí para.
    assert f("", 1, _c(parada=propia), ahora=dos_horas)
    # La condición general en texto también usa el tiempo de trabajo.
    assert f("1 hora", 1, _c(esperaHumanaMs=dos_horas), ahora=dos_horas) is None


def test_contabilizar_tiempo_separa_espera_humana_pausas_y_trabajo():
    from rosa.bucle import corrida as CO

    c = _c(estado="esperando_plan")
    assert CO.contabilizar_tiempo(c, 1_000) is False  # primer tic: solo fija la marca
    assert CO.contabilizar_tiempo(c, 61_000) is True and c["esperaHumanaMs"] == 60_000
    c["estado"] = "en_marcha"
    assert CO.contabilizar_tiempo(c, 62_000) is False and c.get("pausaMs", 0) == 0  # un segundo de trabajo
    assert CO.contabilizar_tiempo(c, 62_000 + 10 * 60_000) is True and c["pausaMs"] == 10 * 60_000  # diez minutos sin tics: dormido
    c["estado"] = "esperando_aprobacion"
    CO.contabilizar_tiempo(c, 62_000 + 10 * 60_000 + 5_000)
    assert c["esperaHumanaMs"] == 65_000
    # Un reloj que va hacia atrás no resta nada.
    assert CO.contabilizar_tiempo(c, 0) is False


def test_parada_bilingue_coincide_con_lo_que_ejecuta_el_bucle():
    c = {"empezadaEn": 0, "gasto": {"llamadas": 1}}
    for texto in ("3 iterations or 72 hours", "3 iteraciones o 72 horas"):
        partes = PARADA.partes_automatizadas(texto)
        assert partes["iteraciones"] == 3 and partes["tiempo"] == "72 h" and partes["resto"] == ""
        assert f(texto, 2, c, ahora=1000) is None
        assert f(texto, 3, c, ahora=1000).startswith("Se alcanzaron las 3")
    for texto in ("1 call", "1 llamada"):
        assert f(texto, 1, c, ahora=1000).startswith("Se alcanzaron las 1 llamadas")
    for texto in ("1.5 hours", "1,5 horas", "90 minutes"):
        assert f(texto, 1, c, ahora=5_399_000) is None
        assert f(texto, 1, c, ahora=5_400_000).startswith("Se cumplió el tiempo")
    assert PARADA.partes_automatizadas("2 days")["tiempo"] == "2 d"
    for texto in ("-3 iterations", "3.5 iterations", "1,5 calls", "-2 hours", "3 iterationsXYZ", "3 llamadasExtra", "2 hoursExtra"):
        assert not PARADA.partes_automatizadas(texto)["automatizada"], texto
        assert f(texto, 100, c, ahora=999_999_999) is None, texto
