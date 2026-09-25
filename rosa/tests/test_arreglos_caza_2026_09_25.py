"""Arreglos de la caza de fallos del 23 de septiembre de 2026, hechos el 25:
el conector de GWAS Catalog filtra por gen de verdad, y el juez de
verificación ve el pasaje citado aunque caiga más allá del carácter 6.000.
(Detener y el resultado del laboratorio tienen sus propios tests en
test_detener_corta_el_paso.py y test_integracion_corrida.py.) Sin red.
"""

import asyncio
from types import SimpleNamespace

import pytest

from rosa.bucle.pasos import VENTANA_JUEZ, ventana_para_juez
from rosa.conectores import bases
from rosa.fuentes.base import FuenteNoDisponible

# -- GWAS Catalog ----------------------------------------------------------------


def _respuesta(filas, total):
    return SimpleNamespace(json=lambda: {"_embedded": {"associations": filas}, "page": {"totalElements": total}})


def _fila(genes, estudio="GCST1", p=1e-20):
    return {"mapped_genes": genes, "accession_id": estudio, "p_value": p, "reported_trait": ["Alzheimer's disease"]}


def test_gwas_pide_por_mapped_gene_y_cuenta_las_de_alzheimer_de_la_consulta_filtrada(monkeypatch):
    vistas = []

    async def pedir(metodo, url, lim, params=None, **kw):
        vistas.append(params)
        if params.get("efo_id") == bases.ALZHEIMER_MONDO:
            return _respuesta([_fila(["APOE"], "GCST9", 1e-300)], 138)
        return _respuesta([_fila(["APOE"])], 4630)

    monkeypatch.setattr(bases, "pedir", pedir)
    r = asyncio.run(bases.gwas_asociaciones_gen("apoe"))
    # El parámetro que la API v2 respeta, no gene_name, que ignoraba.
    assert all(v["mapped_gene"] == "APOE" and "gene_name" not in v for v in vistas)
    assert r.datos["n_alzheimer"] == 138 and r.datos["total_asociaciones"] == 4630
    assert r.datos["alzheimer"][0]["estudio"] == "GCST9"
    assert r.invariante[0] is True and "138 asociaciones de APOE con Alzheimer" in r.invariante[1]


def test_si_la_api_ignora_el_filtro_se_dice_en_vez_de_contar_un_cero(monkeypatch):
    """El fallo del 23 de septiembre: el catálogo entero volvía como si fuera del
    gen, las 50 primeras eran de cáncer de pulmón y salía 0 para APOE."""

    async def pedir(metodo, url, lim, params=None, **kw):
        return _respuesta([_fila(["HERC2"]), _fila(["UGT1A1"])], 1192604)

    monkeypatch.setattr(bases, "pedir", pedir)
    with pytest.raises(FuenteNoDisponible) as ex:
        asyncio.run(bases.gwas_asociaciones_gen("APOE"))
    assert "ignoró el filtro por gen" in str(ex.value)


def test_un_gen_sin_asociaciones_con_alzheimer_es_un_cero_legitimo(monkeypatch):
    async def pedir(metodo, url, lim, params=None, **kw):
        return _respuesta([], 0) if params.get("efo_id") else _respuesta([_fila(["GFAP"])], 57)

    monkeypatch.setattr(bases, "pedir", pedir)
    r = asyncio.run(bases.gwas_asociaciones_gen("GFAP"))
    assert r.datos["n_alzheimer"] == 0 and r.datos["total_asociaciones"] == 57 and r.invariante[0] is True


# -- El juez de verificación ve el pasaje --------------------------------------------


def test_la_ventana_del_juez_contiene_el_pasaje_aunque_este_mas_alla_del_corte():
    pasaje = "GFAP rose by 164 pg/mL in carriers"
    texto = "Relleno sin nada que ver. " * 400 + pasaje + " (n = 33). " + "Más relleno. " * 400
    assert pasaje not in texto[:VENTANA_JUEZ]  # lo que veía antes
    w = ventana_para_juez(texto, pasaje)
    assert pasaje in w and len(w) <= VENTANA_JUEZ + 200
    assert w.startswith("[... ") and "caracteres anteriores omitidos" in w and "caracteres posteriores omitidos" in w


def test_la_ventana_con_texto_corto_o_pasaje_ausente():
    assert ventana_para_juez("corto", "lo que sea") == "corto"
    assert ventana_para_juez("", "x") == ""
    largo = "a b c " * 3000
    w = ventana_para_juez(largo, "esto no aparece")
    # Sin pasaje localizado, el principio como antes, y el juez sabe que falta.
    assert w.startswith("a b c") and "el pasaje citado no se localizó" in w


def test_la_ventana_al_principio_o_al_final_no_se_sale_del_texto():
    pasaje_ini = "Primera frase con la cifra 0,027"
    texto = pasaje_ini + " " + "relleno " * 2000
    w = ventana_para_juez(texto, pasaje_ini)
    assert w.startswith(pasaje_ini) and "anteriores omitidos" not in w
    pasaje_fin = "La última frase dice 3,1 años"
    texto = "relleno " * 2000 + pasaje_fin
    w = ventana_para_juez(texto, pasaje_fin)
    assert w.endswith(pasaje_fin) and "posteriores omitidos" not in w


def test_la_migracion_devuelve_a_por_comprobar_lo_que_salio_del_gwas_roto():
    from rosa.estado.almacen import _migrar_gwas_sin_filtro

    viejo = "GFAP: sin asociaciones GWAS con Alzheimer entre 1192604 registradas y sin variantes ClinVar"
    e = {"hipotesis": [
        {"id": "a", "novedad": {"genetica": {"estado": "sin_vinculo", "detalle": viejo}}, "perfilDiana": {"capas": [{"capa": "genetica_humana", "estado": "ausente", "direccion": None, "detalle": "GWAS Catalog: 0 asociaciones con Alzheimer entre las 50 vistas de 1192604 registradas del gen"}, {"capa": "expresion_celular", "estado": "presente", "detalle": "HPA"}]}},
        {"id": "b", "novedad": {"genetica": {"estado": "vinculo_conocido", "detalle": "APOE: 138 asociaciones"}}},
        {"id": "c", "novedad": "roto", "perfilDiana": None},
        None,
    ]}
    _migrar_gwas_sin_filtro(e)
    a, b = e["hipotesis"][:2]
    assert a["novedad"]["genetica"]["estado"] == "no_comprobado" and "no filtraba por gen" in a["novedad"]["genetica"]["detalle"]
    assert a["perfilDiana"]["capas"][0]["estado"] == "no_pude_comprobar" and a["perfilDiana"]["capas"][1]["estado"] == "presente"
    assert b["novedad"]["genetica"]["estado"] == "vinculo_conocido"
    antes = repr(e)
    _migrar_gwas_sin_filtro(e)
    assert repr(e) == antes
