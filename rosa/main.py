"""Arranque de ROSA2018: servidor HTTP, supervisor del bucle y trazas MLflow en
un solo proceso.

    uv run python -m rosa.main

Abre http://127.0.0.1:8765 si el frontend esta compilado (frontend/dist), o
usa el servidor de Vite en el 5174, que reenvia /api aqui.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import sys
from typing import Any

import dspy
import uvicorn

from rosa import config
from rosa.acceso import diagnostico_credenciales
from rosa.bucle.corrida import Supervisor
from rosa.estado.almacen import Almacen, AlmacenOcupado
from rosa.gateway import modelos as cargar_modelos
from rosa.modulos.contador import Contador
from rosa.modulos.firmas import Programas
from rosa.servidor import crear_app

# Cuánto espera una ROSA2018 nueva a que la anterior suelte rosa.db (S-01): más que
# la llamada al Killer más lenta vista (113 s), con margen para dos seguidas.
ESPERA_CERROJO_S = 600.0
# Cuánto se deja al supervisor terminar el paso en vuelo al apagar antes de
# cortarlo: lo que va en vuelo (una revisión del Killer ya pagada) vale más que
# apagar rápido, pero no puede colgar el cierre para siempre.
TOPE_APAGADO_S = 300.0


def configurar_mlflow() -> None:
    """MLflow registra las optimizaciones, no cada llamada (28 de septiembre de
    2026). Cada compilación de GEPA queda como corrida con sus evaluaciones, que
    es lo que GUIA-ROSA 5.3 pedía de MLflow y que hasta hoy no se registraba
    (`log_compiles` estaba en su valor por defecto, apagado).

    Las trazas de cada llamada ya no van a `mlflow.db`: el conjunto de
    entrenamiento del futuro (TRASPASO 7) lo guarda desde el 16 de septiembre
    `datos/_gepa/<base>/trazas.db`, con los prompts, las respuestas y las
    herramientas, con claves y correos redactados y permisos privados, y es de
    ahí de donde GEPA saca sus casos. `mlflow.db` era una segunda copia sin
    redactar que nadie leía: 740 MB en 18 días, 668 de ellos en spans, y 3
    evaluaciones registradas en total. Para depurar un programa concreto se
    pueden volver a encender con ROSA_MLFLOW_TRAZAS=1 (config.MLFLOW_TRAZAS)."""
    try:
        import mlflow

        mlflow.set_tracking_uri(config.MLFLOW_URI)
        mlflow.set_experiment("rosa")
        trazas = config.MLFLOW_TRAZAS
        mlflow.dspy.autolog(log_traces=trazas, log_traces_from_eval=trazas, log_traces_from_compile=False, log_compiles=True, log_evals=True, silent=True)
    except Exception as ex:  # noqa: BLE001
        print(f"MLflow no disponible ({ex}); ROSA2018 sigue sin registrar las optimizaciones en MLflow (las trazas de entrenamiento van aparte, a datos/_gepa).", file=sys.stderr)


async def correr_con_tope(servidor: Any, supervisor: Any, tope_s: float = TOPE_APAGADO_S, *, cierre_pedido: asyncio.Event | None = None) -> None:
    """Corre el servidor HTTP y el supervisor del bucle a la vez. Cuando llega
    la señal de cierre o uno de los dos termina, se pide parar y se deja terminar
    lo que tenga en vuelo hasta `tope_s` segundos; pasado el tope se cancela. Así el Killer que
    está a medias escribe su decisión (que ya se pagó) antes de que este proceso
    suelte la base, y una ROSA2018 nueva la encuentra en vez de repetirla (S-01)."""
    t_servidor = asyncio.ensure_future(servidor.serve())
    t_supervisor = asyncio.ensure_future(supervisor.correr())
    trabajos = {t_servidor, t_supervisor}
    t_cierre = asyncio.ensure_future(cierre_pedido.wait()) if cierre_pedido is not None else None
    try:
        hechas, _ = await asyncio.wait(trabajos | ({t_cierre} if t_cierre is not None else set()), return_when=asyncio.FIRST_COMPLETED)
    finally:
        if t_cierre is not None and not t_cierre.done():
            t_cierre.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t_cierre
    pendientes = {t for t in trabajos if not t.done()}
    for t in hechas:
        # Una tarea cancelada no tiene excepción que leer (`exception()` lanzaría).
        if t is t_supervisor and not t.cancelled() and t.exception() is not None:
            print(f"El supervisor del bucle terminó con error: {t.exception()!r}; se apaga el servidor", file=sys.stderr, flush=True)
    supervisor.parar()
    servidor.should_exit = True
    if pendientes:
        try:
            await asyncio.wait_for(asyncio.gather(*pendientes, return_exceptions=True), timeout=tope_s)
        except asyncio.TimeoutError:
            print(f"El paso en vuelo no terminó en {int(tope_s)} s; se cancela y se cierra sin él (quedará como interrumpido al reiniciar).", file=sys.stderr, flush=True)
            for t in pendientes:
                t.cancel()
            await asyncio.gather(*pendientes, return_exceptions=True)
    for t in hechas:
        # Un fallo del servidor se relanza para que quede en el registro del arranque.
        if t is t_servidor and not t.cancelled() and t.exception() is not None:
            raise t.exception()


async def principal() -> None:
    if config.HOST not in ("127.0.0.1", "localhost", "::1") and not config.ROSA_TOKEN:
        print(f"ROSA2018 no arranca escuchando en {config.HOST} sin ROSA_TOKEN en .env: es la llave de red que toda la API exige (con o sin sesión, también en las rutas de acceso); sin ella cualquier equipo de la red podría gastar en el gateway y alterar el estado.", file=sys.stderr)
        raise SystemExit(2)
    try:
        # El cerrojo se toma aquí, antes de cargar modelos y antes de que el
        # supervisor toque nada: si otra ROSA2018 sigue cerrando, esta espera y, si no
        # suelta, no arranca sobre la misma base.
        almacen = Almacen(espera_cerrojo=ESPERA_CERROJO_S)
    except AlmacenOcupado as ex:
        print(f"ROSA2018 no arranca: {ex}", file=sys.stderr)
        raise SystemExit(3) from None
    problema_acceso = diagnostico_credenciales()
    if problema_acceso:
        print(f"Aviso: el acceso con contraseña no está configurado y nadie podrá entrar en ROSA2018 hasta corregir .env: {problema_acceso}.", file=sys.stderr)
    if not (getattr(config, "ROSA_ADMIN", None) or os.environ.get("ROSA_ADMIN")):
        print("Aviso: sin ROSA_ADMIN en .env administra la cuenta de ROSA_LOGIN_EMAIL, la única que puede entrar; las cuentas heredadas de la puerta antigua no administran.", file=sys.stderr)
    modelos = cargar_modelos()
    programas = Programas()
    cargados = programas.cargar_optimizados(config.RAIZ / "mlruns" / "optimizados")
    if cargados:
        print(f"Programas optimizados por GEPA cargados: {', '.join(cargados)}")
    contador = Contador(almacen)
    from rosa.gepa_continuo import Servicio
    from rosa.conectores import base as conectores_base
    try:
        gepa = Servicio(almacen, programas, modelos)
        almacen.gepa_servicio = gepa
        conectores_base.OBSERVADOR = gepa.observar_conector
        dspy.configure(lm=modelos.cerebro, callbacks=[contador, gepa.trazador])
    except Exception as ex:  # noqa: BLE001  ROSA2018 arranca aunque el servicio de optimización no pueda
        gepa = None
        print(f"GEPA continuo no arranca ({type(ex).__name__}: {str(ex)[:120]}); ROSA2018 sigue sin optimización automática", file=sys.stderr)
        dspy.configure(lm=modelos.cerebro, callbacks=[contador])
    configurar_mlflow()

    app = crear_app(almacen)
    servidor = uvicorn.Server(uvicorn.Config(app, host=config.HOST, port=config.PUERTO, log_level="warning", loop="asyncio"))
    supervisor = Supervisor(almacen, programas, modelos)
    # El servidor necesita los programas y los modelos para lo que una persona
    # pide a mano y gasta modelo (reverificar citas): mismo camino que el bucle.
    app.state.supervisor = supervisor

    bucle = asyncio.get_running_loop()
    almacen.enganchar_bucle(bucle)
    # Espejo del estado en Convex, si hay clave en .env. Solo lectura remota;
    # SQLite sigue siendo la fuente de verdad.
    from rosa.espejo_convex import Espejo

    espejo = Espejo(almacen)
    app.state.espejo = espejo
    espejo.arrancar()
    if espejo.estado["activo"]:
        print(f"Espejo en Convex activo: {config.CONVEX_URL}")

    cierre_pedido = asyncio.Event()

    def parar(*_: object) -> None:
        print(f"ROSA2018 está cerrando: deja terminar el paso en curso (hasta {int(TOPE_APAGADO_S)} s) y suelta la base al salir. No arranques otra ROSA2018 hasta que este proceso termine.", file=sys.stderr, flush=True)
        supervisor.parar()
        servidor.should_exit = True
        cierre_pedido.set()

    for s in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            bucle.add_signal_handler(s, parar)

    def parar_por_obsoleto() -> None:
        # Otro proceso escribió sobre rosa.db (S-01): este ya no puede guardar nada,
        # así que se cierra igual que con Ctrl+C en vez de seguir pagando llamadas
        # al modelo cuyo resultado no se puede escribir. El almacén lo avisa desde
        # el hilo que detectó el fallo (puede ser uno de DSPy): se salta al bucle.
        print("Otra ROSA2018 escribió sobre la base: este proceso queda obsoleto y se cierra. Deja una sola ROSA2018 arrancada.", file=sys.stderr, flush=True)
        parar()

    almacen.al_quedar_obsoleto(lambda: bucle.call_soon_threadsafe(parar_por_obsoleto))

    print(f"ROSA2018 en http://{config.HOST}:{config.PUERTO}  (base {config.RUTA_BD.name}, versión {almacen.version})")
    tarea_gepa = asyncio.create_task(gepa.correr(), name="gepa-continuo") if gepa else None
    try:
        await correr_con_tope(servidor, supervisor, cierre_pedido=cierre_pedido)
    finally:
        if gepa and tarea_gepa:
            gepa.parar.set()
            try:
                # Un compile de GEPA en marcha no se puede cortar desde fuera; el apagado no se queda colgado esperándolo.
                await asyncio.wait_for(tarea_gepa, timeout=15)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                print("GEPA continuo no terminó en 15 s; se apaga sin esperarlo (el ciclo en curso queda auditado como interrumpido)", file=sys.stderr)
        conectores_base.OBSERVADOR = None
        if gepa:
            gepa.registro.cerrar()
    # Apagado ordenado: primero las tareas del bucle y el espejo, despues SQLite.
    await espejo.parar()
    almacen.cerrar()


if __name__ == "__main__":
    asyncio.run(principal())
