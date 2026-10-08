"""Tanda 2 de la revisión del 17 de septiembre de 2026, constructor "literatura":
S-07 (las primarias de los ensayos nombrados ya no se excluyen para siempre y la
red de seguridad por nombre funciona) y S-06, cortes c a g (las fuentes se
recuerdan entre corridas, `extraido` va por fragmento, caché en disco del texto
completo, una sola función de claves). Sin red ni modelos: bases y programas
simulados; la caché en disco escribe en un directorio temporal."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from rosa import config
from rosa import politicas
from rosa.bucle import contexto as T
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.fuentes import base as FB
from rosa.fuentes import europepmc, exa
from rosa.fuentes.base import FuenteNoDisponible

OBJETIVO = "Comparar los ensayos en los que la diana se movió y la clínica no (semaglutida en evoke/evoke+) con los que movieron ambas (lecanemab en CLARITY AD), con GFAP y NfL en Alzheimer"


# ---------------------------------------------------------------------------
# Arnés
# ---------------------------------------------------------------------------


def _almacen(con_previa: bool = True, excluidos_previos: list | None = None, fuentes_previas: dict | None = None, objetivo: str = OBJETIVO, afirmaciones_previas: list | None = None):
    """Un almacén con una investigación, una corrida anterior (número 1, terminada,
    con sus excluidos, sus `_fuentes` y sus `_afirmaciones` privadas) y la corrida
    en curso (número 2)."""
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        e["investigaciones"].append({"id": "inv", "titulo": "t", "objetivo": objetivo, "limites": [], "condicionParada": "x", "configuracion": {"preferencias": "", "atributos": [], "restricciones": [], "amplitud": "enfocada"}, "vivero": []})
        if con_previa:
            c1 = P.nueva_corrida("inv", 1, 500)
            c1["id"] = "cor1"
            c1["estado"] = "terminada"
            c1["busqueda"]["excluidos"] = list(excluidos_previos or [])
            if fuentes_previas:
                c1["_fuentes"] = fuentes_previas
            if afirmaciones_previas is not None:
                c1["_afirmaciones"] = list(afirmaciones_previas)
            e["corridas"].append(c1)
        c = P.nueva_corrida("inv", 2, 1000)
        c["id"] = "cor"
        c["estado"] = "en_marcha"
        e["corridas"].append(c)
        it = P.nueva_iteracion("cor", 1, 1000, [P.nuevo_paso("Buscar", "", 20)], 40)
        it["id"] = "it"
        e["iteraciones"].append(it)
        return True

    al.mutar(fn, "test")
    return al


def _ctx(al, programas=None):
    programas = programas or SimpleNamespace(relevancia="relevancia", relevancia_amplitud="relevancia_amplitud", extraer="extraer", consultas="consultas", explorar="explorar")
    return Ctx(al, programas, SimpleNamespace(cerebro=SimpleNamespace(model="sim"), juez=SimpleNamespace(model="sim"), volumen=SimpleNamespace(model="sim")), "cor", "inv", "it", 1)


def _pista_textos(ctx) -> str:
    textos = []
    for p in ctx.iteracion()["pistas"]:
        textos.append(p.get("titulo", ""))
        textos.extend(str(l.get("texto") or "") for l in (p.get("transcripcion") or []))
        textos.append(p.get("resumen") or "")
    return "\n".join(textos)


def _articulo(referencia, titulo, doi, resumen="r"):
    return {"referencia": referencia, "titulo": titulo, "resumen": resumen, "doi": doi, "pmid": None, "anio": 2026, "tipos": [], "autores": []}


async def _fragmentos_falsos(ctx, datos, pista, con_texto):
    return [{"localizador": "resumen", "texto": datos.get("resumen", "") or "resumen", "encabezado": ""}]


# ---------------------------------------------------------------------------
# S-07 (2): la red de seguridad por nombre compara por palabra completa y por consulta simple
# ---------------------------------------------------------------------------


def test_es_consulta_simple_admite_sus_formas_y_rechaza_las_compuestas():
    for q in ("lecanemab", '"lecanemab"', 'TITLE_ABS:"lecanemab"', "lecanemab[tiab]", '"lecanemab"[Title/Abstract]', '("lecanemab")', "  Lecanemab "):
        assert PASOS.es_consulta_simple(q, "lecanemab"), q
    for q in ('"lecanemab"[tiab] AND ("tau PET")', "lecanemab AND Clarity AD", "lecanemabs", "lecanemab OR donanemab", ""):
        assert not PASOS.es_consulta_simple(q, "lecanemab"), q
    # El "+" final no distingue: Europe PMC lo ignora y TITLE_ABS lo traduce.
    assert PASOS.es_consulta_simple('"evoke+"', "evoke+") and PASOS.es_consulta_simple('TITLE_ABS:"evoke"', "evoke+") and PASOS.es_consulta_simple('"evoke"', "evoke+")
    assert not PASOS.es_consulta_simple("semaglutide AND evoke", "evoke")
    assert not PASOS.es_consulta_simple("x", "")


def test_consultas_por_nombre_no_da_por_buscado_un_nombre_dentro_de_una_consulta_estrecha():
    nombres = ["lecanemab", "evoke", "AL002"]
    plan = [{"consulta": '"lecanemab"[tiab] AND ("tau PET" OR "tau-PET") AND (mediat* OR predict*)'}, {"consulta": "semaglutide AND evoke"}]
    # Regla anterior (sin registro): una consulta simple previa cuenta como buscado.
    salida = PASOS.consultas_por_nombre(nombres, plan, ['"AL002"'])
    assert [q["consulta"] for q in salida] == ['"lecanemab"', '"evoke"'], salida
    assert all(q["base"] == "europepmc" and q["_por_nombre"] for q in salida)
    # Con el registro: solo cuenta una consulta simple con al menos un relevante.
    registro = [
        {"consulta": '"lecanemab"', "resultados": 2901, "relevantes": 0},  # simple pero sin relevantes: se repite
        {"consulta": '"evoke"', "resultados": 40, "relevantes": 1},  # simple con relevante: buscado
        {"consulta": '"AL002"', "resultados": 0, "relevantes": None},  # una vez sin nada: se insiste una vez más
        {"consulta": '"evoke"', "resultados": "raro", "relevantes": "no es un número"},  # un registro roto no tumba la regla
    ]
    salida = PASOS.consultas_por_nombre(nombres, [], [], registro=registro)
    assert [q["consulta"] for q in salida] == ['"lecanemab"', '"AL002"'], salida
    # Dos veces con cero resultados en la base: el nombre no está allí, no se insiste.
    registro.append({"consulta": 'TITLE_ABS:"AL002"', "resultados": 0, "relevantes": None})
    salida = PASOS.consultas_por_nombre(nombres, [], [], registro=registro)
    assert [q["consulta"] for q in salida] == ['"lecanemab"']
    # Una consulta simple en el plan de este paso cuenta como que se va a buscar.
    assert PASOS.consultas_por_nombre(["lecanemab"], [{"consulta": 'TITLE_ABS:"lecanemab"'}], [], registro=[]) == []
    # Registros rotos no tumban nada; el tope se respeta.
    assert len(PASOS.consultas_por_nombre(["a", "b", "c", "d", "e"], [], [], maximo=2, registro=[None, "raro", {"consulta": None}])) == 2  # type: ignore[list-item]
    assert PASOS.consultas_por_nombre(["", "  "], [], [], registro=[]) == []


def test_el_test_anterior_de_la_red_por_nombre_sigue_valiendo():
    """Las primeras cuatro consultas que esperaba test_revision_recuentos no cambian."""
    nombres = T.nombres_propios("Comparar los ensayos recientes en los que la diana se movió y la clínica no (semaglutida en evoke/evoke+, posdinemab, AL002 en INVOKE-2) con aquellos en los que ambos se movieron (lecanemab en Clarity AD, donanemab en TRAILBLAZER-ALZ 2), con GFAP y NfL como biomarcadores en Alzheimer.")
    plan = [{"consulta": "lecanemab AND Clarity AD"}, {"consulta": "semaglutide AND evoke"}]
    assert [q["consulta"] for q in PASOS.consultas_por_nombre(nombres, plan, ['"posdinemab"'])] == ['"AL002"', '"INVOKE-2"', '"TRAILBLAZER-ALZ 2"', '"evoke+"']


# ---------------------------------------------------------------------------
# S-07 (3, 4): cláusulas AND, relajación y tope
# ---------------------------------------------------------------------------


def test_clausulas_and_respeta_parentesis_y_comillas():
    q = '"lecanemab"[tiab] AND ("tau PET" OR "tau-PET" AND x) AND (mediat* OR predict*) AND "a AND b" AND alzheimer'
    partes = PASOS.clausulas_and(q)
    assert partes == ['"lecanemab"[tiab]', '("tau PET" OR "tau-PET" AND x)', "(mediat* OR predict*)", '"a AND b"', "alzheimer"], partes
    assert PASOS.clausulas_and("gfap and nfl") == ["gfap", "nfl"]  # AND en minúsculas también separa
    assert PASOS.clausulas_and("") == [] and PASOS.clausulas_and("solo") == ["solo"]
    assert PASOS.quitar_ultima_clausula(q) == '"lecanemab"[tiab] AND ("tau PET" OR "tau-PET" AND x) AND (mediat* OR predict*) AND "a AND b"'
    assert PASOS.quitar_ultima_clausula("solo") is None and PASOS.quitar_ultima_clausula("") is None
    assert PASOS.limitar_clausulas(q) == '"lecanemab"[tiab] AND ("tau PET" OR "tau-PET" AND x) AND (mediat* OR predict*)'
    assert PASOS.limitar_clausulas("a AND b") == "a AND b" and politicas.MAX_CLAUSULAS_AND == 3
    # Una consulta con FIRST_PDATE no tiene AND dentro de los corchetes que la parta mal.
    assert len(PASOS.clausulas_and("(Alzheimer*) AND (gfap) AND FIRST_PDATE:[2026-03-14 TO 2026-09-10]")) == 3


def test_la_firma_de_consultas_pide_el_tope_de_tres_clausulas():
    from rosa.modulos import firmas as F

    doc = F.GenerarConsultas.__doc__ or ""
    assert "tres cláusulas" in doc and "AND" in doc
    assert "\u2014" not in doc


# ---------------------------------------------------------------------------
# S-07 (5): Europe PMC y el "+" de un nombre
# ---------------------------------------------------------------------------


def test_europepmc_traduce_el_nombre_con_mas_a_title_abs():
    t = europepmc.traducir_consulta
    assert t('"evoke+"') == 'TITLE_ABS:"evoke"'
    assert t("semaglutide AND evoke+") == 'semaglutide AND TITLE_ABS:"evoke"'
    assert t('(semaglutide) AND ("evoke+" OR "evoke")') == '(semaglutide) AND (TITLE_ABS:"evoke" OR "evoke")'
    assert t('TITLE_ABS:"evoke+"') == 'TITLE_ABS:"evoke"'
    # Lo que no lleva "+" no se toca; una expresión con "+" que no es un nombre tampoco.
    for q in ('"lecanemab"', "gfap AND nfl", "APOE ε4+ carriers OR x", "C++ AND alzheimer", "Alzheimer* AND GFAP"):
        assert t(q) == q, q
    assert t("") == ""


def test_europepmc_buscar_envia_la_consulta_traducida(monkeypatch):
    vistas = []

    async def pedir_falso(metodo, url, limitador, **kwargs):
        vistas.append(kwargs["params"]["query"])
        return httpx.Response(200, json={"hitCount": 0, "resultList": {"result": []}}, request=httpx.Request(metodo, url))

    monkeypatch.setattr(europepmc, "pedir", pedir_falso)
    arts, total = asyncio.run(europepmc.buscar('"evoke+"', maximo=5))
    assert arts == [] and total == 0 and vistas == ['TITLE_ABS:"evoke"']


# ---------------------------------------------------------------------------
# S-07 (1) y S-06 (g): la caché de exclusiones
# ---------------------------------------------------------------------------


def test_excluidos_previos_no_reutiliza_cortes_del_reranker_ni_otro_criterio_y_casa_por_titulo():
    criterio = PASOS.hash_criterio("Objetivo: GFAP y NfL")
    otro = PASOS.hash_criterio("Objetivo: otra cosa")
    excluidos = [
        # Corte del reranker (registro antiguo, sin campo): ningún modelo lo miró.
        {"referencia": "Cummings, 2026", "titulo": "Semaglutide in early Alzheimer's disease: evoke and evoke+", "doi": "10.1016/s0140-6736(26)00459-9", "relevancia": 3, "modo": "foco", "motivo": "fuera del corte del reranker (pertinencia 0.33); no se gastó una llamada al modelo", "iteracion": 1},
        # Marcado explícitamente como no puntuado por modelo.
        {"referencia": "Van Dyck, 2023", "titulo": "Lecanemab in early Alzheimer's disease", "doi": "10.1056/nejmoa2212948", "relevancia": 1, "modo": "foco", "motivo": "otra cosa", "iteracion": 1, "puntuadoPorModelo": False},
        # Puntuado por un modelo con OTRO criterio.
        {"referencia": "Sims, 2023", "titulo": "Donanemab in early symptomatic Alzheimer disease: TRAILBLAZER-ALZ 2", "doi": "10.1001/jama.2023.13239", "relevancia": 1, "modo": "foco", "motivo": "sin relación con GFAP en ADAD", "iteracion": 1, "puntuadoPorModelo": True, "criterio": otro},
        # Puntuado por un modelo con ESTE criterio: sí se reutiliza.
        {"referencia": "Lejano, 2026", "titulo": "Zebrafish tau model of neurodegeneration", "doi": "10.1/zebra", "relevancia": 1, "modo": "foco", "motivo": "otra especie", "iteracion": 1, "puntuadoPorModelo": True, "criterio": criterio},
        # Registro antiguo sin campos, puntuado por un modelo (motivo propio): se reutiliza.
        {"referencia": "Antiguo, 2025", "titulo": "Drosophila model of amyloid toxicity in the eye", "doi": None, "pmid": None, "relevancia": 0, "modo": "foco", "motivo": "otra especie y otro tejido", "iteracion": 2},
        # Rozando el listón: se vuelve a mirar.
        {"referencia": "Rozando, 2026", "titulo": "Rozando el listón de relevancia", "doi": "10.1/roza", "relevancia": 4, "modo": "foco", "motivo": "casi", "iteracion": 1, "puntuadoPorModelo": True, "criterio": criterio},
        # Otro modo: no cuenta en foco.
        {"referencia": "Amplio, 2026", "titulo": "Retinal vascular changes track amyloid burden", "doi": "10.1/retina", "relevancia": 1, "modo": "amplitud", "motivo": "x", "iteracion": 1, "puntuadoPorModelo": True, "criterio": criterio},
        "roto",
    ]
    al = _almacen(excluidos_previos=excluidos)
    try:
        ctx = _ctx(al)
        cache = PASOS._excluidos_previos(ctx, "foco", politicas.RELEVANCIA_MINIMA - 2, criterio)
        referencias = {v["referencia"] for v in cache.values()}
        assert referencias == {"Lejano, 2026", "Antiguo, 2025"}, referencias
        # Indexado por todas las claves: el DOI y el título normalizado (antes "título:" con tilde nunca casaba).
        assert "doi:10.1/zebra" in cache and "titulo:zebrafish tau model of neurodegeneration" in cache
        assert "titulo:drosophila model of amyloid toxicity in the eye" in cache
        # El de otro criterio sí vale cuando se pregunta con su criterio.
        con_otro = PASOS._excluidos_previos(ctx, "foco", politicas.RELEVANCIA_MINIMA - 2, otro)
        assert "doi:10.1001/jama.2023.13239" in con_otro and "doi:10.1/zebra" not in con_otro
        # Sin criterio (llamada antigua) valen todos los puntuados por modelo.
        sin = PASOS._excluidos_previos(ctx, "foco", politicas.RELEVANCIA_MINIMA - 2)
        assert {v["referencia"] for v in sin.values()} == {"Lejano, 2026", "Antiguo, 2025", "Sims, 2023"}
    finally:
        al.cerrar()
    assert PASOS.exclusion_puntuada_por_modelo({"motivo": "ya excluido en la corrida 5: x"}) is False
    assert PASOS.exclusion_puntuada_por_modelo({"motivo": "sin puntuar (el modelo no respondió)"}) is False
    assert PASOS.exclusion_puntuada_por_modelo({"motivo": "Otra especie", "puntuadoPorModelo": True}) is True
    assert PASOS.exclusion_puntuada_por_modelo({}) is True
    assert PASOS.hash_criterio("Objetivo: GFAP") == PASOS.hash_criterio("objetivo:  gfap") and PASOS.hash_criterio("") != PASOS.hash_criterio("a")


def test_claves_de_articulo_y_clave_principal_son_las_de_claves_de_fuente():
    a = {"doi": "https://doi.org/10.1/X.", "pmid": "12", "titulo": "Semaglutide in early Alzheimer's disease: the evoke trials"}
    assert PASOS._claves_articulo(a) == PASOS.claves_de_fuente(a) == {"doi:10.1/x", "pmid:12", "titulo:semaglutide in early alzheimer s disease the evoke trials"}
    assert PASOS._clave_articulo(a) == "doi:10.1/x"
    solo_titulo = {"titulo": "Un título de veinte letras o más"}
    assert PASOS._clave_articulo(solo_titulo) == next(iter(PASOS.claves_de_fuente(solo_titulo))) and PASOS._clave_articulo(solo_titulo).startswith("titulo:")
    assert PASOS._clave_articulo({"titulo": "corto"}) == "" and PASOS._claves_articulo({}) == set()


def test_titulo_nombra_compara_por_palabra_completa():
    nombres = ["evoke+", "evoke", "lecanemab", "TRAILBLAZER-ALZ 2", "AD"]
    assert PASOS.titulo_nombra("Semaglutide in early Alzheimer's disease: the evoke and evoke+ trials", nombres) == "evoke+"
    assert PASOS.titulo_nombra("Evoked potentials in dementia", nombres) is None  # "evoked" no es "evoke"
    assert PASOS.titulo_nombra("Lecanemab in Early Alzheimer's Disease", nombres) == "lecanemab"
    assert PASOS.titulo_nombra("Donanemab in early symptomatic Alzheimer disease: the TRAILBLAZER-ALZ2 randomized clinical trial", nombres) == "TRAILBLAZER-ALZ 2"
    assert PASOS.titulo_nombra("Results of TRAILBLAZER-ALZ", nombres) is None  # otro ensayo
    assert PASOS.titulo_nombra("", nombres) is None and PASOS.titulo_nombra("x", []) is None and PASOS.titulo_nombra("AD dementia", ["AD"]) is None  # menos de tres letras no cuenta


# ---------------------------------------------------------------------------
# S-07 punta a punta: rescate por nombre, relajación, marca de demasiado amplia
# ---------------------------------------------------------------------------


def test_consulta_literatura_rescata_la_primaria_nombrada_y_relaja_la_consulta(monkeypatch):
    criterio_texto = "Objetivo: " + OBJETIVO
    primaria = _articulo("Cummings et al., 2026", "Semaglutide in early Alzheimer's disease: the evoke and evoke+ trials", "10.1016/s0140-6736(26)00459-9", "Semaglutide did not slow decline; biomarkers moved")
    excluidos = [
        # La primaria, excluida en la corrida 1 por un modelo con criterio heredado (registro antiguo, se reutilizaría).
        dict(primaria, relevancia=1, modo="foco", motivo="sin relación con GFAP/NfL en Alzheimer autosómico dominante", iteracion=3),
        # Un excluido corriente que sí se reutiliza.
        {"referencia": "Lejano, 2026", "titulo": "Zebrafish tau model of neurodegeneration", "doi": "10.1/zebra", "relevancia": 1, "modo": "foco", "motivo": "otra especie", "iteracion": 1},
    ]
    al = _almacen(excluidos_previos=excluidos)
    try:
        estrecha = '"semaglutide" AND ("GFAP" OR "NfL") AND (mediat* OR predict*)'
        relajada = '"semaglutide" AND ("GFAP" OR "NfL")'
        vistas = []

        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            vistas.append(consulta)
            if consulta == estrecha:
                return [dict(primaria), _articulo("Lejano, 2026", "Zebrafish tau model of neurodegeneration", "10.1/zebra")], 2
            assert consulta == relajada
            return [dict(primaria), _articulo("Nuevo, 2026", "Plasma GFAP after semaglutide in the evoke cohort", "10.1/nuevo", "GFAP fell")], 40

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        monkeypatch.setattr(PASOS, "_fragmentos_de", _fragmentos_falsos)

        async def crossref_falso(doi):
            return None, "Sin retracción (simulado)"

        monkeypatch.setattr(PASOS.crossref, "marca_editorial", crossref_falso)
        puntuados = []

        async def llamar(self, rol, programa, **kw):
            assert programa == "relevancia" and kw["preguntas_abiertas"] == criterio_texto
            puntuados.append(kw["titulo"])
            return SimpleNamespace(puntuacion=9 if "evoke+" in kw["titulo"] else 6, motivo="responde al objetivo")

        monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": estrecha, "tema": "Semaglutida y GFAP", "modo": "foco"}, criterio_texto))
        # La estrecha trajo 2 (< 5) con 3 cláusulas: se relanzó una vez sin la última y trajo un candidato nuevo.
        assert vistas == [estrecha, relajada]
        assert r["identificados"] == 40 and r["cribados"] == 2 and r["leidos"] == 2, r
        # La primaria estaba en la caché de exclusiones pero su título nombra "evoke+": volvió al modelo y pasó.
        assert sorted(puntuados) == ["Plasma GFAP after semaglutide in the evoke cohort", "Semaglutide in early Alzheimer's disease: the evoke and evoke+ trials"], puntuados
        c = ctx.corrida()
        fuentes = {f["doi"]: f for f in c["_fuentes"].values()}
        assert primaria["doi"] in fuentes and fuentes[primaria["doi"]]["relevancia"] == 9
        # El pez cebra siguió excluido por caché, sin llamada al modelo, y el excluido nuevo lleva las marcas.
        ex = c["busqueda"]["excluidos"]
        zebra = next(x for x in ex if x["doi"] == "10.1/zebra")
        assert zebra["motivo"].startswith("ya excluido en la corrida 1") and zebra["puntuadoPorModelo"] is False and zebra["criterio"] == PASOS.hash_criterio(criterio_texto)
        # El registro de consultas: la estrecha con su relajación, y la relajada con su origen; ambas en las hechas.
        regs = [q for q in c["busqueda"]["consultas"] if q["iteracion"] == 1]
        assert [q["consulta"] for q in regs] == [estrecha, relajada]
        # Los paneles vivos leen cifras estructuradas, sin interpretar el resumen.
        assert regs[0]["pistaId"] == regs[1]["pistaId"]
        assert any(p["id"] == regs[0]["pistaId"] for p in ctx.iteracion()["pistas"])
        assert [q["textoCompleto"] for q in regs] == [r["textoCompleto"], r["textoCompleto"]]
        assert regs[0]["relajadaA"] == relajada and regs[0]["resultadosRelajada"] == 40 and regs[0]["resultados"] == 2 and regs[0]["relevantes"] == 2
        assert regs[1]["relajadaDe"] == estrecha and regs[1]["relevantes"] == 2 and "demasiadoAmplia" not in regs[0]
        assert c["_consultasHechas"] == [estrecha, relajada]
        textos = _pista_textos(ctx)
        assert "se relanza una vez sin la última cláusula" in textos and "Vuelven al modelo aunque estaban en la caché de exclusiones" in textos and "evoke+" in textos
        assert "1 artículos ya excluidos por un modelo" in textos
    finally:
        al.cerrar()


def test_consulta_interrumpida_no_publica_cero_textos_completos(monkeypatch):
    from rosa.modulos.contador import PresupuestoAgotado

    al = _almacen(con_previa=False)
    try:
        async def buscar(consulta, maximo=10, solo_preprints=False):
            return [_articulo("A, 2026", "GFAP", "10.1/a")], 10

        async def llamar(self, rol, programa, **kw):
            raise PresupuestoAgotado("Se alcanzó el tope")

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar)
        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = _ctx(al)
        import pytest

        with pytest.raises(PresupuestoAgotado):
            asyncio.run(PASOS._consulta_literatura(ctx, ctx.iteracion()["plan"][0], {"base": "europepmc", "consulta": "gfap", "tema": "GFAP", "modo": "foco"}, "Objetivo: GFAP"))
        q = ctx.corrida()["busqueda"]["consultas"][-1]
        assert q["resultados"] == 10 and "textoCompleto" not in q
        assert next(p for p in ctx.iteracion()["pistas"] if p["id"] == q["pistaId"])["estado"] == "detenida"
    finally:
        al.cerrar()


def test_consulta_literatura_marca_la_consulta_demasiado_amplia_y_no_relaja_las_de_nombre(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        vistas = []

        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            vistas.append(consulta)
            return [_articulo("Ruido, 2026", "Evoke-related potentials in sleep", "10.1/ruido")], 2901

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        monkeypatch.setattr(PASOS, "_fragmentos_de", _fragmentos_falsos)

        async def llamar(self, rol, programa, **kw):
            return SimpleNamespace(puntuacion=0, motivo="nada que ver")

        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": '"evoke+"', "tema": "Por nombre exacto: evoke+", "modo": "foco", "_por_nombre": True}, "Objetivo: x"))
        assert r["cribados"] == 0 and vistas == ['"evoke+"'], "una consulta por nombre no se relaja"
        reg = ctx.corrida()["busqueda"]["consultas"][-1]
        assert reg["relevantes"] == 0 and reg["demasiadoAmplia"] is True
        textos = _pista_textos(ctx)
        assert "Consulta demasiado amplia: 2901 resultados" in textos
        # La pista dice lo que se envió de verdad a Europe PMC.
        assert 'TITLE_ABS:"evoke"' in textos
        # Un excluido puntuado por el modelo lleva la marca de que sí lo puntuó un modelo.
        assert ctx.corrida()["busqueda"]["excluidos"][-1]["puntuadoPorModelo"] is True
    finally:
        al.cerrar()


def test_consulta_literatura_relajada_que_no_responde_no_tumba_la_original(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            if consulta.count(" AND ") == 2:
                return [_articulo("Uno, 2026", "GFAP and NfL ordering in a cohort study", "10.1/uno")], 1
            raise FuenteNoDisponible("simulado: sin red")

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        monkeypatch.setattr(PASOS, "_fragmentos_de", _fragmentos_falsos)

        async def crossref_falso(doi):
            return None, "x"

        monkeypatch.setattr(PASOS.crossref, "marca_editorial", crossref_falso)

        async def llamar(self, rol, programa, **kw):
            return SimpleNamespace(puntuacion=7, motivo="sirve")

        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": "gfap AND nfl AND apoe4", "tema": "t", "modo": "foco"}, "Objetivo: x"))
        assert r["cribados"] == 1 and r["identificados"] == 1
        textos = _pista_textos(ctx)
        assert "La consulta relajada no llegó a Europe PMC" in textos and "No es 'sin resultados'" in textos
        reg = ctx.corrida()["busqueda"]["consultas"]
        assert len(reg) == 1 and reg[0]["relajadaA"] == "gfap AND nfl" and reg[0]["resultadosRelajada"] is None
    finally:
        al.cerrar()


def test_paso_literatura_acota_las_clausulas_y_anade_el_nombre_que_iba_dentro_de_una_estrecha(monkeypatch):
    from rosa import lecciones as LEC
    from unittest.mock import AsyncMock

    monkeypatch.setattr(PASOS, "_preparar_tanda_academica", AsyncMock(return_value=[]))

    al = _almacen(con_previa=False, objetivo="Qué predice el beneficio clínico de lecanemab en Alzheimer")
    try:
        larga = '"lecanemab"[tiab] AND ("tau PET" OR "tau-PET") AND (mediat* OR predict*) AND (GFAP OR NfL) AND plasma'

        class _Consulta:
            def __init__(self, **k):
                self.k = k

            def model_dump(self):
                return dict(self.k)

        async def llamar(self, rol, programa, **kw):
            assert programa == "consultas"
            return SimpleNamespace(consultas=[_Consulta(base="pubmed", consulta=larga, tema="Lecanemab y tau PET", modo="foco", porque="")])

        monkeypatch.setattr(Ctx, "llamar", llamar)

        async def lecciones(*a, **k):
            return "Ninguna todavía."

        monkeypatch.setattr(LEC, "para", lecciones)
        recibidas = []

        async def consulta_falsa(ctx, paso, consulta, preguntas):
            recibidas.append(dict(consulta))
            return {"identificados": 0, "cribados": 0, "textoCompleto": 0, "leidos": 0}

        monkeypatch.setattr(PASOS, "_consulta_literatura", consulta_falsa)
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        asyncio.run(PASOS.paso_literatura(ctx, paso))
        assert [q["consulta"] for q in recibidas] == ['"lecanemab"[tiab] AND ("tau PET" OR "tau-PET") AND (mediat* OR predict*)', '"lecanemab"'], recibidas
        assert recibidas[0]["_acotadaDe"] == larga and recibidas[1]["_por_nombre"] is True
    finally:
        al.cerrar()


def test_las_preguntas_propias_van_delante_de_las_heredadas():
    hechos = [
        # Heredado: su id lleva "-inv-" (el sufijo de la investigación de destino), como los reales.
        {"id": "he-1-inv-mu2", "investigacionId": "inv", "estado": "abierto", "prioridad": 1, "enunciado": "¿Baja GFAP tras lecanemab en amiloide positivos?"},
        {"id": "he-2", "investigacionId": "inv", "estado": "abierto", "prioridad": 3, "enunciado": "¿Qué predice el beneficio clínico?"},
        {"id": "he-3", "investigacionId": "inv", "estado": "abierto", "prioridad": 2, "enunciado": "¿Sube NfL antes que GFAP?"},
    ]
    texto = T.preguntas_abiertas(hechos, "inv", "Beneficio clínico de lecanemab con GFAP y NfL en Alzheimer")
    lineas = [l for l in texto.split("\n") if l[:1].isdigit()]
    assert lineas[0].endswith("¿Sube NfL antes que GFAP?") and lineas[1].endswith("¿Qué predice el beneficio clínico?")
    assert lineas[2].endswith("(heredada)") and "lecanemab" in lineas[2]


# ---------------------------------------------------------------------------
# S-06 (d): `extraido` por fragmento y reapertura al fusionar
# ---------------------------------------------------------------------------


def _paso_extraccion(al):
    paso = {"id": "paso-ext", "tipo": "extraccion", "titulo": "Extraer", "estado": "en_curso", "detalle": "", "indicacionHumana": False, "motivoFallo": None}
    al.mutar(lambda e: next(i for i in e["iteraciones"] if i["id"] == "it")["plan"].append(paso) or True, "plan")
    return paso


def _extractor_que_anota(monkeypatch, leidos: list[str]):
    async def llamar(self, rol, programa, **kw):
        assert programa == "extraer"
        leidos.append(kw["localizador"])
        return SimpleNamespace(afirmaciones=[])

    monkeypatch.setattr(Ctx, "llamar", llamar)


def test_registrar_fuente_marca_extraido_por_fragmento_y_reabre_solo_para_lo_nuevo(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        ctx = _ctx(al)
        datos = {"referencia": "Kim et al., 2025", "titulo": "Plasma GFAP precedes NfL in APOE4 carriers", "doi": "10.1/k", "tipos": [], "resumen": "GFAP sube antes " * 10}
        fid = PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "resumen", "texto": "GFAP sube antes " * 10, "encabezado": "T"}], 8, None, "limpio", 1, "q1")
        f = ctx.fuentes()[fid]
        assert f["extraida"] is False and f["fragmentos"][0]["extraido"] is False
        leidos: list[str] = []
        _extractor_que_anota(monkeypatch, leidos)
        asyncio.run(PASOS.paso_extraccion(ctx, _paso_extraccion(al)))
        assert leidos == ["resumen"] and f["extraida"] is True and f["fragmentos"][0]["extraido"] is True
        # Llega el PDF del mismo artículo: la fuente se reabre y solo se leen las páginas.
        PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "resumen", "texto": "x", "encabezado": "T"}, {"localizador": "pág. 3", "texto": "n = 312, HR 0.73 (95% CI 0.62 to 0.86) " * 5, "encabezado": "T"}, {"localizador": "pág. 4", "texto": "Sensitivity analyses gave the same ordering " * 5, "encabezado": "T"}], 8, None, "limpio", 1, "q2")
        f = ctx.fuentes()[fid]
        assert f["extraida"] is False and [fr["extraido"] for fr in f["fragmentos"]] == [True, False, False]
        assert [fr["localizador"] for fr in PASOS.fragmentos_pendientes(f)] == ["pág. 3", "pág. 4"]
        leidos.clear()
        asyncio.run(PASOS.paso_extraccion(ctx, _paso_extraccion(al)))
        assert sorted(leidos) == ["pág. 3", "pág. 4"] and f["extraida"] is True and all(fr["extraido"] for fr in f["fragmentos"])
        # Nada nuevo: la fuente no vuelve a la cola.
        assert asyncio.run(PASOS.paso_extraccion(ctx, _paso_extraccion(al))) == "No hay fuentes nuevas de las que extraer"
        # Volver a traer los mismos fragmentos no reabre nada.
        PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "pág. 3", "texto": "otro", "encabezado": "T"}], 8, None, "limpio", 1, "q3")
        assert ctx.fuentes()[fid]["extraida"] is True
    finally:
        al.cerrar()


def test_una_fuente_antigua_extraida_sin_marcas_por_fragmento_solo_lee_lo_nuevo(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        ctx = _ctx(al)
        datos = {"referencia": "Kim et al., 2025", "titulo": "Plasma GFAP precedes NfL in APOE4 carriers", "doi": "10.1/k", "tipos": [], "resumen": "r"}
        fid = PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "resumen", "texto": "GFAP sube antes " * 10, "encabezado": "T"}, {"localizador": "sección Results", "texto": "GFAP rose 2.1-fold " * 10, "encabezado": "Results"}], 8, None, "limpio", 1, "q")

        def envejecer(e):
            f = next(c for c in e["corridas"] if c["id"] == "cor")["_fuentes"][fid]
            f["extraida"] = True  # booleano antiguo: se leyó, sin marcas por fragmento
            for fr in f["fragmentos"]:
                fr.pop("extraido", None)
            return True

        al.mutar(envejecer, "prueba")
        assert PASOS.fragmentos_pendientes(ctx.fuentes()[fid]) == [ctx.fuentes()[fid]["fragmentos"][1]], "sin marca y sin fusión, lo pendiente se calcula como antes"
        PASOS._registrar_fuente(ctx, datos, "articulo", [{"localizador": "pág. 7", "texto": "Table 2: n = 312, 27% slowing, p = 0.001 " * 5, "encabezado": "T"}], 8, None, "limpio", 1, "q2")
        f = ctx.fuentes()[fid]
        assert f["extraida"] is False and [fr.get("extraido") for fr in f["fragmentos"]] == [True, True, False]
        leidos: list[str] = []
        _extractor_que_anota(monkeypatch, leidos)
        asyncio.run(PASOS.paso_extraccion(ctx, _paso_extraccion(al)))
        assert leidos == ["pág. 7"], "lo leído bajo el booleano antiguo no se vuelve a leer"
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# S-06 (e): lo ya cribado no vuelve al reranker ni al modelo
# ---------------------------------------------------------------------------


# Una comprobación de Crossref reciente: se reutiliza. Una de 1970 (123 ms) habría caducado
# (política: 90 días) y la corrida nueva volvería a preguntar, que es lo correcto.
COMPROBADA_HACE_POCO = P.ahora_ms() - 60_000


def _fuente_previa(fid: str, doi: str, referencia: str, titulo: str, relevancia: int = 8, extraida: bool = True) -> dict:
    return {"id": fid, "referencia": referencia, "titulo": titulo, "tipo": "articulo", "doi": doi, "pmid": None, "nct": None, "relevancia": relevancia, "extraida": extraida, "retraccion": None, "retraccionComprobadaEn": COMPROBADA_HACE_POCO, "_marcaDetalle": "Sin retracción en Crossref", "textoCompleto": True, "cohorte": "BioFINDER", "metodo": {"cohorte": "BioFINDER"}, "riesgoSesgo": {"global": "bajo", "instrumento": "NOS"}, "_claves": sorted(PASOS.claves_de_fuente({"doi": doi, "titulo": titulo})), "fragmentos": [{"localizador": "resumen", "texto": "GFAP sube antes " * 10, "encabezado": titulo}, {"localizador": "pág. 3", "texto": "n = 312, HR 0.73 (95% CI 0.62 to 0.86) " * 5, "encabezado": titulo}], "modo": "foco", "iteracion": 2, "consultas": ["q0"]}


def _afirmacion_previa(fid: str, referencia: str, texto: str = "GFAP subió antes que NfL en portadores de APOE4 (HR 0,73)", veredicto: str = "sostenida") -> dict:
    return {"id": f"af-prev-{fid}", "texto": texto, "cita": f"[{referencia}, pág. 3]", "fragmento": "HR 0.73 (95% CI 0.62 to 0.86)", "veredicto": veredicto, "motivo": "Literal", "tipo": "dato", "clase": "literatura", "fuenteId": fid, "localizador": "pág. 3", "iteracion": 2, "cohorte": "BioFINDER"}


def test_consulta_literatura_reutiliza_la_fuente_de_otra_corrida_sin_modelo_ni_descarga(monkeypatch):
    previa = _fuente_previa("f-vieja", "10.1/gfap", "Kim et al., 2025", "Plasma GFAP precedes NfL in APOE4 carriers")
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=[_afirmacion_previa("f-vieja", "Kim et al., 2025")])
    try:
        articulo = _articulo("Kim et al., 2025", "Plasma GFAP precedes NfL in APOE4 carriers", "10.1/gfap", "GFAP rose before NfL")
        nuevo = _articulo("Nuevo, 2026", "A fresh cohort of GFAP and NfL trajectories", "10.1/nuevo", "A fresh cohort followed for six years with serial GFAP and NfL measurements in 402 participants.")

        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            return [dict(articulo), dict(nuevo)], 2

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        descargas, crossref, puntuados = [], [], []

        async def fragmentos(ctx, datos, pista, con_texto):
            descargas.append(datos["doi"])
            return [{"localizador": "resumen", "texto": datos.get("resumen", ""), "encabezado": ""}]

        async def crossref_falso(doi):
            crossref.append(doi)
            return None, "x"

        async def llamar(self, rol, programa, **kw):
            puntuados.append(kw["titulo"])
            return SimpleNamespace(puntuacion=7, motivo="sirve")

        monkeypatch.setattr(PASOS, "_fragmentos_de", fragmentos)
        monkeypatch.setattr(PASOS.crossref, "marca_editorial", crossref_falso)
        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": "gfap AND nfl", "tema": "t", "modo": "foco"}, "Objetivo: x"))
        assert r["cribados"] == 2 and r["leidos"] == 2 and r["textoCompleto"] == 1
        # Solo la nueva pasó por el modelo, Crossref y la descarga.
        assert puntuados == ["A fresh cohort of GFAP and NfL trajectories"] and descargas == ["10.1/nuevo"] and crossref == ["10.1/nuevo"]
        fuentes = {f["doi"]: f for f in ctx.fuentes().values()}
        copia = fuentes["10.1/gfap"]
        assert copia["id"] != "f-vieja" and copia["_reutilizadaDe"] == 1 and copia["extraida"] is True
        assert [fr["localizador"] for fr in copia["fragmentos"]] == ["resumen", "pág. 3"] and all(fr["extraido"] for fr in copia["fragmentos"])
        assert copia["relevancia"] == 8 and copia["retraccionComprobadaEn"] == COMPROBADA_HACE_POCO and copia["cohorte"] == "BioFINDER" and copia["riesgoSesgo"]["global"] == "bajo" and copia["consultas"] == ["gfap AND nfl"]
        assert "ya cribados como fuente en esta investigación" in _pista_textos(ctx) and "ya cribada en la corrida 1 (relevancia 8)" in _pista_textos(ctx)
        # Sus fragmentos sirven al verificador de esta corrida, pero no se vuelven a extraer.
        assert any(fr.fuente_id == copia["id"] and fr.localizador == "pág. 3" for fr in ctx.fragmentos_verificador())
        # Y sus afirmaciones ya verificadas llegan a esta corrida con el id nuevo y su veredicto
        # (segunda pasada: sin esto, las hipótesis y el Killer no veían nada de la fuente).
        copiadas = [x for x in ctx.afirmaciones() if x["fuenteId"] == copia["id"]]
        assert len(copiadas) == 1 and copiadas[0]["veredicto"] == "sostenida" and copiadas[0]["cita"] == "[Kim et al., 2025, pág. 3]" and copiadas[0]["iteracion"] == 1
        assert copiadas[0]["id"] != "af-prev-f-vieja" and copiadas[0]["_reutilizadaDe"] == {"corrida": 1, "afirmacionId": "af-prev-f-vieja", "fuenteId": "f-vieja"}
        assert "1 afirmaciones ya extraídas y verificadas en la corrida 1 pasan a esta corrida" in _pista_textos(ctx)
        leidos: list[str] = []
        _extractor_que_anota(monkeypatch, leidos)
        asyncio.run(PASOS.paso_extraccion(ctx, _paso_extraccion(al)))
        assert leidos == ["resumen"], "solo la fuente nueva (que trae solo el resumen) se extrae"
        # Segunda consulta de la misma corrida: la fuente ya está aquí; solo se le anota la consulta.
        puntuados.clear()
        asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": "gfap AND nfl AND apoe", "tema": "t", "modo": "foco"}, "Objetivo: x"))
        assert puntuados == [] and fuentes["10.1/gfap"]["consultas"][-1] == "gfap AND nfl AND apoe" and "ya cribada en esta corrida" in _pista_textos(ctx)
    finally:
        al.cerrar()


def test_una_fuente_previa_por_debajo_del_liston_se_vuelve_a_puntuar_y_una_no_extraida_se_extrae(monkeypatch):
    baja = _fuente_previa("f-baja", "10.1/baja", "Baja, 2025", "Retinal vascular changes track amyloid burden", relevancia=4)
    baja["modo"] = "amplitud"
    pendiente = _fuente_previa("f-pend", "10.1/pend", "Pendiente, 2025", "A cohort never extracted because the budget ran out", relevancia=8, extraida=False)
    for fr in pendiente["fragmentos"]:
        fr.pop("extraido", None)
    al = _almacen(fuentes_previas={"f-baja": baja, "f-pend": pendiente})
    try:
        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            return [_articulo("Baja, 2025", "Retinal vascular changes track amyloid burden", "10.1/baja"), _articulo("Pendiente, 2025", "A cohort never extracted because the budget ran out", "10.1/pend")], 2

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        monkeypatch.setattr(PASOS, "_fragmentos_de", _fragmentos_falsos)

        async def crossref_falso(doi):
            return None, "x"

        monkeypatch.setattr(PASOS.crossref, "marca_editorial", crossref_falso)
        puntuados = []

        async def llamar(self, rol, programa, **kw):
            puntuados.append(kw["titulo"])
            return SimpleNamespace(puntuacion=6, motivo="ahora sí")

        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = _ctx(al)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": "retina", "tema": "t", "modo": "foco"}, "Objetivo: x"))
        assert r["cribados"] == 2
        assert puntuados == ["Retinal vascular changes track amyloid burden"], "la de amplitud con 4 no llega al listón de foco (5): se vuelve a puntuar; la de 8 se reutiliza"
        fuentes = {f["doi"]: f for f in ctx.fuentes().values()}
        assert fuentes["10.1/baja"]["modo"] == "foco" and fuentes["10.1/baja"]["relevancia"] == 6
        pend = fuentes["10.1/pend"]
        assert pend["extraida"] is False and all(not fr.get("extraido") for fr in pend["fragmentos"]), "nunca se extrajo: aquí sí se extrae"
        assert [fr["localizador"] for fr in PASOS.fragmentos_pendientes(pend)] == ["pág. 3"]
    finally:
        al.cerrar()


def test_indice_de_fuentes_prefiere_la_corrida_actual_y_la_mas_reciente():
    vieja = _fuente_previa("f-1", "10.1/a", "A, 2020", "Same article registered in three runs over time", relevancia=6)
    al = _almacen(fuentes_previas={"f-1": vieja})
    try:
        def fn(e):
            c0 = P.nueva_corrida("inv", 0, 100)
            c0["id"] = "cor0"
            c0["_fuentes"] = {"f-0": dict(vieja, id="f-0", relevancia=5)}
            e["corridas"].insert(0, c0)
            otra_inv = P.nueva_corrida("otra", 9, 100)
            otra_inv["_fuentes"] = {"f-x": dict(vieja, id="f-x", relevancia=10)}
            e["corridas"].append(otra_inv)
            return True

        al.mutar(fn, "prueba")
        ctx = _ctx(al)
        indice = PASOS._indice_fuentes_investigacion(ctx)
        f, numero, actual = indice["doi:10.1/a"]
        assert f["id"] == "f-1" and numero == 1 and actual is False, "la más reciente de las anteriores; la de otra investigación no cuenta"
        PASOS._registrar_fuente(ctx, {"referencia": "A, 2020", "titulo": vieja["titulo"], "doi": "10.1/a", "tipos": [], "resumen": ""}, "articulo", [], 7, None, "x", 1, "q")
        f, numero, actual = PASOS._indice_fuentes_investigacion(ctx)["doi:10.1/a"]
        assert actual is True and numero == 2 and f["relevancia"] == 7
        # Sin corridas ni fuentes: vacío, y una fuente sin claves no entra.
        al.mutar(lambda e: next(c for c in e["corridas"] if c["id"] == "cor")["_fuentes"].__setitem__("f-sin", {"id": "f-sin", "titulo": "corto"}) or True, "prueba")
        assert "f-sin" not in {v[0]["id"] for v in PASOS._indice_fuentes_investigacion(ctx).values()}
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# S-06 (c): las fuentes de una hipótesis no repiten la misma publicación
# ---------------------------------------------------------------------------


def test_fuentes_de_hipotesis_funde_la_misma_publicacion_registrada_dos_veces():
    previa = _fuente_previa("f-vieja", "10.1/raket", "Raket et al., 2026", "Disease progression model of donanemab in TRAILBLAZER-ALZ 2")
    al = _almacen(fuentes_previas={"f-vieja": previa})
    try:
        ctx = _ctx(al)
        fid = PASOS._registrar_fuente(ctx, {"referencia": "Raket et al., 2026", "titulo": previa["titulo"], "doi": "10.1/raket", "tipos": [], "resumen": ""}, "articulo", [], 8, None, "x", 1, "q")
        h = {"procedencia": {"fuentes": [{"id": fid, "referencia": "Raket et al., 2026"}, {"id": "f-vieja", "referencia": "Raket et al., 2026"}, {"id": "f-publica", "referencia": "Otra, 2024", "doi": "10.1/otra", "titulo": "A different article with another cohort entirely"}, {"sin_id": True}]}}
        fuentes = PASOS._fuentes_de_hipotesis(ctx, h)
        assert [f["id"] for f in fuentes] == [fid, "f-publica"], [f["id"] for f in fuentes]
        # Sin claves (copias públicas sin DOI ni título largo) no se funde nada.
        h2 = {"procedencia": {"fuentes": [{"id": "a", "referencia": "A"}, {"id": "b", "referencia": "B"}]}}
        assert [f["id"] for f in PASOS._fuentes_de_hipotesis(ctx, h2)] == ["a", "b"]
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# S-06 (f): caché en disco del texto completo
# ---------------------------------------------------------------------------


XML = b"""<article><body><sec><title>Introduction</title><p>Background text.</p></sec><sec><title>Results</title><p>GFAP rose 2.1-fold (95% CI 1.6 to 2.8).</p><p>NfL did not change.</p></sec></body></article>"""


def test_la_cache_esta_apagada_dentro_de_pytest_salvo_con_directorio_explicito(monkeypatch, tmp_path):
    monkeypatch.delattr(config, "DIR_CACHE_TEXTO", raising=False)
    assert FB.cache_activa() is False
    assert FB.cache_guardar("europepmc", "PMC1", [{"seccion": "x", "texto": "y"}]) is False and FB.cache_leer("europepmc", "PMC1") is None
    monkeypatch.setattr(config, "DIR_CACHE_TEXTO", tmp_path, raising=False)
    assert FB.cache_activa() is True and FB.dir_cache_texto() == tmp_path
    assert FB.cache_guardar("europepmc", "PMC1", [{"seccion": "x", "texto": "y"}]) is True
    assert FB.cache_leer("europepmc", "PMC1") == [{"seccion": "x", "texto": "y"}]
    assert FB.cache_leer("europepmc", "PMC2") is None and FB.cache_leer("exa", "PMC1") is None and FB.cache_leer("europepmc", "") is None
    # Un fichero corrupto es como no tener caché.
    ruta = next(tmp_path.glob("europepmc/*.json"))
    ruta.write_text("{esto no es json", "utf-8")
    assert FB.cache_leer("europepmc", "PMC1") is None
    # Un directorio que no se puede crear tampoco lanza.
    monkeypatch.setattr(config, "DIR_CACHE_TEXTO", tmp_path / "fichero", raising=False)
    (tmp_path / "fichero").write_text("ocupado", "utf-8")
    assert FB.cache_guardar("exa", "u", {"a": 1}) is False and FB.cache_leer("exa", "u") is None


def test_europepmc_texto_completo_usa_la_cache_en_disco(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DIR_CACHE_TEXTO", tmp_path, raising=False)
    llamadas = []

    async def pedir_falso(metodo, url, limitador, **kwargs):
        llamadas.append(url)
        cuerpo = XML if "PMC1" in url else b"<article><body></body></article>"
        return httpx.Response(200, content=cuerpo, request=httpx.Request(metodo, url))

    monkeypatch.setattr(europepmc, "pedir", pedir_falso)
    s1 = asyncio.run(europepmc.texto_completo("PMC1"))
    s2 = asyncio.run(europepmc.texto_completo("PMC1"))
    assert s1 == s2 and [x["seccion"] for x in s1] == ["Introduction", "Results"] and "2.1-fold" in s1[1]["texto"]
    assert len(llamadas) == 1, "la segunda lectura sale del disco"
    # Sin secciones no se guarda: mañana puede haber texto completo.
    assert asyncio.run(europepmc.texto_completo("PMC2")) == [] and asyncio.run(europepmc.texto_completo("PMC2")) == []
    assert len(llamadas) == 3
    # La fuente caída con caché vacía sigue siendo "no pude comprobar", no "no hay".
    async def caido(*a, **k):
        raise FuenteNoDisponible("simulado")

    monkeypatch.setattr(europepmc, "pedir", caido)
    with pytest.raises(FuenteNoDisponible):
        asyncio.run(europepmc.texto_completo("PMC3"))
    assert asyncio.run(europepmc.texto_completo("PMC1"))[1]["seccion"] == "Results", "lo cacheado se sirve aunque la fuente esté caída"


def test_exa_contenidos_usa_la_cache_por_url_y_vuelve_a_bajar_si_estaba_recortada(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DIR_CACHE_TEXTO", tmp_path, raising=False)
    monkeypatch.setattr(config, "CLAVE_EXA", "clave_de_prueba")
    pedidas = []

    async def pedir_falso(metodo, url, limitador, **kwargs):
        urls = kwargs["json"]["urls"]
        pedidas.append(list(urls))
        tope = kwargs["json"]["text"]["maxCharacters"]
        resultados = [{"url": u, "title": "T", "text": ("x" * tope) if "larga" in u else ("Serum GFAP separated amyloid positive participants." if "vacia" not in u else ""), "publishedDate": "2025-01-02"} for u in urls]
        return httpx.Response(200, json={"results": resultados, "costDollars": {"total": 0.001 * len(urls)}}, request=httpx.Request(metodo, url))

    monkeypatch.setattr(exa, "pedir", pedir_falso)
    filas, coste = asyncio.run(exa.contenidos(["https://a/corta", "https://a/vacia"]))
    assert [f["url"] for f in filas] == ["https://a/corta", "https://a/vacia"] and coste == 0.002
    filas, coste = asyncio.run(exa.contenidos(["https://a/corta", "https://a/vacia"]))
    assert pedidas == [["https://a/corta", "https://a/vacia"], ["https://a/vacia"]], "la corta sale del disco; la vacía no se guardó y se vuelve a pedir"
    assert filas[0]["texto"].startswith("Serum GFAP") and filas[0]["fecha"] == "2025-01-02" and coste == 0.001
    # Guardada con 20.000 y recortada al tope: pedir 40.000 obliga a bajarla otra vez; pedir 20.000 no.
    asyncio.run(exa.contenidos(["https://a/larga"], maximo_caracteres=20000))
    asyncio.run(exa.contenidos(["https://a/larga"], maximo_caracteres=20000))
    assert pedidas[-1] == ["https://a/larga"] and len(pedidas) == 3
    asyncio.run(exa.contenidos(["https://a/larga"], maximo_caracteres=40000))
    assert len(pedidas) == 4 and pedidas[-1] == ["https://a/larga"]
    assert asyncio.run(exa.contenidos([])) == ([], 0.0)
    assert exa._cache_sirve(None, 1000) is False and exa._cache_sirve({"fila": {"texto": ""}}, 1000) is False
