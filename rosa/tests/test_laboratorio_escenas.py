"""Escenas, nombres y saludos del laboratorio (8 de octubre de 2026).

Emir: «¿por qué los personajes se saludan tanto? Necesito conversaciones con
sentido humano». En 1.042 intervenciones guardadas ninguna llamaba a nadie por
su nombre, el 28 % de las respuestas empezaba por «Hola» y hasta ocho salas
comentaban a la vez la misma frase. Lo que se defiende aquí: cada personaje
sabe quién es y con quién habla, cada sala habla de lo suyo, solo saluda quien
no ha dicho nada hoy, y abrir con «me interesa» se rehace.
"""

from __future__ import annotations

import copy
import re
import time
from pathlib import Path

import pytest

from rosa.estado.almacen import Almacen
from rosa.laboratorio_conversaciones import (
    ARCOS, COMPANEROS, ESTILO, PRETEXTOS, REGLAS_JUEZ, Conversaciones, escena_de, oficina_de, sin_saludo, tema_de,
    validar_humanidad,
)
from rosa.laboratorio_personalidades import NOMBRES, ficha_de

CLAVE = ("c", "it", "es")


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / "escenas.db")

    def preparar(e):
        e.update(
            autonomia={**e.get("autonomia", {}), "gastar_grande": "preguntar"},
            investigaciones=[{"id": "inv", "titulo": "MAPT", "mision": {"objetivo": "Estudiar MAPT"}}],
            corridas=[{"id": "c", "investigacionId": "inv", "estado": "en_marcha", "iteracionActual": 1,
                       "empezadaEn": 1_790_000_000_000 - 95 * 60_000, "terminadaEn": None,
                       "presupuesto": {"limiteLlamadas": 500}, "gasto": {"llamadas": 40},
                       "_afirmaciones": [{"id": "a", "iteracion": 1, "texto": "MAPT se asoció con tau en ratones",
                                          "fragmento": "Association in mice", "cita": "PMID:123, p. 4", "veredicto": "parcial"}]}],
            iteraciones=[{"id": "it", "corridaId": "c", "numero": 1, "terminadaEn": None, "planAprobado": True,
                          "presupuesto": {"limite": 400, "usado": 0, "reservaCierre": 20},
                          "pistas": [
                              {"id": "pi-mu000001-v", "tipo": "verificacion", "titulo": "Verificar evidencia", "estado": "en_curso",
                               "transcripcion": [{"t": 1200, "tipo": "resultado", "texto": "La asociación de MAPT con tau en ratones queda parcial."}]},
                              {"id": "pi-mu000002-l", "tipo": "literatura", "titulo": "Buscar literatura", "estado": "hecha",
                               "transcripcion": [{"t": 100, "tipo": "error", "texto": "Error: Europe PMC no respondió a tiempo; la consulta queda sin comprobar."}]},
                          ]}],
            hipotesis=[{"id": "h1", "investigacionId": "inv", "titulo": "Corte anclado a farmacodinámica", "estado": "en_revision"}],
            decisiones=[{"id": "d1", "iteracionId": "it", "hipotesisId": "h1", "decision": "descartar_en_contexto",
                         "motivo": "Agotó las dos reformulaciones y sigue fallando la factibilidad.", "queHariaFalta": "Datos individuales por visita."}],
            hechos=[],
        )
        return True

    al.mutar(preparar, "preparar_prueba")
    yield al
    al.cerrar()


@pytest.fixture
def reloj(monkeypatch):
    ahora = [1_790_000_000_000]
    monkeypatch.setattr("rosa.laboratorio_conversaciones.P.ahora_ms", lambda: ahora[0])
    return ahora


def habilitar(s, clave=CLAVE):
    s.visitas[clave] = {"persona": time.monotonic() + 60}


