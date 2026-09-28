"""Las acciones de la interfaz, portadas de `frontend/src/datos/acciones.ts`.

Cada funcion recibe el estado (un diccionario con la forma de `EstadoRosa`) y
lo cambia en sitio. Devuelve `True` si cambio algo (o el id creado, cuando la
accion crea un objeto) y `False` si la regla del dominio no lo permitio. El
almacen (almacen.py) solo persiste y avisa cuando la accion devolvio algo
distinto de `False`.

Las reglas son las mismas que en el frontend, y en el mismo orden:
- La aprobacion va antes del efecto: aceptar una hipotesis la mete al modelo
  de mundo como abierta, nunca como sabida.
- Descartar y "no puedo juzgar" exigen motivo.
- Un permiso con alcance mayor que "una vez" queda listado y es revocable.
- Los comentarios se acumulan pendientes y salen juntos al enviar.
- El plan no se ejecuta hasta que se aprueba.
- El presupuesto pausa la corrida; una pregunta pendiente tiene prioridad.
- Toda accion relevante deja un evento.

Si el frontend genera el id (para navegar al instante), lo manda en `id` y
aqui se respeta; si no, se genera uno.
"""

from __future__ import annotations

import copy
import math

from datetime import datetime, timezone
from typing import Any

from rosa import certeza as CERTEZA, config, politicas
from rosa import parada as PARADA
from rosa import cuestiones as CU
from rosa import dependencias as DEP
from rosa import registro as REG
from rosa import datasets_programa as DP
from rosa import experimento as XP
from rosa import hechos as H
from rosa.estado import plantilla as P

Estado = dict[str, Any]


def _buscar(lista: list[dict], id_: str) -> dict | None:
    for x in lista:
        if x.get("id") == id_:
            return x
    return None


def con_evento(e: Estado, investigacion_id: str, tipo: str, texto: str, ruta: str | None, t: int) -> None:
    e["eventos"].append(P.nuevo_evento(investigacion_id, tipo, texto, ruta, t))


def iteracion_actual_de(e: Estado, corrida: dict) -> dict | None:
    propias = [i for i in e["iteraciones"] if i["corridaId"] == corrida["id"]]
    if not propias:
        return None
    return max(propias, key=lambda i: i["numero"])


def corrida_de(e: Estado, corrida_id: str) -> dict | None:
    return _buscar(e["corridas"], corrida_id)


def ultima_corrida_de(e: Estado, investigacion_id: str) -> dict | None:
    propias = [c for c in e["corridas"] if c["investigacionId"] == investigacion_id]
    return max(propias, key=lambda c: c["numero"]) if propias else None


# ---------------------------------------------------------------------------
# Visita
# ---------------------------------------------------------------------------


def marcar_visita(e: Estado, ahora: int) -> bool:
    e["ultimaVisita"] = ahora
    return True


# ---------------------------------------------------------------------------
# Corrida
# ---------------------------------------------------------------------------


def pausar_corrida(e: Estado, corrida_id: str) -> bool:
    c = corrida_de(e, corrida_id)
    if not c or c["estado"] != "en_marcha":
        return False
    c["estado"] = "pausada"
    return True


def reanudar_corrida(e: Estado, corrida_id: str) -> bool:
    """Saca a la corrida de la pausa a mano y también de `esperando_modelo`
    (el "Reintentar ahora" de la persona cuando un modelo no responde: no
    espera al siguiente sondeo). Misma regla que `reanudarCorrida` en
    frontend/src/datos/acciones.ts."""
    c = corrida_de(e, corrida_id)
    if not c or c["estado"] not in ("pausada", "esperando_modelo"):
        return False
    c["estado"] = "en_marcha"
    c["esperandoModelo"] = None
    return True


def detener_corrida(e: Estado, corrida_id: str, motivo: str, ahora: int, vigilar_literatura_dias: int | None = None) -> bool:
    texto = motivo.strip() or "Detenida por la investigadora."
    c = corrida_de(e, corrida_id)
    if not c or c["estado"] in ("detenida", "terminada"):
        return False
    c["estado"] = "detenida"
    c["terminadaEn"] = ahora
    c["motivoCierre"] = texto
    # Una corrida detenida ya no espera a ningún modelo: sin esto la franja de
    # modelos seguía diciendo "esperando a GPT-6 Astra" sobre una corrida parada,
    # y su incidencia automática `modelo_sin_respuesta` quedaba "resolviéndose
    # sola" para siempre (el vigilante ya no corre y el supervisor solo resuelve
    # en `esperando_modelo`). Misma regla que `detenerCorrida` en el frontend.
    c["esperandoModelo"] = None
    for inc in e.get("incidencias", []) or []:
        if inc.get("corridaId") == corrida_id and inc.get("estado") == "pendiente" and inc.get("tipo") == "modelo_sin_respuesta":
            inc["estado"] = "resuelta"
            inc["resueltaEn"] = ahora
            inc["resolucion"] = "La corrida se detuvo; ROSA2018 ya no espera a ese modelo"
    if vigilar_literatura_dias and vigilar_literatura_dias > 0:
        inv = _buscar(e["investigaciones"], c["investigacionId"])
        if inv:
            inv["vigilarLiteraturaHasta"] = ahora + vigilar_literatura_dias * 86_400_000
    con_evento(e, c["investigacionId"], "corrida_estado", f"Corrida {c['numero']} detenida: {texto}", None, ahora)
    return True


def ampliar_presupuesto(e: Estado, corrida_id: str, nuevo_limite: float, ahora: int) -> bool:
    """Sube el tope de llamadas de la corrida y, con el mismo margen que la
    persona concede, el de la iteración en curso. Misma regla en
    `frontend/src/datos/acciones.ts` (ampliarPresupuesto):

    - el tope nuevo tiene que ser mayor que lo gastado y que cero;
    - margen = max(topeNuevo - topeAnterior, 0);
    - la iteración en curso (la de número más alto de la corrida) pasa a
      limite = max(limite, usado + margen). Antes solo se tocaba el tope de la
      corrida y, cuando lo que había cortado era el tope de la iteración (447
      llamadas), ampliar ponía la corrida en marcha y la primera llamada la
      volvía a pausar con el mismo aviso (17 de septiembre de 2026, S-15);
    - las alertas ya avisadas que con el tope nuevo aún no se cruzan vuelven a
      poder avisar;
    - una corrida pausada por presupuesto vuelve a en_marcha."""
    c = corrida_de(e, corrida_id)
    # `math.isfinite`: el JSON de Python admite Infinity y NaN, y `int(round(inf))`
    # lanzaba en vez de devolver False (misma comprobación que Number.isFinite en el espejo).
    if not c or not isinstance(nuevo_limite, (int, float)) or isinstance(nuevo_limite, bool) or not math.isfinite(nuevo_limite):
        return False
    limite = int(round(nuevo_limite))
    if limite <= c["gasto"]["llamadas"] or limite <= 0:
        return False
    anterior = c["presupuesto"].get("limiteLlamadas") or 0
    margen = max(limite - int(anterior), 0)
    c["presupuesto"]["limiteLlamadas"] = limite
    c["presupuesto"]["avisadas"] = [a for a in c["presupuesto"]["avisadas"] if c["gasto"]["llamadas"] / limite >= a]
    it = iteracion_actual_de(e, c)
    limite_nuevo_it: int | None = None
    if it is not None and isinstance(it.get("presupuesto"), dict):
        pres = it["presupuesto"]
        usado = int(pres.get("usado") or 0)
        limite_it = pres.get("limite")
        limite_it = int(limite_it) if isinstance(limite_it, (int, float)) and not isinstance(limite_it, bool) else 0
        pres["limite"] = limite_nuevo_it = max(limite_it, usado + margen)
    if c["estado"] == "pausada_por_presupuesto":
        c["estado"] = "en_marcha"
        # Un registro de espera de modelo que el vigilante dejó durante la pausa ya
        # no vale al retomar: el paso se reintenta y, si el modelo sigue caído, se
        # vuelve a anotar. Misma regla que `ampliarPresupuesto` en el frontend.
        c["esperandoModelo"] = None
        if isinstance(c["presupuesto"], dict):
            c["presupuesto"]["motivoPausa"] = ""
    texto = f"Presupuesto ampliado a {limite} llamadas"
    if it is not None and margen and limite_nuevo_it is not None:
        texto += f"; la iteración {it.get('numero')} puede gastar hasta {limite_nuevo_it}"
    con_evento(e, c["investigacionId"], "presupuesto", texto, None, ahora)
    return True


def dirigir_corrida(e: Estado, corrida_id: str, texto: str) -> bool:
    limpio = texto.strip()
    if not limpio:
        return False
    c = corrida_de(e, corrida_id)
    if not c:
        return False
    it = iteracion_actual_de(e, c)
    if not it:
        return False
    paso = P.nuevo_paso("Indicación de la investigadora", limpio, None, humano=True)
    idx = next((i for i, p in enumerate(it["plan"]) if p["estado"] == "en_curso"), -1)
    it["plan"].insert(len(it["plan"]) if idx == -1 else idx + 1, paso)
    return True


def editar_plan(e: Estado, iteracion_id: str, plan: list[dict]) -> bool:
    it = _buscar(e["iteraciones"], iteracion_id)
    if not it or it["planAprobado"]:
        return False
    limpio = [p for p in plan if str(p.get("titulo", "")).strip()]
    if not limpio:
        return False
    it["plan"] = limpio
    return True


def aprobar_plan(e: Estado, iteracion_id: str, ahora: int, quien: str = "Investigadora") -> bool:
    it = _buscar(e["iteraciones"], iteracion_id)
    if not it or it["planAprobado"]:
        return False
    it["planAprobado"] = True
    it["empezadaEn"] = ahora
    c = corrida_de(e, it["corridaId"])
    if c and c["estado"] == "esperando_plan":
        c["estado"] = "en_marcha"
    if c:
        # Aprobar el primer plan aprueba tambien la mision tal como esta en
        # pantalla: la persona la vio encima del plan. Despues se puede editar.
        inv = _buscar(e["investigaciones"], c["investigacionId"])
        if inv and inv.get("mision") and not inv["mision"].get("aprobadaEn"):
            inv["mision"]["aprobadaEn"] = ahora
            inv["mision"]["aprobadaPor"] = quien
            con_evento(e, inv["id"], "mision", "Misión aprobada junto con el primer plan", f"#/investigaciones/{inv['id']}/investigacion", ahora)
        # La pregunta de la campana, si ROSA2018 la formulo, queda aprobada con el plan.
        if c.get("pregunta") and not c["pregunta"].get("aprobadaEn"):
            c["pregunta"]["aprobadaEn"] = ahora
        con_evento(e, c["investigacionId"], "corrida_estado", f"Plan de la iteración {it['numero']} aprobado", None, ahora)
    return True


def actualizar_pregunta(e: Estado, corrida_id: str, pregunta: dict, quien: str, ahora: int) -> bool:
    """La persona corrige la pregunta de la campaña. Cambiarla después de
    empezar deja rastro en el registro; la versión anterior se conserva en
    el historial de la propia pregunta."""
    c = corrida_de(e, corrida_id)
    if not c or not isinstance(pregunta, dict):
        return False
    base = c.get("pregunta") or P.pregunta_vacia()
    nueva = dict(base)
    for k in ("contexto", "etapa", "intervencion", "comparador", "desenlace", "ventana", "unidadBiologica", "mecanismos", "decision", "umbralEfecto"):
        if k in pregunta:
            nueva[k] = str(pregunta[k]).strip()
    if pregunta.get("pasoRuta") in P.PASOS_RUTA:
        nueva["pasoRuta"] = pregunta["pasoRuta"]
    nueva["umbralResuelto"] = bool(nueva["umbralEfecto"]) and "sin resolver" not in nueva["umbralEfecto"].lower()
    nueva["propuestaPorRosa"] = False
    nueva["aprobadaEn"] = ahora
    nueva.setdefault("_anteriores", []).append({k: v for k, v in base.items() if not k.startswith("_")})
    c["pregunta"] = nueva
    con_evento(e, c["investigacionId"], "corrida_estado", f"Pregunta de la corrida {c['numero']} corregida por {quien}", f"#/investigaciones/{c['investigacionId']}/corrida", ahora)
    return True


def actualizar_metodo(e: Estado, metodo_id: str, cambios: dict, quien: str, ahora: int) -> bool:
    """El registro de métodos lo edita una persona (validación, estado,
    contextos, responsable). Retirar o restringir un método es una decisión
    con nombre y fecha."""
    m = _buscar(e.get("metodos", []), metodo_id)
    if not m or not isinstance(cambios, dict):
        return False
    for k in ("evalua", "entradas", "salidas", "validacion", "fallosConocidos", "version", "coste", "responsable"):
        if k in cambios:
            m[k] = str(cambios[k]).strip()
    for k in ("contextos", "exclusiones", "dependeDe", "probadoEn"):
        if isinstance(cambios.get(k), list):
            m[k] = [str(x).strip() for x in cambios[k] if str(x).strip()]
    if cambios.get("estado") in ("propuesto", "implementado", "probado_en_contexto", "restringido", "retirado"):
        if cambios["estado"] != m["estado"]:
            e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(None, 2, "programa", f"Método '{m['nombre'][:60]}': de {m['estado']} a {cambios['estado']}", f"metodo:{metodo_id}", "promovido", quien, ahora))
        m["estado"] = cambios["estado"]
    m["actualizadoEn"] = ahora
    return True


def fijar_autoaprobacion_plan(e: Estado, corrida_id: str, segundos: int | None) -> bool:
    c = corrida_de(e, corrida_id)
    if not c:
        return False
    c["autoAprobarPlanSegundos"] = segundos
    return True


def detener_pista(e: Estado, pista_id: str, indicacion: str) -> bool:
    nota = indicacion.strip()
    for it in e["iteraciones"]:
        for p in it["pistas"]:
            if p["id"] == pista_id and p["estado"] == "en_curso":
                p["estado"] = "detenida"
                p["resumen"] = "Detenida por la investigadora" if not nota else f"Detenida: {nota}"
                p["transcripcion"].append({"t": len(p["transcripcion"]) * 2500, "tipo": "nota", "texto": "Detenida por la investigadora." if not nota else f"Detenida por la investigadora: {nota}"})
                return True
    return False


def detener_proceso(e: Estado, corrida_id: str, proceso_id: str, indicacion: str) -> bool:
    c = corrida_de(e, corrida_id)
    if not c:
        return False
    for p in c["procesos"]:
        if p["id"] == proceso_id:
            p["estado"] = "detenido"
            p["cpu"] = 0
            p["memoriaMb"] = 0
    if indicacion.strip():
        dirigir_corrida(e, corrida_id, f"Proceso detenido por la investigadora: {indicacion.strip()}")
    return True


