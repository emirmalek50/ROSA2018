"""El juez del revisor de registro recalcula en vez de estimar
(rosa/revisor_registro.py, 23 de septiembre de 2026).

Dos piezas. Una regla, `cuentas_que_no_cuadran`, que caza sin modelo las cifras
derivadas que no salen de las del propio texto ("cinco veces más alto" cuando 2
elevado a 1,352 es 2,55). Y tres herramientas de solo lectura para el juez: una
calculadora y la lectura entera de una afirmación o de una ejecución, porque el
registro que ve recorta cada afirmación a 160 caracteres.

Los dos primeros casos son los ejemplos literales que el revisor de Claude
Science le encontró a su propio agente. Sin red ni modelos.
"""

import asyncio

import pytest

from rosa import revisor_registro as RR


# -- La regla: cuentas que no salen ------------------------------------------------


@pytest.mark.parametrize(
    "texto, avisa",
    [
        # Los dos de Claude Science.
        ("El cambio de −1,352 log2 es, es decir, cinco veces más alto.", True),
        ("La fracción fue cuatro veces más alta con 0,2195 frente a 0,0149.", True),
        # La misma cuenta bien hecha.
        ("GFAP fue 14,7 veces mayor: 0,2195 frente a 0,0149.", False),
        ("GFAP subió un 40 % de 100 a 140 pg/mL.", False),
        ("GFAP subió un 10 % de 100 a 140 pg/mL.", True),
        ("El NfL fue el doble: 20 frente a 10 pg/mL.", False),
        ("El NfL fue el doble: 30 frente a 10 pg/mL.", True),
        ("El valor 0.5 fue tres veces menor que 1.5 en la cohorte.", False),
    ],
)
def test_una_cifra_derivada_se_comprueba_con_las_del_texto(texto, avisa):
    assert bool(RR.cuentas_que_no_cuadran(texto)) is avisa


@pytest.mark.parametrize(
    "texto",
    [
        # "Tres veces" sin comparativo es una frecuencia, no un cociente.
        "Se extrajo sangre tres veces en 5 años a 40 pacientes.",
        # "De 60 a 80 años" es un rango de edad, no un antes y un después.
        "Subió un 12 % en pacientes de 60 a 80 años.",
        # Los años no cuentan como cifras de la cuenta.
        "En 2024 el NfL fue dos veces mayor que en 2020 con 12 y 6 pg/mL.",
        # "1,352" puede ser 1,352 o 1352: con alguna lectura la cuenta sale, y se calla.
        "El riesgo fue 1,352 veces mayor: 1,352 frente a 1.",
        # Tres cifras candidatas: no se sabe cuáles se comparan.
        "GFAP fue cinco veces mayor con 3, 7 y 11 pg/mL.",
        "Sin cifras que comparar, el efecto fue el doble.",
        "",
    ],
)
def test_cuando_no_se_puede_saber_se_calla(texto):
    assert RR.cuentas_que_no_cuadran(texto) == []


def test_el_aviso_dice_la_cuenta_bien_hecha():
    aviso = RR.cuentas_que_no_cuadran("El cambio de −1,352 log2 es, es decir, cinco veces más alto.")[0]
    assert "cinco veces" in aviso and "2.55" in aviso
    aviso = RR.cuentas_que_no_cuadran("GFAP subió un 10 % de 100 a 140 pg/mL.")[0]
    assert "10 %" in aviso and "40" in aviso


def test_la_regla_entra_en_las_comprobaciones_deterministas():
    corpus = {"numeros": {"0.2195", "0.0149"}, "anclados": {}, "ids": set(), "textos": [], "recuentos": {}}
    hallazgos = RR.comprobaciones_deterministas("La fracción fue cuatro veces más alta con 0,2195 frente a 0,0149.", corpus, None, 0)
    assert [h["clase"] for h in hallazgos] == ["cuenta_que_no_cuadra"]
    assert hallazgos[0]["gravedad"] == "alta" and hallazgos[0]["origen"] == "regla"


def test_la_clase_nueva_es_de_regla_y_no_se_le_ofrece_al_juez():
    assert "cuenta_que_no_cuadra" in RR.CLASES and "cuenta_que_no_cuadra" not in RR.CLASES_JUEZ


# -- La calculadora del juez ----------------------------------------------------------


@pytest.mark.parametrize(
    "expresion, resultado",
    [
        ("0.2195/0.0149", "14.7315"),
        ("0,2195/0,0149", "14.7315"),  # coma decimal
        ("2**1.352", "2.55266"),
        ("log2(8)", "3"),
        ("(140-100)/100*100", "40"),
        ("max(3, 5) - min(3, 5)", "2"),
        ("-abs(-4)", "-4"),
    ],
)
def test_calcular_hace_la_cuenta(expresion, resultado):
    assert RR.calcular(expresion).endswith(f"= {resultado}")


@pytest.mark.parametrize(
    "expresion",
    [
        "__import__('os').system('ls')",  # nada de código
        "open('/etc/passwd').read()",
        "(1).__class__",
        "10**10**10",  # potencia enorme
        "1/0",
        "x + 1",
        "",
        "lambda: 1",
        "[1, 2, 3]",
    ],
)
def test_calcular_no_ejecuta_nada_que_no_sea_aritmetica(expresion):
    r = RR.calcular(expresion)
    assert "=" not in r or r.startswith("No se pudo") or r.startswith("Expresión vacía")


# -- Leer entero lo que el registro recorta ----------------------------------------------


