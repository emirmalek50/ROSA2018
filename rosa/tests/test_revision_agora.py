"""Revisión final de Agora con respuestas sintéticas y SQLite temporal, sin red."""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace

import pytest

from rosa import revision_agora as R
from rosa.bucle.pasos import CorridaParada, Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen


GENES = ["APOE", "APP", "MAPT", "TREM2", "GFAP", "ABCA7", "BIN1", "CLU", "SORL1"]


def _respuesta(gen, *, estado="completa", filas=1):
    """Contrato del conector, con identificadores y resultados solo de prueba."""
    ensembl = f"ENSG{GENES.index(gen) + 1:011d}" if gen in GENES else "ENSG99999999999"
    registro = {"id": P.nuevo_id("con"), "herramienta": "agora", "fuente": "agora", "fecha": 1234,
                "argumentos": {"gen": gen}, "resumen": "Respuesta sintética de prueba", "n": 1, "ids": [ensembl], "error": None}
    consulta = {"url": "https://api.agora.adknowledgeportal.org/genes/" + ensembl, "estado": 200, "error": None}
    dato = {"estado": estado, "gen": {"hgnc_symbol": gen, "ensembl_gene_id": ensembl,
            "url": "https://agora.adknowledgeportal.org/genes/" + ensembl}, "fecha": 1234,
            "version": {"data_version": "prueba"}, "consultas": [consulta], "advertencias": [],
            "secciones": [{"id": "rna", "nombre": "Expresión diferencial de ARN", "estado": "comprobado",
                "resumen": "Filas sintéticas de prueba", "datos": [{"fila": i, "valor": i / 100} for i in range(filas)],
                "fuentes": [{"url": consulta["url"]}], "consultas": [consulta], "recuperados": filas, "esperados": filas,
                "limitaciones": ["Datos sintéticos, sin inferencia científica."]},
                {"id": "dianas_nominadas", "nombre": "Nominated Targets", "estado": "comprobado",
                 "datos": {"dianas": [{"ensembl_gene_id": ensembl}], "nominaciones": []}, "consultas": [consulta],
                 "resumen": "Nominación sintética de prueba", "limitaciones": []}]}
    if estado == "no_disponible":
        dato.update(gen=None, secciones=[], advertencias=["No pude comprobar Agora: tiempo agotado."])
        registro.update(n=0, ids=[])
    return registro, dato


@pytest.fixture
def arnes(tmp_path, monkeypatch):
    ruta = tmp_path / "agora.db"
    al = Almacen(ruta)
    ids = {}

    def preparar(e):
        inv = A.crear_investigacion(e, {"titulo": "Revisión sintética", "objetivo": "APOE", "condicionParada": "1 iteración"}, 1000)
        c = P.nueva_corrida(inv, 1, 1000)
        c["estado"] = "en_marcha"
        it = P.nueva_iteracion(c["id"], 1, 1000, [])
        h = P.nueva_hipotesis(inv, 1, 1000, titulo="APOE", enunciado="APOE")
        e["corridas"].append(c)
        e["iteraciones"].append(it)
        e["hipotesis"].append(h)
        ids.update(inv=inv, cor=c["id"], it=it["id"], hip=h["id"])
        return True

    al.mutar(preparar, "preparar")
    ctx = Ctx(al, SimpleNamespace(), SimpleNamespace(), ids["cor"], ids["inv"], ids["it"], 1, de_paso=True)
    llamadas = []
    respuestas = {}

    async def consultar(herramienta, /, **kw):
        assert herramienta == "agora"
        gen = kw["gen"]
        llamadas.append(gen)
        respuesta = respuestas.get(gen)
        if callable(respuesta):
            return await respuesta()
        return copy.deepcopy(respuesta) if respuesta is not None else _respuesta(gen)

    async def prohibido(*args, **kwargs):
        raise AssertionError("La revisión de Agora no debe llamar a un modelo")

    monkeypatch.setattr(R.CON, "consultar", consultar)
    monkeypatch.setattr(Ctx, "llamar", prohibido)
    try:
        yield SimpleNamespace(al=al, ids=ids, ctx=ctx, llamadas=llamadas, respuestas=respuestas, ruta=ruta)
    finally:
        al.cerrar()


def _h(a):
    return next(h for h in a.al.estado["hipotesis"] if h["id"] == a.ids["hip"])


def _editar(a, **campos):
    def editar(e):
        next(h for h in e["hipotesis"] if h["id"] == a.ids["hip"]).update(campos)
        return True
    a.al.mutar(editar, "editar")


def _anadir(a, gen, *, estado=None, inv=None):
    h = P.nueva_hipotesis(inv or a.ids["inv"], 1, 2000, titulo=gen, enunciado=gen)
    if estado:
        h["estado"] = estado
    a.ctx.mutar(lambda e: e["hipotesis"].append(h) or True, "anadir")
    return h["id"]


