"""Nueve fuentes, checkpoints y frontera entre descubrimiento y evidencia."""

import asyncio
import copy
import json
import socket
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from rosa import config, herramientas
from rosa.bucle import pasos as B
from rosa.conectores import base as CB
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.fuentes import academicas
from rosa.modulos.contador import PresupuestoAgotado
from rosa.modulos.firmas import Consulta


def respuesta(articulos=None, *, estado="parcial", total=None, consumo=1):
    return {"articulos": articulos or [], "total": total,
            "consultas": [{"fuente": "Fuente simulada", "consulta": "Alzheimer TREM2", "fecha": "2026-10-08T12:00:00Z", "modo": "descubrimiento_web", "total": total}],
            "estado": estado, "limitaciones": ["Acceso web de respaldo, no índice privado."], "consumo": {"serpapiConsultas": consumo}}


def articulo(doi="10.1234/trem2", *, resumen="", fuente="embase", pmid=None):
    return {"titulo": "TREM2 and microglial response in Alzheimer disease", "referencia": "Autora, 2026", "autores": ["Autora"],
            "anio": 2026, "tipos": [], "doi": doi, "pmid": pmid, "pmcid": None, "resumen": resumen,
            "url": "https://doi.org/10.1234/trem2", "pistaDescubrimiento": "SNIPPET_NO_EVIDENCIA",
            "_academica": {"fuente": fuente, "modo": "descubrimiento_web", "resumenCientificoLeido": False}}


@pytest.fixture(autouse=True)
def aislado(tmp_path, monkeypatch):
    monkeypatch.setenv("ROSA_BD", str(tmp_path / "aislada.db"))
    monkeypatch.setattr(config, "RUTA_BD", tmp_path / "aislada.db")
    monkeypatch.setattr(config, "CLAVE_SERPAPI", "")
    monkeypatch.setattr(config, "CLAVE_EXA", "")
    monkeypatch.setattr(config, "CONVEX_URL", "")
    monkeypatch.setattr(CB, "PERMISOS", {})
    monkeypatch.setattr(B.reranker, "disponible", lambda: False)
    monkeypatch.setattr(B.Ctx, "llamar", AsyncMock(side_effect=AssertionError("Modelo real prohibido en esta prueba")))
    monkeypatch.setattr(academicas, "buscar", AsyncMock(return_value=respuesta(estado="no_comprobado", consumo=0)))

    def sin_red(*args, **kwargs):
        raise AssertionError("HTTP real prohibido en esta prueba")

    monkeypatch.setattr(socket.socket, "connect", sin_red)
    monkeypatch.setattr(socket, "create_connection", sin_red)
    originales = {k: (v.usos, v.errores, v.ultimo_uso) for k, v in CB.REGISTRO.items()}
    yield
    for k, valores in originales.items():
        CB.REGISTRO[k].usos, CB.REGISTRO[k].errores, CB.REGISTRO[k].ultimo_uso = valores


@pytest.fixture
def ctx(tmp_path):
    al = Almacen(tmp_path / "activa.db")

    def iniciar(e):
        e["investigaciones"].append({"id": "inv", "titulo": "Microglía", "objetivo": "TREM2 y microglía en Alzheimer", "limites": [],
            "condicionParada": "1 iteración", "configuracion": {"amplitud": "enfocada", "preferencias": "", "atributos": [], "restricciones": []}, "vivero": []})
        c = P.nueva_corrida("inv", 1, 1)
        c.update(id="cor", estado="en_marcha")
        e["corridas"].append(c)
        it = P.nueva_iteracion("cor", 1, 1, [P.nuevo_paso("Microglía", "Biomarcadores TREM2\nAlzheimer", 20)], 40)
        it["id"] = "it"
        e["iteraciones"].append(it)
        return True

    al.mutar(iniciar, "prueba")
    contexto = B.Ctx(al, SimpleNamespace(consultas="consultas", relevancia="relevancia"), None, "cor", "inv", "it", 1, de_paso=True)
    try:
        yield contexto
    finally:
        al.cerrar()


