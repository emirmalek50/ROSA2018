"""El estado `esperando_modelo` en la corrida y el supervisor (vigilante de
modelos, 18 de septiembre de 2026; TRASPASO.md 7.4 y la hora perdida de la
corrida 13).

Lo que se prueba, todo con dobles y sin red:

- Un paso que lanza `ModeloSinRespuesta` deja el paso pendiente, la corrida en
  `esperando_modelo` con `esperandoModelo` relleno, el evento en castellano y la
  tarea de la corrida termina limpia.
- El tic lanza UN sondeo cuando vence `proximoSondeo` (justo en el umbral
  también); si responde, la corrida vuelve a en marcha, emite `modelo_recuperado`,
  resuelve la incidencia y se relanza; si no, el siguiente sondeo queda a
  INTERVALO_SONDEO_S y no se relanza nada. Un sondeo que revienta es "no pude
  comprobar", no "volvió".
- Un modelo que falla siempre no genera tareas de más; "Reintentar ahora"
  (reanudar_corrida) saca de la espera y el ciclo vuelve a empezar.
- Dos corridas esperando a la vez: un sondeo por corrida, cada una se relanza.
- Tras un reinicio la corrida sigue esperando y el primer tic sondea; un estado
  a medias (sin registro) vuelve a en marcha.
- El tiempo en `esperando_modelo` va a `pausaMs`: ni trabajo ni espera humana.
- Una vigilancia de literatura lenta no congela los tics.
- Los reducers `reanudar_corrida` y `pausar_corrida`, la migración del almacén y
  las corridas antiguas sin los campos nuevos."""

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS
from rosa.estado import acciones as A
from rosa.estado import almacen as ALM
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.tests.test_integracion_corrida import _preparar, _supervisor

ASTRA = "openai/gpt-6-astra"
OPUS = "anthropic/claude-opus-5"
MIN = 60_000


def _corrida(al, cid):
    return next(x for x in al.estado["corridas"] if x["id"] == cid)


def _it(al, iid):
    return next(x for x in al.estado["iteraciones"] if x["id"] == iid)


def _con_paso(al, iteracion_id, titulo="Buscar literatura"):
    """Un paso de literatura pendiente en la iteración abierta."""
    paso = P.nuevo_paso(titulo, "PubMed y Europe PMC", 30)
    paso["tipo"] = "literatura"
    al.mutar(lambda e: next(x for x in e["iteraciones"] if x["id"] == iteracion_id)["plan"].append(paso) or True, "plan")
    return paso


class EjecutorFalso:
    """Un ejecutor de paso que lanza `ModeloSinRespuesta` las primeras `fallos`
    veces (dejando una pista en curso, como el paso real) y después trabaja."""

    def __init__(self, fallos=1, rol="cerebro", modelo=ASTRA, intentos=4, desde=None):
        self.fallos = fallos
        self.rol = rol
        self.modelo = modelo
        self.intentos = intentos
        self.desde = desde
        self.llamadas = 0

    async def __call__(self, ctx, paso):
        self.llamadas += 1
        pista = ctx.pista(paso["id"], "literatura", "Búsqueda", "GPT-6 Astra")
        if self.llamadas <= self.fallos:
            raise CO.ModeloSinRespuesta(self.rol, self.modelo, self.intentos, self.desde or P.ahora_ms() - 21 * MIN)
        pista.cerrar("3 fuentes nuevas")
        return "3 fuentes nuevas leídas"


def _detener_al_cerrar(sup, al, monkeypatch):
    """Cuando la corrida llega al cierre de la iteración, se detiene: el cierre
    real llama a los modelos y aquí solo importa el camino hasta el paso."""

    async def detener(c, it):
        al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == c["id"]).__setitem__("estado", "detenida") or True, "fin")

    monkeypatch.setattr(sup, "_cerrar_con_presupuesto", detener)


def _preparar_esperando(monkeypatch, fallos=1, **kw):
    """Una corrida que ya cayó en `esperando_modelo` por un paso de literatura."""
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    paso = _con_paso(al, ids["it"])
    ejecutor = EjecutorFalso(fallos=fallos, **kw)
    monkeypatch.setattr(PASOS, "EJECUTORES", {"literatura": ejecutor})
    _detener_al_cerrar(sup, al, monkeypatch)
    asyncio.run(sup.correr_corrida(ids["cor"]))
    assert _corrida(al, ids["cor"])["estado"] == "esperando_modelo"
    return al, ids, sup, paso, ejecutor


def _registrar_relanzamientos(sup, al, monkeypatch):
    """Lo que la corrida tenía en el instante en que el supervisor la relanzó:
    la tarea relanzada corre en cuanto se cede el bucle y llega al doble del
    cierre, así que el estado "en marcha" hay que mirarlo aquí."""
    vistos = []
    original = sup._relanzar_corrida

    def relanzar(cid):
        c = _corrida(al, cid)
        vistos.append((cid, c["estado"], c["esperandoModelo"]))
        original(cid)

    monkeypatch.setattr(sup, "_relanzar_corrida", relanzar)
    return vistos


def _sondeo_que(sup, monkeypatch, respuesta, vistos=None):
    async def sondear(lm):
        if vistos is not None:
            vistos.append(getattr(lm, "model", None))
        if isinstance(respuesta, BaseException):
            raise respuesta
        return respuesta

    monkeypatch.setattr(sup, "_sondear", sondear)


# ---------------------------------------------------------------------------
# (1) El paso que lanza ModeloSinRespuesta
# ---------------------------------------------------------------------------


