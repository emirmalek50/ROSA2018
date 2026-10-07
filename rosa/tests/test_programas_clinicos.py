"""La cobertura de un registro nunca es prueba de ausencia mundial."""

from copy import deepcopy

import httpx
import pytest

from rosa.fuentes import programas_clinicos as PC
from rosa.fuentes.base import FuenteNoDisponible


def estudio(nct: str = "NCT00000001") -> dict:
    return {"protocolSection": {
        "identificationModule": {"nctId": nct, "briefTitle": "Evaluación de BAN2401", "orgStudyIdInfo": {"id": "BAN2401-G000-301"}},
        "statusModule": {"overallStatus": "TERMINATED", "whyStopped": "Business decision", "startDateStruct": {"date": "2020-01-01", "type": "ACTUAL"}, "lastUpdatePostDateStruct": {"date": "2026-10-01", "type": "ACTUAL"}},
        "designModule": {"studyType": "INTERVENTIONAL", "phases": ["PHASE2"]},
        "conditionsModule": {"conditions": ["Parkinson Disease"]},
        "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Universidad", "class": "OTHER"}, "collaborators": [{"name": "Empresa", "class": "INDUSTRY"}]},
        "armsInterventionsModule": {"interventions": [{"name": "Lecanemab", "type": "DRUG", "otherNames": ["BAN2401"], "description": "Infusión intravenosa", "armGroupLabels": ["Experimental"]}], "armGroups": [{"label": "Experimental", "type": "EXPERIMENTAL", "description": "Intervención", "interventionNames": ["Drug: Lecanemab"]}]},
        "referencesModule": {"references": [{"pmid": "1234", "type": "RESULT", "citation": "Artículo"}]}},
        "hasResults": True, "resultsSection": {"outcomeMeasuresModule": {"outcomeMeasures": [{"title": "Desenlace", "type": "PRIMARY", "timeFrame": "12 weeks", "unitOfMeasure": "score"}]}}}


def respuestas(monkeypatch, cuerpos):
    llamadas = []

    async def pedir(metodo, url, limitador, **kw):
        llamadas.append({"metodo": metodo, "url": url, **deepcopy(kw)})
        siguiente = cuerpos.pop(0)
        if isinstance(siguiente, Exception):
            raise siguiente
        return httpx.Response(200, json=siguiente, request=httpx.Request(metodo, url))

    monkeypatch.setattr(PC, "pedir", pedir)
    return llamadas


@pytest.mark.asyncio
async def test_conserva_empresa_colaboradora_alias_brazos_resultados_y_otras_indicaciones(monkeypatch):
    llamadas = respuestas(monkeypatch, [{"studies": [estudio()], "totalCount": 1}])
    r = await PC.buscar(["lecanemab"])
    s = r["estudios"][0]
    assert s["patrocinador"] == {"nombre": "Universidad", "clase": "OTHER"}
    assert s["colaboradores"] == [{"nombre": "Empresa", "clase": "INDUSTRY"}]
    assert s["intervenciones"][0]["otrosNombres"] == ["BAN2401"]
    assert s["brazos"][0]["tipo"] == "EXPERIMENTAL"
    assert s["estado"] == "TERMINATED" and s["whyStopped"] == "Business decision"
    assert s["condiciones"] == ["Parkinson Disease"]
    assert s["hasResults"] is True and s["resultados"]["desenlaces"][0]["titulo"] == "Desenlace"
    assert s["resultados"]["referencias"][0]["pmid"] == "1234"
    assert s["fechas"]["ultimaActualizacion"]["fecha"] == "2026-10-01"
    assert s["codigoPatrocinador"] == "BAN2401-G000-301"
    assert s["url"] == "https://clinicaltrials.gov/study/NCT00000001"
    assert r["consultas"][0]["completa"] is True
    assert llamadas[0]["params"]["query.intr"] == '"lecanemab"'
    assert "query.cond" not in llamadas[0]["params"]
    assert "filter.overallStatus" not in llamadas[0]["params"]