def paso(ctx):
    return ctx.iteracion()["plan"][0]


def test_nueve_bases_en_firma_catalogo_y_herramientas_del_asistente(ctx):
    for base in B.FUENTES_ACADEMICAS:
        assert Consulta(base=base, consulta="TREM2 Alzheimer", tema="Microglía").base == base
        assert B.base_efectiva({"base": base})["base"] == base
        conector = CB.REGISTRO[f"academica_{base}"]
        assert conector.estado == "disponible" and conector.clave == "si"
        assert "índice privado" in conector.descripcion and "snippets" in conector.descripcion
    nombres = [f"academica_{base}" for base in B.FUENTES_ACADEMICAS]
    tools = herramientas.herramientas(ctx.e, "inv", [], solo=nombres)
    assert set(nombres).issubset({t.name for t in tools})


def test_conector_conserva_fallo_y_total_desconocido_sin_cero_inventado():
    registro, datos = asyncio.run(B.CON.consultar("academica_embase", consulta="Alzheimer", maximo="10", origen="persona"))
    assert registro["n"] is None
    assert registro["invariante"]["ok"] is False
    assert datos["total"] is None and datos["estado"] == "no_comprobado"
    academicas.buscar.assert_awaited_once_with("embase", "Alzheimer", maximo=10)


def test_tanda_nueve_una_vez_por_iteracion_sin_modelos_y_coste_separado(ctx, monkeypatch):
    llamadas = []
    simultaneas = [0, 0]

    async def buscar(base, consulta, maximo):
        simultaneas[0] += 1
        simultaneas[1] = max(simultaneas)
        await asyncio.sleep(0)
        simultaneas[0] -= 1
        llamadas.append((base, consulta, maximo))
        return respuesta()

    monkeypatch.setattr(academicas, "buscar", buscar)
    primeras = asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    segundas = asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    assert len(primeras) == len(segundas) == 9
    assert {b for b, _, _ in llamadas} == set(B.FUENTES_ACADEMICAS) and len(llamadas) == 9
    assert all("TREM2" in q and "\n" not in q and maximo == 10 for _, q, maximo in llamadas)
    assert simultaneas[1] <= 3
    c = ctx.corrida()
    assert c["gasto"]["serpapiConsultas"] == 9 and c["gasto"]["serpapiUsd"] is None
    assert c["gasto"]["llamadas"] == 0
    registros = c["busqueda"]["consultas"]
    assert len(registros) == 9 and all(q["resultados"] is None for q in registros)
    assert all(q["consultasFuente"][0]["fecha"] and q["estado"] == "parcial" for q in registros)
    assert all("índice privado" in q["alcance"] for q in registros)
    assert "_literaturaAcademica" not in json.dumps(ctx.almacen.instantanea())
    ctx.numero = 2
    asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    assert len(llamadas) == 18


def test_dos_pasos_concurrentes_no_duplican_la_tanda(ctx):
    async def ejecutar():
        return await asyncio.gather(B._preparar_tanda_academica(ctx, paso(ctx)), B._preparar_tanda_academica(ctx, paso(ctx)))

    asyncio.run(ejecutar())
    assert academicas.buscar.await_count == 9


def test_consulta_automatica_es_breve_cientifica_y_no_un_parrafo_de_instrucciones(ctx):
    p = {"titulo": "Biomarcadores", "detalle": "Buscar evidencia sobre TREM2 y microglía en Alzheimer. Comparar los resultados de las fuentes y recuperar las referencias para estudiar la relación."}
    consulta = B._consulta_academica_del_paso(ctx, p)
    assert "TREM2" in consulta and "Alzheimer" in consulta and "microglía" in consulta
    assert len(consulta.split()) <= 6 and len(consulta) <= 180
    assert not any(verbo in consulta.lower().split() for verbo in ("buscar", "comparar", "recuperar", "estudiar"))


