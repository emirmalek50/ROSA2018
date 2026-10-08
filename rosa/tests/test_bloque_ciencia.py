"""Lo que ROSA2018 tomo de la revisión de 14 de septiembre de 2026 (huecos de un
AI scientist profesional): riesgo de sesgo por instrumento, PRISMA 2020,
ensayo en seco, conocimiento operativo."""

import csv
from pathlib import Path

import pytest

from rosa import prisma as PRISMA
from rosa import sesgo as SESGO
from rosa import sintetico as SINT
from rosa.estado import acciones as A
from rosa.estado import plantilla as P


def test_instrumento_por_diseno_y_diagnostico():
    assert SESGO.instrumento_para("ensayo_aleatorizado") == "rob2"
    assert SESGO.instrumento_para("cohorte") == "robins_i" and SESGO.instrumento_para("transversal") == "robins_i"
    assert SESGO.instrumento_para("revision_sistematica") == "robis"
    assert SESGO.instrumento_para("preclinico") == "syrcle"
    assert SESGO.instrumento_para("cohorte", "plasma GFAP showed an AUC of 0.83 with sensitivity 78 %") == "quadas2"
    assert SESGO.instrumento_para("revision_narrativa") is None and SESGO.instrumento_para("otro") is None
    assert "1.1. Was the allocation sequence random?" in SESGO.texto_preguntas("rob2")


def test_veredicto_por_regla_desde_las_respuestas():
    # Todo protege: bajo. Una respuesta segura en el sentido del riesgo: alto.
    d1 = SESGO.INSTRUMENTOS["rob2"]["dominios"][0]
    assert SESGO.juzgar_dominio(d1, {"1.1": "Y", "1.2": "Y", "1.3": "N"})[0] == "bajo"
    assert SESGO.juzgar_dominio(d1, {"1.1": "N", "1.2": "Y", "1.3": "N"})[0] == "alto"
    assert SESGO.juzgar_dominio(d1, {"1.1": "PY", "1.2": "NI", "1.3": "PN"})[0] == "algunas_dudas"
    assert SESGO.juicio_global(["bajo", "bajo"]) == "bajo"
    assert SESGO.juicio_global(["bajo", "algunas_dudas"]) == "algunas_dudas"
    assert SESGO.juicio_global(["algunas_dudas"] * 3) == "alto" and SESGO.juicio_global(["bajo", "alto"]) == "alto"
    ev = SESGO.evaluar("rob2", [{"id": "1.1", "respuesta": "yes", "cita": "computer generated"}, {"id": "5.1", "respuesta": "N", "cita": "no protocol"}], "juez-x", 1)
    assert ev["instrumento"] == "RoB 2" and len(ev["dominios"]) == 5 and ev["dominios"][4]["juicio"] == "alto" and ev["global"] == "alto"
    assert ev["dominios"][0]["respuestas"][0]["respuesta"] == "Y"  # alias normalizado


def test_comprobacion_sesgo_por_regla():
    sin = SESGO.comprobacion_sesgo([{"id": "f1", "referencia": "A"}])
    assert sin["resultado"] == "no_comprobable"
    alto = {"instrumento": "RoB 2", "global": "alto"}
    bajo = {"instrumento": "ROBINS-I V2", "global": "bajo"}
    assert SESGO.comprobacion_sesgo([{"id": "f1", "referencia": "A", "riesgoSesgo": alto}, {"id": "f2", "referencia": "B", "riesgoSesgo": alto}])["resultado"] == "falla"
    ok = SESGO.comprobacion_sesgo([{"id": "f1", "referencia": "A", "riesgoSesgo": alto}, {"id": "f2", "referencia": "B", "riesgoSesgo": bajo}])
    assert ok["resultado"] == "pasa" and "1 con riesgo bajo" in ok["detalle"]
    assert "sin evaluar" in SESGO.texto_para_grade([]) and "1 fuentes alto" in SESGO.texto_para_grade([{"riesgoSesgo": alto}])


