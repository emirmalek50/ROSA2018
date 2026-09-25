"""El perfil de evidencia por diana (rosa/dianas.py) sin red: un `consultar`
falso devuelve (registro, datos) por nombre de conector, con casos de éxito,
vacío y error. Lo que se comprueba: las tres clases de estado por regla, que
un fallo de red nunca se convierte en ausencia, la tabla en castellano con
tildes, la comprobación de contexto humano en sus tres resultados y que los
registros antiguos (sin contextoBases ni perfil) no rompen nada."""

import asyncio
import re
from typing import Any

from rosa import dianas as D

FALLO = object()  # el conector no respondió
NO_REGISTRADO = object()  # ni siquiera existe en el catálogo


def consultar_falso(respuestas: dict[str, Any]):
    """Imita a rosa.conectores.consultar: (registro, datos). Un conector que no
    figura en `respuestas` falla como si la fuente no respondiera."""
    llamadas: list[tuple[str, dict[str, Any]]] = []

    async def consultar(nombre: str, /, resumen: str = "", origen: str = "bucle", **argumentos: Any):
        llamadas.append((nombre, argumentos))
        r = respuestas.get(nombre, FALLO)
        reg: dict[str, Any] = {"id": f"con-{len(llamadas)}", "herramienta": nombre, "fuente": nombre, "argumentos": argumentos, "fecha": 1, "n": None, "ids": [], "version": None, "invariante": None, "error": None, "ms": 1, "resumen": resumen}
        if r is NO_REGISTRADO:
            raise KeyError(nombre)
        if r is FALLO:
            reg["error"] = "No pude comprobar: tiempo agotado (timeout)"
            return reg, None
        reg["n"] = len(r) if isinstance(r, (list, dict)) else 1
        return reg, r

    consultar.llamadas = llamadas  # type: ignore[attr-defined]
    return consultar


def ot(genetica: float | None = 0.7, global_: float = 0.8, evidencias: list[dict[str, Any]] | None = None, target: bool = True) -> dict[str, Any]:
    if not target:
        return {"target": None}
    tipos = [{"id": "literature", "score": 0.9}] + ([{"id": "genetic_association", "score": genetica}] if genetica else [])
    return {"target": {"id": "ENSG1", "approvedSymbol": "TREM2", "associatedDiseases": {"count": 1, "rows": [{"score": global_, "disease": {"id": "MONDO_0004975", "name": "Alzheimer disease"}, "datatypeScores": tipos}]}, "evidences": {"count": len(evidencias or []), "rows": evidencias or []}}}


HPA_TREM2 = {
    "Gene": "TREM2",
    "RNA tissue specificity": "Tissue enhanced",
    "RNA tissue distribution": "Detected in many",
    "RNA tissue specific nTPM": {"brain": "58.6", "choroid plexus": "55.1"},
    "RNA brain regional specificity": "Low regional specificity",
    "RNA brain regional distribution": "Detected in all",
    "RNA single cell type specificity": "Cell type enriched",
    "RNA single cell type distribution": "Detected in some",
    "RNA single cell type specific nCPM": {"Hofbauer cells": "979.9"},
    "RNA single nuclei brain specificity": "Cell type enriched",
    "RNA single nuclei brain distribution": "Detected in some",
    "RNA single nuclei brain specific nCPM": {"central nervous system macrophage": "127.5"},
    "Brain expression cluster": "Cluster 20: Macrophages and microglial cells - Immune response",
}

RESPUESTAS_TREM2 = {
    "gwas_asociaciones_gen": {"total_asociaciones": 40, "en_esta_pagina": 40, "n_alzheimer": 3, "alzheimer": [{"estudio": "GCST1", "p": 1e-12}, {"estudio": "GCST2", "p": "2e-8"}]},
    "clinvar_gen": {"variantes_gen": 25, "con_enfermedad": 0, "ids": []},
    "opentargets_graphql": ot(evidencias=[{"datasourceId": "eva", "directionOnTrait": "risk", "directionOnTarget": "LoF"}] * 3),
    "hpa_expresion": HPA_TREM2,
    "uniprot_proteina": {"accession": "Q9NZC2", "nombre": "Triggering receptor expressed on myeloid cells 2", "longitud": 230, "funcion": "Forms a receptor signaling complex with TYROBP."},
    "reactome_rutas": [],
    "string_interactores": [{"interactor": "TYROBP", "puntuacion": 0.99}, {"interactor": "APOE", "puntuacion": 0.9}],
    "chembl_diana": {"diana": None, "mecanismos": []},
    "dgidb_gen": {"total": 0, "interacciones": []},
    "pubtator_relaciones": FALLO,
}
IDS_TREM2 = {"simbolo": "TREM2", "nombre": "triggering receptor expressed on myeloid cells 2", "ensembl": "ENSG00000095970", "uniprot": "Q9NZC2", "entrez": "54209"}


def perfil(respuestas: dict[str, Any], ids: dict[str, Any] | None = IDS_TREM2, simbolo: str = "TREM2", contexto: Any = None):
    c = consultar_falso(respuestas)
    p = asyncio.run(D.perfil_de_diana(simbolo, ids, consultar=c, contexto=contexto))
    return p, c.llamadas  # type: ignore[attr-defined]


def capas(p: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["capa"]: c for c in p["capas"]}


def hipotesis(**campos: Any) -> dict[str, Any]:
    h = {"id": "hip-1", "titulo": "TREM2 en microglía", "enunciado": "", "mecanismo": "", "tarjeta": {"diana": "TREM2", "celula": "microglía del hipocampo", "etapa": "", "intervencion": "", "direccion": "sin_intervencion", "prediccionFalsable": "", "riesgos": []}, "afirmaciones": [], "procedencia": {"fuentes": []}}
    h.update(campos)
    return h


# ---------------------------------------------------------------------------
# Perfil: las tres clases de estado por regla
# ---------------------------------------------------------------------------


