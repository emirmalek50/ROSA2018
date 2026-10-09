"""Búsquedas académicas: alcance, procedencia e identidades sin inventar evidencia."""

import asyncio
import json
import logging
from urllib.parse import urlencode, unquote
from unittest.mock import AsyncMock

import httpx
import pytest

from rosa.fuentes import academicas as A
from rosa.fuentes import base

CLAVE = "credencial-ficticia-academicas-pruebas"
URLS = {
    "embase": "https://www.embase.com/search/results?subaction=viewrecord&id=L1234567",
    "cochrane": "https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD012345.pub2/full",
    "scopus": "https://www.scopus.com/record/display.uri?eid=2-s2.0-12345",
    "web_of_science": "https://www.webofscience.com/wos/woscc/full-record/WOS:000012345",
    "lilacs": "https://pesquisa.bvsalud.org/portal/resource/es/biblio-12345",
    "scielo": "https://www.scielo.br/j/dn/a/ABC123/",
    "cinahl": "https://research.ebsco.com/c/test/viewer/html/ABC123",
    "psycinfo": "https://psycnet.apa.org/record/2024-12345-001",
    "google_scholar": "https://pubmed.ncbi.nlm.nih.gov/12345678/",
}


@pytest.fixture(autouse=True)
def sin_red(monkeypatch):
    async def prohibido(*args, **kwargs):
        raise AssertionError("Una prueba académica intentó acceder a la red")

    async def sin_directa(*args, **kwargs):
        return None

    monkeypatch.setattr(A, "pedir", prohibido)
    monkeypatch.setattr(A, "_directa", sin_directa)
    monkeypatch.setattr(A, "_clave", lambda: CLAVE)


def respuesta(cuerpo, estado=200):
    return httpx.Response(estado, request=httpx.Request("GET", A.BASE), json=cuerpo)


def fila(fuente="google_scholar", **extra):
    return {"title": "Investigación sobre Alzheimer", "link": URLS[fuente],
            "snippet": "Un fragmento acortado que no equivale al resumen del estudio.",
            "publication_info": {"summary": "P Pérez - Revista, 2024", "authors": [{"name": "P Pérez"}]}, **extra}


def cuerpo(filas, total=None, siguiente=None, **extra):
    resultado = {"search_metadata": {"id": "consulta-prueba", "status": "Success"},
                 "search_information": {"total_results": len(filas) if total is None else total},
                 "organic_results": filas, **extra}
    if siguiente is not None:
        resultado["serpapi_pagination"] = {"next": siguiente}
    return resultado


def configurar(monkeypatch, fuente="google_scholar", obtener=None):
    llamadas = []

    async def pedir(metodo, url, limitador, **kwargs):
        assert metodo == "GET" and url == A.BASE
        assert kwargs["follow_redirects"] is False and kwargs["intentos"] == 1
        assert kwargs["timeout"] == 45
        p = kwargs["params"]
        assert p["api_key"] == CLAVE
        kwargs["al_enviar"]()
        llamadas.append(p)
        return respuesta(obtener(p) if obtener else cuerpo([fila(fuente)]))

    monkeypatch.setattr(A, "pedir", pedir)
    return llamadas


def buscar(fuente="google_scholar", consulta="Alzheimer", maximo=10):
    return asyncio.run(A.buscar(fuente, consulta, maximo))


@pytest.mark.parametrize("fuente", list(URLS))
def test_nueve_fuentes_consultan_proveedor_y_declaran_modo(monkeypatch, fuente):
    llamadas = configurar(monkeypatch, fuente)
    r = buscar(fuente)
    assert len(llamadas) == 1 and len(r["articulos"]) == 1
    p = llamadas[0]
    scholar = fuente == "google_scholar"
    assert p["engine"] == ("google_scholar" if scholar else "google")
    assert r["modo"] == ("indice_scholar" if scholar else "descubrimiento_web")
    assert r["total"] is None and r["totalEstimadoBuscador"] == 1
    assert r["estado"] == ("completa" if scholar else "parcial")
    if scholar:
        assert p["q"] == "Alzheimer" and p["num"] == 10 and p["as_vis"] == "1"
    else:
        assert all("site:" + d in p["q"] for d in A.BASES[fuente]["dominios"])
        assert "num" not in p
        assert any("no es una consulta directa" in x for x in r["limitaciones"])
    assert r["consumo"]["serpapiConsultas"] == 1
    registro = r["consultas"][0]
    assert registro["fecha"] and len(registro["sha256"]) == 64 and registro["url"] == A.BASE
    assert CLAVE not in json.dumps(r) and "api_key" not in json.dumps(r)
    a = r["articulos"][0]
    assert a["resumen"] == "" and a["pistaDescubrimiento"]
    assert not a["metadatos"]["resumenCientificoLeido"]
    assert a["tipos"] == [] and a["anio"] is None  # No se adivina desde el snippet.
    assert a["_academica"]["indexacionEnBaseComprobada"] is scholar


