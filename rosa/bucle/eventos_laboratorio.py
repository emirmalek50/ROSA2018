"""Metadatos públicos y acotados para escenificar decisiones ya registradas.

El evento pertenece a la entrada y a su pista. No introduce otra identidad de
corrida ni deduce asociaciones a partir de títulos o texto libre.
"""

from __future__ import annotations

from typing import Any

ORIGENES = {"juez", "regla", "mixta", "sin_verificar"}


def modelo_de(ctx: Any, rol: str) -> str | None:
    """Nombre del modelo configurado que ejecutó la tarea, si consta."""
    modelos = getattr(ctx, "modelos", None)
    lm = getattr(modelos, rol, None)
    if rol == "replica" and lm is None:
        lm = getattr(modelos, "juez", None)
    modelo = getattr(lm, "model", None)
    return modelo[:160] if isinstance(modelo, str) and modelo else None


def abrir_pista(ctx: Any, tipo: str, titulo: str, modelo: str | None, hipotesis_id: str | None = None) -> Any:
    """Vincula el trabajo a una iteración existente, también en arneses aislados."""
    iteracion_id = getattr(ctx, "iteracion_id", None)
    if not iteracion_id or not any(i.get("id") == iteracion_id and i.get("corridaId") == ctx.corrida_id for i in ctx.e.get("iteraciones", [])):
        return None
    return ctx.pista(None, tipo, titulo, modelo or "ROSA2018", hipotesis_id=hipotesis_id)


def procedencia_veredicto(origen: str, modelo: str | None = None, comprobaciones: list[str] | None = None) -> dict[str, Any]:
    """Procedencia explícita del trabajo ejecutado, nunca deducida del motivo."""
    if not isinstance(origen, str) or origen not in ORIGENES or (modelo is not None and not isinstance(modelo, str)):
        raise ValueError("Procedencia del veredicto no admitida")
    return {"origen": origen, "modelo": modelo[:160] if modelo else None,
            "comprobaciones": _textos(comprobaciones or [], 16, 240)}


def metadatos_veredicto(afirmacion: dict[str, Any]) -> dict[str, Any]:
    """Copia únicamente el contrato explícito; los registros anteriores no se infieren."""
    origen = afirmacion.get("procedenciaVeredicto")
    if not isinstance(origen, dict):
        return {}
    try:
        return {"procedenciaVeredicto": procedencia_veredicto(origen.get("origen"), origen.get("modelo"), origen.get("comprobaciones"))}
    except ValueError:
        return {}


def _textos(valores: Any, limite: int, longitud: int, *, ids: bool = False) -> list[str]:
    if not isinstance(valores, list) or any(not isinstance(x, str) for x in valores):
        raise ValueError("Lista textual del evento no válida")
    if ids and any(not x.strip() or len(x) > 512 or any(c in x for c in "\n\r\x00") for x in valores):
        raise ValueError("Identificador del evento no válido")
    return [x[:longitud] for x in valores[:limite]]


def _hallazgos(valores: Any) -> list[dict[str, str]]:
    campos = {"id", "clase", "gravedad", "estado", "origen", "detalle"}
    if not isinstance(valores, list):
        raise ValueError("Hallazgos del evento no válidos")
    salida = []
    for h in valores[:24]:
        if not isinstance(h, dict) or set(h) != campos or any(not isinstance(x, str) for x in h.values()):
            raise ValueError("Hallazgo del evento no válido")
        _textos([h["id"]], 1, 512, ids=True)
        salida.append({k: v[:512 if k == "id" else 320 if k == "detalle" else 64] for k, v in h.items()})
    return salida


