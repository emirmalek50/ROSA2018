"""El supervisor y el bucle de cada corrida.

`Supervisor.correr()` es una tarea que vive mientras el servidor:
- Cada dos segundos mira el estado. Para cada corrida viva sin tarea, lanza
  `correr_corrida`. Autoaprueba planes si la corrida lo pide. Atiende lo que
  la investigadora dejó marcado: hipótesis "no puedo juzgar" (las aclara),
  comentarios enviados (los responde), revisiones pedidas, retractaciones a
  recomprobar, replicaciones en curso.
- Al arrancar, lo que quedó a medias por un reinicio se marca (pistas
  fallidas con motivo) y la iteración retoma en el primer paso pendiente.

`correr_corrida` es el bucle de una corrida:
  sin iteración o iteración cerrada -> proponer plan -> esperando_plan
  plan aprobado -> ejecutar pasos en orden (cada paso, sus pistas)
  sin pasos -> cerrar iteración (resumen, informe, evento, condición de parada)
Se detiene cuando la corrida pasa a detenida o terminada. Pausada, pausada
por presupuesto o esperando aprobación: espera sin gastar. Esperando modelo
(el cerebro o el juez no responden): la tarea termina limpia y el supervisor
sondea el gateway desde el tic hasta que el modelo vuelve; entonces la relanza.
Si la persona la pausó mientras el modelo caía, la pausa manda: el paso queda
pendiente y se reintenta al reanudar. El tic nunca espera trabajo largo: las
peticiones de la persona, la vigilancia de literatura y el índice corren como
tareas de fondo con tope.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import contextlib
from datetime import datetime, timezone
from pathlib import Path
import re
import traceback
from typing import Any, Awaitable, Callable

from rosa import argumentacion as ARG
from rosa import aso as ASO
from rosa import criba as CRIBA
from rosa import especie as ESPECIE
from rosa import plegado as PLEGADO
from rosa import comprobaciones as COMP
from rosa import cuestiones as CU
from rosa import laboratorio as LAB
from rosa import metodo as METODO
from rosa import dependencias as DEP
from rosa import sesgo as SESGO
from rosa import certeza as CERTEZA, config, lecciones as LEC, parada as PARADA, politicas, priorizacion as PR, progreso as PROG, torneo
from rosa import revisor_registro as RR
from rosa import tareas as TA
from rosa import viabilidad as VIA
from rosa import killer as KILLER
# ROSA2018, 16 de septiembre de 2026: ruta terapéutica por regla, contrato del
# experimento, mapa de la enfermedad, cifras de aprendizaje y perfil por diana.
from rosa import cifras_aprendizaje as CIFRAS, dianas as DI, experimento as XP, mapa_enfermedad as MAPA, ruta as RUTA
from rosa.bucle import contexto as T
from rosa.bucle import evidencia as EV
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.fuentes import crossref
from rosa.fuentes.base import FuenteNoDisponible
from rosa import gateway as GW
from rosa.gateway import Modelos
from rosa.modulos.contador import ContextoLlamada, PresupuestoAgotado, contexto_actual, tope_agotado_en
from rosa.modulos import firmas as F
from rosa.modulos.firmas import Programas

# Vigilante de modelos (18 de septiembre de 2026, TRASPASO.md 7.4). Cuando el
# cerebro (GPT-6 Astra) o el juez (Claude Opus 5) no responden, la llamada
# vigilada de rosa/vigilante_modelos.py reintenta con el MISMO modelo y, si tras
# MAX_INTENTOS sigue sin responder, lanza `ModeloSinRespuesta(rol, modelo,
# intentos, desde)`. La corrida no muere ni degrada el rol a Sonnet: pasa a
# `esperando_modelo`, el supervisor sondea el gateway cada INTERVALO_SONDEO_S
# segundos y, cuando el modelo vuelve, la relanza sola. La excepción, el
# intervalo y los textos que lee la persona (nombre del modelo, duración,
# intentos) son los del vigilante: una sola definición para las dos piezas, así
# los eventos dicen lo mismo desde el paso y desde el supervisor. `VIG` se deja
# como atributo del módulo, y los textos de respaldo de abajo lo toleran a None,
# para que un test pueda comprobar esos respaldos por sí solos.
from rosa import vigilante_modelos as VIG
from rosa import vigencia as VIGENCIA
from rosa.vigilante_modelos import INTERVALO_SONDEO_S, ModeloSinRespuesta

# Cada cuánto da una vuelta el supervisor (tic). Los tests lo acortan.
INTERVALO_TIC_S = 2.0
# Tope de una tarea de fondo (vigilancia de literatura, índice semántico): pasado
# este tiempo se corta y vuelve cuando toque. Antes se esperaban dentro del bucle
# y una pasada lenta congelaba los tics (la hora perdida de la corrida 13).
TOPE_FONDO_S = 600
# Tope de la tarea de fondo que atiende lo que la persona dejó marcado (aclarar,
# responder comentarios, revisiones pedidas, meta-campaña, rellenos en llano).
# Cada llamada al modelo que hay dentro ya la acota el vigilante (4 intentos de
# 300 s más las esperas, unos 22 minutos) y una revisión del Killer encadena
# varias: este tope es una red de seguridad contra un cuelgue ajeno al modelo
# (una fuente sin tiempo límite), no un presupuesto; cortar al juez a mitad de
# decisión cuesta más que esperar. Antes se esperaba dentro del bucle del tic,
# por la misma puerta que congeló los tics con la vigilancia de literatura.
TOPE_PETICIONES_S = 2 * 3600
# Tope de una vuelta de la recuperación de citas (rosa/recuperacion_citas.py). Si
# se pasa, lo juzgado ya está guardado por tandas y el siguiente tic sigue.
TOPE_RECUPERACION_S = 3 * 3600
# Tope del sondeo del supervisor a una corrida en `esperando_modelo`: el doble
# del tiempo del sondeo del gateway (rosa/gateway.py SEGUNDOS_SONDEO). Pasado,
# es "no pude comprobar" y el siguiente sondeo queda a INTERVALO_SONDEO_S.
TOPE_SONDEO_S = 2 * float(getattr(GW, "SEGUNDOS_SONDEO", 20.0))
# Nombre con el que la persona conoce a cada modelo, por id del gateway y por rol.
NOMBRES_MODELO = (("gpt-6-astra", "GPT-6 Astra"), ("claude-opus-5", "Claude Opus 5"), ("claude-sonnet-5", "Claude Sonnet 5"))
NOMBRE_POR_ROL = {"cerebro": "GPT-6 Astra", "juez": "Claude Opus 5", "volumen": "Claude Sonnet 5", "replica": "Claude Opus 5"}

# Lo que cuesta de verdad cada tipo de paso, en llamadas al modelo, medido en
# la primera corrida real (10 de septiembre de 2026): el cribado de relevancia
# es una llamada por artículo, la extracción una por fragmento, el juez una
# por afirmación. El modelo que propone el plan no conoce este coste, así que
# su cifra se sustituye por esta.
COSTE_POR_TIPO = {"literatura": 70, "ensayos": 4, "extraccion": 60, "verificacion": 80, "novedad": 25, "modelo": 4, "hipotesis": 97, "analisis": 14, "meta": 4, "indicacion": 0}
# El paso de hipótesis sube de 90 a 97 el 27 de septiembre de 2026: el equipo de
# generación (rosa/equipo.py) son cuatro enfoques en dos rondas, ocho llamadas al
# cerebro en vez de una. El resto del paso (revisión, supuestos, Killer, torneo) no
# cambia.

PLAN_POR_DEFECTO = [
    ("Buscar literatura", "PubMed, Europe PMC y preprints sobre las preguntas abiertas", "literatura", 30),
    ("Extraer afirmaciones con procedencia", "Un fragmento a la vez, cada afirmación con su cita literal", "extraccion", 40),
    ("Verificar cada afirmación", "Comprobaciones deterministas y juez", "verificacion", 30),
    ("Actualizar el modelo de mundo", "Hechos sostenidos y preguntas abiertas", "modelo", 5),
    ("Generar y revisar hipótesis", "Nuevas hipótesis a la cola, revisión inicial, supuestos y torneo", "hipotesis", 20),
    ("Comprobar novedad", "Open Targets, ClinicalTrials.gov y precedente en OpenAlex", "novedad", 10),
]


class Supervisor:
    def __init__(self, almacen: Almacen, programas: Programas, modelos: Modelos):
        self.almacen = almacen
        self.programas = programas
        self.modelos = modelos
        self.tareas: dict[str, asyncio.Task] = {}
        self._parar = asyncio.Event()
        # Reloj de cada corrida viva en memoria (segundos de trabajo, espera humana,
        # pausas): se vuelca al estado como mucho cada RELOJ_VOLCADO_MS o cuando la
        # corrida cambia de estado, en vez de una mutación de 17 MB cada 5 s (S-17).
        self._reloj: dict[str, dict[str, Any]] = {}
        # Tareas de corrida que murieron con excepción: cuántas veces seguidas y
        # cuándo, para relanzarlas con retroceso y no cada 2 s (S-14).
        self._fallos: dict[str, dict[str, Any]] = {}
        # Un sondeo al gateway en vuelo por corrida en `esperando_modelo`: el tic lo
        # lanza cuando vence `proximoSondeo` y no espera a que termine.
        self._sondeos: dict[str, asyncio.Task] = {}
        # Cuándo se lanzó el sondeo en vuelo de cada corrida (reloj del tic): uno que
        # lleve más de INTERVALO_SONDEO_S sin terminar está colgado y se sustituye.
        self._sondeos_desde: dict[str, int] = {}
        # Tareas de fondo (vigilancia de literatura, índice semántico), una a la vez
        # cada una, para que el tic no las espere.
        self._fondo: dict[str, asyncio.Task] = {}
        # Tareas de corrida que murieron con excepción estando la corrida en
        # `esperando_modelo`: se avisa una vez por tarea (no se relanzan con
        # retroceso, las relanza el sondeo cuando el modelo vuelve).
        self._muertas_avisadas: dict[str, asyncio.Task] = {}

    # -- arranque -------------------------------------------------------------

    def recuperar_tras_reinicio(self) -> None:
        ahora = P.ahora_ms()

        def fn(e: dict[str, Any]) -> bool:
            cambiado = False
            for it in e["iteraciones"]:
                if it["terminadaEn"] is not None:
                    continue
                for p in it["pistas"]:
                    if p["estado"] == "en_curso":
                        p["estado"] = "fallida"
                        p["resumen"] = "Interrumpida por un reinicio de ROSA2018; el paso se retoma"
                        p["transcripcion"].append({"t": p["ms"], "tipo": "error", "texto": "Interrumpida por un reinicio de ROSA2018."})
                        cambiado = True
                for paso in it["plan"]:
                    if paso["estado"] == "en_curso":
                        paso["estado"] = "pendiente"
                        cambiado = True
            # Una ejecución in silico a medias no se repite sola (evitar ejecución
            # duplicada tras un reinicio): queda como error técnico con motivo.
            for run in e.get("ejecuciones", []):
                if run["estado"] == "en_curso":
                    run["estado"] = "error_tecnico"
                    run["error"] = "Interrumpida por un reinicio de ROSA2018. No se repite sola: pide el análisis otra vez si hace falta."
                    run["fin"] = ahora
                    cambiado = True
            for r in e.get("reproducciones", []):
                if r["estado"] == "en_curso":
                    r["estado"] = "error_tecnico"
                    r["_error"] = "Interrumpida por un reinicio"
                    cambiado = True
            # Una corrida que esperaba a un modelo sigue esperando (el tic sondeará);
            # el primer sondeo se adelanta a ahora, porque el reinicio puede haber
            # sido el arreglo. Sin registro de qué esperaba, no hay nada que sondear:
            # vuelve a en marcha y el paso pendiente se reintenta.
            for c in e["corridas"]:
                if c.get("estado") != "esperando_modelo":
                    continue
                if isinstance(c.get("esperandoModelo"), dict):
                    c["esperandoModelo"]["proximoSondeo"] = ahora
                else:
                    c["estado"] = "en_marcha"
                    c["esperandoModelo"] = None
                cambiado = True
            # Migración idempotente (S-16): la serie de progreso cuenta las hipótesis
            # nuevas por ventana de fecha, no por número de iteración. Volver a
            # pasarla no cambia nada, así que corre en cada arranque.
            try:
                if PROG.recalcular_progreso(e):
                    cambiado = True
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            # Saneamiento (S-08): toda hipótesis viva cuya evidencia cambió desde su
            # última decisión del Killer vuelve a la cola de revisión.
            try:
                if pedir_revision_por_huella(e, ahora):
                    cambiado = True
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            # Conclusiones al día por regla (M-14): techo, escalera y min(juez, techo)
            # se recalculan con los factores guardados para TODAS las hipótesis con
            # conclusión, también las de investigaciones sin corrida, que ningún
            # cierre volvería a tocar. Idempotente: la segunda pasada no cambia nada.
            try:
                if recalcular_conclusiones_por_regla(e, ahora):
                    cambiado = True
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            return cambiado or False

        self.almacen.mutar(fn, "recuperacion")
        for c in self.almacen.estado["corridas"]:
            if c["estado"] not in ("detenida", "terminada"):
                self.almacen.mutar(lambda e, c=c: A.con_evento(e, c["investigacionId"], "corrida_estado", f"ROSA2018 volvió a arrancar; la corrida {c['numero']} retoma donde estaba", None, ahora) or True, "evento")

    async def correr(self) -> None:
        self.recuperar_tras_reinicio()
        while not self._parar.is_set():
            try:
                self._tick()
                # Las peticiones de la persona, la vigilancia y el índice solo se
                # LANZAN aquí (tareas propias con tope, `_lanzar_fondo`); no se
                # esperan. Entre las 12:34 y las 13:33 del 18 de septiembre de 2026
                # los tics se congelaron porque la vigilancia corría dentro de este
                # bucle; una revisión pedida al juez caído (hasta 22 minutos por
                # llamada con el vigilante) los congelaba igual desde las peticiones.
                self._lanzar_fondo("peticiones", self._atender_peticiones, tope=TOPE_PETICIONES_S)
                if self._hay_recuperacion_de_citas():
                    self._lanzar_fondo("recuperacion_citas", self._recuperar_citas, tope=TOPE_RECUPERACION_S)
                await self._vigilar_si_toca()
                await self._indexar_si_toca()
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._parar.wait(), timeout=INTERVALO_TIC_S)
        # Al parar se cancelan las corridas, los sondeos y las tareas de fondo; la
        # petición de la persona que va en vuelo (una revisión del Killer ya pagada)
        # se deja terminar, como cuando se esperaba dentro del bucle. main.py corta
        # todo pasado su TOPE_APAGADO_S.
        peticiones = self._fondo.get("peticiones")
        pendientes = [*self.tareas.values(), *self._sondeos.values(), *(t for nombre, t in self._fondo.items() if nombre != "peticiones")]
        for t in pendientes:
            t.cancel()
        if peticiones is not None:
            pendientes.append(peticiones)
        # Esperar a que las tareas terminen sus finally (escriben en el almacen)
        # antes de que main cierre SQLite.
        if pendientes:
            await asyncio.gather(*pendientes, return_exceptions=True)
        # El reloj que quedó en memoria se escribe antes de cerrar.
        with contextlib.suppress(Exception):
            self._volcar_reloj(P.ahora_ms(), todas=True)

    def parar(self) -> None:
        """Pide parar: el bucle no arranca trabajo nuevo (peticiones, vigilancia,
        índice) y main.py deja terminar lo que va en vuelo hasta su tope."""
        self._parar.set()

    def _cerrando(self) -> bool:
        return self._parar.is_set()

    def _lanzar_fondo(self, nombre: str, fabrica: Callable[[], Awaitable[Any]], tope: float | None = None) -> bool:
        """Lanza `fabrica()` como tarea propia con tope (`tope` segundos, o
        TOPE_FONDO_S si no se da), una a la vez por nombre. Devuelve True si la
        lanzó (False si la anterior sigue en vuelo). Sus errores solo se
        imprimen: nunca tumban el bucle ni lo esperan. Un modelo que no responde
        dentro de ella se dice en una línea (el vigilante ya dejó la incidencia y
        la espera en la corrida), no con un traceback por vuelta."""
        t = self._fondo.get(nombre)
        if t is not None and not t.done():
            return False
        tope_s = TOPE_FONDO_S if tope is None else tope

        async def envuelta() -> None:
            try:
                await asyncio.wait_for(fabrica(), timeout=tope_s)
            except asyncio.CancelledError:
                raise
            except asyncio.TimeoutError:
                print(f"La tarea de fondo '{nombre}' superó los {tope_s} s y se cortó; volverá cuando toque", flush=True)
            except ModeloSinRespuesta as ex:
                print(f"La tarea de fondo '{nombre}' se cortó: {nombre_del_modelo(getattr(ex, 'modelo', None), getattr(ex, 'rol', None))} no responde; se reintenta cuando vuelva", flush=True)
            except Exception:  # noqa: BLE001
                traceback.print_exc()

        self._fondo[nombre] = asyncio.create_task(envuelta(), name=f"fondo-{nombre}")
        return True

    async def _indexar_si_toca(self) -> None:
        """Índice semántico del registro (rosa/indice_semantico.py): incrusta lo
        nuevo o cambiado cada diez minutos, como tarea de fondo. Céntimos; sin
        clave no hace nada."""
        ahora = P.ahora_ms()
        if self._cerrando() or ahora - getattr(self, "_ultima_indexacion", 0) < 10 * 60 * 1000:
            return
        if self._lanzar_fondo("indice", self._indexar):
            self._ultima_indexacion = ahora

    async def _indexar(self) -> None:
        from rosa import indice_semantico

        n = await indice_semantico.indexar_estado(self.almacen)
        if n:
            print(f"Índice semántico: {n} textos nuevos o cambiados incrustados")

    async def _vigilar_si_toca(self) -> None:
        """Vigilancia de literatura (rosa/vigilancia.py): una pasada por hora,
        como tarea de fondo; cada hipótesis viva se comprueba como mucho una vez
        al día. Sin Exa no hace nada. Un fallo no tumba el bucle."""
        ahora = P.ahora_ms()
        ultima = getattr(self, "_ultima_vigilancia", 0)
        if self._cerrando() or ahora - ultima < 3600 * 1000:
            return
        if self._lanzar_fondo("vigilancia", lambda: self._vigilar(ahora)):
            self._ultima_vigilancia = ahora

    async def _vigilar(self, ahora: int) -> None:
        from rosa import vigilancia

        resumen = await vigilancia.vigilar(self.almacen, ahora)
        if resumen["comprobadas"] or resumen["errores"] or resumen.get("retiradas"):
            print(f"Vigilancia de literatura: {resumen['comprobadas']} hipótesis comprobadas, {resumen['conNovedades']} con novedades ({resumen['nuevas']} publicaciones), {resumen['costeUsd']} USD, {resumen['errores']} sin respuesta, {resumen.get('retiradas', 0)} novedades retiradas por no nombrar la hipótesis")

    # -- por tick --------------------------------------------------------------

    def _tick(self, ahora: int | None = None) -> None:
        e = self.almacen.estado
        ahora = ahora if ahora is not None else P.ahora_ms()
        for c in e["corridas"]:
            if c["estado"] in ("detenida", "terminada"):
                continue
            if c["estado"] == "esperando_modelo":
                t = self.tareas.get(c["id"])
                if t is not None and not t.done():
                    # La tarea vive: el vigilante (rosa/vigilante_modelos.py) sigue
                    # reintentando dentro del paso y ya puso la corrida en espera. El
                    # supervisor no sondea a la vez: dos manos sobre la misma espera
                    # contarían caídas y recuperaciones de más.
                    continue
                if t is not None and not t.cancelled() and t.exception() is not None and self._muertas_avisadas.get(c["id"]) is not t:
                    self._muertas_avisadas[c["id"]] = t
                    traceback.print_exception(t.exception())
                # La tarea terminó: aquí solo se sondea el gateway cuando toca. La
                # relanza el sondeo que responde, o la persona con "Reintentar ahora"
                # (reanudar_corrida), que la pone en marcha.
                self._sondear_si_toca(c, ahora)
                continue
            t = self.tareas.get(c["id"])
            if t is None or t.done():
                if not self._puede_relanzar(c, t, ahora):
                    continue
                self._relanzar_corrida(c["id"])
        # El reloj se lleva en memoria; solo se escribe cuando toca volcarlo.
        volcar = self._reloj_en_memoria(e, ahora)
        # Autoaprobación de planes, reloj volcado y salida de "esperando aprobación".

        def fn(e2: dict[str, Any]) -> bool:
            cambiado = False
            for c in e2["corridas"]:
                if c["id"] in volcar and self._escribir_reloj(c, ahora):
                    cambiado = True
                # Una corrida detenida por una persona también cierra con su métrica.
                if c["estado"] in ("detenida", "terminada") and c.get("metrica") is None and c.get("progreso"):
                    c["metrica"] = PROG.metrica_de_corrida(e2, c["id"])
                    cambiado = True
                if c["estado"] in ("detenida", "terminada"):
                    continue
                if c["estado"] == "esperando_plan" and c["autoAprobarPlanSegundos"] is not None:
                    it = A.iteracion_actual_de(e2, c)
                    if it and not it["planAprobado"] and ahora - it["planPropuestoEn"] >= c["autoAprobarPlanSegundos"] * 1000 and c["estado"] not in ("detenida", "terminada"):
                        it["planAprobado"] = True
                        it["empezadaEn"] = ahora
                        c["estado"] = "en_marcha"
                        A.con_evento(e2, c["investigacionId"], "corrida_estado", f"Plan de la iteración {it['numero']} autoaprobado tras {c['autoAprobarPlanSegundos']} s sin respuesta", None, ahora)
                        cambiado = True
                if c["estado"] == "esperando_aprobacion":
                    pendientes = any(s["corridaId"] == c["id"] and s["estado"] == "pendiente" for s in e2["solicitudes"]) or any(i["corridaId"] == c["id"] and i["estado"] == "pendiente" and i["tipo"] not in INCIDENCIAS_QUE_NO_BLOQUEAN for i in e2["incidencias"])
                    if not pendientes:
                        c["estado"] = "en_marcha"
                        # Un registro de espera que el vigilante dejó mientras la corrida
                        # esperaba la aprobación ya no vale: el paso se reintenta y, si el
                        # modelo sigue caído, el vigilante lo vuelve a anotar.
                        c["esperandoModelo"] = None
                        cambiado = True
            return cambiado or False

        self.almacen.mutar(fn, "tick")

    # -- esperando modelo: sondeos al gateway ----------------------------------

    def _relanzar_corrida(self, corrida_id: str) -> None:
        self.tareas[corrida_id] = asyncio.create_task(self.correr_corrida(corrida_id), name=f"corrida-{corrida_id}")

    def _sondear_si_toca(self, c: dict[str, Any], ahora: int) -> None:
        """Para una corrida en `esperando_modelo`: si venció `proximoSondeo` y no
        hay un sondeo en vuelo, lanza UNO como tarea propia (el tic no lo espera).
        Sin registro de qué espera (estado a medias o de otra versión), no hay
        nada que sondear: la corrida vuelve a en marcha y el paso se reintenta."""
        cid = c["id"]
        t = self._sondeos.get(cid)
        if t is not None and not t.done():
            desde = self._sondeos_desde.get(cid)
            if isinstance(desde, (int, float)) and ahora - int(desde) >= int(INTERVALO_SONDEO_S) * 1000:
                # Un sondeo que lleva más de un intervalo en vuelo está colgado (una
                # conexión que no cierra, un `sondear` sustituido): se corta, cuenta
                # como "no pude comprobar" y el siguiente queda a INTERVALO_SONDEO_S.
                # Sin esto la corrida esperaba para siempre sin señal alguna.
                t.cancel()
                self._sondeos_desde[cid] = ahora  # no se vuelve a cortar hasta otro intervalo
                print(f"El sondeo de la corrida {c.get('numero', cid)} llevaba más de {int(INTERVALO_SONDEO_S)} s sin terminar; se corta y cuenta como sin respuesta", flush=True)
                with contextlib.suppress(Exception):
                    self.almacen.mutar(lambda e2: _sondeo_fallido(e2, cid, ahora), "sondeo")
            return
        espera = c.get("esperandoModelo")
        if not isinstance(espera, dict):
            self.almacen.mutar(lambda e2: _salir_de_esperando_modelo_sin_registro(e2, cid, ahora), "estado")
            return
        proximo = espera.get("proximoSondeo")
        if isinstance(proximo, (int, float)) and ahora < int(proximo):
            return
        self._sondeos_desde[cid] = ahora
        self._sondeos[cid] = asyncio.create_task(self._sondear_modelo(cid, str(espera.get("rol") or "cerebro")), name=f"sondeo-{cid}")

    def _lm_del_rol(self, rol: str) -> Any:
        m = self.modelos
        if rol == "replica":
            return getattr(m, "replica", None) or m.juez
        return getattr(m, rol, None) or m.cerebro

    async def _sondear(self, lm: Any) -> bool:
        """Una petición mínima al gateway con ese modelo (rosa/gateway.py
        `sondear`: max_tokens 1, 20 s, nunca lanza). Si el sondeo aún no existe
        en este árbol, se da por respondido y el paso se reintenta directamente:
        el vigilante volverá a traer la corrida aquí si el modelo sigue caído."""
        from rosa import gateway

        fn = getattr(gateway, "sondear", None)
        if fn is None:
            return True
        return bool(await fn(lm))

    async def _sondear_modelo(self, corrida_id: str, rol: str) -> None:
        """El sondeo de una corrida: si el modelo responde, la corrida vuelve a en
        marcha con su evento y se relanza por el mismo camino que reanudar; si no,
        el siguiente sondeo queda a INTERVALO_SONDEO_S. Un error del sondeo cuenta
        como "no pude comprobar", nunca como "el modelo volvió"."""
        try:
            responde = bool(await asyncio.wait_for(self._sondear(self._lm_del_rol(rol)), timeout=TOPE_SONDEO_S))
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            # El sondeo del gateway ya tiene su tope; este es la red por si algo lo
            # retiene (una conexión que no cierra). Es "no pude comprobar", no "volvió".
            print(f"El sondeo al {rol} no terminó en {TOPE_SONDEO_S:g} s; cuenta como sin respuesta", flush=True)
            responde = False
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            responde = False
        ahora = P.ahora_ms()
        if not responde:
            with contextlib.suppress(Exception):
                self.almacen.mutar(lambda e2: _sondeo_fallido(e2, corrida_id, ahora), "sondeo")
            return
        if not self.almacen.mutar(lambda e2: _modelo_recuperado(e2, corrida_id, ahora), "modelo_recuperado"):
            return  # ya no esperaba (la persona la reanudó o la detuvo mientras sondeábamos)
        t = self.tareas.get(corrida_id)
        if t is None or t.done():
            self._relanzar_corrida(corrida_id)

    # -- reloj en memoria (S-17) ----------------------------------------------

    def _reloj_en_memoria(self, e: dict[str, Any], ahora: int) -> set[str]:
        """Acumula en `self._reloj` la espera humana, las pausas y los segundos de
        trabajo de cada corrida viva, y devuelve los ids cuyo reloj toca volcar al
        estado: la corrida cambió de estado, acaba de terminar (para que su balance
        sea exacto), espera y aún no tiene ancla (`_relojEn`), o trabaja y han
        pasado RELOJ_VOLCADO_MS desde el último volcado (que le deja el ancla).

        Una corrida que espera (a una persona, o a un modelo que no responde) no
        se vuelca por tiempo: su tiempo de trabajo no se mueve y la pantalla
        enseña el guardado, así que escribir la espera cada 30 s solo reescribía
        el estado entero y llenaba el registro de auditoría (la corrida
        pausada por presupuesto del 25 de septiembre dejó 504 tics en un día sin
        nada en marcha, 28 de septiembre de 2026). Lo que protegía ese volcado
        periódico, que un reinicio no convierta la espera en trabajo, lo hace
        ahora el ancla: cada volcado guarda en `_relojEn` el instante hasta el
        que los contadores son exactos, y al arrancar el reloj parte de ahí, así
        que el hueco hasta el primer tic se reparte con las mismas reglas de
        `contabilizar_tiempo` (espera si la corrida esperaba; pausa del proceso
        si trabajaba y el hueco pasa de UMBRAL_SUSPENSION_MS)."""
        volcar: set[str] = set()
        vivos = {c["id"] for c in e["corridas"]}
        for cid in list(self._reloj):
            if cid not in vivos:
                self._reloj.pop(cid, None)
                self._fallos.pop(cid, None)
        for c in e["corridas"]:
            cid = c["id"]
            r = self._reloj.get(cid)
            if c["estado"] in ("detenida", "terminada"):
                if r is not None:
                    volcar.add(cid)
                continue
            ancla = ancla_de_reloj(c, ahora)
            con_ancla = ancla is not None
            if r is None:
                r = self._reloj[cid] = {"estado": c["estado"], "esperaHumanaMs": int(c.get("esperaHumanaMs") or 0), "pausaMs": int(c.get("pausaMs") or 0), "_ultimoTic": ancla, "volcadoEn": ahora, "estadoVolcado": c["estado"]}
            r["estado"] = c["estado"]
            contabilizar_tiempo(r, ahora)
            r["segundos"] = round(tiempo_trabajo_ms({**c, "esperaHumanaMs": r["esperaHumanaMs"], "pausaMs": r["pausaMs"]}, ahora) / 1000)
            espera = c["estado"] in ESTADOS_DE_ESPERA_HUMANA or c["estado"] in ESTADOS_DE_PAUSA_DEL_PROCESO
            if c["estado"] != r.get("estadoVolcado") or (espera and not con_ancla) or (not espera and ahora - int(r.get("volcadoEn") or 0) >= RELOJ_VOLCADO_MS):
                volcar.add(cid)
        return volcar

    def _escribir_reloj(self, c: dict[str, Any], ahora: int) -> bool:
        """Escribe en la corrida lo acumulado en memoria. Devuelve True si cambió algo."""
        r = self._reloj.get(c["id"])
        if r is None:
            return False
        cambiado = False
        # El ancla va en la misma escritura que los contadores: juntos dicen "exactos
        # hasta este instante". Si solo se moviera el ancla (los contadores no
        # cambiaron), no hace falta escribir: el par guardado sigue siendo exacto.
        if ancla_de_reloj(c, ahora) is None:
            cambiado = True
        c["_relojEn"] = int(ahora)
        for clave in ("esperaHumanaMs", "pausaMs"):
            if int(c.get(clave) or 0) != int(r.get(clave) or 0):
                c[clave] = int(r.get(clave) or 0)
                cambiado = True
        seg = int(r.get("segundos") if r.get("segundos") is not None else round(tiempo_trabajo_ms({**c, "esperaHumanaMs": r["esperaHumanaMs"], "pausaMs": r["pausaMs"]}, ahora) / 1000))
        if c["gasto"].get("segundos") != seg:
            c["gasto"]["segundos"] = seg
            cambiado = True
        r["volcadoEn"] = ahora
        r["estadoVolcado"] = c["estado"]
        if c["estado"] in ("detenida", "terminada"):
            self._reloj.pop(c["id"], None)
        return cambiado

    def _volcar_reloj(self, ahora: int, todas: bool = False) -> None:
        """Vuelca el reloj de todas las corridas con registro en memoria (al parar)."""
        ids = set(self._reloj) if todas else set()
        if not ids:
            return
        self.almacen.mutar(lambda e2: any([self._escribir_reloj(c, ahora) for c in e2["corridas"] if c["id"] in ids]) or False, "reloj")

    def _con_reloj(self, c: dict[str, Any]) -> dict[str, Any]:
        """La corrida con la espera humana y las pausas que hay en memoria, para
        que el tope en horas se compare con el valor al día y no con el volcado
        de hace medio minuto. Copia superficial: no toca el estado."""
        r = self._reloj.get(c["id"])
        if r is None:
            return c
        return {**c, "esperaHumanaMs": int(r.get("esperaHumanaMs") or 0), "pausaMs": int(r.get("pausaMs") or 0)}

    # -- relanzar con retroceso (S-14) -----------------------------------------

    def _puede_relanzar(self, c: dict[str, Any], t: asyncio.Task | None, ahora: int) -> bool:
        """Si la tarea de la corrida murió con una excepción, deja una incidencia
        visible y espera con retroceso exponencial (`retroceso_ms`: 30 s, 60 s,
        5 min, 10 min, 20 min, hasta 30 min) antes de relanzarla. Antes se
        relanzaba cada 2 s: la corrida decía "en marcha" para siempre, con un
        traceback por vuelta y dos escrituras del estado entero cada vez."""
        cid = c["id"]
        if t is None:
            return True
        if t.cancelled() or t.exception() is None:
            self._fallos.pop(cid, None)
            return True
        reg = self._fallos.get(cid)
        if reg is None or reg.get("tarea") is not t:
            ex = t.exception()
            traceback.print_exception(ex)
            n = 1 if reg is None or ahora - int(reg.get("relanzadaEn") or 0) > 10 * 60_000 else int(reg.get("n") or 0) + 1
            espera = retroceso_ms(n)
            self._fallos[cid] = {"n": n, "en": ahora, "tarea": t, "espera": espera, "relanzadaEn": int((reg or {}).get("relanzadaEn") or 0)}
            with contextlib.suppress(Exception):
                self.almacen.mutar(lambda e2: _incidencia_bucle(e2, cid, ex, n, espera, ahora), "incidencia")
            return False
        if ahora - int(reg["en"]) < int(reg["espera"]):
            return False
        reg["relanzadaEn"] = ahora
        reg["tarea"] = None
        return True

    def _hay_recuperacion_de_citas(self) -> bool:
        from rosa import recuperacion_citas as RC

        return any(isinstance(i.get("recuperacionCitas"), dict) and i["recuperacionCitas"].get("estado") in RC.ESTADOS_PENDIENTES for i in self.almacen.estado.get("investigaciones", []))

    async def _recuperar_citas(self) -> None:
        """La recuperación de citas que una persona pidió (rosa/recuperacion_citas.py),
        una investigación detrás de otra. Lo hecho se guarda por tandas: si se corta
        (tope, reinicio, modelo caído), el siguiente tic la retoma donde iba."""
        from rosa import recuperacion_citas as RC

        for inv in list(self.almacen.estado.get("investigaciones", [])):
            if self._cerrando():
                return
            reg = inv.get("recuperacionCitas")
            if isinstance(reg, dict) and reg.get("estado") in RC.ESTADOS_PENDIENTES:
                await RC.recuperar(self, inv["id"])

    async def _atender_peticiones(self) -> None:
        """Lo que la investigadora dejó marcado y no requiere corrida en marcha."""
        e = self.almacen.estado
        for h in list(e["hipotesis"]):
            if self._cerrando():
                return  # ROSA2018 está cerrando: nada nuevo al modelo
            corrida = A.ultima_corrida_de(e, h["investigacionId"])
            if not corrida:
                continue
            if corrida["estado"] == "esperando_modelo":
                # El modelo de la corrida no responde: lo que la persona dejó marcado
                # espera a que vuelva (el tic sondea y la relanza) en vez de pedírselo
                # otra vez al modelo caído desde aquí.
                continue
            ctx = self._ctx(corrida)
            if h["estado"] == "aclarando":
                await self._aclarar(ctx, h)
            if h.get("_comentariosNuevos"):
                await self._responder_comentarios(ctx, h)
            if h.get("replicacion") and h["replicacion"]["estado"] == "en_curso":
                await self._replicar_paso(ctx, h)
            if h.get("_reformularPedida") is not None and h["estado"] == "refinar":
                await self._reformular_por_persona(ctx, h)
            if h.get("dossierArtefactoId") and h.get("nombreCorto") is None and not h.get("_nombreCortoIntentado"):
                # Generar el dossier es una petición de la persona: el nombre corto
                # del documento controlado se pide aunque la corrida esté parada.
                await self._nombre_corto(ctx, h)
            if h.get("_revisionPedida") and (corrida["estado"] in ("detenida", "terminada", "esperando_plan") or A.iteracion_actual_de(e, corrida) is None):
                # Una revisión pedida con la corrida parada no espera al siguiente paso
                # de hipótesis: revisión inicial, supuestos y Killer ahora.
                # Sin presupuesto en la corrida no se abre pista ni se cuenta intento: la
                # petición se cierra con una línea que dice qué pasó y cómo repetirla. Antes
                # la excepción del contador contaba como "el juez no respondió" y en tres
                # ticks (seis segundos) la revisión quedaba abandonada con el motivo falso.
                if tope_agotado_en(e, corrida["id"], corrida.get("iteracionActual")) is not None:
                    self.almacen.mutar(lambda e2: _abandonar_peticion_sin_presupuesto(e2, h["id"], corrida), "revision")
                    return
                texto_af, _ = T.afirmaciones_sostenidas(corrida.get("_afirmaciones", []))
                pista = ctx.pista(None, "modelo", f"Revisión pedida: {h['titulo'][:60]}", "Opus 5 (Killer)")
                decisiones_antes = _n_decisiones_killer(e, h["id"])
                intentos_antes = int(h.get("_killerIntentos") or 0)
                sin_presupuesto = False
                sin_modelo = False  # el juez no respondió: la petición sigue en pie y no cuenta intento
                try:
                    await PASOS._revisar_hipotesis(ctx, h, texto_af[:8000], pista)
                    pista.cerrar("Revisión y Killer terminados")
                except PresupuestoAgotado:
                    sin_presupuesto = True
                    pista.fallar("Sin presupuesto en la corrida: la revisión pedida no se hizo")
                    self.almacen.mutar(lambda e2: _abandonar_peticion_sin_presupuesto(e2, h["id"], corrida), "revision")
                except ModeloSinRespuesta as ex:
                    # Opus no respondió tras los reintentos del vigilante: no es "la
                    # revisión falló" ni un intento de MAX_INTENTOS_KILLER (con tres caídas
                    # la petición quedaba abandonada con un motivo falso). La marca
                    # `_revisionPedida` se conserva y la revisión se hace cuando vuelva
                    # (TRASPASO.md 7.4: se espera el tiempo que haga falta).
                    sin_modelo = True
                    pista.fallar(f"Interrumpida: {nombre_del_modelo(getattr(ex, 'modelo', None), getattr(ex, 'rol', None))} no respondió; la revisión pedida sigue en pie y se hace cuando vuelva")
                    raise
                except Exception as ex:  # noqa: BLE001
                    traceback.print_exc()
                    pista.fallar(f"La revisión falló: {str(ex)[:160]}")
                finally:
                    # La marca se quita solo si el Killer llegó a decidir; si falló, la
                    # petición sigue viva hasta MAX_INTENTOS_KILLER intentos (S-08).
                    if not sin_presupuesto and not sin_modelo:
                        self.almacen.mutar(lambda e2: _cerrar_peticion_de_revision(e2, h["id"], decisiones_antes, intentos_antes), "revision")
                return
            if h.get("_analisisPedido") and (corrida["estado"] in ("detenida", "terminada", "esperando_plan") or A.iteracion_actual_de(e, corrida) is None):
                # Con la corrida parada, el análisis pedido no espera a un paso del plan.
                from rosa.bucle import analisis as AN

                p = h["_analisisPedido"]
                pista = ctx.pista(None, "modelo", f"Análisis pedido: {h['titulo'][:60]}", "Sandbox")
                try:
                    await AN.analizar_hipotesis(ctx, h, p["datasetId"], p.get("pregunta", ""), pista)
                except PresupuestoAgotado:
                    pista.fallar("Presupuesto agotado: el análisis conserva sus resultados y queda pendiente")
                except ModeloSinRespuesta as ex:
                    # El modelo no respondió: la petición sigue en pie y se hace cuando vuelva.
                    pista.fallar(f"Interrumpido: {ex.modelo if hasattr(ex, 'modelo') else 'el modelo'} no respondió; el análisis pedido sigue en pie y se hace cuando vuelva")
                except Exception as ex:  # noqa: BLE001
                    traceback.print_exc()
                    self.almacen.mutar(lambda e2: (next(x for x in e2["hipotesis"] if x["id"] == h["id"]).pop("_analisisPedido", None), True)[1], "analisis")
                    pista.fallar(f"El análisis falló: {str(ex)[:160]}")
                else:
                    pista.cerrar("Análisis terminado")
                return
        for rep in [r for r in e.get("reproducciones", []) if r["estado"] == "pendiente"]:
            corrida = A.ultima_corrida_de(e, rep["investigacionId"])
            if corrida and (corrida["estado"] in ("detenida", "terminada", "esperando_plan") or A.iteracion_actual_de(e, corrida) is None):
                from rosa.bucle import analisis as AN

                ctx = self._ctx(corrida)
                pista = ctx.pista(None, "modelo", f"Reproducción: {rep['referencia'][:60]}", "Sandbox")
                try:
                    await AN.reproducir(ctx, rep, pista)
                except Exception as ex:  # noqa: BLE001
                    traceback.print_exc()
                    pista.fallar(f"La reproducción fallo: {str(ex)[:160]}")
                    self.almacen.mutar(lambda e2: AN._estado_rep(e2, rep["id"], "error_tecnico", None, None, str(ex)[:200]), "reproduccion")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                else:
                    pista.cerrar("Reproducción terminada")
                return
        for inv in list(e["investigaciones"]):
            if inv.get("_recomprobarRetracciones"):
                await self._recomprobar_retracciones(inv)
        for c in list(e.get("corridas", [])):
            if c.get("_revisarArnes") and c.get("estado") == "terminada":
                await self._revisar_arnes(c)
                return
        for cambio in list(e.get("aprendizaje", [])):
            if cambio.get("_evaluar"):
                await self._evaluar_cambio(cambio)
                return
            if cambio.get("_promover"):
                self._promover_programa(cambio)
        await self._compuestos_que_faltan()
        await self._estructuras_que_faltan()
        await self._secuencias_que_faltan()
        self._criba_si_toca()
        await self._tableros_que_faltan()
        await self._completar_en_llano()

    async def _compuestos_que_faltan(self) -> None:
        """Resuelve en PubChem los compuestos que las intervenciones nombran y los
        guarda en la investigación, para la sección de laboratorio.

        Se hace aquí y no al pintar la pantalla porque PubChem limita a 5 consultas
        por segundo y 400 por minuto, y porque el resultado no cambia: un compuesto
        es el que es. Cada nombre se consulta UNA vez por investigación; el que
        PubChem no conoce se guarda como no encontrado y no se vuelve a pedir
        (lecanemab, por ejemplo, es un anticuerpo y no está como compuesto).

        Quien decide si un nombre es un compuesto es PubChem, no ROSA2018: de los
        textos salen candidatos por regla y solo entra el que la base resuelve."""
        from rosa.conectores.base import _consultar

        e = self.almacen.estado
        for inv in list(e.get("investigaciones") or []):
            if not isinstance(inv, dict):
                continue
            guardados = inv.get("compuestos")
            # Solo se saltan los que ya tienen respuesta de PubChem. Los que
            # quedaron sin comprobar (la fuente no respondió) vuelven a la cola.
            ya = {
                str(c.get("nombre") or "").lower()
                for c in (guardados if isinstance(guardados, list) else [])
                if isinstance(c, dict) and (c.get("encontrado") or c.get("comprobado", True))
            }
            # Primero los que la EVIDENCIA nombra (entidades CHEBI del modelo de
            # mundo, que es lo que la sección enseña) y después los que solo
            # aparecen en los textos de intervención.
            de_la_evidencia = [c["nombre"] for c in LAB.compuestos_nombrados(e, inv["id"])]
            textos = [str(LAB._dic(h, "tarjeta").get("intervencion") or "") for h in LAB._vivas(e, inv["id"])]
            candidatos = [c for c in dict.fromkeys(de_la_evidencia + LAB.candidatos_de_compuesto(textos)) if c.lower() not in ya]
            if not candidatos:
                continue
            nuevos: list[dict[str, Any]] = []
            consultas: list[dict[str, Any]] = []
            for nombre in candidatos[:3]:  # tres por tick: el límite de PubChem manda
                reg, datos = await _consultar("pubchem_compuesto", resumen=f"Compuesto {nombre}", nombre=nombre)
                consultas.append(reg)
                ficha = LAB.ficha_de_compuesto(nombre, (datos or [{}])[0] if isinstance(datos, list) and datos else None)
                # «No lo encontré» y «no pude preguntar» NO son lo mismo, y
                # confundirlos rompe la regla de ROSA2018: un tiempo agotado no
                # es «no existe». Si el conector dio error se guarda como no
                # comprobado y se vuelve a intentar; si respondió y no hay
                # nada, entonces sí es que PubChem no lo tiene.
                fallo = reg.get("error")
                nuevos.append(ficha or {
                    "nombre": nombre,
                    "encontrado": False,
                    "comprobado": not fallo,
                    "motivo": str(fallo) if fallo else "PubChem no tiene ningún compuesto con ese nombre",
                    "fecha": P.ahora_ms(),
                })
                if ficha:
                    ficha["fecha"] = P.ahora_ms()
                    ficha["encontrado"] = True
                    ficha["comprobado"] = True

            def fn(e2: dict[str, Any], inv_id: str = inv["id"], nuevos: list[dict[str, Any]] = nuevos, consultas: list[dict[str, Any]] = consultas) -> bool:
                i2 = next((x for x in e2.get("investigaciones") or [] if isinstance(x, dict) and x.get("id") == inv_id), None)
                if i2 is None:
                    return False
                lista = i2.setdefault("compuestos", [])
                if not isinstance(lista, list):
                    lista = i2["compuestos"] = []
                # Un reintento sustituye al intento que no se pudo comprobar,
                # en vez de dejar los dos y que la pantalla enseñe el viejo.
                por_nombre = {str(c.get("nombre") or "").lower(): i for i, c in enumerate(lista) if isinstance(c, dict)}
                for c in nuevos:
                    k = str(c.get("nombre") or "").lower()
                    if k in por_nombre:
                        lista[por_nombre[k]] = c
                    else:
                        lista.append(c)
                i2.setdefault("consultas", []).extend(consultas)
                encontrados = [c for c in nuevos if c.get("encontrado")]
                if encontrados:
                    A.con_evento(e2, inv_id, "aprendizaje", f"{len(encontrados)} {'compuesto identificado' if len(encontrados) == 1 else 'compuestos identificados'} en PubChem para el laboratorio: " + ", ".join(f"{c['nombre']} ({c.get('formula')})" for c in encontrados), f"#/investigaciones/{inv_id}/laboratorio", P.ahora_ms())
                return True

            self.almacen.mutar(fn, "compuestos")
            return  # uno por tick: no se atropella el límite de la fuente

    async def _estructuras_que_faltan(self) -> None:
        """Cuenta en el RCSB PDB cuántas estructuras MEDIDAS hay de cada diana.

        Hasta el 29 de septiembre de 2026 la sección de laboratorio enseñaba
        siempre el modelo predicho de AlphaFold y el pie decía que también
        usaba el PDB: era falso. Y para tau la diferencia importa, porque su
        modelo predicho tiene un 8 % de confianza alta mientras el PDB guarda
        cientos de estructuras medidas, incluidos los filamentos sacados de
        cerebros con Alzheimer.

        ROSA2018 no ELIGE una: la mayoría de esas entradas son péptidos cortos
        o fragmentos, y quedarse con una al azar sería peor que el modelo
        completo. Lo que hace es decir cuántas hay y dejar ir a verlas."""
        from rosa.conectores.base import _consultar

        e = self.almacen.estado
        guardadas = e.get("estructurasMedidas")
        guardadas = guardadas if isinstance(guardadas, dict) else {}
        pendientes = [
            d["uniprot"]
            for d in LAB.dianas_de(e)
            if d["uniprot"] not in guardadas or not guardadas[d["uniprot"]].get("comprobado", True)
        ]
        if not pendientes:
            return
        uniprot = pendientes[0]
        reg, datos = await _consultar("pdb_estructuras", resumen=f"Estructuras medidas de {uniprot}", uniprot=uniprot)
        fallo = reg.get("error")
        d0 = datos if isinstance(datos, dict) else {}
        ficha = {
            "total": int(d0.get("total") or 0) if not fallo else 0,
            "entradas": list(d0.get("entradas") or [])[:6],
            # Un tiempo agotado no es «cero estructuras»: se vuelve a intentar.
            "comprobado": not fallo,
            "motivo": str(fallo) if fallo else "",
            "fecha": P.ahora_ms(),
        }

        def fn(e2: dict[str, Any], u: str = uniprot, ficha: dict[str, Any] = ficha) -> bool:
            m = e2.setdefault("estructurasMedidas", {})
            if not isinstance(m, dict):
                m = e2["estructurasMedidas"] = {}
            m[u] = ficha
            return True

        self.almacen.mutar(fn, "estructuras")

    async def _secuencias_que_faltan(self) -> None:
        """Trae la secuencia del transcrito canónico de cada diana, que es lo
        único que hace falta para diseñar un oligonucleótido antisentido.

        Va aquí y no al pintar la pantalla porque la secuencia no cambia (un
        transcrito es el que es) y porque Ensembl limita a quince por segundo.
        El cDNA se guarda en el estado y no viaja al navegador: son casi siete
        mil nucleótidos por diana y la pantalla solo necesita el diseño."""
        from rosa.conectores.base import _consultar

        e = self.almacen.estado
        guardadas = e.get("secuencias")
        guardadas = guardadas if isinstance(guardadas, dict) else {}
        pendiente = next(
            (
                d
                for d in LAB.dianas_de(e)
                # Falta si no está, si no se pudo comprobar, o si el diseño
                # guardado es de una versión anterior de las reglas.
                if d.get("ensembl")
                and (
                    d["uniprot"] not in guardadas
                    or not guardadas[d["uniprot"]].get("comprobado", True)
                    or ((guardadas[d["uniprot"]].get("diseño") or {}).get("version") or 0) < ASO.VERSION
                    # Y también cuando cambian las reglas del PLEGADO, que es
                    # otra dependencia: la accesibilidad decide qué candidatos
                    # se eligen, así que una regla nueva ahí deja el diseño
                    # viejo igual que una regla nueva de ASO. Sin esto había
                    # que subir ASO.VERSION para cambiar el plegado, que es
                    # conflar dos cosas distintas.
                    or (((guardadas[d["uniprot"]].get("diseño") or {}).get("plegado") or {}).get("version") or 0) < PLEGADO.VERSION
                )
            ),
            None,
        )
        if not pendiente:
            return
        reg, datos = await _consultar("ensembl_transcrito", resumen=f"Transcrito de {pendiente['simbolo']}", ensembl=str(pendiente["ensembl"]), uniprot=str(pendiente["uniprot"]))
        fallo = reg.get("error")
        ficha = dict(datos) if isinstance(datos, dict) and not fallo else {}
        # El DISEÑO se calcula aquí, una vez, y no en cada visita a la
        # pantalla: recorrer los transcritos de las diecisiete dianas costaba
        # dos segundos por petición, y el resultado no cambia nunca porque un
        # transcrito es el que es.
        # La accesibilidad del sitio ANTES de diseñar, no después: si el ARN
        # está plegado sobre sí mismo ahí, el oligo no entra, y eso tiene que
        # pesar en QUÉ sesenta ventanas se eligen y no solo en cómo se
        # enseñan. La primera medición fue clara: de los sesenta candidatos de
        # MAPT elegidos sin esto, solo dos pasaban de 0,1 de accesibilidad, el
        # número uno estaba en 0,013 y el mejor sitio del transcrito (0,863)
        # no estaba ni en la lista.
        #
        # Va aquí y no al pintar la pantalla porque necesita el cDNA entero,
        # que se tira unas líneas más abajo. En un hilo porque ViennaRNA es C
        # y sí suelta el GIL, al revés que `bytes.find` del cribado. Se calcula
        # el perfil de TODAS las posiciones de una vez, que cuesta lo mismo que
        # una (0,7 s en un transcrito de siete mil letras).
        perfil = await asyncio.to_thread(PLEGADO.perfil, str(ficha.get("cdna") or "")) if ficha.get("cdna") else None
        ficha["diseño"] = ASO.diseño(ficha, accesibilidad=perfil) if ficha.get("cdna") else None
        if ficha.get("diseño"):
            self._plegar(ficha, perfil)
        # El cDNA ya no hace falta guardarlo: son casi siete mil nucleótidos
        # por diana en un estado que se copia y se sirve entero.
        ficha.pop("cdna", None)
        # Un Ensembl que no responde no es «este gen no tiene transcrito».
        ficha["comprobado"] = not fallo
        ficha["motivo"] = str(fallo) if fallo else ""
        ficha["fecha"] = P.ahora_ms()

        def fn(e2: dict[str, Any], u: str = str(pendiente["uniprot"]), ficha: dict[str, Any] = ficha) -> bool:
            m = e2.setdefault("secuencias", {})
            if not isinstance(m, dict):
                m = e2["secuencias"] = {}
            m[u] = ficha
            return True

        self.almacen.mutar(fn, "secuencias")

    @staticmethod
    def _plegar(ficha: dict[str, Any], perf: list[float] | None) -> None:
        """Mete la accesibilidad del sitio en cada candidato del diseño.

        Sin ViennaRNA instalado no se inventa nada: el campo se queda a None y
        la pantalla dice que no se pudo comprobar, que no es lo mismo que
        decir que el sitio está tapado."""
        dis = ficha["diseño"]
        dis["plegado"] = {
            "hecho": perf is not None,
            "version": PLEGADO.VERSION,
            "ventana": PLEGADO.VENTANA,
            "alcance": PLEGADO.ALCANCE,
            "avisos": PLEGADO.AVISOS,
            "motivo": "" if perf is not None else "ViennaRNA no está instalado, así que no se pudo calcular si el sitio está abierto. No quiere decir que esté tapado.",
        }
        if perf is None:
            for c in dis.get("candidatos") or []:
                c["sitio"] = None
            return
        dis["plegado"]["mejorDelTranscrito"] = round(max(perf), 4)
        dis["plegado"]["posicionMejor"] = perf.index(max(perf)) + 1
        dis["plegado"]["medianaDelTranscrito"] = round(sorted(perf)[len(perf) // 2], 5)
        abiertos = 0
        for c in dis.get("candidatos") or []:
            c["sitio"] = PLEGADO.de_un_sitio(perf, int(c.get("posicion") or 0))
            if c["sitio"] and c["sitio"]["etiqueta"] == "abierto":
                abiertos += 1
        dis["plegado"]["abiertos"] = abiertos
        # El dibujo de la horquilla alrededor del mejor candidato abierto, o
        # del primero si ninguno lo está: es lo que se pinta en la pantalla.
        cands = dis.get("candidatos") or []
        mejor = max(cands, key=lambda c: (c.get("sitio") or {}).get("accesibilidad", -1.0), default=None)
        if mejor and mejor.get("sitio"):
            pos = int(mejor["posicion"])
            # La ventana se centra en el sitio del oligo. Estrecha a propósito:
            # el dibujo lleva una letra por nucleótido y con ciento cuarenta no
            # se leen.
            margen = (PLEGADO.VENTANA_DIBUJO - ASO.LARGO) // 2
            sitio = (pos, pos + ASO.LARGO - 1)
            dis["plegado"]["dibujo"] = PLEGADO.dibujo(str(ficha.get("cdna") or ""), pos - margen, pos + ASO.LARGO - 1 + margen, sitio)
            dis["plegado"]["dibujoDe"] = mejor["secuencia"]
            dis["plegado"]["dibujoSitio"] = list(sitio)

    def _criba_si_toca(self) -> None:
        """Lanza el cribado de los candidatos antisentido contra el transcriptoma
        humano entero, si hay algo nuevo que cribar.

        Tarea de fondo y en procesos hijos, no aquí: `bytes.find` no suelta el
        GIL, así que los ochenta y seis segundos que tarda colgarían el servidor
        entero si corrieran en este hilo. El bucle sigue mientras tanto y el
        resultado entra al estado cuando llega.

        Se dispara por HUELLA de las secuencias, no por contar candidatos: una
        heurística de cantidad condenaría a recribar en cada vuelta lo que ya
        está hecho. Si el conjunto de candidatos no cambió y la versión de las
        reglas tampoco, no se toca nada; y si cambió, se criba SOLO lo que
        falta, porque un resultado ya calculado no cambia nunca."""
        e = self.almacen.estado
        pet = CRIBA.peticion_de(e)
        if not pet:
            return
        huella = CRIBA.huella_de(pet)
        guardada = e.get("criba")
        guardada = guardada if isinstance(guardada, dict) else {}
        if guardada.get("huella") == huella and guardada.get("version") == CRIBA.VERSION:
            return
        conblast = CRIBA.hay_blast()
        t = CRIBA.transcriptoma()
        if not t["hay"] and not conblast["hay"]:
            # Sin los ficheros NO se criba, y eso se guarda tal cual. «No pude
            # comprobar» no es «está limpio»: la pantalla tiene que poder
            # decir cuál de las dos cosas es.
            if guardada.get("motivo") == t["motivo"]:
                return

            def fn0(e2: dict[str, Any], t: dict[str, Any] = t, huella: str = huella) -> bool:
                e2["criba"] = {"version": CRIBA.VERSION, "huella": "", "fecha": P.ahora_ms(), "transcriptoma": t, "motivo": t["motivo"], "porSecuencia": {}}
                return True

            self.almacen.mutar(fn0, "criba")
            return

        # Solo lo que FALTA. El coste del cribado es patrones por bytes, así
        # que recribar las 787 secuencias porque apareció una diana nueva son
        # seis minutos tirados: un resultado ya calculado no cambia nunca
        # (una secuencia es la que es y el fichero de Ensembl también). Al
        # subir CRIBA.VERSION se rehace todo, que es de lo que sirve la
        # versión.
        ya = guardada.get("porSecuencia") if guardada.get("version") == CRIBA.VERSION else None
        ya = ya if isinstance(ya, dict) else {}
        faltan = [x for x in pet if x["secuencia"] not in ya]
        if not faltan:
            # Nada nuevo que cribar: solo hay que tirar lo que ya no se diseña
            # y dejar la huella al día, sin lanzar ningún proceso.
            vivas = {x["secuencia"] for x in pet}

            def fn1(e2: dict[str, Any], huella: str = huella, ya: dict[str, Any] = ya, vivas: set[str] = vivas) -> bool:
                c = e2.get("criba")
                if not isinstance(c, dict):
                    return False
                c["porSecuencia"] = {k: v for k, v in ya.items() if k in vivas}
                c["huella"] = huella
                return True

            self.almacen.mutar(fn1, "criba")
            return

        async def correr() -> None:
            # BLAST si está: encuentra TODO lo que encuentra el barrido exacto
            # (comprobado, los mismos trece choques) y además los encajes con
            # fallos, que es lo que de verdad decide si un oligo se puede
            # pedir. Y tarda 145 s donde el barrido tarda 408. El barrido se
            # queda de respaldo para una máquina sin BLAST instalado.
            r = await (CRIBA.cribar_con_desajustes(faltan) if conblast["hay"] else CRIBA.cribar_aparte(faltan))
            # Y si sirve en RATÓN, que es donde se prueba primero. Un oligo
            # que no encaja en el ARN del ratón no puede ir a ningún
            # experimento con animales tal cual: hay que diseñar un sustituto
            # y aceptar que lo que se mide no es la molécula que iría a la
            # persona. Medido el 1 de octubre de 2026: solo el 10 % de los 823
            # candidatos sirven, y el que ROSA2018 mandaba NO estaba entre
            # ellos.
            rat = await ESPECIE.cribar_raton(faltan)
            for sec, v in rat.get("porSecuencia", {}).items():
                if sec in r["porSecuencia"]:
                    r["porSecuencia"][sec]["raton"] = v
            r["raton"] = {k: v for k, v in rat.items() if k != "porSecuencia"}
            vivas = {x["secuencia"] for x in pet}
            # Lo de antes que sigue en pie, más lo nuevo. Lo que ya no se
            # diseña se cae: si vuelve, se vuelve a cribar.
            r["porSecuencia"] = {**{k: v for k, v in ya.items() if k in vivas}, **r["porSecuencia"]}
            r["huella"] = huella
            r["fecha"] = P.ahora_ms()
            r["transcriptoma"] = t
            r["conDesajustes"] = conblast["hay"]
            r["motivo"] = "" if conblast["hay"] else conblast["motivo"]

            def fn(e2: dict[str, Any], r: dict[str, Any] = r) -> bool:
                e2["criba"] = r
                return True

            self.almacen.mutar(fn, "criba")
            fuera = sum(1 for v in r["porSecuencia"].values() if v.get("veredicto") == "descartado")
            como = "con BLAST, tolerando fallos" if conblast["hay"] else "solo coincidencia exacta"
            print(f"Cribado antisentido ({como}): {len(faltan)} candidatos nuevos en {r.get('segundos')} s; {fuera} de {len(r['porSecuencia'])} descartados por encajar en otro gen", flush=True)

        self._lanzar_fondo("criba", correr, tope=900)

    async def _tableros_que_faltan(self) -> None:
        """Las vistas de programa que se quedaron viejas, rehechas por regla y sin
        llamadas: el tablero del método de las investigaciones que no lo tienen o lo
        tienen de reglas anteriores, y el mapa de la enfermedad cuando es más viejo
        que la última hipótesis o hecho de la investigación.

        Lo del mapa se destapó el 29 de septiembre de 2026 al poner los nichos: el
        mapa guardado de "GFAP y NfL en portadores de APOE4" era del 17 de
        septiembre (1 celda con dos cohortes; recalculado, 4), tres investigaciones
        no tenían ninguno, y el tablero decía "0 rincones vacíos" justo en la
        investigación con las 7 hipótesis amontonadas en una celda. La tarjeta del
        mapa que se ve en pantalla era esa misma, vieja.

        El mapa se calcula en un hilo (hasta 0,9 s cada uno). Aquí no se abren
        cuestiones por sus huecos ni se disparan eventos: eso es trabajo del cierre
        de iteración, y de golpe serían veinte avisos que ya estaban."""
        e = self.almacen.estado
        ahora = P.ahora_ms()

        def ultima_novedad(inv_id: str) -> int:
            hs = [int(h.get("creadaEn") or 0) for h in e.get("hipotesis") or [] if isinstance(h, dict) and h.get("investigacionId") == inv_id]
            hechos = [int(h.get("actualizadoEn") or 0) for h in e.get("hechos") or [] if isinstance(h, dict) and h.get("investigacionId") == inv_id]
            return max(hs + hechos, default=0)

        pendientes = []
        for inv in e.get("investigaciones") or []:
            if not isinstance(inv, dict):
                continue
            guardado = inv.get("mapaEnfermedad") if isinstance(inv.get("mapaEnfermedad"), dict) else None
            mapa_viejo = guardado is None or int(guardado.get("fecha") or 0) < ultima_novedad(inv["id"])
            if mapa_viejo or not METODO.vigente(inv.get("metodo")):
                pendientes.append((inv, guardado, mapa_viejo))
        if not pendientes:
            return
        rehechos: dict[str, tuple[dict[str, Any] | None, dict[str, Any]]] = {}
        # Un mapa que no se deja calcular no se reintenta en cada tick (cada 10 s):
        # espera 10 minutos. Vive en el proceso: al reiniciar se prueba otra vez.
        fallidos: dict[str, int] = self.__dict__.setdefault("_mapas_fallidos", {})
        for inv, guardado, mapa_viejo in pendientes:
            fresco = None
            if mapa_viejo and ahora - fallidos.get(inv["id"], 0) >= 10 * 60_000:
                try:
                    fresco = await asyncio.to_thread(MAPA.mapa, e, inv["id"])
                    fallidos.pop(inv["id"], None)
                except Exception:  # noqa: BLE001  choca con una escritura o un registro raro: se queda el guardado
                    traceback.print_exc()
                    fallidos[inv["id"]] = ahora
            elif mapa_viejo and METODO.vigente(inv.get("metodo")):
                continue  # el mapa espera su reintento y el tablero ya está al día: nada que escribir
            # Con su fecha: el indicador de nichos no lee un mapa sin fecha (lo trata
            # como no calculado), y la fecha se le pone al guardarlo, más abajo.
            mapa = {**fresco, "fecha": ahora} if fresco else guardado
            try:
                c = METODO.ultima_corrida(e, inv["id"])
                intervalos = self.almacen.intervalos_de_llamadas(c["id"]) if c else None
                instantes = self.almacen.instantes_de_actividad(int(c.get("empezadaEn") or 0), int(c.get("terminadaEn") or ahora)) if c else None
                tablero = METODO.tablero(e, inv["id"], ahora, corrida=c, intervalos_modelo=intervalos, instantes_actividad=instantes, mapa=mapa)
            except Exception:  # noqa: BLE001  una investigación rara no deja a las demás sin tablero
                traceback.print_exc()
                # Sin el registro, el tiempo queda en "sin datos" pero lo demás sale. Si
                # tampoco así, se le guarda un tablero vacío: sin él, esta función la
                # volvería a intentar en cada tick (cada 10 s) para siempre.
                try:
                    tablero = METODO.tablero(e, inv["id"], ahora, mapa=mapa)
                except Exception:  # noqa: BLE001
                    tablero = {"fecha": ahora, "iteracion": None, "corridaId": None, "reglas": METODO.VERSION_REGLAS, "indicadores": [], "avisos": []}
            rehechos[inv["id"]] = (fresco, tablero)

        def fn(e2: dict[str, Any]) -> bool:
            for inv_id, (fresco, tablero) in rehechos.items():
                inv2 = next((i for i in e2.get("investigaciones") or [] if isinstance(i, dict) and i.get("id") == inv_id), None)
                if inv2 is None:
                    continue
                if fresco is not None:
                    guardado_antes = inv2.get("mapaEnfermedad")
                    anterior: dict[str, Any] = guardado_antes if isinstance(guardado_antes, dict) else {}
                    # Misma forma que escribe el cierre (`_vistas_de_programa_al_cerrar`).
                    inv2["mapaEnfermedad"] = {**fresco, "fecha": ahora, "iteracion": anterior.get("iteracion"), "etiquetas": copy.deepcopy(MAPA.ETIQUETAS), "definiciones": {"estadio": dict(MAPA.DEFINICIONES_ESTADIO), "nivel": dict(MAPA.DEFINICIONES_NIVEL)}}
                METODO.fijar(e2, inv_id, tablero)
            return bool(rehechos)

        if rehechos:
            self.almacen.mutar(fn, "vistas_al_dia")

    async def _revisar_arnes(self, c: dict[str, Any]) -> None:
        """Meta-campaña (lo que rekursiv.ai llama auto-autoresearch, aquí con
        puerta): al terminar una corrida, el cerebro lee cómo rindió y propone
        hasta tres cambios del arnés. Un criterio entra como cambio de nivel 2
        propuesto y se evalúa solo contra las decisiones humanas
        (`_evaluar_cambio`): si empeora el acuerdo, `_fijar_evaluacion` lo revierte
        sin que nadie lo pida; si iguala o mejora, queda evaluado y lo promueve una
        persona (puerta "solo mejor o igual" en promover_aprendizaje). Una política
        queda registrada como nivel 3 para que la decida una persona. Los prompts no
        se tocan aquí."""
        e = self.almacen.estado
        inv = next((i for i in e["investigaciones"] if i["id"] == c["investigacionId"]), None)
        ahora = P.ahora_ms()
        if not inv:
            self.almacen.mutar(lambda e2: _quitar_marca_arnes(e2, c["id"]), "aprendizaje")
            return
        progreso = "\n".join(f"- iteración {p.get('iteracion')}: {p.get('peldanosSubidos', 0)} peldaños subidos, {p.get('peldanosBajados', 0)} bajados, {p.get('hechosNuevos', 0)} hechos nuevos, {p.get('hipotesisNuevas', 0)} hipótesis nuevas, fallidos {json.dumps(p.get('fallidos') or {}, ensure_ascii=False)}, {p.get('usdAcumulado', 0)} USD acumulados" for p in c.get("progreso") or []) or "Sin iteraciones cerradas"
        hallazgos: dict[str, int] = {}
        for it in e.get("iteraciones", []):
            if it.get("corridaId") == c["id"]:
                for hz in ((it.get("revisionRegistro") or {}).get("hallazgos") or []):
                    hallazgos[str(hz.get("clase", "otro"))] = hallazgos.get(str(hz.get("clase", "otro")), 0) + 1
        try:
            lecciones_txt = LEC.texto_de(LEC.recientes(e, inv["id"], maximo=12), maximo=12) or "Ninguna"
        except Exception:  # noqa: BLE001
            lecciones_txt = "Ninguna"
        # El tablero del método de la corrida que termina, recién calculado: el
        # revisor lee las cifras de la corrida entera, no las de su última iteración.
        try:
            tablero = METODO.tablero(e, inv["id"], ahora, corrida=c, intervalos_modelo=self.almacen.intervalos_de_llamadas(c["id"]), instantes_actividad=self.almacen.instantes_de_actividad(int(c.get("empezadaEn") or 0), int(c.get("terminadaEn") or ahora)))
        except Exception:  # noqa: BLE001  sin tablero, el revisor sigue con lo de siempre
            traceback.print_exc()
            tablero = None
        ctx = self._ctx(c)
        try:
            pred = await ctx.llamar(
                "cerebro",
                self.programas.revisar_arnes,
                objetivo=inv["objetivo"],
                metrica=f"{PROG.resumen_metrica(c.get('metrica')) or 'sin métrica'}. Detalle: {json.dumps(c.get('metrica') or {}, ensure_ascii=False)[:1500]}",
                progreso=progreso,
                lecciones=lecciones_txt,
                hallazgos_revisor="\n".join(f"- {k.replace('_', ' ')}: {v}" for k, v in sorted(hallazgos.items())) or "Ninguno",
                criterios_actuales="\n".join(e.get("criteriosRevision", [])) or "Ninguno",
                politicas_actuales=json.dumps(politicas.resumen(), ensure_ascii=False)[:1500],
                arnes=json.dumps(c.get("arnes") or {}, ensure_ascii=False),
                metodo=METODO.texto(tablero),
            )
            diagnostico = (getattr(pred, "diagnostico", "") or "").strip()
            propuestas = [{"tipo": getattr(p_, "tipo", ""), "descripcion": (getattr(p_, "descripcion", "") or "").strip(), "motivo": (getattr(p_, "motivo", "") or "").strip(), "riesgo": (getattr(p_, "riesgo", "") or "").strip()} for p_ in list(getattr(pred, "propuestas", []) or [])]
        except PASOS.PresupuestoAgotado:
            self.almacen.mutar(lambda e2: _quitar_marca_arnes(e2, c["id"], "sin presupuesto para la meta-campaña"), "aprendizaje")
            return
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            self.almacen.mutar(lambda e2: _quitar_marca_arnes(e2, c["id"], f"el cerebro no respondió: {str(ex)[:120]}"), "aprendizaje")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
            return

        def fn(e2: dict[str, Any]) -> bool:
            c2 = next((x for x in e2["corridas"] if x["id"] == c["id"]), None)
            if not c2:
                return False
            c2.pop("_revisarArnes", None)
            nuevos = cambios_desde_propuestas(e2, c2, propuestas, ahora)
            c2["revisionArnes"] = {"fecha": ahora, "diagnostico": diagnostico[:600], "propuestas": len(nuevos), "descartadas": len(propuestas) - len(nuevos), "avisosDelMetodo": list((tablero or {}).get("avisos") or [])}
            if tablero is not None:
                # El tablero con el que se decidió queda en la corrida (lo que había
                # cuando el revisor opinó) y el de la investigación se pone al día.
                c2["metodo"] = tablero
                METODO.fijar(e2, c2["investigacionId"], tablero)
            texto = f"Meta-campaña de la corrida {c2['numero']}: {diagnostico[:200]}" + (f" Propone {len(nuevos)} {'cambio' if len(nuevos) == 1 else 'cambios'} del arnés; los criterios se evalúan solos y una persona decide." if nuevos else " Sin cambios que proponer.")
            A.con_evento(e2, c2["investigacionId"], "aprendizaje", texto, "#/ajustes", ahora)
            return True

        self.almacen.mutar(fn, "aprendizaje")

    async def _reformular_por_persona(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """La persona pidió refinar: ROSA2018 reformula como versión nueva con su
        nota, y el Killer vuelve a juzgar la versión nueva."""
        nota = h.get("_reformularPedida") or "La persona pidió refinarla"
        texto_af, _ = T.afirmaciones_sostenidas(ctx.corrida().get("_afirmaciones", []))
        pista = ctx.pista(None, "modelo", f"Reformular a petición: {h['titulo'][:60]}", "GPT-6 Astra + Opus 5")
        conservar = False  # la petición se conserva si un modelo no respondió: se reformula cuando vuelva
        try:
            if not politicas.puede_reformular(h.get("version", 1)):
                # A petición de una persona no se descarta por agotar reformulaciones: se le dice.
                pista.cerrar(f"La hipótesis ya está en la versión {h.get('version', 1)} y la política no permite más reformulaciones automáticas; editala o duplicala a mano")
                self.almacen.mutar(lambda e2: (next((x for x in e2["hipotesis"] if x["id"] == h["id"]), {}).get("procedencia", {}).get("mensajes", []).append({"id": P.nuevo_id("m"), "de": "rosa", "texto": f"No se reformuló: versión {h.get('version', 1)}, tope de {politicas.MAX_REFORMULACIONES} reformulaciones. Nota de la persona: {nota[:200]}", "creadoEn": P.ahora_ms()}), True)[1], "reformular")
                return
            ok = await PASOS._reformular(ctx, h, f"Persona: {nota}", config.QUIEN_ROSA, pista)
            if ok:
                nueva = next((y for y in self.almacen.estado["hipotesis"] if y["id"] == h["id"]), None)
                if nueva:
                    await PASOS._killer(ctx, nueva, texto_af[:8000], pista, profundidad=1)
            pista.cerrar("Reformulada y revisada" if ok else "No se pudo reformular")
        except ModeloSinRespuesta as ex:
            conservar = True
            pista.fallar(f"Interrumpida: {nombre_del_modelo(getattr(ex, 'modelo', None), getattr(ex, 'rol', None))} no respondió; la petición sigue en pie y se reformula cuando vuelva")
            raise
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            pista.fallar(f"Fallo al reformular: {str(ex)[:160]}")
        finally:
            if not conservar:
                self.almacen.mutar(lambda e2: (next((x for x in e2["hipotesis"] if x["id"] == h["id"]), {}).pop("_reformularPedida", None), next((x for x in e2["hipotesis"] if x["id"] == h["id"]), {}).pop("_revisionPedida", None), True)[2], "reformular")

    async def _evaluar_cambio(self, cambio: dict[str, Any]) -> None:
        """Evaluación de un criterio propuesto (nivel 2) sobre el conjunto
        reservado: las hipótesis con decisión humana de aceptar o descartar.
        Se corre el Killer con y sin el criterio y se mide el acuerdo con
        la persona (avanzar = aceptar; descartar o reformular = descartar).
        La cifra va al registro; la promoción sigue siendo de la persona."""
        e = self.almacen.estado
        # Conjunto reservado: solo hipótesis con decisión de una PERSONA (registro de
        # decisiones, etapa persona), nunca las que descarto el propio Killer.
        con_persona = {d["hipotesisId"] for d in e.get("decisiones", []) if d.get("etapa") == "persona" and d.get("decision") in ("aceptada", "descartada")}
        reservado = [h for h in e["hipotesis"] if h["estado"] in ("aceptada", "descartada") and h["id"] in con_persona][:6]
        ahora = P.ahora_ms()
        if not reservado:
            self.almacen.mutar(lambda e2: _fijar_evaluacion(e2, cambio["id"], {"conjunto": "hipótesis con decisión humana", "casos": 0, "antes": None, "despues": None, "nota": "Sin conjunto reservado todavía: hacen falta hipótesis aceptadas o descartadas por una persona"}, ahora), "aprendizaje")
            return
        corrida = A.ultima_corrida_de(e, cambio.get("investigacionId") or reservado[0]["investigacionId"]) or A.ultima_corrida_de(e, reservado[0]["investigacionId"])
        if not corrida:
            return
        # Sin presupuesto en la corrida no hay cifra. Si la corrida sigue viva se
        # pausa y la marca `_evaluar` espera a que lo amplíen; si ya terminó o está
        # detenida nadie va a ampliarlo: la evaluación queda incompleta (el criterio
        # sigue propuesto y el botón de evaluar, disponible). Antes la excepción del
        # contador ponía una corrida terminada en "pausada por presupuesto" y se
        # volvía a intentar en cada tick.
        tope = tope_agotado_en(e, corrida["id"], corrida.get("iteracionActual"))
        if tope is not None:
            self._sin_presupuesto_para_evaluar(corrida, cambio, len(reservado), ahora, tope)
            return
        ctx = self._ctx(corrida)
        from rosa import killer as K

        async def acuerdo_con(criterios: list[str]) -> dict[str, Any]:
            """El acuerdo del Killer con la persona, hipótesis por hipótesis:
            `acuerdos` es un diccionario id -> True/False solo con las que el juez
            llegó a juzgar; `fallos` cuenta las que no respondió. Un fallo del juez
            no es un desacuerdo: antes contaba como tal y el registro medía cuántas
            veces se cayó el gateway (S-24)."""
            acuerdos: dict[str, bool] = {}
            fallos = 0
            for h in reservado:
                inv = next(i for i in e["investigaciones"] if i["id"] == h["investigacionId"])
                deterministas = K.comprobaciones_deterministas(h, e)
                try:
                    pred = await ctx.llamar("juez", self.programas.killer, objetivo=inv["objetivo"], mision=PASOS._texto_mision(inv), hipotesis=T.hipotesis_texto(h) + "\n" + K.texto_tarjeta(h) + "\n" + DI.texto_perfil(h.get("perfilDiana")), afirmaciones="\n".join(f"- [{a['veredicto']}, {a['tipo']}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]) or "Ninguna", supuestos="\n".join(f"- [{s['estado']}] {s['texto']}" for s in h["supuestos"]) or "Sin supuestos", modelo_de_mundo=T.modelo_de_mundo(e["hechos"], h["investigacionId"], maximo=30), comprobaciones_deterministas="\n".join(f"- {c['comprobacion']}: {c['resultado']}. {c['detalle']}" for c in deterministas), criterios_revision="\n".join(criterios))
                    comprobaciones = K.fusionar(deterministas, [{"comprobacion": c.comprobacion, "resultado": c.resultado, "detalle": c.detalle} for c in pred.revision.comprobaciones])
                    decision, _ = K.decidir(comprobaciones, bool((h.get("tarjeta") or {}).get("prediccionFalsable")), 1)
                except PresupuestoAgotado:
                    raise
                except Exception:  # noqa: BLE001
                    traceback.print_exc()
                    fallos += 1
                    continue
                humana = h["estado"] == "aceptada"
                acuerdos[h["id"]] = (decision == "avanzar") == humana
            return {"acuerdos": acuerdos, "fallos": fallos, "juzgadas": len(acuerdos)}

        casos = len(reservado)
        try:
            sin = [c for c in e["criteriosRevision"] if c != cambio["descripcion"]]
            r_antes = await acuerdo_con(sin)
            # Si la primera pasada ya tuvo fallos, la cifra no va a ser comparable:
            # no se gastan otras seis llamadas al juez en la segunda.
            if r_antes["fallos"]:
                evaluacion = {"conjunto": "hipótesis con decisión humana", "casos": casos, "juzgadas": r_antes["juzgadas"], "sinRespuesta": r_antes["fallos"], "antes": None, "despues": None, "nota": f"{r_antes['fallos']} de {casos} sin respuesta del juez en la pasada de referencia; la segunda pasada no se hizo. Vuelve a evaluar cuando el juez responda"}
            else:
                evaluacion = evaluacion_pareada(r_antes, await acuerdo_con(sin + [cambio["descripcion"]]), casos)
        except PresupuestoAgotado:
            self._sin_presupuesto_para_evaluar(corrida, cambio, casos, ahora, None)
            return
        except Exception as ex:  # noqa: BLE001
            evaluacion = {"conjunto": "hipótesis con decisión humana", "casos": casos, "juzgadas": 0, "sinRespuesta": casos, "antes": None, "despues": None, "nota": f"La evaluación falló: {str(ex)[:120]}"}
        self.almacen.mutar(lambda e2: _fijar_evaluacion(e2, cambio["id"], evaluacion, ahora), "aprendizaje")

    def _sin_presupuesto_para_evaluar(self, corrida: dict[str, Any], cambio: dict[str, Any], casos: int, ahora: int, tope: str | None) -> None:
        """Qué se hace con una evaluación de criterio que se queda sin presupuesto:
        con la corrida viva, pausarla (la marca `_evaluar` se queda para cuando lo
        amplíen); con la corrida detenida o terminada, dejar la evaluación como
        incompleta, con su nota, para no reintentarla en cada tick."""
        if corrida["estado"] in ("detenida", "terminada"):
            self.almacen.mutar(lambda e2: _fijar_evaluacion(e2, cambio["id"], _evaluacion_sin_presupuesto(corrida, casos), ahora), "aprendizaje")
        else:
            self.almacen.mutar(lambda e2: _pausar_por_presupuesto(e2, corrida["id"], tope), "presupuesto")

    def _promover_programa(self, cambio: dict[str, Any]) -> None:
        """Un programa optimizado por GEPA promovido por una persona pasa de
        `mlruns/candidatos/` a `mlruns/optimizados/` y se carga en el
        siguiente arranque. El anterior queda como `.anterior` para revertir."""
        import shutil

        nombre = cambio["origen"].split(":")[-1]
        origen = Path(config.RAIZ) / "mlruns" / "candidatos" / f"{nombre}.json"
        destino = Path(config.RAIZ) / "mlruns" / "optimizados" / f"{nombre}.json"
        nota = ""
        try:
            destino.parent.mkdir(parents=True, exist_ok=True)
            if destino.exists():
                shutil.copy(destino, destino.with_suffix(".json.anterior"))
            if origen.exists():
                shutil.copy(origen, destino)
                nota = f"Programa {nombre} promovido; se carga al reiniciar ROSA2018"
            else:
                nota = f"No se encontró el candidato {origen.name}; nada que promover"
        except Exception as ex:  # noqa: BLE001
            nota = f"No se pudo promover: {str(ex)[:120]}"

        def fn(e: dict[str, Any]) -> bool:
            c = next((x for x in e.get("aprendizaje", []) if x["id"] == cambio["id"]), None)
            if not c:
                return False
            c.pop("_promover", None)
            c["evaluacion"] = {**(c.get("evaluacion") or {"conjunto": "", "casos": 0, "antes": None, "despues": None}), "nota": nota}
            return True

        self.almacen.mutar(fn, "aprendizaje")

    async def _explicar_en_llano(self, ctx: Ctx, inv: dict[str, Any], resumen: str, hechos: list[dict], hipotesis: list[dict], sin_comprobar: list[dict], cola: str | None = None) -> dict[str, Any] | None:
        """El resumen de la iteración en lenguaje llano, con la estructura de los
        Plain Language Summary de Cochrane. Si el modelo falla, se queda sin
        resumen (la pantalla lo dice) y no se inventa nada.

        `hipotesis` son solo las nacidas en la iteración; `cola` es el listado
        por regla de toda la cola (título, estado, decisión del Killer con su
        motivo real y fecha de nacimiento). Antes el modelo solo veía las nuevas y
        escribía "quedan en cola dos hipótesis" cuando había nueve, con un motivo
        de suspensión inventado (S-16). La frase de recuento va aparte, en
        `colaPorRegla`, y el modelo no la toca."""
        e = self.almacen.estado
        c = ctx.corrida()
        propias = [h for h in e["hipotesis"] if h["investigacionId"] == inv["id"]]
        cola = cola if cola is not None else cola_de_hipotesis(e, inv["id"])
        frase_cola = frase_de_la_cola(e, inv["id"], len(hipotesis))
        conclusiones = []
        for h in propias:
            k = h.get("conclusion")
            if k:
                cambio = f" (antes: {k['cambio']['de']['certeza']}, {k['cambio']['de']['direccion']})" if k.get("cambio") else ""
                conclusiones.append(f"- {h['titulo']}: certeza {k['certeza']}, dirección {k['direccion']}{cambio}")
        afs = c.get("_afirmaciones", [])
        por_veredicto: dict[str, int] = {}
        for a in afs:
            if a["iteracion"] == ctx.numero:
                por_veredicto[a["veredicto"]] = por_veredicto.get(a["veredicto"], 0) + 1
        consultas = [q for q in c["busqueda"]["consultas"] if q.get("iteracion") == ctx.numero]
        it = ctx.iteracion() if ctx.iteracion_id else None
        fallidas = [p["titulo"] + ": " + p["resumen"] for p in (it["pistas"] if it else []) if p["estado"] == "fallida"]
        busqueda = "\n".join(f"- {q['base']}: {q['resultados']} resultados" for q in consultas) or "- Sin consultas nuevas"
        busqueda += "\nAfirmaciones verificadas en esta iteración: " + (", ".join(f"{v} {k}" for k, v in por_veredicto.items()) or "ninguna")
        busqueda += "\nFuentes que no respondieron: " + ("; ".join(fallidas) if fallidas else "ninguna")
        try:
            pred = await ctx.llamar(
                "cerebro",
                self.programas.en_llano,
                objetivo=inv["objetivo"],
                resumen_tecnico=resumen,
                hechos_nuevos="\n".join(f"- {h['enunciado']}" for h in hechos) or "Ninguno",
                hipotesis_nuevas="\n".join(f"- {h['titulo']}: {h['enunciado']} Para que sirve: {h['relevancia']['justificacion']}" for h in hipotesis) or "Ninguna",
                estado_hipotesis=estado_de_la_cola(e, inv["id"]),
                cola=cola,
                sin_comprobar="\n".join(f"- {x.get('texto') or x.get('titulo')}" for x in sin_comprobar) or "Nada",
                conclusiones="\n".join(conclusiones) or "Ninguna hipótesis todavía",
                busqueda=busqueda,
            )
            r = pred.resumen
            return {
                "colaPorRegla": frase_cola,
                "titulo": r.titulo.strip(),
                "mensajesClave": list(r.mensajes_clave)[:3],
                "queBuscaba": r.que_buscaba,
                "queHizo": r.que_hizo,
                "queEncontro": list(r.que_encontro),
                "limitaciones": r.limitaciones,
                "cambios": list(r.cambios),
                "quePropone": list(r.que_propone),
                "queFalta": r.que_falta,
                "queTeToca": r.que_te_toca,
                "alDia": {"fechaBusqueda": max((q["fecha"] for q in c["busqueda"]["consultas"]), default=None), "fuentesSinRespuesta": fallidas},
                "terminos": [{"termino": t.termino, "explicacion": t.explicacion} for t in r.terminos],
            }
        except (PresupuestoAgotado, ModeloSinRespuesta):
            raise  # el cierre pausa la corrida (o espera al modelo) y retoma el llano después (S-14)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return None

    async def _hipotesis_en_llano(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """El "En pocas palabras" de la hipótesis. Desde el 25 de septiembre de 2026 lo
        escribe el cerebro con lo que ROSA2018 ya investigó (su conclusión, el Killer,
        la viabilidad de la prueba, la revisión pendiente), y se reescribe cuando algo
        de eso cambia (`T.huella_llano`). Antes lo escribía Sonnet una sola vez al
        nacer la hipótesis, viendo solo el enunciado, y salía la idea aplanada hasta lo
        obvio y el trabajo de ROSA2018 pasado a "los investigadores"."""
        e = self.almacen.estado
        huella = T.huella_llano(e, h)
        try:
            pred = await ctx.llamar("cerebro", self.programas.hipotesis_en_llano, titulo=h["titulo"], enunciado=h["enunciado"], mecanismo=h["mecanismo"], prueba=T.prueba_de(h), lo_que_encontro=T.lo_que_encontro(e, h), relevancia=h["relevancia"]["justificacion"])
            texto = pred.explicacion.strip()
        except (PresupuestoAgotado, ModeloSinRespuesta):
            raise  # sin marcar la bandera: se reintenta cuando haya presupuesto o el modelo vuelva
        except Exception as ex:  # noqa: BLE001
            texto = ""
            traceback.print_exc()

        def fn(e: dict[str, Any]) -> bool:
            x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
            if not x:
                return False
            # Si el cerebro falló, se conserva el resumen anterior en vez de dejar la
            # hipótesis sin él: uno viejo es mejor que ninguno.
            x["enLlano"] = texto or x.get("enLlano") or None
            x["_enLlanoIntentado"] = huella
            return True

        self.almacen.mutar(fn, "en_llano")

    async def _nombre_corto(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """El nombre corto de la cabecera del documento controlado (norma
        AP-DOC-002), resumido del título. Solo para las hipótesis con dossier,
        que son las que se pueden emitir. Si el modelo falla o devuelve algo
        vacío o demasiado largo, queda sin nombre y lo escribe la persona al
        emitir: nunca se inventa uno recortando el título a ciegas."""
        from rosa import documento_controlado as DC

        try:
            pred = await ctx.llamar("volumen", self.programas.nombre_corto, titulo=h["titulo"])
            # Las palabras se cuentan antes de limpiar: la limpieza recorta a
            # MAX_NOMBRE caracteres y un nombre larguísimo saldría partido.
            nombre = DC.limpiar_nombre(pred.nombre) if len(str(pred.nombre or "").split()) <= 10 else ""
        except PresupuestoAgotado:
            # Sin presupuesto no se reintenta en cada tic: queda para que la persona
            # lo escriba al emitir.
            nombre = ""
        except ModeloSinRespuesta:
            raise  # el modelo volverá: se pide entonces
        except Exception:  # noqa: BLE001
            nombre = ""
            traceback.print_exc()

        def fn(e: dict[str, Any]) -> bool:
            x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
            if not x:
                return False
            x["nombreCorto"] = nombre or None
            x["_nombreCortoIntentado"] = True
            return True

        self.almacen.mutar(fn, "nombre_corto")

    async def _proponer_experimento(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """El experimento o análisis que comprobaría la hipótesis. Queda como
        `experimento` en estado 'propuesto'; la persona lo asigna a un
        laboratorio o registra los datos cuando llegan."""
        inv = next((i for i in self.almacen.estado["investigaciones"] if i["id"] == h["investigacionId"]), None)
        try:
            from rosa import killer as K
            from rosa import skills as SK

            # La misión (capacidades del laboratorio, conocimiento operativo) y la skill de
            # tamaño muestral entran al proponente: antes no las recibía y el n salía "no estimable".
            skills_exp = SK.para_texto(f"{h.get('titulo', '')} {h.get('enunciado', '')} experimento protocolo ensayo tamaño muestral potencia", contexto="mision")
            pred = await ctx.llamar(
                "cerebro",
                self.programas.experimento,
                hipotesis=T.hipotesis_texto(h) + "\n" + K.texto_tarjeta(h) + "\n" + DI.texto_perfil(h.get("perfilDiana")),
                afirmaciones="\n".join(f"- [{a['veredicto']}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]) or "Ninguna (hipótesis humana)",
                limites="; ".join(inv["limites"]) if inv and inv["limites"] else "Ninguno declarado",
                mision=PASOS._texto_mision(inv) if inv else "Sin misión aprobada",
                skills=SK.texto_para_prompt(skills_exp),
            )
            x = pred.experimento
            pasos = [p.strip().lstrip("0123456789.) ").strip() for p in x.protocolo if p.strip()]
            experimento = {
                "protocolo": "\n".join(f"{i + 1}. {p}" for i, p in enumerate(pasos)),
                "ensayo": x.ensayo.strip(),
                "confirma": x.resultado_que_confirma.strip(),
                "refuta": x.resultado_que_refuta.strip(),
                "controles": (x.controles or "").strip(),
                "tamanoMuestral": (x.tamano_muestral or "").strip(),
                "alternativa": (x.alternativa or "").strip(),
                "decisionQueCambia": (x.decision_que_cambia or "").strip(),
                "costeEstimado": x.coste_estimado.strip(),
                "laboratorio": None,
                "estado": "propuesto",
                "ficheroDatos": None,
                "analisisPedido": x.analisis_pedido.strip(),
            }
            # El contrato del experimento (rosa/experimento.py): lecturas separadas
            # (qué se mide, qué la confirma y qué la refuta), sistema experimental con
            # lo que no representa, propósito BEST del biomarcador, nivel del desenlace
            # y puente al beneficio. Una firma antigua sin esos campos deja los valores
            # vacíos y la lista de problemas lo dice; no rompe.
            _anadir_contrato(experimento, x)
        except (PresupuestoAgotado, ModeloSinRespuesta):
            raise  # sin marcar la bandera: se reintenta cuando haya presupuesto o el modelo vuelva
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            experimento = None

        def fn(e: dict[str, Any]) -> bool:
            y = next((z for z in e["hipotesis"] if z["id"] == h["id"]), None)
            if not y:
                return False
            y["_experimentoIntentado"] = True
            if experimento and not y.get("experimento"):
                y["experimento"] = experimento
                y["procedencia"]["registro"].append("experimento propuesto por ROSA2018 (protocolo, ensayo, controles, criterios, coste)")
                y["procedencia"]["registro"].append(_linea_contrato(experimento))
                A.recalcular_bloqueos(e, y)
            return True

        self.almacen.mutar(fn, "experimento")

    async def _concluir_hipotesis(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """La conclusión provisional de ROSA2018 sobre la hipótesis con lo que hay.
        La escribe el juez. Se rehace al cerrar una iteración solo si cambió la
        huella de la evidencia contada (`huella_de_conclusion`), que se guarda en
        `conclusion.huella`; la dirección la fija la regla (`direccion_por_regla`)
        y la del juez queda aparte en `direccionDelJuez`."""
        huella = huella_de_conclusion(h)
        try:
            pred = await ctx.llamar(
                "juez",
                self.programas.concluir,
                hipotesis=T.hipotesis_texto(h),
                afirmaciones="\n".join(f"- [{a['veredicto']}, {a['tipo']}, clase {a.get('clase', 'literatura')}{', SINTÉTICO: no cuenta como evidencia' if a.get('sintetico') else ''}{MARCA_RELACION.get(a.get('relacion'), '')}{', añadida en la iteración ' + str(a['iteracion']) if a.get('relacion') and a.get('iteracion') else ''}{', cohorte ' + a['cohorte'] if a.get('cohorte') else ''}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]) or "Ninguna",
                supuestos="\n".join(f"- [{s['estado']}] {s['texto']} ({s['evidencia']})" for s in h["supuestos"]) or "Sin supuestos evaluados",
                partidos="\n".join(f"- {p['resultado']} por {p['ejeDecisivo']}: {p['resumenDebate']}" for p in h["partidos"]) or "Sin partidos todavía",
                novedad="; ".join(f"{k}: {v['detalle']}" for k, v in h["novedad"].items()) + f". Cohortes distintas entre las fuentes: {len(PR.cohortes_de(h))}" + (f" ({', '.join(PR.cohortes_de(h))})" if PR.cohortes_de(h) else "") + ". " + SESGO.texto_para_grade(h["procedencia"]["fuentes"]),
                revisiones_humanas=T.revisiones_humanas(h) + (f"\nKiller: {h.get('decisionKiller')}" if h.get("decisionKiller") else ""),
                resultado_experimental=T.resultado_experimental(h),
                techo_por_regla=_texto_techo_por_regla(h),
            )
            c = pred.conclusion
            # La base se cuenta de forma determinista, no la estima el modelo. Lo
            # sintético no cuenta como evidencia.
            sostenidas = [a for a in h["afirmaciones"] if a["veredicto"] in ("sostenida", "parcial") and not a.get("sintetico")]
            fuentes = {f["referencia"] for f in h["procedencia"]["fuentes"]}
            anterior = h.get("conclusion")
            # El nivel del juez queda bajo el techo por regla (rosa/certeza.py): solo
            # literatura de una cohorte no pasa de muy baja; sin datos reales, de baja.
            factores = [{"factor": f.factor, "efecto": f.efecto, "explicacion": f.explicacion.strip()} for f in c.factores][:8]
            acotada = CERTEZA.acotar(c.certeza, h, factores)
            certeza_final = acotada["certeza"]
            # La dirección por regla (M-07): "mixta" o "en contra" solo con alguna
            # afirmación sostenida en contra o un resultado que refuta; lo que dijo el
            # juez se guarda aparte y, si discrepa, la frase lo dice.
            direccion_juez = str(getattr(c, "direccion", "") or "")
            direccion, supuesto_contradicho = direccion_por_regla(h, direccion_juez)
            cambio = None
            if anterior and (anterior.get("certeza") != certeza_final or anterior.get("direccion") != direccion):
                cambio = {"de": {"certeza": anterior.get("certeza"), "direccion": anterior.get("direccion"), "iteracion": anterior.get("iteracion")}, "motivo": (c.factores[0].explicacion.strip() if c.factores else "")}
            no_comprobado = [f"{k}: {v['detalle']}" for k, v in h["novedad"].items() if str(v.get("detalle", "")).startswith("No comprobado") and k != "agora"]
            consultas = ctx.corrida()["busqueda"]["consultas"]
            conclusion = {
                "certeza": certeza_final,
                "techo": acotada["techo"],
                "escalera": CERTEZA.escalera(h, certeza_final, factores),
                "direccion": direccion,
                "direccionDelJuez": direccion_juez,
                "hipotesisBreve": c.hipotesis_breve.strip(),
                "enunciado": frase_plantilla(direccion, certeza_final, c.hipotesis_breve.strip() or h["titulo"], supuesto_contradicho=supuesto_contradicho, indirectas=len(CERTEZA.apoyos_indirectos(h))),
                "conclusion": c.conclusion.strip(),
                "factores": factores,
                "base": {"afirmaciones": len(h["afirmaciones"]), "sostenidas": len(sostenidas), "fuentes": len(fuentes), "datos": sum(1 for a in sostenidas if a["tipo"] == "dato"), "interpretaciones": sum(1 for a in sostenidas if a["tipo"] == "interpretacion")},
                "aFavor": list(c.a_favor),
                "enContra": list(c.en_contra),
                "loMasFragil": c.lo_mas_fragil.strip(),
                "subiria": c.subiria.strip(),
                "bajaria": c.bajaria.strip(),
                "noComprobado": no_comprobado,
                "cambio": cambio,
                "fechaBusqueda": max((q["fecha"] for q in consultas), default=None),
                "fecha": P.ahora_ms(),
                "iteracion": ctx.numero,
                "huella": huella,
            }
        except (PresupuestoAgotado, ModeloSinRespuesta):
            raise  # sin marcar la bandera: se reintenta cuando haya presupuesto o el modelo vuelva
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            conclusion = None

        def fn(e: dict[str, Any]) -> bool:
            y = next((z for z in e["hipotesis"] if z["id"] == h["id"]), None)
            if not y:
                return False
            y["_conclusionIntentada"] = ctx.numero
            y.pop("_reconcluirPorRevisiones", None)
            if conclusion:
                y["conclusion"] = conclusion
                if conclusion.get("direccionDelJuez") and conclusion["direccionDelJuez"] != conclusion["direccion"]:
                    y["procedencia"]["registro"].append(f"iteración {ctx.numero}: el juez propuso dirección «{conclusion['direccionDelJuez']}» y la regla la dejó en «{conclusion['direccion']}» (mixta o en contra solo con alguna afirmación en contra)")
                # La ruta terapéutica se recalcula aquí porque es el momento en que
                # cambia la evidencia contada (rosa/ruta.py, por regla, sin modelo).
                y["ruta"] = _ruta_segura(e, y)
                # La conclusión rehecha atiende lo pendiente de revisar (propagación de
                # dependencias) y el peldaño siguiente de la escalera queda como cuestión.
                if y.get("pendienteRevision"):
                    DEP.atender_pendiente(e, "hipotesis", y["id"], config.QUIEN_ROSA, "conclusión rehecha con la evidencia actual", conclusion["fecha"])
                    A.recalcular_bloqueos(e, y)
                # La huella se fija aquí, sobre la hipótesis ya atendida: calculada antes
                # (con `pendienteRevision` todavía puesto) el siguiente cierre la veía
                # distinta y pagaba otra conclusión sin evidencia nueva.
                conclusion["huella"] = huella_de_conclusion(y)
                escalera = conclusion.get("escalera") or []
                if escalera and escalera[0].get("falta") and y["estado"] != "descartada":
                    CU.desde_escalera(e, y, escalera[0]["falta"], conclusion["fecha"])
                if conclusion.get("cambio"):
                    # Nivel 1 del aprendizaje: cambio lo que ROSA2018 cree de esta hipotesis. Automatico y registrado.
                    de = conclusion["cambio"]["de"]
                    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(y["investigacionId"], 1, "creencia", f"{y['titulo'][:80]}: de {de.get('certeza')}/{de.get('direccion')} a {conclusion['certeza']}/{conclusion['direccion']}. {conclusion['cambio']['motivo'][:160]}", f"hipotesis:{y['id']}", "aplicado", config.QUIEN_ROSA, conclusion["fecha"]))
            return True

        self.almacen.mutar(fn, "conclusion")

    async def _evaluar_resultado(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """Cierra el loop: los datos del laboratorio se comparan con los
        criterios congelados en el prerregistro, el veredicto entra como
        afirmación de tipo dato con su trayectoria, y la conclusión se rehace."""
        from rosa import datos as D

        from rosa.dossier import APRENDIZAJE_POR_RESULTADO

        h = copy.deepcopy(h)
        x = h["experimento"]
        # Identidad de la entrega y del contrato antes de cualquier await.
        contrato = {k: v for k, v in x.items() if k != "resultado"}
        ruta = D.ruta_de(h["id"], x.get("ficheroDatos") or "")
        ahora = P.ahora_ms()
        derivada_texto = None
        if ruta is None or not ruta.exists():
            resultado = {"veredicto": "no_evaluable", "clasificacion": "fallo_tecnico", "resultado": "No se encontró el fichero de datos en el servidor.", "motivo": f"Se registro el nombre '{x.get('ficheroDatos')}' pero el fichero no se subio. Sube el fichero desde la ficha.", "limitaciones": "", "cifras": [], "exploratorio": "", "fecha": ahora, "fichero": x.get("ficheroDatos")}
        cabecera = ""
        ilegible: str | None = None
        if ruta is not None and ruta.exists():
            try:
                resumen, muestra = await asyncio.to_thread(D.resumir, ruta)
            except Exception as ex:  # PDF corrupto, celda mayor que el limite de csv, fichero truncado
                # Un fichero que no se puede leer es "no pude comprobar", y hay que
                # DEJARLO DICHO: si la excepcion sube, `_resultadoEvaluado` no se
                # marca, el siguiente tick vuelve a esta misma hipotesis y hace
                # `return` antes de llegar a ninguna otra, asi que un solo fichero
                # ilegible congela el relleno de fondo entero (viabilidad,
                # conclusiones, resumen en llano, experimentos) para siempre.
                ilegible = f"{type(ex).__name__}: {ex}"[:300]
        if ilegible is not None:
            resultado = {"veredicto": "no_evaluable", "clasificacion": "fallo_tecnico", "resultado": "No se pudo leer el fichero de datos.", "motivo": f"El fichero '{x.get('ficheroDatos')}' está en el servidor pero no se pudo abrir ({ilegible}). Vuelve a exportarlo desde el instrumento y súbelo otra vez; si es un PDF, comprueba que abre en un lector.", "limitaciones": "", "cifras": [], "exploratorio": "", "fecha": ahora, "fichero": x.get("ficheroDatos")}
        elif ruta is not None and ruta.exists():
            cabecera = muestra.splitlines()[0] if muestra else ""
            # Los datos del laboratorio no salen al modelo fila a fila: el juez recibe el
            # resumen agregado y solo la cabecera de la muestra.
            muestra = cabecera + "\n[filas omitidas: los datos individuales del laboratorio no se envían al modelo; el veredicto se apoya en el resumen agregado]"
            try:
                pred = await ctx.llamar(
                    "juez",
                    self.programas.evaluar_resultado,
                    hipotesis=T.hipotesis_texto(h),
                    prerregistro=f"Protocolo:\n{x['protocolo']}\n\nEnsayo: {x['ensayo']}\n\nControles: {x.get('controles') or 'no declarados'}\nTamano muestral previsto: {x.get('tamanoMuestral') or 'no declarado'}\n\nCONFIRMA si: {x.get('confirma') or '(no separado; ver ensayo)'}\nREFUTA si: {x.get('refuta') or '(no separado; ver ensayo)'}\n\n" + A.texto_protocolo_real(x),
                    analisis_pedido=x.get("analisisPedido") or "Ninguno en particular: aplicar los criterios prerregistrados.",
                    resumen_datos=resumen,
                    muestra_datos=muestra,
                )
                r = pred.resultado
                dm = r.dimensiones
                resultado = {"veredicto": r.veredicto, "clasificacion": r.clasificacion, "dimensiones": {"falloTecnico": bool(dm.fallo_tecnico), "inconcluso": bool(dm.inconcluso), "efectoPequenoInterpretable": bool(dm.efecto_pequeno_interpretable), "efectoPredicho": bool(dm.efecto_predicho), "efectoInesperado": bool(dm.efecto_inesperado), "toxicidad": bool(dm.toxicidad), "nota": dm.nota.strip()}, "resultado": r.resultado.strip(), "motivo": r.motivo.strip(), "limitaciones": r.limitaciones.strip(), "cifras": [{"nombre": c.nombre, "valor": c.valor} for c in r.cifras][:12], "exploratorio": r.exploratorio.strip(), "fecha": ahora, "fichero": ruta.name}
                if r.clasificacion == "correccion_contexto" and r.contexto_corregido.strip():
                    try:
                        pd = await ctx.llamar("cerebro", self.programas.derivar, hipotesis=T.hipotesis_texto(h), resultado=f"{r.resultado} Contexto corregido: {r.contexto_corregido}")
                        derivada_texto = pd.derivada
                    except ModeloSinRespuesta:
                        raise
                    except Exception:  # noqa: BLE001
                        traceback.print_exc()
            except (PresupuestoAgotado, ModeloSinRespuesta):
                # Sin presupuesto o sin modelo no hay veredicto que escribir: el fichero
                # sigue registrado y la evaluación se reintenta después, sin marcar nada.
                raise
            except Exception as ex:  # noqa: BLE001
                traceback.print_exc()
                resultado = {"veredicto": "no_evaluable", "clasificacion": "fallo_tecnico", "resultado": "El juez no pudo evaluar los datos.", "motivo": str(ex)[:300], "limitaciones": "", "cifras": [], "exploratorio": "", "fecha": ahora, "fichero": ruta.name}
        clasificacion = resultado.get("clasificacion") or "inconcluso"
        resultado["accionTomada"] = APRENDIZAJE_POR_RESULTADO.get(clasificacion, "")
        # Datos de prueba (S-18): si el experimento va marcado como ensayo en seco o
        # sintético, la subida lo declaró, o el nombre o la cabecera del fichero dicen
        # "sintético", el resultado nunca cuenta como observación original.
        sintetico = es_resultado_sintetico(x, resultado.get("fichero"), cabecera)
        resultado["sintetico"] = sintetico
        # Veredicto por lectura (rosa/experimento.py): cada lectura del contrato se
        # juzga por regla con la cifra que la nombra; sin cifra es "no pude comprobar".
        # Si el juez no llegó a responder (fichero ausente, fallo), no hay nada que
        # juzgar: lista vacía y rama None con su explicación.
        juez_respondio = not (resultado["veredicto"] == "no_evaluable" and clasificacion == "fallo_tecnico" and not resultado.get("cifras"))
        vs = _veredictos_por_lectura(x, resultado) if juez_respondio else []
        resultado["veredictosPorLectura"] = vs
        resultado["lecturaDelNegativo"] = _lectura_del_negativo(vs)
        # Un resultado prueba la versión que se prerregistró; si la hipótesis cambió
        # después, se dice y la conclusión actual lo tiene en cuenta.
        version_probada = x.get("versionPrerregistrada") or h.get("version", 1)
        resultado["versionProbada"] = version_probada
        resultado["compatibleConActual"] = version_probada == h.get("version", 1)
        if not resultado["compatibleConActual"]:
            resultado["limitaciones"] = (resultado.get("limitaciones") or "") + f" El resultado probo la versión {version_probada}; la hipótesis está en la versión {h.get('version', 1)}: comprobar que la predicción sigue siendo la misma."
        quien = self.modelos.juez.model

        def fn(e: dict[str, Any]) -> bool:
            y = next((z for z in e["hipotesis"] if z["id"] == h["id"]), None)
            if not y or not y.get("experimento"):
                return False
            if y.get("_resultadoEvaluado") or y.get("version", 1) != h.get("version", 1) or {k: v for k, v in y["experimento"].items() if k != "resultado"} != contrato:
                return False  # Otra entrega o enmienda llegó mientras respondía el juez.
            y["experimento"]["resultado"] = resultado
            y["_resultadoEvaluado"] = True
            fecha_txt = datetime.fromtimestamp(ahora / 1000).strftime("%d/%m/%Y")
            af_lab: dict[str, Any] | None = None
            if clasificacion in ("apoyo_reproducido", "negativo_interpretable", "inconcluso", "correccion_contexto") and resultado["veredicto"] != "no_evaluable":
                cita = f"[Datos de prueba, SINTÉTICOS: {resultado['fichero']}, {fecha_txt}]" if sintetico else f"[Datos del laboratorio: {resultado['fichero']}, {fecha_txt}]"
                af_lab_id = P.nuevo_id("af")
                af_lab = {"afirmacionId": af_lab_id, "texto": resultado["resultado"], "cita": cita, "veredicto": "sostenida", "motivo": f"Cifra calculada de los datos {'de prueba (sintéticos, no cuentan como evidencia)' if sintetico else 'del laboratorio'} contra el prerregistro: {resultado['veredicto']} ({clasificacion.replace('_', ' ')}).", "entidadDistinta": False, "tipo": "dato", "clase": "observacion_original", "sintetico": sintetico, "trayectoria": {"id": resultado["fichero"], "celda": 0}, "fragmento": resultado["motivo"]}
                # La relación con ESTA hipótesis sale de la clasificación (25 de septiembre
                # de 2026). Sin ella, certeza.py la contaba como apoyo "de origen", y un
                # negativo del laboratorio subía la certeza. Un inconcluso no es evidencia
                # en ningún sentido, y una corrección de contexto apoya a la derivada, no a
                # esta: los dos quedan en el resultado del experimento, no en la evidencia.
                relacion = RELACION_LABORATORIO.get(clasificacion)
                if relacion:
                    y["afirmaciones"].append({**af_lab, "relacion": relacion})
                y["evidenciaEstadistica"] = "no_aplica" if sintetico else ("fuerte" if clasificacion == "apoyo_reproducido" else ("moderada" if clasificacion == "negativo_interpretable" else "debil"))
                # El resultado del laboratorio entra al modelo de mundo como hecho (la ficha lo
                # prometía y el registro no lo cumplía): frena una hipótesis nueva con la misma predicción.
                # Uno sintético nunca entra: al modelo de mundo solo llegan afirmaciones reales.
                if clasificacion in ("apoyo_reproducido", "negativo_interpretable") and not sintetico:
                    hecho = P.nuevo_hecho(y["investigacionId"], "hecho", "Resultado de laboratorio", f"{resultado['resultado'][:500]} (ensayo sobre «{y['titulo'][:60]}»: {resultado['veredicto']})", "sabido", "laboratorio", [{"fuenteId": None, "referencia": cita, "pagina": None}], ahora, prioridad=1, motivo=f"Resultado del laboratorio contra el prerregistro: {clasificacion.replace('_', ' ')}",
                                          afirmacion_ids=[af_lab_id], citas=[{"referencia": cita, "seccion": "datos del laboratorio", "clasificacion": "apoya" if clasificacion == "apoyo_reproducido" else "contrasta", "fragmento": (resultado.get("motivo") or "")[:300]}])
                    hecho["hipotesisIds"] = [y["id"]]
                    e["hechos"].append(hecho)
                    A.con_evento(e, y["investigacionId"], "hecho_nuevo", f"Hecho nuevo del laboratorio: {resultado['resultado'][:120]}", f"#/investigaciones/{y['investigacionId']}/mundo", ahora)
            # Que hace ROSA2018 con cada clase de resultado (taxonomia de retorno).
            if clasificacion == "fallo_tecnico":
                y["experimento"]["estado"] = "asignado"  # se puede repetir; la hipotesis no cambia
                y["experimento"]["ficheroDatos"] = None
            elif clasificacion == "toxicidad_inviabilidad":
                t = y.get("tarjeta") or P.tarjeta_vacia()
                t["riesgos"] = (t.get("riesgos") or []) + [f"Toxicidad o inviabilidad observada en el laboratorio ({fecha_txt}): {resultado['resultado'][:120]}"]
                y["tarjeta"] = t
                y["decisionKiller"] = "suspender"
                y["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "suspendida", "nota": "Toxicidad o inviabilidad: la vía de intervención se cierra en este contexto", "aCiegas": False})
            elif clasificacion == "negativo_interpretable":
                y["hallazgos"].append({"id": P.nuevo_id("hal"), "tipo": "valor_contradice_fuente", "resumen": "El laboratorio devolvió un negativo interpretable", "razonamiento": resultado["resultado"], "estado": "abierto", "respuestaDeRosa": None})
            elif clasificacion == "correccion_contexto":
                y["decisionKiller"] = "suspender"
                y["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "suspendida", "nota": "Corrección de contexto: el efecto aparece en otro contexto; se crea una hipótesis derivada", "aCiegas": False})
                if derivada_texto is not None:
                    d = derivada_texto
                    nueva = P.nueva_hipotesis(y["investigacionId"], ctx.numero, ahora, titulo=d.titulo.strip(), enunciado=d.enunciado.strip(), mecanismo=d.mecanismo.strip(), comprobacion={"biomarcador": d.biomarcador, "cohorte": d.cohorte, "diseno": d.diseno}, cluster=y["cluster"], derivadaDe=y["id"], relevancia={"justificacion": f"Derivada de '{y['titulo'][:60]}' por corrección de contexto del laboratorio: {d.que_cambio}", "votoHumano": None}, afirmaciones=[{**af_lab, "relacion": "apoya"}] if af_lab else [])
                    nueva["procedencia"] = P.procedencia_vacia(f"Hipótesis derivada por corrección de contexto tras el resultado del laboratorio del {fecha_txt}. {d.que_cambio}", ahora)
                    e["hipotesis"].append(nueva)
                    resultado["hipotesisDerivadaId"] = nueva["id"]
                    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(y["investigacionId"], 1, "hipotesis_derivada", f"Corrección de contexto: '{y['titulo'][:60]}' deriva en '{nueva['titulo'][:60]}'", f"resultado:{y['id']}", "aplicado", quien, ahora))
                    A.con_evento(e, y["investigacionId"], "hipotesis_nueva", f"Hipótesis derivada por corrección de contexto: {nueva['titulo'][:80]}", f"#/investigaciones/{y['investigacionId']}/hipotesis/{nueva['id']}", ahora)
            A.registrar_decision(e, y, "retorno", "avanzar" if clasificacion == "apoyo_reproducido" else ("suspender" if clasificacion in ("toxicidad_inviabilidad", "correccion_contexto") else ("reformular" if clasificacion == "negativo_interpretable" else "avanzar")), f"Retorno del laboratorio: {clasificacion.replace('_', ' ')}. {resultado['resultado'][:200]}", quien, ahora)
            e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(y["investigacionId"], 1, "creencia", f"Resultado del laboratorio ({clasificacion.replace('_', ' ')}) para '{y['titulo'][:60]}': {resultado['accionTomada'][:160]}", f"resultado:{y['id']}", "aplicado", quien, ahora))
            y["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"Datos del laboratorio evaluados contra el prerregistro: {resultado['veredicto']} ({clasificacion.replace('_', ' ')}). {resultado['resultado']} Que hace ROSA2018: {resultado['accionTomada']}", "creadoEn": ahora})
            y["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} datos {resultado['fichero']} evaluados: {resultado['veredicto']} / {clasificacion}" + (" (SINTÉTICOS: datos de prueba, no cuentan como evidencia ni entran al modelo de mundo)" if sintetico else ""))
            y.pop("_conclusionIntentada", None)
            A.recalcular_bloqueos(e, y)
            A.con_evento(e, h["investigacionId"], "revision_automatica", f"Datos del laboratorio evaluados ({clasificacion.replace('_', ' ')}): {h['titulo'][:80]}", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
            # El resultado del laboratorio toca los pasos de efecto funcional y de
            # selectividad y toxicidad de la ruta terapéutica: se recalcula.
            y["ruta"] = _ruta_segura(e, y)
            return True

        if self.almacen.mutar(fn, "resultado_experimento") is False:
            return
        y = next((z for z in self.almacen.estado["hipotesis"] if z["id"] == h["id"]), None)
        if y:
            await self._concluir_hipotesis(ctx, y)

    async def _completar_en_llano(self) -> None:
        """Rellena lo que falte: hipótesis sin versión en llano e iteraciones
        cerradas sin resumen en llano (las anteriores a esta función). Una
        cosa por tick, para no competir con la corrida. Si el presupuesto se
        agota a mitad, se deja para cuando lo amplien (sin marcar nada)."""
        try:
            await self._completar_en_llano_paso()
        except (PresupuestoAgotado, ModeloSinRespuesta):
            # Sin presupuesto, o el modelo no responde: el vigilante ya dejó la
            # incidencia y la espera en la corrida; el relleno se retoma después.
            return

    async def _completar_en_llano_paso(self) -> None:
        e = self.almacen.estado

        def _puede_gastar(corrida: dict[str, Any] | None) -> bool:
            # Rellenar en segundo plano gasta llamadas: no se hace sobre corridas que
            # una persona detuvo o pausó, sin presupuesto, ni mientras la corrida
            # espera a un modelo que no responde (ESTADOS_SIN_GASTO_DE_FONDO).
            return bool(corrida) and corrida["estado"] not in ESTADOS_SIN_GASTO_DE_FONDO

        for h in e["hipotesis"]:
            x = h.get("experimento")
            if x and x.get("estado") == "datos_recibidos" and not h.get("_resultadoEvaluado"):
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                # Los datos del laboratorio se evalúan aunque la corrida esté detenida o
                # pausada (la persona los subió), pero no sin presupuesto ni con el juez caído.
                if corrida and corrida["estado"] not in ("pausada_por_presupuesto", "esperando_modelo"):
                    await self._evaluar_resultado(self._ctx(corrida), h)
                    return
            # Orden: la viabilidad de la prueba y la conclusión antes que el resumen,
            # porque el resumen cuenta las dos y, escrito antes, habría que reescribirlo.
            if VIA.necesita(h):
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                if corrida is not None and _puede_gastar(corrida):
                    await VIA.asegurar(self._ctx(corrida), h, None, pedir_revision=True)
                    return
            if h.get("conclusion") is None and not h.get("_conclusionIntentada"):
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                if _puede_gastar(corrida):
                    await self._concluir_hipotesis(self._ctx(corrida), h)
                    return
            if h.get("estado") != "descartada" and h.get("_enLlanoIntentado") != T.huella_llano(e, h):
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                if corrida is not None and _puede_gastar(corrida):
                    await self._hipotesis_en_llano(self._ctx(corrida), h)
                    return
            if h.get("experimento") is None and not h.get("_experimentoIntentado") and h["estado"] != "descartada":
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                if _puede_gastar(corrida):
                    await self._proponer_experimento(self._ctx(corrida), h)
                    return
            if h.get("tarjeta") is None and not h.get("_tarjetaIntentada") and h["estado"] != "descartada":
                corrida = A.ultima_corrida_de(e, h["investigacionId"])
                if _puede_gastar(corrida):
                    await PASOS._completar_tarjeta(self._ctx(corrida), h, None)
                    return
        for inv in e["investigaciones"]:
            if inv.get("mision") is None and not inv.get("_misionIntentada"):
                corrida = A.ultima_corrida_de(e, inv["id"])
                if _puede_gastar(corrida):
                    await self._proponer_mision(self._ctx(corrida), inv)
                    return
        for it in e["iteraciones"]:
            if it["terminadaEn"] is not None and it["resumen"] and it.get("resumenLlano") is None and not it.get("_llanoIntentado"):
                c = next((x for x in e["corridas"] if x["id"] == it["corridaId"]), None)
                inv = next((i for i in e["investigaciones"] if c and i["id"] == c["investigacionId"]), None)
                if not c or not inv:
                    continue
                ctx = Ctx(self.almacen, self.programas, self.modelos, c["id"], inv["id"], it["id"], it["numero"])
                hechos = [h for h in e["hechos"] if h["investigacionId"] == inv["id"] and it["empezadaEn"] <= h["actualizadoEn"] <= it["terminadaEn"] and h["historial"] and h["historial"][0]["quien"] == config.QUIEN_ROSA]
                hip = PROG.hipotesis_nacidas_en(e, inv["id"], it, origen="rosa")
                llano = await self._explicar_en_llano(ctx, inv, it["resumen"], hechos, hip, [p for p in it["plan"] if p["estado"] in ("fallido", "omitido")])

                def fn(e2: dict[str, Any], it=it, llano=llano) -> bool:
                    x = next((y for y in e2["iteraciones"] if y["id"] == it["id"]), None)
                    if not x:
                        return False
                    x["_llanoIntentado"] = True
                    if llano:
                        x["resumenLlano"] = llano
                        _anadir_aprendizaje_al_llano(e2, it["corridaId"], x)
                    return True

                self.almacen.mutar(fn, "en_llano")
                return

    def _ctx(self, corrida: dict[str, Any]) -> Ctx:
        it = A.iteracion_actual_de(self.almacen.estado, corrida)
        return Ctx(self.almacen, self.programas, self.modelos, corrida["id"], corrida["investigacionId"], it["id"] if it else "", corrida["iteracionActual"])

    async def _aclarar(self, ctx: Ctx, h: dict[str, Any]) -> None:
        ultima = next((r for r in reversed(h["revisiones"]) if r["accion"] == "no_puedo_juzgar"), None)
        if not ultima:
            return
        try:
            pred = await ctx.llamar("cerebro", ctx.programas.aclarar, hipotesis=T.hipotesis_texto(h), nota=ultima["nota"], afirmaciones="\n".join(f"- [{a['veredicto']}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]))
        except ModeloSinRespuesta:
            raise  # la hipótesis sigue "aclarando": se aclara cuando el cerebro vuelva
        except Exception as ex:  # noqa: BLE001
            self.almacen.mutar(lambda e: A.aclarar_hipotesis(e, h["id"], f"No pude aclararla ahora: el modelo no respondió ({str(ex)[:100]}). Vuelve a la cola tal cual.", P.ahora_ms()), "aclarar")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
            return
        self.almacen.mutar(lambda e: A.aclarar_hipotesis(e, h["id"], pred.aclaracion, P.ahora_ms()), "aclarar")

    async def _responder_comentarios(self, ctx: Ctx, h: dict[str, Any]) -> None:
        comentarios = [m["texto"] for m in h["procedencia"]["mensajes"] if m["de"] == "investigadora"][-3:]
        ahora = P.ahora_ms()
        try:
            pred = await ctx.llamar("cerebro", ctx.programas.responder, hipotesis=T.hipotesis_texto(h), comentarios="\n\n".join(comentarios), afirmaciones="\n".join(f"- [{a['veredicto']}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]))
            respuesta, enunciado = pred.respuesta, pred.enunciado_revisado.strip()
        except ModeloSinRespuesta:
            raise  # los comentarios siguen marcados como nuevos: se responden cuando el cerebro vuelva
        except Exception as ex:  # noqa: BLE001
            respuesta, enunciado = f"No pude responder ahora: el modelo no respondió ({str(ex)[:100]}).", h["enunciado"]

        def fn(e: dict[str, Any]) -> bool:
            x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
            if not x:
                return False
            x.pop("_comentariosNuevos", None)
            x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "rosa", "texto": respuesta, "creadoEn": ahora})
            if enunciado and enunciado != x["enunciado"]:
                x["enunciado"] = enunciado
                x["revisiones"].append({"fecha": ahora, "quien": config.QUIEN_ROSA, "accion": "aclarada", "nota": "Enunciado revisado tras los comentarios", "aCiegas": False})
            return True

        self.almacen.mutar(fn, "responder_comentarios")

    async def _replicar_paso(self, ctx: Ctx, h: dict[str, Any]) -> None:
        """Una trayectoria de replicación: se vuelven a juzgar las afirmaciones
        de la hipótesis con el juez (temperatura alta) y se cuenta si el
        conjunto se sostiene.

        S-27 (revisión del 17 de septiembre de 2026): las citas se resuelven
        contra los fragmentos de TODAS las corridas de la investigación, no solo
        de la última (una hipótesis nacida en otra corrida daba "0 de 3
        trayectorias sostienen" sin haber leído nada), y una fuente registrada
        con otro id en otra corrida se reconoce como la misma obra (S-06) sin
        caer a la referencia corta, que cruza homónimas (S-04). La cita que no
        resuelve pero conserva el pasaje guardado al extraer se juzga sobre ese
        pasaje, marcada "no releída", con veredicto máximo parcial y sin poder
        contradecir: un veredicto negativo sobre 600 caracteres sin releer la
        fuente es "no pude comprobar" (cuenta en `noComprobables` y en
        `negativasSinReleer`), nunca una contradicción; solo lo releído
        contradice. La que no tiene ni fragmento ni pasaje no se puede
        comprobar: cuenta en `noComprobables`, nunca en `contradicen`. Una
        trayectoria en la que nada se pudo juzgar tampoco es una contradicción.
        La primera trayectoria deja en `replicacion.citas` cuántas resuelven,
        cuántas van sobre pasaje guardado y cuántas no se pueden comprobar, y
        lo dice en un mensaje."""
        from rosa import verificador as V

        e = self.almacen.estado
        frags = T.fragmentos_de_investigacion(e, h["investigacionId"])
        # Las copias conservan `fuenteId`: la cita se resuelve primero por el id de la
        # fuente y el localizador (S-04), después por los otros ids de la misma obra
        # en otras corridas (S-06); dos fuentes homónimas ya no se cruzan.
        copias, comprobables, guardados, citas = _preparar_copias_replica(h, frags, EV.ids_equivalentes_en_investigacion(e, h["investigacionId"]))
        trayectoria = int((h.get("replicacion") or {}).get("hechas") or 0)
        try:
            # Rol "replica": el juez a temperatura alta y sin caché, para que cada
            # trayectoria sea una lectura distinta; `rollout_id` la distingue además
            # en la clave de la caché de DSPy (S-20). El contexto de la réplica ve los
            # fragmentos de toda la investigación más los pasajes guardados.
            if comprobables:
                await PASOS.verificar_afirmaciones(_CtxReplica(ctx, frags + guardados), comprobables, None, h["enunciado"], rol="replica", rollout_id=trayectoria)
        except ModeloSinRespuesta:
            # El juez de réplica no respondió tras los reintentos del vigilante: la
            # trayectoria no se consume (antes caía aquí abajo y se apuntaba como "no
            # comprobable" con `hechas += 1`, gastando una de las tres sin haber
            # juzgado nada). Se vuelve a intentar entera cuando el modelo responda.
            raise
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        negativas_sin_releer = 0
        for a in comprobables:
            if a.get("noReleida"):
                # Sobre el pasaje guardado el juez puede decir que la afirmación se
                # sostiene, pero nadie releyó la fuente: el veredicto queda en parcial.
                a["veredictoJuez"] = a["veredicto"]
                if a["veredicto"] == "sostenida":
                    a["veredicto"] = "parcial"
                    a["motivo"] = "Sostenida sobre el pasaje guardado al extraer, sin releer la fuente (veredicto máximo parcial). " + str(a.get("motivo") or "")
                elif a["veredicto"] == "no_sostenida" or V.bloquea(a["veredicto"]):
                    # Un veredicto negativo sobre 600 caracteres tampoco vale sin releer:
                    # el NCT o la cifra que el determinista no encuentra estaban en otra
                    # frase de la misma página cuando la afirmación se juzgó sostenida
                    # al extraer. Una fuente que no se pudo releer es "no pude
                    # comprobar", nunca una contradicción: solo lo releído contradice.
                    a["veredicto"] = "sin_verificar"
                    a["noComprobable"] = True
                    a["motivo"] = "La fuente no se pudo releer y el pasaje guardado al extraer no basta para contradecir la afirmación: no comprobable, no cuenta como contradicción. " + str(a.get("motivo") or "")
                    negativas_sin_releer += 1
        juzgadas = [a for a in comprobables if a["veredicto"] in ("sostenida", "parcial", "no_sostenida")]
        apoyan = sum(1 for a in juzgadas if a["veredicto"] == "sostenida" or (a.get("noReleida") and a.get("veredictoJuez") == "sostenida"))
        bloqueantes = any(V.bloquea(a["veredicto"]) for a in comprobables)
        # None: nada se pudo juzgar (citas sin fragmento ni pasaje, veredictos
        # negativos sin releer, o el juez no respondió); True o False: el conjunto se
        # sostiene o no.
        resultado: bool | None = None if not juzgadas else (apoyan / len(juzgadas) >= 0.5 and not bloqueantes)
        no_releidas = sum(1 for a in comprobables if a.get("noReleida"))
        ahora = P.ahora_ms()

        def fn(e2: dict[str, Any]) -> bool:
            x = next((y for y in e2["hipotesis"] if y["id"] == h["id"]), None)
            if not x or not x["replicacion"] or x["replicacion"]["estado"] != "en_curso":
                return False
            r = x["replicacion"]
            r.setdefault("noComprobables", 0)
            r["hechas"] += 1
            if resultado is None:
                r["noComprobables"] += 1
            else:
                r["sostienen" if resultado else "contradicen"] += 1
            r.setdefault("trayectorias", []).append({"n": r["hechas"], "resultado": "no_comprobable" if resultado is None else ("sostiene" if resultado else "contradice"), "comprobadas": len(comprobables), "juzgadas": len(juzgadas), "apoyan": apoyan, "noReleidas": no_releidas, "noComprobables": len(copias) - len(comprobables) + negativas_sin_releer})
            if negativas_sin_releer:
                r["negativasSinReleer"] = int(r.get("negativasSinReleer") or 0) + negativas_sin_releer
            if trayectoria == 0:
                r["citas"] = dict(citas)
                x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": texto_citas_replica(citas), "creadoEn": ahora})
            if r["hechas"] >= r["total"]:
                r["estado"] = "terminada"
                texto = f"Replicación terminada: {r['sostienen']} de {r['total']} trayectorias sostienen las afirmaciones, {r['contradicen']} las contradicen y {r['noComprobables']} no se pudieron comprobar."
                if citas.get("guardadas"):
                    texto += f" {citas['guardadas']} {'cita se juzgó' if citas['guardadas'] == 1 else 'citas se juzgaron'} sobre el pasaje guardado al extraer, sin releer la fuente (veredicto máximo parcial)."
                if r.get("negativasSinReleer"):
                    n_neg = int(r["negativasSinReleer"])
                    texto += f" {n_neg} {'veredicto negativo' if n_neg == 1 else 'veredictos negativos'} sobre pasaje guardado no {'cuenta' if n_neg == 1 else 'cuentan'} como contradicción: sin releer la fuente solo se puede decir que no se pudo comprobar."
                x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": texto, "creadoEn": ahora})
            return True

        self.almacen.mutar(fn, "replicacion")

    async def _recomprobar_retracciones(self, inv: dict[str, Any]) -> None:
        ahora = P.ahora_ms()
        dois: dict[str, tuple[str | None, str]] = {}
        for h in self.almacen.estado["hipotesis"]:
            if h["investigacionId"] != inv["id"]:
                continue
            for f in h["procedencia"]["fuentes"]:
                if f.get("doi") and f["doi"] not in dois:
                    try:
                        dois[f["doi"]] = await crossref.marca_editorial(f["doi"])
                    except Exception as ex:  # noqa: BLE001  (un JSON raro de Crossref no debe dejar la bandera puesta para siempre)
                        dois[f["doi"]] = ("__error__", str(ex)[:100])
        cambios = 0
        afectadas: list[dict[str, Any]] = []

        def fn(e: dict[str, Any]) -> bool:
            nonlocal cambios
            i = next((x for x in e["investigaciones"] if x["id"] == inv["id"]), None)
            if i:
                i.pop("_recomprobarRetracciones", None)
            for h in e["hipotesis"]:
                if h["investigacionId"] != inv["id"]:
                    continue
                tocada = False
                for f in h["procedencia"]["fuentes"]:
                    r = dois.get(f.get("doi") or "")
                    if not r or r[0] == "__error__":
                        continue
                    if f["retraccion"] != r[0]:
                        cambios += 1
                        tocada = True
                        f["retraccion"] = r[0]
                        # Propagación de dependencias (rosa/dependencias.py): los hechos que
                        # citan la fuente, las hipótesis y sus planes quedan pendientes.
                        if r[0] in ("retractado", "corregido", "preocupacion"):
                            DEP.propagar_retraccion(e, inv["id"], f["id"], f.get("doi"), ahora, causa="fuente_retractada" if r[0] == "retractado" else "fuente_corregida")
                    f["retraccionComprobadaEn"] = ahora
                if tocada:
                    # Seguimiento de dependencias (plan completo, seccion 9): la fuente
                    # cambio, así que la conclusión que dependía de ella se marca para
                    # recalcular; la anterior se guarda para el informe de diferencias.
                    h["_conclusionAnterior"] = h.get("conclusion")
                    h.pop("_conclusionIntentada", None)
                    h["_recalcularPorFuente"] = ahora
                    A.recalcular_bloqueos(e, h)
                    afectadas.append({"id": h["id"], "titulo": h["titulo"]})
            A.con_evento(e, inv["id"], "retraccion", f"Retractaciones recomprobadas en {len(dois)} DOI: {cambios} cambios" + (f"; {len(afectadas)} hipótesis se recalculan" if afectadas else "") + (" (algunas consultas no llegaron)" if any(v[0] == '__error__' for v in dois.values()) else ""), None, ahora)
            return True

        self.almacen.mutar(fn, "retracciones")
        if afectadas:
            corrida = A.ultima_corrida_de(self.almacen.estado, inv["id"])
            if corrida:
                ctx = self._ctx(corrida)
                for a in afectadas:
                    y = next((z for z in self.almacen.estado["hipotesis"] if z["id"] == a["id"]), None)
                    if y:
                        await self._concluir_hipotesis(ctx, y)
                self._informe_de_diferencias(inv, [a["id"] for a in afectadas], "cambio de estado editorial de una fuente")

    def _informe_de_diferencias(self, inv: dict[str, Any], ids: list[str], causa: str) -> None:
        """El informe de diferencias del plan completo: que decía cada
        conclusión antes del cambio de fuente y que dice ahora. Los informes
        anteriores no se tocan: lo histórico sigue siendo histórico."""
        ahora = P.ahora_ms()

        def fn(e: dict[str, Any]) -> bool:
            L = [f"# Recálculo por {causa}", "", f"Fecha: {datetime.fromtimestamp(ahora / 1000).strftime('%d/%m/%Y %H:%M')}. Investigación: {inv['titulo']}.", ""]
            for hid in ids:
                h = next((z for z in e["hipotesis"] if z["id"] == hid), None)
                if not h:
                    continue
                antes = h.pop("_conclusionAnterior", None) or {}
                despues = h.get("conclusion") or {}
                h.pop("_recalcularPorFuente", None)
                L += [f"## {h['titulo']}", f"Antes: certeza {antes.get('certeza', 'sin conclusión')}, dirección {antes.get('direccion', '?')}. {antes.get('enunciado', '')}", f"Ahora: certeza {despues.get('certeza', 'sin conclusión')}, dirección {despues.get('direccion', '?')}. {despues.get('enunciado', '')}", f"Bloqueos ahora: {', '.join(h.get('bloqueos', [])) or 'ninguno'}", ""]
                if h.get("experimento") and h["experimento"].get("estado") in ("asignado", "en_curso"):
                    L.append("Experimento en marcha: el recálculo no lo cancela ni lo autoriza; decide una persona.")
                    L.append("")
            A.guardar_artefacto(e, inv["id"], f"Informe de diferencias: {causa}", "informe", "\n".join(L), f"{len(ids)} conclusiones recalculadas", (A.ultima_corrida_de(e, inv["id"]) or {}).get("iteracionActual", 0), ahora)
            A.con_evento(e, inv["id"], "dependencias", f"Informe de diferencias: {len(ids)} conclusiones recalculadas por {causa}", f"#/investigaciones/{inv['id']}/artefactos", ahora)
            return True

        self.almacen.mutar(fn, "informe_diferencias")

    # -- el bucle de una corrida --------------------------------------------

    async def correr_corrida(self, corrida_id: str) -> None:
        while not self._parar.is_set():
            e = self.almacen.estado
            c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
            if not c or c["estado"] in ("detenida", "terminada"):
                return
            if c["estado"] == "esperando_modelo":
                # Un modelo no responde: la tarea termina limpia. El supervisor sondea el
                # gateway desde el tic y relanza la corrida cuando vuelve (o antes, si la
                # persona pulsa "Reintentar ahora").
                return
            if c["estado"] in ("pausada", "pausada_por_presupuesto", "esperando_aprobacion"):
                await asyncio.sleep(1.0)
                continue
            it = A.iteracion_actual_de(e, c)
            if it is None or it["terminadaEn"] is not None:
                try:
                    await self._proponer_plan(c, it)
                except ModeloSinRespuesta as ex:
                    self.almacen.mutar(lambda e2: _entrar_en_esperando_modelo(e2, corrida_id, ex, None, P.ahora_ms()), "modelo_sin_respuesta")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                    return  # la tarea termina limpia: la relanza el sondeo, la persona o el tic (ver _ejecutar_paso)
                continue
            if not it["planAprobado"]:
                if c["estado"] != "esperando_plan":
                    self.almacen.mutar(lambda e2: _fijar_estado(e2, corrida_id, "esperando_plan"), "estado")
                await asyncio.sleep(1.0)
                continue
            if c["estado"] != "en_marcha":
                self.almacen.mutar(lambda e2: _fijar_estado(e2, corrida_id, "en_marcha"), "estado")
            paso = next((p for p in it["plan"] if p["estado"] in ("en_curso", "pendiente")), None)
            inv = next(i for i in e["investigaciones"] if i["id"] == c["investigacionId"])
            # La parada se mira ANTES de pedir permiso de gasto (B-02): si el tiempo o
            # las llamadas ya se cumplieron, no se abre una solicitud para una
            # iteración que va a cerrarse, y lo pendiente se omite con su motivo.
            motivo = _condicion_de_parada(inv["condicionParada"], it["numero"] - 1, self._con_reloj(c), mision=inv.get("mision"))
            if motivo and paso is not None:
                self.almacen.mutar(lambda e2: _omitir_pendientes(e2, it["id"], motivo), "parada")
            if paso is None or motivo:
                try:
                    await self._cerrar_con_presupuesto(c, it)
                except ModeloSinRespuesta as ex:
                    # El cierre guarda lo ya calculado en `it._cierre`: se retoma sin repagar.
                    self.almacen.mutar(lambda e2: _entrar_en_esperando_modelo(e2, corrida_id, ex, None, P.ahora_ms()), "modelo_sin_respuesta")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                    return
                continue
            if not await self._permiso_presupuesto(c, it):
                continue
            if await self._ejecutar_paso(c, it, paso):
                # Un modelo dejó de responder a mitad del paso: la tarea termina limpia.
                # Si la corrida quedó en `esperando_modelo`, la relanza el sondeo que
                # responda (o la persona con "Reintentar ahora"); si la persona la había
                # pausado mientras el paso corría, la pausa manda: el tic le da una tarea
                # nueva que duerme en la pausa y el paso pendiente se reintenta al reanudar.
                return

    async def _cerrar_con_presupuesto(self, c: dict[str, Any], it: dict[str, Any]) -> None:
        """`_cerrar_iteracion` con la misma puerta de presupuesto que los pasos y
        con el coste del cierre calculado ANTES de entrar (S-14):

        - Si lo que queda (el menor entre el tope de la corrida y el de la
          iteración) no llega a lo que el cierre necesita como mucho
          (`coste_estimado_del_cierre`), la corrida se pausa antes de empezarlo,
          con el desglose y cuánto hay que ampliar. Si no queda nada, no se
          pre-pausa: la primera llamada corta con su propio aviso, que ya dice
          qué tope saltó (S-15).
        - Si el tope salta dentro del cierre (conclusiones con Opus, acumulación
          de evidencia), la corrida se pausa con su evento, el aviso dice cuántas
          llamadas le faltaban al cierre y la iteración queda abierta para
          retomarlo al ampliar sin repagar lo ya calculado (`it._cierre`).

        Antes la excepción tumbaba la tarea y el tick la relanzaba cada 2 s con
        la corrida "en marcha"."""
        e = self.almacen.estado
        estimado = coste_estimado_del_cierre(e, c, it)
        restante = llamadas_restantes(e, c, it)
        if 0 < restante < estimado["total"]:
            motivo = motivo_de_pausa_por_cierre(c, it, estimado, restante)
            self.almacen.mutar(lambda e2: _pausar_por_presupuesto(e2, c["id"], motivo=motivo), "presupuesto")
            return
        try:
            await self._cerrar_iteracion(c, it)
        except PresupuestoAgotado:
            it_actual = next((x for x in self.almacen.estado["iteraciones"] if x["id"] == it["id"]), it)
            faltan = coste_estimado_del_cierre(self.almacen.estado, c, it_actual)
            self.almacen.mutar(lambda e2: _pausar_por_presupuesto(e2, c["id"], detalle=detalle_del_cierre(it, faltan)), "presupuesto")
        except PASOS.CorridaParada:
            # La persona detuvo o pausó a mitad del cierre. Lo ya calculado está
            # en `it._cierre` y se retoma sin repagar si se reanuda; la
            # iteración queda abierta, que es lo que la interfaz enseña. No se
            # pausa ni se cambia el estado: lo puso la persona y manda.
            return

    async def _proponer_mision(self, ctx: Ctx, inv: dict[str, Any]) -> None:
        """La misión estructurada (etapa 0 de ROSA2018) a partir del objetivo.
        Queda propuesta; la persona la aprueba (o la corrige) con el primer
        plan o desde Objetivo y datos."""
        try:
            pred = await ctx.llamar("cerebro", self.programas.mision, objetivo=inv["objetivo"], relevancia=inv["relevancia"] or "Sin definir", limites="; ".join(inv["limites"]) or "Ninguno", configuracion=T.configuracion(inv))
            m = pred.mision
            mision = {**P.mision_vacia(), "metaAmplia": inv["objetivo"], "poblacion": m.poblacion.strip(), "etapa": m.etapa.strip(), "celulaTejido": m.celula_tejido.strip(), "mecanismo": m.mecanismo.strip(), "tipoIntervencion": m.tipo_intervencion.strip(), "capacidadesLaboratorio": [c.strip() for c in m.capacidades_laboratorio if c.strip()][:6], "propuestaPorRosa": True}
            justificacion = m.justificacion.strip()
            # El planificador del programa: areas de investigación comparables, con
            # familias de mecanismo distintas y las que quedan sin explorar.
            try:
                from rosa import skills as SK

                guia = SK.texto_para_prompt(SK.para_texto("elección de problema misión áreas programa", contexto="mision"), maximo=2500)
                pa = await ctx.llamar("cerebro", self.programas.areas, meta_amplia=inv["objetivo"], mision=PASOS._texto_mision({"mision": mision}), modelo_de_mundo=T.modelo_de_mundo(self.almacen.estado["hechos"], inv["id"], maximo=30), limites=("; ".join(inv["limites"]) or "Ninguno") + "\n\nGuia de elección de problema (skill):\n" + guia)
                mision["areas"] = [P.nueva_area(titulo=a.titulo.strip(), familiaMecanismo=a.familia_mecanismo.strip(), relevancia=a.relevancia.strip(), valorIntervencion=a.valor_intervencion.strip(), incertidumbre=a.incertidumbre.strip(), comprobabilidad=a.comprobabilidad.strip(), coste=a.coste.strip(), demora=a.demora.strip(), dependeDe=a.depende_de.strip(), estado="elegida" if a.elegir else ("sin_explorar" if "sin ruta" in a.comprobabilidad.lower() else "propuesta")) for a in list(pa.areas)[:6]]
                if not any(a["estado"] == "elegida" for a in mision["areas"]) and mision["areas"]:
                    mision["areas"][0]["estado"] = "elegida"
            except ModeloSinRespuesta:
                raise
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        except ModeloSinRespuesta:
            raise  # la misión no se marca como intentada: se propone cuando el cerebro vuelva
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            mision, justificacion = None, str(ex)[:200]
        ahora = P.ahora_ms()

        def fn(e: dict[str, Any]) -> bool:
            i = next((x for x in e["investigaciones"] if x["id"] == inv["id"]), None)
            if not i:
                return False
            i["_misionIntentada"] = True
            if mision and i.get("mision") is None:
                mision["presupuesto"]["llamadas"] = (A.ultima_corrida_de(e, i["id"]) or {}).get("presupuesto", {}).get("limiteLlamadas", mision["presupuesto"]["llamadas"])
                i["mision"] = mision
                A.con_evento(e, i["id"], "mision", f"ROSA2018 propone la misión: {justificacion[:140]}. Apruebala o corrigela en Objetivo y datos.", f"#/investigaciones/{i['id']}/investigacion", ahora)
            return True

        self.almacen.mutar(fn, "mision")

    async def _formular_pregunta(self, ctx: Ctx, c: dict[str, Any], inv: dict[str, Any]) -> None:
        """La pregunta concreta de la campaña, con la plantilla del plan
        completo, desde la meta, la misión y el área elegida. Queda
        propuesta; se aprueba con el primer plan o se corrige en la corrida."""
        m = inv.get("mision") or {}
        elegida = next((a for a in m.get("areas", []) if a["estado"] == "elegida"), None)
        area = (f"{elegida['titulo']} ({elegida['familiaMecanismo']}). Relevancia: {elegida['relevancia']}. Comprobabilidad: {elegida['comprobabilidad']}. Coste: {elegida['coste']}. Demora: {elegida['demora']}." if elegida else f"Objetivo tal como lo escribio la persona: {inv['objetivo']}")
        try:
            pred = await ctx.llamar("cerebro", self.programas.pregunta, meta_amplia=m.get("metaAmplia") or inv["objetivo"], mision=PASOS._texto_mision(inv), area=area, modelo_de_mundo=T.modelo_de_mundo(self.almacen.estado["hechos"], inv["id"], maximo=30))
            q = pred.pregunta
            pregunta = {**P.pregunta_vacia(), "contexto": q.contexto.strip(), "etapa": q.etapa.strip(), "intervencion": q.intervencion.strip(), "comparador": q.comparador.strip(), "desenlace": q.desenlace.strip(), "ventana": q.ventana.strip(), "unidadBiologica": q.unidad_biologica.strip(), "mecanismos": q.mecanismos.strip(), "decision": q.decision.strip(), "umbralEfecto": q.umbral_efecto.strip(), "umbralResuelto": bool(q.umbral_resuelto) and "sin resolver" not in q.umbral_efecto.lower(), "pasoRuta": q.paso_ruta, "enunciado": q.enunciado.strip(), "propuestaPorRosa": True}
        except ModeloSinRespuesta:
            raise  # la pregunta no se marca como intentada: se formula cuando el cerebro vuelva
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            pregunta = None
        ahora = P.ahora_ms()

        def fn(e: dict[str, Any]) -> bool:
            c2 = next((x for x in e["corridas"] if x["id"] == c["id"]), None)
            if not c2:
                return False
            c2["_preguntaIntentada"] = True
            if pregunta and c2.get("pregunta") is None:
                c2["pregunta"] = pregunta
                A.con_evento(e, inv["id"], "corrida_estado", f"Pregunta de la corrida {c2['numero']}: {pregunta.get('enunciado', '')[:140]}", f"#/investigaciones/{inv['id']}/corrida", ahora)
            return True

        self.almacen.mutar(fn, "pregunta")

    async def _proponer_plan(self, c: dict[str, Any], anterior: dict[str, Any] | None) -> None:
        e = self.almacen.estado
        inv = next(i for i in e["investigaciones"] if i["id"] == c["investigacionId"])
        numero = (anterior["numero"] + 1) if anterior else 1
        motivo = _condicion_de_parada(inv["condicionParada"], numero - 1, self._con_reloj(c), mision=inv.get("mision")) if anterior else None
        if motivo:
            self.almacen.mutar(lambda e2: _terminar_corrida(e2, c["id"], motivo), "parada")
            return
        ctx = Ctx(self.almacen, self.programas, self.modelos, c["id"], inv["id"], anterior["id"] if anterior else "", numero)
        if inv.get("mision") is None and not inv.get("_misionIntentada"):
            await self._proponer_mision(ctx, inv)
            inv = next(i for i in self.almacen.estado["investigaciones"] if i["id"] == c["investigacionId"])
        if c.get("pregunta") is None and not c.get("_preguntaIntentada"):
            await self._formular_pregunta(ctx, c, inv)
        plan: list[dict[str, Any]] = []
        analisis_omitidos: list[str] = []
        # Cola de triaje: (tareaId, título del paso) de las que este plan programa, y
        # lo que el planificador explicó de las que deja fuera.
        programadas: list[tuple[str, str]] = []
        no_programadas: list[tuple[str, str]] = []
        try:
            pregunta = (c.get("pregunta") or {}).get("enunciado") or (next((x for x in self.almacen.estado["corridas"] if x["id"] == c["id"]), {}).get("pregunta") or {}).get("enunciado")
            mundo = await T.modelo_de_mundo_para(self.almacen, inv["id"], inv["objetivo"] + (f" {pregunta}" if pregunta else ""))
            # Traspaso ejecutable: de la iteración anterior, o de la corrida anterior si esta es la primera.
            traspaso = T.traspaso_iteracion(e, anterior, c) if anterior else T.traspaso_de_corrida(e, inv["id"])
            if not anterior:
                self.almacen.mutar(lambda e2, t=traspaso: _fijar_traspaso(e2, c["id"], t), "traspaso")
            lecciones = await LEC.para(self.almacen, inv["id"], ("plan", "fuentes", "consultas", "hipotesis", "analisis"), inv["objetivo"] + (f" {pregunta}" if pregunta else ""))
            pred = await ctx.llamar(
                "cerebro",
                self.programas.plan,
                objetivo=inv["objetivo"] + (f"\nPregunta de esta campaña: {pregunta}" if pregunta else ""),
                relevancia=inv["relevancia"],
                limites="; ".join(inv["limites"]) or "Ninguno declarado",
                condicion_parada=PARADA.texto_condicion(inv, c),
                modelo_de_mundo=mundo,
                resumen_iteracion_anterior=anterior["resumen"] if anterior else "",
                traspaso=traspaso,
                lecciones=lecciones,
                indicaciones_humanas=T.indicaciones_humanas(anterior, pendientes_solo=True) if anterior else "Ninguna.",
                hipotesis_vivas=T.hipotesis_vivas(e["hipotesis"], inv["id"]) + "\n" + T.vivero_texto(inv),
                # Registro de datasets del programa que coinciden con la pregunta (los de
                # acceso controlado con su aviso): sin este campo DSPy avisaba "Missing:
                # datasets_disponibles" y el planificador no veía los datos disponibles.
                datasets_disponibles=PASOS.datasets_para_plan(e, inv["id"], pregunta),
                numero_iteracion=numero,
                # La cola de triaje (rosa/tareas.py): trabajo que ROSA2018 misma pidió
                # abrir al ver algo que el plan anterior no cubría. El planificador
                # tiene que decidir sobre todas, programándolas o explicando por qué no.
                tareas_aceptadas=TA.texto_para_plan(e, inv["id"]),
            )
            hay_datos = any(d["estado"] == "aprobado" and (d.get("procedencia") or {}).get("hash") for d in inv.get("datasets", []))
            for p in list(pred.plan)[:7]:
                if p.tipo == "analisis" and not hay_datos:
                    # Sin datasets aprobados no hay nada que analizar; se dice en un evento en
                    # vez de borrar el paso en silencio (M-23).
                    analisis_omitidos.append((p.titulo or "Análisis in silico")[:80])
                    continue
                coste = COSTE_POR_TIPO.get(p.tipo, 20)
                if p.tipo == "literatura":
                    # La búsqueda en amplitud añade consultas al paso: su presupuesto crece con la fracción elegida.
                    coste = int(round(coste * (1 + politicas.AMPLITUD.get(PASOS.amplitud_de(inv), 0.0))))
                paso = P.nuevo_paso(p.titulo, p.detalle, coste, valor_decision=(p.valor_decision or "").strip(), espera=(getattr(p, "espera", "") or "").strip(), si_no_aparece=(getattr(p, "si_no_aparece", "") or "").strip())
                paso["tipo"] = p.tipo
                # `getattr` con valor por omisión: los arneses de test construyen
                # `PasoPropuesto` a mano y sin `tarea_id`.
                tarea_id = str(getattr(p, "tarea_id", "") or "").strip()
                if tarea_id and any(x.get("id") == tarea_id for x in TA.aceptadas(e, inv["id"])):
                    paso["tareaId"] = tarea_id
                    programadas.append((tarea_id, (p.titulo or "")[:120]))
                plan.append(paso)
            if hay_datos and not any(p.get("tipo") == "analisis" for p in plan) and (any(r["investigacionId"] == inv["id"] and r["estado"] == "pendiente" for r in e.get("reproducciones", [])) or any(h["investigacionId"] == inv["id"] and h.get("_analisisPedido") for h in e["hipotesis"])):
                paso = P.nuevo_paso("Análisis in silico", "Reproducciones pendientes de la puerta y análisis pedidos, en el sandbox", COSTE_POR_TIPO["analisis"])
                paso["tipo"] = "analisis"
                plan.append(paso)
            for x in list(getattr(pred, "tareas_no_programadas", None) or []):
                no_programadas.append((str(getattr(x, "tarea_id", "") or "").strip(), str(getattr(x, "motivo", "") or "").strip()))
            plan = _ordenar_plan(plan, hay_novedad_pendiente=any(h["investigacionId"] == inv["id"] and h["novedad"]["precedente"]["detalle"].startswith("No comprobado") for h in e["hipotesis"]))
        except PresupuestoAgotado:
            self.almacen.mutar(lambda e2: _pausar_por_presupuesto(e2, c["id"]), "presupuesto")
            return
        except ModeloSinRespuesta:
            raise  # el cerebro no responde: la corrida espera a Astra, no se le da un plan por defecto
        except Exception as ex:  # noqa: BLE001
            ctx.incidencia("modelo_bloqueado", "No se pudo proponer el plan con el modelo", str(ex)[:400], self.modelos.cerebro.model, "Se usa el plan por defecto de ROSA2018; se puede editar antes de aprobarlo.")
        if not plan:
            for titulo, detalle, tipo, pres in PLAN_POR_DEFECTO:
                coste = COSTE_POR_TIPO.get(tipo, pres)
                if tipo == "literatura":
                    coste = int(round(coste * (1 + politicas.AMPLITUD.get(PASOS.amplitud_de(inv), 0.0))))
                paso = P.nuevo_paso(titulo, detalle, coste)
                paso["tipo"] = tipo
                plan.append(paso)
        # Las indicaciones humanas pendientes de la iteración anterior pasan a la nueva.
        if anterior:
            for p in anterior["plan"]:
                if p["indicacionHumana"] and p["estado"] == "pendiente":
                    plan.insert(0, dict(p, id=P.nuevo_id("paso")))
        ahora = P.ahora_ms()
        # El tope de la iteración cuenta también el cierre (resumen, resumen en
        # llano, evidencia, conclusiones, revisor), que antes no estaba en ninguna
        # cifra y era lo que agotaba el tope a mitad (S-14).
        reserva_cierre = coste_previsto_del_cierre(self.almacen.estado, inv["id"])
        # La reserva queda aparte (`presupuesto.reservaCierre`, desde que nace la
        # iteración) para que la solicitud de gasto grande enseñe el coste del plan
        # y el del cierre por separado y la cifra se entienda.
        it = P.nueva_iteracion(c["id"], numero, ahora, plan, max(sum(p["presupuesto"] or 0 for p in plan), 20) + reserva_cierre, reserva_cierre=reserva_cierre)

        def fn(e2: dict[str, Any]) -> bool:
            c2 = next(x for x in e2["corridas"] if x["id"] == c["id"])
            if c2["estado"] in ("detenida", "terminada"):
                # Una persona la detuvo mientras el modelo proponía el plan: la orden
                # de detener manda y el plan se descarta. Antes esta escritura la
                # resucitaba a "esperando_plan" y quedaban dos corridas vivas sobre
                # la misma investigación (corridas 11 y 12, 17 de septiembre de 2026).
                return False
            if anterior:
                # La parada se reevalúa dentro de la mutación que crea la iteración
                # (B-02): la llamada del planificador dura de 110 a 136 s y el tope
                # de tiempo o de llamadas puede vencer mientras tanto; antes la
                # iteración condenada nacía igual y se cerraba vacía.
                inv2 = next((i for i in e2["investigaciones"] if i["id"] == inv["id"]), inv)
                motivo2 = _condicion_de_parada(inv2["condicionParada"], numero - 1, self._con_reloj(c2), mision=inv2.get("mision"))
                if motivo2:
                    return _terminar_corrida(e2, c["id"], motivo2)
            e2["iteraciones"].append(it)
            c2["iteracionActual"] = numero
            c2["estado"] = "esperando_plan"
            A.con_evento(e2, inv["id"], "corrida_estado", f"Plan de la iteración {numero} propuesto: {len(plan)} pasos. Espera tu aprobación.", f"#/investigaciones/{inv['id']}/corrida", ahora)
            for titulo in analisis_omitidos:
                A.con_evento(e2, inv["id"], "corrida_estado", f"El planificador proponía «{titulo}» y se dejó fuera del plan de la iteración {numero}: no hay ningún dataset aprobado con fichero en la investigación. Registra o aprueba un dataset en Objetivo y datos para que ROSA2018 pueda analizar.", f"#/investigaciones/{inv['id']}/investigacion", ahora)
            # Cola de triaje: las programadas pasan a "programada", las explicadas se
            # quedan en cola con el motivo en su historial, y a las que el planificador
            # ignoró se les escribe un motivo automático para que no quede hueco.
            explicadas = {tid for tid, _ in no_programadas if tid}
            for tid, titulo in programadas:
                TA.marcar(e2, tid, "programada", f"entra en el plan de la iteración {numero} como «{titulo}»", ahora)
            for tid, motivo in no_programadas:
                if tid and not any(tid == x for x, _ in programadas):
                    TA.marcar(e2, tid, "aceptada", f"el planificador no la programó en la iteración {numero}: {motivo or 'sin motivo escrito'}", ahora)
            for x in TA.aceptadas(e2, inv["id"]):
                if x["id"] not in explicadas and not any(x["id"] == tid for tid, _ in programadas):
                    TA.marcar(e2, x["id"], "aceptada", f"el planificador no la programó en la iteración {numero} ni dijo por qué", ahora)
            caducadas = TA.caducar_viejas(e2, inv["id"], numero, ahora)
            if caducadas:
                A.con_evento(e2, inv["id"], "aprendizaje", f"{caducadas} {'tarea' if caducadas == 1 else 'tareas'} de la cola de triaje caducaron sin que ningún plan las programara. Están en la cola, con su motivo.", f"#/investigaciones/{inv['id']}/investigacion", ahora)
            return True

        self.almacen.mutar(fn, "plan_propuesto")

    async def _permiso_presupuesto(self, c: dict[str, Any], it: dict[str, Any]) -> bool:
        """Si la iteración pide más de la mitad de lo que queda en la corrida y
        la autonomía dice 'preguntar', se pide permiso una vez por iteración."""
        e = self.almacen.estado
        if it.get("_presupuestoAutorizado"):
            return True
        restante = c["presupuesto"]["limiteLlamadas"] - c["gasto"]["llamadas"]
        pedido = it["presupuesto"]["limite"]
        if pedido <= restante * 0.5:
            return True
        if e["autonomia"].get("gastar_grande") == "actuar":
            # Regla de Emir (18 sep 2026): con el tope de la corrida como freno, el
            # gasto grande no se consulta; se avisa una vez por iteración y se sigue.
            if not it.get("_avisoGastoGrande"):
                ahora = P.ahora_ms()
                texto = f"La iteración {it['numero']} gastará hasta {pedido} llamadas de las {restante} que quedan (más de la mitad); ROSA2018 sigue sin preguntar porque la autonomía de gasto está en «actuar»"

                def avisar(e2: dict[str, Any]) -> bool:
                    it2 = next((x for x in e2["iteraciones"] if x["id"] == it["id"]), None)
                    if it2 is None or it2.get("_avisoGastoGrande"):
                        return False
                    it2["_avisoGastoGrande"] = True
                    A.con_evento(e2, c["investigacionId"], "presupuesto", texto, f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
                    return True

                self.almacen.mutar(avisar, "presupuesto")
            return True
        ya = next((s for s in e["solicitudes"] if s["corridaId"] == c["id"] and s["tipo"] == "presupuesto_grande" and s.get("_iteracionId") == it["id"]), None)
        if ya is None:
            ahora = P.ahora_ms()
            s = {"id": P.nuevo_id("sol"), "corridaId": c["id"], "tipo": "presupuesto_grande", "titulo": f"La iteración {it['numero']} quiere gastar {pedido} llamadas de las {restante} que quedan", "detalle": detalle_de_gasto_grande(it), "recurso": f"{pedido} llamadas al modelo", "alcances": ["una_vez", "esta_corrida"], "estado": "pendiente", "alcanceConcedido": None, "creadaEn": ahora, "resueltaEn": None, "hipotesisId": None, "argumentos": [{"nombre": "llamadas", "valor": str(pedido), "editable": True}], "_iteracionId": it["id"]}

            def fn(e2: dict[str, Any]) -> bool:
                e2["solicitudes"].append(s)
                c2 = next(x for x in e2["corridas"] if x["id"] == c["id"])
                c2["estado"] = "esperando_aprobacion"
                A.con_evento(e2, c["investigacionId"], "permiso_pendiente", s["titulo"], f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
                return True

            self.almacen.mutar(fn, "solicitud")
            return False
        if ya["estado"] == "pendiente":
            await asyncio.sleep(1.0)
            return False

        def resolver(e2: dict[str, Any]) -> bool:
            it2 = next(x for x in e2["iteraciones"] if x["id"] == it["id"])
            it2["_presupuestoAutorizado"] = True
            if ya["estado"] == "concedida":
                arg = next((a for a in ya["argumentos"] if a["nombre"] == "llamadas"), None)
                if arg and arg["valor"].isdigit():
                    it2["presupuesto"]["limite"] = int(arg["valor"])
                if ya["alcanceConcedido"] == "esta_corrida":
                    e2["autonomia"]["gastar_grande"] = e2["autonomia"]["gastar_grande"]  # el permiso queda registrado en `permisos`
            else:
                # Denegado: la iteración no puede gastar más de lo ya usado y la
                # corrida se pausa hasta que alguien amplie el tope o la reanude.
                it2["presupuesto"]["limite"] = it2["presupuesto"]["usado"]
                it2["_presupuestoDenegado"] = True
                c2 = next(x for x in e2["corridas"] if x["id"] == c["id"])
                c2["estado"] = "pausada_por_presupuesto"
                c2["presupuesto"]["motivoPausa"] = f"Permiso de gasto denegado: la iteración {it['numero']} queda sin presupuesto"
                A.con_evento(e2, c["investigacionId"], "presupuesto", f"Permiso de gasto denegado: la iteración {it['numero']} queda sin presupuesto y la corrida se pausó. Amplía el tope para seguir.", f"#/investigaciones/{c['investigacionId']}/corrida", P.ahora_ms())
            return True

        self.almacen.mutar(resolver, "presupuesto_autorizado")
        return ya["estado"] == "concedida"

    async def _ejecutar_paso(self, c: dict[str, Any], it: dict[str, Any], paso: dict[str, Any]) -> bool:
        """Ejecuta un paso del plan. Devuelve True solo si un modelo dejó de
        responder a mitad (`ModeloSinRespuesta`): el paso volvió a pendiente y la
        tarea de la corrida debe terminar limpia."""
        tipo = T.inferir_tipo_paso(paso)
        ctx = Ctx(self.almacen, self.programas, self.modelos, c["id"], c["investigacionId"], it["id"], it["numero"], de_paso=True)
        # Comprobaciones de cierre por etapa (Yoon y otros, 2026), sin modelo y sin
        # red: se mide el estado antes del paso, y la puerta de la cadena decide si la
        # etapa se abre. Los resultados de las etapas ya cerradas en esta iteración
        # salen del propio plan.
        antes = COMP.medir(self.almacen.estado, c["id"], c["investigacionId"])
        previos = {(p_.get("tipo") or T.inferir_tipo_paso(p_)): str((p_.get("comprobacion") or {}).get("resultado") or "") for p_ in it["plan"] if isinstance(p_, dict) and isinstance(p_.get("comprobacion"), dict)}
        cerrada = COMP.puede_abrir(tipo, antes, previos)
        if cerrada:
            self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "omitido", motivo=cerrada), "puerta_etapa")
            self.almacen.mutar(lambda e: _fijar_comprobacion(e, it["id"], paso["id"], COMP.comprobar(tipo, antes, antes, {**paso, "motivoFallo": cerrada}, None, "omitido")), "comprobacion_etapa")
            # Si el paso ejecutaba una tarea de la cola, la tarea NO se pierde: vuelve a
            # "aceptada" con el motivo, y la puede programar la iteración siguiente.
            if paso.get("tareaId"):
                self.almacen.mutar(lambda e: TA.marcar(e, str(paso["tareaId"]), "aceptada", f"su paso se omitió: {cerrada}", P.ahora_ms()), "tarea")
            return False
        self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "en_curso"), "paso")
        if tipo == "indicacion":
            # La indicacion humana entra como contexto de los pasos que siguen.
            self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "hecho", detalle=paso["detalle"]), "paso")
            return False
        ejecutor = PASOS.EJECUTORES.get(tipo)
        if ejecutor is None:
            self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "omitido", motivo=f"ROSA2018 no tiene herramienta para '{tipo}'"), "paso")
            return False
        sin_trabajo_cls = getattr(PASOS, "SinTrabajo", None)
        try:
            gepa = getattr(self.almacen, "gepa_servicio", None)
            resumen = await gepa.ejecutar_paso(ctx, ejecutor, paso) if gepa else await ejecutor(ctx, paso)
            it_actual = next(x for x in self.almacen.estado["iteraciones"] if x["id"] == it["id"])
            propias = [p for p in it_actual["pistas"] if p["pasoId"] == paso["id"]]
            todas_fallaron = bool(propias) and all(p["estado"] in ("fallida", "detenida") for p in propias)
            if todas_fallaron:
                self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "fallido", motivo="Ninguna de sus pistas terminó: " + "; ".join(p["resumen"] for p in propias)[:300]), "paso")
            elif paso_sin_trabajo(resumen, propias):
                # El paso corrió y no tenía nada sobre lo que trabajar (sin fuentes nuevas,
                # nada que verificar): no es "hecho" ni un fallo, y el motivo queda a la vista (M-23).
                self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "sin_trabajo", detalle=resumen, motivo=(resumen or "El paso no encontró nada sobre lo que trabajar")[:300]), "paso")
            else:
                self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "hecho", detalle=resumen), "paso")
        except PresupuestoAgotado:
            self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "pendiente"), "paso")
            self.almacen.mutar(lambda e: _pausar_por_presupuesto(e, c["id"]), "presupuesto")
        except PASOS.CorridaParada as ex:
            # La persona detuvo o pausó: el paso vuelve a pendiente (al reanudar se hace
            # entero; lo ya pagado queda en el estado) y sus pistas en curso se cierran
            # como "detenida" con el motivo. Ninguna llamada más.
            estado = ex.estado

            def parar(e: dict[str, Any]) -> bool:
                _estado_paso(e, it["id"], paso["id"], "pendiente")
                it2 = next((x for x in e["iteraciones"] if x["id"] == it["id"]), None)
                for p_ in (it2 or {}).get("pistas", []):
                    if p_.get("pasoId") == paso["id"] and p_.get("estado") == "en_curso":
                        p_["estado"] = "detenida"
                        p_["resumen"] = f"Interrumpida al quedar la corrida {estado.replace('_', ' ')}: no se hizo ninguna llamada más"
                return True

            self.almacen.mutar(parar, "corrida_parada")
            return True
        except ModeloSinRespuesta as ex:
            # El cerebro o el juez no responden tras los reintentos del vigilante: el
            # paso vuelve a pendiente (se retoma entero cuando el modelo vuelva), sus
            # pistas en curso se cierran con el motivo y la corrida pasa a
            # `esperando_modelo`. Nunca se degrada el rol a otro modelo (TRASPASO.md 7.4).
            ahora = P.ahora_ms()
            nombre = nombre_del_modelo(getattr(ex, "modelo", None), getattr(ex, "rol", None))

            def esperar(e: dict[str, Any]) -> bool:
                _estado_paso(e, it["id"], paso["id"], "pendiente")
                it2 = next((x for x in e["iteraciones"] if x["id"] == it["id"]), None)
                for p_ in (it2 or {}).get("pistas", []):
                    if p_.get("pasoId") == paso["id"] and p_.get("estado") == "en_curso":
                        p_["estado"] = "fallida"
                        p_["resumen"] = f"Interrumpida: {nombre} no respondió; el paso se retoma cuando vuelva"
                _entrar_en_esperando_modelo(e, c["id"], ex, paso["id"], ahora)  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                return True

            self.almacen.mutar(esperar, "modelo_sin_respuesta")
            return True
        except asyncio.CancelledError:
            raise
        except Exception as ex:  # noqa: BLE001
            if sin_trabajo_cls is not None and isinstance(ex, sin_trabajo_cls):
                motivo_sin = str(ex)[:300] or "El paso no encontró nada sobre lo que trabajar"
                self.almacen.mutar(lambda e: _estado_paso(e, it["id"], paso["id"], "sin_trabajo", detalle=motivo_sin, motivo=motivo_sin), "paso")
                return False
            traceback.print_exc()

            def fallar_paso(e: dict[str, Any]) -> bool:
                _estado_paso(e, it["id"], paso["id"], "fallido", motivo=f"{type(ex).__name__}: {str(ex)[:200]}")  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                it2 = next((x for x in e["iteraciones"] if x["id"] == it["id"]), None)
                # Las pistas del paso que quedaron en curso no pueden seguir "en curso" para siempre.
                for p_ in (it2 or {}).get("pistas", []):
                    if p_.get("pasoId") == paso["id"] and p_.get("estado") == "en_curso":
                        p_["estado"] = "fallida"
                        p_["resumen"] = f"Interrumpida por un fallo del paso: {type(ex).__name__}"  # noqa: F821  se ejecuta dentro del except, con `ex` vivo
                return True

            self.almacen.mutar(fallar_paso, "paso")
        # La comprobación de cierre de la etapa, en un solo sitio para todos los
        # finales: el estado ya escrito manda (sin_trabajo es sin_materia por
        # definición, fallido es no_comprobable), y un paso que volvió a pendiente
        # (presupuesto, parada, modelo que no responde) no cerró ninguna etapa y no se
        # comprueba. Cuesta cero llamadas.
        it_fin = next((x for x in self.almacen.estado["iteraciones"] if x["id"] == it["id"]), None)
        paso_fin = next((p_ for p_ in (it_fin or {}).get("plan", []) if isinstance(p_, dict) and p_.get("id") == paso["id"]), None)
        if paso_fin is not None:
            comp = COMP.comprobar(tipo, antes, COMP.medir(self.almacen.estado, c["id"], c["investigacionId"]), paso_fin, paso_fin.get("detalle"), str(paso_fin.get("estado") or ""))
            if comp:
                self.almacen.mutar(lambda e: _fijar_comprobacion(e, it["id"], paso["id"], comp), "comprobacion_etapa")
            # La misma comprobación, ya calculada, alimenta las tareas por regla: si
            # ROSA2018 tuviera dos definiciones de "el paso no produjo nada" se
            # contradeciría en la interfaz. Cero llamadas al modelo.
            ahora_t = P.ahora_ms()
            estado_fin = str(paso_fin.get("estado") or "")

            def cerrar_tarea(e: dict[str, Any]) -> bool:
                if paso.get("tareaId"):
                    if estado_fin == "hecho":
                        TA.marcar(e, str(paso["tareaId"]), "hecha", f"la hizo el paso «{str(paso.get('titulo') or '')[:90]}»: {str(paso_fin.get('detalle') or '')[:160]}", ahora_t)
                    else:
                        TA.marcar(e, str(paso["tareaId"]), "aceptada", f"su paso quedó {estado_fin}: {str(paso_fin.get('motivoFallo') or 'sin motivo registrado')[:160]}", ahora_t)
                c2 = next((x for x in e["corridas"] if x["id"] == c["id"]), None) or {}
                aceptadas_ya = sum(1 for x in (e.get("tareas") or []) if isinstance(x, dict) and x.get("investigacionId") == c["investigacionId"] and (x.get("origen") or {}).get("iteracion") == it["numero"] and x.get("estado") in ("aceptada", "programada"))
                for t_ in TA.por_regla_al_terminar_paso(e, c2, paso_fin, comp, it["numero"], ahora_t):
                    estado_t, _ = TA.registrar_con_motivo(e, t_, ahora_t, aceptadas_ya=aceptadas_ya)
                    if estado_t == "aceptada":
                        aceptadas_ya += 1
                return True

            self.almacen.mutar(cerrar_tarea, "tareas")
        return False

    async def _revisar_registro(self, ctx: Ctx, inv: dict[str, Any], it: dict[str, Any], c: dict[str, Any], resumen: str, llano: dict[str, Any] | None) -> dict[str, Any]:
        e = self.almacen.estado
        # El texto revisable entero, con las listas del llano incluidas: antes se unían
        # solo los campos de texto y quedaban fuera `mensajesClave`, `queEncontro`,
        # `cambios` y `quePropone`, que es lo primero que lee la médica (caza del 23 de
        # septiembre). Medido sobre las 33 revisiones guardadas: la mediana pasa de
        # 2.419 a 4.173 caracteres y el máximo de 3.756 a 6.517, así que el corte sube
        # de 6.000 a 12.000 y ninguna se recorta. Son unos 440 tokens de entrada más.
        texto = RR.texto_revisable(resumen, llano)
        corpus = RR.corpus_del_registro(e, inv["id"], it, c)
        runs_ok = sum(1 for r in e.get("ejecuciones", []) if r.get("estado") == "completado" and r.get("investigacionId") == inv["id"])
        de_la_iteracion = PROG.hipotesis_nacidas_en(e, inv["id"], it, ahora=P.ahora_ms())
        regla = RR.comprobaciones_deterministas(texto, corpus, it, runs_ok, hipotesis=de_la_iteracion)
        hallazgos = list(regla)
        juez = None
        propuestas: list[dict[str, Any]] = []
        try:
            # Sus herramientas (calcular, leer_afirmacion, leer_ejecucion) leen este
            # registro y no otro, aunque cierren dos iteraciones a la vez.
            with RR.en_revision(e, inv["id"], it, c):
                pred = await ctx.llamar("juez", self.programas.revisar_registro, texto=texto[:CORTE_TEXTO_REVISABLE], registro=RR.texto_registro(e, inv["id"], it, c), hallazgos_por_regla="\n".join(f"- {h['clase']}: {h['detalle']}" for h in regla) or "Ninguno")
            juez = ctx.modelos.juez.model
            for hz in pred.revision.hallazgos:
                hallazgos.append({"clase": hz.clase, "gravedad": hz.gravedad, "detalle": hz.detalle.strip()[:400], "origen": "juez"})
            resumen_j = pred.revision.resumen.strip()
            # Las tareas que el juez propone al revisar se DEVUELVEN, no se escriben
            # aquí: el bucle de reparación puede rechazar una vuelta y volver al texto
            # anterior, y unas tareas ya escritas sobrevivirían a una vuelta rechazada.
            # Las registra `_cerrar_iteracion` dentro de su propia mutación.
            propuestas = [{"queVio": x.que_vio, "queHaria": x.que_haria, "porQue": x.por_que, "herramienta": x.herramienta} for x in (getattr(pred.revision, "tareas", None) or [])]
        except (PresupuestoAgotado, ModeloSinRespuesta):
            # El cierre pausa la corrida (o espera al juez): una iteración no se cierra
            # sin revisor por falta de presupuesto ni porque Opus no responda (se
            # espera el tiempo que haga falta, TRASPASO.md 7.4).
            raise
        except Exception as ex:  # noqa: BLE001
            resumen_j = f"El juez no respondió: {str(ex)[:120]}; solo comprobaciones por regla"
        for i, hz in enumerate(hallazgos):
            hz["id"] = f"rr-{it['id']}-{i}"
            hz["estado"] = "abierto"
        return {"hallazgos": hallazgos, "porRegla": len(regla), "juez": juez, "resumen": resumen_j, "fecha": P.ahora_ms(), "estado": "con_hallazgos" if hallazgos else "limpia", "_tareas": propuestas}

    async def _reparar_resumen(self, ctx: Ctx, inv: dict[str, Any], it: dict[str, Any], c: dict[str, Any], resumen: str, llano: dict[str, Any] | None, revision: dict[str, Any]) -> dict[str, Any] | None:
        """El bucle de revisión: el revisor devuelve el trabajo y quien lo escribió lo
        rehace o lo rebate, y el revisor comprueba el arreglo.

        Hasta el 25 de septiembre de 2026 los hallazgos se escribían y ahí se quedaban:
        170 hallazgos en 33 iteraciones, los 170 abiertos, ninguno atendido nunca. En
        Yoon y otros (2026) el supervisor devuelve el trabajo al worker y 49 de 119
        tareas se revisaron al menos una vez; medida sobre el estado real, la puerta de
        entrada de aquí dispara en 15 de 33 iteraciones (45 %), casi la misma tasa.

        Quién hace qué. Rehace el CEREBRO (GPT-6 Astra), que es quien escribió el
        resumen y el llano; comprueba el JUEZ (Opus 5) con sus tres herramientas de
        solo lectura. Si el juez reescribiera, corregiría su propia nota. Sonnet no
        entra en ninguno de los dos papeles (TRASPASO.md 7.4).

        Devuelve {"resumen", "llano", "revision", "vueltas"} o None si no hubo vuelta.
        Es lo único del cierre que NO pausa la corrida cuando falta presupuesto o el
        modelo no responde: los hallazgos abiertos ya retienen la publicación, así que
        nada se cuela, y pausar una corrida entera después de haberlo pagado todo para
        pulir un resumen sale peor. No se cambia de modelo: no hacer una pasada
        opcional no es degradar el rol."""
        graves = [h for h in revision["hallazgos"] if h.get("gravedad") == "alta" and h.get("estado") == "abierto" and h.get("reparablePorTexto") is not False]
        if not graves:
            return None
        registro = RR.texto_registro(self.almacen.estado, inv["id"], it, c)
        corpus = RR.corpus_del_registro(self.almacen.estado, inv["id"], it, c)
        runs_ok = sum(1 for r in self.almacen.estado.get("ejecuciones", []) if r.get("estado") == "completado" and r.get("investigacionId") == inv["id"])
        pendientes = list(revision["hallazgos"])
        texto_actual, resumen_actual, llano_actual = RR.texto_revisable(resumen, llano), resumen, llano
        # La base del tercer candado: las reglas corridas sobre el texto ACTUAL, con la
        # misma función que se correrá sobre el rehecho. No vale el peso de los
        # hallazgos de regla de la revisión: esos vienen filtrados y, si todos los
        # hallazgos eran del juez, la base sería cero y cualquier vuelta se rechazaría.
        def _peso_de(texto: str) -> int:
            return RR.peso_hallazgos(RR.comprobaciones_deterministas(texto, corpus, it, runs_ok, hipotesis=PROG.hipotesis_nacidas_en(self.almacen.estado, inv["id"], it, ahora=P.ahora_ms())))

        peso_reglas = _peso_de(texto_actual)
        vueltas: list[dict[str, Any]] = []
        for vuelta in range(1, F.MAX_VUELTAS_REPARACION + 1):
            abiertos = [h for h in pendientes if h.get("estado") in ("abierto", "rebatido") and h.get("reparablePorTexto") is not False]
            if not any(h.get("gravedad") == "alta" for h in abiertos):
                break
            try:
                rehecho = await ctx.llamar(
                    "cerebro", self.programas.rehacer_resumen,
                    hallazgos="\n".join(f"- [{h['id']}] {h['clase']} ({h['gravedad']}, {h.get('origen')}): {h['detalle']}" for h in abiertos),
                    resumen=resumen_actual, llano=RR.texto_revisable("", llano_actual) or "Ninguno", registro=registro,
                )
            except (PresupuestoAgotado, ModeloSinRespuesta) as ex:
                vueltas.append({"vuelta": vuelta, "estado": "no_hecha", "motivo": f"No se pudo rehacer el resumen: {type(ex).__name__}. Los hallazgos siguen abiertos y retienen la publicación"})
                break
            except Exception as ex:  # noqa: BLE001
                traceback.print_exc()
                vueltas.append({"vuelta": vuelta, "estado": "no_hecha", "motivo": f"El cerebro no rehizo el resumen: {str(ex)[:140]}"})
                break
            nuevo_resumen = str(getattr(rehecho.rehecho, "resumen", "") or "").strip() or resumen_actual
            nuevo_llano = _llano_rehecho(getattr(rehecho.rehecho, "llano", None), llano_actual)
            nuevo_texto = RR.texto_revisable(nuevo_resumen, nuevo_llano)
            # CANDADO 3, y es gratis: el arreglo no puede empeorar. Las reglas se
            # vuelven a correr enteras sobre el texto nuevo; si pesan más que sobre el
            # viejo, la vuelta se rechaza y se vuelve al texto anterior.
            reglas_nuevas = RR.comprobaciones_deterministas(nuevo_texto, corpus, it, runs_ok, hipotesis=PROG.hipotesis_nacidas_en(self.almacen.estado, inv["id"], it, ahora=P.ahora_ms()))
            peso_nuevo = RR.peso_hallazgos(reglas_nuevas)
            # El sitio donde se corren las reglas es el mismo para los dos textos, así
            # que la comparación es de peras con peras.
            if peso_nuevo > peso_reglas:
                vueltas.append({"vuelta": vuelta, "estado": "rechazada", "motivo": f"La vuelta empeoró el texto: las comprobaciones por regla pesaban {peso_reglas} y pasaron a {peso_nuevo}. Se vuelve al resumen anterior"})
                break
            decisiones = {str(getattr(d, "id", "")): d for d in (getattr(rehecho.rehecho, "decisiones", None) or [])}
            # CANDADO 1: un hallazgo de regla que ya no salta está arreglado, y punto.
            # Es determinista y cubre los hallazgos por regla sin gastar nada.
            claves_nuevas = {(str(h.get("clase")), str(h.get("detalle"))) for h in reglas_nuevas}
            juez_vio: dict[str, Any] = {}
            resumen_juez = ""
            del_juez = [h for h in abiertos if h.get("origen") == "juez"]
            if del_juez:
                try:
                    with RR.en_revision(self.almacen.estado, inv["id"], it, c):
                        comprobado = await ctx.llamar(
                            "juez", self.programas.revisar_reparacion,
                            hallazgos_previos="\n".join(f"- [{h['id']}] {h['clase']} ({h['gravedad']}): {h['detalle']}\n  Se dijo: {(decisiones.get(h['id']) and getattr(decisiones[h['id']], 'decision', '')) or 'nada'} — {(decisiones.get(h['id']) and getattr(decisiones[h['id']], 'explicacion', '')) or 'sin explicación'}" for h in del_juez),
                            texto=nuevo_texto[:CORTE_TEXTO_REVISABLE], registro=registro,
                        )
                    juez_vio = {str(getattr(v, "id", "")): bool(getattr(v, "sigue", True)) for v in (getattr(comprobado.revision, "veredictos", None) or [])}
                    resumen_juez = str(getattr(comprobado.revision, "resumen", "") or "").strip()
                    for hz in (getattr(comprobado.revision, "hallazgos", None) or []):
                        pendientes.append({"id": f"rr-{it['id']}-v{vuelta}-{len(pendientes)}", "clase": hz.clase, "gravedad": hz.gravedad, "detalle": str(hz.detalle).strip()[:400], "origen": "juez", "estado": "abierto", "nacidoEnVuelta": vuelta})
                except (PresupuestoAgotado, ModeloSinRespuesta) as ex:
                    # El juez no pudo mirar: sus hallazgos quedan abiertos y marcados,
                    # y el resumen lo dice. Nunca "está limpio".
                    for h in del_juez:
                        h["comprobacion"] = "no_comprobada"
                    vueltas.append({"vuelta": vuelta, "estado": "sin_comprobar", "motivo": f"El texto se rehizo pero el juez no pudo comprobarlo ({type(ex).__name__}): los hallazgos del juez siguen abiertos"})
                    resumen_actual, llano_actual, texto_actual = nuevo_resumen, nuevo_llano, nuevo_texto
                    break
                except Exception as ex:  # noqa: BLE001
                    traceback.print_exc()
                    for h in del_juez:
                        h["comprobacion"] = "no_comprobada"
                    resumen_juez = f"El juez no comprobó el arreglo: {str(ex)[:120]}"
            for h in abiertos:
                d = decisiones.get(str(h.get("id")))
                dicho = str(getattr(d, "decision", "") or "")
                linea = str(getattr(d, "explicacion", "") or "").strip()[:300]
                if h.get("origen") == "regla":
                    if (str(h.get("clase")), str(h.get("detalle"))) not in claves_nuevas:
                        h.update(estado="atendido", respuesta=linea or "La comprobación por regla ya no salta sobre el texto nuevo", vuelta=vuelta, comprobacion="regla")
                    elif dicho:
                        h.update(estado="rebatido" if dicho == "rebatido" else "abierto", respuesta=linea, vuelta=vuelta, comprobacion="regla_sigue")
                    continue
                sigue = juez_vio.get(str(h.get("id")), True)
                # CANDADO 2: el juez dice que no sigue, pero ¿se tocó el texto donde el
                # hallazgo señalaba? Es el fallo de Yoon (dar por resuelto lo que no se
                # tocó) y aquí lo caza el código, no otro modelo.
                movido = RR.toco_el_texto(h, texto_actual, nuevo_texto)
                if not sigue and movido is False:
                    h.update(estado="abierto", respuesta=linea, vuelta=vuelta, arregloFalso=True, comprobacion="el juez lo dio por resuelto y el texto no cambió donde el hallazgo señalaba")
                elif not sigue:
                    h.update(estado="atendido", respuesta=linea, vuelta=vuelta, comprobacion="juez")
                elif dicho == "rebatido":
                    h.update(estado="rebatido", respuesta=linea, vuelta=vuelta, comprobacion="juez_no_acepta")
                else:
                    h.update(estado="abierto", respuesta=linea, vuelta=vuelta, comprobacion="juez")
            resumen_actual, llano_actual, texto_actual = nuevo_resumen, nuevo_llano, nuevo_texto
            peso_reglas = peso_nuevo
            atendidos = sum(1 for h in pendientes if h.get("estado") == "atendido")
            rebatidos = sum(1 for h in pendientes if h.get("estado") == "rebatido")
            falsos = sum(1 for h in pendientes if h.get("arregloFalso"))
            partes = [f"{atendidos} {'hallazgo atendido y comprobado' if atendidos == 1 else 'hallazgos atendidos y comprobados'}"]
            if rebatidos:
                partes.append(f"{rebatidos} {'rebatido' if rebatidos == 1 else 'rebatidos'}, que siguen reteniendo la publicación hasta que una persona los descarte")
            if falsos:
                partes.append(f"{falsos} se dieron por arreglados sin que el texto cambiara donde el hallazgo señalaba, así que siguen abiertos")
            vueltas.append({"vuelta": vuelta, "estado": "hecha", "motivo": "; ".join(partes) + (f". {resumen_juez}" if resumen_juez else "")})
        if not vueltas:
            return None
        graves_abiertos = [h for h in pendientes if h.get("gravedad") == "alta" and h.get("estado") in ("abierto", "rebatido")]
        sin_comprobar = any(h.get("comprobacion") == "no_comprobada" for h in pendientes)
        revision_final = dict(revision)
        revision_final["hallazgos"] = pendientes
        revision_final["vueltas"] = vueltas
        revision_final["estado"] = "con_hallazgos" if any(h.get("estado") in ("abierto", "rebatido") for h in pendientes) else "limpia"
        cola = " No pude comprobar todos los arreglos: el juez no respondió." if sin_comprobar else ""
        revision_final["resumen"] = f"{revision['resumen']} Después de {len(vueltas)} {'vuelta' if len(vueltas) == 1 else 'vueltas'} de reparación quedan {len(graves_abiertos)} hallazgos graves sin cerrar.{cola}".strip()
        return {"resumen": resumen_actual, "llano": llano_actual, "revision": revision_final, "vueltas": len(vueltas)}

    async def _cerrar_iteracion(self, c: dict[str, Any], it: dict[str, Any]) -> None:
        e = self.almacen.estado
        inv = next(i for i in e["investigaciones"] if i["id"] == c["investigacionId"])
        if it["plan"] and not any(p["estado"] in ("hecho", "fallido", "sin_trabajo") for p in it["plan"]):
            # Ningún paso llegó a ejecutarse (el tope se cumplió antes de empezar):
            # no hay nada que resumir, revisar ni aprender. Antes corrían igual el
            # resumen, el resumen en llano, las lecciones, el revisor de registro y la
            # meta-revisión sobre una iteración vacía (corridas 8 y 9).
            motivo = next((p.get("motivoFallo") for p in it["plan"] if p.get("motivoFallo")), "") or "ningún paso llegó a ejecutarse"
            ahora_v = P.ahora_ms()

            def vacio(e2: dict[str, Any]) -> bool:
                it2 = next(x for x in e2["iteraciones"] if x["id"] == it["id"])
                it2["terminadaEn"] = ahora_v
                it2["resumen"] = f"Iteración cerrada sin ejecutar ningún paso: {motivo}."
                A.con_evento(e2, inv["id"], "iteracion_terminada", f"Iteración {it['numero']} cerrada sin ejecutar ningún paso: {motivo}", f"#/investigaciones/{inv['id']}/corrida", ahora_v)
                return True

            self.almacen.mutar(vacio, "iteracion_vacia")
            return
        # `de_paso=True`: detener o pausar cortan también el cierre. Era el
        # único tramo caro que no obedecía a la persona, y es el más caro de la
        # iteración: resumen, meta, llano, evidencia por hipótesis y por idea
        # del vivero, conclusiones, revisor y reparación, del orden de 40
        # llamadas con Opus. Quien pulsaba "Detener" en el minuto uno pagaba
        # las 39 restantes (28 de septiembre de 2026). Cortar aquí es seguro
        # porque `it._cierre` guarda lo ya calculado y se retoma sin repagar.
        ctx = Ctx(self.almacen, self.programas, self.modelos, c["id"], inv["id"], it["id"], it["numero"], de_paso=True)
        # Lo ya calculado en un cierre anterior que se cortó por presupuesto (S-14):
        # el resumen, la meta-revisión y el resumen en llano no se pagan dos veces.
        parcial = dict(it.get("_cierre") or {}) if isinstance(it.get("_cierre"), dict) else {}
        # Certeza y dirección de cada hipótesis ANTES de rehacer las conclusiones
        # (rosa/bucle/cierre_texto.py): el resumen y el llano se escriben antes de
        # reconcluir y ese orden se conserva; al final del cierre se comparan con
        # las de después y, si alguna cambió, el texto lo dice por regla. La
        # instantánea va al cierre parcial (junto con el resumen, para que un
        # resumen que no llega deje `_cierre` vacío como espera el vigilante) y así
        # un cierre retomado compara contra lo de antes del primer intento, no
        # contra lo ya rehecho.
        from rosa.bucle import cierre_texto as CIERRE  # local: el módulo es solo del cierre

        certezas_antes = parcial.get("certezasAntes")
        if not isinstance(certezas_antes, dict):
            certezas_antes = CIERRE.instantanea_certezas(e, inv["id"])
        hechos_nuevos = [h for h in e["hechos"] if h["investigacionId"] == inv["id"] and h["actualizadoEn"] >= it["empezadaEn"] and h["historial"] and h["historial"][0]["quien"] == config.QUIEN_ROSA]
        # "Nuevas" son las nacidas en la ventana de esta iteración (rosa/progreso.py),
        # no las que comparten número de iteración con ella (S-16).
        hip_nuevas = PROG.hipotesis_nacidas_en(e, inv["id"], it, ahora=P.ahora_ms(), origen="rosa")
        cola = cola_de_hipotesis(e, inv["id"])
        afs = [a for a in c.get("_afirmaciones", []) if a["iteracion"] == it["numero"]]
        sin_comprobar = [a for a in afs if a["veredicto"] == "sin_verificar"] + [p for p in it["plan"] if p["estado"] == "fallido"]
        if parcial.get("resumen"):
            resumen = parcial["resumen"]
            if not isinstance(parcial.get("certezasAntes"), dict):
                # Cierre retomado de un intento que no guardó la instantánea: queda ahora.
                self.almacen.mutar(lambda e2: _guardar_cierre_parcial(e2, it["id"], certezasAntes=certezas_antes), "cierre_parcial")
        else:
            try:
                pred = await ctx.llamar("cerebro", self.programas.resumir, plan_ejecutado=T.plan_ejecutado(it), cambios_modelo_de_mundo="\n".join(f"- {h['enunciado']}" for h in hechos_nuevos) or "Ninguno", hipotesis_nuevas="\n".join(f"- {h['titulo']}" for h in hip_nuevas) or "Ninguna", cola=cola, sin_comprobar="\n".join(f"- {x.get('texto') or x.get('titulo')}" for x in sin_comprobar) or "Nada")
                resumen = pred.resumen.strip()
            except (PresupuestoAgotado, ModeloSinRespuesta):
                raise  # sin resumen por regla: el cierre se retoma cuando haya presupuesto o Astra vuelva
            except Exception:  # noqa: BLE001
                hechas = sum(1 for p in it["pistas"] if p["estado"] == "hecha")
                resumen = f"{len(it['plan'])} pasos, {hechas} pistas completadas, {len(hechos_nuevos)} hechos y {len(hip_nuevas)} hipótesis nuevas"
            self.almacen.mutar(lambda e2: _guardar_cierre_parcial(e2, it["id"], resumen=resumen, certezasAntes=certezas_antes), "cierre_parcial")
        # El panorama y las debilidades se sintetizan al cerrar cada iteración
        # con dos o más hipótesis, aunque el plan no trajera un paso de meta.
        propias = [h for h in e["hipotesis"] if h["investigacionId"] == inv["id"]]
        if len(propias) >= 2 and not parcial.get("metaHecha") and not any(T.inferir_tipo_paso(p) == "meta" and p["estado"] == "hecho" for p in it["plan"]):
            try:
                await PASOS.paso_meta(ctx, {"id": None, "titulo": "Meta-revisión al cierre", "detalle": ""})
            except (PresupuestoAgotado, ModeloSinRespuesta):
                raise  # la meta-revisión no se salta: se hace al retomar el cierre
            except Exception as ex:  # noqa: BLE001
                traceback.print_exc()
            self.almacen.mutar(lambda e2: _guardar_cierre_parcial(e2, it["id"], metaHecha=True), "cierre_parcial")
        if isinstance(parcial.get("llano"), dict):
            llano = parcial["llano"]
        else:
            llano = await self._explicar_en_llano(ctx, inv, resumen, hechos_nuevos, hip_nuevas, sin_comprobar, cola=cola)
            if llano:
                self.almacen.mutar(lambda e2: _guardar_cierre_parcial(e2, it["id"], llano=llano), "cierre_parcial")
        # Acumulación de evidencia: lo leído en esta iteración vuelve a las hipótesis
        # vivas (a favor, indirecto o en contra) antes de rehacer sus conclusiones.
        con_evidencia: set[str] = set()
        pista_ev = ctx.pista(None, "modelo", "Evidencia nueva para las hipótesis vivas", "Sonnet 5")
        try:
            acumulado = await EV.acumular(ctx, it["numero"], pista_ev)
            con_evidencia = set(acumulado.get("ids", []))
            # El vivero lleva SU pista: `EV.acumular` cierra la suya al terminar
            # (con el resumen ya escrito), así que hasta el 29 de septiembre de
            # 2026 la línea del vivero ("N ideas, M nacen, K se retiran") caía
            # dentro de un paso que la pantalla ya daba por hecho y no contaba en
            # su resumen. El trabajo se hacía y no se veía.
            pista_viv = ctx.pista(None, "modelo", "Evidencia nueva para las ideas del vivero", "Sonnet 5")
            try:
                vivero_res = await EV.acumular_vivero(ctx, it["numero"], pista_viv)
            finally:
                if pista_viv.abierta:
                    pista_viv.cerrar("Vivero revisado")
            con_evidencia |= set(vivero_res.get("nacidas", []))
        except PresupuestoAgotado:
            pista_ev.fallar("Sin presupuesto: la evidencia nueva se enlaza al retomar el cierre")
            raise
        except ModeloSinRespuesta as ex:
            pista_ev.fallar(f"{nombre_del_modelo(getattr(ex, 'modelo', None), getattr(ex, 'rol', None))} no respondió: la evidencia nueva se enlaza al retomar el cierre")
            raise
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            pista_ev.fallar(f"La acumulación de evidencia falló: {str(ex)[:160]}")
        e = self.almacen.estado
        # Reconcluir solo lo que cambió (S-13): la huella de la evidencia contada de
        # cada hipótesis viva frente a la que guarda su conclusión; las demás la
        # conservan con una nota. Las que sí, en paralelo de tres en tres.
        vivas = [x for x in e["hipotesis"] if x["investigacionId"] == inv["id"] and x["estado"] not in ("descartada",)]
        a_concluir: list[dict[str, Any]] = []
        conservadas: list[tuple[str, str]] = []
        for h in vivas:
            motivo_rc = motivo_para_reconcluir(h, con_evidencia)
            if motivo_rc:
                a_concluir.append(h)
            else:
                conservadas.append((h["id"], f"iteración {it['numero']}: sin cambios en la evidencia contada; se conserva la conclusión de la iteración {(h.get('conclusion') or {}).get('iteracion')}"))
        if a_concluir:
            sem = asyncio.Semaphore(3)

            async def concluir_una(h: dict[str, Any]) -> None:
                async with sem:
                    await self._concluir_hipotesis(ctx, h)

            resultados = await asyncio.gather(*(concluir_una(h) for h in a_concluir), return_exceptions=True)
            for r in resultados:
                if isinstance(r, (PresupuestoAgotado, ModeloSinRespuesta, asyncio.CancelledError)):
                    raise r  # las conclusiones ya escritas se conservan (huella): no se repagan al retomar
                if isinstance(r, BaseException):
                    traceback.print_exception(r)
        ahora = P.ahora_ms()
        bloqueadas = [a for a in afs if a["veredicto"] in ("no_sostenida", "cita_no_resuelve", "sin_cita", "ausencia_refutada")]
        e = self.almacen.estado
        hip_nuevas = PROG.hipotesis_nacidas_en(e, inv["id"], it, ahora=ahora, origen="rosa")
        informe = _informe(inv, it, resumen, hechos_nuevos, hip_nuevas, afs, bloqueadas, [q for q in c["busqueda"].get("consultas", []) if q.get("iteracion") in (None, it["numero"])])
        # Revisor de registro: lo que el resumen y el resumen en llano dicen, contra
        # lo que el registro prueba. Por regla y después con el juez.
        revision = await self._revisar_registro(ctx, inv, it, c, resumen, llano)
        # El bucle de revisión: si queda un hallazgo grave abierto, el revisor devuelve
        # el trabajo a quien lo escribió. Lo ya hecho se guarda en `it["_cierre"]`
        # (clave privada) para no repagarlo si el cierre se corta y se retoma.
        if not (parcial.get("reparacion") or {}).get("hecha"):
            reparado = await self._reparar_resumen(ctx, inv, it, c, resumen, llano, revision)
            if reparado:
                resumen, llano, revision = reparado["resumen"], reparado["llano"], reparado["revision"]
                self.almacen.mutar(lambda e2: _guardar_cierre_parcial(e2, it["id"], resumen=resumen, llano=llano, reparacion={"hecha": True, "vueltas": reparado["vueltas"]}), "cierre_parcial")
        terminar = _condicion_de_parada(inv["condicionParada"], it["numero"], self._con_reloj(c), mision=inv.get("mision"))
        # Lo que el tablero del método necesita del registro, leído fuera del reducer.
        try:
            registro_metodo = {"intervalos": self.almacen.intervalos_de_llamadas(c["id"]), "instantes": self.almacen.instantes_de_actividad(int(c.get("empezadaEn") or 0), ahora)}
        except Exception:  # noqa: BLE001  sin registro, el tiempo queda en "sin datos"
            registro_metodo = {"intervalos": None, "instantes": None}

        def fn(e2: dict[str, Any]) -> bool:
            it2 = next(x for x in e2["iteraciones"] if x["id"] == it["id"])
            it2["terminadaEn"] = ahora
            it2["resumen"] = resumen
            it2.pop("_cierre", None)
            if llano:
                it2["resumenLlano"] = llano
            # Las tareas que el juez propuso al revisar se registran AQUÍ, dentro de la
            # mutación del cierre, y no en `_revisar_registro`: el bucle de reparación
            # puede rechazar una vuelta y volver al texto anterior, y unas tareas ya
            # escritas sobrevivirían a la vuelta rechazada.
            crudas_rev = list(revision.pop("_tareas", None) or [])
            aceptadas_rev = sum(1 for x in (e2.get("tareas") or []) if isinstance(x, dict) and x.get("investigacionId") == inv["id"] and (x.get("origen") or {}).get("iteracion") == it["numero"] and x.get("estado") in ("aceptada", "programada"))
            for cruda in crudas_rev[:politicas.MAX_TAREAS_PROPUESTAS_POR_PASO]:
                t_rev = TA.nueva(inv["id"], cruda.get("queVio", ""), cruda.get("queHaria", ""), cruda.get("porQue", ""), cruda.get("herramienta", ""), {"tipo": "revisor", "iteracion": it["numero"], "detalle": "el revisor de registro lo vio al cerrar"}, ahora)
                estado_rev, _ = TA.registrar_con_motivo(e2, t_rev, ahora, aceptadas_ya=aceptadas_rev)
                if estado_rev == "aceptada":
                    aceptadas_rev += 1
            # Las revisiones de lo ya publicado que proponen las hipótesis como prueba:
            # ROSA2018 se las apunta a sí misma en vez de dejárselas a "los
            # investigadores" (25 de septiembre de 2026), las que quepan en la cola.
            aceptadas_rev += TA.registrar_de_escritorio(e2, inv["id"], it["numero"], ahora, aceptadas_ya=aceptadas_rev)
            it2["revisionRegistro"] = revision
            # Conclusiones conservadas al día por regla (M-14): techo, escalera y
            # min(juez, techo) con los factores guardados; si una certeza baja, evento.
            # Va antes de la instantánea de progreso para que esta vea la certeza real.
            with contextlib.suppress(Exception):
                recalcular_conclusiones_por_regla(e2, ahora, inv["id"])
            # La nota de las conclusiones conservadas (S-13) se escribe aquí, después
            # del recálculo por regla, para que sea la última línea del registro de la
            # iteración: dice que el juez no cobró, no que nada se moviera por regla.
            _anotar_conservadas(e2, conservadas)
            # Cambios de certeza y dirección de este cierre, por regla y sin pagar al
            # modelo (rosa/bucle/cierre_texto.py): si una hipótesis que ya tenía
            # conclusión subió, bajó o cambió de dirección, el resumen, el llano y el
            # informe lo dicen al final, y el llano avisa donde afirmaba lo que ya no
            # es: por hipótesis, así que recibe la instantánea de después con todas
            # las de la investigación para reconocer de cuál habla cada frase. Una
            # primera conclusión no cuenta (sin nivel anterior no hay cambio).
            # Ningún evento nuevo: la bajada por regla ya dejó el suyo. Un fallo aquí
            # deja el texto como estaba y no rompe el cierre.
            informe_final = informe
            try:
                cambios_cierre, parrafo_cierre = CIERRE.texto_del_cierre(certezas_antes, e2, inv["id"])
                if parrafo_cierre:
                    it2["resumen"] = CIERRE.resumen_con_cambios(it2.get("resumen"), parrafo_cierre)
                    llano_final = CIERRE.llano_con_cambios(it2.get("resumenLlano"), parrafo_cierre, cambios_cierre, hipotesis=CIERRE.instantanea_certezas(e2, inv["id"]))
                    if llano_final is not None:
                        it2["resumenLlano"] = llano_final
                    informe_final = CIERRE.informe_con_cambios(informe, parrafo_cierre)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            # Instantánea de progreso: certeza de cada hipótesis, peldaños subidos o
            # bajados, hechos nuevos y fallidos de la iteración (rosa/progreso.py). Las
            # hipótesis nuevas se cuentan aquí, sobre e2, para que las nacidas del
            # vivero en este mismo cierre cuenten.
            c_prog = next(x for x in e2["corridas"] if x["id"] == c["id"])
            nacidas = len(PROG.hipotesis_nacidas_en(e2, inv["id"], it2, ahora=ahora, origen="rosa"))
            c_prog.setdefault("progreso", []).append(PROG.instantanea(e2, c_prog, it2, len(hechos_nuevos), nacidas, len(bloqueadas), ahora))
            # Vistas de programa por regla (ROSA2018): dónde está la evidencia por
            # estadio, región y célula (mapa de la enfermedad), qué pasos de la ruta
            # terapéutica cubre cada diana (mapa de ruta) y las tres cifras de
            # aprendizaje. Cada una en su try: un fallo deja incidencia y no rompe el cierre.
            # La métrica de la corrida (`PROG.metrica_de_corrida`) lee las cifras de
            # la investigación a demanda, así que las ve en cuanto se escriben aquí.
            _vistas_de_programa_al_cerrar(e2, inv["id"], it2, ahora, registro_metodo=registro_metodo)
            # Lecciones por regla: lo que esta iteración enseña a no repetir (rosa/lecciones.py).
            nuevas_lecciones = LEC.registrar(e2, LEC.generar_al_cerrar(e2, c_prog, it2, revision, ahora))
            if nuevas_lecciones:
                A.con_evento(e2, inv["id"], "aprendizaje", f"{nuevas_lecciones} {'lección nueva' if nuevas_lecciones == 1 else 'lecciones nuevas'} de la iteración {it['numero']}: lo que ROSA2018 no repetirá", f"#/investigaciones/{inv['id']}/investigacion", ahora)
            if revision["hallazgos"]:
                A.con_evento(e2, inv["id"], "revision_registro", f"El revisor de registro encontró {len(revision['hallazgos'])} hallazgos en la iteración {it['numero']}: " + RR.resumen_revision(revision["hallazgos"])[:140], f"#/investigaciones/{inv['id']}/corrida", ahora)
            # Comprobaciones de cierre por etapa: el recuento en la iteración y, solo en
            # el caso extremo (ninguna etapa cumplió y al menos una falló), la pausa.
            etapas = COMP.resumen_de_iteracion(it2)
            it2["comprobacionEtapas"] = etapas
            if etapas["fallan"] or etapas["noComprobables"]:
                A.con_evento(e2, inv["id"], "etapa_incumplida", f"Iteración {it['numero']}: {etapas['resumen']}", f"#/investigaciones/{inv['id']}/corrida", ahora)
            if etapas["vacia"]:
                _pausar_por_etapas_en_vacio(e2, c["id"], f"ROSA2018 pausó la corrida ella misma: la iteración {it['numero']} cerró sin que ninguna etapa cumpliera y con al menos una fallando ({etapas['resumen']}). Seguir sería gastar en vacío. Mira el plan de la iteración, arregla lo que haga falta y reanuda.")
            # Bradley-Terry con intervalos sobre los partidos del torneo: es lo que
            # ordena a las candidatas; el Elo se queda como vista.
            bt = torneo.bradley_terry([x for x in e2["hipotesis"] if x["investigacionId"] == inv["id"]], semilla=it["numero"])
            for x in e2["hipotesis"]:
                if x["id"] in bt:
                    x["bt"] = bt[x["id"]]
            # Priorizacion: bloqueos no compensables y candidatas con diversidad.
            # Marcos de argumentación (rosa/argumentacion.py): qué candidatas se atacan
            # entre sí. Se marca, no se descarta; decide la persona.
            ARG.marcar_conflictos(e2, inv["id"])
            ids = PR.marcar_candidatas(e2, inv["id"])
            conflicto_txt = ARG.texto_conflictos(e2, inv["id"], ids)
            # `ranking_cambio` solo si cambió algo (S-13): el orden de las candidatas o
            # el texto de los conflictos respecto a lo último que se anunció, que la
            # investigación recuerda en claves privadas (no viajan al navegador).
            inv2 = next((i for i in e2["investigaciones"] if i["id"] == inv["id"]), None)
            emitidas = list((inv2 or {}).get("_candidatasEmitidas") or [])
            conflictos_emitidos = (inv2 or {}).get("_conflictosEmitidos") or ""
            if conflicto_txt and conflicto_txt != conflictos_emitidos:
                A.con_evento(e2, inv["id"], "ranking_cambio", conflicto_txt[:400], f"#/investigaciones/{inv['id']}/ranking", ahora)
            if ids and ids != emitidas:
                titulos = [next(x["titulo"][:50] for x in e2["hipotesis"] if x["id"] == i) for i in ids]
                A.con_evento(e2, inv["id"], "ranking_cambio", f"Candidatas al laboratorio tras la iteración {it['numero']}: " + "; ".join(titulos), f"#/investigaciones/{inv['id']}/ranking", ahora)
            if inv2 is not None:
                inv2["_candidatasEmitidas"] = list(ids)
                inv2["_conflictosEmitidos"] = conflicto_txt or ""
            runs_it = [r for r in e2.get("ejecuciones", []) if r.get("investigacionId") == inv["id"] and r.get("inicio", 0) >= it["empezadaEn"]]
            A.guardar_artefacto(
                e2, inv["id"], f"Informe de la iteración {it['numero']}", "informe", informe_final, resumen[:140], it["numero"], ahora,
                procedencia={
                    "mensajes": {"plan": [{"titulo": p["titulo"], "estado": p["estado"]} for p in it2["plan"]], "pistas": [{"id": p["id"], "titulo": p["titulo"], "estado": p["estado"]} for p in it2.get("pistas", [])[:40]], "decisiones": [d["id"] for d in e2.get("decisiones", []) if d.get("investigacionId") == inv["id"] and d.get("fecha", 0) >= it["empezadaEn"]][:40]},
                    "codigo": None,
                    "registroEjecucion": [{"id": r["id"], "estado": r.get("estado"), "auditoria": (r.get("auditoria") or {}).get("veredicto"), "resultados": r.get("resultados")} for r in runs_it[:20]] or None,
                    "entorno": {"cerebro": self.modelos.cerebro.model, "juez": self.modelos.juez.model, "volumen": self.modelos.volumen.model, "arnes": c.get("arnes"), "sandbox": [r.get("entorno") for r in runs_it[:1]]},
                    "revision": revision,
                },
            )
            A.con_evento(e2, inv["id"], "iteracion_terminada", f"Iteración {it['numero']} terminada: {resumen[:160]}", f"#/investigaciones/{inv['id']}/corrida", ahora)
            # Toda hipótesis viva cuya evidencia cambió desde su última decisión del
            # Killer vuelve a la cola de revisión (S-08).
            with contextlib.suppress(Exception):
                pedir_revision_por_huella(e2, ahora, inv["id"])
            c2 = next(x for x in e2["corridas"] if x["id"] == c["id"])
            # Una corrida que una persona detuvo no pasa a "terminada" por la
            # condición de parada: se perdía el registro de que la paró alguien
            # y su motivo, que es justo lo que hay que conservar. `_terminar_corrida`
            # ya hacía esta comprobación; aquí faltaba.
            if terminar and c2["estado"] not in ("detenida", "terminada"):
                c2["estado"] = "terminada"
                c2["terminadaEn"] = ahora
                c2["motivoCierre"] = terminar
                c2["esperandoModelo"] = None
                _resolver_incidencias_de_modelo_al_cerrar(e2, c2["id"], ahora)
                c2["metrica"] = PROG.metrica_de_corrida(e2, c2["id"])
                c2["_revisarArnes"] = True  # meta-campaña: el supervisor la recoge
                resumen_m = PROG.resumen_metrica(c2["metrica"])
                A.con_evento(e2, inv["id"], "corrida_estado", f"Corrida {c2['numero']} terminada: {terminar}" + (f". Balance: {resumen_m}" if resumen_m else ""), f"#/investigaciones/{inv['id']}/corrida", ahora)
            return True

        self.almacen.mutar(fn, "iteracion_cerrada")


# ---------------------------------------------------------------------------
# Ayudantes puros
# ---------------------------------------------------------------------------

# Cada cuánto se escribe el reloj de una corrida que trabaja al estado (S-17). El
# resto del tiempo vive en memoria del supervisor y el tope en horas lo lee de
# ahí. Una corrida que espera no se vuelca por tiempo: ver `_reloj_en_memoria`.
RELOJ_VOLCADO_MS = 30_000
# Espera antes de relanzar una tarea de corrida que murió con excepción: 30 s la
# primera vez, 60 s la segunda, 5 minutos la tercera; a partir de ahí se dobla
# cada vez (10, 20 min) hasta RETROCESO_MAX_MS (S-14). Ver `retroceso_ms`.
RETROCESO_MS = (30_000, 60_000, 300_000)
RETROCESO_MAX_MS = 30 * 60_000


def retroceso_ms(n: int) -> int:
    """Milisegundos de espera antes del relanzamiento `n` seguido (1 es el
    primero): los tres primeros de la tabla RETROCESO_MS y después exponencial
    (se dobla el último) con tope en RETROCESO_MAX_MS."""
    n = max(1, int(n))
    if n <= len(RETROCESO_MS):
        return RETROCESO_MS[n - 1]
    return min(RETROCESO_MS[-1] * 2 ** (n - len(RETROCESO_MS)), RETROCESO_MAX_MS)
# Incidencias que no retienen a la corrida en "esperando aprobación".
INCIDENCIAS_QUE_NO_BLOQUEAN = ("modelo_bloqueado", "bucle_reventado", "modelo_sin_respuesta")
# Veces que se intenta una revisión pedida cuando el Killer no llega a decidir.
MAX_INTENTOS_KILLER = 3
_SINTETICO = re.compile(r"sint[eé]tic", re.IGNORECASE)
# Lo que devuelven los ejecutores cuando corren y no había nada sobre lo que trabajar.
_SIN_TRABAJO = re.compile(r"^(no hay fuentes nuevas|nada pendiente de verificar|sin afirmaciones sostenidas nuevas|sin datasets aprobados|0 ensayos encontrados|0 hipótesis nuevas en la cola, 0 revisadas, 0 partidos|todas las hipótesis tienen la novedad comprobada)", re.IGNORECASE)


def _incidencia_bucle(e: dict[str, Any], corrida_id: str, ex: BaseException, n: int, espera_ms: int, ahora: int) -> bool:
    """La incidencia visible de una tarea de corrida que murió con excepción: qué
    excepción, cuántas veces seguidas y cuándo se reintenta. Una pendiente del
    mismo tipo se actualiza en vez de duplicarse."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c:
        return False
    espera = f"{espera_ms // 1000} s" if espera_ms < 120_000 else f"{espera_ms // 60_000} min"
    titulo = f"El bucle de la corrida {c['numero']} se cayó ({type(ex).__name__}); se reintenta en {espera}" + (f" (fallo {n} seguido)" if n > 1 else "")
    detalle = f"{type(ex).__name__}: {str(ex)[:400]}"
    for inc in e["incidencias"]:
        if inc["corridaId"] == corrida_id and inc["estado"] == "pendiente" and inc["tipo"] == "bucle_reventado":
            inc["titulo"] = titulo
            inc["detalle"] = detalle
            inc["creadaEn"] = ahora
            A.con_evento(e, c["investigacionId"], "incidencia", f"Incidencia: {titulo}", f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
            return True
    e["incidencias"].append({"id": P.nuevo_id("inc"), "corridaId": corrida_id, "tipo": "bucle_reventado", "titulo": titulo, "detalle": detalle, "recurso": "bucle", "alternativa": "Si se repite, detén la corrida y abre otra; el error queda en la consola del servidor.", "estado": "pendiente", "creadaEn": ahora, "resueltaEn": None, "resolucion": None})
    A.con_evento(e, c["investigacionId"], "incidencia", f"Incidencia: {titulo}", f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
    return True


def _guardar_cierre_parcial(e: dict[str, Any], iteracion_id: str, **partes: Any) -> bool:
    """Guarda en `it._cierre` lo ya calculado del cierre (resumen, meta hecha,
    resumen en llano) para no pagarlo otra vez si el cierre se corta."""
    it = next((x for x in e["iteraciones"] if x["id"] == iteracion_id), None)
    if not it:
        return False
    parcial = it.get("_cierre") if isinstance(it.get("_cierre"), dict) else {}
    parcial.update(partes)
    it["_cierre"] = parcial
    return True


# -- coste del cierre (S-14) ---------------------------------------------------


def llamadas_restantes(e: dict[str, Any], c: dict[str, Any], it: dict[str, Any] | None) -> int:
    """Llamadas que aún se pueden hacer: el menor entre lo que queda del tope de
    la corrida y lo que queda del tope de la iteración (si lo tiene). Nunca
    negativo."""
    corrida = int((c.get("presupuesto") or {}).get("limiteLlamadas") or 0) - int((c.get("gasto") or {}).get("llamadas") or 0)
    pres = (it or {}).get("presupuesto") if isinstance((it or {}).get("presupuesto"), dict) else {}
    limite = pres.get("limite")
    if isinstance(limite, (int, float)) and not isinstance(limite, bool):
        return max(0, min(corrida, int(limite) - int(pres.get("usado") or 0)))
    return max(0, corrida)


def coste_estimado_del_cierre(e: dict[str, Any], c: dict[str, Any], it: dict[str, Any]) -> dict[str, Any]:
    """Cuántas llamadas al modelo pide, como mucho, el cierre de la iteración tal
    como está ahora: resumen (1), meta-revisión (1 con dos o más hipótesis),
    resumen en llano (1), acumulación de evidencia (una por hipótesis viva hasta
    MAX_HIPOTESIS_POR_CIERRE más una por idea del vivero, solo si la iteración
    dejó afirmaciones sostenidas o parciales nuevas), conclusiones (las que hoy
    tienen motivo para reconcluir más, como mucho, una por afirmación nueva) y
    revisor de registro (1). Lo ya calculado en un cierre cortado (`it._cierre`)
    no se cuenta. Un cierre vacío (ningún paso ejecutado) no llama a nada.
    Devuelve {"total", "desglose"}."""
    inv_id = c["investigacionId"]
    plan = it.get("plan") or []
    if plan and not any(p.get("estado") in ("hecho", "fallido", "sin_trabajo") for p in plan):
        return {"total": 0, "desglose": {}}
    parcial = it.get("_cierre") if isinstance(it.get("_cierre"), dict) else {}
    propias = [h for h in e.get("hipotesis", []) if isinstance(h, dict) and h.get("investigacionId") == inv_id]
    vivas = [h for h in propias if h.get("estado") != "descartada"]
    inv = next((i for i in e.get("investigaciones", []) if i.get("id") == inv_id), {}) or {}
    try:
        afs_nuevas = EV.afirmaciones_nuevas(c, int(it.get("numero") or 0))
    except Exception:  # noqa: BLE001
        afs_nuevas = []
    con_motivo = 0
    for h in vivas:
        try:
            if motivo_para_reconcluir(h):
                con_motivo += 1
        except Exception:  # noqa: BLE001
            con_motivo += 1
    desglose = {
        "resumen": 0 if parcial.get("resumen") else 1,
        "meta": 1 if len(propias) >= 2 and not parcial.get("metaHecha") and not any(T.inferir_tipo_paso(p) == "meta" and p.get("estado") == "hecho" for p in plan) else 0,
        "llano": 0 if isinstance(parcial.get("llano"), dict) else 1,
        "evidencia": (min(len(vivas), EV.MAX_HIPOTESIS_POR_CIERRE) + len(inv.get("vivero") or [])) if afs_nuevas and vivas else 0,
        "conclusiones": min(len(vivas), con_motivo + len(afs_nuevas)) if afs_nuevas else con_motivo,
        "revisor": 1,
    }
    return {"total": sum(desglose.values()), "desglose": desglose}


# Conclusiones que se reservan de más al planificar, por las hipótesis que ganarán
# evidencia en la iteración y aún no tienen motivo para reconcluir (en la corrida
# 9 fue 1 de 8). La regla S-13 solo reconcluye lo que cambió, así que reservar
# una por hipótesis viva (59 llamadas con 28 hipótesis) inflaba el tope y la
# solicitud de gasto grande saltaba por un cierre que no iba a costar eso.
RESERVA_CONCLUSIONES_EXTRA = 3
# Cuántos caracteres del texto revisable ve el juez del revisor de registro. Con el
# llano entero (listas incluidas) la mediana real es de 4.173 caracteres y el máximo
# de 6.517 sobre las 33 revisiones guardadas: 12.000 no recorta ninguna.
CORTE_TEXTO_REVISABLE = 12_000


def desglose_previsto_del_cierre(e: dict[str, Any], investigacion_id: str) -> dict[str, int]:
    """Lo que se reserva para el cierre de una iteración recién planificada,
    antes de saber qué traerá, por partidas: resumen, resumen en llano y
    revisor (una cada uno), meta-revisión con dos o más hipótesis, acumulación
    de evidencia (una por hipótesis viva hasta MAX_HIPOTESIS_POR_CIERRE más una
    por idea del vivero) y conclusiones: las que hoy ya tienen motivo para
    reconcluir (`motivo_para_reconcluir`) más RESERVA_CONCLUSIONES_EXTRA, sin
    pasar del número de hipótesis vivas."""
    propias = [h for h in e.get("hipotesis", []) if isinstance(h, dict) and h.get("investigacionId") == investigacion_id]
    vivas = [h for h in propias if h.get("estado") != "descartada"]
    inv = next((i for i in e.get("investigaciones", []) if i.get("id") == investigacion_id), {}) or {}
    con_motivo = 0
    for h in vivas:
        try:
            if motivo_para_reconcluir(h):
                con_motivo += 1
        except Exception:  # noqa: BLE001
            con_motivo += 1
    return {
        "resumen": 1,
        "meta": 1 if len(propias) >= 2 else 0,
        "llano": 1,
        "evidencia": min(len(vivas), EV.MAX_HIPOTESIS_POR_CIERRE) + len(inv.get("vivero") or []),
        "conclusiones": min(len(vivas), con_motivo + RESERVA_CONCLUSIONES_EXTRA),
        "revisor": 1,
        # El bucle de revisión: una vuelta son dos llamadas (el cerebro rehace, el juez
        # comprueba) y el tope es de una vuelta. Va en la RESERVA, no solo en el
        # estimado: `reserva_cierre` se calcula con esta función, y sin la partida el
        # tope de la iteración no reservaría nada y el cierre pausaría la corrida justo
        # en las iteraciones con hallazgos graves. Es el fallo S-14 otra vez.
        "reparacion": 2 * F.MAX_VUELTAS_REPARACION,
    }


def coste_previsto_del_cierre(e: dict[str, Any], investigacion_id: str) -> int:
    """La reserva para el cierre que entra en el tope de una iteración recién
    planificada: la suma de `desglose_previsto_del_cierre`."""
    return sum(desglose_previsto_del_cierre(e, investigacion_id).values())


def _desglose_en_llano(estimado: dict[str, Any]) -> str:
    d = estimado.get("desglose") or {}
    partes = []
    if d.get("conclusiones"):
        partes.append(f"{d['conclusiones']} {'conclusión' if d['conclusiones'] == 1 else 'conclusiones'}")
    if d.get("evidencia"):
        partes.append(f"evidencia nueva para {d['evidencia']} hipótesis")
    fijos = [nombre for clave, nombre in (("resumen", "resumen"), ("meta", "meta-revisión"), ("llano", "resumen en llano"), ("revisor", "revisor de registro")) if d.get(clave)]
    if fijos:
        partes.append(", ".join(fijos))
    return "; ".join(partes) or "nada pendiente"


def motivo_de_pausa_por_cierre(c: dict[str, Any], it: dict[str, Any], estimado: dict[str, Any], restante: int) -> str:
    """El aviso de la pausa ANTES del cierre: qué necesita, qué queda en cada
    tope y cuánto hay que ampliar como mínimo."""
    pres = it.get("presupuesto") if isinstance(it.get("presupuesto"), dict) else {}
    total = int(estimado.get("total") or 0)
    return (
        f"El cierre de la iteración {it.get('numero')} necesita unas {total} llamadas al modelo ({_desglose_en_llano(estimado)}) y quedan {restante} "
        f"(la iteración lleva {int(pres.get('usado') or 0)} de {int(pres.get('limite') or 0)}; la corrida, {int(c['gasto'].get('llamadas') or 0)} de {int(c['presupuesto'].get('limiteLlamadas') or 0)}): "
        f"la corrida se pausó antes de empezarlo para no dejarlo a medias. Amplía el tope en al menos {max(1, total - restante)} llamadas para seguir."
    )


def detalle_de_gasto_grande(it: dict[str, Any]) -> str:
    """El detalle de la solicitud de gasto grande: cuánto del tope es de los
    pasos del plan y cuánto la reserva del cierre (`presupuesto.reservaCierre`),
    para que la cifra corresponda al plan que la persona aprobó. Una iteración
    antigua sin reserva guardada recibe el texto de siempre."""
    pres = it.get("presupuesto") if isinstance(it.get("presupuesto"), dict) else {}
    pedido = int(pres.get("limite") or 0)
    reserva = int(pres.get("reservaCierre") or 0)
    if reserva <= 0 or reserva > pedido:
        return "Es más de la mitad del presupuesto restante. Puedes ajustar cuántas llamadas permitir."
    return (
        f"Es más de la mitad del presupuesto restante: {pedido - reserva} llamadas son para los pasos del plan y {reserva} quedan reservadas para el cierre de la iteración "
        f"(resumen, evidencia nueva para las hipótesis vivas, las conclusiones que cambien y el revisor de registro). Puedes ajustar cuántas llamadas permitir."
    )


def detalle_del_cierre(it: dict[str, Any], faltan: dict[str, Any]) -> str:
    """Lo que se añade al aviso de tope agotado cuando el corte llegó dentro del cierre."""
    total = int(faltan.get("total") or 0)
    if total <= 0:
        return f"El tope saltó dentro del cierre de la iteración {it.get('numero')}; lo ya calculado se conserva y el cierre se retoma al ampliar."
    return f"El tope saltó dentro del cierre de la iteración {it.get('numero')}: le faltan unas {total} llamadas ({_desglose_en_llano(faltan)}); lo ya calculado se conserva y el cierre se retoma al ampliar."


# -- conclusiones al día por regla (M-14) ---------------------------------------


def recalcular_conclusiones_por_regla(e: dict[str, Any], ahora: int, investigacion_id: str | None = None) -> list[dict[str, Any]]:
    """Vuelve a calcular, sin modelo, lo que en cada conclusión guardada sale de
    la regla de rosa/certeza.py: el techo (con los factores que el juez dejó),
    la escalera, las cohortes y la certeza final `min(juez, techo)`, donde la
    del juez es `techo.certezaDelJuez` (o la certeza guardada, en conclusiones
    anteriores al techo). El cálculo es el de `CERTEZA.reacotar_conclusion`,
    el mismo que corre `priorizacion.reacotar_conclusiones` dentro de
    `marcar_candidatas`: una sola regla y una sola frase (`frase_plantilla`,
    con las variantes de "solo evidencia indirecta" (M-06) y de supuesto
    contradicho (M-07)), así que las dos rutas escriben la misma conclusión y
    la segunda pasada no cambia nada. Aquí se añade lo que el cierre necesita
    encima: si la certeza baja, un evento y un cambio de creencia de nivel 1;
    si sube (el techo subió y el juez ya estaba por encima), solo la línea del
    registro. El rastro en la conclusión (`cambio`, `recalculadaEn`) y la línea
    del registro de procedencia los deja `reacotar_conclusion` cuando sabe
    hacerlo (devuelve `texto`); con una versión anterior de rosa/certeza.py se
    escriben aquí. Se aplica a todas las hipótesis con conclusión, también a
    las de investigaciones sin corrida, y es idempotente. Devuelve una entrada
    por hipótesis que cambió (M-14: 19 de 28 conclusiones sin techo y una con
    certeza por encima del techo actual, 17 de septiembre de 2026)."""
    cambios: list[dict[str, Any]] = []
    for h in e.get("hipotesis", []) or []:
        if not isinstance(h, dict):
            continue
        if investigacion_id is not None and h.get("investigacionId") != investigacion_id:
            continue
        k = h.get("conclusion")
        if not isinstance(k, dict) or "certeza" not in k:
            continue
        anterior = k.get("certeza")
        techo_previo = k.get("techo") if isinstance(k.get("techo"), dict) else {}
        enunciado_previo = str(k.get("enunciado") or "")
        try:
            try:
                r = CERTEZA.reacotar_conclusion(h, ahora)
            except TypeError:
                r = CERTEZA.reacotar_conclusion(h)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            continue
        if not r or not r.get("cambio"):
            continue
        nueva = k.get("certeza")
        techo_nuevo = k.get("techo") if isinstance(k.get("techo"), dict) else {}
        motivo = str(techo_nuevo.get("motivo") or "")
        bajo = anterior in CERTEZA.NIVELES and nueva in CERTEZA.NIVELES and CERTEZA.NIVELES.index(nueva) < CERTEZA.NIVELES.index(anterior)
        texto = str(r.get("texto") or "") or f"{'bajó' if bajo else 'subió'} de {str(anterior).replace('_', ' ')} a {str(nueva).replace('_', ' ')} al recalcular el techo por regla: {motivo}"
        if "texto" not in r:
            # Versión anterior de rosa/certeza.py: el rastro se escribe aquí.
            registro = (h.get("procedencia") or {}).get("registro") if isinstance(h.get("procedencia"), dict) else None
            if anterior != nueva:
                k["enunciado"] = frase_plantilla(str(k.get("direccion") or "apoya"), str(nueva), str(k.get("hipotesisBreve") or h.get("titulo") or ""), supuesto_contradicho=MARCA_SUPUESTO_CONTRADICHO in enunciado_previo, indirectas=len(CERTEZA.apoyos_indirectos(h)))
                k["cambio"] = {"de": {"certeza": anterior, "direccion": k.get("direccion"), "iteracion": k.get("iteracion")}, "motivo": f"Recálculo del techo por regla: {motivo}"[:300]}
                k["recalculadaEn"] = ahora
                if isinstance(registro, list):
                    registro.append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} la certeza {texto}")
            elif isinstance(registro, list) and not techo_previo:
                registro.append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} techo GRADE calculado por regla para una conclusión que no lo tenía: {str(techo_nuevo.get('nivel', '')).replace('_', ' ')} ({motivo[:160]})")
        if anterior != nueva and bajo and h.get("estado") != "descartada" and h.get("investigacionId"):
            A.con_evento(e, h["investigacionId"], "revision_automatica", f"La certeza de «{str(h.get('titulo') or '')[:60]}» {texto}"[:400], f"#/investigaciones/{h['investigacionId']}/hipotesis/{h.get('id')}", ahora)
            e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(h["investigacionId"], 1, "creencia", f"{str(h.get('titulo') or '')[:80]}: la certeza {texto}"[:400], f"hipotesis:{h.get('id')}", "aplicado", config.QUIEN_ROSA, ahora))
        cambios.append({"id": h.get("id"), "de": anterior, "a": nueva, "techo": techo_nuevo.get("nivel")})
    return cambios


# -- réplica (S-27) --------------------------------------------------------------


class _CtxReplica:
    """El contexto con el que se verifican las copias de la réplica: los
    fragmentos de TODA la investigación más los pasajes guardados; todo lo
    demás (llamar, programas, mutar, almacén) es el del contexto real."""

    def __init__(self, ctx: Any, fragmentos: list[Any]) -> None:
        self._ctx = ctx
        self._fragmentos = list(fragmentos)

    def fragmentos_verificador(self) -> list[Any]:
        return list(self._fragmentos)

    def __getattr__(self, nombre: str) -> Any:
        if nombre.startswith("_"):
            raise AttributeError(nombre)  # nunca delegar lo privado: evita la recursión si falta `_ctx`
        return getattr(self._ctx, nombre)


def fragmento_guardado(cita: str, pasaje: str, fuente_id: str | None) -> Any | None:
    """Un fragmento sintético con el pasaje que la afirmación guardó al extraer,
    para juzgarla cuando la fuente no se puede releer. Lleva la referencia y el
    localizador de la propia cita (así la cita lo resuelve) y un encabezado que
    dice lo que es. None si no hay pasaje o la cita no sigue el patrón."""
    from rosa import verificador as V

    pasaje = (pasaje or "").strip()
    m = V.PATRON_CITA.match((cita or "").strip())
    if not pasaje or not m:
        return None
    return V.Fragmento(fuente_id or f"guardado:{hashlib.sha1((cita or '').encode('utf-8')).hexdigest()[:10]}", m.group(1).strip(), m.group(2).strip(), pasaje, "Pasaje guardado al extraer; la fuente no se pudo releer")


def ids_equivalentes_de(h: dict[str, Any], fuente_id: str, equivalentes: dict[str, set[str]] | None = None) -> list[str]:
    """Los otros ids con los que la fuente `fuente_id` de la hipótesis está
    registrada como la misma obra: los `_idsEquivalentes` anotados en su
    procedencia (en los dos sentidos) y los del mapa de la investigación
    (`EV.ids_equivalentes_en_investigacion`). Sin el propio id, sin repetir y
    en orden estable."""
    salida: list[str] = []
    vistos = {str(fuente_id)}

    def anotar(x: Any) -> None:
        if x and str(x) not in vistos:
            vistos.add(str(x))
            salida.append(str(x))

    fuentes = ((h.get("procedencia") or {}).get("fuentes") or []) if isinstance(h.get("procedencia"), dict) else []
    for f in fuentes:
        if not isinstance(f, dict):
            continue
        otros = [str(x) for x in (f.get("_idsEquivalentes") or []) if x]
        if str(f.get("id")) == str(fuente_id):
            for x in otros:
                anotar(x)
        elif str(fuente_id) in otros:
            anotar(f.get("id"))
            for x in otros:
                anotar(x)
    for x in sorted(equivalentes.get(str(fuente_id), set()) if equivalentes else ()):
        anotar(x)
    return salida


def _preparar_copias_replica(h: dict[str, Any], frags: list[Any], equivalentes: dict[str, set[str]] | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[Any], dict[str, int]]:
    """Las copias de las afirmaciones de `h` listas para la réplica. Devuelve
    (copias, comprobables, fragmentos guardados, citas) donde `citas` cuenta
    {total, resuelven, guardadas, sinComprobar}.

    Una cita resuelve, en este orden: por (fuenteId, localizador); por el
    localizador en otro id de la MISMA obra (`ids_equivalentes_de`: la fuente
    releída en otra corrida con otro id, S-06); y, solo si el id no está en
    ningún fragmento de la investigación, por referencia corta y localizador
    (es lo que hace el propio verificador con un id desconocido). Si el id sí
    está entre los fragmentos pero sin ese localizador, NO se cae a la
    referencia: caería en una fuente homónima distinta ("A et al., 2025" son
    dos artículos) y la afirmación se juzgaría contra el texto equivocado
    (S-04); se pasa al pasaje guardado. La que no resuelve pero conserva el
    pasaje guardado al extraer va marcada `noReleida`; la que no tiene nada
    queda como `cita_no_resuelve`, con el motivo del verificador, y fuera de
    la verificación."""
    from rosa import verificador as V

    copias = [dict(a, fragmento="", localizador="") for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
    comprobables: list[dict[str, Any]] = []
    guardados: list[Any] = []
    citas = {"total": len(copias), "resuelven": 0, "guardadas": 0, "sinComprobar": 0}
    for a, original in zip(copias, [x for x in (h.get("afirmaciones") or []) if isinstance(x, dict)]):
        fid = str(a.get("fuenteId") or "") or None
        fr = V.resolver_cita(a["cita"], frags, fid)
        if fr is None and fid:
            for alterno in ids_equivalentes_de(h, fid, equivalentes):
                fr = V.resolver_cita(a["cita"], frags, alterno)
                if fr is not None:
                    break
        if fr:
            a["fragmento"], a["localizador"], a["fuenteId"], a["encabezado"] = fr.texto[:400], fr.localizador, fr.fuente_id, fr.encabezado
            citas["resuelven"] += 1
        else:
            guardado = fragmento_guardado(a.get("cita") or "", original.get("fragmento") or "", fid)
            if guardado is None:
                motivo = V.motivo_cita_no_resuelta(a.get("cita") or "", frags, fid) if (a.get("cita") or "").strip() else "La afirmación no lleva cita."
                a["veredicto"], a["motivo"], a["noComprobable"] = "cita_no_resuelve", f"{motivo} La afirmación no conserva el pasaje guardado al extraer: no se puede comprobar en la réplica.", True
                citas["sinComprobar"] += 1
                continue
            a["noReleida"], a["localizador"], a["fuenteId"], a["encabezado"] = True, guardado.localizador, guardado.fuente_id, guardado.encabezado
            guardados.append(guardado)
            citas["guardadas"] += 1
        a["veredicto"] = "sin_verificar"
        comprobables.append(a)
    return copias, comprobables, guardados, citas


def citas_de_replica(e: dict[str, Any], h: dict[str, Any]) -> dict[str, int]:
    """Antes de lanzar una réplica: cuántas citas de la hipótesis resuelven a un
    fragmento guardado en las corridas de la investigación, cuántas se
    juzgarían sobre el pasaje guardado al extraer (veredicto máximo parcial) y
    cuántas no se pueden comprobar. Sin modelo; es lo que la pantalla debe
    enseñar junto al botón de replicar (S-27)."""
    frags = T.fragmentos_de_investigacion(e, h.get("investigacionId"))
    return _preparar_copias_replica(h, frags, EV.ids_equivalentes_en_investigacion(e, h.get("investigacionId")))[3]


def texto_citas_replica(citas: dict[str, int]) -> str:
    total = int(citas.get("total") or 0)
    return (
        f"Réplica lanzada sobre {total} {'cita' if total == 1 else 'citas'}: {int(citas.get('resuelven') or 0)} resuelven a un fragmento guardado en las corridas de la investigación, "
        f"{int(citas.get('guardadas') or 0)} se juzgan sobre el pasaje guardado al extraer sin releer la fuente (veredicto máximo parcial) y {int(citas.get('sinComprobar') or 0)} no se pueden comprobar (no cuentan como contradicción)."
    )


def _anotar_conservadas(e: dict[str, Any], notas: list[tuple[str, str]]) -> bool:
    cambiado = False
    for hid, nota in notas:
        h = next((x for x in e["hipotesis"] if x["id"] == hid), None)
        if h is None:
            continue
        registro = (h.get("procedencia") or {}).get("registro")
        if isinstance(registro, list) and (not registro or registro[-1] != nota):
            registro.append(nota)
            cambiado = True
    return cambiado


def _texto_techo_por_regla(h: dict[str, Any]) -> str:
    """El techo GRADE por regla (rosa/certeza.py) como una línea para el juez
    de la conclusión: 'baja: solo literatura, pero de dos cohortes distintas'.
    Si la regla no puede calcularse (registro raro), lo dice en vez de romper."""
    try:
        nivel, motivo = CERTEZA.techo(h)
        return f"{str(nivel).replace('_', ' ')}: {motivo}"
    except Exception as ex:  # noqa: BLE001
        return f"sin techo calculable ({type(ex).__name__})"


def _n_decisiones_killer(e: dict[str, Any], hipotesis_id: str) -> int:
    return sum(1 for d in e.get("decisiones", []) if d.get("hipotesisId") == hipotesis_id and str(d.get("etapa", "")).startswith("killer"))


def _cerrar_peticion_de_revision(e: dict[str, Any], hipotesis_id: str, decisiones_antes: int, intentos_antes: int | None = None) -> bool:
    """Quita `_revisionPedida` solo si el Killer escribió una decisión nueva; si
    no, cuenta el intento y a partir de MAX_INTENTOS_KILLER deja de insistir con
    una línea en el registro (S-08). Si el propio Killer ya contó el intento
    durante la llamada (`_registrar_juez_sin_respuesta` en pasos.py sube
    `_killerIntentos` cuando el juez no responde), aquí no se cuenta otra vez:
    con la doble cuenta el tope de tres llegaba al segundo fallo real."""
    h = next((x for x in e["hipotesis"] if x["id"] == hipotesis_id), None)
    if h is None:
        return False
    if _n_decisiones_killer(e, hipotesis_id) > decisiones_antes:
        h.pop("_revisionPedida", None)
        h.pop("_killerIntentos", None)
        h.pop("killerPendiente", None)
        return True
    actuales = int(h.get("_killerIntentos") or 0)
    ya_contado = intentos_antes is not None and actuales > int(intentos_antes)
    intentos = actuales if ya_contado else actuales + 1
    h["_killerIntentos"] = intentos
    if intentos >= MAX_INTENTOS_KILLER:
        h.pop("_revisionPedida", None)
        h.pop("killerPendiente", None)
        registro = (h.get("procedencia") or {}).get("registro")
        if isinstance(registro, list):
            registro.append(f"revisión pedida abandonada tras {intentos} intentos sin decisión del Killer (el juez no respondió); vuelve a pedirla desde la ficha")
    return True


def _abandonar_peticion_sin_presupuesto(e: dict[str, Any], hipotesis_id: str, corrida: dict[str, Any]) -> bool:
    """Cierra una revisión pedida que no se puede atender porque la corrida no
    tiene presupuesto: quita la marca sin contar intento, deja la línea en el
    registro de la hipótesis y un evento que dice cómo repetirla."""
    h = next((x for x in e["hipotesis"] if x["id"] == hipotesis_id), None)
    if h is None:
        return False
    nunca_juzgada = not h.get("decisionKiller")
    h.pop("_revisionPedida", None)
    h.pop("_killerIntentos", None)
    h.pop("killerPendiente", None)
    if nunca_juzgada:
        # Sin esto la hipótesis quedaba idéntica a una que el Killer dejó
        # avanzar: mismo estado "propuesta", `decisionKiller` en None y ni una
        # marca (28 de septiembre de 2026). Competía en el torneo y salía en un
        # dossier con su certeza, y solo se frenaba al elegir candidatas, en
        # silencio. `killerPendiente` lo deja a la vista.
        h["killerPendiente"] = {"intentos": 0, "maximo": MAX_INTENTOS_KILLER, "motivo": f"el Killer no llegó a juzgarla: la corrida {corrida.get('numero')} se quedó sin presupuesto"}
    nota = f"revisión pedida no atendida: la corrida {corrida.get('numero')} ({str(corrida.get('estado', '')).replace('_', ' ')}) no tiene presupuesto; amplíalo o abre otra corrida y vuelve a pedirla"
    VIGENCIA.no_atendida(h, f"La corrida {corrida.get('numero')} no tiene presupuesto: amplíalo o abre otra corrida y vuelve a pedirla.")
    registro = (h.get("procedencia") or {}).get("registro")
    if isinstance(registro, list):
        registro.append(nota)
    A.con_evento(e, h["investigacionId"], "presupuesto", f"No se pudo revisar «{str(h.get('titulo') or '')[:70]}»: la corrida {corrida.get('numero')} no tiene presupuesto. Amplíalo o abre otra corrida y vuelve a pedir la revisión.", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", P.ahora_ms())
    return True


def _verdadero(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return str(v or "").strip().lower() in ("1", "true", "si", "sí", "yes", "sintetico", "sintético")


def es_resultado_sintetico(experimento: dict[str, Any] | None, fichero: Any, cabecera: str = "") -> bool:
    """Un resultado de laboratorio es de prueba si el experimento lo declara
    (`ensayoEnSeco`, `sintetico`, `datosSinteticos`, que escribe la subida con la
    casilla marcada) o si el nombre del fichero o su cabecera dicen "sintético".
    Nunca cuenta como observación original (S-18)."""
    x = experimento if isinstance(experimento, dict) else {}
    if any(_verdadero(x.get(k)) for k in ("ensayoEnSeco", "sintetico", "datosSinteticos")):
        return True
    return bool(_SINTETICO.search(str(fichero or ""))) or bool(_SINTETICO.search(str(cabecera or "")))


def paso_sin_trabajo(resumen: Any, pistas_propias: list[dict[str, Any]]) -> bool:
    """Un paso corrió sin nada que hacer si no abrió ninguna pista o si devolvió
    una de las frases de "nada que hacer" de los ejecutores (M-23)."""
    if not pistas_propias:
        return True
    return bool(_SIN_TRABAJO.match(str(resumen or "").strip()))


def huella_evidencia(h: dict[str, Any]) -> str:
    """La huella de la evidencia de una hipótesis: UNA sola definición en todo
    ROSA2018, `rosa.killer.huella_evidencia` (ids, veredictos, relaciones y
    `socavadaPor` de las afirmaciones, ids de fuentes, versión, textos y estados
    de los supuestos, estado de la novedad; nunca los partidos ni el Elo). El
    Killer la guarda en cada decisión, el torneo en cada partido y el cierre la
    compara para no reconcluir sin evidencia nueva (S-13). Aquí solo se
    reexporta: la copia local que había en este módulo daba otro hash para la
    misma evidencia y se retiró."""
    return KILLER.huella_evidencia(h)


def huella_de_conclusion(h: dict[str, Any]) -> str:
    """Lo que de verdad mueve una conclusión GRADE: la huella de la evidencia más
    la decisión del Killer, el estado de los supuestos, las revisiones humanas, el
    resultado experimental y lo pendiente de revisar. Los partidos del torneo se
    dejan fuera a propósito: mueven el Elo, no la certeza (S-13)."""
    supuestos = sorted((str(s.get("texto")), str(s.get("estado"))) for s in (h.get("supuestos") or []) if isinstance(s, dict))
    resultado = ((h.get("experimento") or {}) if isinstance(h.get("experimento"), dict) else {}).get("resultado")
    resultado_clave = [resultado.get("fecha"), resultado.get("veredicto"), resultado.get("clasificacion")] if isinstance(resultado, dict) else None
    try:
        humanas = T.revisiones_humanas(h)
    except Exception:  # noqa: BLE001
        humanas = ""
    novedad = sorted((str(k), str((v or {}).get("detalle"))[:200]) for k, v in (h.get("novedad") or {}).items() if isinstance(v, dict))
    cuerpo = json.dumps([huella_evidencia(h), h.get("decisionKiller"), supuestos, humanas, resultado_clave, bool(h.get("pendienteRevision")), novedad], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(cuerpo.encode("utf-8")).hexdigest()


def motivo_para_reconcluir(h: dict[str, Any], con_evidencia: set[str] | None = None) -> str | None:
    """Por qué hay que rehacer la conclusión de `h` al cerrar, o None si se
    conserva: sin conclusión previa, evidencia nueva en esta iteración, cambio
    editorial de una fuente, pendiente de revisar, marca quitada por un resultado
    (laboratorio, in silico), o la huella de la evidencia contada cambió."""
    conclusion = h.get("conclusion")
    if not isinstance(conclusion, dict):
        return "sin conclusión previa"
    if con_evidencia and h.get("id") in con_evidencia:
        return "evidencia nueva en esta iteración"
    if h.get("_recalcularPorFuente"):
        return "cambio editorial de una fuente"
    if h.get("pendienteRevision"):
        return "pendiente de revisar"
    if "_conclusionIntentada" not in h:
        return "resultado o evidencia nueva marcada"
    if h.get("_reconcluirPorRevisiones"):
        # Marca de la migración del 25 de septiembre de 2026. La conclusión se
        # escribió con las revisiones de los modelos (127 de Opus, 4 de Astra)
        # entrando como "lo que dijeron las personas", junto a la instrucción de
        # que las humanas pesan más que las automáticas. No es que la evidencia
        # haya cambiado: es que se leyó mal quién la había revisado.
        return "se escribió contando revisiones de modelo como si fueran de personas"
    if conclusion.get("huella") != huella_de_conclusion(h):
        return "la evidencia contada cambió"
    return None


def _ultima_decision_killer(e: dict[str, Any], h: dict[str, Any]) -> dict[str, Any] | None:
    propias = [d for d in e.get("decisiones", []) if isinstance(d, dict) and d.get("hipotesisId") == h.get("id") and str(d.get("etapa", "")).startswith("killer")]
    return max(propias, key=lambda d: int(d.get("fecha") or 0)) if propias else None


def _hubo_evidencia_despues(e: dict[str, Any], h: dict[str, Any], fecha: int) -> bool:
    """Para decisiones anteriores a la huella: hubo un evento de evidencia nueva
    (o un resultado de laboratorio) para esta hipótesis después de la decisión."""
    sufijo = f"/hipotesis/{h.get('id')}"
    for ev in e.get("eventos", []) or []:
        if not isinstance(ev, dict) or ev.get("tipo") != "revision_automatica" or int(ev.get("t") or 0) <= fecha:
            continue
        if str(ev.get("ruta") or "").endswith(sufijo) and str(ev.get("texto") or "").startswith("Evidencia nueva para"):
            return True
    resultado = ((h.get("experimento") or {}) if isinstance(h.get("experimento"), dict) else {}).get("resultado")
    return isinstance(resultado, dict) and int(resultado.get("fecha") or 0) > fecha


def pedir_revision_por_huella(e: dict[str, Any], ahora: int, investigacion_id: str | None = None) -> int:
    """Marca `_revisionPedida` en toda hipótesis viva (propuesta o en revisión) que
    ya pasó por el Killer y cuya huella de evidencia difiere de la que el Killer
    vio al decidir (`decision.huella`, o `_huellaKiller`; para decisiones sin
    huella, un evento de evidencia nueva posterior). Cada huella se pide una sola
    vez (`_huellaRevisionPedida`) y se respeta el tope de intentos. Devuelve
    cuántas peticiones nuevas dejó (S-08)."""
    n = 0
    for h in e.get("hipotesis", []) or []:
        if not isinstance(h, dict) or h.get("estado") not in ("propuesta", "en_revision") or h.get("fusionadaEn"):
            continue
        if investigacion_id is not None and h.get("investigacionId") != investigacion_id:
            continue
        d = _ultima_decision_killer(e, h)
        if d is None:
            # Nunca juzgada. Antes se saltaba dando por hecho que la juzgaría el
            # siguiente paso de hipótesis; una que nace en el cierre de la última
            # iteración no tiene siguiente paso y se quedaba sin juzgar para
            # siempre, compitiendo en el torneo y con una certeza publicada
            # (28 de septiembre de 2026).
            if h.get("id") and not h.get("_revisionPedida") and int(h.get("_killerIntentos") or 0) < MAX_INTENTOS_KILLER:
                h["_revisionPedida"] = True
                n += 1
            continue
        if int(h.get("_killerIntentos") or 0) >= MAX_INTENTOS_KILLER:
            continue
        actual = huella_evidencia(h)
        guardada = d.get("huella") or h.get("_huellaKiller")
        cambio = (guardada != actual) if guardada else _hubo_evidencia_despues(e, h, int(d.get("fecha") or 0))
        if not cambio or h.get("_huellaRevisionPedida") == actual:
            continue
        h["_huellaRevisionPedida"] = actual
        if h.get("_revisionPedida"):
            continue
        h["_revisionPedida"] = True
        registro = (h.get("procedencia") or {}).get("registro")
        if isinstance(registro, list):
            registro.append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} revisión pedida: la evidencia cambió desde la última decisión del Killer")
        n += 1
    return n


def _direccion_por_regla_local(h: dict[str, Any], direccion_juez: str) -> tuple[str, bool]:
    """Dirección de la conclusión por regla (M-07): "en_contra" o "mixta" solo si
    hay alguna afirmación sostenida en contra (relación contradice, no sintética)
    o un resultado experimental que refuta; "sin_evidencia_directa" si no hay
    apoyos o el juez lo dijo y no hay apoyos directos; "apoya" en el resto.
    Devuelve también si el juez apoyaba su "mixta" en un supuesto contradicho."""
    sostenidas = [a for a in (h.get("afirmaciones") or []) if isinstance(a, dict) and a.get("veredicto") in ("sostenida", "parcial") and not a.get("sintetico")]
    contras = sum(1 for a in sostenidas if a.get("relacion") == "contradice")
    apoyos = sum(1 for a in sostenidas if a.get("relacion") in (None, "apoya", "apoya_indirecta"))
    resultado = ((h.get("experimento") or {}) if isinstance(h.get("experimento"), dict) else {}).get("resultado")
    refuta = isinstance(resultado, dict) and resultado.get("veredicto") == "refuta" and not resultado.get("sintetico")
    if refuta or (contras and not apoyos):
        return "en_contra", False
    if contras:
        return "mixta", False
    if apoyos == 0 or direccion_juez == "sin_evidencia_directa":
        return "sin_evidencia_directa", False
    return "apoya", False


def direccion_por_regla(h: dict[str, Any], direccion_juez: str) -> tuple[str, bool]:
    """La dirección por regla del grupo B1 (`T.direccion_por_regla(afirmaciones,
    propuesta, experimento)`, rosa/bucle/contexto.py) si existe; si no, la local
    con la misma regla. Devuelve (dirección, supuesto_contradicho): lo segundo es
    True siempre que la dirección quede en "apoya" o "sin evidencia directa" y
    haya algún supuesto contradicho; la frase plantilla lo dice.

    Hasta el 28 de septiembre de 2026 exigía además que el juez hubiera dicho
    "mixta" o "en contra". Si el juez decía "apoya" (lo normal, porque no mira
    los supuestos con esa regla), el aviso no salía: la hipótesis de SULF2 de la
    corrida `cor-mulntlr0-42` llegó a un dossier con un supuesto contradicho y
    sin una palabra sobre él en la conclusión."""
    direccion = None
    fn = getattr(T, "direccion_por_regla", None)
    if callable(fn):
        try:
            v = fn(h.get("afirmaciones"), direccion_juez, h.get("experimento") if isinstance(h.get("experimento"), dict) else None)
            if isinstance(v, str) and v:
                direccion = v
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    if direccion is None:
        direccion, _ = _direccion_por_regla_local(h, direccion_juez)
    supuestos = h.get("supuestos") if isinstance(h.get("supuestos"), list) else []
    hay_supuesto_contradicho = any(isinstance(s_, dict) and s_.get("estado") == "contradicho" for s_ in supuestos)
    # La dirección queda en "apoya" (o "sin evidencia directa") y hay un supuesto
    # contradicho: la frase lo dice. No depende de lo que dijera el juez, porque
    # el juez puede no haberlo mirado.
    return direccion, bool(direccion in ("apoya", "sin_evidencia_directa") and hay_supuesto_contradicho)


ESTADOS_EN_COLA = ("propuesta", "en_revision")
_ETIQUETA_KILLER = {"descartar_en_contexto": "descarte propuesto por el Killer", "descartar": "descarte propuesto por el Killer", "suspender": "suspendida por el Killer", "reformular": "reformular", "avanzar": "avanzar"}


def _motivo_killer(e: dict[str, Any], h: dict[str, Any]) -> str:
    d = _ultima_decision_killer(e, h)
    motivo = str((d or {}).get("motivo") or "").strip()
    return motivo[:200] if motivo else "sin motivo registrado"


def _cola_de_hipotesis_local(e: dict[str, Any], investigacion_id: str) -> str:
    """El listado por regla de la cola: cada hipótesis viva con título, estado,
    decisión del Killer con su motivo real y fecha de nacimiento, más la línea de
    recuento. Es lo que leen el resumen técnico y el llano en vez de inventarlo."""
    vivas = [h for h in e.get("hipotesis", []) if isinstance(h, dict) and h.get("investigacionId") == investigacion_id and h.get("estado") != "descartada" and not h.get("fusionadaEn")]
    lineas = []
    for h in sorted(vivas, key=lambda x: int(x.get("creadaEn") or 0)):
        creada = int(h.get("creadaEn") or 0)
        fecha = datetime.fromtimestamp(creada / 1000).strftime("%d/%m/%Y") if creada else "fecha desconocida"
        decision = h.get("decisionKiller")
        killer = f"{_ETIQUETA_KILLER.get(str(decision), str(decision))}: {_motivo_killer(e, h)}" if decision else "sin juzgar todavía"
        lineas.append(f"- {str(h.get('titulo') or '')[:100]} [estado {h.get('estado')}; Killer: {killer}; nació el {fecha}]")
    return (frase_de_la_cola(e, investigacion_id) + "\n" + "\n".join(lineas)) if lineas else "Ninguna hipótesis viva en la cola"


def cola_de_hipotesis(e: dict[str, Any], investigacion_id: str) -> str:
    """`T.cola_de_hipotesis` (grupo B) si existe; si no, la local con el mismo contrato."""
    fn = getattr(T, "cola_de_hipotesis", None)
    if callable(fn):
        try:
            v = fn(e, investigacion_id)
            if isinstance(v, str) and v:
                return v
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return _cola_de_hipotesis_local(e, investigacion_id)


def frase_de_la_cola(e: dict[str, Any], investigacion_id: str, nacidas: int | None = None) -> str:
    """La frase de recuento de la cola, generada por regla y que el modelo no toca:
    "9 hipótesis en cola: 5 con descarte propuesto por el Killer, 4 suspendidas,
    0 sin juzgar; 0 nacieron en esta iteración"."""
    en_cola = [h for h in e.get("hipotesis", []) if isinstance(h, dict) and h.get("investigacionId") == investigacion_id and h.get("estado") in ESTADOS_EN_COLA and not h.get("fusionadaEn")]
    descarte = sum(1 for h in en_cola if h.get("decisionKiller") in ("descartar_en_contexto", "descartar"))
    suspendidas = sum(1 for h in en_cola if h.get("decisionKiller") == "suspender")
    sin_juzgar = sum(1 for h in en_cola if not h.get("decisionKiller"))
    otras = len(en_cola) - descarte - suspendidas - sin_juzgar
    n = len(en_cola)
    frase = f"{n} hipótesis en cola: {descarte} con descarte propuesto por el Killer, {suspendidas} {'suspendida' if suspendidas == 1 else 'suspendidas'}, {sin_juzgar} sin juzgar" + (f", {otras} con otra decisión" if otras else "")
    if nacidas is not None:
        frase += f"; {nacidas} {'nació' if nacidas == 1 else 'nacieron'} en esta iteración"
    return frase


def estado_de_la_cola(e: dict[str, Any], investigacion_id: str) -> str:
    """Una línea por hipótesis viva con la decisión del Killer y su motivo real
    (última decisión registrada), para que el resumen en llano no invente el
    motivo de una suspensión."""
    vivas = [h for h in e.get("hipotesis", []) if isinstance(h, dict) and h.get("investigacionId") == investigacion_id and h.get("estado") != "descartada" and not h.get("fusionadaEn")]
    if not vivas:
        return "Ninguna"
    return "\n".join(f"- {str(h.get('titulo') or '')[:100]}: decisión del Killer «{h.get('decisionKiller') or 'sin decisión todavía'}» ({_motivo_killer(e, h) if h.get('decisionKiller') else 'aún no juzgada'}), estado «{h.get('estado')}»" for h in vivas)


def _evaluacion_sin_presupuesto(corrida: dict[str, Any], casos: int) -> dict[str, Any]:
    """La evaluación que queda cuando la corrida no tiene presupuesto: incompleta
    (0 juzgadas de N), con la nota de qué hacer."""
    return {"conjunto": "hipótesis con decisión humana", "casos": casos, "juzgadas": 0, "sinRespuesta": casos, "antes": None, "despues": None, "nota": f"Sin presupuesto en la corrida {corrida.get('numero')} ({str(corrida.get('estado', '')).replace('_', ' ')}): la evaluación no se hizo. Amplía el presupuesto de una corrida viva o abre otra y vuelve a evaluar"}


def evaluacion_pareada(r_antes: dict[str, Any], r_despues: dict[str, Any], casos: int) -> dict[str, Any]:
    """La evaluación de un criterio a partir de las dos pasadas del Killer: el
    acuerdo antes y después se calcula solo sobre las hipótesis juzgadas en las
    dos (comparación pareada). Si el juez no respondió en alguna, `juzgadas` <
    `casos`, la nota lo dice y `_fijar_evaluacion` no da por evaluado nada."""
    pareadas = [hid for hid in r_antes.get("acuerdos", {}) if hid in r_despues.get("acuerdos", {})]
    juzgadas = len(pareadas)
    sin_respuesta = casos - juzgadas
    antes = round(sum(1 for hid in pareadas if r_antes["acuerdos"][hid]) / juzgadas, 3) if juzgadas else None
    despues = round(sum(1 for hid in pareadas if r_despues["acuerdos"][hid]) / juzgadas, 3) if juzgadas else None
    if sin_respuesta > 0:
        nota = f"{sin_respuesta} de {casos} sin respuesta del juez: la cifra no se da por medida. Vuelve a evaluar cuando el juez responda" + (f" (sobre las {juzgadas} juzgadas: {antes} antes, {despues} después)" if juzgadas else "")
    elif despues is not None and antes is not None and despues > antes:
        nota = "Mejora el acuerdo con las decisiones humanas"
    elif despues is not None and antes is not None and despues < antes:
        nota = "Empeora el acuerdo"
    else:
        nota = "No cambia el acuerdo"
    return {"conjunto": "hipótesis con decisión humana", "casos": casos, "juzgadas": juzgadas, "sinRespuesta": sin_respuesta, "antes": antes, "despues": despues, "nota": nota}


def _ruta_segura(e: dict[str, Any], h: dict[str, Any]) -> dict[str, Any] | None:
    """`RUTA.evaluar_ruta` sin que un fallo de la regla tumbe la mutación que
    guarda la conclusión o el resultado: si falla, se deja la ruta anterior
    (o None) y el error queda en la consola."""
    try:
        return RUTA.evaluar_ruta(e, h)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return h.get("ruta")


def _anadir_contrato(experimento: dict[str, Any], propuesta: Any) -> None:
    """Añade al experimento las claves del contrato (`XP.CLAVES_CONTRATO`), la
    lista de problemas y la huella de las lecturas. Va aparte de la llamada al
    modelo: si la regla del contrato fallara, el protocolo que el cerebro ya
    devolvió (una llamada pagada) no se pierde; quedan los valores vacíos, un
    problema que lo dice y el error en la consola."""
    try:
        experimento.update(XP.contrato_desde_propuesta(propuesta))
        experimento["problemasContrato"] = XP.validar_contrato(experimento)
        experimento["hashLecturas"] = XP.hash_lecturas(experimento)
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        for k, v in XP.CLAVES_CONTRATO.items():
            experimento.setdefault(k, copy.deepcopy(v))
        experimento["problemasContrato"] = [f"no pude leer el contrato de la propuesta ({type(ex).__name__}): lecturas, sistema y propósito quedan sin declarar"]
        try:
            experimento["hashLecturas"] = XP.hash_lecturas(experimento)
        except Exception:  # noqa: BLE001
            experimento["hashLecturas"] = ""


def _linea_contrato(experimento: dict[str, Any]) -> str:
    """La línea del registro de procedencia que resume el contrato del experimento."""
    lecturas = experimento.get("lecturas") if isinstance(experimento.get("lecturas"), list) else []
    sistema = experimento.get("sistema") or {}
    problemas = experimento.get("problemasContrato") if isinstance(experimento.get("problemasContrato"), list) else []
    tipo = sistema.get("tipo") if isinstance(sistema, dict) else None
    return f"contrato del experimento: {len(lecturas)} {'lectura' if len(lecturas) == 1 else 'lecturas'}, sistema {XP.etiqueta(XP.SISTEMAS_EXPERIMENTALES, tipo) if tipo else 'no declarado'}, {len(problemas)} {'problema' if len(problemas) == 1 else 'problemas'}"


def _veredictos_por_lectura(experimento: dict[str, Any], resultado: dict[str, Any]) -> list[dict[str, Any]]:
    """`XP.veredicto_por_lecturas` protegido: un experimento antiguo sin lecturas
    da lista vacía, y un fallo de la regla también (con el error en consola)."""
    try:
        return XP.veredicto_por_lecturas(experimento, resultado)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return []


def _lectura_del_negativo(veredictos: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        r = XP.lectura_del_negativo(veredictos)
        return {"rama": r.get("rama"), "explicacion": r.get("explicacion", "")}
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        return {"rama": None, "explicacion": f"No pude leer el negativo por lecturas ({type(ex).__name__})."}


def _cuestiones_por_hueco(e: dict[str, Any], investigacion_id: str, huecos: list[Any], ahora: int, maximo: int = 6) -> int:
    """Cada hueco del mapa de la enfermedad (una combinación de estadio, región
    o célula que la misión nombra y nada cubre) se abre como cuestión para que
    el planificador busque en amplitud por ahí. No se repite una abierta con el
    mismo texto; `CU.registrar` además funde las equivalentes y respeta el tope."""
    abiertas = {str(c.get("texto") or "") for c in CU.abiertas(e, investigacion_id)}
    nuevas = 0
    for hueco in huecos[:maximo] if isinstance(huecos, list) else []:
        if not isinstance(hueco, dict) or not isinstance(hueco.get("motivo"), str):
            continue
        texto = hueco["motivo"].strip()
        if not texto or texto in abiertas:
            continue
        cuestion = CU.nueva(investigacion_id, texto, {"tipo": "analisis", "id": None}, "un hecho o una hipótesis que sitúe esa combinación por su contenido", ahora)
        # `registrar` devuelve también la cuestión con la que se fundió o la que
        # ya estaba resuelta: solo cuenta como nueva la que de verdad entró.
        _, motivo = CU.registrar_con_motivo(e, cuestion)
        abiertas.add(texto)
        if motivo == "nueva":
            nuevas += 1
    return nuevas


# A partir de cuántos apoyos sin una sola contra ROSA2018 se pregunta en voz alta si
# ha buscado lo que la refutaría. Vive en rosa/metodo.py, que la usa también para la
# balanza del tablero del método: un solo número para las dos cosas.
APOYOS_SIN_CONTRA_QUE_PREOCUPAN = METODO.APOYOS_SIN_CONTRA_QUE_PREOCUPAN


def _cuestiones_por_falta_de_contraste(e: dict[str, Any], investigacion_id: str, ahora: int, maximo: int = 3) -> int:
    """Abre una cuestión por cada hipótesis viva que acumula apoyos y NINGUNA
    afirmación en contra ni que socave.

    El 29 de septiembre de 2026 se contaron las relaciones de las 34 hipótesis de
    la base: 117 afirmaciones a favor y UNA en contra, con once hipótesis de
    cuatro o más apoyos y cero contras (una de ellas con diecisiete). La
    literatura de una hipótesis biológica real no se ve así; eso es el sesgo de
    confirmación de ROSA2018 medido en sus propios datos. No prueba que las
    hipótesis sean falsas: prueba que ROSA2018 no había ido a buscar lo que las
    tumba.

    La cuestión es el sitio correcto para decirlo porque cierra el círculo con lo
    que ya existe: `contexto.preguntas_abiertas` mete las cuestiones abiertas con
    su "qué la resolvería" en el criterio del paso, el generador de consultas lo
    lee y escribe la consulta, y el cribado (que desde hoy ve lo que refutaría)
    puntúa alto el artículo que la traiga. No cuesta ninguna llamada al modelo y
    no toca la certeza: decir "no lo he buscado" no es decir "es falso".
    """
    abiertas = {str(c.get("texto") or "") for c in CU.abiertas(e, investigacion_id)}
    candidatas = []
    for h in e.get("hipotesis") or []:
        if h.get("investigacionId") != investigacion_id or h.get("estado") in ("descartada", "suspendida"):
            continue
        rel = [str(a.get("relacion") or "") for a in (h.get("afirmaciones") or [])]
        a_favor = sum(1 for r in rel if r in ("apoya", "apoya_indirecta"))
        en_contra = sum(1 for r in rel if r in ("contradice", "socava"))
        if en_contra == 0 and a_favor >= APOYOS_SIN_CONTRA_QUE_PREOCUPAN:
            candidatas.append((a_favor, h))
    candidatas.sort(key=lambda x: -x[0])
    nuevas = 0
    for a_favor, h in candidatas[:maximo]:
        titulo = str(h.get("titulo") or "")[:70]
        texto = f"Ninguna fuente contradice «{titulo}» tras {a_favor} afirmaciones a favor: falta buscar lo que la refutaría"
        if texto in abiertas:
            continue
        x = h.get("experimento") or {}
        criterio = str(x.get("refuta") or (h.get("tarjeta") or {}).get("prediccionFalsable") or "").strip()
        que_resuelve = (f"una búsqueda dirigida a: {criterio[:200]}" if criterio else "una búsqueda dirigida al resultado contrario o al efecto nulo en la misma población y con la misma medida") + ", y la fuente que la responda en un sentido o en el otro"
        cuestion = CU.nueva(investigacion_id, texto, {"tipo": "analisis", "id": None}, que_resuelve, ahora, prioridad=2, hipotesis_ids=[str(h.get("id"))])
        _, motivo = CU.registrar_con_motivo(e, cuestion)
        abiertas.add(texto)
        if motivo == "nueva":
            nuevas += 1
    return nuevas


def _anadir_aprendizaje_al_llano(e: dict[str, Any], corrida_id: str, it: dict[str, Any]) -> None:
    """Pega al resumen en llano de la iteración el párrafo de las cifras de
    aprendizaje (clave `aprendizaje`) cuando las cifras guardadas en la
    investigación son las de esa misma iteración. Sirve para el resumen en
    llano que llega tarde (`_completar_en_llano_paso`), que si no se quedaría
    sin ese párrafo aunque el cierre ya lo hubiera calculado."""
    llano = it.get("resumenLlano")
    if not isinstance(llano, dict) or llano.get("aprendizaje"):
        return
    c = next((x for x in e.get("corridas", []) if isinstance(x, dict) and x.get("id") == corrida_id), None)
    inv = next((i for i in e.get("investigaciones", []) if isinstance(i, dict) and c and i.get("id") == c.get("investigacionId")), None)
    cifras = (inv or {}).get("cifrasAprendizaje")
    if isinstance(cifras, dict) and cifras.get("iteracion") == it.get("numero") and isinstance(cifras.get("texto"), str) and cifras["texto"]:
        llano["aprendizaje"] = cifras["texto"]


def _vistas_de_programa_al_cerrar(e2: dict[str, Any], inv_id: str, it2: dict[str, Any], ahora: int, registro_metodo: dict[str, Any] | None = None) -> None:
    """Escribe en la investigación `mapaEnfermedad`, `mapaRuta` y
    `cifrasAprendizaje` (cada uno con fecha e iteración), añade el texto de las
    cifras al resumen en llano de la iteración y abre una cuestión por hueco
    del mapa. Cada pieza va en su propio try: si falla, queda una incidencia y
    las demás siguen; el cierre de la iteración nunca se cae por una vista."""
    inv2 = next((i for i in e2["investigaciones"] if isinstance(i, dict) and i.get("id") == inv_id), None)
    if inv2 is None:
        return
    if not isinstance(it2, dict):
        it2 = {}  # iteración con forma rara: se escriben las vistas sin número ni resumen en llano
    n = it2.get("numero")
    try:
        mapa = MAPA.mapa(e2, inv_id)
        # Las etiquetas y definiciones se copian: el estado no debe compartir
        # referencias con las constantes del módulo (una mutación las cambiaría).
        inv2["mapaEnfermedad"] = {**mapa, "fecha": ahora, "iteracion": n, "etiquetas": copy.deepcopy(MAPA.ETIQUETAS), "definiciones": {"estadio": dict(MAPA.DEFINICIONES_ESTADIO), "nivel": dict(MAPA.DEFINICIONES_NIVEL)}}
        abiertas = _cuestiones_por_hueco(e2, inv_id, list(mapa.get("huecos") or []), ahora)
        if abiertas:
            A.con_evento(e2, inv_id, "aprendizaje", f"El mapa de la enfermedad deja {abiertas} {'hueco' if abiertas == 1 else 'huecos'} que la misión nombra y nada cubre; quedan como cuestiones abiertas para buscar en amplitud", f"#/investigaciones/{inv_id}/investigacion", ahora)
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        A.con_evento(e2, inv_id, "incidencia", f"No pude construir el mapa de la enfermedad al cerrar la iteración {n}: {type(ex).__name__}: {str(ex)[:160]}", f"#/investigaciones/{inv_id}/corrida", ahora)
    try:
        sin_contraste = _cuestiones_por_falta_de_contraste(e2, inv_id, ahora)
        if sin_contraste:
            A.con_evento(e2, inv_id, "aprendizaje", f"{sin_contraste} {'hipótesis acumula' if sin_contraste == 1 else 'hipótesis acumulan'} apoyos sin una sola fuente en contra: queda como cuestión abierta buscar lo que {'la' if sin_contraste == 1 else 'las'} refutaría, porque no haber buscado no es lo mismo que no haber encontrado", f"#/investigaciones/{inv_id}/investigacion", ahora)
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        A.con_evento(e2, inv_id, "incidencia", f"No pude revisar qué hipótesis acumulan apoyos sin contraste al cerrar la iteración {n}: {type(ex).__name__}: {str(ex)[:160]}", f"#/investigaciones/{inv_id}/corrida", ahora)
    try:
        # El tablero del método (rosa/metodo.py): cómo está investigando ROSA2018,
        # medido por regla sobre las trazas. Cero llamadas. Solo se dice como evento
        # lo que PASA a aviso: el mismo aviso cada iteración sería ruido.
        reg = registro_metodo or {}
        corrida_met = METODO.ultima_corrida(e2, inv_id)
        tablero = METODO.tablero(e2, inv_id, ahora, corrida=corrida_met, intervalos_modelo=reg.get("intervalos"), iteracion=n, instantes_actividad=reg.get("instantes"))
        nuevos = METODO.fijar(e2, inv_id, tablero)
        if nuevos:
            A.con_evento(e2, inv_id, "aprendizaje", "El tablero del método marca " + ("un aviso nuevo" if len(nuevos) == 1 else f"{len(nuevos)} avisos nuevos") + ": " + "; ".join(f"{x['titulo'].lower()} ({x['cifra']})" for x in nuevos)[:400], f"#/investigaciones/{inv_id}/investigacion", ahora)
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        A.con_evento(e2, inv_id, "incidencia", f"No pude calcular el tablero del método al cerrar la iteración {n}: {type(ex).__name__}: {str(ex)[:160]}", f"#/investigaciones/{inv_id}/corrida", ahora)
    try:
        inv2["mapaRuta"] = {**RUTA.mapa_ruta(e2, inv_id), "fecha": ahora, "iteracion": n}
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        A.con_evento(e2, inv_id, "incidencia", f"No pude construir el mapa de la ruta terapéutica al cerrar la iteración {n}: {type(ex).__name__}: {str(ex)[:160]}", f"#/investigaciones/{inv_id}/corrida", ahora)
    try:
        cifras = {**CIFRAS.resumen_cifras(e2, inv_id, ahora), "fecha": ahora, "iteracion": n}
        inv2["cifrasAprendizaje"] = cifras
        # El texto de las tres cifras entra al resumen en llano como párrafo aparte
        # (clave `aprendizaje`), antes del detalle técnico; solo si hay resumen en
        # llano: si falta, `_completar_en_llano` lo rellena después y el texto sigue
        # disponible en la investigación.
        llano = it2.get("resumenLlano")
        if isinstance(llano, dict) and cifras.get("texto"):
            llano["aprendizaje"] = cifras["texto"]
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        A.con_evento(e2, inv_id, "incidencia", f"No pude calcular las cifras de aprendizaje al cerrar la iteración {n}: {type(ex).__name__}: {str(ex)[:160]}", f"#/investigaciones/{inv_id}/corrida", ahora)


def _ordenar_plan(plan: list[dict[str, Any]], hay_novedad_pendiente: bool) -> list[dict[str, Any]]:
    """El orden relativo lo decide el modelo, salvo dos dependencias de ROSA2018:
    el modelo de mundo se actualiza antes de generar hipótesis, y la novedad
    se comprueba después de generarlas (si no hay hipótesis pendientes de
    novedad, un paso de novedad antes de hipótesis no tendría nada que hacer)."""
    tipos = [p.get("tipo") for p in plan]
    if "modelo" in tipos and "hipotesis" in tipos and tipos.index("modelo") > tipos.index("hipotesis"):
        m = plan.pop(tipos.index("modelo"))
        plan.insert([p.get("tipo") for p in plan].index("hipotesis"), m)
        tipos = [p.get("tipo") for p in plan]
    if "novedad" in tipos and "hipotesis" in tipos and tipos.index("novedad") < tipos.index("hipotesis") and not hay_novedad_pendiente:
        n = plan.pop(tipos.index("novedad"))
        plan.insert([p.get("tipo") for p in plan].index("hipotesis") + 1, n)
        tipos = [p.get("tipo") for p in plan]
    # El análisis con datos va después de las hipótesis (necesita su predicción
    # falsable y la decisión del Killer) y antes de la meta-revisión.
    if "analisis" in tipos and "hipotesis" in tipos and tipos.index("analisis") < tipos.index("hipotesis"):
        a = plan.pop(tipos.index("analisis"))
        plan.insert([p.get("tipo") for p in plan].index("hipotesis") + 1, a)
    return plan


def _fijar_evaluacion(e: dict[str, Any], cambio_id: str, evaluacion: dict[str, Any], ahora: int) -> bool:
    c = next((x for x in e.get("aprendizaje", []) if x["id"] == cambio_id), None)
    if not c:
        return False
    c.pop("_evaluar", None)
    c["evaluacion"] = evaluacion
    # Una evaluación incompleta (el juez no respondió en alguna hipótesis) no da
    # por medido nada: el criterio sigue propuesto y el botón de evaluar sigue ahí (S-24).
    completa = evaluacion.get("juzgadas") is None or int(evaluacion.get("juzgadas") or 0) >= int(evaluacion.get("casos") or 0)
    if not completa:
        A.con_evento(e, c.get("investigacionId"), "aprendizaje", f"Criterio sin evaluar: {evaluacion.get('nota', '')}", "#/ajustes", ahora)
        return True
    if c["estado"] == "propuesto" and evaluacion.get("casos"):
        c["estado"] = "evaluado"
    # Lo que propuso la meta-campaña se revierte solo si empeora: nadie tiene que
    # limpiar detrás de ROSA2018. Lo que propuso una persona queda evaluado y lo decide ella.
    if str(c.get("origen") or "").startswith("arnes:") and A.empeora_al_evaluar(c):
        c["estado"] = "revertido"
        c["resueltoEn"] = ahora
        c["resueltoPor"] = config.QUIEN_ROSA
        c["evaluacion"] = {**evaluacion, "nota": (evaluacion.get("nota") or "") + " Revertido por ROSA2018: la meta-campaña solo conserva lo que iguala o mejora."}
    A.con_evento(e, c.get("investigacionId"), "aprendizaje", f"Criterio evaluado sobre {evaluacion.get('casos', 0)} casos: acuerdo {evaluacion.get('antes')} antes, {evaluacion.get('despues')} después. {c['evaluacion'].get('nota', '')}", "#/ajustes", ahora)
    return True


def _quitar_marca_arnes(e: dict[str, Any], corrida_id: str, motivo: str = "") -> bool:
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c:
        return False
    c.pop("_revisarArnes", None)
    if motivo:
        A.con_evento(e, c["investigacionId"], "incidencia", f"La meta-campaña de la corrida {c['numero']} no se hizo: {motivo}", "#/ajustes", P.ahora_ms())
    return True


MAX_PROPUESTAS_ARNES = 3


def _normal(texto: str) -> str:
    return " ".join((texto or "").lower().split())


def cambios_desde_propuestas(e: dict[str, Any], c: dict[str, Any], propuestas: list[dict[str, Any]], ahora: int) -> list[dict[str, Any]]:
    """Convierte las propuestas de la meta-campaña en cambios de aprendizaje: un
    criterio es nivel 2 propuesto con evaluación pendiente (`_evaluar`); una
    política es nivel 3 propuesto (solo registro, la decide una persona). Se
    descartan las repetidas, las que ya son criterio vigente, las vacías y las de
    tipo desconocido; como mucho MAX_PROPUESTAS_ARNES. Devuelve los cambios creados."""
    vigentes = {_normal(x) for x in e.get("criteriosRevision", [])}
    previas = {_normal(x.get("descripcion", "")) for x in e.get("aprendizaje", []) if x.get("estado") != "revertido"}
    creados: list[dict[str, Any]] = []
    for p in propuestas:
        descripcion = (p.get("descripcion") or "").strip()
        tipo = p.get("tipo")
        if not descripcion or tipo not in ("criterio", "politica") or _normal(descripcion) in vigentes or _normal(descripcion) in previas:
            continue
        motivo = (p.get("motivo") or "").strip()
        riesgo = (p.get("riesgo") or "").strip()
        texto = descripcion + (f" Motivo: {motivo[:200]}" if motivo else "") + (f" Riesgo: {riesgo[:160]}" if riesgo else "")
        cambio = P.nuevo_cambio_aprendizaje(c["investigacionId"], 2 if tipo == "criterio" else 3, tipo, texto[:600], f"arnes:{c['id']}", "propuesto", config.QUIEN_ROSA, ahora)
        if tipo == "criterio":
            # El criterio evaluado es la descripción sola (es lo que entra a criteriosRevision).
            cambio["descripcion"] = descripcion[:400]
            cambio["nota"] = (f"Motivo: {motivo[:300]}" if motivo else "") + (f" Riesgo: {riesgo[:200]}" if riesgo else "")
            cambio["_evaluar"] = ahora
        e.setdefault("aprendizaje", []).append(cambio)
        previas.add(_normal(descripcion))
        creados.append(cambio)
        if len(creados) >= MAX_PROPUESTAS_ARNES:
            break
    return creados


def _omitir_pendientes(e: dict[str, Any], iteracion_id: str, motivo: str) -> bool:
    it = next((x for x in e["iteraciones"] if x["id"] == iteracion_id), None)
    if not it:
        return False
    for p in it["plan"]:
        if p["estado"] in ("pendiente", "en_curso"):
            p["estado"] = "omitido"
            p["motivoFallo"] = motivo
    return True


RESOLUCION_CERRADA_SIN_MODELO = "La corrida se cerró mientras el modelo no respondía"


def _resolver_incidencias_de_modelo_al_cerrar(e: dict[str, Any], corrida_id: str, ahora: int) -> int:
    """Al pasar una corrida a terminada: sus incidencias `modelo_sin_respuesta`
    pendientes (las que ROSA2018 abre y resuelve sola) quedan resueltas con "la
    corrida se cerró mientras el modelo no respondía". Sin esto, la que quedara
    abierta al cerrar no la resolvía nadie (el vigilante ya no corre para esa
    corrida y el supervisor solo resuelve en `esperando_modelo`) y la franja de
    modelos la enseñaba "quedó abierta al cerrar la corrida" para siempre. Misma
    regla que `detener_corrida` en rosa/estado/acciones.py. Devuelve cuántas."""
    n = 0
    for inc in e.get("incidencias", []) or []:
        if inc.get("corridaId") == corrida_id and inc.get("estado") == "pendiente" and inc.get("tipo") == "modelo_sin_respuesta":
            inc["estado"] = "resuelta"
            inc["resueltaEn"] = ahora
            inc["resolucion"] = RESOLUCION_CERRADA_SIN_MODELO
            n += 1
    return n


def _terminar_corrida(e: dict[str, Any], corrida_id: str, motivo: str) -> bool:
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] in ("detenida", "terminada"):
        return False
    ahora = P.ahora_ms()
    c["estado"] = "terminada"
    c["terminadaEn"] = ahora
    c["motivoCierre"] = motivo
    c["esperandoModelo"] = None  # una corrida terminada no espera a ningún modelo
    _resolver_incidencias_de_modelo_al_cerrar(e, corrida_id, ahora)
    c["metrica"] = PROG.metrica_de_corrida(e, c["id"])
    c["_revisarArnes"] = True  # meta-campaña: el supervisor la recoge
    resumen_m = PROG.resumen_metrica(c["metrica"])
    A.con_evento(e, c["investigacionId"], "corrida_estado", f"Corrida {c['numero']} terminada: {motivo}" + (f". Balance: {resumen_m}" if resumen_m else ""), f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
    return True


MARCA_RELACION = {"contradice": ", EN CONTRA de la hipótesis", "apoya_indirecta": ", apoyo indirecto (otra población, desenlace o plataforma)", "apoya": ", a favor", "socava": ", SOCAVA un apoyo (ataca el método o la inferencia de otra afirmación, no la hipótesis; el apoyo socavado no cuenta para el techo)"}
VERBO_CERTEZA = {"alta": "La evidencia reunida sostiene que", "moderada": "La evidencia reunida probablemente sostiene que", "baja": "La evidencia sugiere, con limitaciones, que", "muy_baja": "La evidencia es muy incierta sobre si"}
VERBO_CONTRA = {"alta": "La evidencia reunida contradice que", "moderada": "La evidencia reunida probablemente contradice que", "baja": "La evidencia sugiere, con limitaciones, que no se cumple que", "muy_baja": "La evidencia es muy incierta sobre si"}


# La marca con la que se reconoce, en una frase ya escrita, que avisaba de un
# supuesto contradicho: común a las dos formas ("aunque un supuesto..." con
# dirección a favor, "y un supuesto..." sin evidencia directa).
MARCA_SUPUESTO_CONTRADICHO = "supuesto del que depende está contradicho"


def frase_plantilla(direccion: str, certeza: str, titulo: str, supuesto_contradicho: bool = False, indirectas: int | None = None) -> str:
    """La frase calibrada de (dirección, certeza), como las tablas de Santesso
    2020 y Cochrane Iberoamérica. El modelo no la escribe: se genera por regla
    para que 'probablemente' signifique siempre lo mismo. La generadora es una
    sola, la de rosa/certeza.py (con la variante "solo evidencia indirecta" de
    M-06 cuando `indirectas` > 0); aquí solo se completa la variante M-07 de
    "sin evidencia directa" con un supuesto contradicho si la canónica aún no
    la dice, para que las dos rutas de recálculo escriban el mismo texto.
    `supuesto_contradicho`: la dirección es a favor (o sin evidencia directa)
    por las afirmaciones, pero un supuesto del que depende está contradicho;
    se dice, en vez de llamar "contradictoria" a la evidencia."""
    frase = CERTEZA.frase_plantilla(direccion, certeza, titulo, supuesto_contradicho=supuesto_contradicho, indirectas=indirectas)
    if direccion == "sin_evidencia_directa" and supuesto_contradicho and MARCA_SUPUESTO_CONTRADICHO not in frase:
        cuerpo, separador, cola = frase.rstrip().rpartition(". ")
        aviso = "y un supuesto del que depende está contradicho por las fuentes."
        frase = f"{cuerpo.rstrip('.')}, {aviso} {cola}" if separador else f"{frase.rstrip().rstrip('.')}, {aviso}"
    return frase


def _fijar_traspaso(e: dict[str, Any], corrida_id: str, texto: str) -> bool:
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c:
        return False
    c["traspasoRecibido"] = (texto or "")[:4000]
    return True


def _fijar_estado(e: dict[str, Any], corrida_id: str, estado: str) -> bool:
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] == estado:
        return False
    c["estado"] = estado
    return True


def motivo_de_pausa_por_presupuesto(e: dict[str, Any], c: dict[str, Any], tope: str | None = None) -> str:
    """El texto que dice qué tope saltó de verdad. Antes siempre culpaba al tope
    global aunque el que cortó fuera el de la iteración (447 con 400 de 1500
    gastadas), y "ampliar" no lo levantaba (S-15)."""
    it = A.iteracion_actual_de(e, c)
    tope = tope or tope_agotado_en(e, c["id"], (it or {}).get("numero")) or "corrida"
    gasto = int(c["gasto"].get("llamadas") or 0)
    limite = int(c["presupuesto"].get("limiteLlamadas") or 0)
    if tope == "iteracion" and it is not None:
        pres = it.get("presupuesto") or {}
        return f"La iteración {it['numero']} gastó las {int(pres.get('limite') or 0)} llamadas que le tocaban (la corrida lleva {gasto} de {limite}): la corrida se pausó. Amplía el tope para seguir."
    return f"La corrida agotó su tope de {limite} llamadas ({gasto} gastadas): se pausó. Amplía el tope para seguir."


def _pausar_por_etapas_en_vacio(e: dict[str, Any], corrida_id: str, motivo: str) -> bool:
    """ROSA2018 se pausa a sí misma cuando una iteración cierra sin que NINGUNA
    etapa haya cumplido y con al menos una fallando: seguir es gastar en vacío.

    No bloquea el cierre, que es donde se escriben el resumen, las conclusiones y
    el revisor: bloquearlo esconderría el fallo y dejaría la corrida clavada sin
    registro. Bloquea lo siguiente que costaría dinero. En las 50 iteraciones
    guardadas el caso ocurre exactamente una vez, la iteración en la que el cerebro
    devolvió un error de facturación del gateway y las cinco etapas siguientes
    giraron en vacío mientras la corrida seguía como si nada. Una pausa cada
    cincuenta iteraciones no molesta a nadie y ahorra justo la corrida que no vale.

    La reanuda una persona con el botón que ya existe."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] != "en_marcha":
        return False
    c["estado"] = "pausada"
    c["motivoPausaPropia"] = motivo
    A.con_evento(e, c["investigacionId"], "etapa_incumplida", motivo, f"#/investigaciones/{c['investigacionId']}/corrida", P.ahora_ms())
    return True


def ampliar_iteracion_si_queda_corrida(e: dict[str, Any], c: dict[str, Any]) -> str | None:
    """El reparto por iteración se amplía solo mientras a la corrida le quede
    tope (28 de septiembre de 2026). Devuelve el aviso si amplió, o None.

    El tope de una iteración no lo pone nadie: lo ESTIMA el planificador sumando
    lo que cree que costará cada paso más la reserva del cierre. Cuando la
    estimación se queda corta, lo que se agota es una previsión, no un límite.
    Hasta hoy eso paraba la corrida y pedía a una persona que ampliara el tope:
    la corrida 1 del 28 de septiembre se paró a las 17:00 con 1.535 llamadas aún
    disponibles en su propio tope y esperó dos minutos a que Emir la reanudara.
    Va contra la regla de la casa (18 de septiembre de 2026): dentro de una
    corrida que ya tiene tope, el gasto no se consulta; el tope de la corrida es
    el freno y lo demás es un aviso. Y contra lo que ROSA2018 es: un agente que
    tiene que poder investigar un minuto o una semana sin que nadie la vigile.

    Lo que SÍ sigue parando la corrida, porque son límites de verdad:
    - que se acabe el tope de la corrida (`limiteLlamadas`), que es el que se fija
      al crearla y el que una persona amplía a sabiendas;
    - que una persona haya denegado un permiso de gasto, que recorta la iteración
      a lo ya usado y deja `_presupuestoDenegado`: es una decisión humana y manda;
    - que la autonomía `gastar_grande` esté en "preguntar": quien la pone ahí
      quiere que se le pregunte, y eso también es una decisión humana.
    """
    if (e.get("autonomia") or {}).get("gastar_grande") != "actuar":
        return None
    limite_corrida = int((c.get("presupuesto") or {}).get("limiteLlamadas") or 0)
    restante = limite_corrida - int((c.get("gasto") or {}).get("llamadas") or 0)
    if restante <= 0:
        return None
    it = A.iteracion_actual_de(e, c)
    if it is None or it.get("terminadaEn") is not None or it.get("_presupuestoDenegado"):
        return None
    pres = it.get("presupuesto") if isinstance(it.get("presupuesto"), dict) else None
    limite = (pres or {}).get("limite")
    if pres is None or not isinstance(limite, (int, float)) or isinstance(limite, bool):
        return None
    usado = int(pres.get("usado") or 0)
    if usado < int(limite):
        return None  # el trozo de la iteración no es el que se agotó
    pres["limite"] = usado + restante
    pres["ampliadoSolo"] = int(pres.get("ampliadoSolo") or 0) + 1
    texto = (
        f"La iteración {it.get('numero')} agotó su reparto de {int(limite)} llamadas y se amplió sola a {pres['limite']}: "
        f"a la corrida le quedan {restante} de {limite_corrida} y el freno es el tope de la corrida, no el reparto del plan. "
        "ROSA2018 sigue sin esperar a nadie."
    )
    A.con_evento(e, c["investigacionId"], "presupuesto", texto, f"#/investigaciones/{c['investigacionId']}/corrida", P.ahora_ms())
    return texto


def _pausar_por_presupuesto(e: dict[str, Any], corrida_id: str, tope: str | None = None, motivo: str | None = None, detalle: str | None = None) -> bool:
    """Pausa la corrida por presupuesto con el motivo real. Una corrida detenida o
    terminada no se toca: la evaluación de un criterio o una revisión pedida
    sobre una corrida ya cerrada sin presupuesto la ponía en "pausada por
    presupuesto" y el tick la relanzaba como si siguiera viva (adversario de la
    tanda 1, 17 de septiembre de 2026). `motivo` sustituye al texto por tope
    (la pausa antes del cierre, que llega con presupuesto aún sin agotar);
    `detalle` se añade al final (cuánto le faltaba al cierre)."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] in ("pausada_por_presupuesto", "detenida", "terminada"):
        return False
    # Antes de pausar: si lo que se agotó es el reparto de la iteración y a la
    # corrida le queda tope, se amplía sola y no se pausa (ver la función). Con
    # `motivo` escrito no se amplía: quien lo pasa es la pre-pausa del cierre
    # (S-14), que ya midió lo que le queda a la CORRIDA y decidió no empezar un
    # cierre que no cabe. Ampliar el reparto ahí no añade ni una llamada y solo
    # dejaría que el cierre se comiera el resto del tope a medias.
    if motivo is None and ampliar_iteracion_si_queda_corrida(e, c):
        return True
    pendientes = any(s["corridaId"] == corrida_id and s["estado"] == "pendiente" for s in e["solicitudes"]) or any(i["corridaId"] == corrida_id and i["estado"] == "pendiente" and i["tipo"] not in INCIDENCIAS_QUE_NO_BLOQUEAN for i in e["incidencias"])
    c["estado"] = "esperando_aprobacion" if pendientes else "pausada_por_presupuesto"
    motivo = motivo or motivo_de_pausa_por_presupuesto(e, c, tope)
    if detalle:
        motivo = f"{motivo} {detalle.strip()}"
    c["presupuesto"]["motivoPausa"] = motivo
    A.con_evento(e, c["investigacionId"], "presupuesto", motivo, f"#/investigaciones/{c['investigacionId']}/corrida", P.ahora_ms())
    return True


# -- esperando modelo (vigilante de modelos, 18 de septiembre de 2026) ---------


def nombre_del_modelo(modelo: str | None, rol: str | None = None) -> str:
    """El nombre con el que la persona conoce al modelo ("GPT-6 Astra"): el del
    vigilante si está, por el id del gateway y, sin id, por el rol."""
    if modelo and VIG is not None:
        return VIG.nombre_de_modelo(modelo)
    m = (modelo or "").lower()
    for clave, nombre in NOMBRES_MODELO:
        if clave in m:
            return nombre
    return NOMBRE_POR_ROL.get(rol or "", modelo or "el modelo")


def _texto_duracion(ms: int) -> str:
    if VIG is not None:
        return VIG.duracion_texto(ms)
    minutos = max(0, int(ms)) // 60_000
    if minutos < 1:
        return "menos de un minuto"
    if minutos == 1:
        return "1 minuto"
    if minutos < 120:
        return f"{minutos} minutos"
    return f"{minutos // 60} h {minutos % 60} min"


def _texto_intentos(n: int) -> str:
    if VIG is not None:
        return VIG.intentos_texto(int(n))
    return "1 intento" if int(n) == 1 else f"{int(n)} intentos"


def _texto_cada_sondeo() -> str:
    s = int(INTERVALO_SONDEO_S)
    if s == 60:
        return "cada minuto"
    if s % 60 == 0:
        return f"cada {s // 60} minutos"
    return f"cada {s} segundos"


def _ruta_corrida(c: dict[str, Any]) -> str:
    return f"#/investigaciones/{c['investigacionId']}/corrida"


def _actualizar_salud(e: dict[str, Any], rol: str | None, modelo: str | None, *, ahora: int | None = None, **campos: Any) -> dict[str, Any]:
    """Escribe en `saludModelos[rol]` (la clave raíz del estado, misma forma que
    SaludModelo en frontend/src/datos/tipos.ts). Tolera estados antiguos sin la
    clave y crea el registro del rol si no existe. Una entrada en
    `sin_respuesta` desde otro estado cuenta una caída, salvo que el modelo
    respondiera hace menos de INTERVALO_SONDEO_S (`ahora` contra
    `ultimaRespuestaEn` y `recuperadoEn`): un modelo que contesta a un sondeo y
    no al siguiente está en la misma caída, no en otra."""
    salud = e.get("saludModelos")
    if not isinstance(salud, dict):
        salud = e["saludModelos"] = {}
    rol = str(rol or "cerebro")
    reg = salud.get(rol)
    if not isinstance(reg, dict):
        reg = salud[rol] = {"modelo": modelo or "", "estado": "ok", "desde": None, "intentos": 0, "proximoIntentoEn": None, "ultimaRespuestaEn": None, "ultimaLatenciaMs": None, "caidas": 0, "recuperadoEn": None}
    if modelo:
        reg["modelo"] = modelo
    if campos.get("estado") == "sin_respuesta" and reg.get("estado") not in ("lento", "sin_respuesta"):
        # Misma regla que registrar_salud del vigilante: "lento" ya es caído.
        marcas = [m for m in (reg.get("ultimaRespuestaEn"), reg.get("recuperadoEn")) if isinstance(m, (int, float)) and not isinstance(m, bool)]
        recaida = isinstance(ahora, (int, float)) and bool(marcas) and ahora - max(marcas) < int(INTERVALO_SONDEO_S) * 1000
        if not recaida:
            reg["caidas"] = int(reg.get("caidas") or 0) + 1
    reg.update(campos)
    return reg


def _entrar_en_esperando_modelo(e: dict[str, Any], corrida_id: str, ex: BaseException, paso_id: str | None, ahora: int) -> bool:
    """La corrida pasa a `esperando_modelo` con `esperandoModelo` relleno desde la
    excepción del vigilante (rol, modelo, intentos, desde) y deja el evento en
    castellano. El primer sondeo queda a INTERVALO_SONDEO_S. Una corrida detenida
    o terminada no se toca.

    La orden de la persona manda: si mientras el paso corría la corrida pasó a
    pausada (o a pausada por presupuesto, o a esperando una aprobación), el
    estado no se pisa ni se sondea. El paso queda pendiente y se reintenta
    cuando ella la reanude; no se deja registro de espera que la interfaz
    pudiera leer como "resolviéndose solo". Misma regla que `fijar_espera_modelo`
    en rosa/vigilante_modelos.py. Antes el primer sondeo que respondía la ponía
    en marcha y deshacía la pausa sin que nadie la reanudara."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] in ("detenida", "terminada"):
        return False
    rol = str(getattr(ex, "rol", None) or "cerebro")
    modelo = str(getattr(ex, "modelo", None) or "")
    intentos = int(getattr(ex, "intentos", 0) or 0)
    desde = getattr(ex, "desde", None)
    desde = int(desde) if isinstance(desde, (int, float)) and desde > 0 else ahora
    proximo = ahora + int(INTERVALO_SONDEO_S) * 1000
    if c["estado"] not in ESTADOS_QUE_PASAN_A_ESPERANDO_MODELO:
        _actualizar_salud(e, rol, modelo, ahora=ahora, estado="sin_respuesta", desde=desde, intentos=intentos)
        nombre = nombre_del_modelo(modelo, rol)
        situacion = ESTADO_DE_ESPERA_EN_LLANO.get(str(c["estado"]), "en espera de una persona")
        A.con_evento(e, c["investigacionId"], "corrida_estado", f"{nombre} no respondió tras {_texto_intentos(intentos)}; la corrida sigue {situacion} y el paso pendiente se reintentará al retomarla", _ruta_corrida(c), ahora)
        return True
    # El vigilante ya pudo anotar la espera entre sus reintentos: del mismo modelo
    # se conservan el último sondeo y la marca más antigua de "desde".
    previa = c.get("esperandoModelo") if isinstance(c.get("esperandoModelo"), dict) else None
    ultimo_sondeo = None
    if previa and previa.get("modelo") == modelo:
        ultimo_sondeo = previa.get("ultimoSondeo")
        if isinstance(previa.get("desde"), (int, float)) and 0 < previa["desde"] < desde:
            desde = int(previa["desde"])
        intentos = max(intentos, int(previa.get("intentos") or 0))
    c["estado"] = "esperando_modelo"
    c["esperandoModelo"] = {"rol": rol, "modelo": modelo, "desde": desde, "ultimoSondeo": ultimo_sondeo, "proximoSondeo": proximo, "pasoId": paso_id, "intentos": intentos}
    _actualizar_salud(e, rol, modelo, ahora=ahora, estado="sin_respuesta", desde=desde, intentos=intentos, proximoIntentoEn=proximo)
    nombre = nombre_del_modelo(modelo, rol)
    A.con_evento(e, c["investigacionId"], "corrida_estado", f"ROSA2018 espera a que {nombre} vuelva a responder: sondea {_texto_cada_sondeo()} y retomará sola", _ruta_corrida(c), ahora)
    return True


def _sondeo_fallido(e: dict[str, Any], corrida_id: str, ahora: int) -> bool:
    """El sondeo no obtuvo respuesta: el siguiente queda a INTERVALO_SONDEO_S y se
    cuenta el intento. La corrida sigue esperando."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] != "esperando_modelo":
        return False
    espera = c.get("esperandoModelo")
    if not isinstance(espera, dict):
        return False
    espera["ultimoSondeo"] = ahora
    espera["proximoSondeo"] = ahora + int(INTERVALO_SONDEO_S) * 1000
    espera["intentos"] = int(espera.get("intentos") or 0) + 1
    _actualizar_salud(e, espera.get("rol"), espera.get("modelo"), ahora=ahora, estado="sin_respuesta", intentos=espera["intentos"], proximoIntentoEn=espera["proximoSondeo"])
    return True


def _modelo_recuperado(e: dict[str, Any], corrida_id: str, ahora: int) -> bool:
    """El modelo volvió: la corrida pasa a en marcha, se borra `esperandoModelo`,
    se emite `modelo_recuperado` ("GPT-6 Astra volvió tras N intentos y M
    minutos"), se resuelven las incidencias `modelo_sin_respuesta` pendientes de
    la corrida y la salud del rol queda en ok. Devuelve False si la corrida ya no
    esperaba (la persona la reanudó o la detuvo mientras se sondeaba)."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] != "esperando_modelo":
        return False
    espera = c.get("esperandoModelo") if isinstance(c.get("esperandoModelo"), dict) else {}
    rol = str(espera.get("rol") or "cerebro")
    modelo = str(espera.get("modelo") or "")
    intentos = int(espera.get("intentos") or 0)
    desde = espera.get("desde")
    duracion = _texto_duracion(ahora - int(desde)) if isinstance(desde, (int, float)) else "un tiempo sin medir"
    nombre = nombre_del_modelo(modelo, rol)
    texto = f"{nombre} volvió tras {_texto_intentos(intentos)} y {duracion}"
    c["estado"] = "en_marcha"
    c["esperandoModelo"] = None
    for inc in e["incidencias"]:
        if inc["corridaId"] == corrida_id and inc["estado"] == "pendiente" and inc["tipo"] == "modelo_sin_respuesta":
            inc["estado"] = "resuelta"
            inc["resueltaEn"] = ahora
            inc["resolucion"] = "ROSA2018 lo resolvió sola"
            inc["detalle"] = f"{texto}."
    # La salud del rol vuelve a ok solo si ninguna otra corrida sigue esperando a
    # este mismo modelo: con dos sondeos a un segundo de diferencia (uno responde
    # y el otro no) se contaba la misma caída dos veces y la franja decía "ok"
    # mientras una corrida seguía esperando. Si otra espera, queda anotada la
    # respuesta y la salud sigue en sin_respuesta hasta que su sondeo la confirme.
    otras_esperan = any(x is not c and x.get("estado") == "esperando_modelo" and isinstance(x.get("esperandoModelo"), dict) and x["esperandoModelo"].get("modelo") == modelo for x in e["corridas"])
    if otras_esperan:
        _actualizar_salud(e, rol, modelo, ahora=ahora, ultimaRespuestaEn=ahora)
    else:
        _actualizar_salud(e, rol, modelo, ahora=ahora, estado="ok", desde=ahora, intentos=0, proximoIntentoEn=None, ultimaRespuestaEn=ahora, recuperadoEn=ahora)
    A.con_evento(e, c["investigacionId"], "modelo_recuperado", texto, _ruta_corrida(c), ahora)
    return True


def _salir_de_esperando_modelo_sin_registro(e: dict[str, Any], corrida_id: str, ahora: int) -> bool:
    """Una corrida en `esperando_modelo` sin `esperandoModelo` (estado a medias o
    de otra versión) no puede sondear nada: vuelve a en marcha y se dice."""
    c = next((x for x in e["corridas"] if x["id"] == corrida_id), None)
    if not c or c["estado"] != "esperando_modelo" or isinstance(c.get("esperandoModelo"), dict):
        return False
    c["estado"] = "en_marcha"
    c["esperandoModelo"] = None
    A.con_evento(e, c["investigacionId"], "corrida_estado", f"La corrida {c['numero']} esperaba a un modelo sin registro de cuál: retoma y reintenta el paso pendiente", _ruta_corrida(c), ahora)
    return True


def _llano_rehecho(salida: Any, anterior: dict[str, Any] | None) -> dict[str, Any] | None:
    """El resumen en llano que devolvió el cerebro, con las claves del estado. Si no
    había llano antes, se descarta lo que venga: el bucle de reparación arregla lo
    que hay, no inventa una sección nueva. Y si el modelo devolvió algo que no
    cuadra, se conserva el anterior: nunca se pierde un llano bueno."""
    if anterior is None or salida is None:
        return anterior
    try:
        campos = salida.model_dump() if hasattr(salida, "model_dump") else dict(salida)
    except Exception:  # noqa: BLE001
        return anterior
    if not isinstance(campos, dict) or not campos:
        return anterior
    salida_final = dict(anterior)
    for clave, valor in campos.items():
        camel = re.sub(r"_(\w)", lambda m: m.group(1).upper(), str(clave))
        destino = camel if camel in anterior else (clave if clave in anterior else None)
        if destino is None or valor in (None, "", []):
            continue
        if type(valor) is not type(anterior[destino]) and not (isinstance(valor, list) and isinstance(anterior[destino], list)):
            continue
        salida_final[destino] = valor
    return salida_final


def _fijar_comprobacion(e: dict[str, Any], iteracion_id: str, paso_id: str, comprobacion: dict[str, Any] | None) -> bool:
    """La comprobación de cierre de una etapa, escrita en su paso del plan. No
    toca el estado del paso: lo que dice es si la etapa produjo lo suyo, no si
    terminó. Idempotente: la reescribe."""
    it = next((x for x in e["iteraciones"] if x["id"] == iteracion_id), None)
    if not it or not comprobacion:
        return False
    for p in it["plan"]:
        if p["id"] == paso_id:
            p["comprobacion"] = comprobacion
            return True
    return False


def _estado_paso(e: dict[str, Any], iteracion_id: str, paso_id: str, estado: str, detalle: str | None = None, motivo: str | None = None) -> bool:
    it = next((x for x in e["iteraciones"] if x["id"] == iteracion_id), None)
    if not it:
        return False
    for p in it["plan"]:
        if p["id"] == paso_id:
            p["estado"] = estado
            if detalle:
                p["detalle"] = detalle[:300]
            p["motivoFallo"] = motivo
            return True
    return False


# Un tic del supervisor cada segundo; si entre dos tics pasan más de dos minutos,
# el proceso estuvo suspendido (el equipo dormido, el portátil cerrado) y ese
# hueco no es tiempo de trabajo de la corrida.
UMBRAL_SUSPENSION_MS = 120_000
# Estados en los que la corrida espera a una persona: el plan sin aprobar, un
# permiso pendiente, la pausa a mano y la pausa por presupuesto (alguien tiene
# que ampliarlo). Ese tiempo no cuenta contra el tope en horas.
ESTADOS_DE_ESPERA_HUMANA = ("esperando_plan", "esperando_aprobacion", "pausada", "pausada_por_presupuesto")
# Estados en los que la corrida espera a ROSA2018 misma, no a una persona: un
# modelo del gateway que no responde. Ese tiempo va a `pausaMs`, como el sueño
# del equipo: no es trabajo ni espera humana.
ESTADOS_DE_PAUSA_DEL_PROCESO = ("esperando_modelo",)
# Estados desde los que un modelo caído lleva la corrida a `esperando_modelo`:
# en marcha, o ya en espera (el vigilante la puso entre sus reintentos). Desde
# cualquier otro (pausada, pausada por presupuesto, esperando una aprobación o el
# plan) la orden de la persona manda y el estado no se pisa.
ESTADOS_QUE_PASAN_A_ESPERANDO_MODELO = ("en_marcha", "esperando_modelo")
# Cómo se le dice a la persona en qué quedó la corrida cuando el modelo cayó y su
# estado no se tocó (evento de `_entrar_en_esperando_modelo`).
ESTADO_DE_ESPERA_EN_LLANO = {"pausada": "pausada por la persona", "pausada_por_presupuesto": "pausada por presupuesto", "esperando_aprobacion": "a la espera de una aprobación", "esperando_plan": "a la espera del plan"}
# Estados en los que los rellenos de fondo (versión en llano, conclusión,
# experimento, tarjeta, misión) no gastan llamadas: la persona detuvo o pausó la
# corrida, no hay presupuesto, o el modelo al que se le pediría no responde
# (`esperando_modelo`: pedirle rellenos a un modelo caído es pagar generaciones
# que el vigilante corta a los 240 s y reabrir su incidencia desde otra tarea).
# Cómo cuenta un resultado del laboratorio en la evidencia de la hipótesis que
# se probó. Lo que no está aquí (inconcluso, corrección de contexto) no entra.
RELACION_LABORATORIO = {"apoyo_reproducido": "apoya", "negativo_interpretable": "contradice"}

ESTADOS_SIN_GASTO_DE_FONDO = ("detenida", "terminada", "pausada", "pausada_por_presupuesto", "esperando_modelo")


def ancla_de_reloj(c: dict[str, Any], ahora: int) -> int | None:
    """El instante guardado hasta el que la espera y las pausas de la corrida son
    exactas (`_relojEn`), o None si no hay uno válido: falta (estado de antes del
    28 de septiembre de 2026), no es un número, o cae fuera de (0, ahora]. Un
    ancla en el futuro repartiría un hueco negativo; una en el pasado remoto
    inventada, días de espera que nadie esperó: las dos se ignoran."""
    v = c.get("_relojEn")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return int(v) if 0 < v <= ahora else None


def tiempo_trabajo_ms(c: dict[str, Any], ahora: int) -> int:
    """Milisegundos que la corrida ha trabajado de verdad: el reloj de pared menos
    lo que pasó esperando a una persona (plan sin aprobar, permiso de gasto, pausa)
    y menos las pausas del proceso. Es lo que se compara con el tope en horas.
    Antes se comparaba el reloj de pared: la corrida 8 gastó 21 de sus 60 minutos
    esperando la aprobación del plan y la 7 se cerró al despertar el Mac tras una
    noche dormido (Emir, 17 de septiembre de 2026)."""
    return max(0, int(ahora - c["empezadaEn"] - int(c.get("esperaHumanaMs") or 0) - int(c.get("pausaMs") or 0)))


def contabilizar_tiempo(c: dict[str, Any], ahora: int) -> bool:
    """En cada tic: si la corrida espera a una persona, el tiempo desde el tic
    anterior va a `esperaHumanaMs`; si espera a un modelo que no responde
    (`esperando_modelo`), o si entre tics pasó más de UMBRAL_SUSPENSION_MS, el
    hueco va a `pausaMs`. Devuelve True si cambió algo público."""
    ultimo = c.get("_ultimoTic")
    c["_ultimoTic"] = ahora
    if not isinstance(ultimo, (int, float)) or ahora <= ultimo:
        return False
    delta = int(ahora - ultimo)
    if c.get("estado") in ESTADOS_DE_ESPERA_HUMANA:
        c["esperaHumanaMs"] = int(c.get("esperaHumanaMs") or 0) + delta
        return True
    if c.get("estado") in ESTADOS_DE_PAUSA_DEL_PROCESO:
        c["pausaMs"] = int(c.get("pausaMs") or 0) + delta
        return True
    if delta > UMBRAL_SUSPENSION_MS:
        c["pausaMs"] = int(c.get("pausaMs") or 0) + delta
        return True
    return False


def _condicion_de_parada(texto: str, numero: int, c: dict[str, Any], ahora: int | None = None, mision: dict[str, Any] | None = None) -> str | None:
    """Solo se automatiza lo que se puede medir en el texto de la condición:
    "N iteraciones", "N minutos" u "N horas" de corrida, y "N llamadas".
    Lo demás ("cuando el modelo de mundo deje de cambiar") lo decide la
    investigadora con el botón de detener. Devuelve el motivo o None.
    Además, el presupuesto de la misión en dinero y en horas para la corrida,
    y la parada propia de la corrida (`c["parada"]`: horas, iteraciones,
    llamadas o texto fijados al crearla), lo que llegue primero."""
    ahora = ahora if ahora is not None else P.ahora_ms()
    propia = c.get("parada") or {}
    if propia:
        horas_propias = propia.get("horas")
        if horas_propias and tiempo_trabajo_ms(c, ahora) / 3_600_000 >= float(horas_propias):
            return f"Se cumplió el tiempo fijado para esta corrida ({PARADA.resumen_parada({'horas': horas_propias})})"
        if propia.get("iteraciones") and numero >= int(propia["iteraciones"]):
            return f"Se alcanzaron las {int(propia['iteraciones'])} iteraciones fijadas para esta corrida"
        if propia.get("llamadas") and c["gasto"].get("llamadas", 0) >= int(propia["llamadas"]):
            return f"Se alcanzaron las {int(propia['llamadas'])} llamadas fijadas para esta corrida"
        # Parada por peldaños: N hipótesis han llegado al nivel de certeza pedido.
        if propia.get("certeza") and PROG.hipotesis_en_nivel(c, str(propia["certeza"])) >= int(propia.get("cuantas") or 1):
            n = PROG.hipotesis_en_nivel(c, str(propia["certeza"]))
            return f"{n} {'hipótesis alcanzó' if n == 1 else 'hipótesis alcanzaron'} la certeza {str(propia['certeza']).replace('_', ' ')} fijada para esta corrida"
        # Parada por estancamiento: iteraciones seguidas sin subir ningún peldaño ni añadir hechos.
        if propia.get("sinCambio") and PROG.iteraciones_sin_avance(c) >= int(propia["sinCambio"]):
            return f"{int(propia['sinCambio'])} iteraciones seguidas sin subir ninguna hipótesis de certeza ni añadir hechos, límite fijado para esta corrida"
        if propia.get("texto"):
            motivo_texto = _parada_por_texto(str(propia["texto"]), numero, c, ahora)
            if motivo_texto:
                return motivo_texto + " (fijada para esta corrida)"
    # Lo que la persona fijó para esta corrida manda sobre la condición general de
    # la investigación en ese mismo eje: con "3 horas" en la corrida, el "1 hora"
    # de la investigación no la cierra (pasó en la corrida 9). El presupuesto de la
    # misión sigue contando siempre.
    omitir = {eje for eje, clave in (("tiempo", "horas"), ("iteraciones", "iteraciones"), ("llamadas", "llamadas")) if propia.get(clave)}
    return _parada_por_texto(texto, numero, c, ahora, mision, omitir=frozenset(omitir))


def _parada_por_texto(texto: str, numero: int, c: dict[str, Any], ahora: int, mision: dict[str, Any] | None = None, omitir: frozenset[str] = frozenset()) -> str | None:
    """`omitir`: ejes ("tiempo", "iteraciones", "llamadas") que la corrida ya fijó por
    su cuenta y que el texto de la investigación no debe volver a aplicar."""
    t = texto.lower()
    if mision and mision.get("presupuesto"):
        pres = mision["presupuesto"]
        usd = c["gasto"].get("usd", 0.0)
        if pres.get("usd") and usd >= pres["usd"]:
            return f"Se alcanzó el presupuesto de la misión en dinero ({usd:.2f} de {pres['usd']:.2f} USD estimados)"
        horas = tiempo_trabajo_ms(c, ahora) / 3_600_000
        if pres.get("horas") and horas >= pres["horas"]:
            return f"Se alcanzó el presupuesto de la misión en tiempo ({horas:.1f} de {pres['horas']:.0f} horas)"
    m = re.search(r"(\d+)\s*iteraci", t)
    if m and "iteraciones" not in omitir and numero >= int(m.group(1)):
        return f"Se alcanzaron las {m.group(1)} iteraciones de la condición de parada"
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(min\b|minuto|hora|h\b|dia|día)", t)
    if m and "tiempo" not in omitir:
        n = float(m.group(1).replace(",", "."))
        unidad = m.group(2)
        segundos = n * (60 if unidad.startswith("min") else 3600 if unidad in ("hora", "h") or unidad.startswith("hora") else 86400)
        transcurrido = tiempo_trabajo_ms(c, ahora) / 1000
        if transcurrido >= segundos:
            return f"Se cumplio el tiempo de la condición de parada ({m.group(1)} {unidad.rstrip('.')}{'' if unidad.endswith('s') or unidad in ('h', 'min') else 's'})"
    m = re.search(r"(\d+)\s*llamadas", t)
    if m and "llamadas" not in omitir and c["gasto"]["llamadas"] >= int(m.group(1)):
        return f"Se alcanzaron las {m.group(1)} llamadas de la condición de parada"
    return None


def _informe(inv: dict[str, Any], it: dict[str, Any], resumen: str, hechos: list[dict], hipotesis: list[dict], afs: list[dict], bloqueadas: list[dict], consultas: list[dict] | None = None) -> str:
    lineas = [f"# {inv['titulo']}: iteración {it['numero']}", "", resumen, "", "## Plan ejecutado", T.plan_ejecutado(it), "", f"## Hechos nuevos ({len(hechos)})"]
    lineas += [f"- {h['enunciado']} <" + "; ".join(f"{p['referencia']}{', pág. ' + str(p['pagina']) if p['pagina'] else ''}" for p in h["procedencia"]) + ">" for h in hechos] or ["Ninguno"]
    lineas += ["", f"## Hipótesis nuevas en la cola ({len(hipotesis)})"] + ([f"- {h['titulo']}" for h in hipotesis] or ["Ninguna"])
    lineas += ["", f"## Afirmaciones ({len(afs)}), bloqueadas {len(bloqueadas)}"]
    for a in afs[:80]:
        lineas.append(f"- [{a['veredicto']}] {a['texto']} {a['cita']}" + (f" ({a['motivo']})" if a["veredicto"] != "sostenida" else ""))
    lineas += ["", f"## Consultas hechas ({len(consultas or [])})"] + ([f"- {q.get('base', '')}: {q.get('consulta', '')} ({q.get('resultados', '?')} resultados, {datetime.fromtimestamp(q['fecha'] / 1000).strftime('%d/%m/%Y') if q.get('fecha') else 'sin fecha'})" for q in (consultas or [])] or ["Ninguna en esta iteración"])
    return "\n".join(lineas)