def test_los_nombres_son_los_del_dibujo():
    motor = (Path(__file__).resolve().parents[2] / "frontend/src/componentes/labvivo/motor.ts").read_text()
    bloque = re.search(r"const NOMBRE_PROPIO[^=]*= \{(.*?)\};", motor, re.S).group(1)
    dibujo = {(a or b): v for a, b, v in re.findall(r"(?:'([^']+)'|([A-Za-zÁÉÍÓÚáéíóúñÑ]+))\s*:\s*'([^']+)'", bloque)}
    for rol in {p for grupo in COMPANEROS.values() for p in grupo}:
        assert NOMBRES[rol] == dibujo[rol], rol
    assert len(set(NOMBRES.values())) == len(NOMBRES)


def test_cada_ficha_tiene_lo_que_hace_falta_para_interpretar_y_no_trae_frases_hechas():
    for rol in {p for grupo in COMPANEROS.values() for p in grupo}:
        f = ficha_de(rol)
        assert all(f[k] for k in ("nombre", "puesto", "voz", "manias", "relaciones")), rol
        # Una frase entre comillas en la voz acaba repetida en cada charla.
        assert "«" not in f["voz"], rol


def test_cada_sala_tiene_su_escena_por_lo_que_de_verdad_hay(almacen, reloj):
    e = almacen.estado
    c, it = e["corridas"][0], e["iteraciones"][0]
    tema = tema_de(e, "c", "it")
    # Lectura tiene un error real: atasco, con el error como material.
    escena, mats = escena_de(e, c, it, "lectura", tema, 0)
    assert escena["tipo"] == "atasco" and "no respondió" in mats[0]["texto"]
    # Juicio tiene una decisión con perdedor: pique, con el motivo real.
    escena, mats = escena_de(e, c, it, "revision", tema, 0)
    assert escena["tipo"] == "pique" and "factibilidad" in mats[0]["motivo"]
    # Una sala parada comenta lo que hace otra (y dice quién) mientras no haya dos.
    escena, mats = escena_de(e, c, it, "analisis", tema, 0)
    assert escena["tipo"] == "cotilleo" and escena["de"]["nombre"] == NOMBRES[tema["autor"]]
    escena, mats = escena_de(e, c, it, "analisis", tema, 2)
    assert escena["tipo"] == "pausa" and escena["pretexto"] in PRETEXTOS
    assert [m["clase"] for m in mats] == ["oficina"]
    for k in ("trabajo", "atasco", "pique", "cotilleo", "pausa", "arranque", "plan"):
        assert ARCOS[k]


def test_la_oficina_es_la_del_estado_y_una_corrida_terminada_no_sigue_contando(almacen, reloj):
    e = almacen.estado
    c, it = e["corridas"][0], e["iteraciones"][0]
    o = oficina_de(e, c, it)
    assert o["laCorridaLleva"] == "1 h 35 min" and o["llamadasGastadas"] == "40 de 500"
    assert o["afirmacionesExtraidas"] == 1 and o["afirmacionesJuzgadas"] == 1
    assert re.fullmatch(r"\d\d:\d\d", o["hora"]) and o["texto"].startswith("Son las ")
    terminada = {**c, "terminadaEn": c["empezadaEn"] + 20 * 60_000}
    reloj[0] += 10 * 3_600_000
    assert oficina_de(e, terminada, it)["laCorridaLleva"] == "20 min"


@pytest.mark.parametrize("texto,saluda", [("Hola. Oye, Elena", True), ("Buenas, Marta", True), ("¡Hola, Rocío!", True),
                                          ("Holanda tiene un estudio", False), ("Hey, mira esto", True)])
def test_el_saludo_se_reconoce_y_se_quita_de_la_memoria(texto, saluda):
    with pytest.raises(ValueError) if saluda else _sin_error():
        validar_humanidad({"texto": texto}, {"puedesSaludar": False, "papel": "respondes"})
    assert (sin_saludo(texto) != texto) is saluda


def test_abrir_con_una_declaracion_de_interes_se_rehace_y_responder_con_ella_no():
    with pytest.raises(ValueError, match="declaración de interés"):
        validar_humanidad({"texto": "Me llama la atención que bajara la hs-CRP."}, {"puedesSaludar": False, "papel": "abres"})
    validar_humanidad({"texto": "Me interesa lo que dices, Freya."}, {"puedesSaludar": False, "papel": "respondes"})