def test_inventario_supera_seis_genes_y_cubre_todas_las_hipotesis_vivas(arnes):
    a = arnes
    _editar(a, titulo=" ".join(GENES[:8]), enunciado=" ".join(GENES[:8]))
    _anadir(a, "SORL1")
    _anadir(a, "CD33", estado="descartada")
    _anadir(a, "PSEN1", inv="otra_investigacion")
    reporte = asyncio.run(R.revisar_cierre(a.ctx))
    assert set(a.llamadas) == set(GENES)
    assert len(a.llamadas) == len(GENES)
    assert len(reporte["hipotesis"]) == 2
    assert R.revision_vigente(a.al.estado, a.ctx.corrida())


def test_genes_canonicos_solo_del_contexto_versionado_actual():
    h = {"version": 2, "titulo": "", "entidades": [{"tipo": "proteina", "simbolo": "TREM2"}],
         "perfilDiana": {"version": 1, "identificadores": {"simbolo": "MAPT"}},
         "contextoBases": {"version": 2, "identificadores": {"ensembl": "ENSG00000130203"}}}
    assert R.genes_de(h) == ["ENSG00000130203", "TREM2"]
    h.update(version=None, entidades=[], contextoBases={"version": None, "identificadores": {"simbolo": "APP"}})
    assert R.genes_de(h) == []


def test_persiste_revision_consultas_y_artefacto_sin_evidencia_ni_llm(arnes):
    a = arnes
    antes = copy.deepcopy({k: a.al.estado[k] for k in ("hechos", "relaciones")})
    afirmaciones = copy.deepcopy(_h(a)["afirmaciones"])
    certeza = _h(a).get("conclusion")
    reporte = asyncio.run(R.revisar_cierre(a.ctx, motivo="1 iteración"))
    h = _h(a)
    assert h["revisionAgora"]["estado"] == "completa"
    assert h["afirmaciones"] == afirmaciones and h.get("conclusion") == certeza
    assert {k: a.al.estado[k] for k in antes} == antes
    assert len(h["consultas"]) == 1
    artefacto = next(x for x in a.al.estado["artefactos"] if x["id"] == reporte["artefactoId"])
    assert artefacto["versiones"][-1]["procedencia"]["registroEjecucion"] == h["consultas"]
    pista = a.ctx.iteracion()["pistas"][-1]
    assert pista["tipo"] == "grafo" and pista["estado"] == "hecha"
    reabierto = Almacen(a.ruta)
    try:
        c = A.corrida_de(reabierto.estado, a.ids["cor"])
        assert R.revision_vigente(reabierto.estado, c)
        assert c["_revisionAgoraDatos"]["APOE"]["resultado"]["consultas"]
    finally:
        reabierto.cerrar()


def test_exporta_filas_y_auditoria_completas_con_vista_recortada(arnes):
    a = arnes
    a.respuestas["APOE"] = _respuesta("APOE", filas=37)
    asyncio.run(R.revisar_cierre(a.ctx))
    h = _h(a)
    seccion = h["revisionAgora"]["genes"][0]["secciones"][0]
    assert len(seccion["datos"]["vistaPrevia"]) == 12
    assert seccion["datos"]["recuperados"] == 37
    datos = R.datos_exportacion(a.al.estado, h)
    assert datos["vigente"]
    bruto = datos["genes"]["APOE"]
    assert len(bruto["resultado"]["secciones"][0]["datos"]) == 37
    assert bruto["resultado"]["consultas"] and bruto["registro"]["id"]
    texto = R.texto_revision(h)
    assert "Vista parcial" in texto and "agora.json" in texto
    assert "no demuestran causalidad, eficacia ni utilidad clínica" in texto


def test_fallo_no_es_ausencia_ni_revision_completa_y_deja_incidencia(arnes):
    a = arnes
    a.respuestas["APOE"] = _respuesta("APOE", estado="no_disponible")
    reporte = asyncio.run(R.revisar_cierre(a.ctx))
    assert reporte["estado"] == "no_comprobado"
    assert R.revision_vigente(a.al.estado, a.ctx.corrida())
    h = _h(a)
    assert h["novedad"]["agora"]["estado"] == "no_comprobado"
    assert h["consultas"][0]["n"] is None
    assert "tiempo agotado" in h["consultas"][0]["error"]
    assert "tiempo agotado" in R.texto_revision(h)
    assert a.al.estado["incidencias"][-1]["recurso"] == "agora"
    assert R.datos_exportacion(a.al.estado, h)["genes"]["APOE"]["resultado"]["consultas"]
    asyncio.run(R.revisar_cierre(a.ctx))
    assert a.llamadas == ["APOE"]
    assert len(a.al.estado["incidencias"]) == 1