def test_perfil_con_las_tres_clases_de_estado():
    p, llamadas = perfil(RESPUESTAS_TREM2, contexto={"celula": "microglía del hipocampo"})
    c = capas(p)
    assert [x["capa"] for x in p["capas"]] == list(D.CAPAS)
    assert c["genetica_humana"]["estado"] == "presente" and c["genetica_humana"]["direccion"] == "-"
    assert "GWAS Catalog: 3 asociaciones con Alzheimer" in c["genetica_humana"]["detalle"] and "1.0e-12" in c["genetica_humana"]["detalle"]
    assert "ClinVar: 0 variantes con Alzheimer de 25" in c["genetica_humana"]["detalle"]
    assert "asociación genética 0.7" in c["genetica_humana"]["detalle"] and "eva (3)" in c["genetica_humana"]["detalle"]
    assert c["expresion_tejido"]["estado"] == "presente" and "58.6 nTPM" in c["expresion_tejido"]["detalle"]
    assert c["expresion_celular"]["estado"] == "presente" and "central nervous system macrophage (127.5 nCPM)" in c["expresion_celular"]["detalle"] and "Hofbauer cells" in c["expresion_celular"]["detalle"]
    assert c["proteina_funcion"]["estado"] == "presente" and "Reactome: 0 rutas" in c["proteina_funcion"]["detalle"] and "TYROBP, APOE" in c["proteina_funcion"]["detalle"]
    assert c["farmacologia"]["estado"] == "ausente" and c["farmacologia"]["direccion"] is None
    assert c["literatura"]["estado"] == "no_pude_comprobar" and "tiempo agotado" in c["literatura"]["detalle"]
    # Solo la genética lleva dirección; las demás capas None.
    assert all(x["direccion"] is None for x in p["capas"] if x["capa"] != "genetica_humana")
    # Fuentes y registros: la consulta a HPA se comparte entre dos capas y no se duplica en el registro global.
    assert c["genetica_humana"]["fuentes"] == ["gwas_asociaciones_gen", "clinvar_gen", "opentargets_graphql"]
    assert c["expresion_tejido"]["fuentes"] == ["hpa_expresion"] and c["expresion_celular"]["fuentes"] == ["hpa_expresion"]
    assert c["expresion_tejido"]["registro"][0] is c["expresion_celular"]["registro"][0]
    assert len(p["registro"]) == len(llamadas) == 10 and sum(1 for n, _ in llamadas if n == "hpa_expresion") == 1
    assert all(r["herramienta"] for r in p["registro"])
    # Sin puntuación combinada ni porcentajes de confianza.
    assert not any(k in p for k in ("puntuacion", "score", "confianza")) and not re.search(r"\d+ ?%", p["resumen"])
    assert p["resumen"].startswith("TREM2: de 6 capas, 4 con registro") and "1 sin nada en las bases (farmacología)" in p["resumen"] and "1 sin poder comprobar (literatura)" in p["resumen"]
    assert isinstance(p["consultadoEn"], int) and p["identificadores"]["ensembl"] == "ENSG00000095970"
    # GTEx no se consulta sin GENCODE con versión, y se dice.
    assert not any(n == "gtex_expresion" for n, _ in llamadas) and "GENCODE con versión" in c["expresion_tejido"]["detalle"]
    # PubTator recibe la pareja gen y enfermedad.
    assert ("pubtator_relaciones", {"entidad": "@GENE_TREM2", "con": "@DISEASE_Alzheimer_Disease"}) in llamadas


def test_error_de_red_no_es_ausencia():
    p, _ = perfil({})  # todo falla
    assert all(c["estado"] == "no_pude_comprobar" for c in p["capas"])
    assert not any(c["estado"] == "ausente" for c in p["capas"])
    assert all("no pude comprobar" in c["detalle"].lower() and "timeout" in c["detalle"] for c in p["capas"])
    assert all(c["direccion"] is None for c in p["capas"])
    assert "6 sin poder comprobar" in p["resumen"]
    # Un conector que ni siquiera existe en el catálogo tampoco rompe ni se lee como ausencia.
    p2, _ = perfil({**RESPUESTAS_TREM2, "gwas_asociaciones_gen": NO_REGISTRADO, "clinvar_gen": NO_REGISTRADO, "opentargets_graphql": NO_REGISTRADO})
    g = capas(p2)["genetica_humana"]
    assert g["estado"] == "no_pude_comprobar" and "KeyError" in g["detalle"] and g["registro"][0]["error"]


def test_ausente_solo_cuando_todas_las_bases_respondieron_vacias():
    vacias = {"gwas_asociaciones_gen": {"total_asociaciones": 12, "en_esta_pagina": 12, "n_alzheimer": 0, "alzheimer": []}, "clinvar_gen": {"variantes_gen": 3, "con_enfermedad": 0, "ids": []}, "opentargets_graphql": ot(target=False)}
    g = capas(perfil({**RESPUESTAS_TREM2, **vacias})[0])["genetica_humana"]
    assert g["estado"] == "ausente" and g["direccion"] is None
    assert "GWAS Catalog: 0 asociaciones con Alzheimer entre 12 registradas del gen" in g["detalle"] and "la diana no está en la plataforma" in g["detalle"]
    # Una vacía y otra caída: no pude comprobar, nunca ausente.
    g2 = capas(perfil({**RESPUESTAS_TREM2, **vacias, "clinvar_gen": FALLO})[0])["genetica_humana"]
    assert g2["estado"] == "no_pude_comprobar" and "ClinVar: no pude comprobar" in g2["detalle"]
    # Una con datos y otra caída: presente, y el fallo se dice al lado.
    g3 = capas(perfil({**RESPUESTAS_TREM2, "clinvar_gen": FALLO})[0])["genetica_humana"]
    assert g3["estado"] == "presente" and "ClinVar: no pude comprobar" in g3["detalle"] and "GWAS Catalog: 3 asociaciones" in g3["detalle"]
    # Open Targets con errores GraphQL (HTTP 200 y `errors`): no pude comprobar, no vacío.
    g4 = capas(perfil({**RESPUESTAS_TREM2, **vacias, "opentargets_graphql": {"errors": [{"message": "Cannot query field"}], "data": None}})[0])["genetica_humana"]
    assert g4["estado"] == "no_pude_comprobar" and "GraphQL" in g4["detalle"]
    # Sin Ensembl no se consulta Open Targets y se explica; la capa sigue decidiéndose con GWAS y ClinVar.
    p5, llamadas5 = perfil({**RESPUESTAS_TREM2, **vacias}, ids={"simbolo": "TREM2"})
    g5 = capas(p5)["genetica_humana"]
    assert not any(n == "opentargets_graphql" for n, _ in llamadas5) and "Open Targets: no consultado (sin identificador Ensembl" in g5["detalle"] and g5["estado"] == "ausente"
    assert g5["fuentes"] == ["gwas_asociaciones_gen", "clinvar_gen"]


