"""Evidencia acumulada por hipotesis con e-valores (Popper, Huang y otros,
2025): cada prueba con p-valor se convierte en un e-valor con el calibrador
e = kappa * p^(kappa - 1), kappa en (0, 1); el producto de los e-valores de
las pruebas validas es la evidencia acumulada, y se rechaza la nula al
nivel alfa cuando el producto alcanza 1/alfa. A diferencia de sumar p-valores
o contar "cuantas pruebas salieron", esto controla el error de tipo I aunque
se sigan anadiendo pruebas.
"""

from __future__ import annotations

import re
from typing import Any

KAPPA = 0.5
ALFA = 0.1


def e_valor(p: float, kappa: float = KAPPA) -> float:
    p = min(max(p, 1e-12), 1.0)
    return kappa * p ** (kappa - 1)


# En orden de prioridad, y la AJUSTADA va primero (28 de septiembre de 2026).
# Estaba detrás de la cruda, así que un análisis sobre 50 genes que reportaba
# p cruda 0,002 y p ajustada 0,40 entraba con 0,002 y el e-valor acumulado
# decía "rechaza la hipótesis nula". Tras corregir por comparaciones
# múltiples no había nada. Si una ejecución da las dos, la que vale es la
# ajustada: la cruda ya está gastada en la corrección.
CLAVES_P = ("p_ajustada", "p_ajustado", "p_adj", "p_valor", "p_value", "pvalue", "valor_p", "p_bilateral", "p_unilateral", "p")


def p_de(resultados: dict[str, str]) -> float | None:
    """El p-valor principal de una ejecucion: solo claves que son un p-valor
    (lista blanca, en orden de prioridad), nunca proporciones como p_grupo.
    Admite '<0.001' (se toma 0.001) y coma decimal."""
    por_clave = {k.lower(): v for k, v in resultados.items()}
    for k in CLAVES_P:
        if k not in por_clave:
            continue
        crudo = str(por_clave[k]).strip().replace(",", ".").lstrip("<≤=").strip()
        try:
            v = float(crudo)
        except ValueError:
            continue
        if 0 < v <= 1:
            return v
    return None


def agregar(ejecuciones: list[dict[str, Any]]) -> dict[str, Any] | None:
    """La evidencia acumulada de las ejecuciones válidas (auditoría válida)
    de una hipótesis. None si ninguna aporta p-valor."""
    validas = [x for x in ejecuciones if (x.get("auditoria") or {}).get("veredicto") == "valido" and x.get("estado") == "completado"]
    # Solo cuenta una prueba por (datos, plan): repetir el mismo analisis sobre los
    # mismos datos no es evidencia nueva. Se conserva la ultima.
    por_clave: dict[tuple[str, str], dict[str, Any]] = {}
    for x in validas:
        clave = (str(x.get("hashDatos") or x.get("id")), str(x.get("hashPlan") or x.get("planId") or x.get("id")))
        por_clave[clave] = x
    pruebas = []
    e_total = 1.0
    for x in por_clave.values():
        p = p_de(x.get("resultados", {}))
        if p is None:
            continue
        e = e_valor(p)
        e_total *= e
        pruebas.append({"ejecucionId": x["id"], "p": p, "e": round(e, 4)})
    if not pruebas:
        return None
    return {"eAcumulado": round(e_total, 4), "pruebas": pruebas, "alfa": ALFA, "kappa": KAPPA, "rechazaNula": e_total >= 1 / ALFA}
