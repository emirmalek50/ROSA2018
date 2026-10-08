"""Contratos institucionales con transporte simulado, sin claves ni red reales."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging

import httpx
import pytest

from rosa.fuentes import academicas_licenciadas as A

CFG = {"elsevier_api_key": "clave_elsevier_ficticia_123", "elsevier_insttoken": "token_elsevier_ficticio_123",
       "wos_api_key": "clave_wos_ficticia_123", "ebsco_user": "usuario_eds_ficticio", "ebsco_password": "clave_eds_ficticia",
       "ebsco_profile": "perfil_eds_ficticio", "cinahl_db": "ccm", "psycinfo_db": "psyh"}


@pytest.fixture(autouse=True)
def sin_red_ni_secretos(monkeypatch):
    monkeypatch.setattr(A.credenciales_academicas, "leer", lambda: CFG.copy())

    async def no_esperar(self):
        return None

    from rosa.fuentes.base import Limitador
    monkeypatch.setattr(Limitador, "esperar", no_esperar)

    async def prohibido(*args, **kwargs):
        raise AssertionError("La prueba intentó acceder a la red real.")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", prohibido)


def transporte(monkeypatch, handler):
    llamadas = []

    def responder(request):
        llamadas.append(request)
        return handler(request)

    monkeypatch.setattr(A, "_cliente", lambda: httpx.AsyncClient(transport=httpx.MockTransport(responder)))
    return llamadas


def scopus(i=1, **extra):
    return {"dc:identifier": f"SCOPUS_ID:{i}", "dc:title": f"Ensayo {i}", "dc:description": "Resumen científico recibido.",
            "dc:creator": "Pérez", "prism:publicationName": "Revista", "prism:coverDate": "2024-02-01", "prism:doi": f"10.1234/{i}", **extra}


def pagina_scopus(filas=None, total=1):
    return {"search-results": {"entry": filas if filas is not None else [scopus()], "opensearch:totalResults": str(total)}}


def embase():
    return {"itemInfo": {"itemIdList": {"lui": "L12345", "doi": "10.1234/embase", "medl": "2345"}},
            "head": {"citationTitle": {"titleText": [{"ttltext": "Ensayo Embase"}]},
                     "abstracts": {"abstracts": [{"para": "Resumen de Embase."}]},
                     "authorList": {"authors": [{"surname": "Pérez", "initials": "A."}]},
                     "source": {"publicationYear": "2023", "sourceTitle": ["Revista E"]},
                     "citationInfo": {"citationType": [{"content": "Article"}]}}}


def wos():
    return {"uid": "WOS:123", "title": "Ensayo WoS", "identifiers": {"doi": "10.1234/wos", "pmid": "678"},
            "source": {"sourceTitle": "Revista W", "publishYear": 2022}, "types": ["Article"],
            "names": {"authors": [{"displayName": "Pérez, A"}]}, "snippet": "No es resumen", "abstract": "No pertenece al contrato Starter"}


@pytest.mark.parametrize("fuente", A._REQUERIDOS)
@pytest.mark.asyncio
async def test_sin_configuracion_no_consulta(monkeypatch, fuente):
    monkeypatch.setattr(A.credenciales_academicas, "leer", lambda: {})
    llamadas = transporte(monkeypatch, lambda r: pytest.fail("No debe consultar"))
    assert A.disponible(fuente) is False
    assert await A.buscar(fuente, "Alzheimer") is None
    assert not llamadas


@pytest.mark.asyncio
async def test_configuracion_parcial_eds_no_es_acceso(monkeypatch):
    monkeypatch.setattr(A.credenciales_academicas, "leer", lambda: {**CFG, "cinahl_db": ""})
    assert not A.disponible("cinahl")
    assert A.disponible("psycinfo")
    assert await A.buscar("cinahl", "Alzheimer") is None
    assert await A.buscar("fuente_inventada", "Alzheimer") is None


@pytest.mark.parametrize("fuente,payload,endpoint,tipo", [
    ("embase", {"header": {"hits": 1}, "results": [embase()]}, A.EMBASE, "resumen"),
    ("scopus", pagina_scopus(), A.SCOPUS, "resumen"),
    ("web_of_science", {"metadata": {"total": 1}, "hits": [wos()]}, A.WOS, "metadatos_bibliograficos"),
])
@pytest.mark.asyncio
async def test_contrato_normalizado_y_procedencia(monkeypatch, fuente, payload, endpoint, tipo):
    llamadas = transporte(monkeypatch, lambda r: httpx.Response(200, json=payload))
    r = await A.buscar(fuente, "Alzheimer AND APOE")
    assert A.disponible(fuente)
    assert r["estado"] == "completa"
    assert r["total"] == 1
    a = r["articulos"][0]
    assert a["fuente"] == fuente and a["tipoContenido"] == tipo
    assert a["autores"] and a["doi"] and a["anio"]
    assert a["textoCompleto"] is False
    assert set(("pmid", "pmcid", "titulo", "resumen", "referencia", "revista", "tipos")) <= a.keys()
    c = r["consultas"][0]
    assert c["endpoint"] == endpoint and c["httpStatus"] == 200 and c["n"] == 1 and c["fecha"]
    esperado = hashlib.sha256(httpx.Response(200, json=payload).content).hexdigest()
    assert c["sha256"] == esperado
    assert len(llamadas) == 1
    if fuente == "scopus":
        assert llamadas[0].url.params["view"] == "COMPLETE"
        assert llamadas[0].headers["X-ELS-Insttoken"] == CFG["elsevier_insttoken"]
    if fuente == "web_of_science":
        assert llamadas[0].url.params["q"] == "TS=(Alzheimer AND APOE)"
        assert llamadas[0].url.params["db"] == "WOS"
        assert a["resumen"] == "" and a["resumenDisponible"] is False
        assert r["limitaciones"]
    for valor in CFG.values():
        assert valor not in json.dumps(r)
        assert valor not in str(llamadas[0].url)


@pytest.mark.parametrize("status", [301, 302, 401, 403, 404, 429, 500, 503])
@pytest.mark.asyncio
async def test_http_error_no_es_ausencia_y_no_sigue_redirect(monkeypatch, status):
    llamadas = transporte(monkeypatch, lambda r: httpx.Response(status, text=CFG["elsevier_api_key"], headers={"Location": "http://127.0.0.1/secreto"}))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["total"] is None and r["articulos"] == []
    assert r["consultas"][0]["httpStatus"] == status and r["limitaciones"]
    assert len(llamadas) == 1
    assert CFG["elsevier_api_key"] not in json.dumps(r)


@pytest.mark.parametrize("payload", [{}, {"hits": []}, {"metadata": {"total": True}, "hits": []},
                                     {"metadata": {"total": 0}, "hits": {}}, {"error": "fail"}, [], None])
@pytest.mark.asyncio
async def test_esquema_roto_no_es_ausencia(monkeypatch, payload):
    transporte(monkeypatch, lambda r: httpx.Response(200, json=payload))
    r = await A.buscar("web_of_science", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["total"] is None
    assert r["limitaciones"]


@pytest.mark.parametrize("fuente,payload", [
    ("embase", {"header": {"hits": 0}, "results": []}),
    ("scopus", pagina_scopus([{"error": "Result set was empty"}], 0)),
    ("web_of_science", {"metadata": {"total": 0}, "hits": []}),
])
@pytest.mark.asyncio
async def test_cero_solo_con_esquema_valido(monkeypatch, fuente, payload):
    transporte(monkeypatch, lambda r: httpx.Response(200, json=payload))
    r = await A.buscar(fuente, "Alzheimer")
    assert r["estado"] == "completa" and r["total"] == 0 and r["articulos"] == []


@pytest.mark.asyncio
async def test_dos_paginas_como_maximo_con_cobertura_parcial(monkeypatch):
    def handler(req):
        inicio = int(req.url.params["start"])
        return httpx.Response(200, json=pagina_scopus([scopus(i) for i in range(inicio, inicio + 10)], 100))
    llamadas = transporte(monkeypatch, handler)
    r = await A.buscar("scopus", "Alzheimer", 10000)
    assert len(llamadas) == 2
    assert [q.url.params["start"] for q in llamadas] == ["0", "10"]
    assert len(r["articulos"]) == 20 and r["total"] == 100 and r["estado"] == "parcial"
    assert r["consumo"] == {"elsevierConsultas": 2}


@pytest.mark.asyncio
async def test_segunda_pagina_falla_conserva_primera(monkeypatch):
    def handler(req):
        return httpx.Response(200, json=pagina_scopus([scopus(i) for i in range(10)], 15)) if req.url.params["start"] == "0" else httpx.Response(503)
    transporte(monkeypatch, handler)
    r = await A.buscar("scopus", "Alzheimer", 20)
    assert len(r["articulos"]) == 10 and r["estado"] == "parcial" and r["total"] == 15
    assert r["consultas"][-1]["estado"] == "no_comprobado"


@pytest.mark.asyncio
async def test_deduplicacion_y_no_inventa_resumen(monkeypatch):
    transporte(monkeypatch, lambda req: httpx.Response(200, json=pagina_scopus([scopus(1, **{"dc:description": None}), scopus(1), {"dc:title": "Sin id"}], 3)))
    r = await A.buscar("scopus", "Alzheimer")
    assert len(r["articulos"]) == 1 and r["estado"] == "parcial"
    assert r["articulos"][0]["resumen"] == "" and r["articulos"][0]["tipoContenido"] == "metadatos_bibliograficos"


@pytest.mark.asyncio
async def test_timeout_no_filtra_texto_de_error(monkeypatch):
    def handler(req):
        raise httpx.ReadTimeout(CFG["elsevier_api_key"], request=req)
    transporte(monkeypatch, handler)
    r = await A.buscar("scopus", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["total"] is None
    assert CFG["elsevier_api_key"] not in json.dumps(r)


@pytest.mark.asyncio
async def test_tamano_acotado(monkeypatch):
    monkeypatch.setattr(A, "MAX_BYTES", 100)
    transporte(monkeypatch, lambda req: httpx.Response(200, content=b"x" * 101))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["estado"] == "no_comprobado"


@pytest.mark.parametrize("consulta,maximo", [("", 10), ("A\nB", 10), ("A" * 4001, 10), ("APOE", 0), ("APOE", True), ("APOE", "2")])
@pytest.mark.asyncio
async def test_entrada_invalida_no_envia(monkeypatch, consulta, maximo):
    llamadas = transporte(monkeypatch, lambda r: pytest.fail("No debe consultar"))
    r = await A.buscar("scopus", consulta, maximo)
    assert r["estado"] == "no_comprobado" and not llamadas


def eds_record(dbid="ccm"):
    return {"Header": {"DbId": dbid, "An": "123", "PubType": "Article"},
            "Items": [{"Name": "Title", "Data": "Ensayo EDS"}, {"Name": "Abstract", "Data": "<p>Resumen EDS real.</p>"}],
            "RecordInfo": {"BibRecord": {"BibEntity": {"Identifiers": [{"Type": "doi", "Value": "10.1234/eds"}], "Dates": [{"Y": "2021"}]},
                                         "BibRelationships": {"HasContributorRelationships": [{"PersonEntity": {"Name": {"NameFull": "Pérez, A"}}}]}}},
            "PLink": "https://search.ebscohost.com/login.aspx?db=" + dbid + "&an=123"}


def eds_search(dbid="ccm", nombre="CINAHL Complete", *, discovery=False, filas=None, total=1):
    return {"SearchResult": {"Statistics": {"TotalHits": total, "Databases": [{"Id": dbid, "Label": nombre, "Status": "0", "Hits": total}]},
                             "Data": {"Records": [eds_record("OTRA_BASE")] if discovery else filas if filas is not None else [eds_record(dbid)]},
                             "AvailableFacets": [{"Id": "ContentProvider", "AvailableFacetValues": [{"Value": nombre, "Count": total}]}]}}


def eds_handler(dbid="ccm", nombre="CINAHL Complete", *, discovery=None, filtered=None, info=None):
    def handler(req):
        path = req.url.path.rsplit("/", 1)[-1]
        if path == "uidauth":
            assert json.loads(req.content)["Password"] == CFG["ebsco_password"]
            return httpx.Response(200, json={"AuthToken": "token_auth_eds_ficticio"})
        if path == "createsession":
            assert req.headers["x-authenticationToken"] == "token_auth_eds_ficticio"
            assert json.loads(req.content) == {"Profile": CFG["ebsco_profile"], "Guest": "n"}
            return httpx.Response(200, json={"SessionToken": "token_sesion_eds_ficticio"})
        if path == "info":
            return httpx.Response(200, json=info if info is not None else {"AvailableSearchCriteria": {"AvailableSearchModes": [{"Mode": "bool"}]}})
        if path == "endsession":
            assert json.loads(req.content)["SessionToken"] == "token_sesion_eds_ficticio"
            return httpx.Response(200, json={})
        assert path == "search" and req.headers["x-sessionToken"] == "token_sesion_eds_ficticio"
        if "facetfilter" not in req.url.params:
            assert req.url.params["resultsperpage"] == "1"
            return httpx.Response(200, json=discovery if discovery is not None else eds_search(dbid, nombre, discovery=True))
        assert req.url.params["facetfilter"] == "1,ContentProvider:" + nombre
        assert req.url.params["view"] == "detailed" and req.url.params["highlight"] == "n"
        return httpx.Response(200, json=filtered if filtered is not None else eds_search(dbid, nombre))
    return handler


@pytest.mark.parametrize("fuente,dbid,nombre", [("cinahl", "ccm", "CINAHL Complete"), ("psycinfo", "psyh", "APA PsycInfo")])
@pytest.mark.asyncio
async def test_eds_sesion_base_exacta_y_abstract_real(monkeypatch, fuente, dbid, nombre):
    llamadas = transporte(monkeypatch, eds_handler(dbid, nombre))
    r = await A.buscar(fuente, "Alzheimer")
    assert r["estado"] == "completa" and r["total"] == 1
    assert len(r["articulos"]) == 1 and r["articulos"][0]["id"] == dbid + ":123"
    assert r["articulos"][0]["resumen"] == "Resumen EDS real."
    assert r["articulos"][0]["autores"] == ["Pérez, A"]
    assert len(llamadas) == 6 and r["consumo"] == {"ebscoConsultas": 6}
    assert r["consultas"][3]["uso"] == "identificar_base_sin_incorporar_articulos"
    serializado = json.dumps(r)
    for valor in [*CFG.values(), "token_auth_eds_ficticio", "token_sesion_eds_ficticio"]:
        if valor not in {"ccm", "psyh"}:
            assert valor not in serializado


@pytest.mark.parametrize("modo", ["sin_base", "nombre_otra_base", "sin_faceta", "nombre_ambiguo", "estado_error"])
@pytest.mark.asyncio
async def test_eds_no_consulta_base_no_acreditada(monkeypatch, modo):
    d = eds_search(discovery=True)
    r = d["SearchResult"]
    if modo == "sin_base":
        r["Statistics"]["Databases"] = []
    elif modo == "nombre_otra_base":
        r["Statistics"]["Databases"][0]["Label"] = "APA PsycInfo"
    elif modo == "sin_faceta":
        r["AvailableFacets"] = []
    elif modo == "nombre_ambiguo":
        r["Statistics"]["Databases"].append({"Id": "otra", "Label": "CINAHL Complete", "Status": "0"})
    else:
        r["Statistics"]["Databases"][0]["Status"] = "1"
    llamadas = transporte(monkeypatch, eds_handler(discovery=d))
    r = await A.buscar("cinahl", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["articulos"] == [] and r["total"] is None
    assert len(llamadas) == 5 and llamadas[-1].url.path.endswith("endsession")


@pytest.mark.parametrize("modo", ["otra_base", "total_otra_base", "sin_base"])
@pytest.mark.asyncio
async def test_eds_rechaza_mezcla_de_bases(monkeypatch, modo):
    d = eds_search()
    if modo == "otra_base":
        d["SearchResult"]["Data"]["Records"].append(eds_record("psyh"))
    elif modo == "total_otra_base":
        d["SearchResult"]["Statistics"]["TotalHits"] = 9
    else:
        d["SearchResult"]["Statistics"]["Databases"] = []
    transporte(monkeypatch, eds_handler(filtered=d))
    r = await A.buscar("cinahl", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["articulos"] == [] and r["total"] is None


@pytest.mark.asyncio
async def test_eds_info_rota_no_busca(monkeypatch):
    llamadas = transporte(monkeypatch, eds_handler(info={}))
    r = await A.buscar("cinahl", "Alzheimer")
    assert r["estado"] == "no_comprobado" and len(llamadas) == 4
    assert not any(req.url.path.endswith("search") for req in llamadas)


@pytest.mark.asyncio
async def test_cancelacion_no_se_convierte_en_resultado(monkeypatch):
    def handler(req):
        raise asyncio.CancelledError
    transporte(monkeypatch, handler)
    with pytest.raises(asyncio.CancelledError):
        await A.buscar("scopus", "Alzheimer")
    assert A._SECRETOS.get() == ()


@pytest.mark.asyncio
async def test_eco_secretos_y_logs_se_redactan(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="httpcore.http11")
    def handler(req):
        logging.getLogger("httpcore.http11").debug("headers=%s", CFG["elsevier_api_key"])
        return httpx.Response(200, json=pagina_scopus([scopus(**{"dc:title": "Título " + CFG["elsevier_api_key"]})]))
    transporte(monkeypatch, handler)
    r = await A.buscar("scopus", "Alzheimer")
    assert CFG["elsevier_api_key"] not in caplog.text
    assert CFG["elsevier_api_key"] not in json.dumps(r)
    assert "[ACCESO_OCULTO]" in r["articulos"][0]["titulo"]


@pytest.mark.asyncio
async def test_cancelacion_eds_cierra_sesion_sin_ocultarla(monkeypatch):
    base = eds_handler()
    def handler(req):
        if req.url.path.endswith("search"):
            raise asyncio.CancelledError
        return base(req)
    llamadas = transporte(monkeypatch, handler)
    with pytest.raises(asyncio.CancelledError):
        await A.buscar("cinahl", "Alzheimer")
    assert llamadas[-1].url.path.endswith("endsession")
    assert A._SECRETOS.get() == ()


@pytest.mark.asyncio
async def test_eds_autenticacion_fallida_no_abre_sesion(monkeypatch):
    llamadas = transporte(monkeypatch, lambda req: httpx.Response(401, text=CFG["ebsco_password"]))
    r = await A.buscar("cinahl", "Alzheimer")
    assert r["estado"] == "no_comprobado" and len(llamadas) == 1
    assert CFG["ebsco_password"] not in json.dumps(r)


@pytest.mark.asyncio
async def test_identificadores_no_inventan_fusion_y_doi_con_angulos(monkeypatch):
    doi = "10.1002/(SICI)1097-0215(19961220)69:6<480::AID-IJC11>3.0.CO;2-5"
    transporte(monkeypatch, lambda req: httpx.Response(200, json=pagina_scopus([
        scopus(1, **{"prism:doi": "doi-no-valido", "pubmed-id": "no-id"}),
        scopus(2, **{"prism:doi": doi, "pubmed-id": "12345"}),
    ], 2)))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["articulos"][0]["doi"] is None and r["articulos"][0]["pmid"] == ""
    assert r["articulos"][1]["doi"] == doi.lower() and r["articulos"][1]["pmid"] == "12345"
    assert "%3C480" in r["articulos"][1]["url"]


@pytest.mark.parametrize("url", ["http://example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a",
                                 "https://a.local/a", "https://usuario:clave@example.org/a", "https://example.org:8888/a", "https://example.org/\na"])
@pytest.mark.asyncio
async def test_enlaces_no_publicos_no_se_conservan(monkeypatch, url):
    d = pagina_scopus([scopus(**{"prism:doi": None, "link": [{"@ref": "scopus", "@href": url}]})])
    llamadas = transporte(monkeypatch, lambda req: httpx.Response(200, json=d))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["articulos"][0]["url"] == "" and len(llamadas) == 1


@pytest.mark.asyncio
async def test_total_contradictorio_no_es_cero(monkeypatch):
    transporte(monkeypatch, lambda req: httpx.Response(200, json=pagina_scopus([scopus()], 0)))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["estado"] == "no_comprobado" and r["total"] is None and r["articulos"] == []
    assert r["consultas"][0]["estado"] == "no_comprobado"


@pytest.mark.asyncio
async def test_eds_cero_filtrado_comprobable(monkeypatch):
    transporte(monkeypatch, eds_handler(filtered=eds_search(filas=[], total=0)))
    r = await A.buscar("cinahl", "Alzheimer")
    assert r["estado"] == "completa" and r["total"] == 0 and r["articulos"] == []


@pytest.mark.asyncio
async def test_eds_dos_paginas_y_tope_local(monkeypatch):
    base = eds_handler()
    def handler(req):
        if req.url.path.endswith("search") and "facetfilter" in req.url.params:
            page = int(req.url.params["pagenumber"])
            filas = [eds_record() for _ in range(10)]
            for i, fila in enumerate(filas):
                fila["Header"]["An"] = str((page - 1) * 10 + i)
            return httpx.Response(200, json=eds_search(filas=filas, total=100))
        return base(req)
    llamadas = transporte(monkeypatch, handler)
    r = await A.buscar("cinahl", "Alzheimer", 50)
    assert r["estado"] == "parcial" and len(r["articulos"]) == 20 and len(llamadas) == 7
    assert len([q for q in llamadas if "facetfilter" in q.url.params]) == 2


@pytest.mark.parametrize("campo,valor,url", [
    ("prism:doi", "10.1234/a", "https://doi.org/10.1234/b"),
    ("pubmed-id", "123", "https://pubmed.ncbi.nlm.nih.gov/456/"),
])
@pytest.mark.asyncio
async def test_enlace_canonico_no_puede_respaldar_otro_identificador(monkeypatch, campo, valor, url):
    fila = scopus(**{campo: valor, "link": [{"@ref": "scopus", "@href": url}]})
    transporte(monkeypatch, lambda req: httpx.Response(200, json=pagina_scopus([fila])))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["articulos"] == [] and r["estado"] == "no_comprobado"


@pytest.mark.asyncio
async def test_doi_en_forma_url_no_incluye_parametros(monkeypatch):
    fila = scopus(**{"prism:doi": "https://doi.org/10.1234/a%28b%29?utm_source=x#referencia"})
    transporte(monkeypatch, lambda req: httpx.Response(200, json=pagina_scopus([fila])))
    r = await A.buscar("scopus", "Alzheimer")
    assert r["articulos"][0]["doi"] == "10.1234/a(b)"
    assert r["articulos"][0]["url"] == "https://doi.org/10.1234/a%28b%29"
