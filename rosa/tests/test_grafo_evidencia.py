"""Grafo de evidencia (16 de septiembre de 2026): fusión de ramas por torneo,
relación declarada por el juez, ataques, herencia de hechos con enlaces,
puerta "solo mejor o igual" al promover, hechos numerados y signo causal."""
from rosa import causal as CAUSAL
from rosa import cuestiones as CU
from rosa import dependencias as DEP
from rosa import torneo
from rosa.bucle import contexto as T
from rosa.estado import acciones as A
from rosa.estado import plantilla as P


def _estado_con_dos():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "t", "objetivo": "GFAP y NfL", "condicionParada": "3 iteraciones"}, 1000)
    a = P.nueva_hipotesis(inv, 1, 1000, titulo="GFAP precede a NfL", enunciado="GFAP en plasma sube antes que NfL", mecanismo="astrocitos",
                          afirmaciones=[{"afirmacionId": "af-1", "texto": "GFAP sube antes", "cita": "[Kim, resumen]", "veredicto": "sostenida", "motivo": "", "entidadDistinta": False, "tipo": "dato", "trayectoria": None}])
    a["procedencia"]["fuentes"] = [{"id": "kim", "referencia": "Kim, 2025", "titulo": "GFAP", "cohorte": "ADNI"}]
    b = P.nueva_hipotesis(inv, 1, 1000, titulo="La astroglía se activa antes que el axón", enunciado="GFAP plasmático aumenta antes que NfL", mecanismo="astrocitos", elo=1480,
                          afirmaciones=[{"afirmacionId": "af-1", "texto": "GFAP sube antes", "cita": "[Kim, resumen]", "veredicto": "sostenida", "motivo": "", "entidadDistinta": False, "tipo": "dato", "trayectoria": None},
                                        {"afirmacionId": "af-2", "texto": "En BioFINDER GFAP precede", "cita": "[Xie, resumen]", "veredicto": "sostenida", "motivo": "", "entidadDistinta": False, "tipo": "dato", "trayectoria": None}])
    b["procedencia"]["fuentes"] = [{"id": "kim", "referencia": "Kim, 2025", "titulo": "GFAP", "cohorte": "ADNI"}, {"id": "xie", "referencia": "Xie, 2026", "titulo": "BioFINDER", "cohorte": "BioFINDER"}]
    e["hipotesis"] += [a, b]
    return e, inv, a, b


def test_fusionar_hereda_evidencia_sin_duplicar_y_descarta_la_absorbida():
    e, inv, a, b = _estado_con_dos()
    assert A.fusionar_hipotesis(e, a["id"], b["id"], "equivalentes según el torneo", "Rosa", 2000) is True
    assert [x["afirmacionId"] for x in a["afirmaciones"]] == ["af-1", "af-2"] and a["afirmaciones"][1]["heredadaDe"] == b["id"]
    assert [f["id"] for f in a["procedencia"]["fuentes"]] == ["kim", "xie"]
    assert a["absorbe"] == [b["id"]] and a["_evidenciaNueva"] is True
    assert b["estado"] == "descartada" and b["fusionadaEn"] == a["id"] and b["candidata"] is False
    assert "descartada_por_killer" in b["bloqueos"]
    assert any(ev["tipo"] == "hipotesis_decidida" and "Fusión" in ev["texto"] for ev in e["eventos"])
    # No se fusiona dos veces ni con una descartada, ni consigo misma.
    assert A.fusionar_hipotesis(e, a["id"], b["id"], "otra vez", "Rosa", 3000) is False
    assert A.fusionar_hipotesis(e, a["id"], a["id"], "consigo misma", "Rosa", 3000) is False


def test_rechazar_fusion_retira_la_propuesta():
    e, inv, a, b = _estado_con_dos()
    b["fusionPropuesta"] = {"con": a["id"], "relacion": "equivalentes", "motivo": "m", "propuestaEn": 1500}
    assert A.rechazar_fusion(e, b["id"], "Allegri", 2000) is True
    assert b["fusionPropuesta"] is None and any("rechazada" in x for x in b["procedencia"]["registro"])
    assert A.rechazar_fusion(e, b["id"], "Allegri", 2000) is False


