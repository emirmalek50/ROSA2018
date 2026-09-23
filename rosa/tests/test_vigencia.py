"""Vigencia de los supuestos (rosa/vigencia.py, 23 de septiembre de 2026).

El estado de cada supuesto se calcula al revisar la hipótesis y no se
recalcula solo. La auditoría sin modelo de ese día dio que solo 27 de los 164
supuestos flojos estaban al día. Estos tests sujetan el sello que lo delata,
su reconstrucción para lo evaluado antes de que existiera, la migración que
pide una sola vez la reevaluación de lo evaluado con la regla vieja, la acción
de la pantalla y la anotación cuando una revisión se abandona por presupuesto.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

from rosa import vigencia as V
from rosa.bucle import pasos as PASOS
from rosa.bucle.corrida import _abandonar_peticion_sin_presupuesto
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado.almacen import ACCIONES, _migrar_supuestos_evaluados
from rosa.modulos import firmas as F
from rosa.tests.test_tanda1_pasos_killer import _hip, _llamar, _preparar, _revision_killer
from rosa.tests.test_integracion_pasos import _afirmacion, _hipotesis

ANTES = V.INICIO_REGLA_2 - 3_600_000
DESPUES = V.INICIO_REGLA_2 + 3_600_000


def _sup(texto: str = "Existe un intervalo de referencia independiente.", estado: str = "sin_evidencia", evidencia: str = "ninguna") -> dict[str, Any]:
    return {"id": "s-" + texto[:6], "texto": texto, "estado": estado, "evidencia": evidencia, "hijos": []}


def _h(id_: str = "h1", evaluada: int | None = ANTES, afirmaciones: int = 3, **extra: Any) -> dict[str, Any]:
    h = {
        "id": id_,
        "investigacionId": "inv",
        "titulo": f"Hipótesis {id_}",
        "estado": "propuesta",
        "afirmaciones": [{"texto": f"a{i}"} for i in range(afirmaciones)],
        "supuestos": [_sup()],
        "revisionesAutomaticas": [{"tipo": "profunda", "estado": "hecha" if evaluada else "pendiente", "resumen": "", "fecha": evaluada}],
        "ultimaRevisionAutomatica": evaluada,
        "procedencia": {"mensajes": [], "registro": []},
    }
    h.update(extra)
    return h


def _evidencia(hid: str, t: int, n: int) -> dict[str, Any]:
    return {"id": f"ev-{t}", "investigacionId": "inv", "t": t, "tipo": "revision_automatica", "texto": f"Evidencia nueva para «Hipótesis {hid}»: {n} afirmaciones, 1 fuentes nuevas", "ruta": f"#/investigaciones/inv/hipotesis/{hid}"}


def test_reconstruir_sello_con_la_fecha_de_la_revision_profunda_y_la_evidencia_de_despues():
    h = _h(evaluada=DESPUES, afirmaciones=5)
    # `solicitar_revision` pone la fecha de la PETICIÓN en ultimaRevisionAutomatica: no vale.
    h["ultimaRevisionAutomatica"] = DESPUES + 999_999
    eventos = [_evidencia("h1", DESPUES - 10, 4), _evidencia("h1", DESPUES + 10, 2), _evidencia("otra", DESPUES + 20, 7), {"tipo": "revision_automatica", "t": DESPUES + 30, "texto": "Revisión pedida sobre: x", "ruta": "#/investigaciones/inv/hipotesis/h1"}]
    s = V.reconstruir_sello(h, eventos)
    assert s == {"en": DESPUES, "regla": 2, "afirmaciones": 3, "fallidos": 0, "pedidaEn": None, "noAtendida": None, "reconstruido": True}
    assert V.reconstruir_sello(_h(evaluada=ANTES), [])["regla"] == 1
    # Sin supuestos o sin evaluación, nada que sellar.
    assert V.reconstruir_sello(_h(supuestos=[]), []) is None
    assert V.reconstruir_sello(_h(evaluada=None), []) is None
    # Los que el modelo no pudo evaluar cuentan como fallidos.
    fallido = _h(supuestos=[_sup(evidencia="No se pudo evaluar: el modelo no respondió (TimeoutError)")])
    assert V.reconstruir_sello(fallido, [])["fallidos"] == 1


def test_vigencia_dice_por_que_no_esta_al_dia():
    base = _h(evaluada=DESPUES, afirmaciones=3)
    assert V.vigencia(base) == {"alDia": False, "motivo": "sin_sello", "nuevas": 0}
    base["supuestosEvaluados"] = V.sello(3, DESPUES)
    assert V.vigencia(base) == {"alDia": True, "motivo": None, "nuevas": 0}
    base["afirmaciones"].append({"texto": "nueva"})
    assert V.vigencia(base) == {"alDia": False, "motivo": "evidencia", "nuevas": 1}
    vieja = _h(supuestosEvaluados={**V.sello(3, ANTES), "regla": 1})
    assert V.vigencia(vieja)["motivo"] == "regla"
    fallidos = _h(supuestosEvaluados=V.sello(3, DESPUES, fallidos=2))
    assert V.vigencia(fallidos)["motivo"] == "fallidos"
    assert V.vigencia(_h(supuestos=[]))["alDia"] is True
    # Formas raras: no rompen.
    for raro in ({"supuestos": "x"}, {"supuestos": [_sup()], "supuestosEvaluados": "x"}, {"supuestos": [_sup()], "supuestosEvaluados": {"en": 1, "regla": "2"}}):
        V.vigencia(raro)


def test_pedir_no_atendida_y_reconciliar():
    h = _h(supuestosEvaluados=V.sello(3, DESPUES))
    assert V.pedir(h, 100) is True and h["_revisionPedida"] is True and h["supuestosEvaluados"]["pedidaEn"] == 100
    assert V.pedir(h, 200) is False and h["supuestosEvaluados"]["pedidaEn"] == 100
    V.no_atendida(h, "La corrida 3 no tiene presupuesto.")
    assert h["supuestosEvaluados"]["pedidaEn"] is None and "presupuesto" in h["supuestosEvaluados"]["noAtendida"]
    # Pedida por otro camino (la evidencia nueva): la carga le pone fecha.
    h["_revisionPedida"] = True
    V.reconciliar(h, 300)
    assert h["supuestosEvaluados"]["pedidaEn"] == 300
    # La marca se quitó sin reevaluar: la fecha pública también se va.
    h.pop("_revisionPedida")
    V.reconciliar(h, 400)
    assert h["supuestosEvaluados"]["pedidaEn"] is None
    # Nunca evaluada: pedir deja un sello mínimo que sigue sin estar al día.
    nueva = _h(evaluada=None)
    assert V.pedir(nueva, 500) is True and V.vigencia(nueva)["motivo"] == "sin_sello"


def test_la_migracion_sella_y_pide_una_sola_vez_lo_evaluado_con_la_regla_vieja():
    e = {
        "hipotesis": [
            _h("vieja", evaluada=ANTES),
            _h("nueva", evaluada=DESPUES, afirmaciones=4),
            _h("con_evidencia", evaluada=DESPUES, afirmaciones=4, _revisionPedida=True),
            _h("descartada", evaluada=ANTES, estado="descartada"),
            _h("fundida", evaluada=ANTES, fusionadaEn="vieja"),
            _h("aceptada", evaluada=ANTES, estado="aceptada"),
            _h("sin_supuestos", evaluada=ANTES, supuestos=[]),
            None,
            "texto",
        ],
        "eventos": [_evidencia("con_evidencia", DESPUES + 5, 1)],
    }
    _migrar_supuestos_evaluados(e)
    por_id = {h["id"]: h for h in e["hipotesis"] if isinstance(h, dict)}
    pedidas = sorted(i for i, h in por_id.items() if h.get("_revisionPedida"))
    # La regla vieja se pide en las vivas (también en la aceptada: sus supuestos
    # cuentan en la pantalla; el Killer no vuelve a pasar sobre ella).
    assert pedidas == ["aceptada", "con_evidencia", "vieja"]
    assert por_id["vieja"]["supuestosEvaluados"]["reevaluacionAutomatica"] is True
    assert por_id["vieja"]["supuestosEvaluados"]["pedidaEn"] and any("regla anterior al 18 de septiembre" in m["texto"] for m in por_id["vieja"]["procedencia"]["mensajes"])
    # La que ya tenía la revisión pedida por evidencia nueva: se ve como pedida y no se marca como automática.
    assert por_id["con_evidencia"]["supuestosEvaluados"]["pedidaEn"] and not por_id["con_evidencia"]["supuestosEvaluados"].get("reevaluacionAutomatica")
    # El sello reconstruido guarda la regla de su fecha y las afirmaciones que
    # había entonces (4 de hoy menos 1 llegada después).
    assert por_id["con_evidencia"]["supuestosEvaluados"]["regla"] == 2 and por_id["con_evidencia"]["supuestosEvaluados"]["afirmaciones"] == 3
    assert por_id["nueva"]["supuestosEvaluados"]["regla"] == 2 and por_id["nueva"]["supuestosEvaluados"]["afirmaciones"] == 4
    # Desde la regla 3 (23 de septiembre) lo evaluado con la 2 queda por reevaluar,
    # pero NO se pide solo: "nueva" no está en `pedidas` (arriba). Subir
    # REEVALUAR_AL_CARGAR_HASTA_REGLA es decidir gastar, y eso lo decide una persona.
    assert V.vigencia(por_id["nueva"]) == {"alDia": False, "motivo": "regla", "nuevas": 0}
    assert not por_id["nueva"].get("_revisionPedida") and not por_id["nueva"]["supuestosEvaluados"]["pedidaEn"]
    assert "supuestosEvaluados" not in por_id["sin_supuestos"]
    assert not por_id["descartada"].get("_revisionPedida") and not por_id["fundida"].get("_revisionPedida")
    assert [ev["texto"] for ev in e["eventos"] if "regla anterior" in ev["texto"]] == ["Supuestos evaluados con la regla anterior al 18 de septiembre: ROSA2018 vuelve a revisar 2 hipótesis con la regla de hoy (supuestos y Killer)."]
    # Idempotente.
    antes = json.dumps(e, sort_keys=True, default=str)
    _migrar_supuestos_evaluados(e)
    assert json.dumps(e, sort_keys=True, default=str) == antes
    # Si la revisión se abandona por presupuesto, el arranque siguiente no la vuelve a pedir sola.
    por_id["vieja"].pop("_revisionPedida")
    V.no_atendida(por_id["vieja"], "sin presupuesto")
    _migrar_supuestos_evaluados(e)
    assert not por_id["vieja"].get("_revisionPedida") and por_id["vieja"]["supuestosEvaluados"]["noAtendida"] == "sin presupuesto"
    for raro in ({"hipotesis": "texto"}, {"hipotesis": [{"id": "x", "supuestos": [_sup()], "supuestosEvaluados": "x"}]}, {}):
        _migrar_supuestos_evaluados(raro)


def test_la_accion_pide_solo_lo_que_no_esta_al_dia_y_en_su_alcance():
    assert "reevaluarSupuestos" in ACCIONES
    al_dia = _h("al_dia", evaluada=DESPUES, supuestosEvaluados=V.sello(3, DESPUES))
    vieja = _h("vieja", supuestosEvaluados={**V.sello(3, ANTES), "regla": 1})
    otra_inv = _h("otra", investigacionId="inv-2", supuestosEvaluados={**V.sello(3, ANTES), "regla": 1})
    descartada = _h("descartada", estado="descartada", supuestosEvaluados={**V.sello(3, ANTES), "regla": 1})
    e = {"hipotesis": [al_dia, vieja, otra_inv, descartada], "eventos": []}
    assert A.reevaluar_supuestos(e, "inv", 1000) is True
    assert [h["id"] for h in e["hipotesis"] if h.get("_revisionPedida")] == ["vieja"]
    assert vieja["supuestosEvaluados"]["pedidaEn"] == 1000 and "Qué desbloquea más" in vieja["procedencia"]["mensajes"][-1]["texto"]
    assert [ev["texto"] for ev in e["eventos"]] == ["Reevaluación de supuestos pedida para 1 hipótesis cuyos supuestos no estaban al día."]
    # Sin investigación: todo el programa. Lo ya pedido no se repite.
    assert A.reevaluar_supuestos(e, None, 2000) is True
    assert sorted(h["id"] for h in e["hipotesis"] if h.get("_revisionPedida")) == ["otra", "vieja"] and vieja["supuestosEvaluados"]["pedidaEn"] == 1000
    assert A.reevaluar_supuestos(e, None, 3000) is False


def test_la_revision_escribe_el_sello_con_las_afirmaciones_que_vio_y_los_fallidos(monkeypatch):
    h = _hipotesis(afirmaciones=[_afirmacion(afirmacionId="af-1"), _afirmacion(afirmacionId="af-2", texto="GENHEP is not detected in CSF")], supuestos=[_sup("El generador supone A"), _sup("El generador supone B")])
    al, ctx = _preparar(monkeypatch, h)

    def evaluar(kwargs):
        if kwargs["supuesto"].endswith("B"):
            raise RuntimeError("el modelo no respondió")
        return SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="plausible", evidencia="consistente", indices_que_lo_niegan=[]))

    monkeypatch.setattr(Ctx, "llamar", _llamar({"revisar_inicial": SimpleNamespace(revision=F.RevisionInicial(pasa=True, resumen="ok", supuestos=[])), "evaluar_supuesto": evaluar, "killer": _revision_killer()}))
    asyncio.run(PASOS._revisar_hipotesis(ctx, h, "", None))
    s = _hip(al, h)["supuestosEvaluados"]
    assert s["regla"] == V.REGLA_SUPUESTOS and s["afirmaciones"] == 2 and s["fallidos"] == 1 and s["pedidaEn"] is None and s["reconstruido"] is False
    assert V.vigencia(_hip(al, h))["motivo"] == "fallidos"
    # Regla 3: cada supuesto dice su alcance. El que el modelo no pudo evaluar
    # es «no evaluado», no «sin evidencia»: no pude comprobar, nunca no hay.
    por_texto = {x["texto"]: x for x in _hip(al, h)["supuestos"]}
    assert por_texto["El generador supone B"]["alcance"] == "no_evaluado" and por_texto["El generador supone B"]["dondeSeResponde"] is None
    assert por_texto["El generador supone A"]["alcance"] == "no_tocado"  # el modelo no dio índices
    assert por_texto["El generador supone A"]["dondeSeResponde"] == "literatura"  # el valor por defecto de la firma
    # Todo bien a la segunda: al día.
    monkeypatch.setattr(Ctx, "llamar", _llamar({"evaluar_supuesto": SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="plausible", evidencia="consistente", indices_que_lo_niegan=[])), "killer": _revision_killer()}))
    asyncio.run(PASOS._revisar_hipotesis(ctx, _hip(al, h), "", None))
    assert V.vigencia(_hip(al, h)) == {"alDia": True, "motivo": None, "nuevas": 0}


def test_abandonar_por_presupuesto_lo_dice_en_el_sello():
    h = _h(supuestosEvaluados={**V.sello(3, ANTES), "regla": 1}, _revisionPedida=True)
    V.reconciliar(h, 50)
    e = {"hipotesis": [h], "eventos": []}
    assert _abandonar_peticion_sin_presupuesto(e, "h1", {"numero": 3, "estado": "detenida"}) is True
    assert "_revisionPedida" not in h and h["supuestosEvaluados"]["pedidaEn"] is None
    assert h["supuestosEvaluados"]["noAtendida"].startswith("La corrida 3 no tiene presupuesto")