def test_snippet_titulo_y_citaciones_no_fabrican_identificadores_ni_evidencia(monkeypatch):
    configurar(monkeypatch, obtener=lambda p: cuerpo([fila(
        link="https://example.com/paper/alzheimer", title="CD999999 positive randomized trial",
        snippet="PMID: 12345678 DOI: 10.1234/falso. Efecto demostrado.",
        inline_links={"cited_by": {"total": 999999}},
    )]))
    r = buscar()
    a = r["articulos"][0]
    assert a["doi"] is None and a["pmid"] is None and a["pmcid"] is None
    assert a["resumen"] == "" and a["tipos"] == []
    assert "inline_links" not in a["metadatos"] and "999999" not in json.dumps(a["metadatos"])


@pytest.mark.parametrize("extra,doi,pmid", [
    ({"link": "https://doi.org/10.1234/Article.A1"}, "10.1234/article.a1", None),
    ({"doi": "10.1234/EXACTO"}, "10.1234/exacto", "12345678"),
    ({"link": "https://www.nature.com/articles/abc123"}, None, None),
])
def test_identificadores_exactos_no_reconstruidos(monkeypatch, extra, doi, pmid):
    configurar(monkeypatch, obtener=lambda p: cuerpo([fila(**extra)]))
    a = buscar()["articulos"][0]
    assert a["doi"] == doi and a["pmid"] == pmid


@pytest.mark.parametrize("extra", [
    {"pmid": "87654321"}, {"pmid": "PMID:12345678"}, {"doi": "no-es-doi"},
    {"link": "https://doi.org/10.1234/uno", "doi": "10.1234/otro"},
])
def test_identificadores_contradictorios_se_omiten(monkeypatch, extra):
    configurar(monkeypatch, obtener=lambda p: cuerpo([fila(**extra)]))
    r = buscar()
    assert not r["articulos"] and r["estado"] == "parcial"


@pytest.mark.parametrize("url,coleccion", [
    (URLS["cochrane"], "CDSR"),
    ("https://www.cochranelibrary.com/central/doi/10.1002/central/CN-01234567/full", "CENTRAL"),
    ("https://www.cochranelibrary.com/cdsr/doi/10.1234/otro/full", "no_identificada"),
])
def test_cochrane_coleccion_por_identidad_no_por_titulo(monkeypatch, url, coleccion):
    configurar(monkeypatch, "cochrane", lambda p: cuerpo([fila("cochrane", link=url, title="CD999999 systematic review")]))
    a = buscar("cochrane")["articulos"][0]
    assert a["metadatos"]["coleccion"] == coleccion and a["tipos"] == []


@pytest.mark.parametrize("url", [
    "https://www.scielo.br.evil.com/j/dn/a/ABC/", "https://evil.com/scielo.br/j/dn/a/ABC/",
    "http://www.scielo.br/j/dn/a/ABC/", "https://user:password@www.scielo.br/j/dn/a/ABC/",
    "https://www.scielo.br:444/j/dn/a/ABC/", "https://www.scielo.br/j/dn/a/ABC/?api_key=secreto",
    "https://127.0.0.1/j/dn/a/ABC/", "javascript:alert(1)", "https://localhost/j/dn/a/ABC/",
])
def test_destino_inseguro_o_fuera_de_host_no_se_admite(monkeypatch, url):
    configurar(monkeypatch, "scielo", lambda p: cuerpo([fila("scielo", link=url)]))
    r = buscar("scielo")
    assert not r["articulos"] and r["estado"] == "parcial"


@pytest.mark.parametrize("fuente,url", [
    ("embase", "https://www.embase.com/"), ("cochrane", "https://www.cochranelibrary.com/about"),
    ("scopus", "https://www.scopus.com/products"), ("cinahl", "https://research.ebsco.com/pricing"),
    ("lilacs", "https://pesquisa.bvsalud.org/portal/"), ("scielo", "https://www.scielo.br/j/dn/"),
])
def test_paginas_de_producto_o_portal_no_son_articulos(monkeypatch, fuente, url):
    configurar(monkeypatch, fuente, lambda p: cuerpo([fila(fuente, link=url)]))
    r = buscar(fuente)
    assert not r["articulos"] and any("ficha documental" in x for x in r["limitaciones"])