@pytest.mark.asyncio
async def test_pagina_por_alias_y_deduplica_nct_entre_consultas(monkeypatch):
    llamadas = respuestas(monkeypatch, [
        {"studies": [estudio()], "totalCount": 2, "nextPageToken": "dos"},
        {"studies": [estudio("NCT00000002")], "totalCount": 2},
        {"studies": [estudio()], "totalCount": 1},
    ])
    r = await PC.buscar(["lecanemab", "BAN2401", "Lecanemab"], tamano_pagina=1)
    assert len(llamadas) == 3 and llamadas[1]["params"]["pageToken"] == "dos"
    assert len(r["estudios"]) == 2
    assert r["estudios"][0]["terminosCoincidentes"] == ["lecanemab", "BAN2401"]
    assert [c["recuperados"] for c in r["consultas"]] == [2, 1]
    assert all(c["completa"] for c in r["consultas"])


@pytest.mark.asyncio
async def test_tope_visible_no_presenta_cobertura_completa(monkeypatch):
    llamadas = respuestas(monkeypatch, [{"studies": [estudio()], "totalCount": 4, "nextPageToken": "otra"}])
    r = await PC.buscar(["lecanemab"], max_paginas=1, tamano_pagina=1)
    assert len(llamadas) == 1
    assert not r["consultas"][0]["completa"]
    assert r["consultas"][0]["error"] is None
    assert any("1 de 4" in x for x in r["limitaciones"])


@pytest.mark.asyncio
async def test_limita_a_seis_alias_y_tres_paginas(monkeypatch):
    llamadas = respuestas(monkeypatch, [{"studies": [], "totalCount": 0}] * 6)
    r = await PC.buscar([f"drug-{n}" for n in range(7)], max_paginas=4)
    assert len(llamadas) == 6
    assert any("primeros 6" in x for x in r["limitaciones"])
    assert any("3 páginas" in x for x in r["limitaciones"])


@pytest.mark.asyncio
async def test_fuente_caida_no_impide_otro_alias_ni_se_convierte_en_cero(monkeypatch):
    respuestas(monkeypatch, [FuenteNoDisponible("HTTP 503"), {"studies": [estudio()], "totalCount": 1}])
    r = await PC.buscar(["lecanemab", "BAN2401"])
    assert len(r["estudios"]) == 1
    assert r["consultas"][0]["total"] is None
    assert r["consultas"][0]["error"] and not r["consultas"][0]["completa"]
    assert r["consultas"][1]["completa"]
    assert any("no se afirma ausencia" in x for x in r["limitaciones"])


@pytest.mark.asyncio
async def test_fallo_despues_de_la_primera_pagina_conserva_hallazgo(monkeypatch):
    respuestas(monkeypatch, [{"studies": [estudio()], "totalCount": 2, "nextPageToken": "dos"}, FuenteNoDisponible("timeout")])
    r = await PC.buscar(["lecanemab"])
    assert len(r["estudios"]) == 1
    assert r["consultas"][0]["recuperados"] == 1 and not r["consultas"][0]["completa"]


@pytest.mark.asyncio
async def test_cursor_repetido_corta_en_vez_de_repetir_llamadas(monkeypatch):
    llamadas = respuestas(monkeypatch, [
        {"studies": [estudio()], "totalCount": 3, "nextPageToken": "dos"},
        {"studies": [estudio("NCT00000002")], "totalCount": 3, "nextPageToken": "dos"},
    ])
    r = await PC.buscar(["lecanemab"])
    assert len(llamadas) == 2
    assert "cursor de página repetido" in r["consultas"][0]["error"]
    assert r["consultas"][0]["recuperados"] == 2


