"""MLflow registra las optimizaciones, no cada llamada (28 de septiembre de 2026).

Las trazas de entrenamiento se guardan redactadas en datos/_gepa; mlflow.db era
una segunda copia sin redactar de 740 MB que nadie leía, y en cambio no
registraba las compilaciones de GEPA, que es lo que se le pedía.
"""

from __future__ import annotations

import importlib

import mlflow
import mlflow.dspy

from rosa import config
from rosa import main as M


def _capturar(monkeypatch):
    llamadas: dict = {}
    monkeypatch.setattr(mlflow, "set_tracking_uri", lambda uri: llamadas.setdefault("uri", uri))
    monkeypatch.setattr(mlflow, "set_experiment", lambda nombre: llamadas.setdefault("experimento", nombre))
    monkeypatch.setattr(mlflow.dspy, "autolog", lambda **kw: llamadas.setdefault("autolog", kw))
    return llamadas


def test_por_defecto_no_traza_cada_llamada_y_si_las_optimizaciones(monkeypatch):
    monkeypatch.setattr(config, "MLFLOW_TRAZAS", False)
    llamadas = _capturar(monkeypatch)
    M.configurar_mlflow()
    kw = llamadas["autolog"]
    assert kw["log_traces"] is False and kw["log_traces_from_eval"] is False and kw["log_traces_from_compile"] is False
    assert kw["log_compiles"] is True and kw["log_evals"] is True


def test_con_la_variable_vuelven_las_trazas_para_depurar(monkeypatch):
    monkeypatch.setattr(config, "MLFLOW_TRAZAS", True)
    llamadas = _capturar(monkeypatch)
    M.configurar_mlflow()
    kw = llamadas["autolog"]
    assert kw["log_traces"] is True and kw["log_traces_from_eval"] is True
    # Ni con trazas se duplica cada paso interno de la optimización.
    assert kw["log_traces_from_compile"] is False and kw["log_compiles"] is True


def test_la_variable_solo_se_enciende_con_un_uno_explicito(monkeypatch):
    for valor, esperado in (("1", True), (" 1 ", True), ("", False), ("0", False), ("true", False), ("si", False)):
        monkeypatch.setenv("ROSA_MLFLOW_TRAZAS", valor)
        assert importlib.reload(config).MLFLOW_TRAZAS is esperado, valor
    monkeypatch.delenv("ROSA_MLFLOW_TRAZAS")
    assert importlib.reload(config).MLFLOW_TRAZAS is False


def test_un_mlflow_que_falla_no_tumba_el_arranque(monkeypatch, capsys):
    def revienta(**kw):
        raise RuntimeError("sin base")

    monkeypatch.setattr(mlflow, "set_tracking_uri", lambda uri: None)
    monkeypatch.setattr(mlflow, "set_experiment", lambda nombre: None)
    monkeypatch.setattr(mlflow.dspy, "autolog", revienta)
    M.configurar_mlflow()
    assert "MLflow no disponible" in capsys.readouterr().err