def test_direccion_genetica_por_regla_y_explicada():
    lof_riesgo = {"datasourceId": "eva", "directionOnTrait": "risk", "directionOnTarget": "LoF"}
    gof_riesgo = {"datasourceId": "gene_burden", "directionOnTrait": "risk", "directionOnTarget": "GoF"}
    lof_protege = {"datasourceId": "eva", "directionOnTrait": "protect", "directionOnTarget": "LoF"}
    solo_rasgo = {"datasourceId": "eva", "directionOnTrait": "risk", "directionOnTarget": None}
    assert D._direccion_open_targets([lof_riesgo, lof_riesgo]) == ("-", "2 evidencias con dirección '-' (menos función de la diana, más riesgo) de eva (2)")
    signo, motivo = D._direccion_open_targets([gof_riesgo, lof_protege])
    assert signo == "+" and "más función de la diana, más riesgo" in motivo and "gene_burden (1)" in motivo and "eva (1)" in motivo
    signo, motivo = D._direccion_open_targets([lof_riesgo, gof_riesgo])
    assert signo is None and motivo.startswith("direcciones discrepantes: 1 evidencias '+'") and "1 '-'" in motivo
    signo, motivo = D._direccion_open_targets([solo_rasgo, {"datasourceId": "gwas_credible_sets"}])
    assert signo is None and "sin dirección del efecto" in motivo and "1 solo con riesgo sobre el rasgo" in motivo
    assert D._direccion_open_targets([]) == (None, "sin dirección del efecto: ninguna evidencia trae a la vez dirección sobre el rasgo y sobre la diana")
    assert D._direccion_open_targets(["basura", None]) [0] is None
    # En el perfil: la dirección discrepante deja None y el motivo en los datos de la capa.
    g = capas(perfil({**RESPUESTAS_TREM2, "opentargets_graphql": ot(evidencias=[lof_riesgo, gof_riesgo])})[0])["genetica_humana"]
    assert g["direccion"] is None and "discrepantes" in g["datos"]["direccionMotivo"] and g["estado"] == "presente"


def test_expresion_con_hpa_sin_claves_de_distribucion_y_con_no_detectado():
    # Solo las claves que trae hoy el conector hpa_expresion: cerebro enriquecido basta para presente.
    hpa_viejo = {"Gene": "GFAP", "RNA tissue specificity": "Tissue enriched", "RNA tissue specific nTPM": {"brain": "15929.3"}, "RNA brain regional specificity": "Low regional specificity", "RNA single cell type specificity": "Cell type enriched"}
    c = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_viejo})[0])
    assert c["expresion_tejido"]["estado"] == "presente" and "15929.3 nTPM" in c["expresion_tejido"]["detalle"]
    assert c["expresion_celular"]["estado"] == "presente" and "falta la clave 'RNA single cell type specific nCPM'" in c["expresion_celular"]["detalle"]
    # Enriquecido en hígado sin clave de distribución cerebral: HPA no dice nada del cerebro; no pude comprobar, no ausente.
    hpa_alb = {"Gene": "ALB", "RNA tissue specificity": "Tissue enriched", "RNA tissue specific nTPM": {"liver": "198523.8"}, "RNA brain regional specificity": "Low regional specificity"}
    t = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_alb})[0])["expresion_tejido"]
    assert t["estado"] == "no_pude_comprobar" and "RNA brain regional distribution" in t["detalle"] and "liver (198523.8 nTPM)" in t["detalle"]
    assert t["datos"]["cerebroDetectado"] is None
    # Con "Detected in many" en regiones cerebrales, presente aunque el tejido enriquecido sea otro.
    t2 = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": {**hpa_alb, "RNA brain regional distribution": "Detected in many"}})[0])["expresion_tejido"]
    assert t2["estado"] == "presente" and t2["datos"]["cerebroDetectado"] is True
    # "Not detected" es lo único que autoriza ausente.
    hpa_no = {"Gene": "X", "RNA tissue specificity": "Tissue enriched", "RNA tissue specific nTPM": {"testis": "40"}, "RNA brain regional distribution": "Not detected", "RNA single cell type specificity": "Not detected", "RNA single cell type distribution": "Not detected"}
    c3 = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_no})[0])
    assert c3["expresion_tejido"]["estado"] == "ausente" and "no detectado en cerebro" in c3["expresion_tejido"]["detalle"] and c3["expresion_tejido"]["datos"]["cerebroDetectado"] is False
    assert c3["expresion_celular"]["estado"] == "ausente" and c3["expresion_celular"]["datos"]["detectado"] is False
    # HPA caído: las dos capas no pude comprobar, con el error.
    c4 = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": FALLO})[0])
    assert c4["expresion_tejido"]["estado"] == c4["expresion_celular"]["estado"] == "no_pude_comprobar" and "timeout" in c4["expresion_tejido"]["detalle"]
    # HPA sin ficha para el Ensembl: respondió, pero no dice nada; no pude comprobar.
    c5 = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": {}})[0])
    assert c5["expresion_tejido"]["estado"] == "no_pude_comprobar" and "sin ficha" in c5["expresion_tejido"]["detalle"]


def test_gtex_solo_con_gencode_y_tejido_de_la_tarjeta():
    ids = {**IDS_TREM2, "gencode": "ENSG00000095970.11"}
    p, llamadas = perfil({**RESPUESTAS_TREM2, "gtex_expresion": [{"gen": "TREM2", "tejido": "Brain_Cortex", "mediana": 12.3, "unidad": "TPM"}]}, ids=ids, contexto={"celula": "microglía de la corteza frontal"})
    args = next(a for n, a in llamadas if n == "gtex_expresion")
    assert args == {"gencode": "ENSG00000095970.11", "tejido": "Brain_Cortex"}
    t = capas(p)["expresion_tejido"]
    assert "GTEx v10: mediana 12.3 TPM en Brain_Cortex" in t["detalle"] and t["fuentes"] == ["hpa_expresion", "gtex_expresion"] and t["datos"]["gtex"]["mediana"] == 12.3
    # Sin contexto reconocible, hipocampo por defecto; mediana 0 es una respuesta (vacío), no un fallo.
    p2, llamadas2 = perfil({**RESPUESTAS_TREM2, "hpa_expresion": FALLO, "gtex_expresion": [{"gen": "TREM2", "tejido": "Brain_Hippocampus", "mediana": 0, "unidad": "TPM"}]}, ids=ids)
    assert next(a for n, a in llamadas2 if n == "gtex_expresion")["tejido"] == "Brain_Hippocampus"
    t2 = capas(p2)["expresion_tejido"]
    assert t2["estado"] == "no_pude_comprobar" and "mediana 0 TPM" in t2["detalle"]  # HPA caído manda: no pude comprobar
    # Cero filas de GTEx no decide nada (puede ser la versión del GENCODE).
    t3 = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": FALLO, "gtex_expresion": []}, ids=ids)[0])["expresion_tejido"]
    assert t3["estado"] == "no_pude_comprobar" and "versión del GENCODE" in t3["detalle"]
    assert D.tejido_gtex_de("astrocitos del hipocampo") == "Brain_Hippocampus" and D.tejido_gtex_de("plasma") == "Whole_Blood" and D.tejido_gtex_de("") == "Brain_Hippocampus" and D.tejido_gtex_de("hippocampal astrocytes") == "Brain_Hippocampus"