def volver_a_iteracion(e: Estado, iteracion_id: str, que: str, ahora: int) -> bool:
    origen = _buscar(e["iteraciones"], iteracion_id)
    if not origen or origen["terminadaEn"] is None:
        return False
    c = corrida_de(e, origen["corridaId"])
    if not c:
        return False
    actual = iteracion_actual_de(e, c)
    numero = (actual["numero"] if actual else origen["numero"]) + 1
    base = (actual["plan"] if (que == "mundo" and actual) else origen["plan"])
    plan = [{**p, "id": P.nuevo_id("paso"), "estado": "pendiente", "motivoFallo": None} for p in base]
    nueva = P.nueva_iteracion(c["id"], numero, ahora, plan, origen["presupuesto"]["limite"])
    if actual and actual["terminadaEn"] is None:
        actual["terminadaEn"] = ahora
        actual["resumen"] = actual["resumen"] or f"Cerrada al volver a la iteración {origen['numero']}"
    e["iteraciones"].append(nueva)
    if que in ("mundo", "ambos"):
        limite = origen["terminadaEn"]
        e["hechos"] = [h for h in e["hechos"] if not (h["investigacionId"] == c["investigacionId"] and h["actualizadoEn"] > limite and all(m["quien"] == config.QUIEN_ROSA for m in h["historial"]))]
        # Las cuestiones que ROSA2018 abrió o resolvió después del punto vuelven atrás con los hechos.
        CU.podar_desde(e, c["investigacionId"], limite)
    c["iteracionActual"] = numero
    if c["estado"] in ("en_marcha", "esperando_plan"):
        c["estado"] = "esperando_plan"
    con_evento(e, c["investigacionId"], "corrida_estado", f"Se volvió a la iteración {origen['numero']} ({que}); la {numero} espera tu aprobación del plan", None, ahora)
    return True


# ---------------------------------------------------------------------------
# Permisos, incidencias y autonomia
# ---------------------------------------------------------------------------


def resolver_solicitud(e: Estado, solicitud_id: str, decision: str, alcance: str | None, ahora: int, argumentos: dict[str, str] | None = None) -> bool:
    s = _buscar(e["solicitudes"], solicitud_id)
    if not s or s["estado"] != "pendiente":
        return False
    if decision == "conceder" and (alcance is None or alcance not in s["alcances"]):
        return False
    c = corrida_de(e, s["corridaId"])
    s["estado"] = "concedida" if decision == "conceder" else "denegada"
    s["alcanceConcedido"] = alcance if decision == "conceder" else None
    s["resueltaEn"] = ahora
    if argumentos:
        for a in s["argumentos"]:
            if a["editable"] and a["nombre"] in argumentos:
                a["valor"] = str(argumentos[a["nombre"]]).strip() or a["valor"]
    if decision == "conceder" and alcance and alcance != "una_vez":
        e["permisos"].append(
            {
                "id": P.nuevo_id("per"),
                "tipo": s["tipo"],
                "recurso": s["recurso"],
                "alcance": alcance,
                "concedidoEn": ahora,
                "investigacionId": None if alcance == "siempre" else (c["investigacionId"] if c else None),
            }
        )
    if s["tipo"] == "aceptar_hipotesis" and s.get("hipotesisId") and decision == "conceder":
        revisar_hipotesis(e, s["hipotesisId"], "aceptar", "Aceptada desde la tarjeta de permiso", "Investigadora", ahora, False)
    quedan = any(x["corridaId"] == s["corridaId"] and x["estado"] == "pendiente" for x in e["solicitudes"])
    if c and c["estado"] == "esperando_aprobacion" and not quedan:
        c["estado"] = "en_marcha"
    if c:
        con_evento(e, c["investigacionId"], "permiso_resuelto", f"{'Permitido' if decision == 'conceder' else 'Denegado'}: {s['recurso']}", None, ahora)
    return True


def resolver_solicitudes(e: Estado, ids: list[str], decision: str, alcance: str | None, ahora: int) -> bool:
    algo = False
    for id_ in ids:
        s = _buscar(e["solicitudes"], id_)
        if not s:
            continue
        if decision == "conceder" and alcance is not None and alcance not in s["alcances"]:
            continue
        algo = resolver_solicitud(e, id_, decision, alcance, ahora) or algo
    return algo


def revocar_permiso(e: Estado, permiso_id: str) -> bool:
    antes = len(e["permisos"])
    e["permisos"] = [p for p in e["permisos"] if p["id"] != permiso_id]
    return len(e["permisos"]) != antes


def resolver_incidencia(e: Estado, incidencia_id: str, resolucion: str, ahora: int) -> bool:
    inc = _buscar(e["incidencias"], incidencia_id)
    if not inc or inc["estado"] != "pendiente":
        return False
    texto = resolucion.strip() or inc.get("alternativa") or "Resuelta por la investigadora"
    inc["estado"] = "resuelta"
    inc["resueltaEn"] = ahora
    inc["resolucion"] = texto
    c = corrida_de(e, inc["corridaId"])
    if c:
        con_evento(e, c["investigacionId"], "incidencia", f"Incidencia resuelta: {inc['titulo']} ({texto})", None, ahora)
    return True


def fijar_autonomia(e: Estado, clase: str, nivel: str) -> bool:
    if clase not in P.CLASES_ACCION or nivel not in ("sugerir", "preguntar", "actuar"):
        return False
    e["autonomia"][clase] = nivel
    return True


# ---------------------------------------------------------------------------
# Hipotesis
# ---------------------------------------------------------------------------

ESTADO_TRAS_ACCION = {"aceptar": "aceptada", "descartar": "descartada", "refinar": "refinar", "reabrir": "en_revision", "no_puedo_juzgar": "aclarando"}
ACCION_REVISION = {"aceptar": "aceptada", "descartar": "descartada", "refinar": "refinar", "reabrir": "reabierta", "no_puedo_juzgar": "no_puedo_juzgar"}


