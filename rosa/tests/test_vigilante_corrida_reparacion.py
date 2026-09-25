"""Reparación tras el adversario del constructor "corrida" (vigilante de
modelos, 18 de septiembre de 2026; TRASPASO.md 7.4). Cada test intenta romper
uno de los arreglos, no solo comprobar que existe. Todo con dobles: ningún
modelo, ninguna red; el único dormir real son décimas de segundo a escala.

Lo que se cubre:

- La orden de la persona manda: una pausa (o una detención, o una pausa por
  presupuesto, o una aprobación pendiente) hecha mientras el paso corría no se
  pisa con `esperando_modelo`; el paso queda pendiente, el tic no sondea, y al
  reanudar el paso se reintenta y la corrida sigue hasta el cierre.
- La tarea de la corrida termina limpia tras un modelo caído en los tres
  caminos (paso, plan, cierre) y el tic le da una tarea nueva cuando toca.
- El cierre de la iteración espera al modelo en cada pieza (resumen, revisor,
  conclusiones) en vez de cerrar degradado, y al retomar no repaga lo guardado.
- Los rellenos de fondo y las peticiones de la persona no le piden nada a un
  modelo caído, y un modelo caído no marca nada como "intentado".
- Las peticiones corren como tarea de fondo con tope propio: los tics siguen,
  la petición en vuelo se deja terminar al parar, y un modelo caído dentro se
  dice en una línea, sin traceback.
- Un sondeo que se cuelga se corta (tope propio y sustitución desde el tic) y
  cuenta como "no pude comprobar", una sola vez por intervalo.
- La salud del rol: dos corridas esperando al mismo modelo cuentan una caída;
  una recaída dentro del intervalo es la misma caída; el rol vuelve a ok solo
  cuando la última corrida que lo esperaba lo ve responder.
- Detener, terminar (por parada o al cerrar) y ampliar presupuesto borran el
  registro de espera; una corrida antigua sin la clave no rompe nada."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.tests import test_vigilante_corrida as VC
from rosa.tests.test_integracion_corrida import _pred_conclusion, _pred_llano, _preparar, _supervisor

ASTRA = VC.ASTRA
OPUS = VC.OPUS
MIN = VC.MIN


def _corrida(al, cid):
    return VC._corrida(al, cid)


def _it(al, iid):
    return VC._it(al, iid)


def _excepcion(rol="cerebro", modelo=ASTRA, intentos=4, desde=None):
    return CO.ModeloSinRespuesta(rol, modelo, intentos, desde or P.ahora_ms() - 20 * MIN)


def _espera(rol="cerebro", modelo=ASTRA, proximo=0, intentos=4):
    return {"rol": rol, "modelo": modelo, "desde": 1000, "ultimoSondeo": None, "proximoSondeo": proximo, "pasoId": None, "intentos": intentos}


def _poner(al, cid, **cambios):
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == cid).update(cambios) or True, "estado")


def _sin_relanzar(sup, monkeypatch):
    """El tic no crea tareas de corrida (no hay bucle de eventos en estos tests)."""
    relanzadas: list[str] = []
    monkeypatch.setattr(sup, "_relanzar_corrida", lambda cid: relanzadas.append(cid))
    return relanzadas


class EjecutorQueVeUnaOrden(VC.EjecutorFalso):
    """Mientras el primer intento del paso corre, la persona da una orden
    (pausar, detener, ...); después el paso termina con `ModeloSinRespuesta`."""

    def __init__(self, orden, fallos=1, **kw):
        super().__init__(fallos=fallos, **kw)
        self.orden = orden

    async def __call__(self, ctx, paso):
        if self.llamadas == 0:
            self.orden()
        return await super().__call__(ctx, paso)


async def _cancelar_tareas(sup):
    for t in list(sup.tareas.values()) + list(sup._sondeos.values()) + list(sup._fondo.values()):
        t.cancel()
    await asyncio.gather(*sup.tareas.values(), *sup._sondeos.values(), *sup._fondo.values(), return_exceptions=True)


# ---------------------------------------------------------------------------
# La orden de la persona manda
# ---------------------------------------------------------------------------


def test_la_pausa_durante_el_paso_se_respeta_y_al_reanudar_el_paso_se_reintenta_y_la_corrida_sigue(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    paso = VC._con_paso(al, ids["it"])
    ejecutor = EjecutorQueVeUnaOrden(lambda: al.aplicar("pausarCorrida", {"corrida_id": ids["cor"]}), fallos=1)
    monkeypatch.setattr(PASOS, "EJECUTORES", {"literatura": ejecutor})
    VC._detener_al_cerrar(sup, al, monkeypatch)
    VC._sondeo_que(sup, monkeypatch, True)
    n_eventos = len(al.estado["eventos"])

    async def cuerpo():
        try:
            await asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=5)
            c = _corrida(al, ids["cor"])
            assert c["estado"] == "pausada" and c["esperandoModelo"] is None
            p = next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])
            assert p["estado"] == "pendiente" and p["motivoFallo"] is None
            pistas = [x for x in _it(al, ids["it"])["pistas"] if x["pasoId"] == paso["id"]]
            assert len(pistas) == 1 and pistas[0]["estado"] == "fallida"
            nuevos = [x["texto"] for x in al.estado["eventos"][n_eventos:] if x["tipo"] == "corrida_estado"]
            assert any("GPT-6 Astra no respondió tras 4 intentos; la corrida sigue pausada por la persona" in t for t in nuevos), nuevos
            assert not any("sondea cada minuto" in t for t in nuevos), "se anunció una espera automática sobre una corrida pausada"
            # La salud del cerebro sí se anota (es global), pero la corrida no entra en la espera.
            assert al.estado["saludModelos"]["cerebro"]["estado"] == "sin_respuesta"
            # Muchos tics después, con el sondeo respondiendo: nada se sondea, nada retoma.
            for k in range(1, 4):
                sup._tick(ahora=P.ahora_ms() + k * 5 * MIN)
                await asyncio.sleep(0.02)
            assert not sup._sondeos, "se sondeó una corrida pausada"
            c = _corrida(al, ids["cor"])
            assert c["estado"] == "pausada" and ejecutor.llamadas == 1
            # El tic le dio una tarea nueva que duerme en la pausa (una sola).
            assert len(sup.tareas) == 1 and not sup.tareas[ids["cor"]].done()
            # La persona reanuda: la tarea viva retoma el paso pendiente y la corrida sigue hasta el cierre.
            assert al.aplicar("reanudarCorrida", {"corrida_id": ids["cor"]}) is True
            await asyncio.wait_for(sup.tareas[ids["cor"]], timeout=5)
            c = _corrida(al, ids["cor"])
            assert c["estado"] == "detenida" and ejecutor.llamadas == 2  # el doble del cierre la detiene
            p = next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])
            assert p["estado"] == "hecho"
        finally:
            await _cancelar_tareas(sup)

    asyncio.run(cuerpo())


def test_detener_durante_el_paso_manda_y_la_corrida_no_queda_esperando(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    paso = VC._con_paso(al, ids["it"])
    ejecutor = EjecutorQueVeUnaOrden(lambda: al.aplicar("detenerCorrida", {"corrida_id": ids["cor"], "motivo": "Basta"}), fallos=1)
    monkeypatch.setattr(PASOS, "EJECUTORES", {"literatura": ejecutor})
    asyncio.run(asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=5))
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "detenida" and c["esperandoModelo"] is None
    p = next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])
    assert p["estado"] == "pendiente"
    assert not any("espera a que" in x["texto"] for x in al.estado["eventos"])


@pytest.mark.parametrize("estado, texto_estado", [("pausada_por_presupuesto", "pausada por presupuesto"), ("esperando_aprobacion", "a la espera de una aprobación"), ("esperando_plan", "a la espera del plan")])
def test_entrar_en_esperando_modelo_respeta_los_demas_estados_de_espera(estado, texto_estado):
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": estado, "esperandoModelo": None}], "eventos": [], "incidencias": [], "saludModelos": {}}
    assert CO._entrar_en_esperando_modelo(e, "c1", _excepcion(rol="juez", modelo=OPUS, intentos=3), "paso-1", 50_000) is True
    c = e["corridas"][0]
    assert c["estado"] == estado and c["esperandoModelo"] is None
    ev = e["eventos"][-1]
    assert ev["texto"] == f"Claude Opus 5 no respondió tras 3 intentos; la corrida sigue {texto_estado} y el paso pendiente se reintentará al retomarla"
    salud = e["saludModelos"]["juez"]
    assert salud["estado"] == "sin_respuesta" and salud["caidas"] == 1 and salud["modelo"] == OPUS


def test_entrar_en_esperando_modelo_tolera_una_corrida_antigua_pausada_sin_la_clave():
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "pausada"}], "eventos": [], "incidencias": []}
    assert CO._entrar_en_esperando_modelo(e, "c1", _excepcion(), None, 50_000) is True
    c = e["corridas"][0]
    assert c["estado"] == "pausada" and "esperandoModelo" not in c  # no se inventa registro
    # Y desde en marcha sí entra, con la clave creada.
    e["corridas"][0]["estado"] = "en_marcha"
    assert CO._entrar_en_esperando_modelo(e, "c1", _excepcion(), None, 60_000) is True
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["modelo"] == ASTRA
    assert e["saludModelos"]["cerebro"]["caidas"] == 1  # la misma caída, no dos


def test_una_corrida_pausada_con_registro_de_espera_del_vigilante_no_se_sondea_y_al_reanudar_se_borra(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    _sin_relanzar(sup, monkeypatch)
    # El vigilante (fijar_espera_modelo) anota la espera sin cambiar el estado de una corrida pausada.
    _poner(al, ids["cor"], estado="pausada", esperandoModelo=_espera(proximo=0))
    sup._tick(ahora=P.ahora_ms() + 10 * MIN)
    assert not sup._sondeos
    assert _corrida(al, ids["cor"])["estado"] == "pausada"
    assert al.aplicar("reanudarCorrida", {"corrida_id": ids["cor"]}) is True
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None


def test_al_salir_de_esperando_aprobacion_el_tic_borra_un_registro_de_espera_rancio(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    _sin_relanzar(sup, monkeypatch)
    _poner(al, ids["cor"], estado="esperando_aprobacion", esperandoModelo=_espera())
    sup._tick(ahora=P.ahora_ms())
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None


def test_la_tarea_termina_limpia_tras_el_modelo_caido_en_el_cierre_aunque_la_persona_pausara(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def cierre_con_pausa_y_modelo_caido(c, it):
        al.aplicar("pausarCorrida", {"corrida_id": ids["cor"]})
        raise _excepcion()

    monkeypatch.setattr(sup, "_cerrar_con_presupuesto", cierre_con_pausa_y_modelo_caido)
    asyncio.run(asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=5))
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "pausada" and c["esperandoModelo"] is None
    assert _it(al, ids["it"])["terminadaEn"] is None


# ---------------------------------------------------------------------------
# El cierre espera al modelo y no repaga lo guardado
# ---------------------------------------------------------------------------


class LlamarConCaida:
    """`Ctx.llamar` falsa: responde por programa; los programas en `caidos`
    lanzan `ModeloSinRespuesta` mientras `caido` sea True; los demás sin
    respuesta lanzan RuntimeError (otro fallo, no una caída del modelo)."""

    def __init__(self, respuestas, caidos, rol_caido="juez"):
        self.respuestas = respuestas
        self.caidos = set(caidos)
        self.rol_caido = rol_caido
        self.caido = True
        self.vistas: list[str] = []

    async def __call__(self, ctx, rol, programa, **kw):
        self.vistas.append(programa)
        if programa in self.caidos and self.caido:
            raise _excepcion(rol=self.rol_caido, modelo=OPUS if self.rol_caido == "juez" else ASTRA)
        if programa not in self.respuestas:
            raise RuntimeError(f"programa simulado sin respuesta: {programa}")
        r = self.respuestas[programa]
        return r(kw) if callable(r) else r


def _cerrar_con(al, ids, monkeypatch, llamadas):
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def llamar(self, rol, programa, **kw):
        return await llamadas(self, rol, programa, **kw)

    monkeypatch.setattr(Ctx, "llamar", llamar)
    return sup


def test_el_revisor_con_opus_caido_deja_el_cierre_abierto_y_al_retomar_no_repaga_el_resumen(monkeypatch):
    al, ids = _preparar()
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen técnico de la iteración."), "en_llano": _pred_llano(), "concluir": _pred_conclusion(), "revisar_registro": SimpleNamespace(revision=SimpleNamespace(hallazgos=[], resumen="El resumen coincide con el registro."))}
    llamadas = LlamarConCaida(respuestas, caidos={"revisar_registro"})
    sup = _cerrar_con(al, ids, monkeypatch, llamadas)
    c, it = _corrida(al, ids["cor"]), _it(al, ids["it"])
    with pytest.raises(CO.ModeloSinRespuesta):
        asyncio.run(sup._cerrar_iteracion(c, it))
    it = _it(al, ids["it"])
    assert it["terminadaEn"] is None and it.get("revisionRegistro") is None
    assert it["_cierre"]["resumen"] == "Resumen técnico de la iteración." and isinstance(it["_cierre"].get("llano"), dict)
    assert llamadas.vistas.count("resumir") == 1
    # Opus vuelve: el cierre se retoma y termina sin volver a pedir el resumen ni el llano.
    llamadas.caido = False
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids["cor"]), _it(al, ids["it"])))
    it = _it(al, ids["it"])
    assert it["terminadaEn"] is not None and it["revisionRegistro"]["resumen"] == "El resumen coincide con el registro."
    assert "_cierre" not in it
    assert llamadas.vistas.count("resumir") == 1 and llamadas.vistas.count("en_llano") == 1
    assert "El juez no respondió" not in it["revisionRegistro"]["resumen"]


def test_el_resumen_con_astra_caido_no_se_sustituye_por_el_resumen_por_regla(monkeypatch):
    al, ids = _preparar()
    llamadas = LlamarConCaida({}, caidos={"resumir"}, rol_caido="cerebro")
    sup = _cerrar_con(al, ids, monkeypatch, llamadas)
    with pytest.raises(CO.ModeloSinRespuesta):
        asyncio.run(sup._cerrar_iteracion(_corrida(al, ids["cor"]), _it(al, ids["it"])))
    it = _it(al, ids["it"])
    assert it["terminadaEn"] is None and not it.get("_cierre")
    assert llamadas.vistas == ["resumir"]  # nada más se pidió después del cerebro caído


def test_una_conclusion_con_opus_caido_sube_del_gather_y_no_marca_la_hipotesis_como_intentada(monkeypatch):
    al, ids = _preparar()
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen."), "en_llano": _pred_llano()}
    llamadas = LlamarConCaida(respuestas, caidos={"concluir"})
    sup = _cerrar_con(al, ids, monkeypatch, llamadas)
    with pytest.raises(CO.ModeloSinRespuesta):
        asyncio.run(sup._cerrar_iteracion(_corrida(al, ids["cor"]), _it(al, ids["it"])))
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h.get("conclusion") is None and h.get("_conclusionIntentada") is None
    assert _it(al, ids["it"])["terminadaEn"] is None


def test_otro_fallo_del_juez_que_no_sea_una_caida_sigue_cerrando_con_el_respaldo_por_regla(monkeypatch):
    """Control: un RuntimeError (no una caída del modelo) conserva el respaldo de siempre."""
    al, ids = _preparar()
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen."), "en_llano": _pred_llano(), "concluir": _pred_conclusion()}
    sup = _cerrar_con(al, ids, monkeypatch, LlamarConCaida(respuestas, caidos=set()))
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids["cor"]), _it(al, ids["it"])))
    it = _it(al, ids["it"])
    assert it["terminadaEn"] is not None and it["revisionRegistro"]["resumen"].startswith("El juez no respondió")


# ---------------------------------------------------------------------------
# Rellenos de fondo y peticiones con el modelo caído
# ---------------------------------------------------------------------------


def test_un_relleno_con_el_modelo_caido_no_marca_la_hipotesis_como_intentada_y_no_revienta(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def llamar_caido(self, rol, programa, **kw):
        raise _excepcion(rol=rol, modelo=ASTRA)

    monkeypatch.setattr(Ctx, "llamar", llamar_caido)
    al.mutar(lambda e: next(h for h in e["hipotesis"] if h["id"] == ids["hip"]).update({"enLlano": None}) or True, "hip")
    asyncio.run(sup._completar_en_llano())  # no lanza hacia fuera
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h.get("enLlano") is None and not h.get("_enLlanoIntentado")
    # Con un fallo que no es una caída, sí se marca (control de la regla anterior).
    async def llamar_roto(self, rol, programa, **kw):
        raise RuntimeError("otro fallo")

    monkeypatch.setattr(Ctx, "llamar", llamar_roto)
    # La conclusión va antes que el resumen, porque el resumen la cuenta: el primer
    # tic intenta la conclusión y el segundo, el resumen.
    asyncio.run(sup._completar_en_llano())
    asyncio.run(sup._completar_en_llano())
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h.get("_enLlanoIntentado") == T.huella_llano(al.estado, h), "con un fallo que no es una caída, se marca para esta huella y no se repite en cada tic"
    assert h.get("enLlano") is None, "no se inventa un resumen cuando el modelo falla"


def test_los_datos_del_laboratorio_no_se_evaluan_mientras_la_corrida_espera_al_juez(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    al.mutar(lambda e: next(h for h in e["hipotesis"] if h["id"] == ids["hip"]).update({"experimento": {"estado": "datos_recibidos", "ficheroDatos": "x.csv"}, "enLlano": "ya", "_conclusionIntentada": 1, "_tarjetaIntentada": True}) or True, "hip")
    llamadas: list[str] = []

    async def evaluar(ctx, h):
        llamadas.append("evaluar")

    monkeypatch.setattr(sup, "_evaluar_resultado", evaluar)
    _poner(al, ids["cor"], estado="esperando_modelo", esperandoModelo=_espera(rol="juez", modelo=OPUS))
    asyncio.run(sup._completar_en_llano_paso())
    assert llamadas == []
    _poner(al, ids["cor"], estado="pausada", esperandoModelo=None)  # pausada sí: la persona subió los datos
    asyncio.run(sup._completar_en_llano_paso())
    assert llamadas == ["evaluar"]
    assert CO.ESTADOS_SIN_GASTO_DE_FONDO == ("detenida", "terminada", "pausada", "pausada_por_presupuesto", "esperando_modelo")


def test_las_peticiones_de_la_persona_esperan_mientras_la_corrida_espera_al_modelo(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    al.mutar(lambda e: next(h for h in e["hipotesis"] if h["id"] == ids["hip"]).update({"estado": "aclarando", "_comentariosNuevos": True}) or True, "hip")
    llamadas: list[str] = []

    async def anotar(nombre):
        llamadas.append(nombre)

    monkeypatch.setattr(sup, "_aclarar", lambda ctx, h: anotar("aclarar"))
    monkeypatch.setattr(sup, "_responder_comentarios", lambda ctx, h: anotar("responder"))

    async def nada():
        return None

    monkeypatch.setattr(sup, "_completar_en_llano", nada)
    _poner(al, ids["cor"], estado="esperando_modelo", esperandoModelo=_espera())
    asyncio.run(sup._atender_peticiones())
    assert llamadas == []
    _poner(al, ids["cor"], estado="en_marcha", esperandoModelo=None)
    asyncio.run(sup._atender_peticiones())
    assert llamadas == ["aclarar", "responder"]


def test_aclarar_con_el_cerebro_caido_deja_la_hipotesis_aclarando_para_retomarla(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def llamar_caido(self, rol, programa, **kw):
        raise _excepcion(rol=rol)

    monkeypatch.setattr(Ctx, "llamar", llamar_caido)
    monkeypatch.setattr(ctx.programas, "aclarar", "aclarar", raising=False)  # el doble de programas no lo trae
    al.mutar(lambda e: next(h for h in e["hipotesis"] if h["id"] == ids["hip"]).update({"estado": "aclarando", "revisiones": [{"fecha": 1, "quien": "dra", "accion": "no_puedo_juzgar", "nota": "¿Qué cohorte?", "aCiegas": False}]}) or True, "hip")
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    with pytest.raises(CO.ModeloSinRespuesta):
        asyncio.run(sup._aclarar(ctx, h))
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h["estado"] == "aclarando" and not any("No pude aclararla" in r["nota"] for r in h["revisiones"])


# ---------------------------------------------------------------------------
# Las peticiones fuera del bucle del tic
# ---------------------------------------------------------------------------


def test_las_peticiones_corren_como_tarea_de_fondo_con_tope_propio_y_la_que_va_en_vuelo_termina_al_parar(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    from rosa import indice_semantico, vigilancia

    monkeypatch.setattr(CO, "INTERVALO_TIC_S", 0.01)

    async def vigilar(almacen, ahora):
        await asyncio.sleep(3600)  # una vigilancia eterna: se cancela al parar

    async def indexar(almacen):
        return 0

    monkeypatch.setattr(vigilancia, "vigilar", vigilar)
    monkeypatch.setattr(indice_semantico, "indexar_estado", indexar)
    marcas = {"empezadas": 0, "terminadas": 0, "en_vuelo": 0, "maximo": 0}

    async def peticion():
        marcas["empezadas"] += 1
        marcas["en_vuelo"] += 1
        marcas["maximo"] = max(marcas["maximo"], marcas["en_vuelo"])
        try:
            await asyncio.sleep(0.2)
        finally:
            marcas["en_vuelo"] -= 1
        marcas["terminadas"] += 1

    monkeypatch.setattr(sup, "_atender_peticiones", peticion)

    async def dormida(cid):
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)
    tics: list[int] = []
    original = sup._tick
    monkeypatch.setattr(sup, "_tick", lambda ahora=None: (tics.append(1), original(ahora)))

    async def cuerpo():
        tarea = asyncio.create_task(sup.correr())
        await asyncio.sleep(0.1)
        n = len(tics)
        assert "peticiones" in sup._fondo and not sup._fondo["peticiones"].done()
        sup.parar()
        await asyncio.wait_for(tarea, timeout=5)
        return n

    n = asyncio.run(cuerpo())
    assert n >= 5, f"solo {n} tics en 0,1 s con una petición de 0,2 s en vuelo"
    assert marcas["maximo"] == 1, "dos peticiones a la vez"
    assert marcas["empezadas"] == 1 and marcas["terminadas"] == 1, "la petición en vuelo se cortó al parar en vez de dejarla terminar"
    assert sup._fondo["vigilancia"].cancelled()  # la vigilancia eterna sí se cancela
    assert CO.TOPE_PETICIONES_S > 4 * 300 + 105  # más que el peor ciclo del vigilante para una llamada


def test_un_modelo_caido_dentro_de_las_peticiones_se_dice_en_una_linea_sin_traceback(monkeypatch, capsys):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def peticion_con_astra_caido():
        raise _excepcion()

    async def cuerpo():
        assert sup._lanzar_fondo("peticiones", peticion_con_astra_caido, tope=CO.TOPE_PETICIONES_S)
        await sup._fondo["peticiones"]
        assert sup._fondo["peticiones"].exception() is None

    asyncio.run(cuerpo())
    salida = capsys.readouterr()
    assert "La tarea de fondo 'peticiones' se cortó: GPT-6 Astra no responde; se reintenta cuando vuelva" in salida.out
    assert "Traceback" not in salida.err


def test_el_tope_de_una_tarea_de_fondo_se_da_por_nombre_y_sin_darlo_vale_el_general(monkeypatch, capsys):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    monkeypatch.setattr(CO, "TOPE_FONDO_S", 5)

    async def lenta():
        await asyncio.sleep(5)

    async def cuerpo():
        assert sup._lanzar_fondo("corta", lenta, tope=0.02)
        await sup._fondo["corta"]
        assert sup._fondo["corta"].done() and sup._fondo["corta"].exception() is None

    asyncio.run(cuerpo())
    assert "La tarea de fondo 'corta' superó los 0.02 s" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Sondeos que se cuelgan
# ---------------------------------------------------------------------------


def test_el_sondeo_tiene_tope_propio_y_al_agotarse_cuenta_como_sin_respuesta(monkeypatch, capsys):
    al, ids, sup, paso, ejecutor = VC._preparar_esperando(monkeypatch, fallos=99)
    monkeypatch.setattr(CO, "TOPE_SONDEO_S", 0.02)

    async def colgado(lm):
        await asyncio.sleep(5)
        return True  # si el tope no lo cortara, diría "volvió"

    monkeypatch.setattr(sup, "_sondear", colgado)
    vistos = VC._registrar_relanzamientos(sup, al, monkeypatch)

    async def cuerpo():
        antes = dict(_corrida(al, ids["cor"])["esperandoModelo"])  # copia: el registro se muta en sitio
        sup._tick(ahora=antes["proximoSondeo"])
        await asyncio.wait_for(sup._sondeos[ids["cor"]], timeout=2)
        c = _corrida(al, ids["cor"])
        esp = c["esperandoModelo"]
        assert c["estado"] == "esperando_modelo" and esp["intentos"] == antes["intentos"] + 1
        assert esp["proximoSondeo"] > antes["proximoSondeo"] and esp["ultimoSondeo"] is not None
        assert vistos == [] and not sup.tareas

    asyncio.run(cuerpo())
    assert "no terminó en 0.02 s; cuenta como sin respuesta" in capsys.readouterr().out
    assert CO.TOPE_SONDEO_S == 0.02  # el parche del test; el valor real es el doble del sondeo del gateway
    monkeypatch.undo()
    from rosa import gateway

    assert CO.TOPE_SONDEO_S == 2 * gateway.SEGUNDOS_SONDEO


def test_un_sondeo_colgado_se_corta_desde_el_tic_una_sola_vez_por_intervalo_y_despues_se_sustituye(monkeypatch):
    al, ids, sup, paso, ejecutor = VC._preparar_esperando(monkeypatch, fallos=99)

    async def cuerpo():
        puerta = asyncio.Event()
        lanzados: list[int] = []

        async def colgado(lm):
            lanzados.append(1)
            await puerta.wait()
            return False

        monkeypatch.setattr(sup, "_sondear", colgado)
        t0 = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        sup._tick(ahora=t0)
        s1 = sup._sondeos[ids["cor"]]
        await asyncio.sleep(0)
        # Dentro del intervalo no se toca.
        sup._tick(ahora=t0 + 30_000)
        assert sup._sondeos[ids["cor"]] is s1 and not s1.done()
        # Pasado el intervalo se corta y cuenta un intento...
        sup._tick(ahora=t0 + CO.INTERVALO_SONDEO_S * 1000)
        await asyncio.sleep(0)
        esp = _corrida(al, ids["cor"])["esperandoModelo"]
        assert s1.cancelled() and esp["intentos"] == 5
        # ...una sola vez: el tic siguiente no vuelve a contar.
        sup._tick(ahora=t0 + CO.INTERVALO_SONDEO_S * 1000 + 2000)
        assert _corrida(al, ids["cor"])["esperandoModelo"]["intentos"] == 5 and len(lanzados) == 1
        # Y cuando vence el siguiente sondeo, se lanza otro.
        sup._tick(ahora=esp["proximoSondeo"])
        s2 = sup._sondeos[ids["cor"]]
        assert s2 is not s1
        await asyncio.sleep(0)
        assert len(lanzados) == 2
        puerta.set()
        s2.cancel()
        await asyncio.gather(s1, s2, return_exceptions=True)

    asyncio.run(cuerpo())


# ---------------------------------------------------------------------------
# Salud del rol con varias corridas
# ---------------------------------------------------------------------------


def _estado_con_dos_corridas():
    return {
        "corridas": [
            {"id": "a", "investigacionId": "inv", "numero": 1, "estado": "esperando_modelo", "esperandoModelo": _espera()},
            {"id": "b", "investigacionId": "inv", "numero": 2, "estado": "esperando_modelo", "esperandoModelo": _espera()},
        ],
        "eventos": [],
        "incidencias": [],
        "saludModelos": {"cerebro": {"modelo": ASTRA, "estado": "sin_respuesta", "desde": 1000, "intentos": 4, "proximoIntentoEn": 0, "ultimaRespuestaEn": None, "ultimaLatenciaMs": None, "caidas": 1, "recuperadoEn": None}},
    }


def test_el_rol_vuelve_a_ok_solo_cuando_la_ultima_corrida_que_lo_esperaba_lo_ve_responder():
    e = _estado_con_dos_corridas()
    assert CO._modelo_recuperado(e, "a", 10_000) is True
    salud = e["saludModelos"]["cerebro"]
    assert salud["estado"] == "sin_respuesta" and salud["ultimaRespuestaEn"] == 10_000 and salud["recuperadoEn"] is None
    assert e["corridas"][0]["estado"] == "en_marcha" and e["corridas"][1]["estado"] == "esperando_modelo"
    assert [x["tipo"] for x in e["eventos"]] == ["modelo_recuperado"]  # la corrida A sí anuncia su vuelta
    assert CO._sondeo_fallido(e, "b", 10_001) is True
    assert salud["caidas"] == 1
    assert CO._modelo_recuperado(e, "b", 70_000) is True
    assert salud["estado"] == "ok" and salud["recuperadoEn"] == 70_000 and salud["caidas"] == 1


def test_una_recaida_dentro_del_intervalo_es_la_misma_caida_y_pasado_el_intervalo_es_otra():
    e = {"saludModelos": {"cerebro": {"modelo": ASTRA, "estado": "ok", "desde": 1, "intentos": 0, "proximoIntentoEn": None, "ultimaRespuestaEn": 100_000, "ultimaLatenciaMs": 900, "caidas": 2, "recuperadoEn": 90_000}}}
    intervalo = CO.INTERVALO_SONDEO_S * 1000
    reg = CO._actualizar_salud(e, "cerebro", ASTRA, ahora=100_000 + intervalo - 1, estado="sin_respuesta")
    assert reg["caidas"] == 2 and reg["estado"] == "sin_respuesta"
    reg["estado"] = "ok"
    reg = CO._actualizar_salud(e, "cerebro", ASTRA, ahora=100_000 + intervalo, estado="sin_respuesta")
    assert reg["caidas"] == 3
    # Sin `ahora` (llamadas antiguas) se cuenta como siempre; "lento" ya es caído.
    reg["estado"] = "ok"
    assert CO._actualizar_salud(e, "cerebro", ASTRA, estado="sin_respuesta")["caidas"] == 4
    reg["estado"] = "lento"
    assert CO._actualizar_salud(e, "cerebro", ASTRA, ahora=999_999_999, estado="sin_respuesta")["caidas"] == 4


def test_un_modelo_distinto_esperado_por_otra_corrida_no_retiene_la_salud_del_rol():
    e = _estado_con_dos_corridas()
    e["corridas"][1]["esperandoModelo"] = _espera(rol="juez", modelo=OPUS)
    assert CO._modelo_recuperado(e, "a", 10_000) is True
    assert e["saludModelos"]["cerebro"]["estado"] == "ok"


# ---------------------------------------------------------------------------
# Detener, terminar y ampliar borran el registro de espera
# ---------------------------------------------------------------------------


def test_terminar_por_parada_y_al_cerrar_borra_el_registro_de_espera(monkeypatch):
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "esperando_modelo", "esperandoModelo": _espera(), "progreso": []}], "eventos": [], "incidencias": [], "hipotesis": [], "iteraciones": [], "investigaciones": [{"id": "inv"}]}
    monkeypatch.setattr(CO.PROG, "metrica_de_corrida", lambda e2, cid: None)
    monkeypatch.setattr(CO.PROG, "resumen_metrica", lambda m: "")
    assert CO._terminar_corrida(e, "c1", "3 iteraciones") is True
    assert e["corridas"][0]["estado"] == "terminada" and e["corridas"][0]["esperandoModelo"] is None
    # El cierre que termina la corrida hace lo mismo (rama `terminar` de _cerrar_iteracion).
    al, ids = _preparar()
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen."), "en_llano": _pred_llano(), "concluir": _pred_conclusion()}
    sup = _cerrar_con(al, ids, monkeypatch, LlamarConCaida(respuestas, caidos=set()))
    al.mutar(lambda e2: next(i for i in e2["investigaciones"] if i["id"] == ids["inv"]).update({"condicionParada": "1 iteración"}) or True, "parada")
    _poner(al, ids["cor"], esperandoModelo=_espera())  # un registro rancio del vigilante
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids["cor"]), _it(al, ids["it"])))
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "terminada" and c["esperandoModelo"] is None


def test_ampliar_presupuesto_desde_la_pausa_borra_el_registro_de_espera():
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "pausada_por_presupuesto", "esperandoModelo": _espera(), "gasto": {"llamadas": 10}, "presupuesto": {"limiteLlamadas": 20, "avisadas": [], "motivoPausa": "tope"}}], "eventos": [], "iteraciones": []}
    assert A.ampliar_presupuesto(e, "c1", 100, 5000) is True
    c = e["corridas"][0]
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
    # Desde otro estado, ampliar no toca el registro (una corrida en esperando_modelo sigue esperando).
    c.update({"estado": "esperando_modelo", "esperandoModelo": _espera()})
    assert A.ampliar_presupuesto(e, "c1", 200, 6000) is True
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"] == _espera()


def test_detener_una_corrida_antigua_sin_la_clave_de_espera_no_rompe():
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "en_marcha"}], "eventos": [], "investigaciones": []}
    assert A.detener_corrida(e, "c1", "", 5000) is True
    assert e["corridas"][0]["esperandoModelo"] is None


def test_detener_resuelve_la_incidencia_automatica_pendiente_de_esa_corrida_y_solo_de_esa():
    """La persona detiene mientras el vigilante espera: sin esto la incidencia
    `modelo_sin_respuesta` quedaba "resolviéndose sola" para siempre (el
    vigilante ya no corre y el supervisor solo resuelve en `esperando_modelo`)."""
    inc = lambda cid, tipo="modelo_sin_respuesta", estado="pendiente": {"id": f"inc-{cid}-{tipo}-{estado}", "corridaId": cid, "tipo": tipo, "titulo": "GPT-6 Astra no responde", "detalle": "", "recurso": ASTRA, "alternativa": None, "estado": estado, "creadaEn": 1, "resueltaEn": None, "resolucion": None}
    e = {
        "corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "esperando_modelo", "esperandoModelo": _espera()}, {"id": "c2", "investigacionId": "inv", "numero": 2, "estado": "en_marcha", "esperandoModelo": None}],
        "eventos": [],
        "investigaciones": [],
        "incidencias": [inc("c1"), inc("c1", tipo="fuente_sin_respuesta"), inc("c1", estado="resuelta"), inc("c2")],
    }
    assert A.detener_corrida(e, "c1", "Basta", 5000) is True
    por_id = {i["id"]: i for i in e["incidencias"]}
    resuelta = por_id["inc-c1-modelo_sin_respuesta-pendiente"]
    assert resuelta["estado"] == "resuelta" and resuelta["resueltaEn"] == 5000 and "ya no espera a ese modelo" in resuelta["resolucion"]
    assert por_id["inc-c1-fuente_sin_respuesta-pendiente"]["estado"] == "pendiente"  # otras incidencias siguen para la persona
    assert por_id["inc-c1-modelo_sin_respuesta-resuelta"]["resueltaEn"] is None  # la ya resuelta no se toca
    assert por_id["inc-c2-modelo_sin_respuesta-pendiente"]["estado"] == "pendiente"  # otra corrida, otra espera
    # Un estado antiguo sin la lista de incidencias no rompe.
    e2 = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "en_marcha"}], "eventos": [], "investigaciones": []}
    assert A.detener_corrida(e2, "c1", "", 5000) is True


def test_reformular_a_peticion_con_astra_caido_conserva_la_peticion_de_la_persona(monkeypatch):
    """Antes el `finally` quitaba `_reformularPedida` aunque el fallo fuera que el
    cerebro no respondía, y la persona leía "Fallo al reformular"."""
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    async def reformular_caido(ctx_, h, nota, quien, pista):
        raise _excepcion()

    monkeypatch.setattr(PASOS, "_reformular", reformular_caido)
    al.mutar(lambda e: next(h for h in e["hipotesis"] if h["id"] == ids["hip"]).update({"estado": "refinar", "_reformularPedida": "Acota la cohorte", "_revisionPedida": True}) or True, "hip")
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    with pytest.raises(CO.ModeloSinRespuesta):
        asyncio.run(sup._reformular_por_persona(ctx, h))
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h.get("_reformularPedida") == "Acota la cohorte" and h.get("_revisionPedida") is True
    pistas = _it(al, ids["it"])["pistas"]
    assert pistas and pistas[-1]["estado"] == "fallida" and "GPT-6 Astra no respondió; la petición sigue en pie" in pistas[-1]["resumen"]
    # Control: otro fallo sí consume la petición, como antes.
    async def reformular_roto(ctx_, h, nota, quien, pista):
        raise RuntimeError("otro fallo")

    monkeypatch.setattr(PASOS, "_reformular", reformular_roto)
    asyncio.run(sup._reformular_por_persona(ctx, h))
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert "_reformularPedida" not in h and "_revisionPedida" not in h
