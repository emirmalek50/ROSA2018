"""El vigilante de modelos (rosa/vigilante_modelos.py) y `Ctx.llamar`.

Regla de Emir (TRASPASO.md 7.4): cuando GPT-6 Astra u Opus 5 no responden,
ROSA2018 reintenta con el MISMO modelo; nunca cae a Sonnet. Aquí se comprueba
con dobles: un programa falso cuyo `acall` duerme o lanza, un modelo de volumen
que hace fallar el test si alguien lo toca, ganchos que registran en vez de
escribir, y el dormir anulado para no esperar. Ningún test sale a la red.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import dspy
import httpx
import pytest

from rosa import gateway as GW
from rosa import vigilante_modelos as VIG
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado.almacen import Almacen
from rosa.modulos import contador as CT
from rosa.modulos.contador import ContextoLlamada, PresupuestoAgotado, contexto_actual

ASTRA = "openai/openai/gpt-6-astra"  # `lm.model` tal como lo construye gateway.lm
OPUS = "openai/anthropic/claude-opus-5"
SONNET = "openai/anthropic/claude-sonnet-5"


# ---------------------------------------------------------------------------
# Dobles
# ---------------------------------------------------------------------------


class LMFalso:
    """Un dspy.LM de mentira: `model`, `kwargs` y `copy(rollout_id=...)`."""

    def __init__(self, model: str, rollout_id: int | None = None) -> None:
        self.model = model
        self.kwargs: dict[str, Any] = {} if rollout_id is None else {"rollout_id": rollout_id}

    def copy(self, **kw: Any) -> "LMFalso":
        return LMFalso(self.model, kw.get("rollout_id"))


class VolumenProhibido(LMFalso):
    """Sonnet: si alguien lo copia o lo pone en contexto, el test falla."""

    def __init__(self) -> None:
        super().__init__(SONNET)

    def copy(self, **kw: Any) -> "LMFalso":
        pytest.fail("se intentó usar el modelo de volumen (Sonnet) para otro rol")


class ProgramaFalso:
    """`acall` sigue un plan: cada entrada es una excepción a lanzar, la cadena
    "duerme" (duerme `segundos` reales, más que el umbral del test) o un valor
    a devolver. Registra qué modelo y qué rollout_id vio en cada llamada."""

    def __init__(self, *plan: Any, segundos: float = 0.3) -> None:
        self.plan = list(plan)
        self.segundos = segundos
        self.vistos: list[tuple[str | None, int | None]] = []
        self.al_ver: Any = None  # callable(n) que se ejecuta en cada llamada (para mirar el estado a mitad)

    async def acall(self, **kw: Any) -> Any:
        lm = dspy.settings.lm
        modelo = getattr(lm, "model", None)
        if modelo == SONNET:
            pytest.fail("el programa se ejecutó con Sonnet en contexto")
        self.vistos.append((modelo, (getattr(lm, "kwargs", None) or {}).get("rollout_id")))
        if self.al_ver is not None:
            self.al_ver(len(self.vistos))
        paso = self.plan.pop(0) if self.plan else "ok"
        if isinstance(paso, BaseException):
            raise paso
        if paso == "duerme":
            await asyncio.sleep(self.segundos)
            return "tarde"
        return paso


class Registro:
    """Ganchos que anotan lo que el vigilante quiso hacer, sin estado."""

    def __init__(self, sondeos: list[bool] | None = None, ahora: int = 1_700_000_000_000) -> None:
        self.salud: list[tuple[str, str, dict[str, Any]]] = []
        self.incidencias: list[tuple[str, dict[str, Any]]] = []
        self.eventos: list[tuple[str, str]] = []
        self.dormidas: list[float] = []
        self.sondeos = list(sondeos or [])
        self.sondeos_hechos = 0
        self.t = ahora

    def ganchos(self) -> VIG.Ganchos:
        async def dormir(s: float) -> None:
            self.dormidas.append(s)
            self.t += int(s * 1000)

        async def sondear(lm: Any) -> bool:
            self.sondeos_hechos += 1
            return self.sondeos.pop(0) if self.sondeos else False

        def ahora() -> int:
            self.t += 1
            return self.t

        return VIG.Ganchos(
            dormir=dormir,
            sondear=sondear,
            incidencia=lambda a, d: self.incidencias.append((a, d)),
            evento=lambda t, x: self.eventos.append((t, x)),
            salud=lambda r, m, c: self.salud.append((r, m, c)),
            ahora=ahora,
        )

    def fases(self) -> list[str]:
        return [c["fase"] for _, _, c in self.salud]


def _ejecutor(programa: ProgramaFalso):
    async def ejecutar(modelo: Any) -> Any:
        with dspy.context(lm=modelo):
            return await programa.acall()

    return ejecutar


def _umbral_corto(monkeypatch: pytest.MonkeyPatch, segundos: float = 0.02) -> None:
    for rol in ("cerebro", "juez", "volumen", "replica"):
        monkeypatch.setitem(VIG.TIEMPO_AVISO_S, rol, segundos)


# ---------------------------------------------------------------------------
# llamar_vigilado con ganchos que registran
# ---------------------------------------------------------------------------


def test_las_constantes_del_contrato_compartido():
    assert VIG.TIEMPO_AVISO_S == {"cerebro": 240, "juez": 300, "volumen": 120, "replica": 300}
    assert VIG.ESPERAS_S == (15, 30, 60, 60) and VIG.MAX_INTENTOS == 4 and VIG.INTERVALO_SONDEO_S == 60
    assert PASOS.SEGUNDOS_MAX_LLAMADA == 300, "el tope de una llamada ya es el mayor tiempo por rol, no 600 s"
    assert issubclass(VIG.ModeloSinRespuesta, RuntimeError) and issubclass(VIG.ModeloBloqueado, RuntimeError)


def test_un_intento_que_supera_el_umbral_se_corta_se_reintenta_y_se_recupera(monkeypatch):
    _umbral_corto(monkeypatch)
    programa = ProgramaFalso("duerme", "ok")
    reg = Registro()
    r = asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert r == "ok" and len(programa.vistos) == 2, "el intento que pasó del umbral se cortó y se repitió con el mismo modelo"
    assert programa.vistos == [(ASTRA, None), (ASTRA, None)]
    # Tras un corte por tiempo, el sondeo va ANTES de contar el fallo: decide si el
    # modelo está caído (no responde: fallo, espera) o solo lento con esta petición.
    assert reg.fases() == ["sondeo", "fallo", "ok"]
    assert reg.sondeos_hechos == 1, "el sondeo del corte no se repite al empezar la espera"
    fallo = reg.salud[1][2]
    assert fallo["intentos"] == 1 and fallo["agotado"] is False and "TimeoutError" in fallo["error"]
    assert isinstance(fallo["ultimoSondeo"], int), "la espera de la corrida sabe cuándo fue el sondeo del corte"
    assert fallo["proximoIntentoEn"] - fallo["ahora"] == 15_000, "la primera espera es ESPERAS_S[0]"
    ok = reg.salud[-1][2]
    assert ok["recuperado"] is True and ok["intentos"] == 1 and ok["latenciaMs"] >= 0
    assert [a for a, _ in reg.incidencias] == ["abrir", "resolver"]
    assert reg.incidencias[0][1]["alternativa"] == "ROSA2018 lo está resolviendo sola: reintenta con GPT-6 Astra cada pocos segundos"
    assert "intento 1 de 4" in reg.incidencias[0][1]["detalle"]
    assert reg.dormidas == [15]
    tipos = [t for t, _ in reg.eventos]
    assert tipos == ["modelo_sin_respuesta", "modelo_recuperado"]
    assert reg.eventos[0][1].startswith("GPT-6 Astra no responde desde las ") and reg.eventos[0][1].endswith("; ROSA2018 reintenta sola")
    assert reg.eventos[1][1] == "GPT-6 Astra volvió tras 1 intento y menos de un minuto"


def test_un_modelo_lento_pero_dentro_del_umbral_no_es_un_fallo(monkeypatch):
    _umbral_corto(monkeypatch, 0.5)
    programa = ProgramaFalso("duerme", segundos=0.01)
    reg = Registro()
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "juez", LMFalso(OPUS), ganchos=reg.ganchos())) == "tarde"
    assert reg.fases() == ["ok"] and reg.salud[0][2]["recuperado"] is False
    assert reg.incidencias == [] and reg.eventos == [] and reg.dormidas == []


def test_falla_dos_veces_y_responde_a_la_tercera():
    programa = ProgramaFalso(httpx.ConnectError("no hay ruta al gateway"), TimeoutError(), "respuesta")
    reg = Registro()
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "juez", LMFalso(OPUS), ganchos=reg.ganchos())) == "respuesta"
    assert len(programa.vistos) == 3 and {m for m, _ in programa.vistos} == {OPUS}
    assert reg.dormidas == [15, 30], "las esperas crecen según ESPERAS_S"
    assert [c["intentos"] for _, _, c in reg.salud if c["fase"] == "fallo"] == [1, 2]
    assert [a for a, _ in reg.incidencias] == ["abrir", "actualizar", "resolver"]
    assert "intento 2 de 4" in reg.incidencias[1][1]["detalle"]
    assert [t for t, _ in reg.eventos] == ["modelo_sin_respuesta", "modelo_recuperado"], "un evento al caer y otro al volver, no uno por intento"
    assert reg.eventos[1][1].startswith("Claude Opus 5 volvió tras 2 intentos y ")


def test_un_modelo_que_falla_siempre_lanza_modelo_sin_respuesta_tras_cuatro_intentos():
    programa = ProgramaFalso(*[TimeoutError()] * 10)
    reg = Registro()
    with pytest.raises(VIG.ModeloSinRespuesta) as info:
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    ex = info.value
    assert ex.intentos == 4 and ex.rol == "cerebro" and ex.modelo == "openai/gpt-6-astra" and ex.nombre == "GPT-6 Astra"
    assert "no cambia de modelo" in str(ex)
    assert len(programa.vistos) == 4, "cuatro intentos, ni uno más"
    assert reg.dormidas == [15, 30, 60], "tras el cuarto fallo no se espera: se lanza"
    fallos = [c for _, _, c in reg.salud if c["fase"] == "fallo"]
    assert [c["intentos"] for c in fallos] == [1, 2, 3, 4] and fallos[-1]["agotado"] is True
    assert fallos[-1]["proximoIntentoEn"] - fallos[-1]["ahora"] == VIG.INTERVALO_SONDEO_S * 1000, "al agotar, el siguiente intento es el sondeo del supervisor"
    assert [a for a, _ in reg.incidencias] == ["abrir", "actualizar", "actualizar", "actualizar"], "la incidencia no se resuelve: queda pendiente"
    assert "4 intentos seguidos" in reg.incidencias[-1][1]["detalle"] and "no cambia de modelo" in reg.incidencias[-1][1]["detalle"]
    assert [t for t, _ in reg.eventos] == ["modelo_sin_respuesta"]


def test_un_sondeo_que_responde_acorta_la_espera():
    programa = ProgramaFalso(TimeoutError(), "ok")
    reg = Registro(sondeos=[True])
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos())) == "ok"
    assert reg.dormidas == [], "el sondeo respondió: se reintenta sin agotar la espera"
    assert reg.sondeos_hechos == 1
    sondeo = next(c for _, _, c in reg.salud if c["fase"] == "sondeo")
    assert sondeo["respondio"] is True and isinstance(sondeo["ultimoSondeo"], int)


def test_la_espera_se_trocea_por_el_intervalo_de_sondeo(monkeypatch):
    monkeypatch.setattr(VIG, "ESPERAS_S", (150,))
    programa = ProgramaFalso(TimeoutError(), "ok")
    reg = Registro()
    asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert reg.dormidas == [60, 60, 30]
    assert reg.sondeos_hechos == 3, "uno antes de dormir y uno entre trozos; ninguno tras el último"


def test_un_sondeo_que_lanza_cuenta_como_no_respondio():
    programa = ProgramaFalso(TimeoutError(), "ok")
    reg = Registro()
    g = reg.ganchos()

    async def sondear_roto(lm: Any) -> bool:
        raise RuntimeError("el sondeo se rompió")

    g.sondear = sondear_roto
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=g)) == "ok"
    assert reg.dormidas == [15]


def test_un_vacio_en_el_cerebro_varia_el_rollout_id_y_luego_bloquea():
    programa = ProgramaFalso(*[RuntimeError("Empty response from the model")] * 5)
    reg = Registro()
    with pytest.raises(VIG.ModeloBloqueado) as info:
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert programa.vistos == [(ASTRA, None), (ASTRA, 1000), (ASTRA, 2000)], "mismo modelo, rollout_id distinto en cada reintento, dos reintentos"
    assert info.value.reintentos == 2 and "GPT-6 Astra" in str(info.value)
    assert reg.incidencias == [("bloqueo", reg.incidencias[0][1])]
    d = reg.incidencias[0][1]
    assert d["modelo"] == "openai/gpt-6-astra" and "no sustituye a GPT-6 Astra" in d["alternativa"]
    assert reg.eventos == [] and reg.dormidas == [], "un bloqueo por contenido no es una caída del modelo"


def test_un_vacio_que_se_arregla_con_otro_rollout_devuelve_el_resultado():
    programa = ProgramaFalso(RuntimeError("AdapterParseError: no output"), "ahora sí")
    reg = Registro()
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "juez", LMFalso(OPUS), ganchos=reg.ganchos())) == "ahora sí"
    assert programa.vistos == [(OPUS, None), (OPUS, 1000)]
    assert reg.incidencias == [] and reg.eventos == []


def test_los_reintentos_por_contenido_no_pisan_el_rollout_de_una_trayectoria():
    # La trayectoria 2 de réplica ya lleva rollout_id=2: sus reintentos no pueden
    # colisionar con las trayectorias 0..4 ni entre sí.
    programa = ProgramaFalso(RuntimeError("content filter"), RuntimeError("content filter"), "ok")
    reg = Registro()
    asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "replica", LMFalso(OPUS, rollout_id=2), ganchos=reg.ganchos()))
    assert programa.vistos == [(OPUS, 2), (OPUS, 1002), (OPUS, 2002)]


def test_el_volumen_con_vacio_no_reintenta_ni_abre_incidencia():
    programa = ProgramaFalso(RuntimeError("Empty response"))
    reg = Registro()
    with pytest.raises(RuntimeError) as info:
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "volumen", LMFalso(SONNET.replace("openai/anthropic", "openai/x")), ganchos=reg.ganchos()))
    assert not isinstance(info.value, VIG.ModeloBloqueado) and len(programa.vistos) == 1
    assert reg.incidencias == []


def test_un_fallo_que_no_es_transitorio_ni_de_contenido_se_propaga_sin_reintentar():
    programa = ProgramaFalso(ValueError("la firma no tiene ese campo"))
    reg = Registro()
    with pytest.raises(ValueError):
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert len(programa.vistos) == 1 and reg.incidencias == [] and reg.fases() == []


def test_presupuesto_agotado_dentro_de_la_llamada_se_propaga_tal_cual():
    programa = ProgramaFalso(PresupuestoAgotado("sin presupuesto"))
    reg = Registro()
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert len(programa.vistos) == 1 and reg.fases() == []


def test_clasificar_fallo_distingue_transitorio_contenido_y_otro():
    import litellm
    from dspy.utils.exceptions import AdapterParseError

    transitorios = [
        TimeoutError(),
        asyncio.TimeoutError(),
        ConnectionError("reset"),
        httpx.ConnectTimeout("t"),
        httpx.ReadError("r"),
        litellm.Timeout("m", "x", "openai"),
        litellm.APIConnectionError("m", "openai", "x"),
        litellm.RateLimitError("m", "openai", "x"),
        litellm.InternalServerError("m", "openai", "x"),
        litellm.ServiceUnavailableError("m", "openai", "x"),
        RuntimeError("Connection reset by peer"),
        RuntimeError("502 Bad Gateway"),
        SimpleNamespace(status_code=503) and type("Raro", (Exception,), {"status_code": 503})("x"),
    ]
    for ex in transitorios:
        assert VIG.clasificar_fallo(ex) == "transitorio", repr(ex)
    contenidos = [
        litellm.ContentPolicyViolationError("m", "x", "openai"),
        RuntimeError("Empty response from model"),
        RuntimeError("The model refused to answer"),
        RuntimeError("no output fields"),
        AdapterParseError("ChatAdapter", dspy.Signature("a -> b"), "respuesta rota"),
    ]
    for ex in contenidos:
        assert VIG.clasificar_fallo(ex) == "contenido", repr(ex)
    otros = [ValueError("x"), litellm.BadRequestError("m", "x", "openai"), KeyError("campo"), RuntimeError("api_base=https://ai-gateway.vercel.sh/v1 rechazó la petición")]
    for ex in otros:
        assert VIG.clasificar_fallo(ex) == "otro", repr(ex)


def test_nombres_y_textos_en_llano():
    assert VIG.id_modelo(LMFalso(ASTRA)) == "openai/gpt-6-astra" and VIG.id_modelo(LMFalso(OPUS)) == "anthropic/claude-opus-5"
    assert VIG.id_modelo(LMFalso("juez")) == "juez", "un id sin el doble prefijo se deja tal cual"
    assert VIG.nombre_de_modelo(ASTRA) == "GPT-6 Astra" and VIG.nombre_de_modelo("anthropic/claude-sonnet-5") == "Claude Sonnet 5"
    assert VIG.nombre_de_modelo("anthropic/claude-sonnet-5.5") == "Claude Sonnet 5.5"
    assert VIG.nombre_de_modelo("openai/anthropic/claude-sonnet-5.5") == "Claude Sonnet 5.5"
    assert VIG.nombre_de_modelo("openai/proveedor/modelo-raro-9") == "Modelo Raro 9"
    assert VIG.duracion_texto(30_000) == "menos de un minuto" and VIG.duracion_texto(60_000) == "1 minuto"
    assert VIG.duracion_texto(59 * 60_000) == "59 minutos" and VIG.duracion_texto(65 * 60_000) == "1 hora y 5 minutos"
    assert VIG.texto_evento_recuperado("GPT-6 Astra", 3, 0, 12 * 60_000) == "GPT-6 Astra volvió tras 3 intentos y 12 minutos"
    assert VIG.rollout_de_reintento(None, 1) == 1000 and VIG.rollout_de_reintento(4, 2) == 2004


# ---------------------------------------------------------------------------
# Reducers sobre el estado
# ---------------------------------------------------------------------------


def test_registrar_salud_tolera_un_estado_antiguo_y_cuenta_una_caida_por_bajada():
    e: dict[str, Any] = {"corridas": []}  # sin `saludModelos`
    c1 = {"fase": "fallo", "ahora": 1000, "intentos": 1, "desde": 900, "proximoIntentoEn": 16_000, "agotado": False}
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", c1) is True
    s = e["saludModelos"]["cerebro"]
    assert s["estado"] == "lento" and s["intentos"] == 1 and s["desde"] == 900 and s["caidas"] == 1 and s["proximoIntentoEn"] == 16_000
    # Otra corrida ve caer el mismo modelo un poco después: misma caída, `desde` el más antiguo.
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "fallo", "ahora": 1200, "intentos": 1, "desde": 1100, "proximoIntentoEn": 16_200, "agotado": False}) is False, "nada nuevo que escribir: no sube la versión del estado"
    s = e["saludModelos"]["cerebro"]
    assert s["caidas"] == 1 and s["desde"] == 900 and s["proximoIntentoEn"] == 16_000
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "fallo", "ahora": 17_000, "intentos": 2, "desde": 900, "proximoIntentoEn": 47_000, "agotado": False}) is True
    assert e["saludModelos"]["cerebro"]["estado"] == "sin_respuesta" and e["saludModelos"]["cerebro"]["intentos"] == 2
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "sondeo", "ahora": 18_000, "ultimoSondeo": 18_000, "respondio": False}) is False, "un sondeo no toca la salud"
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "ok", "ahora": 50_000, "latenciaMs": 3210, "recuperado": True, "intentos": 2, "desde": 900}) is True
    s = e["saludModelos"]["cerebro"]
    assert s["estado"] == "ok" and s["intentos"] == 0 and s["proximoIntentoEn"] is None and s["recuperadoEn"] == 50_000 and s["ultimaLatenciaMs"] == 3210 and s["caidas"] == 1
    # Con salud ok, un éxito seguido no reescribe el estado antes de REFRESCO_SALUD_MS.
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "ok", "ahora": 50_500, "latenciaMs": 100, "recuperado": False, "intentos": 0, "desde": None}) is False
    assert VIG.registrar_salud(e, "cerebro", "openai/gpt-6-astra", {"fase": "ok", "ahora": 50_000 + VIG.REFRESCO_SALUD_MS, "latenciaMs": 100, "recuperado": False, "intentos": 0, "desde": None}) is True
    assert e["saludModelos"]["cerebro"]["ultimaLatenciaMs"] == 100
    # Un valor corrupto en la raíz se sustituye sin romper.
    e2: dict[str, Any] = {"saludModelos": None}
    assert VIG.registrar_salud(e2, "juez", "anthropic/claude-opus-5", {"fase": "ok", "ahora": 1, "latenciaMs": 5, "recuperado": False, "intentos": 0, "desde": None}) is True
    assert e2["saludModelos"]["juez"]["estado"] == "ok"


def test_fijar_y_quitar_la_espera_respetan_las_pausas_a_mano():
    e: dict[str, Any] = {"corridas": [{"id": "c1", "estado": "en_marcha"}], "iteraciones": [{"id": "it1", "corridaId": "c1", "plan": [{"id": "p1", "estado": "hecho"}, {"id": "p2", "estado": "en_curso"}]}]}
    cambio = {"fase": "fallo", "ahora": 1000, "intentos": 1, "desde": 900, "proximoIntentoEn": 16_000, "agotado": False}
    assert VIG.fijar_espera_modelo(e, "c1", "it1", "cerebro", "openai/gpt-6-astra", cambio) is True
    c = e["corridas"][0]
    assert c["estado"] == "esperando_modelo"
    assert c["esperandoModelo"] == {"rol": "cerebro", "modelo": "openai/gpt-6-astra", "desde": 900, "ultimoSondeo": None, "proximoSondeo": 16_000, "pasoId": "p2", "intentos": 1}
    assert VIG.anotar_sondeo(e, "c1", {"fase": "sondeo", "ahora": 1500, "ultimoSondeo": 1400, "respondio": False}) is True
    assert c["esperandoModelo"]["ultimoSondeo"] == 1400
    assert VIG.quitar_espera_modelo(e, "c1") is True and c["estado"] == "en_marcha" and c["esperandoModelo"] is None
    assert VIG.quitar_espera_modelo(e, "c1") is False, "sin nada que quitar no se escribe"
    # Una pausa hecha a mano mientras el modelo no responde se respeta en los dos sentidos.
    c["estado"] = "pausada"
    VIG.fijar_espera_modelo(e, "c1", "it1", "cerebro", "openai/gpt-6-astra", cambio)
    assert c["estado"] == "pausada" and c["esperandoModelo"]["intentos"] == 1
    VIG.quitar_espera_modelo(e, "c1")
    assert c["estado"] == "pausada" and c["esperandoModelo"] is None
    assert VIG.fijar_espera_modelo(e, "no-existe", None, "cerebro", "m", cambio) is False


def test_reinicio_con_una_corrida_que_ya_esperaba_conserva_el_desde_mas_antiguo():
    # El proceso anterior dejó la corrida en `esperando_modelo` con su registro; el
    # nuevo proceso vuelve a fallar con el mismo modelo.
    e: dict[str, Any] = {"corridas": [{"id": "c1", "estado": "esperando_modelo", "esperandoModelo": {"rol": "cerebro", "modelo": "openai/gpt-6-astra", "desde": 100, "ultimoSondeo": 500, "proximoSondeo": 600, "pasoId": "p1", "intentos": 4}}], "iteraciones": []}
    VIG.fijar_espera_modelo(e, "c1", None, "cerebro", "openai/gpt-6-astra", {"fase": "fallo", "ahora": 2000, "intentos": 1, "desde": 1900, "proximoIntentoEn": 17_000, "agotado": False})
    esp = e["corridas"][0]["esperandoModelo"]
    assert esp["desde"] == 100 and esp["intentos"] == 4 and esp["ultimoSondeo"] == 500 and esp["proximoSondeo"] == 17_000
    # Si lo que espera ahora es otro modelo, el registro es nuevo.
    VIG.fijar_espera_modelo(e, "c1", None, "juez", "anthropic/claude-opus-5", {"fase": "fallo", "ahora": 3000, "intentos": 1, "desde": 2900, "proximoIntentoEn": 18_000, "agotado": False})
    esp = e["corridas"][0]["esperandoModelo"]
    assert esp["modelo"] == "anthropic/claude-opus-5" and esp["desde"] == 2900 and esp["intentos"] == 1


def test_incidencia_sin_respuesta_se_abre_una_vez_se_actualiza_y_se_resuelve():
    e: dict[str, Any] = {}  # ni `incidencias` hay
    datos = {"modelo": "openai/gpt-6-astra", "nombre": "GPT-6 Astra", "detalle": "intento 1", "ahora": 1000, "alternativa": VIG.texto_alternativa("GPT-6 Astra")}
    assert VIG.abrir_incidencia_sin_respuesta(e, "c1", datos) is True
    assert VIG.abrir_incidencia_sin_respuesta(e, "c1", datos) is False, "veinte llamadas en paralelo abren una sola"
    assert VIG.abrir_incidencia_sin_respuesta(e, "c2", datos) is True, "otra corrida tiene la suya"
    inc = e["incidencias"][0]
    assert inc["tipo"] == "modelo_sin_respuesta" and inc["titulo"] == "GPT-6 Astra no responde" and inc["recurso"] == "openai/gpt-6-astra" and inc["estado"] == "pendiente"
    assert VIG.actualizar_incidencia_sin_respuesta(e, "c1", {**datos, "detalle": "intento 2"}) is True and inc["detalle"] == "intento 2"
    assert VIG.actualizar_incidencia_sin_respuesta(e, "c1", {**datos, "detalle": "intento 2"}) is False
    assert VIG.resolver_incidencia_sin_respuesta(e, "c1", {**datos, "detalle": "volvió", "ahora": 5000}) is True
    assert inc["estado"] == "resuelta" and inc["resueltaEn"] == 5000 and inc["detalle"] == "volvió" and inc["resolucion"]
    assert VIG.resolver_incidencia_sin_respuesta(e, "c1", datos) is False, "ya resuelta: no hay segundo evento"
    assert VIG.actualizar_incidencia_sin_respuesta(e, "c1", {**datos, "detalle": "de nuevo"}) is True, "sin pendiente (tras un reinicio) se abre con el detalle actual"
    assert len([i for i in e["incidencias"] if i["corridaId"] == "c1"]) == 2


# ---------------------------------------------------------------------------
# Ctx.llamar con un almacén real
# ---------------------------------------------------------------------------


def _ctx(inv: str = "inv", con_iteracion: bool = True) -> tuple[Almacen, Ctx]:
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    return al, _otra_corrida(al, inv, con_iteracion)


def _otra_corrida(al: Almacen, inv: str, con_iteracion: bool = True) -> Ctx:
    al.aplicar("crearInvestigacion", {"datos": {"titulo": inv, "objetivo": "Astrocitos en el Alzheimer", "condicionParada": "1 iteración"}, "id_": inv})
    cid = al.aplicar("iniciarCorrida", {"investigacion_id": inv})
    it_id = f"it-{inv}"

    def preparar(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == cid)
        c["estado"] = "en_marcha"
        if con_iteracion:
            e["iteraciones"].append({"id": it_id, "corridaId": cid, "numero": 1, "plan": [{"id": "paso-1", "estado": "en_curso"}], "pistas": [], "planAprobado": True, "terminadaEn": None, "presupuesto": {"limite": None, "usado": 0}})
        return True

    al.mutar(preparar, "test")
    modelos = SimpleNamespace(cerebro=LMFalso(ASTRA), juez=LMFalso(OPUS), volumen=VolumenProhibido(), replica=LMFalso(OPUS))
    return Ctx(al, None, modelos, cid, inv, it_id if con_iteracion else "", 1)


def _sin_red_ni_esperas(monkeypatch: pytest.MonkeyPatch, sondeos: list[bool] | None = None, dormir_real_s: float = 0.0) -> dict[str, Any]:
    """Los ganchos reales de la corrida, pero sin dormir ni salir a la red.
    `dormir_real_s` > 0 duerme ese poco de verdad, para que dos corridas en
    paralelo se crucen como se cruzarían con las esperas reales."""
    original = VIG.ganchos_de_contexto
    marcas: dict[str, Any] = {"dormidas": [], "sondeos": 0}
    respuestas = list(sondeos or [])

    def parche(ctx: Any) -> VIG.Ganchos:
        g = original(ctx)

        async def dormir(s: float) -> None:
            marcas["dormidas"].append(s)
            if dormir_real_s > 0:
                await asyncio.sleep(dormir_real_s)

        async def sondear(lm: Any) -> bool:
            marcas["sondeos"] += 1
            return respuestas.pop(0) if respuestas else False

        g.dormir = dormir
        g.sondear = sondear
        return g

    monkeypatch.setattr(VIG, "ganchos_de_contexto", parche)
    return marcas


def _corrida(al: Almacen | dict[str, Any], cid: str) -> dict[str, Any]:
    """La corrida `cid` de un almacén o de un estado ya cargado (dentro de un reducer)."""
    estado = al if isinstance(al, dict) else al.estado
    return next(c for c in estado["corridas"] if c["id"] == cid)


def test_ctx_llamar_deja_ver_la_espera_y_la_recuperacion_en_el_estado(monkeypatch):
    marcas = _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    programa = ProgramaFalso(TimeoutError(), "ok")
    a_mitad: dict[str, Any] = {}

    def mirar(n: int) -> None:
        if n == 2:
            c = _corrida(al, ctx.corrida_id)
            a_mitad["estado"] = c["estado"]
            a_mitad["espera"] = dict(c["esperandoModelo"])
            a_mitad["salud"] = dict(al.estado["saludModelos"]["cerebro"])
            a_mitad["incidencias"] = [dict(i) for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id]

    programa.al_ver = mirar
    assert asyncio.run(ctx.llamar("cerebro", programa, x=1)) == "ok"
    assert programa.vistos == [(ASTRA, None), (ASTRA, None)]
    # Mientras esperaba: la corrida en `esperando_modelo`, con qué esperaba; la salud del cerebro "lento"; la incidencia abierta con la alternativa.
    assert a_mitad["estado"] == "esperando_modelo"
    esp = a_mitad["espera"]
    assert esp["rol"] == "cerebro" and esp["modelo"] == "openai/gpt-6-astra" and esp["intentos"] == 1 and esp["pasoId"] == "paso-1" and isinstance(esp["desde"], int) and isinstance(esp["ultimoSondeo"], int)
    assert a_mitad["salud"]["estado"] == "lento" and a_mitad["salud"]["caidas"] == 1 and a_mitad["salud"]["intentos"] == 1
    assert len(a_mitad["incidencias"]) == 1 and a_mitad["incidencias"][0]["tipo"] == "modelo_sin_respuesta" and a_mitad["incidencias"][0]["estado"] == "pendiente"
    assert a_mitad["incidencias"][0]["alternativa"] == "ROSA2018 lo está resolviendo sola: reintenta con GPT-6 Astra cada pocos segundos"
    # Al volver: en marcha, sin espera, salud ok, incidencia resuelta por ROSA2018 misma, dos eventos.
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
    s = al.estado["saludModelos"]["cerebro"]
    assert s["estado"] == "ok" and s["intentos"] == 0 and s["caidas"] == 1 and isinstance(s["recuperadoEn"], int) and isinstance(s["ultimaLatenciaMs"], int) and s["ultimaRespuestaEn"] >= s["recuperadoEn"]
    inc = [i for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id]
    assert len(inc) == 1 and inc[0]["estado"] == "resuelta" and isinstance(inc[0]["resueltaEn"], int) and "volvió tras 1 intento" in inc[0]["detalle"]
    tipos = [ev["tipo"] for ev in al.estado["eventos"] if ev["tipo"].startswith("modelo_")]
    assert tipos == ["modelo_sin_respuesta", "modelo_recuperado"]
    textos = {ev["tipo"]: ev["texto"] for ev in al.estado["eventos"] if ev["tipo"].startswith("modelo_")}
    assert textos["modelo_sin_respuesta"].startswith("GPT-6 Astra no responde desde las ") and textos["modelo_recuperado"].startswith("GPT-6 Astra volvió tras 1 intento")
    assert marcas["dormidas"] == [15] and marcas["sondeos"] == 1
    # La instantánea pública lleva la salud y la espera (no son claves privadas).
    pub = al.instantanea()
    assert "saludModelos" in pub and "esperandoModelo" in pub["corridas"][0]
    al.cerrar()


def test_ctx_llamar_con_el_modelo_caido_deja_la_incidencia_pendiente_y_la_corrida_esperando(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    programa = ProgramaFalso(*[httpx.ReadTimeout("el gateway no contesta")] * 8)
    with pytest.raises(VIG.ModeloSinRespuesta) as info:
        asyncio.run(ctx.llamar("juez", programa, x=1))
    assert info.value.intentos == 4 and len(programa.vistos) == 4 and {m for m, _ in programa.vistos} == {OPUS}
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["intentos"] == 4 and c["esperandoModelo"]["rol"] == "juez"
    assert isinstance(c["esperandoModelo"]["proximoSondeo"], int), "el supervisor sabe cuándo toca el siguiente sondeo"
    s = al.estado["saludModelos"]["juez"]
    assert s["estado"] == "sin_respuesta" and s["intentos"] == 4 and s["modelo"] == "anthropic/claude-opus-5"
    inc = [i for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id]
    assert len(inc) == 1 and inc[0]["estado"] == "pendiente" and "4 intentos seguidos" in inc[0]["detalle"]
    tipos = [ev["tipo"] for ev in al.estado["eventos"] if ev["tipo"].startswith("modelo_")]
    assert tipos == ["modelo_sin_respuesta"]
    al.cerrar()


def test_ctx_llamar_con_vacio_en_el_cerebro_nunca_toca_a_sonnet(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    programa = ProgramaFalso(*[RuntimeError("Empty response from the model")] * 5)
    with pytest.raises(VIG.ModeloBloqueado):
        asyncio.run(ctx.llamar("cerebro", programa, x=1))
    assert programa.vistos == [(ASTRA, None), (ASTRA, 1000), (ASTRA, 2000)]
    tipos = {i["tipo"] for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id}
    assert tipos == {"modelo_bloqueado"}
    inc = next(i for i in al.estado["incidencias"] if i["tipo"] == "modelo_bloqueado")
    assert inc["recurso"] == "openai/gpt-6-astra" and "no sustituye a GPT-6 Astra" in inc["alternativa"]
    assert al.estado["saludModelos"] == {}, "un bloqueo por contenido no es una caída"
    assert _corrida(al, ctx.corrida_id)["estado"] == "en_marcha"
    fuente = " ".join((PASOS.Ctx.llamar.__doc__ or "").split())
    assert "Nunca se cambia de modelo" in fuente
    import inspect

    codigo = inspect.getsource(PASOS.Ctx.llamar)
    assert "Sonnet 5 automáticamente" not in codigo and "ejecutar(self.modelos.volumen)" not in codigo, "el respaldo a volumen se eliminó"
    al.cerrar()


def test_ctx_llamar_conserva_el_corte_de_presupuesto_antes_de_llamar(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()

    def sin_presupuesto(e: dict[str, Any]) -> bool:
        _corrida(e, ctx.corrida_id)["presupuesto"]["limiteLlamadas"] = 0
        return True

    al.mutar(sin_presupuesto, "test")
    programa = ProgramaFalso("ok")
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(ctx.llamar("cerebro", programa, x=1))
    assert programa.vistos == [], "no se llama al modelo sin presupuesto"
    al.cerrar()


def test_ctx_llamar_pone_el_contexto_del_contador_y_pasa_por_el_servicio_de_gepa(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    visto: dict[str, Any] = {}

    class Servicio:
        async def llamar(self, ctx_: Ctx, programa: Any, lm: Any, entradas: dict[str, Any]) -> Any:
            visto["contexto"] = contexto_actual.get()
            visto["lm"] = lm
            visto["entradas"] = entradas
            visto["llamadas"] = visto.get("llamadas", 0) + 1
            if visto["llamadas"] == 1:
                raise TimeoutError()
            return "por gepa"

    al.gepa_servicio = Servicio()  # type: ignore[attr-defined]
    assert asyncio.run(ctx.llamar("juez", ProgramaFalso(), rollout_id=3, pregunta="p")) == "por gepa"
    assert visto["llamadas"] == 2, "el reintento también pasa por el servicio"
    assert isinstance(visto["contexto"], ContextoLlamada) and visto["contexto"].rol == "juez" and visto["contexto"].corrida_id == ctx.corrida_id
    assert visto["lm"].model == OPUS and visto["lm"].kwargs["rollout_id"] == 3 and visto["entradas"] == {"pregunta": "p"}
    assert contexto_actual.get() is None, "el contexto se restaura al salir"
    al.cerrar()


def test_dos_corridas_esperando_al_mismo_modelo_a_la_vez(monkeypatch):
    # Las dos fallan a la vez y esperan (10 ms reales, para que se crucen) antes de
    # que ninguna se recupere: una sola caída del modelo, dos corridas que la vieron.
    _sin_red_ni_esperas(monkeypatch, dormir_real_s=0.01)
    al, ctx1 = _ctx("inv-a")
    ctx2 = _otra_corrida(al, "inv-b")
    p1 = ProgramaFalso(TimeoutError(), "uno")
    p2 = ProgramaFalso(TimeoutError(), "dos")

    async def las_dos() -> tuple[Any, Any]:
        return await asyncio.gather(ctx1.llamar("cerebro", p1, x=1), ctx2.llamar("cerebro", p2, x=2))

    assert asyncio.run(las_dos()) == ["uno", "dos"]
    s = al.estado["saludModelos"]["cerebro"]
    assert s["caidas"] == 1, "el mismo modelo cayó una vez aunque lo vieran dos corridas"
    assert s["estado"] == "ok" and s["intentos"] == 0
    for ctx in (ctx1, ctx2):
        c = _corrida(al, ctx.corrida_id)
        assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
        propias = [i for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id]
        assert len(propias) == 1 and propias[0]["estado"] == "resuelta"
    por_inv = {}
    for ev in al.estado["eventos"]:
        if ev["tipo"].startswith("modelo_"):
            por_inv.setdefault(ev["investigacionId"], []).append(ev["tipo"])
    assert por_inv == {"inv-a": ["modelo_sin_respuesta", "modelo_recuperado"], "inv-b": ["modelo_sin_respuesta", "modelo_recuperado"]}
    al.cerrar()


def test_una_caida_tras_una_recuperacion_cuenta_como_otra_caida(monkeypatch):
    # El caso contrario: la corrida 1 cae y vuelve; después cae la 2. Son dos caídas.
    _sin_red_ni_esperas(monkeypatch)
    al, ctx1 = _ctx("inv-a")
    ctx2 = _otra_corrida(al, "inv-b")
    asyncio.run(ctx1.llamar("cerebro", ProgramaFalso(TimeoutError(), "uno"), x=1))
    asyncio.run(ctx2.llamar("cerebro", ProgramaFalso(TimeoutError(), "dos"), x=1))
    s = al.estado["saludModelos"]["cerebro"]
    assert s["caidas"] == 2 and s["estado"] == "ok"
    al.cerrar()


def test_una_corrida_antigua_sin_los_campos_nuevos_no_rompe(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx(con_iteracion=False)

    def quitar(e: dict[str, Any]) -> bool:
        e.pop("saludModelos", None)
        _corrida(e, ctx.corrida_id).pop("esperandoModelo", None)
        return True

    al.mutar(quitar, "test")
    assert "saludModelos" not in al.estado
    programa = ProgramaFalso(TimeoutError(), "ok")
    assert asyncio.run(ctx.llamar("cerebro", programa, x=1)) == "ok"
    assert al.estado["saludModelos"]["cerebro"]["estado"] == "ok"
    c = _corrida(al, ctx.corrida_id)
    assert c["esperandoModelo"] is None and c["estado"] == "en_marcha"
    al.cerrar()


def test_ctx_llamar_sigue_pasando_el_rollout_id_a_una_copia(monkeypatch):
    # Lo que ya comprobaba test_tanda1_cierre (S-20), ahora a través del vigilante.
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    programa = ProgramaFalso("ok", "ok")
    asyncio.run(ctx.llamar("replica", programa, rollout_id=2, x=1))
    asyncio.run(ctx.llamar("replica", programa, x=1))
    assert programa.vistos == [(OPUS, 2), (OPUS, None)]
    al.cerrar()


# ---------------------------------------------------------------------------
# El contador registra los fallos
# ---------------------------------------------------------------------------


def test_el_contador_registra_la_llamada_fallida_sin_sumar_gasto():
    al, ctx = _ctx()
    contador = CT.Contador(al)
    lm = LMFalso(ASTRA)
    token = contexto_actual.set(ContextoLlamada(ctx.corrida_id, 1, "cerebro"))
    try:
        contador.on_lm_start("c-1", lm, {"messages": [{"role": "user", "content": "hola"}]})
        contador.on_lm_end("c-1", None, exception=asyncio.CancelledError())
        contador.on_lm_start("c-2", lm, {"messages": [{"role": "user", "content": "hola 2"}]})
        contador.on_lm_end("c-2", None, exception=RuntimeError("x" * 500))
    finally:
        contexto_actual.reset(token)
    filas = al.llamadas_de(ctx.corrida_id)
    assert len(filas) == 2
    por_error = {f["error"][:14]: f for f in filas}
    cancelada = next(f for f in filas if f["error"] == "CancelledError")
    assert cancelada["ok"] in (0, False) and cancelada["ms"] >= 0 and cancelada["rol"] == "cerebro" and cancelada["modelo"] == ASTRA, "str(CancelledError) es vacío: el tipo delante lo hace legible"
    larga = next(f for f in filas if f["error"].startswith("RuntimeError: "))
    assert len(larga["error"]) == 200 and larga["tokensEntrada"] == 0 and larga["tokensSalida"] == 0
    assert por_error
    g = _corrida(al, ctx.corrida_id)["gasto"]
    assert g["llamadas"] == 0 and g["tokensEntrada"] == 0 and g["usd"] == 0.0, "cuatro intentos a un modelo caído no gastan presupuesto"
    it = next(i for i in al.estado["iteraciones"] if i["corridaId"] == ctx.corrida_id)
    assert it["presupuesto"]["usado"] == 0
    al.cerrar()


# ---------------------------------------------------------------------------
# sondear en gateway.py, con transporte falso
# ---------------------------------------------------------------------------


def _cliente(respuesta):
    peticiones: list[httpx.Request] = []

    def manejar(req: httpx.Request) -> httpx.Response:
        peticiones.append(req)
        r = respuesta(req) if callable(respuesta) else respuesta
        if isinstance(r, Exception):
            raise r
        return r

    return httpx.AsyncClient(transport=httpx.MockTransport(manejar)), peticiones


def test_sondear_hace_una_peticion_minima_y_solo_un_200_con_choices_es_si():
    import json

    lm = LMFalso(OPUS)
    lm.kwargs.update({"api_base": "http://gateway-falso/v1", "api_key": "clave-de-prueba"})
    cliente, peticiones = _cliente(httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}))
    assert asyncio.run(GW.sondear(lm, cliente=cliente)) is True
    req = peticiones[0]
    assert str(req.url) == "http://gateway-falso/v1/chat/completions" and req.method == "POST"
    cuerpo = json.loads(req.content)
    assert cuerpo["model"] == "anthropic/claude-opus-5" and cuerpo["max_tokens"] == 1 and len(cuerpo["messages"]) == 1
    assert req.headers["authorization"] == "Bearer clave-de-prueba"
    for r in (httpx.Response(200, json={"error": "sin choices"}), httpx.Response(200, json={"choices": []}), httpx.Response(503, text="caído"), httpx.Response(429, json={}), httpx.Response(200, text="esto no es json")):
        cliente, _ = _cliente(r)
        assert asyncio.run(GW.sondear(lm, cliente=cliente)) is False, r
    cliente, _ = _cliente(httpx.ConnectTimeout("sin ruta"))
    assert asyncio.run(GW.sondear(lm, cliente=cliente)) is False, "un tiempo agotado no lanza"


def test_sondear_sin_clave_ni_red_devuelve_false_y_no_lanza(monkeypatch):
    monkeypatch.delenv("ROSA_GATEWAY_KEY", raising=False)
    lm = LMFalso(ASTRA)  # sin api_key en kwargs: clave() lanzaría ClaveAusente
    assert asyncio.run(GW.sondear(lm)) is False
    assert GW._id_en_gateway(LMFalso(ASTRA)) == "openai/gpt-6-astra" and GW._id_en_gateway("anthropic/claude-opus-5") == "anthropic/claude-opus-5"


def test_los_ganchos_por_defecto_sondean_con_gateway(monkeypatch):
    llamados: list[Any] = []

    async def sondear_falso(lm: Any) -> bool:
        llamados.append(lm)
        return True

    monkeypatch.setattr(GW, "sondear", sondear_falso)
    programa = ProgramaFalso(TimeoutError(), "ok")
    reg = Registro()
    g = reg.ganchos()
    g.sondear = None
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=g)) == "ok"
    assert len(llamados) == 1 and llamados[0].model == ASTRA


def test_una_cancelacion_desde_fuera_se_propaga_sin_contarla_como_caida():
    # Al apagar el servidor o detener la corrida, la tarea se cancela: eso no es un
    # modelo caído y no debe reintentarse ni dejar incidencia.
    reg = Registro()

    async def ejecutar(modelo: Any) -> Any:
        await asyncio.sleep(10)

    async def escenario() -> str:
        tarea = asyncio.create_task(VIG.llamar_vigilado(ejecutar, "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
        await asyncio.sleep(0.01)
        tarea.cancel()
        try:
            await tarea
        except asyncio.CancelledError:
            return "cancelada"
        return "no se canceló"

    assert asyncio.run(escenario()) == "cancelada"
    assert reg.fases() == [] and reg.incidencias == [] and reg.eventos == [] and reg.dormidas == []