def revisar_hipotesis(e: Estado, hipotesis_id: str, accion: str, nota: str, quien: str, ahora: int, a_ciegas: bool = False, revision_humana: dict | None = None, etapa: str = "persona", version_esperada: int | None = None, segundos_revision: float | None = None) -> bool:
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or accion not in ESTADO_TRAS_ACCION:
        return False
    # Concurrencia: la decision se tomo mirando una version concreta. Si la
    # hipotesis cambio entre medias (ROSA2018 la reformulo), no se aplica sobre la
    # nueva; la interfaz se resincroniza y la persona vuelve a mirar.
    if version_esperada is not None and int(version_esperada) != h.get("version", 1):
        return False
    # Idempotencia: una decisión que ya está aplicada (aceptar sobre una aceptada,
    # descartar sobre una descartada) no se registra dos veces. Pasa cuando la
    # persona pulsa dos veces o cuando la interfaz reintenta un POST tras un 5xx
    # que en realidad se aplicó. Misma regla que `revisarHipotesis` en
    # frontend/src/datos/acciones.ts.
    if h.get("estado") == ESTADO_TRAS_ACCION[accion]:
        return False
    nota_limpia = (nota or "").strip()
    if accion in ("descartar", "no_puedo_juzgar") and not nota_limpia:
        return False
    h["estado"] = ESTADO_TRAS_ACCION[accion]
    h["revisiones"].append({"fecha": ahora, "quien": quien, "accion": ACCION_REVISION[accion], "nota": nota_limpia, "aCiegas": bool(a_ciegas)})
    if nota_limpia:
        h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "investigadora", "texto": nota_limpia, "creadoEn": ahora})
    if revision_humana and any(str(revision_humana.get(k, "")).strip() for k in ("supuestosCuestionados", "literaturaQueFalta", "problemaExperimental")):
        h["revisionesHumanas"].append({**revision_humana, "fecha": ahora, "quien": quien})
    e["hechos"] = [x for x in e["hechos"] if not (x["tipo"] == "hipotesis" and x["id"] == f"he-{hipotesis_id}")]
    if accion in ("aceptar", "descartar"):
        aceptar = accion == "aceptar"
        e["hechos"].append(
            {
                "id": f"he-{hipotesis_id}",
                "investigacionId": h["investigacionId"],
                "tipo": "hipotesis",
                "tema": "Revisión humana",
                "enunciado": f"Hipótesis aceptada para perseguir: {h['titulo']}" if aceptar else h["titulo"],
                "estado": "abierto" if aceptar else "descartado",
                "origen": "inferencia",
                "procedencia": [{"fuenteId": f.get("id"), "referencia": f.get("referencia"), "pagina": f.get("pagina")} for f in (h.get("procedencia") or {}).get("fuentes", []) or [] if isinstance(f, dict)],
                "motivoDescarte": None if aceptar else f"{nota_limpia} ({quien})",
                "actualizadoEn": ahora,
                "prioridad": 1 if aceptar else 9,
                "citas": [],
                "historial": [{"fecha": ahora, "de": None, "a": "abierto" if aceptar else "descartado", "quien": quien, "motivo": nota_limpia or ("Aceptada" if aceptar else "Descartada")}],
            }
        )
    textos = {
        "aceptar": f"Aceptada: {h['titulo']}",
        "descartar": f"Descartada: {h['titulo']}",
        "refinar": f"Pedida refinación: {h['titulo']}",
        "reabrir": f"Reabierta: {h['titulo']}",
        "no_puedo_juzgar": f'Marcada como "no puedo juzgar": {h["titulo"]}',
    }
    con_evento(e, h["investigacionId"], "hipotesis_decidida", textos[accion], f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    # Toda decision humana queda en el registro de decisiones (DecisionRecord).
    if accion in ("aceptar", "descartar", "refinar", "reabrir") and etapa == "persona":
        d = registrar_decision(e, h, "persona", {"aceptar": "aceptada", "descartar": "descartada", "refinar": "refinar", "reabrir": "reabierta"}[accion], nota_limpia or textos[accion], quien, ahora)
        if segundos_revision is not None:
            d["segundosRevision"] = round(float(segundos_revision), 1)  # carga de revision: la metrica que pide el plan
    if accion == "refinar" and etapa == "persona":
        h["_reformularPedida"] = nota_limpia or "La persona pidió refinarla"  # el bucle la reformula como version nueva
    if accion == "reabrir":
        h["decisionKiller"] = None
        h["_revisionPedida"] = True
    recalcular_bloqueos(e, h)
    return True


def evaluar_aprendizaje(e: Estado, cambio_id: str, ahora: int) -> bool:
    """Pedir la evaluación de un cambio de nivel 2 sobre el conjunto
    reservado (las hipótesis con decisión humana). El bucle la hace."""
    c = _buscar(e.get("aprendizaje", []), cambio_id)
    if not c or c["nivel"] != 2 or c["estado"] not in ("propuesto", "evaluado") or c["tipo"] != "criterio":
        return False
    c["_evaluar"] = ahora
    return True


# ---------------------------------------------------------------------------
# ROSA2018: mision, versiones, decisiones, puerta, analisis, aprendizaje
# ---------------------------------------------------------------------------


def registrar_decision(e: Estado, h: dict, etapa: str, decision: str, motivo: str, quien: str, ahora: int, comprobaciones: list[dict] | None = None, que_haria_falta: str = "") -> dict:
    if etapa.startswith("killer") and decision not in politicas.DECISIONES_KILLER:
        raise ValueError(f"decisión del Killer fuera de la política: {decision}")
    d = P.nueva_decision(h["investigacionId"], h["id"], h.get("version", 1), etapa, decision, motivo, quien, ahora, comprobaciones, que_haria_falta)
    # Cuanto contexto habia al decidir: sirve para vigilar si la calidad de las
    # decisiones cae cuando crece el modelo de mundo (context rot).
    d["contexto"] = {"hechos": sum(1 for x in e.get("hechos", []) if x.get("investigacionId") == h["investigacionId"]), "hipotesisVivas": sum(1 for x in e.get("hipotesis", []) if x.get("investigacionId") == h["investigacionId"] and x.get("estado") != "descartada")}
    e.setdefault("decisiones", []).append(d)
    return d


def recalcular_bloqueos(e: Estado, h: dict) -> list[str]:
    """Los bloqueos no compensables, calculados con la misma regla que
    `frontend/src/lib/priorizacion.ts`. Se guardan en la hipotesis para que
    el ranking, el dossier y la pantalla digan lo mismo."""
    from rosa.priorizacion import anotar_cohortes, bloqueos_de

    b = bloqueos_de(e, h)
    h["bloqueos"] = b
    if b:
        h["candidata"] = False
    # La cuenta canónica de cohortes viaja en la conclusión (M-04): se rehace
    # aquí, donde cambian fuentes o afirmaciones, y al cerrar la iteración.
    anotar_cohortes(h)
    return b


def aprobar_mision(e: Estado, investigacion_id: str, mision: dict, quien: str, ahora: int) -> bool:
    """La persona aprueba la misión (corrigiendo lo que quiera). Los campos
    vacíos se quedan vacíos: la misión aprobada es lo que se ve, no lo que
    ROSA2018 propuso."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not isinstance(mision, dict):
        return False
    base = inv.get("mision") or P.mision_vacia()
    pres = mision.get("presupuesto") or {}
    nueva = {
        **base,
        "poblacion": str(mision.get("poblacion", base["poblacion"])).strip(),
        "etapa": str(mision.get("etapa", base["etapa"])).strip(),
        "celulaTejido": str(mision.get("celulaTejido", base["celulaTejido"])).strip(),
        "mecanismo": str(mision.get("mecanismo", base["mecanismo"])).strip(),
        "tipoIntervencion": str(mision.get("tipoIntervencion", base["tipoIntervencion"])).strip(),
        "capacidadesLaboratorio": [str(c).strip() for c in mision.get("capacidadesLaboratorio", base["capacidadesLaboratorio"]) if str(c).strip()],
        "presupuesto": {k: (float(pres[k]) if pres.get(k) is not None and str(pres[k]).strip() != "" else float(base["presupuesto"][k])) for k in ("llamadas", "usd", "horas")},
        "aprobadaEn": ahora,
        "aprobadaPor": quien,
    }
    if isinstance(mision.get("metaAmplia"), str):
        nueva["metaAmplia"] = mision["metaAmplia"].strip()
    if isinstance(mision.get("responsables"), dict):
        base_r = base.get("responsables") or P.mision_vacia()["responsables"]
        nueva["responsables"] = {k: str(mision["responsables"].get(k, base_r.get(k, ""))).strip() for k in base_r}
    if nueva["presupuesto"]["llamadas"] <= 0 or nueva["presupuesto"]["usd"] <= 0 or nueva["presupuesto"]["horas"] <= 0:
        return False
    nueva["presupuesto"]["llamadas"] = int(nueva["presupuesto"]["llamadas"])
    inv["mision"] = nueva
    inv.pop("_misionIntentada", None)
    # El presupuesto en llamadas de la corrida viva sigue a la mision.
    c = ultima_corrida_de(e, investigacion_id)
    if c and c["estado"] not in ("detenida", "terminada") and c["presupuesto"]["limiteLlamadas"] != nueva["presupuesto"]["llamadas"] and nueva["presupuesto"]["llamadas"] > c["gasto"]["llamadas"]:
        c["presupuesto"]["limiteLlamadas"] = nueva["presupuesto"]["llamadas"]
    con_evento(e, investigacion_id, "mision", f"Misión aprobada por {quien}", f"#/investigaciones/{investigacion_id}/investigacion", ahora)
    return True


def resolver_hallazgo_registro(e: Estado, iteracion_id: str, hallazgo_id: str, estado: str, respuesta: str, quien: str, ahora: int) -> bool:
    """Una persona atiende o descarta un hallazgo del revisor de registro,
    con su respuesta. Si no queda ninguno abierto, la revisión pasa a limpia."""
    it = _buscar(e["iteraciones"], iteracion_id)
    if not it or not it.get("revisionRegistro") or estado not in ("atendido", "descartado", "abierto"):
        return False
    hz = next((x for x in it["revisionRegistro"]["hallazgos"] if x.get("id") == hallazgo_id), None)
    if not hz:
        return False
    hz["estado"] = estado
    hz["respuesta"] = respuesta.strip()[:400]
    hz["resueltoPor"] = quien.strip() or "persona"
    hz["resueltoEn"] = ahora
    # "rebatido" sigue contando como abierto: la rebatida la escribe quien escribió el
    # texto, y solo una persona o el revisor la cierran (bucle de revisión, 25 de
    # septiembre de 2026).
    it["revisionRegistro"]["estado"] = "con_hallazgos" if any(x.get("estado", "abierto") in ("abierto", "rebatido") for x in it["revisionRegistro"]["hallazgos"]) else "limpia"
    return True


def decidir_tarea(e: Estado, tarea_id: str, estado: str, motivo: str, quien: str, ahora: int) -> bool:
    """Una persona acepta o rechaza una tarea de la cola de triaje. El rechazo pide
    motivo, igual que el del triaje por regla: es la mitad del valor de la cola."""
    from rosa import tareas as TA

    if estado not in ("aceptada", "rechazada"):
        return False
    t = next((x for x in (e.get("tareas") or []) if isinstance(x, dict) and x.get("id") == tarea_id), None)
    if t is None or t.get("estado") in ("hecha", "programada"):
        return False
    if estado == "rechazada" and not (motivo or "").strip():
        return False
    firma = (quien or "").strip() or "persona"
    if not TA.marcar(e, tarea_id, estado, f"{firma}: {(motivo or '').strip()[:280]}" if motivo.strip() else f"{firma} la aceptó", ahora):
        return False
    t["quien"] = firma
    return True


def abrir_tarea(e: Estado, investigacion_id: str, que_vio: str, que_haria: str, por_que: str, herramienta: str, quien: str, ahora: int) -> bool:
    """Una persona abre una tarea a mano. Pasa por el mismo triaje por regla que las
    de ROSA2018: si choca con una lección o repite una rechazada, se le dice por qué,
    y luego ella puede aceptarla igual con `decidir_tarea`."""
    from rosa import tareas as TA

    if not (que_haria or "").strip() or not (que_vio or "").strip():
        return False
    firma = (quien or "").strip() or "persona"
    t = TA.nueva(investigacion_id, que_vio, que_haria, por_que, herramienta, {"tipo": "persona", "iteracion": None, "detalle": f"la abrió {firma}"}, ahora, quien=firma)
    TA.registrar_con_motivo(e, t, ahora)
    return True


def fijar_permiso_conector(e: Estado, nombre: str, nivel: str, quien: str, ahora: int) -> bool:
    """Permiso por conector: permitir, solo cuando una persona pregunta, o
    bloquear. Queda en el estado y en el proceso (la capa de conectores lo
    lee en cada llamada). Es una decisión de política: va al aprendizaje."""
    from rosa.conectores import REGISTRO
    from rosa.conectores.base import NIVELES_PERMISO, PERMISOS

    if nombre not in REGISTRO or nivel not in NIVELES_PERMISO:
        return False
    anterior = e.setdefault("permisosConectores", {}).get(nombre, "permitir")
    if anterior == nivel:
        return False
    e["permisosConectores"][nombre] = nivel
    PERMISOS[nombre] = nivel
    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(None, 3, "politica", f"Conector {REGISTRO[nombre].fuente}: de {anterior} a {nivel}", f"conector:{nombre}", "promovido", quien, ahora))
    for c in e.get("conectores", []):
        if c["nombre"] == nombre:
            c["permiso"] = nivel
    return True


def anadir_memoria(e: Estado, investigacion_id: str, texto: str, quien: str, ahora: int) -> bool:
    """Memoria del proyecto (como la memoria de Claude Science): hechos
    cortos y estables que ROSA2018 lee en cada misión (preferencias, restricciones,
    decisiones confirmadas). Los escribe y borra una persona; nunca resultados
    ni copias de literatura."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    limpio = texto.strip()
    if not inv or not limpio or len(limpio) > 400:
        return False
    inv.setdefault("memoria", []).append({"id": P.nuevo_id("mem"), "texto": limpio, "quien": quien.strip() or "persona", "fecha": ahora})
    return True


def quitar_memoria(e: Estado, investigacion_id: str, memoria_id: str) -> bool:
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    antes = len(inv.get("memoria", []) or [])
    inv["memoria"] = [m for m in inv.get("memoria", []) or [] if m["id"] != memoria_id]
    return len(inv["memoria"]) != antes


def registrar_pregunta_bases(e: Estado, investigacion_id: str, pregunta: dict, ahora: int) -> bool:
    """La respuesta de una pregunta con herramientas entra a la investigación
    con sus consultas, para que se vea de donde salió cada dato."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not isinstance(pregunta, dict) or not pregunta.get("pregunta"):
        return False
    inv.setdefault("preguntasABases", []).append({"id": P.nuevo_id("pb"), "fecha": ahora, **{k: pregunta.get(k) for k in ("pregunta", "respuesta", "limites", "herramientas", "consultas", "iteraciones", "quien", "error")}})
    return True


def pedir_recuperacion_citas(e: Estado, investigacion_id: str, ahora: int, corrida_id: str | None = None, quien: str = "") -> bool:
    """Pide que ROSA2018 recupere las afirmaciones bloqueadas por reglas que ya
    no valen: vuelve a juzgarlas, enlaza las que salen sostenidas a las
    hipótesis y al vivero, y rehace las conclusiones que cambian
    (rosa/recuperacion_citas.py). Con `corrida_id`, solo las de esa corrida. El
    supervisor la atiende en segundo plano; mientras hay una pedida o en curso
    en la investigación no se abre otra. La anterior se guarda en
    `recuperacionesAnteriores`. Misma regla que `pedirRecuperacionCitas` en
    frontend/src/datos/acciones.ts."""
    from rosa import recuperacion_citas as RC

    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    if corrida_id and not any(c.get("id") == corrida_id and c.get("investigacionId") == investigacion_id for c in e.get("corridas", [])):
        return False
    actual = inv.get("recuperacionCitas")
    if isinstance(actual, dict) and actual.get("estado") in RC.ESTADOS_PENDIENTES:
        return False
    anteriores = [x for x in (inv.get("recuperacionesAnteriores") or []) if isinstance(x, dict)]
    if isinstance(actual, dict):
        anteriores = [actual, *anteriores][: RC.MAX_ANTERIORES]
    inv["recuperacionCitas"] = RC.registro_nuevo(corrida_id or None, (quien or "").strip() or "persona", ahora)
    inv["recuperacionesAnteriores"] = anteriores
    alcance = "de esta corrida" if corrida_id else "de todas las corridas de la investigación"
    con_evento(e, investigacion_id, "revision_automatica", f"Recuperación de citas pedida: ROSA2018 vuelve a juzgar las afirmaciones bloqueadas {alcance} con reglas que ya no valen, enlaza a las hipótesis las que salgan sostenidas y rehace sus conclusiones.", f"#/investigaciones/{investigacion_id}/citas", ahora)
    return True


def registrar_evaluacion(e: Estado, evaluacion: dict, quien: str, ahora: int) -> bool:
    """Un panel de evaluación del sistema (por ahora, el panel del Killer con
    fallos plantados) entra al estado como registro con fecha: resumen,
    detalle por tipo de fallo y los casos. Sirve para comparar versiones del
    prompt o del modelo con la misma prueba. Si el modelo del juez cambio
    respecto al panel anterior, o el acuerdo cayo, queda una incidencia."""
    if not isinstance(evaluacion, dict) or evaluacion.get("tipo") not in ("panel_killer",) or not isinstance(evaluacion.get("resumen"), dict):
        return False
    anteriores = [x for x in e.get("evaluaciones", []) if x.get("tipo") == evaluacion["tipo"]]
    anterior = anteriores[-1] if anteriores else None
    reg = {"id": P.nuevo_id("eval"), "tipo": evaluacion["tipo"], "fecha": int(evaluacion.get("fecha") or ahora), "quien": quien.strip() or "persona", "resumen": evaluacion["resumen"], "porFallo": evaluacion.get("porFallo") or {}, "fallos": evaluacion.get("fallos") or {}, "casos": list(evaluacion.get("casos") or [])[:400]}
    e.setdefault("evaluaciones", []).append(reg)
    r = reg["resumen"]
    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(None, 2, "programa", f"Panel del Killer: detección {r.get('tasaDeteccion')}, abstención {r.get('abstencion')}, sobre-matanza en gris {r.get('sobreMatanzaGris')} ({r.get('casos')} casos, {r.get('usd')} USD)", f"evaluacion:{reg['id']}", "promovido", quien, ahora))
    avisos = []
    if anterior and anterior["resumen"].get("juez") and r.get("juez") and anterior["resumen"]["juez"] != r["juez"]:
        avisos.append(f"el modelo del juez cambio de {anterior['resumen']['juez']} a {r['juez']}")
    ka = ((anterior or {}).get("resumen", {}).get("acuerdo") or {}).get("decision") or {}
    kb = (r.get("acuerdo") or {}).get("decision") or {}
    if ka.get("kappa") is not None and kb.get("kappa") is not None and ka["kappa"] - kb["kappa"] > 0.15:
        avisos.append(f"el acuerdo por decisión bajo de kappa {ka['kappa']} a {kb['kappa']}")
    if anterior and anterior["resumen"].get("tasaDeteccion") is not None and r.get("tasaDeteccion") is not None and anterior["resumen"]["tasaDeteccion"] - r["tasaDeteccion"] > 0.15:
        avisos.append(f"la detección bajo de {anterior['resumen']['tasaDeteccion']} a {r['tasaDeteccion']}")
    if avisos:
        e.setdefault("incidencias", []).append({"id": P.nuevo_id("inc"), "corridaId": None, "tipo": "calibracion_juez", "titulo": "El panel del Killer cambio respecto al anterior", "detalle": "; ".join(avisos) + ". Revisa antes de confiar en las decisiones nuevas.", "estado": "pendiente", "creadaEn": ahora, "resueltaEn": None, "resolucion": None, "opciones": ["revisar", "aceptar"]})
    return True


def registrar_sello_externo(e: Estado, hipotesis_id: str, sello: dict, ahora: int) -> bool:
    """El sello RFC 3161 del prerregistro (hash, autoridades, hora firmada y
    los tokens) queda en el experimento y en el registro de procedencia."""
    from rosa import sello as S

    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not h.get("experimento") or not isinstance(sello, dict) or not sello.get("hash"):
        return False
    x = h["experimento"]
    x["selloExterno"] = {k: sello.get(k) for k in ("algoritmo", "hash", "pedidoEn", "ok", "testigos", "primeraHora", "error")} | {"sellos": [{k: s_.get(k) for k in ("tsa", "url", "ca", "ok", "genTime", "serial", "politica", "tsrBase64", "error", "ms")} for s_ in sello.get("sellos") or []]}
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} prerregistro: {S.texto_para_registro(sello)}")
    return True


TIPOS_CONOCIMIENTO_OPERATIVO = ("protocolo", "reactivo", "medicion", "muestra", "otro")


def anadir_conocimiento_operativo(e: Estado, investigacion_id: str, texto: str, tipo: str, quien: str, ahora: int) -> bool:
    """Lo que el laboratorio sabe y nunca se escribe (que protocolo no es
    fiable, que lote de anticuerpo falla, que medicion tiene un artefacto).
    Entra como evidencia de clase `conocimiento_operativo`, con su propio
    estatus: ROSA2018 lo lee al planificar experimentos y lo cita en el dossier,
    pero no lo mezcla con la literatura ni lo cuenta como observacion."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    t = (texto or "").strip()
    if not inv or len(t) < 8 or tipo not in TIPOS_CONOCIMIENTO_OPERATIVO:
        return False
    inv.setdefault("conocimientoOperativo", []).append({"id": P.nuevo_id("op"), "texto": t[:1200], "tipo": tipo, "quien": (quien or "").strip() or "persona", "fecha": ahora, "clase": "conocimiento_operativo"})
    return True


def quitar_conocimiento_operativo(e: Estado, investigacion_id: str, id_: str) -> bool:
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    antes = len(inv.get("conocimientoOperativo") or [])
    inv["conocimientoOperativo"] = [x for x in inv.get("conocimientoOperativo") or [] if x["id"] != id_]
    return len(inv["conocimientoOperativo"]) != antes


def _modelo_juez() -> str:
    from rosa import gateway

    return gateway.JUEZ


def etiquetar_comprobacion(e: Estado, hipotesis_id: str, comprobacion: str, veredicto_humano: str, quien: str, ahora: int, nota: str = "") -> bool:
    """Una persona cualificada dice si una comprobacion del Killer acierta:
    su veredicto (pasa, falla, no_comprobable) queda en el conjunto dorado
    junto al del juez, la version juzgada y el modelo. Es la materia prima
    del acuerdo juez-humano (kappa por comprobacion)."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or veredicto_humano not in ("pasa", "falla", "no_comprobable") or not comprobacion:
        return False
    decisiones = [d for d in e.get("decisiones", []) if d.get("hipotesisId") == hipotesis_id and str(d.get("etapa", "")).startswith("killer")]
    ultima = decisiones[-1] if decisiones else None
    del_juez = next((c for c in (ultima or {}).get("comprobaciones", []) if c.get("comprobacion") == comprobacion), None)
    if not del_juez:
        return False
    caso = {
        "id": P.nuevo_id("oro"),
        "hipotesisId": hipotesis_id,
        "version": h.get("version", 1),
        "decisionId": (ultima or {}).get("id"),
        "comprobacion": comprobacion,
        "veredictoJuez": del_juez.get("resultado"),
        "detalleJuez": (del_juez.get("detalle") or "")[:300],
        "veredictoHumano": veredicto_humano,
        "nota": (nota or "").strip()[:500],
        "quien": (quien or "").strip() or "persona",
        "fecha": ahora,
        "modeloJuez": (ultima or {}).get("modelo") or _modelo_juez(),
    }
    dorado = e.setdefault("conjuntoDorado", [])
    # Una etiqueta nueva de la misma persona sobre la misma comprobacion y version sustituye a la anterior.
    e["conjuntoDorado"] = [c for c in dorado if not (c["hipotesisId"] == hipotesis_id and c["comprobacion"] == comprobacion and c["version"] == caso["version"] and c["quien"] == caso["quien"])] + [caso]
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} conjunto dorado: {quien} dice que '{comprobacion}' {veredicto_humano} (el juez dijo {del_juez.get('resultado')})")
    return True


ESTADOS_AREA = ("propuesta", "elegida", "pausada", "sin_explorar")


def cambiar_estado_area(e: Estado, investigacion_id: str, area_id: str, estado: str | None, quien: str, ahora: int, condicion_reapertura: str = "", corrida_id: str | None = None, motivo: str = "") -> bool:
    """Las áreas del programa las gobierna una persona: elegir, pausar con la
    condición que la reabriria, reabrir, dejar sin explorar, o asignarla a una
    campaña (corrida) concreta. Cada cambio queda con fecha, autor y motivo en
    el historial del área, porque decidir que NO se investiga es una decisión
    tan auditable como la contraria (plan completo, etapa B)."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not inv.get("mision"):
        return False
    a = _buscar(inv["mision"].get("areas", []), area_id)
    if not a:
        return False
    cambio = False
    if estado is not None:
        if estado not in ESTADOS_AREA:
            return False
        if estado == "pausada" and not condicion_reapertura.strip():
            return False  # pausar sin decir que la reabriria es abandonar sin registro
        if estado != a["estado"]:
            a.setdefault("historial", []).append({"fecha": ahora, "de": a["estado"], "a": estado, "quien": quien.strip() or "persona", "motivo": (motivo or condicion_reapertura).strip()[:300]})
            a["estado"] = estado
            cambio = True
        if estado == "pausada":
            a["condicionReapertura"] = condicion_reapertura.strip()[:300]
        elif estado == "elegida" and a.get("condicionReapertura"):
            a["condicionReapertura"] = ""  # reabierta: la condicion se cumplio o se levanto
    if corrida_id is not None:
        c = _buscar(e["corridas"], corrida_id) if corrida_id else None
        if corrida_id and (not c or c["investigacionId"] != investigacion_id):
            return False
        if (corrida_id or None) != a.get("corridaId"):
            a["corridaId"] = corrida_id or None
            a.setdefault("historial", []).append({"fecha": ahora, "de": a["estado"], "a": a["estado"], "quien": quien.strip() or "persona", "motivo": (f"asignada a la campaña {c['numero']}" if c else "desasignada de su campaña")})
            cambio = True
    if cambio:
        con_evento(e, investigacion_id, "mision", f"Área '{a['titulo'][:60]}': {a['estado'].replace('_', ' ')}" + (f" (campaña {c['numero']})" if corrida_id and c else ""), f"#/investigaciones/{investigacion_id}/investigacion", ahora)
    return cambio


def reformular_hipotesis(e: Estado, hipotesis_id: str, cambios: dict, quien: str, motivo: str, ahora: int) -> bool:
    """Una versión nueva de la hipótesis. La anterior se guarda entera en
    `versiones`; la nueva vuelve a la cola como propuesta y el Killer la
    juzga otra vez. Si ya agotó las reformulaciones de la política, devuelve
    False: quien llama la descarta en este contexto."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not isinstance(cambios, dict):
        return False
    version = h.get("version", 1)
    if not politicas.puede_reformular(version):
        return False
    texto = {k: str(cambios.get(k, "")).strip() for k in ("titulo", "enunciado", "mecanismo")}
    if not texto["enunciado"] and not texto["titulo"]:
        return False
    version_anterior = P.version_de(h, ahora, quien, motivo.strip() or "Reformulada")
    instantanea = REG.instantanea_extendida(h)  # certeza, Elo, cuántas afirmaciones y fuentes tenía esa versión
    cambia_texto = any(texto[k] and texto[k] != str(h.get(k) or "").strip() for k in ("titulo", "enunciado"))
    diana_anterior = str(((h.get("tarjeta") or {}).get("diana") or "")).strip().lower()
    h["version"] = version + 1
    for k, v in texto.items():
        if v:
            h[k] = v
    comp = cambios.get("comprobacion") or {}
    if isinstance(comp, dict):
        for k in ("biomarcador", "cohorte", "diseno"):
            if str(comp.get(k, "")).strip():
                h["comprobacion"][k] = str(comp[k]).strip()
    tarjeta = cambios.get("tarjeta")
    if isinstance(tarjeta, dict):
        base = h.get("tarjeta") or P.tarjeta_vacia()
        h["tarjeta"] = {**base, **{k: v for k, v in tarjeta.items() if k in base}}
    h["estado"] = "propuesta"
    h["decisionKiller"] = None
    h["candidata"] = False
    h.pop("_reformularPedida", None)
    h["_revisionPedida"] = True
    # Novedad por versión (S-11, 17 de septiembre de 2026). El precedente, las
    # patentes y la financiación se buscan con el título y el enunciado: si
    # cambian, lo comprobado era de la versión anterior y la nueva hereda un
    # "ya publicado" que nunca se recomprobó (el Killer volvía a fallar por la
    # misma novedad y a la tercera descartaba). Igual que rosa/dianas.py hace con
    # el perfil de diana por versión: vuelven a "No comprobado todavía" y
    # `paso_novedad` las recoge. La novedad vieja se guarda en la versión. Si
    # además cambió la diana de la tarjeta, lo que depende del gen también.
    novedad_anterior = copy.deepcopy(h.get("novedad")) if isinstance(h.get("novedad"), dict) else None
    if cambia_texto and isinstance(h.get("novedad"), dict):
        n = h["novedad"]
        for clave in ("precedente", "patentes", "financiacion"):
            n[clave] = P.novedad_no_comprobada(version + 1)
        diana_nueva = str(((h.get("tarjeta") or {}).get("diana") or "")).strip().lower()
        if diana_nueva != diana_anterior:
            pendiente = P.novedad_pendiente()
            for clave in ("openTargets", "ensayos", "genetica", "farmacos", "datosPublicos"):
                n[clave] = {**pendiente[clave], "detalle": f"No comprobado todavía para la versión {version + 1}: la diana cambió"}
    h["hallazgos"] = [x for x in h["hallazgos"] if x["estado"] != "abierto"] + [{**x, "estado": "atendido", "respuestaDeRosa": f"Atendido en la versión {version + 1}: {motivo.strip()[:200]}"} for x in h["hallazgos"] if x["estado"] == "abierto"]
    # Instantánea con diff (rosa/registro.py): qué cambió campo a campo de esa versión a esta.
    version_guardada = REG.version_con_diff(version_anterior, h)
    version_guardada.update(instantanea)
    if novedad_anterior is not None:
        version_guardada["novedad"] = novedad_anterior
    h.setdefault("versiones", []).append(version_guardada)
    resumen_cambios = REG.resumen_diff(version_guardada["cambios"])
    h["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "reformulada", "nota": f"Versión {version + 1}: {motivo.strip()[:300]}", "aCiegas": False})
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} versión {version + 1} ({quien}): {motivo.strip()[:120]}. {resumen_cambios}")
    con_evento(e, h["investigacionId"], "hipotesis_decidida", f"Reformulada (versión {version + 1}): {h['titulo']}", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    recalcular_bloqueos(e, h)
    # Propagación de dependencias: sus derivadas, sus planes y su hecho quedan pendientes de revisar.
    DEP.propagar_reformulacion(e, h["id"], ahora, motivo)
    return True


def eximir_puerta(e: Estado, investigacion_id: str, motivo: str, quien: str, ahora: int) -> bool:
    """Saltarse la puerta de reproducción es una excepción de política: la
    firma una persona, con motivo, y queda en el registro de aprendizaje
    como cambio de nivel 3."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    texto = motivo.strip()
    if not inv or not texto:
        return False
    puerta = inv.setdefault("puertaReproduccion", P.puerta_reproduccion())
    if puerta["estado"] == "eximida":
        return False
    puerta.update(estado="eximida", eximidaPor=quien, motivo=texto, fecha=ahora)
    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(investigacion_id, 3, "politica", f"Puerta de reproducción eximida: {texto}", "puertaReproduccion", "aplicado", quien, ahora))
    con_evento(e, investigacion_id, "aprendizaje", f"Puerta de reproducción eximida por {quien}: {texto[:120]}", f"#/investigaciones/{investigacion_id}/investigacion", ahora)
    return True


