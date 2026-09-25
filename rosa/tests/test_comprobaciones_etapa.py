"""Las comprobaciones de cierre por etapa (rosa/comprobaciones.py).

Del arnés de Yoon y otros (2026): cada etapa se cierra con una comprobación
escrita en código y ninguna etapa posterior se abre hasta que la anterior
termina. Lo que se comprueba aquí es que la comprobación distingue las cuatro
cosas que tiene que distinguir, que la puerta no rompe el camino real, y que el
hallazgo que genera NO se puede cerrar reescribiendo el resumen. Sin red ni
modelos.
"""

from typing import Any

from rosa import comprobaciones as COMP
from rosa import revisor_registro as RR

CLAVES = ("consultas", "identificados", "cribados", "fuentes", "fuentesSinExtraer", "afirmaciones", "conCita", "sinVerificar", "utilizables", "hechos", "cuestiones", "hipotesis", "hipotesisVivas", "partidos", "versiones", "novedadPendiente", "semillasVivero", "panorama", "datasetsAprobados", "ejecucionesOk", "fallosFuente")


def _m(**k: int) -> dict[str, int]:
    return {c: 0 for c in CLAVES} | k


def _comp(tipo: str, antes: dict[str, int], despues: dict[str, int], estado: str = "hecho", paso: dict[str, Any] | None = None, resumen: Any = None) -> dict[str, Any]:
    r = COMP.comprobar(tipo, antes, despues, paso or {}, resumen, estado)
    assert r is not None
    return r


# -- Las nueve reglas cubren los nueve ejecutores ---------------------------------


def test_hay_una_regla_por_cada_herramienta_que_rosa2018_tiene():
    from rosa.bucle import pasos as PASOS

    assert set(COMP._REGLAS) == set(PASOS.EJECUTORES), "una etapa sin regla pasa sin que nadie mire"
    assert set(COMP.DEPENDE_DE) <= set(COMP._REGLAS) and set(COMP.MATERIA) <= set(COMP._REGLAS)


# -- El estado del paso manda sobre la comprobación -------------------------------


def test_un_paso_sin_trabajo_es_sin_materia_y_uno_fallido_es_no_comprobable():
    """Los dos casos ya resueltos no se reabren: la comprobación solo añade
    información sobre los pasos que hoy quedan en verde."""
    z = _m()
    assert _comp("literatura", z, z, "sin_trabajo", resumen="no había fuentes nuevas")["resultado"] == "sin_materia"
    assert _comp("literatura", z, z, "fallido", paso={"motivoFallo": "PubMed no respondió"})["resultado"] == "no_comprobable"
    # Y una excepción NUNCA es "no hay": eso es la regla de la casa.
    assert "no respondió" in _comp("literatura", z, z, "fallido", paso={"motivoFallo": "PubMed no respondió"})["detalle"]


def test_un_paso_que_volvio_a_pendiente_no_cerro_ninguna_etapa_y_no_se_comprueba():
    """Presupuesto agotado, la persona detuvo, el modelo no responde: el paso se
    retoma entero. Decir algo de esa etapa sería inventarse un resultado."""
    z = _m()
    for estado in ("pendiente", "en_curso"):
        assert COMP.comprobar("literatura", z, z, {}, None, estado) is None
    # Y los pasos que no son de una herramienta tampoco.
    assert COMP.comprobar("indicacion", z, z, {}, None, "hecho") is None
    assert COMP.comprobar("lo_que_sea", z, z, {}, None, "hecho") is None


# -- Literatura: los cuatro finales ----------------------------------------------


def test_literatura_distingue_la_base_que_no_respondio_de_la_que_dijo_cero():
    z = _m()
    # Ninguna consulta: el cerebro no llegó a buscar.
    assert _comp("literatura", z, z)["resultado"] == "falla"
    # La base no respondió: no es que no haya literatura.
    r = _comp("literatura", z, _m(consultas=3, fallosFuente=2))
    assert r["resultado"] == "no_comprobable" and "no se pudo consultar" in r["detalle"]
    # Consultas que no casan con el índice.
    assert _comp("literatura", z, _m(consultas=3))["resultado"] == "falla"
    # Registros que no pasan el cribado: se cita lo que se escribió antes de buscar.
    r = _comp("literatura", z, _m(consultas=3, identificados=40), paso={"siNoAparece": "si no aparece, el mecanismo no está descrito"})
    assert r["resultado"] == "falla" and "el mecanismo no está descrito" in r["detalle"]
    # Cumple, con aviso cuando no entró ninguna fuente nueva.
    r = _comp("literatura", z, _m(consultas=3, identificados=40, cribados=5))
    assert r["resultado"] == "pasa" and "ninguna fuente nueva" in (r.get("aviso") or "")
    r = _comp("literatura", z, _m(consultas=3, identificados=40, cribados=5, fuentes=2))
    assert r["resultado"] == "pasa" and "aviso" not in r