def test_un_paso_con_el_modelo_caido_deja_la_corrida_esperando_y_la_tarea_termina_limpia(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    paso = _con_paso(al, ids["it"])
    desde = P.ahora_ms() - 21 * MIN
    ejecutor = EjecutorFalso(fallos=1, desde=desde)
    monkeypatch.setattr(PASOS, "EJECUTORES", {"literatura": ejecutor})
    antes = P.ahora_ms()
    # Termina sola: si no reconociera la excepción, la tarea moriría con ella.
    asyncio.run(asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=5))
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "esperando_modelo"
    esp = c["esperandoModelo"]
    assert esp["rol"] == "cerebro" and esp["modelo"] == ASTRA and esp["intentos"] == 4 and esp["pasoId"] == paso["id"]
    assert esp["desde"] == desde and esp["ultimoSondeo"] is None
    assert antes + CO.INTERVALO_SONDEO_S * 1000 <= esp["proximoSondeo"] <= P.ahora_ms() + CO.INTERVALO_SONDEO_S * 1000
    p = next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])
    assert p["estado"] == "pendiente" and p["motivoFallo"] is None
    pistas = [x for x in _it(al, ids["it"])["pistas"] if x["pasoId"] == paso["id"]]
    assert len(pistas) == 1 and pistas[0]["estado"] == "fallida" and "GPT-6 Astra no respondió" in pistas[0]["resumen"]
    ev = [x for x in al.estado["eventos"] if x["tipo"] == "corrida_estado"][-1]
    assert ev["texto"] == "ROSA2018 espera a que GPT-6 Astra vuelva a responder: sondea cada minuto y retomará sola"
    assert ev["ruta"] == f"#/investigaciones/{ids['inv']}/corrida"
    salud = al.estado["saludModelos"]["cerebro"]
    assert salud["estado"] == "sin_respuesta" and salud["modelo"] == ASTRA and salud["caidas"] == 1 and salud["intentos"] == 4 and salud["desde"] == desde
    assert ejecutor.llamadas == 1
    # No se degradó el rol: nadie llamó al modelo de volumen ni se marcó el paso como fallido.
    assert not any(i["tipo"] == "modelo_bloqueado" for i in al.estado["incidencias"])


def test_el_juez_caido_se_nombra_como_opus_y_la_espera_no_es_humana(monkeypatch):
    al, ids, sup, paso, _ = _preparar_esperando(monkeypatch, rol="juez", modelo=OPUS, intentos=2)
    c = _corrida(al, ids["cor"])
    assert c["esperandoModelo"]["rol"] == "juez"
    ev = [x for x in al.estado["eventos"] if x["tipo"] == "corrida_estado"][-1]
    assert ev["texto"].startswith("ROSA2018 espera a que Claude Opus 5 vuelva a responder")
    assert "esperando_modelo" not in CO.ESTADOS_DE_ESPERA_HUMANA
    assert "esperando_modelo" in CO.ESTADOS_DE_PAUSA_DEL_PROCESO


def test_el_modelo_caido_al_proponer_el_plan_tambien_espera_sin_plan_por_defecto(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    # La iteración abierta se da por cerrada: la corrida tiene que proponer la siguiente.
    al.mutar(lambda e: next(x for x in e["iteraciones"] if x["id"] == ids["it"]).__setitem__("terminadaEn", 5000) or True, "cierre")

    async def plan_sin_modelo(c, anterior):
        raise CO.ModeloSinRespuesta("cerebro", ASTRA, 4, P.ahora_ms() - 20 * MIN)

    monkeypatch.setattr(sup, "_proponer_plan", plan_sin_modelo)
    asyncio.run(asyncio.wait_for(sup.correr_corrida(ids["cor"]), timeout=5))
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["pasoId"] is None and c["esperandoModelo"]["rol"] == "cerebro"
    assert not any(i["tipo"] == "modelo_bloqueado" for i in al.estado["incidencias"])


# ---------------------------------------------------------------------------
# (2) El tic sondea y relanza
# ---------------------------------------------------------------------------


def test_el_sondeo_que_responde_relanza_la_corrida_y_el_paso_se_reintenta(monkeypatch):
    al, ids, sup, paso, ejecutor = _preparar_esperando(monkeypatch, fallos=1, desde=P.ahora_ms() - 23 * MIN)
    # La incidencia que dejó el vigilante en el primer fallo: la resuelve el sondeo.
    inc = {"id": "inc-vig", "corridaId": ids["cor"], "tipo": "modelo_sin_respuesta", "titulo": "GPT-6 Astra no responde", "detalle": "", "recurso": ASTRA, "alternativa": "ROSA2018 lo está resolviendo sola", "estado": "pendiente", "creadaEn": 1, "resueltaEn": None, "resolucion": None}
    al.mutar(lambda e: e["incidencias"].append(inc) or True, "incidencia")
    vistos = []
    _sondeo_que(sup, monkeypatch, True, vistos)
    al_relanzar = _registrar_relanzamientos(sup, al, monkeypatch)

    async def cuerpo():
        t0 = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        sup._tick(ahora=t0 - 1)  # aún no vence: ni sondeo ni tarea de corrida
        assert ids["cor"] not in sup._sondeos and vistos == []
        assert ids["cor"] not in sup.tareas
        sup._tick(ahora=t0)  # justo en el umbral: vence
        sondeo = sup._sondeos[ids["cor"]]
        sup._tick(ahora=t0 + 1)  # un segundo sondeo no se solapa con el que está en vuelo
        assert sup._sondeos[ids["cor"]] is sondeo
        await sondeo
        assert al_relanzar == [(ids["cor"], "en_marcha", None)]  # volvió a en marcha y sin espera antes de relanzarla
        assert vistos == ["sim-cerebro"]  # el lm del rol que esperaba
        ev = [x for x in al.estado["eventos"] if x["tipo"] == "modelo_recuperado"]
        assert len(ev) == 1 and ev[0]["texto"].startswith("GPT-6 Astra volvió tras 4 intentos y 2") and ev[0]["texto"].endswith("minutos")
        inc2 = next(i for i in al.estado["incidencias"] if i["id"] == "inc-vig")
        assert inc2["estado"] == "resuelta" and inc2["resueltaEn"] and "4 intentos" in inc2["detalle"] and inc2["resolucion"]
        salud = al.estado["saludModelos"]["cerebro"]
        assert salud["estado"] == "ok" and salud["recuperadoEn"] and salud["ultimaRespuestaEn"] and salud["proximoIntentoEn"] is None and salud["caidas"] == 1
        # La tarea de la corrida se relanzó por el mismo camino que reanudar y el paso se hizo.
        t = sup.tareas[ids["cor"]]
        await asyncio.wait_for(t, timeout=5)
        p = next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])
        assert p["estado"] == "hecho" and ejecutor.llamadas == 2
        assert _corrida(al, ids["cor"])["estado"] == "detenida"  # el doble del cierre

    asyncio.run(cuerpo())


