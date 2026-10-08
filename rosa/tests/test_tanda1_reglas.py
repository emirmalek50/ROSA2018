"""Tanda 1 de la revisión del 17 de septiembre de 2026, grupo D (reglas):
un test de regresión por arreglo, escritos para fallar sin el arreglo.

S-10 supuestos suspenden; huella_evidencia; S-11 novedad al reformular;
S-15 ampliar presupuesto sube la iteración; S-18 sintético fuera del techo;
S-19 coste desde el gateway; S-20 réplica sin caché y examen con rollout_id;
M-10 frases de introducción; M-04 y M-03 una sola cuenta de cohortes con
catálogo de ensayos; M-01 sin información no es riesgo alto; M-32 regla del
hash al enmendar una lectura.
"""

from __future__ import annotations

import copy

import pytest

from rosa import certeza as C
from rosa import config as CFG
from rosa import killer as K
from rosa import metodos as M
from rosa import priorizacion as PR
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen

AHORA = 1_800_000_000_000


@pytest.fixture
def al(tmp_path):
    return Almacen(tmp_path / "prueba.db")


def _fuente(i, cohorte, **k):
    return {"id": f"f{i}", "referencia": f"Ref {i}", "titulo": f"T{i}", "cohorte": cohorte, **k}


def _af(i, relacion=None, veredicto="sostenida", clase="literatura", **k):
    a = {"afirmacionId": f"af-{i}", "texto": f"afirmación {i}", "cita": f"[Ref {i}, pág. {i + 1}]", "veredicto": veredicto, "tipo": "dato", "clase": clase, "sintetico": False, "cohorte": "", **k}
    if relacion is not None:
        a["relacion"] = relacion
    return a


def _h(afirmaciones, fuentes, **k):
    return {"afirmaciones": afirmaciones, "procedencia": {"fuentes": fuentes}, **k}


def _comprobaciones(**resultados):
    base = {c: "pasa" for c in ("citas_reales", "fidelidad_evidencia", "supuestos", "independencia_cohortes", "novedad", "falsabilidad")}
    base.update(resultados)
    return [{"comprobacion": c, "resultado": r, "detalle": f"detalle de {c}"} for c, r in base.items()]


# ---------------------------------------------------------------------------
# S-10: un supuesto contradicho suspende, no descarta
# ---------------------------------------------------------------------------


def test_supuesto_contradicho_suspende_y_no_descarta():
    assert "supuestos" not in K.DESCARTAN and "supuestos" in K.SUSPENDEN and "supuestos" in K.CRITICAS
    decision, motivo = K.decidir(_comprobaciones(supuestos="falla"), tiene_prediccion=True, version=1)
    assert decision == "suspender" and "supuestos" in motivo and "más o mejor evidencia" in motivo
    # Las citas y la fidelidad siguen descartando: son la evidencia misma.
    assert K.decidir(_comprobaciones(citas_reales="falla"), True, 1)[0] == "descartar_en_contexto"
    assert K.decidir(_comprobaciones(fidelidad_evidencia="falla"), True, 1)[0] == "descartar_en_contexto"
    # Por el camino real: la hipótesis con el supuesto que Sonnet dio por contradicho.
    h = P.nueva_hipotesis("inv", 1, AHORA)
    h["afirmaciones"] = [_af(0)]
    h["procedencia"]["fuentes"] = [_fuente(0, "ADNI")]
    h["supuestos"] = [{"id": "s1", "texto": "El ensayo INVOKE-2 publica P-tau181 en plasma", "estado": "contradicho", "evidencia": "Ninguna afirmación menciona ese ensayo"}]
    c = K.comprobaciones_deterministas(h, {"hipotesis": [h]})
    assert next(x for x in c if x["comprobacion"] == "supuestos")["resultado"] == "falla"
    assert K.decidir(c, True, 1)[0] == "suspender"
    assert K.CONSECUENCIA["supuestos"] == "suspender"


def test_fusionar_supuestos_se_abstiene_si_el_juez_discrepa():
    det = [{"comprobacion": "supuestos", "resultado": "falla", "detalle": "1 supuestos contradichos"}]
    juez = [{"comprobacion": "supuestos", "resultado": "pasa", "detalle": "la premisa está sin comprobar, no refutada"}]
    salida = K.fusionar(copy.deepcopy(det), juez)
    assert salida[0]["resultado"] == "no_comprobable" and "juez discrepa" in salida[0]["detalle"]
    # Sin detalle del juez, la determinista se conserva.
    assert K.fusionar(copy.deepcopy(det), [{"comprobacion": "supuestos", "resultado": "pasa", "detalle": ""}])[0]["resultado"] == "falla"


def test_fusionar_no_deja_que_el_juez_resuelva_la_novedad_de_memoria():
    det = [{"comprobacion": "novedad", "resultado": "no_comprobable", "detalle": "No comprobado todavía para la versión 2: el enunciado cambió"}]
    for veredicto in ("pasa", "falla"):
        salida = K.fusionar(copy.deepcopy(det), [{"comprobacion": "novedad", "resultado": veredicto, "detalle": "Willis 2024 ya lo publicó"}])
        assert salida[0]["resultado"] == "no_comprobable" and "solo la resuelve la búsqueda" in salida[0]["detalle"], veredicto
    # Una novedad resuelta por la recuperación no la toca el juez tampoco (ya estaba hecha).
    hecha = [{"comprobacion": "novedad", "resultado": "pasa", "detalle": "Sin precedente claro"}]
    assert K.fusionar(copy.deepcopy(hecha), [{"comprobacion": "novedad", "resultado": "falla", "detalle": "x"}])[0]["resultado"] == "pasa"
    # El juez sí completa lo que la regla no pudo en otras comprobaciones.
    assert K.fusionar([{"comprobacion": "falsabilidad", "resultado": "no_comprobable", "detalle": ""}], [{"comprobacion": "falsabilidad", "resultado": "pasa", "detalle": "predicción medible"}])[0]["resultado"] == "pasa"


