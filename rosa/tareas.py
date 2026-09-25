"""La cola de triaje: lo que un paso vio y pidió investigar, aceptado o rechazado
SIEMPRE con motivo escrito.

Del arnés de Yoon y otros (2026): de sus 119 tareas, 98 las abrieron los propios
agentes, y el descubrimiento que el artículo destaca salió de una tarea de
seguimiento que un worker abrió DESPUÉS de rechazar lo que estaba investigando.
Su cola de triaje libera o rechaza cada propuesta con una razón escrita.

En ROSA2018 el plan de la iteración lo escribe el cerebro al empezar y se
congela: medido sobre el estado guardado, 50 iteraciones con planes de 6 o 7
pasos y siempre los mismos seis tipos. El planificador reproduce la plantilla, y
un paso que ve algo raro no puede pedir trabajo. Lo raro se apuntaba (91
cuestiones, 89 abiertas) pero no se convertía en acción.

Qué NO es esto. No son cuestiones: una cuestión dice qué no sabemos, una tarea
dice qué se HACE para saberlo. Las cuestiones se quedan como están (y están
saturadas: 60 abiertas de 60 en una investigación), así que meter tareas por ahí
las tiraría por el tope. Una tarea puede apuntar a una cuestión con
`cuestionId`. Tampoco es el vivero, que guarda ideas de hipótesis esperando
evidencia, no acciones.

Lo que cuesta: cero llamadas nuevas. Las propuestas viajan como campo de salida
de llamadas que ya se hacen, y el triaje es regla pura: no llama a nadie. El
juicio de fondo lo sigue haciendo el cerebro en la llamada que ya paga, la del
plan de la iteración siguiente.

Lo que NO se construyó, a propósito (informe de choques del 25 de septiembre de
2026): la tarea forzada por regla, que metía un paso en el plan aunque el
planificador no lo programara. Podía costar hasta 90 llamadas
(`COSTE_POR_TIPO["hipotesis"]`) y el mismo efecto antienterramiento sale gratis:
la cola viaja en el traspaso a la iteración siguiente y `ProponerPlan` tiene que
explicar por escrito cada tarea que deja fuera.
"""

from __future__ import annotations

from typing import Any

from rosa import config, cuestiones as CU, politicas
from rosa.estado import plantilla as P

ESTADOS = ("propuesta", "aceptada", "programada", "hecha", "rechazada", "caducada")
ORIGENES = ("paso", "revisor", "regla", "persona")
# Las herramientas que una tarea puede pedir: las nueve de `PASOS.EJECUTORES`
# menos ninguna. Todas leen o calculan; ninguna toca el mundo real, así que la
# cola no sube el nivel de autonomía de ROSA2018 (sigue en el 2 de Beal y
# Rogers) y `contactar_laboratorio` se queda fuera.
HERRAMIENTAS = ("literatura", "ensayos", "extraccion", "verificacion", "novedad", "modelo", "hipotesis", "analisis", "meta")
# Estados en los que la tarea todavía espera a que algo pase.
VIVAS = ("propuesta", "aceptada", "programada")


def _recortar(texto: Any, maximo: int = 400) -> str:
    return str(texto or "").strip()[:maximo]


def nueva(investigacion_id: str, que_vio: str, que_haria: str, por_que: str, herramienta: str, origen: dict[str, Any], ahora: int, cuestion_id: str | None = None, hipotesis_id: str | None = None, quien: str = config.QUIEN_ROSA) -> dict[str, Any]:
    """Una tarea todavía fuera del estado (la mete `registrar_con_motivo`).

    Los cuatro campos son los que distinguen una propuesta útil de una
    decorativa, y son los mismos que ya distinguen un paso útil en
    `PasoPropuesto` (`valor_decision`, `espera`, `si_no_aparece`): qué vio con la
    cifra o el identificador que lo sostiene, qué haría, por qué importa (qué
    decisión cambiaría) y con qué herramienta."""
    return {
        "id": P.nuevo_id("ta"),
        "investigacionId": investigacion_id,
        "queVio": _recortar(que_vio),
        "queHaria": _recortar(que_haria),
        "porQue": _recortar(por_que, 300),
        "herramienta": str(herramienta or "").strip(),
        "origen": {"tipo": str((origen or {}).get("tipo") or "paso"), "pasoId": (origen or {}).get("pasoId"), "iteracion": (origen or {}).get("iteracion"), "detalle": _recortar((origen or {}).get("detalle"), 200)},
        "cuestionId": cuestion_id,
        "hipotesisId": hipotesis_id,
        "estado": "propuesta",
        "motivo": "",
        "veces": 1,
        "quien": str(quien or config.QUIEN_ROSA).strip() or config.QUIEN_ROSA,
        "creadaEn": int(ahora),
        "historial": [],
    }


