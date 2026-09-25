"""Comprobaciones de cierre por etapa: cada paso del plan se cierra con una
comprobación escrita en código, sin modelo y sin red.

Es la idea de Yoon y otros (2026) traída literalmente: cada etapa se cierra con
una comprobación programada y ninguna tarea de una etapa posterior se abre hasta
que la anterior termina. Hasta hoy ROSA2018 distinguía tres finales de paso
(hecho, sin_trabajo, fallido) pero nadie comprobaba que la etapa produjera lo que
le tocaba: un paso que corrió, no reventó y no sirvió de nada quedaba en verde.
El estado dice si el paso TERMINÓ; la comprobación dice si SIRVIÓ.

Cuatro resultados, y la diferencia entre ellos es la regla de la casa ("no pude
comprobar", nunca "no hay"):

- `pasa`: la etapa produjo lo suyo.
- `sin_materia`: corrió y no tenía nada sobre lo que trabajar. No es un fallo.
- `falla`: tenía materia y no produjo nada.
- `no_comprobable`: una fuente o un modelo no respondió, así que no se puede
  decir. Una excepción nunca es "no hay".

El vocabulario es el que ya usan las comprobaciones del Killer
(`frontend/src/datos/tipos.ts`, `pasa` / `falla` / `no_comprobable`); lo único
nuevo es `sin_materia`, que es justo la distinción que el Killer no necesita.

Dos decisiones que sostienen lo demás. La primera: el estado del paso MANDA sobre
la comprobación en los dos casos ya resueltos. Un paso `sin_trabajo` (M-23) es
`sin_materia` por definición y uno `fallido` es `no_comprobable` por definición,
así que la comprobación solo añade información sobre los pasos que hoy quedan en
`hecho`, que son los que pasan sin que nadie mire. La segunda: se miden
contadores del estado antes y después, no se parsea el resumen del ejecutor. Hay
un caso en el que el resumen miente: `paso_novedad` devuelve "Novedad comprobada
en N hipótesis" donde N es cuántas intentó, no cuántas resolvió, y en el estado
guardado 20 de 28 hipótesis siguen con la novedad pendiente mientras 22 pasos de
novedad se cerraron como hechos.

Ninguna comprobación gasta una llamada al modelo ni abre una conexión.
"""

from __future__ import annotations

from typing import Any

RESULTADOS = ("pasa", "sin_materia", "falla", "no_comprobable")

# De qué etapa se alimenta cada etapa. La clave es el tipo de paso de
# `PASOS.EJECUTORES` y de `T.inferir_tipo_paso`.
DEPENDE_DE: dict[str, tuple[str, ...]] = {
    "extraccion": ("literatura", "ensayos"),
    "verificacion": ("extraccion",),
    "modelo": ("verificacion",),
    "hipotesis": ("modelo",),
    "novedad": ("hipotesis",),
    "meta": ("hipotesis",),
    "analisis": ("hipotesis",),
}

# La materia propia de cada etapa: la clave de `medir` que tiene que ser mayor
# que cero para que la etapa pueda producir algo por sí sola, venga de donde
# venga (también de iteraciones anteriores).
MATERIA: dict[str, tuple[str, ...]] = {
    "extraccion": ("fuentesSinExtraer",),
    "verificacion": ("sinVerificar",),
    "modelo": ("utilizables",),
    "hipotesis": ("utilizables", "hipotesisVivas"),
    "novedad": ("novedadPendiente",),
    "meta": ("hipotesisVivas",),
    "analisis": ("datasetsAprobados",),
}