def test_novedad_no_comprobado_es_no_comprobable_en_el_killer():
    h = P.nueva_hipotesis("inv", 1, AHORA)
    h["novedad"]["precedente"] = {"estado": "no_comprobado", "detalle": "OpenAlex no respondió", "motivo": "fuente_caida"}
    c = {x["comprobacion"]: x for x in K.comprobaciones_deterministas(h, {"hipotesis": [h]})}
    assert c["novedad"]["resultado"] == "no_comprobable" and "OpenAlex" in c["novedad"]["detalle"]


# ---------------------------------------------------------------------------
# huella_evidencia
# ---------------------------------------------------------------------------


def test_huella_evidencia_cambia_con_evidencia_nueva_y_no_con_el_orden():
    h = P.nueva_hipotesis("inv", 1, AHORA)
    h["afirmaciones"] = [_af(0), _af(1, "apoya", socavadaPor=["af-9", "af-8"])]
    h["procedencia"]["fuentes"] = [_fuente(0, "ADNI"), _fuente(1, "A4")]
    h["supuestos"] = [{"texto": "a", "estado": "sin_evidencia"}, {"texto": "b", "estado": "sin_evidencia"}]
    base = K.huella_evidencia(h)
    assert isinstance(base, str) and len(base) == 16
    reordenada = copy.deepcopy(h)
    reordenada["afirmaciones"].reverse()
    reordenada["procedencia"]["fuentes"].reverse()
    reordenada["supuestos"].reverse()
    reordenada["afirmaciones"][0]["socavadaPor"] = ["af-8", "af-9"]
    assert K.huella_evidencia(reordenada) == base
    # Lo que no es evidencia no la cambia: partidos, Elo, conclusión.
    ruido = copy.deepcopy(h)
    ruido["partidos"] = [{"rival": "x"}]
    ruido["elo"] = 1400
    ruido["conclusion"] = {"certeza": "baja"}
    assert K.huella_evidencia(ruido) == base
    # Lo que sí: una afirmación nueva, un veredicto, una relación, un supuesto, la novedad, la versión.
    con_nueva = copy.deepcopy(h)
    con_nueva["afirmaciones"].append(_af(2))
    assert K.huella_evidencia(con_nueva) != base
    veredicto = copy.deepcopy(h)
    veredicto["afirmaciones"][0]["veredicto"] = "no_sostenida"
    assert K.huella_evidencia(veredicto) != base
    supuesto = copy.deepcopy(h)
    supuesto["supuestos"][0]["estado"] = "contradicho"
    assert K.huella_evidencia(supuesto) != base
    novedad = copy.deepcopy(h)
    novedad["novedad"]["precedente"]["estado"] = "ya_publicado"
    assert K.huella_evidencia(novedad) != base
    version = copy.deepcopy(h)
    version["version"] = 2
    assert K.huella_evidencia(version) != base
    # Registros antiguos y formas rotas no rompen.
    assert K.huella_evidencia({}) == K.huella_evidencia({"afirmaciones": None, "procedencia": "texto", "supuestos": [None], "novedad": []})
    assert K.huella_evidencia({"afirmaciones": [{"veredicto": "sostenida", "socavadaPor": "af-1"}]}) != K.huella_evidencia({})


# ---------------------------------------------------------------------------
# S-11: reformular reinicia la novedad de la versión nueva
# ---------------------------------------------------------------------------


def test_reformular_resetea_novedad_y_guarda_la_vieja_en_la_version(al):
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-t"})
    hid = al.aplicar("proponerHipotesis", {"investigacion_id": inv, "datos": {"titulo": "GFAP precede a NfL", "enunciado": "GFAP sube antes que NfL", "cohorte": "ADNI"}, "quien": "Rosa"})
    vieja = {"estado": "ya_publicado", "detalle": "Willis 2024 ya lo publicó", "url": "https://doi.org/x"}

    def plantar(e):
        h = next(x for x in e["hipotesis"] if x["id"] == hid)
        h["novedad"]["precedente"] = dict(vieja)
        h["novedad"]["patentes"] = {"estado": "hay_patente", "detalle": "US123", "url": None}
        h["novedad"]["financiacion"] = {"estado": "hay_proyecto", "detalle": "NIH R01", "url": None}
        h["novedad"]["genetica"] = {"estado": "asociacion", "detalle": "GWAS"}
        h["tarjeta"] = {**P.tarjeta_vacia(), "diana": "GFAP"}
        return True

    al.mutar(plantar)
    assert al.aplicar("reformularHipotesis", {"hipotesis_id": hid, "cambios": {"titulo": "GFAP precede a NfL en APOE4", "enunciado": "En portadores de APOE4, GFAP sube antes que NfL"}, "quien": "Rosa", "motivo": "novedad: ya publicado"}) is True
    h = next(x for x in al.estado["hipotesis"] if x["id"] == hid)
    n = h["novedad"]
    for clave in ("precedente", "patentes", "financiacion"):
        assert n[clave]["estado"] == "no_comprobado", clave
        assert n[clave]["detalle"].startswith("No comprobado todavía para la versión 2"), clave
    # Lo que depende del gen no se toca si la diana no cambió.
    assert n["genetica"] == {"estado": "asociacion", "detalle": "GWAS"}
    # La versión guardada conserva la novedad anterior.
    assert h["versiones"][-1]["novedad"]["precedente"] == vieja
    # El Killer ya no ve "ya publicado" en la versión nueva.
    c = {x["comprobacion"]: x for x in K.comprobaciones_deterministas(h, al.estado)}
    assert c["novedad"]["resultado"] == "no_comprobable"
    # Reformular sin cambiar título ni enunciado (solo la tarjeta) conserva lo comprobado.
    al.mutar(plantar)
    assert al.aplicar("reformularHipotesis", {"hipotesis_id": hid, "cambios": {"titulo": "GFAP precede a NfL en APOE4", "tarjeta": {"celula": "astrocito"}}, "quien": "Rosa", "motivo": "falsabilidad"}) is True
    h = next(x for x in al.estado["hipotesis"] if x["id"] == hid)
    assert h["novedad"]["precedente"] == vieja and h["version"] == 3


