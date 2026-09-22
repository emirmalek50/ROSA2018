"""Ontologías, coste por decisión, RO-Crate, política de contexto y nivel de autonomía."""

import json
import zipfile
import io

from rosa import causal as CAUSAL
from rosa import costes as C
from rosa import ontologias as ONTO
from rosa import politicas
from rosa import rocrate as RC
from rosa.estado import acciones as A
from rosa.estado import plantilla as P


def test_diccionario_curado_resuelve_sin_red_y_fusiona_alias():
    ents = ONTO.anotar_curadas("Plasma GFAP rises in astrocytes of Alzheimer disease before NfL; p-tau181 follows in the hippocampus")
    ids = ONTO.ids_de(ents)
    assert {"HGNC:4235", "CL:0000127", "MONDO:0004975", "HGNC:7739", "HGNC:6893", "UBERON:0002421", "UBERON:0001969"} <= ids
    tipos = {x["id"]: x["tipo"] for x in ents}
    assert tipos["HGNC:4235"] == "gen" and tipos["CL:0000127"] == "celula" and tipos["UBERON:0002421"] == "tejido"
    fus = ONTO.fusionar(ents, [{"texto": "GFAP", "id": "HGNC:4235", "simbolo": "GFAP", "nombre": "glial fibrillary acidic protein", "uniprot": "P14136", "ensembl": "ENSG00000131095", "alias": ["FLJ45472"], "ontologia": "HGNC", "tipo": "gen"}])
    gfap = next(x for x in fus if x["id"] == "HGNC:4235")
    assert gfap["uniprot"] == "P14136" and "FLJ45472" in gfap["alias"] and len([x for x in fus if x["id"] == "HGNC:4235"]) == 1
    # Dos hipotesis que comparten dos identificadores hablan quiza de lo mismo.
    a = ONTO.anotar_curadas("GFAP en astrocitos")
    b = ONTO.anotar_curadas("glial fibrillary acidic protein and astrocyte activation")
    assert ONTO.comparten(a, b) == ["CL:0000127", "HGNC:4235"]
    assert ONTO.comparten(a, ONTO.anotar_curadas("solo tau")) == []


def test_nodos_causales_llevan_identificador_canonico():
    h = {"tarjeta": {"diana": "GFAP", "intervencion": "GFAP", "direccion": "sin_intervencion"}, "comprobacion": {"biomarcador": "NfL"}, "afirmaciones": [], "titulo": "GFAP precede a NfL", "enunciado": "GFAP precede a NfL"}
    g = CAUSAL.grafo_local(h, [], None, 1)
    por_id = {n["id"]: n for n in g["nodos"]}
    assert por_id["X"].get("idCanonico") == "HGNC:4235" and por_id["Y"].get("idCanonico") == "HGNC:7739"


def test_costes_por_decision_incluyen_revision_humana():
    e = P.estado_inicial()
    A.crear_investigacion(e, {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}, 1)
    inv = e["investigaciones"][0]
    c = P.nueva_corrida(inv["id"], 1, 1)
    c["gasto"]["usd"] = 12.0
    c["gasto"]["llamadas"] = 40
    e["corridas"].append(c)
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="H", enunciado="E", mecanismo="M")
    h["candidata"] = True
    e["hipotesis"].append(h)
    d = A.registrar_decision(e, h, "persona", "aprobar", "ok", "Dra. X", 2, [])
    d["segundosRevision"] = 1800
    A.guardar_artefacto(e, inv["id"], "Dossier: H", "dossier", "texto", "d", 1, 3, procedencia={"mensajes": {"hipotesis": h["id"]}})
    llamadas = {c["id"]: [{"modelo": "anthropic/claude-opus-5", "rol": "juez", "iteracion": 1, "tokensEntrada": 1000, "tokensSalida": 100, "ms": 10}] * 2}
    r = C.costes_de_investigacion(e, inv["id"], llamadas)
    assert r["usdModelo"] == 12.0 and r["horasRevision"] == 0.5 and r["usdRevision"] == 0.5 * politicas.TARIFA_HORA_REVISION_USD
    assert r["usdTotal"] == round(12.0 + 0.5 * politicas.TARIFA_HORA_REVISION_USD, 2)
    assert r["hipotesisConDossier"] == 1 and r["usdPorDossier"] == r["usdTotal"] and r["usdPorDecisionHumana"] == r["usdTotal"] and r["usdPorCandidata"] == r["usdTotal"]
    assert r["porIteracion"][0]["llamadas"] == 2 and r["porIteracion"][0]["usd"] > 0
    assert d["contexto"]["hechos"] == 0 and d["contexto"]["hipotesisVivas"] == 1