def medir(e: dict[str, Any], corrida_id: str, investigacion_id: str) -> dict[str, int]:
    """Los contadores del estado que miran las comprobaciones. Solo lectura, y
    solo claves que existen de verdad en el estado guardado (comprobado el 25 de
    septiembre de 2026 sobre rosa.db: `_fallosFuente` y `vivero` son
    `setdefault`, así que pueden faltar)."""
    from rosa.bucle import pasos as PASOS

    c = next((x for x in e.get("corridas", []) if isinstance(x, dict) and x.get("id") == corrida_id), None) or {}
    inv = next((i for i in e.get("investigaciones", []) if isinstance(i, dict) and i.get("id") == investigacion_id), None) or {}
    afs = [a for a in (c.get("_afirmaciones") or []) if isinstance(a, dict)]
    fuentes = [f for f in (c.get("_fuentes") or {}).values() if isinstance(f, dict)]
    hips = [h for h in e.get("hipotesis", []) or [] if isinstance(h, dict) and h.get("investigacionId") == investigacion_id]
    vivas = [h for h in hips if h.get("estado") != "descartada"]
    b = c.get("busqueda") or {}
    return {
        "consultas": len(b.get("consultas") or []),
        "identificados": int(b.get("identificados") or 0),
        "cribados": int(b.get("cribados") or 0),
        "fuentes": len(fuentes),
        "fuentesSinExtraer": sum(1 for f in fuentes if not f.get("extraida") and f.get("retraccion") != "retractado"),
        "afirmaciones": len(afs),
        "conCita": sum(1 for a in afs if str(a.get("cita") or "").strip()),
        "sinVerificar": sum(1 for a in afs if a.get("veredicto") == "sin_verificar"),
        "utilizables": sum(1 for a in afs if a.get("veredicto") in ("sostenida", "parcial")),
        "hechos": sum(1 for h in e.get("hechos", []) or [] if isinstance(h, dict) and h.get("investigacionId") == investigacion_id and h.get("estado") != "descartado"),
        "cuestiones": sum(1 for q in e.get("cuestiones", []) or [] if isinstance(q, dict) and q.get("investigacionId") == investigacion_id),
        "hipotesis": len(hips),
        "hipotesisVivas": len(vivas),
        "partidos": sum(len(h.get("partidos") or []) for h in hips),
        "versiones": sum(int(h.get("version") or 0) for h in hips),
        "novedadPendiente": sum(1 for h in vivas if PASOS.novedad_pendiente(h)),
        "semillasVivero": len(inv.get("vivero") or []),
        "panorama": len(c.get("panorama") or []),
        "datasetsAprobados": sum(1 for d in (inv.get("datasets") or []) if isinstance(d, dict) and d.get("estado") == "aprobado" and (d.get("procedencia") or {}).get("hash")),
        "ejecucionesOk": sum(1 for r in e.get("ejecuciones", []) or [] if isinstance(r, dict) and r.get("investigacionId") == investigacion_id and r.get("estado") == "completado"),
        "fallosFuente": sum(int(v or 0) for v in (c.get("_fallosFuente") or {}).values()),
    }


def _n(n: int, singular: str, plural: str) -> str:
    """"1 hecho" y "2 hechos": el detalle de una comprobación lo lee una persona."""
    return f"{n} {singular if abs(n) == 1 else plural}"


def _r(etapa: str, resultado: str, detalle: str, cambio: dict[str, int], aviso: str | None = None) -> dict[str, Any]:
    """Una comprobación. `medida` se queda solo con lo que se movió: el estado no
    engorda con una docena de ceros por paso."""
    assert resultado in RESULTADOS, resultado
    salida: dict[str, Any] = {"etapa": etapa, "resultado": resultado, "detalle": detalle[:400], "medida": {k: v for k, v in cambio.items() if v}}
    if aviso:
        salida["aviso"] = aviso[:240]
    return salida