def test_farmacologia_literatura_y_proteina():
    con_farmacos = {"chembl_diana": {"diana": "CHEMBL2321", "nombre": "TREM2", "mecanismos": [{"molecula": "CHEMBL1", "accion": "AGONIST", "fase_maxima": 2}, {"molecula": "CHEMBL2", "accion": "AGONIST", "fase_maxima": 1}]}, "dgidb_gen": {"total": 4, "interacciones": [{"farmaco": "DONEPEZIL", "aprobado": True, "tipos": ["inhibitor"], "puntuacion": 1.0}, {"farmaco": "X", "aprobado": False}]}}
    f = capas(perfil({**RESPUESTAS_TREM2, **con_farmacos})[0])["farmacologia"]
    assert f["estado"] == "presente" and "ChEMBL: 2 mecanismos de acción de fármacos sobre CHEMBL2321 (fase máxima 2)" in f["detalle"] and "DGIdb: 4 interacciones fármaco-gen, 1 con fármacos aprobados (DONEPEZIL)" in f["detalle"]
    # Sin UniProt no hay ChEMBL ni Reactome, y la capa lo dice sin inventar ausencia.
    p, llamadas = perfil({**RESPUESTAS_TREM2, "uniprot_proteina": None}, ids={"simbolo": "TREM2", "ensembl": "ENSG00000095970"})
    assert not any(n in ("chembl_diana", "reactome_rutas") for n, _ in llamadas)
    c = capas(p)
    assert "ChEMBL: no consultado (sin accession UniProt)" in c["farmacologia"]["detalle"] and c["farmacologia"]["estado"] == "ausente"
    assert "UniProt: sin entrada revisada" in c["proteina_funcion"]["detalle"] and c["proteina_funcion"]["estado"] == "presente"  # STRING sí tiene red
    # Si UniProt resuelve la accession aunque MyGene no la diera, se usa para ChEMBL y Reactome.
    p2, llamadas2 = perfil(RESPUESTAS_TREM2, ids={"simbolo": "TREM2", "ensembl": "ENSG00000095970"})
    assert any(n == "chembl_diana" and a == {"uniprot": "Q9NZC2"} for n, a in llamadas2) and p2["identificadores"]["uniprot"] == "Q9NZC2"
    # Literatura con relaciones contadas y traducidas.
    lit = capas(perfil({**RESPUESTAS_TREM2, "pubtator_relaciones": {"entidad": "@GENE_TREM2", "relaciones": [{"tipo": "associate", "de": "@DISEASE_Alzheimer_Disease", "a": "@GENE_TREM2", "publicaciones": 749}, {"tipo": "stimulate", "publicaciones": 18}]}})[0])["literatura"]
    assert lit["estado"] == "presente" and "2 tipos de relación entre TREM2 y Alzheimer con 767 publicaciones" in lit["detalle"] and "asociación 749" in lit["detalle"] and "estimulación 18" in lit["detalle"]
    lit2 = capas(perfil({**RESPUESTAS_TREM2, "pubtator_relaciones": {"entidad": "@GENE_TREM2", "relaciones": []}})[0])["literatura"]
    assert lit2["estado"] == "ausente" and "0 relaciones anotadas" in lit2["detalle"]


def test_sin_simbolo_no_consulta_y_no_rompe():
    p, llamadas = perfil(RESPUESTAS_TREM2, ids=None, simbolo="")
    assert llamadas == [] and p["registro"] == [] and all(c["estado"] == "no_pude_comprobar" and "no resuelve a un gen humano" in c["detalle"] for c in p["capas"])
    assert p["diana"] == "sin diana" and "6 sin poder comprobar" in p["resumen"]
    # El símbolo puede venir solo en ids.
    p2, llamadas2 = perfil(RESPUESTAS_TREM2, ids={"simbolo": "trem2 "}, simbolo=None)  # type: ignore[arg-type]
    assert p2["diana"] == "trem2" and llamadas2[0] == ("gwas_asociaciones_gen", {"simbolo": "trem2"})
    # Datos con formas raras (listas donde iban diccionarios, textos donde iban números) no rompen.
    raros = {k: ["x"] for k in RESPUESTAS_TREM2}
    raros["gwas_asociaciones_gen"] = {"n_alzheimer": "tres", "alzheimer": [{"p": "no"}], "total_asociaciones": None}
    p3, _ = perfil(raros)
    assert len(p3["capas"]) == 6 and all(c["estado"] in D.ESTADOS for c in p3["capas"])


# ---------------------------------------------------------------------------
# Texto para el Killer y el juez
# ---------------------------------------------------------------------------


def test_texto_perfil_es_una_tabla_en_castellano_con_tildes():
    p, _ = perfil(RESPUESTAS_TREM2)
    t = D.texto_perfil(p)
    lineas = t.split("\n")
    assert lineas[0].startswith("Perfil de evidencia por diana: TREM2 (Ensembl ENSG00000095970; UniProt Q9NZC2)") and "sin puntuación combinada" in lineas[0]
    assert lineas[1] == "Capa | Estado | Dirección | Detalle | Conectores"
    filas = lineas[2:-1]
    assert len(filas) == 6 and all(f.count(" | ") == 4 for f in filas)
    assert filas[0].startswith("Genética humana (¿la genética humana vincula el gen con el Alzheimer?) | presente | - (menos función de la diana, más riesgo) |")
    assert filas[1].startswith("Expresión en tejido") and " | no aplica | " in filas[1]
    assert filas[4].startswith("Farmacología") and " | ausente | " in filas[4]
    assert filas[5].startswith("Literatura") and " | no pude comprobar | " in filas[5]
    assert lineas[-1].startswith("Leyenda:") and "no es ausencia" in lineas[-1]
    for palabra in ("Genética", "Expresión", "Farmacología", "Proteína y función", "Dirección", "más función", "puntuación"):
        assert palabra in t
    assert "\u2014" not in t and "\u2014" not in open(D.__file__, encoding="utf-8").read()
    # Perfil ausente o de un registro antiguo.
    assert D.texto_perfil(None).startswith("Perfil de evidencia por diana: sin consultar")
    assert D.texto_perfil({}).startswith("Perfil de evidencia por diana: sin consultar")
    # Capas con claves de menos (registro antiguo) no rompen la tabla.
    viejo = {"diana": "APOE", "capas": [{"capa": "genetica_humana", "estado": "presente"}, {"capa": "capa_desconocida"}, "basura"]}
    t2 = D.texto_perfil(viejo)
    assert "Genética humana" in t2 and "capa_desconocida" in t2 and "sin dirección" in t2
    # El detalle largo se corta para no inundar al juez.
    largo = {"diana": "X", "capas": [{"capa": "literatura", "estado": "presente", "detalle": "a" * 1000, "fuentes": ["pubtator_relaciones"]}]}
    assert len(D.texto_perfil(largo).split("\n")[2]) < 600


# ---------------------------------------------------------------------------
# Comprobación del Killer: contexto humano
# ---------------------------------------------------------------------------


