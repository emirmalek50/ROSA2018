"""Contrato de SerpApi, límites, identidad, cancelación y credenciales, sin red."""

import asyncio
import json
import logging
import re
from urllib.parse import unquote

import httpx
import pytest

from rosa.fuentes import base
from rosa.fuentes import google_patents as P

CLAVE_FICTICIA = "credencial-ficticia-solo-pruebas-001"


@pytest.fixture(autouse=True)
def sin_red(monkeypatch):
    async def prohibido(*args, **kwargs):
        raise AssertionError("Una prueba de Google Patents intentó acceder a la red")

    monkeypatch.setattr(P, "pedir", prohibido)
    monkeypatch.setattr(P, "_clave", lambda: CLAVE_FICTICIA)


def respuesta(cuerpo, estado=200):
    return httpx.Response(estado, request=httpx.Request("GET", P.BASE), json=cuerpo)


def publicacion(numero=12345678):
    return f"US{numero}B2"


def fila(numero=12345678, **extra):
    identificador = publicacion(numero)
    return {"publication_number": identificador, "patent_id": f"patent/{identificador}/en",
            "patent_link": f"https://patents.google.com/patent/{identificador}/en",
            "title": "Composición experimental", "snippet": "Resumen de una publicación de patente.", **extra}


def pagina(filas, total=None, siguiente=None, actual=0, **extra):
    cuerpo = {"search_metadata": {"id": "busqueda-1", "status": "Success"},
              "search_information": {"total_results": len(filas) if total is None else total, "page_number": actual},
              "organic_results": filas, **extra}
    if siguiente is not None:
        cuerpo["serpapi_pagination"] = {"current": actual, "next": siguiente}
    return cuerpo


def detalle(identificador=None, **extra):
    return {"search_metadata": {"id": "detalle-1", "status": "Success"}, "type": "patent",
            "publication_number": identificador or publicacion(), "title": "Composición", "abstract": "Resumen verificado en API.",
            "claims": ["1. A pharmaceutical composition with a specified compound."],
            "assignees": [{"name": "Titular de prueba"}], "family_id": "12345", "priority_date": "2020-01-01",
            "filing_date": "2021-01-01", "publication_date": "2022-01-01",
            "legal_events": [{"date": "2022-01-01", "title": "Granted"}], **extra}


def buscar(consultas=None):
    return asyncio.run(P.buscar(["Alzheimer"] if consultas is None else consultas))


def configurar(monkeypatch, busqueda=None, detalles=None):
    llamadas = []

    async def pedir(metodo, url, limitador, **kwargs):
        assert metodo == "GET" and url == P.BASE
        assert kwargs["follow_redirects"] is False and kwargs["intentos"] == 1
        parametros = kwargs["params"]
        assert parametros["api_key"] == CLAVE_FICTICIA
        llamadas.append(dict(parametros))
        if parametros["engine"] == "google_patents_details":
            identificador = parametros["patent_id"].split("/")[1]
            return respuesta(detalles(parametros) if detalles else detalle(identificador))
        return respuesta(busqueda(parametros) if busqueda else pagina([fila()]))

    monkeypatch.setattr(P, "pedir", pedir)
    return llamadas


def test_contrato_busqueda_detalle_y_procedencia(monkeypatch):
    llamadas = configurar(monkeypatch)
    r = buscar()
    assert len(llamadas) == 2 and "page" not in llamadas[0]
    assert llamadas[0]["num"] == 10 and llamadas[0]["scholar"] == "false"
    assert llamadas[0]["patents"] == "true" and llamadas[0]["dups"] == "language"
    assert r["googlePatents"]["estado"] == "completa"
    assert r["googlePatents"]["proveedor"] == "serpapi" and r["googlePatents"]["protocolo"] == 1
    assert r["consumo"]["serpapiConsultas"] == 2 and r["costeUsd"] == 0
    assert any("coste monetario" in x and "desconocido" in x for x in r["limitaciones"])
    assert all(c["fecha"] and len(c["sha256"]) == 64 and c["completa"] for c in r["consultas"])
    assert CLAVE_FICTICIA not in json.dumps(r) and "api_key" not in json.dumps(r)
    d = r["documentos"][0]
    assert d["id"] == "patente-US12345678B2" and d["fuente"] == P.FUENTE
    assert d["datos"]["reivindicacionesLeidas"] and d["datos"]["reivindicacionesCompletasEnTexto"]
    assert not d["datos"]["estadoJuridicoVerificado"] and d["datos"]["textoExterno"]
    assert d["texto"].startswith("Reivindicaciones:\n1. A pharmaceutical composition")
    assert "Titular de prueba" in d["texto"] and "2022-01-01" in d["texto"]


