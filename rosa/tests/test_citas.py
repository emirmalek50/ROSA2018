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


def corrida_con_texto_web() -> dict:
    """Una fuente con partes de texto web, como las que devuelve Exa. Es el
    caso que destapó que el veredicto guardado y la comprobación de hoy son
    señales distintas: la cita resuelve y el pasaje es literal, pero la
    afirmación se guardó bloqueada con un verificador anterior."""
    return {
        "id": "cor-2",
        "_fuentes": {
            "f-9": {
                "id": "f-9",
                "referencia": "Shcherbinin et al., 2022",
                "titulo": "Association of Amyloid Reduction",
                "fragmentos": [
                    {"localizador": "resumen", "texto": "Un resumen cualquiera."},
                    {"localizador": "texto web, parte 1", "texto": "El estudio TRAILBLAZER-ALZ evaluated amyloid reduction after donanemab treatment."},
                ],
            }
        },
        "_afirmaciones": [
            {
                "id": "af-web",
                "texto": "TRAILBLAZER-ALZ evaluó la reducción de amiloide.",
                "cita": "[Shcherbinin et al., 2022, texto web, parte 1]",
                "fragmento": "evaluated amyloid reduction after donanemab treatment",
                "veredicto": "cita_no_resuelve",
                "motivo": "La cita no apunta a ninguna fuente ni localizador conocidos.",
                "fuenteId": "f-9",
                "localizador": "texto web, parte 1",
                "iteracion": 1,
            },
            {
                "id": "af-inventada",
                "texto": "Una afirmación con un pasaje que no está.",
                "cita": "[Shcherbinin et al., 2022, texto web, parte 1]",
                "fragmento": "reduced mortality by ninety per cent",
                "veredicto": "no_sostenida",
                "fuenteId": "f-9",
                "localizador": "texto web, parte 1",
                "iteracion": 1,
            },
            {
                "id": "af-sitio-inexistente",
                "texto": "Una afirmación que cita un sitio que no existe.",
                "cita": "[Shcherbinin et al., 2022, pág. 12]",
                "fragmento": "El estudio TRAILBLAZER-ALZ",
                "veredicto": "cita_no_resuelve",
                "fuenteId": "f-9",
                "localizador": "pág. 12",
                "iteracion": 1,
            },
        ],
    }


def test_las_dos_senales_se_miden_por_separado():
    c = corrida_con_texto_web()
    frs = C._fragmentos_para_verificador(c)
    # El texto coincide con la fuente y la cita apunta a un sitio que existe.
    buena = C.comprobacion_de_hoy(c["_afirmaciones"][0], frs)
    assert buena["resuelve"] is True and buena["literal"] is True

    # La cita apunta a un sitio que existe, pero el pasaje no está ahí: una
    # señal en verde y la otra en rojo, que es justo lo que hay que poder decir.
    inventada = C.comprobacion_de_hoy(c["_afirmaciones"][1], frs)
    assert inventada["resuelve"] is True
    assert inventada["literal"] is False
    assert inventada["falta"] is not None

    # La cita apunta a una página que la fuente no tiene: no resuelve, y el
    # motivo lo dice nombrando los localizadores que sí tiene.
    sitio = C.comprobacion_de_hoy(c["_afirmaciones"][2], frs)
    assert sitio["resuelve"] is False
    assert sitio["literal"] is False
    assert "texto web, parte 1" in sitio["motivoResuelve"]


def test_un_bloqueo_de_una_version_anterior_del_verificador_se_marca_como_tal():
    c = corrida_con_texto_web()
    f = C.ficha(c, "af-web")
    # El veredicto guardado sigue siendo el que se tomó al extraerla: no se
    # reescribe aquí. Lo que se añade es lo que dicen hoy las dos señales.
    assert f["afirmacion"]["veredicto"] == "cita_no_resuelve"
    assert f["hoy"]["resuelve"] is True and f["hoy"]["literal"] is True
    assert f["bloqueoViejo"] is True
    # La que de verdad no resuelve hoy no se marca como bloqueo viejo.
    assert C.ficha(c, "af-sitio-inexistente")["bloqueoViejo"] is False
    # Una cuyo pasaje no está tampoco: su bloqueo sigue siendo correcto.
    assert C.ficha(c, "af-inventada")["bloqueoViejo"] is False


