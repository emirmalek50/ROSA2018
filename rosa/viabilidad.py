"""¿Se puede hacer la prueba que propone una hipótesis con los datos que existen?

El caso que lo motivó (25 de septiembre de 2026), sobre la hipótesis
hip-mu30n7o9-4025: "con la misma bajada de P-tau181, el paciente mejora más si
tiene poco daño vascular en el cerebro que si tiene mucho". Su prueba era revisar
los resultados publicados de los ensayos de lecanemab y donanemab por estratos de
carga vascular. Pero CLARITY AD (NCT03887455) excluyó a quien tenía "severe small
vessel, or white matter disease" o "multiple lacunar infarcts", y TRAILBLAZER-ALZ 2
excluyó la enfermedad severa de sustancia blanca: esos ensayos sacaron justo a los
pacientes con mucho daño vascular, así que no pueden comparar "poco" con "mucho".
ROSA2018 tenía el conector a ClinicalTrials.gov para leerlo en segundos y, en vez
de mirarlo, la hipótesis dejaba escrita la excusa: "si no hay datos publicados por
subgrupos, quedaría sin poder comprobarse".

Qué hace este módulo, sin inventar nada:

1. Por regla, decide si la prueba es trabajo de escritorio (revisar lo ya
   publicado). Solo esas se comprueban aquí: un ensayo nuevo o un análisis de
   muestras tiene otra viabilidad, que no se lee en un registro.
2. Por regla, saca de la prueba los fármacos que nombra (lecanemab, donanemab,
   semaglutida, códigos como AL002) y los identificadores NCT.
3. Lee en ClinicalTrials.gov los criterios de elegibilidad de los ensayos más
   grandes de cada uno.
4. El juez (Opus) decide si la prueba necesita comparar un grupo que esos ensayos
   excluyeron, y tiene que CITAR el criterio literal. Una cita que no está en el
   texto del registro se tira, igual que una cita de artículo que no resuelve a
   su página: sin cita que resuelva, no hay "inviable".
5. El resultado entra en el Killer como la comprobación `factibilidad`, que ya
   existía pero que el juez decidía de memoria. Las comprobaciones de regla
   mandan sobre las del juez (`killer.fusionar`), así que ahora gana la que se
   apoya en los criterios reales. Si falla, el Killer manda a reformular y el
   reformulador ya sabe qué hacer con una factibilidad que falla: cambiar la
   prueba a una cohorte o técnica que exista.

Dos reglas de la casa que aquí pesan. Un registro que no responde es "no pude
comprobar", nunca "no hay ensayos". Y un resumen corto de criterios no prueba que
un grupo estuviera INCLUIDO: el registro de TRAILBLAZER-ALZ 2 (NCT04437511) tiene
519 caracteres de criterios y no nombra la sustancia blanca, aunque el protocolo
publicado la excluía. Por eso "viable" exige criterios completos.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

from rosa.fuentes import clinicaltrials as CT
from rosa.fuentes.base import FuenteNoDisponible

ESTADOS = ("viable", "limitada", "inviable", "no_comprobable", "sin_ensayos_nombrados")


def dic(x: Any) -> dict[str, Any]:
    """El valor si es un diccionario; si no (None, texto, un registro roto), uno vacío."""
    return x if isinstance(x, dict) else {}

# Cuántos fármacos, cuántos ensayos por fármaco y cuánto texto de criterios por
# ensayo. Cinco fármacos por dos ensayos son diez peticiones a un registro que pide
# una por segundo, y los criterios de CLARITY AD son 11.025 caracteres: se
# recortan a la parte de exclusión, que es la que decide.
MAX_INTERVENCIONES = 5
ENSAYOS_POR_INTERVENCION = 2
MAX_CRITERIOS = 5000
# Por debajo de esto, los criterios del registro son un resumen y no permiten decir
# que un grupo estaba incluido (TRAILBLAZER-ALZ 2 tiene 519).
CRITERIOS_COMPLETOS = 1500
# Si el registro no respondió, se vuelve a intentar pasado este tiempo.
REINTENTO_MS = 6 * 3600 * 1000

# -- 1. ¿La prueba es trabajo de escritorio? ------------------------------------

# Validado el 25 de septiembre de 2026 sobre los 28 diseños reales: marca los 12
# que son revisar lo publicado y deja fuera los estudios con datos o muestras de
# pacientes y los ensayos nuevos.
_ESCRITORIO = re.compile(r"revisi[oó]n|meta.?an[aá]lisis|an[aá]lisis secundario|re.?an[aá]lisis|resultados (?:agregados|publicados)|datos (?:agregados|publicados|p[uú]blicos)|extraer (?:los )?resultados", re.I)
_NUEVO = re.compile(r"ensayo (?:conceptual|aleatorizado|cl[ií]nico nuevo)|doble ciego|reclutar|laboratorio|in vitro|in vivo|ratones|cultivo|organoide|biopsia|cohorte prospectiva|seguimiento prospectivo", re.I)


def primera_frase(diseno: Any) -> str:
    """La primera frase del diseño, que es la que dice qué clase de estudio es; lo
    que sigue son matices (qué se registra antes, qué se excluye)."""
    d = str(diseno or "").strip()
    m = re.search(r"(?<=[a-záéíóúñ0-9\)])\.\s", d)
    return d[: m.start() + 1] if m else d[:260]


def es_trabajo_de_escritorio(diseno: Any) -> bool:
    """Si la prueba que propone la hipótesis es revisar lo ya publicado, que es
    trabajo que ROSA2018 hace con sus herramientas y no un experimento para otros."""
    p = primera_frase(diseno)
    return bool(_ESCRITORIO.search(p)) and not _NUEVO.search(p)


# -- 2. ¿Qué ensayos nombra la prueba? ------------------------------------------

_FARMACO = re.compile(r"\b([A-Za-zÁÉÍÓÚáéíóú]{3,}(?:mab|glutida|glutide))\b")
_CODIGO = re.compile(r"\b([A-Z]{1,4}-?\d{3,7})\b")
_NCT = re.compile(r"\bNCT\d{8}\b")
# Códigos con la forma de un fármaco que no lo son.
_NO_SON_FARMACO = ("GSE", "GDS", "PMID", "DOI", "ISRCTN", "EUDRACT")
# Ensayos que las hipótesis nombran por su acrónimo y no por el fármaco ("evoke,
# evoke+, INVOKE-2"), con la intervención con la que se buscan en el registro. Solo
# los que ya aparecen en hipótesis de ROSA2018 o son pivotales del campo: una tabla
# corta que se lee, no un catálogo que se inventa. Fuera los acrónimos que son
# palabras corrientes (EMERGE, ENGAGE, GRADUATE): "el efecto emerge de..." buscaría
# aducanumab sin motivo, y esos fármacos ya se encuentran por su nombre.
ENSAYOS_CONOCIDOS = {
    "evoke+": "semaglutide",
    "evoke": "semaglutide",
    "invoke-2": "AL002",
    "clarity ad": "lecanemab",
    "ahead 3-45": "lecanemab",
    "trailblazer-alz": "donanemab",
}
_ACRONIMO = re.compile(r"(?<![\w-])(" + "|".join(re.escape(k) for k in sorted(ENSAYOS_CONOCIDOS, key=len, reverse=True)) + r")(?![\w-])", re.I)


def _en_ingles(nombre: str) -> str:
    """ClinicalTrials.gov está en inglés: "semaglutida" es "semaglutide"."""
    n = nombre.lower()
    return n[: -len("glutida")] + "glutide" if n.endswith("glutida") else n


def intervenciones_nombradas(h: dict[str, Any]) -> tuple[list[str], list[str]]:
    """(fármacos o códigos en inglés, identificadores NCT) que nombra la prueba de
    la hipótesis, sin repetir y en el orden en que aparecen."""
    c = dic(h.get("comprobacion"))
    texto = " ".join(str(c.get(k) or "") for k in ("cohorte", "diseno", "biomarcador")) + " " + str(h.get("enunciado") or "")
    vistos: list[str] = []
    for m in _FARMACO.finditer(texto):
        n = _en_ingles(m.group(1))
        if n not in vistos:
            vistos.append(n)
    for m in _CODIGO.finditer(texto):
        n = m.group(1)
        if not n.upper().startswith(_NO_SON_FARMACO) and n not in vistos:
            vistos.append(n)
    for m in _ACRONIMO.finditer(texto):
        n = ENSAYOS_CONOCIDOS[m.group(1).lower()]
        if n not in vistos:
            vistos.append(n)
    ncts: list[str] = []
    for m in _NCT.finditer(texto):
        if m.group(0) not in ncts:
            ncts.append(m.group(0))
    return vistos[:MAX_INTERVENCIONES], ncts[:MAX_INTERVENCIONES]


# -- 3. Los criterios de elegibilidad -------------------------------------------

_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_S = 12 * 3600


def solo_exclusion(criterios: str, maximo: int = MAX_CRITERIOS) -> str:
    """La parte de exclusión de los criterios, que es la que dice a quién sacaron.
    Si el registro no la separa, el texto entero recortado."""
    t = str(criterios or "")
    m = re.search(r"exclusion criteria", t, re.I)
    return (t[m.start():] if m else t)[:maximo]


async def _ensayos_de(intervencion: str) -> list[dict[str, Any]]:
    """Los ensayos de un fármaco, o el de un NCT si se le da un NCT, con caché: diez
    hipótesis de la misma campaña nombran los mismos cuatro fármacos."""
    ahora = time.time()
    guardado = _CACHE.get(intervencion)
    if guardado and ahora - guardado[0] < _CACHE_S:
        return guardado[1]
    if _NCT.fullmatch(intervencion):
        r = await CT.elegibilidad_por_nct(intervencion)
    else:
        r = await CT.elegibilidad(intervencion, maximo=ENSAYOS_POR_INTERVENCION)
    _CACHE[intervencion] = (ahora, r)
    return r


async def reunir_ensayos(h: dict[str, Any]) -> dict[str, Any]:
    """Los ensayos de los fármacos que nombra la prueba, con sus criterios. Devuelve
    {"ensayos", "noEncontrados", "sinRespuesta"}: un fármaco sin ensayos en el
    registro va a `noEncontrados` (puede estar registrado con un código), y uno cuyo
    registro no respondió va a `sinRespuesta`. Ninguno de los dos es "no hay"."""
    farmacos, ncts = intervenciones_nombradas(h)
    ensayos: list[dict[str, Any]] = []
    no_encontrados: list[str] = []
    sin_respuesta: list[str] = []
    for f in farmacos:
        try:
            r = await _ensayos_de(f)
        except (FuenteNoDisponible, OSError, ValueError):
            # Un registro caído o una respuesta rota es "no pude comprobar", nunca
            # "no hay ensayos".
            sin_respuesta.append(f)
            continue
        if not r:
            no_encontrados.append(f)
        for x in r:
            if x.get("nct") and not any(y["nct"] == x["nct"] for y in ensayos):
                ensayos.append({**x, "intervencion": f})
    # Los NCT que nombra la prueba y no salieron por fármaco se piden por su id.
    for n in ncts:
        if any(y["nct"] == n for y in ensayos):
            continue
        try:
            r = await _ensayos_de(n)
        except (FuenteNoDisponible, OSError, ValueError):
            sin_respuesta.append(n)
            continue
        ensayos.extend({**x, "intervencion": n} for x in r if x.get("nct") == n)
    return {"ensayos": ensayos, "noEncontrados": no_encontrados, "sinRespuesta": sin_respuesta}


def texto_para_juez(ensayos: list[dict[str, Any]]) -> str:
    bloques = []
    for x in ensayos:
        completo = len(x.get("criterios") or "") >= CRITERIOS_COMPLETOS
        aviso = "" if completo else f" (AVISO: el registro solo trae {len(x.get('criterios') or '')} caracteres de criterios, es un resumen; no prueba que un grupo estuviera incluido)"
        nombre = f"{x['nct']} {x.get('acronimo') or ''}".strip()
        bloques.append(f"### {nombre}: {x.get('titulo', '')} ({x.get('participantes') or '?'} participantes, fases {', '.join(x.get('fases') or []) or '?'}){aviso}\n{solo_exclusion(x.get('criterios') or '')}")
    return "\n\n".join(bloques) or "Ninguno"


# -- 4. Las citas del juez tienen que resolver ----------------------------------


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", str(t or "")).strip().lower()


def citas_que_resuelven(exclusiones: list[dict[str, Any]], ensayos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Solo las exclusiones cuya cita está literalmente en los criterios del ensayo
    que nombra (o, si nombró mal el ensayo, en los de cualquiera de los leídos). Es
    la regla de las citas de ROSA2018 aplicada al registro: una cita que no resuelve
    no cuenta."""
    por_nct = {x["nct"]: _norm(x.get("criterios") or "") for x in ensayos}
    salida = []
    for ex in exclusiones:
        cita = _norm(ex.get("criterio") or "")
        if len(cita) < 8:
            continue
        nct = str(ex.get("nct") or "").strip().upper()
        donde = nct if nct in por_nct and cita in por_nct[nct] else next((k for k, v in por_nct.items() if cita in v), None)
        if donde:
            titulo = next((x.get("acronimo") or x.get("titulo") or "" for x in ensayos if x["nct"] == donde), "")
            salida.append({"nct": donde, "titulo": titulo, "criterio": str(ex.get("criterio")).strip()[:300]})
    return salida


