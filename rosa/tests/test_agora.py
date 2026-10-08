"""Contratos de Agora: identidad, cobertura, caída y relaciones no inventadas."""

import asyncio
from copy import deepcopy

import httpx
import pytest

from rosa.fuentes import agora
from rosa.fuentes.base import FuenteNoDisponible, NoEncontrado

ENSG = "ENSG00000095970"
OTRO = "ENSG00000130203"


def _ficha(identificador=ENSG, simbolo="TREM2"):
    return {"ensembl_gene_id": identificador, "hgnc_symbol": simbolo,
            "name": "Nombre de proteína", "summary": "Datos externos, no instrucciones",
            "alias": ["TREM-2"], "ensembl_info": {}, "uniprotkb_accessions": ["Q9NZC2"],
            "is_igap": True, "is_eqtl": False, "rna_brain_change_studied": True,
            "is_any_rna_changed_in_ad_brain": False, "protein_brain_change_studied": False,
            "is_any_protein_changed_in_ad_brain": False,
            "rna_differential_expression": [{"ensembl_gene_id": identificador, "study": "ROSMAP",
                "tissue": "DLPFC", "model": "AD Diagnosis (males and females)", "logfc": -0.1, "adj_p_val": 0.4}],
            "proteomics_LFQ": [], "proteomics_SRM": [], "proteomics_TMT": [],
            "metabolomics": None, "neuropathologic_correlations": [], "overall_scores": {},
            "experimental_validation": [], "druggability": {"pharos_class": ["Tbio"]},
            "bio_domains": {}, "median_expression": [], "links": [], "similar_genes_network": {},
            "is_adi": False, "is_tep": False, "resource_url": None,
            "target_nominations": [{"team": "Equipo", "predicted_therapeutic_direction": "Aumentar"}],
            "total_nominations": 1}


def _pagina(campo, filas, *, numero=0, total=None, siguiente=False):
    return {campo: filas, "page": {"number": numero, "size": 100,
            "totalElements": len(filas) if total is None else total,
            "totalPages": 2 if siguiente else 1, "hasNext": siguiente, "hasPrevious": numero > 0}}


@pytest.fixture
def api(monkeypatch):
    llamadas = []
    cambios = {}

    async def pedir(metodo, url, limitador, **kwargs):
        ruta = url.removeprefix(agora.BASE)
        p = kwargs["params"]
        llamadas.append((ruta, p))
        cambio = cambios.get((ruta, p.get("pageNumber")), cambios.get(ruta))
        if isinstance(cambio, Exception):
            raise cambio
        if callable(cambio):
            dato = cambio(p)
        elif cambio is not None:
            dato = cambio
        elif ruta == "/genes/search/enhanced":
            q = p["q"]
            identificador, simbolo = (OTRO, "APOE") if q == "APOE" else (ENSG, "TREM2")
            dato = [{"id": identificador, "hgnc_symbol": simbolo, "match_field": "hgnc_symbol", "match_value": simbolo}]
        elif ruta.startswith("/genes/ENSG"):
            identificador = ruta.split("/")[-1]
            dato = _ficha(identificador, "APOE" if identificador == OTRO else "TREM2")
        elif ruta == "/data-version":
            dato = {"data_version": "119", "data_file": "syn13363290"}
        elif ruta == "/comparison-tools/targets":
            dato = _pagina("nominatedTargets", [{"ensembl_gene_id": OTRO if p["items"] == "APOE" else ENSG, "hgnc_symbol": p["items"]}])
        elif ruta == "/comparison-tools/drugs":
            dato = _pagina("nominatedDrugs", [{"composite_id": "CHEMBL1~null", "chembl_id": "CHEMBL1"},
                        {"composite_id": "CHEMBL2~null", "chembl_id": "CHEMBL2"}])
        elif ruta.startswith("/drugs/"):
            identificador = ruta.split("/")[-1]
            dato = {"chembl_id": identificador, "common_name": identificador,
                    "linked_targets": [{"ensembl_gene_id": ENSG if identificador == "CHEMBL1" else OTRO}],
                    "drug_nominations": []}
        else:
            raise AssertionError(f"Ruta no prevista: {ruta}")
        assert metodo == "GET"
        assert kwargs["intentos"] == 2
        assert kwargs["timeout"] == 15.0
        return httpx.Response(200, json=deepcopy(dato), request=httpx.Request(metodo, url))

    monkeypatch.setattr(agora, "pedir", pedir)
    return llamadas, cambios