def test_el_resumen_cuenta_los_bloqueos_viejos_para_poder_recuperarlos():
    r = C.resumen(corrida_con_texto_web())
    assert r["total"] == 3
    assert r["bloqueosViejos"] == 1
    assert r["resuelvenHoy"] == 2
    assert r["literalesHoy"] == 1


def test_la_recomprobacion_no_promete_veredictos_solo_lo_que_comprueba():
    c = corrida_con_texto_web()
    hoy = C.comprobacion_de_hoy(c["_afirmaciones"][0], C._fragmentos_para_verificador(c))
    # Ni inventa un veredicto ni dice que sería sostenida: eso lo decide el juez.
    assert "veredicto" not in hoy
    assert set(hoy) == {"resuelve", "motivoResuelve", "literal", "falta", "localizadorAdmitido"}


def test_una_afirmacion_sin_cita_no_resuelve_y_lo_dice():
    hoy = C.comprobacion_de_hoy({"cita": "", "fragmento": "algo"}, [])
    assert hoy["resuelve"] is False
    assert "no lleva cita" in hoy["motivoResuelve"]


def corrida_con_identificador_que_falta() -> dict:
    """El caso que destapó que las dos señales de la cita no bastan: la cita
    resuelve, el pasaje está literal, y aun así el verificador la bloquea
    porque la afirmación nombra un ensayo que no aparece en el fragmento."""
    return {
        "id": "cor-3",
        "_fuentes": {
            "f-3": {
                "id": "f-3",
                "referencia": "Sims et al., 2023",
                "titulo": "Donanemab en Alzheimer precoz",
                "fragmentos": [{"localizador": "texto web, parte 1", "texto": "Donanemab reduced amyloid plaques in participants with early Alzheimer disease."}],
            }
        },
        "_afirmaciones": [
            {
                "id": "af-id",
                "texto": "En el ensayo NCT04437511, donanemab redujo las placas de amiloide.",
                "cita": "[Sims et al., 2023, texto web, parte 1]",
                "fragmento": "Donanemab reduced amyloid plaques",
                "veredicto": "cita_no_resuelve",
                "fuenteId": "f-3",
                "localizador": "texto web, parte 1",
                "iteracion": 1,
            },
            {
                "id": "af-limpia",
                "texto": "Donanemab redujo las placas de amiloide.",
                "cita": "[Sims et al., 2023, texto web, parte 1]",
                "fragmento": "Donanemab reduced amyloid plaques",
                "veredicto": "cita_no_resuelve",
                "fuenteId": "f-3",
                "localizador": "texto web, parte 1",
                "iteracion": 1,
            },
        ],
    }


def test_una_cita_en_orden_no_basta_para_decir_que_hoy_resolveria():
    c = corrida_con_identificador_que_falta()
    frs = C._fragmentos_para_verificador(c)
    conflictiva = c["_afirmaciones"][0]
    # Las dos señales de la cita están bien...
    senales = C.comprobacion_de_hoy(conflictiva, frs)
    assert senales["resuelve"] is True and senales["literal"] is True
    # ...y aun así el verificador de hoy la sigue bloqueando, por el ensayo
    # que la afirmación nombra y que no está en el fragmento.
    hoy = C.bloquea_hoy(conflictiva, frs)
    assert hoy["bloquea"] is True
    assert "NCT04437511" in hoy["motivo"]
    # Por eso NO se marca como bloqueo viejo: contarla sería inflar la cifra.
    assert C.ficha(c, "af-id")["bloqueoViejo"] is False
    # La misma afirmación sin ese identificador sí se recupera.
    assert C.ficha(c, "af-limpia")["bloqueoViejo"] is True


def test_el_resumen_separa_las_dos_cuentas_que_no_son_la_misma():
    r = C.resumen(corrida_con_identificador_que_falta())
    # Las dos tienen la cita en orden, pero solo una deja de estar bloqueada.
    assert r["bloqueadasConCitaEnOrden"] == 2
    assert r["bloqueosViejos"] == 1
    assert r["conCitaEnOrden"] == 2


