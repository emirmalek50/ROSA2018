"""Regresiones científicas compartidas con la interfaz; nunca llaman al modelo."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from rosa import traductor as T
from rosa.terminologia_traduccion import REVISADAS

CASOS = json.loads(
    Path(__file__).with_name("casos_traduccion_cientifica.json").read_text()
)


@pytest.mark.parametrize("caso", CASOS, ids=[c["nombre"] for c in CASOS])
def test_preserva_significado_y_datos(caso):
    fallo = T.comprobar(caso["original"], caso["traducido"])
    assert (fallo is None) == caso["valida"], fallo


def test_traducciones_revisadas_respetan_el_contrato():
    for original, traducido in REVISADAS.items():
        assert T.comprobar(original.split("\x04")[-1], traducido) is None, original


def test_cache_antigua_no_salta_la_validacion(tmp_path):
    c = T.Cache(tmp_path / "cache.db")
    original = "Dosis de 20 µM"
    c.guardar({original: "Dose of 20 mM"}, "modelo-antiguo")
    assert T.traducir([original], llamar=None, almacen=c)["traducciones"] == {}
    # Revalidar es lectura: no modifica el original ni borra la fila histórica.
    with sqlite3.connect(c.ruta) as db:
        assert db.execute("SELECT origen, ingles FROM traducciones").fetchall() == [
            (original, "Dose of 20 mM")
        ]
    r = T.traducir([original], llamar=lambda _: {original: "Dose of 20 µM"}, almacen=c)
    assert r["traducciones"] == {original: "Dose of 20 µM"}
    assert c.leer([original]) == r["traducciones"]


def test_terminologia_revisada_prevalece_sin_pagar_modelo(tmp_path):
    c = T.Cache(tmp_path / "cache.db")
    c.guardar({"Puerta de reproducción": "Replication gate"}, "modelo-antiguo")

    def no_llamar(_):
        pytest.fail("Una corrección revisada no necesita otra llamada")

    r = T.traducir(["Puerta de reproducción"], llamar=no_llamar, almacen=c)
    assert r["traducciones"] == {"Puerta de reproducción": "Reproducibility gate"}


def test_modelo_no_guarda_traducciones_que_alteran_ciencia(tmp_path):
    c = T.Cache(tmp_path / "cache.db")
    malas = {
        p["original"]: p["traducido"]
        for p in CASOS
        if not p["valida"] and p["original"] not in REVISADAS
    }
    r = T.traducir(list(malas), llamar=lambda _: malas, almacen=c)
    assert r["traducciones"] == {}
    assert set(r["rechazadas"]) == set(malas)
    assert c.cuantas() == 0


@pytest.mark.parametrize("original,antigua", [
    ("no se manda a un banco: lo propuesto es revisar lo publicado", "nothing is sent to a bank: what is proposed is to review the published literature"),
    ("Campo de la lectura a enmendar", "Field of the reading to amend"),
])
def test_segunda_revision_sustituye_cache_literal_sin_llamar_modelo(tmp_path, original, antigua):
    c = T.Cache(tmp_path / "cache.db")
    c.guardar({original: antigua}, "modelo-antiguo")

    def no_llamar(_):
        pytest.fail("El catálogo revisado debe resolverlo sin pagar una traducción")

    r = T.traducir([original], llamar=no_llamar, almacen=c)
    assert r["traducciones"] == {original: REVISADAS[original]}