def cerrar_puerta(e: Estado, investigacion_id: str, quien: str, ahora: int) -> bool:
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    puerta = inv.setdefault("puertaReproduccion", P.puerta_reproduccion())
    if puerta["estado"] != "eximida":
        return False
    puerta.update(estado="abierta" if puerta["superadas"] >= puerta["requeridas"] else "bloqueada", eximidaPor=None, motivo="", fecha=ahora)
    con_evento(e, investigacion_id, "aprendizaje", f"Puerta de reproducción vuelta a exigir por {quien}", None, ahora)
    return True


def anadir_reproduccion(e: Estado, investigacion_id: str, dataset_id: str, datos: dict, ahora: int) -> str | bool:
    """Registrar un análisis publicado que hay que reproducir: referencia,
    cifra publicada, valor y tolerancia. Se fija antes de ejecutar; el bucle
    lo corre y marca superada o fallida."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    ds = _dataset(e, investigacion_id, dataset_id)
    if not inv or not ds:
        return False
    try:
        valor = float(str(datos.get("valorPublicado", "")).replace(",", "."))
        tol = float(str(datos.get("tolerancia", "0.1")).replace(",", "."))
    except ValueError:
        return False
    if not str(datos.get("referencia", "")).strip() or not str(datos.get("descripcion", "")).strip() or tol <= 0 or tol > 1:
        return False
    r = P.nueva_reproduccion(
        investigacion_id,
        dataset_id,
        ahora,
        referencia=str(datos.get("referencia", "")).strip(),
        doi=str(datos.get("doi", "")).strip(),
        descripcion=str(datos.get("descripcion", "")).strip(),
        cifraPublicada=str(datos.get("cifraPublicada", "")).strip(),
        valorPublicado=valor,
        tolerancia=tol,
    )
    e.setdefault("reproducciones", []).append(r)
    inv.setdefault("puertaReproduccion", P.puerta_reproduccion())
    con_evento(e, investigacion_id, "analisis", f"Reproducción registrada: {r['referencia']} ({r['descripcion'][:80]})", f"#/investigaciones/{investigacion_id}/investigacion", ahora)
    return r["id"]


def pedir_analisis(e: Estado, hipotesis_id: str, dataset_id: str, pregunta: str, ahora: int) -> bool:
    """Pedir a ROSA2018 un análisis in silico de la hipótesis sobre un dataset
    aprobado y fijado por hash. El bucle congela el plan, escribe el código,
    lo ejecuta en el sandbox y lo audita."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h:
        return False
    ds = _dataset(e, h["investigacionId"], dataset_id)
    if not ds or ds["estado"] != "aprobado" or not (ds.get("procedencia") or {}).get("hash"):
        return False
    if h.get("_analisisPedido"):
        return False
    h["_analisisPedido"] = {"datasetId": dataset_id, "pregunta": pregunta.strip(), "pedidoEn": ahora}
    h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "investigadora", "texto": f"Análisis pedido sobre {ds['nombre']}: {pregunta.strip() or 'aplicar la predicción falsable de la hipótesis'}", "creadoEn": ahora})
    con_evento(e, h["investigacionId"], "analisis", f"Análisis in silico pedido sobre {ds['nombre']}: {h['titulo'][:80]}", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    return True


def empeora_al_evaluar(c: dict) -> bool:
    """Puerta "solo mejor o igual": un cambio evaluado cuyo acuerdo después es
    menor que antes no se promueve. Sin evaluación numérica no hay puerta (se
    promueve bajo la responsabilidad de quien lo hace). Misma regla en
    frontend/src/datos/acciones.ts."""
    ev = c.get("evaluacion") or {}
    antes, despues = ev.get("antes"), ev.get("despues")
    return isinstance(antes, (int, float)) and isinstance(despues, (int, float)) and despues < antes


def promover_aprendizaje(e: Estado, cambio_id: str, quien: str, ahora: int) -> bool:
    """Promover un cambio de nivel 2 (criterio o programa). Solo una persona.
    Un criterio promovido entra a los criterios de revisión; un programa
    promovido se carga en el siguiente arranque (el servidor mueve el fichero).
    Puerta "solo mejor o igual": si la evaluación dice que empeora, no pasa."""
    c = _buscar(e.get("aprendizaje", []), cambio_id)
    if not c or c["nivel"] != 2 or c["estado"] not in ("propuesto", "evaluado"):
        return False
    if empeora_al_evaluar(c):
        ev = c["evaluacion"]
        con_evento(e, c.get("investigacionId"), "incidencia", f"No se promueve el cambio '{c['descripcion'][:80]}': la evaluación empeora el acuerdo ({ev['antes']} antes, {ev['despues']} después). Solo se promueve lo que iguala o mejora.", "#/ajustes", ahora)
        return False
    c["estado"] = "promovido"
    c["resueltoEn"] = ahora
    c["resueltoPor"] = quien
    if c["tipo"] == "criterio" and c["descripcion"] not in e["criteriosRevision"]:
        e["criteriosRevision"].append(c["descripcion"])
    if c["tipo"] == "programa":
        c["_promover"] = True
    con_evento(e, c.get("investigacionId"), "aprendizaje", f"Cambio de nivel 2 promovido por {quien}: {c['descripcion'][:100]}", "#/ajustes", ahora)
    return True


def fusionar_hipotesis(e: Estado, ganadora_id: str, absorbida_id: str, motivo: str, quien: str, ahora: int) -> bool:
    """Fusión de ramas por torneo: dos hipótesis que dicen lo mismo (o una es un
    caso particular de la otra) se funden en una. La ganadora hereda las
    afirmaciones y las fuentes que no tenía (marcadas con heredadaDe), suma a la
    absorbida en `absorbe`, y la absorbida queda descartada con `fusionadaEn`.
    No es un descarte por evidencia: el motivo lo dice. Misma regla en
    frontend/src/datos/acciones.ts."""
    g = _buscar(e["hipotesis"], ganadora_id)
    a = _buscar(e["hipotesis"], absorbida_id)
    if not g or not a or g is a or g["investigacionId"] != a["investigacionId"] or a["estado"] == "descartada" or g["estado"] == "descartada":
        return False

    def clave(x: dict) -> tuple:
        return (x.get("afirmacionId"),) if x.get("afirmacionId") else (x.get("texto"), x.get("cita"))

    tiene = {clave(x) for x in g["afirmaciones"]}
    heredadas = 0
    for x in a["afirmaciones"]:
        if clave(x) in tiene:
            continue
        g["afirmaciones"].append({**copy.deepcopy(x), "heredadaDe": a["id"]})
        tiene.add(clave(x))
        heredadas += 1
    ids_fuentes = {f["id"] for f in g["procedencia"]["fuentes"]}
    fuentes_nuevas = 0
    for f in a["procedencia"]["fuentes"]:
        if f["id"] not in ids_fuentes:
            g["procedencia"]["fuentes"].append(copy.deepcopy(f))
            ids_fuentes.add(f["id"])
            fuentes_nuevas += 1
    marca = datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()
    g.setdefault("absorbe", []).append(a["id"])
    g["fusionPropuesta"] = None
    g["_evidenciaNueva"] = True
    g.pop("_conclusionIntentada", None)
    g["procedencia"]["registro"].append(f"{marca} fusión: absorbe a '{a['titulo'][:80]}' ({a['id']}) por {quien}: {motivo.strip()[:200]}. {heredadas} afirmaciones y {fuentes_nuevas} fuentes heredadas")
    g["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "rosa", "texto": f"Fusionada con '{a['titulo'][:80]}': {motivo.strip()[:200]}", "creadoEn": ahora})
    a["estado"] = "descartada"
    a["candidata"] = False
    a["fusionadaEn"] = g["id"]
    a["fusionPropuesta"] = None
    a["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "descartada", "nota": f"Fusionada en '{g['titulo'][:80]}' ({g['id']}): {motivo.strip()[:200]}", "aCiegas": False})
    a["procedencia"]["registro"].append(f"{marca} fusionada en '{g['titulo'][:80]}' ({g['id']}) por {quien}: {motivo.strip()[:200]}")
    recalcular_bloqueos(e, g)
    recalcular_bloqueos(e, a)
    con_evento(e, g["investigacionId"], "hipotesis_decidida", f"Fusión: '{a['titulo'][:60]}' se funde en '{g['titulo'][:60]}' ({motivo.strip()[:100]})", f"#/investigaciones/{g['investigacionId']}/hipotesis/{g['id']}", ahora)
    return True


def abrir_cuestion(e: Estado, investigacion_id: str, texto: str, que_la_resolveria: str, quien: str, ahora: int, hipotesis_id: str | None = None) -> bool:
    """Una persona abre una cuestión (lo que rekursiv.ai llama Issue): queda en
    la lista persistente de la investigación con origen 'persona'. Si ya había
    una equivalente abierta, se funde con ella (rosa/cuestiones.py)."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not texto.strip():
        return False
    c = CU.nueva(investigacion_id, texto, {"tipo": "persona", "id": None}, que_la_resolveria, ahora, prioridad=3, hipotesis_ids=[hipotesis_id] if hipotesis_id else None, quien=quien)
    guardada = CU.registrar(e, c)
    if guardada is None:
        con_evento(e, investigacion_id, "incidencia", f"No se abrió la cuestión «{texto.strip()[:80]}»: la investigación ya tiene {CU.MAX_CUESTIONES_ABIERTAS} abiertas", f"#/investigaciones/{investigacion_id}", ahora)
        return False
    con_evento(e, investigacion_id, "hecho_nuevo", f"Cuestión abierta por {quien}: {guardada['texto'][:100]}", f"#/investigaciones/{investigacion_id}", ahora)
    return True


def resolver_cuestion(e: Estado, cuestion_id: str, motivo: str, quien: str, ahora: int) -> bool:
    c = CU.buscar(e, cuestion_id)
    if not c or not CU.resolver(e, cuestion_id, quien, motivo.strip() or "Resuelta por una persona", ahora, quien=quien):
        return False
    con_evento(e, c["investigacionId"], "hecho_nuevo", f"Cuestión resuelta por {quien}: {c['texto'][:100]}", f"#/investigaciones/{c['investigacionId']}", ahora)
    return True


def descartar_cuestion(e: Estado, cuestion_id: str, motivo: str, quien: str, ahora: int) -> bool:
    c = CU.buscar(e, cuestion_id)
    if not c or not motivo.strip() or not CU.descartar(e, cuestion_id, motivo.strip(), quien, ahora):
        return False
    con_evento(e, c["investigacionId"], "hecho_nuevo", f"Cuestión descartada por {quien}: {c['texto'][:100]}", f"#/investigaciones/{c['investigacionId']}", ahora)
    return True


def reabrir_cuestion(e: Estado, cuestion_id: str, motivo: str, quien: str, ahora: int) -> bool:
    c = CU.buscar(e, cuestion_id)
    return bool(c) and CU.reabrir(e, cuestion_id, motivo.strip() or "Reabierta", quien, ahora)


def atender_pendiente(e: Estado, tipo: str, id_: str, quien: str, nota: str, ahora: int) -> bool:
    """Una persona da por revisado lo que la propagación de dependencias marcó
    como pendiente (rosa/dependencias.py); el bloqueo se levanta."""
    if not DEP.atender_pendiente(e, tipo, id_, quien, nota, ahora):
        return False
    if tipo == "hipotesis":
        h = _buscar(e["hipotesis"], id_)
        if h:
            recalcular_bloqueos(e, h)
            con_evento(e, h["investigacionId"], "hipotesis_decidida", f"{quien} revisó «{h['titulo'][:60]}» tras el cambio del que dependía" + (f": {nota.strip()[:100]}" if nota.strip() else ""), f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    return True


def rechazar_fusion(e: Estado, hipotesis_id: str, quien: str, ahora: int) -> bool:
    """La persona no quiere fusionar: la propuesta se retira y queda anotado."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not h.get("fusionPropuesta"):
        return False
    con = h["fusionPropuesta"].get("con")
    h["fusionPropuesta"] = None
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} fusión con {con} rechazada por {quien}")
    con_evento(e, h["investigacionId"], "hipotesis_decidida", f"{quien} rechazó fusionar '{h['titulo'][:60]}'", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    return True


def revertir_aprendizaje(e: Estado, cambio_id: str, quien: str, motivo: str, ahora: int) -> bool:
    c = _buscar(e.get("aprendizaje", []), cambio_id)
    if not c or c["nivel"] == 3 or c["estado"] == "revertido":
        return False
    c["estado"] = "revertido"
    c["resueltoEn"] = ahora
    c["resueltoPor"] = quien
    if motivo.strip():
        c["evaluacion"] = {**(c.get("evaluacion") or {"conjunto": "", "casos": 0, "antes": None, "despues": None}), "nota": motivo.strip()}
    if c["tipo"] == "criterio" and c["descripcion"] in e["criteriosRevision"]:
        e["criteriosRevision"].remove(c["descripcion"])
    # Un programa promovido por GEPA continuo (origen gepa:<ciclo>): revertirlo devuelve la
    # versión anterior a las corridas nuevas; las corridas ya creadas conservan la suya.
    if c["tipo"] == "programa" and str(c.get("origen") or "").startswith("gepa:") and c.get("programa"):
        activos = e.setdefault("_gepaActivos", {})
        anterior = c.get("anterior")
        if anterior and anterior != "base":
            activos[c["programa"]] = anterior
        else:
            activos.pop(c["programa"], None)
    con_evento(e, c.get("investigacionId"), "aprendizaje", f"Cambio revertido por {quien}: {c['descripcion'][:100]}", "#/ajustes", ahora)
    return True


def generar_dossier(e: Estado, hipotesis_id: str, quien: str, ahora: int) -> str | bool:
    """El Wet-Lab Dossier: se arma de forma determinista con lo que hay en el
    estado (sin modelo) y se guarda como artefacto. Si la hipótesis tiene
    bloqueos, el dossier los pone en la primera página en vez de esconderlos."""
    from rosa.dossier import texto_dossier

    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h:
        return False
    inv = _buscar(e["investigaciones"], h["investigacionId"])
    corrida = ultima_corrida_de(e, h["investigacionId"])
    recalcular_bloqueos(e, h)
    contenido = texto_dossier(e, h, inv, corrida, ahora)
    # Revisor de registro por regla sobre el dossier: cifras e identificadores
    # que no esten en el registro de esta hipotesis quedan escritos al final.
    from rosa import revisor_registro as RR

    corpus = RR.corpus_del_registro(e, h["investigacionId"], None, corrida, hipotesis=h)
    runs_ok = sum(1 for r in e.get("ejecuciones", []) if r.get("estado") == "completado" and r.get("hipotesisId") == h["id"])
    hallazgos = RR.comprobaciones_deterministas(contenido, corpus, None, runs_ok if RR._EJECUCION.search(contenido) else 1)
    contenido += "\n\n## Revisión del registro (por regla)\n" + ("\n".join(f"- [{x['gravedad']}] {x['clase'].replace('_', ' ')}: {x['detalle']}" for x in hallazgos) if hallazgos else "Sin discrepancias entre el dossier y el registro de la hipótesis.")
    art_id = guardar_artefacto(e, h["investigacionId"], f"Dossier para el laboratorio: {h['titulo'][:80]}", "dossier", contenido, f"Versión {h.get('version', 1)} de la hipótesis; {len(h.get('bloqueos', []))} bloqueos; revisión del registro: {len(hallazgos)} hallazgos", corrida["iteracionActual"] if corrida else h["iteracion"], ahora, procedencia={"mensajes": {"hipotesis": h["id"], "version": h.get("version", 1)}, "revision": {"hallazgos": hallazgos, "porRegla": len(hallazgos), "juez": None, "resumen": RR.resumen_revision(hallazgos)}})
    h["dossierArtefactoId"] = art_id
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} dossier generado por {quien}")
    con_evento(e, h["investigacionId"], "hipotesis_decidida", f"Dossier para el laboratorio generado: {h['titulo'][:80]}", f"#/investigaciones/{h['investigacionId']}/artefactos/{art_id}", ahora)
    return art_id


def emitir_documento(e: Estado, hipotesis_id: str, nombre_corto: str | None, quien: str, ahora: int) -> bool:
    """Emite la última versión del dossier como documento controlado según la
    norma AP-DOC-002 (rosa/documento_controlado.py): código AP-HYP propio la
    primera vez, versión nueva las siguientes, cabecera, pie y las ocho
    comprobaciones guardadas con la versión. Solo en el servidor: el código no
    se asigna nunca en el navegador, para que dos pestañas no den el mismo."""
    from rosa import documento_controlado as DC

    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h:
        return False
    v = DC.emitir(e, h, nombre_corto, quien, ahora)
    if isinstance(v, str):
        return False
    doc = h["documentoControlado"]
    h.setdefault("procedencia", {}).setdefault("registro", []).append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} documento controlado {doc['id']} {v['version']} emitido por {quien}")
    art = v["artefactoId"]
    con_evento(e, h["investigacionId"], "hipotesis_decidida", f"Documento controlado {doc['id']} {v['version']} emitido: {v['nombre']}" + ("" if v["controlado"] else " (no pasa todas las comprobaciones de la norma)"), f"#/investigaciones/{h['investigacionId']}/artefactos/{art}", ahora)
    return True


def aclarar_hipotesis(e: Estado, hipotesis_id: str, aclaracion: str, ahora: int) -> bool:
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or h["estado"] != "aclarando":
        return False
    h["estado"] = "en_revision"
    h["revisiones"].append({"fecha": ahora, "quien": config.QUIEN_ROSA, "accion": "aclarada", "nota": aclaracion, "aCiegas": False})
    h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "rosa", "texto": aclaracion, "creadoEn": ahora})
    return True