def test_contexto_humano_pasa_por_celula_region_o_gtex():
    p, _ = perfil(RESPUESTAS_TREM2)
    r = D.comprobacion_contexto_humano(hipotesis(), p)
    assert r == {"comprobacion": "contexto_humano", "resultado": "pasa", "detalle": "TREM2 se expresa en humanos donde la tarjeta lo sitúa ('microglía del hipocampo'): HPA célula única: central nervous system macrophage (127.5 nCPM); HPA: detectado en todas las regiones cerebrales."}
    # En inglés también.
    r2 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": "hippocampal microglial cells"}), p)
    assert r2["resultado"] == "pasa" and "central nervous system macrophage" in r2["detalle"]
    # Región enriquecida en HPA.
    hpa_gfap = {**HPA_TREM2, "Gene": "GFAP", "RNA brain regional distribution": "Detected in many", "RNA brain regional specific nTPM": {"hippocampal formation": "820.4"}, "RNA single nuclei brain specific nCPM": {"astrocyte": "3000.1"}}
    p3, _ = perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_gfap})
    r3 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GFAP", "celula": "hipocampo"}), p3)
    assert r3["resultado"] == "pasa" and "HPA región cerebral: hippocampal formation (820.4 nTPM)" in r3["detalle"]
    # Solo GTEx confirma el tejido.
    hpa_mudo = {"Gene": "X", "RNA tissue specificity": "Low tissue specificity"}
    p4, _ = perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_mudo, "gtex_expresion": [{"gen": "X", "tejido": "Brain_Hippocampus", "mediana": 3.5, "unidad": "TPM"}]}, ids={**IDS_TREM2, "gencode": "ENSG00000095970.11"}, contexto={"celula": "neuronas del hipocampo"})
    r4 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "X", "celula": "neuronas del hipocampo"}), p4)
    assert r4["resultado"] == "pasa" and "GTEx: mediana 3.5 TPM en Brain_Hippocampus" in r4["detalle"]
    # Pasa, pero toda la literatura es preclínica: se dice al lado.
    h5 = hipotesis(afirmaciones=[{"texto": "a", "cita": "[Ratón 2024, p. 3]", "veredicto": "sostenida"}], procedencia={"fuentes": [{"id": "f1", "referencia": "Ratón 2024", "tipoEstudio": "preclinico"}]})
    r5 = D.comprobacion_contexto_humano(h5, p)
    assert r5["resultado"] == "pasa" and "es preclínica o in vitro" in r5["detalle"]


def test_contexto_humano_falla_solo_con_no_detectado_y_mecanismo_cerebral():
    # Ficha inventada para un gen hepático ficticio (GENHEP). No se usa la ALB real
    # porque HPA 24 la da "Detected in many" en regiones cerebrales (comprobado en
    # vivo el 16 de septiembre de 2026): un test no debe atribuir a un gen real un
    # dato que la base no dice.
    hpa_no = {"Gene": "GENHEP", "RNA tissue specificity": "Tissue enriched", "RNA tissue specific nTPM": {"liver": "198523.8"}, "RNA brain regional distribution": "Not detected", "RNA single cell type specific nCPM": {"Hepatocytes": "81391.2"}}
    p, _ = perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_no}, ids={**IDS_TREM2, "simbolo": "GENHEP"}, simbolo="GENHEP")
    r = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GENHEP", "celula": "astrocitos reactivos"}), p)
    assert r["resultado"] == "falla" and r["detalle"].startswith("HPA no detecta GENHEP en cerebro humano (distribución 'not detected') y la hipótesis afirma un mecanismo cerebral (tarjeta: 'astrocitos reactivos')")
    # Sin célula en la tarjeta, el cerebro se busca en el texto de la hipótesis.
    r2 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GENHEP", "celula": ""}, mecanismo="Loss of synaptic GENHEP in the hippocampus"), p)
    assert r2["resultado"] == "falla" and "texto de la hipótesis" in r2["detalle"]
    # Mecanismo periférico: no falla; HPA expresa en hepatocitos y pasa.
    r3 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GENHEP", "celula": "hepatocitos"}), p)
    assert r3["resultado"] == "pasa" and "Hepatocytes (81391.2 nCPM)" in r3["detalle"]
    # Mecanismo periférico sin tejido cubierto: no comprobable, no falla.
    r4 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GENHEP", "celula": "riñón"}), p)
    assert r4["resultado"] == "no_comprobable" and "No sé traducir 'riñón'" in r4["detalle"]
    # "Corteza" sola no es cerebro: la suprarrenal no dispara el fallo aunque HPA no detecte en cerebro.
    r4b = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "GENHEP", "celula": "corteza suprarrenal"}), p)
    assert r4b["resultado"] == "no_comprobable" and "No sé traducir 'corteza suprarrenal'" in r4b["detalle"] and "mecanismo cerebral" not in r4b["detalle"]
    assert D.contextos_de("corteza suprarrenal") == [] and D.tejido_gtex_de("adrenal cortex") == D.TEJIDO_GTEX_POR_DEFECTO
    r4c = D.comprobacion_contexto_humano(hipotesis(titulo="GENHEP y cortisol", tarjeta={"diana": "GENHEP", "celula": ""}, mecanismo="Cortisol release from the adrenal cortex"), p)
    assert r4c["resultado"] == "no_comprobable" and "no nombra célula ni tejido" in r4c["detalle"]
    # Pero la corteza cerebral, o cualquier otra palabra cerebral junto a la suprarrenal, sí.
    assert D.mecanismo_cerebral(hipotesis(tarjeta={"diana": "GENHEP", "celula": "corteza prefrontal"})) == (True, "tarjeta: 'corteza prefrontal'")
    assert D.mecanismo_cerebral({"tarjeta": {"celula": ""}, "mecanismo": "adrenal cortex signalling to hippocampal neurons"})[0] is True
    # Con distribución cerebral detectada nunca falla aunque el tipo celular no aparezca; pero
    # "detectado en todas las regiones" cubre una región de la tarjeta, no un tipo celular:
    # TREM2 está en todas las regiones porque la microglía está en todas, no porque lo
    # expresen los oligodendrocitos. Eso queda en no comprobable, sin afirmar ausencia.
    p5, _ = perfil(RESPUESTAS_TREM2)
    r5 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": "oligodendrocitos"}), p5)
    assert r5["resultado"] == "no_comprobable" and "HPA detecta TREM2 en cerebro pero no confirma la célula o región" in r5["detalle"] and "no se afirma ausencia" in r5["detalle"] and "central nervous system macrophage" in r5["detalle"]
    r5b = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": "corteza entorrinal"}), p5)
    assert r5b["resultado"] == "pasa" and "detectado en todas las regiones cerebrales" in r5b["detalle"]
    hpa_parcial = {**HPA_TREM2, "RNA brain regional distribution": "Detected in some"}
    p6, _ = perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_parcial})
    r6 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": "oligodendrocitos"}), p6)
    assert r6["resultado"] == "no_comprobable" and "no confirma la célula o región" in r6["detalle"] and "no se afirma ausencia" in r6["detalle"]