def validar(evento: dict[str, Any]) -> dict[str, Any]:
    """Valida la unión discriminada y copia exclusivamente sus campos públicos."""
    contratos = {
        "articulo": {"tipo", "id", "titulo", "estado", "motivo", "modo"},
        "idea": {"tipo", "hipotesisId", "titulo", "enfoque"},
        "torneo": {"tipo", "hipotesisAId", "hipotesisBId", "tituloA", "tituloB", "estado", "porRegla"},
        "analisis": {"tipo", "ejecucionId", "estado", "sintetico"},
        "decision_hipotesis": {"tipo", "hipotesisId", "version", "etapa", "estado", "decision", "comprobaciones", "hechoIds", "modelo", "origen"},
        "revision_registro": {"tipo", "iteracionId", "etapa", "estado", "vuelta", "hallazgos", "totalHallazgos", "comprobaciones", "modelo", "origen"},
        "asignacion_hecho": {"tipo", "hechoId", "afirmacionIds", "estado", "enunciado"},
    }
    tipo = evento.get("tipo") if isinstance(evento, dict) else None
    if not isinstance(tipo, str) or tipo not in contratos or set(evento) != contratos[tipo]:
        raise ValueError("Contrato de evento del laboratorio no admitido")
    salida: dict[str, Any] = {}
    for campo, valor in evento.items():
        if campo in {"version", "vuelta", "totalHallazgos"}:
            if type(valor) is not int or valor < (1 if campo == "version" else 0):
                raise ValueError("Versión del evento no válida")
            salida[campo] = valor
            continue
        if campo == "modelo" and valor is None:
            salida[campo] = None
            continue
        if campo in {"comprobaciones", "hechoIds", "afirmacionIds"}:
            salida[campo] = _textos(valor, 32 if campo != "comprobaciones" else 16, 512 if campo != "comprobaciones" else 240, ids=campo != "comprobaciones")
            continue
        if campo == "hallazgos":
            salida[campo] = _hallazgos(valor)
            continue
        if campo in {"porRegla", "sintetico"}:
            if type(valor) is not bool:
                raise ValueError("La marca del evento debe ser booleana")
            salida[campo] = valor
            continue
        if not isinstance(valor, str) or (campo not in {"motivo", "decision"} and not valor.strip()):
            raise ValueError("Campo textual del evento no válido")
        if campo in {"id", "hipotesisId", "hipotesisAId", "hipotesisBId", "ejecucionId", "iteracionId", "hechoId"}:
            if len(valor) > 512 or any(c in valor for c in "\n\r\x00"):
                raise ValueError("Identificador del evento no válido")
            salida[campo] = valor
        else:
            salida[campo] = valor[:320 if campo in {"titulo", "tituloA", "tituloB", "enunciado"} else 240 if campo in {"motivo", "decision"} else 160 if campo == "modelo" else 64]
    estados = {
        "articulo": {"incluido", "excluido", "no_comprobado"},
        "torneo": {"comparando", "a", "b", "tablas", "no_comprobado"},
        "analisis": {"programando", "ejecutando", "terminado", "fallido", "interpretando", "auditando"},
        "decision_hipotesis": {"en_curso", "terminado", "no_comprobado"},
        "revision_registro": {"en_curso", "terminado", "no_comprobado"},
        "asignacion_hecho": {"nuevo", "fundido"},
    }
    if tipo in estados and evento["estado"] not in estados[tipo]:
        raise ValueError("Estado de evento del laboratorio no admitido")
    if tipo == "articulo" and evento["modo"] not in {"foco", "amplitud"}:
        raise ValueError("Modo de cribado del evento no admitido")
    if tipo == "torneo" and evento["hipotesisAId"] == evento["hipotesisBId"]:
        raise ValueError("Un partido necesita dos hipótesis distintas")
    if tipo in {"decision_hipotesis", "revision_registro"} and evento["origen"] not in ORIGENES:
        raise ValueError("Origen del evento no admitido")
    if tipo == "decision_hipotesis" and evento["etapa"] not in {"revision_inicial", "supuestos", "killer", "viabilidad", "conclusion", "asignacion"}:
        raise ValueError("Etapa de decisión no admitida")
    if tipo == "revision_registro" and evento["etapa"] not in {"revision", "reparacion", "comprobacion_reparacion", "resumen"}:
        raise ValueError("Etapa de revisión no admitida")
    if tipo == "revision_registro" and evento["totalHallazgos"] < len(evento["hallazgos"]):
        raise ValueError("Total de hallazgos incompatible con la lista")
    return salida


def registrar(pista: Any, tipo: str, texto: str, evento: dict[str, Any]) -> None:
    """Conserva la línea original también en dobles sin el contrato opcional.

    Los dobles históricos solo implementan accion/resultado/nota/error. La
    ausencia de soporte omite los metadatos, nunca el registro científico.
    Los errores del método real se propagan: no se oculta un contrato inválido.
    """
    if pista is None:
        return
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


def decision_hipotesis(h: dict[str, Any], etapa: str, estado: str, decision: str = "", *, origen: str, modelo: str | None = None, comprobaciones: list[str] | None = None, hecho_ids: list[str] | None = None) -> dict[str, Any]:
    return {"tipo": "decision_hipotesis", "hipotesisId": h["id"], "version": h.get("version", 1), "etapa": etapa,
            "estado": estado, "decision": decision, "origen": origen, "modelo": modelo,
            "comprobaciones": comprobaciones or [], "hechoIds": hecho_ids or []}


def revision_registro(iteracion_id: str, etapa: str, estado: str, *, origen: str, modelo: str | None = None, vuelta: int = 0, hallazgos: list[dict[str, Any]] | None = None, comprobaciones: list[str] | None = None) -> dict[str, Any]:
    return {"tipo": "revision_registro", "iteracionId": iteracion_id, "etapa": etapa, "estado": estado,
            "origen": origen, "modelo": modelo, "vuelta": vuelta, "comprobaciones": comprobaciones or [], "totalHallazgos": len(hallazgos or []),
            "hallazgos": [{k: str(h.get(k) or "") for k in ("id", "clase", "gravedad", "estado", "origen", "detalle")} for h in (hallazgos or [])]}