def _texto(t: dict[str, Any]) -> str:
    """Con qué se compara una tarea con otra: lo que vio más lo que haría. La
    herramienta no entra: la misma observación pedida con otra herramienta sigue
    siendo la misma tarea."""
    return f"{t.get('queVio', '')} {t.get('queHaria', '')}".strip()


def equivalente_en(tareas: list[dict[str, Any]], t: dict[str, Any], estados: tuple[str, ...]) -> tuple[dict[str, Any], str] | None:
    """La tarea de `tareas` que dice lo mismo que `t`, con el motivo. Se reutiliza
    `cuestiones.equivalencia`, que ya distingue "¿sube GFAP antes que NfL?" de la
    pregunta al revés y ya está probada."""
    for otra in tareas:
        if not isinstance(otra, dict) or otra.get("investigacionId") != t.get("investigacionId") or otra.get("estado") not in estados:
            continue
        motivo = CU.equivalencia(_texto(t), _texto(otra))
        if motivo:
            return otra, motivo
    return None


def _leccion_que_choca(e: dict[str, Any], t: dict[str, Any]) -> dict[str, Any] | None:
    """La lección del ámbito de esta tarea que dice que no se repita. Es el "do
    not re-mine" que ya funciona: las lecciones se generan por regla al cerrar y
    entran en los prompts de la iteración siguiente."""
    ambito = {"literatura": "consultas", "ensayos": "consultas", "extraccion": "consultas", "analisis": "analisis"}.get(t.get("herramienta", ""), "plan")
    for lec in e.get("lecciones", []) or []:
        if not isinstance(lec, dict) or lec.get("investigacionId") != t.get("investigacionId") or lec.get("ambito") != ambito:
            continue
        if CU.equivalencia(_texto(t), str(lec.get("texto") or "")):
            return lec
    return None


def triar(e: dict[str, Any], t: dict[str, Any], ahora: int, aceptadas_ya: int = 0) -> tuple[str, str]:
    """El triaje, por regla y sin ningún modelo: (estado, motivo). El rechazo
    lleva SIEMPRE motivo escrito, que es la mitad del valor de la cola de Yoon.

    Por qué regla y no cerebro: un triaje con modelo costaría una llamada por
    tarea y, con unas 590 llamadas por iteración en la corrida 16, eso se come el
    margen. El juicio de fondo lo hace el cerebro en la llamada que ya paga, la
    del plan siguiente."""
    tareas = [x for x in (e.get("tareas") or []) if isinstance(x, dict)]
    if not _recortar(t.get("queHaria")):
        return "rechazada", "la propuesta no dice qué haría, solo qué vio"
    if not _recortar(t.get("queVio")):
        return "rechazada", "la propuesta no dice qué vio: sin la observación que la sostiene no se puede juzgar"
    if t.get("herramienta") not in HERRAMIENTAS:
        return "rechazada", f"ROSA2018 no tiene herramienta para «{t.get('herramienta')}»; las que hay son {', '.join(HERRAMIENTAS)}"
    if t.get("herramienta") == "analisis":
        inv = next((i for i in e.get("investigaciones", []) if isinstance(i, dict) and i.get("id") == t.get("investigacionId")), {}) or {}
        if not any(isinstance(d, dict) and d.get("estado") == "aprobado" and (d.get("procedencia") or {}).get("hash") for d in (inv.get("datasets") or [])):
            return "rechazada", "pide un análisis in silico y la investigación no tiene ningún dataset aprobado con fichero"
    ya = equivalente_en(tareas, t, VIVAS)
    if ya:
        return "fusionada", f"dice lo mismo que la tarea que ya está en cola ({ya[1]}): se suma a esa en vez de duplicarla"
    antes = equivalente_en(tareas, t, ("rechazada", "caducada", "hecha"))
    if antes:
        otra, motivo = antes
        historial = otra.get("historial") if isinstance(otra.get("historial"), list) else []
        cuando = historial[-1].get("fecha") if historial else otra.get("creadaEn")
        return "rechazada", f"ya se propuso y quedó {otra.get('estado')} ({motivo}): {_recortar(otra.get('motivo'), 160) or 'sin motivo registrado'} (fecha {cuando})"
    lec = _leccion_que_choca(e, t)
    if lec:
        return "rechazada", f"choca con una lección de esta investigación ({lec.get('id')}): {_recortar(lec.get('texto'), 200)}"
    vivas = [x for x in tareas if x.get("investigacionId") == t.get("investigacionId") and x.get("estado") in ("propuesta", "aceptada")]
    if len(vivas) >= politicas.MAX_TAREAS_EN_COLA:
        return "rechazada", f"la cola está llena ({politicas.MAX_TAREAS_EN_COLA} tareas esperando): primero se vacía"
    if aceptadas_ya >= politicas.MAX_TAREAS_ACEPTADAS_POR_ITERACION:
        return "rechazada", f"ya se aceptaron {aceptadas_ya} tareas en esta iteración, que es el tope"
    return "aceptada", "pasa el triaje: dice qué vio, qué haría y con qué herramienta, y no repite nada"