def comprobar(tipo: str, antes: dict[str, int], despues: dict[str, int], paso: dict[str, Any], resumen: Any, estado_paso: str) -> dict[str, Any] | None:
    """La comprobación de cierre de un paso ya ejecutado.

    `estado_paso` es el que acaba de fijar `_ejecutar_paso`: "sin_trabajo" es
    `sin_materia` por definición y "fallido" u "omitido" son `no_comprobable` (el
    paso no llegó a terminar). Un paso que volvió a "pendiente" (presupuesto,
    parada, modelo que no responde) no cerró ninguna etapa y no se comprueba:
    devuelve None. Los pasos de indicación humana y los de tipo desconocido
    tampoco."""
    d = {k: int(despues.get(k, 0)) - int(antes.get(k, 0)) for k in despues}
    if tipo in ("indicacion", "") or tipo not in _REGLAS:
        return None
    if estado_paso == "sin_trabajo":
        return _r(tipo, "sin_materia", str(resumen or "el paso no tenía nada sobre lo que trabajar"), d)
    if estado_paso in ("fallido", "omitido"):
        return _r(tipo, "no_comprobable", str(paso.get("motivoFallo") or "el paso no terminó, así que no se puede decir si la etapa produjo algo"), d)
    if estado_paso != "hecho":
        return None
    return _REGLAS[tipo](d, despues, paso)