@pytest.mark.parametrize("cuerpo", [[], {}, {"studies": None, "totalCount": 0}, {"studies": [], "totalCount": "0"},
    {"studies": [], "totalCount": True}, {"studies": [], "totalCount": -1},
    {"studies": [], "totalCount": 1}, {"studies": [estudio()], "totalCount": 0},
    {"studies": [estudio()], "totalCount": 2},
    {"studies": [estudio()], "totalCount": 2, "nextPageToken": 42},
    {"studies": [estudio("invalid")], "totalCount": 1},
    {"studies": [None], "totalCount": 1},
    {"studies": [{"protocolSection": []}], "totalCount": 1},
])
@pytest.mark.asyncio
async def test_respuestas_malformadas_o_con_conteos_inconsistentes_no_acreditan_ausencia(monkeypatch, cuerpo):
    respuestas(monkeypatch, [cuerpo])
    r = await PC.buscar(["lecanemab"])
    assert r["consultas"][0]["error"]
    assert not r["consultas"][0]["completa"]


@pytest.mark.asyncio
async def test_conteo_cambia_no_declara_completa(monkeypatch):
    respuestas(monkeypatch, [
        {"studies": [estudio()], "totalCount": 2, "nextPageToken": "dos"},
        {"studies": [estudio("NCT00000002")], "totalCount": 1},
    ])
    r = await PC.buscar(["lecanemab"])
    assert "totalCount cambió" in r["consultas"][0]["error"]
    assert not r["consultas"][0]["completa"]
    assert len(r["estudios"]) == 2  # El cambio de conteo no borra evidencia positiva.


@pytest.mark.asyncio
async def test_nct_repetido_entre_paginas_no_inflaciona_conteo(monkeypatch):
    respuestas(monkeypatch, [
        {"studies": [estudio()], "totalCount": 2, "nextPageToken": "dos"},
        {"studies": [estudio()], "totalCount": 2},
    ])
    r = await PC.buscar(["lecanemab"])
    assert len(r["estudios"]) == 1
    assert "NCT se repitió" in r["consultas"][0]["error"]


@pytest.mark.asyncio
async def test_cero_explicita_limite_del_registro_sin_promesa_mundial(monkeypatch):
    respuestas(monkeypatch, [{"studies": [], "totalCount": 0}])
    r = await PC.buscar(["lecanemab"])
    assert r["estudios"] == []
    assert r["consultas"][0]["completa"] is True
    assert any("no permite afirmar" in x for x in r["limitaciones"])


@pytest.mark.parametrize("argumentos", [
    {"terminos": []}, {"terminos": "lecanemab"}, {"terminos": [None]},
    {"terminos": [""]}, {"terminos": ["x\n"]}, {"terminos": ["x" * 301]},
    {"terminos": ['x" OR placebo']}, {"terminos": ["lecanemab"], "max_paginas": 0},
    {"terminos": ["lecanemab"], "max_paginas": True},
    {"terminos": ["lecanemab"], "tamano_pagina": 1001},
])
@pytest.mark.asyncio
async def test_argumentos_invalidos_no_consultan_red(monkeypatch, argumentos):
    llamadas = respuestas(monkeypatch, [])
    with pytest.raises(ValueError):
        await PC.buscar(**argumentos)
    assert llamadas == []


@pytest.mark.asyncio
async def test_patrocinador_desconocido_no_se_infiere_empresa_por_nombre(monkeypatch):
    s = estudio()
    s["protocolSection"]["sponsorCollaboratorsModule"] = {"leadSponsor": {"name": "Company university trial"}}
    s.pop("hasResults")
    s.pop("resultsSection")
    respuestas(monkeypatch, [{"studies": [s], "totalCount": 1}])
    r = await PC.buscar(["lecanemab"])
    assert r["estudios"][0]["patrocinador"]["clase"] is None
    assert r["estudios"][0]["hasResults"] is None


@pytest.mark.parametrize("campo,valor", [("interventions", ["bad"]), ("interventions", [{"name": "drug", "otherNames": [1]}]), ("armGroups", {}), ("interventions", [{"armGroupLabels": "one"}])])
@pytest.mark.asyncio
async def test_estructura_intervencion_invalida_no_se_acepta(monkeypatch, campo, valor):
    s = estudio()
    s["protocolSection"]["armsInterventionsModule"][campo] = valor
    respuestas(monkeypatch, [{"studies": [s], "totalCount": 1}])
    r = await PC.buscar(["lecanemab"])
    assert r["estudios"] == []
    assert r["consultas"][0]["error"]