def test_rocrate_con_prov_y_sello():
    e = P.estado_inicial()
    A.crear_investigacion(e, {"titulo": "T", "objetivo": "O", "condicionParada": "1 iteraciones"}, 1)
    inv = e["investigaciones"][0]
    e["corridas"].append(P.nueva_corrida(inv["id"], 1, 1))
    h = P.nueva_hipotesis(inv["id"], 1, 1, titulo="H", enunciado="E", mecanismo="M")
    h["experimento"] = {"protocolo": "p", "ensayo": "e", "costeEstimado": "c", "laboratorio": None, "estado": "propuesto", "ficheroDatos": None, "analisisPedido": ""}
    e["hipotesis"].append(h)
    A.registrar_decision(e, h, "killer_1", "avanzar", "ok", "Rosa", 2, [{"comprobacion": "novedad", "resultado": "pasa", "detalle": ""}])
    A.asignar_experimento(e, h["id"], "FLENI", 3)
    A.registrar_sello_externo(e, h["id"], {"algoritmo": "sha256", "hash": "ab" * 32, "ok": True, "testigos": ["freeTSA"], "primeraHora": "2026-09-14T14:01:59Z", "pedidoEn": 3, "error": None, "sellos": [{"tsa": "freeTSA", "url": "https://freetsa.org/tsr", "ok": True, "genTime": "2026-09-14T14:01:59Z", "serial": "1", "tsrBase64": "AAEC"}]}, 4)
    run = P.nueva_ejecucion(inv["id"], h["id"], "plan-1", "hipotesis", "print('RESULTADO x=1')", 7, "cafe" * 16, 5)
    run["estado"] = "completado"
    e.setdefault("ejecuciones", []).append(run)
    crate = RC.armar(e, h, 10)
    nombres = set(crate["ficheros"])
    assert {"ro-crate-metadata.json", "prov.json", "hipotesis.json", "dossier.md", "prerregistro.md", "fuentes.csv", "decisiones.json", "README.md", "sello/freeTSA.tsr", f"ejecuciones/{run['id']}.py", f"ejecuciones/{run['id']}.json"} <= nombres
    meta = crate["metadata"]
    raiz = next(g for g in meta["@graph"] if g["@id"] == "./")
    assert raiz["conformsTo"]["@id"] == RC.PERFIL and {p["@id"] for p in raiz["hasPart"]} >= {"prerregistro.md", "dossier.md"}
    acciones = [g for g in meta["@graph"] if g.get("@type") in ("CreateAction", "AssessAction") or (isinstance(g.get("@type"), list) and "LabProcess" in g["@type"])]
    assert any(g["@id"].startswith("#ejecucion-") and g["instrument"]["@id"].startswith("#sandbox") for g in acciones)
    assert any("LabProcess" in (g.get("@type") or []) for g in acciones)
    ds = next(g for g in meta["@graph"] if g["@id"].startswith("#dataset-"))
    assert ds["sha256"] == "cafe" * 16 and "no incluido" in ds["name"]
    prov = crate["prov"]
    assert "rosa:ROSA2018" in prov["agent"] and any(k.startswith("rosa:ejecucion-") for k in prov["activity"]) and prov["wasAttributedTo"]
    z = zipfile.ZipFile(io.BytesIO(RC.zip_bytes(crate)))
    assert json.loads(z.read("ro-crate-metadata.json"))["@context"] == RC.CONTEXTO
    assert z.read("sello/freeTSA.tsr") == b"\x00\x01\x02"


def test_nivel_de_autonomia_declarado_y_politicas():
    assert politicas.NIVEL_AUTONOMIA_DECLARADO == 2
    t = politicas.nivel_autonomia_texto()
    assert "Nivel 2 de 5" in t and "Autonomía parcial" in t
    r = politicas.resumen()
    assert r["nivelAutonomiaDeclarado"] == 2 and len(r["nivelesAutonomia"]) == 6 and r["tarifaHoraRevisionUsd"] > 0


# ---------------------------------------------------------------------------
# Identificadores sin tilde y capas de la cascada (22 de septiembre de 2026).
#
# "función renal" se usaba como identificador de nodo CON tilde, y todos sus
# hermanos van sin ella ("neurodegeneracion", "cognicion"). El resultado fue
# que los grafos calculados antes de la pasada de tildes guardaron
# "funcion renal" y los de despues "función renal": la misma cosa, dos nodos.
# Medido el 22 de septiembre de 2026 sobre las 21 hipotesis con grafo de la
# corrida 16, las dos formas convivian (7 grafos con una, 20 con la otra).


def test_ningun_identificador_de_la_base_lleva_tilde():
    """El identificador es sin tilde; el texto con tilde va en ETIQUETAS."""
    import unicodedata

    for relacion in CAUSAL.BASE_CURADA:
        for extremo in ("de", "a"):
            nodo = relacion[extremo]
            sin = unicodedata.normalize("NFKD", nodo).encode("ascii", "ignore").decode()
            assert nodo == sin, f"el nodo {nodo!r} lleva tilde y se usa como identificador"


def test_cada_nodo_de_la_base_tiene_capa_y_etiqueta():
    """La cascada se escribe una sola vez, aqui: si un nodo se queda sin capa,
    la pantalla de mecanismos no sabria en que columna ponerlo."""
    nodos = {r[e] for r in CAUSAL.BASE_CURADA for e in ("de", "a")}
    for nodo in nodos:
        assert CAUSAL.capa_de(nodo) in CAUSAL.CAPAS, f"{nodo} no tiene capa"
        assert CAUSAL.etiqueta_de(nodo).strip()