def test_reformular_con_diana_nueva_reinicia_lo_que_depende_del_gen(al):
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-t"})
    hid = al.aplicar("proponerHipotesis", {"investigacion_id": inv, "datos": {"titulo": "A", "enunciado": "B", "cohorte": "ADNI"}, "quien": "Rosa"})

    def plantar(e):
        h = next(x for x in e["hipotesis"] if x["id"] == hid)
        h["tarjeta"] = {**P.tarjeta_vacia(), "diana": "GFAP"}
        h["novedad"]["genetica"] = {"estado": "asociacion", "detalle": "GWAS"}
        return True

    al.mutar(plantar)
    assert al.aplicar("reformularHipotesis", {"hipotesis_id": hid, "cambios": {"titulo": "A2", "enunciado": "B2", "tarjeta": {"diana": "NEFL"}}, "quien": "Rosa", "motivo": "diana"}) is True
    h = next(x for x in al.estado["hipotesis"] if x["id"] == hid)
    assert h["novedad"]["genetica"]["estado"] == "no_comprobado" and "la diana cambió" in h["novedad"]["genetica"]["detalle"]


# ---------------------------------------------------------------------------
# S-15: ampliar el presupuesto sube también el tope de la iteración en curso
# ---------------------------------------------------------------------------


def test_ampliar_presupuesto_sube_el_limite_de_la_iteracion_en_curso(al):
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-t"})
    cid = al.aplicar("iniciarCorrida", {"investigacion_id": inv, "limite": 1500})

    def plantar(e):
        c = e["corridas"][0]
        c["estado"] = "pausada_por_presupuesto"
        c["gasto"]["llamadas"] = 400
        c["presupuesto"]["motivoPausa"] = "la iteración 1 gastó sus 30 llamadas"
        e["iteraciones"].append(P.nueva_iteracion(cid, 1, AHORA, [], limite=30))
        e["iteraciones"][-1]["presupuesto"]["usado"] = 30
        e["iteraciones"].append(P.nueva_iteracion(cid, 2, AHORA + 1, [], limite=30))
        e["iteraciones"][-1]["presupuesto"]["usado"] = 30
        return True

    al.mutar(plantar)
    assert al.aplicar("ampliarPresupuesto", {"corrida_id": cid, "nuevo_limite": 2000}) is True
    c = al.estado["corridas"][0]
    assert c["estado"] == "en_marcha" and c["presupuesto"]["limiteLlamadas"] == 2000 and c["presupuesto"]["motivoPausa"] == ""
    its = sorted(al.estado["iteraciones"], key=lambda i: i["numero"])
    assert its[1]["presupuesto"]["limite"] == 30 + 500, "la iteración en curso sube con el margen concedido"
    assert its[0]["presupuesto"]["limite"] == 30, "la anterior no se toca"
    assert "la iteración 2 puede gastar hasta 530" in al.estado["eventos"][-1]["texto"]
    # Sin margen (mismo tope) no cambia; con una iteración holgada no baja.
    al.mutar(lambda e: e["iteraciones"][-1]["presupuesto"].update(limite=5000, usado=10) or True)
    assert al.aplicar("ampliarPresupuesto", {"corrida_id": cid, "nuevo_limite": 2000}) is True
    assert al.estado["iteraciones"][-1]["presupuesto"]["limite"] == 5000
    # Registro antiguo: iteración sin presupuesto o con límite None no rompe.
    al.mutar(lambda e: e["iteraciones"][-1].update(presupuesto={"limite": None, "usado": 7}) or True)
    assert al.aplicar("ampliarPresupuesto", {"corrida_id": cid, "nuevo_limite": 2100}) is True
    assert al.estado["iteraciones"][-1]["presupuesto"]["limite"] == 7 + 100
    al.mutar(lambda e: e["iteraciones"][-1].pop("presupuesto") or True)
    assert al.aplicar("ampliarPresupuesto", {"corrida_id": cid, "nuevo_limite": 2200}) is True


# ---------------------------------------------------------------------------
# S-18: sintético fuera del techo
# ---------------------------------------------------------------------------


