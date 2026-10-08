"""Exa como fuente y conector: mapeo de resultados, clave solo en cabecera,
comportamiento sin clave y desvío de consultas. Sin red."""
import asyncio
import importlib

import httpx
import pytest

from rosa import config
from rosa.fuentes import exa
from rosa.fuentes.base import FuenteNoDisponible

RESPUESTA = {
    "requestId": "r1",
    "costDollars": {"total": 0.008},
    "results": [
        {
            "id": "https://www.nature.com/articles/s41591-025-01234-5",
            "url": "https://www.nature.com/articles/s41591-025-01234-5",
            "title": "Plasma GFAP rises before NfL in APOE e4 carriers",
            "publishedDate": "2025-06-01T00:00:00.000Z",
            "author": "Ana Pérez; Luis Gómez; Marta Ruiz; Juan Díaz",
            "score": 0.61,
            "highlights": ["GFAP increased 3.2 years before NfL.", "Effect was restricted to amyloid-positive carriers."],
            "highlightScores": [0.71, 0.44],
        },
        {
            "url": "https://doi.org/10.1002/alz.13579",
            "title": "Astrocyte reactivity and neuroaxonal injury",
            "publishedDate": "2024-11-12",
            "author": ["Chen W", "Smith J"],
            "highlights": [],
            "text": "Full text snippet about astrocytes and axons.",
        },
        {"url": "https://pubmed.ncbi.nlm.nih.gov/39912345/", "title": "A PubMed record", "publishedDate": "2026-01-05"},
        {"url": "https://www.biorxiv.org/content/10.1101/2026.02.01.123456v1.full", "title": "A preprint", "publishedDate": "2026-02-01"},
        {"url": "https://doi.org/10.1101/2024.01.25.24301779", "title": "A medRxiv preprint behind doi.org", "publishedDate": "2024-01-26"},
        {"title": "sin url, se ignora"},
    ],
}


@pytest.fixture
def con_clave(monkeypatch):
    monkeypatch.setattr(config, "CLAVE_EXA", "exa_clave_de_prueba")
    llamadas = []

    async def pedir_falso(metodo, url, limitador, **kwargs):
        llamadas.append((metodo, url, kwargs))
        return httpx.Response(200, json=RESPUESTA, request=httpx.Request(metodo, url))

    monkeypatch.setattr(exa, "pedir", pedir_falso)
    return llamadas


def test_buscar_mapea_a_la_forma_de_las_otras_bases(con_clave):
    articulos, n, coste = asyncio.run(exa.buscar("¿GFAP sube antes que NfL en portadores de APOE4?", maximo=10, desde_anio=2023))
    assert n == 5 and coste == 0.008
    a = articulos[0]
    assert a["doi"] == "10.1038/s41591-025-01234-5" and a["anio"] == 2025 and a["referencia"] == "Pérez et al., 2025"
    assert "3.2 years" in a["resumen"] and a["titulo"].startswith("Plasma GFAP")
    b = articulos[1]
    assert b["doi"] == "10.1002/alz.13579" and b["referencia"] == "Chen y Smith, 2024" and b["resumen"].startswith("Full text")
    assert articulos[2]["pmid"] == "39912345" and articulos[2]["doi"] is None
    assert articulos[3]["preprint"] is True and articulos[3]["doi"] == "10.1101/2026.02.01.123456"
    assert articulos[4]["preprint"] is True and articulos[4]["doi"] == "10.1101/2024.01.25.24301779"
    metodo, url, kwargs = con_clave[0]
    assert metodo == "POST" and url.endswith("/search")
    assert kwargs["json"]["category"] == "publication" and kwargs["json"]["startPublishedDate"].startswith("2023-01-01")
    assert kwargs["json"]["type"] == "auto" and "deep" not in kwargs["json"]["type"]
    assert kwargs["json"]["contents"] == {"highlights": True}
    assert a["similitud"] == 0.71 and b["similitud"] is None


def test_la_clave_va_solo_en_la_cabecera(con_clave):
    asyncio.run(exa.buscar("pregunta", maximo=3))
    _, _, kwargs = con_clave[0]
    assert kwargs["headers"]["x-api-key"] == "exa_clave_de_prueba"
    assert "exa_clave_de_prueba" not in str(kwargs["json"])


def test_sin_clave_no_hay_resultado_sino_no_pude_comprobar(monkeypatch):
    monkeypatch.setattr(config, "CLAVE_EXA", "")
    assert not exa.disponible()
    with pytest.raises(FuenteNoDisponible):
        asyncio.run(exa.buscar("pregunta"))


def test_similares_y_contenidos_usan_sus_endpoints(con_clave):
    parecidos, _ = asyncio.run(exa.similares("https://doi.org/10.1002/alz.13579", maximo=4))
    assert len(parecidos) == 5 and con_clave[-1][1].endswith("/findSimilar")
    textos, _ = asyncio.run(exa.contenidos(["https://doi.org/10.1002/alz.13579"]))
    assert con_clave[-1][1].endswith("/contents") and con_clave[-1][2]["json"]["text"]["maxCharacters"] == 20000
    assert isinstance(textos, list)