def test_relacion_acordada_solo_si_las_dos_lecturas_coinciden():
    assert torneo.relacion_acordada("equivalentes", "equivalentes") == "equivalentes"
    # En la segunda llamada A y B van invertidas: a_subsume_b leído al revés es b_subsume_a.
    assert torneo.relacion_acordada("a_subsume_b", "b_subsume_a") == "a_subsume_b"
    assert torneo.relacion_acordada("a_subsume_b", "a_subsume_b") == "distintas"
    assert torneo.relacion_acordada("incompatibles", "distintas") == "distintas"
    assert torneo.relacion_acordada(None, None) == "distintas"


def test_emparejar_pone_primero_los_pares_forzados_y_registra_la_relacion():
    e, inv, a, b = _estado_con_dos()
    c = P.nueva_hipotesis(inv, 1, 1000, titulo="otra", enunciado="otra cosa", elo=1300)
    e["hipotesis"].append(c)
    pares = torneo.emparejar([a, b, c], maximo=6, semilla=1, forzados=[(c["id"], a["id"]), (c["id"], b["id"]), ("no-existe", a["id"])])
    assert (pares[0][0]["id"], pares[0][1]["id"]) == (c["id"], a["id"])
    assert all(not (p[0]["id"] == c["id"] and p[1]["id"] == b["id"]) for p in pares)  # c ya estaba usada
    torneo.registrar_partido(a, b, True, 1, "debate", "correccion", "a_subsume_b")
    assert a["partidos"][-1]["relacion"] == "a_subsume_b" and b["partidos"][-1]["relacion"] == "b_subsume_a"
    torneo.registrar_partido(a, c, None, 1, "debate", "novedad", "distintas")
    # "distintas" SE GUARDA desde el 25 de septiembre de 2026. Antes no, y como
    # `pasos._torneo` fuerza el par marcado como redundante mientras ningún partido
    # suyo tenga relación, un juez que dijera "distintas" hacía que el par se
    # volviera a forzar en cada iteración para siempre: en inv-mu2sz2ns-3 hubo un
    # par con 9 partidos. Guardarla cierra el dirimente.
    assert a["partidos"][-1]["relacion"] == "distintas" and c["partidos"][-1]["relacion"] == "distintas"
    # Un partido por regla no dice que el juez discrepara: no lo llamó nadie.
    torneo.registrar_partido(b, c, None, 2, "las dos pierden la solidez", "solidez", "distintas", por_regla=True)
    assert b["partidos"][-1]["resumenDebate"] == "las dos pierden la solidez" and b["partidos"][-1]["porRegla"] is True
    assert "el juez discrepó" in a["partidos"][-1]["resumenDebate"]  # el de a contra c, con juez


def test_copiar_hechos_remapea_los_enlaces_entre_hechos():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "t", "objetivo": "o", "condicionParada": "3 iteraciones"}, 1000)
    viejo = P.nuevo_hecho(inv, "hecho", "GFAP", "GFAP sube en fase 2", "descartado", "fuente", [], 1000)
    nuevo = P.nuevo_hecho(inv, "hecho", "GFAP", "GFAP sube ya en fase 1", "sabido", "fuente", [], 1100)
    viejo["sustituidoPor"] = nuevo["id"]
    nuevo["sustituyeA"] = [viejo["id"], "he-de-otra-investigacion"]
    e["hechos"] += [viejo, nuevo]
    rama = A.bifurcar_investigacion(e, inv, "rama de prueba", 2000)
    copias = {h["id"]: h for h in e["hechos"] if h["investigacionId"] == rama}
    assert copias[f"{nuevo['id']}-{rama}"]["sustituyeA"] == [f"{viejo['id']}-{rama}", "he-de-otra-investigacion"]
    assert copias[f"{viejo['id']}-{rama}"]["sustituidoPor"] == f"{nuevo['id']}-{rama}"
    # Los originales no cambian.
    assert nuevo["sustituyeA"] == [viejo["id"], "he-de-otra-investigacion"]


