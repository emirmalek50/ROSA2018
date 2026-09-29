"""El Wet-Lab Dossier: el expediente con el que una hipótesis sale al
laboratorio (ROSA2018, etapa 8).

Se arma sin ningún modelo, a partir del estado, en siete partes en el orden
en que las lee quien va a ejecutar el experimento: primero si va o no va y
por que; después la hipótesis exacta con su versión; la evidencia con
procedencia; los análisis con datos; las decisiones que la trajeron hasta
aquí; el protocolo prerregistrado; y que se aprende con cada resultado
posible. Lo que falta se dice ("sin análisis con datos"), no se rellena.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from rosa import dianas as DI
from rosa import experimento as XP
from rosa import politicas
from rosa import ruta as RUTA
from rosa.priorizacion import cohortes_de

ETIQUETA_BLOQUEO = {
    "trazabilidad_insuficiente": "Trazabilidad insuficiente: no hay afirmaciones sostenidas o alguna está bloqueada",
    "datos_no_autorizados": "Datos no autorizados: algún análisis uso un dataset sin aprobar o sin permiso de uso con IA",
    "analisis_invalido": "Análisis inválido según el auditor",
    "sin_experimento_interpretable": "Sin experimento interpretable: faltan los criterios de confirmación o refutación",
    "descartada_por_killer": "Descartada en este contexto",
    "fuente_retractada": "Depende de una fuente retractada",
}

APRENDIZAJE_POR_RESULTADO = {
    "apoyo_reproducido": "Sube la certeza de la hipótesis; la conclusión se rehace con el dato como evidencia directa; se propone replicar en una cohorte distinta.",
    "negativo_interpretable": "Baja la certeza o cambia la dirección; la hipótesis se marca para descartar en este contexto o reformular; el negativo entra al modelo de mundo como hecho.",
    "inconcluso": "No cambia la creencia; se anota que el ensayo no tuvo potencia o los datos no alcanzaron el criterio; se propone repetir con más muestra.",
    "fallo_tecnico": "No toca la hipótesis: el experimento no se ejecutó como se prerregistro. Se registra el fallo y se puede repetir.",
    "toxicidad_inviabilidad": "Cierra la vía de intervención en este contexto; la hipótesis puede seguir viva como mecanismo, no como intervención.",
    "correccion_contexto": "El resultado dice que la hipótesis aplica a otro contexto (otra célula, etapa o población): se crea una hipótesis derivada con el contexto corregido y la original se suspende.",
}


def _fecha(t: int | None) -> str:
    return datetime.fromtimestamp(t / 1000).strftime("%d/%m/%Y %H:%M") if t else "sin fecha"


def _dict(v: Any) -> dict[str, Any]:
    """El valor si es un diccionario; si no (None, texto, lista), uno vacío."""
    return v if isinstance(v, dict) else {}


def _lineas_seguras(fn, que: str) -> list[str]:
    """Las líneas de un texto por regla; si la regla falla, el dossier lo dice
    en una línea en vez de caerse (el expediente tiene que salir siempre)."""
    try:
        return [l for l in str(fn() or "").splitlines() if l.strip()]
    except Exception as ex:  # noqa: BLE001
        return [f"{que}: no pude calcularlo ({type(ex).__name__})."]


def _lineas_ruta(e: dict[str, Any], h: dict[str, Any]) -> list[str]:
    """La ruta terapéutica de la hipótesis (rosa/ruta.py): qué pasos están
    cubiertos, cuál toca y si el paso declarado en la tarjeta es coherente. Se
    usa la guardada por el bucle; si el registro no la trae, se evalúa aquí."""
    return _lineas_seguras(lambda: RUTA.texto_ruta(h.get("ruta") or RUTA.evaluar_ruta(e, h)), "Ruta terapéutica")


def _lineas_contrato(x: dict[str, Any]) -> list[str]:
    """El contrato del experimento (rosa/experimento.py) y, si hay resultado,
    el veredicto por lectura y la lectura del negativo."""
    L = _lineas_seguras(lambda: XP.texto_contrato(x), "Contrato del experimento")
    r = x.get("resultado") if isinstance(x.get("resultado"), dict) else {}
    vs = [v for v in (r.get("veredictosPorLectura") or []) if isinstance(v, dict)]
    if vs:
        L.append("Veredicto por lectura (por regla, con la cifra que nombra cada lectura; sin cifra es no pude comprobar, no ausencia de efecto):")
        for v in vs:
            L.append(f"- {v.get('lectura') or 'sin nombre'} [{XP.etiqueta(XP.TIPOS_LECTURA, v.get('tipo'))}]: {str(v.get('veredicto') or 'no_evaluable').replace('_', ' ')}. {v.get('motivo') or ''}".rstrip())
        L += _lineas_seguras(lambda: "Lectura del negativo: " + XP.texto_lectura_del_negativo(vs), "Lectura del negativo")
    return L


def _lineas_perfil_diana(h: dict[str, Any]) -> list[str]:
    """La tabla del perfil por diana (rosa/dianas.py): qué dicen las bases
    (genética humana, expresión por tejido y por célula, proteína, farmacología,
    literatura) sobre la diana de la hipótesis, una fila por capa."""
    perfil = h.get("perfilDiana")
    if not isinstance(perfil, dict) or not perfil.get("capas"):
        return []
    return ["", "### Qué dicen las bases de la diana"] + _lineas_seguras(lambda: DI.texto_perfil(perfil), "Perfil de evidencia por diana")


def texto_dossier(e: dict[str, Any], h: dict[str, Any], inv: dict[str, Any] | None, corrida: dict[str, Any] | None, ahora: int) -> str:
    L: list[str] = []
    # Un registro antiguo o corrompido puede traer estas piezas con otra forma
    # (texto, lista, None): el expediente tiene que salir igual, diciendo qué falta.
    bloqueos = h.get("bloqueos") if isinstance(h.get("bloqueos"), list) else []
    tarjeta = _dict(h.get("tarjeta"))
    k = _dict(h.get("conclusion"))
    mision = _dict(_dict(inv).get("mision"))
    decisiones = [d for d in e.get("decisiones", []) if isinstance(d, dict) and d.get("hipotesisId") == h["id"]]
    planes = {p["id"]: p for p in e.get("planesAnalisis", []) if isinstance(p, dict) and "id" in p}
    ejecuciones = [x for x in e.get("ejecuciones", []) if isinstance(x, dict) and x.get("hipotesisId") == h["id"]]
    x = _dict(h.get("experimento"))
    if not isinstance(x.get("resultado"), (dict, type(None))):
        x = {**x, "resultado": {"veredicto": "no_evaluable", "resultado": "El resultado registrado tiene una forma que no pude leer.", "fecha": None}}
    if not isinstance(h.get("procedencia"), dict) or not isinstance(h["procedencia"].get("fuentes"), list):
        h = {**h, "procedencia": {**_dict(h.get("procedencia")), "fuentes": []}}
    if not isinstance(h.get("afirmaciones"), list):
        h = {**h, "afirmaciones": []}

    L += [f"# Dossier para el laboratorio: {h['titulo']}", "", f"Generado el {_fecha(ahora)}. Hipótesis {h['id']}, versión {h.get('version', 1)}. Investigación: {(inv or {}).get('titulo', '')}."]
    if corrida and corrida.get("arnes"):
        a = corrida["arnes"]
        L.append(f"ROSA2018: commit {a.get('commit')}, firmas {a.get('firmas')}, programas optimizados {a.get('optimizados')}.")

    # 1. Decision
    L += ["", f"Nivel de autonomía con el que se produjo este dossier: {politicas.nivel_autonomia_texto()} Ninguna decisión que toque el mundo real (asignar un experimento, gastar grande, descartar) la toma ROSA2018 sola por política."]
    L += ["", "## 1. Decisión de priorización"]
    if bloqueos:
        L.append("NO es candidata al laboratorio. Bloqueos no compensables:")
        L += [f"- {ETIQUETA_BLOQUEO.get(b, b)}" for b in bloqueos]
    elif h.get("candidata"):
        L.append(f"Candidata al laboratorio en este ciclo (máximo {politicas.MAX_CANDIDATOS_LABORATORIO} por ciclo, con diversidad entre clusters).")
    else:
        L.append("Sin bloqueos, pero hoy no está entre las candidatas (otras puntuan más o el Killer no la dejo avanzar todavía).")
    if not h.get("decisionKiller"):
        # Una hipótesis sin juzgar por el Killer es indistinguible por su estado
        # de una que el Killer dejó avanzar: las dos ponen "propuesta". Y trae
        # conclusión, certeza y Elo como cualquier otra. Se dice arriba y con
        # todas las letras (28 de septiembre de 2026).
        pendiente = (h.get("killerPendiente") or {}).get("motivo") if isinstance(h.get("killerPendiente"), dict) else None
        L.append("AVISO: el Killer NO ha juzgado esta hipótesis" + (f" ({pendiente})" if pendiente else "") + ". No ha pasado las comprobaciones de citas, fidelidad, supuestos, falsabilidad ni novedad, así que lo que sigue no está filtrado por ellas y la hipótesis no puede ser candidata al laboratorio.")
    L.append(f"Estado: {h['estado']}. Elo {h['elo']} tras {len(h.get('partidos', []))} partidos. Decisión del Killer sobre esta versión: {h.get('decisionKiller') or 'PENDIENTE (nunca juzgada)'}.")
    if k:
        L.append(f"Conclusión de ROSA2018: certeza {k.get('certeza')}, dirección {k.get('direccion')}. {k.get('enunciado', '')}")

    # 2. Hipotesis
    L += ["", "## 2. La hipótesis (contrato completo)", f"Título: {h['titulo']}", f"Enunciado: {h['enunciado']}", f"Mecanismo: {h['mecanismo']}"]
    if tarjeta:
        L += [
            f"Diana o proceso: {tarjeta.get('diana') or 'sin especificar'}",
            f"Célula o tejido: {tarjeta.get('celula') or 'sin especificar'}",
            f"Etapa: {tarjeta.get('etapa') or 'sin especificar'}",
            f"Intervención: {tarjeta.get('intervencion') or 'ninguna'} ({tarjeta.get('direccion', 'sin_intervencion')})",
            f"Predicción falsable: {tarjeta.get('prediccionFalsable') or 'SIN PREDICCIÓN FALSABLE'}",
            "Riesgos: " + ("; ".join(str(r) for r in tarjeta["riesgos"]) if isinstance(tarjeta.get("riesgos"), list) and tarjeta["riesgos"] else "ninguno declarado"),
            f"Paso de la ruta terapéutica declarado en la tarjeta: {(tarjeta.get('pasoRuta') or 'mecanismo').replace('_', ' ')}.",
        ]
    else:
        L.append("Sin tarjeta de hipótesis: falta el contrato mínimo (diana, célula, etapa, intervención, predicción falsable).")
    # La ruta terapéutica por regla (ocho pasos, de mecanismo a evidencia en la
    # población): qué está cubierto con qué evidencia, qué toca y si el paso
    # declarado va por delante de un paso vacío.
    L += _lineas_ruta(e, h)
    L += _lineas_perfil_diana(h)
    c = _dict(h.get("comprobacion"))
    L.append(f"Comprobación propuesta: biomarcador {c.get('biomarcador') or 'sin declarar'}; cohorte {c.get('cohorte') or 'sin declarar'}; diseño {c.get('diseno') or 'sin declarar'}.")
    if mision:
        L.append(f"Encaje con la misión: población {mision.get('poblacion') or '?'}; etapa {mision.get('etapa') or '?'}; célula o tejido {mision.get('celulaTejido') or '?'}; mecanismo {mision.get('mecanismo') or '?'}; intervención {mision.get('tipoIntervencion') or '?'}.")
    if h.get("versiones"):
        L.append("Versiones anteriores:")
        for v in h["versiones"]:
            L.append(f"- v{v['n']} ({_fecha(v['fecha'])}, {v['quien']}): {v['titulo']}. Motivo del cambio: {v['motivo']}")
    if h.get("derivadaDe"):
        L.append(f"Derivada de: {h['derivadaDe']}")

    # 3. Evidencia
    sostenidas = [a for a in h["afirmaciones"] if a["veredicto"] in ("sostenida", "parcial")]
    otras = [a for a in h["afirmaciones"] if a["veredicto"] not in ("sostenida", "parcial")]
    cohortes = cohortes_de(h)
    # La balanza, en la primera línea de la sección: quien lee un dossier de 17
    # apoyos y 0 contras tiene que enterarse de que son 17 y 0. El 29 de
    # septiembre de 2026 la base entera tenía 117 afirmaciones a favor y UNA en
    # contra, y ningún dossier lo decía.
    a_favor = sum(1 for a in sostenidas if a.get("relacion") in ("apoya", "apoya_indirecta"))
    en_contra = sum(1 for a in sostenidas if a.get("relacion") in ("contradice", "socava"))
    balanza = f" Balanza: {a_favor} a favor y {en_contra} en contra."
    if en_contra == 0 and a_favor >= 4:
        balanza += " NINGUNA fuente la contradice, y eso no es lo mismo que haber buscado lo que la refutaría y no haberlo encontrado: mira si hay una búsqueda dirigida a su criterio de refutación antes de leer esto como respaldo."
    L += ["", "## 3. Evidencia con procedencia", f"{len(sostenidas)} afirmaciones sostenidas o parciales de {len(h['afirmaciones'])}; {len(h['procedencia']['fuentes'])} fuentes; {len(cohortes)} cohortes distintas identificadas" + (f" ({', '.join(cohortes)})" if cohortes else "") + "." + balanza]
    for a in sostenidas:
        clase = a.get("clase") or ("dato" if a["tipo"] == "dato" else "literatura")
        L.append(f"- [{a['veredicto']}, {a['tipo']}, clase {clase}{', SINTÉTICO' if a.get('sintetico') else ''}] {a['texto']} {a['cita']}")
        if a.get("fragmento"):
            L.append(f"    Pasaje literal: \"{a['fragmento'][:300]}\"")
    if otras:
        L.append("Afirmaciones que no se sostienen o no se pudieron comprobar (no cuentan como evidencia):")
        L += [f"- [{a['veredicto']}] {a['texto']} {a['cita']} ({a['motivo']})" for a in otras]
    retractadas = [f for f in h["procedencia"]["fuentes"] if f.get("retraccion")]
    if retractadas:
        L.append("Fuentes con marca editorial: " + "; ".join(f"{f['referencia']} ({f['retraccion']})" for f in retractadas))
    if h.get("supuestos"):
        L.append("Supuestos evaluados:")
        L += [f"- [{s['estado']}] {s['texto']} ({s['evidencia']})" for s in h["supuestos"]]
    n = h.get("novedad", {})
    if n:
        L.append("Novedad: " + "; ".join(f"{clave} {v['estado']}: {v['detalle'][:120]}" for clave, v in n.items()))

    # 4. Analisis con datos
    L += ["", "## 4. Análisis in silico"]
    if not ejecuciones:
        L.append("Sin análisis con datos. La hipótesis se apoya solo en literatura.")
    for run in ejecuciones:
        plan = planes.get(run["planId"], {})
        L.append(f"- Ejecución {run['id']} ({_fecha(run['inicio'])}): estado {run['estado']}; plan congelado el {_fecha(plan.get('congeladoEn'))}; pregunta: {plan.get('pregunta', '')}; prueba: {plan.get('prueba', '')}; baseline: {plan.get('baseline', '')}; semilla {run['semilla']}; datos sha256 {run['hashDatos'][:12]}.")
        if run.get("resultados"):
            L.append("    Resultados: " + "; ".join(f"{k2}={v}" for k2, v in run["resultados"].items()))
        if run.get("baseline"):
            L.append("    Baseline: " + "; ".join(f"{k2}={v}" for k2, v in run["baseline"].items()))
        if run.get("interpretacion"):
            L.append(f"    Interpretación: {run['interpretacion']['estado']}. {run['interpretacion']['resumen']}")
        if run.get("auditoria"):
            au = run["auditoria"]
            L.append(f"    Auditoría (Killer II, {au['quien']}): {au['veredicto']}. {au['motivo']}")
            L += [f"      - {cmp['comprobacion']}: {cmp['resultado']}. {cmp['detalle']}" for cmp in au.get("comprobaciones", [])]
        if run.get("error"):
            L.append(f"    Error técnico: {run['error'][:300]}")

    # 5. Decisiones
    L += ["", "## 5. Decisiones registradas"]
    if not decisiones:
        L.append("Ninguna decisión registrada todavía.")
    for d in decisiones:
        L.append(f"- {_fecha(d['fecha'])} · {d['etapa']} · v{d['version']} · {d['decision']} · {d['quien']}: {d['motivo']}")
        for cmp in d.get("comprobaciones", []):
            if cmp["resultado"] in ("falla", "no_comprobable"):
                L.append(f"    - {cmp['comprobacion']}: {cmp['resultado']}. {cmp['detalle'][:200]}")
        if d.get("auditoria"):
            acuerdo = d["auditoria"].get("acuerdo")
            veredicto_aud = "sin respuesta del auditor" if acuerdo is None else ("de acuerdo" if acuerdo else "EN DESACUERDO")
            L.append(f"    Auditoría ({d['auditoria'].get('quien', '?')}): {veredicto_aud}. {str(d['auditoria'].get('motivo') or '')[:200]}")
    if h.get("revisionesHumanas"):
        L.append("Revisiones escritas por personas:")
        for r in h["revisionesHumanas"]:
            L.append(f"- {r['quien']} ({_fecha(r['fecha'])}): supuestos cuestionados: {r['supuestosCuestionados']}; literatura que falta: {r['literaturaQueFalta']}; problema experimental: {r['problemaExperimental']}")

    # 6. Experimento
    L += ["", "## 6. Experimento propuesto y prerregistro"]
    if not x:
        L.append("Sin experimento propuesto.")
    else:
        L += ["Protocolo:", x.get("protocolo", ""), f"Ensayo: {x.get('ensayo', '')}", f"Controles: {x.get('controles') or 'no declarados'}", f"Tamaño muestral: {x.get('tamanoMuestral') or 'no declarado'}", f"Alternativa y como se distingue: {x.get('alternativa') or 'no declarada'}", f"La CONFIRMA si: {x.get('confirma') or 'sin criterio'}", f"La REFUTA si: {x.get('refuta') or 'sin criterio'}", f"Qué decisión cambia con el resultado: {x.get('decisionQueCambia') or 'no declarado'}", f"Coste estimado: {x.get('costeEstimado', '')}"]
        if x.get("analisisPedido"):
            L.append(f"Con datos existentes: {x['analisisPedido']}")
        L += _lineas_contrato(x)
        if x.get("prerregistradoEn"):
            L.append(f"Prerregistrado el {_fecha(x['prerregistradoEn'])} (artefacto {x.get('prerregistroArtefactoId')}). Asignado a: {x.get('laboratorio')}.")
        else:
            L.append("Todavía no prerregistrado: al asignarlo a un laboratorio se congela.")
        if x.get("resultado"):
            r = x["resultado"]
            L.append(f"Resultado recibido ({_fecha(r.get('fecha'))}): {r.get('veredicto') or 'sin veredicto'} / {r.get('clasificacion') or 'sin clasificar'}. {r.get('resultado') or ''}".rstrip())
            if r.get("dimensiones"):
                d = r["dimensiones"]
                activas = [k for k, v in d.items() if k != "nota" and v]
                L.append("Dimensiones que coexisten: " + (", ".join(activas) or "ninguna") + (f". {d.get('nota', '')}" if d.get("nota") else ""))
            if r.get("versionProbada"):
                L.append(f"Probo la versión {r['versionProbada']} de la hipótesis" + ("" if r.get("compatibleConActual", True) else f" (la actual es la {h.get('version', 1)}: comprobar compatibilidad)") + ".")
    if mision.get("capacidadesLaboratorio"):
        L.append("Capacidades declaradas del laboratorio: " + "; ".join(mision["capacidadesLaboratorio"]))

    # 7. Riesgos y aprendizaje
    evaluadas = [f for f in h["procedencia"]["fuentes"] if isinstance(f.get("riesgoSesgo"), dict)]
    if evaluadas:
        L += ["", "### Riesgo de sesgo por instrumento (veredicto por regla desde las preguntas de señalización)"]
        L += [f"- {f.get('referencia', f.get('id'))}: {f['riesgoSesgo'].get('instrumento')} riesgo global {str(f['riesgoSesgo'].get('global', '')).replace('_', ' ')}; " + ", ".join(f"{d['id']} {d['juicio'].replace('_', ' ')}" for d in f['riesgoSesgo'].get('dominios', [])) for f in evaluadas[:12]]
    operativo = (inv or {}).get("conocimientoOperativo") or []
    if operativo:
        L += ["", "### Conocimiento operativo del laboratorio (no publicado; clase conocimiento_operativo)"]
        L += [f"- [{x['tipo']}] {x['texto']} ({x['quien']}, {_fecha(x['fecha'])})" for x in operativo[:15]]
    L += ["", "## 7. Riesgos, alternativas y que se aprende con cada resultado"]
    # Las explicaciones rivales con la observación que las separaría: es el
    # experimento crucial de Platt, y estaba calculado en 27 de las 34
    # hipótesis de la base sin salir nunca por la puerta (28 de septiembre de
    # 2026). La sección se llamaba "alternativas" y no imprimía ninguna.
    alternativas = [x for x in (h.get("alternativas") or []) if isinstance(x, dict) and (x.get("texto") or "").strip()]
    if alternativas:
        L += ["", "### Explicaciones rivales y qué observación las separaría", "Lo que tendría que ser falso para que el efecto sea del actor que propone la hipótesis y no de otra cosa. Una prueba que no distinga entre estas columnas no decide nada."]
        for x in alternativas:
            clase = str(x.get("clase") or "alternativa").replace("_", " ")
            L.append(f"- **[{clase}]** {x['texto']}")
            distingue = (x.get("queLaDistinguiria") or "").strip()
            L.append(f"    - Qué la distinguiría: {distingue}" if distingue else "    - Qué la distinguiría: SIN DEFINIR. Mientras no lo esté, ningún resultado descarta esta explicación.")
    if isinstance(tarjeta.get("riesgos"), list) and tarjeta["riesgos"]:
        L += [f"- Riesgo: {r}" for r in tarjeta["riesgos"]]
    if k:
        L += [f"De que depende más: {k.get('loMasFragil', '')}", f"Subiría la certeza si: {k.get('subiria', '')}", f"Bajaría si: {k.get('bajaria', '')}"]
        if k.get("enContra"):
            L.append("En contra: " + " | ".join(k["enContra"]))
    L.append("Qué hace ROSA2018 con cada resultado posible del laboratorio:")
    L += [f"- {nombre.replace('_', ' ')}: {texto}" for nombre, texto in APRENDIZAJE_POR_RESULTADO.items()]
    L += ["", "Lo que se analice fuera del prerregistro se reporta como exploratorio. Este dossier describe el estado de la evidencia en la fecha indicada; no es una recomendación clínica."]
    return "\n".join(L)