def test_conectores_inertes_sin_clave_y_vivos_con_ella(monkeypatch):
    import rosa.conectores.exa as modulo
    from rosa.conectores.base import REGISTRO

    monkeypatch.setattr(config, "CLAVE_EXA", "")
    importlib.reload(modulo)
    assert REGISTRO["exa_publicaciones"].estado == "requiere_cuenta" and "ROSA_EXA_KEY" in REGISTRO["exa_publicaciones"].motivo
    monkeypatch.setattr(config, "CLAVE_EXA", "x")
    importlib.reload(modulo)
    assert REGISTRO["exa_publicaciones"].estado == "disponible" and REGISTRO["exa_publicaciones"].clave == "si"
    monkeypatch.setattr(config, "CLAVE_EXA", "")
    importlib.reload(modulo)


def test_el_plan_puede_elegir_exa_solo_con_clave_y_si_no_se_desvia(monkeypatch):
    from rosa.bucle import pasos

    monkeypatch.setattr(config, "CLAVE_EXA", "")
    assert pasos.bases_disponibles() == ["pubmed", "europepmc", "preprints", *pasos.FUENTES_ACADEMICAS]
    desviada = pasos.base_efectiva({"base": "exa", "consulta": "¿GFAP precede a NfL?", "tema": "orden"})
    assert desviada["base"] == "europepmc" and desviada["_desviada_de"] == "exa"
    assert pasos.base_efectiva({"base": "pubmed", "consulta": "gfap[tiab]", "tema": "x"})["base"] == "pubmed"
    monkeypatch.setattr(config, "CLAVE_EXA", "x")
    assert "exa" in pasos.bases_disponibles()
    assert pasos.base_efectiva({"base": "exa", "consulta": "q", "tema": "t"})["base"] == "exa"
    assert pasos.NOMBRES_BASE["exa"].startswith("Exa")
    assert "gris" in pasos.bases_disponibles() and pasos.NOMBRES_BASE["gris"].startswith("Exa")


def test_pasajes_guiados_y_ventana_de_fechas(con_clave):
    asyncio.run(exa.buscar("¿Qué se sabía?", maximo=6, pregunta_pasajes="¿GFAP precede a NfL?", hasta_fecha="2026-03-15", desde_fecha="2025-01-01", categoria=None, dominios=exa.DOMINIOS_GRIS))
    _, _, kwargs = con_clave[0]
    cuerpo = kwargs["json"]
    assert cuerpo["contents"] == {"highlights": {"query": "¿GFAP precede a NfL?"}}
    assert cuerpo["startPublishedDate"].startswith("2025-01-01") and cuerpo["endPublishedDate"].startswith("2026-03-15T23:59:59")
    assert "category" not in cuerpo and "fda.gov" in cuerpo["includeDomains"] and "alzforum.org" in cuerpo["includeDomains"]


def test_enlaces_filtra_solo_lo_bibliografico(monkeypatch):
    monkeypatch.setattr(config, "CLAVE_EXA", "x")
    respuesta = {"costDollars": {"total": 0.001}, "results": [{"url": "https://ejemplo.org/articulo", "extras": {"links": [
        "https://doi.org/10.1002/alz.13579", "https://www.nature.com/articles/s41591-025-01234-5", "https://pubmed.ncbi.nlm.nih.gov/39912345/",
        "https://twitter.com/algo", "https://ejemplo.org/about", "https://doi.org/10.1002/alz.13579", "https://doi.org/10.1002%2Falz.13579", "https://www.medrxiv.org/content/10.1101/2024.01.25.24301779v2"]}}]}

    async def pedir_falso(metodo, url, limitador, **kwargs):
        assert url.endswith("/contents") and kwargs["json"]["extras"]["links"] == 300
        return httpx.Response(200, json=respuesta, request=httpx.Request(metodo, url))

    monkeypatch.setattr(exa, "pedir", pedir_falso)
    refs, coste = asyncio.run(exa.enlaces("https://ejemplo.org/articulo"))
    assert coste == 0.001
    assert [r["doi"] or r["pmid"] for r in refs] == ["10.1002/alz.13579", "39912345", "10.1101/2024.01.25.24301779"]
    # nature.com sin prefijo de DOI no pasa el filtro bibliográfico (no es doi.org ni PubMed): no se inventa nada.
    assert all("nature.com" not in r["url"] for r in refs)


def test_conector_de_referencias_registrado(monkeypatch):
    import rosa.conectores.exa as modulo
    from rosa.conectores.base import REGISTRO

    monkeypatch.setattr(config, "CLAVE_EXA", "x")
    importlib.reload(modulo)
    assert REGISTRO["exa_referencias"].estado == "disponible" and REGISTRO["exa_referencias"].grupo == "literatura"
    monkeypatch.setattr(config, "CLAVE_EXA", "")
    importlib.reload(modulo)
    assert REGISTRO["exa_referencias"].estado == "requiere_cuenta"



