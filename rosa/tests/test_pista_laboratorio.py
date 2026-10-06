"""La actividad de los personajes debe quedar en la misma transcripción pública."""
from typing import Any

import pytest

from rosa.bucle.pista import Pista


class Memoria:
    def __init__(self):
        self.estado = {"iteraciones": [{"id": "it", "pistas": []}]}

    def mutar(self, fn, _nombre):
        return fn(self.estado)


def test_la_actividad_se_persiste_antes_de_esperar_al_modelo():
    almacen: Any = Memoria()
    pista = Pista(almacen, "it", "paso", "modelo", "Equipo", "cerebro")
    pista.actividad("analogia", "Generando propuestas", "en_curso")
    pista.actividad("contradiccion", "Generando propuestas", "en_curso")
    pista.actividad("analogia", "Ronda terminada", "terminado")
    registros = almacen.estado["iteraciones"][0]["pistas"][0]["transcripcion"]
    assert [(r["agente"], r["estadoAgente"]) for r in registros] == [
        ("analogia", "en_curso"), ("contradiccion", "en_curso"), ("analogia", "terminado")
    ]
    assert registros[0]["tipo"] == "accion"
    assert registros[2]["tipo"] == "resultado"
    pista.actividad("contradiccion", "El modelo no respondió", "fallido")
    assert registros[-1]["tipo"] == "error"


def test_el_historico_sin_agente_conserva_su_contrato():
    almacen: Any = Memoria()
    pista = Pista(almacen, "it", "paso", "literatura", "Buscar", "PubMed")
    pista.accion("Consulta", {"base": "PubMed"})
    pista.cerrar("Búsqueda terminada")
    entrada = almacen.estado["iteraciones"][0]["pistas"][0]["transcripcion"][0]
    assert set(entrada) == {"t", "tipo", "texto", "consulta"}
    with pytest.raises(ValueError, match="no admitido"):
        pista.actividad("analogia", "Estado inventado", "inexistente")


@pytest.mark.parametrize("falla", [False, True])
def test_atribuir_la_tarea_no_cambia_el_resultado_ni_oculta_el_error(falla):
    import asyncio
    from rosa.bucle.pasos import _actividad_registrada

    almacen: Any = Memoria()
    pista = Pista(almacen, "it", "paso", "modelo", "Revisión", "juez")
    salida = object()

    async def correr():
        liberar = asyncio.Event()

        async def trabajo():
            await liberar.wait()
            if falla:
                raise RuntimeError("Fallo comprobable de prueba")
            return salida

        tarea = asyncio.create_task(_actividad_registrada(pista, "killer", "Revisar la hipótesis", trabajo()))
        await asyncio.sleep(0)
        registros = almacen.estado["iteraciones"][0]["pistas"][0]["transcripcion"]
        assert registros[-1]["estadoAgente"] == "en_curso"
        liberar.set()
        if falla:
            with pytest.raises(RuntimeError, match="comprobable"):
                await tarea
            assert registros[-1]["estadoAgente"] == "fallido"
        else:
            assert await tarea is salida
            assert registros[-1]["estadoAgente"] == "terminado"

    asyncio.run(correr())
