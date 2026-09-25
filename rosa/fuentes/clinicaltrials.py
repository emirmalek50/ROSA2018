"""ClinicalTrials.gov API v2. Sin clave. Sin cifra oficial de limite: 1 por
segundo es prudente. `query.cond` y `query.intr` en sintaxis Essie;
`fields` con nombres de pieza; `countTotal=true` para el total.
"""

from __future__ import annotations

from typing import Any

from rosa.fuentes.base import Limitador, pedir

BASE = "https://clinicaltrials.gov/api/v2/studies"
_limitador = Limitador(1.0)

CAMPOS = "NCTId,BriefTitle,OverallStatus,Phase,Condition,InterventionName,PrimaryOutcomeMeasure,StartDate,LeadSponsorName,StudyType"


async def buscar(condicion: str, termino: str = "", intervencion: str = "", maximo: int = 50) -> tuple[list[dict[str, Any]], int]:
    params: dict[str, Any] = {"query.cond": condicion, "pageSize": min(maximo, 1000), "countTotal": "true", "fields": CAMPOS}
    if termino:
        params["query.term"] = termino
    if intervencion:
        params["query.intr"] = intervencion
    r = await pedir("GET", BASE, _limitador, params=params)
    d = r.json()
    estudios = []
    for s in d.get("studies", []):
        p = s.get("protocolSection", {})
        estudios.append(
            {
                "nct": p.get("identificationModule", {}).get("nctId"),
                "titulo": p.get("identificationModule", {}).get("briefTitle", ""),
                "estado": p.get("statusModule", {}).get("overallStatus"),
                "fases": p.get("designModule", {}).get("phases", []),
                "tipo": p.get("designModule", {}).get("studyType"),
                "condiciones": p.get("conditionsModule", {}).get("conditions", []),
                "intervenciones": [i.get("name") for i in p.get("armsInterventionsModule", {}).get("interventions", [])],
                "desenlaces": [o.get("measure") for o in p.get("outcomesModule", {}).get("primaryOutcomes", [])],
                "inicio": p.get("statusModule", {}).get("startDateStruct", {}).get("date"),
                "patrocinador": p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name"),
            }
        )
    return estudios, int(d.get("totalCount", len(estudios)) or 0)


async def por_nct(nct: str) -> dict[str, Any] | None:
    r = await pedir("GET", f"{BASE}/{nct}", _limitador, params={"fields": CAMPOS})
    s = r.json()
    p = s.get("protocolSection", {})
    if not p:
        return None
    return {"nct": p.get("identificationModule", {}).get("nctId"), "titulo": p.get("identificationModule", {}).get("briefTitle", ""), "estado": p.get("statusModule", {}).get("overallStatus"), "fases": p.get("designModule", {}).get("phases", [])}


# Los criterios de elegibilidad de los ensayos grandes de una intervención, para
# comprobar si la prueba que propone una hipótesis se puede hacer con sus datos
# (rosa/viabilidad.py). Solo ensayos intervencionales de fase 2 o 3, los más
# grandes primero: el pivotal es el que se cita, y los de 100 participantes no
# cambian si un subgrupo existe o no. Comprobado el 25 de septiembre de 2026
# contra la API: con este filtro, lecanemab devuelve primero CLARITY AD
# (NCT03887455, 1.906 participantes).
FILTRO_PIVOTALES = "AREA[StudyType]INTERVENTIONAL AND (AREA[Phase]PHASE2 OR AREA[Phase]PHASE3)"
CAMPOS_ELEGIBILIDAD = "NCTId,BriefTitle,Acronym,Phase,EnrollmentCount,OverallStatus,EligibilityCriteria"


async def elegibilidad(intervencion: str, condicion: str = "Alzheimer Disease", maximo: int = 2) -> list[dict[str, Any]]:
    """Los `maximo` ensayos más grandes de esa intervención, con sus criterios de
    elegibilidad en texto. Lanza `FuenteNoDisponible` si la API no responde:
    quien llama lo trata como "no pude comprobar", nunca como "no hay ensayos"."""
    params = {"query.cond": condicion, "query.intr": intervencion, "filter.advanced": FILTRO_PIVOTALES, "sort": "EnrollmentCount:desc", "pageSize": max(1, min(maximo, 10)), "fields": CAMPOS_ELEGIBILIDAD}
    r = await pedir("GET", BASE, _limitador, params=params)
    salida = []
    for s in (r.json() or {}).get("studies", []) or []:
        p = s.get("protocolSection", {})
        ident, diseno, eleg = p.get("identificationModule", {}), p.get("designModule", {}), p.get("eligibilityModule", {})
        salida.append(
            {
                "nct": ident.get("nctId"),
                "titulo": ident.get("briefTitle", ""),
                "acronimo": ident.get("acronym") or "",
                "fases": diseno.get("phases", []),
                "participantes": (diseno.get("enrollmentInfo") or {}).get("count"),
                "estado": p.get("statusModule", {}).get("overallStatus"),
                "criterios": eleg.get("eligibilityCriteria") or "",
            }
        )
    return salida


async def elegibilidad_por_nct(nct: str) -> list[dict[str, Any]]:
    """El ensayo de ese NCT con sus criterios, en la misma forma que
    `elegibilidad`. Lista vacía si el registro no lo tiene."""
    r = await pedir("GET", f"{BASE}/{nct}", _limitador, params={"fields": CAMPOS_ELEGIBILIDAD})
    p = (r.json() or {}).get("protocolSection", {})
    if not p:
        return []
    ident, diseno, eleg = p.get("identificationModule", {}), p.get("designModule", {}), p.get("eligibilityModule", {})
    return [{"nct": ident.get("nctId"), "titulo": ident.get("briefTitle", ""), "acronimo": ident.get("acronym") or "", "fases": diseno.get("phases", []), "participantes": (diseno.get("enrollmentInfo") or {}).get("count"), "estado": p.get("statusModule", {}).get("overallStatus"), "criterios": eleg.get("eligibilityCriteria") or ""}]