def test_datos_sinteticos_del_laboratorio_no_suben_el_techo():
    lit = _af(0)
    lab = {"afirmacionId": "lab", "texto": "GFAP cruza antes que NfL en 120 participantes", "cita": "[Datos del laboratorio: datos_gfap_nfl_sintetico.csv, 11/09/2026]", "veredicto": "sostenida", "tipo": "dato", "clase": "observacion_original", "sintetico": False, "trayectoria": {"id": "datos_gfap_nfl_sintetico.csv"}}
    h = _h([lit, dict(lab, sintetico=True)], [_fuente(0, "ADNI")])
    assert C.techo(h)[0] == "muy_baja" and C.evidencia_directa(h) == []
    # Registro antiguo con la bandera en falso: el nombre del fichero lo delata igual.
    h2 = _h([lit, lab], [_fuente(0, "ADNI")])
    assert C.es_sintetica(lab) and C.evidencia_directa(h2) == [] and C.techo(h2)[0] == "muy_baja"
    assert C.balance_pesos(h2)["aFavor"] == 1.0
    # El mismo dato con un fichero real sí es evidencia directa.
    real = dict(lab, cita="[Datos del laboratorio: gfap_nfl_2026.csv]", trayectoria={"id": "gfap_nfl_2026.csv"})
    assert not C.es_sintetica(real) and C.techo(_h([lit, real], [_fuente(0, "ADNI")]))[0] == "moderada"
    # Una afirmación de literatura no se marca por su cita aunque hable de datos sintéticos.
    assert not C.es_sintetica(dict(lit, cita="[Ref 0, pág. 3] synthetic data review", clase="literatura"))
    assert not C.es_sintetica({"tipo": "dato", "clase": "observacion_original", "trayectoria": None, "cita": None})


def test_registrar_datos_experimento_guarda_la_bandera_de_sintetico(al):
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-t"})
    hid = al.aplicar("proponerHipotesis", {"investigacion_id": inv, "datos": {"titulo": "A", "enunciado": "B", "cohorte": "ADNI"}, "quien": "Rosa"})
    al.mutar(lambda e: next(x for x in e["hipotesis"] if x["id"] == hid).update(experimento={"protocolo": "p", "estado": "propuesto"}) or True)
    assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": "gfap.csv", "analisis": "t de Student"}) is True
    x = next(h for h in al.estado["hipotesis"] if h["id"] == hid)["experimento"]
    assert x["datosSinteticos"] is False and x["estado"] == "datos_recibidos"
    assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": "gfap.csv", "analisis": "", "sintetico": "si"}) is True
    assert next(h for h in al.estado["hipotesis"] if h["id"] == hid)["experimento"]["datosSinteticos"] is True
    # El nombre del fichero fuerza la bandera aunque la casilla diga que no.
    assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": "datos_gfap_nfl_sintetico.csv", "analisis": "", "sintetico": False}) is True
    assert next(h for h in al.estado["hipotesis"] if h["id"] == hid)["experimento"]["datosSinteticos"] is True
    assert A.es_fichero_sintetico("gfap_dummy.csv") and A.es_fichero_sintetico("synthetic_v2.csv") and not A.es_fichero_sintetico("cohorte_real.csv") and not A.es_fichero_sintetico(None)
    # Sin experimento o con fichero vacío, False sin lanzar.
    assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": "   ", "analisis": ""}) is False


# ---------------------------------------------------------------------------
# S-19: el coste que manda es el del gateway
# ---------------------------------------------------------------------------


def test_coste_desde_uso_prefiere_el_coste_del_gateway():
    uso = {"prompt_tokens": 100_000, "completion_tokens": 10_000, "cost": 0.1387925, "market_cost": 0.14, "gateway_cost": 0.13}
    assert CFG.coste_desde_uso(uso, "openai/anthropic/claude-opus-5") == (0.138793, True)
    # Sin `cost` (o cero, o texto raro) cae a la tabla, y lo dice.
    estimado, real = CFG.coste_desde_uso({"prompt_tokens": 1_000_000, "completion_tokens": 0}, "openai/anthropic/claude-sonnet-5")
    assert (estimado, real) == (2.0, False)
    assert CFG.coste_usd("openai/anthropic/claude-sonnet-5.5", 1_000_000, 1_000_000) == 12.0
    assert CFG.coste_desde_uso({"cost": 0, "prompt_tokens": 1_000_000}, "anthropic/claude-opus-5") == (5.0, False)
    assert CFG.coste_desde_uso({"cost": "no sé", "prompt_tokens": 1_000_000}, "anthropic/claude-opus-5") == (5.0, False)
    assert CFG.coste_desde_uso({"cost": True, "prompt_tokens": "x"}, "anthropic/claude-opus-5") == (0.0, False)
    assert CFG.coste_desde_uso(None, "") == (0.0, False) and CFG.coste_desde_uso("raro", None) == (0.0, False)
    # La tabla de respaldo lleva los precios reales del 17 de septiembre de 2026.
    assert CFG.PRECIOS_FECHA == "2026-09-17"
    assert CFG.coste_usd("openai/gpt-6-astra", 1_000_000, 1_000_000) == pytest.approx(12.08 + 50.99)
    assert CFG.coste_usd("openai/anthropic/claude-opus-5", 1_000_000, 0) == 5.0 and CFG.coste_usd("anthropic/claude-sonnet-5", 0, 1_000_000) == 10.0


def test_gepa_on_lm_end_acumula_usd_real_aparte():
    from rosa import gepa_continuo as G

    class Registro:
        def __init__(self):
            self.filas = []

        def guardar(self, tipo, datos):
            self.filas.append((tipo, datos))

    class LM:
        model = "openai/anthropic/claude-sonnet-5"

        def __init__(self, uso):
            self.history = [{"messages": [{"role": "user", "content": "hola"}], "prompt": None, "outputs": ["ok"], "usage": uso}]

    gasto = {}
    t = G.Trazador(Registro(), gasto=gasto)
    entradas = {"messages": [{"role": "user", "content": "hola"}], "prompt": None}
    t.on_lm_start("c1", LM({"prompt_tokens": 1_000_000, "completion_tokens": 0, "cost": 1.5}), entradas)
    t.on_lm_end("c1", ["ok"])
    assert gasto["usd"] == 1.5 and gasto["usdReal"] == 1.5 and gasto["llamadas"] == 1
    t.on_lm_start("c2", LM({"prompt_tokens": 1_000_000, "completion_tokens": 0}), entradas)
    t.on_lm_end("c2", ["ok"])
    assert gasto["usd"] == 3.5 and gasto["usdReal"] == 1.5 and gasto["usdEstimadoEnLlamadas"] == 1