@pytest.mark.asyncio
async def test_reverificar_pasa_por_el_mismo_camino_que_el_bucle(monkeypatch: pytest.MonkeyPatch):
    """La reverificación no es una copia del verificador: usa el mismo paso del
    bucle, así que el veredicto que sale es el que saldría en una iteración."""
    from rosa import citas as CI

    c = corrida_con_texto_web()
    c["estado"] = "terminada"
    c["investigacionId"] = "inv-1"
    estado = {"corridas": [c], "iteraciones": [{"id": "it-1", "corridaId": "cor-2", "numero": 3}], "investigaciones": [{"id": "inv-1", "objetivo": "Un objetivo"}]}

    class AlmacenFalso:
        def __init__(self):
            self.estado = estado

    vistas: dict = {}

    async def verificar_falso(ctx, afirmaciones, pista, pregunta):
        vistas["ids"] = [a["id"] for a in afirmaciones]
        vistas["numero"] = ctx.numero
        vistas["corrida"] = ctx.corrida_id
        vistas["pregunta"] = pregunta
        for a in afirmaciones:
            a["veredicto"], a["motivo"] = "sostenida", "El juez la sostiene."
        return {"sostenida": len(afirmaciones)}

    from rosa.bucle import pasos as PASOS

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", verificar_falso)
    r = await CI.reverificar(AlmacenFalso(), object(), object(), "cor-2")
    assert r["ok"] is True
    # Solo van las que hoy ya no bloquearían: la del pasaje que no está en la
    # fuente y la que cita una página inexistente se quedan fuera.
    assert vistas["ids"] == ["af-web"]
    assert vistas["numero"] == 3 and vistas["corrida"] == "cor-2"
    assert vistas["pregunta"] == "Un objetivo"
    assert r["revisadas"] == 1 and r["desbloqueadas"] == 1
    assert c["_afirmaciones"][0]["veredicto"] == "sostenida"
    # Las que siguen caídas por otra razón no se tocan.
    assert c["_afirmaciones"][1]["veredicto"] == "no_sostenida"


@pytest.mark.asyncio
async def test_no_se_reverifica_una_corrida_que_esta_trabajando():
    """Dos manos escribiendo las mismas afirmaciones es justo lo que no se
    hace: se dice y no se toca nada."""
    from rosa import citas as CI

    c = corrida_con_texto_web()
    c["estado"] = "en_marcha"
    c["investigacionId"] = "inv-1"

    class AlmacenFalso:
        estado = {"corridas": [c], "iteraciones": [], "investigaciones": []}

    r = await CI.reverificar(AlmacenFalso(), object(), object(), "cor-2")
    assert r["ok"] is False
    assert "trabajando" in r["motivo"]
    assert c["_afirmaciones"][0]["veredicto"] == "cita_no_resuelve"


@pytest.mark.asyncio
async def test_sin_nada_que_recuperar_lo_dice_y_no_llama_a_nadie(monkeypatch: pytest.MonkeyPatch):
    from rosa import citas as CI
    from rosa.bucle import pasos as PASOS

    c = corrida_de_prueba()
    c["estado"] = "terminada"
    c["investigacionId"] = "inv-1"

    class AlmacenFalso:
        estado = {"corridas": [c], "iteraciones": [], "investigaciones": [{"id": "inv-1", "objetivo": "x"}]}

    async def no_llamar(*a, **k):
        raise AssertionError("no debía llamarse a nadie")

    monkeypatch.setattr(PASOS, "verificar_afirmaciones", no_llamar)
    r = await CI.reverificar(AlmacenFalso(), object(), object(), "cor-1")
    assert r["ok"] is True and r["revisadas"] == 0


@pytest.mark.asyncio
async def test_una_corrida_desconocida_no_revienta():
    from rosa import citas as CI

    class AlmacenFalso:
        estado = {"corridas": [], "iteraciones": [], "investigaciones": []}

    r = await CI.reverificar(AlmacenFalso(), object(), object(), "no-existe")
    assert r["ok"] is False and "desconocida" in r["motivo"]