def test_ensayos_con_cero_estudios_es_sin_materia_porque_la_fuente_contesto():
    z = _m()
    assert _comp("ensayos", z, _m(consultas=1))["resultado"] == "sin_materia"
    r = _comp("ensayos", z, _m(fallosFuente=1))
    assert r["resultado"] == "no_comprobable" and "no es 'sin ensayos'" in r["detalle"]


def test_verificacion_distingue_el_juez_que_no_llego_de_todo_bloqueado():
    r = _comp("verificacion", _m(sinVerificar=10), _m(sinVerificar=10))
    assert r["resultado"] == "no_comprobable" and "el juez no llegó" in r["detalle"]
    # Diez citas que no resuelven: el caso real de una iteración entera.
    r = _comp("verificacion", _m(sinVerificar=10), _m(sinVerificar=0))
    assert r["resultado"] == "falla" and "las 10 afirmaciones verificadas quedaron bloqueadas" in r["detalle"]
    r = _comp("verificacion", _m(sinVerificar=10), _m(sinVerificar=0, utilizables=3))
    assert r["resultado"] == "pasa" and "70 %" in (r.get("aviso") or "")
    r = _comp("verificacion", _m(sinVerificar=10), _m(sinVerificar=0, utilizables=9))
    assert r["resultado"] == "pasa" and "aviso" not in r


def test_novedad_nunca_falla_porque_el_fracaso_es_siempre_de_la_fuente():
    r = _comp("novedad", _m(novedadPendiente=5), _m(novedadPendiente=5))
    assert r["resultado"] == "no_comprobable", "en novedad, quien no responde es la base"
    assert "5 hipótesis siguen" in r["detalle"]
    r = _comp("novedad", _m(novedadPendiente=5), _m(novedadPendiente=4))
    assert r["resultado"] == "pasa" and "1 hipótesis dejó" in r["detalle"]


def test_hipotesis_avisa_cuando_el_torneo_recalienta_lo_que_ya_habia():
    base = _m(hipotesisVivas=4, utilizables=9)
    r = _comp("hipotesis", base, base)
    assert r["resultado"] == "falla"
    r = _comp("hipotesis", base, _m(hipotesisVivas=4, utilizables=9, partidos=6))
    assert r["resultado"] == "pasa" and "recalienta" in (r.get("aviso") or "")
    r = _comp("hipotesis", base, _m(hipotesisVivas=5, utilizables=9, hipotesis=1, partidos=6))
    assert r["resultado"] == "pasa" and "aviso" not in r


def test_el_detalle_concuerda_en_singular_y_en_plural():
    """Lo lee una persona: "1 cuestiones" no se enseña."""
    r = _comp("modelo", _m(utilizables=5), _m(utilizables=5, hechos=1, cuestiones=1))
    assert "1 hecho y 1 cuestión" in r["detalle"]
    r = _comp("modelo", _m(utilizables=5), _m(utilizables=5, hechos=2, cuestiones=3))
    assert "2 hechos y 3 cuestiones" in r["detalle"]


def test_la_medida_solo_guarda_lo_que_se_movio():
    r = _comp("literatura", _m(), _m(consultas=3, identificados=40, cribados=5, fuentes=2))
    assert r["medida"] == {"consultas": 3, "identificados": 40, "cribados": 5, "fuentes": 2}, "el estado no engorda con ceros"


# -- La puerta de la cadena ------------------------------------------------------


def test_la_puerta_no_cierra_una_etapa_que_tiene_materia_propia():
    """El caso que rompería el camino real: la segunda pasada de literatura no trae
    nada nuevo y la extracción se abre igual porque tiene fuentes sin extraer de la
    primera."""
    assert COMP.puede_abrir("extraccion", _m(fuentesSinExtraer=7), {"literatura": "falla"}) is None


def test_la_puerta_cierra_solo_con_las_dos_condiciones_a_la_vez():
    cerrada = COMP.puede_abrir("extraccion", _m(), {"literatura": "falla"})
    assert cerrada and "no tiene materia propia" in cerrada and "gastado en vacío" in cerrada
    # Sin materia NO cierra: "no había nada" no es "falló".
    assert COMP.puede_abrir("extraccion", _m(), {"literatura": "sin_materia"}) is None
    assert COMP.puede_abrir("extraccion", _m(), {"literatura": "pasa"}) is None
    # Ni una etapa de la que no se alimenta.
    assert COMP.puede_abrir("extraccion", _m(), {"meta": "falla"}) is None
    # Ni una etapa sin dependencias declaradas.
    assert COMP.puede_abrir("literatura", _m(), {"extraccion": "falla"}) is None


def test_no_comprobable_tambien_cierra_la_puerta():
    assert COMP.puede_abrir("verificacion", _m(), {"extraccion": "no_comprobable"}) is not None


# -- El agregado y la pausa del caso extremo -------------------------------------