# ---------------------------------------------------------------------------
# S-20: la réplica no usa caché; el examen lee con rollout_id 0 y 1
# ---------------------------------------------------------------------------


def test_replica_sin_cache_y_el_resto_con_ella(monkeypatch):
    from rosa import gateway as GW

    monkeypatch.setenv("ROSA_GATEWAY_KEY", "clave-de-prueba")
    m = GW.modelos()
    assert m.volumen.model == "openai/anthropic/claude-sonnet-5.5"
    assert m.volumen.kwargs.get("temperature") is None
    assert m.replica.cache is False and m.replica.kwargs["temperature"] == 1.0
    assert m.juez.cache is True and m.cerebro.cache is True and m.volumen.cache is True
    copia = m.juez.copy(rollout_id=1)
    assert copia.kwargs["rollout_id"] == 1 and "rollout_id" not in m.juez.kwargs
    assert "rollout_id" in GW.lm.__doc__ and "cache=False" in GW.lm.__doc__


def test_el_examen_de_gepa_construye_dos_jueces_con_rollout_id_distinto():
    import inspect

    from rosa import gepa_continuo as G

    fuente = inspect.getsource(G)
    assert "self.modelos.juez.copy(rollout_id=k)" in fuente and "for k in (0, 1)" in fuente
    assert "for _ in range(2)" not in fuente
    # LMConParada conserva los kwargs de la copia (ahí viaja el rollout_id).
    juez = G.dspy.LM("openai/anthropic/claude-opus-5", api_base="http://x", api_key="k", temperature=1.0).copy(rollout_id=1)
    con_parada = G.LMConParada(juez, lambda: "")
    assert con_parada.kwargs["rollout_id"] == 1


# ---------------------------------------------------------------------------
# M-10: frases de introducción pesan 0,25 y no aportan cohorte
# ---------------------------------------------------------------------------


def test_afirmacion_de_fondo_pesa_un_cuarto_y_no_da_cohorte():
    f0, f1 = _fuente(0, "BIOCARD"), _fuente(1, "ADNI")
    a_resultados = _af(0, "apoya")
    a_intro = _af(1, "apoya", cita="[Ref 1, sección Introduction]")
    r = C.peso_afirmacion(a_intro, f1)
    assert r["peso"] == 0.25 and [f["factor"] for f in r["factores"]] == ["relacion", "diseno", "sesgo", "n", "seccion"]
    assert "introducción" in r["factores"][-1]["motivo"] and "no aporta cohorte" in r["factores"][-1]["motivo"]
    assert C.peso_afirmacion(a_resultados, f0)["peso"] == 1.0 and [f["factor"] for f in C.peso_afirmacion(a_resultados, f0)["factores"]] == ["relacion", "diseno", "sesgo", "n"]
    # La bandera explícita manda sobre la cita, en las dos direcciones.
    assert C.peso_afirmacion(dict(a_intro, deFondo=False), f1)["peso"] == 1.0
    assert C.peso_afirmacion(dict(a_resultados, deFondo=True), f0)["peso"] == 0.25
    assert C.peso_afirmacion(_af(2, "apoya", cita="[Ref 2, sección Discussion]"), f0)["peso"] == 1.0, "la discusión no es fondo"
    # Dos artículos que citan el mismo estudio en su introducción no son dos cohortes.
    h = _h([a_resultados, a_intro], [f0, f1])
    assert C.cohortes_distintas(h) == ["BIOCARD"] and C.techo(h)[0] == "muy_baja"
    assert "frases de introducción" in C.techo(h)[1] and C.balance_pesos(h)["aFavor"] == 1.25
    # La misma fuente con una afirmación de resultados sí aporta cohorte.
    h2 = _h([a_resultados, a_intro, _af(3, "apoya", cita="[Ref 1, pág. 4]")], [f0, f1])
    assert C.cohortes_distintas(h2) == ["BIOCARD", "ADNI"] and C.techo(h2)[0] == "baja"
    assert any("introducción" in r for r in C._remedios_de_peso(C._Vista(h)))


# ---------------------------------------------------------------------------
# M-04 y M-03: una sola cuenta de cohortes, con el catálogo de ensayos
# ---------------------------------------------------------------------------