def test_query_no_altera_params_ni_elude_validacion_host(monkeypatch):
    q = 'Alzheimer") OR site:evil.com &api_key=atacante&engine=otro'
    llamadas = configurar(monkeypatch, "scielo", lambda p: cuerpo([fila("scielo", link="https://evil.com/paper")]))
    r = buscar("scielo", q)
    assert llamadas[0]["engine"] == "google" and llamadas[0]["api_key"] == CLAVE
    assert q in llamadas[0]["q"] and "site:scielo.br" in llamadas[0]["q"]
    assert not r["articulos"]


@pytest.mark.parametrize("fuente,consulta,maximo", [("desconocida", "q", 10), ([], "q", 10), ("scielo", "q\ninyectado", 10), ("scielo", "q" * 2001, 10), ("scielo", "", 10), ("scielo", "q", 0), ("scielo", "q", True)])
def test_entrada_invalida_no_consulta_red(fuente, consulta, maximo):
    r = buscar(fuente, consulta, maximo)
    assert r["estado"] == "no_comprobado" and r["consumo"]["serpapiConsultas"] == 0


def test_sin_clave_no_consulta_red(monkeypatch):
    monkeypatch.setattr(A, "_clave", lambda: "")
    r = buscar()
    assert r["estado"] == "no_comprobado" and r["consumo"]["serpapiConsultas"] == 0
    assert r["consultas"][0]["error"]


def test_dos_paginas_acotadas_y_segunda_fila_critica(monkeypatch):
    def obtener(p):
        inicio = p["start"]
        siguiente = A.BASE + "?" + urlencode({"engine": p["engine"], "q": p["q"], "start": inicio + 10})
        filas = [fila(link=f"https://pubmed.ncbi.nlm.nih.gov/{12345000 + inicio + i}/") for i in range(10)]
        if inicio == 10:
            filas[-1]["title"] = "Hallazgo de la última fila"
        return cuerpo(filas, total=100, siguiente=siguiente)

    llamadas = configurar(monkeypatch, obtener=obtener)
    r = buscar(maximo=100)
    assert [p["start"] for p in llamadas] == [0, 10] and len(r["articulos"]) == 20
    assert r["articulos"][-1]["titulo"] == "Hallazgo de la última fila"
    assert r["estado"] == "parcial" and r["total"] is None
    assert any("páginas sin recuperar" in x for x in r["limitaciones"])
    assert any("veinte" in x for x in r["limitaciones"])


@pytest.mark.parametrize("siguiente", [
    "https://evil.com/search.json?start=10", "https://serpapi.com:444/search.json?start=10",
    "https://serpapi.com/search.json?start=0", "https://serpapi.com/search.json?start=20",
    "https://serpapi.com/search.json?start=10&q=otra", "https://serpapi.com/search.json?start=10&engine=otro",
])
def test_paginacion_no_sigue_urls_ni_cambia_query(monkeypatch, siguiente):
    llamadas = configurar(monkeypatch, obtener=lambda p: cuerpo([fila()], total=3, siguiente=siguiente))
    r = buscar(maximo=20)
    assert len(llamadas) == 1 and r["estado"] == "parcial" and r["consultas"][0]["error"]


def test_deduplica_por_doi_y_no_por_titulo(monkeypatch):
    configurar(monkeypatch, obtener=lambda p: cuerpo([
        fila(link="https://example.com/a", doi="10.1234/uno"),
        fila(link="https://example.com/b", doi="10.1234/uno"),
        fila(link="https://example.com/c", doi="10.1234/dos"),
    ]))
    r = buscar()
    assert len(r["articulos"]) == 2 and r["estado"] == "parcial"


def test_cero_web_no_confirma_ausencia_en_base(monkeypatch):
    configurar(monkeypatch, "embase", lambda p: cuerpo([]))
    r = buscar("embase")
    assert not r["articulos"] and r["estado"] == "parcial" and r["total"] is None
    assert any("no es una consulta directa" in x for x in r["limitaciones"])
    assert any("no acredita ausencia" in x for x in r["limitaciones"])


def vacio_documentado():
    return {"search_metadata": {"status": "Success"},
            "search_information": {"total_results": 0, "organic_results_state": "Fully empty"},
            "error": "Google hasn't returned any results for this query."}


