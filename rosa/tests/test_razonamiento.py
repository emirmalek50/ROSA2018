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
        next_thought = "Busco esto — y luego aquello"
        next_tool_name = "buscar_pubmed"

    p.on_module_end("m1", Salida())
    assert "—" not in p.pasos()[0]["texto"]