def registrar_con_motivo(e: dict[str, Any], t: dict[str, Any], ahora: int, aceptadas_ya: int = 0) -> tuple[str, str]:
    """Reducer: pasa la tarea por el triaje y la escribe con su veredicto.
    Devuelve (estado, motivo) para que quien llama lo pueda contar y enseñar.

    Una tarea que dice lo mismo que otra en cola no se escribe: se le suma
    `veces` a la que estaba, que es lo que dice que dos pasos vieron lo mismo."""
    estado, motivo = triar(e, t, ahora, aceptadas_ya)
    tareas = e.setdefault("tareas", [])
    if estado == "fusionada":
        ya = equivalente_en([x for x in tareas if isinstance(x, dict)], t, VIVAS)
        if ya:
            ya[0]["veces"] = int(ya[0].get("veces") or 1) + 1
            ya[0].setdefault("historial", []).append({"estado": ya[0].get("estado"), "motivo": f"otro paso vio lo mismo: {_recortar(t.get('queVio'), 160)}", "fecha": int(ahora)})
            return "fusionada", motivo
        estado = "aceptada"
    if len([x for x in tareas if isinstance(x, dict) and x.get("investigacionId") == t.get("investigacionId")]) >= politicas.MAX_TAREAS_POR_INVESTIGACION:
        return "rechazada", f"esta investigación ya tiene {politicas.MAX_TAREAS_POR_INVESTIGACION} tareas registradas"
    t = dict(t, estado=estado, motivo=motivo)
    t.setdefault("historial", []).append({"estado": estado, "motivo": motivo, "fecha": int(ahora)})
    tareas.append(t)
    return estado, motivo


def aceptadas(e: dict[str, Any], investigacion_id: str) -> list[dict[str, Any]]:
    """Las que el triaje dejó pasar y esperan entrar en un plan, las que más
    veces se pidieron primero."""
    propias = [t for t in (e.get("tareas") or []) if isinstance(t, dict) and t.get("investigacionId") == investigacion_id and t.get("estado") == "aceptada"]
    return sorted(propias, key=lambda t: (-int(t.get("veces") or 1), int(t.get("creadaEn") or 0)))


def texto_para_plan(e: dict[str, Any], investigacion_id: str, maximo: int = 8) -> str:
    """Las tareas aceptadas, numeradas, para el prompt del plan. El planificador
    tiene que decir qué hace con cada una: programarla o explicar por qué no."""
    lista = aceptadas(e, investigacion_id)[:maximo]
    if not lista:
        return "Ninguna."
    filas = []
    for t in lista:
        o = t.get("origen") or {}
        quien = {"paso": f"un paso de la iteración {o.get('iteracion')}", "revisor": "el revisor de registro", "regla": "una regla", "persona": f"{t.get('quien')}"}.get(str(o.get("tipo")), "un paso")
        repetida = f", pedida {t['veces']} veces" if int(t.get("veces") or 1) > 1 else ""
        filas.append(f"[{t['id']}] ({t['herramienta']}, la abrió {quien}{repetida}) Vio: {t['queVio']} | Haría: {t['queHaria']} | Importa porque: {t['porQue']}")
    return "\n".join(filas)