@pytest.mark.parametrize("con_total", [True, False])
def test_vacio_documentado_serpapi_no_es_fallo_de_transporte_ni_ausencia_del_indice(monkeypatch, con_total):
    datos = vacio_documentado()
    if not con_total:
        datos["search_information"].pop("total_results")
    configurar(monkeypatch, "embase", lambda p: datos)
    r = buscar("embase")
    assert r["estado"] == "parcial" and r["articulos"] == [] and r["total"] is None
    assert r["totalEstimadoBuscador"] == (0 if con_total else None) and r["consumo"]["serpapiConsultas"] == 1
    assert r["consultas"][0]["paginas"] == 1 and r["consultas"][0]["error"] is None
    assert any("no acredita ausencia" in x for x in r["limitaciones"])


@pytest.mark.parametrize("cambio", [
    {"search_metadata": {"status": "Error"}},
    {"error": "Another error: " + CLAVE},
    {"search_information": {"total_results": 1, "organic_results_state": "Fully empty"}},
    {"search_information": {"total_results": False, "organic_results_state": "Fully empty"}},
    {"search_information": {"total_results": 0, "organic_results_state": "Unknown"}},
    {"search_information": {"total_results": None, "organic_results_state": "Fully empty"}},
    {"organic_results": [fila("embase")]},
    {"organic_results": None},
])
def test_error_parecido_a_vacio_o_con_campos_contradictorios_no_se_promueve(monkeypatch, cambio):
    configurar(monkeypatch, "embase", lambda p: {**vacio_documentado(), **cambio})
    r = buscar("embase")
    assert r["estado"] == "no_comprobado" and r["consultas"][0]["error"]
    assert r["total"] is None and not r["articulos"] and CLAVE not in json.dumps(r)


def test_error_de_google_scholar_no_se_interpreta_como_vacio_google_web(monkeypatch):
    configurar(monkeypatch, obtener=lambda p: vacio_documentado())
    assert buscar()["estado"] == "no_comprobado"


@pytest.mark.parametrize("datos", [None, [], {"search_metadata": {"status": "Processing"}},
    {"search_metadata": {"status": "Success"}, "error": CLAVE},
    {"search_metadata": {"status": "Success"}, "organic_results": "invalido"},
])
def test_error_api_no_confirma_cero_y_no_expone_clave(monkeypatch, datos):
    configurar(monkeypatch, obtener=lambda p: datos)
    r = buscar()
    assert r["estado"] == "no_comprobado" and r["consultas"][0]["error"]
    assert CLAVE not in json.dumps(r)


def test_metadatos_respuesta_de_otro_motor_consulta_pagina_se_rechazan(monkeypatch):
    configurar(monkeypatch, obtener=lambda p: cuerpo([fila()], search_parameters={"engine": "google", "q": "otra", "start": 9}))
    r = buscar()
    assert not r["articulos"] and r["estado"] == "no_comprobado"


def test_delegacion_directa_no_usa_serpapi_y_conserva_abstract(monkeypatch):
    directo = {"articulos": [{"titulo": "Estudio", "resumen": "Resumen de la API autorizada"}],
               "total": 1, "consultas": [{"modo": "api_directa"}], "estado": "completa", "limitaciones": [], "consumo": {"serpapiConsultas": 0}}

    async def directa(fuente, consulta, maximo):
        assert (fuente, consulta, maximo) == ("scopus", "Alzheimer", 10)
        return directo

    monkeypatch.setattr(A, "_directa", directa)
    r = buscar("scopus")
    assert r["articulos"][0]["resumen"] == directo["articulos"][0]["resumen"]
    assert r["articulos"][0]["_academica"]["resumenCientificoLeido"]
    assert r["modo"] == "api_directa" and r["estado"] == "completa"
    assert r["consumo"]["serpapiConsultas"] == 0


def test_fallo_directo_preservado_en_fallback(monkeypatch):
    async def directa(*args):
        return {"estado": "no_comprobado", "consultas": [{"fuente": "scopus", "error": "HTTP 403", "modo": "api_directa"}], "limitaciones": ["Acceso al índice denegado"], "consumo": {"elsevierConsultas": 1}}

    monkeypatch.setattr(A, "_directa", directa)
    configurar(monkeypatch, "scopus")
    r = buscar("scopus")
    assert r["estado"] == "parcial" and len(r["articulos"]) == 1
    assert r["consultas"][0]["error"] == "HTTP 403" and len(r["consultas"]) == 2
    assert r["consumo"] == {"elsevierConsultas": 1, "serpapiConsultas": 1}
    assert any("directo configurado" in x for x in r["limitaciones"])