def test_el_sondeo_sin_respuesta_programa_el_siguiente_y_no_relanza_nada(monkeypatch):
    al, ids, sup, paso, ejecutor = _preparar_esperando(monkeypatch, fallos=99)
    _sondeo_que(sup, monkeypatch, False)

    async def cuerpo():
        t0 = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        sup._tick(ahora=t0)
        s1 = sup._sondeos[ids["cor"]]
        await s1
        c = _corrida(al, ids["cor"])
        esp = c["esperandoModelo"]
        assert c["estado"] == "esperando_modelo" and esp["intentos"] == 5
        assert esp["ultimoSondeo"] is not None and esp["proximoSondeo"] == esp["ultimoSondeo"] + CO.INTERVALO_SONDEO_S * 1000
        assert ids["cor"] not in sup.tareas and ejecutor.llamadas == 1  # no se relanzó
        assert not any(x["tipo"] == "modelo_recuperado" for x in al.estado["eventos"])
        salud = al.estado["saludModelos"]["cerebro"]
        assert salud["estado"] == "sin_respuesta" and salud["intentos"] == 5 and salud["proximoIntentoEn"] == esp["proximoSondeo"] and salud["caidas"] == 1
        # Antes de que venza el siguiente no se lanza otro sondeo.
        sup._tick(ahora=esp["ultimoSondeo"] + 1000)
        assert sup._sondeos[ids["cor"]] is s1
        # Un sondeo que revienta es "no pude comprobar", nunca "el modelo volvió".
        _sondeo_que(sup, monkeypatch, RuntimeError("gateway 502"))
        sup._tick(ahora=esp["proximoSondeo"])
        s2 = sup._sondeos[ids["cor"]]
        assert s2 is not s1
        await s2
        c = _corrida(al, ids["cor"])
        assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["intentos"] == 6 and ids["cor"] not in sup.tareas

    asyncio.run(cuerpo())


def test_un_modelo_que_falla_siempre_no_acumula_tareas_y_reintentar_ahora_saca_de_la_espera(monkeypatch):
    al, ids, sup, paso, ejecutor = _preparar_esperando(monkeypatch, fallos=99)
    _sondeo_que(sup, monkeypatch, False)

    async def cuerpo():
        t = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        for _ in range(5):
            sup._tick(ahora=t)
            await sup._sondeos[ids["cor"]]
            t = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        c = _corrida(al, ids["cor"])
        assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["intentos"] == 4 + 5
        assert len(sup._sondeos) == 1 and ids["cor"] not in sup.tareas and ejecutor.llamadas == 1
        assert sum(1 for x in al.estado["eventos"] if x["tipo"] == "corrida_estado" and "espera a que GPT-6 Astra" in x["texto"]) == 1
        # "Reintentar ahora" de la persona: el reducer saca de la espera sin esperar al sondeo.
        assert al.aplicar("reanudarCorrida", {"corrida_id": ids["cor"]}) is True
        c = _corrida(al, ids["cor"])
        assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
        sup._tick(ahora=t + 1)  # el tic la relanza como a cualquier corrida en marcha
        tarea = sup.tareas[ids["cor"]]
        await asyncio.wait_for(tarea, timeout=5)
        # El modelo sigue caído: el paso volvió a fallar y la corrida espera otra vez, con registro nuevo.
        c = _corrida(al, ids["cor"])
        assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["intentos"] == 4 and ejecutor.llamadas == 2
        # El modelo nunca llegó a responder: es la misma caída, no una segunda.
        assert al.estado["saludModelos"]["cerebro"]["caidas"] == 1 and al.estado["saludModelos"]["cerebro"]["estado"] == "sin_respuesta"

    asyncio.run(cuerpo())


