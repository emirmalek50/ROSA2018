"""El visor de citas: que el resaltado caiga exactamente sobre el pasaje, que
lo que falta se diga, y que no se sirva ningún fichero fuera del directorio de
PDF."""

from __future__ import annotations

from pathlib import Path

import pytest

from rosa import citas as C


PAGINA = (
    "Plasma GFAP is an early marker of amyloid beta\n\n"
    "In the discovery cohort, plasma GFAP concentrations were higher in amyloid beta positive participants.\n\n"
    "Plasma GFAP was associated with amyloid beta PET burden independently of tau PET, whereas plasma p-tau181 "
    "showed the opposite pattern.\n\n"
    "These associations remained significant after adjusting for age, sex and APOE epsilon 4 carriership.\n"
)


def test_el_resaltado_cae_sobre_el_pasaje_exacto():
    pasaje = "Plasma GFAP was associated with amyloid beta PET burden independently of tau PET"
    m = C.marcar_pasaje(PAGINA, pasaje)
    assert m["completo"] is True
    assert m["falta"] is None
    assert len(m["tramos"]) == 1
    t = m["tramos"][0]
    # El rango es del texto original, con sus mayúsculas: se puede pintar tal cual.
    assert PAGINA[t["inicio"]:t["fin"]] == pasaje
    assert t["texto"] == pasaje


def test_el_pasaje_con_tildes_ligaduras_y_mayusculas_se_encuentra_igual():
    texto = "La proteína ﬁbrilar GLIAL Ácida sube en el plasma."
    m = C.marcar_pasaje(texto, "proteina fibrilar glial acida")
    # Con la ligadura "ﬁ" el texto tiene una letra menos que la comparación:
    # por eso el resaltado se ancla en palabras, no en desplazamientos.
    assert m["completo"] is True
    assert texto[m["tramos"][0]["inicio"]:m["tramos"][0]["fin"]] == "proteína ﬁbrilar GLIAL Ácida"


def test_una_cita_con_elision_marca_los_dos_tramos_y_exige_el_orden():
    pasaje = "In the discovery cohort ... adjusting for age, sex and APOE"
    m = C.marcar_pasaje(PAGINA, pasaje)
    assert m["completo"] is True
    assert len(m["tramos"]) == 2
    assert m["tramos"][0]["texto"].startswith("In the discovery cohort")
    assert m["tramos"][1]["texto"].endswith("APOE")
    assert m["tramos"][0]["fin"] < m["tramos"][1]["inicio"]
    # Los mismos tramos en orden inverso no valen: el segundo ya no está detrás.
    alreves = C.marcar_pasaje(PAGINA, "adjusting for age, sex and APOE ... In the discovery cohort")
    assert alreves["completo"] is False
    assert alreves["falta"] is not None


def test_lo_que_no_esta_se_dice_y_se_conserva_lo_que_si():
    pasaje = "Plasma GFAP was associated with amyloid beta PET burden ... in ninety per cent of participants"
    m = C.marcar_pasaje(PAGINA, pasaje)
    assert m["completo"] is False
    assert m["falta"] == "in ninety per cent of participants"
    # El primer tramo sí estaba: se enseña lo que hay y se dice lo que falta.
    assert len(m["tramos"]) == 1


def test_los_numeros_de_linea_de_un_preprint_no_rompen_el_resaltado():
    # PyMuPDF deja el número de línea entre las palabras; el verificador lo
    # quita en su normalización y aquí se salta al comparar.
    texto = "plasma GFAP was 311 associated with amyloid burden"
    m = C.marcar_pasaje(texto, "plasma GFAP was associated with amyloid burden")
    assert m["completo"] is True
    assert texto[m["tramos"][0]["inicio"]:m["tramos"][0]["fin"]] == texto.strip()


def test_una_palabra_cambiada_no_pasa_por_mucho_que_se_parezca():
    m = C.marcar_pasaje(PAGINA, "Plasma GFAP was associated with amyloid beta PET burden depending on tau PET")
    assert m["completo"] is False
    assert m["falta"] is not None


def test_un_pasaje_vacio_o_un_texto_vacio_no_marcan_nada_ni_revientan():
    assert C.marcar_pasaje(PAGINA, "")["completo"] is False
    assert C.marcar_pasaje("", "algo")["completo"] is False
    assert C.marcar_pasaje("", "")["tramos"] == []