@pytest.mark.parametrize("permiso", ["bloquear", "solo_persona"])
def test_permiso_del_conector_se_respeta_en_corrida(ctx, monkeypatch, permiso):
    monkeypatch.setitem(CB.PERMISOS, "academica_embase", permiso)
    asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    assert academicas.buscar.await_count == 8
    assert "embase" not in {llamada.args[0] for llamada in academicas.buscar.await_args_list}
    registro = next(q for q in ctx.corrida()["busqueda"]["consultas"] if q["fuenteId"] == "embase")
    assert registro["estado"] == "no_comprobado" and registro["resultados"] is None
    assert "sin permiso" in registro["error"]


def test_dedup_doi_y_pmid_conserva_todas_las_procedencias(ctx, monkeypatch):
    async def buscar(base, consulta, maximo):
        a = articulo(fuente=base)
        if base == "cochrane":
            a["doi"] = "https://doi.org/10.1234/TREM2"
        return respuesta([a])

    monkeypatch.setattr(academicas, "buscar", buscar)
    consultas = asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    candidatos = [a for q in consultas for a in q["_articulosAcademicos"]]
    assert len(candidatos) == 1
    procedencias = candidatos[0]["_academica"]["descubrimientos"]
    assert {p["fuente"] for p in procedencias} == set(B.FUENTES_ACADEMICAS)
    primero = B._registrar_fuente(ctx, candidatos[0], "articulo", [], 7, None, "No comprobado", None)
    otro = articulo(doi=None, pmid="12345", fuente="scielo")
    otro["titulo"] = "Another title for the same PMID, independently returned"
    otro["doi"] = "10.1234/trem2"
    segundo = B._registrar_fuente(ctx, otro, "articulo", [], 7, None, "No comprobado", None)
    assert primero == segundo and len(ctx.fuentes()) == 1
    assert ctx.fuentes()[primero]["pmid"] == "12345"
    assert {p["fuente"] for p in ctx.fuentes()[primero]["_academica"]["descubrimientos"]} == set(B.FUENTES_ACADEMICAS)


def test_snippet_sin_identificador_no_se_puntua_ni_entra_en_evidencia(ctx, monkeypatch):
    a = articulo(doi=None)
    monkeypatch.setattr(academicas, "buscar", AsyncMock(return_value=respuesta([a])))
    q = {"base": "embase", "consulta": "Alzheimer", "tema": "Microglía"}
    r = asyncio.run(B._consulta_literatura(ctx, paso(ctx), q, "TREM2 Alzheimer"))
    assert r["identificados"] == 1 and r["cribados"] == 0 and r["leidos"] == 0
    B.Ctx.llamar.assert_not_called()
    assert not ctx.fuentes() and not ctx.afirmaciones()
    registro = ctx.corrida()["busqueda"]["consultas"][0]
    assert registro["resultados"] is None and registro["pendientesLectura"] == 1
    assert registro["lecturaEstado"] == "pendiente_texto"


def test_resuelve_doi_antes_del_cribado_y_solo_guarda_resumen_original(ctx, monkeypatch):
    a = articulo()
    monkeypatch.setattr(academicas, "buscar", AsyncMock(return_value=respuesta([a])))
    real = articulo(resumen="RESUMEN_ORIGINAL_VERIFICABLE")
    real.pop("_academica")
    resolver = AsyncMock(return_value=([real], 1))
    monkeypatch.setattr(B.europepmc, "buscar", resolver)
    monkeypatch.setattr(B, "_comprobar_retraccion", AsyncMock(return_value=(None, "Comprobación simulada", 1)))

    async def llamar(rol, programa, **kw):
        assert resolver.await_count == 1
        assert "RESUMEN_ORIGINAL_VERIFICABLE" in kw["resumen"] and "SNIPPET_NO_EVIDENCIA" not in kw["resumen"]
        return SimpleNamespace(puntuacion=6, motivo="Pertinente")

    monkeypatch.setattr(ctx, "llamar", llamar)
    r = asyncio.run(B._consulta_literatura(ctx, paso(ctx), {"base": "embase", "consulta": "Alzheimer", "tema": "Microglía"}, "TREM2"))
    assert r["cribados"] == r["leidos"] == 1
    fuente = next(iter(ctx.fuentes().values()))
    assert fuente["fragmentos"][0]["texto"] == "RESUMEN_ORIGINAL_VERIFICABLE"
    assert "SNIPPET_NO_EVIDENCIA" not in json.dumps(fuente["fragmentos"])
    assert fuente["_academica"]["resolucionTexto"]["doi"] == "10.1234/trem2"