def _seccion(resultado, identificador):
    return next(s for s in resultado["secciones"] if s["id"] == identificador)


@pytest.mark.asyncio
async def test_cubre_apartados_con_identidad_procedencia_y_unidades_sin_atribuir_catalogo(api):
    r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "completa"
    assert r["version"]["data_version"] == "119"
    assert r["gen"]["taxon"] == 9606
    assert r["gen"]["ensembl_gene_id"] == ENSG
    assert len(r["secciones"]) == 18
    assert _seccion(r, "rna")["datos"][0]["adj_p_val"] == 0.4
    assert _seccion(r, "proteina_lfq")["estado"] == "sin_datos"
    assert _seccion(r, "comparacion")["datos"]["rna_differential_expression"][0]["study"] == "ROSMAP"
    d = _seccion(r, "farmacos_nominados")
    assert len(d["datos"]["catalogo"]) == 2
    assert [f["chembl_id"] for f in d["datos"]["vinculados"]] == ["CHEMBL1"]
    assert d["recuperados"] == d["esperados"] == 2
    assert all(len(c["sha256"]) == 64 and c["fecha"] and c["url"].startswith(agora.BASE) for c in r["consultas"])
    assert all(s["fuentes"] and s["consultas"] for s in r["secciones"])


@pytest.mark.asyncio
async def test_sesion_reutiliza_farmacos_version_y_fecha_sin_repetir_peticion(api):
    llamadas, _ = api
    with agora.sesion_agora():
        a = await agora.revisar_gen("TREM2")
        b = await agora.revisar_gen("APOE")
    assert [ruta for ruta, p in llamadas].count("/drugs/CHEMBL1") == 1
    assert [ruta for ruta, p in llamadas].count("/comparison-tools/drugs") == 1
    assert _seccion(a, "farmacos_nominados")["consultas"] == _seccion(b, "farmacos_nominados")["consultas"]
    assert _seccion(b, "farmacos_nominados")["datos"]["vinculados"][0]["chembl_id"] == "CHEMBL2"
    await agora.revisar_gen("TREM2")
    assert [ruta for ruta, p in llamadas].count("/drugs/CHEMBL1") == 2


@pytest.mark.asyncio
async def test_busqueda_parcial_no_resuelve_gen_y_alias_ambiguo_no_elige_primero(api):
    llamadas, cambios = api
    assert (await agora.revisar_gen("TREM"))["estado"] == "ambiguo"
    assert len(llamadas) == 1
    cambios["/genes/search/enhanced"] = [
        {"id": ENSG, "match_field": "alias", "match_value": "TREM-2"},
        {"id": OTRO, "match_field": "alias", "match_value": "TREM-2"},
    ]
    assert (await agora.revisar_gen("TREM-2"))["estado"] == "ambiguo"
    cambios["/genes/search/enhanced"].pop()
    assert (await agora.revisar_gen("TREM-2"))["gen"]["ensembl_gene_id"] == ENSG


@pytest.mark.asyncio
@pytest.mark.parametrize("nombre", ["TREM2;rm -rf", "A", "tau protein", "ENSG00000095970.1", "TREM2\nAPOE"])
async def test_identificador_invalido_no_sale_a_la_red(api, nombre):
    llamadas, _ = api
    assert (await agora.revisar_gen(nombre))["estado"] == "ambiguo"
    assert not llamadas


@pytest.mark.asyncio
async def test_vacio_no_es_igual_a_timeout_404_o_formato_roto(api):
    _, cambios = api
    cambios["/genes/search/enhanced"] = []
    assert (await agora.revisar_gen("TREM2"))["estado"] == "no_encontrado"
    for error in [FuenteNoDisponible("tiempo agotado"), NoEncontrado("404"), {"mensaje": "API modificada"}]:
        cambios["/genes/search/enhanced"] = error
        r = await agora.revisar_gen("TREM2")
        assert r["estado"] == "no_disponible"
        assert r["advertencias"]