def test_log_httpx_no_expone_clave_ni_sigue_redirect(monkeypatch, caplog):
    llamadas = []

    def transportar(request):
        llamadas.append(request)
        return httpx.Response(302, headers={"location": "https://evil.com"})

    async def ejecutar():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transportar), follow_redirects=True) as cliente:
            monkeypatch.setattr(base, "cliente", lambda: cliente)
            monkeypatch.setattr(A, "pedir", base.pedir)
            return await A.buscar("google_scholar", "Alzheimer")

    with caplog.at_level(logging.INFO, logger="httpx"):
        r = asyncio.run(ejecutar())
    assert len(llamadas) == 1 and llamadas[0].url.params["api_key"] == CLAVE
    assert "HTTP Request" in caplog.text and CLAVE not in unquote(caplog.text)
    assert r["estado"] == "no_comprobado" and "HTTP 302" in r["consultas"][0]["error"]


def test_concurrencia_maxima_tres_y_cancelacion(monkeypatch):
    activos = maximo = 0

    async def pedir(*args, **kwargs):
        nonlocal activos, maximo
        activos += 1
        maximo = max(activos, maximo)
        try:
            await asyncio.sleep(0.01)
            return respuesta(cuerpo([]))
        finally:
            activos -= 1

    monkeypatch.setattr(A, "pedir", pedir)

    async def ejecutar():
        return await asyncio.gather(*(A.buscar("google_scholar", f"consulta {i}") for i in range(9)))

    resultados = asyncio.run(ejecutar())
    assert maximo == 3 and activos == 0 and len(resultados) == 9


def test_cancelacion_no_se_convierte_en_resultado_vacio(monkeypatch):
    async def pedir(*args, **kwargs):
        raise asyncio.CancelledError

    monkeypatch.setattr(A, "pedir", pedir)
    with pytest.raises(asyncio.CancelledError):
        buscar()


def buscar_con_transporte(monkeypatch, respuestas):
    solicitudes = []
    espera = AsyncMock()
    monkeypatch.setattr(A.GP._LIMITADOR, "esperar", espera)

    def transporte(request):
        solicitudes.append(request)
        valor = respuestas[len(solicitudes) - 1]
        if isinstance(valor, Exception):
            raise valor
        if isinstance(valor, int):
            return httpx.Response(valor, text="CUERPO_PRIVADO " + CLAVE, headers={"retry-after": "60"})
        return httpx.Response(200, json=valor)

    async def ejecutar():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transporte)) as cliente:
            monkeypatch.setattr(base, "cliente", lambda: cliente)
            monkeypatch.setattr(A, "pedir", base.pedir)
            return await A.buscar("scopus", "Alzheimer")

    return asyncio.run(ejecutar()), solicitudes, espera


@pytest.mark.parametrize("fallo,codigo,http_status", [
    (httpx.ReadTimeout(CLAVE), "timeout", None),
    (httpx.ConnectError(CLAVE), "red", None),
    (502, "http", 502), (503, "http", 503), (504, "http", 504),
])
def test_un_reintento_trazable_mismos_parametros_sin_filtrar_secretos(monkeypatch, caplog, fallo, codigo, http_status):
    with caplog.at_level(logging.INFO, logger="httpx"):
        r, solicitudes, espera = buscar_con_transporte(monkeypatch, [fallo, cuerpo([fila("scopus")])])
    assert len(solicitudes) == espera.await_count == 2
    assert solicitudes[0].url == solicitudes[1].url
    assert r["estado"] == "parcial" and len(r["articulos"]) == 1
    assert r["consumo"]["serpapiConsultas"] == 2
    a, b = r["consultas"]
    assert (a["intento"], b["intento"]) == (1, 2)
    assert a["codigoError"] == codigo and a["httpStatus"] == http_status and a["error"]
    assert b["codigoError"] is None and b["httpStatus"] == 200 and b["error"] is None
    assert a["parametros"] == b["parametros"] and a["fecha"] and b["fecha"]
    assert all(isinstance(q["duracionMs"], int) and q["duracionMs"] >= 0 for q in (a, b))
    assert a["paginas"] == 0 and b["paginas"] == 1 and b["sha256"]
    assert CLAVE not in unquote(json.dumps(r) + caplog.text)
    assert "CUERPO_PRIVADO" not in json.dumps(r)


