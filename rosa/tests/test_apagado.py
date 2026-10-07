"""El plazo de cierre empieza con la señal, sin servidor, modelos ni base real."""

from __future__ import annotations

import asyncio
import time

import pytest

from rosa.main import correr_con_tope


class Trabajo:
    def __init__(self, *, tarda: float = 0, ignora_cierre: bool = False, fallo: str | None = None, termina_solo: bool = False):
        self.should_exit = False
        self.parado = asyncio.Event()
        self.iniciado = asyncio.Event()
        self.terminado = False
        self.cancelado = False
        self.tarda = tarda
        self.ignora_cierre = ignora_cierre
        self.fallo = fallo
        self.termina_solo = termina_solo

    def parar(self):
        self.parado.set()

    async def _correr(self, servidor: bool):
        self.iniciado.set()
        try:
            if self.fallo:
                raise RuntimeError(self.fallo)
            if not self.termina_solo:
                if self.ignora_cierre:
                    await asyncio.Event().wait()
                elif servidor:
                    while not self.should_exit:
                        await asyncio.sleep(0.001)
                else:
                    await self.parado.wait()
            await asyncio.sleep(self.tarda)
            self.terminado = True
        except asyncio.CancelledError:
            self.cancelado = True
            raise

    async def serve(self):
        await self._correr(True)

    async def correr(self):
        await self._correr(False)


@pytest.mark.asyncio
async def test_senal_activa_tope_aunque_ningun_trabajo_haya_terminado(capsys):
    servidor = Trabajo(ignora_cierre=True)
    supervisor = Trabajo(ignora_cierre=True)
    cierre = asyncio.Event()
    tarea = asyncio.create_task(correr_con_tope(servidor, supervisor, tope_s=0.06, cierre_pedido=cierre))
    await servidor.iniciado.wait()
    await supervisor.iniciado.wait()
    # No hay un temporizador de 60 ms mientras la corrida trabaja normalmente.
    await asyncio.sleep(0.08)
    assert not tarea.done() and not servidor.cancelado and not supervisor.cancelado
    inicio_cierre = time.monotonic()
    cierre.set()
    await asyncio.wait_for(tarea, timeout=1)
    assert time.monotonic() - inicio_cierre >= 0.05
    assert servidor.cancelado and supervisor.cancelado
    assert not servidor.terminado and not supervisor.terminado
    assert "se cancela y se cierra sin él" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_senal_deja_terminar_llamada_sana_antes_del_tope():
    servidor = Trabajo(tarda=0.02)
    supervisor = Trabajo(tarda=0.04)
    cierre = asyncio.Event()
    tarea = asyncio.create_task(correr_con_tope(servidor, supervisor, tope_s=0.3, cierre_pedido=cierre))
    await supervisor.iniciado.wait()
    cierre.set()
    await asyncio.wait_for(tarea, timeout=1)
    assert servidor.should_exit and supervisor.parado.is_set()
    assert servidor.terminado and supervisor.terminado
    assert not servidor.cancelado and not supervisor.cancelado


@pytest.mark.asyncio
async def test_fin_natural_sin_senal_cierra_el_otro_y_limpia_su_espera():
    servidor = Trabajo(termina_solo=True)
    supervisor = Trabajo(tarda=0.01)
    cierre = asyncio.Event()
    antes = asyncio.all_tasks()
    await correr_con_tope(servidor, supervisor, tope_s=0.3, cierre_pedido=cierre)
    assert servidor.terminado and supervisor.terminado
    assert not cierre.is_set()
    assert not (asyncio.all_tasks() - antes)


@pytest.mark.asyncio
@pytest.mark.parametrize("autor", ["servidor", "supervisor"])
async def test_fallo_propio_conserva_el_camino_de_apagado(autor, capsys):
    servidor = Trabajo(fallo="Fallo del servidor" if autor == "servidor" else None)
    supervisor = Trabajo(fallo="Fallo del supervisor" if autor == "supervisor" else None)
    if autor == "servidor":
        with pytest.raises(RuntimeError, match="Fallo del servidor"):
            await correr_con_tope(servidor, supervisor, tope_s=0.3, cierre_pedido=asyncio.Event())
        assert supervisor.terminado
    else:
        await correr_con_tope(servidor, supervisor, tope_s=0.3, cierre_pedido=asyncio.Event())
        assert servidor.terminado
        assert "El supervisor del bucle terminó con error" in capsys.readouterr().err
    assert servidor.should_exit and supervisor.parado.is_set()