def test_ayudas_de_la_novedad_por_fecha_y_puntuacion():
    from rosa.bucle import pasos
    from rosa.estado import plantilla

    assert pasos.fecha_iso_de_ms(1757900000000) == "2025-09-15"
    assert pasos.fecha_iso_de_ms(None) is None and pasos.fecha_iso_de_ms("x") is None
    assert pasos.estado_por_puntuacion(9, "ya", "parcial", "nada") == "ya"
    assert pasos.estado_por_puntuacion(5, "ya", "parcial", "nada") == "parcial"
    assert pasos.estado_por_puntuacion(4, "ya", "parcial", "nada") == "nada"
    n = plantilla.novedad_pendiente()
    assert n["patentes"]["estado"] == "no_comprobado" and n["financiacion"]["url"] is None
    assert "patents.google.com" in exa.DOMINIOS_PATENTES and "reporter.nih.gov" in exa.DOMINIOS_FINANCIACION


def test_novedad_por_dominios_sin_clave_queda_no_comprobado(monkeypatch):
    from rosa.bucle import pasos

    monkeypatch.setattr(config, "CLAVE_EXA", "")

    class Pista:
        def accion(self, *a, **k):
            raise AssertionError("sin clave no se llama a Exa")

        def nota(self, *a, **k):
            pass

    novedad = {}
    h = {"enunciado": "GFAP precede a NfL", "creadaEn": 1757900000000}
    asyncio.run(pasos._novedad_exa_dominios(None, h, Pista(), novedad, "patentes", exa.DOMINIOS_PATENTES, "Alguien ya patentó esto", ("patente_relacionada", "parcial", "sin_patente"), "patentes"))
    assert novedad["patentes"]["estado"] == "no_comprobado" and "ROSA_EXA_KEY" in novedad["patentes"]["detalle"]


def test_novedad_por_dominios_con_exa_y_juez_simulado(monkeypatch):
    from rosa.bucle import pasos

    monkeypatch.setattr(config, "CLAVE_EXA", "x")
    llamadas = []

    async def pedir_falso(metodo, url, limitador, **kwargs):
        llamadas.append(kwargs["json"])
        return httpx.Response(200, json=RESPUESTA, request=httpx.Request(metodo, url))

    monkeypatch.setattr(exa, "pedir", pedir_falso)

    class Pred:
        puntuacion = 9

    class Programas:
        relevancia = object()

    class Ctx:
        programas = Programas()
        corrida_id = "c1"

        async def llamar(self, rol, programa, **kw):
            assert rol == "volumen" and "patentó" in kw["preguntas_abiertas"]
            return Pred()

        def mutar(self, fn, nombre):
            e = {"corridas": [{"id": "c1", "gasto": {}}]}
            fn(e)
            self.gasto = e["corridas"][0]["gasto"]

    class Pista:
        def accion(self, *a, **k):
            pass

        def nota(self, *a, **k):
            pass

    ctx = Ctx()
    novedad = {}
    h = {"enunciado": "GFAP precede a NfL en portadores de APOE4", "creadaEn": 1757900000000}
    asyncio.run(pasos._novedad_exa_dominios(ctx, h, Pista(), novedad, "patentes", exa.DOMINIOS_PATENTES, "Alguien ya patentó esto", ("patente_relacionada", "parcial", "sin_patente"), "patentes"))
    assert novedad["patentes"]["estado"] == "patente_relacionada" and novedad["patentes"]["url"]
    cuerpo = llamadas[0]
    assert cuerpo["includeDomains"] == exa.DOMINIOS_PATENTES and cuerpo["endPublishedDate"].startswith("2025-09-15") and "category" not in cuerpo
    assert ctx.gasto["exaUsd"] == 0.008


def test_trocear_texto_corta_en_parrafos_y_frases():
    from rosa.bucle.pasos import trocear_texto

    assert trocear_texto("") == [] and trocear_texto("   \n\n ") == []
    corto = trocear_texto("Un párrafo.\n\nOtro párrafo.")
    assert corto == ["Un párrafo.\nOtro párrafo."]
    largo = "Frase de relleno número uno. " * 400
    trozos = trocear_texto(largo, tamano=2500)
    assert len(trozos) >= 4 and all(len(t) <= 2600 for t in trozos) and all(t.endswith(".") for t in trozos)
    assert "".join(t.replace("\n", " ") for t in trozos).replace(" ", "") == largo.replace(" ", "")


def test_costes_incluyen_exa_de_corridas_y_vigilancia():
    from rosa.costes import costes_de_investigacion

    e = {
        "corridas": [{"id": "c1", "investigacionId": "inv", "numero": 1, "gasto": {"usd": 1.0, "llamadas": 10, "exaUsd": 0.021}}],
        "hipotesis": [{"id": "h1", "investigacionId": "inv", "vigilancia": {"costeUsd": 0.014}}, {"id": "h2", "investigacionId": "inv"}],
        "decisiones": [],
        "artefactos": [],
    }
    c = costes_de_investigacion(e, "inv", {})
    assert c["usdModelo"] == 1.0 and c["usdExa"] == 0.035 and abs(c["usdTotal"] - 1.035) < 0.006 and "Exa" in c["nota"]