@pytest.mark.asyncio
async def test_ficha_de_otro_gen_no_se_atribuye_a_identidad_resuelta(api):
    _, cambios = api
    cambios[f"/genes/{ENSG}"] = _ficha(OTRO, "APOE")
    assert (await agora.revisar_gen("TREM2"))["estado"] == "no_disponible"


@pytest.mark.asyncio
async def test_paginacion_completa_y_pagina_faltante_queda_parcial(api):
    _, cambios = api
    cambios[("/comparison-tools/drugs", 0)] = _pagina("nominatedDrugs",
        [{"composite_id": "CHEMBL1~null", "chembl_id": "CHEMBL1"}], total=2, siguiente=True)
    cambios[("/comparison-tools/drugs", 1)] = _pagina("nominatedDrugs",
        [{"composite_id": "CHEMBL2~null", "chembl_id": "CHEMBL2"}], numero=1, total=2)
    r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "completa"
    assert _seccion(r, "farmacos_nominados")["recuperados"] == 2
    cambios[("/comparison-tools/drugs", 1)] = FuenteNoDisponible("503")
    r = await agora.revisar_gen("TREM2")
    d = _seccion(r, "farmacos_nominados")
    assert r["estado"] == d["estado"] == "parcial"
    assert d["recuperados"] == 1 and d["esperados"] == 2
    assert d["datos"]["vinculados"]


@pytest.mark.asyncio
@pytest.mark.parametrize("modo", ["duplicada", "total_cambia", "final_incompleto", "pagina_equivocada", "vacia_con_siguiente"])
async def test_paginacion_inconsistente_no_finge_cobertura(api, modo):
    _, cambios = api
    primera = _pagina("nominatedDrugs", [{"composite_id": "CHEMBL1~null", "chembl_id": "CHEMBL1"}], total=2, siguiente=True)
    segunda = _pagina("nominatedDrugs", [{"composite_id": "CHEMBL2~null", "chembl_id": "CHEMBL2"}], numero=1, total=2)
    if modo == "duplicada":
        segunda["nominatedDrugs"] = primera["nominatedDrugs"]
    elif modo == "total_cambia":
        segunda["page"]["totalElements"] = 3
    elif modo == "final_incompleto":
        primera["page"]["hasNext"] = False
    elif modo == "pagina_equivocada":
        segunda["page"]["number"] = 0
    else:
        primera["nominatedDrugs"] = []
    cambios[("/comparison-tools/drugs", 0)] = primera
    cambios[("/comparison-tools/drugs", 1)] = segunda
    r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "parcial"
    assert _seccion(r, "farmacos_nominados")["limitaciones"]


@pytest.mark.asyncio
async def test_farmaco_sin_ficha_no_se_convierte_en_ausencia(api):
    _, cambios = api
    cambios["/drugs/CHEMBL1"] = FuenteNoDisponible("tiempo agotado")
    r = await agora.revisar_gen("TREM2")
    d = _seccion(r, "farmacos_nominados")
    assert r["estado"] == d["estado"] == "parcial"
    assert d["datos"]["detallesRevisados"] == 1
    assert d["datos"]["detallesEsperados"] == 2
    assert "tiempo agotado" in d["resumen"]


@pytest.mark.asyncio
async def test_limite_http_es_cobertura_parcial_no_resultado_negativo(api):
    with agora.sesion_agora(max_peticiones=4):
        r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "parcial"
    assert "límite" in _seccion(r, "farmacos_nominados")["resumen"]


@pytest.mark.asyncio
async def test_conector_disponible_conserva_nombre_y_respeta_permiso(api, monkeypatch):
    from rosa.conectores import REGISTRO, consultar
    from rosa.conectores.base import PERMISOS
    assert REGISTRO["agora"].estado == "disponible"
    monkeypatch.setitem(PERMISOS, "agora", "bloquear")
    reg, datos = await consultar("agora", gen="TREM2")
    assert datos is None and reg["error"] and not api[0]
    monkeypatch.setitem(PERMISOS, "agora", "permitir")
    reg, datos = await consultar("agora", gen="TREM2")
    assert not reg["error"] and reg["invariante"]["ok"]
    assert datos["gen"]["ensembl_gene_id"] == ENSG