def votar_relevancia(e: Estado, hipotesis_id: str, voto: str) -> bool:
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or voto not in ("alta", "media", "baja"):
        return False
    h["relevancia"]["votoHumano"] = voto
    return True


def solicitar_revision(e: Estado, hipotesis_id: str, ahora: int) -> bool:
    """Deja constancia de la petición; el bucle hace la revisión real y
    sustituye este resumen provisional."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h:
        return False
    h["ultimaRevisionAutomatica"] = ahora
    h.setdefault("_revisionPedida", True)
    h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": "Revisión pedida por la investigadora. ROSA2018 la hará en cuanto tenga el modelo libre.", "creadoEn": ahora})
    con_evento(e, h["investigacionId"], "revision_automatica", f"Revisión pedida sobre: {h['titulo']}", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    return True


def reevaluar_supuestos(e: Estado, investigacion_id: str | None, ahora: int) -> bool:
    """Pide que ROSA2018 vuelva a revisar las hipótesis vivas cuyos supuestos
    no están al día (rosa/vigencia.py): evaluados con una regla anterior, con
    evidencia llegada después, con supuestos que el modelo no pudo evaluar o
    sin evaluar nunca. Con `investigacion_id`, solo las de esa investigación;
    sin él, las de todo el programa. El bucle atiende la petición como
    cualquier revisión pedida (supuestos y Killer), con el presupuesto de la
    última corrida de cada investigación; si no lo hay, el sello dice por qué."""
    from rosa import vigencia as VIGENCIA

    por_inv: dict[str, int] = {}
    for h in e.get("hipotesis", []):
        if not VIGENCIA.es_viva(h) or (investigacion_id and h.get("investigacionId") != investigacion_id):
            continue
        if VIGENCIA.vigencia(h)["alDia"] or not VIGENCIA.pedir(h, ahora):
            continue
        h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": "Reevaluación de supuestos pedida desde Qué desbloquea más: no estaban al día. ROSA2018 los reevalúa con la regla de hoy y vuelve a pasar el Killer.", "creadoEn": ahora})
        por_inv[h["investigacionId"]] = por_inv.get(h["investigacionId"], 0) + 1
    for inv, n in por_inv.items():
        con_evento(e, inv, "revision_automatica", f"Reevaluación de supuestos pedida para {n} hipótesis cuyos supuestos no estaban al día.", None, ahora)
    return bool(por_inv)


def replicar_hipotesis(e: Estado, hipotesis_id: str, total: int, ahora: int) -> bool:
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or (h["replicacion"] and h["replicacion"]["estado"] == "en_curso") or total < 2:
        return False
    h["replicacion"] = {"total": total, "hechas": 0, "sostienen": 0, "contradicen": 0, "estado": "en_curso", "empezadaEn": ahora}
    h["revisiones"].append({"fecha": ahora, "quien": "Investigadora", "accion": "replicada", "nota": f"{total} trayectorias independientes", "aCiegas": False})
    h["coste"]["analisis"] = h["coste"]["analisis"] + total * 1.2
    con_evento(e, h["investigacionId"], "revision_automatica", f"Replicación x{total} lanzada sobre: {h['titulo']}", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
    return True


def proponer_hipotesis(e: Estado, investigacion_id: str, datos: dict, quien: str, ahora: int, id_: str | None = None) -> str | bool:
    def t(k: str) -> str:
        return str(datos.get(k, "")).strip()

    if not t("titulo") or not t("enunciado") or (not t("biomarcador") and not t("cohorte")):
        return False
    corrida = ultima_corrida_de(e, investigacion_id)
    iteracion = corrida["iteracionActual"] if corrida else 0
    h = P.nueva_hipotesis(
        investigacion_id,
        iteracion,
        ahora,
        titulo=t("titulo"),
        enunciado=t("enunciado"),
        mecanismo=t("mecanismo"),
        comprobacion={"biomarcador": t("biomarcador"), "cohorte": t("cohorte"), "diseno": t("diseno")},
        origen="humana",
        cluster=t("cluster") or "Sin cluster",
        relevancia={"justificacion": "Propuesta por la investigadora; ROSA2018 la justificara al revisarla.", "votoHumano": "alta"},
        revisiones=[{"fecha": ahora, "quien": quien, "accion": "propuesta", "nota": "Propuesta por una persona", "aCiegas": False}],
    )
    if id_:
        h["id"] = id_
    h["procedencia"] = P.procedencia_vacia(f"Hipótesis propuesta por {quien}. ROSA2018 la revisara y la metera al torneo en la siguiente iteración.", ahora)
    h["procedencia"]["mensajes"][0]["de"] = "investigadora"
    h["procedencia"]["registro"] = [f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} hipótesis humana añadida por {quien}"]
    e["hipotesis"].append(h)
    con_evento(e, investigacion_id, "hipotesis_nueva", f"Hipótesis propuesta por {quien}: {h['titulo']}", f"#/investigaciones/{investigacion_id}/hipotesis/{h['id']}", ahora)
    return h["id"]


def asignar_experimento(e: Estado, hipotesis_id: str, laboratorio: str, ahora: int | None = None) -> bool:
    """Asignar el experimento a un laboratorio lo prerregistra: hipótesis,
    protocolo, criterio de éxito y de refutación quedan congelados con fecha
    en un artefacto inmutable, antes de que exista ningún dato. Es lo que pide
    el prerregistro (OSF, AsPredicted) y la revisión de Zitnik 2026 para
    poder reportar después que fracción de lo probado se sostuvo."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    lab = laboratorio.strip()
    if not h or not lab or not h["experimento"]:
        return False
    ahora = ahora if ahora is not None else P.ahora_ms()
    x = h["experimento"]
    # Sin criterio de confirmación y de refutación no hay prerregistro que congelar:
    # es lo que separa un negativo interpretable de una lectura a posteriori.
    # Con el contrato nuevo basta una lectura que tenga a la vez su criterio de
    # confirmación y el de refutación, aunque los campos antiguos vengan vacíos.
    lecturas = XP.normalizar_contrato(x)["lecturas"]
    interpretable = ((x.get("confirma") or "").strip() and (x.get("refuta") or "").strip()) or (x.get("ensayo") or "").strip() or any(l["queConfirma"] and l["queRefuta"] for l in lecturas)
    if not x.get("prerregistradoEn") and not interpretable:
        con_evento(e, h["investigacionId"], "incidencia", f"No se puede prerregistrar «{str(h.get('titulo') or '')[:60]}»: faltan el criterio de confirmación o el de refutación", f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}", ahora)
        return False
    x["laboratorio"] = lab
    x["estado"] = "asignado"
    if not x.get("prerregistradoEn"):
        corrida = ultima_corrida_de(e, h["investigacionId"])
        contenido = texto_prerregistro(h, lab, ahora, corrida.get("arnes") if corrida else None)
        art_id = guardar_artefacto(e, h["investigacionId"], f"Prerregistro: {str(h.get('titulo') or '')[:80]}", "informe", contenido, f"Congelado el {datetime.fromtimestamp(ahora / 1000).strftime('%d/%m/%Y %H:%M')} al asignarlo a {lab}", corrida["iteracionActual"] if corrida else h["iteracion"], ahora, procedencia={"mensajes": {"hipotesis": h["id"], "version": h.get("version", 1), "decisiones": [d["id"] for d in e.get("decisiones", []) if d.get("hipotesisId") == h["id"]][:30]}, "entorno": {"arnes": corrida.get("arnes") if corrida else None}})
        x["prerregistradoEn"] = ahora
        x["prerregistroArtefactoId"] = art_id
        x["versionPrerregistrada"] = h.get("version", 1)  # el resultado probara esta version
        if lecturas:
            # Huella de las lecturas congeladas (orden canónico): si después cambia
            # una lectura, el hash deja de coincidir con el del artefacto.
            x["hashLecturas"] = XP.hash_lecturas(x)
        h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} prerregistro congelado al asignar a {lab} (versión {h.get('version', 1)})")
        con_evento(e, h["investigacionId"], "hipotesis_decidida", f"Experimento prerregistrado y asignado a {lab}: {h.get('titulo') or ''}", f"#/investigaciones/{h['investigacionId']}/artefactos/{art_id}", ahora)
    return True


