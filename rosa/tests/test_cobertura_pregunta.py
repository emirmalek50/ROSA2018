"""La cobertura de una pregunta y la comprobación de que cada referencia
citada sale de lo que devolvieron las herramientas (1 de octubre de 2026)."""

from rosa import herramientas as H
from rosa.estado import acciones as A


def test_la_cobertura_se_lee_con_vinetas_tildes_y_sinonimos():
    texto = """- Respondido | Qué es p-tau217 | Lo dice PubMed
2. NO ESTÁ | Estudios en plasma | Ninguna búsqueda lo devolvió
* parcial | Uso en seguimiento | Solo un estudio
no pude comprobar | Ensayos registrados | ClinicalTrials.gov no respondió
inventado | Algo | nada
sin barra ninguna"""
    c = H.leer_cobertura(texto)
    assert [p["estado"] for p in c] == ["respondido", "no_esta", "en_parte", "no_pude_comprobar"]
    assert c[1] == {"estado": "no_esta", "parte": "Estudios en plasma", "nota": "Ninguna búsqueda lo devolvió"}


def test_la_cobertura_vacia_o_rota_no_inventa_partes():
    assert H.leer_cobertura("") == []
    assert H.leer_cobertura("Todo bien, respondí la pregunta.") == []
    assert H.leer_cobertura("respondido |  | nota") == []


def test_la_cobertura_tiene_tope():
    assert len(H.leer_cobertura("\n".join(f"respondido | parte {i} | n" for i in range(20)))) == H.MAX_PARTES_COBERTURA


def test_una_referencia_que_ninguna_herramienta_devolvio_queda_sin_respaldo():
    respuesta = "Según 10.1038/S41591-024-0001. y PMID: 38123456, además de he-ab12-3 y NCT01234567."
    devuelto = '{"doi": "10.1038/s41591-024-0001", "pmid": "38123456", "id": "he-ab12-3"}'
    a = H.atribucion(respuesta, devuelto)
    assert a["citadas"] == ["10.1038/S41591-024-0001", "PMID 38123456", "he-ab12-3", "NCT01234567"]
    assert a["sinRespaldo"] == ["NCT01234567"]


def test_una_respuesta_que_se_abstiene_no_cita_nada():
    assert H.atribucion("No encuentro información sobre p-tau217 en los documentos.", "") == {"citadas": [], "sinRespaldo": []}


def test_la_cobertura_y_la_atribucion_se_guardan_con_la_pregunta():
    e = {"investigaciones": [{"id": "inv-1"}]}
    cob = [{"estado": "no_esta", "parte": "p", "nota": ""}]
    assert A.registrar_pregunta_bases(e, "inv-1", {"pregunta": "¿p-tau217?", "respuesta": "No", "cobertura": cob, "atribucion": {"citadas": [], "sinRespaldo": []}, "duracionMs": 19000}, 1)
    q = e["investigaciones"][0]["preguntasABases"][0]
    assert q["cobertura"] == cob and q["duracionMs"] == 19000 and q["atribucion"]["citadas"] == []
    assert A.registrar_pregunta_bases(e, "inv-1", {"pregunta": "otra", "respuesta": "x"}, 2)
    assert "cobertura" not in e["investigaciones"][0]["preguntasABases"][1]
