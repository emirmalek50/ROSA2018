"""El equipo de generación de hipótesis (rosa/equipo.py y pasos._equipo_de_hipotesis).

Park y otros (arXiv 2609.21032): un equipo que comparte lo que encuentra rinde más
que los mismos agentes aislados, SOLO con un marcador fiable durante el trabajo y
reglas contra el rebaño. Shen y otros (arXiv 2605.11258): la analogía con otro
campo saca a los modelos de proponer siempre lo mismo.

Lo que se intenta romper: que el marcador dependa de un modelo, que entren dos
propuestas que dicen lo mismo, que el equipo se quede en un solo enfoque, que la
segunda ronda no vea lo que falló, que un miembro que falla tumbe al equipo, y que
un modelo caído se trague en silencio. Sin red ni modelos."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from rosa import equipo as EQ
from rosa import politicas
from rosa.bucle import pasos as PASOS


def _hp(titulo: str, enunciado: str = "", mecanismo: str = "", afirmaciones: list[int] | None = None, prediccion: str = "Si sale al revés, se refuta") -> Any:
    return SimpleNamespace(titulo=titulo, enunciado=enunciado or titulo, mecanismo=mecanismo or titulo, afirmaciones=afirmaciones if afirmaciones is not None else [1, 2], prediccion_falsable=prediccion)


def _af(i: int, cohorte: str) -> dict[str, Any]:
    return {"id": f"af-{i}", "texto": f"afirmación {i}", "cita": f"Autor {i}, pág. 3", "veredicto": "sostenida", "tipo": "dato", "cohorte": cohorte, "fuenteId": f"f{i}", "localizador": "pág. 3"}


VALIDAS = [_af(1, "ADNI"), _af(2, "BioFINDER"), _af(3, "ADNI")]
FUENTES = {f"f{i}": {"id": f"f{i}", "referencia": f"Autor {i}", "cohorte": c} for i, c in ((1, "ADNI"), (2, "BioFINDER"), (3, "ADNI"))}


# -- El marcador, por regla --------------------------------------------------------


def test_el_marcador_premia_lo_que_rosa2018_ya_exige_y_dice_por_que():
    buena = EQ.puntuar(_hp("La saturación de un canal limita la señal clínica", afirmaciones=[1, 2]), VALIDAS, FUENTES, [], set())
    assert buena["nace"] is True and buena["respaldo"] == 2
    sin_prediccion = EQ.puntuar(_hp("Otra idea distinta sobre la barrera", afirmaciones=[1, 2], prediccion=""), VALIDAS, FUENTES, [], set())
    assert sin_prediccion["puntos"] < buena["puntos"] and any("predicción falsable" in m for m in sin_prediccion["motivos"])
    una_cohorte = EQ.puntuar(_hp("Una idea con una sola cohorte", afirmaciones=[1, 3]), VALIDAS, FUENTES, [], set())
    assert una_cohorte["nace"] is False and any("vivero" in m for m in una_cohorte["motivos"])


def test_sin_citar_una_afirmacion_sostenida_no_puntua_nada():
    r = EQ.puntuar(_hp("Una idea sin evidencia", afirmaciones=[]), VALIDAS, FUENTES, [], set())
    assert r["puntos"] == 0 and r["respaldo"] == 0 and "no cita" in r["motivos"][0]
    # Un índice fuera de rango tampoco cuenta.
    assert EQ.puntuar(_hp("Índices inventados", afirmaciones=[99, -1]), VALIDAS, FUENTES, [], set())["respaldo"] == 0


def test_repetir_una_hipotesis_existente_se_penaliza():
    existente = "La reactividad astrocitaria medida por GFAP precede al daño axonal medido por NfL en portadores"
    r = EQ.puntuar(_hp(existente), VALIDAS, FUENTES, [existente], set())
    assert any("repite una hipótesis" in m for m in r["motivos"])
    assert r["puntos"] < EQ.puntuar(_hp("Una idea que nadie ha tenido todavía sobre la barrera"), VALIDAS, FUENTES, [existente], set())["puntos"]


def test_volver_a_los_marcadores_dominantes_se_dice_y_salir_de_ellos_suma():
    dom = {"GFAP", "NfL"}
    con = EQ.puntuar(_hp("GFAP y NfL otra vez"), VALIDAS, FUENTES, [], dom)
    sin = EQ.puntuar(_hp("La barrera hematoencefálica en capilares"), VALIDAS, FUENTES, [], dom)
    assert any("marcadores que ya dominan" in m for m in con["motivos"]) and sin["puntos"] > con["puntos"]


def test_los_dominantes_son_los_de_mas_de_la_mitad_de_las_vivas():
    hs = [{"investigacionId": "inv", "estado": "propuesta", "titulo": f"GFAP sube {i}", "enunciado": ""} for i in range(3)] + [{"investigacionId": "inv", "estado": "propuesta", "titulo": "TREM2 microglía", "enunciado": ""}]
    assert EQ.dominantes(hs, "inv") == {"GFAP"}
    assert EQ.dominantes(hs[:2], "inv") == set(), "con pocas hipótesis no hay dominantes"
    assert EQ.dominantes(hs + [{"investigacionId": "otra", "estado": "propuesta", "titulo": "NfL", "enunciado": ""}] * 9, "inv") == {"GFAP"}


# -- Elegir: diversidad por construcción --------------------------------------------


def _e(titulo: str, enfoque: str, puntos: int, ronda: int = 1, respaldo: int = 2) -> dict[str, Any]:
    return EQ.entrada(_hp(titulo), enfoque, ronda, {"puntos": puntos, "nace": True, "motivos": ["ok"], "respaldo": respaldo})


def test_no_entran_dos_propuestas_que_dicen_lo_mismo():
    a = _e("La saturación de un canal limita la señal clínica en portadores", "analogia", 12)
    b = _e("La saturación de un canal limita la señal clínica en portadores", "contradiccion", 12)
    c = _e("Una explicación rival: la barrera hematoencefálica filtra el marcador", "mecanismo_opuesto", 8)
    elegidas = EQ.elegir([a, b, c])
    assert [x["enfoque"] for x in elegidas] == ["analogia", "mecanismo_opuesto"]


def test_no_entran_dos_del_mismo_enfoque_mientras_quede_otro():
    a = _e("Primera idea de analogía sobre canales", "analogia", 12)
    b = _e("Segunda idea de analogía sobre ecosistemas", "analogia", 11)
    c = _e("Una rival con peor puntuación sobre la microglía", "otra_escala", 6)
    assert [x["enfoque"] for x in EQ.elegir([a, b, c])] == ["analogia", "otra_escala"]
    # Si no queda otro enfoque útil, entran dos del mismo.
    assert len(EQ.elegir([a, b])) == 2


def test_nunca_entra_algo_sin_evidencia_ni_con_puntos_cero():
    assert EQ.elegir([_e("Sin evidencia", "analogia", 9, respaldo=0), _e("Cero puntos", "otra_escala", 0)]) == []


def test_a_igualdad_de_puntos_gana_la_segunda_ronda_que_ya_vio_el_tablon():
    uno = _e("Idea de la primera ronda sobre canales", "analogia", 10, ronda=1)
    dos = _e("Idea mejorada de la segunda ronda sobre ecosistemas", "contradiccion", 10, ronda=2)
    assert EQ.elegir([uno, dos], maximo=1)[0]["ronda"] == 2


def test_el_tope_de_entradas_no_cambia_la_cantidad_sino_la_calidad():
    assert EQ.MAX_QUE_ENTRAN == politicas.MAX_PROPUESTAS_POR_ITERACION == 2


def test_el_tablon_lleva_los_intentos_fallidos_con_su_motivo():
    mala = EQ.entrada(_hp("Una que falló"), "otra_escala", 1, {"puntos": 0, "nace": False, "motivos": ["no cita ninguna afirmación sostenida: no puede entrar"], "respaldo": 0})
    buena = _e("Una que puntuó bien sobre canales", "analogia", 12)
    texto = EQ.texto_tablon([mala, buena])
    assert texto.index("Una que puntuó bien") < texto.index("Una que falló"), "las mejores primero"
    assert "no cita ninguna afirmación sostenida" in texto, "lo que falló y por qué: es lo que más ayudó en Park y otros"
    assert EQ.texto_tablon([]) == "Vacío."


def test_los_enfoques_son_distintos_y_uno_es_la_analogia_entre_campos():
    assert len(set(EQ.MIEMBROS)) == len(EQ.MIEMBROS) >= 3
    assert "analogia" in EQ.ENFOQUES and "OTRO campo" in EQ.ENFOQUES["analogia"]
    assert "sostener la biología, no la analogía" in EQ.ENFOQUES["analogia"], "la analogía da ideas, no evidencia"


# -- El equipo dentro del paso -------------------------------------------------------


class CtxEquipo:
    """Lo mínimo de `Ctx` que usa `_equipo_de_hipotesis`: el estado, las fuentes y
    `llamar`, que aquí responde lo que diga cada test por enfoque y ronda."""

    def __init__(self, responder: Any):
        self.e = {"hipotesis": [], "criteriosRevision": [], "tareas": []}
        self.investigacion_id = "inv"
        self.numero = 1
        self.programas = SimpleNamespace(hipotesis="hipotesis")
        self.responder = responder
        self.vistas: list[tuple[str, dict[str, Any]]] = []

    def fuentes(self) -> dict[str, Any]:
        return FUENTES

    async def llamar(self, rol: str, programa: str, **kw: Any) -> Any:
        self.vistas.append((rol, kw))
        return self.responder(kw)


class PistaFalsa:
    def __init__(self) -> None:
        self.notas: list[str] = []
        self.actividades: list[tuple[str, str, str]] = []

    def actividad(self, agente: str, texto: str, estado: str) -> None:
        self.actividades.append((agente, texto, estado))

    def nota(self, texto: str) -> None:
        self.notas.append(texto)


def _correr(ctx: CtxEquipo) -> tuple[list[Any], PistaFalsa]:
    pista = PistaFalsa()
    inv = {"objetivo": "o", "configuracion": {}}
    salida = asyncio.run(PASOS._equipo_de_hipotesis(ctx, {"id": "p1", "titulo": "Hipótesis"}, pista, inv, "mundo", "afirmaciones", VALIDAS, "lecciones"))
    return salida, pista


@pytest.fixture(autouse=True)
def _sin_configuracion(monkeypatch):
    monkeypatch.setattr(PASOS.T, "configuracion", lambda inv: "")
    monkeypatch.setattr(PASOS.T, "hipotesis_existentes", lambda hs, inv: "")
    monkeypatch.setattr(PASOS.T, "vivero_texto", lambda inv: "")


def test_cada_miembro_llama_al_cerebro_con_su_enfoque_y_la_segunda_ronda_ve_el_tablon():
    def responder(kw: dict[str, Any]) -> Any:
        enfoque = kw["enfoque"].split(":")[0]
        return SimpleNamespace(hipotesis=[_hp(f"Idea del enfoque {enfoque} sobre {'canales' if enfoque == 'analogia' else enfoque}", afirmaciones=[1, 2])], tareas=[])

    ctx = CtxEquipo(responder)
    elegidas, pista = _correr(ctx)
    assert len(ctx.vistas) == len(EQ.MIEMBROS) * EQ.RONDAS
    assert {rol for rol, _ in ctx.vistas} == {"cerebro"}, "Sonnet no genera hipótesis (TRASPASO 7.4)"
    assert {kw["enfoque"].split(":")[0] for _, kw in ctx.vistas} == set(EQ.MIEMBROS)
    primera, segunda = ctx.vistas[: len(EQ.MIEMBROS)], ctx.vistas[len(EQ.MIEMBROS):]
    assert all(kw["tablon"] == "Vacío." for _, kw in primera)
    assert all("puntos" in kw["tablon"] and "Marcador:" in kw["tablon"] for _, kw in segunda), "la segunda ronda lee el tablón con la puntuación"
    assert 1 <= len(elegidas) <= EQ.MAX_QUE_ENTRAN
    assert any("Equipo de" in n for n in pista.notas) and any("Entra por el enfoque" in n for n in pista.notas)


def test_un_miembro_que_falla_no_tumba_al_equipo_y_se_dice():
    def responder(kw: dict[str, Any]) -> Any:
        if kw["enfoque"].startswith("contradiccion"):
            raise RuntimeError("respuesta rota")
        return SimpleNamespace(hipotesis=[_hp(f"Idea de {kw['enfoque'][:12]} sobre la barrera {len(kw['tablon'])}", afirmaciones=[1, 2])], tareas=[])

    elegidas, pista = _correr(CtxEquipo(responder))
    assert elegidas, "los demás miembros siguen"
    assert any("«contradiccion» del equipo no respondió" in n for n in pista.notas)


def test_un_modelo_caido_o_sin_presupuesto_corta_el_paso_entero_no_se_traga():
    from rosa import vigilante_modelos as VIG

    for excepcion in (VIG.ModeloSinRespuesta("cerebro", "openai/gpt-6-astra", 3, 1000), PASOS.PresupuestoAgotado("sin tope")):
        def responder(kw: dict[str, Any], ex: BaseException = excepcion) -> Any:
            raise ex

        with pytest.raises(type(excepcion)):
            _correr(CtxEquipo(responder))


def test_sin_ninguna_propuesta_util_no_entra_nada():
    def responder(kw: dict[str, Any]) -> Any:
        return SimpleNamespace(hipotesis=[_hp("Sin evidencia", afirmaciones=[])], tareas=[])

    elegidas, pista = _correr(CtxEquipo(responder))
    assert elegidas == [] and any("entran 0" in n for n in pista.notas)


# -- El reparto de evidencia: el fallo que tapaba todo lo demás ----------------------


def test_cada_miembro_ve_un_trozo_distinto_con_lo_mas_reciente_y_muchas_fuentes():
    """Medido el 27 de septiembre de 2026: el generador veía las 54 primeras de 1.149
    afirmaciones sostenidas, todas de la primera iteración y de 4 fuentes. Las 712
    de las iteraciones 2 y 3 no las vio nunca ningún generador."""
    validas = [{"texto": f"afirmación {i} " + "x" * 200, "cita": "c", "iteracion": 1 + i // 100, "fuenteId": f"f{i % 30}"} for i in range(300)]
    repartos = EQ.reparto_de_evidencia(validas, 4, maximo=6000)
    vistas = [i for r in repartos for i in r]
    assert len(vistas) == len(set(vistas)), "ningún miembro repite la evidencia de otro"
    assert len(vistas) > 4 * 20, "entre todos ven mucho más que el trozo de antes"
    for r in repartos:
        assert r, "todos los miembros reciben algo"
        assert any(validas[i]["iteracion"] == 3 for i in r), "cada miembro ve evidencia de la última iteración"
        assert len({validas[i]["fuenteId"] for i in r}) >= min(len(r), 10), "una fuente distinta por afirmación antes de repetir"


def test_la_numeracion_es_la_global_para_que_los_indices_se_resuelvan_igual():
    validas = [{"texto": f"a{i}", "cita": "c", "veredicto": "sostenida", "tipo": "dato", "iteracion": 1, "fuenteId": f"f{i}"} for i in range(10)]
    texto = EQ.texto_de_indices(validas, [7, 2])
    assert texto.startswith("3. ") and "\n8. " in texto, "la afirmación 8 de la lista global es la 8 que cita el miembro"
    assert EQ.texto_de_indices(validas, []) == "Ninguna afirmación sostenida todavía."


def test_el_mandato_pide_proponer_y_no_filtrar_por_la_regla_de_las_dos_cohortes():
    """Con la instrucción del generador único ("devolver la lista vacía es una
    respuesta válida y frecuente"), los ocho miembros devolvieron cero propuestas con
    GPT-6 Astra: se autocensuraban por la regla de las dos cohortes, que aplica una
    regla después."""
    assert "PROPONER, no filtrar" in EQ.MANDATO and "irá al vivero" in EQ.MANDATO
    assert "no puedes hacer es inventar" in EQ.MANDATO and "cita afirmaciones sostenidas" in EQ.MANDATO


def test_el_laboratorio_recibe_inicio_y_fin_de_cada_miembro():
    _, pista = _correr(CtxEquipo(lambda _kw: SimpleNamespace(hipotesis=[], tareas=[])))
    for enfoque in EQ.MIEMBROS:
        estados = [estado for agente, _texto, estado in pista.actividades if agente == enfoque]
        assert estados == ["en_curso", "terminado"] * EQ.RONDAS


def test_el_laboratorio_no_deja_trabajando_al_miembro_que_fallo():
    def responder(kw):
        if kw["enfoque"].startswith("analogia:"):
            raise RuntimeError("Modelo de prueba sin respuesta")
        return SimpleNamespace(hipotesis=[], tareas=[])

    _, pista = _correr(CtxEquipo(responder))
    estados = [estado for agente, _texto, estado in pista.actividades if agente == "analogia"]
    assert estados == ["en_curso", "fallido"] * EQ.RONDAS