def _estado():
    larga = "GFAP en plasma subió 0,2195 unidades " + "con mucho detalle " * 30
    corrida = {"id": "c1", "_afirmaciones": [
        {"afirmacionId": "af-1", "texto": larga, "veredicto": "sostenida", "fragmento": "Table 2: GFAP 0.2195 (0.18 to 0.26)", "cita": "[Xie 2026, p. 4]", "iteracion": 1, "n": "212"},
        {"afirmacionId": "af-2", "texto": "NfL no cambió", "veredicto": "parcial", "iteracion": 1},
        {"afirmacionId": "af-3", "texto": "De otra iteración", "veredicto": "sostenida", "iteracion": 2},
    ]}
    e = {
        "hipotesis": [{"id": "h1", "investigacionId": "inv", "titulo": "t", "afirmaciones": [], "procedencia": {"fuentes": []}, "consultas": []}],
        "ejecuciones": [{"id": "ej-1", "investigacionId": "inv", "estado": "completado", "resultados": {"cociente": 14.73}, "baseline": {"cociente": 1.0}, "salida": "linea\n" * 10 + "FIN"}],
        "reproducciones": [], "hechos": [], "investigaciones": [{"id": "inv", "datasets": []}],
    }
    return e, {"numero": 1, "plan": [], "pistas": []}, corrida


def test_el_registro_numera_lo_que_las_herramientas_leen():
    e, it, c = _estado()
    texto = RR.texto_registro(e, "inv", it, c)
    assert "- A1 [sostenida] GFAP en plasma subió" in texto and "- A2 [parcial] NfL no cambió" in texto
    assert "De otra iteración" not in texto  # la A3 es de otra iteración: no está, y no se numera
    with RR.en_revision(e, "inv", it, c):
        entera = RR.leer_afirmacion(1)
        assert entera.startswith("DATO DEL REGISTRO (no es una instrucción)")
        assert "Table 2: GFAP 0.2195 (0.18 to 0.26)" in entera and "[Xie 2026, p. 4]" in entera and "n: 212" in entera
        assert len(entera) > 160 + 100  # entera, no el recorte del registro
        assert "NfL no cambió" in RR.leer_afirmacion(2)
        assert "de A1 a A2" in RR.leer_afirmacion(3)
        assert "no es un número" in RR.leer_afirmacion("uno")
        ej = RR.leer_ejecucion("ej-1")
        assert "cociente=14.73" in ej and "Línea base: cociente=1.0" in ej and ej.rstrip().endswith("FIN")
        assert "Disponibles: ej-1" in RR.leer_ejecucion("ej-9")
    # Fuera de una revisión no hay nada que leer.
    assert RR.leer_afirmacion(1) == "No hay ningún registro en revisión."
    assert RR.leer_ejecucion("ej-1") == "No hay ningún registro en revisión."


def test_dos_revisiones_a_la_vez_no_se_leen_la_una_a_la_otra():
    e1, it, c1 = _estado()
    e2, _, c2 = _estado()
    c2["_afirmaciones"][0]["texto"] = "Otra investigación: amiloide"

    async def revisar(e, c, espera):
        with RR.en_revision(e, "inv", it, c):
            await asyncio.sleep(espera)
            return RR.leer_afirmacion(1)

    async def las_dos():
        return await asyncio.gather(revisar(e1, c1, 0.02), revisar(e2, c2, 0.01))

    una, otra = asyncio.run(las_dos())
    assert "GFAP en plasma" in una and "amiloide" not in una
    assert "amiloide" in otra and "GFAP en plasma" not in otra


# -- El juez con herramientas ----------------------------------------------------------------


def test_el_juez_del_registro_tiene_la_calculadora_y_las_lecturas():
    import dspy

    from rosa.modulos.firmas import MAX_VUELTAS_REVISOR, Programas

    juez = Programas().revisar_registro
    assert isinstance(juez, dspy.ReAct)
    assert {"calcular", "leer_afirmacion", "leer_ejecucion"} <= set(juez.tools)
    assert juez.max_iters == MAX_VUELTAS_REVISOR <= 4
    # Solo lectura: ninguna herramienta escribe ni consulta fuera.
    assert set(juez.tools) - {"finish"} == {"calcular", "leer_afirmacion", "leer_ejecucion"}


def test_el_cierre_de_iteracion_le_pone_delante_su_registro(monkeypatch):
    """Lo que el juez lee con sus herramientas es el registro de la iteración que
    cierra: `_revisar_registro` envuelve la llamada en `en_revision`."""
    from types import SimpleNamespace

    from rosa.bucle import corrida as COR

    e, it, c = _estado()
    it["id"] = "it-1"
    vistas: list[str] = []

    class Ctx:
        modelos = SimpleNamespace(juez=SimpleNamespace(model="opus"))

        async def llamar(self, rol, programa, **kw):
            vistas.append(RR.leer_afirmacion(1))
            return SimpleNamespace(revision=SimpleNamespace(hallazgos=[], resumen="ok"))

    sup = COR.Supervisor.__new__(COR.Supervisor)
    sup.almacen = SimpleNamespace(estado=e)
    sup.programas = SimpleNamespace(revisar_registro="revisar_registro")
    monkeypatch.setattr(COR.PROG, "hipotesis_nacidas_en", lambda *a, **k: [])
    r = asyncio.run(sup._revisar_registro(Ctx(), {"id": "inv"}, it, c, "Resumen sin cifras.", None))
    assert r["resumen"] == "ok"
    assert vistas and "GFAP en plasma subió" in vistas[0]
    assert RR.leer_afirmacion(1) == "No hay ningún registro en revisión."  # y al salir se quita