class _sin_error:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_solo_saluda_quien_no_ha_hablado_hoy_y_el_que_ya_hablo_se_corrige(almacen, reloj):
    """El modelo de prueba saluda siempre. Al primero se le deja (no ha dicho
    nada hoy); al que ya habló en otra charla, el saludo se le rehace."""
    vistos = []

    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            return {"admisible": True}
        vistos.append(copy.deepcopy(contenido))
        texto = "Vale, sigo con lo mío." if contenido.get("revisionEstilo") else "Hola, ¿cómo vamos?"
        return {"texto": texto, "referencias": [tema["materiales"][0]["id"]]}

    s = Conversaciones(almacen, llamar)
    habilitar(s)
    tema = {**tema_de(almacen.estado, "c", "it"), "tipoConversacion": "actividad"}
    try:
        await s._conversar(CLAVE, tema)
        textos = [t["texto"] for t in s.leer(CLAVE)]
        # Abre saludando quien no había hablado; quien responde también podía
        # devolver el saludo (tampoco había hablado). El tercero ya habló: no.
        assert textos[0] == "Hola, ¿cómo vamos?"
        assert textos[2] == "Vale, sigo con lo mío."
        assert [v["puedesSaludar"] for v in vistos if not v.get("revisionEstilo")][:3] == [True, True, False]
        # Cada turno sabe quién es quién, por su nombre.
        assert vistos[0]["yo"]["nombre"] == NOMBRES[vistos[0]["agente"]]
        assert vistos[0]["companero"]["nombre"] == NOMBRES[vistos[0]["destinatario"]]
        assert vistos[0]["papel"] == "abres" and vistos[-1]["papel"] == "cierras"
        # Otra charla más tarde con el mismo que abrió: ya no puede saludar.
        vistos.clear()
        tema2 = {**tema, "huella": "otra-charla", "origen": "otra"}
        await s._conversar(CLAVE, tema2)
        assert all(not v["puedesSaludar"] for v in vistos)
        assert not any(re.match(r"hola", t["texto"], re.I) for t in s.leer(CLAVE) if t["temaId"] == "otra-charla")
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_como_mucho_dos_salas_cotillean_del_mismo_momento_aunque_las_rondas_vayan_seguidas(almacen, reloj):
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            return {"admisible": True}
        return {"texto": "Vale.", "referencias": [tema["materiales"][0]["id"]]}

    s = Conversaciones(almacen, llamar)
    habilitar(s)
    tema = tema_de(almacen.estado, "c", "it")
    try:
        for _ in range(12):
            temas = s._temas(CLAVE, tema)
            if not temas:
                break
            for t in temas:
                s.intentos.setdefault(CLAVE, {})[t["huella"]] = 1
            await s._ronda(CLAVE, temas)
        escenas = {}
        for t in s.leer(CLAVE):
            if t.get("tipoConversacion") == "companeros":
                escenas[t["salaConversacion"]] = t["escena"]
        assert list(escenas.values()).count("cotilleo") <= 2
        assert escenas["lectura"] == "atasco" and escenas["revision"] == "pique"
        assert "pausa" in escenas.values()
        assert all(t["estilo"] == ESTILO for t in s.leer(CLAVE))
    finally:
        await s.cerrar()


def test_la_memoria_que_ve_el_modelo_no_trae_los_saludos(almacen):
    def guardar(e):
        e["corridas"][0]["_conversacionesLaboratorio"] = [{
            "id": f"t{i}", "iteracionId": "it", "idioma": "es", "estilo": ESTILO, "temaId": "x", "hallazgoId": "x",
            "agente": "Juez", "destinatario": "Señalizador de sesgo", "texto": "Hola. La cola va por treinta.",
            "turno": 1, "fecha": i, "modelo": "m", "materiales": []} for i in range(3)]
        return True

    almacen.mutar(guardar, "memoria_con_saludos")
    s = Conversaciones(almacen, None)
    memoria = s._recuerdos(CLAVE, "Juez")
    assert memoria["memoriaDeVoz"] and all(m["texto"] == "La cola va por treinta." for m in memoria["memoriaDeVoz"])
