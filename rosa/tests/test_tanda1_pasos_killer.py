"""Tanda 1, grupo B2 (revisión del 17 de septiembre de 2026): el Killer, la
revisión de supuestos, la auditoría por debate y el torneo, con modelos
simulados y sin red. Cada test fija un arreglo y falla sin él:

- S-09: si el juez del Killer no responde no se registra ninguna decisión; la
  hipótesis queda pendiente de juicio (marca de revisión y un intento contado)
  y a la tercera vez se registra una suspensión explícita con motivo técnico.
- S-10: un supuesto "contradicho" sin índice válido (o con evidencia del tipo
  "ninguna afirmación lo menciona") baja a "sin evidencia"; los supuestos del
  generador se conservan con su origen y los del revisor se añaden.
- S-08: la revisión sigue con el Killer aunque falle la revisión inicial; los
  supuestos se evalúan primero contra las afirmaciones propias; el torneo y el
  Killer ven la evidencia acumulada ordenada por relación.
- S-12: la auditoría cuenta por investigación; un auditor mudo es None, no
  acuerdo; en desacuerdo la comprobación discutida baja a no_comprobable, la
  decisión se recalcula y queda como killer_2 con un "Decide tú".
- S-11: una reformulación por novedad no se vuelve a juzgar de inmediato.
- S-13: un par del torneo con la misma huella de evidencia no se rejuega.
- M-21: las afirmaciones en contra no entran en la dirección de la evidencia.
- M-19: avanzar saca de en_revision; descartar dos veces deja un solo hallazgo.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace
from typing import Any

from rosa import conectores as CON
from rosa import killer as K
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.modulos import firmas as F
from rosa.tests.test_integracion_pasos import _afirmacion, _ctx, _hipotesis, consultar_falso

PROGRAMAS = ("killer", "revisar_inicial", "evaluar_supuesto", "auditar_descarte", "comparar", "reformular", "senalizacion")


def _preparar(monkeypatch, *hipotesis: dict[str, Any]):
    al, ctx = _ctx()
    for h in hipotesis:
        al.mutar(lambda e, h=h: e["hipotesis"].append(h) or True, "prueba")
    monkeypatch.setattr(CON, "consultar", consultar_falso({}))

    async def sin_ontologias(simbolos, terminos, cache):
        return []

    monkeypatch.setattr(PASOS.ONTO, "normalizar", sin_ontologias)
    return al, ctx


def _llamar(respuestas: dict[str, Any], llamadas: list[tuple[str, dict[str, Any]]] | None = None):
    """Un `Ctx.llamar` simulado: por nombre de programa, lo que devuelve (un
    objeto), lo que lanza (una excepción) o una función de los kwargs."""

    async def llamar(self, rol, programa, **kwargs):
        nombre = next((n for n in PROGRAMAS if programa is getattr(self.programas, n, None)), None)
        if llamadas is not None:
            llamadas.append((nombre, kwargs))
        r = respuestas.get(nombre)
        if callable(r) and not isinstance(r, BaseException):
            r = r(kwargs)
        if r is None:
            raise RuntimeError(f"modelo simulado sin respuesta para {nombre}")
        if isinstance(r, BaseException):
            raise r
        return r

    return llamar


def _revision_killer(**cambios: Any) -> SimpleNamespace:
    base = dict(comprobaciones=[F.ComprobacionKiller(comprobacion="falsabilidad", resultado="pasa", detalle="Hay predicción medible")], supuesto_invalidante="", alternativas=[], reformulacion_sugerida="", que_haria_falta="", contradice_a=[], resumen="Pasa las citas; nada frágil.")
    base.update(cambios)
    return SimpleNamespace(revision=F.RevisionKiller(**base))


def _hip(al, h):
    return next(y for y in al.estado["hipotesis"] if y["id"] == h["id"])


def _decisiones(al, h):
    return [d for d in al.estado["decisiones"] if d["hipotesisId"] == h["id"]]


def _eventos(al, contiene: str) -> list[dict[str, Any]]:
    return [ev for ev in al.estado["eventos"] if contiene in ev["texto"]]


def _con_novedad_comprobada(h: dict[str, Any]) -> dict[str, Any]:
    """Una hipótesis que puede avanzar por regla: novedad comprobada y sin diana
    (con las bases simuladas caídas, una diana nombrada deja
    `identificadores_resuelven` en falla y la regla suspende)."""
    h["novedad"]["precedente"] = {"estado": "sin_precedente", "detalle": "Sin precedente claro: 4 obras evaluadas de 12 que casan con «GENHEP astrocyte» en OpenAlex"}
    h["novedad"]["genetica"] = {"estado": "sin_evidencia", "detalle": "x"}
    if isinstance(h.get("tarjeta"), dict):
        h["tarjeta"]["diana"] = ""
    return h


# ---------------------------------------------------------------------------
# S-09: el juez no responde
# ---------------------------------------------------------------------------


def test_juez_caido_deja_pendiente_y_a_la_tercera_suspende_con_motivo_tecnico(monkeypatch):
    h = _hipotesis()
    h["decisionKiller"] = "suspender"  # la suspensión científica anterior (sesgo) debe sobrevivir
    al, ctx = _preparar(monkeypatch, h)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": RuntimeError("Adapter JSONAdapter failed to parse LM response")}))
    revisiones_antes = len(_hip(al, h)["revisiones"])

    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    x = _hip(al, h)
    assert decision == "pendiente"
    assert _decisiones(al, h) == [], "sin juez no hay decisión del Killer"
    assert x["decisionKiller"] == "suspender" and len(x["revisiones"]) == revisiones_antes, "la decisión y el motivo anteriores se conservan"
    assert x["_revisionPedida"] is True and x["_killerIntentos"] == 1
    assert any(i["tipo"] == "juez_sin_respuesta" and i["recurso"] == h["id"] for i in al.estado["incidencias"])
    assert _eventos(al, "pendiente de juicio") and not _eventos(al, "queda suspendida")
    assert "intento 1 de 3" in x["procedencia"]["mensajes"][-1]["texto"]

    asyncio.run(PASOS._killer(ctx, h, "", None))
    assert _hip(al, h)["_killerIntentos"] == 2 and _decisiones(al, h) == []

    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    x = _hip(al, h)
    assert decision == "suspender"
    ds = _decisiones(al, h)
    assert len(ds) == 1 and ds[0]["decision"] == "suspender" and ds[0]["etapa"] == "killer_1" and ds[0]["sinJuez"] is True
    assert "no respondió 3 veces" in ds[0]["motivo"] and "motivo técnico" in ds[0]["motivo"]
    assert "_revisionPedida" not in x and x["_killerIntentos"] == 0
    assert any(h["id"] in (c.get("hipotesisIds") or []) for c in al.estado.get("cuestiones", [])), "queda una cuestión para la persona"
    assert _eventos(al, "hasta que una persona pida la revisión")
    # Con el juez de vuelta, el juicio normal borra la marca y el contador.
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}))
    al.mutar(lambda e: e["hipotesis"][0].__setitem__("_revisionPedida", True) or True, "prueba")
    asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None))
    x = _hip(al, h)
    assert "_revisionPedida" not in x and "_killerIntentos" not in x and len(_decisiones(al, h)) == 2
    assert _decisiones(al, h)[-1]["huella"] == K.huella_evidencia(x) and x["_huellaKiller"] == _decisiones(al, h)[-1]["huella"]


def test_sin_juez_las_citas_rotas_siguen_descartando(monkeypatch):
    """Lo que ROSA2018 comprueba sola contra el texto (citas que no resuelven) no
    espera al juez: la evidencia rota es evidencia rota."""
    h = _hipotesis(afirmaciones=[_afirmacion(veredicto="cita_no_resuelve")])
    al, ctx = _preparar(monkeypatch, h)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": RuntimeError("timeout")}))
    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    x = _hip(al, h)
    assert decision == "descartar_en_contexto" and x["decisionKiller"] == "descartar_en_contexto"
    d = _decisiones(al, h)[-1]
    assert d["sinJuez"] is True and d["motivo"].startswith("[Sin juez") and d["corridaId"] == ctx.corrida_id
    assert "_revisionPedida" not in x


def test_paso_hipotesis_no_quita_la_marca_si_el_juez_no_respondio(monkeypatch):
    """El camino real del paso: la marca solo la quita el Killer al juzgar."""
    h = _hipotesis()
    h["_revisionPedida"] = True
    al, ctx = _preparar(monkeypatch, h)

    async def sin_torneo(ctx_, pista):
        return 0

    monkeypatch.setattr(PASOS, "_torneo", sin_torneo)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": RuntimeError("sin modelo")}))
    asyncio.run(PASOS.paso_hipotesis(ctx, {"id": "p1"}))
    x = _hip(al, h)
    assert x["_revisionPedida"] is True and x["_killerIntentos"] == 1 and _decisiones(al, h) == []
    # Con el juez de vuelta la marca se va.
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "revisar_inicial": SimpleNamespace(revision=F.RevisionInicial(pasa=True, resumen="ok", supuestos=[]))}))
    asyncio.run(PASOS.paso_hipotesis(ctx, {"id": "p2"}))
    x = _hip(al, h)
    assert "_revisionPedida" not in x and "_killerIntentos" not in x and len(_decisiones(al, h)) == 1


# ---------------------------------------------------------------------------
# S-10 y S-08: supuestos con índice validado, orígenes y afirmaciones propias
# ---------------------------------------------------------------------------


def test_validar_supuesto_evaluado_exige_indice_valido_y_no_lee_ausencia_como_negacion():
    lista = [{"afirmacionId": "af-1"}, {"afirmacionId": "af-2"}]
    v = PASOS.validar_supuesto_evaluado
    assert v("contradicho", "La afirmación 2 dice lo contrario", [2], lista) == ("contradicho", "La afirmación 2 dice lo contrario", ["af-2"])
    assert v("contradicho", "La afirmación 2 dice lo contrario", ["2", "2", 0, 99, "x", None], lista)[2] == ["af-2"]
    estado, evidencia, ids = v("contradicho", "Las afirmaciones lo niegan", [], lista)
    assert estado == "sin_evidencia" and ids == [] and "ausencia no es negación" in evidencia and evidencia.startswith("Las afirmaciones lo niegan")
    estado, evidencia, ids = v("contradicho", "Ninguna afirmación menciona el ensayo INVOKE-2", [1], lista)
    assert estado == "sin_evidencia" and ids == [] and "ninguna afirmación lo menciona" in evidencia
    assert v("contradicho", "No hay evidencia sobre este punto", [1], lista)[0] == "sin_evidencia"
    assert v("respaldado", "La afirmación 1 lo sostiene", None, lista) == ("respaldado", "La afirmación 1 lo sostiene", [])
    assert v("plausible", "", [5], [])[0] == "plausible"
    assert v("inventado", None, None, lista) == ("sin_evidencia", "", [])
    assert v("contradicho", "x", [1], [])[0] == "sin_evidencia"


def test_alcance_del_supuesto_separa_no_tocado_de_tocado_sin_respuesta():
    """Regla 3 (23 de septiembre de 2026): «sin evidencia» decía lo mismo cuando
    las afirmaciones no hablaban del tema que cuando hablaban y no lo resolvían.
    El alcance lo decide la regla con los índices, no el modelo."""
    lista = [{"afirmacionId": "af-1"}, {"afirmacionId": "af-2"}, {"afirmacionId": "af-3"}]
    a = PASOS.alcance_del_supuesto
    # Ninguna afirmación habla del tema: las que hay no informan de nada.
    r = a("sin_evidencia", [], [], "catalogo_de_cohorte", "", lista)
    assert r == {"alcance": "no_tocado", "tocaAfirmaciones": [], "dondeSeResponde": "catalogo_de_cohorte", "cota": ""}
    # Hablan del tema y no lo resuelven: eso sí informa.
    r = a("sin_evidencia", [2, "2", 0, 99, "x", None], [], "literatura", "", lista)
    assert r["alcance"] == "tocado_sin_respuesta" and r["tocaAfirmaciones"] == ["af-2"]
    assert a("plausible", [1], [], "literatura", "", lista)["alcance"] == "tocado_sin_respuesta"
    # Respaldado o contradicho: resuelto, y las que lo niegan cuentan como que lo tocan.
    assert a("respaldado", [1], [], "literatura", "", lista)["alcance"] == "resuelto"
    r = a("contradicho", [], ["af-3"], "literatura", "", lista)
    assert r["alcance"] == "resuelto" and r["tocaAfirmaciones"] == ["af-3"]
    # Un índice que no existe no convierte un «no tocado» en «tocado».
    assert a("sin_evidencia", [7, -1], [], "literatura", "", lista)["alcance"] == "no_tocado"


def test_alcance_del_supuesto_no_adivina_donde_ni_acepta_cotas_sin_cifra():
    lista = [{"afirmacionId": "af-1"}]
    a = PASOS.alcance_del_supuesto
    # Dónde se responde: fuera de la lista no se adivina.
    assert a("sin_evidencia", [], [], "en internet", "", lista)["dondeSeResponde"] is None
    assert a("sin_evidencia", [], [], None, "", lista)["dondeSeResponde"] is None
    for donde in PASOS.DONDE_SE_RESPONDE:
        assert a("sin_evidencia", [], [], donde, "", lista)["dondeSeResponde"] == donde
    # Una cota sin cifra no es un límite.
    assert a("contradicho", [1], ["af-1"], "literatura", "el efecto es pequeño", lista)["cota"] == ""
    cota = "si hay efecto, es menor que 0,04 (IC 95 % -0,04 a 0,03, afirmación 1)"
    assert a("contradicho", [1], ["af-1"], "literatura", cota, lista)["cota"] == cota
    assert len(a("sin_evidencia", [], [], "literatura", "1" * 900, lista)["cota"]) == 300
    # Entradas rotas no rompen nada.
    assert a("sin_evidencia", "basura", [], 5, 5, [])["alcance"] == "no_tocado"


def test_fusionar_supuestos_conserva_los_del_generador_y_etiqueta_los_del_revisor():
    existentes = [{"id": "sup-g1", "texto": "El generador supone A", "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": []}, {"texto": "  "}, None, {"id": "sup-g2", "texto": "El generador supone B", "estado": "plausible"}]
    salida = PASOS.fusionar_supuestos(existentes, ["El revisor supone C", "el generador supone a", "", "El revisor supone C"], nunca_revisada=True)
    assert [s["texto"] for s in salida] == ["El generador supone A", "El generador supone B", "El revisor supone C"]
    assert [s.get("origen") for s in salida] == ["generador", "generador", "revisor"]
    assert salida[0]["id"] == "sup-g1" and salida[1]["evidencia"] == "Pendiente" and salida[2]["estado"] == "sin_evidencia"
    # Registro ya revisado antes de esta regla: no se le inventa el origen.
    assert "origen" not in PASOS.fusionar_supuestos([{"id": "s", "texto": "x"}], [], nunca_revisada=False)[0]
    assert PASOS.fusionar_supuestos(None, None, True) == [] and PASOS.fusionar_supuestos("basura", "basura", True) == []
    assert len(PASOS.fusionar_supuestos([{"texto": f"s{i}"} for i in range(20)], [], True)) == 12


def test_afirmaciones_para_supuestos_pone_primero_las_propias_y_recorta_por_afirmaciones_enteras():
    h = _hipotesis(afirmaciones=[_afirmacion(afirmacionId="af-c", texto="GENHEP decreases in plasma", relacion="contradice"), _afirmacion(afirmacionId="af-1", texto="GENHEP increases in astrocytes"), _afirmacion(afirmacionId="af-x", veredicto="no_sostenida", texto="no cuenta")])
    corrida = [{"id": "af-1", "afirmacionId": "af-1", "texto": "GENHEP increases in astrocytes", "cita": "[A]", "veredicto": "sostenida", "tipo": "dato"}, {"id": "af-9", "texto": "Otra de la corrida", "cita": "[B]", "veredicto": "sostenida", "tipo": "dato"}, {"id": "af-8", "texto": "No sostenida", "cita": "[C]", "veredicto": "no_sostenida", "tipo": "dato"}]
    texto, lista = PASOS.afirmaciones_para_supuestos(h, corrida)
    assert [a.get("afirmacionId") or a.get("id") for a in lista] == ["af-1", "af-c", "af-9"], "propias primero (apoyo antes que contra), luego la corrida sin repetir"
    assert texto.startswith("1. (dato) GENHEP increases") and "[EN CONTRA de la hipótesis]" in texto.split("\n")[1]
    texto2, lista2 = PASOS.afirmaciones_para_supuestos(h, corrida, maximo=60)
    assert len(lista2) == 1 and texto2.count("\n") == 0, "el recorte completa afirmaciones enteras para que la numeración sea la lista"
    assert PASOS.afirmaciones_para_supuestos({"afirmaciones": None}, None)[1] == []


def test_supuesto_contradicho_sin_indice_pasa_a_sin_evidencia_y_la_hipotesis_se_suspende_no_se_descarta(monkeypatch):
    h = _hipotesis(afirmaciones=[_afirmacion(afirmacionId="af-1"), _afirmacion(afirmacionId="af-2", texto="GENHEP is not detected in CSF", cita="[B et al., 2024, pág. 2]", fragmento="GENHEP is not detected in CSF")], supuestos=[{"id": "sup-g1", "texto": "El generador supone A", "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": []}])
    al, ctx = _preparar(monkeypatch, h)
    recibidos: list[str] = []

    def evaluar(kwargs):
        recibidos.append(kwargs["afirmaciones_sostenidas"])
        s = kwargs["supuesto"]
        if s.startswith("El generador"):
            return SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="contradicho", evidencia="Las afirmaciones lo niegan", indices_que_lo_niegan=[]))
        if "B" in s:
            return SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="contradicho", evidencia="La afirmación 2 dice que no se detecta en LCR", indices_que_lo_niegan=[2]))
        return SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="contradicho", evidencia="Ninguna afirmación menciona ese ensayo", indices_que_lo_niegan=[1]))

    monkeypatch.setattr(Ctx, "llamar", _llamar({"revisar_inicial": SimpleNamespace(revision=F.RevisionInicial(pasa=True, resumen="ok", supuestos=["El revisor supone B", "el generador supone a", "El revisor supone C (ensayo)"])), "evaluar_supuesto": evaluar, "killer": _revision_killer()}))
    asyncio.run(PASOS._revisar_hipotesis(ctx, h, "texto de la corrida que no se usa", None))
    x = _hip(al, h)
    assert [s["texto"] for s in x["supuestos"]] == ["El generador supone A", "El revisor supone B", "El revisor supone C (ensayo)"]
    assert [s.get("origen") for s in x["supuestos"]] == ["generador", "revisor", "revisor"] and x["supuestos"][0]["id"] == "sup-g1"
    assert [s["estado"] for s in x["supuestos"]] == ["sin_evidencia", "contradicho", "sin_evidencia"]
    assert x["supuestos"][1]["niegaAfirmaciones"] == ["af-2"] and "ausencia no es negación" in x["supuestos"][0]["evidencia"]
    # El evaluador recibió primero las afirmaciones propias de la hipótesis, numeradas.
    assert recibidos and all(t.startswith("1. (dato) GENHEP increases") and "2. (dato) GENHEP is not detected" in t for t in recibidos)
    # Un solo hallazgo de supuesto contradicho, y el Killer suspende (SUSPENDEN), no descarta.
    assert [z["resumen"] for z in x["hallazgos"] if z["estado"] == "abierto" and z["resumen"].startswith("Supuesto contradicho")] == ["Supuesto contradicho: El revisor supone B"]
    assert x["decisionKiller"] == "suspender" and x["estado"] == "propuesta"
    d = _decisiones(al, h)[-1]
    assert any(c["comprobacion"] == "supuestos" and c["resultado"] == "falla" for c in d["comprobaciones"])
    # Segunda pasada con el supuesto ya no contradicho: su hallazgo se cierra.
    monkeypatch.setattr(Ctx, "llamar", _llamar({"evaluar_supuesto": SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="plausible", evidencia="consistente", indices_que_lo_niegan=[])), "killer": _revision_killer()}))
    asyncio.run(PASOS._revisar_hipotesis(ctx, _hip(al, h), "", None))
    x = _hip(al, h)
    assert not [z for z in x["hallazgos"] if z["estado"] == "abierto" and z["resumen"].startswith("Supuesto contradicho")]
    assert [s["id"] for s in x["supuestos"]][0] == "sup-g1" and len(x["supuestos"]) == 3


def test_revision_inicial_caida_sigue_con_el_killer_y_no_se_repite_para_la_misma_version(monkeypatch):
    h = _hipotesis(supuestos=[{"id": "sup-g1", "texto": "El generador supone A", "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": []}])
    al, ctx = _preparar(monkeypatch, h)
    llamadas: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(Ctx, "llamar", _llamar({"revisar_inicial": RuntimeError("no respondió"), "evaluar_supuesto": SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="respaldado", evidencia="La 1", indices_que_lo_niegan=[])), "killer": _revision_killer()}, llamadas))
    asyncio.run(PASOS._revisar_hipotesis(ctx, h, "", None))
    x = _hip(al, h)
    assert len(_decisiones(al, h)) == 1, "la petición no se pierde: el Killer juzga aunque falle la revisión inicial"
    assert x["supuestos"][0]["estado"] == "respaldado" and x["supuestos"][0]["origen"] == "generador"
    assert any("La revisión inicial no respondió" in m["texto"] for m in x["procedencia"]["mensajes"])
    assert "_revisionInicialVersion" not in x and x["ultimaRevisionAutomatica"]
    # Segunda pasada: la inicial vuelve a intentarse (no se hizo), y queda hecha para la versión 1.
    llamadas.clear()
    monkeypatch.setattr(Ctx, "llamar", _llamar({"revisar_inicial": SimpleNamespace(revision=F.RevisionInicial(pasa=True, resumen="ok", supuestos=[])), "evaluar_supuesto": SimpleNamespace(evaluacion=F.SupuestoEvaluado(estado="respaldado", evidencia="La 1", indices_que_lo_niegan=[])), "killer": _revision_killer()}, llamadas))
    asyncio.run(PASOS._revisar_hipotesis(ctx, _hip(al, h), "", None))
    assert [n for n, _ in llamadas if n == "revisar_inicial"] == ["revisar_inicial"] and _hip(al, h)["_revisionInicialVersion"] == 1
    # Tercera pasada, misma versión: no se repite la inicial (Opus); sí los supuestos y el Killer.
    llamadas.clear()
    asyncio.run(PASOS._revisar_hipotesis(ctx, _hip(al, h), "", None))
    nombres = [n for n, _ in llamadas]
    assert "revisar_inicial" not in nombres and "evaluar_supuesto" in nombres and "killer" in nombres
    assert len(_decisiones(al, h)) == 3


# ---------------------------------------------------------------------------
# S-12: auditoría por debate
# ---------------------------------------------------------------------------


def test_indice_de_auditoria_cuenta_por_investigacion_y_no_por_corrida():
    e = {"decisiones": [
        {"id": "d1", "investigacionId": "inv", "etapa": "killer_1", "decision": "descartar_en_contexto", "corridaId": "c1"},
        {"id": "d2", "investigacionId": "inv", "etapa": "killer_1", "decision": "reformular", "corridaId": "c2"},
        {"id": "d3", "investigacionId": "inv", "etapa": "killer_1", "decision": "suspender", "corridaId": "c2"},
        {"id": "d4", "investigacionId": "inv", "etapa": "killer_2", "decision": "descartar_en_contexto", "corridaId": "c2"},
        {"id": "d5", "investigacionId": "otra", "etapa": "killer_1", "decision": "descartar_en_contexto"},
        {"id": "d6", "investigacionId": "inv", "etapa": "killer_1", "decision": "descartar_en_contexto", "corridaId": "c3"},
        None,
    ]}
    assert PASOS.indice_auditoria(e, "inv", excluir_id="d6") == 2
    assert PASOS.indice_auditoria(e, "inv") == 3 and PASOS.indice_auditoria({}, "inv") == 0
    # Con k=3: se auditan los índices 0, 3, 6...: tres corridas con un descarte cada una ya no auditan las tres.
    assert [K.muestrear_para_auditoria(i) for i in range(4)] == [True, False, False, True]


def test_normalizar_comprobacion_discutida():
    nombres = ["citas_reales", "fidelidad_evidencia", "supuestos", "direccion_causal"]
    n = PASOS.normalizar_comprobacion_discutida
    assert n("supuestos", nombres) == "supuestos" and n("Supuestos ", nombres) == "supuestos"
    assert n("fidelidad de la evidencia", nombres) == "fidelidad_evidencia" and n("fidelidad-evidencia", nombres) == "fidelidad_evidencia"
    assert n("la comprobación de dirección causal", nombres) == "direccion_causal"
    assert n("", nombres) == "" and n(None, nombres) == "" and n("otra cosa", nombres) == ""


def _hipotesis_descartable() -> dict[str, Any]:
    return _hipotesis(afirmaciones=[_afirmacion(), _afirmacion(afirmacionId="af-2", veredicto="no_sostenida", texto="GENHEP triples in CSF", motivo="la fuente dice otra cifra")])


def test_auditor_mudo_no_cuenta_como_acuerdo(monkeypatch):
    h = _hipotesis_descartable()
    al, ctx = _preparar(monkeypatch, h)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "auditar_descarte": ConnectionError("502 Bad Gateway")}))
    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    assert decision == "descartar_en_contexto"
    d = _decisiones(al, h)[-1]
    assert d["auditoria"]["acuerdo"] is None and d["auditoria"]["estado"] == "no_respondio" and d["auditoria"]["motivo"].startswith("El auditor no respondió")
    assert any(i["tipo"] == "auditoria_sin_respuesta" and i["recurso"] == d["id"] for i in al.estado["incidencias"])
    x = _hip(al, h)
    assert not [z for z in x["hallazgos"] if z["resumen"] == "La auditoría discrepa del Killer"]
    assert x["estado"] == "en_revision" and x["decisionKiller"] == "descartar_en_contexto"


def test_auditoria_en_desacuerdo_recalcula_por_regla_y_registra_killer_2(monkeypatch):
    h = _hipotesis_descartable()
    al, ctx = _preparar(monkeypatch, h)
    auditoria = SimpleNamespace(auditoria=F.AuditoriaDescarte(mejor_argumento_a_favor="La afirmación no sostenida no es la que sostiene la predicción", acuerdo=False, comprobacion_discutida="fidelidad de la evidencia", motivo="El descarte no se sostiene."))
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "auditar_descarte": auditoria}))
    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    ds = _decisiones(al, h)
    assert [d["etapa"] for d in ds] == ["killer_1", "killer_2"] and ds[0]["decision"] == "descartar_en_contexto"
    assert decision == "suspender" and ds[1]["decision"] == "suspender", "la comprobación discutida baja a no_comprobable y la regla vuelve a decidir"
    assert ds[1]["discuteA"] == ds[0]["id"] and ds[1]["quien"] == "cerebro-simulado" and ds[1]["queHariaFalta"].startswith("La afirmación no sostenida")
    fid = next(c for c in ds[1]["comprobaciones"] if c["comprobacion"] == "fidelidad_evidencia")
    assert fid["resultado"] == "no_comprobable" and fid["detalle"].startswith("Discutida por la auditoría")
    assert ds[0]["auditoria"]["acuerdo"] is False and ds[0]["auditoria"]["comprobacionDiscutida"] == "fidelidad_evidencia" and ds[0]["auditoria"]["argumentoAFavor"]
    x = _hip(al, h)
    assert x["decisionKiller"] == "suspender" and x["estado"] == "propuesta", "vuelve a la cola: la deja esperando, no la mata ni la avanza"
    assert "descartada_por_killer" not in x["bloqueos"]
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "El Killer propone descartarla en este contexto"] == ["atendido"]
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "La auditoría discrepa del Killer"] == ["abierto"]
    ev = _eventos(al, "Auditoría en desacuerdo")
    assert len(ev) == 1 and "Decide tú" in ev[0]["texto"] and "el Killer dijo descartar en contexto" in ev[0]["texto"] and "el auditor:" in ev[0]["texto"] and "Recalculado por regla: suspender" in ev[0]["texto"]
    assert "_revisionPedida" not in x
    # Un desacuerdo que no señala una comprobación fallida concreta no recalcula nada.
    h2 = _hipotesis_descartable()
    h2["titulo"] = "Otra hipótesis GENHEP"
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")
    # Índice 1 de la investigación: no se muestrea (k=3). Forzamos el índice 3 con dos decisiones más.
    for _ in range(2):
        al.mutar(lambda e: e["decisiones"].append({"id": f"dec-relleno-{_}", "investigacionId": "inv", "hipotesisId": "x", "etapa": "killer_1", "decision": "reformular"}) or True, "prueba")
    vaga = SimpleNamespace(auditoria=F.AuditoriaDescarte(mejor_argumento_a_favor="Es interesante", acuerdo=False, comprobacion_discutida="", motivo="No me convence."))
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "auditar_descarte": vaga}))
    decision2 = asyncio.run(PASOS._killer(ctx, h2, "", None))
    ds2 = _decisiones(al, h2)
    assert decision2 == "descartar_en_contexto" and [d["etapa"] for d in ds2] == ["killer_1"] and ds2[0]["auditoria"]["acuerdo"] is False
    assert _hip(al, h2)["estado"] == "en_revision" and _eventos(al, "sin señalar una comprobación fallida concreta")


# ---------------------------------------------------------------------------
# M-19: marcas, hallazgos y estados del Killer
# ---------------------------------------------------------------------------


def test_avanzar_saca_de_en_revision_y_descartar_dos_veces_deja_un_solo_hallazgo(monkeypatch):
    h = _hipotesis_descartable()
    al, ctx = _preparar(monkeypatch, h)
    de_acuerdo = SimpleNamespace(auditoria=F.AuditoriaDescarte(mejor_argumento_a_favor="", acuerdo=True, comprobacion_discutida="", motivo="Se sostiene."))
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "auditar_descarte": de_acuerdo}))
    asyncio.run(PASOS._killer(ctx, h, "", None))
    asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None))
    x = _hip(al, h)
    assert x["estado"] == "en_revision" and len(_decisiones(al, h)) == 2
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "El Killer propone descartarla en este contexto"] == ["abierto"], "el segundo juicio actualiza el hallazgo, no lo duplica"
    assert len(_eventos(al, "Decide tú.")) == 1 and not _eventos(al, "Decide tu.")
    # Llega evidencia que arregla la afirmación y la novedad ya está comprobada: el Killer deja avanzar.
    def arreglar(e):
        y = next(z for z in e["hipotesis"] if z["id"] == h["id"])
        y["afirmaciones"][1]["veredicto"] = "sostenida"
        _con_novedad_comprobada(y)
        return True

    al.mutar(arreglar, "prueba")
    decision = asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None))
    x = _hip(al, h)
    assert decision == "avanzar" and x["decisionKiller"] == "avanzar" and x["estado"] == "propuesta"
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "El Killer propone descartarla en este contexto"] == ["atendido"]
    assert x["hallazgos"][0]["respuestaDeRosa"].startswith("Retirada en la versión 1")
    assert _eventos(al, "retira la propuesta de descarte") and "descartada_por_killer" not in x["bloqueos"]


def test_una_persona_que_reabre_y_luego_avanzar_acaba_en_propuesta_pero_la_ultima_palabra_humana_se_respeta(monkeypatch):
    from rosa.estado import acciones as A

    h = _con_novedad_comprobada(_hipotesis())
    al, ctx = _preparar(monkeypatch, h)
    al.mutar(lambda e: A.revisar_hipotesis(e, h["id"], "reabrir", "quiero verla otra vez", "Dra. Prueba", 5), "prueba")
    assert _hip(al, h)["estado"] == "en_revision" and _hip(al, h)["decisionKiller"] is None
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}))
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None)) == "avanzar"
    assert _hip(al, h)["estado"] == "propuesta"
    # Una hipótesis en revisión por decisión humana posterior al Killer no cambia de estado sola.
    h2 = _con_novedad_comprobada(_hipotesis(titulo="Segunda GENHEP"))
    h2["decisionKiller"] = "descartar_en_contexto"
    h2["estado"] = "en_revision"
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")
    al.mutar(lambda e: e["decisiones"].append({"id": "dec-p", "investigacionId": "inv", "hipotesisId": h2["id"], "etapa": "persona", "decision": "refinar", "fecha": 10**13}) or True, "prueba")
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h2), "", None)) == "avanzar"
    assert _hip(al, h2)["estado"] == "en_revision"


# ---------------------------------------------------------------------------
# S-11: reformular por novedad no recurre
# ---------------------------------------------------------------------------


def _reformulacion(kwargs: dict[str, Any]) -> SimpleNamespace:
    t = F.TarjetaPropuesta(diana="GENHEP", celula="astrocitos", etapa="preclínica", intervencion="", direccion="sin_intervencion", prediccion_falsable="GENHEP en LCR mayor en amiloide positivos", riesgos=[], paso_ruta="mecanismo")
    return SimpleNamespace(reformulacion=F.ReformulacionPropuesta(titulo="GENHEP en astrocitos, reescrita", enunciado="GENHEP sube en astrocitos reactivos antes que NfL en la fase preclínica", mecanismo="m", biomarcador="GENHEP", cohorte="c", diseno="longitudinal", tarjeta=t, que_cambio="Se añadió la temporalidad."))


def test_reformular_por_novedad_no_vuelve_a_juzgar_de_inmediato(monkeypatch):
    h = _hipotesis()
    h["novedad"]["precedente"] = {"estado": "ya_publicado", "detalle": "Ya publicado o muy cercano: Willis 2024 (puntuación 9/10)"}
    al, ctx = _preparar(monkeypatch, h)
    llamadas: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "reformular": _reformulacion}, llamadas))
    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    x = _hip(al, h)
    assert decision == "reformular" and x["version"] == 2 and x["titulo"].endswith("reescrita")
    assert [n for n, _ in llamadas if n == "killer"] == ["killer"], "la versión nueva no se juzga con el precedente de la vieja"
    assert x["_revisionPedida"] is True and len(_decisiones(al, h)) == 1
    assert x["novedad"]["precedente"]["estado"] == "no_comprobado" and PASOS.novedad_pendiente(x)
    # Reformular por algo que no depende de una consulta externa (falsabilidad) sí recurre.
    h2 = _con_novedad_comprobada(_hipotesis(titulo="Sin predicción", tarjeta={"diana": "GENHEP", "celula": "astrocitos reactivos", "etapa": "", "intervencion": "", "direccion": "sin_intervencion", "prediccionFalsable": "", "riesgos": [], "pasoRuta": "mecanismo"}))
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")
    llamadas.clear()
    asyncio.run(PASOS._killer(ctx, h2, "", None))
    assert [n for n, _ in llamadas if n == "killer"] == ["killer", "killer"] and _hip(al, h2)["version"] == 2
    assert "_revisionPedida" not in _hip(al, h2), "la cadena de reformulaciones dentro del paso deja la petición atendida"


# ---------------------------------------------------------------------------
# S-13 y S-08: torneo sin revanchas sin evidencia nueva, tarjeta con lo acumulado
# ---------------------------------------------------------------------------


def _comparar(kwargs: dict[str, Any]) -> SimpleNamespace:
    gana_a = kwargs["hipotesis_a"].startswith("Título: Primera")
    return SimpleNamespace(comparacion=F.Comparacion(mejor="A" if gana_a else "B", eje="utilidad", resumen="La primera es más útil", relacion="distintas"))


def test_torneo_no_rejuega_un_par_sin_evidencia_nueva_salvo_forzado(monkeypatch):
    h1 = _hipotesis(titulo="Primera GENHEP")
    h2 = _hipotesis(titulo="Segunda GENHEP")
    al, ctx = _preparar(monkeypatch, h1, h2)
    llamadas: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(Ctx, "llamar", _llamar({"comparar": _comparar}, llamadas))
    pista = ctx.pista(None, "modelo", "torneo de prueba", "juez simulado")
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 1
    x1, x2 = _hip(al, h1), _hip(al, h2)
    assert x1["elo"] > 1500 > x2["elo"] and x1["partidos"][0]["_huellaPropia"] == K.huella_evidencia(x1) and x1["partidos"][0]["_huellaRival"] == K.huella_evidencia(x2)
    assert "_huellaPropia" not in al.instantanea()["hipotesis"][0]["partidos"][0], "la huella es privada: no viaja al navegador"
    elos = (x1["elo"], x2["elo"])
    llamadas.clear()
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 0 and llamadas == [], "misma evidencia: no se rejuega ni se llama al juez"
    assert (_hip(al, h1)["elo"], _hip(al, h2)["elo"]) == elos
    # Evidencia nueva en una de las dos: la huella cambia y el par vuelve a jugarse.
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == h1["id"])["afirmaciones"].append(_afirmacion(afirmacionId="af-nueva", texto="GENHEP increases in CSF too")) or True, "prueba")
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 1 and len(_hip(al, h1)["partidos"]) == 2
    # Redundancia declarada por el Killer: el partido dirimente se juega aunque nada cambie.
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == h1["id"]).__setitem__("redundanteCon", [h2["id"]]) or True, "prueba")
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 1 and len(_hip(al, h1)["partidos"]) == 3
    # Partidos antiguos sin huella: se juegan una vez más (no se dan por repetidos).
    viejo_a = {"id": "a", "estado": "propuesta", "elo": 1500, "partidos": [{"rivalId": "b", "resultado": "gano"}], "rivales": ["b"], "afirmaciones": [], "procedencia": {"fuentes": []}}
    viejo_b = {"id": "b", "estado": "propuesta", "elo": 1490, "partidos": [{"rivalId": "a", "resultado": "perdio"}], "rivales": ["a"], "afirmaciones": [], "procedencia": {"fuentes": []}}
    pares, saltados, huellas = PASOS.pares_del_torneo([viejo_a, viejo_b], [], 1)
    assert len(pares) == 1 and saltados == 0 and set(huellas) == {"a", "b"}
    viejo_a["partidos"][0].update(_huellaPropia=huellas["a"], _huellaRival=huellas["b"])
    viejo_b["partidos"][0].update(_huellaPropia=huellas["b"], _huellaRival=huellas["a"])
    assert PASOS.pares_del_torneo([viejo_a, viejo_b], [], 1)[:2] == ([], 1)
    # Los huecos de las revanchas saltadas se rellenan con pares nunca jugados de Elo cercano.
    viejo_c = {"id": "c", "estado": "propuesta", "elo": 1480, "partidos": [], "rivales": [], "afirmaciones": [], "procedencia": {"fuentes": []}}
    viejo_d = {"id": "d", "estado": "propuesta", "elo": 1470, "partidos": [{"rivalId": "a", "resultado": "perdio"}], "rivales": ["a"], "afirmaciones": [], "procedencia": {"fuentes": []}}
    pares, saltados, _ = PASOS.pares_del_torneo([viejo_a, viejo_b, viejo_c, viejo_d], [], 1)
    assert saltados >= 0 and pares and all(y["id"] not in (x.get("rivales") or []) for x, y in pares), "no se rejuega lo estancado; se juega lo nunca jugado"
    assert {frozenset((x["id"], y["id"])) for x, y in pares} <= {frozenset(("c", "a")), frozenset(("c", "b")), frozenset(("c", "d")), frozenset(("d", "b"))}


def test_la_tarjeta_del_torneo_y_el_texto_del_killer_llevan_lo_acumulado_ordenado_por_relacion():
    afs = [_afirmacion(afirmacionId=f"af-{i}", texto=f"Afirmación número {i} sobre GENHEP") for i in range(12)]
    afs[0]["relacion"] = "contradice"
    afs[1]["relacion"] = "socava"
    afs[2]["relacion"] = "apoya_indirecta"
    afs[3]["veredicto"] = "sin_verificar"
    h = _hipotesis(afirmaciones=afs, supuestos=[{"id": "s", "texto": "S", "estado": "plausible", "evidencia": "e", "hijos": []}])
    texto = PASOS.hipotesis_para_torneo(h)
    lineas = [l for l in texto.split("Supuestos:")[0].split("\n") if l.startswith("  - [")]
    assert len(lineas) == 12, "antes solo las 8 primeras"
    assert lineas[0].startswith("  - [sostenida] Afirmación número 4") and lineas[-1].startswith("  - [sostenida, EN CONTRA de la hipótesis] Afirmación número 0")
    assert "número 3" in lineas[8] and "sin_verificar" in lineas[8] and "indirecta" in lineas[9] and "SOCAVA" in lineas[-2]
    corto = PASOS.hipotesis_para_torneo(h, maximo=200)
    assert "más no se listan por tope de caracteres" in corto and corto.count("  - [") < 12
    assert "Revisiones automáticas" in texto
    killer = PASOS.texto_afirmaciones_killer(h)
    assert killer.count("- [") == 12 and killer.startswith("- [sostenida, dato, clase literatura] Afirmación número 4") and "EN CONTRA de la hipótesis] Afirmación número 0" in killer.split("\n")[-2]
    assert PASOS.texto_afirmaciones_killer({"afirmaciones": None}) == "Ninguna"
    assert PASOS.texto_afirmaciones_killer({"afirmaciones": [None, "x", {"texto": "solo texto"}]}).startswith("- [sin_verificar, dato")
    assert PASOS.afirmaciones_ordenadas("basura") == [] and PASOS.recortar_lineas([], 10) == ""


# ---------------------------------------------------------------------------
# M-21: las contras no entran en la dirección de la evidencia
# ---------------------------------------------------------------------------


def test_direccion_de_la_evidencia_deja_las_contras_aparte():
    h = _hipotesis(afirmaciones=[_afirmacion(afirmacionId="af-1", texto="GENHEP increases in reactive astrocytes"), _afirmacion(afirmacionId="af-2", texto="GENHEP decreases in plasma of controls", relacion="contradice"), _afirmacion(afirmacionId="af-3", texto="GENHEP is lower after treatment", socavadaPor=["af-1"])])
    e = {"hipotesis": [h], "hechos": []}
    deterministas = PASOS.comprobaciones_con_contras_aparte(h, K.comprobaciones_deterministas(h, e))
    c = {x["comprobacion"]: x for x in deterministas}
    assert c["direccion_evidencia"]["resultado"] == "pasa" and "1 afirmaciones con dirección sube" in c["direccion_evidencia"]["detalle"]
    assert "2 afirmaciones en contra o que socavan un apoyo quedan fuera" in c["direccion_evidencia"]["detalle"] and "GRADE" in c["direccion_evidencia"]["detalle"]
    assert c["fidelidad_evidencia"]["resultado"] == "pasa" and "2 en contra" in c["fidelidad_evidencia"]["detalle"]
    decision, _ = K.decidir(deterministas, True, 1)
    assert decision != "reformular"
    # Sin contras no se toca nada; con una hipótesis rota tampoco rompe.
    sin = _hipotesis()
    det = K.comprobaciones_deterministas(sin, e)
    assert PASOS.comprobaciones_con_contras_aparte(sin, det) is det
    assert PASOS.comprobaciones_con_contras_aparte({"afirmaciones": [None, {"relacion": "contradice"}]}, []) == []
    assert PASOS.es_contra({"socavadaPor": "af-1"}) and not PASOS.es_contra({"socavadaPor": ""}) and not PASOS.es_contra(None) and PASOS.es_contra({"relacion": "socava"})


# ---------------------------------------------------------------------------
# Fuentes acumuladas y textos
# ---------------------------------------------------------------------------


def test_fuentes_de_hipotesis_cae_a_otras_corridas_y_a_la_copia_publica(monkeypatch):
    h = _hipotesis()
    h["procedencia"]["fuentes"] = [{"id": "f-aqui", "referencia": "A"}, {"id": "f-otra", "referencia": "B"}, {"id": "f-publica", "referencia": "C", "riesgoSesgo": {"global": "bajo", "instrumento": "RoB 2"}}, {"sin_id": True}]
    al, ctx = _preparar(monkeypatch, h)
    al.mutar(lambda e: (next(c for c in e["corridas"] if c["id"] == ctx.corrida_id).setdefault("_fuentes", {}).__setitem__("f-aqui", {"id": "f-aqui", "privada": "esta"}), e["corridas"].append({"id": "cor-vieja", "investigacionId": "inv", "_fuentes": {"f-otra": {"id": "f-otra", "privada": "vieja"}}})) and True, "prueba")
    fuentes = PASOS._fuentes_de_hipotesis(ctx, _hip(al, h))
    assert [f["id"] for f in fuentes] == ["f-aqui", "f-otra", "f-publica"]
    assert fuentes[0]["privada"] == "esta" and fuentes[1]["privada"] == "vieja" and fuentes[2]["riesgoSesgo"]["global"] == "bajo"
    from rosa import sesgo as SESGO

    assert SESGO.comprobacion_sesgo(fuentes)["resultado"] == "pasa", "el sesgo se evalúa sobre lo acumulado, no solo sobre la corrida actual"


def test_textos_del_killer_con_tildes_y_sin_guiones_largos():
    fuente = inspect.getsource(PASOS)
    assert "\u2014" not in fuente
    assert "Decide tu." not in fuente and "Decide tú." in fuente
    for f in (PASOS._registrar_juez_sin_respuesta, PASOS.validar_supuesto_evaluado, PASOS.fusionar_supuestos, PASOS.comprobaciones_con_contras_aparte, PASOS.pares_del_torneo, PASOS.indice_auditoria, PASOS._auditar_descarte, PASOS._revisar_hipotesis):
        doc = f.__doc__ or ""
        assert doc and not any(p in doc.lower() for p in (" hipotesis", " revision ", " auditoria", " decision ", " evaluacion", " version ")), f.__name__


# ---------------------------------------------------------------------------
# Adversario del grupo B2 (17 de septiembre de 2026): lo que se rompió al
# intentar romper el cambio, cada uno con su test de regresión.
# ---------------------------------------------------------------------------


def test_la_ultima_palabra_humana_se_respeta_con_fechas_reales(monkeypatch):
    """`_hubo_accion_humana_despues` comparaba la fecha de la decisión humana con
    la de la ÚLTIMA decisión del Killer, que es la que el propio Killer acaba de
    registrar (fecha = ahora): la persona nunca podía ser posterior y la
    protección solo funcionaba con fechas del futuro. Aquí las fechas son reales:
    Killer (t1) propone descartar, persona (t2 > t1) decide, Killer (ahora)
    dice avanzar. La hipótesis se queda como la dejó la persona."""
    from rosa.estado import acciones as A

    h = _con_novedad_comprobada(_hipotesis())
    h["decisionKiller"] = "descartar_en_contexto"
    h["estado"] = "en_revision"
    h["hallazgos"].append({"id": "hal-x", "tipo": "conclusion_no_sigue", "resumen": "El Killer propone descartarla en este contexto", "razonamiento": "x", "estado": "abierto", "respuestaDeRosa": None})
    al, ctx = _preparar(monkeypatch, h)
    t1 = PASOS.P.ahora_ms() - 60_000
    al.mutar(lambda e: e["decisiones"].append({"id": "dec-k", "investigacionId": "inv", "hipotesisId": h["id"], "etapa": "killer_1", "decision": "descartar_en_contexto", "fecha": t1}) or True, "prueba")
    al.mutar(lambda e: e["decisiones"].append({"id": "dec-p", "investigacionId": "inv", "hipotesisId": h["id"], "etapa": "persona", "decision": "refinar", "fecha": t1 + 1_000}) or True, "prueba")
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}))
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None)) == "avanzar"
    assert _hip(al, h)["estado"] == "en_revision", "la última palabra fue de una persona: el Killer no le cambia el estado"
    assert not PASOS._hubo_accion_humana_despues({"decisiones": [{"hipotesisId": "z", "etapa": "killer_1", "fecha": 5}, {"hipotesisId": "z", "etapa": "persona", "fecha": 3}]}, {"id": "z"})
    assert PASOS._hubo_accion_humana_despues({"decisiones": [{"hipotesisId": "z", "etapa": "killer_1", "fecha": 5}, {"hipotesisId": "z", "etapa": "persona", "fecha": 7}, {"id": "nueva", "hipotesisId": "z", "etapa": "killer_1", "fecha": 9}]}, {"id": "z"}, excluir_id="nueva")


def test_un_comentario_o_una_aclaracion_pendientes_mantienen_en_revision_pero_cierran_el_hallazgo(monkeypatch):
    """Un comentario de la persona (acciones.enviar_comentarios) o una aclaración
    de ROSA2018 tras 'no puedo juzgar' dejan la hipótesis en_revision porque hay un
    diálogo abierto. Si después el Killer retira su propuesta de descarte, el
    hallazgo se atiende (ya no propone descartarla) pero el estado no se toca:
    lo decide la persona que está mirando."""
    from rosa.estado import acciones as A

    h = _con_novedad_comprobada(_hipotesis())
    h["decisionKiller"] = "descartar_en_contexto"
    h["estado"] = "en_revision"
    h["hallazgos"].append({"id": "hal-x", "tipo": "conclusion_no_sigue", "resumen": "El Killer propone descartarla en este contexto", "razonamiento": "x", "estado": "abierto", "respuestaDeRosa": None})
    al, ctx = _preparar(monkeypatch, h)
    al.mutar(lambda e: A.enviar_comentarios(e, h["id"], "¿Y la cohorte de validación?", "Dra. Prueba", PASOS.P.ahora_ms()), "prueba")
    assert _hip(al, h)["revisiones"][-1]["accion"] == "comentada"
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}))
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None)) == "avanzar"
    x = _hip(al, h)
    assert x["estado"] == "en_revision" and x["decisionKiller"] == "avanzar"
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "El Killer propone descartarla en este contexto"] == ["atendido"]
    assert not _eventos(al, "vuelve a la cola como propuesta")
    # Aclaración de ROSA2018 tras "no puedo juzgar": igual.
    h2 = _con_novedad_comprobada(_hipotesis(titulo="Segunda GENHEP"))
    h2["decisionKiller"] = "descartar_en_contexto"
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")
    al.mutar(lambda e: A.revisar_hipotesis(e, h2["id"], "no_puedo_juzgar", "No entiendo la cohorte", "Dra. Prueba", PASOS.P.ahora_ms()), "prueba")
    al.mutar(lambda e: A.aclarar_hipotesis(e, h2["id"], "La cohorte es la de descubrimiento", PASOS.P.ahora_ms()), "prueba")
    assert _hip(al, h2)["estado"] == "en_revision"
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h2), "", None)) == "avanzar"
    assert _hip(al, h2)["estado"] == "en_revision"


def test_avanzar_saca_de_en_revision_aunque_la_decision_anterior_ya_fuera_avanzar(monkeypatch):
    """Caso del estado real (hip-mtvulxbp-150): en_revision por una propuesta de
    descarte antigua, con el hallazgo abierto, y la decisión ya en 'avanzar'
    porque el código anterior no restauraba el estado. Mirar solo la decisión
    anterior la dejaba atascada para siempre: el hallazgo abierto también dice
    que la revisión la abrió el Killer."""
    h = _con_novedad_comprobada(_hipotesis())
    h["decisionKiller"] = "avanzar"
    h["estado"] = "en_revision"
    h["hallazgos"].append({"id": "hal-x", "tipo": "conclusion_no_sigue", "resumen": "El Killer propone descartarla en este contexto", "razonamiento": "x", "estado": "abierto", "respuestaDeRosa": None})
    al, ctx = _preparar(monkeypatch, h)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}))
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None)) == "avanzar"
    x = _hip(al, h)
    assert x["estado"] == "propuesta" and [z["estado"] for z in x["hallazgos"] if z["resumen"].startswith("El Killer propone")] == ["atendido"]
    # Una hipótesis en_revision sin rastro del Killer (ni decisión de descarte ni hallazgo) no se toca.
    h2 = _con_novedad_comprobada(_hipotesis(titulo="Segunda GENHEP"))
    h2["estado"] = "en_revision"
    al.mutar(lambda e: e["hipotesis"].append(h2) or True, "prueba")
    assert asyncio.run(PASOS._killer(ctx, _hip(al, h2), "", None)) == "avanzar"
    assert _hip(al, h2)["estado"] == "en_revision"


def test_a_la_tercera_sin_juez_la_decision_lleva_huella(monkeypatch):
    """La suspensión técnica del tope también guarda la huella de la evidencia:
    rosa/bucle/corrida.py::pedir_revision_por_huella la compara para pedir
    revisión solo cuando cambie; sin huella comparaba con una decisión vieja y
    volvía a pedir tres juicios más sobre la misma evidencia."""
    h = _hipotesis()
    al, ctx = _preparar(monkeypatch, h)
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": RuntimeError("timeout")}))
    for _ in range(3):
        asyncio.run(PASOS._killer(ctx, _hip(al, h), "", None))
    x = _hip(al, h)
    d = _decisiones(al, h)[-1]
    assert d["sinJuez"] is True and d["huella"] == K.huella_evidencia(x) and x["_huellaKiller"] == d["huella"]


def test_el_torneo_rejuega_una_vez_tras_tablas_y_no_dos(monkeypatch):
    """Tablas (el juez cambió de opinión al invertir A y B) no es un resultado:
    el par se rejuega una vez con la misma evidencia; si vuelven a ser tablas,
    ya no (el Elo no se mueve y el juez no aporta)."""
    h1 = _hipotesis(titulo="Primera GENHEP")
    h2 = _hipotesis(titulo="Segunda GENHEP")
    al, ctx = _preparar(monkeypatch, h1, h2)
    siempre_a = SimpleNamespace(comparacion=F.Comparacion(mejor="A", eje="utilidad", resumen="Gana la que va primero", relacion="distintas"))
    llamadas: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(Ctx, "llamar", _llamar({"comparar": siempre_a}, llamadas))
    pista = ctx.pista(None, "modelo", "torneo de prueba", "juez simulado")
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 1 and _hip(al, h1)["partidos"][-1]["resultado"] == "tablas"
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 1, "tras tablas se rejuega una vez"
    assert len(_hip(al, h1)["partidos"]) == 2 and all(p["resultado"] == "tablas" for p in _hip(al, h1)["partidos"])
    llamadas.clear()
    assert asyncio.run(PASOS._torneo(ctx, pista)) == 0 and llamadas == [], "dos tablas seguidas con la misma evidencia: no se insiste"
    assert _hip(al, h1)["elo"] == _hip(al, h2)["elo"] == 1500


def test_auditoria_recalculada_a_reformular_no_deja_la_hipotesis_en_revision_con_el_hallazgo_abierto(monkeypatch):
    """Killer: descartar (fidelidad falla) con la tarjeta sin predicción. La
    auditoría discute la fidelidad; la regla recalcula a 'reformular' (queda
    falsabilidad). La hipótesis no puede quedarse en_revision con 'El Killer
    propone descartarla' abierto y la decisión en 'reformular': vuelve a
    propuesta con el hallazgo atendido y el 'Decide tú' con las dos posturas."""
    h = _hipotesis_descartable()
    h["tarjeta"]["prediccionFalsable"] = ""
    al, ctx = _preparar(monkeypatch, h)
    auditoria = SimpleNamespace(auditoria=F.AuditoriaDescarte(mejor_argumento_a_favor="La cifra está en otra tabla de la misma fuente", acuerdo=False, comprobacion_discutida="fidelidad_evidencia", motivo="El descarte no se sostiene."))
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer(), "auditar_descarte": auditoria}))
    decision = asyncio.run(PASOS._killer(ctx, h, "", None))
    x = _hip(al, h)
    ds = _decisiones(al, h)
    assert decision == "reformular" and [d["decision"] for d in ds] == ["descartar_en_contexto", "reformular"] and ds[1]["etapa"] == "killer_2"
    assert x["version"] == 1, "en la pasada de la auditoría no se reformula: decide la persona con las dos posturas"
    assert x["decisionKiller"] == "reformular" and x["estado"] == "propuesta"
    assert [z["estado"] for z in x["hallazgos"] if z["resumen"] == "El Killer propone descartarla en este contexto"] == ["atendido"]
    assert "descartada_por_killer" not in x["bloqueos"] and _eventos(al, "Recalculado por regla: reformular")


def test_un_supuesto_sin_evidencia_en_el_registro_no_cuenta_como_fallo_del_juez(monkeypatch):
    """Un supuesto antiguo sin la clave 'evidencia' hacía saltar un KeyError al
    montar el prompt del Killer, dentro del mismo try que la llamada al modelo:
    se contaba como 'el juez no respondió' (intento 1 de 3). El texto del prompt
    tolera los registros incompletos y el juez sí llega a responder."""
    # (Una cadena suelta en `supuestos` sigue tumbando K.comprobaciones_deterministas,
    # rosa/killer.py:128, grupo D; aquí solo los diccionarios incompletos.)
    h = _con_novedad_comprobada(_hipotesis(supuestos=[{"id": "s1", "texto": "Supuesto viejo", "estado": "plausible"}, {"id": "s2", "estado": "plausible"}]))
    al, ctx = _preparar(monkeypatch, h)
    llamadas: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(Ctx, "llamar", _llamar({"killer": _revision_killer()}, llamadas))
    assert asyncio.run(PASOS._killer(ctx, h, "", None)) == "avanzar"
    assert [n for n, _ in llamadas if n == "killer"] == ["killer"] and "Supuesto viejo" in llamadas[0][1]["supuestos"]
    assert not any(i["tipo"] == "juez_sin_respuesta" for i in al.estado["incidencias"])