# -- 5. Lo que se guarda y lo que ve el Killer -----------------------------------


def huella(h: dict[str, Any]) -> str:
    """Lo que, si cambia, obliga a volver a comprobar: el enunciado y la prueba. Una
    reformulación cambia la prueba, así que se recomprueba sola."""
    c = dic(h.get("comprobacion"))
    cuerpo = json.dumps([h.get("enunciado"), c.get("biomarcador"), c.get("cohorte"), c.get("diseno")], ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(cuerpo.encode("utf-8")).hexdigest()


def necesita(h: dict[str, Any], ahora_ms: int | None = None) -> bool:
    """Si hay que comprobar (o volver a comprobar) la viabilidad de la prueba."""
    if not isinstance(h, dict) or h.get("estado") in ("descartada",) or h.get("fusionadaEn"):
        return False
    if not es_trabajo_de_escritorio(dic(h.get("comprobacion")).get("diseno")):
        return False
    v = h.get("viabilidad")
    if not isinstance(v, dict) or v.get("huella") != huella(h):
        return h.get("_viabilidadIntentada") != huella(h)
    # Misma prueba: solo se reintenta si el registro no respondió y ya pasó el plazo.
    ahora = int(ahora_ms if ahora_ms is not None else time.time() * 1000)
    return bool(v.get("sinRespuesta")) and ahora >= int(v.get("reintentarDespues") or 0)


def comprobacion_factibilidad(h: dict[str, Any]) -> dict[str, str] | None:
    """La viabilidad como comprobación `factibilidad` del Killer, o None si no hay
    nada apoyado en el registro (entonces el juez la decide como siempre)."""
    v = dic(h.get("viabilidad"))
    if not v or v.get("huella") != huella(h):
        return None
    ex = v.get("exclusiones") or []
    citas = "; ".join(f"{x.get('nct')} excluyó «{str(x.get('criterio'))[:140]}»" for x in ex[:3])
    if v.get("estado") == "inviable":
        alt = f" Alternativa: {v['alternativa']}" if v.get("alternativa") else ""
        return {"comprobacion": "factibilidad", "resultado": "falla", "detalle": f"La prueba necesita {v.get('grupoNecesario') or 'un grupo'} y los ensayos que nombra lo excluyeron: {citas}.{alt}"[:400]}
    if v.get("estado") == "viable":
        return {"comprobacion": "factibilidad", "resultado": "pasa", "detalle": f"Los ensayos que nombra la prueba no excluyen a {v.get('grupoNecesario') or 'ese grupo'} según sus criterios en ClinicalTrials.gov ({', '.join(e_.get('nct', '') for e_ in (v.get('ensayos') or [])[:4])})"[:400]}
    if v.get("estado") == "limitada":
        return {"comprobacion": "factibilidad", "resultado": "no_comprobable", "detalle": f"Prueba recortada: {citas or v.get('explicacion', '')}. El contraste que pide la hipótesis solo cabe en parte"[:400]}
    return None


def _nombre_juez(ctx: Any) -> str | None:
    juez = getattr(getattr(ctx, "modelos", None), "juez", None)
    return str(getattr(juez, "model", "") or "") or None


async def asegurar(ctx: Any, h: dict[str, Any], pista: Any = None, pedir_revision: bool = False) -> dict[str, Any] | None:
    """Comprueba la viabilidad de la prueba si hace falta y la guarda en
    `h["viabilidad"]`. Una llamada al juez por hipótesis y por versión de la
    prueba, más unas pocas peticiones a ClinicalTrials.gov.

    `pedir_revision` es para cuando se comprueba fuera del Killer (el relleno de
    fondo, sobre hipótesis ya juzgadas): si sale inviable, se le pide al Killer que
    vuelva a juzgar, y como la factibilidad falla, manda a reformular. Dentro del
    Killer no hace falta: el Killer que llamó ya la ve."""
    from rosa.bucle.pasos import EXCEPCIONES_QUE_CORTAN_EL_PASO

    if not necesita(h):
        return dic(h.get("viabilidad")) or None
    hid, hu = h["id"], huella(h)
    ahora = int(time.time() * 1000)

    def marcar_intento(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y.get("id") == hid), None)
        if x is None:
            return False
        x["_viabilidadIntentada"] = hu
        return True

    # La marca de intento se escribe al terminar, con el resultado o con el fallo.
    # Nunca antes de llamar: si el presupuesto se agota o el juez no responde a
    # mitad, la comprobación tiene que poder repetirse cuando vuelvan, y una marca
    # puesta de antemano la dejaría sin hacer para siempre.
    reunido = await reunir_ensayos(h)
    ensayos = reunido["ensayos"]
    base = {"huella": hu, "fecha": ahora, "ensayos": [{"nct": x["nct"], "acronimo": x.get("acronimo") or "", "titulo": x.get("titulo") or "", "participantes": x.get("participantes"), "caracteresCriterios": len(x.get("criterios") or "")} for x in ensayos], "noEncontrados": reunido["noEncontrados"], "sinRespuesta": reunido["sinRespuesta"], "exclusiones": [], "grupoNecesario": "", "alternativa": "", "juez": None}
    if reunido["sinRespuesta"]:
        base["reintentarDespues"] = ahora + REINTENTO_MS
    if not ensayos:
        farmacos, ncts = intervenciones_nombradas(h)
        if not farmacos and not ncts:
            resultado = {**base, "estado": "sin_ensayos_nombrados", "explicacion": "La prueba no nombra ningún fármaco ni ensayo registrado que se pueda leer en ClinicalTrials.gov."}
        elif reunido["sinRespuesta"]:
            resultado = {**base, "estado": "no_comprobable", "explicacion": f"ClinicalTrials.gov no respondió para {', '.join(reunido['sinRespuesta'])}. No es que no haya ensayos: no se pudo consultar, y se vuelve a intentar."}
        else:
            resultado = {**base, "estado": "no_comprobable", "explicacion": f"No se encontraron en ClinicalTrials.gov ensayos de fase 2 o 3 de {', '.join(reunido['noEncontrados'])}; pueden estar registrados con otro nombre o un código."}
    else:
        c = h.get("comprobacion") or {}
        try:
            pred = await ctx.llamar("juez", ctx.programas.viabilidad, hipotesis=str(h.get("enunciado") or ""), prueba=f"Biomarcador: {c.get('biomarcador', '')}\nCohorte: {c.get('cohorte', '')}\nDiseño: {c.get('diseno', '')}", ensayos=texto_para_juez(ensayos))
        except EXCEPCIONES_QUE_CORTAN_EL_PASO:  # presupuesto, modelo caído o corrida parada
            raise  # sin marca: se repite cuando haya presupuesto o el juez vuelva
        except Exception as ex:  # noqa: BLE001
            # Un fallo que no es de presupuesto ni de modelo no se repite en cada tic
            # del relleno de fondo: queda marcado para esta versión de la prueba.
            ctx.mutar(marcar_intento, "viabilidad")
            if pista:
                pista.nota(f"El juez no pudo comprobar la viabilidad de la prueba: {str(ex)[:120]}")
            return None
        v = pred.viabilidad
        exclusiones = citas_que_resuelven([{"nct": x.nct, "criterio": x.criterio} for x in (v.exclusiones or [])], ensayos)
        estado = v.veredicto if v.veredicto in ESTADOS else "no_comprobable"
        explicacion = str(v.explicacion or "").strip()[:500]
        if estado in ("inviable", "limitada") and not exclusiones:
            # Sin cita que resuelva no hay "inviable": el juez lo dijo, pero lo que
            # citó no está en el texto del registro.
            explicacion = f"El juez dijo «{estado}», pero ninguna de sus citas está en los criterios del registro, así que no cuenta. {explicacion}"[:500]
            estado = "no_comprobable"
        if estado == "viable" and not all(len(x.get("criterios") or "") >= CRITERIOS_COMPLETOS for x in ensayos):
            # Un resumen corto no prueba que el grupo estuviera incluido.
            explicacion = f"Algún ensayo solo trae un resumen de sus criterios en el registro, así que no se puede afirmar que el grupo estuviera incluido. {explicacion}"[:500]
            estado = "no_comprobable"
        resultado = {**base, "estado": estado, "explicacion": explicacion, "exclusiones": exclusiones, "grupoNecesario": str(v.grupo_necesario or "").strip()[:200], "alternativa": str(v.alternativa or "").strip()[:300], "juez": _nombre_juez(ctx)}

    def guardar(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y.get("id") == hid), None)
        if x is None:
            return False
        x["viabilidad"] = resultado
        x["_viabilidadIntentada"] = hu
        registro = (x.get("procedencia") or {}).get("registro")
        if isinstance(registro, list):
            registro.append(f"viabilidad de la prueba: {resultado['estado']}. {resultado['explicacion'][:200]}")
        if pedir_revision and resultado["estado"] == "inviable" and x.get("estado") in ("propuesta", "en_revision") and x.get("decisionKiller"):
            # El Killer ya la juzgó sin saberlo: que vuelva a juzgar, ahora con la
            # factibilidad apoyada en el registro. Si falla, manda a reformular.
            x["_revisionPedida"] = True
        return True

    ctx.mutar(guardar, "viabilidad")
    if pista:
        pista.nota(f"Viabilidad de la prueba: {resultado['estado']}. {resultado['explicacion'][:160]}")
    return resultado
