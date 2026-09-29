"""El tablero del método: cómo está investigando ROSA2018, medido por regla.

Por qué existe (29 de septiembre de 2026). Esa madrugada se contaron las
relaciones de las 34 hipótesis de la base: 117 afirmaciones a favor y UNA en
contra. Y 127 cuestiones abiertas de las que, en la investigación que más tenía,
ninguna llegaba al criterio de búsqueda. Las dos cosas llevaban semanas delante
de todos los papeles de ROSA2018 que leen (el equipo que genera, el Killer, el
juez, el torneo, la meta-revisión, el revisor del arnés) y ninguno las vio. Se
vieron contando, en segundos. Un sesgo repartido entre 34 hipótesis no se ve
leyendo hipótesis una a una: se ve sumando.

Lo que se sabe de cómo hacerlo, y que este módulo sigue:

- El auditor lee las TRAZAS, no el resultado. Luo, Kasirzadeh y Shah (NeurIPS
  2025, arXiv 2509.08713) auditaron dos AI scientists: con el artículo final
  solo, el auditor detectó el 55 % de los fallos de método; con las trazas y el
  código, el 82 %. Aquí todo sale de lo que ROSA2018 dejó escrito mientras
  trabajaba (decisiones del Killer, consultas a conectores, cuestiones, pistas
  del equipo), no de los dossiers.
- Las cifras las pone una regla. El Supervisor del Co-Scientist (arXiv
  2502.18864) calcula estadísticas del estado, incluida la eficacia de cada
  método de generar hipótesis, y con eso reparte el trabajo. Kosmos (arXiv
  2511.02824) no tiene ningún paso que revise su propio proceso, y es en la
  síntesis donde falla: 57,9 % de sus afirmaciones de interpretación se sostienen
  frente al 85,5 % de las de análisis.
- Cada aviso apunta a la fase que lo produce (búsqueda, cribado, Killer, equipo,
  conectores, bucle), como el enrutado de debilidades de AI-Supervisor (arXiv
  2603.24402), para que quien lo lea sepa dónde tocar.

Lo que NO hace: no decide nada. No cambia la certeza, no suspende ni descarta,
no toca el plan. Un modelo lo lee al terminar la corrida (el revisor del arnés,
`RevisarArnes`) y sus propuestas pasan por la puerta de siempre: las decide una
persona. Tampoco gasta llamadas: son sumas sobre el estado.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import verificador as V

# ---------------------------------------------------------------------------
# Umbrales. Cada uno con el porqué: cambiarlos es una decisión de método.
# ---------------------------------------------------------------------------

# A partir de cuántos apoyos sin una sola contra una hipótesis preocupa. Con uno o
# dos puede no haber dado tiempo; con cuatro son cuatro fuentes leídas que apuntan
# todas al mismo lado. Lo usa también la regla que abre la cuestión al cerrar
# iteración (rosa/bucle/corrida.py `_cuestiones_por_falta_de_contraste`).
APOYOS_SIN_CONTRA_QUE_PREOCUPAN = 4

# La balanza entera de la investigación: con al menos 20 afirmaciones con relación,
# que menos del 5 % tire en contra es la firma de no haber buscado lo que refuta.
# Una revisión sistemática honesta sobre un biomarcador casi nunca baja del 10 %.
MINIMO_PARA_BALANZA = 20
FRACCION_EN_CONTRA_MINIMA = 0.05

# Las cuestiones abiertas: si hay 10 o más y se ha resuelto menos del 10 % de las
# que se abrieron, ROSA2018 está apuntando lo que le falta y no yendo a buscarlo.
MINIMO_CUESTIONES = 10
FRACCION_RESUELTAS_MINIMA = 0.10

# El embudo del Killer: con 5 o más hipótesis vivas, que más de la mitad estén
# suspendidas dice que el embudo está atascado (entran y no salen hacia ningún
# lado), no que las hipótesis sean malas.
MINIMO_VIVAS = 5
FRACCION_SUSPENDIDAS_MAXIMA = 0.5

# La concentración: con 6 o más vivas, que el 60 % nombre la misma cosa que el
# objetivo NO pide es que el generador colapsa hacia lo mismo (lo que Shen,
# Druckmann y Zou midieron: 1,6 % de novedad pidiendo soluciones a secas).
MINIMO_PARA_CONCENTRACION = 6
FRACCION_CONCENTRACION_MAXIMA = 0.6

# Los conectores: si en una corrida con consultas a conectores se tocan menos de
# la cuarta parte de los disponibles, el bucle no llega a la mayoría.
FRACCION_CONECTORES_MINIMA = 0.25

# El tiempo: más del 15 % de la pared activa (sin pausas ni esperas a una persona)
# sin ninguna llamada al modelo viva es tiempo que ROSA2018 pasa en otra cosa.
FRACCION_SIN_ATRIBUIR_MAXIMA = 0.15

# Un hueco de 5 minutos o más sin NINGUNA acción en el registro de auditoría es que
# el servidor estaba parado o colgado: mientras vive, el bucle escribe un `tick`
# cada 10 a 30 segundos (medido sobre las corridas de septiembre de 2026). Sin
# separarlo, una corrida que pasó 3.755 de sus 3.900 minutos apagada salía como
# 3.805 minutos de "ROSA2018 haciendo otra cosa".
HUECO_SIN_SERVIDOR_MS = 5 * 60_000

# Por debajo de 20 minutos activos el reparto no dice nada: un arranque y un cierre
# ya son una fracción grande.
MINIMO_ACTIVO_MS = 20 * 60_000

# Siglas que parecen genes y no lo son, para la concentración.
_NO_ENTIDAD = {"LCR", "PET", "MRI", "RMN", "SNC", "IC", "HR", "OR", "MCI", "AD", "EA", "DCL", "CI", "ADN", "ARN", "DNA", "RNA", "USA", "OMS", "FDA", "EMA", "II", "III", "IV", "NO"}

FASES = ("busqueda", "cribado", "killer", "equipo", "conectores", "bucle")

# La versión de las reglas del tablero. Se sube al cambiar un umbral, un
# indicador o una frase: un tablero guardado con reglas anteriores no se lee como
# vigente y el bucle lo rehace (`Supervisor._tableros_que_faltan`), igual que las
# conclusiones se reacotan cuando cambia rosa/certeza.py.
VERSION_REGLAS = 4


def _indicador(clave: str, titulo: str, estado: str, cifra: str, texto: str, fase: str, que_haria_falta: str = "", **datos: Any) -> dict[str, Any]:
    return {"clave": clave, "titulo": titulo, "estado": estado, "cifra": cifra, "texto": texto, "fase": fase, "queHariaFalta": que_haria_falta, "datos": datos}


def _de_la_investigacion(e: dict[str, Any], inv_id: str) -> list[dict[str, Any]]:
    return [h for h in (e.get("hipotesis") or []) if isinstance(h, dict) and h.get("investigacionId") == inv_id]


def _vivas(hs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [h for h in hs if h.get("estado") != "descartada"]


# ---------------------------------------------------------------------------
# 1. La balanza
# ---------------------------------------------------------------------------


def balanza(e: dict[str, Any], inv_id: str) -> dict[str, Any]:
    """Afirmaciones a favor y en contra de las hipótesis vivas, y cuáles llevan
    apoyos sin una sola contra."""
    a_favor = en_contra = 0
    sin_contraste: list[dict[str, Any]] = []
    for h in _vivas(_de_la_investigacion(e, inv_id)):
        rel = [str(a.get("relacion") or "") for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
        f = sum(1 for r in rel if r in ("apoya", "apoya_indirecta"))
        c = sum(1 for r in rel if r in ("contradice", "socava"))
        a_favor += f
        en_contra += c
        if c == 0 and f >= APOYOS_SIN_CONTRA_QUE_PREOCUPAN:
            sin_contraste.append({"id": h.get("id"), "titulo": str(h.get("titulo") or "")[:90], "aFavor": f})
    sin_contraste.sort(key=lambda x: -x["aFavor"])
    total = a_favor + en_contra
    cifra = f"{a_favor} a favor, {en_contra} en contra"
    if total < MINIMO_PARA_BALANZA:
        return _indicador("balanza", "Lo que apoya frente a lo que contradice", "sin_datos", cifra, f"Todavía hay pocas afirmaciones con relación ({total}; hacen falta {MINIMO_PARA_BALANZA} para leer la balanza).", "cribado", aFavor=a_favor, enContra=en_contra, sinContraste=sin_contraste)
    fraccion = en_contra / total
    if fraccion < FRACCION_EN_CONTRA_MINIMA:
        texto = ("Ninguna de las afirmaciones enlazadas tira en contra" if en_contra == 0 else f"Solo el {fraccion * 100:.0f} % de las afirmaciones enlazadas tira en contra") + (f", y {len(sin_contraste)} {'hipótesis acumula' if len(sin_contraste) == 1 else 'hipótesis acumulan'} {APOYOS_SIN_CONTRA_QUE_PREOCUPAN} o más apoyos sin ninguna contra" if sin_contraste else "") + ". La literatura real de una hipótesis biológica no se ve así: es la firma de no haber buscado lo que la refuta, no de que sea cierta."
        return _indicador("balanza", "Lo que apoya frente a lo que contradice", "aviso", cifra, texto, "cribado", "Búsquedas dirigidas al criterio de refutación de cada hipótesis (el efecto nulo, el signo contrario, la réplica que no sale) y un cribado que las puntúe alto.", aFavor=a_favor, enContra=en_contra, sinContraste=sin_contraste)
    return _indicador("balanza", "Lo que apoya frente a lo que contradice", "bien", cifra, f"El {fraccion * 100:.0f} % de las afirmaciones enlazadas tira en contra: ROSA2018 está encontrando lo que contradice, no solo lo que confirma.", "cribado", aFavor=a_favor, enContra=en_contra, sinContraste=sin_contraste)


# ---------------------------------------------------------------------------
# 2. Las cuestiones
# ---------------------------------------------------------------------------


def cuestiones(e: dict[str, Any], inv_id: str) -> dict[str, Any]:
    """Cuántas de las preguntas que ROSA2018 se apunta llega a cerrar."""
    propias = [c for c in (e.get("cuestiones") or []) if isinstance(c, dict) and c.get("investigacionId") == inv_id]
    abiertas = [c for c in propias if c.get("estado") == "abierta"]
    resueltas = [c for c in propias if c.get("estado") == "resuelta"]
    por_origen: dict[str, int] = {}
    for c in abiertas:
        o = str((c.get("origen") or {}).get("tipo") or "otro")
        por_origen[o] = por_origen.get(o, 0) + 1
    cifra = f"{len(abiertas)} abiertas, {len(resueltas)} resueltas"
    cerradas_o_abiertas = len(abiertas) + len(resueltas)
    if len(abiertas) < MINIMO_CUESTIONES:
        return _indicador("cuestiones", "Las preguntas que se apunta, ¿las cierra?", "sin_datos", cifra, f"{len(abiertas)} cuestiones abiertas: por debajo de {MINIMO_CUESTIONES} no se lee como atasco.", "busqueda", abiertas=len(abiertas), resueltas=len(resueltas), porOrigen=por_origen)
    fraccion = len(resueltas) / cerradas_o_abiertas if cerradas_o_abiertas else 0.0
    origen_txt = ", ".join(f"{n} {_ORIGEN_EN_LLANO.get(o, o)}" for o, n in sorted(por_origen.items(), key=lambda x: -x[1]))
    if fraccion < FRACCION_RESUELTAS_MINIMA:
        return _indicador("cuestiones", "Las preguntas que se apunta, ¿las cierra?", "aviso", cifra, f"Ha resuelto el {fraccion * 100:.0f} % de las cuestiones que abrió ({origen_txt}). ROSA2018 apunta lo que le falta y no va a buscarlo: cada cuestión del Killer o de la escalera es algo concreto que haría avanzar una hipótesis.", "busqueda", "Que las cuestiones lleguen al criterio de búsqueda de cada paso (tienen tres líneas reservadas desde el 29 de septiembre de 2026) y rotar las que llevan más tiempo abiertas.", abiertas=len(abiertas), resueltas=len(resueltas), porOrigen=por_origen)
    return _indicador("cuestiones", "Las preguntas que se apunta, ¿las cierra?", "bien", cifra, f"Ha resuelto el {fraccion * 100:.0f} % de las cuestiones que abrió.", "busqueda", abiertas=len(abiertas), resueltas=len(resueltas), porOrigen=por_origen)


_ORIGEN_EN_LLANO = {"pregunta_modelo": "del modelo de mundo", "killer": "del Killer", "escalera": "de la escalera de certeza", "persona": "de una persona", "analisis": "de un análisis", "revisor": "del revisor", "paso_fallido": "de un paso fallido", "laboratorio": "del laboratorio"}


# ---------------------------------------------------------------------------
# 3. El embudo del Killer
# ---------------------------------------------------------------------------


def _ultima_decision(e: dict[str, Any], hipotesis_id: str) -> dict[str, Any] | None:
    ds = [d for d in (e.get("decisiones") or []) if isinstance(d, dict) and d.get("hipotesisId") == hipotesis_id and d.get("comprobaciones")]
    return max(ds, key=lambda d: int(d.get("fecha") or 0)) if ds else None


def embudo(e: dict[str, Any], inv_id: str) -> dict[str, Any]:
    """Cuántas vivas están suspendidas y qué comprobación las para."""
    vivas = _vivas(_de_la_investigacion(e, inv_id))
    suspendidas = [h for h in vivas if h.get("decisionKiller") == "suspender"]
    fallan: dict[str, int] = {}
    sin_comprobar: dict[str, int] = {}
    tecnicas = 0
    for h in suspendidas:
        d = _ultima_decision(e, str(h.get("id")))
        if d is None:
            continue
        if d.get("sinJuez"):
            tecnicas += 1
        for c in d.get("comprobaciones") or []:
            if not isinstance(c, dict):
                continue
            nombre = str(c.get("comprobacion") or "")
            if c.get("resultado") == "falla":
                fallan[nombre] = fallan.get(nombre, 0) + 1
            elif c.get("resultado") == "no_comprobable":
                sin_comprobar[nombre] = sin_comprobar.get(nombre, 0) + 1
    cifra = f"{len(suspendidas)} de {len(vivas)} vivas suspendidas"
    datos: dict[str, Any] = {"vivas": len(vivas), "suspendidas": len(suspendidas), "tecnicas": tecnicas, "fallan": fallan, "sinComprobar": sin_comprobar}
    if len(vivas) < MINIMO_VIVAS:
        return _indicador("embudo", "El embudo del Killer", "sin_datos", cifra, f"Hay {len(vivas)} hipótesis vivas: por debajo de {MINIMO_VIVAS} no se lee el embudo.", "killer", **datos)
    if len(suspendidas) / len(vivas) > FRACCION_SUSPENDIDAS_MAXIMA:
        principales = sorted(fallan.items(), key=lambda x: -x[1])[:3]
        pendientes = sorted(sin_comprobar.items(), key=lambda x: -x[1])[:3]
        texto = f"Más de la mitad de las hipótesis vivas está suspendida ({len(suspendidas)} de {len(vivas)}): entran y no salen hacia ningún lado."
        if principales:
            texto += " Lo que más falla: " + ", ".join(f"{n.replace('_', ' ')} ({k})" for n, k in principales) + "."
        if pendientes:
            texto += " Lo que más se queda sin comprobar: " + ", ".join(f"{n.replace('_', ' ')} ({k})" for n, k in pendientes) + "."
        if tecnicas:
            texto += " 1 de las suspensiones es técnica: el juez no respondió." if tecnicas == 1 else f" {tecnicas} de las suspensiones son técnicas: el juez no respondió."
        return _indicador("embudo", "El embudo del Killer", "aviso", cifra, texto, "killer", "Atacar primero la comprobación que más suspende: si es por no poder comprobarse, conseguir el dato (una base, una búsqueda dirigida); si es porque falla, decidir si la hipótesis se reformula o se descarta.", **datos)
    return _indicador("embudo", "El embudo del Killer", "bien", cifra, f"{len(suspendidas)} de {len(vivas)} vivas suspendidas: el embudo se mueve.", "killer", **datos)


# ---------------------------------------------------------------------------
# 4. La eficacia de cada enfoque del equipo
# ---------------------------------------------------------------------------

_ENTRA_POR_ENFOQUE = re.compile(r"Entra por el enfoque «([^»]+)» \(ronda \d+, \d+ puntos\): (.+)")


def enfoques_desde_la_traza(e: dict[str, Any], inv_id: str) -> dict[str, str]:
    """{hipotesis_id: enfoque} para las hipótesis que nacieron del equipo antes de
    que el enfoque se guardara en la hipótesis (29 de septiembre de 2026). Sale de
    la nota de la pista ("Entra por el enfoque «analogia» (ronda 2, 7 puntos):
    título") casada por título normalizado, que es lo que quedó escrito."""
    corridas = {c.get("id") for c in (e.get("corridas") or []) if isinstance(c, dict) and c.get("investigacionId") == inv_id}
    por_titulo: dict[str, str] = {}
    for it in e.get("iteraciones") or []:
        if not isinstance(it, dict) or it.get("corridaId") not in corridas:
            continue
        for p in it.get("pistas") or []:
            for linea in (p.get("transcripcion") or []) if isinstance(p, dict) else []:
                m = _ENTRA_POR_ENFOQUE.match(str((linea or {}).get("texto") or "") if isinstance(linea, dict) else "")
                if m:
                    por_titulo[V.normalizar(m.group(2))[:60]] = m.group(1)
    salida: dict[str, str] = {}
    for h in _de_la_investigacion(e, inv_id):
        clave = V.normalizar(str(h.get("titulo") or ""))[:60]
        if clave and clave in por_titulo:
            salida[str(h.get("id"))] = por_titulo[clave]
    return salida


def enfoque_de(h: dict[str, Any], desde_traza: dict[str, str]) -> str:
    if h.get("origen") == "humana":
        return "persona"
    return str(h.get("enfoque") or desde_traza.get(str(h.get("id"))) or "generador_unico")


ENFOQUE_EN_LLANO = {"analogia": "analogía", "contradiccion": "contradicción", "mecanismo_opuesto": "mecanismo opuesto", "otra_escala": "otra escala", "generador_unico": "generador único", "persona": "una persona"}


def _n(k: int, singular: str, plural: str) -> str:
    return f"{k} {singular if k == 1 else plural}"


def eficacia_por_enfoque(e: dict[str, Any], inv_id: str) -> dict[str, Any]:
    """Por enfoque del equipo (analogía, contradicción, mecanismo opuesto, otra
    escala) y por el generador único de antes: cuántas nacieron y qué fue de ellas.
    Es la estadística que el Supervisor del Co-Scientist usa para repartir el
    trabajo entre sus métodos de generar ideas."""
    traza = enfoques_desde_la_traza(e, inv_id)
    tabla: dict[str, dict[str, int]] = {}
    for h in _de_la_investigacion(e, inv_id):
        f = tabla.setdefault(enfoque_de(h, traza), {"nacidas": 0, "avanzan": 0, "suspendidas": 0, "descartadas": 0, "conCertezaBaja": 0})
        f["nacidas"] += 1
        d = h.get("decisionKiller")
        if h.get("estado") == "descartada" or d == "descartar_en_contexto":
            f["descartadas"] += 1
        elif d == "avanzar":
            f["avanzan"] += 1
        elif d == "suspender":
            f["suspendidas"] += 1
        if (h.get("conclusion") or {}).get("certeza") in ("baja", "moderada", "alta"):
            f["conCertezaBaja"] += 1
    del_equipo = {k: v for k, v in tabla.items() if k not in ("generador_unico", "persona")}
    n_equipo = sum(v["nacidas"] for v in del_equipo.values())
    cifra = f"{n_equipo} del equipo, {tabla.get('generador_unico', {}).get('nacidas', 0)} del generador único"
    if n_equipo < 3:
        return _indicador("enfoques", "Qué forma de generar ideas funciona", "sin_datos", cifra, f"Solo {n_equipo} hipótesis salieron del equipo de enfoques: pocas para comparar qué enfoque rinde. Las demás son del generador único de antes del equipo.", "equipo", tabla=tabla)
    # Un enfoque que ya produjo tres y ninguna avanza ni llega a certeza baja,
    # mientras otro sí tiene alguna, es trabajo mal repartido.
    muertos = [k for k, v in del_equipo.items() if v["nacidas"] >= 3 and v["avanzan"] == 0 and v["conCertezaBaja"] == 0]
    vivos = [k for k, v in del_equipo.items() if v["avanzan"] > 0 or v["conCertezaBaja"] > 0]
    llano = lambda k: ENFOQUE_EN_LLANO.get(k, k.replace("_", " "))  # noqa: E731
    resumen = "; ".join(f"{llano(k)}: {_n(v['nacidas'], 'nacida', 'nacidas')}, {_n(v['avanzan'], 'avanza', 'avanzan')}, {v['conCertezaBaja']} con certeza baja o más" for k, v in sorted(del_equipo.items()))
    if not any(v["avanzan"] or v["conCertezaBaja"] for v in tabla.values()):
        # Nada de ningún origen avanza: comparar enfoques no discrimina nada. Es el
        # embudo, no el enfoque, y decir "bien" aquí sería engañoso.
        return _indicador("enfoques", "Qué forma de generar ideas funciona", "sin_datos", cifra, f"{resumen}. Ninguna hipótesis de ningún origen avanza ni llega a certeza baja todavía, así que no se puede comparar qué enfoque rinde: lo que frena es el embudo, no el enfoque.", "equipo", tabla=tabla)
    if muertos and vivos:
        return _indicador("enfoques", "Qué forma de generar ideas funciona", "aviso", cifra, f"{resumen}. El enfoque {', '.join(llano(m) for m in muertos)} produce y nada de lo suyo avanza, mientras {', '.join(llano(v) for v in vivos)} sí.", "equipo", "Revisar el mandato del enfoque que no rinde o darle menos rondas; no quitarlo sin más, que la diversidad también es lo que se busca.", tabla=tabla)
    return _indicador("enfoques", "Qué forma de generar ideas funciona", "bien", cifra, resumen + ".", "equipo", tabla=tabla)


# ---------------------------------------------------------------------------
# 5. La concentración
# ---------------------------------------------------------------------------

_SIGLA = re.compile(r"\b[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]{1,6})?\b")


def _entidades(texto: str) -> set[str]:
    return {m.group(0) for m in _SIGLA.finditer(texto or "") if m.group(0) not in _NO_ENTIDAD and not m.group(0).isdigit()}


def _raiz(entidad: str) -> str:
    """La entidad sin el alelo o el número final: APOE4 y APOE-E4 son APOE, y
    P-TAU181 es P-TAU. Sirve SOLO para reconocer lo que el objetivo ya nombra: sin
    esto, "GFAP y NfL en portadores de APOE4" no reconocía el "APOE ε4" de sus
    propias hipótesis y el tablero avisaba de que todas hablaban de algo que el
    objetivo no pedía. Para contar no se usa, porque en un gen el número es la
    identidad: TREM1 y TREM2, SULF1 y SULF2 son genes distintos."""
    raiz = re.sub(r"\d+[A-Z]?$", "", entidad)
    raiz = re.sub(r"-E?$", "", raiz)
    return raiz or entidad


def concentracion(e: dict[str, Any], inv_id: str) -> dict[str, Any]:
    """Si las hipótesis vivas colapsan hacia la misma entidad (un gen, un
    biomarcador) que el objetivo NO nombra. Lo que el objetivo pide no cuenta:
    que todas las de "GFAP y NfL en APOE4" hablen de GFAP es la misión."""
    inv = next((i for i in (e.get("investigaciones") or []) if isinstance(i, dict) and i.get("id") == inv_id), {})
    del_objetivo = _entidades(f"{inv.get('titulo') or ''} {inv.get('objetivo') or ''} {inv.get('pregunta') or ''}")
    raices_objetivo = {_raiz(x) for x in del_objetivo}

    def lo_pide_el_objetivo(x: str) -> bool:
        return x in del_objetivo or x in raices_objetivo or _raiz(x) in del_objetivo
    vivas = _vivas(_de_la_investigacion(e, inv_id))
    cuenta: dict[str, int] = {}
    for h in vivas:
        for x in _entidades(f"{h.get('titulo') or ''} {h.get('enunciado') or ''}"):
            if not lo_pide_el_objetivo(x):
                cuenta[x] = cuenta.get(x, 0) + 1
    if len(vivas) < MINIMO_PARA_CONCENTRACION or not cuenta:
        return _indicador("concentracion", "¿Piensa siempre en lo mismo?", "sin_datos", f"{len(vivas)} vivas", f"Hay {len(vivas)} hipótesis vivas: por debajo de {MINIMO_PARA_CONCENTRACION} no se lee la concentración.", "equipo", cuenta=cuenta)
    top, n = max(cuenta.items(), key=lambda x: (x[1], x[0]))
    fraccion = n / len(vivas)
    cifra = f"{n} de {len(vivas)} nombran {top}"
    if fraccion >= FRACCION_CONCENTRACION_MAXIMA:
        return _indicador("concentracion", "¿Piensa siempre en lo mismo?", "aviso", cifra, f"El {fraccion * 100:.0f} % de las hipótesis vivas nombra {top}, que el objetivo no pide. El generador está colapsando hacia la misma idea.", "equipo", "Que el equipo reciba en el tablón lo que ya está sobrerrepresentado, y que el enfoque de analogía busque otra estructura.", entidad=top, cuenta=cuenta)
    return _indicador("concentracion", "¿Piensa siempre en lo mismo?", "bien", cifra, f"Lo más repetido que el objetivo no pide es {top}, en el {fraccion * 100:.0f} % de las vivas.", "equipo", entidad=top, cuenta=cuenta)


# ---------------------------------------------------------------------------
# 5 bis. Los nichos (MAP-Elites, rosa/nichos.py)
# ---------------------------------------------------------------------------


def nichos(e: dict[str, Any], inv_id: str, mapa: dict[str, Any] | None = None) -> dict[str, Any]:
    """Si las hipótesis vivas se amontonan en un rincón de la enfermedad mientras
    hay rincones con evidencia de dos cohortes y ninguna hipótesis. Y, de las que
    nacen desde el 29 de septiembre de 2026 (las que guardan su nicho), cuántas
    cayeron en uno vacío: es la comprobación de la predicción de
    ANALISIS-MAP-ELITES-2026-09-29.md."""
    from rosa import nichos as NI

    titulo = "¿Explora la enfermedad o se queda en un rincón?"
    if not isinstance(mapa, dict) or not mapa.get("fecha"):
        return _indicador("nichos", titulo, "sin_datos", "sin mapa", "El mapa de la enfermedad no se ha calculado todavía para esta investigación: se calcula al cerrar la próxima iteración.", "equipo")
    arch = NI.archivo(e, inv_id, mapa=mapa)
    ocupados, listos = arch.get("ocupados") or [], arch.get("listos") or []
    vivas = _vivas(_de_la_investigacion(e, inv_id))
    con_nicho = [h for h in vivas if isinstance(h.get("nicho"), dict)]
    en_listo = sum(1 for h in con_nicho if h["nicho"].get("enNichoListo"))
    cifra = f"{len(ocupados)} {'celda ocupada' if len(ocupados) == 1 else 'celdas ocupadas'}, {len(listos)} {'vacía' if len(listos) == 1 else 'vacías'} con evidencia"
    if not con_nicho:
        seguimiento = ""
    elif len(con_nicho) == 1:
        seguimiento = " La única que nació desde que se guarda el nicho " + ("cayó en un rincón vacío." if en_listo else "no cayó en un rincón vacío.")
    else:
        seguimiento = f" De las {len(con_nicho)} que nacieron desde que se guarda el nicho, " + ("ninguna cayó" if en_listo == 0 else "1 cayó" if en_listo == 1 else f"{en_listo} cayeron") + " en un rincón vacío."
    datos: dict[str, Any] = {"ocupadas": len(ocupados), "listos": len(listos), "saturada": NI.etiqueta(arch["saturada"]) if arch.get("saturada") else None, "conNicho": len(con_nicho), "enNichoListo": en_listo, "ejemplos": [x["etiqueta"] for x in listos[:3]]}
    if not ocupados and not listos:
        return _indicador("nichos", titulo, "sin_datos", cifra, "El mapa de la enfermedad no sitúa todavía ninguna hipótesis ni ningún hecho.", "equipo", **datos)
    saturada = next((o for o in ocupados if arch.get("saturada") and o["clave"] == tuple(arch["saturada"])), None)
    if saturada and listos:
        ejemplos = "; ".join(x["etiqueta"] for x in listos[:2])
        return _indicador("nichos", titulo, "aviso", cifra, f"{saturada['vivas']} hipótesis vivas en la misma celda ({saturada['etiqueta']}) mientras {len(listos)} {'rincón' if len(listos) == 1 else 'rincones'} con evidencia de dos cohortes o más no {'tiene' if len(listos) == 1 else 'tienen'} ninguna, por ejemplo: {ejemplos}.{seguimiento}", "equipo", "Que el equipo explore esos rincones (cada miembro, menos uno, recibe uno desde el 29 de septiembre de 2026) y comprobar en las próximas iteraciones que las nuevas caen fuera de la celda llena.", **datos)
    return _indicador("nichos", titulo, "bien", cifra, f"Ninguna celda acumula {NI.VIVAS_PARA_SATURAR} o más vivas con rincones listos sin explorar.{seguimiento}", "equipo", **datos)


# ---------------------------------------------------------------------------
# 6. Los conectores
# ---------------------------------------------------------------------------


def _registros_de_conector(o: Any, salida: list[dict[str, Any]], profundidad: int = 0) -> None:
    if profundidad > 6:
        return
    if isinstance(o, dict):
        if "herramienta" in o and "invariante" in o:
            salida.append(o)
            return
        for v in o.values():
            _registros_de_conector(v, salida, profundidad + 1)
    elif isinstance(o, list):
        for v in o:
            _registros_de_conector(v, salida, profundidad + 1)


def conectores(e: dict[str, Any], inv_id: str, corrida: dict[str, Any] | None) -> dict[str, Any]:
    """Cuántas bases distintas tocó la corrida frente a las que tiene."""
    disponibles = [c for c in (e.get("conectores") or []) if isinstance(c, dict) and c.get("estado") == "disponible" and c.get("permiso", "permitir") != "bloquear"]
    regs: list[dict[str, Any]] = []
    _registros_de_conector([h for h in _de_la_investigacion(e, inv_id)], regs)
    _registros_de_conector([i for i in (e.get("investigaciones") or []) if isinstance(i, dict) and i.get("id") == inv_id], regs)
    if corrida:
        desde = int(corrida.get("empezadaEn") or 0)
        hasta = int(corrida.get("terminadaEn") or 0) or 10**15
        regs = [r for r in regs if desde <= int(r.get("fecha") or 0) <= hasta]
    usados = sorted({str(r.get("herramienta")) for r in regs})
    errores = sum(1 for r in regs if r.get("error"))
    cifra = f"{len(usados)} de {len(disponibles)} disponibles"
    datos: dict[str, Any] = {"usados": usados, "disponibles": len(disponibles), "consultas": len(regs), "errores": errores}
    if not regs:
        return _indicador("conectores", "¿Usa las bases que tiene?", "sin_datos", cifra, "En esta corrida no hubo consultas a conectores.", "conectores", **datos)
    fraccion = len(usados) / len(disponibles) if disponibles else 1.0
    if fraccion < FRACCION_CONECTORES_MINIMA:
        return _indicador("conectores", "¿Usa las bases que tiene?", "aviso", cifra, f"{len(regs)} consultas a {len(usados)} bases distintas, siempre las del perfil de diana; de las {len(disponibles)} disponibles, el bucle no llega a las demás: solo las usa la pregunta con herramientas cuando la hace una persona.", "conectores", "Decidir si el bucle autónomo puede consultar las bases curadas para resolver supuestos y comprobaciones (cambia el coste de cada corrida: lo decide una persona).", **datos)
    return _indicador("conectores", "¿Usa las bases que tiene?", "bien", cifra, f"{len(regs)} consultas a {len(usados)} bases distintas.", "conectores", **datos)


# ---------------------------------------------------------------------------
# 7. El tiempo
# ---------------------------------------------------------------------------


def union_de_intervalos(filas: list[tuple[int, int]]) -> int:
    """Milisegundos con al menos una llamada viva. Las llamadas solapan (10 a 23 a
    la vez en la corrida 42), así que sumar sus duraciones da más que la pared."""
    tramos = sorted((int(t), int(t) + max(0, int(ms or 0))) for t, ms in filas if t is not None)
    total = 0
    fin = None
    ini = None
    for a, b in tramos:
        if fin is None or a > fin:
            if fin is not None and ini is not None:
                total += fin - ini
            ini, fin = a, b
        else:
            fin = max(fin, b)
    if fin is not None and ini is not None:
        total += fin - ini
    return total


def tramos_sin_servidor(instantes: list[int], desde: int, hasta: int, hueco: int = HUECO_SIN_SERVIDOR_MS) -> int:
    """Milisegundos de la ventana en huecos de `hueco` o más sin ninguna acción
    registrada: el servidor estaba parado o colgado."""
    ts = sorted(int(t) for t in instantes if desde <= int(t) <= hasta)
    bordes = [desde] + ts + [hasta]
    return sum(b - a for a, b in zip(bordes, bordes[1:]) if b - a >= hueco)


def tiempo(corrida: dict[str, Any] | None, intervalos_modelo: list[tuple[int, int]] | None, ahora: int, instantes_actividad: list[int] | None = None) -> dict[str, Any]:
    """En qué se va la pared de la corrida, en cuatro partes: con alguna llamada al
    modelo viva, esperando a una persona (pausas y aprobaciones), con el servidor
    apagado, y el resto, que es trabajo sin modelo (bases, fuentes, reglas) y es lo
    único que este indicador vigila. `instantes_actividad` son los `t` del registro
    de auditoría en la ventana; sin ellos no se puede separar el apagado."""
    titulo = "¿En qué se va el tiempo?"
    if not corrida or corrida.get("empezadaEn") in (None, ""):
        return _indicador("tiempo", titulo, "sin_datos", "sin corrida", "Todavía no hay corrida.", "bucle")
    if not corrida.get("terminadaEn") and corrida.get("estado") != "en_marcha":
        # Una corrida pausada o esperando no tiene fin: contar hasta ahora metía una
        # semana de pausa como tiempo activo (cor-mucppi81-3411, pausada por
        # presupuesto desde el 22 de septiembre, salía con 483 min "sin modelo").
        return _indicador("tiempo", titulo, "sin_datos", str(corrida.get("estado") or "sin estado").replace("_", " "), "La corrida no está en marcha ni ha terminado: el reparto del tiempo se calcula mientras corre o cuando termina.", "bucle")
    desde = int(corrida["empezadaEn"])
    hasta = int(corrida.get("terminadaEn") or ahora)
    pared = max(0, hasta - desde)
    esperas = int(corrida.get("pausaMs") or 0) + int(corrida.get("esperaHumanaMs") or 0)
    b = corrida.get("busqueda") or {}
    ms_bases, ms_fuentes = int(b.get("msBases") or 0), int(b.get("msFuentes") or 0)
    if intervalos_modelo is None:
        return _indicador("tiempo", titulo, "sin_datos", f"{pared / 60000:.0f} min de pared", "Sin el registro de llamadas no se puede repartir la pared.", "bucle", paredMs=pared, esperasMs=esperas)
    # Solo lo que cae DENTRO de la corrida: el relleno de fondo sigue llamando al
    # modelo después de que termine, y esas llamadas no son tiempo de la corrida.
    # (Contarlas fue el error del 29 de septiembre de 2026 que dio 47 min muertos
    # en la corrida 42; dentro de su ventana son 15.)
    dentro = [(max(int(t), desde), min(int(t) + int(ms or 0), hasta) - max(int(t), desde)) for t, ms in intervalos_modelo if t is not None and int(t) < hasta and int(t) + int(ms or 0) > desde]
    con_modelo = union_de_intervalos(dentro)
    apagado = tramos_sin_servidor(instantes_actividad, desde, hasta) if instantes_actividad is not None else 0
    # Lo que queda es una cota inferior: una espera a una persona con el servidor
    # apagado a la vez se resta dos veces. Mejor quedarse corto que acusar de más.
    sin_modelo = max(0, pared - con_modelo - esperas - apagado)
    activa = max(0, pared - esperas - apagado)
    datos: dict[str, Any] = {"paredMs": pared, "conModeloMs": con_modelo, "esperasMs": esperas, "apagadoMs": apagado, "sinModeloMs": sin_modelo, "activaMs": activa, "basesMs": ms_bases, "fuentesMs": ms_fuentes, "apagadoMedido": instantes_actividad is not None}
    reparto = f"De {pared / 60000:.0f} min de pared: {con_modelo / 60000:.0f} con el modelo trabajando, {esperas / 60000:.0f} esperando a una persona" + (f", {apagado / 60000:.0f} con el servidor apagado o colgado" if apagado else "") + f" y {sin_modelo / 60000:.0f} de trabajo sin modelo."
    lit = f" La literatura sumó {ms_bases / 60000:.0f} min en las bases y {ms_fuentes / 60000:.0f} min trayendo documentos (sumas de consultas que corren a la vez: se leen como carga, no como pared)." if (ms_bases or ms_fuentes) else " Esta corrida es anterior al cronómetro de la literatura (29 de septiembre de 2026): no se sabe cuánto del trabajo sin modelo fue traer documentos."
    cifra = f"{sin_modelo / 60000:.0f} min sin modelo de {activa / 60000:.0f} activos"
    if activa < MINIMO_ACTIVO_MS:
        return _indicador("tiempo", titulo, "sin_datos", cifra, f"{reparto} Con menos de {MINIMO_ACTIVO_MS // 60000} min activos el reparto no dice nada.", "bucle", **datos)
    fraccion = sin_modelo / activa
    if fraccion > FRACCION_SIN_ATRIBUIR_MAXIMA:
        return _indicador("tiempo", titulo, "aviso", cifra, f"{reparto} El {fraccion * 100:.0f} % del tiempo activo no tiene ninguna llamada al modelo viva.{lit}", "bucle", "Mirar el bucle que trae las fuentes de cada consulta, que corre en serie con dos llamadas de red por vuelta (Crossref y el resumen o el PDF), y los pasos que esperan a una base lenta.", **datos)
    return _indicador("tiempo", titulo, "bien", cifra, f"{reparto} El trabajo sin modelo es el {fraccion * 100:.0f} % del tiempo activo.{lit}", "bucle", **datos)


# ---------------------------------------------------------------------------
# El tablero
# ---------------------------------------------------------------------------


def ultima_corrida(e: dict[str, Any], inv_id: str) -> dict[str, Any] | None:
    cs = [c for c in (e.get("corridas") or []) if isinstance(c, dict) and c.get("investigacionId") == inv_id]
    return max(cs, key=lambda c: int(c.get("empezadaEn") or 0)) if cs else None


def tablero(e: dict[str, Any], inv_id: str, ahora: int, corrida: dict[str, Any] | None = None, intervalos_modelo: list[tuple[int, int]] | None = None, iteracion: int | None = None, instantes_actividad: list[int] | None = None, mapa: dict[str, Any] | None = None) -> dict[str, Any]:
    """Los siete indicadores de una investigación. Cada uno en su try: un registro
    raro deja ese indicador en "sin datos" con el motivo, no tumba el tablero."""
    corrida = corrida if corrida is not None else ultima_corrida(e, inv_id)
    if mapa is None:
        # El guardado en la investigación: al cerrar la iteración se acaba de
        # recalcular. Calcularlo aquí (hasta 0,9 s) bloquearía el bucle.
        inv = next((i for i in (e.get("investigaciones") or []) if isinstance(i, dict) and i.get("id") == inv_id), {})
        mapa = inv.get("mapaEnfermedad") if isinstance(inv.get("mapaEnfermedad"), dict) else {"celdas": []}
    calculos = (
        ("balanza", lambda: balanza(e, inv_id)),
        ("cuestiones", lambda: cuestiones(e, inv_id)),
        ("embudo", lambda: embudo(e, inv_id)),
        ("enfoques", lambda: eficacia_por_enfoque(e, inv_id)),
        ("concentracion", lambda: concentracion(e, inv_id)),
        ("nichos", lambda: nichos(e, inv_id, mapa)),
        ("conectores", lambda: conectores(e, inv_id, corrida)),
        ("tiempo", lambda: tiempo(corrida, intervalos_modelo, ahora, instantes_actividad)),
    )
    indicadores = []
    for clave, calcular in calculos:
        try:
            indicadores.append(calcular())
        except Exception as ex:  # noqa: BLE001  un indicador roto no tumba los demás
            indicadores.append(_indicador(clave, clave, "sin_datos", "no pude calcularlo", f"No pude calcular este indicador: {type(ex).__name__}: {str(ex)[:120]}", "bucle"))
    return {"fecha": ahora, "iteracion": iteracion, "corridaId": (corrida or {}).get("id"), "reglas": VERSION_REGLAS, "indicadores": indicadores, "avisos": [i["clave"] for i in indicadores if i["estado"] == "aviso"]}


def vigente(t: Any) -> bool:
    """El tablero guardado se calculó con las reglas de hoy."""
    return isinstance(t, dict) and t.get("reglas") == VERSION_REGLAS


def texto(t: dict[str, Any] | None) -> str:
    """El tablero para un modelo (el revisor del arnés): una línea por indicador,
    con la fase a la que apunta y qué haría falta."""
    if not t or not t.get("indicadores"):
        return "Tablero del método sin calcular."
    lineas = []
    for i in t["indicadores"]:
        marca = {"aviso": "AVISO", "bien": "bien", "sin_datos": "sin datos"}.get(i.get("estado"), i.get("estado"))
        linea = f"- [{marca}] {i.get('titulo')} ({i.get('cifra')}; fase: {i.get('fase')}): {i.get('texto')}"
        if i.get("estado") == "aviso" and i.get("queHariaFalta"):
            linea += f" Haría falta: {i['queHariaFalta']}"
        lineas.append(linea)
    return "\n".join(lineas)


def avisos_nuevos(anterior: dict[str, Any] | None, nuevo: dict[str, Any]) -> list[dict[str, Any]]:
    """Los indicadores que pasan a aviso respecto al tablero anterior. Solo eso se
    dice como evento: el mismo aviso cada iteración sería ruido."""
    antes = set((anterior or {}).get("avisos") or [])
    return [i for i in nuevo.get("indicadores") or [] if i.get("estado") == "aviso" and i.get("clave") not in antes]


def fijar(e: dict[str, Any], inv_id: str, t: dict[str, Any]) -> list[dict[str, Any]]:
    """Guarda el tablero en la investigación y devuelve los avisos nuevos."""
    inv = next((i for i in (e.get("investigaciones") or []) if isinstance(i, dict) and i.get("id") == inv_id), None)
    if inv is None:
        return []
    nuevos = avisos_nuevos(inv.get("metodo") if isinstance(inv.get("metodo"), dict) else None, t)
    inv["metodo"] = t
    return nuevos


__all__ = ["APOYOS_SIN_CONTRA_QUE_PREOCUPAN", "FASES", "avisos_nuevos", "balanza", "concentracion", "conectores", "cuestiones", "eficacia_por_enfoque", "embudo", "enfoques_desde_la_traza", "fijar", "nichos", "tablero", "texto", "tiempo", "tramos_sin_servidor", "ultima_corrida", "union_de_intervalos", "vigente", "VERSION_REGLAS"]