def test_resolver_no_acepta_resumen_de_otro_doi_y_usa_lectura_real(ctx, monkeypatch):
    a = articulo()
    monkeypatch.setattr(B.europepmc, "buscar", AsyncMock(return_value=([articulo(doi="10.1234/otro", resumen="ABSTRACT_EQUIVOCADO")], 1)))
    fragmentos = [{"localizador": "pág. 2", "texto": "TEXTO_DOCUMENTO_ORIGINAL", "encabezado": "Resultados"}]
    lectura = AsyncMock(return_value=fragmentos)
    monkeypatch.setattr(B, "_fragmentos_de", lectura)
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Resolver", "Embase")
    datos, pendientes = asyncio.run(B._resolver_descubrimientos_academicos(ctx, [a], pista))
    assert pendientes == 0 and datos[0]["resumen"] == ""
    assert "TEXTO_DOCUMENTO_ORIGINAL" in datos[0]["_textoCribado"]
    assert "ABSTRACT_EQUIVOCADO" not in json.dumps(datos)
    assert datos[0]["_fragmentosAcademicos"] == fragmentos


def test_resolver_pmid_y_dedup_con_fuente_ya_leida_evitan_snippet_y_relectura(ctx, monkeypatch):
    a = articulo(doi=None, pmid="12345")
    real = articulo(doi=None, pmid="12345", resumen="RESUMEN_PUBMED")
    detalles = AsyncMock(return_value=[real])
    monkeypatch.setattr(B.pubmed, "detalles", detalles)
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Resolver", "Embase")
    datos, pendientes = asyncio.run(B._resolver_descubrimientos_academicos(ctx, [a], pista))
    assert pendientes == 0 and datos[0]["resumen"] == "RESUMEN_PUBMED"
    detalles.assert_awaited_once_with(["12345"])
    B._registrar_fuente(ctx, datos[0], "articulo", [{"localizador": "resumen", "texto": "RESUMEN_PUBMED"}], 7, None, "", None)
    asyncio.run(B._resolver_descubrimientos_academicos(ctx, [articulo(doi=None, pmid="12345")], pista))
    assert detalles.await_count == 1