# ---------------------------------------------------------------------------
# La página del PDF con el pasaje pintado encima.
#
# Nació el 22 de septiembre de 2026, midiendo por qué "ver la cita" abría el
# PDF por la página buena y sin marcar nada. La causa no era el pasaje ni la
# página: el visor de PDF de Chrome solo lee `nameddest`, `navpanes`, `page`,
# `toolbar`, `view` y `zoom` (chrome/browser/resources/pdf/
# open_pdf_params_parser.ts), y tira `search=` sin decir nada. Como el PDF lo
# sirve ROSA2018, la marca la pone ROSA2018.


def pdf_de_prueba(ruta: Path, paginas: list[str]) -> Path:
    """Un PDF de verdad, con una línea de texto por página."""
    import pymupdf

    documento = pymupdf.open()
    for texto in paginas:
        pagina = documento.new_page(width=420, height=300)
        pagina.insert_text((40, 80), texto, fontsize=11)
    documento.save(ruta)
    documento.close()
    return ruta


def corrida_con_pdf_de_verdad(tmp_path: Path, pagina_citada: str = "pág. 2") -> dict:
    pdfs = tmp_path / "pdfs"
    pdfs.mkdir(exist_ok=True)
    pdf = pdf_de_prueba(
        pdfs / "articulo.pdf",
        [
            "Página primera sin nada que marcar aquí.",
            "Plasma GFAP was associated with amyloid burden.",
            "Página tercera con otra cosa distinta.",
        ],
    )
    return {
        "id": "cor-1",
        "_fuentes": {
            "f-1": {
                "id": "f-1",
                "referencia": "Pereira et al., 2021",
                "fragmentos": [
                    {
                        "localizador": pagina_citada,
                        "texto": "Plasma GFAP was associated with amyloid burden.",
                        "encabezado": "Resultados",
                        "_ruta": str(pdf),
                    }
                ],
            }
        },
        "_afirmaciones": [
            {
                "id": "af-1",
                "texto": "El GFAP en plasma se asocia a la carga amiloide.",
                "cita": f"[Pereira et al., 2021, {pagina_citada}]",
                "fragmento": "Plasma GFAP was associated with amyloid burden",
                "veredicto": "sostenida",
                "fuenteId": "f-1",
                "localizador": pagina_citada,
                "tipo": "literatura",
                "iteracion": 1,
            }
        ],
    }