@pytest.mark.asyncio
async def test_cancelacion_no_se_absorbe_como_ausencia(monkeypatch):
    async def cancelar(*a, **kw):
        raise asyncio.CancelledError
    monkeypatch.setattr(agora, "pedir", cancelar)
    with pytest.raises(asyncio.CancelledError):
        await agora.revisar_gen("TREM2")


@pytest.mark.asyncio
async def test_formato_rna_roto_no_publica_comparacion_completa(api):
    _, cambios = api
    ficha = _ficha()
    ficha["rna_differential_expression"] = {"mensaje": "nuevo formato"}
    cambios[f"/genes/{ENSG}"] = ficha
    r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "parcial"
    assert _seccion(r, "rna")["estado"] == "parcial"
    assert _seccion(r, "comparacion")["estado"] == "parcial"


@pytest.mark.asyncio
async def test_mencion_en_nominacion_no_se_convierte_en_diana_farmacologica(api):
    _, cambios = api
    cambios["/drugs/CHEMBL2"] = {"chembl_id": "CHEMBL2", "linked_targets": [{"ensembl_gene_id": OTRO}],
        "drug_nominations": [{"ad_moa": "TREM2", "evidence": "TREM20 no coincide; TREM2 sí."}]}
    d = _seccion(await agora.revisar_gen("TREM2"), "farmacos_nominados")["datos"]
    assert [f["chembl_id"] for f in d["vinculados"]] == ["CHEMBL1"]
    assert d["menciones"][0]["farmaco"]["chembl_id"] == "CHEMBL2"
    assert d["menciones"][0]["coincidencias"][0]["campo"] == "drug_nominations[0].ad_moa"
    assert not agora._menciones_farmaco({"drug_nominations": [{"ad_moa": "TREM20"}]}, "TREM2", ENSG)


@pytest.mark.asyncio
async def test_conector_caido_conserva_auditoria_para_registro_de_cierre(api, monkeypatch):
    from rosa.conectores import consultar
    from rosa.conectores.base import PERMISOS
    monkeypatch.setitem(PERMISOS, "agora", "permitir")
    api[1]["/genes/search/enhanced"] = FuenteNoDisponible("tiempo agotado")
    reg, datos = await consultar("agora", gen="TREM2")
    assert datos["estado"] == "no_disponible"
    assert datos["consultas"][0]["error"] and datos["consultas"][0]["n"] is None
    assert reg["invariante"]["ok"] is False


@pytest.mark.asyncio
async def test_registro_de_otro_gen_dentro_de_ficha_no_pasa_como_comprobado(api):
    _, cambios = api
    ficha = _ficha()
    ficha["rna_differential_expression"][0]["ensembl_gene_id"] = OTRO
    cambios[f"/genes/{ENSG}"] = ficha
    r = await agora.revisar_gen("TREM2")
    assert r["estado"] == "parcial"
    assert _seccion(r, "rna")["estado"] == "parcial"
    assert "otro gen" in _seccion(r, "rna")["resumen"]


@pytest.mark.asyncio
async def test_cancelar_revision_cancela_sus_peticiones_de_farmacos(api, monkeypatch):
    original = agora.pedir
    iniciadas = asyncio.Event()
    activas = set()

    async def demorar(metodo, url, limitador, **kwargs):
        if "/drugs/" in url:
            activas.add(url)
            if len(activas) == 2:
                iniciadas.set()
            try:
                await asyncio.Event().wait()
            finally:
                activas.remove(url)
        return await original(metodo, url, limitador, **kwargs)

    monkeypatch.setattr(agora, "pedir", demorar)
    cliente = agora.ClienteAgora()
    tarea = asyncio.create_task(cliente.revisar_gen("TREM2"))
    await asyncio.wait_for(iniciadas.wait(), 2)
    tarea.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarea
    assert not activas
    assert not cliente._pendientes


@pytest.mark.asyncio
async def test_sin_nominaciones_no_cuenta_el_contenedor_como_diana(api):
    _, cambios = api
    ficha = _ficha()
    ficha.update(target_nominations=None, total_nominations=0)
    cambios[f"/genes/{ENSG}"] = ficha
    cambios["/comparison-tools/targets"] = _pagina("nominatedTargets", [])
    r = await agora.revisar_gen("TREM2")
    d = _seccion(r, "dianas_nominadas")
    assert r["estado"] == "completa"
    assert d["estado"] == "sin_datos"
    assert d["recuperados"] == d["esperados"] == 0


