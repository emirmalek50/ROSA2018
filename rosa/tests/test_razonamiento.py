"""La línea de tiempo del razonamiento de una pregunta del chat
(rosa/razonamiento.py). Con un modelo falso de DSPy, así que no cuesta
llamadas."""

from __future__ import annotations

import asyncio

import dspy
from dspy.utils.callback import BaseCallback
from dspy.utils.dummies import DummyLM

from rosa import razonamiento as RZ


def buscar_pubmed(consulta: str) -> str:
    """Busca en PubMed."""
    return f"3 artículos sobre {consulta}"


def falla(consulta: str) -> str:
    """Una base que no responde."""
    return "Error: la base no respondió a tiempo"


class Firma(dspy.Signature):
    pregunta: str = dspy.InputField()
    respuesta: str = dspy.OutputField()


def _correr(progreso, herramientas, pasos_lm, otros_callbacks=()):
    lm = DummyLM(pasos_lm)

    async def main():
        with dspy.context(lm=lm, callbacks=list(otros_callbacks)):
            with dspy.context(callbacks=RZ.callbacks_con(progreso)):
                agente = dspy.ReAct(Firma, tools=herramientas, max_iters=4)
                return await agente.acall(pregunta="¿GFAP?")

    return asyncio.run(main())


def test_registra_pensar_y_herramienta_en_orden():
    p = RZ.Progreso()
    _correr(p, [buscar_pubmed], [
        {"next_thought": "Primero busco literatura sobre GFAP", "next_tool_name": "buscar_pubmed", "next_tool_args": {"consulta": "GFAP APOE4"}},
        {"next_thought": "Con eso basta", "next_tool_name": "finish", "next_tool_args": {}},
        {"reasoning": "r", "respuesta": "La GFAP sube antes."},
    ])
    pasos = p.pasos()
    assert [x["tipo"] for x in pasos] == ["pensar", "herramienta", "pensar"]
    assert pasos[0]["texto"] == "Primero busco literatura sobre GFAP"
    assert pasos[1]["herramienta"] == "buscar_pubmed"
    assert pasos[1]["argumentos"] == {"consulta": "GFAP APOE4"}
    assert pasos[1]["fin"] is not None and pasos[1]["error"] is None
    # El último pensamiento es el que cierra: se marca.
    assert pasos[2]["cierra"] is True
    # La herramienta de cerrar no es un paso.
    assert all(x.get("herramienta") != "finish" for x in pasos)


def test_no_pisa_los_callbacks_que_ya_habia():
    """El que importa. `dspy.context(callbacks=[...])` SUSTITUYE la lista, y en
    ella va el contador de coste de rosa/main.py: si se perdiera, las
    preguntas del chat dejarían de contarse en el gasto sin que nada avisara."""
    llamadas_al_modelo = []

    class Contador(BaseCallback):
        def on_lm_end(self, call_id, outputs, exception=None):
            llamadas_al_modelo.append(call_id)

    p = RZ.Progreso()
    _correr(p, [buscar_pubmed], [
        {"next_thought": "busco", "next_tool_name": "buscar_pubmed", "next_tool_args": {"consulta": "x"}},
        {"next_thought": "listo", "next_tool_name": "finish", "next_tool_args": {}},
        {"reasoning": "r", "respuesta": "ok"},
    ], otros_callbacks=[Contador()])
    assert len(llamadas_al_modelo) >= 3, "el contador de coste dejó de recibir las llamadas"
    assert len(p.pasos()) == 3


def test_una_base_que_falla_queda_marcada_como_fallo_no_como_vacia():
    """Las herramientas de ROSA2018 no lanzan: devuelven el fallo como texto.
    Si eso se tomara por un resultado, la línea de tiempo diría «respondió»
    de una base que no respondió."""
    p = RZ.Progreso()
    _correr(p, [falla], [
        {"next_thought": "pruebo", "next_tool_name": "falla", "next_tool_args": {"consulta": "x"}},
        {"next_thought": "no hubo suerte", "next_tool_name": "finish", "next_tool_args": {}},
        {"reasoning": "r", "respuesta": "No pude comprobarlo."},
    ])
    h = next(x for x in p.pasos() if x["tipo"] == "herramienta")
    assert h["error"] and "no respondió" in h["error"]
    assert h["resumen"] == ""


