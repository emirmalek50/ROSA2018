"""Las cuestiones abiertas tienen que llegar a lo que escribe las consultas.

El 29 de septiembre de 2026 la base tenía 127 cuestiones abiertas: 46 de ellas
las había escrito el Killer diciendo qué le falta a cada una de las 27
hipótesis que él mismo suspendió ("el recuento real en ADNI del subgrupo APOE
ε4+ · amiloide-positivo"), y 25 eran el peldaño siguiente de la escalera de
certeza. Cosas concretas y buscables. En la investigación con más cuestiones
abiertas llegaban CERO al criterio del paso, porque las preguntas del modelo de
mundo se comían las ocho líneas: ROSA2018 escribía qué le falta y no se lo
enseñaba nunca a la parte que lo buscaría, así que las hipótesis se quedaban
suspendidas para siempre.
"""

from rosa.bucle import contexto as T


def _hecho(i, enunciado, inv="inv-1"):
    return {"id": f"he-{i}", "investigacionId": inv, "tipo": "pregunta", "estado": "abierto", "enunciado": enunciado, "prioridad": i, "historial": [{"quien": "Rosa"}], "actualizadoEn": 0}


def _cuestion(i, texto, prioridad=3, tipo="killer", inv="inv-1"):
    return {"id": f"cu-{i}", "investigacionId": inv, "texto": texto, "estado": "abierta", "origen": {"tipo": tipo, "id": None}, "queLaResolveria": f"lo que resuelve {i}", "prioridad": prioridad, "creadaEn": i, "historial": []}


def test_con_el_criterio_lleno_de_preguntas_las_cuestiones_siguen_entrando():
    hechos = [_hecho(i, f"Pregunta del modelo {i}") for i in range(1, 11)]
    cuestiones = [_cuestion(i, f"Falta el dato {i}") for i in range(1, 6)]
    texto = T.preguntas_abiertas(hechos, "inv-1", "Objetivo", cuestiones=cuestiones, turno=1)
    lineas = [x for x in texto.split("\n") if x[:2].strip().rstrip(".").isdigit()]
    assert len(lineas) == 8, texto
    entran = sum(1 for c in cuestiones if c["texto"] in texto)
    assert entran == T.RESERVA_CUESTIONES == 3, texto
    # Y las preguntas del modelo de mundo se quedan con el resto, no con nada.
    assert sum(1 for h in hechos if h["enunciado"] in texto) == 5


def test_la_cuestion_llega_con_lo_que_la_resolveria():
    """El generador de consultas necesita saber qué la cerraría, no solo que
    está abierta."""
    texto = T.preguntas_abiertas([], "inv-1", "Objetivo", cuestiones=[_cuestion(1, "Falta el recuento en ADNI")], turno=1)
    assert "Falta el recuento en ADNI" in texto and "la resolvería: lo que resuelve 1" in texto


def test_rotan_con_la_iteracion_y_se_recorren_todas():
    """Con 24 cuestiones y 3 sitios, sin rotar saldrían las tres mismas para
    siempre y las otras 21 no se buscarían nunca."""
    hechos = [_hecho(i, f"Pregunta {i}") for i in range(1, 11)]
    cuestiones = [_cuestion(i, f"Falta el dato {i}") for i in range(1, 25)]
    vistas = set()
    for turno in range(0, 8):
        texto = T.preguntas_abiertas(hechos, "inv-1", "Objetivo", cuestiones=cuestiones, turno=turno)
        vistas |= {c["id"] for c in cuestiones if c["texto"] in texto}
    assert len(vistas) == 24, f"solo se recorrieron {len(vistas)} de 24"


def test_dentro_de_cada_vuelta_manda_la_prioridad():
    cuestiones = [_cuestion(1, "Menos urgente", prioridad=5), _cuestion(2, "Lo que pidió una persona", prioridad=1, tipo="persona")]
    texto = T.preguntas_abiertas([], "inv-1", "Objetivo", cuestiones=cuestiones, turno=0)
    assert texto.index("Lo que pidió una persona") < texto.index("Menos urgente")


def test_sin_cuestiones_el_criterio_no_cambia():
    hechos = [_hecho(i, f"Pregunta {i}") for i in range(1, 11)]
    texto = T.preguntas_abiertas(hechos, "inv-1", "Objetivo", cuestiones=[], turno=3)
    lineas = [x for x in texto.split("\n") if x[:2].strip().rstrip(".").isdigit()]
    assert len(lineas) == 8 and all(f"Pregunta {i}" in texto for i in range(1, 9))


def test_una_cuestion_de_otra_investigacion_o_ya_resuelta_no_entra():
    cs = [_cuestion(1, "De otra", inv="inv-2"), {**_cuestion(2, "Ya resuelta"), "estado": "resuelta"}, _cuestion(3, "Viva")]
    texto = T.preguntas_abiertas([], "inv-1", "Objetivo", cuestiones=cs, turno=0)
    assert "Viva" in texto and "De otra" not in texto and "Ya resuelta" not in texto


def test_con_una_sola_cuestion_no_se_repite_tres_veces():
    texto = T.preguntas_abiertas([], "inv-1", "Objetivo", cuestiones=[_cuestion(1, "La única")], turno=5)
    assert texto.count("La única") == 1


def test_el_paso_pasa_el_numero_de_iteracion():
    """Sin `turno`, la rotación no rota: siempre saldrían las tres mismas."""
    import inspect

    from rosa.bucle import pasos as PASOS

    assert "turno=ctx.numero" in inspect.getsource(PASOS._criterio)


def test_un_turno_raro_no_tumba_el_criterio():
    """Probado a la contra: un turno negativo, enorme, None, un máximo de 0 o de
    1 y cien cuestiones. El criterio es lo que decide qué se lee; si lanza, el
    paso entero cae."""
    cs = [_cuestion(i, f"Falta {i}") for i in range(4)]
    for turno in (-5, 10**9, None, 0):
        texto = T.preguntas_abiertas([], "inv-1", "Objetivo", cuestiones=cs, turno=turno)
        lineas = [x for x in texto.split("\n") if x[:2].strip().rstrip(".").isdigit()]
        assert len(lineas) == len(set(lineas)) == 4, (turno, texto)
    assert T.preguntas_abiertas([_hecho(1, "P")], "inv-1", "Objetivo", maximo=0, cuestiones=cs, turno=1)
    assert T.preguntas_abiertas([_hecho(1, "P")], "inv-1", "Objetivo", maximo=1, cuestiones=cs, turno=1)
    muchas = [_cuestion(i, f"Falta {i}") for i in range(100)]
    texto = T.preguntas_abiertas([_hecho(i, f"P{i}") for i in range(20)], "inv-1", "Objetivo", cuestiones=muchas, turno=7)
    lineas = [x for x in texto.split("\n") if x[:2].strip().rstrip(".").isdigit()]
    assert len(lineas) == len(set(lineas)) == 8