def marcar(e: dict[str, Any], tarea_id: str, estado: str, motivo: str, ahora: int) -> bool:
    """Reducer: mueve una tarea de estado con su motivo en el historial."""
    t = next((x for x in (e.get("tareas") or []) if isinstance(x, dict) and x.get("id") == tarea_id), None)
    if t is None or estado not in ESTADOS:
        return False
    t["estado"], t["motivo"] = estado, _recortar(motivo, 300)
    t.setdefault("historial", []).append({"estado": estado, "motivo": _recortar(motivo, 300), "fecha": int(ahora)})
    return True


def caducar_viejas(e: dict[str, Any], investigacion_id: str, iteracion: int, ahora: int) -> int:
    """Las tareas aceptadas que llevan más de `ITERACIONES_MAX_EN_COLA`
    iteraciones esperando caducan con su motivo escrito. No se fuerzan en el plan
    (ver el docstring del módulo): la cola viaja al planificador y él tiene que
    explicar por escrito cada una que deja fuera."""
    n = 0
    for t in (e.get("tareas") or []):
        if not isinstance(t, dict) or t.get("investigacionId") != investigacion_id or t.get("estado") != "aceptada":
            continue
        nacida = int((t.get("origen") or {}).get("iteracion") or 0)
        if nacida and iteracion - nacida > politicas.ITERACIONES_MAX_EN_COLA:
            marcar(e, t["id"], "caducada", f"esperó {iteracion - nacida} iteraciones en la cola sin que ningún plan la programara", ahora)
            n += 1
    return n


def por_regla_al_terminar_paso(e: dict[str, Any], c: dict[str, Any], paso: dict[str, Any], comprobacion: dict[str, Any] | None, iteracion: int, ahora: int) -> list[dict[str, Any]]:
    """Las tareas que una REGLA abre al terminar un paso, sin ningún modelo.

    Se apoya en la comprobación de cierre de la etapa
    (`rosa/comprobaciones.py`), que ya está calculada: si ROSA2018 tuviera dos
    definiciones distintas de "el paso no produjo nada" se contradiría en la
    interfaz. Devuelve las tareas SIN escribirlas: quien llama las registra
    dentro de su propia mutación."""
    salida: list[dict[str, Any]] = []
    inv_id = str(c.get("investigacionId") or "")
    comp = comprobacion if isinstance(comprobacion, dict) else {}
    origen = {"tipo": "regla", "pasoId": paso.get("id"), "iteracion": iteracion, "detalle": str(paso.get("titulo") or "")[:200]}
    # Una base que no respondió tres veces en la corrida: buscar en otra.
    for base, veces in (c.get("_fallosFuente") or {}).items():
        if int(veces or 0) >= 3:
            salida.append(nueva(inv_id, f"{base} no respondió {veces} veces en esta corrida", f"Repetir la búsqueda en otra base para lo que {base} debía cubrir, y registrar «no pude comprobar» donde no se pueda", "Una ausencia que viene de una base caída no es una ausencia de evidencia y no debe bajar la certeza", "literatura", origen, ahora))
    # Una etapa que tenía materia y no produjo nada: la comprobación ya lo dice.
    if comp.get("resultado") == "falla" and comp.get("etapa") in HERRAMIENTAS:
        salida.append(nueva(inv_id, f"La etapa de {comp['etapa']} terminó en verde sin producir nada: {_recortar(comp.get('detalle'), 200)}", f"Volver a intentar la etapa de {comp['etapa']} cambiando lo que falló, no repitiéndola igual", "Una etapa que no produce deja sin material a las que vienen detrás", str(comp["etapa"]), origen, ahora))
    return salida[:politicas.MAX_TAREAS_PROPUESTAS_POR_PASO]
