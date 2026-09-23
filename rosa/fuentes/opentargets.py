"""Open Targets Platform (GraphQL): si una diana ya esta asociada al
Alzheimer y con que puntuacion. Alzheimer es MONDO_0004975 (EFO_0000249 es
su equivalente antiguo). Sin clave.
"""

from __future__ import annotations

from typing import Any

from rosa.fuentes.base import FuenteNoDisponible, Limitador, json_de, pedir

URL = "https://api.platform.opentargets.org/api/v4/graphql"
_limitador = Limitador(2.0)
ALZHEIMER = "MONDO_0004975"

_BUSCAR = """
query ($q: String!) { search(queryString: $q, entityNames: ["target"], page: {index: 0, size: 3}) { hits { id name entity } } }
"""
_ASOCIACION = """
query ($id: String!, $enf: [String!]) {
  target(ensemblId: $id) {
    id approvedSymbol approvedName
    associatedDiseases(Bs: $enf, page: {index: 0, size: 5}) { count rows { score disease { id name } datatypeScores { id score } } }
  }
}
"""


def _sin_errores(cuerpo: Any) -> dict[str, Any]:
    """GraphQL devuelve los errores con HTTP 200 y `data` nulo: eso es "no pude
    comprobar", no un resultado vacío ni un AttributeError."""
    if not isinstance(cuerpo, dict):
        raise FuenteNoDisponible("Open Targets: respuesta sin forma de objeto")
    if cuerpo.get("errors"):
        raise FuenteNoDisponible("Open Targets: " + "; ".join(str(e.get("message", e))[:120] for e in cuerpo["errors"][:3]))
    return cuerpo


async def asociacion_alzheimer(simbolo: str) -> dict[str, Any]:
    """{simbolo, ensembl, puntuacion (0 a 1 o None), tipos: {datatype: score}}.
    puntuación None con `encontrado` True significa "sin asociación registrada"."""
    r = await pedir("POST", URL, _limitador, json={"query": _BUSCAR, "variables": {"q": simbolo}})
    cuerpo = _sin_errores(json_de(r))
    hits = (((cuerpo.get("data") or {}).get("search") or {}).get("hits")) or []
    hit = next((h for h in hits if h.get("name", "").upper() == simbolo.upper()), hits[0] if hits else None)
    if not hit:
        return {"simbolo": simbolo, "ensembl": None, "encontrado": False, "puntuacion": None, "tipos": {}}
    r2 = await pedir("POST", URL, _limitador, json={"query": _ASOCIACION, "variables": {"id": hit["id"], "enf": [ALZHEIMER, "EFO_0000249"]}})
    t = (_sin_errores(json_de(r2)).get("data") or {}).get("target") or {}
    filas = (t.get("associatedDiseases") or {}).get("rows") or []
    if not filas:
        return {"simbolo": t.get("approvedSymbol", simbolo), "ensembl": hit["id"], "encontrado": True, "puntuacion": None, "tipos": {}}
    mejor = max(filas, key=lambda f: f.get("score", 0))
    return {"simbolo": t.get("approvedSymbol", simbolo), "ensembl": hit["id"], "encontrado": True, "puntuacion": round(float(mejor.get("score", 0)), 3), "tipos": {d["id"]: round(float(d["score"]), 3) for d in mejor.get("datatypeScores", [])}, "enfermedad": mejor.get("disease", {}).get("name")}
