"""Traducción de revisiones de tratamiento sin ampliar su certeza o alcance."""

import pytest

from rosa import traductor as T


@pytest.mark.parametrize("original,ingles", [
    ("La solicitud de patente está publicada.", "The patent application has been published."),
    ("Se leyeron las reivindicaciones de la solicitud de patente.", "The claims of the patent application were reviewed."),
    ("La familia de patentes comparte prioridad.", "The patent family shares a priority claim."),
    ("Las familias de patentes pueden tener reivindicaciones distintas.", "Patent families may have different claims."),
    ("El estado jurídico requiere revisar el registro.", "The legal status requires checking the register."),
    ("No acredita libertad de operación.", "This does not establish freedom to operate."),
    ("No comprobado: la fuente no respondió.", "Not checked: the source did not respond."),
    ("Sin coincidencias públicas en las fuentes consultadas.", "No public matches in the sources searched."),
    ("No se encontraron patentes en las bases consultadas.", "No patents were found in the databases searched."),
    ("Exclusividad regulatoria y patente son conceptos distintos.", "Regulatory exclusivity and a patent are different concepts."),
    ("La diana coincide; el compuesto y la indicación son distintos.", "The target matches; the compound and indication differ."),
])
def test_preserva_terminologia_y_alcance(original, ingles):
    assert T.comprobar(original, ingles) is None


@pytest.mark.parametrize("original,ingles", [
    ("La solicitud de patente está publicada.", "The patent has been granted."),
    ("La solicitud de patente está publicada.", "The treatment is patented."),
    ("Se leyeron las reivindicaciones.", "The allegations were reviewed."),
    ("La familia de patentes comparte prioridad.", "The patent household shares a priority claim."),
    ("El estado jurídico requiere revisión.", "The clinical status requires review."),
    ("No acredita libertad de operación.", "This does not establish an operating license."),
    ("No comprobado: el registro no respondió.", "There are no competing programs."),
    ("Sin coincidencias públicas en las fuentes consultadas.", "No company has ever tested this treatment."),
    ("Sin coincidencias públicas.", "No patents exist."),
    ("No se encontraron patentes en las fuentes consultadas.", "No patents exist."),
    ("Exclusividad regulatoria.", "Patent exclusivity."),
])
def test_rechaza_traduccion_literal_y_ausencia_universal(original, ingles):
    assert T.comprobar(original, ingles) is not None


@pytest.mark.parametrize("ingles", [
    "The compound was tested in NCT12345678; see US12345679B2 and https://patents.google.com/patent/US12345678B2/en.",
    "The compound was tested in NCT87654321; see US12345678B2 and https://patents.google.com/patent/US12345678B2/en.",
    "The compound was tested in NCT12345678; see US12345678B2 and https://patents.google.com/patent/US12345679B2/en.",
])
def test_identificadores_y_url_son_literales(ingles):
    original = "El compuesto se probó en NCT12345678; ver US12345678B2 y https://patents.google.com/patent/US12345678B2/en."
    assert T.comprobar(original, ingles) is not None


def test_cita_literal_en_prosa_no_se_traduce():
    original = "La reivindicación dice `A pharmaceutical composition comprising compound X`."
    correcta = "The claim states `A pharmaceutical composition comprising compound X`."
    alterada = "The claim states `A medicine containing compound X`."
    assert T.comprobar(original, correcta) is None
    assert T.comprobar(original, alterada) is not None


def test_cache_previa_no_elude_reglas_nuevas(tmp_path):
    c = T.Cache(tmp_path / "traducciones.db")
    original = "Sin coincidencias públicas en las fuentes consultadas."
    c.guardar({original: "No company has ever tested this treatment."}, "modelo-anterior")
    assert T.traducir([original], llamar=None, almacen=c)["traducciones"] == {}


def test_traduccion_dinamica_acepta_prosa_y_rechaza_sobreafirmacion(tmp_path):
    c = T.Cache(tmp_path / "traducciones.db")
    respuestas = {
        "La diana coincide; el compuesto es distinto.": "The target matches; the compound differs.",
        "No comprobado: la fuente no respondió.": "There are no patents.",
        "La solicitud de patente está publicada.": "The patent has been granted.",
    }
    r = T.traducir(list(respuestas), llamar=lambda lote: {s: respuestas[s] for s in lote}, almacen=c)
    assert r["traducciones"] == {"La diana coincide; el compuesto es distinto.": respuestas["La diana coincide; el compuesto es distinto."]}
    assert len(r["rechazadas"]) == 2 and c.cuantas() == 1