def test_contexto_humano_no_comprobable_por_preclinica_y_por_falta_de_datos():
    fuentes = [{"id": "f1", "referencia": "Ratón 5xFAD 2023", "tipoEstudio": "preclinico"}, {"id": "f2", "referencia": "Cultivo 2022", "tipoEstudio": "in_vitro"}]
    afs = [{"texto": "a", "cita": "[Ratón 5xFAD 2023, p. 2]", "veredicto": "sostenida"}, {"texto": "b", "cita": "[Cultivo 2022, p. 5]", "veredicto": "parcial"}, {"texto": "c", "cita": "[Humanos 2021, p. 1]", "veredicto": "no_sostenida"}]
    h = hipotesis(afirmaciones=afs, procedencia={"fuentes": fuentes + [{"id": "f3", "referencia": "Humanos 2021", "tipoEstudio": "cohorte"}]})
    p, _ = perfil({**RESPUESTAS_TREM2, "hpa_expresion": FALLO})
    r = D.comprobacion_contexto_humano(h, p)
    assert r["resultado"] == "no_comprobable" and r["detalle"].startswith("No comprobado en humanos: las 2 fuentes sostenidas son preclínicas o in vitro")
    assert D.solo_preclinica(h) == (True, 2)  # la fuente humana solo sostiene una afirmación no sostenida: no cuenta
    # Con una fuente humana sostenida ya no es "solo preclínica".
    h2 = hipotesis(afirmaciones=afs + [{"texto": "d", "cita": "[Humanos 2021, p. 1]", "veredicto": "sostenida"}], procedencia=h["procedencia"])
    assert D.solo_preclinica(h2) == (False, 3)
    r2 = D.comprobacion_contexto_humano(h2, p)
    assert r2["resultado"] == "no_comprobable" and "no respondieron o no traen el dato" in r2["detalle"] and "timeout" in r2["detalle"]
    # Sin afirmaciones emparejables se usan todas las fuentes de la procedencia.
    h3 = hipotesis(afirmaciones=[], procedencia={"fuentes": fuentes})
    assert D.solo_preclinica(h3) == (True, 2)
    assert D.solo_preclinica(hipotesis()) == (False, 0)
    # La diana no resuelve a gen humano.
    p4, _ = perfil(RESPUESTAS_TREM2, ids={"simbolo": "INFLAMACION"}, simbolo="INFLAMACION")
    r4 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "inflamación glial", "celula": "microglía"}), p4)
    assert r4["resultado"] == "no_comprobable" and "no resuelve a un gen humano" in r4["detalle"]
    # La tarjeta no nombra célula ni tejido y el texto tampoco decide.
    p5, _ = perfil(RESPUESTAS_TREM2)
    r5 = D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": ""}, mecanismo="Modula la respuesta inmune"), p5)
    assert r5["resultado"] == "no_comprobable" and "no nombra célula ni tejido" in r5["detalle"]


def test_registros_antiguos_sin_contexto_bases_ni_perfil_no_rompen():
    # Hipótesis anterior a las bases: sin contextoBases, sin perfilDiana, sin tarjeta, id heredado con sufijo -inv-.
    vieja = {"id": "hip-abc-inv-2", "titulo": "GFAP y NfL en plasma", "afirmaciones": [{"veredicto": "sostenida", "texto": "x", "cita": "[Kim 2024]"}]}
    for perfil_viejo in (None, {}, {"capas": []}, {"diana": "GFAP", "capas": [{"capa": "expresion_tejido"}]}, "texto suelto", 42):
        r = D.comprobacion_contexto_humano(vieja, perfil_viejo)  # type: ignore[arg-type]
        assert r["comprobacion"] == "contexto_humano" and r["resultado"] == "no_comprobable" and r["detalle"]
    # Un perfil con la forma nueva pero sin identificadores (capas sí) tampoco rompe.
    r = D.comprobacion_contexto_humano(vieja, {"diana": "GFAP", "capas": [{"capa": "expresion_tejido", "estado": "presente"}]})
    assert r["resultado"] == "no_comprobable" and "no resuelve a un gen humano" in r["detalle"]
    # Tarjeta con tipos raros.
    rara = {"id": "hip-1", "tarjeta": "no soy un diccionario", "afirmaciones": None, "procedencia": None}
    p, _ = perfil(RESPUESTAS_TREM2)
    assert D.comprobacion_contexto_humano(rara, p)["resultado"] == "no_comprobable"
    assert D.mecanismo_cerebral({"titulo": None, "mecanismo": None}) == (False, "ni la tarjeta ni el texto nombran el cerebro")
    assert D.mecanismo_cerebral({"tarjeta": {"celula": "plasma"}}) == (False, "tarjeta: 'plasma'")
    assert D.mecanismo_cerebral({"tarjeta": {"celula": ""}, "enunciado": "Microglial TREM2 signalling"})[0] is True
    assert D.contextos_de(None) == [] and D.contextos_de("hipotálamo")[0]["gtex"] == "Brain_Hypothalamus" and not any(c["patron"].startswith("(?<!hipo)") for c in D.contextos_de("hipotálamo"))
    assert D.resumen_perfil({"capas": []}).startswith("Diana: sin capas consultadas")


def test_bordes_registro_sin_forma_cifras_raras_y_contexto_suelto():
    # Un `consultar` que devuelve un registro sin forma de diccionario: no pude comprobar, sin excepción.
    async def raro(nombre: str, /, resumen: str = "", origen: str = "bucle", **argumentos: Any):
        return "no soy un registro", {"n_alzheimer": 3}

    p = asyncio.run(D.perfil_de_diana("TREM2", IDS_TREM2, consultar=raro))
    assert all(c["estado"] == "no_pude_comprobar" and "registro sin forma" in c["detalle"] for c in p["capas"])
    assert all(r["error"] for r in p["registro"]) and len(p["registro"]) == 10
    # Cifras no numéricas en HPA se ignoran sin romper; el cerebro sigue decidiéndose por la distribución.
    hpa_raro = {**HPA_TREM2, "RNA tissue specific nTPM": {"brain": "abc", "liver": None}, "RNA single nuclei brain specific nCPM": "texto", "RNA brain regional distribution": "Detected in some"}
    c = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_raro})[0])
    assert c["expresion_tejido"]["estado"] == "presente" and c["expresion_tejido"]["datos"]["tejidosEnriquecidos"] == {} and c["expresion_tejido"]["datos"]["cerebroDetectado"] is True
    assert c["expresion_celular"]["datos"]["tiposCerebro"] == {} and c["expresion_celular"]["estado"] == "presente"
    # El contexto puede ser un texto suelto además de la tarjeta.
    p2, llamadas2 = perfil(RESPUESTAS_TREM2, ids={**IDS_TREM2, "gencode": "ENSG00000095970.11"}, contexto="hippocampus")
    assert p2["contexto"] == "hippocampus" and next(a for n, a in llamadas2 if n == "gtex_expresion")["tejido"] == "Brain_Hippocampus"
    # La tabla del perfil sin símbolo también se escribe.
    p3, _ = perfil(RESPUESTAS_TREM2, ids=None, simbolo="")
    t = D.texto_perfil(p3)
    assert t.startswith("Perfil de evidencia por diana: sin diana") and t.count("no pude comprobar |") == 6
    assert D.comprobacion_contexto_humano(hipotesis(), p3)["resultado"] == "no_comprobable"