def test_cohortes_distintas_con_el_catalogo_de_ensayos():
    fs = [_fuente(i, n) for i, n in enumerate(["TRAILBLAZER-ALZ", "TRAILBLAZER-ALZ 2", "TRAILBLAZER-ALZ2", "TRAILBLAZER-ALZ (NCT03367403) y TRAILBLAZER-ALZ 2 (NCT04437511)", "NCT04437511", "Study 201 core", "study 201 (lecanemab)"])]
    assert M.cohortes_distintas(fs) == ["TRAILBLAZER-ALZ", "TRAILBLAZER-ALZ 2", "Study 201"]
    assert M.misma_cohorte("TRAILBLAZER-ALZ", "TRAILBLAZER-ALZ 2") is False and M.misma_cohorte("TRAILBLAZER-ALZ 2", "TRAILBLAZER-ALZ2") is True
    assert M.canonizar_cohorte("NCT04437511")["etiqueta"] == "TRAILBLAZER-ALZ 2" and M.canonizar_cohorte("CLARITY AD")["id"] == "cohorte:clarity_ad"
    # Nombres libres que solo difieren en el número no se funden; el mismo con y sin espacio sí.
    assert M.misma_cohorte("Cohorte Zeta 1", "Cohorte Zeta 2") is False and M.misma_cohorte("Cohorte Zeta 2", "Cohorte Zeta2") is True
    # "X (NCT...)" enseña que X es ese ensayo aunque no esté en el catálogo.
    grupos = M.agrupar_cohortes([_fuente(0, "Cohorte Zeta (NCT09999999)"), _fuente(1, "Cohorte Zeta"), _fuente(2, "NCT09999999")])
    assert len(grupos) == 1 and grupos[0]["ids"] == ["f0", "f1", "f2"]
    # Un número tras una palabra genérica no se pega: "Phase 2 and 3" no crea tokens falsos.
    assert M._tokens_cohorte("lecanemab Phase 2 and 3 studies") == {"lecanemab", "phase2", "studies"}
    # En certeza el par de ensayos distintos da dos cohortes (techo baja) y el mismo ensayo una (muy baja).
    assert C.techo(_h([_af(0, "apoya"), _af(1, "apoya")], [_fuente(0, "TRAILBLAZER-ALZ 2"), _fuente(1, "TRAILBLAZER-ALZ")]))[0] == "baja"
    assert C.techo(_h([_af(0, "apoya"), _af(1, "apoya")], [_fuente(0, "TRAILBLAZER-ALZ 2"), _fuente(1, "NCT04437511")]))[0] == "muy_baja"
    # El catálogo sigue siendo autoconsistente para las entradas nuevas.
    for e in M.COHORTES:
        if e["id"] in ("cohorte:trailblazer_alz", "cohorte:trailblazer_alz2", "cohorte:trailblazer_alz3", "cohorte:clarity_ad", "cohorte:study_201", "cohorte:emerge", "cohorte:engage", "cohorte:graduate_1", "cohorte:graduate_2", "cohorte:invoke_2"):
            for nombre in [e["etiqueta"], *e["alias"]]:
                assert M.canonizar_cohorte(nombre)["id"] == e["id"], nombre
                assert M.cohorte_en_texto(f"Plasma GFAP in the {nombre} participants") == e["etiqueta"], nombre
    assert M.cohorte_en_texto("we evoke memories in the study 201 participants") == ""


def test_una_sola_cuenta_de_cohortes_servida_en_la_conclusion():
    f0, f1, f2 = _fuente(0, "BIOCARD"), _fuente(1, "ADNI"), _fuente(2, "A4")
    # f2 solo contradice: no aporta cohorte en ninguna de las cuentas.
    h = _h([_af(0, "apoya"), _af(1, "apoya"), _af(2, "contradice")], [f0, f1, f2], conclusion={"certeza": "baja"}, investigacionId="inv", id="h1", estado="propuesta", elo=1200, creadaEn=1, cluster="c", afirmacionesX=None)
    assert PR.cohortes_de(h) == C.cohortes_distintas(h) == ["BIOCARD", "ADNI"]
    assert K.comprobaciones_deterministas({**h, "novedad": {}, "supuestos": []}, {"hipotesis": [h]})[3]["detalle"].startswith("2 cohortes distintas")
    assert PR.anotar_cohortes(h) == ["BIOCARD", "ADNI"] and h["conclusion"]["cohortesDistintas"] == ["BIOCARD", "ADNI"]
    sin_conclusion = {**_h([_af(0, "apoya")], [f0]), "conclusion": None}
    assert PR.anotar_cohortes(sin_conclusion) == ["BIOCARD"] and sin_conclusion["conclusion"] is None
    # marcar_candidatas y recalcular_bloqueos la escriben en el estado.
    e = {"hipotesis": [{**P.nueva_hipotesis("inv", 1, AHORA), **_h([_af(0, "apoya"), _af(1, "apoya")], [f0, f1]), "conclusion": {"certeza": "baja"}}], "investigaciones": [{"id": "inv", "datasets": []}], "planesAnalisis": [], "ejecuciones": [], "artefactos": [], "corridas": [], "iteraciones": []}
    PR.marcar_candidatas(e, "inv")
    assert e["hipotesis"][0]["conclusion"]["cohortesDistintas"] == ["BIOCARD", "ADNI"]
    e["hipotesis"][0]["afirmaciones"].append(_af(2, "apoya"))
    e["hipotesis"][0]["procedencia"]["fuentes"].append(f2)
    A.recalcular_bloqueos(e, e["hipotesis"][0])
    assert e["hipotesis"][0]["conclusion"]["cohortesDistintas"] == ["BIOCARD", "ADNI", "A4"]


# ---------------------------------------------------------------------------
# M-01: "sin información" no es "riesgo alto"
# ---------------------------------------------------------------------------