def test_sin_clave_no_consulta_red_y_registra_no_comprobado(monkeypatch):
    monkeypatch.setattr(P, "_clave", lambda: "")
    r = buscar()
    assert r["googlePatents"]["estado"] == "no_comprobado" and not r["documentos"]
    assert r["consumo"]["serpapiConsultas"] == 0
    assert r["consultas"][0]["error"].startswith("No comprobado")
    assert "clave" in r["consultas"][0]["error"]


@pytest.mark.parametrize("consultas", [[], [""], [None], ["a\nb"], ["a" * 2001], "Alzheimer"])
def test_consultas_invalidas_no_consultan_red(consultas):
    r = buscar(consultas)
    assert r["googlePatents"]["estado"] == "no_comprobado"
    assert r["consumo"]["serpapiConsultas"] == 0


def test_cero_resultados_verificados_no_significa_ausencia_mundial(monkeypatch):
    llamadas = configurar(monkeypatch, lambda p: pagina([]))
    r = buscar()
    assert len(llamadas) == 1 and not r["documentos"]
    assert r["googlePatents"]["estado"] == "completa"
    assert r["consultas"][0]["total"] == 0 and r["consultas"][0]["completa"]
    assert any("no acredita ausencia mundial" in x for x in r["limitaciones"])


def test_paginacion_reconstruye_endpoint_y_conserva_segunda_pagina(monkeypatch):
    def busqueda(p):
        if "page" not in p:
            return pagina([fila(12345678 + i) for i in range(10)], 11, "https://serpapi.com/search.json?engine=google_patents&page=1&q=Alzheimer&api_key=ajena")
        assert p["page"] == 1 and p["api_key"] == CLAVE_FICTICIA
        return pagina([fila(12345999)], 11, actual=1)

    llamadas = configurar(monkeypatch, busqueda)
    r = buscar()
    assert len(llamadas) == 10 and len(r["documentos"]) == 11
    assert r["documentos"][-1]["identificador"] == publicacion(12345999)
    assert r["googlePatents"]["estado"] == "parcial"  # Solo ocho detalles.
    assert r["consultas"][1]["completa"]
    assert all(x.get("api_key") == CLAVE_FICTICIA for x in llamadas)


def test_topes_consultas_paginas_detalles_son_visibles(monkeypatch):
    def busqueda(p):
        numero = int(p["q"]) * 100 + p.get("page", 0) * 10
        siguiente = f'https://serpapi.com/search.json?engine=google_patents&page={p.get("page", 0) + 1}&q={p["q"]}'
        return pagina([fila(12340000 + numero + i) for i in range(10)], 100, siguiente, actual=p.get("page", 0))

    llamadas = configurar(monkeypatch, busqueda)
    r = buscar(["0", "1", "2", "3", "4", "0"])
    assert len(llamadas) == 16 and len(r["documentos"]) == 80
    assert sum(p["engine"] == "google_patents_details" for p in llamadas) == 8
    assert r["consumo"]["serpapiConsultas"] == 16
    assert r["googlePatents"]["estado"] == "parcial"
    assert any("cuatro consultas" in x for x in r["limitaciones"])
    assert any("dos páginas" in x for x in r["limitaciones"])
    assert any("ocho publicaciones" in x for x in r["limitaciones"])


@pytest.mark.parametrize("siguiente", [
    "https://serpapi.com.evil.invalid/search.json?page=1", "https://serpapi.com:8080/search.json?page=1",
    "https://user:password@serpapi.com/search.json?page=1", "http://serpapi.com/search.json?page=1",
    "https://serpapi.com/otra-ruta?page=1", "https://serpapi.com/search.json?page=1&q=otra",
    "https://serpapi.com/search.json?page=1&engine=otro", "https://serpapi.com/search.json?page=1&page=2",
    "https://serpapi.com/search.json?page=0", "https://patents.google.com/xhr/query?page=1",
])
def test_paginacion_no_sigue_urls_arbitrarias(monkeypatch, siguiente):
    llamadas = configurar(monkeypatch, lambda p: pagina([fila()], 2, siguiente))
    r = buscar()
    assert len(llamadas) == 2  # Una búsqueda y un detalle, nunca otra URL.
    assert r["googlePatents"]["estado"] == "parcial"
    assert r["consultas"][0]["error"]


def test_pagina_repetida_se_rechaza(monkeypatch):
    llamadas = configurar(monkeypatch, lambda p: pagina([fila()], 2, "https://serpapi.com/search.json?page=1"))
    r = buscar()
    assert len(llamadas) == 3
    assert r["consultas"][1]["recuperados"] == 0
    assert r["consultas"][1]["error"] and r["googlePatents"]["estado"] == "parcial"