# ---------------------------------------------------------------------------
# Adversariales: lo que rompió el módulo en la revisión y ya no rompe
# ---------------------------------------------------------------------------


def test_identificadores_en_lista_o_numero_no_rompen():
    # MyGene devuelve a veces listas (varios Ensembl para un símbolo); los registros
    # antiguos pueden traer números. Se toma el primer valor no vacío como texto.
    p, llamadas = perfil(RESPUESTAS_TREM2, ids={**IDS_TREM2, "ensembl": ["", "ENSG00000095970", "ENSG_OTRO"], "uniprot": ["Q9NZC2"], "entrez": 54209})
    assert p["identificadores"]["ensembl"] == "ENSG00000095970" and p["identificadores"]["uniprot"] == "Q9NZC2" and p["identificadores"]["entrez"] == "54209"
    assert any(n == "hpa_expresion" and a == {"ensembl": "ENSG00000095970"} for n, a in llamadas)
    p2, llamadas2 = perfil(RESPUESTAS_TREM2, ids={"simbolo": 5}, simbolo=7)  # type: ignore[arg-type]
    assert p2["diana"] == "7" and llamadas2[0] == ("gwas_asociaciones_gen", {"simbolo": "7"})
    p3, llamadas3 = perfil(RESPUESTAS_TREM2, ids={"simbolo": ["", "TREM2"], "nombre": ["x"]}, simbolo=None)  # type: ignore[arg-type]
    assert p3["diana"] == "TREM2" and llamadas3
    assert D._texto_id(None) == "" and D._texto_id(True) == "" and D._texto_id({"a": 1}) == "" and D._texto_id([None, "", 3]) == "3" and D._texto_id(" x ") == "x"
    # UniProt con la accession en lista tampoco rompe la capa de proteína.
    c = capas(perfil({**RESPUESTAS_TREM2, "uniprot_proteina": {"accession": ["Q9NZC2"], "nombre": None, "longitud": None, "funcion": ["Forms a complex."]}}, ids={"simbolo": "TREM2", "ensembl": "ENSG00000095970"})[0])
    assert c["proteina_funcion"]["estado"] == "presente" and "UniProt: Q9NZC2" in c["proteina_funcion"]["detalle"] and "Forms a complex." in c["proteina_funcion"]["detalle"]


def test_capas_de_tipo_raro_y_capas_sin_detalle():
    # Un registro antiguo con `capas` que no es una lista (número, texto, diccionario)
    # se trata como perfil sin consultar en las tres funciones públicas.
    for raro in (5, "texto", {"a": 1}, None, [1, "x", None]):
        p = {"diana": "X", "identificadores": {"ensembl": "E"}, "capas": raro}
        assert D.texto_perfil(p).startswith("Perfil de evidencia por diana: sin consultar")
        assert D.resumen_perfil(p) == "X: sin capas consultadas. Sin puntuación combinada: cada capa responde a una pregunta distinta."
        assert D.comprobacion_contexto_humano(hipotesis(), p) == {"comprobacion": "contexto_humano", "resultado": "no_comprobable", "detalle": "Sin perfil de diana: las bases no se han consultado para esta versión de la hipótesis"}
    # Una capa antigua sin detalle ni fuentes se escribe con un hueco explícito, no vacío.
    fila = D.texto_perfil({"diana": "X", "capas": [{"capa": "genetica_humana", "estado": "presente", "direccion": "arriba", "fuentes": "no soy lista"}]}).split("\n")[2]
    assert fila == "Genética humana (¿la genética humana vincula el gen con el Alzheimer?) | presente | sin dirección | sin detalle registrado | ninguno"
    # Un estado que no es de los tres cuenta como "no pude comprobar" y no deja una coma suelta.
    r = D.resumen_perfil({"diana": "X", "capas": [{"capa": "literatura", "estado": "raro"}, {"capa": "farmacologia", "estado": None}]})
    assert r == "X: de 2 capas, 2 sin poder comprobar (literatura, farmacología). Sin puntuación combinada: cada capa responde a una pregunta distinta."
    assert ", ." not in r


def test_hipotesis_sin_forma_no_rompe_las_comprobaciones():
    p, _ = perfil(RESPUESTAS_TREM2)
    for h in (None, [], "texto", 42, {"tarjeta": None, "afirmaciones": {"a": 1}, "procedencia": "texto"}, {"procedencia": {"fuentes": "x"}, "afirmaciones": [None, "b", {"veredicto": "sostenida"}]}):
        r = D.comprobacion_contexto_humano(h, p)  # type: ignore[arg-type]
        assert r["comprobacion"] == "contexto_humano" and r["resultado"] == "no_comprobable" and r["detalle"]
        assert D.solo_preclinica(h) == (False, 0)  # type: ignore[arg-type]
        assert D.mecanismo_cerebral(h) == (False, "ni la tarjeta ni el texto nombran el cerebro")  # type: ignore[arg-type]
        assert D.fuentes_sostenidas(h) == []  # type: ignore[arg-type]
    # Fuentes con tipoEstudio None o basura entre ellas: solo cuentan los diccionarios.
    assert D.solo_preclinica({"procedencia": {"fuentes": [{"id": "a", "tipoEstudio": None}, "basura", {"id": "b", "tipoEstudio": "preclinico"}]}}) == (False, 2)


def test_fuentes_sostenidas_es_lineal_y_no_repite_fuentes_heredadas():
    import time

    n = 3000
    fuentes = [{"id": f"f{i}", "referencia": f"Autor{i} 2020", "tipoEstudio": "preclinico"} for i in range(n)]
    afs = [{"texto": "x", "cita": f"[Autor{i} 2020, p. 1]", "veredicto": "sostenida"} for i in range(n)]
    h = hipotesis(id="hip-abc-inv-3", afirmaciones=afs, procedencia={"fuentes": fuentes})
    t0 = time.perf_counter()
    assert D.solo_preclinica(h) == (True, n)
    assert time.perf_counter() - t0 < 2.0  # antes: 17 s (un índice por afirmación)
    # Fuentes repetidas con el mismo id (heredadas de otra investigación) cuentan una vez;
    # con la misma referencia y sin id, también.
    dobles = [{"id": "f1", "referencia": "Kim 2024", "tipoEstudio": "preclinico"}, {"id": "f1", "referencia": "Kim 2024", "tipoEstudio": "preclinico"}, {"referencia": "Lee 2023", "tipoEstudio": "in_vitro"}, {"referencia": "Lee 2023.", "tipoEstudio": "in_vitro"}]
    h2 = hipotesis(afirmaciones=[{"cita": "[Kim 2024, p. 2]", "veredicto": "sostenida"}, {"cita": "[Lee 2023, p. 1]", "veredicto": "parcial"}], procedencia={"fuentes": dobles})
    assert D.solo_preclinica(h2) == (True, 2)
    assert D.solo_preclinica(hipotesis(afirmaciones=[], procedencia={"fuentes": dobles})) == (True, 2)
    # Por fuenteId, como certeza.fuente_de.
    h3 = hipotesis(afirmaciones=[{"fuenteId": "f9", "veredicto": "sostenida"}], procedencia={"fuentes": [{"id": "f9", "tipoEstudio": "cohorte"}, {"id": "f1", "tipoEstudio": "preclinico"}]})
    assert D.solo_preclinica(h3) == (False, 1) and D.fuentes_sostenidas(h3)[0]["id"] == "f9"


