"""Las tres correcciones del 25 de septiembre de 2026, a raíz de lo que vio Emir en
el "En pocas palabras" de hip-mu30n7o9-4025: "dice cosas obvias", y "revisar los
ensayos publicados es LITERALMENTE tu trabajo, Rosa".

1. El resumen en pocas palabras se escribe con lo que ROSA2018 ya investigó, y se
   reescribe cuando eso cambia. Antes lo escribía Sonnet una sola vez al nacer la
   hipótesis, viendo solo el enunciado.
2. Si la prueba es revisar lo ya publicado, ROSA2018 se la apunta a sí misma en la
   cola de trabajo en vez de pasársela a "los investigadores".
3. Antes de dar por buena una prueba que nombra ensayos, ROSA2018 lee sus criterios
   de exclusión en ClinicalTrials.gov: CLARITY AD excluyó a quien tenía "severe
   small vessel, or white matter disease", así que no puede comparar poco daño
   vascular con mucho.

Sin red ni modelos: el registro de ensayos y el juez van con dobles."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from rosa import killer as K
from rosa import politicas
from rosa import tareas as TA
from rosa import viabilidad as VIA
from rosa.bucle import contexto as T
from rosa.fuentes.base import FuenteNoDisponible

# La prueba real de hip-mu30n7o9-4025, recortada.
DISENO_ESCRITORIO = "Revisión sistemática y análisis de resultados agregados, sin acceder a datos individuales. Formular y registrar la hipótesis antes de extraer los resultados terapéuticos."
COHORTE = "Brazos y estratos agregados publicados de ensayos aleatorizados en Alzheimer esporádico. Conjunto externo candidato: evoke, evoke+, el ensayo de posdinemab, INVOKE-2 y los ensayos de lecanemab y donanemab."
# Un trozo literal de los criterios de CLARITY AD en ClinicalTrials.gov (NCT03887455).
CRITERIOS_CLARITY = (
    "Inclusion Criteria:\n* Mild cognitive impairment due to Alzheimer's disease\n\n"
    "Exclusion Criteria:\n* Any contraindications to MRI scanning\n"
    "* Results of screening MRI scan showing evidence of multiple lacunar infarcts or stroke involving a major vascular territory, severe small vessel, or white matter disease\n"
    "* More than 4 microhemorrhages (defined as 10 millimeter or less at the greatest diameter)\n" + "* Otro criterio largo para que el registro no sea un resumen.\n" * 40
)
# El registro de TRAILBLAZER-ALZ 2 solo trae un resumen de 519 caracteres.
CRITERIOS_RESUMIDOS = "Exclusion Criteria:\n* Significant neurological disease affecting the central nervous system"


def _h(**campos: Any) -> dict[str, Any]:
    h: dict[str, Any] = {
        "id": "hip-vascular",
        "investigacionId": "inv",
        "titulo": "La carga vascular cerebral basal limita el valor clínico de una reducción de P-tau181",
        "enunciado": "Con una misma bajada de P-tau181, la ralentización del deterioro será mayor en estratos con menor carga vascular cerebral basal que en estratos con mayor carga.",
        "mecanismo": "Parte del deterioro corre por vía vascular, al margen del proceso que representa P-tau181.",
        "comprobacion": {"biomarcador": "Cambio de P-tau181 frente a placebo; hiperintensidades de sustancia blanca por estrato", "cohorte": COHORTE, "diseno": DISENO_ESCRITORIO},
        "estado": "propuesta",
        "elo": 1532,
        "decisionKiller": "suspender",
        "afirmaciones": [{"veredicto": "sostenida", "texto": "x", "cita": "c"}],
        "procedencia": {"fuentes": [], "registro": []},
        "novedad": {},
        "relevancia": {"justificacion": "Separar el efecto sobre el marcador del beneficio para la persona"},
    }
    h.update(campos)
    return h


def _estado(*hs: dict[str, Any], **extra: Any) -> dict[str, Any]:
    e: dict[str, Any] = {"hipotesis": list(hs), "tareas": [], "lecciones": [], "decisiones": [], "investigaciones": [{"id": "inv", "datasets": []}]}
    e.update(extra)
    return e


class CtxFalso:
    """Lo mínimo de `Ctx` que usa `viabilidad.asegurar`: mutar el estado y llamar al
    juez, que aquí devuelve lo que diga el test o lanza lo que diga el test."""

    def __init__(self, e: dict[str, Any], respuesta: Any = None, excepcion: BaseException | None = None):
        self.e = e
        self.respuesta = respuesta
        self.excepcion = excepcion
        self.llamadas: list[tuple[str, str, dict[str, Any]]] = []
        self.programas = SimpleNamespace(viabilidad="viabilidad")
        self.modelos = SimpleNamespace(juez=SimpleNamespace(model="sim-juez"))

    def mutar(self, fn: Any, motivo: str) -> None:
        fn(self.e)

    async def llamar(self, rol: str, programa: str, **kw: Any) -> Any:
        self.llamadas.append((rol, programa, kw))
        if self.excepcion is not None:
            raise self.excepcion
        return self.respuesta


def _juez(veredicto: str, criterio: str = "severe small vessel, or white matter disease", nct: str = "NCT03887455", alternativa: str = "Cohortes observacionales con resonancia") -> Any:
    return SimpleNamespace(viabilidad=SimpleNamespace(veredicto=veredicto, grupo_necesario="personas con mucha carga vascular cerebral", exclusiones=[SimpleNamespace(nct=nct, criterio=criterio)] if criterio else [], explicacion="Los ensayos excluyeron justo a ese grupo.", alternativa=alternativa))


@pytest.fixture
def registro(monkeypatch):
    """El registro de ensayos, falso: lecanemab devuelve CLARITY AD; donanemab, el
    resumen corto de TRAILBLAZER-ALZ 2; el resto, nada."""
    pedidos: list[str] = []

    async def ensayos_de(termino: str) -> list[dict[str, Any]]:
        pedidos.append(termino)
        if termino == "lecanemab":
            return [{"nct": "NCT03887455", "titulo": "A Study to Confirm Safety and Efficacy of Lecanemab", "acronimo": "Clarity AD", "fases": ["PHASE3"], "participantes": 1906, "criterios": CRITERIOS_CLARITY}]
        if termino == "donanemab":
            return [{"nct": "NCT04437511", "titulo": "A Study of Donanemab", "acronimo": "", "fases": ["PHASE3"], "participantes": 1736, "criterios": CRITERIOS_RESUMIDOS}]
        return []

    monkeypatch.setattr(VIA, "_ensayos_de", ensayos_de)
    return pedidos


# -- 3. ¿Se puede hacer la prueba? --------------------------------------------------


def test_distingue_revisar_lo_publicado_de_un_estudio_con_pacientes():
    assert VIA.es_trabajo_de_escritorio(DISENO_ESCRITORIO)
    assert VIA.es_trabajo_de_escritorio("Revisión metodológica y síntesis de estimaciones agregadas publicadas.")
    assert VIA.es_trabajo_de_escritorio("Registrar la hipótesis antes de extraer los resultados de estos ensayos; ninguno aporta resultados.")
    # Datos o muestras de pacientes, o un ensayo nuevo: no es trabajo de escritorio.
    for otro in ("Análisis longitudinal de datos y muestras existentes, con protocolo fijado.", "Estudio longitudinal de plasma archivado, con análisis ciego.", "Ensayo conceptual aleatorizado y doble ciego con tres estrategias.", "Protocolo conceptual: ensayo doble ciego de semaglutida oral frente a placebo."):
        assert not VIA.es_trabajo_de_escritorio(otro), otro
    assert not VIA.es_trabajo_de_escritorio(None)


def test_saca_los_farmacos_los_codigos_los_acronimos_y_los_nct_que_nombra_la_prueba():
    farmacos, ncts = VIA.intervenciones_nombradas(_h())
    assert farmacos == ["posdinemab", "lecanemab", "donanemab", "semaglutide", "AL002"], "evoke se busca como semaglutida e INVOKE-2 como AL002"
    h = _h(comprobacion={"biomarcador": "", "cohorte": "semaglutida oral en NCT04777396 y la serie GSE12345", "diseno": DISENO_ESCRITORIO})
    farmacos, ncts = VIA.intervenciones_nombradas(h)
    assert "semaglutide" in farmacos and ncts == ["NCT04777396"] and not any(x.startswith("GSE") for x in farmacos)
    # Un verbo corriente no es un ensayo.
    assert VIA.intervenciones_nombradas(_h(enunciado="el efecto que emerge de la carga", comprobacion={"biomarcador": "", "cohorte": "", "diseno": DISENO_ESCRITORIO})) == ([], [])


def test_la_prueba_vascular_sale_inviable_con_el_criterio_literal_de_clarity_ad(registro):
    h = _h()
    e = _estado(h)
    ctx = CtxFalso(e, _juez("inviable"))
    r = asyncio.run(VIA.asegurar(ctx, h, pedir_revision=True))
    assert r["estado"] == "inviable"
    assert r["exclusiones"] == [{"nct": "NCT03887455", "titulo": "Clarity AD", "criterio": "severe small vessel, or white matter disease"}]
    assert [x["nct"] for x in r["ensayos"]] == ["NCT03887455", "NCT04437511"]
    # Al juez le llega la parte de exclusión y el aviso del registro resumido.
    _, _, kw = ctx.llamadas[0]
    assert "white matter disease" in kw["ensayos"] and "es un resumen" in kw["ensayos"]
    assert ctx.llamadas[0][0] == "juez"
    # Quedó guardada con su huella, y como el Killer ya la había juzgado sin saberlo,
    # se le pide que vuelva a juzgar.
    assert e["hipotesis"][0]["viabilidad"]["huella"] == VIA.huella(h) and e["hipotesis"][0]["_revisionPedida"] is True


def test_una_cita_que_no_esta_en_el_registro_no_sostiene_un_inviable(registro):
    """La regla de las citas de ROSA2018, aplicada al registro: si el juez parafrasea o
    inventa el criterio, no cuenta."""
    h = _h()
    e = _estado(h)
    r = asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable", criterio="excluded patients with high vascular burden")), h))
    assert r["estado"] == "no_comprobable" and r["exclusiones"] == [] and "no cuenta" in r["explicacion"]


def test_un_registro_resumido_no_prueba_que_el_grupo_estuviera_incluido(registro):
    h = _h(comprobacion={"biomarcador": "", "cohorte": "los ensayos de donanemab", "diseno": DISENO_ESCRITORIO})
    r = asyncio.run(VIA.asegurar(CtxFalso(_estado(h), _juez("viable", criterio="")), h))
    assert r["estado"] == "no_comprobable" and "resumen" in r["explicacion"]


def test_un_registro_que_no_responde_es_no_pude_comprobar_y_se_reintenta(monkeypatch):
    async def caido(termino: str) -> list[dict[str, Any]]:
        raise FuenteNoDisponible("ClinicalTrials.gov: 503")

    monkeypatch.setattr(VIA, "_ensayos_de", caido)
    h = _h()
    e = _estado(h)
    ctx = CtxFalso(e, _juez("inviable"))
    r = asyncio.run(VIA.asegurar(ctx, h))
    assert r["estado"] == "no_comprobable" and "No es que no haya ensayos" in r["explicacion"]
    assert ctx.llamadas == [], "sin criterios no se le pregunta nada al juez"
    guardada = e["hipotesis"][0]
    assert not VIA.necesita(guardada, ahora_ms=r["fecha"] + 1000), "no se reintenta en cada tic"
    assert VIA.necesita(guardada, ahora_ms=r["reintentarDespues"] + 1), "se reintenta pasado el plazo"


def test_sin_farmacos_ni_ensayos_nombrados_no_se_llama_al_juez():
    h = _h(comprobacion={"biomarcador": "GFAP", "cohorte": "estudios observacionales publicados", "diseno": DISENO_ESCRITORIO})
    ctx = CtxFalso(_estado(h), _juez("inviable"))
    r = asyncio.run(VIA.asegurar(ctx, h))
    assert r["estado"] == "sin_ensayos_nombrados" and ctx.llamadas == []


def test_sin_presupuesto_no_se_marca_y_se_puede_repetir(registro):
    from rosa.bucle.pasos import PresupuestoAgotado

    h = _h()
    e = _estado(h)
    with pytest.raises(PresupuestoAgotado):
        asyncio.run(VIA.asegurar(CtxFalso(e, excepcion=PresupuestoAgotado("sin tope")), h))
    assert "_viabilidadIntentada" not in e["hipotesis"][0] and VIA.necesita(e["hipotesis"][0]), "cuando vuelva el presupuesto se hace"


def test_un_fallo_raro_del_juez_no_se_repite_en_cada_tic(registro):
    h = _h()
    e = _estado(h)
    assert asyncio.run(VIA.asegurar(CtxFalso(e, excepcion=RuntimeError("respuesta rota")), h)) is None
    assert not VIA.necesita(e["hipotesis"][0]), "queda marcada para esta versión de la prueba"
    # Y si la prueba cambia (una reformulación), se comprueba otra vez.
    e["hipotesis"][0]["comprobacion"] = {**h["comprobacion"], "cohorte": "otra cohorte con lecanemab"}
    assert VIA.necesita(e["hipotesis"][0])


def test_un_estudio_con_pacientes_no_se_comprueba_aqui():
    h = _h(comprobacion={"biomarcador": "", "cohorte": "ADNI con lecanemab", "diseno": "Estudio longitudinal de plasma archivado."})
    assert not VIA.necesita(h)


# -- La viabilidad entra en el Killer como `factibilidad` --------------------------


def test_una_prueba_inviable_manda_a_reformular_y_gana_al_juez_de_memoria(registro):
    h = _h()
    e = _estado(h)
    asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable")), h))
    h = e["hipotesis"][0]
    deterministas = K.comprobaciones_deterministas(h, e)
    fact = [c for c in deterministas if c["comprobacion"] == "factibilidad"]
    assert len(fact) == 1 and fact[0]["resultado"] == "falla" and "NCT03887455" in fact[0]["detalle"] and "white matter" in fact[0]["detalle"]
    # Las de regla mandan: un juez que dijera "pasa" de memoria no la tapa.
    fusion = K.fusionar(deterministas, [{"comprobacion": "factibilidad", "resultado": "pasa", "detalle": "parece viable"}])
    assert next(c for c in fusion if c["comprobacion"] == "factibilidad")["resultado"] == "falla"
    decision, motivo = K.decidir(fusion, True, 1)
    assert decision == "reformular" and "factibilidad" in motivo


def test_una_viabilidad_de_otra_version_de_la_prueba_no_cuenta(registro):
    h = _h()
    e = _estado(h)
    asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable")), h))
    h = {**e["hipotesis"][0], "comprobacion": {**h["comprobacion"], "diseno": "Revisión sistemática de otra cosa distinta."}}
    assert VIA.comprobacion_factibilidad(h) is None


# -- 2. ROSA2018 se apunta la revisión a sí misma -----------------------------------


def test_una_prueba_de_escritorio_abre_una_tarea_para_rosa2018():
    h = _h()
    t = TA.por_regla_de_hipotesis(_estado(h), h, 9, 1000)
    assert t is not None and t["hipotesisId"] == "hip-vascular" and t["herramienta"] == "literatura"
    assert "todavía no lo ha revisado" in t["queVio"] and "lecanemab" in t["queHaria"] and "semaglutide" in t["queHaria"]


def test_no_se_abre_para_un_estudio_nuevo_ni_para_una_prueba_ya_inviable(registro):
    assert TA.por_regla_de_hipotesis(_estado(), _h(comprobacion={"biomarcador": "", "cohorte": "", "diseno": "Estudio longitudinal de plasma archivado."}), 9, 1000) is None
    h = _h()
    e = _estado(h)
    asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable")), h))
    assert TA.por_regla_de_hipotesis(e, e["hipotesis"][0], 9, 1000) is None, "revisar unos datos que no existen es gastar en vacío"


def test_no_se_vuelve_a_abrir_ni_aunque_una_persona_la_rechazara():
    h = _h()
    e = _estado(h)
    assert TA.registrar_de_escritorio(e, "inv", 9, 1000) == 1
    TA.marcar(e, e["tareas"][0]["id"], "rechazada", "Emir: ya lo revisamos a mano", 2000)
    assert TA.registrar_de_escritorio(e, "inv", 10, 3000) == 0 and len(e["tareas"]) == 1


def test_dos_hipotesis_distintas_con_la_misma_plantilla_no_se_funden():
    """El triaje funde tareas que dicen lo mismo; las que abre una regla salen de la
    misma plantilla y el solape de palabras las habría fundido."""
    a, b = _h(id="h-a", titulo="Primera hipótesis sobre P-tau181"), _h(id="h-b", titulo="Segunda hipótesis sobre P-tau181")
    e = _estado(a, b)
    assert TA.registrar_de_escritorio(e, "inv", 9, 1000) == 2
    assert {t["hipotesisId"] for t in e["tareas"]} == {"h-a", "h-b"}


def test_la_cola_no_rechaza_en_falso_las_que_no_caben():
    """Con más hipótesis de escritorio que sitio, las que no caben no se escriben:
    si entraran para ser rechazadas por la cola llena, quedarían rechazadas para
    siempre."""
    hs = [_h(id=f"h-{i}", titulo=f"Hipótesis {i} sobre un marcador distinto M{i}", elo=1400 + i * 10) for i in range(5)]
    e = _estado(*hs)
    n = TA.registrar_de_escritorio(e, "inv", 9, 1000)
    assert n == politicas.MAX_TAREAS_ACEPTADAS_POR_ITERACION
    assert len(e["tareas"]) == n and all(t["estado"] == "aceptada" for t in e["tareas"]), "ninguna rechazada por falta de sitio"
    assert [t["hipotesisId"] for t in e["tareas"]] == ["h-4", "h-3", "h-2"], "las de más Elo primero"
    # En el cierre siguiente, con el tope de la iteración gastado por otras, no entra nada.
    assert TA.registrar_de_escritorio(e, "inv", 9, 2000, aceptadas_ya=politicas.MAX_TAREAS_ACEPTADAS_POR_ITERACION) == 0


# -- 1. El resumen en pocas palabras --------------------------------------------------


def test_la_prueba_dice_quien_la_hace():
    assert "La hace ROSA2018" in T.prueba_de(_h())
    assert "Lo hace un laboratorio" in T.prueba_de(_h(comprobacion={"biomarcador": "", "cohorte": "", "diseno": "Estudio longitudinal de plasma archivado."}))


def test_lo_que_ve_el_cerebro_incluye_lo_que_rosa2018_ya_encontro(registro):
    h = _h(conclusion={"certeza": "muy_baja", "direccion": "apoya", "conclusion": "Ninguna de las fuentes reunidas compara estratos vasculares dentro de un ensayo.", "base": {"sostenidas": 13, "fuentes": 8}, "aFavor": ["a"], "enContra": ["b", "c"], "loMasFragil": "Que los ensayos publiquen la carga vascular por estrato", "noComprobado": [], "huella": "h1"})
    e = _estado(h, decisiones=[{"hipotesisId": "hip-vascular", "etapa": "killer", "decision": "suspender", "motivo": "Hace falta más evidencia", "fecha": 5}])
    asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable")), h))
    TA.registrar_de_escritorio(e, "inv", 9, 1000)
    texto = T.lo_que_encontro(e, e["hipotesis"][0])
    for esperado in ("certeza muy_baja", "ninguna de las fuentes reunidas compara estratos vasculares", "13 afirmaciones sostenidas de 8 fuentes", "decidió «suspender»", "ClinicalTrials.gov", "white matter disease", "Alternativa"):
        assert esperado.lower() in texto.lower(), esperado


def test_la_huella_del_resumen_cambia_con_lo_que_importa_y_solo_con_eso(registro):
    h = _h(conclusion={"huella": "h1", "conclusion": "x"})
    e = _estado(h)
    base = T.huella_llano(e, h)
    assert T.huella_llano(e, dict(h, elo=1600)) == base, "un partido del torneo no reescribe el resumen"
    assert T.huella_llano(e, dict(h, conclusion={"huella": "h2", "conclusion": "y"})) != base
    assert T.huella_llano(e, dict(h, decisionKiller="reformular")) != base
    asyncio.run(VIA.asegurar(CtxFalso(e, _juez("inviable")), h))
    assert T.huella_llano(e, e["hipotesis"][0]) != base, "la viabilidad cambia lo que hay que contar"


def test_el_resumen_lo_escribe_el_cerebro_con_lo_encontrado_y_uno_viejo_no_se_pierde(monkeypatch):
    from rosa.bucle.pasos import Ctx
    from rosa.tests.test_integracion_corrida import _preparar, _supervisor

    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    vistas: list[tuple[str, dict[str, Any]]] = []

    async def llamar(self, rol, programa, **kw):
        vistas.append((rol, kw))
        return SimpleNamespace(explicacion="Con la misma bajada de P-tau181, mejora más quien tiene poco daño vascular.")

    monkeypatch.setattr(Ctx, "llamar", llamar)
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    asyncio.run(sup._hipotesis_en_llano(ctx, h))
    assert vistas[0][0] == "cerebro", "decidir qué es lo nuevo de una idea es juicio: no lo hace Sonnet"
    assert {"prueba", "lo_que_encontro"} <= set(vistas[0][1])
    h = next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])
    assert h["enLlano"].startswith("Con la misma bajada") and h["_enLlanoIntentado"] == T.huella_llano(al.estado, h)

    async def roto(self, rol, programa, **kw):
        raise RuntimeError("respuesta rota")

    monkeypatch.setattr(Ctx, "llamar", roto)
    asyncio.run(sup._hipotesis_en_llano(ctx, h))
    assert next(x for x in al.estado["hipotesis"] if x["id"] == ids["hip"])["enLlano"].startswith("Con la misma bajada"), "si el cerebro falla, se conserva el resumen anterior"


def test_la_firma_del_resumen_prohibe_lo_que_emir_encontro():
    """Lo que se le pide al cerebro, por escrito: no es un test de lo que escribe,
    pero si alguien suaviza la instrucción, este test lo dice."""
    from rosa.modulos.firmas import HipotesisEnLlano

    doc = " ".join((HipotesisEnLlano.__doc__ or "").split())
    assert "NO presentar como si fuera la idea lo que es el objetivo general del campo" in doc
    assert 'NUNCA "los investigadores revisarían"' in doc
    assert "LO QUE ROSA2018 YA COMPROBÓ" in doc
