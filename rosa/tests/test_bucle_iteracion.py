"""Test de punta a punta del bucle (revisión del 17 de septiembre de 2026, S-25).

Hasta hoy ningún test recorría el camino real: `Supervisor.correr_corrida`
-> `_ejecutar_paso` -> los ejecutores de `rosa/bucle/pasos.py` ->
`_cerrar_iteracion`. Cada regresión del bucle se descubría pagando una corrida.
Este arnés corre UNA iteración completa con un plan de siete pasos (literatura,
literatura, extracción, verificación, modelo, hipótesis, novedad) con:

- Modelos simulados: `Ctx.llamar` responde por nombre de programa. El objeto
  `programas` lleva TODOS los nombres reales de `rosa.modulos.firmas.Programas`,
  así que un paso que use un programa sin respuesta simulada queda anotado en
  `faltantes` y el test lo dice en voz alta (es lo que pasó con `relevancia` en
  S-02: el arnés antiguo tenía 11 nombres de 38 y el paso tragaba el
  AttributeError).
- El contador real (`rosa.modulos.contador.Contador`) cuenta cada llamada
  simulada con un `usage` que trae `cost`, como el AI Gateway: así el gasto, el
  presupuesto de la iteración y el corte por tope son los de verdad.
- Fuentes falsas para Europe PMC, Crossref, Unpaywall, PDF, Exa, OpenAlex,
  ClinicalTrials.gov, Open Targets y los conectores (MyGene, GEO, CELLxGENE...).
  Cuatro fuentes con los cuatro tipos de localizador: sección (XML de Europe
  PMC), pág. N (PDF), resumen y texto web, parte N (Exa). El helper HTTP de
  `rosa.fuentes.base` se sustituye por uno que falla: nada sale a la red.

Lo que se afirma sobre el estado final está repartido en tests pequeños con
nombre propio, sobre una sola corrida compartida (fixture de módulo). Si el
arnés destapa un fallo de integración entre grupos, el test queda marcado
xfail(strict=True) con el motivo y el fallo va a pendientes; no se arregla aquí.
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import dspy
import dspy.clients.base_lm
import httpx
import pytest

from rosa import conectores as CON
from rosa import agentes_tratamiento as AT
from rosa import lecciones as LEC
from rosa import ontologias as ONTO
from rosa import sesgo as SESGO
from rosa import verificador as V
from rosa import killer as K
from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.fuentes import base as FB
from rosa.fuentes import clinicaltrials, crossref, europepmc, exa, openalex, opentargets, patentes_tratamiento, pdf, programas_clinicos, unpaywall
from rosa.fuentes.base import FuenteNoDisponible
from rosa.modulos import contador as CT
from rosa.modulos.contador import ContextoLlamada, PresupuestoAgotado, contexto_actual
from rosa.modulos.firmas import Consulta, Programas
from rosa.tests.test_integracion_corrida import _pred_conclusion, _pred_llano, _preparar
from rosa.tests.test_integracion_pasos import consultar_falso

ESTADO_REAL = Path("/private/tmp/claude-502/-Users-emirmalek-traspaso-alzheimer-agente/75fbc617-6a69-4c07-8e51-f2a1f337f4df/scratchpad/estado_ahora.json")

# Lo que "factura" el gateway por cada llamada simulada (usage.cost).
COSTE_GATEWAY = 0.0123

PLAN_SIETE = (
    ("Buscar literatura", "literatura"),
    ("Buscar literatura, segunda pasada", "literatura"),
    ("Extraer afirmaciones con procedencia", "extraccion"),
    ("Verificar cada afirmación", "verificacion"),
    ("Actualizar el modelo de mundo", "modelo"),
    ("Generar y revisar hipótesis", "hipotesis"),
    ("Comprobar novedad", "novedad"),
)

# ---------------------------------------------------------------------------
# Fuentes falsas: cuatro artículos, cuatro tipos de localizador
# ---------------------------------------------------------------------------

# A: XML de Europe PMC -> "sección Results".
SECCION_A = (
    "In APOE4 carriers with amyloid positivity, plasma GFAP increased 2.1-fold (95% CI 1.6 to 2.8) before NfL changed, "
    "n = 312 versus 298 controls in the BioFINDER cohort. GFAP rose earlier than NfL in every age stratum studied."
)
# B: PDF -> "pág. 3" y "pág. 4".
PAGINAS_B = {
    3: (
        "Plasma NfL rose after GFAP in the Knight ADRC cohort: the median lag was 2.4 years (interquartile range 1.1 to 3.9) "
        "across 184 participants with confirmed amyloid positivity. Astrocyte reactivity preceded axonal injury markers in this sample."
    ),
    4: (
        "Sensitivity analyses excluding participants with vascular lesions gave the same ordering of GFAP and NfL changes. "
        "The effect did not depend on the assay platform used, and the ordering held in both sexes."
    ),
}
# C: solo resumen -> "resumen".
RESUMEN_C = (
    "Background: plasma glial fibrillary acidic protein tracks astrocyte reactivity. Methods: 256 participants from the AIBL cohort. "
    "Results: GFAP was elevated in amyloid positive participants 1.8-fold relative to amyloid negative participants; NfL did not differ at baseline."
)
# D: página web por Exa -> "texto web, parte 1".
WEB_D = (
    "Serum GFAP separated amyloid positive from amyloid negative participants with an area under the curve of 0.81 in the WRAP cohort (n = 402), "
    "while NfL reached 0.62. GFAP changes were detectable four years before NfL changes in the same participants, across all APOE genotypes."
)

ART_A = {"referencia": "Kim et al., 2025", "titulo": "Plasma GFAP precedes NfL in APOE4 carriers", "doi": "10.1000/gfap.2025", "pmid": "40000001", "pmcid": "PMC9999999", "resumen": "Plasma GFAP rose before NfL in APOE4 carriers with amyloid positivity from the BioFINDER cohort, n = 312.", "anio": 2025, "autores": ["Kim", "Park"], "tipos": ["Journal Article"], "url": "https://doi.org/10.1000/gfap.2025", "preprint": False}
ART_B = {"referencia": "Lee et al., 2024", "titulo": "A longitudinal cohort study of plasma NfL after GFAP in Knight ADRC", "doi": "10.1000/nfl.2024", "pmid": "40000002", "pdf": "https://example.org/lee2024.pdf", "resumen": "Longitudinal plasma NfL and GFAP in 184 Knight ADRC participants with amyloid positivity over six years.", "anio": 2024, "autores": ["Lee"], "tipos": ["Journal Article"], "url": "https://doi.org/10.1000/nfl.2024", "preprint": False}
ART_C = {"referencia": "Sin autor (aibl.csiro.au), 2023", "titulo": "AIBL data note on plasma GFAP and NfL", "doi": None, "pmid": None, "resumen": RESUMEN_C, "anio": 2023, "autores": [], "tipos": [], "url": None, "preprint": False}
# D se llama igual que A a propósito: el registro tiene que desambiguar la referencia (S-04).
ART_D = {"referencia": "Kim et al., 2025", "titulo": "Serum GFAP and NfL trajectories in WRAP", "doi": None, "pmid": None, "resumen": "Serum GFAP and NfL trajectories in the WRAP cohort, 402 participants followed for a decade.", "anio": 2025, "autores": ["Kim"], "tipos": [], "url": "https://example.org/kim2025-wrap", "preprint": False}
ARTICULOS = (ART_A, ART_B, ART_C, ART_D)

# Lo que el extractor simulado devuelve por localizador: (texto, fragmento literal, tipo, cohorte, veredicto esperado).
EXTRACCION: dict[str, list[dict[str, str]]] = {
    "sección Results": [
        {"texto": "En portadores de APOE4 con amiloide positivo, el GFAP en plasma sube antes que el NfL (cohorte BioFINDER)", "fragmento": "plasma GFAP increased 2.1-fold (95% CI 1.6 to 2.8) before NfL changed", "tipo": "dato", "cohorte": "BioFINDER", "n": "312 vs 298", "comparador": "controles", "efecto": "2,1 veces", "esperado": "sostenida"},
        # Pasaje inventado: no está en la sección. El verificador determinista lo tiene que parar sin gastar juez.
        {"texto": "El GFAP en plasma triplica su valor en la cohorte BioFINDER", "fragmento": "plasma GFAP tripled its value in BioFINDER carriers", "tipo": "dato", "cohorte": "BioFINDER", "n": "312", "comparador": "controles", "efecto": "3 veces", "esperado": "cita_no_resuelve"},
    ],
    "pág. 3": [
        {"texto": "El NfL en plasma sube después que el GFAP en la cohorte Knight ADRC, con un retraso mediano de 2,4 años", "fragmento": "Plasma NfL rose after GFAP in the Knight ADRC cohort: the median lag was 2.4 years", "tipo": "dato", "cohorte": "Knight ADRC", "n": "184", "comparador": "sin comparador", "efecto": "2,4 años", "esperado": "sostenida"},
        # Pasaje literal pero la afirmación dice lo contrario: la para el juez, no el determinista.
        {"texto": "El NfL sube antes que el GFAP en la cohorte Knight ADRC", "fragmento": "Plasma NfL rose after GFAP in the Knight ADRC cohort", "tipo": "literatura", "cohorte": "Knight ADRC", "esperado": "no_sostenida"},
    ],
    "pág. 4": [
        {"texto": "El orden de cambio de GFAP y NfL no depende de la plataforma de medida", "fragmento": "The effect did not depend on the assay platform used", "tipo": "literatura", "cohorte": "Knight ADRC", "esperado": "sostenida"},
    ],
    "resumen": [
        {"texto": "En la cohorte AIBL, el GFAP estaba elevado en participantes amiloide positivos y el NfL no difería al inicio", "fragmento": "GFAP was elevated in amyloid positive participants 1.8-fold relative to amyloid negative participants; NfL did not differ at baseline", "tipo": "dato", "cohorte": "AIBL", "n": "256", "comparador": "amiloide negativos", "efecto": "1,8 veces", "esperado": "sostenida"},
    ],
    "texto web, parte 1": [
        {"texto": "En la cohorte WRAP, el GFAP en suero distingue amiloide positivos de negativos mejor que el NfL", "fragmento": "Serum GFAP separated amyloid positive from amyloid negative participants with an area under the curve of 0.81 in the WRAP cohort", "tipo": "dato", "cohorte": "WRAP", "n": "402", "comparador": "amiloide negativos", "efecto": "AUC 0,81", "esperado": "sostenida"},
    ],
}
LOCALIZADORES_ESPERADOS = {"sección Results", "pág. 3", "pág. 4", "resumen", "texto web, parte 1"}

TITULO_NUEVA = "La reactividad astrocitaria medida por GFAP precede al daño axonal medido por NfL"
ENUNCIADO_HECHO = "En personas con amiloide positivo, el GFAP en plasma se altera antes que el NfL en cuatro cohortes independientes"

# Intervención y documentos inventados exclusivamente para recorrer los dos
# especialistas. No son datos científicos ni patentes o programas reales.
TRATAMIENTO_FALSO = "ROSA-AB-001"
PATENTE_TRATAMIENTO = {
    "id": "patente-simulada-ab001", "titulo": "Patente simulada sobre ROSA-AB-001",
    "url": "https://example.org/patentes/ab001", "fuente": "Registro de patentes simulado",
    "texto": "La formulación experimental ROSA-AB-001 se propone para reducir la reactividad astrocitaria.",
    "datos": {"patent_number": "TEST-AB001"},
}
ENSAYO_TRATAMIENTO = {
    "nct": "NCT00000001", "url": "https://clinicaltrials.gov/study/NCT00000001",
    "titulo": "Ensayo simulado de ROSA-AB-001 con biomarcadores GFAP y NfL",
    "patrocinador": {"nombre": "Compañía simulada para el test", "clase": "INDUSTRY"},
    "colaboradores": [], "estado": "TERMINATED", "hasResults": False,
    "whyStopped": "Decisión empresarial, sin resultado de eficacia registrado",
    "fases": ["PHASE2"], "condiciones": ["Alzheimer"],
    "intervenciones": [{"nombre": TRATAMIENTO_FALSO, "tipo": "DRUG", "otrosNombres": [], "descripcion": "Intervención simulada"}],
    "fechas": {"inicio": {"fecha": "2025-01-01", "tipo": "ACTUAL"}},
}

IDS_GFAP = {"simbolo": "GFAP", "nombre": "glial fibrillary acidic protein", "ensembl": "ENSG00000131095", "uniprot": "P14136", "entrez": "2670"}
IDS_AGORA = {"GFAP": IDS_GFAP["ensembl"], "APOE": "ENSG00000130203", "NEFL": "ENSG00000104760"}
RESPUESTAS_CONECTORES: dict[str, Any] = {
    "mygene_gen": IDS_GFAP,
    # GEO responde con una serie; CELLxGENE y el resto no responden: "no pude comprobar", nunca "no hay".
    "geo_series": {"total": 1, "series": [{"accession": "GSE999001", "titulo": "Plasma GFAP in preclinical Alzheimer", "n_muestras": 24, "plataforma": "GPL570"}]},
}


def _fuentes_falsas(mp: pytest.MonkeyPatch, registro: dict[str, list[Any]]) -> None:
    """Sustituye cada fuente externa por una respuesta fija y anota las consultas."""

    async def sin_red(*a: Any, **k: Any) -> Any:
        registro["red"].append((a, k))
        raise FuenteNoDisponible("sin red en el test: una fuente sin simular llegó al helper HTTP")

    def sin_http(*a: Any, **k: Any) -> Any:
        registro["red"].append((a, k))
        raise AssertionError("Una fuente sin simular intentó acceder a HTTP en este arnés")

    mp.setattr(FB, "pedir", sin_red)
    mp.setattr(httpx.AsyncClient, "send", sin_http)
    mp.setattr(httpx.Client, "send", sin_http)

    async def ep_buscar(consulta: str, maximo: int = 10, solo_preprints: bool = False, desde_anio: int | None = None):
        registro["europepmc"].append(consulta)
        return [copy.deepcopy(a) for a in ARTICULOS], len(ARTICULOS)

    async def ep_texto(pmcid: str):
        registro["europepmc_texto"].append(pmcid)
        return [{"seccion": "Results", "texto": SECCION_A}] if pmcid == ART_A["pmcid"] else []

    async def cr_marca(doi: str):
        registro["crossref"].append(doi)
        return None, "Sin retracción en Crossref"

    async def up_pdf(doi: str):
        return None

    async def pdf_descargar(url: str):
        registro["pdf"].append(url)
        return Path(tempfile.gettempdir()) / "rosa-test-lee2024-no-existe.pdf" if url == ART_B["pdf"] else None

    def pdf_paginas(ruta: Path):
        return [{"pagina": n, "texto": t} for n, t in sorted(PAGINAS_B.items())]

    def pdf_en_pagina(ruta: Path, fragmento: str, pagina: int) -> bool:
        return pdf.fragmento_en_texto_de_pagina(PAGINAS_B.get(pagina, ""), fragmento)

    async def exa_buscar(texto: str, maximo: int = 10, **kw: Any):
        registro["exa"].append(texto)
        return [], 0, 0.0

    async def exa_contenidos(urls: list[str], maximo_caracteres: int = 20000):
        registro["exa_contenidos"].extend(urls)
        return ([{"url": urls[0], "texto": WEB_D}] if urls and urls[0] == ART_D["url"] else []), 0.0005

    async def oa_buscar(texto: str, maximo: int = 25, desde_anio: int | None = None):
        registro["openalex"].append(texto)
        return [], 0, 0.0

    async def ct_buscar(condicion: str, termino: str = "", intervencion: str = "", maximo: int = 50):
        registro["clinicaltrials"].append(termino)
        return [], 0

    async def ot_asociacion(simbolo: str):
        registro["opentargets"].append(simbolo)
        return {"encontrado": True, "puntuacion": 0.42, "tipos": {"genetic_association": 0.3, "literature": 0.6}}

    async def patentes_buscar(consultas: list[str], ingredientes: list[str]):
        registro["patentes_tratamiento"].append((consultas, ingredientes))
        return {"documentos": [copy.deepcopy(PATENTE_TRATAMIENTO)], "consultas": [{"fuente": "Registro simulado", "consulta": consultas[0], "url": "https://example.org/patentes", "total": 1, "recuperados": 1, "paginas": 1, "completa": True, "error": None}], "limitaciones": ["Fuente simulada; no es una revisión jurídica."], "costeUsd": 0.0,
                "googlePatents": {"proveedor": "serpapi", "protocolo": AT.PROTOCOLO_PATENTES, "estado": "completa", "consultadoEn": "2026-10-08T00:00:00Z"}, "consumo": {"serpapiConsultas": 0}}

    async def programas_buscar(terminos: list[str]):
        registro["programas_clinicos"].append(terminos)
        return {"estudios": [copy.deepcopy(ENSAYO_TRATAMIENTO)], "consultas": [{"fuente": "ClinicalTrials.gov simulado", "consulta": terminos[0], "url": "https://clinicaltrials.gov/search", "total": 1, "recuperados": 1, "paginas": 1, "completa": True, "error": None}], "limitaciones": ["Registro simulado; no acredita eficacia."]}

    async def lecciones(*a: Any, **k: Any) -> str:
        return "Ninguna todavía."

    async def sin_ontologias(simbolos: list[str], terminos: list, cache: dict) -> list:
        return []

    mp.setattr(europepmc, "buscar", ep_buscar)
    mp.setattr(europepmc, "texto_completo", ep_texto)
    mp.setattr(crossref, "marca_editorial", cr_marca)
    mp.setattr(unpaywall, "pdf_de", up_pdf)
    mp.setattr(pdf, "descargar", pdf_descargar)
    mp.setattr(pdf, "paginas", pdf_paginas)
    mp.setattr(pdf, "fragmento_en_pagina", pdf_en_pagina)
    mp.setattr(exa, "disponible", lambda: True)
    mp.setattr(exa, "buscar", exa_buscar)
    mp.setattr(exa, "contenidos", exa_contenidos)
    mp.setattr(openalex, "buscar", oa_buscar)
    mp.setattr(clinicaltrials, "buscar", ct_buscar)
    mp.setattr(opentargets, "asociacion_alzheimer", ot_asociacion)
    mp.setattr(patentes_tratamiento, "buscar", patentes_buscar)
    mp.setattr(programas_clinicos, "buscar", programas_buscar)
    mp.setattr(LEC, "para", lecciones)
    mp.setattr(ONTO, "normalizar", sin_ontologias)
    consultar_base = consultar_falso(RESPUESTAS_CONECTORES)

    async def consultar(nombre: str, /, **kwargs: Any):
        reg, dato = await consultar_base(nombre, **kwargs)
        if nombre.startswith("academica_"):
            # Esta corrida prueba el flujo completo con una colección sintética
            # vacía y comprobada, no con proveedores nuevos sin simular.
            reg.update(n=0, ids=[], error=None, version="simulada", invariante={"ok": True, "detalle": "Colección sintética vacía"})
            dato = {"articulos": [], "total": 0, "estado": "completa", "limitaciones": [],
                    "consultas": [{"fuente": nombre, "consulta": kwargs["consulta"], "fecha": "2026-10-08T00:00:00Z", "total": 0, "modo": "simulado"}],
                    "consumo": {"serpapiConsultas": 0}}
        elif nombre == "agora":
            gen = kwargs["gen"]
            assert gen in IDS_AGORA, f"El arnés necesita una respuesta explícita de Agora para {gen}"
            identificador = IDS_AGORA[gen]
            url = "https://agora.adknowledgeportal.org/genes/" + identificador
            reg.update(n=1, ids=[identificador], error=None, version="simulada", invariante={"ok": True, "detalle": "Identidad de prueba"})
            dato = {"estado": "completa", "gen": {"hgnc_symbol": gen, "ensembl_gene_id": identificador, "url": url},
                    "version": {"data_version": "simulada"}, "fecha": 1000, "advertencias": [], "consultas": [],
                    "secciones": [{"id": "identidad", "nombre": "Gene Search", "estado": "comprobado", "resumen": "Identidad suministrada por el arnés; no es una consulta real.",
                        "datos": {"hgnc_symbol": gen, "ensembl_gene_id": identificador}, "fuentes": [{"nombre": "Agora simulada", "url": url}], "consultas": [], "limitaciones": []},
                        {"id": "dianas_nominadas", "nombre": "Nominated Targets", "estado": "sin_datos", "resumen": "El conjunto simulado no contiene nominaciones.",
                         "datos": {"dianas": [], "nominaciones": []}, "fuentes": [], "consultas": [], "limitaciones": ["Respuesta sintética para probar el cierre; no describe la cobertura real de Agora."]}]}
        return reg, dato

    mp.setattr(CON, "consultar", consultar)
    registro["conectores"] = consultar_base.llamadas  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Programas simulados
# ---------------------------------------------------------------------------


def _afirmacion(spec: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(texto=spec["texto"], fragmento=spec["fragmento"], tipo=spec["tipo"], tema="GFAP y NfL", cohorte=spec.get("cohorte", ""), nivel_medicion="resultado_analisis", n=spec.get("n", ""), comparador=spec.get("comparador", ""), efecto=spec.get("efecto", ""), incertidumbre="")


def _extraer(kw: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(afirmaciones=[_afirmacion(s) for s in EXTRACCION.get(kw["localizador"], [])])


def _juzgar(kw: dict[str, Any]) -> SimpleNamespace:
    contraria = str(kw["afirmacion"]).startswith("El NfL sube antes")
    return SimpleNamespace(veredicto=SimpleNamespace(veredicto="no_sostenida" if contraria else "sostenida", motivo="El pasaje dice lo contrario: el NfL sube después." if contraria else "El pasaje lo dice tal cual.", entidad_distinta=False))


def _hecho(enunciado: str, tipo: str, afirmaciones: list[int]) -> SimpleNamespace:
    return SimpleNamespace(enunciado=enunciado, tema="GFAP y NfL", tipo=tipo, prioridad=2, afirmaciones=afirmaciones, resuelve=[], sustituye=[], contradice=[], que_la_resolveria="Una cohorte de portadores de APOE4 sin amiloide con GFAP y NfL seriados" if tipo == "pregunta" else "")


def _mundo() -> SimpleNamespace:
    # El mismo hecho dos veces: solo puede entrar uno (hechos sin duplicar).
    return SimpleNamespace(hechos=[_hecho(ENUNCIADO_HECHO, "hecho", [1, 2, 3, 4, 5]), _hecho(ENUNCIADO_HECHO, "hecho", [1, 2]), _hecho("¿Se mantiene el orden GFAP antes que NfL en portadores de APOE4 sin amiloide?", "pregunta", [])])


def _hipotesis_propuesta() -> SimpleNamespace:
    return SimpleNamespace(
        hipotesis=[
            SimpleNamespace(
                titulo=TITULO_NUEVA,
                enunciado="En personas con amiloide positivo, el GFAP en plasma se altera antes que el NfL en cohortes independientes",
                mecanismo="La activación de los astrocitos precede a la degeneración axonal",
                biomarcador="GFAP",
                cohorte="BioFINDER y Knight ADRC",
                diseno="cohorte longitudinal",
                cluster="Astrocitos",
                justificacion="Ordena los biomarcadores de la fase preclínica; sirve para elegir qué medir primero",
                afirmaciones=[1, 2, 3, 4, 5],
                supuestos=["El GFAP en plasma refleja la reactividad astrocitaria del cerebro"],
                entidades_novedad=["GFAP", "NfL", "APOE"],
                derivada_de=None,
                diana="GFAP",
                celula="astrocitos",
                etapa="preclínica",
                intervencion="",
                direccion="sin_intervencion",
                prediccion_falsable="Si el NfL cambiara antes que el GFAP en una cohorte amiloide positiva, la hipótesis quedaría refutada",
                riesgos=["cohorte única", "plataforma de medida"],
                paso_ruta="mecanismo",
            )
        ]
    )


def _killer() -> SimpleNamespace:
    comps = [SimpleNamespace(comprobacion=c, resultado="pasa", detalle="Lo sostienen las afirmaciones y la tarjeta.") for c in ("falsabilidad", "factibilidad", "fuente_primaria", "direccion_causal", "redundancia")]
    return SimpleNamespace(revision=SimpleNamespace(comprobaciones=comps, supuesto_invalidante="", alternativas=[], reformulacion_sugerida="", que_haria_falta="Comprobar el precedente en OpenAlex antes de avanzar", contradice_a=[], resumen="Pasa la falsabilidad y la factibilidad; la novedad sigue sin comprobar; lo más frágil es la plataforma de medida."))


def _senalizacion(kw: dict[str, Any]) -> SimpleNamespace:
    """Un juez que responde todas las preguntas del instrumento en el sentido de
    bajo riesgo, con una cita. Sin respuestas ("NI" en todo) el instrumento da
    "alto" y el Killer suspende por sesgo (M-01, ver el test xfail más abajo)."""
    texto = str(kw.get("instrumento_y_preguntas", ""))
    clave = next((k for k, ins in SESGO.INSTRUMENTOS.items() if ins["nombre"] in texto), None)
    if clave is None:
        return SimpleNamespace(respuestas=[])
    return SimpleNamespace(respuestas=[SimpleNamespace(id=p["id"], respuesta="N" if p["riesgoSi"] else "Y", cita="Participants were enrolled consecutively and assessors were blinded.") for d in SESGO.INSTRUMENTOS[clave]["dominios"] for p in d["preguntas"]])


ENUNCIADO_NUEVA = "En personas con amiloide positivo, el GFAP en plasma se altera antes que el NfL en cohortes independientes"


def _comparar(kw: dict[str, Any]) -> SimpleNamespace:
    # Por el ENUNCIADO, no por el título: desde el 25 de septiembre de 2026 la tarjeta
    # del torneo va a ciegas y no lleva título ni cluster ni revisiones automáticas
    # (pasos.hipotesis_para_torneo). Que el simulador siga sabiendo cuál es cuál con
    # solo el enunciado es la prueba de que la tarjeta ciega todavía las distingue.
    a_es_nueva = ENUNCIADO_NUEVA[:60] in str(kw["hipotesis_a"])
    assert TITULO_NUEVA[:40] not in str(kw["hipotesis_a"]) + str(kw["hipotesis_b"]), "la tarjeta del torneo no debe llevar el título"
    assert "Cluster:" not in str(kw["hipotesis_a"]), "la tarjeta del torneo no debe llevar el cluster"
    assert "Revisiones automáticas" not in str(kw["hipotesis_a"]), "la tarjeta del torneo no debe llevar las revisiones automáticas"
    return SimpleNamespace(comparacion=SimpleNamespace(mejor="A" if a_es_nueva else "B", eje="utilidad", resumen="La nueva ordena los biomarcadores en varias cohortes; la otra se queda en una.", relacion="distintas"))


class Simulador:
    """La `llamar` falsa. Responde por nombre de programa y pasa cada llamada por
    el contador real con un `usage` que trae `cost`, como el gateway. Un programa
    sin respuesta queda en `faltantes` y lanza (los pasos con try/except tienen
    que aguantar; el test comprueba después que la lista está vacía)."""

    def __init__(self, almacen: Almacen, respuestas: dict[str, Any], modelos: SimpleNamespace):
        self.almacen = almacen
        self.respuestas = respuestas
        self.modelos = modelos
        self.vistas: list[tuple[str, dict[str, Any]]] = []
        self.faltantes: list[str] = []
        self.cortes = 0  # veces que el presupuesto paró una llamada antes de salir
        self.contador = CT.Contador(almacen)
        self.historia: list[dict[str, Any]] = []  # hace de dspy GLOBAL_HISTORY

    def kw(self, programa: str) -> list[dict[str, Any]]:
        return [k for p, k in self.vistas if p == programa]

    def cuenta(self, programa: str) -> int:
        return len(self.kw(programa))

    async def llamar(self, ctx: Ctx, rol: str, programa: str, **kw: Any) -> Any:
        if not CT.presupuesto_ok(ctx.almacen, ctx.corrida_id, ctx.numero):
            self.cortes += 1
            raise PresupuestoAgotado(f"Presupuesto de la corrida {ctx.corrida_id} (o de su iteración {ctx.numero}) agotado")
        n = len(self.vistas) + 1
        self.vistas.append((programa, kw))
        lm = getattr(self.modelos, rol, None) or self.modelos.juez
        call_id = f"sim-{n}"
        inputs = {"messages": [{"role": "user", "content": f"{programa} {n}"}]}
        token = contexto_actual.set(ContextoLlamada(ctx.corrida_id, ctx.numero, rol))
        try:
            self.contador.on_lm_start(call_id, lm, inputs)
            if programa not in self.respuestas:
                self.faltantes.append(programa)
                self.contador.on_lm_end(call_id, None, exception=RuntimeError("sin respuesta simulada"))
                raise RuntimeError(f"programa simulado sin respuesta: {programa}")
            r = self.respuestas[programa]
            salida = r(kw) if callable(r) else r
            self.historia.append({"messages": inputs["messages"], "usage": {"prompt_tokens": 1200, "completion_tokens": 300, "cost": COSTE_GATEWAY}, "model": lm.model, "outputs": [str(n)]})
            self.contador.on_lm_end(call_id, [str(n)])
            return salida
        finally:
            contexto_actual.reset(token)


def _perfil_tratamiento(kw: dict[str, Any]) -> SimpleNamespace:
    intervencion = TRATAMIENTO_FALSO in kw["propuesta"]
    return SimpleNamespace(perfil=AT.PerfilTratamiento(
        tipo="intervencion" if intervencion else "observacional",
        nombre=TRATAMIENTO_FALSO if intervencion else "Orden temporal de GFAP y NfL",
        ingredientes=[TRATAMIENTO_FALSO] if intervencion else [], dianas=["GFAP"],
        modalidad="anticuerpo experimental" if intervencion else "cohorte longitudinal",
        direccion="reducir reactividad astrocitaria" if intervencion else "sin intervención",
        indicacion="Alzheimer", consultasPatentes=[TRATAMIENTO_FALSO] if intervencion else [],
        consultasProgramas=[TRATAMIENTO_FALSO] if intervencion else [],
    ))


def _dictamen_tratamiento(tipo: str) -> SimpleNamespace:
    return SimpleNamespace(dictamen=AT.DictamenTratamiento(hallazgos=[AT.HallazgoTratamiento(
        id=PATENTE_TRATAMIENTO["id"] if tipo == "patentes" else ENSAYO_TRATAMIENTO["nct"],
        relacion="mismo_tratamiento",
        cita=PATENTE_TRATAMIENTO["texto"] if tipo == "patentes" else ENSAYO_TRATAMIENTO["titulo"],
        explicacion="El documento simulado identifica esta intervención; no demuestra eficacia ni vigencia de una patente.",
        diferencias=[],
    )], limitaciones=["Solo se evaluaron documentos simulados para esta prueba."]))


def _respuestas(tratamiento: bool = False) -> dict[str, Any]:
    propuesta = _hipotesis_propuesta()
    if tratamiento:
        propuesta.hipotesis[0].intervencion = TRATAMIENTO_FALSO
        propuesta.hipotesis[0].direccion = "disminuye"
    return {
        "consultas": SimpleNamespace(consultas=[Consulta(base="europepmc", consulta="GFAP AND NfL AND APOE4", tema="GFAP y NfL")]),
        "explorar": SimpleNamespace(consultas=[]),
        "relevancia": SimpleNamespace(puntuacion=8, motivo="Responde a la pregunta sobre el orden de GFAP y NfL"),
        "relevancia_amplitud": SimpleNamespace(puntuacion=6, motivo="Roza el objetivo", podria_cambiar="La cohorte que falta"),
        "extraer": _extraer,
        "juzgar": _juzgar,
        "mundo": _mundo(),
        "hipotesis": propuesta,
        "perfil_tratamiento": _perfil_tratamiento,
        "patentes_tratamiento": lambda kw: _dictamen_tratamiento("patentes"),
        "companias_tratamiento": lambda kw: _dictamen_tratamiento("companias"),
        "auditar_tratamiento": lambda kw: _dictamen_tratamiento(kw["especialidad"]),
        "revisar_inicial": SimpleNamespace(revision=SimpleNamespace(pasa=True, resumen="Es específica y falsable; depende de que el GFAP refleje la reactividad astrocitaria.", supuestos=["Las plataformas de medida de GFAP y NfL son comparables entre cohortes"])),
        "evaluar_supuesto": SimpleNamespace(evaluacion=SimpleNamespace(estado="sin_evidencia", evidencia="ninguna", indices_que_lo_niegan=[])),
        "senalizacion": _senalizacion,
        "killer": _killer(),
        "comparar": _comparar,
        "meta": SimpleNamespace(debilidades=[], direcciones=[]),
        "resumir": lambda kw: SimpleNamespace(resumen="Se leyeron cuatro fuentes de cuatro cohortes, se sostuvieron cinco afirmaciones, entró un hecho al modelo de mundo y nació una hipótesis sobre el orden de GFAP y NfL."),
        "en_llano": _pred_llano(),
        "asignar_evidencia": SimpleNamespace(relaciones=[]),
        "concluir": _pred_conclusion(),
        "revisar_registro": SimpleNamespace(revision=SimpleNamespace(hallazgos=[], resumen="El resumen coincide con el registro.")),
    }


# ---------------------------------------------------------------------------
# El arnés
# ---------------------------------------------------------------------------


def _modelos() -> SimpleNamespace:
    return SimpleNamespace(cerebro=SimpleNamespace(model="openai/gpt-6-astra"), juez=SimpleNamespace(model="anthropic/claude-opus-5"), volumen=SimpleNamespace(model="anthropic/claude-sonnet-5"))


def _programas_reales() -> SimpleNamespace:
    """Todos los nombres reales de `Programas`, cada uno con su nombre como valor
    (la `llamar` falsa responde por nombre)."""
    return SimpleNamespace(**{n: n for n in vars(Programas())})


def _conclusion_previa(h: dict[str, Any]) -> dict[str, Any]:
    """Una conclusión de una iteración anterior, con su huella, para la hipótesis
    que ya existía: si nada de su evidencia cambia, el cierre la conserva."""
    k = {"certeza": "muy_baja", "techo": {"nivel": "muy_baja", "motivo": "una sola cohorte"}, "escalera": [], "direccion": "apoya", "direccionDelJuez": "apoya", "hipotesisBreve": "GFAP se altera antes que NfL", "enunciado": "La evidencia es muy incierta sobre si GFAP se altera antes que NfL", "conclusion": "No está claro si el GFAP se altera antes.", "factores": [], "base": {"afirmaciones": 2, "sostenidas": 2, "fuentes": 2, "datos": 2, "interpretaciones": 0}, "aFavor": [], "enContra": [], "loMasFragil": "una sola plataforma", "subiria": "otra cohorte", "bajaria": "orden inverso", "noComprobado": [], "cambio": None, "fechaBusqueda": None, "fecha": 1500, "iteracion": 0}
    h["conclusion"] = k
    h["_conclusionIntentada"] = 0
    k["huella"] = CO.huella_de_conclusion(h)
    return k


def _preparar_plan(al: Almacen, ids: dict[str, str], limite_corrida: int | None = None) -> int:
    """Plan de siete pasos aprobado, condición de parada de una iteración, reloj
    de la corrida y de la iteración puestos a ahora (la hipótesis que ya existe
    nació antes y no puede contar como nueva), y la hipótesis previa con
    conclusión y novedad ya comprobada."""
    ahora = P.ahora_ms()

    def fn(e: dict[str, Any]) -> bool:
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        inv = next(x for x in e["investigaciones"] if x["id"] == ids["inv"])
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        h = next(x for x in e["hipotesis"] if x["id"] == ids["hip"])
        inv["condicionParada"] = "1 iteraciones"
        it["plan"] = []
        for titulo, tipo in PLAN_SIETE:
            p = P.nuevo_paso(titulo, "", 20)
            p["tipo"] = tipo
            it["plan"].append(p)
        it["presupuesto"] = {"limite": 1000, "usado": 0}
        it["empezadaEn"] = ahora
        it["planPropuestoEn"] = ahora
        c["empezadaEn"] = ahora
        if limite_corrida is not None:
            c["presupuesto"]["limiteLlamadas"] = limite_corrida
        e["autonomia"]["gastar_grande"] = "actuar"
        # La hipótesis previa: novedad comprobada (no vuelve al paso de novedad) y
        # conclusión de una iteración anterior con su huella.
        h["novedad"]["precedente"] = {"estado": "sin_precedente", "detalle": "Sin precedente claro: 4 obras evaluadas de 27 que casan con «GFAP NfL APOE» en OpenAlex"}
        h["novedad"]["genetica"] = {"estado": "sin_vinculo", "detalle": "GFAP: sin asociaciones GWAS con Alzheimer"}
        # La hipótesis previa ya fue revisada por ambos especialistas en ESTA
        # corrida. Se guarda antes de calcular la conclusión anterior: conservar
        # la evidencia idéntica sigue probándose, sin desactivar los agentes.
        ctx = SimpleNamespace(corrida_id=ids["cor"], iteracion_id=ids["it"], modelos=_modelos())
        perfil = AT.PerfilTratamiento(tipo="observacional", nombre="Orden temporal de GFAP y NfL").model_dump()
        informes = {tipo: AT._informe(ctx, tipo, {}, None, no_aplica=True) for tipo in AT.NOMBRES}
        h["revisionTratamiento"] = {"version": AT.VERSION, "huella": AT.huella(h), "fecha": ahora, "perfil": perfil, **informes}
        h["novedad"]["companias"] = {"estado": informes["companias"]["estado"], "detalle": informes["companias"]["resumen"], "url": None}
        return True

    al.mutar(fn, "plan_siete")
    return ahora


def _arnes(mp: pytest.MonkeyPatch, limite_corrida: int | None = None, *, tratamiento: bool = False) -> dict[str, Any]:
    al, ids = _preparar()
    ahora = _preparar_plan(al, ids, limite_corrida)
    registro: dict[str, list[Any]] = {k: [] for k in ("europepmc", "europepmc_texto", "crossref", "pdf", "exa", "exa_contenidos", "openalex", "clinicaltrials", "opentargets", "patentes_tratamiento", "programas_clinicos", "red")}
    _fuentes_falsas(mp, registro)
    modelos = _modelos()
    sim = Simulador(al, _respuestas(tratamiento), modelos)

    async def llamar(self: Ctx, rol: str, programa: str, **kw: Any) -> Any:
        return await sim.llamar(self, rol, programa, **kw)

    mp.setattr(Ctx, "llamar", llamar)
    mp.setattr(dspy.clients.base_lm, "GLOBAL_HISTORY", sim.historia)
    sup = CO.Supervisor(al, _programas_reales(), modelos)
    # La conclusión previa ya conocía el mismo informe de Agora. Ejecutar la
    # revisión real con el conector simulado antes de congelar su huella evita
    # convertir este caso de evidencia idéntica en una primera revisión nueva.
    ctx = Ctx(al, sup.programas, modelos, ids["cor"], ids["inv"], ids["it"], 1, de_paso=True)
    asyncio.run(CO.AGORA.revisar_cierre(ctx))
    al.mutar(lambda e: _conclusion_previa(next(h for h in e["hipotesis"] if h["id"] == ids["hip"])) and True, "conclusion_previa")
    return {"al": al, "ids": ids, "sup": sup, "sim": sim, "registro": registro, "ahora": ahora}


def _corrida(r: dict[str, Any]) -> dict[str, Any]:
    return next(x for x in r["al"].estado["corridas"] if x["id"] == r["ids"]["cor"])


def _it(r: dict[str, Any]) -> dict[str, Any]:
    return next(x for x in r["al"].estado["iteraciones"] if x["id"] == r["ids"]["it"])


def _hips(r: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """(la hipótesis previa, la nacida en la iteración)."""
    e = r["al"].estado
    previa = next(x for x in e["hipotesis"] if x["id"] == r["ids"]["hip"])
    nueva = next(x for x in e["hipotesis"] if x["titulo"] == TITULO_NUEVA)
    return previa, nueva


@pytest.fixture(scope="module")
def corrida() -> dict[str, Any]:
    """Una iteración completa, corrida una sola vez para todos los tests del módulo."""
    mp = pytest.MonkeyPatch()
    r = _arnes(mp)
    t0 = time.monotonic()
    try:
        asyncio.run(asyncio.wait_for(r["sup"].correr_corrida(r["ids"]["cor"]), timeout=120))
    finally:
        r["duracion"] = time.monotonic() - t0
    try:
        yield r
    finally:
        mp.undo()
        r["al"].cerrar()


# ---------------------------------------------------------------------------
# El camino entero
# ---------------------------------------------------------------------------


def test_los_siete_pasos_terminan_y_la_corrida_cierra_con_su_metrica(corrida):
    it, c = _it(corrida), _corrida(corrida)
    assert [(p["titulo"], p["estado"]) for p in it["plan"]] == [(t, "hecho") for t, _ in PLAN_SIETE], [(p["titulo"], p["estado"], p.get("motivoFallo")) for p in it["plan"]]
    assert it["terminadaEn"] is not None and it["resumen"].startswith("Se leyeron cuatro fuentes")
    assert c["estado"] == "terminada" and c["motivoCierre"] == "Se alcanzaron las 1 iteraciones de la condición de parada"
    assert c["metrica"] is not None and len(c["progreso"]) == 1
    assert not any(p["estado"] == "en_curso" for p in it["pistas"]), "ninguna pista queda en curso tras el cierre"
    assert corrida["duracion"] < 60


def test_ningun_programa_real_se_llamo_sin_respuesta_simulada(corrida):
    """El arnés antiguo tenía 11 nombres de programa de 38: un paso que usaba uno
    ausente lanzaba AttributeError, el paso lo tragaba y el test pasaba sin probar
    nada (S-02, `relevancia`). Aquí están los 38 y cada uno que se llame tiene que
    tener respuesta."""
    sim = corrida["sim"]
    assert len(vars(corrida["sup"].programas)) >= 38
    assert sim.faltantes == [], f"programas llamados sin respuesta simulada: {sorted(set(sim.faltantes))}"
    llamados = {p for p, _ in sim.vistas}
    assert {"consultas", "relevancia", "extraer", "juzgar", "mundo", "hipotesis", "revisar_inicial", "evaluar_supuesto", "killer", "comparar", "resumir", "en_llano", "concluir", "revisar_registro", "meta", "asignar_evidencia", "explorar"} <= llamados, llamados
    assert {"perfil_tratamiento", "patentes_tratamiento", "companias_tratamiento", "auditar_tratamiento"} <= vars(corrida["sup"].programas).keys()
    assert "perfil_tratamiento" in llamados


def test_nada_salio_a_la_red_y_las_fuentes_falsas_se_consultaron(corrida):
    reg = corrida["registro"]
    assert reg["red"] == []
    assert reg["europepmc"] and reg["europepmc_texto"] and set(reg["europepmc_texto"]) == {ART_A["pmcid"]}, reg
    assert ART_A["doi"] in reg["crossref"] and ART_B["doi"] in reg["crossref"]
    assert reg["pdf"] and set(reg["pdf"]) == {ART_B["pdf"]}
    assert reg["exa_contenidos"] and set(reg["exa_contenidos"]) == {ART_D["url"]}
    assert {args["gen"] for nombre, args in reg["conectores"] if nombre == "agora"} == set(IDS_AGORA)
    assert CO.AGORA.revision_vigente(corrida["al"].estado, _corrida(corrida))
    assert not any(i["tipo"] == "fuente_sin_respuesta" for i in corrida["al"].estado["incidencias"])


# ---------------------------------------------------------------------------
# Literatura y extracción
# ---------------------------------------------------------------------------


def test_las_fuentes_no_se_duplican_entre_las_dos_pasadas_de_literatura(corrida):
    c = _corrida(corrida)
    fuentes = c["_fuentes"]
    assert len(fuentes) == 4, sorted(f["referencia"] for f in fuentes.values())
    assert len(corrida["registro"]["europepmc"]) >= 2, "las dos pasadas de literatura tienen que haber consultado Europe PMC"
    localizadores = {fr["localizador"] for f in fuentes.values() for fr in f["fragmentos"]}
    assert localizadores == LOCALIZADORES_ESPERADOS | {"resumen"}
    assert c["busqueda"]["usados"] == 4
    assert all(f["extraida"] for f in fuentes.values())


def test_dos_fuentes_con_la_misma_referencia_quedan_desambiguadas(corrida):
    referencias = sorted(f["referencia"] for f in _corrida(corrida)["_fuentes"].values())
    assert "Kim et al., 2025" in referencias and "Kim et al., 2025b" in referencias, referencias
    web = next(f for f in _corrida(corrida)["_fuentes"].values() if any(fr["localizador"].startswith("texto web") for fr in f["fragmentos"]))
    assert web["referencia"] == "Kim et al., 2025b"


# ---------------------------------------------------------------------------
# Verificación
# ---------------------------------------------------------------------------


def test_las_citas_de_los_cuatro_localizadores_resuelven_por_fuente_id(corrida):
    afs = _corrida(corrida)["_afirmaciones"]
    assert len(afs) == 7, [(a["cita"], a["veredicto"]) for a in afs]
    assert all(a.get("fuenteId") in _corrida(corrida)["_fuentes"] for a in afs)
    sostenidas_por_loc = {a["localizador"] for a in afs if a["veredicto"] == "sostenida"}
    assert sostenidas_por_loc == LOCALIZADORES_ESPERADOS, sostenidas_por_loc
    assert not any("no apunta a ninguna fuente" in a["motivo"] for a in afs)
    assert not any("Localizador no reconocido" in a["motivo"] for a in afs)
    web = next(a for a in afs if a["localizador"] == "texto web, parte 1")
    assert web["veredicto"] == "sostenida" and web["cita"] == "[Kim et al., 2025b, texto web, parte 1]"
    # El patrón de citas admite los cuatro localizadores: la extracción no dejó ningún aviso de
    # localizador no reconocido ni "fuera de los admitidos" (con el patrón anterior a la tanda 1,
    # la cita de la web resolvería igual por el id de la fuente, pero la pista lo avisaría).
    lineas = [l["texto"] for p in _it(corrida)["pistas"] for l in p["transcripcion"]]
    assert not any("no está en los admitidos por el patrón de citas" in l or "no reconoce el localizador" in l for l in lineas), [l for l in lineas if "localizador" in l]
    assert all(V.es_localizador_admitido(loc) for loc in LOCALIZADORES_ESPERADOS)


def test_sostenidas_las_correctas_y_bloqueadas_las_que_tocan(corrida):
    afs = {a["texto"]: a for a in _corrida(corrida)["_afirmaciones"]}
    esperados = {s["texto"]: s["esperado"] for specs in EXTRACCION.values() for s in specs}
    assert {t: a["veredicto"] for t, a in afs.items()} == esperados
    inventada = afs["El GFAP en plasma triplica su valor en la cohorte BioFINDER"]
    assert "literalidad" in inventada["motivo"] and "tripled" in inventada["motivo"]
    # La inventada la paró el determinista: el juez solo vio las seis literales.
    assert corrida["sim"].cuenta("juzgar") == 6
    assert afs["El NfL sube antes que el GFAP en la cohorte Knight ADRC"]["motivo"].startswith("El pasaje dice lo contrario")
    m = corrida["al"].estado["metricas"][-1]
    assert m["casos"] == 7 and m["cobertura"] == round(1 - 1 / 7, 3)


# ---------------------------------------------------------------------------
# Modelo de mundo
# ---------------------------------------------------------------------------


def test_los_hechos_no_se_duplican_y_cada_hecho_nuevo_deja_un_solo_evento(corrida):
    e = corrida["al"].estado
    hechos = [h for h in e["hechos"] if h["investigacionId"] == corrida["ids"]["inv"]]
    assert [h["enunciado"] for h in hechos if h["tipo"] == "hecho"] == [ENUNCIADO_HECHO]
    assert sum(1 for h in hechos if h["tipo"] == "pregunta") == 1
    hecho = next(h for h in hechos if h["tipo"] == "hecho")
    # Cinco afirmaciones de cuatro fuentes; la procedencia va por (fuente, página): Lee aporta la 3 y la 4.
    assert len(hecho["afirmacionIds"]) == 5 and len(hecho["procedencia"]) == 5
    assert len({p["fuenteId"] for p in hecho["procedencia"]}) == 4 and sorted(p["pagina"] for p in hecho["procedencia"] if p["pagina"]) == [3, 4]
    assert {p["referencia"] for p in hecho["procedencia"]} == {"Kim et al., 2025", "Lee et al., 2024", "Sin autor (aibl.csiro.au), 2023", "Kim et al., 2025b"}
    assert [ev["texto"] for ev in e["eventos"] if ev["tipo"] == "hecho_nuevo"] == [f"Hecho nuevo: {ENUNCIADO_HECHO[:120]}"]


def test_los_eventos_no_se_duplican(corrida):
    e = corrida["al"].estado
    claves = [(ev["tipo"], ev["texto"]) for ev in e["eventos"]]
    repetidos = sorted({k for k in claves if claves.count(k) > 1})
    assert repetidos == [], repetidos
    assert claves.count(("hipotesis_nueva", f"Hipótesis nueva en la cola: {TITULO_NUEVA}")) == 1
    assert sum(1 for t, _ in claves if t == "iteracion_terminada") == 1


# ---------------------------------------------------------------------------
# Hipótesis, Killer y torneo
# ---------------------------------------------------------------------------


def test_nace_una_hipotesis_con_cuatro_cohortes_y_el_killer_la_juzga_una_vez(corrida):
    e = corrida["al"].estado
    previa, nueva = _hips(corrida)
    assert nueva["origen"] == "rosa" and nueva["estado"] in ("propuesta", "en_revision") and nueva["estado"] != "descartada"
    assert len(nueva["afirmaciones"]) == 5 and all(a["veredicto"] == "sostenida" for a in nueva["afirmaciones"])
    assert {f["cohorte"] for f in nueva["procedencia"]["fuentes"]} == {"BioFINDER", "Knight ADRC", "AIBL", "WRAP"}
    decisiones = [d for d in e["decisiones"] if d["hipotesisId"] == nueva["id"] and d["etapa"].startswith("killer")]
    assert len(decisiones) == 1 and decisiones[0]["decision"] == nueva["decisionKiller"]
    # Sin novedad comprobada el Killer no puede dejarla avanzar; tampoco la mata.
    assert nueva["decisionKiller"] == "suspender", decisiones[0]["motivo"]
    assert decisiones[0]["motivo"].startswith("No evaluable todavía: novedad"), decisiones[0]["motivo"]
    assert corrida["sim"].cuenta("senalizacion") >= 1  # el riesgo de sesgo se evaluó por instrumento y, con respuestas, no suspende
    assert decisiones[0].get("huella") and nueva.get("_huellaKiller") == decisiones[0]["huella"]
    # Supuestos: los del generador se conservan y los del revisor se añaden con su origen.
    origenes = {s.get("origen") for s in nueva["supuestos"]}
    assert len(nueva["supuestos"]) == 2 and origenes == {"generador", "revisor"}, nueva["supuestos"]
    assert all(s["estado"] == "sin_evidencia" for s in nueva["supuestos"])
    # Las bases sí resolvieron la diana (MyGene simulado) y el resto quedó como "no pude comprobar".
    assert nueva["contextoBases"]["identificadores"]["ensembl"] == IDS_GFAP["ensembl"]
    assert previa["decisionKiller"] is None  # la previa no volvió al Killer: nadie pidió su revisión


def test_el_torneo_juega_un_partido_con_huella_y_la_ganadora_sube_de_elo(corrida):
    previa, nueva = _hips(corrida)
    assert len(nueva["partidos"]) == 1 and len(previa["partidos"]) == 1
    p = nueva["partidos"][0]
    assert p["rivalId"] == previa["id"] and p["resultado"] == "gano" and previa["partidos"][0]["resultado"] == "perdio"
    assert nueva["elo"] > 1500 > previa["elo"]
    assert p.get("_huellaPropia") and p.get("_huellaRival")
    assert corrida["sim"].cuenta("comparar") == 2  # A contra B y B contra A


# ---------------------------------------------------------------------------
# Novedad
# ---------------------------------------------------------------------------


def test_propuesta_observacional_revisada_sin_inventar_un_tratamiento(corrida):
    previa, nueva = _hips(corrida)
    revision = nueva["revisionTratamiento"]
    assert revision["perfil"]["tipo"] == "observacional"
    assert revision["huella"] == AT.huella(nueva)
    assert revision["patentes"]["estado"] == revision["companias"]["estado"] == "no_aplica"
    assert corrida["sim"].cuenta("perfil_tratamiento") == 1
    assert all(corrida["sim"].cuenta(p) == 0 for p in ("patentes_tratamiento", "companias_tratamiento", "auditar_tratamiento"))
    assert not corrida["registro"]["patentes_tratamiento"] and not corrida["registro"]["programas_clinicos"]
    assert AT.pendiente(previa, corrida["ids"]["cor"], corrida["ids"]["it"]) is False
    assert AT.pendiente(nueva, corrida["ids"]["cor"], corrida["ids"]["it"]) is False


def test_intervencion_recorre_ambos_especialistas_y_el_juez_en_una_corrida_completa(monkeypatch):
    """La variante con tratamiento consume las cinco llamadas reales del
    protocolo, recupera ambas fuentes y conserva el gasto real del contador."""
    r = _arnes(monkeypatch, tratamiento=True)
    try:
        asyncio.run(asyncio.wait_for(r["sup"].correr_corrida(r["ids"]["cor"]), timeout=120))
        _, nueva = _hips(r)
        revision = nueva["revisionTratamiento"]
        assert _corrida(r)["estado"] == "terminada"
        assert all(p["estado"] == "hecho" for p in _it(r)["plan"])
        assert r["sim"].faltantes == []
        assert revision["perfil"]["tipo"] == "intervencion" and revision["perfil"]["nombre"] == TRATAMIENTO_FALSO
        for tipo, ident in (("patentes", PATENTE_TRATAMIENTO["id"]), ("companias", ENSAYO_TRATAMIENTO["nct"])):
            informe = revision[tipo]
            assert informe["estado"] == "coincidencias"
            assert informe["hallazgos"][0]["id"] == ident
            assert informe["hallazgos"][0]["relacion"] == "mismo_tratamiento"
            assert informe["modelo"] == r["sup"].modelos.cerebro.model
            assert informe["revisor"] == r["sup"].modelos.juez.model
            assert informe["consultas"][0]["completa"] is True
            assert informe["_intento"] == f"{r['ids']['cor']}:{r['ids']['it']}"
        assert len(r["registro"]["patentes_tratamiento"]) == len(r["registro"]["programas_clinicos"]) == 1
        assert r["sim"].cuenta("perfil_tratamiento") == 1
        assert r["sim"].cuenta("patentes_tratamiento") == r["sim"].cuenta("companias_tratamiento") == 1
        assert r["sim"].cuenta("auditar_tratamiento") == 2
        assert {k["especialidad"] for k in r["sim"].kw("auditar_tratamiento")} == {"patentes", "companias"}
        assert nueva["novedad"]["companias"]["url"] == ENSAYO_TRATAMIENTO["url"]
        assert revision["companias"]["hallazgos"][0]["datos"]["whyStopped"] == ENSAYO_TRATAMIENTO["whyStopped"]
        assert AT.pendiente(nueva, r["ids"]["cor"], r["ids"]["it"]) is False
        n = len(r["sim"].vistas)
        assert _corrida(r)["gasto"]["llamadas"] == _it(r)["presupuesto"]["usado"] == n
        assert _corrida(r)["gasto"]["usdReal"] == pytest.approx(COSTE_GATEWAY * n, rel=1e-3)
    finally:
        r["al"].cerrar()


def test_novedad_no_comprobado_cuando_openalex_devuelve_cero_obras(corrida):
    previa, nueva = _hips(corrida)
    reg = corrida["registro"]
    assert reg["openalex"] and all("GFAP" in q for q in reg["openalex"]), reg["openalex"]
    prec = nueva["novedad"]["precedente"]
    assert prec["estado"] == "no_comprobado" and prec["detalle"].startswith("No comprobado") and "0 obras" in prec["detalle"], prec
    # Patentes y financiación: Exa devolvió cero documentos, también "no comprobado".
    assert nueva["novedad"]["patentes"]["estado"] == "no_comprobado" and nueva["novedad"]["financiacion"]["estado"] == "no_comprobado"
    # GWAS y ClinVar no respondieron: "no pude comprobar", nunca "sin vínculo".
    assert nueva["novedad"]["genetica"]["estado"] == "no_comprobado" and "no respondieron" in nueva["novedad"]["genetica"]["detalle"]
    # GEO sí respondió con una serie y CELLxGENE no: hay datos, con la nota de lo que no se pudo comprobar.
    dp = nueva["novedad"]["datosPublicos"]
    assert dp["estado"] == "hay_datos" and dp["series"][0]["accession"] == "GSE999001" and "no pude comprobar CELLxGENE" in dp["detalle"]
    assert nueva["_novedadIntentos"] == 1 and nueva.get("_revisionPedida") is True
    # La previa ya tenía la novedad comprobada: el paso no la tocó.
    assert previa["novedad"]["precedente"]["estado"] == "sin_precedente" and "_novedadIntentos" not in previa
    assert len(reg["openalex"]) == 1


def test_el_registro_de_datasets_del_programa_recoge_la_serie_geo(corrida):
    e = corrida["al"].estado
    datasets = [d for d in e.get("datasetsPrograma", []) if d.get("accession") == "GSE999001"]
    assert len(datasets) == 1 and datasets[0]["fuente"] == "geo" and corrida["ids"]["inv"] in datasets[0]["usadoEn"]


# ---------------------------------------------------------------------------
# Cierre: hipótesis nuevas, cola, conclusiones
# ---------------------------------------------------------------------------


def test_hipotesis_nuevas_cuenta_solo_la_nacida_en_la_ventana_de_la_iteracion(corrida):
    c = _corrida(corrida)
    previa, nueva = _hips(corrida)
    assert previa["creadaEn"] < _it(corrida)["empezadaEn"] <= nueva["creadaEn"]
    assert c["progreso"][-1]["hipotesisNuevas"] == 1
    # "Hechos nuevos" del cierre cuenta también la pregunta que entró al modelo de mundo (1 hecho + 1 pregunta).
    assert c["progreso"][-1]["hechosNuevos"] == 2
    informe = next(a for a in corrida["al"].estado["artefactos"] if a.get("tipo") == "informe" and a.get("nombre") == f"Informe de la iteración {_it(corrida)['numero']}")
    contenido = informe["versiones"][-1]["contenido"] if informe.get("versiones") else informe.get("contenido", "")
    assert "## Hipótesis nuevas en la cola (1)" in contenido and f"- {TITULO_NUEVA}" in contenido
    # El resumen técnico y el llano solo recibieron la nueva como nueva.
    assert corrida["sim"].kw("resumir")[0]["hipotesis_nuevas"] == f"- {TITULO_NUEVA}"
    assert corrida["sim"].kw("en_llano")[0]["hipotesis_nuevas"].startswith(f"- {TITULO_NUEVA}")


def test_la_cola_por_regla_llega_al_resumen_y_al_llano(corrida):
    it = _it(corrida)
    cola_resumir = corrida["sim"].kw("resumir")[0]["cola"]
    cola_llano = corrida["sim"].kw("en_llano")[0]["cola"]
    assert cola_resumir == cola_llano
    assert cola_resumir.startswith("2 en cola: 0 con descarte propuesto, 1 suspendidas, 1 sin juzgar."), cola_resumir
    assert TITULO_NUEVA[:90] in cola_resumir and "GFAP sube antes que NfL" in cola_resumir
    assert "Killer: suspender (No evaluable todavía: novedad" in cola_resumir and "Killer: sin juzgar" in cola_resumir
    assert it["resumenLlano"]["colaPorRegla"] == "2 hipótesis en cola: 0 con descarte propuesto por el Killer, 1 suspendida, 1 sin juzgar; 1 nació en esta iteración"
    assert it["revisionRegistro"]["estado"] in ("limpia", "con_hallazgos")


def test_solo_se_reconcluye_la_hipotesis_cuya_huella_cambio(corrida):
    previa, nueva = _hips(corrida)
    assert corrida["sim"].cuenta("concluir") == 1
    assert previa["conclusion"]["fecha"] == 1500 and previa["conclusion"]["iteracion"] == 0
    assert previa["procedencia"]["registro"][-1] == "iteración 1: sin cambios en la evidencia contada; se conserva la conclusión de la iteración 0"
    assert nueva["conclusion"] and nueva["conclusion"]["iteracion"] == 1 and nueva["conclusion"]["huella"] == CO.huella_de_conclusion(nueva)
    assert nueva["conclusion"]["certeza"] in ("baja", "muy_baja") and nueva["conclusion"]["direccion"] == "apoya"
    assert nueva["ruta"] and len(nueva["ruta"]["pasos"]) == 8


def test_la_evidencia_que_cambio_desde_la_decision_del_killer_pide_revision(corrida):
    previa, nueva = _hips(corrida)
    # La novedad cambió después de que el Killer decidiera: la huella difiere y la revisión queda pedida.
    assert nueva["_huellaKiller"] != CO.huella_evidencia(nueva)
    assert nueva.get("_revisionPedida") is True
    # La previa también queda pedida si el Killer nunca la juzgó (28 de
    # septiembre de 2026); si la juzgó y su huella no cambió, no se pide.
    if previa.get("decisionKiller"):
        assert previa.get("_revisionPedida") is None
    else:
        assert previa.get("_revisionPedida") is True, "nunca juzgada: no puede quedarse así en silencio"


# ---------------------------------------------------------------------------
# Coste y presupuesto
# ---------------------------------------------------------------------------


def test_el_contador_real_cuenta_cada_llamada_simulada(corrida):
    c, it = _corrida(corrida), _it(corrida)
    n = len(corrida["sim"].vistas)
    assert n > 20
    assert c["gasto"]["llamadas"] == n and it["presupuesto"]["usado"] == n
    assert c["gasto"]["tokensEntrada"] == 1200 * n and c["gasto"]["tokensSalida"] == 300 * n
    assert c["gasto"]["usd"] > 0
    assert c["gasto"]["exaUsd"] > 0  # las dos descargas de la página web por Exa
    con = corrida["al"]._con.execute("SELECT COUNT(*) FROM llamadas WHERE corrida_id=?", (c["id"],)).fetchone()[0]
    assert con == n


def test_el_coste_real_facturado_por_el_gateway_se_acumula_en_la_corrida(corrida):
    c = _corrida(corrida)
    n = len(corrida["sim"].vistas)
    assert c["gasto"]["usdReal"] == pytest.approx(COSTE_GATEWAY * n, rel=1e-3)


@pytest.mark.parametrize("estado_academico", ["completa", "parcial"])
def test_el_presupuesto_agotado_pausa_la_corrida_sin_bucle_ni_llamadas(monkeypatch, estado_academico):
    """Con un tope de cuatro llamadas la quinta corta dentro del primer paso (el
    cribado de relevancia): el paso vuelve a pendiente, ningún paso queda
    fallido, la corrida queda pausada con el motivo real y el bucle espera sin
    gastar ni mutar el estado hasta que alguien amplíe."""
    r = _arnes(monkeypatch, limite_corrida=4)
    al, sup, sim = r["al"], r["sup"], r["sim"]
    consultar_simulada = CON.consultar

    async def consultar(nombre, /, **kwargs):
        registro, dato = await consultar_simulada(nombre, **kwargs)
        if nombre.startswith("academica_") and estado_academico == "parcial":
            dato.update(estado="parcial", total=None, modo="descubrimiento_web", limitaciones=["Descubrimiento público parcial; no se consultó el índice privado."])
        return registro, dato

    monkeypatch.setattr(CON, "consultar", consultar)

    async def cuerpo() -> None:
        tarea = asyncio.create_task(sup.correr_corrida(r["ids"]["cor"]))
        t0 = time.monotonic()
        while _corrida(r)["estado"] != "pausada_por_presupuesto":
            assert not tarea.done(), tarea.exception() if tarea.done() and not tarea.cancelled() else "la tarea terminó sin pausar"
            assert time.monotonic() - t0 < 30, f"no se pausó: estado {_corrida(r)['estado']}"
            await asyncio.sleep(0.05)
        n, version = len(sim.vistas), al.version
        await asyncio.sleep(1.3)  # el bucle da al menos una vuelta entera de espera
        assert len(sim.vistas) == n and al.version == version and not tarea.done()
        sup.parar()
        await asyncio.wait_for(tarea, timeout=5)

    try:
        asyncio.run(cuerpo())
        c, it = _corrida(r), _it(r)
        academicas = [q for q in c["busqueda"]["consultas"] if q.get("fuenteId")]
        assert len(academicas) == 9 and all(q["estado"] == estado_academico for q in academicas)
        assert not any(inc.get("recurso", "").startswith("academica_") for inc in al.estado["incidencias"])
        assert c["gasto"]["llamadas"] == 4 and len(sim.vistas) == 4 and sim.cortes >= 1  # la quinta la paró el corte antes de salir
        assert c["presupuesto"]["motivoPausa"] == "La corrida agotó su tope de 4 llamadas (4 gastadas): se pausó. Amplía el tope para seguir."
        # El aviso de gasto grande (autonomía en «actuar», regla del 18 de septiembre) es otro
        # evento «presupuesto» legítimo: aquí solo se cuenta el de la pausa.
        eventos = [ev for ev in al.estado["eventos"] if ev["tipo"] == "presupuesto" and "sigue sin preguntar" not in ev["texto"]]
        assert len(eventos) == 1 and eventos[0]["texto"] == c["presupuesto"]["motivoPausa"]
        assert [p["estado"] for p in it["plan"]] == ["pendiente"] * len(PLAN_SIETE), [(p["titulo"], p["estado"], p.get("motivoFallo")) for p in it["plan"]]
        assert it["terminadaEn"] is None
        assert all(p["estado"] != "en_curso" for p in it["pistas"]) and any(p["estado"] == "detenida" for p in it["pistas"])
    finally:
        al.cerrar()


def test_un_juez_que_no_encuentra_informacion_de_sesgo_no_hace_suspender_al_killer():
    """Descubierto por el arnés: con la `senalizacion` simulada sin respuestas
    (todo NI) la nueva hipótesis quedó suspendida por sesgo_evidencia, no por la
    novedad pendiente. "Sin información" no es "riesgo alto"."""
    evaluacion = SESGO.evaluar("robins_i", [], "sim", 1)
    assert all(d["juicio"] == "algunas_dudas" for d in evaluacion["dominios"])
    fuente = {"id": "f", "referencia": "Lee et al., 2024", "tipoEstudio": "cohorte", "riesgoSesgo": evaluacion}
    comprobacion = SESGO.comprobacion_sesgo([fuente])
    assert comprobacion["resultado"] != "falla", comprobacion
    decision, motivo = K.decidir([comprobacion], tiene_prediccion=True, version=1)
    assert decision != "suspender" or "sesgo" not in motivo, (decision, motivo)


def test_el_reloj_vive_en_memoria_y_no_muta_el_estado_por_tic(monkeypatch):
    r = _arnes(monkeypatch)
    al, sup = r["al"], r["sup"]

    async def dormida(cid: str) -> None:
        await asyncio.sleep(3600)

    monkeypatch.setattr(sup, "correr_corrida", dormida)

    async def cuerpo() -> None:
        t0 = r["ahora"] + 5_000
        sup._tick(ahora=t0)
        v0 = al.version
        for dt in (1_000, 2_000, 5_000, 12_000, 25_000, 29_000):
            sup._tick(ahora=t0 + dt)
        assert al.version == v0 and _corrida(r)["gasto"]["segundos"] == 0
        assert sup._reloj[r["ids"]["cor"]]["segundos"] == round((t0 + 29_000 - r["ahora"]) / 1000)
        sup._tick(ahora=t0 + 31_000)
        assert al.version == v0 + 1 and _corrida(r)["gasto"]["segundos"] == round((t0 + 31_000 - r["ahora"]) / 1000)
        for t in sup.tareas.values():
            t.cancel()

    try:
        asyncio.run(cuerpo())
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# Tildes en todo lo que generó el backend
# ---------------------------------------------------------------------------

SIN_TILDE = re.compile(r"\b(hipotesis|iteracion|cumplio|apruebala|termino|revision|decision|aqui)\b", re.IGNORECASE)
# "tu" como pronombre: al final de la frase o antes de un signo ("Decide tu.").
TU_PRONOMBRE = re.compile(r"\b[Tt]u\b(?=\s*(?:[.,;:!?)\]»]|$))")


def textos_del_backend(obj: Any, ruta: tuple[str, ...] = ()):
    """Todas las cadenas con espacios del estado, con su ruta, menos los pasajes
    copiados de las fuentes (`fragmento`, y `texto` dentro de `fragmentos`), que
    son texto ajeno en inglés, y `codigo` (la llamada de programa que dejó la
    procedencia, un identificador)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("fragmento", "codigo") or (k == "texto" and "fragmentos" in ruta):
                continue
            yield from textos_del_backend(v, ruta + (str(k),))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from textos_del_backend(v, ruta + (str(i),))
    elif isinstance(obj, str) and " " in obj.strip():
        yield "/".join(ruta), obj


