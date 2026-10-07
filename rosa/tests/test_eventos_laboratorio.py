"""Escenas públicas procedentes de decisiones reales, sin red ni modelos.

Las pruebas recorren SQLite, cribado, torneo y sandbox simulado. Una escena
fallida nunca se convierte en un resultado científico favorable.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace

import pytest

from rosa import ejecucion as X
from rosa.bucle import analisis as AN
from rosa.bucle import eventos_laboratorio as EL
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.bucle.pista import Pista
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.fuentes.base import FuenteNoDisponible
from rosa.modulos.contador import PresupuestoAgotado


@pytest.fixture
def ctx(tmp_path):
    almacen = Almacen(tmp_path / "escenas.db")

    def preparar(e):
        inv = A.crear_investigacion(e, {"titulo": "Prueba de escenas", "objetivo": "Comparar evidencia de GFAP", "condicionParada": "2 iteraciones"}, 1000)
        corrida = P.nueva_corrida(inv, 1, 1000)
        corrida.update(id="cor", estado="en_marcha")
        e["corridas"].append(corrida)
        iteracion = P.nueva_iteracion("cor", 1, 1000, [])
        iteracion["id"] = "it"
        e["iteraciones"].append(iteracion)
        return inv

    inv_id = almacen.mutar(preparar, "prueba")
    programas = SimpleNamespace(comparar="comparar", codigo="codigo", reparar="reparar", interpretar="interpretar", auditar_analisis="auditar", relevancia="relevancia", relevancia_amplitud="amplitud")
    modelos = SimpleNamespace(cerebro=SimpleNamespace(model="simulado"), juez=SimpleNamespace(model="juez-simulado"), volumen=SimpleNamespace(model="simulado"))
    contexto = Ctx(almacen, programas, modelos, "cor", inv_id, "it", 1)
    yield contexto
    contexto.almacen.cerrar()


def _entradas(ctx):
    return [linea for pista in ctx.almacen.instantanea()["iteraciones"][0]["pistas"] for linea in pista["transcripcion"]]


def _eventos(ctx, tipo=None):
    return [linea["eventoLab"] for linea in _entradas(ctx) if "eventoLab" in linea and (tipo is None or linea["eventoLab"]["tipo"] == tipo)]


def _hipotesis(ctx, id_, titulo="Mismo título"):
    h = P.nueva_hipotesis(ctx.investigacion_id, 1, 1000, titulo=titulo, enunciado="Hipótesis de prueba", mecanismo="Mecanismo", comprobacion={"biomarcador": "GFAP", "cohorte": "cohorte", "diseno": "cohorte"}, afirmaciones=[])
    h["id"] = id_
    ctx.mutar(lambda e: e["hipotesis"].append(h) or True, "prueba")
    return h


@pytest.mark.parametrize("evento", [
    {"tipo": "otro"},
    {"tipo": "analisis", "ejecucionId": "run", "estado": "terminado", "sintetico": 1},
    {"tipo": "analisis", "ejecucionId": "run", "estado": "eficaz", "sintetico": False},
    {"tipo": "analisis", "ejecucionId": "run", "estado": "terminado", "sintetico": False, "codigo": "dato privado"},
    {"tipo": "analisis", "ejecucionId": "run\nmezclado", "estado": "terminado", "sintetico": False},
    {"tipo": "analisis", "ejecucionId": "r" * 513, "estado": "terminado", "sintetico": False},
    {"tipo": "idea", "hipotesisId": "", "titulo": "Idea", "enfoque": "analogia"},
    {"tipo": "idea", "hipotesisId": "h", "titulo": ["Título"], "enfoque": "analogia"},
    {"tipo": "articulo", "id": "doi:10.1/x", "titulo": "Artículo", "estado": "incluido", "motivo": "", "modo": "inventado"},
    {"tipo": "torneo", "hipotesisAId": "h", "hipotesisBId": "h", "tituloA": "a", "tituloB": "b", "estado": "a", "porRegla": True},
])
def test_contrato_invalido_no_llega_al_estado_publico(ctx, evento):
    pista = ctx.pista("paso", "modelo", "Prueba", "ROSA")
    with pytest.raises(ValueError):
        pista.linea_lab("resultado", "Línea inválida", evento)
    pista.volcar()
    assert _entradas(ctx) == []


def test_metadatos_acotados_copiados_y_replay_conserva_procedencia(ctx, monkeypatch):
    monkeypatch.setattr("rosa.bucle.pista.time.monotonic", lambda: 20.0)
    pista = ctx.pista("paso", "modelo", "Mismo título", "ROSA", hipotesis_id="h-real")
    pista.accion("Texto anterior sin evento")
    evento = EL.articulo("fu-real", {"titulo": "t" * 1000}, "no_comprobado", "m" * 1000, "amplitud")
    pista.linea_lab("accion", "Consultar la fuente real", evento)
    # La acción se publica antes de una llamada larga, aunque ya había una línea.
    entradas = _entradas(ctx)
    assert len(entradas) == 2
    assert set(entradas[0]) == {"t", "tipo", "texto"}
    assert entradas[1]["t"] == 0
    assert len(entradas[1]["eventoLab"]["titulo"]) == 320
    assert len(entradas[1]["eventoLab"]["motivo"]) == 240
    evento["id"] = "fu-equivocada"
    pista.cerrar("Consulta terminada")
    ruta = ctx.almacen.ruta
    ctx.almacen.cerrar()
    ctx.almacen = Almacen(ruta)
    publica = ctx.almacen.instantanea()["iteraciones"][0]
    assert publica["corridaId"] == "cor"
    assert publica["pistas"][0]["iteracionId"] == "it"
    assert publica["pistas"][0]["hipotesisId"] == "h-real"
    assert _eventos(ctx)[0]["id"] == "fu-real"
    assert "corridaId" not in _eventos(ctx)[0]
    assert "_" not in "".join(_eventos(ctx)[0].keys())


def test_doble_historico_conserva_texto_y_metodo_real_no_oculta_errores():
    vistas = []
    doble = SimpleNamespace(resultado=lambda texto: vistas.append(texto))
    EL.registrar(doble, "resultado", "Registro científico original", {"tipo": "idea"})
    assert vistas == ["Registro científico original"]

    def rechazar(*args):
        raise ValueError("Contrato roto")

    doble.linea_lab = rechazar
    with pytest.raises(ValueError, match="Contrato roto"):
        EL.registrar(doble, "resultado", "Registro", {"tipo": "idea"})
    assert vistas == ["Registro científico original"]


@pytest.mark.parametrize("modo", ["foco", "amplitud"])
def test_cribado_publica_ids_guardados_y_fallo_no_es_exclusion(ctx, monkeypatch, modo):
    obras = [{"titulo": titulo, "referencia": "Referencia compartida", "doi": f"10.123/{nombre}", "resumen": "Texto de prueba", "tipos": [], "autores": []}
             for nombre, titulo in (("a", "Artículo incluido"), ("b", "Artículo sin evaluar"), ("c", "Artículo excluido"))]
    obras.append({"titulo": "Excluido sin identificadores", "referencia": "Sin identificador", "resumen": "Texto", "tipos": [], "autores": []})

    async def buscar(*args, **kwargs):
        return copy.deepcopy(obras), 4

    async def cortar(_pregunta, articulos, _pista):
        return articulos, []

    async def llamar(rol, programa, **kwargs):
        if kwargs["titulo"] == "Artículo sin evaluar":
            raise RuntimeError("El cribador no respondió")
        return SimpleNamespace(puntuacion=8 if kwargs["titulo"] == "Artículo incluido" else 1, motivo="Criterio comprobado", podria_cambiar="Ampliar el mecanismo")

    async def retraccion(*args):
        return None, "Sin marca", 1000

    async def fragmentos(_ctx, datos, _pista, _completo):
        return [{"localizador": "resumen", "texto": datos["resumen"], "encabezado": ""}]

    monkeypatch.setattr(PASOS, "_buscar_en_base", buscar)
    monkeypatch.setattr(PASOS, "cortar_con_reranker", cortar)
    monkeypatch.setattr(PASOS, "_comprobar_retraccion", retraccion)
    monkeypatch.setattr(PASOS, "_fragmentos_de", fragmentos)
    ctx.llamar = llamar
    consulta = {"base": "pubmed", "consulta": "GFAP", "tema": "Biomarcadores", "modo": modo, "porque": "Comparar el contexto"}
    resultado = asyncio.run(PASOS._consulta_literatura(ctx, {"id": "paso"}, consulta, "GFAP"))
    eventos = {x["titulo"]: x for x in _eventos(ctx, "articulo")}
    fuentes = ctx.fuentes()
    assert resultado["leidos"] == 2
    assert len(ctx.corrida()["busqueda"]["excluidos"]) == 2
    assert eventos["Artículo excluido"]["estado"] == "excluido"
    assert eventos["Artículo excluido"]["id"] == "doi:10.123/c"
    assert "Excluido sin identificadores" not in eventos
    for titulo, estado in (("Artículo incluido", "incluido"), ("Artículo sin evaluar", "no_comprobado")):
        escena = eventos[titulo]
        assert escena["id"] in fuentes
        assert fuentes[escena["id"]]["titulo"] == titulo
        assert escena["estado"] == estado
    assert all(x["modo"] == modo for x in eventos.values())
    assert "no respondió" in " ".join(x["texto"] for x in _entradas(ctx))


def test_base_no_disponible_no_inventa_escena_de_articulo(ctx, monkeypatch):
    async def buscar(*args, **kwargs):
        raise FuenteNoDisponible("La base no respondió")

    monkeypatch.setattr(PASOS, "_buscar_en_base", buscar)
    consulta = {"base": "pubmed", "consulta": "GFAP", "tema": "Biomarcadores"}
    resultado = asyncio.run(PASOS._consulta_literatura(ctx, {"id": "paso"}, consulta, "GFAP"))
    assert resultado["leidos"] == 0
    assert _eventos(ctx, "articulo") == []
    assert ctx.iteracion()["pistas"][0]["estado"] == "fallida"


@pytest.mark.parametrize("caso", ["regla", "juez", "tablas", "fallo"])
def test_torneo_identifica_par_real_y_solo_decide_tras_guardar(ctx, monkeypatch, caso):
    a, b = _hipotesis(ctx, "h-a"), _hipotesis(ctx, "h-b")
    ronda = PASOS.Ronda([] if caso == "regla" else [(a, b)], 0, {"h-a": "evidencia-a", "h-b": "evidencia-b"}, [(a, b, [], ["Sin respaldo"])] if caso == "regla" else [])
    monkeypatch.setattr(PASOS, "pares_del_torneo", lambda *args, **kwargs: ronda)

    async def mundo(*args, **kwargs):
        return ""

    monkeypatch.setattr(PASOS.T, "modelo_de_mundo_para", mundo)
    llamadas = []

    async def llamar(rol, programa, **kwargs):
        llamadas.append(kwargs)
        # El comienzo ya está persistido mientras el juez sigue sin responder.
        assert _eventos(ctx, "torneo")[0]["estado"] == "comparando"
        if caso == "fallo":
            raise RuntimeError("Juez no disponible")
        mejor = "A" if len(llamadas) == 1 or caso == "tablas" else "B"
        return SimpleNamespace(comparacion=SimpleNamespace(mejor=mejor, relacion="distintas", resumen="El respaldo difiere", eje="solidez"))

    ctx.llamar = llamar
    pista = ctx.pista("paso", "modelo", "Torneo", "Juez")
    jugados = asyncio.run(PASOS._torneo(ctx, pista))
    pista.cerrar("Torneo terminado")
    eventos = _eventos(ctx, "torneo")
    assert all((x["hipotesisAId"], x["hipotesisBId"]) == ("h-a", "h-b") for x in eventos)
    assert all(x["tituloA"] == x["tituloB"] == "Mismo título" for x in eventos)
    assert eventos[-1]["porRegla"] is (caso == "regla")
    if caso == "fallo":
        assert jugados == 0 and eventos[-1]["estado"] == "no_comprobado"
        assert a["partidos"] == b["partidos"] == []
        assert (a["elo"], b["elo"]) == (1500, 1500)
    else:
        assert jugados == 1 and len(a["partidos"]) == len(b["partidos"]) == 1
        assert a["partidos"][0]["rivalId"] == "h-b"
        assert eventos[-1]["estado"] == ("tablas" if caso == "tablas" else "a")
        assert (a["elo"], b["elo"]) == ((1500, 1500) if caso == "tablas" else (1516, 1484))
    assert len(llamadas) == (0 if caso == "regla" else 2)


def test_ideas_solo_se_publican_si_la_propuesta_entro_al_estado(ctx, monkeypatch):
    existente = _hipotesis(ctx, "h-anterior", "Idea ya registrada")
    fid = PASOS._registrar_fuente(ctx, {"titulo": "Artículo real de prueba", "referencia": "Autor, 2026", "doi": "10.123/a"}, "articulo", [], 8, None, "", 1000)
    afirmacion = {"id": "af-real", "texto": "La evidencia describe una asociación", "cita": "Autor, 2026", "veredicto": "sostenida", "motivo": "Coincide con el fragmento", "tipo": "hecho", "fuenteId": fid, "localizador": "resumen"}
    monkeypatch.setattr(PASOS.T, "afirmaciones_sostenidas", lambda *args: ("Evidencia", [afirmacion]))

    async def mundo(*args, **kwargs):
        return ""

    async def nichos(*args, **kwargs):
        return {"ocupados": [], "listos": [], "saturada": None, "sinFruto": 0}

    def propuesta(titulo, indices):
        return SimpleNamespace(titulo=titulo, afirmaciones=indices, derivada_de=None, enunciado="Hipótesis que decide una persona", mecanismo="Mecanismo de prueba", biomarcador="GFAP", cohorte="Dos cohortes", diseno="Cohorte", cluster="Glía", justificacion="Contexto", supuestos=[], diana="GFAP", celula="Astrocito", etapa="Temprana", intervencion="", direccion="sin_intervencion", prediccion_falsable="La asociación no se reproduce", riesgos=[], entidades_novedad=[])

    async def equipo(*args, **kwargs):
        return [(propuesta("Idea ya registrada", [1]), "analogia"), (propuesta("Idea sin respaldo", []), "otra_escala"), (propuesta("Idea nueva", [1]), "contradiccion")]

    async def omitir(*args, **kwargs):
        return 0

    monkeypatch.setattr(PASOS.T, "modelo_de_mundo_para", mundo)
    monkeypatch.setattr(PASOS.LEC, "para", mundo)
    monkeypatch.setattr(PASOS, "_archivo_de_nichos", nichos)
    monkeypatch.setattr(PASOS, "_equipo_de_hipotesis", equipo)
    monkeypatch.setattr(PASOS, "destino_de_propuesta", lambda *args: ("hipotesis", "baja", "Dos cohortes"))
    monkeypatch.setattr(PASOS.NI, "nicho_de_hipotesis", lambda *args: None)
    monkeypatch.setattr(PASOS.TRAT, "revisar_pendientes", omitir)
    monkeypatch.setattr(PASOS, "_revisar_hipotesis", omitir)
    monkeypatch.setattr(PASOS, "_torneo", omitir)
    asyncio.run(PASOS.paso_hipotesis(ctx, {"id": "paso"}))
    ideas = _eventos(ctx, "idea")
    assert len(ideas) == 1
    guardada = next(h for h in ctx.e["hipotesis"] if h["id"] == ideas[0]["hipotesisId"])
    assert guardada["titulo"] == ideas[0]["titulo"] == "Idea nueva"
    assert guardada["enfoque"] == ideas[0]["enfoque"] == "contradiccion"
    assert guardada["estado"] == "propuesta"
    assert guardada["_corridaOrigen"] == "cor"
    assert ideas[0]["hipotesisId"] != existente["id"]
    assert len(ctx.e["hipotesis"]) == 2 and ctx.e["hechos"] == []


@pytest.mark.parametrize("caso", ["completado", "error_tecnico", "tiempo_agotado", "no_ejecutado", "no_evaluable", "bloqueo", "reparado"])
def test_sandbox_escenifica_estado_registrado_sin_publicar_codigo(ctx, tmp_path, monkeypatch, caso):
    ruta = tmp_path / "datos.csv"
    ruta.write_text("x\n1\n", encoding="utf-8")
    plan = P.nuevo_plan_analisis(ctx.investigacion_id, "h-a", "ds", 1000, hashDatos=X.hash_fichero(ruta), pregunta="Comparar el efecto")
    ctx.mutar(lambda e: e["planesAnalisis"].append(plan) or True, "prueba")
    ds = {"nombre": "Datos sintéticos de prueba", "procedencia": {"sintetico": True}}
    monkeypatch.setattr(X, "runtime_disponible", lambda _sintetico: ("docker", ""))
    monkeypatch.setattr(AN, "MAX_REPARACIONES", 1 if caso == "reparado" else 0)
    monkeypatch.setattr(AN, "interpretacion_por_regla", lambda *args: {"estado": "sin_efecto_detectable", "detalle": "No supera el umbral congelado"})
    monkeypatch.setattr(X, "comprobaciones_deterministas", lambda *args: [])
    if caso == "bloqueo":
        monkeypatch.setattr(AN, "_verificar_congelado", lambda *args: "El fichero cambió desde el plan congelado")
    ejecutadas = []

    def ejecutar(*args):
        ejecutadas.append(args[4])
        assert _eventos(ctx, "analisis")[-1]["estado"] == "ejecutando"
        run_id = _eventos(ctx, "analisis")[-1]["ejecucionId"]
        assert any(x["id"] == run_id for x in ctx.e["ejecuciones"])
        estado = "completado" if caso in {"no_evaluable", "reparado"} else caso
        if caso == "reparado" and len(ejecutadas) == 1:
            estado = "error_tecnico"
        return X.Resultado(estado, "docker", salida="Log privado", error="Fallo de prueba" if estado != "completado" else "", resultados={"p_valor": "0.8"}, no_evaluable="Falta un grupo" if caso in {"no_evaluable", "reparado"} else None)

    monkeypatch.setattr(X, "ejecutar", ejecutar)
    llamadas = []

    async def llamar(rol, programa, **kwargs):
        llamadas.append(programa)
        if programa == "codigo":
            # Aún no hay ejecución registrada: no inventar un id para adornarla.
            assert _eventos(ctx, "analisis") == []
            return SimpleNamespace(codigo="print('Log privado')")
        if programa == "reparar":
            assert _eventos(ctx, "analisis")[-1]["estado"] == "programando"
            assert ctx.e["ejecuciones"][0]["estado"] == "en_curso"
            return SimpleNamespace(codigo_corregido="print('Código reparado')")
        if programa == "interpretar":
            assert _eventos(ctx, "analisis")[-1]["estado"] == "interpretando"
            return SimpleNamespace(interpretacion=SimpleNamespace(estado="efecto_detectado", resumen="Resumen del juez", cifras_clave=[]))
        assert programa == "auditar"
        assert _eventos(ctx, "analisis")[-1]["estado"] == "auditando"
        return SimpleNamespace(auditoria=SimpleNamespace(veredicto="no_valido", comprobaciones=[], motivo="Falta respaldo", plausibilidad_verificada=False))

    ctx.llamar = llamar
    pista = ctx.pista("paso", "analisis", "Análisis", "Sandbox", hipotesis_id="h-a")
    run = asyncio.run(AN._correr_plan(ctx, plan, ds, ruta, "", "h-a", "hipotesis", pista))
    pista.cerrar("Análisis terminado")
    eventos = _eventos(ctx, "analisis")
    assert len(ctx.e["ejecuciones"]) == 1
    assert all(x["ejecucionId"] == run["id"] and x["sintetico"] is True for x in eventos)
    assert all(set(x) == {"tipo", "ejecucionId", "estado", "sintetico"} for x in eventos)
    assert run["fin"] is not None
    if caso in {"completado", "no_evaluable", "reparado"}:
        assert eventos[-1]["estado"] == "terminado" and run["estado"] == "completado"
        if caso == "completado":
            assert len(ejecutadas) == 3
            assert run["interpretacion"]["estado"] == "sin_efecto_detectable"
            assert run["interpretacion"]["estadoJuez"] == "efecto_detectado"
            assert run["auditoria"]["veredicto"] == "no_valido"
            assert llamadas == ["codigo", "interpretar", "auditar"]
        else:
            assert llamadas == (["codigo", "reparar"] if caso == "reparado" else ["codigo"])
            assert run["interpretacion"]["estado"] == "no_evaluable"
            if caso == "reparado":
                assert [x["estado"] for x in eventos] == ["ejecutando", "fallido", "programando", "ejecutando", "terminado"]
                assert len(set(ejecutadas)) == 1 and run["codigo"].strip() == "print('Código reparado')"
    else:
        assert eventos[-1]["estado"] == "fallido"
        assert "terminado" not in [x["estado"] for x in eventos]
        assert run["estado"] == ("no_ejecutado" if caso == "bloqueo" else caso)
        assert llamadas == ["codigo"]
        assert len(ejecutadas) == (0 if caso == "bloqueo" else 1)


def test_datos_reales_conservan_marca_y_ensayo_seco_no_finge_otro_registro(ctx, tmp_path, monkeypatch):
    ruta = tmp_path / "datos.csv"
    ruta.write_text("x\n1\n", encoding="utf-8")
    plan = P.nuevo_plan_analisis(ctx.investigacion_id, None, "ds", 1000, hashDatos=X.hash_fichero(ruta))
    ds = {"nombre": "Tabla pública de prueba", "procedencia": {"sintetico": False}}
    monkeypatch.setattr(X, "runtime_disponible", lambda _sintetico: ("docker", ""))
    monkeypatch.setattr(X, "comprobaciones_deterministas", lambda *args: [])
    monkeypatch.setattr(AN, "interpretacion_por_regla", lambda *args: None)
    vistas = []

    async def llamar(*args, **kwargs):
        return SimpleNamespace(codigo="print('Prueba')")

    async def seco(_ctx, _plan, codigo, _ruta, _esquema, run_id, _entorno, _ficheros, _pista):
        assert _eventos(ctx, "analisis") == []
        assert len(ctx.e["ejecuciones"]) == 1
        vistas.append(("seco", run_id))
        return codigo, {"estado": "completado", "sintetico": True, "resultados": {}}

    def ejecutar(*args):
        assert args[3] is False
        vistas.append(("real", args[4]))
        return X.Resultado("completado", "docker", no_evaluable="La prueba no es aplicable")

    ctx.llamar = llamar
    monkeypatch.setattr(AN, "_ensayo_en_seco", seco)
    monkeypatch.setattr(X, "ejecutar", ejecutar)
    pista = ctx.pista("paso", "analisis", "Datos públicos", "Sandbox")
    run = asyncio.run(AN._correr_plan(ctx, plan, ds, ruta, "", None, "exploratorio", pista))
    pista.cerrar("Terminado")
    assert vistas == [("seco", run["id"]), ("real", run["id"])]
    assert [x["estado"] for x in _eventos(ctx, "analisis")] == ["ejecutando", "terminado"]
    assert all(x["sintetico"] is False for x in _eventos(ctx, "analisis"))
    assert len(ctx.e["ejecuciones"]) == 1 and run["ensayoSeco"]["sintetico"] is True


def test_reapertura_del_error_guardado_no_finge_otra_ejecucion_antes_de_reparar(ctx, tmp_path, monkeypatch):
    ruta = tmp_path / "datos.csv"
    ruta.write_text("x\n1\n", encoding="utf-8")
    plan = P.nuevo_plan_analisis(ctx.investigacion_id, None, "ds", 1000, hashDatos=X.hash_fichero(ruta))
    ds = {"nombre": "Datos de prueba", "procedencia": {"sintetico": True}}
    monkeypatch.setattr(X, "runtime_disponible", lambda _sintetico: ("docker", ""))
    monkeypatch.setattr(X, "comprobaciones_deterministas", lambda *args: [])
    monkeypatch.setattr(AN, "interpretacion_por_regla", lambda *args: None)
    ejecutadas = []
    reabierta = False

    def ejecutar(*args):
        ejecutadas.append(args[4])
        return X.Resultado("completado", "docker", no_evaluable="No aplicable") if reabierta else X.Resultado("error_tecnico", "docker", error="Fallo técnico recuperable")

    async def llamar(_rol, programa, **kwargs):
        if programa == "codigo":
            return SimpleNamespace(codigo="print('Prueba')")
        assert programa == "reparar"
        if not reabierta:
            raise PresupuestoAgotado("Pausa antes de reparar")
        ultima_pista = ctx.iteracion()["pistas"][-1]
        eventos = [x["eventoLab"] for x in ultima_pista["transcripcion"] if "eventoLab" in x]
        # Un resultado en disco puede volver a interpretarse o repararse; no
        # significa que se haya vuelto a correr el sandbox.
        assert [x["estado"] for x in eventos] == ["fallido", "programando"]
        assert len(ejecutadas) == 1
        return SimpleNamespace(codigo_corregido="print('Reparado')")

    ctx.llamar = llamar
    monkeypatch.setattr(X, "ejecutar", ejecutar)
    primera = ctx.pista("paso", "analisis", "Primera ejecución", "Sandbox")
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(AN._correr_plan(ctx, plan, ds, ruta, "", None, "exploratorio", primera))
    primera.cerrar("Presupuesto agotado", "detenida")
    run_id = ctx.e["ejecuciones"][0]["id"]
    assert ctx.e["ejecuciones"][0]["_resultadoSandbox"]["estado"] == "error_tecnico"
    ruta_bd = ctx.almacen.ruta
    ctx.almacen.cerrar()
    ctx.almacen = Almacen(ruta_bd)
    reabierta = True
    segunda = ctx.pista("paso", "analisis", "Retomar ejecución", "Sandbox")
    run = asyncio.run(AN._correr_plan(ctx, plan, ds, ruta, "", None, "exploratorio", segunda))
    segunda.cerrar("Retomada")
    assert ejecutadas == [run_id, run_id]
    assert run["id"] == run_id and len(ctx.e["ejecuciones"]) == 1
    assert [x["eventoLab"]["estado"] for x in ctx.iteracion()["pistas"][-1]["transcripcion"] if "eventoLab" in x] == ["fallido", "programando", "ejecutando", "terminado"]