def test_sintetico_conserva_forma_y_no_valores(tmp_path: Path):
    real = tmp_path / "real.csv"
    filas = [["id_paciente", "grupo", "edad", "gfap", "fecha", "apoe4"]]
    for i in range(30):
        filas.append([f"PAC{i:03d}", "AD" if i % 2 else "CTRL", str(60 + i), f"{100 + i * 3.5:.1f}", f"2021-0{1 + i % 9}-1{i % 9}", str(i % 2)])
    with open(real, "w", newline="") as f:
        csv.writer(f).writerows(filas)
    destino = tmp_path / "sint.csv"
    perfil = SINT.generar(real, destino, filas=50, semilla=3)
    with open(destino) as f:
        sint = list(csv.reader(f))
    assert sint[0] == filas[0] and len(sint) == 51
    tipos = {p["columna"]: p["tipo"] for p in perfil["perfil"]}
    assert tipos == {"id_paciente": "identificador", "grupo": "categorica", "edad": "numerica", "gfap": "numerica", "fecha": "fecha", "apoe4": "binaria"}
    edades = [float(r[2]) for r in sint[1:] if r[2]]
    assert min(edades) >= 60 and max(edades) <= 89
    assert {r[1] for r in sint[1:] if r[1]} <= {"AD", "CTRL"}
    assert not any(r[0] == "PAC005" for r in sint[1:])  # identificadores nuevos, no los reales
    with pytest.raises(ValueError):
        SINT.generar(tmp_path / "no.txt", destino) if not (tmp_path / "no.txt").write_text("texto libre sin tabla") else SINT.generar(tmp_path / "no.txt", destino)


def test_prisma_2020_desde_el_estado():
    e = P.estado_inicial()
    A.crear_investigacion(e, {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}, 1)
    inv = e["investigaciones"][0]
    c = P.nueva_corrida(inv["id"], 1, 1) if hasattr(P, "nueva_corrida") else None
    if c is None:
        pytest.skip("sin fabrica de corrida")
    c["busqueda"]["consultas"] = [{"base": "PubMed", "consulta": "GFAP AND Alzheimer", "fecha": 1000, "resultados": 120, "iteracion": 1, "tema": "GFAP"}, {"base": "ClinicalTrials.gov", "consulta": "GFAP", "fecha": 1000, "resultados": 4, "iteracion": 1, "tema": "GFAP"}]
    c["busqueda"]["identificados"] = 124
    c["busqueda"]["traidos"] = 12
    c["busqueda"]["cribados"] = 8
    c["busqueda"]["excluidos"] = [{"referencia": "X 2020", "relevancia": 2, "motivo": "otra enfermedad", "iteracion": 1, "consulta": "GFAP", "base": "PubMed"}] * 4
    c["_fuentes"] = {f"f{i}": {"id": f"f{i}", "referencia": f"R{i}", "extraida": i < 6, "textoCompleto": i < 3, "retraccion": "retractado" if i == 11 else None} for i in range(12)}
    e["corridas"].append(c)
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="H", enunciado="E", mecanismo="M")
    h["procedencia"]["fuentes"] = [{"id": "f0"}, {"id": "f1"}]
    e["hipotesis"].append(h)
    r = PRISMA.informe(e, c, [{"rol": "volumen", "modelo": "anthropic/claude-sonnet-5"}, {"rol": "juez", "modelo": "anthropic/claude-opus-5"}], 2000)
    f = r["flujo"]
    assert f["database_results"] == 120 and f["register_results"] == 4 and f["records_screened"] == 12 and f["records_excluded"] == 4
    assert f["dbr_sought_reports"] == 8 and f["dbr_assessed"] == 6 and f["new_studies"] == 2 and f["excluded_other"] == 1
    assert f["dbr_excluded"] == {"sin afirmaciones usadas en ninguna hipótesis": 4}
    assert r["prisma"] == "2020" and "PRISMA 2026" not in r["markdown"].split("no existe")[0]
    assert r["traIce"]["M2_modelos"]["cribado"] == ["anthropic/claude-sonnet-5"] and r["traIce"]["M7_umbrales"]["relevanciaMinima"] == 5
    assert "## Ítem 16a" in r["markdown"] and "records_screened | 12" in r["markdown"] and "otra enfermedad" in r["markdown"]
    assert len(r["items"]["16b_excluidos_con_motivo"]) == 4