def test_identidades_exactas_dedup_entre_consultas_no_mezcla_familias(monkeypatch):
    llamadas = configurar(monkeypatch, lambda p: pagina([fila(), fila(12345679)]))
    r = buscar(["Alzheimer", "otra", "Alzheimer"])
    assert len(llamadas) == 4 and len(r["documentos"]) == 2
    assert r["googlePatents"]["estado"] == "completa"


@pytest.mark.parametrize("extra", [
    {"patent_id": "patent/US99999999B2/en"},
    {"patent_link": "https://patents.google.com/patent/US99999999B2/en"},
    {"patent_link": "https://patents.google.com.evil.invalid/patent/US12345678B2/en"},
    {"publication_number": "../../../secreto"}, {"publication_number": None},
])
def test_identidad_de_busqueda_contradictoria_o_invalida_se_omite(monkeypatch, extra):
    llamadas = configurar(monkeypatch, lambda p: pagina([fila(**extra)]))
    r = buscar()
    assert len(llamadas) == 1 and not r["documentos"]
    assert r["googlePatents"]["estado"] == "parcial"


@pytest.mark.parametrize("extra", [{"publication_number": "US99999999B2"}, {"type": "scholar"}, {"claims": [13]}])
def test_detalle_no_correspondiente_o_malformado_no_sustituye_resumen(monkeypatch, extra):
    configurar(monkeypatch, detalles=lambda p: detalle(**extra))
    r = buscar()
    d = r["documentos"][0]
    assert r["googlePatents"]["estado"] == "parcial"
    assert not d["datos"]["detalleComprobado"] and not d["datos"]["reivindicacionesLeidas"]
    assert d["datos"]["tipoTexto"] == "resumen" and "claims" not in d["datos"]
    assert r["consultas"][1]["error"]


def test_claims_integros_en_datos_y_truncado_visible(monkeypatch):
    claims = [f"{i}. " + "A substance with a specific binding property. " * 40 for i in range(1, 15)]
    claims[-1] += "LAST-CLAIM-CRITICAL-LIMITATION"
    configurar(monkeypatch, detalles=lambda p: detalle(claims=claims))
    r = buscar()
    d = r["documentos"][0]
    assert len(d["texto"]) == 12000 and d["texto"].startswith("Reivindicaciones")
    assert d["datos"]["textoTruncado"] and not d["datos"]["reivindicacionesCompletasEnTexto"]
    assert d["datos"]["claims"] == claims and d["datos"]["reivindicacionesRecuperadas"] == 14
    assert "LAST-CLAIM-CRITICAL-LIMITATION" in d["datos"]["claims"][-1]
    assert r["googlePatents"]["estado"] == "parcial"


def test_detalle_sin_claims_no_finge_lectura(monkeypatch):
    configurar(monkeypatch, detalles=lambda p: detalle(claims=[]))
    r = buscar()
    assert r["googlePatents"]["estado"] == "parcial"
    assert not r["documentos"][0]["datos"]["reivindicacionesLeidas"]


@pytest.mark.parametrize("cuerpo", [
    {"search_metadata": {"status": "Error"}, "error": CLAVE_FICTICIA},
    {"search_metadata": {"status": "Processing"}},
    {"organic_results": []}, {"search_metadata": {"status": "Success"}, "organic_results": "inválido"},
    "texto inválido", None,
])
def test_error_cuerpo_o_incompleto_no_acredita_ausencia(monkeypatch, cuerpo):
    async def pedir(*args, **kwargs):
        return respuesta(cuerpo)

    monkeypatch.setattr(P, "pedir", pedir)
    r = buscar()
    assert r["googlePatents"]["estado"] == "no_comprobado"
    assert not r["documentos"] and r["consultas"][0]["error"]
    assert CLAVE_FICTICIA not in json.dumps(r)


def test_excepcion_con_credencial_nunca_se_publica(monkeypatch):
    async def pedir(*args, **kwargs):
        raise base.FuenteNoDisponible(f"Falló https://serpapi.com/search.json?api_key={CLAVE_FICTICIA}")

    monkeypatch.setattr(P, "pedir", pedir)
    r = buscar()
    assert CLAVE_FICTICIA not in json.dumps(r)
    assert r["googlePatents"]["estado"] == "no_comprobado"


def test_respuesta_con_clave_reflejada_se_redacta_recursivamente(monkeypatch):
    configurar(monkeypatch, detalles=lambda p: detalle(claims=[f"1. External text: {CLAVE_FICTICIA}"],
              assignees=[{"name": CLAVE_FICTICIA, "serpapi_link": f"https://serpapi.com/search.json?api_key={CLAVE_FICTICIA}", "api_key": CLAVE_FICTICIA}]))
    r = buscar()
    assert CLAVE_FICTICIA not in json.dumps(r)
    assert "[CLAVE_OCULTA]" in r["documentos"][0]["texto"]