def test_promover_no_pasa_si_la_evaluacion_empeora_pero_si_sin_evaluacion_o_igual():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "t", "objetivo": "o", "condicionParada": "3 iteraciones"}, 1000)
    peor = P.nuevo_cambio_aprendizaje(inv, 2, "criterio", "Criterio que empeora", "debilidad:x", "evaluado", "Rosa", 1, evaluacion={"conjunto": "reservado", "casos": 6, "antes": 0.8, "despues": 0.5, "nota": ""})
    igual = P.nuevo_cambio_aprendizaje(inv, 2, "criterio", "Criterio que iguala", "debilidad:y", "evaluado", "Rosa", 1, evaluacion={"conjunto": "reservado", "casos": 6, "antes": 0.8, "despues": 0.8, "nota": ""})
    sin = P.nuevo_cambio_aprendizaje(inv, 2, "criterio", "Criterio sin evaluar", "debilidad:z", "propuesto", "Rosa", 1)
    e["aprendizaje"] += [peor, igual, sin]
    assert A.promover_aprendizaje(e, peor["id"], "persona", 2000) is False and peor["estado"] == "evaluado"
    assert any(ev["tipo"] == "incidencia" and "empeora" in ev["texto"] for ev in e["eventos"])
    assert A.promover_aprendizaje(e, igual["id"], "persona", 2000) is True
    assert A.promover_aprendizaje(e, sin["id"], "persona", 2000) is True
    assert A.empeora_al_evaluar({"evaluacion": {"antes": None, "despues": 0.2}}) is False


def test_hechos_numerados_y_signo_causal():
    e = P.estado_inicial()
    inv = A.crear_investigacion(e, {"titulo": "t", "objetivo": "o", "condicionParada": "3 iteraciones"}, 1000)
    h1 = P.nuevo_hecho(inv, "hecho", "GFAP", "GFAP sube", "sabido", "fuente", [], 1000, prioridad=2)
    h2 = P.nuevo_hecho(inv, "pregunta", "NfL", "¿NfL después?", "abierto", "inferencia", [], 1000)
    h3 = {**P.nuevo_hecho("otra", "hecho", "tau", "tau sube", "sabido", "fuente", [], 900, prioridad=1), "id": "he-x-inv-otra", "investigacionId": inv}
    e["hechos"] += [h1, h2, h3]
    texto, lista = T.hechos_numerados(e["hechos"], inv)
    assert [h["id"] for h in lista] == [h1["id"], "he-x-inv-otra"] and texto.startswith("1. [GFAP] GFAP sube") and "(heredado)" in texto
    assert T.hechos_numerados([], inv) == ("Ninguno todavía.", [])
    assert CAUSAL.signo_de({"tarjeta": {"direccion": "aumenta"}, "enunciado": "baja"}) == "+"
    assert CAUSAL.signo_de({"tarjeta": {"direccion": "disminuye"}, "enunciado": ""}) == "-"
    assert CAUSAL.signo_de({"tarjeta": None, "enunciado": "GFAP en plasma sube antes que NfL"}) == "+"
    assert CAUSAL.signo_de({"tarjeta": None, "enunciado": "GFAP se asocia con NfL"}) is None