def test_contexto_acepta_la_hipotesis_entera_y_hpa_sin_distinguir_mayusculas():
    gtex = [{"gen": "TREM2", "tejido": "Brain_Cortex", "mediana": 1.2, "unidad": "TPM"}]
    h = hipotesis(tarjeta={"diana": "TREM2", "celula": "microglía de la corteza"})
    p, llamadas = perfil({**RESPUESTAS_TREM2, "gtex_expresion": gtex}, ids={**IDS_TREM2, "gencode": "ENSG00000095970.11"}, contexto=h)
    assert next(a for n, a in llamadas if n == "gtex_expresion")["tejido"] == "Brain_Cortex" and p["contexto"] == "microglía de la corteza"
    # Contexto como lista de trozos o como número raro.
    p2, _ = perfil(RESPUESTAS_TREM2, contexto=["astrocitos", None, "hipocampo"])
    assert p2["contexto"] == "astrocitos hipocampo"
    assert perfil(RESPUESTAS_TREM2, contexto=42)[0]["contexto"] == "42"
    # HPA con 'Brain' en mayúscula: se reconoce el cerebro igual.
    hpa_may = {"Gene": "TREM2", "RNA tissue specificity": "Tissue enhanced", "RNA tissue specific nTPM": {"Brain": "58.6", "Choroid Plexus": "55.1"}}
    t = capas(perfil({**RESPUESTAS_TREM2, "hpa_expresion": hpa_may})[0])["expresion_tejido"]
    assert t["estado"] == "presente" and t["datos"]["cerebroDetectado"] is True and "cerebro 58.6 nTPM" in t["detalle"]
    # Y la célula de la tarjeta en mayúsculas y mezcla de idiomas.
    assert D.comprobacion_contexto_humano(hipotesis(tarjeta={"diana": "TREM2", "celula": "MICROGLÍA HIPPOCAMPAL"}), perfil(RESPUESTAS_TREM2)[0])["resultado"] == "pasa"


def test_direccion_explica_las_evidencias_con_una_sola_direccion_y_la_lectura_parcial():
    # Lo que Open Targets devuelve en vivo para ABCA7 (16 de septiembre de 2026): 3 evidencias con
    # riesgo y pérdida de función, 9 solo con pérdida de función, 16 de eva y 24 de credible sets sin nada.
    filas = [{"datasourceId": "eva", "directionOnTrait": "risk", "directionOnTarget": "LoF"}] * 3 + [{"datasourceId": "eva", "directionOnTarget": "LoF"}] * 9 + [{"datasourceId": "eva"}] * 16 + [{"datasourceId": "gwas_credible_sets"}] * 24
    signo, motivo = D._direccion_open_targets(filas)
    assert signo == "-" and motivo.startswith("3 evidencias con dirección '-'") and "9 solo con pérdida de función de la diana, sin dirección sobre el rasgo" in motivo
    # Si la consulta leyó menos evidencias de las que Open Targets cuenta, se dice.
    signo2, motivo2 = D._direccion_open_targets(filas, total=812)
    assert signo2 == "-" and "se leyeron 52 de las 812 evidencias" in motivo2
    assert "se leyeron" not in D._direccion_open_targets(filas, total=52)[1] and "se leyeron" not in D._direccion_open_targets(filas, total="no")[1]
    signo3, motivo3 = D._direccion_open_targets([{"directionOnTarget": "GoF"}], total=None)
    assert signo3 is None and "1 solo con ganancia de función de la diana" in motivo3
    # Dentro del perfil, con `evidences.count` mayor que las filas leídas.
    o = ot(evidencias=[{"datasourceId": "eva", "directionOnTrait": "risk", "directionOnTarget": "LoF"}])
    o["target"]["evidences"]["count"] = 600
    g = capas(perfil({**RESPUESTAS_TREM2, "opentargets_graphql": o})[0])["genetica_humana"]
    assert g["direccion"] == "-" and "se leyeron 1 de las 600" in g["datos"]["direccionMotivo"]
    # Evidencias que no son una lista no rompen.
    o2 = ot(); o2["target"]["evidences"] = {"count": 3, "rows": "texto"}
    assert capas(perfil({**RESPUESTAS_TREM2, "opentargets_graphql": o2})[0])["genetica_humana"]["direccion"] is None


def test_perfil_de_otra_diana_o_de_otra_version_no_se_usa():
    p, _ = perfil(RESPUESTAS_TREM2)
    # La hipótesis ya resolvió su diana a otro Ensembl (contextoBases): el perfil no sirve.
    h = hipotesis(tarjeta={"diana": "APOE", "celula": "microglía"}, contextoBases={"identificadores": {"ensembl": "ENSG00000130203"}})
    r = D.comprobacion_contexto_humano(h, p)
    assert r["resultado"] == "no_comprobable" and "es de otro gen (Ensembl ENSG00000095970)" in r["detalle"] and "ENSG00000130203" in r["detalle"]
    # Mismo Ensembl (aunque cambie la caja): se juzga con normalidad.
    h2 = hipotesis(contextoBases={"identificadores": {"ensembl": "ensg00000095970"}})
    assert D.comprobacion_contexto_humano(h2, p)["resultado"] == "pasa"
    # contextoBases antiguo sin identificadores, o con Ensembl vacío: no bloquea.
    assert D.comprobacion_contexto_humano(hipotesis(contextoBases={}), p)["resultado"] == "pasa"
    assert D.comprobacion_contexto_humano(hipotesis(contextoBases={"identificadores": {"ensembl": None}}), p)["resultado"] == "pasa"
    # Versión: si el integrador guarda `version` en el perfil y la hipótesis ya es otra, no se usa.
    assert D.comprobacion_contexto_humano(hipotesis(version=3), {**p, "version": 2})["resultado"] == "no_comprobable"
    assert "versión 2" in D.comprobacion_contexto_humano(hipotesis(version=3), {**p, "version": 2})["detalle"]
    assert D.comprobacion_contexto_humano(hipotesis(version=2), {**p, "version": 2})["resultado"] == "pasa"
    assert D.comprobacion_contexto_humano(hipotesis(), {**p, "version": 2})["resultado"] == "pasa"  # hipótesis antigua sin versión