@pytest.mark.parametrize("estado", [401, 403, 404, 429, 500, 501])
def test_errores_no_transitorios_no_reintentan_ni_esperan_retry_after(monkeypatch, estado):
    r, solicitudes, espera = buscar_con_transporte(monkeypatch, [estado])
    assert len(solicitudes) == espera.await_count == r["consumo"]["serpapiConsultas"] == 1
    assert r["estado"] == "no_comprobado" and r["total"] is None
    q = r["consultas"][0]
    assert q["codigoError"] == "http" and q["httpStatus"] == estado and f"HTTP {estado}" in q["error"]
    assert CLAVE not in json.dumps(r) and "CUERPO_PRIVADO" not in json.dumps(r)


@pytest.mark.parametrize("fallo", [httpx.ReadTimeout(CLAVE), httpx.ConnectError(CLAVE), 503])
def test_dos_fallos_no_disparan_tercer_intento(monkeypatch, fallo):
    r, solicitudes, _ = buscar_con_transporte(monkeypatch, [fallo, fallo])
    assert len(solicitudes) == len(r["consultas"]) == r["consumo"]["serpapiConsultas"] == 2
    assert r["estado"] == "no_comprobado" and all(q["error"] for q in r["consultas"])
    assert r["total"] is None and not r["articulos"]
    assert r["limitaciones"][0] == r["consultas"][-1]["error"]


def test_formato_invalido_no_reintenta_y_guarda_status_y_duracion(monkeypatch):
    r, solicitudes, _ = buscar_con_transporte(monkeypatch, [{"error": CLAVE}])
    assert len(solicitudes) == 1 and r["estado"] == "no_comprobado"
    assert r["consultas"][0]["codigoError"] == "respuesta_invalida"
    assert r["consultas"][0]["httpStatus"] == 200


def test_tope_por_intento_y_cancelacion_limpian_tareas(monkeypatch):
    monkeypatch.setattr(A, "TIEMPO_INTENTO", 0.01)
    iniciadas = canceladas = 0

    async def sin_respuesta(*args, **kwargs):
        nonlocal iniciadas, canceladas
        kwargs["al_enviar"]()
        iniciadas += 1
        try:
            await asyncio.Event().wait()
        finally:
            canceladas += 1

    monkeypatch.setattr(A, "pedir", sin_respuesta)
    r = buscar("scopus")
    assert iniciadas == canceladas == r["consumo"]["serpapiConsultas"] == 2
    assert r["estado"] == "no_comprobado"
    assert [q["codigoError"] for q in r["consultas"]] == ["timeout", "timeout"]


def test_cancelacion_en_segundo_intento_se_propaga_sin_tercero(monkeypatch):
    llamadas = 0

    async def pedir(*args, **kwargs):
        nonlocal llamadas
        llamadas += 1
        if llamadas == 1:
            raise base.FuenteNoDisponible("Texto no público " + CLAVE, causa="timeout")
        raise asyncio.CancelledError

    monkeypatch.setattr(A, "pedir", pedir)
    with pytest.raises(asyncio.CancelledError):
        buscar("scopus")
    assert llamadas == 2


@pytest.mark.parametrize("bloqueo", ["tasa", "semaforo"])
def test_timeout_antes_del_envio_no_cuenta_consumo(monkeypatch, bloqueo):
    monkeypatch.setattr(A, "TIEMPO_INTENTO", 0.01)
    nunca = AsyncMock(side_effect=AssertionError("No debe iniciarse HTTP mientras espera"))
    cliente = type("ClienteSimulado", (), {"request": nunca})()
    monkeypatch.setattr(base, "cliente", lambda: cliente)
    monkeypatch.setattr(A, "pedir", base.pedir)

    async def esperar():
        await asyncio.Event().wait()

    async def ejecutar():
        if bloqueo == "tasa":
            monkeypatch.setattr(A.GP._LIMITADOR, "esperar", esperar)
        else:
            monkeypatch.setitem(A.GP._SEMAFOROS, asyncio.get_running_loop(), asyncio.Semaphore(0))
        return await A.buscar("scopus", "Alzheimer")

    r = asyncio.run(ejecutar())
    assert r["consumo"]["serpapiConsultas"] == 0 and len(r["consultas"]) == 2
    assert all(q["codigoError"] == "timeout" and q["peticionEnviada"] is False for q in r["consultas"])
    assert r["consultas"][-1]["error"] == r["limitaciones"][0]
    nunca.assert_not_called()