def test_reformular_guarda_el_diff_y_propaga_a_las_derivadas():
    e, inv, a, b = _estado_con_dos()
    b["derivadaDe"] = a["id"]
    a["conclusion"] = {"certeza": "baja", "direccion": "a_favor"}
    assert A.reformular_hipotesis(e, a["id"], {"titulo": "GFAP precede a NfL en APOE4", "comprobacion": {"cohorte": "ADNI"}}, "Rosa", "más específica", 2000) is True
    v = a["versiones"][0]
    assert v["n"] == 1 and v["certeza"] == "baja" and v["nAfirmaciones"] == 1 and v["nFuentes"] == 1
    assert {c["campo"] for c in v["cambios"]} == {"titulo", "comprobacion.cohorte"}
    assert any("Cambió" in x or "cambi" in x.lower() for x in a["procedencia"]["registro"])
    # La derivada queda pendiente de revisar y bloqueada hasta que alguien la atienda.
    assert b["pendienteRevision"]["causa"] == "hipotesis_reformulada"
    assert "dependencia_pendiente" in A.recalcular_bloqueos(e, b)
    assert A.atender_pendiente(e, "hipotesis", b["id"], "Allegri", "revisada", 3000) is True
    assert b["pendienteRevision"] is None and "dependencia_pendiente" not in b["bloqueos"]
    assert A.atender_pendiente(e, "hipotesis", b["id"], "Allegri", "otra vez", 3000) is False


def test_cuestiones_por_accion_y_poda_al_volver():
    e, inv, a, b = _estado_con_dos()
    assert A.abrir_cuestion(e, inv, "¿La plataforma Simoa mide GFAP igual que Lumipulse?", "Un estudio cabeza a cabeza", "Allegri", 2000, hipotesis_id=a["id"]) is True
    assert A.abrir_cuestion(e, inv, "¿La plataforma Simoa mide GFAP igual que Lumipulse?", "", "Allegri", 2100) is True  # equivalente: se funde
    abiertas = CU.abiertas(e, inv)
    assert len(abiertas) == 1 and abiertas[0]["veces"] == 2 and abiertas[0]["hipotesisIds"] == [a["id"]]
    cid = abiertas[0]["id"]
    assert A.descartar_cuestion(e, cid, "", "Allegri", 2200) is False  # descartar exige motivo
    assert A.resolver_cuestion(e, cid, "Lo respondió el estudio X", "Allegri", 2300) is True
    assert CU.buscar(e, cid)["estado"] == "resuelta" and CU.buscar(e, cid)["resolucion"]["por"] == "Allegri"
    assert A.reabrir_cuestion(e, cid, "no era concluyente", "Allegri", 2400) is True
    assert CU.buscar(e, cid)["estado"] == "abierta"
    # El criterio de relevancia enseña la cuestión con lo que la resolvería.
    from rosa.bucle import contexto as T2

    texto = T2.preguntas_abiertas(e["hechos"], inv, "GFAP y NfL", cuestiones=e["cuestiones"])
    assert "Simoa" in texto and "la resolvería: Un estudio cabeza a cabeza" in texto
    # Una cuestión abierta por ROSA2018 después de una iteración cerrada se poda al volver atrás; la de la persona no.
    c_rosa = CU.registrar(e, CU.nueva(inv, "¿NfL sube antes en portadores?", {"tipo": "killer", "id": a["id"]}, "una segunda cohorte", 5000))
    assert c_rosa is not None
    assert CU.podar_desde(e, inv, 4000) == 1
    assert [c["id"] for c in e["cuestiones"]] == [cid]


def test_propagar_retraccion_marca_hechos_e_hipotesis():
    e, inv, a, b = _estado_con_dos()
    a["procedencia"]["fuentes"][0]["doi"] = "10.1/kim"
    hecho = P.nuevo_hecho(inv, "hecho", "GFAP", "GFAP sube antes", "sabido", "fuente", [{"fuenteId": "kim", "referencia": "Kim, 2025", "pagina": None}], 1000, afirmacion_ids=["af-1"])
    e["hechos"].append(hecho)
    marcados = DEP.propagar_retraccion(e, inv, "kim", "10.1/KIM", 2000)
    assert f"hipotesis:{a['id']}" in marcados and f"hecho:{hecho['id']}" in marcados
    assert hecho["pendienteRevision"]["causa"] == "fuente_retractada" and hecho["actualizadoEn"] == 1000
    # Idempotente.
    assert DEP.propagar_retraccion(e, inv, "kim", "10.1/kim", 2500) == []