def test_dos_corridas_esperando_a_la_vez_tienen_cada_una_su_sondeo_y_se_relanzan(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)

    def segunda(e):
        inv2 = A.crear_investigacion(e, {"titulo": "Segunda", "objetivo": "Otra pregunta", "condicionParada": "3 iteraciones"}, 2000)
        c2 = P.nueva_corrida(inv2, 1, 2000)
        c2["estado"] = "en_marcha"
        e["corridas"].append(c2)
        it2 = P.nueva_iteracion(c2["id"], 1, 2000, [])
        it2["planAprobado"] = True
        e["iteraciones"].append(it2)
        e["_ids2"] = {"inv": inv2, "cor": c2["id"], "it": it2["id"]}
        return True

    al.mutar(segunda, "segunda")
    ids2 = al.estado.pop("_ids2")
    paso1 = _con_paso(al, ids["it"])
    paso2 = _con_paso(al, ids2["it"])
    ejecutor = EjecutorFalso(fallos=2)  # las dos primeras llamadas (una por corrida) fallan
    monkeypatch.setattr(PASOS, "EJECUTORES", {"literatura": ejecutor})
    _detener_al_cerrar(sup, al, monkeypatch)
    vistos = []
    _sondeo_que(sup, monkeypatch, True, vistos)
    al_relanzar = _registrar_relanzamientos(sup, al, monkeypatch)

    async def cuerpo():
        await sup.correr_corrida(ids["cor"])
        await sup.correr_corrida(ids2["cor"])
        assert {c["estado"] for c in al.estado["corridas"]} == {"esperando_modelo"}
        t0 = max(c["esperandoModelo"]["proximoSondeo"] for c in al.estado["corridas"])
        sup._tick(ahora=t0)
        assert set(sup._sondeos) == {ids["cor"], ids2["cor"]}
        await asyncio.gather(*sup._sondeos.values())
        assert len(vistos) == 2
        assert sorted(al_relanzar) == sorted([(ids["cor"], "en_marcha", None), (ids2["cor"], "en_marcha", None)])
        recuperados = [x for x in al.estado["eventos"] if x["tipo"] == "modelo_recuperado"]
        assert {x["investigacionId"] for x in recuperados} == {ids["inv"], ids2["inv"]}
        await asyncio.wait_for(asyncio.gather(sup.tareas[ids["cor"]], sup.tareas[ids2["cor"]]), timeout=5)
        assert next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso1["id"])["estado"] == "hecho"
        assert next(x for x in _it(al, ids2["it"])["plan"] if x["id"] == paso2["id"])["estado"] == "hecho"
        assert ejecutor.llamadas == 4

    asyncio.run(cuerpo())


def test_si_la_persona_reanuda_mientras_se_sondea_el_sondeo_no_relanza_dos_veces(monkeypatch):
    al, ids, sup, paso, ejecutor = _preparar_esperando(monkeypatch, fallos=1)
    puerta = asyncio.Event() if False else None  # se crea dentro del bucle

    async def cuerpo():
        nonlocal puerta
        puerta = asyncio.Event()

        async def sondear_lento(lm):
            await puerta.wait()
            return True

        monkeypatch.setattr(sup, "_sondear", sondear_lento)
        t0 = _corrida(al, ids["cor"])["esperandoModelo"]["proximoSondeo"]
        sup._tick(ahora=t0)
        sondeo = sup._sondeos[ids["cor"]]
        await asyncio.sleep(0)
        # Mientras el sondeo espera, la persona pulsa "Reintentar ahora" y el tic relanza.
        assert al.aplicar("reanudarCorrida", {"corrida_id": ids["cor"]}) is True
        sup._tick(ahora=t0 + 2000)
        tarea = sup.tareas[ids["cor"]]
        puerta.set()
        await sondeo
        assert sup.tareas[ids["cor"]] is tarea  # el sondeo no relanzó otra tarea
        assert not any(x["tipo"] == "modelo_recuperado" for x in al.estado["eventos"])  # no anuncia lo que no vio
        await asyncio.wait_for(tarea, timeout=5)
        assert next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])["estado"] == "hecho"

    asyncio.run(cuerpo())


def test_una_corrida_esperando_sin_registro_vuelve_a_en_marcha_en_el_tic(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).update({"estado": "esperando_modelo", "esperandoModelo": None}) or True, "estado")

    async def dormida(cid):
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)

    async def cuerpo():
        sup._tick(ahora=10_000)
        c = _corrida(al, ids["cor"])
        assert c["estado"] == "en_marcha" and ids["cor"] not in sup._sondeos
        assert "sin registro de cuál" in al.estado["eventos"][-1]["texto"]
        sup._tick(ahora=12_000)
        assert ids["cor"] in sup.tareas
        sup.tareas[ids["cor"]].cancel()

    asyncio.run(cuerpo())


def test_mientras_la_tarea_vive_el_vigilante_manda_y_el_tic_no_sondea(monkeypatch):
    """El vigilante pone la corrida en `esperando_modelo` entre sus reintentos,
    con la tarea del paso aún viva. El supervisor no sondea entonces: solo
    cuando la tarea terminó (el vigilante se rindió y lanzó la excepción)."""
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    espera = {"rol": "cerebro", "modelo": ASTRA, "desde": 1000, "ultimoSondeo": 2000, "proximoSondeo": 3000, "pasoId": None, "intentos": 2}
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).update({"estado": "esperando_modelo", "esperandoModelo": dict(espera)}) or True, "estado")
    vistos = []
    _sondeo_que(sup, monkeypatch, True, vistos)

    async def cuerpo():
        puerta = asyncio.Event()

        async def paso_en_reintentos():
            await puerta.wait()

        sup.tareas[ids["cor"]] = asyncio.create_task(paso_en_reintentos())
        sup._tick(ahora=10_000)  # el sondeo venció hace rato, pero la tarea vive
        sup._tick(ahora=70_000)
        assert ids["cor"] not in sup._sondeos and vistos == []
        assert _corrida(al, ids["cor"])["estado"] == "esperando_modelo"
        puerta.set()
        await sup.tareas[ids["cor"]]
        sup._tick(ahora=72_000)  # la tarea terminó: ahora sí
        assert ids["cor"] in sup._sondeos
        await sup._sondeos[ids["cor"]]
        assert vistos == ["sim-cerebro"]
        for t in sup.tareas.values():
            t.cancel()

    asyncio.run(cuerpo())