@pytest.mark.parametrize("parcial", [False, True])
def test_documento_solo_url_se_lee_antes_de_puntuar_con_procedencia_y_sin_snippet(ctx, monkeypatch, parcial):
    a = articulo(doi=None, fuente="scielo")
    monkeypatch.setattr(academicas, "buscar", AsyncMock(return_value=respuesta([a])))
    lector = CB.REGISTRO["leer_pagina_web"]
    texto_original = "Abstract. TREM2 and microglial response in Alzheimer disease. Methods: We studied microglial activation in an experimental cohort. Results: TEXTO_ORIGINAL_DE_SCIELO. The measured association requires independent replication and does not establish therapeutic efficacy."
    lectura = AsyncMock(return_value=CB.Resultado({"texto": texto_original, "url": a["url"], "titulo": a["titulo"], "desde": 0, "siguienteDesde": 5000 if parcial else None, "costeUsd": 0.001}, 1))
    monkeypatch.setattr(lector, "estado", "disponible")
    monkeypatch.setattr(lector, "fn", lectura)

    async def llamar(rol, programa, **kw):
        assert lectura.await_count == 1
        assert "TEXTO_ORIGINAL_DE_SCIELO" in kw["resumen"] and "SNIPPET_NO_EVIDENCIA" not in kw["resumen"]
        return SimpleNamespace(puntuacion=6, motivo="Pertinente")

    monkeypatch.setattr(ctx, "llamar", llamar)
    r = asyncio.run(B._consulta_literatura(ctx, paso(ctx), {"base": "scielo", "consulta": "Alzheimer", "tema": "Microglía"}, "TREM2"))
    assert r["cribados"] == r["leidos"] == 1
    assert r["textoCompleto"] == int(not parcial)
    f = next(iter(ctx.fuentes().values()))
    assert f["fragmentos"][0]["texto"] == texto_original
    assert f["fragmentos"][0]["_url"] == a["url"]
    assert f["_academica"]["lecturaOriginal"]["herramienta"] == "leer_pagina_web"
    assert f["textoCompleto"] is (not parcial)
    assert f["_academica"]["coberturaLectura"]["parcial"] is parcial
    if parcial:
        assert "solo leídos en parte" in ctx.corrida()["busqueda"]["consultas"][0]["limitacionesLectura"][0]
    assert ctx.corrida()["gasto"]["exaUsd"] == 0.001


def test_lector_url_respeta_permiso_y_rechaza_url_local(ctx, monkeypatch):
    lector = CB.REGISTRO["leer_pagina_web"]
    lectura = AsyncMock()
    monkeypatch.setattr(lector, "estado", "disponible")
    monkeypatch.setattr(lector, "fn", lectura)
    monkeypatch.setitem(CB.PERMISOS, "leer_pagina_web", "solo_persona")
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Resolver URL", "SciELO")
    assert asyncio.run(B._leer_url_academica(ctx, articulo(doi=None), pista)) == []
    local = articulo(doi=None)
    local["url"] = "http://127.0.0.1:8765/api/estado"
    assert asyncio.run(B._leer_url_academica(ctx, local, pista)) == []
    lectura.assert_not_called()


def test_reranker_recibe_texto_original_y_conserva_procedencia(ctx, monkeypatch):
    a = articulo(doi=None)
    a["_textoCribado"] = "TEXTO_LEIDO_NO_SNIPPET"
    monkeypatch.setattr(B.reranker, "disponible", lambda: True)
    reranker = AsyncMock(return_value=[(0, 0.9)])
    monkeypatch.setattr(B.reranker, "reordenar", reranker)
    dentro, fuera = asyncio.run(B.cortar_con_reranker("TREM2", [a], None, maximo=0))
    assert not dentro and fuera[0][0] is a
    assert "TEXTO_LEIDO_NO_SNIPPET" in reranker.await_args.args[1][0]
    assert "SNIPPET_NO_EVIDENCIA" not in reranker.await_args.args[1][0]
    assert fuera[0][0]["_academica"]["fuente"] == "embase"


def test_presupuesto_de_planificacion_no_pierde_tanda_y_reanuda_sin_repetir_api(ctx, monkeypatch):
    monkeypatch.setattr(B.LEC, "para", AsyncMock(return_value="Sin lecciones"))
    monkeypatch.setattr(ctx, "llamar", AsyncMock(side_effect=PresupuestoAgotado("Simulado")))
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(B.paso_literatura(ctx, paso(ctx)))
    assert academicas.buscar.await_count == 9
    assert len(ctx.corrida()["busqueda"]["consultas"]) == 9
    monkeypatch.setattr(ctx, "llamar", AsyncMock(return_value=SimpleNamespace(consultas=[])))
    asyncio.run(B.paso_literatura(ctx, paso(ctx)))
    assert academicas.buscar.await_count == 9
    assert all(x["procesada"] for x in ctx.corrida()["_literaturaAcademica"]["1"].values())