def test_sin_informacion_no_es_riesgo_alto():
    def dominio(id_, juicio, motivo):
        return {"id": id_, "nombre": id_, "juicio": juicio, "motivo": motivo}

    ni = "3 preguntas sin informacion en el texto"
    con_riesgo = "respuestas en el sentido del riesgo: 1.1=PY; 2 preguntas sin informacion en el texto"
    # Alto global solo por acumular dominios sin información: sin evaluar, peso neutro.
    solo_ni = {"global": "alto", "dominios": [dominio("D1", "algunas_dudas", ni), dominio("D2", "algunas_dudas", ni), dominio("D3", "algunas_dudas", ni), dominio("D4", "bajo", "sin respuestas en el sentido del riesgo")]}
    assert C.juicio_sesgo_util(solo_ni)[0] is None
    r = C.peso_afirmacion(_af(0, "apoya"), _fuente(0, "ADNI", riesgoSesgo=solo_ni))
    assert r["peso"] == 1.0 and "sin evaluar" in r["factores"][2]["motivo"] and "sin información" in r["factores"][2]["motivo"]
    # Alto por tres dominios con dudas informadas: algunas dudas (0,8), sin escalar a alto.
    tres_dudas = {"global": "alto", "dominios": [dominio(f"D{i}", "algunas_dudas", con_riesgo) for i in range(3)]}
    assert C.juicio_sesgo_util(tres_dudas)[0] == "algunas_dudas" and C.peso_afirmacion(_af(0, "apoya"), _fuente(0, "ADNI", riesgoSesgo=tres_dudas))["peso"] == 0.8
    # Un dominio alto de verdad sigue siendo alto (0,5), aunque haya otros sin información.
    alto_real = {"global": "alto", "dominios": [dominio("D1", "algunas_dudas", ni), dominio("D3", "alto", "respuestas en el sentido del riesgo: 3.2=PN, 3.3=PY")]}
    assert C.juicio_sesgo_util(alto_real)[0] == "alto" and C.peso_afirmacion(_af(0, "apoya"), _fuente(0, "ADNI", riesgoSesgo=alto_real))["peso"] == 0.5
    # Sin dominios (registro compacto) vale el global; formas rotas no rompen.
    assert C.juicio_sesgo_util({"global": "alto"})[0] == "alto" and C.juicio_sesgo_util({"global": "bajo"})[0] == "bajo"
    assert C.juicio_sesgo_util({"global": "no_aplica"})[0] is None and C.juicio_sesgo_util(None)[0] is None and C.juicio_sesgo_util("alto")[0] is None
    assert C.juicio_sesgo_util({"global": "alto", "dominios": [None, "x", {"juicio": None}]})[0] == "alto"
    todo_bajo = {"global": "bajo", "dominios": [dominio("D1", "bajo", "x"), dominio("D2", "no_aplica", "")]}
    assert C.juicio_sesgo_util(todo_bajo)[0] == "bajo"


# ---------------------------------------------------------------------------
# M-32: la regla del hash al enmendar una lectura está escrita y se cumple
# ---------------------------------------------------------------------------


def test_enmendar_lectura_recalcula_el_hash_y_guarda_antes_y_despues():
    from rosa import experimento as XP

    x = {"prerregistradoEn": 1, "lecturas": [{"nombre": "GFAP plasma", "tipo": "continua", "queConfirma": "sube", "queRefuta": "no sube", "control": "", "unidad": "pg/mL"}]}
    x["hashLecturas"] = XP.hash_lecturas(x)
    congelado = x["hashLecturas"]
    h = {**P.nueva_hipotesis("inv", 1, AHORA), "id": "h1", "experimento": x}
    e = {"hipotesis": [h], "eventos": []}
    assert A.enmendar_lectura(e, "h1", 0, "queRefuta", "baja", "criterio más estricto", "Allegri", AHORA) is True
    en = x["enmiendas"][-1]
    assert en["hashAntes"] == congelado and en["hashDespues"] == XP.hash_lecturas(x) == x["hashLecturas"] != congelado
    assert en["campo"] == "lecturas[0].queRefuta" and en["lectura"] == "GFAP plasma" and en["antes"] == "no sube" and en["despues"] == "baja"
    doc = A.enmendar_lectura.__doc__
    assert "hashAntes" in doc and "hashDespues" in doc and "frontend/src/datos/acciones.ts" in doc and "4." in doc


# ---------------------------------------------------------------------------
# Adversariales (revisión del grupo D, 17 de septiembre de 2026)
# ---------------------------------------------------------------------------


def test_nombre_sintetico_no_tira_datos_reales_y_es_una_sola_regla():
    """La regla por nombre solo fuerza a sintético: un falso positivo tiraría
    evidencia real en silencio. "prueba" suelta y "humo" son datos reales en
    clínica; el guion bajo cuenta como separador; certeza y acciones comparten
    la misma expresión."""
    assert A.es_fichero_sintetico is not None and C.NOMBRE_SINTETICO is A.CERTEZA.NOMBRE_SINTETICO
    reales = ["resultados_prueba_ELISA_GFAP.csv", "prueba_cognitiva_MMSE.csv", "exposicion_humo_tabaco.csv", "smoke_exposure.csv", "cohorte_real.csv", "fakultat_berlin.csv", "mockingbird_lab.csv"]
    de_prueba = ["datos_gfap_nfl_sintetico.csv", "synthetic_v2.csv", "datos_de_prueba.csv", "datos-prueba.csv", "DATA_PRUEBA.xlsx", "gfap_de_prueba.csv", "prueba.csv", "prueba_2.csv", "gfap_dummy.csv", "fake_gfap.csv", "mock.csv", "resultados_MOCK_nfl.tsv"]
    for n in reales:
        assert not A.es_fichero_sintetico(n), n
        assert not C.es_sintetica({"tipo": "dato", "clase": "observacion_original", "sintetico": False, "trayectoria": {"id": n}, "cita": f"[Datos del laboratorio: {n}]"}), n
    for n in de_prueba:
        assert A.es_fichero_sintetico(n), n
        assert C.es_sintetica({"tipo": "dato", "clase": "derivado", "sintetico": False, "trayectoria": {"id": n}}), n
    # Un dato real de laboratorio con "prueba" en el nombre sigue subiendo el techo.
    lab = {"afirmacionId": "lab", "texto": "GFAP cruza antes que NfL", "cita": "[Datos del laboratorio: resultados_prueba_ELISA_GFAP.csv]", "veredicto": "sostenida", "tipo": "dato", "clase": "observacion_original", "sintetico": False, "trayectoria": {"id": "resultados_prueba_ELISA_GFAP.csv"}}
    assert C.techo(_h([_af(0), lab], [_fuente(0, "ADNI")]))[0] == "moderada"