def test_una_tarea_que_muere_esperando_al_modelo_se_avisa_una_vez_y_se_sigue_sondeando(monkeypatch, capsys):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    lejos = 10 ** 13
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).update({"estado": "esperando_modelo", "esperandoModelo": {"rol": "juez", "modelo": OPUS, "desde": 1000, "ultimoSondeo": None, "proximoSondeo": lejos, "pasoId": None, "intentos": 4}}) or True, "estado")

    async def cuerpo():
        async def rota():
            raise ValueError("murió esperando")

        t = asyncio.create_task(rota())
        sup.tareas[ids["cor"]] = t
        await asyncio.sleep(0)
        sup._tick(ahora=10_000)
        sup._tick(ahora=12_000)
        sup._tick(ahora=14_000)
        assert sup._muertas_avisadas[ids["cor"]] is t and ids["cor"] not in sup._sondeos  # el sondeo aún no toca

    asyncio.run(cuerpo())
    err = capsys.readouterr().err
    assert "murió esperando" in err and err.count("Traceback (most recent call last)") == 1  # una traza, no una por tic


def test_al_entrar_se_conserva_el_registro_previo_del_vigilante_del_mismo_modelo():
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "estado": "esperando_modelo", "esperandoModelo": {"rol": "cerebro", "modelo": ASTRA, "desde": 500, "ultimoSondeo": 900, "proximoSondeo": 950, "pasoId": "p-viejo", "intentos": 3}}], "eventos": [], "incidencias": [], "saludModelos": {"cerebro": {"modelo": ASTRA, "estado": "lento", "desde": 500, "intentos": 1, "proximoIntentoEn": 950, "ultimaRespuestaEn": None, "ultimaLatenciaMs": None, "caidas": 1, "recuperadoEn": None}}}
    ex = CO.ModeloSinRespuesta("cerebro", ASTRA, 4, 700)
    assert CO._entrar_en_esperando_modelo(e, "c1", ex, "p-nuevo", 1_000) is True
    esp = e["corridas"][0]["esperandoModelo"]
    assert esp["desde"] == 500 and esp["ultimoSondeo"] == 900 and esp["intentos"] == 4 and esp["pasoId"] == "p-nuevo" and esp["proximoSondeo"] == 1_000 + CO.INTERVALO_SONDEO_S * 1000
    salud = e["saludModelos"]["cerebro"]
    assert salud["estado"] == "sin_respuesta" and salud["caidas"] == 1  # "lento" ya era la misma caída
    # De otro modelo no se hereda nada.
    e["corridas"][0]["esperandoModelo"] = {"rol": "juez", "modelo": OPUS, "desde": 10, "ultimoSondeo": 20, "proximoSondeo": 30, "pasoId": None, "intentos": 9}
    CO._entrar_en_esperando_modelo(e, "c1", ex, None, 2_000)
    esp = e["corridas"][0]["esperandoModelo"]
    assert esp["desde"] == 700 and esp["ultimoSondeo"] is None and esp["intentos"] == 4


# ---------------------------------------------------------------------------
# (5) Reinicio
# ---------------------------------------------------------------------------


def test_tras_un_reinicio_la_corrida_sigue_esperando_y_el_primer_tic_sondea(monkeypatch):
    al, ids, sup, paso, ejecutor = _preparar_esperando(monkeypatch, fallos=1)
    esp0 = dict(_corrida(al, ids["cor"])["esperandoModelo"])
    assert esp0["proximoSondeo"] > P.ahora_ms() + 30_000
    # Otro supervisor sobre el mismo almacén, como al arrancar el servidor.
    sup2 = CO.Supervisor(al, sup.programas, sup.modelos)
    _detener_al_cerrar(sup2, al, monkeypatch)
    sup2.recuperar_tras_reinicio()
    c = _corrida(al, ids["cor"])
    assert c["estado"] == "esperando_modelo"
    assert c["esperandoModelo"]["proximoSondeo"] <= P.ahora_ms() and c["esperandoModelo"]["rol"] == esp0["rol"] and c["esperandoModelo"]["intentos"] == esp0["intentos"]
    assert next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])["estado"] == "pendiente"
    assert any("volvió a arrancar" in x["texto"] for x in al.estado["eventos"])
    vistos = []
    _sondeo_que(sup2, monkeypatch, True, vistos)
    al_relanzar = _registrar_relanzamientos(sup2, al, monkeypatch)

    async def cuerpo():
        sup2._tick()
        assert ids["cor"] in sup2._sondeos and ids["cor"] not in sup2.tareas
        await sup2._sondeos[ids["cor"]]
        assert al_relanzar == [(ids["cor"], "en_marcha", None)] and vistos == ["sim-cerebro"]
        await asyncio.wait_for(sup2.tareas[ids["cor"]], timeout=5)
        assert next(x for x in _it(al, ids["it"])["plan"] if x["id"] == paso["id"])["estado"] == "hecho"

    asyncio.run(cuerpo())


def test_tras_un_reinicio_una_espera_sin_registro_vuelve_a_en_marcha(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).update({"estado": "esperando_modelo", "esperandoModelo": None}) or True, "estado")
    sup.recuperar_tras_reinicio()
    assert _corrida(al, ids["cor"])["estado"] == "en_marcha"


# ---------------------------------------------------------------------------
# (3) El reloj
# ---------------------------------------------------------------------------