def _literatura(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if d["consultas"] <= 0:
        return _r("literatura", "falla", "el cerebro no propuso ninguna consulta: la etapa no llegó a buscar", d)
    if d["fallosFuente"] > 0 and d["cribados"] <= 0:
        return _r("literatura", "no_comprobable", f"{d['fallosFuente']} consultas se quedaron sin respuesta de su base y no entró ninguna fuente: no es que no haya literatura, es que no se pudo consultar", d)
    if d["identificados"] <= 0:
        return _r("literatura", "falla", f"{_n(d['consultas'], 'consulta', 'consultas')} y 0 registros identificados: las consultas no casan con el índice de las bases", d)
    if d["cribados"] <= 0:
        escrito = str(paso.get("siNoAparece") or "").strip()
        return _r("literatura", "falla", f"{d['identificados']} registros identificados y ninguno pasó el cribado de relevancia" + (f". Lo escrito antes de buscar: {escrito[:160]}" if escrito else ""), d)
    aviso = "ninguna fuente nueva: todo lo relevante ya estaba en la corrida" if d["fuentes"] <= 0 else None
    return _r("literatura", "pasa", f"{d['cribados']} relevantes de {d['identificados']} identificados, {_n(d['fuentes'], 'fuente nueva', 'fuentes nuevas')}", d, aviso)


def _ensayos(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if d["fallosFuente"] > 0:
        return _r("ensayos", "no_comprobable", "ClinicalTrials.gov no respondió: un tiempo agotado no es 'sin ensayos'", d)
    if d["identificados"] <= 0:
        # La fuente contestó y dijo cero: eso sí es una respuesta.
        return _r("ensayos", "sin_materia", "ClinicalTrials.gov respondió con 0 estudios para esos términos: no hay ensayos registrados que casen", d)
    return _r("ensayos", "pasa", f"{_n(d['identificados'], 'estudio registrado', 'estudios registrados')}, {d['fuentes']} entraron como fuentes", d)


def _extraccion(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    leidas = -d["fuentesSinExtraer"] + max(d["fuentes"], 0)
    if leidas <= 0 and fin["fuentesSinExtraer"] <= 0:
        return _r("extraccion", "sin_materia", "ninguna fuente pendiente de extraer", d)
    if d["afirmaciones"] <= 0:
        return _r("extraccion", "falla", f"se leyeron fuentes y no salió ninguna afirmación (quedan {fin['fuentesSinExtraer']} sin extraer)", d)
    if d["conCita"] <= 0:
        return _r("extraccion", "falla", f"{_n(d['afirmaciones'], 'afirmación', 'afirmaciones')} y ninguna con cita: sin cita no son evidencia", d)
    return _r("extraccion", "pasa", f"{_n(d['afirmaciones'], 'afirmación nueva', 'afirmaciones nuevas')}, {d['conCita']} con cita", d)


def _verificacion(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    tratadas = -d["sinVerificar"] + max(d["afirmaciones"], 0)
    if fin["sinVerificar"] <= 0 and tratadas <= 0:
        return _r("verificacion", "sin_materia", "nada pendiente de verificar", d)
    if tratadas <= 0:
        return _r("verificacion", "no_comprobable", f"{_n(fin['sinVerificar'], 'afirmación sigue', 'afirmaciones siguen')} sin veredicto: el juez no llegó a ninguna", d)
    if d["utilizables"] <= 0:
        cuerpo = "la afirmación verificada quedó bloqueada" if tratadas == 1 else f"las {tratadas} afirmaciones verificadas quedaron bloqueadas"
        return _r("verificacion", "falla", f"{cuerpo}: ninguna sostenida ni parcial", d)
    parte = (tratadas - d["utilizables"]) / tratadas
    aviso = f"{round(parte * 100)} % de las {tratadas} verificadas quedaron bloqueadas" if parte >= 0.5 else None
    return _r("verificacion", "pasa", f"{d['utilizables']} de {tratadas} verificadas son utilizables", d, aviso)


def _modelo(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if fin["utilizables"] <= 0:
        return _r("modelo", "sin_materia", "ninguna afirmación sostenida ni parcial que integrar", d)
    if d["hechos"] <= 0 and d["cuestiones"] <= 0:
        return _r("modelo", "falla", f"había {fin['utilizables']} afirmaciones utilizables y el modelo de mundo no cambió: ni un hecho nuevo ni una pregunta abierta", d)
    return _r("modelo", "pasa", f"{_n(d['hechos'], 'hecho', 'hechos')} y {_n(d['cuestiones'], 'cuestión', 'cuestiones')} de más en el modelo de mundo", d)


def _hipotesis(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if fin["hipotesisVivas"] <= 0 and fin["utilizables"] <= 0:
        return _r("hipotesis", "sin_materia", "ni hipótesis vivas que revisar ni afirmaciones utilizables con las que proponer", d)
    movio = d["hipotesis"] > 0 or d["versiones"] > 0 or d["partidos"] > 0 or d["semillasVivero"] > 0
    if not movio:
        return _r("hipotesis", "falla", "no hubo hipótesis nuevas, ni revisadas, ni partidos, ni semillas al vivero", d)
    if d["hipotesis"] <= 0 and d["versiones"] <= 0 and d["semillasVivero"] <= 0:
        return _r("hipotesis", "pasa", _n(d["partidos"], "registro de partido", "registros de partido"), d, "solo partidos: ninguna hipótesis nueva ni revisada, el torneo recalienta lo que ya había")
    return _r("hipotesis", "pasa", f"{_n(d['hipotesis'], 'hipótesis nueva', 'hipótesis nuevas')}, {_n(d['versiones'], 'revisión', 'revisiones')}, {_n(d['partidos'], 'registro de partido', 'registros de partido')}, {d['semillasVivero']} al vivero", d)


def _novedad(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    resueltas = -d["novedadPendiente"]
    if fin["novedadPendiente"] <= 0 and resueltas <= 0:
        return _r("novedad", "sin_materia", "ninguna hipótesis con la novedad pendiente", d)
    if resueltas <= 0:
        # En novedad el fracaso es siempre de la fuente: nunca es "falla".
        return _r("novedad", "no_comprobable", f"{_n(fin['novedadPendiente'], 'hipótesis sigue', 'hipótesis siguen')} con la novedad pendiente: las bases no resolvieron ninguna", d)
    return _r("novedad", "pasa", f"{_n(resueltas, 'hipótesis dejó', 'hipótesis dejaron')} de tener la novedad pendiente; quedan {fin['novedadPendiente']}", d)


def _meta(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if fin["hipotesisVivas"] < 2:
        return _r("meta", "sin_materia", "menos de dos hipótesis vivas: no hay cartera que meta-revisar", d)
    if fin["panorama"] <= 0:
        return _r("meta", "falla", "el panorama salió vacío: la meta-revisión no dijo nada de la cartera", d)
    return _r("meta", "pasa", f"panorama con {fin['panorama']} entradas", d)


def _analisis(d: dict[str, int], fin: dict[str, int], paso: dict[str, Any]) -> dict[str, Any]:
    if fin["datasetsAprobados"] <= 0:
        return _r("analisis", "sin_materia", "ningún dataset aprobado con fichero: no hay sobre qué correr nada", d)
    if d["ejecucionesOk"] <= 0:
        return _r("analisis", "falla", f"había {fin['datasetsAprobados']} datasets aprobados y no se completó ninguna ejecución", d)
    return _r("analisis", "pasa", _n(d["ejecucionesOk"], "ejecución completada", "ejecuciones completadas"), d)


_REGLAS: dict[str, Any] = {
    "literatura": _literatura,
    "ensayos": _ensayos,
    "extraccion": _extraccion,
    "verificacion": _verificacion,
    "modelo": _modelo,
    "hipotesis": _hipotesis,
    "novedad": _novedad,
    "meta": _meta,
    "analisis": _analisis,
}


def puede_abrir(tipo: str, medida: dict[str, int], previos: dict[str, str]) -> str | None:
    """La puerta de la cadena: el motivo escrito por el que la etapa NO se abre,
    o None si se abre.

    Dos condiciones a la vez, no una. La etapa anterior tiene que haber salido
    `falla` o `no_comprobable` (nunca `sin_materia`: "no había nada" no es
    "falló"), y la etapa que se iba a abrir tiene que no tener materia propia
    medida, que puede venir de iteraciones anteriores. Esa doble condición es lo
    que impide que la puerta rompa el camino real: una segunda pasada de
    literatura puede no traer nada nuevo y la extracción se abre igualmente
    porque tiene fuentes sin extraer de la primera."""
    if any(int(medida.get(k, 0)) > 0 for k in MATERIA.get(tipo, ())):
        return None
    rotas = [t for t in DEPENDE_DE.get(tipo, ()) if previos.get(t) in ("falla", "no_comprobable")]
    if not rotas:
        return None
    return f"No se abre: la etapa de la que se alimenta ({', '.join(rotas)}) no produjo nada y esta no tiene materia propia. Se habría gastado en vacío"


def resumen_de_iteracion(it: dict[str, Any]) -> dict[str, Any]:
    """El recuento de las comprobaciones de la iteración, por regla. `vacia` es el
    caso extremo: ninguna etapa cumplió y al menos una falló. En las 50
    iteraciones guardadas ocurre exactamente una vez, la iteración en la que el
    cerebro devolvió un error de facturación del gateway y las cinco etapas
    siguientes giraron en vacío mientras la corrida seguía como si nada."""
    cs: list[dict[str, Any]] = [p["comprobacion"] for p in (it.get("plan") or []) if isinstance(p, dict) and isinstance(p.get("comprobacion"), dict)]
    cuenta: dict[str, int] = {r: sum(1 for c in cs if c.get("resultado") == r) for r in RESULTADOS}
    partes = []
    if cuenta["pasa"]:
        partes.append(f"{cuenta['pasa']} etapas cumplieron")
    if cuenta["sin_materia"]:
        partes.append(f"{cuenta['sin_materia']} no tenían nada sobre lo que trabajar")
    if cuenta["falla"]:
        partes.append(f"{cuenta['falla']} tenían materia y no produjeron nada")
    if cuenta["no_comprobable"]:
        partes.append(f"{cuenta['no_comprobable']} no se pudieron comprobar")
    return {
        "pasan": cuenta["pasa"],
        "sinMateria": cuenta["sin_materia"],
        "fallan": cuenta["falla"],
        "noComprobables": cuenta["no_comprobable"],
        "resumen": "; ".join(partes) or "Sin comprobaciones",
        "vacia": bool(cs) and cuenta["pasa"] == 0 and (cuenta["falla"] + cuenta["no_comprobable"]) > 0,
    }
