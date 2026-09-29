"""El conjunto dorado: etiquetas humanas sobre lo que decidio el Killer.

Cada vez que una persona cualificada mira una comprobacion del Killer sobre
una hipotesis y dice "acierta" o "se equivoca", queda un caso en
`estado["conjuntoDorado"]`: la hipotesis, la version juzgada, la
comprobacion, lo que dijo el juez (pasa, falla, no_comprobable), lo que dice
la persona, quien y cuando, y el modelo que juzgo. Con eso se mide el
acuerdo juez-humano por tipo de comprobacion (kappa de Cohen, no un
promedio global) y se detecta si el acuerdo cae cuando cambia el modelo.

Aqui no hay llamadas a modelos: solo lectura del estado y aritmetica.
"""

from __future__ import annotations

from typing import Any

from rosa import acuerdo as AC

VEREDICTOS = ("pasa", "falla", "no_comprobable")
MINIMO_CASOS = 5


def casos_de(e: dict[str, Any], comprobacion: str | None = None) -> list[dict[str, Any]]:
    casos = list(e.get("conjuntoDorado") or [])
    if comprobacion:
        casos = [c for c in casos if c.get("comprobacion") == comprobacion]
    return casos


def acuerdo_dorado(e: dict[str, Any]) -> dict[str, Any]:
    """Acuerdo juez-humano: global y por comprobación. Las categorías son las
    tres del veredicto; como no están ordenadas, kappa sin ponderar."""
    casos = casos_de(e)
    salida: dict[str, Any] = {"casos": len(casos), "global": None, "porComprobacion": {}, "porModelo": {}}
    if not casos:
        return salida
    # Un caso sin los dos veredictos no es un acuerdo ni un desacuerdo: se
    # queda fuera. `AC.matriz_confusion` hacía `m[idx[None]]` y tumbaba el
    # informe entero, y con él el PRISMA.
    casos = [c for c in casos if c.get("veredictoJuez") in VEREDICTOS and c.get("veredictoHumano") in VEREDICTOS]
    salida["casos"] = len(casos)
    if not casos:
        return salida

    def _con_suficiencia(sub: list[dict[str, Any]]) -> dict[str, Any]:
        """El acuerdo de un subconjunto, diciendo si hay casos bastantes.

        `suficiente` se calculaba solo por comprobación. El bloque global y el
        de por modelo salían sin él, así que un kappa de 1,0 sobre DOS
        etiquetas se publicaba como "casi perfecto" en el informe PRISMA y en
        el Markdown que se pega en un manuscrito (28 de septiembre de 2026).
        Un kappa de 1,0 sobre dos etiquetas no es acuerdo casi perfecto: no es
        nada."""
        a = AC.acuerdo([c.get("veredictoJuez") for c in sub], [c.get("veredictoHumano") for c in sub], categorias=list(VEREDICTOS))
        a["suficiente"] = len(sub) >= MINIMO_CASOS
        if not a["suficiente"]:
            a["interpretacion"] = f"sin etiquetas suficientes ({len(sub)} de {MINIMO_CASOS} mínimas): la cifra no se puede leer"
        return a

    salida["global"] = _con_suficiencia(casos)
    for nombre in sorted({c.get("comprobacion") for c in casos if c.get("comprobacion")}):
        salida["porComprobacion"][nombre] = _con_suficiencia([c for c in casos if c.get("comprobacion") == nombre])
    for modelo in sorted({c.get("modeloJuez") or "?" for c in casos}):
        salida["porModelo"][modelo] = _con_suficiencia([c for c in casos if (c.get("modeloJuez") or "?") == modelo])
    return salida


def acierto_por_tipo(e: dict[str, Any]) -> dict[str, float | None]:
    """Acierto del verificador por tipo de afirmación (dato, literatura,
    interpretación), medido contra las afirmaciones que una persona revisó
    (`veredictoHumano` en la afirmación). None donde no hay revisiones."""
    salida: dict[str, float | None] = {"dato": None, "literatura": None, "interpretacion": None}
    cuentas: dict[str, list[bool]] = {k: [] for k in salida}
    for h in e.get("hipotesis", []):
        for a in h.get("afirmaciones", []) or []:
            vh = a.get("veredictoHumano")
            if vh in ("sostenida", "parcial", "no_sostenida") and a.get("tipo") in cuentas:
                cuentas[a["tipo"]].append(a.get("veredicto") == vh)
    for k, v in cuentas.items():
        if v:
            salida[k] = round(sum(v) / len(v), 3)
    return salida


def caida_de_acuerdo(anterior: dict[str, Any] | None, actual: dict[str, Any] | None, umbral: float = 0.15) -> str | None:
    """Si el kappa global bajo más que `umbral` entre dos mediciones, el motivo
    para avisar; si no, None."""
    if not anterior or not actual:
        return None
    ka, kb = (anterior.get("global") or {}).get("kappa"), (actual.get("global") or {}).get("kappa")
    if ka is None or kb is None:
        return None
    if ka - kb > umbral:
        return f"el acuerdo juez-humano bajo de {ka} a {kb}"
    return None