@pytest.mark.parametrize("estado", ["ambiguo", "no_encontrado"])
def test_identidad_no_resuelta_no_se_interpreta_como_ausencia(arnes, estado):
    a = arnes
    reg, dato = _respuesta("APOE", estado="no_disponible")
    dato.update(estado=estado, advertencias=["No pude resolver una identidad exacta y única."])
    a.respuestas["APOE"] = reg, dato
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "no_comprobado"
    assert _h(a)["revisionAgora"]["genes"][0]["estadoResolucion"] == estado
    assert _h(a)["novedad"]["agora"]["estado"] == "no_comprobado"


def test_fallo_parcial_conserva_resultado_y_no_declara_exhaustividad(arnes):
    a = arnes
    _anadir(a, "TREM2")
    a.respuestas["TREM2"] = _respuesta("TREM2", estado="no_disponible")
    reporte = asyncio.run(R.revisar_cierre(a.ctx))
    assert reporte["estado"] == "parcial"
    assert R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert _h(a)["revisionAgora"]["estado"] == "completa"
    assert len(a.ctx.corrida()["_revisionAgoraDatos"]) == 2


def test_sin_gen_no_aplica_y_no_consulta(arnes):
    a = arnes
    _editar(a, titulo="Ejercicio físico", enunciado="Actividad física cotidiana", tarjeta={}, entidades=[])
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "no_aplica"
    assert not a.llamadas
    assert _h(a)["novedad"]["agora"]["estado"] == "no_aplica"
    assert R.revision_vigente(a.al.estado, a.ctx.corrida())


def test_cache_completa_no_repite_genes_y_un_nuevo_alcance_reintenta_fallos(arnes):
    a = arnes
    _anadir(a, "TREM2")
    a.respuestas["TREM2"] = _respuesta("TREM2", estado="no_disponible")
    asyncio.run(R.revisar_cierre(a.ctx))
    a.respuestas["TREM2"] = _respuesta("TREM2")
    _anadir(a, "APOE")
    assert not R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "completa"
    assert a.llamadas.count("APOE") == 1 and a.llamadas.count("TREM2") == 2
    assert len(_h(a)["consultas"]) == 1


def test_revisar_otra_corrida_no_reutiliza_cache_de_la_anterior(arnes):
    a = arnes
    asyncio.run(R.revisar_cierre(a.ctx))
    c = P.nueva_corrida(a.ids["inv"], 2, 2000)
    c["estado"] = "en_marcha"
    a.ctx.mutar(lambda e: e["corridas"].append(c) or True, "nueva_corrida")
    assert not R.revision_vigente(a.al.estado, c)
    a.ctx.corrida_id = c["id"]
    asyncio.run(R.revisar_cierre(a.ctx))
    assert a.llamadas == ["APOE", "APOE"]
    assert _h(a)["revisionAgora"]["corridaId"] == c["id"]


def test_cambio_de_version_durante_consulta_deja_alcance_pendiente(arnes):
    a = arnes

    async def cambiar():
        _editar(a, version=2, titulo="TREM2", enunciado="TREM2")
        return _respuesta("APOE")

    a.respuestas["APOE"] = cambiar
    reporte = asyncio.run(R.revisar_cierre(a.ctx))
    assert reporte["estado"] == "en_curso"
    assert not R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert not R.vigente_para_hipotesis(_h(a))
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "completa"
    assert a.llamadas == ["APOE", "TREM2"]
    assert _h(a)["revisionAgora"]["versionHipotesis"] == 2


def test_revision_anterior_se_marca_historica_al_editar_hipotesis(arnes):
    a = arnes
    asyncio.run(R.revisar_cierre(a.ctx))
    _editar(a, enunciado="APOE y TREM2")
    assert not R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert "Revisión histórica" in R.texto_revision(_h(a))
    assert not R.datos_exportacion(a.al.estado, _h(a))["vigente"]


@pytest.mark.parametrize("estado", ["detenida", "pausada", "pausada_por_presupuesto"])
def test_detencion_durante_await_impide_guardar_como_revisado(arnes, estado):
    a = arnes

    async def escenario():
        entrada, salida = asyncio.Event(), asyncio.Event()

        async def consultar():
            entrada.set()
            await salida.wait()
            return _respuesta("APOE")

        a.respuestas["APOE"] = consultar
        tarea = asyncio.create_task(R.revisar_cierre(a.ctx))
        await entrada.wait()
        a.ctx.mutar(lambda e: A.corrida_de(e, a.ids["cor"]).__setitem__("estado", estado) or True, "parar")
        salida.set()
        with pytest.raises(CorridaParada):
            await tarea

    asyncio.run(escenario())
    assert a.ctx.corrida()["estado"] == estado
    assert not R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert not a.ctx.corrida().get("_revisionAgoraDatos")
    assert not R.vigente_para_hipotesis(_h(a))
    assert a.ctx.iteracion()["pistas"][-1]["estado"] == "detenida"