def test_una_llamada_que_no_termino_no_se_queda_en_marcha_para_siempre():
    p = RZ.Progreso()

    class Herr:
        name = "buscar_pubmed"

    p.on_tool_start("c1", Herr(), {"kwargs": {"consulta": "x"}})
    assert p.pasos()[0]["fin"] is None
    p.cerrar()
    h = p.pasos()[0]
    assert h["fin"] is not None and "no terminó" in h["error"]
    assert p.terminado is True


def test_nombres_en_llano_y_familia_para_el_icono():
    assert RZ.familia_y_nombre("leer_modelo_de_mundo") == ("mundo", "el modelo de mundo")
    assert RZ.familia_y_nombre("buscar_en_proyecto")[0] == "proyecto"
    familia, nombre = RZ.familia_y_nombre("algo_que_no_existe")
    assert familia == "otra" and nombre == "algo que no existe"


def test_el_registro_de_seguimientos_valida_el_id_y_caduca():
    assert RZ.id_valido("abc") is None
    assert RZ.id_valido("../../etc") is None
    assert RZ.id_valido("seg-1234abcd") == "seg-1234abcd"
    p = RZ.abrir("seg-caduca-0001")
    assert RZ.leer("seg-caduca-0001") == {"pasos": [], "terminado": False}
    p.tocado -= RZ.CADUCA_S + 1
    assert RZ.leer("seg-caduca-0001") is None
    assert RZ.leer("seg-no-existe-0001") is None


def test_sin_guiones_largos_en_lo_que_llega_a_pantalla():
    p = RZ.Progreso()

    class Salida:
        next_thought = "Busco esto \u2014 y luego aquello"
        next_tool_name = "buscar_pubmed"

    p.on_module_end("m1", Salida())
    assert "\u2014" not in p.pasos()[0]["texto"]


def test_la_fila_de_herramienta_sabe_de_que_base_y_cuantos_trajo():
    """Lo que `rosa/herramientas.py` devuelve de un conector lleva `fuente` y
    `n` dentro del dato delimitado. De ahí sale el «6 resultados» con el
    avatar de la base, como en Kimi. Si no están (proyecto, modelo de mundo)
    no se inventa nada."""
    from rosa import killer as K
    from rosa.razonamiento import _fuente_y_n

    salida = K.como_dato(str({"fuente": "Europe PMC", "n": 6, "invariante": "x", "datos": [1, 2]}))
    assert _fuente_y_n(salida) == ("Europe PMC", 6)
    # JSON con comillas dobles, que es como sale tras `_recortar`.
    assert _fuente_y_n('{"fuente": "PubMed", "n": 0, "datos": []}') == ("PubMed", 0)
    # Sin esas claves: nada, no un avatar inventado.
    assert _fuente_y_n("Hechos del modelo de mundo sobre GFAP: ...") == ("", None)
    # Un «n» que no es el del conector (dentro de un texto) no cuela.
    assert _fuente_y_n("la cohorte tenía n = 480 participantes") == ("", None)


def test_el_subpaso_es_una_frase_legible_nunca_json():
    """El «•» bajo la herramienta resume lo que trajo. En la primera prueba en
    vivo salía el JSON crudo de la salida; eso no es un resumen."""
    from rosa.razonamiento import _en_llano

    json_crudo = '<<<DATO_RECUPERADO>>>\n{"fuente": "Europe PMC", "n": 6, "datos": [{"titulo": "x"}]}\n<<<FIN_DATO_RECUPERADO>>>'
    assert _en_llano(json_crudo, "Europe PMC", 6) == "Europe PMC: 6 resultados"
    assert _en_llano(json_crudo, "PubMed", 1) == "PubMed: 1 resultado"
    assert _en_llano(json_crudo, "PubMed", 0) == "PubMed: 0 resultados"
    # Sin fuente ni n, y solo JSON: nada, mejor sin sub-paso.
    assert _en_llano('{"lecturas": {"eliminacion_dataset": {"descripcion": "x"}}}', "", None) == ""
    # Texto normal: la primera frase.
    assert _en_llano("Hechos del modelo de mundo sobre GFAP. Hay cuatro, ninguno longitudinal.", "", None) == "Hechos del modelo de mundo sobre GFAP."
    # Las marcas no cuentan como texto.
    assert _en_llano("<<<DATO_RECUPERADO>>>\nDoce hechos relacionados con p-tau217 en plasma.\n<<<FIN_DATO_RECUPERADO>>>", "", None) == "Doce hechos relacionados con p-tau217 en plasma."