def test_conocimiento_operativo_entra_con_su_clase():
    e = P.estado_inicial()
    A.crear_investigacion(e, {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}, 1)
    inv = e["investigaciones"][0]
    assert A.anadir_conocimiento_operativo(e, inv["id"], "El lote 2024-B del anticuerpo anti-GFAP da fondo alto en plasma", "reactivo", "Dra. X", 5)
    assert not A.anadir_conocimiento_operativo(e, inv["id"], "corto", "reactivo", "Dra. X", 5)
    assert not A.anadir_conocimiento_operativo(e, inv["id"], "texto suficientemente largo", "chisme", "Dra. X", 5)
    x = inv["conocimientoOperativo"][0]
    assert x["clase"] == "conocimiento_operativo" and x["tipo"] == "reactivo"
    from rosa.bucle.pasos import _texto_mision

    assert "Conocimiento operativo del laboratorio" in _texto_mision(inv) and "anti-GFAP" in _texto_mision(inv)
    assert A.quitar_conocimiento_operativo(e, inv["id"], x["id"]) and inv["conocimientoOperativo"] == []


def test_prisma_preserva_totales_desconocidos_y_cobertura_parcial():
    e = P.estado_inicial()
    A.crear_investigacion(e, {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}, 1)
    inv = e["investigaciones"][0]
    c = P.nueva_corrida(inv["id"], 1, 1)
    c["busqueda"]["consultas"] = [
        {"base": "Scopus", "consulta": "q1", "fecha": 1, "resultados": 12, "estado": "completa"},
        {"base": "Scopus", "consulta": "q2", "fecha": 2, "resultados": None, "recuperados": 3, "estado": "parcial", "limitaciones": ["Descubrimiento web"]},
        {"base": "Embase", "consulta": "q3", "fecha": 3, "resultados": None, "recuperados": 0, "estado": "no_comprobado", "error": "HTTP 403"},
        {"base": "ClinicalTrials.gov", "consulta": "q4", "fecha": 4, "resultados": 4},
    ]
    r = PRISMA.informe(e, c, [], 2000)
    assert r["flujo"]["database_results"] is None and r["flujo"]["register_results"] == 4
    assert r["flujo"]["_notas"]["resultadosConocidosEnBases"] == 12
    bases = {x["base"]: x for x in r["items"]["6_fuentes_de_informacion"]}
    assert bases["Scopus"]["resultados"] is None and bases["Scopus"]["resultadosConocidos"] == 12
    assert bases["Scopus"]["consultasParciales"] == 1 and bases["Embase"]["consultasNoComprobadas"] == 1
    assert "None resultados" not in r["markdown"] and "None registros" not in r["markdown"]
    assert "database_results | total no comprobado" in r["markdown"]
    assert "3 candidatos recuperados" in r["markdown"] and "HTTP 403" in r["markdown"]


def test_prisma_descubrimiento_web_no_se_atribuye_al_indice_privado():
    c = {"busqueda": {"consultas": [
        {"base": "Scopus", "resultados": 12, "modoAcceso": "api_directa"},
        {"base": "Embase", "resultados": None, "recuperados": 3, "estado": "parcial", "modoAcceso": "descubrimiento_web"},
        {"base": "Google Scholar", "resultados": 4, "modoAcceso": "indice_scholar"},
    ]}}
    r = PRISMA.flujo_prisma2020(c, {}, [])
    assert r["database_results"] == 16 and r["website_results"] is None and r["register_results"] == 0