def texto_prerregistro(h: dict, laboratorio: str, ahora: int, arnes: dict | None) -> str:
    """El registro inmutable. Mismo contenido en el frontend (acciones.ts)."""
    x = h["experimento"]
    c = h["comprobacion"]
    k = h.get("conclusion") or {}
    lineas = [
        f"# Prerregistro: {h['titulo']}",
        "",
        f"Congelado el {datetime.fromtimestamp(ahora / 1000).strftime('%d/%m/%Y %H:%M')}. Asignado a: {laboratorio}. Hipótesis {h['id']} versión {h.get('version', 1)}, iteración {h['iteracion']}, prerregistrada el {datetime.fromtimestamp((h.get('prerregistradaEn') or h.get('creadaEn') or ahora) / 1000).strftime('%d/%m/%Y')}. El resultado del laboratorio probara esta versión; si la hipótesis cambia después, se comprobara la compatibilidad.",
        "",
        "## Hipótesis (no se modifica después de esta fecha)",
        h["enunciado"],
        "",
        "## Mecanismo propuesto",
        h["mecanismo"],
        "",
        "## Como se comprobara",
        f"Biomarcador: {c['biomarcador']}",
        f"Cohorte: {c['cohorte']}",
        f"Diseño: {c['diseno']}",
        "",
        "## Protocolo",
        x["protocolo"],
        "",
        "## Ensayo y criterios fijados de antemano",
        x["ensayo"],
    ]
    # Contrato del experimento (rosa/experimento.py): lecturas separadas con su
    # criterio de confirmación y de refutación, sistema, propósito BEST, nivel y
    # puente al beneficio, con el hash de las lecturas. Vacío si no hay contrato.
    lineas += XP.bloque_prerregistro(x)
    lineas += [
        "",
        "## Coste estimado",
        x["costeEstimado"],
    ]
    if x.get("controles") or x.get("tamanoMuestral") or x.get("alternativa"):
        lineas += ["", "## Controles, tamaño muestral y alternativa", f"Controles: {x.get('controles') or 'no declarados'}", f"Tamaño muestral: {x.get('tamanoMuestral') or 'no declarado'}", f"Explicación alternativa y como se distingue: {x.get('alternativa') or 'no declarada'}"]
    if x.get("decisionQueCambia"):
        lineas += ["", "## Que decisión cambia con el resultado", x["decisionQueCambia"]]
    if x.get("analisisPedido"):
        lineas += ["", "## Análisis sobre datos existentes", x["analisisPedido"]]
    if k:
        lineas += ["", "## Estado de la evidencia al prerregistrar", f"Certeza: {k.get('certeza')}. Dirección: {k.get('direccion')}.", k.get("enunciado", ""), f"Subiría la certeza si: {k.get('subiria', '')}", f"Bajaría si: {k.get('bajaria', '')}"]
    if arnes:
        lineas += ["", "## Versión de ROSA2018", f"Commit {arnes.get('commit')}, firmas {arnes.get('firmas')}, programas optimizados: {arnes.get('optimizados')}."]
    lineas += ["", "Lo que se analice fuera de este registro se reporta como exploratorio, separado de lo prerregistrado."]
    return "\n".join(lineas)


CAMPOS_ENMENDABLES = ("protocolo", "ensayo", "controles", "tamanoMuestral", "confirma", "refuta", "analisisPedido")


def enmendar_experimento(e: Estado, hipotesis_id: str, campo: str, despues: str, motivo: str, quien: str, ahora: int) -> bool:
    """Una enmienda fechada del prerregistro (plan completo, sección 3): se
    puede cambiar el protocolo o los criterios después de congelarlos, pero
    queda escrito que, cuando, quien y por que, con el texto anterior al
    lado. Sin fecha de prerregistro no hay nada que enmendar: se edita. Con
    datos ya evaluados no se enmienda: los criterios ya se aplicaron."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not h.get("experimento") or campo not in CAMPOS_ENMENDABLES:
        return False
    x = h["experimento"]
    if not isinstance(x, dict) or not x.get("prerregistradoEn") or x.get("resultado"):
        return False
    nuevo, razon, autor = str(despues or "").strip(), str(motivo or "").strip(), str(quien or "").strip() or "persona"
    if not nuevo or not razon or nuevo == (x.get(campo) or ""):
        return False
    enmienda = {"fecha": ahora, "quien": autor, "campo": campo, "antes": x.get(campo) or "", "despues": nuevo, "motivo": razon}
    x[campo] = nuevo
    # Un registro antiguo (sin lecturas separadas) congela una lectura derivada del
    # ensayo y del par confirma/refuta: enmendar esos campos cambia esa lectura y el
    # hash guardado al prerregistrar dejaría de ser cierto en silencio. Se recalcula
    # y la enmienda guarda el anterior y el nuevo, como hace enmendar_lectura. Un
    # prerregistro anterior sin hash no lo inventa: el artefacto congelado no lo lleva.
    if x.get("hashLecturas"):
        hash_despues = XP.hash_lecturas(x)
        if hash_despues != x["hashLecturas"]:
            enmienda["hashAntes"], enmienda["hashDespues"] = x["hashLecturas"], hash_despues
            x["hashLecturas"] = hash_despues
    x.setdefault("enmiendas", []).append(enmienda)
    _anotar_procedencia(h, f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} enmienda {len(x['enmiendas'])} del prerregistro por {autor}: {campo} ({razon[:80]})")
    con_evento(e, h.get("investigacionId"), "hipotesis_decidida", f"Enmienda {len(x['enmiendas'])} del prerregistro ({campo}): {str(h.get('titulo') or '')[:80]}", f"#/investigaciones/{h.get('investigacionId')}/hipotesis/{h['id']}", ahora)
    return True


def _anotar_procedencia(h: dict, linea: str) -> None:
    """Una línea más en el registro de procedencia de la hipótesis, si la
    procedencia tiene la forma esperada (dict con lista `registro`). Con una
    procedencia rota o como texto no se escribe nada y no se lanza: la acción
    que la llama vale igual."""
    if isinstance(h.get("procedencia"), dict) and isinstance(h["procedencia"].get("registro"), list):
        h["procedencia"]["registro"].append(linea)


CAMPOS_LECTURA_ENMENDABLES = ("queConfirma", "queRefuta", "control", "unidad")


def enmendar_lectura(e: Estado, hipotesis_id: str, indice: int, campo: str, despues: str, motivo: str, quien: str, ahora: int) -> bool:
    """Enmienda fechada de una lectura del contrato del experimento (una
    lectura es una medida concreta con su criterio de confirmación y de
    refutación, su control y su unidad; ver rosa/experimento.py). Misma regla
    que `enmendar_experimento`: solo con prerregistro congelado y sin
    resultado evaluado; queda escrito qué lectura, qué campo, el texto
    anterior y el nuevo, quién, cuándo y por qué. `indice` es la posición en
    `experimento.lecturas` tal como está guardada. El nombre y el tipo de la
    lectura no se enmiendan: cambiarlos es otra lectura, no una corrección.
    Regla del hash (la del servidor manda; el espejo
    `frontend/src/datos/acciones.ts` enmendarLectura debe hacer exactamente
    esto, 17 de septiembre de 2026, M-32):
      1. hashAntes = experimento.hashLecturas si existe; si no,
         hash_lecturas(experimento) calculado antes de tocar nada.
      2. Se aplica el cambio a la lectura.
      3. hashDespues = hash_lecturas(experimento) recalculado.
      4. experimento.hashLecturas = hashDespues (el vigente es el nuevo).
      5. La enmienda guarda {fecha, quien, campo: "lecturas[i].campo",
         lectura: nombre, antes, despues, motivo, hashAntes, hashDespues}.
    El hash congelado al prerregistrar no se pierde: está en el artefacto del
    prerregistro y en `hashAntes` de la primera enmienda; la pantalla debe
    enseñar "congelado" el de la primera enmienda (o el del artefacto) y
    "actual" el de `hashLecturas`, no etiquetar el nuevo como congelado."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not isinstance(h.get("experimento"), dict) or campo not in CAMPOS_LECTURA_ENMENDABLES:
        return False
    x = h["experimento"]
    if not x.get("prerregistradoEn") or x.get("resultado"):
        return False
    lecturas = x.get("lecturas")
    if not isinstance(lecturas, list) or isinstance(indice, bool) or not isinstance(indice, int) or not (0 <= indice < len(lecturas)):
        return False
    lectura = lecturas[indice]
    if not isinstance(lectura, dict):
        return False
    nuevo, razon, autor = str(despues or "").strip(), str(motivo or "").strip(), str(quien or "").strip() or "persona"
    antes = str(lectura.get(campo) or "").strip()
    if not nuevo or not razon or nuevo == antes:
        return False
    hash_antes = x.get("hashLecturas") or XP.hash_lecturas(x)
    lectura[campo] = nuevo
    hash_despues = XP.hash_lecturas(x)
    x["hashLecturas"] = hash_despues
    nombre = str(lectura.get("nombre") or f"lectura {indice + 1}")
    x.setdefault("enmiendas", []).append({"fecha": ahora, "quien": autor, "campo": f"lecturas[{indice}].{campo}", "lectura": nombre, "antes": antes, "despues": nuevo, "motivo": razon, "hashAntes": hash_antes, "hashDespues": hash_despues})
    _anotar_procedencia(h, f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} enmienda {len(x['enmiendas'])} del prerregistro por {autor}: lectura «{nombre[:40]}», {campo} ({razon[:80]})")
    con_evento(e, h.get("investigacionId"), "hipotesis_decidida", f"Enmienda {len(x['enmiendas'])} del prerregistro (lectura «{nombre[:40]}», {campo}): {str(h.get('titulo') or '')[:80]}", f"#/investigaciones/{h.get('investigacionId')}/hipotesis/{h['id']}", ahora)
    return True