def palabras_sin_tilde(textos) -> list[tuple[str, str]]:
    salida = []
    for ruta, texto in textos:
        m = SIN_TILDE.search(texto) or TU_PRONOMBRE.search(texto)
        if m:
            salida.append((ruta, texto[max(0, m.start() - 40): m.end() + 40]))
    return salida


def test_el_escaner_de_tildes_caza_lo_que_debe_y_deja_pasar_lo_demas():
    e = {"a": "La hipotesis nueva", "b": "Decide tu.", "c": "tu decisión manda", "d": "en_revision", "e": {"fragmentos": [{"texto": "revision of the criteria"}]}, "f": {"fragmento": "a decision was made"}, "g": "La hipótesis y la iteración, decide tú."}
    hallado = dict(palabras_sin_tilde(textos_del_backend(e)))
    assert set(hallado) == {"a", "b"}, hallado


def test_ningun_texto_generado_por_el_backend_va_sin_tilde(corrida):
    e = corrida["al"].estado
    hallados = palabras_sin_tilde(textos_del_backend(e))
    assert hallados == [], "\n".join(f"{r}: ...{t}..." for r, t in hallados[:40])


@pytest.mark.skipif(not ESTADO_REAL.exists(), reason="sin copia del estado real")
def test_las_frases_de_la_cola_por_regla_sobre_el_estado_real_van_con_tildes():
    """Solo las frases que la regla escribe hoy. `cola_de_hipotesis` entera no:
    copia los motivos del Killer guardados en el estado, y seis de ellos son de
    antes de la regla de las tildes ("La evidencia no sostiene la hipotesis")."""
    e = json.loads(ESTADO_REAL.read_text())
    textos = []
    for inv in e["investigaciones"]:
        textos.append((f"frase/{inv['id']}", CO.frase_de_la_cola(e, inv["id"], 0)))
        textos.append((f"recuento/{inv['id']}", T.frase_recuento_cola(T.recuento_cola(e, inv["id"]))))
        textos.append((f"primera_linea/{inv['id']}", T.cola_de_hipotesis(e, inv["id"]).splitlines()[0]))
    assert palabras_sin_tilde(textos) == []
