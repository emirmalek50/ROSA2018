"""Reparación del vigilante de modelos tras el adversario (18 de septiembre de 2026).

Cada test fija uno de los hallazgos y falla sin su arreglo:

- Los ejecutores de rosa/bucle/pasos.py ya no se tragan `ModeloSinRespuesta`
  por elemento: sale entera hasta el supervisor, y las tareas hermanas de un
  `gather` se cancelan en vez de seguir gastando intentos en segundo plano.
- Un intento cortado por tiempo con el gateway respondiendo al sondeo es un
  modelo lento con esta petición, no una caída: se amplía el tope una vez y, si
  vuelve a cortarse, el paso falla con `ModeloBloqueado` (nunca entra en el
  bucle esperar-sondear-relanzar).
- Una llamada que responde a la primera cierra la espera que otra dejó anotada
  para el mismo modelo (incidencia resuelta, evento `modelo_recuperado`).
- Sobre una corrida detenida o terminada no se anota espera y la incidencia se
  cierra al agotar los intentos.
- El detalle de la incidencia no inventa "no respondió en 300 s" cuando el fallo
  llegó al instante.
- `gateway.lm` no deja que LiteLLM reintente por dentro; las excepciones propias
  del vigilante no se reclasifican.

Sin red, sin esperas: dobles, dormir anulado y sondeo falso (los mismos dobles
que rosa/tests/test_vigilante_llamadas_adversario.py).
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from rosa import gateway as GW
from rosa import vigilante_modelos as VIG
from rosa.bucle import pasos as PASOS
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.modulos.contador import PresupuestoAgotado
from rosa.tests.test_integracion_pasos import _hipotesis
from rosa.tests.test_vigilante_llamadas import ProgramaFalso, _corrida  # con `al_ver` y `_corrida` sobre almacén o estado
from rosa.tests.test_vigilante_llamadas_adversario import (
    ASTRA,
    OPUS,
    LMFalso,
    Registro,
    VolumenProhibido,
    _con_fuente_y_afirmaciones,
    _ctx,
    _ejecutor,
    _eventos_modelo,
    _incidencias,
    _sin_red_ni_esperas,
    _umbral_corto,
)

RAIZ = Path(__file__).resolve().parents[2]


def _fases(reg: Registro) -> list[str]:
    return [c["fase"] for _, _, c in reg.salud]


# ---------------------------------------------------------------------------
# (1) Los ejecutores no se tragan ModeloSinRespuesta
# ---------------------------------------------------------------------------


def _try_llama_al_modelo(nodo: ast.Try) -> bool:
    """¿El cuerpo de este `try` (con lo anidado) llama a un modelo o a un helper
    que lo hace (Killer, revisión, tarjeta, análisis)?"""
    nombres_helper = {"_killer", "_revisar_hipotesis", "_completar_tarjeta", "reproducir", "analizar_hipotesis", "_consultas_amplitud"}
    for sub in nodo.body:
        for n in ast.walk(sub):
            if isinstance(n, ast.Call):
                f = n.func
                if isinstance(f, ast.Attribute) and f.attr in ({"llamar"} | nombres_helper):
                    return True
                if isinstance(f, ast.Name) and f.id in nombres_helper:
                    return True
    return False


def _captura(handler: ast.ExceptHandler, nombre: str) -> bool:
    t = handler.type
    if t is None:
        return nombre == "Exception"  # un `except:` desnudo también se traga todo
    tipos = t.elts if isinstance(t, ast.Tuple) else [t]
    for x in tipos:
        if isinstance(x, ast.Name) and x.id == nombre:
            return True
        if isinstance(x, ast.Attribute) and x.attr == nombre:
            return True
    return False


def test_ningun_except_exception_de_pasos_que_envuelve_una_llamada_al_modelo_se_traga_modelo_sin_respuesta():
    """Guardia sobre el código: cada `try` de rosa/bucle/pasos.py que envuelve una
    llamada al modelo y captura `Exception` tiene antes un `except
    VIG.ModeloSinRespuesta` (que relanza). Sin él, con Opus caído cada afirmación
    quedaba "sin_verificar" y la siguiente hacía otros cuatro intentos."""
    fuente = (RAIZ / "rosa" / "bucle" / "pasos.py").read_text(encoding="utf-8")
    arbol = ast.parse(fuente)
    faltan: list[str] = []
    revisados = 0
    for nodo in ast.walk(arbol):
        if not isinstance(nodo, ast.Try) or not _try_llama_al_modelo(nodo):
            continue
        idx_exc = next((i for i, h in enumerate(nodo.handlers) if _captura(h, "Exception") or _captura(h, "BaseException")), None)
        if idx_exc is None:
            continue
        revisados += 1
        idx_vig = next((i for i, h in enumerate(nodo.handlers) if _captura(h, "ModeloSinRespuesta")), None)
        if idx_vig is None or idx_vig > idx_exc:
            faltan.append(f"línea {nodo.lineno}")
        else:
            cuerpo = nodo.handlers[idx_vig].body
            # Atribuir la espera a un miembro del laboratorio no consume la
            # excepción: se permite esa traza antes de relanzarla intacta.
            trazas = cuerpo[:-1]
            assert all(isinstance(x, ast.Expr) and isinstance(x.value, ast.Call) and isinstance(x.value.func, ast.Attribute)
                       and x.value.func.attr == "actividad" for x in trazas), f"línea {nodo.lineno}: solo puede registrar actividad antes de relanzar"
            assert isinstance(cuerpo[-1], ast.Raise) and cuerpo[-1].exc is None, f"línea {nodo.lineno}: el except del vigilante debe relanzar tal cual"
    assert revisados >= 14, f"se esperaban al menos 14 bloques con llamada al modelo y except Exception; hay {revisados}"
    assert faltan == [], f"bloques que se tragan ModeloSinRespuesta: {faltan}"


def test_en_paralelo_cancela_a_las_hermanas_cuando_una_lanza_modelo_sin_respuesta():
    terminadas: list[int] = []
    canceladas: list[int] = []

    async def lenta(i: int) -> str:
        try:
            await asyncio.sleep(5)
            terminadas.append(i)
            return f"ok-{i}"
        except asyncio.CancelledError:
            canceladas.append(i)
            raise

    async def rota() -> str:
        await asyncio.sleep(0)
        raise VIG.ModeloSinRespuesta("juez", "anthropic/claude-opus-5", 4, 1_700_000_000_000)

    async def escenario() -> None:
        with pytest.raises(VIG.ModeloSinRespuesta):
            await PASOS._en_paralelo(lenta(1), rota(), lenta(2), lenta(3))

    asyncio.run(escenario())
    assert terminadas == [] and sorted(canceladas) == [1, 2, 3], "las hermanas se cancelan, no siguen gastando intentos"


def test_en_paralelo_con_return_exceptions_devuelve_los_fallos_en_su_sitio_salvo_los_que_cortan_el_paso():
    async def bien(x: int) -> int:
        return x

    async def mal() -> int:
        raise ValueError("una consulta rota no tumba a las otras")

    salida = asyncio.run(PASOS._en_paralelo(bien(1), mal(), bien(3), return_exceptions=True))
    assert salida[0] == 1 and isinstance(salida[1], ValueError) and salida[2] == 3
    assert asyncio.run(PASOS._en_paralelo(return_exceptions=True)) == []

    canceladas: list[str] = []

    async def lenta() -> int:
        try:
            await asyncio.sleep(5)
            return 0
        except asyncio.CancelledError:
            canceladas.append("lenta")
            raise

    async def sin_presupuesto() -> int:
        raise PresupuestoAgotado("sin presupuesto")

    with pytest.raises(PresupuestoAgotado):
        asyncio.run(PASOS._en_paralelo(lenta(), sin_presupuesto(), return_exceptions=True))
    assert canceladas == ["lenta"]


def test_verificar_afirmaciones_cancela_a_las_afirmaciones_que_esperaban_al_semaforo(monkeypatch):
    """Seis afirmaciones, semáforo de 4: con el juez caído salen 4 x 4 intentos
    como mucho (las cuatro en vuelo), nunca 6 x 4. La excepción llega entera."""
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    juez = ProgramaFalso(*[httpx.ReadTimeout("el gateway no contesta")] * 60)
    ctx.programas.juzgar = juez
    afirmaciones = _con_fuente_y_afirmaciones(al, ctx, 6)
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(PASOS.verificar_afirmaciones(ctx, afirmaciones, None, "GFAP en el Alzheimer"))
    # Las cuatro en vuelo agotan sus intentos; una que esperaba al semáforo puede
    # colar UN intento antes de que la cancelación le llegue (con la red real cede
    # en el primer await); nunca sus cuatro.
    assert len(juez.vistos) <= 4 * VIG.MAX_INTENTOS + 2, f"el juez recibió {len(juez.vistos)} intentos: las afirmaciones que esperaban al semáforo también lo intentaron"
    assert len(juez.vistos) < 6 * VIG.MAX_INTENTOS
    assert _corrida(al, ctx.corrida_id)["estado"] == "esperando_modelo"
    al.cerrar()


def test_revisar_hipotesis_deja_salir_la_excepcion_y_no_evalua_supuestos_con_el_juez_caido(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    h = _hipotesis()
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    ctx.programas.revisar_inicial = ProgramaFalso(*[TimeoutError()] * 8)
    supuestos = ProgramaFalso("nunca")
    ctx.programas.evaluar_supuesto = supuestos
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(PASOS._revisar_hipotesis(ctx, h, "", None))
    assert supuestos.vistos == [], "con el juez caído no se sigue 'con los supuestos y el Killer': el paso espera"
    al.cerrar()


def test_los_supuestos_en_paralelo_cortan_el_paso_y_no_llegan_al_killer(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    h = _hipotesis(supuestos=[{"id": f"sup-{i}", "texto": f"Supuesto {i}", "estado": "sin_evidencia", "evidencia": "", "hijos": []} for i in range(6)])
    h["_revisionInicialVersion"] = h.get("version", 1)
    h["ultimaRevisionAutomatica"] = 1
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    volumen = ProgramaFalso(*[TimeoutError()] * 60)
    ctx.programas.evaluar_supuesto = volumen
    ctx.modelos = SimpleNamespace(cerebro=LMFalso(ASTRA), juez=LMFalso(OPUS), volumen=LMFalso("openai/proveedor/volumen-falso"), replica=LMFalso(OPUS))
    llamadas_killer: list[str] = []

    async def killer_falso(ctx_: Any, h_: dict[str, Any], texto: str, pista: Any) -> str:
        llamadas_killer.append(h_["id"])
        return "avanzar"

    monkeypatch.setattr(PASOS, "_killer", killer_falso)
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(PASOS._revisar_hipotesis(ctx, h, "", None))
    assert llamadas_killer == [], "el Killer no se pasa con el modelo de volumen caído: el paso espera"
    assert len(volumen.vistos) <= 4 * VIG.MAX_INTENTOS + 2 and len(volumen.vistos) < 6 * VIG.MAX_INTENTOS, f"{len(volumen.vistos)} intentos: las hermanas siguieron intentando"
    al.cerrar()


def test_el_killer_con_opus_caido_no_cuenta_un_intento_ni_suspende_la_hipotesis(monkeypatch):
    """Lo contrario de S-09 aplicado a un modelo CAÍDO: `_registrar_juez_sin_respuesta`
    es para un juez que responde mal (filtro, parseo); con Opus caído la regla de
    Emir manda esperar, así que `ModeloSinRespuesta` sale del Killer sin contar
    intento, sin incidencia `juez_sin_respuesta` (que sí bloquea) y sin tocar la
    decisión anterior."""
    from rosa import conectores as CON
    from rosa.tests.test_integracion_pasos import consultar_falso

    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    h = _hipotesis()
    h["decisionKiller"] = "avanzar"
    al.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    monkeypatch.setattr(CON, "consultar", consultar_falso({}))

    async def sin_sesgo(ctx_: Any, h_: dict[str, Any], pista: Any) -> None:
        return None

    monkeypatch.setattr(PASOS, "_evaluar_sesgo_fuentes", sin_sesgo)
    juez = ProgramaFalso(*[httpx.ReadTimeout("Opus no contesta")] * 8)
    ctx.programas.killer = juez
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(PASOS._killer(ctx, h, "", None))
    x = next(y for y in al.estado["hipotesis"] if y["id"] == h["id"])
    assert len(juez.vistos) == VIG.MAX_INTENTOS and {m for m, _ in juez.vistos} == {OPUS}
    assert "_killerIntentos" not in x and "killerPendiente" not in x, "una caída del modelo no es 'el juez no respondió (intento N de 3)'"
    assert x["decisionKiller"] == "avanzar"
    assert not any(i["tipo"] == "juez_sin_respuesta" for i in al.estado["incidencias"]), "la incidencia que bloquea no se abre por una caída"
    tipos = {i["tipo"] for i in al.estado["incidencias"] if i["corridaId"] == ctx.corrida_id}
    assert tipos == {"modelo_sin_respuesta"}
    al.cerrar()


def test_una_llamada_dentro_de_un_ejecutor_que_hoy_llama_por_helper_tambien_relanza():
    """`_completar_tarjeta` y `_evaluar_sesgo_fuentes` capturan por elemento; el
    código fuente enseña el `except VIG.ModeloSinRespuesta: raise` delante."""
    for fn in (PASOS._completar_tarjeta, PASOS._evaluar_sesgo_fuentes, PASOS._auditar_descarte):
        codigo = inspect.getsource(fn)
        assert "except VIG.ModeloSinRespuesta:" in codigo, fn.__name__


# ---------------------------------------------------------------------------
# (4) Un modelo vivo pero lento no es una caída
# ---------------------------------------------------------------------------


def test_un_corte_con_el_sondeo_vivo_amplia_el_tope_y_reintenta_sin_contarlo_como_caida(monkeypatch):
    _umbral_corto(monkeypatch)
    programa = ProgramaFalso("duerme", "ok")
    reg = Registro(sondeos=[True])
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos())) == "ok"
    assert len(programa.vistos) == 2 and programa.vistos[1] == (ASTRA, None), "mismo modelo, mismo rollout: la caché no tenía la respuesta porque nunca terminó"
    assert _fases(reg) == ["sondeo", "ok"], "ni fase 'fallo' ni caída"
    assert reg.incidencias == [] and reg.eventos == [] and reg.dormidas == []
    assert reg.salud[-1][2]["recuperado"] is False


def test_dos_cortes_con_el_sondeo_vivo_bloquean_el_paso_en_vez_de_declarar_caido(monkeypatch):
    _umbral_corto(monkeypatch)
    programa = ProgramaFalso(*["duerme"] * 6)
    reg = Registro(sondeos=[True] * 10)
    with pytest.raises(VIG.ModeloBloqueado) as info:
        asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    ex = info.value
    assert ex.motivo == "lento" and ex.reintentos == VIG.MAX_LENTOS + 1 and "tarda más" in str(ex)
    assert len(programa.vistos) == VIG.MAX_LENTOS + 1, "un tope ampliado y se para: no se paga una tercera generación cortada"
    assert reg.sondeos_hechos == 2 and reg.dormidas == []
    assert [a for a, _ in reg.incidencias] == ["bloqueo"]
    d = reg.incidencias[0][1]
    assert "tarda más de" in d["detalle"] and "no es una caída" in d["detalle"] and "GPT-6 Astra" in d["titulo"]
    assert reg.eventos == [], "sin evento 'no responde': el modelo responde"
    assert "fallo" not in _fases(reg)


def test_el_tope_ampliado_se_multiplica_una_vez_y_no_pasa_del_maximo():
    assert VIG._tope_ampliado(240) == 480 and VIG._tope_ampliado(300) == 600
    assert VIG._tope_ampliado(400) == 600, "no pasa de TOPE_LENTO_S"
    assert VIG._tope_ampliado(900) == 900, "un tope ya mayor que el máximo se respeta"


def test_un_corte_con_el_sondeo_muerto_sigue_siendo_una_caida_y_anota_el_sondeo(monkeypatch):
    _umbral_corto(monkeypatch)
    marcas = _sin_red_ni_esperas(monkeypatch)  # sondeo siempre False
    al, ctx = _ctx()
    programa = ProgramaFalso("duerme", "ok")
    vistos_a_mitad: dict[str, Any] = {}

    def mirar(n: int) -> None:
        if n == 2:
            vistos_a_mitad["espera"] = dict(_corrida(al, ctx.corrida_id)["esperandoModelo"])

    programa.al_ver = mirar
    assert asyncio.run(ctx.llamar("cerebro", programa, x=1)) == "ok"
    assert marcas["sondeos"] == 1 and marcas["dormidas"] == [15]
    esp = vistos_a_mitad["espera"]
    assert isinstance(esp["ultimoSondeo"], int) and esp["intentos"] == 1, "el sondeo del corte queda anotado en la espera aunque fuera antes de fijarla"
    s = al.estado["saludModelos"]["cerebro"]
    assert s["caidas"] == 1 and s["estado"] == "ok"
    inc = _incidencias(al, ctx.corrida_id)
    assert len(inc) == 1 and inc[0]["estado"] == "resuelta" and "no respondió en 0 s" in inc[0]["detalle"] or "volvió" in inc[0]["detalle"]
    al.cerrar()


def test_un_modelo_lento_a_nivel_de_corrida_falla_el_paso_con_incidencia_y_sin_espera(monkeypatch):
    _umbral_corto(monkeypatch)
    _sin_red_ni_esperas(monkeypatch, sondeos=[True, True, True])
    al, ctx = _ctx()
    with pytest.raises(VIG.ModeloBloqueado):
        asyncio.run(ctx.llamar("juez", ProgramaFalso(*["duerme"] * 4), x=1))
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "en_marcha" and c["esperandoModelo"] is None, "no entra en esperando_modelo: el supervisor no lo relanzaría en bucle"
    tipos = [i["tipo"] for i in _incidencias(al, ctx.corrida_id)]
    assert tipos == ["modelo_bloqueado"]
    assert _eventos_modelo(al) == []
    assert al.estado.get("saludModelos", {}).get("juez", {}).get("caidas", 0) == 0
    al.cerrar()


def test_intento_acotado_distingue_el_corte_del_timeout_que_lanza_el_programa(monkeypatch):
    async def propio(lm: Any) -> Any:
        raise TimeoutError("lo lanzó LiteLLM por dentro")

    async def tarde(lm: Any) -> Any:
        await asyncio.sleep(0.3)
        return "tarde"

    with pytest.raises(TimeoutError) as info:
        asyncio.run(VIG._intento_acotado(propio, None, 0.5))
    assert not isinstance(info.value, VIG.CortePorTiempo)
    with pytest.raises(VIG.CortePorTiempo) as info2:
        asyncio.run(VIG._intento_acotado(tarde, None, 0.02))
    assert info2.value.tiempo_s == 0.02 and VIG.clasificar_fallo(info2.value) == "transitorio"


# ---------------------------------------------------------------------------
# (3) Un éxito cierra la espera que otra llamada dejó anotada
# ---------------------------------------------------------------------------


def test_un_exito_limpio_con_una_espera_heredada_la_resuelve_con_sus_intentos_reales():
    reg = Registro()
    g = reg.ganchos()
    g.espera_pendiente = lambda rol, modelo: {"rol": "juez", "modelo": modelo, "intentos": 4, "desde": reg.t - 20 * 60_000}
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(ProgramaFalso("ok")), "juez", LMFalso(OPUS), ganchos=g)) == "ok"
    assert _fases(reg) == ["ok"] and reg.salud[0][2]["recuperado"] is True and reg.salud[0][2]["intentos"] == 4
    assert [a for a, _ in reg.incidencias] == ["resolver"] and reg.incidencias[0][1]["intentos"] == 4
    assert reg.eventos == [("modelo_recuperado", "Claude Opus 5 volvió tras 4 intentos y 20 minutos")]


def test_un_exito_limpio_sin_espera_heredada_no_resuelve_ni_emite_nada():
    reg = Registro()
    g = reg.ganchos()
    g.espera_pendiente = lambda rol, modelo: None
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(ProgramaFalso("ok")), "juez", LMFalso(OPUS), ganchos=g)) == "ok"
    assert reg.incidencias == [] and reg.eventos == [] and reg.salud[0][2]["recuperado"] is False


def test_una_espera_heredada_de_otro_modelo_no_se_cierra_por_el_exito_de_este(monkeypatch):
    """La corrida espera a Opus (juez); responde Astra (cerebro): la espera del
    juez sigue, porque nada demuestra que Opus haya vuelto."""
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(ctx.llamar("juez", ProgramaFalso(*[TimeoutError()] * 8), x=1))
    assert asyncio.run(ctx.llamar("cerebro", ProgramaFalso("ok"), x=2)) == "ok"
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["modelo"] == "anthropic/claude-opus-5"
    assert len(_incidencias(al, ctx.corrida_id, "pendiente")) == 1
    assert _eventos_modelo(al) == ["modelo_sin_respuesta"]
    al.cerrar()


def test_un_gancho_espera_pendiente_que_lanza_no_rompe_una_llamada_que_respondio():
    reg = Registro()
    g = reg.ganchos()

    def roto(rol: str, modelo: str) -> Any:
        raise RuntimeError("estado ilegible")

    g.espera_pendiente = roto
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(ProgramaFalso("ok")), "cerebro", LMFalso(ASTRA), ganchos=g)) == "ok"
    assert reg.incidencias == [] and reg.eventos == []


# ---------------------------------------------------------------------------
# (5) Corridas detenidas o terminadas
# ---------------------------------------------------------------------------


def test_fijar_espera_no_escribe_sobre_una_corrida_detenida_ni_terminada():
    for estado in ("detenida", "terminada"):
        e = {"corridas": [{"id": "c1", "estado": estado, "esperandoModelo": None}], "iteraciones": []}
        assert VIG.fijar_espera_modelo(e, "c1", None, "juez", "anthropic/claude-opus-5", {"intentos": 1, "desde": 1, "ahora": 2, "proximoIntentoEn": 3}) is False
        assert e["corridas"][0]["esperandoModelo"] is None and e["corridas"][0]["estado"] == estado
    e = {"corridas": [{"id": "c1", "estado": "pausada", "esperandoModelo": None}], "iteraciones": []}
    assert VIG.fijar_espera_modelo(e, "c1", None, "juez", "anthropic/claude-opus-5", {"intentos": 1, "desde": 1, "ahora": 2, "proximoIntentoEn": 3}) is True
    assert e["corridas"][0]["estado"] == "pausada", "una pausa a mano se respeta; la espera queda anotada"


def test_cerrar_espera_solo_actua_si_la_corrida_ya_no_sigue():
    inc = {"id": "i1", "corridaId": "c1", "tipo": "modelo_sin_respuesta", "recurso": "anthropic/claude-opus-5", "estado": "pendiente", "detalle": "", "resueltaEn": None, "resolucion": None}
    e = {"corridas": [{"id": "c1", "estado": "esperando_modelo", "esperandoModelo": {"modelo": "anthropic/claude-opus-5", "intentos": 4}}], "incidencias": [inc]}
    datos = {"modelo": "anthropic/claude-opus-5", "nombre": "Claude Opus 5", "intentos": 4, "ahora": 5}
    assert VIG.cerrar_espera_si_no_sigue(e, "c1", datos) is False and inc["estado"] == "pendiente", "la corrida sigue: el supervisor sondea"
    e["corridas"][0]["estado"] = "terminada"
    assert VIG.cerrar_espera_si_no_sigue(e, "c1", datos) is True
    assert e["corridas"][0]["esperandoModelo"] is None and inc["estado"] == "resuelta" and inc["resolucion"] == VIG.RESOLUCION_CERRADA
    assert "ya no seguía" in inc["detalle"] and inc["resueltaEn"] == 5


def test_una_llamada_sobre_una_corrida_terminada_cierra_su_incidencia_al_agotar(monkeypatch):
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()

    def terminar(e: dict[str, Any]) -> bool:
        c = _corrida(e, ctx.corrida_id)
        c["estado"] = "terminada"
        c["terminadaEn"] = P.ahora_ms()
        return True

    al.mutar(terminar, "prueba")
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(ctx.llamar("cerebro", ProgramaFalso(*[TimeoutError()] * 8), x=1))
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "terminada" and c["esperandoModelo"] is None
    propias = _incidencias(al, ctx.corrida_id)
    assert len(propias) == 1 and propias[0]["estado"] == "resuelta" and propias[0]["resolucion"] == VIG.RESOLUCION_CERRADA
    assert al.estado["saludModelos"]["cerebro"]["estado"] == "sin_respuesta", "la salud global sí dice que Astra está caído"
    al.cerrar()


def test_detener_a_mano_durante_los_reintentos_cierra_la_incidencia_al_agotar(monkeypatch):
    """La persona pulsa Detener mientras el vigilante reintenta (la tarea no se
    cancela: el bucle de la corrida mira el estado entre pasos). Al agotar los
    intentos la espera y la incidencia se cierran, no quedan colgadas."""
    _sin_red_ni_esperas(monkeypatch)
    al, ctx = _ctx()
    programa = ProgramaFalso(*[TimeoutError()] * 8)

    def detener_a_mitad(n: int) -> None:
        if n == 2:
            assert _corrida(al, ctx.corrida_id)["estado"] == "esperando_modelo"
            al.mutar(lambda e: A.detener_corrida(e, ctx.corrida_id, "Detenida por la investigadora.", P.ahora_ms()), "detener")

    programa.al_ver = detener_a_mitad
    with pytest.raises(VIG.ModeloSinRespuesta):
        asyncio.run(ctx.llamar("juez", programa, x=1))
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "detenida" and c["esperandoModelo"] is None
    assert _incidencias(al, ctx.corrida_id, "pendiente") == []
    al.cerrar()


def test_una_cancelacion_durante_la_espera_conserva_el_registro_para_el_arranque(monkeypatch):
    """Apagar el servidor cancela la tarea a mitad de la espera: la corrida sigue
    en `esperando_modelo` con su registro y su incidencia, y al arrancar el
    supervisor sondea (rosa/bucle/corrida.py). Limpiar aquí perdería el 'desde'."""
    marcas = _sin_red_ni_esperas(monkeypatch, dormir_real_s=5.0)
    al, ctx = _ctx()
    programa = ProgramaFalso(TimeoutError(), "ok")

    async def escenario() -> None:
        tarea = asyncio.create_task(ctx.llamar("cerebro", programa, x=1))
        for _ in range(400):
            await asyncio.sleep(0.005)
            if marcas["dormidas"]:
                break
        tarea.cancel()
        with pytest.raises(asyncio.CancelledError):
            await tarea

    asyncio.run(escenario())
    c = _corrida(al, ctx.corrida_id)
    assert c["estado"] == "esperando_modelo" and c["esperandoModelo"]["intentos"] == 1
    assert len(_incidencias(al, ctx.corrida_id, "pendiente")) == 1
    al.cerrar()


# ---------------------------------------------------------------------------
# (6) El detalle dice lo que pasó
# ---------------------------------------------------------------------------


def test_el_detalle_distingue_corte_instantaneo_y_fallo_tardio():
    assert "no respondió en 300 s" in VIG.texto_detalle_intento("juez", "Claude Opus 5", 1, 300, None, "TimeoutError", cortado=True)
    inst = VIG.texto_detalle_intento("juez", "Claude Opus 5", 1, 300, None, "ConnectError: sin ruta", cortado=False, latencia_s=0.01)
    assert "falló al instante" in inst and "300 s" not in inst
    tarde = VIG.texto_detalle_intento("cerebro", "GPT-6 Astra", 2, 240, 1_700_000_000_000, "503 Service Unavailable", cortado=False, latencia_s=12.7)
    assert "falló a los 12 s" in tarde and "intento 2 de 4" in tarde and "Siguiente intento a las" in tarde
    assert "falló (" in VIG.texto_detalle_intento("volumen", "Claude Sonnet 5", 1, 120, None, "x", cortado=False)


def test_un_fallo_que_tardo_dice_cuanto_tardo():
    reg = Registro()
    g = reg.ganchos()
    reloj = {"t": 0.0}

    def avanzar() -> float:
        reloj["t"] += 7.0
        return reloj["t"]

    g.reloj = avanzar
    programa = ProgramaFalso(RuntimeError("502 Bad Gateway"), "ok")
    assert asyncio.run(VIG.llamar_vigilado(_ejecutor(programa), "juez", LMFalso(OPUS), ganchos=g)) == "ok"
    detalle = reg.incidencias[0][1]["detalle"]
    assert "falló a los 7 s" in detalle and "502 Bad Gateway" in detalle and "en 300 s" not in detalle


# ---------------------------------------------------------------------------
# (7) y (8): LiteLLM no reintenta por dentro; las excepciones propias no se reclasifican
# ---------------------------------------------------------------------------


def test_gateway_lm_respeta_un_num_retries_explicito(monkeypatch):
    monkeypatch.setenv("ROSA_GATEWAY_KEY", "clave-de-prueba")
    assert GW.lm("openai/gpt-6-astra").num_retries == 0
    assert GW.lm("openai/gpt-6-astra", num_retries=2).num_retries == 2
    m = GW.modelos()
    assert m.cerebro.num_retries == 0 and m.juez.num_retries == 0 and m.volumen.num_retries == 0 and m.replica.num_retries == 0


def test_las_excepciones_propias_se_clasifican_como_otro_y_se_propagan_sin_reintentar():
    for ex in (
        VIG.ModeloSinRespuesta("juez", "anthropic/claude-opus-5", 4, 1_700_000_000_000),
        VIG.ModeloBloqueado("cerebro", "openai/gpt-6-astra", 2, "RuntimeError: Empty response from the model"),
        VIG.ModeloBloqueado("cerebro", "openai/gpt-6-astra", 2, "tarda más de 480 s; timeout", motivo="lento"),
    ):
        assert VIG.clasificar_fallo(ex) == "otro", str(ex)
    interior = ProgramaFalso(VIG.ModeloBloqueado("cerebro", "openai/gpt-6-astra", 2, "Empty response"))
    reg = Registro()
    with pytest.raises(VIG.ModeloBloqueado):
        asyncio.run(VIG.llamar_vigilado(_ejecutor(interior), "cerebro", LMFalso(ASTRA), ganchos=reg.ganchos()))
    assert len(interior.vistos) == 1 and reg.incidencias == [], "el vigilante exterior no repite lo que el interior ya agotó"


def test_pasos_usa_la_excepcion_de_bloqueo_del_vigilante():
    assert PASOS.ModeloBloqueado is VIG.ModeloBloqueado


def test_el_modelo_de_volumen_sigue_prohibido_en_toda_la_reparacion(monkeypatch):
    """Ninguno de los caminos nuevos (lento, espera heredada, cierre) toca a Sonnet."""
    _umbral_corto(monkeypatch)
    _sin_red_ni_esperas(monkeypatch, sondeos=[True])
    al, ctx = _ctx()
    assert isinstance(ctx.modelos.volumen, VolumenProhibido)
    assert asyncio.run(ctx.llamar("cerebro", ProgramaFalso("duerme", "ok"), x=1)) == "ok"
    al.cerrar()