def test_la_etiqueta_lleva_su_tilde_aunque_el_identificador_no():
    assert CAUSAL.etiqueta_de("funcion renal") == "función renal"
    assert CAUSAL.etiqueta_de("neurodegeneracion") == "neurodegeneración"
    # Un nodo que no esta en la base se devuelve tal cual, sin inventar.
    assert CAUSAL.etiqueta_de("GFAP") == "GFAP"
    assert CAUSAL.capa_de("lo que sea") == "otros"


def test_las_capas_van_en_orden_de_la_enfermedad():
    """Factores antes que patologia, patologia antes que daño: si se
    desordenan, las flechas de la cascada irian hacia atras."""
    orden = {c: i for i, c in enumerate(CAUSAL.CAPAS)}
    for relacion in CAUSAL.BASE_CURADA:
        cd, ca = CAUSAL.capa_de(relacion["de"]), CAUSAL.capa_de(relacion["a"])
        assert orden[cd] <= orden[ca], f"{relacion['de']} ({cd}) -> {relacion['a']} ({ca}) va hacia atras"


def test_un_supuesto_se_llama_igual_se_cumpla_o_falte():
    """El nombre es lo que va antes de los dos puntos, y agrupa la pantalla de
    mecanismos. Si el cumplido se llama "Ajuste" y el faltante "Confusión",
    salen dos filas para el mismo supuesto. Medido el 22 de septiembre de 2026
    sobre la corrida 16: "Ajuste" cumplía en 5 y "Confusión" faltaba en 16, que
    son las 21 hipótesis partidas en dos."""
    import inspect
    import re

    fuente = inspect.getsource(CAUSAL)
    nombres = lambda lista: {  # noqa: E731
        m.group(1)
        for m in re.finditer(rf'{lista}\.append\("([^":]+):', fuente)
    }
    cumplidos, faltantes = nombres("cumplidos"), nombres("faltantes")
    assert cumplidos and faltantes
    # Al reves no se exige: hay condiciones que solo existen como cumplidas
    # (aleatorizacion, exposicion genetica) porque cierran la identificacion
    # por diseno y no tienen version "falta".
    assert faltantes <= cumplidos, (
        f"supuestos que faltan con un nombre y se cumplen con otro: {faltantes - cumplidos}"
    )


def test_el_grafo_causal_no_pierde_las_amenazas_ya_conocidas():
    """Una amenaza conocida no deja de existir porque una llamada al juez no la
    repita.

    El 22 de septiembre de 2026 una hipótesis con 12 explicaciones alternativas
    guardadas se recalculó con cero: el grafo se construía solo con las de esa
    ronda, y además antes de acumularlas. Las cajas rojas de la pantalla de
    mecanismos desaparecieron sin explicación."""
    from rosa.bucle import pasos as PASOS

    # La ronda no trae ninguna, pero la hipótesis ya tenía dos apuntadas.
    h = {
        "id": "h1",
        "investigacionId": "inv",
        "titulo": "GFAP sube antes que NfL",
        "enunciado": "En portadores de APOE4 el GFAP en plasma sube antes que el NfL",
        "version": 1,
        "tarjeta": {"diana": "GFAP", "intervencion": "", "direccion": "sin_intervencion", "prediccionFalsable": "x"},
        "comprobacion": {"biomarcador": "NfL"},
        "afirmaciones": [],
        "alternativas": [
            {"texto": "Confusor: la edad sube el GFAP sin enfermedad", "clase": "confusor", "queLaDistinguiria": "", "iteracion": 1},
            {"texto": "Artefacto de medida: deriva entre plataformas", "clase": "artefacto", "queLaDistinguiria": "", "iteracion": 1},
        ],
    }
    de_esta_ronda: list[str] = []
    para_grafo = de_esta_ronda or [a["texto"] for a in (h.get("alternativas") or []) if isinstance(a, dict) and a.get("texto")][:4]
    assert len(para_grafo) == 2, "sin alternativas nuevas hay que caer en las conocidas"
    g = CAUSAL.grafo_local(h, para_grafo, None, 1)
    roles = [n["rol"] for n in g["nodos"] if str(n["rol"]).startswith("alternativa_")]
    assert len(roles) == 2, f"el grafo se quedó sin amenazas: {roles}"

    # Y si la ronda SÍ trae, mandan las de la ronda.
    de_esta_ronda = ["Causa inversa: quizá el NfL sube primero"]
    para_grafo = de_esta_ronda or [a["texto"] for a in (h.get("alternativas") or [])][:4]
    assert para_grafo == de_esta_ronda


def test_las_alternativas_se_acumulan_antes_de_construir_el_grafo():
    """El orden importa: si el grafo se construye antes de acumular, nunca ve
    las que acaban de llegar."""
    import inspect

    from rosa.bucle import pasos as PASOS

    fuente = inspect.getsource(PASOS)
    i_acumular = fuente.index("anadir_alternativas(x, alternativas_rev, ctx.numero)")
    i_grafo = fuente.index('x["grafoCausal"] = CAUSAL.grafo_local(x, para_grafo')
    assert i_acumular < i_grafo, "el grafo se construye antes de acumular las alternativas"