def corrida_de_prueba(tmp_path: Path | None = None) -> dict:
    fragmentos = [
        {"localizador": "resumen", "texto": "Resumen del artículo.", "encabezado": "Resumen"},
        {"localizador": "pág. 3508", "texto": PAGINA, "encabezado": "Resultados"},
        {"localizador": "pág. 3509", "texto": "Otra página.", "encabezado": "Discusión"},
    ]
    if tmp_path is not None:
        pdf = tmp_path / "abc.pdf"
        pdf.write_bytes(b"%PDF-1.4 falso")
        fragmentos[1]["_ruta"] = str(pdf)
    return {
        "id": "cor-1",
        "_fuentes": {
            "f-1": {
                "id": "f-1",
                "referencia": "Pereira et al., 2021",
                "titulo": "Plasma GFAP is an early marker",
                "doi": "10.1093/brain/awab223",
                "anio": 2021,
                "fragmentos": fragmentos,
            }
        },
        "_afirmaciones": [
            {
                "id": "af-1",
                "texto": "El GFAP en plasma se asocia a la carga amiloide, con independencia de la tau.",
                "cita": "[Pereira et al., 2021, pág. 3508]",
                "fragmento": "Plasma GFAP was associated with amyloid beta PET burden independently of tau PET",
                "veredicto": "sostenida",
                "motivo": "Literal en la página.",
                "fuenteId": "f-1",
                "localizador": "pág. 3508",
                "tipo": "literatura",
                "iteracion": 2,
            },
            {
                "id": "af-2",
                "texto": "Afirmación sobre el resumen.",
                "cita": "[Pereira et al., 2021, resumen]",
                "fragmento": "Resumen del artículo",
                "veredicto": "parcial",
                "fuenteId": "f-1",
                "localizador": "resumen",
                "tipo": "literatura",
                "iteracion": 1,
            },
        ],
    }


def test_la_ficha_trae_la_pagina_el_pasaje_marcado_y_las_otras_paginas_leidas():
    f = C.ficha(corrida_de_prueba(), "af-1")
    assert f is not None
    assert f["clase"] == "pagina"
    assert f["pagina"] == 3508
    assert f["texto"] == PAGINA
    assert f["completo"] is True
    assert f["encabezado"] == "Resultados"
    assert f["fuente"]["referencia"] == "Pereira et al., 2021"
    assert f["afirmacion"]["veredicto"] == "sostenida"
    # Las otras lecturas de la misma fuente, con la actual marcada.
    localizadores = [x["localizador"] for x in f["leidos"]]
    assert localizadores == ["resumen", "pág. 3508", "pág. 3509"]
    assert [x["actual"] for x in f["leidos"]] == [False, True, False]
    assert [x["pagina"] for x in f["leidos"]] == [None, 3508, 3509]


def test_la_ficha_de_una_afirmacion_que_no_existe_es_nula():
    assert C.ficha(corrida_de_prueba(), "af-99") is None


def test_una_cita_al_resumen_o_al_texto_web_se_marca_como_lo_que_es():
    f = C.ficha(corrida_de_prueba(), "af-2")
    assert f["clase"] == "resumen"
    assert f["pagina"] is None
    assert f["conPdf"] is False


def test_la_lista_dice_de_que_se_apoya_cada_afirmacion_y_si_hay_pagina(tmp_path: Path):
    filas = C.lista(corrida_de_prueba(tmp_path))
    assert [x["id"] for x in filas] == ["af-1", "af-2"]
    assert filas[0]["clase"] == "pagina" and filas[0]["conPdf"] is True
    assert filas[1]["clase"] == "resumen" and filas[1]["conPdf"] is False
    assert filas[0]["referencia"] == "Pereira et al., 2021"
    assert all(x["conTexto"] for x in filas)


def test_el_resumen_cuenta_por_veredicto_y_dice_cuantas_resuelven_a_pagina(tmp_path: Path):
    r = C.resumen(corrida_de_prueba(tmp_path))
    assert r["total"] == 2
    assert r["porVeredicto"] == {"sostenida": 1, "parcial": 1}
    assert r["porClase"] == {"pagina": 1, "resumen": 1}
    assert r["conPagina"] == 1
    assert r["conPdf"] == 1


def test_el_pdf_solo_se_sirve_desde_el_directorio_de_pdf(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from rosa import config

    corrida = corrida_de_prueba(tmp_path)
    # Con el directorio de PDF en otro sitio, la ruta del estado no basta:
    # el estado no decide qué ficheros sirve ROSA2018.
    monkeypatch.setattr(config, "DIR_PDFS", tmp_path / "otro")
    assert C.ruta_pdf(corrida, "af-1") is None
    monkeypatch.setattr(config, "DIR_PDFS", tmp_path)
    assert C.ruta_pdf(corrida, "af-1") == (tmp_path / "abc.pdf").resolve()
    # Una afirmación sin PDF no devuelve ruta.
    assert C.ruta_pdf(corrida, "af-2") is None


def test_un_camino_que_se_escapa_del_directorio_no_se_sirve(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from rosa import config

    fuera = tmp_path / "secreto.pdf"
    fuera.write_bytes(b"%PDF")
    corrida = corrida_de_prueba(tmp_path)
    pdfs = tmp_path / "pdfs"
    pdfs.mkdir()
    # La ruta del estado apunta fuera con un salto de directorio.
    corrida["_fuentes"]["f-1"]["fragmentos"][1]["_ruta"] = str(pdfs / ".." / "secreto.pdf")
    monkeypatch.setattr(config, "DIR_PDFS", pdfs)
    assert C.ruta_pdf(corrida, "af-1") is None


def test_una_corrida_sin_claves_privadas_no_revienta():
    assert C.lista({"id": "x"}) == []
    assert C.ficha({"id": "x"}, "af-1") is None
    assert C.resumen({"id": "x"})["total"] == 0
    assert C.lista({"id": "x", "_fuentes": [], "_afirmaciones": None}) == []