def test_legacy_se_criba_primero_y_nueve_no_se_multiplican_por_consulta(ctx, monkeypatch):
    monkeypatch.setattr(B.LEC, "para", AsyncMock(return_value="Sin lecciones"))
    pred = SimpleNamespace(consultas=[Consulta(base="pubmed", consulta="TREM2", tema="Microglía"), Consulta(base="europepmc", consulta="microglia", tema="Células"), Consulta(base="scopus", consulta="otra consulta", tema="No duplicar")])
    monkeypatch.setattr(ctx, "llamar", AsyncMock(return_value=pred))
    vistas = []

    async def procesar(ctx_, paso_, q, preguntas):
        vistas.append(q["base"])
        return {"identificados": 0, "cribados": 0, "textoCompleto": 0, "leidos": 0}

    monkeypatch.setattr(B, "_consulta_literatura", procesar)
    asyncio.run(B.paso_literatura(ctx, paso(ctx)))
    assert vistas[:2] == ["pubmed", "europepmc"]
    assert vistas[2:] == list(B.FUENTES_ACADEMICAS)
    assert academicas.buscar.await_count == 9


def test_presupuesto_legacy_corta_antes_de_cribar_academicas_con_tanda_guardada(ctx, monkeypatch):
    monkeypatch.setattr(B.LEC, "para", AsyncMock(return_value="Sin lecciones"))
    monkeypatch.setattr(ctx, "llamar", AsyncMock(return_value=SimpleNamespace(consultas=[Consulta(base="pubmed", consulta="TREM2", tema="Microglía")])))
    vistas = []

    async def procesar(ctx_, paso_, q, preguntas):
        vistas.append(q["base"])
        raise PresupuestoAgotado("Simulado durante cribado legacy")

    monkeypatch.setattr(B, "_consulta_literatura", procesar)
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(B.paso_literatura(ctx, paso(ctx)))
    assert vistas == ["pubmed"]
    assert academicas.buscar.await_count == 9
    assert not any(x["procesada"] for x in ctx.corrida()["_literaturaAcademica"]["1"].values())


@pytest.mark.parametrize("estado", ["pausada", "detenida", "pausada_por_presupuesto"])
def test_corrida_parada_no_hace_ni_una_peticion(ctx, estado):
    ctx.mutar(lambda e: e["corridas"][0].update(estado=estado) or True)
    with pytest.raises(B.CorridaParada):
        asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    academicas.buscar.assert_not_called()


def test_cancelar_tanda_cancela_proveedores_y_no_fabrica_checkpoint(ctx, monkeypatch):
    canceladas = []
    iniciadas = []

    async def buscar(base, consulta, maximo):
        iniciadas.append(base)
        try:
            await asyncio.Event().wait()
        finally:
            canceladas.append(base)

    monkeypatch.setattr(academicas, "buscar", buscar)

    async def ejecutar():
        tarea = asyncio.create_task(B._preparar_tanda_academica(ctx, paso(ctx)))
        for _ in range(20):
            await asyncio.sleep(0)
            if len(iniciadas) == 3:
                break
        tarea.cancel()
        with pytest.raises(asyncio.CancelledError):
            await tarea

    asyncio.run(ejecutar())
    assert set(canceladas) == set(iniciadas) and len(iniciadas) == 3
    assert not ctx.corrida().get("_literaturaAcademica")


def test_doi_contradictorio_no_se_funde_por_titulo_igual(ctx, monkeypatch):
    async def buscar(base, consulta, maximo):
        a = articulo(doi="10.1234/a" if base == "embase" else "10.1234/b", fuente=base)
        return respuesta([a])

    monkeypatch.setattr(academicas, "buscar", buscar)
    consultas = asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    candidatos = [a for q in consultas for a in q["_articulosAcademicos"]]
    assert {a["doi"] for a in candidatos} == {"10.1234/a", "10.1234/b"}
    ids = {B._registrar_fuente(ctx, a, "articulo", [], 6, None, "", None) for a in candidatos}
    assert len(ids) == 2 and len(ctx.fuentes()) == 2