def test_registrar_datos_acepta_la_casilla_html_y_textos_raros(al):
    inv = al.aplicar("crearInvestigacion", {"datos": {"titulo": "T", "objetivo": "O", "condicionParada": "3 iteraciones"}, "id_": "inv-t"})
    hid = al.aplicar("proponerHipotesis", {"investigacion_id": inv, "datos": {"titulo": "A", "enunciado": "B", "cohorte": "ADNI"}, "quien": "Rosa"})
    al.mutar(lambda e: next(x for x in e["hipotesis"] if x["id"] == hid).update(experimento={"protocolo": "p", "estado": "propuesto"}) or True)

    def bandera(valor):
        assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": "gfap_real.csv", "analisis": "", "sintetico": valor}) is True
        return next(h for h in al.estado["hipotesis"] if h["id"] == hid)["experimento"]["datosSinteticos"]

    # "on" es lo que manda un formulario HTML con la casilla marcada.
    for v in ("on", " SI ", "Sí", "true", 1, True, "verdadero"):
        assert bandera(v) is True, v
    for v in ("no", "off", "", None, 0, False, "quizás", [], {}):
        assert bandera(v) is False, v
    # Un fichero que no es texto no rompe ni registra nada.
    assert al.aplicar("registrarDatosExperimento", {"hipotesis_id": hid, "fichero": {"nombre": "x.csv"}, "analisis": ""}) is False


def test_ampliar_presupuesto_rechaza_topes_no_finitos_sin_lanzar():
    e = {"corridas": [{"id": "c", "investigacionId": "i", "estado": "pausada_por_presupuesto", "gasto": {"llamadas": 10}, "presupuesto": {"limiteLlamadas": 100, "avisadas": []}}], "iteraciones": [], "eventos": []}
    for v in (float("inf"), float("-inf"), float("nan"), True, "200", None, 10, 0, -5):
        assert A.ampliar_presupuesto(e, "c", v, 1) is False, repr(v)
    assert e["corridas"][0]["estado"] == "pausada_por_presupuesto" and e["corridas"][0]["presupuesto"]["limiteLlamadas"] == 100
    assert A.ampliar_presupuesto(e, "c", 200.4, 1) is True and e["corridas"][0]["presupuesto"]["limiteLlamadas"] == 200


def test_killer_determinista_tolera_registros_antiguos_con_none():
    h = P.nueva_hipotesis("inv", 1, AHORA)
    for campo, valor in (("novedad", None), ("supuestos", None), ("procedencia", None), ("afirmaciones", None), ("afirmaciones", [None, "texto"]), ("novedad", {"precedente": None, "ensayos": "x"})):
        hh = {**h, campo: valor}
        c = {x["comprobacion"]: x for x in K.comprobaciones_deterministas(hh, {"hipotesis": [hh]})}
        # Sin afirmaciones es "no comprobable", no "falla" (28 de septiembre de
        # 2026): cero afirmaciones es "todavía no se ha buscado", y con `falla`
        # la decisión descartaba una hipótesis recién nacida sin mirarla.
        assert c["citas_reales"]["resultado"] == "no_comprobable", campo
        assert c["novedad"]["resultado"] in ("pasa", "no_comprobable"), campo


def test_de_fondo_reconoce_secciones_numeradas_y_no_otras():
    for cita in ("[Ref, sección 1. Introduction]", "[Ref, sección 1 INTRODUCTION]", "[Ref, sección 2.1 Background]", "[Ref, sección Introducción]", "[Ref, sección 1. Antecedentes]"):
        assert C.de_fondo({"cita": cita}), cita
    for cita in ("[Ref, sección 3. Results]", "[Ref, sección Discussion]", "[Ref, pág. 4]", "[Ref, resumen]", "[Ref, sección Methods]", "", None):
        assert not C.de_fondo({"cita": cita}), cita
    # "deFondo" explícito manda; un texto que no es bool cae a la cita.
    assert C.de_fondo({"cita": "[Ref, sección Results]", "deFondo": True}) and not C.de_fondo({"cita": "[Ref, sección Introduction]", "deFondo": False})
    assert C.de_fondo({"cita": "[Ref, sección Introduction]", "deFondo": "no"})


def test_novedad_no_comprobada_tiene_la_forma_de_las_demas_consultas():
    n = P.novedad_no_comprobada(3)
    assert n["estado"] == "no_comprobado" and n["detalle"].startswith("No comprobado todavía para la versión 3") and n["url"] is None and n["motivo"] == "reformulacion"
    # El Killer la lee como pendiente y `fusionar` no deja que el juez la resuelva de memoria.
    h = {**P.nueva_hipotesis("inv", 1, AHORA), "novedad": {**P.novedad_pendiente(), "precedente": n}}
    det = K.comprobaciones_deterministas(h, {"hipotesis": [h]})
    salida = {x["comprobacion"]: x for x in K.fusionar(det, [{"comprobacion": "novedad", "resultado": "pasa", "detalle": "me suena inédita"}])}
    assert salida["novedad"]["resultado"] == "no_comprobable"
