"""El bloqueo de parada: que con una corrida viva no se pare, pase lo que pase.

Estas pruebas existen porque la regla escrita no bastó: el 22 de septiembre de
2026 se comprobó que había una corrida en marcha y se paró igualmente. Aquí la
regla es código, y lo que se prueba es que el código dice que no."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from scripts import parar_servidor as PS


def base_con(estados: list[str], tmp_path: Path) -> Path:
    ruta = tmp_path / "rosa.db"
    con = sqlite3.connect(ruta)
    con.execute("create table estado (version integer primary key, json text)")
    corridas = [{"id": f"cor-{i}", "numero": i + 1, "estado": e, "investigacionId": "inv-1"} for i, e in enumerate(estados)]
    con.execute("insert into estado values (?, ?)", (1, json.dumps({"corridas": corridas})))
    con.commit()
    con.close()
    return ruta


def test_una_corrida_en_marcha_impide_parar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con(["en_marcha"], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 12345)
    llamadas = []
    monkeypatch.setattr(PS, "parar", lambda pid, espera=0: llamadas.append(pid) or True)
    codigo = PS.main(["--db", str(db)])
    assert codigo == PS.CODIGO_HAY_CORRIDA_VIVA
    # Lo importante: no se mandó ninguna señal.
    assert llamadas == []
    salida = capsys.readouterr().out
    assert "NO se para el servidor" in salida
    assert "corrida 1 · en_marcha" in salida


@pytest.mark.parametrize("estado", list(PS.ESTADOS_VIVOS))
def test_todos_los_estados_con_trabajo_en_vuelo_bloquean(estado: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db = base_con([estado], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    monkeypatch.setattr(PS, "parar", lambda *a, **k: pytest.fail("no debía pararse"))
    assert PS.main(["--db", str(db)]) == PS.CODIGO_HAY_CORRIDA_VIVA


@pytest.mark.parametrize("estado", ["pausada", "pausada_por_presupuesto", "detenida", "terminada"])
def test_una_corrida_parada_no_impide_nada(estado: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Una corrida pausada espera a una persona y no llama a ningún modelo:
    # pararla no pierde trabajo.
    db = base_con([estado], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    parados = []
    monkeypatch.setattr(PS, "parar", lambda pid, espera=0: parados.append(pid) or True)
    assert PS.main(["--db", str(db)]) == 0
    assert parados == [999]


def test_si_la_base_no_se_puede_leer_no_se_para(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # No saber si hay trabajo vivo es motivo para no parar, nunca para seguir.
    rota = tmp_path / "no_existe.db"
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    monkeypatch.setattr(PS, "parar", lambda *a, **k: pytest.fail("no debía pararse"))
    assert PS.main(["--db", str(rota)]) == PS.CODIGO_HAY_CORRIDA_VIVA


def test_forzar_sin_motivo_no_vale(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con(["en_marcha"], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    monkeypatch.setattr(PS, "parar", lambda *a, **k: pytest.fail("no debía pararse"))
    assert PS.main(["--db", str(db), "--forzar"]) == 1
    assert "exige --motivo" in capsys.readouterr().out


def test_forzar_con_motivo_para_y_lo_deja_escrito(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con(["en_marcha"], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    parados = []
    monkeypatch.setattr(PS, "parar", lambda pid, espera=0: parados.append(pid) or True)
    assert PS.main(["--db", str(db), "--forzar", "--motivo", "el servidor no responde"]) == 0
    assert parados == [999]
    salida = capsys.readouterr().out
    assert "FORZADO" in salida and "el servidor no responde" in salida


def test_sin_servidor_corriendo_lo_dice_y_no_finge(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con([], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: None)
    assert PS.main(["--db", str(db)]) == PS.CODIGO_SIN_SERVIDOR
    assert "no está corriendo" in capsys.readouterr().out


def test_el_modo_estado_no_toca_nada(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con(["en_marcha"], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 4321)
    monkeypatch.setattr(PS, "parar", lambda *a, **k: pytest.fail("--estado no para nada"))
    assert PS.main(["--db", str(db), "--estado"]) == 0
    salida = capsys.readouterr().out
    assert "pid 4321" in salida and "NO es seguro parar" in salida


def test_si_el_proceso_no_sale_no_se_arranca_otro_encima(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    db = base_con(["pausada"], tmp_path)
    monkeypatch.setattr(PS, "pid_del_servidor", lambda: 999)
    monkeypatch.setattr(PS, "parar", lambda pid, espera=0: False)
    assert PS.main(["--db", str(db), "--espera", "1"]) == 1
    assert "NO se arranca otro" in capsys.readouterr().out