def test_duplicado_con_resumen_real_completa_metadata_del_primero(ctx, monkeypatch):
    async def buscar(base, consulta, maximo):
        a = articulo(fuente=base)
        if base == "cochrane":
            a["resumen"] = "ACTUAL_ABSTRACT"
            a["_academica"].update(modo="api_directa", resumenCientificoLeido=True)
        return respuesta([a])

    monkeypatch.setattr(academicas, "buscar", buscar)
    consultas = asyncio.run(B._preparar_tanda_academica(ctx, paso(ctx)))
    candidatos = [a for q in consultas for a in q["_articulosAcademicos"]]
    assert len(candidatos) == 1 and candidatos[0]["resumen"] == "ACTUAL_ABSTRACT"
    assert candidatos[0]["_academica"]["resumenCientificoLeido"] is True


def test_resolver_pmid_coincidente_rechaza_doi_contradictorio(ctx, monkeypatch):
    a = articulo(doi="10.1234/a", pmid="123")
    monkeypatch.setattr(B.pubmed, "detalles", AsyncMock(return_value=[articulo(doi="10.1234/b", pmid="123", resumen="WRONG_DOI_ABSTRACT")]))
    monkeypatch.setattr(B, "_fragmentos_de", AsyncMock(return_value=[]))
    monkeypatch.setattr(B, "_leer_url_academica", AsyncMock(return_value=[]))
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Resolver", "Embase")
    datos, pendientes = asyncio.run(B._resolver_descubrimientos_academicos(ctx, [a], pista))
    assert datos == [] and pendientes == 1 and a["doi"] == "10.1234/a"
    assert "WRONG_DOI_ABSTRACT" not in json.dumps(a)


@pytest.mark.parametrize("url,texto", [
    ("https://example.org/unrelated", "Abstract. TREM2 and microglial response in Alzheimer disease. Results: " + "Different article content. " * 15),
    ("https://doi.org/10.1234/trem2", "SIGN IN. Institutional subscription required. Catalogue title, author and keywords only."),
])
def test_lectura_exa_ajena_o_login_no_se_promueve_a_evidencia(ctx, monkeypatch, url, texto):
    a = articulo()
    monkeypatch.setattr(B.europepmc, "buscar", AsyncMock(return_value=([], 0)))
    monkeypatch.setattr(B.unpaywall, "pdf_de", AsyncMock(return_value=None))
    monkeypatch.setattr(B.exa, "disponible", lambda: True)
    monkeypatch.setattr(B.exa, "contenidos", AsyncMock(return_value=([{"url": url, "titulo": a["titulo"], "texto": texto}], 0)))
    monkeypatch.setattr(B, "_leer_url_academica", AsyncMock(return_value=[]))
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Resolver", "Embase")
    datos, pendientes = asyncio.run(B._resolver_descubrimientos_academicos(ctx, [a], pista))
    assert datos == [] and pendientes == 1
    assert "_textoCribado" not in a and "_fragmentosAcademicos" not in a


def test_snippet_mal_colocado_en_resumen_se_descarta_por_su_procedencia(ctx, monkeypatch):
    a = articulo(doi=None, resumen="SNIPPET_MAL_COLOCADO")
    monkeypatch.setattr(academicas, "buscar", AsyncMock(return_value=respuesta([a])))
    pista = ctx.pista(paso(ctx)["id"], "literatura", "Recuperar", "Embase")
    datos = asyncio.run(B._recuperar_academica(ctx, "embase", "TREM2", "Microglía", pista))
    assert datos["articulos"][0]["resumen"] == ""


def test_ficha_larga_sin_abstract_no_se_confunde_con_articulo_leido():
    a = articulo()
    texto = a["titulo"] + "\nAbstract: No abstract available.\nAuthors: Pérez. Journal: Science. DOI: 10.1234/trem2. Publication type: article. Subject terms: " + "Alzheimer tau microglia cognition. " * 8
    assert not B._lectura_web_academica_valida(a, a["url"], {"url": a["url"], "titulo": a["titulo"], "texto": texto})
