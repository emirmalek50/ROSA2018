"""Segunda pasada del constructor "literatura" (tanda 2 de la revisión del 17 de
septiembre de 2026), tras los diez hallazgos del adversario sobre S-06 e, S-07,
S-26 y M-08. Cada test fija el comportamiento nuevo e intenta romperlo con un caso
límite: corrida antigua sin el campo nuevo, fuente que no responde, registro roto,
la misma fuente dos veces en la misma corrida. Sin red ni modelos: bases, Crossref
y programas simulados con dobles."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

from rosa import cuestiones as CU
from rosa import ontologias as ONTO
from rosa import politicas
from rosa import reranker
from rosa.bucle import contexto as T
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen

OBJETIVO = "Qué predice el beneficio clínico de lecanemab en Alzheimer temprano, con GFAP y NfL en plasma"
CRITERIO = "Objetivo: " + OBJETIVO + "\nPreguntas abiertas:\n1. ¿Baja GFAP con lecanemab?"
CONSULTA = {"base": "europepmc", "consulta": "lecanemab AND gfap", "tema": "Lecanemab y GFAP", "modo": "foco"}
HACE_POCO = P.ahora_ms() - 60_000
HACE_CIEN_DIAS = P.ahora_ms() - 100 * 86_400_000


# ---------------------------------------------------------------------------
# Arnés (el mismo patrón que los otros ficheros de la tanda)
# ---------------------------------------------------------------------------


def _almacen(excluidos_previos: list | None = None, fuentes_previas: dict | None = None, afirmaciones_previas: list | None = None, con_previa: bool = True, pregunta: str | None = None):
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        e["investigaciones"].append({"id": "inv", "titulo": "t", "objetivo": OBJETIVO, "limites": [], "condicionParada": "x", "configuracion": {"preferencias": "", "atributos": [], "restricciones": [], "amplitud": "enfocada"}, "vivero": []})
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
        if pregunta:
            c["pregunta"] = {"enunciado": pregunta}
        e["corridas"].append(c)
        it = P.nueva_iteracion("cor", 1, 1000, [P.nuevo_paso("Buscar", "", 20)], 40)
        it["id"] = "it"
        e["iteraciones"].append(it)
        return True

    al.mutar(fn, "test")
    return al


def _ctx(al):
    programas = SimpleNamespace(relevancia="relevancia", relevancia_amplitud="relevancia_amplitud", extraer="extraer", consultas="consultas", mundo="mundo")
    return Ctx(al, programas, SimpleNamespace(cerebro=SimpleNamespace(model="sim"), juez=SimpleNamespace(model="sim"), volumen=SimpleNamespace(model="sim")), "cor", "inv", "it", 1)


def _paso(al, tipo="extraccion"):
    paso = {"id": f"paso-{tipo}", "tipo": tipo, "titulo": tipo, "estado": "en_curso", "detalle": "", "indicacionHumana": False, "motivoFallo": None}
    al.mutar(lambda e: next(i for i in e["iteraciones"] if i["id"] == "it")["plan"].append(paso) or True, "plan")
    return paso


def _pista_textos(ctx) -> str:
    textos = []
    for p in ctx.iteracion()["pistas"]:
        textos.append(p.get("titulo", ""))
        textos.extend(str(l.get("texto") or "") for l in (p.get("transcripcion") or []))
        textos.append(p.get("resumen") or "")
    return "\n".join(textos)


def _articulo(referencia, titulo, doi, resumen="Plasma GFAP and NfL were measured in 402 participants."):
    return {"referencia": referencia, "titulo": titulo, "resumen": resumen, "doi": doi, "pmid": None, "anio": 2026, "tipos": [], "autores": []}


def _fuente_previa(fid, doi, referencia, titulo, fragmentos, relevancia=9, extraida=True, comprobada_en=HACE_POCO, marca_detalle="Sin retracción en Crossref", modo="foco", porque=None, retraccion=None):
    for fr in fragmentos:
        fr.setdefault("extraido", extraida)
    f = {"id": fid, "referencia": referencia, "titulo": titulo, "tipo": "articulo", "doi": doi, "pmid": None, "nct": None, "relevancia": relevancia, "extraida": extraida, "retraccion": retraccion, "retraccionComprobadaEn": comprobada_en, "_marcaDetalle": marca_detalle, "textoCompleto": any(fr["localizador"] != "resumen" for fr in fragmentos), "_claves": sorted(PASOS.claves_de_fuente({"doi": doi, "titulo": titulo})), "fragmentos": fragmentos, "modo": modo, "iteracion": 2, "consultas": ["q0"]}
    if porque:
        f["porque"] = porque
    return f


def _afirmacion_previa(fid, referencia, texto="GFAP bajó un 12,4 % con lecanemab", veredicto="sostenida", localizador="pág. 9"):
    return {"id": f"af-prev-{fid}-{localizador}", "texto": texto, "cita": f"[{referencia}, {localizador}]", "fragmento": "Plasma GFAP decreased 12.4%", "veredicto": veredicto, "motivo": "Literal", "tipo": "dato", "clase": "literatura", "fuenteId": fid, "localizador": localizador, "iteracion": 2, "cohorte": "CLARITY AD"}


def _busqueda_fija(monkeypatch, articulos, total=None):
    async def buscar_falso(consulta, maximo=10, solo_preprints=False):
        return [dict(a) for a in articulos], total if total is not None else len(articulos)

    monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)


def _crossref(monkeypatch, registro, marca=None, detalle="Sin retracción (simulado)"):
    async def falso(doi):
        registro.append(doi)
        return marca, detalle

    monkeypatch.setattr(PASOS.crossref, "marca_editorial", falso)


def _modelo(monkeypatch, puntuacion, vistos):
    async def llamar(self, rol, programa, **kw):
        vistos.append((programa, kw.get("titulo") or kw.get("localizador")))
        if programa == "extraer":
            return SimpleNamespace(afirmaciones=[])
        return SimpleNamespace(puntuacion=puntuacion, motivo="responde al objetivo")

    monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway


def _sin_descarga(monkeypatch, descargas: list | None = None, con_pagina: bool = False):
    async def fragmentos(ctx, datos, pista, con_texto):
        if descargas is not None:
            descargas.append((datos["doi"], con_texto))
        salida = [{"localizador": "resumen", "texto": datos.get("resumen") or "r", "encabezado": ""}]
        if con_texto and con_pagina:
            salida.append({"localizador": "pág. 9", "texto": "Table 2. CDR-SB 1.21 vs 1.66, difference -0.45 (95% CI -0.67 to -0.23). " * 4, "encabezado": "T"})
        return salida

    monkeypatch.setattr(PASOS, "_fragmentos_de", fragmentos)


def _correr(ctx, consulta=None, criterio=CRITERIO):
    return asyncio.run(PASOS._consulta_literatura(ctx, ctx.iteracion()["plan"][0], dict(consulta or CONSULTA), criterio))


# ---------------------------------------------------------------------------
# Hallazgo 4. La huella del criterio solo mira lo estable
# ---------------------------------------------------------------------------


def test_la_huella_del_criterio_ignora_las_preguntas_abiertas_pero_no_el_objetivo_ni_la_pregunta_de_corrida():
    base = "Objetivo: GFAP y NfL en lecanemab\nPregunta de esta corrida: ¿Predice GFAP el beneficio?"
    assert PASOS.criterio_estable(base + "\nPreguntas abiertas:\n1. A\n2. B") == base
    assert PASOS.hash_criterio(base + "\nPreguntas abiertas:\n1. A") == PASOS.hash_criterio(base + "\nPreguntas abiertas:\n1. A\n2. B\n3. C")
    assert PASOS.hash_criterio(base) == PASOS.hash_criterio(base + "\nSin preguntas abiertas propias todavía.")
    # Otro objetivo u otra pregunta de la corrida: otra huella.
    assert PASOS.hash_criterio(base) != PASOS.hash_criterio("Objetivo: otra cosa\nPregunta de esta corrida: ¿Predice GFAP el beneficio?")
    assert PASOS.hash_criterio(base) != PASOS.hash_criterio("Objetivo: GFAP y NfL en lecanemab\nPregunta de esta corrida: ¿Y NfL?")
    assert PASOS.hash_criterio(base) != PASOS.hash_criterio("Objetivo: GFAP y NfL en lecanemab")
    # Un criterio con preguntas heredadas de otra investigación no es el mismo criterio (S-07).
    con_heredadas = base + "\nPreguntas abiertas:\n1. ¿Qué pasa en DIAN? (heredada)"
    assert PASOS.criterio_estable(con_heredadas).endswith("con preguntas heredadas") and PASOS.hash_criterio(con_heredadas) != PASOS.hash_criterio(base)
    # Mayúsculas y espacios no cuentan; un texto sin las líneas estables (el objetivo a secas, en amplitud) vale entero.
    assert PASOS.hash_criterio("Objetivo: GFAP") == PASOS.hash_criterio("objetivo:  gfap") and PASOS.hash_criterio("") != PASOS.hash_criterio("a")
    assert PASOS.criterio_estable("un objetivo a secas") == "un objetivo a secas" and PASOS.criterio_estable("") == "" and PASOS.criterio_estable(None) == ""  # type: ignore[arg-type]


def test_la_exclusion_de_hace_una_iteracion_se_reutiliza_aunque_la_pregunta_de_corrida_cambie_no(monkeypatch):
    """Mismo objetivo, otra pregunta de la corrida: la exclusión anterior no vale y el
    artículo vuelve al modelo. Es el reverso del test del adversario."""
    doi = "10.1/zebra"
    zebra = _articulo("Lejano, 2026", "Zebrafish tau model of neurodegeneration", doi, "Zebrafish larvae expressing human tau.")
    criterio_anterior = "Objetivo: " + OBJETIVO + "\nPregunta de esta corrida: ¿Baja GFAP?\nPreguntas abiertas:\n1. A"
    criterio_ahora = "Objetivo: " + OBJETIVO + "\nPregunta de esta corrida: ¿Sube NfL?\nPreguntas abiertas:\n1. A"
    excluido = dict(zebra, relevancia=1, modo="foco", motivo="otra especie", iteracion=1, puntuadoPorModelo=True, criterio=PASOS.hash_criterio(criterio_anterior))
    al = _almacen(excluidos_previos=[excluido])
    try:
        _busqueda_fija(monkeypatch, [zebra])
        _sin_descarga(monkeypatch)
        _crossref(monkeypatch, [])
        vistos: list = []
        _modelo(monkeypatch, 1, vistos)
        ctx = _ctx(al)
        _correr(ctx, criterio=criterio_ahora)
        assert [v[1] for v in vistos] == ["Zebrafish tau model of neurodegeneration"], "otra pregunta de corrida: se vuelve a juzgar"
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# Hallazgo 5. La red por nombre no insiste sin tope, y lo dice
# ---------------------------------------------------------------------------


def test_consultas_por_nombre_deja_de_insistir_tras_dos_simples_sin_relevantes_o_una_en_la_corrida_en_curso():
    tope = politicas.MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES
    assert tope == 2
    # Una sola consulta simple sin relevantes en otra corrida: se repite todavía.
    registro = [{"consulta": '"lecanemab"', "resultados": 2901, "relevantes": 0, "corrida": 1, "iteracion": 2}]
    explicaciones: list[str] = []
    assert [q["consulta"] for q in PASOS.consultas_por_nombre(["lecanemab"], [], [], registro=registro, corrida_actual=2, explicaciones=explicaciones)] == ['"lecanemab"'] and explicaciones == []
    # La misma en la corrida en curso: no se repite en esta corrida, y queda explicado.
    registro_actual = [{"consulta": 'TITLE_ABS:"lecanemab"', "resultados": 2901, "relevantes": 0, "corrida": 2, "iteracion": 1}]
    assert PASOS.consultas_por_nombre(["lecanemab"], [], [], registro=registro_actual, corrida_actual=2, explicaciones=explicaciones) == []
    assert explicaciones == ["«lecanemab» ya se buscó por nombre en esta corrida sin ningún relevante; no se repite en la misma corrida"]
    # Dos en corridas distintas: tope de la investigación, con las corridas en la explicación.
    explicaciones.clear()
    dos = [{"consulta": '"lecanemab"', "resultados": 2901, "relevantes": 0, "corrida": 1}, {"consulta": '"lecanemab"', "resultados": 2950, "relevantes": 0, "corrida": 3}]
    assert PASOS.consultas_por_nombre(["lecanemab", "donanemab"], [], [], registro=dos, corrida_actual=4, explicaciones=explicaciones) == [{"base": "europepmc", "consulta": '"donanemab"', "tema": "Por nombre exacto: donanemab", "_por_nombre": True}]
    assert explicaciones == ["«lecanemab» ya se buscó por nombre 2 veces en las corridas 1, 3 sin ningún relevante; no se repite (política: 2 consultas simples sin relevantes)"]
    # Sin explicaciones ni corrida_actual (llamada antigua) la regla del tope sigue valiendo.
    assert PASOS.consultas_por_nombre(["lecanemab"], [], [], registro=dos) == []
    # Un relevante en cualquier consulta simple manda sobre todo lo demás: buscado.
    assert PASOS.consultas_por_nombre(["lecanemab"], [], [], registro=dos + [{"consulta": '"lecanemab"', "resultados": 5, "relevantes": 1, "corrida": 2}]) == []
    # Registros a medias no cuentan: relevantes None (cribado sin terminar), booleanos, textos, resultados 0.
    raros = [{"consulta": '"lecanemab"', "resultados": 2901, "relevantes": None, "corrida": 2}, {"consulta": '"lecanemab"', "resultados": True, "relevantes": False, "corrida": 2}, {"consulta": '"lecanemab"', "resultados": "muchos", "relevantes": "0", "corrida": 2}, {"consulta": '"lecanemab"', "resultados": 0, "relevantes": 0, "corrida": 2}]
    explicaciones.clear()
    assert [q["consulta"] for q in PASOS.consultas_por_nombre(["lecanemab"], [], [], registro=raros, corrida_actual=2, explicaciones=explicaciones)] == ['"lecanemab"'] and explicaciones == []
    # Dos con cero resultados en la base: la explicación es otra (no está allí).
    assert PASOS.consultas_por_nombre(["AL002"], [], [], registro=[{"consulta": '"AL002"', "resultados": 0}, {"consulta": '"AL002"', "resultados": 0}], explicaciones=explicaciones) == []
    assert explicaciones == ["«AL002» ya se buscó por nombre 2 veces y la base no tiene ningún resultado; no se insiste"]


def test_paso_literatura_escribe_en_una_pista_lo_que_la_red_por_nombre_deja_de_repetir(monkeypatch):
    from unittest.mock import AsyncMock

    monkeypatch.setattr(PASOS, "_preparar_tanda_academica", AsyncMock(return_value=[]))
    al = _almacen(con_previa=False)
    try:
        def registro(e):
            c = next(x for x in e["corridas"] if x["id"] == "cor")
            c["busqueda"]["consultas"].append({"base": "Europe PMC", "consulta": '"lecanemab"', "fecha": 1, "resultados": 2901, "relevantes": 0, "iteracion": 0, "tema": "n", "modo": "foco"})
            return True

        al.mutar(registro, "prueba")

        class Consulta:
            def __init__(self, **k):
                self.k = k

            def model_dump(self):
                return dict(self.k)

        async def llamar(self, rol, programa, **kw):
            return SimpleNamespace(consultas=[Consulta(base="europepmc", consulta="gfap AND nfl", tema="GFAP")])

        async def lecciones(*a, **k):
            return "Ninguna todavía."

        vistas: list[str] = []

        async def consulta_falsa(ctx, paso, consulta, preguntas):
            vistas.append(consulta["consulta"])
            return {"identificados": 0, "cribados": 0, "textoCompleto": 0, "leidos": 0}

        monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway
        monkeypatch.setattr(PASOS.LEC, "para", lecciones)
        monkeypatch.setattr(PASOS, "_consulta_literatura", consulta_falsa)
        ctx = _ctx(al)
        asyncio.run(PASOS.paso_literatura(ctx, ctx.iteracion()["plan"][0]))
        assert '"lecanemab"' not in vistas and "gfap AND nfl" in vistas
        textos = _pista_textos(ctx)
        assert "Red de seguridad por nombre" in textos and "«lecanemab» ya se buscó por nombre en esta corrida sin ningún relevante" in textos
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# Hallazgos 5 (rescate) y 10 (tope de forzados)
# ---------------------------------------------------------------------------


def test_el_rescate_por_nombre_no_se_repite_si_un_modelo_ya_lo_excluyo_con_este_criterio(monkeypatch):
    primaria = _articulo("van Dyck et al., 2023", "Lecanemab in Early Alzheimer's Disease", "10.1056/nejmoa2212948")
    antigua = _articulo("Swanson et al., 2021", "A randomized, double-blind, phase 2b proof-of-concept clinical trial in early Alzheimer's disease with lecanemab", "10.1186/s13195-021-00813-8")
    excluidos = [
        # Puntuada por un modelo con ESTE mismo criterio estable: no se rescata otra vez.
        dict(primaria, relevancia=2, modo="foco", motivo="no mide GFAP", iteracion=1, puntuadoPorModelo=True, criterio=PASOS.hash_criterio(CRITERIO)),
        # Registro antiguo sin huella (anterior al 18 de septiembre): sí se rescata, como en la primera pasada.
        dict(antigua, relevancia=1, modo="foco", motivo="sin relación con GFAP/NfL en ADAD", iteracion=3),
    ]
    al = _almacen(excluidos_previos=excluidos)
    try:
        _busqueda_fija(monkeypatch, [primaria, antigua])
        _sin_descarga(monkeypatch)
        _crossref(monkeypatch, [])
        vistos: list = []
        _modelo(monkeypatch, 8, vistos)
        ctx = _ctx(al)
        _correr(ctx)
        assert [v[1] for v in vistos] == [antigua["titulo"]], vistos
        textos = _pista_textos(ctx)
        assert "un modelo ya los excluyó con este mismo objetivo y pregunta de corrida" in textos and "van Dyck et al., 2023 (lecanemab)" in textos
        assert "la exclusión se hizo sin huella de este criterio" in textos and "Swanson et al., 2021 (lecanemab)" in textos
        ex = ctx.corrida()["busqueda"]["excluidos"]
        assert any(x["doi"] == primaria["doi"] and x["motivo"].startswith("ya excluido en la corrida 1") for x in ex)
    finally:
        al.cerrar()


def test_los_forzados_por_nombre_tienen_tope_y_el_resto_pasa_por_el_reranker(monkeypatch):
    monkeypatch.setattr(reranker, "disponible", lambda: True)
    tope = politicas.MAX_FORZADOS_POR_NOMBRE
    articulos = [_articulo(f"Autor{i}, 2026", f"Lecanemab study number {i} in early Alzheimer disease with plasma markers", f"10.1/lec{i}") for i in range(tope + 5)]
    al = _almacen(con_previa=False)
    try:
        _busqueda_fija(monkeypatch, articulos)
        _sin_descarga(monkeypatch)
        _crossref(monkeypatch, [])
        vistos: list = []
        _modelo(monkeypatch, 3, vistos)
        cortados: list = []

        async def reordenar(pregunta, documentos, top_n=None):
            cortados.extend(documentos)
            # Todos por debajo del corte: el reranker no deja pasar a ninguno.
            return [(i, 0.1) for i in range(len(documentos))]

        monkeypatch.setattr(reranker, "reordenar", reordenar)
        ctx = _ctx(al)
        _correr(ctx)
        # Los cinco de más del tope fueron al reranker; con el tope MAX_CRIBADO_MODELO (12) no lo pasan
        # solo si son más de 12: aquí son 5, así que el reranker los deja pasar todos (regla de cortar_con_reranker).
        assert len(vistos) == tope + 5 and len(cortados) == 0, "5 candidatos no superan MAX_CRIBADO_MODELO: el reranker no corta"
        textos = _pista_textos(ctx)
        assert f"{tope} artículos cuyo título nombra" in textos and f"(tope {tope} por consulta: otros 5 van por el reranker como los demás)" in textos
    finally:
        al.cerrar()


def test_titulo_nombra_admite_el_guion_pegado_al_nombre():
    nombres = ["evoke+", "evoke", "lecanemab", "donanemab", "TRAILBLAZER-ALZ 2"]
    assert PASOS.titulo_nombra("Lecanemab-associated ARIA: a case series", nombres) == "lecanemab"
    assert PASOS.titulo_nombra("Outcomes in donanemab-treated participants", nombres) == "donanemab"
    assert PASOS.titulo_nombra("Anti-lecanemab antibodies", nombres) == "lecanemab"
    # Lo que no debe cambiar: "evoked" no es "evoke", "evoke+" sigue distinguiéndose y el ensayo hermano no casa.
    assert PASOS.titulo_nombra("Evoked potentials in dementia", nombres) is None
    assert PASOS.titulo_nombra("the evoke and evoke+ trials", nombres) == "evoke+"
    assert PASOS.titulo_nombra("Results of TRAILBLAZER-ALZ", nombres) is None
    assert PASOS.titulo_nombra("Lecanemabs and other antibodies", nombres) is None  # sufijo pegado: otra palabra


# ---------------------------------------------------------------------------
# Hallazgos 1, 2, 3, 8. La fuente reutilizada trae lo suyo y completa lo que faltó
# ---------------------------------------------------------------------------


def test_comprobacion_retraccion_caducada_por_regla():
    ahora = P.ahora_ms()
    caducada = PASOS.comprobacion_retraccion_caducada
    assert caducada({"retraccionComprobadaEn": None}, ahora) is True
    assert caducada({}, ahora) is True and caducada({"retraccionComprobadaEn": True}, ahora) is True and caducada({"retraccionComprobadaEn": "ayer"}, ahora) is True
    assert caducada({"retraccionComprobadaEn": ahora - 1000}, ahora) is False
    assert caducada({"retraccionComprobadaEn": HACE_CIEN_DIAS}, ahora) is True
    assert caducada({"retraccionComprobadaEn": HACE_CIEN_DIAS}, ahora, dias=365) is False
    # Una retracción comprobada no caduca; una sin fecha sí se repite (para ponerle fecha y detalle).
    assert caducada({"retraccionComprobadaEn": HACE_CIEN_DIAS, "retraccion": "retractado"}, ahora) is False
    assert caducada({"retraccionComprobadaEn": None, "retraccion": "retractado"}, ahora) is True


def test_la_fuente_reutilizada_repite_crossref_solo_si_la_comprobacion_caduco(monkeypatch):
    reciente = _fuente_previa("f-a", "10.1/a", "A et al., 2025", "Plasma GFAP trajectories in a recent cohort of early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 2", "texto": "n = 300 " * 20, "encabezado": "T"}], comprobada_en=HACE_POCO)
    vieja = _fuente_previa("f-b", "10.1/b", "B et al., 2020", "Plasma NfL trajectories in an older cohort of early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 2", "texto": "n = 300 " * 20, "encabezado": "T"}], comprobada_en=HACE_CIEN_DIAS)
    afs = [_afirmacion_previa("f-a", "A et al., 2025", localizador="pág. 2"), _afirmacion_previa("f-b", "B et al., 2020", localizador="pág. 2")]
    al = _almacen(fuentes_previas={"f-a": reciente, "f-b": vieja}, afirmaciones_previas=afs)
    try:
        _busqueda_fija(monkeypatch, [_articulo("A et al., 2025", reciente["titulo"], "10.1/a"), _articulo("B et al., 2020", vieja["titulo"], "10.1/b")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)  # las dos tienen texto completo: no se descarga
        consultados: list = []
        _crossref(monkeypatch, consultados, marca=None, detalle="Sin retracción, comprobado hoy")
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        assert consultados == ["10.1/b"], "solo la comprobación de hace cien días se repite"
        fuentes = {f["doi"]: f for f in ctx.fuentes().values()}
        assert fuentes["10.1/a"]["retraccionComprobadaEn"] == HACE_POCO
        assert fuentes["10.1/b"]["retraccionComprobadaEn"] > HACE_CIEN_DIAS and fuentes["10.1/b"]["_marcaDetalle"] == "Sin retracción, comprobado hoy"
        assert f"tiene más de {politicas.DIAS_VIGENCIA_COMPROBACION_RETRACCION} días; se repite en Crossref" in _pista_textos(ctx)
    finally:
        al.cerrar()


def test_si_crossref_sigue_caido_la_copia_queda_sin_fecha_para_repetirlo_en_la_siguiente_corrida(monkeypatch):
    from rosa.fuentes.base import FuenteNoDisponible

    previa = _fuente_previa("f-a", "10.1/a", "A et al., 2025", "Plasma GFAP trajectories in a recent cohort of early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 2", "texto": "n = 300 " * 20, "encabezado": "T"}], comprobada_en=None, marca_detalle="Crossref no respondió: timeout")
    al = _almacen(fuentes_previas={"f-a": previa}, afirmaciones_previas=[_afirmacion_previa("f-a", "A et al., 2025", localizador="pág. 2")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("A et al., 2025", previa["titulo"], "10.1/a")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)

        async def caido(doi):
            raise FuenteNoDisponible("Crossref: 503")

        monkeypatch.setattr(PASOS.crossref, "marca_editorial", caido)
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/a")
        assert copia["retraccion"] is None and copia["retraccionComprobadaEn"] is None and "Crossref no respondió: Crossref: 503" in copia["_marcaDetalle"]
        assert "no llegó; se repite en Crossref" in _pista_textos(ctx)
        # La fuente y sus afirmaciones siguen llegando: "no pude comprobar" no es "retractado".
        assert [a["veredicto"] for a in ctx.afirmaciones() if a["fuenteId"] == copia["id"]] == ["sostenida"]
    finally:
        al.cerrar()


def test_una_fuente_reutilizada_que_ahora_resulta_retractada_no_presta_afirmaciones(monkeypatch):
    previa = _fuente_previa("f-a", "10.1/a", "A et al., 2025", "Plasma GFAP trajectories in a recent cohort of early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 2", "texto": "n = 300 " * 20, "encabezado": "T"}], comprobada_en=None)
    al = _almacen(fuentes_previas={"f-a": previa}, afirmaciones_previas=[_afirmacion_previa("f-a", "A et al., 2025", localizador="pág. 2")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("A et al., 2025", previa["titulo"], "10.1/a")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [], marca="retractado", detalle="Retraction notice")
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/a")
        assert copia["retraccion"] == "retractado" and [a for a in ctx.afirmaciones() if a["fuenteId"] == copia["id"]] == []
        assert "está RETRACTADO" in _pista_textos(ctx)
    finally:
        al.cerrar()


def test_las_afirmaciones_copiadas_llevan_la_referencia_desambiguada_y_no_se_copian_dos_veces(monkeypatch):
    """En esta corrida ya hay otro "Kim et al., 2025" (otro DOI): la copia se registra como
    "Kim et al., 2025b" y sus afirmaciones citan esa referencia, que es la que el
    verificador resuelve. Una segunda consulta que vuelve a traerla no duplica nada."""
    previa = _fuente_previa("f-vieja", "10.1/gfap", "Kim et al., 2025", "Plasma GFAP precedes NfL in APOE4 carriers", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "HR 0.73 (95% CI 0.62 to 0.86) " * 10, "encabezado": "T"}])
    afs = [_afirmacion_previa("f-vieja", "Kim et al., 2025", localizador="pág. 3"), _afirmacion_previa("f-vieja", "Kim et al., 2025", texto="NfL no cambió", veredicto="sin_verificar", localizador="resumen"), {"id": "af-sin-loc", "texto": "Registro antiguo sin localizador", "cita": "[Kim et al., 2025, pág. 3]", "veredicto": "parcial", "tipo": "dato", "fuenteId": "f-vieja", "iteracion": 1}]
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=afs)
    try:
        ctx = _ctx(al)
        PASOS._registrar_fuente(ctx, {"referencia": "Kim et al., 2025", "titulo": "A different Kim paper on retinal imaging in dementia", "doi": "10.1/otro", "tipos": [], "resumen": ""}, "articulo", [{"localizador": "resumen", "texto": "x " * 40, "encabezado": ""}], 6, None, "x", HACE_POCO, "q")
        _busqueda_fija(monkeypatch, [_articulo("Kim et al., 2025", previa["titulo"], "10.1/gfap")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        _correr(ctx)
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/gfap")
        assert copia["referencia"] == "Kim et al., 2025b"
        copiadas = sorted((a for a in ctx.afirmaciones() if a["fuenteId"] == copia["id"]), key=lambda a: a["texto"])
        assert [a["cita"] for a in copiadas] == ["[Kim et al., 2025b, pág. 3]", "[Kim et al., 2025b, resumen]", "[Kim et al., 2025b, pág. 3]"]
        assert [a["veredicto"] for a in copiadas] == ["sostenida", "sin_verificar", "parcial"], "cada una conserva su veredicto; la sin verificar la verificará esta corrida"
        assert all(a["iteracion"] == 1 for a in copiadas) and len({a["id"] for a in copiadas}) == 3
        # Las citas resuelven contra los fragmentos copiados con la referencia nueva.
        frags = ctx.fragmentos_verificador()
        assert all(PASOS._resolver_cita(a["cita"], frags, copia["id"]) is not None for a in copiadas if a.get("localizador"))
        assert ctx.corrida()["busqueda"]["usados"] == 1
        # Segunda consulta de la misma corrida: ya está aquí; ni copia ni duplica.
        _correr(ctx, {"base": "europepmc", "consulta": "gfap AND apoe", "tema": "t", "modo": "foco"})
        assert len([a for a in ctx.afirmaciones() if a["fuenteId"] == copia["id"]]) == 3
    finally:
        al.cerrar()


def test_una_fuente_extraida_sin_afirmaciones_guardadas_se_vuelve_a_extraer(monkeypatch):
    previa = _fuente_previa("f-vieja", "10.1/gfap", "Kim et al., 2025", "Plasma GFAP precedes NfL in APOE4 carriers", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "HR 0.73 (95% CI 0.62 to 0.86) " * 10, "encabezado": "T"}], extraida=True)
    # La corrida 1 tiene su lista de afirmaciones, pero ninguna de esta fuente (el extractor no sacó nada).
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=[])
    try:
        _busqueda_fija(monkeypatch, [_articulo("Kim et al., 2025", previa["titulo"], "10.1/gfap")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [])
        vistos: list = []
        _modelo(monkeypatch, 9, vistos)
        ctx = _ctx(al)
        _correr(ctx)
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/gfap")
        assert copia["extraida"] is False and all(not fr["extraido"] for fr in copia["fragmentos"])
        assert "la corrida 1 la leyó pero no guardó ninguna afirmación suya: se vuelve a extraer" in _pista_textos(ctx)
        asyncio.run(PASOS.paso_extraccion(ctx, _paso(al)))
        assert [v for v in vistos if v[0] == "extraer"] == [("extraer", "pág. 3")], "se extrae aquí (el resumen se salta cuando hay cuerpo)"
    finally:
        al.cerrar()


def test_la_fuente_reutilizada_conserva_el_modo_foco_y_el_porque_de_amplitud(monkeypatch):
    foco = _fuente_previa("f-foco", "10.1/foco", "Foco, 2025", "Plasma GFAP predicts response to lecanemab in early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "n = 300 " * 20, "encabezado": "T"}], relevancia=5, modo="foco")
    amplitud = _fuente_previa("f-amp", "10.1/amp", "Amplio, 2025", "Retinal vascular changes track amyloid burden in cognitively unimpaired adults", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "n = 300 " * 20, "encabezado": "T"}], relevancia=6, modo="amplitud", porque="podría dar un marcador no invasivo")
    afs = [_afirmacion_previa("f-foco", "Foco, 2025", localizador="pág. 3"), _afirmacion_previa("f-amp", "Amplio, 2025", localizador="pág. 3")]
    al = _almacen(fuentes_previas={"f-foco": foco, "f-amp": amplitud}, afirmaciones_previas=afs)
    try:
        _busqueda_fija(monkeypatch, [_articulo("Foco, 2025", foco["titulo"], "10.1/foco"), _articulo("Amplio, 2025", amplitud["titulo"], "10.1/amp")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        # Una consulta de amplitud (listón 4) trae a las dos: la de foco sigue siendo de foco.
        _correr(ctx, {"base": "europepmc", "consulta": "retina OR gfap", "tema": "alrededor", "modo": "amplitud", "porque": "otra cosa"})
        fuentes = {f["doi"]: f for f in ctx.fuentes().values()}
        assert fuentes["10.1/foco"]["modo"] == "foco" and "porque" not in fuentes["10.1/foco"]
        assert fuentes["10.1/amp"]["modo"] == "amplitud" and fuentes["10.1/amp"]["porque"] == "podría dar un marcador no invasivo"
        assert PASOS._criterio_para_fuente("Objetivo: x", fuentes["10.1/amp"]).count("podría dar un marcador no invasivo") == 1
    finally:
        al.cerrar()


def test_una_fuente_de_amplitud_reutilizada_por_una_consulta_de_foco_que_pasa_su_liston_pasa_a_foco(monkeypatch):
    amplitud = _fuente_previa("f-amp", "10.1/amp", "Amplio, 2025", "Plasma GFAP and retinal changes in early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "n = 300 " * 20, "encabezado": "T"}], relevancia=7, modo="amplitud", porque="marcador no invasivo")
    al = _almacen(fuentes_previas={"f-amp": amplitud}, afirmaciones_previas=[_afirmacion_previa("f-amp", "Amplio, 2025", localizador="pág. 3")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("Amplio, 2025", amplitud["titulo"], "10.1/amp")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/amp")
        assert copia["modo"] == "foco" and copia["porque"] == "marcador no invasivo", "la trajo la pregunta: foco; el porqué no se pierde"
    finally:
        al.cerrar()


def test_la_fuente_reutilizada_con_solo_resumen_intenta_el_texto_completo_una_vez_por_iteracion(monkeypatch):
    previa = _fuente_previa("f-vieja", "10.1/solo", "Solo, 2025", "Lecanemab and plasma GFAP: an abstract-only source in early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}], relevancia=8)
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=[_afirmacion_previa("f-vieja", "Solo, 2025", localizador="resumen")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("Solo, 2025", previa["titulo"], "10.1/solo")])
        descargas: list = []
        _sin_descarga(monkeypatch, descargas, con_pagina=False)  # no hay PDF ni XML accesibles
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        r = _correr(ctx)
        assert descargas == [("10.1/solo", True)] and r["textoCompleto"] == 0
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/solo")
        assert copia["_sinTextoCompletoEn"] == {"corrida": 2, "iteracion": 1} and copia["extraida"] is True
        assert "tampoco ahora hay texto completo accesible" in _pista_textos(ctx)
        assert "_sinTextoCompletoEn" not in PASOS._fuente_publica(copia), "una marca privada no viaja al navegador"
        # Segunda consulta de la misma iteración: no se reintenta.
        _correr(ctx, {"base": "europepmc", "consulta": "gfap AND apoe", "tema": "t", "modo": "foco"})
        assert len(descargas) == 1
        # Siguiente iteración: se vuelve a intentar, y esta vez llega la página, que reabre la fuente solo para lo nuevo.
        ctx2 = Ctx(al, ctx.programas, ctx.modelos, "cor", "inv", "it", 2)
        _sin_descarga(monkeypatch, descargas, con_pagina=True)
        r2 = _correr(ctx2)
        assert len(descargas) == 2 and r2["textoCompleto"] == 1
        copia = next(f for f in ctx2.fuentes().values() if f["doi"] == "10.1/solo")
        assert [fr["localizador"] for fr in copia["fragmentos"]] == ["resumen", "pág. 9"] and copia["extraida"] is False
        assert [fr["localizador"] for fr in PASOS.fragmentos_pendientes(copia)] == ["pág. 9"], "solo lo nuevo se extrae"
        # Y una fuente que ya estaba en esta corrida con relevancia baja o fuera de las cuatro primeras no descarga.
        assert len([a for a in ctx2.afirmaciones() if a["fuenteId"] == copia["id"]]) == 1
    finally:
        al.cerrar()


def test_la_fuente_reutilizada_fuera_de_las_cuatro_primeras_o_con_relevancia_baja_no_descarga(monkeypatch):
    previa = _fuente_previa("f-vieja", "10.1/solo", "Solo, 2025", "Lecanemab and plasma GFAP: an abstract-only source in early Alzheimer disease", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}], relevancia=6)
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=[_afirmacion_previa("f-vieja", "Solo, 2025", localizador="resumen")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("Solo, 2025", previa["titulo"], "10.1/solo")])
        descargas: list = []
        _sin_descarga(monkeypatch, descargas, con_pagina=True)
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        assert descargas == [], "relevancia 6 (< 7): la regla de descarga de esta corrida tampoco lo haría"
        copia = next(f for f in ctx.fuentes().values() if f["doi"] == "10.1/solo")
        assert "_sinTextoCompletoEn" not in copia and copia["extraida"] is True
    finally:
        al.cerrar()


def test_las_afirmaciones_copiadas_entran_al_modelo_de_mundo_como_nuevas_de_esta_iteracion(monkeypatch):
    previa = _fuente_previa("f-vieja", "10.1/gfap", "Kim et al., 2025", "Plasma GFAP precedes NfL in APOE4 carriers", [{"localizador": "resumen", "texto": "r " * 50, "encabezado": "T"}, {"localizador": "pág. 3", "texto": "HR 0.73 " * 20, "encabezado": "T"}])
    al = _almacen(fuentes_previas={"f-vieja": previa}, afirmaciones_previas=[_afirmacion_previa("f-vieja", "Kim et al., 2025", localizador="pág. 3")])
    try:
        _busqueda_fija(monkeypatch, [_articulo("Kim et al., 2025", previa["titulo"], "10.1/gfap")])
        monkeypatch.setattr(PASOS, "_fragmentos_de", None)
        _crossref(monkeypatch, [])
        _modelo(monkeypatch, 9, [])
        ctx = _ctx(al)
        _correr(ctx)
        nuevas = [a for a in ctx.afirmaciones() if a["iteracion"] == ctx.numero]
        texto, validas = T.afirmaciones_sostenidas(nuevas)
        assert len(validas) == 1 and "[Kim et al., 2025, pág. 3]" in texto, "el paso del modelo de mundo y el de hipótesis la ven"
        assert not [a for a in ctx.afirmaciones() if a["veredicto"] == "sin_verificar"], "ya verificada: no vuelve a la cola del juez"
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# Hallazgo 6. El hecho fundido conserva sustituye y contradice, no solo resuelve
# ---------------------------------------------------------------------------


def test_fundir_una_parafrasis_sustituye_y_contradice_lo_que_el_cerebro_senalo(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        ctx = _ctx(al)
        fid = PASOS._registrar_fuente(ctx, {"referencia": "Belder et al., 2026", "titulo": "Plasma biomarkers in autosomal dominant Alzheimer disease carriers", "doi": "10.1/belder", "tipos": [], "resumen": ""}, "articulo", [{"localizador": "pág. 2", "texto": "Four non-carriers were excluded before the GFAP analysis. " * 5, "encabezado": "T"}], 8, None, "limpio", 1, "q")
        existente = P.nuevo_hecho("inv", "hecho", "GFAP", "Se excluyeron cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP", "sabido", "fuente", [{"fuenteId": fid, "referencia": "Belder et al., 2026", "pagina": 2}], 1000, 3, "test", afirmacion_ids=["af-0"], citas=[])
        existente["entidades"] = []
        existente.pop("sustituyeA", None)  # registro antiguo sin las listas de enlace
        existente.pop("contradiceA", None)
        existente.pop("resuelveA", None)
        viejo = P.nuevo_hecho("inv", "hecho", "GFAP", "No se excluyó a ningún participante antes del análisis de GFAP en DIAN", "sabido", "fuente", [], 900, 3, "test", afirmacion_ids=[], citas=[])
        otro = P.nuevo_hecho("inv", "hecho", "NfL", "NfL sube antes que GFAP en portadores de DIAN", "sabido", "fuente", [], 950, 3, "test", afirmacion_ids=[], citas=[])
        afs = [{"id": "af-1", "texto": "Los autores excluyeron a cuatro no portadores antes del análisis de GFAP", "cita": "[Belder et al., 2026, pág. 2]", "fragmento": "Four non-carriers were excluded before the GFAP analysis.", "veredicto": "sostenida", "tipo": "dato", "fuenteId": fid, "localizador": "pág. 2", "iteracion": 1}]

        def fn(e):
            e["hechos"].extend([viejo, otro, existente])
            next(c for c in e["corridas"] if c["id"] == "cor")["_afirmaciones"] = afs
            return True

        al.mutar(fn, "prueba")
        _, lista = T.hechos_numerados(al.estado["hechos"], "inv")
        indice = {h["id"]: i + 1 for i, h in enumerate(lista)}

        async def mundo_para(almacen, inv, consulta, maximo=60):
            return "Vacío"

        async def sin_ontologias(simbolos, terminos, cache):
            return []

        monkeypatch.setattr(T, "modelo_de_mundo_para", mundo_para)
        monkeypatch.setattr(ONTO, "normalizar", sin_ontologias)

        async def llamar(self, rol, programa, **kw):
            assert programa == "mundo"
            return SimpleNamespace(hechos=[SimpleNamespace(enunciado="Los autores excluyeron a cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP", tema="GFAP", tipo="hecho", prioridad=2, afirmaciones=[1], resuelve=[], sustituye=[indice[viejo["id"]], indice[existente["id"]]], contradice=[indice[otro["id"]], indice[viejo["id"]]], que_la_resolveria="")])

        monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway
        resumen = asyncio.run(PASOS.paso_modelo(ctx, _paso(al, "modelo")))
        assert "1 fundidos" in resumen and "1 hechos sustituidos" in resumen and "1 contradichos" in resumen, resumen
        hechos = {h["id"]: h for h in al.estado["hechos"]}
        assert hechos[viejo["id"]]["estado"] == "descartado" and hechos[viejo["id"]]["sustituidoPor"] == existente["id"]
        assert hechos[existente["id"]]["sustituyeA"] == [viejo["id"]], "no se sustituye a sí mismo"
        assert hechos[existente["id"]]["contradiceA"] == [otro["id"]], "un hecho sustituido no se cuenta también como contradicho"
        assert any(c.get("clasificacion") == "contrasta" for c in hechos[otro["id"]]["citas"])
        assert hechos[existente["id"]]["estado"] == "sabido" and "el enlace del cerebro pasa a este hecho: sustituye a 1 hechos, contradice a 1 hechos" in hechos[existente["id"]]["historial"][-1]["motivo"]
        assert len([h for h in al.estado["hechos"] if h["investigacionId"] == "inv"]) == 3, "la paráfrasis no nació como hecho nuevo"
    finally:
        al.cerrar()


def test_un_hecho_descartado_no_absorbe_ni_enlaza_nada(monkeypatch):
    al = _almacen(con_previa=False)
    try:
        ctx = _ctx(al)
        fid = PASOS._registrar_fuente(ctx, {"referencia": "Belder et al., 2026", "titulo": "Plasma biomarkers in autosomal dominant Alzheimer disease carriers", "doi": "10.1/belder", "tipos": [], "resumen": ""}, "articulo", [{"localizador": "pág. 2", "texto": "x " * 40, "encabezado": "T"}], 8, None, "limpio", 1, "q")
        descartado = P.nuevo_hecho("inv", "hecho", "GFAP", "Se excluyeron cuatro participantes no portadores antes del análisis de GFAP", "descartado", "fuente", [{"fuenteId": fid, "referencia": "Belder et al., 2026", "pagina": 2}], 1000, 3, "test", afirmacion_ids=[], citas=[])
        cuestion = CU.nueva("inv", "¿Cuántos no portadores se excluyeron?", {"tipo": "killer", "id": None}, "El recuento", 1000)
        afs = [{"id": "af-1", "texto": "t", "cita": "[Belder et al., 2026, pág. 2]", "fragmento": "x", "veredicto": "sostenida", "tipo": "dato", "fuenteId": fid, "localizador": "pág. 2", "iteracion": 1}]

        def fn(e):
            e["hechos"].append(descartado)
            CU.registrar(e, cuestion)
            next(c for c in e["corridas"] if c["id"] == "cor")["_afirmaciones"] = afs
            return True

        al.mutar(fn, "prueba")

        async def mundo_para(almacen, inv, consulta, maximo=60):
            return "Vacío"

        async def sin_ontologias(simbolos, terminos, cache):
            return []

        monkeypatch.setattr(T, "modelo_de_mundo_para", mundo_para)
        monkeypatch.setattr(ONTO, "normalizar", sin_ontologias)

        async def llamar(self, rol, programa, **kw):
            return SimpleNamespace(hechos=[SimpleNamespace(enunciado=descartado["enunciado"], tema="GFAP", tipo="hecho", prioridad=2, afirmaciones=[1], resuelve=[1], sustituye=[], contradice=[], que_la_resolveria="")])

        monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway
        resumen = asyncio.run(PASOS.paso_modelo(ctx, _paso(al, "modelo")))
        assert "0 hechos" in resumen and "fundidos" not in resumen
        assert CU.buscar(al.estado, cuestion["id"])["estado"] == "abierta", "un hecho descartado no resuelve nada"
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# Hallazgo 7. Patrones de resultado con criterio
# ---------------------------------------------------------------------------


def test_los_patrones_de_resultado_exigen_sigla_en_mayuscula_con_cifra_y_verbo_con_cifra_cerca():
    n = lambda t: len(PASOS._PATRONES_RESULTADO.findall(t))  # noqa: E731
    assert n("Amyloid or tau pathology may precede symptoms, or follow them, or both.") == 0
    assert n("These findings mean that astrocytes respond first; the median patient is old.") == 0
    assert n("HR 12 for progression") == 1 and n("HR 0.69 (95% CI 0.54 to 0.88)") == 2 and n("OR = 1.8") == 1 and n("(SD 20.3)") == 1 and n("RR: 0,73") == 1
    assert n("hr 0.69") == 0 and n("or 1.8") == 0, "en minúscula no es una sigla"
    assert n("mean difference 0.3 pg/mL") == 1 and n("median 4 years") == 1 and n("la media fue 3,2") == 1
    assert n("mean of the distribution. Then 4 people") == 0, "la cifra tiene que estar en la misma frase y cerca"
    # Lo que ya contaba sigue contando.
    assert n("p < 0.001, n = 859, Table 2, change from baseline") >= 4
    resultados = PASOS.puntuar_fragmento({"localizador": "pág. 9", "texto": "Table 2. HR 0.69 (95% CI 0.54 to 0.88), p < 0.001, n = 859 versus 875, mean difference 0.3."})
    prosa = PASOS.puntuar_fragmento({"localizador": "pág. 1", "texto": "Amyloid or tau pathology may precede symptoms, or follow them, or both; whether astrocytes or glial cells respond first is debated. " * 3})
    assert resultados[0] > prosa[0] and prosa[1] == "cifras 0, patrones de resultado 0", (resultados, prosa)


def test_una_fuente_de_esta_corrida_con_crossref_caido_se_reintenta_una_vez_por_iteracion_no_por_consulta(monkeypatch):
    from rosa.fuentes.base import FuenteNoDisponible

    al = _almacen(con_previa=False)
    try:
        articulo = _articulo("Nuevo, 2026", "Plasma GFAP after lecanemab in a fresh cohort of early Alzheimer disease", "10.1/nuevo")
        _busqueda_fija(monkeypatch, [articulo])
        _sin_descarga(monkeypatch)
        llamadas: list = []

        async def caido(doi):
            llamadas.append(doi)
            raise FuenteNoDisponible("Crossref: 503")

        monkeypatch.setattr(PASOS.crossref, "marca_editorial", caido)
        _modelo(monkeypatch, 8, [])
        ctx = _ctx(al)
        _correr(ctx)
        f = next(x for x in ctx.fuentes().values() if x["doi"] == "10.1/nuevo")
        assert llamadas == ["10.1/nuevo"] and f["retraccionComprobadaEn"] is None and "Crossref no respondió" in f["_marcaDetalle"]
        # Segunda y tercera consulta de la misma iteración: la fuente ya está aquí; Crossref no se repite.
        _correr(ctx, {"base": "europepmc", "consulta": "gfap AND apoe", "tema": "t", "modo": "foco"})
        _correr(ctx, {"base": "europepmc", "consulta": "gfap AND nfl", "tema": "t", "modo": "foco"})
        assert llamadas == ["10.1/nuevo"]
        # Siguiente iteración: se vuelve a preguntar, y si Crossref responde, la fuente queda comprobada.
        ctx2 = Ctx(al, ctx.programas, ctx.modelos, "cor", "inv", "it", 2)
        _crossref(monkeypatch, llamadas, marca=None, detalle="Sin retracción, ahora sí")
        _correr(ctx2)
        f = next(x for x in ctx2.fuentes().values() if x["doi"] == "10.1/nuevo")
        assert llamadas == ["10.1/nuevo", "10.1/nuevo"] and f["retraccionComprobadaEn"] is not None and f["_marcaDetalle"] == "Sin retracción, ahora sí"
        # Y ya comprobada, una consulta más no vuelve a preguntar.
        _correr(ctx2, {"base": "europepmc", "consulta": "gfap AND apoe", "tema": "t", "modo": "foco"})
        assert len(llamadas) == 2
    finally:
        al.cerrar()


def test_las_politicas_nuevas_salen_en_el_resumen_de_ajustes():
    r = politicas.resumen()
    assert r["maxForzadosPorNombre"] == politicas.MAX_FORZADOS_POR_NOMBRE == 12
    assert r["maxConsultasPorNombreSinRelevantes"] == politicas.MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES == 2
    assert r["diasVigenciaComprobacionRetraccion"] == politicas.DIAS_VIGENCIA_COMPROBACION_RETRACCION == 90
    assert r["maxPartesPorFragmento"] == politicas.MAX_PARTES_POR_FRAGMENTO == 3 and r["maxCaracteresPorLlamadaExtractor"] == politicas.MAX_CARACTERES_POR_LLAMADA_EXTRACTOR == 6000