def test_httpx_info_no_expone_clave_ni_sigue_redireccion(monkeypatch, caplog):
    peticiones = []

    def transporte(request):
        peticiones.append(request)
        return httpx.Response(302, headers={"location": "https://otro-dominio.invalid"})

    async def ejecutar():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transporte), follow_redirects=True) as cliente:
            monkeypatch.setattr(base, "cliente", lambda: cliente)
            monkeypatch.setattr(P, "pedir", base.pedir)
            return await P.buscar(["Alzheimer"])

    with caplog.at_level(logging.INFO, logger="httpx"):
        r = asyncio.run(ejecutar())
    assert len(peticiones) == 1 and peticiones[0].url.params["api_key"] == CLAVE_FICTICIA
    assert "HTTP Request" in caplog.text and CLAVE_FICTICIA not in caplog.text
    # LiteLLM puede eliminar todo api_key=[CLAVE_OCULTA y dejar REDACTED].
    # Se verifica el secreto y cada parámetro que sobreviva, sin exigir que
    # otro filtro conserve el nombre del parámetro ni los corchetes.
    texto_log = unquote(caplog.text)
    assert CLAVE_FICTICIA not in texto_log
    marcadores = r"(?:[\[<]*(?:CLAVE_OCULTA|REDACTED|REDACTADO)[\]>]*)+"
    for valor in re.findall(r'api_key=([^&\s\"]+)', texto_log, re.IGNORECASE):
        assert re.fullmatch(marcadores, valor, re.IGNORECASE)
    assert r["googlePatents"]["estado"] == "no_comprobado"
    assert "HTTP 302" in r["consultas"][0]["error"]


def test_detalles_maximo_tres_concurrentes_entre_busquedas(monkeypatch):
    activos = 0
    maximo = 0

    async def pedir(*args, **kwargs):
        nonlocal activos, maximo
        p = kwargs["params"]
        if p["engine"] == "google_patents":
            return respuesta(pagina([fila(12345678 + i) for i in range(8)]))
        activos += 1
        maximo = max(maximo, activos)
        await asyncio.sleep(0.01)
        activos -= 1
        return respuesta(detalle(p["patent_id"].split("/")[1]))

    monkeypatch.setattr(P, "pedir", pedir)
    async def ejecutar():
        return await asyncio.gather(P.buscar(["Alzheimer"]), P.buscar(["otra hipótesis"]))

    resultados = asyncio.run(ejecutar())
    assert maximo == 3 and activos == 0 and all(r["consumo"]["serpapiConsultas"] == 9 for r in resultados)
    assert P._LIMITADOR.intervalo == pytest.approx(1 / 3)


def test_cancelacion_espera_detalles_y_no_deja_hijos(monkeypatch):
    activos = 0

    async def ejecutar():
        esperando = asyncio.Event()

        async def pedir(*args, **kwargs):
            nonlocal activos
            if kwargs["params"]["engine"] == "google_patents":
                return respuesta(pagina([fila(12345678 + i) for i in range(8)]))
            activos += 1
            if activos == 3:
                esperando.set()
            try:
                await asyncio.Event().wait()
            finally:
                activos -= 1

        monkeypatch.setattr(P, "pedir", pedir)
        tarea = asyncio.create_task(P.buscar(["Alzheimer"]))
        await asyncio.wait_for(esperando.wait(), timeout=1)
        tarea.cancel()
        with pytest.raises(asyncio.CancelledError):
            await tarea
        assert activos == 0
        assert len(asyncio.all_tasks()) == 1

    asyncio.run(ejecutar())


def test_prueba_conexion_unica_sin_detalles_y_credencial_explicita(monkeypatch):
    llamadas = configurar(monkeypatch, lambda p: pagina([fila()], 100, "https://serpapi.com/search.json?page=1"))
    monkeypatch.setattr(P, "_clave", lambda: "")
    r = asyncio.run(P.probar_conexion(credencial=CLAVE_FICTICIA))
    assert r["ok"] and len(llamadas) == 1 and llamadas[0]["q"] == "Alzheimer"
    assert not r["consulta"]["completa"]
    assert CLAVE_FICTICIA not in json.dumps(r)


def test_prueba_conexion_sin_clave_no_consulta_red(monkeypatch):
    monkeypatch.setattr(P, "_clave", lambda: "")
    r = asyncio.run(P.probar_conexion())
    assert not r["ok"] and r["consulta"]["error"]