def test_el_tiempo_esperando_al_modelo_va_a_pausa_y_no_cuenta_como_trabajo_ni_espera_humana():
    c = {"empezadaEn": 0, "estado": "esperando_modelo", "esperaHumanaMs": 0, "pausaMs": 0}
    CO.contabilizar_tiempo(c, 1_000)
    assert CO.contabilizar_tiempo(c, 61_000) is True
    assert c["pausaMs"] == 60_000 and c["esperaHumanaMs"] == 0
    assert CO.tiempo_trabajo_ms(c, 61_000) == 1_000
    c["estado"] = "en_marcha"
    CO.contabilizar_tiempo(c, 91_000)
    assert c["pausaMs"] == 60_000 and CO.tiempo_trabajo_ms(c, 91_000) == 31_000
    # Una corrida antigua sin `pausaMs` también suma.
    viejo = {"empezadaEn": 0, "estado": "esperando_modelo", "_ultimoTic": 5_000}
    assert CO.contabilizar_tiempo(viejo, 8_000) is True and viejo["pausaMs"] == 3_000


def test_el_reloj_en_memoria_del_supervisor_manda_la_espera_del_modelo_a_pausa(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    lejos = P.ahora_ms() + 10 * 3600 * 1000
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == ids["cor"]).update({"estado": "esperando_modelo", "esperandoModelo": {"rol": "cerebro", "modelo": ASTRA, "desde": 1000, "ultimoSondeo": None, "proximoSondeo": lejos, "pasoId": None, "intentos": 4}}) or True, "estado")

    async def cuerpo():
        t0 = 1000 + 5_000
        sup._tick(ahora=t0)
        sup._tick(ahora=t0 + 10_000)
        sup._tick(ahora=t0 + 20_000)
        c = sup._con_reloj(_corrida(al, ids["cor"]))
        assert c["pausaMs"] == 20_000 and c["esperaHumanaMs"] == 0
        assert CO.tiempo_trabajo_ms(c, t0 + 20_000) == 5_000  # solo los 5 s antes del primer tic
        assert ids["cor"] not in sup.tareas and ids["cor"] not in sup._sondeos  # ni corrida ni sondeo antes de tiempo
        # Al volver a en marcha, la pausa acumulada se vuelca con el cambio de estado
        # (los 2 s del tic del cambio ya son trabajo: el delta va al estado del tic).
        al.mutar(lambda e: A.reanudar_corrida(e, ids["cor"]), "reanudar")
        v0 = al.version
        sup._tick(ahora=t0 + 22_000)
        c = _corrida(al, ids["cor"])
        assert al.version == v0 + 1 and c["pausaMs"] == 20_000 and c["esperaHumanaMs"] == 0 and c["estado"] == "en_marcha"
        assert c["gasto"]["segundos"] == round((t0 + 22_000 - 1000 - 20_000) / 1000)
        for t in sup.tareas.values():
            t.cancel()

    asyncio.run(cuerpo())


# ---------------------------------------------------------------------------
# (4) Los tics no se congelan
# ---------------------------------------------------------------------------