@pytest.mark.asyncio
async def test_analisis_descriptivo_incluye_medicion_contraria_despues_de_fila_doce(api):
    _, cambios = api
    ficha = _ficha()
    fila = ficha["rna_differential_expression"][0]
    ficha["rna_differential_expression"] = [dict(fila, _id=f"rna-{i}", logfc=0.2) for i in range(36)]
    ficha["rna_differential_expression"][-1].update(_id="rna-ultima", study="Estudio final", tissue="Región final", logfc=-3.7, adj_p_val=0.0000001)
    ficha["proteomics_TMT"] = [{"_id": f"tmt-{i}", "ensembl_gene_id": ENSG, "tissue": "TCX", "log2_fc": 0.1, "cor_pval": 0.8} for i in range(20)]
    ficha["proteomics_TMT"][-1].update(_id="tmt-ultima", log2_fc=-4.1, cor_pval=0.0000002)
    cambios[f"/genes/{ENSG}"] = ficha
    r = await agora.revisar_gen("TREM2")
    arn = _seccion(r, "rna")["analisisDescriptivo"]
    proteina = _seccion(r, "proteina_tmt")["analisisDescriptivo"]
    assert arn.count("Fila ") == 36 and proteina.count("Fila ") == 20
    assert '"_id":"rna-ultima"' in arn and '"logfc":-3.7' in arn and '"adj_p_val":1e-07' in arn
    assert '"study":"Estudio final"' in arn and '"signo_logfc":"negativo"' in arn
    assert '"_id":"tmt-ultima"' in proteina and '"cor_pval":2e-07' in proteina
    assert "sin umbral de significación añadido" in arn


@pytest.mark.asyncio
async def test_analisis_descriptivo_conserva_validacion_y_mencion_final_sin_truncar(api):
    _, cambios = api
    ficha = _ficha()
    ficha["experimental_validation"] = [{"_id": f"val-{i}", "ensembl_gene_id": ENSG, "summary_findings": "Hallazgo inicial", "species": "Ratón"} for i in range(15)]
    ficha["experimental_validation"][-1].update(_id="validacion-final", summary_findings="Resultado contrario que exige revisar la hipótesis " + "contexto " * 250,
                                               species="Humano", model_system="Cultivo celular", reference_doi="10.0000/final")
    cambios[f"/genes/{ENSG}"] = ficha
    cambios["/drugs/CHEMBL1"] = {"chembl_id": "CHEMBL1", "linked_targets": [{"ensembl_gene_id": ENSG}],
        "drug_nominations": [{"ad_moa": "TREM2", "evidence": f"Evidencia {i}"} for i in range(14)]}
    cambios["/drugs/CHEMBL1"]["drug_nominations"][-1]["evidence"] = "TREM2: mención final con resultado negativo"
    r = await agora.revisar_gen("TREM2")
    validacion = _seccion(r, "validacion")["analisisDescriptivo"]
    farmacos = _seccion(r, "farmacos_nominados")["analisisDescriptivo"]
    assert validacion.count("Fila ") == 15
    assert ficha["experimental_validation"][-1]["summary_findings"] in validacion
    assert '"reference_doi":"10.0000/final"' in validacion
    assert "mención final con resultado negativo" in farmacos
    assert 'drug_nominations[13].evidence' in farmacos


@pytest.mark.asyncio
async def test_nominacion_de_otro_simbolo_queda_parcial_y_conserva_dato_original(api):
    _, cambios = api
    ficha = _ficha()
    ficha["target_nominations"][0]["hgnc_symbol"] = "APOE"
    cambios[f"/genes/{ENSG}"] = ficha
    r = await agora.revisar_gen("TREM2")
    d = _seccion(r, "dianas_nominadas")
    assert r["estado"] == d["estado"] == "parcial"
    assert "símbolo génico diferente" in d["resumen"]
    assert d["datos"]["nominaciones"][0]["hgnc_symbol"] == "APOE"