def registrar_protocolo_real(e: Estado, hipotesis_id: str, protocolo_real: dict, quien: str, ahora: int) -> bool:
    """Lo que el laboratorio hizo de verdad, separado de lo que se planeo:
    protocolo ejecutado, desviaciones respecto al prerregistro e identidad de
    las muestras (lote, línea celular, cohorte, fechas). El juez lo lee al
    evaluar los datos: una desviación que toca el criterio convierte el
    resultado en fallo técnico o lo limita, no lo maquilla."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not h.get("experimento") or not isinstance(protocolo_real, dict):
        return False
    x = h["experimento"]
    if x.get("estado") == "propuesto":
        return False
    texto = str(protocolo_real.get("texto", "")).strip()
    if not texto:
        return False
    x["protocoloReal"] = {"texto": texto[:4000], "desviaciones": str(protocolo_real.get("desviaciones", "")).strip()[:2000], "identidadMuestras": str(protocolo_real.get("identidadMuestras", "")).strip()[:2000], "registradoEn": ahora, "quien": quien.strip() or "persona"}
    h["procedencia"]["registro"].append(f"{datetime.fromtimestamp(ahora / 1000, tz=timezone.utc).isoformat()} protocolo real registrado por {quien}" + ("; con desviaciones" if x["protocoloReal"]["desviaciones"] else "; sin desviaciones declaradas"))
    if x.get("resultado") and x.get("ficheroDatos"):
        # Si los datos ya se evaluaron, el protocolo real cambia lo que el juez
        # leyo: se vuelve a evaluar contra el prerregistro con esta informacion.
        x.pop("resultado", None)
        h.pop("_resultadoEvaluado", None)
    return True


def texto_protocolo_real(x: dict) -> str:
    """El bloque que se le pasa al juez junto al prerregistro."""
    pr = x.get("protocoloReal")
    partes = []
    if pr:
        partes.append(f"PROTOCOLO REALMENTE EJECUTADO (registrado por {pr.get('quien')}):\n{pr.get('texto')}")
        partes.append("DESVIACIONES RESPECTO AL PRERREGISTRO: " + (pr.get("desviaciones") or "ninguna declarada"))
        partes.append("IDENTIDAD DE LAS MUESTRAS: " + (pr.get("identidadMuestras") or "no declarada"))
    else:
        partes.append("PROTOCOLO REALMENTE EJECUTADO: no registrado (asumir el prerregistrado y decirlo en limitaciones)")
    if x.get("enmiendas"):
        partes.append("ENMIENDAS FECHADAS DEL PRERREGISTRO:\n" + "\n".join(f"- {datetime.fromtimestamp(en['fecha'] / 1000).strftime('%d/%m/%Y')} {en['quien']}, {en['campo']}: '{en['antes'][:160]}' pasa a '{en['despues'][:160]}'. Motivo: {en['motivo'][:160]}" for en in x["enmiendas"]))
    return "\n\n".join(partes)


def es_fichero_sintetico(nombre: Any) -> bool:
    """Regla defensiva por nombre (S-18): un fichero que se llama "sintético",
    "synthetic", "dummy", "fake", "mock", "datos de prueba" o "prueba.csv" es
    de prueba aunque nadie marque la casilla. La regla vive en
    rosa/certeza.py (`NOMBRE_SINTETICO`) para que el techo GRADE y esta acción
    digan lo mismo; "prueba" suelta ("prueba_cognitiva.csv") y "humo" no
    cuentan porque en clínica son datos reales. Solo fuerza a sí; nunca
    convierte en real lo declarado de prueba."""
    return bool(CERTEZA.NOMBRE_SINTETICO.search(str(nombre or "")))


def registrar_datos_experimento(e: Estado, hipotesis_id: str, fichero: str, analisis: str, sintetico: Any = False) -> bool:
    """Los datos del laboratorio para un experimento asignado. `sintetico`
    (casilla "son datos de prueba" de la ficha; acepta bool o texto: "si",
    "sí", "true", "1", "yes", "verdadero" y "on", que es lo que manda un
    formulario HTML con la casilla marcada; cualquier otro texto es no) se
    guarda en `experimento.datosSinteticos` y se fuerza a True si el nombre
    del fichero lo delata (`es_fichero_sintetico`). El bucle
    (rosa/bucle/corrida.py, `_evaluar_resultado`) lo lee: una afirmación de
    laboratorio sintética lleva `sintetico: True`, no sube el techo GRADE ni
    crea hecho en el modelo de mundo. Antes un CSV llamado
    `datos_gfap_nfl_sintetico.csv` contaba como "análisis sobre datos reales"
    y subía el techo a moderada (17 de septiembre de 2026)."""
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h or not isinstance(fichero, str) or not fichero.strip() or not isinstance(h.get("experimento"), dict):
        return False
    if isinstance(sintetico, str):
        declarado = sintetico.strip().lower() in ("si", "sí", "true", "1", "yes", "verdadero", "on")
    else:
        declarado = bool(sintetico)
    x = P.experimento_con_datos(h["experimento"])
    x["ficheroDatos"] = fichero.strip()
    x["analisisPedido"] = str(analisis or "").strip()
    x["datosSinteticos"] = declarado or es_fichero_sintetico(fichero)
    x["estado"] = "datos_recibidos"
    x.pop("resultado", None)
    h.pop("_resultadoEvaluado", None)  # el bucle evalúa los datos contra el prerregistro
    return True


# ---------------------------------------------------------------------------
# Comentarios anclados
# ---------------------------------------------------------------------------


def anadir_comentario(e: Estado, hipotesis_id: str, ancla: dict, nota: str, ahora: int) -> bool:
    limpia = nota.strip()
    if not limpia or not str(ancla.get("cita", "")).strip() or len(limpia) > 1000:
        return False
    e["comentarios"].append({"id": P.nuevo_id("com"), "hipotesisId": hipotesis_id, "ancla": ancla, "nota": limpia, "estado": "pendiente", "creadoEn": ahora})
    return True


def editar_comentario(e: Estado, comentario_id: str, nota: str) -> bool:
    limpia = nota.strip()
    if not limpia or len(limpia) > 1000:
        return False
    for c in e["comentarios"]:
        if c["id"] == comentario_id and c["estado"] == "pendiente":
            c["nota"] = limpia
            return True
    return False


def quitar_comentario(e: Estado, comentario_id: str) -> bool:
    antes = len(e["comentarios"])
    e["comentarios"] = [c for c in e["comentarios"] if not (c["id"] == comentario_id and c["estado"] == "pendiente")]
    return len(e["comentarios"]) != antes


def enviar_comentarios(e: Estado, hipotesis_id: str, mensaje: str, quien: str, ahora: int) -> bool:
    pendientes = [c for c in e["comentarios"] if c["hipotesisId"] == hipotesis_id and c["estado"] == "pendiente"]
    texto = mensaje.strip()
    if not pendientes and not texto:
        return False
    h = _buscar(e["hipotesis"], hipotesis_id)
    if not h:
        return False
    lineas = [f"Sobre «{c['ancla']['cita']}»: {c['nota']}" for c in pendientes]
    cuerpo = "\n".join(l for l in [texto, *lineas] if l)
    n = len(pendientes)
    for c in pendientes:
        c["estado"] = "enviado"
    if h["estado"] == "propuesta":
        h["estado"] = "en_revision"
    h["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "comentada", "nota": (f"{n} {'comentario' if n == 1 else 'comentarios'}" if n else "Mensaje"), "aCiegas": False})
    h["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "investigadora", "texto": cuerpo, "creadoEn": ahora})
    h["_comentariosNuevos"] = True
    return True


# ---------------------------------------------------------------------------
# Meta-revision y modelo de mundo
# ---------------------------------------------------------------------------


def inyectar_debilidad(e: Estado, corrida_id: str, debilidad_id: str, quien: str = "Investigadora", ahora: int | None = None) -> bool:
    """Inyectar una debilidad como criterio de revisión cambia como razona
    ROSA2018: es un cambio de nivel 2 que la persona promueve directamente al
    pulsar el botón, y queda en el registro de aprendizaje."""
    c = corrida_de(e, corrida_id)
    if not c:
        return False
    ahora = ahora if ahora is not None else P.ahora_ms()
    for m in c["metaRevisiones"]:
        for d in m["debilidades"]:
            if d["id"] == debilidad_id:
                if d["inyectada"]:
                    return False
                d["inyectada"] = True
                if d["texto"] not in e["criteriosRevision"]:
                    e["criteriosRevision"].append(d["texto"])
                existente = next((x for x in e.get("aprendizaje", []) if x["origen"] == f"debilidad:{debilidad_id}"), None)
                if existente:
                    existente.update(estado="promovido", resueltoEn=ahora, resueltoPor=quien)
                else:
                    e.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(c["investigacionId"], 2, "criterio", d["texto"], f"debilidad:{debilidad_id}", "promovido", quien, ahora))
                return True
    return False


def recomprobar_retracciones(e: Estado, investigacion_id: str, ahora: int) -> bool:
    """Marca la petición; el bucle consulta Crossref de verdad y actualiza
    `retracción` y `retraccionComprobadaEn` en cada fuente."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    inv["_recomprobarRetracciones"] = ahora
    con_evento(e, investigacion_id, "retraccion", "Recomprobación de retractaciones pedida (Crossref y Retraction Watch)", None, ahora)
    return True


# ---------------------------------------------------------------------------
# Investigaciones y datos
# ---------------------------------------------------------------------------


def crear_investigacion(e: Estado, datos: dict, ahora: int, id_: str | None = None) -> str | bool:
    def t(k: str) -> str:
        return str(datos.get(k, "") or "").strip()

    if not t("titulo") or not t("objetivo") or not t("condicionParada"):
        return False
    cfg = datos.get("configuracion") or {}
    inv = {
        "id": id_ or P.nuevo_id("inv"),
        "titulo": t("titulo"),
        "objetivo": t("objetivo"),
        "relevancia": t("relevancia"),
        "limites": [l.strip() for l in datos.get("limites", []) if str(l).strip()],
        "condicionParada": t("condicionParada"),
        # Que parte de la condicion mide ROSA2018 y que parte decide una persona.
        "condicionParadaAutomatizada": PARADA.partes_automatizadas(t("condicionParada")),
        "revisores": [r.strip() for r in datos.get("revisores", []) if str(r).strip()],
        "estado": "activa",
        "creadaEn": ahora,
        "ramaDe": None,
        "configuracion": {
            "preferencias": str(cfg.get("preferencias", "")).strip(),
            "atributos": [a.strip() for a in cfg.get("atributos", []) if str(a).strip()],
            "restricciones": [r.strip() for r in cfg.get("restricciones", []) if str(r).strip()],
            "amplitud": amplitud_valida(cfg.get("amplitud")),
        },
        "datasets": [],
        "vigilarLiteraturaHasta": None,
        "mision": None,
        "puertaReproduccion": P.puerta_reproduccion(),
        # Vistas de programa que el bucle recalcula al cerrar cada iteración
        # (rosa/mapa_enfermedad.py, rosa/ruta.py, rosa/cifras_aprendizaje.py).
        "mapaEnfermedad": None,
        "mapaRuta": None,
        "cifrasAprendizaje": None,
    }
    mision = datos.get("mision")
    if isinstance(mision, dict) and any(str(mision.get(k, "")).strip() for k in ("poblacion", "etapa", "mecanismo", "tipoIntervencion")):
        # La persona ya escribio la mision al crear: queda aprobada por ella.
        inv["mision"] = P.mision_vacia()
        e["investigaciones"].append(inv)
        aprobar_mision(e, inv["id"], mision, str(datos.get("quien") or "Investigadora"), ahora)
        return inv["id"] if not datos.get("heredarModeloDe") else _heredar(e, inv, datos, ahora)
    e["investigaciones"].append(inv)
    return _heredar(e, inv, datos, ahora)


def copiar_hechos(e: Estado, origen_id: str, destino_id: str, ahora: int | None = None) -> int:
    """Copia los hechos de una investigación a otra con el sufijo del destino en
    el id (regla de herencia) y remapea los enlaces entre hechos (sustituyeA,
    sustituidoPor, resuelveA, contradiceA) para que apunten a las copias; un
    enlace a un hecho que no viaja se conserva tal cual. Al heredar, los
    repetidos del origen (mismo texto normalizado, o el mismo hecho con otras
    palabras según rosa/hechos.py mismo_hecho) se funden en uno solo, el más
    antiguo, sumando procedencia, afirmaciones y citas, con un movimiento en
    su historial fechado en `ahora` (si no llega, en el `actualizadoEn` más
    reciente de las copias). Devuelve cuántos hechos quedaron en el destino.
    Misma regla en frontend/src/datos/acciones.ts copiarHechos."""
    propios = [x for x in e["hechos"] if x["investigacionId"] == origen_id]
    mapa = {x["id"]: f"{x['id']}-{destino_id}" for x in propios}

    def remapear(v: Any) -> Any:
        if isinstance(v, list):
            return [mapa.get(i, i) for i in v]
        return mapa.get(v, v) if isinstance(v, str) else v

    copias = []
    for h in propios:
        copia = {**copy.deepcopy(h), "id": mapa[h["id"]], "investigacionId": destino_id}
        for clave in ("sustituyeA", "sustituidoPor", "resuelveA", "contradiceA"):
            if clave in copia:
                copia[clave] = remapear(copia[clave])
        copias.append(copia)
    if ahora is None:
        ahora = max((int(c.get("actualizadoEn") or 0) for c in copias), default=0)
    supervivientes, _, _ = H.fundir_duplicados(copias, ahora)
    e["hechos"].extend(supervivientes)
    return len(supervivientes)


def _heredar(e: Estado, inv: dict, datos: dict, ahora: int | None = None) -> str:
    heredar = datos.get("heredarModeloDe")
    if heredar:
        copiar_hechos(e, heredar, inv["id"], ahora)
    return inv["id"]