def test_una_vigilancia_lenta_no_congela_los_tics(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    from rosa import indice_semantico, vigilancia

    monkeypatch.setattr(CO, "INTERVALO_TIC_S", 0.01)
    en_vuelo = {"vigilancias": 0, "maximo_simultaneo": 0}

    async def vigilar_lenta(almacen, ahora):
        en_vuelo["vigilancias"] += 1
        en_vuelo["maximo_simultaneo"] = max(en_vuelo["maximo_simultaneo"], en_vuelo["vigilancias"])
        try:
            await asyncio.sleep(0.5)  # "diez segundos" a escala del tic de 0,01 s
        finally:
            en_vuelo["vigilancias"] -= 1
        return {"comprobadas": 0, "errores": 0, "conNovedades": 0, "nuevas": 0, "costeUsd": 0}

    async def indexar(almacen):
        return 0

    monkeypatch.setattr(vigilancia, "vigilar", vigilar_lenta)
    monkeypatch.setattr(indice_semantico, "indexar_estado", indexar)
    tics = []
    original = sup._tick

    def tick(ahora=None):
        tics.append(asyncio.get_running_loop().time())
        original(ahora)

    monkeypatch.setattr(sup, "_tick", tick)

    async def dormida(cid):
        await asyncio.sleep(3600)

    async def nada():
        return None

    monkeypatch.setattr(sup, "correr_corrida", dormida)
    monkeypatch.setattr(sup, "_atender_peticiones", nada)

    async def cuerpo():
        tarea = asyncio.create_task(sup.correr())
        await asyncio.sleep(0.3)
        n = len(tics)
        vigilando = "vigilancia" in sup._fondo and not sup._fondo["vigilancia"].done()
        sup.parar()
        await asyncio.wait_for(tarea, timeout=5)
        return n, vigilando

    n, vigilando = asyncio.run(cuerpo())
    assert vigilando  # la vigilancia seguía dormida...
    assert n >= 10  # ...y aun así hubo tics de sobra (antes: uno solo hasta que terminara)
    assert en_vuelo["maximo_simultaneo"] == 1  # una a la vez
    assert sup._fondo["vigilancia"].done()  # parar() la canceló y correr() la esperó


def test_las_tareas_de_fondo_van_una_a_la_vez_con_tope_y_sus_errores_solo_se_imprimen(monkeypatch, capsys):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    from rosa import vigilancia

    monkeypatch.setattr(CO, "TOPE_FONDO_S", 0.05)
    llamadas = []

    async def vigilar(almacen, ahora):
        llamadas.append(ahora)
        if len(llamadas) == 1:
            await asyncio.sleep(5)  # se pasa del tope
        raise RuntimeError("Exa sin respuesta")  # la segunda revienta

    monkeypatch.setattr(vigilancia, "vigilar", vigilar)

    async def cuerpo():
        await sup._vigilar_si_toca()
        marca = sup._ultima_vigilancia
        t1 = sup._fondo["vigilancia"]
        await sup._vigilar_si_toca()  # la hora no pasó: no se lanza otra
        assert sup._fondo["vigilancia"] is t1 and sup._ultima_vigilancia == marca
        sup._ultima_vigilancia = 0  # forzamos que "toque" con la anterior aún en vuelo
        await sup._vigilar_si_toca()
        assert sup._fondo["vigilancia"] is t1 and sup._ultima_vigilancia == 0  # una a la vez: la marca no avanza
        await t1  # el tope la corta sin excepción hacia fuera
        assert t1.done() and t1.exception() is None
        await sup._vigilar_si_toca()
        t2 = sup._fondo["vigilancia"]
        assert t2 is not t1 and sup._ultima_vigilancia > 0
        await t2
        assert t2.exception() is None and len(llamadas) == 2

    asyncio.run(cuerpo())
    salida = capsys.readouterr()
    assert "superó los 0.05 s" in salida.out and "Exa sin respuesta" in salida.err


# ---------------------------------------------------------------------------
# (6) y (7) Reducers, plantilla, migración y corridas antiguas
# ---------------------------------------------------------------------------


def test_reanudar_saca_de_esperando_modelo_y_pausar_no_toca_esa_espera():
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-r"})
    cid = al.aplicar("iniciarCorrida", {"investigacion_id": inv})
    c0 = _corrida(al, cid)
    assert c0["esperandoModelo"] is None and al.estado["saludModelos"] == {}  # la plantilla trae las claves
    espera = {"rol": "cerebro", "modelo": ASTRA, "desde": 1, "ultimoSondeo": None, "proximoSondeo": 2, "pasoId": None, "intentos": 4}
    al.mutar(lambda e: next(x for x in e["corridas"] if x["id"] == cid).update({"estado": "esperando_modelo", "esperandoModelo": espera}) or True, "estado")
    assert al.aplicar("pausarCorrida", {"corrida_id": cid}) is False
    assert _corrida(al, cid)["estado"] == "esperando_modelo"
    assert al.aplicar("reanudarCorrida", {"corrida_id": cid}) is True
    c = _corrida(al, cid)
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
    assert al.aplicar("reanudarCorrida", {"corrida_id": cid}) is False  # ya en marcha
    # Desde la pausa a mano sigue funcionando igual que antes.
    assert al.aplicar("pausarCorrida", {"corrida_id": cid}) is True
    assert al.aplicar("reanudarCorrida", {"corrida_id": cid}) is True and _corrida(al, cid)["estado"] == "en_marcha"
    al.cerrar()


def test_la_migracion_anade_las_claves_a_estados_antiguos_y_es_idempotente():
    ruta = Path(tempfile.mkdtemp()) / "viejo.db"
    al = Almacen(ruta)
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-m"})
    cid = al.aplicar("iniciarCorrida", {"investigacion_id": inv})

    def envejecer(e):
        e.pop("saludModelos", None)
        for c in e["corridas"]:
            c.pop("esperandoModelo", None)
        return True

    al.mutar(envejecer, "envejecer")
    assert "saludModelos" not in al.estado and "esperandoModelo" not in _corrida(al, cid)
    al.cerrar()
    al2 = Almacen(ruta)  # la carga migra
    assert al2.estado["saludModelos"] == {} and _corrida(al2, cid)["esperandoModelo"] is None
    al2.cerrar()
    # Directa e idempotente; y la espera sin registro vuelve a en marcha.
    e = {"corridas": [{"id": "a", "estado": "esperando_modelo"}, {"id": "b", "estado": "esperando_modelo", "esperandoModelo": {"rol": "juez"}}, {"id": "c", "estado": "pausada"}], "saludModelos": "basura"}
    ALM._migrar_vigilante_modelos(e)
    primera = __import__("copy").deepcopy(e)
    ALM._migrar_vigilante_modelos(e)
    assert e == primera
    assert e["saludModelos"] == {}
    assert e["corridas"][0] == {"id": "a", "estado": "en_marcha", "esperandoModelo": None}
    assert e["corridas"][1]["estado"] == "esperando_modelo" and e["corridas"][1]["esperandoModelo"] == {"rol": "juez"}
    assert e["corridas"][2] == {"id": "c", "estado": "pausada", "esperandoModelo": None}


def test_las_funciones_del_estado_toleran_una_corrida_antigua_sin_los_campos_nuevos():
    e = {"corridas": [{"id": "c1", "investigacionId": "inv", "numero": 3, "estado": "en_marcha"}], "eventos": [], "incidencias": []}
    ex = CO.ModeloSinRespuesta("juez", OPUS, 4, 100_000)
    assert CO._entrar_en_esperando_modelo(e, "c1", ex, "paso-9", 1_400_000) is True
    c = e["corridas"][0]
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"] == {"rol": "juez", "modelo": OPUS, "desde": 100_000, "ultimoSondeo": None, "proximoSondeo": 1_400_000 + CO.INTERVALO_SONDEO_S * 1000, "pasoId": "paso-9", "intentos": 4}
    assert e["saludModelos"]["juez"]["estado"] == "sin_respuesta" and e["saludModelos"]["juez"]["caidas"] == 1
    # Un segundo aviso de la misma caída no cuenta otra caída.
    e["saludModelos"]["juez"] = {"estado": "sin_respuesta", "caidas": 1}  # un registro a medias de otra versión
    assert CO._sondeo_fallido(e, "c1", 1_460_000) is True and e["saludModelos"]["juez"]["caidas"] == 1 and c["esperandoModelo"]["intentos"] == 5
    e.pop("saludModelos")  # y sin la clave raíz, se crea
    assert CO._modelo_recuperado(e, "c1", 100_000 + 47 * MIN) is True
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None
    assert e["eventos"][-1]["tipo"] == "modelo_recuperado" and e["eventos"][-1]["texto"] == "Claude Opus 5 volvió tras 5 intentos y 47 minutos"
    assert e["saludModelos"]["juez"]["estado"] == "ok" and e["saludModelos"]["juez"]["recuperadoEn"] == 100_000 + 47 * MIN
    # Sobre una corrida detenida o terminada no se hace nada.
    e["corridas"][0]["estado"] = "detenida"
    assert CO._entrar_en_esperando_modelo(e, "c1", ex, None, 1) is False and CO._sondeo_fallido(e, "c1", 1) is False and CO._modelo_recuperado(e, "c1", 1) is False
    assert CO._entrar_en_esperando_modelo(e, "no-existe", ex, None, 1) is False


def test_nombres_y_textos_por_regla():
    con_vigilante = CO.VIG is not None  # con el módulo del vigilante los textos son los suyos
    assert CO.nombre_del_modelo("openai/openai/gpt-6-astra") == "GPT-6 Astra"
    assert CO.nombre_del_modelo("anthropic/claude-opus-5", "juez") == "Claude Opus 5"
    assert CO.nombre_del_modelo("anthropic/claude-sonnet-5") == "Claude Sonnet 5"
    assert CO.nombre_del_modelo("openai/anthropic/claude-sonnet-5.5", "volumen") == "Claude Sonnet 5.5"
    assert CO.nombre_del_modelo(None, "volumen") == "Claude Sonnet 5.5"
    assert CO.nombre_del_modelo("", "juez") == "Claude Opus 5" and CO.nombre_del_modelo(None, "cerebro") == "GPT-6 Astra"
    assert CO.nombre_del_modelo("otro/modelo-x", "sin_rol") == ("Modelo X" if con_vigilante else "otro/modelo-x") and CO.nombre_del_modelo(None, None) == "el modelo"
    assert CO._texto_duracion(0) == "menos de un minuto" and CO._texto_duracion(59_999) == "menos de un minuto"
    assert CO._texto_duracion(MIN) == "1 minuto" and CO._texto_duracion(59 * MIN) == "59 minutos"
    assert CO._texto_duracion(180 * MIN + 5 * MIN) == ("3 horas y 5 minutos" if con_vigilante else "3 h 5 min")
    assert CO._texto_intentos(1) == "1 intento" and CO._texto_intentos(4) == "4 intentos"
    # Y los textos de respaldo por sí solos, por si el módulo faltara.
    import pytest  # noqa: PLC0415

    monkey = pytest.MonkeyPatch()
    try:
        monkey.setattr(CO, "VIG", None)
        assert CO.nombre_del_modelo("otro/modelo-x", "sin_rol") == "otro/modelo-x" and CO.nombre_del_modelo("openai/gpt-6-astra") == "GPT-6 Astra"
        assert CO.nombre_del_modelo("openai/anthropic/claude-sonnet-5.5") == "Claude Sonnet 5.5"
        assert CO.nombre_del_modelo("openai/anthropic/claude-sonnet-5") == "Claude Sonnet 5"
        assert CO._texto_duracion(185 * MIN) == "3 h 5 min" and CO._texto_intentos(1) == "1 intento"
    finally:
        monkey.undo()
    assert CO._texto_cada_sondeo() == "cada minuto"
    assert "modelo_sin_respuesta" in CO.INCIDENCIAS_QUE_NO_BLOQUEAN
    ex = CO.ModeloSinRespuesta("cerebro", ASTRA, 4, 123)
    assert (ex.rol, ex.modelo, ex.intentos, ex.desde) == ("cerebro", ASTRA, 4, 123) and isinstance(ex, Exception)


def test_la_incidencia_modelo_sin_respuesta_no_retiene_la_corrida_en_esperando_aprobacion(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    inc = {"id": "inc-x", "corridaId": ids["cor"], "tipo": "modelo_sin_respuesta", "titulo": "t", "detalle": "", "recurso": ASTRA, "alternativa": None, "estado": "pendiente", "creadaEn": 1, "resueltaEn": None, "resolucion": None}
    al.mutar(lambda e: (e["incidencias"].append(inc), next(x for x in e["corridas"] if x["id"] == ids["cor"]).__setitem__("estado", "esperando_aprobacion")) and True, "prep")

    async def dormida(cid):
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)

    async def cuerpo():
        sup._tick(ahora=10_000)
        assert _corrida(al, ids["cor"])["estado"] == "en_marcha"
        for t in sup.tareas.values():
            t.cancel()

    asyncio.run(cuerpo())


def test_el_sondeo_por_defecto_sin_gateway_sondear_da_por_respondido_y_con_el_lo_usa(monkeypatch):
    """Hasta que rosa/gateway.py tenga `sondear` (lo escribe otro constructor), el
    supervisor no puede comprobar: reintenta el paso directamente. Con la
    función presente, la usa con el lm del rol."""
    from rosa import gateway

    modelos = SimpleNamespace(cerebro=SimpleNamespace(model="c"), juez=SimpleNamespace(model="j"), volumen=SimpleNamespace(model="v"))
    sup = CO.Supervisor(SimpleNamespace(estado={"corridas": []}), SimpleNamespace(), modelos)
    assert sup._lm_del_rol("juez").model == "j" and sup._lm_del_rol("replica").model == "j" and sup._lm_del_rol("volumen").model == "v" and sup._lm_del_rol("raro").model == "c"
    monkeypatch.delattr(gateway, "sondear", raising=False)
    assert asyncio.run(sup._sondear(modelos.cerebro)) is True
    vistos = []

    async def sondear(lm):
        vistos.append(lm.model)
        return False

    monkeypatch.setattr(gateway, "sondear", sondear, raising=False)
    assert asyncio.run(sup._sondear(modelos.juez)) is False and vistos == ["j"]