def test_cancelacion_se_propaga_y_reanudar_conserva_solo_exitos_previos(arnes):
    a = arnes
    _anadir(a, "TREM2")

    async def escenario():
        entrada = asyncio.Event()

        async def esperar():
            entrada.set()
            await asyncio.Event().wait()

        a.respuestas["TREM2"] = esperar
        tarea = asyncio.create_task(R.revisar_cierre(a.ctx))
        await entrada.wait()
        tarea.cancel()
        with pytest.raises(asyncio.CancelledError):
            await tarea

    asyncio.run(escenario())
    assert not R.revision_vigente(a.al.estado, a.ctx.corrida())
    assert set(a.ctx.corrida()["_revisionAgoraDatos"]) == {"APOE"}
    assert not R.vigente_para_hipotesis(_h(a))
    a.respuestas["TREM2"] = _respuesta("TREM2")
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "completa"
    assert a.llamadas.count("APOE") == 1 and a.llamadas.count("TREM2") == 2


def test_respuesta_invalida_no_puede_declararse_completa(arnes):
    a = arnes
    reg, dato = _respuesta("APOE")
    dato["gen"] = None
    a.respuestas["APOE"] = reg, dato
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "no_comprobado"
    assert _h(a)["novedad"]["agora"]["estado"] == "no_comprobado"


@pytest.mark.parametrize("datos", [
    {"dianas": "error de API", "nominaciones": "no disponible"},
    {"dianas": [], "nominaciones": [{}]},
    {"dianas": [{"ensembl_gene_id": "ENSG00000000099"}], "nominaciones": []},
    {"dianas": [], "nominaciones": [{"hgnc_symbol": "OTRO", "team": "Equipo"}]},
    {"dianas": [], "nominaciones": [{"ensembl_gene_id": "ENSG00000000099", "team": "Equipo"}]},
])
def test_nominacion_malformada_no_se_promueve_a_positiva(arnes, datos):
    a = arnes
    reg, dato = _respuesta("APOE", estado="parcial")
    dato["secciones"][1].update(datos=datos, estado="no_comprobado")
    a.respuestas["APOE"] = reg, dato
    asyncio.run(R.revisar_cierre(a.ctx))
    assert _h(a)["novedad"]["agora"]["estado"] == "no_comprobado"


def test_nominacion_exacta_se_conserva_aunque_otro_apartado_falle(arnes):
    a = arnes
    a.respuestas["APOE"] = _respuesta("APOE", estado="parcial")
    assert asyncio.run(R.revisar_cierre(a.ctx))["estado"] == "parcial"
    assert _h(a)["novedad"]["agora"]["estado"] == "nominada"


def test_analisis_descriptivo_completo_no_se_recorta_en_contexto(arnes):
    a = arnes
    reg, dato = _respuesta("APOE", filas=37)
    analisis = {"filasRevisadas": 37, "grupos": [{"region": "región " + str(i), "asociaciones": i} for i in range(60)]}
    dato["secciones"][0]["analisisDescriptivo"] = analisis
    a.respuestas["APOE"] = reg, dato
    asyncio.run(R.revisar_cierre(a.ctx))
    seccion = _h(a)["revisionAgora"]["genes"][0]["secciones"][0]
    assert seccion["datos"]["analisisDescriptivo"] == analisis
    texto = R.texto_revision(_h(a))
    assert "Análisis descriptivo de todas las filas recuperadas" in texto
    assert '"region": "región 59"' in texto


def test_comparacion_cuenta_arn_y_proteina_por_separado(arnes):
    a = arnes
    reg, dato = _respuesta("APOE", filas=36)
    dato["secciones"].append({"id": "comparacion", "nombre": "Comparación conjunta", "estado": "comprobado", "recuperados": 36,
        "datos": {"rna_differential_expression": [{"fila": i} for i in range(36)], "proteomics_LFQ": [], "proteomics_SRM": [], "proteomics_TMT": []},
        "analisisDescriptivo": "36 filas de ARN y 0 de proteína."})
    a.respuestas["APOE"] = reg, dato
    asyncio.run(R.revisar_cierre(a.ctx))
    secciones = {s["id"]: s for s in _h(a)["revisionAgora"]["genes"][0]["secciones"]}
    assert secciones["comparison_rna"]["datos"]["recuperados"] == 36
    proteina = secciones["comparison_proteina"]
    assert proteina["datos"]["recuperados"] == 0 and proteina["estado"] == "sin_datos"
    assert "0 mediciones de proteína" in proteina["resumen"]
    assert proteina["datos"]["analisisDescriptivo"] is None
    assert "Análisis conjunto" in secciones["comparison_rna"]["datos"]["analisisDescriptivo"]