def test_la_pagina_del_pdf_llega_pintada_con_el_pasaje(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from rosa import config

    monkeypatch.setattr(config, "DIR_PDFS", tmp_path / "pdfs")
    hecho = C.pagina_marcada(corrida_con_pdf_de_verdad(tmp_path), "af-1")
    assert hecho is not None
    png, info = hecho
    assert png.startswith(b"\x89PNG")
    assert info["pagina"] == 2
    assert info["marcado"] is True
    assert info["completo"] is True
    # Siete palabras en el pasaje, siete rectángulos que pintar.
    assert info["palabras"] == 7
    assert info["falta"] is None


def test_la_marca_del_pdf_y_la_del_texto_dicen_lo_mismo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """La regla es una sola: si el panel de texto da el pasaje por encontrado,
    la página lo pinta, y si no, ninguno de los dos. Medido el 22 de
    septiembre de 2026 sobre las 203 citas con PDF de la corrida 16: coinciden
    en 203 de 203."""
    from rosa import config

    monkeypatch.setattr(config, "DIR_PDFS", tmp_path / "pdfs")
    corrida = corrida_con_pdf_de_verdad(tmp_path)
    for pasaje, esperado in [
        ("Plasma GFAP was associated with amyloid burden", True),
        ("Plasma GFAP was associated with tau burden", False),
    ]:
        corrida["_afirmaciones"][0]["fragmento"] = pasaje
        del_texto = C.ficha(corrida, "af-1")
        del_pdf = C.pagina_marcada(corrida, "af-1")
        assert del_texto is not None and del_pdf is not None
        assert del_texto["completo"] is esperado
        assert del_pdf[1]["completo"] is esperado


def test_una_pagina_que_no_lleva_el_pasaje_se_enseña_igual_y_se_dice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Enseñar la página sin marca es lo que permite discutir el veredicto;
    esconderla, no."""
    from rosa import config

    monkeypatch.setattr(config, "DIR_PDFS", tmp_path / "pdfs")
    corrida = corrida_con_pdf_de_verdad(tmp_path, pagina_citada="pág. 3")
    corrida["_fuentes"]["f-1"]["fragmentos"][0]["texto"] = "Página tercera con otra cosa distinta."
    hecho = C.pagina_marcada(corrida, "af-1")
    assert hecho is not None
    png, info = hecho
    assert png.startswith(b"\x89PNG")
    assert info["pagina"] == 3
    assert info["marcado"] is False
    assert info["falta"]


def test_un_numero_de_pagina_fuera_del_pdf_busca_el_pasaje_en_vez_de_inventar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Una página que no existe en el PDF no dice dónde mirar. Antes que
    enseñar la primera y callarse, se busca el pasaje por el documento."""
    from rosa import config

    monkeypatch.setattr(config, "DIR_PDFS", tmp_path / "pdfs")
    corrida = corrida_con_pdf_de_verdad(tmp_path, pagina_citada="pág. 3508")
    hecho = C.pagina_marcada(corrida, "af-1")
    assert hecho is not None
    _, info = hecho
    assert info["paginaDeclarada"] is False
    assert info["pagina"] == 2
    assert info["marcado"] is True


def test_sin_pdf_guardado_no_hay_pagina_que_pintar():
    assert C.pagina_marcada(corrida_de_prueba(), "af-1") is None


def test_los_rectangulos_del_pasaje_caen_sobre_las_palabras_del_pasaje(tmp_path: Path):
    """Lo que se pinta cae donde está el texto, no en cualquier sitio: los
    rectángulos tienen que estar dentro de la página y en orden de lectura."""
    import pymupdf

    pdf = pdf_de_prueba(tmp_path / "uno.pdf", ["Plasma GFAP was associated with amyloid burden."])
    documento = pymupdf.open(pdf)
    hallado = C.rectangulos_del_pasaje(documento[0], "GFAP was associated")
    caja = documento[0].rect
    assert len(hallado["rectangulos"]) == 3
    for x0, y0, x1, y1 in hallado["rectangulos"]:
        assert caja.x0 <= x0 < x1 <= caja.x1
        assert caja.y0 <= y0 < y1 <= caja.y1
    # En orden de lectura: cada palabra empieza a la derecha de la anterior.
    equis = [r[0] for r in hallado["rectangulos"]]
    assert equis == sorted(equis)
    documento.close()


def test_un_pdf_roto_no_se_confunde_con_un_pdf_que_falta(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Dos cosas distintas, dos respuestas distintas: si se juntaran, un fallo
    quedaría escondido detrás de una ausencia."""
    from rosa import config

    pdfs = tmp_path / "pdfs"
    pdfs.mkdir()
    roto = pdfs / "roto.pdf"
    roto.write_bytes(b"%PDF-1.4 esto no es un PDF")
    monkeypatch.setattr(config, "DIR_PDFS", pdfs)
    corrida = corrida_con_pdf_de_verdad(tmp_path)
    corrida["_fuentes"]["f-1"]["fragmentos"][0]["_ruta"] = str(roto)
    with pytest.raises(C.PdfIlegible):
        C.pagina_marcada(corrida, "af-1")


def test_el_resaltado_del_pdf_es_un_trazo_por_linea_y_no_una_fila_de_cajitas():
    """Palabra a palabra el resaltado sale a huecos y se lee mal. Se unen las
    de una misma línea; las de líneas distintas, nunca."""
    # Tres palabras seguidas en una línea y una cuarta en la de abajo.
    rectangulos = [(10.0, 20.0, 30.0, 32.0), (33.0, 20.0, 50.0, 32.0), (53.0, 20.0, 70.0, 32.0), (10.0, 40.0, 28.0, 52.0)]
    unidos = C._unir_por_linea(rectangulos)
    assert len(unidos) == 2
    assert unidos[0] == (10.0, 20.0, 70.0, 32.0)
    assert unidos[1] == (10.0, 40.0, 28.0, 52.0)


def test_dos_palabras_lejos_en_la_misma_linea_no_se_unen_cruzando_el_hueco():
    """Un salto de columna no es un espacio: si se uniera, el trazo taparía
    texto que no se citó."""
    unidos = C._unir_por_linea([(10.0, 20.0, 30.0, 32.0), (300.0, 20.0, 330.0, 32.0)])
    assert len(unidos) == 2
