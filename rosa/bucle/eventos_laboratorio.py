"""Metadatos públicos y acotados para escenificar decisiones ya registradas.

El evento pertenece a la entrada y a su pista. No introduce otra identidad de
corrida ni deduce asociaciones a partir de títulos o texto libre.
"""

from __future__ import annotations

from typing import Any


def validar(evento: dict[str, Any]) -> dict[str, Any]:
    """Valida la unión discriminada y copia exclusivamente sus campos públicos."""
    contratos = {
        "articulo": {"tipo", "id", "titulo", "estado", "motivo", "modo"},
        "idea": {"tipo", "hipotesisId", "titulo", "enfoque"},
        "torneo": {"tipo", "hipotesisAId", "hipotesisBId", "tituloA", "tituloB", "estado", "porRegla"},
        "analisis": {"tipo", "ejecucionId", "estado", "sintetico"},
    }
    tipo = evento.get("tipo") if isinstance(evento, dict) else None
    if not isinstance(tipo, str) or tipo not in contratos or set(evento) != contratos[tipo]:
        raise ValueError("Contrato de evento del laboratorio no admitido")
    salida: dict[str, Any] = {}
    for campo, valor in evento.items():
        if campo in {"porRegla", "sintetico"}:
            if type(valor) is not bool:
                raise ValueError("La marca del evento debe ser booleana")
            salida[campo] = valor
            continue
        if not isinstance(valor, str) or (campo != "motivo" and not valor.strip()):
            raise ValueError("Campo textual del evento no válido")
        if campo in {"id", "hipotesisId", "hipotesisAId", "hipotesisBId", "ejecucionId"}:
            if len(valor) > 512 or any(c in valor for c in "\n\r\x00"):
                raise ValueError("Identificador del evento no válido")
            salida[campo] = valor
        else:
            salida[campo] = valor[:320 if campo in {"titulo", "tituloA", "tituloB"} else 240 if campo == "motivo" else 64]
    estados = {
        "articulo": {"incluido", "excluido", "no_comprobado"},
        "torneo": {"comparando", "a", "b", "tablas", "no_comprobado"},
        "analisis": {"programando", "ejecutando", "terminado", "fallido", "interpretando", "auditando"},
    }
    if tipo in estados and evento["estado"] not in estados[tipo]:
        raise ValueError("Estado de evento del laboratorio no admitido")
    if tipo == "articulo" and evento["modo"] not in {"foco", "amplitud"}:
        raise ValueError("Modo de cribado del evento no admitido")
    if tipo == "torneo" and evento["hipotesisAId"] == evento["hipotesisBId"]:
        raise ValueError("Un partido necesita dos hipótesis distintas")
    return salida


def registrar(pista: Any, tipo: str, texto: str, evento: dict[str, Any]) -> None:
    """Conserva la línea original también en dobles sin el contrato opcional.

    Los dobles históricos solo implementan accion/resultado/nota/error. La
    ausencia de soporte omite los metadatos, nunca el registro científico.
    Los errores del método real se propagan: no se oculta un contrato inválido.
    """
    emitir = getattr(pista, "linea_lab", None)
    if callable(emitir):
        emitir(tipo, texto, evento)
    else:
        getattr(pista, tipo)(texto)


def articulo(identificador: str, datos: dict[str, Any], estado: str, motivo: str, modo: str) -> dict[str, Any]:
    return {"tipo": "articulo", "id": identificador, "titulo": str(datos.get("titulo") or datos.get("referencia") or identificador),
            "estado": estado, "motivo": motivo, "modo": modo}


def torneo(a: dict[str, Any], b: dict[str, Any], estado: str, por_regla: bool) -> dict[str, Any]:
    return {"tipo": "torneo", "hipotesisAId": a["id"], "hipotesisBId": b["id"],
            "tituloA": a["titulo"], "tituloB": b["titulo"], "estado": estado, "porRegla": por_regla}


def analisis(ejecucion_id: str, estado: str, sintetico: bool) -> dict[str, Any]:
    return {"tipo": "analisis", "ejecucionId": ejecucion_id, "estado": estado, "sintetico": sintetico}