def test_el_recuento_de_la_iteracion_y_cuando_esta_vacia():
    def it(*rs: str) -> dict[str, Any]:
        return {"plan": [{"id": f"p{i}", "comprobacion": {"etapa": "x", "resultado": r, "detalle": "", "medida": {}}} for i, r in enumerate(rs)]}

    r = COMP.resumen_de_iteracion(it("pasa", "pasa", "sin_materia", "falla"))
    assert (r["pasan"], r["sinMateria"], r["fallan"], r["noComprobables"]) == (2, 1, 1, 0)
    assert r["resumen"] == "2 etapas cumplieron; 1 no tenían nada sobre lo que trabajar; 1 tenían materia y no produjeron nada"
    assert r["vacia"] is False, "con etapas que cumplieron, la corrida sigue"
    # El caso extremo: ninguna cumplió y al menos una falló.
    assert COMP.resumen_de_iteracion(it("falla", "no_comprobable", "sin_materia"))["vacia"] is True
    # Todo sin materia no es vacío: no había nada que hacer, y eso no es un fallo.
    assert COMP.resumen_de_iteracion(it("sin_materia", "sin_materia"))["vacia"] is False
    # Sin comprobaciones (una iteración vieja) no se pausa nada.
    assert COMP.resumen_de_iteracion({"plan": []})["vacia"] is False
    assert COMP.resumen_de_iteracion({})["resumen"] == "Sin comprobaciones"


# -- Lo que el informe de choques avisó: no se cierra reescribiendo prosa --------


def test_la_etapa_incumplida_es_clase_propia_y_no_se_arregla_reescribiendo_el_texto():
    """Si fuera una variante de `paso_incompleto`, el hallazgo diría "una etapa falló
    y el resumen no lo dice" y se cerraría reescribiendo el resumen PARA QUE LO DIGA:
    la etapa seguiría rota y el registro quedaría limpio. Blanqueo por prosa."""
    assert "etapa_incumplida" in RR.CLASES
    assert "etapa_incumplida" not in RR.CLASES_JUEZ, "no se le ofrece al modelo: sale de una regla"
    assert "etapa_incumplida" in RR.CLASES_NO_REPARABLES_POR_TEXTO
    it = {"plan": [
        {"id": "p1", "titulo": "Buscar literatura", "estado": "hecho", "comprobacion": {"etapa": "literatura", "resultado": "falla", "detalle": "3 consultas y 0 registros identificados", "medida": {}}},
        {"id": "p2", "titulo": "Verificar", "estado": "hecho", "comprobacion": {"etapa": "verificacion", "resultado": "pasa", "detalle": "", "medida": {}}},
    ]}
    hallazgos = RR.comprobaciones_deterministas("Resumen técnico de la iteración.", {"numeros": set(), "citas": set(), "identificadores": set(), "anclados": {}}, it, 0)
    incumplida = [h for h in hallazgos if h["clase"] == "etapa_incumplida"]
    assert len(incumplida) == 1
    assert incumplida[0]["gravedad"] == "alta" and incumplida[0]["reparablePorTexto"] is False
    assert "literatura" in incumplida[0]["detalle"] and "0 registros identificados" in incumplida[0]["detalle"]


def test_una_etapa_sin_materia_o_no_comprobable_no_genera_el_hallazgo():
    """Solo `falla` (tenía materia y no produjo). `no_comprobable` es una fuente que
    no respondió: no hay a quién echarle la culpa dentro de ROSA2018."""
    for r in ("sin_materia", "no_comprobable", "pasa"):
        it = {"plan": [{"id": "p1", "titulo": "t", "estado": "hecho", "comprobacion": {"etapa": "literatura", "resultado": r, "detalle": "", "medida": {}}}]}
        hallazgos = RR.comprobaciones_deterministas("Resumen.", {"numeros": set(), "citas": set(), "identificadores": set(), "anclados": {}}, it, 0)
        assert not [h for h in hallazgos if h["clase"] == "etapa_incumplida"], r


# -- La lección, que es lo que aprende el planificador sin pagar nada ------------


def test_una_etapa_en_verde_que_no_produjo_deja_leccion_para_la_iteracion_siguiente():
    from rosa import lecciones as LEC

    it = {"numero": 3, "corridaId": "c", "plan": [
        {"id": "p1", "titulo": "Buscar literatura de GFAP", "tipo": "literatura", "estado": "hecho", "comprobacion": {"etapa": "literatura", "resultado": "falla", "detalle": "40 registros y ninguno pasó el cribado", "medida": {}}},
        {"id": "p2", "titulo": "Verificar", "tipo": "verificacion", "estado": "hecho", "comprobacion": {"etapa": "verificacion", "resultado": "pasa", "detalle": "ok", "medida": {}}},
    ], "pistas": []}
    c = {"id": "c", "investigacionId": "inv", "busqueda": {"consultas": []}}
    e = {"iteraciones": [it], "hipotesis": [], "decisiones": [], "investigaciones": [{"id": "inv"}], "ejecuciones": [], "incidencias": [], "hechos": []}
    lecciones = LEC.generar_al_cerrar(e, c, it, None, 1000)
    de_etapa = [x for x in lecciones if str(x.get("clave") or x.get("id") or "").startswith("etapa:") or "terminó en verde" in str(x.get("texto") or "")]
    assert de_etapa, f"sin lección no hay aprendizaje: {lecciones}"
    assert "ninguno pasó el cribado" in str(de_etapa[0])