def editar_investigacion(e: Estado, investigacion_id: str, ahora: int, titulo: str | None = None, objetivo: str | None = None, quien: str = "Investigadora") -> bool:
    """Cambia el título o el objetivo de una investigación ya creada (misma regla
    en frontend/src/datos/acciones.ts editarInvestigacion). Solo se aplican los
    campos que llegan con texto; un título vacío no borra el anterior. Deja un
    evento para que quede en el registro quién lo cambió y de qué a qué."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    cambios: list[str] = []
    for campo, valor in (("titulo", titulo), ("objetivo", objetivo)):
        nuevo = str(valor or "").strip()
        if nuevo and nuevo != inv.get(campo):
            cambios.append(f"{'título' if campo == 'titulo' else 'objetivo'}: «{str(inv.get(campo) or '')[:80]}» pasa a «{nuevo[:80]}»")
            inv[campo] = nuevo
    if not cambios:
        return False
    con_evento(e, investigacion_id, "investigacion_editada", f"{quien} editó la investigación: " + "; ".join(cambios), f"#/investigaciones/{investigacion_id}/investigacion", ahora)
    return True


def bifurcar_investigacion(e: Estado, investigacion_id: str, motivo: str, ahora: int, id_: str | None = None) -> str | bool:
    origen = _buscar(e["investigaciones"], investigacion_id)
    if not origen:
        return False
    nuevo = id_ or P.nuevo_id("inv")
    # Copia profunda: la puerta, la mision con sus areas, la memoria y los datasets
    # de la rama no pueden ser los mismos objetos que los del origen (los reducers
    # mutan en sitio y el cambio se persistiria en las dos investigaciones).
    rama = {
        **copy.deepcopy(origen),
        "id": nuevo,
        # Lo que la persona escribe al bifurcar es el nombre de la rama (y su
        # motivo): asi la rama se distingue de la original a primera vista.
        "titulo": motivo.strip()[:90] if motivo.strip() else f"{origen['titulo']} (rama)",
        "objetivo": origen["objetivo"] if not motivo.strip() else f"{origen['objetivo']}\n\nRama de '{origen['titulo']}': {motivo.strip()}",
        "creadaEn": ahora,
        "ramaDe": origen["id"],
        "vigilarLiteraturaHasta": None,
        "preguntasABases": [],
        # Los mapas y las cifras son de la investigación de origen: la rama
        # empieza sin ellos y el bucle los recalcula con sus propios hechos.
        "mapaEnfermedad": None,
        "mapaRuta": None,
        "cifrasAprendizaje": None,
    }
    e["investigaciones"].append(rama)
    copiar_hechos(e, investigacion_id, nuevo, ahora)
    return nuevo


def actualizar_configuracion(e: Estado, investigacion_id: str, configuracion: dict) -> bool:
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    inv["configuracion"] = {
        "preferencias": str(configuracion.get("preferencias", "")).strip(),
        "atributos": [a.strip() for a in configuracion.get("atributos", []) if str(a).strip()],
        "restricciones": [r.strip() for r in configuracion.get("restricciones", []) if str(r).strip()],
        "amplitud": amplitud_valida(configuracion.get("amplitud", (inv.get("configuracion") or {}).get("amplitud"))),
    }
    return True


def amplitud_valida(valor: Any) -> str:
    """Una de las amplitudes de búsqueda conocidas; la de por defecto si no."""
    from rosa import politicas

    return valor if isinstance(valor, str) and valor in politicas.AMPLITUD else politicas.AMPLITUD_POR_DEFECTO


def fijar_amplitud(e: Estado, investigacion_id: str, amplitud: str) -> bool:
    """La persona elige con un botón cuánto explora ROSA2018 fuera de la pregunta:
    enfocada (nada), equilibrada (un tercio de las consultas) o amplia (la
    mitad). Se guarda en la configuración de la investigación."""
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not isinstance(amplitud, str):
        return False
    from rosa import politicas

    if amplitud not in politicas.AMPLITUD:
        return False
    inv.setdefault("configuracion", {"preferencias": "", "atributos": [], "restricciones": []})["amplitud"] = amplitud
    return True


def anadir_dataset(e: Estado, investigacion_id: str, dataset: dict, id_: str | None = None) -> str | bool:
    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv or not str(dataset.get("nombre", "")).strip():
        return False
    ds = {**dataset, "id": id_ or P.nuevo_id("ds"), "estado": "pendiente"}
    ds.setdefault("procedencia", None)
    for k in ("columnasSinDiccionario", "valoresCentinela", "nombresDuplicados"):
        ds[k] = int(ds.get(k) or 0)
    inv["datasets"].append(ds)
    _registrar_en_programa(e, investigacion_id, ds)
    return ds["id"]


def _registrar_en_programa(e: Estado, investigacion_id: str, ds: dict) -> None:
    """Deja el dataset subido en el registro del programa (`datasetsPrograma`,
    fuente manual, deduplicado por origen o hash). El registro es un espejo
    para la vista de programa: si falla por lo que sea, la acción de la
    persona (subir o completar la procedencia) sigue valiendo y queda un
    evento que lo dice, nunca una excepción que la deshaga."""
    try:
        _realinear_registro_programa(e, ds)
        id_registro = DP.desde_dataset_subido(e, investigacion_id, ds, P.ahora_ms())
        if id_registro:
            # El id del registro del programa se guarda en el dataset para que,
            # cuando la persona complete el origen, se actualice ese mismo
            # registro en vez de abrirse otro (ver _realinear_registro_programa).
            ds["registroProgramaId"] = id_registro
    except Exception as ex:  # noqa: BLE001  el registro del programa nunca rompe la acción
        try:
            con_evento(e, investigacion_id, "incidencia", f"El dataset «{str(ds.get('nombre', ''))[:60]}» no se pudo anotar en el registro del programa: {type(ex).__name__}", f"#/investigaciones/{investigacion_id}", P.ahora_ms())
        except Exception:  # noqa: BLE001
            pass


def _realinear_registro_programa(e: Estado, ds: dict) -> None:
    """El registro del programa se identifica por (fuente, accession) y la
    accession de un dataset subido es el origen declarado o, si no lo hay, el
    hash del fichero. El servidor sube el fichero con hash y sin origen, y la
    persona escribe el origen después en el libro de procedencia: sin esto, la
    segunda anotación abriría un registro nuevo y el mismo fichero quedaría dos
    veces. Aquí, antes de volver a anotar, el registro que ya tiene el dataset
    (por su `registroProgramaId`) pasa a llevar la accession nueva y deja
    escrito el cambio; si otro registro ya usa esa accession, `registrar` los
    funde en uno."""
    id_registro = ds.get("registroProgramaId")
    proc = ds.get("procedencia") if isinstance(ds.get("procedencia"), dict) else {}
    origen = str(proc.get("origen") or "").strip()
    if not id_registro or not origen:
        return
    registros = e.get("datasetsPrograma")
    if not isinstance(registros, list):
        return
    for r in registros:
        if isinstance(r, dict) and r.get("id") == id_registro:
            anterior = str(r.get("accession") or "")
            if r.get("fuente") == "manual" and anterior.upper() != origen.upper():
                r["accession"] = origen
                if isinstance(r.get("registro"), list):
                    r["registro"].append(f"origen declarado en el libro de procedencia: la accession pasa de {anterior or 'ninguna'} a {origen}")
            return


def actualizar_procedencia_dataset(e: Estado, investigacion_id: str, dataset_id: str, procedencia: dict) -> bool:
    """La persona completa el libro de procedencia: origen, versión,
    licencia, permisos, uso de IA autorizado, sintético, cohorte, clase. El
    hash y el diccionario los fija el servidor al subir el fichero y aquí no
    se pueden cambiar."""
    ds = _dataset(e, investigacion_id, dataset_id)
    if not ds or not isinstance(procedencia, dict):
        return False
    base = ds.get("procedencia") or P.procedencia_dataset_vacia()
    editables = ("origen", "version", "licencia", "permisos", "cohorte")
    nueva = {**base, **{k: str(procedencia[k]).strip() for k in editables if k in procedencia}}
    if procedencia.get("usoIAAutorizado") in ("si", "no", "desconocido"):
        nueva["usoIAAutorizado"] = procedencia["usoIAAutorizado"]
    if procedencia.get("acceso") in ("abierto", "controlado", "colaboracion", "propio"):
        nueva["acceso"] = procedencia["acceso"]
    if "permiteLlmTerceros" in procedencia:
        nueva["permiteLlmTerceros"] = bool(procedencia["permiteLlmTerceros"])
    if "restriccionIA" in procedencia:
        nueva["restriccionIA"] = str(procedencia["restriccionIA"]).strip()[:400]
    if "sintetico" in procedencia:
        nueva["sintetico"] = bool(procedencia["sintetico"])
    if procedencia.get("clase") in politicas.CLASES_EVIDENCIA:
        nueva["clase"] = procedencia["clase"]
    if procedencia.get("fechaObtencion") is None or isinstance(procedencia.get("fechaObtencion"), (int, float)):
        # base.get: un dataset subido con una procedencia parcial (sin fecha) no rompe.
        nueva["fechaObtencion"] = procedencia.get("fechaObtencion", base.get("fechaObtencion"))
    if isinstance(procedencia.get("diccionario"), list):
        nueva["diccionario"] = [{"columna": str(c.get("columna", "")), "descripcion": str(c.get("descripcion", "")).strip(), "tipo": c.get("tipo", "texto"), "unidad": str(c.get("unidad", "")).strip()} for c in procedencia["diccionario"] if isinstance(c, dict) and str(c.get("columna", ""))]
        ds["columnasSinDiccionario"] = sum(1 for c in nueva["diccionario"] if not c["descripcion"])
    ds["procedencia"] = nueva
    # El libro de procedencia trae el origen, la cohorte y el acceso: el registro
    # del programa se actualiza con ellos (funde con el registro del mismo dataset).
    _registrar_en_programa(e, investigacion_id, ds)
    return True


def _dataset(e: Estado, investigacion_id: str, dataset_id: str) -> dict | None:
    inv = _buscar(e["investigaciones"], investigacion_id)
    return _buscar(inv["datasets"], dataset_id) if inv else None


def decidir_dataset(e: Estado, investigacion_id: str, dataset_id: str, decision: str) -> bool:
    ds = _dataset(e, investigacion_id, dataset_id)
    if not ds or decision not in ("aprobado", "rechazado"):
        return False
    if decision == "aprobado" and (ds["columnasSinDiccionario"] > 0 or ds["valoresCentinela"] > 0 or ds["nombresDuplicados"] > 0):
        return False
    proc = ds.get("procedencia")
    # Un dataset con fichero no se aprueba sin libro de procedencia: origen,
    # licencia y si el uso con IA esta autorizado. "Desconocido" no aprueba.
    if decision == "aprobado" and proc and proc.get("hash") and (not proc.get("origen") or not proc.get("licencia") or proc.get("usoIAAutorizado") != "si"):
        return False
    ds["estado"] = decision
    for h in e["hipotesis"]:
        if h["investigacionId"] == investigacion_id:
            recalcular_bloqueos(e, h)
    return True


def aprobar_diccionario(e: Estado, investigacion_id: str, dataset_id: str) -> bool:
    ds = _dataset(e, investigacion_id, dataset_id)
    if not ds:
        return False
    ds["columnasSinDiccionario"] = 0
    return True


def corregir_dataset(e: Estado, investigacion_id: str, dataset_id: str) -> bool:
    ds = _dataset(e, investigacion_id, dataset_id)
    if not ds:
        return False
    ds["valoresCentinela"] = 0
    ds["nombresDuplicados"] = 0
    return True


def clasificar_dataset(e: Estado, investigacion_id: str, dataset_id: str, clasificacion: str) -> bool:
    ds = _dataset(e, investigacion_id, dataset_id)
    if not ds or clasificacion not in ("publico", "interno", "personas"):
        return False
    ds["clasificacion"] = clasificacion
    return True


# ---------------------------------------------------------------------------
# Artefactos
# ---------------------------------------------------------------------------


def destacar_artefacto(e: Estado, artefacto_id: str) -> bool:
    a = _buscar(e["artefactos"], artefacto_id)
    if not a:
        return False
    a["destacado"] = not a["destacado"]
    return True


def procedencia_artefacto(**partes: Any) -> dict[str, Any]:
    """Las cinco pestañas de procedencia de una versión (como en Claude
    Science): mensajes (de donde salió: pistas, decisiones, eventos), código
    (el script que la produjo), registroEjecución (lo que de verdad corrió:
    ejecuciones con estado y cifras), entorno (imagen y versiones de
    paquetes, modelos usados) y revisión (los hallazgos del revisor). Lo que
    no aplica queda None, no se inventa."""
    base = {"mensajes": None, "codigo": None, "registroEjecucion": None, "entorno": None, "revision": None}
    base.update({k: v for k, v in partes.items() if k in base})
    return base


def guardar_artefacto(e: Estado, investigacion_id: str, nombre: str, tipo: str, contenido: str, resumen: str, iteracion: int, ahora: int, id_: str | None = None, procedencia: dict | None = None) -> str:
    """Mismo nombre en la misma investigación = versión nueva (no se
    sobrescribe). Cada versión lleva su procedencia en cinco pestañas."""
    version = {"n": 1, "creadaEn": ahora, "resumen": resumen, "contenido": contenido, "iteracion": iteracion, "procedencia": procedencia_artefacto(**(procedencia or {}))}
    existente = next((a for a in e["artefactos"] if a["investigacionId"] == investigacion_id and a["nombre"] == nombre), None)
    if existente:
        version["n"] = len(existente["versiones"]) + 1
        existente["versiones"].append(version)
        return existente["id"]
    nuevo = id_ or P.nuevo_id("art")
    e["artefactos"].append({"id": nuevo, "investigacionId": investigacion_id, "nombre": nombre, "tipo": tipo, "destacado": False, "versiones": [version]})
    return nuevo


# ---------------------------------------------------------------------------
# Calidad y ajustes
# ---------------------------------------------------------------------------


def cambiar_estado_caso(e: Estado, clave: str, nuevo: str) -> bool:
    if nuevo not in ("aprobado", "descartado", "propuesto"):
        return False
    for c in e["casos"]:
        if c["clave"] == clave:
            c["estado"] = nuevo
            return True
    return False


def editar_respuesta_caso(e: Estado, clave: str, respuesta: str) -> bool:
    limpia = respuesta.strip()
    if not limpia or len(limpia) > 2000:
        return False
    for c in e["casos"]:
        if c["clave"] == clave:
            c["respuestaEsperada"] = limpia
            return True
    return False


def editar_recuerdo(e: Estado, id_: str, texto: str) -> bool:
    r = _buscar(e["memoria"], id_)
    if not r or not texto.strip():
        return False
    r["texto"] = texto.strip()
    return True


def borrar_recuerdo(e: Estado, id_: str) -> bool:
    antes = len(e["memoria"])
    e["memoria"] = [r for r in e["memoria"] if r["id"] != id_]
    return len(e["memoria"]) != antes


def anadir_criterio(e: Estado, texto: str) -> bool:
    limpio = texto.strip()
    if not limpio or limpio in e["criteriosRevision"]:
        return False
    e["criteriosRevision"].append(limpio)
    return True


def borrar_criterio(e: Estado, indice: int | None = None, texto: str | None = None) -> bool:
    """Con `texto` se borra la primera coincidencia exacta; la posición es el
    respaldo. Dos pestañas que borran a la vez no se llevan un criterio ajeno."""
    lista = e["criteriosRevision"]
    if texto is not None:
        if texto not in lista:
            return False
        lista.remove(texto)
        return True
    if indice is None or not (0 <= indice < len(lista)):
        return False
    del lista[indice]
    return True


def actualizar_avisos(e: Estado, avisos: dict) -> bool:
    """Se normaliza campo a campo desde la plantilla: un cuerpo malformado no
    puede romper la interfaz de todos los navegadores conectados."""
    if not isinstance(avisos, dict):
        return False
    base = P.estado_inicial()["avisos"]
    correo = avisos.get("correo") if isinstance(avisos.get("correo"), dict) else {}
    slack = avisos.get("slack") if isinstance(avisos.get("slack"), dict) else {}
    cuando = avisos.get("cuando") if isinstance(avisos.get("cuando"), dict) else {}
    e["avisos"] = {
        "correo": {"activo": bool(correo.get("activo", base["correo"]["activo"])), "direccion": str(correo.get("direccion", base["correo"]["direccion"]))[:200]},
        "slack": {"activo": bool(slack.get("activo", base["slack"]["activo"])), "canal": str(slack.get("canal", base["slack"]["canal"]))[:200]},
        "cuando": {k: bool(cuando.get(k, v)) for k, v in base["cuando"].items()},
    }
    return True


def actualizar_politica_esperas(e: Estado, politica: dict) -> bool:
    if not isinstance(politica, dict):
        return False
    horas = politica.get("horas")
    if not isinstance(horas, (int, float)) or isinstance(horas, bool) or horas <= 0 or horas > 24 * 365:
        return False
    accion = politica.get("accion", "recordar")
    if accion not in ("recordar", "escalar", "detener", "continuar"):
        return False
    e["politicaEsperas"] = {"horas": horas, "accion": accion, "escalarA": str(politica.get("escalarA", "")).strip()[:200]}
    return True


def borrar_plan_guardado(e: Estado, id_: str) -> bool:
    antes = len(e["planesGuardados"])
    e["planesGuardados"] = [p for p in e["planesGuardados"] if p["id"] != id_]
    return len(e["planesGuardados"]) != antes


# ---------------------------------------------------------------------------
# Acciones que solo existen en el servidor
# ---------------------------------------------------------------------------


def iniciar_corrida(e: Estado, investigacion_id: str, ahora: int, limite: int | None = None, parada: dict | None = None) -> str | bool:
    """Arranca una corrida nueva si la investigación no tiene ninguna viva.
    El bucle la ve en `esperando_plan` sin iteraciones y propone el plan.
    `parada` (opcional): horas, iteraciones, llamadas o texto que detienen
    esta corrida, lo que llegue primero, además de la condición de la
    investigación. Si fija llamadas y no hay tope de presupuesto, el tope es
    ese mismo número, para que las dos cifras cuenten lo mismo."""
    from rosa import parada as PARADA

    inv = _buscar(e["investigaciones"], investigacion_id)
    if not inv:
        return False
    ultima = ultima_corrida_de(e, investigacion_id)
    if ultima and ultima["estado"] not in ("detenida", "terminada"):
        return False
    parada_n = PARADA.normalizar_parada(parada)
    if limite is None and parada_n and parada_n.get("llamadas"):
        limite = int(parada_n["llamadas"])
    c = P.nueva_corrida(investigacion_id, (ultima["numero"] + 1) if ultima else 1, ahora, limite, parada_n)
    # Versiones de programa (GEPA continuo) fijadas al crear la corrida, no en la primera
    # llamada, y visibles en el arnés público: el prerregistro y el RO-Crate las nombran.
    activos = dict(e.get("_gepaActivos") or {})
    c["_gepaVersiones"] = activos
    if activos:
        c["arnes"] = {**(c.get("arnes") or {}), "optimizados": ", ".join(f"{k}@{str(v)[:8]}" for k, v in sorted(activos.items()))}
    e["corridas"].append(c)
    if inv.get("estado") == "cerrada":
        con_evento(e, investigacion_id, "corrida_estado", "Investigación reabierta al crear una corrida nueva", f"#/investigaciones/{investigacion_id}/corrida", ahora)
    inv["estado"] = "activa"
    resumen = PARADA.resumen_parada(parada_n)
    con_evento(e, investigacion_id, "corrida_estado", f"Corrida {c['numero']} creada; ROSA2018 propone el plan de la iteración 1" + (f". Se detiene con {resumen}" if resumen else ""), f"#/investigaciones/{investigacion_id}/corrida", ahora)
    return c["id"]
